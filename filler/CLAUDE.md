# Filler (`filler/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

Flood-fill duel vs AI (color-pick your corner, grow to capture the majority). Pure engine (`filler/js/game.js`) + `ai.js` + `ui.js`, no worker. Settings in `gamehub.filler.v1` (the gen-3 key convention); results via `recordResult('filler', ...)`. Still on the old flat/segmented setup screen, not the accordion pattern. `ai.js`'s `pro()` tier (2026-07-22) restricts candidates to the max-immediate-capture-gain colors first, breaking ties with the deep-lookahead value - it used to weigh a "small frontier bonus" across the WHOLE option set, which could (and, ~59% of pro-vs-pro seeded games, did) outscore an actually-available capture, including the specific color that would close the board, causing the AI to stall forever until the dry-move guard force-ended the game unfilled. `game.js`'s `generateColors()` also runs a post-generation `debiasNeighborPair` pass on both starting corners: a corner's two neighbor tiles aren't adjacent to each other, so nothing previously stopped them from coincidentally sharing a color and letting one first move capture both (~24% of boards, symmetric, before the fix).

i18n: `filler/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Color ids (0-5) and difficulty keys (`beginner`/`intermediate`/`pro`) stay canonical; only their display labels translate.

### Settings: `gamehub.filler.v1` additive field, ski-slope shapes, Restart (2026-07-23, batch 8)

`gamehub.filler.v1` gained a second field, `nextStarter` (`P1`/`P2`, additive - `level` is unchanged
and still frozen vocabulary). No new setup-screen row: who opens is silently alternated every game
(new game, rematch, and the new Restart button, all via `startGame()`), flipped and persisted
immediately so it survives leaving mid-game (mirrors `mancala/js/ui.js`'s `startGame()` alternation).
The engine (`game.js`) always constructs a fresh game with `turn: P1`; when it's the AI's turn to
open, `ui.js` sets `this.state.turn = P2` right after construction and schedules `aiMove()` after the
usual `AI_THINK_MS` pause, same as any other AI turn. No new announcement banner: the existing
per-turn status line (`refresh()`, "Your turn" / "{opp} is thinking...") already reads `s.turn` and
announces who's up as soon as the game renders.

The difficulty segmented buttons render a ski-slope shape (`diffShapeSVG`/`tierOf`, imported from
`js/difficulty-tiers.js`) before each label, ~1em, via `.filler .lb-dshape` sizing rules in
`filler.css`. Stored difficulty ids (`beginner`/`intermediate`/`pro`) are untouched - display only.

A confirm-guarded **Restart** button (`data-role="restart"`) sits in the mid-game footer next to
"How to play" and "New game" (which still returns to setup, unchanged). It follows Connect Four's
`confirmDestructive`/`resetConfirms` tap-again-to-confirm pattern (`fl-ghost.is-confirm` styling,
`tap_again_confirm` string), guards on `this.state.over` rather than Connect Four's `game.isOver()`,
and on confirm calls `startGame()` directly (same board size, same settings, counts as a new game
for the alternation above) rather than returning to setup.
