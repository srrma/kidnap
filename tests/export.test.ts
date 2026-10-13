import { describe, expect, it } from 'vitest';
import { redactQuery, toJson } from '../src/panel/export';

/**
 * The export is the most likely output of this extension to be pasted in
 * public, so the one thing worth testing hard is that a signature cannot ride
 * along inside it.
 */
describe('redactQuery', () => {
  it('keeps the parameter names and drops the values', () => {
    expect(redactQuery('https://cdn.example/a.jpg?sig=abc123&token=xyz789')).toBe(
      'https://cdn.example/a.jpg?sig=REDACTED&token=REDACTED',
    );
  });

  it('leaves a URL with no query alone', () => {
    expect(redactQuery('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
  });

  it('passes through something that is not a URL rather than throwing', () => {
    expect(redactQuery('not a url')).toBe('not a url');
  });

  it('keeps the fragment, which is not sent to a server anyway', () => {
    expect(redactQuery('https://cdn.example/a.jpg?sig=secret#t=3')).toBe(
      'https://cdn.example/a.jpg?sig=REDACTED#t=3',
    );
  });
});

describe('toJson', () => {
  it('omits the fields that identify the machine rather than the media', () => {
    const out = JSON.parse(
      toJson([{ url: 'https://cdn.example/a.jpg', tabId: 7, id: '7:abc', foundAt: 1 }]),
    );
    expect(out.items[0]).toEqual({ url: 'https://cdn.example/a.jpg' });
  });

  it('drops fields that were never filled in', () => {
    const out = JSON.parse(
      toJson([{ url: 'https://cdn.example/a.jpg', caption: '', author: undefined, tags: [] }]),
    );
    expect(out.items[0]).toEqual({ url: 'https://cdn.example/a.jpg' });
  });

  it('orders rows so the same list always exports the same bytes', () => {
    const a = toJson([
      { url: 'https://cdn.example/b.jpg' },
      { url: 'https://cdn.example/a.jpg' },
    ]);
    const b = toJson([
      { url: 'https://cdn.example/a.jpg' },
      { url: 'https://cdn.example/b.jpg' },
    ]);
    expect(a).toBe(b);
  });

  it('reports how many rows it wrote', () => {
    expect(JSON.parse(toJson([{ url: 'https://cdn.example/a.jpg' }])).count).toBe(1);
  });
});
