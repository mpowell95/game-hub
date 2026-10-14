// archery/js/engine.js - Archery's rules, pure (no DOM, no three.js), so node can test every one
// (archery/js/test.js). docs/ARCHERY-BRIEF.md is the spec; archery/CLAUDE.md the decisions.
//
// UNITS. Every point is on the target face in FACE RADII: (0, 0) is the middle of the gold, 1 is the
// outside of the white ring, x to the right, y UP. A miss can be anywhere (an arrow over the target
// is at y = 3 or more).
//
// THE MATCH. 3 rounds ("stages" 0-2) of 3 arrows each. In every stage the STARTER shoots first (the
// challenger online: Matt, 2026-10-14, "The challenger shoots first. They go first each round"), then
// the other player. Highest total after 3 rounds wins. A tie is a SHOOT-OFF (Matt: "One more arrow"):
// stage 3 onward, one arrow each, starter first, the higher score wins; the same score goes to the
// arrow CLOSER TO THE MIDDLE (the standard archery shoot-off rule; Matt did not say, so it is in
// archery/CLAUDE.md as my choice); exactly level throws again.
//
// THE WIND. One value per stage, the same for both players (Matt: "Yes. But it must vary per
// round"), and harder each round (Matt: "the wind gets more difficult. Round 1 of the match you saw
// was wind at 1.5mph"; round 2 was 3.1). Worked out from the match's seed, so two phones agree with
// nothing extra stored.

export const ROUNDS = 3;
export const ARROWS = 3;
export const DIFFS = ['easy', 'medium', 'hard'];
/** mph range per round; every shoot-off uses the last one. */
export const WIND_RANGES = [[0.5, 2.0], [2.0, 4.0], [4.0, 6.0]];
/** How far 1 mph moves the arrow on the face, in face radii. 3.1 mph is about 3 rings. */
export const DRIFT_PER_MPH = 0.09;
/** Past this distance the arrow misses the boss too and flies on (no stuck arrow). */
export const BOSS = 1.3;
/** A landing point is kept to this precision, so both phones score a line-cutter the same. */
export const round4 = (v) => Math.round(v * 1e4) / 1e4;

// --- scoring --------------------------------------------------------------------------------------
/** The score of a point: 10 rings, 0.1 radius each, a line-cutter takes the higher ring. */
export function scoreAt(x, y) {
  const d = Math.hypot(x, y);
  if (!(d <= 1)) return 0;
  if (d <= 0.1) return 10;
  return 11 - Math.ceil(d * 10 - 1e-9);
}
/** Which colour band a score is in (for the how-to and the popup), from the outside in. */
export function bandOf(score) {
  return score >= 9 ? 'gold' : score >= 7 ? 'red' : score >= 5 ? 'blue' : score >= 3 ? 'black' : score >= 1 ? 'white' : 'miss';
}

// --- a seeded random number, so the wind is the same on both phones -------------------------------
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function mulberry32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The wind for a stage: { mph, dir } with dir 0-7 (0 = blowing right, counter-clockwise in 45s,
 *  so 2 = up, 4 = left, 5 = down-left). */
export function windFor(seed, stage) {
  const range = WIND_RANGES[Math.min(Math.max(0, stage | 0), WIND_RANGES.length - 1)];
  const rnd = mulberry32((seed >>> 0) ^ Math.imul((stage | 0) + 1, 0x9E3779B1));
  rnd(); // stir
  const mph = Math.round((range[0] + rnd() * (range[1] - range[0])) * 10) / 10;
  const dir = Math.floor(rnd() * 8) % 8;
  return { mph, dir };
}
/** Where the wind pushes an arrow, in face radii. */
export function driftOf(w) {
  if (!w) return { x: 0, y: 0 };
  const a = (w.dir % 8) * Math.PI / 4;
  const k = w.mph * DRIFT_PER_MPH;
  return { x: Math.cos(a) * k, y: Math.sin(a) * k };
}

// --- the match ------------------------------------------------------------------------------------
export const arrowsFor = (stage) => (stage < ROUNDS ? ARROWS : 1);
export const isShootOff = (stage) => stage >= ROUNDS;

/** A new match. `starter` (seat 0 or 1) shoots first in every stage. */
export function newMatch(seed, starter = 0) {
  return { v: 1, seed: (seed >>> 0), starter: starter === 1 ? 1 : 0, stage: 0, turn: starter === 1 ? 1 : 0,
    inTurn: 0, shots: [[], []], winner: null };
}

/** Points in the 3 rounds (a shoot-off is separate, the way archery scores it). */
export function totals(m) {
  return [0, 1].map((s) => m.shots[s].reduce((n, a) => n + (a.st < ROUNDS ? a.s : 0), 0));
}
export function stageScore(m, seat, stage) {
  return m.shots[seat].reduce((n, a) => n + (a.st === stage ? a.s : 0), 0);
}
/** The arrows a seat shot in one stage, in order. */
export function stageShots(m, seat, stage) { return m.shots[seat].filter((a) => a.st === stage); }

/**
 * One arrow lands at (x, y). Returns { event, s } where event is:
 *   'arrow' - the same player shoots again
 *   'turn'  - the turn passes to the other player in the same stage
 *   'round' - both have shot this stage; the next stage starts with the starter
 *   'tie'   - level after the rounds (or a level shoot-off): a shoot-off stage starts
 *   'win'   - m.winner is set
 * null when the match is over.
 */
export function shoot(m, x, y) {
  if (m.winner != null) return null;
  x = round4(x); y = round4(y);
  const s = scoreAt(x, y);
  m.shots[m.turn].push({ x, y, s, st: m.stage });
  m.inTurn++;
  if (m.inTurn < arrowsFor(m.stage)) return { event: 'arrow', s };
  m.inTurn = 0;
  if (m.turn === m.starter) { m.turn ^= 1; return { event: 'turn', s }; }
  // The second player has finished the stage.
  if (m.stage < ROUNDS - 1) { m.stage++; m.turn = m.starter; return { event: 'round', s }; }
  let w = -1;
  if (m.stage === ROUNDS - 1) {
    const t = totals(m);
    if (t[0] !== t[1]) w = t[0] > t[1] ? 0 : 1;
  } else {
    const a = stageShots(m, 0, m.stage)[0], b = stageShots(m, 1, m.stage)[0];
    if (a.s !== b.s) w = a.s > b.s ? 0 : 1;
    else {
      const da = Math.hypot(a.x, a.y), db = Math.hypot(b.x, b.y);
      if (Math.abs(da - db) > 1e-9) w = da < db ? 0 : 1;
    }
  }
  if (w >= 0) { m.winner = w; return { event: 'win', s }; }
  m.stage++;
  m.turn = m.starter;
  return { event: 'tie', s };
}

/** A saved match from storage, checked before it is trusted (by REPLAYING its shots). */
export function validMatch(m) {
  try {
    if (!m || typeof m !== 'object' || !Array.isArray(m.shots) || m.shots.length !== 2) return false;
    const r = newMatch(m.seed, m.starter);
    // Replay in the order the arrows were shot: the turn order is fixed, so it is recoverable.
    const left = [m.shots[0].slice(), m.shots[1].slice()];
    let guard = 0;
    while ((left[0].length || left[1].length) && guard++ < 200) {
      const a = left[r.turn].shift();
      if (!a || !shoot(r, a.x, a.y)) return false;
    }
    return r.stage === m.stage && r.turn === m.turn && r.inTurn === m.inTurn && r.winner === m.winner;
  } catch { return false; }
}

/** The order the arrows of a match were shot in: [{ seat, x, y, s, st }]. */
export function shotOrder(m) {
  const out = [];
  const r = newMatch(m.seed, m.starter);
  const left = [m.shots[0].slice(), m.shots[1].slice()];
  let guard = 0;
  while ((left[0].length || left[1].length) && guard++ < 400) {
    const seat = r.turn;
    const a = left[seat].shift();
    if (!a || !shoot(r, a.x, a.y)) break;
    out.push({ seat, ...a });
  }
  return out;
}

// --- the hold: the ring around the sight, and the sway ------------------------------------------
// Measured off the recording (archery/CLAUDE.md, "The ring"): it stays full for about 0.4 s, then
// drains about 0.3 a second while the aim is moving and about 0.1 a second while it is still; it
// is yellow below 1/3. Empty = PANIC (Matt: "Make it so the animated person panics and shoots it
// over the target").
export const GAUGE = { grace: 0.4, still: 0.1, move: 0.3, yellow: 1 / 3, red: 0.12, moving: 0.25 };

/** The ring after `dt` seconds held (`held` = seconds since the draw), moving at `speed` face radii
 *  a second. */
export function drainGauge(g, dt, held, speed) {
  if (held <= GAUGE.grace) return g;
  const rate = speed > GAUGE.moving ? GAUGE.move : GAUGE.still;
  return Math.max(0, g - rate * dt);
}

/** The sight's wander at time t (seconds), larger as the ring drains. `ph` is four phases. */
export function swayAt(t, g, ph = [0, 1.7, 3.1, 4.4]) {
  const amp = 0.025 + (1 - Math.max(0, Math.min(1, g))) * 0.11;
  return {
    x: amp * (0.6 * Math.sin(1.3 * t + ph[0]) + 0.4 * Math.sin(2.9 * t + ph[1])),
    y: amp * (0.6 * Math.sin(1.1 * t + ph[2]) + 0.4 * Math.sin(2.3 * t + ph[3])),
  };
}

/** Where a panicked arrow goes: well over the target. */
export function panicPoint(aim, rnd = Math.random) {
  return { x: aim.x + (rnd() - 0.5) * 1.4, y: Math.max(aim.y, 0) + 2.8 + rnd() * 1.8 };
}

/** Where a shot lands: the sight's point, pushed by the wind, plus a hair of chance. */
export function landing(aim, wind, jitter = [0, 0]) {
  const d = driftOf(wind);
  return { x: round4(aim.x + d.x + jitter[0]), y: round4(aim.y + d.y + jitter[1]) };
}

// --- the computer ---------------------------------------------------------------------------------
// It aims into the wind (more on harder levels) and misses by a 2D gaussian. Measured in test.js:
// about 5.6 a arrow on Easy, 7.3 on Medium, 8.6 on Hard.
export const CPU = {
  easy: { sigma: 0.42, comp: 0.45 },
  medium: { sigma: 0.27, comp: 0.75 },
  hard: { sigma: 0.15, comp: 0.93 },
};
export function gauss(rnd = Math.random) {
  let u = 0; while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}
export function cpuShot(m, diff, rnd = Math.random) {
  const c = CPU[diff] || CPU.medium;
  const w = windFor(m.seed, m.stage);
  const d = driftOf(w);
  const aim = { x: -d.x * c.comp + gauss(rnd) * c.sigma, y: -d.y * c.comp + gauss(rnd) * c.sigma };
  return landing(aim, w);
}
