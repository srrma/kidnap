# Adobe responses

Adobe runs several sites behind one login. [Adobe Fonts](x-responses.md)'s
sibling `docs/adobe-fonts` work already covers `fonts.adobe.com`. This file
records Behance, which is now supported, and Adobe Stock, which is not.

All Behance findings are **verified**: cut from a signed-in capture, kept under
`tests/fixtures/`, asserted by a test. Adobe Stock is recorded as unmapped,
with the reason.

Regenerate:

```bash
SAVE=1 node scripts/capture.mjs --site=behance
SAVE=1 node scripts/capture.mjs --site=adobestock
node scripts/capture.mjs --site=behance --surfaces=feed,search
```

## Behance

Everything comes through one endpoint, `/v3/graphql`, under two roots. A project
arrives under one of them and keeps the same fields either way, so only the
path differs:

```text
data.forYouFeed.nodes[].entity     the feed
data.search.nodes[]                search
```

A project:

```text
id                 a number, not a string as elsewhere
name, slug
url                the full permalink
owners[0].username who made it
publishedOn        ISO 8601
covers.allAvailable[]   fourteen renditions
sourceFiles[]      only on a project's own page
```

`covers.allAvailable` is the whole cover at fourteen sizes: `original`, then 808,
404, 202, 230 and 115, repeated across aspect ratios. **The original is first
in 48 of 48 projects captured**, in both the feed and a search of 48 more. That
is what makes `covers.allAvailable[0]` right rather than lucky, and there is a
test asserting it, a reshuffle would otherwise fail quietly, downgrading every
download to 115 pixels wide.

The URLs end in `.jpg` even though the path says `webp` and the payload says
`WEBP`. Nothing is asserted and the extension classifies them.

| Surface | Captured | Extracted |
| --- | --- | --- |
| Feed | 48 projects, all with covers | 3 from the fixture, with owner, name and permalink |
| Search | 48 projects, all with covers | 3 from the fixture, likewise |

### Traps

**`/v3/` not `/v2/`.** The first capture of this site returned nothing at all,
because the matcher was written for `/v2/`. A capture that finds zero endpoints
is not evidence that a site has none; it is evidence that the matcher is wrong.

**One endpoint name for the whole site.** Feed and search share `/v3/graphql`,
so a capture that saves one body per endpoint name keeps only the first, and
the two surfaces have to be captured separately to be seen at all.

**Behance's `id` is a number.** Every other platform uses a string, so there is
no post id to read; the permalink carries it anyway.

## Adobe Stock

**Not mapped, and the reason is structural rather than a matter of trying
harder.**

Stock serves almost nothing over `fetch`. A search page makes these calls:

```text
14  commerce.adobe.com/amsterdam/log     analytics
 4  cc-api-data.adobe.io/ingest           analytics
 1  stock.adobe.com/id/QuerySuggestion    the search box
 1  stock.adobe.com/franklin/stocknav     navigation
 1  sstats.adobe.com/ee/sgp3/v1/interact  analytics
```

The catalogue itself is rendered into the page:

```html
<script id="image-detail-json">{"440453718":{"id32":"MQPVj0B46vEevyCJjTtWfCqLXH0I"}, …}</script>
```

301 KB of JSON, **keyed by numeric asset id**.

That last part is the blocker. The add-on language reaches into a payload by
writing a path, and a map with keys like `440453718` cannot be written down: the
keys are assigned per search. Reading it needs either iteration over object
keys, which the language deliberately does not do, or a second extension point
that walks a payload and yields values rather than selecting them.

This is the same wall Pinterest hit from the other side, there the problem was
a key beginning with a digit and here it is the keys themselves, and the
honest answer is the same. The extension point that would fix both is iteration
over a response's values, not another path rule. That is a language change and
is named as such rather than worked around.

Stock is not broken by this. The document scraper and the network sniffer find
its images on the page; what is missing is the add-on's metadata.

## Not mapped

- **A Behance project's own images.** The feed carries only covers. A project's
  `sourceFiles[]` is where its images are, and that page was not opened.
- **Behance video**, which arrives as embedded players rather than in the
  payload.
- **Adobe Stock**, for the reason above.
- **Adobe Firefly, Express and Lightroom**, which share the login but were not
  visited.