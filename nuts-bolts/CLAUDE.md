# Nuts & Bolts (`nuts-bolts/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

Solo color-sort puzzle: stack matching nuts onto bolts. Procedural level generator (`nuts-bolts/js/generator.js`) with a solvability + quality-gate self-test (regenerates a level rather than shipping an unsolvable or trivial one). Settings/progress in `gamehub.nutsbolts.v1` (schema-versioned, with its own migration). A solo puzzle has no opponent/loss state, so results record via `recordNutsBolts` (solved/moves/bestLevel), not `recordResult`. `ui.js`'s `fitToViewport()` (2026-07-22, phone widths only): the nb-size-l/m/s tier was chosen purely by bolt count with no regard for whether it actually fit a short phone; now measures `document.documentElement.scrollHeight` vs `window.innerHeight` (the same black-box technique `escoba/CLAUDE.md` already documents for Escoba's own viewport budget) and steps down a tier, then falls back to continuously scaling the same custom properties (down to a 0.6 floor) for boards too big even at the smallest tier. Chinchón (`chinchon/CLAUDE.md`) does the analogous thing with its own hand-row layout.

i18n: `nuts-bolts/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Tier keys
(`easy`/`medium`/`hard`/`extraHard`), color keys, and `game.js`'s move-reason codes
(`empty`/`locked`/`full`/`color-mismatch`, changed from their old English-sentence values) stay
canonical; `ui.js` maps each onto a translated display string via local key tables rather than
importing `generator.js`'s own English `TIER_LABELS`/`TIER_DESCRIPTIONS`/`PALETTE` names, which
stay untouched (that file is a pure, DOM-free engine module, same discipline as `game.js`/`ai.js`).
