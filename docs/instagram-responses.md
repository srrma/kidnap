# Instagram responses

A rule written against a plausible path looks exactly like a working one until
a real page is loaded. Instagram proved it the hard way; see the first entry
under Traps, which had been passing its own test the entire time while
extracting nothing from anywhere.

Everything marked **verified** was cut from a live signed-in response, is kept
under `tests/fixtures/`, and is asserted by a test.

## Regenerating

```bash
SAVE=1 node scripts/capture.mjs --site=instagram
BODIES=/tmp/ig node scripts/capture.mjs --site=instagram
node scripts/capture.mjs --site=instagram --surfaces=home,explore
```

The script browses signed in, follows a discovered profile and post, and reports
every API response's roots and media paths.

## The short version

Media is one object, at the end of a path that differs per surface and nowhere
else:

```text
media.id, media.pk, media.code, media.user.username
media.taken_at          epoch seconds
media.media_type        1 image, 2 video, 8 carousel
media.original_width, media.original_height
media.caption.text
media.image_versions2.candidates[]   { url, width, height }
media.video_versions[]               { url, width, height, type, bandwidth }
media.carousel_media[]               media objects, all over again
```

## Paths to that object

| Surface | Path | Status |
| --- | --- | --- |
| Home feed | `data.xdt_api__v1__feed__timeline__connection.edges[].node.media` | verified |
| Explore | `sectional_items[].layout_content.medias[].media` | verified |
| Explore reels | `sectional_items[].layout_content.medias[].clips.items[].media` | verified |
| Profile posts | `data.xdt_api__v1__feed__user_timeline_graphql_connection.edges[].node.media` | seen, no fixture |
| Reels | `data.fetch__XDTUserDict.clips_connection.edges[].node.media` | seen, no fixture |
| Story tray | `data.xdt_api__v1__feed__timeline__connection.edges[].node.explore_story.media` | seen, no fixture |
| Promoted posts | `data.xdt_api__v1__feed__timeline__connection.edges[].node.ad.items[]` | seen, no fixture |

The field layout inside the object is the same for all of them, so one set of
media specs covers every surface and only the `at` changes.

## Traps

**The rules read a shape the site stopped serving, and their tests said
otherwise.** They matched `items[]`, which is what `api/v1/feed/user` returns.
Measured against real bodies they extracted **zero rows**, from the feed and
from explore, while every test written for them passed. Now: 14 rows from the
feed and 16 from explore, every one with an author, a caption and a permalink.

**A hand-written fixture hid it.** `instagram-media.json` was written by hand to
match the rule. A rule tested against a fixture written to match the rule
proves nothing. That fixture is deleted; the two that remain are cut from
captured responses.

**`video_versions[]` is one level shallower than it looks.** Writing
`image_versions2.candidates[]` keeps `image_versions2` as a step of its own,
while `video_versions[]` is a single segment whose fan *replaces* it. The same
caret therefore reaches a different object in each, and a carousel child gets
it wrong in a way that silently drops the author:

```text
…media.carousel_media[].image_versions2.candidates[]   ^^ is the child, ^^^ is the post
…media.carousel_media[].video_versions[]               ^  is the child, ^^ is the post
```

**A carousel child has no author of its own.** It belongs to the post around
it, so the child specs reach further out for `user.username`, `caption.text`,
`pk` and `code`.

**A video carries its poster in `image_versions2`.** Both photo rules are
guarded on `video_versions` being absent, or every video arrives with its own
thumbnail as a second download.

**The profile and the feed share a connection under different names.**
`xdt_api__v1__feed__timeline__connection` and
`xdt_api__v1__feed__user_timeline_graphql_connection`. Reading only the first
means a profile yields nothing.

## Not mapped

- **A single post.** Opening `/p/<code>/` issued no post-detail API response in
  the sessions captured: the page rendered, but the only media-bearing
  response was the surrounding feed. Whether a post view now loads its own
  payload at all is unknown, and no rule assumes it does.
- **Direct messages**, whose responses were seen but carried no media.
- **Story items beyond the tray** (`reel_media` and friends).
- **`api/v1/feed/user/{id}/`**, still a real endpoint used by unofficial
  clients. Nothing on instagram.com serves it to a browser, so it is not read;
  the old rules for it were removed rather than left as decoration.