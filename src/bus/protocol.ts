/**
 * The message contract.
 *
 * Every message between the content script, the page hook, the background
 * worker, the offscreen document and the UI is declared here with its request
 * and response shape. Both `send` and `on` are typed from that map, so a
 * renamed field or a handler that returns the wrong shape is a compile error
 * rather than an `as` cast that lies at runtime.
 */

import type {
  AddonSpec,
  DirectJob,
  MediaItem,
  PageContext,
  Settings,
  StreamJob,
  TabJobs,
} from '../core/types';
import { api } from '../platform';

export interface Messages {
  /* content script and page hook into the background */
  'dom:media': { req: { items: RawItem[]; page?: PageContext }; res: void };
  'hook:media': { req: { url: string; source?: string; blob?: boolean }; res: void };
  'api:body': { req: { url: string; body: string }; res: void };
  /*
   * A page whose data is rendered into the HTML rather than fetched. The
   * content script only sends this when the document actually contains one of
   * the markers, because the alternative is sending every page ever visited.
   */
  'doc:html': { req: { url: string; html: string }; res: void };
  'addons:markers': { req: void; res: { markers: string[] } };
  'drm:seen': { req: { tabId?: number }; res: void };

  /* panel into the background */
  'media:list': { req: { tabId: number }; res: { items: MediaItem[] } };
  'media:clear': { req: { tabId: number }; res: void };
  'settings:get': { req: void; res: Settings };
  'settings:set': { req: Partial<Settings>; res: Settings };
  'addons:list': { req: void; res: { builtin: AddonSpec[]; user: AddonSpec[] } };
  'jobs:get': { req: { tabId: number }; res: TabJobs };
  'download:direct': { req: { items: MediaItem[] }; res: { queued: number } };
  'download:stream': { req: { item: MediaItem }; res: { jobId: string } };
  'job:cancel': { req: { id: string }; res: void };

  /* background into the offscreen document or the panel page */
  'assemble:start': {
    req: {
      jobId: string;
      url: string;
      kind: 'hls' | 'dash';
      concurrency: number;
      filename: string;
    };
    res: void;
  };
  'assemble:cancel': { req: { jobId: string }; res: void };
  /*
   * The offscreen document announces itself once its listeners exist. Work
   * posted before that is dropped, because nothing is listening yet.
   */
  'offscreen:ready': { req: void; res: void };

  /* the assembler reporting back */
  'assemble:progress': { req: { jobId: string; progress: number; detail?: string }; res: void };
  'assemble:done': { req: { jobId: string; blobUrl: string; filename: string }; res: void };
  'assemble:failed': { req: { jobId: string; error: string }; res: void };

  'font:ttf:done': {
    req: { id: string; blobUrl?: string; filename: string; error?: string };
    res: void;
  };
}

export type MessageName = keyof Messages;

interface Envelope<K extends MessageName> {
  to: K;
  payload: Messages[K]['req'];
}

let listenerInstalled = false;

/**
 * Narrows an incoming message rather than asserting it.
 *
 * A message from another extension context is `unknown` until it is checked.
 * The payload has to be an object, or the message did not come from this
 * contract and is dropped. The name needs no check of its own: the handler
 * table below is the declaration of what this build answers, and an unknown
 * name finds nothing there.
 */
function isEnvelope(raw: unknown): raw is { to: MessageName; payload: unknown } {
  if (typeof raw !== 'object' || raw === null) return false;
  const { to, payload } = raw as { to?: unknown; payload?: unknown };
  /*
   * A message declared `req: void` travels with no payload at all, so absent is
   * as valid as an object. Requiring an object here silently dropped every such
   * message, which took the panel's settings with it.
   */
  return (
    typeof to === 'string' &&
    (payload === undefined || (typeof payload === 'object' && payload !== null))
  );
}

interface Reply {
  ok: boolean;
  value?: unknown;
  error?: string;
}

function isReply(raw: unknown): raw is Reply {
  return typeof raw === 'object' && raw !== null && 'ok' in raw;
}

function installListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;

  api.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (!isEnvelope(raw)) return false;

    const handler = handlers.get(raw.to);
    if (!handler) return false;

    try {
      const result = handler(raw.payload as never, sender);
      if (result === undefined) {
        sendResponse({ ok: true });
        return false;
      }
      Promise.resolve(result).then(
        (value) => sendResponse({ ok: true, value }),
        (error: unknown) => sendResponse({ ok: false, error: String(error) }),
      );
      return true;
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
      return false;
    }
  });
}

const handlers = new Map<
  MessageName,
  (payload: never, sender: chrome.runtime.MessageSender) => unknown
>();

/** Fire and forget. A send with no listener is normal, not an error. */
export function post<K extends MessageName>(to: K, payload: Messages[K]['req']): void {
  try {
    const sending = api.runtime.sendMessage({ to, payload } satisfies Envelope<K>);
    void Promise.resolve(sending).catch(() => {
      /* no receiver, or the context was torn down mid-send */
    });
  } catch {
    /* extension context invalidated */
  }
}

export function request<K extends MessageName>(
  to: K,
  payload: Messages[K]['req'],
): Promise<Messages[K]['res']> {
  return new Promise((resolve, reject) => {
    try {
      api.runtime.sendMessage({ to, payload } satisfies Envelope<K>, (response: unknown) => {
        const lastError = api.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!isReply(response) || !response.ok) {
          reject(new Error((isReply(response) ? response.error : undefined) ?? 'no response'));
          return;
        }
        resolve(response.value as Messages[K]['res']);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function on<K extends MessageName>(
  to: K,
  handler: (
    payload: Messages[K]['req'],
    sender: chrome.runtime.MessageSender,
  ) => Messages[K]['res'] | void | Promise<Messages[K]['res']>,
): void {
  handlers.set(
    to,
    handler as (payload: never, sender: chrome.runtime.MessageSender) => unknown,
  );
  installListener();
}

/* Payload shapes that travel before they become MediaItems. */

export interface RawItem {
  url: string;
  tag?: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  name?: string;
  section?: string;
}

export type { DirectJob, StreamJob };
