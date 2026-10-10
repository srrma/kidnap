/**
 * What is true of a font file regardless of where it came from.
 *
 * These live apart from the sandbox page that uses them because they are the
 * part worth testing: the sandboxed document is opaque to the test runner, so
 * anything decided inside it is decided untested.
 */

/**
 * The saved name has to end in .ttf or nothing will install it, whatever the
 * user's filename template asked for.
 */
export function ttfName(filename: string): string {
  return `${filename.replace(/\.[a-z0-9]{1,5}$/i, '')}.ttf`;
}

/**
 * A TrueType file opens with a four byte sfnt version tag.
 *
 * Checking it means a server that answered 200 with an HTML error page is
 * reported as a failure, rather than being saved as a font that will not load.
 */
export function isTrueType(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const tag = bytes.subarray(0, 4);
  /* 0x00010000 is TrueType outlines, 'true' is the older Apple spelling. */
  const sfnt = tag[0] === 0x00 && tag[1] === 0x01 && tag[2] === 0x00 && tag[3] === 0x00;
  const apple = tag[0] === 0x74 && tag[1] === 0x72 && tag[2] === 0x75 && tag[3] === 0x65;
  return sfnt || apple;
}
