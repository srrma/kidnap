/*
 * Compares what the v2 extractors emitted against what the built-in add-ons
 * emit today, so "parity" is checked rather than asserted.
 *
 *   node scripts/parity.mjs [path-to-kidnap-v2]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const v2 = resolve(process.argv[2] ?? resolve(here, '../../kidnap-v2/src/lib/extractors'));

const FIELDS = {
  groupId: 'group',
  url: 'url',
  mime: 'mime',
  bitrate: 'bitrate',
  pageTitle: 'caption',
  thumbnail: 'thumbnail',
  resolution: 'width',
  author: 'author',
  postUrl: 'postUrl',
  postId: 'postId',
  uploadDate: 'published',
  duration: 'duration',
};

/** The v2 id for a v3 add-on id, where the two differ. */
const ALIAS = { x: 'twitter', bsky: 'bluesky' };

function v2Fields(file) {
  const src = readFileSync(`${v2}/${file}.ts`, 'utf8');
  return new Set([...src.matchAll(/(?:^|[{,]\s*)(\w+):\s*[`'"]/g)].map((m) => m[1]));
}

if (!existsSync(v2)) {
  console.error(`v2 extractors not found at ${v2}. Pass the path as the first argument.`);
  process.exit(2);
}

const src = readFileSync(resolve(here, '../src/addons/builtin.ts'), 'utf8');
const ids = [...src.matchAll(/\n {4}id: '([a-z]+)',/g)].map((m) => m[1]);

console.log('add-on'.padEnd(11), 'platform'.padEnd(10), 'fields v2 emitted that v3 does not');
let gaps = 0;
for (const id of ids) {
  const file = ALIAS[id] ?? id;
  if (!existsSync(`${v2}/${file}.ts`)) continue;
  const v2set = v2Fields(file);
  const missing = Object.entries(FIELDS)
    .filter(([v2name]) => v2set.has(v2name))
    .map(([, v3name]) => v3name)
    .filter((name) => !src.includes(`${name}:`) && !src.includes(`${name}?:`));
  gaps += missing.length;
  console.log(id.padEnd(11), file.padEnd(10), missing.length ? missing.join(', ') : 'none');
}

const covered = new Set(ids.map((id) => ALIAS[id] ?? id));
const dropped = [
  'twitter',
  'reddit',
  'instagram',
  'tiktok',
  'imgur',
  'bluesky',
  'twitch',
  'facebook',
].filter((name) => !covered.has(name));
console.log('\nplatforms in v2 with no add-on:', dropped.length ? dropped.join(', ') : 'none');
process.exit(gaps === 0 ? 0 : 1);
