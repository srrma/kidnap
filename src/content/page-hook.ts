/**
 * The page-world hook.
 *
 * This runs in the page's own JavaScript context, which is the only place
 * `fetch`, `XMLHttpRequest` and `URL.createObjectURL` can be observed at all.
 * It is bundled as one self-contained file with no imports, because it is
 * injected with a script tag and cannot reference module scope.
 *
 * It does as little as possible. It never parses a response body and never
 * decides what is media; it forwards a URL when one looks interesting and a
 * body only when the background says a registered add-on wants that endpoint.
 * Keeping the logic out of this file is what keeps the page-world bundle small
 * and means a bug here cannot touch page data.
 */

interface HookWindow extends Window {
  __kidnapHook?: boolean;
  __kidnapStats?: Record<string, number>;
}

const scope = window as HookWindow;

(() => {
  /* A second injection is harmless: the guard makes this a no-op. */
  if (scope.__kidnapHook) return;
  scope.__kidnapHook = true;

  interface Watch {
    host: string;
    paths: string[];
  }

  let watch: Watch[] = [];
  const reported = new Set<string>();
  const MAX_REPORTED = 2000;

  /* Counters for the smoke test. This chain crosses a process boundary, so
     without them a dropped message has no visible symptom until the panel
     silently shows nothing. */
  const stats = { configAt: 0, watched: 0, apiSeen: 0, apiSent: 0, mediaSent: 0 };
  scope.__kidnapStats = stats;

  const MANIFEST = /\.(?:m3u8|mpd)(?:$|[?#])/i;
  const MEDIA =
    /\.(?:jpe?g|png|gif|webp|avif|svg|bmp|ico|mp4|m4v|webm|mov|mkv|mp3|m4a|aac|ogg|oga|opus|wav|flac|pdf)(?:$|[?#])/i;

  function send(type: string, detail: Record<string, unknown>): void {
    try {
      window.postMessage({ source: 'kidnap', type, ...detail }, '*');
    } catch {
      /* the page removed postMessage, or the frame went away */
    }
  }

  function absolute(url: string): string | null {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return null;
    }
  }

  function wants(url: string): boolean {
    try {
      const parsed = new URL(url);
      return watch.some(
        (entry) =>
          (parsed.hostname === entry.host || parsed.hostname.endsWith(`.${entry.host}`)) &&
          entry.paths.some((prefix) => parsed.pathname.startsWith(prefix)),
      );
    } catch {
      return false;
    }
  }

  function reportUrl(url: string): void {
    stats.mediaSent += 1;
    if (reported.size > MAX_REPORTED) return;
    const href = absolute(url);
    if (!href || reported.has(href)) return;
    if (!MANIFEST.test(href) && !MEDIA.test(href)) return;
    reported.add(href);
    send('media', { url: href });
  }

  function reportBody(url: string, text: string): void {
    stats.apiSeen += 1;
    /* A timeline payload is large. Beyond this it is a listing, not media. */
    if (text.length > 8_000_000) return;
    stats.apiSent += 1;
    send('api', { url, body: text });
  }

  /*
   * The watch table is handed over rather than bundled in, so this file stays
   * a couple of kilobytes and does not have to know what an add-on is.
   *
   * The handshake exists because this script is injected at document_start and
   * loads asynchronously, so the content script's first message usually landed
   * before this listener existed and the table was lost.
   *
   * Readiness is announced exactly once. Replying to each config with another
   * ready, and having the content script reply to each ready with another
   * config, is an infinite loop that starves the messages carrying media.
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; type?: string; watch?: Watch[] } | null;
    if (data?.source !== 'kidnap') return;
    if (data.type !== 'config') return;
    if (Array.isArray(data.watch)) {
      watch = data.watch;
      stats.configAt += 1;
      stats.watched = watch.length;
    }
  });

  send('ready', {});

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const raw =
      typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const href = absolute(raw);

    if (href && !href.startsWith('blob:') && !href.startsWith('data:')) {
      reportUrl(href);
      const capture = wants(href);
      const response = await originalFetch.call(window, input, init);
      if (capture && typeof response.clone === 'function') {
        void response
          .clone()
          .text()
          .then((text) => {
            if (text) reportBody(href, text);
          })
          .catch(() => {
            /* body already consumed or unreadable */
          });
      }
      return response;
    }

    return originalFetch.call(window, input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    ...args: unknown[]
  ) {
    try {
      const href = absolute(String(args[1]));
      if (href) {
        (this as unknown as { __kidnapUrl?: string }).__kidnapUrl = href;
        reportUrl(href);
        if (wants(href)) {
          this.addEventListener('load', () => {
            try {
              if (this.responseType === '' || this.responseType === 'text') {
                const body = this.responseText;
                if (body && body.length < 4_000_000) {
                  reportBody((this as unknown as { __kidnapUrl: string }).__kidnapUrl, body);
                }
              }
            } catch {
              /* a cross-origin XHR throws on responseText, which is expected */
            }
          });
        }
      }
    } catch {
      /* never let the hook break the page's own request */
    }
    return originalOpen.apply(this, args as Parameters<typeof originalOpen>);
  };

  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = function patchedCreate(object: Blob | MediaSource) {
    const href = originalCreate.call(URL, object);
    try {
      /* A blob is a runtime pointer to bytes already assembled elsewhere.
         The real URL is whatever the player fetched, which the sniffer and
         the fetch hook above already saw. Reporting the blob would put a
         string in the list that cannot be downloaded by anything. */
      if (!(object instanceof MediaSource)) {
        send('blob', { url: href, size: object.size });
      }
    } catch {
      /* reporting is best effort */
    }
    return href;
  };
})();
