import { describe, expect, it } from 'vitest';
import { isTrueType, ttfName } from '../src/core/font';

describe('ttfName', () => {
  it('always ends in .ttf, because nothing else will install', () => {
    expect(ttfName('use.typekit.net-font-1-Roboto Thin.woff2')).toBe(
      'use.typekit.net-font-1-Roboto Thin.ttf',
    );
    /* A template that named no extension still has to produce a font file. */
    expect(ttfName('Puntino Light')).toBe('Puntino Light.ttf');
    expect(ttfName('name.otf')).toBe('name.ttf');
  });

  it('does not strip a dot that is part of the name', () => {
    expect(ttfName('v1.2 Regular.woff2')).toBe('v1.2 Regular.ttf');
  });
});

describe('isTrueType', () => {
  const tag = (...bytes: number[]): Uint8Array => new Uint8Array(bytes);

  it('accepts both spellings of the sfnt version', () => {
    expect(isTrueType(tag(0x00, 0x01, 0x00, 0x00, 0x00))).toBe(true);
    expect(isTrueType(tag(0x74, 0x72, 0x75, 0x65, 0x00))).toBe(true);
  });

  it('rejects anything that is not a font', () => {
    /* A server answering 200 with an error page is the case worth catching. */
    expect(isTrueType(tag(0x3c, 0x68, 0x74, 0x6d, 0x6c))).toBe(false);
    expect(isTrueType(new Uint8Array([0x00, 0x01]))).toBe(false);
    expect(isTrueType(new Uint8Array([]))).toBe(false);
  });
});
