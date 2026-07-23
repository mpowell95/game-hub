# Filler (`filler/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

Flood-fill duel vs AI (color-pick your corner, grow to capture the majority). Pure engine (`filler/js/game.js`) + `ai.js` + `ui.js`, no worker. Settings in `gamehub.filler.v1` (the gen-3 key convention); results via `recordResult('filler', ...)`. Still on the old flat/segmented setup screen, not the accordion pattern. `ai.js`'s `pro()` tier (2026-07-22) restricts candidates to the max-immediate-capture-gain colors first, breaking ties with the deep-lookahead value - it used to weigh a "small frontier bonus" across the WHOLE option set, which could (and, ~59% of pro-vs-pro seeded games, did) outscore an actually-available capture, including the specific color that would close the board, causing the AI to stall forever until the dry-move guard force-ended the game unfilled. `game.js`'s `generateColors()` also runs a post-generation `debiasNeighborPair` pass on both starting corners: a corner's two neighbor tiles aren't adjacent to each other, so nothing previously stopped them from coincidentally sharing a color and letting one first move capture both (~24% of boards, symmetric, before the fix).

i18n: `filler/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Color ids (0-5) and difficulty keys (`beginner`/`intermediate`/`pro`) stay canonical; only their display labels translate.
