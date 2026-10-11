#!/usr/bin/env node
/**
 * Measures every built-in add-on against the payload fixtures.
 *
 * The rule this exists to enforce is simple and was learned twice: an add-on
 * whose fixture was written by hand proves nothing, because the fixture was
 * written to agree with the rule. Two platforms were found extracting nothing
 * from the live site while passing every test written for them, and in both
 * cases the fixture had been built to match the rule rather than cut from a
 * capture.
 *
 * So this answers one question per add-on: given a payload that came off the
 * real site, how many rows come out, and do they carry the metadata a person
 * would recognise them by?
 *
 *   node scripts/coverage.mjs
 *
 * Rows of zero are not a failure on their own. They mean the fixture is not
 * exercising the add-on, which is worth knowing and is printed as such rather
 * than hidden behind a passing suite.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_ADDONS } from '../src/addons/builtin.ts';
import { AddonRegistry } from '../src/addons/engine.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = resolve(root, 'tests/fixtures');

/**
 * Which add-on each fixture belongs to, and the URL shape it was served under.
 *
 * The URL is the point: an add-on claims a request by host and path before it
 * looks at the body at all, so a fixture exercised under the wrong URL would
 * report zero for a reason that has nothing to do with the rules.
 */
const FIXTURES = {
  'x-status.json': ['x', 'https://x.com/i/api/graphql/abc/TweetResultByRestId'],
  'x-tweet-detail.json': ['x', 'https://x.com/i/api/graphql/abc/TweetDetail'],
  'x-live-tweet-detail.json': ['x', 'https://x.com/i/api/graphql/abc/TweetDetail'],
  'x-home-timeline.json': ['x', 'https://x.com/i/api/graphql/abc/HomeTimeline'],
  'x-search-timeline.json': ['x', 'https://x.com/i/api/graphql/abc/SearchTimeline'],
  'x-user-timeline.json': ['x', 'https://x.com/i/api/graphql/abc/UserOriginalsTimeline'],
  'x-user-video-timeline.json': ['x', 'https://x.com/i/api/graphql/abc/UserVideoTimeline'],
  'x-bookmarks.json': ['x', 'https://x.com/i/api/graphql/abc/Bookmarks'],
  'x-thread.json': ['x', 'https://x.com/i/api/graphql/abc/ThreadedConversation'],
  'x-photo-status.json': ['x', 'https://x.com/i/api/graphql/abc/TweetResultByRestId'],
  'tiktok-item.json': ['tiktok', 'https://www.tiktok.com/api/post/item_list/'],
  'imgur-gallery.json': ['imgur', 'https://api.imgur.com/3/gallery/album/abc'],
  'instagram-feed.json': ['instagram', 'https://www.instagram.com/graphql/query'],
  'instagram-explore.json': [
    'instagram',
    'https://www.instagram.com/discover/web/explore_grid/',
  ],
  'bsky-feed.json': ['bsky', 'https://public.api.bsky.app/xrpc/app.bsky.feed.getTimeline'],
  'pinterest-home.json': [
    'pinterest',
    'https://www.pinterest.com/resource/UserHomefeedResource/get/',
  ],
  'pinterest-search.json': [
    'pinterest',
    'https://www.pinterest.com/resource/BaseSearchResource/get/',
  ],
  'behance-feed.json': ['behance', 'https://www.behance.net/v3/graphql'],
  'behance-search.json': ['behance', 'https://www.behance.net/v3/graphql'],
  'adobe-font-family.json': ['adobe-fonts', 'https://fonts.adobe.com/fonts/roboto'],
  'adobe-font-collection.json': [
    'adobe-fonts-collections',
    'https://fonts.adobe.com/collections/x',
  ],
};

/** Fixtures written by hand to satisfy a rule rather than cut from a capture. */
const HAND_WRITTEN = new Set([
  'x-status.json',
  'x-thread.json',
  'x-photo-status.json',
  'tiktok-item.json',
  'imgur-gallery.json',
]);

const registry = new AddonRegistry(BUILTIN_ADDONS);
const available = new Set(readdirSync(fixtures));
const byAddon = new Map();

for (const [file, [addonId, url]] of Object.entries(FIXTURES)) {
  if (!available.has(file)) continue;
  const body = JSON.parse(readFileSync(resolve(fixtures, file), 'utf8'));
  const items = registry.extract(url, body, 1);
  const entry = byAddon.get(addonId) ?? { rows: 0, fixtures: [], withAuthor: 0 };
  entry.rows += items.length;
  entry.withAuthor += items.filter((i) => i.author).length;
  entry.fixtures.push({ file, rows: items.length, hand: HAND_WRITTEN.has(file) });
  byAddon.set(addonId, entry);
}

console.log('add-on'.padEnd(26), 'rows'.padStart(5), 'author'.padStart(7), '  provenance');
console.log('-'.repeat(78));

let unverified = 0;
for (const addon of BUILTIN_ADDONS) {
  const entry = byAddon.get(addon.id);
  if (!entry) {
    console.log(addon.id.padEnd(26), '     -', '      -', 'no fixture wired into this check');
    unverified += 1;
    continue;
  }
  const allHand = entry.fixtures.every((f) => f.hand);
  const label = allHand
    ? 'hand-written only'
    : entry.fixtures.some((f) => f.hand)
      ? 'mixed'
      : 'captured';
  console.log(
    addon.id.padEnd(26),
    String(entry.rows).padStart(5),
    String(entry.withAuthor).padStart(7),
    `  ${label} (${entry.fixtures.length})`,
  );
  if (entry.rows === 0) {
    console.log(
      ' '.repeat(26),
      '        ',
      `  no rows from ${entry.fixtures.map((f) => f.file).join(', ')}`,
    );
  }
}

console.log('-'.repeat(78));
console.log('A row count of zero means the fixture is not exercising the add-on, not that');
console.log('the add-on is broken. A fixture written by hand is not evidence either way.');
if (unverified > 0) console.log(`\n${unverified} add-on(s) have no fixture in this check.`);
