// js/trip-wires/skeeball.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM,
// no network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'skeeball-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (skeeball/js/game.js privateLog + ui.js): swipes [[power, aim, rack clock s]] (every ball thrown,
// at most 60), throws [[points, hole]] (every ball that settled), score, balls, thrown, machineT, board, challenge.
// `a` = recordSkeeball(board, { score, balls, ... }).
const SWIPE_CAP = 60;   // game.js throwBall keeps at most 60 swipes
const arr = (v) => (Array.isArray(v) ? v : null);

export default [
  {
    // game.js _settle: the score is the settled balls' points added up (an equalizer cup or a penalty basket only
    // takes away, floored at 0), and the recorder is handed game.result()'s same score. So the score cannot pass the
    // balls' positive points, and the recorded score is the rack's.
    id: 'skeeball-score-not-throws', proven: true,
    text: 'a Skeeball score its balls do not add up to',
    check(e, { a, x }) {
      const th = x && arr(x.throws);
      if (!th) return null;
      const most = th.reduce((s, q) => s + Math.max(0, Number(q && q[0]) || 0), 0);
      const sc = Number(x.score);
      if (Number.isFinite(sc) && sc > most) return { v: `${sc} points from balls worth ${most}`, lim: most };
      const rec = a && a[1] && typeof a[1] === 'object' ? Number(a[1].score) : NaN;
      return Number.isFinite(rec) && rec > most ? { v: `${rec} recorded from balls worth ${most}`, lim: most } : null;
    },
  },
  {
    // game.js: a ball settles (throws) only after throwBall rolled it, and every throwBall logs its swipe.
    id: 'skeeball-ball-without-throw', proven: true,
    text: 'more balls scored than thrown',
    check(e, { x }) {
      const th = x && arr(x.throws), sw = x && arr(x.swipes);
      if (!th || !sw || sw.length >= SWIPE_CAP) return null;
      return th.length > sw.length ? { v: `${th.length} balls scored, ${sw.length} thrown`, lim: sw.length } : null;
    },
  },
  {
    // ui.js _bindPlay: a throw is a swipe that starts with a pointerdown on the swipe zone (this.swipe is set only
    // there), one press per ball. The touch log keeps every down, so the balls thrown cannot outnumber them.
    id: 'skeeball-throw-without-touch', proven: true,
    text: 'balls thrown without a finger on the screen',
    check(e, { x, n }) {
      const sw = x && arr(x.swipes);
      if (!sw || sw.length >= SWIPE_CAP || !n || n.cut > 0) return null;
      return sw.length > n.downs ? { v: `${sw.length} throws, ${n.downs} touches`, lim: n.downs } : null;
    },
  },
  {
    // Suspicious: a rack where most balls had the SAME swipe to the hundredth (power and aim): a replayed throw.
    // Real racks (2026-11-16 to 11-24): at most 2 of 9 alike.
    id: 'skeeball-same-swipe', proven: false,
    text: 'the same swipe, ball after ball',
    check(e, { x }) {
      const sw = x && arr(x.swipes);
      if (!sw || sw.length < 6) return null;
      const m = {};
      for (const s of sw) { if (Array.isArray(s)) { const k = `${s[0]},${s[1]}`; m[k] = (m[k] || 0) + 1; } }
      const top = Math.max(0, ...Object.values(m));
      return top >= 6 ? { v: `${top} of ${sw.length} swipes identical`, lim: 6 } : null;
    },
  },
];
