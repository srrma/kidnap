import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ADDONS } from '../src/addons/builtin';
import { AddonRegistry, applyRewrite, validateAddon } from '../src/addons/engine';
import { pluck, read } from '../src/addons/paths';
import { consolidate } from '../src/core/quality';
import type { AddonSpec, MediaItem } from '../src/core/types';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'),
  );
}

const registry = new AddonRegistry(BUILTIN_ADDONS);

function extract(apiUrl: string, body: unknown, tabId = 1): MediaItem[] {
  return registry.extract(apiUrl, body, tabId, 1_750_000_000_000);
}

describe('paths', () => {
  const tree = { a: { b: [{ c: 1 }, { c: 2 }] }, top: 'x' };

  it('descends plain segments and ends on the value', () => {
    const scopes = pluck(tree, 'top');
    expect(scopes).toHaveLength(1);
    expect(read(scopes[0]!, '')).toBe('x');
  });

  it('fans out over an array and keeps each match scoped', () => {
    const scopes = pluck(tree, 'a.b[]');
    expect(scopes).toHaveLength(2);
    expect(scopes.map((s) => read(s, 'c'))).toEqual([1, 2]);
  });

  it('steps out to a parent without losing the match', () => {
    const [scope] = pluck(tree, 'a.b[]');
    expect(read(scope!, '^sibling')).toBeUndefined();
    expect(read(scope!, '^^top')).toBe('x');
  });

  it('returns undefined rather than escaping the root', () => {
    const [scope] = pluck(tree, 'a.b[]');
    expect(read(scope!, '^^^^^^top')).toBeUndefined();
  });

  it('survives a missing branch', () => {
    expect(pluck(tree, 'missing.deep[]')).toEqual([]);
    expect(pluck({ a: 1 }, 'a.b[]')).toEqual([]);
  });

  it('fans out at two levels at once', () => {
    const nested = { rows: [{ cols: [{ v: 'a' }, { v: 'b' }] }, { cols: [{ v: 'c' }] }] };
    const scopes = pluck(nested, 'rows[].cols[]');
    expect(scopes.map((s) => read(s, 'v'))).toEqual(['a', 'b', 'c']);
  });
});

describe('addon registry', () => {
  it('only claims hosts and paths it was written for', () => {
    expect(registry.handles('https://x.com/i/api/graphql')).toBe(true);
    expect(registry.handles('https://api.imgur.com/3/album/xyz')).toBe(true);
    expect(registry.handles('https://example.com/i/api/thing')).toBe(false);
    expect(registry.handles('https://x.com/settings')).toBe(false);
  });

  it('does not match a lookalike host', () => {
    expect(registry.handles('https://notx.com/i/api/graphql')).toBe(false);
  });

  it('produces a host and path table for the page hook', () => {
    const table = registry.watchTable();
    expect(table.some(([host, paths]) => host === 'x.com' && paths.includes('/i/api/'))).toBe(
      true,
    );
  });
});

describe('builtin addons', () => {
  it('reads X video variants and groups them', () => {
    const items = extract('https://x.com/i/api/graphql', fixture('x-status.json'));

    const mp4 = items.filter((item) => item.url.includes('.mp4'));
    expect(mp4).toHaveLength(2);
    expect(mp4.every((item) => item.kind === 'video')).toBe(true);

    const high = mp4.find((item) => item.url.includes('high'));
    expect(high?.bitrate).toBe(2_176_000);
    expect(high?.author).toBe('Example Sport');
    expect(high?.caption).toBe('a short clip from the match');
    expect(high?.alt).toBe('a player striking a ball');
    expect(high?.thumbnail).toBe('https://pbs.twimg.com/ext_tw_video_thumb/abc.jpg');
    expect(high?.duration).toBeCloseTo(7.4, 3);
    expect(high?.postId).toBe('1750000000000000000');
    expect(high?.pageUrl).toBe('https://x.com/i/status/1750000000000000000');
    expect(high?.published).toBe('2023-06-14T12:00:00.000Z');

    expect(new Set(mp4.map((item) => item.groupId)).size).toBe(1);
  });

  it('reads an X photo without forcing a variant', () => {
    const [item] = extract('https://x.com/i/api/graphql', fixture('x-photo-status.json'));
    expect(item?.kind).toBe('image');
    expect(item?.width).toBe(2400);
    expect(item?.url).toContain('name=small');
    expect(item?.author).toBe('Archive Desk');
    expect(item?.alt).toBe('a scanned index card');
    expect(item?.pageUrl).toBe('https://x.com/i/status/1750000000000000002');
  });

  it('reads a tweet from a conversation, not just a tweet opened directly', () => {
    const items = extract('https://x.com/i/api/graphql', fixture('x-thread.json'));
    const video = items.find((item) => item.kind === 'video');
    expect(video?.url).toContain('mid.mp4');
    expect(video?.author).toBe('Timeline Person');
    expect(video?.caption).toBe('from a conversation');
    expect(video?.pageUrl).toBe('https://x.com/i/status/1750000000000000010');
  });

  it('reads a search timeline built from the live response skeleton', () => {
    /*
     * The outer shape here came from a real SearchTimeline response on
     * x.com, captured while signed in. Only the media block and the strings
     * were added afterwards, because the tweets returned during that run had no
     * media in them at all.
     */
    const items = extract(
      'https://x.com/i/api/graphql/abc/SearchTimeline',
      fixture('x-search-timeline.json'),
    );
    const video = items.find((item) => item.url.includes('high.mp4'));
    expect(video).toBeDefined();
    expect(video?.kind).toBe('video');
    expect(video?.bitrate).toBe(2_176_000);
    expect(video?.author).toBe('Example Channel');
    expect(video?.published).toBe('2023-06-14T12:00:00.000Z');
    expect(video?.pageUrl).toBe('https://x.com/i/status/1750000000000009999');
    expect(items.filter((item) => item.url.includes('.mp4'))).toHaveLength(2);
    expect(items.some((item) => item.url.includes('.m3u8'))).toBe(true);
  });

  it('reads a tweet detail, where the media nests inside legacy', () => {
    /*
     * Path and nesting taken from a live TweetDetail response on x.com. This
     * is the shape that actually carries media: a different root name, and
     * extended_entities inside legacy rather than beside it, which shifts
     * every ancestor depth by one.
     */
    const items = extract(
      'https://x.com/i/api/graphql/abc/TweetDetail',
      fixture('x-tweet-detail.json'),
    );
    const video = items.find((item) => item.url.includes('high.mp4'));
    expect(video).toBeDefined();
    expect(video?.kind).toBe('video');
    expect(video?.bitrate).toBe(2_176_000);
    expect(video?.width).toBe(1280);
    expect(video?.height).toBe(720);
    expect(video?.duration).toBeCloseTo(8.2, 3);
    expect(video?.author).toBe('Example Channel');
    expect(video?.caption).toBe('the goal from last night');
    expect(video?.thumbnail).toBe('https://pbs.twimg.com/ext_tw_video_thumb/detail.jpg');
    expect(video?.pageUrl).toBe('https://x.com/i/status/2108900948303065262');
    expect(items.filter((item) => item.url.includes('.mp4'))).toHaveLength(2);
    expect(items.some((item) => item.url.includes('.m3u8'))).toBe(true);
    expect(
      new Set(items.filter((i) => i.url.includes('.mp4')).map((i) => i.groupId)).size,
    ).toBe(1);
  });

  it('reads a tweet detail captured from x.com while signed in', () => {
    /*
     * Not hand written. Captured from a live TweetDetail response and scrubbed,
     * so the path, the nesting and the author location are the ones the site
     * really uses. Two things this locks in, each of which was a live bug:
     * extended_entities nesting inside legacy, and the user object having lost
     * its legacy wrapper in favour of a plain core.
     */
    const items = extract(
      'https://x.com/i/api/graphql/live/TweetDetail',
      fixture('x-live-tweet-detail.json'),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.author, `author missing for ${item.url}`).toBe('sample name');
      expect(item.caption, `caption missing for ${item.url}`).toBeTruthy();
      expect(item.pageUrl).toMatch(/^https:\/\/x\.com\/i\/status\//);
    }
    /* The captured tweet is a photo, which is all this fixture can speak to. */
    const photo = items.find((item) => item.kind === 'image');
    expect(photo?.url).toMatch(/pbs\.twimg\.com\/media\//);
    expect(photo?.width).toBe(2160);
    expect(photo?.height).toBe(3840);
  });

  it('reads a profile timeline', () => {
    const items = extract('https://x.com/i/api/graphql', fixture('x-user-timeline.json'));
    const photo = items.find((item) => item.kind === 'image');
    expect(photo?.width).toBe(1200);
    expect(photo?.author).toBe('Timeline Person');
    expect(photo?.caption).toBe('from a profile timeline');
  });

  it('reads Reddit video', () => {
    const items = extract(
      'https://www.reddit.com/svc/shreddit/comments/abc.json',
      fixture('reddit-post.json'),
    );
    const video = items.find((item) => item.kind === 'video');
    expect(video?.url).toContain('DASH_720.mp4');
    expect(video?.caption).toBe('the final lap');
    expect(video?.author).toBe('example_user');
    expect(video?.pageUrl).toBe(
      'https://www.reddit.com/r/videos/comments/abc123/the_final_lap/',
    );
    expect(video?.postId).toBe('abc123');
  });

  it('reads Instagram video versions and the cover image', () => {
    const items = extract(
      'https://www.instagram.com/api/v1/media/1/info/',
      fixture('instagram-media.json'),
    );
    const videos = items.filter((item) => item.kind === 'video');
    expect(videos).toHaveLength(2);
    expect(videos.every((item) => item.caption === 'morning run')).toBe(true);
    expect(videos.every((item) => item.author === 'example.runner')).toBe(true);
    expect(videos[0]?.pageUrl).toBe('https://www.instagram.com/p/ABC123xyz/');
    expect(videos[0]?.duration).toBeCloseTo(14.5, 2);
    expect(new Set(videos.map((item) => item.groupId)).size).toBe(1);

    const image = items.find((item) => item.kind === 'image');
    expect(image?.width).toBe(640);
  });

  it('reads a TikTok video', () => {
    const items = extract(
      'https://www.tiktok.com/api/post/item_list/',
      fixture('tiktok-item.json'),
    );
    const video = items.find((item) => item.kind === 'video');
    expect(video?.url).toContain('clip.mp4');
    expect(video?.width).toBe(1080);
    expect(video?.author).toBe('example.chef');
    expect(video?.caption).toBe('three second recipe #food');
    expect(video?.duration).toBe(14);
    expect(video?.pageUrl).toBe(
      'https://www.tiktok.com/@example.chef/video/7400000000000000000',
    );
  });

  it('reads every image in an Imgur gallery', () => {
    const items = extract('https://api.imgur.com/3/album/xyz', fixture('imgur-gallery.json'));
    const images = items.filter((item) => item.kind === 'image');
    expect(images.map((item) => item.url)).toEqual([
      'https://i.imgur.com/one.jpg',
      'https://i.imgur.com/two.jpg',
    ]);
    expect(images.every((item) => item.author === 'example')).toBe(true);
    expect(images[0]?.pageUrl).toBe('https://imgur.com/Xy9zK2p');
  });

  it('reads a Bluesky HLS playlist', () => {
    const items = extract(
      'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed',
      fixture('bsky-feed.json'),
    );
    const stream = items.find((item) => item.kind === 'stream');
    expect(stream?.url).toContain('playlist.m3u8');
    expect(stream?.mime).toBe('application/vnd.apple.mpegurl');
    expect(stream?.author).toBe('example.editor');
    expect(stream?.caption).toBe('first cut of the reel');
    expect(stream?.postId).toBe('3kabcdef');
    expect(stream?.pageUrl).toBe('https://bsky.app/profile/example.editor/post/3kabcdef');
  });

  it('reads Twitch VOD renditions', () => {
    const items = extract('https://gql.twitch.tv/gql', fixture('twitch-video.json'));
    const video = items.filter((item) => item.kind === 'stream');
    expect(video).toHaveLength(4);

    const best = video[0];
    expect(best?.label).toBe('1080p60');
    expect(best?.caption).toBe('full match replay');
    expect(best?.author).toBe('example_channel');
    expect(best?.pageUrl).toBe('https://www.twitch.tv/videos/1234567890');
    expect(best?.duration).toBe(5430);
    expect(best?.published).toBe(new Date(1686751200 * 1000).toISOString());
    expect(best?.thumbnail).toContain('jtvnw.net');

    /* Every rendition belongs to one video, so they collapse to one row. */
    expect(new Set(video.map((item) => item.groupId)).size).toBe(1);
  });

  it('reads Facebook HD and SD separately', () => {
    const items = extract(
      'https://www.facebook.com/api/graphql/',
      fixture('facebook-video.json'),
    );
    const video = items.filter((item) => item.kind === 'video');
    expect(video.map((item) => item.label).sort()).toEqual(['HD', 'SD']);

    const hd = video.find((item) => item.label === 'HD');
    expect(hd?.caption).toBe('wedding ceremony highlights');
    expect(hd?.author).toBe('Example Events');
    expect(hd?.postId).toBe('10153231379946729');
    expect(hd?.pageUrl).toContain('10153231379946729');
  });

  it('returns nothing for a body it does not recognise', () => {
    expect(extract('https://x.com/i/api/graphql', { unrelated: true })).toEqual([]);
    expect(extract('https://x.com/i/api/graphql', null)).toEqual([]);
    expect(extract('not-a-url', {})).toEqual([]);
  });
});

describe('rewrite', () => {
  /*
   * Verified against x.com while signed in: forcing name=orig returns 404 for
   * plenty of real images, because not every one of them has an original. X
   * therefore ships no rewrite rules at all.
   */
  it('leaves X image URLs alone', () => {
    const rules = BUILTIN_ADDONS.find((a) => a.id === 'x')?.rewrite ?? [];
    expect(rules).toEqual([]);
    expect(applyRewrite('https://pbs.twimg.com/media/A.jpg?name=small', rules)).toBe(
      'https://pbs.twimg.com/media/A.jpg?name=small',
    );
  });

  it('still rewrites for an add-on that asks for it', () => {
    expect(
      applyRewrite('https://cdn.example/a.jpg?w=100', [
        { host: 'cdn.example', setParams: { w: '2000' } },
      ]),
    ).toBe('https://cdn.example/a.jpg?w=2000');
  });
});

describe('user addons', () => {
  const spec: AddonSpec = {
    id: 'example',
    name: 'Example',
    hosts: ['example.test'],
    apiPaths: ['/api/media'],
    rules: [{ at: 'results[].asset', media: { url: 'src' } }],
  };

  it('a user addon shadows a built-in with the same id', () => {
    const local = new AddonRegistry(BUILTIN_ADDONS);
    const before = local.size;
    local.addAll([{ ...spec, id: 'x', name: 'Mine' }]);
    expect(local.size).toBe(before);
    expect(local.list().find((a) => a.id === 'x')?.name).toBe('Mine');
  });

  it('extracts from a user addon body', () => {
    const local = new AddonRegistry([spec]);
    const items = local.extract(
      'https://example.test/api/media/list',
      { results: [{ asset: { src: 'https://cdn.example/a.jpg' } }] },
      7,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('image');
    expect(items[0]?.detector).toBe('addon');
  });
});

describe('add-on language', () => {
  /* An empty `at` matches the response root, so the whole object is the match. */
  const body = {
    type: 'photo',
    src: 'https://cdn.example/a.jpg',
    owner: { id: '7' },
    uri: 'at://did:plc:x/app.bsky.feed.post/3kabc',
  };

  it('reads a fixed value for a field the response does not carry', () => {
    const item = extractOne(spec({ url: 'src', mime: { literal: 'image/webp' } }), body);
    expect(item?.mime).toBe('image/webp');
  });

  it('skips a rule whose condition does not hold', () => {
    const photo = extractWith(
      spec({ url: 'src', when: { path: 'type', equals: 'photo' } }),
      body,
    );
    const video = extractWith(
      spec({ url: 'src', when: { path: 'type', equals: 'video' } }),
      body,
    );
    expect(photo).toHaveLength(1);
    expect(video).toHaveLength(0);
  });

  it('matches against a list and for presence', () => {
    expect(
      extractWith(spec({ url: 'src', when: { path: 'type', in: ['video', 'photo'] } }), body),
    ).toHaveLength(1);
    expect(
      extractWith(spec({ url: 'src', when: { path: 'owner', exists: true } }), body),
    ).toHaveLength(1);
    expect(
      extractWith(spec({ url: 'src', when: { path: 'missing', exists: false } }), body),
    ).toHaveLength(1);
  });

  it('takes the last path segment, which is how an at:// rkey is recovered', () => {
    const item = extractOne(spec({ url: 'src', postId: { last: 'uri' } }), body);
    expect(item?.postId).toBe('3kabc');
  });

  it('builds a link from several values and keeps slashes in a path', () => {
    const item = extractOne(
      spec({
        url: 'src',
        postUrl: {
          template: 'https://example.test/u/{owner}/p/{id}',
          values: { owner: 'owner.id', id: 'owner.id' },
        },
      }),
      body,
    );
    expect(item?.pageUrl).toBe('https://example.test/u/7/p/7');
  });

  it('drops a link it cannot fill rather than emitting a broken one', () => {
    const item = extractOne(
      spec({
        url: 'src',
        postUrl: { template: 'https://example.test/{missing}', values: { missing: 'nope' } },
      }),
      body,
    );
    expect(item?.pageUrl).toBeUndefined();
  });

  it('never produces a link containing characters that break a URL', () => {
    const item = extractOne(
      spec({
        url: 'src',
        postUrl: { template: 'https://example.test/{id}', values: { id: 'owner.id' } },
      }),
      { ...body, owner: { id: 'a"b <c>\nd' } },
    );
    expect(item?.pageUrl).toBe('https://example.test/abcd');
  });

  function spec(media: AddonSpec['rules'][number]['media']): AddonSpec {
    return {
      id: 'probe',
      name: 'Probe',
      hosts: ['probe.test'],
      rules: [{ at: '', media }],
    };
  }

  function extractWith(specification: AddonSpec, body: unknown) {
    return new AddonRegistry([specification]).extract('https://probe.test/', body, 1);
  }

  /** An empty `at` matches once, so these rules produce exactly one item. */
  function extractOne(specification: AddonSpec, body: unknown) {
    return extractWith(specification, body)[0];
  }
});

describe('validation', () => {
  it('rejects a spec that cannot work', () => {
    expect(validateAddon(null).ok).toBe(false);
    expect(validateAddon({ name: 'x', hosts: ['a'], rules: [] }).ok).toBe(false);
    expect(validateAddon({ id: 'x', hosts: [], rules: [] }).ok).toBe(false);
    expect(
      validateAddon({ id: 'x', name: 'x', hosts: ['a'], rules: [{ at: 'a', media: {} }] }).ok,
    ).toBe(false);
  });

  it('accepts a well formed spec', () => {
    const result = validateAddon({
      id: 'a',
      name: 'A',
      hosts: ['a.test'],
      rules: [{ at: 'x', media: { url: 'y' } }],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts every builtin', () => {
    for (const addon of BUILTIN_ADDONS) {
      expect(validateAddon(addon).ok, `${addon.id} is invalid`).toBe(true);
    }
  });

  it('every builtin has at least one fixture-backed test', () => {
    /* A platform with no fixture is a platform that breaks silently. */
    const covered = new Set([
      'x',
      'reddit',
      'instagram',
      'tiktok',
      'imgur',
      'bsky',
      'twitch',
      'facebook',
    ]);
    for (const addon of BUILTIN_ADDONS) {
      expect(covered.has(addon.id), `${addon.id} has no fixture test`).toBe(true);
    }
    expect(covered.size).toBe(BUILTIN_ADDONS.length);
  });
});

describe('consolidate', () => {
  it('merges grouped variants into one row carrying a picker', () => {
    const registryLocal = new AddonRegistry(BUILTIN_ADDONS);
    const items = registryLocal.extract(
      'https://x.com/i/api/graphql',
      fixture('x-status.json'),
      1,
    );
    const rows = consolidate(items);

    const videos = rows.filter((row) => row.kind === 'video');
    expect(videos).toHaveLength(1);
    /* Two mp4 renditions plus the HLS master, which is a real alternative. */
    expect(videos[0]?.variants).toHaveLength(3);
    expect(videos[0]?.url).toContain('high.mp4');
    expect(videos[0]?.variants?.some((v) => v.url.includes('.m3u8'))).toBe(true);
  });
});
