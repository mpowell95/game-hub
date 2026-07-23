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

The game is called **Monopoly Deal**. Every user-visible string says "Monopoly Deal":
hub card title, page title, PWA manifest name/short_name, iOS home-screen title,
watermark, setup dialog, in-game menus, My Stats label, leaderboard label.

The folder is `business-deal/` and several internal identifiers use `business` / `bd`.
**This is intentional and must never be "fixed."** A directory name is not a display
name. These identifiers are load-bearing:

- `business-deal/` is the live URL path. Renaming it breaks every installed PWA on
  every family device (PWA scope and start_url are path-based) and every bookmark.
- The stats game id `'business'` is the key inside every player's `gamehub.stats` and
  inside Firebase RTDB at `players/<deviceId>/games/business`. Renaming it orphans
  every Monopoly Deal record anyone has ever accumulated. THE LAW #1.
- `bd-stats` is folded in ONCE by foldLegacy. Rename it and the old data can never be
  recovered.
- `gamehub.bd.pendingStats.v1` is the offline retry queue. Rename it and queued plays
  are stranded on players' devices permanently.

If a future audit or review calls the folder-name/display-name split "contradictory,"
that review is mistaken. It is not a contradiction and requires no action.
Do not rename the game to "Business Deal." Do not rename the folder. Do not rename
the stats ids. This is closed.

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

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
the new service worker's install failed** — almost always because `cache.addAll()` hit one
`ASSETS` entry that 404s (see `validate-sw-assets.mjs`), which is atomic: the whole install
aborts silently and the previous worker just keeps serving the old build offline, with no
other visible symptom. This is the tell to look for before suspecting anything else when a
deploy "didn't take." `RESTORE.md` and `validate-sw-assets.mjs` are the prevention/detection
pair for this failure mode.

## Architecture

```
index.html              hub shell host
js/hub.js               launcher grid + module mount/unmount  (the GAMES registry)
css/hub.css             shell chrome only
sw.js                   shared service worker (network-first, precaches every game)
manifest.webmanifest    one manifest for the whole hub
profile/index.html      the shared profile page (name, emoji, color, opponents)
<game>/                 one folder per game (connect-four/, chinchon/, parchis/)
```

The hub shows a grid of game cards. Tapping a **module** game dynamically imports its
entry and mounts it into a content area (no page reload); tapping a **launch-out** game
navigates to its own deployed URL.

### Shared modules (`js/`)

Everything below is imported by `hub.js` and/or the module games; a game's own `js/` files
never appear here. This table is the part the old architecture diagram omitted almost
entirely — keep it current when a module is added, split, or merged.

| Module | Role |
|---|---|
| `js/profile-store.js` | validated read/write of `gamehub.profile`; player-code helpers (`loadProfile`/`saveProfile`/`clearProfile`) |
| `js/favorites.js` | hub-only launcher favorites; `gamehub.favorites.v1`; ids are hub registry ids (`GAMES[].id`), never stats keys. Pure/DOM-free (`loadFavorites`/`isFavorite`/`toggleFavorite`); see "THE LAW does not govern favorites" below |
| `js/game-stats.js` | unified stats, keyed per PLAYER since 2026-07-23 (`statsKey()`/`statsId()`; see "Whose stats are these" — the device owner keeps `gamehub.stats`, anyone else gets `gamehub.stats.p.<CODE>`); one bespoke `recordX()` per game plus generic `recordResult`; a game with richer needs than played/won/lost carries its own sub-counter (`grid` Connect 4, `cc` Chinchón, `es` Escoba, `nb` Nuts & Bolts, `tt` Tic Tac Toe, `db` Dots and Boxes, `bg` Boggle) — `tt`/`db`/`bg` all track `tied` explicitly rather than deriving it (each game can genuinely draw/tie), and `db`/`bg` each carry Math.max-only (or longer-only) bests per THE LAW rule 2; legacy-store folds, the Ball Run metric migration, and the Monopoly Deal pending-stats drain (see "The shared profile" section) |
| `js/game-stats-global.js` | a non-ESM "classic" port of `game-stats.js`'s recorder, exposed as `window.__ghStats` for Monopoly Deal and Parchís — a second, parallel implementation of the stats-write path. **`business-deal/js/game-stats-global.js` is a byte-identical in-scope copy** (see "The shared profile" section for why) |
| `js/firebase-boot.js` | the ONE place that boots the named `'stats'` Firebase app + anonymous auth; `stats-net.js` and `net.js` both call `getStatsApp()` so there is only ever one init in flight, never a race between them |
| `js/stats-net.js` | Firebase mirror of profile+stats to `players/<deviceId>`; username reservation registry; `syncHealth()` (see "Sync health") |
| `js/players-agg.js` | pure identity-graph aggregation (code ∪ name union-find) of synced devices into per-person rows. **A game's sub-counter needs an explicit branch here or it is silently dropped** — see "Adding a game" item 7 |
| `js/game-stats-ui.js` | "My Stats" overlay; per-game tailored screens |
| `js/leaderboard-ui.js` | "Leaderboards" overlay; live `watchPlayers` subscription. DOM only — the ranking maths is in `leaderboard-rank.js`; read-only consumer of stored data |
| `js/leaderboard-rank.js` | pure, headless-testable ranking: draws-as-wins, difficulty-weighted Wilson rating, solo achievement scoring. See "The leaderboard's rating model" |
| `js/difficulty-tiers.js` | READ-path mapping of every game's difficulty vocabulary onto the shared 1-4 tier scale + weights. Deliberately separate from `normDiff()`, which is on the write path |
| `js/net.js` | multiplayer room layer (`rooms/<CODE>`, lockstep move log, heartbeat, recovery, SW-version match on join) used by Chinchón and Escoba |
| `js/a2hs.js` | add-to-home-screen bottom sheet; polls hub DOM state to avoid overlay collisions |
| `js/device-report.js` | (2026-07-22) the profile page's "Device details" diagnostic: `gatherDeviceReport()` reads every localStorage key this app has ever written (both by name - profile, stats, every game's own settings/saves/legacy stats - and exhaustively, a raw `{key, bytes}` dump of literally everything in `localStorage` so nothing is invisible to the page) plus two Firebase reads (`usernames/<name>` and `players/<deviceId>`) that catch a mixed-up profile immediately (registered owner disagrees with this device, or local/remote stats disagree). `uploadDeviceReport()` pushes the whole thing to its own new node, `deviceReports/<deviceId>/<pushId>` - see "The shared profile" for why this exists and why it deliberately excludes `js/challenge/` state |
| `js/challenge/` | retired gift/challenge system (~10 modules + assets). Still load-bearing: `hub.js` and `game-stats-ui.js` import `isDevProfile`/`isChallengeActive`/`isAdmin` from `js/challenge/hooks.js` on every load, and `isDevProfile` (the gate for unreleased `devOnly` games) is built on the challenge's `secrets.js` hash list. Deleting this directory would break the hub shell. |

Firebase layer: one project (`js/firebase-config.js`), anonymous auth, RTDB rules
`auth != null` (known-intentional, effectively open since anyone can sign in anonymously).
Two client layers now share one bootstrap (`js/firebase-boot.js`, named app `'stats'`):
`stats-net.js` and `net.js`. `js/challenge/challenge-net.js` boots Firebase's separate
DEFAULT (unnamed) app and is untouched by the shared bootstrap — it was never part of the
init race that motivated it. Node ownership is disciplined by convention: stats-net touches
`players/` + `usernames/`, net.js touches `rooms/` only, challenge-net touches its own
nodes, device-report.js touches `deviceReports/` only (read of the first two, write of
the third). Nothing enforces this but comments.

---

<!-- BEGIN THE LAW, repeated verbatim (copy 2 of 10). Generated by repeat-the-law.mjs - deliberate, do not consolidate, do not hand-edit. -->

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

<!-- END THE LAW (copy 2 of 10) -->

---

### Multiplayer lockstep — invariants (M1/M2b, hardened July 2026)

Chinchón and Escoba share one lockstep protocol over `js/net.js` (`rooms/<CODE>`: a
seq-keyed move log, per-round `round` records, a `recovery` field). Both engines apply
the same decision stream and verify a FNV-1a state hash (`<game>/js/hash.js`) after
every applied remote move; the host is authoritative for desync recovery. Five
invariants below each encode a real bug found and fixed by `test-mp-lockstep.mjs`
(its [KNOWN-BUG PROBE] assertions are the regression tripwires — if one goes red, one
of these came back):

1. **Decide the match end BEFORE emitting `roundScored`.** Chinchón's engine announces
   it as `payload.matchOver`; every MP gate keys on that field, never on
   `this.game.winner` (null at that moment for points/rounds endings — gating on it
   deadlocked the guest at every normal match end and silently skipped its stats
   recording). Escoba's engine sets `winner` before emitting, so its `!winner` gate is
   equivalent. Any new event-hook gate about "does the match continue" must use the
   engine's pre-emit decision.
2. **Transmitted snapshots carry device-RELATIVE `isHuman` flags.** A snapshot's flags
   are the SENDER's perspective. Any receiver rebuilding from one (`_mpApplyRecovery`
   in both ui.js files) must remap agents by SEAT (host = id 0, guest = id 1, fixed at
   match start) and normalize the flags to itself. Trusting transmitted flags handed
   the guest's human agent to the host's seat, which made recovery — the safety net
   under everything else — unable to land.
3. **`config.presetStockResets` is a shift()-consumed queue** (Chinchón only), never an
   array indexed by the per-round `resetsUsed` counter; `_mpAwaitStockReset` proceeds
   when ANY entry is queued. Index-based consumption replayed round 1's shuffle order
   at round 2's first reset.
4. **Autosave AFTER the MP bookkeeping for the same event.** Escoba's `'play'` hook
   runs `_mpAfterPlay` (which advances `appliedSeq`) before `_saveSnapshot`, so the
   save's `mp.seq` matches the play already inside its snapshot. Saving first put the
   seq one low and every rejoin re-applied a move it already had.
5. **A round-boundary snapshot (`midRound:false`) resumes with the NEXT round, scores
   kept.** Chinchón's engine takes the `_resumeNextRound` branch in `playMatch()`
   (never `initMatch()`, which zeroes every score — a THE-LAW-class loss when both
   devices restored at once), and a restoring/recovering GUEST awaits the host's
   published round record (`_mpAwaitNextRound`) before playing, in both games — the
   next round's deck must come from the host, not a stale `presetDeck` or a local
   shuffle.

### Dev tooling (repo root, not deployed)

| Script | Role |
|---|---|
| `server.mjs` | local dev server (ES modules/SW need real HTTP, not `file://`) |
| `validate-sw-assets.mjs` | fails if any `sw.js` `ASSETS` entry is missing on disk; warns about deployed files not in the list. Run before every deploy. |
| `players-agg.test.mjs` | headless unit tests for `js/players-agg.js` |
| `test-leaderboard-rank.mjs` | headless unit tests for the leaderboard rating model, incl. a LAW rule 1 block replaying the OLD visibility gate against the new one (nobody may fall off the board or lose plays) |
| `test-recorder-contract.mjs` | contract test: `js/game-stats-global.js` vs `js/game-stats.js` on their shared surface, incl. the fold-once interop and the BD in-scope copy sync |
| `test-stats-replay.mjs` | LAW rule 7, runnable: real historical `gamehub.stats` shapes (written by the actual old writers) loaded with current code, checked against the real UI visibility gates |
| `test-stats-identity.mjs` | (2026-07-23) the per-player store split (see "Whose stats are these"): proves an existing device is completely undisturbed, that a second player on the same phone cannot blend into the first, that the device-wide legacy stores never fold into a forked store, and that the ES-module and global recorders resolve the same key. Rule 7 fixture is the real store from the device the Ana/Natalia incident happened on |
| `test-mp-lockstep.mjs` | headless two-engine MP lockstep for Chinchón + Escoba over a fake room; mirrors the ui.js MP glue with per-method citations — update the mirror when the glue changes. Its [KNOWN-BUG PROBE] assertions are regression tripwires for the five fixed MP defects (see "Multiplayer lockstep — invariants") |
| `run-all-tests.mjs` | runs every node suite above plus the per-game engine tests, exit-code aggregated. All green expected. Run before every deploy. |
| `read-device-reports.mjs` | (2026-07-22) Matt-only: fetches "Device details" reports (see `js/device-report.js`) from `deviceReports/` via the plain RTDB REST API (anonymous sign-in via the Identity Toolkit REST endpoint, no SDK/dependency) - `node read-device-reports.mjs [deviceId] [--raw]` |
| `backups/rtdb-backup.mjs` | (2026-07-23) **Run this before ANY script that writes to Firebase, any rules change, any schema change.** Timestamped full-DB snapshot to `backups/rtdb-<ISO>.json` via the same no-dependency REST pattern; `node backups/rtdb-backup.mjs [path]`. Also exports `signInAnonymously`/`readPath`/`totalPlays` for other tools. Restoring is deliberately NOT automated - a restore is a destructive write and must be hand-driven. **The snapshots are gitignored** (`backups/*.json`): this is a public repo and they hold every player's real name, code and stats. |
| `repeat-the-law.mjs` | (2026-07-23) Regenerates the repeated copies of THE LAW through `CLAUDE.md` (Matt's instruction: in full, verbatim, roughly every 10% of the file - which means 10 copies, the canonical one plus 9). Idempotent: strips the old copies and re-inserts from the canonical block, so re-run it with `--write` after adding a section and the spacing re-evens itself. **Edit the canonical block at the top of the file, never a copy.** |
| `fix-natalia-record.mjs` | (2026-07-23) The one-off Ana/Natalia leaderboard correction, kept for audit. Dry run by default, `--write` to apply; it backs up first, simulates the post-write leaderboard with the repo's real `players-agg.js`/`leaderboard-rank.js` and aborts if any other player's row would move, then verifies by fresh re-read and diffs every pre-existing device record. **Already applied; re-running is a no-op (it refuses to create a second Natalia).** |

### The module contract

A game module's entry (`<game>/js/ui.js`) exports exactly three functions, plus a default
object bundling them. All seven in-hub module games (Connect Four, Chinchón, Escoba, Filler,
Mancala, Nuts & Bolts, Ball Run) export all three; grep-verify before assuming otherwise:

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
- `isInProgress()` gates the hub's "leave game?" confirm (`hub.js` calls it before
  navigating back to the launcher) and has **two legitimate meanings** depending on whether
  the game can resume:
  - **No mid-game resume** (Connect Four, Filler, Nuts & Bolts, Ball Run): returns `true`
    while a game/run is actually in progress, `false` otherwise. The literal meaning.
  - **Autosave/resume built in** (Escoba, Mancala): returns `false` for solo play even
    mid-game, because leaving is lossless — the engine snapshots after every state-changing
    event and picks up where it left off on return (`escoba-save`, `gamehub.mancala.game.v1`).
    Escoba's MP path is the exception within the exception: `isInProgress()` returns `true`
    only while an active multiplayer match is live (leaving mid-MP genuinely abandons the
    room), so one function answers two different questions depending on solo-vs-MP context.
  When adding a game, decide up front which meaning applies and say so in a comment next to
  `isInProgress()` — don't leave the next session to guess from behavior alone.
- An `immersive: true` entry in `hub.js`'s `GAMES` array (currently Escoba, Mancala, Ball Run)
  collapses the hub's header to a floating back button for games with their own full-bleed
  chrome. It's a de facto fourth registry flag, same status as `module`/`href`/`devOnly` —
  set it when a game wants to own the whole viewport.

---

<!-- BEGIN THE LAW, repeated verbatim (copy 3 of 10). Generated by repeat-the-law.mjs - deliberate, do not consolidate, do not hand-edit. -->

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

<!-- END THE LAW (copy 3 of 10) -->

---

### Adding a game — checklist

**Copy per axis, not per game. No single game is the reference for everything** — an earlier
version of this paragraph named Escoba for all three axes below, and was wrong on two of them.

| Axis | Reference | Notes |
|---|---|---|
| Setup screen | **Escoba** (Chinchón mirrors it) | the accordion, one row open at a time. Filler's flat/segmented screen is acceptable for a small game. Connect Four's is the weakest in the repo; do not copy it. |
| CSS scoping | **Mancala** | every rule descendant-scoped under its root class (`.mc-root .mc-x`, never bare `.mc-x`). Escoba, Filler and Connect Four all carry large numbers of bare top-level prefixed rules — a prefix alone is not isolation. |
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
7. **If the game stores a per-game sub-counter** (`grid`/`cc`/`es`/`nb`/`br`/`tt`/`db`/`bg` —
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
   add one for any new sub-counter.

---

<!-- BEGIN THE LAW, repeated verbatim (copy 4 of 10). Generated by repeat-the-law.mjs - deliberate, do not consolidate, do not hand-edit. -->

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

<!-- END THE LAW (copy 4 of 10) -->

---

## The games

| Game | Integration | Notes |
|---|---|---|
| Connect Four | in-hub `module:` | AI in a Web Worker (`new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`) with a main-thread fallback; needs the worker for its multi-second Expert solver. `ui.js`'s `_statsDisqualified` flag (2026-07-22): set by a confirmed undo or by confirming "Show best moves" (one shared flag, reset per game in `startGame()` - a rematch that starts with hints still on from before is pre-disqualified, silently, no re-prompt); `recordConnect4` is skipped entirely for a disqualified game and the result banner says so. The exact solver (`expertSolve`/`chooseExpert`, bitboard negamax + transposition table) has always been correct on its own (`test.js`'s "expert value matches reference" suite); what WAS a real bug (2026-07-22, batch 10) was `evaluateColumns`' "Estimate" fallback for the hint panel - it burned half its budget on a Pass 1 exact-solve attempt that's hopeless below `MIN_STONES_FOR_EXACT_ATTEMPT` (12 stones, measured empirically), starving the heuristic fallback of the depth it needed, so the empty board read as losing on every column. Fixed by skipping that doomed attempt early and replacing the fallback with a bitboard depth-limited negamax (`evaluateColumnsBounded`/`negamaxBounded`, reusing the exact solver's own move-ordering/win-detection primitives plus a bitboard port of the window-scoring heuristic) - reaches roughly 3-6x the depth in the same wall-clock time, so the empty board now reads center-highest and positive within the existing 3s hint budget. Also backs Expert's opening-fallback move choice (`chooseSearchTimed`), replacing a separate, weaker Board-object search there too. Still labeled "Estimate (depth N)", never "Solved", unless the value is actually exact. Discs also carry a shape token per THE LAW rule 9 (`.cf-piece.p1`/`.p2::after`, batch 10): P1 a ring, P2 a diamond, tonal (a darker shade of the disc's own color) rather than a second competing hue. |
| Chinchón | in-hub `module:` | Spanish rummy vs AI. No worker (light heuristic AI). See below. |
| Monopoly Deal | launch-out `href:` | Full-screen PWA that lives **in this repo** (`business-deal/`), launched like Parchís; `window.*` globals + its own nested service worker, not ESM. A precedent, not the preferred pattern. The standalone "Just Say No?" prompt (2026-07-22) is now bypassed for the case that has a known cash amount (rent/Debt Collector/Birthday) and the human is the one who'd pay: `HumanAgent.respondToAction` routes that case through `promptPayment(view, ctx, {jsn:true})` instead, adding Just Say No as one more choice alongside Pay/Clear on the normal pay screen (bank + properties + amount already visible). Declining it caches the chosen payment (keyed by creditorId+amount+reason) so the immediately-following `choosePayment()` call reuses it rather than prompting twice - the cache is only ever set for a real (>=1 card) payment, since `_charge()`'s `required<=0` early return never calls `choosePayment` for a "nothing to pay" case and would otherwise leave a stale entry. The property-steal actions (Sly Deal/Forced Deal/Deal Breaker, no cash amount) and the "counter their cancellation of YOUR action" attacker-side case still use the original standalone prompt. |
| Parchís | launch-out `href:` | Spanish Parchís vs AI. Single-file build from the sibling `../Parchís/` project (`node recombine.mjs` → `parchis/index.html`). See below. |
| Escoba | in-hub `module:` | Spanish fishing card game (capture cards summing to 15) vs AI, 2-3 players, Fournier rules. Engine mirrors Chinchón's async agent pattern (`escoba/js/game.js` + `ai.js`, no DOM; `ui.js` owns the DOM). Card faces reuse the shared Anita deck from `chinchon/decks/anita/` (no deck picker, no copied assets). Two numbering modes, same math either way (one card of each value 1-10 per suit): `spanish` (default: 1-7 + figures counting 8/9/10) and `american` (ranks 1-9 + Sota, values as printed, no Caballo/Rey; only sticks when explicitly chosen, via `deckModeChosen`). Settings in `escoba-settings`; results recorded via `recordEscoba` in `js/game-stats.js`. Resumable: the engine snapshots after every state-changing event (`Game.snapshot()`/`Game.fromSnapshot()`, `escoba-save` in localStorage) so navigating away mid-match and coming back later (or a killed tab) picks up where it left off; `isInProgress()` returns false to the hub for this reason (leaving never loses progress), while the in-game menu's own "Quit to setup" is a separate, explicit abandon that clears the save. Its own top bar chrome is `immersive: true` in `GAMES` (hub.js), collapsing the shared hub header to a floating back button. |
| Mancala | in-hub `module:` | Kalah rules vs AI (3 tiers; Pro = iterative-deepening alpha-beta under a ~380ms budget) or pass-and-play. Pure engine (`mancala/js/game.js`) + `ai.js` + `ui.js`; stones are persistent DOM elements sown pit-to-pit with WAAPI arc flights (timeout-raced so a hidden tab never stalls a move; `?motion=1/0` overrides reduced-motion). Settings in `gamehub.mancala.v1`; results via `recordResult('mancala', ...)`. Reference screenshots in `mancala/reference/` (gitignored). |
| Filler | in-hub `module:` | Flood-fill duel vs AI (color-pick your corner, grow to capture the majority). Pure engine (`filler/js/game.js`) + `ai.js` + `ui.js`, no worker. Settings in `gamehub.filler.v1` (the gen-3 key convention); results via `recordResult('filler', ...)`. Still on the old flat/segmented setup screen, not the accordion pattern. `ai.js`'s `pro()` tier (2026-07-22) restricts candidates to the max-immediate-capture-gain colors first, breaking ties with the deep-lookahead value - it used to weigh a "small frontier bonus" across the WHOLE option set, which could (and, ~59% of pro-vs-pro seeded games, did) outscore an actually-available capture, including the specific color that would close the board, causing the AI to stall forever until the dry-move guard force-ended the game unfilled. `game.js`'s `generateColors()` also runs a post-generation `debiasNeighborPair` pass on both starting corners: a corner's two neighbor tiles aren't adjacent to each other, so nothing previously stopped them from coincidentally sharing a color and letting one first move capture both (~24% of boards, symmetric, before the fix). |
| Nuts & Bolts | in-hub `module:` | Solo color-sort puzzle: stack matching nuts onto bolts. Procedural level generator (`nuts-bolts/js/generator.js`) with a solvability + quality-gate self-test (regenerates a level rather than shipping an unsolvable or trivial one). Settings/progress in `gamehub.nutsbolts.v1` (schema-versioned, with its own migration). A solo puzzle has no opponent/loss state, so results record via `recordNutsBolts` (solved/moves/bestLevel), not `recordResult`. `ui.js`'s `fitToViewport()` (2026-07-22, phone widths only): the nb-size-l/m/s tier was chosen purely by bolt count with no regard for whether it actually fit a short phone; now measures `document.documentElement.scrollHeight` vs `window.innerHeight` (the same black-box technique this file already documents for Escoba's own viewport budget) and steps down a tier, then falls back to continuously scaling the same custom properties (down to a 0.6 floor) for boards too big even at the smallest tier. Chinchón (below) does the analogous thing with its own hand-row layout. |
| Ball Run | in-hub `module:` | Solo endless runner: steer a rolling ball down a neon track, dodge obstacles. Three.js/WebGL renderer (`render.js`, vendored `ball-run/vendor/three.module.min.js`), fixed-timestep sim (`sim.js`/`track.js`) decoupled from rendering, `input.js` for touch/drag steering. `immersive: true`. Settings under the older dotted `ballrun.*` keys (predates the `gamehub.<game>.v1` convention; frozen per THE LAW). Results recorded via `recordBallRun` (obstacle-count score, not distance — see `js/game-stats.js`'s header comment for the metric-migration history) through a local "flight recorder" (`ballrun.runLog.v1`) that retries any run that didn't confirm reaching the shared store, on every subsequent open. Renderer teardown calls `forceContextLoss()` after `dispose()` so repeated hub↔game remounts don't leak WebGL contexts toward the browser's context cap. `Renderer.dispose(loseContext = true)` and `BallRunUI.teardownRun(fullExit = false)` (2026-07-22): only the hub's real unmount forces context loss - an in-place restart (Play, Play Again, back-to-setup) passes `false` and reuses the live context, since forcing loss on a context about to be reused for a `new Renderer(canvas)` left it permanently lost (the black screen on "Play Again"). |
| Tic Tac Toe | in-hub `module:` | Two variants, one segmented control in setup: **Classic** (3x3) and **Ultimate** (nine 3x3 boards nested in a 3x3 meta-board; the cell you play picks which board your opponent plays next, a resolved target board grants a free move, and a small board that fills with no winner is DEAD — counts for neither side, never playable again). Pure engine (`tic-tac-toe/js/game.js`) + `ai.js`, no DOM, same synchronous shape as Filler/Mancala (no async agent interface — a move has no multi-step resolution to pace). Three shared-vocabulary tiers (beginner/intermediate/pro) per variant: Classic Pro is **exhaustive minimax, unbeatable by design** (a perfect opponent can only draw it — intentional, not a bug); Ultimate Pro is iterative-deepening alpha-beta under a ~380ms budget (Mancala's Pro tier is the precedent for that number), with a 4-term eval (positional small-board ownership, meta-line potential, in-board two-in-a-row, and a heavily-weighted "send penalty" for handing the opponent a good board or a free move — the term that makes it play like Ultimate instead of nine unrelated games). Setup screen is Escoba's accordion pattern. Settings in `gamehub.tictactoe.v1`. Results via `recordTicTacToe(variant, difficulty, won)`: maintains the shared `total`/`byDiff` bucket (draws derived, like every other game) AND an explicit per-variant `tt.classic`/`tt.ultimate` `{played,won,lost,tied}` breakdown — `tied` is stored explicitly there (not derived) because this game is draw-heavy, especially Classic vs Pro; the Stats tab shows all six W/L/T numbers, never folded away. |
| Dots and Boxes | in-hub `module:` | Draw an edge on a lattice of dots; complete a box's 4th side to claim it and go again, so one turn can chain-capture many boxes. Three board sizes, a setting independent of difficulty: Small (3x3 boxes), Medium (4x4, the only size where an even box count makes a tie possible), Large (5x5). Pure engine (`dots-boxes/js/game.js`, edges as `{type:'h'\|'v', r, c}`) + `ai.js`, no DOM, same synchronous shape as Filler/Mancala/Tic Tac Toe. Three shared-vocabulary tiers: Beginner takes any free box then plays randomly; Intermediate takes every free box and prefers safe moves, opening the shortest chain when forced, but never sacrifices; **Pro adds the double-cross** (`ai.js`'s `pickCaptureOrDoubleCross`) — when eating a chain/loop, it takes all but the last 2 boxes (last 4 of a loop) and plays the "hard-hearted handout" instead, trading a small sacrifice for forcing the opponent to open the next chain, UNLESS taking everything already wins the game outright on box count or it's the last region left on the board. Pro also solves the endgame exactly via alpha-beta once ≤14 edges remain (a deadline-guarded search, falling back to the heuristic on abort). Board is CSS Grid with alternating dot/cell tracks, every edge a real `<button>` expanded past its thin dot-track to a genuine 44px tap target via a sized-then-negative-margined box (verified at 375px width for all three sizes, see `dots-boxes/css/dots-boxes.css`'s board-padding comment). Colorblind-safe: claimed boxes show the owner's emoji glyph, never color alone; a capturable box gets a dashed border pulse. Setup screen is Escoba's accordion pattern. Settings in `gamehub.dotsboxes.v1`. Results via `recordDotsBoxes(difficulty, won, extras)`: maintains the shared `total`/`byDiff` bucket AND a `db` breakdown (`{played,won,lost,tied,boxes,bestChain}`) — `tied` is explicit (Medium can end 8-8), `boxes` is the human's cumulative claimed-box count (additive), `bestChain` is their longest single-turn capture run ever (`Math.max` only). `isInProgress()` is the no-mid-game-resume meaning: even a Large match runs only a few minutes, so autosave wasn't worth the complexity. |
| Boggle | in-hub `module:` | Timed word search vs AI on a 4x4 grid shaken from the real 16 classic Boggle dice (`boggle/js/game.js`'s `DICE`, shuffled into position then one random face each; random-letter boards are frequently unplayable, so this repo does not generate one). **The solver is the AI, not a separate opponent**: one exhaustive DFS against the dictionary trie (`boggle/js/solver.js`) produces the scoring word list, the end-of-round reveal, AND the opponent all from a single algorithm — `boggle/js/ai.js` has no search of its own, it just samples a difficulty-scaled slice of the solver's own output (beginner ~20% biased toward short words, intermediate ~45% unbiased, pro ~70% biased toward long/high-scoring words), so every AI word is provably a genuine board find, never invented. Dictionary is the public-domain **ENABLE** word list, ~170k words (`boggle/data/words.txt` + `boggle/data/CREDITS.md`) — **the first game in this repo to ship a large non-image data asset**; like any code file it must be in `sw.js`'s `ASSETS` precache list or the game silently breaks offline, and any future word game following this pattern should precache its own word list the same way. Fetched once, lazily, on first game start, and parsed into a trie of nested `Map`s (deliberately not a `Set` of every prefix, which would duplicate ~170k strings many times over) cached in module scope so hub navigation never re-fetches or rebuilds it (`boggle/js/dict.js`). The `Qu` tile is a single tile worth two letters and must advance the trie by both in one board step — the classic Boggle solver bug is getting this wrong, and `boggle/js/test.js` asserts it directly (a board with the Qu tile must find "QUIT" and must never produce a malformed "QIT"). A round is a shared-board timed sprint (2/3/5 minute settings, not turn-based): both sides score independently against the same board with no duplicate cancellation (real Boggle cancels words both sides found; against a solver-backed opponent that would gut the human's score every round), higher total wins, and ties are real. **Input is swipe-to-trace** (drag through the letters without lifting, release to submit, slide back over the previous tile to undo a letter): tapping each letter then pressing a submit button was too slow to be worth playing against a clock (Matt, 2026-07-22). Tap-to-select is kept alongside it, not as a dead fallback but as the path that keeps the board usable by keyboard and screen reader, since every tile is still a real `<button>`. Three things make the swipe work and are easy to break: the board sets `touch-action: none` (without it a drag scrolls the page instead of spelling), tracing hit-tests against tile rects **cached at gesture start** rather than `elementFromPoint` (so backtracking still works over tiles that are `disabled` for being illegal next steps), and a drag patches the board in place via `_updateBoardVisuals()` instead of re-rendering (an `innerHTML` rebuild mid-drag destroys the element under the finger and breaks pointer capture). The synthetic `click` a browser fires after a tap is ignored by **timestamp**, never by a boolean flag: ending a trace can re-render the board, leaving that click aimed at a detached node the delegated handler never sees, which would strand a flag `true` and silently swallow the next keyboard activation. The tracing rules themselves live in `game.js`'s pure `pathAction()` so they unit-test with no DOM. **Boards are quality-gated** (`solver.js`'s `shakePlayableBoard`/`BOARD_QUALITY`, the same regenerate-rather-than-ship-a-bad-one idea as `nuts-bolts/js/generator.js`): the authentic dice are kept, but a shake is rejected and re-rolled if it falls under 60 findable words, 35 short words, or 4 vowels. Measured over 3000 real shakes, the rare letters are NOT over-represented (J/X/Q/Z/K each sit on exactly one face of one die, so ~60% of authentic boards carry one and that is correct) — the actual problem was vowel-starved boards with nothing findable, ~9% of shakes. Gating clears in 1.39 shakes on average (~0.8ms, a solve is ~0.6ms) and drops boards under 40 words from 7.4% to 0%. Settings in `gamehub.boggle.v1`. Results via `recordBoggle(difficulty, won, extras)`: maintains the shared `total`/`byDiff` bucket AND a `bg` breakdown (`{played,won,lost,tied,words,bestScore,longestWord}`) — `tied` is explicit (a round can genuinely tie), `words` is the human's cumulative found-word count (additive), `bestScore` is `Math.max` only, and `longestWord` (`{word,len}`) is replaced only when strictly longer, never by a shorter word even on a winning round. `isInProgress()` is the no-mid-game-resume meaning: a live 2-5 minute countdown cannot meaningfully pause across a hub navigation. |

---

## The leaderboard's rating model (2026-07-22)

The Leaderboards overlay ranks people by a single 0-100 **rating** instead of by absolute wins.
The maths lives in `js/leaderboard-rank.js` (pure, headless-testable) and the cross-game difficulty
mapping in `js/difficulty-tiers.js`; `js/leaderboard-ui.js` is DOM only.

**Everything here is a read-time DISPLAY TRANSFORM.** `gamehub.stats` and `players/<deviceId>` are
read-only to this feature — nothing is stored, migrated or normalized, so the whole model is
reversible by editing those two modules and nothing else. Every rule applies identically to every
player; there is no per-player special-casing anywhere in it.

- **A draw counts as a win**, for every player, in every game. Derived at render time as
  `wins = played - lost`, never stored. Rationale: against Tic Tac Toe's Classic Pro (unbeatable by
  design) a draw is the best achievable result. It also makes records *reconcile* — before this, a
  stored 2W/2L/10D record rendered as W-L `2-2` beside `14` plays and a `14%` win rate, three
  numbers that contradicted each other. Losses clamp to `played`, so W + L === Plays holds even for
  a malformed legacy record. Draws stay visible in their own right on **My Stats** (`tt`/`db`/`bg`
  show explicit W/L/T) — that is the surface satisfying THE LAW rule 1 for the raw breakdown.
- **Difficulty is weighted, never filtered.** `tierOf()` maps all four live vocabularies
  (`beginner/intermediate/pro`, `easy/medium/hard/expert`, `extrahard`, `facil/normal/dificil`) onto
  the profile's canonical 1-3 scale plus an optional tier 4 above Pro, weighted `0.8/1.0/1.25/1.5`.
  Unmapped buckets (`unknown`, `legacy`) count at weight 1.0 and are shown as "Unrated" — dropping
  them would be a rule 1 regression on exactly the data `foldLegacy` exists to preserve.
  **Do not change `normDiff`** — it is on the write path; this is a separate read-path mapping.
- **`competitiveRating` = `min(1, wilson(p, nRaw) · avgW)`.** Two distinct uses of the weight, and
  both are load-bearing: `p = Σ(wins·w)/Σ(played·w)` captures the player's own tier MIX and stays in
  [0,1]; `avgW = Σ(played·w)/Σ(played)` captures the difficulty they play AT. **Weighting numerator
  and denominator alone — the obvious formulation, and what the original spec said — cancels exactly
  for anyone who plays a single tier** (10-5 on Pro and 10-5 on Beginner both give p = 0.667), which
  would have made difficulty a silent no-op for the most common record shape. The `avgW` factor is
  what makes it count; `test-leaderboard-rank.mjs` pins this.
- Wilson's `n` is the RAW play count, never the weighted one: difficulty should move your *rate*,
  not fake your *sample size*. Under 5 rated plays is flagged `provisional` (shown, not hidden).
- **`soloRating` is achievement relative to the family**, because Ball Run and Nuts & Bolts have no
  loss axis (they record `played`+`won`, never `lost`) and so cannot feed a win-rate model — a
  Wilson score on zero losses trends to 1.0 with volume, which would let someone top the board by
  grinding. Scored against the field maximum, then passed through the SAME Wilson discount as the
  competitive side. **Known property, deliberately left as-is:** a relative ratio is 1.0 by
  definition for whoever holds the field max, and in a game only one person plays that is them at
  any sample size, so a solo leader still tends to outrank a mid competitive record. Wilson removes
  the worst of it (a 12-level Nuts & Bolts record scored a flat **100** before that, topping a
  22-match Chinchón record) but cannot discount a rate with no variance. If this reads wrong on the
  real family board, **the lever is a solo-axis multiplier in `soloRating()`**, not the tests.
- The two are blended **by play count**, so a mostly-competitive player's rating is mostly their
  competitive score and a solo-only player still gets a real, comparable number. `—` when unrated.
- **Everyone with any recorded play is listed.** The old board filtered `comp.played > 0`, which put
  Ball Run / Nuts & Bolts-only players on NO main screen at all — stored but invisible, rule 1.
  Their W-L cell shows a headline achievement (`Ball Run 61`) instead of a meaningless record.

UI conventions worth keeping: two fixed segments (Standings / Games), never the old plays-sorted tab
strip — it re-ordered itself between visits and anything past the fourth tab was undiscoverable.
Games are alphabetical by title, matching the launcher. `table-layout: fixed` with widths declared on
`thead th` (with fixed layout the FIRST row sets the columns — putting them on `tbody td` silently
leaves every column an equal share) plus `white-space: nowrap` is what stops `15-3` wrapping onto two
lines. Wide boards (Nuts & Bolts, Ball Run) get `is-wide` and scroll inside `.lb-tblwrap`, never the
page body. The difficulty-mix bar is one hue varying only in LIGHTNESS, with a text `aria-label` —
colorblind-safe, same rule as the rest of the repo.

---

<!-- BEGIN THE LAW, repeated verbatim (copy 5 of 10). Generated by repeat-the-law.mjs - deliberate, do not consolidate, do not hand-edit. -->

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

<!-- END THE LAW (copy 5 of 10) -->

---

### Sync health, and why a leaderboard absence is not proof of anything (2026-07-22)

A player asked where their game history had gone: they were not on the leaderboard. The leaderboard
was correct. Their data was intact on their own device and had **never reached Firebase at all**.

`syncMyStats()` ended in a bare `catch { return false; }`, and `hub.js`'s `_syncStats()` called it
without `await` inside another bare `catch {}`. So a device that could not mirror - offline, blocked
anonymous auth, private browsing, a rejected write - failed **silently, every time, forever**. Nothing
reported it: not the device, not the hub, not the leaderboard. The first signal anyone got was a
person asking why they were missing. That is THE LAW rule 6 violated in the single place it matters
most, and rule 1 as a consequence (history that reaches no screen reads as deleted).

Now, per rule 6's own reference pattern:

- **Every attempt is recorded locally** in `gamehub.syncHealth.v1`, readable via `syncHealth()`:
  `{ ok, lastOkAt, lastErrAt, lastErr, localPlays, remotePlays }`. A silently-failing device can be
  diagnosed **from that device** instead of by noticing a gap on someone else's board.
- **Every failure path logs loudly** (`console.error`) and names the cost: how many local plays are
  not mirrored, and that the history is still safe locally.
- **The write is verified by a fresh re-read.** A resolved promise is not proof the data landed; the
  check compares total plays that landed against total plays stored, and fails the sync if short.
- **Retry on reconnect.** `hub.js` syncs on load, tab-hide, return-to-launcher, and now the `online`
  event. `syncMyStats` mirrors the whole store every time, so any retry repairs a missed period.

**Diagnosing "my history is missing" (do this before suspecting the leaderboard):** on the player's
own device, open the hub and run `JSON.parse(localStorage['gamehub.syncHealth.v1'])`. `ok:false`, or
`localPlays` well above `remotePlays`, means the data is fine locally and the SYNC is the problem.
`gamehub.stats` is the source of truth and is never touched by any of this.

**Known gap, not yet fixed:** the leaderboard lists only players with a profile name
(`(g.name || '').trim()` in `leaderboard-ui.js`, predates the 2026-07-22 overhaul). Devices that
recorded plays without ever setting a profile name are mirrored to Firebase but appear on no screen -
16 plays across 9 devices as of 2026-07-22. That is stored-but-invisible, rule 1. Fixing it needs a
display identity for a nameless device, which is a product decision, not just a filter change.

### The Ana/Natalia correction (2026-07-23) — what was done, and how certain it actually is

Ana and Natalia shared one physical device (`players/1f75ff86-...`, code `89N3N`, "Anita Bonita")
for about a week before Natalia got her own phone. `js/game-stats.js` stores only running per-device
totals, so every play either of them made landed in the same counters and **there is no per-play log
to split them by.** Separately `usernames/natalia` held `{ code: "89N3N" }` — Ana's code — which is
why Natalia's brand-new phone answered "Taken. Use that code instead." the first time she tried to
claim her own name.

**Root cause of the stale registry entry** (verified in code, still unfixed): `js/hub.js`'s
first-run "fr-save" handler calls `claimUsername(name, code, '')` — a hardcoded empty *previous
name*, so the gate can register a new name but can never release the one it replaces.
`profile/index.html`'s rename flow passes the real previous name and releases correctly. The bug
only fires when a device's local profile is reset and then re-claimed through the hub's gate rather
than the profile page. `js/stats-net.js` already exports `adminReleaseUsername(name)` for exactly
this repair; nothing in the UI calls it.

**What was actually written** (`fix-natalia-record.mjs`, applied and verified):
`players/660e7098-85cf-4293-96ad-888dabc50773` = Natalia, player code **`C5PXN`**, holding 8 plays;
`usernames/natalia` repointed to `C5PXN`; the dev/test device `f8ad1b82-...` had `profile.name`
cleared so its 4 plays stop showing as a "test" row on the board (the old name is archived to
`profile.nameArchived`, **not** destroyed — a new, inert field, additive per rule 5).

**Ana was deliberately not touched.** An earlier version of this plan subtracted Natalia's share from
Ana's counters; Matt reversed it. So this was a pure ADDITION — no counter anywhere was decremented,
which is why rules 2 and 4 hold by construction and there was never a moment where a play existed
nowhere. **The accepted consequence: those 8 plays are now counted twice family-wide**, once inside
Ana's blended row and once in Natalia's. That is a known, deliberate tradeoff, not an error to
"fix" — and it is the strongest argument for the profile-code-keyed stats rework below.

**How certain the split is — do not overstate this.** Only two of the eight have real evidence:

| Attribution | Basis |
|---|---|
| Escoba 1 → Natalia | `escobaSettings.humanName: "Natalia"` and the in-progress `escobaSave` both name her (verified in that device's own Device Details report) |
| Chinchón 2 → Ana (left in place) | `chinchonSettings.humanName: "Ana"` in the same report |
| Boggle 1, Dots and Boxes 1, Filler 2, Mancala 1, Nuts & Bolts 1, Parchís 1 → Natalia | **No name tag exists.** Those games' settings keys carry no `humanName` field at all. Assigned by Matt's standing date rule (any play on that device between Natalia's 2026-07-18 username claim and the morning of 2026-07-22 is hers). **This is a policy decision, not a recovered fact.** |

Even the two "firm" tags are the *last configured* value for that game, not per-play provenance.
Two further gaps are known and unresolved, and any future work here must not paper over them:
**Ball Run 8** was left with Ana on timing alone, with no firmer evidence; and **Connect Four shows
zero plays ever** on every device tied to Ana despite the challenge system requiring real Connect
Four losses by design — most likely `connect-four/js/ui.js`'s `_statsDisqualified` flag excluded
them, which means **Ana's true lifetime total is higher than any counter can show.** Do not present
any total built on this ledger as complete.

**Prevention: done, same day.** See the next section — the store is now keyed by the active
profile's player code, and the `claimUsername(name, code, '')` release bug above is fixed.

---

<!-- BEGIN THE LAW, repeated verbatim (copy 6 of 10). Generated by repeat-the-law.mjs - deliberate, do not consolidate, do not hand-edit. -->

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

<!-- END THE LAW (copy 6 of 10) -->

---

### Whose stats are these — the per-player store split (2026-07-23)

The structural fix for the incident above. The full rationale lives in `js/game-stats.js`'s
"WHOSE stats these are" block; this is the summary and the rules a future session must not break.

**One rule makes the whole change free for every device that already exists:** the FIRST player code
ever seen on a device becomes its **owner** and keeps `gamehub.stats` and the `players/<deviceId>`
node, exactly as before. **Nothing is migrated, copied, moved or re-keyed.** There is no migration to
get wrong and no window where history is anywhere but where it already was, so THE LAW rules 1, 3 and
5 hold *by construction* rather than by careful handling — which, given rule 7's history in this repo,
was the whole point of choosing this shape over "copy the store into a new key".

| Concept | Where |
|---|---|
| `gamehub.stats` | unchanged: the OWNER's store on that device (and the only store on a device with no player code) |
| `gamehub.stats.p.<CODE>` | a second (third, …) player's own store on the same device |
| `gamehub.stats.owner.v1` | `{ code, name, at }` — who owns the device's original store. Claimed once, by the first code seen |
| `gamehub.stats.forks.v1` | append-only log of every additional player who has recorded here (`{code, at, prevKey, prevPlays}`). Diagnostic only; never pruned |
| `statsKey()` / `statsId()` | the resolved local key and the `players/<id>` sync node. `statsId()` is `deviceId()` for the owner, `<deviceId>-<CODE>` for anyone else |

- **No game's `recordX()` call site changed.** Every game already went through `loadStats()`/`persist()`,
  so the resolution happens entirely inside `game-stats.js`. Keep it that way: a game that reaches for
  a storage key directly re-opens exactly the hole this closed.
- **`deviceId()` is still the multiplayer identity** (`net.js` rooms, `recordHeadToHead` opponents) —
  that is genuinely per-device. Only the STATS node moved to `statsId()`. Callers updated:
  `stats-net.js`, `game-stats-ui.js`, `leaderboard-ui.js`, `device-report.js`.
- **The device-wide legacy stores (`chinchon-stats`, `bd-stats`) belong to the owner and are never
  folded into a forked store** — that would hand a second player the first player's history, the exact
  blending this prevents. `latchLegacyGuards`/`latchChinchonSeed` set the fold-once guards without
  folding. The legacy keys themselves are untouched (rule 5).
- **`js/game-stats-global.js` (and its byte-identical BD copy) resolves the same key**, read-only: it
  never claims ownership, because it is a secondary writer. When no owner is recorded it uses the
  device-wide store, which is what the ES-module recorder does at the moment it claims — so the two
  always agree. This is a fourth must-stay-synced point between the two recorders.
- **`js/hub.js`'s first-run gate** reuses the owner's code when the name typed matches the owner's own
  name (the same person setting up again after losing their profile — minting a new code would fork
  them from their own history) and mints a fresh one otherwise (a different name is a different
  person). It also now passes the real previous name to `claimUsername`.

**Known gap, stated honestly:** if the SAME person loses their profile and is issued a brand-new code
under a DIFFERENT name, they fork away from their own history. The old store is untouched on disk and
the old node untouched in Firebase, and `players-agg.js` unions devices by name as well as by code, so
My Stats and the leaderboard still show everything whenever the device is online; offline, the local
view would show only the new store. Closing it completely means asking the player who they are, which
is a product decision, not a storage one.

`test-stats-identity.mjs` is the regression suite, and its rule 7 fixture is the real, unedited store
read out of `players/1f75ff86-...` — the actual device the incident happened on.

### Head-to-head capture

`recordHeadToHead(gameId, opponent, won)` (`js/game-stats.js`) writes a new top-level
`h2h: { [gameId]: { [opponentDeviceId]: { name, w, l } } }` key. **Capture only — nothing displays
it yet, and that is deliberate.** The opponent's identity only exists while the multiplayer room is
live: Chinchón and Escoba both knew exactly who they had just played (`_mpNewState` accepted the
room participant as a parameter and then *discarded* it) and threw it away at match end, so every MP
match played before 2026-07-22 is permanently unrecoverable. Both now store it on `this.mp.opp`,
refresh it from the live room in `_mpOnRoomUpdate` (the restore/rejoin path starts with none), and
record it in `_commitStats`. New key, additive counters, no migration — rules 2 and 5 hold by
construction, and `stats-net.js` mirrors `gamehub.stats` wholesale so it syncs with no change.

---

## The shared profile

A **user profile** (`profile/index.html`, backed by `js/profile-store.js`) stores a name, emoji,
preferred color, and up to 3 computer opponents (name, emoji, skill 1-3) in
`localStorage["gamehub.profile"]`. It is **defaults-only**: every game prefills from it, and every value
stays editable in that game's own setup. A pill in the hub top bar links to the page ("Set up your
profile", or "👤 Name" once set).

### Contract (`localStorage["gamehub.profile"]`)

```js
{ version:1, name, emoji, preferredColor:"yellow"|"blue"|"red"|"green"|null,
  opponents:[{name, emoji, skill:1|2|3}], updatedAt }
```

- **The profile page is the primary writer; games stay read-only consumers.** One
  documented exception: `js/hub.js`'s first-run gate (name-or-code prompt) also calls
  `saveProfile()` to adopt a linked owner's name/emoji and mint/attach a `playerId` — this
  predates the "only the profile page writes it" wording in an earlier version of this file,
  which was simply stale. If you add another writer, update this line again rather than
  letting it drift back out of sync with the code.
- Readers **try/catch** and treat missing or malformed data as "no profile", falling back silently to
  built-in defaults. A profile must never crash a game.
- **Extend additively; never rename fields.** `skill` tolerates a future 4; the UI emits 1-3.

---

<!-- BEGIN THE LAW, repeated verbatim (copy 7 of 10). Generated by repeat-the-law.mjs - deliberate, do not consolidate, do not hand-edit. -->

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

<!-- END THE LAW (copy 7 of 10) -->

---

### `js/profile-store.js`

ES module: `loadProfile()` returns a validated object or `null`; `saveProfile(p)` normalizes and stamps
`version`/`updatedAt`; `clearProfile()` deletes the key. In-hub module games `import` it directly;
single-file or non-ESM games (Monopoly Deal, Parchís) inline the small read-only subset, kept in sync
with this contract.

### Monopoly Deal's must-stay-synced duplicates

Monopoly Deal is global-JS, not ESM (a deliberate, bounded exception — see its games-table
row), so it can't `import` the shared modules directly. It carries three small inlined/copied
pieces that must be kept in sync by hand whenever their canonical source changes:

1. **Profile reader** (`business-deal/js/ui.js`, near the top): a read-only subset of
   `profile-store.js`'s `normalize()`. Already known to have drifted — its emoji fallback is
   `'🧑'` vs the canonical `'🙂'`/`'🤖'`, and it slices 4 opponents vs the contract's 3. Not
   worth fixing retroactively (bounded, cosmetic), but don't let it drift further: if the
   profile contract's *shape* changes (new required field, renamed key), update this copy too.
2. **Challenge crypto mirror** (`business-deal/js/challenge-hook.js`): inlines the
   hash/obfuscate/deobfuscate logic and salts from the retired `js/challenge/{crypt,secrets}.js`,
   explicitly commented as mirroring that file byte-for-byte. Changing the trigger hash, salt,
   or code blob in one place without the other breaks Monopoly Deal's challenge hook silently.
3. **Stats recorder** (`business-deal/js/game-stats-global.js`): a byte-identical in-scope
   copy of `js/game-stats-global.js`. Since 2026-07-23 that file also resolves WHICH player's
   store to write (see "Whose stats are these"), so a drift here now risks landing one player's
   Monopoly Deal plays in another player's store, not just a stale counter. It has to be a *copy*, not a shared reference, because
   Monopoly Deal's page is exclusively controlled by its own nested service worker
   (`business-deal/sw.js`) — a request for anything outside `business-deal/` (like the
   original `../js/game-stats-global.js`) is still routed through BD's own SW's fetch
   handler, so it can only be reachable offline if it's also in BD's own cache list. If you
   change `js/game-stats-global.js`, copy the change into
   `business-deal/js/game-stats-global.js` too and bump `business-deal/sw.js`'s `CACHE`.

### Consuming it in a game

- Read once at setup-screen load. **Precedence:** a game's own saved last-used settings (e.g.
  `chinchon-settings`) beat the profile, which beats built-in defaults. Games never write it back.
- **Skill maps 1:1** (1 Beginner, 2 Intermediate, 3 Pro) onto each game's difficulty. Connect Four's 4th
  "Expert" solver is not a profile tier (it is still chosen in Connect Four's own setup).
- Use the profile name/emoji only where a game already shows player identity; do not add new avatar
  surfaces to games that lack them.
- Prefills today: **Connect Four** (difficulty plus "You"/opponent labels), **Chinchón** (human and
  opponent identity plus per-AI difficulty), **Monopoly Deal** (AI count, one global difficulty, human
  and opponent identity). **Parchís** wires up in its own R2-3 (see below).

### Accessibility + copy conventions

- **Colorblind-safe** (Matt is red/green colorblind): wherever color is a choice, pair each hue with a
  shape marker, never hue alone. Palette: yellow `#F2B705` circle, blue `#1F5FA8` triangle, vermilion
  `#E0532F` square, teal `#178A7A` diamond.
- **No em dashes** in user-facing game or profile copy (use commas, colons, or parentheses).

### How-to-play screens — the pattern (worked out on Tic Tac Toe, 2026-07-21)

Reference implementation: `tic-tac-toe/js/ui.js` (`openHelp()`).

**Explain only the one genuinely non-obvious mechanic.** Skip anything the player already
knows — do not re-explain basic rules of a game everyone grew up with. For Tic Tac Toe that
meant explaining only Ultimate's "your cell picks their board" rule and nothing else.

Structure, top to bottom:

1. **One short bold sentence** stating the goal or win condition.
2. **A small SVG diagram** illustrating the confusing mechanic directly. If you can show it,
   do not describe it in prose. (Tic Tac Toe's: nine board outlines, one showing its own
   mini-grid with a marked cell, and an arrow curving to the board that cell sends the
   opponent to.)
3. **A caption** under the diagram stating the rule in plain words.
4. **A concrete one-line example in "X = Y" format** (e.g. "Play top right box = Opponent
   plays top right board").
5. **Any remaining edge cases**, each as its own plain sentence. No bullets unless there are
   three or more.

Rules for the whole screen:

- **Every line of text must fit on a single row.** Do not guess a font-size. Measure the
  actual rendered width against the container's real available width, size down until it
  fits, then lock it with `white-space: nowrap`.
- **Spacing between elements must be explicit and deliberate** — one flex container with a
  fixed `gap`, or hard-coded margins. Never leave it to collapse naturally between two
  unrelated rules.
- **The diagram must carry its meaning through shape, outline, and arrows, never color
  alone** (colorblind-safe, same as the palette rule above).

Related: **any "you win / you lose" popup gets a close (X) in its top-right corner**, so it
can be dismissed without forcing a rematch.

---

---

<!-- BEGIN THE LAW, repeated verbatim (copy 8 of 10). Generated by repeat-the-law.mjs - deliberate, do not consolidate, do not hand-edit. -->

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

<!-- END THE LAW (copy 8 of 10) -->

---

## Chinchón (`chinchon/`)

Spanish rummy (Rummy/Gin family). Build runs/sets, keep your hand light, and **close**
when your leftover is small; lowest cumulative score wins. Built to the spec in
`../ChinChon/docs/chinchon-game-spec.md`. Cards use a real **Baraja Española** deck —
open, freely-licensed images (CC BY-SA 3.0), rendered from `cards.js`. See "Card decks".

### Layout & responsibilities

```
chinchon/js/deck.js   pure card data: SUITS, SUIT_META, cardValue, makeDeck, shuffle, rankLadder/rankOrderMap
chinchon/js/meld.js   PURE rules engine (no DOM/state/RNG): candidate melds + exact-cover partition + scoring
chinchon/js/game.js   async turn/round/match state machine + agent interface (no DOM)
chinchon/js/ai.js     synchronous heuristic AIAgent (blunder-rate tiers)
chinchon/js/ui.js     DOM, HumanAgent, render loop, modals, avatar picker, hub init/destroy contract
chinchon/js/cards.js  card-face renderer + deck registry (image decks); preload + joker fallback
chinchon/js/test.js   headless engine assertions (node) — not deployed/precached
chinchon/js/sim.js    headless all-AI match simulation (node) — not deployed/precached
chinchon/decks/<id>/  per-deck card-face images (WebP: <suit>-<rank>, back) + CREDITS.md
```

### Key design decisions

- **No Web Worker.** The AI is light heuristic evaluation over `meld.js` (sub-ms on a
  ≤8-card hand). `meld.js` and `game.js` are kept **pure and DOM-free** as a deliberate
  seam, so a future deep AI *could* move to a worker with no refactor.
- **Agent-driven engine.** The engine `await`s `player.agent.chooseDraw/chooseDiscard/
  decideClose(view)` uniformly — the AI resolves instantly; the human agent (in `ui.js`)
  resolves a promise on tap. Pacing (AI "thinking" delays, the end-of-round modal pause)
  lives only in the UI's awaited `game.onEvent(type, payload)` hook, never in the engine.
- **Config-driven from day one.** `DEFAULT_CONFIG` (in `game.js`) holds all ~11 rules.
  Pass 1 hardcodes defaults; Pass 2 just adds the settings UI that produces that object.

### UI notes (2026-07-22)

- **Per-opponent difficulty selector**: `_seg()`'s per-instance index (`data-i`) lives on the WRAPPING `.cc-segmented` div, not the button - the click handler must climb to it (`a.closest('.cc-segmented').dataset.i`, matching Escoba's own handler) rather than read `a.dataset.i` directly off the clicked button. Reading it directly (the bug, now fixed) always resolved to `NaN`, so the selection never actually changed and the highlight never moved.
- **End-game modal** (`_renderMatchModal`) has a `.cc-sheet-x` close button (mirrors Escoba's `.eb-sheet-x`) that just hides the modal and re-renders the board underneath - "New Game" is a separate, unrelated action.
- **Hand row split is player-controlled, not a fixed formula.** `ui.js`'s `_handBreak` (top-row card count) used to be recomputed every render as `order.length - 4` (always exactly 4 cards on the bottom), which silently undid any row a player dragged a card into. It's now a persisted value that only changes when a drag crosses the row boundary (`_dropRow`/`_applyDrop`), or resets to that same default split on a fresh hand or a resort - so 7 or 8 cards can sit in either row, including all of them in one row and none in the other. Because a row can now hold more than 4, `--cc-hand-overlap` is also computed dynamically per render (measured against the real container/card widths) whenever the largest row exceeds 4, so a full row still lays out on one visible line instead of silently wrapping onto a second line within itself.
- **Highlight-sets groups, it does not paint (batch 10 revision).** The `cc-meld-c0..c5` classes used to each carry a different hue (including both green and red, a THE LAW rule 9 violation), then a first fix rang every meld in one shared color - which fixed the colorblind issue but kept the "painted" look Matt disliked without being able to name why. The current treatment (`chinchon/css/chinchon.css`'s CH-1 block) drops the ring: each melded card lifts slightly (`transform: translateY`, so toggling highlight-sets on/off never shifts layout) and gets a thin `#ffce3a` accent bar along its own bottom edge (inside the card, since `.cc-card` is `overflow: hidden` for its rounded corners - reads the same at this size); the small numbered badge (`data-meld-num`, a card's own `::after`) stays as the actual non-color differentiator between simultaneous melds, since lift+bar alone don't distinguish which meld a card belongs to. Non-melded cards dim by a lighter notch than before (`grayscale(0.55)`/`opacity: 0.72`, was full grayscale at 0.5 opacity - read as harsh).
- Both fixes are phone-viewport / narrow-hand concerns; a `PHONE_WIDTH_MAX` (699) guard keeps a short-but-wide desktop window from triggering the row-fit logic, matching this file's own `@media (min-width: 700px)` desktop breakpoint.

### Rules engine notes (correctness-critical)

- **Partition search**: `generateMelds` enumerates all candidate sets/runs as bitmasks;
  a backtracking exact-cover (each card is covered by one meld or left as deadwood)
  finds the minimum-deadwood arrangement. Fast at ≤8 cards.
- **Run adjacency is positional in the config rank ladder, never `rank-1`.** 40-card
  ladder `[1..7,10,11,12]` → **7 and 10 are adjacent**; 48-card `[1..12]` → they are not.
  No wrap-around (12 does not join 1).
- **`figuresFaceValue` affects scoring values only, not adjacency** — `cardValue()` and
  `rankOrderMap()` are independent derivations of the config.
- **`canClose` is about leftover COUNT, not just deadwood**: a hand can have deadwood ≤
  threshold yet not be closeable (≥2 leftover cards). Threshold is inclusive (`≤ maxClose`).
- **Scoring priority (strict order)** in `classifyClosingHand`: chinchón → double-meld
  (−10) → six-and-one (leftover value) → standard (deadwood). Non-closers always score
  standard deadwood. **Chinchón is natural-only** (no wild completes it). Ace-of-Oros (if
  enabled as wild) is enumerated both as a wild and as its natural 1-of-oros.
- **Place-cards on ending** (`attachableCards`) only applies on a *normal* close (not
  chinchón/−10), greedily chaining run extensions to shed deadwood.

---

<!-- BEGIN THE LAW, repeated verbatim (copy 9 of 10). Generated by repeat-the-law.mjs - deliberate, do not consolidate, do not hand-edit. -->

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

<!-- END THE LAW (copy 9 of 10) -->

---

### Card decks (`cards.js` + `decks/`)

Card faces are **images**, rendered by `cards.js` through a small **deck registry**
(`DECKS`) so more decks can be added and offered in a picker later. The default deck,
`baraja-libre`, is a real Spanish (Baraja Española) deck under **CC BY-SA 3.0**
(attribution in `decks/baraja-libre/CREDITS.md` + a visible credit on the setup screen;
the game *code* is unaffected — bundled images are a collection, not a derivative).

- `renderCardFace(card, opts)` builds `<div class="cc-card"><img …></div>`; the image IS
  the whole face (no drawn overlays). `preloadDeck()` warms the cache; jokers have no
  face in this deck → a styled fallback. Assets: `decks/<id>/<suit>-<rank>.webp`
  (`oros/copas/espadas/bastos`, ranks 1–12) + `back.webp`.
- **Cards are opaque** — `.cc-card` uses `object-fit: cover` on a white background. Do
  NOT rely on transparency.
- **Decks can be thin overrides.** A registry entry may set `base: '<deckId>'` plus an
  `own: Set` of the face names it actually ships (`'oros-1'`, `'back'`, …). `ownerDeck()`
  resolves every face to the deck that holds the file, so a *skin* can swap a few cards
  and inherit the rest from its base — no asset duplication. `anita` started as an Española
  skin (only `oros-1..9`) and grew card-by-card until it now owns **all 48 faces + back** (a
  full custom deck), so its `baraja-libre` fallback no longer fires. Plain decks (no
  `base`/`own`) resolve to themselves, so existing behaviour is unchanged.

**Adding a deck (gotcha — learned the hard way):** source card art is usually framed
inconsistently (each card in a different-sized transparent canvas). Rasterize every card
**at a fixed width and flatten onto white** (`resvg` → `sharp.flatten({background:'#fff'}).webp()`)
for uniform opaque cards. Do NOT crop to the content bbox (per-card extents vary wildly
→ inconsistent shapes) and do NOT ship transparent cards (the margin shows the table
colour as a grey band). ~400px WebP, ~1.5 MB / 49 files. Then register it in `cards.js`,
add the files to `sw.js` ASSETS, and bump `CACHE`.

### Scope status

- **Pass 1 (done):** rules/meld engine, full turn loop (draw/discard/close/deck-resets),
  end-of-round + end-of-match modals with score tables, in-hub + standalone.
- **Pass 2 (done):** full settings/rules panel for all ~11 rules + player count + human
  name + per-AI difficulty, persisted to `localStorage` (`chinchon-settings`); inline-SVG
  scoreboard chart; closer meld breakdown; place-cards auto/manual/off (manual prompts
  the human via `agent.choosePlacements`); session stats (`chinchon-stats`).
- **Pass 3 (done):** authentic **Baraja Española** deck (real WebP faces via the `cards.js`
  registry, CC BY-SA 3.0); Spanish avatars with a **pop-up picker grid** (was a random
  cycle); opponents by count (1 = full banner, 2 = corners, 3 = across the top); larger
  two-row hand with drag-to-reorder, sort (suit/rank) + highlight-melds toggles; in-game ☰ menu.
- **Pass 4 (done):** a full second deck **`anita`** — a personal "friends" deck, complete.
  **Pips (1–9, all suits):** Oros = a supplied gold "Ana" coin, Copas = a beer mug, Bastos =
  a golf driver, Espadas = a pickleball paddle (original SVG emblems). **Court cards (10–12,
  all suits):** 12 AI-illustrated *baraja española* court cards of real friends (Ana + Matt)
  in period costume matched to each suit's theme, generated in ChatGPT/Gemini from a
  face-first portrait + a pose reference, then fit to 400×616. **Back:** Ana's photo
  (background-removed) on an original green/gold 180°-symmetric design. **Betty win/lose
  screens:** the end-of-match modal shows a toddler-reaction photo when the Anita deck is
  active (`decks/anita/betty-{win,loss}.webp`, gated in `ui.js`). A **deck picker** in setup
  (`open-deck`/`pick-deck`/`close-deck`) calls `setDeck()` + `preloadDeck()`, persists `deck`
  in `chinchon-settings`, and shows each deck by its full card back. `sw.js` precaches every
  anita asset; the default deck stays `baraja-libre`. Pip/back art was built by scratch
  `sharp` scripts (not in-repo); court cards were AI-generated per the prompts in
  `../ChinChon/court-card-prompts.md`.
- **Roadmap (not built):** optionally unify the flat pip style with the illustrated court
  cards; one-undo affordance; sound.

### Tests

```
node chinchon/js/test.js   # engine unit assertions (deck + meld)
node chinchon/js/sim.js     # 30 all-AI matches; checks termination, scoring, no exceptions
```
Run requires Node ≥22.7 (ESM syntax detection; there is no package.json).

---

---

<!-- BEGIN THE LAW, repeated verbatim (copy 10 of 10). Generated by repeat-the-law.mjs - deliberate, do not consolidate, do not hand-edit. -->

## THE LAW: player data is never deleted, never lost, never put at risk

This is not a guideline. It is the one absolute rule of this repo, set by Matt after a
migration made his entire Ball Run history invisible (July 2026, commits `d7f284b` through
`a5571f3` tell the full story). Every rule below exists because it was violated once and a
player paid for it. No feature, cleanup, refactor, or deadline outranks any of them.

**This section is repeated verbatim about every 10% of the way down this file, by Matt's
explicit instruction (2026-07-22, after a reconstruction of two players' blended history was
nearly handed off as settled fact). The duplication is deliberate and is not clutter: a
session working at line 600 must not have to remember what it read at line 47. Do not
consolidate the copies, do not replace them with a cross-reference, and if you add enough
material to stretch the spacing, add another copy.**

1. **Stored is not enough; data must stay VISIBLE.** To a player, history that no screen
   shows IS deleted, even if the bytes sit safely in localStorage. Before shipping any
   change to a data shape, list every UI surface that displays that data and every gate
   that decides visibility (e.g. `br.runs > 0` filters in game-stats-ui.js and
   leaderboard-ui.js), and prove each one still shows pre-change history.
2. **Writes are additive, only.** Counters increment. Bests only ever improve
   (`Math.max`). Nothing is ever zeroed, decremented, or overwritten with less. This
   already holds everywhere in `js/game-stats.js`; keep it that way.

   **Carve-out: THE LAW governs history and achievement data — data a player earned and
   cannot recreate.** A user-controlled preference the player can restore in one tap
   (e.g. launcher favorites, `js/favorites.js`) is not that. Removing a favorite is the
   user's intent, not data loss, so `toggleFavorite` removing an id from
   `gamehub.favorites.v1` does not violate rule 2. Do not invent a tombstone/soft-delete
   scheme for this kind of data, and do not refuse to implement removal citing this rule —
   the rule was never about preferences. If a future feature is ambiguous about which side
   of this line it's on, ask: can the player recreate this state in one tap with no loss? If
   yes, it's a preference, not history.
3. **Migrations carry everything forward that CAN be carried.** Only genuinely
   unit-incompatible values (e.g. meters vs obstacle counts) may be archived instead of
   converted. Unit-agnostic data (play counts, totals, byDiff buckets, timestamps) always
   survives into the live shape. Archived data goes under a clearly named legacy key and
   is still SHOWN to the player, labeled honestly (see the "Best distance, before scoring
   changed" table in game-stats-ui.js).
4. **Never fabricate conversions.** If old and new metrics are incomparable, do not
   invent numbers. Archive, display as legacy, start the new metric fresh.
5. **Old keys are never deleted, never repurposed.** A shape change gets a new key or new
   field names. Orphaned data is left in place.
6. **No silent write failures.** Every storage write that matters either verifies by
   re-reading what actually landed on disk, or at minimum logs loudly (`console.error`)
   on failure. A swallowed `catch {}` around a data write is a bug. `persist()` in
   game-stats.js and the flight recorder in ball-run/js/ui.js are the reference pattern:
   log locally FIRST, then write the shared store, verify by fresh re-read, retry
   unsynced entries on every app open.
7. **Test migrations against real history, not fresh stores.** A migration test that
   seeds a synthetic new-shape store proves nothing. Extract the actual old writer code
   (`git show <old-commit>:js/game-stats.js`), have it write the store the way real
   devices did, then load with current code and assert the data is intact AND visible.
   Two incidents were declared "verified" on fresh-store tests before this rule existed.
8. **When a player reports missing data, believe them.** Do not blame caches, incognito
   mode, or user error until the code history has been fully replayed and ruled out. The
   one time that order was reversed, the bug was real and the deflection made it worse.
9. **A milestone is not done until CLAUDE.md reflects it.** This project's "team" is a
   sequence of fresh AI sessions with no memory of each other; this file plus handoff notes
   is their *entire* inherited context. Every convention that goes undocumented here gets
   silently re-derived (and re-diverged) by the next session — three storage-key
   generations, two setup-screen patterns, and three CSS root-class styles all trace back to
   a session that shipped a convention without writing it down. If a milestone creates or
   changes a convention (a new settings-key style, a new shared module, a new sync point
   between duplicated code), updating this file for it is part of that milestone, not
   follow-up work.

<!-- END THE LAW (copy 10 of 10) -->

---

## Parchís (`parchis/`)

Spanish Parchís (Parcheesi family) vs AI, a **launch-out** single-file game. Its source is **not in this
repo**: it lives in the sibling project `../Parchís/` as `src/*.js` (engine, board, ai, hud, i18n, theme,
game), combined by `node recombine.mjs` into one `parchis.html` that is copied here as
`parchis/index.html` and precached in `sw.js`. **Do not hand-edit `parchis/index.html`;** edit the source
and rebuild.

- Spanish ruleset (seguros, barreras, bonos of 20 and 10). Round 2 adds two dice and an English/Spanish
  i18n toggle. AI tiers are `facil|normal|dificil`; internal colors are `amarillo|azul|rojo|verde`.
- **Profile:** Parchís reads `gamehub.profile` in its own Phase R2-3 (setup + i18n), mapping the generic
  color names to Spanish and the skill tier to its own AI levels itself. That phase is not yet built or
  deployed, so the current build does not prefill; the hub already writes a compatible shape, so it will
  once R2-3 ships. Do not add a reader on the hub side.
