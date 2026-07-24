# HANDOFF-FB-LEADERBOARD: player drill-down, Snake's wrong unit, Tic Tac Toe mode split

**Batch 3 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: high.** Decisions made; execute, verify,
commit. Read `js/CLAUDE.md` ("The leaderboard's rating model", "Whose stats are these") before
touching anything — this feature is a READ-ONLY display layer over `players/` data; nothing
here writes or migrates stats (THE LAW applies: every change must keep every currently visible
row visible).

## 1. Click a player → see all their stats (Matt, on both By Player and a game page)

Today no player card is clickable anywhere (`playerCardHTML` renders plain divs,
`js/leaderboard-ui.js:200-211`; only By Game's game rows are buttons, `:247`).

Decisions:

- Every player card in By Player AND inside a game detail page becomes a button (same
  mini-tile look, add a chevron affordance) opening a new **player detail screen** inside the
  Leaderboard overlay, with the standard back row (same pattern as the existing game detail's
  `← Games`).
- Content of the player screen: header (emoji, name, total wins, games played, the tier chips
  they already show on their card), then one section per game they have played, reusing the
  My Stats per-game renderers. `js/game-stats-ui.js`'s `screenFor(id, st)` already takes a
  stats object; the aggregated per-person rows from `js/players-agg.js` (`aggregatePlayers`)
  carry a `games` map with every sub-counter (`grid`/`cc`/`es`/`nb`/`sn`/`tt`/`db`/`bg`) —
  hand `screenFor` that player's `games` entry instead of the local `loadStats()`. Factor
  whatever small export is needed out of `game-stats-ui.js` WITHOUT changing what My Stats
  itself renders (its screens are LAW rule 1 surfaces; they must stay pixel-identical for the
  local player).
- Games the player has never played are omitted (no zero-row padding). Order sections
  alphabetically by displayed title (render-time, same rule as everywhere).
- The leaderboard's `watchPlayers` subscription already has the rows; no new Firebase reads.
- The difficulty filter pills do NOT apply inside the player screen (it is a stats sheet, not
  a ranking); keep the pills hidden there.

## 2. Snake's game page says "WINS" on a best-length number (Matt: "Snake isn't wins, its length")

Verified in code: By Game's game LIST row correctly uses `UNIT_KEY` (`lb_unit_longest`,
`js/leaderboard-ui.js:76`, `:245`), but the player cards INSIDE a game detail page reuse
`playerCardHTML`, which hardcodes `t('lb_wins_unit')` (`:207`) — so Snake's page shows
"51 WINS" where 51 is King of Games' longest snake (screenshot-confirmed).

Fix: `playerCardHTML` takes the unit key (or the game id) as a parameter; game detail passes
the game's `UNIT_KEY` (`lb_unit_longest` for snake, `lb_unit_obstacles` for ball-run,
`lb_unit_solved` for nuts-bolts, wins for the rest). By Player keeps `lb_wins_unit`
(cross-game wins) — that view is correct today.

## 3. Tic Tac Toe: the game page shows Ultimate vs Classic (Matt: "tic tac toe leaderboard just show ultimate vs classic")

The `tt` sub-counter already splits by variant (`js/game-stats.js:331-337`, `:618-632`) and
`js/players-agg.js` carries it cross-device. On the tic-tac-toe game detail page, replace the
single big wins number per player with the split: two labeled values per card, **Ultimate**
and **Classic**, each computed with the same draws-as-wins rule per variant
(`wins = played - lost` from `tt.ultimate` / `tt.classic`). Sort players by ultimate wins,
then classic. Players with plays but no `tt` breakdown (legacy/pre-split history, or devices
that only synced totals): show their generic wins number as a third, honestly labeled fallback
value rather than dropping them — nobody may fall off the board (rule 1; the
`test-leaderboard-rank.mjs` visibility replay is the guard).

## 4. Tic Tac Toe defaults to Ultimate (Matt: "The game should default to ultimate")

One line: `tic-tac-toe/js/ui.js:97` — the variant fallback becomes `'ultimate'` (saved
settings still win, so existing devices keep their last-used choice; that is the documented
settings precedence, leave it).

## Verification

1. `node run-all-tests.mjs` green — pay attention to `players-agg.test.mjs` and
   `test-leaderboard-rank.mjs` (visibility gates).
2. `node server.mjs`: open Leaderboard → By Player → tap each player → every section a player
   has plays in renders with real numbers; back navigation works; My Stats overlay unchanged
   for the local player. Snake page shows the longest unit label on cards; tic-tac-toe page
   shows the Ultimate/Classic split; a fresh-profile Tic Tac Toe setup opens on Ultimate.
   Check EN and ES.
3. New strings (unit labels, back label, fallback label) in `js/strings.js` both languages;
   `node test-i18n-strings.mjs` green.
4. `sw.js` CACHE bump as the LAST edit before commit.
