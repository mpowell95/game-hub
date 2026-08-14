# Skeeball handoff

Geometry and camera values are NOT repeated here. Read them from `skeeball/js/boards.js`
(`geom`) and `skeeball/js/render.js` (constructor + `resize`).

## File map

| Concern | File |
|---|---|
| World config — all dimensions, angles, speeds, hole layout, contact materials | `skeeball/js/boards.js` → `BOARDS[0].geom` |
| Geometry builder — turns `geom` into the solids both engines read | `skeeball/js/machine.js` |
| Physics — cannon-es world, capture rule, trough scoring, watchdog | `skeeball/js/physics.js` |
| Rendering — scene, board texture, hole rims, value stencils | `skeeball/js/render.js` → `_buildMachine`, `_paintField` |
| Camera — position, aim, FOV fit | `skeeball/js/render.js` → constructor + `resize()` |
| Rules — nine balls, scoring, events, snapshot | `skeeball/js/game.js` |
| Input — swipe → power/aim, HUD, storage | `skeeball/js/ui.js` → `_swipeEnd` |
| Engine tests | `skeeball/js/test.js` |

Bench tools, repo root, no browser needed:

| Tool | Answers |
|---|---|
| `tune-ladder.mjs` | power → score across all 101 steps; bands, flips, dead zones, touch rate |
| `measure-arc.mjs` | is the ball airborne, peak clearance, where it first lands |
| `measure-reach.mjs` | how far up the face each power gets, holes removed |
| `sight.mjs` | can the camera see the board's bottom edge over the ramp crest |

Run `measure-arc.mjs` after any ramp/board change. `tune-ladder.mjs` alone cannot see a ball
that never leaves the ramp — that is how a no-arc build shipped 2026-08-14.

## Debug overlay

**None exists.** No toggle, no flag, nothing to enable.

What stands in for it:

- `window.__skTest.ui` — live `SkeeballUI` instance, exposed by `init()` in `ui.js`. From the
  console: `__skTest.ui.game` (rules state), `.game.ball` (live physics state, `.ball` is the
  cannon body), `.renderer` (three.js scene + camera + `M` machine description).
- `__skTest.ui.game.throwBall({power, aim})` — throw at exact values, bypassing the swipe.
- Screen-space measurement is done by projecting known world points through
  `renderer.camera` with `THREE.Vector3.project`; `renderer.M.faceToWorld(u, v, h)` converts
  board coordinates to world.

If a real overlay is wanted, that hook is the place to build it from.

## Open items

**Failing assertion: "few one-step bands" (15 of 21, threshold 12).** In `test.js` block 3.
Everything else passes (52 of 53). What it means for play: the dial's four scoring bands are
wide and in order, but the boundaries between them are ragged — a swipe landing near a
boundary can flip between neighbouring values on repeat. Not randomness; a player feels it as
"that one was borderline", not "I have no idea what that will do". Regressed when the board
went 32° → 45°: flips per 100 power steps went 3 → 27, now 20 after the widening pass. Cause
is the steeper board compressing the landing zones. Accepted deliberately for target
readability.

**Screen-space checks not met** (targets are in chat history, not code):

| Check | State | Why |
|---|---|---|
| Hole width as % of board | 19% vs 28–32% target | Arithmetic: hole diameter ÷ board width. Was 30.6% only because the board was narrower. 30% needs radius 0.15 and spacing ~0.34, i.e. a ~1.3 m board |
| Rim gap in px | 3.4 vs ≥6 | World gap is ~0.011 m. Needs spacing 0.24, or the painted-ring multiplier at 1.02 |
| Board vertical extent | 16.5% vs 32–40% | Board foreshortens to ~half its width; making it taller means looking down at it |
| Board top at canvas top | y 191 | No camera puts the board's top at the canvas top AND the resting ball at the bottom. Solved for explicitly |

Last two are the same constraint: a lane that reads as receding and a board that fills the
frame want opposite cameras.

**Not started** — camera pixel targets, screen chrome (score bar / record strip), record-strip
columns, palette. Spec sections 5–8.

**Stale content:**
- How To Play (`howto.js` + `strings.js`) describes the pre-2026-08-14 game. Every claim on it
  was measured false. Diagram shows neither the 10 nor the 100s.
- `msg_returned` ("Too soft. Have it back.") is unreachable — `minSpeed` starts where the 20
  starts, so nothing rolls back on this machine. Path still covered by a synthetic board in
  `test.js` block 6.

**Other:**
- `devOnly: true` in `js/hub.js`. Only the profile name `MattyIce` sees the card. Dropping the
  flag is the whole of "release it".
- `reference/skeeball` (file) and `reference/Skeeball/` (directory) collide on Windows — the
  seven reference videos cannot be checked out there and git reports them deleted. Do not
  commit that deletion.

## Dead ends — do not retry

| Tried | Rejected because |
|---|---|
| Magnetism — a pull toward the 20 for slow balls ("the dish") | Standing permanent ban. A ball goes where it was thrown. Deleted from `physics.js` section 5. Widen bands in geometry, never by moving the ball |
| Launch angle below the board angle | No arc is possible at any power. Range on an incline goes to zero at launch = board tilt and negative below it. Ball meets the bottom edge and rolls, always |
| Launch at the range-formula optimum (board + (90−board)/2) | Optimum assumes an infinite plane. This cabinet has a roof: the arc peaks ~half the board's length above it and hits the cage and front glass |
| Shortening the ramp to lower its crest | Too little ramp for the ball to settle onto the launch angle. 34 flips / 42% repeatable, against 6 / 88% with the full-length ramp |
| Raising `maxSpeed` so max power scores nothing | Backboard catches every overshoot and drops it back into the top cups. No hard-end zone appears at any speed up to 7.6 m/s |
| Livelier backboard (`deadRest` up) for the same goal | More flips, still no hard-end zone |
| Shrinking the top cup so overshoots miss it | Turns the top 26–32 steps of the dial into a flat 10 — the exact defect the rebuild removed |
| Ring height 0.055 at 0.22 spacing | Rim-to-rim gap becomes a pocket. 20 of 451 throws needed the jam watchdog, six over 9 s, one hit the 12 s cap. 0.028 gives 3 of 451 |
| Deep cup collars generally | A rolling ball must cross the rim of every hole below its target. 34 flips with 20 mm walls vs 17 with none, identical geometry otherwise |
| Big ring as a solid wall (`ring.solid: true`) | Fences the cup cluster off. A rolling ball stops dead on its front arc; only route in is over the top |
| Number plates on the cup walls | Flat plane at `radius * 0.995` inside a curved wall of that radius — they interpenetrate and the wall bites the bottom off every digit |
| Values stencilled up-slope of each hole | Works only while holes are small. At radius 0.095 the painted rim passes the label offset and every centreline number renders under its own ring |
| Framing the camera to the marquee, or to the ball's angular size | Both squash the board into a strip with a large dead band above it. Frame from the ball at the bottom edge, aim below the board |
| Board:ball at 6.2:1 with a 72%-of-screen board | Needs a 9.15 m camera at 5032 px focal — telephoto, lane loses all convergence. Board is 10:1 for this reason; do not "correct" it toward realism |
| Hole radius 0.115 at 0.18 spacing | Adjacent holes overlap by 0.05 m |
