// rng.js : the ONLY source of randomness anywhere in the baseball engine. Pure, deterministic,
// no Math.random, no Date.now, no crypto. Every other engine file takes an rng instance (or a
// value derived from one) as a parameter; nothing reaches for ambient randomness.
//
// mulberry32 is the same generator Dominoes and Golf's holegen.js already use in this repo -
// one multiply-heavy 32-bit state, fast, and good enough for gameplay (not cryptography).

/** Pure step: one 32-bit state in, {value, next} out. This is what makes the engine's RNG
 *  resumable through an ordinary JSON snapshot - `game.js` stores `next` as a plain number
 *  (`rngState`) rather than holding a live generator closure, so `Game.fromSnapshot()` can restore
 *  the exact next draw with nothing more than that one integer. */
export function stepRng(state) {
  let a = state >>> 0;
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: a >>> 0 };
}

/** Build a seeded PRNG closure over `stepRng`. Same seed -> same infinite sequence of doubles in
 *  [0, 1). Used where a plain callable generator is convenient and resumability is not needed
 *  (team generation from a fixed seed, tests, one-off tables) - the game's own live match state
 *  uses `stepRng` directly so its RNG position is snapshot-able. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    const { value, next } = stepRng(a);
    a = next;
    return value;
  };
}

/** Fold a string (or number) plus any number of extra parts into one 32-bit seed. Deterministic:
 *  same inputs, same seed, every platform, every run - what lets teams.js build the same team from
 *  a (league, index) pair on every device without persisting anything. */
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9E3779B9; // separator between parts, so ('ab','c') != ('a','bc')
  }
  return h >>> 0;
}

/** Pick one entry of `items` weighted by the parallel `weights` array. Both arrays must be the
 *  same length and every weight must be >= 0 with a positive sum. */
export function pickWeighted(rng, items, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Box-Muller normal(mean, sd) off the same seeded stream. Two uniforms consumed per call
 *  (the paired second sample is deliberately discarded rather than cached, so a single call
 *  always advances the rng by exactly two draws - simpler to reason about than a hidden cache
 *  that changes how many draws the NEXT call consumes). */
export function gaussian(rng, mean = 0, sd = 1) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * sd;
}

export default { mulberry32, hashSeed, pickWeighted, gaussian };
