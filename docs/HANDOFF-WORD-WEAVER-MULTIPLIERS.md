# Handoff: Word Weaver's level multipliers (2026-11-16)

**Written by a session, not by Matt.** Matt's words (2026-11-16): *"give handoff doc for the changes you'd make"*.

**Cleared: this document only.** NOT cleared: building it, merging it, or anything players can see. Do not start
until Matt says so in his own words ("build it"), and do not put it in front of players until he says "release it",
"ship it", or "make it live for everyone" (root `CLAUDE.md`). Ask him which he means before touching code.

## The change

One change, one game. Everything else in the review stays as it is.

| Level | Levels | Now | Proposed |
|---|---|---|---|
| Easy | 1 to 500 | stars x1 | stars x1 |
| Medium | 501 to 1000 | stars x2 | stars x3 |
| Hard | 1001 to 1500 | stars x3 | stars x6 |
| Expert | 1501 on | stars x4 | stars x12 |

Stars are unchanged (0 hints 3, 1 hint 2, 2 or more 1). The daily puzzle still pays no points.

## Why

Full numbers: `docs/PUZZLE-POINTS-REVIEW.md`. Real plays only, play log Oct 28 to Nov 16, 374 timed levels.

| Level | Timed levels (people) | Median time | Points per minute now |
|---|---|---|---|
| Easy | 297 (4) | 0:18 | 7.2 |
| Medium | 59 (3) | 0:58 | 3.7 |
| Hard | 4 (2) | 2:13 | 2.9 |
| Expert | 14 (2) | 4:37 | 2.1 |

- Medium x3 is well supported.
- **Hard x6 and Expert x12 are provisional.** They rest on 4 and 14 timed levels. Tell Matt this when you confirm the
  numbers with him; he may want smaller steps (x5, x8 was the other option shown) or to wait for more plays.

## Who moves (snapshot 2026-11-16, about 2:15 PM Eastern)

Re-run this on fresh data before shipping and show Matt the new table. Ties go to fewer levels played.

| Player | Now | Place | Proposed | Place | Medal |
|---|---|---|---|---|---|
| King of Games | 651 | 1 | 1,077 | 1 | gold, no change |
| Natalia | 597 | 2 | 597 | 2 | silver, no change |
| Ele | 172 | 3 | 243 | 5 | loses bronze |
| MattyIce | 169 | 4 | 270 | 3 | gains bronze |
| Lili | 88 | 5 | 264 | 4 | none |
| Anita Bonita | 9 | 6 | 12 | 6 | none |

## Where the code is

Points are worked out when a board is shown, from each level's stored stars. **No stored data changes and no
migration is needed** (THE LAW: nothing is written, lowered, or lost; nobody's points go down).

- `js/word-weaver-points.js`: `WW_MULT` (line 48) is the only number to change. Update the header comment there.
- `js/lb-rank-sheet.js` line 77: the scores sheet builds its table from `WW_MULT`, so it follows on its own. Look at
  the sheet afterwards: two-digit numbers (Expert 36, 24, 12) must still fit at 360px in English and Spanish.
- `js/points-toast.js`: the "+X pts" pill uses `wwPoints`, so it follows.
- `tools/test-word-weaver.mjs` line 48 pins `1/2/3/4`: change it with the table. `tools/test-lb-rank-sheet.mjs` line 74
  follows `WW_MULT`.
- Grep for anything else that states the numbers (`x 1/2/3/4`, "Expert x4"): root `CLAUDE.md` (two table rows),
  `word-weaver/CLAUDE.md`, `js/lb-rules.js`, the game's How to play strings, `functions/` (the server copies shared
  modules with `tools/sync-functions-shared.mjs`).

## How to do it

1. Confirm the three numbers with Matt, and whether it is admin-only first or for everyone.
2. Change `WW_MULT`, the test, and the docs. Run `node tools/test-word-weaver.mjs`, `node tools/test-lb-rank-sheet.mjs`,
   `node tools/test-lb-points.mjs`. Never `tools/run-all-tests.mjs`.
3. Rebuild the before-and-after board from a fresh `node tools/read-lb-snapshot.mjs` (needs `GAMEHUB_READER` and
   `NODE_USE_ENV_PROXY=1`) and show Matt who moves.
4. If it ships to players: `js/word-weaver-points.js` is a shared module, so run `node tools/validate-sw-assets.mjs`,
   bump `CACHE` past what is on `main`, merge, and check the Pages run (and the Firebase run if `functions/` changed)
   before saying "live".
5. No popup or announcement unless Matt asks for one in words.

## Rules that apply

- Read only against Firebase. No `--write` flags.
- Never use Matt's code or name in a test. Test profile: test1, code `DREG5`.
- Times in US Eastern. No other player's code on any page.
- A level's points must never go down for anyone: check every person's total is the same or higher after the change.

## Come back to it

Re-check Hard and Expert once each has about 30 timed levels (the review's method: the gap between a finish and that
person's previous finish, under 15 minutes, from `playLog/`).
