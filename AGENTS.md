# AGENTS.md

## What this repository is

Kidnap is a Manifest V3 browser extension that detects, previews and downloads
media from any page. It runs entirely on the user's machine: there is no
backend, no analytics, and no remote code.

## Before you change anything

1. Read `DESIGN.md`. It holds the direction, and where expression is and is not
   allowed, with the reasoning for each. Do not re-open those without asking.
2. Read `docs/adr/`. Each file records a decision and the reason for it. New
   decisions go in new ADR files, not into rewrites of old ones.
3. Read `LIMITATIONS.md` before touching stream assembly or DRM handling. Both
   are deliberate positions with reasons.

## Before you add or change an add-on

Read `skills/kidnap-addon/SKILL.md`. It covers capturing a site's real
responses, and why four add-ons that passed their tests matched nothing. The
short version: never write a path you have not seen in a response, and never
write a fixture to match a rule you are testing.

## Ground rules

- `src/core/` is pure. It imports nothing from `chrome.*` and nothing from the
  DOM. Everything in it is unit tested. Keep it that way.
- The message contract in `src/bus/protocol.ts` is the single source of truth
  for every cross-context payload. Never `as`-cast a payload.
- Add-ons in `src/addons/` are pure JSON. An add-on must never be able to
  execute code. See `ADDONS.md`.
- Comments explain behavior, an invariant, or a non-obvious reason. Nothing
  else. No comments about how this code came to be written.
- Before proposing a commit, run `npm run verify`.

## Verification

```bash
npm run verify   # typecheck, lint, test, build
```

## Storage rules

The working notes directory is local only. Never stage it, never name it from a
tracked file, and never put its path in `.gitignore`. It is already excluded
through `.git/info/exclude`, which is not committed.
