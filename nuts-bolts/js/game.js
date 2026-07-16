// Nuts & Bolts game state: legality, move application, undo, win detection.
// No DOM access here; ui.js owns rendering.

import { CAP, generateLevel, isSolved } from './generator.js';

function cloneStacks(stacks) {
  return stacks.map((s) => s.map((n) => ({ color: n.color, hidden: n.hidden, id: n.id })));
}

function topRun(stack) {
  if (!stack.length) return { length: 0, color: null };
  const color = stack[stack.length - 1].color;
  let len = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].color === color) len++;
    else break;
  }
  return { length: len, color };
}

// Exposed for ui.js so it can highlight exactly the nuts a selection lifts.
export function getTopRun(stack) {
  return topRun(stack);
}

function isBoltFull(stack) {
  return stack.length === CAP && stack.every((n) => n.color === stack[0].color);
}

export class NutsBoltsGame {
  constructor(levelNumber, savedBoard) {
    this.level = levelNumber;
    if (savedBoard) {
      this.stacks = cloneStacks(savedBoard.stacks);
      this.initial = cloneStacks(savedBoard.initial);
      this.moves = savedBoard.moves || 0;
      this.history = savedBoard.history || [];
      this.revealedIds = new Set(savedBoard.revealedIds || []);
    } else {
      const gen = generateLevel(levelNumber);
      this.stacks = gen.stacks;
      this.initial = gen.initial;
      this.moves = 0;
      this.history = [];
      this.revealedIds = new Set();
    }
    this.selected = null; // bolt index or null
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
      if (!stack.length) return { changed: false, reason: 'That bolt is empty' };
      if (isBoltFull(stack)) return { changed: false, reason: 'That bolt is locked' };
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
    if (isBoltFull(source)) {
      return { legal: false, changed: false, reason: 'That bolt is locked' };
    }
    const run = topRun(source);
    if (run.length === 0) {
      this.selected = null;
      return { legal: false, changed: true, reason: 'That bolt is empty' };
    }
    if (isBoltFull(dest)) {
      return { legal: false, changed: false, reason: 'That bolt is full' };
    }
    const destTop = dest.length ? dest[dest.length - 1].color : null;
    if (dest.length && destTop !== run.color) {
      return { legal: false, changed: false, reason: "Colors don't match" };
    }
    const freeSpace = CAP - dest.length;
    if (freeSpace <= 0) {
      return { legal: false, changed: false, reason: 'That bolt is full' };
    }

    const count = Math.min(run.length, freeSpace);
    this.history.push({ stacks: cloneStacks(this.stacks), moves: this.moves });

    const moved = source.splice(source.length - count, count);
    dest.push(...moved);
    this.moves++;
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
    this.selected = null;
    this.applyRevealed();
    return true;
  }

  restart() {
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
      stacks: cloneStacks(this.stacks),
      initial: cloneStacks(this.initial),
      moves: this.moves,
      history: this.history,
      revealedIds: [...this.revealedIds],
    };
  }
}
