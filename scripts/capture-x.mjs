#!/usr/bin/env node
/**
 * Records the shape of every X response the browser is asked for.
 *
 * Two shapes for one endpoint is what cost this project twice. The rules in
 * src/addons/builtin.ts were written by reading paths, and a path that was
 * merely plausible looks exactly like one that works until a page is loaded and
 * nothing appears. This exists so that nobody has to guess again: run it, and
 * the map is whatever the site actually sent.
 *
 *   node scripts/capture-x.mjs                     # report to stdout
 *   SAVE=1 node scripts/capture-x.mjs              # also write the report
 *   node scripts/capture-x.mjs --url=/<user>       # one extra surface
 *   node scripts/capture-x.mjs --surfaces=home,search-live
 *   BODIES=/tmp/x node scripts/capture-x.mjs        # keep the payloads too
 *
 * It browses as the signed-in user and needs the cookie file, the same as the
 * smoke harness. It writes nothing into tests/ on its own; promoting a shape
 * into a fixture is a deliberate act, so that the fixtures stay small and the
 * ones that exist stay true.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const BASE = 'https://x.com';

/** Fields that mean a response carries media, whatever it calls it. */
const MEDIA_KEYS = ['extended_entities', 'video_info', 'media_url_https', 'media_key'];

/**
 * The surfaces worth opening. Each is one entry point that produces a different
 * response shape, which is the whole point: the shapes differ per surface, not
 * per payload.
 */
const SURFACES = [
  { name: 'home', url: '/home', scroll: 8 },
  { name: 'search-live', url: '/search?q=news&f=live', scroll: 4 },
  { name: 'search-top', url: '/search?q=news', scroll: 4 },
  { name: 'explore', url: '/explore', scroll: 4 },
  { name: 'notifications', url: '/notifications', scroll: 4 },
  { name: 'bookmarks', url: '/i/bookmarks', scroll: 3 },
  { name: 'profile', url: '/Interior', scroll: 5 },
  { name: 'profile-media', url: '/Interior/media', scroll: 3 },
  { name: 'likes', url: '/Interior/likes', scroll: 3 },
  { name: 'messages', url: '/messages', scroll: 2 },
];

/**
 * Every path at which a media field appears, relative to the response root.
 *
 * The walk stops descending a branch once it has matched, because a media
 * object contains several of these keys and only the path to the object is
 * useful; the report would otherwise be thousands of near-identical lines.
 */
function mediaPaths(node, path = '', depth = 0, found = []) {
  if (depth > 26 || found.length > 400 || !node || typeof node !== 'object') return found;

  if (Array.isArray(node)) {
    for (const value of node.slice(0, 4)) mediaPaths(value, `${path}[]`, depth + 1, found);
    return found;
  }

  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (MEDIA_KEYS.includes(key)) {
      found.push(next);
      continue;
    }
    mediaPaths(value, next, depth + 1, found);
  }
  return found;
}

/** The top level keys, so two responses of the same endpoint can be compared. */
function rootsOf(body) {
  const data = body?.data;
  if (!data || typeof data !== 'object') return Object.keys(body ?? {}).slice(0, 8);
  return Object.keys(data).slice(0, 12);
}

/**
 * A user object used to carry a legacy wrapper and now does not, which cost a
 * whole debugging session. Worth reporting on every response rather than
 * discovering it one platform at a time.
 */
function userShape(body) {
  const hits = [];
  const walk = (node, depth = 0) => {
    if (depth > 22 || !node || typeof node !== 'object' || hits.length > 2) return;
    if (Array.isArray(node)) {
      for (const v of node.slice(0, 4)) walk(v, depth + 1);
      return;
    }
    if (node.core?.user_results?.result) {
      const user = node.core.user_results.result;
      hits.push(user.core ? 'core' : user.legacy ? 'legacy' : 'neither');
      return;
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(body);
  return [...new Set(hits)];
}

async function run() {
  const cookieFile =
    process.env.COOKIES ?? resolve(process.env.HOME, 'Downloads/x.com_cookies.txt');
  const cookies = [];
  for (const line of readFileSync(cookieFile, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 7) continue;
    cookies.push({
      name: f[5],
      value: f[6],
      domain: f[0],
      path: f[2],
      expires: -1,
      httpOnly: false,
      secure: f[3] === 'TRUE',
      sameSite: 'Lax',
    });
  }

  const only = process.argv.find((a) => a.startsWith('--surfaces='))?.slice(11);
  const wanted = only ? new Set(only.split(',')) : null;

  const extra = process.argv
    .filter((a) => a.startsWith('--url='))
    .map((a) => ({ name: `extra${a}`, url: a.slice(6), scroll: 3 }));

  const profile = mkdtempSync(join(tmpdir(), 'kidnap-x-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--no-first-run'],
    viewport: { width: 1400, height: 900 },
  });

  const bodies = process.env.BODIES ? resolve(root, process.env.BODIES) : null;
  if (bodies) mkdirSync(bodies, { recursive: true });

  const responses = new Map();
  const page = await ctx.newPage();
  await ctx.addCookies(cookies);

  page.on('response', async (response) => {
    const url = response.url();
    if (!/\/i\/api\/|api\.x\.com/.test(url)) return;
    const name = new URL(url).pathname.split('/').pop() ?? url;
    let body;
    try {
      body = await response.json();
    } catch {
      return;
    }
    const paths = [...new Set(mediaPaths(body))].sort();
    /*
     * Kept only for endpoints that actually carry media, and only the first
     * response of each, so a capture stays small enough to read.
     */
    if (bodies && paths.length > 0 && !responses.has(name)) {
      writeFileSync(join(bodies, `${name}.json`), JSON.stringify(body));
    }
    const entry = responses.get(name) ?? {
      name,
      surfaces: new Set(),
      roots: new Set(),
      userShapes: new Set(),
      mediaPaths: new Set(),
      bytes: 0,
      calls: 0,
    };
    entry.surfaces.add(current);
    entry.roots.add(rootsOf(body).join('.'));
    for (const u of userShape(body)) entry.userShapes.add(u);
    for (const p of paths) entry.mediaPaths.add(p);
    entry.bytes = Math.max(entry.bytes, JSON.stringify(body).length);
    entry.calls += 1;
    responses.set(name, entry);
  });

  let current = 'startup';
  try {
    for (const surface of [...SURFACES, ...extra]) {
      if (wanted && !wanted.has(surface.name)) continue;
      current = surface.name;
      console.error(`> ${surface.name} ${surface.url}`);
      try {
        await page.goto(new URL(surface.url, BASE).href, { waitUntil: 'domcontentloaded' });
      } catch {
        continue;
      }
      await page.waitForTimeout(5000);
      for (let i = 0; i < surface.scroll; i += 1) {
        await page.mouse.wheel(0, 1600);
        await page.waitForTimeout(1500);
      }
    }
  } finally {
    await ctx.close();
  }

  const report = [...responses.values()]
    .map((entry) => ({
      endpoint: entry.name,
      seenOn: [...entry.surfaces].sort(),
      calls: entry.calls,
      bytes: entry.bytes,
      roots: [...entry.roots].sort(),
      userObject: [...entry.userShapes].sort(),
      media: [...entry.mediaPaths].sort(),
    }))
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint));

  const withMedia = report.filter((r) => r.media.length > 0);
  const text = JSON.stringify(report, null, 2);

  console.log(`\n${report.length} endpoints, ${withMedia.length} of them carry media\n`);
  for (const entry of withMedia) {
    console.log(`## ${entry.endpoint}  (${entry.seenOn.join(', ')})`);
    console.log(`   roots: ${entry.roots.join(' | ')}`);
    if (entry.userObject.length > 0)
      console.log(`   user object: ${entry.userObject.join(', ')}`);
    for (const p of entry.media) console.log(`   ${p}`);
    console.log('');
  }

  if (process.env.SAVE) {
    const out = resolve(root, 'captures/x-responses.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${text}\n`);
    console.error(`written: ${out}`);
  }
}

await run();
