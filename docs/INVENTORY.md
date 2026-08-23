# Documentation Inventory

Produced by a read-only audit of every `.md` file in this repo (105 files, ~21,000 lines,
excluding the stray `.claude/worktrees/` git worktree). Every file was read in full by one of
11 parallel review passes, cross-referenced against the root `CLAUDE.md`, and in a few cases
against the live code (grep) where two docs disagreed about current behavior. This file is the
inventory only — nothing was moved, edited, or deleted, and no topic files were written.

**How to read the bucket column:**
- **BINDING** — a rule/convention that still governs how work is done, not fully stated in root `CLAUDE.md`.
- **REFERENCE** — factual detail about a game/subsystem, useful when working in that area.
- **HISTORY** — a completed, superseded piece of work; kept for incident/decision record.
- **DISPOSABLE** — served its one purpose; nothing depends on it and nothing would change from deleting it.

A file can hold more than one bucket's worth of content — the table gives its *dominant*
character; the BINDING section below pulls out every binding rule regardless of which file
it was found in.

---

## 1. File table

| File | Lines | Bucket | Summary |
|---|---:|---|---|
| `CLAUDE.md` | 348 | — (root, always loaded) | The always-loaded root doc; not scored, everything else is measured against it. |
| `js/CLAUDE.md` | 1051 | BINDING/REFERENCE | Auto-loaded shared-module doc. THE LAW in full, MP lockstep invariants + 9 numbered "consumers," leaderboard rating model, sync health, per-player store split, Ana/Natalia record, head-to-head capture, shared-profile contract. The single richest file in the repo; genuinely missing a Yahtzee MP write-up (see §4). |
| `README.md` | 67 | HISTORY | Public repo README describing only 3 games and a 2-folder layout; badly stale against the 16-game hub. |
| `RESTORE.md` | 115 | BINDING | Device-restore runbook and monthly Firebase `players/` export procedure — THE LAW's operational counterpart, absent from root. |
| `RESTORE.md`-adjacent: `database.rules.README.md` | 35 | BINDING | The `database.rules.json` MERGE-don't-replace rule and why RTDB rules are intentionally wide open. |
| `ARCH-REVIEW.md` | 392 | HISTORY | July-2026 point-in-time architecture review; most of its S5 roadmap has since shipped. |
| `BUILD_INSTRUCTIONS.md` | 118 | REFERENCE | Yahtzee pixel-reproduction build brief; the "shared two-player scorecard" invariant is still relevant if anyone touches scoring. |
| `ConnectFour_Session1_Kickoff_Prompt.md` | 40 | DISPOSABLE | One-off CF bitboard-engine kickoff prompt; fully superseded. |
| `game-hub-and-connect-four-spec.md` | 124 | HISTORY | Pre-build planning spec for the hub shell + CF ("planning only, not yet built"); realized and partly reversed since. |
| `game-hub-audit.md` | 136 | HISTORY | Point-in-time recon audit (commit `739341f`, sw v151); superseded by later CLAUDE.md updates. |
| `HANDOFF-NEXT-SESSION.md` | 113 | HISTORY | 2026-07-23 state-of-play handoff; 3+ weeks stale, and its "commit ≠ push" claim is dead per current practice. |
| `HANDOFF.md` | 207 | DISPOSABLE | Gitignored 2026-07-03 snapshot of a 2-game hub; everything in it has changed. |
| `3am 7.22/00_README_START_HERE.md` | 158 | HISTORY | Cover sheet for a completed 8-batch feedback bundle (2026-07-22); defines a batch-local "THE LAW" restatement including the `#ffce3a` accent rule (see §4). |
| `3am 7.22/01_repo_context.md` | 67 | HISTORY | Pre-briefed repo facts + 5 confirmations, all answered and closed. |
| `3am 7.22/02_bugs_ballrun_difficulty.md` | 49 | HISTORY | Ball Run replay black-screen + Chinchón difficulty-selector bugs, both fixed. |
| `3am 7.22/03_modal_close_buttons.md` | 45 | HISTORY | Adds X-close to Filler/Chinchón modals; later generalized hub-wide. |
| `3am 7.22/04_filler_ai_and_board.md` | 64 | HISTORY | Filler AI stall + unfair-board bugs, both fixed. |
| `3am 7.22/05_layout_viewport_fixes.md` | 47 | HISTORY | Nuts & Bolts / Chinchón mobile viewport-overflow fixes. |
| `3am 7.22/06_monopoly_deal.md` | 87 | HISTORY | Four shipped Monopoly Deal fixes. |
| `3am 7.22/07_chinchon_interaction.md` | 52 | HISTORY | Chinchón "highlight sets" + 7-8 card row freedom; decided later in batch 10. |
| `3am 7.22/08_leaderboard_redesign.md` | 54 | HISTORY | An early leaderboard redesign proposal, superseded by the shipped wins-only + difficulty-pill design. |
| `3am 7.22/09_connect_four_overhaul.md` | 107 | HISTORY | CF bug/overhaul batch; the "weak evaluator" item was later resolved by a real solver. |
| `3am 7.22/10_designed_followups.md` | 116 | HISTORY | Closing decisions for the arc: hub-wide close-X, real CF solver, Chinchón meld treatment. |
| `3am 7.22/RAW_FEEDBACK.md` | 164 | HISTORY | Verbatim 20-item source feedback the whole `3am 7.22/` bundle was built from; all items dispositioned. |
| `CC-1-tokens-and-fan.md` | 69 | HISTORY | Session 1/4 of the **Uno** visual rebuild (despite "CC" prefix — not Chinchón): token system + `_syncFan`. |
| `CC-2-card-face.md` | 63 | HISTORY | Session 2/4 Uno rebuild: pressed-plastic card face + fixed geometry. |
| `CC-3-motion.md` | 65 | HISTORY | Session 3/4 Uno rebuild: CSS motion/animation system. |
| `CC-4-sort-toggle.md` | 69 | HISTORY | Session 4/4 Uno rebuild: display-only hand-sort toggle. |
| `UNO-DESIGN-SPEC.md` | 377 | REFERENCE | Approved Uno visual spec: fan geometry formula, motion timing table, sort-is-presentation-only invariant — content since folded into `uno/CLAUDE.md`. |
| `YAHTZEE_CLONE_SPEC.md` | 534 | HISTORY | Original pixel-exact Yahtzee build brief; superseded by `yahtzee/CLAUDE.md` for architecture, though see §4 for the Joker-rule cross-check. |
| `8ball-pool-build-spec.md` | 376 | REFERENCE | Original standalone 8-ball layout/physics/rules spec; still the source for fraction tables/geometry except where later handoffs override it. |
| `POOL-REBUILD-PROMPT.md` | 212 | HISTORY | Kickoff prompt for the Pool visual rebuild; mission complete, mostly duplicated by `HANDOFF-POOL-VISUAL-REBUILD.md`. |
| `HANDOFF-POOL-VISUAL-REBUILD.md` | 430 | HISTORY | The binding integration handoff for the (now-completed) 2026-07-29 Pool visual rebuild; folded into `pool/CLAUDE.md`. |
| `poolv2/BUILD-SPEC.md` | 813 | REFERENCE | From-scratch build spec for `poolv2/`; still the authoritative doc for its physics derivation and open items. |
| `poolv2/CLAUDE.md` | 341 | BINDING/REFERENCE | Current auto-loaded doc for `poolv2/` — naming isolation, physics, controls, AI, MP. `poolv2` is confirmed live in `js/hub.js` (devOnly, alongside `pool`), not dead code. |
| `pool/CLAUDE.md` | 332 | BINDING/REFERENCE | Current auto-loaded doc for `pool/` — rulebook, visual-rebuild details, physics, controls, AI, MP, known limitations. |
| `pool/README.md` | 50 | REFERENCE | Practical run/controls doc; states the physics-constants-live-only-in-`physics.js` rule that isn't restated in `pool/CLAUDE.md` itself. |
| `HANDOFF-FB-BOGGLE.md` | 55 | HISTORY | Boggle haptics + shorter timers; haptics superseded by FB2-BOGGLE-CUE. |
| `HANDOFF-FB-CHINCHON.md` | 75 | HISTORY | Auto-close on fully-melded hand + setup-screen cleanup. |
| `HANDOFF-FB-CONNECT4-HINTS.md` | 102 | HISTORY | "Best Moves" panel solver-coverage expansion. |
| `HANDOFF-FB-DOTSBOXES.md` | 58 | HISTORY | Beginner capture highlight, 10x10 Large size, menu rename. |
| `HANDOFF-FB-FAVORITES-ORDER.md` | 42 | BINDING (contradicts root text) | Makes favorites custom-ordered via arrows — confirmed shipped (`moveFavorite` exists in `js/favorites.js`, `js/hub.js` only alphabetizes the non-favorites group). Root `CLAUDE.md`'s "favorites first, then alphabetically" line is incomplete/misleading as a result — see §4. |
| `HANDOFF-FB-HOWTO.md` | 83 | HISTORY | Round-1 How-to-play rewrites to the TTT pattern. |
| `HANDOFF-FB-INDEX.md` | 69 | HISTORY | Batch map for the 2026-07-23 feedback arc. |
| `HANDOFF-FB-LEADERBOARD.md` | 77 | HISTORY | Player drill-down design (superseded by FB2-STATS-NAV), Snake unit-label bug, TTT split. |
| `HANDOFF-FB-RESUME.md` | 65 | HISTORY | Autosave/resume added to 6 games; matches root's `isInProgress()` table exactly. |
| `HANDOFF-FB-SETUP-CONVENTIONS.md` | 107 | BINDING (partly superseded) | Alternate-first-player default (still current, see §4); its Beginner/Intermediate/Pro tier vocabulary was reversed the next day by FB2-DIFFICULTY. |
| `HANDOFF-FB-SNAKE.md` | 74 | HISTORY | Scroll-leak fix, wrap-around walls mode. |
| `HANDOFF-FB-THEME.md` | 89 | REFERENCE | Design + rollout plan for hub-wide light/dark theme. |
| `HANDOFF-FB2-BOGGLE-CUE.md` | 46 | HISTORY | Removes dead iOS haptics hack, adds gold visual valid-word cue. |
| `HANDOFF-FB2-DIFFICULTY.md` | 91 | BINDING | Reverses tier vocabulary to Easy/Medium/Hard/Expert — see §4. |
| `HANDOFF-FB2-HOWTO2.md` | 100 | HISTORY | How-to round 2: Mancala overhaul, Ball Run slideshow restored. |
| `HANDOFF-FB2-INDEX.md` | 62 | HISTORY | Batch map for the 2026-07-24 arc; confirms the tier-name reversal. |
| `HANDOFF-FB2-PARCHIS.md` | 68 | HISTORY | Hub language now controls Parchís (now documented in `parchis/CLAUDE.md`). |
| `HANDOFF-FB2-STATS-NAV.md` | 66 | HISTORY | My Stats redesigned as leaderboard-style drill-down. |
| `HANDOFF-FB3-HOWTO3.md` | 80 | HISTORY | QA round 3: missing How-to sheets, TTT variant bug. |
| `HANDOFF-FB3-HUB-LB-FIXES.md` | 67 | HISTORY | Dark-mode contrast, reorder-arrow overlap, version-pill fixes. |
| `HANDOFF-FB3-I18N-SWEEP.md` | 52 | HISTORY | Untranslated fallback strings, Spanish overflow bugs. |
| `HANDOFF-FB3-SETTINGS-RESUME.md` | 62 | BINDING | Settings-persist-on-selection for all 12 games — see §4. |
| `HANDOFF-FB4-QA-POLISH.md` | 95 | BINDING | CF/Uno fixes; hub knobs hidden on all mounted screens incl. setup — see §4. |
| `HANDOFF-LAW-DEDUP.md` | 70 | HISTORY | Reduces THE LAW from 10 repeats to 1 in root; confirmed executed. |
| `HANDOFF-I18N-EXTRACTION.md` | 149 | HISTORY | The big EN/ES extraction mechanism/rollout plan; largely executed (Boggle/Parchís exclusions later reversed). |
| `HANDOFF-CLAUDEMD-SPLIT.md` | 399 | HISTORY | Plan to split monolithic CLAUDE.md into root + per-game files; confirmed executed, current structure matches. |
| `HANDOFF-HUB-FAVORITES-TILES.md` | 416 | HISTORY | Original 3-phase landscape-tiles + favorites spec; all phases shipped. |
| `HANDOFF-HUB-TILES-PHASE3.md` | 291 | HISTORY | Marked "STATUS: COMPLETE"; archive of Phase 3 art-recomposition rationale + a reusable screenshot-verification technique. |
| `HUB-HANDOFF-1.md` | 96 | HISTORY | Completed build record for the shared profile page; contract now in root's "shared profile" section. |
| `HUB-HANDOFF-2.md` | 105 | REFERENCE | Completed wiring record; still-accurate per-game profile precedence table (CF/Chinchón/Business Deal). |
| `HUB-HANDOFF-3.md` | 58 | HISTORY | Completed copy-pass/QA/deploy record for the profile feature. |
| `HANDOFF-LEADERBOARD-CORRECTION.md` | 338 | HISTORY | The Ana/Natalia incident; matches root's pointer, already applied via `fix-natalia-record.mjs`. |
| `HANDOFF-LEADERBOARD-REDESIGN.md` | 219 | BINDING (partly superseded) | Approved 2026-07-23 redesign: unified chrome band spec (`--gh-band-*`) still binding; its Beginner/Intermediate/Pro pill labels were superseded by the Easy/Medium/Hard/Expert reversal — see §4. |
| `HANDOFF-LB-SOLO-RUNS.md` | 377 | BINDING | 2026-07-28 follow-on: solo games (Ball Run/Snake/Nuts & Bolts) count as "runs," not "wins" — see §4. |
| `HANDOFF-LB-FILTER-SORT.md` | 503 | HISTORY | Leaderboard filter/sort redesign — confirmed shipped in `js/leaderboard-ui.js` today. |
| `HANDOFF-MP-LOCAL-MACHINE.md` | 504 | REFERENCE | Real-device MP verification playbook; the two-profile (not two-tab) methodology is still the only spec for this, and Parchís MP + N-player testing are still open. |
| `HANDOFF-MP-ROADMAP.md` | 324 | BINDING | Sequenced MP plan; phases 0-2 done, but the N-player (2-4 seat) decision and phase 4 (Uno/Escoba 2-4/Chinchón 2-4/Monopoly Deal/Parchís MP) are still open work — see §4. |
| `HANDOFF-MP-WEB-SESSION.md` | 455 | BINDING | The `js/net.js` protocol contract + 5 invariants + per-game MP briefs; still-live briefs for Uno, Connect Four, Monopoly Deal (never built) — see §4. |
| `HANDOFF-BALLRUN-NEWMAP.md` | 242 | REFERENCE/BINDING | Architecture explainer for building a second Ball Run map; contains 4 correctness landmines not confirmed present in `ball-run/CLAUDE.md` — see §4. |
| `HANDOFF-BOGGLE-SPANISH.md` | 176 | HISTORY | Completed bilingual-Boggle-UI fix (gameplay stays English); its `translate="no"` + lang-stamp fix is confirmed folded into `boggle/CLAUDE.md`/`js/CLAUDE.md`. |
| `HANDOFF-DB-LASTMOVE.md` | 274 | HISTORY | Completed last-drawn-edge glow feature for Dots and Boxes; cosmetic-field-outside-hashed-state pattern not independently re-confirmed in `dots-boxes/CLAUDE.md`. |
| `HANDOFF-BOGGLE.md` | 555 | HISTORY (contains one live error) | Original Boggle build spec, now shipped. Section 9.5 incorrectly claims `players-agg.js` needs no change for Boggle — this is the likely source of the exact bug root `CLAUDE.md` says was caught "twice... Dots and Boxes, then Boggle." Still sitting uncorrected in this file — see §4. |
| `HANDOFF-DOTS-BOXES.md` | 464 | HISTORY | Original Dots and Boxes build spec, now shipped. |
| `HANDOFF-PROFILE-MESSAGE.md` | 272 | HISTORY | Completed profile "message" field; folded into root's "shared profile" section. |
| `HANDOFF-PROFILE-UNTANGLING.md` | 201 | BINDING | Part 1 of the Ana/Natalia diagnosis: the no-per-play-event-log-except-Ball-Run architecture fact, and the explicit-permission-required norm for touching live player data — see §4. |
| `HANDOFF-SNAKE-DPAD.md` | 138 | HISTORY | Completed on-screen D-pad feature for Snake. |
| `HANDOFF-TICTACTOE.md` | 507 | BINDING | Full TTT/Ultimate build spec; the "Pro Classic is unbeatable by design" and "don't cut the AI's send-penalty term" warnings were **not** found in `tic-tac-toe/CLAUDE.md` by the batch that read it in full — see §4. |
| `HANDOFF-UNO-VISUAL.md` | 235 | HISTORY | Uno visual-rebuild task list; its `_syncFan` exemption and sort-invariant warnings are confirmed present in `uno/CLAUDE.md` today. |
| `HANDOFF-UNO.md` | 137 | HISTORY | Original Uno build handoff; its frozen ruleset is confirmed carried into `uno/CLAUDE.md`. |
| `escoba/escoba-broom-handoff.md` | 112 | DISPOSABLE | Broom-sweep/round-2 UI spec; every item confirmed re-described in `escoba/CLAUDE.md` today. |
| `ball-run/CLAUDE.md` | 520 | BINDING/REFERENCE | Authoritative Ball Run doc: renderer context-loss/teardown rule, Orbital map's shared `DIFFICULTIES` reference landmine. Does not appear to restate `HANDOFF-BALLRUN-NEWMAP.md`'s 4 landmines — see §4. |
| `boggle/CLAUDE.md` | 256 | BINDING/REFERENCE | Authoritative Boggle doc: solver/AI, closed iOS-haptics investigation, `translate="no"` requirement, non-lockstep MP design. |
| `boggle/data/CREDITS.md` | 20 | REFERENCE | ENABLE word-list attribution (public domain). |
| `business-deal/CLAUDE.md` | 42 | BINDING | The file root `CLAUDE.md` explicitly designates as authoritative for the naming-split rationale; states the PWA-scope-is-path-based technical reason. |
| `chinchon/CLAUDE.md` | 366 | BINDING/REFERENCE | Layout, deck registry, meld-engine notes, solo autosave, 2-4 seat MP, deck-art authoring gotcha. Does not contain an "accordion" description despite root crediting Escoba (not this file) for that pattern — see §4. |
| `chinchon/decks/anita/CREDITS.md` | 25 | REFERENCE | Custom Anita deck attribution/provenance. |
| `chinchon/decks/baraja-libre/CREDITS.md` | 17 | BINDING | CC BY-SA 3.0 license — a real legal constraint on future modifications to the default deck art, referenced but not fully restated in `chinchon/CLAUDE.md`. |
| `connect-four/CLAUDE.md` | 142 | BINDING/REFERENCE | Worker AI, alternate-first-move default, hint-panel algorithm. Confirms (via code) that CF now persists two settings keys — root's games table row is stale. |
| `dots-boxes/CLAUDE.md` | 192 | BINDING/REFERENCE | Board sizes, Pro AI, autosave, 2-4 seat MP build. Separate-MP-key convention ("not Escoba's shape") stated here. |
| `escoba/CLAUDE.md` | 300 | BINDING/REFERENCE | The repo's deepest per-game doc: zero-layout-shift rule, snapshot resume, overhang-budget CSS, MP hardening. Does **not** contain the accordion setup-screen description root credits it with — see §4. |
| `filler/CLAUDE.md` | 208 | BINDING/REFERENCE | Flood-fill engine, pro-tier AI fix, 2-seat MP build, `redeliverRequested` race fix. |
| `mancala/CLAUDE.md` | 128 | BINDING/REFERENCE | Kalah engine, CSS-scoping reference, 2-seat MP (origin of the `redeliverRequested` fix). |
| `nuts-bolts/CLAUDE.md` | 78 | REFERENCE | Procedural level generator, viewport-fit tiering, auto-resume. |
| `parchis/CLAUDE.md` | 45 | BINDING | Build-from-sibling-repo process; "do not hand-edit `parchis/index.html`"; hub language deliberately overrides own prefs (the one exception to profile precedence). |
| `snake/CLAUDE.md` | 163 | BINDING/REFERENCE | i18n reference-implementation notes, wrap-mode-is-a-rule-variant-not-a-stats-fork rule, scroll-leak guard detail. |
| `tic-tac-toe/CLAUDE.md` | 244 | BINDING | Contains the actual, generic how-to-play-screen pattern spec (§"How-to-play screens") — the text root `CLAUDE.md` cites this file for. Full MP-lockstep/autosave mechanics. |
| `uno/CLAUDE.md` | 619 | BINDING | Matt's frozen house ruleset ("do not re-litigate"), engine correctness invariants, measured AI win-rate thresholds, token/motion-system structural guarantees. |
| `yahtzee/CLAUDE.md` | 252 | BINDING | Viewer-relative-vs-absolute seat MP design, no-autosave decision, no-room-abandon-exception. Flags its own TODO: a Yahtzee entry was never added to `js/CLAUDE.md`'s MP-consumer section — confirmed still missing. |

---

## 2. BINDING findings — the actual rules, by topic

Quotes are given with source file and line range. "Properly placed" means the rule already
lives in an auto-loaded `<folder>/CLAUDE.md`, so it is BINDING but not ORPHANED — it's here
because it's still a real, current rule worth having in one place. Everything marked
**ORPHANED** is cross-referenced again in §4.

### 2.1 Data governance / Firebase (beyond THE LAW's 9 rules, already in `js/CLAUDE.md`)

- **`database.rules.json` must be merged, never replaced.**
  `database.rules.README.md:1,9` — *"database.rules.json is ONE canonical file. MERGE, do not
  replace... whichever project ships second MUST MERGE its branch into this existing file
  under `"rules"`, never replace the file. Keep every branch."* **ORPHANED.**

- **Device-restore procedure: relink by player code, never touch `deviceId`.**
  `RESTORE.md:19-47` — describes `players-agg.js`'s display-time aggregation as the actual
  restore mechanism (enter the lost device's player code, tap Link, history reappears).
  **ORPHANED** — root only names the backup *script*, not this *procedure*.

- **Monthly manual `players/` Firebase export, kept outside the repo.**
  `RESTORE.md:84-100` — concrete click-by-click Firebase-console steps (kebab menu → Export
  JSON). **ORPHANED.**

- **Writes to `players/`, `usernames/`, or anyone's profile/stats are explicit-permission-required, not scriptable unilaterally.**
  `HANDOFF-PROFILE-UNTANGLING.md:171-175` — *"treat writes to `players/`, `usernames/`, or
  anyone's `gamehub.profile`/`gamehub.stats` as high-stakes and explicit-permission-required...
  Show him exactly what you intend to change and why, get a yes, then do it."* **Likely
  ORPHANED** — not confirmed present in `js/CLAUDE.md`'s Ana/Natalia section by the pass that
  read it; needs a direct check.

- **No per-play event log exists for any game except Ball Run.**
  `HANDOFF-PROFILE-UNTANGLING.md:27-36` — *"there is no per-play event log for any game except
  Ball Run... for every other game, the best available fix is at the level of 'whose bucket
  does this device's CURRENT total belong in,' not 'which specific game was whose.'"*
  **Likely ORPHANED** — a hard architectural ceiling on any future identity-correction work;
  not confirmed verbatim in `js/CLAUDE.md`'s per-player-store-split section.

### 2.2 Colorblind / accessibility (a second convention beyond root's 4-hue palette)

- **`#ffce3a` is the standing selection/emphasis accent, always paired with a non-color indicator.**
  `3am 7.22/00_README_START_HERE.md:81` — *"Selection/attention color is `#ffce3a`, ALWAYS
  paired with a non-color indicator (shape, icon, label, border)."* Confirmed still live: a
  repo-wide grep hits 21 files including current CSS in Pool, Ball Run, Chinchón, Connect Four,
  Escoba, Nuts & Bolts, Poolv2, plus `js/hub.js`, `js/game-art.js`, `icons/icon.svg`.
  **ORPHANED** — this is a real, hub-wide, actively-used convention with no home in root
  `CLAUDE.md`'s accessibility section.

- **Difficulty tiers get their own colorblind-safe shape/color mapping**, distinct from the
  general 4-hue palette: green circle (Easy), blue square (Medium), black diamond (Hard),
  double black diamond (Expert) — implemented in `js/difficulty-tiers.js`, applied consistently
  across Chinchón, Connect Four, Dots and Boxes, Mancala, Nuts & Bolts, Filler CLAUDE.md files.
  **Properly placed** in principle (each game's own CLAUDE.md documents its use) but the
  *shared* mapping itself lives only in `js/difficulty-tiers.js` with no prose description in
  any auto-loaded CLAUDE.md — worth a one-paragraph home in `js/CLAUDE.md`.

### 2.3 Hub / launcher (beyond the module contract root already documents)

- **Favorites render in custom (arrow-reorderable) order, not alphabetically** — only the
  non-favorites group is alphabetical. Confirmed shipped: `js/favorites.js` exports
  `moveFavorite(id, delta)`, and `js/hub.js`'s `byTitle` sort is applied only to `restGames`
  (the non-favorite set), not to favorites. **Root `CLAUDE.md`'s own text — "favorites first,
  then alphabetically by display title within each group" — is therefore incomplete: it's true
  of the *whole grid's grouping* but not of *how favorites are ordered within their group*.**
  Source of the original design: `HANDOFF-FB-FAVORITES-ORDER.md:19-23`.

- **`.hub-game` sets no explicit height**, so any `immersive`-style full-bleed canvas game can
  silently collapse toward the browser's intrinsic canvas size unless the game's own CSS sets
  `min-height: 100dvh` + `flex: 1`. This independently bit both Pool and Poolv2.
  `pool/CLAUDE.md:96-117`, `poolv2/CLAUDE.md:303-310`, `HANDOFF-POOL-VISUAL-REBUILD.md:90-118`.
  **Partially orphaned** — documented per-game where it was hit, but not as a named hub-wide
  CSS trap the way the version-pill diagnostic is.

- **Module stylesheets, once injected, are never removed on `destroy()`** — a hub-wide fact
  (not poolv2-specific) used to justify poolv2's separate CSS prefix. `poolv2/CLAUDE.md:14-16`.
  Root's module contract says injection is idempotent but never says it's *permanent*.
  **Partially orphaned** — true of every module game, stated only in one game's folder doc.

- **Hub language/theme/version knobs must stay hidden on every mounted game screen, setup
  screens included**, not just during live play. `HANDOFF-FB4-QA-POLISH.md:63-69`. Not in
  root's module contract. **ORPHANED.**

- **Unified chrome "band" spec** shared by the hub top bar, Leaderboard, and My Stats overlays:
  `--gh-band-title: 44px; --gh-band-controls: 36px; --gh-band-filter: 34px` as CSS custom
  properties in `css/hub.css`. `HANDOFF-LEADERBOARD-REDESIGN.md:44-56`. **Needs a direct check
  against `css/hub.css`** to confirm it shipped as specified; not restated anywhere else.

### 2.4 Settings / setup-screen conventions

- **Settings must persist on selection change, not only at game start** — sweep all 12 in-hub
  games. `HANDOFF-FB3-SETTINGS-RESUME.md:7-16`. **ORPHANED** — not in root's "Adding a game"
  checklist, which only says *where* to persist (the key), not *when* to write.

- **Turn-based games default to "Alternate who goes first."** An explicit saved you/opponent
  choice always wins over the default; "Alternate" swaps on every completed game including
  rematches. Origin: `HANDOFF-FB-SETUP-CONVENTIONS.md:13-32`. **Properly placed** — confirmed
  restated, with the concrete `nextStarter`-flip mechanism, in `connect-four/CLAUDE.md:65-76`,
  `dots-boxes/CLAUDE.md:37-51`, `filler/CLAUDE.md:25-35`, `mancala/CLAUDE.md:61-71`, and a
  solo-only variant in `chinchon/CLAUDE.md:50-60`. Root `CLAUDE.md` doesn't mention this
  convention at all — a new turn-based game built only from root's checklist would miss it.

- **Difficulty display vocabulary is Easy/Medium/Hard/Expert, never Beginner/Intermediate/Pro.**
  This *reversed* an initial decision from the day before. Origin:
  `HANDOFF-FB2-DIFFICULTY.md:8-9,32-36`, confirmed final by `HANDOFF-FB2-INDEX.md:44-45`.
  **Properly placed** — confirmed current in `chinchon/CLAUDE.md:61-64`,
  `connect-four/CLAUDE.md:77-79`, `dots-boxes/CLAUDE.md:55-57`, `nuts-bolts/CLAUDE.md:28-31`.
  Root `CLAUDE.md` states no tier vocabulary at all. Note: `HANDOFF-LEADERBOARD-REDESIGN.md`
  and `HANDOFF-FB-SETUP-CONVENTIONS.md` still describe the superseded Beginner/Intermediate/Pro
  names — a reader hitting those files first without also finding the reversal would get it
  wrong.

### 2.5 Multiplayer (`js/net.js`)

- **MP save-key convention going forward: a separate `gamehub.<game>.mp.v1` key**, not Escoba's
  sub-object-inside-the-solo-key shape (which is frozen gen-1, THE LAW rule 5, not a model to
  copy). `dots-boxes/CLAUDE.md:145-148`, `filler/CLAUDE.md:158-160`,
  `mancala/CLAUDE.md:102-104`, echoed by `HANDOFF-MP-WEB-SESSION.md:121-137` ("follow
  Chinchón, not Escoba"). **Properly placed**, consistent across 3+ per-game docs.

- **MP results always record under the `'mp'` difficulty bucket**, settled by Tic Tac Toe, not
  under whatever local AI-tier was last selected. `dots-boxes/CLAUDE.md:150-151`,
  `filler/CLAUDE.md:192-193`, `mancala/CLAUDE.md:108-109`. **Properly placed.**

- **Never change `js/net.js`'s protocol as a side effect of one game's MP work** — any protocol
  change gets its own handoff, review, and real-device verification pass.
  `HANDOFF-MP-WEB-SESSION.md:164-167`. **ORPHANED.**

- **MP must support 2-4 players for multi-seat games, not 2** (Matt, 2026-07-26) — reverses an
  earlier 2-player-cap recommendation. `HANDOFF-MP-ROADMAP.md:14-17`. Confirmed still
  unimplemented outside Chinchón (which now has 2-4 seat support per `chinchon/CLAUDE.md`) —
  Uno, Escoba beyond 2, Monopoly Deal, and Parchís MP remain unbuilt. **ORPHANED**, and still
  live open work.

- **"A session ships MP code and headless proof; it never reports 'multiplayer works.'"**
  `HANDOFF-MP-WEB-SESSION.md:50-56`. A standing process/reporting rule for any future MP build
  session without real-device access. **ORPHANED.**

- **B0 verification methodology: two separate browser profiles, never two tabs in one profile**
  (tabs share `localStorage`/`deviceId`, hiding exactly the seat/stats bugs the pass exists to
  find). `HANDOFF-MP-LOCAL-MACHINE.md:78-95`. **ORPHANED** — a reusable technique for anyone
  verifying Parchís MP or the N-player extension whenever those ship.

- **Yahtzee genuinely uses `js/net.js` for multiplayer** (confirmed: `yahtzee/js/ui.js` imports
  `js/net.js` and calls it "the third consumer" in a comment) **but `js/CLAUDE.md`'s own
  numbered MP-consumer walkthrough (the "third" through "ninth consumer" sections) never
  mentions Yahtzee** — confirmed by a full-file read and grep. `yahtzee/CLAUDE.md:200-201`
  flags this exact gap as a known, still-open TODO in its own text. This is a live THE-LAW-rule-9
  violation in the very file that's supposed to be authoritative for MP mechanics.

- **Connect Four's settings-key row in root `CLAUDE.md`'s games table is stale.** Root still
  reads *"none (persists nothing — see its file)"*; confirmed via grep that
  `connect-four/js/ui.js` defines both `SETTINGS_KEY = 'gamehub.connect4.v1'` and
  `GAME_KEY = 'gamehub.connect4.save.v1'`. `HANDOFF-MP-WEB-SESSION.md:274-281` flagged this
  exact bug in 2026-07 and it is still uncorrected today. This is a live, currently-true
  documentation error in the always-loaded root file.

### 2.6 Per-game correctness landmines

Properly placed (confirmed present in the game's own auto-loaded `CLAUDE.md`):

- **Ball Run** — renderer teardown must pass `fullExit=false` on an in-place restart or the
  WebGL context is permanently lost (`ball-run/CLAUDE.md:16`); Orbital and Classic maps
  deliberately share one `DIFFICULTIES` object reference, so retuning one silently retunes both
  until someone deliberately splits them (`ball-run/CLAUDE.md:56-61`).
- **Boggle** — the iOS-haptics investigation is closed, do not re-attempt
  (`boggle/CLAUDE.md:46-60`); `translate="no"` on `.bg-root` must never be removed
  (`boggle/CLAUDE.md:245-250`); Boggle's MP is deliberately *not* the shared lockstep protocol
  (`boggle/CLAUDE.md:127-129`).
- **Business Deal** — folder rename would break every installed PWA, since PWA scope/`start_url`
  are path-based (`business-deal/CLAUDE.md:20-21`).
- **Parchís** — never hand-edit the built `parchis/index.html`, edit the sibling-repo source and
  rebuild via `recombine.mjs` (`parchis/CLAUDE.md:13-17`); hub language deliberately overrides
  Parchís's own saved language preference, the one exception to "own settings beat the profile"
  (`parchis/CLAUDE.md:25-28`).
- **Escoba** — zero-layout-shift is an explicit design rule, not an accident
  (`escoba/CLAUDE.md:67-73`); when the vertical layout budget changes, re-measure with
  `document.documentElement.scrollHeight` vs `window.innerHeight` rather than guessing
  (`escoba/CLAUDE.md:136-141`, reused by Nuts & Bolts).
- **Chinchón** — deck art must be rasterized flat at fixed width onto white, never cropped to
  content bbox, never shipped transparent (`chinchon/CLAUDE.md:185-191`); the default
  `baraja-libre` deck is CC BY-SA 3.0, and that license (plus attribution) survives any
  modification (`chinchon/decks/baraja-libre/CREDITS.md:14-17`).
- **Uno** — Matt's frozen house ruleset, explicitly "do not re-litigate" (`uno/CLAUDE.md:24-46`);
  turn-advance must go through the single `_advance(steps)` primitive
  (`uno/CLAUDE.md:55-87`); the Hard-tier AI's win-rate thresholds are asserted in `test.js` and
  must be re-measured if `ai.js` changes (`uno/CLAUDE.md:124-132`); the `_syncFan` DOM-persistence
  exemption and the CSS `clip-path` rebuild are both marked "do not revert"
  (`uno/CLAUDE.md:229-234,363-376,505-516`).
- **Yahtzee** — MP requires *absolute*, not viewer-relative, player-index representation so both
  devices hash-verify identically (`yahtzee/CLAUDE.md:129-146`); there is deliberately no
  autosave/resume, and no room-abandon exception on ordinary hub navigation the way Tic Tac
  Toe/Chinchón/Escoba have (`yahtzee/CLAUDE.md:20-24,113-118`).
- **Snake** — wrap-around walls is a rule *variant*, not a difficulty tier, and must record
  under the same stats ids as walled play per THE LAW rule 5 (`snake/CLAUDE.md:36-38,94-95`);
  the scroll-leak guard must cover the whole `.sn-pad` container, not just its buttons
  (`snake/CLAUDE.md:116-123`).
- **Tic Tac Toe** — `tic-tac-toe/CLAUDE.md:211-244` contains the actual, generically-written
  how-to-play-screen pattern spec (5-part structure: goal sentence, one SVG diagram, caption,
  "X = Y" example, edge-case sentences; "applies to EVERY game help screen, not just this one").
  This is the text root `CLAUDE.md` is pointing to when it names this file "the how-to-play
  screen pattern... its reference implementation" — root itself never states the pattern.

Likely or confirmed **ORPHANED** (not found in the game's own `CLAUDE.md` by the pass that read
it in full):

- **Ball Run's 4 map-building landmines** — always use `Track.worldPointAt`/`localFrameAt` for
  anything positioned relative to the track (this bug shipped twice); never add camera roll
  (rejected twice by Matt); curves are off and re-enabling needs a design conversation, not a
  flag flip; reuse `minSpacingFor()` for obstacle-row spacing, don't re-derive a simpler check
  (the cause of "the 46m wall" bug). `HANDOFF-BALLRUN-NEWMAP.md:44-49,95-100,122-132,196-198,230-240`.
  Not confirmed present in `ball-run/CLAUDE.md`, which documents different (also real) landmines.
- **Tic Tac Toe's AI correctness notes**: "Pro Classic is unbeatable by construction... do not
  weaken it," and the Ultimate AI's 4th eval term (the "send penalty") is the one term that must
  never be cut. `HANDOFF-TICTACTOE.md:153-155,179-181`. Not found in `tic-tac-toe/CLAUDE.md` by
  the pass that read the whole file.
- **A live, uncorrected error**: `HANDOFF-BOGGLE.md:381-384` (§9.5) states Boggle needs *no*
  `players-agg.js` change beyond adding it to `GAMES` — this directly contradicts root
  `CLAUDE.md`'s own account of a real bug ("missed twice... Dots and Boxes, then Boggle") and is
  very plausibly the literal source of that historical miss. The file is never auto-loaded, so
  nothing currently corrects this claim where a future reader might find it.
- **Pool**: "no aim-assist, ever" is confirmed present in `pool/CLAUDE.md:80-83` (properly
  placed), but "physics constants live only in `physics.js`'s header, never duplicated into
  CONFIG" is stated only in `pool/README.md:38-41` and two historical handoffs — **not** inside
  `pool/CLAUDE.md` itself. Also orphaned: **"leave `poolv2/` completely alone"** — a real
  cross-game non-interference instruction stated only in `POOL-REBUILD-PROMPT.md:152` and
  `HANDOFF-POOL-VISUAL-REBUILD.md:36`, absent from both `pool/CLAUDE.md` and `poolv2/CLAUDE.md`.
- **Dots and Boxes**: the rule that a cosmetic UI field (the last-move glow) must never enter
  hashed/validated state, and a malformed cosmetic field must degrade rather than invalidate a
  save (`HANDOFF-DB-LASTMOVE.md:27-38`) was directed into `dots-boxes/CLAUDE.md` but wasn't
  independently re-confirmed there by the pass that read that file — worth a direct check.

### 2.7 Leaderboard / stats display

- **Solo games (Ball Run, Snake, Nuts & Bolts) contribute a separate "runs" count, not "wins."**
  `HANDOFF-LB-SOLO-RUNS.md:51-54` (2026-07-28, later than root's "wins-only... 2026-07-23"
  note). **Likely properly placed** in `js/CLAUDE.md`'s leaderboard section (each source handoff
  explicitly instructs writing it there) but not independently re-confirmed by name in this
  audit — worth a direct check since it postdates the date root cites.
- **A draw does not count as a win** — a documented reversal of an earlier design, confirmed
  present in `js/CLAUDE.md:649-656`. Root `CLAUDE.md`'s summary has no coverage of this
  reversal at all (not a gap in an orphaned file — a gap in what root *doesn't* summarize about
  its own linked file).
- **Escoba's setup-screen accordion — the pattern root `CLAUDE.md` names Escoba as the
  reference for — could not be found described in prose anywhere in `escoba/CLAUDE.md`.** The
  only in-repo restatement found is a *consumer* citing it (`dots-boxes/CLAUDE.md:14`, "Setup
  screen is Escoba's accordion pattern"), not Escoba's own file describing itself. The behavior
  presumably lives in `escoba/js/ui.js`/CSS, undocumented in prose. This is worth fixing —
  either add the description to `escoba/CLAUDE.md`, or point root's citation at the code
  directly instead of implying the doc explains it.

---

## 3. DUPLICATED content

Only substantive duplication is listed — restatements of an already-canonical root
`CLAUDE.md` rule (e.g. "no em dashes," "bump `sw.js` CACHE last") are extremely common across
the `HANDOFF-*.md` corpus and are not re-listed file-by-file below; they're noted once here as
a pattern.

- **Pattern-level**: nearly every `HANDOFF-*.md` and per-game `CLAUDE.md` restates, in its own
  words, the already-root-level rules for: no em dashes, colorblind-safe color+shape pairing,
  `sw.js` CACHE-bump-as-last-edit, and "update this game's CLAUDE.md before calling the task
  done" (THE LAW rule 9). This is expected/healthy repetition of a rule that's supposed to be
  followed per-task, not a documentation problem.

- **The Escoba setup-screen accordion / "copy Escoba, not Connect Four" instruction** — the
  task prompt's own example. Appears (at minimum) in `3am 7.22/00_README_START_HERE.md:76`,
  `3am 7.22/01_repo_context.md:26`, `3am 7.22/05_layout_viewport_fixes.md:4`,
  `3am 7.22/07_chinchon_interaction.md:5-6`, `3am 7.22/09_connect_four_overhaul.md:4`,
  `3am 7.22/10_designed_followups.md:7-8,92-93`, `HANDOFF-BOGGLE.md:63`,
  `HANDOFF-DOTS-BOXES.md:59`, and `dots-boxes/CLAUDE.md:14`. Best wording: root `CLAUDE.md`'s
  own "Adding a game" axis table — it's the one place this is stated as policy rather than as a
  per-task instruction, though as noted in §2.7, none of the *implementation* detail lives
  anywhere.

- **The `#ffce3a` colorblind accent rule** — `3am 7.22/00_README_START_HERE.md:81`,
  `02_bugs_ballrun_difficulty.md:21`, `07_chinchon_interaction.md:21`,
  `08_leaderboard_redesign.md:39`, `10_designed_followups.md:7-10,80-81,100`. Best wording:
  `00_README_START_HERE.md:81` (states the hex, the pairing rule, and a concrete example).

- **The `.hub-game` height trap and its CSS fix** — `POOL-REBUILD-PROMPT.md:80-85`,
  `HANDOFF-POOL-VISUAL-REBUILD.md:90-118`, `pool/CLAUDE.md:96-117` (two write-ups, the second
  superseding the first), `poolv2/CLAUDE.md:303-310`. Best wording: `pool/CLAUDE.md:108-117`
  (documents the more complete, second fix).

- **Pool physics grounding (Marlow/Alciatore constants)** — `poolv2/BUILD-SPEC.md:78-334` (the
  full derivation), `poolv2/CLAUDE.md:65-104`, `pool/CLAUDE.md:119-158` (near word-for-word
  copy of poolv2's version). Best/most complete: `poolv2/BUILD-SPEC.md` for the actual formulas.

- **Pool AI design (ghost-ball × pocket, `simulateToRest` lookahead, skill-tier scoring)** —
  `poolv2/BUILD-SPEC.md:430-462` (fullest, with scoring table), `poolv2/CLAUDE.md:154-164`,
  `pool/CLAUDE.md:185-195` (near-identical text but **missing** the seeded-RNG/worker-thread fix
  poolv2's copy documents — a real behavioral divergence between the two games' AI, not just a
  doc duplicate).

- **"Alternate who goes first" default** — `connect-four/CLAUDE.md:65-76`,
  `dots-boxes/CLAUDE.md:37-51`, `filler/CLAUDE.md:25-35`, `mancala/CLAUDE.md:61-71`. Best
  wording (has Matt's direct quote): `connect-four/CLAUDE.md:69-70`.

- **MP save-key convention ("separate key, not Escoba's shape")** —
  `dots-boxes/CLAUDE.md:145-148`, `filler/CLAUDE.md:158-160`, `mancala/CLAUDE.md:102-104`.
  Near-identical wording in all three; `dots-boxes/CLAUDE.md` is clearest.

- **"MP results record under the `'mp'` difficulty bucket"** — verbatim-identical clause in
  `dots-boxes/CLAUDE.md:150-151`, `filler/CLAUDE.md:192-193`, `mancala/CLAUDE.md:108-109`.

- **Difficulty label reversal to Easy/Medium/Hard(/Expert)** — `chinchon/CLAUDE.md:61-64`,
  `connect-four/CLAUDE.md:77-79`, `dots-boxes/CLAUDE.md:55-57`, `nuts-bolts/CLAUDE.md:28-31`.
  `chinchon/CLAUDE.md` gives the fullest history (names the reverted rename explicitly).

- **The async remote-move delivery race (`mp.redeliverRequested` flag)** —
  first found and fixed in `mancala/CLAUDE.md:372-386`, then independently in
  `filler/CLAUDE.md:399-405`, referenced again for `dots-boxes/CLAUDE.md:418-420`. Also
  restated in `js/CLAUDE.md`'s own Mancala/Filler consumer sections. This is deliberate
  cumulative cross-referencing (each game's fix cites the pattern), not accidental copy-paste.

- **"The protocol is proven headlessly against `FakeRoom`; real-room behavior is unverified"
  status line** — defined once in `HANDOFF-MP-WEB-SESSION.md:52-56`, then repeated near-verbatim
  across `HANDOFF-MP-LOCAL-MACHINE.md` (4 occurrences) and `HANDOFF-MP-ROADMAP.md` (2
  occurrences), and echoed independently by `pool/CLAUDE.md`, `boggle/CLAUDE.md`, and
  `chinchon/CLAUDE.md`'s own MP sections for their respective unverified-on-real-devices status.
  This reflects a real, still-true state (most MP games remain real-device-unverified) more than
  it reflects redundant documentation.

- **"Sessions commit but do not push" vs. current practice** — a genuine *contradiction*, not
  just duplication. `HANDOFF.md:88-97` (2026-07-03) has the session push directly;
  `3am 7.22/00_README_START_HERE.md:75` and `HANDOFF-NEXT-SESSION.md:99` both assert the
  opposite ("commit ≠ push"). Neither matches current practice — per the user's own standing
  preference, sessions now commit *and* push. Flagging so this contradiction isn't mistaken for
  a live rule if only one of these files is read.

---

## 4. ORPHANED rules (stated only in a file nothing auto-loads)

Everything in this list is a real, still-plausibly-binding rule whose only home is a file that
is never read automatically — not root `CLAUDE.md`, not any `<folder>/CLAUDE.md`. (Items marked
"needs cross-check" could not be fully confirmed absent from a per-game `CLAUDE.md` within this
audit's scope and deserve a direct look before treating them as gaps.)

1. `database.rules.README.md` — the `database.rules.json` MERGE-not-replace rule.
2. `RESTORE.md` — the device-relink restore procedure and the monthly `players/` export steps.
3. `3am 7.22/00_README_START_HERE.md` (+ 4 duplicate locations) — the `#ffce3a` colorblind
   selection/emphasis accent rule.
4. `HANDOFF-PROFILE-UNTANGLING.md` — explicit-permission-required for writes to live player
   data; the no-per-play-event-log-except-Ball-Run architectural ceiling. *(needs cross-check
   against `js/CLAUDE.md`'s Ana/Natalia section)*
5. `HANDOFF-FB3-SETTINGS-RESUME.md` — settings must persist on selection, not only at game start.
6. `HANDOFF-FB4-QA-POLISH.md` — hub language/theme/version knobs must stay hidden on every
   mounted screen, setup included.
7. `HANDOFF-MP-WEB-SESSION.md` — never touch `js/net.js`'s protocol as a side effect of one
   game's work; the "ship code + headless proof, never claim MP works" reporting rule; the
   Chinchón-not-Escoba MP save-key recommendation for new games.
8. `HANDOFF-MP-ROADMAP.md` — the 2026-07-26 "MP must support 2-4 players, not 2" decision, and
   the concrete list of still-unbuilt MP work (Uno, Monopoly Deal, Parchís, Escoba beyond 2).
9. `HANDOFF-MP-LOCAL-MACHINE.md` — the two-browser-profiles (not two tabs) verification
   methodology.
10. `HANDOFF-BALLRUN-NEWMAP.md` — the 4 Ball Run map-building landmines (local-frame math,
    camera-roll ban, curves-off, `minSpacingFor()` reuse). *(needs cross-check — confirmed
    absent from `ball-run/CLAUDE.md` by the pass that read it, but that pass did not treat this
    as exhaustive)*
11. `HANDOFF-TICTACTOE.md` — the "Pro Classic is unbeatable by design" and "don't cut the
    Ultimate AI's send-penalty term" correctness warnings. *(needs cross-check — confirmed
    absent from `tic-tac-toe/CLAUDE.md` by the pass that read it)*
12. `HANDOFF-BOGGLE.md` §9.5 — contains a **live, uncorrected wrong claim** (Boggle needs no
    `players-agg.js` change), sitting undiscoverable in a file nobody auto-loads, that looks
    like the actual origin of a bug root `CLAUDE.md` documents as already having happened.
13. `pool/README.md` / `HANDOFF-POOL-VISUAL-REBUILD.md` / `POOL-REBUILD-PROMPT.md` — "physics
    constants live only in `physics.js`'s header, never duplicate into CONFIG" (absent from
    `pool/CLAUDE.md` itself); "leave `poolv2/` completely alone" (absent from both `pool/` and
    `poolv2/`'s own CLAUDE.md files).
14. `HANDOFF-DB-LASTMOVE.md` — cosmetic UI fields must never enter hashed/validated save state,
    and must degrade rather than invalidate a save if malformed. *(needs cross-check against
    `dots-boxes/CLAUDE.md`)*

Two items are **discovered documentation bugs in root `CLAUDE.md` itself**, not orphaned-elsewhere
rules — listed here because they were found during this audit and are worth fixing directly:

- Root's games table still lists Connect Four's settings key as "none (persists nothing)"; the
  game has persisted `gamehub.connect4.v1` and `gamehub.connect4.save.v1` since 2026-07, confirmed
  by grep against current code.
- Root's "favorites first, then alphabetically by display title within each group" line doesn't
  mention that favorites themselves are custom-reorderable (`moveFavorite`), not alphabetical —
  it's only the non-favorites group that's alphabetical. Both are true; the sentence as written
  reads like favorites are alphabetical too.

---

## 5. Proposed topic-file structure (proposal only — nothing below has been created)

The `HANDOFF-*.md` corpus is, almost without exception, historical build/fix records whose
durable content has either (a) already migrated into a per-game `CLAUDE.md` and can be treated
as pure HISTORY, or (b) never migrated and is sitting orphaned per §4. The highest-value cleanup
isn't deleting the handoffs (THE LAW rule 5's spirit argues for leaving history alone) — it's
giving the orphaned rules in §4 a real home. Suggested topics, one file each, all living under
`js/CLAUDE.md` or a new `docs/` folder so they're either auto-loaded or clearly signposted from
root:

1. **A "Firebase & data governance" section in `js/CLAUDE.md`** — `database.rules.json`'s
   merge-not-replace rule, the device-restore procedure, the monthly export steps, and the
   explicit-permission-required norm for live player-data writes. All four are THE LAW's direct
   operational counterpart and belong next to THE LAW's 9 rules, not scattered across
   `RESTORE.md`/`database.rules.README.md`/a Part-1 diagnostic handoff.

2. **A "Hub-wide CSS/JS traps" section in root `CLAUDE.md` or `js/CLAUDE.md`**, parallel to the
   existing version-pill diagnostic — the `.hub-game`-has-no-explicit-height trap (bit two
   games already) and the stylesheets-never-removed-on-`destroy()` fact both belong here as
   named, searchable gotchas rather than discoverable only after a new game hits them.

3. **A "Second-tier accent color" line in root `CLAUDE.md`'s accessibility section** — just the
   `#ffce3a` hex + pairing rule, one sentence, next to the existing 4-hue palette.

4. **A "Setup-screen and settings conventions" addition to root `CLAUDE.md`'s "Adding a game"
   checklist** — three real, currently-orphaned conventions belong here: settings persist on
   selection (not just start), turn-based games default to Alternate-who-goes-first, and hub
   chrome knobs stay hidden on every mounted screen including setup. All three currently exist
   only because a "3-edit rule"-style miss hasn't happened yet to force the issue.

5. **A "Multiplayer roadmap and process rules" section in `js/CLAUDE.md`**, appended after the
   existing numbered consumers — the N-player (2-4 seat) decision and its still-open game list,
   "never touch `js/net.js`'s protocol as a side effect," the "ship code + headless proof, never
   claim it works" reporting norm, the Chinchón-not-Escoba save-key recommendation, and the
   two-profiles-not-two-tabs verification method. This is where a **Yahtzee MP consumer
   write-up** also needs to be added — its complete absence from `js/CLAUDE.md` today is the
   single most concrete gap this audit found in the repo's most important shared doc.

6. **Per-game fixes, no new topic file needed** — just add the missing rule to the game's own
   `CLAUDE.md`: Ball Run's 4 map-building landmines, Tic Tac Toe's two AI-correctness warnings,
   Escoba's setup-screen accordion description (currently described nowhere, only cited by
   consumers), Pool's physics-constants-single-source rule and the "leave poolv2 alone"
   instruction (and its mirror in `poolv2/CLAUDE.md`), and Dots and Boxes' cosmetic-field
   save-safety pattern.

7. **A correction, not a new file**: fix `HANDOFF-BOGGLE.md` §9.5's wrong `players-agg.js`
   claim (or add a note pointing to the correction) so a future reader skimming it for
   reference doesn't reintroduce the exact bug it's suspected of having caused — and fix root
   `CLAUDE.md`'s two live documentation bugs found in §4 (Connect Four's settings-key row, the
   favorites-ordering sentence).

Everything else in the `HANDOFF-*.md`/`3am 7.22/`/`CC-*.md`/build-spec corpus can stay exactly
where it is, as HISTORY or REFERENCE — the rules worth promoting are the relatively small list
above, not the bulk of the ~21,000 lines.
