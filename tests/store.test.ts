import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaItem } from '../src/core/types';
import { createChrome } from './helpers/chrome';

/* src/platform.ts binds the API at import time, so the fake must exist first. */
const chrome = createChrome();
const store = await import('../src/store/tab');

function item(url: string, extra: Partial<MediaItem> = {}): Omit<MediaItem, 'id'> {
  return {
    url,
    kind: 'image',
    detector: 'network',
    tabId: 1,
    mime: 'image/jpeg',
    foundAt: 1_750_000_000_000,
    ...extra,
  };
}

beforeEach(async () => {
  /* clear() drops the in-memory dedupe cache too, which a raw storage clear
     would leave behind and make the next test see stale hashes. */
  await store.clear(1);
  await store.clear(2);
  await store.clear(3);
  await chrome.storage.session.clear();
});

describe('tab store', () => {
  it('stores and reads an item back', async () => {
    expect(await store.add(1, item('https://c.example/a.jpg'))).toBe(true);
    const items = await store.list(1);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://c.example/a.jpg');
    expect(items[0]?.id).toBe(store.itemId(1, 'https://c.example/a.jpg'));
  });

  it('dedupes the same url from two detectors', async () => {
    expect(await store.add(1, item('https://c.example/a.jpg', { detector: 'network' }))).toBe(
      true,
    );
    expect(
      await store.add(1, item('https://c.example/a.jpg', { detector: 'dom', alt: 'a cat' })),
    ).toBe(false);
    expect(await store.list(1)).toHaveLength(1);
  });

  it('treats a fragment difference as the same url', async () => {
    await store.add(1, item('https://c.example/a.jpg#one'));
    expect(await store.add(1, item('https://c.example/a.jpg#two'))).toBe(false);
  });

  it('keeps a different query string as a different item', async () => {
    await store.add(1, item('https://c.example/a.jpg?w=100'));
    expect(await store.add(1, item('https://c.example/a.jpg?w=200'))).toBe(true);
    expect(await store.list(1)).toHaveLength(2);
  });

  it('does not lose items when many detectors report at once', async () => {
    const urls = Array.from({ length: 200 }, (_, i) => `https://c.example/${i}.jpg`);
    const added = await Promise.all(urls.map((url) => store.add(1, item(url))));
    expect(added.filter(Boolean)).toHaveLength(200);
    expect(await store.list(1)).toHaveLength(200);
  });

  it('collapses concurrent duplicates into one', async () => {
    const results = await Promise.all([
      store.add(1, item('https://c.example/same.jpg')),
      store.add(1, item('https://c.example/same.jpg')),
      store.add(1, item('https://c.example/same.jpg')),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.list(1)).toHaveLength(1);
  });

  it('writes far fewer times than it stores items', async () => {
    let writes = 0;
    const original = chrome.storage.session.set.bind(chrome.storage.session);
    chrome.storage.session.set = async (values: Record<string, unknown>) => {
      writes += 1;
      return original(values);
    };
    try {
      for (let i = 0; i < 300; i++) await store.add(1, item(`https://c.example/${i}.jpg`));
      await store.settle(1);
      expect(await store.list(1)).toHaveLength(300);
      /* Two writes per flush regardless of batch size, not one per item. */
      expect(writes).toBeLessThanOrEqual(6);
    } finally {
      chrome.storage.session.set = original;
    }
  });

  it('keeps tabs apart', async () => {
    await store.add(1, item('https://c.example/a.jpg', { tabId: 1 }));
    await store.add(2, item('https://c.example/a.jpg', { tabId: 2 }));
    expect(await store.list(1)).toHaveLength(1);
    expect(await store.list(2)).toHaveLength(1);
    await store.clear(1);
    expect(await store.list(1)).toHaveLength(0);
    expect(await store.list(2)).toHaveLength(1);
  });

  it('clears every key a tab owned', async () => {
    await store.add(1, item('https://c.example/a.jpg'));
    await store.writeJobs(1, { direct: [], streams: [] });
    await store.clear(1);
    expect(await store.count(1)).toBe(0);
    const all = await chrome.storage.session.get(null);
    expect(Object.keys(all)).toHaveLength(0);
  });

  it('patches without discarding fields another detector supplied', async () => {
    await store.add(1, item('https://c.example/a.jpg', { alt: 'from the dom' }));
    const hash = store.hashOf('https://c.example/a.jpg');
    await store.patch(1, hash, { bytes: 1234, alt: undefined });
    const [row] = await store.list(1);
    expect(row?.bytes).toBe(1234);
    expect(row?.alt).toBe('from the dom');
  });

  it('ignores a patch for an item that is gone', async () => {
    await expect(store.patch(1, 'nope', { bytes: 1 })).resolves.toBeUndefined();
  });
});

describe('jobs', () => {
  it('round trips and prunes terminal jobs', async () => {
    const direct = Array.from({ length: 40 }, (_, i) => ({
      id: `d${i}`,
      itemId: `i${i}`,
      url: 'https://c.example/a.jpg',
      filename: 'a.jpg',
      kind: 'image' as const,
      state: i < 35 ? ('done' as const) : ('queued' as const),
    }));
    const pruned = store.pruneJobs({ direct, streams: [] });
    expect(pruned.direct).toHaveLength(25);
    expect(pruned.direct.filter((job) => job.state === 'queued')).toHaveLength(5);
    expect(pruned.direct.at(-1)?.state).toBe('done');
  });

  it('returns an empty shape for a tab with no jobs', async () => {
    expect(await store.jobs(99)).toEqual({ direct: [], streams: [] });
  });
});
