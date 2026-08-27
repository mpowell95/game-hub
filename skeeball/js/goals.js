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
export const BB_TOTAL = 30000;   // HOT SHOT: 30,000 points in total on the machine (3,000 -> 10,000 -> 30,000)

// HOT SHOT: BRICK CITY. Its three are about its FACE, not about a number - Matt, 2026-08-24,
// replacing the first draft's "sink a 100" and "score 240 in a game" - and RAISED on 2026-08-25,
// the day the machine was cleared to go live, because the first set was sized for a machine only
// he was playing:
//
//   1. EVERY BASKET, THREE TIMES. "you have to hit every basket 3 times." Nine slots, not six
//      values: this face pays 100 twice, 40 twice and -20 twice, so counting values would let a
//      player skip three baskets entirely. Counting HITS rather than a set is what the x3 needs -
//      sk.boards.brickcity.slotHits, added the same day (js/arcade-scores.js). The `slots` set is
//      still written and still read by HOT SHOT; it was not repurposed (THE LAW rule 5).
//      Spread over as many rounds as it takes; nine baskets three times each in one rack is not a
//      goal, it is a lottery.
//   2. THREE PERFECT ROUNDS. "It means no 0s and no negatives. You have to do that 3 times."
//      That is STRICTLY harder than the clean round this replaces, which let a ball miss the face
//      entirely as long as it did not cost points. game.js reports perfectRack only when all nine
//      balls are spent and every one of them scored. `cleanRacks` is still counted and still
//      stored - nothing that was recorded stops being recorded - it is simply no longer what the
//      objective reads.
//   3. NET points, 30,000 - HOT SHOT's number, which Matt set for this machine too. On this face
//      a round contributes what it FINISHED with after the penalties took their cut, which is why
//      the label says NET where the other machines say Total.
//
// MEASURED on the 41x21 grid (skeeball/MACHINE-BRICKCITY.md has the table): of 861 clean cells
// 111 pay -20, 65 pay -10, 40 pay 40, 14 pay 20, 7 pay 50, 6 pay 100, and 563 pay nothing. Every
// one of the nine baskets is reachable - that is what the build sweep asserts - so goal 1 is a
// matter of working across the face rather than of luck.
//
// GUARD: POPONGO's unlock hangs off these three, so they have to be REACHABLE. Goal 1 is the slow
// one (the two 100s are 6 grid cells between them and each is now wanted three times), and goal 2
// is the sharp one - the penalty row is the easiest thing on the face to hit, by design, and a
// perfect round has to clear it nine times running. If either plays wrong once there are real
// rounds behind it, change it HERE; do not resize a mouth, which is what makes the face mean
// something.
export const BC_BASKETS = 9;       // BRICK CITY: all nine baskets...
export const BC_BASKET_HITS = 3;  // ...each landed this many times (was: at least once)
export const BC_PERFECT = 3;      // BRICK CITY: three rounds where all nine balls scored
export const BC_NET = 30000;      // BRICK CITY: 30,000 NET points in total (was 1,500)

// HOT SHOT: RUNAWAY. Its three are about the one thing that makes it different - the top row's
// 100 is moving, so hitting it once is a real achievement and hitting it twice in nine balls is
// the machine's whole skill ceiling.
//
//   1. CATCH THE RUNAWAY: sink the moving 100 once. Read off the per-board bestThrow exactly the
//      way HOT SHOT reads its own hoop goal - the 100 is the only thing on this face worth 100,
//      so a per-board best throw of 100 IS proof it was sunk, and no new counter is needed. The
//      rail shows the best throw climbing (60 -> 100) rather than a bare 0/1.
//   2. A single game of 240. Below HOT SHOT's 300 on purpose: this face has seven baskets to
//      that machine's nine and the two easiest 50s on its top row are gone.
//   3. 2,500 points in total on the machine.
//
// GUARD: these three are what would unlock a SIXTH machine, so they have to stay REACHABLE.
// Goal 1 is the slow one - sweep-mover.mjs measures the moving 100 as reachable across the
// aim x power x phase grid, but a narrow band of it. If any of the three plays wrong once there
// are real racks behind it, change the NUMBER here; do not widen the mouth or slow the sweep,
// which are the two things that make this machine what it is.
// GUARD: GOAL 1 IS A COUNTER NOW, NOT A BEST THROW, AND IT HAD TO CHANGE. It used to read the
// per-board `bestThrow` - fine while the machine had exactly one 100 and that 100 was always
// moving, because a 100 could only have come from the moving basket. The twin-100 rebuild
// (2026-08-26) makes a rack OPEN with two STILL 100s, so a bestThrow of 100 can now be earned on
// ball 1 against a parked target and proves nothing about the sweep. sk.runaways counts balls
// landed in the basket WHILE IT WAS RUNNING, which is the thing the objective is about.
// b.bestThrow is untouched, still Math.max only and still shown on the machine's own records -
// the goal simply stops reading it (the same swap HOT SHOT made, 2026-08-25). The goal id stays
// 'runaway', so anyone who completed the old version keeps every unlock it earned - sk.unlocked
// is additive and nothing anywhere removes an id (THE LAW rule 2).
// RE-SET 2026-08-27, by Matt, after he cleared two of the three in his FIRST rack (260 exactly,
// against a 260 bar, with one runaway caught against a bar of one). All three moved, and the shape
// changed with them: this machine's objectives are about its face, not about a score.
export const RA_RUNAWAYS = 10;   // RUNAWAY: catch a moving basket 10 times, on ANY row
export const RA_FULL = 1;        // RUNAWAY: land in EVERY basket in one round
export const RA_TOTAL = 10000;   // RUNAWAY: 10,000 points in total on the machine

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
      { id: 'hundreds', labelKey: 'g_hundreds', defKey: 'd_cl_hundreds', now: Math.min(h, GOAL_HUNDREDS), target: GOAL_HUNDREDS, met: h >= GOAL_HUNDREDS },
      { id: 'best', labelKey: 'g_single', defKey: 'd_single', now: Math.min(best, GOAL_BEST), target: GOAL_BEST, met: best >= GOAL_BEST },
      { id: 'total', labelKey: 'g_total', defKey: 'd_total', now: Math.min(total, GOAL_TOTAL), target: GOAL_TOTAL, met: total >= GOAL_TOTAL },
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
      { id: 'colors', labelKey: 'g_colors', defKey: 'd_pg_colors', now: colorsNow, target: PG_COLORS, met: sweptEver || liveColors >= PG_COLORS },
      { id: 'best', labelKey: 'g_single', defKey: 'd_single', now: Math.min(best, PG_BEST), target: PG_BEST, met: best >= PG_BEST },
      { id: 'total', labelKey: 'g_total', defKey: 'd_total', now: Math.min(total, PG_TOTAL), target: PG_TOTAL, met: total >= PG_TOTAL },
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
      { id: 'baskets', labelKey: 'g_baskets', defKey: 'd_bb_baskets', now: baskets, target: BB_BASKETS, met: baskets >= BB_BASKETS },
      { id: 'best', labelKey: 'g_single', defKey: 'd_single', now: Math.min(best, BB_BEST), target: BB_BEST, met: best >= BB_BEST },
      { id: 'total', labelKey: 'g_total', defKey: 'd_total', now: Math.min(total, BB_TOTAL), target: BB_TOTAL, met: total >= BB_TOTAL },
    ];
  },
  runaway(s, r) {
    const b = (s.boards || {}).runaway || {};
    // CATCH A RUNAWAY: the recorded lifetime count plus whatever the live rack has added, so the
    // rail moves the moment it happens rather than at the end of the round.
    //
    // ANY ROW, not just the top one - Matt asked which it meant and chose any (2026-08-27). This
    // machine's identity is baskets that run away, and every row's last one standing does.
    //
    // sk.runaways is a GLOBAL counter, and that is safe here in a way it would not be for most
    // objectives: RUNAWAY is the only machine in the repo with a moving basket, so it is the only
    // machine that can ever write to it. game.js sets result().runaways to 0 everywhere else.
    const caught = (s.runaways | 0) + (r ? r.runaways | 0 : 0);
    // EVERY BASKET IN ONE ROUND. A PER-BOARD counter (js/arcade-scores.js), summed across devices,
    // fed by game.js's result().fullRack - which is measured against this board's own holes, so no
    // other machine can satisfy it and it cannot be completed by missing (the trough is not a
    // basket). The live rack counts too, but only when it has ACTUALLY covered the face.
    const fullEver = (b.fullRacks | 0) + (r ? r.fullRack | 0 : 0);
    const total = (b.points | 0) + (r ? r.score | 0 : 0);
    return [
      { id: 'runaway', labelKey: 'g_runaway', defKey: 'd_ra_hoop', now: Math.min(caught, RA_RUNAWAYS), target: RA_RUNAWAYS, met: caught >= RA_RUNAWAYS },
      { id: 'full', labelKey: 'g_ra_full', defKey: 'd_ra_full', now: Math.min(fullEver, RA_FULL), target: RA_FULL, met: fullEver >= RA_FULL },
      { id: 'total', labelKey: 'g_total', defKey: 'd_total', now: Math.min(total, RA_TOTAL), target: RA_TOTAL, met: total >= RA_TOTAL },
    ];
  },
  brickcity(s, r) {
    const b = (s.boards || {}).brickcity || {};
    // BASKETS x3: recorded hit COUNTS plus whatever the live round has added, so the rail climbs
    // ball by ball instead of jumping at the end. A basket counts once it has been landed
    // BC_BASKET_HITS times; the rail reads "how many baskets are done", which is the only shape
    // that fits a 76px box and still says something true.
    const hits = {};
    const rec = b.slotHits || {};
    for (const id of Object.keys(rec)) hits[id] = rec[id] | 0;
    if (r && r.slotCounts) {
      for (const id of Object.keys(r.slotCounts)) hits[id] = (hits[id] | 0) + (r.slotCounts[id] | 0);
    }
    const baskets = Math.min(Object.keys(hits).filter((id) => (hits[id] | 0) >= BC_BASKET_HITS).length,
      BC_BASKETS);
    // PERFECT: the live round only counts when it is actually finished - game.js will not report
    // perfectRack until all nine balls are spent, so a round that is perfect SO FAR cannot light
    // this early and then un-light on the last ball.
    const perfect = (b.perfectRacks | 0) + (r ? r.perfectRack | 0 : 0);
    const net = (b.points | 0) + (r ? r.score | 0 : 0);
    return [
      { id: 'baskets', labelKey: 'g_baskets3', defKey: 'd_bc_baskets', now: baskets, target: BC_BASKETS, met: baskets >= BC_BASKETS },
      { id: 'perfect', labelKey: 'g_perfect', defKey: 'd_bc_perfect', now: Math.min(perfect, BC_PERFECT), target: BC_PERFECT, met: perfect >= BC_PERFECT },
      { id: 'net', labelKey: 'g_net', defKey: 'd_bc_net', now: Math.min(net, BC_NET), target: BC_NET, met: net >= BC_NET },
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
