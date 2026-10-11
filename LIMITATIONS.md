# Limitations

Known constraints, stated plainly. Nothing here is a surprise the extension is
hiding from you.

## Protected content

Kidnap does not bypass DRM, paywalls or authentication. Where a page
negotiates EME, every item in that tab is marked **Protected** and its download
control is disabled with the reason. No attempt is made to obtain keys, reach a
license server or work around a browser restriction.

This matches what comparable tools do. It is a position, not a gap.

## blob and MediaSource

A `blob:` address is a pointer into the player's memory, not a file. Listing it
would put a row in the list that nothing can save, so seeing one triggers a
rescan instead, on the theory that the manifest or segment behind it is worth
finding.

Where the real source cannot be resolved, the media will not appear at all. A
MediaRecorder capture path was left out of this version rather than shipped
half-wired.

## Links that expire

CDN and API URLs routinely carry time-limited tokens, and the query string is
never stripped, because a tidied URL that returns 403 is worse than a messy one
that works. The consequence is that a link copied yesterday may fail today.
Reload the page to capture fresh ones.

## Stream assembly

Assembly runs on Chromium in an offscreen document, and on Firefox in the panel
page, which means a Firefox assembly stops if you close the panel.

Conversion is a packet copy. Media data is repackaged without being decoded or
re-encoded, so quality is preserved exactly. Where a codec cannot simply be
copied into the container, the conversion is refused rather than silently
re-encoded at a different quality.

DASH is parsed for representations and assembled, but MPD parsing is
deliberately shallow. Unusual manifests, particularly multi-period ones with
segment timelines, may not resolve.

Live streams are captured up to the point the job is stopped, and there is no
resume.

## Sizes and posters

A decoded video poster needs the CDN to send permissive CORS headers, because
the frame is drawn to a canvas and the pixels have to be readable back. Most do
not, so many rows keep a type badge. Nothing is proxied to work around it.

Posters are held in memory for the life of the panel and are not written to
disk. They are a derived view of a file that can already be downloaded, and
caching them would cost storage to avoid work that is cheap to repeat.

## Sites waiting on an account or a capture

Reachable and worth doing, in rough order of how easy they look:

- Tumblr. `/api/v2/blog/<name>/posts`, tidy and regular. Not started.
- VK and VK Video. rich, and more complicated.
- Pixiv. see below; reachable, but not by the path expected.
- Imgur. The gallery is embedded, and needs a two-stage parse.
- Bandcamp. Needs a page-world scraper, because the track list is rendered
  into the HTML rather than fetched.

### Pixiv

Signed in, the recommended feed renders sixty to sixty-five illusts and loads
two dozen thumbnails from `i.pximg.net`. Those thumbnails are cropped: the path
is `/c/540x540_70/img-master/…`, where the trailing `_70` is a quality figure
and the original is `/img-master/…` or `/img-original/…`.

The data is not in an `/ajax/` response, of which the page makes a dozen and
every one of them carries a user profile or a preference rather than an illust.
It is in `__NEXT_DATA__`, around 77 KB, under `props.pageProps`, but that
namespace holds `dehydratedState` and `serverSerializedPreloadedState`, which is
a serialised Redux store rather than a documented shape.

So the illusts are there and the keys are not obvious, which is the worst
combination: enough evidence that it works, none of what it looks like. It was
left unmapped rather than guessed at, which is what
`skills/kidnap-addon/SKILL.md` asks for.

`scripts/capture.mjs` reads the shared cookie jar, so a signed-in capture of any
of these is `node scripts/capture.mjs --site=<name>` once a profile exists.

## Add-on coverage

Add-ons read a JSON API, or, where a site offers no API that may be called,
JSON that the site renders into its own page. Adobe Fonts is the second kind:
its catalogue is in a script tag, and an add-on declares where that starts and
ends. Two things this version still does not attempt:

- **Page globals.** Bandcamp exposes track data on `window.TralbumData`.
  Confirmed current on a live album page: the global is present, and no script
  tag in the document contains it, so it is assigned at runtime rather than
  embedded. That makes it invisible to the `embedded` marker, which reads
  markup, and reading it needs a page-world scraper, which is a second
  extension point.
- **Client id scraping.** SoundCloud requires a client id that is extracted by
  regex from a minified JavaScript bundle. That breaks whenever they ship a
  new bundle, and v2 shipped exactly that.

Both are the kind of thing that works until it does not. They are documented as
missing rather than shipped and quietly broken.

## Fonts on Firefox

A web font can be saved exactly as the server sent it everywhere, which is what
the Save button does. Saving it as TrueType needs the sandboxed converter, and
Firefox does not implement the manifest sandbox the way Chromium does, so the
TTF button is not offered there rather than offered and broken.

## Noise filtering

The filter runs twice: once when an item is detected, and again when the list
is drawn, so changing the level takes effect on what is already stored.

One consequence is worth stating. Turning the level down to **relaxed** cannot
bring back something a stricter level already discarded at detection time.
Reload the page after loosening it.

A user minimum image size applies whatever the level is, because it is your
decision rather than a guess.

## Detection scope

Detection covers `<all_urls>` and can be muted per host in Settings. A muted
host stops the network observer and the content script's reporting for that
host, but the content script still loads, because that is how the extension is
injected in the first place.

## Browser support

Chromium is the primary target. Firefox is supported and built separately
(`npm run build:firefox`) with its own manifest, but it has no offscreen
document and no action badge, so stream assembly runs in the panel and the
toolbar count is absent.

Safari is not supported.
