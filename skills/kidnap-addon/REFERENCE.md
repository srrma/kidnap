# Add-on reference

Loaded on demand. The format is in [ADDONS.md](../../ADDONS.md); this is the
arithmetic and the shapes.

## Caret arithmetic

`at` selects a position. Every `media` path is relative to it. `^` steps out one
ancestor, `^^` two, and so on. Getting this wrong is the most common bug, and it
fails silently: rows appear, with no author.

**The rule: `[]` replaces its own segment; a plain segment stays a step.**

```
data.media.image_versions2.candidates[]
        root  data  media  image_versions2  candidate
                                                  ^ leaf

…media.image_versions2.candidates[]     ^^   is media
…media.video_versions[]                  ^    is media
…media.carousel_media[].image_versions2.candidates[]
                                        ^^   is the child,  ^^^  is media
…media.carousel_media[].video_versions[]
                                        ^    is the child,  ^^  is media
```

`image_versions2` is written as its own segment, so it is a step. `video_versions[]`
is a single segment whose fan replaces it, so it is not. **The same caret
therefore reaches a different object in each.** This cost Bluesky every author on
a carousel video before a test caught it.

Check yourself:

```ts
import { pluck, read } from '../src/addons/paths';
const scope = pluck(body, 'feed[].post.media.video_versions[]')[0];
read(scope as never, '^author');   // the post, or the child?
```

## Verified shapes

Copy the nesting, not the names.

**X / Twitter.** Media is at `…result.legacy.extended_entities.media[]`, video at
`…media[].video_info.variants[]`. Root differs per surface:
`data.home.home_timeline_urt`, `data.search_by_raw_query.search_timeline.timeline`,
`data.user.result.timeline.timeline`, `data.bookmark_timeline_v2.timeline`,
`data.threaded_conversation_with_injections_v2`. Quoted tweets add
`.tweet_results.result.quoted_status_result.result.legacy`. The user object is at
`core.user_results.result.core.name`. There is **no** `legacy` wrapper on users.

**Instagram.** One media object, at the end of a path that differs per
surface:
`data.xdt_api__v1__feed__timeline__connection.edges[].node.media`,
`sectional_items[].layout_content.medias[].media`,
`data.fetch__XDTUserDict.clips_connection.edges[].node.media`. Inside it:
`image_versions2.candidates[]`, `video_versions[]`, `carousel_media[]`.
`media_type` is 1 image, 2 video, 8 carousel. A carousel child has no author of
its own and reads it from the post around it.

**Bluesky.** Every embed comes in two forms. `post.record.embed` is the
ATProto record with a CID and **no URL**. `post.embed` is the resolved form with the
links: `post.embed.images[].fullsize`, and `post.embed.playlist` which is the HLS
URL as a bare string. `cdn.bsky.app` is extensionless, so assert `image/jpeg`.

**Pinterest.** The feed is `resource_response.data[]`, search is
`resource_response.data.results[]`. `images.orig` is the download
rendition. `created_at` is RFC 2822 and parses.

**Behance.** Feed is `data.forYouFeed.nodes[].entity`, search is
`data.search.nodes[]`, both through `/v3/graphql`. `covers.allAvailable[0].url` is the original; the original
is first in every project captured, and there is a test saying so.

**Imgur.** A gallery page carries its own contents in
`window.postDataJSON="{…}"`, which is JSON written as a JavaScript string
literal. Needs a two-stage parse and a marker placed *before* the payload rather
than being its opening. Not implemented yet.

## What `classify` will throw away

A row is dropped unless the kind resolves. Extensionless URLs need an asserted
mime:

```ts
mime: { literal: 'image/jpeg' },   // cdn.bsky.app, use.typekit.net
mime: { literal: 'font/woff2' },   // Adobe's font CDN ends in /l
```

## Paths the language cannot express

- A key that begins with a digit: Pinterest's `images["474x"]`.
- Keys assigned per request: Adobe Stock's `{"440453718": {…}}`.
- Anything needing iteration over a payload's values.

The first is a parser limitation worth fixing if a second site needs it. The
second is a language change: yield values, do not select them. Neither should be
worked around inside one site.

## Field reference

| Field | Reads |
| --- | --- |
| `url` | path, `{ literal }`, `{ last }`, or `{ template, values }` to assemble |
| `when` | `{ path, exists \| absent \| equals \| in }`. First match wins, so one condition per rule |
| `group` | collapses a post's renditions into one row with a picker |
| `postUrl` | `{ template, values }`; a value that resolves to nothing skips the rule |
| `timeFormat` | `iso`, `epoch-seconds`, `epoch-millis`, `seconds` |
| `thumbnail` | shown in the row; never offered as its own download |

`url` may be a template because many sites carry the parts of a URL and not the
URL. A template with an unresolved placeholder is rejected at load time by
`validateAddon`.

## Testing

```ts
const items = extract('https://site/the/real/path', fixture('site-name.json'));
```

Assert structure rather than values wherever the fixture was scrubbed: every row
carries an author, a caption and a permalink, videos collapse into one group,
posters are not offered twice. Values come from a capture and will not mean
anything to the next reader.

A fixture is **captured** or **hand-written**, and only the first is evidence.
`node scripts/coverage.mjs` prints which each one is.