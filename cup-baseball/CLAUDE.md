# Cup Baseball — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md`.

The drinking game "baseball" (beer pong's cousin) on **Cup Pong's table**: `cup-pong/js/physics.js`,
`geom.js`, `cpu.js aimAt` and `render.js` (subclassed) are IMPORTED, never copied. Built 2026-10-23.

## Matt's rules (2026-10-23)

- Four cups in a line down the middle of each end: **single nearest the shooter, then double,
  triple, home run** at the back, **TOUCHING, one straight line** (Matt, 2026-10-23; `js/field.js CUPS`,
  pitch `CUP_D`, Cup Pong's rack pitch).
- Ball in a cup = that hit. **2 outs and the sides switch.**
- **Strikes (Matt, 2026-10-28, "calling outs too easily")**: touches the table or a cup, no cup = a **strike**;
  the **2nd strike is an out**. Misses the table completely = an out at once. Strikes reset after a hit or an out
  (`game.js STRIKES`; `touched` = the physics' `tableHits`/`touchedCup`). HUD: S circle beside the O circles.
- **No defensive shot back** (Matt said no to that variant).
- Every runner moves as many bases as the batter (a double moves first to third).
- Innings 3 / 5 / 9 (default 3). Real baseball's end: the side batting second skips the last bottom
  half when ahead, wins at once when it goes ahead there (walk-off); a tie plays extra innings.
- Cups are refilled in the real game, so they never leave the table; a hit cup gets the accent ring.

## Files

`js/game.js` the rules (pure, events `hit`/`out`/`side`/`extra`/`win`) · `js/field.js` cup spots ·
`js/cpu.js` target mix + sigmas · `js/render.js` Cup Pong's Renderer + 1B/2B/3B/HR on the felt ·
`js/ui.js` shell, flick, flow, module contract · `js/strings.js` EN/ES · `js/test.js` (dev only).

## Play

- **Vs computer**: the player bats from the near end at the BLUE cups; the computer's turn glides
  to the far camera (Cup Pong's `defend` view) and throws at the RED cups.
- **2 players** (one phone): both throw from the near end at the blue cups; a "Pass to {name}" card
  covers the table at every switch. Records nothing.
- HUD: "{name} up", score and Top/Bot inning; a diamond top left, 110 px (filled = runner / out, outline =
  empty, never colour alone). Line score on the pause sheet and the result card.
- **Computer** (`node cup-baseball/js/test.js --cpu`, 600 throws, seed 4242): Easy hits 21%, Medium
  32%, Hard 49% (re-tuned when the cups went touching). Easy aims short more often; Hard aims at all four evenly.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../cup-baseball/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `cup-baseball`, no `released` date |
| Stats id | `cupbaseball`: `recordResult('cupbaseball', diff, won)` once per finished game vs the computer. In `js/game-stats.js` `GAMES`, `js/leaderboard-ui.js` `GAME_META`, `js/game-stats-ui.js` `TABS` + `HUB_ID`, label `game_title_cupbaseball` |
| CSS | `.cb-root` / `.cb-` (every rule under `.cb-root`) |
| Settings key | `gamehub.cupbaseball.v1`: `{ diff, innings, nextFirst }` (preferences only) |
| `isInProgress()` | NO MID-GAME RESUME: `true` once a game has had a throw and is not over |
| Tile art | `GAME_ART['cup-baseball']` |

## Tests

`node cup-baseball/js/test.js` (rules + a perfect throw lands in each cup); `--cpu` for the rates;
`node tools/test-game-conventions.mjs`.

## Quitting and easier settings (2026-10-29)

No resume: vs the computer, leaving after the player's first throw is ONE loss (`gamehub.quitLoss.v1`, taken in `destroy()` / `init()`); New game / Change settings ask twice. Innings unchanged (3 is the shortest and the default). Spec: `docs/INTEGRITY-CHECKS-SPEC.md`, "Holes closed 2026-10-29: quitting and easier settings"; `node tools/test-quit-loss.mjs`.

## Second pass (2026-10-29)

- Vs the computer: quitting is a loss once ANY throw, the computer's included (it was the player's own first move). `quitLossLost` stops a second result.
- Spec: `docs/INTEGRITY-CHECKS-SPEC.md`, "Holes closed 2026-10-29 (second pass): leaving live rooms, quitting once dealt".
