// skeeball/js/goals.js - each machine's three objectives, and how far along you are. Every
// machine's three are what open the NEXT machine in the chain (boards.js `unlock: { board,
// goals: true }`, applied by ui.js via allGoalsMet). The order lives in boards.js and is written
// out once in skeeball/CLAUDE.md, "The unlock chain" - not here, because it has moved twice and
// a copy of it in a third file is a copy that goes stale.
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

// HOT SHOT, all three re-set by Matt on 2026-08-25 ahead of the machine going live. The first
// one is no longer a number at all: "hit every basket. Not every point value. Every basket."
// Same shape as BRICK CITY's, and it reuses the same per-board `slots` set - no new counter.
export const BB_BASKETS = 9;     // HOT SHOT: land in every basket at least once
export const BB_BEST = 700;      // HOT SHOT: score 700+ in a single game (was 300)
export const BB_TOTAL = 10000;   // HOT SHOT: 10,000 points in total on the machine (was 3,000)

// HOT SHOT: BRICK CITY. Its three are about its FACE, not about a number - Matt, 2026-08-24,
// replacing the first draft's "sink a 100" and "score 240 in a game":
//
//   1. EVERY BASKET, at least once. "they must hit every basket, not just every point value" -
//      nine slots, not six values: this face pays 100 twice, 40 twice and -20 twice, so counting
//      values would let a player skip three baskets entirely. Spread over as many racks as it
//      takes (nine balls into nine different baskets in one rack is not a goal, it is a lottery),
//      which is why it reads a UNION - sk.boards.brickcity.slots - rather than anything per-rack.
//   2. A CLEAN RACK: nine balls, points on the board, and not one penalty basket. "must score
//      points tho - can't just throw away all 9 balls, get 0s, and pass this objective" - so
//      game.js requires score > 0 as well as no negative ball, and gates the whole thing on the
//      board actually having a penalty basket.
//   3. NET points. "You gotta change the name of the total points one to net total points or
//      something since it goes up and down depending on the negative baskets." The number was
//      always the per-board points total; on this machine a rack contributes what it FINISHED
//      with after the penalties took their cut, so the label says so. Its own key, because the
//      other three machines' totals only ever go up and "Total points" is still true there.
//
// MEASURED on the 41x21 grid (skeeball/MACHINE-BRICKCITY.md has the table): of 861 clean cells
// 111 pay -20, 65 pay -10, 40 pay 40, 14 pay 20, 7 pay 50, 6 pay 100, and 563 pay nothing. Every
// one of the nine baskets is reachable - that is what the build sweep asserts - so goal 1 is a
// matter of working across the face rather than of luck.
//
// GUARD: POPONGO's unlock hangs off these three, so they have to be REACHABLE. Goal 1 is the slow
// one (the two 100s are 6 grid cells between them), and goal 2 is the sharp one - the penalty row
// is the easiest thing on the face to hit, by design. If either plays wrong once there are real
// racks behind it, change it HERE; do not resize a mouth, which is what makes the face mean
// something.
export const BC_BASKETS = 9;     // BRICK CITY: land in every basket at least once
export const BC_CLEAN = 1;       // BRICK CITY: one rack that scores and takes no penalty
export const BC_NET = 1500;      // BRICK CITY: 1,500 NET points in total on the machine

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
    // BASKETS: the recorded union, plus whatever the live rack has added, so the rail climbs ball
    // by ball instead of jumping at the end. Identical to BRICK CITY's - `slots` is a per-board
    // set in js/arcade-scores.js, unioned across devices, fed by game.js's slotsHit (REAL holes
    // only, so a miss into the trough can never complete it). No new counter.
    //
    // IT REPLACES "the 100 hoop" (Matt, 2026-08-25). Nothing is lost by the swap: b.bestThrow is
    // still recorded, still Math.max only, and still shown on the machine's own records - the
    // goal simply stops reading it. And the id changes from 'hoop' to 'baskets', so a player who
    // completed the old one keeps every unlock it earned (sk.unlocked is additive and nothing
    // removes an id) while the new objective starts where their own slots record starts.
    const seen = new Set(Object.keys(b.slots || {}).filter((k) => (b.slots || {})[k]));
    if (r && Array.isArray(r.slotsHit)) for (const id of r.slotsHit) seen.add(id);
    const baskets = Math.min(seen.size, BB_BASKETS);
    const best = Math.max(b.best | 0, r ? r.score | 0 : 0);
    const total = (b.points | 0) + (r ? r.score | 0 : 0);
    return [
      { id: 'baskets', labelKey: 'g_baskets', now: baskets, target: BB_BASKETS, met: baskets >= BB_BASKETS },
      { id: 'best', labelKey: 'g_single', now: Math.min(best, BB_BEST), target: BB_BEST, met: best >= BB_BEST },
      { id: 'total', labelKey: 'g_total', now: Math.min(total, BB_TOTAL), target: BB_TOTAL, met: total >= BB_TOTAL },
    ];
  },
  brickcity(s, r) {
    const b = (s.boards || {}).brickcity || {};
    // BASKETS: the recorded union, plus whatever the live rack has added, so the rail climbs
    // ball by ball instead of jumping at the end. A Set because the two overlap constantly.
    const seen = new Set(Object.keys(b.slots || {}).filter((k) => (b.slots || {})[k]));
    if (r && Array.isArray(r.slotsHit)) for (const id of r.slotsHit) seen.add(id);
    const baskets = Math.min(seen.size, BC_BASKETS);
    // CLEAN: done forever once any rack has managed it. The live rack only counts when it is
    // actually finished - game.js will not report cleanRack until all nine balls are spent, so a
    // rack that is clean SO FAR cannot light this early and then un-light on the last ball.
    const clean = (b.cleanRacks | 0) + (r ? r.cleanRack | 0 : 0);
    const net = (b.points | 0) + (r ? r.score | 0 : 0);
    return [
      { id: 'baskets', labelKey: 'g_baskets', now: baskets, target: BC_BASKETS, met: baskets >= BC_BASKETS },
      { id: 'clean', labelKey: 'g_clean', now: Math.min(clean, BC_CLEAN), target: BC_CLEAN, met: clean >= BC_CLEAN },
      { id: 'net', labelKey: 'g_net', now: Math.min(net, BC_NET), target: BC_NET, met: net >= BC_NET },
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
