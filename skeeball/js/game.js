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

// FLICK CALIBRATION. These live HERE, not in ui.js, because they are half of the throw model:
// SHORT_BELOW/OVER_ABOVE and every target's `ry` only mean something multiplied through them.
// ui.js imports them to read the gesture, and js/test.js imports them to convert the whole model
// back into the pixels a thumb has to travel. They were in ui.js when both bad tunings shipped,
// which is exactly why nothing could check them together.
export const POWER_SPAN = 0.55;   // a flick up 55% of the canvas height is full power
export const AIM_SPAN = 0.42;     // ...and 42% across is full aim
export const MULTIPLIER = 3;              // the reference's badge is always x3

// --- the throw model ------------------------------------------------------------------------
//
// `power` maps to how far UP the board the ball arrives, `aim` to where across. Both are then
// tested against the board's own target ellipses. The two constants below are the whole feel of
// the game and are shared by every board, so a machine can never be "the one where the flick works
// differently" - only where the targets are.

// THESE FOUR NUMBERS ARE IN FLICK-PIXELS, and that is the only way to judge them. On its own,
// "SHORT_BELOW = 0.28" says nothing; multiplied through ui.js's POWER_SPAN and a phone's screen
// height it says "28% of every flick you make scores exactly zero", which is what it used to mean
// and which is what Matt's recordings of that build show happening over and over.
//
//     px = value * POWER_SPAN(0.55) * screenHeight(852 on an iPhone 15)
//
//   SHORT_BELOW 0.10 ->  47px   a flick shorter than this genuinely was not a throw
//   OVER_ABOVE  0.96 -> 450px   a heave more than half the screen long: rare, and earned
//   usable band          403px  which the four cups and the 10 divide up (js/boards.js)
//
// The old pair (0.28 / 0.94) spent 34% of the whole range on scoring NOTHING, split between a
// dead zone at the bottom and "Too hard!" at the top. Nothing about that is skill: a throw that
// falls short of the 20 should trickle into the 10, which is what the real machine does.
export const SHORT_BELOW = 0.10;      // never made it up the ramp: rolls back, scores nothing
export const OVER_ABOVE = 0.96;       // straight over the back of the board

// Arrival depth in board space (0 = front lip, 1 = back wall) for a given arrival energy. The
// usable energy window maps onto the full depth of the board.
const depthFor = (e) => (e - SHORT_BELOW) / (OVER_ABOVE - SHORT_BELOW);

// How far off centre a given aim drifts by the time the ball reaches the board. >1 means a
// full-tilt flick reaches the rail and banks off it, which is a legitimate (if lossy) way to line
// up a wide target.
//
// Also flick-pixels, against ui.js's AIM_SPAN (0.42) and a 393px-wide phone: staying inside the
// 20 cup (rx 0.27) allows 0.27/1.15 * 165 = 39px of sideways wander, and a 100 (x +-0.72,
// rx 0.115) needs a deliberate 87-120px diagonal. At the old 1.35/0.30 pairing the 20 allowed
// 18px, so "throw it straight" was not something a thumb could actually do.
export const LATERAL_GAIN = 1.15;
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
export function resolveThrow(power, aim, board) {
  const b = board && board.targets ? board : boardById(DEFAULT_BOARD);
  const p = clamp(Number.isFinite(power) ? power : 0, 0, 1);
  const a = clamp(Number.isFinite(aim) ? aim : 0, -1, 1);

  // Drift across the lane, folding at the rails. A wild throw can bank more than once.
  let u = a * LATERAL_GAIN;
  let bounces = 0;
  while (Math.abs(u) > 1 && bounces < 4) {
    u = Math.sign(u) * (2 - Math.abs(u));
    bounces += 1;
  }
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
