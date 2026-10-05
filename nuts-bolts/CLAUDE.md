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
(`easy`/`medium`/`hard`/`extraHard`) are unchanged; only their DISPLAY labels moved onto the
shared vocabulary (`tier_easy`/`tier_medium`/`tier_hard`/`tier_extra_hard` keys in `strings.js`,
same ids, new text) — **Easy/Medium/Hard/Expert as of 2026-07-24** (Matt's reversal of batch 8's
Beginner/Intermediate/Pro/Expert).

**Overflow fix + How-to button (2026-07-24, batch A):** `.nb-segbtn-label` bled "Intermediate"
into neighbors at narrow widths inside the 4-column flex row; under `max-width:400px` it now
stacks the shape ABOVE the label (`flex-direction:column`) at a smaller font instead of forcing
one line. A ghost **"How to play"** button (`.nb-howto-btn`, `data-action="menu-help"`) now sits
under Start on the difficulty screen — the sheet already existed (game screen's bottom bar), it
just had no entry point before a level was chosen. The help-overlay markup is now built once by
`helpOverlayHTML()` and rendered into whichever screen's root is currently mounted (menu or
game), so both buttons open the identical content; `this.helpOverlay` is re-queried on each
render rather than assumed to exist.

**7 bullets → 4 (2026-07-24, HANDOFF-FB2-HOWTO2 item 6):** the old pick-up and drop-off bullets
merged into one (`help_li_1`), the standalone "undo is free" bullet was deleted (undo is a
visible button, undiscoverable-ness was never the problem), and the harder-levels-repeat-colors
trivia bullet was deleted. `help_li_1`-`help_li_4` in `strings.js` now cover: move mechanic
(merged), bolt completion/lock, hidden "?" nuts, and press-and-hold color names.

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

**Diagram added (2026-07-24, batch D/FB3-HOWTO3):** the sheet was text-only (4 bullets,
no visual). `helpDiagramSVG()` in `js/ui.js` adds ONE small SVG above the bullet list
(purely additive — none of the 4 bullets from the FB2 trim changed): two bolts on the
left, the top color of the first "pouring" (arced arrow) onto a matching color already at
the bottom of the second (dashed-outline empty target above it), plus a third bolt shown
fully filled with one color (a small padlock glyph) to depict "complete/locked". Each
color also carries its own shape marker (circle/triangle/diamond, matching the
colorblind-safe palette in root CLAUDE.md — this game's own `PALETTE` hexes for
yellow/blue/teal are the exact same values) so the grouping never relies on hue alone.
`.nb-help-diagram-wrap`/`.nb-help-diagram` in `nuts-bolts.css`; new string
`help_diagram_aria`.

i18n: `nuts-bolts/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Tier keys
(`easy`/`medium`/`hard`/`extraHard`), color keys, and `game.js`'s move-reason codes
(`empty`/`locked`/`full`/`color-mismatch`, changed from their old English-sentence values) stay
canonical; `ui.js` maps each onto a translated display string via local key tables rather than
importing `generator.js`'s own English `TIER_LABELS`/`TIER_DESCRIPTIONS`/`PALETTE` names, which
stay untouched (that file is a pure, DOM-free engine module, same discipline as `game.js`/`ai.js`).

## Difficulty keeps rising: THE RAMP (shipped 2026-10-05)

Matt: *"why would it stop getting more difficult at level 16!??... Of course it should continue to
get more and more difficult."* Every tier used to end in a flat `maxLevel: Infinity` band (Easy,
Hard, Expert from level 16; Medium from 31), and the two most devoted players were 200-300 levels
into Expert at one flat difficulty. Build brief: `docs/NUTS-BOLTS-RAMP-HANDOFF.md`.

- **The ramp** (`generator.js`, "THE RAMP", `RAMP_CEILING`/`rampSteps()`/`getDifficulty()`): past a
  tier's last band (its plateau) difficulty rises one small step every `RAMP_EVERY` = 10 levels,
  taking turns between more bolts (F), more colors (C) and more hidden nuts (H, +0.05 a step);
  scramble (S) rises in proportion. E stays 2. It then holds at the tier's ceiling.
- **Ceilings (Matt's call, 2026-10-05: a lower tier climbs up to the next tier's TOP, never past
  it):** Easy -> Medium's top (F11, S48, H0.15) but C stays 7 (Easy never leaves its 7-color
  colorblind-safe pool); Medium -> Hard's top (F13 C10 S64 H0.20); Hard -> Expert's old top (F15
  C12 S80 H0.25); Expert -> F18 C12 S104 H0.50. Steps to the ceiling: Easy 7, Medium 4, Hard 5,
  Expert 8 (so Expert tops out 80 levels after the ramp starts).
- **Why Expert stops at 18 full bolts (20 total):** measured 2026-10-05 with `fitToViewport()` at
  its 0.6 floor. At 375x667, 17-20 bolts are 5 rows of 4 with nothing to scroll; 21 makes a 6th row
  and overflows by 82px. Each bolt (the tap target) stays 56x76px. Colors are already 12 (all of
  `PALETTE`); more needs new colors AND new symbols (Matt is red/green colorblind).
  **Known, NOT caused by the ramp:** at 360x640 the board overflows by 26px both at today's
  17-bolt plateau and at the 20-bolt top (same 5 rows); that predates this change.
- **"Ramp up from where each player is now" (Matt's choice):** the save gained ONE additive field,
  `rampFrom: { easy, medium, hard, extraHard }` in `gamehub.nutsbolts.v1` (still schema v2). A save
  with no entry for a tier (every save from before 2026-10-05) gets
  `max(that tier's current level, the tier's ramp start)`, once (`deriveRampFrom()` in `ui.js`), so
  a player on Expert level 317 plays exactly the old plateau at 317 and it climbs from 327. A new
  player ramps from 16 (31 on Medium). The level counters are never touched, a board in progress
  resumes unchanged (it is stored as stacks). If an old cached build saves over the blob before
  the new one loads, `rampFrom` is dropped and re-derived from the then-current level: the ramp
  restarts from there, nothing else changes.
- **Verified:** `node js/test.js` (from `nuts-bolts/`) generates 200 boards at levels 50/100/300/1000
  on every tier (all solvable, no complete bolt at start, 0 gate fallbacks, slowest ~7ms in node)
  and checks the ramp never eases, `rampFrom` 317 plays the plateau, and no tier passes the next.
  The migration was checked against the real pre-ramp `saveState()` from git (levels, board and
  tier unchanged; `rampFrom` = current level).
