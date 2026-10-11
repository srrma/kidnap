/**
 * One place that decides which browser APIs exist.
 *
 * Chromium ships the `browser` namespace from 148 and Firefox has always had
 * it. Everything else is a feature check rather than a user-agent string,
 * because the honest question is never "which browser" but "does this browser
 * have this capability".
 */

type AnyApi = typeof chrome & Record<string, unknown>;

const global = globalThis as unknown as {
  browser?: AnyApi;
  chrome?: AnyApi;
};

export const api: AnyApi = (global.browser ?? global.chrome) as AnyApi;

/** The offscreen document lets work outlive the panel being closed. */
export function supportsOffscreen(): boolean {
  return typeof api.offscreen?.createDocument === 'function';
}

/** Chromium's side panel. Firefox uses sidebar_action, which has no runtime API. */
export function supportsSidePanel(): boolean {
  return typeof api.sidePanel?.open === 'function';
}

/** Firefox does not implement action.setBadgeText, so the badge is skipped there. */
export function supportsBadge(): boolean {
  return typeof api.action?.setBadgeText === 'function';
}

const isExtensionPage = (url: string | undefined): boolean =>
  url?.startsWith('chrome-extension://') === true ||
  url?.startsWith('moz-extension://') === true ||
  url?.startsWith('about:') === true;

/**
 * The tab the panel is acting on.
 *
 * `?tabId=` wins when present, which is how the panel is deep-linked and how
 * it is opened as an ordinary tab on Firefox, where there is no side panel.
 *
 * Otherwise the active tab is used, skipping our own pages. Without that skip,
 * a panel opened as its own tab resolves to itself and reports nothing, because
 * nothing was ever detected there.
 */
export async function activeTabId(): Promise<number | null> {
  const requested = new URLSearchParams(location.search).get('tabId');
  if (requested !== null && requested !== '') {
    const id = Number.parseInt(requested, 10);
    if (Number.isInteger(id) && id >= 0) return id;
  }

  const [active] = await api.tabs.query({ active: true, currentWindow: true });
  if (!active) return null;

  if (isExtensionPage(active.url) || isExtensionPage(active.pendingUrl)) {
    const [fallback] = await api.tabs.query({
      active: true,
      currentWindow: true,
      url: ['http://*/*', 'https://*/*'],
    });
    return typeof fallback?.id === 'number' ? fallback.id : null;
  }

  return typeof active.id === 'number' ? active.id : null;
}
