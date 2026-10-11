# Twitch responses

**Not supported, and the add-on that claimed to support it has been removed.**

This is the fourth platform found claiming support it did not have, and the
clearest of them: the rule matched nothing Twitch serves, while a fixture
written to match the rule made it look proven.

## Regenerating

```bash
node scripts/capture.mjs --site=twitch
```

No account is needed. Twitch serves its pages to a browser with no session.

## What the rule claimed

```text
data.video.videoQualities[]   with url, width, height, frameRate, quality
```

## What Twitch actually sends

One endpoint, `gql.twitch.tv/gql`. Ten responses were captured from a single
video page, and across all of them:

| Field | Appears |
| --- | --- |
| `videoQualities` | **0 times** |
| `playableUrl` | **0 times** |
| `previewThumbnailURL` | **0 times** |
| `animatedPreviewURL` | **0 times** |
| `title`, `owner`, `broadcastType` | present |
| an HLS manifest URL | **0 times** |

The one response carrying anything about the stream is:

```json
{"data":{"videoPlaybackAccessToken":{"value":"{\"authorization\":{…},\"device_id\":…}"}}}
```

That is a **token**, not a URL. And the response that names the video holds
only:

```text
id, broadcastType, lengthSeconds, owner, __typename
```

Measured, after removing the rule:

```text
existing rule against 7 real gql bodies:  0 rows
the same rule against its hand-written fixture: 4 rows
```

## Why there is no rule to write

Twitch never puts a media URL in JSON. The page asks for a playback token, the
script derives an `usher.ttvnw.net` HLS address from it, and the manifest is
fetched from there. Three steps, and the second one happens in JavaScript that
no response records.

So an add-on has nothing to read. What an add-on *could* do is attach a title
to a URL it never sees, which is not a thing add-ons do.

Twitch media is not lost to Kidnap, though. The manifest is a normal network
response, so the sniffer catches the `.m3u8` and the existing assembler joins it
without re-encoding. That path is unchanged by this removal; what is gone is a
rule that claimed more than it could deliver.

## Traps

**A fixture written to match a rule proves nothing.** `twitch-video.json` was
built by hand, with a plausible `videoQualities` array, and the rule passed
against it for as long as it existed. `npm run coverage` marks any fixture like
that so it cannot be mistaken for evidence.

**Twitch's video root has a `video` key, so the payload looks right at a
glance.** It has metadata and no media, which is the combination most likely to
be mistaken for a working rule.