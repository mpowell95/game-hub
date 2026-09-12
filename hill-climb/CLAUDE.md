# Hill Climb — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below overrides
> them. The two fields in this game that THE LAW actually governs are called out under
> "Persistence" — read that section before touching `store.js`.

A 2D side-view physics driving game (a Hill Climb Racing clone), built 2026-08-02. Two pedals, no
steering: throttle and brake are also the only way to control the car's pitch, so balancing over
the hills IS the game. Coins earned per run buy upgrades, cars and stages in a garage between runs.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../hill-climb/js/ui.js'`, `immersive: true`, hub id `hill-climb` |
| Stats id | `hillclimb` (recorder `recordHillClimb`, sub-counter `hc`) |
| CSS root / prefix | `.hc-root` / `.hc-` |
| Settings key | `gamehub.hillclimb.v1` |
| Strings | `hill-climb/js/strings.js` (EN/ES, `makeT`, `onLangChange` in `ui.js`) |

**`immersive: true`** because the game owns the whole viewport: `.hc-root` is `position: fixed;
inset: 0`, exactly like Ball Run's, so both the garage and the play screen are edge to edge
standalone and mounted. The hub's header collapses to its floating back button, which the garage's
top row and the play HUD's top-left stack both leave clearance for (`padding-left: 78px` and
`margin-top: 44px` respectively).

**`isInProgress()` uses the LITERAL meaning** (root CLAUDE.md, "The module contract"), the same
class as Ball Run and Snake: `true` only while a run is live and not yet over. A run is live action
with no mid-run resume, so leaving genuinely abandons it and the hub should confirm. The garage is
never "in progress" — every change there (a purchase, a selection) is written to localStorage the
instant it happens, so backing out of it loses nothing.

## Layout: who owns what

Six modules, and the split is load-bearing — the first four are pure and DOM-free, which is the
whole reason `js/test.js` can drive complete runs headless under node.

| File | Owns |
|---|---|
| `js/catalog.js` | vehicles, stages, upgrade parts, prices, and `tunedSpec()` (the physics spec a car actually runs with, after its upgrades and the stage surface). Pure data + pure functions. |
| `js/terrain.js` | the infinite deterministic hill (`y`/`slope`/`normal`) and the lazily generated coin/fuel chunks. |
| `js/physics.js` | the vehicle simulation and the `Run` state machine (fuel, coins, flips, nitro, end conditions). |
| `js/store.js` | the garage save file: wallet, ownership, upgrades, per-stage records. |
| `js/render.js` | every pixel of the world layer (canvas). |
| `js/ui.js` | the DOM: garage screens, the play HUD, input, the clock, and the stats write. |

`ui.js` owns the clock and **every listener**; nothing in the other five touches the document.

## The physics model

Read `js/physics.js`'s header block first; this is the summary.

- **Coordinates are y-UP everywhere except `render.js`.** Angle is CCW-positive radians, 0 = level
  facing right. Only `render.js` flips to screen space (`worldToScreen`, and a
  `translate -> scale(s, -s) -> rotate(ang)` transform for anything drawn in vehicle-local meters).
  **Do not "fix" this by flipping the world**: every sign in `physics.js` — gravity, the normal
  force, throttle pitching the nose up — reads naturally in y-up and would all need rewriting.
- **The chassis is one rigid body; the wheels are contacts, not bodies.** From each wheel's
  chassis-local anchor we look one suspension length down the chassis' own down-axis, ask the
  terrain how deep the wheel is buried there, and turn that into a spring+damper force along the
  terrain NORMAL plus a drive/friction force along the terrain TANGENT.
- **The pitch coupling is emergent, not scripted.** Both forces are applied at the contact, which
  is below the center of mass, so the drive force pitches the nose up by itself. `spec.reaction` is
  a smaller explicit engine-torque term on top, and it is the number to tune if the car feels too
  flippy or too planted — it was cut roughly 25% on every vehicle during the first tuning pass
  because full throttle was looping the car in under a second.
- **Traction is a friction cone**: the tangential force is clamped to `grip * normalForce`. This is
  what makes a light rear wheel and an icy stage spin instead of climb, and it is the single reason
  the tires upgrade is worth buying. `w.slip` (how much the cone clipped) drives the wheel-spin
  visual, so what you see is what the sim actually did.
- **Beyond `spec.travel` a much stiffer term takes over** (`spring * 7 * over`). Without it a hard
  landing sinks the chassis straight through the hill.
- **The one fail condition is the driver's head touching the dirt** (`headPos()` vs one terrain
  probe). A car can land on its roof and survive for a moment; it dies when the head goes in. Cheap,
  and it is what makes flips genuinely risky.
- **Fixed timestep, 1/120 s, `MAX_STEPS` catch-up cap** (`ui.js`'s `tick`). A stalled tab can never
  make the car teleport through a hill on the next frame.

### Terrain

An analytic height field: four sine layers whose phases come from the run's seed, times an envelope
that flattens the first ~18 m into a launch pad and ramps amplitude up with distance. Because it is
a pure function of x it is never stored, streamed or rewound — the camera can look anywhere and the
physics can probe any x, including negative. `slope()` is a 2 cm central difference on purpose: the
analytic derivative would also have to differentiate the envelope's smoothstep, and 2 cm is well
under the accuracy a 40 cm wheel needs.

World objects are built per 50 m chunk, lazily, cached by chunk index and hashed off `(seed, chunk)`
so contents never depend on visit order. `itemsIn()` returns the SAME object instances every call,
which is what makes `it.taken` stick.

### The reachability rule (2026-08-02, after Matt's first play)

> "Some coins and gas tanks are impossible to get. There's no jump button... It's good to have
> coins in the air like that IF there's a ramp or jump you have to go off to collect them."

The first build placed every arc at a random 1.9-5.0 m above whatever terrain happened to be
underneath, **including dead-flat ground**. There is no jump, so a lot of them simply could not be
collected. The rule now is: a pickup is either reachable while driving, or it sits downrange of a
real ramp. Nothing else is allowed.

- **Ground arcs hug the terrain** at `GROUND_LIFT` (1.5 m). That number is derived, not taste:
  `Run.step()` collects within 2.4 m of the chassis centre, which rides 0.9 m (jeep) to 1.3 m
  (truck) up, so every vehicle sweeps these up just by driving through.
- **Fuel cans are ALWAYS ground-hugging** (`FUEL_LIFT`, 1.4 m) and never ride an air arc. A missed
  coin costs coins; an unreachable can ends the run, which makes it the one pickup that must never
  be a gamble.
- **Air arcs exist only downrange of a crest**, anchored to it, and clamped at both ends: never
  below `GROUND_LIFT` over the ground beneath them (nothing buried in the landing slope), never
  above `AIR_MAX` (4.2 m) over it.
- **`crestIn()` decides what counts as a ramp, and the test is PHYSICAL.** Following convex ground
  at speed `v` needs a downward acceleration of `v² · |y''|`, and only gravity supplies it, so the
  wheels leave the ground exactly when `|y''| >= g / v²` (`LAUNCH_SPEED`, 14 m/s, is the reference).
  A first attempt thresholded on SLOPE and was both wrong — a steep hill you crawl up throws you no
  higher than a gentle one you hit fast — and so strict that the Countryside had no ramps at all.
  The curvature form also adapts per stage for free: the Moon's low gravity turns nearly every
  crest into a launch.
- **`crestIn()` scans a GLOBAL grid**, snapping x to a multiple of `CREST_STEP`, so its answer never
  depends on which window you asked about. The generator asks per chunk and the reachability test
  asks per coin; those two disagreeing is how the first fix "passed" while still shipping orphans.

Guarded by `test.js`: a geometry sweep (all four stages, four seeds, 2.5 km each) asserting no can
is airborne, no coin is above the ceiling, and every airborne coin has a ramp behind it; plus a
DRIVEN sweep asserting **every fuel can driven past is collected** and >50% of coins are, with the
remainder being exactly the air arcs.

## Progression and the economy

Four vehicles (Hill Climber free, Dirt Bike 2,500, Monster Truck 8,000, Moon Rover 18,000) and four
stages (Countryside free, Desert 3,000, Arctic 9,000, Moon 20,000). Four upgrade parts per vehicle,
levels 0-6, `cost(level) = base * 1.7^level`. **Upgrades are per vehicle**, not global.

Each part moves exactly one axis of feel, so the four bars mean four different things on the hill:
engine → drive force, suspension → spring/damping/travel, tires → the friction cone, 4WD → front
wheel drive share (1.0 at max).

**Stages ARE the difficulty axis.** They map 1:1 and in unlock order onto the shared
easy/medium/hard/expert tiers (`stageDiff()`, and `HC_STAGES` in `js/game-stats.js`), so the
leaderboard's per-tier breakdown reads as the per-stage breakdown and there is no second difficulty
picker to reconcile. The Moon's low gravity is the reason it is genuinely expert rather than merely
slower: less weight on the wheels means less normal force, which means a smaller friction cone.

## The flip + difficulty rebalance (2026-09-12, TP's report)

TP reported five things: too easy (a light gas tap reached every fuel can, no risk of running out
or tipping, never a reason to go fast); car upgrades felt like nothing; the cars felt identical; a
single flip landed clean paid no bonus; and the bonus only ever seemed to want a double flip, which
was impossible to land. Measured headless (the scripts under scratchpad, driving the real modules),
**four of the five traced to one root: flips were physically impossible.**

- **Flips never paid because a flip was unrotatable.** `airTorque` was 2.1-3.2 and the air damping
  was 0.35, so in the ~1.1 s of air a countryside ramp gives, the best any car could turn was ~0.3
  of a rotation. A flip needs a full `2*PI`. So the bonus code was never wrong — nothing ever
  reached it. Fixed by making air rotation both **strong and responsive**: `airTorque` is now
  17-38 per vehicle (`AIR_DAMP` = 3.5 in `physics.js`), so gas spins the nose toward a terminal
  rate of `airTorque/AIR_DAMP` (~5-11 rad/s) AND letting go settles it — you can rotate a full turn
  and then bring the wheels back down to LAND it. The air `av` clamp is `±13` (grounded stays `±9`).
- **A flip now PAYS ON A CLEAN LANDING, not the instant the rotation completes.** `Vehicle.step()`
  accumulates `pendingFlips` while airborne and banks them (returns `landedFlips`, Run pays coins +
  the `flip` popup) only on touchdown when `!crashed`. Rotating onto the driver's head loses the
  pending bonus — that is the gamble. This matches exactly what TP asked for ("single flip, land it
  clean").
- **A visually complete flip lands a HAIR short of a strict airborne `2*PI`** (the car launches
  slightly nose-up and its wheels touch down before the last few degrees come round), and that
  near-miss touchdown used to reset `airSpin` and throw the whole rotation away. So a clean landing
  credits a rotation within `FLIP_LAND_TOL` (0.6 rad, ~34°) of complete. Safe because the
  head-in-dirt crash check already rejects a car that came down on its roof — anything that lands
  clean really is upright. **This one line is what actually made single flips pay**; without it a
  full visual backflip still scored zero.
- **Doubles are hard, not impossible.** On countryside a single is the normal trick and a double
  needs a big launch (nitro off a hill); the **bike is the flip specialist** (highest `airTorque`)
  and the **moon's** big air is where doubles are routine. Guarded by `test.js`: pending-vs-landed
  accounting, crash-loses-the-bonus, and a **landability** case that launches the bike/jeep and
  proves a single flip both completes and lands — so a future tuning change can't silently
  re-break it.

Difficulty (issue 1) and the "upgrades/cars feel the same" pair (2, 3) largely follow from the
above — the physics is dynamic now, so careless speed flips you and upgrades visibly change the
outcome (a maxed drivetrain roughly triples a countryside run). Two smaller changes on top:

- **Fuel is a resource again.** A can was worth 55 and appears in ~62% of 50 m chunks, so fuel only
  ever climbed and never mattered. Cans are now 44 (`terrain.js`) and idle burn is 2.8
  (`FUEL_IDLE`). Burn is time-based, so **covering ground faster costs less fuel per meter** — going
  fast is now rewarded, crawling is punished. Normal play is barely affected (a competent run still
  ends around the same distance); what it kills is the infinite-accumulation ceiling a skilled
  player had. `test.js`'s reachability guarantee (every can driven past is still collected) is
  untouched.
- **Suspension upgrades bite.** The damp coefficient went 0.12 → 0.20 and spring 0.10 → 0.13 per
  level (`catalog.js`), so a maxed suspension visibly plants the car on landings ("still bounces the
  same" — TP).

## Persistence

**`gamehub.hillclimb.v1`** (`js/store.js`) — the garage save. Two of its fields are earned history
and THE LAW governs them directly:

- **`earned`** — lifetime coins collected. **Only ever increments.** Never spent from, never
  recomputed, so no purchase, refund or future rebalance can walk it backwards.
- **`best`** — furthest meters per stage. **`Math.max` only** (rule 2), same as every other best in
  this repo.

**`coins` is the spendable wallet and is deliberately NOT monotonic** — a wallet you can spend from
is the game mechanic, and `earned` is the permanent record of it. This distinction is why the
shared stats store never receives the wallet: `hc.coins` there is the LIFETIME counter, so nothing
that can go down is ever written into `gamehub.stats`.

`load()` repairs anything missing or malformed, never throws, and preserves unrecognized keys (rule
5). A selection pointing at something unowned falls back rather than launching a car you have not
bought. `save()` logs loudly on failure (rule 6).

**No mid-run save key exists, on purpose** — see `isInProgress()` above.

## Stats (the shared store)

`recordHillClimb(distance, stage, { coins, flips })`, called once from `finishRun()` in `ui.js`,
wrapped in its own try/catch so a stats failure can never take the game down (the local save is
already committed by then).

Root CLAUDE.md's "Adding a game" item 7 needs THREE edits for a sub-counter, and all three landed
with the game rather than after a bug report:

1. `js/game-stats.js` — `ensureHc()` + its `normalize()` call, and `recordHillClimb`.
2. `js/game-stats-ui.js` — `hillClimbScreen()`, plus `hasPlays`/`headlineOf`/`TABS`/`HUB_ID`/
   `UNIT_KEY` entries. Stored is not enough (rule 1).
3. `js/players-agg.js` — the `else if (g === 'hillclimb' && src.hc)` combine branch. Without it the
   Stats screen reads zeroes the moment a person's second device syncs. Counters add; every
   distance best and `bestCoins` take `Math.max`. Regression case: `players-agg.test.mjs`.

Leaderboard: `hillclimb` is in `SOLO` (`players-agg.js`), so its plays count as RUNS, not wins.
`hcBestAt()` in `leaderboard-ui.js` is the per-tier metric (keyed by STAGE id, not a difficulty
word), and `fieldMaxOf`/`soloRating` in `leaderboard-rank.js` score it best-relative-to-field, the
same shape as Ball Run and Snake.

## Tests

`node hill-climb/js/test.js` (also inside `node run-all-tests.mjs`). 111 assertions covering
terrain determinism/continuity/pad, world-object determinism and lazy chunking, the physics rest
state, the throttle-tilt coupling (measured on the flat pad, where terrain slope cannot be the
cause), upgrades and stage surfaces changing the outcome, both end conditions, distance never
decreasing while reversing, pickups, nitro, flips, the head-crash probe, the whole economy, and
the two LAW-governed save fields across a full earn/spend/earn cycle.

Browser-verified 2026-08-02 (Chromium, 430x860 and 402x874 at dpr 3): garage, all four tabs, help,
a full run to a crash, pause, the result card, the stats write and the hub tile. The garage preview
is additionally verified against a deliberately DELAYED stylesheet, the exact condition that
produced the solid-red panel below.

## The garage preview measured 1x1 (2026-08-02)

Matt's phone showed the preview panel as a **solid red rectangle**. `renderGarage()` draws the
preview in the same task that sets `innerHTML`, and on a cold load the stylesheet — injected as a
`<link>` by `ensureCSS()`, therefore asynchronous — had not applied yet, so the canvas measured
about 1x1 CSS px. `resize()` cheerfully sized the bitmap to 3x3, drew three pixels of the middle of
the car into it, and **nothing ever redrew**; CSS then stretched those three red pixels across the
whole panel.

Three guards, because any one of them alone leaves a hole:

1. `Renderer.resize()` **refuses a degenerate box** (< 8 px either axis) and returns false without
   touching the bitmap, so a wrong-sized backing store can never be committed in the first place.
2. `drawPreview()` **retries on the next animation frame** while the box is still degenerate.
3. A **ResizeObserver** redraws whenever the canvas box actually changes — which is what covers late
   CSS, orientation changes and the hub's own mount transition, and is the piece that was missing.

`Renderer.draw()` (the play canvas) honours the same guard and simply skips the frame; the rAF loop
picks it up on the next one, so it self-heals with no extra machinery.

If you ever touch the preview path, reproduce with a throttled stylesheet rather than a normal load
— a warm cache hides this bug completely, which is why it shipped.

## iOS selected the HUD when you tapped a pedal (2026-08-02)

Matt: *"If you quickly tap the gas or brake a few times, the copy/paste screen pops up. Sometimes
the pedal is selected. It interferes with the game."*

Rapid taps read as a **double tap**, which is iOS's select-a-word gesture. Safari then hunts for the
nearest selectable text and latched onto the HUD's distance readout — which is why the
Copy/Translate bar appeared at the TOP of the screen while the finger was on a pedal at the bottom.
`-webkit-user-select: none` on `.hc-root` did not stop it: Safari does not reliably inherit that
into buttons, and the double-tap gesture bypasses it anyway.

Four layers, because no single one of them holds on its own:

1. **`-webkit-user-select` / `-webkit-touch-callout` / `-webkit-tap-highlight-color` on
   `.hc-root *`**, not just the root — the non-inheritance bug is the whole reason for the
   descendant selector.
2. **`.hc-pedal > * { pointer-events: none }`** so a touch can never land on the label text node;
   the button itself is always the target.
3. **A non-passive `touchstart` that calls `preventDefault()`** on each pedal. This is what stops
   the gesture ever starting. Because preventing the touch default makes the synthesised pointer
   events unreliable, **touch now drives the pedals directly** (keyed by `Touch.identifier`,
   prefixed `t` so it cannot collide with a `pointerId`) and the pointer path early-returns on
   `pointerType === 'touch'`. One authoritative path per input device; multi-touch still works
   because both paths key the same `this.pointers` map.
4. **A `selectstart` block plus a `selectionchange` backstop** that drops any selection anchored
   inside `.hc-root`. This is the layer that holds *regardless of which gesture path Safari used*,
   and it is the one worth keeping if the others are ever refactored.

Browser-verified (Chromium, touch emulation, 402x874 dpr 3): 12 rapid taps produce no selection and
no stuck pedal; a held touch drives; `touchend` releases; both pedals held at once release
independently; and a **deliberately forced** selection over the distance readout is removed
immediately. Mouse and keyboard paths re-smoke-tested for regression.

## The loop woke 60 times a second on the garage (2026-09-01)

`tick()` re-armed at the top and only THEN checked the screen, so from the moment the game mounted
it woke every animation frame — on the garage and the menu, screens that never animate — to do
nothing but re-arm itself and return. One chain, so nothing leaked; it was simply a permanent 60 Hz
wake on a phone, sharing the frame budget with whatever the player was actually reading.

Measured in Chromium, sitting on the garage for one second: **59 rAF callbacks before, 0 after.**

`startLoop()`/`stopLoop()` now bracket the play screen (`startRun()` starts it, the return to the
garage stops it), and `tick` lets the chain END rather than re-arming when `screen !== 'play'`.
`startLoop()` is idempotent for the same reason Pinball's and Skeeball's are.

**The garage preview's `_previewRaf` is a separate, one-shot chain and is untouched** — it is the
retry in the three-guard fix described under "The garage preview measured 1x1", and it must stay
independent of the play loop.

## Known gaps / next steps

- **No multiplayer.** There is no shared state to lockstep here (see `js/CLAUDE.md`'s Boggle
  section for the same reasoning); a race would be a "same seed, both drive, compare distance"
  protocol closer to Boggle's than to Chinchón's.
- **Light-only.** Like Ball Run's, this game's chrome is deliberately dark in both hub themes, so
  there is no `:root.gh-dark` block to keep in step. If a Phase 2 theme pass ever wants one, the
  garage palette is the four `--hc-navy*` variables.
- **Landscape is untuned.** The render scale is driven mostly by width so a tall portrait phone
  does not shrink the car to a speck; a wide short window gets the 68 px/m clamp and has not been
  play-tested.
- **No sound.** Neither has any other game in this repo.
- **The touch-input fixes cannot be regression-tested headlessly.** `js/test.js` is node-only and
  the behaviour is a browser gesture, so it is covered by the scripted Chromium pass described
  above rather than by the suite. Re-run that pass by hand if `bindPlay()` is touched.
## The garage cards scrolled inside themselves on a short phone (2026-09-08)

Matt: *"I've told you several times before that I don't want any game in the gamehub to be
scrollable at all. Everything MUST fit on a single screen. Always."*

Measured by `check-no-scroll.mjs` at 390x664, standalone AND in the hub: `.hc-body` scrolled INSIDE
ITSELF by 137px - four 107px cards, 453px of them, in a 324px box. Both 852px screens fit, so the
block in `hill-climb.css` is scoped `@media (max-height: 720px)`.

**Two columns rather than smaller cards, and that is the point.** This screen is FOUR cards, so its
height is four rows of card; trimming 34px off each one would have taken the note text with it.
Two columns makes it two rows and costs nothing but width, which this screen has - it is the same
grid the existing 620px-wide rule already switches to, asked for by height instead.
