// pipes/js/game.js - the rules. Pure: no DOM, no timers, no randomness. `node pipes/js/test.js`
// drives this and generator.js without constructing a single element.
//
// THE WIN CONDITION IS FULL NET (2026-08-31; it was "path with no leaks" until then, and the old
// wording survived here for two commits after the code changed). Water floods from the inlet
// through joined openings. To win:
//
//   1. the water must reach EVERY pipe on the board, AND
//   2. nothing may leak - no opening pointing at a neighbour that does not open back, and none
//      pointing off the edge of the board.
//
// Rule 2 is what makes the animation mean something: a leak is a thing you can SEE spilling, at a
// specific cell, so "you are not finished" is shown on the board rather than announced in text.
// A leak is only ever REPORTED for a cell the water has reached, because a cell it has not reached
// yet is not spilling anything - but rule 1 means every cell has to be reached in the end, so
// nothing on the board is exempt from being got right.
import { DIRS, DX, DY, OPPOSITE, rotate, popcount, kindOf, generate, tierConfig, turnsBetween } from './generator.js';

/** The RULE generation stamped into every save. Bumped to 2 when the win condition became full
 *  net (2026-08-31); a v1 payload is a board built for the superseded rule. See `fromJSON`. */
export const SAVE_V = 2;

/**
 * Does this snapshot describe a board THIS generator would produce? Pure, and deliberately not a
 * solvability check: solvability is a property of the generator, and asking "is this the board its
 * own seed makes" catches every way a save can go stale, including ones nobody has thought of yet.
 */
function madeByThisGenerator(raw, n) {
  const built = generate(raw.tier, raw.seed >>> 0);
  if (built.w !== raw.w || built.h !== raw.h) return false;
  if (built.cells.length !== n) return false;
  if (built.src !== raw.src || built.dst !== raw.dst) return false;
  for (let i = 0; i < n; i++) {
    // A player can only ROTATE a piece, so a saved cell must be some rotation of the solution's.
    // turnsBetween returns -1 for two masks that are not rotations of each other.
    if (turnsBetween(raw.cells[i] & 15, built.solution[i]) < 0) return false;
  }
  return true;
}

export class PipesGame {
  /** @param {{ tier?: string, seed?: number, board?: object }} opts */
  constructor(opts = {}) {
    if (opts.board) this._adopt(opts.board);
    else this.newBoard(opts.tier || 'easy', opts.seed);
  }

  newBoard(tier, seed) {
    const s = seed === undefined ? (Math.floor(Math.random() * 0xffffffff) >>> 0) : (seed >>> 0);
    this._adopt(generate(tier, s));
    this.moves = 0;
    this.solvedAt = null;
    return this;
  }

  _adopt(b) {
    this.w = b.w; this.h = b.h;
    this.tier = b.tier; this.seed = b.seed;
    this.cells = Uint8Array.from(b.cells);
    this.src = b.src; this.dst = b.dst;
    this.minTurns = b.turns | 0;
    this.moves = b.moves | 0;
    this.solvedAt = b.solvedAt ?? null;
  }

  at(x, y) { return this.cells[y * this.w + x]; }
  index(x, y) { return y * this.w + x; }
  xy(i) { return [i % this.w, Math.floor(i / this.w)]; }

  /** Rotate one cell clockwise. Returns false for a cell nothing can turn, so the UI can decline
   *  to animate rather than pretending something happened. */
  turn(i) {
    if (this.solvedAt !== null) return false;
    const m = this.cells[i];
    // A cross has one rotation and a blank has none; turning either is a no-op the player would
    // read as an unresponsive tap, so it is refused and the UI can shake the tile instead.
    if (popcount(m) === 0 || popcount(m) === 4) return false;
    this.cells[i] = rotate(m);
    this.moves++;
    return true;
  }

  /**
   * Flood from the inlet. Returns { reached: Set<number>, order: number[], leaks: number[] }.
   *
   * `order` is breadth-first from the inlet and is what the water animation follows - the render
   * layer never has to work out the path itself, and so can never disagree with the rules about
   * where the water goes.
   */
  flow() {
    const reached = new Set([this.src]);
    const order = [this.src];
    const leaks = [];
    for (let qi = 0; qi < order.length; qi++) {
      const i = order[qi];
      const [x, y] = this.xy(i);
      const m = this.cells[i];
      for (const d of DIRS) {
        if (!(m & d)) continue;
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) { leaks.push(i); continue; }
        const ni = this.index(nx, ny);
        if (!(this.cells[ni] & OPPOSITE[d])) { leaks.push(i); continue; }
        if (reached.has(ni)) continue;
        reached.add(ni);
        order.push(ni);
      }
    }
    return { reached, order, leaks };
  }

  /**
   * Solved = the water reaches EVERY pipe on the board and nothing leaks.
   *
   * This used to be "reaches the outlet, and nothing on the water's network leaks", which made
   * every cell off that one path irrelevant - 52% of a Medium board was pieces the water could
   * never touch, and the player could finish having ignored most of what was in front of them.
   * Matt, shown a solved board of his with the whole right-hand side untouched: "Explain how this
   * board doesn't have dead ends or 'decoys'."
   *
   * Both halves are needed. Leak-free alone would accept a sealed loop sitting off on its own;
   * all-reached alone would accept a network spilling off the edge of the board.
   */
  isSolved() {
    const { reached, leaks } = this.flow();
    if (leaks.length) return false;
    for (let i = 0; i < this.cells.length; i++) {
      if (popcount(this.cells[i]) > 0 && !reached.has(i)) return false;
    }
    return true;
  }

  /** Call after a turn. Stamps `solvedAt` once, so the UI can fire the water run exactly once. */
  checkSolved(nowMs) {
    if (this.solvedAt !== null) return false;
    if (!this.isSolved()) return false;
    this.solvedAt = nowMs === undefined ? 0 : nowMs;
    return true;
  }

  /** Everything the stats layer needs. `level` is the tier's 1-4 index, mirroring Nuts & Bolts. */
  result() {
    return {
      tier: this.tier,
      level: tierConfig(this.tier) ? Math.max(1, ['easy', 'medium', 'hard', 'extraHard'].indexOf(this.tier) + 1) : 1,
      moves: this.moves,
      minTurns: this.minTurns,
      solved: this.solvedAt !== null,
    };
  }

  /** A plain, JSON-safe snapshot for the save key. Uint8Array does not survive JSON.
   *
   *  `v` IS THE RULE GENERATION, NOT A FILE FORMAT VERSION. It went to 2 when the win condition
   *  became full net (see `isSolved`), because a v1 payload is a board built for the OLD rule and
   *  is usually impossible under the new one - see `fromJSON`. */
  toJSON() {
    return {
      v: SAVE_V, w: this.w, h: this.h, tier: this.tier, seed: this.seed,
      cells: Array.from(this.cells), src: this.src, dst: this.dst,
      turns: this.minTurns, moves: this.moves, solvedAt: this.solvedAt,
    };
  }

  /** Rebuild from a snapshot. Returns null for anything malformed rather than throwing - a corrupt
   *  save must never stop the game mounting (root CLAUDE.md's profile rule, same reasoning).
   *
   *  IT ALSO REFUSES A BOARD THIS GENERATOR DID NOT MAKE, and that is the important half.
   *
   *  Matt, 2026-09-01, on a screenshot of a board he had visibly finished: "How is this not
   *  finished?" It was a MEDIUM board from the 2026-08-29 build, restored verbatim into the
   *  2026-08-31 full-net rule. Under the rule it was built with, joining the source to the drain
   *  without a leak WAS the win, and he had done it. Under full net it could never be finished:
   *  replaying the old generator out of git and testing 200 boards a tier against two NECESSARY
   *  conditions for any full-net solution (total openings even; openings/2 >= n-1 to span n cells;
   *  plus connectivity over the non-blank cells) says 155/200 Easy, 157/200 Medium, 135/200 Hard
   *  and 108/200 Expert were already unsolvable the moment that deploy landed. Those are LOWER
   *  bounds. He was turning pieces on a board with no solution, and nothing told him.
   *
   *  Two gates, cheapest first:
   *
   *  1. The rule generation (`v`). Every known legacy save is refused here, at no cost.
   *  2. RECONSTRUCTION, which is the part worth having. `generate(tier, seed)` is deterministic
   *     and returns the FINAL seed even when a quality gate makes it recurse, so a stored
   *     (tier, seed) reproduces its own board exactly. Regenerate it and require every saved cell
   *     to be a ROTATION of the regenerated solution cell - which is the only thing a player can
   *     do to a board. Anything else came from a different generator.
   *
   *  Gate 2 is self-maintaining: it invalidates a foreign save after ANY future generator, tier
   *  size or rule change, with nobody having to remember to bump a number. If a future generator
   *  is ever made non-deterministic this degrades to "always start a fresh board", which the tests
   *  say out loud rather than a player discovering it. Cost is one generate() on at most 70 cells.
   *
   *  NOTHING EARNED IS AT RISK HERE (THE LAW). This key holds a scratch board and nothing else:
   *  the only record of a solved board is `recordPipes()` in `gamehub.stats`, and the per-tier
   *  level is derived from it. Refusing an unsolvable board loses no history - it hands the player
   *  a board that can actually be finished. */
  static fromJSON(raw) {
    try {
      if (!raw || raw.v !== SAVE_V) return null;
      const n = (raw.w | 0) * (raw.h | 0);
      if (!n || !Array.isArray(raw.cells) || raw.cells.length !== n) return null;
      if (!(raw.src >= 0 && raw.src < n) || !(raw.dst >= 0 && raw.dst < n)) return null;
      if (!madeByThisGenerator(raw, n)) return null;
      return new PipesGame({ board: { ...raw, cells: Uint8Array.from(raw.cells) } });
    } catch { return null; }
  }
}

export { kindOf, popcount, rotate };
export default { PipesGame };
