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

## Answer about the game you were asked about

Matt, twice in one session (2026-08-11), on reports about Escoba that wandered into Chinchón and
then Battleship: *"Why the fuck are we talking about chinchon?"* and *"don't do something random and
start talking about battleship again."*

When a session is asked to work on one game, the report is about THAT game. A pre-existing failure
somewhere else, a pattern another game shares, an unrelated red test — none of it belongs in the
reply, however true it is. Put it in the relevant `CLAUDE.md` if a future session needs it, and
leave it there.

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
anything else when a deploy "didn't take." `validate-sw-assets.mjs` and `test-sw-strategy.mjs`
are the prevention/detection pair. (`RESTORE.md` is a different thing — a device-restore/data-
custody runbook, not a service-worker diagnostic; see "The shared profile" below for its role.)

**Much narrower since 2026-08-02** (see "The service worker's caching strategy" below): the
install used to `cache.addAll()` the ENTIRE ~8.8 MB list atomically, so one 404'd `ASSETS`
entry — a single missing card image — aborted the whole install and the previous worker kept
serving the old build offline forever. Only the ~600 KB app shell is atomic now, so a bad path
in a game folder no longer strands a deploy; it warms best-effort, logs loudly, and caches on
demand instead. A stuck pill now means the SHELL failed to install, which is a much shorter
list of suspects. `test-sw-strategy.mjs` pins this as a regression probe.

### Diagnostic: the launcher renders as raw unstyled HTML (fixed 2026-08-11)

Matt, minutes after a deploy, on mobile data: *"Whoa what the hell? I force closed and reopened and
it was normal but what is this?"* - the launcher with no CSS at all, version pill reading the new
build. Force-closing "fixed" it, which is what a transient server error always looks like.

Cause: the network-first handler treated only a THROWN fetch as failure, so an error RESPONSE (a
404 or 503) was handed straight to the page **even with a good cached copy one line away**. GitHub
Pages serves a redeploy by swapping the published tree, and a request landing in that window can
404 for a moment - so opening the hub DURING a deploy could get a 404 for `css/hub.css` and render
the launcher as raw HTML. Every deploy was a window for it.

Fixed in `sw.js`: `if (!res || !res.ok) return cached;` on the network-first path. Falling back is
also right for a genuinely removed file - this is an offline-first app whose cache is a coherent
snapshot of one deploy that rolls over when `CACHE` is bumped. A request with NOTHING cached still
passes the error through honestly rather than inventing an answer. `test-sw-strategy.mjs` carries
both as a [KNOWN-BUG PROBE] pair; the first was born red against the unfixed worker.

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
- **(2026-08-23) The warm CARRIES UNCHANGED FILES FORWARD across a CACHE bump instead of
  re-downloading them.** Matt: the launcher "became noticeably laggy where it used to be snappy."
  Measured cause: CACHE is bumped on essentially every commit (182 bumps in the 14 days before
  this landed), every bump rolled the cache name over, and `warmRest()` re-downloaded the ENTIRE
  REST tier - 347 requests / 12.6 MB per deploy, saturating the connection for the whole session
  on any device that opened the hub after a deploy, which at ~13 deploys/day meant essentially
  every open. HTTP validators cannot fix it: GitHub Pages re-stamps every file's mtime (and so
  its ETag) on every deploy, so a conditional request 200s the full body even for a file
  unchanged in weeks. The fix is the **GENERATED `REST_MANIFEST` block in sw.js** - a content
  hash per REST file, written by `validate-sw-assets.mjs` from the bytes on disk (that script
  already runs before every deploy; `test-sw-strategy.mjs` fails if a stale manifest is about to
  ship). The warm diffs it against the manifest the previous deploy stored in its cache and
  copies unchanged files across; only genuinely changed files fetch. Measured effect: a
  no-REST-change deploy fell from **12.6 MB / 387 requests to 1.5 MB / 95 requests** (the
  remainder is the page's own load plus the still-atomic ~865 KB shell install), and the warm
  settles in ~0 s instead of 17-31 s. A stale manifest is bounded: code is network-first at
  request time regardless, so stale bytes could only ever be served offline or past the deadline.
- **(2026-08-23) Old caches are deleted at the END of the warm, not at activate.** They are the
  carry-forward copy source AND the fetch handler's fallback while the warm runs - the old
  delete-at-activate behaviour opened a window on every deploy (seconds on wifi, minutes on a
  phone) where games had no cache at all and every request queued behind the warm. Both fetch
  paths now consult the CURRENT cache before the global `caches.match` (which searches in
  cache-CREATION order and would otherwise let the older generation answer). At most one extra
  generation lingers, and only until the next completed warm.

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
| `js/emoji.js` | (2026-08-25) `isEmoji()` / `firstEmoji()` — the "is this actually an emoji" gate for the profile picker's input box. Deliberately NOT wired into `profile-store.js`'s `glyph()`: validation belongs at the moment of choosing, never on the way back out of storage (see its header) |
| `js/emoji-data.js` | (2026-08-25) GENERATED by `build-emoji-data.mjs` — the ~1870-emoji browsable set behind the profile picker, in Unicode's nine categories. Its per-language search keywords are separate files (`js/emoji-search-{en,es}.js`, ~65 KB each, held OUT of the service worker's atomic SHELL tier on purpose) |
| `js/viewport.js` | (2026-08-02) `onViewportResize(cb)` — the ONE way a game subscribes to "re-fit yourself". Folds `resize` + `orientationchange` + `visualViewport` into ONE callback, coalesced to at most once per frame and skipped entirely when neither dimension changed. **A new game must use this, never a raw `window.addEventListener('resize', …)`** — see its header for why the raw form is a scroll-jank bug on mobile |
| `js/game-stats.js` | unified stats, keyed per PLAYER (`statsKey()`/`statsId()`); one recorder per game; a result whose write fails is queued (`gamehub.pendingResults.v1`) and replayed on the next load, never dropped |
| `js/game-stats-global.js` | non-ESM recorder port for Monopoly Deal/Parchís (`window.__ghStats`) |
| `js/firebase-boot.js` | the ONE bootstrap for the named `'stats'` Firebase app |
| `js/stats-net.js` | Firebase mirror to `players/<id>`; username registry; `syncHealth()` |
| `js/players-agg.js` | pure identity-graph aggregation of synced devices into per-person rows, incl. multiplayer head-to-head (`headToHeadRows`) |
| `js/game-stats-ui.js` | "My Stats" overlay |
| `js/leaderboard-ui.js` | "Leaderboards" overlay (DOM only); wins-only display, rating retired from it (2026-07-23); player detail shows multiplayer head-to-head wins (2026-08-11) |
| `js/leaderboard-rank.js` | pure, headless-testable rating/ranking maths (kept for a future rating page; not shown on the leaderboard since 2026-07-23) |
| `js/game-art.js` | single source of every hub tile's inline SVG art, keyed by hub id; `hub.js` and `leaderboard-ui.js` both read it |
| `js/difficulty-tiers.js` | READ-path mapping of difficulty vocabularies onto the 1-4 tier scale |
| `js/arcade-scores.js` | shared high-score + unlock layer for the arcade-cabinet games (Skeeball, Pinball): per-board bests, date-keyed daily bests, unlocks, app-wide records |
| `js/net.js` | multiplayer room layer (`rooms/<CODE>`) used by Chinchón, Escoba, Tic Tac Toe, Mancala, Filler, Dots and Boxes, Pool, Boggle, Yahtzee and Battleship; its N-seat half (`joinSeat`/`vacateSeat`/seat-addressed recovery) is used by Chinchón and Escoba |
| `js/a2hs.js` | add-to-home-screen bottom sheet |
| `js/device-report.js` | the identity/storage dump. Its profile-page button was RETIRED 2026-08-11 (Report a bug supersedes it and sends the same payload); `gatherDeviceReport()` is still load-bearing, called by every bug report |
| `js/install-state.js` | (2026-08-11) installed-app vs browser tab, in one small object. Shared by `stats-net.js` (mirrors it to `players/<id>/device` every sync) and `bug-report.js` - one answer, never two |
| `js/bug-report.js` | (2026-08-11) "Report a bug": the device/browser/PWA/network/SW picture plus the whole Device Details payload, written to `bugReports/` (screenshots to `bugReportShots/`), with an offline outbox that retries itself. Since 2026-08-13 it also carries Matt's **replies** — written to the report AND to `bugReplies/<reporterDeviceId>/`, which is the copy the player reads — and a soft delete that clears his inbox without touching either record |
| `js/messages.js` | (2026-08-31) player-to-player **Messages**: the `messages/` node, addressed by PLAYER CODE so a message follows a person to every device they own. Pure helpers (`pairKey`, unread, hide) plus the verified writes and the offline outbox |
| `js/messages-ui.js` | (2026-08-31) the Messages screen: conversation list, one thread with chat bubbles and a quick-chat preset row, the recipient picker (Matt also gets **Everyone**), and Matt's read-only view of every conversation |
| `js/bug-report-ui.js` | the report form, Matt's inbox (reply / mark done / delete), and the player's own "what Matt wrote back" screen. The repo's FIRST consumer of `css/ui.css`'s `.gh-*` primitives |
| `js/error-log.js` | ring buffer of the last 20 uncaught JS errors (`gamehub.errorlog.v1`), installed by `hub.js` at load so a report carries what actually threw |
| `js/admin-config.js` | (2026-08-24) the app-wide **admin config** (`adminConfig/v1` in Firebase): which games are live for everyone and which Skeeball machines are open to everyone. Pure resolvers over a localStorage cache, so every reader is synchronous and offline-safe; an absent override always falls back to the code default |
| `js/stats-corrections.js` | (2026-08-24) the read-time **score corrections** layer: "those scores were thrown on a machine that was broken at the time." Pure overlay maths applied when a number is DISPLAYED (leaderboard, My Stats, Skeeball's own backboard); the raw record is never touched, and a score thrown after the correction counts normally |
| `js/admin-ui.js` | (2026-08-24) the **admin control page** itself (Matt only, lazily imported): the game live/admin-only switches, the Skeeball machine releases, and this-device tools. See "The admin control page" below |
| `js/announce.js` | one-time launcher announcements: the entries, the seen-list (`gamehub.announce.v1`), and the pure "does this device still owe one" decision. Each entry's `until` date retires it |
| `js/announce-ui.js` | the announcement popup (DOM only) |
| `js/challenge/` | retired challenge system — still load-bearing (`hub.js` imports its `hooks.js` on every load; do not delete) |

### Where the deep docs live

- **`js/CLAUDE.md`** — the full module map and Firebase layering, THE LAW's full working rules,
  the multiplayer lockstep invariants, the leaderboard rating model, sync health (and how to
  diagnose "my history is missing"), the per-player store split ("whose stats are these"), the
  Ana/Natalia correction record, head-to-head capture, the shared-profile contract with
  Monopoly Deal's must-stay-synced duplicates, and the Report a bug pipeline (what it collects,
  where it lands, how Matt reads it, and how to add the next announcement).
- **`<game>/CLAUDE.md`** — each game's own docs (see the games table).
- **`docs/BUILDING-A-GAME.md`** — the UX floor every game's UI must meet, the module contract,
  the "Adding a game" checklist, and screen/cross-game patterns (how-to-play screens, setup
  defaults, viewport-fit-by-measurement, physics-tunnelling prevention). Auto-loaded by a skill
  on new-game work or any game UI/CSS/input change — see "The module contract" below for what
  moved there and why.
- **`VISUAL-PROCESS.md`** — the procedure for verifying a screen actually looks and plays right
  (as opposed to the rules it must satisfy, which live in `docs/BUILDING-A-GAME.md`).

### Dev tooling (repo root, not deployed)

| Script | Role |
|---|---|
| `server.mjs` | local dev server (ES modules/SW need real HTTP, not `file://`) |
| `validate-sw-assets.mjs` | fails if any `sw.js` `ASSETS` entry is missing on disk; warns about deployed files not in the list. **Since 2026-08-23 it also maintains sw.js's generated `REST_MANIFEST` block** (content hash per REST file - what lets the warm carry unchanged files across a CACHE bump instead of re-downloading ~11 MB per deploy): a stale block is rewritten in place, so re-run it and commit sw.js after changing any game file. Run before every deploy. **Since 2026-08-25 a text asset is hashed with its line endings NORMALISED to LF**, because `core.autocrlf=true` means a Windows checkout holds CRLF while the blob GitHub Pages serves is LF: hashing raw bytes made the manifest depend on which machine ran the deploy, so `test-sw-strategy.mjs` failed on any Windows checkout of `main` and every Windows/cloud flip marked ~190 unchanged files as changed - re-downloading ~11 MB per deploy, the exact regression the manifest exists to prevent. Binaries are still hashed raw. |
| `test-sw-strategy.mjs` | (2026-08-02) `validate-sw-assets.mjs` checks WHICH files `sw.js` precaches; this checks HOW it serves them. Runs the real `sw.js` in a `vm` sandbox with a fake `caches`/`fetch` (so it can't drift from the shipped file) and pins the two-tier install, the fetch deadline, the slow-connection latch, and cache-first images. Its `[KNOWN-BUG PROBE]` block is the regression tripwire for the atomic-install failure that used to strand a whole deploy on one 404. |
| `players-agg.test.mjs` | headless unit tests for `js/players-agg.js`, plus a **[KNOWN-BUG PROBE] structural guard on checklist item 7**: it discovers every sub-counter key from `js/game-stats.js` itself and fails unless each one has BOTH a `players-agg.js` branch and a My Stats renderer. The per-game cases beside it are hand-written, so they only cover games someone remembered to add; this covers a NEW game's counter the day it is written. Missing the agg branch zeroes that counter the moment a person's second device syncs, with every local store intact - THE LAW rule 1, and the root file records it being missed twice in a row. **A second structural probe (2026-08-11) covers the whole GAME, not its sub-counters**: every stats id in `game-stats.js` must have a `GAME_META` row in `js/leaderboard-ui.js`, or be listed in `OFF_THE_BOARD` *and* still be `devOnly` in `js/hub.js` — so a game released off the board fails the day it ships. Written because Yahtzee had no row, and it took a player's bug report to notice. |
| `build-emoji-data.mjs` | (2026-08-25) GENERATOR for `js/emoji-data.js` + `js/emoji-search-{en,es}.js`. Fetches unicode.org's `emoji-test.txt` and CLDR's annotations live, so a re-run picks up a newer Unicode release. Its three filters (fully-qualified only, no skin tones, nothing newer than E15.0) are each a size or a tofu-box decision, documented in the file. Re-run it, then `validate-sw-assets.mjs`, and commit all four files |
| `test-emoji.mjs` | (2026-08-25) the picker's two halves, headless: what `isEmoji()` accepts and refuses (initials like "MP" are the case it exists for), and the generated set's integrity — every entry passes its own validator, no duplicates, no skin tones, and **the keyword files line up index-for-index with `ALL_EMOJI`**. That last one is the silent failure: a one-entry shift labels every emoji after it with its neighbour's name, and nothing at runtime would notice |
| `test-new-badge.mjs` | (2026-08-01) headless unit tests for `js/new-badge.js` (window edges, malformed/absent dates, future dates), plus a scrape of the real `GAMES` registry asserting every `released` date that IS present parses — a typo'd date is the silent failure here (the game ships, the pill never appears) |
| `test-leaderboard-rank.mjs` | headless unit tests for the leaderboard rating model, incl. a LAW rule 1 block replaying the OLD visibility gate against the new one (nobody may fall off the board or lose plays) |
| `tune-ladder.mjs` | (2026-08-14) Skeeball's power ladder, measured through the real engine: every 0.01 power step, the bands it forms, dead zones at either end, and the touched-the-board rate. Needs no browser. Run after any change to `skeeball/js/boards.js`'s `geom` |
| `measure-arc.mjs` | (2026-08-14) is Skeeball's ball actually FLYING, and where does it come down? Peak clearance over the board face and the first-contact point, per power. `tune-ladder.mjs` cannot see a ball that never leaves the ramp - this can, and a build where it could not shipped |
| `sight.mjs` | (2026-08-14) can the camera see the bottom of Skeeball's board over its ramp crest? One number; keep it positive whenever the ramp, the board or the camera moves |
| `measure-reach.mjs` | (2026-08-14) the curve `tune-ladder.mjs` sits on: how far up Skeeball's face each power setting gets, with the holes taken OUT so nothing captures. Hole positions are read off this, never guessed |
| `sweep-mover.mjs` | (2026-08-25, rewritten 2026-08-26) reachability on Skeeball's HOT SHOT: RUNAWAY, the one machine with a MOVING PART and a FACE THAT CHANGES SHAPE MID-RACK. Every other machine's reachability is a 2-D question (power x aim) and `skeeball/js/test.js`'s 41x21 grid answers it. This machine breaks that twice: a moving hole makes the same swipe land somewhere different depending on where the basket was at release (so a 2-axis grid measures ONE arbitrary frozen PHASE), and the face is different on ball 1 and ball 9 (two still 100s and every basket open, against one sweeping 100 and the rest closed). So it sweeps power x aim x phase at a STAGE of a rack: `--stage open` (ball 1), `--stage run --rung N` (one 100 capped, the other sweeping at ladder rung N), `--stage endgame` (everything closed but the runaway), or `--ladder` for every rung of the escalation at once. Reports captures per hole, the jam rate against a 1% budget, the slowest settle, which phases score the mover at all, and - crucially - fails if a CLOSED basket still captures. `node sweep-mover.mjs runaway --ladder`; re-run after any change to that face, its amplitude, its ladder or its materials. **Its `--ladder` output is the only honest way to talk about whether the escalation makes the shot harder** - a faster basket is a bigger target in TIME even though it is the same target in space, so the intuition is unreliable in both directions |
| `test-runaway-capped.mjs` | (2026-08-26) HOT SHOT: RUNAWAY's CLOSED-BASKET probe. That machine is the only one whose face changes shape during a rack - every basket except the runaway is a ONE-SHOT and closes once a ball has gone in - and neither `skeeball/js/test.js` (DEFAULT_BOARD only) nor `sweep-mover.mjs` (reachability) ever throws at a face that has been closing baskets for eight balls, which is the face the last ball of every good rack meets. "Closed" is implemented in TWO places and needs both (the collar is not built, AND capture skips the hole); do only the second and the cup becomes a BOWL a ball can never leave, which is `test-brickcity-stall.mjs`'s parked ball rebuilt on purpose one file over. It also pins that a closed basket scores NOTHING and that the runaway is still reachable with the rest of the face shut. **It compares the closed face against the OPEN one in the same run rather than checking a fixed settle budget** - its first draft asserted a median under 3.0s, a number borrowed from BRICK CITY, and the closed face measured 3.04s against this machine's own open-face 2.90s: a failure that meant nothing, because on a board where most throws roll the full length back, three seconds is what a ball costs. ~90s |
| `test-brickcity-stall.mjs` | (2026-08-26) BRICK CITY's PARKED-BALL probe, and the only engine test any machine other than THE CLASSIC has. `skeeball/js/test.js` sweeps `DEFAULT_BOARD` only, so the staircase machines - which removed the continuous slope that makes "a resting ball always rolls back down" true - had nothing checking that their balls ever stop resting. Matt: *"the ball sometimes gets stuck IN the negative baskets."* It balanced on the back rim of the bottom-row cups against the riser behind them, at the same world z every time, where capture cannot reach it. 21x11 grid, ~30s; asserts nothing sits dead still past 0.75s, every row is still reachable and the median settle stays under 3s. Born red against the pre-fix engine (2.59s). Re-run after any change to that machine's geometry, materials or watchdog |
| `test-recorder-contract.mjs` | contract test: `js/game-stats-global.js` vs `js/game-stats.js` on their shared surface, incl. the fold-once interop and the BD in-scope copy sync |
| `test-stats-replay.mjs` | LAW rule 7, runnable: real historical `gamehub.stats` shapes (written by the actual old writers) loaded with current code, checked against the real UI visibility gates. Scenario D replays the REAL escoba records of the five devices that have multiplayer history, read out of Firebase unedited, against the migration that pulls those plays back out of the AI difficulty bucket they were misfiled into |
| `test-stats-identity.mjs` | (2026-07-23) the per-player store split (see "Whose stats are these" in `js/CLAUDE.md`): proves an existing device is completely undisturbed, that a second player on the same phone cannot blend into the first, that the device-wide legacy stores never fold into a forked store, and that the ES-module and global recorders resolve the same key. Rule 7 fixture is the real store from the device the Ana/Natalia incident happened on |
| `test-mp-lockstep.mjs` | headless two-engine MP lockstep for Chinchón + Escoba + Tic Tac Toe + Mancala over a fake room; mirrors the ui.js MP glue with per-method citations — update the mirror when the glue changes. Its [KNOWN-BUG PROBE] assertions are regression tripwires for the five fixed MP defects (see "Multiplayer lockstep — invariants" in `js/CLAUDE.md`); Tic Tac Toe's T1-T7 and Mancala's M1-M6 blocks each port all five into a game that shares none of Chinchón's vocabulary |
| `test-game-conventions.mjs` | (2026-08-02) the "Adding a game" checklist and the "USE WHAT EXISTS" table, made machine-checkable: no raw resize/`visualViewport` listeners, no `document`-level `touchmove`, every fixed scrolling overlay contains its scroll, every standalone page name-gated, the three module-contract exports present, listeners balanced, a `CLAUDE.md` and an `{en,es}` dictionary per game. Discovers game folders from disk so a NEW game is covered the day it appears. `KNOWN_GAPS` carries pre-existing debt, named down to the exact line (currently: a handful of sub-11px CSS declarations in six games' micro-labels, predating the UX floor in `docs/BUILDING-A-GAME.md`) — printed on every run, never silent, and the suite fails if an entry goes stale. **Written because prose alone did not work**: Hill Climb shipped the raw-resize bug the same day it was removed everywhere else, because the convention lived in `js/CLAUDE.md`, which a new-game session never auto-loads. |
| `test-visual.mjs` | (2026-08-08) the only suite that LOOKS at a game. Drives it in a real Chromium at 393x852 in light/dark/reduced-motion and fails on: nothing painted, the body scrolling sideways, a JS error on mount, an animation too brief to follow (`MOTION` probes), or **a game that cannot actually be PLAYED** (`PLAY` probes drive the real UI with real touch to a real outcome; every run prints which games no probe has ever played), or **a game that does not FIT one screen** (`fit` checks both hosts - standalone AND mounted in the hub's real chrome - at a tall and a short phone height; the hub adds ~138px of chrome an immersive game must not ignore).  Writes a contact sheet to `.visual-out/` - **open it.** **Checks only what CHANGED** (`node test-visual.mjs`), or named games (`... escoba`), or everything (`... --all`); a shared-code change (`js/`, `css/`, `index.html`, `sw.js`) RECOMMENDS a full sweep but never runs one - **always ask Matt before testing all games** (his rule, 2026-08-08). SKIPs without playwright-core/Chromium. Written after Battleship's cannon took four rounds of Matt's time: **`VISUAL-PROCESS.md` and `reference/` are the process it belongs to, and a session doing visual work must read them first.** |
| `test-yahtzee-ai.mjs` | (2026-08-13) the only suite that **plays** a game rather than looking at one: a full 13-round Yahtzee against the LIVE AI in a real Chromium (the real `endTurn` → `aiTakeTurn` chain, via `window.__yzTest`), then a strength profile and the die's distribution. Written after Matt read a player's 18-wins-in-20 record as rigged dice — it was a weak opponent (mean 154), and this pins the fix from **both** sides: a BAND of 185-235, so an AI that goes hopeless again fails exactly as loudly as one that becomes unbeatable. Also asserts 600,000 rolls stay uniform, so "are the dice weighted" is answered by a test instead of by re-reading `doRoll`. Full incident: `yahtzee/CLAUDE.md`. SKIPs without playwright-core/Chromium. |
| `run-all-tests.mjs` | runs every node suite above plus the per-game engine tests, exit-code aggregated. **DO NOT run this before a deploy, or on your own initiative — only when Matt asks for it by name.** His instruction, 2026-08-24, after a session ran it five times in one day: *"stop running the engine suites on games we are not working on... So STOP wasting time and tokens constantly running all this shit."* It takes ~4.5 minutes and spends nearly all of it on games the change never touched (dots-boxes 92s, yahtzee-ai 121s, uno 18s, sw-strategy 14s; the other 30+ suites finish in about 30s combined). **What to run instead: the suites covering the files you actually changed, plus `validate-sw-assets.mjs` before a deploy** (0.2s, and a missing precache entry is the one thing a deploy cannot survive). A game's engine suite only when you touched that game's engine. |
| `test-stats-corrections.mjs` | (2026-08-24) headless tests for `js/stats-corrections.js`: what a void removes, what it deliberately leaves alone (a best is not a sum; `balls`/100s/50s have no per-machine breakdown, so they are left rather than guessed), that a later score still counts, and that the raw record is unchanged every time. Plus structural checks that a TESTING machine's racks never reach a counter. The Firebase write and the admin page's own screen are not covered, and the suite header says so |
| `test-admin-config.mjs` | (2026-08-24) headless tests for `js/admin-config.js`: the shape normalizer, both resolvers, the override readers and the cache, plus STRUCTURAL checks that the callers still OR the resolvers in (the hub card gate, the My Stats tab gate, Skeeball's three unlock gates, and Pinball's leaderboard row). The Firebase write path and `js/admin-ui.js` are not covered, and the suite header says so |
| `test-messages.mjs` | (2026-08-31) headless tests for the pure halves of `js/messages.js`: `pairKey`'s symmetry (both people must compute the same thread key from their own side, or one conversation quietly becomes two), the unread count at real epoch precision including the guard that stops your own message badging you, the hide rule (a newer message must bring a hidden thread back), and the outbox cap. The Firebase write path and `js/messages-ui.js` are NOT covered, and the suite header says so |
| `test-bug-report.mjs` | (2026-08-11) headless tests for the pure halves of Report a bug: the screenshot budget, the description clamp, the inbox order and unread count (with real epoch timestamps - a `\| 0` on one scrambled both in the first draft), and the announcement's show-once/expire-by-itself decision, including the shipped announcement's own dates and EN/ES completeness. The DOM and Firebase halves are NOT covered, and the suite header says so. |
| `read-install-state.mjs` | (2026-08-11) Matt-only: who is on the installed app and who is still in a browser tab, browser tabs first, from `players/<id>/device`. Only shows a device once it has opened the hub since this shipped - "(not seen yet)" is missing data, not a browser tab, and nothing here is retroactive |
| `read-bug-reports.mjs` | (2026-08-11) Matt-only, the terminal view of the in-app inbox: lists `bugReports/` newest first, prints one in full, and is the only way to get the screenshots onto disk - `node read-bug-reports.mjs [--open] [<id> [--shots [dir]]] [--json]` |
| `read-device-reports.mjs` | (2026-07-22) Matt-only: fetches "Device details" reports (see `js/device-report.js`) from `deviceReports/` via the plain RTDB REST API (anonymous sign-in via the Identity Toolkit REST endpoint, no SDK/dependency) - `node read-device-reports.mjs [deviceId] [--raw]` |
| `backups/rtdb-backup.mjs` | (2026-07-23) **Run this before ANY script that writes to Firebase, any rules change, any schema change.** Timestamped full-DB snapshot to `backups/rtdb-<ISO>.json` via the same no-dependency REST pattern; `node backups/rtdb-backup.mjs [path]`. Also exports `signInAnonymously`/`readPath`/`totalPlays` for other tools. Restoring is deliberately NOT automated - a restore is a destructive write and must be hand-driven. **The snapshots are gitignored** (`backups/*.json`): this is a public repo and they hold every player's real name, code and stats. |
| `clear-skeeball-stats.mjs` | (2026-08-22) Matt-only, and the ONLY thing that permits it is that he asked for it in those words: deletes `players/*/stats/games/skeeball` on every node. Dry run by default, `--write` to apply; refuses to start without a same-day `backups/rtdb-*.json`, aborts if any node carries a `h2h.skeeball` branch it was not written against, and verifies by fresh re-read that zero skeeball records survive and every OTHER game object is untouched. **Applied 2026-08-22**: 55 nodes, 64 plays, top score 700 - all of it Matt/MattyIce test data, no family history. **It is not durable alone** - `syncMyStats()` mirrors the device's whole local store, so a device still holding local Skeeball data re-uploads it on its next hub load; the dev-only "Reset Skeeball stats" button is the device half. |
| `delete-test-players.mjs` | (2026-08-22) Matt-only: removes whole `players/<id>` nodes belonging to a TEST HARNESS, never to a person - `test-visual.mjs`'s PLAY probes mint a fresh deviceId every run, so throwaway players accumulate. Dry run by default, `--write` to apply, `--name` for a harness other than the default "Visual Test". Per node it refuses unless ALL of: the profile name matches exactly (never a substring), the node has no `h2h` of its own, no other player names it as an opponent, and it owns no username - so a real person who picked the name is safe. Verifies by fresh re-read. **Applied 2026-08-22**: 17 nodes (5 with one Skeeball play each), 174 player nodes -> 157, every other player untouched. |
| `fix-natalia-record.mjs` | (2026-07-23) The one-off Ana/Natalia leaderboard correction, kept for audit. Dry run by default, `--write` to apply; it backs up first, simulates the post-write leaderboard with the repo's real `players-agg.js`/`leaderboard-rank.js` and aborts if any other player's row would move, then verifies by fresh re-read and diffs every pre-existing device record. **Already applied; re-running is a no-op (it refuses to create a second Natalia).** |

### The module contract

Full contract (the three required exports, `destroy()`/leak-free rules, the name-gate
requirement, `isInProgress()`'s two-plus meanings per game, `immersive: true`, and the
module-stylesheet-permanence fact) moved to `docs/BUILDING-A-GAME.md`, "Part 1 — Building a
game." Read it before touching any game's mount/unmount lifecycle, not just when building a new
one — it's also the answer to "why does `isInProgress()` behave differently here."

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
| Buttons, cards, fields, modals | `css/ui.css`'s `.gh-*` primitives + `--gh-*` tokens | rebuilding chrome from scratch. Skeeball's setup and how-to screens use them; a `snake-v2/` preview (removed 2026-08-18) proved the whole chrome fits in 140 lines of CSS against the real Snake's 279 for the same screens. A new game is the cheapest possible place to adopt it, because there is nothing to migrate |

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
It is not cosmetic: the worker only ever deletes caches whose name DIFFERS (at the end of the warm,
since 2026-08-23), and `warmRest` skips entries already present so the warm can resume, so a device
holding the other build's cache keeps it, takes your shell over the top, and never refreshes the
game files underneath — a permanently mixed build.

### Adding a game — checklist

The per-axis reference table and the 11-step checklist (setup screen, CSS scoping, settings key,
`GAMES` entry, `sw.js`/`CACHE`, the sub-counter three-edit rule, `GAME_META`, `<game>/CLAUDE.md`,
`strings.js`/i18n, running the test suites) moved to `docs/BUILDING-A-GAME.md`, "Part 1 — Building
a game." Read it before creating a new game folder — and read Part 0 of the same file (the UX
floor) before changing any existing game's UI or CSS, new game or not.

## The games

One line per game; each game's full documentation lives in `<game>/CLAUDE.md` (auto-loaded when
working in that folder).

| Game | Integration | CSS root / prefix | Settings key | Stats recorder |
|---|---|---|---|---|
| Ball Run | in-hub `module:`, immersive | `.br-root` / `.br-` | `ballrun.*` (frozen gen-1 dotted keys) | `recordBallRun` |
| Battleship | in-hub `module:`, immersive, **multiplayer** (`gamehub.battleship.mp.v1`, the repo's first hidden-information game) | `.bs-root` / `.bs-` | `gamehub.battleship.v1` | `recordBattleship` |
| Boggle | in-hub `module:`, **multiplayer** (`gamehub.boggle.mp.v1`) | `.bg-root` / `.bg-` | `gamehub.boggle.v1` | `recordBoggle` |
| Chinchón | in-hub `module:` | `.cc-root` / `.cc-` (many rules still bare-prefixed) | `chinchon-settings` (frozen gen-1) | `recordChinchon` |
| Connect Four | in-hub `module:` | `.cf-root` / `.cf-` (many rules still bare-prefixed) | `gamehub.connect4.v1` (+ `gamehub.connect4.save.v1` autosave) | `recordConnect4` |
| Dominoes | in-hub `module:` | `.dm-root` / `.dm-` | `gamehub.dominoes.v1` | `recordDominoes` |
| Dots and Boxes | in-hub `module:`, **multiplayer** (`gamehub.dotsboxes.mp.v1`) | `.db-root` / `.db-` | `gamehub.dotsboxes.v1` | `recordDotsBoxes` |
| Escoba | in-hub `module:`, immersive, **multiplayer at 2-4 seats** (save key `escoba-save`, MP field) | `.eb-root` / `.eb-` | `escoba-settings` (frozen gen-1) | `recordEscoba` |
| Filler | in-hub `module:`, **multiplayer** (`gamehub.filler.mp.v1`) | `.filler` / `.fl-` (pre-convention root class, frozen) | `gamehub.filler.v1` | `recordResult('filler', …)` |
| Hill Climb | in-hub `module:`, immersive | `.hc-root` / `.hc-` | `gamehub.hillclimb.v1` | `recordHillClimb` |
| Mancala | in-hub `module:`, immersive, **multiplayer** (`gamehub.mancala.mp.v1`) | `.mancala` / `.mc-` (pre-convention root class, frozen) | `gamehub.mancala.v1` | `recordResult('mancala', …)` |
| Monopoly Deal | launch-out `href:` (in-repo `business-deal/`, own nested SW) | n/a (own page) | its own keys | `window.__ghStats` → `'business'` |
| Nuts & Bolts | in-hub `module:` | `.nb-root` / `.nb-` | `gamehub.nutsbolts.v1` | `recordNutsBolts` |
| Pool | in-hub `module:`, immersive, **multiplayer** (`gamehub.poolv2.mp.v1`) | `.p2-root` / `.p2-` | `gamehub.poolv2.v1` (frozen; see its file) | `recordResult('pool', …)` |
| Parchís | launch-out `href:` (built from sibling `../Parchís/`) | n/a (own page) | `parchis_r2_prefs` | `window.__ghStats` → `'parchis'` |
| Pinball | in-hub `module:`, immersive, **admin only** (`devOnly`) | `.pb-root` / `.pb-` | `gamehub.pinball.v1` | `recordPinball` |
| Skeeball | in-hub `module:`, immersive, **solo** (unlockable machines, no opponent) | `.sk-root` / `.sk-` | `gamehub.skeeball.v1` | `recordSkeeball` |
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

**The emoji is chosen from the whole set, not a shortlist (2026-08-25).** Matt: players "should be
able to open their keyboard and choose any emoji they want". No browser exposes an API that opens
the OS emoji keyboard — `inputmode` has no emoji value — so the picker ships the set itself
(`js/emoji-data.js`, ~1870 entries, nine category tabs, EN/ES search) AND its search box doubles as
the type-your-own field: tap the keyboard's emoji key and the glyph appears as the first result.
**Only emoji are ever selectable** (Matt's rule: reject anything that is not an emoji) — typed text
is treated as a search query, so "MP" simply finds nothing and there is no button to press for it.
Validation is `js/emoji.js`, at the moment of choosing only; `profile-store.js`'s `glyph()` stays
permissive on purpose, since it runs on every READ and tightening it would rewrite an avatar a
player already has. Recent picks live in their own key (`gamehub.emojiRecent.v1`), not in the
profile shape — a one-tap convenience, exempt from THE LAW rule 2, and it leaves `gamehub.profile`
untouched.

**Still open (paused by Matt, 2026-08-25): the emoji does not follow the player everywhere.** The
hub's top-bar pill, Ball Run, Dominoes, Hill Climb, Nuts & Bolts, Snake, Pinball and Skeeball print
the profile NAME with no avatar beside it (`js/arcade-scores.js` does not even carry an `emoji`
field next to `name`), and Chinchón/Escoba override it with their own 24-emoji `HUMAN_AVATARS`
list. The fix is a shared `chipHTML({name, emoji})` primitive plus a sweep, staged so the immersive
games — whose one-screen fit is measured — go last. Deferred deliberately, not forgotten.

Contract, `profile-store.js` API, Monopoly Deal's must-stay-synced duplicates, and the
per-game consumption rules all live in `js/CLAUDE.md`. The load-bearing rules, in brief: the
profile is DEFAULTS-ONLY — every game prefills from it, each game's own saved settings beat it,
and games never write it back (the profile page is the primary writer, plus `js/hub.js`'s
first-run gate). Extend the shape additively, never rename fields. Readers try/catch and treat
missing or malformed data as "no profile"; a profile must never crash a game.
## Messages (2026-08-31)

Players can write to each other. **📬 Messages** sits at the top of the profile page; the launcher's
profile pill carries the unread badge, which is why the button is there and not in the page footer
(the badge must not send anyone to a control a scroll away).

- **A message is addressed to a PLAYER CODE, never a deviceId.** This is the one thing `bugReplies/`
  gets wrong: keyed by device, Matt's answer only ever reaches the phone that filed the report.
  Several people here have two phones, so a device-addressed message would be read on one and be
  invisible on the other. The code is minted at the name gate for everyone.
- **One conversation is one node**, at `messages/threads/<pairKey>`, where `pairKey` is the two codes
  sorted A-Z. Both people compute the same key from their own side. `messages/index/<CODE>/<other>`
  is what makes an inbox listable, and it carries `seenAt`/`hiddenAt`, so the badge costs one read no
  matter how many conversations exist. Read state lives in Firebase, not localStorage: reading on one
  phone has to clear the badge on the other.
- **Nothing is ever deleted.** "Hide this conversation" stamps `hiddenAt` on that one person's own
  index row; anything newer brings the thread straight back, and the other person's copy is untouched.
  There is no hard delete anywhere in `js/messages.js`.
- **Matt can send to Everyone**, which is just one ordinary message per person in their own thread, so
  replying to a broadcast is an ordinary conversation.
- **The admin page has a read-only "Messages" section.** Read-only is a property of the module (there
  is no admin write path in `js/messages.js` at all), not of the button.
- **No push notifications.** The badge appears when a player opens the app. Real push needs FCM and a
  permission prompt, which is its own job.
- **Messages has the top bar's third button since 2026-08-31, where My Stats used to be.** Matt: *"I
  don't think My Stats is used by anyone... we could change it into a Messages button?"* Four buttons
  wrap to a second row on a phone (measured), so it was a swap or nothing. **My Stats moved to the
  profile page** and is unchanged; every screen it shows is ALSO reachable at Leaderboards → your own
  row → a game, which is what keeps a player's full win/loss record visible (rule 1 — the leaderboard
  itself is wins-only by design). Nothing was removed.
- **Two badges, one per button.** Unread messages badge the Messages button; a reply to a bug report
  badges the profile pill. They were summed onto the pill while it was the only route to either.
- **A "Send message" button sits on a player's leaderboard detail screen.** Hidden on your own row,
  and on a legacy record with no player code (a message is addressed to a code, so a dead button
  would be worse than none). Full contract and the node shape: `js/CLAUDE.md`, "Messages".

## The profile page's structure (2026-08-31)

Matt: *"We've just kind of thrown stuff in there over time and it looks disorganized."* It had FOUR
container patterns at once — a card with a heading, a card that was itself a collapsible,
collapsibles nested inside a card, and three loose buttons in no card at all. Now:

**You** (identity only) · **Messages** · **Settings** (one list of collapsible rows) · **Your
devices** · **Help** · **Reset profile**, alone at the bottom.

- **One pattern**: every block is a `.pf-section` card. The only collapsibles are the rows inside
  Settings, and they are one level deep (`.pf-rows > details`).
- **Colour, theme and quick chat moved OUT of "You"** into Settings; they are settings, and having
  them there is what made that card a grab-bag.
- **Language joined Theme in Settings.** It had only ever been in the hub's top bar, so the two
  halves of one choice lived on different screens.
- **"Message for other players" is now "Your note".** It is a line on your own leaderboard page, and
  the old label read as the Messages feature two cards below it.
- **My Stats and the two Help buttons share one full-width row-button style** (`.pf-linkbtn`). They
  were three different widths, centred, in no container.

**`messages/` is the ONE node in this database with real security rules on it.** Matt: *"Only admin
should be able to see every thread. Others should only see their own."* Everything else is
`auth != null`. A device claims `msgAuth/<auth.uid> = <its player code>`, and the rules scope every
read to threads that code is in; `admins/<auth.uid>` (which already existed, set by hand in the
console) grants Matt the read-all. **It does not survive somebody who has another player's
5-character code and opens developer tools** - that code is printed on the profile page, so it is
not a secret and cannot be made one.

Two knock-on effects, because a granted ancestor `.read` cascades and cannot be revoked below:

- **The root `.read`/`.write` are now `false` and every branch is enumerated in
  `database.rules.json`.** Add a new top-level node there or it is unreachable.
- **`backups/rtdb-backup.mjs` reads branch by branch now**, from a `BRANCHES` list that must stay in
  step with that file, and it CANNOT read `messages/` (it signs in anonymously). It says so loudly
  rather than recording an empty branch. Export that node from the Firebase console.

**The rules are published by hand** (console → Realtime Database → Rules → paste → Publish); no
script in this repo deploys them. Deploy the app first, the rules second: a device claims itself on
its next hub load.

## The admin control page (2026-08-24)

Matt: *"I need an admin control page in the hub. I need to be able to make games admin only for
testing and make them live. I need to be able to release specific skeeball machines too. I need all
controls as possible from within the app."*

Both switches existed before this; both were SOURCE EDITS. Hiding a game meant `devOnly: true` in
`js/hub.js`, a `GAME_META` edit, a test-list edit, a `CACHE` bump and a deploy — Skeeball went
through that cycle three times in three days (released 08-22, pulled back 08-23, re-released 08-24).
Releasing one Skeeball machine early was not possible at all: a machine is opened by earning it, and
the only bypass was the dev profile.

The launcher's **🛠️ Admin** button (rendered for Matt only, beside the bug inbox) opens
`js/admin-ui.js`, which writes `adminConfig/v1` through `js/admin-config.js`. Every device reads that
node once per hub load and caches it locally.

**It is written for ONE reader and looks like it.** Matt, on the first version: *"It's for me. I know
what all the heading mean. I don't need 5 paragraphs explaining what live or admin only means."* So
the page is four COLLAPSED accordion sections (Games, Skeeball machines, Player scores, This device;
open state remembered in `gamehub.adminOpen.v1`), no explanatory prose, and **no Default buttons** —
an override that matches the code default is the same thing, and "default" was a concept that existed
nowhere but that button. `setGameLive(id, null)` / `setBoardMode(id, null)` still clear an override
from code if a future screen needs it.

- **An override sits ON TOP of the code default, it does not replace it.** An absent entry means
  "whatever `js/hub.js` says". A wiped, unreachable or never-written config leaves the app behaving
  exactly as it does today — which is also why a config failure can never take a released game off
  the family's launcher (THE LAW rule 1).
- **A Skeeball machine has THREE states, and all three are READ-TIME ONLY.** Matt, on the first
  version of the page: *"this doesn't allow me to select which skeeball machines are live and can be
  unlocked and played vs what is not able to be played yet."* **Open** (everyone plays it now),
  **Unlockable** (live, earned the normal way), **Testing** (nobody but a dev profile). Testing
  overrides `boards.js`'s `adminOnly` the same way a game's live switch overrides `devOnly`, so
  moving a machine to Unlockable really does make it earnable. `skeeball/js/ui.js` ORs
  `isBoardReleased(id)` with the player's earned `isUnlocked(...)` and nothing writes `sk.unlocked`,
  so nobody is ever credited with an unlock they did not earn — and moving a machine back only
  DECLINES TO HONOR an earned unlock while it is set, never deletes it (rule 2).
- **Every write verifies by fresh re-read and fails loudly** (rule 6). A dev origin never writes the
  family's config at all, same guard and same opt-in key as `js/stats-net.js`.
- **`devOnly` is now only a DEFAULT, so a game can go live with no commit.** That is why Pinball has
  a `GAME_META` row in `js/leaderboard-ui.js` while still being admin-only, and why
  `players-agg.test.mjs`'s `OFF_THE_BOARD` list is now empty and must stay that way: a game released
  from inside the app gets no release commit to add its row, and a missing row makes every win on it
  count as zero (rule 1 — how Yahtzee shipped).
- **The Player scores section shows where everyone stands**, per person and per machine: plays,
  best and points as currently counted, plus that machine's three objectives with progress (read
  through `skeeball/js/goals.js`'s `readGoals(boardId, sk)`, so the page can never disagree with the
  rails the player sees). Grouped by PERSON, not device — a void applies to every device record that
  person plays on, or their other phone re-supplies the numbers on its next sync.
- **Scores thrown on a broken board can be voided, per player, per machine.** Matt, 2026-08-24:
  *"Worried about people getting artificially high scores on a broken board. Which is exactly what
  happened to classic and basketball skeeball."* The page's **Player scores** section marks a
  machine's scores as not counting for one player. It is an OVERLAY in `adminConfig/v1`, applied
  when numbers are DISPLAYED — editing `players/<id>` by hand cannot work, because every device
  mirrors its whole local store over that node on the next hub load. Full contract, and the two
  things it deliberately cannot do, in `js/stats-corrections.js`.
- **A machine set to Testing records to a practice bucket and counts for nothing.** `sk.practice`
  (`js/game-stats.js`) — kept, carried across devices, shown on its own labelled row in My Stats,
  and reachable by no counter, no best, no unlock, no goal and no leaderboard. This is the half that
  stops the problem happening again rather than cleaning up after it.
- **Nothing on this page deletes, resets or rewrites any player's data.** A void is an overlay, not
  a delete: the raw numbers stay on the phone and in `players/<id>`, and the page shows both. The
  app-wide clears that do exist are node scripts with backups, dry runs and verification
  (`clear-skeeball-stats.mjs`); a button is the wrong home for them. The "This device" section is
  local-only (update check, bug inbox, device id, the dev-write opt-in, re-show announcements).

Full contract, the node shape, and how to add a third switch: `js/CLAUDE.md`, "The admin config".

### Accessibility + copy conventions

- **Colorblind-safe** (Matt is red/green colorblind): wherever color is a choice, pair each hue with a
  shape marker, never hue alone. Palette: yellow `#F2B705` circle, blue `#1F5FA8` triangle, vermilion
  `#E0532F` square, teal `#178A7A` diamond.
- **`#ffce3a` is the standing selection/emphasis accent** — for highlighting the currently-selected
  or currently-active thing (not the categorical palette above), always paired with a non-color
  indicator (shape, icon, label, border), never color alone. Live in Ball Run, Chinchón, Connect
  Four, Escoba, Nuts & Bolts and Pool's CSS plus `js/game-art.js` and `icons/icon.svg`.
- **No em dashes** in user-facing game or profile copy (use commas, colons, or parentheses).
- **any "you win / you lose" popup gets a close (X) in its top-right corner**, so it can be dismissed without forcing a rematch.
- **The rest of this repo's UX/UI rules — minimum text size, tap targets, safe-area handling,
  animation/reduced-motion rules, and more — live in `docs/BUILDING-A-GAME.md`'s "Part 0 — The UX
  floor."** Read it whenever you touch a game's UI or CSS, not just these three bullets.
