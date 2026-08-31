# Pipes — build scope

> ## SUPERSEDED ON TWO POINTS (2026-08-31). READ THIS FIRST.
>
> This document was written by a Claude session, not by Matt, and on the two decisions below it
> steered him wrong. **Do not build from it without reading `pipes/CLAUDE.md`**, which has what was
> actually settled.
>
> 1. **The win condition is FULL NET, not "path with no leaks".** Section 1 below offers three
>    variants, recommends (b), and describes (c) full net — which is what the real app Matt was
>    pointing at actually does — as *"Hardest, and much slower to solve on a phone."* He picked (b)
>    off that menu with my thumb on the scale. Playing it showed why it was wrong: under (b) only
>    the pipes the water reaches are checked, so **52% of a Medium board was pieces the water could
>    never touch.**
> 2. **THERE ARE NO DECOYS.** Section 2 step 3 says *"Add decoys. Fill some of the remaining cells
>    with pieces that CANNOT join the solution."* That was not a consequence Matt accepted — it was
>    designed in here, by me, on day one, and it is the direct cause of every "why does this board
>    have dead ends" round that followed. Matt: *"I do not want decoy bulbs"*, and later, looking at
>    a solved board of his with the whole right-hand side untouched: *"Explain how this board
>    doesn't have dead ends or 'decoys'."* The generator now carves a spanning tree over every cell,
>    so every piece is on the network and the word "decoy" describes nothing in this game.
>
> The rest of the document — the module contract, the tiers, the animation notes, the test plan — is
> still accurate. These two are the ones that cost days.

Matt, 2026-08-29: *"a pipes game. where water flows into a pipe, then there's a mess of pipes all
misrotated and whatever and you have to find the path for the water to flow to the exit. similar
puzzle vibe as nuts and bolts."*

Scope only. Nothing here is built yet. Three decisions are still open and are marked **DECIDE**.

---

## 1. The game

A grid of pipe pieces. One **inlet** on an edge, one **outlet** on another. Every piece is dropped
in at a random rotation, so the board arrives as a mess. Tap a piece to rotate it. Connect the
inlet to the outlet and the water runs.

**Model it on Nuts & Bolts, not on Skeeball.** That game is ~1,960 lines in four files and its shape
is exactly right for this: a **generator** that builds a guaranteed-solvable board, a small pure
game core, a UI, and headless tests. It is also the closest thing in the repo to the "puzzle vibe"
Matt asked for.

| Nuts & Bolts | Pipes equivalent |
|---|---|
| `js/generator.js` (407 lines) — builds a solvable board, tiers, quality gates | the same job, and again the hardest part |
| `js/game.js` (175 lines) — pure rules, no DOM | grid state, rotation, connectivity |
| `js/ui.js` (954 lines) — screens, input, animation | same |
| `js/test.js` (301 lines) — headless | same, plus a solver |

### Pieces

Six kinds, each with a fixed set of rotations:

| Piece | Openings | Rotations |
|---|---|---|
| Straight | 2, opposite | 2 |
| Elbow | 2, adjacent | 4 |
| Tee | 3 | 4 |
| Cross | 4 | 1 |
| Cap (inlet / outlet) | 1 | 4 |
| Blank | 0 | 1 |

A piece is a 4-bit mask (N/E/S/W). Rotation is a bit rotate. That single representation makes the
whole engine small and makes the generator's solvability check trivial - two neighbours connect when
each has an opening facing the other.

### DECIDE 1 — what counts as solved

Three real variants, and they play very differently:

- **(a) Path only.** Inlet reaches outlet. Stray unconnected pipes elsewhere are fine.
  Easiest, most forgiving, closest to Matt's literal description.
- **(b) Path with no leaks.** Inlet reaches outlet, and no pipe *on the water's network* has an
  open end pointing at nothing. Leaks are visible and fixable, so the puzzle is about routing AND
  tidiness. **Recommended** - it is the version that makes the water animation mean something,
  because a leak is a thing you can SEE spilling.
- **(c) Full net.** Every piece on the board joins one leak-free network (the classic "Net"
  puzzle). Hardest, and much slower to solve on a phone.

Recommendation: **(b)**. It is a one-line change from (a) in the win check, and it is the version
where the animation does work rather than decoration.

---

## 2. The generator, which is the whole game

Same discipline as Nuts & Bolts: **build the solution first, then destroy it.** Never generate
randomly and hope.

1. **Carve the solution path.** A random self-avoiding walk from the inlet edge cell to the outlet
   edge cell. Path length is a difficulty knob - a short straight run is easy, a long meander is
   not.
2. **Lay the pipe along it.** Each cell on the path gets the piece whose openings match its two
   path neighbours (a cap at each end).
3. **Add decoys.** Fill some of the remaining cells with pieces that CANNOT join the solution -
   this is what makes the board look like a mess rather than a corridor. Decoy density is the
   second difficulty knob.
4. **Scramble.** Rotate every piece to a random rotation, with two gates:
   - **no piece may start already correct** (or at most a small fraction), or the board reads as
     half-solved and the puzzle feels cheap;
   - **the board must not be solvable in fewer than N rotations**, so a "puzzle" that is three taps
     from done never ships.
5. **Assert.** `test.js` runs a solver over every generated board at every tier and fails if any is
   unsolvable. Solvability is guaranteed by construction, so a failure means the construction broke
   - which is exactly the bug worth catching.

**Quality gates go in the generator, like Nuts & Bolts' `QUALITY_GATES`** - not in the UI, and not
discovered by a player.

### DECIDE 2 — difficulty axis

Nuts & Bolts uses four tiers (`easy`/`medium`/`hard`/`extraHard`) and they map straight onto the
shared 1-4 tier scale in `js/difficulty-tiers.js`, so copying that costs nothing and gets the
colourblind-safe shape markers for free (Matt is red/green colourblind - hue alone is never allowed).

Proposed knobs per tier: **grid size**, **path length**, **decoy density**, and **whether tees and
crosses appear at all** (an easy board of straights and elbows only is genuinely easier to read).

| Tier | Grid | Pieces |
|---|---|---|
| Easy | 5x5 | straight + elbow |
| Medium | 6x7 | + tee |
| Hard | 7x9 | + cross, denser decoys |
| Extra Hard | 8x10 | all, longest meander |

Sizes need checking against the 44px tap-target floor - see below. That check may cap the grid.

---

## 3. The water animation, which Matt called first-class

> *"Animations are what really impresses people playing the games. the king of games is really
> WOWed by the key animation. Stuff like that is valuable to me."*

So this is not polish at the end. It drives the render approach, and it is the thing to prototype
first rather than last.

**What it should do:** on a solve, water enters at the inlet and travels the path cell by cell,
filling each pipe, and arrives at the outlet. Under variant (b) a leak visibly spills. The whole
run should take about 1.2-1.8 s - long enough to watch, short enough to replay.

### DECIDE 3 — how it is drawn

The UX floor (`docs/BUILDING-A-GAME.md` Part 0) says: **animate only `transform`, `opacity`,
`filter`, `box-shadow`.** Two viable approaches:

- **(i) DOM grid, per-tile inline SVG, transform-only water.** Each cell is a
  `<div role="button" tabindex="0">` (NOT a `<button>` - Part 0, the Dominoes rule about buttons as
  flex containers on old WebKit) holding an inline SVG pipe. Rotation is `transform: rotate()`,
  which is on the allowed list and animates for free. Water is a second SVG layer per tile, revealed
  with a `transform: scaleX/scaleY` wipe, sequenced tile by tile along the path.
  **Fully compliant with the UX floor. Recommended.**
- **(ii) One canvas, water drawn as a growing polyline.** Total control, trivially smooth, but
  hands back tap targets, keyboard focus and screen-reader semantics, all of which a grid puzzle
  genuinely wants.

A third option - SVG `stroke-dashoffset` along one path - is the classic way to animate a flowing
line and would look best of all, but `stroke-dashoffset` is not on Part 0's allowed list. It is
paint-only on a thin path so the real cost is probably small, but taking it means documenting a
deliberate exception rather than sliding past the rule.

Recommendation: **(i)**, with the reduced-motion branch settling every pipe to "full of water"
instantly. Note Part 0's exception: reduced motion thins garnish, it does not freeze gameplay - so
the rotation of a tapped piece should stay animated even under reduced motion, and only the
celebratory flourish is cut.

---

## 4. Hub wiring — the parts that get forgotten

Standing rule (Matt): **any new game gets the full hub module-contract wiring by default.**

| Thing | Value |
|---|---|
| Folder | `pipes/` |
| Registry | `module: '../pipes/js/ui.js'`, hub id `pipes`, `released: '<ship date>'` |
| Immersive? | **No.** It is a grid puzzle with a header, like Nuts & Bolts |
| CSS root / prefix | `.pi-root` / `.pi-` (verified free - Pinball is `.pb-`, Pool is `.p2-`) |
| Settings key | `gamehub.pipes.v1` |
| Save key | `gamehub.pipes.save.v1` |
| `isInProgress()` | **`false`** - autosave after every rotation, so leaving is lossless (the Nuts & Bolts class, not the Ball Run class). Say so in a comment beside it |
| Stats id / recorder | `pipes` / `recordPipes`, sub-counter `pi` |
| Difficulty | four tiers onto the shared 1-4 scale via `js/difficulty-tiers.js` |

### The stats shape, and a trap worth naming now

**Do not store a "fewest moves" best.** Every cross-device combine in `js/players-agg.js` is built
on `Math.max`, and `docs/BUILDING-A-GAME.md` item 7 states it as a rule: *bests take `Math.max`,
never a sum.* A lower-is-better best would need a `Math.min` branch that contradicts the rule the
whole layer is written to.

**Nuts & Bolts already solved this** and is the precedent to copy: it tracks `bestLevel` (higher is
better) and `moves` as a running TOTAL, and never a "fewest". Pipes should do the same:

```
pi: { solved, moves, bestLevel, bestByTier }
```

All three edits are required, and missing the third is a THE LAW rule 1 bug invisible on one device:

1. `js/game-stats.js` — `ensurePi()` + its `normalize()` call + `recordPipes()`
2. `js/game-stats-ui.js` — a screen that RENDERS it
3. `js/players-agg.js` — an explicit `else if (g === 'pipes' && src.pi)` branch

Plus a `GAME_META` row in `js/leaderboard-ui.js` (item 8 - the separate registry, in a different
file, and the one that gets forgotten; Yahtzee shipped without it and 14 wins counted as zero).

---

## 5. Tests

`pipes/js/test.js`, headless, run by `run-all-tests.mjs`:

- **every generated board is solvable**, at every tier, over many seeds - the one that matters
- no board starts already solved, or within N rotations of solved
- the inlet and outlet are always on an edge and always reachable
- rotation is a pure bit-rotate: four rotations return the original mask
- the win check accepts the intended solution and rejects a leaking one (variant b)
- the solver's move count is sane at each tier (a difficulty smoke test)

Plus `node test-game-conventions.mjs`, which discovers game folders from disk and so covers Pipes
the day the folder appears: listener hygiene, the module contract, i18n plumbing, the 11px floor.

---

## 6. UX floor items this game will actually hit

From `docs/BUILDING-A-GAME.md` Part 0 - the ones a grid puzzle runs into specifically:

- **44x44 tap targets.** An 8x10 grid on a 393px-wide phone gives ~49px cells, so Extra Hard is
  near the floor. **Check this before fixing the tier sizes** - Dots and Boxes is the precedent for
  a documented, verified departure (it tests `elementFromPoint` at every centre), and a silent
  smaller number is not acceptable.
- **A game screen that scrolls at all is a bug.** The grid plus header must fit one screen at every
  tier, at both a tall and a short phone height.
- **Tiles are `<div role="button" tabindex="0">`,** not `<button>` - Safari before 16.4 will not
  reliably make a `<button>` a flex container, and the tile is drawn dozens of times per screen.
- **Rapid tapping** is the core interaction here, so the four-layer iOS text-selection fix from
  `hill-climb/CLAUDE.md` applies: `-webkit-user-select`/`-webkit-touch-callout`/
  `-webkit-tap-highlight-color` on the root's `*` descendant selector, `pointer-events: none` on
  label text, a non-passive `touchstart` calling `preventDefault()` keyed by `Touch.identifier`,
  and a `selectstart` backstop.
- **`safe-area-inset-bottom`** on the bottom control row.
- **Dark mode via `.gh-dark`**, never a `prefers-color-scheme` query in game CSS.
- **`onViewportResize`** from `js/viewport.js` - never a raw `resize` listener.
- **`css/ui.css`'s `.gh-*` primitives** for the setup and how-to screens. A new game is the cheapest
  possible place to adopt them, because there is nothing to migrate.

---

## 7. Suggested order

1. `generator.js` + `test.js` first, headless, no UI. Solvability proven before anything is drawn.
2. The pure core (grid, rotate, connectivity, win check).
3. **The water animation as a prototype**, on a hard-coded solved board. It is the thing Matt
   values and the thing that decides the render approach - finding out late that the approach is
   wrong is the expensive failure.
4. The grid UI and input.
5. Setup + how-to screens on `.gh-*` primitives.
6. Hub wiring, stats (all three edits), `GAME_META`, `sw.js` + `CACHE`, `strings.js`,
   `pipes/CLAUDE.md`.
7. `test-game-conventions.mjs`, then play it in a real browser before calling it done.

**Step 7 is not optional.** Pinball shipped four times on green headless tests while being
completely unplayable, because every fault lived in the DOM and renderer glue that headless tests
never construct. `playwright-core` is already in `node_modules` and Chrome is installed; point
`CHROMIUM_PATH` at it.

---

## Open decisions

1. **Win condition** - path only, path with no leaks (recommended), or full net?
2. **Difficulty axis** - are the four tiers and grid sizes above right, and does 44px cap them?
3. **Animation approach** - transform-only tile wipe (recommended, compliant), one canvas, or take
   the `stroke-dashoffset` exception for the best-looking result?
