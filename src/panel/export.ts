/**
 * What the panel hands over when the list is exported.
 *
 * The list already holds more than the panel shows. Most of it is gathered on
 * every add-on rule and never reaches the person using the extension, which
 * makes it useful to exactly one other reader: someone writing an add-on or
 * filing a bug, who needs the fields rather than the summary line.
 *
 * One field is treated differently. A media URL routinely carries a signature,
 * a token or a session id in its query string, and an export is the most
 * likely thing in this extension to be pasted into a public issue. The query is
 * kept, because which parameters a site signs with is itself worth seeing, and
 * the values are not, so they are replaced by their names.
 */

/** Replaces the value of every query parameter with its own name. */
export function redactQuery(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.search) return url;

  const names = [...parsed.searchParams.keys()];
  if (names.length === 0) return url;

  parsed.search = names.map((name) => `${name}=REDACTED`).join('&');
  return parsed.toString();
}

/** Fields kept out of an export because they identify the machine, not the media. */
const OMITTED = new Set(['tabId', 'id', 'foundAt']);

function exportable(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (OMITTED.has(key) || value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] =
      key === 'url' || key === 'pageUrl' || key === 'thumbnail'
        ? redactQuery(String(value))
        : value;
  }
  return out;
}

/**
 * The export body, sorted so two exports of the same list compare equal.
 *
 * Everything that leaves as a string goes through the same redaction, not only
 * the items. The page the list came from was the one leak: an item's URL is
 * redacted, but the enclosing header carried the page URL untouched, and on a
 * signed-in page that is where a captcha key and a session token live.
 */
export function toJson(items: unknown[], meta: Record<string, unknown> = {}): string {
  const rows = items
    .map((item) => exportable(item as Record<string, unknown>))
    .sort((a, b) => String(a.url ?? '').localeCompare(String(b.url ?? '')));

  const header: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    header[key] = typeof value === 'string' ? redactQuery(value) : value;
  }

  return `${JSON.stringify({ ...header, count: rows.length, items: rows }, null, 2)}\n`;
}
