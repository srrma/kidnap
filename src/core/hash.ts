/**
 * Stable identifiers. An item must keep the same id across a service worker
 * restart, or the panel's selection and the queue lose track of it.
 */

/**
 * FNV-1a, run twice with different offsets and concatenated. A single 32-bit
 * hash collides often enough to matter at a few thousand items per tab
 * (birthday bound puts it near 1 in 20), and a collision would silently merge
 * two different files. Two independent 32-bit lanes make that negligible.
 */
export function hash64(input: string): string {
  return `${fnv1a(input, 0x811c9dc5).toString(36)}${fnv1a(input, 0x01000193).toString(36)}`;
}

function fnv1a(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

let counter = 0;

/** Monotonic id for jobs. Unique within a session, never reused. */
export function jobId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
