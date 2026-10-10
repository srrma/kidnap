/**
 * When a tab's captured media belongs to a page that no longer exists.
 *
 * The status is not enough to ask about: a page that keeps loading reports
 * 'loading' repeatedly, and each report would wipe what the detectors had just
 * found. An Adobe Fonts catalogue produced four such events and lost all
 * eighteen fonts it had read seconds earlier, with no error anywhere.
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
