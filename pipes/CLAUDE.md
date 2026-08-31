# Pipes — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below overrides
> them. This game's answer to THE LAW is short and is stated under "Persistence".

A grid of pipe pieces, every one dropped in at a random rotation. Tap a piece to turn it a quarter
turn clockwise. Join **every pipe on the board** into one leak-free network. Built 2026-08-29 from
`docs/PIPES-SCOPE.md`, which is the scope Matt approved and still the place to read for the options
that were considered and rejected.

Matt's brief: *"a pipes game. where water flows into a pipe, then there's a mess of pipes all
misrotated and whatever and you have to find the path for the water to flow to the exit. similar
puzzle vibe as nuts and bolts."*

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../pipes/js/ui.js'`, hub id `pipes`, `released: '2026-08-29'` |
| Immersive | **No.** It is a grid puzzle with a header, like Nuts & Bolts |
| Stats id | `pipes` (recorder `recordPipes`, sub-counter `pi`) |
| CSS root / prefix | `.pi-root` / `.pi-` |
| Settings key | `gamehub.pipes.v1` (one preference: the tier) |
| Save key | `gamehub.pipes.save.v1` |
| Difficulty axis | four tiers straight onto the shared 1-4 scale (`js/difficulty-tiers.js`) |
| `isInProgress()` | **`false`** — see below |

`isInProgress()` returns `false` because the board autosaves after **every single turn**, so leaving
is lossless and the hub has nothing to warn about. This is the Nuts & Bolts class, not the Ball Run
class (`docs/BUILDING-A-GAME.md`, "The module contract").

## Files

| File | Role |
|---|---|
| `js/generator.js` | board generation, tiers, quality gates. Pure |
| `js/game.js` | the rules: flood, leaks, win, save shape. Pure |
| `js/ui.js` | DOM, input, the water animation, the module contract |
| `js/strings.js` | the EN/ES dictionary |
| `js/test.js` | headless tests, including an independent solver |

The first two are DOM-free and that is load-bearing: `node pipes/js/test.js` generates and solves
hundreds of boards without constructing an element.

## A piece is a 4-bit mask

`N=1, E=2, S=4, W=8`, one bit per open side. That single choice is most of why this engine is small:

- rotating clockwise is `((m << 1) | (m >> 3)) & 15`;
- two neighbours are joined when each has the bit facing the other;
- the piece **kind** (straight, elbow, tee, cross, cap) is *derived* from the mask, so nothing has
  to store it or keep it in sync.

## The win condition: FULL NET (changed 2026-08-31)

Water floods from the inlet through joined openings, and to win:

1. the water must reach **every pipe on the board**, and
2. nothing may leak — no opening pointing at a neighbour that does not open back, and none
   pointing off the edge of the board.

**This replaced "path with no leaks", and the replacement is the most important thing in this
file.** The old rule checked only the pipes the water reached, which meant every cell off that one
path was irrelevant: measured, **52% of a Medium board was pieces the water could never touch**. A
player could finish having ignored most of what was in front of them, and the board was, by
construction, mostly decoration. Matt, shown one of his own solved boards with the entire right-hand
side untouched: *"Explain how this board doesn't have dead ends or 'decoys'."* It could not be
explained. It could only be removed.

`docs/PIPES-SCOPE.md` records Matt picking (b) path-with-no-leaks over (c) full net on 2026-08-29.
**That is superseded.** He chose it from a description; he rejected it after playing it and after
watching the reference, which is full net and is why its boards look purposeful. Do not "restore"
the old rule on the strength of the scope document.

Both halves of the check are needed. Leak-free alone would accept a sealed loop sitting off on its
own; all-reached alone would accept a network spilling off the edge.

**There are no decoys, no filler and no blank cells.** Every piece a player turns is a piece that
matters, so the words "decoy" and "dead end" no longer describe anything in this game. A bulb is an
endpoint OF the network, not an ornament beside it.

## The generator, which is the whole game

**Build the solution first, then destroy it.** A board is never generated randomly and checked
afterwards — "generate and hope" is how a puzzle game ships an unsolvable level to a real player.

1. **Carve a random SPANNING TREE over every cell** (`carveTree`) — a randomised depth-first carve,
   the recursive-backtracker maze. It visits every cell exactly once and opens exactly one edge into
   each newly reached cell, so the result is connected and loop-free. A loop would make a cell's
   "correct" rotation ambiguous; leaving a cell out would make it filler.
2. **The piece kinds fall out of it** rather than being chosen: a leaf has one opening and is a cap
   (a bulb), a pass-through is a straight or an elbow, a fork is a tee, four ways is a cross. There
   is no per-tier piece list any more, and no `decoy` or `minPath` setting — **board size is the
   entire difficulty axis.**
3. **The inlet and the drain are two different LEAVES**, which is what draws as a bulb. They are no
   longer required to be on the board's edge: a leaf can be anywhere, and the reference's own source
   sits in the interior of the level in Matt's recording.
4. Scramble, then apply the quality gates: **no more than 12% of pieces may start already correct**
   (a board that arrives half-solved reads as cheap — "a mess of pipes" was the brief) and the board
   must be **at least 6 turns from solved**.

Gates live in the generator, where a player can never meet a board that failed them.

## Testing

`node pipes/js/test.js` — 45 assertions. The one that matters is **every generated board is
solvable**, over every tier and 40 seeds, and it is checked two ways on purpose:

1. restore each cell to its constructed rotation and assert `isSolved()` accepts it — this proves
   the generator and the win rule agree about what "solved" means;
2. run an **independent solver** over the scrambled board that never sees `board.solution`.

Only (1) would let a generator and a win check be wrong *together* and still pass.

**The independent solver has now been wrong in BOTH directions, and the lesson is the same one.**
Its first draft demanded that every cell agree with every neighbour — which was the FULL NET rule,
and was rejected at the time as "not this game's". It was rewritten to walk a single path. Then it
kept a weaker version of the same over-strictness (every off-path cell had to be rotatable so that
nothing FACED the path) and went red the day the generator started filling every cell. **Then the
rule became full net after all, and the first draft turned out to have been right about the shape
of the problem.**

What survived all of that is the arrangement, not the algorithm: the search PROPOSES a candidate
and the GAME decides, by handing it to the real `isSolved()`. A checker that holds its own opinion
about the rule has to be rewritten every time the rule moves, and will read as a bug in whatever it
is pointed at. One that asks the game does not. It is a full-net constraint search now — assign each
cell a rotation such that every shared edge agrees and nothing points off the board — and it still
never sees `board.solution`.

## Levels, and moving on by itself (2026-08-31)

Matt: *"It should automatically move me to the next board after I complete one. It should be similar
to nuts and bolts - the difficulties with the various boards and stuff."*

**Nuts & Bolts is the model, and it was read before this was written** (`nuts-bolts/js/ui.js`, its
`levels` map and `renderMenu()`), the same rule the setup screen had to learn three times.

- **Each tier carries its own level**, shown on its button in the picker exactly as Nuts & Bolts
  shows "Level N" on each of its four.
- **Solving shows a completion screen and WAITS FOR A TAP.** This reversed once, and the reversal
  is the point. Matt first asked for it to *"automatically move me to the next board"*, that
  shipped, and then he uploaded a screen recording of the reference app completing two levels —
  which does the opposite: **"Puzzle Solved!"** over a full-width **Continue**, with **Replay** and
  **Leaderboard** side by side under it, and it sits there until you tap. Asked which he wanted, he
  chose *"copy the video exactly"*. So there is no auto-advance and no timer to cancel; the panel
  is revealed when the water finishes arriving, in the same beat the banner appears.
  - **Continue** — clear the save, next board, level + 1.
  - **Replay** — the SAME board again. `generate()` is deterministic on `(tier, seed)`, so
    rebuilding from this board's own seed gives back the identical scramble.
  - **Leaderboard** — the hub's overlay, lazily imported exactly as `js/hub.js` does it. This is
    the first game to open it from inside itself; it is `position: fixed`, so it covers a mounted
    game the same way it covers the launcher, and it closes back onto the completion screen.
- **A REPLAYED SOLVE IS NOT RECORDED AGAIN** (`this.replaying`). The board was already credited when
  it was first solved, and counting it twice would inflate the level, which is defined as "boards
  solved at this tier". Nothing is lost by declining the duplicate — this only ever appears on a
  board that has just been recorded.
- **`_fit()` measures the WHOLE FOOTER, not just the banner.** The completion actions live in that
  box, so measuring only the banner would let them overlap the board the moment they appeared, and
  `_fit()` re-runs when they are revealed. Measured: on a 393x852 phone the board does not shrink at
  all on any tier (the buttons use space that was already below it); only Expert on a 664px-tall
  phone gives up cell size, 43px to 32px, and that board is no longer interactive by then, so the
  44px tap floor does not apply to it.
- **The level is DERIVED, never stored.** `recordPipes()` already increments
  `games.pipes.byDiff[<tier>].won` on every solve, so "boards solved at this tier, plus one" IS the
  level. There is no second copy to drift, nothing new that could be lost, and — because the stats
  store syncs to `players/<id>` — **your level follows you to your other phone**, which Nuts &
  Bolts' own local `levels` map does not.
- **Read it with a LOWERCASE tier id.** `js/game-stats.js` runs every tier through `normDiff()`, so
  `'extraHard'` is stored under `'extrahard'`. Reading it back mixed-case silently pins that one
  tier at Level 1 forever, and it is the tier hardest to notice it on.
- **The level number is NOT what goes to `recordPipes()`.** That call still takes the TIER INDEX
  (1-4), because that is what `pi.bestLevel` / `pi.bestByTier` have always meant — "the hardest tier
  cleared" — and both are already read by My Stats and the leaderboard. Passing the board number
  would quietly repurpose a stored field (THE LAW rule 5) and turn every existing player's
  `bestLevel` into a number about something else.
- **The level does not change the board.** The TIER is still the whole difficulty axis (grid size
  and which pieces appear), and the quality gates are tuned per tier; the level is which board
  you are on within that tier. Nuts & Bolts feeds its level into its generator, and this
  deliberately does not — a within-tier difficulty ramp would be a new thing to tune against those
  gates, not a port of the reference.

## Persistence

`gamehub.pipes.v1` holds the tier and nothing else. `gamehub.pipes.save.v1` holds the board in
progress. **Neither holds anything a player earned** — the only record of a solved board is
`recordPipes()` in `js/game-stats.js`, so nothing in this game's own storage can lose history. Both
values are one-tap-recreatable preferences, so THE LAW rule 2's carve-out applies. **The per-tier
level is not stored here either** — it is derived from the shared stats store (see above), which is
what keeps that carve-out honest now that this game has progression at all.

**There is deliberately no "fewest turns" best.** Every cross-device combine in `js/players-agg.js`
is built on `Math.max` (`docs/BUILDING-A-GAME.md` item 7: *bests take `Math.max`, never a sum*), so
a lower-is-better best would need a `Math.min` branch contradicting the rule the whole layer is
written to. Nuts & Bolts already solved this and is the precedent copied here: `moves` is a running
**total**, `bestLevel` is the hardest tier cleared. All three of item 7's edits are done
(`ensurePi` + `recordPipes`, the `pipesScreen` renderer, and the `players-agg.js` branch), plus the
`GAME_META` row in `js/leaderboard-ui.js` that is item 8 and the one that gets forgotten.

## UI notes worth knowing before editing

- **A tile's SVG is built once**, for the mask the piece had at mount, and a turn only changes a CSS
  `transform: rotate()`. That is why rotation animates for free: no path is rebuilt and no layout
  runs. The authoritative mask is always `game.cells[i]`; the transform is presentation only.
- **A cell is a `<div role="button" tabindex="0">`, never a `<button>`.** Safari before 16.4 will
  not reliably make a `<button>` a flex/grid container, and this element is drawn up to 72 times per
  screen (`dominoes/CLAUDE.md`, generalised in `docs/BUILDING-A-GAME.md` Part 0).
- **One delegated listener for the whole grid**, not one per tile — `destroy()` has to remove every
  listener it added.
- **A cross and a blank refuse to turn**, and the tile nudges instead of doing nothing, so the tap
  is acknowledged rather than reading as an unresponsive control.
- **Tier sizes are bounded by the 44px tap floor, not by taste.** Extra Hard is 8x9, not the 8x10
  the scope proposed: on a short phone (664px, the height `test-visual.mjs` checks) the hub's chrome
  plus this game's header leaves room for about nine rows at 44px. Measured, not guessed. `_fit()`
  sizes cells to whatever the wrap actually gives it, so the board never scrolls
  (`dominoes/CLAUDE.md`: a game screen that scrolls at all is a bug).

## The water animation

Matt, on why this is not polish: *"Animations are what really impresses people playing the games.
the king of games is really WOWed by the key animation. Stuff like that is valuable to me."* So it
was prototyped as part of the build rather than bolted on, and it drives the render approach.

**WATER IS DRAWN WHEREVER IT REACHES, ALWAYS — INCLUDING WHILE THE BOARD IS LEAKING.** This is the
rule; do not put a condition in front of it. `_paint()` used to gate the wet class on
`!leakSet.size`, so a single open end **anywhere** blanked the water across the **whole board** —
which means an unsolved puzzle, the state a player is in the entire time they are playing, was a
screen of white outlines with no blue in it at all. Matt, looking at exactly that (2026-08-31):
*"And I want it to be blue. Like I've told you to do several times."* A leak is not a reason to hide
the water; it is the reason to show it arriving at the place it is spilling out of. The leak glow
is now on **both** the `.pi-art` and `.pi-water` layers, because a leaking pipe is usually a wet one
and the water layer sits on top — glowing only the dry art hid the mark under the blue.

The visible payoff: the inlet bulb is blue from the first frame, so "this is where the water comes
in" is shown rather than explained, and a run that stops mid-board points straight at the piece to
turn next.

It walks `flow().order` — **the rules' own breadth-first order out of the inlet** — and wets one
tile every 34 ms. The render layer never works the path out for itself, so it cannot disagree with
the rules about where the water goes.

**Only NEWLY reached tiles are sequenced.** A tile already wet is left alone, so a turn that extends
the run reads as water creeping onward instead of the whole network blinking off and refilling from
the inlet. Water that no longer reaches a tile is removed at once — a receding network is a mistake
being undone, not something to celebrate in slow motion. `_flowWater()` is the single place that
touches the wet class, and it returns the ms until the last tile lands so a caller can wait for it.

**`checkSolved()` runs BEFORE the repaint on a turn**, and the celebratory replay is gone. The old
order painted the winning turn's whole run wet and then a separate `_runWater()` wiped every tile
and refilled from the inlet — a flash of white across a board the player had just watched fill. Now
one paint draws the final state, the last stretch flows on from where the water already was, and the
win banner waits for it (`fillMs + 120`) rather than announcing over a half-filled board.

**Each tile is revealed with `opacity` plus a small `scale` pop, both on the UX floor's allowed
list.** A true directional fill along each pipe would want `stroke-dashoffset`, which is *not* on
that list; that trade was made deliberately rather than slid past, and it is the first thing to
revisit if the animation ever needs to look better.

**Reduced motion thins garnish, it does not freeze gameplay.** The pipe's own rotation — which IS
the game — keeps its transition; only the water sequence and the nudge go instant, and nothing is
`display: none`'d.

## The screens were built from scratch first, and that was wrong

Matt, on the first build: *"again, you made this setup screen completely from scratch. it looks
nothing like anything we've created before. i hate it. and the box is not the right size at all."*

Both faults were mine, and the first one was written into my own scope document before I ignored it.

**1. USE `css/ui.css`. It is not optional.** Root `CLAUDE.md`'s "USE WHAT EXISTS" table says buttons,
cards, fields and modals come from the shared `.gh-*` primitives, and that a new game is the
*cheapest possible place* to adopt them because there is nothing to migrate. The first version
hand-rolled `.pi-diff`, `.pi-btn`, `.pi-brand` and `.pi-hud-btn` instead. Those are all deleted. The
screens are now a `.gh-card` holding the tier picker, `.gh-btn--block` actions, and `.gh-btn--sm`
in the HUD - `skeeball/js/ui.js` is the reference, and it injects the sheet with the same
`data-gh-ui-css` marker so it is never double-loaded.

**2. `diffShapeSVG()` MUST BE SIZED BY THE CALLER.** It returns an SVG with a `viewBox` and no
width or height, so inside a flex button it expands to fill and swallows the screen - the first
screenshot had a difficulty marker bigger than the Play button. `pinball/css/pinball.css` already
carries the numbers (17px, 29px for the two-diamond tier 4) and they are copied here.

**3. The board measured a box that could not have a height.** `_fit()` read `.pi-boardwrap`, which
is `flex: 1` inside a column - and in the HUB the host container has no definite height, so that
flex child collapsed to its own content and reported a box barely bigger than the board already
was. The board came out tiny, pinned to the top, with the screen empty below it. It measures
against the **viewport** now (`visualViewport` height minus what is above and below), which cannot
collapse that way, and re-fits on the next two animation frames because the first measure can land
before the hub has laid the container out.

**4. Its constants did not match the CSS** (gap 4 and padding 14, against the sheet's 2 and 6),
which quietly shaved every cell. The arithmetic has to describe the box that actually gets laid
out.

**5. Extra Hard is 7x10, not 8 wide, and WIDTH is why.** Measured in a real browser inside the hub:
8 columns needs `8*44 + 7*2 = 366px` of board, and a padded 393px phone leaves about 365. So it
trades width for length - still the longest board, and every tier clears the 44px floor. Easy
renders at 62px and Extra Hard at exactly 44px, with no scrolling in either axis.

## The setup screen, third time

Matt, after the second attempt: *"fix the setup screen."* The problem was never the primitives -
it was that I kept inventing the SHAPE of the screen instead of copying one.

**It is Nuts & Bolts' layout now, on purpose.** That is the game Matt compared Pipes to, it is this
hub's reference for a solo-puzzle setup screen, and `nuts-bolts/js/ui.js`'s `renderMenu()` is the
code that was actually read before writing this one:

- a centred header: the game name large, one line of tagline under it;
- a small-caps field label;
- **ONE ROW of four tier options**, not a 2x2 grid - shape marker beside the name, the grid size on
  a sub-line under it;
- the primary action, then a ghost "How to play".

Three details worth keeping:

- **The primary button is `gh-btn--primary`, which is BLUE.** `--gh-accent` in `css/ui.css` is
  `#1769d4`; the gold I reached for is Nuts & Bolts' own `--nb-` token, not a shared one. Skeeball,
  the newest game, uses the blue - so that is the house default and this follows it.
- **"Extra Hard" wrapped to two lines** and broke the row's alignment. Nuts & Bolts had already
  solved that by calling the fourth tier **Expert**, which fits on one line. Copied.
- **`diffShapeSVG()` must be sized by the caller** - it returns a viewBox with no width or height,
  so in a flex parent it expands to fill. It once rendered larger than the Play button.

**The rule this game learned three times:** the "Adding a game" checklist says to copy the
reference PER AXIS, and for a setup screen the reference is a real screen in this repo. Open it
and read it. Do not approximate it from the primitives list.
## The art, redrawn from Matt's reference screenshots (2026-08-30, MEASURED 2026-08-31)

Matt pushed eleven screenshots of a real Pipes app into this folder (`IMG_4594` to `IMG_4604`) and
said: *"Make our game look more like that."* **They are the reference for how this game looks. Do
not redesign away from them.** The drawing lives in `js/art.js`, which is pure - mask in, SVG out.

Four things were wrong in the first version, and none of them was a detail:

1. **NO TILE BOXES, NO GRID, NO GAPS.** The reference draws pipes on one flat field, running edge
   to edge, so a joined run reads as ONE CONTINUOUS PIPE. Ours had a per-cell background, per-cell
   rounding, a 2px gap and a board frame - which is what made it read as a spreadsheet. The board
   is `gap: 0`, no padding, no frame, and a cell has no background at all. **`_fit()`'s GAP and PAD
   are 0 to match; they must always describe the box that actually gets laid out.**
2. **A DRY PIPE IS HOLLOW, A WET ONE IS FULL.** Both are the SAME two-stroke construction - a wide
   stroke, then a narrower one punched back out of the middle - and only the two colours change.
   It joins correctly across neighbouring cells because both halves meet exactly on the shared
   edge, which is another reason the gap has to be zero.
3. **AN END IS A BULB** - a real circle on a stem, roughly one pipe-width in radius, with a hole
   punched through it in the FIELD colour when wet - not a dot on a stub.

A leak is marked by a glow on the PIPE rather than a ring around the cell, because a ring puts
back the grid the art is deliberately without.

### Then Matt looked at it and it still did not match (2026-08-31)

*"This does not look like those reference photos."* He was right, and the reason is that the
2026-08-30 pass matched the reference by EYE and wrote its guesses down as if they were findings.
**So this pass decoded `IMG_4602.png` and read the geometry out of the pixels.** That board is 7x9
on a 155px grid, and every number in `js/art.js` is now a measurement over 155:

| | reference | was | now |
|---|---|---|---|
| pipe outer width | 55px = **35.5** | 27 | 35.5 |
| wall thickness | 3px = **1.94** | 5.5 | 1.94 |
| bulb outer radius | 55.5px = **35.8** | 21 | 35.8 |
| field / pipe / water | `#353535` / `#ffffff` / `#73bcf5` | `#3a3a3c` / `#f2f4f7` / `#5eb8f5` | measured |

Two of those were the whole complaint: every pipe was two thirds the width it should be, and the
wall was nearly **three times** too thick - so what should read as a hairline around a wide channel
read as a fat soft double-stroke around a narrow one.

**THE ELBOW WAS THE THIRD, AND THIS FILE HAD IT EXACTLY BACKWARDS.** Item 3 used to read *"ELBOWS
ARE CURVES. A quadratic through the centre, not two straight arms meeting at a corner.
`stroke-linejoin: round` on a right angle does not come close."* The reference is two straight arms
meeting at the cell centre with a round linejoin, **and nothing else**. Measured on a real elbow
(cell 3,1 of `IMG_4602`): the inner wall of the turn is a sharp right angle, and the outer wall is
an arc whose radius is exactly half the stroke width, centred on the cell centre. That pair - sharp
inside, outer radius = half the stroke - is the signature of a stroke join and is not something a
quadratic produces. Ours swung ~13 units wide of the reference's centreline, which is what made our
elbows read as lazy S-bends beside its crisp turns.

**A WET PIPE KEEPS A RIM.** Measured across the blue, the water is the pipe's INTERIOR width and it
carries a near-black rim exactly where a dry pipe has its white wall (`--pi-water-rim`). The old
version drew the water as a bare stroke, narrower than the pipe around it and with no edge, so a
wet run was a blue slab that did not line up with the dry run it continued into.

**The board is FULL now** (`decoy: 1`, and no restriction on where a decoy may point - see the
generator). The reference has a piece in all 63 of its cells; ours was 43% empty on Easy and 25% on
Hard, which is most of why it read as scattered fragments rather than plumbing.

**Verify a change here by measuring, not by looking.** The reference PNGs are still in this folder,
and a 60-line dependency-free PNG reader plus the ratios above will tell you in seconds whether a
render is right. Every ratio in the shipped build was checked back against the reference this way
and lands within a pixel.

**The rule is copied too, as of 2026-08-31.** The reference says *"Rotate the pipes to link them
together into a single network"* - full net - and this file used to end here by saying that was the
one thing deliberately not copied. Three rounds of "why does this board have dead ends" later, it
turned out the rule WAS the look: a board where every piece must connect is why the reference's
boards read as purposeful and ours read as noise. See "The win condition" at the top.

## "Make Pipes look EXACTLY like the screen recording" (2026-08-31)

Matt, after three rounds of me explaining which differences were deliberate instead of removing
them. Put side by side at matched scale, against a light-theme frame of the recording, five things
were different and none of them was the art - the pipe ratios were already right:

1. **THE CARD IS GONE.** `.pi-root` was nuts-bolts' rounded panel with a shadow, sitting on the
   launcher's ground in a slightly different grey. The reference is one flat field with pipes
   floating on it, and the card was the loudest difference on the screen. No radius, no shadow, no
   border.
2. **THE FIELD RUNS TO THE BOTTOM** (`_fillHeight()`). Without it the panel stopped partway down
   and the launcher's own grey showed below, which still read as a card even with the frame off.
   The host has no definite height, so it is measured - and it must subtract the CONTAINER CHAIN'S
   BOTTOM PADDING (the hub's `.hub-main` has 40px). Filling straight to the viewport bottom makes
   the page 40px taller than the screen; measuring the document instead is circular, because
   collapsing the element to measure it changes the document's height. `test-visual`'s fit probe
   caught both.
3. **BULBS.** Ours had exactly two, which is most of why a board of ours read as bare lines. This
   was first "fixed" by sprinkling cap pieces as pure texture - which is precisely how the board
   ended up full of visible dead ends, and is what Matt caught. **The real fix was the rule** (see
   the win condition): under full net a bulb is a LEAF OF THE NETWORK, so boards are dotted with
   them and every one has to be connected. The hole marks the SOURCE and only the source - the
   reference's solved level has exactly one holed bulb and the rest solid.
4. **THE HUD IS THE REFERENCE'S**: a back chevron, the level centred with one line under it, and
   two icons right. Ours was three text buttons, which is the shape of a toolbar. The icons keep
   our functions (new board, leaderboard) in the reference's layout, at 44px tap targets.
5. **EASY IS 4x4.** Measured off the recording, its board is 1047px square on a 1206px screen -
   four cells across at 262px each. Fewer, bigger cells is why its pipes read as fat and confident
   where our 5x5 read as thin lines.

**`immersive: true` was tried and reverted.** It hides the hub's title bar, which is closer to the
reference, but it also floats a "‹ Hub" pill above the game - a second back button directly over our
own chevron, which looks worse than the title bar it removes.

The type is `ui-rounded` first, which is the reference's rounded geometric sans natively on the
iPhone this is played on.