# Handoff: Battle Arena, 2026-11-13

Written by a session, not by Matt. Matt's words in quotes; anything else is NOT cleared for players.

Start by reading `battle-arena/CLAUDE.md` (every rule and fix below is summarised there, newest sections last).

## Where it stands

- Battle Arena is **admin and testers only** (`devOnly`, TEST MODE tag on). Live build v1557+.
- Done today, all live for admins/testers:
  - Release review: no lost results (`recordOutcome`), live claim/resign race fixed (forfeit in the room's end), live
    recovery fixed, hub Leave resigns a live match, challenge win counted only once on the server, outbox merge,
    automation guard, mode + detail on every result. PRs #1612.
  - Test plays carried at release (`CARRY_TEST.battlearena`, `combineCopiedRecords`, never double counted). PR #1625.
    Matt: "have test plays count. and have plays from non-admins count".
  - Swipe back one screen like the leaderboard (`armBack`, `back()` export). PR #1627.
  - Second UI/UX review fixes. PR #1627.
  - New launcher tile = mockup option C (`docs/mockups/battle-arena-tile/`). PR #1637. Matt: "C is the best. go with it."
  - iPhone notes: home centred on tall phones (`spreadHome`), "Your Turn" in the name slot, bubble shield with its number
    (`paintShield`), doors shut from the first frame with "Boiler Room" on them. PR #1639.

## Open items: all closed (2026-11-13, second session)

1. How to play cut to 37 words (Matt: "build it"). Done.
2. "Better luck next time" line removed from the end card (Matt: "build it"). Done.
3. Two-phone test: Matt: "you can't test this so remove this as an open item". Removed.
4. Release: Matt: "not applicable yet". Checklist stays in `battle-arena/CLAUDE.md`, "Release review".
5. Rules version: a standing rule, in `battle-arena/CLAUDE.md`.

## Tests

`node battle-arena/js/test.js`, `node tools/test-battlearena-mp.mjs`, `node tools/test-battlearena-carry.mjs`,
`node tools/test-battlearena-back.mjs` (dev server on 8123), `node tools/check-no-scroll.mjs battle-arena`,
`node tools/test-game-conventions.mjs`.
