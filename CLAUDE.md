# Game Hub — CLAUDE.md

## Repo location (settled — do not change)

The local folder for this repo is `Game-Hub/`, under
`C:\Users\powel\OneDrive\Documents\CLAUDE CODE\Personal\`.
The GitHub remote is `mpowell95/game-hub`. These now match. They did not always:
this folder was called `Connect-Four/` until 2026-07-21, a leftover from when the
project was only Connect Four.

`Game-Hub-Docs/` (sibling folder) is the planning/handoff archive. It is NOT a git
repo and is NOT part of this project. Do not merge it in, and do not confuse it
with this repo.

The local folder name has no relationship to the remote, the Pages deployment, the
site URL, or any player data. Do not "fix" or rename it again.

A small, ad-free, installable **PWA that hosts self-contained game modules**. Vanilla
JS (ES modules), **no build step, no dependencies, no framework**. Deploys as static
files (e.g. GitHub Pages). A shared **user profile** prefills every game (see "The shared profile").

## Monopoly Deal naming (settled — do not change)

The game displays as **Monopoly Deal** everywhere a player can see; the folder is
`business-deal/` and several internal identifiers use `business` / `bd`. **This split is
intentional and load-bearing — never "fix" it.** The stats id `'business'` keys every player's
history in `gamehub.stats` and `players/<deviceId>` (THE LAW rule 1); `business-deal/` is the
live PWA scope/URL; `bd-stats` and `gamehub.bd.pendingStats.v1` are frozen storage keys. A
directory name is not a display name. Full rationale and the enumerated identifiers:
`business-deal/CLAUDE.md`. If an audit calls this split "contradictory," the audit is mistaken.
This is closed.

## THE LAW: player data is never deleted, never lost, never put at risk

THE LAW is Matt's, in his own words, set after a migration made his entire Ball Run history
invisible (July 2026, commits `d7f284b` through `a5571f3`):

> **"You must never delete or lose or risk deleting or losing any player data. You must always
> verify this."**

That is the entire law. No feature, cleanup, refactor, or deadline outranks it. It sits at the
top of this always-loaded file on purpose; every `<game>/CLAUDE.md` and `js/CLAUDE.md` opens
with a pointer back here. Do not re-duplicate it, and do not move it below the fold.

Nine working rules are derived from it — written by working sessions, one per real incident, and
binding because each encodes a way THE LAW actually got violated once. One line each here; the
full rules with rationale and incident history are in `js/CLAUDE.md` (auto-loaded when working
on the stats/sync code they mostly govern):

1. **Stored is not enough; data must stay visible** — history no screen shows reads as deleted;
   prove every UI gate still shows pre-change data.
2. **Writes are additive, only** — counters increment, bests only improve (`Math.max`). One-tap
   recreatable preferences (e.g. launcher favorites) are exempt; earned history never is.
3. **Migrations carry forward everything that CAN be carried** — genuinely unit-incompatible
   values are archived under a legacy key and still SHOWN, honestly labeled.
4. **Never fabricate conversions** between incomparable metrics.
5. **Old keys are never deleted, never repurposed.**
6. **No silent write failures** — verify by fresh re-read, or at minimum log loudly.
7. **Test migrations against real history** (the actual old writer code from git), never fresh
   synthetic stores.
8. **When a player reports missing data, believe them** — replay the code history before blaming
   caches or user error.
9. **A milestone is not done until CLAUDE.md reflects it** — undocumented conventions get
   silently re-derived (and re-diverged) by the next session.

## "Commit," "push," or "deploy" means LIVE on the deployed Game Hub — not just committed to a branch

Matt (2026-08-04), after a session pushed a finished game to its feature branch and stopped
there, leaving it invisible on the real site: *"Anytime I say, commit, push, or deploy, it means
make it live on the gamehub app... Do not respond until it's fucking live."*

A commit on a feature branch, or even a pushed branch with an open PR, is **not done** under this
instruction. Pages deploys from `main` only. When Matt asks for a commit/push/deploy, the session
must, without waiting for further confirmation at each step:

1. Commit and push the work (to the branch it's already on, per that session's own instructions).
2. Open a PR into `main` if one doesn't already exist for that branch.
3. **Merge the PR into `main`.**
4. **Verify the `pages build and deployment` workflow run for that merge commit actually
   completes with `status: completed` / `conclusion: success`** — merging alone starts the
   deploy, it does not finish it, and a session that stops at "merged" without checking the run
   has not actually confirmed anything is live.
5. Only then tell Matt it's live — and say so plainly, not "pushed" or "merged," since those words
   are exactly what caused the confusion this rule exists to prevent.

This whole sequence is pre-authorized by this instruction; it does not need to be re-confirmed
per session. The one thing worth pausing for is a genuinely destructive step this doesn't cover
(e.g. a force-push, a history rewrite) — ordinary merge-to-main-and-deploy is not that.

## Run it

```
node server.mjs           # serves the repo root at http://localhost:8123
#   http://localhost:8123/              hub launcher
#   http://localhost:8123/profile/      the shared profile page
#   http://localhost:8123/connect-four/ a game, standalone
#   http://localhost:8123/chinchon/     a game, standalone
```
A plain dev server is required (ES modules, module workers, and the service worker
can't run from `file://`). It sends `Cache-Control: no-store` so dev edits aren't cached.

### Diagnostic: the version pill stuck at `vN → vN+1`

The hub's top-bar version pill compares the ACTIVE service worker's cache version
(`GET_VERSION` message to `navigator.serviceWorker.controller`) against the version parsed
from a fresh, no-store fetch of the deployed `sw.js`. If they differ it renders
`vN → vN+1` and marks itself stale. **If that arrow never resolves after a reload (or two),
the new service worker's install failed.** This is the tell to look for before suspecting
anything else when a deploy "didn't take." `RESTORE.md` and `validate-sw-assets.mjs` are the
prevention/detection pair.

**Much narrower since 2026-08-02** (see "The service worker's caching strategy" below): the
install used to `cache.addAll()` the ENTIRE ~8.8 MB list atomically, so one 404'd `ASSETS`
entry — a single missing card image — aborted the whole install and the previous worker kept
serving the old build offline forever. Only the ~600 KB app shell is atomic now, so a bad path
in a game folder no longer strands a deploy; it warms best-effort, logs loudly, and caches on
demand instead. A stuck pill now means the SHELL failed to install, which is a much shorter
list of suspects. `test-sw-strategy.mjs` pins this as a regression probe.

### The service worker's caching strategy (rewritten 2026-08-02)

Matt: *"the gamehub is sluggish and glitchy."* Both halves of `sw.js`'s strategy were tuned for
a fast desktop connection and misbehaved on a phone with poor service. The full rationale is in
`sw.js`'s own comments; the shape, so a future session doesn't "simplify" it back:

- **Two-tier precache.** `SHELL` (the hub itself — `index.html`, `css/`, `js/`, `icons/`,
  `profile/`; ~43 entries, ~600 KB) is atomic and blocks the install. `REST` (every game's own
  files, ~242 entries, ~8.4 MB) is warmed AFTER activation by `warmRest()`, best-effort, with
  bounded concurrency, skipping anything already cached so it is resumable. The warm is
  deliberately **not** inside `activate`'s `waitUntil` — functional events wait on that promise,
  so awaiting the warm there would block the very page load the split exists to speed up.
- **Network-first with a DEADLINE, not network-first forever.** The old handler only fell back to
  cache when a fetch *failed*; a weak-but-alive signal never fails, it just takes seconds per
  request. `NET_TIMEOUT_MS` (2.5s) races the network against the cached copy; the network still
  wins every race on a healthy connection, so freshness online is unchanged.
- **Plus a `SLOW_LATCH_MS` (10s) "the network is bad right now" latch.** The deadline alone is
  charged per request, and a cold start is a serial chain (index.html → hub.js → its imports →
  theirs), so each hop re-paid it. Once one request proves the link is slower than the deadline,
  the rest of that page load goes straight to cache and revalidates in the background. The latch
  expires on its own — a recovered connection needs no event to go back to network-first.
- **A request with nothing cached is never short-circuited** by either mechanism: it waits for the
  network, because a deadline with no fallback would only turn a slow load into a broken one.

Measured on a warm cache against a server injecting 8s per request (the regime the report was
about): **40.6s → 2.6s** to a rendered launcher. `cache: 'reload'` is untouched — the
fifth-playthrough HTTP-disk-cache fix it exists for is orthogonal and still needed.

## Architecture

```
index.html              hub shell host
js/hub.js               launcher grid + module mount/unmount  (the GAMES registry)
css/hub.css             shell chrome only
sw.js                   shared service worker (deadline-bounded network-first; two-tier precache)
manifest.webmanifest    one manifest for the whole hub
profile/index.html      the shared profile page (name, emoji, color, opponents)
<game>/                 one folder per game (connect-four/, chinchon/, parchis/)
```

The hub shows a grid of game cards. Tapping a **module** game dynamically imports its
entry and mounts it into a content area (no page reload); tapping a **launch-out** game
navigates to its own deployed URL.

### Shared modules (`js/`)

One line per module; the full module map — roles, invariants, history, and everything below the
surface — lives in `js/CLAUDE.md`, auto-loaded whenever a session works on these files.

| Module | Role |
|---|---|
| `js/profile-store.js` | validated read/write of `gamehub.profile`; player-code helpers |
| `js/name-gate.js` | the shared, undismissable "choose a name" gate; every entry point calls it (`js/name-gate-auto.js` is its deferred form for classic-script pages) |
| `js/favorites.js` | hub-only launcher favorites (`gamehub.favorites.v1`) |
| `js/new-badge.js` | the launcher's time-limited "New" pill: pure date maths over each `GAMES` entry's `released` field (no storage, no DOM) |
| `js/i18n.js` | the EN/ES language layer: `getLang`/`setLang` (`gamehub.lang.v1`), `makeT(dict)`, `onLangChange`; Parchís's proven t() as a shared module |
| `js/theme.js` | the light/dark/auto theme layer: `getTheme`/`setTheme`/`resolvedTheme` (`gamehub.theme.v1`), `onThemeChange`; stamps `.gh-dark` on `<html>` |
| `js/viewport.js` | (2026-08-02) `onViewportResize(cb)` — the ONE way a game subscribes to "re-fit yourself". Folds `resize` + `orientationchange` + `visualViewport` into ONE callback, coalesced to at most once per frame and skipped entirely when neither dimension changed. **A new game must use this, never a raw `window.addEventListener('resize', …)`** — see its header for why the raw form is a scroll-jank bug on mobile |
| `js/game-stats.js` | unified stats, keyed per PLAYER (`statsKey()`/`statsId()`); one recorder per game |
| `js/game-stats-global.js` | non-ESM recorder port for Monopoly Deal/Parchís (`window.__ghStats`) |
| `js/firebase-boot.js` | the ONE bootstrap for the named `'stats'` Firebase app |
| `js/stats-net.js` | Firebase mirror to `players/<id>`; username registry; `syncHealth()` |
| `js/players-agg.js` | pure identity-graph aggregation of synced devices into per-person rows |
| `js/game-stats-ui.js` | "My Stats" overlay |
| `js/leaderboard-ui.js` | "Leaderboards" overlay (DOM only); wins-only display, rating retired from it (2026-07-23) |
| `js/leaderboard-rank.js` | pure, headless-testable rating/ranking maths (kept for a future rating page; not shown on the leaderboard since 2026-07-23) |
| `js/game-art.js` | single source of every hub tile's inline SVG art, keyed by hub id; `hub.js` and `leaderboard-ui.js` both read it |
| `js/difficulty-tiers.js` | READ-path mapping of difficulty vocabularies onto the 1-4 tier scale |
| `js/net.js` | multiplayer room layer (`rooms/<CODE>`) used by Chinchón, Escoba, Tic Tac Toe, Mancala, Filler, Dots and Boxes, Pool, Boggle, Yahtzee and Battleship |
| `js/a2hs.js` | add-to-home-screen bottom sheet |
| `js/device-report.js` | the profile page's "Device details" diagnostic |
| `js/challenge/` | retired challenge system — still load-bearing (`hub.js` imports its `hooks.js` on every load; do not delete) |

### Where the deep docs live

- **`js/CLAUDE.md`** — the full module map and Firebase layering, THE LAW's full working rules,
  the multiplayer lockstep invariants, the leaderboard rating model, sync health (and how to
  diagnose "my history is missing"), the per-player store split ("whose stats are these"), the
  Ana/Natalia correction record, head-to-head capture, and the shared-profile contract with
  Monopoly Deal's must-stay-synced duplicates.
- **`<game>/CLAUDE.md`** — each game's own docs (see the games table).
- **`tic-tac-toe/CLAUDE.md`** — the How-to-play screen pattern (its reference implementation).
### Dev tooling (repo root, not deployed)

| Script | Role |
|---|---|
| `server.mjs` | local dev server (ES modules/SW need real HTTP, not `file://`) |
| `validate-sw-assets.mjs` | fails if any `sw.js` `ASSETS` entry is missing on disk; warns about deployed files not in the list. Run before every deploy. |
| `test-sw-strategy.mjs` | (2026-08-02) `validate-sw-assets.mjs` checks WHICH files `sw.js` precaches; this checks HOW it serves them. Runs the real `sw.js` in a `vm` sandbox with a fake `caches`/`fetch` (so it can't drift from the shipped file) and pins the two-tier install, the fetch deadline, the slow-connection latch, and cache-first images. Its `[KNOWN-BUG PROBE]` block is the regression tripwire for the atomic-install failure that used to strand a whole deploy on one 404. |
| `players-agg.test.mjs` | headless unit tests for `js/players-agg.js`, plus a **[KNOWN-BUG PROBE] structural guard on checklist item 7**: it discovers every sub-counter key from `js/game-stats.js` itself and fails unless each one has BOTH a `players-agg.js` branch and a My Stats renderer. The per-game cases beside it are hand-written, so they only cover games someone remembered to add; this covers a NEW game's counter the day it is written. Missing the agg branch zeroes that counter the moment a person's second device syncs, with every local store intact - THE LAW rule 1, and the root file records it being missed twice in a row. |
| `test-new-badge.mjs` | (2026-08-01) headless unit tests for `js/new-badge.js` (window edges, malformed/absent dates, future dates), plus a scrape of the real `GAMES` registry asserting every `released` date that IS present parses — a typo'd date is the silent failure here (the game ships, the pill never appears) |
| `test-leaderboard-rank.mjs` | headless unit tests for the leaderboard rating model, incl. a LAW rule 1 block replaying the OLD visibility gate against the new one (nobody may fall off the board or lose plays) |
| `test-recorder-contract.mjs` | contract test: `js/game-stats-global.js` vs `js/game-stats.js` on their shared surface, incl. the fold-once interop and the BD in-scope copy sync |
| `test-stats-replay.mjs` | LAW rule 7, runnable: real historical `gamehub.stats` shapes (written by the actual old writers) loaded with current code, checked against the real UI visibility gates |
| `test-stats-identity.mjs` | (2026-07-23) the per-player store split (see "Whose stats are these" in `js/CLAUDE.md`): proves an existing device is completely undisturbed, that a second player on the same phone cannot blend into the first, that the device-wide legacy stores never fold into a forked store, and that the ES-module and global recorders resolve the same key. Rule 7 fixture is the real store from the device the Ana/Natalia incident happened on |
| `test-mp-lockstep.mjs` | headless two-engine MP lockstep for Chinchón + Escoba + Tic Tac Toe + Mancala over a fake room; mirrors the ui.js MP glue with per-method citations — update the mirror when the glue changes. Its [KNOWN-BUG PROBE] assertions are regression tripwires for the five fixed MP defects (see "Multiplayer lockstep — invariants" in `js/CLAUDE.md`); Tic Tac Toe's T1-T7 and Mancala's M1-M6 blocks each port all five into a game that shares none of Chinchón's vocabulary |
| `test-game-conventions.mjs` | (2026-08-02) the "Adding a game" checklist and the "USE WHAT EXISTS" table, made machine-checkable: no raw resize/`visualViewport` listeners, no `document`-level `touchmove`, every fixed scrolling overlay contains its scroll, every standalone page name-gated, the three module-contract exports present, listeners balanced, a `CLAUDE.md` and an `{en,es}` dictionary per game. Discovers game folders from disk so a NEW game is covered the day it appears. `KNOWN_GAPS` carries pre-existing debt (currently: Yahtzee has no i18n) — printed on every run, never silent, and the suite fails if an entry goes stale. **Written because prose alone did not work**: Hill Climb shipped the raw-resize bug the same day it was removed everywhere else, because the convention lived in `js/CLAUDE.md`, which a new-game session never auto-loads. |
| `test-visual.mjs` | (2026-08-08) the only suite that LOOKS at a game. Drives it in a real Chromium at 393x852 in light/dark/reduced-motion and fails on: nothing painted, the body scrolling sideways, a JS error on mount, or an animation too brief to follow (`MOTION` probes). Writes a contact sheet to `.visual-out/` - **open it.** **Checks only what CHANGED** (`node test-visual.mjs`), or named games (`... escoba`), or everything (`... --all`); a shared-code change (`js/`, `css/`, `index.html`, `sw.js`) RECOMMENDS a full sweep but never runs one - **always ask Matt before testing all games** (his rule, 2026-08-08). SKIPs without playwright-core/Chromium. Written after Battleship's cannon took four rounds of Matt's time: **`VISUAL-PROCESS.md` and `reference/` are the process it belongs to, and a session doing visual work must read them first.** |
| `run-all-tests.mjs` | runs every node suite above plus the per-game engine tests, exit-code aggregated. All green expected. Run before every deploy. |
| `read-device-reports.mjs` | (2026-07-22) Matt-only: fetches "Device details" reports (see `js/device-report.js`) from `deviceReports/` via the plain RTDB REST API (anonymous sign-in via the Identity Toolkit REST endpoint, no SDK/dependency) - `node read-device-reports.mjs [deviceId] [--raw]` |
| `backups/rtdb-backup.mjs` | (2026-07-23) **Run this before ANY script that writes to Firebase, any rules change, any schema change.** Timestamped full-DB snapshot to `backups/rtdb-<ISO>.json` via the same no-dependency REST pattern; `node backups/rtdb-backup.mjs [path]`. Also exports `signInAnonymously`/`readPath`/`totalPlays` for other tools. Restoring is deliberately NOT automated - a restore is a destructive write and must be hand-driven. **The snapshots are gitignored** (`backups/*.json`): this is a public repo and they hold every player's real name, code and stats. |
| `fix-natalia-record.mjs` | (2026-07-23) The one-off Ana/Natalia leaderboard correction, kept for audit. Dry run by default, `--write` to apply; it backs up first, simulates the post-write leaderboard with the repo's real `players-agg.js`/`leaderboard-rank.js` and aborts if any other player's row would move, then verifies by fresh re-read and diffs every pre-existing device record. **Already applied; re-running is a no-op (it refuses to create a second Natalia).** |

### The module contract

A game module's entry (`<game>/js/ui.js`) exports exactly three functions, plus a default
object bundling them. All fifteen in-hub module games (Connect Four, Chinchón, Dominoes, Escoba,
Filler, Mancala, Nuts & Bolts, Ball Run, Tic Tac Toe, Dots and Boxes, Boggle, Snake, Uno, Pool,
Hill Climb) export all three; grep-verify before assuming otherwise:

```js
export function init(container) { /* mount the whole game UI into `container` */ }
export function destroy() { /* remove ALL document/window listeners, stop timers/workers, clear container */ }
export function isInProgress() { /* true if the hub should confirm before navigating away */ }
export default { init, destroy, isInProgress };
```

- The hub mounts with `const m = await import(game.module); m.init(el);` and tears down with
  `m.destroy()` on back-navigation. **`destroy()` must be leak-free** — the hub reuses the
  same container for the next game.
- Keep a module-level `let instance`; `init` replaces any prior instance.
- The game must also run **standalone** from its own `<game>/index.html`, which links its
  CSS and calls `init(document.getElementById('<game>'))`. Same `init` either way. Every
  module game's `index.html` must also be in `sw.js`'s `ASSETS` list (run
  `node validate-sw-assets.mjs` to check) — Connect Four's was missing for a long time before
  a July 2026 fix, which silently broke offline standalone play with no other symptom.
- **A standalone page must gate on the name before it mounts** (2026-07-31). Its inline module is
  `import { requireName } from '../js/name-gate.js';` then `await requireName();` **before**
  `init(...)` — copy the block from any existing game's `index.html`. A standalone page is a door
  into the hub like any other, and the ungated ones are exactly where the leaderboard's ~20
  permanent "Unnamed player" rows came from (`js/CLAUDE.md`, "Nameless devices"). The app is not
  playable without a name; a new game must not reopen that hole.
- `isInProgress()` gates the hub's "leave game?" confirm (`hub.js` calls it before
  navigating back to the launcher) and has **two legitimate meanings** depending on whether
  the game can resume:
  - **No mid-game resume** (Ball Run, Snake, Hill Climb): returns `true` while a game/run is actually
    in progress, `false` otherwise. The literal meaning. Live-action runs; mid-run resume
    is meaningless.
  - **Autosave/resume built in** (every other module game — Escoba, Mancala, Connect Four,
    Tic Tac Toe, Dots and Boxes, Filler, Chinchón (solo), Boggle (solo), Nuts & Bolts, Uno, Pool
    (solo/practice)): returns
    `false` for solo play even mid-game, because leaving is lossless — each game snapshots
    after every state-changing event and picks up where it left off on return. Save keys:
    `escoba-save`, `gamehub.mancala.game.v1`, `gamehub.connect4.save.v1`,
    `gamehub.tictactoe.save.v1`, `gamehub.dotsboxes.save.v1`, `gamehub.filler.save.v1`,
    `gamehub.chinchon.solo.v1`, `gamehub.boggle.save.v1`, `gamehub.uno.save.v1`,
    `gamehub.pool.save.v1`, `gamehub.dominoes.save.v1`
    (Nuts & Bolts needed no new key —
    its existing `gamehub.nutsbolts.v1` kept-aside board already survived navigation; batch 9
    just made it auto-resume on mount instead of waiting for a matching-tier tap). Escoba's,
    Chinchón's, Tic Tac Toe's, Mancala's, Dots and Boxes', Pool's and Boggle's MP paths are each
    the exception within the exception: `isInProgress()` returns `true` only while an active
    multiplayer match is live (leaving mid-MP genuinely abandons the room), so one function
    answers two different questions depending on solo-vs-MP context.
  When adding a game, decide up front which meaning applies and say so in a comment next to
  `isInProgress()` — don't leave the next session to guess from behavior alone.
- An `immersive: true` entry in `hub.js`'s `GAMES` array (Escoba, Mancala, Ball Run, Yahtzee, Pool,
  Hill Climb)
  collapses the hub's header to a floating back button for games with their own full-bleed
  chrome. It's a de facto fourth registry flag, same status as `module`/`href`/`devOnly` —
  set it when a game wants to own the whole viewport.

### Before you build: USE WHAT EXISTS (read this before writing a line of a new game)

**This section is here, in the always-loaded root file, on purpose.** A session creating
`newgame/` auto-loads THIS file and `newgame/CLAUDE.md` (which doesn't exist yet) — it does **not**
auto-load `js/CLAUDE.md`, where most of the reasoning below is written up in full. So a convention
documented only there is invisible to exactly the session that needs it. That is not hypothetical:
Hill Climb shipped with a raw `window.addEventListener('resize', …)` on the same day that pattern
was removed from every other game as a mobile scroll-jank bug, purely because the session that
wrote it never loaded the file explaining why.

**`node test-game-conventions.mjs` enforces most of the table below.** Run it before you commit a
new game; it discovers game folders from disk, so a new one is covered the day it appears. A rule
that only lives in prose is advice, and advice loses to a session that never read it.

| Need | Use | Never |
|---|---|---|
| Re-fit on resize/rotate | `onViewportResize(cb)` — `js/viewport.js` | `window.addEventListener('resize'…)` or `orientationchange` or `visualViewport` directly. Mobile browsers fire `resize` continuously while the URL bar animates, so a raw listener re-lays-out the board several times per FRAME during every scroll |
| User-visible text | `makeT(STRINGS)` + `<game>/js/strings.js` `{en, es}` — `js/i18n.js` | hardcoded English. Call `t()` at RENDER time, never at module scope |
| Light/dark | `js/theme.js` (`.gh-dark` on `<html>`) | a `prefers-color-scheme` media query in game CSS — `'auto'` is resolved once in JS so the toggle always wins |
| Player name/emoji/opponents | `loadProfile()` — `js/profile-store.js` | your own prompt. Defaults-only: your saved settings beat it, and games never write it back |
| Recording a result | `recordX()` / `recordResult()` — `js/game-stats.js` | touching `localStorage['gamehub.stats']` yourself. See checklist item 7 for sub-counters |
| Difficulty markers | `diffShapeSVG()` / `tierOf()` — `js/difficulty-tiers.js` | hand-drawn shapes or hue-only tiers (Matt is red/green colorblind) |
| The name gate | `await requireName()` in `index.html` **before** `init()` — `js/name-gate.js` | mounting ungated. This is where the leaderboard's ~20 permanent "Unnamed player" rows came from |
| Multiplayer | `js/net.js` (`rooms/<CODE>`) | a second Firebase app or your own room layer. Read `js/CLAUDE.md`'s lockstep invariants first — five of them each encode a real, fixed bug |
| Hub tile art | `GAME_ART[id]` — `js/game-art.js` | inlining SVG in the `GAMES` entry; the leaderboard reads the same map |
| Buttons, cards, fields, modals | `css/ui.css`'s `.gh-*` primitives + `--gh-*` tokens | rebuilding chrome from scratch. **Currently used by no shipped game** — `snake-v2/` is the proof it works (140 lines of CSS against the real Snake's 279 for the same screens). A new game is the cheapest possible place to adopt it, because there is nothing to migrate |

**Scroll and touch rules, which are the ones most often missed:**

- **Any `position: fixed` overlay that scrolls needs `overscroll-behavior: contain`.** Without it a
  flick that reaches either end keeps going and pans the launcher underneath, so closing the overlay
  lands the player somewhere they never chose.
- **Never put a `touchmove` listener on `document` or `window`.** Bind it to the game's own root. A
  non-passive `touchmove` on `document` tells the browser any touch scroll anywhere might be
  cancelled, so compositor-thread scrolling is off for the WHOLE PAGE for as long as your game is
  mounted. A `touchmove` is dispatched at the element the touch started on and bubbles, so
  root-scoping loses no coverage.
- **A swipe surface gets `touch-action: none`; a tappable control gets `touch-action: manipulation`.**

**When you bump `CACHE` in `sw.js`, bump it past what is on `main` RIGHT NOW, not past what is in
your working copy.** Two branches open at once will both compute the same next number — that
happened on 2026-08-02 and produced two different builds both calling themselves `game-hub-v260`.
It is not cosmetic: `activate` only deletes caches whose name DIFFERS, and `warmRest` skips entries
already present so the warm can resume, so a device holding the other build's cache keeps it, takes
your shell over the top, and never refreshes the game files underneath — a permanently mixed build.

### Adding a game — checklist

**Copy per axis, not per game. No single game is the reference for everything** — an earlier
version of this paragraph named Escoba for all three axes below, and was wrong on two of them.

| Axis | Reference | Notes |
|---|---|---|
| Setup screen | **Escoba** (Chinchón mirrors it) | the accordion, one row open at a time. Filler's flat/segmented screen is acceptable for a small game. Connect Four's is the weakest in the repo; do not copy it. |
| CSS scoping | **Mancala** | every rule descendant-scoped under its root class (`.mancala .mc-x`, never a bare top-level `.mc-x`). Its root class predates the `.xx-root` naming convention (it's `.mancala`, frozen); new games use `.xx-root` (Escoba's `.eb-root` is the naming model) with Mancala's descendant-scoping discipline. Escoba, Filler and Connect Four all carry large numbers of bare top-level prefixed rules — a prefix alone is not isolation. |
| Settings **key** | **Filler / Mancala / Nuts & Bolts** | `gamehub.<game>.v1`, per item 4 below. Escoba's `escoba-settings` is a frozen gen-1 key, kept per THE LAW rule 5, and must never be the model for a new game. |
| Persisting settings at all | anything but Connect Four | Connect Four persists nothing. Every new game persists. |

**The settings *key* and the settings *screen* are separate axes and their best examples are
different games.** The key is a localStorage name the player never sees; the screen is the
setup UI they interact with. Do not infer one from the other — citing a game for its CSS
scoping or its storage key says nothing about whether its screen is worth copying.

When restructuring an old game, migrate it toward the reference for each axis independently.

1. Create `<game>/` with `index.html`, `css/<game>.css`, `js/ui.js` (+ engine modules).
2. `ui.js` exports `init`/`destroy`/`isInProgress` (see "The module contract" above) and
   injects its stylesheet idempotently via `new URL('../css/<game>.css', import.meta.url)`
   (so it's self-contained in the hub).
3. **Scope all CSS** under a root class `.xx-root` (2-3 letter game prefix; see the games
   table for existing prefixes — they are not all derived from the game's name the same
   way, e.g. Escoba is `.eb-`). Prefix every class `.xx-` and every custom property `--xx-`.
   **Every rule must be descendant-scoped under `.xx-root`** (`.xx-root .xx-card`, not a
   bare top-level `.xx-card`) — a prefix alone is not isolation, it just makes a collision
   less likely. Mancala's CSS is the cleanest example of this in the repo; Connect Four and
   Filler are prefix-only and rely on no one else having minted a colliding class yet.
4. **Persist settings under `gamehub.<game>.v1`** (e.g. `gamehub.filler.v1`,
   `gamehub.nutsbolts.v1`). This is the only settings-key convention going forward — three
   earlier generations exist in this repo (dashed `chinchon-settings`/`escoba-settings`,
   dotted un-namespaced `ballrun.*`) and are **frozen in place per THE LAW** (rule 5: old
   keys are never renamed or repurposed), but every *new* key must use this form.
5. Add an entry to `GAMES` in `js/hub.js`:
   - in-hub module → `module: '../<game>/js/ui.js'`
   - separately-deployed app → `href: '/<game>/'`
   - plus `id, title, blurb, badge, accent, art` (inline SVG — see the art requirement below).
   - **plus `released: 'YYYY-MM-DD'`, the day the game actually goes live.** It is the only
     input to the launcher's "New" pill (`js/new-badge.js`): the tile wears it for
     `NEW_DAYS` (7) days and then stops on its own — no follow-up commit, nothing stored, no
     cleanup. Omitting it is not a crash, it just means the game ships unannounced, which is
     why `test-new-badge.mjs` exists. Pre-existing games deliberately carry NO date (they were
     already live when the badge shipped, 2026-08-02) — do not backfill git commit dates, they
     are not release dates.
   - Array position is irrelevant: the launcher grid renders **favorites first, then
     alphabetically by display `title` within each group** (`localeCompare`), computed at
     render time in `js/hub.js` from `js/favorites.js`. A new entry needs no special handling
     for this — it's unfavorited by default and lands alphabetically among the rest. (The
     hidden challenge/admin card is the sole exception; it renders apart in `.hub-extra`.)
   - **Art must be landscape**: `viewBox="0 0 160 90"`, composed to fill that frame, with a
     full-bleed `<rect width="160" height="90" fill="…"/>` background. Do NOT draw a square
     composition and crop it with `preserveAspectRatio="slice"` — that was tried during the
     2026-07 tile redesign and rejected because it cuts shapes off mid-shape at the frame edge
     (it bisected Connect Four's discs). Compose for the frame you're given.
6. Add the game's files (including its `index.html`) to the `ASSETS` precache list in `sw.js`
   and **bump `CACHE`** (`game-hub-vN` → `vN+1`), or the new files won't be cached for
   offline. Run `node validate-sw-assets.mjs` before committing — it fails on any `ASSETS`
   entry that 404s on disk and warns about deployed `.js`/`.css`/`.html` files that aren't
   in the list yet, which is exactly the mistake that left Connect Four's standalone page
   uncached for a long time.
7. **If the game stores a per-game sub-counter** (`grid`/`cc`/`es`/`nb`/`br`/`tt`/`db`/`bg`/`yz`/`dm`/`hc`/`bs` —
   anything richer than `total`/`byDiff`), it needs **three** edits, not one, and missing the
   third is a THE LAW rule 1 bug that is invisible on a single device:
   - `js/game-stats.js` — an `ensureXx()` + its call in `normalize()`, plus the `recordXx()` writer.
   - `js/game-stats-ui.js` — a screen that actually RENDERS it (stored is not enough).
   - **`js/players-agg.js` — an explicit `else if (g === '<id>' && src.xx)` branch in
     `aggregatePlayers`.** The cross-device combine only carries sub-counters it names, so
     without this the game's own Stats screen reads zeroes the moment a person's second
     device syncs, even though `total`/`byDiff` stay correct and every device's local store
     is intact. Counters add; **bests take `Math.max`, never a sum**; a paired value (Boggle's
     `longestWord: {word,len}`) must move as a UNIT so the text always matches its own length.
   This was missed twice in a row (Dots and Boxes, then Boggle), both caught only by opening
   My Stats in a browser. `players-agg.test.mjs` now has a per-game regression case for each;
   add one for any new sub-counter. **The same file now also enforces this structurally** (it reads the sub-counter keys straight out of `game-stats.js`), so a forgotten surface fails `node run-all-tests.mjs` instead of waiting to be noticed in a browser.

8. **Create `<game>/CLAUDE.md`** — the game's own documentation, auto-loaded only when a session
   works inside that folder. Open it with the THE-LAW pointer block (copy it from any existing
   game file), then: hub integration (module/href, immersive or not, which `isInProgress()`
   meaning it uses and why), layout/responsibilities, key design decisions, correctness-critical
   engine notes, settings/persistence keys, tests. `escoba/CLAUDE.md` is the reference for depth
   and structure. Game-specific detail goes HERE, not in the root file — the root games table gets
   one row (integration, prefix, settings key, recorder) and nothing else.
9. **Create `<game>/js/strings.js` and route every user-visible string through `t()`** — the hub
   is bilingual (English/Spanish, `js/i18n.js`, preference in `gamehub.lang.v1`). Export
   `{ en: {...}, es: {...} }` (English is the source of truth; a missing Spanish key falls back
   to English, so partial translation never breaks), build `const t = makeT(STRINGS)` in ui.js,
   and call `t()` at RENDER time — never at module scope. Include aria-labels. Language changes
   apply to newly rendered UI; live re-render via `onLangChange` is optional (unsubscribe in
   `destroy()`). `snake/js/strings.js` + `snake/js/ui.js` are the reference implementation; the
   full mechanism doc is in `js/CLAUDE.md` ("Language support").
10. **Run `node test-game-conventions.mjs`, then `node run-all-tests.mjs`.** The first is the
    machine-checkable half of the "USE WHAT EXISTS" table above and of this checklist — it will tell
    you, by name and with the fix, if the game hand-rolls something shared, leaks a listener, leaves
    an overlay uncontained, ships an ungated standalone page, misses an export, or has no
    `CLAUDE.md`. It discovers game folders from disk, so your new game is checked automatically.
    **If it fails, fix the game — do not add the game to its `KNOWN_GAPS` list.** That list is for
    pre-existing debt only, and a brand-new entry there is a shortcut, not an exception.

## The games

One line per game; each game's full documentation lives in `<game>/CLAUDE.md` (auto-loaded when
working in that folder).

| Game | Integration | CSS root / prefix | Settings key | Stats recorder |
|---|---|---|---|---|
| Ball Run | in-hub `module:`, immersive | `.br-root` / `.br-` | `ballrun.*` (frozen gen-1 dotted keys) | `recordBallRun` |
| Battleship | in-hub `module:`, immersive, **multiplayer** (`gamehub.battleship.mp.v1`, the repo's first hidden-information game) | `.bs-root` / `.bs-` | `gamehub.battleship.v1` | `recordBattleship` |
| Boggle | in-hub `module:`, **multiplayer** (`gamehub.boggle.mp.v1`) | `.bg-root` / `.bg-` | `gamehub.boggle.v1` | `recordBoggle` |
| Chinchón | in-hub `module:` | `.cc-root` / `.cc-` (many rules still bare-prefixed) | `chinchon-settings` (frozen gen-1) | `recordChinchon` |
| Connect Four | in-hub `module:` | `.cf-root` / `.cf-` (many rules still bare-prefixed) | none (persists nothing — see its file) | `recordConnect4` |
| Dominoes | in-hub `module:` | `.dm-root` / `.dm-` | `gamehub.dominoes.v1` | `recordDominoes` |
| Dots and Boxes | in-hub `module:`, **multiplayer** (`gamehub.dotsboxes.mp.v1`) | `.db-root` / `.db-` | `gamehub.dotsboxes.v1` | `recordDotsBoxes` |
| Escoba | in-hub `module:`, immersive | `.eb-root` / `.eb-` | `escoba-settings` (frozen gen-1) | `recordEscoba` |
| Filler | in-hub `module:`, **multiplayer** (`gamehub.filler.mp.v1`) | `.filler` / `.fl-` (pre-convention root class, frozen) | `gamehub.filler.v1` | `recordResult('filler', …)` |
| Hill Climb | in-hub `module:`, immersive | `.hc-root` / `.hc-` | `gamehub.hillclimb.v1` | `recordHillClimb` |
| Mancala | in-hub `module:`, immersive, **multiplayer** (`gamehub.mancala.mp.v1`) | `.mancala` / `.mc-` (pre-convention root class, frozen) | `gamehub.mancala.v1` | `recordResult('mancala', …)` |
| Monopoly Deal | launch-out `href:` (in-repo `business-deal/`, own nested SW) | n/a (own page) | its own keys | `window.__ghStats` → `'business'` |
| Nuts & Bolts | in-hub `module:` | `.nb-root` / `.nb-` | `gamehub.nutsbolts.v1` | `recordNutsBolts` |
| Pool | in-hub `module:`, immersive, **multiplayer** (`gamehub.poolv2.mp.v1`) | `.p2-root` / `.p2-` | `gamehub.poolv2.v1` (frozen; see its file) | `recordResult('pool', …)` |
| Parchís | launch-out `href:` (built from sibling `../Parchís/`) | n/a (own page) | `parchis_r2_prefs` | `window.__ghStats` → `'parchis'` |
| Snake | in-hub `module:` | `.sn-root` / `.sn-` | `gamehub.snake.v1` | `recordSnake` |
| Tic Tac Toe | in-hub `module:`, **multiplayer** (`gamehub.tictactoe.mp.v1`) | `.ttt-root` / `.ttt-` | `gamehub.tictactoe.v1` | `recordTicTacToe` |
| Uno | in-hub `module:` | `.un-root` / `.un-` | `gamehub.uno.v1` | `recordResult('uno', …)` |
| Yahtzee | in-hub `module:`, immersive, **multiplayer** (`js/net.js`, no persisted MP save key) | `.yz-root` / `.yz-` | none yet (no persisted settings) | `recordYahtzee` |

The root-class/prefix cells were verified against each game's actual CSS on 2026-07-23 (note
Tic Tac Toe is `.ttt-`, three letters, and Filler/Mancala use pre-convention full-word root
classes — real facts, not typos). Bare-rule counts, for context: Chinchón 246, Escoba 219,
Connect Four 99, Filler 68 top-level prefixed rules alongside whatever root class each has —
which is why the axis table's "a prefix alone is not isolation" warning names the worst of them.
If a later redesign adds or renames a root class, the table follows the code.

## The shared profile

A **user profile** (`profile/index.html`, backed by `js/profile-store.js`) stores a name, emoji,
preferred color, up to 3 computer opponents (name, emoji, skill 1-3), and a short free-text message
shown on that player's own Leaderboard detail screen, in
`localStorage["gamehub.profile"]`. It is **defaults-only**: every game prefills from it, and every value
stays editable in that game's own setup. A pill in the hub top bar links to the page ("Set up your
profile", or "👤 Name" once set).

Contract, `profile-store.js` API, Monopoly Deal's must-stay-synced duplicates, and the
per-game consumption rules all live in `js/CLAUDE.md`. The load-bearing rules, in brief: the
profile is DEFAULTS-ONLY — every game prefills from it, each game's own saved settings beat it,
and games never write it back (the profile page is the primary writer, plus `js/hub.js`'s
first-run gate). Extend the shape additively, never rename fields. Readers try/catch and treat
missing or malformed data as "no profile"; a profile must never crash a game.
### Accessibility + copy conventions

- **Colorblind-safe** (Matt is red/green colorblind): wherever color is a choice, pair each hue with a
  shape marker, never hue alone. Palette: yellow `#F2B705` circle, blue `#1F5FA8` triangle, vermilion
  `#E0532F` square, teal `#178A7A` diamond.
- **No em dashes** in user-facing game or profile copy (use commas, colons, or parentheses).
- **any "you win / you lose" popup gets a close (X) in its top-right corner**, so it can be dismissed without forcing a rematch. ---
