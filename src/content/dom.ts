/**
 * Reading media out of the document.
 *
 * The scrape is diffed against what has already been sent, so a page that
 * mutates constantly costs one message per new URL rather than a full resend
 * on every tick. On a long feed, a full resend every 500ms of activity is the
 * single most expensive thing this extension could do.
 */

import type { RawItem } from '../bus/protocol';
import { guessMime, hasKnownExtension } from '../core/kind';
import type { PageContext } from '../core/types';

const MEDIA_TAGS = 'img,video,audio,source,picture,track';
const LAZY_ATTRS = [
  'data-src',
  'data-original',
  'data-lazy-src',
  'data-url',
  'data-hi-res-src',
];

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

/** Attributes worth reading per element type. */
const SOURCES: Record<string, string[]> = {
  IMG: ['src', 'srcset', ...LAZY_ATTRS],
  VIDEO: ['src', 'poster', 'data-src'],
  AUDIO: ['src', 'data-src'],
  SOURCE: ['src', 'srcset'],
  A: ['href'],
  TRACK: ['src'],
};

export interface ScrapeResult {
  items: RawItem[];
  page: PageContext;
}

export function scrape(document: Document, seen: Set<string>): ScrapeResult {
  const items: RawItem[] = [];

  for (const element of document.querySelectorAll<HTMLElement>(MEDIA_TAGS)) {
    if (SKIP_TAGS.has(element.tagName)) continue;
    if (!element.isConnected) continue;
    collect(element, items, seen);
  }

  collectBackgroundImages(document, items, seen);
  collectMeta(document, items, seen);
  collectLinks(document, items, seen);

  return { items, page: readPage(document) };
}

function collect(element: HTMLElement, items: RawItem[], seen: Set<string>): void {
  const attrs = SOURCES[element.tagName] ?? [];
  for (const attr of attrs) {
    const value = element.getAttribute(attr);
    if (!value) continue;

    if (attr === 'srcset') {
      pushAll(parseSrcset(value, element), items, seen, element);
    } else if (attr.endsWith('href')) {
      /* Only links that clearly point at a file, not every anchor on the page. */
      if (looksLikeFile(value)) push(value, items, seen, element);
    } else {
      push(value, items, seen, element);
    }
  }

  const { width, height } = elementSize(element);
  if (items.length > 0) {
    for (const item of items.slice(-4)) {
      item.width ??= width;
      item.height ??= height;
    }
  }
}

function push(value: string, items: RawItem[], seen: Set<string>, element: HTMLElement): void {
  const url = resolve(value, element);
  if (!url || seen.has(url)) return;
  seen.add(url);
  items.push({
    url,
    tag: element.tagName.toLowerCase(),
    alt: element.getAttribute('alt') ?? element.getAttribute('aria-label') ?? undefined,
    title: element.getAttribute('title') ?? undefined,
    name: element.getAttribute('data-filename') ?? undefined,
    section: nearestHeading(element) ?? undefined,
  });
}

function pushAll(
  entries: Array<{ url: string; width?: number; height?: number }>,
  items: RawItem[],
  seen: Set<string>,
  element: HTMLElement,
): void {
  for (const entry of entries) {
    const before = items.length;
    push(entry.url, items, seen, element);
    const added = items[before];
    if (added) {
      added.width ??= entry.width;
      added.height ??= entry.height;
    }
  }
}

/** srcset entries with their width descriptors, largest last. */
function parseSrcset(
  value: string,
  base: Element,
): Array<{ url: string; width?: number; height?: number }> {
  const out: Array<{ url: string; width?: number; height?: number }> = [];
  for (const part of value.split(',')) {
    const [rawUrl, ...descriptors] = part.trim().split(/\s+/);
    if (!rawUrl) continue;
    const url = resolve(rawUrl, base);
    if (!url) continue;
    const entry: { url: string; width?: number; height?: number } = { url };
    for (const descriptor of descriptors) {
      const width = descriptor.match(/^(\d+)w$/);
      if (width) entry.width = Number(width[1]);
      const height = descriptor.match(/^(\d+)h$/);
      if (height) entry.height = Number(height[1]);
    }
    out.push(entry);
  }
  return out;
}

/**
 * CSS background images, read from the computed style. This is the only way to
 * see a sprite or a decorative image the markup never mentions.
 */
function collectBackgroundImages(
  document: Document,
  items: RawItem[],
  seen: Set<string>,
): void {
  for (const element of document.querySelectorAll<HTMLElement>('body *')) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (!style) continue;
    const value = style.backgroundImage;
    if (!value || value === 'none' || !value.includes('url(')) continue;

    for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const raw = match[1];
      if (!raw) continue;
      const url = resolve(raw, element);
      if (!url || seen.has(url)) continue;
      if (!guessMime(url)) continue;
      seen.add(url);
      items.push({ url, tag: 'css', alt: element.getAttribute('aria-label') ?? undefined });
    }
  }
}

function collectMeta(document: Document, items: RawItem[], seen: Set<string>): void {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[content]')) {
    const key = (
      meta.getAttribute('property') ??
      meta.getAttribute('name') ??
      ''
    ).toLowerCase();
    if (!/^(og:(image|video|audio)|twitter:(image|player:stream))$/.test(key)) continue;
    const content = meta.content;
    if (!content) continue;
    const url = resolve(content, meta);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({ url, tag: 'meta', name: key });
  }
}

function collectLinks(document: Document, items: RawItem[], seen: Set<string>): void {
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[download], a[href]')) {
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) continue;
    if (!anchor.hasAttribute('download') && !looksLikeFile(href)) continue;
    const url = resolve(href, anchor);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({ url, tag: 'a', alt: anchor.textContent?.trim().slice(0, 120) || undefined });
  }
}

/* A download link is often an archive rather than media, which is why zip is
   matched here and not in the shared extension table. */
const ARCHIVE = /\.zip(?:$|[?#])/i;

function looksLikeFile(value: string): boolean {
  const path = value.split('?')[0] ?? value;
  return hasKnownExtension(path) || ARCHIVE.test(path);
}

function resolve(value: string, base: Element): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) return null;
  try {
    const url = new URL(trimmed, base.ownerDocument.baseURI);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function elementSize(element: HTMLElement): { width?: number; height?: number } {
  if (element instanceof HTMLImageElement && element.naturalWidth > 0) {
    return { width: element.naturalWidth, height: element.naturalHeight };
  }
  const rect = element.getBoundingClientRect?.();
  if (rect && rect.width > 0)
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  const width = Number.parseInt(element.getAttribute('width') ?? '', 10);
  const height = Number.parseInt(element.getAttribute('height') ?? '', 10);
  return {
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
  };
}

/** The nearest preceding heading, which is usually a caption for the media. */
function nearestHeading(element: Element): string | null {
  let node: Element | null = element.parentElement;
  for (let depth = 0; node && depth < 6; depth++) {
    const heading = node.querySelector('h1,h2,h3,h4,h5,h6,figcaption');
    const text = heading?.textContent?.trim();
    if (text) return text.slice(0, 200);
    node = node.parentElement;
  }
  return null;
}

export function readPage(document: Document): PageContext {
  const meta = (selector: string): string | undefined =>
    document.querySelector<HTMLMetaElement>(selector)?.content ?? undefined;

  return {
    url: document.location?.href ?? '',
    title: document.title || meta('meta[property="og:title"]') || undefined,
    description: meta('meta[name="description"]') ?? meta('meta[property="og:description"]'),
    author: meta('meta[name="author"]') ?? meta('meta[property="article:author"]'),
    image: meta('meta[property="og:image"]'),
    published: meta('meta[property="article:published_time"]'),
  };
}

/** Walks the document once, for the first paint after load. */
export function firstSweep(document: Document): ScrapeResult {
  return scrape(document, new Set<string>());
}
