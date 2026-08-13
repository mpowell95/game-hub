// skeeball/js/game.js - the rules around the physics. physics.js owns what the ball DOES; this
// file owns the flick mapping, the rack of nine, the roaming x3, unlocking and the save.
//
// THE 2026-08-12 REWRITE. Matt: "Opus has had MAJOR issues with every aspect of the finger
// flick, to the speed of the ball - literally every aspect has been a disappointing failure
// regarding realistic physics." The abstraction stack was the failure: finger speed became a
// normalized "power", power became a table row, the table row became a canned animation. Every
// layer could lie to the next. All of it is gone:
//
//   finger release speed  ->  ball launch speed   (one multiplier, FLICK.MPS_PER_CHS)
//   finger swipe angle    ->  ball direction      (the angle itself, clamped to the lane)
//   everything after      ->  gravity and collisions (physics.js simulate)
//
// The ball on screen moves at the speed the simulation says it does at every instant, so a soft
// flick VISIBLY rolls slower, dies on the ramp, and comes back; a hard one visibly flies. There
// is no separate animation to keep honest.
//
// Deterministic on purpose: same flick, same result, always - the player is judging a throw, and
// a hidden dice roll on top of that judgement would make practice pointless. The rng below only
// moves the x3 badge between throws.

import { boardById, multTargetsFor, nextBoard, DEFAULT_BOARD } from './boards.js';
import { buildMachine, simulate } from './physics.js';

export const BALLS_PER_RACK = 9;          // the classic skeeball rack
export const MULTIPLIER = 3;              // the reference's badge is always x3

// --- the gesture --------------------------------------------------------------------------------
//
// The gesture READING survives from the previous build (it was the one half that worked): speed
// and angle sampled over the last ~100ms before release, in canvas heights per second so the feel
// is identical on any phone. What changed is the MAPPING: no blending, no "power curve" - the
// release speed IS the launch speed, times one constant.
export const FLICK = {
  /** Below this it was not a throw at all - a tap or a stray touch. Canvas heights/second. */
  MIN_SPEED: 0.55,
  /** Launch speed per unit of flick speed: m/s of ball per canvas-height/s of finger.
   *  Calibration (852px phone): a lazy 1.2 ch/s flick dies on the ramp and rolls back; ~1.8
   *  trickles into the basin; ~2.6 reaches the low cups; ~3.4 the 50; a 4.5+ snap is 100s
   *  territory and a flat-out slam hits the upper board and rains back down - all of that is
   *  the SIMULATION's answer to these launch speeds, pinned in test.js in these same units. */
  MPS_PER_CHS: 1.42,
  /** Launch speed clamps, m/s. The floor keeps a barely-valid gesture from being a null throw;
   *  the ceiling is a real arm's ceiling, and everything under it stays physical. */
  V_MIN: 1.2,
  V_MAX: 8.5,
  /** The swipe angle is used AS the throw direction, clamped to what the lane can accept. */
  MAX_DIR: 0.30,
};

/**
 * A swipe -> a throw. PURE.
 *
 * @param {{dx:number, dy:number, vx:number, vy:number}} g
 *   `d*` is the whole gesture's displacement, `v*` the velocity over the last ~100ms before
 *   release, all in CANVAS HEIGHTS (per second). Screen axes: UP is NEGATIVE y.
 * @returns {{v0:number, dir:number, speed:number}|null} null = not a throw.
 */
export function flickToThrow(g) {
  if (!g || ![g.dx, g.dy, g.vx, g.vy].every(Number.isFinite)) return null;
  const speed = Math.hypot(g.vx, g.vy);
  const movingUp = -g.vy > 0;
  const wentUp = -g.dy > 0;
  // A gesture with real speed must be travelling UP at release: yanking the finger back down is
  // a cancelled throw. A gesture that ended stationary falls back to where it went overall, so a
  // slow deliberate push still throws (gently).
  if (speed >= FLICK.MIN_SPEED ? !movingUp : !wentUp) return null;
  if (speed < FLICK.MIN_SPEED) return null;

  const v0 = Math.min(FLICK.V_MAX, Math.max(FLICK.V_MIN, speed * FLICK.MPS_PER_CHS));
  const ang = Math.atan2(g.vx, Math.max(1e-6, -g.vy));
  const dir = Math.max(-FLICK.MAX_DIR, Math.min(FLICK.MAX_DIR, ang));
  return { v0, dir, speed };
}

// --- machines, memoized -------------------------------------------------------------------------

const MACHINES = new Map();
export function machineFor(boardId) {
  if (!MACHINES.has(boardId)) MACHINES.set(boardId, buildMachine(boardById(boardId).geom));
  return MACHINES.get(boardId);
}

/** One throw against one machine: the simulation, verbatim. Kept as a named export so tests and
 *  the how-to screen drive the exact code the game plays. */
export function throwSim(boardId, v0, dir) {
  return simulate(v0, dir, machineFor(boardId));
}

/**
 * Find a (v0, dir) that lands a named ring, by searching the real simulation - there is no
 * closed form over a physics engine, and inventing one is how aim guides start lying.
 * Coarse grid, then refined around the first hit. Cached per board+target.
 */
const IDEALS = new Map();
export function findThrow(targetId, boardId = DEFAULT_BOARD) {
  const key = `${boardId}/${targetId}`;
  if (IDEALS.has(key)) return IDEALS.get(key);
  const M = machineFor(boardId);
  const ring = M.rings.find((r) => r.id === targetId);
  // The ball drifts laterally for the WHOLE flight, not just the lane, so the direct-line angle
  // to the ring over the full travel is the right first guess.
  const dir0 = ring ? Math.atan2(ring.c[0], M.B.z + 0.6) : 0;
  let best = null;
  outer:
  for (let v = 2.0; v <= 7.5; v += 0.05) {
    for (let i = 0; i <= 16; i++) {
      const dd = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.01;
      const dir = dir0 + dd;
      const res = simulate(v, dir, M);
      if (res.outcome.target === targetId) { best = { v0: v, dir }; break outer; }
    }
  }
  IDEALS.set(key, best);
  return best;
}

// --- one game ------------------------------------------------------------------------------------

/** One rack of BALLS_PER_RACK balls on one machine. No opponent: the score IS the game. */
export class Game {
  constructor(opts = {}) {
    const o = opts || {};
    this.board = boardById(o.board || DEFAULT_BOARD);
    this.rng = typeof o.rng === 'function' ? o.rng : Math.random;

    this.ball = 1;                 // 1..BALLS_PER_RACK
    this.score = 0;
    this.over = false;
    // Per-game tallies the stats recorder reads. Kept here rather than in the UI so a restored
    // save carries them instead of restarting at zero.
    this.tally = { balls: 0, hundreds: 0, fifties: 0, bestThrow: 0 };
    this.multTargets = multTargetsFor(this.board);
    this.multTarget = null;
    this.rollMultiplier();
  }

  /** Move the badge before every throw, as the reference does. */
  rollMultiplier() {
    const list = this.multTargets;
    this.multTarget = list.length ? list[Math.floor(this.rng() * list.length)] : null;
    return this.multTarget;
  }

  /** Resolve one throw by SIMULATION, apply it, advance the rack.
   *  @returns the sim result plus `scored` (after the multiplier), `multiplied`, `ballNo`. */
  throwBall(v0, dir) {
    if (this.over) return null;
    const sim = throwSim(this.board.id, v0, dir);
    const out = sim.outcome;
    const multiplied = !!(out.target && out.target === this.multTarget);
    const scored = out.points * (multiplied ? MULTIPLIER : 1);
    this.score += scored;

    this.tally.balls += 1;
    if (out.points >= 100) this.tally.hundreds += 1;
    if (out.points === 50) this.tally.fifties += 1;
    this.tally.bestThrow = Math.max(this.tally.bestThrow, scored);

    const result = { ...out, scored, multiplied, ballNo: this.ball, sim };
    if (this.ball < BALLS_PER_RACK) { this.ball += 1; this.rollMultiplier(); }
    else { this.over = true; }
    return result;
  }

  get ballsLeft() { return this.over ? 0 : BALLS_PER_RACK - this.ball + 1; }

  /** The board this game's score would unlock, or null. Read AFTER the game is over. */
  unlocks() {
    const nxt = nextBoard(this.board.id);
    return nxt && this.score >= nxt.unlockScore ? nxt : null;
  }

  /** Everything needed to rebuild this game. The rng is deliberately NOT captured: a restored
   *  game re-rolls its multipliers from a fresh stream, which changes nothing a player could
   *  notice and keeps the save plain JSON. Same v2 shape as before the physics rewrite - the
   *  save never held throw internals, so nothing about it changes. */
  snapshot() {
    return {
      v: 2, board: this.board.id, ball: this.ball, score: this.score,
      over: this.over, tally: { ...this.tally }, multTarget: this.multTarget,
    };
  }

  /** Rebuild from a snapshot. Returns null (never throws) on anything malformed, so a corrupt,
   *  truncated or OLD-SHAPE save can only ever mean "no game to resume", never a crash on mount. */
  static restore(snap, rng) {
    try {
      if (!snap || snap.v !== 2) return null;
      const g = new Game({ board: snap.board, rng });
      g.ball = Math.min(BALLS_PER_RACK, Math.max(1, snap.ball | 0));
      g.score = Math.max(0, snap.score | 0);
      g.over = !!snap.over;
      g.tally = {
        balls: Math.max(0, snap.tally?.balls | 0),
        hundreds: Math.max(0, snap.tally?.hundreds | 0),
        fifties: Math.max(0, snap.tally?.fifties | 0),
        bestThrow: Math.max(0, snap.tally?.bestThrow | 0),
      };
      if (g.multTargets.includes(snap.multTarget)) g.multTarget = snap.multTarget;
      return g;
    } catch { return null; }
  }
}

export default { Game, flickToThrow, throwSim, findThrow, machineFor, BALLS_PER_RACK, MULTIPLIER };
