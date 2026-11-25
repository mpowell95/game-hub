// js/trip-wires/sudoku.js - Sudoku's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Sudoku's answers sat on `window` (the
// test seam `__sdTest.game`) until 2026-11-24, so these look for a solver.
//
// What the log holds (sudoku/js/game.js `privateLog`): `givens`, `final` (81 digits each), `ev` = every change made on THIS
// game object, [kind, cell, digit, t]: d digit, x wrong digit, c cleared, e erase, n note, u undo, h hint (`_lg`, never
// saved: a resumed puzzle, `res` 1, starts a new list); from 2026-11-25 t = ms on the running clock (`tu: 'ms'`, at most
// 900 entries, `cut` counts the rest); before it, seconds of a clock banked only at pauses.

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const evOf = (x) => (x && Array.isArray(x.ev) && (x.cut | 0) === 0 && x.ev.length < 900 ? x.ev.filter(Array.isArray) : null);
const solved = (x) => x && typeof x.final === 'string' && x.final.length === 81 && !x.final.includes('0');

export default [
  {
    // Every logged change is one call of place / erase / toggleNote / undo / hint (game.js), each from one tap on a digit,
    // Erase, Notes-mode digit, Undo or Hint button, or one key. No call changes two cells. A puzzle makes no other result
    // while it is open, so the touch log covers this game object's whole list.
    id: 'sudoku-entries-without-presses',
    text: 'more digits entered than real touches',
    proven: true,
    check(e, ctx) {
      const ev = evOf(ctx.x), p = presses(ctx.n);
      if (!ev || p == null || e.f !== 'recordSudoku') return null;
      return ev.length > p ? { v: `${ev.length} entries, ${p} touches`, lim: p } : null;
    },
  },
  {
    // A cell changes only through place (logged d/x/c), erase (e), undo (u, back to a value the log already shows), or hint
    // (h). On a puzzle opened fresh (`res` 0) every cell the player filled must have a d or h line of its own digit.
    id: 'sudoku-filled-without-entry',
    text: 'a solved square that was never filled in',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, ev = evOf(x);
      if (!ev || e.f !== 'recordSudoku' || (x.res | 0) !== 0 || !solved(x) || typeof x.givens !== 'string' || x.givens.length !== 81) return null;
      const put = new Set(ev.filter((q) => q[0] === 'd' || q[0] === 'h').map((q) => `${q[1]}:${q[2]}`));
      let miss = 0;
      for (let i = 0; i < 81; i++) if (x.givens[i] === '0' && !put.has(`${i}:${x.final[i]}`)) miss++;
      return miss ? { v: `${miss} squares never filled`, lim: 0 } : null;
    },
  },
  {
    // People solve by logic, not row by row: a solver pasting the answer fills square 0, 1, 2... in order. 30 or more digits
    // with nine in ten of them each to a later square than the one before is a pasted answer.
    id: 'sudoku-reading-order',
    text: 'digits filled in reading order, square after square',
    proven: false,
    check(e, ctx) {
      const ev = evOf(ctx.x);
      if (!ev || e.f !== 'recordSudoku') return null;
      const d = ev.filter((q) => q[0] === 'd' || q[0] === 'x').map((q) => Number(q[1]));
      if (d.length < 30) return null;
      let up = 0;
      for (let k = 1; k < d.length; k++) if (d[k] > d[k - 1]) up++;
      const f = up / (d.length - 1);
      return f >= 0.9 ? { v: `${d.length} digits, ${Math.round(f * 100)}% in reading order`, lim: 0.9 } : null;
    },
  },
  {
    // A Hard or Expert puzzle with not one wrong digit, note, erase, undo or hint, at under 3 seconds a square, is reading
    // the answer. ms logs only.
    id: 'sudoku-flawless-fast',
    text: 'a hard puzzle solved with no mistake, no note, faster than reading allows',
    proven: false,
    check(e, ctx) {
      const x = ctx.x, ev = evOf(x);
      if (!ev || e.f !== 'recordSudoku' || x.tu !== 'ms' || (x.res | 0) !== 0) return null;
      const tier = String((ctx.a || [])[0] || '');
      if (tier !== 'hard' && tier !== 'expert') return null;
      if (ev.some((q) => q[0] !== 'd') || (x.mistakes | 0) || (x.hints | 0)) return null;
      if (ev.length < 30) return null;
      const per = (Number(ev[ev.length - 1][3]) || 0) / ev.length;
      return per < 3000 ? { v: `${ev.length} digits, ${(per / 1000).toFixed(1)} s each, no mistake or note`, lim: 3000 } : null;
    },
  },
];
