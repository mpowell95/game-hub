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

## Open items (nothing below is built)

1. **How to play is 84 words (EN), 88 (ES).** Proposed ~35 words, 5 lines: "Knock the other team to 0 HP." / "Swap 2 tiles
   to line up 3." / "Gems charge their monster. Full bar = special." / "4 berries: tap a monster to evolve." / "Match next
   to a bomb: it blows." Offered to Matt; he has not said "build it".
2. **End card line** "Better luck next time, <loser>" on a win: a reviewer said it can read as a loss message. Kept; Matt
   has not decided.
3. **Not tested on two real phones**: live rooms and challenges are proven headlessly (fake Firebase) only.
4. **Release** only on Matt's "release it": checklist at the end of `battle-arena/CLAUDE.md`, "Release review".
5. **Rules version**: any `engine.js` change after release must stamp `rv: 2` on new matches and keep v1's paths.

## Tests

`node battle-arena/js/test.js`, `node tools/test-battlearena-mp.mjs`, `node tools/test-battlearena-carry.mjs`,
`node tools/test-battlearena-back.mjs` (dev server on 8123), `node tools/check-no-scroll.mjs battle-arena`,
`node tools/test-game-conventions.mjs`.
