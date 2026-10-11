/**
 * The toolbar count.
 *
 * Writes are coalesced on a timer because detection arrives in bursts, and a
 * page can report hundreds of items in one go. Updating the badge per item
 * would mean hundreds of extension API calls for one number.
 *
 * This lives in its own module because both the service worker entry and the
 * context menu need it, and importing the entry from the menu to reach it would
 * be a cycle.
 */

import { api, supportsBadge } from '../platform';
import * as store from '../store/tab';

const pending = new Map<number, ReturnType<typeof setTimeout>>();

export function scheduleBadge(tabId: number): void {
  if (!supportsBadge()) return;
  if (pending.has(tabId)) return;

  pending.set(
    tabId,
    setTimeout(() => {
      pending.delete(tabId);
      void refreshBadge(tabId);
    }, 250),
  );
}

async function refreshBadge(tabId: number): Promise<void> {
  if (!supportsBadge()) return;
  try {
    const count = await store.count(tabId);
    await api.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
    if (count > 0) {
      await api.action.setBadgeBackgroundColor({ tabId, color: '#e94560' });
    }
  } catch {
    /* the tab was closed while the badge was being set */
  }
}
