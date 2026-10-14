# Gridlock — gridlock/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

The sliding-block "traffic jam" puzzle (Matt, 2026-10-14). Matt asked for the best and most fun
version of the genre (Unblock Me by Kiragames, Rush Hour by ThinkFun, Parking Panic, Move the
Block, Klotski and the rest); the plan picked **Unblock Me** as the model (smooth drag, the fewest
moves to beat, undo, restart, hints) plus three ideas from the others: 3 stars per level (Parking
Panic), a crown for no hints (Move the Block), and fixed walls in the hardest levels (Unblock Me's
Fixed Block mode). Mockups were approved before the build; Matt then asked for the look to be **a
choice** (*"Can it be an option? Find a name for both. And let people choose what theme they
want"*) and approved the name: *"Gridlock is good"*. Spanish title: **Atasco**.

## Hub integration

- In-hub `module: '../gridlock/js/ui.js'`, **immersive**. Hub id and stats id are both `gridlock`.
  Prefix `.gl-root` / `.gl-`.
- **Admin only** (`devOnly: true`, an `added` date for the Newest sort, no `released` date: that is
  the New pill's input and must be the day Matt releases it from the admin page). Its `GAME_META`
  row shipped with the game, so the board appears the moment it is released.
- **KEEP IT ADMIN ONLY until Matt says otherwise** (Matt, 2026-10-14: *"make sure it's admin only
  until I've had time to fully test it"*). He releases it himself from the admin page (Games ->
  Gridlock), which overrides the code default with no commit. `test-gridlock.mjs` fails if the
  `GAMES` entry loses `devOnly: true` or gains a `released` date; change those checks only on his word.
- `isInProgress()` is always `false`: every move autosaves, so leaving is lossless.
- Immersive layout is Arrow Maze's `_positionRoot()` (a fixed root measured against the mount
  point; in the hub it runs edge to edge and the top bar starts right of the floating back button).

## Files

| File | Role |
|---|---|
| `js/engine.js` | the whole puzzle, pure: board notation, legal slides (`range`, `moves`), the solver (`solve`, breadth-first, one slide = one move). Used by the game, the level maker and the tests |
| `js/levels.js` | **GENERATED** by `build-gridlock-levels.mjs` (repo root). One line per ladder level: board + fewest moves. **APPEND-ONLY once shipped**, never hand-edited |
| `js/ui.js` | setup and play screens, the board (DOM blocks moved by `transform`), dragging, undo / restart / hint, the win popup, autosave, the module contract, the `window.__glTest` seam |
| `js/strings.js` | EN/ES, every visible string and aria-label |
| `js/test.js` | headless checks: `node gridlock/js/test.js` (not precached) |
| `css/gridlock.css` | all styling, both looks |
| `index.html` | the standalone page (name gate before `init`) |
| `../js/gridlock-points.js` | bands, stars, points, the per-level merge; shared with the stats store, the merge, My Stats and the leaderboard |

## The rules

- 6 x 6 board. Blocks are 2 or 3 cells long and slide only along their own length; they never turn.
  The red block lies on the third row and leaves through the **exit on the right edge** of that row.
- **A move is one block slid any distance in one go** (how Unblock Me and Fogleman count). The
  "Moves" chip is the length of the player's current path: Undo takes one back.
- Stars against the level's **fewest moves** (`glStars`): the fewest = 3, within a quarter of it
  (never less than 2 moves of slack) = 2, any solve = 1. A solve with no hint wears the **crown**.
- **Hint**: the game's own solver finds the best next move from where the player is; the block
  glows and a dashed ghost shows where it goes. It costs the crown for that level (the attempt's
  hint count is saved with the attempt, so leaving and coming back does not clear it). Tapping Hint
  again on the same position does not count twice.
- Restart puts every block back (moves 0); the hint count stays.
- **Levels** (the setup screen, beside How to play): the selected difficulty's levels, 25 a page
  (5 x 5, pager underneath, never a scroll). A cleared level shows its best stars and its crown and
  can be replayed for more stars; the next level wears the `#ffce3a` outline; later ones are locked,
  because a difficulty is played in order. Replaying never adds points (they count distinct levels).
- Expert levels (151 on) may contain fixed **walls** (metal plates on wood, a striped barrier in the
  car park).

## The two looks (Matt, 2026-10-14)

**Wood** (default: Unblock Me is the best-known version) and **Cars** (Rush Hour's parking lot).
Same levels, stars and points; the choice is `look` in the settings key, per phone, picked on the
setup screen (two thumbnails, the selected one wears the `#ffce3a` outline and a check mark, never
colour alone). The wood play screen follows the hub's light/dark theme; the car park is dark in
both. **The red piece carries a shape** (a white arrow badge on the wooden block, a white star on
the red car), because Matt is red/green colourblind.

## The ladder, stars and points

Arrow Maze's ladder (way-out/CLAUDE.md, "The ladder and points"), on purpose, so the family meets
one system: levels 1, 2, 3...; **Easy 1-50, Medium 51-100, Hard 101-150, Expert 151 to the last
level shipped**. Pick any difficulty; each remembers its own next level (`next[band]`), which only
goes up and is never behind the highest level the stats store says was cleared in that band.

**Points = the sum of `glLevelPoints(n)` over every DISTINCT level cleared** (1 for levels 1-25, one
more every 25 levels, up to 8). Read from the per-level map, **not** from `byDiff` counts like Arrow
Maze: here a level can be replayed (Play again, to earn more stars), and a replay must not add points,
nor may a second phone double them. The leaderboard ranks on points, one number across the four
difficulties (not hardest-difficulty-first), exactly as Arrow Maze's board does; a difficulty filter
shows that difficulty's points. Standing records: levels cleared, three-star levels.

## Persistence and stats

- Settings `gamehub.gridlock.v1`: `{ look: 'wood'|'cars', band, next: { easy, medium, hard, expert } }`.
  Saved on selection.
- Progress `gamehub.gridlock.save.v1`: `{ <band>: { v: 1, n, hist: [[piece, from, to], ...], hints } | null }`,
  one attempt per difficulty, written after every move. **It is replayed move by move on load and
  trusted only if every move is legal on that level's board**; anything else starts the level fresh.
  A save whose last move already solved the level (the app closed during the slide out) is counted
  as the win on reopening, not shown as a finished board.
- Stats: **`recordGridlock(band, { level, moves, stars, hints })`**, once per solve (replays too).
  One play and one win in total and in the band, plus the **`gl` sub-counter**:
  `gl.lv['L<n>'] = { m, s, c }` (fewest moves solved in, best stars, 1 once solved with no hint) and
  `gl.hints`. Every field only improves (`glBest`). **Keys are `L<n>`, never bare numbers**:
  Firebase turns an object with mostly numeric keys into an ARRAY. The three-edit rule is done:
  `js/game-stats.js` (`ensureGl`, `recordGridlock`), My Stats (`gridlockScreen`), `js/players-agg.js`
  (per level the best of each field; a level on two phones counts once; hints add). `gridlock` is
  in the SOLO set.
- The recorder runs FIRST in `_win()`, before the slide-out animation and the popup, so a solve is
  counted even if the app closes the instant it happens.

## The levels (`build-gridlock-levels.mjs`)

Every level is the **hardest start of its own set of blocks**: the generator lays out blocks, finds
every arrangement they can slide into (the "cluster"), and breadth-first searches out from every
solved arrangement; the farthest one is the level, and its distance is its exact fewest moves
(Michael Fogleman's method, https://michaelfogleman.com/rush; his database was not used because
nothing says it can be reused). So a level never has a shortcut start. Long puzzles are rare, so
most of the search EDITS the deepest layouts found so far (add, remove, swap or shift a block, move a
wall), one process per CPU. Easy to Hard (1-150, no walls) take the unused puzzle nearest a target
that rises smoothly; Expert takes the hardest puzzles found (walls or not), spread evenly through
their sorted depths so it climbs to the longest one and never steps back.

**APPEND-ONLY once shipped.** A player's progress is "levels 1..n", so a changed line would change
what they cleared. `gridlock/js/test.js` re-solves every level (its fewest moves must be exact), and
pins the shipped lines by hash (`PINNED`). To add levels: `node build-gridlock-levels.mjs --append
--count <new total>`, which keeps every existing line; leave the pin alone.

**Measured (the shipped 400, 2026-10-14):** a 15-minute search on 4 CPUs (one without walls, three
with) found ~42,000 distinct puzzles, the longest 51 moves without walls (the known maximum for a
wall-free 6x6, Fogleman) and 47 with walls. Fewest moves by band: Easy 3-14 (average 9.5), Medium
14-22 (18.1), Hard 22-30 (26.1), Expert 30-51 (35.2; 157 of its 250 levels have walls). No level is
easier than the one before it. Early levels prefer few blocks (7 at level 1, rising to ~12 by 150),
and boards with a row or column of blocks that can never move are skipped. The slowest hint (a full
solve from the start of the hardest level) is ~35 ms on a desktop.

**Expert is spread by the square root of supply, not by a target.** Long puzzles are rare (a few
hundred at 30-35 moves, a handful past 42), so each fewest-moves value gets a share of Expert's
levels in proportion to the square root of how many puzzles have it. Plain proportion spent the
first fifty Expert levels on 30-move puzzles (tried and rejected: no climb at all); a fixed target
ran out of long puzzles. With the square root Expert climbs about one move every 20 levels, then
faster at the top, and ends on the 51-move puzzle at level 400.

## Tests

- `node gridlock/js/test.js` (engine, every shipped level, the pin), `node test-gridlock.mjs`
  (points, stars, the recorder, the two-phone merge).
- `node test-visual.mjs gridlock` has a PLAY probe: Play, then a real touch drag of the first block
  of the solution (one move).
- `node check-no-scroll.mjs gridlock`, `node test-game-conventions.mjs`.
- Checked in Chromium (2026-10-14), standalone and in the hub, light and dark, English and Spanish,
  at 402x874, 375x667 and 360x724: setup, play and the win popup all on screen, nothing under the
  hub's back button, no page scroll; a real touch drag moves a block one move.

## The QA pass (2026-10-14)

A scripted pass in Chromium (402x874, hard and medium levels): 150 random real drags (every block's
position on screen matched the game's state after each batch), undo all the way back, hint tapped
five times on one position (counted once), a language change mid-drag, a resize mid-drag (the drag
ends with no move and the next drag works), two fingers at once (at most one move), a reload during
the slide-out (the solve counted once, Play offers the next level), corrupt settings / save / stats
(the level starts fresh, no errors), Escape on the win popup (back to the levels), and keyboard play
(arrow presses on one block are one move). Found and fixed before it: a re-render or a resize in the
middle of a drag now drops the drag, so a lost pointerup can never leave every block frozen.

## Layout notes

- The root is `bottom: 0`, never a height from `visualViewport` (Arrow Maze's iPhone fix of the same
  day), and the setup column centres with auto margins, so a short phone can never push it up under
  the Hub button.
- The board is sized by measurement in `_layout()` (a `ResizeObserver` on the stage plus
  `onViewportResize`): cell = min(width / 7.68, height / 6.68, 76px). On a 402-wide phone a cell is
  50px, at 360 wide 45px; blocks are therefore always well over the 44px tap floor.
- Blocks are DOM elements moved by `transform` only; a drag follows the finger along the block's
  own line, clamped to where it can actually go, and snaps to the nearest cell on release (one move
  if it ended somewhere new). `touch-action: none` on the board, pointer capture on the block.
