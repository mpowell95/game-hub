# Leaderboard v2: plan R1 (2026-10-31, overnight round 1)

Source: `docs/LEADERBOARD-V2-REVIEW-2.md` (real data: old board 40 golds, v2 104). Matt: "an interface redesign, not a
stats redesign". Rule for this plan: **v2 draws the OLD board's numbers in the new look. No new number, no new order.**

## Data rules (the contract)

1. **One standing per game** = the old `gameStanding(list, id)` (All tab, `boardMetricCmp`, ties by comparator,
   `rankMap`). Exported read-only as `lb2Standing`. It alone feeds: Hall of Fame, the Boards-list medal, Me (records
   held, closest to breaking), the Player page places. So total golds = old By Game / You tab golds (40 today).
2. **A game's board = the old board's tabs**, same rows (everyone, not a top 10), same order, same rank and tie, same
   printed number and unit, same sub line (games played, "no hints", reracks, Minesweeper "W of N won", Spelling Bee
   chips). Built by the old code (`boardView`, `msBoardHTML`'s comparator) through one export `lb2Board(list, id,
   tab)`; tab list from `lb2Tabs(list, id)`, in the old order, default = the old default:
   - generic: All, each difficulty the field played, extras (Tic Tac Toe Ultimate / Classic, Snake Walls off / on,
     Cup Pong Solo, MP when anyone played online);
   - Minesweeper: All, Easy, Medium, Hard, Expert (always); Hold'em: Bankroll (default), Wins; Contexto: Daily, All
     (default All); Skeeball: machine (All + each played) x Points (default) / High score; Spelling Bee: Points / Words x
     All / English / Español; Arrow Maze: Levels tabs here, Rush opens the old board (unchanged); Word Weaver: bands with
     a cleared level.
3. **Removed from v2** (no old equivalent, they made the extra medals): Win %, the 10-game floor, mode boards, Multiplayer
   per mode, Brick Breaker Arcade/Endless boards, Hall of Fame "Top level". Modes stay recorded (`withMode`).
4. **Medals 1-3 on a board's rows** come from that tab's own rank (as the old board drew them). Only the standing
   counts toward totals.
5. **Gap lines use the old maths**: `gapText` on views ranked by the board's own number (read at the target row's tier),
   Minesweeper's own cell gap, a plain difference on the Wins/MP/Ultimate/Classic/Solo/High-score views; no number when
   none is honest ("behind #K").
6. Nothing writes player data. Preferences only: `gamehub.lb2.v1` (last tab per game), `gamehub.lb2.ranks.v1` (arrows).

## Screens (v2 look kept)

- **Boards**: search, chips (Favorites / Played / All), game rows with art; right side = the viewer's place in that
  game's standing (medal 1-3, "#N", dash). No "1st in N" line.
- **Game board**: header (back, art, title, heart); sub line = the tab name; column heads Rank / Player / Games / unit;
  every row; pinned own row with "<gap> to pass #K" or "1st"; bottom control = the old tabs (segmented when they fit,
  else a scrolling chip row; Skeeball's machine and Spelling Bee's language as a second row). No settings sheet unless a
  game has two tab rows that do not fit.
- **Hall of Fame**: everyone with a standing medal, by golds, then silvers, then bronzes; your pinned row ("N more
  golds to pass #K"). One list (no level toggle).
- **Me**: tiles Records (N of M games with a leader), Hall of Fame #, Games played; "Records you hold" (game + your
  number); "Closest to breaking" (old order `closeness`, old line `gapText`); "Not played yet" (record + holder + Play).
- **Player**: face, name, tagline, Message button (not on your own page, not without a code; code never in the DOM);
  tiles Records / Hall of Fame # / Games played; every game they played, most played first, with their place and their
  board number; tap = that game's board.

## Parity tests (`tools/test-lb2-parity.mjs`, real snapshot `backups/lb-z.json`, fixture fallback)

Headless Chromium on localhost (`tools/lb2-harness.html`), the same people list fed to BOTH overlays:
1. For every game on the launcher and every old tab: open the OLD overlay (`legacy`), click the tab, scrape each row's
   (rank, tie, name, number); open v2 on the same tab, scrape the same. Must be equal, row for row.
2. Hall of Fame totals (gold, silver, bronze) = the sum over games of the old By Game standings; per person too.
3. Boards-list medal per game = the old standing rank of the viewer (checked for 3 viewers).
4. No codes in v2's DOM (`data-code`, any player code string).
`tools/test-leaderboard2.mjs` keeps the pure tests (Hall of Fame tally, ranks, arrows) on the new shapes.

## Build steps

1. `js/leaderboard-ui.js` (additive exports only): `lb2Standing`, `lb2Tabs`, `lb2Board`, `lb2Records(list, meKey)`
   (held / close / fresh, old `youHTML` logic), `lb2PlayerGames(list, key)`, `__lbSetBoardForTest`.
2. `js/leaderboard2-boards.js`: drop the wins/Win %/mode maths; Hall of Fame and person summary from standings.
3. `js/leaderboard2-ui.js`: the screens above; strings in `leaderboard2-strings.js` (EN/ES).
4. Tests above + the suites in the brief; screenshots (dark, 402x874, compact) in `docs/mockups/lb2-shots/r1/`.
5. Deploy (admin-only still; old board unchanged for everyone else).

## Revision after the critique (second reviewer, opus, 2026-10-31 ~04:10 Eastern)

Accepted:
- **Golden file first.** `tools/lb2-golden.mjs` runs `main`'s OLD overlay (unchanged code, a test hook appended at load
  time only) over the snapshot and saves every tab's rows (rank, tie, name, number), By Game's top rows and the row
  counts to `backups/lb2-golden.json` (git-ignored: real names). The parity test compares the old overlay on this branch
  AND v2 against it, so an edit to `js/leaderboard-ui.js` cannot move both sides together unseen.
- **Gap line = the old stand line exactly**: gap to the board's first row, read at its tier (`gapText`, incl. the
  no-hint guard), only on views the old board drew it on; Minesweeper's own cell gap; nothing on Wins/MP/Ultimate/
  Classic/Solo/High score/Contexto. `lb2ScoreBoard`'s own gap is not used.
- **Restore**: the "who leads what" records block under each board (`recordsHTML`), the board's total plays, the tier
  pill on All rows, wins + played totals on the player page.
- **No per-game tab memory** (the old board opens every board on its default; `gamehub.lb2.v1` is left untouched, never
  read or written again: rule 5). **No rank arrows** for now (`gamehub.lb2.ranks.v1` left untouched).
- Game list = `isGameOnLauncher` only (as By Game).
- Fewer words: no tab name under the title (the tab is lit below), no "Rank"/"Player" heads; the unit once.

Stated, not changed (the old board does the same):
- Tic Tac Toe's and Minesweeper's standing order (By Game, You tab) is not the All tab's order. The Boards list, Hall
  of Fame, Me and Player follow the standing, the board follows the tab, exactly as By Game vs the board did before.
- The standing lists only people with a score (a 0-win player is on the All tab but has no place).
- Hall of Fame medals = standing ranks 1-3 with ties sharing the place (the old You tab's "records held" counts tied
  1sts the same way). One addition: a Hold'em bankroll never used (no entry, no grant) earns no medal in the tally;
  the board still shows the row where the old board does. Golds unchanged (40).

Deferred to round 2: a small hand-typed fixture with edge cases (golf E/+/-, hint vs no-hint, a 4-way tie, Skeeball 1 vs
2 machines, bee board absent); Spanish-locale parity run.
