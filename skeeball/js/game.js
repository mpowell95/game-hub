// skeeball/js/game.js - the pure Skeeball engine. No DOM, no timers, no randomness of its own
// beyond the injected `rng`, so `js/test.js` can drive a whole game headlessly and the UI can
// replay any throw for animation without asking the engine twice.
//
// THE ONE IDEA WORTH UNDERSTANDING: a throw is resolved from two numbers and nothing else.
//
//   power  0..1   how hard it was flicked  -> how far up the board it gets
//   aim   -1..1   how far off straight     -> where across the board it arrives
//
// `resolveThrow(power, aim, board)` is a PURE function of those, with **no random scatter at all**.
// That is deliberate and it is the whole game: the player is judging a flick, and a hidden dice
// roll on top of their judgement would make practice pointless. It also means the animation the UI
// draws is derived from the same resolved numbers, so what the ball is drawn doing and what the
// scoreboard says can never disagree.
//
// WHAT CHANGED (2026-08-11, Matt): the computer opponent is GONE and boards replaced difficulty
// tiers. A game is now nine balls against the scoreboard - your own all-time best, your best today,
// and the app-wide record for that machine - and the ladder is unlocking machines by hitting a
// target score. The old easy/medium/hard AI and its whole-match tuning are deleted; the reasoning
// they were tuned against is preserved in skeeball/CLAUDE.md, and every play recorded under those
// difficulty buckets is untouched in the stats store (THE LAW rule 5).
//
// A board's difficulty IS its target layout (js/boards.js). Throws resolve against target ellipses
// in BOARD SPACE, so a new machine is a data entry, never a new code path here.

import { boardById, multTargetsFor, nextBoard, DEFAULT_BOARD } from './boards.js';

export const BALLS_PER_RACK = 9;          // the classic skeeball rack

export const MULTIPLIER = 3;              // the reference's badge is always x3

// --- the gesture ------------------------------------------------------------------------------
//
// HOW A SWIPE BECOMES A THROW. Matt, 2026-08-11: "The flick is really bad... it's just really bad
// and unnatural. Can you look into what other games do? Like game pigeon's beer pong game or other
// darts games?"
//
// Those games were the answer. Cup Pong keys on how FAST you swipe ("cup 2 requires a medium speed
// swipe, cup 4 the same direction with a slightly faster swipe"); mobile darts games map "the speed
// and angle of your finger" to the throw. Neither uses the thing this game used, which was:
//
//     power = total vertical distance from the touch-down point, over the whole gesture
//     aim   = total horizontal distance from that same point
//
// Four things follow from that, and together they are the "unnatural":
//
//   1. SPEED DID NOTHING. A slow, deliberate drag to the top threw exactly as hard as a snap
//      flick. Throwing is an act of acceleration; a model that ignores acceleration cannot feel
//      like throwing however well its numbers are tuned.
//   2. YOU COULD NOT WIND UP. Pulling back before the throw REDUCED power, because power was net
//      displacement from where you first touched. The natural motion actively hurt you.
//   3. AIM WAS OFFSET, NOT ANGLE. Drifting 30px right is 4 degrees on a long flick and 17 on a
//      short one, but both produced the same aim. So the same visible swipe direction sent the
//      ball somewhere different depending on how hard you threw - the ball did not go where you
//      pointed, which is the single most disorienting thing a throwing game can do.
//   4. RELEASE WAS NOT A MOMENT. The value at pointerup was used even if your finger had been
//      parked for a second. Android's VelocityTracker exists precisely because only the last
//      ~100ms of a gesture describes a fling.
//
// So the gesture is now speed-and-angle, sampled over a short window at release. `flickToThrow`
// is the whole mapping and it is PURE, so `test.js` can drive realistic gestures through it - the
// gesture is half of the difficulty and it used to be the half no test could see.
export const FLICK = {
  /** Release speeds, in CANVAS HEIGHTS PER SECOND, so the feel is identical on any phone.
   *  Rough human calibration on an 852px screen: a gentle flick is ~1.5, an ordinary one ~2.8,
   *  a hard one ~4.5. Below MIN it was not a throw at all. */
  MIN_SPEED: 0.9,
  MAX_SPEED: 5.0,
  /** How far a full-scale swipe travels, in canvas heights. Only the distance TERM uses this. */
  REACH: 0.55,
  /** How much of the power comes from SPEED rather than distance. Speed dominates - that is the
   *  whole point - but distance is deliberately not zero: a long controlled push should still be
   *  a real throw, which is what keeps the game precise rather than twitchy. */
  SPEED_W: 0.65,
  /** Swipe angle off vertical, in radians, for full aim (~31 degrees). Constant regardless of how
   *  hard you throw, which is fix 3 above.
   *
   *  This number IS the sideways difficulty, and the units to judge it in are degrees of wander a
   *  hand can hold: tolerance = (cup rx / LATERAL_GAIN) x MAX_ANGLE. At 0.42 the 50 allowed +-4.0
   *  degrees and the 100s wanted a 16-degree diagonal, which measured out as a coin toss on the
   *  back two cups. At 0.55 the cups allow +-5.2 to +-7.4 degrees and a 100 asks for a deliberate
   *  20-degree diagonal - still clearly a skill shot, but one you can aim at. */
  MAX_ANGLE: 0.32,
  /** Below this the gesture is discarded rather than thrown - a tap, or a stray touch. */
  MIN_POWER: 0.05,
};

/**
 * A swipe -> a throw. PURE.
 *
 * All four inputs are in CANVAS HEIGHTS (and heights/second), including the x ones: normalising
 * both axes by the same number is what makes `atan2` below a real screen angle rather than a
 * number that happens to grow when you move sideways.
 *
 * @param {{dx:number, dy:number, vx:number, vy:number}} g
 *   `d*` is the whole gesture's displacement, `v*` the velocity over the last few samples before
 *   release. Screen axes, so UP is NEGATIVE y.
 * @returns {{power:number, aim:number, speed:number, angle:number}|null} null = not a throw.
 */
export function flickToThrow(g) {
  if (!g || ![g.dx, g.dy, g.vx, g.vy].every(Number.isFinite)) return null;
  const speed = Math.hypot(g.vx, g.vy);
  const dist = Math.hypot(g.dx, g.dy);
  const movingUp = -g.vy > 0;
  const wentUp = -g.dy > 0;

  // A gesture with real speed must be travelling UP at the moment of release: yanking the finger
  // back down at the end is a cancelled throw, not a hard one. A gesture with no speed left falls
  // back to where it went overall, so a slow deliberate push still throws (gently).
  if (speed >= FLICK.MIN_SPEED ? !movingUp : !wentUp) return null;

  const sTerm = clamp((speed - FLICK.MIN_SPEED) / (FLICK.MAX_SPEED - FLICK.MIN_SPEED), 0, 1);
  const dTerm = clamp(dist / FLICK.REACH, 0, 1);
  const power = clamp(FLICK.SPEED_W * sTerm + (1 - FLICK.SPEED_W) * dTerm, 0, 1);
  if (power < FLICK.MIN_POWER) return null;

  // The angle of the swipe at release (or of the whole gesture, if it ended stationary).
  const useVel = speed >= FLICK.MIN_SPEED;
  const ax = useVel ? g.vx : g.dx;
  const ay = useVel ? -g.vy : -g.dy;
  const angle = Math.atan2(ax, Math.max(1e-6, ay));
  return { power, aim: clamp(angle / FLICK.MAX_ANGLE, -1, 1), speed, angle };
}

// --- the throw model ------------------------------------------------------------------------
//
// `power` maps to how far UP the board the ball arrives, `aim` to where across. Both are then
// tested against the board's own target ellipses. The two constants below are the whole feel of
// the game and are shared by every board, so a machine can never be "the one where the flick works
// differently" - only where the targets are.

// THESE TWO ARE NOT JUDGED AS FRACTIONS. On its own "SHORT_BELOW = 0.28" says nothing; run through
// `flickToThrow` it says "a quarter of every flick you make scores exactly zero", which is what it
// used to mean and what Matt's recordings of that build show happening over and over. The units
// that matter are the ones a hand controls - flick SPEED - and `test.js`'s "a HAND can actually hit
// these" block is where they are checked.
//
// The old pair (0.28 / 0.94) spent 34% of the power range scoring NOTHING, split between a dead
// zone at the bottom and "Too hard!" at the top. Nothing about that is skill: a throw that falls
// short of the 20 should trickle into the 10, which is what the real machine does.
export const SHORT_BELOW = 0.10;      // never made it up the ramp: rolls back, scores nothing
export const OVER_ABOVE = 0.96;       // straight over the back of the board

// Arrival depth in board space (0 = front lip, 1 = back wall) for a given arrival energy. The
// usable energy window maps onto the full depth of the board.
const depthFor = (e) => (e - SHORT_BELOW) / (OVER_ABOVE - SHORT_BELOW);

// How far off centre a given aim drifts by the time the ball reaches the board. >1 means a
// full-tilt flick reaches the rail and banks off it, which is a legitimate (if lossy) way to line
// up a wide target.
//
// In BOARD-SPACE x per unit of aim (see RAIL_X above for why board space). Full aim puts the ball
// just past the rail, so the extreme swipe grazes it; everything short of that is a clean diagonal.
// Judged in DEGREES of swipe angle via FLICK.MAX_ANGLE, and those tolerances do not change with
// how hard you throw.
export const LATERAL_GAIN = 0.63;
const BOUNCE_LOSS = 0.13;      // energy a wall bounce costs, per bounce

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Where a throw ends up on a given board. PURE - no rng, see the header.
 *
 * @param {number} power 0..1
 * @param {number} aim  -1..1 (negative = left)
 * @param {object} board a js/boards.js descriptor
 * @returns {{target: string|null, kind: string, points: number, x: number, y: number,
 *            offset: number, energy: number, bounces: number}}
 *   `target` is null only when nothing was scored; `kind` is why, for the UI's callout
 *   ('hit' | 'short' | 'over' | 'miss'); `x`/`y` are the resolved board-space landing point, handed
 *   back so the renderer can animate the exact throw that was scored.
 */
/**
 * THE RAILS, in board-space x. The lane is NARROWER than the bowl it feeds - measurably so, and
 * the reference cabinet is the same - so the rails do not sit at board x +-1; they sit where the
 * lane's top edge does, which is 118.3 / 192.0 of the bowl's half-width.
 *
 * **The whole lateral model is in BOARD space because of this.** It used to be in lane-fractions:
 * a ball at 85% of the lane's width was handed to the bowl as 85% of the BOWL's width, which is a
 * different, wider place - so crossing the ramp teleported it 63px further out. On a banked throw
 * that outward sweep was three times the size of the bounce and completely hid it. Matt: "It
 * bounces off the wall, but then continues on the line it originally was on - as if it didn't
 * bounce off the wall."
 *
 * Keep this in step with render.js's geometry; `test.js` asserts the two agree.
 */
export const RAIL_X = 0.6162;

/**
 * Where an aimed throw is, in BOARD-SPACE x, when it has travelled `v` of the way up the lane.
 * `+-RAIL_X` are the rails and the path FOLDS off them - a wide throw banks.
 *
 * **This is the only implementation of that fold, and it must stay that way.** There have been
 * three copies of it: this one, the aim guide's, and the ball animation's. Two of them kept a
 * hardcoded `1.35` after LATERAL_GAIN moved to 1.15, so the dashed guide promised a bank the ball
 * would not take, and the ball itself was drawn bending at the wrong place and then snapping
 * sideways onto the real landing point. Matt saw the second one: "it bounces off the wall, but
 * then continues on the line it originally was on - as if it didn't bounce off the wall."
 *
 * @returns {{u:number, bounces:number}} u is the offset, -1..1.
 */
export function laneOffsetAt(aim, v) {
  const a = clamp(Number.isFinite(aim) ? aim : 0, -1, 1);
  let u = a * LATERAL_GAIN * clamp(Number.isFinite(v) ? v : 0, 0, 1);
  let bounces = 0;
  while (Math.abs(u) > RAIL_X && bounces < 4) {
    u = Math.sign(u) * (2 * RAIL_X - Math.abs(u));
    bounces += 1;
  }
  return { u, bounces };
}

export function resolveThrow(power, aim, board) {
  const b = board && board.targets ? board : boardById(DEFAULT_BOARD);
  const p = clamp(Number.isFinite(power) ? power : 0, 0, 1);
  const a = clamp(Number.isFinite(aim) ? aim : 0, -1, 1);

  // Drift across the lane, folding at the rails. A wild throw can bank more than once.
  const { u, bounces } = laneOffsetAt(a, 1);
  const energy = Math.max(0, p - bounces * BOUNCE_LOSS);
  const miss = (kind) => ({ target: null, kind, points: 0, x: u, y: kind === 'over' ? 1 : 0, offset: u, energy, bounces });

  if (energy < SHORT_BELOW) return miss('short');
  if (energy > OVER_ABOVE) return miss('over');

  const y = clamp(depthFor(energy), 0, 1);
  // First target containing the point wins, which is why boards.js orders small-and-valuable
  // first and the catch-all ring last.
  for (const t of b.targets) {
    const dx = (u - t.x) / t.rx;
    const dy = (y - t.y) / t.ry;
    if (dx * dx + dy * dy <= 1) {
      return { target: t.id, kind: 'hit', points: t.points, x: u, y, offset: u, energy, bounces };
    }
  }
  return { target: null, kind: 'miss', points: 0, x: u, y, offset: u, energy, bounces };
}

/** The (power, aim) that lands dead centre of a named target - used by tests and by the how-to
 *  screen's worked example. Inverts `depthFor`. */
export function idealThrow(targetId, board) {
  const b = board && board.targets ? board : boardById(DEFAULT_BOARD);
  const t = b.targets.find((x) => x.id === targetId) || b.targets[b.targets.length - 1];
  const energy = t.y * (OVER_ABOVE - SHORT_BELOW) + SHORT_BELOW;
  return { power: clamp(energy, 0, 1), aim: clamp(t.x / LATERAL_GAIN, -1, 1) };
}

// --- one game ----------------------------------------------------------------------------------

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

  /** Resolve one throw, apply it, advance the rack.
   *  @returns the throw result plus `scored` (after the multiplier) and `multiplied`. */
  throwBall(power, aim) {
    if (this.over) return null;
    const res = resolveThrow(power, aim, this.board);
    const multiplied = !!(res.target && res.target === this.multTarget);
    const scored = res.points * (multiplied ? MULTIPLIER : 1);
    this.score += scored;

    this.tally.balls += 1;
    if (res.points >= 100) this.tally.hundreds += 1;
    if (res.points === 50) this.tally.fifties += 1;
    this.tally.bestThrow = Math.max(this.tally.bestThrow, scored);

    const out = { ...res, scored, multiplied, ballNo: this.ball };
    if (this.ball < BALLS_PER_RACK) { this.ball += 1; this.rollMultiplier(); }
    else { this.over = true; }
    return out;
  }

  get ballsLeft() { return this.over ? 0 : BALLS_PER_RACK - this.ball + 1; }

  /** The board this game's score would unlock, or null. Read AFTER the game is over. */
  unlocks() {
    const nxt = nextBoard(this.board.id);
    return nxt && this.score >= nxt.unlockScore ? nxt : null;
  }

  /** Everything needed to rebuild this game. The rng is deliberately NOT captured: a restored game
   *  re-rolls its multipliers from a fresh stream, which changes nothing a player could notice and
   *  keeps the save plain JSON. */
  snapshot() {
    return {
      v: 2, board: this.board.id, ball: this.ball, score: this.score,
      over: this.over, tally: { ...this.tally }, multTarget: this.multTarget,
    };
  }

  /** Rebuild from a snapshot. Returns null (never throws) on anything malformed, so a corrupt,
   *  truncated or OLD-SHAPE save can only ever mean "no game to resume", never a crash on mount.
   *  A v1 save (the vs-computer build) is deliberately not resumable - it has an opponent and
   *  difficulty this build has no concept of - but its recorded HISTORY is untouched in the stats
   *  store either way; only the half-finished match is dropped. */
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

export default { Game, resolveThrow, idealThrow, BALLS_PER_RACK, MULTIPLIER };
