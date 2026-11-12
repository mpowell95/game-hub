# Tower (`tower/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

Stack sliding blocks as high as you can (Matt, 2026-11-01). Built from Matt's approved mockups
(`docs/mockups/tower/`, branch `mockup/tower`). **Admin only (`devOnly`) until Matt releases it.**

**At release, TEST PLAYS COUNT (Matt, 2026-11-12: "Yes test plays should count")**: the release commit adds
`tower: true` to `CARRY_TEST` (`js/game-stats.js`) and flips `tools/test-word-weaver.mjs`'s "never carried" check to
another admin-only game. Not before: an admin-only game must never be carried. Matt is test-playing first; ship only on
his "release it".

## Rules (`js/engine.js`, pure)

- A block slides across (alternating sides). Tap = drop. The overlap with the block below stays; the
  overhang is cut off and falls. The next block is only as wide as what landed.
- **Perfect**: within `TUNE[diff].perfect` world units, the block keeps its full width. A block NEVER grows
  back (Matt, 2026-11-02: "No growing back ever"; a 5-in-a-row regrow existed until then).
- No overlap = game over. Score = blocks stacked (stack length - 1).
- Speed rises every block with NO top speed (ramp doubled 2026-11-02, Matt: "should increase as the game goes on"; cap removed the same day: "There shouldn't be a max speed"). Blocks 40 units tall (were 26; Matt: "pretty thin"). Four difficulties (speed + perfect slack): easy / medium / hard / expert.
- World is `WORLD_W` (400) units wide; the UI scales it to the screen.
- **Speeds (units/s; one crossing is ~450 units)**: start easy 150, medium 180, hard 220, expert 420; each block adds
  8 / 11 / 14 / 17. Expert's start was 270 until 2026-11-12 (Matt: "Expert starts way too slow still").

## Hub integration

- Module, `immersive: true`. Hub id = stats id = folder = `tower`. CSS root `.tw-root`, prefix `.tw-`.
- **Name: "Tower Stack"** (Matt, 2026-11-12; Spanish stays "Torre"). Ids, keys and folder stay `tower` (rule 5).
- `isInProgress()`: LITERAL meaning (no resume, like Snake): true only while a run is live (playing or paused).
- **Pause (2026-11-12, Matt: "there's no back button or pause or anything")**: a round button bottom right while
  playing (Esc too; leaving the app pauses). Paused card: Resume / Quit. Quit records the run if it stacked any blocks,
  then the setup screen.
- **Record towers has a "‹ Back" button** at the bottom (its old X sat under the hub's bug button); the phone's back
  swipe closes it too (`js/back-stack.js`).
- Setup screen (Gridlock / Arrow Maze layout): picture (tap = play) + "?" (How to play), title + best at the
  chosen difficulty, Look (City / Ice / Space, cosmetic), Difficulty (shape + best each), Play, leader footer
  (`readPeople()`, at the chosen difficulty) + Leaderboard ›.
- Settings: `gamehub.tower.v1` = `{ diff, look }`.
- **Dark mode (2026-11-02, Matt: "quality dark mode")**: City plays at night (lit windows), Ice under an aurora with
  dark peaks, Space unchanged; the setup picture and look thumbnails match. `isDark()` reads `.gh-dark` at draw time;
  `onThemeChange` repaints.
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
