# Contributing

## Setup

```bash
npm install
npm run verify
```

`npm install` needs `--legacy-peer-deps`, which `.npmrc` already sets. npm 10.9
crashes resolving vitest 4's optional peer graph, and the flag avoids it. Remove
it once that is fixed upstream.

## Before you change anything

Read `DESIGN.md` and `docs/adr/`. They record decisions and the reasons, which
is usually faster than working out why something is the way it is.

## Rules that are not negotiable

- `src/core/` is pure. It imports nothing from `chrome.*` and nothing from the
  DOM. If a change makes it impure, the change is in the wrong file.
- `src/bus/protocol.ts` is the only place a cross-context payload is declared.
  Never cast a payload with `as`; if the type is wrong, fix the protocol.
- Add-ons are JSON. An add-on that needs code is the wrong shape.
- Comments explain behaviour, an invariant, or a non-obvious reason. Nothing
  else, and never anything about how the code came to be written.
- No new runtime dependency without discussing it first. The extension ships
  one, and it is there because hand-rolling a container parser is worse.

## Adding a site

The path is documented end to end in `ADDONS.md`. In short: data in
`src/addons/builtin.ts`, a fixture in `tests/fixtures/`, a test that reads it.
The fixture is what turns a silent platform change into a red build.

## Testing

`npm test` covers the pure core, the add-on engine against real response
shapes, and the storage layer against a simulated extension API.

Two things are worth knowing:

- `tests/helpers/chrome.ts` stands in for `chrome.storage` and
  `chrome.runtime`. `src/platform.ts` resolves the API once at import time, so
  the fake has to exist before the module under test is imported.
- Tests that need a DOM declare `@vitest-environment jsdom` at the top of the
  file.

If you touch `src/store/tab.ts`, keep the concurrent tests. That file is the
most concurrency-sensitive in the repository, and the tests that prove two
detectors cannot lose each other's writes are the ones that matter.

## Adding an add-on

`skills/kidnap-addon/SKILL.md` is the procedure. In short: capture the site's
responses with `scripts/capture.mjs`, measure your rule against the capture
before believing it, cut the fixture from that capture, and check
`node scripts/coverage.mjs` reports it as captured. A platform whose add-on
extracts nothing is removed and documented, not left in place.

## Fixtures

A fixture must be cut from a response the site actually sent, not written to
match a rule. A rule tested against a fixture built to agree with it proves
nothing, which is how X, Instagram and their tests all passed while extracting
nothing from the live site.

`node scripts/coverage.mjs` prints which fixtures are captured and which are
hand-written. When adding a platform, the fixture has to be a capture.

## Commits

Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
Write the subject as the change's purpose, not its mechanics. Explain a
non-obvious reason in the body when there is one.

Do not commit `dist/` or `artifacts/`; both are ignored. The local working notes
are excluded through `.git/info/exclude` instead, so `git status` stays clean on
their own. Nothing local may be named in a tracked file or a commit message.
