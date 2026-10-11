/**
 * The content script orchestrator.
 *
 * It injects the page hook, runs the DOM sweep, and stays out of the way
 * afterwards. Everything it learns is forwarded to the background, which owns
 * all state, so this file holds no more than the diff set needed to avoid
 * resending URLs the background already has.
 */

import { BUILTIN_ADDONS } from '../addons/builtin';
import { post, request } from '../bus/protocol';
import { guessMime } from '../core/kind';
import type { Settings } from '../core/types';
import { api } from '../platform';
import { firstSweep, readPage, scrape } from './dom';

const RESCAN_MS = 600;

const seen = new Set<string>();
let settings: Settings | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;

/*
 * Injected into the page's own context at document_start, where there is no
 * <head> yet and the site is still rewriting the document.
 *
 * Three things bit here and are worth writing down:
 *
 * - Removing the script element right after appending it races the load. The
 *   element can go before the browser fetches it, so the hook silently never
 *   runs. It is removed on load instead, and only then.
 * - A single-frame page can replace its head after we inject, taking the hook
 *   with it. The hook guards against running twice, so injecting again is safe.
 * - document_start means documentElement but not head, so that is what we
 *   attach to.
 */
function injectHook(): void {
  try {
    const script = document.createElement('script');
    script.src = api.runtime.getURL('page-hook.js');
    script.async = false;
    script.dataset.kidnap = 'hook';
    script.addEventListener('load', () => script.remove(), { once: true });
    (document.head ?? document.documentElement).appendChild(script);
  } catch {
    /* a page with a strict policy may refuse the injection entirely */
  }
}

let hookReady = false;
let attempts = 0;

/** Keeps trying until the hook answers, then stops for good. */
function ensureHook(): void {
  if (hookReady || attempts >= 6) return;
  attempts += 1;
  injectHook();
  setTimeout(ensureHook, 250 * attempts);
}

function hostTable(): Array<{ host: string; paths: string[] }> {
  return BUILTIN_ADDONS.filter((spec) => spec.apiPaths?.length).map((spec) => ({
    host: spec.hosts[0] ?? '',
    paths: spec.apiPaths ?? [],
  }));
}

function handOverConfig(): void {
  window.postMessage({ source: 'kidnap', type: 'config', watch: hostTable() }, '*');
}

/*
 * The page hook announces itself when it loads, because it is injected at
 * document_start and therefore usually loads after this script has already run.
 * Answering the announcement is what makes the watch table arrive at all.
 */
let configSent = false;

function awaitHook(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; type?: string } | null;
    if (data?.source !== 'kidnap' || data.type !== 'ready') return;
    if (configSent) return;
    configSent = true;
    hookReady = true;
    handOverConfig();
  });
  ensureHook();
}

let documentOffered = false;

/**
 * Hands the page over as text, for the sites that render their data into the
 * HTML instead of fetching it.
 *
 * The check is done here rather than in the background because the markers are
 * cheap to test against a string the page already holds in memory, while
 * sending the document is not cheap at all: a font catalogue page is around
 * 400 KB of markup. Asking first and testing locally means a normal page costs
 * one small message and nothing more.
 */
async function offerDocument(): Promise<void> {
  if (documentOffered) return;
  try {
    const { markers } = await request('addons:markers', undefined);
    if (markers.length === 0) return;
    const html = document.documentElement?.outerHTML ?? '';
    if (!markers.some((marker) => html.includes(marker))) return;
    post('doc:html', { url: location.href, html });
    documentOffered = true;
  } catch {
    /* the background is not listening, or the page went away */
  }
}

function sweep(): void {
  const { items } = scrape(document, seen);
  if (items.length === 0) return;
  post('dom:media', { items, page: readPage(document) });
}

function scheduleSweep(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    sweep();
  }, RESCAN_MS);
}

function startObserver(): void {
  if (observer || !document.body) return;
  observer = new MutationObserver(scheduleSweep);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'src',
      'srcset',
      'href',
      'poster',
      'data-src',
      'data-original',
      'style',
      'content',
    ],
  });
}

/* The page hook runs in the page's own context and can only talk over
   postMessage. Incoming messages are validated rather than trusted, because
   the page can post anything it likes. */
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as {
    source?: string;
    type?: string;
    url?: string;
    body?: string;
  } | null;
  if (data?.source !== 'kidnap') return;

  if (data.type === 'media' && typeof data.url === 'string' && guessMime(data.url)) {
    post('hook:media', { url: data.url, source: 'hook' });
    return;
  }

  if (data.type === 'api' && typeof data.url === 'string' && typeof data.body === 'string') {
    post('api:body', { url: data.url, body: data.body });
    return;
  }

  /* A blob is a signal that the player assembled something. The real URL was
     already seen by the network sniffer, so the useful response is to rescan
     rather than to list something that cannot be downloaded. */
  if (data.type === 'blob') scheduleSweep();
});

/* EME: the page negotiated encryption, so anything it plays is protected. */
function watchEncryption(): void {
  for (const media of document.querySelectorAll('video,audio')) {
    const element = media as HTMLMediaElement & { mediaKeys?: unknown };
    element.addEventListener('encrypted', () => post('drm:seen', {}));
    if (element.mediaKeys) post('drm:seen', {});
  }
}

async function loadSettings(): Promise<void> {
  const stored = await api.storage.sync.get('kidnap:settings');
  settings = (stored['kidnap:settings'] as Settings | undefined) ?? null;
  if (!settings?.autoScroll) return;
  await autoScroll();
}

/**
 * Nudges a lazy-loading page into revealing more of itself. Off by default,
 * because scrolling a page the user is reading is rude.
 */
async function autoScroll(): Promise<void> {
  const step = Math.round(window.innerHeight * 0.9);
  let previous = -1;
  for (let i = 0; i < 40; i++) {
    const next = Math.min(window.scrollY + step, document.body.scrollHeight);
    if (next === previous) break;
    previous = next;
    window.scrollTo({ top: next, behavior: 'instant' });
    sweep();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function followNavigation(): void {
  let current = location.href;
  const check = (): void => {
    if (location.href === current) return;
    current = location.href;
    seen.clear();
    documentOffered = false;
    sweep();
    void offerDocument();
  };
  addEventListener('popstate', check);
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function patched(this: History, ...args: unknown[]) {
      const result = original.apply(this, args as never);
      check();
      return result;
    };
  }
}

injectHook();
awaitHook();

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      const first = firstSweep(document);
      for (const item of first.items) seen.add(item.url);
      if (first.items.length > 0) post('dom:media', { items: first.items, page: first.page });
      startObserver();
      watchEncryption();
      void loadSettings();
      void offerDocument();
      followNavigation();
    },
    { once: true },
  );
} else {
  const first = firstSweep(document);
  for (const item of first.items) seen.add(item.url);
  if (first.items.length > 0) post('dom:media', { items: first.items, page: first.page });
  startObserver();
  watchEncryption();
  void loadSettings();
  void offerDocument();
  followNavigation();
}
