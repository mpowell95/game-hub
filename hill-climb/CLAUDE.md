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

Browser-verified 2026-08-02 (Chromium, 430x860): garage, all four tabs, help, a full run to a
crash, pause, the result card, the stats write and the hub tile.

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
