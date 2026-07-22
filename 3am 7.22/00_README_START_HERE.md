# Game Hub - Feedback Handoff for Claude Code (Sonnet)

**Read this file, then `01_repo_context.md`, before touching anything.**

This bundle turns 20 screenshot annotations of Matt's into batched tasks, grounded in the repo's `CLAUDE.md`,
`game-hub-audit.md`, and `AUDIT-UPDATE-2026-07-21.md`. **The batch docs are numbered in execution order:
send them to Sonnet as `02`, `03`, `04` ... in sequence.** Each batch is a self-contained session.

---

## >>> EXECUTION ORDER (send to Sonnet in this sequence) <<<

**First, you (Claude Code) read `01_repo_context.md` yourself** - it is a prerequisite, not a task. Then work
the batch docs in numeric order:

| # | Doc | What / why it is here | Highest task |
|---|-----|-----------------------|--------------|
| 1 | `02_bugs_ballrun_difficulty.md` | Ball Run "Play Again" black-screen crash + broken difficulty selector. **The two highest-value bugs** (a functional break and a whole broken feature). | BUG-2, BUG-1 |
| 2 | `03_modal_close_buttons.md` | X-to-close on Filler + Chinchón end-game modals. Cheap, high value, Escoba pattern to copy. | MODAL-1/2 |
| 3 | `04_filler_ai_and_board.md` | Filler AI refuses to end the game + unfair starting boards. Broken core gameplay. | FILLER-1/2 |
| 4 | `05_layout_viewport_fixes.md` | Nuts & Bolts + Chinchón are too tall for the screen. | LAYOUT-1/2 |
| 5 | `06_monopoly_deal.md` | Back button, default opponents, Wild-card label, and the Just-Say-No rework. | MD-1/2/3/4 |
| 6 | `07_chinchon_interaction.md` | 7-8 cards per hand row (+ deferred: the "highlight sets" look). | CH-2 |
| 7 | `08_leaderboard_redesign.md` | Leaderboard redesign. Approval-gated + a stats-shape change. | LEAD-1 |
| 8 | `09_connect_four_overhaul.md` | Connect Four fixes + general overhaul. Biggest and most open-ended; **do last**. | C4-1..C4-5 |

**Two trivial quick-wins live inside later docs** (MD-2 "default opponents 2" in `06`; C4-1 "hide star" in
`09`) - do them when you reach those docs; they were not worth splitting out.

**Stop-and-get-approval before building** the approval-gated items: MD-4 (`06`), LEAD-1 (`08`), C4-5 and the
scope of the overhaul (`09`), and CH-1 (`07`). Produce a short mock/plan first.

Why this order: it front-loads the biggest player-experience wins (a replay crash, a broken difficulty
control, a game that will not end) and the cheap high-ROI fixes, and pushes the heavy, approval-gated, or
subjective work to the end. The full cost-benefit reasoning is in the table lower down.

---

## Repo & environment (full detail in `01_repo_context.md`)

- **Repo:** `mpowell95/game-hub`, GitHub Pages, deployed by manual `git push origin main` (Pages auto-builds).
- **Work in the local git repo folder `...\Personal\Game-Hub\`** (renamed from the old `Connect-Four/`; `CLAUDE.md` has a settled "Repo location" note). The sibling **`...\Personal\Game-Hub-Docs\` is a separate NON-git archive** of planning/handoff docs - never commit code there. (`connect-four/`, lowercase, *inside* the repo, is the Connect Four game module and is unrelated to the old repo-folder name.)
- **No build step. No `package.json`. Plain ES modules.** Tests run with `node <script>.mjs`.
- **PWA with a service worker** (`sw.js`, cache `game-hub-v152`; Monopoly Deal has its own nested SW at `business-deal-hub-v29`). Precaching is strict: see the deploy ritual below.
- Firebase RTDB only (multiplayer + networked stats). Most games are solo/local.

## Game naming (IMPORTANT)

The game is **Monopoly Deal** - that is its real display name, shown in every user-visible string. Its
**folder is `business-deal/`** and its stats id is **`business`**. Folder/identifier names are not display
names; this split is intentional and correct, **not** a contradiction, and must not be "reconciled." **Do not
rename the folder or any identifier** - it would 404 every installed home-screen app and orphan every
player's stats (frozen list in `06_monopoly_deal.md` and `CLAUDE.md`). Batch `06_monopoly_deal.md` covers it.

The 9 live games and their folders (confirm any slug marked `?`):

| Display name | Folder | In this handoff? |
|---|---|---|
| Connect Four | `connect-four/` | Yes (09) |
| Chinchón | `chinchon/` | Yes (05, 03, 02, 07) |
| Filler | `filler/` | Yes (03, 04) |
| Nuts & Bolts | `nuts-bolts/` `?` | Yes (05) |
| Monopoly Deal | `business-deal/` (stats id `business`; do not rename) | Yes (06) |
| Ball Run | `ball-run/` | Yes (02) |
| Mancala | `mancala/` | No feedback |
| Escoba | `escoba/` | No feedback - **this is the clean exemplar, see below** |
| Parchís | `parchis/` (source partly in a separate repo) | No feedback |

## THE LAW - house rules that apply to every batch

From `CLAUDE.md` ("THE LAW"). Violating them is a regression even if the feature "works":

1. **No em dashes anywhere in any file** (code, comments, docs). Use hyphens, colons, or rewrite.
2. **No magic numbers.** Tuning values are named constants in the game's config (e.g. `ball-run/js/config.js`). Every commit message lists old to new constant values you changed.
3. **Sonnet commits but does NOT push.** Matt reviews `git log` / `git status` and pushes himself.
4. **Copy Escoba, not Connect Four.** Escoba is the clean, current exemplar for UI, layout, modals, structure. Connect Four is the crude first game (why batch 09 exists). Need a pattern? Mirror Escoba.
5. **No instructional / "assisting" text in gameplay UI.** (Explicit confirm dialogs the user triggers - e.g. the Connect Four undo confirm - are allowed and stay terse.)
6. **Reserve fixed geometry; never cause vertical layout shift.**
7. **Treat the viewport as a space budget to distribute deliberately, not to minimize.** ("Wasted space at the top" is a distribution problem, not just a shrink problem.)
8. **Put feedback indicators where the user is already looking, not at screen edges.**
9. **Colorblind safety is a hard constraint. Matt is red-green colorblind.** Selection/attention color is `#ffce3a`, ALWAYS paired with a non-color indicator (shape, icon, label, border). Filler's colors already carry shapes (triangle / star / plus); do not break that channel.
10. **Frozen identifiers / protected keys - never rename:** the `business-deal/` folder, hub `id: 'business-deal'`, the **stats id `'business'`**, `bd-stats`, `gamehub.bd.pendingStats.v1`, and the `gamehub.*` stats keys. Protected keys, the CSS scoping convention, and Firebase write restrictions are documented in `CLAUDE.md`.
11. **A milestone is not done until `CLAUDE.md` reflects it.** Update `CLAUDE.md` (games table, invariants, settings/keys) as part of the work.

## Stats system (batches 08 and 09 touch it - understand it once)

- Per-result stats live in **localStorage `gamehub.stats`** (protected key - extend its shape, never rename it; legacy shapes must keep loading, guarded by `test-stats-replay.mjs`) and, networked, in **RTDB `players/` + `usernames/`** via `js/stats-net.js`. Monopoly Deal's records live under stats id **`business`** (`players/<deviceId>/games/business`) - that node IS Monopoly Deal; do not migrate or duplicate it.
- Results are written by **two recorders that MUST agree**: `game-stats-global.js` (classic) and `game-stats.js` (ESM), **plus Monopoly Deal's own in-scope copy** (in `business-deal/`). Parity is guarded by `test-recorder-contract.mjs`. Legacy `bd-stats` folds once via `foldLegacy` (`js/game-stats.js:237`); offline queue `gamehub.bd.pendingStats.v1` (`:249`).
- The leaderboard UI is `js/leaderboard-ui.js` (label `:21`); "My Stats" is `js/game-stats-ui.js` (`:18`). Identity: `gamehub.deviceId`.
- **Consequence for LEAD-1, C4-2, C4-3:** any stats change (a per-result `difficulty` field; a "this game does not count" flag) must be made in BOTH recorders and the `business-deal` copy, must not break legacy `gamehub.stats` shapes, and must pass `test-recorder-contract.mjs` + `test-stats-replay.mjs`. Known trap: a Ball Run scoring change once silently discarded runs because a best-gate compared new values against a legacy field in the same slot.

## Workflow & sign-off

- Pipeline: **Claude (architecture/handoffs) -> you, Sonnet in Claude Code (implement + commit) -> Claude in Chrome (visual QA).** You do code + headless verification; screenshot QA is a separate pass (screenshot tooling is unreliable here).
- **Approval-gated items** (MD-4, LEAD-1, C4-5, CH-1): produce a mock/plan and get Matt's approval before implementing. Do not free-style them.
- Keep verification **trimmed** - a few real checks per task, not exhaustive checklists.

## Testing & deploy ritual

Before anything is considered done / before Matt pushes:
- `node run-all-tests.mjs` (tripwire suites: recorder-contract, stats-replay, MP-lockstep).
- `node validate-sw-assets.mjs` (diffs the real `ASSETS` array in `sw.js` against disk).
- **If you add or rename any file:** add it to `ASSETS` in `sw.js` (and to **Monopoly Deal's nested SW asset list** if it is a `business-deal/` file), and **bump the cache version** (root `game-hub-v152` -> v153 ...; nested `business-deal-hub-v29` -> v30 if you touched `business-deal/`). Otherwise it deploys un-precached - the failure that once bit `connect-four/index.html`.

## Cost-benefit rationale (why the order above)

Ranked by player-experience benefit against effort. Effort S/M/L is a rough estimate; re-check in code.

| Order | Task (doc) | Benefit | Effort | Note |
|---|---|---|---|---|
| 1 | BUG-2 Ball Run black screen (02) | High | S-M | Replay is broken; WebGL fix path known |
| 1 | BUG-1 difficulty doesn't apply (02) | High | M | A whole feature looks broken across AI games |
| 2 | MODAL-1/2 end-game X (03) | High | S | Users trapped every game-end; Escoba pattern |
| 3 | FILLER-1 AI won't end game (04) | High | M-L | Broken core loop; the "15 screenshots" complaint |
| 3 | FILLER-2 unfair boards (04) | Med-High | M | Fairness; >=50% of games |
| 4 | LAYOUT-1/2 too tall (05) | Med | S-M | Scroll friction; batched |
| 5 | MD-2 default opponents 2 (06) | Med | trivial | Matches how Matt plays |
| 5 | MD-1 back button, MD-3 WILD both ends (06) | Low-Med | S | Cheap polish |
| 5 | MD-4 Just Say No rework (06) | High | M-L +approval | Decision-quality problem; mock first |
| 6 | CH-2 7-8 cards per row (07) | Med | S-M | Real annoyance; Escoba precedent |
| 7 | LEAD-1 leaderboard (08) | Med-High | M-L +approval +schema | Looks bad, missing info; secondary screen |
| 8 | C4-1 hide star while Analyzing (09) | Low-Med | S | Cheap glitch fix |
| 8 | C4-2/C4-3 confirms + stats (09) | Med | M | Shares stats work with LEAD-1 |
| 8 | C4-4 eval numbers wrong (09) | Med-High | M-L | Undermines trust in the hints feature |
| 8 | C4-5 overhaul (09) | Med | L +approval | Diffuse polish on a playable game; last |
| - | CH-1 highlight-sets look (07) | Low-Med | M +approval | No concrete ask; defer until Matt specifies |

## Task index (grouped by batch doc)

| ID | Doc | Title | Type | Screenshots |
|----|-----|-------|------|-------------|
| BUG-2 | 02 | Ball Run "Play Again" -> black screen (WebGL context) | Bug | 2 |
| BUG-1 | 02 | Difficulty change does not apply / selection state does not update | Bug | 2 |
| MODAL-1 | 03 | Filler end-game modal needs X (= "view board") | Enhancement | 12 |
| MODAL-2 | 03 | Chinchón end-game modal needs X | Enhancement | 19, 20 |
| FILLER-1 | 04 | Filler AI refuses closing color / will not end game | Bug | 5, 6, 7, 8 |
| FILLER-2 | 04 | Filler unfair starting boards (computer adjacent duplicate >=50%) | Bug | 15 |
| LAYOUT-1 | 05 | Nuts & Bolts too tall / scrolls | Bug | 3, 4 |
| LAYOUT-2 | 05 | Chinchón too tall + wasted top space | Bug | 16, 17 |
| MD-1 | 06 | Monopoly Deal: back button -> top-left | Enhancement | 9 |
| MD-2 | 06 | Monopoly Deal: default opponents -> 2 | Enhancement | 9 |
| MD-3 | 06 | Monopoly Deal: "WILD" on both ends of Wild card | Enhancement | 11 |
| MD-4 | 06 | Monopoly Deal: replace "Just Say No?" modal with pay-rent screen + JSN option | Redesign (approval-gated) | 10 |
| CH-2 | 07 | Chinchón: allow 7-8 cards in either hand row | Enhancement | 18 |
| CH-1 | 07 | Chinchón: dislike of "highlight sets" visual | Subjective (approval-gated) | 18 |
| LEAD-1 | 08 | Leaderboard redesign (W-L, difficulty breakdown, no h-scroll) | Redesign (approval-gated) | 1 |
| C4-1 | 09 | Connect Four: hide best-move star while "Analyzing..." | Bug | 13 |
| C4-2 | 09 | Connect Four: Undo confirm + game does not count towards stats | Enhancement | 13 |
| C4-3 | 09 | Connect Four: "See Best Moves" confirm + game does not count towards stats | Enhancement | 13 |
| C4-4 | 09 | Connect Four: evaluation numbers wrong or mis-displayed | Bug | 14 |
| C4-5 | 09 | Connect Four: general overhaul (copy Escoba) | Redesign (approval-gated) | 13 |

## Repo docs to lean on

- `CLAUDE.md` - THE LAW, module contracts, shared-module inventory, games table, MP invariants, settings/CSS/Firebase conventions, and the settled "Repo location" and "Monopoly Deal naming" sections.
- `game-hub-audit.md` + `AUDIT-UPDATE-2026-07-21.md` - the reconnaissance and delta this bundle is built from.
- `ARCH-REVIEW.md`, `RESTORE.md` - deeper architecture and restore procedure.
- `RAW_FEEDBACK.md` (this bundle) - Matt's verbatim words, the source of truth. `screenshots/` - the 20 originals.
