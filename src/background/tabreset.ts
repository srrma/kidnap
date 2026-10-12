/**
 * When a tab's captured media belongs to a page that no longer exists.
 *
 * The status is not enough to ask about: a page that keeps loading reports
 * 'loading' repeatedly, and treating each report as a navigation discards
 * everything detected so far, without an error anywhere to show for it.
 *
 * Only a real navigation reports a url, so that is what is asked about.
 */

export interface TabChange {
  url?: string;
  status?: string;
}

export function isNavigation(change: TabChange): boolean {
  return change.url !== undefined;
}
