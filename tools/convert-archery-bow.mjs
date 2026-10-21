// tools/convert-archery-bow.mjs - builds archery/models/bow.bin (GENERATED; never hand-edit) from
// reference/archery/bow-arm-meshy.glb: the bow and the arm holding it, ONE model, which Matt made with
// ChatGPT (picture) and Meshy's image-to-3D (Meshy 6 Lite, 2026-10-21, CC BY 4.0, creator Matt). A
// hand modelled round the bow's own grip, instead of a separate arm squeezed onto it (Matt: "create
// them as a single 3d object rather than mush them together"). The source has positions only.
//
//   node tools/convert-archery-bow.mjs [--mirror]
//
// What it does:
//   1. Moves the model so the middle of the grip (inside the hand) is the origin. Axes stay the
//      source's: +x toward the target (the bow's limbs curve that way), +y up, +z across. --mirror
//      flips z (left hand <-> right hand).
//   2. Marks each vertex: 0 skin, 1 sleeve, 2 bow (blue), 3 grip (black), 4 tips (dark grey).
//   3. Writes it compact: 'BOW2', u32 vertex count, u32 triangle count, f32 step, f32 top tip x, y, z,
//      f32 bottom tip x, y, z, then int16 x/y/z per vertex (value * step), u8 part per vertex (padded
//      to 2 bytes), u16 indices. bow3d.js computes normals.
// The shape is never changed (Matt, 2026-10-21: "The 3d model is correct... Just don't change it"):
// no bending, no stretching. bow3d.js only places and turns it.
// The numbers below were measured off this one source; a new source needs them measured again.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'reference/archery/bow-arm-meshy.glb');
const OUT = path.join(ROOT, 'archery/models/bow.bin');
const MIRROR = process.argv.includes('--mirror');

// Source coordinates. The grip: x 0.39..0.51, z -0.02..0.10 across, inside the hand (y -0.11..0.16).
const GRIP = [0.445, 0.02, 0.04];
const GRIP_RX = 0.062, GRIP_RZ = 0.058;           // the grip's cross-section (an ellipse)
const HAND_Y = [-0.115, 0.165];                   // where the hand covers the grip
const BLACK_Y = [-0.14, 0.19];                    // the black grip, a little past the hand each way
const TIP_Y = 0.865;                              // past this (either way) the limb tips are dark
const BOW_X = 0.2;                                // the bow never comes nearer the arm than this
const CUFF_X = 0.065, CUFF_BAND = 0.025, CUFF_R = 0.092;   // the sleeve's end; past the band, wider = sleeve

const buf = readFileSync(SRC);
const jl = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jl));
const bin = 20 + jl + 8;
const view = (i, T, n) => {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView];
  return new T(buf.buffer.slice(buf.byteOffset + bin + (v.byteOffset || 0) + (a.byteOffset || 0)), 0, a.count * n);
};
const prim = json.meshes[0].primitives[0];
const P = view(prim.attributes.POSITION, Float32Array, 3);
const I = view(prim.indices, json.accessors[prim.indices].componentType === 5125 ? Uint32Array : Uint16Array, 1);
const V = P.length / 3, T = I.length / 3;
if (V > 65535) throw new Error('too many vertices for u16 indices');

const isBow = (x, y, z) => {
  if (x < BOW_X) return false;
  if (y < HAND_Y[0] || y > HAND_Y[1]) return true;
  return ((x - GRIP[0]) / GRIP_RX) ** 2 + ((z - GRIP[2]) / GRIP_RZ) ** 2 <= 1.1;
};
const ARM_X = 0.29;                               // the hand ends here; nearer the shoulder is forearm and sleeve
// The arm's middle along x (for the cuff test), from the vertices that are not bow.
const NS = 40, armMid = Array.from({ length: NS }, () => ({ n: 0, y: 0, z: 0 }));
const slot = (x) => Math.min(NS - 1, Math.max(0, Math.floor(((x + 0.6) / 1.2) * NS)));
for (let i = 0; i < V; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  if (isBow(x, y, z) || x > ARM_X) continue;
  const s = armMid[slot(x)]; s.n++; s.y += y; s.z += z;
}
for (const s of armMid) if (s.n) { s.y /= s.n; s.z /= s.n; }

const part = new Uint8Array(V);
const count = [0, 0, 0, 0, 0];
for (let i = 0; i < V; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  let k;
  if (isBow(x, y, z)) k = Math.abs(y) > TIP_Y ? 4 : y >= BLACK_Y[0] && y <= BLACK_Y[1] ? 3 : 2;
  else {
    const s = armMid[slot(x)];
    const r = Math.hypot(y - s.y, z - s.z);
    k = x < CUFF_X - CUFF_BAND ? 1 : x < CUFF_X + CUFF_BAND && r > CUFF_R ? 1 : 0;
  }
  part[i] = k; count[k]++;
}

const H = new Float32Array(V * 3);
const zs = MIRROR ? -1 : 1;
for (let i = 0; i < V; i++) {
  H[i * 3] = P[i * 3] - GRIP[0];
  H[i * 3 + 1] = P[i * 3 + 1] - GRIP[1];
  H[i * 3 + 2] = (P[i * 3 + 2] - GRIP[2]) * zs;
}
// The two limb tips (for the string), in the same frame.
let top = 0, bot = 0;
for (let i = 0; i < V; i++) { if (H[i * 3 + 1] > H[top * 3 + 1]) top = i; if (H[i * 3 + 1] < H[bot * 3 + 1]) bot = i; }
const tip = (i) => [H[i * 3], H[i * 3 + 1], H[i * 3 + 2]];

let ext = 0;
for (let i = 0; i < V * 3; i++) ext = Math.max(ext, Math.abs(H[i]));
const step = ext / 32767;
const head = 16 + 6 * 4, pad2 = V % 2;
const out = Buffer.alloc(head + V * 6 + V + pad2 + T * 6);
out.write('BOW2', 0, 'ascii'); out.writeUInt32LE(V, 4); out.writeUInt32LE(T, 8); out.writeFloatLE(step, 12);
[...tip(top), ...tip(bot)].forEach((v, j) => out.writeFloatLE(v, 16 + j * 4));
let o = head;
for (let i = 0; i < V * 3; i++, o += 2) out.writeInt16LE(Math.round(H[i] / step), o);
for (let i = 0; i < V; i++, o++) out.writeUInt8(part[i], o);
o += pad2;
for (let t = 0; t < T; t++) {
  // A mirror turns the triangles inside out; swap two corners to keep them facing out.
  const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
  out.writeUInt16LE(a, o); out.writeUInt16LE(MIRROR ? c : b, o + 2); out.writeUInt16LE(MIRROR ? b : c, o + 4); o += 6;
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`ok   ${path.relative(ROOT, OUT)}: ${V} vertices (skin ${count[0]}, sleeve ${count[1]}, bow ${count[2]}, grip ${count[3]}, tips ${count[4]}), ${T} triangles, ${out.length} bytes${MIRROR ? ', mirrored' : ''}`);
console.log(`     tips ${tip(top).map((v) => v.toFixed(3))} / ${tip(bot).map((v) => v.toFixed(3))}`);
