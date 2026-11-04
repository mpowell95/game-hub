// tools/arrow-styles.mjs - the MIXED board styles for Arrow Maze's Hard (generator 11) and Expert (generator 10)
// boards from board 101 on (2026-11-04). Matt: "Do the hard and expert arrow levels repeat? They feel very
// repetitive", then "Yes. And yes to mixing up board styles". Boards 1-100 of each stay as shipped (the
// classic recipe); from board 101 the style turns with the board number, so the loop never plays two of a kind
// in a row:
//   classic  the shipped recipe: one arrow free at every step, the next one far from the last, no trains;
//   curly    the same rules, with twisting arrows (more turns per arrow), so the board reads differently;
//   long     the same rules with fewer, longer snakes winding across the board;
//   pairs    two arrows free at some steps (never more), still far apart: a choice to make, not a trail.
// What made boards slow for Matt (way-out/CLAUDE.md, Impossible rounds 2-5): one free arrow, far away, among
// lookalikes; noise and many free arrows made them EASIER. So every style keeps the far jumps and no trains,
// and pairs allows at most two free.
import { measure, search, setGrid, scoreOf, STYLES } from './arrow-search.mjs';
const E = await import('../way-out/js/engine.js');

export const STYLE_ORDER = ['curly', 'long', 'pairs', 'classic'];
/** Board k's style (k counts from 0): boards 0-99 are the shipped classic ones. */
export const styleFor = (k) => (k < 100 ? 'classic' : STYLE_ORDER[(k - 100) % STYLE_ORDER.length]);

const turnsOf = (a) => { let t = 0; for (const c of a) for (let i = 2; i < c.length; i++) if (c[i] - c[i - 1] !== c[i - 1] - c[i - 2]) t++; return t / a.length; };
const lenOf = (a) => a.reduce((x, c) => x + c.length, 0) / a.length;

/** Per grid: `over` = the classic recipe's search tweaks, `n` its arrow range, `jump` its least average jump. */
export const GRIDS = {
  hard: { W: 18, H: 25, iters: 300000, tag: 'b11-hard', n: [44, 127], jump: 6.3,
    over: { jump: 18, near: 8, minN: 55, maxN: 75, fill: 0.58, rounds: 4, dist: 7, farS: 30 },
    long: [30, 42], turns: 2.8, len: 7.0 },
  expert: { W: 28, H: 38, iters: 1500000, tag: 'b10-expert', n: [65, 127], jump: 7.5,
    over: { jump: 26, near: 12, minN: 95, maxN: 160, fill: 0.55, rounds: 4, dist: 9, farS: 40 },
    long: [48, 64], turns: 3.2, len: 7.5 },
};

function recipe(style, G) {
  const S = { ...STYLES.jumps, ...G.over };
  if (style === 'curly') {
    return { over: G.over, scorer: (a) => { const m = measure(a); return m ? scoreOf(m, S) + 15 * turnsOf(a) : -Infinity; },
      ok: (a, m) => m.maxFree === 1 && m.rounds === m.n && m.n >= G.n[0] - 4 && turnsOf(a) >= G.turns };
  }
  if (style === 'long') {
    const over = { ...G.over, minN: G.long[0], maxN: G.long[1] };
    const SL = { ...STYLES.jumps, ...over };
    return { over, scorer: (a) => { const m = measure(a); return m ? scoreOf(m, SL) + 30 * lenOf(a) : -Infinity; },
      ok: (a, m) => m.maxFree === 1 && m.rounds === m.n && m.n >= G.long[0] - 4 && m.n <= G.long[1] + 4 && lenOf(a) >= G.len };
  }
  if (style === 'pairs') {
    const SP = { ...S, free: 0, free0: 2 };
    const share = (m) => m.freeSq / m.rounds;   // with 1 or 2 free a step, freeSq = the steps with two
    return { over: G.over, scorer: (a) => { const m = measure(a); return m ? scoreOf(m, SP) - 150 * Math.max(0, m.maxFree - 2) - 120 * Math.abs(share(m) - 0.3) : -Infinity; },
      ok: (a, m) => m.maxFree === 2 && m.free0 <= 2 && share(m) >= 0.15 && share(m) <= 0.45 && m.n >= G.n[0] };
  }
  return { over: G.over, scorer: null, ok: (a, m) => m.maxFree === 1 && m.rounds === m.n && m.n >= G.n[0] };
}

/** Board k on grid `which` ('hard' | 'expert'): the first seed whose search meets its style. */
export function styledBoard(which, k, seeds = 12) {
  const G = GRIDS[which], style = styleFor(k), R = recipe(style, G);
  setGrid(G.W, G.H);
  for (let s = 0; s < seeds; s++) {
    const a = search(E.seedOf(`${G.tag}-${k}`, s), 'jumps', G.iters, R.over, R.scorer || undefined);
    const m = measure(a);
    if (m && m.n <= G.n[1] && m.trains === 0 && m.jump >= G.jump && a.every((c) => c.length <= 32) && R.ok(a, m)) {
      return { arrows: a, style, m: { n: m.n, jump: +m.jump.toFixed(2), dist: +m.dist.toFixed(2), maxFree: m.maxFree, turns: +turnsOf(a).toFixed(2), len: +lenOf(a).toFixed(2), pairs: +(m.freeSq / m.rounds).toFixed(2) } };
    }
  }
  throw new Error(`${which} board ${k} (${style}): no seed met the recipe`);
}
