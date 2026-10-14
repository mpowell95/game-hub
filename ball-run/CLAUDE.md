# Ball Run (`ball-run/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

Hub integration: in-hub `module:`, immersive. `isInProgress()` uses the LITERAL meaning: `true` while
a run is live. Ball Run is deliberately EXCLUDED from the repo-wide autosave/resume convention
(batch 9, docs/archive/HANDOFF-FB-RESUME.md, 2026-07-23; the only other exclusion is Snake): a live-action run
cannot pause across a hub navigation; **do not "finish" this by adding a save key.**

## Notes

Solo endless runner: steer a rolling ball down a neon track, dodge obstacles. Three.js/WebGL
(`render.js`, vendored `ball-run/vendor/three.module.min.js`), fixed-timestep sim (`sim.js`/`track.js`)
decoupled from rendering, `input.js` for touch/drag steering. Settings use the older dotted
`ballrun.*` keys (frozen per THE LAW). Results via `recordBallRun` (obstacle-count score, not distance;
see `js/game-stats.js`'s header for the metric-migration history) through a local "flight recorder"
(`ballrun.runLog.v1`) that retries any run that did not confirm reaching the shared store, on every
open.

- **Renderer teardown** calls `forceContextLoss()` after `dispose()` so hub<->game remounts do not
  leak WebGL contexts toward the browser cap. `Renderer.dispose(loseContext = true)` and
  `BallRunUI.teardownRun(fullExit = false)` (2026-07-22): **only the hub's real unmount forces context
  loss**; an in-place restart (Play, Play Again, back-to-setup) passes `false` and reuses the live
  context, because forcing loss on a context about to be reused left it permanently lost (the black
  screen on "Play Again").
- **i18n**: `ball-run/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Difficulty
  keys (`easy`/`medium`/`hard`, `ballrun.difficulty`) stay canonical; `config.js`'s
  `DIFFICULTIES[].label` stays English (a tuning module); `ui.js` maps the keys onto local tables.
  Display labels are the shared Easy/Medium/Hard (`diff_*`, normal case; stored values untouched).
- **Setup screen** (2026-07-24): standard 3-option segmented control (`.br-segmented`/`.br-seg`,
  `diffSegsHTML()`, `diffShapeSVG`/`tierOf`), the per-difficulty best line (`.br-best`), Play, `?`
  help. No prose blurb, no face icons, no slider (deleted).
- **How-to-play pager** (2026-07-24): `HELP_PAGES` in `ui.js` is 4 slides (steer / obstacles / edge /
  speedpoint), each inline SVG in the colours `render.js` really uses. Left button is a real
  **previous** (`help-prev`, disabled on slide 1), right is **next** (disabled on the last), **OK**
  always closes. `SEEN_HELP_KEY` first-open auto-open unchanged.

## Second map: Orbital (BALLRUNMAP2ORBITALSPEC.md, all four phases shipped 2026-07-29)

Spec source: `HANDOFF-BALLRUN-NEWMAP.md` (four correctness landmines live there). Phase 1 was a pure
colour re-skin; Split (2), Jump (3), Pickups (4) make Orbital mechanically different. Classic never
generates any of it (verified byte-identical seeded sims each phase).

- **`config.js`'s `MAPS` registry** (`{ classic, orbital }`, `mapConfig(key)`, `DEFAULT_MAP =
  'classic'`) is the map's single source of truth: `baseTrackWidth`/`minTrackWidth`, `difficulties`,
  `eventTypes`, `colors`. **Both maps point at the SAME `DIFFICULTIES` object reference, not a clone**:
  a Classic-only retune silently applies to Orbital until someone splits them deliberately.
  Orbital's colours are a first pass, not signed off (spec section 9).
- **`Track`/`Sim` take `(mapKey, difficultyKey, seed)`**; `Renderer` takes `(canvas, mapKey)` and
  resolves `mapConfig(mapKey).colors` once in the constructor (a new `Renderer` is built every run
  start, so a map switch applies on the next Play).
- **Setup**: a map picker (`.br-mapcards`/`.br-mapcard`, swatch built from `MAPS[key].colors`, no
  description text) above the difficulty control. Persists to **`ballrun.map`**.
- **Best scores (the THE LAW exposure):** local best is `ballrun.bestObstacles.<map>.<difficulty>`
  (`bestKey()` in `ui.js`). The old difficulty-only key is **frozen in place (rule 5)** and read once
  by `migrateBestScoresToMaps()`: copies forward to `...classic.<difficulty>` only if the new key does
  not exist, verifies by re-read, marks `ballrun.bestObstacles.mapMigrated.v1` only when every
  difficulty migrated clean (a mismatch retries next open). Shared store: Classic's `br` bucket is
  untouched; **`brOrbital`** (same shape: `runs`/`bestObstacles`/`bestObstaclesByDiff`) is Orbital's
  own. `recordBallRun(obstaclesPassed, difficulty, mapKey = 'classic')` picks the bucket; `total`/
  `byDiff` stay combined. `js/players-agg.js` has an explicit `brOrbital` branch; `js/game-stats-ui.js`
  and `js/leaderboard-ui.js` `brBestAt()` read both buckets (`Math.max` best, sum runs) so an
  Orbital-only player is never shown empty (rule 1); headings relabel "(Classic)"/"(Orbital)" only when
  `brOrbital.runs > 0`. `test-stats-replay.mjs` (real history, rule 7) pins Classic's shape.

## Split (Phase 2)

One wide segment with a void band down the middle, never two tracks (the single-centerline model,
one-segment collision check, `worldPointAt` and the camera stay untouched).

- Segments carry `void0`/`void1` (half-width, interpolated like `w0`/`w1`) and `voidCenter` (constant
  per event; 0 for `identical`/`obstacle`, an offset for `unequal`); all 0 for non-Split segments.
- `MAPS.orbital.split` owns every constant (`totalWidthBW` 13, `voidHalfBW` 2.5, Hold 10-18 segments,
  `cadenceM` 120, `sideObstacleChance` 0.35); Classic has no `split` key and `track.js` gates every
  Split path on `this.map.split`. Retuned wider/longer after Matt's "fork in the road" note; margin
  check `totalWidthBW >= 2*minTrackWidth + 2*voidHalfBW` (13 >= 11) must hold.
- `generateEvent()`: Split is a deterministic meter cadence like tunnels; **tunnel wins if both are
  due**; a due Split stays due for the next event. `emitSplit()` phases: Widen 3 / Open N / Hold /
  Close 3 / Narrow-back 3. **Open's length is fairness-derived**: `timeNeeded = voidHalf /
  lateralMaxAtSpeed(estimateSpeedAt(z))`, `openLength = timeNeeded * speed *
  OBSTACLE_SPACING_SAFETY_FACTOR`, reusing the same `Track` methods as obstacle-row spacing
  (**landmine #2, the "46m wall" bug: never hand-roll a second version**).
- Side variety (~50/35/15): `identical`, `obstacle` (rows confined to ONE lane, the other clean by
  construction, landmine #7), `unequal` (offset biased 40-100% of the headroom).
- **Hold can place 1-3 obstacle rows** in the chosen lane (`laneObstacleGapCenter(...)` returns a gap
  centre or `null` per slot; `obstacleRowIndices` proposes slots; `fillObstacleCubes` is the shared
  core with `buildObstacleRow`). An unreachable slot is left clean (no retry-push: the segment budget
  `holdSegs` is fixed up front).
- **Scoring**: +1, stamped `scoreOnce` on the Narrow-back phase's LAST segment only. After an event:
  `straightsOwed = cfg.minStraightAfter` and the obstacle-spacing chain
  (`pendingObstacleGapCenter`/`pendingObstacleRowZ`) resets, mirroring `emitTunnel()`.
- `Track.frameAt()` returns `voidHalfWidth`/`voidCenter`. **`sim.js` crash check**:
  `|lateralOffset - frame.voidCenter| < frame.voidHalfWidth` -> `beginCrash('edge')`.
- `render.js`: `_layoutFloor` draws a void segment as TWO floor strips (`floorPool`, `floorPool2`);
  `accentPool` amber planes draw the Widen-phase telegraph divider OR the void's two inner edges,
  never both on one segment; no instructional text anywhere (landmine #8). `dispose()` releases all
  pools (non-negotiable 7).

## Jump (Phase 3)

A real height axis, only when `this.map.jump` exists (Orbital).

- Segments gained `y0`/`y1` (interpolated) and `wCenter` (constant per segment). `Sim` gained `y`/`vy`
  and a new **`AIRBORNE`** state.
- **Forward speed is not player-controlled, so `Sim.launchJump()` computes the impulse AT LAUNCH from
  `this.speed`**, not the generation-time estimate: `vy0 = (landingY - 0)/t + 0.5*gravity*t`, `t =
  gapLength/speed`. `gapLength`/`landingY` ride on the gap's first segment (`jumpMeta`); `launchY` is
  hardcoded 0.
- `stepAirborne()`: same speed/steering model; vertical pure projectile; **no edge/obstacle/void check**
  while airborne; landing is detected by z crossing the landing edge (not by integrated `y`). Landing
  miss (`|lateralOffset - wCenter| > landingWidth/2` or inside the landing void) -> the same hazard
  path as everything else. Successful landing: snap `y`, `score += 1` directly.
- Difficulty, independently rolled: narrower pad, laterally offset pad, split pad (**needs its own
  dedicated width** `splitTotalWidthBW: 8`; normal 5-BW track cannot fit two 3-BW lanes), height change
  (drop more likely than rise). All config chances in `MAPS.orbital.jump`.
- **`emitJump()` searches every allowed `gapSegs` for the smallest apex** (for a step-up `vy0(t)` has an
  interior minimum, shortening is not monotonic); if none fits under the cap it drops the height
  variety (flat landing) rather than ship a violation.
- **Recovery ramp sequencing landmine** (same as Split): when the pad was split, the void reaches 0
  FIRST (width held), only then does width narrow back.
- **The offset-landing variety is NOT a `dcx` centerline shift, on purpose**: `lateralOffset` is
  measured against the segment's `cx`, so a `dcx` drift would carry an unsteered ball along. `wCenter`
  moves the safe zone without moving the reference frame; `voidCenter` is relative to `wCenter` when
  both combine. `sim.js` and `render.js` both read `wCenter`.
- `render.js`: the gap renders NOTHING (`isGap`); positions gained `midY`; the ball's height reads
  `sim.y`, NOT `worldPointAt`'s `y` (a look-ahead approximation for the camera only); the shadow stays
  on the deck reference and shrinks with height; **camera height damping `_camLagY`** moves position
  AND look-at together and **`camera.up` is never touched** (a banked camera was twice rejected).
- **Landing gates**: a `gatePool` (`GATE_POOL_SIZE: 4`) of vertical `obstacleEdge` planes at the pad's
  left/right edges (and a split pad's void edges), built from the same `voidHW`/`wCenter`/`halfWidth`
  as the floor strips. `pushSegment` has a `jumpLanding` boolean on the FIRST landing-hold segment
  only.
- **A missed landing goes through `spendLifeIfAny()` / the invincibility window like every other
  hazard** (it silently ignored banked lives until Matt's report, 2026-07-29). A saved-but-missed
  landing does **not** score the +1 (gated on `!missed`).

## Pickups (Phase 4)

Orbital only. A pickup is never its own event type: `maybePlacePickup()` runs at the end of every
`generateEvent()` and attaches `{ type, lateral }` to a plain `'straight'` segment of THAT call
(`_findPickupSlot()` excludes `isGap`, any `void1 > 0`, tunnels, obstacles).

- **Orbs**: pure bonus score (`orbValue: 1`, into `sim.score`; collection radius `radiusBW: 0.6`,
  forgiving). **Lives**: banked extra chance, `maxLives: 2`, spent automatically the instant a hit
  would end the run. **A grace WINDOW, not "survive this one hit"**: `spendLifeIfAny()` opens
  `lifeInvincibleS` (2s) during which obstacle/void/edge checks are skipped outright; never extended.
- **Shape as well as hue**: orbs are a small yellow SPHERE; the life is a pink (`0xffb3c6`,
  `colors.life` on both maps) extruded HEART (`buildHeartGeometry()`, Y-only medallion spin; a full
  tumble made it a blob). Pools `orbPool`/`lifePool` (6/2); bob and spin driven by `sim.elapsed`.
- HUD: hearts row `.br-hud-lives`/`.br-life` (CSS heart, `#ffb3c6`), persistent orb counter
  `.br-hud-orbs`/`.br-orb-dot` (hidden when `sim.track.map.pickups` is absent, i.e. Classic). Ball
  pulses its scale while invincible.
- `sim.pickupEvents` is drained (`splice(0)`) once per RENDERED frame in `ui.js frame()` ->
  `handlePickupEvents()`: `'orb'`/`'life'` spawn a "+1" `spawnFloater()` anchored to the HUD element
  whose counter changed (not the ball); `'lifeSpent'` shows the centred "Extra life used!" pill
  (`showLifeUsedBanner()`). Both honour reduced motion. `startRun()` resets `_lastShownOrbs`/
  `_lastShownLives` to -1, clears `.br-floaters` and the banner; `_lifeUsedTimer` is cleared in
  `destroy()`.

## Build status and open items

Complete (2026-07-29). Open, awaiting Matt's playtest: every tuning number (cadences, gap lengths,
apex cap, pickup cadences/values, the Orbital colour set); whether Splits/Jumps should count toward the
speed tier like tunnels; whether a missed-Jump-landing fall should read differently from a normal edge
fall; a wider variant map (mentioned once in the spec, never scoped). The real-browser life-pickup
collection path was verified only by direct `Sim.step()` runs. Tests: `node run-all-tests.mjs` only
when Matt asks; the relevant suites are `test-stats-replay.mjs`, `players-agg.test.mjs`,
`node validate-sw-assets.mjs`.
