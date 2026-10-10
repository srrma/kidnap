/**
 * Where detected media lives.
 *
 * One array per tab, rewritten on every single detection, is quadratic in
 * bytes for a linear amount of work. This store is also the most
 * concurrency-sensitive file in the extension, since the network sniffer, the
 * DOM scraper, the page hook and the context menu all write at once.
 *
 * The shape here fixes both. Each item is its own key, written once and never
 * rewritten. A per-tab index holds the hashes and is flushed on a short timer,
 * so a burst of 500 detections becomes a handful of writes instead of 500.
 * Reads are two round trips no matter how large the tab is: one for the index,
 * one for the items it names.
 *
 * Every mutation goes through here. A read-modify-write done anywhere else
 * would race with a detector and silently drop an item.
 */

import { hash64 } from '../core/hash';
import type { MediaItem, TabJobs } from '../core/types';
import { canonical } from '../core/url';
import { api } from '../platform';

const ITEM = 'm';
const INDEX = 'x';
const JOBS = 'j';
const SEP = ':';

function itemKey(tabId: number, hash: string): string {
  return `${ITEM}${SEP}${tabId}${SEP}${hash}`;
}

function indexKey(tabId: number): string {
  return `${INDEX}${SEP}${tabId}`;
}

function jobsKey(tabId: number): string {
  return `${JOBS}${SEP}${tabId}`;
}

export function tabPrefix(tabId: number): string {
  return `${SEP}${tabId}${SEP}`;
}

/** How long to sit on pending writes before flushing them as one batch. */
const FLUSH_MS = 150;

interface Pending {
  items: Map<string, MediaItem>;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
}

const pendingByTab = new Map<number, Pending>();
const hashesByTab = new Map<number, Set<string>>();
const queueByTab = new Map<number, Promise<unknown>>();

export function itemId(tabId: number, url: string): string {
  return `${tabId}${SEP}${hash64(canonical(url))}`;
}

export function hashOf(url: string): string {
  return hash64(canonical(url));
}

function pendingFor(tabId: number): Pending {
  let pending = pendingByTab.get(tabId);
  if (!pending) {
    pending = { items: new Map(), timer: null, flushing: null };
    pendingByTab.set(tabId, pending);
  }
  return pending;
}

/**
 * Serialises every operation on one tab. Two detectors reporting the same
 * image at the same moment must not both read the index, both decide it is
 * new, and both append.
 */
function serialise<T>(tabId: number, work: () => Promise<T>): Promise<T> {
  const previous = queueByTab.get(tabId) ?? Promise.resolve();
  const next = previous.then(work, work);
  queueByTab.set(
    tabId,
    next.catch(() => undefined),
  );
  return next;
}

/** Hydrates the dedupe set once per tab, then keeps it in step with writes. */
async function knownHashes(tabId: number): Promise<Set<string>> {
  let known = hashesByTab.get(tabId);
  if (known) return known;
  const stored = await api.storage.session.get(indexKey(tabId));
  const list = (stored[indexKey(tabId)] as string[] | undefined) ?? [];
  known = new Set(list);
  hashesByTab.set(tabId, known);
  return known;
}

/**
 * Records an item. Returns true when it was not already present, which is the
 * only signal the badge and the UI need.
 */
export function add(
  tabId: number,
  partial: Omit<MediaItem, 'id' | 'normalized'> & { normalized?: never },
): Promise<boolean> {
  return serialise(tabId, async () => {
    const known = await knownHashes(tabId);
    const hash = hash64(canonical(partial.url));
    if (known.has(hash)) return false;

    const item: MediaItem = { ...partial, id: `${tabId}${SEP}${hash}` };
    known.add(hash);

    const pending = pendingFor(tabId);
    pending.items.set(hash, item);
    schedule(tabId);
    return true;
  });
}

function schedule(tabId: number): void {
  const pending = pendingFor(tabId);
  if (pending.timer !== null) return;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    void serialise(tabId, () => flushNow(tabId));
  }, FLUSH_MS);
}

/**
 * Writes the pending batch: one call for the items, one for the index.
 *
 * The body runs on the tab's queue rather than inside it, because it can be
 * asked to run again while items are still arriving. Anything that needs a
 * flush queues behind it instead of calling it from within the queue.
 */
async function flushNow(tabId: number): Promise<void> {
  const pending = pendingFor(tabId);
  if (pending.timer !== null) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }
  if (pending.flushing) {
    await pending.flushing;
    if (pending.items.size > 0) return flushNow(tabId);
    return;
  }
  if (pending.items.size === 0) return;

  const batch = new Map(pending.items);
  pending.items.clear();

  pending.flushing = (async () => {
    const keys: Record<string, MediaItem> = {};
    for (const [hash, item] of batch) keys[itemKey(tabId, hash)] = item;
    await api.storage.session.set(keys);

    const stored = await api.storage.session.get(indexKey(tabId));
    const existing = (stored[indexKey(tabId)] as string[] | undefined) ?? [];
    await api.storage.session.set({ [indexKey(tabId)]: [...existing, ...batch.keys()] });
  })();

  try {
    await pending.flushing;
  } finally {
    pending.flushing = null;
  }
}

/** Forces pending writes out, so a reader in another context can see them. */
export function settle(tabId?: number): Promise<void> {
  if (tabId !== undefined) return serialise(tabId, () => flushNow(tabId));
  return Promise.all(
    [...pendingByTab.keys()].map((id) => serialise(id, () => flushNow(id))),
  ).then(() => undefined);
}

export async function list(tabId: number): Promise<MediaItem[]> {
  await settle(tabId);
  const index = await api.storage.session.get(indexKey(tabId));
  const hashes = (index[indexKey(tabId)] as string[] | undefined) ?? [];
  if (hashes.length === 0) return [];

  const stored = await api.storage.session.get(hashes.map((hash) => itemKey(tabId, hash)));
  const items: MediaItem[] = [];
  for (const hash of hashes) {
    const item = stored[itemKey(tabId, hash)] as MediaItem | undefined;
    if (item) items.push(item);
  }
  return items;
}

export async function count(tabId: number): Promise<number> {
  await settle(tabId);
  const index = await api.storage.session.get(indexKey(tabId));
  return ((index[indexKey(tabId)] as string[] | undefined) ?? []).length;
}

/**
 * Applies a change to one item. Only fields the detector actually improves are
 * written, so a re-report never blanks out metadata another channel supplied.
 */
export function patch(tabId: number, hash: string, changes: Partial<MediaItem>): Promise<void> {
  return serialise(tabId, async () => {
    await flushNow(tabId);
    const key = itemKey(tabId, hash);
    const stored = await api.storage.session.get(key);
    const current = stored[key] as MediaItem | undefined;
    if (!current) return;

    const next: MediaItem = { ...current };
    for (const [field, value] of Object.entries(changes)) {
      if (value === undefined || value === '') continue;
      (next as unknown as Record<string, unknown>)[field] = value;
    }
    await api.storage.session.set({ [key]: next });
  });
}

export function clear(tabId: number): Promise<void> {
  return serialise(tabId, async () => {
    const pending = pendingFor(tabId);
    if (pending.timer !== null) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    pending.items.clear();
    await pending.flushing;
    const index = await api.storage.session.get(indexKey(tabId));
    const hashes = (index[indexKey(tabId)] as string[] | undefined) ?? [];
    const keys = [
      indexKey(tabId),
      jobsKey(tabId),
      ...hashes.map((hash) => itemKey(tabId, hash)),
    ];
    await api.storage.session.remove(keys);
    hashesByTab.delete(tabId);
    pendingByTab.delete(tabId);
  });
}

/* Jobs live beside the items under their own key, so a media update never
   has to read and rewrite the download queue. */

const emptyJobs: TabJobs = { direct: [], streams: [] };

export async function jobs(tabId: number): Promise<TabJobs> {
  const stored = await api.storage.session.get(jobsKey(tabId));
  return (stored[jobsKey(tabId)] as TabJobs | undefined) ?? emptyJobs;
}

export function writeJobs(tabId: number, value: TabJobs): Promise<void> {
  return serialise(tabId, async () => {
    await api.storage.session.set({ [jobsKey(tabId)]: value });
  });
}

/** Terminal jobs are dropped so a long session cannot grow without bound. */
const KEEP_TERMINAL = 20;

export function pruneJobs(value: TabJobs): TabJobs {
  const terminal = (job: { state: string }) =>
    job.state === 'done' || job.state === 'failed' || job.state === 'canceled';
  const keep = <T extends { state: string }>(jobs: T[]): T[] => {
    const live = jobs.filter((job) => !terminal(job));
    const done = jobs.filter(terminal).slice(-KEEP_TERMINAL);
    return [...live, ...done];
  };
  return { direct: keep(value.direct), streams: keep(value.streams) };
}
