import { describe, expect, it } from 'vitest';
import { hash64 } from '../src/core/hash';
import {
  classify,
  extensionOf,
  guessMime,
  isManifestUrl,
  isSegmentUrl,
  kindByContentType,
} from '../src/core/kind';
import { isNoise } from '../src/core/noise';
import {
  canonical,
  dimensionsFromUrl,
  fileNameFromDisposition,
  headerValue,
  hostMatches,
  pathMatches,
} from '../src/core/url';

describe('kind', () => {
  it('classifies by extension', () => {
    expect(classify('https://c.example/a/b.jpg')).toBe('image');
    expect(classify('https://c.example/clip.mp4')).toBe('video');
    expect(classify('https://c.example/track.m4a')).toBe('audio');
    expect(classify('https://c.example/master.m3u8')).toBe('stream');
    expect(classify('https://c.example/paper.pdf')).toBe('document');
    expect(classify('https://c.example/page')).toBeNull();
  });

  it('lets a content type override a misleading extension', () => {
    expect(classify('https://c.example/get?file=x.jpg', 'video/mp4')).toBe('video');
    expect(classify('https://c.example/noext', 'audio/mpeg')).toBe('audio');
  });

  it('ignores parameters on the content type', () => {
    expect(kindByContentType('video/mp4; codecs="avc1.4d401f"')).toBe('video');
    expect(kindByContentType('APPLICATION/DASH+XML')).toBe('stream');
    expect(kindByContentType(undefined)).toBeNull();
  });

  it('does not mistake a dotted path for an extension', () => {
    expect(extensionOf('https://c.example/v1.2/thing')).toBeNull();
    expect(extensionOf('https://c.example/.hidden')).toBeNull();
    expect(extensionOf('https://c.example/a.tar.gz')).toBe('gz');
  });

  it('recognises manifests and segments', () => {
    expect(isManifestUrl('https://c.example/live/index.m3u8?token=1')).toBe(true);
    expect(isManifestUrl('https://c.example/manifest.mpd')).toBe(true);
    expect(isManifestUrl('https://c.example/photo.jpg')).toBe(false);
    expect(isSegmentUrl('https://c.example/seg-42.m4s')).toBe(true);
    expect(isSegmentUrl('https://c.example/seg.ts')).toBe(true);
    expect(isSegmentUrl('https://c.example/seg-42.mp4')).toBe(false);
  });

  it('guesses a mime from the extension', () => {
    expect(guessMime('https://c.example/a.jpg')).toBe('image/jpeg');
    expect(guessMime('https://c.example/a.m3u8')).toBe('application/vnd.apple.mpegurl');
    expect(guessMime('https://c.example/a')).toBeUndefined();
  });
});

describe('url', () => {
  it('keeps the query but drops the fragment', () => {
    expect(canonical('https://c.example/a.mp4?token=abc#t=10')).toBe(
      'https://c.example/a.mp4?token=abc',
    );
  });

  it('leaves an unparseable url alone', () => {
    expect(canonical('not a url')).toBe('not a url');
  });

  it('matches hosts on label boundaries only', () => {
    expect(hostMatches('twitter.com', 'twitter.com')).toBe(true);
    expect(hostMatches('api.twitter.com', 'twitter.com')).toBe(true);
    expect(hostMatches('eviltwitter.com', 'twitter.com')).toBe(false);
    expect(hostMatches('twitter.com.evil.net', 'twitter.com')).toBe(false);
    expect(hostMatches('notwitter.com', 'twitter.com')).toBe(false);
  });

  it('treats a wildcard host as subdomains only', () => {
    expect(hostMatches('api.reddit.com', '*.reddit.com')).toBe(true);
    expect(hostMatches('reddit.com', '*.reddit.com')).toBe(false);
  });

  it('matches path prefixes without swallowing sibling paths', () => {
    expect(pathMatches('/i/api/graphql', '/i/api')).toBe(true);
    expect(pathMatches('/i/api', '/i/api')).toBe(true);
    expect(pathMatches('/i/apifoo', '/i/api')).toBe(false);
  });

  it('reads dimensions out of a path', () => {
    expect(dimensionsFromUrl('https://c.example/img/1920x1080.jpg')).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(dimensionsFromUrl('https://c.example/clip-720p.mp4')).toEqual({ height: 720 });
    expect(dimensionsFromUrl('https://c.example/plain.jpg')).toEqual({});
  });

  it('prefers the encoded content-disposition filename', () => {
    expect(fileNameFromDisposition('attachment; filename="fallback.jpg"')).toBe('fallback.jpg');
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''caf%C3%A9.jpg")).toBe(
      'café.jpg',
    );
    expect(fileNameFromDisposition(undefined)).toBeUndefined();
  });

  it('reads a header case-insensitively', () => {
    const headers = [
      { name: 'Content-Type', value: 'video/mp4' },
      { name: 'ETag', value: '"abc"' },
    ] as chrome.webRequest.HttpHeader[];
    expect(headerValue(headers, 'content-type')).toBe('video/mp4');
    expect(headerValue(headers, 'etag')).toBe('"abc"');
    expect(headerValue(headers, 'missing')).toBeUndefined();
  });
});

describe('noise', () => {
  const image = {
    url: 'https://c.example/a.jpg',
    kind: 'image' as const,
    mime: 'image/jpeg',
    bytes: 40_000,
    width: 800,
    height: 600,
  };

  it('drops unusable sources at every level', () => {
    for (const level of ['relaxed', 'balanced', 'strict'] as const) {
      expect(isNoise({ url: 'blob:https://c.example/abc', kind: 'video' }, level)).toBe(true);
      expect(isNoise({ url: 'data:image/png;base64,AA', kind: 'image' }, level)).toBe(true);
    }
  });

  it('drops trackers, favicons and byte ranges at every level', () => {
    expect(
      isNoise({ url: 'https://google-analytics.com/collect', kind: 'image' }, 'relaxed'),
    ).toBe(true);
    expect(isNoise({ url: 'https://c.example/favicon.ico', kind: 'image' }, 'relaxed')).toBe(
      true,
    );
    expect(
      isNoise({ url: 'https://c.example/a.mp4?bytestart=100', kind: 'video' }, 'relaxed'),
    ).toBe(true);
  });

  it('drops spacers at every level', () => {
    expect(isNoise({ ...image, width: 1, height: 1 }, 'relaxed')).toBe(true);
    expect(isNoise({ ...image, width: 8, height: 64 }, 'relaxed')).toBe(true);
  });

  it('keeps a real image at relaxed and drops it at balanced when tiny', () => {
    expect(isNoise({ ...image, bytes: 500 }, 'relaxed')).toBe(false);
    expect(isNoise({ ...image, bytes: 500 }, 'balanced')).toBe(true);
  });

  it('drops stream segments above relaxed only', () => {
    const seg = { url: 'https://c.example/seg-1.m4s', kind: 'stream' as const, bytes: 90_000 };
    expect(isNoise(seg, 'relaxed')).toBe(false);
    expect(isNoise(seg, 'balanced')).toBe(true);
  });

  it('drops a mime that contradicts the extension', () => {
    expect(
      isNoise(
        { url: 'https://c.example/a.jpg', kind: 'image', mime: 'video/mp4', bytes: 90_000 },
        'balanced',
      ),
    ).toBe(true);
  });

  it('honours a user minimum image size independently of the level', () => {
    const small = {
      url: 'https://c.example/a.jpg',
      kind: 'image' as const,
      mime: 'image/jpeg',
      bytes: 30_000,
    };
    expect(isNoise(small, 'relaxed', 50_000)).toBe(true);
    expect(isNoise(small, 'relaxed', 10_000)).toBe(false);
  });

  it('lets svg compress harder than raster images', () => {
    const svg = {
      url: 'https://c.example/a.svg',
      kind: 'image' as const,
      mime: 'image/svg+xml',
      bytes: 900,
    };
    expect(isNoise(svg, 'balanced')).toBe(false);
    expect(isNoise({ ...svg, mime: 'image/png', bytes: 900 }, 'balanced')).toBe(true);
  });
});

describe('hash', () => {
  it('is stable for the same input', () => {
    expect(hash64('https://c.example/a.jpg')).toBe(hash64('https://c.example/a.jpg'));
  });

  it('differs for different inputs', () => {
    expect(hash64('https://c.example/a.jpg')).not.toBe(hash64('https://c.example/b.jpg'));
  });

  it('stays within 64 bits worth of alphabet', () => {
    for (let i = 0; i < 500; i++) {
      expect(hash64(`https://c.example/${i}.jpg`)).toMatch(/^[0-9a-z]+$/);
    }
  });

  it('does not collide across a large batch', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++)
      seen.add(hash64(`https://cdn.example/asset/${i}?v=${i % 97}`));
    expect(seen.size).toBe(20_000);
  });
});
