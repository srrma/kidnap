/**
 * The two download paths.
 *
 * A direct file is handed to chrome.downloads and forgotten. A segmented
 * stream has to be assembled first, which means a job with states, progress
 * and a cancel, and it has to survive the panel being closed, so on Chromium
 * it runs in an offscreen document and on Firefox, which has no offscreen
 * document, in the panel page itself.
 */

import { on, post } from '../bus/protocol';
import { buildFilename } from '../core/filename';
import { jobId } from '../core/hash';
import type { DirectJob, MediaItem, Settings, StreamJob } from '../core/types';
import { api, supportsOffscreen } from '../platform';
import { load } from '../store/settings';
import * as store from '../store/tab';

let creatingOffscreen: Promise<void> | null = null;

/**
 * The offscreen document is the only context that survives the panel closing,
 * so a long assembly keeps going. Chrome allows exactly one per extension,
 * which is why creation is shared rather than per job.
 */
let offscreenAnnounced = false;
let waitingForOffscreen: Array<() => void> = [];

on('offscreen:ready', () => {
  offscreenAnnounced = true;
  for (const wake of waitingForOffscreen) wake();
  waitingForOffscreen = [];
});

/**
 * Resolves once the offscreen document says its listeners exist.
 *
 * Creating the document returns before its script has run, so work posted
 * straight afterwards is dropped: there is nothing listening for it yet. The
 * wait is capped so a document that fails to announce itself is a slow job
 * rather than a job that never starts.
 */
function whenOffscreenReady(): Promise<void> {
  if (offscreenAnnounced) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const wake = (): void => resolve();
    waitingForOffscreen.push(wake);
    setTimeout(wake, 1500);
  });
}

async function ensureOffscreen(): Promise<void> {
  if (!supportsOffscreen()) return;
  const exists = await api.offscreen.hasDocument?.();
  if (exists) {
    await whenOffscreenReady();
    return;
  }

  creatingOffscreen ??= api.offscreen
    .createDocument({
      url: api.runtime.getURL('offscreen/index.html'),
      reasons: [api.offscreen.Reason.BLOBS],
      justification: 'Producing a downloadable file from a stream or a web font',
    })
    .finally(() => {
      creatingOffscreen = null;
    });

  await creatingOffscreen;
  offscreenAnnounced = false;
  await whenOffscreenReady();
}

/* ── Direct files ────────────────────────────────────────────────────────── */

async function enqueueDirect(items: MediaItem[], settings: Settings): Promise<number> {
  const tabId = items[0]?.tabId;
  if (tabId === undefined) return 0;

  const jobs = await store.jobs(tabId);
  const added: DirectJob[] = items.map((item, offset) => ({
    id: jobId('dl'),
    itemId: item.id,
    url: item.url,
    filename: buildFilename(
      item,
      settings.filenameTemplate,
      settings.folder,
      jobs.direct.length + offset + 1,
    ),
    kind: item.kind,
    state: 'queued',
  }));

  await store.writeJobs(
    tabId,
    store.pruneJobs({ ...jobs, direct: [...jobs.direct, ...added] }),
  );
  void start(tabId);
  return added.length;
}

async function start(tabId: number): Promise<void> {
  const jobs = await store.jobs(tabId);
  const next = jobs.direct.find((job) => job.state === 'queued');
  if (!next) return;

  await update(tabId, { ...next, state: 'running' });

  try {
    const downloadId = await api.downloads.download({
      url: next.url,
      filename: next.filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    await update(tabId, (job) => (job.id === next.id ? { ...job, downloadId } : job));
  } catch (error) {
    await update(tabId, (job) =>
      job.id === next.id ? { ...job, state: 'failed', error: describeError(error) } : job,
    );
  }
}

api.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (!state || !delta.id) return;

  void (async () => {
    for (const tabId of await tabsWithJobs()) {
      const jobs = await store.jobs(tabId);
      const match = jobs.direct.find((job) => job.downloadId === delta.id);
      if (!match) continue;
      const next: Partial<DirectJob> =
        state === 'complete'
          ? { state: 'done' }
          : { state: 'failed', error: delta.error?.current ?? 'Interrupted' };
      await update(tabId, { ...match, ...next });
      void start(tabId);
      return;
    }
  })();
});

/* ── Streams ─────────────────────────────────────────────────────────────── */

async function enqueueStream(item: MediaItem, settings: Settings): Promise<string> {
  const tabId = item.tabId;
  const kind = item.url.includes('.mpd') ? 'dash' : 'hls';
  const job: StreamJob = {
    id: jobId('st'),
    itemId: item.id,
    url: item.url,
    filename: buildFilename(item, settings.filenameTemplate, settings.folder, 1).replace(
      /\.[^.]+$/,
      '.mp4',
    ),
    kind,
    state: 'queued',
    progress: 0,
  };

  const jobs = await store.jobs(tabId);
  await store.writeJobs(tabId, store.pruneJobs({ ...jobs, streams: [...jobs.streams, job] }));

  await ensureOffscreen();
  post('assemble:start', {
    jobId: job.id,
    url: job.url,
    kind,
    concurrency: settings.concurrency,
    filename: job.filename,
  });

  return job.id;
}

async function onAssembleProgress(
  jobIdValue: string,
  progress: number,
  detail?: string,
): Promise<void> {
  await updateStream(jobIdValue, { state: 'fetching', progress, detail });
}

async function onAssembleDone(id: string, blobUrl: string, filename: string): Promise<void> {
  const job = await findStream(id);
  if (!job) return;
  try {
    await api.downloads.download({ url: blobUrl, filename, conflictAction: 'uniquify' });
    await updateStream(id, { state: 'done', progress: 1, detail: filename });
  } catch (error) {
    await updateStream(id, { state: 'failed', error: describeError(error) });
  }
}

async function onAssembleFailed(id: string, error: string): Promise<void> {
  await updateStream(id, { state: 'failed', error });
}

/* ── Job bookkeeping ─────────────────────────────────────────────────────── */

async function update(
  tabId: number,
  next: DirectJob | ((job: DirectJob) => DirectJob),
): Promise<void> {
  const jobs = await store.jobs(tabId);
  const direct = jobs.direct.map((job) => {
    if (typeof next === 'function') return next(job);
    return job.id === next.id ? next : job;
  });
  await store.writeJobs(tabId, { ...jobs, direct });
}

async function updateStream(id: string, changes: Partial<StreamJob>): Promise<void> {
  const tabId = await tabOf(id);
  if (tabId === undefined) return;
  const jobs = await store.jobs(tabId);
  const streams = jobs.streams.map((job) => (job.id === id ? { ...job, ...changes } : job));
  await store.writeJobs(tabId, { ...jobs, streams });
}

async function findStream(id: string): Promise<StreamJob | undefined> {
  const tabId = await tabOf(id);
  if (tabId === undefined) return undefined;
  const jobs = await store.jobs(tabId);
  return jobs.streams.find((job) => job.id === id);
}

async function tabOf(id: string): Promise<number | undefined> {
  for (const tabId of await tabsWithJobs()) {
    const jobs = await store.jobs(tabId);
    if (jobs.streams.some((job) => job.id === id)) return tabId;
  }
  return undefined;
}

/** Tabs that currently have a job key written. */
async function tabsWithJobs(): Promise<number[]> {
  const all = await api.storage.session.get(null);
  return Object.keys(all)
    .filter((key) => key.startsWith('j:'))
    .map((key) => Number(key.slice(2)))
    .filter((tabId) => Number.isInteger(tabId));
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

export function wireJobs(): void {
  void (async () => {
    on('download:direct', async ({ items }) => {
      const settings = await load();
      return { queued: await enqueueDirect(items, settings) };
    });

    on('download:stream', async ({ item }) => {
      const settings = await load();
      return { jobId: await enqueueStream(item, settings) };
    });

    on('job:cancel', async ({ id }) => {
      const job = await findStream(id);
      if (job) {
        await updateStream(id, { state: 'canceled' });
        post('assemble:cancel', { jobId: id });
        return;
      }
      for (const tabId of await tabsWithJobs()) {
        const jobs = await store.jobs(tabId);
        const direct = jobs.direct.find((entry) => entry.id === id);
        if (direct?.downloadId !== undefined) {
          await api.downloads.cancel(direct.downloadId).catch(() => {});
          await update(tabId, { ...direct, state: 'canceled' });
          return;
        }
      }
    });

    on('assemble:progress', (payload) =>
      onAssembleProgress(payload.jobId, payload.progress, payload.detail),
    );
    on('assemble:done', (payload) =>
      onAssembleDone(payload.jobId, payload.blobUrl, payload.filename),
    );
    on('assemble:failed', (payload) => onAssembleFailed(payload.jobId, payload.error));
  })();
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const text = String(error);
  return text.includes('ETELEMETRY') ? 'The site refused the connection' : text;
}
