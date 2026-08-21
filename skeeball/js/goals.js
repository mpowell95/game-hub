// skeeball/js/goals.js - the three things that open the next machine, and how far along you are.
//
// GUARD: NOTHING IS STORED HERE. Every goal is DERIVED from counters the shared store already
// keeps (js/game-stats.js's `sk` block), and recomputed on demand. That is deliberate: goal
// progress is EARNED, and THE LAW says earned things do not live in this folder's own storage -
// they live in the shared store, which syncs across devices and is never rewritten destructively.
// A goals flag kept in localStorage here would be lost on one device and out of step on two.
//
// EVERY POINT VALUE means every point value. The store used to count only 50s and 100s, so this
// briefly shipped as "land a 50 and a 100" on the reasoning that nobody reaches 2000 points
// without hitting the lower cups anyway. Matt's call, 2026-08-20: follow the requirement, do not
// approximate it. tens/twenties/thirties/forties now ride the same additive path the 50s and 100s
// always did (js/game-stats.js, and js/players-agg.js for the cross-device merge).

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
  // One ball in each of the six, ever - not in one game, and not one of each in a row.
  const cups = ['tens', 'twenties', 'thirties', 'forties', 'fifties', 'hundreds']
    .reduce((n, k) => n + ((s[k] | 0) > 0 ? 1 : 0), 0);
  return [
    { id: 'cups', now: cups, target: 6, met: cups >= 6 },
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
