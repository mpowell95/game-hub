// js/trip-wires/shoveoff.js - Knockout's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM, no
// network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'knockout-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (shove-off/js/cpu-game.js logOf, vs the computer): rv, cpu, seed, end, winner (a = this player,
// b, draw), sd, sent [[side, round, "dx,dy;dx,dy;-;dx,dy" one part per slot, '-' = a piece that is out]], rounds
// [{ r, sd, H, H1, steps, before "a0:x,y b2:x,y ..." (pieces on the platform), after, fell, edge }].
// `a` = recordResult('shoveoff', diff, won).
const MAX_AIM = 560;   // shove-off/js/engine.js MAX_AIM: the longest arrow; parseAims refuses anything longer
const parts = (s) => String(s || '').split(';').map((p) => (p === '-' ? null : p.split(',').map(Number)));
const onBoard = (s) => new Set(String(s || '').split(' ').map((t) => t.split(':')[0]).filter(Boolean));
// Only a game vs the computer (x.cpu set): online, side 'a' may be the other player.
const sentOf = (x, side) => (x && x.cpu && Array.isArray(x.sent) ? x.sent.filter((q) => Array.isArray(q) && q[0] === side) : null);

export default [
  {
    // engine.js clampAim / parseAims: every aim is an integer arrow no longer than MAX_AIM.
    id: 'knockout-aim-too-long', proven: true,
    text: 'a shove harder than the longest arrow',
    check(e, { x }) {
      const s = sentOf(x, 'a');
      if (!s) return null;
      for (const q of s) for (const p of parts(q[2])) {
        if (p && p.length === 2 && p[0] * p[0] + p[1] * p[1] > MAX_AIM * MAX_AIM) return { v: `round ${q[1]}: an arrow ${Math.round(Math.hypot(p[0], p[1]))} long`, lim: MAX_AIM };
      }
      return null;
    },
  },
  {
    // engine.js: a piece that fell is out ('-' in its slot); only a piece still on the platform takes an aim. So an
    // aim for a slot whose piece was not on the platform at that round's start never came from the screen.
    id: 'knockout-aim-for-a-fallen-piece', proven: true,
    text: 'a shove for a piece already knocked off',
    check(e, { x }) {
      const s = sentOf(x, 'a');
      if (!s || !Array.isArray(x.rounds)) return null;
      for (const q of s) {
        const rec = x.rounds.find((r) => r && r.r === q[1]);
        if (!rec || rec.sd) continue;
        const on = onBoard(rec.before);
        const bad = parts(q[2]).findIndex((p, i) => p && !on.has(`a${i}`));
        if (bad >= 0) return { v: `round ${q[1]}: a shove for piece ${bad + 1}, which was off`, lim: '' };
      }
      return null;
    },
  },
  {
    // engine.js resolveRound: a side wins when the other has nothing left on the platform; the recorder is told
    // winner === 'a'. A win recorded while the last round left this player nothing and the computer something is
    // not a win (and the other way round).
    id: 'knockout-result-not-rounds', proven: true,
    text: 'a result the last round does not give',
    check(e, { a, x }) {
      if (!x || !x.cpu || !Array.isArray(x.rounds) || !x.rounds.length || x.end !== 'off' || !Array.isArray(a) || typeof a[2] !== 'boolean') return null;
      const last = x.rounds[x.rounds.length - 1], on = [...onBoard(last.after)];
      const mine = on.some((k) => k[0] === 'a'), theirs = on.some((k) => k[0] === 'b');
      if (a[2] && !mine && theirs) return { v: 'a win with no piece left', lim: '' };
      if (!a[2] && mine && !theirs) return { v: 'a loss with only this player\'s pieces left', lim: '' };
      return null;
    },
  },
  {
    // ui.js _down: each piece is aimed by dragging its arrow (a pointerdown on the canvas), so the player's aims
    // (any non-zero arrow) cannot outnumber the touches in the touch log.
    id: 'knockout-aims-without-touch', proven: true,
    text: 'shoves aimed without a finger on the screen',
    check(e, { x, n }) {
      const s = sentOf(x, 'a');
      if (!s || !n || n.cut > 0) return null;
      const aims = s.reduce((t, q) => t + parts(q[2]).filter((p) => p && (p[0] || p[1])).length, 0);
      return aims > n.downs ? { v: `${aims} aims, ${n.downs} touches`, lim: n.downs } : null;
    },
  },
  {
    // Suspicious: the very same arrow (to the unit) for one piece in three or more rounds: a replayed aim.
    id: 'knockout-same-aim-again', proven: false,
    text: 'the same shove, to the unit, round after round',
    check(e, { x }) {
      const s = sentOf(x, 'a');
      if (!s) return null;
      const m = {};
      for (const q of s) parts(q[2]).forEach((p, i) => { if (p && (p[0] || p[1])) { const k = `${i}|${p[0]},${p[1]}`; m[k] = (m[k] || 0) + 1; } });
      const top = Math.max(0, ...Object.values(m));
      return top >= 3 ? { v: `one arrow ${top} times`, lim: 3 } : null;
    },
  },
];
