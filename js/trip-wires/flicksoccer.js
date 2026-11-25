// js/trip-wires/flicksoccer.js - Flick Soccer's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no
// DOM, no network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'flick-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (flick-soccer/js/ui.js _xlData, vs the computer): end, mode, diff, goals (first to), starter,
// winner, scores, shots, test, forms, fromShot (flicks before the log began: a match resumed from an older build),
// flicks [[seat, disc, dx, dy, power, goal (-1, else the seat it counted for), own goal, score after, sec]].
// `a` = recordResult('flicksoccer', diff, won) or recordFlickSoccerTest(diff, won).
const FLICK_CAP = 300;   // ui.js _xlEnd keeps at most 300
const flicks = (x) => (x && Array.isArray(x.flicks) && x.flicks.length < FLICK_CAP ? x.flicks.filter((f) => Array.isArray(f) && f.length >= 8) : null);
const wonOf = (a) => (Array.isArray(a) ? (typeof a[2] === 'boolean' ? a[2] : typeof a[1] === 'boolean' ? a[1] : null) : null);

export default [
  {
    // ui.js _xlEnd logs every flick with the goal it gave (the goal counts for `goal`); the match's score is those
    // goals, the match ends at `goals` for the winner, and the recorder is told winner === 0.
    id: 'flick-score-not-flicks', proven: true,
    text: 'a score the flicks do not give',
    check(e, { a, x }) {
      const f = flicks(x);
      if (!f || (x.fromShot | 0) !== 0 || !Array.isArray(x.scores) || x.mode !== 'cpu') return null;
      const got = [0, 0];
      for (const q of f) if (Number(q[5]) === 0 || Number(q[5]) === 1) got[Number(q[5])]++;
      if (got[0] !== Number(x.scores[0]) || got[1] !== Number(x.scores[1])) return { v: `${x.scores[0]}-${x.scores[1]}, the flicks scored ${got[0]}-${got[1]}`, lim: `${got[0]}-${got[1]}` };
      const won = wonOf(a);
      if (x.end === 'end' && won != null && Number(x.goals) > 0) {
        if (won && got[0] < Number(x.goals)) return { v: `a win at ${got[0]}-${got[1]}, first to ${x.goals}`, lim: x.goals };
        if (won !== (x.winner === 0)) return { v: `recorded ${won ? 'a win' : 'a loss'}, winner seat ${x.winner}`, lim: '' };
      }
      return null;
    },
  },
  {
    // ui.js _aimFrom: a flick's direction is a unit vector (px / pl) and its power is clamped to 1. Logged to four
    // decimals, so a length off 1 by more than 0.002 or a power over 1 never came from the screen.
    id: 'flick-impossible-pull', proven: true,
    text: 'a flick harder than a full pull',
    check(e, { x }) {
      const f = flicks(x);
      if (!f) return null;
      const bad = f.find((q) => Number(q[0]) === 0 && (Number(q[4]) > 1.0001 || Math.abs(Math.hypot(Number(q[2]), Number(q[3])) - 1) > 0.002));
      return bad ? { v: `power ${bad[4]}, direction ${bad[2]}, ${bad[3]}`, lim: 1 } : null;
    },
  },
  {
    // flick-soccer/js/engine.js: piece 0 is the ball, 1-5 are seat 0's discs, 6-10 seat 1's; a player can only flick
    // one of their own.
    id: 'flick-wrong-piece', proven: true,
    text: 'a flick of a piece that was not theirs',
    check(e, { x }) {
      const f = flicks(x);
      if (!f) return null;
      const bad = f.find((q) => { const s = Number(q[0]), i = Number(q[1]); return (s === 0 || s === 1) && (i < 1 + s * 5 || i > 5 + s * 5); });
      return bad ? { v: `seat ${bad[0]} flicked piece ${bad[1]}`, lim: '' } : null;
    },
  },
  {
    // ui.js: the player flicks by pressing a disc and pulling back (a pointerdown each time), so seat 0's flicks
    // vs the computer cannot outnumber the touches in the touch log.
    id: 'flick-without-drag', proven: true,
    text: 'flicks without a finger on the screen',
    check(e, { x, n }) {
      const f = flicks(x);
      if (!f || x.mode !== 'cpu' || !n || n.cut > 0) return null;
      const mine = f.filter((q) => Number(q[0]) === 0).length;
      return mine > n.downs ? { v: `${mine} flicks, ${n.downs} touches`, lim: n.downs } : null;
    },
  },
  {
    // Suspicious: the very same flick (disc, direction and power to four decimals) three or more times in one match:
    // a replayed shot, not a finger.
    id: 'flick-same-flick-again', proven: false,
    text: 'the same flick, to the ten-thousandth, again and again',
    check(e, { x }) {
      const f = flicks(x);
      if (!f) return null;
      const m = {};
      for (const q of f) if (Number(q[0]) === 0) { const k = `${q[1]}|${q[2]}|${q[3]}|${q[4]}`; m[k] = (m[k] || 0) + 1; }
      const top = Math.max(0, ...Object.values(m));
      return top >= 3 ? { v: `one flick ${top} times`, lim: 3 } : null;
    },
  },
];
