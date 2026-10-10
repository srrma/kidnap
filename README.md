# Kidnap

A browser extension that finds the images, video, audio, streams and documents
a page has already loaded, and lets you save them.

Everything runs on your machine. There is no server, no account and no
telemetry. The only network requests the extension makes are to the media URLs
you choose, using the session you are already signed in with.

MIT licensed.

## Install it from source

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load
unpacked**, and pick the `dist/` directory. For Firefox run `npm run
build:firefox` and load `dist/manifest.json` through `about:debugging`.

## How it finds things

Five detectors feed one list. Each covers a case the others miss, so a page
that defeats one usually falls to another.

| Detector | What it catches |
| --- | --- |
| Network | Every media response the browser receives, identified by content type and by file extension, along with the size and metadata the server reported. |
| Document | Images, video and audio elements, `srcset` candidates, CSS background images, meta tags, download links and lazy-loaded attributes. Runs in every frame. |
| Page hook | Media manifests and segments as the page fetches them, plus the JSON bodies of endpoints an add-on asked about. |
| Add-ons | Site-specific JSON APIs, mapped by data rather than code. |
| Right-click | Whatever you point it at, unfiltered. |

`blob:` addresses are treated as a signal rather than an item. A blob URL is a
pointer into memory that nothing can download, so seeing one means the player
already assembled something and the real URL is worth looking for.

## Why an add-on cannot run code

An add-on is JSON. It names the hosts to watch, the paths worth intercepting,
and where inside a response the media URLs live. It cannot call a function,
reach the network on its own, or touch the page. That limit is what makes it
reasonable to paste an add-on from a forum post. See [ADDONS.md](ADDONS.md).

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

## Licence

MIT. See [LICENSE](LICENSE).