// sudoku/js/game.js - the rules, state, conflicts, notes, undo, and the save shape. Pure: no
// DOM, no timers, no randomness (the puzzle itself is handed in already generated).
import { PEERS, UNITS, findNakedSingle } from './solver.js';

export const SAVE_V = 1;
const N = 81;

/** Notes are numbered 1-9 on `cellNotes` bitmasks (bit d-1 = digit d marked). Kept as a bitmask,
 *  not a Set, so the save shape ({digits...}) and equality checks stay trivial. */
function notesToDigits(mask) {
  const out = [];
  for (let d = 1; d <= 9; d++) if (mask & (1 << (d - 1))) out.push(d);
  return out;
}
function digitsToNotes(digits) {
  let mask = 0;
  for (const d of digits) if (d >= 1 && d <= 9) mask |= (1 << (d - 1));
  return mask;
}

export class SudokuGame {
  /** @param {{ tier: string, puzzle: Uint8Array|number[], solution: Uint8Array|number[] }} opts */
  constructor(opts) {
    this.tier = opts.tier;
    this.givens = Uint8Array.from(opts.puzzle);       // 0 where the player must fill
    this.solution = Uint8Array.from(opts.solution);
    this.cells = Uint8Array.from(opts.puzzle);         // current state; starts equal to givens
    this.notes = new Uint16Array(N);                   // bitmask per cell
    this.mistakes = 0;
    this.hints = 0;
    this.elapsedMs = 0;
    this.startedAt = opts.startedAt || Date.now();
    this.updatedAt = this.startedAt;
    this._undo = [];                                   // bounded stack of inverse ops
    this._solved = false;
  }

  isGiven(i) { return this.givens[i] !== 0; }
  isSolved() { return this._solved; }

  _snapshot(i) {
    return { i, cell: this.cells[i], notes: this.notes[i] };
  }
  _pushUndo(snap) {
    this._undo.push(snap);
    if (this._undo.length > 200) this._undo.shift();
  }

  /**
   * Place `d` in cell `i`. Tapping the cell's OWN current digit again CLEARS it (a toggle, not a
   * no-op) - the pattern every "tap a filled tile to remove it" control in this repo uses.
   * Returns { changed, mistake, cleared } - `mistake` is true exactly once, the moment a digit
   * that contradicts the SOLUTION is placed (never on every render), which is what "mistakes
   * counter" means throughout this game.
   */
  place(i, d) {
    if (this._solved || this.isGiven(i)) return { changed: false };
    if (d < 1 || d > 9) return { changed: false };
    if (this.cells[i] === d) {
      this._pushUndo(this._snapshot(i));
      this.cells[i] = 0;
      this.updatedAt = Date.now();
      return { changed: true, cleared: true };
    }
    const mistake = d !== this.solution[i];
    this._pushUndo(this._snapshot(i));
    this.cells[i] = d;
    this.notes[i] = 0;
    if (mistake) this.mistakes++;
    // Standard convenience: placing a digit removes it from the notes of every peer (row/col/box).
    for (const j of PEERS[i]) this.notes[j] &= ~(1 << (d - 1));
    this.updatedAt = Date.now();
    if (this._checkSolved()) this._solved = true;
    return { changed: true, mistake, solved: this._solved };
  }

  /** Erase a player-entered digit (givens are never erasable). */
  erase(i) {
    if (this._solved || this.isGiven(i) || this.cells[i] === 0) return false;
    this._pushUndo(this._snapshot(i));
    this.cells[i] = 0;
    this.updatedAt = Date.now();
    return true;
  }

  /** Toggle a pencil-mark digit on an empty, non-given cell. No-op on a filled or given cell. */
  toggleNote(i, d) {
    if (this._solved || this.isGiven(i) || this.cells[i] !== 0) return false;
    if (d < 1 || d > 9) return false;
    this._pushUndo(this._snapshot(i));
    this.notes[i] ^= (1 << (d - 1));
    this.updatedAt = Date.now();
    return true;
  }

  notesAt(i) { return notesToDigits(this.notes[i]); }

  /** Undo the last change (digit placement, erase, or note toggle), restoring both the cell's
   *  digit AND its notes to what they were - a placement clears notes, so undoing it must bring
   *  them back or the peers' cleared notes would look permanently lost. */
  undo() {
    const snap = this._undo.pop();
    if (!snap) return false;
    this.cells[snap.i] = snap.cell;
    this.notes[snap.i] = snap.notes;
    this._solved = false; // undoing out of a solved state always un-solves it
    this.updatedAt = Date.now();
    return true;
  }
  canUndo() { return this._undo.length > 0; }

  /**
   * Fill the selected cell (or, with none selected, the one cell the NAKED-SINGLE solver can
   * currently prove) with its correct digit. Counts as a hint even though the digit is always
   * correct - `hints` exists to measure how much help a solve used, not to gate anything.
   * Returns the filled index, or -1 if nothing was eligible (already solved, or no naked single
   * exists and none was selected).
   */
  hint(selectedIndex) {
    if (this._solved) return -1;
    let i = -1;
    if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && !this.isGiven(selectedIndex) && this.cells[selectedIndex] === 0) {
      i = selectedIndex;
    } else {
      i = findNakedSingle(this.cells);
    }
    if (i === -1) return -1;
    const d = this.solution[i];
    this._pushUndo(this._snapshot(i));
    this.cells[i] = d;
    this.notes[i] = 0;
    this.hints++;
    for (const j of PEERS[i]) this.notes[j] &= ~(1 << (d - 1));
    this.updatedAt = Date.now();
    if (this._checkSolved()) this._solved = true;
    return i;
  }

  /** Every cell holding its own conflicting peer (same digit twice in a row/col/box). Used for
   *  live highlighting; independent of `mistakes`, which counts against the SOLUTION, not
   *  against duplicate placements (a player can place two wrong-but-matching digits with no
   *  conflict at all, which is still two mistakes but zero conflicts). */
  conflictSet() {
    const bad = new Set();
    for (const unit of UNITS) {
      const seen = new Map();
      for (const i of unit) {
        const v = this.cells[i];
        if (!v) continue;
        if (seen.has(v)) { bad.add(i); bad.add(seen.get(v)); } else seen.set(v, i);
      }
    }
    return bad;
  }

  _checkSolved() {
    for (let i = 0; i < N; i++) if (this.cells[i] !== this.solution[i]) return false;
    return true;
  }

  /** Plain, JSON-safe snapshot for the save key. Uint8Array/Uint16Array do not survive JSON. */
  toSave() {
    return {
      v: SAVE_V,
      tier: this.tier,
      givens: Array.from(this.givens).join(''),
      solution: Array.from(this.solution).join(''),
      cells: Array.from(this.cells).join(''),
      notes: Array.from(this.notes, (m) => notesToDigits(m)),
      elapsedMs: this.elapsedMs | 0,
      mistakes: this.mistakes | 0,
      hints: this.hints | 0,
      undo: this._undo.slice(-200),
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
    };
  }

  /** Rebuild from a saved snapshot. Returns null for anything malformed rather than throwing -
   *  a corrupt save must never stop the game mounting (root CLAUDE.md's profile rule). */
  static fromSave(raw) {
    try {
      if (!raw || raw.v !== SAVE_V) return null;
      if (typeof raw.givens !== 'string' || raw.givens.length !== N) return null;
      if (typeof raw.solution !== 'string' || raw.solution.length !== N) return null;
      if (typeof raw.cells !== 'string' || raw.cells.length !== N) return null;
      if (!Array.isArray(raw.notes) || raw.notes.length !== N) return null;
      const toDigits = (s) => Uint8Array.from(s, (c) => {
        const d = c.charCodeAt(0) - 48;
        return d >= 0 && d <= 9 ? d : 0;
      });
      const g = new SudokuGame({
        tier: raw.tier,
        puzzle: toDigits(raw.givens),
        solution: toDigits(raw.solution),
        startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : Date.now(),
      });
      g.cells = toDigits(raw.cells);
      g.notes = Uint16Array.from(raw.notes, (arr) => digitsToNotes(Array.isArray(arr) ? arr : []));
      g.elapsedMs = Number.isFinite(raw.elapsedMs) ? raw.elapsedMs : 0;
      g.mistakes = Number.isFinite(raw.mistakes) ? raw.mistakes : 0;
      g.hints = Number.isFinite(raw.hints) ? raw.hints : 0;
      g._undo = Array.isArray(raw.undo) ? raw.undo.slice(-200) : [];
      g.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : g.startedAt;
      if (g._checkSolved()) g._solved = true;
      return g;
    } catch { return null; }
  }
}

export default { SudokuGame, SAVE_V };
