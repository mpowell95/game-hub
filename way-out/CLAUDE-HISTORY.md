> **Not auto-loaded.** This is the full text of `way-out/CLAUDE.md` as it stood on 2026-10-14, moved here word for word when that file was trimmed. `CLAUDE.md` holds the current rules in short form; this file holds the incidents, measurements and reasoning behind them. Read the relevant section here before changing anything it covers in depth. Section headings are unchanged, so references like `way-out/CLAUDE.md, "Some heading"` can be found here.

# Arrow Maze — way-out/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

A clone of **"Pointers"** from the *Offline Games* app (Matt, 2026-10-11: *"I just uploaded two
screen recordings to Dropbox for a game called lines. Clone the game exactly and add it to the hub
as admin only. Come up with a different name for our version"*). The recordings are
`/Claude Code Refs/ScreenRecording_10-11-2026 01-58-49_1.MP4` (home, How to play, Easy levels 1-5)
and `.../01-59-51_1.MP4` (Hard and Extra Hard boards, a bump, a full Hard clear) in Matt's Dropbox.
Our name is **Arrow Maze** (es *Laberinto de flechas*).

## The name, and why the folder still says `way-out` (settled — do not "fix")

It shipped on 2026-10-11 as **Way Out** and Matt asked for a new name the same day (*"New name
please"*). Only what a player SEES changed: the hub title, `game_title_wayout`, the game's own
`title`, the page `<title>`. **The folder `way-out/`, hub id `way-out`, stats id `wayout`, prefix
`.wo-` and the keys `gamehub.wayout.v1` / `gamehub.wayout.save.v1` / `gamehub.wayout.saves.v1` keep the first name on
purpose**: the stats id keys every level already cleared in `gamehub.stats` and `players/<id>`,
and the keys hold each tier's level (THE LAW rule 5, old keys are never renamed). Same shape as
Monopoly Deal's `business-deal/` split. A directory name is not a display name.

## Hub integration

- In-hub `module: '../way-out/js/ui.js'`, **immersive**. Hub id `way-out` (the folder); stats id
  `wayout`. Prefix `.wo-root` / `.wo-`.
- **Admin only** (`devOnly: true`, no `released` date: that is the New pill's input and must be the
  day Matt releases it from the admin page). Its `GAME_META` row shipped with the game, so the board
  and every level already cleared appear the moment it is released.
- **Hidden from King of Games (3VN33) AGAIN since the evening of 2026-10-14** (Matt: *"first make it
  invisible to king of games again"*, while the Hard/Expert bands are reworked): `hideFrom: ['3VN33']`
  is back on the `GAMES` entry. It had been lifted earlier that day (*"unblock him from Arrow Maze
  too. Keep arrow maze admin only still though"*). Everyone else still sees it: the live admin config
  has `way-out` set `live: true` (Matt switched it on from the admin page). History:
- **Held back from King of Games (3VN33) since 2026-10-13** (Matt: *"Leave it open for everyone else
  but make it admin only for him rn. Until we decide on this calculation"*): `hideFrom: ['3VN33']`
  on the `GAMES` entry hides his tile and makes `launch()` refuse it (deep links, pushes, the
  Challenges screen); Matt's devices and dev profiles are exempt. His solves and timed levels are
  untouched and still on the leaderboard. **Delete that line to give it back.**
- `isInProgress()` is always `false`: every tap that changes the level autosaves, so leaving is
  lossless.
- Immersive layout copies Murdoku's `_positionRoot()`: a `position: fixed` root measured against the
  mount point; in the hub it runs **edge to edge** (left 0, full `clientWidth`, unlike Murdoku) and
  the top bar shares the floating back button's row. The level title is centred on the screen, not
  in the space the buttons leave.

## Files

| File | Role |
|---|---|
| `js/engine.js` | the whole puzzle: level sizes, the seeded generator, `blockerOf` (the one rule), `hintArrow`. Pure, no DOM |
| `js/test.js` | headless checks, `node way-out/js/test.js` (not precached; `validate-sw-assets.mjs` skips `test.js`) |
| `js/ui.js` | the setup and play screens, the canvas board, input, animation, autosave, the module contract, the `window.__woTest` seam |
| `js/strings.js` | EN/ES, every visible string and aria-label |
| `../js/arrow-maze-time.js` | the timer's penalties, the clock format and the finish-list reader (shared with the stats store and the merge) |
| `css/way-out.css` | all styling |
| `index.html` | the standalone page (name gate before `init`) |

## The rules (as the reference plays)

- The board is a grid of dots. An arrow is a chain of at least two adjacent dots; its last dot is
  the head and it points the way its last segment runs.
- **Tap an arrow and it slides out**: the head goes straight on until it leaves the board and the
  body follows its own path behind it (a snake, not a rigid piece). So the only thing that can stop
  it is another arrow, or its own body, on the straight line from the head to the edge.
- **Blocked**: it slides forward until the head touches the blocker, springs back, **turns red and
  stays red**, and a heart goes. Three hearts. The third bump ends the level ("Out of lives").
- Clearing the board: the dots go green in a wave from the middle, confetti, a purple wash with a
  word sliding through (Victory / Awesome / Well done / Congrats / Next level, as the reference
  rotates them), then the next level loads on its own.
- Hint (the bulb, right end of the hearts row): the reference gates it behind a video ad; here it is free and unlimited. It
  pulses one arrow that can go now, preferring one the player has not already bumped.
- Restart (top right) rebuilds the same level with three hearts. Dimmed while there is nothing to
  undo, as in the reference.
- Out of lives: **Try again** restarts the level; **Change difficulty** and the X go back to the
  setup screen.

## Engine notes (correctness-critical)

- **Every level is solvable, by construction.** Arrows are placed one at a time and an arrow is only
  accepted if its way out is clear of every arrow already placed, so removing them in the reverse of
  placement order always works. And because removing an arrow only ever frees dots, **an arrow that
  is clear stays clear**: any order that only taps clear arrows finishes the board, and a mistake
  never makes a level unwinnable. `test.js` proves it for 60 levels of every tier by greedy-solving
  with the same `hintArrow` the player gets.
- Arrows are placed from the middle outwards (with noise), so a middle arrow's way out runs through
  the still-empty outer ring and the outer arrows placed later are the ones that block it.
- **The tail-growth pass** is what makes boards as packed and winding as the reference's (fill went
  from ~78% to ~88%). Growing a tail never moves a head, so no way out changes; a gap dot `c` may join
  arrow `b`'s tail only if `rayMax[c] < b` (no arrow that must leave BEFORE `b`, and not `b` itself,
  has `c` on its way out). Change that inequality and levels stop being solvable; `test.js` catches it.
- `seedOf(tier, level)` makes "Easy, level 12" the same board on every device and for Restart.
- Level sizes (`levelSpec`, points across x down, then holds at the cap): Easy 8x4 at level 1
  (matching the reference's first board), then 6-10 x 5-13; Medium 10-14 x 13-19; Hard 20-24 x 26-32;
  Expert 24-28 x 32-38. **The board stops growing at level 13 in every tier**; generator 4's ramp is
  what keeps later levels getting harder. Builds take under 20 ms (Hard/Expert up to ~120 ms since
  generators 3-4).

## Harder boards: generator 2 (2026-10-12)

Matt, on Medium level 3: *"This seems way too easy. Can you make it more challenging without
increasing the size and making the arrows smaller/harder to press?"* Measured: generator 1 let ~50-70%
of a Medium board's arrows leave at the first tap and cleared in 3-5 ROUNDS (a round = remove every
arrow free right now; `peel()` in `engine.js`). Building middle-outwards left most edge arrows
pointing straight off the board.

Generator 2 (`buildLevel(tier, level, gen = GEN_LATEST)`), same grid sizes and arrow sizes:
1. flips every arrow that is free at the start (same points, head at the other end, so it points
   INTO the board), keeping a flip only if `peel()` still empties the board and it got harder;
2. builds K candidate boards per level (Easy 3, Medium 6, Hard 4, Expert 3) and keeps the hardest
   (`layers - 20 x share free at start`).

Measured, levels 2-21: free at the first tap Easy 24% / Medium 23% / Hard 27% / Expert 30% (from
~45-55%), rounds Easy 8.5 / Medium 12.3 / Hard 17.9 / Expert 17.9 (from 3.6 / 5.0 / 6.8 / ~7). Slowest
build ~28 ms on a desktop. `way-out/js/test.js` fails if those averages slide back (`FLOOR`).
**Easy level 1 stays generator 1**: the first board anyone sees is a gentle start.

## Expert deeper than Hard: generator 3 (2026-10-13)

Matt, after asking how many rounds each tier takes: *"Expert should be more difficult than hard,
don't you think?"* Generator 2 made Expert BIGGER than Hard but no DEEPER: 17.9 rounds each.
Generator 3 (`GEN_LATEST = 3`, `GEN3` in `engine.js`) changes **Expert only**: shorter, more winding
arrows (`maxLen 12, straight 0.3, jitter 0.1` over `levelSpec`, applied by `specFor()`) on the SAME
grid, so ~112 arrows instead of ~91 and the dots are no smaller; and 10 candidates at 8 passes
instead of 3 at 4. Measured: levels 2-21 average **25.1 rounds** (Hard 17.9); levels 1-60 average
25.9 and the fewest is 21, above Hard's average. Slowest build ~78 ms on a desktop (was ~47), once
per level. Tried and rejected: more candidates alone (16 candidates gave only 22.4 rounds, 112 ms),
longer arrows (fewer rounds). Easy, Medium and Hard build exactly as on generator 2; `test.js` pins
that, pins generator 2's boards by hash, and fails if Expert is not at least 4 rounds deeper than Hard.

## Later levels keep getting harder: generator 4 (2026-10-13)

Matt: *"does each difficulty level get more and more difficult as you beat games?"* Measured: no. The
board stops growing at **level 13** in every tier and, on generators 2-3, so did the rounds (Easy ~9,
Medium ~14, Hard ~18.5, Expert ~26 from level 14 to 120). Matt: *"Yes, make later levels keep getting
harder."*

Generator 4 (`GEN_LATEST = 4`) leaves levels 1-13 exactly as generator 3. From level 14 each board
aims at a **rounds target** (`rampTarget(tier, level)`) that climbs from the old plateau to a ceiling
over 60 levels (full at level 73) and then holds: Easy 9 -> 11, Medium 14 -> 19, Hard 18.5 -> 27,
Expert 26 -> 32 (`RAMP`). It gets there by letting `harden()` flip ANY arrow, not only the ones free
at the start (that alone took Hard's plateau from ~18 to ~27), and stops as soon as the target is met,
so a level is no harder than its place on the ramp. Up to `RAMP_K` candidates (8, Expert 6); the first
to reach the target wins, else the deepest. Measured rounds, levels 14-23 -> 64-73: Easy 9.1 -> 11.2,
Medium 15.1 -> 18.5, Hard 19.4 -> 26.4, Expert 27.1 -> 31.6. Builds: average 1-32 ms, slowest ~120 ms
on a desktop. The ceilings are what 8 candidates reliably reach; 12 added under 1 round for 1.5x the
time. `test.js` pins generator 3 by hash, checks generator 4 = 3 for levels 1-13, that levels 64-73
beat 14-23 by 1.5+ rounds, and that the target never drops.

**Asked for and NOT done (needs Matt's example):** *"The hardest ones are the ones that travel across
the board ... if [it] hit an arrow at the end and if there was even more distance between them."*
The screenshot attached to that message was the Minesweeper leaderboard, so the shape he meant was
not seen. Measured for it: boards are ~90% packed, so at the START a blocked arrow's blocker is almost
always the very next dot (average 1.2 dots; scoring for distance changed nothing). Long-distance blocks
only appear mid-game, once arrows have left. Making them from the start would mean emptier lanes,
i.e. fewer arrows.

**Generator 1 is kept, byte for byte.** A save records `gen`; a level saved before generator 2 (no
`gen`) is rebuilt on generator 1, so its saved "which arrows are gone" still means the same arrows.
`test.js` pins that `buildLevel(t, l, 1)` equals the original `generate()`, and generators 2 and 3 by hash.
Never change `generate()` or an existing generator's output without bumping `GEN_LATEST` and keeping
the old path, or every level in progress scrambles. (Generators 3 and 4 are the worked examples.)

## Input and the tap-target exception

Hard and Expert boards are 20-28 dots across a phone, so a dot is 12-16px apart and a 44px tap
target per arrow is impossible (the reference's are just as small). The board is one canvas and a
tap goes to the **nearest arrow segment** within `max(0.7 x pitch, 22px)`, the documented departure
from the 44px floor (docs/BUILDING-A-GAME.md, the dots-boxes model). Every other control is 44px+.

## Look

- **Known, not yet changed (2026-10-14):** the play screen's menu button (back to the setup screen)
  sits on the Hub button's row right beside it, which Matt rejected on Gridlock the same day (*"The
  back (to the setup screen) is on the same row and basically touching the Hub back button"*); the
  rule is now in docs/BUILDING-A-GAME.md, Part 0. Gridlock's fix: the back arrow stays top left,
  one row DOWN, under the Hub button (not the bottom bar: Matt rejected that too). Arrow Maze needs the
  same when someone works on it.

- **The setup screen's look, per Matt's mock-up (2026-10-14):** the board picture is the headline,
  `clamp(96px, 23vh, 200px)` square, with the title straight under it and **no tagline**; **How to
  play is a real pill** (css/ui.css's plain `.gh-btn`, centred, `.wo-howbtn`), not the ghost text link
  it was. Measured with no clipping and clear of the Hub button at 402x874, 375x667 and 360x724.
- **The picture plays itself (2026-10-14, Matt: "Make the top image thing cooler and better"):**
  `HERO_SVG` in `ui.js` is a 7x7 board built from grid points, its arrows locked the way a real level
  is (the red one has bumped the teal one's body, two lavender ones wait on others), and the free
  teal arrow glows, slides off the right edge with a trail and sparks, and fades back in
  (`.wo-hero-go` / `wo-hero-fx`, 3.6 s loop, CSS only). Reduced motion: it stands still.
- **The Easy play screen, per Matt's mock-up (2026-10-14):** "Arrows remaining: N" and "Arrows
  cleared: N" under the progress bar (`.wo-counts`), and a How to play pill under the board
  (`.wo-playfoot`) that PAUSES THE CLOCK while it is open (`_helpPaused`). **The counters went on
  every difficulty the same day** (Matt: *"I feel the counters can fit on all these screens pretty
  easily"*): a portrait board is width-limited, so the row costs nothing at 390x844 and up (measured);
  at 375x667 Expert's dot spacing drops ~3%. **The pill stays Easy only** (`.is-easy`). Small boards may now grow to fill the width (the
  pitch cap went 40 -> 72px), and every arrow is thicker (`lw = pitch x 0.092`, 1.7-6px; heads
  `pitch x 0.28`, 5-17px), Matt: *"Make the arrows a little thicker too"*.
- **The setup screen is in the hub's own style, not the reference's** (Matt, 2026-10-11: *"Make the
  setup screen look more gamehub themed. Match other games."*). The reference's teal banner, mascot
  faces and slider were replaced by the Sudoku / Minesweeper layout built from `css/ui.css`: a small
  picture of the board, title and one line, a **Difficulty** card of four buttons (shape marker,
  name, and the level that tier is on; the selected one wears the `#ffce3a` accent and a thicker
  outline), **Play level N** (or **Continue level N** when a save exists), then **How to play**. It
  follows the hub's light/dark theme. How to play and Out of lives are `.gh-overlay` / `.gh-modal`
  popups with the close (X) the repo requires.
- **The PLAY screen keeps the reference's dark board in both themes** (it has no light mode);
  colours were sampled from the recordings and are listed at the top of `css/way-out.css`.
- The standalone page has no `css/hub.css`, so `css/way-out.css` gives `css/ui.css`'s `--gh-*`
  tokens the hub's dark values under `.gh-dark` (otherwise the standalone setup screen stayed light
  in dark mode, with the Hard/Expert shapes drawn pale on white).
- The reference's "Extra Hard" is **Expert** here (the repo's difficulty vocabulary). No sound (root
  rule). No ads, no rate-us popup, no favourite star.

## Fitting the screen (Matt, 2026-10-11: "make sure the game fits on the screen and isn't covered by other buttons or cut off")

- **The hint lives at the right end of the hearts row**, not in a row of its own under the board as
  in the reference: that row cost every phone ~70px of board, which on Expert is several rows of
  dots' worth of pitch.
- **In the hub, nothing sits under the floating back button.** The top bar starts to its right
  (`--wo-inset`, measured); the setup screen's content starts below its row; the popups are padded
  below it too (the button stays above the overlay, so a popup must never reach that corner).
- **The level title is centred on the screen** unless that would put it against the buttons beside
  it, in which case `_fitHud()` (measured, every layout) drops it back into the row's flow
  (`.is-tight`; it triggers at 320px wide in the hub).
- Measured on 2026-10-11, in the hub and standalone, light and dark, at 320x568, 375x667, 390x664,
  390x844 and 430x932: every button, the board and the popups on screen, none overlapping each other
  or the hub's back button, no page scroll. Expert's board pitch is ~11px at 320 wide, ~13-14px on
  ordinary phones (it was ~2px less before the hint moved).
- **The root's BOTTOM is `bottom: 0`, never a height measured from the viewport (2026-10-14).** Matt's
  iPhone showed the setup screen cut off in the middle of "How to play" with the picture pushed up
  beside the Hub button: `_positionRoot()` set `height = visualViewport.height` once, an iPhone can
  report a short height mid-transition (535 instead of 874), and nothing re-measured it. Reproduced in
  Chromium by faking that short height; Minesweeper had the same bug and fix on 2026-10-11. The setup
  column also centres with auto margins (`.wo-home > :first-child/:last-child`) and scrolls inside
  itself if a phone is ever too short, so it can never ride up under the Hub button or be clipped.
- **The phones that matter, measured 2026-10-13** (`node read-install-state.mjs --screens`, sizes
  in CSS px from the 10 most active players): 402x874 (King of Games, Matt, Natalia), 414x896
  (Anita), 390x844 (Ele), 360x804 Android in a browser tab (Unai, a 360x724 page). Still unreported:
  TP, HDJ (an older bug report said 384x832), Jojopow, Lili. **So the floor to design for is 360px
  wide and ~724px tall, not 320x568: nobody who plays has a 320-wide phone, and 320x568 checks are
  dropped.** 375x667 (iPhone SE size) stays a check until Lili's phone reports; re-run the command
  and drop it too if nobody active has one.

## Persistence and stats

- Settings `gamehub.wayout.v1`: `{ tier, levels: { easy, medium, hard, expert }, ladder: { ... } }`.
  `ladder` (since 2026-10-14) is the NEXT LADDER level per difficulty and is what the game reads;
  `levels` is the old tiers' next level, FROZEN as stored (written back unchanged, never changed).
  Both only ever go up (`Math.max`), capped at 1,000,000 (a corrupt value once read "Level 1e+21").
- **Since the ladder, the progress and clock keys below (`saves.v1`, `clocks.v1`) are READ ONLY.**
  The ladder's own are `gamehub.wayout.ladder.saves.v1` / `gamehub.wayout.ladder.clocks.v1`, see
  "The ladder and points".
- Progress `gamehub.wayout.saves.v1` (since the 2026-10-11 QA pass): ONE SAVE PER TIER,
  `{ easy: save|null, medium, hard, expert, migrated: 1 }`, each save `{ v, tier, level, gen, gone[],
  red[], lives }` (`gen`: the board generator it was played on, none = 1), written after every tap that changes the level, set to null on a win, a restart
  or a loss. Trusted only for the exact tier and level being opened; anything malformed starts the
  level fresh. **The first build's single slot, `gamehub.wayout.save.v1`, is read ONCE into its
  tier's slot (`migrated: 1`) and then left untouched, never written or deleted (rule 5).** One
  shared slot meant playing Easy wiped an unfinished Medium level.
- "Continue level N" shows only when the save holds real progress (an arrow gone or red, or a heart
  lost), not merely when a save exists.
- **A save with every arrow gone is a win that was never counted** (the player left while the last
  arrow was still sliding out): opening it runs the win sequence, records it and moves on, instead
  of an empty board.
- Stats: **`recordWayOut(tier, finish)`** once per level cleared (since 2026-10-13; it was
  `recordResult('wayout', tier, true)`, and it still counts exactly that: one play and one win in
  total and in the tier). It also feeds the **`wo` sub-counter** (see "Timer"), so the
  three-edit rule applies and all three are done: `js/game-stats.js` (`ensureWo`, `recordWayOut`),
  My Stats (`wayoutScreen`: solved and timed per difficulty), `js/players-agg.js` (counters add;
  per difficulty the log of the device with the most timed finishes). `wayout` is in the SOLO set.
- The clock `gamehub.wayout.clocks.v1`: `{ <tier>: { level, gen, ms, pen, mistakes, hints, partial } | null }`.

## Timer (2026-10-13)

Matt: *"add a timer (like minesweeper); if someone messes up, they lose a heart, but their time also
increases"*. Mistakes **climb** (*"losing 1 heart on easy is +10, losing a second is +20. On medium
it's +15, +30, hard +20, +40, expert +30s, +60s"*); a hint costs **the same as a mistake**.

- **The clock** sits at the left end of the hearts row and shows time WITH penalties. It runs only
  while a level is on screen, unfinished, and the app is in front (`visibilitychange`). It lives in
  its own key, not in the save, because the save is cleared by Restart and Out of lives and **the
  clock is not**: a level's time runs from its first open until it is cleared, through every
  Restart and Try again. It starts at 0 on each new level.
- **Penalties** (`WO_PENALTY_S`): the first heart lost in an attempt costs the tier's base, the
  second double; the third ends the attempt with no extra charge (the clock keeps running into the
  retry). **A hint costs the base once**; tapping the bulb again while the same hint is still
  pulsing does not charge again. A "+20s" badge flashes beside the clock.
- **Every timed finish is stored raw** in `wo.log[<tier>]`: `{t, a, r, m, h}` = ms with penalties,
  arrows, rounds, hearts lost, hints. Nothing is computed from it yet. `wo.recent` / `wo.best` are
  lists the first timed build wrote; they are no longer written and are kept as stored (rule 5);
  `log` was seeded from `recent` on the first write after this change.
- **The score is POINTS, not time** (decided 2026-10-14, see "The ladder and points" below). The
  clock and the log stay: every finish is kept so time can come back into the score once there is
  enough of it (Matt: *"Save the time and we can switch back to the time being factored into the
  score when we know how long things typically take"*).
- **Not timed, honestly:** a level resumed from a save made before the timer shipped has no honest
  time (`partial`), and levels cleared before it have none either. Both still count as solved
  everywhere (rule 4: never invent a number).
- **The win banner** shows the level's time under the win word.
- Tests: `test-arrow-maze-time.mjs` (penalties, and the recorder on top of the old writer's store),
  `players-agg.test.mjs` (the two-phone merge).

## The QA pass (2026-10-11)

Matt: *"test play it ... I want ALL bugs and glitches discovered and fixed."* A Sonnet QA agent
played it in the hub and standalone (5 phone sizes, light/dark, EN/ES, rapid and abusive input,
corrupt storage, 300 generated levels per tier) and a code read ran alongside. Fixed, each
re-checked with the agent's own repro scripts:

1. Leaving (back, reload, hub back, phone lock) while the LAST arrow slid out lost the win and left
   an empty, unwinnable board behind "Continue". Now counted on reopen (Persistence, above).
2. Back to setup during the win sequence pulled the player into the next level 2.5 s later, and
   during the 650 ms before "Out of lives" put that popup over the setup screen. `_toSetup()` /
   `_stopLevel()` cancel every timer and frame of the level first.
3. The hint treated an arrow mid-bump as gone, so it could point at an arrow that was really
   blocked (and following it cost a heart). `hintArrow(lvl, gone, red, skip)`: a busy arrow is never
   suggested but still blocks.
4. Escape on "Out of lives" closed the popup and left a dead board; it now acts as the X.
5. The Spanish win words ran off phones 390px wide or narrower; the banner scales (`min(46px, 9.6vw)`).
6. Restart during the win sequence replayed the won level (counted twice); Restart is ignored once won.
7. A second bump in flight after the last heart wrote `lives: 0` back, which reads as 3 lives on
   reload, and could leave more than 3 red arrows. Nothing is saved or bumped once the level is lost.
8. A re-render mid-level (language change) froze arrows mid-animation and lost a pending win; the
   frame loop restarts after binding, and a lost level re-shows "Out of lives".
9. A resize/rotate mid-animation slid the arrow across its OLD pixels; in-flight animations finish
   at once on a real geometry change (a bump still costs its heart).
10. `window.__woTest` outlived the play screen; a right-click sent an arrow (primary button only now).
11. Keyboard: arrow keys move between the difficulty radios; popups trap Tab and give focus back on
    close; **the board is playable by keyboard** (focus it, arrow keys pick an arrow, shown with a
    yellow halo, Enter/Space sends it).

Not changed, on purpose: taps fire on `pointerdown` (instant, as in the reference); the standalone
page's `/favicon.ico` 404 is shared with every game's standalone page.

## Tests

- `node way-out/js/test.js` (engine); `node test-arrow-maze-time.mjs` (the timer).
- `node test-visual.mjs way-out` has a PLAY probe: Play, tap a clear arrow (it leaves), tap a
  blocked one (it bounces and a heart goes), through real touch.
- `node check-no-scroll.mjs way-out`, `node test-game-conventions.mjs`.

## The ladder and points (2026-10-14)

Matt, after three rounds of timed-score formulas (every one of them had a real problem: see the
session's reasoning in the commit): *"What if we throw out all of this and do it more like other apps
and games do it? ... it's just about who has completed the most levels or who has completed the
highest level"*, then *"You can start anywhere"*, *"I like tiered. Since they get progressively harder
and harder, maybe points should do something"*, *"I want easy level 50 to be basically medium level
51. There shouldn't be a big jump between individual levels"*, *"Just keep them tied"*, and *"Save the
time ... keep all data from all plays by everyone."*

**One ladder, four difficulties.** Levels are numbered 1, 2, 3 ... for ever. Easy is 1-50, Medium
51-100, **Hard 101-200, Expert 201 on** (never ends; see "The bands moved" below: it was Hard 101-150,
Expert 151 on until the evening it shipped). A player picks any difficulty and plays its levels in
order; each difficulty remembers its own next level (settings `ladder2[band]`). Finishing level 50,
100 or 200 completes that difficulty: back to the setup screen, which says "Complete" and disables Play.

**Why not "highest level" on the leaderboard:** with "start anywhere", a new player picks Expert,
clears 201 and passes everyone who climbed 1-200. So the board counts POINTS for levels cleared.

**Points** (`js/arrow-maze-time.js`, `WO_BAND_POINTS`): **flat per difficulty, Easy 1, Medium 2, Hard 4,
Expert 6 a level**, the scheme Matt agreed to (set from how long each difficulty's levels take in the
real saved times: ~20 s, ~45 s, ~1.5 min, ~2 min). **The first build shipped a different rule nobody
agreed to** (1 for levels 1-25, +1 every 25 levels, up to 8, so Expert was 7-8); Matt caught it on the
board and it was replaced the same day: *"Change it to what we agreed to."* Do not reintroduce a
per-level ramp without his say. A player's points = the sum over every level they have cleared. **They are read from the per-band
cleared counts** (`byDiff[band].won`), not from a per-level log: inside a band levels are always
played in order, so "cleared 27 of Hard" means exactly ladder 101-127. Moving the bands changed no
count and no point: counts are per band. That covers every level ever
cleared, timed or not, from the day the game shipped. Old-tier levels count as their band's levels in
order (old Hard 27 = ladder 101-127). A count past a band's 50 (only possible from the old endless
tiers) earns the same per level. **Ties stay tied.** The board (`js/leaderboard-
ui.js`) is ONE number across all four difficulties and is **deliberately not hardest-difficulty-first**
(Matt: a slow Expert player must not outrank a good Hard one); `boardTierOf` returns null for
`wayout` unless a filter is picked, and a filter shows that difficulty's own points. On 2026-10-14
(real synced data): King of Games 134, Anita Bonita 47, MattyIce 41, Ele 26.

**The boards: generator 5, "the ladder"** (`buildLadder(n)` in `engine.js`). Every setting of a
board (grid size, arrow lengths, density, straightness, the rounds target) is interpolated by ladder
number between six KEYFRAMES (levels 2, 13, 50, 100, 150, 200) sitting on the old tiers' own sizes, so
the ladder covers the same range of boards: 6x6 at 2, 10x13 at 13, 12x16 at 50, 17x23 at 100, 23x30
at 150, 28x38 from 200. Each board flips arrows toward its rounds target (generator 4's mechanism)
and the candidate nearest the target wins. Level 1 is still the gentle 8x4 first board. Measured:
the grid never shrinks and grows at most one dot a level, neighbours are within 4 rounds, 50/51,
100/101 and 150/151 are seamless; rounds average ~4 at 2, 12.7 at 41-50, 18.7 at 91-100, 24.8 at
141-150, 30.4 at 191-200, then hold. Slowest build ~90 ms on a desktop. `test.js` checks all of that
for levels 1-230 and **pins the ladder by hash**: never change it without a new generator.

**Nothing a player had is lost** (THE LAW):
- Every old cleared level still counts (points from the counts, above), and every old timed finish
  is still in `wo.log`.
- Each difficulty's ladder position starts where the old tier was (old Medium next level 11 =
  ladder 61). Written into `ladder` the first time the game opens (`migrateToLadder()`).
- **A level that was in progress on an old tier is finished on its own old board first**, with its
  arrows already gone and its clock, as that band's current ladder level. The ladder save names its
  board (`src`: `{k:'L', n}` or `{k:'T', tier, level, gen}`), so Restart and Out of lives keep that
  board. After it is cleared the band moves on to ladder boards.
- The old `saves.v1` / `clocks.v1` keys are only READ (once), never written again; the old `levels`
  field is written back exactly as stored.

**Every finish is kept, with more than before:** `wo.log` entries gained `l` (the ladder level), `g`
(the board generator: 5 ladder, 1-4 an old board) and `d` (when, epoch ms). Additive, so time can
come back into the score later with real numbers. **Not changed:** `js/players-agg.js` still keeps
the log of the device with the most timed finishes per difficulty in the MERGED view (each device's
own log is whole on that device and in its `players/<id>` node); points come from the counters,
which add across devices.

**The setup screen** shows each difficulty's next level and its range ("Levels 51-100"), Play
level N, and "This level is worth N points". How to play's third page says every level earns points.

Tests: `node way-out/js/test.js` (the ladder, plus the old generators unchanged), `node
test-arrow-maze-time.mjs` (bands, points, the real players' totals, the recorder's new fields).
Checked in Chromium (402x874, light and dark): the carried-over old level (its board, its gone arrow,
its 12 s clock), the move onto ladder boards, Easy 50 completing the band, a new player starting at
Expert 151, and the leaderboard with the real synced data.

## The bands moved: Hard 101-200, Expert 201 on, generator 6 (2026-10-14, the same evening)

The first real play on the ladder showed **its Expert was the old HARD tier**: Matt's Expert 152-156
had 79-92 arrows and 23-27 rounds, King of Games' old Hard boards ~84 arrows and 19-20 rounds, and
Anita's new Hard 101-104 had 50-61 arrows, closer to old Medium. Generator 5's keyframes put old Hard
sizes at 150 and old Expert sizes only at 200. Matt: *"maybe we spread it out more and add more hard
levels in and keep expert as expert? You came up with the bands so you should just make it work."*

- **Bands** (`js/arrow-maze-time.js`): Easy 1-50, Medium 51-100, **Hard 101-200 (100 levels), Expert
  201 on.** Points unchanged (1/2/4/6 a level, from the per-band counts, so no total moved).
- **Ladder generator 6** (`buildLadder(n, gen)`, `LADDER_GEN = 6`, `KEYS6`): levels 1-100 are
  generator 5's boards EXACTLY (`test.js` checks all 100), so Easy and Medium did not change. From 100
  it climbs through the old Hard tier (its 20x26 first grid by 125) to the old EXPERT tier's first
  board at 200 (24x32, short winding arrows), then grows to the old Expert's largest and deepest
  (28x38, 32 rounds) by 260 and holds. Measured: Hard 101-110 19.6 rounds / 56 arrows, 191-200 26.9 /
  85; **Expert 201-210 27.4 rounds / 95 arrows** (the old Expert tier's levels 1-10: 23.9 / 100),
  251-260 31.9 / 124 (old Expert 64-73: 31.6 / 123). Up to 10 candidates above level 100 (6 left a
  big Hard board 4+ rounds short of its neighbours); builds median 18 ms, slowest ~150-200 ms on a
  desktop. Seamless at 100/101 and 200/201. Pinned by hash in `test.js`; generator 5 stays pinned too.
- **Moving everyone across, nothing lost (THE LAW):**
  - Positions: settings gained **`ladder2`** (today's numbering). It is derived once from the first
    ladder's `ladder` (same place in the same band: only Expert moved, 151 -> 201, so Matt's next
    Expert 157 became 207) or, for a player who never opened the first ladder, from the old tiers'
    `levels`. **`ladder` and `levels` are written back exactly as stored.** A first-ladder Hard 151
    ("Complete" then) is now simply Hard level 151, playable.
  - Levels in progress: new keys **`gamehub.wayout.ladder2.saves.v1` / `.ladder2.clocks.v1`**
    (`migrateToLadder2()`, once per device). A first-ladder level in progress is finished **on its own
    first-ladder board** (`src: {k:'L', n, g: 5}`, its old number) with its arrows and clock; an
    old-tier level in progress (`src.k 'T'`) likewise. The first ladder's keys
    (`gamehub.wayout.ladder.saves.v1` / `.clocks.v1`) are now only READ, never written.
  - The log: `l` + `g` name the BOARD. For `g` 5 `l` is the first ladder's number (a carried board
    keeps it); for `g` 6 it is today's number; for `g` 1-4 (old tiers) it is the ladder position.
- Checked in Chromium with real-shaped stores (rule 7): Matt's (Expert 157 in progress -> Continue
  level 207 on board 157 with its 2 arrows, red arrow, 2 lives and 1:10 clock; cleared as l 157 g 5;
  then 208 on generator 6), a first-ladder Hard save on an old-tier board, King of Games' shape (never
  opened the ladder, old Hard 28 in progress -> Continue level 128 on that board), a first-ladder
  "Hard complete" (-> Hard 151 playable), and a new player (1 / 51 / 101 / 201). The old keys were
  byte-identical afterwards.

## Rush (2026-10-14)

Matt: *"a new game mode where you only have a second or two ... Like those chess games where you
start with a few seconds and get a second back for every move"*, then: *"don't stop the clock. If
someone leaves the app, they lose that round"*, *"try getting just half a second"*, *"10 seconds is
fine to start, but it feels like way too long"*, *"boards keep coming? ... Go ahead with this and
we'll see"*, mistakes 3 s ("Ok"), *"a separate game mode"*, *"a weekly game and have a history tab
where you can look at results from previous weeks"*, Easy/Hard ("Sure"). He also said no game should
ever take minutes: the times logged are seconds per board.

- **Where:** a **Levels / Rush** switch under the title on the setup screen (settings `mode`,
  `rushMode`: remembered choices). Rush has Easy and Hard, **Play Rush**, the rules line, and
  **Results**.
- **The clock** (`js/arrow-maze-time.js`, `RUSH_*`): starts at **10 s** and counts DOWN; every arrow
  sent off gives **+0.5 s**, every bump **-3 s** (the arrow turns red; no hearts, no hint, no
  restart). It runs while a board is being played and when it reaches zero the run ends ("Time's
  up!"). **It pauses only between boards** (below).
- **Leaving loses the run:** the menu button, the hub's back button (`destroy()`), or the app going
  to the background (`visibilitychange`) ends it as `left`. It is STORED (THE LAW) and never counted.
- **Between boards (2026-10-14, Matt: *"When you finish a board it should do the normal finish
  thing and pause the clock. Say you have x seconds going into the next board ... and say ready?
  When the player clicks ready. Do a fun 3,2,1, go! countdown then show the new board and start the
  clock again"*):** a cleared board gets the levels' finish (green wave, confetti, the purple banner,
  here saying "Board N cleared!") with the clock STOPPED; then a popup: "Board N cleared!", the
  seconds carried into the next board, "Every arrow gives you half a second back. Mistakes take away 3
  seconds.", "Ready?" and a **Ready** button (no X, and Escape does nothing: the run is still on).
  Ready plays **3, 2, 1, Go!** (`.wo-count`) over the cleared board, and only at Go! does the next
  board appear and the clock restart, so a paused player never sees the next board. Leaving during
  the pause still loses the run. The run's stored `ms` is PLAY time, without the pauses
  (`_rushBoardDone`, `_showRushReady`, `_rushReady`, `_rushGo`). **The popup is in the board's own
  look** (Matt: *"Make the ready popup better. More on theme"*; `.wo-ready`): the play screen's dark
  gradient in both hub themes, a green "✓ BOARD N CLEARED!" pill, the seconds big in the leaving-arrow
  teal, the two rules as chips with a teal arrow / "+0.5s" and a red arrow / "-3s" (sign and word,
  never colour alone), the arrows so far, "Ready?" and a teal Ready pill that pulses (still under
  reduced motion: no pulse, no pop-in). **Its buttons are `button.wo-*`**: `.wo-root button:not(.gh-btn)` resets every
  game button's font and colour and outranks a plain class rule, which had left the Ready text thin
  and white (the same fix went on `.wo-mode` and `.wo-rb-week`).
- **Boards keep coming**, each a little harder.
  `buildRush(mode, i, seed)` in `engine.js`: board `i` is built like ladder level `rushLevel(mode, i)`
  (Easy 3, 9, 15 ... up to 50; Hard 51, 59, 67 ... up to 120, i.e. from the MEDIUM band: Hard-band
  boards start at ~56 arrows, more than a first board can hold at this clock), with a **random seed
  per run** so a run cannot be learned by heart (the seed is stored with the run; same seed, same
  boards). The next board is built while the current one is played (builds < 25 ms on a desktop).
- **Score = arrows cleared in the run.** Its own branch, **`wo.rush`** (`recordWayOutRush` in
  `js/game-stats.js`): `runs[mode]` = EVERY run raw `{s, b, ms, m, d, w, sd, left?}`, and
  `best[mode][<Monday>]` = the best COUNTED run of each week (Math.max only). A run is not a level:
  `total` / `byDiff` / points are untouched. The three-edit rule is done: the recorder, My Stats
  (`wayoutScreen`: this week, best week, runs per version; a player with only Rush runs is no longer
  "empty"), and `js/players-agg.js` (a week's best = the best on any of the person's phones; the
  longest run list).
- **Weeks** (`woWeekKey`): the Monday's date in **UTC**, one clock for everyone (Sunday evening in the
  US, early Monday in Spain). Stamped on each run when it ends.
- **Results** (inside the game, not the hub leaderboard): Easy / Hard, **This week** and **Past
  weeks** (each past week with its winner; tap for the full table). Read once per opening from
  `players/` (`readPlayersOnce`), this phone's own fresh store standing in for itself, combined per
  person by `aggregatePlayers`; test accounts hidden as on the leaderboard, except from themselves.
  Ties share a place. Offline it shows only this phone's runs and says so.
- **Tuning:** 10 s / 0.5 s / 3 s and the board steps are a first guess; every run is stored raw so
  they can be set from real runs. At ~1 arrow a second a run lasts ~20 s; at 1.5 a second, ~40 s.
- Tests: `way-out/js/test.js` (Rush boards: well formed, solvable, seeded, climbing), `node
  test-arrow-maze-time.mjs` (weeks, the recorder: every run kept, a left run never counts, a new
  week starts its own best, a run is not a level), `players-agg.test.mjs` (the two-phone merge).
  Checked in Chromium: a whole run (+0.5 s, -3 s, the clock stopping at a cleared board and staying
  stopped on the Ready screen, the seconds shown matching it, 3-2-1-Go! with the board hidden, board 2
  and the clock starting at Go!, time running out, the popup, the stored run and week best), leaving by the menu and by backgrounding
  (stored as `left`, not counted), the results screen, and the setup and play screens in the hub at
  402x874, 360x724, 390x664 and 375x667 (no scroll, clear of the Hub button).



## Rush setup card, after Matt's review (2026-10-14, added after the trim)

Moved here word for word from the `CLAUDE.md` edit made on main the same day:

- **The Rush setup card, after Matt's review (2026-10-14, *"#1 was my chief concern. Fix all"*):**
  1. the rules are **three tiles**, not a sentence: stopwatch **10s** "to start", teal arrow
     **+0.5s** "per arrow", red arrow **−3s** "per mistake" (`.wo-rush-tiles`; a sign and a word on
     each, colour third; a real minus sign, the hyphen left a gap);
  2. each version says what it is: "Smaller boards" / "Bigger boards";
  3. **dark mode's selected difficulty** is a lifted dark surface with the yellow outline (the yellow
     tint went olive), Levels too;
  4. **the Levels / Rush switch** has a darker track and the BRIGHTEST tab is the chosen one (it read
     backwards in dark mode);
  5. Rush looks like itself: **Play Rush is the Ready button's teal**, and a **stopwatch badge** sits
     on the picture;
  6. a standing line under Play: "🏆 You lead this week (41)" or "Leader: Ana 52 · You: 2nd", then
     "Resets in N days" (`_rushStandingText`; everyone's rows are the Results read, done in the
     background at most once a minute; this phone's own best is always its fresh local one; until
     the read lands, or offline, only the reset shows). `woWeekEnd()` is the next Monday 00:00 UTC.
