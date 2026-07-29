// mp-round.js - pure, DOM-free helpers for Boggle multiplayer round timing and
// result comparison. Same seam as game.js/solver.js/ai.js: no DOM, so
// test-boggle-mp.mjs can exercise this without a browser.
//
// Boggle's MP round is NOT lockstep (see boggle/CLAUDE.md and js/CLAUDE.md's
// "Nth consumer: Boggle" section): both sides play the same shared board
// completely independently against their own copy of the clock, so there is
// no move log and nothing to hash-verify. What DOES need to be exactly right,
// shared code, is: (a) both sides computing the same round end time from the
// same inputs, and (b) both sides agreeing on the winner from two independently
// reported scores. Both are pure functions, kept here rather than duplicated
// inline in ui.js so a mistake in either can't quietly diverge between the
// host's and guest's copies of the code (they already share the file).

/** The round's fixed end timestamp, derived from when it started (`startedAt`,
 *  epoch ms) and the room's configured duration (`timerMinutes`). Both host
 *  and guest call this with the SAME two inputs (both come from the room
 *  record, never a locally-remembered value), so a rejoin or a slow dictionary
 *  load can never leave the two sides counting down different clocks. */
export function roundEndsAt(startedAt, timerMinutes) {
  return (Number(startedAt) || 0) + Math.round((Number(timerMinutes) || 0) * 60000);
}

/** Milliseconds left at `now` (default: real time), never negative. */
export function remainingMs(startedAt, timerMinutes, now = Date.now()) {
  return Math.max(0, roundEndsAt(startedAt, timerMinutes) - now);
}

/** true/false/null (won/lost/tied) for MY score against the OPPONENT's score.
 *  Exactly the same three-way comparison solo play already uses in
 *  ui.js#finish() (`humanScore === aiScore ? null : humanScore > aiScore`),
 *  extracted so both the human's own finish() and the MP reveal screen (which
 *  has to compare two independently-reported scores, not one known board and
 *  one just-sampled AI list) share one implementation. */
export function wonFor(myScore, oppScore) {
  const a = Number(myScore) || 0, b = Number(oppScore) || 0;
  if (a === b) return null;
  return a > b;
}

/** True once both sides' results for round `n` have landed in the room
 *  record. Each reported result carries its OWN round number (see
 *  net.js's reportRoundResult / ui.js's _mpReportResult) precisely so a
 *  rematch's fresh round can never be satisfied by the PREVIOUS round's
 *  still-present result fields -- `reportRoundResult` writes `hostResult`/
 *  `guestResult` as siblings that are never cleared by `startRound`, so
 *  without this per-result round-number check a rematch would appear
 *  "already both in" the instant it started. */
export function bothResultsIn(hostResult, guestResult, n) {
  return !!(hostResult && guestResult && hostResult.n === n && guestResult.n === n);
}

export default { roundEndsAt, remainingMs, wonFor, bothResultsIn };
