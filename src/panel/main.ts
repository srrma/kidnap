/**
 * The panel.
 *
 * Rendering is keyed by item id. A row is reused but re-updated in place
 * whenever its item changes, so a size that arrives late, or a DRM flag set
 * after the row is on screen, is shown rather than waiting for a full rebuild.
 */

import { request } from '../bus/protocol';
import { buildFilename, DEFAULT_TEMPLATE } from '../core/filename';
import { consolidate, sortItems, totalBytes } from '../core/quality';
import type {
  DirectJob,
  MediaItem,
  MediaKind,
  Settings,
  StreamJob,
  TabJobs,
} from '../core/types';
import { displayHost, fileNameOf } from '../core/url';
import { activeTabId, api, supportsSidePanel } from '../platform';
import { bytes, clear, duration, el, toast } from './dom';
import { saveFontAsTtf } from './font';
import { openPreview } from './preview';
import { openSettings } from './settings';
import { cached, posterSource, releaseAll, request as requestPoster } from './thumbnails';

type Filter = MediaKind | 'all';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'stream', label: 'Streams' },
  { id: 'document', label: 'Files' },
  { id: 'font', label: 'Fonts' },
];

interface State {
  tabId: number | null;
  raw: MediaItem[];
  rows: MediaItem[];
  filter: Filter;
  settings: Settings | null;
  jobs: TabJobs;
  selected: Set<string>;
  selecting: boolean;
  error: string | null;
  loading: boolean;
}

const state: State = {
  tabId: null,
  raw: [],
  rows: [],
  filter: 'all',
  settings: null,
  jobs: { direct: [], streams: [] },
  selected: new Set(),
  selecting: false,
  error: null,
  loading: true,
};

const root = document.getElementById('app') as HTMLElement;
/*
 * The list is one element for the life of the page because the poster
 * IntersectionObserver uses it as a root. That makes emptying it this
 * render's job: reusing the node without clearing it left the previous
 * render's loading or empty state sitting on top of live rows.
 */
const listElement = el('div', { class: 'list', role: 'list' });
const renderedRows = new Map<string, HTMLElement>();

/*
 * The panel can be pointed at a specific tab with ?tabId=. That is how it is
 * deep-linked, and how it is reached on Firefox, which has no side panel and
 * opens this page as an ordinary tab instead.
 */

/* Firefox has no offscreen document, so assembly and font conversion run here. */
if (!supportsSidePanel() || !api.offscreen) {
  void import('../offscreen/assemble').then((module) => module.startAssembling());
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

async function boot(): Promise<void> {
  state.tabId = await activeTabId();
  try {
    state.settings = await request('settings:get', undefined);
    await refresh();
  } catch (error) {
    state.error = String(error);
    state.loading = false;
    render();
  }
}

async function read(): Promise<void> {
  if (state.tabId === null) return;
  try {
    const { items } = await request('media:list', { tabId: state.tabId });
    state.raw = items;
    state.jobs = await request('jobs:get', { tabId: state.tabId });
    state.error = null;
  } catch (error) {
    state.error = String(error);
  }
  state.loading = false;
  render();
}

/**
 * One read at a time.
 *
 * Storage changes arrive faster than the background can answer while a page is
 * loading media, and letting reads overlap meant two things went wrong at once:
 * the background was asked the same question repeatedly, and a read that had
 * already been superseded could fail last and leave an error over rows that
 * were on screen and correct. A change that lands mid-read is honoured by
 * reading again once.
 */
let reading: Promise<void> | null = null;
let again = false;

function refresh(): Promise<void> {
  if (reading) {
    again = true;
    return reading;
  }
  reading = (async () => {
    do {
      again = false;
      await read();
    } while (again);
  })().finally(() => {
    reading = null;
  });
  return reading;
}

/** The background owns the store, so storage changes drive the refresh. */
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (state.tabId === null) return;
  const prefix = `:${state.tabId}:`;
  if (Object.keys(changes).some((key) => key.includes(prefix))) void refresh();
});

api.tabs.onActivated.addListener(() => {
  state.selected.clear();
  state.selecting = false;
  void boot();
});

/* ── Derived view ───────────────────────────────────────────────────────── */

function visible(): MediaItem[] {
  const rows = consolidate(state.raw);
  state.rows = rows;
  if (state.filter === 'all') return sortItems(rows, state.settings?.sort ?? 'recent');
  return sortItems(
    rows.filter((item) => item.kind === state.filter),
    state.settings?.sort ?? 'recent',
  );
}

function counts(rows: MediaItem[]): Record<Filter, number> {
  const base: Record<Filter, number> = {
    all: 0,
    image: 0,
    video: 0,
    audio: 0,
    stream: 0,
    document: 0,
    font: 0,
  };
  for (const item of rows) {
    base.all += 1;
    base[item.kind] += 1;
  }
  return base;
}

/* ── Render ─────────────────────────────────────────────────────────────── */

function render(): void {
  const items = visible();
  const tabCounts = counts(consolidate(state.raw));

  clear(root);

  root.append(header(items.length));
  root.append(filters(tabCounts));

  if (state.selecting) root.append(selectionBar());

  const list = listElement;
  for (const node of renderedRows.values()) releaseRow(node);
  renderedRows.clear();
  clear(list);

  const placeholder = stateView(items);
  if (placeholder) list.append(placeholder);
  reconcile(list, items);
  root.append(list);

  const queue = renderQueue();
  if (queue) root.append(queue);
}

function stateView(items: MediaItem[]): HTMLElement | null {
  if (state.loading) {
    return el('div', { class: 'state' }, [
      el('div', { class: 'state-title' }, ['Looking at this tab']),
      el('div', { class: 'state-detail' }, ['Waiting for the first response to arrive.']),
    ]);
  }

  if (state.error) {
    return el('div', { class: 'state' }, [
      el('div', { class: 'state-title' }, ['Could not read this tab']),
      el('div', { class: 'state-detail' }, [state.error]),
      el('button', { class: 'act-primary', type: 'button', onClick: () => void refresh() }, [
        'Try again',
      ]),
    ]);
  }

  if (state.raw.length === 0) {
    return el('div', { class: 'state' }, [
      el('div', { class: 'state-title' }, ['Nothing found yet']),
      el('div', { class: 'state-detail' }, [
        'Media shows up here as the page loads it. If the tab is already open, reload it and come back.',
      ]),
    ]);
  }

  if (items.length === 0) {
    return el('div', { class: 'state' }, [
      el('div', { class: 'state-title' }, [`No ${labelFor(state.filter).toLowerCase()} here`]),
      el('div', { class: 'state-detail' }, [
        `${state.raw.length} item${state.raw.length === 1 ? '' : 's'} found in this tab. Pick another filter to see them.`,
      ]),
    ]);
  }

  return null;
}

function labelFor(filter: Filter): string {
  return FILTERS.find((entry) => entry.id === filter)?.label ?? 'All';
}

function header(count: number): HTMLElement {
  const theme = state.settings?.theme ?? 'system';
  const themeButton = el(
    'button',
    {
      class: 'icon-button',
      type: 'button',
      title: `Theme: ${theme}`,
      'aria-label': `Theme: ${theme}. Activate to change.`,
      onClick: () => void cycleTheme(theme),
    },
    [theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'],
  );

  /*
   * The way out of selection mode is a control in the same place as the way
   * in. Swapping it for the bulk actions would leave anyone who entered it with
   * no way back except reloading the page.
   */
  const bulk: Node[] = state.selecting
    ? [
        el('button', { class: 'act-quiet', type: 'button', onClick: () => void copyAll() }, [
          'Copy all URLs',
        ]),
        el(
          'button',
          {
            class: 'act-primary',
            type: 'button',
            disabled: count === 0,
            onClick: () => void downloadAll(),
          },
          [`Download all ${count}`],
        ),
      ]
    : [];

  const toggle = state.selecting
    ? el(
        'button',
        {
          class: 'act-quiet',
          type: 'button',
          'aria-label': 'Finish selecting',
          title: 'Finish selecting',
          onClick: () => exitSelection(),
        },
        ['Done'],
      )
    : el(
        'button',
        {
          class: 'icon-button',
          type: 'button',
          'aria-label': 'Select items',
          'aria-pressed': 'false',
          title: 'Select items',
          onClick: () => {
            state.selecting = true;
            render();
          },
        },
        ['☑'],
      );

  return el('header', { class: 'bar' }, [
    el('h1', { class: 'bar-title' }, ['Kidnap']),
    el('span', { class: 'count' }, [count === 1 ? '1 item' : `${count} items`]),
    el('div', { class: 'spacer' }),
    ...bulk,
    toggle,
    themeButton,
    el(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        'aria-label': 'Settings',
        title: 'Settings',
        onClick: () => openSettings(state.settings, onSaved),
      },
      ['⚙'],
    ),
  ]);
}

function exitSelection(): void {
  state.selecting = false;
  state.selected.clear();
  render();
}

async function cycleTheme(current: Settings['theme']): Promise<void> {
  const order: Settings['theme'][] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(current) + 1) % order.length] ?? 'system';
  state.settings = await request('settings:set', { theme: next });
  applyTheme(next);
  render();
}

function applyTheme(theme: Settings['theme']): void {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function filters(tabCounts: Record<Filter, number>): HTMLElement {
  const strip = el('div', {
    class: 'filters',
    role: 'tablist',
    'aria-label': 'Filter by type',
  });
  for (const filter of FILTERS) {
    const selected = state.filter === filter.id;
    strip.append(
      el(
        'button',
        {
          class: 'tab',
          type: 'button',
          role: 'tab',
          'aria-selected': selected,
          onClick: () => {
            state.filter = filter.id;
            render();
          },
        },
        [filter.label, el('span', { class: 'tab-count' }, [String(tabCounts[filter.id] ?? 0)])],
      ),
    );
  }
  return strip;
}

function selectionBar(): HTMLElement {
  const chosen = state.rows.filter((item) => state.selected.has(item.id));
  const total = totalBytes(chosen);

  return el('div', { class: 'selection' }, [
    el('span', { class: 'count' }, [
      `${chosen.length} selected${total > 0 ? `, ${bytes(total)}` : ''}`,
    ]),
    el('div', { class: 'spacer' }),
    el(
      'button',
      {
        class: 'act-quiet',
        type: 'button',
        onClick: () => {
          for (const item of state.rows) state.selected.add(item.id);
          render();
        },
      },
      ['Select all'],
    ),
    el(
      'button',
      {
        class: 'act-quiet',
        type: 'button',
        disabled: chosen.length === 0,
        onClick: () => void download(chosen),
      },
      ['Download'],
    ),
    el(
      'button',
      {
        class: 'act-quiet',
        type: 'button',
        disabled: chosen.length === 0,
        onClick: () => void copyUrls(chosen),
      },
      ['Copy URLs'],
    ),
  ]);
}

/* ── Keyed list ─────────────────────────────────────────────────────────── */

function reconcile(list: HTMLElement, items: MediaItem[]): void {
  const wanted = new Set(items.map((item) => item.id));

  for (const [id, node] of renderedRows) {
    if (!wanted.has(id)) {
      releaseRow(node);
      node.remove();
      renderedRows.delete(id);
    }
  }

  let previous: Element | null = null;
  const stateNode = list.querySelector('.state');

  for (const item of items) {
    let node = renderedRows.get(item.id);
    if (!node) {
      node = row(item);
      renderedRows.set(item.id, node);
    } else {
      update(node, item);
    }

    const shouldFollow =
      previous === null
        ? node.previousElementSibling === null
        : node.previousElementSibling !== previous;
    if (shouldFollow) {
      list.insertBefore(node, stateNode ? stateNode.nextSibling : null);
    }
    previous = node;
  }
}

function row(item: MediaItem): HTMLElement {
  const node = el('div', { class: 'row', role: 'listitem', 'data-id': item.id });
  update(node, item);
  return node;
}

function update(node: HTMLElement, item: MediaItem): void {
  const selected = state.selected.has(item.id);
  node.dataset.selected = String(selected);
  node.dataset.protected = String(item.protected === true);
  node.setAttribute('aria-label', describeItem(item));
  clear(node);

  if (state.selecting) {
    const box = el('input', {
      class: 'check',
      type: 'checkbox',
      'aria-label': `Select ${item.name ?? item.url}`,
    });
    box.checked = selected;
    box.addEventListener('change', () => {
      if (box.checked) state.selected.add(item.id);
      else state.selected.delete(item.id);
      render();
    });
    node.append(box);
  }

  /*
   * The row is the preview trigger rather than a separate Open control. A
   * button that duplicates "click the thing next to it" trains people to hunt
   * for the control instead of clicking what they meant, and it costs a column
   * in a panel this narrow.
   *
   * It is a real button, not a div with a click handler, so Tab reaches it,
   * Enter and Space activate it, and the focus ring comes for free.
   */
  const opener = el(
    'button',
    {
      class: 'row-open',
      type: 'button',
      'aria-label': `Preview ${item.name ?? item.url}`,
    },
    [thumb(item), meta(item)],
  );
  opener.addEventListener('click', () => openPreview(item, download));

  node.append(opener, actions(item));
}

function thumb(item: MediaItem): HTMLElement {
  const frame = el('div', { class: 'thumb', 'data-kind': item.kind, 'aria-hidden': 'true' });
  const source = posterSource(item);

  if (source === 'addon') {
    const ready = cached(item.thumbnail ?? '') ?? item.thumbnail;
    frame.append(el('img', { src: ready, alt: '', loading: 'lazy', class: 'thumb-img' }));
    watchImage(frame, item);
    return frame;
  }

  if (source === 'frame') {
    const already = cached(item.url);
    if (already) {
      frame.append(el('img', { src: already, alt: '', class: 'thumb-img' }));
      markPlay(frame);
      return frame;
    }
    /* Painted empty until the observer says the row is on screen. */
    frame.dataset.pending = 'true';
    markPlay(frame);
    queuePoster(frame, item);
    return frame;
  }

  if (item.kind === 'image' && !item.protected) {
    frame.append(el('img', { src: item.url, alt: '', loading: 'lazy', class: 'thumb-img' }));
    watchImage(frame, item);
    return frame;
  }

  frame.append(el('span', { class: 'thumb-kind' }, [KIND_LABELS[item.kind] ?? item.kind]));
  return frame;
}

const KIND_LABELS: Record<string, string> = {
  video: 'VIDEO',
  audio: 'AUDIO',
  stream: 'STREAM',
  document: 'FILE',
  image: 'IMAGE',
  font: 'FONT',
};

/** A small play mark, so a poster reads as video without relying on its frame. */
function markPlay(frame: HTMLElement): void {
  frame.append(el('span', { class: 'thumb-play', 'aria-hidden': 'true' }));
}

function watchImage(frame: HTMLElement, item: MediaItem): void {
  const image = frame.querySelector('img');
  image?.addEventListener(
    'error',
    () => {
      clear(frame);
      frame.append(el('span', { class: 'thumb-kind' }, [KIND_LABELS[item.kind] ?? item.kind]));
      if (item.kind === 'video') markPlay(frame);
    },
    { once: true },
  );
  if (item.kind === 'video') markPlay(frame);
}

/**
 * Rows ask for a poster once they are actually visible. A feed can hold
 * thousands of items and decoding all of them up front would be absurd.
 */
function queuePoster(frame: HTMLElement, item: MediaItem): void {
  const target = frame;
  const start = (): void => {
    unobserve(target);
    requestPoster(item.url, () => {
      const poster = cached(item.url);
      if (!poster) {
        target.removeAttribute('data-pending');
        target.append(el('span', { class: 'thumb-kind' }, ['VIDEO']));
        return;
      }
      target.removeAttribute('data-pending');
      clear(target);
      target.append(el('img', { src: poster, alt: '', class: 'thumb-img' }));
      markPlay(target);
    });
  };

  if (!observer) {
    start();
    return;
  }
  pending.set(target, start);
  observer.observe(target);
}

function unobserve(target: HTMLElement): void {
  observer?.unobserve(target);
  pending.delete(target);
}

const pending = new WeakMap<HTMLElement, () => void>();

let observer: IntersectionObserver | null = null;

function startObserver(): void {
  if (observer) return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = entry.target as HTMLElement;
        pending.get(target)?.();
      }
    },
    { root: listElement, rootMargin: '160px 0px' },
  );
}

/** Rows leaving the list must stop holding a pending generation. */
function releaseRow(node: HTMLElement): void {
  unobserve(node);
}

function meta(item: MediaItem): HTMLElement {
  const facts = [
    item.label,
    item.width && item.height ? `${item.width}x${item.height}` : undefined,
    item.duration ? duration(item.duration) : undefined,
    bytes(item.bytes),
    item.kind === 'stream' ? 'assembled on download' : undefined,
  ].filter(Boolean);

  const title = item.name ?? fileNameOf(item.url) ?? displayHost(item.url);

  return el('div', { class: 'row-main' }, [
    el('div', { class: 'row-name', title }, [title]),
    el('div', { class: 'row-meta' }, [facts.join('  ·  ')]),
  ]);
}

function actions(item: MediaItem): HTMLElement {
  const copy = el(
    'button',
    {
      class: 'act-quiet',
      type: 'button',
      title: 'Copy the URL',
      'aria-label': `Copy the URL for ${item.name ?? item.url}`,
      onClick: () =>
        void navigator.clipboard.writeText(item.url).then(() => toast('URL copied')),
    },
    ['Copy'],
  );

  const save = el(
    'button',
    {
      class: item.protected ? 'act-quiet' : 'act-primary',
      type: 'button',
      disabled: item.protected === true,
      title: item.protected ? (item.protectedReason ?? 'Protected') : 'Download',
      'aria-label': item.protected
        ? `Cannot download ${item.name ?? item.url}: protected`
        : `Download ${item.name ?? item.url}`,
      onClick: () => void download([item]),
    },
    [item.protected ? 'Protected' : item.kind === 'stream' ? 'Assemble' : 'Save'],
  );

  /*
   * A web font is offered twice: as the file the server sent, and as a plain
   * TrueType one. Windows will not install WOFF2, so the second is the one
   * most people actually want, but the first is the byte-exact original.
   */
  const ttf =
    item.kind === 'font' && !item.protected && supportsFontConversion()
      ? el(
          'button',
          {
            class: 'button',
            type: 'button',
            title: 'Save as TrueType, which Windows can install',
            'aria-label': `Save ${item.name ?? item.url} as TrueType`,
            onClick: () => void saveAsTtf(item),
          },
          ['TTF'],
        )
      : null;

  return el('div', { class: 'row-actions' }, ttf ? [copy, save, ttf] : [copy, save]);
}

/**
 * The sandboxed converter only exists where the manifest declares one, which
 * Firefox's does not. Offering a button that cannot work is worse than not
 * offering it.
 */
function supportsFontConversion(): boolean {
  return Array.isArray(api.runtime.getManifest().sandbox?.pages);
}

async function saveAsTtf(item: MediaItem): Promise<void> {
  const filename = buildFilename(
    item,
    state.settings?.filenameTemplate ?? DEFAULT_TEMPLATE,
    state.settings?.folder ?? '',
    1,
  );
  try {
    await saveFontAsTtf(item.url, filename);
  } catch (error) {
    console.warn('[kidnap] font conversion failed', error);
    /* A failed conversion is worth saying out loud: the button did nothing
       visible otherwise, and the usual causes are all user-fixable. */
    toast(error instanceof Error ? error.message : 'The font could not be converted.');
  }
}

function describeItem(item: MediaItem): string {
  return `${item.kind}, ${item.name ?? item.url}`;
}

/* ── Queue ──────────────────────────────────────────────────────────────── */

function renderQueue(): HTMLElement | null {
  const active = [...state.jobs.streams, ...state.jobs.direct].filter(
    (job) => job.state !== 'done',
  );
  if (active.length === 0) return null;

  const box = el('div', {
    class: 'queue',
    role: 'status',
    'aria-label': 'Downloads in progress',
  });
  for (const job of active) {
    /* Only a stream reports progress. A direct download is handed to the
       browser, which owns its own progress, so the bar is indeterminate. */
    const stream = 'progress' in job ? job : undefined;
    const detail = stream
      ? `${stateWord(stream.state)}${stream.detail ? `, ${stream.detail}` : ''}`
      : stateWord(job.state);

    const fill = el('div', {
      class: 'bar-fill',
      'data-indeterminate': stream ? undefined : true,
    });
    if (stream) fill.style.width = `${Math.round(stream.progress * 100)}%`;

    box.append(
      el('div', { class: 'queue-row' }, [
        el('div', {}, [
          el('div', { class: 'queue-name', title: job.filename }, [job.filename]),
          el('div', { class: 'queue-detail' }, [detail]),
          el('div', { class: 'bar-track' }, [fill]),
        ]),
        el(
          'button',
          {
            class: 'act-quiet',
            type: 'button',
            'aria-label': `Cancel ${job.filename}`,
            onClick: () => void request('job:cancel', { id: job.id }),
          },
          ['Cancel'],
        ),
      ]),
    );
  }
  return box;
}

function stateWord(state: DirectJob['state'] | StreamJob['state']): string {
  switch (state) {
    case 'queued':
      return 'Waiting';
    case 'running':
    case 'fetching':
      return 'Downloading';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    default:
      return 'Working';
  }
}

/* ── Commands ───────────────────────────────────────────────────────────── */

/**
 * Saving splits by kind on purpose. A manifest is not a file the browser can
 * save usefully, so handing an .m3u8 to the download manager would leave the
 * user with a playlist they cannot play. Streams go to the assembler instead.
 */
export async function download(items: MediaItem[]): Promise<void> {
  if (items.length === 0) return;

  const streams = items.filter((item) => item.kind === 'stream');
  const files = items.filter((item) => item.kind !== 'stream');

  let queued = 0;
  if (files.length > 0) {
    queued += (await request('download:direct', { items: files })).queued;
  }
  for (const item of streams) {
    await request('download:stream', { item });
    queued += 1;
  }

  toast(
    queued > 0 ? `Queued ${queued} item${queued === 1 ? '' : 's'}` : 'Nothing new to download',
  );
  await refresh();
}

async function downloadAll(): Promise<void> {
  await download(state.rows);
}

async function copyUrls(items: MediaItem[]): Promise<void> {
  await navigator.clipboard.writeText(items.map((item) => item.url).join('\n'));
  toast(`Copied ${items.length} URL${items.length === 1 ? '' : 's'}`);
}

async function copyAll(): Promise<void> {
  await copyUrls(state.rows);
}

function onSaved(settings: Settings): void {
  state.settings = settings;
  applyTheme(settings.theme);
  render();
}

addEventListener('pagehide', releaseAll);

applyTheme('system');
startObserver();
render();
void boot();
