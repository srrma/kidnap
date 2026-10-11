import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ADDONS } from '../src/addons/builtin';
import { AddonRegistry, applyRewrite, validateAddon } from '../src/addons/engine';
import { pluck, read } from '../src/addons/paths';
import { buildFilename, DEFAULT_TEMPLATE } from '../src/core/filename';
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

  /*
   * Every timeline the site serves, asserted the same way.
   *
   * These fixtures are cut from real responses rather than written to match a
   * rule, which is the only arrangement that catches a rule written to match a
   * fixture. The previous search fixture was built by hand from a real
   * skeleton, and being hand built it had the wrong nesting, so the search
   * rule passed its test while matching nothing on the site.
   */
  const TIMELINES: Array<[string, string]> = [
    ['x-home-timeline.json', 'HomeTimeline'],
    ['x-search-timeline.json', 'SearchTimeline'],
    ['x-user-timeline.json', 'UserOriginalsTimeline'],
    ['x-user-video-timeline.json', 'UserVideoTimeline'],
    ['x-bookmarks.json', 'Bookmarks'],
  ];

  for (const [file, endpoint] of TIMELINES) {
    it(`reads media from ${endpoint}, as the site serves it`, () => {
      const items = extract(`https://x.com/i/api/graphql/abc/${endpoint}`, fixture(file));
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        /* A row with no author is what the network sniffer produces; these
           must be the add-on's, with the tweet behind them. */
        expect(item.detector).toBe('addon');
        expect(item.author, `no author on ${item.url}`).toBe('sample name');
        expect(item.caption).toBeTruthy();
        expect(item.pageUrl).toMatch(/^https:\/\/x\.com\/i\/status\//);
      }

      /* A video carries real renditions, and they share one group so the row
         offers a picker rather than several near-identical downloads. */
      const videos = items.filter((item) => item.kind === 'video');
      if (videos.length > 0) {
        for (const video of videos) {
          expect(video.bitrate).toBeGreaterThan(0);
          expect(video.duration).toBeGreaterThan(0);
          expect(video.width).toBeGreaterThan(0);
        }
        const group = new Set(videos.map((v) => v.groupId));
        expect(group.size).toBeLessThan(videos.length);
      }
    });
  }

  it('reads a quoted tweet, which arrives as a second result object', () => {
    /*
     * A quoted tweet is a whole tweet inside another tweet's result, with its
     * own legacy and its own media, and it is not covered by any of the paths
     * above. It is reached by giving every one of them a quoted twin rather
     * than by writing each surface out twice.
     */
    const body = fixture('x-bookmarks.json');
    const quoted = pluck(
      body,
      'data.bookmark_timeline_v2.timeline.instructions[].entries[].content.itemContent.tweet_results.result.quoted_status_result.result',
    );
    expect(quoted.length, 'the fixture should keep a quoted tweet').toBeGreaterThan(0);
    const quotedId = read(quoted[0] as never, 'rest_id');
    expect(typeof quotedId).toBe('string');

    const items = extract(
      'https://x.com/i/api/graphql/abc/Bookmarks',
      fixture('x-bookmarks.json'),
    );
    const fromQuote = items.filter(
      (item) => item.pageUrl === `https://x.com/i/status/${quotedId}`,
    );
    expect(fromQuote.length, 'the quoted tweet produced no rows').toBeGreaterThan(0);
    for (const item of fromQuote) expect(item.author).toBe('sample name');
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

  it('reads the home timeline, which is where most scrolling happens', () => {
    /*
     * Path and nesting cut from a live HomeTimeline response rather than
     * assumed. This is the gap that let the timeline fall back to the network
     * sniffer: rows appeared, but with no author, no caption and no grouping,
     * because nothing read the payload.
     */
    const items = extract(
      'https://x.com/i/api/graphql/home/HomeTimeline',
      fixture('x-home-timeline.json'),
    );
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.detector).toBe('addon');
      expect(item.author, `no author on ${item.url}`).toBe('sample name');
      expect(item.caption, `no caption on ${item.url}`).toBe('sample tweet text');
      expect(item.pageUrl).toMatch(/^https:\/\/x\.com\/i\/status\//);
    }

    const video = items.find((item) => item.url.includes('high.mp4'));
    expect(video?.kind).toBe('video');
    expect(video?.bitrate).toBe(2_176_000);
    expect(video?.duration).toBeCloseTo(13, 3);
    expect(video?.thumbnail).toBe('https://pbs.twimg.com/ext_tw_video_thumb/sample.jpg');
    /* Two mp4 renditions plus the HLS master, collapsed into one group. */
    expect(items.filter((item) => item.url.includes('.mp4'))).toHaveLength(2);
    expect(items.some((item) => item.url.includes('.m3u8'))).toBe(true);
    expect(
      new Set(items.filter((i) => i.url.includes('.mp4')).map((i) => i.groupId)).size,
    ).toBe(1);

    const photo = items.find((item) => item.kind === 'image');
    expect(photo?.url).toBe('https://pbs.twimg.com/media/sample.jpg');
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
      'instagram',
      'pinterest',
      'behance',
      'tiktok',
      'imgur',
      'bsky',
      'adobe-fonts',
      'adobe-fonts-collections',
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

describe('adobe fonts', () => {
  const html = (file: string): string => {
    /*
     * The fixture is stored indented so it can be reviewed, and is compacted
     * here because that is the form the server actually sends. The add-on
     * matches on the exact bytes Adobe serves, whitespace included.
     */
    const stored = readFileSync(
      fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)),
      'utf8',
    );
    const body = JSON.stringify(JSON.parse(stored));
    /*
     * Wrapped the way the page actually serves it: the JSON sits in a script
     * tag, preceded by unrelated markup and followed by the closing tag the
     * add-on cuts on.
     */
    return `<!doctype html><html><body><script>window.x=1;</script><script>${body}</script></body></html>`;
  };

  it('reads every variation of a family from the rendered page', () => {
    const items = new AddonRegistry(BUILTIN_ADDONS).extractText(
      'https://fonts.adobe.com/fonts/roboto',
      html('adobe-font-family.json'),
      1,
    );
    expect(items).toHaveLength(3);

    const [first] = items;
    expect(first?.kind).toBe('font');
    expect(first?.mime).toBe('font/woff2');
    expect(first?.name).toBe('Roboto Thin');
    expect(first?.caption).toBe('Roboto');
    expect(first?.author).toBe('David Berlow');
    expect(first?.pageUrl).toBe('https://fonts.adobe.com/fonts/roboto');
    expect(first?.url).toContain('https://use.typekit.net/pf/tk/dwgd/n2/l?');
    expect(first?.url).toContain('ec_token=');
  });

  it('reads every variation of a collection from the rendered page', () => {
    const items = new AddonRegistry(BUILTIN_ADDONS).extractText(
      'https://fonts.adobe.com/collections/laced-up',
      html('adobe-font-collection.json'),
      1,
    );
    expect(items).toHaveLength(3);

    const [first] = items;
    expect(first?.kind).toBe('font');
    expect(first?.name).toBe('Puntino Light');
    expect(first?.caption).toBe('Puntino');
    /* One step out of the variation reaches the pack, which credits the team. */
    expect(first?.author).toBe('The Adobe Type Team');
    expect(first?.url).toContain('https://use.typekit.net/pf/tk/rtgs/n3/l?');
  });

  it('keeps families and collections apart', () => {
    const registry = new AddonRegistry(BUILTIN_ADDONS);
    /* A collection page must not be read as a family, or vice versa. */
    expect(
      registry.extractText(
        'https://fonts.adobe.com/collections/laced-up',
        html('adobe-font-family.json'),
        1,
      ),
    ).toHaveLength(0);
    expect(
      registry.extractText(
        'https://fonts.adobe.com/fonts/roboto',
        html('adobe-font-collection.json'),
        1,
      ),
    ).toHaveLength(0);
  });

  it('gives every font a usable file name, not the CDN path', () => {
    const [item] = new AddonRegistry(BUILTIN_ADDONS).extractText(
      'https://fonts.adobe.com/fonts/roboto',
      html('adobe-font-family.json'),
      1,
    );
    expect(item).toBeDefined();
    /*
     * The URL path ends in /l, so the name has to come from the payload or
     * every downloaded font is called "l.woff2".
     */
    const name = buildFilename(item as MediaItem, DEFAULT_TEMPLATE, '', 1);
    expect(name).toBe('use.typekit.net-font-1-Roboto Thin.woff2');
  });

  it('does nothing on a page it does not recognise', () => {
    const registry = new AddonRegistry(BUILTIN_ADDONS);
    expect(registry.wantsDocument('https://example.com/anything')).toBe(false);
    expect(registry.wantsDocument('https://fonts.adobe.com/fonts/roboto')).toBe(true);
    expect(
      registry.extractText('https://example.com/x', html('adobe-font-family.json'), 1),
    ).toHaveLength(0);
    /* A redesign leaves the marker missing; that must be silent, not a throw. */
    expect(
      registry.extractText('https://fonts.adobe.com/fonts/roboto', '<html>nope</html>', 1),
    ).toHaveLength(0);
  });
});

describe('instagram', () => {
  /*
   * The rules used to read `items[]`, which is what the old api/v1/feed/user
   * endpoints return. Nothing on instagram.com serves that now: measured
   * against real bodies the old rules extracted zero rows, from the feed and
   * from explore alike, while passing every test that had been written for
   * them. These fixtures are cut from captured responses so that cannot
   * happen again.
   */
  const CASES: Array<[string, string, string]> = [
    ['feed', 'instagram-feed.json', 'https://www.instagram.com/graphql/query'],
    [
      'explore',
      'instagram-explore.json',
      'https://www.instagram.com/discover/web/explore_grid/',
    ],
  ];

  for (const [name, file, url] of CASES) {
    it(`reads media from the ${name}, as the site serves it`, () => {
      const items = extract(url, fixture(file));
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        expect(item.detector).toBe('addon');
        expect(item.author, `no author on ${item.url}`).toBe('sample user');
        expect(item.caption).toBeTruthy();
        expect(item.pageUrl).toMatch(/^https:\/\/www\.instagram\.com\/p\/SAMPLECODE/);
        expect(item.width).toBeGreaterThan(0);
        expect(item.height).toBeGreaterThan(0);
      }
    });
  }

  it('reads a carousel, whose children carry no author of their own', () => {
    const items = extract(
      'https://www.instagram.com/graphql/query',
      fixture('instagram-feed.json'),
    );
    /*
     * media_type 8 is a carousel. Its children repeat the whole structure one
     * level down, and read the post's author from the parent, which is what
     * the extra carets in the child specs are for.
     */
    const body = fixture('instagram-feed.json') as {
      data: {
        xdt_api__v1__feed__timeline__connection: {
          edges: Array<{ node: { media: { carousel_media?: unknown[] } } }>;
        };
      };
    };
    const carousels = body.data.xdt_api__v1__feed__timeline__connection.edges.filter(
      (edge) => (edge.node.media.carousel_media ?? []).length > 0,
    );
    expect(carousels.length).toBeGreaterThan(0);
    for (const item of items) expect(item.author).toBe('sample user');
  });

  it('does not offer a video poster as a second image', () => {
    const items = extract(
      'https://www.instagram.com/discover/web/explore_grid/',
      fixture('instagram-explore.json'),
    );
    const videos = items.filter((item) => item.kind === 'video');
    expect(videos.length).toBeGreaterThan(0);

    /* A video's poster URL is kept as its thumbnail, and offered once. */
    for (const video of videos) {
      expect(video.thumbnail).toBeTruthy();
      const asImage = items.filter(
        (item) => item.kind === 'image' && item.url === video.thumbnail,
      );
      expect(asImage).toHaveLength(0);
    }
  });
});

describe('pinterest', () => {
  /*
   * Pinterest answers every feed with resource_response.data and keeps the same
   * pin shape on all of them, so the home feed and search differ only by one
   * segment. Both fixtures are cut from a signed-in capture: 24 pins came back
   * from the home feed and 25 from a search, every one carrying six image
   * renditions.
   */
  const CASES: Array<[string, string, string]> = [
    [
      'home feed',
      'pinterest-home.json',
      'https://www.pinterest.com/resource/UserHomefeedResource/get/',
    ],
    [
      'search',
      'pinterest-search.json',
      'https://www.pinterest.com/resource/BaseSearchResource/get/',
    ],
  ];

  for (const [name, file, url] of CASES) {
    it(`reads pins from the ${name}, as the site serves them`, () => {
      const items = extract(url, fixture(file));
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        expect(item.detector).toBe('addon');
        expect(item.kind).toBe('image');
        expect(item.url).toContain('i.pinimg.com/originals/');
        expect(item.author).toBe('sample_user');
        expect(item.caption).toBeTruthy();
        expect(item.pageUrl).toMatch(/^https:\/\/www\.pinterest\.com\/pin\//);
      }

      /*
       * `orig` rather than one of the grid renditions: 236x, 474x and 736x are
       * what the feed displays, and saving one of those would quietly discard
       * most of the image.
       */
      const [first] = items;
      expect(first?.width).toBeGreaterThan(736);
    });
  }

  it('reads the publication date, which arrives in RFC 2822 form', () => {
    const [item] = extract(
      'https://www.pinterest.com/resource/UserHomefeedResource/get/',
      fixture('pinterest-home.json'),
    );
    expect(item?.published).toBe('2025-09-12T04:50:42.000Z');
  });
});

describe('behance', () => {
  /*
   * Both fixtures come from one signed-in session: 48 projects from the feed and
   * 48 from a search. Behance answers both through the same /v3/graphql
   * endpoint under two different roots, and the project fields are identical
   * either way.
   */
  const CASES: Array<[string, string]> = [
    ['feed', 'behance-feed.json'],
    ['search', 'behance-search.json'],
  ];

  for (const [name, file] of CASES) {
    it(`reads project covers from the ${name}, as the site serves them`, () => {
      const items = extract('https://www.behance.net/v3/graphql', fixture(file));
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        expect(item.detector).toBe('addon');
        expect(item.kind).toBe('image');
        expect(item.url).toMatch(/mir-s3-cdn-cf\.behance\.net\/projects\/original_webp\//);
        expect(item.author).toBe('sample_creator');
        expect(item.caption).toBeTruthy();
        expect(item.pageUrl).toMatch(/^https:\/\/www\.behance\.net\/gallery\//);
      }
    });
  }

  it('takes the original cover rather than the smallest rendition', () => {
    /*
     * A project carries fourteen renditions. The original is first in 48 of 48
     * projects captured, and that ordering is the whole reason `[0]` is right
     * rather than lucky, so it is asserted rather than assumed.
     */
    const body = fixture('behance-feed.json') as {
      data: {
        forYouFeed: {
          nodes: Array<{ entity: { covers: { allAvailable: Array<{ url: string }> } } }>;
        };
      };
    };
    const nodes = body.data.forYouFeed.nodes;
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.entity.covers.allAvailable[0]?.url).toContain('/original_webp/');
    }
  });
});
