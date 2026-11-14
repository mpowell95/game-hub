# Tower (`tower/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

Stack sliding blocks as high as you can (Matt, 2026-11-01). Built from Matt's approved mockups
(`docs/mockups/tower/`, branch `mockup/tower`). **Released 2026-11-13 (Matt: "release it"); its test plays were carried into the
real record once (`CARRY_TEST`, stamp `carried.tower`).** The release steps below are kept as the record of what was done.

**At release, TEST PLAYS COUNT (Matt, 2026-11-12: "Yes test plays should count")**: the release commit adds
`tower: true` to `CARRY_TEST` (`js/game-stats.js`; its combiner `combineTowerRecords` is already in `CARRY_COMBINE`,
2026-11-12 review: without one loadStats would throw) and flips `tools/test-word-weaver.mjs`'s "never carried" check to
another admin-only game. Not before: an admin-only game must never be carried. Matt is test-playing first; ship only on
his "release it".

**The release commit, every edit (checked by the 2026-11-12 reviews; real records held 0 Tower plays on 105 records that
day, so the carry cannot double count):** (1) `js/hub.js`: drop `devOnly`, add `released`; (2) `js/game-stats.js`: remove
`tower` from `ADMIN_ONLY`, add `tower: true` to `CARRY_TEST`; (3) `js/game-stats-ui.js` TABS: drop `devOnly`; (4) `sw.js`
ASSETS: add `./tower/`, `./tower/index.html`, `./tower/css/tower.css`, `./tower/js/{ui,engine,art,strings}.js`, run
`tools/validate-sw-assets.mjs`, bump CACHE; (5) `tools/test-admin-only-plays.mjs` and `tools/test-word-weaver.mjs` use Tower
as their admin-only example: point them at another admin-only game (archery, baseball; cup-baseball archived 2026-11-13); (6) docs (here + root table);
(7) check `openLeaderboard({game:'tower'})` lands on Tower's board; (8) no announcement unless Matt asks. The New games bubble (root CLAUDE.md) then shows it to everyone for 7 days from its `released` date, on its own. **Order (review 4):
deploy the commit FIRST, check Matt's devices are on the new build, and only then (if at all) flip the admin live switch**:
the switch alone sends phones still on the old build to the empty real record before they have the carry (bests read 0
until they update; nothing lost). `js/integrity.js` `GAME_NAMES` already has `tower` (2026-11-13); Tower has no integrity
rules yet (cheap candidates: perfects <= blocks, bestStreak <= perfects, bestByDiff <= best; replay over a snapshot first).

## Rules (`js/engine.js`, pure)

- A block slides across (alternating sides). Tap = drop. The overlap with the block below stays; the
  overhang is cut off and falls. The next block is only as wide as what landed.
- **Perfect**: within `TUNE[diff].perfect` world units, the block keeps its full width. A block NEVER grows
  back (Matt, 2026-11-02: "No growing back ever"; a 5-in-a-row regrow existed until then).
- No overlap = game over. Score = blocks stacked (stack length - 1).
- Speed rises every block with NO top speed (ramp doubled 2026-11-02, Matt: "should increase as the game goes on"; cap removed the same day: "There shouldn't be a max speed"). Blocks 40 units tall (were 26; Matt: "pretty thin"). Four difficulties (speed + perfect slack): easy / medium / hard / expert.
- World is `WORLD_W` (400) units wide; the UI scales it to the screen.
- **Speeds (units/s; one crossing is ~450 units)**: start easy 170, medium 204, hard 249, expert 476; each block adds
  9 / 12.5 / 15.9 / 19.3 (play test 2026-11-12: every level ~13% faster; Expert was 270, then 420). Perfect slack
  8 / 6 / 5 / 4.5 units. A block slides from 72% off one side to 72% off the other, so even a full-width block can miss.

## Hub integration

- Module, `immersive: true`. Hub id = stats id = folder = `tower`. CSS root `.tw-root`, prefix `.tw-`.
- **Name: "Tower Stack"** (Matt, 2026-11-12; Spanish stays "Torre"). Ids, keys and folder stay `tower` (rule 5).
- `isInProgress()`: LITERAL meaning (no resume, like Snake): true only while a run is live (playing or paused).
- **Leaving keeps the blocks (2026-11-12 review)**: Pause > Quit AND leaving through the hub (Hub button, back gesture:
  `destroy()`) record a run that stacked any blocks, once. The hub's "Leave?" dialog and in-game bug sheet pause the run (`onCovered`). Keys typed outside the game (the bug report) are ignored. A Perfect needs the blocks to touch. Game over stops drawing once it settles (Ice keeps its snow).
  The draw loop runs only while the canvas is what the player sees (play, game over), never behind setup, the pause
  card or Record towers. A tap drops the block where it is AT THE TAP (stepped to the tap time), not at the last frame.
  Record towers: a tie on the best goes to the better average at that difficulty (byMode `hs`/`hn`), else all-time;
  equal on both shares the rank and medal. The setup screen fits 360x640 and starts below the hub's button row.
- **Pause (2026-11-12, Matt: "there's no back button or pause or anything")**: a round button bottom right while
  playing (Esc too; leaving the app pauses). Paused card: Resume / Quit. Quit records the run if it stacked any blocks,
  then the setup screen.
- **Record towers has a "‹ Back" button** at the bottom (its old X sat under the hub's bug button); the phone's back
  swipe closes it too (`js/back-stack.js`).
- Setup screen (Gridlock / Arrow Maze layout): picture (tap = play) + "?" (How to play), title + best at the
  chosen difficulty, Look (City / Ice / Space / Toy, cosmetic), Difficulty (shape + best each), Play, leader footer
  (`readPeople()`, at the chosen difficulty) + Leaderboard ›.
- Settings: `gamehub.tower.v1` = `{ diff, look }`.
- **The four looks (2026-11-12, Matt: "those are great implement"; `docs/mockups/tower/art-upgrades.html`)**: all drawing
  in `js/art.js`. City = skyscraper floors in 3D with soft window lights, city at night, moon, street (Matt: lights not
  "too vibrant"); Ice = glassy 3D blocks, aurora, snowy peaks, falling snow; Space = solid neon-edged blocks (Matt: not
  "too transparent"), nebula, ringed planet, landing pad; Toy (new) = 3D toy blocks at sunset, the one light look. Each
  look has ONE time of day, whatever the hub theme (the old day/night City and Ice are gone). Sky and scenery are cached
  canvases; scenery scrolls at 0.35 of the tower. Look ids unchanged (rule 5).
- **Readable against the background (2026-11-12, Matt: "The piece is too close to the background")**: City floors are WARM
  STONE with a light edge against the cool city (blue vs yellow-brown also reads for red/green colour blindness), the city
  behind dimmer; Ice blocks near solid in front of DARKER mountains. Check every look's tower against its scene at full size.
- **Play test fixes (2026-11-12, a phone play-test agent's 20 findings, Matt: "Fix everything")**: the miss shows for
  0.55 s (HUD stays, the falling piece outlined) before the zoom; the card ignores taps for its first 0.4 s; its X tucks it
  away (tap the scene to bring it back); the hub's button reads "‹ Back" whenever the game can step back itself (module
  `back()` + `gamehub:backlabel`) and the hub's Leave? text is the game's own (`leaveText()`, "Your blocks count"); Keep
  playing resumes (`onUncovered()`); "Perfect!" pops; the streak chip is 🔥 bottom left; the best line is solid, ✓ once beaten,
  its label drawn above the pieces; the HUD's best pill hides at a tie; Record towers opens on first place.
- **Review 4 fixes (2026-11-13, an independent code review and a phone play test; Matt: "Do the next independent review")**:
  taps wait 0.35 s after Play, Again, Resume and Keep playing (a double tap ended runs at 0); the card's X tucks it away and
  leaves a bottom pill with the score (tap it or the scene; the card then ignores taps for 0.4 s again); pausing drops the
  falling offcuts and hides the pause button; keys are ignored while the hub's dialog covers the game; an app closed
  mid-run keeps its blocks (`pagehide`, not persisted); Record towers follows the PERSON picked, draws one or two towers
  bigger and centred, stars scattered; Ice ground is deep blue (pale blocks merged with the snow); Toy's score has a dark
  outline; "★ New best"; the title's best hides at 0. The hub puts the leaderboard return back after a back gesture the
  game took itself (`requestLeave`).
- **Game over**: the card has "‹ Back" (to setup) besides the X (Matt went to the hub by accident). Nothing that must be read
  goes under the hub's top row (`_readTopY`, a CSS probe): the best line's label drops below the line there, and the
  game-over zoom fits the tower between that row and the card (the card is built first, hidden, and measured).
- **A frame can never freeze the game (2026-11-12, Matt's iPhone stopped on a half-drawn frame mid-run, not reproducible
  in Chrome)**: the loop asks for the next frame FIRST and catches a throwing frame; iPhones cap total canvas memory,
  so art.js keeps at most 6 cached canvases, hands memory back (width 0) on drop/close, and paints straight to the
  screen when a canvas is refused. A draw error or a stall over 1.5 s on a visible screen is written to
  `gamehub.perf.v1` as `tower:draw:<look>:<msg>` / `tower:stall:<look>` (mirrored `players/<id>/perf`): read it there.
- **Best line + record towers (2026-11-02, Matt)**: a dashed "★ N" line at your best (this difficulty) while playing
  (turns yellow once beaten) and at game over (the PREVIOUS best). Game over zooms to fit the tower and the line, the
  ground lifts above a bottom card (score, best, Again, Compare). Compare and the setup footer's Leaderboard open
  **Record towers**. While Tower is admin-only nobody's plays upload, so only this phone's own tower shows there.
- **Record towers v2 (2026-11-12, Matt: "build the record towers mockup"; `docs/mockups/tower/record-towers-v2.html`)**:
  A = every best at the tab's difficulty as its REAL shape (`tw.shapes`), one scale for all (true heights and widths),
  side by side on one ground, scrolling sideways, tallest first, medals 1-3, own name ringed; each tower in the look it
  was built in. Tap one = B: that tower drawn like the game (`art.js` on a canvas, its look's scene), number, medal, name,
  difficulty and date, ‹ › through the list. Back / back swipe: B -> A -> closed (back-stack levels 2, 1). A best set
  before 2026-11-12 has no shape: drawn as a straight stack of its height until beaten.

## Stats

- `recordTower(height, diff, { perfects, bestStreak })` (`js/game-stats.js`), once per finished run, inside
  `withMode({ look }, diff, ..., { hi: height })`. Solo: played+won.
- Sub-counter `tw`: `games`, `blocks`, `perfects` (add); `best`, `bestByDiff`, `bestStreak` (Math.max).
  Wired in `players-agg.js`, `game-stats-ui.js` (`towerScreen`), `leaderboard-ui.js` (`twBestAt`, tiered),
  `stats-corrections.js`. While admin-only, plays go to the test record (`ADMIN_ONLY`).
- **`tw.shapes[diff]` = `{n, s: "x,w;..." (base first, world units, one decimal, a sliver >= 0.1), l: look, t: ms}`** (2026-11-12): `keepTowerShape`
  right after `recordTower`, kept only when the run IS the best at that difficulty and taller than the kept shape
  (only improves). Separate from `recordTower` ON PURPOSE: a play-log row's arguments may be at most 1600 chars and a
  tall tower's shape is longer (a refused row would sit in the queue). Merged per person = the tallest
  (`players-agg.js`); voided with the other bests (`stats-corrections.js`).

- **Leaderboard: Best game | Total (2026-11-13, Matt: "a spot so you can see total levels built at each difficulty. Gold
  is not awarded out for this, but it should be similar")**: a second tab row on the v2 board (`lb2Tabs`, state `by`:
  'points' | 'total', kept across the difficulty tabs, Skeeball's words). Total = blocks stacked (`twTotalAt`: All =
  `tw.blocks`; a difficulty = byMode `hs` there, saved from 2026-11-06, so runs before that count in All only), runs
  under it, same total = fewer runs higher, plain "#1" ranks (`noPodium`), never the standing or Medal Count.

- **High, low and average per difficulty (2026-11-14, Matt: "When I click into a player on the tower stack leaderboard, I
  should be able to see their high, low, and average for every difficulty")**: a person's Tower page, ADMIN DEVICES ONLY (the
  rows look, `game-stats-ui.js` `rowsTower`) until Matt says "release it". High = `tw.bestByDiff`; low = `tw.lowByDiff`
  (Math.min, saved from v1562; merged least in players-agg and the carry; emptied by a void) + `TOWER_BEFORE`
  (`js/stats-corrections.js`, every earlier run's low from the play log, per code); average = byMode `hs`/`hn` over every
  look + `TOWER_BEFORE.pre` (Matt's 3 runs from before running totals). Checked equal to the play log for all 4 people.

## Tests

`node tools/test-tower.mjs` (engine, recorder, best shapes kept and merged). Also covered: `tools/players-agg.test.mjs` (tw combine),
`tools/test-game-conventions.mjs`, `tools/test-i18n-strings.mjs`, `tools/test-game-modes.mjs`.
