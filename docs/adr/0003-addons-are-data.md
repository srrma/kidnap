# Add-ons are data, not code

## Status

Accepted.

## Context

Site-specific detection has to change when platforms change. Handing every
platform its own JavaScript module, each with its own deep walk over the
response body, was considered and rejected.

That approach had two problems. The walk shared one mutable set of "current
author" and "current caption" variables across the whole response, so a caption
seen near the top of a feed attached itself to a video found near the bottom.
And every platform needed a code change and a code review.

## Decision

An add-on is validated JSON. It names hosts, paths, and where inside a
response the media lives. It cannot execute code.

## Reasoning

A declarative path language cannot carry context across two branches of a
tree, which is precisely the bug being fixed. Each match carries only its own
ancestors, so `^caption` means the caption of the post that contains this
media and nothing else.

Making add-ons data also means a user can paste one from anywhere. The trust
model becomes readable: this thing watches four hosts and reads four fields.
A code add-on asks for trust that a JSON one does not.

## Cost

Two things add-ons cannot express. Reading a page global such as Bandcamp's
`TralbumData`, and scraping a client id out of a minified bundle. Both are
documented as unsupported rather than shipped. See LIMITATIONS.md.
