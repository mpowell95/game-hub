# Handoff: Leaderboard v2, session 4 (2026-11-02)

Read `docs/HANDOFF-LEADERBOARD-V2-2026-11-01.md` (history, decisions, tools) first, then this. Matt reviews in a second
Claude.ai chat: send images + HTML + raw GitHub links for every mockup, unasked (root CLAUDE.md).

## Where session 3 stopped (all live, admin-only v2 unless said)

v1382-v1394: a name on a game's board opens that player's stats for that game; Games list search icon, filters + sort on
one line; board tabs on top; pinned own row only while off screen (boards, Wins, Medals); person-game page and **My
Stats (every player)** share one look (`js/game-stats-ui.js` `V2_CSS`, `v2ScreenFor`); Hall of Fame Wins filter + sort;
Arrow Maze Levels | Rush in v2 (`lb2Rush`); Tic Tac Toe standing = board's All tab; Bego -> Begoña, Andrew Powell ->
Andrew P (`NAME_ALIAS`); Contexto "Fewest guesses" = no-hint solves only (`ct.fewestNH`; phones fill from their save,
server fills from `ctHistory` in `functions/boards.js` `ctNoHintBest`). Release of v2 to players: Matt said **wait**.

## Outside review round 5 (grade B): `docs/LEADERBOARD-V2-REVIEW-ROUND5.md` holds it word for word

Pack sent: `docs/LEADERBOARD-V2-REVIEWER-CONTEXT-2.md` + `docs/mockups/lb2-review/round5/` (shots by
`tools/lb2-review-shots.cjs`; screenshot numbers below refer to that set).
Reviewer misreads (do nothing): "Battleship = Billar" (Spanish A-Z order: Pool is Billar), "no Play button" (test
browser has no launcher), "Not played yet" unseen (viewer played all 34).

## TASK 1: mockup of items 1-10 (Matt: "Yes in 1-10 ... Include hard and no hint labels in mockups")

Interface only; ranks, numbers, medals unchanged (`tools/test-lb2-parity.mjs`). Real data (`tools/read-lb-snapshot.mjs`,
needs `GAMEHUB_READER`), viewer *King of Games*. One HTML page of phone frames, like `docs/mockups/lb2-byplayer-rush.html`.
1. **My Stats shows the board's number and rank** per game (list rows + game page head card), like the player page
   (21). One title "My Stats" (it says "Game Stats"), one close control (back arrow AND X today).
2. **Medals only where earned**: none on 0-win rows (06: silver for 0); plain "#1" on Past weeks (19), Records held
   (28) and Wins sorted by Played (27). Ranks unchanged.
3. **Closest (29)**: compare at the RECORD'S difficulty (old `gapText` rule), show a "Hard"/"No hints" label where the
   difficulty or hint rule is the reason; consider only 2nd/3rd or sort by gap (show Matt the option).
4. **Fold zero tails** ("=7 · 9 players", opens on tap) so Bests are reachable (04, 05, 10, 26).
5. **Sudoku/Murdoku dividers (08)**: one "No hints" divider on top, then difficulties; drop the duplicate row pill.
6. **Colorblind**: light-mode shapes as big as dark mode (light-04, light-15); Contexto hint medals in fixed slots
   (11, 20) so position, not colour, tells them apart.
7. **Header "N played" = the game's total** on every tab (now changes per tab: 04 vs 06, 11 vs 12).
8. **Player-page tile "Hall of Fame #" -> "Medals"** (21).
9. **Spanish**: "1 victorias" plural, "4481" separator, truncations (es-17 "Laberinto de flec...", es-32), es-28 wrap.
10. **Consistency**: Contexto All tab first (12); Rush fewer tab rows (17-19); Skeeball "All" picker labelled "All
   machines" (13); one dash style "–"; Past weeks rows not all highlighted (19); Skeeball machine cards lose rank-coloured
   bars (23, 34).
Plus Matt: **"Hard" and "No hints" one-word labels** wherever the reason for an order is otherwise invisible (the
reviewer's "fewest words" point: e.g. on Bests, Closest, Sudoku).
Show the mockup, take Matt's edits ON THE MOCKUP, build only on "build it".

## TASK 2: time zones (Matt chose B: "based in the user's time zone. People play in EST and in Spain")

Option B = each player's own local midnight. Today Arrow Maze Rush weeks end Monday 00:00 UTC (`js/arrow-maze-time.js`
`woWeekKey`/`woWeekEnd`) = Sunday 7 PM Eastern, so "This week" emptied on Sunday evening for Eastern players.
1. Audit EVERY day/week cutoff (grep `getUTC`, `woWeekKey`, `nyDay`, `serverNow`, `bestNow`, Spelling Bee day,
   Contexto daily, Skeeball daily bests `arcade-scores.js`, challenge timers) and list each with its current rule.
2. Make the player-facing ones local (B). Week/day KEYS keep their stored format (`YYYY-MM-DD` of the Monday/day), so
   old data stays valid; only new results use the local rule. THE LAW: never rewrite stored keys; test with real
   history (rule 7).
3. Where ONE shared puzzle/day is judged by the server (Spelling Bee's day + copy detection, Contexto Daily), changing
   to local can break fairness or integrity checks: report it to Matt in one line with the trade-off, and do what he
   says (he chose B; "do it the first time": build the route that works).
4. Make it live (commit, PR, merge, verify Pages + Firebase deploy), then tell Matt.

## TASK 3 (after 1-10 are approved): #11 one vocabulary across all 34 stats screens

Wins / Losses / Ties / Played in that order everywhere, same headings, no repeated numbers (16 repeats its head card;
22 vs 35 vs Chinchón's Victories/Draws/Defeats). Words and layout only. Mockup first (a few games), then build.

## Tools and gotchas

- Screens: `PORT=8177 node server.mjs`, then `tools/lb2-review-shots.cjs` (whole set) or a copy of its harness.
  Remove `.hub-tour` before clicking. My Stats in the harness: put the viewer's board `games` into `gamehub.stats`.
- Deploy: bump `CACHE` past main, `node tools/validate-sw-assets.mjs`, tests for what changed (`test-leaderboard2`,
  `test-leaderboard-rank`, `players-agg.test`, `test-no-codes`, `test-i18n-strings`, `test-game-conventions`). A
  `functions/` change runs the Firebase workflow's checks (`test-boards`, `test-push`, `test-bee-server`,
  `test-integrity`); a change only in `tools/` does NOT trigger it (run `firebase-deploy.yml` by workflow_dispatch).
- Server board rebuilds on a sync or at most every 30 min.

## Session 4 results (2026-11-02)

- **Task 2 LIVE v1395** (everyone): Rush weeks, New pill and announcement dates turn over at each player's local midnight
  (`woWeekKey` local Monday; old UTC keys kept). Spelling Bee, Contexto, Skeeball were already local. `tools/test-rush-weeks.mjs`.
- **Task 1 LIVE v1396 for ADMIN devices only** (Matt: "Just implement for admin and I'll tweak it"). Mockup:
  `docs/mockups/lb2-session4.html` + `lb2-session4-items/item-NN.jpg`. My Stats changes gated by `_s4` (`js/game-stats-ui.js`,
  `isAdminDevice()`; class `gs-s4`); players' My Stats unchanged. Closest = variant A (all games; B behind `__setClosestForTest('b')`).
  Open calls for Matt: Closest A/B, "Medals" also renames the Me tile, Contexto gold shown twice, "All" pill on Bests, folds stay open.
- **Task 3** (#11 one vocabulary): not started; mockup first.
