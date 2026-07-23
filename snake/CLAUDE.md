# Snake (`snake/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

The old phone classic, built 2026-07-23 at a family member's request — **in Spanish**, which made
it the first game born on the shared i18n layer (`js/i18n.js`) and the reference implementation
for it.

Hub integration: in-hub `module:` (`snake/js/ui.js`), not immersive. `isInProgress()` uses the
LITERAL meaning (no mid-run resume, same class as Connect Four and Ball Run): `true` while a run
is live and not over, so the hub confirms before navigating away mid-run.

## Layout & responsibilities

```
snake/js/game.js     pure engine: grid, tick step(), growth, collisions, input queue; no DOM/timers
snake/js/ui.js       DOM shell: setup, canvas render, swipe+keyboard input, pause, modal, stats
snake/js/strings.js  every user-visible string, { en, es } — the per-game dictionary REFERENCE
snake/js/test.js     headless engine assertions (node snake/js/test.js), in run-all-tests.mjs
snake/css/snake.css  all styles, .sn- prefixed, every rule descendant-scoped under .sn-root
snake/index.html     standalone host (same init() as in-hub)
```

## Rules (classic phone Snake, deliberately)

- Walled 15x17 grid — **walls kill**, no wrap-around. Self-collision kills.
- Food grows the snake by one and scores one; it never spawns on the snake.
- A 180° reversal is impossible (checked against the last EFFECTIVE heading, including queued
  turns, so two fast taps can't sneak a reversal through).
- **Stepping into the cell the tail vacates this same tick is legal** when not eating (the
  classic "chase your tail" move) — the engine checks against `body.slice(0, -1)` for a
  non-eating step. test.js pins both this and the eating case.
- Difficulty is SPEED only (`TICK_MS`: easy 170 / medium 120 / hard 85); rules never change.
- The input queue holds up to 2 pending turns, applied one per tick — tight corners at Hard's
  tick rate need both taps to land.

## i18n (the reference implementation)

- `strings.js` exports `{ en, es }`; `en` is the source of truth, `es` may lag (js/i18n.js's
  fallback shows English for any missing key — partial translation can never break a screen).
- `ui.js` builds `const t = makeT(STRINGS)` once and calls `t()` at RENDER time, never at module
  scope. `onLangChange` re-renders the setup screen live and relabels the in-game HUD; the
  unsubscribe is called in `destroy()`.
- Spanish drafted by a working session; native-speaker corrections are one-line edits in
  strings.js and nothing else.

## Stats

`recordSnake(length, difficulty)` in `js/game-stats.js` — solo pattern (no loss axis, mirrors
Ball Run): every finished run counts played+won; `sn: { runs, bestLen, bestLenByDiff }` with
Math.max-only bests (`bestLen` = final snake length, start 3 + food eaten). Recorded once per
run in `_endRun()` BEFORE the modal shows, so a fast "play again" can't skip it. The three
mandatory sub-counter surfaces all exist (root checklist item 7): the `sn` branch in
`js/players-agg.js` (regression case in players-agg.test.mjs), `snakeScreen` in
`js/game-stats-ui.js`, and `snakeRows`/tile/headline in `js/leaderboard-ui.js`. Snake is in
players-agg's `SOLO` set and joins `soloRating()`'s best-relative-to-field axis in
`js/leaderboard-rank.js` (guarded — pre-Snake remote records have no `snake` key).

## Settings & persistence

`gamehub.snake.v1`: `{ difficulty }`. Precedence: saved settings > profile skill (1/2/3 →
easy/medium/hard) > medium. Language is NOT stored here — it's the hub-wide `gamehub.lang.v1`.

## UI notes

- Canvas renders the LCD look (pale green `#c9dd9a`, dark pixels `#28340f`); snake is SQUARE
  cells, food is a HOLLOW CIRCLE — shapes, not hue, tell them apart (colorblind rule).
- First steering input starts the clock ("ready" overlay until then). `visibilitychange`
  auto-pauses; tap resumes. NOTE: background tabs throttle `setInterval`, so a backgrounded run
  crawls — the auto-pause covers the hidden-tab case, and a throttled-but-visible preview pane
  is a dev-environment artifact, not a bug.
- The board wrap is `touch-action: none` (a swipe surface must never scroll the page).
- Game-over modal has the repo-standard X close (dismiss without a forced rematch).
- `openHelp()` (the how-to-play pattern, see tic-tac-toe/CLAUDE.md) builds a `.sn-help-overlay`
  appended to `document.body` (so it survives screen re-renders); `destroy()` removes any open one.

## Tests

```
node snake/js/test.js
```
38 assertions: construction, movement, the reversal guard and queue cap, both wall axes, eating
and growth, self-collision via a closed 2x2 loop at length 7, the legal tail-chase at length 4,
and food-spawn integrity over 50 seeded random runs. Wired into run-all-tests.mjs.
