// js/trip-wires/minesweeper.js - Minesweeper's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no
// DOM, no network; imports only the game's pure rules (minesweeper/js/engine.js, no imports of its own), never its screen.
//
// What the log holds (minesweeper/js/ui.js `_msLog`): the board (`w`, `h`, `mines` = every mine's square), `acts` = every
// tap on THIS game object, '<kind><square>:<tenths of a second>' with d dig, c chord (a tap on an open number), f flag or
// mark (`_act`, never saved, at most 1,200), `resumed` 1 = a board picked up from its save. The mode `marks=0|1` says
// whether flags cycle through '?'.
import { createGame, openCell, chord, cycleMark, isWon } from '../../minesweeper/js/engine.js';

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const ACT = /^([dcf])(\d+):(\d+)$/;
const actsOf = (x) => (x && Array.isArray(x.acts) && x.acts.length < 1200 ? x.acts.map((s) => ACT.exec(String(s))).filter(Boolean) : null);
const won = (e, a) => e.f === 'recordMinesweeper' && Array.isArray(a) && a[1] === true;

/** Play the logged taps on the logged board with the game's own rules; true when they clear it. */
function replayClears(x, level, marks) {
  const g = createGame(level);
  if (g.w !== Number(x.w) || g.h !== Number(x.h)) return null;
  const mine = new Array(g.w * g.h).fill(false);
  for (const i of x.mines) mine[Number(i)] = true;
  if (mine.filter(Boolean).length !== g.mines) return null;
  g.mine = mine;
  g.num = mine.map((m, i) => {
    if (m) return -1;
    const cx = i % g.w, cy = (i / g.w) | 0;
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < g.w && ny < g.h && mine[ny * g.w + nx]) c++;
    }
    return c;
  });
  g.generated = true;
  for (const m of actsOf(x)) {
    const i = Number(m[2]), cx = i % g.w, cy = (i / g.w) | 0;
    if (m[1] === 'd') openCell(g, cx, cy);
    else if (m[1] === 'c') chord(g, cx, cy);
    else cycleMark(g, cx, cy, marks);
  }
  return isWon(g) && !g.dead;
}

export default [
  {
    // Every act is `_doDig` or `_doFlag`, each from one tap (or long press, or right click) on a square, or one key. A board
    // makes no other result while it is open.
    id: 'minesweeper-taps-without-presses',
    text: 'more squares opened or flagged than real touches',
    proven: true,
    check(e, ctx) {
      const t = actsOf(ctx.x), p = presses(ctx.n);
      if (!t || p == null || e.f !== 'recordMinesweeper') return null;
      return t.length > p ? { v: `${t.length} taps on squares, ${p} touches`, lim: p } : null;
    },
  },
  {
    // The board opens only through openCell and chord (engine.js); `_doDig` logs every call before making it, and the
    // mines are fixed from the first dig. Replaying the logged taps on the logged mines with the game's own rules must
    // clear the board. A flag's '?' step depends on the marks setting, which can change mid-board, so the replay is run
    // both ways and only a board neither way clears is flagged. A resumed board's earlier taps are not in the log.
    id: 'minesweeper-win-not-from-taps',
    text: 'a won board the taps made could not have cleared',
    proven: true,
    check(e, ctx) {
      const x = ctx.x;
      if (!x || !won(e, ctx.a) || x.resumed || !Array.isArray(x.mines) || !x.mines.length || !actsOf(x) || !actsOf(x).length) return null;
      const level = String(ctx.a[0] || '');
      const a = replayClears(x, level, true), b = replayClears(x, level, false);
      if (a == null || b == null) return null;
      return !a && !b ? { v: `${x.acts.length} taps leave the board uncleared` } : null;
    },
  },
  {
    // Only the taps a board needs: every flag right, never a flag taken back, on a Hard or
    // Expert board, at under 0.8 s a tap. People flag wrong, tap a number by mistake, and pause to think.
    id: 'minesweeper-flawless-fast',
    text: 'a hard board cleared with every flag right and none taken back, faster than reading allows',
    proven: false,
    check(e, ctx) {
      const x = ctx.x, t = actsOf(x), a = ctx.a;
      if (!t || !won(e, a) || x.resumed || (a[0] !== 'hard' && a[0] !== 'expert') || t.length < 30) return null;
      const ex = a[2] && typeof a[2] === 'object' ? a[2] : {};
      const mines = new Set((x.mines || []).map(Number));
      const flags = t.filter((m) => m[1] === 'f');
      if (flags.some((m) => !mines.has(Number(m[2])))) return null;
      if (new Set(flags.map((m) => m[2])).size !== flags.length) return null;
      if (Number(ex.flagsRight) >= 0 && Number(ex.mines) > 0 && flags.length && flags.length !== Number(ex.flagsRight)) return null;
      const tenths = Number(t[t.length - 1][3]) - Number(t[0][3]);
      const per = (tenths * 100) / (t.length - 1);
      return per < 800 ? { v: `${t.length} taps, ${(per / 1000).toFixed(2)} s each, every flag right`, lim: 800 } : null;
    },
  },
];
