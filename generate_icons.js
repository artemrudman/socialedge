// Generates icon16.png, icon48.png, icon128.png for SocialEdge
// No npm dependencies — uses Node.js built-in zlib only

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size) {
  const w = size, h = size;
  const pixels = Buffer.alloc(w * h * 4, 0);

  // Helper: set RGBA pixel
  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const i = (y * w + x) * 4;
    // Alpha blend over existing
    const sa = a / 255, da = pixels[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    pixels[i]     = Math.round((r * sa + pixels[i]     * da * (1 - sa)) / oa);
    pixels[i + 1] = Math.round((g * sa + pixels[i + 1] * da * (1 - sa)) / oa);
    pixels[i + 2] = Math.round((b * sa + pixels[i + 2] * da * (1 - sa)) / oa);
    pixels[i + 3] = Math.round(oa * 255);
  }

  // Anti-aliased circle
  function circle(cx, cy, r, R, G, B, A) {
    const ir = Math.floor(r), or = Math.ceil(r + 1);
    for (let y = cy - or; y <= cy + or; y++) {
      for (let x = cx - or; x <= cx + or; x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const alpha = Math.max(0, Math.min(1, r - d + 0.5));
        if (alpha > 0) setPixel(x, y, R, G, B, Math.round(A * alpha));
      }
    }
  }

  // Anti-aliased thick line
  function line(x0, y0, x1, y1, thick, R, G, B, A) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(len * 2);
    for (let s = 0; s <= steps; s++) {
      const t  = s / steps;
      const cx = x0 + dx * t, cy = y0 + dy * t;
      circle(cx, cy, thick / 2, R, G, B, A);
    }
  }

  // Rounded rect background
  const radius = size * 0.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Corner rounding
      const dx = Math.max(0, Math.max(radius - x, x - (w - 1 - radius)));
      const dy = Math.max(0, Math.max(radius - y, y - (h - 1 - radius)));
      const d  = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, Math.min(1, radius - d + 0.5));
      if (alpha > 0) setPixel(x, y, 12, 20, 37, Math.round(255 * alpha)); // #0C1425
    }
  }

  // Three dot positions (ascending left to right)
  const p = size / 128;
  const dots = [
    { x: 22 * p, y: 96 * p, a: 0.45 },
    { x: 64 * p, y: 52 * p, a: 0.72 },
    { x: 106 * p, y: 18 * p, a: 1.0  },
  ];

  const dotR   = Math.max(1.5, 9 * p);
  const lineW  = Math.max(1,   6 * p);
  const G = 0x34, Gr = 0xD3, Gb = 0x99; // #34D399

  // Lines between dots
  line(dots[0].x, dots[0].y, dots[1].x, dots[1].y, lineW, G, Gr, Gb, Math.round(255 * 0.55));
  line(dots[1].x, dots[1].y, dots[2].x, dots[2].y, lineW, G, Gr, Gb, Math.round(255 * 0.85));

  // Dots
  dots.forEach(({ x, y, a }) => circle(x, y, dotR, G, Gr, Gb, Math.round(255 * a)));

  // Build PNG binary
  function u32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v); return b;
  }
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const byte of buf) {
      c ^= byte;
      for (let i = 0; i < 8; i++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const typeB = Buffer.from(type, 'ascii');
    const body  = Buffer.concat([typeB, data]);
    return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
  }

  // IHDR
  const ihdr = Buffer.concat([u32(w), u32(h),
    Buffer.from([8, 6, 0, 0, 0])]); // 8-bit RGBA

  // Raw image data with filter byte 0 per row
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: None
    pixels.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, 'extension', 'icons');
[16, 48, 128].forEach((size) => {
  const png  = createPNG(size);
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`✓ ${file} (${png.length} bytes)`);
});
