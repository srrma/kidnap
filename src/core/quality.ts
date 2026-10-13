/**
 * Turning many sightings of the same thing into one row.
 *
 * The same file arrives from several detectors, and one post arrives at
 * several resolutions. The first case is dedupe. The second is a group: one row
 * carrying a quality picker, because a user deciding to save a video wants the
 * best copy offered once, not four rows that look like duplicates.
 */

import type { MediaItem, MediaVariant, SortMode } from './types';
import { canonical, parse } from './url';

export function pixels(item: { width?: number; height?: number }): number {
  if (!item.width || !item.height) return 0;
  return item.width * item.height;
}

/**
 * Reduces a raw sighting list to the rows to show. Later sightings of the same
 * URL merge into the first rather than replacing it, so the richest metadata
 * wins and the ordering the detectors produced is respected.
 */
export function consolidate(items: readonly MediaItem[]): MediaItem[] {
  const byUrl = new Map<string, MediaItem>();

  for (const item of items) {
    const key = canonical(item.url);
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...item });
      continue;
    }
    byUrl.set(key, merge(existing, item));
  }

  const groups = new Map<string, MediaItem[]>();
  const rows: MediaItem[] = [];

  for (const item of byUrl.values()) {
    if (item.groupId) {
      const members = groups.get(`group:${item.groupId}`);
      if (members) members.push(item);
      else groups.set(`group:${item.groupId}`, [item]);
      continue;
    }

    /*
     * An add-on can say two sightings are one post. Failing that, the URL
     * sometimes says it: one picture served at six sizes differs from itself in
     * a single path segment that names a rendition, and nothing else.
     */
    const identity = renditionIdentity(item.url);
    if (identity === null) {
      rows.push(item);
      continue;
    }
    const members = groups.get(`rendition:${identity}`);
    if (members) members.push(item);
    else groups.set(`rendition:${identity}`, [item]);
  }

  for (const members of groups.values()) {
    rows.push(pickBest(members));
  }

  return rows;
}

function merge(base: MediaItem, incoming: MediaItem): MediaItem {
  const merged: MediaItem = { ...base };
  const fields = merged as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === '') continue;
    if (fields[key] === undefined || fields[key] === '') fields[key] = value;
  }
  /* A later sighting proves the media is not protected, so it clears the flag. */
  if (base.protected && !incoming.protected) {
    merged.protected = false;
    merged.protectedReason = undefined;
  }
  return merged;
}

/**
 * The row shown for a group is its best member, carrying the rest as variants.
 * Ordering is stable so the picker does not reshuffle between renders.
 *
 * Bitrate is compared before file size because renditions of one post usually
 * share their dimensions and differ only in bitrate. Ranking on size first
 * would hand the user the 256k rendition as the default and bury the 2M one.
 */
function pickBest(members: MediaItem[]): MediaItem {
  const sorted = [...members].sort((a, b) => {
    const byPixels = pixels(b) - pixels(a);
    if (byPixels !== 0) return byPixels;
    const byBitrate = (b.bitrate ?? 0) - (a.bitrate ?? 0);
    if (byBitrate !== 0) return byBitrate;
    return (b.bytes ?? 0) - (a.bytes ?? 0);
  });

  const [best, ...rest] = sorted;
  if (!best) throw new Error('a group always has at least one member');

  if (rest.length === 0) return { ...best };

  const variants: MediaVariant[] = sorted.map((member) => ({
    url: member.url,
    width: member.width,
    height: member.height,
    bitrate: member.bitrate,
    codecs: member.codecs,
  }));

  return { ...best, variants };
}

/**
 * Path segments that name a rendition rather than identify a thing.
 *
 * Closed on purpose. "One segment differs" on its own is not enough to call two
 * URLs the same file: `/users/alice/avatar.jpg` and `/users/bob/avatar.jpg`
 * differ in exactly one segment and are obviously two different people. What
 * separates them is that the differing segment here means nothing you could
 * guess, whereas the ones here mean exactly one thing.
 */
const RENDITION =
  /^(?:\d+|\d+[_-][a-z0-9]+|\d+x\d*|(?:max|min)_?\d+(?:_[a-z]+)?|originals?|large|medium|small|thumb|thumbnail|preview|full|raw|src|hd|sd)$/i;

/**
 * A key under which the renditions of one file are known to agree, or null
 * when the URL does not speak to it.
 *
 * Null is the common answer, and deliberately so. A path qualifies only when it
 * contains exactly one segment from the list above; two of them means the
 * guessing has stopped being reliable, and none means there is no rendition
 * structure to read at all. Those URLs fall back to comparing exactly, which
 * was correct before any of this and stays correct now.
 */
export function renditionIdentity(url: string): string | null {
  const parsed = parse(url);
  if (!parsed) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const marks = segments.filter((segment) => RENDITION.test(segment));
  if (marks.length !== 1) return null;

  const key = segments.map((segment) => (RENDITION.test(segment) ? '*' : segment)).join('/');
  return `${parsed.host}${parsed.pathname.startsWith('/') ? '' : '/'}${key}`;
}

const comparators: Record<SortMode, (a: MediaItem, b: MediaItem) => number> = {
  recent: (a, b) => b.foundAt - a.foundAt,
  size: (a, b) => (b.bytes ?? 0) - (a.bytes ?? 0),
  resolution: (a, b) => pixels(b) - pixels(a) || (b.bytes ?? 0) - (a.bytes ?? 0),
  name: (a, b) => (a.name ?? a.url).localeCompare(b.name ?? b.url),
};

export function sortItems(items: readonly MediaItem[], mode: SortMode): MediaItem[] {
  return [...items].sort(comparators[mode]);
}

/** Total bytes across a selection, for the copy that says what will be saved. */
export function totalBytes(items: readonly MediaItem[]): number {
  return items.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
}
