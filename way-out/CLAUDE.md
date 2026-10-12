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
  Expert 24-28 x 32-38. Builds take under 10 ms.

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

**Generator 1 is kept, byte for byte.** A save records `gen`; a level saved before generator 2 (no
`gen`) is rebuilt on generator 1, so its saved "which arrows are gone" still means the same arrows.
`test.js` pins that `buildLevel(t, l, 1)` equals the original `generate()`. Never change `generate()`
without bumping `GEN_LATEST` and keeping the old path, or every level in progress scrambles.

## Input and the tap-target exception

Hard and Expert boards are 20-28 dots across a phone, so a dot is 12-16px apart and a 44px tap
target per arrow is impossible (the reference's are just as small). The board is one canvas and a
tap goes to the **nearest arrow segment** within `max(0.7 x pitch, 22px)`, the documented departure
from the 44px floor (docs/BUILDING-A-GAME.md, the dots-boxes model). Every other control is 44px+.

## Look

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

## Persistence and stats

- Settings `gamehub.wayout.v1`: `{ tier, levels: { easy, medium, hard, expert } }`, the NEXT level
  per tier. Saved on selection; `levels` only ever go up (`Math.max`), capped at 1,000,000 (a
  corrupt value once read "Level 1e+21").
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
- Stats: `recordResult('wayout', tier, true)` once per level cleared. **No sub-counter**, so the
  three-edit rule does not apply. My Stats shares `murdokuScreen` (solved in total and per tier);
  `wayout` is in `js/players-agg.js`'s SOLO set; leaderboard unit "solved".

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

- `node way-out/js/test.js` (engine).
- `node test-visual.mjs way-out` has a PLAY probe: Play, tap a clear arrow (it leaves), tap a
  blocked one (it bounces and a heart goes), through real touch.
- `node check-no-scroll.mjs way-out`, `node test-game-conventions.mjs`.
