import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

const args = process.argv.slice(2);
const target = args.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'chromium';
const watch = args.includes('--watch');

/** Keys whose overlay value is null are removed rather than replaced. */
function merge(base, overlay) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key.startsWith('$')) continue;
    out[key] = value === null ? undefined : value;
  }
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

function build(args, label, env = {}) {
  console.log(`> ${label}`);
  const res = spawnSync('npx', args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

build(['vite', 'build', ...(watch ? ['--watch'] : [])], 'module build (background, pages)');
build(
  ['vite', 'build', '-c', 'vite.iife.config.ts', ...(watch ? ['--watch'] : [])],
  'iife build (content script)',
  { KIDNAP_ENTRY: 'content' },
);
build(
  ['vite', 'build', '-c', 'vite.iife.config.ts', ...(watch ? ['--watch'] : [])],
  'iife build (page hook)',
  { KIDNAP_ENTRY: 'page-hook' },
);

const manifest =
  target === 'firefox'
    ? merge(readJson('manifest.json'), readJson('manifest.firefox.json'))
    : readJson('manifest.json');
manifest.version = readJson('package.json').version;

cpSync(resolve(root, 'icons'), resolve(dist, 'icons'), { recursive: true });
writeFileSync(resolve(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const required = ['manifest.json', 'background/index.js', 'content/index.js', 'page-hook.js'];
const missing = required.filter((file) => !existsSync(resolve(dist, file)));
if (missing.length > 0) {
  console.error(`build incomplete, missing: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`\n${target} build ready in dist/`);
