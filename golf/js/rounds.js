// golf/js/rounds.js - the course list and what a ROUND is. Pure and DOM-free.
//
// A round is a course plus a slice of its holes. It is a separate concept from the course because
// the stored best is per ROUND, not per course: a 3-hole best and an 18-hole best on the same
// course are not the same measurement and must never be merged or compared (THE LAW rule 4).

import PINE_VALLEY from '../courses/pinevalley.js';
import RED_MESA from '../courses/redmesa.js';

export const COURSES = [PINE_VALLEY, RED_MESA];

export function courseById(id) { return COURSES.find((c) => c.id === id) || COURSES[0]; }

/** HOW A COURSE IS PLAYED. Matt, 2026-09-05: *"I want 3 modes: 3 hole, 9 hole, and 18 hole.
 *  That's the first selection. Then the second selection should be the course. If I chose 3 holes,
 *  each course should be broken into 6 options of 3 holes. if 9 holes is chosen, 2 options, and 18
 *  holes, just 1."*
 *
 *  THE FROZEN KEYS SURVIVE THIS UNTOUCHED, and that is not luck - it is why the suffixes below
 *  look the way they do. `roundKey` is `<course.id><suffix>`, so the four keys that already exist
 *  in players' stores (`pinevalley3`, `pinevalley9`, `pinevalley9b`, `pinevalley18`, and the same
 *  four for `redmesa`) are exactly the four rounds that already existed:
 *
 *    holes 1-3   suffix '3'    - was "Quick 3", is now three-hole SET 1. Same three holes, same
 *                                par, so the stored best still means precisely what it meant.
 *    holes 1-9   suffix '9'    - the front nine, unchanged.
 *    holes 10-18 suffix '9b'   - the back nine, unchanged.
 *    all 18      suffix '18'   - unchanged.
 *
 *  The five NEW three-hole sets take new suffixes ('3b'..'3f'). Nothing is renamed, nothing is
 *  repurposed and nothing is compared across lengths (THE LAW rules 4 and 5).
 *
 *  `mode` is what the player picks FIRST, and `set` numbers the options inside it. */
export const ROUNDS = [
  { id: 'quick3', mode: 3, set: 1, suffix: '3', labelKey: 'round_quick3', from: 0, to: 3 },
  { id: 'set3b', mode: 3, set: 2, suffix: '3b', labelKey: 'round_set3b', from: 3, to: 6 },
  { id: 'set3c', mode: 3, set: 3, suffix: '3c', labelKey: 'round_set3c', from: 6, to: 9 },
  { id: 'set3d', mode: 3, set: 4, suffix: '3d', labelKey: 'round_set3d', from: 9, to: 12 },
  { id: 'set3e', mode: 3, set: 5, suffix: '3e', labelKey: 'round_set3e', from: 12, to: 15 },
  { id: 'set3f', mode: 3, set: 6, suffix: '3f', labelKey: 'round_set3f', from: 15, to: 18 },
  { id: 'front9', mode: 9, set: 1, suffix: '9', labelKey: 'round_front9', from: 0, to: 9 },
  { id: 'back9', mode: 9, set: 2, suffix: '9b', labelKey: 'round_back9', from: 9, to: 18 },
  { id: 'full18', mode: 18, set: 1, suffix: '18', labelKey: 'round_full18', from: 0, to: 18 },
];

/** The three lengths, in the order the setup screen offers them. */
export const MODES = [3, 9, 18];

/** Every round of one length, in order. */
export function roundsOfMode(mode) { return ROUNDS.filter((r) => r.mode === mode); }

/** The hole NUMBERS a round covers, as a display string ("1-3", "10-18"). */
export function roundRange(round) {
  const r = typeof round === 'string' ? roundById(round) : round;
  return `${r.from + 1}-${r.to}`;
}

export function roundById(id) { return ROUNDS.find((r) => r.id === id) || ROUNDS[0]; }

/** The frozen bestRoundByCourse key for one course played one way. */
export function roundKey(course, roundId) { return `${course.id}${roundById(roundId).suffix}`; }

/** The hole INDICES this round plays, in order. A course with fewer holes than a round asks for
 *  simply plays what it has, so a nine-hole course could ship later without changing this. */
export function roundHoles(course, roundId) {
  const r = roundById(roundId);
  const out = [];
  for (let i = r.from; i < Math.min(r.to, course.holes.length); i++) out.push(i);
  return out;
}

export function roundPar(course, roundId) {
  return roundHoles(course, roundId).reduce((a, i) => a + course.holes[i].par, 0);
}

export function roundYards(course, roundId) {
  return roundHoles(course, roundId).reduce((a, i) => a + course.holes[i].cardYards, 0);
}

/** Modified Stableford points for one hole, as `js/game-stats.js` has always stored them: a pure
 *  function of (score, par), so the lifetime `gf.points` counter stays truthful with nothing
 *  fabricated (golf/CLAUDE.md, "Stored shape"). */
export function stablefordPoints(strokes, par) {
  const d = strokes - par;
  if (d <= -3) return 8;       // albatross
  if (d === -2) return 5;      // eagle
  if (d === -1) return 2;      // birdie
  if (d === 0) return 0;       // par
  if (d === 1) return -1;      // bogey
  return -3;                   // double or worse
}


/** THE PER-HOLE RECORD's key. Matt, 2026-09-05: *"we'll have individual hole records"*.
 *
 *  A course id and a hole number, and NOT a `roundKey` - a hole's best is the same number whether
 *  it was made during a 3-hole set, a nine or an eighteen, so folding the round into the key would
 *  split one record into nine and make a player's best score on a hole depend on how they happened
 *  to be playing that day. The separator is a colon, which no course id contains, so the key can
 *  never collide with a `bestRoundByCourse` key even though both live under `gf`. */
export function holeKey(course, holeNumber) { return `${course.id}:${holeNumber}`; }
