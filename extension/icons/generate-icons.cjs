/**
 * WebPeel Extension — generate-icons.js
 * Generates icon-16.png, icon-32.png, icon-48.png, icon-128.png
 * Using only Node.js built-ins (zlib for PNG compression).
 * Run: node generate-icons.js
 */

'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

/* ── Colours (as [R, G, B, A]) ────────────────────── */
const TRANSPARENT = [0,   0,   0,   0  ];
const BLURPLE     = [88,  101, 242, 255]; // #5865F2
const BLURPLE_DK  = [71,  82,  196, 255]; // #4752C4 (shadow)
const WHITE       = [255, 255, 255, 255];
const WHITE_50    = [255, 255, 255, 128]; // translucent white for page backing

/* ── Draw a filled rounded-rect into pixel buffer ─── */
function fillRoundRect(pixels, w, x0, y0, rw, rh, r, color) {
  for (let py = y0; py < y0 + rh; py++) {
    for (let px = x0; px < x0 + rw; px++) {
      const dx = Math.max(x0 + r - px, 0, px - (x0 + rw - r - 1));
      const dy = Math.max(y0 + r - py, 0, py - (y0 + rh - r - 1));
      if (dx * dx + dy * dy <= r * r) {
        setPixel(pixels, w, px, py, color);
      }
    }
  }
}

/* ── Draw a filled rect ─────────────────────────────── */
function fillRect(pixels, w, x0, y0, rw, rh, color) {
  for (let py = y0; py < y0 + rh; py++) {
    for (let px = x0; px < x0 + rw; px++) {
      setPixel(pixels, w, px, py, color);
    }
  }
}

function setPixel(pixels, w, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  // Alpha blend over existing
  const srcA = a / 255;
  const dstA = pixels[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  pixels[i]     = Math.round((r * srcA + pixels[i]     * dstA * (1 - srcA)) / outA);
  pixels[i + 1] = Math.round((g * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA);
  pixels[i + 2] = Math.round((b * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA);
  pixels[i + 3] = Math.round(outA * 255);
}

/* ── Render WebPeel icon at given size ────────────── */
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4); // RGBA, starts transparent

  const s = size;  // shorthand
  const p = Math.round(s * 0.1);   // padding

  // Background rounded square
  const bgR = Math.round(s * 0.19); // corner radius
  fillRoundRect(pixels, s, 0, 0, s, s, bgR, BLURPLE);

  // Document shadow/backing (slightly offset white rect)
  const docX  = Math.round(s * 0.28);
  const docY  = Math.round(s * 0.22);
  const docW  = Math.round(s * 0.50);
  const docH  = Math.round(s * 0.60);
  const docR  = Math.round(s * 0.06);
  // Shadow (shifted slightly)
  fillRoundRect(pixels, s, docX + 2, docY + 2, docW, docH, docR, BLURPLE_DK);
  // Main page
  fillRoundRect(pixels, s, docX, docY, docW, docH, docR, WHITE);

  // Lines on the document (text lines)
  const lineX  = docX + Math.round(docW * 0.18);
  const lineW  = Math.round(docW * 0.64);
  const lineH  = Math.max(1, Math.round(s * 0.05));
  const gap    = Math.round(s * 0.10);
  const startY = docY + Math.round(docH * 0.32);

  for (let i = 0; i < 3; i++) {
    const lw = i === 1 ? Math.round(lineW * 0.75) : lineW; // middle line shorter
    fillRect(pixels, s, lineX, startY + i * gap, lw, lineH, BLURPLE);
  }

  // Corner fold on document (triangle effect via darkened corner)
  const foldSize = Math.round(docW * 0.22);
  const foldX = docX + docW - foldSize;
  const foldY = docY;
  for (let fy = 0; fy < foldSize; fy++) {
    for (let fx = 0; fx < foldSize - fy; fx++) {
      setPixel(pixels, s, foldX + fx, foldY + fy, BLURPLE);
    }
  }

  return pixels;
}

/* ── PNG encoding ─────────────────────────────────── */
function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })());
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function uint32BE(n) {
  return Buffer.from([(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = uint32BE(data.length);
  const crcData   = Buffer.concat([typeBytes, data]);
  const crcBuf    = uint32BE(crc32(crcData));
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function encodePNG(pixels, size) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // colour type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Raw image data: prepend filter byte 0 (None) to each scanline
  const rawLines = [];
  for (let y = 0; y < size; y++) {
    rawLines.push(0); // filter type None
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      rawLines.push(pixels[idx], pixels[idx+1], pixels[idx+2], pixels[idx+3]);
    }
  }
  const rawBuf = Buffer.from(rawLines);
  const compressed = zlib.deflateSync(rawBuf, { level: 6 });

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Generate all sizes ─────────────────────────────── */
const SIZES = [16, 32, 48, 128];
const outDir = __dirname;

for (const size of SIZES) {
  const pixels = renderIcon(size);
  const png    = encodePNG(pixels, size);
  const outPath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓ icon-${size}.png (${png.length} bytes)`);
}

console.log('\nAll icons generated!');
