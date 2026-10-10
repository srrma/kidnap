/**
 * The add-on engine.
 *
 * An add-on is data, never code. It cannot call a function, cannot reach a
 * network of its own, and cannot run in the page. All it can do is say which
 * hosts to watch and which paths inside a JSON response hold a media URL. That
 * is a real limit, and it is what lets a user paste an add-on from a forum post
 * without the extension taking on their trust.
 */

import { classify, guessMime } from '../core/kind';
import type {
  AddonSpec,
  ConditionSpec,
  MediaItem,
  MediaSpec,
  RewriteSpec,
  RuleSpec,
  UrlTemplate,
} from '../core/types';
import { hostMatches, hostMatchesAny, parse, pathMatches } from '../core/url';
import { pluck, read, readNumber, readString, type Scope } from './paths';

/** What a rule yields before it becomes a stored item. */
export interface Candidate {
  url: string;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  label?: string;
  duration?: number;
  bitrate?: number;
  codecs?: string;
  groupId?: string;
  thumbnail?: string;
  title?: string;
  author?: string;
  album?: string;
  track?: string;
  caption?: string;
  alt?: string;
  published?: string;
  postId?: string;
  postUrl?: string;
}

export class AddonRegistry {
  #byId = new Map<string, AddonSpec>();

  constructor(specs: readonly AddonSpec[] = []) {
    for (const spec of specs) this.add(spec);
  }

  /** A user add-on with the same id replaces the built-in it shadows. */
  add(spec: AddonSpec): void {
    this.#byId.set(spec.id, spec);
  }

  addAll(specs: readonly AddonSpec[]): void {
    for (const spec of specs) this.add(spec);
  }

  remove(id: string): void {
    this.#byId.delete(id);
  }

  get size(): number {
    return this.#byId.size;
  }

  list(): AddonSpec[] {
    return [...this.#byId.values()];
  }

  /** Host and path pairs worth intercepting, for the page-world hook. */
  watchTable(): Array<[host: string, paths: string[]]> {
    return this.list()
      .filter((spec) => spec.apiPaths && spec.apiPaths.length > 0)
      .flatMap((spec) =>
        spec.hosts.map((host) => [host, spec.apiPaths ?? []] as [string, string[]]),
      );
  }

  /**
   * Whether a response body is worth parsing against the rule set.
   *
   * `apiPaths` narrows what is read. An add-on that omits it watches every
   * path on its hosts, which is the sensible reading of an optional field and
   * is what makes a small user add-on practical to write.
   */
  handles(url: string): boolean {
    const parsed = parse(url);
    if (!parsed) return false;
    return this.list().some((spec) => claims(spec, parsed));
  }

  /**
   * Every registered rewrite, applied to any URL.
   *
   * Rewrites are deliberately global rather than scoped to the add-on that
   * declared them. An add-on that exists only to upgrade a CDN URL has no
   * rules to match, and scoping the rewrite to rules that produced the URL
   * would mean such an add-on could never do its one job.
   */
  rewrite(url: string): string {
    const rewrites = this.list().flatMap((spec) => spec.rewrite ?? []);
    return rewrites.length > 0 ? applyRewrite(url, rewrites) : url;
  }

  /**
   * Runs every matching add-on against one response body. A failing rule is
   * skipped rather than allowed to take down the others.
   */
  extract(url: string, body: unknown, tabId: number, now = Date.now()): MediaItem[] {
    const parsed = parse(url);
    if (!parsed || typeof body !== 'object' || body === null) return [];

    const items: MediaItem[] = [];

    for (const spec of this.#byId.values()) {
      if (!claims(spec, parsed)) continue;
      items.push(...runRules(spec, body, tabId, now, (url) => this.rewrite(url)));
    }

    return items;
  }

  /**
   * Reads a response that is a web page rather than an API payload.
   *
   * Sites like Adobe Fonts have no public JSON endpoint for their catalogue,
   * so they render the whole thing into a script tag in the page itself. An
   * add-on that declares `embedded` says where the JSON starts and ends; the
   * text in between is parsed and the rules run against it exactly as if it
   * had arrived as a normal response body.
   */
  extractText(url: string, text: string, tabId: number, now = Date.now()): MediaItem[] {
    const parsed = parse(url);
    if (!parsed) return [];

    const items: MediaItem[] = [];

    for (const spec of this.#byId.values()) {
      if (!claims(spec, parsed) || !spec.embedded) continue;
      const body = cutEmbedded(text, spec.embedded);
      if (!body) continue;
      items.push(...runRules(spec, body, tabId, now, (url) => this.rewrite(url)));
    }

    return items;
  }

  /**
   * Whether a document is worth handing over as text. Callers use this to avoid
   * shipping a whole page across the wire for every site visited.
   */
  wantsDocument(url: string): boolean {
    const parsed = parse(url);
    if (!parsed) return false;
    return this.list().some((spec) => spec.embedded && claims(spec, parsed));
  }

  /** Every embedded marker, so a page can be checked without sending it. */
  documentMarkers(): string[] {
    return this.list().flatMap((spec) => (spec.embedded ? [spec.embedded.start] : []));
  }
}

/**
 * Cuts the JSON out of a page and parses it.
 *
 * A start marker with no end marker means the page is not the one the rule was
 * written against, which happens every time a site redesigns. Returning null
 * is the whole error handling: the caller skips this add-on and carries on.
 */
function cutEmbedded(text: string, marker: { start: string; end: string }): unknown | null {
  const from = text.indexOf(marker.start);
  if (from === -1) return null;
  const to = text.indexOf(marker.end, from + marker.start.length);
  if (to === -1) return null;
  try {
    return JSON.parse(text.slice(from, to));
  } catch {
    return null;
  }
}

function runRules(
  spec: AddonSpec,
  body: unknown,
  tabId: number,
  now: number,
  rewrite: (url: string) => string,
): MediaItem[] {
  const items: MediaItem[] = [];
  for (const rule of spec.rules) {
    for (const scope of pluck(body, rule.at)) {
      try {
        const candidate = build(scope, rule.media);
        if (!candidate) continue;
        candidate.url = rewrite(candidate.url);
        const item = toItem(candidate, tabId, now);
        if (item) items.push(item);
      } catch {
        /* one malformed payload must not stop the rest */
      }
    }
  }
  return items;
}

/**
 * Whether one add-on claims a request. `handles` and `extract` must agree, so
 * there is one definition rather than two that can drift.
 *
 * `apiPaths` narrows what is read; leaving it out watches every path on the
 * add-on's hosts.
 */
function claims(spec: AddonSpec, parsed: URL): boolean {
  if (spec.rules.length === 0) return false;
  if (!hostMatchesAny(parsed.hostname, spec.hosts)) return false;
  if (spec.apiPaths === undefined) return true;
  return spec.apiPaths.some((prefix) => pathMatches(parsed.pathname, prefix));
}

function isTemplate(value: MediaSpec['url']): value is UrlTemplate {
  return typeof value === 'object' && value !== null && 'template' in value;
}

function build(scope: Scope, spec: MediaSpec): Candidate | null {
  if (spec.when && !holds(scope, spec.when)) return null;

  const url = isTemplate(spec.url) ? buildLink(scope, spec.url) : readString(scope, spec.url);
  if (!url) return null;

  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return null;

  const time = readTime(spec);

  return {
    url,
    mime: readString(scope, spec.mime) ?? guessMime(url),
    bytes: readNumber(scope, spec.bytes),
    width: readNumber(scope, spec.width),
    height: readNumber(scope, spec.height),
    label: readString(scope, spec.label),
    duration: toSeconds(readNumber(scope, spec.duration), time),
    bitrate: readNumber(scope, spec.bitrate),
    codecs: readString(scope, spec.codecs),
    groupId: readString(scope, spec.group),
    thumbnail: readString(scope, spec.thumbnail),
    title: readString(scope, spec.title),
    author: readString(scope, spec.author),
    album: readString(scope, spec.album),
    track: readString(scope, spec.track),
    caption: readString(scope, spec.caption),
    alt: readString(scope, spec.alt),
    published: toIso(readString(scope, spec.published), time),
    postId: readString(scope, spec.postId),
    postUrl: buildLink(scope, spec.postUrl),
  };
}

function holds(scope: Scope, condition: ConditionSpec): boolean {
  const value = read(scope, condition.path);
  const missing = value === undefined || value === null || value === '';

  if (condition.exists !== undefined) return condition.exists !== missing;
  if (condition.absent !== undefined) return condition.absent === missing;
  if (condition.equals !== undefined) return String(value) === String(condition.equals);
  if (condition.in !== undefined)
    return condition.in.some((entry) => String(entry) === String(value));
  return true;
}

function readTime(spec: MediaSpec): NonNullable<MediaSpec['timeFormat']> {
  return spec.timeFormat ?? 'iso';
}

/**
 * Values are inserted verbatim apart from characters that would break the
 * URL. Percent-encoding everything is wrong, because a Reddit permalink is
 * already a path and encoding it turns the slashes into %2F.
 */
function safeSegment(value: string): string {
  return value.replace(/[\s"'<>\\^`{|}]/g, '').replace(/[\r\n]/g, '');
}

function buildLink(scope: Scope, spec: UrlTemplate | undefined): string | undefined {
  if (!spec) return undefined;
  let built = spec.template;
  for (const [name, path] of Object.entries(spec.values)) {
    const value = readString(scope, path);
    /* A template with an unresolved placeholder is worse than no link. */
    if (!value) return undefined;
    built = built.replace(`{${name}}`, safeSegment(value));
  }
  return built;
}

/** Durations are always reported in seconds, whatever the source unit. */
function toSeconds(
  value: number | undefined,
  format: NonNullable<MediaSpec['timeFormat']>,
): number | undefined {
  if (value === undefined) return undefined;
  switch (format) {
    case 'epoch-millis':
      return value / 1000;
    case 'iso':
      /* An ISO string is not a duration; a bare number under `iso` is seconds. */
      return value;
    default:
      return value;
  }
}

function toIso(
  value: string | undefined,
  format: NonNullable<MediaSpec['timeFormat']>,
): string | undefined {
  if (!value) return undefined;

  switch (format) {
    case 'epoch-seconds':
    case 'seconds': {
      const date = new Date(Number(value) * 1000);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    case 'epoch-millis': {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    default: {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }
  }
}

function toItem(candidate: Candidate, tabId: number, foundAt: number): MediaItem | null {
  const kind = classify(candidate.url, candidate.mime);
  if (!kind) return null;
  return {
    id: '',
    url: candidate.url,
    kind,
    detector: 'addon',
    tabId,
    foundAt,
    mime: candidate.mime,
    bytes: candidate.bytes,
    width: candidate.width,
    height: candidate.height,
    label: candidate.label,
    duration: candidate.duration,
    bitrate: candidate.bitrate,
    codecs: candidate.codecs,
    thumbnail: candidate.thumbnail,
    groupId: candidate.groupId,
    name: candidate.title ?? candidate.track,
    author: candidate.author,
    album: candidate.album,
    track: candidate.track,
    caption: candidate.caption,
    alt: candidate.alt,
    published: candidate.published,
    postId: candidate.postId,
    pageUrl: candidate.postUrl,
  };
}

/**
 * CDN URLs often serve a better copy once asked properly. The spec says which
 * query parameters to force, which is enough for the common "?name=small" case
 * and cannot become an open redirect.
 */
export function applyRewrite(url: string, rules: readonly RewriteSpec[]): string {
  const parsed = parse(url);
  if (!parsed) return url;

  for (const rule of rules) {
    if (!hostMatches(parsed.hostname, rule.host)) continue;
    if (rule.pathPrefix && !pathMatches(parsed.pathname, rule.pathPrefix)) continue;
    for (const [key, value] of Object.entries(rule.setParams ?? {})) {
      parsed.searchParams.set(key, value);
    }
    for (const key of rule.removeParams ?? []) {
      parsed.searchParams.delete(key);
    }
  }

  return parsed.href;
}

/**
 * Rejects an add-on that could not work, so a bad paste degrades to one warning
 * rather than a rule that silently throws on every response.
 */
export function validateAddon(
  value: unknown,
): { ok: true; spec: AddonSpec } | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'an add-on must be a JSON object' };
  }
  const spec = value as Record<string, unknown>;

  if (typeof spec.id !== 'string' || spec.id.trim() === '') {
    return { ok: false, error: 'id must be a non-empty string' };
  }
  if (typeof spec.name !== 'string' || spec.name.trim() === '') {
    return { ok: false, error: 'name must be a non-empty string' };
  }
  if (!Array.isArray(spec.hosts) || spec.hosts.length === 0) {
    return { ok: false, error: 'hosts must be a non-empty array' };
  }
  if (spec.hosts.some((host) => typeof host !== 'string' || host.trim() === '')) {
    return { ok: false, error: 'every entry in hosts must be a non-empty string' };
  }
  if (spec.apiPaths !== undefined && !isStringArray(spec.apiPaths)) {
    return { ok: false, error: 'apiPaths must be an array of strings' };
  }
  if (!Array.isArray(spec.rules) || spec.rules.length === 0) {
    return { ok: false, error: 'rules must be a non-empty array' };
  }
  for (const rule of spec.rules) {
    const problem = validateRule(rule);
    if (problem) return { ok: false, error: problem };
  }
  if (spec.rewrite !== undefined && !Array.isArray(spec.rewrite)) {
    return { ok: false, error: 'rewrite must be an array' };
  }
  if (spec.embedded !== undefined) {
    const embedded = spec.embedded as Record<string, unknown>;
    if (
      typeof embedded !== 'object' ||
      embedded === null ||
      typeof embedded.start !== 'string' ||
      embedded.start === '' ||
      typeof embedded.end !== 'string' ||
      embedded.end === ''
    ) {
      return { ok: false, error: 'embedded needs a non-empty start and end' };
    }
  }

  return { ok: true, spec: value as AddonSpec };
}

function validateRule(rule: unknown): string | null {
  if (typeof rule !== 'object' || rule === null) return 'every rule must be an object';
  const typed = rule as Record<string, unknown>;
  if (typeof typed.at !== 'string' || typed.at.trim() === '') {
    return 'rule.at must be a non-empty string';
  }
  if (typeof typed.media !== 'object' || typed.media === null) {
    return 'rule.media must be an object';
  }
  const media = typed.media as Record<string, unknown>;
  return isUrlValue(media.url)
    ? null
    : 'rule.media.url must be a path, a literal, or a template';
}

/**
 * A url is either read straight off the payload or assembled from values that
 * are. An assembled one has to resolve every placeholder, otherwise the add-on
 * would fetch a URL with a literal `{kit}` in it.
 */
function isUrlValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value !== 'object' || value === null) return false;

  const { template, values } = value as { template?: unknown; values?: unknown };
  if (typeof template !== 'string' || template.trim() === '') return false;
  if (typeof values !== 'object' || values === null) return false;

  return Object.keys(values).every((name) => template.includes(`{${name}}`));
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Convenience for tests and for the panel's add-on preview. */
export function describeRule(rule: RuleSpec): string {
  return `${rule.at} -> ${rule.media.url}`;
}

export { pluck, read };
