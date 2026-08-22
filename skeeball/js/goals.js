// skeeball/js/goals.js - each machine's three objectives, and how far along you are. THE
// CLASSIC's three are what open POPONGO (boards.js `unlock: { board: 'classic', goals: true }`,
// applied by ui.js via allGoalsMet); POPONGO's three are its own scoreboard until a machine 3
// exists to hang off them.
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
//
// PER-MACHINE since 2026-08-22 (POPONGO). Every reader passes the BOARD ID; each goal carries its
// own `labelKey` into strings.js so ui.js renders any machine's rails without knowing whose goals
// they are.
//
// GUARD: A MACHINE'S OBJECTIVES COUNT ONLY THAT MACHINE'S PLAYS - Matt, 2026-08-22, the day he
// caught a POPONGO rack advancing THE CLASSIC's "Total points": "Total points for that objective
// MUST be scored ONLY on THE CLASSIC... they should be completely distinct." So every score goal
// reads the machine's OWN per-board record (sk.boards.<id>, js/arcade-scores.js), never the
// lifetime-global sk fields, which blend all machines. (The classic briefly read the globals to
// avoid regressing pre-2026-08-11 progress; the 2026-08-22 stats clear made that moot, and
// per-board records ARE the complete record since.) The classic's hundreds goal reads the global
// sk.hundreds, which is inherently classic-only today - it counts 100-point balls and no other
// machine pays 100; give a future 100-paying machine its own counter rather than sharing this one.

import { loadStats } from '../../js/game-stats.js';

export const GOAL_HUNDREDS = 5;
export const GOAL_BEST = 360;
export const GOAL_TOTAL = 10000;

export const PG_COLORS = 4;      // POPONGO: land all four scoring colors in ONE game
export const PG_BEST = 30;       // POPONGO: score 30+ in a single game
export const PG_TOTAL = 1000;    // POPONGO: 1,000 points in total across games

export const BB_HOOP = 100;      // BASKET FEVER: sink the 100 hoop (proved by per-board bestThrow)
export const BB_BEST = 300;      // BASKET FEVER: score 300+ in a single game
export const BB_TOTAL = 3000;    // BASKET FEVER: 3,000 points in total on the machine

const sk = () => {
  try { return (loadStats().games.skeeball || {}).sk || {}; } catch { return {}; }
};

/** Each machine's three goals as one function over (store, live rack | null). `rack` is game.js's
 *  result() mid-rack, so the rails move ball by ball; readGoals passes null and answers from the
 *  recorded store alone, which is what the unlock itself trusts. */
const GOALS = {
  classic(s, r) {
    const b = (s.boards || {}).classic || {};
    // Five 100s EVER, not in one game. Global counter, but only the classic pays 100s.
    const h = (s.hundreds | 0) + (r ? r.hundreds | 0 : 0);
    const best = Math.max(b.best | 0, r ? r.score | 0 : 0);
    const total = (b.points | 0) + (r ? r.score | 0 : 0);
    return [
      { id: 'hundreds', labelKey: 'g_hundreds', now: Math.min(h, GOAL_HUNDREDS), target: GOAL_HUNDREDS, met: h >= GOAL_HUNDREDS },
      { id: 'best', labelKey: 'g_single', now: Math.min(best, GOAL_BEST), target: GOAL_BEST, met: best >= GOAL_BEST },
      { id: 'total', labelKey: 'g_total', now: Math.min(total, GOAL_TOTAL), target: GOAL_TOTAL, met: total >= GOAL_TOTAL },
    ];
  },
  popongo(s, r) {
    const b = (s.boards || {}).popongo || {};
    // All four colors in ONE game: the live rack's own distinct colors while playing
    // (game.js result().colorsHit), done-forever once any rack has swept them
    // (sk.colorSweeps, counted by recordSkeeball). The recorded store keeps no
    // best-colors-in-a-rack number on purpose - one more counter for a bar nobody
    // watches outside a live rack.
    const sweptEver = (s.colorSweeps | 0) > 0;
    const liveColors = r ? r.colorsHit | 0 : 0;
    const colorsNow = sweptEver ? PG_COLORS : Math.min(liveColors, PG_COLORS);
    const best = Math.max(b.best | 0, r ? r.score | 0 : 0);
    const total = (b.points | 0) + (r ? r.score | 0 : 0);
    return [
      { id: 'colors', labelKey: 'g_colors', now: colorsNow, target: PG_COLORS, met: sweptEver || liveColors >= PG_COLORS },
      { id: 'best', labelKey: 'g_single', now: Math.min(best, PG_BEST), target: PG_BEST, met: best >= PG_BEST },
      { id: 'total', labelKey: 'g_total', now: Math.min(total, PG_TOTAL), target: PG_TOTAL, met: total >= PG_TOTAL },
    ];
  },
  basketball(s, r) {
    const b = (s.boards || {}).basketball || {};
    // The 100 hoop: the top-centre basket is the only 100 on this face, so a per-board best
    // throw of 100 IS proof it was sunk - no new counter needed (b.bestThrow is Math.max only,
    // synced, and cross-device merged by js/arcade-scores.js). The rail shows the best throw
    // climbing toward 100 rather than a bare 0/1.
    const bt = Math.max(b.bestThrow | 0, r ? r.bestThrow | 0 : 0);
    const best = Math.max(b.best | 0, r ? r.score | 0 : 0);
    const total = (b.points | 0) + (r ? r.score | 0 : 0);
    return [
      { id: 'hoop', labelKey: 'g_hoop', now: Math.min(bt, BB_HOOP), target: BB_HOOP, met: bt >= BB_HOOP },
      { id: 'best', labelKey: 'g_single', now: Math.min(best, BB_BEST), target: BB_BEST, met: best >= BB_BEST },
      { id: 'total', labelKey: 'g_total', now: Math.min(total, BB_TOTAL), target: BB_TOTAL, met: total >= BB_TOTAL },
    ];
  },
};

/** The three goals for one machine, from the RECORDED store - what the unlock trusts. */
export function readGoals(boardId, store) {
  const fn = GOALS[boardId] || GOALS.classic;
  return fn(store || sk(), null);
}

/**
 * The same three, counting a rack that is STILL IN PROGRESS. The store only learns about a rack
 * when it is recorded, so without this the play screen's rails would sit frozen for the whole
 * nine balls and only jump at the end - which reads as broken, not as slow.
 *
 * `rack` is game.js's result() for the live rack. The unlock itself still runs off readGoals
 * against the recorded store; this is a display reading and nothing decides anything on it.
 */
export function readGoalsLive(boardId, rack, store) {
  const fn = GOALS[boardId] || GOALS.classic;
  return fn(store || sk(), rack || null);
}

/** Which goals went from unmet to met between two readings, and whether that completed the set.
 *  ui.js reads the goals BEFORE recording a rack and again after, so the celebration fires for
 *  the rack that actually earned it and never twice. */
export function goalsWon(before, after) {
  const was = new Set(before.filter((g) => g.met).map((g) => g.id));
  const fresh = after.filter((g) => g.met && !was.has(g.id));
  return { fresh, all: fresh.length > 0 && after.every((g) => g.met) };
}

export function allGoalsMet(boardId, store) {
  return readGoals(boardId, store).every((g) => g.met);
}
