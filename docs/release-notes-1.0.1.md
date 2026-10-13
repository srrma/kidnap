# Kidnap 1.0.1

Pointing at a picture now finds its row, one picture served at six sizes is one
row rather than six, and two claims in this project's own documentation were
wrong. Both are corrected below.

Everything runs on your machine. There is no server, no account and no
telemetry. Nothing is sent anywhere except to the pages you are already on and
the media URLs you ask for.

## What changed

**The picker.** Arm it from the header, then hover any picture on the page and
its row lights up in the panel. It exists because a long feed is the case the
panel is worst at: five hundred rows are a scroll and a squint, and the person
who wants one photograph has no way to say which one without reading filenames.
The row scrolls into view only when it is genuinely off screen, so it never
fights your own scrolling. It matches on URL, so it works where the visible
element points at a file the list actually holds; the caveat is below.

**Renditions collapse into one row.** One photograph served at twelve sizes used
to be twelve rows. They are now one row with a quality picker. The list of path
segments that mean a rendition rather than identify a thing is closed on
purpose, because two profile pages differ in one segment too, and there the
segment means a person. On a Behance feed this takes 345 items to 82 rows.

**Author and permalink on every row.** Both were already collected on every
add-on rule and shown to nobody, which turned a list of files into a list of
things nobody posted.

**A JSON export.** The panel gathered far more than it showed, so the rest is
now available to whoever wants it: an add-on author, or anyone filing a bug.
Query string values are stripped and the parameter names kept, because a media
URL routinely carries a signature or a session token and an export is the most
likely thing in this extension to be pasted somewhere public.

**Controls meet a 44px target.** The row actions were 26px and the header
buttons 30px. Padding alone would have made the list sparse, so the visual stays
compact and each control grows an invisible target back to 44.

## Corrections

Two statements in this project's documentation did not survive being checked
against the code, and both are fixed.

**The README said the only network requests the extension makes are to media
the user picks.** That was wrong, and had been since it was written. Drawing a
poster frame for a video row fetches that video on its own, without a click. It
goes to the site you are already looking at, for a file that page had already
requested in order to play. The README now names it.

**The 1.0.0 notes said seven add-ons are backed by a fixture cut from a
response their site actually sent.** True of the fixtures, misleading about the
product. Driving the built extension against signed-in pages shows that only X
extracts anything from live traffic; the other add-ons match their declared
endpoints and return nothing. `LIMITATIONS.md` now records this properly.

## Verified

Eleven pages across nine hosts, signed in, checking both readers: a person
finding one picture on a busy page, and someone needing the list as JSON.
104 of 109 checks pass. The five that do not are the picker on five sites,
where the element under the pointer points at an asset the list does not hold.
They are left failing and named rather than tuned until they pass.

The packaged archive was downloaded from this release and loaded, so the bytes
people actually get were tested, not the local build.

## Install

`kidnap-1.0.1-chromium.zip` or `kidnap-1.0.1-firefox.zip` from this page.

Verify an archive before trusting it:

```bash
shasum -a 256 -c SHA256SUMS
gh attestation verify kidnap-1.0.1-chromium.zip --repo srrma/kidnap
```

The second command prints the identity that signed the archive and the commit
that produced it, checked against GitHub's public transparency log. If the file
was built anywhere but a GitHub Actions run of this repository, at a commit
that is not the tag, it fails.

Building from the source in this repository produces the same extension, and is
the way to read the code before running it.