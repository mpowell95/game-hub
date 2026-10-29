# Minesweeper — `minesweeper/`

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file. Nothing below overrides it.

Built 2026-09-21. Design artifacts: `reference/minesweeper/mockup.html` (all eight screens at
393x852, and it measures its own fit) and `reference/minesweeper/SPEC.md` (the durable values).

## Hub integration

- **In-hub `module:`**, `js/hub.js` id `minesweeper`, stats id `minesweeper`.
- **LIVE for everyone since 2026-09-22.** It shipped `devOnly: true` and was released in code
  rather than by an override, after Matt set it live on the admin page and the tile did not appear.
  **An override beats the registry default in BOTH directions**, so a stale
  `adminConfig/v1/games/minesweeper.live = false` would still hide it; setting it back to Live on
  that page writes `true` and the two agree. Keeping one decision in two places is what made this
  confusing, which is why `devOnly` is gone rather than left with an override on top of it.
- **(historical) `devOnly: true` while it was tested.** That is a DEFAULT, not a
  lock: the admin control page can release it to everyone with no commit and no deploy. Which is
  exactly why it HAS a `GAME_META` row in `js/leaderboard-ui.js` — a game released that way gets no
  release commit to add one, and a missing row counts every play on it as zero (rule 1, and how
  Yahtzee shipped). `tools/players-agg.test.mjs`'s `OFF_THE_BOARD` stays empty.
- **No `released` date**, deliberately. The "New" pill belongs to the day this goes live for
  everyone, which is a decision made in the app, not here.
- **Immersive since 2026-10-15** (Matt: the hub's plain "Minesweeper" title was "pretty
  lackluster"). Every screen opens with its own title row (`_topbar()`: the MINESWEEPER wordmark,
  centred on the screen, a button on the right) level with the hub's floating Hub button, measured
  in `_positionRoot()` (`--ms-top`, `--ms-inset`) the way Murdoku does. Cell sizes were always
  measured, so the board simply got the header's height back. (It was "not immersive" before.)
- **`isInProgress()` returns `false`, even mid-board.** Autosave/resume is built in and the clock
  is banked with it, so leaving is lossless. Root `CLAUDE.md`'s second `isInProgress()` meaning,
  the Sudoku / Nuts & Bolts class, not the Ball Run class.

## Layout

| File | Role |
|---|---|
| `js/engine.js` | pure board logic: generation, flood fill, flags, chording, win detection, serialize/deserialize. No DOM, no storage, no timers, no imports |
| `js/ui.js` | the DOM shell, input, timer, the three screens, the module contract |
| `js/strings.js` | EN/ES, 50 keys |
| `css/minesweeper.css` | `.ms-root` / `.ms-` prefix, every rule descendant-scoped |
| `index.html` | the standalone page, name-gated before `init()` |

Tests: `tools/test-minesweeper-engine.mjs` (98 assertions, headless, no browser).

## The board ladder, and why it is not the classic one

| Difficulty id | Grid | Mines | Density | Cell px at 393 wide |
|---|---|---|---|---|
| `easy` | 8 x 10 | 10 | 12.5% | 44 |
| `medium` | 10 x 13 | 20 | 15.4% | 35 |
| `hard` | 12 x 16 | 38 | 19.8% | 28 |
| `expert` | 14 x 18 | 55 | 21.8% | 24 |

The DENSITIES track the classic ladder (12.3 / 15.6 / 20.6%). The GRIDS do not: classic Expert is
30 x 16, which on a phone is either unreadable or needs pan and zoom, and a game in this hub must
fit one screen with no scrolling of any kind.

**The root's BOTTOM is `bottom: 0`, never a measured height (2026-10-11).** `_positionRoot()` used
to set `height = visualViewport.height - top` once at mount; on an iPhone that could land on a short
viewport mid-transition and clip the setup screen below "Your best time" for the whole visit. It now
pins `bottom: 0` and re-runs on every screen render. The setup rows were tightened at the same time
(difficulty rows 44px, the Part 0 floor) so the whole menu fits 393x852 under the hub header with a
34px home-indicator inset.

**Cell size is measured, never computed from a `vh` formula.** `_fit()` reads the board wrap's own
client box (it is the flex child that owns whatever is left after the HUD and the bar) and divides.
That is the only thing that is correct in BOTH hosts, because the hub adds chrome a standalone page
does not. A zero-size measurement means layout has not settled (the `.hub-game` height trap) and
retries on the next frame rather than baking in a nonsense size.

## The loupe, and the 44px tap floor

Only Easy meets Part 0's 44x44 minimum. Medium (35), Hard (28) and Expert (24) are under it, and
this is the documented departure, not a silent smaller number:

**While a finger is down, a bubble above the thumb shows the cell actually targeted, and the tap
commits on RELEASE.** Sliding retargets it. So the effective tap target is the whole board, and the
precision requirement moves to a readout the thumb is not covering. Without this, Expert is not
shippable at 24px; the two go together, and removing the loupe means removing Expert.

The loupe flips BELOW the finger for the top rows, where "above" would be off the board, and the
arrow flips with it. It is clamped horizontally to the board's own width.

**Still owed:** the dots-boxes proof — `elementFromPoint` at every cell centre on all four ladders,
zero mismatches. `dots-boxes/CLAUDE.md` is the model for how a sub-44px target is justified here,
and that verification has not been run yet.

## Input

Pointer events, bound to the BOARD element, never to `document` or `window` — a non-passive
document-level touch listener turns off compositor scrolling for the whole page for as long as this
game is mounted (root `CLAUDE.md`, scroll and touch rules). Pointer capture is what lets a drag that
leaves the board still deliver its move and up events.

| Action | Result |
|---|---|
| Tap in Dig mode | opens the cell, on lift |
| Tap in Flag mode | blank -> flag -> ? -> blank (`E.cycleMark`); with "? marks" off, flag <-> blank |
| Long press (450ms), either mode | the same cycle. Optional, on by default |
| Tap an already-open number | CHORD: opens every remaining neighbour, if its flags match its count |
| Drag before lifting | retargets; the loupe shows which cell is live |
| First tap of a game | never a mine |

A press that wanders more than 14px cancels the pending long press: that is a drag, not a hold.
Retargeting cancels it too, because the hold belonged to the cell it started on.

**Flag mode is impossible to miss (2026-10-11).** Ana dug a mine twice thinking she was flagging.
In Flag mode the Flag button turns vermilion (Dig stays blue), the board gets a vermilion frame
(`outline`, so the measured cell size is untouched), and the loupe carries a flag badge.
`_syncMode()` sets `.is-flagmode` on `.ms-play`; `renderGame()` calls it, so a resumed board in
Flag mode shows it too. Matt chose this over a "safe hold" and a "forgive one mine" option.

**"?" marks (2026-10-15, Matt: "add a ? feature i guess")**: the classic note-to-self. Engine
state `QUESTION = 3`: not a flag (no mine count, chord ignores it as a flag and OPENS it), opens
like a hidden cell, revealed if it hid a mine. Setup option "? marks" (`marks`, default on). Old
saves never contain a 3, so they load unchanged.

**Chording can kill you**, and that is correct — a flag in the wrong place is the player's own
mistake, and the engine test covers exactly that case. Do not "fix" it.

## Generation

The board is generated AFTER the first tap, around it: no mine may be placed in the 3x3 block
centred on that cell. **That also guarantees the first tap is a zero**, because `num` at that cell
counts exactly the eight neighbours the exclusion zone forbids — so the first tap always opens an
area, on every level, measured at 100% over 800 seeded runs. `generate()` still carries a
40-attempt retry loop for the zero; under the current levels it never runs past attempt 0, and its
comment says so rather than leaving a future reader to assume it is load-bearing.

**How much guessing each level needs** (redone 2026-10-15 after Matt: "your numbers are wrong";
`node tools/minesweeper-odds.mjs`). A perfect player (exact mine odds for every square, guesses the
safest square only when nothing is certain), our first-tap opening, 20,000 boards a level (Expert 4,000):

| Level | Boards with no guess | Average guesses | Perfect-player win % |
|---|---|---|---|
| Easy | 88% | 0.2 | 96% |
| Medium | 74% | 0.4 | 90% |
| Hard | 33% | 1.7 | 67% |
| Expert | 15% | 2.9 | 48% |

**Calibrated against an outside source:** the same tool under classic rules reproduces Minesweepr's
published 100,000-game figures (mrgris.com/projects/minesweepr, "None" strategy): 9×9/10 84.9 vs 84.8,
8×8/10 74.1 vs 74.1, 16×16/40 69.7 vs 69.2, 30×16/99 32.4 vs 33.1. The first table (same day, an
older script whose guesses used rough odds) said 81 / 65 / 25 / 10% no-guess and 95 / 89 / 63 / 43%
wins: it overstated guessing everywhere and understated Hard and Expert.

Real players (live records, 2026-10-15, `tools/read-minesweeper.mjs`): Easy ~13%, Medium ~11%, Hard 1 of 82 (Anita, 7:00), Expert 0 of 22. (An earlier same-day read said Hard 0 of 70; that was stale.)

**The board and the screen were checked three ways (2026-10-15, after Matt asked whether the test was broken):**
every square's centre and edges map to the right square on all four levels at three phone sizes;
the solver never died on a move it called certain (1,600 boards); and the same solver playing through
the real screen with real taps won 29 of 40 Hard boards.

**EASY IS ALWAYS NO-GUESS, FOR EVERYONE (2026-10-16, Matt: *"Easy MUST be NO GUESS EVER"*, after an
Easy board ended in a forced 50/50).** `_noGuessOn(level)` returns true for `easy` on every device;
no NG tag on Easy (it is simply how Easy is). A paused Easy board dealt before this finishes as
dealt. Measured: 3,000 Easy deals, 0 fell back to an ordinary board, median 0.2 ms, worst 26 ms
(desktop), so the 2.5 s fallback is not expected to fire even on a slow phone. Those plays count
normally and are tallied in `ms.noGuess.easy`.

**No-guess boards on Medium, Hard, Expert: REMOVED 2026-10-16** (Matt: *"remove the 'No guessing'
toggle"*). Only Easy deals no-guess now; the stored `noGuess` setting is still read and carried but
deals nothing, and a paused NG board still finishes as dealt (with its NG tag). History, as it was:
(2026-10-15, Matt's devices only) option "No guessing" (`noGuess` setting, shown only when
`isAdminDevice()`). `E.generateNoGuess()` deals a board only if
the engine's logic (`deduce()`: the cheap rules, then an exact count of every mine layout per group of
numbers, then the mine count; node cap 200k) clears it from the first tap with no guess; it retries
within 2.5 s, then keeps the last board and sets `noGuessOk: false`. Measured (desktop, 100 boards a
level): all passed; deal time median 0 / 1 / 5 / 41 ms, slowest 8 / 12 / 128 / 1038 ms; an
independent solver confirmed 0 of 400 needed a guess. The board carries `noGuess` (saved; old saves
read as ordinary) and an **NG** tag on the level button. **Since 2026-10-16 its rounds COUNT like any
board** (Matt: *"Keep the no guesses only available to me. Make my games count"*): totals, tier,
best time, leaderboard. Each is also tallied in `ms.noGuess[level]` = {played, won} (a report, so
they can always be told apart). Rounds played 2026-10-15/16 before that went to `ms.practice[level]`
and still count for nothing; they stay there (rule 5). The recorder still honours `practice` for a
phone on the old build.

**Why each board is lost (2026-10-15, Matt: "record why people lose"):** `E.lossCause(state, how)`
judges the fatal square from what the player could see (open numbers only, never their flags):
`slip` (provably a mine with a provably safe square beside it), `misread` (provably a mine),
`rushed` (a guess while a safe square existed), `forced` (a guess the board demanded), `chord` (a
wrong flag), `unknown` (logic capped). Stored as `ms.lossBy[level][cause]` counters (a report: nothing
in the game reads them). **Read them with `node tools/read-minesweeper.mjs`.**

## The play screen (rebuilt 2026-10-15)

Matt: *"I do not like how the back arrow is on the bottom left. and I don't love where the ? how to
play button is"*, and *"make the flag and dig buttons larger... i was moving too fast and missed the
flag button then died."* Top to bottom:

- **Title row**: Hub (the hub's), the wordmark, **?** (How to play; its X returns to the BOARD,
  not the menu, `_helpFrom`).
- **HUD**: a **level button** (shape + "Hard", `data-act="tomenu"`) that replaced the back arrow:
  it shows which level you are on AND is the way to change it; then mines left, the face, the clock.
- **Board.**
- **Dig / Flag**, the full width and 72px tall (64px 2026-10-15; was ~105 x 40 between the back
  arrow and ?). **It switches on the TOUCH (`pointerdown`), not on click, and the whole strip below
  the board is its hit zone** (2026-10-16, Matt: *"Somehow I still miss them"*): a click is dropped
  when a fast thumb slides before lifting, and the gap between board and bar was dead. Left of the
  split = Dig, right = Flag; nothing within 16px of the board's last row counts; it only ever
  changes mode, never digs. Click stays for the keyboard.

**One paused board per level (2026-10-15, Matt: "keep a paused board for each level").** A level
with a paused board shows a pause mark and its clock in place of its size on the setup screen;
selecting it gives New game (left, replaces THAT level's board only) and Resume (right). A level
with none gives Play. (Earlier the same day there was one slot and a New game | Resume-other split.)

**The setup cards are centred between the title row and Play** (`.ms-setup > .ms-top { margin-bottom: auto }` plus Play's own `margin-top: auto`), so going immersive did not slide them up (2026-10-15).

**Setup's second button is Leaderboard, not My stats (2026-10-15, Matt: "It should be a
leaderboard button instead and show you everyone who's played").** It and the win popup's button
call `openLeaderboard({ game: 'minesweeper' })`, which opens straight on this game's board; its
back chevron returns to the game. The player's own record is still at profile -> My Stats and
Leaderboards -> their row (rule 1).

## Getting out of a game

**The level button does not confirm, and it should not.** `_backToMenu()` stops the clock, writes the save (which
banks the elapsed time with it) and renders the menu, where the button now reads **Resume**. The
board comes back exactly as it was. That is the same property `isInProgress()` returns `false` for:
leaving this game costs nothing, so a confirm would be asking about a risk that does not exist.

**The face button asks first on a started board (2026-10-11).** It is the classic "new game"
face, and it used to throw a board away with no question; Matt lost a good Medium round to it.
`_askNewGame()` now shows "Start a new board?" (Keep playing / New board) with the clock paused,
but ONLY when the board has been started and is not finished. An untouched or finished board
still restarts at once, since there is nothing to lose.

## The explosion

Matt, 2026-09-21: *"add a huge explosion animation for if someone hits a mine"*.

A white-hot core, two shockwave rings, 26 fragments thrown on their own vectors with their own
spin, a 420ms board shake, and the remaining mines revealing OUTWARD from the cell that was hit,
a ring at a time. About 1.15s before the result screen arrives.

- **Everything animates `transform`, `opacity` or `filter` only** (Part 0). Nothing touches
  `width`/`height`/`inset`, which are not compositor-only and jank on a weak phone.
- **One keyframe drives all 26 fragments.** Each carries its vector, spin, size, colour and
  duration as custom properties set in `_explode()`, so nothing generates a keyframe per particle.
- **The layer is built at the moment of the hit and REMOVED when it finishes**, not left at
  `opacity: 0`. It is `aria-hidden` and says nothing the revealed board does not already say, so
  there is nothing lingering in the accessibility tree.
- **The result is RECORDED before a single pixel moves.** `_finish()` calls `recordMinesweeper`
  synchronously and only then stages the animation, so leaving mid-explosion cannot cost a player
  their play (the same reasoning as `js/CLAUDE.md`'s "record at the moment of DECISION").
- **Every timer is tracked in `this._timers`** and cleared by `destroy()`, `newGame()`,
  `renderMenu()` and `renderHowTo()`. A blast timer firing into a torn-down screen would paint
  into nothing, and the hub reuses the same container for the next game.
- **Reduced motion cuts it entirely rather than slowing it**: this is garnish, not gameplay (the
  board already says you lost, in text and in shape), so `_reducedMotion()` skips building the
  layer, reveals every mine in one pass, and the result screen arrives promptly. Measured: 53ms
  instead of ~1.6s, no layer, no fragments, all mines shown. Nothing structural is `display:
  none`d; the elements that remain settle at their final pose.

**`tools/test-visual.mjs`'s `MOTION` probe is what keeps it honest.** It samples a fragment's real
on-screen position frame by frame and fails if the debris is too brief to follow or barely travels
(measured: 113px over 1135ms, 70 frames). Verified born red by making `_explode` a no-op. A static
check cannot see any of this - the board screenshots identically a second later, which is exactly
the failure the probe system exists for.

## Wrong flags after a loss (2026-10-14)

Matt: *"If you hit a mine and die, is it obvious if you mis-marked any squares?"* It was not: a
wrong flag was a small struck-through pennant, the same colour as every other hidden square, and
the Boom popup dimmed it. Mockup (dark): https://claude.ai/artifact/SbNC6XWSy8b2JrjqUcDbJb. Matt:
*"I think it should glow/pulse"* (most players use dark mode).

- **`.is-wrong` on the cell** (`_paintCell`, only when `g.dead` and the flag is on a safe cell):
  a `#ffce3a` border and tinted fill, the glyph's X in `--ms-wrong-x`, and a `::after` glow whose
  box-shadow is FIXED and only its `opacity` pulses (1.1s, infinite; Part 0). Reduced motion keeps
  the glow, steady, because it is information, not garnish.
- **It shows THROUGH the popup's dim.** The dim is `.ms-ov::before` (z 10), a wrong cell is z 11,
  the card is z 12. **`.ms-ov` must have NO z-index**: one would make it a stacking context and no
  cell could sit between its dim and its card. The board's shake (`is-blasting`) is a transform,
  which also makes a stacking context; this only works because ui.js removes that class after the
  shake, so never leave it on. Squares directly under the card stay hidden.
- **The popup's fourth tile, "Flags wrong"** (`E.wrongFlags()`), on every loss, zero included.
  Display only: nothing new is recorded.
- Colour is never alone: the X shape carries it (Matt is red/green colorblind), and yellow keeps it
  apart from the vermilion boom square and the right flags.

## Stats

`recordMinesweeper(level, won, extras)` in `js/game-stats.js`. Sub-counter `ms`:

```
ms = { cleared, flagsRight, bestTimeMs: { easy, medium, hard, expert },
       bestClearedPct: { easy, medium, hard, expert },
       lossBy: { <level>: { slip, misread, rushed, forced, chord, unknown } },   // 2026-10-15
       practice: { <level>: { played, won } },        // no-guess test rounds, uncounted (to 2026-10-16)
       noGuess:  { <level>: { played, won } } }       // counted no-guess plays (2026-10-16)
```

- **`bestClearedPct` (2026-10-15)**: the closest a player got on each level, as % of the board
  (a win is 100). Higher-is-better, `Math.max` in the writer and in `players-agg.js`; 0 = none yet.
  Nothing before that date exists (the lose screen's % used to be dropped). Shown where a level
  has no best time: the setup screen's "Your best" cells and My Stats' "Best" column.

- **`bestTimeMs` is LOWER-is-better and improves with `Math.min`.** That is not an exception to
  rule 2, it is what improving means for a time; golf's `bestRoundByCourse` is the existing
  precedent in that file. `0` is the "never set" sentinel and never wins a comparison, in the
  writer and in the `players-agg.js` merge alike.
- **Losses are not stored as their own counter.** `total.played - total.won` already is the loss
  count, and a second copy of a number is a second thing that can disagree with the first.
- **A LOSS STILL WRITES**: the play, the tier bucket, and the correct flags. It leaves `bestTimeMs`
  alone (there is no time for a board you did not finish). Dropping losing plays would make the
  win rate a lie and lose real history.
- **`cleared` in `extras` is a PERCENTAGE of one board and is never accumulated.** A lifetime sum
  of percentages is not a number that means anything (rule 4). It is shown on the lose screen and
  nowhere else.
- The three-edit rule (checklist item 7) is done: `game-stats.js`, a `game-stats-ui.js` renderer
  (`minesweeperScreen`), and an explicit `players-agg.js` branch.

**It is in `players-agg.js`'s `SOLO` set**, following Sudoku. A cleared board is a RUN, not a win
over a person, so it does not inflate the cross-game wins number (docs/archive/HANDOFF-LB-SOLO-RUNS.md, still in
force). It is the first SOLO game with a real loss axis, which is why its My Stats screen shows a
win/loss record where Sudoku's shows none.

**THE BOARD RANKS ON THE FASTEST TIME AT THE HIGHEST DIFFICULTY CLEARED** (Matt, 2026-09-21:
*"it only shows how many fields I've completed... shouldn't that be displayed? the fastest time to
clear the highest level of difficulty"*).

This game shipped following Sudoku's precedent, which leaves best times off the board entirely
because a `TEXTURE` chip ranks higher-is-better and a time does not. That was the wrong call here
and Matt caught it: a time is the entire point of Minesweeper, and the game shows you one the
moment you clear a board. It now rides the repo's existing DIFFICULTY-OUTRANKS-SCORE machinery
(`js/CLAUDE.md`, 2026-09-08) rather than a new mechanism:

- `msBestAt(g, tier)` in `js/leaderboard-ui.js` is the metric: `ms.bestTimeMs` at that level.
- `'minesweeper'` is in `LOWER_IS_BETTER`, and a new `TIME_METRIC` set makes `formatBoardMetric`
  print `5:00` instead of `300000`. `TIME_METRIC` is separate from `LOWER_IS_BETTER` on purpose:
  golf's to-par is also lower-is-better and is emphatically not a time.
- `lbUnitKeyOf` gives the BOARD its own label ("best time") while My Stats' game list still leads
  with boards cleared - the same split golf already had, for the same reason.
- `boardRankTier` does the ranking: a row sits at the highest level it has BOTH played at AND
  cleared, so a 5-minute Expert clear beats an 8-second Easy one, and somebody who grinds Expert
  without ever clearing it ranks at the level they did clear.

**Every screen FLOORS a time to the second** (2026-10-16, Matt: *"Why is my time different?"*: a
24.6s clear read 0:24 on the result card and 0:25 on the board, which rounded). The game clock,
result card, setup screen, My Stats and `formatTimeMetric` (leaderboard) all floor; a probe in
`tools/test-leaderboard-rank.mjs` pins it. Stored times are untouched.

**`msBestAt` MUST RETURN NULL FOR THE 0 SENTINEL, NEVER 0.** `bestTimeMs` stores 0 for "never
cleared this level", and `hasBoardMetric` treats a lower-is-better value as present whenever it has
one (golf's to-par is legitimately 0). A raw 0 would read as an instant clear and top the board for
ever. `tools/test-leaderboard-rank.mjs` carries this as a `[KNOWN-BUG PROBE]` plus the behavioural cases
around it.

**The per-level tiles print times too (2026-10-11).** The tiles under each row went through
`gameMetricAt` raw, so they read `248338` beside a headline of `4:08`. They now pass through
`formatBoardMetric`, the same as the headline (`js/leaderboard-ui.js`, the board card's tiles).

Boards cleared and correct flags stay as the Standing-records chips, which is what they always
should have been: texture, not the headline.

## Storage

| Key | What |
|---|---|
| `gamehub.minesweeper.v1` | settings: level, longPress, vibrate, marks (2026-10-15); `safeFirst` is still read and carried but has no switch: it never did anything (the first tap is always an opening), so the switch was removed 2026-10-15 |
| `gamehub.minesweeper.saves.v1` | (2026-10-15) one paused board per level `{easy?, medium?, hard?, expert?}`, each the old save's shape (board, banked clock, mode) |
| `gamehub.minesweeper.save.v1` | the first build's single slot. Read ONCE: when `saves.v1` is missing its board is carried in at its own level; never written or deleted after that (rule 5) |

Both readers try/catch and treat anything malformed as absent: a corrupt save reads as "no save",
never as a crash. `deserialize()` rejects a save whose dimensions disagree with its level — this
engine never produces another shape, so a mismatch is corruption, not an alternate format.

**The clock is banked, not counted.** `_startTimer` accumulates wall-clock deltas on a 250ms
interval, so a throttled background tab cannot inflate or deflate a time; `_stopTimer` banks the
part-second before stopping, or every pause would shave up to 250ms. It stops on `visibilitychange`
and on `destroy()`, and the elapsed value rides the save, so leaving and coming back resumes where
it was rather than restarting at zero. A best time earned with the phone in a pocket is not a best
time.

## Colour

The digit is the shape, so hue is redundant and nothing depends on telling two colours apart. The
classic 2-green / 3-red pair is teal and vermilion here, this repo's own colorblind-safe pair. Flag
is a pennant, mine is a spiked disc, a wrong flag is the pennant struck through: all three read with
no colour at all.

**Its leaderboard board is its own (2026-10-15):** tabs All / Easy / Med / Hard / Expert, best time
or best % per person. `js/CLAUDE.md`, "Minesweeper's own board, and no \"YOU\"".

## Quitting and easier settings (2026-10-29)

A started board thrown away (the face's New board, or New game over a level's paused board) is ONE loss at that level (it protected a win rate); the question says "Counts as a loss." Pausing a board (level button, the hub) is not quitting. Spec: `docs/INTEGRITY-CHECKS-SPEC.md`, "Holes closed 2026-10-29: quitting and easier settings"; `node tools/test-quit-loss.mjs`.
