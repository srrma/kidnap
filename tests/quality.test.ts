import { describe, expect, it } from 'vitest';
import { consolidate, renditionIdentity } from '../src/core/quality';
import type { MediaItem } from '../src/core/types';

function item(url: string, extra: Partial<MediaItem> = {}): MediaItem {
  return { id: url, url, kind: 'image', detector: 'network', tabId: 1, foundAt: 0, ...extra };
}

describe('renditionIdentity', () => {
  it('agrees across the renditions of one picture', () => {
    const keys = [
      'https://mir-s3-cdn-cf.behance.net/projects/404/abc123.Y3JvcCwx',
      'https://mir-s3-cdn-cf.behance.net/projects/808_webp/abc123.Y3JvcCwx',
      'https://mir-s3-cdn-cf.behance.net/projects/max_808_webp/abc123.Y3JvcCwx',
    ].map(renditionIdentity);
    expect(new Set(keys).size).toBe(1);
  });

  it('agrees across the sizes Pinterest serves', () => {
    expect(renditionIdentity('https://i.pinimg.com/236x/aa/bb/cc.jpg')).toBe(
      renditionIdentity('https://i.pinimg.com/originals/aa/bb/cc.jpg'),
    );
  });

  it('refuses when the differing segment means something', () => {
    /* Two people, one avatar path shape. Both fall back to exact comparison. */
    expect(renditionIdentity('https://site.example/users/alice/avatar.jpg')).toBeNull();
    expect(renditionIdentity('https://site.example/users/bob/avatar.jpg')).toBeNull();
  });

  it('refuses when two segments could both be renditions', () => {
    const a = renditionIdentity('https://cdn.example/404/808/a.jpg');
    const b = renditionIdentity('https://cdn.example/808/404/a.jpg');
    expect(a === null || b === null || a !== b).toBe(true);
  });

  it('returns null when the path says nothing about renditions', () => {
    expect(renditionIdentity('https://cdn.example/media/abcdef.jpg')).toBeNull();
  });

  it('returns null for something that is not a url', () => {
    expect(renditionIdentity('not a url')).toBeNull();
  });
});

describe('consolidate', () => {
  it('collapses six renditions of one picture into one row', () => {
    const sizes = ['404', '808', '115_webp', '808_webp', 'max_808_webp', '404_webp'];
    const rows = consolidate(
      sizes.map((size, i) =>
        item(`https://mir-s3-cdn-cf.behance.net/projects/${size}/abc.Y3JvcCwx`, {
          bytes: (i + 1) * 1000,
        }),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variants).toHaveLength(6);
  });

  it('offers the largest rendition as the row', () => {
    const rows = consolidate([
      item('https://cdn.example/404/a.jpg', { bytes: 1000 }),
      item('https://cdn.example/808/a.jpg', { bytes: 9000 }),
    ]);
    expect(rows[0]?.url).toBe('https://cdn.example/808/a.jpg');
  });

  it('does not put a file size in the bitrate', () => {
    const rows = consolidate([
      item('https://cdn.example/404/a.mp4', { bytes: 2_000_000, bitrate: 4500 }),
      item('https://cdn.example/808/a.mp4', { bytes: 9_000_000, bitrate: 12_000 }),
    ]);
    const bits = (rows[0]?.variants ?? [])
      .map((v) => v.bitrate)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(bits).toEqual([4500, 12_000]);
  });

  it('leaves two different people alone', () => {
    const rows = consolidate([
      item('https://site.example/users/alice/avatar.jpg'),
      item('https://site.example/users/bob/avatar.jpg'),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('leaves different pictures on the same page alone', () => {
    const rows = consolidate([
      item('https://cdn.example/404/one.jpg'),
      item('https://cdn.example/404/two.jpg'),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('still merges an exact repeat and keeps the richer metadata', () => {
    const rows = consolidate([
      item('https://cdn.example/media/a.jpg'),
      item('https://cdn.example/media/a.jpg', { width: 800, height: 600, author: 'Ada' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.width).toBe(800);
    expect(rows[0]?.author).toBe('Ada');
  });

  it('still honours a group an add-on declared', () => {
    const rows = consolidate([
      item('https://cdn.example/one.jpg', { groupId: 'post-1' }),
      item('https://cdn.example/two.jpg', { groupId: 'post-1' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variants).toHaveLength(2);
  });

  it('does not let a declared group swallow a rendition group', () => {
    const rows = consolidate([
      item('https://cdn.example/404/a.jpg', { groupId: 'post-1' }),
      item('https://cdn.example/808/a.jpg', { groupId: 'post-1' }),
    ]);
    expect(rows).toHaveLength(1);
  });
});
