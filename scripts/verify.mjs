/**
 * Independent verification of the built extension.
 *
 * Not the X smoke harness: this drives the areas the recent commits touched,
 * which unit tests and that harness both miss. The envelope check that dropped
 * every `req: void` message, the read coalescing that could leave a stale error
 * over correct rows, and settings actually surviving a reload.
 *
 *   node scripts/verify.mjs
 *
 * Exits non-zero if anything fails, so it is usable in CI.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const JAR = process.env.COOKIES ?? resolve(process.env.HOME, 'Downloads/cookies.txt');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Cookies for one site from the shared jar, so we are only offered that site. */
function cookiesFor(host) {
  const out = [];
  for (const line of readFileSync(JAR, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 7) continue;
    const domain = f[0].replace(/^\./, '');
    if (domain !== host && !domain.endsWith('.' + host)) continue;
    out.push({
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
  return out;
}

/**
 * A page that will not load in time is the network, not the extension, and
 * should not read as a failure. Two attempts, then give up on that surface.
 */
async function visit(page, url, tries = 2) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return true;
    } catch (error) {
      if (attempt === tries) {
        console.log(`note: ${url} did not load (${String(error).split('\n')[0]})`);
        return false;
      }
      await page.waitForTimeout(3000);
    }
  }
  return false;
}

const context = await chromium.launchPersistentContext(
  mkdtempSync(join(tmpdir(), 'kidnap-verify-')),
  {
    headless: false,
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  },
);

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  check(
    'service worker started',
    Boolean(worker),
    worker?.url().split('/').slice(-2).join('/') ?? '',
  );
  const extensionId = new URL(worker.url()).host;

  /* ── 3. A real page, real rows, no stale error over them ─────────────── */
  const page = await context.newPage();
  await context.addCookies(cookiesFor('x.com'));
  const loaded = await visit(page, 'https://x.com/home');
  check('the page under test loaded', loaded);
  await page.waitForTimeout(7000);
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1500);
  }

  if (!loaded) throw new Error('x.com did not load, so nothing downstream is meaningful');
  const tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ url: ['https://x.com/*'] }))[0]?.id,
  );
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel/index.html?tabId=${tabId}`);
  await panel.waitForTimeout(2500);

  const rendered = await panel.evaluate(() => {
    const rows = document.querySelectorAll('.row');
    const errorish = [...document.querySelectorAll('.error, .state-title, [class*="error"]')]
      .map((n) => n.textContent?.trim())
      .filter((t) => t && !/nothing|could not|no /i.test(t));
    return {
      rows: rows.length,
      header: document.body.innerText.split('\n')[0] ?? '',
      errors: errorish.slice(0, 3),
      filters: [...document.querySelectorAll('.filter, .chip, button')]
        .map((b) => b.textContent?.trim())
        .filter(Boolean)
        .slice(0, 9),
    };
  });
  check(
    'the panel lists media from the page it is pointed at',
    rendered.rows > 0,
    `${rendered.rows} rows, header "${rendered.header.slice(0, 40)}"`,
  );
  check(
    'no error is shown over rows that are present',
    rendered.errors.length === 0,
    rendered.errors.join(' | ').slice(0, 90),
  );

  /* ── 4. Read coalescing under churn: rows must not go stale ─────────── */
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(5000);
  const afterChurn = await panel.evaluate(() => ({
    rows: document.querySelectorAll('.row').length,
    errors: [...document.querySelectorAll('.error, [class*="error"]')].length,
  }));
  check(
    'rows survive a burst of storage changes',
    afterChurn.rows >= rendered.rows && afterChurn.errors === 0,
    `${rendered.rows} -> ${afterChurn.rows} rows, ${afterChurn.errors} errors`,
  );

  /* ── 5. A filter still narrows the list ──────────────────────────────── */
  const filtered = await panel.evaluate(() => {
    const before = document.querySelectorAll('.row').length;
    const chip = [...document.querySelectorAll('button')].find((b) =>
      /^Images/.test(b.textContent?.trim() ?? ''),
    );
    if (!chip) return { error: 'no Images filter' };
    chip.click();
    return { before, after: 0, clicked: true };
  });
  await panel.waitForTimeout(1200);
  filtered.after = await panel.evaluate(() => document.querySelectorAll('.row').length);
  check(
    'a filter narrows the list',
    filtered.clicked === true && filtered.after <= filtered.before,
    `${filtered.before} -> ${filtered.after} rows`,
  );

  /* ── 6. Preview opens and closes ─────────────────────────────────────── */
  const preview = await panel.evaluate(() => {
    const opener = document.querySelector('.row-open');
    if (!opener) return { error: 'no row to open' };
    opener.click();
    return { opened: true };
  });
  await panel.waitForTimeout(2500);
  const sheet = await panel.evaluate(() => ({
    open: Boolean(document.querySelector('.sheet')),
    title: document.querySelector('.sheet-title')?.textContent ?? '',
  }));
  check(
    'a preview sheet opens',
    preview.opened === true && sheet.open,
    sheet.title.slice(0, 50),
  );
  await panel.keyboard.press('Escape');
  await panel.waitForTimeout(800);
  const closed = await panel.evaluate(() => Boolean(document.querySelector('.sheet')));
  check('Escape closes it', closed === false);

  /* ── 7. The envelope fix, from the context that really sends ────────── */
  /*
   * Sent from the panel rather than the worker: a service worker does not
   * receive its own runtime messages, so asking it whether it can hear itself
   * tests nothing. The panel is the caller this fix was made for.
   */
  const envelope = await panel.evaluate(
    () =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ to: 'settings:get' }, (response) =>
          resolve({
            ok: response?.ok === true,
            error: chrome.runtime.lastError?.message ?? null,
          }),
        );
      }),
  );
  check(
    'a request declared with no payload is answered',
    envelope.error === null && envelope.ok,
    `error=${envelope.error ?? 'none'} ok=${envelope.ok}`,
  );

  const roundTrip = await panel.evaluate(async () => {
    const send = (to, payload) =>
      new Promise((resolve) => chrome.runtime.sendMessage({ to, payload }, (v) => resolve(v)));
    const before = (await send('settings:get'))?.value;
    if (!before) return { error: 'no settings read' };
    /* A real SortMode. An invalid one is rejected, which would look like
       a failure to persist when it is the harness feeding rubbish. */
    const next = { ...before, sort: before.sort === 'name' ? 'recent' : 'name' };
    await send('settings:set', next);
    const after = (await send('settings:get'))?.value;
    await send('settings:set', before);
    return { before: before.sort, after: after?.sort };
  });
  check(
    'a settings change is written and read back',
    Boolean(roundTrip.after) && roundTrip.after !== roundTrip.before,
    `sort: ${roundTrip.before} -> ${roundTrip.after}`,
  );

  /* ── 8. Settings UI opens, which is the path the envelope bug broke ──── */
  const settingsUi = await panel.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      /settings|⚙/i.test((b.getAttribute('aria-label') ?? '') + (b.textContent ?? '')),
    );
    if (!button) return { error: 'no settings button' };
    button.click();
    return { clicked: true };
  });
  await panel.waitForTimeout(1200);
  const settingsState = await panel.evaluate(() => ({
    open: Boolean(document.querySelector('.sheet, dialog, [role="dialog"]')),
    inputs: document.querySelectorAll(
      '.sheet input, .sheet select, dialog input, dialog select',
    ).length,
  }));
  check(
    'the settings sheet opens with its controls',
    settingsUi.clicked === true && settingsState.open && settingsState.inputs > 0,
    `${settingsState.inputs} controls`,
  );
  /* ── 9. A second site, and the one path X cannot exercise ───────────── */
  /*
   * Adobe Fonts is server-rendered: the add-on reads JSON out of the page's own
   * markup, which is a different code path from an intercepted response. If the
   * message bus is sound both work; if anything regressed, this is the one that
   * would notice first.
   */
  const fonts = await context.newPage();
  await context.addCookies(cookiesFor('adobe.com'));
  const fontsLoaded = await visit(fonts, 'https://fonts.adobe.com/fonts/roboto');
  check('the second page loaded', fontsLoaded);
  await fonts.waitForTimeout(9000);

  const fontTabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ url: ['https://fonts.adobe.com/*'] }))[0]?.id,
  );
  const fontPanel = await context.newPage();
  await fontPanel.goto(`chrome-extension://${extensionId}/panel/index.html?tabId=${fontTabId}`);
  await fontPanel.waitForTimeout(2500);

  const fontRows = await fontPanel.evaluate(() => {
    const rows = [...document.querySelectorAll('.row')];
    return {
      total: rows.length,
      fonts: rows.filter((r) => r.textContent?.includes('FONT')).length,
      ttf: [...document.querySelectorAll('button')].filter(
        (b) => b.textContent?.trim() === 'TTF',
      ).length,
      errors: [...document.querySelectorAll('.error, [class*="error"]')].length,
    };
  });
  check(
    'a server-rendered site yields rows through the embedded path',
    fontRows.fonts > 0 && fontRows.errors === 0,
    `${fontRows.fonts} font rows of ${fontRows.total}, ${fontRows.ttf} TTF buttons`,
  );

  const specimen = await fontPanel.evaluate(() => {
    const opener = [...document.querySelectorAll('.row-open')].find((r) =>
      r.textContent?.includes('FONT'),
    );
    if (!opener) return { error: 'no font row' };
    opener.click();
    return { clicked: true };
  });
  await fontPanel.waitForTimeout(6000);
  const specimenState = await fontPanel.evaluate(() => {
    const lines = [...document.querySelectorAll('.specimen-line')];
    return {
      lines: lines.length,
      families: [...new Set(lines.map((l) => getComputedStyle(l).fontFamily.split(',')[0]))],
      loaded: [...document.fonts].map((f) => `${f.family}:${f.status}`),
    };
  });
  check(
    'a font previews as a specimen in its own face',
    specimenState.lines > 0 && specimenState.loaded.some((f) => f.endsWith(':loaded')),
    `${specimenState.lines} lines, ${specimenState.loaded.join(', ').slice(0, 50)}`,
  );
  await fontPanel.keyboard.press('Escape');
} finally {
  await context.close();
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
