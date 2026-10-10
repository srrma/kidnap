/**
 * A stand-in for the extension APIs, backed by plain maps.
 *
 * Enough of chrome.storage and chrome.runtime to exercise the code that
 * matters: async storage, change events, and a message bus that crosses
 * contexts. Tests register it on globalThis before importing the module under
 * test, because src/platform.ts resolves the API once at import time.
 */

type Listener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string,
) => void;

export interface FakeChrome {
  storage: {
    session: ReturnType<typeof area>;
    sync: ReturnType<typeof area>;
    local: ReturnType<typeof area>;
    onChanged: { addListener: (fn: Listener) => void };
  };
  runtime: {
    lastError?: { message: string };
    sendMessage: (message: unknown, callback?: (response: unknown) => void) => Promise<unknown>;
    onMessage: { addListener: (fn: MessageListener) => void };
  };
  /** Test helper: deliver a message to the listeners that are registered. */
  dispatch: (message: unknown) => Promise<unknown>;
  /** Test helper: force the next storage read to fail. */
  failNextRead: () => void;
}

export type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

function area(
  emit: (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area: string,
  ) => void,
  name: string,
) {
  const data = new Map<string, unknown>();
  let failRead = false;
  return {
    async get(keys?: string | string[] | null) {
      if (failRead) {
        failRead = false;
        throw new Error('storage read failed');
      }
      if (keys === undefined || keys === null) return Object.fromEntries(data);
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) {
        if (data.has(key)) out[key] = data.get(key);
      }
      return out;
    },
    async set(values: Record<string, unknown>) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: data.get(key), newValue: value };
        data.set(key, value);
      }
      emit(changes, name);
    },
    async remove(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of list) {
        changes[key] = { oldValue: data.get(key), newValue: undefined };
        data.delete(key);
      }
      emit(changes, name);
    },
    clear() {
      data.clear();
    },
    failOnce() {
      failRead = true;
    },
  };
}

export function createChrome(): FakeChrome {
  const listeners: MessageListener[] = [];
  const changeListeners: Listener[] = [];

  const emit = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string,
  ) => {
    for (const fn of changeListeners) fn(changes, areaName);
  };

  const chrome: FakeChrome = {
    storage: {
      session: area(emit, 'session'),
      sync: area(emit, 'sync'),
      local: area(emit, 'local'),
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    runtime: {
      sendMessage: (message, callback) => {
        return Promise.resolve(chrome.dispatch(message)).then((response) => {
          callback?.(response);
          return response;
        });
      },
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
    dispatch: (message) =>
      new Promise((resolve) => {
        let settled = false;
        const sendResponse = (response: unknown) => {
          if (settled) return;
          settled = true;
          resolve(response);
        };
        const kept = listeners.map((fn) => fn(message, { id: 'fake' }, sendResponse));
        if (!kept.includes(true)) sendResponse({ ok: false, error: 'no listener' });
      }),
    failNextRead: () => {
      (chrome.storage.session as unknown as { failOnce: () => void }).failOnce();
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = chrome;
  return chrome;
}
