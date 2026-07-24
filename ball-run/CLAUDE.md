# Ball Run (`ball-run/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`, immersive.

## Notes

Solo endless runner: steer a rolling ball down a neon track, dodge obstacles. Three.js/WebGL renderer (`render.js`, vendored `ball-run/vendor/three.module.min.js`), fixed-timestep sim (`sim.js`/`track.js`) decoupled from rendering, `input.js` for touch/drag steering. `immersive: true`. Settings under the older dotted `ballrun.*` keys (predates the `gamehub.<game>.v1` convention; frozen per THE LAW). Results recorded via `recordBallRun` (obstacle-count score, not distance — see `js/game-stats.js`'s header comment for the metric-migration history) through a local "flight recorder" (`ballrun.runLog.v1`) that retries any run that didn't confirm reaching the shared store, on every subsequent open. Renderer teardown calls `forceContextLoss()` after `dispose()` so repeated hub↔game remounts don't leak WebGL contexts toward the browser's context cap. `Renderer.dispose(loseContext = true)` and `BallRunUI.teardownRun(fullExit = false)` (2026-07-22): only the hub's real unmount forces context loss - an in-place restart (Play, Play Again, back-to-setup) passes `false` and reuses the live context, since forcing loss on a context about to be reused for a `new Renderer(canvas)` left it permanently lost (the black screen on "Play Again").

i18n: `ball-run/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Difficulty keys
(`easy`/`medium`/`hard`, `ballrun.difficulty`) stay canonical; `config.js`'s own
`DIFFICULTIES[].label` stays English (a tuning/config module, same discipline as `sim.js`/
`track.js`) — `ui.js` maps the same keys onto local translation tables instead.

Display labels (2026-07-23, batch 8): standardized to the shared Beginner/Intermediate/Pro
vocabulary (`diff_easy`/`diff_medium`/`diff_hard` in strings.js), normal case (not all-caps), each
preceded by the shared ski-slope shape (`diffShapeSVG`/`tierOf`, `js/difficulty-tiers.js` — the
same shapes the leaderboard uses) rendered into `.br-diff-label` alongside the existing face icon.
Stored `ballrun.difficulty` values are untouched.
