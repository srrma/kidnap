import { describe, expect, it } from 'vitest';
import { posterSource } from '../src/panel/thumbnails';

/**
 * The thumbnail generator needs a real video decoder and a canvas, so what is
 * tested here is the policy that decides whether to attempt one at all. The
 * generator itself is exercised by loading the extension.
 */
describe('poster source', () => {
  it('uses a poster an add-on already supplied', () => {
    expect(posterSource({ kind: 'video', thumbnail: 'https://pbs.twimg.com/poster.jpg' })).toBe(
      'addon',
    );
  });

  it('decodes a frame when there is nothing cheaper', () => {
    expect(posterSource({ kind: 'video' })).toBe('frame');
  });

  it('falls back to a badge for every other kind', () => {
    for (const kind of ['image', 'audio', 'stream', 'document']) {
      expect(posterSource({ kind })).toBe('badge');
    }
  });

  it('spends no request on media the user cannot save', () => {
    /*
     * Even with a poster already known, protected media keeps its badge.
     * Fetching pixels for a file whose download button refuses is a request
     * the user gets nothing from.
     */
    expect(posterSource({ kind: 'video', protected: true })).toBe('badge');
    expect(
      posterSource({ kind: 'video', protected: true, thumbnail: 'https://x/poster.jpg' }),
    ).toBe('badge');
  });
});

describe('contrast', () => {
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
    const linear = channels.map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  }

  function ratio(a: string, b: string): number {
    const sorted = [luminance(a), luminance(b)].sort((x, y) => y - x);
    const light = sorted[0] ?? 0;
    const dark = sorted[1] ?? 0;
    return (light + 0.05) / (dark + 0.05);
  }

  /* Every pairing a nine pixel tile label makes against the tile surface. */
  const LIGHT = {
    image: '#2f6f4f',
    video: '#7a4bbd',
    audio: '#8f5417',
    stream: '#1f6f8b',
    document: '#5c5a66',
  };
  const DARK = {
    image: '#6fce9f',
    video: '#c2a0f5',
    audio: '#f0b26b',
    stream: '#7fd0e8',
    document: '#a3a0ae',
  };

  it('every tile label passes AA in the light theme', () => {
    for (const [kind, colour] of Object.entries(LIGHT)) {
      expect(ratio(colour, '#f7f7f8'), `${kind} on light surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every tile label passes AA in the dark theme', () => {
    for (const [kind, colour] of Object.entries(DARK)) {
      expect(ratio(colour, '#1d1c24'), `${kind} on dark surface`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
