/**
 * The preview sheet.
 *
 * Its job is to answer "is this the file I meant" before someone saves it, which
 * is why the media itself is the largest thing on screen and the metadata sits
 * underneath rather than beside it. A quality picker appears only when the item
 * genuinely has more than one rendition.
 */

import type { MediaItem } from '../core/types';
import { displayHost, fileNameOf } from '../core/url';
import { bytes, duration, el, sheet, toast } from './dom';
import { fontSpecimen } from './font';

export function openPreview(
  item: MediaItem,
  download: (items: MediaItem[]) => Promise<void>,
): void {
  /*
   * A font holds a fetched copy of itself in the document while its preview is
   * open, so it is released when the sheet closes rather than left behind.
   */
  let release: (() => void) | null = null;
  const media = mediaElement(item, (dispose) => {
    release = dispose;
  });
  const body = el('div', {}, [media, metaTable(item)]);

  const save = el(
    'button',
    {
      class: 'act-primary',
      type: 'button',
      disabled: item.protected === true,
    },
    [item.protected ? 'Protected' : item.kind === 'stream' ? 'Assemble and save' : 'Download'],
  );
  save.addEventListener('click', () => {
    close();
    void download([item]);
  });

  const copy = el('button', { class: 'act-quiet', type: 'button' }, ['Copy URL']);
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(item.url).then(() => toast('URL copied'));
  });

  const actions: HTMLElement[] = [save, copy];

  if (item.variants && item.variants.length > 1) {
    const picker = el('select', { 'aria-label': 'Quality' });
    item.variants.forEach((variant, index) => {
      const label =
        variant.width && variant.height
          ? `${variant.width}x${variant.height}${variant.bitrate ? ` at ${Math.round(variant.bitrate / 1000)} kbps` : ''}`
          : (variant.url.split('?')[0] ?? variant.url);
      picker.append(el('option', { value: String(index), selected: index === 0 }, [label]));
    });
    picker.addEventListener('change', () => {
      const chosen = item.variants?.[Number(picker.value)];
      if (!chosen) return;
      item.url = chosen.url;
      release?.();
      release = null;
      media.replaceWith(
        mediaElement(item, (dispose) => {
          release = dispose;
        }),
      );
      toast('Switched rendition');
    });
    actions.unshift(picker);
  }

  const close = sheet({
    title: item.name ?? fileNameOf(item.url) ?? displayHost(item.url),
    body,
    actions,
    onClose: () => release?.(),
  });
}

function mediaElement(item: MediaItem, onRelease: (dispose: () => void) => void): HTMLElement {
  const src = item.url;
  switch (item.kind) {
    case 'image':
      return el('img', {
        class: 'preview-media',
        src: item.thumbnail ?? src,
        alt: item.alt ?? '',
      });
    case 'video':
      return el('video', { class: 'preview-media', src, controls: true, preload: 'metadata' });
    case 'audio':
      return el('audio', { class: 'preview-media', src, controls: true, preload: 'metadata' });
    case 'document':
      return el('iframe', {
        class: 'preview-media',
        src,
        title: item.name ?? 'Document preview',
      });
    case 'font': {
      const specimen = fontSpecimen(item);
      onRelease(specimen.dispose);
      return specimen.node;
    }
    default:
      return el('div', { class: 'state' }, [
        el('div', { class: 'state-title' }, ['Segmented stream']),
        el('div', { class: 'state-detail' }, [
          'This arrives as many pieces. Saving it fetches every piece and joins them into one file, without re-encoding.',
        ]),
      ]);
  }
}

function metaTable(item: MediaItem): HTMLElement {
  const rows: Array<[string, string | undefined]> = [
    ['Type', item.kind],
    ['Size', item.bytes ? bytes(item.bytes) : undefined],
    ['Resolution', item.width && item.height ? `${item.width}x${item.height}` : item.label],
    ['Length', duration(item.duration)],
    ['Format', item.mime],
    ['Codecs', item.codecs],
    ['Bitrate', item.bitrate ? `${item.bitrate} kbps` : undefined],
    ['Author', item.author],
    ['Album', item.album],
    ['Track', item.track],
    ['Published', item.published ? new Date(item.published).toLocaleDateString() : undefined],
    ['Description', item.caption],
    ['Alt text', item.alt],
    ['Page', item.pageTitle],
    ['Found by', item.detector],
    ['Modified', item.lastModified],
    ['Source', item.url],
  ];

  const list = el('dl', { class: 'meta' });

  /*
   * Where the post lives. The row links it too, but the sheet is opened
   * because someone is deciding whether this is the file they meant, and
   * "which post was this" is the fastest way to that answer: it puts the file
   * back in the timeline next to its neighbours.
   */
  if (item.pageUrl) {
    list.append(
      el('dt', {}, ['Post']),
      el('dd', {}, [
        el('a', { href: item.pageUrl, target: '_blank', rel: 'noreferrer noopener' }, [
          item.postId ?? 'Open the post this came from',
        ]),
      ]),
    );
  }

  for (const [label, value] of rows) {
    if (!value) continue;
    list.append(el('dt', {}, [label]), el('dd', {}, [value]));
  }
  return rows.length > 0
    ? list
    : el('p', { class: 'state-detail' }, ['No further details were reported for this file.']);
}
