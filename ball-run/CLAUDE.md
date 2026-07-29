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
- **What's NOT done yet (Phases 2-4 of the spec, not started):** Split (`voidHalfWidth`, the
  telegraph line, side variety), Jump (height axis, `worldPointAt` growing a Y component — the
  spec's own flagged highest-risk change, touching every caller), pickups. Orbital's own
  difficulty/geometry tuning is also still Classic's numbers verbatim — retuning it is explicitly
  out of scope until Orbital has mechanics of its own to tune around (spec section 6).
