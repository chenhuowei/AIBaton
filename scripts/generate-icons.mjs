#!/usr/bin/env node
/**
 * Aibaton brand icon generator — no external dependencies.
 *
 * Concept: "AI + baton". A dark rounded tile (matching the default dark theme),
 * a teal→blue gradient conductor's baton with a glowing AI node at its tip,
 * and two faint orbital arcs suggesting multi-agent relay / coordination.
 *
 * Renders analytically at each requested size (SDF + 1px smoothstep AA), then
 * writes PNGs and a classic BMP-based ICO for maximum Windows compatibility.
 *
 * Usage: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Color / math helpers
// ---------------------------------------------------------------------------
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const lerp3 = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** Signed distance: rounded box centred at (cx,cy) with half-size (hx,hy). */
const sdBox = (px, py, cx, cy, hx, hy, r) => {
  const dx = Math.abs(px - cx) - (hx - r);
  const dy = Math.abs(py - cy) - (hy - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
};
/** Signed distance: capsule (line segment with round caps). */
const sdCapsule = (px, py, ax, ay, bx, by, r) => {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - t * vx, wy - t * vy) - r;
};

// Palette (sRGB 0-255)
const BG_A = [16, 28, 46]; // #101C2E top-left
const BG_B = [22, 40, 62]; // #16283E bottom-right
const TEAL = [58, 224, 196]; // #3AE0C4
const BLUE = [91, 140, 255]; // #5B8CFF
const WHITE = [244, 249, 255];

/** Composite `src` (RGB + alpha 0..1) over `dst` RGBA array. */
function over(dst, i, rgb, alpha) {
  if (alpha <= 0) return;
  const a = clamp(alpha);
  dst[i] = mix(dst[i], rgb[0], a);
  dst[i + 1] = mix(dst[i + 1], rgb[1], a);
  dst[i + 2] = mix(dst[i + 2], rgb[2], a);
  dst[i + 3] = mix(dst[i + 3], 255, a);
}

/** Render one RGBA buffer at `size` x `size`. Design space is 1024 units. */
function render(size) {
  const s = size / 1024;
  const buf = new Float32Array(size * size * 4); // RGBA floats, alpha un-premultiplied
  // Init transparent
  for (let i = 3; i < buf.length; i += 4) buf[i] = 0;

  // Geometry in design units (scaled to pixels)
  const C = 512;
  const pad = 66;
  const half = (1024 - 2 * pad) / 2;
  const radius = 214;
  const AX = 302, AY = 716; // baton tail (lower-left)
  const BX = 716, BY = 302; // baton tip / AI node (upper-right)
  const batonR = 43;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / s;
      const py = y / s;
      const i = (y * size + x) * 4;

      // --- Tile background: rounded box + diagonal gradient + vignette ---
      const dBox = sdBox(px, py, C, C, half, half, radius) * s;
      const bgCov = 1 - smoothstep(-0.5, 0.5, dBox);
      if (bgCov > 0) {
        const t = clamp((px / 1024) * 0.55 + (py / 1024) * 0.45);
        let rgb = lerp3(BG_A, BG_B, t);
        // soft radial lift behind the baton tip
        const glow = 1 - smoothstep(0, 470, Math.hypot(px - BX, py - BY));
        rgb = lerp3(rgb, [30, 62, 94], glow * 0.55);
        over(buf, i, rgb, bgCov);
        // subtle inner rim (1.5px)
        const rim = (1 - smoothstep(0, 2.2, Math.abs(dBox + 1.6))) * bgCov * 0.20;
        over(buf, i, [150, 190, 225], rim);
      }

      // --- Orbital arcs (relay / multi-agent) ---
      const dx = px - C;
      const dy = py - C;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx); // -PI..PI
      const arcs = [
        { R: 342, w: 9, a0: -2.95, a1: -1.15, alpha: 0.30 },
        { R: 342, w: 9, a0: 0.20, a1: 2.05, alpha: 0.20 },
        { R: 402, w: 5, a0: -0.75, a1: 0.45, alpha: 0.13 },
      ];
      for (const arc of arcs) {
        const dRing = Math.abs(r - arc.R) - arc.w / 2;
        const ringCov = 1 - smoothstep(-0.6, 0.6, dRing * s);
        if (ringCov <= 0) continue;
        // angular window with soft ends (handle wrap by direct range check)
        let inWin = 0;
        if (ang >= arc.a0 && ang <= arc.a1) {
          const e = Math.min(ang - arc.a0, arc.a1 - ang);
          inWin = smoothstep(0, 0.16, e);
        }
        over(buf, i, [140, 190, 225], ringCov * inWin * arc.alpha);
      }

      // --- Glow behind the AI node ---
      const dNode = Math.hypot(px - BX, py - BY);
      const halo = 1 - smoothstep(20, 190, dNode);
      over(buf, i, TEAL, halo * halo * 0.34);

      // --- Baton body: capsule with teal→blue gradient along its axis ---
      const dCap = sdCapsule(px, py, AX, AY, BX, BY, batonR) * s;
      const capCov = 1 - smoothstep(-0.6, 0.6, dCap);
      if (capCov > 0) {
        const vx = BX - AX, vy = BY - AY;
        const t = clamp(((px - AX) * vx + (py - AY) * vy) / (vx * vx + vy * vy));
        let rgb = lerp3(TEAL, BLUE, t);
        // longitudinal highlight: brighter near the centre line
        const dCore = sdCapsule(px, py, AX, AY, BX, BY, batonR * 0.34) * s;
        const coreCov = 1 - smoothstep(-1.0, 1.0, dCore);
        rgb = lerp3(rgb, WHITE, coreCov * 0.32);
        over(buf, i, rgb, capCov);
      }

      // --- Metal end caps ---
      const tailD = Math.hypot(px - AX, py - AY);
      const tailCov = 1 - smoothstep(-0.6, 0.6, (tailD - 52) * s);
      over(buf, i, lerp3(TEAL, WHITE, 0.45), tailCov * 0.95);

      const tipD = Math.hypot(px - BX, py - BY);
      // AI node: bright core + ring
      const coreD = (Math.hypot(px - BX, py - BY) - 62) * s;
      const coreCov = 1 - smoothstep(-0.8, 0.8, coreD);
      over(buf, i, lerp3(TEAL, WHITE, 0.72), coreCov);
      const ringD = (Math.abs(Math.hypot(px - BX, py - BY) - 88) - 7) * s;
      const ringCov = 1 - smoothstep(-0.7, 0.7, ringD);
      over(buf, i, [120, 235, 220], ringCov * 0.45);
    }
  }

  // Clamp to bytes
  const out = Buffer.alloc(size * size * 4);
  for (let k = 0; k < buf.length; k++) {
    out[k] = Math.round(clamp(buf[k], 0, 255));
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG encoder (RGBA8, filter None)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const off = y * (size * 4 + 1);
    raw[off] = 0; // filter: None
    rgba.copy(raw, off + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// ICO encoder (classic 32-bit BMP/DIB entries, bottom-up BGRA + AND mask)
// ---------------------------------------------------------------------------
function encodeIco(images) {
  const entries = [];
  const blobs = [];
  let offset = 6 + images.length * 16;
  for (const { size, rgba } of images) {
    const rowBytes = size * 4; // 32bpp, already 4-byte aligned
    const maskRowBytes = Math.ceil(size / 32) * 4;
    const xorSize = rowBytes * size; // 32bpp: rowBytes == size*4
    const dib = Buffer.alloc(40 + xorSize + maskRowBytes * size);
    dib.writeUInt32LE(40, 0);
    dib.writeInt32LE(size, 4);
    dib.writeInt32LE(size * 2, 8); // XOR + AND
    dib.writeUInt16LE(1, 12);
    dib.writeUInt16LE(32, 14);
    dib.writeUInt32LE(0, 16); // BI_RGB
    dib.writeUInt32LE(xorSize + maskRowBytes * size, 20);
    let p = 40;
    for (let y = size - 1; y >= 0; y--) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        dib[p++] = rgba[i + 2]; // B
        dib[p++] = rgba[i + 1]; // G
        dib[p++] = rgba[i]; // R
        dib[p++] = rgba[i + 3]; // A
      }
    }
    // AND mask left as zeros (alpha channel carries transparency)
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; // colors
    e[3] = 0;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(dib.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    blobs.push(dib);
    offset += dib.length;
  }
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(images.length, 4);
  return Buffer.concat([head, ...entries, ...blobs]);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const cache = new Map();
const get = (n) => {
  if (!cache.has(n)) cache.set(n, render(n));
  return cache.get(n);
};
const png = (n) => encodePng(get(n), n);

const targets = [
  ['src-tauri/icons/icon.png', 1024],
  ['src-tauri/icons/32x32.png', 32],
  ['public/pwa/icon-180.png', 180],
  ['public/pwa/icon-192.png', 192],
  ['public/pwa/icon-512.png', 512],
  ['src/renderer/assets/logos/brand/app.png', 1024],
];
for (const [rel, size] of targets) {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, png(size));
  console.log(`[icons] ${rel} (${size}x${size})`);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(
  join(ROOT, 'src-tauri/icons/icon.ico'),
  encodeIco(icoSizes.map((n) => ({ size: n, rgba: get(n) })))
);
console.log(`[icons] src-tauri/icons/icon.ico (${icoSizes.join('/')})`);
