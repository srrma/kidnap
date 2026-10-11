# Fonts are a media kind, and the page is a source

Date: 2026-10-10

## Status

Accepted

## Context

Adobe Fonts has no catalogue API that anyone may call. The family or collection
page renders the entire catalogue into a script tag, and the file URL is not in
it at all: it is assembled from a kit id and a variation descriptor, with a
token that has to be attached.

That forced two decisions that neither the existing add-on format nor the media
model had an answer for.

## Decision

**A font is a media kind, not a document.**

The obvious home for a `.woff2` was `document`, alongside PDFs. Fonts are not
documents: they have no page to render, they are the thing a designer actually
wants, and lumping them in would hide every font behind the same preview state
as a spreadsheet. `font` is its own kind with its own filter, its own row label,
and a preview that says plainly there is nothing to show.

The extensionless CDN URL is the reason this needed care. Adobe serves fonts
from a path that ends in `/l`, with the type only in the header, so the content
type is the sole thing that identifies the file and it has to win over the
extension.

**A page can be a source, declared in the add-on.**

Rather than teach the engine about JavaScript page globals, or special-case one
site in the background, an add-on now says where the JSON sits inside the HTML
with a start and an end marker. It stays data, so the guarantee in
[0003](0003-addons-are-data.md) is untouched: a rule still cannot execute
anything.

The alternative was scraping a page global from the page world. That was
rejected for the reason it is still listed as a limitation: it needs a second
extension point, and it breaks silently on every redesign.

Sending a page is expensive, since a font catalogue is around 400 KB of markup,
so
it is not sent speculatively. The content script fetches the marker list once
and tests it against markup it already holds in memory, and posts only on a
match.

## Consequence

A site with no API can be supported by writing data. The cost is that markers
are matched on exact bytes, so a fixture that is prettified will not test the
same thing the server sends; the fixtures are stored readable and compacted in
the test for that reason.

The marker is a string in the add-on, so a redesign is a one-line fix rather
than a code change. That is a deliberate trade: it makes breakage quiet, which
is why the add-on has a fixture-backed test that fails when the marker stops
matching.
