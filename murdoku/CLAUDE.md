# Murdoku — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below overrides
> them. This game's answer to THE LAW is short: it writes exactly one stats result per solved case
> through `recordResult`, and its own two keys hold only a difficulty choice and an in-progress case.

A murder-mystery logic puzzle. An N x N floor plan is split into rooms by walls; N people, one of
them the victim (Victor, skull face). Place everyone so there is exactly ONE person per row and ONE
per column, nobody on a blocking object (plant, bookshelf, piano, TV; a chair or a rug CAN be stood
on) and every clue is true. The murderer is the one person alone in a room with the victim. Every
case has exactly one answer and never needs a guess. Solo, no opponent. Built 2026-09-29.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../murdoku/js/ui.js'`, hub id `murdoku`, **`devOnly`, no `released` date** (Matt releases it from the admin page; the date is the launcher's New pill input) |
| Immersive | **No.** A grid puzzle under the standard hub header, the Sudoku class. See "Space" below for what that costs |
| Stats id | `murdoku` (`recordResult('murdoku', tier, true)`, no sub-counter) |
| CSS root / prefix | `.mu-root` / `.mu-`, custom properties `--mu-*`, every rule descendant-scoped |
| Settings key | `gamehub.murdoku.v1` (`{ tier }`, written on SELECTION) |
| Save key | `gamehub.murdoku.save.v1` |
| Difficulty axis | Easy 5x5 / Medium 6x6 / Hard 7x7 / Expert 8x8, straight onto the shared 1-4 scale |
| `isInProgress()` | **`false`**, see below |

`isInProgress()` returns `false` because the case is written to storage after **every change** (a
placement, a lift, a mark), so leaving is lossless: the Sudoku / Nuts & Bolts class, not the Ball
Run class (`docs/BUILDING-A-GAME.md`, "The module contract").

## Files

| File | Role |
|---|---|
| `js/engine.js` | the whole puzzle: layout, clues, search solver, human-style solver, generator, `checkBoard`. Pure, no DOM |
| `js/test.js` | headless tests (`node murdoku/js/test.js`) |
| `js/ui.js` | DOM, input, timer, autosave, the fit-by-measurement layout, the module contract |
| `js/strings.js` | the EN/ES dictionary, every visible string and aria-label |
| `css/murdoku.css` | all styling, light and `.gh-dark` |
| `index.html` | the standalone page (name gate before `init`) |

## Where the rules came from

Murdoku is a genre of murder-mystery placement puzzles. This is our own version, written from the
rule description in `js/engine.js`'s header; every case is generated on the device from a seed and
proved unique before it is shown, so no published puzzle or artwork is copied.

## The screens

- **Setup**: difficulty (shape marker + size), New case, Continue case (with tier and elapsed time,
  only while an unfinished save exists), How to play. Opening the game with an unfinished save
  resumes straight onto the board; a finished case is never resumed.
- **Play**: header (menu, `Case #<seed % 10000>`, tier marker, timer, how to play, new case), the
  floor plan, a Place / ✕ Mark tool toggle, and the suspect list. Tap a suspect (gold ring + ▶ +
  bold clues), then a square. Tap a placed token to lift it off (and select that person, so the
  next tap moves them). In Mark mode a tap on an empty square toggles a ✕.
- **How to play**: an overlay. Every line is measured against the container and shrunk (floor 11px,
  one shared size per group) then locked `nowrap`; the diagram is a 3x3 plan with a wall, drawn in
  shapes, outlines and arrows.
- **Result panel**: "Case closed!", the murderer, the room, the time, a close X in the top-right.

### The floor plan reads by its WALLS, not its colours

Matt is red/green colourblind. Rooms are separated by thick dark walls drawn as one SVG over the
grid (non-scaling 3px stroke, one path of the segments between differently-roomed neighbours); the
pastel tint per room is only a second cue. A room's icon sits in one corner cell. A blocked square
is diagonally hatched AND carries its furniture emoji; a rug is a patterned inset (no emoji, and it
CAN be stood on). Rows and columns already holding a placed person are dimmed. A clash (two in a
row or column) or someone on a blocker gets a dashed outline plus a warning triangle on the token.
When the board is full and wrong, every broken clue shows a warning triangle and a wavy underline.
The board only ever says "not quite, N clues don't fit": it never says which placement is wrong.

### Space (the hard part of this game)

Expert is 8x8 plus eight suspect rows on a phone with no scrolling, and mounted in the hub the
standard header (about 131px in the test browser) takes a fifth of the screen. `_fit()` in
`js/ui.js` therefore chooses among three arrangements by MEASUREMENT, preferring the most readable
one that gives the board a comfortable size (`min(width, N * 40)`): the list font 12.5px down to the
11px floor; the list as two columns of run-in cards instead of one row per suspect; the tool
buttons in a column beside the board instead of a row under it. If none reaches the comfortable
size the largest board wins. Landscape / wide (`width / height >= 1.3`) puts tools and list beside
the board.

**Tap-target exception, documented and measured** (`docs/BUILDING-A-GAME.md` Part 0, the dots-boxes
precedent): 64 squares, eight suspect rows and a header cannot all be 44px on a 667px screen with no
scrolling. Smallest board square over 8 random cases per tier and language, worst case with the
board full and clue warnings showing (Expert / Hard):

| Screen | Expert | Hard |
|---|---|---|
| standalone 375x667 | 39px | 42-44px |
| standalone 375x600 | 34px | 39px |
| standalone 390x844 | 46px | 52px |
| hub 375x667 | 25px | 30-35px |
| hub 375x600 | 22-25px | 28-30px |
| hub 390x664 | 28px | 32px |
| hub 390x844 | 39-42px | 46-48px |

Easy and Medium are 35px and up everywhere. The header buttons, tool buttons, overlay buttons and
the suspect rows' width are all 44px+; only the suspect rows' HEIGHT (19-40px) and the Expert / Hard
squares in the hub are under. Below 375px wide it stops fitting: at a hub 320x568 Spanish Expert
overflows the screen by up to 20px (the board hits its floor of `N * 12`), which is outside the
supported range. The way to give Expert real room in the hub is `immersive: true` in `js/hub.js` (the
header collapses to a floating back button and frees roughly 90px), which is a registry decision,
not a game one.

## Persistence

`gamehub.murdoku.save.v1` = `{ v, puzzle, pos[], marks[], elapsedMs, solved, recorded }`, written
after EVERY change. The whole puzzle is stored (not just a seed) so a later generator change can
never invalidate a saved case. `readSave()` returns `null` for anything structurally wrong
(`validPuzzle` plus range checks) and the game starts fresh rather than crashing.

**The solve is recorded exactly once per case**, guarded by the save's `recorded` flag, which is only
set after `recordResult` returned; a failure is logged loudly and left unflagged (THE LAW rule 6). If
the tab dies between the win and the write, the next load records it. Starting a New case overwrites
the save (an in-progress case is not player history; a recorded solve lives in `gamehub.stats`).

The timer pauses when the page is hidden, while How to play is open, and on `destroy()`.

## Test seam

`window.__muTest = { puzzle, pos, ui, place(p, cell), solve() }`: `place` and `solve` go through the
real placement path (so `solve()` triggers the win and the recording), used by `check-no-scroll.mjs`
and by probes. `place(p, -1)` lifts.

## Tests

- `node murdoku/js/test.js` (engine)
- `node test-game-conventions.mjs`, `node test-i18n-strings.mjs`
- `node check-no-scroll.mjs murdoku` (needs `node server.mjs`): setup, how to play, an Easy board,
  an Expert board full of warnings, a how-to inside a case and the result panel, standalone and
  mounted, both phone heights. `devOnly` does not matter to it: it adds the registry entry to the
  hub's game list itself before mounting.
