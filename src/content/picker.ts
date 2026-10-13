/**
 * Pointing at a picture to find it in the list.
 *
 * A long feed is the case the panel is worst at. Five hundred rows are a
 * scroll and a squint, and the person who wants one photograph has no way to
 * say which one without reading filenames. Hovering the thing they want and
 * watching the row light up turns that into a gesture.
 *
 * Two constraints shape this:
 *
 * 1. Nothing happens while the picker is off. A listener on every page that
 *    reports each element the cursor crosses is a message per movement, sent
 *    to a worker that may not even be open. So the panel turns this on, and
 *    the panel is where the person can see what it is doing.
 * 2. A message is sent when the answer changes, not when the mouse moves.
 *    Crossing a page fires mouseover per element boundary, which is already
 *    the right granularity; the last set of URLs is kept so re-entering the
 *    same picture sends nothing.
 */

import { post } from '../bus/protocol';
import { sourcesFor } from './dom';

let listening: 'mouseover' | 'mouseout' | null = null;
let lastKey = '';

function publish(urls: string[]): void {
  const key = urls.join('\n');
  if (key === lastKey) return;
  lastKey = key;
  post('dom:hover', { urls });
}

function over(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  /* The nearest media ancestor, so hovering a caption still finds the picture. */
  const element = target.closest('img,video,audio,source,picture');
  if (!element) {
    publish([]);
    return;
  }
  publish(sourcesFor(element));
}

function out(event: Event): void {
  if (event instanceof MouseEvent && event.relatedTarget instanceof Node) return;
  publish([]);
}

export function startPicker(): void {
  if (listening) return;
  document.addEventListener('mouseover', over, { passive: true });
  document.addEventListener('mouseout', out, { passive: true });
  window.addEventListener('scroll', () => publish([]), { passive: true, capture: true });
  listening = 'mouseover';
}

export function stopPicker(): void {
  if (!listening) return;
  document.removeEventListener('mouseover', over);
  document.removeEventListener('mouseout', out);
  listening = null;
  lastKey = '';
}
