# Tower (`tower/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

Stack sliding blocks as high as you can (Matt, 2026-11-01). Built from Matt's approved mockups
(`docs/mockups/tower/`, branch `mockup/tower`). **Admin only (`devOnly`) until Matt releases it.**

## Rules (`js/engine.js`, pure)

- A block slides across (alternating sides). Tap = drop. The overlap with the block below stays; the
  overhang is cut off and falls. The next block is only as wide as what landed.
- **Perfect**: within `TUNE[diff].perfect` world units, the block keeps its full width. Every 5 Perfects in
  a row (`GROW_EVERY`) grow it back by `GROW` (never past `START_W`).
- No overlap = game over. Score = blocks stacked (stack length - 1).
- Speed rises per block to a cap (doubled 2026-11-02, Matt: "should increase as the game goes on"). Blocks 40 units tall (were 26; Matt: "pretty thin"). Four difficulties (speed + perfect slack): easy / medium / hard / expert.
- World is `WORLD_W` (400) units wide; the UI scales it to the screen.

## Hub integration

- Module, `immersive: true`. Hub id = stats id = folder = `tower`. CSS root `.tw-root`, prefix `.tw-`.
- `isInProgress()`: LITERAL meaning (no resume, like Snake): true only while a run is live.
- Setup screen (Gridlock / Arrow Maze layout): picture (tap = play) + "?" (How to play), title + best at the
  chosen difficulty, Look (City / Ice / Space, cosmetic), Difficulty (shape + best each), Play, leader footer
  (`readPeople()`, at the chosen difficulty) + Leaderboard ›.
- Settings: `gamehub.tower.v1` = `{ diff, look }`.
- **Best line + record towers (2026-11-02, Matt)**: a dashed "★ N" line at your best (this difficulty) while playing
  (turns yellow once beaten) and at game over (the PREVIOUS best). Game over zooms to fit the tower and the line, the
  ground lifts above a bottom card (score, best, Again, Compare). Compare and the setup footer's Leaderboard open
  **Record towers**: everyone's best at a difficulty as side-by-side towers (`readPeople()` rows, tallest first, own
  column ringed, medals 1-3), tabs per difficulty, Leaderboard › to the hub board. While Tower is admin-only nobody's
  plays upload, so only this phone's own tower shows there.

## Stats

- `recordTower(height, diff, { perfects, bestStreak })` (`js/game-stats.js`), once per finished run, inside
  `withMode({ look }, diff, ..., { hi: height })`. Solo: played+won.
- Sub-counter `tw`: `games`, `blocks`, `perfects` (add); `best`, `bestByDiff`, `bestStreak` (Math.max).
  Wired in `players-agg.js`, `game-stats-ui.js` (`towerScreen`), `leaderboard-ui.js` (`twBestAt`, tiered),
  `stats-corrections.js`. While admin-only, plays go to the test record (`ADMIN_ONLY`).

## Tests

`node tools/test-tower.mjs` (engine + recorder). Also covered: `tools/players-agg.test.mjs` (tw combine),
`tools/test-game-conventions.mjs`, `tools/test-i18n-strings.mjs`, `tools/test-game-modes.mjs`.
