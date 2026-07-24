# Nuts & Bolts (`nuts-bolts/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

Solo color-sort puzzle: stack matching nuts onto bolts. Procedural level generator (`nuts-bolts/js/generator.js`) with a solvability + quality-gate self-test (regenerates a level rather than shipping an unsolvable or trivial one). Settings/progress in `gamehub.nutsbolts.v1` (schema-versioned, with its own migration). A solo puzzle has no opponent/loss state, so results record via `recordNutsBolts` (solved/moves/bestLevel), not `recordResult`. `ui.js`'s `fitToViewport()` (2026-07-22, phone widths only): the nb-size-l/m/s tier was chosen purely by bolt count with no regard for whether it actually fit a short phone; now measures `document.documentElement.scrollHeight` vs `window.innerHeight` (the same black-box technique `escoba/CLAUDE.md` already documents for Escoba's own viewport budget) and steps down a tier, then falls back to continuously scaling the same custom properties (down to a 0.6 floor) for boards too big even at the smallest tier. Chinchón (`chinchon/CLAUDE.md`) does the analogous thing with its own hand-row layout.

**Setup screen (redesigned 2026-07-24, batch 8, Matt: "I just dislike this. redesign it.")**: was
four stacked prose cards (one per difficulty, each a one-tap "Level N" + description launcher).
Now one segmented row of four options (`.nb-seg`/`.nb-segbtn` in `nuts-bolts.css`, same shape as
Connect Four's/Filler's difficulty picker) — each option shows a ski-slope shape
(`diffShapeSVG(tierOf(tier))`, imported from `js/difficulty-tiers.js`) plus the standardized label
and that tier's own "Level N" (read straight from the existing per-tier `this.levels[tier]`
counters, display-only, never reset or renumbered) — followed by a separate primary **Start**
button (`.nb-start-btn`, reuses the existing `.nb-btn`/`.nb-btn-primary` classes). Selecting a
segment only updates `this.selectedTier` (defaults to the last-played tier) and the row's
`is-selected` styling; nothing launches until Start is tapped, which calls the SAME `startTier()`
used before — that function, and the kept-aside-board resume logic inside it
(`resumingInMemory`/`resumingFromDisk`), is untouched by this redesign. No description text
anymore (the `tier_desc_*` string keys were removed as part of this). Stored difficulty ids
(`easy`/`medium`/`hard`/`extraHard`) are unchanged; only their DISPLAY labels moved to the shared
Beginner/Intermediate/Pro/Expert vocabulary (`tier_easy`/`tier_medium`/`tier_hard`/
`tier_extra_hard` keys in `strings.js`, same ids, new text).

**Auto-resume (2026-07-23, batch 9, HANDOFF-FB-RESUME.md)**: mount now checks
`this.savedBoard` in the `NutsBoltsUI` constructor and, if an in-progress board exists, calls
`startTier(this.savedBoard.difficulty)` directly instead of rendering the menu - skipping straight
to the game screen for that board's tier, silently, no "resume?" dialog. This reuses the SAME
`startTier()` resume path (`resumingInMemory`/`resumingFromDisk`) that a matching-tier tap always
used; no second resume mechanism was added, and no new save key (the existing
`gamehub.nutsbolts.v1` kept-aside board was already surviving navigation, this just stops making
the player re-select the same tier to see it). When there is no saved board the menu still renders
normally, `selectedTier` still defaulting to the last-played tier. `isInProgress()` flipped to
always return `false` to match (root `CLAUDE.md`'s "autosave built in" `isInProgress()` meaning):
leaving mid-game is lossless (the board persists after every move and now auto-resumes), so the
hub's leave-confirm no longer appears.

i18n: `nuts-bolts/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Tier keys
(`easy`/`medium`/`hard`/`extraHard`), color keys, and `game.js`'s move-reason codes
(`empty`/`locked`/`full`/`color-mismatch`, changed from their old English-sentence values) stay
canonical; `ui.js` maps each onto a translated display string via local key tables rather than
importing `generator.js`'s own English `TIER_LABELS`/`TIER_DESCRIPTIONS`/`PALETTE` names, which
stay untouched (that file is a pure, DOM-free engine module, same discipline as `game.js`/`ai.js`).
