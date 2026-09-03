// golf/js/game.js - pure round-rules module. No DOM, no Math.random, runs in Node. See §8 of
// GOLF-HANDOFF.md. Owns every round RULE: stroke counting, water/OB penalties, max strokes per
// hole, the wind roll, the points table, hole-to-hole advance, and round state create/restore.
// ui.js calls these and paints; it never mutates round.strokes/points/ball/wind/phase/hole/club
// itself (club: the player's OWN override write in the club-row picker is the one exception -
// that is a player choice being recorded, not a rule being applied).
//
// Lifted out of ui.js in Part 5 - Part 4 had this logic inline (see that file's old header
// note) so hole 1 was genuinely playable before this file existed. The rules below are the same
// rules, moved verbatim, not redesigned. See DECISIONS.md#part5-scope.

import { rng, S } from './terrain.js';
import { DIFF } from './meters.js';

// ---------------------------------------------------------------- points + result words ----

export const POINTS = { '-3': 8, '-2': 5, '-1': 2, '0': 0, '1': -1 };   // ≤ -3 → 8, ≥ 2 → -3
export function holePoints(strokes, par) {
  const d = strokes - par;
  if (d <= -3) return 8;
  if (d >= 2) return -3;
  return POINTS[String(d)];
}

export function resultKey(strokes, par) {
  if (strokes === 1) return 'res_ace';
  const d = strokes - par;
  if (d <= -3) return 'res_albatross';
  if (d === -2) return 'res_eagle';
  if (d === -1) return 'res_birdie';
  if (d === 0) return 'res_par';
  if (d === 1) return 'res_bogey';
  if (d === 2) return 'res_double';
  return 'res_triple';
}

export function isMaxedOut(strokes, par) { return strokes >= par + 4; }

export function roundTotal(round) {
  return round.points.reduce((a, p) => a + (p || 0), 0);
}

// ---------------------------------------------------------------- wind ----

export function rollWind(hole, seed, windMax) {
  if (hole.wind) return hole.wind;
  const gen = rng((seed + hole.n * 31) >>> 0);
  const mag = gen() * windMax;
  const dir = gen() * Math.PI * 2;
  return { x: mag * Math.sin(dir), z: mag * Math.cos(dir) };
}

// ---------------------------------------------------------------- lie mapping ----

function lieKeyOf(surfCode) {
  switch (surfCode) {
    case S.TEE: return 'tee';
    case S.FAIRWAY: return 'fairway';
    case S.FRINGE: return 'fringe';
    case S.GREEN: return 'green';
    case S.SAND: return 'sand';
    case S.WATER: return 'water';
    case S.OB: return 'ob';
    default: return 'rough';
  }
}

// ---------------------------------------------------------------- create / restore ----

// `seed` is supplied by the caller (ui.js, for a genuinely random new round) rather than rolled
// in here - this file must never call Math.random (§15), and a fresh round's seed is the one
// piece of round setup that is NOT a rule, it is where the randomness for an unplayed round
// comes from. Everything the seed then DRIVES (wind, per-shot physics seeding) stays here.
// `practice` (Part 8, §14): true when the course was in admin-config's TESTING state the moment
// this round started. Frozen for the round's whole lifetime, same as difficulty/seed - decided
// once by the caller (ui.js, which is the one file allowed to ask admin-config a question) and
// carried here as plain data so game.js never needs to import admin-config itself.
export function createRound(course, difficulty, seed, practice) {
  const hole1 = course.holes[0];
  const round = {
    v: 1,
    courseId: course.id,
    difficulty,
    seed,
    hole: 1,
    strokes: new Array(course.holes.length).fill(0),
    points: new Array(course.holes.length).fill(null),
    ball: { x: hole1.tee[0], z: hole1.tee[1], lie: 'tee' },
    wind: rollWind(hole1, seed, DIFF[difficulty].windMax),
    club: null,
    phase: 'intro',
    practice: !!practice,
  };
  return round;
}

// Defensive normalize of a saved round - localStorage can hold a partial or stale-shape object
// (an old build, a hand-edited value, storage corruption). Same discipline as profile-store.js's
// validated reads. Returns null if the shape is unusable; the caller then behaves exactly as if
// no round were saved (§13.4's Play button, not Resume).
export function restoreRound(raw, course) {
  if (!raw || typeof raw !== 'object') return null;
  const n = course.holes.length;
  if (raw.v !== 1) return null;
  if (raw.courseId !== course.id) return null;
  if (!Number.isFinite(raw.seed)) return null;
  if (!Number.isFinite(raw.hole) || raw.hole < 1 || raw.hole > n) return null;
  if (!Array.isArray(raw.strokes) || raw.strokes.length !== n) return null;
  if (!Array.isArray(raw.points) || raw.points.length !== n) return null;
  if (!DIFF[raw.difficulty]) return null;
  if (!raw.ball || typeof raw.ball !== 'object' || !Number.isFinite(raw.ball.x) || !Number.isFinite(raw.ball.z)) return null;
  if (!raw.wind || typeof raw.wind !== 'object') return null;
  return {
    v: 1,
    courseId: raw.courseId,
    difficulty: raw.difficulty,
    seed: raw.seed,
    hole: raw.hole,
    strokes: raw.strokes.slice(),
    points: raw.points.slice(),
    ball: { x: raw.ball.x, z: raw.ball.z, lie: typeof raw.ball.lie === 'string' ? raw.ball.lie : 'fairway' },
    wind: { x: Number(raw.wind.x) || 0, z: Number(raw.wind.z) || 0 },
    club: typeof raw.club === 'string' ? raw.club : null,
    phase: typeof raw.phase === 'string' ? raw.phase : 'intro',
    // A save from before Part 8 has no `practice` field at all - default false (the common
    // case: real rounds), never true, so an old save can never retroactively stop counting.
    practice: raw.practice === true,
  };
}

// ---------------------------------------------------------------- shot application ----

// Applies a physics.js simulateShot() result to the round: stroke +1 (+1 more for a water/OB
// penalty), moves the ball, and - if the hole just ended (holed or maxed-out) - records its
// points, and either advances to the next hole (fresh ball/wind/phase rolled for it) or ends the
// round (phase -> 'summary'). Mutates `round` in place (a plain object owned by the caller) and
// returns a plain description of what happened, for ui.js to paint/animate; this function never
// touches the DOM and physics.js/flight.js are not imported here (frozen, Part 3 onward - §15).
export function applyShotResult(round, course, result) {
  const holeIdx = round.hole - 1;
  const hole = course.holes[holeIdx];
  const ball = round.ball;
  let strokesAdded = 1;
  let penaltyKey = null;

  // physics.js's `result.lie` is already surfaceAt(rest.x, rest.z) for every outcome (including
  // water/ob, where rest is the dry point / the shot's own `from` respectively) - use it
  // directly. See DECISIONS.md#part4-scope for the bug this replaced (OB's returning lie
  // hardcoded to 'tee').
  if (result.outcome === 'water') { strokesAdded += 1; penaltyKey = 'pen_water'; }
  else if (result.outcome === 'ob') { strokesAdded += 1; penaltyKey = 'pen_ob'; }

  ball.x = result.rest.x;
  ball.z = result.rest.z;
  ball.lie = result.outcome === 'hole' ? 'green' : lieKeyOf(result.lie);

  round.strokes[holeIdx] += strokesAdded;
  round.club = null; // re-select automatically for the next shot

  const holed = result.outcome === 'hole';
  const maxed = !holed && isMaxedOut(round.strokes[holeIdx], hole.par);
  const outcome = {
    penaltyKey, holed, maxed,
    resultKey: null, points: null,
    holeAdvanced: false, roundOver: false,
  };

  if (holed || maxed) {
    const strokes = round.strokes[holeIdx];
    round.points[holeIdx] = holePoints(strokes, hole.par);
    outcome.resultKey = resultKey(strokes, hole.par);
    outcome.points = round.points[holeIdx];

    if (round.hole >= course.holes.length) {
      round.phase = 'summary';
      outcome.roundOver = true;
    } else {
      round.hole += 1;
      const nextHole = course.holes[round.hole - 1];
      round.ball = { x: nextHole.tee[0], z: nextHole.tee[1], lie: 'tee' };
      round.club = null;
      round.wind = rollWind(nextHole, round.seed, DIFF[round.difficulty].windMax);
      round.phase = 'intro';
      outcome.holeAdvanced = true;
    }
  }

  return outcome;
}
