/**
 * Every shape that crosses a process boundary lives here. One definition of
 * each is what makes the message bus type-safe end to end; a second copy is a
 * type that is allowed to disagree with the first.
 */

export type MediaKind = 'image' | 'video' | 'audio' | 'stream' | 'document' | 'font';

/** Which detector produced this row. Provenance, not identity. */
export type Detector = 'network' | 'dom' | 'addon';

export interface MediaVariant {
  url: string;
  width?: number;
  height?: number;
  bitrate?: number;
  codecs?: string;
}

export interface MediaItem {
  /** Stable within a tab: `${tabId}:${hash(canonical(url))}`. */
  id: string;
  url: string;
  kind: MediaKind;
  detector: Detector;
  tabId: number;

  name?: string;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  /** Non-numeric quality hint such as "1080p" or "HD". Display only. */
  label?: string;
  duration?: number;
  bitrate?: number;
  codecs?: string;
  thumbnail?: string;

  /** Quality variants of one logical post, collapsed into a single row. */
  groupId?: string;
  variants?: MediaVariant[];

  protected?: boolean;
  protectedReason?: string;

  pageUrl?: string;
  pageTitle?: string;
  postId?: string;
  author?: string;
  album?: string;
  track?: string;
  caption?: string;
  alt?: string;
  published?: string;

  etag?: string;
  lastModified?: string;

  foundAt: number;
}

export interface PageContext {
  url: string;
  title?: string;
  description?: string;
  author?: string;
  image?: string;
  published?: string;
}

/* Jobs */

export type DirectJobState = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface DirectJob {
  id: string;
  itemId: string;
  url: string;
  filename: string;
  kind: MediaKind;
  state: DirectJobState;
  /** chrome.downloads id, once handed off. */
  downloadId?: number;
  error?: string;
}

export type StreamStage =
  | 'queued'
  | 'probing'
  | 'choosing'
  | 'fetching'
  | 'muxing'
  | 'saving'
  | 'done'
  | 'failed'
  | 'canceled';

export interface StreamChoice {
  label: string;
  width?: number;
  height?: number;
  bitrate?: number;
  /** Index into the choice list reported by the probe. */
  index: number;
}

export interface StreamJob {
  id: string;
  itemId: string;
  url: string;
  filename: string;
  kind: 'hls' | 'dash';
  state: StreamStage;
  /** 0 to 1. */
  progress: number;
  detail?: string;
  error?: string;
  choices?: StreamChoice[];
  chosen?: number;
}

export interface TabJobs {
  direct: DirectJob[];
  streams: StreamJob[];
}

/* Settings */

export type Strictness = 'relaxed' | 'balanced' | 'strict';
export type SortMode = 'recent' | 'size' | 'resolution' | 'name';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  filenameTemplate: string;
  folder: string;
  concurrency: number;
  autoScroll: boolean;
  /** 0 disables the extra size gate on top of `strictness`. */
  minImageBytes: number;
  strictness: Strictness;
  sort: SortMode;
  theme: ThemeMode;
  /** Hosts where detection is suspended, e.g. "example.com". */
  mutedHosts: string[];
  /** Add-ons supplied by the user as JSON, applied over the built-ins. */
  userAddons: AddonSpec[];
}

/* Add-ons
 *
 * An add-on is pure JSON on purpose. A user can paste one into settings and it
 * works, and no add-on can execute code in the page. `at` selects values out of
 * an intercepted JSON API response; every other field names a path relative to
 * the matched value, or to an ancestor written `..name`.
 */

export interface AddonSpec {
  id: string;
  name: string;
  /** "example.com" matches example.com and every subdomain of it. */
  hosts: string[];
  /** URL path prefixes worth intercepting, e.g. "/i/api/". */
  apiPaths?: string[];
  /** Upgrade an intercepted URL to a better variant of the same file. */
  rewrite?: RewriteSpec[];
  /**
   * Some sites do not have an API to read; they render the data into the
   * HTML. This says where the JSON sits inside that HTML: the body is cut from
   * `start` up to `end`, and what remains is parsed as JSON and handed to the
   * rules like any other payload.
   */
  embedded?: { start: string; end: string };
  rules: RuleSpec[];
}

export interface RewriteSpec {
  host: string;
  pathPrefix?: string;
  setParams?: Record<string, string>;
  removeParams?: string[];
}

export interface RuleSpec {
  /** Dotted path with `[]` to fan out over arrays, e.g. "a.b[].variants[]". */
  at: string;
  /** Fields to read off the matched value. */
  media: MediaSpec;
}

/**
 * A field value is either a path into the response, or a fixed value for
 * something the response does not carry. Plenty of APIs hand out a video URL
 * with no declared type, so the mime has to be asserted by the rule.
 */
export type PathValue =
  | string
  /** A value the response does not carry, asserted by the rule. */
  | { literal: string }
  /** The final path segment of another value, e.g. the rkey inside an at:// uri. */
  | { last: string };

export interface ConditionSpec {
  /** Path read the same way as any media field. */
  path: string;
  equals?: string | number | boolean;
  in?: Array<string | number>;
  exists?: boolean;
  /** Matches when the value is absent. */
  absent?: boolean;
}

/**
 * Most media URLs are in the payload. Some have to be assembled from ids the
 * payload does carry, in which case each `{name}` in the template is replaced
 * by the value `values[name]` points at. A template with an unresolved
 * placeholder is rejected rather than fetched.
 */
export interface UrlTemplate {
  template: string;
  values: Record<string, PathValue>;
}

export interface MediaSpec {
  url: PathValue | UrlTemplate;
  /** The rule is skipped unless this holds, which is how one rule is kept
   *  from claiming media of a kind it was not written for. */
  when?: ConditionSpec;
  mime?: PathValue;
  bytes?: PathValue;
  width?: PathValue;
  height?: PathValue;
  label?: PathValue;
  duration?: PathValue;
  bitrate?: PathValue;
  codecs?: PathValue;
  /** Groups quality variants of one post so they collapse into one row. */
  group?: PathValue;
  thumbnail?: PathValue;
  title?: PathValue;
  author?: PathValue;
  album?: PathValue;
  track?: PathValue;
  caption?: PathValue;
  alt?: PathValue;
  published?: PathValue;
  postId?: PathValue;
  /**
   * Builds a permalink. Most platforms do not include a link to the post in
   * the payload, only the ids it is made of, so each `{name}` in the template
   * is replaced by the value `values[name]` points at.
   */
  postUrl?: { template: string; values: Record<string, PathValue> };
  /** How to read `published` and `duration`. */
  timeFormat?: 'iso' | 'epoch-seconds' | 'epoch-millis' | 'seconds';
}
