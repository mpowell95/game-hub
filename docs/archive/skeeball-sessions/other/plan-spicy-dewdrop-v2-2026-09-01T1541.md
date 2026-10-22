# Make the whole app feel fast

## Context

Matt: *"fast loads, everywhere in the app and within each game to feel responsive. Overall I want
it to just feel better."*

This began with Anita's recording of opening Skeeball. That fix shipped today (v542) — game code is
served from the phone instead of re-downloaded. A second session then shipped v545/v546, killing the
white flash on the hub↔profile trip (theme stamped before first paint, plus a first-paint skeleton
in `index.html`). Both were real wins. This plan is what is left, measured rather than assumed.

### Measured on v546 (warm cache, 4× CPU throttle)

| | |
|---|---|
| Hub: first pixel (the new skeleton) | **64 ms** |
| Hub: real launcher on screen | **90 ms** |
| Hub: leaves the device **every launch** | **35 requests, 687 KB raw / ~223 KB gzipped** |
| Game mount, median of 20 | 63 ms |
| Game mount, worst (Escoba) | 204 ms — **137 ms of it unstyled** |
| Layout shift when the skeleton swaps in | 0.001 — negligible, not a problem |

**Correction to earlier numbers in this session:** every byte figure I quoted (2,188 KB for
Skeeball, 688 KB for the shell) was **uncompressed**. GitHub Pages gzips, so the real wire cost is
about a third — the hub launch is ~223 KB, not 687 KB. The request count, the serial round trips
and the main-thread parse cost are unaffected, and those were the dominant terms on a phone, so
every conclusion stands. The numbers were simply 3× too big.

The skeleton is working — at 20× CPU throttle I could not catch it before the real launcher landed.
**What is left is the per-launch re-download, the total absence of feedback when you tap a game, and
real jank inside a few games.**

### Decisions Matt already made — do not revisit

1. **Shell caching: "keep the stats code fresh."** Cache the big non-data shell files; modules that
   read or write player data stay on the network. A hand-maintained list is accepted, *on condition*
   it gets a structural test that fails when a data-writing module goes missing from it.
2. **Repair the boot guard**, plus a test so it cannot be silently switched off again.

---

## Batch 0 — Prerequisites and free wins

Ship first, small and independently verifiable.

**0a. Rebase.** The working tree is at `7d1b774`; live `main` is `f14c9a5` (v546). The skeleton only
exists on `main`. Rebase, then bump `CACHE` past what is on `main` at that moment (root
`CLAUDE.md`'s two-branches rule), not past the working copy.

**0b. Repair the boot guard — `index.html:182`.** Currently `if (root.children.length > 0) return;`.
The v546 skeleton is a child of `#hub-root` from parse time, so the watchdog stands down
unconditionally and the August self-repair is dead. Fix to
`if (root.children.length > 0 && !root.querySelector('.hub-skel')) return;` — `js/hub.js:580`
replaces `innerHTML` wholesale, so *absence of `.hub-skel`* is the exact "real UI mounted" signal.
This also catches a **partial** render (hub.js sets `innerHTML` then throws), which a
skeleton-only check would miss.

**This is a prerequisite, not a nicety.** Batch 1 creates the first way to serve a mixed-generation
module graph — a cache-first `js/hub.js` importing a network-first `js/game-stats.js` whose exports
moved in the same deploy throws mid-render, and the hub renders nothing. The auto-recover path is
the only automatic repair, and it must be alive before that risk exists.

**0c. Pinball's runaway loops — `pinball/js/ui.js:303`.** Verified directly: `_startGame()` arms
`requestAnimationFrame` with no idempotence guard, and is reachable from setup Play (`:150`) *and*
the game-over "Play again" (`:651`), which does not stop the previous chain. `_frame` re-arms
unconditionally (`:405`) and `_stopLoop()` (`:418`) only holds the last id — so **every replay
orphans a loop that `destroy()` cannot cancel and that keeps running in the hub for the life of the
page.** Same defect, same shape, same two entry points as the one already fixed in
`skeeball/CLAUDE.md:1298-1330`. Port that fix.

**0d. Hill Climb's永-on loop — `hill-climb/js/ui.js:132`, `:643-644`.** Re-arms before its screen
check, so it wakes at 60 Hz on the garage and menu screens for the whole mount.

0c and 0d are three-line fixes with no cache implications and a directly felt payoff.

---

## Batch 1 — The launch

### 1a. Split the shell — `sw.js`

Add an **allow-list derived from `ASSETS`**, declared inside the `buildSrc` slice (after
`sw.js:396`) so `test-sw-strategy.mjs:150` can extract it:

```js
const NETWORK_FIRST = [ './', './index.html', './profile/', './profile/index.html',
  './js/game-stats.js', './js/game-stats-global.js', './js/game-stats-ui.js', './js/stats-net.js',
  './js/profile-store.js', './js/players-agg.js', './js/stats-corrections.js',
  './js/arcade-scores.js', './js/messages.js', './js/messages-ui.js', './js/bug-report.js',
  './js/bug-report-ui.js', './js/device-report.js', './js/admin-config.js', './js/admin-ui.js',
  './js/error-log.js', './js/net.js', './js/leaderboard-ui.js', './js/install-state.js',
  './js/firebase-boot.js', './js/firebase-config.js' ];
const SHELL_CACHE_FIRST = SHELL.filter((p) => !NETWORK_FIRST.includes(p));
```

Then beside `REST_PATHS` (`sw.js:907`) build `CACHE_FIRST_PATHS` from `[...REST,
...SHELL_CACHE_FIRST]` and swap it into the branch condition at `sw.js:944-945`. Keep
`req.mode !== 'navigate'`.

- **It must be an allow-list, never a deny-list over same-origin paths.** Verified: `sw.js` is not
  in `ASSETS` (0 matches), so an ASSETS-derived list excludes it by construction. A deny-list would
  swallow it — and the failure would be live, not theoretical, because the network-first branch's
  background put (`sw.js:1005-1010`) already writes `sw.js` into the cache today. Serving that
  cached copy freezes the version pill and `_forceUpdate()` (`js/hub.js:794-800`, `:836-853`).
- **Coherence is already guaranteed** and should be said in the comment: `install` does an atomic
  `cache.addAll(SHELL)` *before* `skipWaiting` (`sw.js:833-835`), so `cur.match()` always hits for a
  shell path and the global `caches.match` fallback (`sw.js:951-952`) is unreachable for the shell.
- Most display gates are already lazy-imported on tap, so keeping them fresh costs nothing at launch.

**Comments that become lies if not updated:** `sw.js:882-901`, root `CLAUDE.md:204-219`,
`skeeball/js/ui.js:63-64`.

### 1b. Actually get the 91 KB off the critical path — three edits, all required

Cutting `js/hub.js:11` alone does nothing: **verified** that `js/admin-config.js:63` statically
imports `statsId` from `game-stats.js`, and `js/hub.js:22` imports admin-config. All three:

- `js/admin-config.js:63` → drop the static import; `statsId()` is used at exactly one site
  (`:344`, the audit `by` field on an admin write). Make it `await import('./game-stats.js')` there.
  **Do not extract `statsId` into a new module** — it is `resolveStore().syncId`
  (`js/game-stats.js:317`), the identity core `test-stats-identity.mjs` guards.
- `js/hub.js:11` → dynamic import inside `_syncStats()` (`:526`). It is currently `try/catch` around
  a sync call and becomes a rejection — needs a `.catch()`.
- `js/hub.js:15` → move `isPlaceholder`/`hasName` (`js/name-gate.js:40-42`, two lines over
  `loadProfile()`) into `js/profile-store.js` and re-export; `initFirstRun()` (`:873-876`) then
  imports name-gate only when there is no name.

### 1c. Stop fetching `sw.js` twice per launch

`_latestVersion()` (`js/hub.js:794-800`) pulls the whole worker to read one version string. Point it
at a `version.json` **generated by `validate-sw-assets.mjs` from `CACHE`**, the way `REST_MANIFEST`
already is, plus a `test-sw-strategy.mjs` assertion that it matches `CACHE`. **Keep it out of
`ASSETS`** — that is what guarantees it can never enter `CACHE_FIRST_PATHS`; the validator's
"deployed file not in the list" warning is correct and expected. Saves a request and a 52 KB
main-thread parse (≈17 KB on the wire, not 52).

### 1d. Let the launcher paint before background work — `js/hub.js:392-394`, `:402`

`bug-report.js`, `messages.js`, `messages-ui.js`, `bug-report-ui.js` are dynamic-imported
unconditionally right after `render()`. Move to `requestIdleCallback` (with a `setTimeout(…, 0)`
fallback). **Defer, never drop:** `_drainBugReports`/`_drainMessages` are THE LAW rule 6 retry
paths — keep the `online` (`:395`) and `showLauncher()` (`:1046-1047`) retriggers.
`_paintReplyBadge()` (`:394`) is a *visible* badge: paint it from the cached count synchronously and
defer only the network read, or it pops in late.

**Realistic outcome, say it before shipping:** with the carve-out, `admin-config.js`,
`profile-store.js` and `error-log.js` stay network-first and are all on the launch path, plus
`index.html` and the browser's own `sw.js` check. Expect **~5-6 requests, ~30 KB of JS**, not the
3/116 KB my full-shell prototype hit. Still roughly a 6× cut in requests.

*(Side effect, free: `skeeball/js/ui.js`'s CSS wait currently awaits `css/ui.css`, which is
network-first, so its 1500 ms cap fires on a slow link and the flash returns. `ui.css` is not a data
module, so 1a fixes it.)*

---

## Batch 2 — The tap

`js/hub.js:974-998` has **no loading state of any kind**, and the ordering fights itself:
`unmount()` blanks the container *before* `await import()` starts (`:1032`), and `game.hidden` only
clears *after* `init()` returns — so there is no frame where anything could be shown.

Order within the batch matters:

1. **Fix the double-load trap first (K).** Pinball, Hill Climb and Pipes check only a marker
   attribute (`pipes/js/ui.js:588` and the same shape in the other two), so their own `index.html`
   `<link>` goes unrecognised. If the hub starts injecting stylesheets before that is fixed, every
   mount appends a **second copy of a 39-50 KB sheet**. `skeeball/js/ui.js:63-68` documents exactly
   this trap and the href-matching fix.
2. **Then move the CSS gate into `js/hub.js`.** Only Skeeball waits today; the four heaviest sheets
   (Battleship 50 KB, Escoba 49 KB, Chinchón 39 KB, Yahtzee 37 KB) all render unstyled-first.
   **The `<link>` must go in *before* `await import(game.module)`** so sheet and module download in
   parallel — a per-game `ensureCSS()` cannot start until the module has parsed, which is half the
   win on a cold cache. That means each `GAMES` entry carries `{href, attr}`, plus a
   `test-game-conventions.mjs` check that the pair matches the game's own `ui.js`.
3. **Then the lifecycle (C).** A **monotonic token**, not a boolean: capture before
   `await import()`, and after it `if (token !== this._launchToken) { module.destroy?.(); return; }`
   — two fast taps currently both reach `init()` into the same container because `unmount()` nulls
   `this.current` and it is not set until after `init()`. Move `innerHTML = ''` to after the import
   resolves so the loading state has somewhere to live. Give the tapped tile a pressed/busy state,
   styled by `css/hub.css` — **not** the game's sheet, which by construction has not parsed yet.
4. **Then prefetch (D), modestly.** `pointerdown`/`pointerenter` on a single tile only. **No
   `modulepreload` for 20 games** — that recreates the request storm Batch 1 removes. Skip `href:`
   entries (Monopoly Deal, Parchís) which navigate rather than import. Note the grid scrolls and
   taps are delegated on `.hub-main` (`js/hub.js:686`), so a scroll gesture starts with a
   `pointerdown` on a tile — worth gating so a flick down the launcher does not warm six games on a
   cold device.

**Playtest after C:** `pinball/js/ui.js:301-303` `_fit()` and Hill Climb's renderer currently
initialise inside `display:none` and get zero-size boxes, self-healing via `js/viewport.js`.
Unhiding before `init()` is strictly better but *changes what they measure on frame 1*. Check
Pinball, Hill Climb, Ball Run and Skeeball by eye.

---

## Batch 3 — Jank inside the games

- **Two non-compositor transitions on gameplay/input paths** (`docs/BUILDING-A-GAME.md:48-49`
  forbids them). Verified both. `escoba/css/escoba.css:390` transitions `width`+`height` on
  `.eb-table-cell` on every card move; `dots-boxes/css/dots-boxes.css:338` does the same on
  `.db-line`, with 220 edges and the drawn state changing 2px→5px on the primary tap. **Do not
  convert to `transform`** — Escoba's cell is absolutely positioned with `.eb-card { width:100%;
  height:100% }` at `:392`, so a `scale()` distorts the card art. Delete `width`/`height` from the
  transition lists and keep `transform`/`background`/`opacity`. The thickness then snaps, which is
  what a drawn line should do.
- **Yahtzee's Google Fonts — `yahtzee/js/ui.js:1618-1623`.** Promoted here from "loose ends": it is
  the only render-blocking cross-origin request in the app, outside `ASSETS`, invisible to the
  service worker, and offline the first paint waits out the browser's full font timeout. Self-host
  the two faces. (I could not measure the delay — Chromium in this container cannot reach
  `fonts.googleapis.com` at all, with or without the service worker, so my earlier 8 s figure was a
  sandbox artefact. Measure on a real phone.)
- **Conventions checks so none of it returns**, using the `KNOWN_GAPS` idiom
  (`test-game-conventions.mjs:40`) for anything deliberately left: (1) any `<game>/js/*.js` calling
  `requestAnimationFrame` must also contain `cancelAnimationFrame`, and a `this.raf =
  requestAnimationFrame(` outside a `tick|loop|frame` function must be preceded by a
  `cancelAnimationFrame(this.raf)`; (2) no `transition:` list in `<game>/css/*.css` containing
  `width` or `height`. Park `filler:191`, `pool:310`, `css/challenge.css:336` (progress bars,
  cosmetic) in `KNOWN_GAPS` unless they are free.

---

## Batch 4 — Whatever is left

The 11 px text floor (22 entries, mostly Yahtzee) and anything deferred from above.

---

## Verification

Run only the suites covering what changed — never `run-all-tests.mjs` (root `CLAUDE.md`).

**`validate-sw-assets.mjs` before every deploy**, and note that Batches 2, 3 and 4 all edit
`<game>/` files, so each forces a `REST_MANIFEST` regen and a `sw.js` commit or
`test-sw-strategy.mjs`'s disk-hash check fails.

**Batch 1's tests are the deliverable, not an afterthought.** In `test-sw-strategy.mjs`:

1. **No phantom entries** — every `NETWORK_FIRST` path must exist in `ASSETS`, so a rename cannot
   silently demote a data module to cache-first.
2. **The drift guard Matt asked for** — for every `./js/**.js` in `SHELL_CACHE_FIRST`, fail if the
   file matches a player-data signature (`localStorage.setItem(`/`removeItem(` with a `gamehub.`
   key, or a static import edge into `net.js`/`firebase-boot.js`/`game-stats.js`/`stats-net.js`/
   `profile-store.js`/`arcade-scores.js`). The failure message must name both fixes.
3. **Pin non-transitivity, loudly, in a comment.** `js/hub.js:9` statically imports
   `profile-store.js` and stays cache-first — correct, because ES modules are fetched per URL. A
   future session "fixing" guard 2 into a transitive closure would drag `hub.js`, `name-gate.js` and
   `announce.js` into `NETWORK_FIRST` and delete the entire win.
4. **`[KNOWN-BUG PROBE]` for `sw.js`** — seed the cache with it, fetch, assert it hit the network;
   spell out the consequence (pill can never go stale, `_forceUpdate()` never reloads).
5. **Positive pins** — `SHELL_CACHE_FIRST` must contain `./js/hub.js`, `./css/hub.css`,
   `./css/ui.css`, `./js/game-art.js`, `./js/strings.js`.
6. **Flip the two probes that now assert the opposite.** `:370-378` (currently "a SHELL module still
   prefers the network", using `./js/hub.js` — I wrote it this morning) moves to a still-network-first
   path and gains a mirror assertion that `hub.js` is cache-first. `:515-521` uses
   `./css/name-gate.css` on the network-first fallback path, which becomes cache-first — swap it or
   the test passes while testing nothing.

Also Batch 1: `test-stats-identity.mjs` (the `hasName` move), `test-admin-config.mjs`,
`test-bug-report.mjs`, `test-messages.mjs`, `players-agg.test.mjs`.
Batches 2-3: `test-game-conventions.mjs` plus each touched game's own suite, and `test-visual.mjs`
for the games touched — **ask Matt before sweeping all 20** (his rule, 2026-08-08).

**Measured, not asserted.** Re-run the launch and per-game harnesses from this session and record
before/after for requests, gzipped wire bytes, first paint and tap→game-on-screen. A batch that does
not move its number goes back.

## Deploy

Every batch ships live, per root `CLAUDE.md`: commit → push → PR into `main` → merge → verify the
`pages build and deployment` run reaches `completed`/`success` → confirm against the deployed files.
