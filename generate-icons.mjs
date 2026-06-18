// generate-icons.mjs — build tool. Generates the PWA PNG icons from scratch
// (raw RGBA -> PNG via Node's built-in zlib, no image dependencies).
//
//   node generate-icons.mjs
//
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'icons');
mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// A full-bleed Connect Four motif: blue board, 2x2 of red/yellow discs.
function makeIcon(size) {
  const W = size, H = size;
  const BG = [0x17, 0x69, 0xd4, 255];
  const RED = [0xe8, 0x46, 0x3f, 255];
  const YEL = [0xff, 0xce, 0x3a, 255];

  const m = size * 0.17;           // outer margin
  const gap = size * 0.07;
  const cell = (size - 2 * m - gap) / 2;
  const r = cell * 0.46;
  const c0 = m + cell / 2, c1 = m + cell + gap + cell / 2;
  const discs = [
    { cx: c0, cy: c0, col: RED }, { cx: c1, cy: c0, col: YEL },
    { cx: c0, cy: c1, col: YEL }, { cx: c1, cy: c1, col: RED },
  ];

  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    let off = y * (1 + W * 4);
    raw[off++] = 0; // filter byte (none)
    for (let x = 0; x < W; x++) {
      let px = BG;
      for (const d of discs) {
        const dx = x + 0.5 - d.cx, dy = y + 0.5 - d.cy;
        if (dx * dx + dy * dy <= r * r) { px = d.col; break; }
      }
      raw[off++] = px[0]; raw[off++] = px[1]; raw[off++] = px[2]; raw[off++] = px[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, makeIcon(size));
  console.log(`wrote ${file}`);
}
