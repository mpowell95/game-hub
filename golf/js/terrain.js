// golf/js/terrain.js - pure: hole JSON -> height grid + surface grid (rasterizer) + samplers.
// No DOM. Node-safe. See §6 of GOLF-HANDOFF.md.

export const S = { OB: 0, ROUGH: 1, FAIRWAY: 2, FRINGE: 3, GREEN: 4, SAND: 5, WATER: 6, TEE: 7 };

const CELL = 1.0;

// mulberry32, seeded RNG. Same seed -> same sequence everywhere.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(t) { return t * t * (3 - 2 * t); }

// Seeded value noise: lattice on a `wavelength`-metre grid, bilinear + smoothstep interpolated.
function makeValueNoise(seed, wavelength) {
  const gen = rng(seed);
  const cache = new Map();
  function latticeVal(ix, iz) {
    const key = ix + ',' + iz;
    let v = cache.get(key);
    if (v === undefined) {
      // deterministic per-cell value, independent of visit order
      const g = rng((seed ^ (ix * 374761393 + iz * 668265263)) >>> 0);
      v = g();
      cache.set(key, v);
    }
    return v;
  }
  // consume gen once so `seed` alone (not derived per-cell) still participates; keeps API stable
  gen();
  return function sample(x, z) {
    const gx = x / wavelength, gz = z / wavelength;
    const ix0 = Math.floor(gx), iz0 = Math.floor(gz);
    const fx = smoothstep(gx - ix0), fz = smoothstep(gz - iz0);
    const v00 = latticeVal(ix0, iz0);
    const v10 = latticeVal(ix0 + 1, iz0);
    const v01 = latticeVal(ix0, iz0 + 1);
    const v11 = latticeVal(ix0 + 1, iz0 + 1);
    const a = v00 + (v10 - v00) * fx;
    const b = v01 + (v11 - v01) * fx;
    return (a + (b - a) * fz) * 2 - 1; // -1..1
  };
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) { const ddx = px - ax, ddz = pz - az; return Math.sqrt(ddx * ddx + ddz * ddz); }
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cz = az + t * dz;
  const ddx = px - cx, ddz = pz - cz;
  return Math.sqrt(ddx * ddx + ddz * ddz);
}

function distToPolyline(px, pz, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (seg < d) d = seg;
  }
  return d;
}

function pointInPoly(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    const intersect = ((zi > pz) !== (zj > pz)) &&
      (px < (xj - xi) * (pz - zi) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function build(def) {
  // Bounds: axis-aligned box around all geometry, expanded 35m, rounded outward to whole metres.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  function grow(x, z) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const fw = def.fairway;
  const hw = (fw.width || 0) / 2;
  for (const [x, z] of fw.path) { grow(x - hw, z - hw); grow(x + hw, z + hw); }
  const gr = def.green;
  grow(gr.center[0] - gr.radius, gr.center[1] - gr.radius);
  grow(gr.center[0] + gr.radius, gr.center[1] + gr.radius);
  for (const b of def.bunkers || []) {
    grow(b.center[0] - b.radius, b.center[1] - b.radius);
    grow(b.center[0] + b.radius, b.center[1] + b.radius);
  }
  for (const w of def.water || []) {
    for (const [x, z] of w.poly) grow(x, z);
  }
  for (const h of def.hills || []) {
    const r = h.radius * 1.5;
    grow(h.at[0] - r, h.at[1] - r); grow(h.at[0] + r, h.at[1] + r);
  }
  grow(def.tee[0], def.tee[1]);
  grow(def.pin[0], def.pin[1]);

  minX -= 35; maxX += 35; minZ -= 35; maxZ += 35;
  const x0 = Math.floor(minX), z0 = Math.floor(minZ);
  const x1 = Math.ceil(maxX), z1 = Math.ceil(maxZ);
  const nx = x1 - x0 + 1, nz = z1 - z0 + 1;

  const height = new Float32Array(nx * nz);
  const surface = new Uint8Array(nx * nz);

  const noiseBase = makeValueNoise(def.seed, 24);
  const noiseDetail = makeValueNoise(def.seed + 1, 12);

  // 6.3 rasterization order (later wins)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = i + j * nx;
      const wx = x0 + i, wz = z0 + j;
      let s = S.ROUGH;

      // OB within 5m of bounds edge
      const dEdge = Math.min(wx - x0, x1 - wx, wz - z0, z1 - wz);
      if (dEdge < 5) s = S.OB;

      // fairway
      if (distToPolyline(wx, wz, fw.path) <= hw) s = S.FAIRWAY;

      // water
      for (const w of def.water || []) {
        if (pointInPoly(wx, wz, w.poly)) s = S.WATER;
      }

      // green / fringe
      const dGreen = Math.hypot(wx - gr.center[0], wz - gr.center[1]);
      const fringeR = gr.radius + (def.fringe || 0);
      if (dGreen <= fringeR) s = S.FRINGE;
      if (dGreen <= gr.radius) s = S.GREEN;

      // bunkers
      for (const b of def.bunkers || []) {
        if (Math.hypot(wx - b.center[0], wz - b.center[1]) <= b.radius) s = S.SAND;
      }

      // tee box: 6x6 square centered on tee
      if (Math.abs(wx - def.tee[0]) <= 3 && Math.abs(wz - def.tee[1]) <= 3) s = S.TEE;

      surface[idx] = s;
    }
  }

  // 6.4 heights: base noise, then hills, then flatten play surfaces
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = i + j * nx;
      const wx = x0 + i, wz = z0 + j;
      // two octaves: base wavelength 24 amp 0.6, second wavelength 12 amp 0.4
      let h = noiseBase(wx, wz) * 0.6 + noiseDetail(wx, wz) * 0.4;
      for (const hill of def.hills || []) {
        const dx = wx - hill.at[0], dz = wz - hill.at[1];
        const d2 = dx * dx + dz * dz;
        const sig = hill.radius / 2.2;
        h += hill.height * Math.exp(-(d2 / (2 * sig * sig)));
      }
      height[idx] = h;
    }
  }

  // fairway noise reduction pass needs the pre-flatten base separately; recompute with a
  // fairway-aware amplitude multiplier, then flatten green/fringe/tee/bunker/water.
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = i + j * nx;
      const wx = x0 + i, wz = z0 + j;
      const s = surface[idx];

      if (s === S.FAIRWAY) {
        let h = (noiseBase(wx, wz) * 0.6 + noiseDetail(wx, wz) * 0.4) * 0.35;
        for (const hill of def.hills || []) {
          const dx = wx - hill.at[0], dz = wz - hill.at[1];
          const d2 = dx * dx + dz * dz;
          const sig = hill.radius / 2.2;
          h += hill.height * Math.exp(-(d2 / (2 * sig * sig)));
        }
        height[idx] = h;
      }
    }
  }

  // green base height at center (pre-flatten sample, from the unmodified noise+hills field)
  function baseHeightAt(wx, wz) {
    let h = noiseBase(wx, wz) * 0.6 + noiseDetail(wx, wz) * 0.4;
    for (const hill of def.hills || []) {
      const dx = wx - hill.at[0], dz = wz - hill.at[1];
      const d2 = dx * dx + dz * dz;
      const sig = hill.radius / 2.2;
      h += hill.height * Math.exp(-(d2 / (2 * sig * sig)));
    }
    return h;
  }
  const greenBaseH = baseHeightAt(gr.center[0], gr.center[1]);
  const tilt = gr.tilt || [0, 0];
  const teeBaseH = baseHeightAt(def.tee[0], def.tee[1]);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = i + j * nx;
      const wx = x0 + i, wz = z0 + j;
      const s = surface[idx];

      if (s === S.GREEN || s === S.FRINGE) {
        const flat = greenBaseH + tilt[0] * (wx - gr.center[0]) + tilt[1] * (wz - gr.center[1]);
        const dGreen = Math.hypot(wx - gr.center[0], wz - gr.center[1]);
        let k;
        if (dGreen <= gr.radius) k = 1;
        else k = Math.max(0, 1 - (dGreen - gr.radius) / (def.fringe || 1));
        height[idx] = k * flat + (1 - k) * height[idx];
      }

      if (s === S.TEE) {
        height[idx] = teeBaseH;
      }

      if (s === S.SAND) {
        for (const b of def.bunkers || []) {
          const d = Math.hypot(wx - b.center[0], wz - b.center[1]);
          if (d <= b.radius) {
            height[idx] -= 0.5 * (1 - d / b.radius);
          }
        }
      }

      if (s === S.WATER) {
        height[idx] -= 1.2;
      }
    }
  }

  return { x0, z0, nx, nz, cell: CELL, height, surface, def };
}

export function heightAt(t, x, z) {
  const fx = x - t.x0, fz = z - t.z0;
  let ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  ix = Math.max(0, Math.min(t.nx - 2, ix));
  iz = Math.max(0, Math.min(t.nz - 2, iz));
  const cix = Math.max(0, Math.min(t.nx - 1, ix));
  const ciz = Math.max(0, Math.min(t.nz - 1, iz));
  const cix1 = Math.max(0, Math.min(t.nx - 1, ix + 1));
  const ciz1 = Math.max(0, Math.min(t.nz - 1, iz + 1));
  const h00 = t.height[cix + ciz * t.nx];
  const h10 = t.height[cix1 + ciz * t.nx];
  const h01 = t.height[cix + ciz1 * t.nx];
  const h11 = t.height[cix1 + ciz1 * t.nx];
  const cx = Math.max(0, Math.min(1, tx)), cz = Math.max(0, Math.min(1, tz));
  const a = h00 + (h10 - h00) * cx;
  const b = h01 + (h11 - h01) * cx;
  return a + (b - a) * cz;
}

export function normalAt(t, x, z) {
  const e = 0.5;
  const hL = heightAt(t, x - e, z), hR = heightAt(t, x + e, z);
  const hD = heightAt(t, x, z - e), hU = heightAt(t, x, z + e);
  const nx = -(hR - hL) / (2 * e);
  const nz = -(hU - hD) / (2 * e);
  const ny = 1;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return { x: nx / len, y: ny / len, z: nz / len };
}

export function surfaceAt(t, x, z) {
  const ix = Math.round(x - t.x0);
  const iz = Math.round(z - t.z0);
  if (ix < 0 || ix >= t.nx || iz < 0 || iz >= t.nz) return S.OB;
  return t.surface[ix + iz * t.nx];
}

// Trees: visual only, no collision. count positions from rng(seed+7), uniform over bounds,
// kept only on ROUGH and >=6m from FAIRWAY/GREEN/TEE and >=8m from any other tree.
export function buildTrees(t) {
  const def = t.def;
  const count = (def.trees && def.trees.count) || 0;
  if (!count) return [];
  const gen = rng(def.seed + 7);
  const out = [];
  const minX = t.x0, maxX = t.x0 + t.nx - 1, minZ = t.z0, maxZ = t.z0 + t.nz - 1;
  let attempts = 0;
  const maxAttempts = count * 60;
  while (out.length < count && attempts < maxAttempts) {
    attempts++;
    const x = minX + gen() * (maxX - minX);
    const z = minZ + gen() * (maxZ - minZ);
    if (surfaceAt(t, x, z) !== S.ROUGH) continue;
    let nearPlay = false;
    for (let dz = -6; dz <= 6 && !nearPlay; dz += 2) {
      for (let dx = -6; dx <= 6 && !nearPlay; dx += 2) {
        if (Math.hypot(dx, dz) > 6) continue;
        const s = surfaceAt(t, x + dx, z + dz);
        if (s === S.FAIRWAY || s === S.GREEN || s === S.TEE) nearPlay = true;
      }
    }
    if (nearPlay) continue;
    let nearTree = false;
    for (const o of out) {
      if (Math.hypot(o.x - x, o.z - z) < 8) { nearTree = true; break; }
    }
    if (nearTree) continue;
    out.push({ x, z, y: heightAt(t, x, z), scale: 0.8 + 0.5 * gen() });
  }
  return out;
}
