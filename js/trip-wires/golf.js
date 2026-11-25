// js/trip-wires/golf.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'golf-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (golf/js/ui.js): a HOLE's record (_recordHole, _xlHoleData): n, par, strokes, pickedUp, putts,
// penalties, shots = every swing [shotN, club, lie, aimDeg, power, needle, missDeg, distMul, fromX, fromY, restX, restY,
// yd, flags (h holed, w water, o oob, b blocked), penalty, sec] plus 4-long event rows (drops); a ROUND's record
// (_recordRound): scores (each hole), stats, holes [[n, par, pinIdx, strokes, pickedUp, putts, penalties, wind, bearing]].
// js/integrity.js already has golf-hole-in-zero.
const SHOT_CAP = 40;                       // ui.js _xlShotRow keeps at most 40 rows a hole
const maxStrokes = (par) => 2 * par + 1;   // golf/js/rounds.js maxStrokes: double par plus one ends the hole
const swings = (x) => (Array.isArray(x && x.shots) ? x.shots.filter((s) => Array.isArray(s) && s.length >= 15) : null);

export default [
  {
    // ui.js: every swing is one stroke (_fire -> _xlShotRow) and a hole's score never drops below the strokes
    // taken (a pick-up scores the cap, a penalty adds), so a finished hole cannot score fewer than its swings.
    id: 'golf-fewer-strokes-than-swings', proven: true,
    text: 'a hole scored in fewer strokes than swings taken',
    check(e, { x }) {
      const s = swings(x);
      if (!s || x.end !== 'end' || x.shots.length >= SHOT_CAP || !Number.isFinite(Number(x.strokes))) return null;
      return Number(x.strokes) < s.length ? { v: `hole ${x.n}: ${x.strokes} strokes, ${s.length} swings`, lim: s.length } : null;
    },
  },
  {
    // rounds.js maxStrokes + ui.js _capReached: a hole ENDS at double par plus one, so no hole scores more.
    id: 'golf-over-the-cap', proven: true,
    text: 'a hole scored past double par plus one',
    check(e, { x }) {
      if (!x) return null;
      if (Number.isFinite(Number(x.strokes)) && Number(x.par) >= 3 && Number(x.strokes) > maxStrokes(Number(x.par))) {
        return { v: `hole ${x.n}: ${x.strokes} on a par ${x.par}`, lim: maxStrokes(Number(x.par)) };
      }
      for (const h of Array.isArray(x.holes) ? x.holes : []) {
        if (Array.isArray(h) && Number(h[1]) >= 3 && Number(h[3]) > maxStrokes(Number(h[1]))) return { v: `hole ${h[0]}: ${h[3]} on a par ${h[1]}`, lim: maxStrokes(Number(h[1])) };
      }
      return null;
    },
  },
  {
    // ui.js _recordRound: the round's strokes are this.scores added up, and the log carries the same scores.
    id: 'golf-round-not-its-holes', proven: true,
    text: 'a round total its holes do not add up to',
    check(e, { a, x }) {
      if (!x || !Array.isArray(x.scores) || !a || !a[1] || typeof a[1] !== 'object' || a[1].holeOnly) return null;
      const rec = Number(a[1].strokes), sum = x.scores.reduce((s, v) => s + (Number(v) || 0), 0);
      return Number.isFinite(rec) && rec !== sum ? { v: `${rec} strokes recorded, the holes add to ${sum}`, lim: sum } : null;
    },
  },
  {
    // ui.js: a swing fires on a pointerdown or key (three taps; at least one), so a hole's swings cannot outnumber
    // the presses in its touch log.
    id: 'golf-swing-without-touch', proven: true,
    text: 'swings with no tap behind them',
    check(e, { x, n }) {
      const s = swings(x);
      if (!s || x.shots.length >= SHOT_CAP || !n || n.cut > 0) return null;
      const presses = n.downs + n.keys;
      return s.length > presses ? { v: `${s.length} swings, ${presses} taps`, lim: presses } : null;
    },
  },
  {
    // Suspicious: 8+ full swings (not putts) whose accuracy tap stopped the needle almost exactly on the line (on
    // average under a fifth of the needle's own drawn width, swing.js MIN_TAP_POS 0.027).
    id: 'golf-needle-dead-centre', proven: false,
    text: 'every swing stopped dead on the line',
    check(e, { x }) {
      const s = swings(x);
      if (!s) return null;
      const full = s.filter((r) => r[1] !== 'P' && r[1] !== 'putter' && Number.isFinite(Number(r[5])));
      if (full.length < 8) return null;
      const mean = full.reduce((t, r) => t + Math.abs(Number(r[5])), 0) / full.length;
      return mean < 0.005 ? { v: `${full.length} swings, ${mean.toFixed(4)} off on average`, lim: 0.005 } : null;
    },
  },
];
