import { describe, expect, it } from 'vitest';
import { isNavigation } from '../src/background/tabreset';

describe('isNavigation', () => {
  it('is true only when the tab actually went somewhere', () => {
    expect(isNavigation({ url: 'https://fonts.adobe.com/fonts/roboto' })).toBe(true);
  });

  it('is false for the status changes a slow page keeps reporting', () => {
    /*
     * The regression this guards: treating these as navigations wiped every
     * item a page had been detected on, repeatedly, with no error shown. A
     * catalogue page produced four of them in one load.
     */
    expect(isNavigation({ status: 'loading' })).toBe(false);
    expect(isNavigation({})).toBe(false);
    expect(isNavigation({ url: undefined, status: 'complete' })).toBe(false);
  });
});
