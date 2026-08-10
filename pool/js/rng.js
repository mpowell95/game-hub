// rng.js — deterministic mulberry32 PRNG. Pure, no DOM. Shared by ai.js (aim/power
// jitter, the topN pick) and ui.js (which owns the per-game seed) so a Poolv2 AI
// game's decisions are reproducible/replayable given the seed (BUILD-SPEC.md §6 #8:
// "seed the RNG so AI games are reproducible and replayable"). Same algorithm as the
// mulberry32 helper other reference games' Node test harnesses already use for
// scripted determinism (see test-mp-lockstep.mjs), so this is a known-good PRNG, not
// a new one invented for this file.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
