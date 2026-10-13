# Changelog

## 1.0.1

The picker, rendition grouping, author and permalink on every row, and a JSON
export with query values stripped. Two claims in this project's own
documentation did not survive being checked against the code: the README denied
the request that poster frames make, and the release notes implied site
awareness that only one add-on currently has against live traffic. Both are
corrected, and the limitation is recorded where a reader will find it.

Controls meet a 44px target.

## 1.0.0

The first release.

### Added

- A declarative add-on system. Add-ons are JSON, validated on the way in, and
  cannot execute code. Nine built-ins ship. Seven are backed by a fixture cut
  from a captured response; the TikTok and Imgur fixtures are written by hand
  and are marked as such by `scripts/coverage.mjs`, which prints the provenance
  of every fixture.
- `when` conditions, fixed values, last-path-segment reads and permalink
  templates in the add-on language, each added because a platform needed it.
- Rewrites now apply to every recorded URL rather than only to URLs the same
  add-on produced, so a rewrite-only add-on works.
- Stream assembly through mediabunny. Fragmented MP4 streams, rotating
  encryption keys and byte ranges all work,
  all three of which the previous parser got wrong.
- Cancellation for running stream jobs.
- A per-host mute list, so detection can be switched off on a site without
  uninstalling anything.
- A working light and dark theme, with a system option.
- Single-key media storage. A busy page writes a handful of times instead of
  once per detection.
- Video posters decoded from the file, generated only for rows on screen and at
  most two at a time. v2 had a poster generator wired to nothing.
- MIT licensing, a Firefox build, and a contributor guide.

### Fixed

- Quality variants of one post now collapse into one row. Previously only three
  platforms grouped them at all, and the lowest bitrate was often the one shown
  as the best.
- X detection works on timelines and conversations, not only on a tweet opened
  directly. Previously one endpoint shape was handled and the rest silently
  found nothing.
- A user minimum image size is applied at every filter level, including
  relaxed. It was silently ignored before.
- Embedded SVG art is no longer discarded for being small, since vector
  compresses far harder than raster.
- Panel rows update when an item's details change after the row is drawn. They
  used to freeze at whatever was known when they first appeared.
- Host matching is on label boundaries, so a lookalike domain can no longer
  match another site's rules.
- The reserved Windows device names can no longer produce an unsaveable
  filename.

### Removed

- Three permissions that were declared but unused: `declarativeNetRequest`,
  `scripting` and `activeTab`.
- SoundCloud support. It depended on regex-scraping a client id out of a
  minified bundle, which breaks whenever they ship a new one.
- A MediaRecorder capture path that the interface never exposed.

### Not carried over

The Blob handling stance, the garbage filter levels and the no-DRM position are
all unchanged and their reasons are recorded in `docs/adr/`.
