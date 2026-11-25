// js/trip-wires/tower.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'tower-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (tower/js/ui.js _record): drops = every drop [offset from the block below, p|c|m (perfect, cut,
// miss), kept width, ms since the run began] (tower/js/engine.js drop, rounded to 0.1 / 1 ms), perfects, width, end.
// js/integrity.js already has tower-blocks-without-taps, tower-more-blocks-than-drops, tower-machine-precision.
const WORLD_W = 400, START_W = 250;                         // tower/js/engine.js
const TUNE = {                                               // engine.js TUNE: speed v0 + dv per block, perfect slack
  easy: { v0: 170, dv: 9, perfect: 8 },
  medium: { v0: 204, dv: 12.5, perfect: 6 },
  hard: { v0: 249, dv: 15.9, perfect: 5 },
  expert: { v0: 476, dv: 19.3, perfect: 4.5 },
};
const R = 0.06;                                              // the log rounds to 0.1: half of it, and a hair more

function drops(x) {
  const d = Array.isArray(x && x.drops) ? x.drops : null;
  if (!d || !d.length || d.length >= 1500) return null;      // engine.js keeps at most 1,500
  return d.every((q) => Array.isArray(q) && Number.isFinite(Number(q[0])) && Number.isFinite(Number(q[2])) && Number.isFinite(Number(q[3]))) ? d : null;
}
const diffOf = (e, a) => { const v = String((a && a[1]) || ''); return TUNE[v] ? v : (/@(easy|medium|hard|expert)$/.exec(String(e.m || '')) || [])[1] || null; };

export default [
  {
    // engine.js drop(): a Perfect keeps the block below's width, a cut keeps less, so the kept width never grows
    // (the first block below is START_W wide).
    id: 'tower-width-grew', proven: true,
    text: 'a block wider than the one below it',
    check(e, { x }) {
      const d = drops(x);
      if (!d) return null;
      let w = START_W;
      for (let k = 0; k < d.length; k++) {
        if (d[k][1] === 'm') break;
        const kept = Number(d[k][2]);
        if (kept > w + 2 * R) return { v: `block ${k + 1}: ${kept} wide on ${w}`, lim: w };
        w = kept;
      }
      return null;
    },
  },
  {
    // engine.js drop(): the slider is as wide as the block below, so a cut keeps exactly that width less the
    // offset, and a Perfect needs the offset inside the level's slack (TUNE.perfect).
    id: 'tower-cut-not-offset', proven: true,
    text: 'a block kept more than its overlap',
    check(e, { a, x }) {
      const d = drops(x), diff = diffOf(e, a);
      if (!d || !diff) return null;
      let w = START_W;
      for (let k = 0; k < d.length; k++) {
        const off = Math.abs(Number(d[k][0])), kind = d[k][1], kept = Number(d[k][2]);
        if (kind === 'm') break;
        if (kind === 'p' && off > TUNE[diff].perfect + R) return { v: `block ${k + 1}: a Perfect ${off} off`, lim: TUNE[diff].perfect };
        if (kind === 'c' && Math.abs(kept - (w - off)) > 4 * R) return { v: `block ${k + 1}: kept ${kept} of ${w}, ${off} off`, lim: Math.round((w - off) * 10) / 10 };
        w = kept;
      }
      return null;
    },
  },
  {
    // engine.js spawn()/stepMover(): each block starts at one end of its range (left on odd levels, right on even)
    // and slides at speedFor(level); ui.js moves it by real time (frames clamped to 0.05 s only slow it), so it
    // cannot reach the spot it was dropped at sooner than distance / speed after the drop before it. The spot is
    // rebuilt from the base (x 75) and the logged offsets; 80 ms spare for rounding and the clock.
    id: 'tower-drop-before-arrival', proven: true,
    text: 'a block dropped before it could slide there',
    check(e, { a, x }) {
      const d = drops(x), diff = diffOf(e, a);
      if (!d || !diff) return null;
      let topX = (WORLD_W - START_W) / 2, w = START_W, t = 0;
      for (let k = 0; k < d.length; k++) {
        const n = k + 1, off = Number(d[k][0]), kind = d[k][1], kept = Number(d[k][2]), ms = Number(d[k][3]);
        const v = TUNE[diff].v0 + TUNE[diff].dv * Math.max(0, n - 1);
        const start = n % 2 === 1 ? -w * 0.72 : WORLD_W - w * 0.28;
        const need = (Math.abs(topX + off - start) / v) * 1000;
        if (k > 0 && ms > 0 && ms - t < need - 80) return { v: `block ${n}: ${ms - t} ms after the last, it needs ${Math.round(need)} ms to slide there`, lim: Math.round(need) };
        if (kind === 'm') break;
        if (kind === 'c' && off > 0) topX += off;
        w = kept; t = ms;
      }
      return null;
    },
  },
];
