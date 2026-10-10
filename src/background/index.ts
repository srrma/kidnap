/**
 * The service worker. It owns detection bookkeeping, the job queues and the
 * routing between contexts. It holds no state in memory beyond what is cheap
 * to rebuild, because MV3 terminates it whenever it feels like it and every
 * decision here has to survive that.
 */

import { BUILTIN_ADDONS } from '../addons/builtin';
import { AddonRegistry, validateAddon } from '../addons/engine';
import { on, post, request } from '../bus/protocol';
import type { AddonSpec, MediaItem, Settings } from '../core/types';
import { api } from '../platform';
import { load as loadSettings, onChange, save as saveSettings } from '../store/settings';
import * as store from '../store/tab';
import { scheduleBadge } from './badge';
import { build, type Report } from './ingest';
import { wireJobs } from './jobs';
import { registerMenu } from './menu';
import { inspect } from './sniff';
import { isNavigation } from './tabreset';

let settings: Settings = {
  filenameTemplate: '{site}-{kind}-{index}-{name}.{ext}',
  folder: '',
  concurrency: 5,
  autoScroll: false,
  minImageBytes: 0,
  strictness: 'balanced',
  sort: 'recent',
  theme: 'system',
  mutedHosts: [],
  userAddons: [],
};

const addons = new AddonRegistry(BUILTIN_ADDONS);

void (async () => {
  settings = await loadSettings();
  for (const spec of settings.userAddons) {
    const result = validateAddon(spec);
    if (result.ok) addons.add(result.spec);
  }
})();

onChange((next) => {
  settings = next;
  for (const spec of addons.list()) addons.remove(spec.id);
  addons.addAll(BUILTIN_ADDONS);
  for (const spec of next.userAddons) {
    const result = validateAddon(spec);
    if (result.ok) addons.add(result.spec);
  }
});

/* ── Detection ───────────────────────────────────────────────────────────── */

async function record(tabId: number, report: Report): Promise<boolean> {
  let item: MediaItem | null;
  try {
    item = build(report, tabId, settings, Date.now(), (url) => addons.rewrite(url));
  } catch {
    /* A throw here loses the item silently, which is how the font path went
       missing for a while. Counted rather than swallowed. */
    diag.rejected += 1;
    return false;
  }
  if (!item) {
    diag.rejected += 1;
    return false;
  }
  const added = await store.add(tabId, item);
  if (added) {
    diag.stored += 1;
    scheduleBadge(tabId);
  }
  return added;
}

api.webRequest?.onHeadersReceived.addListener(
  (details): undefined => {
    void (async () => {
      const report = inspect(details, settings);
      if (report) await record(details.tabId, report);
    })();
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders'],
);

on('dom:media', (payload, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId < 0) return;

  void (async () => {
    for (const raw of payload.items) {
      const report: Report = {
        url: raw.url,
        detector: 'dom',
        width: raw.width,
        height: raw.height,
        alt: raw.alt,
        name: raw.name,
        title: raw.title,
        section: raw.section,
        pageUrl: payload.page?.url,
        pageTitle: payload.page?.title,
      };
      await record(tabId, report);
    }
  })();
});

on('hook:media', (payload, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId < 0) return;
  void record(tabId, { url: payload.url, detector: 'network' });
});

/*
 * Counters for the smoke test in scripts/smoke.mjs.
 *
 * The chain from the page hook to a stored item crosses three contexts. When
 * it broke, nothing was visible anywhere: the panel simply showed fewer rows.
 * These make the hop that dropped a message readable from the harness.
 */
const diag = {
  apiBody: 0,
  noTab: 0,
  notClaimed: 0,
  badJson: 0,
  items: 0,
  rejected: 0,
  stored: 0,
};
(globalThis as unknown as { __kidnapDiag: typeof diag }).__kidnapDiag = diag;

function tabIdOf(sender: chrome.runtime.MessageSender): number | undefined {
  const tabId = sender.tab?.id;
  return tabId === undefined || tabId < 0 ? undefined : tabId;
}

/**
 * Files what an add-on found. The add-on has already resolved every field it
 * knows, so all of it is carried through to storage rather than the handful

 */
function absorb(tabId: number, items: MediaItem[]): void {
  diag.items += items.length;
  for (const item of items) {
    void record(tabId, {
      url: item.url,
      detector: 'addon',
      mime: item.mime,
      bytes: item.bytes,
      width: item.width,
      height: item.height,
      name: item.name,
      alt: item.alt,
      author: item.author,
      caption: item.caption,
      published: item.published,
      postId: item.postId,
      pageUrl: item.pageUrl,
    });
  }
}

on('api:body', (payload, sender) => {
  diag.apiBody += 1;
  const tabId = tabIdOf(sender);
  if (tabId === undefined) {
    diag.noTab += 1;
    return;
  }
  if (!addons.handles(payload.url)) {
    diag.notClaimed += 1;
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(payload.body);
  } catch {
    diag.badJson += 1;
    return;
  }

  absorb(tabId, addons.extract(payload.url, body, tabId));
});

on('doc:html', (payload, sender) => {
  diag.apiBody += 1;
  const tabId = tabIdOf(sender);
  if (tabId === undefined) {
    diag.noTab += 1;
    return;
  }
  if (!addons.wantsDocument(payload.url)) {
    diag.notClaimed += 1;
    return;
  }
  absorb(tabId, addons.extractText(payload.url, payload.html, tabId));
});

on('addons:markers', () => ({ markers: addons.documentMarkers() }));

on('drm:seen', (_payload, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId < 0) return;
  void markProtected(tabId);
});

/**
 * Flags every item in the tab as protected. EME was negotiated by the page, so
 * the media it produced is encrypted and cannot be reconstructed, and offering
 * a download button that will fail with a 403 is worse than saying why.
 */
async function markProtected(tabId: number): Promise<void> {
  const items = await store.list(tabId);
  for (const item of items) {
    if (item.protected) continue;
    await store.patch(tabId, store.hashOf(item.url), {
      protected: true,
      protectedReason: 'Protected by encryption on this page',
    });
  }
}

/* ── Requests from the UI ────────────────────────────────────────────────── */

on('media:list', async ({ tabId }) => ({ items: await store.list(tabId) }));
on('media:clear', async ({ tabId }) => {
  await store.clear(tabId);
  scheduleBadge(tabId);
});
on('settings:get', () => settings);
on('settings:set', async (changes) => {
  settings = await saveSettings(changes);
  return settings;
});
on('addons:list', () => ({
  builtin: [...BUILTIN_ADDONS],
  user: settings.userAddons.filter((spec) => validateAddon(spec).ok) as AddonSpec[],
}));
on('jobs:get', async ({ tabId }) => store.jobs(tabId));

/* ── Tab lifecycle ───────────────────────────────────────────────────────── */

api.tabs.onRemoved.addListener((tabId) => {
  void store.clear(tabId);
});

api.tabs.onUpdated.addListener((tabId, change) => {
  if (!isNavigation(change)) return;
  /* A navigation makes every previously captured URL a different page. */
  void store.clear(tabId);
  scheduleBadge(tabId);
});

api.tabs.onActivated.addListener(({ tabId }) => scheduleBadge(tabId));

api.runtime.onInstalled.addListener(() => {
  registerMenu();
});

/*
 * Clicking the toolbar icon opens the panel rather than a popup, because the
 * popup only ever restated a count and pointed here.
 *
 * Set on every worker start rather than only on install: the worker is torn
 * down constantly, and re-asserting the behaviour is cheap and idempotent.
 * Firefox has no sidePanel API at all, so the check is a capability test
 * rather than a browser test.
 */
if (api.sidePanel?.setPanelBehavior) {
  void api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

wireJobs({ getSettings: () => settings, post });

export { addons, post, record, request, store };
