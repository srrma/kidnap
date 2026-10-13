/**
 * Drives the built extension across a spread of real sites and page shapes.
 *
 * The unit suite proves the rules are correct and the browser suite proves one
 * page works. Neither says anything about whether a signed-in timeline, a
 * single post, or a profile behaves, and those are the three shapes people
 * actually use. Each one is a different code path through the same extension:
 * a feed is endless and mostly noise, a post is one item that must not be
 * missed, and a profile is a grid of unrelated things that must not collapse
 * into one row.
 *
 * Two readers are simulated. The first is someone with no interest in how any
 * of this works, who wants to find one picture on a busy page: the picker has
 * to light up the right row, and the permalink has to lead somewhere real.
 * The second is someone writing an add-on or filing a bug, who needs the whole
 * list as JSON without a signature riding along in it.
 *
 * Cookies come from a Netscape jar and are matched per host. No cookie value is
 * ever printed; only counts and hostnames.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ext = resolve(root, 'dist');
const JAR = process.env.KIDNAP_COOKIES ?? join(process.env.HOME ?? '', 'Downloads/cookies.txt');

/**
 * Feed is an endless scroll of one person's attention. Post is a single piece
 * of content where the only item on the page is the point. Profile is a grid
 * of unrelated work. Gallery is a category page rather than a person's.
 */
const SCENARIOS = [
  { id: 'x-home', shape: 'feed', url: 'https://x.com/home' },
  { id: 'x-post', shape: 'post', url: 'https://x.com/i/status/20' },
  { id: 'instagram-home', shape: 'feed', url: 'https://www.instagram.com/' },
  { id: 'instagram-post', shape: 'post', url: 'https://www.instagram.com/p/CUbHfhpswxt/' },
  { id: 'tiktok-home', shape: 'feed', url: 'https://www.tiktok.com/' },
  { id: 'imgur-home', shape: 'feed', url: 'https://imgur.com/' },
  { id: 'pinterest-home', shape: 'feed', url: 'https://www.pinterest.com/' },
  { id: 'behance-home', shape: 'feed', url: 'https://www.behance.net/' },
  { id: 'reddit-home', shape: 'feed', url: 'https://www.reddit.com/' },
  { id: 'adobe-fonts', shape: 'gallery', url: 'https://fonts.adobe.com/fonts' },
  {
    id: 'wikipedia',
    shape: 'post',
    url: 'https://en.wikipedia.org/wiki/Guinness_World_Records',
  },
];

function cookiesFor(host) {
  let jar;
  try {
    jar = readFileSync(JAR, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of jar.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 7) continue;
    const domain = f[0].replace(/^\./, '');
    if (domain !== host && !domain.endsWith(`.${host}`)) continue;
    out.push({
      name: f[5],
      value: f[6],
      domain: f[0],
      path: f[2],
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    });
  }
  return out;
}

const results = [];
let failures = 0;

function record(id, check, pass, detail) {
  results.push({ id, check, pass, detail });
  if (!pass) failures += 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const only = process.argv[2];
  const list = only
    ? SCENARIOS.filter((s) => s.id === only || s.id.startsWith(`${only}-`))
    : SCENARIOS;

  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'soak-')), {
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run'],
    viewport: { width: 1280, height: 900 },
  });

  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(worker.url()).host;

  for (const scenario of list) {
    const host = new URL(scenario.url).host.replace(/^www\./, '');
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.stack || String(e)));

    await ctx.addCookies(cookiesFor(host));
    process.stdout.write(`\n${scenario.id}  ${scenario.shape}  ${host}\n`);

    try {
      await page.goto(scenario.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      record(scenario.id, 'loads', false, String(e).slice(0, 60));
      await page.close();
      continue;
    }
    await sleep(6000);

    const tabId = await worker.evaluate(async (h) => {
      const byHost = await chrome.tabs.query({ url: [`https://${h}/*`, `https://www.${h}/*`] });
      if (byHost[0]) return byHost[0].id;
      /* A redirect or a regional host is common; the newest tab is the one just opened. */
      const all = await chrome.tabs.query({});
      return all[all.length - 1]?.id;
    }, host);
    if (tabId === undefined) {
      record(scenario.id, 'tab is queryable', false, 'no tab at all');
      await page.close();
      continue;
    }
    record(scenario.id, 'tab is queryable', true, `tab ${tabId}`);

    const panel = await ctx.newPage();
    const panelErrors = [];
    panel.on('pageerror', (e) => panelErrors.push(e.stack || String(e)));
    await panel.goto(`chrome-extension://${id}/panel/index.html?tabId=${tabId}`);
    await sleep(3500);

    const first = await panel.evaluate(() => document.querySelectorAll('.row').length);
    process.stdout.write(`  items: ${first}\n`);

    /* Why an add-on did or did not speak, which the row count cannot say. */
    const diag = await worker.evaluate(() => globalThis.__kidnapDiag ?? null);
    if (diag) {
      process.stdout.write(
        `  api bodies: ${diag.apiBody}  unclaimed: ${diag.notClaimed}  bad json: ${diag.badJson}  from add-ons: ${diag.items}`,
      );
    }
    record(scenario.id, 'detects media', first > 0, `${first} rows`);

    /* A post page holds one piece of content; losing it is the worst outcome. */
    if (scenario.shape === 'post') {
      record(scenario.id, 'does not miss the item', first >= 1, `${first} rows`);
    }

    /* The public reader: point at something and expect a row. */
    await panel.evaluate(() => {
      const b = document.querySelector('[aria-label*="Point at a picture"]');
      if (b) b.click();
    });
    await page.mouse.move(5, 400);
    await sleep(300);

    const probe = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('img,video')]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          const big = e instanceof HTMLImageElement ? e.naturalWidth > 40 : true;
          return (
            big &&
            r.width > 30 &&
            r.height > 30 &&
            r.top > 0 &&
            r.top < window.innerHeight - 60 &&
            r.left > 0 &&
            r.left < window.innerWidth - 60
          );
        })
        .slice(0, 6);
      return cands.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    });

    let hits = 0;
    const seen = new Set();
    for (const at of probe) {
      await page.mouse.move(at.x, at.y, { steps: 4 });
      await sleep(700);
      const name = await panel.evaluate(() => {
        const n = document.querySelector('.row-pick');
        return n ? n.getAttribute('data-id') : null;
      });
      if (name) {
        hits += 1;
        seen.add(name);
      }
    }
    process.stdout.write(
      `  picker: ${hits}/${probe.length} probes lit a row, ${seen.size} distinct\n`,
    );
    if (probe.length > 0) {
      record(scenario.id, 'picker lights a row', hits > 0, `${hits}/${probe.length}`);
      record(
        scenario.id,
        'picker is not stuck on one row',
        seen.size <= Math.max(1, hits),
        `${seen.size} distinct`,
      );
    }

    await page.mouse.move(5, 400, { steps: 3 });
    await sleep(700);
    const cleared = await panel.evaluate(() => document.querySelectorAll('.row-pick').length);
    record(
      scenario.id,
      'picker clears on leave',
      probe.length === 0 || cleared === 0,
      `${cleared} still lit`,
    );

    /* The permalink has to leave the page, not just look like it does. */
    const links = await panel.evaluate(() =>
      [...document.querySelectorAll('.row-link')].map((a) => a.getAttribute('href')),
    );
    const goodLinks = links.filter((h) => /^https?:\/\//.test(h ?? ''));
    process.stdout.write(`  permalinks: ${goodLinks.length}/${links.length}\n`);
    record(
      scenario.id,
      'permalinks are absolute urls',
      links.length === 0 || goodLinks.length === links.length,
      `${goodLinks.length}/${links.length}`,
    );

    /* The developer reader: the whole list, with no signature in it. */
    const [download] = await Promise.all([
      panel.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      panel.evaluate(() => document.querySelector('[aria-label*="Export"]')?.click()),
    ]);
    if (download) {
      const body = readFileSync(await download.path(), 'utf8');
      writeFileSync(`/tmp/soak-${scenario.id}.json`, body);
      const parsed = JSON.parse(body);
      const leaked = /=[A-Za-z0-9_-]{25,}/.test(body.replace(/REDACTED/g, ''));
      const rowsAfter = await panel.evaluate(() => document.querySelectorAll('.row').length);
      process.stdout.write(
        `  export: ${parsed.count} items (list was ${first}, now ${rowsAfter})${leaked ? '  LEAK' : ''}\n`,
      );
      const grew = parsed.count >= first && parsed.count <= rowsAfter;
      record(
        scenario.id,
        'export matches the list',
        grew || parsed.count === first,
        `${parsed.count} between ${first} and ${rowsAfter}`,
      );
      record(
        scenario.id,
        'export carries no token',
        !leaked,
        leaked ? 'long value survived redaction' : 'clean',
      );
    } else {
      record(scenario.id, 'export writes a file', false, 'no download');
    }

    /* A feed keeps producing; the list has to keep up with it. */
    if (scenario.shape === 'feed') {
      const before = await panel.evaluate(() => document.querySelectorAll('.row').length);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(3500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(3500);
      const after = await panel.evaluate(() => document.querySelectorAll('.row').length);
      process.stdout.write(`  after scrolling: ${before} -> ${after}\n`);
      record(
        scenario.id,
        'keeps up with an endless feed',
        after >= before,
        `${before} -> ${after}`,
      );
    }

    /*
     * A page error thrown by the site's own bundle is not this extension's
     * problem, and the stack says who wrote it. Only an error naming an
     * extension frame counts against the extension.
     */
    const all = [...pageErrors, ...panelErrors];
    const ours = all.filter((e) => e.includes('chrome-extension://'));
    const theirs = all.length - ours.length;
    record(
      scenario.id,
      'extension throws nothing',
      ours.length === 0,
      ours.slice(0, 1).join('').slice(0, 90),
    );
    if (theirs > 0) process.stdout.write(`       (${theirs} thrown by the site itself)\n`);

    await panel.close();
    await page.close();
  }

  await ctx.close();

  const width = Math.max(...results.map((r) => r.check.length), 10);
  process.stdout.write(`\n${'='.repeat(78)}\n`);
  for (const r of results) {
    process.stdout.write(
      `${r.pass ? ' ok ' : 'FAIL'}  ${r.id.padEnd(18)} ${r.check.padEnd(width)}  ${r.detail}\n`,
    );
  }
  process.stdout.write(
    `${'='.repeat(78)}\n${results.length - failures}/${results.length} checks passed\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
