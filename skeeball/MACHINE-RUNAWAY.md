# HOT SHOT: RUNAWAY — the machine with a moving part

Board id `runaway`. Fifth machine, built 2026-08-25. Matt asked for it in one sentence:

> *"what if I wanted another machine that's hot shot, but the top row only has the 100 basket,
> and it moves fr the left edge of the machine to the right and back and forth during the game?"*

and then, on the design report: *"New machine, ~7s round trip, build it. New machine = new files
and everything."*

**It is the first thing in this repo that moves under its own power.** Everything else on a
Skeeball face — every ring, collar, rail, tread and riser on all four earlier machines — is a
static rigid body placed once at build time. Read this file before touching anything in
`js/machines/runaway/`, and before building a sixth machine that wants a moving part of its own.

---

## What the machine is

HOT SHOT's cabinet, HOT SHOT's ball, HOT SHOT's ramp, HOT SHOT's three-tier staircase, and HOT
SHOT's rows 1 and 2 down to the last digit — the same columns, the same row heights, the same
4.25in mouths, the same depths, the same 10/20/10 and 30/60/30. Then the top shelf, which is one
basket:

```
  row 3   v 9.2875X          [ 100 ]  <- 4.00in mouth, and it SLIDES
  row 2   v 5.3X        30  |  60  |  30
  row 1   v 1.3125X     10  |  20  |  10
```

The 100 sweeps left and right across tread 3 for the whole rack, on a sine:

```
u(t) = amp * sin(2*PI*t / period)        amp 2.07X,  period 6.0s
```

`t` is the **rack clock** (`js/game.js`'s `machineT`) — seconds since this rack started, not
wall-clock time. Phase 0 is the centre of the travel moving right, so every rack opens with the
basket dead centre.

The whole game is that you throw at where the basket is **going to be**, not where it is. A
top-row throw is in the air about **0.45 s** from release (measured), and at peak the basket
covers about **24% of its stroke** in that time.

## Why the top row is one basket

Not a preference — the amplitude requires it. `holes.spacing` (MACHINE-SPEC.md section 11)
demands 1.30X between hole centres. A mover sharing its shelf with two static baskets would
violate that at nearly every step of any travel worth having, and there is no amplitude worth
having that does not. **A moving basket needs its shelf to itself.**

Matt's own sentence already contained this ("the top row only has the 100 basket"), which is why
the face needed no negotiation.

## Why the amplitude is 2.07X and not "the edge of the machine"

Matt asked for "the left edge of the machine to the right". It does not quite reach the edges,
and this is the one place the build departs from the literal ask. 2.07X is the **largest** number
that clears two hard rules at once:

1. **MACHINE-SPEC.md section 12, the collar-near-a-flat-wall rule.** A curved collar converging
   on a flat rail forms a pinch that three-contact-locks the solver. POPONGO's first draft
   measured **12% of all throws** walked out by the watchdog, every one wedged there. The rule
   is a wall gap wider than `0.78X`. At the ends of this travel:

   ```
   0.500 - 2.07X - (0.5X + 0.0825X) = 0.7850X   (3.14in against the 3.00in ball)
   ```

   **A MOVING collar is the worst possible case for that rule** — a static one merely sits in a
   pinch; this one can drive a ball into it under infinite solve mass. That fear has not
   materialised at this amplitude (0 walkouts across every grid run so far), but the margin is
   why.

   **The margin is now 0.005X, and that is the number to watch.** It was `0.0675X` at the 3.50in
   mouth this machine shipped with; widening the 100 to 4.00in on 2026-08-25 spent almost all of
   it, because a wider mouth grows the collar's OUTER diameter against a rail that did not move.
   The amplitude was kept at 2.07X only because the sweep measured zero walkouts at the new
   size — **the rule is a threshold, the sweep is the evidence.** Any further widening of this
   mouth, or any increase in `collarThick`, goes under the rule and has to be paid for out of the
   amplitude:

   ```
   amp <= 0.500 - (r + collarThick) - 0.78X
   ```

   Work the amplitude out first; do not just raise the mouth and re-run.
2. **`holes.inside`**: `|u| + holeR` at the extreme is `2.07X + 0.75X = 2.82X`, inside the
   3.4375X half-width. Unaffected by the mouth change — it measures against the board's nominal
   `holeR`, not this basket's rim.

It also landed somewhere useful by luck: **±2.07X is exactly where HOT SHOT's `topL` and `topR`
sit.** The 100 sweeps between two positions that machine already proves are clean-capturable,
which is why this face needed no reachability fight.

**Both numbers have to be re-derived if the amplitude, the mouth or the collar thickness ever
change.** `test-skeeball-machine-spec.mjs` now tests `holes.inside` and `holes.spacing` over the
whole travel rather than at the resting `u`, so getting it wrong fails loudly — but the 0.78X
rail rule is a *sweep* result, not a spec assertion, and only `sweep-mover.mjs` will catch it.

## Why 6 seconds, and why a sine

Matt's number, 2026-08-25 ("instead of 7s, make it 6s"). It shipped at 7 s, also his number.

| | 7 s (shipped) | **6 s (now)** |
|---|---|---|
| peak speed `2*PI*amp/period` | 0.270 m/s | **0.315 m/s** |
| stroke covered during a 0.45 s flight | ~20% | **~24%** |
| stroke | | unchanged |

That percentage is the whole dial: it is how far the basket moves between the moment you let go
and the moment the ball arrives, so it is how much lead the shot demands. Under ~10% the mover
is decoration; far above ~30% the lead stops being readable and starts being a guess.

**The period does not touch the rail-gap arithmetic** — only amplitude, mouth and `collarThick`
feed that, and a faster sweep covers the same ground in less time. It does need a **re-sweep**,
because reachability is a function of phase and a faster kinematic wall meets the ball
differently.

**A sine, not a triangle.** A triangle wave reverses instantaneously at each end, handing any
ball touching the rim a step change in wall velocity out of nowhere. The sine eases through both
ends for free and costs the same to evaluate.

---

## The three things the engine had to learn

All three live in `js/machines/runaway/`, and nothing outside that folder (except the rack clock,
below) knows a mover exists.

### 1. One sine, in `machine.js`, and nowhere else

`moverU(G, t)`, `moverVel(G, t)` and `holeU(G, id, t)` are pure functions of time with no state,
no `Date.now()`, nothing accumulated. `physics.js` drives the collision bodies with them,
`render.js` draws with them, and `test-skeeball-machine-spec.mjs` measures the travel envelope
with them.

**Never re-derive the sine anywhere else.** A second copy is a drawn basket drifting off its own
collision wall, which is the exact class of bug `machine.js` exists to make impossible.

### 2. The collar bodies are KINEMATIC

`physics.js` builds the mover's 14 collar segments as `CANNON.Body.KINEMATIC`, not `STATIC`.
That is the only correct choice, and both halves matter:

- cannon-es zeroes a kinematic body's inverse solve mass (`updateSolveMassProperties`), so **the
  ball can never shove the basket**;
- cannon-es integrates it by its own velocity and feeds that velocity to the contact solver, so
  **a struck rim hands the ball a real impulse**.

`driveMovers()` sets both position *and* velocity every substep. Position is authoritative
(re-derived from the sine each step, so integration error can never accumulate into a drift
between the drawn basket and the collision one); velocity is what the solver reads.

**Do not "simplify" this to a static body whose position is rewritten each step.** A static body
has velocity 0 by definition, so the wall would jump *through* the ball with the solver believing
nothing moved — deep penetration, then an explosive push-out.

### 3. Capture is measured relative to the mouth, and latches on commit

Two changes to the capture rule, both mandatory rather than tuning:

**Relative velocity.** The capture test asks "in the time this ball takes to cross the mouth, does
it fall far enough to be past the lip?" With a moving mouth that has to be the ball's speed across
*the mouth*, not across *the board*. Without the subtraction, a ball sitting dead still on tread 3
reads `vFace = 0`, so it drops in the instant the basket drives over it — **a hoover that pays 100
for a ball that was never thrown at anything.** That is MACHINE-SPEC.md section 9's banned
magnetism arriving through the back door.

**Latched mouth-u.** Once the ball is through the rim it is *in* the basket and rides with it, so
the pass-through test keeps asking about the mouth it actually fell into. Re-measuring against a
live `u` would let a basket that has slid on since capture turn a clean 100 into a `corner0`
gutter ball partway down its own drop.

---

## The rack clock — the one shared file that changed

`js/game.js` gained `this.machineT`, and it is the only edit outside `js/machines/runaway/` and
the board registry.

It has to live there because **three independent things need to agree about where the basket is**:
every throw builds its own cannon world, more than one ball can be in the air at once (`canThrow()`
hands the next ball over as soon as the last one has *arrived*, not settled), and the renderer is a
third party again. They agree because all three are pure functions of one number — `throwBall`
hands it to `startThrow` as `t0`, and `render()` reads `game.machineT` directly.

- **It is still pure.** `game.js` never reads a clock; it accumulates the `dt` its caller already
  hands `update()`. Same dt in, same `machineT` out, which is what keeps a machine with a moving
  part deterministic and replayable.
- **It advances before `update()`'s early return**, so the basket keeps sweeping while the player
  stands there deciding. A clock that only ran while a ball was in the air would freeze the target
  between throws.
- **It rides the autosave** (additive key; an old save has none and resumes at 0, which is the
  centre — exactly right for a machine with no mover). THE LAW rule 5: this adds a key and
  repurposes nothing.
- **It is 0 on every other machine**, which never reads it.

---

## Measured, on the real engine

`sweep-mover.mjs` — the reachability tool this machine needed, because a moving basket makes
reachability a function of a **third axis**. The same (power, aim) lands somewhere different
depending on where the basket is at release, so a two-axis sweep measures one arbitrary frozen
phase and will call the 100 unreachable or trivial at random.

**21 powers x 11 aims x 8 phases = 1,848 throws**, at the shipped 4.00in mouth (the 3.50in
build's numbers in brackets):

| hole | captures | share |
|---|---|---|
| lowL | 37 | 2.00% |
| lowC | 81 | 4.38% |
| lowR | 49 | 2.65% |
| midL | 32 | 1.73% |
| midC | 80 | 4.33% |
| midR | 27 | 1.46% |
| **topC (moving)** | **7** | **0.38%** |

- **0 watchdog walkouts**, at both mouth sizes. The crush/pinch failure mode a moving collar
  makes possible has not appeared at this amplitude on any grid — including at 4.00in, where the
  rail margin is only 0.005X.
- **Slowest settle 6.55 s** against the 12 s emergency cap (6.50 s at 3.50in — unchanged).
- **16.94% of throws scored**, mean 5.3 points per throw.

**Do not read topC's 7-vs-8 as the wider mouth making no difference — that is sampling noise.**
At 231 cells per phase this grid is far too coarse to resolve a hole this narrow; the dense probe
below, at 861 cells per phase, is the measurement that means anything. Same lesson as the phase
gaps, one paragraph down, and the same lesson as the classic's corner 100s.

**Against HOT SHOT on the same 21x11 grid**, its static `topC` scores 3/231 = **1.30%**. So the
moving 100 is about **3x harder than the static one** — which is the machine, and is in the same
band as BRICK CITY's skill row (its two 100s were 6 cells of 861 between them, 0.70%, and Matt
accepted that as "the slow one").

**The 8-phase run scored it at 4 phases and never at the other 4 — and that was the grid, not the
machine.** A dense probe (21 powers x 41 aims, 861 cells) at each of the "never" phases found it:

| phase | basket at | 3.50in | **4.00in** |
|---|---|---|---|
| t = 0.00 s (control, scored on the coarse grid) | centre | 9 / 861 | **10 / 861** |
| t = 1.75 s (coarse grid: never) | +2.07X, right end | 4 / 861 | **9 / 861** |
| t = 5.25 s (coarse grid: never) | −2.07X, left end | 5 / 861 | **8 / 861** |
| **total** | | **18 / 2583** | **27 / 2583** |

So the 100 is catchable **wherever the basket is**, and the two ends are mirror-symmetric — the
machine is not biased to one side. This is the same trap the classic's corner 100s sat in for
months (`skeeball/js/test.js` section 2): **a hole is not unreachable until a FINE sweep says
so.**

**What widening the mouth to 4.00in actually bought (2026-08-25).** Half again as many catching
cells overall — but almost all of the gain landed **at the ends of the travel**, which were the
hard part: the two extremes went 4 -> 9 and 5 -> 8 (+125% and +60%) while the centre barely moved
(9 -> 10). That is the useful shape of the change rather than a flat difficulty cut: the shot is
now roughly as available across the whole sweep instead of falling off a cliff at the turnarounds,
so timing the basket matters more and catching it at an awkward phase matters less.

---

## Rules this machine did NOT break

Worth stating, because a moving part sounds like it should have broken several:

- **No new counter, and so no three-edit rule.** Goal 1 reads the per-board `bestThrow`, exactly
  the way HOT SHOT's hoop goal does: the 100 is the only thing on this face worth 100, so a
  per-board best throw of 100 *is* proof it was caught.
- **No new `GAME_META` row and no `OFF_THE_BOARD` entry.** This is a Skeeball machine, not a game;
  `skeeball` already has its row.
- **No physics change to any other machine.** The engine split (`js/engines.js`, 2026-08-23) means
  the other four do not load a line of this.
- **No hole moved, resized, or deleted anywhere else**, and no stored key repurposed.
- **Reduced motion does not stop the basket.** `docs/BUILDING-A-GAME.md` Part 0 and
  `pinball/CLAUDE.md`: reduced motion thins garnish, it does not freeze gameplay. Freezing the
  basket on screen while the physics kept sliding it would leave a player aiming at a lie.

## Open questions for Matt

1. **Difficulty.** Widening the 100 to 4.00in (2026-08-25) raised the catching cells by half,
   mostly at the ends of the travel — see the table above. It is still the hardest thing on the
   machine and Goal 1 ("Catch the 100") is still its slow objective, just no longer punishing at
   the turnarounds. If it now plays too *easy*, the number to move is `RA_HOOP`'s companions in
   `js/goals.js` (the 240-in-a-game and 2,500-total bars), not the mouth again — the rail margin
   at 4.00in is down to 0.005X and there is nothing left to widen into without shortening the
   travel.
2. **The travel does not reach the literal edges** (±2.07X of a ±3.4375X face, so the basket
   covers the middle 60% of the width). The 0.78X rail rule is what stops it, and going wider
   means solving the pinch a different way (a sloped outer collar face, or a recessed rail
   pocket) rather than just raising the number.
3. **~~The phase gaps.~~** Settled during the build — see the table above. Catchable at every
   phase probed; the coarse grid was under-sampling.

## Two things the verification pass changed

Both were found by looking at the thing in a real browser, not by reasoning about it — which is
`VISUAL-PROCESS.md`'s whole point.

**The marquee clipped its own name.** HOT SHOT's `_paintMarquee` draws `board.name` at a hardcoded
104px with no fit-to-width. That is fine for a name as short as "HOT SHOT" and clips anything
longer: "HOT SHOT: RUNAWAY" lost a letter off each end. RUNAWAY's copy now measures and shrinks to
fit, and stacks a `PREFIX: NAME` name over two fitted lines the way BRICK CITY's sign does. **HOT
SHOT's and POPONGO's copies still have the fixed size** — they were left alone deliberately (the
engine split says an edit for one machine does not reach another) and neither has a name long
enough to clip, but a future machine copying from `basketball/` inherits the bug.

**The mover's rail was invisible, so it was deleted.** The first build drew a painted groove along
the travel with a stop post at each end. The groove was correctly placed and could not be seen at
all — not a contrast problem (it was retried in near-black and in the lit accent) but a geometry
one: the camera stands behind the ball, so tread 3 is the furthest surface on the machine and is
occluded by the middle row's riser. **Nothing lying flat on that shelf is visible from where the
game is played.** The posts read because they have height. The groove was removed rather than
dimmed — a mesh no player can ever see is dead geometry — and `_moverTrack`'s comment says so, so
it does not get "restored" as an oversight.

## Files

| file | what changed |
|---|---|
| `js/machines/runaway/machine.js` | `moverU` / `moverVel` / `holeU`; the mover's collar segments tagged |
| `js/machines/runaway/physics.js` | kinematic bodies, `driveMovers`, `t0`, relative-velocity capture, latched `capturedU` |
| `js/machines/runaway/render.js` | `_moverGroup` re-parenting, `_moverTrack`, per-frame offset |
| `js/boards.js` | the `runaway` entry (7 cups, 7 slots, `geom.mover`) |
| `js/engines.js` | one row |
| `js/goals.js` | `RA_HOOP` / `RA_BEST` / `RA_TOTAL` and the `runaway` goals |
| `js/strings.js` | tagline + `g_runaway`, EN and ES |
| `js/game.js` | **the rack clock** — the only shared-file change |
| `../sw.js` | three ASSETS entries, `CACHE` bump |
| `js/machines/runaway/render.js` | also: the marquee now fits its own name (see above) |
| `../test-skeeball-machine-spec.mjs` | `holes.inside` / `holes.spacing` test the travel envelope |
| `../test-stats-replay.mjs` | the chain literal, + "RUNAWAY is not silently granted" against the real synced records |
| `../sweep-mover.mjs` | new: three-axis reachability |
| `../js/game-art.js` | regenerated by `gen-skeeball-tile.mjs` |
