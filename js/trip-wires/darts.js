// js/trip-wires/darts.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'darts-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (darts/js/ui.js _xlData, vs the computer): end, mode, diff, kind (301 201 101 cricket...),
// starter, winner (-1 a draw), scores, marks, bo (overtime), turns, fromTurn, darts [[seat, x, y, num, mult, pts, marks,
// event, sec]] (engine.js dartRow; x, y in board radii to 3 decimals). `a` = recordResult('darts', diff, won).
// The board, copied from darts/js/engine.js (ORDER, RING, scoreAt).
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const RING = { bullIn: 0.0374, bullOut: 0.0935, trebIn: 0.5824, trebOut: 0.6294, dblIn: 0.9529, dblOut: 1 };
function bedAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= RING.bullIn) return [25, 2];
  if (r <= RING.bullOut) return [25, 1];
  if (r > RING.dblOut) return [0, 0];
  const deg = Math.atan2(x, -y) * 180 / Math.PI;
  const num = ORDER[Math.floor((((deg + 9) % 360) + 360) % 360 / 18) % 20];
  return [num, r >= RING.trebIn && r <= RING.trebOut ? 3 : r >= RING.dblIn ? 2 : 1];
}
const DARTS_PER_TURN = 3;   // engine.js
const START = { 301: 301, 201: 201, 101: 101 };
const darts = (x) => (x && Array.isArray(x.darts) && x.darts.length ? x.darts.filter((d) => Array.isArray(d) && d.length >= 8) : null);

export default [
  {
    // engine.js throwDart: a dart scores the bed under the point it landed on (scoreAt). The log rounds the point to
    // 1/1000 of a radius, so the bed is looked up there and a hair around it; a bed found nowhere near never came
    // from that throw.
    id: 'darts-score-not-where-it-hit', proven: true,
    text: 'a dart scored a bed it did not land in',
    check(e, { x }) {
      const ds = darts(x);
      if (!ds) return null;
      const h = 0.0006;
      for (const d of ds) {
        const px = Number(d[1]), py = Number(d[2]), num = Number(d[3]), mult = Number(d[4]);
        if (![px, py, num, mult].every(Number.isFinite)) continue;
        const ok = [[0, 0], [h, 0], [-h, 0], [0, h], [0, -h], [h, h], [-h, -h], [h, -h], [-h, h]].some(([dx, dy]) => { const b = bedAt(px + dx, py + dy); return b[0] === num && b[1] === mult; });
        if (!ok) { const b = bedAt(px, py); return { v: `a dart at ${px}, ${py} scored ${mult} x ${num}`, lim: `${b[1]} x ${b[0]}` }; }
      }
      return null;
    },
  },
  {
    // engine.js: a turn is 3 darts (one in overtime) and passes to the other seat; one seat never throws a 4th in a
    // row. In 301/201/101 the winner is whoever reached exactly 0 (finished), so a finished match's winner sits at 0
    // (unless it went to overtime), and the recorder is told winner === 0.
    id: 'darts-match-not-its-darts', proven: true,
    text: 'a result the darts do not give',
    check(e, { a, x }) {
      const ds = darts(x);
      if (!ds || x.mode !== 'cpu') return null;
      let run = 0, prev = null;
      for (const d of ds) {
        run = d[0] === prev ? run + 1 : 1; prev = d[0];
        if (run > DARTS_PER_TURN) return { v: `seat ${d[0]} threw ${run} darts in a turn`, lim: DARTS_PER_TURN };
      }
      if (x.end !== 'end' || !Array.isArray(x.scores) || !Number.isInteger(x.winner) || x.winner < 0 || x.bo) return null;
      if (START[String(x.kind)] && Number(x.scores[x.winner]) !== 0) return { v: `winner seat ${x.winner} on ${x.scores[x.winner]}`, lim: 0 };
      return Array.isArray(a) && typeof a[2] === 'boolean' && a[2] !== (x.winner === 0) ? { v: `recorded ${a[2] ? 'a win' : 'a loss'}, winner seat ${x.winner}`, lim: '' } : null;
    },
  },
  {
    // ui.js: a dart is thrown by a swipe up (_pointerDown, then a release moving up), so the player's darts vs the
    // computer cannot outnumber the touches in the touch log.
    id: 'darts-without-touch', proven: true,
    text: 'darts thrown without a finger on the screen',
    check(e, { x, n }) {
      const ds = darts(x);
      if (!ds || x.mode !== 'cpu' || !n || n.cut > 0 || (x.fromTurn | 0) !== 0) return null;
      const mine = ds.filter((d) => Number(d[0]) === 0).length;
      return mine > n.downs ? { v: `${mine} darts, ${n.downs} touches`, lim: n.downs } : null;
    },
  },
  {
    // Suspicious: nine or more of the player's darts, every one a treble or the bullseye.
    id: 'darts-every-dart-a-treble', proven: false,
    text: 'every dart a treble or a bullseye',
    check(e, { x }) {
      const ds = darts(x);
      if (!ds || x.mode !== 'cpu') return null;
      const mine = ds.filter((d) => Number(d[0]) === 0);
      return mine.length >= 9 && mine.every((d) => Number(d[4]) === 3 || (Number(d[3]) === 25 && Number(d[4]) === 2)) ? { v: `${mine.length} darts, all trebles or bulls`, lim: 9 } : null;
    },
  },
];
