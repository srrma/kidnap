# blob and MediaSource are signals, not items

## Status

Accepted.

## Context

Most modern players assemble media in memory through MediaSource Extensions and
then hand the element a `blob:` URL. That string looks like a media address and
is treated like one by every detector that looks at the DOM.

## Decision

A `blob:` URL is never listed. Seeing one triggers a rescan instead, on the
theory that the manifest or segment behind it is worth finding.

## Reasoning

A blob URL is a pointer into the renderer's memory. Nothing can download it,
including this extension. Listing it produces a row whose only visible action
fails, and a list where the most prominent item is the one you cannot save is
worse than a list missing it.

The underlying bytes were fetched over the network, so the network observer and
the fetch hook have already seen them. Treating the blob as a reason to look
again converts an unusable row into a usable one.

## Cost

Where the real source cannot be resolved, the media does not appear at all. We
accept that rather than offering a control that cannot work.
