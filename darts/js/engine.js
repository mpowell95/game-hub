// darts/js/engine.js - the rules, with no DOM: board geometry and scoring, the 301 match, and the
// computer's aim. Pure, so darts/js/test.js runs it headless with `node`.
//
// Coordinates are in units of R, the board's scoring radius (the outer edge of the double ring),
// with the bull at (0, 0), x to the right and y DOWN (canvas convention).

/** Numbers clockwise from the top, the standard board. */
export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/** Ring radii as fractions of R. Standard board proportions (170 mm to the double's outer wire),
 *  except FRAME, the black number ring around the scoring area, sized to the GamePigeon look. */
export const RING = {
  bullIn: 0.0374,   // 6.35 mm, the 50
  bullOut: 0.0935,  // 15.9 mm, the 25
  trebIn: 0.5824,   // 99 mm
  trebOut: 0.6294,  // 107 mm
  dblIn: 0.9529,    // 162 mm
  dblOut: 1,        // 170 mm
  frame: 1.27,      // the black ring the numbers sit on
};

export const START = 301;
export const DARTS_PER_TURN = 3;
export const DIFFS = ['easy', 'medium', 'hard'];

/** Index into ORDER of the wedge an angle falls in. `deg` is clockwise from straight up. */
function wedgeIndex(deg) {
  return Math.floor((((deg + 9) % 360) + 360) % 360 / 18) % 20;
}

/** What a dart landing at (x, y) scores.
 *  ring: 'bull' | 'obull' | 'single' | 'treble' | 'double' (scored), 'frame' (the black number
 *  ring: on the board but worth nothing) or 'off' (missed the board entirely). */
export function scoreAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= RING.bullIn) return { pts: 50, num: 25, mult: 2, ring: 'bull' };
  if (r <= RING.bullOut) return { pts: 25, num: 25, mult: 1, ring: 'obull' };
  if (r > RING.dblOut) return { pts: 0, num: 0, mult: 0, ring: r <= RING.frame ? 'frame' : 'off' };
  const deg = Math.atan2(x, -y) * 180 / Math.PI;
  const num = ORDER[wedgeIndex(deg)];
  let mult = 1, ring = 'single';
  if (r >= RING.trebIn && r <= RING.trebOut) { mult = 3; ring = 'treble'; }
  else if (r >= RING.dblIn) { mult = 2; ring = 'double'; }
  return { pts: num * mult, num, mult, ring };
}

/** The point at the middle of a target. `ring` is 'bull' | 'obull' | 'single' | 'treble' |
 *  'double'; `num` is 1-20 (ignored for the bulls). The single aims at the INNER single, the big
 *  area between the bull and the treble. */
export function targetPoint(num, ring) {
  if (ring === 'bull') return { x: 0, y: 0 };
  if (ring === 'obull') return { x: 0, y: -(RING.bullIn + RING.bullOut) / 2 };
  const i = ORDER.indexOf(num);
  const a = (i * 18) * Math.PI / 180;
  const r = ring === 'treble' ? (RING.trebIn + RING.trebOut) / 2
    : ring === 'double' ? (RING.dblIn + RING.dblOut) / 2
      : (RING.bullOut + RING.trebIn) / 2;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

// --- the match -------------------------------------------------------------------------------

/** A fresh 301 match. `starter` is the seat that throws first (0 or 1). */
export function newMatch(starter = 0, start = START) {
  const s = starter === 1 ? 1 : 0;
  return { start, scores: [start, start], turn: s, starter: s, turnStart: start, darts: [], winner: null, turns: 0 };
}

/** Throw one dart for the seat whose turn it is. Mutates and returns the match plus what happened:
 *    'score'  the dart counted and the turn goes on
 *    'end'    the dart counted and it was the third: the turn is over (call nextTurn)
 *    'bust'   it would have gone below zero: this turn's darts are void and the turn is over
 *    'win'    exactly zero
 *  There is no double-out: any dart that lands exactly on zero wins. */
export function throwDart(m, x, y) {
  if (m.winner != null) return { m, event: 'over', hit: null };
  const hit = scoreAt(x, y);
  m.darts.push({ x, y, pts: hit.pts, ring: hit.ring });
  const left = m.scores[m.turn] - hit.pts;
  if (left < 0) {
    m.scores[m.turn] = m.turnStart;
    return { m, event: 'bust', hit };
  }
  m.scores[m.turn] = left;
  if (left === 0) { m.winner = m.turn; return { m, event: 'win', hit }; }
  return { m, event: m.darts.length >= DARTS_PER_TURN ? 'end' : 'score', hit };
}

/** Hand the board to the other seat. */
export function nextTurn(m) {
  m.turn = m.turn ^ 1;
  m.darts = [];
  m.turnStart = m.scores[m.turn];
  m.turns += 1;
  return m;
}

/** A saved match, checked before it is trusted. Returns the match or null. */
export function validMatch(m) {
  if (!m || typeof m !== 'object') return null;
  const okScore = (v) => Number.isInteger(v) && v >= 0 && v <= 1001;
  if (!Array.isArray(m.scores) || m.scores.length !== 2 || !m.scores.every(okScore)) return null;
  if (m.turn !== 0 && m.turn !== 1) return null;
  if (!okScore(m.turnStart) || !okScore(m.start)) return null;
  if (!Array.isArray(m.darts) || m.darts.length > DARTS_PER_TURN) return null;
  for (const d of m.darts) if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;
  if (m.winner != null && m.winner !== 0 && m.winner !== 1) return null;
  return m;
}

// --- the computer --------------------------------------------------------------------------

/** How far a computer dart strays from where it aimed: the standard deviation of a 2D gaussian,
 *  in units of R. Hard groups tightly around the treble; Easy lands somewhere on the board. */
export const SPREAD = { easy: 0.30, medium: 0.17, hard: 0.085 };

/** Where the computer aims with `left` points to go. Exact finishes first, by the size of the
 *  target (a single is easier than a double, which is easier than a treble or the bull); otherwise
 *  treble 20 while there is room for it, and a single that leaves a finish when there is not. */
export function chooseTarget(left, diff) {
  if (left <= 20) return { num: left, ring: 'single' };
  if (left === 25) return { num: 25, ring: 'obull' };
  if (left === 50) return { num: 25, ring: 'bull' };
  if (left <= 40 && left % 2 === 0) return { num: left / 2, ring: 'double' };
  if (left <= 60 && left % 3 === 0) return { num: left / 3, ring: 'treble' };
  // Easy has no plan: it throws at the middle of the board.
  if (diff === 'easy') return { num: 25, ring: 'bull' };
  if (left > 80) return { num: 20, ring: 'treble' };
  // 41-80 with no one-dart finish: a single that leaves 20 or less (a single next dart).
  const s = Math.max(1, Math.min(20, left - 20));
  return { num: s, ring: 'single' };
}

/** A gaussian pair (Box-Muller). `rnd` is a 0-1 generator, Math.random by default. */
function gauss2(rnd) {
  let u = 0; while (u === 0) u = rnd();
  const v = rnd();
  const k = Math.sqrt(-2 * Math.log(u));
  return [k * Math.cos(2 * Math.PI * v), k * Math.sin(2 * Math.PI * v)];
}

/** Where the computer's next dart lands, and what it aimed at. */
export function computerThrow(left, diff, rnd = Math.random) {
  const tgt = chooseTarget(left, diff);
  const p = targetPoint(tgt.num, tgt.ring);
  const s = SPREAD[diff] || SPREAD.medium;
  const [gx, gy] = gauss2(rnd);
  return { x: p.x + gx * s, y: p.y + gy * s, aim: tgt };
}

// --- the player's flick --------------------------------------------------------------------

/** The flick speed (screen heights per second, upward) that lands at the height of the bull. */
export const FLICK_MID = 2.3;
/** How many R the dart rises for each doubling of flick speed. Logarithmic, so a hard flick and a
 *  soft one are equally forgiving. */
export const FLICK_GAIN = 1.45;
/** Below this the throw is not a throw: the dart drops back into the hand. */
export const FLICK_MIN = 0.55;

/** Where a flick lands, in board units. `ox, oy` is the dart's position at release, `vx, vy` the
 *  finger's velocity at release (both in board units and board units per second, y down), and
 *  `speed` the upward speed in screen heights per second. The dart flies along the flick's line,
 *  so swiping toward a number aims at it; the speed alone decides the height. Returns null for a
 *  flick too slow or not upward. */
export function flickLanding(ox, oy, vx, vy, speed, jitter = [0, 0]) {
  if (!(vy < 0) || !(speed >= FLICK_MIN)) return null;
  const y = -FLICK_GAIN * Math.log2(speed / FLICK_MID) + jitter[1];
  const x = ox + (vx / -vy) * (oy - y) + jitter[0];
  return { x, y };
}
