/**
 * URL handling. Two rules drive everything here:
 *
 * 1. The query string is never stripped. CDN and API media URLs carry
 *    time-limited tokens in the query, and a "cleaned" URL that 401s is worse
 *    than an ugly one that works.
 * 2. Host matching is label aware. `endsWith('twitter.com')` also matches
 *    `eviltwitter.com`, which is how a detector ends up trusting a stranger.
 */

/** Identity key for dedupe: the URL minus its fragment, nothing else. */
export function canonical(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

export function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function hostOf(url: string): string | null {
  return parse(url)?.hostname.toLowerCase() ?? null;
}

/** Host without a leading "www.", for display and filename templates. */
export function displayHost(url: string): string {
  const host = hostOf(url);
  if (!host) return 'unknown';
  return host.replace(/^www\./, '');
}

/**
 * Registrable-ish host match. A pattern of "example.com" matches example.com
 * and any subdomain. A pattern starting with "*." matches subdomains only,
 * which is what an API host usually wants.
 */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return h.endsWith(`.${base}`) && h.length > base.length + 1;
  }
  return h === p || h.endsWith(`.${p}`);
}

export function hostMatchesAny(host: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => hostMatches(host, pattern));
}

/**
 * Path prefix match on a real boundary.
 *
 * "/i/api" must match "/i/api/graphql" but not "/i/apifoo", so a prefix ending
 * in a word character gains an implied slash. A prefix that already ends in a
 * separator, such as "/xrpc/app.bsky.feed." or "/v1/", matches literally.
 */
const cache = new Map<string, RegExp>();

export function pathMatches(path: string, prefix: string): boolean {
  if (path === prefix) return true;
  let pattern = cache.get(prefix);
  if (!pattern) {
    const endsInWord = /[A-Za-z0-9]$/.test(prefix);
    pattern = new RegExp(
      `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${endsInWord ? '/' : ''}`,
    );
    cache.set(prefix, pattern);
  }
  return pattern.test(path);
}

export function fileNameOf(url: string): string | undefined {
  const path = parse(url)?.pathname;
  if (!path) return undefined;
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!name) return undefined;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * Origin used to mute a site. A host is the unit, not the full origin, so
 * muting example.com also covers its www form and every subdomain.
 */
export function originKey(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  return host.replace(/^www\./, '');
}

export function isRoutable(url: string): boolean {
  const parsed = parse(url);
  return !!parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
}

/** Bytes requested in a Range header. Such a request is never a whole file. */
export function isByteRange(url: string): boolean {
  return /[?&](?:bytes|bytestart|byteend|range)=/i.test(url);
}

export function hasExtensionInfo(url: string): boolean {
  const ext = parse(url)?.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  return ext !== undefined;
}

/**
 * Reads a width hint out of a URL. Resizing endpoints put the pixel size in the
 * path, and it is better than nothing when the server reported none.
 */
export function dimensionsFromUrl(url: string): { width?: number; height?: number } {
  const path = parse(url)?.pathname ?? '';
  const size = path.match(/(\d{2,5})[xX](\d{2,5})(?:\.\w+)?$/);
  if (size) return { width: Number(size[1]), height: Number(size[2]) };
  const height = path.match(/(?:^|[^\d])(\d{3,4})p(?:[^\d]|$)/);
  if (height) return { height: Number(height[1]) };
  return {};
}

/** Content-Disposition filename, preferring the RFC 5987 encoded form. */
export function fileNameFromDisposition(header: string | undefined): string | undefined {
  if (!header) return undefined;

  const utf8 = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      return utf8[1].trim();
    }
  }

  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain?.[1]?.trim() || undefined;
}

export function headerValue(
  headers: chrome.webRequest.HttpHeader[] | undefined,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  for (const header of headers ?? []) {
    if (header.name.toLowerCase() === wanted) return header.value ?? undefined;
  }
  return undefined;
}

export function parseIntOr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}
