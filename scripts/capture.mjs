#!/usr/bin/env node
/**
 * Records the shape of every API response a site sends while you browse it.
 *
 * Two shapes for one endpoint cost this project twice on X: the rule looked
 * right and matched nothing, and nothing in the code could tell the difference.
 * A path that is merely plausible is indistinguishable from one that works
 * until a real page is loaded. This exists so nobody has to guess again.
 *
 *   node scripts/capture.mjs --site=x
 *   node scripts/capture.mjs --site=instagram
 *   SAVE=1 node scripts/capture.mjs --site=x        # also write the report
 *   BODIES=/tmp/ig node scripts/capture.mjs --site=instagram
 *   node scripts/capture.mjs --site=x --surfaces=home,search
 *   node scripts/capture.mjs --site=x --url=/someone/status/123
 *
 * It browses signed in and needs a cookie file, the same as the smoke harness.
 * It writes nothing into tests/ on its own: promoting a shape into a fixture
 * is deliberate, so the fixtures stay small and the ones that exist stay true.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

/**
 * Per site: where to browse, what counts as an API response, and which keys
 * mean "this response carries media". Only the third is really site specific;
 * the rest is plumbing.
 */
const SITES = {
  x: {
    id: 'x',
    label: 'X / Twitter',
    base: 'https://x.com',
    cookies: 'Downloads/x.com_cookies.txt',
    matches: (url) => /\/i\/api\/|api\.x\.com/.test(url),
    mediaKeys: ['extended_entities', 'video_info', 'media_url_https', 'media_key'],
    surfaces: [
      { name: 'home', url: '/home', scroll: 8 },
      { name: 'search-live', url: '/search?q=news&f=live', scroll: 4 },
      { name: 'search-top', url: '/search?q=news', scroll: 4 },
      { name: 'explore', url: '/explore', scroll: 4 },
      { name: 'notifications', url: '/notifications', scroll: 4 },
      { name: 'bookmarks', url: '/i/bookmarks', scroll: 3 },
      { name: 'profile', url: '/Interior', scroll: 5 },
      { name: 'profile-media', url: '/profile-media', scroll: 3 },
      { name: 'likes', url: '/likes', scroll: 3 },
      { name: 'messages', url: '/messages', scroll: 2 },
    ],
    /* Discovery fills these in from links found on the first surface. */
    discover: {
      profile: {
        from: 'home',
        selector: 'a[href^="/"][href$="/"]',
        strip: /(.*)\/$/,
        keep: /^(\/[^/]+)$/,
      },
      post: { from: 'home', selector: 'a[href*="/status/"]', strip: /\?.*$/ },
    },
    /* Where to look for the user object, for reporting how it is shaped. */
    userProbe: (node) => node?.core?.user_results?.result ?? null,
  },

  facebook: {
    id: 'facebook',
    label: 'Facebook',
    base: 'https://www.facebook.com',
    cookies: 'Downloads/www.facebook.com_cookies.txt',
    matches: (url) => /\/api\/graphql|\/ajax\/|\/video\/unified|\/api\/v/.test(url),
    mediaKeys: [
      'playable_url',
      'browser_native_hd_url',
      'playable_url_quality_hd',
      'photo_image',
    ],
    surfaces: [
      { name: 'feed', url: '/', scroll: 8 },
      { name: 'explore', url: '/explore', scroll: 4 },
      { name: 'watch', url: '/watch', scroll: 3 },
      { name: 'marketplace', url: '/marketplace', scroll: 4 },
      { name: 'groups', url: '/groups', scroll: 3 },
    ],
    discover: {
      post: {
        from: 'feed',
        selector: 'a[href*="/watch"], a[href*="/videos/"], a[href*="/photo"]',
        strip: /\?.*$/,
      },
    },
    userProbe: (node) => node?.actor ?? node?.from ?? node?.owner ?? null,
  },

  instagram: {
    id: 'instagram',
    label: 'Instagram',
    base: 'https://www.instagram.com',
    cookies: 'Downloads/www.instagram.com_cookies.txt',
    matches: (url) => /\/graphql\/query|\/api\/graphql|\/api\/v1\//.test(url),
    mediaKeys: [
      'image_versions2',
      'video_versions',
      'carousel_media',
      'display_url',
      'video_url',
      'thumbnail_src',
      'original_width',
    ],
    surfaces: [
      { name: 'home', url: '/', scroll: 8 },
      { name: 'explore', url: '/explore/', scroll: 4 },
      { name: 'reels', url: '/explore/reels/', scroll: 3 },
      { name: 'direct', url: '/direct/inbox/', scroll: 2 },
    ],
    discover: {
      profile: {
        from: 'home',
        selector: 'a[href^="/"]',
        strip: /\?.*$/,
        /* One segment, and not one of the site's own routes. */
        /*
         * Instagram writes every profile link with a trailing slash, and every
         * one of its own routes with one too, so the deny list has to be
         * written the same way or the capture opens /reels/ and calls it a
         * profile.
         */
        keep: /^\/(?!p\/|reel\/|reels\/|explore\/|direct\/|accounts\/|stories\/|tv\/|about\/|legal\/|language\/|web\/|popular\/|developer\/|[a-z]+\.com\/)[A-Za-z0-9._]{2,30}\/$/,
      },
      post: {
        from: 'home',
        selector: 'a[href*="/p/"], a[href*="/reel/"]',
        strip: /\?.*$/,
        keep: /^\/(p|reel|reels)\/[A-Za-z0-9_-]{5,}\/$/,
      },
    },
    userProbe: (node) => node?.user ?? node?.owner ?? null,
  },
};

/**
 * Every path at which a media field appears, relative to the response root.
 *
 * The walk stops descending a branch once it has matched, because a media
 * object contains several of these keys and only the path to the object is
 * useful.
 */
function mediaPaths(node, keys, path = '', depth = 0, found = []) {
  if (depth > 26 || found.length > 400 || !node || typeof node !== 'object') return found;

  if (Array.isArray(node)) {
    for (const value of node.slice(0, 4))
      mediaPaths(value, keys, `${path}[]`, depth + 1, found);
    return found;
  }

  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (keys.includes(key)) {
      found.push(next);
      continue;
    }
    mediaPaths(value, keys, next, depth + 1, found);
  }
  return found;
}

const rootsOf = (body) => Object.keys(body?.data ?? body ?? {}).slice(0, 12);

/**
 * Paths to values that look like a media URL.
 *
 * Key names are a guess until seen, but a URL on a CDN with a media extension
 * is not. This finds the placeholders in a response nobody has documented yet,
 * which is what it was needed for on Facebook.
 */
const MEDIA_URL = /\.(jpe?g|png|webp|gif|mp4|m4v|mov|webm)(\?|$)/i;

function urlPaths(node, path = '', depth = 0, found = []) {
  if (depth > 26 || found.length > 300 || !node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const value of node.slice(0, 4)) urlPaths(value, `${path}[]`, depth + 1, found);
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (typeof value === 'string' && MEDIA_URL.test(value)) {
      found.push(`${next}  =  ${value.slice(0, 64)}`);
      continue;
    }
    urlPaths(value, next, depth + 1, found);
  }
  return found;
}

/**
 * Reports how the user object is shaped, because a site has changed one of
 * these before and nothing else in a response hints that it happened.
 */
function userShape(body, probe) {
  const hits = new Set();
  const walk = (node, depth = 0) => {
    if (depth > 22 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const v of node.slice(0, 5)) walk(v, depth + 1);
      return;
    }
    const user = probe(node);
    if (user && typeof user === 'object') {
      hits.add(Object.keys(user).slice(0, 12).join(','));
      return;
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(body);
  return [...hits];
}

function readCookies(file) {
  const cookies = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
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
  return cookies;
}

async function run(site) {
  const cookieFile = process.env.COOKIES ?? resolve(process.env.HOME, site.cookies);
  const ctx = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), 'kidnap-capture-')),
    {
      headless: false,
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        '--no-first-run',
      ],
      viewport: { width: 1400, height: 900 },
    },
  );

  const bodies = process.env.BODIES ? resolve(root, process.env.BODIES) : null;
  if (bodies) mkdirSync(bodies, { recursive: true });

  const responses = new Map();
  const page = await ctx.newPage();
  await ctx.addCookies(readCookies(cookieFile));

  let current = 'startup';

  /**
   * A response's own URL rarely names the operation: Instagram posts it in the
   * request body. Capturing that is the only way to tell one operation from
   * another, and without it every response collapses into one anonymous
   * endpoint and the report says nothing about which surface it came from.
   */
  const operationByUrl = new Map();
  page.on('request', (request) => {
    if (!site.matches(request.url())) return;
    const data = request.postData();
    if (!data) return;
    try {
      const parsed = JSON.parse(data);
      const name = parsed?.fb_api_req_body?.doc_id ?? parsed?.doc_id ?? parsed?.operationName;
      if (name) operationByUrl.set(request.url(), String(name));
    } catch {
      /* not json, nothing to learn from it */
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (!site.matches(url)) return;
    const parsed = new URL(url);
    const trimmed = parsed.pathname.replace(/^\/(api\/v1|api|graphql\/query)\/?/, '');
    /*
     * A site names its operation in a different parameter: X uses query_hash,
     * Instagram uses doc_id. Without the right one every response collapses
     * into a single anonymous endpoint and the report says nothing.
     */
    const named =
      parsed.searchParams.get('query_hash') ??
      parsed.searchParams.get('query_id') ??
      parsed.searchParams.get('doc_id') ??
      operationByUrl.get(url);
    const name = named ? `${trimmed || parsed.pathname}#${named}` : trimmed || parsed.pathname;
    let body;
    try {
      body = await response.json();
    } catch {
      return;
    }
    const paths = [...new Set(mediaPaths(body, site.mediaKeys))].sort();

    /* Kept only for endpoints that carry media, and only the first response of
       each, so a capture stays small enough to read. */
    if (bodies && paths.length > 0 && !responses.has(name)) {
      writeFileSync(
        join(
          bodies,
          `${String(name)
            .replace(/[^\w.-]/g, '_')
            .slice(0, 80)}.json`,
        ),
        JSON.stringify(body),
      );
    }

    const entry = responses.get(name) ?? {
      name: String(name),
      surfaces: new Set(),
      roots: new Set(),
      users: new Set(),
      media: new Set(),
      urls: new Set(),
      bytes: 0,
      calls: 0,
    };
    entry.surfaces.add(current);
    entry.roots.add(rootsOf(body).join('.'));
    for (const u of userShape(body, site.userProbe)) entry.users.add(u);
    for (const p of paths) entry.media.add(p);
    for (const p of urlPaths(body)) entry.urls.add(p);
    entry.bytes = Math.max(entry.bytes, JSON.stringify(body).length);
    entry.calls += 1;
    responses.set(name, entry);
  });

  const surfaces = [...site.surfaces];
  const extra = process.argv
    .filter((a) => a.startsWith('--url='))
    .map((a, i) => ({ name: `extra${i}`, url: a.slice(6), scroll: 3 }));

  try {
    /*
     * A queue rather than a for-of over a copy: discovered surfaces are pushed
     * on while the loop runs, and have to be visited in the same pass or the
     * capture has to be run twice before it is worth anything.
     */
    const queue = [...surfaces, ...extra];
    for (let index = 0; index < queue.length; index += 1) {
      const surface = queue[index];
      if (only && surface.discovered && !only.split(',').includes(surface.name)) continue;
      current = surface.name;
      console.error(`> ${site.label} ${surface.name} ${surface.url}`);
      /*
       * Capped: one surface that never settles must not cost the whole
       * capture, and a discovered link is the least predictable thing here.
       */
      try {
        await Promise.race([
          page.goto(new URL(surface.url, site.base).href, { waitUntil: 'domcontentloaded' }),
          new Promise((_r, reject) =>
            setTimeout(() => reject(new Error('navigation timed out')), 25_000),
          ),
        ]);
      } catch (error) {
        console.error(`  (${String(error).slice(0, 60)})`);
        continue;
      }
      await page.waitForTimeout(5000);
      for (let i = 0; i < (surface.scroll ?? 3); i += 1) {
        await page.mouse.wheel(0, 1600);
        await page.waitForTimeout(1500);
      }

      /*
       * Discovered surfaces hang off the first one: a profile and a post are
       * only worth opening once we know they exist, and hardcoding a username
       * is how a capture goes stale without anyone noticing.
       */
      for (const [name, rule] of Object.entries(site.discover ?? {})) {
        if (surfaces.some((s) => s.name === name)) continue;
        const href = await page
          .locator(rule.selector)
          .evaluateAll(
            (nodes, info) => {
              const keep = info.keep ? new RegExp(info.keep.source) : null;
              for (const node of nodes) {
                const href = node.getAttribute('href');
                if (!href) continue;
                const clean = info.strip
                  ? href.replace(new RegExp(info.strip.source, info.strip.flags), '$1')
                  : href;
                if (keep && !keep.test(clean)) continue;
                return clean;
              }
              return null;
            },
            { strip: rule.strip, keep: rule.keep },
          )
          .catch(() => null);
        if (!href) {
          console.error(`  (no ${name} link found)`);
          continue;
        }
        console.error(`  discovered ${name} -> ${href}`);
        queue.push({ name, url: href, scroll: name === 'post' ? 2 : 5, discovered: true });
      }
    }
  } finally {
    await ctx.close();
  }

  const report = [...responses.values()]
    .map((e) => ({
      endpoint: e.name,
      seenOn: [...e.surfaces].sort(),
      calls: e.calls,
      bytes: e.bytes,
      roots: [...e.roots].sort(),
      userObject: [...e.users].sort(),
      media: [...e.media].sort(),
      urls: [...e.urls].sort(),
    }))
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint));

  const withMedia = report.filter((r) => r.media.length > 0 || r.urls.length > 0);
  console.log(`\n${site.label}: ${report.length} endpoints, ${withMedia.length} carry media\n`);
  for (const entry of withMedia) {
    console.log(`## ${entry.endpoint}  (${entry.seenOn.join(', ')})`);
    console.log(`   roots: ${entry.roots.join(' | ')}`);
    for (const u of entry.userObject) console.log(`   user object keys: ${u}`);
    for (const p of entry.media) console.log(`   ${p}`);
    for (const p of entry.urls.slice(0, 24)) console.log(`   ? ${p}`);
    console.log('');
  }
  if (withMedia.length === 0) {
    console.log('no endpoint carried media; the report below lists what did respond');
    for (const entry of report)
      console.log(`   ${entry.endpoint} (${entry.seenOn.join(', ')})`);
  }

  if (process.env.SAVE) {
    const out = resolve(root, `captures/${site.id}-responses.json`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`written: ${out}`);
  }
}

const siteId = process.argv.find((a) => a.startsWith('--site='))?.slice(7) ?? 'x';
const site = SITES[siteId];
if (!site) {
  console.error(`unknown site "${siteId}". Known: ${Object.keys(SITES).join(', ')}`);
  process.exit(1);
}
const only = process.argv.find((a) => a.startsWith('--surfaces='))?.slice(11);
if (only) site.surfaces = site.surfaces.filter((s) => only.split(',').includes(s.name));
site.surfaces = site.surfaces.map((s) => ({ ...s }));

await run(site);
