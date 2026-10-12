/**
 * Drives the built extension in a real browser against a real page.
 *
 *   node scripts/smoke.mjs [--url=...] [--headed] [--keep]
 *
 * This is the only check that exercises the parts unit tests cannot reach: the
 * service worker starting, webRequest observation, the page hook injecting, and
 * the panel rendering real detections. Everything it asserts is read back out
 * of chrome.storage.session by way of the service worker, so a passing run
 * means the detectors actually produced rows rather than the page merely
 * loading.
 *
 * Cookies are never logged. Only counts and a redacted URL list are printed.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const keep = args.includes('--keep');
const target = flag('url') ?? 'https://x.com/search?q=news&f=live';
const cookieFile = flag('cookies') ?? resolve(process.env.HOME, 'Downloads/x.com_cookies.txt');

/** Never print a full URL, which can carry a session token. */
function redact(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.slice(0, 48)}`;
  } catch {
    return '<unparseable>';
  }
}

/** Netscape cookie file to the shape Playwright's addCookies wants. */
function readCookies(path) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) {
      /* HttpOnly lines are commented out in the Netscape format. */
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [domain, , path, secure, , name, value] = parts;
    /* Netscape expiry is seconds; Playwright wants seconds, and a session
       cookie has no expiry at all, which Playwright expresses as -1. */
    let expires = -1;
    const seconds = Number.parseInt(parts[4] ?? '', 10);
    if (Number.isFinite(seconds) && seconds > 0) expires = seconds;

    out.push({
      name,
      value,
      domain,
      path,
      expires,
      httpOnly: false,
      secure: secure === 'TRUE',
      sameSite: 'Lax',
    });
  }
  return out;
}

function countBy(items, key) {
  const out = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

const userDataDir = mkdtempSync(join(tmpdir(), 'kidnap-smoke-'));

/*
 * Playwright's own Chromium is used, and it has to be headed.
 *
 * Chrome 137 and later ignore --load-extension, so the system browser cannot
 * be used to develop against an unpacked extension at all. The bundled build
 * still honours it, and only in headed mode: a service worker will not register
 * for an extension in a headless shell.
 */
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});

let failures = 0;
try {
  /* The service worker is the proof the extension loaded at all. */
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  check(
    'service worker started',
    Boolean(worker),
    worker?.url().split('/').slice(-2).join('/') ?? '',
  );

  const extensionId = new URL(worker.url()).host;

  const cookies = readCookies(cookieFile);
  check('cookies parsed', cookies.length > 0, `${cookies.length} cookies for x.com`);
  await context.addCookies(cookies);

  /* Settle on the target page and give detection time to run. */
  const page = await context.newPage();
  const consoleErrors = [];
  const pageMedia = [];
  const apiCalls = [];
  page.on('response', (response) => {
    const type = response.headers()['content-type'] ?? '';
    const url = response.url();
    if (/m3u8|mpd|video\/|mpegurl|dash/i.test(`${type} ${url}`)) {
      pageMedia.push({ url: url.slice(0, 80), type: type.slice(0, 40) });
    }
    if (/\/i\/api\//.test(url)) {
      apiCalls.push({
        host: new URL(url).host,
        path: new URL(url).pathname.slice(0, 60),
        type,
        size: url.length,
      });
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 200)}`));

  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(3_000);

  /*
   * X requests video lazily as the timeline fills. Scrolling is what makes the
   * run exercise a stream at all, and it is the same reason the extension's
   * own auto-scroll option exists.
   */
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(1_200);
  }
  await page.waitForTimeout(3_000);

  const pageUrl = page.url();
  check('target page loaded', pageUrl.includes('x.com'), pageUrl.slice(0, 60));

  const signedIn = await page.evaluate(
    () =>
      document.querySelector(
        '[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Profile"]',
      ) !== null,
  );
  console.log(`note: appears signed in: ${signedIn}`);
  const bg = await worker.evaluate(() => globalThis.__kidnapDiag ?? null);
  console.log(`note: background diag ${JSON.stringify(bg)}`);

  /* Where the add-on chain breaks, if it does. */
  const hook = await page.evaluate(() => ({
    ran: window.__kidnapHook === true,
    stats: window.__kidnapStats ?? null,
    keys: Object.keys(window).filter((k) => k.startsWith('__kidnap')),
  }));
  console.log(
    `note: page hook ran=${hook.ran} keys=${JSON.stringify(hook.keys)} stats=${JSON.stringify(hook.stats)}`,
  );
  console.log(`note: page saw ${pageMedia.length} media responses so far`);
  console.log(`note: page made ${apiCalls.length} /i/api/ calls`);
  const apiHosts = {};
  for (const call of apiCalls) {
    const key = `${call.host}${call.path.split('/').slice(0, 5).join('/')}`;
    apiHosts[key] = (apiHosts[key] ?? 0) + 1;
  }
  for (const [key, count] of Object.entries(apiHosts).slice(0, 8)) {
    console.log(`note:   ${count}x ${key}`);
  }

  /* Render the panel against the same tab and look at it. */
  const panel = await context.newPage();
  const panelErrors = [];
  panel.on('console', (msg) => {
    if (msg.type() === 'error') panelErrors.push(msg.text().slice(0, 200));
  });
  /* Console text for a failed resource does not name it, so responses are
     watched too. Otherwise a 404 has no idea what was missing. */
  const panelFailures = [];
  panel.on('response', (response) => {
    if (response.status() >= 400) panelFailures.push(`${response.status()} ${response.url()}`);
  });
  panel.on('pageerror', (err) => panelErrors.push(`pageerror: ${String(err).slice(0, 200)}`));

  await panel.setViewportSize({ width: 420, height: 900 });
  const tabIdOfPage = await worker.evaluate(
    async () => (await chrome.tabs.query({ url: ['https://x.com/*'] }))[0]?.id,
  );
  /*
   * Printed because an empty panel and a tab that was never found look the same
   * from here: both report zero rows. The panel falls back to whatever tab is
   * active when the id is missing, which after newPage() is the panel's own.
   */
  console.log(`note: panel pointed at tab ${tabIdOfPage ?? 'NONE'}`);

  await panel.goto(`chrome-extension://${extensionId}/panel/index.html?tabId=${tabIdOfPage}`, {
    waitUntil: 'domcontentloaded',
  });
  await panel.waitForTimeout(2500);

  const rows = await panel.locator('.row').count();
  /* The detail line carries the actual error, which is the only thing that
     distinguishes a rejected request from an empty tab. */
  const panelState = await panel
    .locator('.state')
    .first()
    .textContent()
    .catch(() => null);
  check(
    'panel rendered rows',
    rows > 0,
    `${rows} rows${panelState ? `, showing "${panelState.trim().slice(0, 120)}"` : ''}`,
  );

  const heading = await panel
    .locator('.count')
    .first()
    .textContent()
    .catch(() => null);
  check(
    'panel reports a count',
    Boolean(heading && /\d/.test(heading)),
    (heading ?? '').trim(),
  );

  const empty = await panel.locator('.state-title').count();
  check('no empty state while rows exist', empty === 0, `${empty} state blocks`);

  /* The row itself opens the preview, which is the new interaction. */
  if (rows > 0) {
    await panel.locator('.row-open').first().click();
    await panel.waitForTimeout(900);
    const sheet = await panel.locator('.sheet[role="dialog"]').count();
    check('clicking a row opens the preview', sheet === 1, `${sheet} sheet`);

    const title = await panel
      .locator('.sheet-title')
      .textContent()
      .catch(() => null);
    check(
      'preview has a title',
      Boolean(title && title.trim().length > 0),
      (title ?? '').slice(0, 50),
    );

    await panel.screenshot({ path: resolve(root, 'artifacts/panel-preview.png') });

    /* Escape has to close it, or the panel is a keyboard trap. */
    await panel.keyboard.press('Escape');
    await panel.waitForTimeout(400);
    const afterEscape = await panel.locator('.sheet[role="dialog"]').count();
    check('Escape closes the preview', afterEscape === 0, `${afterEscape} sheets left`);
  }

  await panel.screenshot({ path: resolve(root, 'artifacts/panel.png'), fullPage: false });

  /* Selection mode must have a way out. */
  const selectButton = panel.locator('button[aria-label="Select items"]');
  if (await selectButton.count()) {
    await selectButton.click();
    await panel.waitForTimeout(400);
    const doneButton = panel.locator('button[aria-label="Finish selecting"]');
    const entered = await doneButton.count();
    check('entering selection mode works', entered === 1, `${entered} exit control`);
    if (entered === 1) {
      await panel.screenshot({ path: resolve(root, 'artifacts/panel-selecting.png') });
      await doneButton.click();
      await panel.waitForTimeout(400);
      const backToSelect = await panel.locator('button[aria-label="Select items"]').count();
      check(
        'leaving selection mode works',
        backToSelect === 1,
        `${backToSelect} re-entry control`,
      );
    }
  }

  /* Both themes must render without breaking. */
  for (const theme of ['light', 'dark']) {
    await panel.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await panel.waitForTimeout(250);
    const overflow = await panel.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    check(`no horizontal overflow in ${theme}`, overflow === false);
    await panel.screenshot({ path: resolve(root, `artifacts/panel-${theme}.png`) });
  }

  /*
   * Only the extension's own pages are held to the error budget. x.com trips
   * its own Content Security Policy on nearly every load, and counting those
   * against this extension would train us to ignore the check.
   */
  const ours = panelErrors.filter(
    (text) => !/favicon|ERR_BLOCKED_BY_CLIENT|net::ERR_|Content Security Policy/i.test(text),
  );
  const bad = [...new Set([...panelFailures, ...ours])].filter(
    (text) => !/favicon/i.test(text),
  );
  check('no errors from the panel itself', bad.length === 0, bad.slice(0, 2).join(' | '));
  console.log(
    `note: ${consoleErrors.length} console errors came from the x.com page itself (ignored)`,
  );

  /*
   * Read at the very end, after everything has settled. X fetches media in
   * waves and an early snapshot misses the video entirely.
   */
  const finalItems = await worker.evaluate(async () => {
    const all = await chrome.storage.session.get(null);
    const indexKey = Object.keys(all).find((k) => k.startsWith('x:'));
    if (!indexKey) return [];
    const id = indexKey.slice(2).split(':')[0];
    const store = await chrome.storage.session.get(all[indexKey].map((h) => `m:${id}:${h}`));
    return Object.values(store);
  });
  const finalKinds = {};
  for (const item of finalItems) finalKinds[item.kind] = (finalKinds[item.kind] ?? 0) + 1;
  console.log(`\nfinal store: ${finalItems.length} items ${JSON.stringify(finalKinds)}`);
  console.log(`detectors: ${JSON.stringify(countBy(finalItems, (i) => i.detector))}`);

  const finalStreams = finalItems.filter((i) => i.kind === 'stream');
  const finalVideos = finalItems.filter((i) => i.kind === 'video');
  const finalAddon = finalItems.filter((i) => i.detector === 'addon');
  console.log(
    `addon items: ${finalAddon.length}, streams: ${finalStreams.length}, videos: ${finalVideos.length}`,
  );
  console.log(
    `grouped video posts: ${new Set(finalVideos.map((v) => v.groupId).filter(Boolean)).size}`,
  );
  console.log(
    `rows with a post permalink: ${finalItems.filter((i) => i.pageUrl?.includes('x.com/i/status/')).length}`,
  );
  if (finalAddon[0])
    console.log(
      `sample addon row: ${redact(finalAddon[0].url)} author=${finalAddon[0].author ?? '-'}`,
    );

  console.log(`\nmedia responses the page actually made: ${pageMedia.length}`);
  for (const m of pageMedia.slice(0, 5)) console.log(`  ${m.type}  ${m.url}`);
  /*
   * Opening a tweet directly, to prove the add-on against the endpoint that
   * carries the most complete payload of the two.
   *
   * Most tweets carry no media, so one link is not enough to see anything.
   * Several are tried and the first with media wins.
   */
  const statusLinks = await page
    .locator('a[href*="/status/"]')
    .evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('href')))].slice(0, 6))
    .catch(() => []);
  console.log(`note: tweet links to try: ${statusLinks.length}`);

  let found = [];
  let diag = null;
  for (const statusLink of statusLinks) {
    const tweet = await context.newPage();
    await tweet
      .goto(new URL(statusLink, target).href, { waitUntil: 'domcontentloaded' })
      .catch(() => {});
    await tweet.waitForTimeout(6_000);

    diag = (await worker.evaluate(() => globalThis.__kidnapDiag)) ?? diag;
    /*
     * Read every x.com tab. Each tweet gets its own tab, and reading only the
     * first index key would report whichever one happened to be created first.
     */
    const tabIds = await worker.evaluate(async () =>
      (await chrome.tabs.query({ url: ['https://x.com/*'] })).map((t) => t.id),
    );
    const items = await worker.evaluate(async (ids) => {
      const out = [];
      for (const id of ids) {
        const index = await chrome.storage.session.get(`x:${id}`);
        for (const h of index[`x:${id}`] ?? []) {
          const one = await chrome.storage.session.get(`m:${id}:${h}`);
          out.push(...Object.values(one));
        }
      }
      return out;
    }, tabIds);
    found = items.filter((i) => i.detector === 'addon');
    console.log(
      `note: ${statusLink} gave ${found.length} add-on items, background diag ${JSON.stringify(diag)}`,
    );
    await tweet.close();
    if (found.length > 0) break;
  }

  for (const item of found.slice(0, 6)) {
    console.log(
      `  addon ${item.kind.padEnd(7)} ${redact(item.url)} author=${item.author ?? '-'} post=${item.pageUrl ?? '-'}`,
    );
  }

  /*
   * What must hold is that the chain is intact: bodies arriving, being claimed
   * by an add-on, and parsing. A regression there shows up as every count being
   * zero, which is how the TweetDetail path was originally missed.
   */
  check(
    'the add-on chain carries a real tweet response',
    (diag?.apiBody ?? 0) > 0 && (diag?.notClaimed ?? 0) === 0 && (diag?.badJson ?? 0) === 0,
    `bodies ${diag?.apiBody}, unclaimed ${diag?.notClaimed}, bad json ${diag?.badJson}, extracted ${diag?.items}`,
  );
  check(
    'add-on media carries its author through to storage',
    found.length === 0 || found.every((i) => Boolean(i.author)),
    `${found.filter((i) => i.author).length} of ${found.length} have an author`,
  );

  console.log('\nsample of what was detected:');
  for (const item of finalItems.slice(0, 10)) {
    console.log(`  ${item.kind.padEnd(8)} ${item.detector.padEnd(8)} ${redact(item.url)}`);
  }

  failures = results.filter((r) => !r.ok).length;
} catch (error) {
  check('harness completed', false, String(error).slice(0, 300));
  failures = results.filter((r) => !r.ok).length + 1;
} finally {
  await context.close();
  if (!keep) rmSync(userDataDir, { recursive: true, force: true });
  else console.log(`\nprofile kept at ${userDataDir}`);
}

console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures === 0 ? 0 : 1);
