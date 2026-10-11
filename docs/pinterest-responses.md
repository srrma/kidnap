# Pinterest responses

What pinterest.com actually sends, recorded so nobody has to guess it again.

Everything here is **verified**: cut from a signed-in capture, kept under
`tests/fixtures/`, asserted by a test.

Regenerate:

```bash
SAVE=1 node scripts/capture.mjs --site=pinterest
BODIES=/tmp/pin node scripts/capture.mjs --site=pinterest
node scripts/capture.mjs --site=pinterest --surfaces=home,search
```

## The short version

Pinterest serves named `/resource/…/get/` endpoints, and every one answers with
`resource_response.data` holding the same pin object. The shape never changes;
only the path to it does.

```text
resource_response.data[]           home feed
resource_response.data.results[]   search
```

A pin:

```text
id                    string, used for the permalink
images["236x"|"474x"|"736x"|"orig"]   { width, height, url }
grid_title            the title
description           longer text
auto_alt_text         alt text
pinner.username       who saved it
board.name
link                  where the pin points
created_at            RFC 2822: "Fri, 12 Sep 2025 04:50:42 +0000"
is_video, videos      on video pins
```

`orig` is the rendition Pinterest serves for downloads and is what the add-on
takes. The smaller sizes are what the grid draws.

## Measured

| Surface | Captured | Extracted |
| --- | --- | --- |
| Home feed (`UserHomefeedResource`) | 24 pins | 3 from the fixture, all with author, caption, permalink and date |
| Search (`BaseSearchResource`) | 25 pins | 3 from the fixture, likewise |

Search was a shape worth checking rather than assuming: its `data` is an object
rather than an array, with the pins one level further down under `results`.

## Traps

**Search is not an array where the feed is.** `resource_response.data` is an
array on the home feed and an object carrying `results` on search. One rule
covers the feed and misses search entirely, which looks identical to "no pins
on search".

**The date is RFC 2822, not ISO.** `Fri, 12 Sep 2025 04:50:42 +0000`. It parses
to `2025-09-12T04:50:42.000Z` and there is a test pinning that, because a
quietly dropped date is the sort of thing that survives for years.

**Pinterest's image keys begin with a digit.** `236x`, `474x`, `736x`, `orig`.
The path language cannot address a key that starts with a digit, in quoted or
dotted form, so no thumbnail is set and a preview row loads the original. That
costs bandwidth on a long feed. It is recorded here rather than worked around,
because teaching the parser a new grammar rule for one site is a poor trade
against the next site that needs it.

## Not mapped

- **Video pins.** None appeared in either capture, so no rule exists for them
  and none is guessed. `is_video` and `videos` are present on the pin object
  but were absent throughout, and Pinterest's video is a separate rendition
  tree rather than a second entry in `images`.
- **A pin's own page**, `/pin/<id>/`, which was not opened.
- **Boards and profiles**, although the discovery step finds both.
- **Shopping pins**, which carry product data alongside the media and were not
  separated out.