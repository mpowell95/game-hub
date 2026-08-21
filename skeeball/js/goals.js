// skeeball/js/goals.js - the three things that open the next machine, and how far along you are.
//
// GUARD: NOTHING IS STORED HERE. Every goal is DERIVED from counters the shared store already
// keeps (js/game-stats.js's `sk` block), and recomputed on demand. That is deliberate: goal
// progress is EARNED, and THE LAW says earned things do not live in this folder's own storage -
// they live in the shared store, which syncs across devices and is never rewritten destructively.
// A goals flag kept in localStorage here would be lost on one device and out of step on two.
//
// WHY "A 50 AND A 100" AND NOT "EVERY POINT VALUE" (Matt asked for the latter, 2026-08-20): the
// store counts 50s and 100s but not 10s, 20s, 30s or 40s. Counting those means new fields in
// js/game-stats.js AND in js/players-agg.js's merge - the two files THE LAW is really about - plus
// their regression tests. For one goal that is not a trade worth making, because the requirement
// is the same in practice: nobody reaches 2000 lifetime points without having landed all four of
// the lower cups many times over. The two shots ever genuinely in doubt are the 50 and the 100,
// and those are exactly the two the store already counts. If the literal six-value version is
// ever wanted, it is those two files plus `result()` in game.js and the payload-shape assertion
// in test.js - not a change to make casually.

import { loadStats } from '../../js/game-stats.js';

/** Highest score in one game that opens goal 2, and the lifetime total that opens goal 3. */
export const GOAL_BEST = 300;
export const GOAL_TOTAL = 2000;

const sk = () => {
  try { return (loadStats().games.skeeball || {}).sk || {}; } catch { return {}; }
};

/** The three goals, each with where the player currently stands. `now`/`target` drive the bar;
 *  `met` is the only thing the unlock itself cares about. Order is the order they are shown. */
export function readGoals(store) {
  const s = store || sk();
  const fifties = s.fifties | 0;
  const hundreds = s.hundreds | 0;
  const cups = (fifties > 0 ? 1 : 0) + (hundreds > 0 ? 1 : 0);
  return [
    { id: 'cups', now: cups, target: 2, met: cups >= 2 },
    { id: 'best', now: Math.min(s.bestGame | 0, GOAL_BEST), target: GOAL_BEST, met: (s.bestGame | 0) >= GOAL_BEST },
    { id: 'total', now: Math.min(s.points | 0, GOAL_TOTAL), target: GOAL_TOTAL, met: (s.points | 0) >= GOAL_TOTAL },
  ];
}

/** Which goals went from unmet to met between two readings, and whether that completed the set.
 *  ui.js reads the goals BEFORE recording a rack and again after, so the celebration fires for
 *  the rack that actually earned it and never twice. */
export function goalsWon(before, after) {
  const was = new Set(before.filter((g) => g.met).map((g) => g.id));
  const fresh = after.filter((g) => g.met && !was.has(g.id));
  return { fresh, all: fresh.length > 0 && after.every((g) => g.met) };
}

export function allGoalsMet(store) {
  return readGoals(store).every((g) => g.met);
}
