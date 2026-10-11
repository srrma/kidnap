# Reddit responses

What reddit.com actually sends, recorded so nobody has to guess it again.

**The headline finding is that there is no API response to map.** The feed is
server-rendered custom elements. This file records what that means, because the
existing rules assume the opposite and have been reading a dead endpoint.

Signed in as the user in the supplied cookie file, `/r/<sub>/` renders. Every
`/api/`, `/svc/` and `.json` request observed across ten scrolls:

| Path | Calls | What it is |
| --- | --- | --- |
| `/svc/shreddit/events` | 13 | Telemetry |
| `/svc/shreddit/graphql` | 2 | Navigation, not posts |
| `/svc/shreddit/partial/*` | 7 | Nav, banners, mod tools |
| `/svc/shreddit/chat`, `inbox`, `reddit-chat` | 4 | Messaging |
| `/shreddit/assets/favicon/manifest.json` | 1 | PWA manifest |
| `/api/...` | 0 | **Never called** |
| `.json` | 0 | **Never called** |

No endpoint returned a post.

## What the feed actually is

Posts are `<shreddit-post>` custom elements. On a feed of 25 posts there were
**37 attributes per element, and no attribute contained a JSON blob**. The data
is flat and already parsed by the server:

| Attribute | Example |
| --- | --- |
| `content-href` | `https://i.redd.it/uzhbtfje7guh1.png`, the media, on every post in the capture |
| `permalink` | `/r/decomps/comments/1x2pp1u/…` |
| `post-title` | the title, flat text |
| `author`, `subreddit-name`, `domain`, `id` | |
| `created-timestamp`, `score`, `comment-count`, `upvote-ratio` | |
| `post-type`, `view-type`, `moderation-verdict`, `feedindex` | |

Everything else is presentation state: `view-context`, `is-awardable`,
`hide-awards-button`, `recommendation-source`, `data-expected-lcp`.

Video is not in these attributes. A video post renders as a
`<shreddit-player>` element, and none were present on the pages captured.

## What that means for the add-on

The rules read `data.children[].data.secure_media.reddit_video`. That is the
shape of `https://www.reddit.com/r/<sub>/.json`, the old public API. **A
browser signed in to the web app never calls it**, zero times in every capture
taken here.

Measured on `/r/pics/` with twenty-five posts:

```text
add-on rows   0
dom rows    198
network rows  51
```

So image posts are found, by the document scraper and by the network sniffer,
with no author, no permalink and no caption attached. The add-on contributes
nothing, which is why `scripts/coverage.mjs` reports Reddit as
"hand-written only": `reddit-post.json` was written to match the rule, and the
rule matches nothing.

## Traps

**A public JSON API existing is not evidence that a browser uses it.** It is
the most persuasive kind of wrong, because the shape is real, the endpoint is
real, and the documentation is real. Every rule here was written against a
response Reddit serves to scripts and not to people.

**Reddit's feed is HTML.** An add-on has nothing to read, because there is no
body. What reaches the extension is the document, and the media is one
attribute on a custom element.

## Not mapped

- **Video posts.** `<shreddit-player>` carries the stream, and none appeared on
  any page captured. Reddit serves video as DASH and HLS, which the assembler
  would handle, but no endpoint, attribute or manifest has been seen for it.
  A video subreddit is needed.
- **Galleries.** No multi-image post was captured.
- **Comments with media**, which live at a different path entirely.
- **`/svc/shreddit/graphql`**, seen twice but carrying navigation. Its shape is
  unknown and it should not be assumed to be a post source.

## Regenerating

```bash
SAVE=1 node scripts/capture.mjs --site=reddit
node scripts/capture.mjs --site=reddit --surfaces=home
```

Note that a capture of this site will keep finding almost no media, because
almost none travels in a response. The document scraper is the layer that sees
this site's posts, which is the opposite of every other platform here and the
main thing to remember about it.