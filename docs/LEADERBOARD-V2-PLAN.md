# Leaderboard v2: plan (2026-10-30)

Design source: Dropbox `/Claude Code Refs/leaderboard-mockups.zip` (SPEC.md + 6 screens). Mockups for approval:
https://claude.ai/artifact/SMav6oWdSxsR3X1darSnjX (file: `docs/mockups/leaderboard-v2.html`; Boards, Darts board, settings sheet, Multiplayer board, empty board, Spelling Bee
board, Hall of Fame, Me, Player; dark by default). Status (2026-10-31): BUILT, admin-only (v1374). Overnight rounds 1-2 replaced the boards below with the OLD
board's numbers (Matt: "an interface redesign, not a stats redesign"): no Win %, no mode boards, no Top level, no
arrows. See `LEADERBOARD-V2-REVIEW-2.md`, `-REVIEW-3.md`, `-PLAN-R1.md`, `-PLAN-R2.md`, `-MORNING.md`. The table
below is the ORIGINAL design, kept for the record.

## Settled with Matt (2026-10-30)

- Three tabs: Boards, Hall of Fame, Me (replace By Player / By Game / You).
- A board = game x mode x difficulty x opponent (vs computer / Multiplayer) x language (word games only).
- **No weekly boards** for now (Matt: "leave out the weeks"). All-time only; no reset strip.
- vs computer: rank by Win % (10+ games to appear) or Wins, default Win %. Multiplayer: **Wins only** (no rating: no
  per-match opponent history exists), no difficulty bar.
- Score and puzzle games: best score or fastest time, with each game's existing tie-breakers. Spelling Bee stays as
  today (Points / Words, All / English / Español).
- Movement arrows = rank change since yesterday: the server saves each board's ranks once a day. Up = accent blue,
  down = orange, the arrow shape carries the meaning.
- Hall of Fame: by 1st places, then 2nds, then 3rds; "Top level" counts only each game's hardest level; tied boards
  give each tied player the place.
- Your row shows your PROFILE NAME (bold, highlighted), never "You" (root CLAUDE.md).
- Favorites = the launcher's favorites, with the heart. App's own bottom bar and the phone's system font (no Inter).
- Old history has no mode (modes recorded only from 2026-10-30, `withMode`): it shows under an "All modes" choice so
  no win disappears (THE LAW rule 1).
- Keep: no-hint solves rank first (Sudoku, Murdoku), admin-only games off, hidden test players, voids, server-built
  boards (`functions/boards.js`; a new screen never reads all of `players/`).

## Boards per game (from the 2026-10-30 mode audit; `byMode` keys in brackets)

| Game | Mode choices on its board | Difficulties | Notes |
|---|---|---|---|
| Darts | All modes, 301, 201, 101, Cricket (+ in order, + no points) [kind] | Easy/Med/Hard | MP by mode |
| Pool | All modes, 8-ball, 9-ball, Cutthroat [game]; racks/options as sub-filters? | Easy/Med/Hard | ask Matt how fine |
| Flick Soccer | goals 1/2/3 [goals] | 3 | |
| Cup Pong | reracks [rr], gentleman's [gent] | 3 | Solo: fewest throws |
| Battleship | Quick / Classic [size], shots [shots] | game's tiers | |
| Boggle | timer [min] x English / Español [lang] | 3 | language = separate boards |
| Chinchón | players [n], length | easiest computer | rules many: All rules only? |
| Escoba | players [n], 21 / 31 [to], deck [deck] | easiest computer | |
| Dominoes | target [to] | 3 | |
| Dots and Boxes | size [size] | game's tiers | |
| Tic Tac Toe | Classic / Ultimate [v] | 3 | |
| Uno, Monopoly Deal | players [n] / [ai] | 3 | |
| Hold'em | tier [tier] | 3 | + bankroll board as today |
| Connect Four, Archery, Air Hockey, Battle Arena, Filler, Mancala, Yahtzee, Hoops, Cup Baseball | no mode split | game's tiers | Hoops: one-shot [one] |
| Brick Breaker | Arcade / Endless [m], best score | 3 | |
| Hill Climb | stage (vehicle recorded, not split) | stages | best distance |
| Snake | walls on/off | 3 | best length |
| Sudoku, Murdoku, Minesweeper | none | 4 | fastest time / no-hint first |
| Arrow Maze, Gridlock, Word Weaver | as today (points, ladder) | bands | Word Weaver EN/ES |
| Spelling Bee, Contexto | as today | none | EN/ES |
| Golf | course | none | best round |
| Skeeball | machine | none | high score |
| Ball Run | Classic / Orbital map | 3 | best obstacles |

## Build order (after approval)

1. Server: per-board rankings + Hall of Fame + daily rank snapshot in `functions/boards.js` (from `byDiff`, `byMode`,
   the games' bests), published in the existing gzipped package; `tools/test-boards.mjs` extended.
2. Screens in `js/leaderboard-ui.js` (or a new module beside it), app conventions (`makeT` EN/ES, `.gh-dark`,
   `onViewportResize`, no codes in the DOM).
3. Tests, `validate-sw-assets`, CACHE bump, deploy, verify Pages + Firebase runs.
