# Pipes — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below overrides
> them. This game's answer to THE LAW is short and is stated under "Persistence".

A grid of pipe pieces, every one dropped in at a random rotation. Tap a piece to turn it a quarter
turn clockwise. Get the water from the inlet to the outlet **without a leak**. Built 2026-08-29 from
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

## The win condition: path with no leaks

Matt chose this variant (2026-08-29) over "path only" and "full net". Water floods from the inlet
through joined openings, and to win:

1. the water must reach the outlet, **and**
2. every pipe the water reaches must be sealed — no opening pointing at a neighbour that does not
   open back, and none pointing off the board.

**Only pipes ON THE WATER'S NETWORK are checked.** A dry decoy in a corner with an open end is not
a leak, because nothing is flowing out of it. That asymmetry is the rule, and it is easy to get
wrong — see the solver note below.

Rule 2 is what makes the animation mean something: a leak is a thing you can *see*, at a specific
cell, so "you are not finished yet" is shown on the board instead of announced in text.

## The generator, which is the whole game

**Build the solution first, then destroy it.** A board is never generated randomly and checked
afterwards — "generate and hope" is how a puzzle game ships an unsolvable level to a real player.

1. Carve a self-avoiding walk from an edge cell to the opposite edge. A step that would touch the
   existing path on more than one side is refused: that makes a loop, and a loop makes the
   "correct" rotation of a cell ambiguous.
2. Lay pipe along it — each cell opens toward its path neighbours, the two ends becoming caps.
3. **Decoys: every remaining cell, pointing wherever it likes** (`decoy: 1`). This used to refuse
   any decoy that pointed at the path, on the stated grounds that it "would be unsolvable under the
   no-leaks rule", and downgraded the piece (cross → tee → elbow → straight → **blank**) until one
   fitted. That was wrong, and it is where the blank cells came from — 43% of Easy, 25% of Hard,
   against a reference board with a piece in all 63 of its cells.
   **A decoy pointing INTO a path cell cannot leak**, because a leak is only ever reported for a
   cell the water REACHES, and two cells are joined only when EACH opens at the other. In the
   constructed solution a path cell opens along the path and nowhere else, so it never opens back
   at a decoy: the decoy never joins the network and stays dry whatever it is aimed at. Removing
   the restriction is also what lets a cross sit beside the path.
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

**The independent solver drifted STRICTER than the rule TWICE**, and the second time is why it is
now built the way it is. Its first draft required every cell on the board to agree with every
neighbour — the FULL NET rule, not this game's — so it rejected perfectly solvable boards and
reported 0/12 against a generator that was fine. The fix left a weaker version of the same mistake
in place: it still required every OFF-path cell to be rotatable so that nothing FACED the path.
That assumption went red the day the generator started filling every cell (2026-08-31), on boards
whose constructed solution the assertion directly above it was accepting.

So it no longer holds an opinion about what solved means: it builds a candidate and hands it to the
real `isSolved()`, which is the only arrangement that cannot drift in either direction. **A checker
stricter than the rule is not a stricter checker; it is a broken one** — and it will read as a bug
in whatever it is pointed at, which the first time cost a day chasing a healthy generator.

## Persistence

`gamehub.pipes.v1` holds the tier and nothing else. `gamehub.pipes.save.v1` holds the board in
progress. **Neither holds anything a player earned** — the only record of a solved board is
`recordPipes()` in `js/game-stats.js`, so nothing in this game's own storage can lose history. Both
values are one-tap-recreatable preferences, so THE LAW rule 2's carve-out applies.

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

It walks `flow().order` — **the rules' own breadth-first order out of the inlet** — and wets one
tile every 34 ms. The render layer never works the path out for itself, so it cannot disagree with
the rules about where the water goes.

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

**The one thing deliberately NOT copied is the rule.** The reference says *"Rotate the pipes to link
them together into a single network"* - that is the FULL NET variant, which `docs/PIPES-SCOPE.md`
put to Matt as option (c) and he chose (b), path with no leaks. Copy the look; the rules are
already decided. **The visible consequence is bulbs**: the reference uses dead-end caps as ordinary
decoys, so its boards are dotted with circles. Ours has exactly two per board, because here a bulb
means the inlet or the outlet, and scattering decoy bulbs would be a lie about where the water goes.
That is the one texture difference from the reference that is on purpose.