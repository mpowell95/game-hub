// js/trip-wires/archery.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'archery-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (archery/js/ui.js _xlData, vs the computer): end, mode, diff, seed, starter, winner, stage,
// totals, wind, arrows [[seat, x, y, score, stage]] in the order shot (seat 0 = the player), aims [[seat, aimX, aimY,
// panic, arrowIndex, sec]] (the player's own). `a` = recordResult('archery', diff, won).
const ROUNDS = 3, ARROWS = 3;                                  // archery/js/engine.js
const arrowsFor = (stage) => (stage < ROUNDS ? ARROWS : 1);   // engine.js arrowsFor
/** engine.js scoreAt: 10 rings of 0.1 radius, a line-cutter takes the higher ring, off the face 0. */
function scoreAt(x, y) {
  const d = Math.hypot(x, y);
  if (!(d <= 1)) return 0;
  if (d <= 0.1) return 10;
  return 11 - Math.ceil(d * 10 - 1e-9);
}
const arrows = (x) => (x && Array.isArray(x.arrows) && x.arrows.length && x.arrows.length < 400 ? x.arrows.filter((q) => Array.isArray(q) && q.length >= 5) : null);

export default [
  {
    // engine.js shoot(): an arrow's score is scoreAt(x, y) of the point it landed on, nothing else.
    id: 'archery-score-not-where-it-hit', proven: true,
    text: 'an arrow scored more than where it hit',
    check(e, { x }) {
      const ar = arrows(x);
      if (!ar) return null;
      const bad = ar.find((q) => Number(q[3]) > scoreAt(Number(q[1]), Number(q[2])));
      return bad ? { v: `an arrow at ${bad[1]}, ${bad[2]} scored ${bad[3]}`, lim: scoreAt(Number(bad[1]), Number(bad[2])) } : null;
    },
  },
  {
    // engine.js shoot(): 3 arrows a player in each of the 3 rounds, 1 in a shoot-off; and after round 3 the higher
    // total wins (a shoot-off only when level). So no stage holds more arrows a player, and a win the totals give
    // to the computer is not a win.
    id: 'archery-match-not-its-arrows', proven: true,
    text: 'a result the arrows do not give',
    check(e, { a, x }) {
      const ar = arrows(x);
      if (!ar) return null;
      const per = {};
      for (const q of ar) {
        const k = `${q[0]}:${q[4]}`;
        per[k] = (per[k] || 0) + 1;
        if (per[k] > arrowsFor(Number(q[4]))) return { v: `seat ${q[0]} shot ${per[k]} arrows in stage ${Number(q[4]) + 1}`, lim: arrowsFor(Number(q[4])) };
      }
      if (x.end !== 'end' || !a || typeof a[2] !== 'boolean') return null;
      const t = [0, 1].map((s) => ar.reduce((n, q) => n + (Number(q[0]) === s && Number(q[4]) < ROUNDS ? Number(q[3]) || 0 : 0), 0));
      const done = [0, 1].every((s) => ar.filter((q) => Number(q[0]) === s && Number(q[4]) < ROUNDS).length === ROUNDS * ARROWS);
      if (!done || t[0] === t[1]) return null;
      const won = t[0] > t[1];
      return a[2] !== won ? { v: `recorded ${a[2] ? 'a win' : 'a loss'}, totals ${t[0]}-${t[1]}`, lim: won ? 'win' : 'loss' } : null;
    },
  },
  {
    // ui.js: the player's every arrow is touch-hold-release (hold to draw, let go to shoot; a panic still needs
    // the hold), so seat 0's arrows cannot outnumber the touches in the touch log.
    id: 'archery-arrows-without-touch', proven: true,
    text: 'arrows shot without a finger on the screen',
    check(e, { x, n }) {
      const ar = arrows(x);
      if (!ar || !n || n.cut > 0 || x.mode !== 'cpu') return null;
      const mine = ar.filter((q) => Number(q[0]) === 0).length;
      return mine > n.downs ? { v: `${mine} arrows, ${n.downs} touches`, lim: n.downs } : null;
    },
  },
  {
    // Suspicious: nine or more of the player's own arrows, every one a 10 (the wind grows every round; Hard's
    // computer averages 8.6 an arrow).
    id: 'archery-every-arrow-a-ten', proven: false,
    text: 'every arrow in the middle',
    check(e, { x }) {
      const ar = arrows(x);
      if (!ar || x.mode !== 'cpu') return null;
      const mine = ar.filter((q) => Number(q[0]) === 0);
      return mine.length >= 9 && mine.every((q) => Number(q[3]) === 10) ? { v: `${mine.length} arrows, all 10s`, lim: 9 } : null;
    },
  },
];
