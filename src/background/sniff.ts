/**
 * Passive network observation.
 *
 * The listener only observes. It never blocks, never rewrites and never
 * returns a blocking response, so nothing on the page changes behavior
 * because Kidnap is installed. Response headers are requested with
 * extraHeaders so the content type is the real one rather than the
 * CORS-filtered version.
 *
 * webRequest is used rather than declarativeNetRequest because detection needs
 * to read values that DNR deliberately keeps out of the extension's reach.
 */

import { hasKnownExtension } from '../core/kind';
import type { Settings } from '../core/types';
import { fileNameFromDisposition, headerValue, parseIntOr } from '../core/url';
import { isMuted, type Report } from './ingest';

/** Content types worth a closer look, for servers that hide behind octet-stream. */
const INTERESTING = [
  'image/',
  'video/',
  'audio/',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'application/dash+xml',
  'application/pdf',
  'application/vnd.ms-sstr+xml',
];

/** Response headers that mean the bytes are encrypted and cannot be saved. */
const PROTECTED_TYPES = [
  'application/drm',
  'application/vnd.ms-playready',
  'application/vnd.apple.mpegurl+cenc',
];

export function inspect(
  details: chrome.webRequest.OnHeadersReceivedDetails,
  settings: Settings,
): Report | null {
  if (details.tabId < 0) return null;
  if (isMuted(details.url, settings)) return null;

  const contentType = headerValue(details.responseHeaders, 'content-type');
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';

  if (PROTECTED_TYPES.some((prefix) => type.startsWith(prefix))) {
    return {
      url: details.url,
      detector: 'network',
      mime: contentType,
      name: 'Protected content',
    };
  }

  const interesting = INTERESTING.some((prefix) => type.startsWith(prefix));
  if (!interesting && !hasKnownExtension(details.url)) return null;

  const disposition = headerValue(details.responseHeaders, 'content-disposition');

  return {
    url: details.url,
    detector: 'network',
    mime: contentType,
    bytes: parseIntOr(headerValue(details.responseHeaders, 'content-length')),
    name: fileNameFromDisposition(disposition) ?? fileNameOfPath(details.url),
    etag: headerValue(details.responseHeaders, 'etag'),
    lastModified: headerValue(details.responseHeaders, 'last-modified'),
  };
}

/**
 * A file extension worth keeping even when the server sends a generic type.
 * JSON is deliberately absent: every site fetches configuration for itself,
 * and listing settings.json beside the actual media is worse than missing it.
 */
function fileNameOfPath(url: string): string | undefined {
  try {
    const name = new URL(url).pathname.split('/').pop();
    return name || undefined;
  } catch {
    return undefined;
  }
}
