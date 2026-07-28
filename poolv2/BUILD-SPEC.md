# Poolv2 — Build Spec

**Audience: a fresh session with zero memory of this build.** This is the document to work from
if you are building this game again from nothing, rebuilding a part of it, or extending it. It is
deliberately more prescriptive than `poolv2/CLAUDE.md`, which records what was decided; this one
tells you *what to build, in what order, and why each choice is the one to make*.

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk. THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`
> (full rationale in `js/CLAUDE.md`). Everything below about storage keys, autosave and stats is
> subordinate to it: writes additive, keys never repurposed, no silent write failures.

### The name, before anything else

The game is **Poolv2** and every identifier in this document uses that namespace: folder
`poolv2/`, hub id and stats id `poolv2`, keys `gamehub.poolv2.*`, room tag `'poolv2'`, CSS prefix
`.p2-`. There is a **second, separate pool game in development**, and the plain `pool` namespace
is reserved for it. If you are building from this spec, do not "clean up" the name and do not
reach for `pool` anywhere — a collision in the folder, the stats bucket or the injected
stylesheet is exactly what this naming prevents. Full rationale: `poolv2/CLAUDE.md`, "The name".

### Provenance of this document

The original brief was a chat-supplied document called **"Pool App: General Build Guide."** It is
not checked into this repo and does not appear anywhere in git history — it lived in the session
that built the game. What survives of it is quoted verbatim inside the code and in
`poolv2/CLAUDE.md`, in roughly twenty inline citations ("per the build guide's item 3", "build guide
§4, no hidden randomness", "the build guide's explicit ask", and so on). Sections 1-4 below
reconstruct its requirements from those citations plus the two lines quoted directly in the task
that commissioned this file. Where a requirement is a reconstruction rather than a quotation, it
is marked *(reconstructed)*. If you have the original guide, it outranks this document on intent
— but not on the code facts, which were read directly out of the tree.

---

## 1. What "done" looks like

Two sentences from the original guide govern everything else. Both are quoted directly.

> **"If someone who shoots well in a bar can pick this up and get the shots they expect, the app
> succeeded."**

> **"Physics first, everything else is decoration."**

Read the first one carefully, because it is a *falsifiable* acceptance test and not a vibe. It
says nothing about photorealism, table skins, particle effects, or trick-shot modes. It says a
person with real-world cue skill must be able to transfer that skill into this app and be right.
Concretely, that means all of the following must be true, and each of them is a thing you can go
and check:

- **A stop shot stops.** Center-ball hit, straight into an object ball, and the cue ball parks.
- **A draw shot comes back.** Hit below center, the cue ball reverses after contact.
- **A follow shot follows through.** Hit above center, the cue ball rolls on through the contact.
- **The 30-degree rule roughly holds.** A rolling cue ball leaves a cut shot at approximately
  30 degrees from its original line, because the tangent line and the retained roll combine — you
  do not code this rule, you get it for free if the collision and friction models are right.
- **Cut shots throw slightly with english.** Side-spin nudges the object ball off the pure line of
  centers, in the direction a real player expects.
- **A hard rail hit rebounds shorter than a soft one.** Cushions eat proportionally more energy at
  speed.
- **Aiming feels the same twice.** The same aim and power produce the same result, always.

The second sentence is the tie-breaker rule for every design argument you will have with yourself
during this build. **When realism and convenience conflict, realism wins in the model and
convenience is bought back in the interface.** You do not clamp a ball's path so it "makes the
shot." You do not special-case the 8-ball's trajectory. You do not add an aim assist that lies. If
a shot is hard, it is hard, and the help you give the player is a better aiming *control* (fine
mode, a longer aim line) — never a corrected *outcome*.

There is a corollary worth stating explicitly, because it is the one a fresh session is most
likely to violate under time pressure: **decoration is allowed to be cheap.** The felt is a flat
green rectangle. The balls are flat filled circles with numbers. The "behind the cue" camera is a
CSS `rotateX()` that does not touch the coordinate system. None of that is a defect — it is the
rule being applied correctly. Spend the budget on the model.

---

## 2. The physics model

Everything in this section lives in `poolv2/js/physics.js`, which is **pure and headless**: no DOM,
no `import.meta`, no browser globals. That is load-bearing three times over — it lets the AI run
lookaheads by calling the same engine, it lets a future test suite run under plain Node, and it
makes the multiplayer design in §5 possible at all.

**Units are SI throughout: meters, seconds, kilograms, radians.** Do not mix in pixels. The one
place pixels appear is the UI's `_scale` (pixels per meter), used only for drawing and pointer
translation.

### 2.0 The two published sources, and why they matter

The model follows **Marlow, *The Physics of Pocket Billiards* (1994)** and **Dr. Dave Alciatore's
technical proofs at billiards.colostate.edu**. This is not academic decoration. It is the reason
the acceptance test in §1 passes without tuning: those sources describe what a real ball does, and
if you implement them faithfully, draw/follow/stun/throw emerge on their own. The build guide's
instruction was explicit — ground the model in published billiards physics rather than tuning
constants until a shot "felt right." **Every constant below is a published-range value with a
stated meaning. If you find yourself nudging one until a shot looks nicer, you have left the
method and you should stop and find the modeling error instead.**

### 2.1 State: what a ball is

```js
{ id, x, y, vx, vy, wx, wy, wz, kind, number, pocketed, moving }
```

Position and velocity are 2D (the table plane). Angular velocity is **3D and it has to be**:
`(wx, wy)` is the rolling axis lying in the table plane, and `wz` is the vertical axis — english /
side-spin. Games that store a single scalar "spin" cannot produce draw, follow and english as
separate effects, which is exactly the failure mode the guide's acceptance test catches.

Ball radius `R = 0.028575` m (a standard 57.15 mm ball). `G = 9.81`.

### 2.2 The cloth model: slip, slide, roll

This is the heart of it, and it is the one part you must get right before anything else works.

A ball on cloth is not simply "decelerating." The contact point where ball meets cloth has its own
velocity, the **relative slip velocity**, and the ball behaves in two completely different regimes
depending on whether that slip is zero.

Alciatore's standard formula, with `ẑ` the table's up-normal:

```
u = v + R·(ẑ × ω)
```

Expand `ẑ × ω` for `ω = (wx, wy, wz)`: it is `(-wy, wx, 0)`. So in code:

```js
function slip(b) {
  return { x: b.vx - R * b.wy, y: b.vy + R * b.wx };
}
```

Setting `u = 0` and solving gives **natural roll**, the spin at which a ball rolls without
slipping:

```js
function naturalRollSpin(vx, vy) {
  return { wx: -vy / R, wy: vx / R };
}
```

Now the two regimes, both in `stepBall(b, dt)`:

**Sliding (`|u| > SLIDE_EPS`).** The cloth applies friction opposing the *slip direction*, not the
velocity direction — that distinction is what makes draw work. Linear deceleration is
`μ_slide · g` along `û`. The same friction force applies a torque that spins the ball toward
natural roll at

```
α = 5·μ_slide·g / (2R)
```

which is `torque / I` with `torque = μmgR` and `I = (2/5)mR²` for a uniform sphere. In code:

```js
const aLin = MU_SLIDE * G;
b.vx -= aLin * ux * dt;
b.vy -= aLin * uy * dt;
const spinRate = (5 / (2 * R)) * MU_SLIDE * G;
b.wx += -spinRate * uy * dt;
b.wy +=  spinRate * ux * dt;
```

**Rolling (`|u| ≤ SLIDE_EPS`).** Friction collapses to the much smaller rolling resistance
`μ_roll · g` opposing velocity, and spin is *re-locked* to natural roll each step so the ball
cannot drift out of the rolling regime through accumulated float error.

**Side-spin decays independently, in both regimes.** `wz` is not touched by the slide/roll split;
it bleeds off under its own spin-friction term at `5·μ_spin·g/(2R)`, floored to exactly zero when
one step would overshoot (so english dies cleanly instead of oscillating around zero).

**Masse / curve.** Only while sliding, and only when `|wz|` is meaningful, a small lateral
acceleration perpendicular to velocity is applied, scaled by `CURVE_COEFF · wz · 0.002`. This is
the first-order approximation, not a full 3D treatment, and it stops the instant the ball starts
rolling — which is physically right: a curving ball straightens out once it takes natural roll.

**Stopping.** A ball is parked (all velocity and spin zeroed, `moving = false`) only when linear
speed is under `STOP_V` **and** roll spin under `STOP_W` **and** side-spin under `STOP_W`. Do not
simplify this to a speed check alone: a ball spinning in place with no translation is a real state
and it must be allowed to sit there and decay.

Integration is explicit Euler, position last: `b.x += b.vx * dt` after the velocity update.

### 2.3 The cue-strike model

`strikeCueBall(cue, dir, power, offset, elevation)`. This is the entire interface between the
player's intent and the physics. Four inputs, and they are also exactly what multiplayer transmits
(§5) — that is not a coincidence, design it this way from the start.

- `dir` — unit aim vector `{x, y}`.
- `power` — initial cue-ball speed in m/s (the UI's usable range is 0 to 4.2).
- `offset` — `{a, b}`, where the tip contacts the ball face as a fraction of `R`. `a` is
  side/english, positive to the right of the aim line. `b` is vertical, positive above center
  (follow/topspin), negative below (draw/backspin). **Both are clamped to ±0.62** — you cannot hit
  a real ball closer to its edge than roughly that without miscuing, and the clamp is the miscue
  limit standing in for a miscue model.
- `elevation` — cue elevation in radians, clamped to `[0, 0.5]`.

Three effects, in order:

1. **Squirt (cue-ball deflection).** An off-center hit sends the cue ball off *opposite* the
   offset, because of the cue tip's own moment of inertia. Implemented as a rotation of the aim
   vector by `-a · SQUIRT_COEFF` radians before anything else.
2. **Speed loss to elevation.** `v0 = power · cos(elevation)` — a raised cue puts part of the
   stroke into the cloth, not the ball.
3. **Spin from the tip offset.** Vertical offset produces a fraction `b · SPIN_GAIN` of natural
   roll spin (so `b = 1` would be pure immediate roll, `b < 0` is genuine backspin against the
   direction of travel). Side offset produces `wz = a · v0 / R · SPIN_GAIN · (1 + elevation·1.4)`
   — an elevated cue generates more english, which is why masse works at all.

**Draw, follow and stun are not implemented anywhere.** They fall out of this function plus §2.2
plus §2.4. If you find yourself writing an `if (isDrawShot)` branch, the model is wrong.

### 2.4 The collision model

`resolveBallCollision(a, c)`, equal-mass, elastic along the line of centers:

- Compute normal `n` (along the centers) and tangent `t`.
- Reject immediately if the balls are separating (`closing ≤ 0`) — otherwise a pair in contact
  jitters forever.
- Push overlapping balls apart along `n` by half the overlap each, *before* resolving velocity.
- **Exchange normal components, leave tangential components untouched.** That single line is the
  stun mechanic: a full-ball hit gives all of the striker's velocity to the object ball and the
  striker keeps nothing.
- **Throw.** Add a small tangential nudge to the struck ball proportional to the striker's `wz`
  (`0.045 · wz · closing/max(closing,1) · R`). This is friction during the brief contact, and it
  is what makes english "throw" an object ball a few degrees off the line of centers. The build
  guide asked for this by name: *"side spin ... nudges the object ball slightly off line."*

**Spin is deliberately not exchanged between balls.** The striking ball keeps its spin while
losing its velocity — and that is precisely what produces visible draw and follow: the cloth
re-engages a nearly stationary ball that is still spinning, and drags it. Do not "fix" this by
transferring angular momentum; you would delete draw.

### 2.5 The cushion model

`reflectCushion(b, nx, ny)`. The guide's requirement was that *"cushions absorb energy differently
depending on how hard you hit them,"* so **restitution is a function, not a constant**:

```js
function cushionRestitution(speed) {
  return 0.5 + 0.35 * Math.exp(-speed / 3.2);
}
```

That runs from about 0.85 at near-zero speed down toward 0.5 at high speed, matching published
COR-vs-speed curves for cloth-wrapped rubber. A fixed COR is the single most common shortcut in
hobby pool engines and it is immediately obvious to a bar player, because hard rail shots come
back too far.

Also modeled: tangential friction (`CUSHION_MU` scales the tangential component), english skewing
the rebound angle (`CUSHION_ENGLISH`), and the rail imparting *partial* roll on rebound
(`CUSHION_GRIP` — partial, because real cushion contact is far too brief to fully re-align spin),
plus side-spin loss on contact.

Cushions are four straight lines at the playing-surface edge. On penetration the ball is clamped
back to the rail line and then reflected, and the tick's `rails` counter increments.

### 2.6 Pockets

`pocketCenters()` returns six points in table-local coordinates (origin at table center): four
corners and two side pockets at the midpoints of the long rails. Capture is a plain radius test
against `POCKET_R = 1.9R`. A captured ball gets `pocketed = true`, all motion zeroed, and its id
pushed to `events.pocketed`.

Note `CORNER_JAW = R * 0.9` is exported and documented as pulling the corner capture point inward
along the diagonal, **but nothing reads it** — corner capture is currently the same plain circle
as a side pocket. See §6.

### 2.7 The tick, and determinism

`tick(balls, dt)` runs one step in a fixed order — integrate all → resolve all pair collisions →
cushions → pocket capture — and returns an event log fragment:

```js
{ hits: [{a, b}], rails: <count>, pocketed: [<ball ids>] }
```

That log is the **entire interface to the rules engine**. The rules layer never inspects
trajectories; it reads first contact, rail count and pocketed ids. Keep it that way — it is what
lets §3's rules engine stay a hundred pure lines.

`simulateToRest(balls, dt = 1/240, maxSeconds = 20)` loops `tick` until nothing moves, accumulating
the same event shape, with `maxSeconds` as a safety valve against a pathological non-settling
table.

**Determinism is a hard requirement, from the guide's §4 ("no hidden randomness"):** the same
balls, the same `strikeCueBall` inputs, and the same fixed timestep must produce identical results
every time. There is no `Math.random()` anywhere in `physics.js`, `table.js`, `rules.js` or
`hash.js`. The rack is a fixed layout, not a shuffle. This is a fairness requirement *and* the
foundation of §5 — treat any proposal to add randomness to these files as a breaking change.

The renderer must therefore drive the **same fixed step**, not a variable one. The UI accumulates
real frame time and consumes it in `1/240` s steps (capped at 40 steps per frame, with frame delta
itself capped at 50 ms) so a slow frame or a backgrounded tab cannot change the outcome of a shot.

### 2.8 The constants, in full

Copy these; do not re-derive them by feel.

| Constant | Value | Meaning |
|---|---|---|
| `R` | `0.028575` m | ball radius (57.15 mm ball) |
| `G` | `9.81` | gravity |
| `TABLE.w` / `TABLE.h` | `0.9906` / `1.9812` m | 7-ft bar box, 39 × 78 in, 2:1 |
| `POCKET_R` | `1.9 R` | pocket capture radius |
| `CORNER_JAW` | `0.9 R` | declared, currently unused (§6) |
| `MU_SLIDE` | `0.2` | cloth sliding friction |
| `MU_ROLL` | `0.011` | cloth rolling resistance |
| `MU_SPIN` | `0.044` | vertical-axis spin decay |
| `SLIDE_EPS` | `1e-4` m/s | slip below which slide → roll |
| `STOP_V` | `0.004` m/s | linear speed treated as stopped |
| `STOP_W` | `0.06` rad/s | spin treated as stopped |
| `cushionRestitution(s)` | `0.5 + 0.35·e^(-s/3.2)` | speed-dependent COR |
| `CUSHION_MU` | `0.2` | rail tangential friction |
| `CUSHION_ENGLISH` | `0.42` | english → rebound-angle skew |
| `CUSHION_GRIP` | `0.28` | roll imparted by the rail |
| `SPIN_GAIN` | `0.92` | fraction of natural roll at max offset |
| `SQUIRT_COEFF` | `0.055` | rad of deflection per unit side offset |
| `CURVE_COEFF` | `0.9` | masse curve scaler |
| offset clamp | `±0.62` | miscue limit on `a` and `b` |
| elevation clamp | `0` to `0.5` rad | ~0 to 28.6 degrees |
| throw factor | `0.045` | friction-during-contact nudge |
| fixed step | `1/240` s | physics dt, everywhere |
| `maxSeconds` | `20` | settle safety valve |
| power range (UI) | `0` to `4.2` m/s | strike speed |

### 2.9 The rack (`table.js`)

Origin at table center, `+y` toward the foot rail. `FOOT_SPOT = (0, +0.25·h)`, `HEAD_SPOT =
(0, -0.25·h)`, cue ball starts on the head spot.

Rows, apex first, growing toward `+y`:

```
[1]
[9, 2]
[3, 8, 10]
[11, 4, 12, 5]
[6, 13, 7, 14, 15]
```

8-ball in the middle of the third row; one solid (6) and one stripe (15) in the back-row corners —
a legal rack. Row spacing is `R·√3·1.005` and within-row spacing `2.01R`; **the 0.5-1% clearance
is not cosmetic**, it stops the rack from starting in mutual overlap and self-jamming on the first
tick. `1`-`7` are solids, `9`-`15` stripes, `8` is its own kind.

The rack is **fixed, never shuffled** — the no-hidden-randomness rule extends to setup, so both
seats in a multiplayer game always see the identical opening position.

---

## 3. Build order

This was the guide's own sequence: **engine → controls → one ruleset → offline opponent →
practice table → everything else.** Follow it in that order. Each step below says what this build
actually did, and what a next session should change or extend.

### Step 1 — Engine (`physics.js`, `table.js`)

Build §2 first and build it headless. Do not open a canvas yet.

*What this build did:* implemented the full slide/roll split, cue strike, collision with throw,
speed-dependent cushions and pocket capture, all pure and Node-importable, with `simulateToRest`
as the single settle function shared by rendering, AI and multiplayer verification.

*What a next session should do:* **write the test file that does not exist.** There is no
`poolv2/*.test.mjs` and no pool entry in `run-all-tests.mjs`. The engine is the most testable thing
in this repo — it is pure, deterministic, and has published expected behavior. Minimum suite:
stop/draw/follow produce the expected sign of post-contact cue velocity; a straight full-ball hit
transfers essentially all velocity; the 30-degree rule holds within tolerance for a rolling cue
ball; a hard rail hit rebounds with a lower COR than a soft one; `simulateToRest` on identical
inputs gives byte-identical output twice in a row.

### Step 2 — Controls (`ui.js` pointer layer)

Only now open the canvas. Render the table, render the balls, and wire the gesture stack in §4.

*What this build did:* one canvas, one pointer stream, the three-phase aim → pull → release
gesture, a separate spin picker canvas and a separate elevation slider.

*What a next session should do:* the guide asked for **pinch-zoom and pan**, which were deferred
(honestly, in `poolv2/CLAUDE.md`) and are still missing. This is the highest-value *feel* work left,
because fine aim on a phone is genuinely hard at full-table zoom. Note before you start: pinch is
a two-finger gesture and two fingers currently mean "fine aim mode" (§4). You must resolve that
collision explicitly in the priority table before writing any code.

### Step 3 — One ruleset (`rules.js`)

The guide's item 3: **one game mode with one named rulebook.** Not a rules framework, not a
variant selector.

*What this build did:* **"Bar Rules 8-Ball"** — a deliberately simplified BCA 8-ball:

- Ball-in-hand after any foul is **anywhere on the table**, the common bar-table variant, not
  behind the head string.
- Legal-shot gate: the cue ball's **first** contact must be a ball of the shooter's own group (or
  either group while the table is open, or the 8-ball once the shooter's group is cleared); after
  that, a ball must be pocketed **or** something must touch a rail, or it is a foul.
- Fouls: `scratch`, `no_contact`, `wrong_ball`, `wrong_ball_eight`, `no_rail`.
- Groups are assigned at the **first legal, non-foul pot of a money ball while the table is
  open**; that group belongs to the shooter for the rest of the game.
- The 8-ball: potting it early or on a foul (including a simultaneous scratch) loses instantly;
  potting it cleanly with your group cleared wins instantly.
- You keep shooting only while you keep legally potting your own group's balls (or any money ball
  while the table is open).
- Explicitly **not** implemented: 4-rails-on-the-break, called shots or pockets (beyond the
  8-ball's implicit "must be legal"), safety-specific fouls.

`resolveShot(state, events)` is **pure**: it takes the current state and physics' event log and
returns `{ state, outcome }` with a brand-new state object. `placeCueBall` likewise. Keep both
pure — it is what makes the multiplayer peer path a straight re-application.

One important scrub in `resolveShot`: a pocketed cue ball is **never persisted as `pocketed`**. It
comes back via ball-in-hand, so the flag is cleared and the ball parked until placed.

*What a next session should do:* a fuller ruleset is **a separate mode, not an edit to this one.**
If you add called shots or head-string ball-in-hand, add a second named rulebook and leave Bar
Rules alone. Also fix the rail-timing gap in §6 (#6).

### Step 4 — Offline opponent (`ai.js`)

*What this build did:* enumerate ghost-ball aims for **every legal target ball × every one of the
six pockets**; reject any candidate where the cue→ghost or target→pocket segment passes within
`1.95R` of another ball (`pathBlocked`); then **score every survivor with a real physics
lookahead** — `simulateToRest` on a cloned ball array, the same engine the player shoots with,
never a geometric approximation.

Scoring: `-50` baseline, `+100` for potting the intended target, `-200` for a scratch, `-300` for
potting the 8 when it was not the target, `+500` for a clean winning 8, minus `3 ×` the cue ball's
final distance from center (rough position play).

Power heuristic: `clamp(0.9 + 1.6·(cueDist + potDist), 0.9, 4.2)` m/s. The AI always uses a small
follow (`offset {a: 0, b: 0.15}`) and a level cue.

Skill tiers change **only the error and the pickiness, never the physics**:

| Tier | `aimErr` (rad) | `powerErr` | `topN` |
|---|---|---|---|
| `beginner` | 0.09 | 0.25 | 4 |
| `intermediate` | 0.04 | 0.12 | 2 |
| `pro` | 0.012 | 0.05 | 1 |

`topN` is how far down the ranked list the AI is willing to settle. If nothing is un-blocked, it
does not freeze — it taps the nearest legal ball softly to avoid a no-contact foul.

*What a next session should do:* three things, in order. (a) The AI is the **only** source of
randomness in the game (`Math.random()` for jitter and for the `topN` pick) — if you ever want AI
replays, seed it. (b) It is **synchronous on the main thread** and can run ~90 full
`simulateToRest` calls for one decision; on a slow phone with a full rack that is a visible
freeze. Move it to a worker or budget it across frames. (c) It never plays safeties or considers
leaving the opponent bad — the position term is one distance-from-center penalty. Real safety play
is the biggest available strength gain.

### Step 5 — Practice table

*What this build did:* `mode: 'practice'` — same physics, same controls, no rules engine at all
(`_settleLocal` returns early), no stats, plus a re-rack button in the HUD.

*What a next session should do:* practice mode currently has a real hole (§6 #3): because the
rules engine never runs, a scratched cue ball stays pocketed and the only way back is re-racking
the whole table. Fix that first, then consider what practice is actually *for* — a ghost-ball
aiming overlay and a shot-repeat button would make it a training tool rather than a sandbox.

### Step 6 — Everything else

In this build: the hub integration, multiplayer (§5), stats, i18n, autosave, the camera toggle.
Order within this step is yours; multiplayer is the one with real design content and it is covered
next.

---

## 4. Controls, as a decision record

The guide asked for the gesture priority to be **written down as a rule**. This is that rule. It
is binding: a change to any line here is a change to how the game feels, and it must be made
deliberately and re-recorded, not drifted into.

### The governing principle

**Phase decides which gesture wins — not finger count, not hit-testing, not gesture recognition.**
The table surface has exactly one pointer stream, and the module holds an explicit phase. Read the
phase first, then interpret the pointer. This is why the control layer is a hundred lines and not
a gesture-recognition library.

### The priority table

| Priority | Phase | Gesture | Result | Notes |
|---|---|---|---|---|
| 1 | ball-in-hand (`_placingCue`) | any pointer down/move/up on the table | drag the cue ball, release to place | **Outranks everything.** Aiming is unreachable until placement resolves. An overlapping spot is silently refused — release does nothing and you stay in placement. |
| 2 | idle, my turn, not simulating | first pointer down | start AIM; aim line points from the cue ball *away* from the finger (slingshot pull) | Angle snaps to the pointer's absolute angle. Fast and coarse. |
| 3 | aiming | **second** finger down | switch to FINE aim | Angle stops snapping and *integrates* pointer deltas at `× 0.22`. This is the guide's "last small adjustment." |
| 4 | aiming | first pointer **up** | arm POWER-PULL. **Does not fire.** | Aim is now locked. The release point becomes the pull origin and the pointer is re-captured. |
| 5 | pulling | drag along the aim axis | power = distance along the axis, `clamp(along/scale × 3.2, 0, 4.2)` m/s | Only the along-axis component counts. |
| 6 | pulling | drag **sideways**, `perp > 46` px | **cancel**: power → 0, back to aiming | The guide's explicit "drag sideways to cancel" rule. It must cancel, never fire. |
| 7 | pulling | release with `power > 0.15` | **shoot** | |
| 8 | pulling | release with `power ≤ 0.15` | reset, no shot | "Didn't really mean it." A light accidental tap must never fire. |
| 9 | any | pointer on the spin picker or the elevation slider | sets spin / elevation | Separate elements with their own hit areas. **Never** on the table's pointer stream. |
| 10 | any | 🎥 camera button | cosmetic view toggle | Never touches physics coordinates. |

### Rules a new session must not violate

1. **A release from the aim phase never fires a shot.** Aim and power are separate acts. This is
   the single most important line in the table: it is what lets a player aim carefully with a
   finger already down and then decide power afterwards, which is the whole reason the two-phase
   gesture exists.
2. **Sideways drift cancels; it never fires a weak shot.** A player who realizes mid-pull that the
   aim is wrong needs an escape that is not "shoot badly."
3. **Cue elevation stays off the shared gesture stream.** It is a slider, on purpose. A
   raise-the-cue drag would compete directly with aim and power on the same surface, and the
   conflict is unresolvable in a way a player can predict. If you want a gestural elevation
   control, you must first move aim/power somewhere else.
4. **Spin is a picker with its own canvas**: drag inside sets `{a, b}` in `[-1, 1]` (clamped to
   the unit circle), double-tap resets to center. It is never inferred from where on the *table*
   you touched.
5. **The camera is decoration.** Top-down is the truth; "behind the cue" is a CSS
   `perspective()`/`rotateX()` on the wrapper. The physics coordinate system does not rotate, and
   pointer-to-world translation does not change. If you build a real 3D camera, the coordinate
   translation becomes a genuine problem — solve it explicitly, do not let it leak into
   `_toWorld`.
6. **If you add pinch-zoom, you must first re-decide priority 3.** Two fingers currently means
   fine aim. Two fingers cannot also mean pinch without a tiebreak. Write the new row into this
   table before you write the code.

---

## 5. Seat model and multiplayer

### 5.1 `_localSeat()` — build it in from the first line

**Every read of "whose turn is it / did I win / which group is mine" goes through
`_localSeat()` / `_isMySeat(seat)`. No exceptions, from the first commit, before multiplayer
exists.**

```js
_localSeat() { return this.mp ? this.mp.localSeat : 0; }
_oppSeat()   { return 1 - this._localSeat(); }
_isMySeat(seat) { return seat === this._localSeat(); }
```

Solo versus the computer is then just the degenerate case: the human is always seat 0, the
computer always seat 1. Practice is seat 0 with nobody opposite.

The reason this is non-negotiable is repo history, not theory. Several earlier games in this hub
hardcoded "the local player is seat 0" and every one of them had to be picked apart later when a
second human seat arrived — the assumption hides in turn checks, in win checks, in HUD strings, in
board orientation, in stats recording. Writing the accessor on day one costs nothing. Retrofitting
it costs a rewrite. In this build the payoff was immediate: adding multiplayer required no changes
to the turn logic, only new transport code.

### 5.2 Lockstep over shot parameters

Multiplayer rides the repo's existing `js/net.js` room layer (`rooms/<CODE>`) unchanged, the same
protocol as Chinchón, Escoba, Tic Tac Toe, Mancala, Filler and Dots and Boxes. What is *different*
about Poolv2 is what a "move" is.

Every other game in this hub transmits a value from a finite move vocabulary: a mark, a pit index,
an edge. Poolv2's engine is continuous physics, so there is no such vocabulary. **A Poolv2 move is the
shot's parameters:**

```js
{ g: <game number>, dir: {x, y}, power, offset: {a, b}, elevation }
```

**A trajectory is never transmitted. A settled table is never transmitted.** Both devices re-run
the identical deterministic simulation and land on the identical table.

**This is what determinism buys you, and it is the whole argument for §2.7.** Determinism is not
only a fairness property — it is the difference between multiplayer costing four floats per shot
and multiplayer costing a per-frame state stream. If someone proposes adding randomness to the
engine "for realism" (a cloth-variation term, a random miscue), understand that they are proposing
to make multiplayer expensive, and route it through a seeded PRNG whose seed rides in the move if
it must exist at all.

The flow:

1. **The shooter applies its own shot immediately** (`_mpLocalShoot`) — nobody waits for a round
   trip to watch their own shot land.
2. It computes a state hash (`hash.js`, FNV-1a over settled ball positions rounded to 0.5 mm plus
   the rule state that diverges: turn seat, groups, open-table, ball-in-hand, over, winner) and
   appends `{move, hash}` to the room's move log at the next sequence number.
3. **The peer applies the identical parameters on delivery** (`_mpApplyNextEntry`), re-simulating
   locally, then compares its own hash.
4. On mismatch: the same host-authoritative recovery the reference games use — the guest requests
   a snapshot, the host writes one, capped at 3 attempts (`writeRecovery` / `requestRecovery` /
   `clearRecovery`, all unchanged in `net.js`).

Rounding positions to 0.5 mm in the hash is deliberate. The realistic failure mode here is **not**
a logic bug; it is float non-associativity between two different JS engines running hundreds of
fixed steps. Rounding absorbs the noise that does not matter and still catches the divergence that
does.

Other conventions: `round.dealer` is repurposed as "the seat that breaks" (the third game in this
repo to re-use that slot for its own "who opens" concept — do not add a field). Host is seat 0,
guest is seat 1. One game per room; a rematch is a fresh room. Results record under a `'mp'`
difficulty bucket via `recordResult('poolv2', 'mp', won)` with `recordHeadToHead('poolv2', opp, won)`
alongside, guarded so head-to-head can never block the ordinary result.

### 5.3 Storage keys

Three keys, never shared — the repo's settled convention:

| Key | Contents |
|---|---|
| `gamehub.poolv2.v1` | settings (currently just `difficulty`) |
| `gamehub.poolv2.save.v1` | solo/practice autosave: `{mode, difficulty, game}`, cleared on game end or explicit Quit |
| `gamehub.poolv2.mp.v1` | MP rejoin snapshot: `{role, code, seq, game}` |

Autosave is **silent restore** — straight onto the table on mount, no "resume?" prompt, matching
Mancala and Tic Tac Toe. Anything malformed is treated as "no save" and never crashes. MP is never
autosaved into the solo key, and rejoin is an explicit button because it needs the network.

`isInProgress()` is therefore mode-split, per the root CLAUDE.md's "two legitimate meanings":
**false** for solo and practice (leaving is lossless), **true** while an MP room is joined and the
opponent has not left (leaving abandons a real person's game).

---

## 6. Known gaps, ranked

Ranked by what to fix first. Each is a task, not a caveat. Items 1-4 and 6-9 were found by reading
the code for this document; the rest come from `poolv2/CLAUDE.md`'s own "Known limitations" and
multiplayer "Status" note.

**1. Multiplayer does not transmit ball-in-hand placement — fix before anyone plays online.**
`poolv2/CLAUDE.md` states that placement travels as part of the same move. The code does not do
this: `_mpLocalShoot` sends `{g, dir, power, offset, elevation}` and nothing else, while
`_commitCuePlacement` mutates the local cue position only. So after any foul, the shooter places
the cue ball, shoots, and the peer re-simulates the same strike **from a different cue-ball
position** — divergent table, hash mismatch, recovery snapshot, every single time. Fouls are
common, so this is close to "MP desyncs routinely."
*Task:* add `place: {x, y} | null` to the move payload; apply it before the strike in **both**
`_mpLocalShoot` and `_mpApplyNextEntry`; then correct the claim in `poolv2/CLAUDE.md`. Do not split
placement into its own lockstep entry — placement and strike must never be able to desync from
each other.

**2. There is no headless multiplayer lockstep test.** Six other MP games each have a block in
`test-mp-lockstep.mjs`; Poolv2 has none, and `run-all-tests.mjs` has no Poolv2 suite at all. The MP
path is "proven by construction," which is to say unproven — and gap #1 is exactly the kind of
thing that suite exists to catch.
*Task:* add a Poolv2 block to `test-mp-lockstep.mjs` driving two engine instances over a `FakeRoom`,
mirroring the `ui.js` MP glue with per-method citations the way the existing blocks do. Port the
five [KNOWN-BUG PROBE] regression assertions. Add a case where a shot follows a foul, so #1 cannot
regress. Register it in `run-all-tests.mjs`.

**3. In practice mode a scratch permanently removes the cue ball.** `_settleLocal` returns early
for practice, so `rules.resolveShot` never runs, so the scrub that un-pockets the cue ball never
runs either. The cue stays `pocketed: true`, is not drawn, and cannot be aimed. The only escape is
the re-rack button, which throws away the whole table.
*Task:* in practice, on a scratch, restore the cue ball to the head spot (or drop straight into
ball-in-hand placement, which is friendlier for a practice table) without invoking the rules
engine.

**4. The elevation slider's top third does nothing.** The slider runs 0-45 degrees; `strikeCueBall`
clamps elevation to 0.5 rad ≈ 28.6 degrees. Everything above 28.6 is silently identical.
*Task:* either cap the slider at 28 degrees, or raise the physics clamp — but if you raise the
clamp, revisit the masse term, which was fitted as a first-order approximation for small
elevations.

**5. Multiplayer has never been played on two real devices.** No device testing, no `FakeRoom`
harness run. This is stated honestly in `poolv2/CLAUDE.md` rather than claimed as verified — keep it
that way until it is actually true.
*Task:* after #1 and #2, play a full game host↔guest on two phones. Watch for: both seats seeing
the same rack, ball-in-hand round-tripping, the break seat matching `round.dealer`, recovery
firing and clearing, and the result recording once per device.

**6. The no-rail foul does not check rail timing.** `events.rails` counts every cushion contact
during the whole shot, including the cue ball hitting a rail *before* it touches any ball. Real
8-ball requires a rail *after* contact. Today, cue-ball-off-the-rail-then-nothing is scored legal.
*Task:* have `tick` tag rail events with whether first cue contact has occurred (or have the rules
layer walk an ordered event stream instead of a count). Note this changes the hash-relevant rule
state, so it must land on both MP peers together.

**7. No in-room rematch series.** One game per room; a rematch means creating a new room and
re-sharing a code. Every reference MP game in this repo supports a `round.n` series with an
alternating opener, and the field is already written as `1`.
*Task:* port the Mancala rematch-series pattern; alternate the breaking seat via `round.dealer`.

**8. The AI is the only randomness in the game, and it blocks the main thread.** `Math.random()`
drives aim/power jitter and the `topN` pick, and a decision can run ~90 full `simulateToRest`
calls synchronously.
*Task:* seed the RNG (so AI games are reproducible and replayable) and move the search off the
main thread or budget it across frames.

**9. A foul warning icon, once shown, is never cleared.** `_paintHud` writes the foul slot when
`_foulMsg` is set but never empties it when the message clears, so the ⚠ persists into later
shots.
*Task:* clear the slot's contents whenever `_foulMsg` is null. While you are there, replace the
`alert()` behind it with an in-page dialog, matching the rest of the repo.

**10. No real 3D camera, no zoom, no pan.** The guide's controls section asked for pinch-zoom and
pan; both were deferred, not dropped. The camera toggle is a cosmetic CSS tilt.
*Task:* pan and pinch-zoom first (biggest aiming benefit, no physics implications) — and see §4
rule 6 about the two-finger conflict before writing any code.

**11. `CORNER_JAW` is declared and never used.** Corner pockets are the same plain capture circle
as side pockets, though the comment describes pulling the capture point inward along the diagonal.
Bar players feel corner-pocket geometry, so this is a real (if small) fidelity gap.
*Task:* either implement the jaw offset or delete the constant. Do not leave a documented constant
that nothing reads.

**12. Missing rules features, all deliberate:** no shot clock, no jump shots (elevation drives
curve only, never a vertical launch), no called shots or pockets, no safety-specific fouls.
*Task:* if any of these are wanted, they belong in a **second named rulebook**, not as edits to
Bar Rules 8-Ball.

**13. No live language re-render.** Strings resolve at render time only; there is no
`onLangChange` subscription, so a mid-game language switch does not repaint. This meets the repo's
stated minimum bar and is the lowest-priority item here.
*Task:* subscribe in `_renderGame`, unsubscribe in `destroy()`.

---

## 7. The checklist

Follow top to bottom. Steps 1-11 build the game; 12-16 wire it into the hub; 17 onward is the
backlog from §6.

**Engine**

- [ ] 1. `poolv2/js/physics.js` — pure, headless, SI units, no randomness. Ball state carries
      `(vx, vy)` **and** `(wx, wy, wz)`. Implement in this order: `slip` → `naturalRollSpin` →
      `stepBall` (slide/roll split + independent `wz` decay + masse term) → `strikeCueBall`
      (squirt → `cos(elevation)` speed → spin from offset) → `resolveBallCollision` (normal
      exchange, tangential kept, throw nudge) → `reflectCushion` (speed-dependent COR) →
      `pocketCenters` → `tick` → `simulateToRest`. Use §2.8's constants verbatim.
- [ ] 2. `poolv2/js/table.js` — fixed rack, no shuffle; `FOOT_SPOT`/`HEAD_SPOT`; 0.5-1% rack
      clearance so it does not self-jam.
- [ ] 3. Verify by hand in Node before drawing anything: stop shot stops, draw comes back, follow
      follows, hard rail rebounds shorter than soft, two identical runs give identical output.
- [ ] 4. Write the engine test suite (§3 step 1) and add it to `run-all-tests.mjs`. **This build
      skipped this. Do not skip it.**

**Controls**

- [ ] 5. `poolv2/js/ui.js` skeleton: `init` / `destroy` / `isInProgress` + default export, a
      module-level `let instance`, idempotent CSS injection via
      `new URL('../css/pool.css', import.meta.url)`.
- [ ] 6. **Write `_localSeat()` / `_isMySeat()` now, before any turn logic exists**, and route
      every turn/win/group read through them (§5.1).
- [ ] 7. Canvas render loop driving the **fixed** `1/240` step from accumulated real time (cap
      frame delta at 50 ms and steps at 40/frame).
- [ ] 8. Implement §4's gesture table exactly, phase-first. Spin picker and elevation slider are
      separate elements with their own hit areas.

**Rules, opponent, practice**

- [ ] 9. `poolv2/js/rules.js` — pure `newGame` / `legalTarget` / `resolveShot` / `placeCueBall`,
      reading only physics' event log. One named rulebook.
- [ ] 10. `poolv2/js/ai.js` — ghost-ball candidates × 6 pockets, `pathBlocked` at `1.95R`, score with
      real `simulateToRest` lookahead, tiers vary error and `topN` only.
- [ ] 11. Practice mode: same physics and controls, no rules, no stats, re-rack button — and
      handle the scratch case (§6 #3).

**Hub integration** (root `CLAUDE.md`'s "Adding a game" checklist is authoritative)

- [ ] 12. `pool/index.html` standalone host calling `init(document.getElementById('pool'))`;
      `poolv2/css/poolv2.css` with **every rule descendant-scoped under `.p2-root`** (Mancala's
      discipline, not a bare prefix); `poolv2/js/strings.js` with `en`/`es` and every user-visible
      string through `t()` at render time.
- [ ] 13. Persist under `gamehub.poolv2.v1`; autosave `gamehub.poolv2.save.v1`; MP
      `gamehub.poolv2.mp.v1`. Silent resume, malformed treated as no save.
- [ ] 14. Register in `js/hub.js` `GAMES` (`module: '../poolv2/js/ui.js'`, id/title/blurb/accent),
      add landscape `viewBox="0 0 160 90"` art to `js/game-art.js`, add `pool` to the stats/
      leaderboard game lists (`js/game-stats.js`, `js/game-stats-ui.js`, `js/leaderboard-ui.js`)
      and the title string to `js/strings.js`.
- [ ] 15. Record with `recordResult('poolv2', difficulty, won)`. Poolv2 stores **no per-game
      sub-counter**, so no `js/players-agg.js` branch is needed — but if you ever add one (pot
      percentage, longest run), the three-edit rule applies and the `players-agg.js` branch is the
      one that gets forgotten.
- [ ] 16. Add every `poolv2/` file to `ASSETS` in `sw.js`, **bump `CACHE`**, then run
      `node validate-sw-assets.mjs` and `node run-all-tests.mjs`. Both must be green before commit.

**Multiplayer**

- [ ] 17. `poolv2/js/hash.js` — FNV-1a over settled positions rounded to 0.5 mm plus divergent rule
      state.
- [ ] 18. MP over `js/net.js`, untouched: host seat 0 / guest seat 1, `round.dealer` = breaking
      seat, move = shot parameters **plus placement** (§6 #1), shooter applies immediately and
      publishes `{move, hash}`, peer re-applies and verifies, host-authoritative recovery capped at
      3 attempts.
- [ ] 19. Add the Poolv2 block to `test-mp-lockstep.mjs`, including a foul-then-placement case
      (§6 #2).
- [ ] 20. Play a real host↔guest game on two devices before calling multiplayer done (§6 #5).

**Documentation**

- [ ] 21. Keep `poolv2/CLAUDE.md` current — THE LAW rule 9: a milestone is not done until CLAUDE.md
      reflects it. When you close a gap in §6, update **both** files: strike it here, correct the
      claim there.
