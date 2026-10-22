# Arrow Maze — way-out/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

A clone of **"Pointers"** from the *Offline Games* app (Matt, 2026-10-11, reference recordings in his
Dropbox `/Claude Code Refs/ScreenRecording_10-11-2026 01-58-49_1.MP4` and `01-59-51_1.MP4`). Our name
is **Arrow Maze** (es *Laberinto de flechas*).

## The name, and why the folder still says `way-out` (settled — do not "fix")

It shipped 2026-10-11 as **Way Out** and was renamed the same day. Only what a player SEES changed
(hub title, `game_title_wayout`, the game's `title`, page `<title>`). **The folder `way-out/`, hub id
`way-out`, stats id `wayout`, prefix `.wo-` and the keys `gamehub.wayout.v1` / `.save.v1` / `.saves.v1`
keep the first name on purpose**: the stats id keys every level already cleared in `gamehub.stats` and
`players/<id>`, and the keys hold each tier's level (THE LAW rule 5). Same shape as Monopoly Deal's
`business-deal/`.

## Hub integration

- In-hub `module: '../way-out/js/ui.js'`, **immersive**. Hub id `way-out`; stats id `wayout`; `.wo-root`.
- **Admin only** (`devOnly: true`, no `released` date: that is the New pill's input and must be the day
  Matt releases it from the admin page). Its `GAME_META` row shipped with the game. The live admin
  config has `way-out` `live: true`.
- **King of Games (3VN33) can see and play it again since 2026-10-14** (Matt: *"Let king of games see
  and play arrows"*). He was hidden with `hideFrom: ['3VN33']` on the `GAMES` entry 2026-10-13 and
  again the evening of 10-14 while the bands were reworked; re-add that line to hide it from him.
- `isInProgress()` is always `false` (every level-changing tap autosaves).
- Immersive layout copies Murdoku's `_positionRoot()`: a `position: fixed` root measured against the
  mount point, **edge to edge** in the hub; the top bar shares the floating back button's row; the
  level title is centred on the screen.

## Files

`js/engine.js` the whole puzzle (level sizes, seeded generators, `blockerOf` the one rule, `hintArrow`,
`buildLadder`, `buildRush`; pure) · `js/test.js` (`node way-out/js/test.js`; skipped by
`tools/validate-sw-assets.mjs`) · `js/ui.js` screens, canvas board, input, animation, autosave, module
contract, the `window.__woTest` seam · `js/strings.js` EN/ES · `../js/arrow-maze-time.js` the timer's
penalties, clock format, finish-list reader, ladder bands and points, Rush numbers and weeks (shared
with the stats store and the merge; network-first) · `css/way-out.css` · `index.html` standalone (name
gate before `init`).

## The rules (as the reference plays)

- Grid of dots; an arrow is a chain of >= 2 adjacent dots, the last is the head and it points the way
  its last segment runs. **Tap an arrow and it slides out** (the body follows its own path); only
  another arrow or its own body on the straight line from the head to the edge can stop it.
- **Blocked**: slides until the head touches the blocker, springs back, **turns red and stays red**, a
  heart goes. Three hearts; the third bump ends the level ("Out of lives").
- Clearing: green wave from the middle, confetti, purple wash with a word (Victory / Awesome / Well
  done / Congrats / Next level), then the next level loads.
- Hint (bulb, right end of the hearts row): free and unlimited here; pulses one arrow that can go now,
  preferring one not already bumped. Restart rebuilds the level with three hearts (dimmed with nothing
  to undo). Out of lives: **Try again**, or **Change difficulty** / X to setup.

## Engine notes (correctness-critical)

- **Every level is solvable, by construction**: arrows are placed one at a time, accepted only if
  their way out is clear of every arrow already placed; and **a clear arrow stays clear** (removing
  arrows only frees dots), so a mistake never makes a level unwinnable. `test.js` greedy-solves 60
  levels of every tier with the player's own `hintArrow`.
- Arrows are placed middle-outwards (with noise). **The tail-growth pass**: a gap dot `c` may join
  arrow `b`'s tail only if `rayMax[c] < b`; change that inequality and levels stop being solvable
  (`test.js` catches it).
- `seedOf(tier, level)` makes a level the same board on every device and for Restart.
- **Generators are pinned.** `buildLevel(tier, level, gen = GEN_LATEST)`; a save records `gen`
  (none = 1) so "which arrows are gone" keeps meaning the same arrows. **Never change `generate()` or
  an existing generator's output without bumping `GEN_LATEST` and keeping the old path**, or every
  level in progress scrambles. `test.js` pins generator 1 = the original `generate()` and generators
  2-6 by hash. Gen 2 (harder: flip free-at-start arrows, K candidates; Easy level 1 stays gen 1), gen 3
  (Expert only: shorter winding arrows, ~112 arrows), gen 4 (from level 14 a rounds target
  `rampTarget` climbing over 60 levels, `harden()` may flip any arrow), gen 5 the ladder, gen 6 the
  moved bands (below). Old tier sizes (`levelSpec`): Easy 8x4 at level 1 then 6-10 x 5-13; Medium
  10-14 x 13-19; Hard 20-24 x 26-32; Expert 24-28 x 32-38; stops growing at level 13.
- **Asked for and NOT done (needs Matt's example):** hardest boards "travel across the board" with
  distant blockers; the screenshot attached was the Minesweeper leaderboard. Boards are ~90% packed,
  so at the start a blocker is almost always the next dot (avg 1.2 dots).

## Input and the tap-target exception

Hard/Expert boards are 20-28 dots across a phone (12-16px apart), so 44px per arrow is impossible. The
board is one canvas and a tap goes to the **nearest arrow segment** within `max(0.7 x pitch, 22px)`:
the documented departure from the 44px floor (docs/BUILDING-A-GAME.md, the dots-boxes model). Every
other control is 44px+. Taps fire on `pointerdown` (instant, as in the reference); primary button only.

## Look (rules in force)

- Open items: see the root TODO.md, "Arrow Maze".
- **Setup screen** is in the hub's own style (Sudoku/Minesweeper layout from `css/ui.css`), not the
  reference's: board picture as headline `clamp(96px, 23vh, 200px)` with the title under it and **no
  tagline**, a **Difficulty** card of four buttons (shape marker, name, current level; selected wears
  `#ffce3a` + thicker outline), **Play level N** / **New game | Resume**; How to play is the "?"
  beside the picture (see Rush, "The setup screens"). Follows the hub's light/dark theme; How to play and Out of lives are
  `.gh-overlay`/`.gh-modal` popups with the required X. The picture plays itself (`HERO_SVG`, CSS-only
  loop, still under reduced motion).
- **Play screen keeps the reference's dark board in both themes**; colours listed at the top of
  `css/way-out.css`. The standalone page has no `css/hub.css`, so `way-out.css` gives `css/ui.css`'s
  `--gh-*` tokens the hub's dark values under `.gh-dark`.
- "Arrows remaining / cleared" counters (`.wo-counts`) on every difficulty; the How to play pill under
  the board is Easy only (`.is-easy`) and PAUSES THE CLOCK while open (`_helpPaused`). Arrows are thick
  (`lw = pitch x 0.092`, heads `pitch x 0.28`); pitch cap 72px. **Thick arrows** (`lw = pitch x 0.3`,
  heads `pitch x 0.52`, from Matt's own edit of a Hard board: *"I want all the arrows to be more like this
  one"*) are a **switch on the Levels screen** since 2026-10-16 (settings `thick`, a preference; never
  chosen = on for `isAdminDevice()`, off for everyone else; `_thick()`); Rush draws the same. He rejected a zoom/pan
  "big arrows" mode the same day (*"I do not like the magnifier. remove it"*); it was reverted whole.
- The reference's "Extra Hard" is **Expert** here. No sound (root rule). No ads, rate-us, favourite star.

## Fitting the screen

- **The hint lives at the right end of the hearts row** (a row of its own cost ~70px of board).
- **In the hub nothing sits under the floating back button**: top bar starts to its right
  (`--wo-inset`, measured), setup content starts below its row, popups are padded below it. The title
  is centred unless that would touch its neighbours, then `_fitHud()` (measured) drops it into the
  flow (`.is-tight`, triggers at 320px in the hub).
- **The root's BOTTOM is `bottom: 0`, never a height measured from the viewport** (2026-10-14: an
  iPhone reported a short `visualViewport` height mid-transition and the setup screen was cut off;
  Minesweeper had the same fix). The setup column centres with auto margins
  (`.wo-home > :first-child/:last-child`) and scrolls inside itself if a phone is too short.
- **Design floor: 360px wide, ~724px tall** (`node tools/read-install-state.mjs --screens`, 2026-10-13);
  nobody active has a 320-wide phone, so 320x568 checks are dropped. 375x667 stays a check until
  Lili's phone reports.

## Persistence and stats

- Settings `gamehub.wayout.v1`: `{ tier, levels, ladder, ladder2, mode, rushMode, ... }`. `levels`
  (old tiers' next level) and `ladder` (first ladder) are **FROZEN, written back exactly as stored**;
  **`ladder2`** is the NEXT LADDER level per difficulty and is what the game reads. All only go up
  (`Math.max`), capped at 1,000,000 (a corrupt value once read "Level 1e+21").
- Settings also hold `thick` (2026-10-16, boolean, absent = default above).
- **Read-only keys** (rule 5, never written or deleted): `gamehub.wayout.save.v1` (first build's single
  slot, read once into its tier's slot), `gamehub.wayout.saves.v1` / `.clocks.v1` (one save per tier,
  `{ v, tier, level, gen, gone[], red[], lives }`), `gamehub.wayout.ladder.saves.v1` / `.ladder.clocks.v1`
  (first ladder). **Live:** `gamehub.wayout.ladder2.saves.v1` / `.ladder2.clocks.v1`. A save is
  trusted only for the exact level being opened; malformed = fresh.
- **A paused level gets New game | Resume** (2026-10-16, Matt, after Hard 106 opened at 3:19 with
  nothing cleared: *"If there is a saved game at that difficulty, there are two buttons: New Game and
  Resume"*, as Minesweeper). Paused = real progress or 1 s+ on its clock (`isPaused`). New game
  (`_newLevel`) = same board, all arrows, 3 hearts, clock 0:00; otherwise one **Play level N**
  ("Continue level N" is no longer shown). **A save with every arrow gone is a win that was
  never counted**: opening it runs the win sequence and records it.
- Stats: **`recordWayOut(tier, finish)`** once per level cleared (was `recordResult('wayout', tier,
  true)` and still counts exactly that), also feeding the **`wo` sub-counter**; the three-edit rule is
  done: `js/game-stats.js` (`ensureWo`, `recordWayOut`), My Stats (`wayoutScreen`),
  `js/players-agg.js` (counters add; per difficulty the log of the device with the most timed
  finishes). `wayout` is in the SOLO set.

## Timer (2026-10-13)

Matt: a Minesweeper-style timer; a mistake loses a heart AND adds time (*"losing 1 heart on easy is
+10, a second +20. Medium +15/+30, hard +20/+40, expert +30s/+60s"*); a hint costs the same as a
mistake.

- The clock (left end of the hearts row) shows time WITH penalties, runs only while a level is on
  screen, unfinished and the app in front. **It lives in its own key, not the save**: Restart and Out of
  lives clear the save but not the clock; a level's time runs from first open to clear, unless the
  player taps **New game** on the setup screen (2026-10-16), which sets it to 0.
- `WO_PENALTY_S`: first heart lost costs the tier's base, second double; the third ends the attempt with
  no extra charge. A hint costs the base once (tapping the bulb again while the same hint pulses does
  not charge again).
- **Every timed finish is stored raw** in `wo.log[<tier>]`: `{t, a, r, m, h}` (+ `l` ladder level, `g`
  board generator, `d` epoch ms since 2026-10-14). `wo.recent` / `wo.best` are no longer written, kept as
  stored (rule 5). The score is POINTS, not time; the log stays so time can return (Matt: *"Save the
  time and we can switch back..."*).
- **Not timed, honestly**: a level resumed from a pre-timer save (`partial`) and levels cleared before it
  have no time but still count as solved (rule 4). The win banner shows the time.
- Tests: `tools/test-arrow-maze-time.mjs`, `tools/players-agg.test.mjs`.

## QA pass (2026-10-11): rules that came out of it

`_toSetup()` / `_stopLevel()` cancel every timer and frame of the level first; `hintArrow(lvl, gone,
red, skip)` never suggests a busy (mid-bump) arrow but still treats it as blocking; Escape on "Out of
lives" acts as the X; Spanish win words scale (`min(46px, 9.6vw)`); Restart is ignored once won;
nothing is saved or bumped once the level is lost (a `lives: 0` once read as 3 lives); the frame loop
restarts after a re-render; in-flight animations finish at once on a real geometry change;
`window.__woTest` is removed with the play screen; popups trap Tab; **the board is playable by
keyboard** (arrow keys pick an arrow, yellow halo, Enter/Space sends it).

## Tests

`node way-out/js/test.js` (engine, ladder, Rush boards) · `node tools/test-arrow-maze-time.mjs` (bands, points,
the real players' totals, recorder, weeks) · `node tools/test-visual.mjs way-out` (PLAY probe with real touch)
· `node tools/check-no-scroll.mjs way-out` · `node tools/test-game-conventions.mjs` · `tools/players-agg.test.mjs`.

## The ladder and points (2026-10-14)

(Full story, formulas rejected and Matt's quotes: CLAUDE-HISTORY.md.) Matt: *"it's just about who has
completed the most levels or who has completed the highest level"*, *"You can start anywhere"*, *"I
want easy level 50 to be basically medium level 51"*, *"Just keep them tied"*, *"Save the time... keep
all data from all plays by everyone."*

**One ladder, four difficulties.** Levels numbered 1, 2, 3 ... Easy 1-50, Medium 51-100, **Hard 101-200,
Expert 201 on** (never ends). A player picks any difficulty and plays its levels in order; each remembers
its own next level (`ladder2[band]`). Finishing 50, 100 or 200 completes that difficulty (setup says
"Complete", Play disabled). Not "highest level" on the board: a new player picking Expert would pass
everyone.

**Points** (`js/arrow-maze-time.js`, `WO_BAND_POINTS`): **flat per difficulty, Easy 1, Medium 2, Hard 4,
Expert 6 a level** (set from real times ~20 s, ~45 s, ~1.5 min, ~2 min). The first build shipped an
unagreed per-level ramp; Matt: *"Change it to what we agreed to."* **Do not reintroduce a per-level ramp
without his say.** Points are read from the per-band cleared counts (`byDiff[band].won`), not a per-level
log (levels are played in order inside a band); they cover every level ever cleared, timed or not;
old-tier levels count as their band's levels in order; counts are per band, so moving the bands moved
no point. **Ties stay tied.** The leaderboard (`js/leaderboard-ui.js`) is ONE number across all four
difficulties and **deliberately not hardest-difficulty-first**; `boardTierOf` returns null for `wayout`
unless a filter is picked (then that difficulty's own points).

**Hints and lost lives cost points (2026-10-17)**, Matt's table: Expert 6, 4, 2, 1; Hard 4, 3, 2, 1;
Medium 2, 1; Easy 1 (`WO_SLIP_POINTS`, `woEarnedPoints`); a slip = a hint or a heart lost on that level,
across Restart / Try again (New game resets). **From that day only**: a timed level adds what it earned
to `wo.pts[band]` and counts in `wo.ptsN[band]` (counters, added across phones in `js/players-agg.js`);
every other cleared level keeps full points (`woPoints`). Matt: *"Let's wait on going back and
recalculating... once we have enough data we can use averages."* The win banner shows `time · +N pts`.

**Boards**: generator 5 `buildLadder(n)` interpolates every setting (grid, arrow lengths, density,
straightness, rounds target) by ladder number between keyframes; level 1 is still the gentle 8x4. **The
bands moved (same evening) to Hard 101-200, Expert 201+ with generator 6** (`buildLadder(n, gen)`,
`LADDER_GEN = 6`, `KEYS6`): levels 1-100 are generator 5's boards EXACTLY (`test.js` checks all 100);
above 100 it climbs through the old Hard tier to the old Expert tier's first board at 200 (24x32) and
holds the old Expert's largest at 260 (28x38, 32 rounds); up to 10 candidates above 100. Seamless at
100/101 and 200/201. Pinned by hash: never change a ladder without a new generator.

**Nothing a player had is lost (THE LAW):**
- Every old cleared level counts; every old timed finish is in `wo.log`; the old `levels`/`ladder`
  fields are written back as stored.
- Positions: `migrateToLadder()` / `migrateToLadder2()` (once per device) derive `ladder2` from the first
  ladder's `ladder` (only Expert moved, 151 -> 201) or, for a player who never opened it, from the old
  tiers' `levels`.
- **A level in progress on an older board is finished on that older board first** (save names its
  board: `src: {k:'L', n, g}` or `{k:'T', tier, level, gen}`), with its arrows gone and its clock; then
  the band moves on to ladder boards. Restart and Out of lives keep that board.
- Log `l` + `g` name the BOARD: g 5 -> first ladder's number; g 6 -> today's number; g 1-4 -> ladder
  position. `js/players-agg.js` keeps the log of the device with the most timed finishes in the merged
  view (each device's own log is whole on that device and in `players/<id>`).
- Verified against real-shaped stores (rule 7): Matt's, King of Games', a first-ladder "Hard complete"
  and a new player; old keys byte-identical afterwards.

Setup shows each difficulty's next level and range ("Levels 51-100"), Play level N, "This level is worth
N points"; How to play's third page says every level earns points.

## Rush (2026-10-14)

A separate timed mode (Matt: start with a few seconds, a bit back per move; *"don't stop the clock. If
someone leaves the app, they lose that round"*; a weekly game with a history tab). Easy/Hard.

- **Where:** a **Levels / Rush** switch under the title (settings `mode`, `rushMode`).
- **The setup screens (Matt's three reviews, 2026-10-14).** **Levels and Rush share ONE layout**
  (*"switching back and forth is weird because things move around slightly"*): picture, title,
  switch, a card of [difficulty buttons, **three tiles** (`_tilesHTML`, `.wo-tiles`: icon, number,
  word), Play], and a footer card `.wo-lead` of [a leader, a pill]. The column is **TOP-aligned**
  (it was centred), so the picture, title, switch and the card's top edge do not move when the mode
  changes (measured identical at 402x874, 360x724, 390x664, 375x667). No "Difficulty" label on
  either. Play buttons share one shape and the hub's blue (`.wo-play`; Rush was teal until 2026-10-16, Matt: *"Make it the same blue"*).
  - **Levels was re-laid out 2026-10-16 (Matt's approved mock-up; Rush kept as it was: *"Now is better
    leave it"*)**, scoped to `.wo-home.is-levels`: smaller picture, taller buttons and tiles, the tiles'
    words only for screen readers (`.wo-sr`), the third tile is the **thick-arrows switch** (was "3
    lives": *"this one is just there"*), and the leader card sits at the bottom. So the picture is a
    different size on the two tabs (accepted). `tools/check-no-scroll.mjs way-out` fits all 8 screens.
  - **Levels (as first built):** each difficulty shows its name, "Level N" and a thin bar of progress through its
    stretch of the ladder (Expert never ends: its solid bar fills every 50 levels and starts over,
    Matt 2026-10-14; it was a dashed track); tiles **+N pts "this level"** (star; "pts" added, Matt 2026-10-14),
    **N "your points"** (cup; from the combined read once it lands, this phone's own until then),
    **3 "lives"** (heart, replaced by the switch above); footer **"🏆 Points leader"** with name and points,
    and a pill (Matt: *"should be in about the same area as it is on the rush screen"*) that is now
    **Leaderboard ›**: the hub leaderboard on Arrow Maze (`_openLeaderboard`; Matt: *"for Minesweeper, we
    linked the Leaderboard. Let's do that instead"*). The game's own Levels results screen is gone. **How to play is the round "?" at the top right of the picture's row**
    (`.wo-herorow`, `.wo-howq`; Levels only; Rush has the same row without it, so nothing moves).
  - **Rush:** Easy / Hard with nothing under them; tiles **10s "to start"** (stopwatch), **+0.5s
    "per arrow"** (teal arrow), **−3s "per mistake"** (red arrow; Matt went back to these after
    trying sentence lines with pills: *"i liked the horizontal layout"*); footer **"🏆 Easy leader
    this week"** (follows the Easy / Hard choice) with name and score, **"-" and "-" when nobody has
    a run** (not "No runs yet"), and **Leaderboard ›**, which opens the hub leaderboard on Rush, that version.
  - **Both footers name the leader by emoji + username, never "You"** (Matt, 2026-10-14; `_leadName`,
    profile name until the combined read lands). Font sizes are the same on both; the score sits
    further left on Rush only because See all results is a wider pill (equal widths truncated names).
  - Leaders come from the Results read (`_loadRushRows`, rows now carry `pts`), in the background at
    most once a minute, refreshed in place; ties all named; "You" for this phone's person.
  - The Rush picture's stopwatch hand spins (`.wo-watch-hand`, 3 s a turn; stands still under
    reduced motion). Short phones shrink the picture first (max-height 760 / 700, and 360x804).
- **Clock** (`js/arrow-maze-time.js`, `RUSH_*`): starts **10 s**, counts DOWN; every arrow sent off
  **+0.5 s**, every bump costs `rushMissMs(mode, board)` (arrow turns red; no hearts, hint or restart).
  **RULES 3 (2026-10-22, Matt, after Thomas ran Easy 10 minutes with 50 s banked; never capped):**
  Easy board 1 0 s, 2 1 s, 3 2 s, 4-6 3 s, 7-9 4 s, 10-12 5 s, then +0.5 s every board (30 = 14 s);
  Hard 1-3 3 s, 4-6 4 s, 7-9 5 s, 10-12 6 s, then +0.5 s every board (30 = 15 s). Rules 1 = 3 s flat
  (to v1215); rules 2 = v1216 only (Hard +1 s every 3 boards, 7 s cap). Each run stores `rv`. The
  Ready popup shows the NEXT board's cost; the setup tile shows board 1's.
- **Tuning data (2026-10-22, Matt: "We need all this data so we know if we need to adjust the
  settings")**: every run also stores `bt` (play ms per board, the last = the board it ended on),
  `ba` (arrows per board), `bc` (clock at each clear), `mx` (each mistake's cost), `mb` (each
  mistake's board), `pk` (highest clock), `gn` / `pn` (ms gained / lost), `res` (resumes), `rv`.
  `woRushExtras` keeps them through every later record (each record re-cleans the whole list: a field
  it does not know would be DROPPED, so a new field goes there first). **Time played** shows live
  at the bar's left and on the end popup (`woRushTime`; play time only, the pauses are not in it). Zero ends the run
  ("Time's up!"). **It pauses only between boards.**
- **Saved between boards (2026-10-22, Thomas via Matt: "let it be saved between rounds not during")**:
  from a board's clear until the next board's Go! (`rush.atReady`), leaving (menu, hub back,
  backgrounding, closing the app) KEEPS the run in `gamehub.wayout.rush.save.v1` (`{ easy, hard }`,
  written at the clear). Leaving during that countdown drops back to Ready. The Rush setup then
  shows **New game | Resume** (Levels' row); Resume = the Ready screen over the veiled cleared
  board. Nothing about the next board is on screen before Go!, so nothing can be studied. At Go!
  the save is marked `live`; a live save found later (app killed mid-board) is recorded as LEFT.
  A waiting save is recorded COUNTED (`at` = when saved, so its own week) when New game replaces it
  or its week ends (`_settleRushSave`). The slot is cleared only after the record is written.
- **Leaving mid-board loses the run**: menu button, the hub back button (`destroy()`), or backgrounding
  (`visibilitychange`) ends it as `left`: STORED (THE LAW), never counted.
  **Except on Matt's devices** (`isAdminDevice()`, 2026-10-14: *"get rid of it for me. I need to be
  able to screenshot... then go back into the game"*): backgrounding HOLDS the run (`_rushHold`: the
  clock stops, runs again on return; a countdown finishing while away freezes at once). Menu and
  hub back still end it. Held time is not in the stored `ms`.
- **Between boards**: a cleared board gets the finish ("Board N cleared!") with the clock STOPPED, then
  the Ready popup (`.wo-ready`: seconds carried, the two rules as chips with sign and word, **Ready**
  button, no X, Escape does nothing), then **3, 2, 1, Go!** (`.wo-count`) over the cleared board; the
  next board appears and the clock restarts only at Go!. Stored `ms` is PLAY time
  (`_rushBoardDone`, `_showRushReady`, `_rushReady`, `_rushGo`). **The FIRST board gets the same
  3, 2, 1, Go!** (Matt, 2026-10-14: *"it's instant. It needs a countdown"*): the run opens paused,
  the board veiled (`rush.veil`, `.wo-stage.is-veiled`), taps and Enter refused, clock at Go
  (`_rushCountdown`, shared). **Popup buttons are `button.wo-*`**
  (`.wo-root button:not(.gh-btn)` resets every game button and outranks a plain class rule).
- **Boards keep coming**, harder: `buildRush(mode, i, seed)` builds board `i` like ladder level
  `rushLevel(mode, i)` (Easy 3, 9, 15 .. up to 50; Hard 51, 59, 67 .. up to 120), with a **random seed
  per run** stored with it.
- **Score = arrows cleared in the run.** Own branch **`wo.rush`** (`recordWayOutRush` in
  `js/game-stats.js`): `runs[mode]` = EVERY run raw `{s, b, ms, m, d, w, sd, left?}`, `best[mode][<Monday>]`
  = best COUNTED run of each week (Math.max only). A run is not a level: `total` / `byDiff` / points
  untouched. Three-edit rule done (recorder, My Stats `wayoutScreen`, `js/players-agg.js`: a week's best
  = best on any of the person's phones).
- **Weeks** (`woWeekKey`): the Monday's date in **UTC**, stamped on each run when it ends.
- **Results live on the hub leaderboard since 2026-10-16** (the in-game Results screens were removed):
  Arrow Maze's board has **Levels | Rush**; Rush has Easy | Hard and **This week** (best run this week),
  **Weeks won** (finished weeks only; ties all win; "of N" = finished weeks they played) and **Past
  weeks** (each finished week's winner). `js/leaderboard-ui.js` `woModesHTML` / `woRushHTML`; opened with
  `openLeaderboard({ game: 'wayout', woMode, woRush })`. The end-of-run popup's Results button opens it
  too. The footers' leaders still come from `_loadRushRows`.
- Tuning (10 s / 0.5 s / 3 s, board steps) is a first guess; every run is stored raw so it can be set
  from real runs.
