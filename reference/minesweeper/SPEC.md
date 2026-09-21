# Minesweeper — SPEC

Mockup: `reference/minesweeper/mockup.html` (open it; it renders all 8 screens at 393x852 and
measures its own fit). Status: **design only, nothing built.**

## Board ladder

Cell size is derived, never hardcoded: `cell = min(floor((369 - (w-1)*2) / w), floor((554 - (h-1)*2) / h))`
where 369 is 393 minus the screen's 12px padding each side, and 554 is the vertical budget below.

| Tier | Difficulty id | Grid (w x h) | Cells | Mines | Density | Cell px | Board px |
|---|---|---|---|---|---|---|---|
| 1 | `easy`   | 8 x 10  | 80  | 10 | 12.5% | 44 | 366 x 458 |
| 2 | `medium` | 10 x 13 | 130 | 20 | 15.4% | 35 | 368 x 479 |
| 3 | `hard`   | 12 x 16 | 192 | 38 | 19.8% | 28 | 358 x 478 |
| 4 | `expert` | 14 x 18 | 252 | 55 | 21.8% | 24 | 362 x 466 |

Densities track the classic ladder (12.3 / 15.6 / 20.6%). The grids do not: classic Expert is
30 x 16, which cannot be drawn on a phone at a size anyone can tap.

## Vertical budget, mounted in the hub at 852px

| Band | px |
|---|---|
| Hub chrome, top | 98 |
| Screen padding | 24 |
| Header (mines / face / clock) | 52 |
| Gaps | 20 |
| Bottom bar (Dig / Flag / help) + safe area | 64 |
| Hub chrome, bottom | 40 |
| **Left for the board** | **554** |
| Tallest board above (Hard) | 478 |

Measured, not claimed: the mockup's own fit check reports content px against band px for all 8
screens and outlines any frame that overflows in red. All 8 currently read 714 / 714, fits. The
check was verified by breaking it on purpose (a 120px block added under Play made it report
`+120 OVERFLOW`), per VISUAL-PROCESS.md 3b.

## The 44px tap floor, and the documented exception

Easy is exactly 44px. Medium (35), Hard (28) and Expert (24) are below it. This is a real
departure from Part 0's floor and it needs the dots-boxes treatment, not a silent smaller number:

- **The loupe.** While a finger is down, a bubble above the thumb shows the square actually
  targeted, and the tap commits **on release**, not on touch. Sliding retargets. So the tap
  target is effectively the whole board and the precision requirement moves to a readout the
  thumb is not covering. This is screen 5 of the mockup.
- **Verification owed before it ships**: the dots-boxes proof, ported — `elementFromPoint` at
  every cell centre on all four ladders, zero mismatches.

Without the loupe, Expert is not shippable at 24px. The two go together.

## Number palette

The digit carries the meaning; hue is redundant, so no number depends on telling red from green.

| n | Light | Dark |
|---|---|---|
| 1 | `#1F5FA8` | `#6FA8E8` |
| 2 | `#178A7A` | `#3FBFA8` |
| 3 | `#E0532F` | `#FF8A63` |
| 4 | `#6B4FBB` | `#A98BF0` |
| 5 | `#A8720A` | `#E0A93A` |
| 6 | `#0E7490` | `#46B5CE` |
| 7 | `#16243A` | `#E6EDF7` |
| 8 | `#5B6B82` | `#9FB0C6` |

2 and 3 are the classic green/red pair. They are teal and vermilion here, which is this repo's
own colorblind-safe pair. Flag is a pennant shape, mine is a spiked disc, a wrong flag is the
pennant struck through: all three are distinguishable with no colour at all.

## Input model

| Action | Result |
|---|---|
| Tap in Dig mode | Opens the square. Commits on lift, not on touch. |
| Tap in Flag mode | Places or removes a flag. |
| Long press, either mode | Flags. Optional, on by default. |
| Tap a satisfied number | Chord: opens every remaining square around it. |
| Drag before lifting | Retargets. The loupe shows which square is live. |
| First tap of a game | Never a mine. Board is generated after it lands, around a zero. |

Chording and the loupe are the two genuinely non-obvious mechanics, so they are the only two
things the how-to-play screen explains (Part 2's rule: do not re-explain a game everyone grew
up with).

## Values to wire up

| Thing | Value |
|---|---|
| Hub id / stats id | `minesweeper` |
| CSS root / prefix | `.ms-root` / `.ms-` (grep-verified free) |
| Settings key | `gamehub.minesweeper.v1` |
| Save key | `gamehub.minesweeper.save.v1` |
| Recorder | `recordMinesweeper(difficulty, won, extras)` |
| Sub-counter | `ms { cleared, flagsRight, bestTimeByDiff }` |
| Difficulty ids | `easy` / `medium` / `hard` / `expert` — already map to tiers 1-4 in `js/difficulty-tiers.js`, no new vocabulary |
| `isInProgress()` | `false` — autosaves, clock pauses on unmount |
| `immersive` | no, keeps the hub header (the budget above assumes it) |
| Leaderboard metric | best time, lower is better |

Sub-counter work is the three-edit rule (checklist item 7): `game-stats.js`, a `game-stats-ui.js`
renderer, and a `players-agg.js` branch. `bestTimeByDiff` combines with **`Math.min`**, not
`Math.max` — a lower time is the better one. Golf's `bestRoundByCourse` is the existing precedent
for a best that improves downward, so this is not a new shape.

## Open questions for Matt

1. **Expert at 24px cells.** Shippable with the loupe, not without. Say if you would rather cap
   the ladder at Hard.
2. **Leaderboard formatting.** A time metric joins `LOWER_IS_BETTER` in `js/leaderboard-rank.js`
   cleanly, but `formatBoardMetric` currently prints lower-is-better values in golf's to-par
   format (`+3`, `E`). A time needs its own branch there — small, but it is a shared file.
3. **The clock across a leave.** Assumed: it pauses on unmount and resumes, so a best time stays
   honest. The alternative (leaving voids the run) is stricter and simpler.

## What this spec does NOT cover

No engine, no solver, no guarantee of a no-guess board. A classic Minesweeper position can
require a coin flip; generating only logically-solvable boards is a separate and much larger
job, and nothing above assumes it.
