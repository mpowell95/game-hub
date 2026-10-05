// darts/js/engine.js - the rules, with no DOM: board geometry and scoring, the match (301, 201, 101
// and Cricket, 2026-10-01), and the computer's aim. Pure, so darts/js/test.js runs it headless.
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
/** Every game a match can be (Matt, 2026-10-01: "Please add 201 and 101. And add cricket. With
 *  options of in order or any order"). A match without `kind` is 301: every save and online match
 *  made before this has none. */
export const KINDS = ['301', '201', '101', 'cricket', 'cricket-order', 'cricket-np', 'cricket-order-np'];
export const isCricket = (kind) => KINDS.includes(kind) && String(kind).startsWith('cricket');
/** Cricket closed 20, 19 ... 15, bull in that order ('cricket-order', 'cricket-order-np'). */
export const inOrder = (kind) => String(kind || '').startsWith('cricket-order');
/** Cricket with no points (Matt, 2026-10-05: "Add the on/off option"): the first to close all seven
 *  wins, and marks past the third count for nothing ('cricket-np', 'cricket-order-np'). */
export const noPoints = (kind) => isCricket(kind) && String(kind).endsWith('-np');
export const kindOf = (m) => (m && KINDS.includes(m.kind) ? m.kind : '301');
/** Cricket's numbers, in the order "in order" closes them: 20 down to 15, then the bull (25). */
export const CRICKET = [20, 19, 18, 17, 16, 15, 25];
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

/** A fresh match. `starter` is the seat that throws first (0 or 1); `kind` one of KINDS. */
export function newMatch(starter = 0, kind = '301') {
  const s = starter === 1 ? 1 : 0;
  const k = KINDS.includes(String(kind)) ? String(kind) : '301';
  if (isCricket(k)) {
    return { kind: k, start: 0, scores: [0, 0], marks: [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]], turn: s, starter: s, turnStart: 0, darts: [], winner: null, turns: 0 };
  }
  const start = Number(k);
  return { kind: k, start, scores: [start, start], turn: s, starter: s, turnStart: start, darts: [], winner: null, turns: 0 };
}

/** Cricket: the index (into CRICKET) a seat must close next "in order", or -1 when all are closed. */
export function cricketNext(m, seat) {
  return m.marks[seat].findIndex((n) => n < 3);
}
/** Cricket: which CRICKET indexes a dart may MARK for `seat`. Any order: every open one. In order:
 *  only the one being worked on. A number already closed always takes points (if the other side
 *  has not closed it), in either variant. */
function cricketCounts(m, seat, i) {
  if (m.marks[seat][i] >= 3) return true;
  return inOrder(m.kind) ? cricketNext(m, seat) === i : true;
}

/** Throw one dart for the seat whose turn it is. Mutates and returns the match plus what happened:
 *    'score'  the dart counted and the turn goes on
 *    'end'    the dart counted and it was the third: the turn is over (call nextTurn)
 *    'bust'   (x01) it would have gone below zero: this turn's darts are void and the turn is over
 *    'win'    x01: exactly zero. Cricket: every number closed and at least as many points
 *  There is no double-out: any dart that lands exactly on zero wins.
 *  `hit` is the bed it landed in; in Cricket also `marks` (marks it added) and `pts` (points it
 *  scored, which is not the bed's value). */
export function throwDart(m, x, y) {
  if (m.winner != null) return { m, event: 'over', hit: null };
  if (isCricket(m.kind)) return throwCricket(m, x, y);
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

function throwCricket(m, x, y) {
  const bed = scoreAt(x, y);
  const me = m.turn, them = me ^ 1;
  const i = CRICKET.indexOf(bed.num);
  let marks = 0, pts = 0;
  if (i >= 0 && cricketCounts(m, me, i)) {
    const add = Math.min(bed.mult, 3 - m.marks[me][i]);
    m.marks[me][i] += add;
    marks = add;
    // Marks past the third score the number, unless the other side has closed it too (or the game
    // is played with no points).
    if (m.marks[them][i] < 3 && !noPoints(m.kind)) pts = (bed.mult - add) * CRICKET[i];
    m.scores[me] += pts;
  }
  const hit = { ...bed, marks, pts, counted: marks > 0 || pts > 0 };
  m.darts.push({ x, y, pts, ring: bed.ring, mk: marks });
  if (m.marks[me].every((n) => n >= 3) && m.scores[me] >= m.scores[them]) { m.winner = me; return { m, event: 'win', hit }; }
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
  if (m.kind == null) m.kind = '301';                  // saved before 2026-10-01: 301 was the only game
  if (!KINDS.includes(m.kind)) return null;
  const cricket = isCricket(m.kind);
  const okScore = cricket ? (v) => Number.isInteger(v) && v >= 0 && v <= 100000 : (v) => Number.isInteger(v) && v >= 0 && v <= 1001;
  if (!Array.isArray(m.scores) || m.scores.length !== 2 || !m.scores.every(okScore)) return null;
  if (m.turn !== 0 && m.turn !== 1) return null;
  if (!okScore(m.turnStart) || !okScore(m.start)) return null;
  if (cricket) {
    const okMarks = (a) => Array.isArray(a) && a.length === CRICKET.length && a.every((n) => Number.isInteger(n) && n >= 0 && n <= 3);
    if (!Array.isArray(m.marks) || m.marks.length !== 2 || !m.marks.every(okMarks)) return null;
  }
  if (!Array.isArray(m.darts) || m.darts.length > DARTS_PER_TURN) return null;
  for (const d of m.darts) if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;
  if (m.winner != null && m.winner !== 0 && m.winner !== 1) return null;
  return m;
}

// --- the computer --------------------------------------------------------------------------

/** How far a computer dart strays from where it aimed: the standard deviation of a 2D gaussian,
 *  in units of R. Hard groups tightly around the treble; Easy lands somewhere on the board. */
// 2026-10-02 (Matt: "A robot on medium just smoked me at cricket... He basically didn't miss"):
// medium was 0.17 (1.5 Cricket marks a turn, a strong pub player), now 0.24 (about 1.0). Easy and
// Hard moved with it to keep the steps even: easy 0.30 -> 0.36, hard 0.085 -> 0.10.
export const SPREAD = { easy: 0.36, medium: 0.24, hard: 0.10 };

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

/** Cricket: where the computer aims. Behind on points with a number it can score on (closed by it,
 *  open for the other side): score there. Otherwise close its next number (in order: the one it is
 *  on; any order: the highest still open). Easy never thinks about points. */
export function chooseCricketTarget(m, diff) {
  const me = m.turn, them = me ^ 1;
  const aim = (i) => (CRICKET[i] === 25 ? { num: 25, ring: 'bull' } : { num: CRICKET[i], ring: diff === 'easy' ? 'single' : 'treble' });
  const scoring = CRICKET.map((_, i) => i).filter((i) => m.marks[me][i] >= 3 && m.marks[them][i] < 3);
  const open = inOrder(m.kind) ? [cricketNext(m, me)].filter((i) => i >= 0) : CRICKET.map((_, i) => i).filter((i) => m.marks[me][i] < 3);
  if (diff !== 'easy' && !noPoints(m.kind) && scoring.length && (m.scores[me] < m.scores[them] || !open.length)) return aim(scoring[0]);
  if (open.length) return aim(open[0]);
  return { num: 25, ring: 'bull' };
}

/** Where the computer's next dart lands, and what it aimed at. `state` is the match (any game), or
 *  for 301-style games just the points left. */
export function computerThrow(state, diff, rnd = Math.random) {
  const tgt = typeof state === 'object' && state
    ? (isCricket(state.kind) ? chooseCricketTarget(state, diff) : chooseTarget(state.scores[state.turn], diff))
    : chooseTarget(state, diff);
  const p = targetPoint(tgt.num, tgt.ring);
  const s = SPREAD[diff] || SPREAD.medium;
  const [gx, gy] = gauss2(rnd);
  return { x: p.x + gx * s, y: p.y + gy * s, aim: tgt };
}

/** A short name for the bed a dart landed in: T20, D16, 7, 25, BULL. */
export function bedLabel(hit) {
  if (!hit) return '';
  if (hit.ring === 'bull') return 'BULL';
  if (hit.ring === 'obull') return '25';
  if (hit.ring === 'treble') return 'T' + hit.num;
  if (hit.ring === 'double') return 'D' + hit.num;
  if (hit.ring === 'single') return String(hit.num);
  return '';
}

// --- the player's flick --------------------------------------------------------------------

/** The flick speed (screen heights per second, upward) that lands at the height of the bull. */
// 2026-10-02 (Matt: "difficult for the human thrower to throw soft enough to hit the bottom of the
// board... I think the dart needs to feel heavier"): 2.3 -> 3.1, so the same flick lands about
// 0.6 R lower and the bottom of the board takes a flick a soft hand can actually make.
export const FLICK_MID = 3.1;
/** How many R the dart rises for each doubling of flick speed. Logarithmic, so a hard flick and a
 *  soft one are equally forgiving. */
export const FLICK_GAIN = 1.45;
/** How far above or below the bull a flick can land, in R: just off the board. */
export const FLICK_CAP = 1.5;
/** Below this the throw is not a throw: the dart drops back into the hand. */
export const FLICK_MIN = 0.55;

/** Where a flick lands, in board units. `ox, oy` is the dart's position at release, `vx, vy` the
 *  finger's velocity at release (both in board units and board units per second, y down), and
 *  `speed` the upward speed in screen heights per second. The dart flies along the flick's line,
 *  so swiping toward a number aims at it; the speed alone decides the height. Returns null for a
 *  flick too slow or not upward. */
export function flickLanding(ox, oy, vx, vy, speed, jitter = [0, 0]) {
  if (!(vy < 0) || !(speed >= FLICK_MIN)) return null;
  // A throw too soft (or too hard) to reach the board misses JUST past its edge, not far down the
  // wall: the flight drops onto that point, and a long drop read as sliding down the wall
  // (2026-10-02). Either way it is off the board (RING.frame is 1.27) and scores nothing.
  const y = Math.max(-FLICK_CAP, Math.min(FLICK_CAP, -FLICK_GAIN * Math.log2(speed / FLICK_MID) + jitter[1]));
  const x = ox + (vx / -vy) * (oy - y) + jitter[0];
  return { x, y };
}
