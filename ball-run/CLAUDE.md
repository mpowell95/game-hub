# Ball Run (`ball-run/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`, immersive. `isInProgress()` uses the LITERAL meaning:
`true` while a run is live. Ball Run is deliberately EXCLUDED from the repo-wide
autosave/resume convention (batch 9, HANDOFF-FB-RESUME.md, 2026-07-23; the only other
exclusion is Snake) — a live-action run cannot meaningfully pause across a hub navigation;
do not "finish" this by adding a save key.

## Notes

Solo endless runner: steer a rolling ball down a neon track, dodge obstacles. Three.js/WebGL renderer (`render.js`, vendored `ball-run/vendor/three.module.min.js`), fixed-timestep sim (`sim.js`/`track.js`) decoupled from rendering, `input.js` for touch/drag steering. `immersive: true`. Settings under the older dotted `ballrun.*` keys (predates the `gamehub.<game>.v1` convention; frozen per THE LAW). Results recorded via `recordBallRun` (obstacle-count score, not distance — see `js/game-stats.js`'s header comment for the metric-migration history) through a local "flight recorder" (`ballrun.runLog.v1`) that retries any run that didn't confirm reaching the shared store, on every subsequent open. Renderer teardown calls `forceContextLoss()` after `dispose()` so repeated hub↔game remounts don't leak WebGL contexts toward the browser's context cap. `Renderer.dispose(loseContext = true)` and `BallRunUI.teardownRun(fullExit = false)` (2026-07-22): only the hub's real unmount forces context loss - an in-place restart (Play, Play Again, back-to-setup) passes `false` and reuses the live context, since forcing loss on a context about to be reused for a `new Renderer(canvas)` left it permanently lost (the black screen on "Play Again").

i18n: `ball-run/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Difficulty keys
(`easy`/`medium`/`hard`, `ballrun.difficulty`) stay canonical; `config.js`'s own
`DIFFICULTIES[].label` stays English (a tuning/config module, same discipline as `sim.js`/
`track.js`) — `ui.js` maps the same keys onto local translation tables instead.

Display labels (2026-07-24, batch A of the second feedback arc — Matt's reversal of batch 8's
Beginner/Intermediate/Pro): the shared Easy/Medium/Hard vocabulary (`diff_easy`/`diff_medium`/
`diff_hard` in strings.js), normal case (not all-caps). Stored `ballrun.difficulty` values are
untouched — label-only rename, same as every other game in this pass.

**Setup screen redesign (2026-07-24, batch A, Matt: "dumb... too many words. the emoji faces
don't make any sense. the yellow part of the difficulty bar doesn't move"):** the old setup
(prose blurb, a big face icon per difficulty, a range slider whose fill never actually tracked
the selected value) is gone. Replaced with the standard 3-option segmented control every other
game uses (`.br-segmented`/`.br-seg` in `ball-run.css`, same shape as Connect Four/Nuts & Bolts):
colored ski-slope shape (`diffShapeSVG`/`tierOf`, `js/difficulty-tiers.js`) + label, built by
`diffSegsHTML()` in `ui.js`. `FACE_SVGS` and the slider markup/CSS are deleted entirely. Setup
keeps: title, the per-difficulty best line (`.br-best`), Play, and the `?` help button.

**How-to-play pager restored (2026-07-24, HANDOFF-FB2-HOWTO2 item 2):** the 2026-07-23 single-
static-diagram sheet is gone; Matt wanted the pager back ("I liked the slide show better. I
didn't want it removed. I just wanted it to be fixed"), plus a missing obstacles slide since
obstacles are the main thing being dodged. `HELP_PAGES` in `ui.js` is 4 slides (steer / obstacles
/ edge / speedpoint), each with its own inline SVG drawn in the same colors `render.js` actually
uses. The left button is now a real **previous** (`help-prev`, disabled on slide 1) — the pre-
af8c212 pager's `|←` was skip-to-first with no prev at all, which read as "brings you back to the
first page every time" (Matt's bug report). Right button is **next** (disabled on the last
slide); **OK** always closes. `SEEN_HELP_KEY` first-open-auto-opens-help behavior is unchanged.

## Second map: Orbital (BALLRUNMAP2ORBITALSPEC.md, Phase 1 shipped 2026-07-29)

Build brief: the uploaded `BALLRUNMAP2ORBITALSPEC.md` (source: `HANDOFF-BALLRUN-NEWMAP.md`).
Four phases; only **Phase 1 (map plumbing)** is done. Orbital is selectable and fully playable,
but its rules are byte-identical to Classic's — same `DIFFICULTIES`, same event-type pool
(straight/narrow/obstacle/tunnel), same geometry constants. It is a **pure color re-skin** on
purpose (spec section 7: "Orbital exists but is a pure visual re-skin of Classic's rules. Ship
it."). Phase 2 (Split) and Phase 3 (Jump) are what make it mechanically different — not built yet.

- **`config.js`'s `MAPS` registry** (`{ classic, orbital }`, `mapConfig(key)`, `DEFAULT_MAP =
  'classic'`) is the map's single source of truth: `baseTrackWidth`/`minTrackWidth` (both equal
  to Classic's for now — Phase 1 does not retune geometry), `difficulties` (both maps point at
  the SAME `DIFFICULTIES` object reference, not a clone — a future Classic-only retune would
  silently apply to Orbital too until Phase 2/3 deliberately splits them; do that split
  explicitly when it's needed, don't let it happen by accident), `eventTypes`, and `colors`
  (Orbital's own set: near-black navy void, dark slate deck panels, a continuous amber `#ffce3a`
  edge stripe, light-gray obstacles with an amber outline, an amber-chevron tunnel, a pale cyan
  ball — spec section 5. **Colors are a first pass, not signed off** — spec section 9 lists this
  as an open item for Matt).
- **`Track`/`Sim` constructors both take `(mapKey, difficultyKey, seed)`** now (was
  `(difficultyKey, seed)`); `Track` reads `this.map = mapConfig(mapKey)` for
  `baseTrackWidth`/`minTrackWidth` everywhere it used to read the flat `BASE_TRACK_WIDTH`/
  `MIN_TRACK_WIDTH` constants (construction, `pushSegment`'s width floor, `emitNarrow`'s taper
  target, `frameAt`/`localFrameAt`'s off-track fallback).
- **`Renderer` takes `(canvas, mapKey)`** and resolves `mapConfig(mapKey).colors` once in the
  constructor for every texture/material it builds — never per frame. This satisfies the spec's
  "renderer rebuilds its textures and materials when the map changes, at setup time only" for
  free: `ui.js` already constructs a brand-new `Renderer` on every run start/restart (`Renderer.
  dispose()`'s existing teardown-and-recreate pattern), so a map switch on the setup screen is
  picked up the next time Play is tapped, with no separate "rebuild" code path needed.
- **Setup screen**: a map picker (`.br-mapcards`/`.br-mapcard` in `ball-run.css`) sits above the
  existing difficulty segmented control — two cards, a small inline-SVG swatch built straight
  from that map's own `MAPS[key].colors` (never a separate art asset) plus a label, no
  description text, per spec section 4. Selection persists to **`ballrun.map`** (new, dotted
  `ballrun.*`-style key, same generation as `ballrun.difficulty`/`ballrun.seenHelp`).
- **Best scores — the THE LAW exposure the spec called out, section 4.** Two independent stores,
  both split per-map now:
  - **Local instant-read best**: was `ballrun.bestObstacles.<difficulty>`, now
    `ballrun.bestObstacles.<map>.<difficulty>` (`bestKey()` in `ui.js`). The old difficulty-only
    key is frozen in place (THE LAW rule 5) and read exactly once by
    `migrateBestScoresToMaps()`: copies each old value forward to
    `ballrun.bestObstacles.classic.<difficulty>` **only if the new key doesn't already exist**
    (never overwrites a real post-migration value), verifies by an immediate re-read, and only
    marks itself done (`ballrun.bestObstacles.mapMigrated.v1`) once every difficulty either
    migrated clean or had nothing to migrate — a re-read mismatch leaves the guard unset so the
    next app open retries, mirroring the existing `RUN_LOG_KEY` retry pattern in the same file.
  - **Shared cross-device store** (`gamehub.stats.games.ballrun`): Classic's `br` bucket is
    **completely untouched** — no migration needed at all, because every pre-Phase-1 run genuinely
    IS a Classic run (Orbital didn't exist yet). A new sibling key, **`brOrbital`** (same shape:
    `runs`/`bestObstacles`/`bestObstaclesByDiff`), is Orbital's own bucket, additive from zero.
    `recordBallRun(obstaclesPassed, difficulty, mapKey = 'classic')` picks the bucket by map;
    `total`/`byDiff` stay combined across both maps (an overall Ball Run play count is still
    meaningful regardless of which map). `js/players-agg.js`'s cross-device combine got an
    explicit `brOrbital` branch alongside `br`'s (root CLAUDE.md's "Adding a game" item 7: a
    sub-counter with no branch there is silently dropped the moment a second device syncs — this
    was added from Orbital's first day, not bolted on after a report). `js/game-stats-ui.js`'s
    Ball Run screen, `hasPlays`/`headlineOf` gates, and `js/leaderboard-ui.js`'s `brBestAt()` all
    read both buckets now (`Math.max` for the headline best, sum for runs) so a player who has
    only ever played Orbital is never shown as empty (THE LAW rule 1) and Classic-only players see
    byte-identical output to before (the `gs_br_best_by_diff` heading text is unchanged unless a
    device actually has `brOrbital.runs > 0`, in which case it's relabeled "(Classic)" alongside a
    new "(Orbital)" table).
  - **Verified**: `node run-all-tests.mjs` all green (20 suites, 0 failed) — in particular
    `test-stats-replay.mjs` (Ball Run's real-history replay, LAW rule 7) and
    `players-agg.test.mjs` needed no changes to keep passing, confirming Classic's shape is
    genuinely untouched. A standalone headless check of `migrateBestScoresToMaps()`'s exact logic
    (old key untouched, new key created once, a real post-migration value never clobbered by a
    re-run) is in this milestone's session notes, not committed as a repo script.
- **What was NOT done in Phase 1 (now done, see Phase 2 and Phase 3 below):** Split, Jump. **Still
  not done:** pickups (spec's Phase 4, deliberately deferred). Orbital's own difficulty/geometry
  tuning is also still Classic's numbers verbatim outside of Split's/Jump's own constants —
  retuning the rest is explicitly out of scope (spec section 6).

## Split (BALLRUNMAP2ORBITALSPEC.md, Phase 2 shipped 2026-07-29)

Orbital's first mechanically-different event, Classic still has none of this. **One wide segment
with a void band down the middle, never two separate tracks** — the whole point (spec section 2)
is that the single-centerline coordinate model, the one-segment collision check, and everything
built on top of them (`worldPointAt`, the camera, obstacle placement) stay completely untouched.
No height axis; that's Jump (Phase 3, not started).

- **Data**: every segment gained `void0`/`void1` (world units, interpolated exactly like `w0`/`w1`
  — the half-width of the void band, ramping within a segment during Open/Close) and `voidCenter`
  (world units, constant across a whole Split event — 0 for the `identical`/`obstacle` side
  varieties, an off-centerline offset for `unequal`). Both default to 0 for every non-Split
  segment, so Classic and every other Orbital event type are unaffected — verified by re-running
  the exact same seeded headless Classic sim as Phase 1's own check and confirming byte-identical
  output (same steps/state/score/z).
- **`config.js`'s `MAPS.orbital.split`** owns every Split constant (`totalWidthBW: 9`,
  `voidHalfBW: 1.25`, phase segment counts, `cadenceM: 120`, the side-variety chances) — Classic's
  map object has no `split` key at all, and `track.js` gates every Split code path on
  `this.map.split` being truthy, so `'split'` can never be picked for a map that doesn't define
  it. **These are still the spec's own "starting guess" numbers (section 6), not retuned.**
- **`Track.generateEvent()`**: Split is a deterministic meter cadence like tunnels
  (`lastSplitZ`/`cadenceM`), never drawn from the weighted-random pool. Tunnel wins if both are
  due on the same tick (tunnels stay the speed-pacing backbone, spec section 6); a due Split
  otherwise stays due and fires on the very next event, same pattern the obstacle scheduler
  already used against tunnels. The first-obstacle-window worst-case-span veto (the "46m wall"
  fix's sibling) got a `'split'` case for correctness, though in practice Split's own ~120m
  cadence means the 40-60m first-obstacle window always closes before a Split could ever be due.
- **`Track.emitSplit()`**: five phases (Widen 3 / Open N / Hold 4-7 / Close 3 / Narrow-back 3),
  built with the same `pushSegment` calls every other event type uses.
  - **Open's length is fairness-derived, not the spec table's "4" guess** (section 2, "do not skip
    this"): `timeNeeded = voidHalf / lateralMaxAtSpeed(estimateSpeedAt(z))`, then
    `openLength = timeNeeded * speed * OBSTACLE_SPACING_SAFETY_FACTOR`, reusing the EXACT same
    `Track` methods obstacle-row spacing already uses — landmine #2, the precise mistake that
    caused the original "46m wall" bug, deliberately not hand-rolled a second time.
  - **Side variety** (~50/35/15, rolled once up front): `identical` (both lanes clean),
    `obstacle` (one Hold segment gets a `buildLaneObstacleRow()` row confined to ONE lane — the
    other is never touched by that call, so it stays clean *by construction*, not by a separate
    check — landmine #7), `unequal` (`voidCenter` offset within the headroom
    `SPLIT_TOTAL_WIDTH/2 - voidHalf - minTrackWidth` leaves both lanes, biased 40-100% of that
    headroom so it's never maxed out every time).
  - `buildObstacleRow`/the new `buildLaneObstacleRow` now share a `fillObstacleCubes(loBW, hiBW,
    gapLo, gapHi)` core (a pure refactor — full-width obstacle rows are byte-identical to before);
    `buildLaneObstacleRow` is the same anchor-at-the-gap-edge logic applied to an arbitrary
    `[loBW, hiBW]` range instead of `[-half, half]`.
  - **Scoring** (`scoreOnce`, section 2: "+1 on clearing a Split, same as clearing an obstacle
    row"): stamped on the Narrow-back phase's LAST segment only, one point for the whole event no
    matter how many segments it spans — verified for every generated event across 90 seeded runs
    (3 difficulties × 30 seeds) that each Split has exactly one `scoreOnce` segment.
  - Forces `straightsOwed = cfg.minStraightAfter` and resets the obstacle-spacing chain
    (`pendingObstacleGapCenter`/`pendingObstacleRowZ`) after, mirroring `emitTunnel()` exactly —
    the width swing invalidates the previous corridor reference no less than a tunnel's does.
- **`Track.frameAt()`** gained `voidHalfWidth`/`voidCenter` in its return value (0/0 for every
  non-Split frame), interpolated the same way as `width`.
- **`sim.js`'s crash check**: `Math.abs(this.lateralOffset - frame.voidCenter) <
  frame.voidHalfWidth` triggers `beginCrash('edge')` — reuses the existing FALLING state and
  game-over path verbatim, exactly as the spec's "Sim change (small)" promised. Verified via real
  `Sim.step()` calls (not just direct state pokes): a ball centered in an open void falls, a ball
  in either clear lane doesn't.
- **`render.js`**: `_layoutFloor` renders a void-bearing segment as TWO floor strips (`floorPool`
  = left, the new `floorPool2` = right, index-paired, both hidden whenever a slot's segment has no
  void — i.e. always on Classic and most of Orbital too, so this costs nothing outside an actual
  Split). A new `accentPool` (thin amber `MeshBasicMaterial` planes, `this.colors.obstacleEdge` —
  the same "attention" amber Orbital already uses for obstacle/tunnel edges) draws either the
  Widen-phase telegraph divider at lateral 0 (section 2: lit once, no instructional text anywhere
  — landmine #8) or the void band's two inner edges (section 5: "same amber stripe on both inner
  edges"), never both on one segment. `dispose()` releases all of the new pools' geometries/
  materials/textures — non-negotiable 7 still holds.
- **Verified**: `node run-all-tests.mjs` all green (20 suites, 0 failed; no suite needed changes).
  Headless: 90 seeded generations (3 difficulties × 30 seeds) checked void-vs-track-width bounds,
  both-lanes-≥-minTrackWidth, telegraph-never-overlaps-an-open-void, obstacles-never-inside-the-
  void, and exactly-one-`scoreOnce`-per-event — zero violations. `Sim.step()` calls confirmed the
  void crash fires/doesn't fire exactly where expected. Browser (Playwright): direct
  Sim+Renderer construction confirmed the telegraph line, the two-strip void rendering (clear lane
  and dead-center-in-the-void views), and the `unequal` variety's asymmetric strips all render as
  designed; **15 full real-input runs** (actual Play button, actual randomized pointer-drag
  steering through `input.js`, actual restart flow) on Orbital/Easy produced zero page errors and
  zero console exceptions, with two runs surviving well past the first Split's ~120m cadence
  (164m and 112m) — confirming the whole integration (rendering, physics, HUD, scoring, restart)
  holds up under real play, not just scripted state.

## Jump (BALLRUNMAP2ORBITALSPEC.md, Phase 3 shipped 2026-07-29)

The spec's own flagged biggest lift: a real height axis, on a game that had never had one. Only
reachable when `this.map.jump` exists (Orbital), so Classic never generates or steps through any
of this — verified by re-running the same seeded headless Classic sim as Phase 1/2's own checks
and confirming byte-identical output.

- **Segments gained `y0`/`y1`** (world units, interpolated exactly like `w0`/`w1`/`void0`/`void1` —
  0 for every non-Jump segment) and **`wCenter`** (world units, constant per segment like
  `voidCenter` — see its own landmine below). `Sim` gained `y`/`vy` (the ball's real height and
  vertical velocity) plus a NEW `AIRBORNE` run state, distinct from `PLAYING`/`CRASHING`/
  `FALLING`/`GAME_OVER`.
- **The critical design rule, implemented literally**: forward speed is not player-controlled, so
  `Sim.launchJump()` computes the launch impulse AT THE MOMENT OF LAUNCH from `this.speed` (the
  ball's actual current speed that tick), not `track.js`'s generation-time estimate -
  `vy0 = (landingY - 0) / t + 0.5 * gravity * t` where `t = gapLength / speed`. `gapLength`/
  `landingY` are baked onto the gap's first segment (`jumpMeta`) at generation time; `launchY` is
  hardcoded to exactly 0 rather than read from `this.y` at the trigger tick, since fixed-timestep
  stepping can already be a little way into the gap's own height ramp by the instant this fires.
- **`stepAirborne()`**: identical forward-speed/lateral-steering model to `stepPlaying()` (section
  3: "steering still works"), but vertical motion is pure projectile integration
  (`vy -= gravity*dt; y += vy*dt`) with **no edge/obstacle/void check** (explicit in the spec) -
  only the landing check can end it. Forward speed keeps ramping during flight exactly as if
  grounded, so real flight time comes out a little SHORTER than planned (never longer), meaning
  the ball lands marginally past the computed point, never short (section 3's own note) - landing
  is detected by z actually crossing the landing edge, never by trusting the integrated `y` at a
  precomputed time, so no fudge factor is needed.
- **Landing** (section 3, literal): the instant z crosses into a non-gap segment, check
  `|lateralOffset - wCenter| > landingWidth/2` or inside the landing's void band - either crashes
  (`beginCrash('edge')`, the existing FALLING state, no new game-over path; "yes, missing the
  landing kills you"), otherwise snap `y` to the target, zero `vy`, resume `PLAYING`, and
  `score += 1` directly (a one-time event, not `updateScore()`'s generic segment-crossing scan -
  unlike Split, no segment carries a scoring flag for Jump).
- **Difficulty, independently rollable** ("pick one or more per jump", not Split's mutually
  exclusive side-variety): narrower landing pad, laterally-offset landing pad, landing pad itself
  split, and a height change (drop more likely than a rise). All four config-driven chances in
  `MAPS.orbital.jump`.
  - **A split landing pad needs its OWN dedicated width** (`splitTotalWidthBW: 8`), not whatever
    the `narrower` roll would have picked - Orbital's normal 5-BW track can't fit two
    minTrackWidth (3 BW) lanes at all (2×3=6>5), the same reason Split's own event widens before
    opening a void. Found via a generated-track audit (an early version's feasibility check could
    never actually pass, since the ambient width was structurally too narrow).
  - **The apex cap can't be satisfied by monotonically shortening the gap** (a second bug found via
    audit): for a flat/drop-down landing, a shorter gap always lowers the required launch
    velocity, but for a STEP-UP the relationship inverts - `vy0(t) = landingY/t + 0.5*gravity*t`
    diverges as t shrinks toward 0 just as much as it does as t grows large (a genuine interior
    minimum, not a monotonic edge), so a very short, fast flight leaves no time to climb and needs
    an EVEN BIGGER impulse. `emitJump()` now searches every `gapSegs` value actually allowed
    (`gapMinSegs`..`gapMaxSegs`) for whichever keeps the apex smallest, and if NOTHING in range
    fits under the cap, drops the height variety entirely (flat landing) rather than ship a jump
    whose apex violates the spec's own cap - the same "drop rather than ship a violation"
    principle `placeObstacleRow`'s 3b.3 already uses.
  - **The recovery ramp has the exact same width/void sequencing landmine Split's own event
    does** (a third bug found via audit): when the landing pad was split, shrinking width and void
    back to baseline SIMULTANEOUSLY can pass through an intermediate segment where neither the
    full split-landing width nor the narrowed single-lane width is actually present, breaking the
    two-lanes-≥-minTrackWidth invariant even though both endpoints are individually safe. Fixed
    the same way Split's Close-then-Narrow-back already is: void reaches 0 FIRST (width held at
    the landing value), only then does width narrow back (void already 0).
  - **The offset-landing variety is NOT a `dcx` centerline shift, on purpose** - this is the
    landmine worth remembering. A `dcx` drift (what curves use) moves `cx` itself, and the ball's
    `lateralOffset` is measured relative to whatever segment's `cx` it currently occupies - which
    is exactly the trick that lets an unsteered ball ride a curve for free. That is precisely
    backwards for this variety, whose entire point is that NOT steering misses the pad ("so you
    must steer in the air", section 3). `wCenter` shifts where the pad's safe zone sits without
    moving the reference frame the ball's offset is measured against, so an unsteered ball's
    offset stays exactly where it was at launch while the pad moves out from under it. Both
    `sim.js`'s edge/void checks and `render.js`'s floor/void-strip positioning read `wCenter`
    (`voidCenter` is relative to `wCenter`, not `cx`, when both varieties combine on one landing
    pad) - verified directly: an unsteered `Sim.step()` run misses a genuinely offset pad, and a
    scan over partial-duration steering durations (2 through 15 of 19 airborne ticks, out of a
    max useful ~19) all land successfully, confirming a real, controllable skill window rather
    than a frame-perfect or trivially-free input.
  - Reachability (offset magnitude) reuses the exact same time/speed-derived spacing math as
    everywhere else on this map (landmine #2) - the algebraic inverse of `minSpacingFor`'s
    "required spacing from a lateral distance": the safely-coverable lateral distance is the
    bare-minimum-reachable distance divided by `OBSTACLE_SPACING_SAFETY_FACTOR`.
- **`render.js`**: the gap renders NOTHING (`isGap`, no floor/walls/accents - "the floor is
  genuinely gone", section 3); floor/void-strip/obstacle positions all gained a `midY` offset (0
  outside Jump); the ball's rendered height reads `sim.y` directly, NOT `worldPointAt`'s own `y`
  (track-interpolated, a look-ahead approximation used only by the camera - the two deliberately
  diverge mid-flight, see `worldPointAt`'s own doc comment, the file's "landmine #1" auditing
  point). The ball shadow stays on the deck reference below the ball and shrinks with height
  above it (section 3). **Camera height damping** (`_camLagY`, same `CAMERA_LAG` easing as
  lateral) shifts both the camera's position AND its look-at target together - `camera.up` is
  never touched anywhere in this file (verified: only Y-position/look-at values change, never
  pitch/roll/up), so the twice-rejected camera bank cannot reappear even mid-flight.
- **Verified**: `node run-all-tests.mjs` all green (20 suites, 0 failed; no suite needed changes).
  Headless: 2746 generated jump events (3 difficulties × 60 seeds) checked width/void/height/
  wCenter all restore to baseline by event end, lane validity throughout (806 split-landings, 0
  violations), apex never exceeds the cap (0 violations after both fixes above), and landing width
  never drops below minTrackWidth. Direct `Sim.step()` runs confirmed: successful flat landing
  (unsteered), a split landing correctly REQUIRES steering (unsteered = fall in the void,
  steered = land + score), and an offset landing correctly requires steering (unsteered = miss,
  partial steering across a real controllable range = land). Browser (Playwright): a direct
  Sim+Renderer mid-flight render matches the spec's visual description (no floor, ball elevated,
  shrinking shadow); **72 full real-input runs** across two steering strategies (wide-random and
  gentle-centered) on Orbital, zero page errors and zero console exceptions throughout, with the
  longest reaching 167m - past both the Split (~120m) and Jump (~160m) cadences in the same run,
  ending in a real fall with the score (2 obstacles passed) correctly reflected on the game-over
  screen.

## Pickups (BALLRUNMAP2ORBITALSPEC.md Phase 4, shipped 2026-07-29) — the last phase, build complete

The spec's own section 7 deferred this to last on purpose ("much cheaper once Phases 1 to 3
exist"), and named only "extra lives and collectibles" - no dedicated spec section like Split's
(2) or Jump's (3) exists for this one, so the shape below (two pickup types, their cadences, the
invincibility mechanic) is this session's own design, not a literal spec transcription. Orbital
only, same as everything else in this build; Classic never spawns one.

- **The whole reason this really was cheap**: a pickup is never its own event type or geometry
  change. `maybePlacePickup()` runs at the end of every `generateEvent()` call and, once an orb's
  or a life's distance cadence is due, attaches a `{ type, lateral }` payload directly onto
  whatever plain `'straight'` segment that same call already generated - no new phase
  choreography, no new width/void/height fields, no interaction with Split/Jump/tunnel/obstacle
  generation to reason through. `_findPickupSlot()` only ever considers segments from THIS call
  (never scans backward into older ones) and excludes anything hazard/geometry-bearing
  (`isGap`, any `void1 > 0`, tunnels, obstacles) by construction, so pickup placement never has to
  reason about voids, lanes, or in-flight state at all - verified across 40 seeds × 3 difficulties
  (7644 total spawns): every one landed on a plain straight segment, inside its own track width,
  never on a hazard.
- **Orbs are pure bonus score** (`orbValue: 1`, added straight to `sim.score` - the same tally
  Split/Jump already add to, not a separate stat) - collecting one is never risky, so its
  collection radius (`radiusBW: 0.6`) is deliberately more forgiving than an obstacle's hitbox: a
  missed orb should read as "didn't reach it," never as "clipped something."
- **Lives are a banked extra chance, capped (`maxLives: 2`)**, spent automatically the instant a
  hit would otherwise end the run:
  - **The mechanic is a grace WINDOW, not "survive this one hit."** Spending a life
    (`spendLifeIfAny()`) opens `lifeInvincibleS` (2s) of invincibility during which the obstacle/
    void/edge checks are skipped OUTRIGHT, not "the next hit is free" - a ball that's still
    drifting outside bounds, or sitting against the obstacle it just hit, gets real time to
    recover rather than immediately re-triggering the same crash the very next tick. The window is
    never extended by passing through more hazards during it; it always expires at the time it was
    granted.
  - **Verified directly via `Sim.step()`** (not just generation checks, since this is pure runtime
    behavior with nothing to audit at generation time): colliding with an obstacle while a life is
    banked survives (life spent, invincibility engaged, state stays `PLAYING`); the identical
    collision with zero lives banked crashes normally (`CRASHING`, `crashReason: 'obstacle'`) -
    confirming the fallback path is intact, not just the survive path.
  - **HUD**: a small teal diamond row (`.br-hud-lives`/`.br-life`), same reserved-but-collapsible
    shape as the existing tier-pip row - empty (and taking no visible space) on Classic and on any
    Orbital run before a life is ever collected, so this is a no-op UI change for every map/event
    that predates this phase.
  - **Ball visual**: a gentle scale pulse while invincible (`render.js`, a sine on the SHARED ball
    mesh's own scale - no new material/geometry), the depth/attention cue that lets a player
    actually see the grace window is active without any HUD text.
- **Shape, not just hue, per root CLAUDE.md's colorblind rule** ("pair each hue with a shape
  marker, never hue alone"): orbs are a small yellow SPHERE (matches the root palette's own
  "yellow circle" convention), the rarer life pickup is a small teal OCTAHEDRON (the closest 3D
  analogue to the root palette's "teal diamond") - genuinely different geometry, not a recolored
  copy of the same mesh, so the two remain distinguishable even without color at all.
- **`render.js`**: two small dedicated pools (`orbPool`/`lifePool`, sizes 6/2 - pickups are sparse
  enough that even the visible-window worst case never approaches these), each with its own
  once-built geometry/material; `dispose()` releases both. A gentle bob (sine on Y) plus a slow
  spin, both driven by `sim.elapsed` (the same clock every other animated element here already
  reads, never a fresh wall-clock timer that would desync from the fixed-timestep sim on a paused
  tab).
- **Verified**: `node run-all-tests.mjs` all green (20 suites, 0 failed; no suite needed changes).
  Headless: 7644 generated pickup spawns (3 difficulties × 40 seeds) checked every one is on a
  plain hazard-free straight segment, inside track width - 0 violations. Direct `Sim.step()`
  confirmed orb collection (score +1, `orbsCollected` +1), life collection (`lives` +1, capped),
  and the full life-spend/invincibility/fallback-when-empty sequence described above. Browser
  (Playwright): direct Sim+Renderer renders of both pickup types match the intended shape/color
  design; **54 full real-input runs** across two steering strategies on Orbital produced zero page
  errors and zero console exceptions, with orbs visibly collected in real play (game-over score
  climbing to 6 in one run) - runs didn't happen to survive far enough to reach a live life
  pickup in this pass (its ~350m mean cadence is past what scripted/random steering reliably
  reaches), so that one path's real-browser exercise rests on the direct `Sim.step()` verification
  above rather than an observed in-browser collection; the collection code path itself is
  byte-identical to the orb path already proven live.

## Build status: complete

All four phases of BALLRUNMAP2ORBITALSPEC.md have shipped (Phase 1 map plumbing, Phase 2 Split,
Phase 3 Jump, Phase 4 pickups here). Orbital is now a fully mechanically-distinct second map,
selectable from Ball Run's setup screen, with its own best-score tracking (per THE LAW, Classic's
history was never touched at any phase) and its own visual identity. Genuinely open, per the
spec's own section 9 and this session's own notes above: every tuning number in this file is a
first-pass guess awaiting Matt's playtest (cadences, gap lengths, apex cap, pickup cadences/
values, the whole Orbital color set); whether Splits/Jumps should count toward the speed tier the
way tunnels do; whether a missed-Jump-landing fall should read differently from a normal edge
fall, since the ball is already falling from height; a wider variant map (mentioned once in the
spec's Phase 4 aside, never scoped).
