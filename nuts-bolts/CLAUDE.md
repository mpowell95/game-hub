# Nuts & Bolts (`nuts-bolts/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — the nine full rules repeat throughout the root `CLAUDE.md`, which is always
> loaded alongside this file. Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

Solo color-sort puzzle: stack matching nuts onto bolts. Procedural level generator (`nuts-bolts/js/generator.js`) with a solvability + quality-gate self-test (regenerates a level rather than shipping an unsolvable or trivial one). Settings/progress in `gamehub.nutsbolts.v1` (schema-versioned, with its own migration). A solo puzzle has no opponent/loss state, so results record via `recordNutsBolts` (solved/moves/bestLevel), not `recordResult`. `ui.js`'s `fitToViewport()` (2026-07-22, phone widths only): the nb-size-l/m/s tier was chosen purely by bolt count with no regard for whether it actually fit a short phone; now measures `document.documentElement.scrollHeight` vs `window.innerHeight` (the same black-box technique `escoba/CLAUDE.md` already documents for Escoba's own viewport budget) and steps down a tier, then falls back to continuously scaling the same custom properties (down to a 0.6 floor) for boards too big even at the smallest tier. Chinchón (`chinchon/CLAUDE.md`) does the analogous thing with its own hand-row layout.
