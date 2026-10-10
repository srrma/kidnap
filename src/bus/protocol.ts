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
  StreamChoice,
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
  'download:stream': { req: { item: MediaItem; choice?: number }; res: { jobId: string } };
  'job:cancel': { req: { id: string }; res: void };
  'stream:choose': { req: { jobId: string; index: number }; res: void };

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
  'assemble:choose': { req: { jobId: string; index: number }; res: void };
  /*
   * The offscreen document announces itself once its listeners exist. Work
   * posted before that is dropped, because nothing is listening yet.
   */
  'offscreen:ready': { req: void; res: void };

  /* the assembler reporting back */
  'assemble:progress': { req: { jobId: string; progress: number; detail?: string }; res: void };
  'assemble:choices': { req: { jobId: string; choices: StreamChoice[] }; res: void };
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

function installListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;

  api.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const envelope = raw as Partial<Envelope<MessageName>>;
    if (typeof envelope?.to !== 'string') return false;

    const handler = handlers.get(envelope.to);
    if (!handler) return false;

    try {
      const result = handler(envelope.payload as never, sender);
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
        const envelope = response as
          | { ok?: boolean; value?: unknown; error?: string }
          | undefined;
        if (!envelope?.ok) {
          reject(new Error(envelope?.error ?? 'no response'));
          return;
        }
        resolve(envelope.value as Messages[K]['res']);
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
