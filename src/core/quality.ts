/**
 * Turning many sightings of the same thing into one row.
 *
 * The same file arrives from several detectors, and one post arrives at
 * several resolutions. The first case is dedupe. The second is a group: one row
 * carrying a quality picker, because a user deciding to save a video wants the
 * best copy offered once, not four rows that look like duplicates.
 */

import type { MediaItem, MediaVariant, SortMode } from './types';
import { canonical } from './url';

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
    if (!item.groupId) {
      rows.push(item);
      continue;
    }
    const members = groups.get(item.groupId);
    if (members) members.push(item);
    else groups.set(item.groupId, [item]);
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
    bitrate: member.bytes,
    codecs: member.codecs,
  }));

  return { ...best, variants };
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
