// Nuts & Bolts game state: legality, move application, undo, win detection.
// No DOM access here; ui.js owns rendering.

import { CAP, generateLevel, isSolved, isBoltComplete } from './generator.js';

function cloneStacks(stacks) {
  return stacks.map((s) => s.map((n) => ({ color: n.color, hidden: n.hidden, id: n.id })));
}

function topRun(stack) {
  if (!stack.length) return { length: 0, color: null };
  const color = stack[stack.length - 1].color;
  let len = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    // A still-hidden nut's true color is unknown to the player, so it can
    // never be swept into a run just because it happens to match the
    // revealed nut sitting on top of it. The run stops there; that nut only
    // becomes movable once it is itself revealed on some later top.
    if (stack[i].hidden) break;
    if (stack[i].color === color) len++;
    else break;
  }
  return { length: len, color };
}

// Exposed for ui.js so it can highlight exactly the nuts a selection lifts.
export function getTopRun(stack) {
  return topRun(stack);
}

export class NutsBoltsGame {
  constructor(tier, levelNumber, savedBoard, rampFrom) {
    this.tier = tier;
    this.level = levelNumber;
    if (savedBoard) {
      this.stacks = cloneStacks(savedBoard.stacks);
      this.initial = cloneStacks(savedBoard.initial);
      this.moves = savedBoard.moves || 0;
      this.history = savedBoard.history || [];
      this.revealedIds = new Set(savedBoard.revealedIds || []);
    } else {
      const gen = generateLevel(tier, levelNumber, rampFrom);
      this.stacks = gen.stacks;
      this.initial = gen.initial;
      this.moves = 0;
      this.history = [];
      this.revealedIds = new Set();
    }
    this.selected = null; // bolt index or null
    this.pl = []; this.t0 = Date.now(); this.res = savedBoard ? 1 : 0; this.undoN = 0; this.restartN = 0;   // private play log only (2026-11-16); never saved
  }

  _lg(e) { try { if (this.pl.length < 1500) this.pl.push(e + '@' + Math.round((Date.now() - this.t0) / 1000)); } catch { /* private log only */ } }
  /** The play's private data for the admin play log (`x`): the level's starting colours per bolt and every move, undo and restart. */
  privateLog() {
    return { tier: this.tier, level: this.level, start: this.initial.map((st) => st.map((n) => n.color).join('.')), seq: this.pl, moves: this.moves | 0, undos: this.undoN, restarts: this.restartN, secs: Math.round((Date.now() - this.t0) / 1000), res: this.res };
  }

  // A hidden nut, once revealed, stays revealed forever (including through
  // undo), so revealed identity is tracked outside the undo-able stack
  // snapshots and reapplied whenever `this.stacks` is replaced wholesale.
  applyRevealed() {
    for (const stack of this.stacks) {
      for (const nut of stack) {
        if (this.revealedIds.has(nut.id)) nut.hidden = false;
      }
    }
  }

  revealTop(stack) {
    if (!stack.length) return;
    const nut = stack[stack.length - 1];
    if (nut.hidden) {
      nut.hidden = false;
      this.revealedIds.add(nut.id);
    }
  }

  get boltCount() {
    return this.stacks.length;
  }

  select(index) {
    if (this.selected === index) {
      this.selected = null;
      return { changed: true };
    }
    if (this.selected === null) {
      const stack = this.stacks[index];
      if (!stack.length) return { changed: false, reason: 'empty' };
      if (isBoltComplete(stack)) return { changed: false, reason: 'locked' };
      this.selected = index;
      return { changed: true };
    }
    // A second tap on a different bolt attempts a move (destination may be empty).
    return this.tryMove(this.selected, index);
  }

  deselect() {
    this.selected = null;
  }

  // Returns { legal, reason, moved, from, to } and applies the move if legal.
  tryMove(from, to) {
    const source = this.stacks[from];
    const dest = this.stacks[to];

    if (from === to) {
      this.selected = null;
      return { legal: false, changed: true, reason: '' };
    }
    if (isBoltComplete(source)) {
      return { legal: false, changed: false, reason: 'locked' };
    }
    const run = topRun(source);
    if (run.length === 0) {
      this.selected = null;
      return { legal: false, changed: true, reason: 'empty' };
    }
    if (dest.length === CAP) {
      return { legal: false, changed: false, reason: 'full' };
    }
    const destTop = dest.length ? dest[dest.length - 1].color : null;
    if (dest.length && destTop !== run.color) {
      return { legal: false, changed: false, reason: 'color-mismatch' };
    }
    const freeSpace = CAP - dest.length;
    const count = Math.min(run.length, freeSpace);
    this.history.push({ stacks: cloneStacks(this.stacks), moves: this.moves });

    const moved = source.splice(source.length - count, count);
    dest.push(...moved);
    this.moves++;
    this._lg(from + '>' + to);
    this.selected = null;

    this.revealTop(source);

    return { legal: true, changed: true, isMove: true, from, to, count, color: run.color, won: this.isWon() };
  }

  isWon() {
    return isSolved(this.stacks);
  }

  canUndo() {
    return this.history.length > 0;
  }

  undo() {
    if (!this.history.length) return false;
    const prev = this.history.pop();
    this.stacks = prev.stacks;
    this.moves = prev.moves;
    this.undoN++; this._lg('u');
    this.selected = null;
    this.applyRevealed();
    return true;
  }

  restart() {
    this.restartN++; this._lg('r');
    this.stacks = cloneStacks(this.initial);
    this.moves = 0;
    this.history = [];
    this.revealedIds = new Set();
    this.selected = null;
  }

  hasProgress() {
    return this.moves > 0 && !this.isWon();
  }

  // Serializable snapshot for persistence.
  toSaved() {
    return {
      difficulty: this.tier,
      stacks: cloneStacks(this.stacks),
      initial: cloneStacks(this.initial),
      moves: this.moves,
      history: this.history,
      revealedIds: [...this.revealedIds],
    };
  }
}
