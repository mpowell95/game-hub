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
