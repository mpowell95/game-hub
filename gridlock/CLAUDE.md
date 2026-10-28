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
  Gridlock), which overrides the code default with no commit. `tools/test-gridlock.mjs` fails if the
  `GAMES` entry loses `devOnly: true` or gains a `released` date; change those checks only on his word.
- `isInProgress()` is always `false`: every move autosaves, so leaving is lossless.
- Immersive layout is Arrow Maze's `_positionRoot()` (a fixed root measured against the mount
  point; in the hub it runs edge to edge and the top bar starts right of the floating back button).

## Files

| File | Role |
|---|---|
| `js/engine.js` | the whole puzzle, pure: board notation, legal slides (`range`, `moves`), the solver (`solve`, breadth-first, one slide = one move). Used by the game, the level maker and the tests |
| `js/levels.js` | **GENERATED** by `tools/build-gridlock-levels.mjs` (repo root). One line per ladder level: board + fewest moves. **APPEND-ONLY once shipped**, never hand-edited |
| `js/art.js` | the drawings: wooden blocks (grain, knots, bevel, shine; eight wood tones) and cartoon cars (sedan, sports, hatch, sunroof, taxi) and trucks (box truck, bus, tanker): flat colour, thick outline, one silhouette each. Pure, returns SVG |
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
  (never less than 2 moves of slack) = 2, any solve = 1.
- **Hint**: the game's own solver finds the best next move from where the player is; the block
  glows and a dashed ghost shows where it goes. Tapping Hint again on the same position does not
  count twice.
- **A hint costs that level its crown and HALF its points, for good** (Matt, 2026-10-14, after a
  review of how the leaderboard could be gamed: free unlimited hints let anyone clear every level by
  following them, for full points). The first hint on a level is recorded per LEVEL in the stats
  store (`gl.hint`, synced), not just in the attempt, so leaving the level, switching levels or
  replaying it later cannot clear it (that was the "crown trick"). A level already solved with no
  hint keeps its crown and full points whatever happens after. Across phones it is decided by time:
  a clean solve on one phone AFTER a hint on another still pays half (`glCrowned`). The win popup
  says "Hint used: half points, no crown", or only "Hint used: no crown" on levels 1-500, where half
  of 1 point rounds up to 1 (2026-10-28: the popup used to claim half points there).
- Restart puts every block back (moves 0); the hint count stays.
- **Levels** (the setup screen's grid icon, beside Play): the selected difficulty's levels, 25 a page
  (5 x 5, pager underneath, never a scroll). A cleared level shows its best stars and its crown and
  can be replayed for more stars; the next level wears the `#ffce3a` outline; later ones are locked,
  because a difficulty is played in order. Replaying never adds points (they count distinct levels).
- Hard and Expert levels (2001 on) may contain fixed **walls** (metal plates on wood, a plain
  black block in the car park; the red-and-white stripes went 2026-10-28, Matt did not like them).
- The Levels screen has a pager of 40 pages per difficulty: `‹ ›` one page, `« »` ten.

## The play screen's controls (Matt, 2026-10-14)

The top row holds only the level title, centred (in the hub it shares the floating Hub button's row).
**The way back to the setup screen is a back arrow TOP LEFT on the second row** (left of the Moves /
Fewest chips, 16px under the Hub button, 44px). It first sat on the top row right beside the Hub
button; Matt: *"The back (to the setup screen) is on the same row and basically touching the Hub back
button."* It was then moved to the bottom bar as Menu, which was wrong too; Matt: *"Give me a back
button on the top left again. I don't want it in the normal location. I didn't want you to remove
it."* The bottom bar is Undo · Restart · Hint. The Levels screen's Back is a full-width button under
its pager. The rule is in docs/BUILDING-A-GAME.md, Part 0.

## The setup screen: few words (Matt, 2026-10-14; re-laid out 2026-10-28)

**Arrow Maze's layout (2026-10-28, Matt: "Improve the setup screen")**: the picture (`boardPreviewSVG`:
the selected difficulty's NEXT level's own board in the chosen look, the play screen's own art and
colours via `pieceColors`; tapping it plays) with How to play as the round "?" at its right; title and
points; a card of [the two looks, the four difficulties (shape + name + a thin progress bar through
their 1000 levels, no words), Levels as a grid icon beside **Play level N**]; a footer card of
**🏆 Points leader** (emoji + profile name, ties all named, from `readPeople()` at most once a minute,
this phone's own store counted for itself) and **Leaderboard ›** (`openLeaderboard({ game: 'gridlock' })`;
until release it opens the plain leaderboard, since admin-only games are off it). Short screens shrink the
picture first (`max-height: 760px`). `check-no-scroll` fits all 8 screens.
Still no tagline, no "Look" / "Difficulty" labels (`aria-label`s), no level ranges or current level on
the difficulty buttons, no "worth N points" line. Matt (10-14): *"There are WAY too many words."*

## The two looks (Matt, 2026-10-14)

**Wood** (default: Unblock Me is the best-known version) and **Cars** (Rush Hour's parking lot).
Same levels, stars and points; the choice is `look` in the settings key, per phone, picked on the
setup screen (two thumbnails, the selected one wears the `#ffce3a` outline and a check mark, never
colour alone). The wood play screen follows the hub's light/dark theme; the car park is dark in
both.

**The art was redrawn the same day** (Matt: *"Make the blocks and the cars look cooler. They're
bland"*): `js/art.js` draws every piece as SVG. Wood: a lit top edge and shaded bottom (bevel), a
soft shine, long wavy grain and sometimes a knot, in eight wood tones, inside a grained tray with
recessed holes. Cars: models vary (sedan, sports with stripes, hatchback, sunroof, taxi on yellow
cars; trucks are a box truck, a bus or a tanker); their style is the cartoon one below (2026-10-28).
The variety is seeded by level and piece, so a level always looks the
same. Upright pieces are the same drawing turned a quarter (front up, light from the left). **The red piece carries a shape** (a white arrow badge on the wooden block, a white star on
the red car), because Matt is red/green colourblind.

**Cars redrawn CARTOONY (Matt, 2026-10-28: the cars were "difficult to understand at a glance ... tough
to identify cars as single objects")**: flat bright colours (no dark or grey cars), a thick dark outline
round each whole vehicle, a clear gap to its neighbours, big round headlights, crisp offset shadow; flat
lighter asphalt with faint bay lines. A truck is ONE outlined body (pale load, coloured cab), never two
shapes. Keep it that way: one silhouette per vehicle.

## The ladder, stars and points

**LADDER 2 (2026-10-14, Matt: *"Add more levels. If other games have 18,000+, we should have more
than 400. Especially if half of the expert ones are basically unsolvable by normal people."*):
Easy 1-1000, Medium 1001-2000, Hard 2001-3000, Expert 3001-4000** (Expert can grow at the end).
Shaped like Arrow Maze's ladder (numbered levels, bands, start anywhere), ten times bigger. Each
difficulty's NEXT level is not stored: it is the lowest level of that band not yet cleared (a band is
played in order), and any cleared level stays playable from the Levels screen.
**"Next level" after a REPLAY** (2026-10-14 bug pass) plays the level after it only if that one is
open (cleared, or the band's next); otherwise it plays the band's next level. Before this, replaying a
ladder 1 level that sits far past the next one (say 700 while the next is 5) opened the LOCKED 701,
and replaying the band's last level said "You finished Easy!" while level 5 was still open. The win
popup's third box is points gained, else "New best", else "Your best" (it used to repeat "Fewest").
**Progress does not follow a player to a second phone**: the next level and the Levels screen read
this phone's own store, so a new phone starts at level 1 (points on the leaderboard are merged, so
they are never lost or doubled). Known, not fixed.

**Ladder 1** (the first build: 400 levels in bands of 50, shipped admin only the same morning) is
FROZEN in `gridlock/data/levels-v1.txt`. **Every one of its boards is on ladder 2**, and
`js/gridlock-v1map.js` (generated) says where; `glLevels()` reads a ladder 1 entry (`gl.lv`) as that
board's ladder 2 level, so nothing anyone cleared on ladder 1 is lost or hidden (THE LAW rules 1, 3,
5: the old keys keep their old meaning, the reading is done at display time, nothing is rewritten).
An attempt in progress on ladder 1 (`gamehub.gridlock.save.v1`) is carried once into the new save key
as the same board; the old key is never written again. The settings key's old `next` field is kept
as stored and not read.

**Points = the sum over every DISTINCT level cleared** of `glLevelPoints(n)` (1 for levels 1-500,
one more every 500, up to 8: Easy 1-2, Medium 3-4, Hard 5-6, Expert 7-8), or HALF of it (rounded up)
for a level a hint was used on. Read from the per-level map, **not** from `byDiff` counts like Arrow
Maze: here a level can be replayed (Play again, to earn more stars), and a replay must not add points,
nor may a second phone double them. The leaderboard ranks on points, one number across the four
difficulties (not hardest-difficulty-first), exactly as Arrow Maze's board does; a difficulty filter
shows that difficulty's points. Standing records: levels cleared, three-star levels.

## Persistence and stats

- Settings `gamehub.gridlock.v1`: `{ look: 'wood'|'cars', band }` (+ ladder 1's `next`, kept, unread).
  Saved on selection.
- Progress `gamehub.gridlock.save.v2` (ladder 2 numbers; `.v1` is ladder 1's, read once):
  `{ <band>: { v: 1, n, hist: [[piece, from, to], ...], hints } | null, migrated: 1 }`,
  one attempt per difficulty, written after every move. **It is replayed move by move on load and
  trusted only if every move is legal on that level's board**; anything else starts the level fresh.
  A save whose last move already solved the level (the app closed during the slide out) is counted
  as the win on reopening, not shown as a finished board.
- Stats: **`recordGridlock(band, { level, moves, stars, hints })`**, once per solve (replays too).
  One play and one win in total and in the band, plus the **`gl` sub-counter**:
  `gl.lv2['L<n>'] = { m, s, c, t }` (fewest moves solved in, best stars, `c` 1 once solved with no
  hint ever used on the level, `t` when), `gl.hint['L<n>']` (the first hint's time, written by
  `recordGridlockHint` the moment Hint is tapped), `gl.hints`, and ladder 1's `gl.lv` (frozen). Every
  field only improves (`glBest`; hint times keep the earliest). **Keys are `L<n>`, never bare numbers**:
  Firebase turns an object with mostly numeric keys into an ARRAY. The three-edit rule is done:
  `js/game-stats.js` (`ensureGl`, `recordGridlock`), My Stats (`gridlockScreen`), `js/players-agg.js`
  (per level the best of each field; a level on two phones counts once; hints add). `gridlock` is
  in the SOLO set.
- The recorder runs FIRST in `_win()`, before the slide-out animation and the popup, so a solve is
  counted even if the app closes the instant it happens.

## The levels (`tools/build-gridlock-levels.mjs`)

Every level is the **hardest start of its own set of blocks**: the generator lays out blocks, finds
every arrangement they can slide into (the "cluster"), and breadth-first searches out from every
solved arrangement; the farthest one is the level, and its distance is its exact fewest moves
(Michael Fogleman's method, https://michaelfogleman.com/rush; his database was not used because
nothing says it can be reused). So a level never has a shortcut start. Long puzzles are rare, so
most of the search EDITS the deepest layouts found so far (add, remove, swap or shift a block, move a
wall), one process per CPU. Easy to Hard (1-3000; walls from Hard on) take the unused puzzle nearest
a target that rises smoothly (Easy 3 -> 12 moves, Medium 12 -> 20, Hard 20 -> 28), preferring few
blocks early (5 at level 1 to 13 at 3000) and ladder 1's boards when they are the right length;
Expert takes the longest puzzles (see below) and every ladder 1 board of that length.

**APPEND-ONLY once shipped.** A player's progress is per level number, so a changed line would
change what they cleared. `gridlock/js/test.js` re-solves every level (its fewest moves must be
exact), checks every ladder 1 board is where the map says, and pins the shipped lines by hash
(`PINNED`). Expert can grow by appending; Easy to Hard are full.

**Measured (ladder 2, shipped 2026-10-14):** two searches (15 and 40 minutes on 4 CPUs) found about
100,000 distinct puzzles; the longest 51 moves without walls and 55 with walls. Fewest moves per 250
levels: Easy 3-5, 6-8, 8-10, 10-12; Medium 12-14 ... 18-20; Hard 20-22 ... 26-28; Expert 28-30,
30-33, 33-37, 37-55. **Only the last 165 Expert levels (3836 on) are 40 moves or more** (Matt's
worry: "half of the expert ones are basically unsolvable by normal people" was true of ladder 1,
where Expert reached 40+ by level ~340 of 400). No level is more than 1 move easier than the one
before it, nor more than 2 harder. Walls: Hard 661, Expert 630 of 1000. The slowest hint ~47 ms on a
desktop. `levels.js` is 168 KB.

**Measured (ladder 1, the first 400, kept for the record):** a 15-minute search on 4 CPUs (one without walls, three
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

- `node gridlock/js/test.js` (engine, every shipped level, the pin), `node tools/test-gridlock.mjs`
  (points, stars, the recorder, the two-phone merge).
- `node tools/test-visual.mjs gridlock` has a PLAY probe: Play, then a real touch drag of the first block
  of the solution (one move).
- `node tools/check-no-scroll.mjs gridlock`, `node tools/test-game-conventions.mjs`.
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
