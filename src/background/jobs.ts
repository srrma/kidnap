/**
 * The two download paths.
 *
 * A direct file is handed to chrome.downloads and forgotten. A segmented
 * stream has to be assembled first, which means a job with states, progress
 * and a cancel, and it has to survive the panel being closed, so on Chromium
 * it runs in an offscreen document and on Firefox, which has no offscreen
 * document, in the panel page itself.
 */

import { on, post, request } from '../bus/protocol';
import { buildFilename } from '../core/filename';
import { jobId } from '../core/hash';
import { classify } from '../core/kind';
import type { DirectJob, MediaItem, Settings, StreamChoice, StreamJob } from '../core/types';
import { fileNameOf } from '../core/url';
import { api, supportsOffscreen } from '../platform';
import { load } from '../store/settings';
import * as store from '../store/tab';

export interface JobContext {
  getSettings: () => Settings;
  post: typeof post;
}

let creatingOffscreen: Promise<void> | null = null;

/**
 * The offscreen document is the only context that survives the panel closing,
 * so a long assembly keeps going. Chrome allows exactly one per extension,
 * which is why creation is shared rather than per job.
 */
async function ensureOffscreen(): Promise<void> {
  if (!supportsOffscreen()) return;
  if (await api.offscreen.hasDocument?.()) return;

  creatingOffscreen ??= api.offscreen
    .createDocument({
      url: api.runtime.getURL('offscreen/index.html'),
      reasons: [api.offscreen.Reason.BLOBS],
      justification: 'Assembling a segmented media stream into a single file',
    })
    .finally(() => {
      creatingOffscreen = null;
    });

  await creatingOffscreen;
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

async function enqueueStream(
  item: MediaItem,
  settings: Settings,
  choice?: number,
): Promise<string> {
  const tabId = item.tabId;
  const kind = item.url.includes('.mpd') ? 'dash' : 'hls';
  const job: StreamJob = {
    id: jobId('st'),
    itemId: item.id,
    url: item.url,
    filename: buildFilename(item, settings.filenameTemplate, settings.folder, 1).replace(
      /\.[^.]+$/,
      kind === 'dash' ? '.mp4' : '.mp4',
    ),
    kind,
    state: 'queued',
    progress: 0,
    chosen: choice,
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

async function onAssembleChoices(id: string, choices: StreamChoice[]): Promise<void> {
  const job = await findStream(id);
  if (!job) return;
  if (choices.length <= 1) {
    post('assemble:choose', { jobId: id, index: 0 });
    return;
  }
  await updateStream(id, { state: 'choosing', choices });
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

export function wireJobs(context: JobContext): void {
  void (async () => {
    on('download:direct', async ({ items }) => {
      const settings = await load();
      return { queued: await enqueueDirect(items, settings) };
    });

    on('download:stream', async ({ item, choice }) => {
      const settings = await load();
      return { jobId: await enqueueStream(item, settings, choice) };
    });

    on('stream:choose', async ({ jobId: streamId, index }) => {
      post('assemble:choose', { jobId: streamId, index });
      await updateStream(streamId, { chosen: index });
    });

    on('job:cancel', async ({ id }) => {
      const job = await findStream(id);
      if (job) {
        await updateStream(id, { state: 'canceled' });
        post('assemble:choose', { jobId: id, index: -1 });
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
    on('assemble:choices', (payload) => onAssembleChoices(payload.jobId, payload.choices));
    on('assemble:done', (payload) =>
      onAssembleDone(payload.jobId, payload.blobUrl, payload.filename),
    );
    on('assemble:failed', (payload) => onAssembleFailed(payload.jobId, payload.error));

    void context;
  })();
}

/** Falls back to a name derived from the URL when a job has none. */
export function streamFilename(item: MediaItem, settings: Settings): string {
  const base = buildFilename(item, settings.filenameTemplate, settings.folder, 1);
  return classify(item.url) === 'stream' && base.endsWith('.bin')
    ? `${base.slice(0, -4)}.mp4`
    : (fileNameOf(item.url) ?? base);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const text = String(error);
  return text.includes('ETELEMETRY') ? 'The site refused the connection' : text;
}

export { request };
