// js/trip-wires/murdoku.js - Murdoku's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file).
//
// What the log holds (murdoku/js/ui.js `_recordOnce`): `pos` = each person's final square, `ev` = every change on THIS
// screen since the case opened (`_evn`, never saved): ['p', person, square, t] placed, ['l', person, t] lifted, ['m',
// square, t] mark; `res` 1 = a case resumed from its save (or recorded from the save at open); from 2026-11-25 t is ms on
// the running clock (`tu: 'ms'`, at most 800, `cut` counts the rest), seconds before.

const presses = (n) => {
  if (!n || n.cut || !Array.isArray(n.ev)) return null;
  let p = 0;
  for (const e of n.ev) if (!e.fake && (e.kind === 'd' || e.kind === 'k')) p++;
  return p;
};
const evOf = (x) => (x && Array.isArray(x.ev) && (x.cut | 0) === 0 && x.ev.length < 800 ? x.ev.filter(Array.isArray) : null);

export default [
  {
    // Each line is one handler: `_cellTap` (a tap on a square: mark, lift, or place the selected person) or a key. No tap
    // makes two lines, and a case makes no other result while it is open.
    id: 'murdoku-moves-without-presses',
    text: 'more placements than real touches',
    proven: true,
    check(e, ctx) {
      const ev = evOf(ctx.x), p = presses(ctx.n);
      if (!ev || p == null || e.f !== 'recordMurdoku') return null;
      return ev.length > p ? { v: `${ev.length} placements and marks, ${p} touches`, lim: p } : null;
    },
  },
  {
    // `this.pos[p]` is set only in `_place` (logged 'p' first) and cleared by a lift ('l') or by another person placed on
    // the square. On a case opened fresh (`res` 0) every placed person's last 'p' line is their final square.
    id: 'murdoku-placed-without-move',
    text: 'a person on the answer square who was never put there',
    proven: true,
    check(e, ctx) {
      const x = ctx.x, ev = evOf(x);
      if (!ev || e.f !== 'recordMurdoku' || (x.res | 0) !== 0 || !Array.isArray(x.pos)) return null;
      const last = {};
      for (const q of ev) if (q[0] === 'p') last[q[1]] = q[2];
      const bad = x.pos.map((s, q) => (Number(s) >= 0 && last[q] !== s ? q : -1)).filter((q) => q >= 0);
      return bad.length ? { v: `${bad.length} of ${x.pos.length} people never placed there`, lim: 0 } : null;
    },
  },
  {
    // On a 6x6 board or bigger, every person dropped once, straight onto their answer square (no lift, no mark, no wrong
    // board, no hint), at under 10 seconds a person, is reading the answer. Easy's 5x5 cases are often solved this way by
    // people (every real Easy case to 2026-11-25), so only bigger boards count. ms logs only.
    id: 'murdoku-straight-to-answer',
    text: 'every person put straight on the answer, faster than the clues can be read',
    proven: false,
    check(e, ctx) {
      const x = ctx.x, ev = evOf(x);
      if (!ev || e.f !== 'recordMurdoku' || x.tu !== 'ms' || (x.res | 0) !== 0 || !Array.isArray(x.pos)) return null;
      const n = Number(x.n) || x.pos.length;
      if (n < 6 || (x.hints | 0) || (x.wrongFull | 0) || ev.length !== n) return null;
      if (!ev.every((q) => q[0] === 'p' && x.pos[q[1]] === q[2])) return null;
      const per = (Number(ev[ev.length - 1][3]) || 0) / n;
      return per < 10000 ? { v: `${n} people, each straight to the answer, ${(per / 1000).toFixed(1)} s each`, lim: 10000 } : null;
    },
  },
];
