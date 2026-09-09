# Pinball — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below overrides
> them. This game's answer to THE LAW is unusually short and is stated under "Persistence" — read
> that before adding anything to `store.js`.

A full single-table pinball machine: continuous 2D physics, two swinging flippers, a plunger with a
power meter, pop bumpers, slingshots, a drop target bank, a spinner, an orbit, a habitrail ramp, a
scoop, timed missions, lock-and-multiball, a wizard mode, an end-of-ball bonus count-up, and tilt.
Built 2026-08-11; **the playfield and the solver were both replaced on 2026-09-06** - see "The
machine was replaced" below, which is the first thing to read before touching any of it.

The table is still called **STARHUB** on the setup screen; the game, the folder, the hub id and the
stats id are all plainly `pinball`. The name is deliberately short, machine-shaped and tied to the
hub: the three top rollover lanes spell H-U-B. **It kept the name through the 2026-09-06 rebuild on
purpose** - the layout is new, but the hub is the same hub, the lanes still spell the same word, and
a new name would have churned the strings, the docs and the setup screen to say nothing new. (It was
"Nova Cadet" for about an hour in 2026-08; that read as invented lore, which nothing else in this hub
of plainly-named games has.)

**Admin only for now.** The hub registry entry carries `devOnly: true`, so the card renders for Matt
and the tester and for nobody else, and the My Stats tab is gated the same way (`TABS` in
`js/game-stats-ui.js`) so an unreleased game does not leave a stray empty tab in everyone else's
stats. Releasing it is exactly two edits: delete `devOnly` from both.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../pinball/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `pinball` |
| Stats id | `pinball` (recorder `recordPinball`, sub-counter `pb`) |
| CSS root / prefix | `.pb-root` / `.pb-` |
| Settings key | `gamehub.pinball.v1` (one preference: the table) |
| Difficulty axis | the three TABLE settings, `easy` / `medium` / `hard`, straight onto the shared 1-4 tiers |
| `isInProgress()` | the **literal** meaning: `true` while a game is live |

`isInProgress()` is literal (Ball Run / Snake / Hill Climb's class, not Escoba's) because a ball in
flight cannot be meaningfully snapshotted: a saved mid-ball state would be a saved mid-shot, and
restoring it would either teleport the ball or silently drop the shot the player was in the middle
of. So leaving genuinely abandons the game and the hub confirms first. The setup screen is never in
progress; everything there is saved the instant it changes.

`immersive: true` because the game owns the whole viewport (a fixed edge-to-edge canvas, a
dot-matrix display, and full-height flipper touch zones). `.pb-root` is `position: fixed; inset: 0`
at `z-index: 1`, the same shape Hill Climb uses, so the hub's floating back button stays on top.
`.pb-hud-top` carries `padding-left: 84px` for exactly that reason: the back button sits in the
top-left corner in immersive mode.

## Files

| File | Role |
|---|---|
| `js/physics.js` | the deterministic solver: shapes, contacts, impulses. Pure, no DOM |
| `js/table.js` | the playfield as data: every wall, post, bumper, target, switch. Pure |
| `js/game.js` | the rules: balls, scoring, missions, multiball, bonus, tilt. Pure, emits an event stream |
| `js/render3d.js` | the playfield in three.js: the model's own geometry, materials and lights, plus a 2D overlay for the effects layer |
| `js/vendor/` | three.js, the same vendored copies Skeeball, Golf and Ball Run carry |
| `js/table-rainbow.js` | the RAINBOW board as data (see "The third board") |
| `js/rainbow.js` | RAINBOW's rules |
| `js/render-rainbow.js` | RAINBOW's renderer, a subclass of `render3d.js` |
| `js/store.js` | one preference, the table (see "Persistence") |
| `js/strings.js` | the EN/ES dictionary |
| `js/ui.js` | DOM shell, input, HUD, the hub module contract |
| `js/test.js` | headless tests, including the soak (see "Testing") |

The first three are DOM-free and that is load-bearing, not tidiness: `node pinball/js/test.js` plays
thousands of simulated seconds without constructing a single element.

## The machine was replaced (2026-09-06)

Matt: *"replace the existing pinball machine with the attached. And completely rewrite the physics
doc to make the game playable."* The attachment was **a three.js model of a playfield** -
`pinball.html` plus `three-d-stage.js`, a deck outline with an arch, three pop bumpers, two
slingshots, a drop bank, standups, a spinner, a scoop, a violet U-channel loop ramp on support legs,
a left wireform return, a sixteen-lamp rosette, top rollover lanes, posts with rubber, arrow inserts,
a plunger with a spring and an apron - in nine named materials.

**What was taken, and what it cost.** The model is 3D and this game is a 2D top-down canvas with no
build step and no dependencies, so the model is not loaded: it is CONVERTED. `table.js` carries its
geometry, `render.js` carries its parts and its nine colours verbatim, and every place the
conversion had to decide something is marked `DESIGN NOTE` in `table.js` with what the model showed
and why the table does something else. Three of those are worth knowing here:

- **The drop bank moved.** The model puts it across the top centre, directly under the rollover
  lanes it also draws - in a solver that is a wall across the lane exits, so the ball can never reach
  them. It is inside the ramp loop now, in the band between the pop bumpers and the rosette. (Its
  first new home, the upper left, was WORSE and a screenshot proved it: all three targets sat under
  the ramp's left descent and simply were not visible.)
- **The scoop moved 60 units down-field.** The model's position converts to a point inside the arch
  CHANNEL rather than on the playfield.
- **The model's two concentric horseshoes became one.** It draws a wall at 0.212 inside the deck's
  own 0.26 arch, which would leave a 38-unit channel with nothing in it and no way out. The deck
  edge IS the orbit lane's outer wall now.

**The old STARHUB layout is gone**, and with it the four wedges, the 4-target bank and the 400 x 760
coordinate system. ROYAL FLUSH is untouched and is still the second board.

## The table

348 x 694 logical units, y down, ball 18 across - 19.3 balls wide against a real machine's 19.0,
because the scale factor (666.67 units per model metre) was chosen to make the model's ball and this
engine's ball the same ball. **Every clearance in `table.js` is checked against that 18**: a channel
meant to pass a ball is at least 26 wide, and anything narrower than 18 is deliberately sealed. See
the shot map in `table.js`'s header comment.

**Two centre lines, and they are not the same.** `ARCH.cx` is 174 (the CABINET centre, because the
arch spans the shooter lane too); `AXIS` is 157 (the PLAY AREA centre, because the shooter lane eats
the right-hand 38 units). Every left/right pair below the arch is `x` and `314 - x`. The model
mirrors everything about the cabinet centre and lets the shooter lane overlap the right outlane,
which cannot work in a solver, so the lower playfield is shifted 17 units left as one piece.

Shots, and which flipper feeds them:

| Shot | Fed by | What it does |
|---|---|---|
| Ramp (centre) | either | habitrail to the right inlane. 5 ramps light the lock; during multiball it is the JACKPOT |
| Scoop (up the right wall) | left | mission start / lock / super jackpot, in that priority order |
| Drop bank (up the middle, inside the ramp loop, 3 targets) | right | clearing it lights the scoop for the next mission |
| Left orbit (past the spinner, round the arch) | right | spinner rips plus a combo-multiplied orbit award |
| H-U-B lanes (across the top) | bumper kickouts | each completed set raises the end-of-ball bonus multiplier, to 8x |
| Stand-up targets (both side walls) | anything | small points, and a soft outlane defence |

Three mechanisms carry most of the table's behaviour and each has a comment where it is defined:

- **The arch is a real 34-wide channel**, not a decorative ceiling, formed by the deck's own edge
  (rOut 170) and the model's `orbit-wall-inner` (rIn 128). The plunger fires into it and a left-orbit
  shot travels the whole way round and drops back into the playfield at the top right. The inner arc
  deliberately stops 12 degrees short of the right horizontal; that gap IS the orbit's exit. Closing
  it makes the orbit a dead end.
- **Two one-way gates.** The shooter-lane gate exists only for a DOWNWARD-moving ball, so a launch
  passes through it and a returning orbit ball is caught and rolled out into the playfield instead
  of dribbling back to the plunger. The orbit deflector uses the identical trick for the opposite
  reason: the left lane has to be enterable from below (that is the orbit shot) while still spitting
  a returning ball into the playfield rather than straight into the outlane.
- **The ramp is a scripted habitrail, not simulated.** Entering the mouth fast enough (`needUp`)
  hands the ball to `RAMP_PATH` for `RAMP_TIME` (1.5 s - it is a long loop); entering it slowly
  bounces the ball back down. This is how a real ramp behaves and it is far kinder than trying to
  simulate a banked wire in 2D. `RAMP_PATH` IS the model's own `rampCurve`, converted, plus two points
  of ours to carry the ball into the right inlane; it is elevated, so it crosses the left lane, the
  drop bank and the rosette without any of them caring. **`render.js` draws it TRANSLUCENT for
  exactly that reason**: drawn opaque from above it is a 26-unit band right across the middle of the
  table that hides everything it flies over, and the first screenshot of this build showed precisely
  that.

- **The one-way gate stops 14 units short of the shooter-lane wall, and that gap is the point.** The
  first version ended ON that wall, which made the two into a closed corner: every ball that
  completed the orbit rolled down the gate, hit the wall and PARKED. A soak measured 20% of all ball
  life sitting in it, with the orbit, the spinner and the scoop scoring literally zero across five
  games. 14 units against a ball of 18 plus two wall radii is still far too narrow for a descending
  ball to slip back down the lane, so the gate loses nothing by not touching.

### Wedges: the failure mode this table used to have

A pinball table is convex shapes near other convex shapes, and **two convex surfaces a little under
one ball apart make a permanent parking space**. The ball rolls in, touches both, and stops forever;
it is a stable equilibrium, so nothing in a rigid-body solver shakes it loose.

**Since 2026-09-06 the solver lets a pinched ball out on its own** (`physics.js`'s `escapeWedge`: all
of a micro-step's contacts are collected before anything is decided, and a ball held between opposing
normals while barely moving gets a small outward impulse along their resultant). That is why the new
layout has none of the four below and did not need a hunt for them. **It is not a licence to stop
checking clearances**: a ball that has to escape a pinch every twenty seconds is a table that feels
wrong even when it is not broken, and `test.js` still asserts the geometry.

The four the OLD layout shipped, all found by the soak and never by reading the code, are kept
because each one is a shape to recognise, not a coordinate to avoid:

1. The scoop two units off the right wall — every ball parked at (358, 268).
2. The inlane divider's end cap a few units clear of the flipper pivot — parked at (258, 624), and
   untouchable, because the contact point is the pivot itself where the paddle's surface speed is
   exactly zero. Fixed by OVERLAPPING them into one convex blob, which has no stable top.
3. The stand-up targets a ball's width off the side walls.
4. The Casual outlane save, twice: a blocking post (an outlane is 56 wide, so no disc both fills it
   and leaves clearance) and then a rail across the bottom (an outlane is a dead end, so anything
   that stops the ball there has nowhere to send it). The right answer was a post at the outlane's
   MOUTH, wedged between the side wall and the top of the inlane divider, which rolls the ball into
   the inlane instead — which is what a real outlane post does.

**If you move the scoop, a bumper, a divider or a wall, re-run `node pinball/js/test.js` before
anything else.** The soak is the only thing that finds these.

**And read the histogram, not just the pass line.** The gate-corner trap above was invisible to every
assertion in the suite - nothing wedged, nothing left the table, every game finished - and showed up
only as "20% of ball life in one 60x60 cell of the upper right" in a scratch occupancy histogram.
That is the same lesson the ROYAL FLUSH import already wrote down further below: profile where the
ball IS before theorising about why it misbehaves.

A fifth failure of the same family showed up only in a browser: the cached static playfield bitmap
is painted WITH the centring transform already applied, so blitting it under that transform again
shifted the whole table sideways and clipped the shooter lane off the screen. Headless tests cannot
see it; `node test-visual.mjs pinball` and a screenshot can. Look at the contact sheet.

### The scoop loop: a stuck ball that was scoring, not silent

Shipped and found by Matt on his second test game (2026-08-11): he shot the scoop on ball one and
banked **1.5 million** while the ball sat in it. The switch edge-detector read
`!b.held && dist < r`, so a HELD ball counted as outside its own switch. A capture parks the ball on
the switch centre, so the instant the scoop ejected it - still well inside the 10-unit radius - the
detector saw a fresh rising edge and captured it again. Eject, re-capture, score, eject, at 2.2
awards a second, forever. `inside` is now purely geometric, which makes a held ball read as inside
its own switch and stops the switch re-arming until the ball has genuinely left the radius.

**The interesting half is why the tests missed it.** Both stuck-detectors in `test.js` are built on
"stuck means nothing is happening": the soak watched for the SCORE not moving, and the ball-search
watchdog watches for the BALL not moving. This bug maximises the first and is exempt from the second,
because a held ball is deliberately skipped by the watchdog. A stuck ball that is *scoring* fell
straight through the gap between them.

So there are now two new invariants, not a tightened threshold:

- `game.js` caps how long a ball may be HELD (`MAX_HOLD`, 3.2 s). Every legitimate hold is short and
  known - the ramp ride is `RAMP_TIME` (1.5 s), a scoop hold is under a second - so anything past
  that is a bug, and it releases the ball and logs loudly rather than letting it sit.
- `test.js` has a deterministic `[KNOWN-BUG PROBE]` firing a ball into the scoop and asserting ONE
  award, plus the same for the ramp, plus a soak invariant on the longest held time. All four were
  verified RED against the old code before the fix landed.

**If you add another capture switch, it is the held-time invariant that will catch you, not the
score one.**

The **ball-search watchdog** in `game.js` is the safety net under all of it, and it measures
DISPLACEMENT FROM AN ANCHOR, not speed. The first version watched for speed < 26 and never fired,
because a wedged ball jitters: it crosses any speed threshold several times a second while going
precisely nowhere. Displacement cannot be fooled that way.

## The solver was completely rewritten (2026-09-06)

Same instruction, second half: *"completely rewrite the physics doc to make the game playable."* Four
things changed and each is a behaviour a player feels. The full reasoning is `physics.js`'s own
header; this is what a future session needs to know before touching it.

1. **The step is adaptive, so tunnelling is impossible by construction.** The old solver ran a fixed
   1/480 s step and hard-capped the ball at `MAX_SPEED`, because speed x step had to stay under the
   thinnest wall - which made the cap a CORRECTNESS bound, and its own header said raising it "re-opens
   tunnelling, and the ball leaves the table". A pinball that cannot be hit hard is not a pinball.
   The tick is 1/240 s now and is SUBDIVIDED internally so that no ball and no flipper tip advances
   more than 0.3 ball radii per micro-step, however fast it is going. **`MAX_SPEED` is a gameplay
   bound now, not a correctness one**, and moving it can no longer lose the ball.

2. **Contacts are resolved together, and a pinched ball lets itself out.** See "Wedges" above.

3. **A flipper has angular momentum, and its rubber softens with speed.** The old paddle snapped to a
   constant angular velocity for one step and reported `omega` from whatever step it happened to
   take, so a flip was an instantaneous event: the ball either met the paddle during that one step
   and was launched, or met it a step later and was not. The paddle ACCELERATES to `speed` now and
   stops dead against its stop, so a flip has a real ~30 ms profile and a late flip is a soft shot
   rather than no shot. Restitution falls with impact speed, the way real flipper rubber does.

4. **The ball rolls, and it can be cradled.** `spin` is a real degree of freedom (solid sphere,
   I = 2/5 m r^2) driven by Coulomb friction bounded by the normal impulse, so friction spends itself
   spinning the ball up and then stops braking it. **The cradle damping fires only while the flipper
   is HELD UP.** The first version damped a slow ball on ANY stationary paddle, which is flypaper: a
   ball at the DOWN stop must still roll off the end, and `test.js`'s roll-to-tip probe caught it at
   99 s against a 0.50 s frictionless baseline.

**Friction is no longer zero everywhere, and the test moved with it.** The old
`[KNOWN-BUG PROBE] every collider class is frictionless by default` could not survive: `physics.js`
serves two boards, and ROYAL FLUSH is designed against Box2D and measurably worse with none. What the
2026-08-22 incident was actually about is narrower - **a surface the ball RIDES must not brake it** -
so the probe now asserts every ride surface on THIS table (`archIn`, `archOut`, both side walls, both
funnels, the orbit wall and deflector, both inlane dividers) is frictionless BY NAME, and asserts the
shared defaults are merely BOUNDED under 0.2 so a collider added without thinking can never be
flypaper. Same guarantee, expressed where it belongs.

**Three thresholds in that block are looser than the old table met, and that is geometry.** The
paddle is 63 units against 58, its rest angle 25 degrees against 27, and gravity 9% lower, so the
same frictionless roll takes 0.50 s here against 0.42 s there. Each threshold sits about 1.5x its
measured frictionless value - loose enough not to be a tripwire for the layout, tight enough that the
bad cradle above measured 99 s and failed loudly.

## It was still not a game, and a screen recording proved it (2026-09-07)

Matt played the 2026-09-06 build and sent 45 seconds of it. The build passed every test in this
file. What the recording showed:

| | |
|---|---|
| Ball 1 drained and was saved at | 0:11, 0:17, 0:22 |
| Time from launch to drain | about **5 seconds**, four times over |
| Objective line, 0:07 to 0:44 | "DROP THE 3 TARGETS", unchanged, through both balls |
| Score after each launch, no flipper input | +8,000, +19,600, +24,000 |
| Final | 106,160 points in 45 seconds, flippers barely used |

**Five defects, each measured, each with the number that found it.**

1. **The outlanes were funnels.** With the ball save switched off a soak measured a MEDIAN BALL
   LIFE OF 5.6 SECONDS, and the number that gave it away was not that one: **18 drains, 12 left
   outlane, 6 right outlane, ZERO down the middle.** A real machine drains mostly down the middle.
   A table that only ever drains out the sides is not hard, it is leaking. Tracing the last 1.5 s
   of every drain named the same three colliders every time - wallL, divL, funnelL - so the ball
   was not being beaten, it was walking into an open bay above the outlane mouth and riding a
   smooth chute to the drain. **The model's own outlane wall curves inboard at the top and the
   first conversion straightened it**; `laneGuideL/R` is that curve put back. Now 40 s, and the
   drains split across centre and both sides.

2. **The ramp was the only shot on the table.** A 396-throw sweep of both flippers: ramp 67%,
   and orbit / spinner / scoop / rollover lanes / pop bumpers / drop bank **0%, all six, from both
   flippers**. Its entrance splayed from 70 units wide at the flipper line, which put a catchment
   the width of the centre lane directly above both paddles. Every rule in `game.js` hangs off
   those shots, which is why the objective never changed and no mission ever started. It is a
   parallel-sided slot in the LEFT THIRD now; the centre lane is open, and the sweep reads scoop
   21%, pops 34%, bank 45% from the left flipper and ramp 20-32% from the right.

3. **The plunge scored the game.** The plunger fires into the arch by design, so every launch
   tripped `orbitTop` and paid a full combo-multiplied orbit award for no player input - 15,600 to
   24,000 a time, repeated every time the ball came back to the shooter lane. A ball that has not
   touched a paddle since it was served now gets the SKILL SHOT instead, once. (`PTS.skill` and
   `skillLit` were both already in the file and nothing had ever awarded either.)

4. **The ball save re-armed on every save**, so a save led to a save led to a save and ball one ran
   on an unbroken save from 0:04 to 0:29. That is not a ball save, it is an invulnerability field,
   and it hid the five-second ball underneath it for a whole build. One save per ball now, timed
   from the serve.

5. **The slingshot was live on its back face.** The inlane side of a slingshot is buried in plastic
   on a real machine; here it was a solenoid pointed at the wrong half of the table, and a soak
   measured **53% of all ball life** bouncing in the pocket above the right inlane because the coil
   fired the ball back up there every time it rolled down. `kickN` in `physics.js` is the face the
   coil is behind.

**Two more, both wedges, both found by an occupancy histogram rather than by any assertion:** the
funnel passed exactly one ball's width from the flipper pivot (81% of ball life parked in that
crook), and the inlane divider's top cap sat 17 units from the side wall - a hair under a ball, so
the ball could not pass but could be squeezed (23%). **Either seal a gap properly or open it
properly; never leave one just under a ball.**

**And the wedge escape was measuring the wrong thing.** `escapeWedge` read the instantaneous speed,
and a wedged ball does not sit still - it buzzes, crossing any threshold several times a second.
`ball.avgV` is a smoothed speed over about a tenth of a second, which a buzz cannot fool. Same
lesson as the ball search: measure where the ball is GOING, never how fast it happens to be moving
this step.

### What replaced the assertions that missed all of this

The soak passed throughout. It could not see any of it, because a re-arming ball save hid the
drains and a random driver hides everything else. So `test.js` has a new block, **SAVE-OFF**, and it
measures the two things that actually track playability:

- **ball life with the save switched off** - 5.6 s before, over 12 s asserted now;
- **which exit the ball leaves by** - the middle has to be a real drain, not just the outlanes.

Two soak thresholds came DOWN at the same time and that is not a goalpost moving: `physics.js` can
CRADLE now, and this driver holds a flipper about a third of the time, so it went from an
unrealistically good pinball player to an unrealistically good one **with a ball trap**. Counting
its drains measures the driver. The outlanes are checked GEOMETRICALLY instead - mouth and channel
both wider than a ball, mouth not so wide it is a funnel again.

## It renders in 3D now, because the model always was (2026-09-07)

Matt, on the flat conversion: *"Claude Design created a beautiful, 3D pinball gameplay board. Why
did you flatten it to shit and make it look terrible?"* There was no good reason. The game is a 2D
canvas with a 2D solver, so I decided top-down art was the pragmatic route and wrote that down as an
assumption instead of asking - and two readings of the request led to materially different work,
which is exactly when to stop and ask.

**`js/render3d.js` renders the model. `js/render.js` is deleted.** three.js is vendored in
`js/vendor/`, the same copies Skeeball, Golf and Ball Run already carry, so this is not the repo's
first dependency and it is not a new architectural decision.

**THE PHYSICS IS STILL 2D AND THAT IS CORRECT, NOT A COMPROMISE.** A pinball is a ball on a tilted
plane; every commercial pinball simulation solves it in 2D and renders in 3D. `game.js` and
`physics.js` are untouched by the renderer. What changed is only what you look at.

### The five that cost the most time, so a future session does not pay for them again

1. **`world.z = -table.y`, and everything must agree.** Every flat part is an `ExtrudeGeometry`
   authored in table coordinates and rotated -90 degrees about X, which is what stands it up - and
   that rotation maps the shape's +y onto world **-z**. The deck and the rails therefore live at
   negative z. The first build placed the bumpers, the ball and the posts at +z instead, so the
   table rendered inside out with its floor behind the camera. `tz()` is the single place that
   conversion happens now.

2. **Which means the whole scene is MIRRORED, and needs a second flip.** A camera at very negative z
   looking back along +z has world +x on its LEFT. One axis flip makes the table a mirror image:
   the plunger came out on the left and the spinner on the right, which reads as almost right and is
   completely wrong. `this.model.scale.x = -1` restores it; three.js flips the winding order itself
   for a negative determinant, so lighting and shadows stay correct.

3. **An extrusion's origin is its BOTTOM face.** Setting `position.y = base + h` - the
   obvious-looking thing - lifts every part by its own height. It put the deck's top surface at
   y = 14.7 and buried the rosette, the lamps, the drop targets and the stand-ups inside the slab,
   which is why the middle of the table rendered empty.

4. **Never extrude a Shape with a Path hole when a band will do.** The hole has to wind opposite to
   the outer contour or the triangulator fills the whole thing, and the cabinet duly put a white
   disc the size of the playfield in front of the camera. The cabinet is a band along the outline
   now and the art halo is a `RingGeometry`; neither can fail that way.

5. **The framing is SOLVED, not calculated.** Working the camera distance out from the table's
   centre with trigonometry does not work for a tilted camera: the near end is far closer than the
   centre, so it projects much larger than the formula allows and spills off the screen while the
   far end is still cropped. `resize()` bisects the distance until every corner of the table lands
   inside the frustum, then re-centres through `setViewOffset` - the FILM BACK, not the camera,
   because moving the camera changes what fits and turns a one-shot correction into a chase.

**TILT is 20 degrees and the number is set by the shape of a phone.** The table is 348 x 694, so at
a tilt of t it projects 348 wide by 694·cos(t) tall; a 393x852 screen less the HUD is about 1:1.85.
At 30 degrees that came out 1:1.73 - wider than the screen - so it fitted by width and left a third
of the frame empty above it. 20 degrees gives 1:1.87, which fills.

### Two things carried over from Skeeball, and one from the model

- **`preserveDrawingBuffer: true`.** Without it a WebGL canvas reads back blank, and
  `test-visual.mjs`'s PLAY probe - which samples the canvas three times to prove the table is
  animating - fails with "nothing is moving" on a game that is running perfectly.
- **A software-GL path.** `isSoftGL()` is Skeeball's probe verbatim; on SwiftShader the pixel ratio
  drops and shadows go off. The shadow map also refreshes on demand rather than every frame, because
  almost nothing in this scene moves - only the paddles, the ball and a falling drop target.
- **Every emissive intensity is the model's.** That is the half the flat renderer threw away, and it
  is the whole reason its amber lamp runs rendered **brown** and its cyan inserts **navy**. Those
  were not colour choices gone wrong; they were the emission missing.

### What the flat renderer had dropped, and is back

The cabinet box with sides and a front lip, the recessed deck, every part's real height and shadow,
the mushroom bumper caps, the raised ramp channel on its legs, upright drop targets, standing posts
with rubber, the sunken scoop, the plunger spring, twenty lamp inserts (the upper arc, both banks
beside the rosette, the drain row), four of the seven arrow inserts, and the wireform return rail -
which was dropped from the flat build on purpose, because seen from directly above it was two
hairlines crossing the ramp and the rosette and read as a rendering fault. At a height, casting a
shadow, it reads as the piece of bent wire it is.

**`test.js`'s paddle-gradient probe is retired**, and the file says why: it tested a 2D shading
trick that no longer exists. The defect it caught is still worth knowing - a shading trick keyed to
screen axes rather than to the part itself looks right at rest and wrong the moment the part moves -
but nothing in a 3D scene can reproduce it, and an assertion that cannot fail is worse than none.

## The drain was narrower than the ball, and the table was shouting over itself (2026-09-07)

Matt, on a clip of the 3D build: *"1. It's impossible for the ball to go between the paddles. And
2. Too much confetti on the screen causes the ball to get lost. All confetti must be off the machine
and shown in the black outside. And the points and word popups should be shown on a back
wall/scorepoint/point counter thing. There's too much that happens on top of the machine."*

### The drain gap was 0.97 balls

The footage shows the ball sitting in the V between the two flipper tips, bouncing, frame after
frame, never falling through. It could not: **the clear gap was 17.4 units against a ball of 18.**

**The arithmetic that was got wrong, because it is easy to repeat.** The gap is NOT the distance
between the tip centres. `physics.js` models the paddle as a capsule that tapers to 65% of `r` at
the tip, so each tip eats another 5.2 units on top. At `dx` 71 the centres were 27.8 apart and the
real gap was 17.4. At `dx` 74 it is 23.4, or **1.30 balls**; real machines run 1.2 to 1.6.

    gap = (2*dx - 2*len*cos(rest)) - 2*(0.65*r)

**And the test was lying about it.** The SAVE-OFF block classified any drain between `tipL - 8` and
`tipR + 8` as a centre drain, so balls going round the OUTSIDE of a paddle were counted as centre
drains - it reported 7 of them on a table where no centre drain was physically possible. The
classifier uses the tips exactly now, and there is a geometric assertion beside it that fails if the
gap is ever narrower than a ball again.

### The confetti is off the machine, and the shouting is on a backglass

Two separate changes, both for the same reason: the ball is a small grey sphere, and every bright
thing drawn over the playfield is another small bright thing competing with it.

- **`spawnHit()` throws its burst clear of the machine.** It no longer starts where the hit was: it
  starts where a line from the middle of the machine through the hit LEAVES the machine's
  silhouette, and travels outward into the black surround from there. You still see which side
  scored, and nothing is ever drawn over the ball. `this.box` is the machine's screen-space bounding
  box, measured in `resize()` from the same corners the camera framing uses, so it cannot drift out
  of step with what is on screen.
- **Every award value and word goes on a BACKGLASS**, standing at the far end of the table where a
  real machine puts it, instead of floating over the playfield. It is a `CanvasTexture` redrawn only
  when the text changes (and at about 12 Hz while a line fades), showing the last three lines.

**Three flips to make the glass readable, and they compound rather than cancel.** The model group is
mirrored in x (see the 3D section above); a `PlaneGeometry` faces +z, which here is AWAY from the
camera, so the glass has to be turned round; and turning it round mirrors the text. The first build
put **"BUHRATS"** on the backglass. `tex.repeat.x = -1` is the third flip.

**And the framing has to fit twice now.** Sliding the frustum window moves the whole picture, so a
fit that was exactly tight before the shift is over the edge after it - which is how the backglass
ended up sliced off by the HUD band. `resize()` measures the offset, applies it, and re-fits; two
passes is enough, because the offset barely moves once the distance settles.

### One bug the backglass exposed on its first frame

`lbl_skill` had no dictionary entry, so the raw key rendered on screen. The skill shot was added
earlier the same day and its label was never added to `strings.js`. Both languages have it now, and
every label `_award()` can emit is checked against both dictionaries.

## The readability pass (2026-09-07)

The last batch of the visual plan, and the one that could only be judged after the rest of it
existed. Two complaints from the same root: *"the ball gets lost."*

**The probe that made it arguable rather than a matter of taste.** `_read.mjs` (scratch, not
shipped) freezes the world, parks the ball ON the left inlane rail - the busiest piece of furniture
on the table and the hardest place to see it - and shoots the lower playfield at 3x. Before the
pass, the ball in that frame is a grey speck indistinguishable from the rail under it. That is the
whole case.

### The ball was a mirror with nothing to reflect

The model's `steel-ball` is roughness 0.08, metalness 0.4, and `three-d-stage.js`'s own header warns
about exactly this: there is **no environment map** in this scene, "so high metalness has nothing to
reflect and renders near-black. Cap metalness around 0.3-0.4 and carry a metal look with a brighter
base color." At 0.4 the ball rendered as a dull grey dot. Lower metalness, a white base and a little
emissive is the model's advice **followed**, not overridden.

### It cast no shadow, and could not

`castShadow` was already true. It made no difference: the shadow map is 1024 texels across a
640x920 area, so a ball of radius 9 casts a shadow about **two texels** wide. Each ball carries its
own painted contact shadow now - and on the ramp that shadow stays on the DECK and shrinks with
height, which is what tells you the ball is up on the wire rather than on the playfield.

### Forty painted lenses were out-shining the one thing that moves

The bumper rings and the slingshot lamps are lights and should read as lights. The lamp lenses
scattered over the deck are **paint**, and at the model's full emissive intensity forty of them beat
the ball. They have their own materials at about a quarter of the emission.

### Three rails a side is a cage, not a playfield

Every rail was chrome and 8-9 wide, which put three and four near-parallel light-grey lines down
each side of the lower playfield. Two rules now, and `ART.rails` is where they live:

- **Anything the cabinet already draws is not drawn twice.** The left wall from the arch down to the
  funnel, and the whole right cabinet edge, were duplicates running alongside the cabinet band at a
  different height.
- **Structure is steel; a guide the ball RIDES is chrome.** So the lanes read and the walls recede.

## A third of the playfield was not there, and the print was missing (2026-09-08)

Matt, on a phone screenshot of the shipped build: *"Please make this better. It looks half done."*
It was two separate things, and the first one is the reason the second one was invisible.

### The deck had no surface above y = 174

`_deckShape()` draws the outline as a straight-sided body with an arch across the top, and the arch
is `absarc(cx, cy, rOut, PI, 0, sweep)`. The sweep flag was `true`, which sweeps the arc **down**
through (cx, cy + rOut) instead of up - so the top of the deck was a bite taken OUT of the
playfield. Proved with a point-in-polygon test against that exact shape: the crown, the four
rollover dividers, all three lanes and the whole bumper nest were **outside the deck**. There was
no floor under any of them.

It rendered as a black void with three mushrooms and four white sticks standing in mid-air, and
nothing in the frame pointed at it - **the arch you can see at the top of every screenshot is the
inner WALL rail**, drawn separately by `_arcPts` with its own explicit PI -> TAU sweep. So the
table kept its whole silhouette while a third of its floor was missing, and every visual test
passed: `test-visual.mjs` proves a game rendered, never that it rendered the right thing.

The regression probe a future session can run in ten lines: build `_deckShape(0)`, `getPoints(240)`,
and check that (174, 20) is inside the polygon. If it is not, the crown is gone again.

### And nothing on the deck was PRINTED

The other half. Every part on this table was modelled and the deck itself was one flat violet slab
carrying two extra meshes - a lit half-ring and a triangle - floating half a unit above it. A real
playfield is a **printed sheet** with the hardware bolted through it, and a machine with no print
reads as unfinished however much geometry is standing on it.

`_deckTexture()` is that sheet: a 1024x2048 canvas painted once at load, **in table units**, so
every coordinate in it is the same number the physics uses and the art cannot drift away from the
hardware standing on it - the rule `ART.rails` already follows. It carries the base field and star
field, a sunburst under the bumper nest, bands following the arch, H-U-B over the three lanes, shot
chevrons at the ramp/orbit/scoop, the ramp runway, printed plates under both target banks, amber
outlanes against cyan inlanes, arcs across the lower playfield, the rosette halo and the lower fan.

Two UV facts, each of which costs a build to learn:

- `ExtrudeGeometry`'s default UV generator hands the top face `uv = ` the shape's own `(x, y)`, so
  uv is **already in table units** and one repeat of `1/W` by `1/H` maps the whole print onto the deck.
- `flipY` must be `false`. Table y runs down-field and a canvas' y runs down too, so the default
  flip prints the sheet upside down.

**Nothing on the print is bright, and that is a rule rather than a taste.** The one small moving
thing on this table is a near-white ball and it has been lost once already. Colour carries the
print; luminance is reserved for the ball.

### The rest of the pass

- **The backglass was empty until an award fired.** At launch - which is when a screenshot gets
  taken - the biggest object in frame was a blank black rectangle. It has a resting face now: rays,
  the wordmark (which doubles as the mode indicator), the SCORE where a machine puts it, and the
  ball number. Repainting is signature-compared and rate-limited to ~12 Hz, because a repaint is a
  512x288 canvas plus a texture upload and the score moves on almost every bumper hit.
- **Two coloured rim lights and a lamp inside the nest.** The studio was one warm key and one warm
  fill, so every chrome part returned the same grey. The nest lamp's x is NEGATED, like the key's:
  lights are added to the scene, the model group is mirrored.
- **The cabinet rail is no longer chrome.** It is the largest single object in frame, and in bright
  chrome it read as a grey horseshoe that drew the eye to the frame instead of the table.
- **Bumper collars carry each bumper's own colour**, so a cap is identifiable from across the table
  instead of being one of three identical grey mushrooms.
- **The apron is a printed plate with a chrome lip**, not two bare steel wedges.

## The rules layer was shut, and three things were holding it shut (2026-09-07)

Asked whether the game was ready to release, and measuring rather than guessing: across six driven
games the answer came back **6 missions started, 0 finished, 0 multiballs, 0 jackpots, 0 lane sets.**
The whole back half of the game was unreachable. Three separate causes, each found by measuring the
one before it.

### 1. The rollover lane bank was too narrow, and its switches too high

Firing 714 balls up the middle at every angle and speed: **4 of them (0.6%) hit a lane.** Two
reasons, and the diagnosis was a histogram of where each ball was at its highest point:

- **78 of the 112 balls that got up there went up the OUTSIDE of the bank**, in two clumps at x 100
  and x 240. The four dividers spanned x 121..226 in a playfield 300 wide, so the gaps either side
  were wide open and that is where the ball went. The bank spans the whole crown now (x 78..270),
  with the outer dividers sealed 10 units from the inner arch, so anything that gets up there has to
  take a lane.
- **Of the 34 that did enter a channel, 4 tripped a switch.** The switches sat at y 84 with r 14;
  the rest stalled at y 100-110, just short. They are at y 112 with r 26 now, and the dividers start
  at y 140 instead of 108 so the channel is there to catch the ball on the way up rather than
  beginning above the height it reaches.

**0.6% to 7.6% per shot, and 85 of 94 high balls now take a channel.**

### 2. The mission targets were written for a table that no longer exists

None of the four had been re-derived after the playfield was rebuilt. **Measure them against the
average rate and all four read as impossible by 10 to 45 times - and that is the wrong instrument.**
A mission is a BURST, not a background rate; the ball is not in the bumper nest for most of a game
and nobody expects it to be. Against the best burst a driven game actually managed in one mission
window:

| | need | driver's best | |
|---|---|---|---|
| Bumper Rush | 14 in 26 s | 50 | comfortable, left alone |
| Spinner Mania | 45 in 26 s | 32 | unreachable -> **30** |
| Ramp Frenzy | 5 in 30 s | 4 | unreachable -> **3** |
| Target Storm | 8 in 26 s | 40 | comfortable, left alone |

`RAMPS_TO_LIGHT_LOCK` came down 5 -> 3 for the same reason: the lock is the only route into
multiball that does not go through a mission, and it needed a ramp count no measured game reached.

### 3. One awkward mission was holding the other three shut

The four missions run in a fixed order and `missionIdx` only advanced on a WIN, so failing the first
put the player straight back on the first one, for ever. Measured over ten driven games: **eleven
mission starts, all eleven Bumper Rush, and Spinner Mania, Ramp Frenzy and Target Storm never seen
once.** No amount of tuning Bumper Rush's number would have opened the other three. A failed mission
advances the ladder now; `missionsDone` still counts wins only, so the wizard is unaffected.

After it: the ladder rotates (bumper 7 / spin 3 / ramp 1 across the same ten games) and the lock
route came alive - 3 locks lit, 1 taken, from zero.

### And the test that should have existed all along

Nothing in `test.js` ever proved a mission could be COMPLETED. So "11 starts, 0 finishes" could have
meant *the rules are broken* or *a random driver cannot play*, with no way to tell them apart.
**Section 4a3 drives the whole chain deterministically** - bank, scoop, mission progress, ramp, all
through the real entry points and never by poking fields - and proves four missions complete in
order, that four completions start the wizard, that three locks start a multiball, and that a ramp
during multiball pays a jackpot. All five pass, so the machinery is intact and what remains is a
driver that cannot aim.

**Which is the honest limit of every number above.** A random driver is a poor player at aim and a
very good one at repetition; it can tell you a lane is geometrically unreachable, and it cannot tell
you whether a person can complete Bumper Rush. That needs a person.

## The rules

- 3 balls (5 on Casual). Ball save at the start of each ball, 12 / 8 / 3 seconds by table.
- **Missions**: clear the drop bank to light the scoop, shoot the scoop to start one. Four in fixed
  order (Bumper Rush, Spinner Mania, Ramp Frenzy, Target Storm), each timed and each scored off ONE
  kind of switch so the shot being asked for is obvious from the table, not only from the display.
- **Multiball**: 5 ramps light the lock, 3 locks start it. Ramp = jackpot (growing), 3 jackpots light
  the scoop for the super jackpot. Ends when one ball is left.
- **Wizard**: all four missions completed starts a 45-second 3-ball multiball at triple scoring.
  Ending it reopens the mission ladder, so a good player loops.
- **Bonus**: counted UP over 1.5 s at the end of every ball, because the count-up is the moment the
  player finds out whether chasing the H-U-B lanes was worth it.
- **Tilt**: three nudges inside the decay window kills the flippers, wipes the bonus and loses the
  ball. `_award()` returns early while tilted, so a tilted table scores literally nothing.
- Extra balls at 750,000 and 2,500,000, once each.

Scoring lives in one object, `PTS` in `game.js`. Retune there, nowhere else.

## Persistence

**`gamehub.pinball.v1` holds the difficulty and nothing else, and that is deliberate.** A pinball game's one piece of earned history is the score, and the obvious thing to
do is keep a local top-ten table — which would make `store.js` a second, unsynced, silently
truncating home for data a player earned. Instead the ONLY record of a pinball score is
`recordPinball()` in `js/game-stats.js`: per player, `Math.max` on both bests, mirrored to Firebase
by `stats-net.js`, combined across a person's devices by `players-agg.js`, displayed by My Stats.
`store.js`'s `bestScore()` READS that store to put the number on the setup screen; it never writes
one of its own. Nothing in this game's own storage can lose anything, because nothing earned is in
it. Both stored values are one-tap-recreatable preferences, so THE LAW rule 2's carve-out applies.

The `pb` sub-counter got all three of "Adding a game" item 7's edits on day one: `ensurePb` +
`recordPinball` in `js/game-stats.js`, `pinballScreen` in `js/game-stats-ui.js`, and an explicit
branch in `js/players-agg.js` (with a regression case in `players-agg.test.mjs`). Counters add; both
bests take `Math.max`. **Summing a best score would be the worst kind of wrong available here**: it
invents a game nobody played, and the shared store only ever grows, so it could never be undone.

## Testing

`node pinball/js/test.js` (wired into `run-all-tests.mjs`). 88 assertions in eight blocks:

1. **The solver** — gravity, restitution, the one-way gate in BOTH directions, that a swinging
   flipper throws the ball and a flipper held at its stop does not, the speed cap, ball-vs-ball.
2. **Table geometry** — no switch buried in a solid, everything on the table, the habitrail
   continuous and ending at the right inlane.
3. **The rules** — driven through the real contact and switch entry points, never by poking fields,
   so a rename in `game.js` fails the test rather than silently passing.
4. **The soak** — full games of random flipper input, asserting on EVERY step that no ball
   leaves the table, that nothing wedges, that balls really drain and that the ball count stays
   sane. It deliberately does NOT assert "every game finishes": random flipping is an
   unrealistically good pinball player, so a random driver on Casual legitimately keeps a ball alive
   for minutes, and failing on that would be testing the driver rather than the table. The full
   drain → bonus → next ball → game over chain is proved separately and deterministically in 4b.
5. **The recorder payload** — that `result()` reports the difficulty key and counters the stats layer
   expects.

`node test-game-conventions.mjs` covers the shared checklist (viewport, touch, overlays, the name
gate, the module contract, listener balance, the dictionary, the layout-class collision rule).

`node test-visual.mjs pinball` is the only suite that LOOKS at the game, and this one has a **PLAY
probe from day one** (`VISUAL-PROCESS.md` is the process it belongs to; the Pool incident in
`test-visual.mjs`'s PLAY header is why the rule exists). The probe holds the plunger the way a
player does, samples the canvas three times to prove the playfield is actually animating, then taps
the two flipper zones until the score moves. It asserts the score moved, which nothing but real
contacts with real scoring parts can do.

**There is deliberately no MOTION probe.** That harness follows a DOM element's bounding box over
time, and every moving thing in this game is drawn into one canvas: there is no element to follow.
Rather than invent one for the test's benefit, the canvas-shaped equivalent lives inside the PLAY
probe (three frames a fifth of a second apart, failing if they are identical), which catches the
same failure MOTION exists for. Every run still prints "No motion probe yet: pinball"; that is the
honest state and this paragraph is the reason.

## Every "Play again" left a loop running (2026-09-01)

Ported from Skeeball, which had this exact defect and fixed it on 2026-08-26
(`skeeball/CLAUDE.md`, "Frame rate: why it got slower the longer you played"). Found by an audit of
the whole hub for the same shape, not by a report.

`_startGame()` armed a rAF chain unconditionally, and it is reachable from **two** places: the setup
screen's Play, which `_renderSetup()` precedes with `_stopLoop()`, and the game-over card's "Play
again", which does not. `_frame` re-arms at the top of every frame and `_stopLoop()` only ever held
the LAST chain's id, so every "Play again" left the previous chain running with nothing able to
cancel it.

**The orphans outlive the game.** `destroy()` cannot reach them, so they keep stepping physics and
drawing **in the hub** for the life of the page — leave Pinball after a few replays and the
launcher, and whatever you open next, are sharing the frame budget with dead tables.

Measured in Chromium, counting rAF callbacks per half-second (one chain at 60 fps ≈ 30):

```
                                      before      after
one game running                          29         29
after three more "Play again"            116         29
after destroy(), back on the hub          87          0
```

The fix is `_startLoop()`, idempotent — `if (this.raf) return;` — exactly as in
`skeeball/js/ui.js:1275`. Re-run the count above after touching `_startGame`, `_frame` or
`_stopLoop`. **Nothing enforces this yet**: a `test-game-conventions.mjs` check for rAF idempotence
is planned but not written, so for now this defect is caught by reading the code, which is exactly
how it survived here for as long as it did.

## Things a future session will want to know

- **The speed cap is a DIFFICULTY knob now, not a correctness bound** (it was the other way round
  until 2026-09-06). The tick subdivides itself so a ball never advances more than 0.3 ball radii per
  micro-step whatever its speed, so `MAX_SPEED` no longer has to protect the walls. Raising it makes
  the table faster and nothing else. What still has to hold is `MAX_TRAVEL` against the thinnest
  surface on either board - ROYAL FLUSH's walls are radius 1, and 2.7 units of travel samples one at
  least four times on the way through.
- **A random flipper driver is not a playtest, and the soak's shot counts are not a playability
  measure.** Random flipping reached the orbit once and the scoop once across five games on a table
  where a measured flipper sweep puts the ball on the crown from the base of the paddle. What the
  soak is for is invariants - nothing off the table, nothing wedged, balls really drain - and it is
  good at those. For "is this fun", play it.
- **The static playfield art is cached into an offscreen canvas keyed on device-pixel size.** If you
  add painted art that needs to change during play, it does NOT belong in `_paintPlayfield`.
- **Reduced motion thins the garnish, it does not freeze the game.** Shake, full-screen flashers and
  most particles go; the ball, the flippers and the lamps stay. A pinball table that does not move
  is not a pinball table, and `test-visual.mjs` drives this game in that mode.
- **There is no sound, and no audio layer.** Not muted, not defaulted off: `audio.js` is deleted and
  nothing constructs an AudioContext (Matt, 2026-08-11: "Delete the sound option. No sound."). The
  setup screen has no toggle. It is one commit back in git if it is ever wanted again.
- **The How To Play screen follows the repo-wide pattern** in `docs/BUILDING-A-GAME.md` and nothing
  else: one bold sentence, ONE diagram carrying the non-obvious part, a caption, an X = Y example,
  then short plain rules. The first version was five paragraphs of prose that re-explained pinball
  to people who already know what a flipper is; what a player actually does not know is WHERE THIS
  TABLE'S FOUR SHOTS ARE, and that is a picture. If you add a mode, resist adding a paragraph.
- Spanish keeps the borrowed pinball vocabulary (flipper, bumper, jackpot, tilt, multibola) because
  that is what Spanish players say — the same standing rule that keeps Oros/Copas in English.

## The third board: RAINBOW, built from a spec (2026-09-08)

Matt handed over two reference images of a custom wooden table (a playfield render and a CAD
wireframe) plus a written design spec, and chose two things about it: it is a **third board inside
this game**, not a new hub game, and it is **faithful to the reference**, not restyled in
STARHUB's neon.

**PROVENANCE.** Unlike ROYAL FLUSH there is no source project here - the spec says plainly that no
rulesheet, manual or source code exists for the table in the images, and marks its own scoring
section PROPOSED. So the LAYOUT is a reading of the two images and the RULES are the spec's
proposal implemented as written. Nothing was taken from anybody's code.

| File | Role |
|---|---|
| `js/table-rainbow.js` | the playfield as data: walls, parts, sensors, paint. Pure |
| `js/rainbow.js` | `RainbowPinball` - the rules. Pure, same public surface `ui.js` already drives |
| `js/render-rainbow.js` | `RainbowRenderer` - **subclasses `render3d.js`** (see below) |

### The renderer subclasses STARHUB's, and that is the design

`render3d.js` already carries the parts that are hard and have nothing to do with STARHUB: the
camera framing (bisection on projected corners, then a film-back re-centre), the confetti thrown
clear of the machine's silhouette, the backglass with its resting face, the painted contact shadow
under each ball, the shake, the software-GL probe, `dispose()`. What IS about STARHUB is `_build`
and `render`, and those are the two things `RainbowRenderer` overrides.

Two small extractions in `render3d.js` made it possible and changed no behaviour: `_buildBackglass()`
and `_buildBalls()` came out of `_build`, and the backglass wordmark reads `this.brand` (STARHUB by
default) so a subclass can put its own board's name on the glass.

### The scale, and the two centre lines

350 x 690 in STARHUB's units with the same ball of radius 9, so `physics.js` runs it with no
constants of its own - the same gravity, the same `MAX_TRAVEL`, the same flipper sweep, four
playtests of tuning inherited rather than re-derived.

**`AXIS` is 155, not 175, and the first draft paid for missing it.** The cabinet is 350 wide
because the shooter lane eats the right-hand 40 units; the PLAY AREA is 4..306 and every left/right
pair is `x` and `310 - x`. Mirroring about the cabinet centre instead put the right wall straight
through the lane, and the very first launch hit it - the ball left the plunger at 1050 units/s and
was thrown sideways at 865 before it had cleared the lane. STARHUB's `table.js` carries the same
warning for the same reason.

The conversion is **two factors, and deliberately so**: the reference playfield spans image x
30..975 and y 10..1900, mapped onto 4..306 (0.320) and 4..684 (0.360). The 12% difference is the
shooter lane coming out of the width, and it makes this table slightly taller in proportion than
the photograph - which is closer to a real playfield (20.25in x 42in, about 1:2.07) than the
reference crop is.

### Three places the layout is not literal

1. **The main flippers.** Measured off the render their tips are about six ball widths apart, which
   is not a drain anybody can defend. The wireframe disagrees with the render here (its two bottom
   bars converge to nearly meet, and the render's tips are hidden behind the bottom bumper), so
   they use STARHUB's proven `dx` of 74 - a clear gap of 1.3 balls.
2. **The centre oval.** Drawn full size, because it is the largest single thing on the reference
   and the table does not read as that table without it. A HOLE 96 units across dead centre would
   swallow nearly everything coming down the middle, so the paint is full size and the scoop that
   captures is r 15 at its middle.
3. **The lower green kites are slingshots.** The spec reads all four green triangles as one-way
   gates. The upper pair are. The lower pair sit exactly where slingshots go, and a lower playfield
   with none has nothing to keep a ball alive.

### What the soak found, in the order it found it

Every one of these was a number, and every one was found by measuring rather than by reading:

| | measured | fixed |
|---|---|---|
| the right wall crossed the shooter lane | ball life **0.1 s**, 24 drains, score 0 | `AXIS` 155, mirror about 310 |
| the drop bank was unreachable | 7 drops and **1 cleared bank in six games** | 84 wide, 7-unit collider |
| a ball leaning on a target re-scored every tick | **1,777 standup awards**, 332,000 average | contact edge detection |
| posts a hair from the wall | balls parked at (20, 383) and (64, 530) | every pair OPEN (>18) or SEALED (<12) |
| the guide and the shelf converged to 15 units | 18 parked balls at (58, 209) and (253, 209) | overlapped into one blob |
| the search fought the flipper cradle | 82 searches in eight games | main flippers exempt |
| ...but exempting a DISC round the pivot | **74% of ball life** in four cells | measured against the bat |

That last pair is the one worth remembering. A cradle on a lower paddle is the player aiming and
must not be interrupted; a ball parked on an UPPER paddle cannot come back down, because the two
upper flippers are on the same two buttons and a raised one is a shelf in the middle of the table.
And the first cradle test used a disc round the pivot, which is a region the bat only sweeps a
third of - so it exempted everything BEHIND the flipper and hid a real wedge inside the exemption.

After all of it: **ball life 55 s, all eight soak games finish, no occupancy cell over 15%.**

### The centre scoop is deleted, and the lock moved to the drop bank (2026-09-08)

Matt, on the shipped board, with a zoomed screenshot: *"The ball got stuck here super fast. Delete
all that stuff in the very center. That's not a real thing. It's a flat painted thing on the board
in the ref photo. The circle thing that captures then throws the ball that you built throws the
ball up and catches it again. It repeats a handful of times."*

Both halves were right. The reference shows a **printed oval with no hardware in it**, and a scoop
that ejects straight up the middle of its own catchment will re-catch its own kick-out - the ball
cycles until the kick happens to be off-axis enough to escape. There is no collider, no sensor and
no rule in the centre now, only print, and `test.js` asserts both absences.

**The lock had to move with it.** The spec routes both of its rewards through the centre feature: a
cleared drop bank "lights one shot" at it, and the shot is the lock. With no shot to light, the
**bank IS the lock** - three cleared banks start the multiball - and **all three rows on one ball**
starts it outright, which is what lighting the lock was worth.

**The bumper did not move; the paint did.** The zoom also showed the bottom pop bumper sitting
inside the painted oval, which is not what the reference does. Moving the BUMPER to where the
reference puts it is not available: the flippers sweep a 63-unit arc from y 527 to 583 either side
of the centre line, and anything in the drain mouth is inside it - measured, a bumper at y 545 left
17.7 clear units from a resting paddle, a hair under a ball and the exact trap this file warns
about. Paint costs nothing to move, so the oval is smaller and higher than the reference's
proportion and the two no longer touch.

**Two more the same soak found:**

- **The outlane dividers converged on the side wall** instead of running parallel to it: 20 clear
  units at the top of the channel, 16 at y 520, **8.4 at the bottom**. A funnel that narrows past a
  ball halfway down, so a ball entering the outlane jammed rather than drained - 16.6% of all ball
  life in that one cell. They are parallel now, 21 to 23 clear throughout.
- **The edge detector alone does not debounce a target.** `_touchPrev` stops a ball that RESTS on a
  standup being paid every tick; it cannot stop one that MICRO-BOUNCES - contact, no contact,
  contact - which is what a ball rattling in a target cluster does, and it measured **1,595 standup
  awards in eight games**. A physical target switch is debounced for the same reason. 268 after.

**And a gap in the tests this exposed.** Removing the scoop made an import unused; dropping it took
`BALL_R` out of `_drain`, and **114 assertions passed against a board that threw on its first
frame** - because sections 9a and 9b drive the rules through their entry points and never run the
game loop. Section **9c** is 90 seconds of real `update()` calls, and it exists for that.

### The centre is empty, and the traps were swept out exhaustively (2026-09-08)

Matt, on the build after the scoop came out: *"The stuff in the center is still there. I want all
of that part gone. You have a giant circle thing."* And: *"The ball still gets stuck lots of
places - see screenshot. You need to play it or something to prevent this. It's not a good use of
my time if every test result is 'the ball gets stuck'."*

**The middle of the table is empty now.** Two pop bumpers, not three, and no painted oval. The
reference does draw a third starburst low on the centre line - but it draws it BELOW the flipper
tips, and that position is not available: the flippers sweep a 63-unit arc from y 527 to 583
either side of the centre line, so anything in the drain mouth is inside it (measured, a bumper at
y 545 left 17.7 clear units from a resting paddle, a hair under a ball). Put it high enough to
clear the sweep and it lands in the middle of the playfield, which is what he was looking at.

### `sweep-pinball-rests.mjs`, and why the soak could never have found these

**A soak is a sample.** A random flipper driver visits the parts of the table it happens to visit;
a trap in a corner it never reaches is invisible however many games you run. Every wedge in this
file above was found by squinting at an occupancy histogram after the fact, which is exactly the
process Matt is objecting to.

The new tool does not sample. It drops a ball, **at rest, on every point of a grid over the whole
playfield**, runs the real solver for six seconds, and asks whether it reached the drain. It names
the colliders holding each survivor, clusters them, and re-runs each one with a sideways push so a
ball balanced on a single post's apex - which no real ball can do - is reported as a knife edge
rather than a trap. `--held` sweeps the different table a player creates by holding the flippers.

On RAINBOW, in one afternoon:

| | at rest, not the drain | distinct places |
|---|---|---|
| as shipped | 252 of 829 drops | 50 |
| after the fixes below | **1 of 1,209** | 1 |
| flippers held | **2 of 854** | 2 |

And every fix came from the tool naming the pair, not from reading the file:

- **`shelf+guide`** - 26 drops at (57, 209), (253, 209) and (37, 197). The upper shelf and the wire
  guide converged as they descended, making a V with a mouth wider than a ball and a throat
  narrower. **This is the ball in Matt's screenshot.** The shelf now stops before the guide crosses
  it, so a ball rolls off the shelf, onto the guide, and down to the flipper - a chain, not a wedge.
- **`rub10+yell1`** - 31 drops. A rubber disc 17.4 clear units from the standup above it. Moved so
  it merges into the slingshot instead.
- **`sling0+wallL`** - 24 drops. The outlane MOUTH was 17 clear units against a ball of 18: too
  narrow to enter, wide enough to be squeezed into. It is 23 now, so the outlane is an outlane.
- **`wallL+rub0+stand0`**, **`stand1+stand5`** - the new denser target clusters, twice. Fixed by
  overlapping them into solid bars rather than spacing them.

**The rule the whole exercise comes down to** is already in this file and is worth restating: a
gap is either OPEN (more than 18 clear units, a ball passes) or SEALED (under about 12, a ball
cannot enter). Anything in between is a parking space. Nine of the ten fixes above were a number
between 12 and 18.

### The look was taken closer to the reference at the same time

Denser standup clusters in two staggered rows, olive discs merged into them, thirteen blue
rollovers instead of nine, red-capped posts on the wire guides, a printed pattern on the drop
targets, the perforated band under the top rail, the apron's three circles and the lower
playfield's shot arcs, flush corner circles (they are printed on the reference, and as colliders
they made a pocket), flatter rollover lenses, and warmer, glossier wood.

### "You think what you've created looks like this?" - no, and here is what was missing (2026-09-08)

Matt, with the reference photo beside a screenshot of the shipped board. He was right, and the
honest list is longer than the three things I first named. What actually separates a wooden
playfield from a picture of one, in order of how much each mattered here:

1. **The light.** The base renderer's studio is built for STARHUB - one warm key raking across a
   near-black deck, two coloured rim lights and a magenta lamp in the bumper nest. On a WOODEN deck
   that reads as a dim brown photograph taken at dusk. The reference is lit evenly from above with
   almost no shadow. `RainbowRenderer._build` retunes the scene's lights rather than `_boot`, so
   STARHUB is untouched.
2. **The camera.** STARHUB's 20 degree tilt exists to show off an arch in perspective. This board
   is a flat sheet photographed from above; at 20 degrees its crown foreshortens away and the whole
   read changes. `this.tilt = 10` (the base class reads `this.tilt`, defaulting to 20).
3. **The raised upper playfield.** The single most distinctive shape in the reference, and the
   first build drew a pale panel on a flat deck and called that the same thing. It is a real slab
   now with the octagonal front edge and a darker lip, and everything standing on it is in one
   raised group. The physics is untouched: the ball is DRAWN higher while its table y is above the
   edge, ramped over 14 units so it steps down rather than popping.
4. **The blueprint ghosts.** The reference prints large, very faint technical drawings across the
   whole deck - a dome in section, concentric circles, two wheel assemblies. Without them the wood
   is just wood.
5. **Density.** The reference playfield is CROWDED. The post count doubled, and every added post was
   checked against the open-or-sealed rule and then proved with a re-sweep.
6. **Part size and finish.** Bigger, glossier rollover lenses; wider posts with a proper collar;
   bigger green kites; bigger olive discs.
7. **The wood itself.** Pale, cool and matte - a varnished maple sheet - not the caramel stain the
   previous pass had warmed it to.
8. **Both side lanes.** The reference has a wide grey channel down each side; this table only has
   hardware in the right one, so the left is printed to match.

**What will never match, and it is a deliberate trade:** the reference's biggest single feature is
the giant dark oval and the starburst below it, dead centre. Matt asked for all of that gone -
*"I want all of that part gone"* - so the middle of this table is bare wood by instruction.
### The rules, which are the spec's

- Standups 500, yellows 250, pops 100, slingshots 50, drop targets 500 each.
- **All four drops** pays 5,000, raises the bonus multiplier (capped 5x) and lights the centre
  scoop. The bank resets after two seconds.
- **The rainbow rows**: each dot lights for 300 on its first pass and pays nothing while lit. A
  completed row pays 2,500, clears itself and advances the combo meter. **All three rows on one
  ball** pays 10,000 and opens the scoop for 20 seconds.
- **The scoop**: locks 1 and 2 pay 3,000; the third starts a 30-second multiball where every row
  rollover is a 5,000 jackpot, doubled if the combo meter is full.
- **End of ball**: the standups hit that ball, times the multiplier.
- 3 balls, one 7-second save per ball.

Where the spec left a decision open, the choice is recorded at the point it is made. The two worth
stating here: ball count is 3 to match the other two boards, and **the locked balls are virtual** -
locks one and two are counted and lit rather than physically held, because a real lock means a ball
sitting out of play while the player carries on with the next one, and the third lock releases all
three either way.

### Testing

`pinball/js/test.js` section 9. **9a is geometry** - the drain gap measured with the tip taper
included (the term STARHUB forgot, which shipped a 0.97-ball drain), no switch buried in a solid,
everything on the table, and the shooter lane's CLEAR width against the ball (the number ROYAL
FLUSH spent two builds ignoring). **9b drives the whole chain** through the real entry points and
never by poking fields: a row completes and clears, three rows pay the headline award and open the
scoop, a cleared bank raises the multiplier and lights it the other way, three locks start a
multiball, and a rollover during multiball pays a jackpot. Plus a `[KNOWN-BUG PROBE]` on the edge
detector, because **this repo has now met that bug three times** - STARHUB's scoop banking 1.5
million in one shot, ROYAL FLUSH's rollover paying eighteen times against a wall, and this board's
1,777 standup awards.

**Nobody has played it yet.** Every clip Matt has sent of this game has found something serious
while the suites were green, and that record is unbroken; the soak numbers above say the table
works, not that it is fun.

## The fourth board: FOUNDRY, the Claude Design export (2026-09-08)

Matt sent `3D Pinball Playfield.zip` - a three.js model of the wooden reference table built by
Claude Design - with six numbered corrections, then a seventh that reframed the whole layout:
*"the chute is BESIDE the game board. NOT part of it. The left wall of the chute is the rightmost -
final - wall of the actual playing board... Create the full board without the launch chute. Then
stick the launch chute onto the right side. Stop factoring it into the board."*

| File | Role |
|---|---|
| `design/board.js` | Claude Design's model, patched. Exports `buildBoard(THREE)`, `FOOTPRINTS`, `TRANSITIONS` |
| `design/three-d-stage.js`, `design/viewer.html`, `design/README.md` | the export as delivered, kept for provenance |
| `design/_playtest.mjs`, `design/_shots.mjs` | dev harnesses: the rest sweep and the shot map. Not shipped assets |
| `js/table-design.js` | the adapter - `FOOTPRINTS` in, `physics.js` colliders out |
| `js/design.js` | `DesignPinball` - the rules |
| `js/render-design.js` | `DesignRenderer` - **mounts the model group, does not convert it** |

**THE MODEL IS MOUNTED, NOT CONVERTED.** STARHUB's model had to be converted because the game was a
2D canvas at the time. There is no such reason now, and a conversion would be a second copy of the
geometry that could drift from the `FOOTPRINTS` the physics reads. `design/board.js` is the one
source and both sides read it.

### What was wrong with the export, and how each was measured

- **The ramps were flat rectangular boards, laid backwards.** `rampCurved()` replaces `inclineBox()`:
  eased elevation with a channel cross-section and raised rails.
- **The bands were faceted.** `smoothEdge(pts, step = 6)`, Catmull-Rom.
- **The centre band was missing**, with the saucer that belongs under its crown.
- **The flippers were about four balls apart** with a capture hole between them. `dx` retuned to a
  clear 0.039 m (1.4 balls); `bumper_lower` deleted.
- **`wall_bottom` had no drain gap.** 861 of 1,008 dropped balls rested on it and NOT ONE drained.
  Split into `wall_bottom_left` and `wall_bottom_right`; the 210 px between them is the drain.
- **The launch chute was 46 px against a 51 px ball** - it could not fit down its own lane. 69 px now,
  hung off the outboard face of the board's right wall.
- **The ramp mouths were unreachable, and the first three readings of that were wrong.** The shot map
  required the ball to pass THROUGH py 908; the backstop stops it there by design, and the ball rests
  against it at py 938. Counting CONTACT with the backstop instead: 0 hits became 28. Matt, while I
  was reshaping the ramp rather than moving it: *"you should have slid the ramp over to make it
  accessible, not change the shape."* The ramps stay the shape Design drew them.

### Three defects the driven play-test found, all edge-detection or delivery

1. **The launch delivered INTO the chute** (x 1020). The ball arrived on the deck outside its walls,
   fell off the front and was handed back to the plunger; a 60-second driven game scored zero.
   `LAUNCH_TO` is x 880, inside the board.
2. **A ramp re-fired on every bounce** - 1,056 awards in six games. `b._ramp` is an edge flag, and a
   ramp now delivers the ball INTO the deck (x 230 / 756, y 380) instead of back out its own opening.
3. **The board rendered mirrored**, chute on the left. `stage.scale.set(K, K, -K)`: the mount's -z
   double-negated with the model group's own `scale.x = -1`.

### Where it stands

Driven headlessly: **11,155 average, 6 of 6 games finishing, 9.1 s ball life**, both ramps and the
drop hole used. Level 2 is reachable on about **5% of flipper shots**.

**Three things are open and none is a bug:** 5% may not be the ramp rate a player wants; the outer
lanes dead-end at the ramp mouths rather than draining; and 9.1 s is short beside STARHUB's asserted
12 s. All three need a person, not another soak. **Nobody has played it yet.**

## The second board: ROYAL FLUSH, imported (2026-08-29)

Matt, on STARHUB: *"our pinball is FAR from being finished. Sure, it might have all those things,
but they don't work."* And on the 2026-08-20 pitch/friction attempt at his "vertical wall"
complaint: *"You tried, but it didn't make the game better."* Then: *"I'd rather you do what i said
and find a board someone else created and 'import' it. Our board is not worth salvaging."*

**PROVENANCE, stated plainly.** The ROYAL FLUSH playfield is **table9.json from Vector Pinball by
dozingcat** (https://github.com/dozingcat/Vector-Pinball). The layout is that project's design. Only
the conversion, the rules and the renderer here are ours. **Vector Pinball is licensed GPL-3.0.**
This repo carries **no license file** and Matt has explicitly not decided to add one: he asked to
use the boards without one, and was told plainly that "not making money" does not exempt a
distribution from that license. So this note is a record of where the layout came from - it is
**not** a claim of compliance. If the repo is ever made to comply, the missing pieces are the
license text and keeping the hub publicly readable. **Do not delete this paragraph to tidy up.**

### Why it is a whole second engine and not a `board` flag in game.js

`game.js` is welded to STARHUB's shot map: missions keyed off a scoop, a lock lit by five ramps, the
H-U-B lanes, `RAMP_PATH`. Royal Flush has none of them - no scoop, no H-U-B, four drop banks instead
of one, an upper right flipper. Threading two shot maps through one 849-line class would put a board
check on every rule in it. So:

| File | Role |
|---|---|
| `tools/import-vp-table.mjs` | GENERATOR: their JSON -> our shapes. Re-runnable |
| `js/table-royal.js` | GENERATED geometry. Do not hand-edit |
| `js/royal.js` | `RoyalPinball` - the rules, small and deliberately dumb |
| `js/render-royal.js` | `RoyalRenderer` - draws the geometry, vector style |

`RoyalPinball` and `RoyalRenderer` expose exactly the surface `ui.js` already drives, so the engine
choice is **one line** at mount and nothing downstream knows which board is running.

### What the import includes

Matt, after the first attempt: *"the fix is to implement the board exactly as is. Don't simplify or
change anything. Make it work with our gamehub setup but do not take any creative liberties."* The
first import broke that twice and both are fixed:

- **ALL FOUR LAYERS.** 1,315 wall segments - 585 on the playfield and 730 across the three elevated
  ramps - plus the 18 sensors. Seven of those sensors MOVE the ball between levels (an entry and an
  exit per ramp); the other eleven are event triggers, live only while the ball is on their layer.
  The first import kept layer 0 only, throwing away roughly half the table.
- **EVERY COLOUR IS THE TABLE'S.** 53 elements carry an explicit `color`; where one does not, the
  generator fills in **Vector Pinball's own default read from their source** (wall rgb(64,64,160),
  bumper rgb(0,0,255), rollover/drop/flipper rgb(0,255,0), spinner rgb(224,224,224)). 37 elements
  carry an `inactiveLayerColor`, which is how their renderer shows a ramp the ball is not currently
  on - honoured exactly. **No colour in `render-royal.js` is a choice of ours**, and the background
  is black because Vector Pinball is a vector game. If a colour looks wrong, the conversion is wrong.
- **Arcs are tessellated, not converted.** 21 of their 39 arcs are ELLIPTICAL, which our circular
  `arc()` cannot express. Each carries its own `segments` count, so the resolution is theirs.
- **What is NOT taken is their RULES** - the Java `Field9Delegate`. Scoring is the parts themselves
  at the source table's own point values. No missions, multiball, bonus or tilt yet.

**The renderer was wrong twice before this, both times my fault, not the table's:** first flat
hairlines in invented colours ("what? it looks terrible"), then an invented felt-green playfield with
a glow and a vignette - a creative liberty, which is the thing that was explicitly not wanted. The
file header records both so a future session does not decorate it again.

### Two things the first soak found, both worth keeping

1. **`kill: true` is the DRAIN, not a wall.** Built as a collider it becomes a solid floor: the
   first soak scored normally and **never drained once in four 240-second games**, because the ball
   bounced off the bottom of the table forever. `DRAIN_Y` now comes from that element's own y.
2. **Imported geometry parks balls, and the ball search is not optional here.** With the drain
   fixed, the soak logged **44 episodes of a ball sitting still for over 12 seconds**, one of them
   taking **185 rollover awards while parked in a lane** - a stuck ball that SCORES, the exact
   failure this file records STARHUB shipping once already. `_ballSearch()` measures DISPLACEMENT
   FROM AN ANCHOR, never speed, for the reason written up above: a wedged ball jitters. That took
   stuck episodes to **zero**. This is 583 segments we did not shape, so the watchdog is the safety
   net, not a tuning knob.

### The number this board exists to expose

**Their gravity, in our units, is 80. STARHUB's is 564.** A ball crosses their field in **3.87 s**
against STARHUB's **1.64 s** - their ball is **2.4x floatier**, on a layout people actually enjoy
playing. Their field is also shorter (600 vs 760) and their ball bigger (20 vs 18). Every axis says
the same thing: tighter, busier, slower. Whatever happens to Royal Flush, that comparison is the
most useful thing to come out of it, and STARHUB's own gravity should be read against it.

*(Those STARHUB figures are the 2026-08-29 ones and are kept as written. On the 2026-09-06 playfield
the same pitch reads 515 units/s^2 over a 694-tall field - 6.2 degrees, unchanged as an angle - and a
crown-to-drain free fall measures 1.55 s. The comparison and its conclusion are untouched.)*

### The bug actually behind "the ball never drains"

For two builds the ball almost never drained and parked constantly, and I blamed the physics: their
gravity was tuned against Box2D, our solver has no rolling, taking one without the other cannot
work. All of that is true. **None of it was the cause.**

**Their walls are zero-width lines** (`Box2DFactory.createThinWall`); ours are capsules. The import
gave every wall `r: 3`, and that radius is eaten out of every channel on the table FROM BOTH SIDES.
Their shooter lane is a 24-unit channel (x 374 to 398). Three a side leaves 18. **The ball is 20
across.** It could not fit down its own launch lane.

One 20-line histogram of where the ball actually sat found it immediately: **84% of ball life in the
top-right corner**, wedged at the top of a lane too narrow for it. `WALL_R = 1` leaves 22 units of
that 24-unit lane, and tunnelling stays bounded by a wide margin - 3.8 units of travel per step
against a ball+wall radius of 11.

Same soak, same seed, before and after:

| | before | after |
|---|---|---|
| parked over 12 s | 53 | **0** |
| drains across 5 games | 2 | **6** |
| ball searches | 358 | **40** |
| games reaching game over | 0/5 | **2/5** |

**The lesson worth keeping: profile where the ball IS before theorising about why it misbehaves.**
Three rounds of physics reasoning were downstream of one wrong constant.

Three of five games still run past 300 s, but that is the artifact STARHUB's own soak already
documents - a random flipper driver is an unrealistically good pinball player.

**Rolling friction was added along the way and is worth keeping** (`physics.js`'s `resolve()`).
`mu` is Coulomb now, bounded by the normal impulse, and `ball.spin` is a real degree of freedom
instead of a render-only fake that nothing ever drew. Plain Coulomb friction WITHOUT rolling made
this board dramatically worse (parked episodes 24 -> 96), because friction with nowhere to put the
energy can only brake: every slope became flypaper. STARHUB is untouched either way - all its
colliders pass `mu = 0`, so the branch multiplies out to zero.

### Four soaks said it worked. Playing it took thirty seconds to prove otherwise.

Matt, after the fourth green headless run: *"you need to play it."* He was right, and the first real
browser session found three things no headless test could:

1. **Every scoring event threw.** `ui.js`s `_drainEvents()` reaches into the renderer for each event
   - `R.hitBumper`, `R.spawnHit`, `R.kick`, `R.hitRamp`, `R.hitLane`, `R.popup` and more - and
   `RoyalRenderer` had none of them. One uncaught error per contact, forever. Those methods exist
   now: real where this board has something to show, honest no-ops where it does not (no scoop, no
   slingshots, no stand-ups).
2. **`ev.id.slice(3)` threw on every bumper hit.** That id is STARHUBs `pop0`/`pop1`/`pop2`; this
   board emits an index as `ev.i` and no id at all.
3. **The display named a shot the table does not have.** `_objective()` fell through every branch to
   `hint_bank` - "Drop the 4 targets" - which is STARHUBs bank.

All three are in the DOM/renderer glue, which `pinball/js/test.js` deliberately never constructs.
**So a green engine suite says nothing about whether this game runs.**

**`test-visual.mjs` CAN run on Matts machine**, and it was skipping for a fixable reason: it looks
for a Chromium and there is no playwright browser installed, but `playwright-core` IS in
`node_modules` and Chrome is at `C:\Program Files\Google\Chrome\Application\chrome.exe`. Point
`CHROMIUM_PATH` at it. There is no excuse for shipping this game unplayed again.

### Three more, all found by playing, none findable headlessly

A second real browser session, after the first one fixed the thrown events:

1. **`R.flash is not a function`.** `RoyalRenderer`'s constructor set `this.flash = new Map()`, and
   that instance property SHADOWED the `flash()` method `ui.js` calls. The Map is `flashes` now.
   A property quietly eating a method of the same name is invisible to anything that does not
   construct the class and then call it.

2. **A rollover paid out on every pass, forever.** Instrumented play showed the ball pinned against
   the left wall at x 16-20, y 400-430, drifting in and out of one lane: **eighteen awards over
   thirty-one seconds, 9,000 points, on ball one, with the player doing nothing.** It is the STARHUB
   scoop bug in a different coat. A lane LIGHTS now and pays nothing while lit; completing a set
   pays a bonus and clears it, which is what `RolloverGroupElement` is for.

3. **The ball rolled back down the shooter lane and died there.** Their table keeps it out with a
   `LaunchBarrier` wall their Java rules raise after a launch; it ships `disabled: true` and we do
   not take their rules, so nothing ever raised it. Result: launch, return, sit. **Score 0 for a
   hundred seconds with three balls unplayed.** `_shooterLane()` hands a slow ball in the lane back
   to the plunger - what a real machine does, and what STARHUB's own shooter-lane rest check does.

**And the ball search was measuring the wrong thing.** It reset its timer whenever the ball got 22
units from an anchor, so a ball oscillating in place kept resetting it and sat for thirty-one
seconds. It tracks a BOUNDING BOX over a window now: "not going anywhere" rather than "not moving".

After all three: ball one lasts about 75 seconds, drains, **the game advances to ball two**, ~20,000
points off 25 bumper hits, 10 drop targets and 2 cleared banks, no page errors, and no scoring
without a player. That is the first build of this board that is actually a game.

### The number that made it unplayable: `targetTimeRatio`

Matt, after the "playable" build: *"dude it's terrible. absolutely unplayable."*

He was right, and the cause was one field in the source table I had read past. `table9.json` carries
**`targetTimeRatio: 2.3`**, and Vector Pinball's `FieldDriver` uses it as the CLOCK:

```java
long fieldTickNanos = (long) (nanosPerFrame * field.getTargetTimeRatio());
```

**Their engine advances the world at 2.3x real time.** Run the same table at 1x - which is what every
build before this did - and every shot, drop, bounce and flip is 2.3 times too slow. A free fall down
the field takes **3.87 s instead of 1.68 s**. For comparison STARHUB's is 1.64 s and a real machine is
about the same. The board was not badly imported at that point; it was being played in slow motion.

`royal.js`'s `update()` multiplies the (already clamped) real dt by `T.TIME_RATIO`. Measured after,
in a real browser: peak ball speed **947-1036 units/s** where it had been ~200, the ball reaches the
top of the table (y 18), the score climbs continuously, and balls drain and advance.

**And the ball search now gives up.** Three failed shoves and the machine re-serves the ball to the
plunger, which is what a real machine does when ball search cannot find it. This board has narrow
pockets a sideways shove simply cannot empty - the shooter lane is one, and a browser session found
another on the right at about (363, 400-480) where the ball sat with the score frozen for twenty
seconds. Without the give-up rule a game can dead-end with balls still on the card, which is the
difference between hard and broken.

**Every one of these was a number that was in the source file the whole time.** The pattern across
this whole import is the same: wall radius, restitution, friction, and now the clock. When this board
feels wrong, the next thing to check is which of their constants is still being ignored - not our
physics.
## The setup screen scrolled inside itself on a short phone (2026-09-08)

Matt: *"I've told you several times before that I don't want any game in the gamehub to be
scrollable at all. Everything MUST fit on a single screen. Always."*

Measured by `check-no-scroll.mjs` at 390x664, standalone AND in the hub: `.pb-setup` scrolled
INSIDE ITSELF by 88px - a 664px box holding 752px (56px of top padding plus a 678px inner column).
Both 852px screens fit, so the trim in `pinball.css` is scoped `@media (max-height: 720px)`.

**This one had a scrollbar nobody could see coming.** `.pb-setup` is `position: absolute; inset: 0`
with its own `overflow-y: auto`, so the PAGE never overflowed and every page-level fit check in the
repo passed it. `check-no-scroll.mjs` walks the game's own root for elements that CAN scroll and
do, which is the only way this shape of bug shows up.

The 88px comes off spacing alone: the setup's top padding, the inner column's gap, and the brand
block's margin and font size. Nothing hidden, nothing under the UX floor.
