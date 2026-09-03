# Golf: decisions log

## heightfield-z-mirror

§7.2 of GOLF-HANDOFF.md says to verify the Heightfield body's orientation in Part 1 and, if
mirrored, switch to the documented fallback. It was mirrored.

With `matrix[i][j] = height[i + j*nx]`, position `(x0, 0, z0)`, quaternion
`setFromEuler(-Math.PI/2, 0, 0)`: a ball dropped at grid point `(0,0)` fell straight through to
`y ≈ -1963` (full 20s freefall), confirming no collision.

Cannon-es's `Heightfield` stores height along the shape's LOCAL Z axis, with local X and local Y
as the two horizontal axes (`data[xi][yi]`, height = `data[xi][yi]`). The quaternion
`(-PI/2, 0, 0)` rotates local Z to world Y (up), which sends local Y to world **-Z**. So with the
matrix indexed by `[i][j]` directly, increasing `j` moves the pillar toward **decreasing** world
z — mirrored against `terrain.js`'s convention (`wz = z0 + j`).

Fix used, exactly the fallback the handoff describes: position shifted to `(x0, 0, z0 + (nz-1))`,
and the matrix built with the j-index reversed: `matrix[i][j] = height[i + (nz-1-j)*nx]`. This
passed the drop-test acceptance check at all three grid points named in test 1 (with the caveat
below).

## heightfield-tunneling-and-dt

cannon-es has no continuous collision detection, and a ball dropped vertically from 5m onto the
real (non-flat) terrain tunneled through the ground on close to half of sampled points at the
originally-specced `dt = 1/240`. Not a mapping bug (a flat all-zero heightfield never tunnels) and
not fixable by retuning a golf constant — reproduced on a bare Heightfield/Sphere pair with no
golf code involved. Failure rate: ~50% of a sampled grid at `dt=1/240`, ~2.5% at `dt=1/480`, 0% at
`dt=1/960` (measured against 80 points). Matt's decision (2026-09-02): `dt = 1/960`, samples still
recorded every 1/60s (every 16 steps at this rate). §7.2 of GOLF-HANDOFF.md updated to match.

## ground-guard-threshold

Belt-and-braces correction added on top of cannon-es's own contact resolution, since even at
`dt=1/960` a fast-falling sphere can still occasionally miss the heightfield. First version: fire
whenever `pen > 0.002` (2mm), snap position, reflect the normal velocity component by restitution.

This broke normal bounces. Traced one driver landing: cannon-es doesn't resolve a bounce in one
step, it settles it over several consecutive steps as penetration decays naturally (measured: pen
0.0133 -> 0.0116 -> 0.0085 -> 0.0055 -> 0.0024 over 5 steps, with the ball already moving upward
by the second step). The guard fired on every one of those steps regardless of `vn`'s sign (the
position snap wasn't gated on it, only the velocity reflection was), applying restitution multiple
times to the same physical bounce. Measured effect: a flat-ground driver shot bounced to z=124,
then to z=-45 (backward past the tee), then z=-170, oscillating with growing sideways drift,
eventually going OB.

Matt's decision (2026-09-02): fire only when the ball's CENTER is at or below the surface
(`ball.y < heightAt(ball.x, ball.z)`, i.e. `pen > radius` ≈ 21mm). cannon-es's own contact settle
penetrates a few mm, never that much; true tunneling is metres. Snapping the ball back above the
surface means it can't re-fire on the same contact. Nothing else about the guard changed. §7.2 of
GOLF-HANDOFF.md updated to match.

## applyforce-relative-point-bug

The actual root cause of the erratic, energy-gaining bounces above (the ground-guard threshold was
a real bug too, but not sufficient on its own to explain everything found while tuning - a putt at
`dt=1/960` with the corrected guard still flew hundreds of metres into the air). cannon-es's
`Body.applyForce(force, relativePoint)` takes a point **relative to the body's center of mass**,
not a world position - confirmed straight from the vendored source's own doc comment. Every force
application in `physics.js` (air force, roll resistance, the post-landing spin force) was calling
`applyForce(force, ballBody.position)`, passing the ball's absolute world coordinates (e.g.
`(0, -0.26, 377)`) as if it were an offset from center. That manufactures a torque of the same
order as `force × 377`, which is enormous - traced one putt where this alone spun the ball up to
angular velocities in the thousands of rad/s and, through the resulting dynamics, accelerated it
instead of the intended rolling-resistance deceleration (measured: horizontal speed climbing from
7.2 to 30.3 m/s over 4 real seconds of a "high rolling resistance" putt that should have stopped
in well under a second).

Fixed by calling `applyForce(force)` with no second argument everywhere in `physics.js` (cannon-es
defaults `relativePoint` to a zero vector when omitted, i.e. center of mass, i.e. no torque - which
is what every one of these forces should always have produced: they're environmental/aerodynamic
forces, not off-center contact forces). This one fix resolved every carry target to within
tolerance using the speeds already found by the first (pre-fix) speed search - see
`carry-tuning-part1` below.

## carry-tuning-part1 (first pass, SUPERSEDED by spinaxis-sign-bug below)

Order followed exactly as directed: speed per club (bisection search against `sweep-carry.mjs`'s
targets, `spin01=0`, flat/no-wind/power-1.0), then a check on the driver's apex, then roll for the
green.

- **Speed**: bisection search per club, `CL_COEF` held at the spec's original 0.62. All seven
  carries landed within 0.1% of target - but every speed came out above 120 m/s (driver 151.08),
  which is not a real golf ball speed. Flagged as a possible bug at the time but not chased further
  in this pass.
- **CL_COEF**: driver apex at power 1.0 was 16.7m, under the 20m floor. Swept `CL_COEF` 0 to 1.0,
  re-bisecting speed at each: apex barely moved (16-18m across the whole range), and went the WRONG
  way (worse) as `CL_COEF` rose from 0.62. Concluded (**wrongly** - see below) that this was a
  structural limit from the driver's fixed 12° launch angle, and reverted to 0.62.
- **Roll (green)**: bisection search, isolated from the pin (a lip-out and rolling off the green's
  edge both confounded early attempts). Final: `roll = 0.03589`, giving exactly 36.0m for a
  full-power putt - **this result stands**, unaffected by the bug below (putter has zero spin and
  zero launch angle, so it never touches `spinAxis` or lift at all).

Everything else in this section was thrown out. It looked self-consistent (all targets hit, tests
green) but the >120 m/s speeds were themselves the symptom of a real bug, caught only because Matt
independently knew what a real driver's ball speed and flight shape should look like and asked for
a systematic check rather than accepting the numbers. See `spinaxis-sign-bug` below.

## spinaxis-sign-bug

Matt's diagnosis request (2026-09-02): real driver ball speed is ~70 m/s, and at 70 m/s/12°
launch/2600rpm backspin the model should give ~220-240m carry, ~25-32m apex, ~5.5-6.5s hang -
nothing like what the >120 m/s "tuned" speeds above implied. Six things to check, in order.

Reset every club to the §5 original speeds first, then traced a real 70 m/s driver shot (every
0.25s) through the actual `airForce`/cannon-es code paths (not a reimplementation):

- **Item 1** (force applied once/step, not pre-multiplied, no double-accumulation): clean.
  `applyForce` is called once per `world.step` iteration with a raw newton value; confirmed from
  the vendored source that `World.step()` calls `clearForces()` (zeroing every body's `.force`)
  AFTER `integrate()` each step, so nothing carries over or double-applies.
- **Item 2** (`world.step(H)` single-argument, no internal substepping): clean, every call site
  uses the one-argument form.
- **Item 3** (body mass/radius): clean. Printed `body.mass = 0.04593`, `body.invMass =
  21.772262138036144` (= 1/0.04593 to full precision).
- **Item 4** (drag uses `|vr| × vr`, not `|vr|² × vr`): clean. `flight.js`'s `drag = vr * (-0.5 ×
  rho × Cd × A × s)` where `s = |vr|` - a scalar times the vector, giving magnitude `0.5 × rho ×
  Cd × A × s²`, the correct quadratic form. Printed value at t=0 matches the expected ~1.03N
  exactly.
- **Item 5** (`liftDir.y` must be positive for backspin at launch): **THE BUG.** Printed
  `liftDir = { x: 0, y: -0.978, z: 0.208 }` - negative y. `spinAxis` was
  `{ x: cos(dirRad), y: 0, z: -sin(dirRad) }`. For backspin (top of ball moving backward relative
  to travel), the correct axis is `travelDir × up`: at `dirRad=0`, `travelDir=(0,0,1)`,
  `travelDir × (0,1,0) = (-1,0,0)` - the exact NEGATION of what was shipped. Every driver shot's
  backspin was producing **downforce**, not lift.
- **Item 6** (rpm→rad/s, spin ratio): clean. `omega = 272.271 rad/s` (2600rpm), `S = 0.0830` at
  launch - both match the expected values exactly.

**Fix**: `spinAxis = { x: -cos(dirRad), y: 0, z: sin(dirRad) }` (general form of `travelDir × up`).
Re-traced the same 70 m/s driver shot: `liftDir.y` now `+0.978`, apex rose from a downforce-capped
~6m to 12.1m - correct direction, but still well under the 25-32m Matt described. This is because
the CL_COEF re-tuning conclusion in `carry-tuning-part1` above was itself contaminated by the sign
bug: with lift acting as downforce, *raising* `CL_COEF` made the downforce worse, which is exactly
the "went the wrong way" result recorded there. It was never a structural launch-angle limit.

Re-swept `CL_COEF` at fixed 70 m/s with the sign now correct: 0.62→apex 12.1m, 1.0→16.2m,
1.5→24.8m/carry 230.5m/hang 6.32s, 2.0→35.4m/242.4m/7.28s. **`CL_COEF = 1.55`** lands all three of
Matt's target bands at 70 m/s: carry 232.8m, apex 25.9m, hang 6.46s.

Re-bisected every club's speed against this corrected physics (`CL_COEF=1.55`, correct
`spinAxis`): every speed now falls in 25-72 m/s - driver 71.93, down to sand wedge 29.01 - all
realistic golf ball speeds, all seven carries within 0.1% of target, driver apex 27.3m (within the
new 22-38m acceptance band added to test 3). Final speeds in `clubs.js`/§5 of the handoff; full
`sweep-carry.mjs` table in the Part 1 report. `test3` in `test.js` now asserts every club speed is
25-80 m/s and driver apex is 22-38m, so a future regression of this bug fails loudly instead of
quietly converging on absurd speeds again.

## rollout-tuning-part2

§15's exception, added by Matt (2026-09-02): *"a constant may be retuned only when a stated
sanity band is violated, with evidence, and this qualifies."* Applies here: Part 2's reachability
tests found a driver shot rolling ~500m past a 240m carry into OB, on nearly every hole. See the
Part 2 report for the original finding.

**Lever 1, grip** (new `SURF[s].grip` field: fraction of tangential velocity lost on every
land/bounce transition, applied once in `physics.js` at the `wasGrounded->nowGrounded` check,
which is the single point both cannon-es's own contact and the ground guard funnel through).
Values given by Matt, not further tuned: OB 0.50, ROUGH 0.55, FAIRWAY 0.35, FRINGE 0.35,
GREEN 0.30, SAND 0.80, WATER 1.00, TEE 0.35. Alone, this cut driver/fairway rollout from ~500m to
~66m in the first measurement taken (see caveat below on reproducibility).

**A note on measurement reproducibility during this tuning pass.** Several rounds of sweeping
`rest`/`roll` produced numbers that did not reproduce when re-measured later in the same session
with (as far as could be determined) identical parameters - e.g. an early sweep recorded
driver/fairway rollout of 16.9m at `rest=0.20, roll=0.65`, but re-running that exact combination
fresh gave 4.8m. Read the full `physics.js` source at that point and found nothing structurally
wrong (no leftover mutation, no stale import, no double-application). Unable to identify a root
cause, and treated every number below as suspect until re-verified fresh in an isolated script
immediately before being written into the source - the final table reflects only numbers
confirmed this way, not any earlier sweep's recollection. Flagging this honestly rather than
presenting the final numbers as if the search were as clean as it should have been - if the same
irreproducibility shows up again in a future tuning pass, it is worth taking seriously as a real
bug (possibly in the sensitivity of the multi-bounce sequence to something not yet identified)
rather than dismissing it as one-off flakiness.

**Lever 2 (roll) and lever 3 (restitution), ROUGH: solved.** Driver landing in rough only has one
band (rollout under 6m). `rest: 0.12, roll: 1.3` gives 4.6m, safe margin. Restitution was lowered
because roll alone plateaued around 4.7-7.4m depending on how far it was pushed, never confidently
under 6.

**SAND: passed unchanged.** Wedge landing in a bunker gave 0.28m of rollout with SAND's given
`grip: 0.80` alone (`rest`/`roll` untouched from the original spec values). No further tuning
needed or attempted.

**FAIRWAY: NOT fully solved - flagging for Matt rather than guessing further.** Three clubs share
one surface's `(rest, roll)`, and the three bands are: driver 15-35m (+ first-bounce height under
1.5m), 7-iron 4-15m, wedge -3..8m. An automated grid search (`rest` 0.05-0.85, `roll` 0.02-1.8+,
several dozen points, then local refinement around the best candidates) never found a point
satisfying all three at once. The best trade-off found, `rest: 0.30, roll: 0.81` (now in
`physics.js`): 7-iron 12.0m (in band) and wedge 8.0m (in band, right at the edge), but driver only
7.0m - well short of the 15m floor. Every point that gets the driver into its own band pushes
7-iron and wedge to roughly 2x their caps (e.g. `rest=0.40 roll=0.045` - the ORIGINAL
spec values plus grip alone - already gives driver 19.7m, in band, but 7-iron 26.9m and wedge
23.7m, both well over, and the driver's own bounce height is 2.21m, over its 1.5m cap too).

The mechanism, as far as it was possible to trace: driver's rollout is dominated by a single first
bounce/hop (the flight is shallow enough at landing that most of "rollout" happens airborne between
the first two ground contacts, which `roll` cannot touch at all - it only acts while continuously
grounded); 7-iron and wedge land at a much steeper angle for their speed, producing more bounce
events and proportionally more hop distance relative to their own carry. Raising `roll` shrinks all
three roughly together, so by the time 7-iron and wedge are in range, the driver has usually already
dropped below its own floor.

Left at the best-found trade-off point rather than the original values, since 2 of 3 target clubs
being right is strictly closer to the goal than 0 of 3 - but this is a placeholder, not a solved
value. Options for Matt to choose from, not decided here: raise the driver's rollout floor's lower
bound to something the model can actually reach at this trade-off point (~7m); accept a
club-specific adjustment (a lever the current instructions did not offer, since `grip`/`roll` are
per-surface, not per-club); or accept 7-iron/wedge missing their bands in favor of the driver.
`golf/js/test.js`'s `test3b` asserts driver/fairway rollout as the current known-failing case, so
this stays visible rather than silently passing.

## course-fixes-part2

Two Harbor holes' `target` moved (Matt's decision, 2026-09-02), both par-5 second-shot landing
spots that sat beyond even a driver's carry from the pin - genuinely unreachable in one shot, not
a rollout artifact:

- **H3**: `target` `[0, 230]` -> `[-2, 290]` (target-to-pin distance 245m -> within a 3 wood).
- **H7**: `target` `[10, 235]` -> `[22, 300]` (target-to-pin distance 265m -> within a 3 wood).

`golf/courses/harbor/course.js` updated; §9 of GOLF-HANDOFF.md updated to match.

## reproducibility-part2

Matt's diagnosis (2026-09-02): the trade-off tuning approach was wrong because the model was
missing the spin term that separates a driver from a wedge - and separately, freeze `SURF` so any
script that mutates it throws, since that's the likely explanation for numbers not reproducing
during the first rollout-tuning pass.

`Object.freeze(SURF)` plus `Object.freeze()` on every inner row, added to `physics.js`. **The
freeze never actually threw** in any test or tuning script run since - `test.js` and every tuning
script written for this pass build their own fresh terrain per measurement and never write into
`SURF`. So the freeze did not catch a live bug in the shipped code; it stands as a guard against
the class of bug Matt suspected, and as documentation that this is now enforced rather than a
convention. What DID fix the actual reproducibility problem, empirically: every measurement in
this second pass called `build(flatHole())` fresh inside the measuring function itself, rather
than once and reused across a `for` loop of mutated `SURF` values (the pattern the first pass's
temp scripts used). Re-ran the SAME `(SPIN_BRAKE, roll)` point three times in a row after settling
on final values and got byte-identical rollouts every time (`21.39` all three runs) - this pass's
numbers are trustworthy in a way the first pass's were not. Whether the earlier pass's
irreproducibility was really a mutation bug this freeze would have caught, or something else
entirely, is still not known for certain; the discipline change (fresh terrain per measurement,
no shared mutable state at all) is the part that's verified to matter.

## spin-brake-part2

Matt's diagnosis: the driver-vs-wedge rollout tension in the first pass was the model missing a
term, not a tuning problem - a wedge's much higher backspin should visibly brake it on landing in
a way a driver's low backspin does not, and the flat "0.02 x m x g for 0.5s" post-land force
applied identically regardless of how much spin was actually left could never produce that
distinction.

Replaced with a grounded backspin brake proportional to remaining spin:
`force = m x SPIN_BRAKE x omega`, opposing travel, while grounded and `omega > 0`. `omega` decays
fast while grounded (`*= exp(-dt/0.6)`, roughly a second of effect) on top of the existing
per-contact `*0.4` and the unchanged airborne decay (tau 25s). Backspin is clamped at 0, never
negative.

**Tuning order followed exactly as given** (roll fixed at the reset 0.10 fairway starting point,
`SPIN_BRAKE` tuned to the wedge first, then the driver checked, then 7-iron expected to fall in
band on its own):

- `SPIN_BRAKE` swept 0.008-0.020 (Matt's expected range) at fairway `roll=0.10`. Noisy/non-
  monotonic across that range (7-iron rollout at one point read -10.75, i.e. the ball ended up
  BEHIND its own carry point - a real, if extreme, outcome of a backward bounce, not a
  measurement error, given the reproducibility fix above). `SPIN_BRAKE=0.008` put the wedge at
  6.79m, inside its -3..8m band.
- Driver checked next at that `SPIN_BRAKE`: 38.7m, over the 35m ceiling (and bounce height 4.95m,
  also over). Raised fairway `roll` toward 0.15 as directed; landed at **`roll=0.15`**: driver
  21.4m (in 15-35m) with bounce height 1.23m (under 1.5m), wedge still in band at 6.35m.
- **7-iron did not fall into band on its own.** It stayed at 24-29m rollout across every
  `SPIN_BRAKE`/`roll` combination tried in this pass, against a 4-15m target - the grounded
  backspin brake helped the wedge (highest stock spin, 10000rpm base) and left the 7-iron
  (6500rpm) still well outside its band. Per the instruction, stopping here and reporting the
  three rollouts rather than continuing to guess: **driver 21.4m (pass), 7-iron 25.6m (fail, need
  4-15m), wedge 6.4m (pass)**.

Rough and sand were not re-tuned in this pass (the instruction was to reach them only after
7-iron passed on its own). Rough is at its Part-2-reset starting value (`rest: 0.25, roll: 0.25`)
and now fails its own band (8.9m against a 6m ceiling, since the reset undid the earlier Part-2
rough tuning along with fairway's). Sand is untouched from spec defaults and still passes
(wedge/sand rollout unaffected by anything in this pass, since a bunker shot's landing spin is
the same physical quantity but sand's much higher `grip` (0.80) already dominates the outcome).

Putter/green: unaffected, still exactly 36.0m (green's own `roll` was never touched, and the
putter carries zero backspin so the new brake term never applies to it).

## spin-bite-part2

Matt's diagnosis of why the grounded brake alone left the 7 iron stranded at 25.6m against a
4-15m band (2026-09-02): **backspin was being destroyed by the `x0.4` per-contact rule across the
iron's bounces before the grounded brake could ever act.** An iron lands, bounces three or four
times, and by the time it settles into the continuous roll the brake is written for, its spin is
0.4^3 ≈ 6% of what it landed with. The brake was aimed at the wrong moment.

Three changes, all decided by Matt:

1. **Spin bite at impact** (`SPIN_BITE`, m/s of tangential speed per rad/s of backspin). On every
   land/bounce event, AFTER the grip scaling and BEFORE the per-contact spin decay, tangential
   speed is reduced by `min(|vt|, SPIN_BITE x omega)`. Clamped at `|vt|`, so a bite can stop the
   ball dead but never reverse it - only the grounded brake can pull a wedge back. This is
   backspin biting the turf at the moment of contact, which is where a real ball's spin does its
   work.
2. **Per-contact spin retention 0.4 -> 0.6** (`SPIN_RETAIN`), so an iron still carries spin worth
   biting with on its second and third bounces.
3. Grounded brake (`SPIN_BRAKE = 0.008`) and its 0.6s grounded decay unchanged.

**Tuning, in the order given (driver first).** `SPIN_BITE` swept 0.002-0.008 at the inherited
fairway roll of 0.15: the 7 iron came down from 23.3m (bite 0.002) to 14.8m (bite 0.008), so the
band was reachable, but only just - 0.24m of margin against the 15m ceiling, in a model that has
repeatedly shown a few metres of jitter between neighbouring parameter values. Rather than ship a
number that passes by less than its own noise, probed the second authorized lever (fairway roll
0.10-0.18) against the bite together:

| bite | fw roll | driver | 7 iron | wedge | driver bounce |
|---|---|---|---|---|---|
| 0.008 | 0.12 | 26.91 | 9.14 | 1.75 | **4.99 - fails the 1.5m cap** |
| 0.008 | 0.15 | 16.01 | 14.76 | 1.95 | 1.22 |
| 0.008 | 0.18 | 16.61 | 8.25 | 2.13 | 1.26 |
| 0.005 | 0.18 | **16.94** | **10.78** | **2.89** | **1.26** |

`SPIN_BITE = 0.005` at `roll = 0.18` is the chosen point: every club mid-band rather than on an
edge (7 iron 10.78 in 4-15, wedge 2.89 in -3..8), driver bounce height 1.26m under its cap. Worth
recording that `roll = 0.12` is disqualified by the DRIVER BOUNCE HEIGHT, not by any rollout -
that constraint is what rules out the otherwise-attractive low-roll corner.

**Robustness, not just the single point:** every combination tested at `roll = 0.18` (bite 0.005
through 0.008) kept the driver above its 15m floor and the 7 iron inside its band. That
neighbourhood behaviour is the real evidence the point is sound; a single margin number in this
model is not.

**Rough:** `roll` swept 0.25 -> 1.30. Driver-into-rough falls 6.91 -> 5.15 and asymptotes near
5.1 (most of that rollout is the bounce sequence, which `roll` cannot touch). Settled on
**`ROUGH roll = 0.80`** (5.41m, 0.59m under the 6m ceiling) rather than pushing to 1.3 for the
last 0.26m - 0.80 against fairway's 0.18 is also a defensible ratio for the surface.

**Sand:** untouched, passes at -0.50m (the wedge checks back half a metre in a bunker, which is
right).

**Putter/green:** still exactly 36.00m. Green's `roll` was never touched in any Part 2 pass, and
the putter carries zero backspin so neither the bite nor the brake ever applies to it.

**A pleasing side effect worth noting:** the 9 iron's `total` (121.4m) is now SHORTER than its
`carry` (123.0m) on the flat test hole - the ball checks back 1.6m on landing. That is correct
golf for a high-spin short iron, and it falls out of the model rather than being asked for.

## course-fixes-part2b

Five reachability failures remained after the physics was right, all the same shape: the
auto-club table is discrete, so a target sitting between two clubs' carries means the shot
overshoots by up to 35m before it has rolled a metre. Fixed by moving the aim `target` only
(never physics, never a fairway width or bunker), each candidate chosen by MEASUREMENT - a
scan script evaluated both legs for a spread of candidate targets per hole, rather than
arithmetic on the club table:

| Hole | target before | target after | why |
|---|---|---|---|
| H3 | `[-2, 290]` | `[-4, 320]` | 3 wood from 185m overshot to 27.2m past the pin; from 155m the 5 iron finishes 23.2m away |
| H4 | `[-10, 220]` | `[-38, 280]` | drive aimed at the old target finished in ROUGH outside the dogleg; the new aim tracks the fairway's bend, and leaves a sand wedge that finishes 11.0m from the pin |
| H5 | `[4, 128]` | `[0, 120]` | par 3: the old target (the pin itself) selected a 7 iron that flew 153m into rough past a 128m green. A 9 iron aimed straight finishes ON the green, 6.9m away |
| H6 | `[-4, 200]` | `[-2, 208]` | 101m left a 9 iron 26.9m past; 93m puts a wedge 17.7m away |
| H9 | `[0, 240]` | `[-2, 270]` | 145m left a 5 iron 33.2m past; 115m puts a 9 iron 17.9m away |

H3's is the thinnest at 23.2m against the 25m limit, and its neighbourhood is genuinely noisy
(targets at z=316 and z=328 fail while 312, 320 and 324 pass) - the 5 iron's 170m carry simply
cannot be made to finish closer from any reachable aim point on that hole. Flagging it as the
one edit here that sits on jitter rather than on margin. The other four all clear by 7m or more,
and H5's passes with three of its four neighbours also passing.

H7's earlier move (`[10, 235]` -> `[22, 300]`, recorded above) still stands and still passes.
`golf/courses/harbor/course.js` and §9 of GOLF-HANDOFF.md both updated.

## camera-history

No render.js/camera.js decisions needed changing from the handoff's literal spec - §10.1/10.2
were followed as written. One implementation fact worth recording since it was verified rather
than assumed: `PlaneGeometry(nx-1, nz-1, nx-1, nz-1)` after `.rotateX(-Math.PI/2)` produces vertex
index `i + j*nx` with local x untouched by the rotation and local z increasing monotonically with
row index j - checked directly in Node against the real vendored three.js before writing
`_buildTerrain()`, given this is exactly the shape of bug that bit the Part 1 heightfield mapping
(§7.2). No mirroring this time; the mesh is positioned at
`(x0 + (nx-1)/2, 0, z0 + (nz-1)/2)` to map that local grid back to terrain.js's own `(x0+i, z0+j)`
convention exactly, with no fallback branch needed.

## webgl-canvas-reuse-part3

Found while testing `tools/preview.html`'s hole switcher in a real browser (not caught by any
node-side check, since this is a DOM/WebGL-context bug): switching holes broke rendering
entirely from the second selection onward - blank canvas, console showing
`THREE.WebGLRenderer: A WebGL context could not be created. Reason: Canvas has an existing
context of a different type`.

Cause: a WebGL context released via `forceContextLoss()` can never be reissued on the SAME
`<canvas>` element - the browser permanently marks that element as having had a context, and
every subsequent `getContext()` call on it (which is what `new THREE.WebGLRenderer({canvas})`
does internally) fails. `render.js`'s own `dispose()` does exactly what §10.1 specifies
(`forceContextLoss()` then `dispose()`) and that part is correct; the bug was in
`preview.html` calling `new Renderer(canvas, ...)` again on the SAME canvas right after
disposing the previous one.

Fixed by minting a fresh `<canvas>` element per hole load (append to a host `<div>`, discard the
old one) rather than reusing one across a dispose/recreate boundary - the same pattern
Skeeball's `js/ui.js` already uses for exactly this reason (its own gallery mounts a new canvas
per machine rather than reusing one). Documented directly in `render.js`'s header comment and in
`preview.html` itself, since this is exactly the kind of mistake Part 4's `ui.js` could repeat
when it builds its own mount/remount cycle - **never call `new Renderer(canvas, ...)` on a
canvas a previous `Renderer` was ever constructed with, even after `dispose()`.**

Verified after the fix: 9 hole switches in sequence, then a second fresh-tab pass with a 9-switch
loop back to hole 1, zero new console errors either time (screenshots after each). The 5 errors
that appeared during debugging turned out to be from an unrelated cause - manually calling
`canvas.getContext('webgl')` from devtools while investigating a rendering question, which
poisoned the canvas the exact same way; confirmed by reproducing them on a completely fresh tab
that had never run that debug code and seeing zero errors there. Read `read_console_messages`
output was also observed to persist across same-tab navigations rather than clearing - worth
knowing for future browser-verification work in this repo, since it can make a stale error look
like a live one.

## part4-scope

### gf-root descendant-selector bug

`golf.css` follows the repo's descendant-scoping convention throughout: every rule is written
`.gf-root .gf-setup { ... }`, `.gf-root .gf-top { ... }`, etc. - `.gf-root` must be an ANCESTOR
element, not the same node the screen class sits on. The first draft of `ui.js`'s `_renderSetup()`
and `_enterPlay()` each built one `<div class="gf-root gf-setup">` (or `gf-play`) directly under
`container` and swapped it wholesale. `"A B"` never matches an element carrying both classes A and
B on itself - only a genuine descendant relationship matches - so essentially every rule in
`golf.css` (padding, the five play-screen bands, meter layout, everything) was silently inert.
Caught by screenshot: the setup screen's content sat flush against the viewport edge with no
`padding: max(24px, ...) 16px ...` visible.

Fixed by making `.gf-root` a single persistent wrapper `<div>` created once in the `GolfGame`
constructor and appended to `container` for the life of the instance. `_renderSetup()` and
`_enterPlay()` now each clear and rebuild `this.rootEl`'s CONTENTS (`this.rootEl.innerHTML = ''`,
then append a fresh `<div class="gf-setup">` or `<div class="gf-play">`), never touching
`this.rootEl` itself. `destroy()` still clears `container.innerHTML`, which removes `.gf-root`
along with everything in it - satisfying §10.1's "destroy() must remove [the canvas]" by removal
of its whole ancestor chain.

## part5-scope

### The ui.js / game.js split

`golf/js/game.js` (new) now owns every round RULE: stroke counting, water/OB penalties, max
strokes per hole (`par + 4`), the wind roll, the Modified Stableford points table and result
words, hole-to-hole advance (rolling the next hole's wind, placing the ball at its tee, resetting
phase to `'intro'`), and round create/restore. It is pure - no DOM, no `Math.random`, runs in
Node - so a fixture (Part 6) can drive a full round headlessly. Lifted verbatim from Part 4's
`ui.js`, not redesigned: `holePoints`/`resultKey` are byte-identical to their old inline form.

**What stayed in `ui.js` on purpose, and why it isn't a rule:** the moment-to-moment `round.phase`
choreography WITHIN a hole (`'intro'` -> `'address'`/`'putt'` on the camera's intro tween ending
or a skip tap, -> `'flight'` on `_fireShot()`, back to `'address'`/`'putt'` on landing) is driven
by camera-tween and meter-tap TIMING that has no meaning without a renderer or a clock a human is
tapping against - it cannot run headlessly regardless of which file it lives in, and the user's
own scope for this part ("strokes, penalties, max-strokes, wind roll, points, hole advance,
serialize/restore") does not name it. `round.club`'s one direct write outside `game.js`
(`_toggleClubRow`'s manual pick) is the same kind of exception: it is the PLAYER's choice being
recorded, not a rule being applied.

### Two real bugs found while doing the move, both fixed

1. **`_beginAddress()` used to overwrite `round.club` with the auto-selected id**
   (`this.round.club = this.round.club || autoSelectClub(...)`), even when the player had never
   overridden it. Harmless in practice (`_currentClub()` already computes the same fallback at
   READ time, so nothing displayed differently) but it defeated the state contract's own
   `club: null = auto` meaning the moment address began, and mattered once persistence needed to
   tell "auto" and "override" apart for the resume check below. Removed; `round.club` now stays
   `null` until the player actually taps a club in the row.
2. **The persisted `round.phase` lied after every non-holing shot.** `_applyResult` autosaved
   once, immediately after `_fireShot()` had already set `phase: 'flight'` - and nothing saved
   again once `_beginAddress()` set it back to `'address'`/`'putt'` for the next shot. A save
   taken while the player was standing at address (the ordinary "close the app mid-shot" moment)
   carried a stale `'flight'`. It happened to still resume correctly (`'flight' !== 'intro'` took
   the same `_beginAddress()` branch a genuine `'address'`/`'putt'` save would), but by accident,
   not by design - and the user's resume ask ("the same shot") deserved the real answer, not a
   coincidence. Fixed by autosaving at the end of `_beginAddress()` too.

### Round summary (§13.5), reachable for the first time

`_showRoundSummary()` is new: the 9-hole + Total table, the "Skill level before -> after" line,
Play again / Back. It reuses `golf.css`'s `.gf-summary` rules, written ahead of need in Part 4.
**"Before" is read from `js/game-stats.js`'s `loadStats()`, read-only** (`st.games.golf.gf.points`
if present, else 0) - `recordGolf()` itself is Part 7's file (`js/game-stats.js` is outside this
part's `game.js`/`ui.js` scope), so no golf history exists to read yet and "before" is honestly 0
today. Once Part 7 wires `recordGolf`, this same read starts reporting real numbers with no
further change here - deliberate, not a placeholder to remember to come back for.

### Verification

`node golf/js/test.js`: 81 passed, 0 failed (74 from Parts 1-2 plus new test 6, `holePoints` for
d = -3..3). A scratch Node script (not committed) drove a full 9-hole round through `game.js`
directly with the real physics engine (crude "auto club, full power, straight at the pin" shots,
no putting finesse) and reached `phase: 'summary'` in 65 shots with all 9 holes scored. It also
round-tripped a mid-hole round through `JSON.stringify`/`restoreRound` and confirmed ball
position, lie, wind, club override, current hole, strokes-per-hole and phase all survive exactly.
Browser: one real shot played via the actual UI's tap sequence, the resulting save read from
`localStorage`, the page fully reloaded (not just re-mounted), Resume tapped, and the resumed
round's state compared byte-for-byte against the pre-reload save - identical. See the Part 5
report for the actual serialized round object and the resume comparison.

## part6-fixture

`golf/tools/refixture.mjs` (new) generates `golf/courses/harbor/fixture.json`: 6 shots per hole
(54 total for Harbor's 9 holes) - tee shot with driver/3w/5i at power 1.0/0.8/0.6 aimed at the
hole's own `target` ("aim 0" = straight at the natural aim point, the same convention `ui.js`
and test4 already use, not literal `dirDeg: 0`); one shot from `target`, auto-selected club for
the lie actually found there, aimed at the pin, power 1.0 (mirrors test4's reachability leg 2
exactly); two putts, from 3m and 8m short of the pin, power 0.3, aimed at the pin. The powers and
aim points are fixed choices for REPRODUCIBILITY, not a claim that these are good golf shots -
test8 only checks that physics.js still produces the same `rest` for the same recorded input,
never whether the input scores well. Terrain is built once per hole and reused across its 6
shots (safe: `simulateShot` builds its own fresh `CANNON.World` per call, so nothing shared
between shots on the same hole carries state across them - this is not the "fresh terrain per
measurement" reproducibility scare from Part 2's tuning-script work, which was about REUSED
physics bodies/generators, not immutable terrain data).

Test 8 (`golf/js/test.js`) replays every recorded shot through `simulateShot` and asserts `rest`
within 0.02m, printing hole/shot-index/expected/actual on any failure. `golf/js/test.js` is also
now wired into the repo-root `run-all-tests.mjs`'s engine-suite list (`golf/js/test.js`), the same
way every other game's engine suite already is - not itself in Part 6's file list, but its own
"Done when" column names `run-all-tests.mjs green` explicitly, and golf had no way to affect that
file's outcome until this one line existed.

**Verification**: `node golf/js/test.js` run FIVE times in a row, output byte-identical every
time (`136 passed, 0 failed`, zero FAIL lines) - confirms `simulateShot`'s determinism (already
proven per-shot by Part 1's test2) holds across the whole fixture, not just one input.
**H3's reachability test (test4) never flickered across any of the five runs** - per the
instruction, its fairway width stays at 36; nothing was widened.

**`node run-all-tests.mjs`: golf's own suite is green (136/136); two failures elsewhere are
unrelated to golf** (one pre-existing Skeeball machine-spec finding on `brickcity`, out of scope
per root CLAUDE.md's "Answer about the game you were asked about"). The other is
`test-game-conventions.mjs`, which auto-discovers game folders from disk - it has been checking
`golf/` (and finding it wanting) since the folder first existed in Part 3, regardless of anything
this part did; wiring `golf/js/test.js` into `run-all-tests.mjs` did not create this, it only
made it visible in the same run. Two findings, one fixed, one left for its own scheduled part:

- **Fixed now**: `golf/css/golf.css`'s `.gf-cell__num` (the scorecard's hole-number micro-label)
  was `font-size: 10px`, under `docs/BUILDING-A-GAME.md`'s 11px UX-floor minimum. No sequencing
  reason to defer a one-line, zero-layout-impact fix; raised to 11px, re-verified in the browser
  at 393x773 (scorecard strip unchanged, no clipping) and against `test-game-conventions.mjs`
  directly (that check now passes for golf).
- **Left alone, correctly**: "every game folder has its own CLAUDE.md" still fails for
  `golf/CLAUDE.md` - that file is explicitly Part 8's, not Part 6's, in §14's own table. Writing
  it now would be doing Part 8's work early and out of the order the handoff itself set. So
  `run-all-tests.mjs` cannot be FULLY green until Part 8, through no fault of this part's work;
  said here plainly rather than glossed over.

## part7-hub-wiring

Every shared file in §14's Part 7 row got the shape its most similar existing game already uses
(Battleship for `game-stats.js`/`players-agg.js`/`game-stats-ui.js`, Skeeball for
`admin-config.js`), per the instruction, not a fresh design. One `js/CLAUDE.md`-documented
maintenance edit came with it: `test-admin-config.mjs`'s shape-normalizer assertions hardcoded
the pre-golf config shape and broke the instant `normalizeConfig()` grew a `golf` branch (5
failures, all "expected {...no golf...}, got {...with golf...}"); fixed by updating those 4
literals and adding a "the golf course state" block mirroring "the three machine states" -
59/59 green after, 0 before the fix and 40/45 with it half-applied. This is maintenance on a
regression this part's own edit caused, not scope creep into a file outside the Part 7 list.

**Two real gaps, stated plainly rather than glossed over - neither is in Part 7's or Part 8's
file list, and both block a literal read of "My Stats and leaderboard show golf" until someone
does them:**

1. **Nothing calls `recordGolf` anywhere.** `golf/js/ui.js` is not in §14's Part 7 row (only the
   shared files are), so the round-summary screen built in Part 5 still just clears the save and
   returns to setup - it never records a result. Every shared-file consumer built this part
   (`golfScreen`, `golfPointsAt`, the players-agg merge branch, the GAME_META row) is verified
   correct against SYNTHESIZED data (see Verification below) but will show nothing for a real
   player until `_showRoundSummary()` gets one `recordGolf(round.difficulty, {...})` call. This
   is the same shape as Part 4's own interim scaffolding, just one file-scope boundary later.
2. **`golf/js/ui.js` does not read course release state at all**, so the admin page's future
   "flip Harbor Links to Open" control (§14: `js/admin-config.js`'s `golf.courses`) has nothing
   to flip yet. The resolvers (`resolveCourseMode`/`isCourseReleased`/`isCourseTesting`/
   `courseMode`) are built, pinned by `test-admin-config.mjs`'s new "the golf course state"
   block, and mirror Skeeball's board resolvers exactly - but Skeeball's equivalent "wiring"
   block in that same test (checking `skeeball/js/ui.js` actually calls the resolver at its
   unlock gates) has no golf counterpart, because there is nothing to check yet. `js/admin-ui.js`
   (the admin page itself) is also untouched - not in Part 7's file list either.

Both gaps are additive, one-call-site fixes whenever golf's own files are back in scope (most
likely Part 8, or a dedicated follow-up before Ship) - nothing built this part needs to be
redone, only connected to.

### Shared-file edits, what changed and why

- **`js/game-stats.js`**: `'golf'` appended to `GAMES` (the generic per-game stub loop then
  creates `st.games.golf` for free); `ensureGf(g)` (verbatim from §11) placed beside `ensureBs`/
  `ensureSk`, called from `normalize()` after `ensureSk`; `recordGolf(difficulty, extras)` placed
  immediately after `recordBattleship`, verbatim from §11 with `loadStats`/`persist`/`bumpTotals`/
  `normDiff` (the file's REAL helper names - `saveStats` in the spec's pseudocode is actually
  `persist`, internal, not exported).
- **`js/players-agg.js`**: `'golf'` appended to the `SOLO` set (Golf has no opponent, same class
  as Ball Run/Snake/Hill Climb/Pinball/Skeeball). A `g === 'golf' && src.gf` merge branch inserted
  between Battleship's and Skeeball's: counters add, `longestDriveYd` takes Math.max,
  `bestRoundByCourse` merges per-key with Math.min - this repo's first per-key-Math.min map (no
  Battleship-style zero-sentinel needed: a course absent from the map means "never played",
  since the lowest possible 9-hole score is 9, never 0).
- **`js/game-stats-ui.js`**: `golf` added to `TABS` (not `devOnly` - the hub tile ships visible;
  the per-COURSE testing gate is what actually restricts play) and to `UNIT_KEY`
  (`lb_unit_points`, reusing Pinball/Skeeball's existing key). `hasPlays()` gained a
  `rec.gf.rounds` branch. New `golfScreen(rec)` (Skill level signed and first, then Rounds/Avg
  strokes/Birdies/Eagles/Aces/Longest drive in one `.gs-tallies is-4` grid - reused verbatim, no
  new CSS - then a `.gs-grid` table of `bestRoundByCourse`, the same table component `diffTable`
  already uses) plus a small hand-maintained `GOLF_COURSES` name map (mirrors `SK_MACHINES`:
  this file stays out of `golf/`'s own folder, so it can't import the course registry). Wired
  into `screenFor`.
- **`js/leaderboard-ui.js`**: `{ id: 'golf', labelKey: 'game_title_golf' }` appended to
  `GAME_META` (flat shape, no extra fields - confirmed by reading the whole array). New
  `golfPointsAt(g)` (mirrors `skPointsAt`'s lifetime branch, no machine argument - golf has one
  course and no tier axis this screen slices by) wired into `gameMetricAt`'s dispatch.
  `ALL_IDS`/`COMP_IDS`/`SOLO_IDS`/`unitKeyOf`/`UNIT_TO_SORT_LABEL` all needed zero changes here -
  they auto-derive from `GAME_META` and from `players-agg.js`'s `SOLO` set (already updated) and
  `game-stats-ui.js`'s `UNIT_KEY` (already updated, and `lb_unit_points` already maps to
  `lb_sort_points`, reused).
- **`js/admin-config.js`**: `normalizeConfig()` extended to parse/pass through `golf.courses`
  (was silently dropping it before - `refreshAdminConfig()` reads the whole node off the wire
  fine, but the normalizer only named three of what would have been four branches). Five new pure
  resolvers mirroring the Skeeball board ones exactly, MINUS the `codeDefault` parameter - a
  course has no code-side "adminOnly" flag to fall back to; §14 says "Missing key -> testing"
  unconditionally: `resolveCourseReleased`, `courseOverride`, `resolveCourseTesting`,
  `courseTestingOverride`, `resolveCourseMode`. Three cache-reading wrappers
  (`isCourseReleased`/`isCourseTesting`/`courseMode`) and one writer (`setCourseMode`, reusing
  the existing `MODE_FIELDS` table verbatim - it was already generic). All nine added to the
  default export. Top-of-file shape comment updated with the new node shape and the
  no-`codeDefault` deviation, stated explicitly so a future session doesn't "fix" it back to
  match Skeeball's signature.
- **`js/hub.js`**: the exact `GAMES` entry from §14, appended after Pinball. `released` left
  UNSET on purpose (Part 8 owns that date, per its own row in the table) - a placeholder date
  would trip `test-new-badge.mjs`'s "every released date that IS present parses" scrape for no
  reason, and an absent field is already the safe default `new-badge.js` expects. No `devOnly`
  (matches §14's own snippet) - the per-course testing gate is what restricts play, not this
  game-wide switch.
- **`js/game-art.js`**: `GAME_ART.golf`, ~7 SVG elements per §14's brief (full-bleed `#2E7D4F`
  rect, a lighter fairway path curving bottom-left to a green circle upper-right, a `#ffce3a`
  flag on the green, a white ball bottom-left) - deliberately plain next to Skeeball's ~90-element
  cabinet art; the brief asked for "~12 elements," not a second machine portrait.
- **`js/strings.js`** ("shared strings"): `game_title_golf` (EN/ES) plus nine `gs_golf_*` keys
  for `golfScreen`'s labels (skill/rounds/avg/birdies/eagles/aces/drive/courses-heading/best),
  EN and ES both, placed beside Battleship's `gs_bs_*` block and `game_title_battleship`/
  `game_title_pinball` respectively. `lb_unit_points`/`lb_sort_points` already existed (reused,
  no new key).
- **`sw.js`**: every path under `golf/` except `tools/` (dev-only: `preview.html`,
  `refixture.mjs`, `sweep-carry.mjs`) and `js/test.js` (Node-only) added to `ASSETS`, placed
  after Skeeball's block. **One literal-reading deviation**: `golf/DECISIONS.md` was also left
  OUT, even though §14's wording ("every path under golf/ except tools/ and test.js") does not
  name it as an exception - no `.md` file appears anywhere in `ASSETS` for any of the other 20+
  game folders, each of which has its own CLAUDE.md/handoff prose never precached, and
  `golf/courses/harbor/fixture.json` (also not excluded by the wording, and included) confirms
  the rule was written with code/data files in mind, not docs. `CACHE` bumped to
  `game-hub-v579` - **past `origin/main`'s v578, not past the local checkout's stale v566**
  (root CLAUDE.md's own warning about two branches computing the same next number - `git fetch`
  confirmed main's real value before choosing v579). `node validate-sw-assets.mjs` regenerated
  `REST_MANIFEST` (19 entries added, 0 removed) and `version.json`; `node test-sw-strategy.mjs`
  82/82.

### Verification

`node test-game-conventions.mjs`: font-size check still green (Part 6's fix holds); only the
`golf/CLAUDE.md` gap remains, correctly Part 8's. `node validate-sw-assets.mjs`: every ASSETS
entry exists, every scanned file is in ASSETS or a documented exclusion. `node
test-sw-strategy.mjs`: 82/82. `node players-agg.test.mjs`: ALL PASS, including both of its
[KNOWN-BUG PROBE] structural checks for `golf`'s `gf` sub-counter (has a players-agg branch; is
rendered by My Stats) - the exact tripwire that caught the historical Yahtzee bug this repo's
docs cite throughout. `node test-admin-config.mjs`: 59/59. `node test-i18n-strings.mjs`,
`node test-leaderboard-rank.mjs`, `node test-stats-identity.mjs`, `node test-recorder-contract.mjs`,
`node test-stats-corrections.mjs`, `node test-stats-replay.mjs`, `node favorites.test.mjs`,
`node test-new-badge.mjs`: all green, no regressions from the `GAMES`/`SOLO`/`GAME_META`
list edits. `node golf/js/test.js`: 136/136, unaffected.

A scratch Node script (not committed) drove `recordGolf` on two simulated devices, merged them
through the real `aggregatePlayers()`, and rendered the merged record through the real
`screenFor('golf', ...)`: 3 rounds, 27 holes, 125 strokes, points 2 + (-3) = -1 (correctly
signed and merged, including a negative total), birdies/eagles/aces summed, `longestDriveYd`
took the max of 260/271, `bestRoundByCourse.harbor` took the min of 39/44 = 39 - exactly
matching §11's spec example format ("Harbor Links: 39"). Confirms the whole pipeline is wired
correctly end to end, not just structurally.

## part8-scope

Closed the two gaps Part 7's report flagged (`golf/js/ui.js` was out of that part's file list):
`recordGolf` is now called exactly once, from `_showRoundSummary()`; the setup screen now reads
`courseMode()` per course and gates Play/Resume/New round accordingly. Also: `golf/CLAUDE.md`
(this game's first, `test-game-conventions.mjs` now fully green for golf), and the actual ship -
commit, PR, merge, verified Pages deploy, and the admin-config write that puts the shipped game
into "testing."

### The practice bucket (`gf.practice`)

§14 says a TESTING course's rounds are "recorded under the same practice bucket Skeeball uses
for testing machines" - Skeeball's `sk.practice` has no golf equivalent yet, so this part added
one, mirroring it exactly: `ensureGf` grew a `practice: {}` field (courseId-keyed), `recordGolf`
gained an `extras.practice` branch that writes into it and returns before touching any real
counter (`js/game-stats.js`), `js/players-agg.js` merges it across devices the same way
`sk.practice.boards` merges, and `js/game-stats-ui.js`'s `golfScreen` shows it on its own dashed
"Practice (not counted)" row (THE LAW rule 1 - stored is not enough). This required editing
`js/game-stats.js`, `js/players-agg.js`, `js/game-stats-ui.js` and `js/strings.js` again, beyond
Part 8's literal instruction (`golf/js/ui.js` + `golf/CLAUDE.md` + the deploy) - judged
necessary because "recorded under the practice bucket" cannot be satisfied without one existing,
the same way Part 7's admin-config wiring needed `normalizeConfig()` extended to parse `golf`.

`round.practice` is decided ONCE, in `_startNewRound()`, and frozen on the round for its whole
life (persisted by `game.js`, same field-freeze pattern as `difficulty`/`seed`) - re-checking
mid-round would let an admin's later flip retarget where an in-progress round's numbers land.

### `longestDriveYd`, tracked live

§11's rule (driver/3-wood off the tee, landing fairway/green/fringe/tee) needs the FROM lie and
club of the specific shot that just resolved, which `game.js`'s round-state does not carry (only
cumulative per-hole strokes). Rather than extend the round-state contract for one cosmetic stat,
`ui.js` captures `_lastShotClub`/`_lastShotFromTee` in `_fireShot()` and updates a UI-transient
`_roundLongestDriveYd` in `_applyResult()`, reading `result.carryM`/`result.lie` directly (BEFORE
`applyShotResult` can overwrite `round.ball` with the next hole's tee position on a
hole-advancing shot). Reset to 0 on every `_startNewRound()`/`_resumeRound()` - the one accepted
cost is that a resumed round cannot recover a drive hit before the app closed. See
`golf/CLAUDE.md`'s "Two accepted, documented limitations" for this and the second one (a narrow
close-during-the-final-flash window that can skip recording a round, never double-record one).

### Course-mode gating on the setup screen

`_courseLockInfo(course)` resolves `courseMode(course.id)` plus (for `unlockable`) whether the
PREVIOUS course in `COURSES` order has a `bestRoundByCourse` entry - vacuously true for index 0,
so Harbor Links needs no prerequisite. A locked tile greys (`data-locked="true"`, CSS already
built in Part 4) and shows the same lock glyph `gs_sk_locked`'s screen uses. **Resuming an
already-saved round is never blocked by the CURRENT lock state** - only starting a NEW round is;
verified live (see below) with a real saved round on a course an admin had since locked back to
testing, where the setup screen showed "Locked" for the tile but Resume still worked.

### A real bug, found only by the browser + My Stats check the instruction asked for

`js/game-stats-ui.js`'s `headlineOf(id, rec)` - the function behind the game-LIST row's headline
number (`gameListHTML`, separate from `golfScreen`'s own detail-screen tallies) - had no `golf`
branch. It fell through to the generic default, `record(rec.total).wins`, which reads 0 for any
round with a negative Modified Stableford total (golf's `bumpTotals` "won" flag is `points >=
0`). A round that scored -3 showed "0 points" in the game list while `golfScreen`'s own detail
screen (drilled into from the same row) correctly showed "-3". Part 7's headless smoke test never
exercised `gameListHTML`/`headlineOf` at all - it called `screenFor` directly - so this survived
until a real round was played in a real browser and the actual My Stats screen was checked, per
this part's own instruction. Fixed: `headlineOf` now has a `golf` branch reading `gf.points`,
signed the same way `golfScreen` already formats it. Verified live, before/after, in the same
browser session (screenshots in the session transcript, not reproduced here).

### The deploy

Committed to `claude/leaderboard-skeeball-points-headline` (golf/ plus the ten shared-file edits
across Parts 6-8; every other file in a shared, concurrently-edited working tree was left
untouched - `git add` by explicit path, never `-A`). Pushed, PR #343 opened. The PR conflicted
with `origin/main` in exactly `sw.js`/`version.json` (a concurrent Skeeball session's own
already-merged CACHE-adjacent edits) - resolved in an ISOLATED worktree on a throwaway branch
(never touching the shared working tree's other uncommitted, unrelated changes), by keeping this
branch's `CACHE` bump and re-running `node validate-sw-assets.mjs` against the merged file set to
regenerate `REST_MANIFEST`/`version.json` correctly. Pushed the resolution to update the PR
branch, merged #343, and watched the `pages-build-deployment` run for the merge commit
(`263651c`) to `status:completed`/`conclusion:success` before calling anything live.

**Shipped in TESTING state, per the instruction**: `setGameLive('golf', false)` written from the
real deployed origin (not localhost - dev-origin writes are blocked entirely, opt-in or not,
this is why the write happened from `mpowell95.github.io`, never from a dev server), verified by
the write's own fresh-re-read AND by a second independent `isGameLive('golf', true) === false`
check AND by reloading the real launcher and confirming the Golf tile is gone for a non-dev
profile. `released` stays unset in `js/hub.js` (Part 8 owns the field, but not the value yet -
that is the day Harbor Links itself flips to Open, per the instruction). The course-level
`golf.courses.harbor` key is still absent from admin-config (defaults to `testing` per §14's own
"missing key -> testing" rule), so the game-level AND course-level gates currently agree by
construction, not by two separate writes needing to match.

## part9a-layout-visuals-camera-map

`GOLF-PART9.md` sub-part 9A (2026-09-03). Four areas, each with the one thing worth recording.

### 9A.1 Safe area and the hub's back pill

The doc puts the safe-area padding on `.gf-root`; it is on **`.gf-play`** instead. `.gf-play`
is `position: fixed; inset: 0`, so padding on the in-flow `.gf-root` could never reach it - the
same reason the Part 4 `.gf-root` fix exists. Band heights are measured below that padding, as
asked. One addition beyond the doc: `padding-top` is `max(env(safe-area-inset-top), var(--gf-hub-
pad))`, with `--gf-hub-pad: 54px` set by `ui.js` only when mounted in the hub. The hub draws its
pill at `max(safe-area-top, 54px)` (`css/hub.css`), so with pure `env()` padding a NO-notch device
(desktop, some Androids) would put the pill at y=54 over a scorecard that starts at y=56. Matching
the hub's own formula keeps the pill inside the reserved 104 x 56 box everywhere; on a notch
phone the two are identical. The game's own `.gf-back` now renders only standalone (no hub pill
to duplicate); in the hub the slot is empty, per the doc's "remove any duplicate".

Verified in the real hub at 393 x 852 with `getBoundingClientRect()`: pill 10,54-80,91, inside
the slot 0,54-104,110; scorecard 110-154; overlaps with every game element: none. Bands below the
54 px padding: top 56, card 44, view 515, bar 50, meters 133 = 798 + 54 = 852.

### 9A.2 Sky, lighting, ground, trees

As specified. The one gotcha: `.gf-root .gf-view canvas { width:100%; height:100% }` (the 3D
canvas rule) also matched the new minimap `<canvas>` and made it fill the whole view (higher
specificity than `.gf-root .gf-map`) - caught by the first rect measurement, fixed with
`canvas:not(.gf-map)`. Belt trees additionally skip FAIRWAY (not in the doc's list): a dogleg's
inner corner puts the offset point on the next segment's fairway, and a tree on the fairway
would be a collision-less ghost standing on the mowed grass.

### 9A.4 Aiming camera - the FOV is horizontal, and the pitch comes from the 30% rule

The doc's table ("FOV 50", `B - 16a + 9y`, look `B + 70a`) and its sentence "the ball stays fixed
on screen at 30% up from the bottom" only agree if that 50° is the HORIZONTAL field of view:
three.js's `fov` is vertical, and with a vertical 50° the ball projects at ~3% from the bottom.
With 50° horizontal at a phone's portrait aspect the ball lands at 30% - so that is what the
author computed with. Implemented as `applyHFov(camera)` (vertical fov derived from the aspect
on every resize) AND `_lookFor30()`: the camera's pitch is derived from "ball at 30% up" rather
than from the nominal lookAt, so the rule holds at every aspect, including the hub's view band
(393 x 515), where the nominal lookAt alone would have put the ball at ~14%. Position is exactly
the doc's; only the pitch is derived. Confirmed on screen: ball at 69.5% down the view = 30.5%
up. Address 0.6 s, aim-change orbit 0.25 s, clearance floor 1.0 m.

### 9A.5 The minimap is mirrored in x, deliberately

A three.js camera looking along +z has world +x on its LEFT (right = forward x up = (-1,0,0)),
and hole 1's water at x = -60..-30 duly renders on the RIGHT of the 3D view. The first minimap
draft mapped world +x to map-right, so the water sat on the map's LEFT - the map and the view
were mirror images, and "tap left of the fairway" would have rotated the view RIGHT. `_rot`
negates u (and `_unrot` un-negates it), so world +x draws to the map's left, matching the 3D.
Verified by counting blue pixels per half of the map canvas: left 0, right 1036. The map tap
itself: aim-line mean x went 0.495 -> 0.452 of the map width after a tap at 22% across, and the
3D view swung left (screenshot in the 9A report).

### A pre-existing tap bug, found by the harness

The view's `pointercancel` handler shared `onUp`'s tap test, so a cancelled pointer that was
short and still counted as a TAP and advanced the swing - my synthetic pointerdown/pointercancel
pair (meant to reveal the aim line without swinging) locked the aim before the map-tap test, and
the tap did nothing. Real fingers can trigger it too (a system edge swipe cancels the pointer).
`pointercancel` is never a tap now. Part 4 shipped it; nobody had noticed.

### Verification

`node golf/js/test.js` 136/136 (trees are visual-only; the fixture is untouched). `node
validate-sw-assets.mjs` (minimap.js added, 393 entries). In the real hub at 393 x 852, dark
mode: no overlap between the pill and any game element; daytime sky; trees line hole 1's fairway;
from the tee the water (right), the green and the bunkers at the far end are in the address
view; the minimap shows the hole with the aim line; tapping the map left of the fairway rotates
the view left; toggling every overlay (club row open/closed, flash, distance counter, map
hidden/shown) moved no band by a pixel. Console: no golf errors (the hub's own `messages/`
permission-denied for an unclaimed test profile is unrelated).

### What 9A does NOT rewrite in `GOLF-HANDOFF.md`

§10.1–10.4 and §13.1's safe-area/pill paragraph are rewritten. §2 (meters), §7.3 (launch),
§13.2 and §13.6 (strings) are 9B's and 9C's and are left for them - the doc says "when done",
and those sections describe what 9B/9C will change. The handoff edited is the one Matt pointed
this build at from Part 1 (`Downloads/GOLF-HANDOFF.md`); there is no copy inside the repo.
