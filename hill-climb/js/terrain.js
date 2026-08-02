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

// --- how high a pickup may float -----------------------------------------------------------------
//
// THE REACHABILITY RULE (2026-08-02, Matt: "some coins and gas tanks are impossible to get. There's
// no jump button... It's good to have coins in the air like that IF there's a ramp or jump you have
// to go off to collect them. But as is, it's just impossible.")
//
// There is no jump. The only way to leave the ground is to launch off a crest, so a pickup is only
// fair if it is EITHER within reach of a car that is simply driving, OR sitting downrange of a real
// ramp. The first build placed every arc at a random 1.9-5.0 m above whatever terrain happened to
// be underneath, including dead-flat ground, which made a lot of them unreachable.
//
// The numbers come from the physics, not taste: Run.step() collects anything within 2.4 m of the
// CHASSIS CENTRE, and that centre rides about 0.9 m (jeep) to 1.3 m (truck) above the ground. So a
// pickup at ground + GROUND_LIFT is collected by every vehicle just by driving through it.
export const GROUND_LIFT = 1.5;   // coins that hug the terrain
export const FUEL_LIFT = 1.4;     // fuel cans, ALWAYS - see buildChunk
export const AIR_APEX = 2.6;      // how far an air arc rises above the crest that launches it
export const AIR_MAX = 4.2;       // hard ceiling above the LOCAL ground, so nothing is absurd
/** Reference speed for "would a car launch off this crest" — see crestIn(). */
export const LAUNCH_SPEED = 14;
/** Sampling grid for crest detection. Global, so crestIn() is window-independent. */
export const CREST_STEP = 0.5;

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
  const gravity = (stage && stage.gravity) || 22;
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

  /** Second derivative of the ground. Negative = convex (a hilltop), which is what throws a car. */
  function curvature(x) {
    const h = 0.5;
    return (y(x + h) - 2 * y(x) + y(x - h)) / (h * h);
  }

  /**
   * The first RAMP in [x0, x1], or null — a crest a car would genuinely LAUNCH off, which is the
   * only way to get airborne in this game (there is no jump button).
   *
   * The test is physical, not a slope guess: following convex ground at speed v needs a downward
   * acceleration of v^2 * |y''|, and the only thing pushing the car down is gravity. So the wheels
   * leave the ground exactly when |y''| >= g / v^2. LAUNCH_SPEED is the "a competent player is
   * doing about this" reference speed. An earlier version thresholded on SLOPE instead and was
   * both wrong (a steep hill you crawl up throws you no higher than a gentle one you hit fast) and
   * too strict for the Countryside, which found no ramps at all. This form also adapts per stage
   * for free: the Moon's low gravity turns almost every crest into a launch, which is exactly how
   * that stage should feel.
   *
   * Scans a GLOBAL grid (x snapped to a multiple of CREST_STEP) rather than stepping from x0, so
   * the answer for a given x never depends on which window you happened to ask about — the
   * generator asks per chunk and the tests ask per coin, and those two must agree.
   */
  function crestIn(x0, x1) {
    const need = gravity / (LAUNCH_SPEED * LAUNCH_SPEED);
    const a = Math.ceil(x0 / CREST_STEP) * CREST_STEP;
    let prev = slope(a - CREST_STEP);
    for (let x = a; x <= x1; x += CREST_STEP) {
      const s = slope(x);
      if (prev > 0 && s <= 0 && -curvature(x) >= need) return x;
      prev = s;
    }
    return null;
  }

  // --- world objects ---------------------------------------------------------------------------
  // A chunk holds one coin arc and, more often than not, a fuel can. Nothing is placed in the first
  // chunk: the player needs a moment to get moving before the first pickup matters.
  const chunks = new Map();

  function buildChunk(ci) {
    const items = [];
    const x0 = ci * CHUNK;
    if (ci < 1) return items;

    const r1 = hash2(seed, ci * 31 + 2);
    const r2 = hash2(seed, ci * 31 + 3);
    const r3 = hash2(seed, ci * 31 + 4);
    const n = 4 + Math.floor(r1 * 4);                 // 4..7 coins
    const gap = 1.6 + r3 * 0.7;
    // Value rises with distance: the 100s only start showing up deep into a run.
    const value = COIN_VALUES[r3 > 0.93 && x0 > 600 ? 2 : (r2 > 0.62 ? 1 : 0)];
    const crest = crestIn(x0 + 4, x0 + CHUNK - 16);

    if (crest != null) {
      // AIR ARC — the payoff for actually launching off this crest. Anchored to the crest so the
      // line traces the trajectory a car leaving it would follow, and clamped at both ends: never
      // below GROUND_LIFT over the ground beneath it (nothing buried in the landing slope), never
      // above AIR_MAX over it (nothing needing a perfect run to touch).
      const cy = y(crest);
      const span = gap * (n - 1) + 1.2;
      for (let i = 0; i < n; i++) {
        const cx = crest + 1.2 + i * gap;
        const tN = (cx - crest) / span;                          // 0..1 along the arc
        const arc = AIR_APEX * (1 - Math.pow(2 * tN - 1, 2));    // parabola, zero at both ends
        const gy = y(cx);
        const target = cy + GROUND_LIFT + arc;
        items.push({
          kind: 'coin', x: cx, value, taken: false, r: 0.42,
          y: Math.min(Math.max(target, gy + GROUND_LIFT), gy + AIR_MAX),
        });
      }
    } else {
      // GROUND ARC — no ramp here, so the line hugs the terrain at a height every vehicle
      // collects just by driving through it.
      const start = x0 + 6 + r2 * (CHUNK - 24);
      for (let i = 0; i < n; i++) {
        const cx = start + i * gap;
        items.push({ kind: 'coin', x: cx, y: y(cx) + GROUND_LIFT, value, taken: false, r: 0.42 });
      }
    }

    // Fuel is ALWAYS ground-hugging and never rides an air arc. A missed coin costs you coins; an
    // unreachable can ends the run, which makes it the one pickup that must never be a gamble.
    if (hash2(seed, ci * 13 + 5) < 0.62) {
      const fx = x0 + 10 + hash2(seed, ci * 13 + 6) * (CHUNK - 20);
      items.push({ kind: 'fuel', x: fx, y: y(fx) + FUEL_LIFT, amount: 55, taken: false, r: 0.6 });
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

  return { seed, y, slope, normal, curvature, itemsIn, envelope, crestIn, _chunks: chunks };
}

export default { makeTerrain, mulberry32, CHUNK, COIN_VALUES, GROUND_LIFT, FUEL_LIFT, AIR_APEX, AIR_MAX };
