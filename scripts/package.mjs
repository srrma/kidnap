import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const target of ['chromium', 'firefox']) {
  const build = spawnSync('node', ['scripts/build.mjs', `--target=${target}`], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, KIDNAP_RELEASE: '1' },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  const out = resolve(root, 'artifacts', `kidnap-${version}-${target}.zip`);

  const zipped = spawnSync('zip', ['-qr', out, '.'], { cwd: resolve(root, 'dist') });
  if (zipped.status !== 0) {
    console.error('zip failed. Install the zip command, or archive dist/ by hand.');
    process.exit(zipped.status ?? 1);
  }
  console.log(`artifacts/kidnap-${version}-${target}.${ext}`);
}

rmSync(resolve(root, 'dist'), { recursive: true, force: true });
