# One storage key per item

## Status

Accepted.

## Context

The previous store kept one array per tab and rewrote the whole array on every
detection, behind a global lock. A page with 500 images therefore performed 500
writes whose payload grew with each one. That is quadratic in bytes for a
linear amount of work, and the global lock serialised four detectors behind a
single queue.

The file is also the most concurrency-sensitive in the extension. Losing a
write means silently losing media.

## Decision

Each item is its own key, written once and never rewritten. A per-tab index
holds the hashes and is flushed on a 150 ms timer, so a burst of 500 detections
becomes a small number of writes. Reads are two round trips regardless of tab
size: one for the index, one for the items it names.

Every mutation goes through the store, because a read-modify-write done
elsewhere races with a detector.

## Consequence

- Writes are O(n) in bytes rather than O(n squared).
- The index can briefly lag the item keys. `settle` exists for readers that
  need both, and the tests assert the item count after a burst.
- Storage churn is higher per write and much lower in total.
