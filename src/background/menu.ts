/**
 * The right-click entry point.
 *
 * A context menu click is the one detection path the user drives directly, so
 * it bypasses the noise filter entirely: if someone right-clicked it and asked
 * for it, it is not a tracking pixel.
 */

import { classify } from '../core/kind';
import { fileNameOf } from '../core/url';
import { api } from '../platform';
import * as store from '../store/tab';
import { scheduleBadge } from './badge';

const MENU_ID = 'kidnap:capture';

export function registerMenu(): void {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: MENU_ID,
      title: 'Kidnap this media',
      contexts: ['image', 'video', 'audio', 'link'],
    });
  });
}

api.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  const url = info.srcUrl || info.linkUrl;
  if (tabId === undefined || tabId < 0 || !url) return;

  const kind = classify(url);
  if (!kind) return;

  void store
    .add(tabId, {
      url,
      kind,
      detector: 'dom',
      tabId,
      foundAt: Date.now(),
      name: fileNameOf(url),
    })
    .then(() => scheduleBadge(tabId));
});
