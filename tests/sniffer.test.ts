import { afterAll, describe, expect, it } from 'vitest';
import { inspect } from '../src/background/sniff';
import { classify, kindByContentType } from '../src/core/kind';
import { isNoise } from '../src/core/noise';
import type { MediaKind } from '../src/core/types';
import { DEFAULT_SETTINGS } from '../src/store/settings';

/*
 * Every response below was taken from a real signed-in x.com timeline. The
 * point of this file is that these shapes keep working, because the ones that
 * used to slip through were found by loading the extension against the site,
 * not by reading the code.
 */

const notes: string[] = [];

function headers(values: Record<string, string>): chrome.webRequest.HttpHeader[] {
  return Object.entries(values).map(([name, value]) => ({ name, value }));
}

function details(url: string, type: string): chrome.webRequest.OnHeadersReceivedDetails {
  return {
    url,
    tabId: 1,
    method: 'GET',
    type: 'media',
    timeStamp: 0,
    frameId: 0,
    parentFrameId: -1,
    statusLine: 'HTTP/1.1 200 OK',
    responseHeaders: headers({ 'Content-Type': type, 'Content-Length': '12345' }),
  } as chrome.webRequest.OnHeadersReceivedDetails;
}

interface Shape {
  label: string;
  url: string;
  type: string;
  kind: MediaKind;
}

const WANTED: Shape[] = [
  {
    label: 'an HLS manifest',
    url: 'https://video.twimg.com/amplify_video/2108662373405900801/pl/Sgt5ZY5yqhijIlKu.m3u8?tag=12',
    type: 'application/x-mpegURL',
    kind: 'stream',
  },
  {
    label: 'a progressive rendition',
    url: 'https://video.twimg.com/amplify_video/2108662373405900801/pl/avc1/320x320/TRcpar.mp4?tag=12',
    type: 'video/mp4',
    kind: 'video',
  },
  {
    label: 'a profile image',
    url: 'https://pbs.twimg.com/profile_images/2020102812181331968/T7yPQyMc_bigger.jpg',
    type: 'image/jpeg',
    kind: 'image',
  },
];

const REJECTED: Shape[] = [
  {
    label: 'the JSON the site configures itself with',
    url: 'https://api.x.com/1.1/account/settings.json',
    type: 'application/json',
    kind: 'image',
  },
  {
    label: 'a hashflag lookup',
    url: 'https://x.com/i/api/1.1/hashflags.json',
    type: 'application/json',
    kind: 'image',
  },
];

afterAll(() => {
  for (const line of notes) console.log(line);
});

describe('responses worth keeping', () => {
  for (const shape of WANTED) {
    it(`inspects ${shape.label}`, () => {
      const report = inspect(details(shape.url, shape.type), DEFAULT_SETTINGS);
      expect(report).not.toBeNull();
      expect(report?.url).toBe(shape.url);
    });

    it(`classifies ${shape.label} as ${shape.kind}`, () => {
      expect(classify(shape.url, shape.type)).toBe(shape.kind);
    });

    it(`does not treat ${shape.label} as noise`, () => {
      expect(
        isNoise(
          { url: shape.url, kind: shape.kind, mime: shape.type, bytes: 12345 },
          DEFAULT_SETTINGS.strictness,
          DEFAULT_SETTINGS.minImageBytes,
        ),
      ).toBe(false);
    });
  }
});

describe('responses worth dropping', () => {
  for (const shape of REJECTED) {
    it(`ignores ${shape.label}`, () => {
      expect(inspect(details(shape.url, shape.type), DEFAULT_SETTINGS)).toBeNull();
    });
  }
});

describe('the mime x.com actually sends', () => {
  it('is recognised without relying on the file extension', () => {
    expect(kindByContentType('application/x-mpegURL')).toBe('stream');
  });

  it('would still be recognised on a path with no extension', () => {
    /* The extension is what rescued this before, so a manifest served from a
       bare path was classified as unknown. */
    expect(classify('https://video.twimg.com/live/12345', 'application/x-mpegURL')).toBe(
      'stream',
    );
  });
});
