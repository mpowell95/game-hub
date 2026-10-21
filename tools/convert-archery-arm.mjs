// tools/convert-archery-arm.mjs - builds archery/models/arm.bin (GENERATED; never hand-edit) from
// reference/archery/arm-meshy.glb, the arm, sleeve and fist Matt made with Meshy's image-to-3D
// (Meshy 6 Lite, 2026-10-21; Meshy's free tier licenses it CC BY 4.0, creator Matt). The source
// has positions only: no normals, no colours, no materials.
//
//   node tools/convert-archery-arm.mjs [--mirror] [--profile]
//
// What it does:
//   1. Moves the model into the HAND FRAME bow3d.js places on the bow's grip: the origin is the
//      middle of the gap in the fist (where the grip goes), +y up the gap (the grip's long axis),
//      +z from the fist back along the forearm toward the shoulder (level, perpendicular to the
//      grip), +x = y cross z. --mirror flips x (a right arm into a left one).
//   2. Marks every vertex sleeve (1) or skin (0): past the cuff along the arm is sleeve; near the
//      cuff, whatever stands out further than the forearm is the sleeve's rim.
//   3. Writes it compact: 'ARM1', u32 vertex count, u32 triangle count, f32 step, then int16 x/y/z
//      per vertex (position = value * step, model units), u8 part per vertex (padded to 2 bytes),
//      u16 indices. bow3d.js computes normals.
// The numbers below were measured off this one source (the fist's gap, the cuff); a new source
// needs them measured again (--profile prints the slices).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'reference/archery/arm-meshy.glb');
const OUT = path.join(ROOT, 'archery/models/arm.bin');
const MIRROR = process.argv.includes('--mirror');
const PROFILE = process.argv.includes('--profile');

// Measured in the source's own coordinates: the gap through the fist runs along +y at x 0.675 to
// 0.735, y -0.24 to 0.06; the fist is 0.14 to 0.46 deep in z there.
const GAP = [0.703, -0.09, 0.31];
// Two slices of the forearm (source x) whose middles give the arm's direction.
const FOREARM = [[0.0, 0.05], [0.28, 0.33]];
// The cuff, in hand-frame z (along the arm from the gap), and the rim test near it.
const CUFF_Z = 0.56, CUFF_BAND = 0.04, RIM = 1.2;

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

const mid = ([x0, x1]) => {
  let n = 0; const c = [0, 0, 0];
  for (let i = 0; i < V; i++) if (P[i * 3] >= x0 && P[i * 3] < x1) { n++; for (let k = 0; k < 3; k++) c[k] += P[i * 3 + k]; }
  return c.map((v) => v / n);
};
const [c0, c1] = FOREARM.map(mid);
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const Y = [0, 1, 0];
const Z = norm([c0[0] - c1[0], 0, c0[2] - c1[2]]);             // toward the shoulder, level
let X = [Y[1] * Z[2] - Y[2] * Z[1], Y[2] * Z[0] - Y[0] * Z[2], Y[0] * Z[1] - Y[1] * Z[0]];
if (MIRROR) X = X.map((v) => -v);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const H = new Float32Array(V * 3);
for (let i = 0; i < V; i++) {
  const d = [P[i * 3] - GAP[0], P[i * 3 + 1] - GAP[1], P[i * 3 + 2] - GAP[2]];
  H[i * 3] = dot(d, X); H[i * 3 + 1] = dot(d, Y); H[i * 3 + 2] = dot(d, Z);
}

// Slices along z: the arm's middle and its widest reach in each.
const zs = Array.from({ length: V }, (_, i) => H[i * 3 + 2]);
const zMin = Math.min(...zs), zMax = Math.max(...zs), NS = 60;
const slices = Array.from({ length: NS }, () => ({ n: 0, x: 0, y: 0, r: 0 }));
const sliceOf = (z) => Math.min(NS - 1, Math.max(0, Math.floor(((z - zMin) / (zMax - zMin)) * NS)));
for (let i = 0; i < V; i++) { const s = slices[sliceOf(H[i * 3 + 2])]; s.n++; s.x += H[i * 3]; s.y += H[i * 3 + 1]; }
for (const s of slices) if (s.n) { s.x /= s.n; s.y /= s.n; }
const radius = (i) => { const s = slices[sliceOf(H[i * 3 + 2])]; return Math.hypot(H[i * 3] - s.x, H[i * 3 + 1] - s.y); };
for (let i = 0; i < V; i++) { const s = slices[sliceOf(H[i * 3 + 2])]; s.r = Math.max(s.r, radius(i)); }
if (PROFILE) {
  slices.forEach((s, k) => console.log((zMin + ((k + 0.5) * (zMax - zMin)) / NS).toFixed(3), 'n', String(s.n).padStart(5), 'r', s.r.toFixed(3), 'mid', s.x.toFixed(3), s.y.toFixed(3)));
  process.exit(0);
}
// The forearm's reach just in front of the cuff.
const foreR = slices[sliceOf(CUFF_Z - CUFF_BAND * 2)].r;
const part = new Uint8Array(V);
let sleeve = 0;
for (let i = 0; i < V; i++) {
  const z = H[i * 3 + 2];
  part[i] = z > CUFF_Z + CUFF_BAND ? 1 : z > CUFF_Z - CUFF_BAND && radius(i) > foreR * RIM ? 1 : 0;
  sleeve += part[i];
}

let ext = 0;
for (let i = 0; i < V * 3; i++) ext = Math.max(ext, Math.abs(H[i]));
const step = ext / 32767;
const pad2 = (V % 2);
const out = Buffer.alloc(16 + V * 6 + V + pad2 + T * 6);
out.write('ARM1', 0, 'ascii'); out.writeUInt32LE(V, 4); out.writeUInt32LE(T, 8); out.writeFloatLE(step, 12);
let o = 16;
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
console.log(`ok   ${path.relative(ROOT, OUT)}: ${V} vertices (${sleeve} sleeve), ${T} triangles, ${out.length} bytes, arm ${(zMax).toFixed(2)} long${MIRROR ? ', mirrored' : ''}`);
