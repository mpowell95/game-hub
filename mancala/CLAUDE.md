# Mancala (`mancala/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — the nine full rules are stated near the top of the root `CLAUDE.md`, which is always
> loaded alongside this file. Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`, immersive.

## Notes

Kalah rules vs AI (3 tiers; Pro = iterative-deepening alpha-beta under a ~380ms budget) or pass-and-play. Pure engine (`mancala/js/game.js`) + `ai.js` + `ui.js`; stones are persistent DOM elements sown pit-to-pit with WAAPI arc flights (timeout-raced so a hidden tab never stalls a move; `?motion=1/0` overrides reduced-motion). Settings in `gamehub.mancala.v1`; results via `recordResult('mancala', ...)`. Reference screenshots in `mancala/reference/` (gitignored).

CSS: every rule is descendant-scoped under the root class `.mancala` (`.mancala .mc-x`) — the
scoping-discipline reference for the repo, though the root class itself predates the `.xx-root`
naming convention and stays as-is.
