// js/trip-wires/gridlock.js - Gridlock's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). The older rule (gridlock-under-fewest,
// js/integrity.js) already catches a solve in fewer moves than the fewest possible; these add to it.
//
// What the log holds (gridlock/js/ui.js): `seq` = every slide '<piece>:<from>><to>@<t>', 'u' undo, 'r' restart, 'h<p>><q>'
// hint, on THIS screen since the level opened (`_lgSeq`, never saved, at most 900); `final` = the moves the solve stands on
// (`this.hist`, saved, so a resumed level carries the earlier ones: `res` 1); `t` is seconds before 2026-11-25 and ms from
// then (`tu: 'ms'`).

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const MOVE = /^\d+:\d+>\d+@(\d+)$/;
const seqOf = (x) => (x && Array.isArray(x.seq) && x.seq.length < 900 ? x.seq.map(String) : null);

export default [
  {
    // A slide is `_commit`, reached from a drag's pointerup (one touch) or an arrow key on a focused block (one key; a held
    // key on the same block grows that one slide and logs nothing); undo, restart and hint are each a button tap. A hint
    // calls recordGridlockHint, a recorder, and the touch log starts again there, so only lines after the last hint count.
    id: 'gridlock-moves-without-presses',
    text: 'more slides than real touches',
    proven: true,
    check(e, ctx) {
      const s = seqOf(ctx.x), p = presses(ctx.n);
      if (!s || p == null || e.f !== 'recordGridlock') return null;
      let k = s.length - 1;
      while (k >= 0 && !/^h/.test(s[k])) k--;
      const acts = s.slice(k + 1).length;
      return acts > p ? { v: `${acts} slides, undos and restarts, ${p} touches`, lim: p } : null;
    },
  },
  {
    // `this.hist` grows only in `_commit`, which logs every push (`_lgSeq`); undo pops, restart empties, a held key edits
    // the last entry. On a level opened fresh (`res` 0) the solve's moves can never outnumber the slides logged.
    id: 'gridlock-moves-not-made',
    text: 'a solve standing on moves that were never made',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, s = seqOf(x);
      if (!s || e.f !== 'recordGridlock' || (x.res | 0) !== 0 || !Array.isArray(x.final)) return null;
      const made = s.filter((q) => /^\d+:/.test(q)).length;
      return x.final.length > made ? { v: `${x.final.length} moves, ${made} slides made`, lim: made } : null;
    },
  },
  {
    // A level's start is never solved (its fewest moves is at least 1, `this.fewest`), and the solve's moves are
    // `this.hist.length`: a solve recorded with 0 moves skipped the board.
    id: 'gridlock-solved-without-moving',
    text: 'solved with no moves at all',
    proven: true,
    check(e, ctx) {
      const d = ctx.d;
      if (!d || e.f !== 'recordGridlock' || d.moves == null) return null;
      return Number(d.fewest) > 0 && Number(d.moves) === 0 ? { v: `0 moves, fewest ${d.fewest}`, lim: d.fewest } : null;
    },
  },
  {
    // A slide is a drag: finger down, along, up. Ten or more of them a fifth of a second apart (middle gap) is a machine.
    // Only on ms logs (2026-11-25 on).
    id: 'gridlock-machine-pace',
    text: 'blocks slid faster than a finger can drag',
    proven: false,
    check(e, ctx) {
      const x = ctx.x, s = seqOf(x);
      if (!s || e.f !== 'recordGridlock' || x.tu !== 'ms') return null;
      const t = s.map((q) => MOVE.exec(q)).filter(Boolean).map((m) => Number(m[1]));
      if (t.length < 10) return null;
      const gaps = t.slice(1).map((v, k) => v - t[k]).sort((a, b) => a - b);
      const med = gaps[gaps.length >> 1];
      return med < 200 ? { v: `${t.length} slides, ${med} ms apart (middle value)`, lim: 200 } : null;
    },
  },
];
