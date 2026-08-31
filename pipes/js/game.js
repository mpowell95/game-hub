// pipes/js/game.js - the rules. Pure: no DOM, no timers, no randomness. `node pipes/js/test.js`
// drives this and generator.js without constructing a single element.
//
// THE WIN CONDITION IS "PATH WITH NO LEAKS" (Matt's choice, 2026-08-29), and the leak half is the
// part worth reading. Water floods from the inlet through joined openings. To win:
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
import { DIRS, DX, DY, OPPOSITE, rotate, popcount, kindOf, generate, tierConfig } from './generator.js';

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

  /** A plain, JSON-safe snapshot for the save key. Uint8Array does not survive JSON. */
  toJSON() {
    return {
      v: 1, w: this.w, h: this.h, tier: this.tier, seed: this.seed,
      cells: Array.from(this.cells), src: this.src, dst: this.dst,
      turns: this.minTurns, moves: this.moves, solvedAt: this.solvedAt,
    };
  }

  /** Rebuild from a snapshot. Returns null for anything malformed rather than throwing - a corrupt
   *  save must never stop the game mounting (root CLAUDE.md's profile rule, same reasoning). */
  static fromJSON(raw) {
    try {
      if (!raw || raw.v !== 1) return null;
      const n = (raw.w | 0) * (raw.h | 0);
      if (!n || !Array.isArray(raw.cells) || raw.cells.length !== n) return null;
      if (!(raw.src >= 0 && raw.src < n) || !(raw.dst >= 0 && raw.dst < n)) return null;
      return new PipesGame({ board: { ...raw, cells: Uint8Array.from(raw.cells) } });
    } catch { return null; }
  }
}

export { kindOf, popcount, rotate };
export default { PipesGame };
