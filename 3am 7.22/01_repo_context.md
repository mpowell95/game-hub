# Batch 01 - Repo Context (known) + Targeted Confirmations

The architecture is known from `CLAUDE.md`, `game-hub-audit.md`, and `AUDIT-UPDATE-2026-07-21.md`, so most of
what a discovery pass would find is recorded below as fact. Read it, then do only the short **targeted
confirmations** at the end.

## Established facts

**Stack / deploy**
- Vanilla ES modules, no bundler, no `package.json`, no CI. Three.js vendored locally for Ball Run.
- Deploy: manual `git push origin main` -> GitHub Pages. You commit; **Matt pushes** after reviewing `git log`/`git status`.
- PWA. `sw.js` precaches an `ASSETS` array; cache key `game-hub-v152` at `sw.js:9`. Monopoly Deal has a nested SW `business-deal-hub-v29`. New/renamed files must be added to the relevant `ASSETS` and the cache version bumped, or they deploy un-precached.
- Manual pre-deploy: `node run-all-tests.mjs` (tripwire suites) and `node validate-sw-assets.mjs` (ASSETS-vs-disk diff). Not CI-enforced; run them.

**Layout (corrected)**
- The git repo is the local folder `...\Personal\Game-Hub\` (renamed from `Connect-Four/`). Its sibling `...\Personal\Game-Hub-Docs\` is a **separate NON-git archive** of planning/handoff docs - do not commit code there. (`CLAUDE.md` has a settled "Repo location" note. A stale `.claude/worktrees/` was removed; if old greps showed duplicate symbol hits, that was why.)
- `connect-four/` (lowercase, inside the repo) is the Connect Four game module, unchanged and unrelated to the old repo-folder name.
- Shared code in `js/`: `hub.js` (mount/teardown + navigation; hub registry at `:56-57,62`), `net.js` (MP transport), `firebase-boot.js`, `stats-net.js`, `firebase-config.js`, `game-stats-global.js` (classic recorder), `game-stats.js` (ESM recorder; `foldLegacy` `:237`, pending queue `:249`), `game-stats-ui.js` ("My Stats" UI, `:18`), `leaderboard-ui.js` (leaderboard UI, `:21`), `challenge/` (retired system + `keepsake.js`).
- Per-game folders: `connect-four/`, `chinchon/`, `escoba/`, `ball-run/`, `filler/`, `mancala/`, `business-deal/`, plus `parchis/` (source partly external). Each game follows a module contract with a `destroy()` teardown; `hub.js` mounts/unmounts them.

**Naming (corrected - was backwards in an earlier pass)**
- The game is **Monopoly Deal** (display name, in all user-visible strings). Folder `business-deal/`; stats id `business`. Folder/id names are not display names - intentional, not a contradiction. **Frozen, never rename:** `business-deal/`, hub `id:'business-deal'`, stats id `'business'` (localStorage + `players/<deviceId>/games/business`), `bd-stats`, `gamehub.bd.pendingStats.v1`. Renaming 404s installed apps / orphans player data. See `CLAUDE.md`'s settled "Monopoly Deal naming" section.

**Games relevant here (from audit)**
- Solo/local only (no `net.js`): Connect Four, Monopoly Deal, Nuts & Bolts, Filler, Mancala, Ball Run. MP: Chinchón, Escoba.
- **Escoba is the exemplar.** Its recent polish already solved several things this feedback asks for elsewhere: an **X-to-close on the end-of-match popup**, a **fixed-geometry / space-utilization** layout (no layout shift, viewport treated as a budget), a **card-row-wrapping fix** (5+ cards no longer overflow to an invisible row), and an **unassisted mode** (hints/pre-selection hidden). Mirror these.
- **Ball Run** is Three.js: constants in `ball-run/js/config.js`, renderer/teardown in `ball-run/js/render.js` (a `forceContextLoss()` after `dispose()` context-loss fix exists around `:419`), pauses on `visibilitychange`, disposes GPU on exit.
- **Monopoly Deal** (`business-deal/`) is offline-first with its **own nested service worker** (`business-deal-hub-v29`) and its **own in-scope copy of `game-stats-global.js`**; retry queue `gamehub.bd.pendingStats.v1`. Any file you add there goes in BD's own SW asset list too. User-visible strings live at `business-deal/index.html:5,12,38`, `business-deal/manifest.json:2-4`, `business-deal/js/ui.js:299,317,384` (setup dialog, menus). Audit flags "BD's AI-invocation timing not fully read" - relevant to MD-4.

**Stats / leaderboard**
- localStorage `gamehub.stats` (protected key; legacy shapes must load - `test-stats-replay.mjs`). Networked mirror in RTDB `players/`+`usernames/` via `stats-net.js`. Identity: `gamehub.deviceId`.
- Two recorders (`game-stats-global.js`, `game-stats.js`) + Monopoly Deal's copy must agree - `test-recorder-contract.mjs`.
- Leaderboard render: `js/leaderboard-ui.js`. Per-game tabs (see screenshot 1). Reads from the stats store.

**Landmines to avoid (from audit)**
- Chinchón/Escoba hold live Firebase listeners + heartbeats while mounted; their `destroy()` must call `net.disconnect()`/`stopHeartbeat()`. The audit did NOT verify this is wired - do not break `destroy()`; if you touch Chinchón mount lifecycle, confirm teardown.
- `database.rules.json` is blanket `auth != null` read/write (open). Not your task, but do not assume rules protect anything.
- `escoba/js/game.js:82` `fromSnapshot` hardcodes `Math.random` - neutralized for MP, irrelevant to this feedback.
- `mancala/js/ui.js` was flagged off-limits during a past parallel edit. No Mancala feedback here; leave it alone.

## Targeted confirmations (the real unknowns - do these, quickly)

Confirm in the repo; still not pinned down:

1. **Nuts & Bolts folder slug** - `nuts-bolts/` (matching `ball-run/`, `connect-four/`) or something else? (LAYOUT-1)
2. **Filler internals** - where is AI move-selection, and where is the initial board generated? Filler is not covered in the audit. (FILLER-1/2)
3. **Connect Four internals** - where is the "best moves" evaluator, where are per-column evaluation numbers rendered, and where is the undo handler? (C4-*)
4. **Difficulty plumbing** - how is difficulty chosen, stored (settings-key convention per `CLAUDE.md`), and passed into each game's agent? Selector per-game or shared? (BUG-1)
5. **Monopoly Deal Wild-card + rent/JSN flow** - where is the Wild property card rendered, and the rent / "Just Say No" flow? (Setup modal / opponent default is around `business-deal/js/ui.js:299,317,384`.) Read BD's AI-invocation timing before MD-4. (MD-*)

(Resolved since the earlier pass: leaderboard render file = `js/leaderboard-ui.js`; My-Stats = `js/game-stats-ui.js`.)

Record answers wherever the project keeps working notes (do not rely on session memory across CC runs).

## Exit criteria
- [ ] The 5 confirmations above are answered (or marked "not found - investigate").
- [ ] You can run the app locally and `node run-all-tests.mjs` passes on a clean checkout.
