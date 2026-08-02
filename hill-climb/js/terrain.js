// hill-climb/js/terrain.js — the infinite, deterministic hill and everything sitting on it.
//
// The terrain is an analytic height field: a sum of four sine layers whose phases come from the
// run's seed, multiplied by an envelope that (a) flattens the first ~18 m into a launch pad and
// (b) ramps the amplitude up with distance so the hills get meaner the further you get. Because
// it is a pure function of x, terrain never has to be stored, streamed or rewound: the camera can
// look anywhere, the physics can probe any x, and two devices with the same seed get the same
// hill. y is UP-positive here and everywhere else in this game except render.js.
//
// World objects (coins, fuel cans) are generated per 50 m CHUNK, lazily, cached by chunk index and
// keyed off the same seed — so they are equally deterministic, but a run that goes 4 km never
// builds more than the chunks it actually reached.

const TAU = Math.PI * 2;
export const CHUNK = 50;          // meters per world-object chunk
export const COIN_VALUES = [5, 25, 100];

/** Small, fast, seedable PRNG (mulberry32). Same generator the rest of the repo's games use. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 0..1 from two integers — used so a chunk's contents depend on (seed, chunk)
 *  alone and never on the order chunks happened to be visited. */
function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// The four sine layers: long rolling hills down to small chatter. Amplitudes are in meters at
// rough = 1.0 and full ramp; wavelengths are 2*PI/freq, i.e. ~114 m, ~48 m, ~22 m and ~10 m.
const LAYERS = [
  { amp: 3.4, freq: 0.055 },
  { amp: 1.5, freq: 0.130 },
  { amp: 0.62, freq: 0.290 },
  { amp: 0.26, freq: 0.610 },
];

function smoothstep(a, b, x) {
  if (b <= a) return x < a ? 0 : 1;
  const tt = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return tt * tt * (3 - 2 * tt);
}

/**
 * Build a terrain for one run.
 * @param {number} seed  any 32-bit int; the same seed always yields the same hill
 * @param {object} stage a STAGES entry (catalog.js): `rough` scales amplitude, `ramp` is the
 *                       distance in meters over which the hills grow to full size
 */
export function makeTerrain(seed, stage) {
  const rnd = mulberry32(seed);
  const rough = (stage && stage.rough) || 1;
  const rampM = (stage && stage.ramp) || 320;
  const layers = LAYERS.map((l) => ({ amp: l.amp, freq: l.freq, phase: rnd() * TAU }));

  /** The amplitude envelope at x: flat pad for the first 18 m, then 55% -> 100% over `ramp` m. */
  function envelope(x) {
    const pad = smoothstep(2, 18, x);
    const grow = 0.55 + 0.45 * Math.min(1, Math.max(0, x) / rampM);
    return pad * grow * rough;
  }

  /** Ground height (world y, up-positive) at world x. Defined for every real x, including
   *  negative (behind the start line), so the camera can never run off the end of the world. */
  function y(x) {
    let s = 0;
    for (const l of layers) s += l.amp * Math.sin(x * l.freq + l.phase);
    return s * envelope(x);
  }

  /** d(ground)/dx at x. Central difference: the analytic derivative would also have to
   *  differentiate the envelope's smoothstep, and a 2 cm central difference is both continuous
   *  and well under the accuracy the contact solver needs (wheels are 40 cm across). */
  function slope(x) {
    const h = 0.02;
    return (y(x + h) - y(x - h)) / (2 * h);
  }

  /** Unit surface normal at x, pointing away from the ground (up). */
  function normal(x) {
    const s = slope(x);
    const inv = 1 / Math.hypot(1, s);
    return { x: -s * inv, y: inv };
  }

  // --- world objects ---------------------------------------------------------------------------
  // A chunk holds a coin arc (sometimes two) and, less often, a fuel can. Nothing is placed in the
  // first chunk: the player needs a moment to get moving before the first pickup matters.
  const chunks = new Map();

  function buildChunk(ci) {
    const items = [];
    const x0 = ci * CHUNK;
    if (ci >= 1) {
      const arcs = hash2(seed, ci * 7 + 1) < 0.35 ? 2 : 1;
      for (let a = 0; a < arcs; a++) {
        const r1 = hash2(seed, ci * 31 + a * 3 + 2);
        const r2 = hash2(seed, ci * 31 + a * 3 + 3);
        const r3 = hash2(seed, ci * 31 + a * 3 + 4);
        const n = 3 + Math.floor(r1 * 5);                       // 3..7 coins
        const start = x0 + 6 + r2 * (CHUNK - 20) + a * 4;
        const gap = 1.5 + r3 * 0.9;
        // Value rises with distance: the 100s only start showing up deep into a run.
        const tier = r3 > 0.93 && x0 > 600 ? 2 : (r2 > 0.62 ? 1 : 0);
        const lift = 1.9 + r1 * 1.6;
        for (let i = 0; i < n; i++) {
          const cx = start + i * gap;
          // Arc the line above the terrain so it reads as a jump reward, not a floor decal.
          const bow = Math.sin((i + 0.5) / n * Math.PI) * 1.5;
          items.push({ kind: 'coin', x: cx, y: y(cx) + lift + bow, value: COIN_VALUES[tier], taken: false, r: 0.42 });
        }
      }
    }
    if (ci >= 1 && hash2(seed, ci * 13 + 5) < 0.62) {
      const fx = x0 + 10 + hash2(seed, ci * 13 + 6) * (CHUNK - 20);
      items.push({ kind: 'fuel', x: fx, y: y(fx) + 2.2, amount: 55, taken: false, r: 0.6 });
    }
    return items;
  }

  /** Every world object whose x falls in [x0, x1]. Builds (and caches) any chunk it touches. */
  function itemsIn(x0, x1) {
    const c0 = Math.floor(x0 / CHUNK), c1 = Math.floor(x1 / CHUNK);
    const out = [];
    for (let ci = c0; ci <= c1; ci++) {
      if (ci < 0) continue;
      let list = chunks.get(ci);
      if (!list) { list = buildChunk(ci); chunks.set(ci, list); }
      for (const it of list) if (it.x >= x0 && it.x <= x1) out.push(it);
    }
    return out;
  }

  return { seed, y, slope, normal, itemsIn, envelope, _chunks: chunks };
}

export default { makeTerrain, mulberry32, CHUNK, COIN_VALUES };
