/**
 * Settings live in chrome.storage.sync so they follow a signed-in profile.
 * Anything read back is treated as untrusted: the user may have edited it, or
 * a downgrade may have left a field the current version removed.
 */

import type { Settings } from '../core/types';
import { api } from '../platform';

const KEY = 'kidnap:settings';

export const DEFAULT_SETTINGS: Settings = {
  filenameTemplate: '{site}-{kind}-{index}-{name}.{ext}',
  folder: '',
  concurrency: 5,
  autoScroll: false,
  minImageBytes: 0,
  strictness: 'balanced',
  sort: 'recent',
  theme: 'system',
  mutedHosts: [],
  userAddons: [],
};

const STRICTNESS = new Set(['relaxed', 'balanced', 'strict']);
const SORTS = new Set(['recent', 'size', 'resolution', 'name']);
const THEMES = new Set(['system', 'light', 'dark']);

export async function load(): Promise<Settings> {
  const stored = await api.storage.sync.get(KEY);
  return coerce((stored[KEY] as Partial<Settings> | undefined) ?? {});
}

export async function save(changes: Partial<Settings>): Promise<Settings> {
  const next = coerce({ ...(await load()), ...changes });
  await api.storage.sync.set({ [KEY]: next });
  return next;
}

/** Clamps every field back into range rather than trusting what came back. */
export function coerce(value: Partial<Settings>): Settings {
  const template =
    typeof value.filenameTemplate === 'string' && value.filenameTemplate.trim() !== ''
      ? value.filenameTemplate.slice(0, 200)
      : DEFAULT_SETTINGS.filenameTemplate;

  return {
    filenameTemplate: template,
    folder: typeof value.folder === 'string' ? value.folder.replace(/^\/+|\/+$/g, '') : '',
    concurrency: clamp(value.concurrency, 1, 12, DEFAULT_SETTINGS.concurrency),
    autoScroll: value.autoScroll === true,
    minImageBytes: clamp(value.minImageBytes, 0, 50 * 1024 * 1024, 0),
    strictness: oneOf(value.strictness, STRICTNESS, DEFAULT_SETTINGS.strictness),
    sort: oneOf(value.sort, SORTS, DEFAULT_SETTINGS.sort),
    theme: oneOf(value.theme, THEMES, DEFAULT_SETTINGS.theme),
    mutedHosts: Array.isArray(value.mutedHosts)
      ? value.mutedHosts
          .filter((host): host is string => typeof host === 'string')
          .slice(0, 500)
      : [],
    userAddons: Array.isArray(value.userAddons) ? value.userAddons : [],
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function oneOf<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : fallback;
}

export function onChange(handler: (settings: Settings) => void): void {
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[KEY]) return;
    handler(coerce((changes[KEY].newValue as Partial<Settings> | undefined) ?? {}));
  });
}
