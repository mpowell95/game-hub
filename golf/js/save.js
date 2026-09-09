// golf/js/save.js - IS THIS SAVED ROUND USABLE? The pure half of golf's mid-round save.
//
// THE LAW (root CLAUDE.md): a round in progress is real work a player cannot recreate, and until
// 2026-09-09 golf had no snapshot of it at all - closing the app on the fifteenth hole of an
// eighteen destroyed the whole round without a word.
//
// This file is the VALIDATOR, and it is its own module for one reason: it is the piece where a
// half-written save turns into a WRONG round rather than no round, and that has to be testable
// without a browser. `golf/js/ui.js` owns the reading and writing (it owns the storage key); this
// owns the question "may I trust these bytes".
//
// A SAVE THAT RESTORES A ROUND INTO A SUBTLY WRONG STATE IS WORSE THAN NO SAVE. Nobody notices
// until the score is stored, and a stored best only ever improves (THE LAW rule 2) - so a wrong
// one can never be corrected by playing better. It sits at the top of the leaderboard for ever.
// That is why every field below is checked rather than trusted, and why a single bad field fails
// the WHOLE save instead of being defaulted: a round with one plausible-looking hole score
// invented by a default is exactly the thing this is here to prevent.

export const SAVE_V = 1;

const isNum = (v) => Number.isFinite(v);
const isIntIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** A hole score is a stroke count, or absent for a hole not reached yet. The ceiling is a sanity
 *  bound, not a rule - it only has to be far above anything a real hole can cost, because the
 *  number goes straight into a stored TOTAL. */
const MAX_STROKES = 40;

/**
 * Validate a raw stored save against the real course and round lists.
 *
 * Returns a normalized object (with `course` and `round` resolved) or null. Never throws, never
 * mutates its input, and never returns a partially-repaired save.
 */
export function validateSave(raw, courses, rounds) {
  try {
    if (!raw || typeof raw !== 'object' || raw.v !== SAVE_V) return null;
    const course = (courses || []).find((c) => c.id === raw.courseId);
    if (!course) return null;
    const round = (rounds || []).find((r) => r.id === raw.roundId);
    if (!round) return null;
    const holes = (course.holes || []).length;
    if (!holes) return null;

    const idxs = Array.isArray(raw.holeIdxs) ? raw.holeIdxs : null;
    if (!idxs || !idxs.length || idxs.length > holes) return null;
    if (!idxs.every((i) => isIntIn(i, 0, holes - 1))) return null;
    if (!isIntIn(raw.pos, 0, idxs.length - 1)) return null;

    const scores = Array.isArray(raw.scores) ? raw.scores : null;
    if (!scores || scores.length > idxs.length) return null;
    if (!scores.every((v) => v == null || isIntIn(v, 1, MAX_STROKES))) return null;

    const st = raw.roundStats;
    if (!st || typeof st !== 'object') return null;
    const stats = {};
    for (const k of ['birdies', 'eagles', 'aces', 'points', 'longestDriveYd']) {
      if (!isNum(st[k]) || st[k] < 0) return null;
      stats[k] = st[k];
    }

    if (!isIntIn(raw.shotN, 1, 200)) return null;
    if (!Array.isArray(raw.ball) || raw.ball.length !== 2 || !raw.ball.every(isNum)) return null;
    if (!isNum(raw.aimRad)) return null;

    return {
      v: SAVE_V,
      course,
      round,
      holeIdxs: idxs.slice(),
      pos: raw.pos,
      scores: scores.slice(),
      roundStats: stats,
      shotN: raw.shotN,
      ball: [raw.ball[0], raw.ball[1]],
      aimRad: raw.aimRad,
      clubId: typeof raw.clubId === 'string' ? raw.clubId : null,
      at: isNum(raw.at) ? raw.at : 0,
    };
  } catch { return null; }
}

/** Which hole a save will actually RESUME on. Not always `pos`: a save taken with a hole's result
 *  card up already has that hole scored, so the resume steps past it. Shared by the setup screen's
 *  label and the resume itself, because a button that says "hole 1" and opens hole 2 is a lie on
 *  the one screen a returning player uses to decide whether this is even their round. */
export function resumePos(sv) {
  if (!sv) return 0;
  return Number.isFinite(sv.scores[sv.pos])
    ? Math.min(sv.pos + 1, sv.holeIdxs.length - 1)
    : sv.pos;
}

/** Is every hole in this save scored? Then the round FINISHED and only the write was lost. */
export function isComplete(sv) {
  return !!sv && sv.holeIdxs.every((_, i) => Number.isFinite(sv.scores[i]));
}

export default { SAVE_V, validateSave, resumePos, isComplete };
