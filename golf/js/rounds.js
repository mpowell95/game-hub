// golf/js/rounds.js - the course list and what a ROUND is. Pure and DOM-free.
//
// A round is a course plus a slice of its holes. It is a separate concept from the course because
// the stored best is per ROUND, not per course: a 3-hole best and an 18-hole best on the same
// course are not the same measurement and must never be merged or compared (THE LAW rule 4).

import PINE_VALLEY from '../courses/pinevalley.js';
import RED_MESA from '../courses/redmesa.js';

export const COURSES = [PINE_VALLEY, RED_MESA];

export function courseById(id) { return COURSES.find((c) => c.id === id) || COURSES[0]; }

/** The four ways to play a course. `slice` picks the holes; `suffix` is the stored key's tail.
 *
 *  THE KEY IS `<course.id><suffix>`, AND THAT IS NOT A COINCIDENCE. `pinevalley3` was frozen as a
 *  bestRoundByCourse key back when Pine Valley WAS three holes (golf/CLAUDE.md, "Names - frozen
 *  forever"), so the course id is `pinevalley` and the quick round's suffix is `3`, and the frozen
 *  key falls straight out of the rule with nothing repurposed and nothing special-cased. THE LAW
 *  rule 5 holds by construction rather than by a lookup table someone has to remember to update.
 *
 *  `pinevalley9` was already promised in this file's docs for "when holes 4-9 ship". They have. */
export const ROUNDS = [
  { id: 'quick3', suffix: '3', labelKey: 'round_quick3', from: 0, to: 3 },
  { id: 'front9', suffix: '9', labelKey: 'round_front9', from: 0, to: 9 },
  { id: 'back9', suffix: '9b', labelKey: 'round_back9', from: 9, to: 18 },
  { id: 'full18', suffix: '18', labelKey: 'round_full18', from: 0, to: 18 },
];

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
