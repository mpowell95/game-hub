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
3. **Decoys, and the constraint that makes them safe.** A decoy must have a rotation whose openings
   all avoid the path, or the board would be unsolvable under the no-leaks rule. The generator
   checks all four rotations and downgrades the piece (cross → tee → elbow → straight → blank) until
   one fits. **This is why a cross never appears beside the path**: a cross has an opening on every
   side and can never avoid anything.
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

**The independent solver was wrong first, in a way worth keeping.** Its first draft required every
cell on the board to agree with every neighbour — which is the FULL NET rule, not this game's — so
it rejected perfectly solvable boards and reported 0/12 against a generator that was fine. A checker
stricter than the rule is not a stricter checker; it is a broken one.

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
