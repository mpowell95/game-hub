// build.js : R14 (docs/BASEBALL-3D-BUILD.md section 9, "R14"). The Quick Play skill-point budget,
// derived from `settings.js`'s CAPS/START_POINTS_PER_SIDE/START_CAP, never invented here. Pure,
// dependency-free, headless-tested (baseball/js/test.js). No DOM, no storage, no wall clock.
//
// A build is `{ hitAcc, hitPow, hitSpd, pitchSpd, pitchAcc, pitchSpin }` - the same shape
// `makePlayerTeam({ skills, hand })` (teams.js) already takes. `budgetFor`/`capFor` are PER SIDE:
// the hitting three and the pitching three are each scaled/capped independently, to the SAME
// budget and cap (doc's own "15 in hitting and 15 in pitching" at Little League).

import { LEAGUES, CAPS, START_POINTS_PER_SIDE, START_CAP, HIT_SKILL_IDS, PITCH_SKILL_IDS, SKILL_IDS } from './engine/settings.js';

/** Points available per SIDE (hitting, or pitching) at this league. Little League is the doc's own
 *  starting budget; every league above it is 3x the CAP of the league below - "the build of a
 *  player who maxed the league below." */
export function budgetFor(league) {
  const idx = LEAGUES.indexOf(league);
  if (idx <= 0) return START_POINTS_PER_SIDE;
  const prev = LEAGUES[idx - 1];
  return 3 * (CAPS[prev] != null ? CAPS[prev] : CAPS.majors);
}

/** The per-skill point cap at this league. Little League is the doc's own starting cap; every
 *  league above it is that league's own CAPS entry. */
export function capFor(league) {
  const idx = LEAGUES.indexOf(league);
  if (idx <= 0) return START_CAP;
  return CAPS[league] != null ? CAPS[league] : CAPS.majors;
}

/** Round a group of (possibly fractional, already cap-clamped) skill values to integers that sum
 *  to EXACTLY `target`, by largest remainder - and repair the other direction too (removing points
 *  from the smallest remainder first) when the floor sum already exceeds `target`. `target` is
 *  always reachable within `[0, cap]` per skill because every caller here keeps `target <= 3*cap`
 *  (budgetFor(league) < 3*capFor(league) at every rung - verified in test.js), so this never has
 *  to leave a skill under-filled for lack of room. */
function repairToSum(values, target, cap) {
  const ids = Object.keys(values);
  const floors = {};
  const remainders = {};
  for (const id of ids) {
    const v = Math.min(cap, Math.max(0, values[id]));
    floors[id] = Math.floor(v);
    remainders[id] = v - floors[id];
  }
  let sum = ids.reduce((s, id) => s + floors[id], 0);
  let diff = Math.round(target) - sum;
  if (diff > 0) {
    const order = [...ids].sort((a, b) => remainders[b] - remainders[a]);
    let i = 0;
    const budget = ids.length * 1000;
    while (diff > 0 && i < budget) {
      const id = order[i % order.length];
      if (floors[id] < cap) { floors[id]++; diff--; }
      i++;
    }
  } else if (diff < 0) {
    const order = [...ids].sort((a, b) => remainders[a] - remainders[b]);
    let i = 0;
    const budget = ids.length * 1000;
    while (diff < 0 && i < budget) {
      const id = order[i % order.length];
      if (floors[id] > 0) { floors[id]--; diff++; }
      i++;
    }
  }
  return floors;
}

function scaleGroup(ids, preset, budget, cap) {
  const raw = {};
  let total = 0;
  for (const id of ids) { const v = Math.max(0, preset[id] || 0); raw[id] = v; total += v; }
  const scale = total > 0 ? budget / total : 0;
  const scaled = {};
  for (const id of ids) scaled[id] = raw[id] * scale;
  return repairToSum(scaled, budget, cap);
}

/** Scale a PRESETS row (settings.js) to `budget` points per side, clamped to `cap`, repaired one
 *  point at a time by the largest remainder so hitting and pitching each sum to `budget` exactly. */
export function scalePreset(preset, budget, cap) {
  return { ...scaleGroup(HIT_SKILL_IDS, preset, budget, cap), ...scaleGroup(PITCH_SKILL_IDS, preset, budget, cap) };
}

function clampGroup(ids, build, budget, cap) {
  const vals = {};
  for (const id of ids) vals[id] = Math.min(cap, Math.max(0, Math.round((build && build[id]) || 0)));
  return repairToSum(vals, budget, cap);
}

/** Clamp an existing (Custom) build to a new budget/cap - a league change that is neither a named
 *  preset nor the most recent Randomize roll. Never invents a new distribution; only trims or
 *  repairs what is already there. */
export function clampBuild(build, budget, cap) {
  return { ...clampGroup(HIT_SKILL_IDS, build, budget, cap), ...clampGroup(PITCH_SKILL_IDS, build, budget, cap) };
}

function distributeRandom(ids, budget, cap, rand) {
  const out = {};
  for (const id of ids) out[id] = 0;
  let remaining = Math.round(budget);
  let guard = 0;
  const maxGuard = 200000;
  while (remaining > 0 && guard < maxGuard) {
    guard++;
    const id = ids[Math.floor(rand() * ids.length) % ids.length];
    if (out[id] < cap) { out[id]++; remaining--; }
  }
  return out;
}

/** A true random split within caps - each side independently, so a randomized build is never
 *  skewed hit-heavy or pitch-heavy by construction. `rand` is an injectable `() => [0,1)` draw
 *  (default `Math.random`) for deterministic tests. */
export function randomBuild(budget, cap, rand = Math.random) {
  return {
    ...distributeRandom(HIT_SKILL_IDS, budget, cap, rand),
    ...distributeRandom(PITCH_SKILL_IDS, budget, cap, rand),
  };
}

/** What the plus/minus buttons call. Returns a NEW build object when the tap is legal (the skill
 *  stays within `[0, cap]` and its SIDE's total stays within `budget`), or the SAME `build`
 *  reference, unchanged, when it would break either - so a caller can tell a no-op apart from a
 *  real change with `result !== build`, which is also `canAdjust`'s whole implementation. */
export function adjust(build, id, delta, budget, cap) {
  const group = HIT_SKILL_IDS.includes(id) ? HIT_SKILL_IDS : PITCH_SKILL_IDS;
  const cur = (build && build[id]) || 0;
  const next = cur + delta;
  if (next < 0 || next > cap) return build;
  let sideTotal = 0;
  for (const gid of group) sideTotal += gid === id ? next : ((build && build[gid]) || 0);
  if (sideTotal > budget) return build;
  return { ...build, [id]: next };
}

/** Would `adjust` actually change anything? What a plus/minus button's `aria-disabled` reads. */
export function canAdjust(build, id, delta, budget, cap) {
  return adjust(build, id, delta, budget, cap) !== build;
}

export default { budgetFor, capFor, scalePreset, clampBuild, randomBuild, adjust, canAdjust, SKILL_IDS };
