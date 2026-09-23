# Brick Breaker (`brick-blitz/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

A synthwave breakout, built 2026-09-23 at Matt's ask: *"Clone this game for the gamehub. Call it
something new."* The source is miaai-lab's `038-neon-breakout.html` ("HYPERBRICK"). The physics,
the five hand-built stages, the Endless wave generator, scoring, power-ups, particles, backdrop and
synth are the original's, ported into a module. Renamed **Brick Breaker**.

**Name vs identifiers (settled, like Monopoly Deal's).** It shipped as "Brick Blitz" and was
renamed **Brick Breaker** the same day (Matt: the name most people would call it). Only the
DISPLAYED name changed. The folder `brick-blitz/`, hub id `brick-blitz`, stats id `brickblitz`,
sub-counter `bz`, settings key `gamehub.brickblitz.v1` and CSS prefix `.bx-` are frozen: they key
stored player data (THE LAW rule 5). Never "fix" them to match the name.

## Hub integration

- In-hub `module:` (`brick-blitz/js/ui.js`), **immersive**. Hub id `brick-blitz` (= the folder,
  which the dev tools assume); stats id `brickblitz` (mapped in `HUB_ID`, `js/game-stats-ui.js`).
- **Admin only** (`devOnly: true`, Matt 2026-09-23, right after it shipped live). The My Stats tab
  is NOT gated (it was live to everyone briefly, so plays may exist: rule 1). The `GAME_META`
  row stays (the Pinball rule, root CLAUDE.md).
- `isInProgress()`: the LITERAL meaning (no mid-run resume, same class as Snake/Pinball). True while
  a run is live or paused.
- The root is `position: fixed; inset: 0` (Pinball's pattern, avoids the `.hub-game` height trap).
  The HUD row starts at `max(safe-top, 48px)` with 96px clear on the left, because it SHARES its
  row with the hub's floating back button. Overlays pad their top by 96px for the same reason.

## Layout / files

| File | Role |
|---|---|
| `js/game.js` | engine + renderer + synth. `createGame(canvas, hooks)`, `createSound()`. No DOM beyond the canvas; never touches window/document listeners |
| `js/ui.js` | setup screen (over a live AI attract demo), HUD, pause/over/help overlays, input, clock, stats |
| `js/strings.js` | `{ en, es }`, including the canvas strings (launch prompt, power names, stage clear) and the stage names |
| `css/brick-blitz.css` | everything under `.bx-root` |

The field is logical units, 600 wide and 780-1000 tall: `layout()` picks the height to match the
space available, so a tall phone gets a taller field rather than letterboxing.

## Design decisions (differences from the original)

- **Difficulty added** (Easy / Medium / Hard, `DIFF_TUNING` in `game.js`): ball speed x0.82/1/1.18,
  paddle 116/98/84, lives 5/3/3, power-up drop 18/15/12%. The leaderboard ranks tier-first.
- **No local high-score table.** The original kept `hyperbrick-hi` in localStorage; here the best
  is read from `gamehub.stats` (`bz.bestScoreByDiff`), the one home of a score.
- **Setup is a DOM overlay over the attract demo**, not the original's in-canvas title card.
  The desktop side panels (score cards, legend, controls) are gone; the phone HUD row is the HUD.
- **Victory (all five Arcade stages)** offers "Go endless", which continues the SAME run (score and
  lives carried). The run is recorded once, when it finally ends.
- **When a run is recorded**: game over (always); leaving the victory screen (always); quitting or
  hub-back mid-run only if the score is above 0. `destroy()` finishes a live run, so a back-tap
  never loses a score.
- Touch steering is RELATIVE (thumb movement x1.25), mouse is absolute. Pointer listeners live on
  the stage element with pointer capture; the scroll guard is a root-scoped `touchmove`.
- Two-hit bricks carry a shape marker (inner outline + rivets); capsules carry their letter.
- Reduced motion: no screen shake, fewer particles, slow grid, banner does not slide. The ball
  and bricks keep moving (Part 0: reduced motion thins garnish, it never freezes gameplay).
- The ball sub-steps at 0.6 x radius per step, so it cannot tunnel through a 21-unit brick.

## Settings / persistence

- `gamehub.brickblitz.v1`: `{ difficulty, mode: 'arcade'|'endless', muted }`. Saved on selection.
- Stats: `recordBrickBlitz(score, difficulty, extras)` in `js/game-stats.js`, sub-counter `bz`:
  `{ games, bestScore, bestScoreByDiff: {easy,medium,hard}, points, bricks, stages, circuits,
  bestCombo }`. All three surfaces are wired (THE LAW rule 1): `ensureBz` + recorder,
  `brickBlitzScreen` in `js/game-stats-ui.js`, and the `bz` branch in `js/players-agg.js`
  (counters add, bests take Math.max). Leaderboard: `GAME_META` row + `bzBestAt` (best run per tier).

## Tests

`node test-game-conventions.mjs`, `node players-agg.test.mjs` (the `bz` cross-device case),
`node test-recorder-contract.mjs`, `node check-no-scroll.mjs` (needs `node server.mjs`).
