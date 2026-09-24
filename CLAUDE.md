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

## Asking for a change means LIVE on the deployed Game Hub — not just committed to a branch

Any instruction to change, fix, add or remove something in this app is an instruction to make
that change live, and the deploy is part of the work, not a separate decision to bring back for
approval. A fix sitting on a branch has not fixed anything for the people playing the game.

Asking first is only right for a genuinely destructive step this sequence does not cover (a
force-push, a history rewrite) - never for the ordinary merge-and-deploy below. If the change
really should not ship yet, that is Matt's call to make and he will say so; the session's job is
to ship it and report that it is live.

A commit on a feature branch, or even a pushed branch with an open PR, is **not done** under this
instruction. Pages deploys from `main` only. When Matt asks for any change, the session must,
without waiting for further confirmation at each step:

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
per session, and it does not need Matt to have used one of the three words. The one thing worth pausing for is a genuinely destructive step this doesn't cover
(e.g. a force-push, a history rewrite) — ordinary merge-to-main-and-deploy is not that.

Full incident and rationale: `docs/CLAUDE-HISTORY.md#asking-for-a-change-means-live-on-the-deployed-game-hub-not-just-committed-to-a-branch`

## When Matt asks what you are doing, ANSWER HIM. Immediately.

A message that arrives mid-turn is not a note to fold into the final report. **Stop, and say where
you actually are** - the step you are on, what is left, and why it is taking as long as it is -
before the next tool call. A short honest answer costs one message; carrying on silently reads as
being ignored.

This is not the same as asking permission and it does not mean abandoning the work. Answer, then
carry on.

Full incident: `docs/CLAUDE-HISTORY.md#when-matt-asks-what-you-are-doing-answer-him-immediately`

## Mockups are sketches, not pitches

**A mockup is the thing itself and its numbers. Nothing else.** The drawing, the tables, the values.
No lede, no framing paragraph, no "what this drawing is", no explaining why a decision was made, no
sentence that would only exist to persuade somebody who was not in the conversation.

The reasoning is not deleted, it is just not IN the mockup: put it in the repo doc or the commit
message, where a future session needs it and Matt does not have to scroll past it.

This applies to every artifact, mockup, plan page and diagram, in every session.

Full incident: `docs/CLAUDE-HISTORY.md#mockups-are-sketches-not-pitches`

## Send the Claude.ai handoff files WITHOUT being asked

He runs a second Claude.ai conversation alongside this one and feeds it the work for review. **A
claude.ai artifact URL is useless to it** - artifacts sit behind his account login, so there is
nothing for another chat to fetch, and sharing does not change that.

So whenever a turn produces or changes an artifact, a mockup, a diagram or a design doc, **end the
turn by sending the files, unprompted**:

- **the artifact as an IMAGE** (full page, not a crop) so the drawing survives - a markdown doc does
  not contain the picture
- **the artifact's own HTML file**, which is the literal complete thing
- **the repo doc**, if there is one
- **the public raw GitHub link** for anything on `main`, since that one a chat CAN read itself

Watch the size: `SendUserFile` rejects about 1 MB. A dark page with gradients goes smaller as JPEG
q90; a light page full of text goes smaller as PNG. Render full-page at `deviceScaleFactor: 1`.

Full incident: `docs/CLAUDE-HISTORY.md#send-the-claudeai-handoff-files-without-being-asked`

## Answer about the game you were asked about

When a session is asked to work on one game, the report is about THAT game. A pre-existing failure
somewhere else, a pattern another game shares, an unrelated red test — none of it belongs in the
reply, however true it is. Put it in the relevant `CLAUDE.md` if a future session needs it, and
leave it there.

Full incident: `docs/CLAUDE-HISTORY.md#answer-about-the-game-you-were-asked-about`

## Subagents: save USAGE (Matt, 2026-09-22)

The goal is lower usage (tokens billed), not a roomier context. Every subagent re-reads this file
(~17k tokens) before it starts, so a subagent ADDS usage unless it earns that back.

- **Delegate only big jobs**: reading many files, long suites, big docs, a whole build stage.
  A cheaper model doing the heavy reading beats Opus doing it, and the dumps stay out of the main
  session (which is re-read every turn).
- **Never delegate small jobs**: a lookup, a grep, a one-line edit, anything whose file and line
  you know. That overhead costs more than the job.
- **Always pass the cheapest `model` that can do it** (omitting it inherits the most expensive).
  Haiku: mechanical. Sonnet: specified work (screens, CSS, docs, probes). Opus: engine,
  persistence, judgment calls.
- **One agent, many tasks.** Never three agents where one would do. Write the full brief up front;
  back-and-forth turns multiply the cost.
- **An agent never pushes or touches `sw.js`/`version.json`/CACHE.** It commits on its own
  branch; you verify its result (never paste its report), merge, bump CACHE, deploy. Resume a
  cut-off agent with what is unverified; never restart it.

Baseball's stage process (worktrees, ports, stills): `baseball/CLAUDE.md`, "How a stage runs".
History: `docs/CLAUDE-HISTORY.md#subagents-save-usage-2026-09-22`

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
(`GET_VERSION` message to `navigator.serviceWorker.controller`) against the deployed version
(`version.json`, no-store). If they differ it renders `vN → vN+1` and marks itself stale.

**THERE ARE TWO CAUSES AND THEY LOOK IDENTICAL. Tell them apart before you do anything else.**

1. **The pill is not listening** (fixed 2026-09-01, `_watchForUpdates` in `js/hub.js`). The update
   ALREADY LANDED and the pill never noticed — `_initVersionPill` used to run once at load and
   nothing subscribed to the service worker's lifecycle, so a perfectly successful update could not
   reach the chip. **Tapping it made it worse**: the old `_forceUpdate` read the controller
   immediately after `reg.update()` (which resolves BEFORE the new worker activates), concluded
   "stale", and reloaded into the same screen. Only force-quitting cleared it.
2. **The shell install failed.** The atomic `cache.addAll(SHELL)` aborted — one 404 in the ~600 KB
   SHELL tier is enough — so `skipWaiting()` at the end of `install` never ran and the old worker
   kept serving the old build. `validate-sw-assets.mjs` and `test-sw-strategy.mjs` are the
   prevention/detection pair.

**The check that separates them, in that order:**

- **Is a `controllerchange` listener wired up?** If not, you are in case 1. `test-sw-update.mjs` is
  the regression probe — it drives a real deploy in a real browser and fails if the chip does not
  end up telling the truth on its own.
- **Do all the deployed SHELL entries answer 200?** Pull the deployed `sw.js`, evaluate its `ASSETS`
  + `isShellAsset` to get the SHELL list, and request every one against the live site. All 200 rules
  out case 2 entirely.

Since 2026-09-01 a new build also **applies itself silently** — the hub reloads onto it, but only on
the launcher, never while a game is mounted (`this.current` gates it, and a held update is taken in
`showLauncher`). So in normal use the pill should never show an arrow for more than a few seconds.
An arrow that persists is a bug, not a prompt.

**Much narrower since 2026-08-02** (see "The service worker's caching strategy" below): only the
~600 KB app shell is atomic, so a bad path in a game folder no longer strands a deploy; it warms
best-effort, logs loudly, and caches on demand instead. (`RESTORE.md` is a different thing — a
device-restore/data-custody runbook, not a service-worker diagnostic; see "The shared profile"
below for its role.)

Full incident and measured numbers: `docs/CLAUDE-HISTORY.md#diagnostic-the-version-pill-stuck-at-vn--vn1`

### Diagnostic: the launcher renders as raw unstyled HTML (fixed 2026-08-11)

Cause: the network-first handler treated only a THROWN fetch as failure, so an error RESPONSE (a
404 or 503) was handed straight to the page **even with a good cached copy one line away**. GitHub
Pages serves a redeploy by swapping the published tree, and a request landing in that window can
404 for a moment - so opening the hub DURING a deploy could get a 404 for `css/hub.css` and render
the launcher as raw HTML. Every deploy was a window for it.

Fixed in `sw.js`: `if (!res || !res.ok) return cached;` on the network-first path. Falling back is
also right for a genuinely removed file - this is an offline-first app whose cache is a coherent
snapshot of one deploy that rolls over when `CACHE` is bumped. A request with NOTHING cached still
passes the error through honestly rather than inventing an answer. `test-sw-strategy.mjs` carries
both as a [KNOWN-BUG PROBE] pair.

Full incident: `docs/CLAUDE-HISTORY.md#diagnostic-the-launcher-renders-as-raw-unstyled-html-fixed-2026-08-11`

### The service worker's caching strategy (rewritten 2026-08-02)

Both halves of `sw.js`'s strategy were tuned for a fast desktop connection and misbehaved on a
phone with poor service. The full rationale is in `sw.js`'s own comments; the shape, so a future
session doesn't "simplify" it back:

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
  re-downloading them,** via a **GENERATED `REST_MANIFEST` block in sw.js** - a content hash per
  REST file, written by `validate-sw-assets.mjs` from the bytes on disk (that script already runs
  before every deploy; `test-sw-strategy.mjs` fails if a stale manifest is about to ship). The
  warm diffs it against the manifest the previous deploy stored in its cache and copies unchanged
  files across; only genuinely changed files fetch. HTTP validators cannot do this: GitHub Pages
  re-stamps every file's mtime (and so its ETag) on every deploy, so a conditional request 200s
  the full body even for a file unchanged in weeks. A stale manifest is bounded: code is
  network-first at request time regardless, so stale bytes could only ever be served offline or
  past the deadline.
- **(2026-09-01) The REST tier (every game's own files) is served CACHE-FIRST; the shell stays
  network-first.** `cache: 'reload'` bypasses the browser's HTTP cache on purpose, so without this
  every module in a game's graph was re-downloaded in full on every open even when the game was
  already complete in the cache. The REST tier is the right boundary because it is already
  per-deploy versioned by `REST_MANIFEST` - a better freshness signal than an HTTP validator,
  since Pages re-stamps every ETag on every deploy. Navigations are excluded, so a game's
  standalone `index.html` is still fetched honestly. **The shell was left untouched by this
  change and split by the next one, the same day - see the bullet below.** **The cost, accepted
  and verified:** on the first hub load after a deploy, a game opened before the warm reaches its
  files runs the previous build's code for that one visit - already true offline, now briefly true
  online. Full write-up, including the Skeeball-side half of the fix, `skeeball/CLAUDE.md`, "What
  tapping Skeeball used to cost".
- **(2026-09-01) The SHELL is split: player-data modules stay network-first, everything else is
  cache-first.** Matt's call on the trade was *"keep the stats code fresh"* rather than cache the
  lot, so `NETWORK_FIRST` in `sw.js` names, by hand, every module that reads or writes player data
  or gates whether it is VISIBLE (rule 1); `SHELL_CACHE_FIRST` is the remainder, and the data
  modules load fresh BEHIND the painted launcher instead of in front of it. Two guards hold it
  together, both pinned by `test-sw-strategy.mjs`: it is an **allow-list derived from `ASSETS`**,
  which is the only formulation that cannot swallow `sw.js` (a cached `sw.js` freezes the version
  pill on "up to date" for ever); and membership is **per file, never transitive** - `js/hub.js`
  is cache-first and statically imports the network-first `js/profile-store.js`, which is correct,
  because ES modules are fetched per URL. A structural test fails the build if a cache-first shell
  module writes a `gamehub.*` key. The same change moved `hasName()` into `js/profile-store.js`
  and made `js/hub.js`'s `stats-net.js` and `name-gate.js` imports lazy - without that,
  `js/admin-config.js`'s static edge to `game-stats.js` kept 91 KB on the critical path regardless
  of what the cache did.
- **(2026-09-11) A third tier: LAZY — in `ASSETS`, but never downloaded until somebody opens the
  game that needs it.** The other two tiers both do the wrong thing for a large, game-specific
  file (e.g. Boggle's word lists): leaving it in REST downloads it for every install whether or
  not anyone plays that game, while taking it OUT of `ASSETS` entirely would drop it out of
  `REST_MANIFEST` and `CACHE_FIRST_PATHS` too, so a player who DOES play it would re-download it
  on every deploy. A LAZY path keeps everything `ASSETS` membership buys (`validate-sw-assets.mjs`
  still fails a deploy if the file is missing, it still carries a content hash, it is still
  cache-first and cached on demand by the fetch handler) and loses exactly one thing:
  **`warmRest()` never FETCHES it.** It still CARRIES IT FORWARD across a `CACHE` bump if the
  device already has a copy — the `isLazyAsset` check sits deliberately BELOW the carry-forward in
  the warm loop, and `test-sw-strategy.mjs` has a `[KNOWN-BUG PROBE]` for exactly that ordering.
  Pay once, on first play, then never again. **The cost, real and accepted: a device that has
  never opened that game can no longer play it OFFLINE** — the first round needs a connection; the
  failure path (`renderLoadError` / `load_error`) was already there since the fetch was always
  lazy at the JS level. **Only put a file in `LAZY` if it is BOTH large AND useless to anyone not
  playing that one game — never game CODE**, which is what a launcher tile opens, is small, and
  would undo the 2026-09-01 cache-first win.
- **(2026-08-23) Old caches are deleted at the END of the warm, not at activate.** They are the
  carry-forward copy source AND the fetch handler's fallback while the warm runs - deleting at
  activate opened a window on every deploy where games had no cache at all and every request
  queued behind the warm. Both fetch paths now consult the CURRENT cache before the global
  `caches.match` (which searches in cache-CREATION order and would otherwise let the older
  generation answer). At most one extra generation lingers, and only until the next completed
  warm.

`cache: 'reload'` is untouched — the fifth-playthrough HTTP-disk-cache fix it exists for is
orthogonal and still needed.

Full incident narrative and measured before/after numbers for every bullet above:
`docs/CLAUDE-HISTORY.md#the-service-workers-caching-strategy-rewritten-2026-08-02`

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
| `js/players-agg.js` | pure identity-graph aggregation of synced devices into per-person rows. **It exports no `headToHeadRows`** - that function was removed on 2026-08-11 with the screen it fed (see the note under "Where the deep docs live"); this row went on naming it until 2026-09-09 |
| `js/game-stats-ui.js` | "My Stats" overlay |
| `js/leaderboard-ui.js` | "Leaderboards" overlay (DOM only); wins-only display, rating retired from it (2026-07-23); multiplayer wins show as a per-game VS chip on that game's board, NOT as head-to-head on the player detail (2026-08-11 - this row said the opposite until 2026-09-09); a game's own board ranks by DIFFICULTY TIER first and score second (2026-09-08); an admin-only game is off By Game and has no board, while its wins still count in every cross-game total (2026-09-09); it OPENS on By Game / Most played, and a board opens on its own leftmost sort (2026-09-11); on EVERY board the headline number is the one you sorted by, Tic Tac Toe's and Snake's bespoke split cards included (2026-09-11) |
| `js/leaderboard-rank.js` | pure, headless-testable rating/ranking maths (kept for a future rating page; not shown on the leaderboard since 2026-07-23), plus the board comparators the leaderboard DOES use (`compareBoardMetric`, `compareTierFirst`) |
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
| `js/admin-config.js` | (2026-08-24) the app-wide **admin config** (`adminConfig/v1` in Firebase): which games are live for everyone and which Skeeball machines are open to everyone. Pure resolvers over a localStorage cache, so every reader is synchronous and offline-safe; an absent override always falls back to the code default. Since 2026-09-12 it also carries the **device reset** (`deviceResets/<statsId>`), the one thing in this repo that clears a player's history - see "Deleting a device's history" below |
| `js/stats-corrections.js` | (2026-08-24) the read-time **score corrections** layer: "those scores were thrown on a machine that was broken at the time." Pure overlay maths applied when a number is DISPLAYED (leaderboard, My Stats, Skeeball's own backboard); the raw record is never touched, and a score thrown after the correction counts normally |
| `js/admin-ui.js` | (2026-08-24) the **admin control page** itself (Matt only, lazily imported): the game live/admin-only switches, the Skeeball machine releases, and this-device tools. See "The admin control page" below |
| `js/announce.js` | one-time launcher announcements: the entries, the seen-list (`gamehub.announce.v1`), and the pure "does this device still owe one" decision. Each entry's `until` date retires it |
| `js/announce-ui.js` | the announcement popup (DOM only) |
| `js/challenge/` | retired challenge system — still load-bearing (`hub.js` imports its `hooks.js` on every load; do not delete) |
| `js/push.js` | (2026-09-23) push notifications, the app's half: `pushState()`, `enablePush()` (asks permission inside the tap), `disablePush()`, `refreshPush()` on every hub load; stores each device's address at `pushSubs/<PLAYER CODE>/<key>`. See "Push notifications" below |
| `js/career-store.js` | (2026-09-12) Baseball's shared career sync store (BB-0-phase-0-handoff.md): the `careers/<CODE>/baseball/{live,history,forks}` node, `reconcile()`'s none/adopt/push/fork decision, `mintCareerId()`, `newCareerDoc()` and `careerSyncHealth()`. Its one consumer since R15-A (2026-09-22) is `baseball/js/career-io.js` |

### Where the deep docs live

- **`js/CLAUDE.md`** — the full module map and Firebase layering, THE LAW's full working rules,
  the multiplayer lockstep invariants, the leaderboard rating model, sync health (and how to
  diagnose "my history is missing"), the per-player store split ("whose stats are these"), the
  Ana/Natalia correction record, head-to-head capture, the shared-profile contract with
  Monopoly Deal's must-stay-synced duplicates, and the Report a bug pipeline (what it collects,
  where it lands, how Matt reads it, and how to add the next announcement).
- **`<game>/CLAUDE.md`** — each game's own docs (see the games table).

**Head-to-head: still RECORDED, deliberately not DISPLAYED.** `recordHeadToHead()` is still called
by Chinchón, Escoba, Filler and Mancala and still writes an `h2h` branch into every record, but
nothing reads it back. **That is a decision, not a gap**: the screen it fed shipped and was removed
the same day, 2026-08-11, because a cross-game head-to-head total is "not a fact anyone wanted" -
`js/CLAUDE.md`, "Multiplayer on the leaderboard: on the GAME'S page, per game", which opens *"Read
this before adding anything h2h-shaped again"* and is the file to read before proposing one. What
replaced it is the per-game **VS chip** on a game's own board. The recorder and the stored `h2h`
stay (rule 5). Two rows of the module table above went on describing the removed screen for four
weeks: **when a screen is removed, grep the module table for what fed it.**

- **`docs/BUILDING-A-GAME.md`** — the UX floor every game's UI must meet, the module contract,
  the "Adding a game" checklist, and screen/cross-game patterns (how-to-play screens, setup
  defaults, viewport-fit-by-measurement, physics-tunnelling prevention). Auto-loaded by a skill
  on new-game work or any game UI/CSS/input change — see "The module contract" below for what
  moved there and why.
- **`VISUAL-PROCESS.md`** — the procedure for verifying a screen actually looks and plays right
  (as opposed to the rules it must satisfy, which live in `docs/BUILDING-A-GAME.md`).

### Dev tooling (repo root, not deployed)

Full descriptions, incident history and flags for every script: **`docs/DEV-TOOLING.md`**. Read
a tool's row there before running or changing it. Add a new tool there AND here.

**Must-know rules:**
- **Run `node validate-sw-assets.mjs` before every deploy** (0.2 s). It checks `sw.js` `ASSETS`
  both ways, rewrites the generated `REST_MANIFEST` and writes `version.json`; commit `sw.js`
  after changing any game file.
- **Never run `run-all-tests.mjs` unless Matt asks for it by name.** Run only the suites covering
  the files you changed.
- **`test-visual.mjs`: never `--all` without asking Matt.** Default checks only what changed.
- **Run `backups/rtdb-backup.mjs` before ANY Firebase write, rules change or schema change.**
- **Firebase-writing scripts are Matt-only, dry-run by default** (`clear-skeeball-stats.mjs`,
  `delete-test-players.mjs`, `delete-device-record.mjs`, `fix-natalia-record.mjs`). Never run
  them with `--write` on your own judgement.
- **Never hand-edit generated files** (`js/emoji-data.js`, `js/emoji-search-*.js`,
  `boggle/data/words-es.txt`, `baseball/models/*`, sw.js's `REST_MANIFEST`); re-run the generator.

**Index:**
- Server: `server.mjs`
- Service worker: `validate-sw-assets.mjs`, `test-sw-strategy.mjs`, `test-sw-update.mjs`
- Stats / data safety: `players-agg.test.mjs`, `test-recorder-contract.mjs`,
  `test-stats-replay.mjs`, `test-stats-identity.mjs`, `test-stats-corrections.mjs`,
  `test-rate-guard.mjs`, `test-leaderboard-rank.mjs`, `test-admin-config.mjs`
- Hub features: `test-new-badge.mjs`, `test-emoji.mjs`, `test-messages.mjs`,
  `test-bug-report.mjs`, `test-career-sync.mjs`, `test-push.mjs`
- Cross-game: `test-game-conventions.mjs`, `test-visual.mjs`, `check-no-scroll.mjs`,
  `test-mp-lockstep.mjs`, `run-all-tests.mjs`
- Generators: `build-emoji-data.mjs`, `build-boggle-es.mjs`, `convert-kenney.mjs`
- Boggle: `tune-boggle-es.mjs`, `test-boggle-es.mjs`
- Baseball: `sim-baseball.mjs`, `sim-baseball-career.mjs`, `glb-info.mjs`, `render-actor.mjs`,
  `test-baseball-actors.mjs`, `test-baseball-career.mjs`
- Skeeball: `tune-ladder.mjs`, `measure-arc.mjs`, `sight.mjs`, `measure-reach.mjs`,
  `sweep-mover.mjs`, `measure-gallery.mjs`, `test-runaway-capped.mjs`,
  `test-brickcity-stall.mjs`, `test-brickcity-corner100.mjs`, `test-brickcity-throat.mjs`,
  `test-skeeball-popup.mjs`
- Pinball: `sweep-pinball-rests.mjs` · Golf: `sheet-course.mjs`, `measure-hole-strip.mjs` ·
  Yahtzee: `test-yahtzee-ai.mjs`
- Matt-only readers: `read-install-state.mjs`, `read-bug-reports.mjs`, `read-device-reports.mjs`
- Firebase writers (see rules above): `backups/rtdb-backup.mjs`, `clear-skeeball-stats.mjs`,
  `delete-test-players.mjs`, `delete-device-record.mjs`, `fix-natalia-record.mjs`

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
| Baseball | in-hub `module:`, immersive, **a real three.js stadium with the reference game's three cameras (R1, 2026-09-20, being rebuilt as a clone of Baseball 9's mechanics per `docs/BASEBALL-REFERENCE-B9.md`); career is phase 4; `devOnly`** | `.bb-root` / `.bb-` | `gamehub.baseball.v1` | `recordBaseball` |
| Brick Breaker | in-hub `module:`, immersive, **solo score attack** (clone of Neon Breakout, released 2026-09-23) | `.bx-root` / `.bx-` | `gamehub.brickblitz.v1` | `recordBrickBlitz` |
| Ball Run | in-hub `module:`, immersive | `.br-root` / `.br-` | `ballrun.*` (frozen gen-1 dotted keys) | `recordBallRun` |
| Battleship | in-hub `module:`, immersive, **multiplayer** (`gamehub.battleship.mp.v1`, the repo's first hidden-information game) | `.bs-root` / `.bs-` | `gamehub.battleship.v1` | `recordBattleship` |
| Boggle | in-hub `module:`, **multiplayer** (`gamehub.boggle.mp.v1`), **bilingual gameplay** (EN/ES word list + dice, chosen on the setup screen) | `.bg-root` / `.bg-` | `gamehub.boggle.v1` | `recordBoggle` |
| Chinchón | in-hub `module:` | `.cc-root` / `.cc-` (many rules still bare-prefixed) | `chinchon-settings` (frozen gen-1) | `recordChinchon` |
| Course Creator | launch-out `href:` (`hole-editor/?course=new`), **`devOnly`, opened to chosen players by player code from the admin page** (2026-09-24); records no stats, so no GAME_META row | n/a (own page) | its own `golf.holeEditor.*` keys | none |
| Connect Four | in-hub `module:` | `.cf-root` / `.cf-` (many rules still bare-prefixed) | `gamehub.connect4.v1` (+ `gamehub.connect4.save.v1` autosave) | `recordConnect4` |
| Dominoes | in-hub `module:` | `.dm-root` / `.dm-` | `gamehub.dominoes.v1` | `recordDominoes` |
| Dots and Boxes | in-hub `module:`, **multiplayer** (`gamehub.dotsboxes.mp.v1`) | `.db-root` / `.db-` | `gamehub.dotsboxes.v1` | `recordDotsBoxes` |
| Escoba | in-hub `module:`, immersive, **multiplayer at 2-4 seats** (save key `escoba-save`, MP field) | `.eb-root` / `.eb-` | `escoba-settings` (frozen gen-1) | `recordEscoba` |
| Filler | in-hub `module:`, **multiplayer** (`gamehub.filler.mp.v1`) | `.filler` / `.fl-` (pre-convention root class, frozen) | `gamehub.filler.v1` | `recordResult('filler', …)` |
| Connect 4 Hoops | in-hub `module:`, immersive, **multiplayer, two protocols** (live rooms via `js/net.js`; turn-by-turn via `hoops/games/<id>`, its own node), **admin only** (`devOnly`) | `.h4-root` / `.h4-` | `gamehub.hoops4.v1` | `recordResult('hoops4', …)` |
| Hill Climb | in-hub `module:`, immersive | `.hc-root` / `.hc-` | `gamehub.hillclimb.v1` | `recordHillClimb` |
| Mancala | in-hub `module:`, immersive, **multiplayer** (`gamehub.mancala.mp.v1`) | `.mancala` / `.mc-` (pre-convention root class, frozen) | `gamehub.mancala.v1` | `recordResult('mancala', …)` |
| Monopoly Deal | launch-out `href:` (in-repo `business-deal/`, own nested SW) | n/a (own page) | its own keys | `window.__ghStats` → `'business'` |
| Nuts & Bolts | in-hub `module:` | `.nb-root` / `.nb-` | `gamehub.nutsbolts.v1` | `recordNutsBolts` |
| Pool | in-hub `module:`, immersive, **multiplayer** (`gamehub.poolv2.mp.v1`) | `.p2-root` / `.p2-` | `gamehub.poolv2.v1` (frozen; see its file) | `recordResult('pool', …)` |
| Parchís | launch-out `href:` (built from sibling `../Parchís/`) | n/a (own page) | `parchis_r2_prefs` | `window.__ghStats` → `'parchis'` |
| Pinball | in-hub `module:`, immersive, **admin only** (`devOnly`) | `.pb-root` / `.pb-` | `gamehub.pinball.v1` | `recordPinball` |
| Skeeball | in-hub `module:`, immersive, **solo** (unlockable machines, no opponent) | `.sk-root` / `.sk-` | `gamehub.skeeball.v1` | `recordSkeeball` |
| Snake | in-hub `module:` | `.sn-root` / `.sn-` | `gamehub.snake.v1` | `recordSnake` |
| Sudoku | in-hub `module:` | `.sd-root` / `.sd-` | `gamehub.sudoku.v1` | `recordSudoku` |
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
- **Push notifications for new messages since 2026-09-24** (`messagePush` in `functions/index.js`,
  see "Push notifications" below); a tap opens that conversation. The badge still works as before.
- **Messages has the top bar's third button since 2026-08-31, where My Stats used to be.** Matt: *"I
  don't think My Stats is used by anyone... we could change it into a Messages button?"* Four buttons
  wrap to a second row on a phone (measured), so it was a swap or nothing. **My Stats moved to the
  profile page** and is unchanged; every screen it shows is ALSO reachable at Leaderboards → your own
  row → a game, which is what keeps a player's full win/loss record visible (rule 1 — the leaderboard
  itself is wins-only by design). Nothing was removed.
- **Two badges, one per button.** Unread messages badge the Messages button; a reply to a bug report
  badges the profile pill. They were summed onto the pill while it was the only route to either.
  **On Matt's own devices the Messages badge also counts new BUG REPORTS** (2026-09-21, after one
  sat unseen for twelve days): the inbox moved inside the Messages screen on 2026-09-01 and its
  count went with it, so nothing on the launcher said a report had arrived. A badge goes where the
  thing it counts is reached - `js/CLAUDE.md`, "A new report has to be VISIBLE from the launcher".
- **A "Send message" button sits on a player's leaderboard detail screen.** Hidden on your own row,
  and on a legacy record with no player code (a message is addressed to a code, so a dead button
  would be worse than none). Full contract and the node shape: `js/CLAUDE.md`, "Messages".

## The profile page's structure (2026-08-31)

It had FOUR container patterns at once — a card with a heading, a card that was itself a
collapsible, collapsibles nested inside a card, and three loose buttons in no card at all. Now:

**You** (identity only) · **Messages** · **Settings** (one list of collapsible rows) · **Your
devices** · **Help** · **Reset profile**, alone at the bottom.

- **One pattern**: every block is a `.pf-section` card. The only collapsibles are the rows inside
  Settings, and they are one level deep (`.pf-rows > details`).
- **Colour, theme and quick chat moved OUT of "You"** into Settings; they are settings, and having
  them there is what made that card a grab-bag.
- **Language joined Theme in Settings.** It had only ever been in the hub's top bar, so the two
  halves of one choice lived on different screens.
- **"Message for other players" is now "Your tagline".** It is a line on your own leaderboard page,
  and the old label read as the Messages feature two cards below it.
- **My Stats and the two Help buttons share one full-width row-button style** (`.pf-linkbtn`). They
  were three different widths, centred, in no container. **Copy, Link and + Add opponent
  (`.pf-add`) were unified with them** — they were the page's last odd style, a dashed accent
  outline on transparent against solid filled rows everywhere else. Only their widths still differ.

**`messages/` is the ONE node in this database with real security rules on it** (only admin can
see every thread; everyone else only their own). Everything else is `auth != null`. A device
claims `msgAuth/<auth.uid> = <its player code>`, and the rules scope every read to threads that
code is in; `admins/<auth.uid>` (which already existed, set by hand in the console) grants Matt
the read-all. **It does not survive somebody who has another player's 5-character code and opens
developer tools** - that code is printed on the profile page, so it is not a secret and cannot be
made one.

Full incident: `docs/CLAUDE-HISTORY.md#the-profile-pages-structure-2026-08-31`

Two knock-on effects, because a granted ancestor `.read` cascades and cannot be revoked below:

- **The root `.read`/`.write` are now `false` and every branch is enumerated in
  `database.rules.json`.** Add a new top-level node there or it is unreachable.
- **`backups/rtdb-backup.mjs` reads branch by branch now**, from a `BRANCHES` list that must stay in
  step with that file, and it CANNOT read `messages/` (it signs in anonymously). It says so loudly
  rather than recording an empty branch. Export that node from the Firebase console.

**The rules are published by hand** (console → Realtime Database → Rules → paste → Publish); no
script in this repo deploys them. Deploy the app first, the rules second: a device claims itself on
its next hub load.

**`hoops` was PUBLISHED by Matt on 2026-09-22** and Connect 4 Hoops' turn-by-turn multiplayer has
worked since (he confirmed it the same session, and has played challenges through it). The node is
`hoops/games/<id>` plus a per-player index.

**This row said "OUTSTANDING, has NOT been published" for the rest of that day, and a later session
repeated it back to Matt as a thing he still owed.** It was written in the commit that ADDED the
branch to `database.rules.json` - correct at that minute, wrong an hour later, and nothing made it
false. **When a step is "Matt pastes this into a console", the line recording it is stale the
moment he does, and only this file can be updated to say so.** Write such a line with the date it
was true, and close it the moment it is done.

## Deleting a device's history, and the rate gate (2026-09-12)

**This session raised THE LAW and Matt overruled it, in these words:** *"It's my game, I control
every aspect of it. if theres a rule somewhere that doesn't allow for it, i can change the rules.
The rules are for YOU. so YOU cannot decide to do anything that violates the rules. I can decide to
do anything I want."* That is the authority for the delete described below, and it is the ONLY
thing that authorises it. **It does not generalise**: a session must still never delete player
data on its own judgement, or to tidy something up, or because a cheat seems obvious. Matt asks,
personally, per incident, or it does not happen. The restorable copy is
`backups/rtdb-2026-09-12T22-08-55-909Z.json`. Full incident (the TP cheating report, measured
numbers): `docs/CLAUDE-HISTORY.md#deleting-a-devices-history-and-the-rate-gate-2026-09-12`

Three pieces, and the first two only work together:

1. **The server-side delete** - `delete-device-record.mjs`, above.
2. **The device reset** (`adminConfig/v1/deviceResets/<statsId>`, `js/admin-config.js`;
   `applyDeviceReset()` in `js/stats-net.js`). Deleting `players/<id>` on its own achieves nothing
   durable: `syncMyStats()` sends `stats: loadStats()`, the device's ENTIRE local store, and writes
   it back over that node on the next hub load. So the device is told, through the config it
   already reads once per load, to drop its own copy - and `applyDeviceReset()` runs INSIDE
   `syncMyStats()`, before the record is built, because that is the only placement that guarantees
   the ordering. It is a **stamp compared against a local ack**, not a flag: each stamp is acted on
   exactly once, so the player can build a fresh history afterwards instead of being wiped on every
   load for ever. It clears the ACTIVE player's stats store only - not the profile, not any game's
   settings, not a second person's forked store on the same phone.
3. **The rate gate** - "No human plays this fast", `js/game-stats.js`. **Rate is the only thing
   every game here has in common.** Hill Climb could be checked properly because its coins have a
   conservation law (`hill-climb/js/store.js`, "The books must balance"); a "win" in Tic Tac Toe is
   just a counter and no arithmetic distinguishes a real one from a typed one - but a counter
   cannot hide how fast it moved. 30 results per game per minute, refused before the store is read,
   nothing queued. **The threshold is calibrated on the FASTEST HUMAN, not the slowest bot**: a
   person sprinting at Beginner Tic Tac Toe takes 5-8 s a game, so the gate sits 3-4x above anyone
   here. That headroom is deliberate and must not be narrowed - one honest play refused costs more
   than a hundred bot results getting through (rule 1). Every refusal is counted and rides the
   stats mirror as the `rate` child node, the same additive-diagnostic shape as `device` and
   `announce`, so an attempt is VISIBLE even when a slower bot gets past.

**Say plainly what this does not do.** A bot that sleeps two seconds between games walks past the
gate, and nothing client-side can stop somebody typing a number straight into localStorage - there
is no game server here, and every score is written by code the player controls. What exists now is
a floor against unattended grinding, an arithmetic check where a real invariant exists, and the
ability to see it and undo it afterwards. Do not describe any of it as making the hub cheat-proof.


## Push notifications (2026-09-23)

Matt: *"are you sure there's no way to have real notifications or something close to it?"* ...
*"mostly iphone, installed. go with firebase."* Real Web Push. **Three triggers since 2026-09-24**:
`hoopsTurnPush` (Connect 4 Hoops challenges/turns/results), `messagePush` (a new message, from
`messages/index/<me>/<them>` - only a newer `at` FROM them notifies; a tap opens that thread) and
`bugReportPush` (a new `bugReports/<id>`, to every code whose uid is in `admins/`, found through
`msgAuth/<uid>` - no code is hardcoded; a tap opens the bug inbox). **A change to `functions/` is
live only after Matt re-runs `firebase deploy --only functions`** - merging to main does nothing
for it.

- **Three pieces.** `js/push.js` subscribes a device (permission is asked INSIDE the tap - iOS only
  prompts for a user gesture) and stores it at `pushSubs/<PLAYER CODE>/<key>`; **`functions/`** is a
  Firebase Cloud Function (`hoopsTurnPush`) that watches `hoops/index/<code>/<gameId>` and sends;
  `sw.js` shows every push (never silently: Safari revokes a site that does) and opens the game on
  a tap (`?open=<game>`, or an `OPEN_GAME` message to an open hub - never pulling a player out of
  another game).
- **The sender needs a PRIVATE key, so it cannot live in the app.** It is the Firebase secret
  `VAPID_PRIVATE_KEY`; its public half is in `js/push.js` and `functions/index.js`, and
  `test-push.mjs` fails if the two differ. It is NOT in this repo and must never be.
- **The function is deployed by hand from Matt's PC** (`functions/README.md`, `firebase deploy
  --only functions`); GitHub Pages never serves `functions/` (`validate-sw-assets.mjs` skips it).
  A change there ships only when that command runs. **It needs the Blaze plan.**
- **iPhone: only the Home Screen app can get them (iOS 16.4+).** In a Safari tab `PushManager`
  does not exist; `pushState()` returns `'install'` and both screens say what to do instead.
- **Where a player turns it on:** the Connect 4 Hoops multiplayer screen ("Notify me when it's my
  turn"), the Messages screen ("Notify me of new messages"), both shown only while it is off, and
  profile -> Settings -> Notifications (on/off, per device). **And Hoops ASKS** (Matt, 2026-09-24):
  right after a move of yours is sent in a turn-by-turn match, "Want a notification when <them>
  plays back?" - once per match (`gamehub.hoops4.pushAsk.v1`), only while it is off.
- **Who is notified, decided in `functions/decide.js` (pure):** a challenge arriving, the turn
  coming back, a series game the other person started, and a match the other person ended. Never
  your own action: `createGame` stamps `by` on the match (optional field) so its maker is not told.
- **`pushSubs` rules: PUBLISHED by Matt on 2026-09-24** (verified the same day: `pushSubs/<code>`
  reads succeed, and `players/`, `hoops/`, `adminConfig/`, `usernames/` still read normally). The
  only change from the rules live before was adding `pushSubs`; a diff proved nothing else moved.
- **CONFIRMED WORKING END TO END on 2026-09-24**: test1 (laptop Chrome) took a turn and Matt's
  iPhone (Home Screen app) showed "Connect 4 Hoops from Game Hub / Your turn vs test1". It did not
  buzz only because the phone was on Do Not Disturb, which delivers silently. Each player must turn
  notifications on themselves, on each phone.
- **The Cloud Function `hoopsTurnPush` was DEPLOYED by Matt on 2026-09-24** (Blaze plan, us-central1,
  Node 22 2nd gen, image cleanup policy 1 day). Usage measured that day, before deciding: database
  9 MB stored of 1 GB free, ~21 MB/day downloaded of ~360 MB/day free, 7 connections - so Blaze
  costs $0 here. Blaze was taken with Google's $300 free-trial credit; **if notifications stop
  around late December 2026, the trial ended and the billing account needs "activating"** (not
  certain; check that first).
- **Matt's local `Game-Hub/` folder is stale** (he works through cloud sessions on GitHub now), so
  deploy from a separate sparse clone, `C:\Users\powel\game-hub-deploy` (steps in
  `functions/README.md`). **Give Matt deploy steps in the chat, in full, not as a pointer to that
  file** - he asked for exactly that. The masked prompt of `functions:secrets:set` ignored a paste
  in PowerShell (saved an empty value, refused); `--data-file` from a temp file worked.
- A subscription is a delivery address, not player history: the function removes one the phone
  has dropped (404/410), and the player recreates it with one tap.

## The admin control page (2026-08-24)

Both switches existed before this; both were SOURCE EDITS. Hiding a game meant `devOnly: true` in
`js/hub.js`, a `GAME_META` edit, a test-list edit, a `CACHE` bump and a deploy — Skeeball went
through that cycle three times in three days (released 08-22, pulled back 08-23, re-released 08-24).
Releasing one Skeeball machine early was not possible at all: a machine is opened by earning it, and
the only bypass was the dev profile.

The launcher's **🛠️ Admin** button (rendered for Matt only, beside the bug inbox) opens
`js/admin-ui.js`, which writes `adminConfig/v1` through `js/admin-config.js`. Every device reads that
node once per hub load and caches it locally.

**It is written for ONE reader** — Matt — so the page is four COLLAPSED accordion sections (Games,
Skeeball machines, Player scores, This device; open state remembered in `gamehub.adminOpen.v1`),
no explanatory prose, and **no Default buttons** — an override that matches the code default is
the same thing, and "default" was a concept that existed nowhere but that button.
`setGameLive(id, null)` / `setBoardMode(id, null)` still clear an override from code if a future
screen needs it.

- **An override sits ON TOP of the code default, it does not replace it.** An absent entry means
  "whatever `js/hub.js` says". A wiped, unreachable or never-written config leaves the app behaving
  exactly as it does today — which is also why a config failure can never take a released game off
  the family's launcher (THE LAW rule 1).
- **A Skeeball machine has THREE states, and all three are READ-TIME ONLY**: **Open** (everyone
  plays it now), **Unlockable** (live, earned the normal way), **Testing** (nobody but a dev
  profile). Testing overrides `boards.js`'s `adminOnly` the same way a game's live switch overrides
  `devOnly`, so moving a machine to Unlockable really does make it earnable. `skeeball/js/ui.js`
  ORs `isBoardReleased(id)` with the player's earned `isUnlocked(...)` and nothing writes
  `sk.unlocked`, so nobody is ever credited with an unlock they did not earn — and moving a machine
  back only DECLINES TO HONOR an earned unlock while it is set, never deletes it (rule 2).
- **Every write verifies by fresh re-read and fails loudly** (rule 6). A dev origin never writes the
  family's config at all, same guard and same opt-in key as `js/stats-net.js`.
- **An admin-only game is now hidden from the LEADERBOARD as well as the launcher (2026-09-09).**
  `isGameOnLauncher(statsId)` in
  `js/game-stats-ui.js` is the hub card's own rule (`isGameLive(id, !devOnly) || dev`) exported once,
  so the launcher and the board cannot disagree; `js/leaderboard-ui.js` filters By Game through it
  and refuses to render a board for a game it hides. **Three things are deliberately NOT filtered
  with it, each a rule 1 failure if they ever are**: `GAME_META` itself (`ALL_IDS`/`COMP_IDS` are
  built from it, so filtering there would silently drop those wins out of every cross-game total),
  the player-detail game list, and the stored data. **A RETIRED build is hidden by the same helper**
  (`retired: true` on its TABS row - `poolv2` is the only one): it has no `js/hub.js` registry entry
  at all, so `isGameOnLauncher`'s `isGameLive` default assumed a row that does not exist and put the
  retired Pool build on the board while the current Pool was hidden. That one flag now drives the
  leaderboard, the launcher answer and `gameChoices()`'s bug-report picker, replacing a hardcoded
  id check. It deliberately does NOT hide the My Stats tab. `visibleTabs()` in the same file keeps its own,
  MORE PERMISSIVE rule on purpose - a game hidden by an override still has its My Stats screen, so a
  player's own record of a game Matt has pulled back stays reachable. Do not unify the two.
- **A hidden game can be opened to NAMED PLAYERS (2026-09-24, the Course Creator).**
  `games/<id>/allow/<PLAYER CODE> = true`, written by `setGameAllowed` (verified re-read, no
  `at`/`by` stamp inside the map), read by `isGameAllowed(id, code)`; the launcher shows a tile when
  `isGameLive || dev || isGameAllowed`. It only ever ADDS viewers; the picker (chips, one per coded
  person) shows on a game's admin row only while that game is Admin only, and only for ids in
  `ALLOW_PICKER` in `js/admin-ui.js`. **It hides the TILE, not the page**: the editor's URL still
  opens for anyone who has it (nothing client-side could stop that).
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
- **Scores thrown on a broken board can be voided, per player, per machine.** The page's **Player
  scores** section marks a machine's scores as not counting for one player. It is an OVERLAY in
  `adminConfig/v1`, applied
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
Full incident narrative and quotes: `docs/CLAUDE-HISTORY.md#the-admin-control-page-2026-08-24`

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
