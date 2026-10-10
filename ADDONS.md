# Add-ons

An add-on tells Kidnap where a site's API keeps its media. It is JSON, and that
is the whole point: an add-on cannot call a function, cannot open its own
connections, and cannot touch the page. You can paste one from anywhere and the
worst it can do is produce rows you did not want.

## The shape

```json
{
  "id": "mysite",
  "name": "My Site",
  "hosts": ["mysite.com", "*.mysite.com"],
  "apiPaths": ["/api/media"],
  "rewrite": [
    {
      "host": "cdn.mysite.com",
      "pathPrefix": "/img",
      "setParams": { "quality": "original" }
    }
  ],
  "rules": [
    {
      "at": "items[].video",
      "media": {
        "url": "src",
        "width": "width",
        "height": "height",
        "group": "id",
        "author": "owner.name",
        "caption": "....title"
      }
    }
  ]
}
```

## Fields

### Top level

| Field | Meaning |
| --- | --- |
| `id` | Unique. A user add-on with a built-in's id replaces it. |
| `name` | Shown in the interface. |
| `hosts` | Which hosts this applies to. `example.com` matches `example.com` and every subdomain. `*.example.com` matches subdomains only. Matching is on label boundaries, so `example.com` never matches `notexample.com`. |
| `apiPaths` | URL path prefixes worth reading a body from. Leave it out to watch every path on those hosts. |
| `rewrite` | Optional URL upgrades. |
| `rules` | Where the media is inside a response. |

### `rewrite`

CDNs often serve a better copy when you ask properly. A rewrite forces the
right query parameters, or drops ones that would return a thumbnail. It only
ever edits the query string, so it cannot be used to send a download somewhere
unrelated.

### `rules[].at`

A dotted path to the value you want. A segment ending in `[]` fans out over an
array and produces one match per element:

```
items[].video.variants[]
```

### `rules[].media`

Paths are read from the match.

| Path form | Meaning |
| --- | --- |
| `src` | A field of the matched value. |
| `list[0]` | An index into an array. |
| `^id` | A field of the parent. `^^id` is a field of the grandparent. |
| `/data.post.id` | Absolute, read from the root of the response. |

The absolute form exists because a real response often keeps the post in one
branch and the media in another, and no chain of ancestors reaches across two
branches of a tree.

Media fields: `url` (required), `mime`, `bytes`, `width`, `height`, `label`,
`duration`, `bitrate`, `codecs`, `group`, `thumbnail`, `title`, `author`,
`album`, `track`, `caption`, `alt`, `published`, `postId`, `postUrl`.

Every one of those is a path, except where noted below. Three other forms exist
because a real payload often does not contain what you need:

| Form | Meaning |
| --- | --- |
| `{ "literal": "video/mp4" }` | A fixed value. Use it when the API hands out a URL with no declared type. |
| `{ "last": "record.uri" }` | The final path segment of another value. Bluesky keeps a post's rkey only inside an `at://` uri, so this is how its permalink is built. |
| `postUrl` | Builds a permalink from the ids it is made of. Each `{name}` is filled from `values[name]`. |

```json
"postUrl": {
  "template": "https://bsky.app/profile/{handle}/post/{rkey}",
  "values": {
    "handle": "^^^^^author.handle",
    "rkey": { "last": "^^^^^uri" }
  }
}
```

A `postUrl` that cannot be filled completely is dropped rather than emitted with
a hole in it.

### `rules[].media.when`

A rule can declare what it will accept. Without this there is no way to say
"only photos", and a video's poster frame ends up offered as if it were a
rendition.

```json
"when": { "path": "type", "equals": "photo" }
```

Also supports `in` for a list, `exists` for presence, and `absent` for the
opposite.

`timeFormat` says how to read `published` and `duration`: `iso`,
`epoch-seconds`, `epoch-millis` or `seconds`. Durations always end up in
seconds.

`group` is what makes quality variants collapse. Give every rendition of the
same post the same value and they become one row with a quality picker, rather
than three rows that look like duplicates.

## Why the path carries its ancestry

The earlier extractors walked every node of a response with one shared set of
"current author", "current caption" variables. On a feed response that meant a
caption seen near the top attached itself to a video found near the bottom.

Here each match carries only its own ancestors. `^` reaches the parent of the
match and nothing else, so a caption can only ever come from the post that
actually contains the media.

## Rewrites

`rewrite` applies to **every** URL the extension records, not only the ones the
same add-on extracted. An add-on that exists purely to upgrade a CDN URL has no
rules to match, so scoping its rewrite to rules that produced the URL would
stop it doing its only job.

Rewrites only ever edit the query string, which is enough for the common
"give me the original instead of the thumbnail" case and cannot be used to
redirect a download somewhere unrelated.

## Several shapes for one platform

Most platforms serve the same object from more than one endpoint, at a
different depth each time. A rule's `at` names one shape, so a platform needs
one rule per shape.

X has four, and they share one media spec written entirely with relative paths,
because the depth from a piece of media up to its own post is always two steps
regardless of how deep the response put the post:

```ts
const X_TWEET_PATHS = [
  'data.tweetResult.result',
  'data.threaded_conversation.instructions[].entries[].content.itemContent.item',
  // ...
];

const xRules = X_TWEET_PATHS.flatMap((prefix) => [
  { at: `${prefix}.extended_entities.media[].video_info.variants[]`, media: X_VIDEO },
  { at: `${prefix}.extended_entities.media[]`, media: X_PHOTO },
]);
```

Writing only the first of those is the bug this shape is here to prevent: it
works on a tweet opened directly and finds nothing while scrolling a timeline.

## Adding a built-in one

1. Add the spec to `src/addons/builtin.ts`. It is data, no new file needed.
2. Drop a captured response, trimmed of anything personal, into
   `tests/fixtures/`.
3. Add a test that extracts from it and asserts the fields you care about,
   including that variants share a `group`.
4. Run `npm run verify`. `scripts/parity.mjs` compares what the previous
   extractors emitted against what the add-ons emit now and fails on a gap.

The fixture is the point. Platform APIs change without warning, and a fixture
turns that silent breakage into a failing test.

## Try one without touching the code

Open Settings, paste an add-on into **Your own add-ons**, and save. Invalid
JSON is reported under the box and rejected; a structurally valid add-on that
simply matches nothing is accepted and stays quiet.

## What add-ons cannot do

- Cannot execute code, by construction.
- Cannot read a page global such as Bandcamp's `TralbumData`.
- Cannot scrape a client id out of a JavaScript bundle.
- Cannot download anything. They produce rows; saving is a separate step.

Those last three are real gaps, and they are the reason some sites are not
supported. See [LIMITATIONS.md](LIMITATIONS.md).