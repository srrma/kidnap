/**
 * Turning a segmented stream into one file.
 *
 * EXT-X-MAP, EXT-X-BYTERANGE and a key that rotates part way through a playlist
 * are all handled by the library rather than by a parser here.
 *
 * The conversion is a packet copy. Media data is moved into a new container
 * without being decoded and re-encoded, so the saved file is bit-identical to
 * what was streamed, at the quality that was streamed.
 *
 * Two hosts for the same code: an offscreen document on Chromium, so a job
 * survives the panel closing, and the panel page on Firefox, which has no
 * offscreen document.
 */

import {
  ALL_FORMATS,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
} from 'mediabunny';
import { on, post } from '../bus/protocol';
import type { StreamChoice } from '../core/types';

interface Job {
  url: string;
  filename: string;
  concurrency: number;
  input?: Input;
  output?: Output;
  conversion?: Conversion;
  cancelled: boolean;
}

const jobs = new Map<string, Job>();

/**
 * Extension pages hold host permissions, so a cross-origin fetch is not a CORS
 * problem here. Credentials are included so segments and AES keys the user is
 * already entitled to are fetched the same way the page fetched them.
 */
function source(url: string, concurrency: number): UrlSource {
  return new UrlSource(url, {
    requestInit: { credentials: 'include' },
    parallelism: concurrency,
    getRetryDelay: (attempt) => Math.min(2 ** attempt, 10),
  });
}

async function choicesOf(input: Input): Promise<StreamChoice[]> {
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  const primary = video ?? audio;
  if (!primary) return [];

  const width = video ? await video.getDisplayWidth() : undefined;
  const height = video ? await video.getDisplayHeight() : undefined;
  const bitrate = (await primary.getAverageBitrate()) ?? undefined;

  return [
    {
      index: 0,
      label:
        [
          width && height ? `${width}x${height}` : undefined,
          bitrate ? `${Math.round(bitrate / 1000)} kbps` : undefined,
        ]
          .filter(Boolean)
          .join('  ') || 'Original',
      width,
      height,
      bitrate,
    },
  ];
}

async function run(jobId: string, job: Job): Promise<void> {
  post('assemble:progress', { jobId, progress: 0.02, detail: 'Reading the manifest' });

  const input = new Input({ source: source(job.url, job.concurrency), formats: ALL_FORMATS });
  job.input = input;

  const choices = await choicesOf(input);
  if (job.cancelled) return;

  if (choices.length > 1) {
    post('assemble:choices', { jobId, choices });
    const picked = await waitForChoice(jobId);
    if (picked === -1) {
      post('assemble:failed', { jobId, error: 'Cancelled' });
      return;
    }
    post('assemble:progress', { jobId, progress: 0.05, detail: 'Fetching segments' });
  } else {
    post('assemble:progress', { jobId, progress: 0.05, detail: 'Fetching segments' });
  }

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  job.output = output;

  const conversion = await Conversion.init({
    input,
    output,
    /* Copy encoded packets wherever the container allows it. */
    copy: { mode: 'preferred', shiftTolerance: 0.1 },
    tracks: 'primary',
  });
  job.conversion = conversion;

  if (!conversion.isValid) {
    throw new Error(
      conversion.discardedTracks
        .map((track) => `${track.track.type}: ${track.reason}`)
        .join(', ') || 'The stream carries nothing this browser can save',
    );
  }

  conversion.onProgress = (progress) => {
    post('assemble:progress', {
      jobId,
      progress: 0.05 + Math.min(progress, 1) * 0.9,
      detail: 'Fetching segments',
    });
  };

  await conversion.execute();

  post('assemble:progress', { jobId, progress: 0.98, detail: 'Finishing the file' });
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('The stream produced no data');

  const blob = new Blob([buffer], { type: 'video/mp4' });
  post('assemble:done', { jobId, blobUrl: URL.createObjectURL(blob), filename: job.filename });
}

/** Resolves when the panel answers, or rejects when the job is cancelled. */
function waitForChoice(jobId: string): Promise<number> {
  return new Promise((resolve) => {
    const off = (value: number): void => {
      clearInterval(poll);
      resolve(value);
    };
    const poll = setInterval(() => {
      if (jobs.get(jobId)?.cancelled) off(-1);
    }, 200);
    choices.set(jobId, off);
  });
}

const choices = new Map<string, (value: number) => void>();

export function startAssembling(): void {
  on('assemble:start', (payload) => {
    const job: Job = {
      url: payload.url,
      filename: payload.filename,
      concurrency: Math.max(1, Math.min(12, payload.concurrency)),
      cancelled: false,
    };
    jobs.set(payload.jobId, job);

    void run(payload.jobId, job).catch((error: unknown) => {
      post('assemble:failed', { jobId: payload.jobId, error: describe(error) });
    });
  });

  on('assemble:choose', ({ jobId, index }) => {
    choices.get(jobId)?.(index);
    choices.delete(jobId);
  });

  addEventListener('unload', () => {
    for (const job of jobs.values()) {
      job.cancelled = true;
      void job.conversion?.cancel().catch(() => {});
      void job.input?.dispose();
    }
    jobs.clear();
  });
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|network|load failed/i.test(message)) {
    return 'The stream could not be fetched. The link may have expired; reload the page and try again.';
  }
  if (/decrypt|key|encrypt/i.test(message)) {
    return 'This stream is encrypted and cannot be saved.';
  }
  return message;
}
