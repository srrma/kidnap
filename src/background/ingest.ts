/**
 * Turning whatever a detector reported into a stored MediaItem.
 *
 * Every channel funnels through here so that classification, the noise filter
 * and the metadata merge happen exactly once and in one order. A channel that
 * built its own item would be a second, disagreeing idea of what a detected
 * thing is.
 */

import { classify, guessMime, isManifestUrl } from '../core/kind';
import { isNoise } from '../core/noise';
import type { Detector, MediaItem, Settings } from '../core/types';
import { canonical, dimensionsFromUrl, displayHost, fileNameOf, originKey } from '../core/url';
import { hashOf } from '../store/tab';

export interface Report {
  url: string;
  detector: Detector;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  name?: string;
  alt?: string;
  title?: string;
  section?: string;
  etag?: string;
  lastModified?: string;
  pageUrl?: string;
  pageTitle?: string;

  /*
   * Only an add-on knows these. The network sniffer has no way to learn an
   * author or a caption, so they are absent for sniffed media and present for
   * add-on media.
   */
  author?: string;
  caption?: string;
  published?: string;
  postId?: string;
}

/**
 * @returns the item to store, or null when the URL is not media or is noise.
 */
export function build(
  report: Report,
  tabId: number,
  settings: Settings,
  now = Date.now(),
  rewrite: (url: string) => string = (url) => url,
): MediaItem | null {
  if (!report.url.startsWith('http')) return null;

  /*
   * The rewrite runs before anything is measured, because it can change the
   * extension and therefore both the kind and whether the URL looks like noise.
   */
  const url = rewrite(report.url);
  const mime = report.mime ?? guessMime(url);
  const kind = isManifestUrl(url) ? 'stream' : classify(url, mime);
  if (!kind) return null;

  const fromUrl = dimensionsFromUrl(url);
  const width = report.width ?? fromUrl.width;
  const height = report.height ?? fromUrl.height;

  if (
    isNoise(
      { url, kind, mime, bytes: report.bytes, width, height },
      settings.strictness,
      settings.minImageBytes,
    )
  ) {
    return null;
  }

  const name = report.name ?? fileNameOf(url);

  return {
    id: '',
    url,
    kind,
    detector: report.detector,
    tabId,
    foundAt: now,
    mime,
    bytes: report.bytes,
    width,
    height,
    name,
    alt: report.alt,
    author: report.author,
    caption: report.caption,
    published: report.published,
    postId: report.postId,
    pageUrl: report.pageUrl,
    pageTitle: report.pageTitle ?? report.title,
    etag: report.etag,
    lastModified: report.lastModified,
  };
}

/** A detector must stand down on a host the user has muted. */
export function isMuted(url: string, settings: Settings): boolean {
  const host = originKey(url);
  if (!host) return false;
  return settings.mutedHosts.some((muted) => host === muted || host.endsWith(`.${muted}`));
}

export function describe(item: MediaItem): string {
  return `${item.kind}:${displayHost(canonical(item.url))}:${hashOf(item.url)}`;
}
