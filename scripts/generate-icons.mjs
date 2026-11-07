#!/usr/bin/env node
/**
 * Aibaton icon v2 — derived from the user's reference art
 * ("AI 多 CLI 集成应用图标设计.png", 1536x1536).
 *
 * Reference analysis (sampled programmatically):
 *  - Dominant background: deep navy / blue  (rgb ~ 32,32,64 -> 32,48,96)
 *  - A large cyan/white ">" and "/" shaped CLI chevron pair in the upper half
 *  - A bright diagonal baton line running top-left -> bottom-right
 *  - A rounded terminal/panel frame with a subtle grid
 *  - Small warm (orange) and cyan accent dots near the bottom
 *
 * We rebuild that composition analytically with SDF shapes at every size:
 * rounded navy tile, two CLI chevrons, a terminal card with header dots,
 * a glowing diagonal baton, orbital arcs and accent nodes.
 *
 * Zero dependencies: Node zlib writes PNG + classic BMP ICO.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const lerp3 = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

const sdBox = (px, py, cx, cy, hx, hy, r) => {
  const dx = Math.abs(px - cx) - (hx - r), dy = Math.abs(py - cy) - (hy - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdCapsule = (px, py, ax, ay, bx, by, r) => {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy));
  return Math.hypot(wx - t * vx, wy - t * vy) - r;
};
/** distance to a V/chevron ">" made of two capsules */
const sdChevron = (px, py, cx, cy, halfH, thick, dir = 1) => {
  const x1 = cx - dir * halfH * 0.62, x2 = cx + dir * halfH * 0.62;
  return Math.min(
    sdCapsule(px, py, x1, cy - halfH, x2, cy, thick),
    sdCapsule(px, py, x2, cy, x1, cy + halfH, thick)
  );
};

// Palette from the reference
const BG_A = [22, 34, 66];      // deep navy
const BG_B = [30, 54, 104];     // lighter blue
const CYAN = [86, 226, 232];    // CLI chevron cyan
const TEAL = [58, 220, 200];
const BLUE = [96, 156, 255];
const WHITE = [236, 248, 255];
const WARM = [255, 168, 92];    // bottom accent

function over(dst, i, rgb, alpha) {
  const a = clamp(alpha);
  if (a <= 0) return;
  dst[i] = mix(dst[i], rgb[0], a);
  dst[i + 1] = mix(dst[i + 1], rgb[1], a);
  dst[i + 2] = mix(dst[i + 2], rgb[2], a);
  dst[i + 3] = mix(dst[i + 3], 255, a);
}

function render(size) {
  const s = size / 1024;
  const buf = new Float32Array(size * size * 4);
  const C = 512, pad = 60, half = (1024 - 2 * pad) / 2, radius = 210;
  // terminal card
  const card = { cx: 512, cy: 540, hx: 300, hy: 232, r: 46 };
  // baton (diagonal, top-left -> bottom-right) matching reference
  const AX = 250, AY = 250, BX = 790, BY = 790;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / s, py = y / s, i = (y * size + x) * 4;

      // --- Tile ---
      const dBox = sdBox(px, py, C, C, half, half, radius) * s;
      const cov = 1 - smoothstep(-0.5, 0.5, dBox);
      if (cov > 0) {
        const t = clamp(px / 1024 * 0.5 + py / 1024 * 0.5);
        let rgb = lerp3(BG_A, BG_B, t);
        // radial glow behind upper chevrons
        const g = 1 - smoothstep(0, 520, Math.hypot(px - 470, py - 400));
        rgb = lerp3(rgb, [36, 74, 132], g * 0.5);
        over(buf, i, rgb, cov);
        over(buf, i, [130, 180, 230], (1 - smoothstep(0, 2, Math.abs(dBox + 1.5))) * cov * 0.22);
      }

      // --- Faint orbital arcs (multi-CLI / coordination) ---
      const dx = px - C, dy = py - C, r = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      for (const arc of [
        { R: 372, w: 7, a0: -2.9, a1: -1.5, a: 0.22 },
        { R: 372, w: 7, a0: 0.3, a1: 1.7, a: 0.16 },
        { R: 420, w: 4, a0: -0.6, a1: 0.4, a: 0.12 },
      ]) {
        const rc = 1 - smoothstep(-0.6, 0.6, (Math.abs(r - arc.R) - arc.w / 2) * s);
        if (rc <= 0) continue;
        let w = 0;
        if (ang >= arc.a0 && ang <= arc.a1) w = smoothstep(0, 0.18, Math.min(ang - arc.a0, arc.a1 - ang));
        over(buf, i, [140, 195, 235], rc * w * arc.a);
      }

      // --- Terminal card ---
      const dCard = sdBox(px, py, card.cx, card.cy, card.hx, card.hy, card.r) * s;
      const cardCov = 1 - smoothstep(-0.6, 0.6, dCard);
      if (cardCov > 0) {
        over(buf, i, [16, 30, 58], cardCov * 0.88);
        // card border
        const border = 1 - smoothstep(0, 2.4 * s, Math.abs(dCard + 3 * s));
        over(buf, i, [92, 150, 220], border * 0.55);
        // title bar
        const dBar = sdBox(px, py, card.cx, card.cy - card.hy + 40, card.hx - 6, 40, 18) * s;
        over(buf, i, [30, 54, 96], (1 - smoothstep(-0.6, 0.6, dBar)) * 0.9);
        // 3 header dots
        for (let k = 0; k < 3; k++) {
          const d = (Math.hypot(px - (card.cx - card.hx + 52 + k * 38), py - (card.cy - card.hy + 40)) - 9) * s;
          over(buf, i, k === 0 ? WARM : k === 1 ? CYAN : [110, 160, 230], (1 - smoothstep(-0.8, 0.8, d)) * 0.85);
        }
      }

      // --- CLI chevrons "> /" inside the card (reference's main motif) ---
      const chevY = card.cy + 20;
      const dGt = sdChevron(px, py, 400, chevY, 96, 15, 1) * s;
      over(buf, i, CYAN, (1 - smoothstep(-0.8, 0.8, dGt)) * cardCov * 0.95);
      // a "/" slash (rotated line) to the right
      const dSlash = sdCapsule(px, py, 560, chevY + 88, 640, chevY - 88, 15) * s;
      over(buf, i, lerp3(CYAN, WHITE, 0.35), (1 - smoothstep(-0.8, 0.8, dSlash)) * cardCov * 0.9);
      // blinking cursor block
      const dCursor = sdBox(px, py, 690, chevY + 60, 34, 15, 4) * s;
      over(buf, i, WHITE, (1 - smoothstep(-0.8, 0.8, dCursor)) * cardCov * 0.8);

      // --- Diagonal baton (bright, crossing the whole tile) ---
      const glowD = sdCapsule(px, py, AX, AY, BX, BY, 78) * s;
      const halo = 1 - smoothstep(0, 1, glowD / 90);
      over(buf, i, TEAL, halo * halo * 0.16);
      const dCap = sdCapsule(px, py, AX, AY, BX, BY, 26) * s;
      const capCov = 1 - smoothstep(-0.8, 0.8, dCap);
      if (capCov > 0) {
        const vx = BX - AX, vy = BY - AY;
        const t = clamp(((px - AX) * vx + (py - AY) * vy) / (vx * vx + vy * vy));
        let rgb = lerp3(CYAN, BLUE, t);
        const core = 1 - smoothstep(-1, 1, sdCapsule(px, py, AX, AY, BX, BY, 9) * s);
        rgb = lerp3(rgb, WHITE, core * 0.55);
        over(buf, i, rgb, capCov);
      }
      // endpoints: AI node at top-left, warm accent at bottom-right
      const dHead = (Math.hypot(px - AX, py - AY) - 46) * s;
      over(buf, i, lerp3(CYAN, WHITE, 0.7), 1 - smoothstep(-0.8, 0.8, dHead));
      const ringD = (Math.abs(Math.hypot(px - AX, py - AY) - 68) - 6) * s;
      over(buf, i, CYAN, (1 - smoothstep(-0.7, 0.7, ringD)) * 0.5);
      const dTail = (Math.hypot(px - BX, py - BY) - 34) * s;
      over(buf, i, WARM, 1 - smoothstep(-0.8, 0.8, dTail));
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let k = 0; k < buf.length; k++) out[k] = Math.round(clamp(buf[k], 0, 255));
  return out;
}

// ---- PNG ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
const png = (rgba, n) => {
  const h = Buffer.alloc(13); h.writeUInt32BE(n, 0); h.writeUInt32BE(n, 4); h[8] = 8; h[9] = 6;
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) { const o = y * (n * 4 + 1); raw[o] = 0; rgba.copy(raw, o + 1, y * n * 4, (y + 1) * n * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};
// ---- ICO ----
const ico = (imgs) => {
  const es = [], bs = []; let off = 6 + imgs.length * 16;
  for (const { n, rgba } of imgs) {
    const maskRow = Math.ceil(n / 32) * 4;
    const dib = Buffer.alloc(40 + n * n * 4 + maskRow * n);
    dib.writeUInt32LE(40, 0); dib.writeInt32LE(n, 4); dib.writeInt32LE(n * 2, 8);
    dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14); dib.writeUInt32LE(0, 16);
    dib.writeUInt32LE(n * n * 4 + maskRow * n, 20);
    let p = 40;
    for (let y = n - 1; y >= 0; y--) for (let x = 0; x < n; x++) { const i = (y * n + x) * 4; dib[p++] = rgba[i + 2]; dib[p++] = rgba[i + 1]; dib[p++] = rgba[i]; dib[p++] = rgba[i + 3]; }
    const e = Buffer.alloc(16); e[0] = n >= 256 ? 0 : n; e[1] = n >= 256 ? 0 : n;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(dib.length, 8); e.writeUInt32LE(off, 12);
    es.push(e); bs.push(dib); off += dib.length;
  }
  const h = Buffer.alloc(6); h.writeUInt16LE(1, 2); h.writeUInt16LE(imgs.length, 4);
  return Buffer.concat([h, ...es, ...bs]);
};

const cache = new Map(); const get = (n) => { if (!cache.has(n)) cache.set(n, render(n)); return cache.get(n); };
const targets = [
  ['src-tauri/icons/icon.png', 1024], ['src-tauri/icons/32x32.png', 32],
  ['public/pwa/icon-180.png', 180], ['public/pwa/icon-192.png', 192], ['public/pwa/icon-512.png', 512],
  ['src/renderer/assets/logos/brand/app.png', 1024],
];
for (const [rel, n] of targets) { const abs = join(ROOT, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, png(get(n), n)); console.log('[icons]', rel, `${n}x${n}`); }
const sizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(join(ROOT, 'src-tauri/icons/icon.ico'), ico(sizes.map((n) => ({ n, rgba: get(n) }))));
console.log('[icons] src-tauri/icons/icon.ico', sizes.join('/'));
