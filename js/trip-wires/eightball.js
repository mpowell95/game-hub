// js/trip-wires/eightball.js - Pool's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'pool-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (eight-ball/js/ui.js _xlData, vs the computer): end, mode, diff, game (8 | 9 | ct), racks (first
// to), seed, breaker, n (seats), winner, scores (racks won), fromShot, more (shots past the cap), shotLog [[rack, seat,
// dx, dy, power, spin, cueX, cueY, call, pots, pockets, counted, foul, kind, sec]]. `a` = recordResult('eightball', diff, won).
const shots = (x) => (x && Array.isArray(x.shotLog) && x.shotLog.length ? x.shotLog.filter((s) => Array.isArray(s) && s.length >= 14) : null);
const full = (x) => (x.fromShot | 0) === 0 && (x.more | 0) === 0;

export default [
  {
    // eight-ball/js/engine.js rackOver: the match ends when a seat's racks reach `racks` (first to N), so a finished
    // match's winner holds exactly `racks`, nobody holds more, and the recorder is told winner === 0.
    id: 'pool-racks-not-won', proven: true,
    text: 'a result the racks do not give',
    check(e, { a, x }) {
      if (!x || !Array.isArray(x.scores) || !(Number(x.racks) >= 1) || x.mode !== 'cpu') return null;
      const R = Number(x.racks), sc = x.scores.map(Number);
      if (sc.some((v) => v > R)) return { v: `${sc.join('-')} racks, first to ${R}`, lim: R };
      if (x.end !== 'end' || !Array.isArray(a) || typeof a[2] !== 'boolean') return null;
      if (!Number.isInteger(x.winner) || sc[x.winner] !== R) return { v: `winner seat ${x.winner} on ${sc.join('-')}, first to ${R}`, lim: R };
      return a[2] !== (x.winner === 0) ? { v: `recorded ${a[2] ? 'a win' : 'a loss'}, winner seat ${x.winner}`, lim: '' } : null;
    },
  },
  {
    // ui.js _shoot: every shot is normalised (dx, dy a unit vector to 6 decimals), power clamped to 0..1, spin to
    // -1..1 (logged to 3 decimals). Anything else never came from the table.
    id: 'pool-impossible-shot', proven: true,
    text: 'a shot harder or stranger than the cue allows',
    check(e, { x }) {
      const s = shots(x);
      if (!s) return null;
      const bad = s.find((q) => Number(q[4]) > 1.0005 || Math.abs(Number(q[5]) || 0) > 1.0005 || Math.abs(Math.hypot(Number(q[2]), Number(q[3])) - 1) > 0.003);
      return bad ? { v: `power ${bad[4]}, spin ${bad[5]}, direction ${bad[2]}, ${bad[3]}`, lim: 1 } : null;
    },
  },
  {
    // ui.js: the player shoots by dragging the cue back and letting go (_power from a pointerdown), so seat 0's shots
    // vs the computer cannot outnumber the touches in the touch log.
    id: 'pool-shots-without-touch', proven: true,
    text: 'shots without a finger on the screen',
    check(e, { x, n }) {
      const s = shots(x);
      if (!s || x.mode !== 'cpu' || !n || n.cut > 0 || !full(x)) return null;
      const mine = s.filter((q) => Number(q[1]) === 0).length;
      return mine > n.downs ? { v: `${mine} shots, ${n.downs} touches`, lim: n.downs } : null;
    },
  },
  {
    // Suspicious: 15 or more of the player's shots in one match and every one potted a ball.
    id: 'pool-never-misses', proven: false,
    text: 'every shot potted a ball',
    check(e, { x }) {
      const s = shots(x);
      if (!s || x.mode !== 'cpu') return null;
      const mine = s.filter((q) => Number(q[1]) === 0);
      return mine.length >= 15 && mine.every((q) => Array.isArray(q[9]) && q[9].length > 0 && !q[12]) ? { v: `${mine.length} shots, every one potted`, lim: 15 } : null;
    },
  },
];
