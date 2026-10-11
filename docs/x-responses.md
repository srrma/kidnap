# X / Twitter responses

What x.com actually sends, recorded so nobody has to guess it again.

Two shapes for one endpoint cost this project twice, and both times the rule
looked correct and simply matched nothing. A path that is merely plausible is
indistinguishable from one that works until a real page is loaded. So this is a
record of responses, not of intent.

Everything marked **verified** here was cut from a live signed-in response, is
kept as a fixture under `tests/fixtures/`, and is asserted by a test. Anything
else says so plainly.

Regenerate the whole thing with:

```bash
SAVE=1 node scripts/capture.mjs --site=x         # browse, then write the report
BODIES=/tmp/x node scripts/capture.mjs --site=x   # keep the payloads too
node scripts/capture.mjs --site=x --surfaces=home,search-live
node scripts/capture.mjs --site=x --url=/someone/status/123
```

The same tool covers [Instagram](instagram-responses.md), [Facebook](facebook-responses.md),
[Reddit](reddit-responses.md), Bluesky, Imgur, Twitch and TikTok with `--site=`.
Cookies are optional: Bluesky, Imgur and Twitch serve media to a browser with
no account, and a signed-out session is a perfectly good thing to map.

The script browses as the signed-in user, visits ten surfaces, and reports every
`/i/api/` response: its roots, where media appears in it, and whether the user
object carries a `legacy` wrapper. Thirty endpoints were seen in a single run;
six of them carry media.

## The short version

Media lives at `…tweet_results.result.legacy.extended_entities.media[]`. Six of
the seven places it appears differ only in the path to `instructions`. That is
the whole shape, and every difference below is a trap rather than a new idea.

The user object is at `result.core.user_results.result.core.name`. It is **not**
`…result.legacy.name`; the legacy wrapper was removed and 31 user objects in a
single capture had no `legacy` at all.

## Endpoints that carry media

| Endpoint | Path to `instructions` | Status |
| --- | --- | --- |
| `HomeTimeline` | `data.home.home_timeline_urt.instructions[]` | verified |
| `SearchTimeline` | `data.search_by_raw_query.search_timeline.timeline.instructions[]` | verified |
| `UserOriginalsTimeline` | `data.user.result.timeline.timeline.instructions[]` | verified |
| `UserVideoTimeline` | `data.user.result.timeline.timeline.instructions[]` | verified |
| `Bookmarks` | `data.bookmark_timeline_v2.timeline.instructions[]` | verified |
| `TweetDetail` | `data.threaded_conversation_with_injections_v2.instructions[]` | verified |
| `TweetResultByRestId` | `data.tweetResult.result` | fixture only |
| `ExplorePage` | `data.explore_page.body.initialTimeline.timeline.timeline.instructions[]` | rule written, no body captured |
| `NotificationsTimeline` | not yet mapped | **not covered** |

From `instructions[]`, three shapes reach a tweet:

```text
…instructions[].entries[].content.itemContent.tweet_results.result
…instructions[].entries[].content.items[].item.itemContent.tweet_results.result
…instructions[].entries[].content.itemContent.item                       (promoted posts)
```

All three exist. The second is a module wrapper and the third is not a tweet at
all, which is why promoted-post media is handled separately.

## Traps

**Two shapes for one endpoint.** A timeline used to put `extended_entities`
*beside* `legacy`. It now nests it *inside* `legacy`, which moves the tweet one
level away and changes every ancestor depth in the rule. Rules for both are
kept, because the older spelling still turns up on other entry points.

**The home timeline was missing entirely** while search and a tweet opened
directly both worked, which is exactly the report that started this document.
The rule existed but was written against the sibling shape. Fixed: across the five
captured bodies the add-on now yields 276 rows, every one carrying an author,
where it had yielded 57 from the home timeline and nothing from the other four.
Confirmed live afterwards on search, a profile and a profile's media tab:
21, 38 and 95 rows, all with authors.

**The profile root is `timeline.timeline`, not `timeline_v2.timeline`.** A
plausible-looking name that matches nothing.

**Quoted tweets are a second result object**, at
`…tweet_results.result.quoted_status_result.result.legacy…`, with its own media.
Every timeline carries them. Rather than writing each surface out twice, every
path gets a quoted twin derived from it.

**`entities.media[]` mirrors `extended_entities.media[]`.** A capture showed
identical counts under both in all five bodies. Reading `entities` would double
every row, so only `extended_entities` is read.

**A video's poster is a media object too**, and carries a `media_url_https`. The
photo rule is guarded on `type == 'photo'`; without it, every video also arrives
with its own thumbnail as a separate image download.

**Hand-built fixtures lie.** The search fixture used here for months was written
by hand from a real skeleton, and being hand-built it had the wrong nesting. The
search rule passed its test the entire time and matched nothing on the site. All
X fixtures are now cut from captured bodies, keeping only the fields the rules
read, so the shape cannot drift into a fiction.

## Not mapped

- **Notifications.** `NotificationsTimeline` was captured but carried no media
  in that run, so its shape is unknown. It is the largest remaining surface
  that certainly contains tweets with media.
- **Direct messages**, lists, Spaces and live video.
- **Longform articles and card-based posts**, which carry no `extended_entities`
  at all and are a separate piece of work.
- Whether `ExplorePage` nests media the same way. The rule is written on the
  same assumption as every other timeline and has never been run against a body.

When one of these is added, capture it, cut a fixture, and move its row in the
table from unverified to verified.
