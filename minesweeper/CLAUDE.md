# Minesweeper — `minesweeper/`

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file. Nothing below overrides it.

Built 2026-09-21. Design artifacts: `reference/minesweeper/mockup.html` (all eight screens at
393x852, and it measures its own fit) and `reference/minesweeper/SPEC.md` (the durable values).

## Hub integration

- **In-hub `module:`**, `js/hub.js` id `minesweeper`, stats id `minesweeper`.
- **`devOnly: true`** — admin only, Matt's call on the day it shipped. That is a DEFAULT, not a
  lock: the admin control page can release it to everyone with no commit and no deploy. Which is
  exactly why it HAS a `GAME_META` row in `js/leaderboard-ui.js` — a game released that way gets no
  release commit to add one, and a missing row counts every play on it as zero (rule 1, and how
  Yahtzee shipped). `players-agg.test.mjs`'s `OFF_THE_BOARD` stays empty.
- **No `released` date**, deliberately. The "New" pill belongs to the day this goes live for
  everyone, which is a decision made in the app, not here.
- **NOT immersive.** This is a grid puzzle like Sudoku, and the whole cell-size ladder is derived
  from a vertical budget that assumes the hub's ordinary header is present. Making it immersive
  would silently give every board more room than it was measured for.
- **`isInProgress()` returns `false`, even mid-board.** Autosave/resume is built in and the clock
  is banked with it, so leaving is lossless. Root `CLAUDE.md`'s second `isInProgress()` meaning,
  the Sudoku / Nuts & Bolts class, not the Ball Run class.

## Layout

| File | Role |
|---|---|
| `js/engine.js` | pure board logic: generation, flood fill, flags, chording, win detection, serialize/deserialize. No DOM, no storage, no timers, no imports |
| `js/ui.js` | the DOM shell, input, timer, the three screens, the module contract |
| `js/strings.js` | EN/ES, 51 keys |
| `css/minesweeper.css` | `.ms-root` / `.ms-` prefix, every rule descendant-scoped |
| `index.html` | the standalone page, name-gated before `init()` |

Tests: `test-minesweeper-engine.mjs` (86 assertions, headless, no browser).

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
| Tap in Flag mode | places or removes a flag |
| Long press (450ms), either mode | flags. Optional, on by default |
| Tap an already-open number | CHORD: opens every remaining neighbour, if its flags match its count |
| Drag before lifting | retargets; the loupe shows which cell is live |
| First tap of a game | never a mine |

A press that wanders more than 14px cancels the pending long press: that is a drag, not a hold.
Retargeting cancels it too, because the hold belonged to the cell it started on.

**Chording can kill you**, and that is correct — a flag in the wrong place is the player's own
mistake, and the engine test covers exactly that case. Do not "fix" it.

## Generation

The board is generated AFTER the first tap, around it: no mine may be placed in the 3x3 block
centred on that cell. **That also guarantees the first tap is a zero**, because `num` at that cell
counts exactly the eight neighbours the exclusion zone forbids — so the first tap always opens an
area, on every level, measured at 100% over 800 seeded runs. `generate()` still carries a
40-attempt retry loop for the zero; under the current levels it never runs past attempt 0, and its
comment says so rather than leaving a future reader to assume it is load-bearing.

**No-guess boards are explicitly out of scope.** A classic Minesweeper position can require a coin
flip. Generating only logically-solvable boards is a much larger job and nothing here assumes it.

## Stats

`recordMinesweeper(level, won, extras)` in `js/game-stats.js`. Sub-counter `ms`:

```
ms = { cleared, flagsRight, bestTimeMs: { easy, medium, hard, expert } }
```

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
over a person, so it does not inflate the cross-game wins number (HANDOFF-LB-SOLO-RUNS.md, still in
force). It is the first SOLO game with a real loss axis, which is why its My Stats screen shows a
win/loss record where Sudoku's shows none.

**No best-time chip on the leaderboard, deliberately.** A `TEXTURE` `get` ranks higher-is-better
everywhere, and a best time is lower-is-better — the exact reason the Sudoku block one line above
it gives for the same omission. Best times live on My Stats and on this game's own setup screen.
Wiring a time into `js/leaderboard-rank.js`'s `LOWER_IS_BETTER` would also need a format branch
beside golf's to-par `+3`/`E`, which is a shared-file change nobody has asked for.

## Storage

| Key | What |
|---|---|
| `gamehub.minesweeper.v1` | settings: level, safeFirst, longPress, vibrate |
| `gamehub.minesweeper.save.v1` | the in-progress board plus its banked clock and mode |

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
