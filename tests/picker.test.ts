/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { sourcesFor } from '../src/content/dom';

/**
 * The picker matches on the string this returns, so the thing worth testing is
 * that it agrees with the scrape. Two implementations of "what URL is this
 * element showing" would drift, and the drift would show up as a hover that
 * highlights nothing.
 */
function inPage(html: string): void {
  document.body.innerHTML = html;
}

describe('sourcesFor', () => {
  it('resolves a relative src against the document', () => {
    inPage('<img src="/media/a.jpg">');
    expect(sourcesFor(document.querySelector('img')!)).toContain(
      'http://localhost:3000/media/a.jpg',
    );
  });

  it('reads a lazy attribute a site uses instead of src', () => {
    inPage('<img data-src="https://cdn.example/a.jpg">');
    expect(sourcesFor(document.querySelector('img')!)).toContain('https://cdn.example/a.jpg');
  });

  it('offers every candidate in a srcset, not just one', () => {
    inPage(
      '<img srcset="https://cdn.example/small.jpg 480w, https://cdn.example/big.jpg 1080w">',
    );
    const urls = sourcesFor(document.querySelector('img')!);
    expect(urls).toContain('https://cdn.example/small.jpg');
    expect(urls).toContain('https://cdn.example/big.jpg');
  });

  it('ignores a link that does not point at a file', () => {
    inPage('<a href="/wiki/Guinness">Guinness</a>');
    expect(sourcesFor(document.querySelector('a')!)).toEqual([]);
  });

  it('takes an anchor that does point at a file', () => {
    inPage('<a href="https://cdn.example/a.jpg">photo</a>');
    expect(sourcesFor(document.querySelector('a')!)).toContain('https://cdn.example/a.jpg');
  });

  it('skips a data uri, which is not something the sniff ever reported', () => {
    inPage('<img src="data:image/gif;base64,R0lGOD">');
    expect(sourcesFor(document.querySelector('img')!)).toEqual([]);
  });

  it('returns nothing for an element that is not media', () => {
    inPage('<div>text</div>');
    expect(sourcesFor(document.querySelector('div')!)).toEqual([]);
  });
});
