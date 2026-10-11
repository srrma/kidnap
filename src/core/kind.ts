import type { MediaKind } from './types';

/**
 * One table decides what a URL or content type is. Anything that classifies
 * media imports it here, because two tables that classify media will drift.
 */

const EXTENSIONS: Record<string, MediaKind> = {
  jpg: 'image',
  jpeg: 'image',
  jfif: 'image',
  png: 'image',
  apng: 'image',
  webp: 'image',
  gif: 'image',
  avif: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  tif: 'image',
  tiff: 'image',
  heic: 'image',
  heif: 'image',

  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  mkv: 'video',
  mov: 'video',
  avi: 'video',
  wmv: 'video',
  flv: 'video',
  mpeg: 'video',
  mpg: 'video',
  ogv: 'video',
  '3gp': 'video',

  mp3: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  oga: 'audio',
  opus: 'audio',
  wav: 'audio',
  flac: 'audio',
  wma: 'audio',
  aiff: 'audio',
  mka: 'audio',

  m3u8: 'stream',
  m3u: 'stream',
  mpd: 'stream',
  m4s: 'stream',
  cmfv: 'stream',
  cmfa: 'stream',

  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  odt: 'document',
  ods: 'document',
  odp: 'document',
  rtf: 'document',
  csv: 'document',
  tsv: 'document',
  txt: 'document',
  epub: 'document',
  mobi: 'document',
  azw3: 'document',

  woff2: 'font',
  woff: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
};

/** Prefixes are checked in order, so the first match wins. */
const CONTENT_TYPES: readonly (readonly [string, MediaKind])[] = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
  ['application/vnd.apple.mpegurl', 'stream'],
  /* x.com sends application/x-mpegURL, which is neither the Apple nor the
     audio spelling everyone else copies. */
  ['application/x-mpegurl', 'stream'],
  ['audio/mpegurl', 'stream'],
  ['audio/x-mpegurl', 'stream'],
  ['application/dash+xml', 'stream'],
  ['application/vnd.ms-sstr+xml', 'stream'],
  ['application/pdf', 'document'],
  ['text/csv', 'document'],
  ['text/plain', 'document'],
  ['application/msword', 'document'],
  ['application/rtf', 'document'],
  ['application/epub+zip', 'document'],
  ['application/vnd.oasis.opendocument', 'document'],
  ['application/vnd.openxmlformats-officedocument', 'document'],
  ['application/vnd.ms-', 'document'],
  /* Adobe serves font files from an extensionless path, so the content type is
     the only thing that identifies them. */
  ['font/', 'font'],
  ['application/font-woff', 'font'],
  ['application/font-sfnt', 'font'],
  ['application/font-ttf', 'font'],
  ['application/x-font-ttf', 'font'],
  ['application/x-font-opentype', 'font'],
  ['application/vnd.ms-fontobject', 'font'],
  ['application/font-woff2', 'font'],
];

const MANIFEST = /\.m3u8?$|\.mpd$|\.m4s$|\.cmf[av]$/i;

const ANY_KIND = new RegExp(`\\.(?:${Object.keys(EXTENSIONS).join('|')})(?:$|[?#])`, 'i');

/**
 * Whether a path ends in a known media, document or font extension.
 *
 * Derived from EXTENSIONS so that adding an extension here adds it everywhere.
 * The three detectors that carry this list separately drift apart within a
 * release, and a detector that does not recognise a file type is a detector
 * that silently misses it.
 */
export function hasKnownExtension(url: string): boolean {
  return ANY_KIND.test(safePath(url) ?? url);
}

/** Extensions worth matching even without a dot separator, e.g. /path/x.mp4/. */
export function extensionOf(url: string): string | null {
  const path = safePath(url);
  if (path === null) return null;
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : null;
}

function safePath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function kindByExtension(url: string): MediaKind | null {
  const ext = extensionOf(url);
  return ext ? (EXTENSIONS[ext] ?? null) : null;
}

export function kindByContentType(contentType: string | undefined): MediaKind | null {
  if (!contentType) return null;
  const value = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  for (const [prefix, kind] of CONTENT_TYPES) {
    if (value.startsWith(prefix)) return kind;
  }
  return null;
}

/**
 * The content type wins when it says something, because a server knows its own
 * payload better than a file name does. `?format=jpg` on an extensionless path
 * is common enough to be worth a look.
 */
export function classify(url: string, contentType?: string): MediaKind | null {
  return kindByContentType(contentType) ?? kindByExtension(url);
}

export function isManifestUrl(url: string): boolean {
  return MANIFEST.test(safePath(url) ?? url);
}

/** Stream segments are never listed on their own. They are noise. */
export function isSegmentUrl(url: string): boolean {
  const ext = extensionOf(url);
  return ext === 'm4s' || ext === 'ts' || ext === 'cmfv' || ext === 'cmfa';
}

/** Mime string to hand the download and preview layers, guessed from the URL. */
export function guessMime(url: string): string | undefined {
  const ext = extensionOf(url);
  if (!ext) return undefined;
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    jfif: 'image/jpeg',
    png: 'image/png',
    apng: 'image/apng',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    heic: 'image/heic',
    heif: 'image/heif',
    mp4: 'video/mp4',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    '3gp': 'video/3gpp',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/opus',
    wav: 'audio/wav',
    flac: 'audio/flac',
    mka: 'audio/x-matroska',
    m3u8: 'application/vnd.apple.mpegurl',
    mpd: 'application/dash+xml',
    m4s: 'video/iso.segment',
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    txt: 'text/plain',
    json: 'application/json',
    xml: 'application/xml',
    woff2: 'font/woff2',
    woff: 'font/woff',
    ttf: 'font/ttf',
    otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
  };
  return table[ext];
}
