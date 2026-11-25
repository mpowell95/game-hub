// js/trip-wires/airhockey.js - this game's own trip wires (2026-11-25; contract in js/trip-wires/index.js). PURE: no DOM,
// no network, no imports from the game's screen code (the server copies this file). Each rule:
//   { id: 'airhockey-<what>', text: '<plain words for the push and the admin page>', proven: true|false,
//     check(e, ctx) => null | { v, lim } }
// The private log `x` (air-hockey/js/ui.js _ahLog): goals [[scorer 0 = this player | 1, seconds into the match]],
// secs, myBest, oppBest, shots (mallet hits, both sides), cont (1 = the match was resumed from a save, so goals before
// the resume are not in `goals`), table, to, opp, cpu. `a` = recordAirHockey(diff, won, { goalsFor, goalsAgainst, shot }).
// js/integrity.js already has airhockey-goals-over-target.
const GOAL_PAUSE = 1.2;                 // air-hockey/js/physics.js PHYS.GOAL_PAUSE: seconds from a goal to the serve
const PUCK_MAX = 2300, MALLET_MAX = 3800, MALLET_E = 0.8;   // physics.js PHYS
// physics.js hit(): the shot speed is the puck's speed right after a mallet hit, before the cap: at most the puck's
// own (capped) speed plus (1 + MALLET_E) x the closing speed of puck and mallet.
const SHOT_MAX = PUCK_MAX + (1 + MALLET_E) * (PUCK_MAX + MALLET_MAX);
const GOAL_CAP = 40;                    // ui.js _goal keeps at most 40 goals
const extras = (a) => (a && a[2] && typeof a[2] === 'object' ? a[2] : null);

export default [
  {
    // ui.js _goal logs every goal as it is scored, and the recorder is handed the match's score; on a match not
    // resumed from a save, the logged goals are exactly the score (a resumed one: no more than it).
    id: 'airhockey-goals-not-logged', proven: true,
    text: 'a score its goals do not add up to',
    check(e, { a, x }) {
      const ex = extras(a);
      if (!ex || !x || !Array.isArray(x.goals) || x.goals.length >= GOAL_CAP) return null;
      const mine = x.goals.filter((g) => Array.isArray(g) && Number(g[0]) === 0).length, theirs = x.goals.filter((g) => Array.isArray(g) && Number(g[0]) === 1).length;
      const gf = Number(ex.goalsFor) || 0, ga = Number(ex.goalsAgainst) || 0;
      const bad = x.cont ? (mine > gf || theirs > ga) : (mine !== gf || theirs !== ga);
      return bad ? { v: `${gf}-${ga} recorded, ${mine}-${theirs} scored`, lim: `${mine}-${theirs}` } : null;
    },
  },
  {
    // physics.js: after a goal the puck waits GOAL_PAUSE seconds before the serve, so two goals are never closer.
    id: 'airhockey-goals-faster-than-serve', proven: true,
    text: 'goals closer together than the serve allows',
    check(e, { x }) {
      const g = x && Array.isArray(x.goals) ? x.goals.map((q) => Number(Array.isArray(q) ? q[1] : NaN)).filter(Number.isFinite) : null;
      if (!g || g.length < 2) return null;
      for (let k = 1; k < g.length; k++) if (g[k] - g[k - 1] < GOAL_PAUSE - 0.1) return { v: `goals ${k} and ${k + 1}: ${(g[k] - g[k - 1]).toFixed(1)} s apart`, lim: GOAL_PAUSE };
      return null;
    },
  },
  {
    // physics.js hit() and capSpeed(): no mallet can send the puck faster than SHOT_MAX.
    id: 'airhockey-shot-too-fast', proven: true,
    text: 'a shot faster than the table allows',
    check(e, { a, x }) {
      const ex = extras(a);
      const v = Math.max(Number(ex && ex.shot) || 0, Number(x && x.myBest) || 0);
      return v > SHOT_MAX + 1 ? { v: `a ${Math.round(v)} shot`, lim: Math.round(SHOT_MAX) } : null;
    },
  },
  {
    // Suspicious: five or more goals from under three mallet hits a goal (both sides' hits; real matches,
    // 2026-11-16 to 11-24: 8 hits a goal or more).
    id: 'airhockey-goal-every-hit', proven: false,
    text: 'goals from almost every touch of the puck',
    check(e, { a, x }) {
      const ex = extras(a);
      if (!ex || !x || !Number.isFinite(Number(x.shots)) || x.cont) return null;
      const gf = Number(ex.goalsFor) || 0;
      return gf >= 5 && Number(x.shots) < gf * 3 ? { v: `${gf} goals from ${x.shots} hits`, lim: gf * 3 } : null;
    },
  },
];
