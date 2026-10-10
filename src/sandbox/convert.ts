/**
 * WOFF2 to TrueType, in a sandboxed page.
 *
 * Web fonts are served as WOFF2 because browsers handle it and operating
 * systems largely do not, so a downloaded font has to be repackaged before it
 * can be installed.
 *
 * The converter is an emscripten build that reaches for JavaScript eval, which
 * a Manifest V3 extension page is forbidden to run. A page listed under
 * `sandbox.pages` is the documented way out: it runs on an opaque origin with
 * its own relaxed policy, which is exactly what untrusted conversion code
 * needs. It has no extension APIs, so it is driven entirely by `postMessage`:
 * bytes in, bytes out.
 *
 * The emscripten output is loaded as its own file rather than bundled. It is
 * asm.js that expects to be a script of its own, and inlining it into a bundle
 * leaves its runtime silently uninitialised.
 */

import { isTrueType } from '../core/font';

const TAG = 'kidnap-font';

/** The binding installs itself here, as a top level var, when it is loaded. */
interface EmscriptenModule {
  onRuntimeInitialized?: () => void;
  decompress: (bytes: Uint8Array) => Uint8Array;
}

declare global {
  // eslint-disable-next-line no-var
  var Module: EmscriptenModule | undefined;
}

/*
 * Naming the window explicitly rather than reaching for `parent`, which is not
 * typed on Window.
 */
const host = window.parent as Window;

let ready: Promise<EmscriptenModule> | null = null;

/**
 * Loads the binding once and resolves when its runtime is up.
 *
 * Emscripten overwrites `onRuntimeInitialized` during setup, so it is offered
 * before the script runs rather than read afterwards.
 */
function loadBinding(): Promise<EmscriptenModule> {
  if (ready) return ready;

  ready = new Promise<EmscriptenModule>((resolve, reject) => {
    const give = setTimeout(
      () => reject(new Error('the font converter did not start')),
      15_000,
    );
    /* Only the callback is offered; the binding replaces this object with one
       that has the real decompress on it. */
    globalThis.Module = {
      onRuntimeInitialized: () => {
        clearTimeout(give);
        resolve(globalThis.Module as EmscriptenModule);
      },
    } as EmscriptenModule;
    const script = document.createElement('script');
    script.src = './decompress_binding.js';
    script.onerror = () => {
      clearTimeout(give);
      reject(new Error('the font converter would not load'));
    };
    document.head.append(script);
  });

  return ready;
}

addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { tag?: string; id?: string | number; bytes?: ArrayBuffer } | null;
  if (data?.tag !== TAG || data.id === undefined || !data.bytes) return;

  void convert(data.id, new Uint8Array(data.bytes));
});

async function convert(id: string | number, woff2: Uint8Array): Promise<void> {
  try {
    const em = await loadBinding();
    /*
     * Emscripten hands back a view over its own heap rather than a fresh
     * array, so it is copied out. Copying also matters because the heap is
     * reused by the next conversion.
     */
    const produced = em.decompress(woff2);
    const ttf = ArrayBuffer.isView(produced)
      ? new Uint8Array(produced.buffer, produced.byteOffset, produced.byteLength)
      : new Uint8Array(produced);
    if (!isTrueType(ttf)) throw new Error('the conversion did not produce a TrueType font');
    /*
     * Copied rather than transferred: the buffer this page was handed is not
     * ours to detach, and neutering it would break the next request.
     */
    host.postMessage({ tag: TAG, id, bytes: ttf.slice().buffer }, '*');
  } catch (error) {
    host.postMessage({ tag: TAG, id, error: describe(error) }, '*');
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
