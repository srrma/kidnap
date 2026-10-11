---
name: kidnap-addon
description: Use when adding, fixing, or reviewing a Kidnap add-on in src/addons/builtin.ts for a website. Covers capturing a site's real responses, writing rules that actually match them, cutting fixtures from captures, and proving the add-on extracts rows. Use when asked to add support for a site or platform, when a site shows no media, when an add-on extracts zero rows, or when reviewing whether an add-on is real.
---

# Writing a Kidnap add-on

Add-ons are JSON that maps a site's responses onto media rows. The format is in
[ADDONS.md](../../ADDONS.md). This is about the part the format cannot tell you:
how to know the rule is right.

## The one rule

**Never write a path you have not seen in a real response.**

Four add-ons shipped in this repository that matched nothing at all, and every
one of them had a passing test. Their fixtures had been written by hand to match
the rule they were testing, which proves nothing. They were removed rather than
left in place: Twitch, Facebook, Reddit, and Instagram's original rules.

The rule is cheap to follow and impossible to unlearn. Capture first.

## Before anything else

Decide how much of the site you can see:

- Signed in. Add a `cookies:` path to the site profile in
  `scripts/capture.mjs` and the tool uses it.
- Signed out, with `cookies: null`. Bluesky, Imgur and Pinterest all serve
  media without an account, and a signed-out session is a more honest thing to
  map, because it is what most people actually use.
- Neither works, in which case stop and say so. Do not write rules from a login
  page.

## Workflow

### 1. Capture the site

Add a profile to `SITES` in `scripts/capture.mjs`:

```js
example: {
  id: 'example',
  label: 'Example',
  base: 'https://www.example.com',
  cookies: 'Downloads/www.example.com_cookies.txt',  // or null
  matches: (url) => /\/api\/graphql/.test(url),
  mediaKeys: ['playable_url'],        // field names that mean "media"
  surfaces: [{ name: 'feed', url: '/', scroll: 6 }],
  discover: { post: { from: 'feed', selector: 'a[href*="/p/"]', strip: /\?.*$/ } },
  userProbe: (node) => node?.author ?? null,
},
```

Then:

```bash
BODIES=/tmp/ex node scripts/capture.mjs --site=example --surfaces=feed
```

`mediaKeys` is a guess until the first capture; that is fine, because the report
also prints every path whose value **looks like a media URL**. A URL on a CDN is
evidence, a key name is a guess. Use whichever the capture gives you.

Two things that will waste an hour if you do not know them:

- **A capture that finds zero endpoints is evidence about `matches`, not about
  the site.** Behance moved to `/v3/` and matched nothing until it did.
- **Surfaces that share an endpoint name share one saved body.** Behance's feed
  and search are both `/v3/graphql`, so capture them in separate runs to see
  both.

### 2. Measure before you write a rule

```bash
cat > tests/dbg.test.ts <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { BUILTIN_ADDONS } from '../src/addons/builtin';
import { AddonRegistry } from '../src/addons/engine';
it('measure', () => {
  const reg = new AddonRegistry(BUILTIN_ADDONS);
  const body = JSON.parse(readFileSync('/tmp/ex/<saved>.json', 'utf8'));
  const items = reg.extract('https://www.example.com/api/graphql', body, 1);
  writeFileSync('/tmp/m.txt',
    `${items.length} rows, ${items.filter((i) => i.author).length} with an author\n` +
    items.slice(0, 5).map((i) => `  ${i.kind} ${i.url.slice(0, 60)} ${i.author ?? '-'}`).join('\n'));
});
EOF
npx vitest run tests/dbg.test.ts >/dev/null 2>&1; cat /tmp/m.txt; rm tests/dbg.test.ts
```

Use the URL the site actually requested. An add-on claims a request by **host
and path before it reads a body**, so a fixture run under the wrong URL reports
zero for a reason that has nothing to do with the rules. A rule can report zero
on its own fixture when the fixture is exercised under the wrong URL.

### 3. Write the rule

One media spec, several paths. Sites usually differ by the path to a media
object and nowhere else:

```ts
at: 'data.feed.nodes[].media'   // feed
at: 'data.search.nodes[].media' // search: same object, one segment different
```

Keep the old spelling too when a site has plausibly migrated. It costs a line
and costs nothing at runtime.

### 4. Cut the fixture from the capture

Never hand-write one. Generate it, keep only the fields the rules read, and
assert the extraction count in the commit so a regression is visible.

### 5. Assert what you cannot see

Anything the capture showed only by its ordering or its position deserves a
test, because it fails silently:

```ts
// Behance: the original cover is first in 48 of 48 projects captured.
expect(node.covers.allAvailable[0].url).toContain('/original_webp/');
```

### 6. Check provenance

```bash
node scripts/coverage.mjs
```

Every row should read **captured**. A row reading `hand-written only` is a
claim with nothing behind it.

## Traps

Each of these cost a real bug in this repository.

| Trap | What happens | Guard |
| --- | --- | --- |
| Fixture written to match the rule | Test passes, add-on matches nothing | Fixture comes from a capture; check `coverage.mjs` |
| Endpoint a browser never calls | Rule is plausible and inert | Check the endpoint appears in a capture |
| Shape moved | Rule silently stops matching | Capture again when a site goes quiet; fixture fails |
| `video_versions[]` collapses a level | `^^^` reaches the wrong object | `images.a.b[]` keeps `a` as a step; `video[]` does not |
| Extensionless CDN URL | Rows dropped by `classify` | Assert the mime |
| Key begins with a digit | Path cannot address it | Document it; do not widen the parser for one site |
| Keys are dynamic (`440453718`) | Path cannot be written at all | Needs a language change, not a rule |
| Poster offered as a second image | Every video arrives twice | Guard the photo rule on the video field |

## When zero rows is the answer

**Remove the add-on and document it.** That is not a failure; Twitch, Facebook
and Reddit were all removed this way, and `docs/<site>-responses.md` recorded
why.

Removing is better than leaving a rule because:

- a rule that matches nothing costs a reviewer real time,
- an add-on in the list is a claim the product cannot back up,
- the media is usually still found by the sniffer or the document scraper, so
  nothing is lost but the claim.

Say plainly which of these you found: the site sends no media in any response, it
sends it in a shape a path cannot name, it is server-rendered, or it is gated.

## Finishing

```bash
npm run verify          # 119 tests, typecheck, lint, both builds
node scripts/coverage.mjs
```

Then write `docs/<site>-responses.md`, covering the endpoint, the path, what was
captured and what is verified, and link it from `ADDONS.md`. Those files are
what stop the next person re-deriving the same shapes.

If a platform is already mapped, start there rather than probing blind:

| Platform | Document | State |
| --- | --- | --- |
| X / Twitter | [x-responses.md](../../docs/x-responses.md) | verified |
| Instagram | [instagram-responses.md](../../docs/instagram-responses.md) | verified |
| Bluesky |, | verified, public API, no account |
| Pinterest | [pinterest-responses.md](../../docs/pinterest-responses.md) | verified |
| Behance | [adobe-responses.md](../../docs/adobe-responses.md) | verified |
| Adobe Fonts | [adobe-responses.md](../../docs/adobe-responses.md) | verified |
| Reddit | [reddit-responses.md](../../docs/reddit-responses.md) | removed, no API |
| Facebook | [facebook-responses.md](../../docs/facebook-responses.md) | removed, no data |
| Twitch | [twitch-responses.md](../../docs/twitch-responses.md) | removed, no media URL |
| Adobe Stock | [adobe-responses.md](../../docs/adobe-responses.md) | unmapped, dynamic keys |
| Imgur |, | unmapped, needs a two-stage parse |
| TikTok |, | unmapped, gated |