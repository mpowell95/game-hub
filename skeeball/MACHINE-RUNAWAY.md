# HOT SHOT: RUNAWAY — the machine that changes shape while you play it

Board id `runaway`. Fifth machine, built 2026-08-25, rebuilt 2026-08-26. Matt asked for the
original in one sentence:

> *"what if I wanted another machine that's hot shot, but the top row only has the 100 basket,
> and it moves fr the left edge of the machine to the right and back and forth during the game?"*

and then rebuilt it in one more:

> *"what if i start with 2 100s on the top row - evenly spaced. then when you make 1 of them, that
> one disappears, and the remaining one starts moving? I'm also thinking baskets disappear once
> they're hit. so they can only be hit once."*

plus, on the escalation: *"Start with it stationary in the middle, then when it's hit, it starts
moving, then speeds up every time it's hit."*

**It is the only machine in the repo with a moving part, and the only one whose FACE CHANGES
SHAPE DURING A RACK.** Everything else on a Skeeball face — every ring, collar, rail, tread and
riser on all four earlier machines — is a static rigid body placed once at build time and still
there on the ninth ball. Read this file before touching anything in `js/machines/runaway/`, and
before building a sixth machine that wants a part of its own that moves or disappears.

---

## What the machine is

HOT SHOT's cabinet, HOT SHOT's ball, HOT SHOT's ramp, HOT SHOT's three-tier staircase, and HOT
SHOT's rows 1 and 2 down to the last digit — the same columns, the same row heights, the same
4.25in mouths, the same depths, the same 10/20/10 and 30/60/30. What is different is that **the
face is a sequence, not a layout.**

```
  row 3   v 9.2875X   [ 100 ]                    [ 100 ]     <- 4.00in mouths, at -/+2.07X
  row 2   v 5.3X            30  |  60  |  30
  row 1   v 1.3125X          10  |  20  |  10
```

Three rules, and together they are the whole game:

1. **Nothing is moving on ball 1.** Eight baskets, all standing still.
2. **Every basket is a ONE-SHOT.** Land in it and it closes for the rest of the rack.
3. **EVERY ROW PLAYS "LAST ONE STANDING".** Close the others and the survivor comes off its mark
   and sweeps the full width of its row. The top row is two, so it takes one ball; rows 1 and 2
   are three, so they take two. **Up to three baskets can be moving at once.** The top row's
   survivor is the one basket that never closes — catching it makes it **faster** instead.

Matt asked for the lower rows on 2026-08-27: *"when there's 1 basket left, regardless of which one
it is, it starts moving."* One rule covers all three rows, and the top row's twin 100s are just
that rule with a group of two.

So a rack funnels, and it funnels on three shelves at once. What is left standing at the end is a
face of moving targets — and only one of them refills.

**The maximum a rack can score is unbounded in principle and brutal in practice**: 160 from rows
1 and 2, 100 for the first top-row basket, and then every remaining ball has nothing to aim at but
a basket that has already sped up. Covering the whole face takes eight balls of nine with no
misses, which is what the second objective asks for.

## The handoff is free — for an OUTER survivor. A CENTRE one needs a second mode.

Every outer basket on this machine (`topL`/`topR`, and each lower row's two outside baskets) rests
at **-/+2.07X, which is exactly the amplitude** — so an outer survivor is already standing at a
*turnaround* of the travel it is about to run. `machine.js` anchors a **cosine** there:

```
u(t) = dir * amp * cos(2*PI*(t - t0) / period)        t0 = the rack clock at the handoff
                                                      dir = sign of the survivor's own resting u
```

At `t = t0` that puts the basket precisely where it already is **and gives it precisely zero
velocity**. It eases away from a standstill. No teleport to the centre of the sweep, and no step
change in wall velocity handed to any ball touching the rim.

**Move either mark and that stops being true** — the survivor would jump. `dir` being the sign of
the survivor's own u also makes the machine mirror-symmetric: it makes no difference which of the
two 100s you cap first.

(-/+2.07X is also exactly where HOT SHOT's `topL` and `topR` sit, so both marks are positions that
machine already proves are cleanly capturable. The static half of this face needed no
reachability fight.)

**A CENTRE survivor (u = 0) cannot use a cosine at all**, and a plain sine is the trap: it is at
its own mark at t0 but at **maximum speed** there, which is exactly the step change in wall
velocity the whole design exists to avoid. So it gets a **ramped sine** instead —

```
u(t) = dir * amp * r(t) * sin(w * (t - t0))      r ramping 0 -> 1 over one period
```

— which is at 0 (its mark) AND at zero velocity at t0, because `r(0) = 0` kills one term and
`sin(0) = 0` kills the other. It winds up to the full travel over its first period, which also
reads as a machine part spooling up. **Both modes exist for one reason: a basket must come off its
mark AT its mark and at ZERO SPEED.** `game.js`'s `_checkRows` picks by whether `|u| > 0`; a tool
that picked differently would be measuring a machine nobody plays.

**Verified**: every survivor starts at its own resting u to machine precision, with velocity 0 —
`lowC` (ramp) at 0.000000, `midR` and `topR` (cos) at 0.301091 against a resting 0.301091.

## Why the top row is two baskets and not three

Two static baskets 4.14X apart clear `holes.spacing` (1.30X, MACHINE-SPEC.md section 11)
comfortably, and once one closes **the survivor has the whole shelf to itself** — which is what
makes the amplitude legal at all. A third basket up there would violate spacing against the sweep
at nearly every step of any travel worth having.

Matt's own first sentence already contained this ("the top row only has the 100 basket"), and the
twin-100 rebuild threads the same rule rather than breaking it: the two 100s are only ever both
present while **neither** is moving.

## Why the amplitude is 2.07X and not "the edge of the machine"

Matt asked for "the left edge of the machine to the right". It does not quite reach the edges, and
this is the one place the build departs from the literal ask. 2.07X is the **largest** number that
clears two hard rules at once:

1. **MACHINE-SPEC.md section 12, the collar-near-a-flat-wall rule.** A curved collar converging on
   a flat rail forms a pinch that three-contact-locks the solver. POPONGO's first draft measured
   **12% of all throws** walked out by the watchdog, every one wedged there. The rule is a wall gap
   wider than `0.78X`. At the ends of this travel:

   ```
   0.500 - 2.07X - (0.5X + 0.0825X) = 0.7850X   (3.14in against the 3.00in ball)
   ```

   **A MOVING collar is the worst possible case for that rule** — a static one merely sits in a
   pinch; this one can drive a ball into it. That fear has not materialised at this amplitude: **0
   walkouts across every grid run, at every rung of the ladder** (see the measurements below).

   **AND THE LOWER ROWS ARE ALREADY UNDER IT.** Their mouths are wider (0.53125X against the top
   row's 0.5X), so at the ends of the same travel their wall gap is **0.7538X**, against the top
   row's 0.7850X. Those baskets have always sat there and swept clean as STATIC furniture; making
   one MOVE is the worst case the rule describes. **Measured, and it is clean**: a moving `lowC`
   over 924 throws gives **0 walkouts**, and so does the three-mover endgame (`lowC` + `midC` +
   `topR` at its fastest rung) over another 924. The rule is a threshold; the sweep is the
   evidence, and `node sweep-mover.mjs runaway --stage rows` is what re-measures it. Check it
   before touching any of the three inputs: the mouths, `collarThick`, or the amplitude.

   **The top row's margin is 0.005X, and that is the number to watch.** It was `0.0675X` at the 3.50in mouth
   this machine shipped with; widening the 100 to 4.00in on 2026-08-25 spent almost all of it,
   because a wider mouth grows the collar's OUTER diameter against a rail that did not move. Any
   further widening of this mouth, or any increase in `collarThick`, goes under the rule and has to
   be paid for out of the amplitude:

   ```
   amp <= 0.500 - (r + collarThick) - 0.78X
   ```

   Work the amplitude out first; do not just raise the mouth and re-run.
2. **`holes.inside`**: `|u| + holeR` at the extreme is `2.07X + 0.75X = 2.82X`, inside the 3.4375X
   half-width.

**Both numbers have to be re-derived if the amplitude, the mouth or the collar thickness ever
change.** `test-skeeball-machine-spec.mjs` tests `holes.inside` and `holes.spacing` over the whole
travel rather than at a resting `u`, so getting it wrong fails loudly — but the 0.78X rail rule is
a *sweep* result, not a spec assertion, and only `sweep-mover.mjs` will catch it.

**The travel is ABSOLUTE, not relative to the mark.** The survivor runs between `-amp` and `+amp`
wherever it started; it does not run `u +/- amp` around its own mark. The spec test's envelope was
written for the old single-mover shape and had to be corrected for this — getting it wrong doubles
the envelope and fails a machine that is fine.

## The escalation ladder — and what it actually does to the difficulty

`geom.mover.periods` is the ladder. `periods[n]` is the sweep's period after n catches, and the
last rung holds for every catch after it. 6.0s is Matt's shipped number (2026-08-25, "instead of
7s, make it 6s"); the rest is **measured, not guessed**.

`node sweep-mover.mjs runaway --ladder --powers 21 --aims 11 --phases 4` — 924 throws per rung,
one 100 capped and the other sweeping:

| rung | period | peak m/s | catching cells | share | jams | slowest settle |
|---|---|---|---|---|---|---|
| 0 | 6.0s | 0.315 | 8 | 0.87% | 0% | 6.07s |
| 1 | 5.0s | 0.378 | 6 | 0.65% | 0% | 6.25s |
| 2 | 4.2s | 0.450 | 8 | 0.87% | 0% | 7.03s |
| 3 | 3.6s | 0.526 | 4 | 0.43% | 0% | 6.42s |
| 4 | 3.1s | 0.610 | 4 | 0.43% | 0% | 6.23s |
| 5 | 2.7s | 0.701 | 8 | 0.87% | 0% | 6.68s |

**THE LADDER DOES NOT MEASURABLY CHANGE HOW AVAILABLE THE SHOT IS, and that is the honest
reading of this table.** 8, 6, 8, 4, 4, 8 across the rungs is not a trend — it is four to eight
catching cells out of 924 throws, well inside the sampling error of a grid this coarse, and the
fastest rung lands on exactly the same number as the slowest. The dip at rungs 3 and 4 is the
shape a first draft of this file confidently described as "the escalation biting"; rung 5 refuted
it. **A hole is not measurably harder until a FINE sweep says so** — the same lesson as the
classic's corner 100s (skeeball/js/test.js section 2) and the same one this machine's own phase
gaps taught in 2026-08-25.

**Do not expect the intuition to hold either.** "Faster target, more lead needed, therefore
harder" is wrong about what the sweep measures, and this machine's own history is the
counter-example: going from 7s to 6s bought **70% MORE** catching cells (46/2583 against 27/2583
on a dense probe), because during the ball's ~0.45s flight a faster basket sweeps through **more
positions**, so a wider set of `(power, aim)` pairs coincide with it on arrival. **A faster mover
is a bigger target in time even though it is the same target in space.** Pushing back the other
way is the **relative-velocity capture rule** — a fast rim means a fast crossing speed, and a ball
that cannot fall past the lip in the time it takes to cross the mouth rattles out instead of
dropping. Across this ladder the two effects evidently cancel.

**And a FINE grid at both ends of the ladder says the same thing, with the resolution to mean
it.** 21 powers x 41 aims x 4 phases, 3,444 throws per rung:

| rung | period | peak m/s | catching cells | share | walkouts | slowest |
|---|---|---|---|---|---|---|
| 0 | 6.0s | 0.315 | 21 / 3444 | 0.61% | 0 | 7.25s |
| 5 | 2.7s | 0.701 | 24 / 3444 | 0.70% | 0 | 6.68s |

The fastest rung is **not harder than the slowest — if anything it is a shade more available**,
which is the direction the 7s -> 6s history predicted and the opposite of the intuition. Both rungs
are catchable at every phase probed, at both ends of the travel and at both centre crossings, so
the machine is not biased to one side or to one part of the sweep. And **0 walkouts at 0.70 m/s of
rim speed on a fine grid** is the strongest evidence yet that the 0.005X rail margin holds: the
pinch a moving collar makes possible has still never appeared.

**So what does the escalation actually do?** It changes what the shot DEMANDS OF A PERSON, which
no sweep measures: deliberately timing a release against a 2.7s sweep is a different act from
timing one against a 6s sweep, even when the same fraction of blind `(power, aim)` pairs happen to
land. That is a real difference and it is the one Matt asked for — but it is a playtest claim, not
a measured one, and this file will not pretend otherwise. **Never state which way a rung moved the
difficulty without running `sweep-mover.mjs --ladder`, and do not over-read it when you have.**

**A sinusoid, not a triangle.** A triangle wave reverses instantaneously at each end, handing any
ball touching the rim a step change in wall velocity out of nowhere. The cosine eases through both
ends for free and costs the same to evaluate.

**The period does not touch the rail-gap arithmetic** — only amplitude, mouth and `collarThick`
feed that, and a faster sweep covers the same ground in less time. It does need a **re-sweep**,
because reachability is a function of phase.

**The escalation re-anchors with the PHASE PRESERVED.** The basket is somewhere in the middle of
its stroke when you catch it, not at an end, so recomputing `t0` naively would teleport it to a
turnaround. `game.js`'s `_reshape` solves for the `t0` that keeps the current phase angle under
the new period, which leaves its position exactly where it is and changes only how fast it is
going. Measured: position continuous to machine precision (jumps of order 1e-16 m), velocity
stepping by the period ratio, which is about 20% and lands at the instant the ball is already
captured.

---

## The one-shot face

**Closing a basket is NOT "capture turned off", and that distinction is the whole of it.** Leaving
the collar standing and refusing to capture turns a cup into a **bowl**: the ball drops in, cannot
be taken, and sits there until the watchdog walks it out twelve seconds later. That is precisely
BRICK CITY's parked-ball failure (`test-brickcity-stall.mjs`, 2026-08-26) rebuilt on purpose, one
file over.

So closing a basket is **two things, and it needs both**:

- `physics.js`'s `buildWorld` **does not build that basket's collar segments**. What is left under
  the mouth is the board slab — solid, because capture is the thing that takes the floor away.
- the capture loop **skips** that hole.

A ball rolls over a closed basket exactly the way it rolls over bare tread. Do one without the
other and it is either a bowl (collar, no capture) or a hole that swallows a ball through a flat
plate (capture, no collar).

### The cap is FLUSH, and on the top row it is flush always

`geom.capRise` is a knob, and it is **0**. A raised cap reads better and deflects a ball with some
feel, but it costs two things this machine cannot pay:

1. **The runaway sweeps straight over the 100 you capped.** The capped mark is one end of the
   travel, so the surviving collar passes through that exact spot twice a period. A bump there is a
   moving collar converging on a static obstacle — the pinch that cost POPONGO 12% of its throws.
   Non-negotiable: `capFor()` forces rise 0 on a top-row hole regardless of the knob.
2. **On rows 1 and 2 a raised cap deflects balls thrown PAST it at the top row.** Those rows close
   as the rack goes on, so the face would get progressively more hostile to the 100 — exactly when
   the 100 is the only thing left to throw at. The machine's whole arc working against itself.

Raise it and **re-run `test-runaway-capped.mjs`**, which sweeps the face with every basket closed
and fails on a parked ball. A raised cap has a flat apex, and a tread is tilted 0.10 rad (5.7
degrees) against a board friction angle of `atan(0.12)` = 6.8 degrees — a ball balanced exactly on
an apex has less slope than grip.

### A closed basket vanishes WHOLE — and two earlier answers were wrong

The empty shelf is the signal. `render.js` builds each basket as ONE group: `position.x` slides it
(a basket that is sweeping) and `visible` hides all of it (a basket that has closed).

**Two things were tried first and both failed, in opposite ways.**

The first build hid the basket and drew a flat plate flush in the face where the mouth had been.
The plate was correctly placed and **completely invisible** — the same finding `_moverTrack`
already records for the mover's painted groove, and for the same reason: the camera stands behind
the ball, so every tread is foreshortened almost to nothing and occluded by the riser in front of
it. **Nothing lying flat on this face can be seen from where the game is played.** A closed basket
read as one that had never existed.

The second kept the **backboard** standing — a numbered card with no hoop under it — which reads
perfectly and is what shipped on 2026-08-26. Matt, next morning: *"make the backboards vanish with
the baskets."* It had also stopped working once every row could move: a survivor sweeps through
its dead neighbours' marks, so the shelf filled with numbered cards that the one live basket kept
sliding behind.

**Do not restore either.** An empty shelf with one basket moving across it is unmistakable, and it
is the picture the machine is about.

---

## The three things the engine had to learn

All three live in `js/machines/runaway/`, and nothing outside that folder (except the rack state,
below) knows a mover or a one-shot exists.

### 1. One cosine, in `machine.js`, and nowhere else

`moverU(G, t, sweep)`, `moverVel(G, t, sweep)`, `holeU(G, id, t, sweep)` and
`holeOffset(G, id, t, sweep)` are pure functions of geometry, time and rack state — no internal
clock, no `Date.now()`, nothing accumulated. `physics.js` drives the collision bodies with them,
`render.js` draws with them, and the tools measure the travel envelope with them.

**Never re-derive the motion anywhere else.** A second copy is a drawn basket drifting off its own
collision wall, which is the exact class of bug `machine.js` exists to make impossible.

### 2. The collar bodies are KINEMATIC — and BOTH 100s get them

`physics.js` builds a top-row basket's 14 collar segments as `CANNON.Body.KINEMATIC`, not
`STATIC`. Both halves matter:

- cannon-es zeroes a kinematic body's inverse solve mass (`updateSolveMassProperties`), so **the
  ball can never shove the basket**;
- cannon-es integrates it by its own velocity and feeds that velocity to the contact solver, so
  **a struck rim hands the ball a real impulse**.

`driveMovers()` sets both position *and* velocity every substep, **per hole**. Position is
authoritative (re-derived from the cosine each step, so integration error can never accumulate
into a drift between the drawn basket and the collision one); velocity is what the solver reads.

**Do not "simplify" this to a static body whose position is rewritten each step.** A static body
has velocity 0 by definition, so the wall would jump *through* the ball with the solver believing
nothing moved — deep penetration, then an explosive push-out.

**Both top-row baskets are kinematic from the first frame**, because either can become the
runaway and cannon-es cannot change a body's type after the world is built. The one that never
moves is driven to offset 0 forever, which costs nothing and keeps the two 100s physically
identical until the handoff.

### 3. Capture is measured relative to the mouth, and latches on commit

Two rules, both mandatory rather than tuning:

**Relative velocity.** The capture test asks "in the time this ball takes to cross the mouth, does
it fall far enough to be past the lip?" With a moving mouth that has to be the ball's speed across
*the mouth*, not across *the board*. Without the subtraction, a ball sitting dead still on tread 3
reads `vFace = 0`, so it drops in the instant the basket drives over it — **a hoover that pays 100
for a ball that was never thrown at anything.** That is MACHINE-SPEC.md section 9's banned
magnetism arriving through the back door. It is also, at the fast end of the ladder, the thing
that makes the escalation an escalation.

**Latched mouth-u.** Once the ball is through the rim it is *in* the basket and rides with it, so
the pass-through test keeps asking about the mouth it actually fell into. Re-measuring against a
live `u` would let a basket that has slid on since capture turn a clean 100 into a `corner0`
gutter ball partway down its own drop.

---

## The rack state — what changed outside the machine folder

`js/game.js` carries three fields, and they are the only edits outside `js/machines/runaway/`, the
board registry, and the stats counter below.

```js
this.machineT = 0;          // the rack clock: seconds since this rack began
this.closed = [];           // slot ids already landed in - their collars are not built
this.sweep = null;          // { hole, t0, dir, period, catches } once a 100 has dropped
```

They have to live there because **three independent things need to agree about the face**: every
throw builds its own cannon world, more than one ball can be in the air at once (`canThrow()`
hands the next ball over as soon as the last one has *arrived*, not settled), and the renderer is
a third party. They agree because all three are pure functions of the same values.

- **`sweep` is shared BY REFERENCE, not copied.** It can change while a ball is in the air — land
  the first 100 with a second ball already thrown and the survivor comes off its mark mid-flight.
  Sharing the object is what keeps every reader looking at one basket. A snapshot in `startThrow`
  would make the drawn basket and the one the ball hits two different baskets. **Mutate it in
  place; never swap in a fresh object once a ball is live.**
- **It is still pure.** `game.js` never reads a clock; it accumulates the `dt` its caller already
  hands `update()`. Same dt in, same state out.
- **`machineT` advances before `update()`'s early return**, so the basket keeps sweeping while the
  player stands there deciding.
- **All three ride the autosave** as additive keys. An old save has none and resumes with a fresh
  face and nothing moving — exactly right for a machine that has neither. THE LAW rule 5: this
  adds keys and repurposes nothing. `closed` is read back against the board's OWN holes, so a save
  cannot close a basket the machine does not have.
- **They are inert on every other machine**, which never reads or writes them.

`_reshape(hole)` is the rule itself, and it runs **after** the ball has scored: what a ball is
worth is decided by the machine it was thrown at, never by the machine it leaves behind. A miss
(`gutter`, `corner0`) closes nothing.

---

## The new counter: `sk.runaways`

**Goal 1 had to stop reading `bestThrow`, and this is why.** It used to be "a per-board best throw
of 100 proves the moving basket was caught" — true while the machine had exactly one 100 and that
100 was always moving. The twin-100 rebuild makes a rack **open** with two still 100s, so a
`bestThrow` of 100 can now be earned on ball 1 against a parked target and proves nothing about
the sweep.

`sk.runaways` counts balls landed in ANY basket **while it was running** — the top row's 100 or a
lower row's last one standing. It is a lifetime counter in `js/game-stats.js`, fed from
`result().runaways`, and it took the full three-edit rule:
`game-stats.js` (the counter), `js/players-agg.js` (the cross-device branch — without it, a
person's second device syncing would zero it, THE LAW rule 1), and `js/game-stats-ui.js` (the My
Stats row). `players-agg.test.mjs`'s structural probe enforces exactly that.

A global counter is safe here in a way it would not be for most objectives: **RUNAWAY is the only
machine with a moving basket, so it is the only machine that can ever write to it.**

`b.bestThrow` is untouched — still `Math.max` only, still recorded, still shown on the machine's
own records. The goal simply stops reading it. The goal **id stays `runaway`**, so anyone who
completed the old version keeps every unlock it earned (`sk.unlocked` is additive and nothing
anywhere removes an id — THE LAW rule 2).

### The objectives, re-set 2026-08-27

Matt cleared two of the first three in his **first rack** — 260 exactly against a 260 bar, and one
runaway caught against a bar of one. All three moved, and the shape changed with them: this
machine's objectives are about its FACE, not about a score.

1. **Catch a runaway 10 times** (`RA_RUNAWAYS`) — **on ANY row.** Matt asked which it meant and
   chose any: the machine's identity is baskets that run away, not one basket that does. A row
   survivor counts exactly as much as the 100, which also makes the counter accumulate at a
   sane rate (a moving `lowC` is caught on 2.6% of blind throws against the top 100's 0.87%).
2. **Land in EVERY basket in one round** (`RA_FULL`) — Matt's own suggestion, and the best
   objective on the machine. Each basket closes when you hit it, so covering the face means eight
   scoring balls of nine into eight different baskets, three of which are sweeping by the time you
   reach them.
3. **10,000 points in total** (`RA_TOTAL`, up from 2,500).

**`fullRacks` is a PER-BOARD counter, not a global one**, and that saved the three-edit rule
entirely: `js/arcade-scores.js` already owns the per-board record's shape and its cross-device
merge, so ensure + record + merge are three edits in ONE file and `js/players-agg.js` needs
nothing. It is also the correct scope — "every basket" means a different thing on every machine,
and a global counter would let one machine satisfy another's objective (Matt's "completely
distinct" rule, 2026-08-22). Measured against the board's OWN holes and fed from `slotsHit`, which
excludes the trough, so it cannot be completed by missing.

**The single-game score objective is gone.** Two of the three now say something about the face,
which is the same shape BRICK CITY uses (baskets x3 + perfect rounds + net total).

---

## Measured, on the real engine

### The opening face (ball 1 — nothing closed, nothing moving)

`node sweep-mover.mjs runaway --stage open` — 231 cells:

| hole | captures | share |
|---|---|---|
| lowL | 4 | 1.73% |
| lowC | 9 | 3.90% |
| lowR | 5 | 2.16% |
| midL | 2 | 0.87% |
| midC | 12 | 5.19% |
| midR | 2 | 0.87% |
| **topL** | **2** | **0.87%** |
| **topR** | **2** | **0.87%** |

16.45% of throws scored, mean 6.5 points per throw, **0 watchdog walkouts**, slowest settle 6.17s
against the 12s cap. The two static 100s are 1.73% between them, against HOT SHOT's single static
`topC` at 1.30% — so the rack opens slightly kinder than HOT SHOT and gets harder from there,
which is the arc.

### The endgame face (everything closed but the runaway, at the last rung)

`node test-runaway-capped.mjs` — 693 closed-face throws plus a 231-throw open baseline:

| | median settle | p90 | max | walkouts |
|---|---|---|---|---|
| open (baseline) | 2.90s | 4.58s | 6.17s | **0** |
| all shut but the runaway | 3.04s | 3.83s | 5.19s | **0** |

**Closed baskets paid 0 balls**, and the runaway is still catchable with the whole rest of the
face shut (0.87%). The closed face is fractionally slower at the median and actually *tighter* at
the tail — with no cups left to swallow a ball, more of them simply roll the whole way back.

**That test compares the two faces rather than checking a fixed settle budget, and that was a
correction.** Its first draft asserted a median under 3.0s, a number lifted from BRICK CITY's
probe, and the closed face measured 3.04s — a failure that meant nothing, because this machine's
*open* face medians 2.90s. On a board where most throws roll the full length back into the trough,
three seconds is simply what a ball costs, and a borrowed constant cannot know that.

---

## Rules this machine did NOT break

- **No hole moved, resized, or deleted on any other machine**, and no stored key repurposed. The
  cup id `r100` is retired rather than repointed — a cup id is frozen to its value forever, and
  the thing it named (a single always-moving 100) no longer exists. `r100a` / `r100b` are new.
- **No physics change to any other machine.** The engine split (`js/engines.js`, 2026-08-23) means
  the other four do not load a line of this.
- **No new `GAME_META` row and no `OFF_THE_BOARD` entry.** This is a Skeeball machine, not a game;
  `skeeball` already has its row.
- **Reduced motion does not stop the basket.** `docs/BUILDING-A-GAME.md` Part 0 and
  `pinball/CLAUDE.md`: reduced motion thins garnish, it does not freeze gameplay. Freezing the
  basket on screen while the physics kept sliding it would leave a player aiming at a lie.

## Open questions for Matt

1. **The nine-ball arithmetic.** A perfect rack closes six baskets by ball 6, leaving three throws
   at nothing but a runaway that has already sped up. That is either the best finish on the floor
   or a punishing one, and **no sweep can tell you which** — it needs real racks.
2. **The escalation is unmeasured, not measured-flat.** The coarse ladder (above) says the
   catching-cell count does not move across the six rungs. That is a real result and it means the
   escalation is a TIMING change rather than an availability change — the sweep cannot see a
   person trying to time a release. If it does not feel like an escalation in real racks, the
   number to move is `periods` in `js/boards.js`, not the mouth: the rail margin at 4.00in is down
   to 0.005X and there is nothing left to widen into without shortening the travel.
3. **The ladder may want to do something other than change the period.** The fine grid says a
   faster sweep is not a less available shot, so if the escalation needs to bite in a way a sweep
   can see, the lever is not `periods`. Candidates, none of them measured yet: shrinking the mouth
   a rung at a time (blocked today - the rail margin is 0.005X, so the amplitude would have to pay
   for it), or shortening the travel so the basket spends less time near the reachable centre.
   Both are real changes to the machine and belong to a playtest, not a guess.
4. **`capRise` is 0.** A raised cap on rows 1 and 2 would give a closed basket some physical
   feedback (the ball visibly deflects) at the cost of making the top row harder to reach late in
   a rack. Deferred deliberately, and measurable: raise it and run `test-runaway-capped.mjs`.
5. **The travel does not reach the literal edges** (-/+2.07X of a -/+3.4375X face, so the basket
   covers the middle 60% of the width). The 0.78X rail rule is what stops it, and going wider means
   solving the pinch a different way (a sloped outer collar face, or a recessed rail pocket) rather
   than just raising the number.

## Files

| file | what changed |
|---|---|
| `js/machines/runaway/machine.js` | the cosine (`moverU`/`moverVel`/`holeU`/`holeOffset`), `isMoverHole`, `capFor`; both 100s' collars tagged with their hole id |
| `js/machines/runaway/physics.js` | `buildWorld(board, closed)` skips a closed basket's collar; capture skips a closed hole; `driveMovers` per hole; `startThrow` takes `closed` + `sweep` |
| `js/machines/runaway/render.js` | one group per basket, with a nested cup group that hides on close; the backboard stays; `_moverTrack` reads `mover.holes` |
| `js/boards.js` | the `runaway` entry: two 100 cups, `topL`/`topR`, `mover.holes` + `mover.periods`, `capRise` |
| `js/game.js` | `closed`, `sweep`, `runawayCatches`, `_reshape()`, and all three in the snapshot |
| `js/goals.js` | `RA_RUNAWAYS` replaces `RA_HOOP`; `RA_BEST` 240 -> 260 |
| `js/strings.js` | tagline, `g_runaway`, `d_ra_hoop`, EN and ES |
| `../js/game-stats.js` | `sk.runaways` — the lifetime counter |
| `../js/players-agg.js` | its cross-device branch (THE LAW rule 1) |
| `../js/game-stats-ui.js` + `../js/strings.js` | its My Stats row, EN and ES |
| `../sw.js` | `CACHE` bump (no new deployed files) |
| `../sweep-mover.mjs` | rewritten: rack STAGES (`open`/`run`/`endgame`) and `--ladder` |
| `../test-runaway-capped.mjs` | new: the closed-face stall probe |
| `../test-skeeball-machine-spec.mjs` | the travel envelope is absolute, and a pair that can never both be open is exempt from spacing |
| `../run-all-tests.mjs` | one row |
