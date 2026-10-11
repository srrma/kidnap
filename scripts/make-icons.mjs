/**
 * Draws the icon set from scratch so the repository carries no binary asset
 * that nobody can regenerate. Standard library only: a hand-built RGBA buffer
 * and a minimal PNG encoder over node's zlib.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ACCENT = [233, 69, 96];
const BG_TOP = [38, 22, 30];
const BG_BOTTOM = [18, 14, 20];

/** Signed distance to a rounded rectangle: negative inside. */
function roundRect(px, py, halfW, halfH, radius) {
  const dx = Math.abs(px) - (halfW - radius);
  const dy = Math.abs(py) - (halfH - radius);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius;
}

/** Distance to a stroked line segment. */
function segment(px, py, ax, ay, bx, by, halfWidth) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy)) - halfWidth;
}

/**
 * The glyph is media falling into a saved file: an arrow above a tray. It is
 * drawn in normalised space so every size is identical, not scaled.
 */
function glyph(x, y) {
  const s = 0.085;
  return Math.min(
    segment(x, y, 0, -0.62, 0, 0.06, s),
    segment(x, y, -0.26, -0.16, 0, 0.08, s),
    segment(x, y, 0.26, -0.16, 0, 0.08, s),
    segment(x, y, -0.5, 0.06, -0.5, 0.44, s),
    segment(x, y, -0.5, 0.44, 0.5, 0.44, s),
    segment(x, y, 0.5, 0.44, 0.5, 0.06, s),
  );
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const feather = 2 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;

      const plateAlpha = clamp01(0.5 - roundRect(nx, ny, 0.94, 0.94, 0.44) / feather);
      const markAlpha = clamp01(0.5 - glyph(nx, ny) / feather);

      const t = (ny + 1) / 2;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = BG_TOP[c] + (BG_BOTTOM[c] - BG_TOP[c]) * t;
        pixels[i + c] = Math.round(base + (ACCENT[c] - base) * markAlpha);
      }
      pixels[i + 3] = Math.round(plateAlpha * 255);
    }
  }
  return pixels;
}

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // color type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, render(size));
  writeFileSync(new URL(`../icons/${size}.png`, import.meta.url), png);
  console.log(`icons/${size}.png  ${png.length} bytes`);
}
