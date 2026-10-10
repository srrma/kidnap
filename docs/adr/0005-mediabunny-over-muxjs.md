# mediabunny in place of a hand-rolled muxer

## Status

Accepted.

## Context

The previous assembly path used mux.js, which has had no release since 2019,
and drove it with a hand-written m3u8 parser.

That parser did not implement `EXT-X-MAP`, so every fragmented-MP4 stream,
which is most modern HLS, failed outright. It kept a single key for the whole
playlist, so a playlist that rotated keys decrypted to garbage. It ignored
`EXT-X-BYTERANGE`. None of these had a test, because none of them had been hit.

## Decision

Assembly goes through mediabunny, which is actively maintained, has no
dependencies, and reads HLS, MPEG-TS and CMAF directly.

## Reasoning

The parser bugs were not hard to fix one at a time. They were the predictable
result of implementing a container format partially, with no fixtures to catch
the gaps. A maintained library is the smaller ongoing cost.

The conversion is a packet copy, so the promise holds: no re-encode, no quality
loss.

## Consequence

mediabunny is the extension's only runtime dependency, and it is roughly
570 KB in the offscreen chunk. It is loaded only where assembly happens and
never enters the content script or the page hook, which stay around 11 KB and
2 KB respectively.
