/**
 * Saving a web font as something the operating system will install.
 *
 * The conversion itself happens in a sandboxed page, because the only library
 * that can do it needs an eval that a Manifest V3 extension page is not
 * allowed to run. This drives that page over `postMessage` and hands the
 * result to the downloads API.
 *
 * It runs from the panel rather than the offscreen document on purpose: the
 * request comes from a button in the panel, the conversion takes milliseconds,
 * and this needs no document that has to outlive the panel being closed.
 */

import { isTrueType, ttfName } from '../core/font';
import { api } from '../platform';

/** A stall here means the sandboxed page is not answering, not that it is slow. */
const TIMEOUT_MS = 20_000;

const TAG = 'kidnap-font';

let frame: HTMLIFrameElement | null = null;
let pending: number = 0;

function sandbox(): Promise<HTMLIFrameElement> {
  if (frame) return Promise.resolve(frame);

  return new Promise((resolve, reject) => {
    const element = document.createElement('iframe');
    element.src = api.runtime.getURL('sandbox/convert.html');
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
    /*
     * The listener inside the page is installed when its script runs, so a
     * message posted before that is dropped on the floor. Waiting for load is
     * what makes the first request work as well as the second.
     */
    element.addEventListener('load', () => resolve(element), { once: true });
    element.addEventListener('error', () => reject(new Error('the converter would not load')), {
      once: true,
    });
    document.body.append(element);
    frame = element;
  });
}

function toTtf(woff2: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    pending += 1;
    const id = pending;

    const give = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('the font converter did not answer'));
    }, TIMEOUT_MS);

    function onMessage(event: MessageEvent): void {
      const data = event.data as {
        tag?: string;
        id?: number;
        bytes?: ArrayBuffer;
        error?: string;
      } | null;
      if (data?.tag !== TAG || data.id !== id) return;
      clearTimeout(give);
      window.removeEventListener('message', onMessage);
      if (data.error) reject(new Error(data.error));
      else if (data.bytes) resolve(new Uint8Array(data.bytes));
      else reject(new Error('the font converter sent nothing back'));
    }

    window.addEventListener('message', onMessage);
    frame?.contentWindow?.postMessage({ tag: TAG, id, bytes: woff2.buffer }, '*');
  });
}

async function fetchFont(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`the font server answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Fetches the font, converts it and saves it. Returns the saved name, or
 * throws with something worth showing the user.
 */
export async function saveFontAsTtf(
  url: string,
  filename: string,
): Promise<{ filename: string; bytes: number }> {
  const frameReady = await sandbox();
  const woff2 = await fetchFont(url);
  const ttf = await new Promise<Uint8Array>((resolve, reject) => {
    void toTtf(woff2).then(resolve, reject);
  });

  if (!isTrueType(ttf)) throw new Error('the conversion did not produce a TrueType font');

  const name = ttfName(filename);
  const blob = new Blob([ttf.buffer as ArrayBuffer], { type: 'font/ttf' });
  await api.downloads.download({
    url: URL.createObjectURL(blob),
    filename: name,
    conflictAction: 'uniquify',
    saveAs: false,
  });
  void frameReady;
  return { filename: name, bytes: ttf.length };
}
