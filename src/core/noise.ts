/**
 * Decides what is not worth showing. Every page loads trackers, sprite sheets,
 * spacers and stream segments, and a list of 400 of them is a list nobody reads.
 *
 * Three levels trade recall for signal. `relaxed` keeps almost everything and is
 * for people who want to see what the page actually requested. `strict` is for
 * people who want a short list of things worth saving.
 */

import { isSegmentUrl } from './kind';
import type { MediaKind, Strictness } from './types';
import { hostMatchesAny, isByteRange, parse } from './url';

export interface NoiseInput {
  url: string;
  kind: MediaKind | null;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

const TRACKER_HOSTS = [
  'doubleclick.net',
  'google-analytics.com',
  'googletagmanager.com',
  'quantserve.com',
  'scorecardresearch.com',
  'bat.bing.com',
  'connect.facebook.net',
];

const TRACKER_PATHS = [/\/(?:pixel|beacon|analytics|collect|impression|track)\b/i, /\/ping\b/i];

const FAVICON =
  /\/(?:favicon|apple-touch-icon|site\.webmanifest|android-chrome)(?:[-._@][\w-]+)?\.(?:ico|png|svg|jpg|jpeg|webp|gif)/i;

/** Below this, an image is a spacer, a rule, or a bullet, not a picture. */
const MIN_EDGE_PX = 16;

/** Below this, a file is a failed request or an empty placeholder. */
const TINY_BYTES = 100;

/**
 * Size floors in bytes. Vector art legitimately compresses far harder than
 * raster, so svg gets its own, much lower, threshold at every level.
 */
const IMAGE_FLOOR: Record<Strictness, { raster: number; vector: number }> = {
  relaxed: { raster: 0, vector: 0 },
  balanced: { raster: 2 * 1024, vector: 512 },
  strict: { raster: 8 * 1024, vector: 2 * 1024 },
};

export function isNoise(input: NoiseInput, level: Strictness, minImageBytes = 0): boolean {
  const { url, kind, mime, bytes, width, height } = input;
  const lowerMime = (mime ?? '').toLowerCase();

  /* Unusable sources, at every level. */
  if (!url) return true;
  if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('javascript:')) {
    return true;
  }

  /* A tracker or a range request is never the file the user meant. */
  const parsed = parse(url);
  if (!parsed) return true;
  if (hostMatchesAny(parsed.hostname, TRACKER_HOSTS)) return true;
  if (FAVICON.test(parsed.pathname)) return true;
  if (isByteRange(url)) return true;

  /* A 1x1 spacer, or anything too small to be worth opening. */
  const tooSmall =
    width !== undefined &&
    height !== undefined &&
    (width < MIN_EDGE_PX || height < MIN_EDGE_PX);
  if (tooSmall) return true;

  /*
   * A user minimum is their own decision, so it applies at every level and
   * cannot be short-circuited by picking relaxed.
   */
  if (kind === 'image' && minImageBytes > 0 && bytes !== undefined && bytes < minImageBytes) {
    return true;
  }

  if (level === 'relaxed') return false;

  if (TRACKER_PATHS.some((pattern) => pattern.test(parsed.pathname))) return true;
  if (isSegmentUrl(url)) return true;
  if (bytes !== undefined && bytes > 0 && bytes < TINY_BYTES) return true;

  /* A mime that disagrees with the extension means one of them is a lie. */
  const ext = extensionOfPath(parsed.pathname);
  if (lowerMime.startsWith('image/') && ext && !IMAGE_EXT.has(ext)) return true;
  if (lowerMime.startsWith('video/') && ext && !VIDEO_EXT.has(ext)) return true;
  if (lowerMime.startsWith('audio/') && ext && !AUDIO_EXT.has(ext)) return true;

  /* No usable extension and no useful mime: we cannot even name the file. */
  if (!ext && !lowerMime && level === 'strict') return true;

  if (kind === 'image' && bytes !== undefined) {
    const floor = lowerMime.includes('svg')
      ? IMAGE_FLOOR[level].vector
      : IMAGE_FLOOR[level].raster;
    if (floor > 0 && bytes < floor) return true;
  }

  if (level === 'strict') {
    if (bytes !== undefined && bytes < 1024) return true;
    if (width === undefined && bytes === undefined) return true;
  }

  return false;
}

function extensionOfPath(pathname: string): string | null {
  const name = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return name.slice(dot + 1).toLowerCase();
}

const IMAGE_EXT = new Set([
  'jpg',
  'jpeg',
  'jfif',
  'png',
  'apng',
  'webp',
  'gif',
  'avif',
  'svg',
  'bmp',
  'ico',
  'tif',
  'tiff',
  'heic',
  'heif',
]);
const VIDEO_EXT = new Set([
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'avi',
  'wmv',
  'flv',
  'mpeg',
  'mpg',
  'ogv',
  '3gp',
]);
const AUDIO_EXT = new Set([
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'flac',
  'wma',
  'aiff',
  'mka',
]);
