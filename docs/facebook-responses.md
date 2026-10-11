# Facebook responses

**Not mapped.** This file records what was captured and what was not, because
the honest finding is that Facebook did not hand over its feed, and writing a
rule from what did arrive would be exactly the mistake this document exists to
prevent.

Signed in as the user in the supplied cookie file, the feed renders. Across
sixteen scrolls, the only responses carrying a media URL were:

| Endpoint | What it actually is |
| --- | --- |
| `data.viewer.notifications_page` | Notification icons and thumbnails |
| `data.viewer.bootstrap_keywords` | Profile pictures for the search box |
| `extensions.sr_payload.ddd.hsrp.hsdp.ixData` | Sprite sheets: `sprited`, `spi`, `_spi`, `w`, `h`, `p` |
| `extensions.prefetch_uris_v2` | URLs the page intends to fetch |

No post attachments, no `playable_url`, no `attachments[].media`, and no feed
media of any kind arrived in an API response.

## What that rules out

The Relay deferred payload looked promising: `extensions.sr_payload` is where
modern Facebook hides lazily delivered data, and its keys are numeric ids with
a parallel path map. It turned out to hold sprites. That path was followed and
is a dead end for media.

The feed also appears to have contained no media posts at all in these
sessions: sixteen scrolls of the signed-in home feed produced no video links,
so the one endpoint the add-on actually targets could not be exercised either.

## The current rules

`src/addons/builtin.ts` reads `data.video` from `/video/unified_cvc`, taking
`browser_native_hd_url` and `browser_native_sd_url`. That endpoint did fire
once during browsing, which is evidence it is still live, but no body was
captured from it and **no rule here has been run against a real response**.

Its fixture, `facebook-video.json`, is hand-written. So is every other fixture
behind an add-on listed below.

## Regenerating

```bash
SAVE=1 node scripts/capture.mjs --site=facebook
BODIES=/tmp/fb node scripts/capture.mjs --site=facebook
node scripts/capture.mjs --site=facebook --surfaces=feed,watch,marketplace
```

Useful things to try that were not tried here:

- A profile with posts, a group, and Marketplace rather than the home feed.
- `/watch/?v=<id>` reached from a link rather than from a scroll.
- Watching a video play, which is what makes `/video/unified_cvc` return its
  body.
- The mobile site, whose responses are far less obfuscated.

## Provenance, and what it costs

`node scripts/coverage.mjs` prints, per add-on, how many rows it produces from
its fixtures and whether those fixtures were captured or written by hand:

```text
reddit      1 rows    hand-written only
tiktok      1 rows    hand-written only
imgur       2 rows    hand-written only
bsky        1 rows    hand-written only
twitch      4 rows    hand-written only
facebook    2 rows    hand-written only
```

Six of ten add-ons are backed only by fixtures written to match their own
rules. That is not evidence of anything. Instagram and X were both found
extracting nothing from the live site while their hand-written fixtures passed;
the remaining six deserve the same suspicion and the same treatment: capture a
real body, cut the fixture from it, and measure.

That is the work this file is asking for. It is not finished.