> **Not auto-loaded.** This is the full text of the root `CLAUDE.md` as it stood on 2026-10-14, moved here word for word when that file was trimmed. `CLAUDE.md` holds the current rules in short form; this file holds the incidents, measurements and reasoning behind them. Read the relevant section here before changing anything it covers in depth. Section headings are unchanged, so references like `CLAUDE.md, "Push notifications"` can be found here.

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

## No sound, ever (Matt, 2026-10-05)

**No game in this hub plays sound. Do not add sound, music, sound effects or an audio option to any
game, new or old, unless Matt asks for it himself, in his own words, for that game.** Matt: *"NO
SOUND FROM ANY GAME EVER. UNLESS SPECIFICALLY DIRECTED TO BY ME. NEVER SOUND."* That covers
suggesting it as polish, too. As of that date nothing in the repo constructs an `AudioContext` or an
`Audio` element, and it stays that way. (Pinball's sound option was deleted on 2026-08-11 for the
same reason.)

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
orthogonal and still needed. **(2026-10-14) The SHELL install uses it too, always** (it used to only
with `PURGE_ALL_CACHES`): Pages sends `max-age=600`, so two deploys ten minutes apart installed the
previous build's `js/game-art.js` under the new cache name, and cache-first kept it for the whole
build (Matt's phone showed the old Arrow Maze tile at v1132). `test-sw-strategy.mjs` probes it.

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
| | **(2026-10-11) Also notes WHEN each game is played** (`gamehub.activity.v1`: per player store, per game `{first, last, w: {<Monday>: plays}}`), stamped at the rate gate every recorder passes, its own key so the stats shape is untouched, mirrored as `players/<id>/activity` (omitted, never null, when empty). A report only: nothing reads it but `read-activity.mjs`. Nothing before that date exists |
| `js/game-stats-global.js` | non-ESM recorder port for Monopoly Deal/Parchís (`window.__ghStats`) |
| `js/firebase-boot.js` | the ONE bootstrap for the named `'stats'` Firebase app |
| `js/stats-net.js` | Firebase mirror to `players/<id>`; username registry; `syncHealth()` |
| `js/players-agg.js` | pure identity-graph aggregation of synced devices into per-person rows. **It exports no `headToHeadRows`** - that function was removed on 2026-08-11 with the screen it fed (see the note under "Where the deep docs live"); this row went on naming it until 2026-09-09 |
| `js/game-stats-ui.js` | "My Stats" overlay |
| `js/leaderboard-ui.js` | "Leaderboards" overlay (DOM only); wins-only display, rating retired from it (2026-07-23); multiplayer wins show as a per-game VS chip on that game's board, NOT as head-to-head on the player detail (2026-08-11 - this row said the opposite until 2026-09-09); a game's own board ranks by DIFFICULTY TIER first and score second (2026-09-08); an admin-only game is off By Game and has no board, while its wins still count in every cross-game total (2026-09-09); it OPENS on By Game / Most played, and a board opens on its own leftmost sort (2026-09-11); on EVERY board the headline number is the one you sorted by, Tic Tac Toe's and Snake's bespoke split cards included (2026-09-11) |
| `js/arrow-maze-time.js` | (2026-10-13) Arrow Maze's timer, pure: the mistake/hint time penalties, the m:ss clock and the finish-list reader; since 2026-10-14 also the LADDER's bands (Easy 1-50, Medium 51-100, Hard 101-200, Expert 201 on) and POINTS (`WO_BAND_POINTS`: Easy 1, Medium 2, Hard 4, Expert 6 a level; `woPoints`), the leaderboard's number. Also RUSH's clock numbers, weeks (`woWeekKey`, Monday UTC) and run readers. Used by the game, `js/game-stats.js`, `js/players-agg.js`, My Stats and the leaderboard. Network-first (`way-out/CLAUDE.md`, "The ladder and points") |
| `js/gridlock-points.js` | (2026-10-14) Gridlock's ladder bands, stars (`glStars`), crowns and points (`glPoints`; a hint halves a level's points), read from the per-level maps (ladder 1's `gl.lv` through `js/gridlock-v1map.js`, ladder 2's `gl.lv2`), so a replay or a second phone never adds points. Used by the game, `js/game-stats.js`, `js/players-agg.js`, My Stats and the leaderboard. Network-first (`gridlock/CLAUDE.md`) |
| `js/leaderboard-rank.js` | pure, headless-testable rating/ranking maths (kept for a future rating page; not shown on the leaderboard since 2026-07-23), plus the board comparators the leaderboard DOES use (`compareBoardMetric`, `compareTierFirst`) |
| `js/game-art.js` | single source of every hub tile's inline SVG art, keyed by hub id; `hub.js` and `leaderboard-ui.js` both read it |
| `js/difficulty-tiers.js` | READ-path mapping of difficulty vocabularies onto the 1-4 tier scale |
| `js/arcade-scores.js` | shared high-score + unlock layer for the arcade-cabinet games (Skeeball): per-board bests, date-keyed daily bests, unlocks, app-wide records |
| `js/net.js` | multiplayer room layer (`rooms/<CODE>`) used by Chinchón, Escoba, Tic Tac Toe, Mancala, Filler, Dots and Boxes, Boggle, Yahtzee, Battleship, Texas Hold'em and Air Hockey (lobby only; its real-time play is `air-hockey/js/live.js`); its N-seat half (`joinSeat`/`vacateSeat`/seat-addressed recovery) is used by Chinchón, Escoba and Texas Hold'em (8 seats) |
| `js/online-gate.js` | (2026-10-08) who may play ONLINE: `onlineGate()` for this device, `codeMayPlayOnline(code)` for an opponent, `onlineGateText(err)` for the words. Checked inside `js/net.js`'s create/join and every challenge `createGame`; the list itself is `ONLINE_BEFORE` + `online/<CODE>` in `js/admin-config.js`. See "Online play needs an account Matt has let in" below |
| `js/a2hs.js` | add-to-home-screen bottom sheet |
| `js/device-report.js` | the identity/storage dump. Its profile-page button was RETIRED 2026-08-11 (Report a bug supersedes it and sends the same payload); `gatherDeviceReport()` is still load-bearing, called by every bug report |
| `js/install-state.js` | (2026-08-11) installed-app vs browser tab, in one small object. Shared by `stats-net.js` (mirrors it to `players/<id>/device` every sync) and `bug-report.js` - one answer, never two. **Since 2026-10-11 it also carries the phone's SIZE** (`screen: {w, h, vw, vh, dpr}`, CSS px, short side first) - an iPhone's user agent says only "iPhone" and Chrome calls every Android "K", so this is the only way to know what phones people play on. `node read-install-state.mjs --screens` lists every person by games played with their phones' sizes; read it before spending effort on (or dropping) a phone size |
| `js/bug-report.js` | (2026-08-11) "Report a bug": the device/browser/PWA/network/SW picture plus the whole Device Details payload, written to `bugReports/` (screenshots to `bugReportShots/`), with an offline outbox that retries itself. Since 2026-08-13 it also carries Matt's **replies** — written to the report AND to `bugReplies/<reporterDeviceId>/`, which is the copy the player reads — and a soft delete that clears his inbox without touching either record |
| `js/messages.js` | (2026-08-31) player-to-player **Messages**: the `messages/` node, addressed by PLAYER CODE so a message follows a person to every device they own. Pure helpers (`pairKey`, unread, hide) plus the verified writes and the offline outbox. Since 2026-09-28 a message can carry a game invite (`invite: {game, code}`, Air Hockey), drawn as a Join button by `js/messages-ui.js` |
| `js/challenges.js` | (2026-10-05) the DATA half of the hub's **Challenges** screen: reads the six challenge games' own indexes (Hoops, Skeeball, Cup Pong, Darts, Flick Soccer, Archery) through each game's reader and folds them into one list plus records (by person, by game). Writes nothing. See "The Challenges screen" below |
| `js/challenges-ui.js` | (2026-10-05) the Challenges screen: Live (your turn / their turn), Records (total, by game, by player, recent results), a player's page, and New challenge (person, then game). Opening a match or a challenge is handed to the game (`js/challenges-strings.js` holds its words). Since 2026-10-13 every live row has a Cancel / Decline / Resign button (see "Cancel, decline, resign, expire" below) |
| `js/challenge-life.js` | (2026-10-13) the few PURE rules all six challenge games share about a challenge that ends without a result: `ANSWER_MS` (3 days), `rowEnding` (cancelled / declined / expired / Skeeball's resign, read off an index row), `rowOpen`, `expiresAt`. No storage, no network |
| `js/match-chat.js` | (2026-10-14) in-match quick chat, the data half, for EVERY online game: `sendChat`/`watchChat` for a turn-by-turn match at `<node>/chat/<matchId>` (BESIDE the match, never inside it; verified by re-read, deletes nothing), `watchRoomReactions` for a live room, and the "since you were last here" marks (`gamehub.matchChatSeen.v1`). Network-first |
| `js/match-chat-ui.js` | (2026-10-14) in-match quick chat, the screen half: `createMatchChat({ root, send, them, place })`, Connect 4 Hoops' chat panel made generic. Used by Cup Pong, Darts, Flick Soccer, Skeeball challenges and Air Hockey; a new online game uses it too (`docs/BUILDING-A-GAME.md`) |
| `js/messages-ui.js` | (2026-08-31) the Messages screen: conversation list, one thread with chat bubbles and a quick-chat preset row, the recipient picker (Matt also gets **Everyone**), and Matt's read-only view of every conversation |
| `js/bug-report-ui.js` | the report form, Matt's inbox (reply / mark done / delete), and the player's own "what Matt wrote back" screen. The repo's FIRST consumer of `css/ui.css`'s `.gh-*` primitives |
| `js/error-log.js` | ring buffer of the last 20 uncaught JS errors (`gamehub.errorlog.v1`), installed by `hub.js` at load so a report carries what actually threw |
| `js/admin-config.js` | (2026-08-24) the app-wide **admin config** (`adminConfig/v1` in Firebase): which games are live for everyone and which Skeeball machines are open to everyone. Pure resolvers over a localStorage cache, so every reader is synchronous and offline-safe; an absent override always falls back to the code default. Since 2026-09-12 it also carries the **device reset** (`deviceResets/<statsId>`), the one thing in this repo that clears a player's history - see "Deleting a device's history" below |
| `js/stats-corrections.js` | (2026-08-24) the read-time **score corrections** layer: "those scores were thrown on a machine that was broken at the time." Pure overlay maths applied when a number is DISPLAYED (leaderboard, My Stats, Skeeball's own backboard); the raw record is never touched, and a score thrown after the correction counts normally. Also `VOIDED_MATCHES`: online matches that do not count |
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
  `boggle/data/words-es.txt`, `contexto/data/*`, `baseball/models/*`, `gridlock/js/levels.js`, `js/gridlock-v1map.js`, sw.js's `REST_MANIFEST`); re-run the generator.

**Index:**
- Server: `server.mjs`
- Service worker: `validate-sw-assets.mjs`, `test-sw-strategy.mjs`, `test-sw-update.mjs`
- Stats / data safety: `players-agg.test.mjs`, `test-recorder-contract.mjs`,
  `test-stats-replay.mjs`, `test-stats-identity.mjs`, `test-stats-corrections.mjs`,
  `test-rate-guard.mjs`, `test-activity.mjs`, `test-leaderboard-rank.mjs`, `test-admin-config.mjs`,
  `test-arrow-maze-time.mjs`, `test-gridlock.mjs`
- Hub features: `test-new-badge.mjs`, `test-emoji.mjs`, `test-messages.mjs`, `test-match-chat.mjs`,
  `test-bug-report.mjs`, `test-career-sync.mjs`, `test-push.mjs`, `test-skee-challenge.mjs`, `test-challenges.mjs`,
  `test-cuppong-mp.mjs`, `test-darts-mp.mjs`, `test-flicksoccer-mp.mjs`, `test-archery-mp.mjs`
- Cross-game: `test-game-conventions.mjs`, `test-visual.mjs`, `check-no-scroll.mjs`,
  `test-mp-lockstep.mjs`, `run-all-tests.mjs`
- Generators: `build-emoji-data.mjs`, `build-boggle-es.mjs`, `build-contexto-data.mjs`, `build-gridlock-levels.mjs`, `convert-kenney.mjs`
- Boggle: `tune-boggle-es.mjs`, `test-boggle-es.mjs`
- Baseball: `sim-baseball.mjs`, `sim-baseball-career.mjs`, `glb-info.mjs`, `render-actor.mjs`,
  `test-baseball-actors.mjs`, `test-baseball-career.mjs`
- Skeeball: `tune-ladder.mjs`, `measure-arc.mjs`, `sight.mjs`, `measure-reach.mjs`,
  `sweep-mover.mjs`, `measure-gallery.mjs`, `test-runaway-capped.mjs`,
  `test-brickcity-stall.mjs`, `test-brickcity-corner100.mjs`, `test-brickcity-throat.mjs`,
  `test-skeeball-popup.mjs`
- Flick Soccer: `flick-soccer/js/test.js` (headless physics, rules and computer probe)
- Archery: `archery/js/test.js` (headless rules: scoring, wind, turn order, shoot-off, the ring, panic, the computer)
- Air Hockey: `air-hockey/js/test.js` (headless engine probe), `air-hockey/net-test.html` (two-phone online latency test, deployed)
- Golf: `sheet-course.mjs`, `measure-hole-strip.mjs` ·
  Yahtzee: `test-yahtzee-ai.mjs`
- Matt-only readers: `read-activity.mjs` (trends: when each game is played), `read-install-state.mjs` (`--screens`: phone sizes by most active player), `read-bug-reports.mjs`, `read-device-reports.mjs`
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
| Chat in an online match (REQUIRED for every game that plays online, Matt 2026-10-14) | `createMatchChat()` — `js/match-chat-ui.js`, with `js/match-chat.js` (`sendChat`/`watchChat` at `<node>/chat/<matchId>` for turn-by-turn, `net.sendReaction` + `onReactions` for a live room). `docs/BUILDING-A-GAME.md`, "Multiplayer: quick chat is part of the game" | shipping online play without it (five games did; `test-game-conventions.mjs` now fails it), copying Hoops' own chat, or putting chat lines inside the match document or the move log |
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

The per-axis reference table and the 12-step checklist (setup screen, CSS scoping, settings key,
`GAMES` entry, `sw.js`/`CACHE`, the sub-counter three-edit rule, `GAME_META`, `<game>/CLAUDE.md`,
`strings.js`/i18n, quick chat in any online game, running the test suites) moved to `docs/BUILDING-A-GAME.md`, "Part 1 — Building
a game." Read it before creating a new game folder — and read Part 0 of the same file (the UX
floor) before changing any existing game's UI or CSS, new game or not.

## The games

One line per game; each game's full documentation lives in `<game>/CLAUDE.md` (auto-loaded when
working in that folder).

| Game | Integration | CSS root / prefix | Settings key | Stats recorder |
|---|---|---|---|---|
| Archery | in-hub `module:`, immersive, **`devOnly`**, a clone of the archery game in Matt's Snapchat recording (2026-10-14, `docs/ARCHERY-BRIEF.md`): 3 rounds of 3 arrows, hold to draw and aim through a magnified sight, wind stronger each round, panic when the ring runs out, shoot-off on a tie; vs computer Easy/Medium/Hard, pass and play, practice, and **turn-by-turn online challenges** (`archery/`; rules and push NOT yet published/deployed) | `.ar-root` / `.ar-` | `gamehub.archery.v1` (+ `gamehub.archery.save.v1` match vs computer) | `recordResult('archery', …)` |
| Air Hockey | in-hub `module:`, immersive, **`devOnly`, all 4 stages built** (vs computer Easy/Medium/Hard, and **live online** by code: real-time over `rooms/<CODE>/ah/`, lobby via `js/net.js`; `docs/AIR-HOCKEY-BRIEF.md`); hub id `air-hockey`, stats id `airhockey` | `.ah-root` / `.ah-` | `gamehub.airhockey.v1` | `recordAirHockey` (sub-counter `ah`: shots, shutouts, streaks) |
| Arrow Maze | in-hub `module:`, immersive, **`devOnly`**, clone of "Pointers" (Offline Games): tap arrows off the board in the right order, 3 lives (2026-10-11). **Since 2026-10-14 ONE numbered ladder** (Easy 1-50, Medium 51-100, Hard 101-200, Expert 201 on, since that evening; start any difficulty) and a leaderboard of **points** for levels cleared, one number across all difficulties, NOT hardest-difficulty-first (`way-out/CLAUDE.md`, "The ladder and points"). **Shipped as "Way Out" and renamed the same day: folder `way-out/`, hub id `way-out`, stats id `wayout` and the `gamehub.wayout.*` keys keep the first name on purpose** (THE LAW rule 5, the Monopoly Deal split) | `.wo-root` / `.wo-` | `gamehub.wayout.v1` (+ `gamehub.wayout.saves.v1` progress, one per tier; the first build's `gamehub.wayout.save.v1` is read once and left alone; `gamehub.wayout.clocks.v1` the level timer, 2026-10-13; since the ladder those two are read-only; the first ladder's `gamehub.wayout.ladder.saves.v1` / `.ladder.clocks.v1` are read-only too since the bands moved, and `gamehub.wayout.ladder2.saves.v1` / `.ladder2.clocks.v1` + settings `ladder2` are live) | `recordWayOut` (sub-counter `wo`: every timed finish, stored raw, with ladder level, generator and date since 2026-10-14) + `recordWayOutRush` (`wo.rush`: **Rush**, a separate timed mode, every run raw and each week's best; `way-out/CLAUDE.md`, "Rush") |
| Baseball | in-hub `module:`, immersive, **a real three.js stadium with the reference game's three cameras (R1, 2026-09-20, being rebuilt as a clone of Baseball 9's mechanics per `docs/BASEBALL-REFERENCE-B9.md`); career is phase 4; `devOnly`** | `.bb-root` / `.bb-` | `gamehub.baseball.v1` | `recordBaseball` |
| Brick Breaker | in-hub `module:`, immersive, **solo score attack** (clone of Neon Breakout, released 2026-09-23) | `.bx-root` / `.bx-` | `gamehub.brickblitz.v1` | `recordBrickBlitz` |
| Ball Run | in-hub `module:`, immersive | `.br-root` / `.br-` | `ballrun.*` (frozen gen-1 dotted keys) | `recordBallRun` |
| Battleship | in-hub `module:`, immersive, **multiplayer** (`gamehub.battleship.mp.v1`, the repo's first hidden-information game) | `.bs-root` / `.bs-` | `gamehub.battleship.v1` | `recordBattleship` |
| Boggle | in-hub `module:`, **multiplayer** (`gamehub.boggle.mp.v1`), **bilingual gameplay** (EN/ES word list + dice, chosen on the setup screen) | `.bg-root` / `.bg-` | `gamehub.boggle.v1` | `recordBoggle` |
| Chinchón | in-hub `module:` | `.cc-root` / `.cc-` (many rules still bare-prefixed) | `chinchon-settings` (frozen gen-1) | `recordChinchon` |
| Course Creator | launch-out `href:` (`hole-editor/?course=new`), **`devOnly`, opened to chosen players by player code from the admin page** (2026-09-24); records no stats, so no GAME_META row | n/a (own page) | its own `golf.holeEditor.*` keys | none |
| Contexto | in-hub `module:`, **solo word puzzle** (clone of contexto.me: one secret word a day, every guess ranked by closeness of meaning), **EN/ES word sets**; word model GENERATED by `build-contexto-data.mjs` into `contexto/data/` (LAZY tier) | `.ct-root` / `.ct-` | `gamehub.contexto.v1` (+ `gamehub.contexto.save.v1` progress) | `recordContexto` |
| Connect Four | in-hub `module:` | `.cf-root` / `.cf-` (many rules still bare-prefixed) | `gamehub.connect4.v1` (+ `gamehub.connect4.save.v1` autosave) | `recordConnect4` |
| Cup Pong | in-hub `module:`, immersive, **`devOnly`**, three.js + cannon-es; **stages 1-5 all built (rerack presets and Make your own; bounce shots built then turned OFF by Matt, a bounce is one cup) (vs computer Easy/Medium/Hard; Gentleman's/Rerack/Island as buttons) and Solo (fewest throws to clear the rack, its own leaderboard sort, `cp` sub-counter), and **turn-by-turn challenges** (`cuppong/`, 2026-09-28; series of 1/3/5 and a no-assists "Straight up" mode, 2026-09-30)** per `docs/CUP-PONG-BRIEF.md`; folder `cup-pong/`, hub id and stats id `cuppong` | `.cp-root` / `.cp-` | `gamehub.cuppong.v1` | `recordResult('cuppong', …)` |
| Darts | in-hub `module:`, immersive, **`devOnly`**, clone of GamePigeon's Darts (301, 201, 101 and Cricket in any order or in order, flick to throw, vs computer Easy/Medium/Hard or pass and play, autosave `gamehub.darts.save.v1`), plus **turn-by-turn online challenges** (`darts/`, 2026-10-01; `darts/CLAUDE.md`, "Online challenges") | `.dt-root` / `.dt-` | `gamehub.darts.v1` | `recordResult('darts', …)` |
| Dominoes | in-hub `module:` | `.dm-root` / `.dm-` | `gamehub.dominoes.v1` | `recordDominoes` |
| Dots and Boxes | in-hub `module:`, **multiplayer** (`gamehub.dotsboxes.mp.v1`) | `.db-root` / `.db-` | `gamehub.dotsboxes.v1` | `recordDotsBoxes` |
| Escoba | in-hub `module:`, immersive, **multiplayer at 2-4 seats** (save key `escoba-save`, MP field) | `.eb-root` / `.eb-` | `escoba-settings` (frozen gen-1) | `recordEscoba` |
| Filler | in-hub `module:`, **multiplayer** (`gamehub.filler.mp.v1`) | `.filler` / `.fl-` (pre-convention root class, frozen) | `gamehub.filler.v1` | `recordResult('filler', …)` |
| Flick Soccer | in-hub `module:`, immersive, **`devOnly`**, table soccer with flicked discs (Soccer Stars kind): five discs a side, one flick a turn, first to 1/2/3 goals; vs computer Easy/Medium/Hard (simulates its shots with the real physics) or 2 players on one phone; autosave `gamehub.flicksoccer.save.v1`; plus **turn-by-turn online challenges** (`flicksoccer/`, a log of flicks replayed on each phone; `flick-soccer/CLAUDE.md`, "Online challenges"); hub id `flick-soccer`, stats id `flicksoccer` (2026-10-11) | `.fs-root` / `.fs-` | `gamehub.flicksoccer.v1` | `recordResult('flicksoccer', …)` |
| Gridlock | in-hub `module:`, immersive, **`devOnly`**, the sliding-block "traffic jam" puzzle (Unblock Me / Rush Hour, 2026-10-14): drag blocks so the red one leaves through the exit; a numbered ladder of 4,000 levels (Easy 1-1000, Medium 1001-2000, Hard 2001-3000, Expert 3001-4000; ladder 1's 400 boards are all in it, `js/gridlock-v1map.js`), stars against the fewest moves, points for distinct levels cleared, a hint halves a level's points for good; **two looks, Wood or Cars, picked per phone** (`gridlock/CLAUDE.md`). Levels GENERATED by `build-gridlock-levels.mjs` into `gridlock/js/levels.js` (append-only) | `.gl-root` / `.gl-` | `gamehub.gridlock.v1` (+ `gamehub.gridlock.save.v2` progress, one per difficulty; `.save.v1` = ladder 1, read once) | `recordGridlock` + `recordGridlockHint` (sub-counter `gl`: per level fewest moves, stars, crown; first hint time) |
| Connect 4 Hoops | in-hub `module:`, immersive, **multiplayer, two protocols** (live rooms via `js/net.js`; turn-by-turn via `hoops/games/<id>`, its own node), **admin only** (`devOnly`) | `.h4-root` / `.h4-` | `gamehub.hoops4.v1` | `recordResult('hoops4', …)` |
| Hill Climb | in-hub `module:`, immersive | `.hc-root` / `.hc-` | `gamehub.hillclimb.v1` | `recordHillClimb` |
| Mancala | in-hub `module:`, immersive, **multiplayer** (`gamehub.mancala.mp.v1`) | `.mancala` / `.mc-` (pre-convention root class, frozen) | `gamehub.mancala.v1` | `recordResult('mancala', …)` |
| Monopoly Deal | launch-out `href:` (in-repo `business-deal/`, own nested SW) | n/a (own page) | its own keys | `window.__ghStats` → `'business'` |
| Murdoku | in-hub `module:`, immersive, **solo logic puzzle** (murder mystery on a floor plan, one person per row/column; every case generated on the device and proved to have one answer, no guessing), **released 2026-09-30** (admin only from 2026-09-29) | `.mu-root` / `.mu-` | `gamehub.murdoku.v1` (+ `gamehub.murdoku.save.v1` progress) | `recordResult('murdoku', …)` |
| Nuts & Bolts | in-hub `module:` | `.nb-root` / `.nb-` | `gamehub.nutsbolts.v1` | `recordNutsBolts` |
| Parchís | launch-out `href:` (built from sibling `../Parchís/`) | n/a (own page) | `parchis_r2_prefs` | `window.__ghStats` → `'parchis'` |
| Skeeball | in-hub `module:`, immersive, **solo** (unlockable machines), plus **"beat my score" challenges** (`skeeChallenges/`, 2026-09-24) | `.sk-root` / `.sk-` | `gamehub.skeeball.v1` | `recordSkeeball` |
| Snake | in-hub `module:` | `.sn-root` / `.sn-` | `gamehub.snake.v1` | `recordSnake` |
| Sudoku | in-hub `module:` | `.sd-root` / `.sd-` | `gamehub.sudoku.v1` | `recordSudoku` |
| Texas Hold'em | in-hub `module:`, immersive, **multiplayer up to 8, HOST-AUTHORITATIVE** (the host's device deals; `rooms/<CODE>/pk`; `gamehub.holdem.mp.v1`), plus solo vs up to 7 computers; a **bankroll** (ranked on its own leaderboard; stacks equal the buy-in; broke players climb back at the bottle-cap table Behind the Dumpster, 2026-10-08), per-hand stats, and deterrent-only cheat checks (`holdem/CLAUDE.md`) | `.pk-root` / `.pk-` | `gamehub.holdem.v1` | `recordResult('holdem', …)` + `recordHoldemBank` / `recordHoldemHand` |
| Tic Tac Toe | in-hub `module:`, **multiplayer** (`gamehub.tictactoe.mp.v1`) | `.ttt-root` / `.ttt-` | `gamehub.tictactoe.v1` | `recordTicTacToe` |
| Uno | in-hub `module:` | `.un-root` / `.un-` | `gamehub.uno.v1` | `recordResult('uno', …)` |
| Yahtzee | in-hub `module:`, immersive, **multiplayer** (`js/net.js`, no persisted MP save key) | `.yz-root` / `.yz-` | none yet (no persisted settings) | `recordYahtzee` |

The root-class/prefix cells were verified against each game's actual CSS on 2026-07-23 (note
Tic Tac Toe is `.ttt-`, three letters, and Filler/Mancala use pre-convention full-word root
classes — real facts, not typos). Bare-rule counts, for context: Chinchón 246, Escoba 219,
Connect Four 99, Filler 68 top-level prefixed rules alongside whatever root class each has —
which is why the axis table's "a prefix alone is not isolation" warning names the worst of them.
If a later redesign adds or renames a root class, the table follows the code.

## Archived games (2026-09-28)

**Pinball, Pool and Pipes** were archived at Matt's request (*"remove pinball from the game hub and
archive it"*, *"Remove it from the leaderboard too. Archive all traces"*, then *"please do the same
for Pool and Pipes"*). Their code is in `archive/<game>/` (each with its own `CLAUDE.md` and restore
steps; Pool's multiplayer-lockstep test section is kept at `archive/pool/tools/`); `archive/` is in
`validate-sw-assets.mjs`'s `SCAN_SKIP`, so nothing there is precached or linked. No launcher tile,
no leaderboard row, no My Stats tab, no art, no strings, no recorder.

**What deliberately remains, and why (THE LAW):** `'pinball'`, `'pool'`, `'poolv2'` and `'pipes'`
stay in `js/game-stats.js`'s `GAMES` - that list is the stored SHAPE, and every recorded game still
lives under those keys on the phones and in `players/<id>`. They are also in `ARCHIVED_GAMES`,
which `js/players-agg.js` uses to keep them out of every total. Games' own saved settings/saves
(`gamehub.poolv2.*`, `gamehub.pool.save.v1`, Pipes' keys) are left untouched in storage. Nothing was deleted; restoring the game makes it all visible
again. **An archived game is hidden, never deleted** - archive the next one the same way.

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
hub's top-bar pill, Ball Run, Dominoes, Hill Climb, Nuts & Bolts, Snake and Skeeball print
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
see every thread; everyone else only their own). **`adminConfig/` and `bugReplies/` are writable only by a uid in `admins/`** (2026-10-14, Matt: *"NOBODY should have that power other than me"*; `database.rules.README.md`, "Admin-only writes"). Everything else is `auth != null`. A device
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
*"mostly iphone, installed. go with firebase."* Real Web Push. **Four triggers since 2026-09-24**:
`hoopsTurnPush` (Connect 4 Hoops challenges/turns/results), `messagePush` (a new message, from
`messages/index/<me>/<them>` - only a newer `at` FROM them notifies; a tap opens that thread) and
`bugReportPush` (a new `bugReports/<id>`, to every code whose uid is in `admins/`, found through
`msgAuth/<uid>` - no code is hardcoded; a tap opens the bug inbox). The fourth, `skeeChallengePush`
(Skeeball challenges, `skeeChallenges/index/<code>/<id>`, a tap opens Skeeball), was added later
the same day and **deployed by Matt on 2026-09-25** - see "Skeeball challenges" below. A fifth,
`cupPongTurnPush` (Cup Pong challenges, `cuppong/index/<code>/<id>`), was added on 2026-09-28 and
was **DEPLOYED by Matt on 2026-09-28** - `cup-pong/CLAUDE.md`, "Challenges". Its rules branch
`cuppong` was **PUBLISHED by Matt on 2026-09-28**. A sixth, `dartsTurnPush` (Darts challenges,
`darts/index/<code>/<id>`), was added on 2026-10-01 and **DEPLOYED by Matt on 2026-10-03** ("done",
after `firebase deploy --only functions` from `game-hub-deploy`); its Cricket wording ("Closed: you 3, them 2"
instead of points that read "0, 0") changed `functions/decide.js` on 2026-10-04 and was **redeployed by Matt on
2026-10-11** (with Flick Soccer's); its rules branch `darts` was
**PUBLISHED by Matt on 2026-10-01** (verified: `darts/` reads, every other branch unchanged) -
`darts/CLAUDE.md`, "Online challenges". A seventh, `flickSoccerTurnPush` (Flick Soccer challenges,
`flicksoccer/index/<code>/<id>`), was added on 2026-10-11 and **DEPLOYED by Matt on 2026-10-11** ("done"); its
rules branch `flicksoccer` was **PUBLISHED by Matt on 2026-10-11** (verified the same day: `flicksoccer/`
reads, every other branch reads as before, an unlisted branch is still refused) - `flick-soccer/CLAUDE.md`,
"Online challenges". An eighth, `archeryTurnPush` (Archery challenges, `archery/index/<code>/<id>`), was added on 2026-10-14 and is **NOT YET DEPLOYED**, nor is its rules branch `archery` **published** (both as of 2026-10-14: until then Archery's online play is refused and no push is sent) - `archery/CLAUDE.md`, "Online challenges". **A change to `functions/` is
live only after Matt re-runs `firebase deploy --only functions`** - merging to main does nothing
for it. **All three were deployed by Matt on 2026-09-24** (`messagePush` and `bugReportPush` created,
`hoopsTurnPush` updated).

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
  file** - he asked for exactly that. **And as ONE numbered list of exact commands, one per line, to
  send in order** (Matt, 2026-10-03: *"You should have just said 'send these in order'. not 'if this
  folder exists blah blah blah'"*). No "if X, do Y" branches up front; at most one short line at the
  end for a likely error. The masked prompt of `functions:secrets:set` ignored a paste
  in PowerShell (saved an empty value, refused); `--data-file` from a temp file worked.
- **Opening the hub clears them** (2026-09-24, Matt: "Can the notifications auto dismiss if i go to
  the game hub?"): `clearShownNotifications()` in `js/push.js` closes every notification this app is
  showing, on hub load and whenever it returns to the front. Verified in Chromium (2 -> 0); on iOS
  it depends on Safari honouring `Notification.close()` for web push, confirmed only by a phone.
- **No notification to a device that has the hub OPEN** (2026-09-24, Matt: "if i have the hub open
  i shouldn't get them either"). While visible, the hub stamps `activeAt` (server time) on that
  device's own `pushSubs` entry every 30 s (`markActive` in `js/push.js`) and writes 0 when hidden;
  `sendTo` skips a device stamped within 75 s (`isActive` in `functions/decide.js`). Decided on the
  SERVER on purpose: Safari revokes a site whose push shows nothing, so `sw.js` must show every push
  it gets. Other devices of the same player still get it. Needs the functions redeploy to be live.
- **A Hoops tap opens THAT match** (2026-09-24, Matt: "it takes me to the setup screen... It should
  take me directly to that game"). The payload never named the match, but the function tags every
  Hoops push `hoops-<gameId>`, so `sw.js` reads the id from the tag and adds `&match=` (or `match`
  on the `OPEN_GAME` message); `js/hub.js _openPushedGame` hands it to the game's alerts module
  (`armOpen` in `hoops4/js/alert.js`) and the game opens that board with no card. No function
  redeploy was needed. A game without `armOpen` falls back to the old bubble-or-launch path.
- A subscription is a delivery address, not player history: the function removes one the phone
  has dropped (404/410), and the player recreates it with one tap.
- **A tap must survive a reload (2026-10-14).** Matt: *"lately when i click a notification that it's
  my turn... it brings me to the hub, but doesn't necessarily open the challenge."* Tapping brings
  the app to the front, which is also when `_onResume` finds a new build and reloads the launcher
  (several deploys a day), and the in-memory `OPEN_GAME` died with the page. Now `js/hub.js` writes
  the tap to sessionStorage (`hub.pushOpen`, 2-minute life) BEFORE acting, the next load takes it
  (`_openFromUrl` -> `_peekPushOpen`), and it is cleared only once the game is MOUNTED;
  `_applyUpdate` waits 1.2 s so a tap arriving with the resume opens its game first (the refresh
  then waits for the launcher). A cold start (`?open=`) no longer waits for the network alert
  check. **With the SAME game already open**, the hub arms the match and calls the module's
  optional `openArmed()` export (Flick Soccer has it); another game open still means nothing
  happens. `sw.js` reads the match from any challenge tag (`<node>-<id>`) as a fallback.
  `test-push.mjs` pins it; checked in Chromium (launcher, same game open, reload mid-open, cold
  start, stale tap ignored, a vs-computer game not interrupted).

## Online play needs an account Matt has let in (2026-10-08)

Matt: *"Get rid of the play yourself cheat."* Nothing checked that the two players in an online game
were different people, so a second phone or a private browser window with a made-up name was a free
opponent: lose to yourself on purpose and every win counted on the leaderboard (about 15 seconds a
win in Tic Tac Toe; about 30 in a Hoops, Cup Pong or Darts challenge, where the fake account just
taps Quit). **Checked against the live data that day: nobody had done it** - every online challenge
King of Games had played was against Matt.

- **The rule:** a player code may play online only if it is on the list. `ONLINE_BEFORE` in
  `js/admin-config.js` is every code that existed that morning (45, read from `players/`), so nobody
  already playing noticed anything. A code minted later needs Matt to tap it on the admin page's
  **Online play** section (`adminConfig/v1/online/<CODE>`: true lets a code in, false shuts a listed
  one out). Matt's own devices (`isAdminDevice`) always may.
- **Where it is checked, so no game has to remember it:** `js/net.js`'s `createRoom` / `joinRoom` /
  `joinSeat`, BEFORE any network call (every live room: Chinchón, Escoba, Tic Tac Toe, Mancala,
  Filler, Dots and Boxes, Boggle, Battleship, Yahtzee, Hoops, Air Hockey, Hold'em); every challenge
  `createGame` (Hoops, Cup Pong, Darts, Flick Soccer, Skeeball), which also refuses an opponent who is not allowed;
  and every challenge picker and Air Hockey's invite list, which only offer allowed people.
- **Two devices on ONE code are one person**: `net.js` stamps the player code on each seat record
  (additive) and refuses a join into a room that already holds that code on another device
  (`'same-player'`).
- **The refusals** are `'no-code'`, `'not-approved'`, `'same-player'` and `'them-not-approved'`;
  each game shows `onlineGateText(err)` in its own error slot ("Online play is not turned on for
  your account yet. Ask Matt to turn it on.").
- **What it does not stop, said plainly:** two REAL people who are both let in, one losing to the
  other on purpose (collusion, not self-play; it shows on the board as a long losing record against
  one person), and someone with developer tools lying to their own phone (no server, like every
  check here). It also means **a new family member cannot play online until Matt taps them in.**
- `test-admin-config.mjs` pins the resolver and that every gate site actually calls it;
  `test-cuppong-mp.mjs` / `test-darts-mp.mjs` let their two made-up test codes in through the same
  config cache.

## The Challenges screen (2026-10-05)

Matt: *"a button you can press where you can see all your live challenges - if it's your turn vs
theirs, more info on your records total and against specific players, etc. You should also be able
to send challenges and jump into games from this page."*

- **Where:** a full-width **Challenges** button above the game grid (not a fourth top-bar button:
  four wrap on a phone). It only appears when a game on that player's launcher has challenges (a
  registry entry with an `alerts` module), and says "N your turn" in words, summed from each alerts
  module's `myTurnCount()` off the rows its own check/watch already read (no extra read).
- **What:** `js/challenges-ui.js`. Live tab (your turn first, then theirs), Records tab (total
  won/lost/drawn, by game, by player, recent results), a player's page (record vs them, live games
  with them, a Challenge button), and New challenge (pick a person, then a game).
- **Every game keeps its own challenges.** `js/challenges.js` READS `hoops/`,
  `skeeChallenges/`, `cuppong/`, `darts/`, `flicksoccer/` (2026-10-11) and `archery/` (2026-10-14) indexes through each game's own reader. It writes
  nothing itself, so THE LAW has no surface here. Records come from FINISHED index rows, grouped by player
  CODE; an old Hoops row with no stored result counts as played and in no column (rule 4), and an
  expired, cancelled or declined challenge is listed but not counted. Cancel / Decline / Resign
  (2026-10-13) are the one thing this screen starts, and it calls the GAME's own writer for them
  (`endAction` / `endMatch`), so it still writes nothing itself (see "Cancel, decline, resign, expire").
- **Jumping in is the game's job.** Every challenge game's alerts module now exports
  `armOpen(id)` (open that match on mount), `armChallenge({code,name,emoji})` (open the game's own
  "challenge this person" screen with them already picked) and `myTurnCount()`. `js/hub.js`'s
  `openChallengeMatch` / `challengeIn` arm one and `launch()` the game, so every option and rule of a
  challenge stays the game's own. **A new challenge game needs those three exports** (and its
  `SOURCES` entry in `js/challenges.js`); `test-challenges.mjs` checks all five have them.
- Only games on the player's launcher are shown, so for the family that is Skeeball until Matt
  releases the others from the admin page.

## Cancel, decline, resign, expire (2026-10-13)

Matt: *"Please implement a way to cancel sent challenge requests, and a way to resign/forfeit. Maybe
challenges expire if they aren't accepted in 3 days?"* All the challenge games (Hoops, Skeeball, Cup
Pong, Darts, Flick Soccer; Archery was built with it from the start, 2026-10-14). The shared rules are `js/challenge-life.js`; each game's own `mp.js`
(Skeeball: `challenge.js`) does the writes, verified by re-read, deleting nothing.

- **A challenge is OPEN until its receiver plays their first move** (Hoops a shot, Cup Pong a throw,
  Darts a dart, Flick Soccer a flick - picking a line-up is not an answer - Skeeball a game's score).
  A later game of a Hoops or Cup Pong series is never open: the series was already agreed to.
- **While open, the sender can CANCEL and the receiver can DECLINE.** It counts for nobody (no win,
  no loss, no record). `cancelGame(id)` / Skeeball `cancelChallenge(id)` write
  `over: { winner: 'none', why: 'cancelled' | 'declined' }`. **`resignGame` on an open match calls it
  off instead** (`{ cancelled: true }`), so nobody is handed a win for a match never played - this
  changed Hoops', Cup Pong's and Darts' old "quit before answered = a loss" (Flick Soccer already
  called it off). A cancel that races the receiver's first move is VOID on read (`validateGame`), so
  both phones agree the match plays on.
- **Once answered, the only way out is RESIGN**: the other person wins (unchanged in the four log
  games; NEW in Skeeball, `resignChallenge(id)`, `over: { winner, why: 'resign' }`, never re-derived
  from the scores).
- **EXPIRY: a challenge that waits 3 days on its receiver with no answer lapses** and counts for
  nobody. Only matches made from 2026-10-13 carry `lapse: true`; an older one never expires (it can
  still be cancelled). Nothing is written when one expires: every phone works it out from the stored
  time (the rows carry `expires`), and a late move is refused (`'expired'`). **Skeeball already
  expired every turn after 3 days** (2026-09-24) and is unchanged.
- **Rows of a called-off match (and a Skeeball resignation) are stored `over: false, yourTurn:
  false` with `ended: <why>`.** On purpose: the deployed push functions (`functions/decide.js`) do
  not know "cancelled" - Hoops' would tell the other person "<you> won", Skeeball's "it's a tie" - and
  a functions change needs Matt's manual redeploy. For that shape no function sends anything, and
  every reader turns it back into a finished row (`rowEnding`). **So no push is sent for a cancel, a
  decline or a Skeeball resignation.** A function change could add "Ana declined your challenge"
  later. Rows also carry `open` ('sent' | 'got' | ''), `expires` and `sent`, written on every row
  write.
- **Where a player does it:** every live row on the hub's Challenges screen has a Cancel / Decline /
  Resign button (`js/challenges-ui.js`), with a confirm screen that RE-READS the match (the row can
  be a turn behind). In each game, the existing Resign / Quit control says "Cancel challenge" /
  "Decline challenge" while the match is open (Hoops' multiplayer rows too); Skeeball's challenge
  page has the button (two taps). Lists show "You cancelled · Ana", "Ana declined", "Expired: Ana
  never played"; a live row shows "Expires in 2d".
- A resignation made from the hub is counted as a loss at once through the game's own ledger
  (Darts, Cup Pong, Flick Soccer `countResult`; Hoops leaves it to `recordFinished`, as its own Quit
  does).
- Tests: `test-challenges.mjs` (the hub, end to end through Darts), and each game's suite
  (`test-darts-mp.mjs`, `test-cuppong-mp.mjs`, `test-flicksoccer-mp.mjs`, `test-hoops4-mp.mjs`,
  `test-skee-challenge.mjs`). Checked in Chromium: the hub screen (cancel, resign confirm, records)
  and Darts' in-game decline, against an in-memory database.

## Skeeball challenges (2026-09-24)

Matt: *"what about skeeball? challenge someone to a game for the higher score?"* 1, 3 or 5 games or
every machine the challenger can play, won on most wins or total score, TURNS ALTERNATE one game at a
time (each seeing the other's score), ONE attempt per game, and leaving a game counts its score as
it stands. Full contract: `skeeball/CLAUDE.md`, "Challenges". The parts that live outside
the game folder:

- **A new top-level node, `skeeChallenges/`** (`games/<id>` + `index/<CODE>/<id>`), added to
  `database.rules.json` and `backups/rtdb-backup.mjs`'s `BRANCHES`. **PUBLISHED by Matt
  on 2026-09-24** (he pasted his live rules; the only change was adding `skeeChallenges`).
- **A fourth Cloud Function, `skeeChallengePush`** (`functions/decide.js` `decideSkee`): a new
  challenge, and the result to the person who sent it. **DEPLOYED by Matt on 2026-09-25**
  ("deploy complete"), together with the v3 turn-by-turn wording. Every hand-over notifies.
- **The hub's `alerts` hook has a second registrant** (`skeeball/js/alert.js`; Cup Pong's `cup-pong/js/alert.js` is the third, 2026-09-28), and **the launcher
  now shows EVERY game's alert** (`this._gameAlerts`, a list in registry order). One alert draws the
  big bubble as before; two or more draw a small "Your turn!" / "Game over" pill on each tile
  (`.hub-alert.is-mini`), no X, the tile under it opening the same game. Matt: *"If someone has
  challenges waiting on both games, can we switch to a smaller 'your turn' bubbles so you can see
  both? But so it doesn't take up the entire screen?"*

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
  (`retired: true` on a TABS row - none since Pool's `poolv2` row went with the Pool archive,
  2026-09-28): such a build has no `js/hub.js` registry entry at all, so `isGameOnLauncher`'s
  `isGameLive` default assumed a row that does not exist and once put a retired build on the board. That one flag now drives the
  leaderboard, the launcher answer and `gameChoices()`'s bug-report picker, replacing a hardcoded
  id check. It deliberately does NOT hide the My Stats tab. `visibleTabs()` in the same file keeps its own,
  MORE PERMISSIVE rule on purpose - a game hidden by an override still has its My Stats screen, so a
  player's own record of a game Matt has pulled back stays reachable. Do not unify the two.
- **A game can be held back from NAMED PLAYERS too (2026-10-13)**: `hideFrom: ['<CODE>']` on a
  `GAMES` entry in `js/hub.js` (`hiddenFromPlayer()`), a code edit rather than an admin switch.
  Hides the tile and makes `launch()` refuse the game; never applies to Matt's devices or a dev
  profile; touches no data. First use: Arrow Maze held back from King of Games since 2026-10-13 (lifted for part of 10-14,
  then back on; `way-out/CLAUDE.md`).
- **A hidden game can be opened to NAMED PLAYERS (2026-09-24, the Course Creator).**
  `games/<id>/allow/<PLAYER CODE> = true`, written by `setGameAllowed` (verified re-read, no
  `at`/`by` stamp inside the map), read by `isGameAllowed(id, code)`; the launcher shows a tile when
  `isGameLive || dev || isGameAllowed`. It only ever ADDS viewers; the picker (chips, one per coded
  person) shows on a game's admin row only while that game is Admin only, and only for ids in
  `ALLOW_PICKER` in `js/admin-ui.js`. **It hides the TILE, not the page**: the editor's URL still
  opens for anyone who has it (nothing client-side could stop that).
- **`devOnly` is now only a DEFAULT, so a game can go live with no commit.** That is why admin-only games
  (Cup Pong, Air Hockey, Baseball) have a `GAME_META` row in `js/leaderboard-ui.js`, and why
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
- **A Texas Hold'em bankroll can be voided too (2026-09-28)**, from the page's **Poker bankrolls**
  section: the same BASELINE overlay (`adminConfig/v1/corrections/holdem/<statsId>`,
  `correctHoldemLedger`), per PERSON, so the bankroll reads $25,000 again everywhere - the
  leaderboard, My Stats and the game's own spendable balance - while the raw ledger is untouched.
  Ledgers `holdemSuspect()` calls impossible are listed first and read "Under review" on the board.
  **These are deterrents, not cheat-proofing** (Matt chose them over a server dealer); see
  `holdem/CLAUDE.md`, "Cheat deterrents".
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
  Four, Escoba and Nuts & Bolts' CSS plus `js/game-art.js` and `icons/icon.svg`.
- **No em dashes** in user-facing game or profile copy (use commas, colons, or parentheses).
- **any "you win / you lose" popup gets a close (X) in its top-right corner**, so it can be dismissed without forcing a rematch.
- **The rest of this repo's UX/UI rules — minimum text size, tap targets, safe-area handling,
  animation/reduced-motion rules, and more — live in `docs/BUILDING-A-GAME.md`'s "Part 0 — The UX
  floor."** Read it whenever you touch a game's UI or CSS, not just these three bullets.

## Messages from the Game Hub, and a Play button that loads the newest build first (2026-10-14)

Matt asked for "an inbox message to king of games from the gamehub saying the arrows game is live
again", then: "Say it's back with a new game mode", "add a link ... that opens the game. It should
make sure the newest code/data is loaded, then open it", and "No reply box. Just a notification from
the hub." (A first draft wrongly came from Matt's own account; every Messages message is
player-to-player, so a hub sender had to be built.)

- `js/hub-messages.js` holds the messages IN CODE (`HUB_MESSAGES`): no Firebase node, no rules to
  publish, no function to deploy, and nothing a device can write. Addressed by player code. The
  first: `arrow-maze-rush-3vn33` to King of Games (3VN33), "Arrow Maze is back, with a new mode:
  Rush!", Play opens `way-out`.
- `readMyThreads()` merges a `HUB` row shaped like an index row, so the Messages badge, the inbox and
  the profile card count and show it with no other changes (offline too). The thread view
  (`renderHubThread`) has the hub's own icon (`icons/icon.svg`), no composer and no Hide.
- Play (`hub.openGameFresh`): queue the open (survives a reload, `fresh` flag), `_ensureNewestBuild`
  (ask for an update, wait up to 20 s for it to take over, reload if this page is older than the
  worker), then `_warmGame` (sw.js `WARM_GAME`: warmRest's carry-forward/fetch for one game folder,
  additive), then the push-open path. Every step is bounded, so a bad connection still ends in the
  game. From the profile page it goes to `../?open=<id>&fresh=1`.
- Verified in Chromium as King of Games with Firebase blocked: badge 1, row, thread, Play opens Arrow
  Maze, badge clears; and with a newer build "deployed" mid-session, Play reloaded once onto it and
  opened the game in ~2.4 s with Arrow Maze's files in the new cache.
- Not done: a phone notification (needs a Cloud Function Matt deploys).

### Read receipt for Game Hub messages (2026-10-14)

Matt: *"Make sure there's a way for me to tell if he's read it."* `markHubSeen` now also stamps
`read[<id>] = {code, at}` (first open only) in `gamehub.hubMessages.v1`, and the first open triggers
a sync. `js/stats-net.js` mirrors `hubReadReport()` as `players/<id>/hubMsgs` (additive REPORT,
omitted while empty, read only by the admin page). A message opened on v1165 (before receipts)
left only `seen`; it is reported as read with `at: 0` and shown as "Read" with no time rather than
a made-up one. Admin page section **Game Hub messages**: per message, each recipient Read <time> /
Not yet (Not yet also covers a phone that has not synced since). Browser-checked with `stats-net.js`
stubbed (no database): King of Games' phone reports `{code: '3VN33', at}`; the admin section shows
"Read 14 Oct, 22:52" and "Not yet".



## No "You" on shared screens (2026-10-15)

Matt: *"Make sure that NOWHERE does it say 'You'... It must use profile names everywhere always."*
then, mid-work: *"that's fine. I just didn't want it to say You on the leaderboard and stuff like
that."* The leaderboard's YOU badge went first; then `makeT` gained `{me}` (`myName()` in
`js/i18n.js`) and the hub's shared screens (Challenges pill and rows, launcher alerts, Messages list
prefix, match chat author, the profile page heading, the admin reply label) print the profile name.
A per-game pass (about 40 game files incl. Monopoly Deal and the Parchís build) was done on branch
`worktree-agent-a1088a54bd77c574b` and NOT shipped, per Matt's clarification; it is there if wanted
(note: Monopoly Deal needs its own `business-deal/sw.js` CACHE bump, Parchís edits are overwritten by
the next `../Parchís/` rebuild, and `functions/decide.js` push text still says "you").

## The compact layout (2026-10-17)

Matt asked whether the launcher was "efficient or clean". Measured: 8 games on the first screen, the
first one ~300px down (two rows of top-bar buttons, a Challenges bar, a Reorder row, big 2-across
tiles). Mockups A (top icons) and B (bottom tab bar) were drawn with the real tile art; Matt edited B
into "C" in Mockup Pad: B's tab bar and tiles with the comfortable header (title, En, theme, version).
He then asked for bigger tab icons with no words ("Most apps wouldn't have those words there either"),
a tighter gap under the title, and for it to be a player OPTION, not a replacement: "A comfortable and
a compact layout. The new one is the compact. They can toggle between either whenever they want", with
an announcement telling people to try it.

Built as `js/layout.js` (same shape as theme.js) + a Profile > Settings > Layout row + CSS keyed off
`.gh-compact`. Comfortable renders exactly as before. Compact details: favorites carry no heart; the
FAVORITES head's icon button opens edit mode with ‹ ♥ › on each favorite (move left, remove, move right),
answering Matt's "Without the heart on the favorite games, how do you expect people to favorite and
unfavorite games?". The open tab is coloured AND underlined (colorblind rule). The title is 21px only
from 385px wide (at 360px it ellipsized). The "your turn" bubble gained `is-col-mid` because the
3-across grid has a middle column, where a left-anchored 290px bubble ran off the screen.

### Bottom-bar tips and the popup redesign (2026-10-17, same day)

Matt: the popup "looked weird on my phone" and "just says oh hey new thing. I want things to pop up
that look like the 'your turn' things but for the bottom menu bar. And say what each thing is."
Also: "Don't resend it to anyone tho. And I wanna be able to see who has seen it." The popup kept its
id (so nobody who dismissed it sees it again), lost the left-aligned paragraph with a dangling
"> Layout." line, and gained two whole-screen pictures, Comfortable and Compact (img/layout-*.jpg,
theme x language). The tips are a new step: five bubbles in the launcher's bubble style, one per tab,
tap to advance, X to skip; recorded as `compact-tour-2026-10-17` in the announcement seen-list, which
the existing players/<id>/announce report and Admin > Announcements already carry. Admin already
listed every announcement's seen/not-yet names, so "who has seen it" needed no new screen.

## Messages: off the profile page, and in-game chat inside conversations (2026-10-17)

Matt: "Now that messages has its own tab, we should remove it from the profile page, right?" Yes: both
launcher layouts open Messages directly, so the profile card (renderProfileMessages + its reserved-height
hint gamehub.pfMsgsHeight.v1, left in storage unread) was a third door. And: "in game quick chats should be
included here. Like they should appear within your convo with that person. It should be obvious which
chats happen in game and in which game they occurred." js/game-chat-history.js folds each challenge
game's index (via js/challenges.js loadAll) and each match's chat into the conversation, read only. A
chat line only says `by: 'a'|'b'`, so the match is read for this player's side, and only when it has chat.
Air Hockey / Hold'em / other live-room games store just the newest line per seat, so there is no history
to show for them; making that history exist would be a write-side change, not done here.

### Live-room chat saved into Messages (2026-10-17, same day)

Matt said "Yes" to saving live games' chat so it can appear in conversations. `rooms/<CODE>/reactions`
keeps one overwritten slot per seat, so there was nothing to read back; the history now starts here.
`js/net.js` `sendReaction`, after its unchanged reaction write, reads the room's `game` and seat codes
(cached 30 s) and calls `js/messages.js` `logGameChat`, which pushes one child per other player into
`messages/threads/<pairKey>/msgs` with `game: {id, s, room, t, v}` and a plain `text` for older apps.
It never writes `messages/index`, because `messagePush` and the unread badge both key off the index:
a quick chat must not buzz a phone that is already in the game. No rules change (threads accept any
child for a claimed code). Fire and forget, so a slow write can never stall play.

## 2026-10-18: Challenges became the Multiplayer screen

Matt asked to revamp the Challenges pop-up. Three mockups (List / By player / Cards); he chose the
List, then asked: "should we change the Challenges tab to a Multiplayer tab? It could show the
challenges and stuff like in A. Then it could also show all the multiplayer games you can challenge
people to play." Mockup rounds: "I don't like the 'live' or 'anytime'" (one A-Z grid), "It should say
'your turn' not 'Matt's turn'" (his own exception to the profile-name rule), "The 'their turn' section
should take up less space... They're too tall" (one-line rows), "I'd prefer the full name fit".
Records: he asked how to reach them (the record chip) and whether live games' head-to-head should
show ("Yes? Sure?"), reversing the 2026-08-11 decision that nothing reads `h2h` - for this screen only.
What `h2h` holds was checked first: written by Chinchón, Escoba (from 2026-07-22), Filler, Mancala,
Dots and Boxes, Tic Tac Toe (07-27), Boggle (07-28), Battleship (08-04); never by Air Hockey,
Hold'em, Yahtzee. Keyed by the opponent's DEVICE id, so `js/mp-records.js` maps it to a person.
He then asked for turn-by-turn challenges in every multiplayer game; agreed order: this screen first,
then Battleship, Tic Tac Toe, Dots and Boxes, Mancala, Filler, Yahtzee, then Boggle, then Chinchón
and Escoba (2 players first). Air Hockey and Hold'em cannot be turn by turn (real-time / whole table).

## 2026-10-18: Firebase deploys automatically

Matt, after pasting rules and running the PowerShell deploy for Chinchón/Escoba challenges: "Why do we
have to do this every time?... i'd much prefer you be able to do it automatically." The app is GitHub
Pages (deploys on merge); functions and rules live in his Firebase project, which no session can log
in to. `.github/workflows/firebase-deploy.yml` now deploys `functions` + `database` on merges that
touch them, behind a check step (rules JSON, `tools/test-push.mjs`), signed in with a service-account
key held only as the repo secret `FIREBASE_SERVICE_ACCOUNT` (one-time setup in `functions/README.md`).
`firebase.json` gained `"database": { "rules": "database.rules.json" }` so the CLI knows the file.
Same day: Matt published the full rules file (archery, chinchon, escoba branches went live) and started
the manual functions deploy (chinchonTurnPush, escobaTurnPush; archeryTurnPush with them).


## Compact layout: the tab bar halfway up the screen (2026-10-20)

Matt's recording (Dropbox, 2026-10-20 11:48): on the Compact launcher, scrolling down carried the
bottom tab bar up with the tiles until it stuck about 55% of the way down the screen, with tiles
showing below it; the title bar scrolled away; the Leaderboard opened in only the top ~55%.
Chromium did not reproduce it. It matches a reported iOS 26 WebKit bug (Apple Developer Forums
thread 800125, WebKit bug 297779): after the keyboard closes, `visualViewport.height` stays shorter
than `innerHeight`, and while the PAGE scrolls, fixed elements are placed against that short line.
The gap (~45% of the screen) is about a keyboard's height. One forum reply also ties it to
Reduce Motion + Prefer Cross-Fade Transitions. Fix: in Compact the page itself never scrolls
(`html`/`body` `overflow: hidden`), `.hub` is the scroller (`height: 100dvh`); the Games tab
scrolls `.hub` to the top. Comfortable is unchanged. Not verified on an iPhone by the session.

**Reverted the same day (v1209).** Matt's screenshot on v1208 (12:19, fresh build): the tab bar sat about
65pt above the bottom of the screen, page background below it, on a fresh load with no keyboard used.
A page locked to the screen height (`html`/`body` `height: 100%; overflow: hidden`, `.hub` `100dvh`)
hits a different iOS 26 bug: Apple's Safari 26.1 notes list a fix for "a bottom gap appearing on
layouts with viewport-sized fixed containers"; Framework7 users reported the same bottom-tabs gap,
fixed for them in iOS 26.2 beta 3. So the page scrolls again (the v1207 layout, which put the bar at
the true bottom). The keyboard bug (bar halfway up after typing) can come back on iOS versions that
still have it; no tested web workaround was found. Do not lock the page again without testing on
Matt's iPhone.


## Fewer updates for players (2026-10-22)

Matt: *"Ana and moonis have commented that every time they go back to the hub, even between games and
stuff, there's an update."* Measured: ~30 builds reached every phone in the 7 days to 2026-10-22 (about
4 a day); each one reloaded the hub the next time the player was on the launcher, and phones asked for a
new build every 5 minutes on resume. About 8 of the 30 were admin-only game work that leaked out:
Arrow Maze's `js/arrow-maze-time.js` (a shared, network-first file loaded at hub start, so its edits still
need a CACHE bump or Matt would test stale code; not changed) and new files added to ASSETS (Archery's 3D
models, three times; the new Pool game).

Matt chose (1) players take a build only at a fresh open, admin phones at once, and (2) close the leaks;
not (3) batching deploys, because he tests every change as it lands. Players can force one by tapping the
version pill.

- `js/hub.js`: `_holdUpdates()` (not an admin device, not a dev profile), `_isFreshOpen()` (`hub.session`
  in sessionStorage: absent = app launch; `hiddenAt` 30+ min ago = back after a while), GUARD 4 in
  `_onNewBuildActive`, the pill shows the PAGE's version against the newest (`v1218 → v1219`), and
  `launch()` reloads onto the new build (queuing the open) when a game fails to import or start on a page
  that is behind its worker. The service worker's lifecycle is untouched.
- FIRST TRIED AND DROPPED, same day: new workers WAITING (no self-`skipWaiting`) until the hub sent
  `SKIP_WAITING`. In headless Chromium the waiting worker sometimes never activated after the message,
  and a reload or navigation during that state hung the page. A hung app on Android was not a risk worth
  the gain; the page-side hold gets the same result for the player.
- `tools/validate-sw-assets.mjs`: a file under a held-back game's folder that nothing outside held-back
  folders imports may stay out of ASSETS; `sw.js` `isDevFresh` serves such files network-first.
- `tools/test-sw-update.mjs`: case 5 (a player's page is not reloaded; pill shows behind; a tap reloads),
  case 6 (an app launch reloads onto a build landing in its first seconds). Test hook
  `window.__GH_UPDATE_POLICY__`. Case 3 is flaky in this sandbox's Chromium on main too (2 of 4 runs).

## Compact tab bar: repaired in place instead of a layout change (2026-10-24)

Matt's screenshot: the bar halfway up again, tiles below it ("Sometimes this happens still to the bottom
menu. Fix permanently"). Same iOS 26 bug as 2026-10-20. Locking the page failed then, so the layout is
untouched. `js/tabbar-fix.js` (`watchTabBar()`, started in hub.js `init`) checks the bar on scroll, resize,
visualViewport resize/scroll, focusout, pageshow, visibilitychange and every 2 s. The true bottom is
`innerHeight`, or the screen height on an installed app (standalone + cover fills the screen even when the
bug shrinks innerHeight). Off by more than 24 px: toggle `position` to make WebKit place it again; still off
next frame: `translateY` by the gap, cleared when it measures right. Headless proof: a bar forced 45vh up
was moved back to the bottom and released when the fault went. NOT proven on an iPhone: if WebKit reports
the bar's rect as correct while painting it wrong, the guard sees nothing and does nothing (harmless).

## 2026-10-25: "That's me" on the name gate

Matt: nobody understands the codes. An iPhone's Home Screen app shares no storage with the Safari tab, so a
person who chose a name in Safari, then added the hub to the Home Screen, met the gate again and got "Taken.
Use that code instead." for their own name, with a code they had never seen. Now, when the typed name was
claimed in the last 24 h (`usernames/<name>.at`), the gate asks "Is this you?" with a "That's me" button that
links to that code exactly as the code Link does (`js/name-gate.js` `linkTo`, `ME_WINDOW_MS`;
`stats-net.js` `usernameOwner`). Older claims still need the code. Anyone could tap it on someone else's
name claimed that day; accepted by Matt as the trade-off (family-grade, like the registry itself).

## 2026-10-26: admin-switched games were slow to open (Darts ~4 s)

Matt's screen recording: Play on a Darts challenge, ~1.3 s on the launcher, ~2.5 s on the setup card,
then the match. Darts, Cup Pong, Pool, Connect 4 Hoops, Air Hockey and Arrow Maze were live from the
admin page but still `devOnly` in code, so `sw.js` held them back: no hash, network-first with a 2.5 s
deadline, every module of the game fetched on every open. Matt: "If I switch it from admin only to fully
released, obviously you should update the code as soon as you see that. Or even better, me making the
switch solves it instantly." Fixed both ways: the six released in code (v1264, v1265), and `LIVE_HELD`
(js/hub.js `_tellWorkerLive`, sw.js `noteLiveHeld`/`liveHeld`): a held-back game switched live is served
from the cache at once, and each hub load refreshes all its files in the background (`cache: 'no-cache'`,
at most every 2 min per game), so a switch is fast with no commit. Probes in `tools/test-sw-strategy.mjs`.

## 2026-10-27: what was really slowing multiplayer (the database connection)

Matt: "Just do a thorough review and fix whatever is slowing everything down so much." Measured, read-only,
test profile: every read his phone makes is small (indexes 0-16 KB, a match 4 KB, his stats record 29 KB, all of
players/ 444 KB) and answers in ~45 ms on a healthy connection, so neither data size nor server speed. The waits came
from the CONNECTION: (1) after any drop, Firebase restarts on long-polling and upgrades to a websocket, and reads
stalled 6-8 s through that switch (traced frame by frame); (2) Firebase's own code (10.12.2 onRealtimeDisconnect_)
sets the retry delay to maxReconnectDelay_ (5 min) when the line drops while the page is hidden, which is what a
phone in a pocket or a switch to Dropbox does; an iPhone can also leave the socket silently dead. Fixes in
js/firebase-boot.js: forceWebSockets(); goOffline/goOnline when the app comes back after 20 s away; slow reads logged
(gamehub.perf.v1 -> players/<id>/perf). Also js/hub.js preloads the game code for games where it is your turn.
NOT verified on an iPhone (the sandbox cannot run WebKit; its proxy also distorts websocket timings). Also seen:
11 deploys in 43 min the night before; an admin device reloads onto each one and opens a new connection.



## Admin-only games on the Multiplayer screen (2026-10-27)

Matt: "on the main gamehub page, admin only games have the 'test' badge on them. But they don't on the
multiplayer screen. Why? Make sure NO admin only game is visible to ANY player besides me."
Why: the Multiplayer grid (js/challenges-ui.js) drew only art and name; it never had the Test pill. Its game
list was already the launcher's visible list, so players never saw admin-only games there. One gap closed:
Matt or test1 could still CHALLENGE a regular player in an admin-only game (Archery, Battle Arena), which
would push them, write their index row and show the chat in Messages for a game they cannot see. Now every
challenge picker filters, and every createGame refuses, a person whose launcher hides that game (dev
profiles and admin-page `allow` codes excepted). Checked live that day: no archery/battlearena index rows existed.


## Admin-only games off the leaderboard, for everyone (2026-10-28)

Matt (screenshot: Archery and Baseball on By Game): "Admin only games should not appear on the leaderboard. Not for
me and not for anyone else." Two faults. (1) `isGameOnLauncher` let dev profiles through, so Matt saw them. (2) Worse:
`game-stats-ui.js` TABS had Archery, Cup Baseball, Battle Arena and Gridlock NOT `devOnly` (the "Darts' reasoning"
comment, which assumed a devOnly tab stays hidden after an admin release; it does not, `isGameLive` resolves the
switch), so isGameOnLauncher returned true for EVERY player: they saw those boards on By Game and on Matt's player
page. Fixed: no dev bypass; TABS devOnly now match the hub (tools/test-leaderboard-rank.mjs fails on drift); the
player page passes `board: true` to drop never-released admin-only games. Checked players/ that day: only MattyIce had
plays in any of them, so no player's My Stats lost a row. Cross-game totals (ALL_IDS) still count them (rule 1).


## Admin-only games launch with 0 plays (2026-10-28)

Matt: "admin only games should be released with 0 plays by anyone. They do not need to appear in My Stats either.
Admin only games should NOT be counted towards the total win number on my Player tab. Leave all data as is, and start
doing this going forward." Asked two things first (AskUserQuestion): his existing test plays (Gridlock 22, Battle Arena
6, Archery 1, Baseball 1, all MattyIce) -> "Leave them, count them"; progress starting over at launch -> yes.
Built: `js/game-stats.js` `ADMIN_ONLY` (stats id -> hub id, checked against js/hub.js and game-stats-ui TABS by
tools/test-leaderboard-rank.mjs) and `isTestGame(id)` (admin-only unless switched live). `loadStats()` swaps each test
game's `testGames.<id>` / `testH2h.<id>` into `games`/`h2h` (a new test record starts as a COPY of the real one, so a
tester's Gridlock levels and Battle Arena unlocks carry on); `persist()` always writes the stored shape, so the real
record is never touched. Every reader that shows or uploads stats moved to `loadStoredStats()` (stats-net's mirror,
My Stats, the leaderboard's own-record merge, Multiplayer Records, Hold'em's bank, Arrow Maze's leaders, the bug-report
device dump). My Stats' `visibleTabs()` lost its dev bypass; By Player's cross-game numbers use `counted()` (skips
`isTestGame`). Verified on MattyIce's real record (sandbox, nothing uploaded): real records unchanged byte for byte.
At release: drop the id from ADMIN_ONLY with the two devOnly flags; the game then plays into its real record.

## Arrow Maze: Expert replaced by generator 10, for everyone (2026-10-28)

Matt played Impossible test board 11 (28x38, 75 arrows, one free at every step, the next ~8.7 dots away,
blockers ~10.5 dots off) and said, halfway through: "THIS is what Expert should be like." The first plan put
the new boards on his devices only; he answered: "not just my phone. Everyone's phones. The new levels should
replace the Expert levels that are there. I don't want anyone getting 6 points from the old (existing) levels."
So every Expert level, for every player, plays a generator 10 board (`way-out/js/boards10.js`, built by
`tools/build-arrow-boards10.mjs`, ~3.5 min a board in four parallel parts). A level in progress on an old Expert
board starts over on the new one; Expert replays use the new board for that level number. Points already earned
on old Expert boards stay (THE LAW). Details: `way-out/CLAUDE.md`, "Expert = generator 10, for everyone".

## Arrow Maze: Hard on generator 11 (2026-10-28)

Right after Expert moved to generator 10, Matt: "Now Hard is too easy. Please take your time and make Hard a bit
more challenging. Not as challenging as expert, but more challenging than they are right now." Generator 8's Hard
was ~45 arrows on 16x22 with ~2 free at a time and blockers ~5 dots off. Generator 11 uses Impossible test boards
7-8's recipe (18x25, one free at every step, next arrow ~6-8 dots away; Matt took 2:03 on board 7), between that
and Expert's 28x38 / 75-80 arrows. Every Hard level from 101 for everyone, in the same loop as Expert; a level in
progress finishes on its old board (no points concern was raised for Hard). Details: `way-out/CLAUDE.md`,
"Hard = generator 11, for everyone".

## 2026-10-29: Spelling Bee accepts adult words and profanity

Matt typed VAGINA and was told "Not in word list": "Come on this is a word. Words like this and profanity
should count." The LDNOOBW bad-word list and BLOCK dropped them from both lists. `ADULT_KEEP` in
`tools/build-spelling-bee-data.mjs` (hand-checked, 83 added) makes them BONUS words: accepted and scored when
typed, never answers, so hints, ranks, totals and Yesterday's Answers are unchanged and nothing appears unasked.
Slurs stay blocked, and so do RAPE, RAPED, RAPING, PEDOPHILE, JAILBAIT. Spanish untouched. Only `extra` in
`bee.json` changed (verified: words, puzzles, retired identical).

## 2026-10-29: Spanish Spelling Bee accepts profanity too

Matt said yes to doing Spanish as well. `tools/build-spelling-bee-es.mjs`: every word the bad-word filters
(LDNOOBW es, BLOCK, BLOCK_RE) and SKIP's rude words had blocked is now a BONUS word under the usual bonus
rules; it is never an answer. All 269 blocked words were read; the filter had also caught ordinary words
(infierno, concha, folleto, coñac, idiota). `SLURS` (marica, maricón, bollera, nazi, cholo...) and
`NO_ADULT` (pedófilo) stay out. CONCHA went into NAME_WORDS. 97 bonus words were added; words, puzzles
and retired are identical.

## 2026-10-29: RAPE, RAPED, RAPING, PEDOPHILE count

Matt: "just because these words have bad meanings doesn't mean they aren't words. They would all count in
scrabble." They were added to English `ADULT_KEEP`, and Spanish `NO_ADULT` was removed (PEDOFILO is a bonus
word, though no puzzle has its letters yet). Only slurs stay out. Rule for future sessions: a word's meaning
never keeps it out; only slurs do.

## 2026-10-29: Spelling Bee voided Ana by mistake; right vs wrong retired

Matt, sitting next to Ana as she played Spanish (Oct 29, `es:t:acinou`): her row showed 0 words, 0 pts. Her
`beeDaily` row was intact (46 words, 179 pts); `beeWatch` had flagged her on two SUPPORTING rules: Back+9 in
60 s (since #1315 a first `open` counts as a return) and right vs wrong (30 / 12 = 2.5, over the threshold of 2).
She is a fluent native speaker. INTEGRITY-CHECKS rule 4 says a check honest players trip is dropped, so right vs
wrong is retired (`js/bee-fairplay.js`) and `flagStands` makes the board, the server's long-term board and the
admin page ignore a stored flag left without enough live reasons. Nothing was written to Firebase: her flag
stays stored. Of the 2 real flags, only hers changes (King of Games Oct 28 stays void). Her logs could not be
replayed from a session (beeLog is admin-read), so "Back+N" alone is unchanged.

## 2026-10-29: every hidden game gets the "who can see it" picker

Matt: "Why can't I add people to word weaver, gridlock, or cup baseball? I want to add Ana to word weaver."
The admin page drew the picker only for a hand list (`ALLOW_PICKER`: Course Creator, Pool, Battle Arena), added
one game per request, so every newer admin-only game came without one. The hub already honours
`adminConfig/v1/games/<id>/allow/<CODE>` for any id (`js/hub.js`), so the list is gone: every hidden game's
row has the picker. A session still never writes the admin config; Matt taps the person.

## 2026-10-29: Word Weaver gets Spanish puzzles

Matt asked whether Word Weaver has Spanish (only its screens did), then "Yes, build Spanish puzzles", the same
day he opened it to Ana. A second ladder, not a translation: `word-weaver/data/es/` from
`tools/build-word-weaver-es.mjs`, which IMPORTS English's ramp, bands and crossword layout
(`tools/build-word-weaver-data.mjs` now exports them; its own output re-verified byte-identical) and Spelling Bee's
Spanish lists (`tools/build-spelling-bee-es.mjs` exports them; `bee-es.json` re-verified identical). Progress is kept
apart so no English number moves: `ww.es` beside `ww.lv` (merged per level in players-agg, counted in points),
`gamehub.wordweaver.es.save.v1`, pending entries with `lang: 'es'`. Quality pass by reading the grid words:
subtitles drop the tilde, so ANO ranked as if it were AÑO; English loans (SET, TOP, STOP, JET) came in through
the subtitle list. Grid words now need the dictionary (or a conjugation of it), plus a hand-read `GRID_BLOCK`.

## 2026-10-29: Spelling Bee checks re-evaluated ("You can't void everybody")

By midday the server had voided three of the day's players: Ana (Spanish, beside Matt), Lili (Spanish), King of Games
(English). Matt: "You can't void everybody. Undo today's voids and reevaluate the checks so this doesn't happen." The
reasons were Back+N in 60 s (all three; since #1315 the first open counts as a return), right vs wrong (Ana), a no-miss
burst (Lili, 23 at 5.1 s: a fluent player) and re-typed (King of Games, 2). New rules (`verdict`, `js/bee-fairplay.js`):
strong = sorted run, best words first; supporting = burst, speed, re-typed with ALL THREE needed; leave and right vs
wrong retired. Stored flags are re-judged from their saved numbers (`flagStands`), so the three voids lifted without
any Firebase write (a session cannot write `adminConfig/` anyway). King of Games' Oct 28 flag still stands (sorted run
7); his hand voids are untouched. The logs themselves are admin-read, so no full replay was possible from a session.

## 2026-10-29: test automation never writes ("Smokey")

Matt found "Smokey" (code TQWX7, device aa4800fa) in the Spelling Bee report: a HeadlessChrome 390x844 browser that
a session pointed at the LIVE site the night before; it passed the name gate with a made-up name and got a real
player code. Matt: "why do you refuse to use the test profile we made for you? we've discussed this at least 3
times", then: "make it so the app let's test automations play anything and always ignore their scores/rounds etc".
`js/automation.js`: when `navigator.webdriver` is true (every WebDriver browser; Playwright sets it), every Firebase
writer refuses with no override (stats-net `writesAllowed`, messages, push, admin config, bug reports, the device
report, the retired challenge), `onlineGate` refuses, and the launcher shows every game. Smokey's device id is in
`HIDDEN_DEVICE_PREFIX` (hidden, nothing deleted). `tools/test-automation-guard.mjs` proves it without touching the
database (a session's attempt to prove it against the real database was, rightly, refused by the session's own
safety check). `tools/validate-sw-assets.mjs` did not flag the new shell file missing from ASSETS; the test does.


## The admin page rebuilt as its own page (2026-10-29)

Matt: *"it's fucking terrible as it is now. It's impossible for me to do anything quickly."* Measured first (headless,
393x852, test1): ten accordion sections; everything open = 21,561 px (33 screens); Games with Live open 3,842 px for 41
identical Live/Admin-only rows; 259 name chips (37 people x 7 hidden games); Player scores 5,192 px for 33 buttons;
closed headings said nothing, so seeing whether anything needed him took 10 taps. Every earlier pass had rearranged
inside the same frame. Two mockup rounds (canvas `Admin page mockup`); Matt rejected the first's chip pickers and person
page ("horrific", "thoughtless"), asked why voids were not under each game, approved the second ("I like it").
Built: full-screen page, four tabs (Now, Games, People, Sent) + gear; one row style; voids on each game's page and on a
player's page in that game; Keep marks a flag checked in `adminConfig/v1/reviewed`; the leftover "Reset golf stats"
(the one button that erased earned history) removed at his request. Not built: a per-play void (a play log exists only
since Oct 28, and a best or fewest-guesses can't be recomputed without every play). The play-log rows read
`playLog/<CODE>` (admin-read), so they were not seen working headlessly with the test profile.

## No other player's code in the page (2026-10-29)

Matt: "make sure codes aren't viewable by anyone else besides Admin"; "screens only" (database, rules, stored data and
how codes key things untouched). The leaderboard had moved to opaque indexes earlier that day; this pass did the rest:
Messages rows (`data-code`, plus `name || code` fallbacks), the Multiplayer screen (pick sheet, Records `data-opp` =
`code:XXXXX`, bell `data-nudge-to`), nine games' pick-a-person rows (`data-code`), Hold'em's Bankrolls (`data-k` = identity
key), Hoops (code printed under each name, `name || code` fallbacks), Spelling Bee's board (`name || code`). Left: Admin,
the retired PIN-gated Challenge Control (`js/challenge/challenge-ui.js` Insights prints codes; admin-only), the profile page's
own code, room join codes, `js/bee-fairplay.js` (shared with the server; its `name || code` is data, every screen now
substitutes "Player"). Proven by `tools/test-no-codes.mjs` and `tools/test-no-codes-browser.mjs`.


## The profile page, rebuilt (2026-10-29)

Matt, after the admin page rebuild: "can we apply a similar upgrade to the my profile page? ... I have to click bottom
right then admin in a different area to get there and navigate". Mockup approved ("i like it"; then "ok" after seeing
the non-admin version). The page was cards of collapsible `<details>` rows; it is now an iPhone-Settings list in the
admin page's style, each setting one tap into its own screen (`.pf-view`, `history.pushState`, so the phone's back
gesture works and a reload keeps the screen). Admin is the first row on admin devices (same two gates as before:
the cached `gamehub.adminDevice.v1`, then `isAdminDevice`/`refreshAdminDevice`). Computer players became a list with
one screen per player (face, name, level as check rows, Remove). Quick chat's hint line was dropped (fewest words).
Nothing about saving changed: every input, id and handler (`saveProfile`, the name registry check, code linking,
reset) is the same code; only the markup around them moved. Found on the way: the emoji picker's grid was squashed
to ~14px rows in Chromium (the old page too; likely Android Chrome players saw it): `grid-auto-rows: max-content`,
`align-content: start`, buttons `min-height: 44px`. Tested headless at 402x874, 375x667, 360x780 and 430x932, EN and
ES, dark (and light at 402): no sideways scroll, no clipped row, back from every screen lands on the list, every
write lands in `gamehub.profile`.

## Times are Eastern (2026-10-29)

Asked when Ana was last in the app, a session reported times in US Central; Matt corrected it ("It's 8:36 right
now") and asked that every session default to Eastern time.


## When you got it wrong, say "I built it wrong." (2026-10-30)

Ana and Lili's phones showed different winners for the Oct 28 Spanish Spelling Bee: the viewer's own row counted
words found the next day (Lili 486, 1st) while every other phone counted only on-day words (Lili 428, Ana 434, 1st).
The own row had been exempted from the own-day rule by stretching the "a void never touches your own row" rule
past what Matt asked. Fixed in PR #1342 (v1363). Asked why, the session first blamed "an earlier session" and "the
rule"; Matt: "Next time the answer is 'I built it wrong.' You MUST NOT avoid stating it. Don't feed me bullshit.
You botched it. Take ownership. Make this a rule."

## 2026-10-29: Matt's hand add, NIGGLING on his own Oct 29 Spelling Bee day

Matt: "At 11:59pm eastern, count niggling for MattyIce's score. Adding 8 points to the final daily score", then
"you MUST add it at 11:59". A session cannot write a player's row (rules: own msgAuth code only), so it is a
read-time HAND ADD (`HAND_ADDS` in `js/stats-corrections.js`, like the voids): +1 word, +8 points to QZCC4 on
`g:ailnvz`, on from 2026-10-30 03:59 UTC (11:59 PM EDT). Applied in `buildBeeBoard` (long-term board, Leaderboard),
`shownRows` and the own live row (in-game board); `beeWatch` rebuilds the board once a hand add switches on.
Nothing stored changed. Matt's authority over his game ("It's my game, I control every aspect of it").
