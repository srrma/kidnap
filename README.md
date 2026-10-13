# Kidnap

A browser extension that finds the images, video, audio, streams and documents
a page has already loaded, and lets you save them.

Everything runs on your machine. There is no server, no account and no
telemetry. Nothing is sent anywhere except to the pages you are already on and
the media URLs you ask for.

One request happens without you asking for it. A video row that is on screen
plays a fraction of a second of the file to draw its picture, so the row can
show you what it found. It goes to the site you are already looking at, for a
file that page had already requested in order to play, and it is how a row
shows a picture instead of a file name.

Everything else waits for you. Saving a file is a request, and converting a
web font to TrueType fetches the font once more, but only when you press the
button.

MIT licensed.

## Install it

The reliable way to install Kidnap is through the Chrome Web Store or
addons.mozilla.org. A store signs what it serves, which is the part a user
cannot check for themselves.

Building from the source in this repository produces the same extension. It is
the way to read the code before running it, and it is what anyone reviewing
this repository should do.

## Check what you were given

If you download a release archive rather than building, do not trust the file
name or the download count. Each archive on the
[releases page](https://github.com/srrma/kidnap/releases) is accompanied by two
things that let you check it.

**`SHA256SUMS`** confirms the download arrived intact:

```bash
shasum -a 256 -c SHA256SUMS
```

**An attestation** confirms where it came from. It is signed by GitHub through
Sigstore and recorded in a public transparency log, and it names the commit and
the workflow run that produced the file. Verifying it needs no trust in the
person who published the release:

```bash
gh attestation verify kidnap-1.0.0-chromium.zip --repo srrma/kidnap
```

The command prints the identity that signed it and the source commit. If the
archive was built anywhere but a GitHub Actions run of this repository, at a
commit that is not the tag, it fails.

Nothing here is a substitute for reading the code. The archives are the same
bytes as the source, and the source is short enough to read.

## Install it from source

```bash
npm install
npm run build
```

The build writes to `dist/`. Load that directory as an unpacked extension:

**Chromium.** Open `chrome://extensions`, turn on Developer mode, choose **Load
unpacked**, and select `dist/`.

**Firefox.** Open `about:debugging#/runtime/this-firefox`, choose **Load
Temporary Add-on**, and pick `dist/manifest.json`. A temporary add-on is removed
when Firefox closes; for something permanent it has to go through
addons.mozilla.org.

Both show a warning that a store build would not, because both are running an
unsigned extension. That warning is accurate.

## How it finds things

Three detectors feed one list, from five sources. Each source covers a case
the others miss, so a page that defeats one usually falls to another.

| Source | Detected as | What it catches |
| --- | --- |
| Network | `network` | Every media response the browser receives, identified by content type and by file extension, along with the size and metadata the server reported. |
| Document | `dom` | Images, video and audio elements, `srcset` candidates, CSS background images, meta tags, download links and lazy-loaded attributes. Runs in every frame. |
| Page hook | `network` | Media manifests and segments as the page fetches them, plus the JSON bodies of endpoints an add-on asked about. |
| Add-ons | `addon` | Site-specific JSON APIs, and sites that render their data into the page instead, mapped by data rather than code. |
| Right-click | `dom` | Whatever you point it at, unfiltered. |

`blob:` addresses are treated as a signal rather than an item. A blob URL is a
pointer into memory that nothing can download, so seeing one means the player
already assembled something and the real URL is worth looking for.

## Why an add-on cannot run code

An add-on is JSON. It names the hosts to watch, the paths worth intercepting,
and where inside a response the media URLs live. It cannot call a function,
reach the network on its own, or touch the page. That limit is what makes it
reasonable to paste an add-on from a forum post. See [ADDONS.md](ADDONS.md).

X / Twitter deserves a note of its own: its responses change shape depending on
which surface you are on, and the differences are recorded in
[docs/x-responses.md](docs/x-responses.md) rather than left to be rediscovered.

## Thumbnails

Images show themselves. Video rows show a real frame decoded from the file
itself, taken a moment in from the start because the first frame is often black.
Frames are only decoded for rows that have scrolled into view, two at a time,
because browsers keep a limited number of video decoders alive and each decoded
frame costs memory.

When an add-on already knows the poster URL that is used instead, which costs
nothing and works on every CDN.

A poster needs the server to allow the pixels to be read back. A CDN without
permissive headers taints the frame, and there is no honest way around that, so
the row keeps a type badge instead. Protected media never gets a poster at all,
since the download button is disabled and the request would buy nothing.

## Saving a stream

A direct file goes straight to your browser's download manager. A segmented
stream is fetched piece by piece and joined into one file without re-encoding,
so the saved copy is the same bytes at the same quality that was streamed.

## Fonts

Adobe Fonts has no catalogue API you may call, so its family and collection
pages are read directly: every variation in the catalogue appears in the panel,
named for what it is, with the designer and the family it belongs to.

Fonts are offered twice. **Save** gives you the file the server sent, byte for
byte. **TTF** converts it to TrueType, which is what Windows will install,
since the web format is not an installable font there. The conversion is a
repackaging: the outlines, names and metrics carry across unchanged.

The conversion runs in a sandboxed page, because the only library that can do
it needs an `eval` that Manifest V3 forbids in an extension page. That is
Chromium only; see [LIMITATIONS.md](LIMITATIONS.md).

## What it will not do

No DRM, no paywall, no authentication bypass. Content that a site encrypts for
delivery is marked **Protected**, and the download control is disabled with a
reason. This is a deliberate position, not a missing feature.

The full list of constraints is in [LIMITATIONS.md](LIMITATIONS.md).

## Permissions

| Permission | Why |
| --- | --- |
| `webRequest` | Read-only observation of responses, so media can be identified by its real content type. Nothing is blocked or modified. |
| `storage` | Keeps detected media for the tab, settings, and your add-ons. |
| `downloads` | Saves files. |
| `contextMenus` | The right-click entry. |
| `sidePanel` | Chromium only, for the panel. Firefox uses `sidebar_action` and does not ask for it. |
| `offscreen` | Chromium only, so a long stream assembly keeps running when the panel is closed. |
| `<all_urls>` | Detection works on any site. You can mute individual hosts in Settings, which switches detection off there. |

`declarativeNetRequest`, `scripting` and `activeTab` were in v2 and are gone
here, because nothing used them.

## Layout

```
src/
├── core/       pure logic: classification, filtering, URLs, filenames
├── addons/     the add-on engine and the built-in add-ons
├── bus/        the typed message contract
├── store/      per-tab storage and settings
├── background/ service worker: detection, jobs, menus
├── content/    DOM sweeping and the page-world hook
├── offscreen/  stream assembly
└── panel/      the side panel, opened from the toolbar icon
```

## Development

```bash
npm run verify   # typecheck, lint, test, build
npm run watch    # rebuild on change, then reload the extension
npm run package  # zip both targets into artifacts/
```

The extension has to be reloaded in the browser after a rebuild. Console output
lands in three different places depending on which context logged it: the
service worker console, the content script console under the frame you are
inspecting, and the page console for the page hook.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. In short: `src/core/` stays pure,
the message contract is the only place a payload shape is declared, and every
change runs `npm run verify`.

## License

MIT. See [LICENSE](LICENSE).