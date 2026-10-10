# Security

## Reporting

Open a private security advisory on the repository rather than a public issue.
Include the version, the browser, and the steps to reproduce.

## What the extension does with your data

Everything stays on your machine. There is no server, no account and no
analytics. The only outbound requests are to the media URLs you choose, plus
the endpoints an add-on has asked about, and those go to the site you are
already visiting using the session you are already signed in with.

## The stance

- **No DRM circumvention.** Encrypted content is marked Protected and cannot be
  downloaded. This is enforced, not merely documented.
- **No remote code.** Everything the extension runs is in the package. MV3
  forbids fetching code at runtime and this extension does not try.
- **Observation only.** The `webRequest` listener reads response headers. It
  never blocks, rewrites or returns a value, so a page cannot tell the
  difference with the extension installed or not.
- **Add-ons cannot execute code.** They are validated JSON that names hosts and
  paths. There is no `eval`, no function field, and no path from an add-on to a
  network request that a plain browser fetch would not already make.
- **No host is trusted on a substring.** Host matching is on DNS label
  boundaries, so a lookalike domain cannot borrow another site's add-on.

## Trust boundary worth knowing about

The page hook runs in the page's own JavaScript context, which means the page
can see that it is hooked and can post anything it likes to the content script.
Messages arriving from the page are therefore validated, not trusted: only a
URL and a body string are read from them, and both are re-parsed and
re-classified on our side.

The reverse direction is the sharper edge. Because the page hook wraps
`fetch` and `XMLHttpRequest`, a sufficiently determined page could interfere
with its own requests through it. That is inherent to hooking, it is the same
thing every extension in this category does, and the alternative, giving up
JSON API coverage, is a worse product.

## Disclosure

We will credit reporters in the changelog unless asked not to, and we will say
plainly which versions carry a fix.
