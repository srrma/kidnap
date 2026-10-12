# Kidnap 1.0.0

A browser extension that finds the images, video, audio, streams and documents a
page has already loaded, and lets you save them.

Everything runs on your machine. There is no server, no account and no
telemetry. The only network requests the extension makes are to the media URLs
you pick, using the session you are already signed in with.

**Stream assembly.** Segmented media is assembled through mediabunny.
Fragmented MP4, rotating encryption keys and byte ranges all work.

**Add-ons are now data.** A site-specific extractor is JSON that names hosts and
paths. There is no `eval`, no function field, and no path from an add-on to a
network request a plain browser fetch would not already make. Nine ship
enabled. Seven are backed by a fixture cut from a response that site actually
sent; the TikTok and Imgur fixtures are written by hand and are marked as such.

**Both themes work.** Light, dark and
system are all available now, and neither one is the default.

**Firefox is supported.** A separate build exists, using `sidebar_action` and
an event page instead of the Chromium side panel.

**Quality variants collapse.** Ten copies of one post in ten resolutions used
to be ten rows, and the one shown as best was frequently the lowest bitrate.
They are one row now, and the best one is picked by bitrate.

**Detection reaches more of X and Instagram.** Both worked on a single post and
failed on a timeline. Timelines and conversations are handled now.

## Permissions

Three permissions that were declared but never used are gone:
`declarativeNetRequest`, `scripting` and `activeTab`.

What remains is listed in the README, one line each, with why.

## SoundCloud support was removed

It depended on scraping a client id out of a minified bundle, which breaks
every time they ship a new one. A feature that breaks on someone else's
release schedule is worse than no feature.

## No DRM circumvention

Encrypted content is marked Protected and cannot be downloaded. That is
enforced in code, not only stated here. See `docs/adr/0002-no-drm-bypass.md`
for the reasoning.

## Installing

Download `kidnap-1.0.0-chromium.zip` or `kidnap-1.0.0-firefox.zip` from the
assets on this page.

Chromium: unpack it, open `chrome://extensions`, turn on Developer mode, choose
**Load unpacked**, and select the folder.

Firefox: unpack it, open `about:debugging#/runtime/this-firefox`, choose
**Load Temporary Add-on**, and pick `manifest.json` from the folder. A temporary
add-on is removed when Firefox closes.

These builds are unsigned, so the browser warns you. A store build does not.
The code is identical.

## Full detail

The complete list of changes is in `CHANGELOG.md`.