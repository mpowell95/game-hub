// test-boggle-mp.mjs - headless assertions for Boggle's multiplayer round
// logic (boggle/js/mp-round.js). Node, no DOM, no dependencies.
//   node test-boggle-mp.mjs
//
// Boggle's MP protocol is deliberately NOT the lockstep move-log every other
// MP game in this repo uses (see js/CLAUDE.md's "Nth consumer: Boggle"
// section): a round has no shared mutable state during play, so there is
// nothing to hash-verify and no move log to replay against a FakeRoom the way
// test-mp-lockstep.mjs's T1-T7/M1-M6/F1-F6/DB1-DB6 blocks do for the other six
// games. Forcing this game into that harness would test a protocol it does
// not run. What genuinely needs a regression tripwire instead is the pure
// timing/comparison math both peers rely on to agree with each other despite
// never exchanging a single move -- that is exactly, and only, what this file
// covers.

import { roundEndsAt, remainingMs, wonFor, bothResultsIn } from './boggle/js/mp-round.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.error('  FAIL:', name)); };

// === roundEndsAt / remainingMs ================================================
//
// Both host and guest derive the SAME end time from the SAME two room-record
// fields (startedAt, config.timerMinutes) -- never from a locally-remembered
// "when I personally started looking at the board" moment. This is the one
// piece of Boggle MP that stands in for lockstep's hash check: if this ever
// drifts between two callers given the same inputs, the two devices would
// silently disagree about when the round is over.
{
  const startedAt = 1_000_000;
  ok('roundEndsAt: 1.5 minutes is 90000ms after start', roundEndsAt(startedAt, 1.5) === startedAt + 90000);
  ok('roundEndsAt: 1 minute is 60000ms after start', roundEndsAt(startedAt, 1) === startedAt + 60000);
  ok('roundEndsAt: 2 minutes is 120000ms after start', roundEndsAt(startedAt, 2) === startedAt + 120000);
  ok('remainingMs: exactly 0 right at the end timestamp', remainingMs(startedAt, 1, startedAt + 60000) === 0);
  ok('remainingMs: never negative past the end (a late rejoin does not go negative)',
    remainingMs(startedAt, 1, startedAt + 999999) === 0);
  ok('remainingMs: halfway through reports half the duration', remainingMs(startedAt, 1, startedAt + 30000) === 30000);
  // Garbage/missing inputs (a malformed or not-yet-populated room record)
  // must never throw or produce NaN -- a round record mid-write should read
  // as "over", not crash the mounting side.
  ok('roundEndsAt: missing startedAt does not throw or NaN', Number.isFinite(roundEndsAt(undefined, 1.5)));
  ok('remainingMs: missing timerMinutes clamps to 0, not NaN/negative', remainingMs(startedAt, undefined, startedAt) === 0);
}

// === wonFor ====================================================================
//
// Same three-way comparison solo play already uses in ui.js#finish()
// (humanScore === aiScore ? null : humanScore > aiScore), now shared so the
// human's own solo tie-break and the MP reveal screen's two-independently-
// reported-scores comparison can never disagree on what counts as a tie.
{
  ok('wonFor: strictly higher score wins', wonFor(42, 10) === true);
  ok('wonFor: strictly lower score loses', wonFor(10, 42) === false);
  ok('wonFor: equal scores tie (null), draws are real per boggle/CLAUDE.md', wonFor(17, 17) === null);
  ok('wonFor: two zero scores (both timed out with nothing found) tie', wonFor(0, 0) === null);
  ok('wonFor: missing/undefined scores treat as 0, never throw', wonFor(undefined, 5) === false);
}

// === bothResultsIn =============================================================
//
// The room record's hostResult/guestResult fields are siblings that
// reportRoundResult() writes but nothing ever clears on a rematch (startRound
// only resets round/moves/recovery -- see js/net.js). Without a per-result
// round number, a rematch's round 2 would read as "both results already in"
// the instant it started, using round 1's stale entries.
{
  const r1 = { n: 1, score: 10, at: 1 };
  const r2 = { n: 1, score: 8, at: 2 };
  const staleHost = { n: 1, score: 10, at: 1 }; // round 1's result, still sitting in the room
  const freshGuest = { n: 2, score: 5, at: 99 }; // round 2 just reported

  ok('bothResultsIn: true once both sides have reported the SAME round', bothResultsIn(r1, r2, 1));
  ok('bothResultsIn: false with only one side in', !bothResultsIn(r1, null, 1));
  ok('bothResultsIn: false with neither side in', !bothResultsIn(null, null, 1));
  ok('bothResultsIn: a stale prior-round host result never satisfies the CURRENT round',
    !bothResultsIn(staleHost, freshGuest, 2));
  ok('bothResultsIn: both present but for the wrong round number is false',
    !bothResultsIn(r1, r2, 2));
}

console.log(`\nBoggle MP tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
