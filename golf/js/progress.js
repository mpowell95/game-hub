// golf/js/progress.js - WHAT THE PLAYER HAS EARNED THE RIGHT TO PLAY. Pure, DOM-free and
// storage-free: every function here takes the player's `gf` object and answers a question about
// it, so golf/js/test.js can measure the whole ladder without a browser.
//
// Matt, 2026-09-08:
//
//   "we're going to release Pine Valley as the only course to start with. And 9 holes and 18 holes
//    need to be locked. They have to play a practice hole /tutorial, then holes 1-3 unlock. Then
//    when they've shot par or better, the next set of 3 will unlock, and so on. Once they've
//    unlocked all the 3 hole things, they can then play 9 hole rounds. Again, they play the front
//    until they shoot par or better, then the back unlocks, then when they shoot par or better, 18
//    holes unlocks"
//
// ============================================================================================
// NOTHING NEW IS STORED FOR ANY OF THIS, AND THAT IS THE WHOLE DESIGN.
//
// A progression is earned data, so under THE LAW it can never be lost, never be rebuilt wrong, and
// never disagree between a player's two phones. The obvious implementation - an `unlocked: [...]`
// array written as the player goes - fails all three: it is a second source of truth that has to
// be migrated, merged and re-derived, and a device that syncs a stale copy would TAKE UNLOCKS
// AWAY, which is rule 1 (a thing the player earned that no screen shows reads as deleted).
//
// So the ladder is DERIVED, every time, from records that already exist:
//
//   * a 3-hole set, a nine and an eighteen are unlocked off `gf.bestRoundByCourse`, which has
//     stored strokes per round key since Stage D, syncs to `players/<id>` already, and merges
//     across devices with a per-key `Math.min` in js/players-agg.js;
//   * the tutorial is unlocked off `gf.bestHole['tutorial:1']`, which is an ordinary per-hole
//     record written through the ordinary `holeOnly` path.
//
// Consequences worth stating out loud, because they are the reason to do it this way:
//
//   - A player who has already shot par on holes 1-3 on their old phone has set 2 unlocked on a
//     brand-new phone the moment stats sync, with no migration and no extra write.
//   - An unlock cannot be lost by a merge, because `Math.min` on a stroke count only ever makes
//     the requirement MORE satisfied.
//   - There is no key to freeze, deprecate or repurpose here at all (rules 4 and 5), and this file
//     could be deleted tomorrow without a single stored byte becoming unreadable.
// ============================================================================================

import { ROUNDS, roundKey, roundPar, roundsFor, roundById } from './rounds.js';

/** The tutorial is a one-hole course whose id is frozen the moment anybody finishes it, exactly
 *  like a real course id (THE LAW rule 5). It is deliberately NOT in `COURSES`: it has no rounds,
 *  no bests, no leaderboard row and no place in the course picker - it is a lesson, and the only
 *  trace it leaves is this one hole record. */
export const TUTORIAL_COURSE_ID = 'tutorial';
export const TUTORIAL_HOLE_KEY = `${TUTORIAL_COURSE_ID}:1`;

/** WHICH COURSES ARE LIVE IN THE CODE. Matt: "we're going to release Pine Valley as the only
 *  course to start with."
 *
 *  This is a DEFAULT, not a decision the family is stuck with: `js/admin-config.js`'s per-course
 *  resolvers (`resolveCourseReleased` / `resolveCourseTesting`) sit on top of it and have done
 *  since 2026-09-03, waiting for exactly this caller. So releasing Red Mesa is a tap on the admin
 *  page rather than a deploy - the same rule the game's own `devOnly` follows, and the same reason:
 *  two switches for one decision is how a game ends up shipped hidden by accident. */
export const COURSE_OPEN_BY_DEFAULT = { pinevalley: true, redmesa: false, oasissands: false };

export function courseOpenByDefault(courseId) { return COURSE_OPEN_BY_DEFAULT[courseId] === true; }

/** The `gf` object out of a stats store, defaulted so every reader below can assume a shape. A
 *  missing or malformed store means "has played nothing", never a crash - the same contract the
 *  profile has. */
export function gfOf(stats) {
  try {
    const gf = (((stats || {}).games || {}).golf || {}).gf;
    return (gf && typeof gf === 'object') ? gf : {};
  } catch { return {}; }
}

/** Has this player finished the tutorial hole? Its own score is irrelevant - Matt: "Once they've
 *  finished that hole (score doesn't matter), they can play the first set of 3 holes." */
export function tutorialDone(gf) {
  const v = ((gf || {}).bestHole || {})[TUTORIAL_HOLE_KEY];
  return Number.isFinite(v) && v > 0;
}

/** The fewest strokes this player has ever taken on one round, or null. */
export function bestOn(gf, course, roundId) {
  const v = ((gf || {}).bestRoundByCourse || {})[roundKey(course, roundId)];
  return Number.isFinite(v) ? v : null;
}

/** Has this player shot PAR OR BETTER on this round? That is the whole gate, and it is `<=` on
 *  purpose: par is a pass. */
export function beaten(gf, course, roundId) {
  const best = bestOn(gf, course, roundId);
  return best != null && best <= roundPar(course, roundId);
}

/** The three-hole sets a COURSE actually has, in order. Nine-hole courses have three of them, not
 *  six, so the ladder has to be read off the course rather than off `ROUNDS`. */
export function setsOfCourse(course) {
  return roundsFor(course).filter((r) => r.mode === 3).sort((a, b) => a.set - b.set);
}

/** WHAT ONE ROUND IS WAITING ON. Returns `{ unlocked, need }`, where `need` is null once it is
 *  open and otherwise names the ONE thing standing in the way - which is what the setup screen
 *  prints, so the player is never told "locked" without being told why.
 *
 *    { kind: 'tutorial' }                     play the tutorial hole
 *    { kind: 'par', roundId, par }            shoot par or better on that round
 *    { kind: 'unlock', roundId }              unlock that round first (the nines wait on the last
 *                                             three-hole set being UNLOCKED, not beaten)
 */
const OPEN = { unlocked: true, need: null };
const open = () => OPEN;

export function roundState(course, roundId, gf) {
  const r = roundById(roundId);
  const sets = setsOfCourse(course);

  if (r.mode === 3) {
    // The first set is the tutorial's reward; every later one is the previous one's.
    const i = sets.findIndex((s) => s.id === r.id);
    if (i <= 0) {
      return tutorialDone(gf) ? open() : { unlocked: false, need: { kind: 'tutorial' } };
    }
    const prev = sets[i - 1];
    return beaten(gf, course, prev.id) ? open()
      : { unlocked: false, need: { kind: 'par', roundId: prev.id, par: roundPar(course, prev.id) } };
  }

  if (r.mode === 9) {
    // THE FRONT NINE OPENS WHEN THE LAST THREE-HOLE SET IS UNLOCKED, NOT WHEN IT IS BEATEN.
    // Matt's words are "Once they've UNLOCKED all the 3 hole things, they can then play 9 hole
    // rounds", and this follows them literally: unlocking set 6 is itself the reward for shooting
    // par on set 5, so the player has already proved something on five of the six. If he meant
    // "beaten", this is the one line to change - `roundState(...).unlocked` becomes
    // `beaten(gf, course, last.id)`.
    if (r.set === 1) {
      const last = sets[sets.length - 1];
      if (!last) return open();
      return roundState(course, last.id, gf).unlocked ? open()
        : { unlocked: false, need: { kind: 'unlock', roundId: last.id } };
    }
    const front = roundsFor(course).find((x) => x.mode === 9 && x.set === 1);
    if (!front) return open();
    return beaten(gf, course, front.id) ? open()
      : { unlocked: false, need: { kind: 'par', roundId: front.id, par: roundPar(course, front.id) } };
  }

  // Eighteen waits on the back nine, which is the last thing before it.
  const back = roundsFor(course).find((x) => x.mode === 9 && x.set === 2);
  if (!back) return open();
  return beaten(gf, course, back.id) ? open()
    : { unlocked: false, need: { kind: 'par', roundId: back.id, par: roundPar(course, back.id) } };
}

export function roundUnlocked(course, roundId, gf) { return roundState(course, roundId, gf).unlocked; }

/** A LENGTH is offered when any round of that length is open. The setup screen still SHOWS a
 *  locked length rather than hiding it - a ladder you cannot see is not a ladder, it is a
 *  disappointment waiting to happen - but it says what it is waiting on. */
export function modeUnlocked(course, mode, gf) {
  return roundsFor(course).some((r) => r.mode === mode && roundUnlocked(course, r.id, gf));
}

/** WHICH HOLES MAY BE PRACTISED. A hole is open to practice once the round that introduces it is
 *  unlocked, so practice cannot be used to walk the whole course before earning any of it - and
 *  the tutorial, which is the first thing anybody plays, is not on this list because it is not on
 *  this course.
 *
 *  Returned as a Set of hole INDICES, which is what the hole-select screen iterates. */
export function practisableHoles(course, gf) {
  const out = new Set();
  for (const r of roundsFor(course)) {
    if (r.mode !== 3) continue;                      // the sets are the fine-grained ladder
    if (!roundUnlocked(course, r.id, gf)) continue;
    for (let i = r.from; i < Math.min(r.to, course.holes.length); i++) out.add(i);
  }
  return out;
}

/** How far up the ladder this player is, as `{ done, total }` over every round the course has.
 *  Display only - nothing gates on it - but it is what lets the screen say "4 of 9" rather than
 *  leaving the player to count locks. */
export function ladderProgress(course, gf) {
  const rs = roundsFor(course);
  return { done: rs.filter((r) => roundUnlocked(course, r.id, gf)).length, total: rs.length };
}

export { ROUNDS };
