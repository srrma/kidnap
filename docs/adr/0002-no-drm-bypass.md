# No DRM circumvention

## Status

Accepted.

## Context

Encrypted delivery is negotiated between the page and a content decryption
module. The bytes the browser hands to the player have already been decrypted,
and the segments on the wire cannot be reconstructed without a key the
extension has no legitimate route to.

## Decision

Detect EME and license endpoints, mark every item on the page **Protected**, and
disable the download control with the reason shown.

## Reasoning

Offering a download that fails with a 403 teaches the user the extension is
broken. Saying "this is protected" is true, immediate, and matches what every
comparable tool does.

It is also the only position that keeps the extension publishable and keeps
users out of a legal grey area they did not choose to enter.

## Consequence

Protected content is never downloadable, even where the user has a legitimate
license for it. That is accepted.
