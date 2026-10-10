/**
 * Poster frames for video rows.
 *
 * A list of videos with no picture is a list of colored rectangles, and the
 * whole point of the panel is telling whether something is the file you meant.
 *
 * Three constraints shape the design:
 *
 * 1. Cost is paid only when a row is actually on screen. Generating a frame for
 *    a two thousand item feed would mean decoding two thousand videos.
 * 2. Decoders are a limited resource. Chrome refuses to keep too many video
 *    elements alive at once, and each one holds a decoded buffer, so
 *    generation is pooled rather than fired all at once.
 * 3. A canvas can only be read back for media the server marked readable. A
 *    CDN without permissive headers taints the frame, and there is no honest
 *    way around that, so the row keeps its badge.
 *
 * Nothing here is persisted. A poster is a derived view of a file the user can
 * already download, and writing it to disk would cost more than it saves.
 */

/** Chrome keeps a bounded number of WebMediaPlayers; two keeps it happy. */
const MAX_PARALLEL = 2;

/** A video that has not produced a frame by now is not going to. */
const TIMEOUT_MS = 8000;

/** Poster edge in pixels, enough for a 44px tile at 2x. */
const EDGE = 128;

export type PosterSource = 'addon' | 'frame' | 'badge';

/**
 * Where a row's picture should come from, cheapest first.
 *
 * An add-on that already knows the poster URL costs nothing and works on
 * every CDN, so it always wins over decoding.
 */
export function posterSource(item: {
  kind: string;
  protected?: boolean;
  thumbnail?: string;
}): PosterSource {
  if (item.kind !== 'video') return 'badge';
  if (item.protected) return 'badge';
  if (item.thumbnail) return 'addon';
  return 'frame';
}

const cache = new Map<string, string>();
const failed = new Set<string>();
const waiting = new Map<string, Array<() => void>>();

let active = 0;
const queue: Array<() => void> = [];

function pump(): void {
  while (active < MAX_PARALLEL && queue.length > 0) {
    const next = queue.shift();
    next?.();
  }
}

/** A poster already produced, if there is one. Never triggers work. */
export function cached(url: string): string | undefined {
  return cache.get(url);
}

export function hasFailed(url: string): boolean {
  return failed.has(url);
}

/**
 * Requests a poster, calling back only if one arrives that is not already
 * cached. Generation is queued, so calling this for two hundred visible rows
 * still decodes two at a time.
 */
export function request(url: string, onReady: () => void): void {
  if (cache.has(url) || failed.has(url)) return;

  const waitingFor = waiting.get(url);
  if (waitingFor) {
    waitingFor.push(onReady);
    return;
  }
  waiting.set(url, [onReady]);

  queue.push(() => {
    void generate(url).finally(pump);
  });
  pump();
}

async function generate(url: string): Promise<void> {
  active += 1;
  const done = (poster: string | null): void => {
    if (poster) cache.set(url, poster);
    else failed.add(url);

    const listeners = waiting.get(url) ?? [];
    waiting.delete(url);
    for (const listener of listeners) listener();
  };

  try {
    const poster = await capture(url);
    done(poster);
  } catch {
    done(null);
  } finally {
    active -= 1;
  }
}

/**
 * Loads just enough of the video to decode one frame, then draws it.
 *
 * The frame is taken a little way in rather than at zero, because the very
 * first frame is very often black.
 */
function capture(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), TIMEOUT_MS);

    /*
     * Asking for CORS-clean media is the only way the canvas stays readable.
     * A CDN that does not send the header fails the load instead, which lands
     * in the same place as a tainted canvas: no poster, badge stays.
     */
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    video.addEventListener('error', () => finish(null), { once: true });
    video.addEventListener(
      'loadeddata',
      () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = duration > 0 ? Math.min(1, duration * 0.1) : 0;
      },
      { once: true },
    );
    video.addEventListener(
      'seeked',
      () => {
        try {
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (width === 0 || height === 0) {
            finish(null);
            return;
          }
          const scale = Math.min(1, EDGE / Math.max(width, height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const context = canvas.getContext('2d');
          if (!context) {
            finish(null);
            return;
          }
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => finish(blob ? URL.createObjectURL(blob) : null),
            'image/webp',
            0.72,
          );
        } catch {
          /* a tainted canvas throws here, which is the expected CDN case */
          finish(null);
        }
      },
      { once: true },
    );

    video.src = url;
  });
}

/**
 * Object URLs outlive the rows that used them, so they are released at once.
 * The caller owns the lifecycle hook; this module stays importable outside a
 * document so its policy can be tested.
 */
export function releaseAll(): void {
  for (const poster of cache.values()) URL.revokeObjectURL(poster);
  cache.clear();
  waiting.clear();
  queue.length = 0;
  failed.clear();
  active = 0;
}
