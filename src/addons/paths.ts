/**
 * Reading values out of an arbitrary JSON tree by path, without letting the
 * path escape the tree and without evaluating anything.
 *
 * The chain a match carries is the whole point. Each match carries only its own
 * ancestors, so a rule can read `^caption` and get the caption of the post that
 * actually contains the media, never a neighbour's. A single mutable set of
 * "current" variables cannot do this: a caption near the top of a feed response
 * would attach itself to a video found near the bottom.
 */

import type { PathValue } from '../core/types';

export type Scope = readonly unknown[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolves every position in `root` matching `path`.
 *
 * A segment ending in `[]` fans out over an array and produces one match per
 * element. Everything else descends a single level. Returns one ancestor chain
 * per match, leaf last.
 */
export function pluck(root: unknown, path: string): Scope[] {
  let scopes: Scope[] = [[root]];

  for (const segment of path.split('.')) {
    if (segment === '') continue;
    const fansOut = segment.endsWith('[]');
    const key = fansOut ? segment.slice(0, -2) : segment;
    const next: Scope[] = [];

    for (const scope of scopes) {
      const cursor = scope[scope.length - 1];
      const value = isRecord(cursor) ? cursor[key] : undefined;
      if (fansOut) {
        if (!Array.isArray(value)) continue;
        for (const element of value) next.push([...scope, element]);
      } else {
        next.push([...scope, value]);
      }
    }

    scopes = next;
    if (scopes.length === 0) return [];
  }

  return scopes;
}

/**
 * Reads a relative path from a match.
 *
 *   field.sub            descends from the matched value
 *   list[0]              indexes into an array
 *   ^sibling             steps out to the parent first
 *   /a.b.c               absolute, read from the response root (the separator
 *                         is always a dot, including after the slash)
 *
 * The caret exists because the separator is a dot, and "..name" would split
 * into pieces before anything could read it. The absolute form exists because a
 * real response often keeps the post in one branch and the media in another,
 * and no chain of ancestors can bridge two branches of a tree.
 */
export function read(scope: Scope, path: string): unknown {
  let level = scope.length - 1;
  let cursor: unknown = scope[level];

  const absolute = path.startsWith('/');
  let rest = path;
  if (absolute) {
    level = 0;
    cursor = scope[0];
    rest = path.slice(1);
  }

  for (const segment of rest.split('.')) {
    if (segment === '') continue;

    const parts = segment.match(/^(\^*)([A-Za-z0-9_$-]*)((?:\[\d+\])*)$/);
    if (!parts) return undefined;

    const carets = parts[1]?.length ?? 0;
    const name = parts[2] ?? '';
    const indices = parts[3] ?? '';

    if (carets > 0) {
      if (absolute) return undefined;
      level -= carets;
      if (level < 0) return undefined;
      cursor = scope[level];
      if (name === '' && indices === '') continue;
    }

    if (name !== '') cursor = child(cursor, name);
    for (const index of indices.matchAll(/\[(\d+)\]/g)) {
      cursor = child(cursor, index[1] as string);
    }
  }

  return cursor;
}

function child(cursor: unknown, key: string): unknown {
  if (Array.isArray(cursor)) {
    const index = Number(key);
    return Number.isInteger(index) ? cursor[index] : undefined;
  }
  if (isRecord(cursor)) return cursor[key];
  return undefined;
}

export function readString(scope: Scope, path: PathValue | undefined): string | undefined {
  if (path === undefined) return undefined;
  if (typeof path !== 'string') {
    if ('literal' in path) return nonEmpty(path.literal);
    const whole = read(scope, path.last);
    if (typeof whole !== 'string') return undefined;
    return nonEmpty(whole.slice(whole.lastIndexOf('/') + 1));
  }
  const value = read(scope, path);
  if (typeof value === 'string') return nonEmpty(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function readNumber(scope: Scope, path: PathValue | undefined): number | undefined {
  if (path === undefined) return undefined;
  if (typeof path !== 'string') return undefined;
  const value = read(scope, path);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
