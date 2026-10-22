# Make the whole app feel fast

## Context

Matt: *"I want everything to load as quickly as possible... fast loads, everywhere in the app and
within each game to feel responsive. Overall I want it to just feel better."*

This started from Anita's screen recording of opening Skeeball. That fix shipped today (v542): game
code is now served from the phone's cache instead of re-downloaded, and Skeeball went from 2,188 KB
per open to 19 KB. A second session then shipped v545/v546, which killed the white flash on the
hub↔profile trip (theme stamped before first paint, plus a first-paint skeleton in `index.html`).

Both were real wins. This plan covers what is left, measured rather than assumed.

### Where it actually stands, measured on v546 (warm cache, 4× CPU throttle)

| | |
|---|---|
| Hub: first pixel (the new skeleton) | **64 ms** |
| Hub: real launcher on screen | **90 ms** |
| Hub: bytes that leave the device **on every launch** | **688 KB across 35 requests** |
| Game mount, median of 20 | 63 ms |
| Game mount, worst (Escoba) | 204 ms, **137 ms of it unstyled** |
| Layout shift when the skeleton is replaced | 0.001 — negligible, not a problem |

The skeleton is doing its job; at 20× CPU throttle I could not catch it before the real launcher
landed. **The remaining problem is not the first paint. It is the 688 KB, the absence of any
feedback when you tap a game, and real jank inside a few games.**

I prototyped the shell cache change in a scratch copy: **688 KB / 35 requests → 116 KB / 3.**

### Decisions Matt already made (do not revisit)

1. **Shell caching: "keep the stats code fresh."** Cache the big non-data shell files; the modules
   that read or write player data stay on the network. He accepts that a hand-maintained list can
   drift — so it gets a structural test that fails when a data-writing module is missing from it.
2. **Repair the boot guard**, and add a test so it cannot be silently switched off again.

---

## Batch 1 — The launch

Goal: stop re-downloading the app on every open, and get the data-touching code off the critical
path so it can stay fresh without costing anything.

### 1a. Split the shell into cache-first and always-fresh — `sw.js`

Today `sw.js:944-946` serves images/fonts and the REST tier (game files) cache-first; everything
else is network-first. Add a third set: shell files that are **always** network-first, and let the
rest of the shell fall into the cache-first branch.

- **Always-fresh (never cached-first):** `sw.js` itself, plus every module that reads or writes
  player data or gates its visibility — `game-stats.js`, `game-stats-global.js`, `stats-net.js`,
  `profile-store.js`, `players-agg.js`, `stats-corrections.js`, `arcade-scores.js`, `messages.js`,
  `bug-report.js`, `device-report.js`, `admin-config.js`, `error-log.js`, `net.js`, and the display
  gates `leaderboard-ui.js`, `game-stats-ui.js`, `messages-ui.js`, `bug-report-ui.js`,
  `admin-ui.js`.
- **`sw.js` MUST be in that set.** `js/hub.js:794-800` `_latestVersion()` fetches it to read the
  deployed version; served from cache, the version pill can never go stale and `_forceUpdate()`
  never reloads. This is the one hard breakage in the whole plan.
- Most of the display gates are already lazy-imported on tap, so keeping them fresh costs nothing
  at launch.
- Navigations stay excluded (`req.mode !== 'navigate'`), as now.

**Update the comments that will otherwise be lies:** `sw.js:893-898` and root `CLAUDE.md:215-219`
both state the shell is deliberately network-first for exactly this reason. They must describe the
split that ships.

### 1b. Stop downloading `sw.js` twice per launch

`_latestVersion()` (`js/hub.js:794-800`) pulls the whole 52 KB worker to read one version string;
the browser's own update check fetches it again. ~104 KB per launch. Replace the pill's read with a
tiny generated `version.json` (maintained by `validate-sw-assets.mjs` alongside `REST_MANIFEST`,
added to `ASSETS`). Keep `_runningVersion()`'s `GET_VERSION` message as-is.

### 1c. Get the heavy data modules off the boot path — `js/hub.js`

`js/hub.js:11` statically imports `stats-net.js`, which drags in `game-stats.js` (91 KB),
`arcade-scores.js`, `firebase-boot.js` and `install-state.js` — none of which the launcher grid
needs. It is used only by `_syncStats()`, fired at `:388` **after** `render()`. `:15`
`name-gate.js` is first-run only and re-pulls the same graph.

Make both dynamic. Combined with 1a this is the point: the launcher paints entirely from cache, and
the always-fresh data code loads from the network *behind* it, where its latency is invisible.

### 1d. Let the launcher paint before the background work starts

`js/hub.js:392-394` and `:402` fire dynamic imports for `bug-report.js`, `messages.js`,
`messages-ui.js` and `bug-report-ui.js` unconditionally in the constructor, immediately after
`render()`. Defer to idle so they stop competing with the first paint. Nothing about the badges
changes, only when their code is fetched.

### 1e. Repair the boot guard — `index.html`

`index.html:182`: `if (root.children.length > 0) return;`. The v546 skeleton is a child of
`#hub-root` from parse time, so the watchdog stands down unconditionally and can never fire — the
self-repair Matt added in August is dead. Make it test for the **real** launcher (the skeleton
carries `.hub-skel`) rather than "anything at all".

---

## Batch 2 — The tap

Goal: tapping a game tile should feel instant and should never look like nothing happened.

`js/hub.js:974-998` has **no loading state of any kind**, and the ordering works against itself:
`unmount()` blanks the container *before* `await import()` starts, and `game.hidden` is only
cleared *after* `init()` returns — so there is no frame in the sequence where anything could be
shown.

- **Warm the module on `pointerdown`**, before the tap completes. On a phone that is 80-150 ms of
  head start, free.
- **Give the tapped tile a pressed/busy state** so the tap visibly registers.
- **Guard `launch()` re-entrancy.** Two fast taps both proceed today and `init()` into the same
  container, because the second call's `unmount()` sees `this.current` still unset.
- **Reorder**: keep the launcher up until the module resolves, rather than blanking first.
- **Move the CSS gate into `js/hub.js`.** Only Skeeball waits for its stylesheet
  (`skeeball/js/ui.js:57-91` is the reference). The hub is the thing that unhides the container, so
  it can snapshot the stylesheet links before `import()` and wait for any new ones after `init()`.
  Covers all 20 games and every future one; Skeeball's bespoke gate then comes out.
  - Note: Skeeball's own gate currently waits on `css/ui.css`, which is SHELL/network-first, so on
    a slow link its 1500 ms cap fires and the flash returns. **Batch 1a fixes that** — `ui.css` is
    not a data module, so it becomes cache-first.

---

## Batch 3 — Jank inside the games

- **Pinball has the rAF double-chain bug Skeeball already fixed.** `pinball/js/ui.js:303` arms the
  loop with no idempotence guard, reachable from both setup Play (`:150`) and the game-over "Play
  again" (`:651`), which does not stop the previous chain. Each replay orphans a loop that
  `destroy()` cannot cancel and that **keeps running in the hub for the life of the page**. Port
  the fix from `skeeball/CLAUDE.md:1298-1330`.
- **Hill Climb never stops its loop.** `hill-climb/js/ui.js:132`, `:643-644` — it re-arms before
  its screen check, so it wakes at 60 Hz on the garage and menu screens for the whole mount.
- **Two non-compositor transitions on gameplay/input paths** (forbidden by
  `docs/BUILDING-A-GAME.md:48-49`): `escoba/css/escoba.css:390` transitions `width`+`height` on
  every card move, and `dots-boxes/css/dots-boxes.css:338` does the same on `.db-line` with 220
  edges firing on the primary tap. Both force layout every frame. (`filler:191`, `pool:310`,
  `css/challenge.css:336` are progress bars — cosmetic, fold in only if free.)
- **Add conventions checks** to `test-game-conventions.mjs` for rAF idempotence and for animating
  non-compositor properties, so none of the above can come back.

---

## Batch 4 — Loose ends

- **Yahtzee's Google Fonts.** `yahtzee/js/ui.js:1618-1623` injects a cross-origin stylesheet on
  every mount. It is render-blocking, not in `ASSETS`, invisible to the service worker, and never
  resolves offline — the only external dependency any game has. Self-host the two faces.
- **Three games double-load their own stylesheet standalone.** Pinball, Hill Climb and Pipes check
  only for a marker attribute, so their own `index.html` `<link>` is not recognised. Skeeball's
  href-matching guard (`skeeball/js/ui.js:63-66`) is the fix; propagate it. Hub path unaffected.

---

## Verification

Run only what the changed files cover (root `CLAUDE.md`: never `run-all-tests.mjs`).

- **Every batch:** `node validate-sw-assets.mjs` before any deploy.
- **Batch 1:** `test-sw-strategy.mjs` — its shell probe at `:370-378` asserts the opposite of what
  will ship and must be rewritten; `:515-521` also uses the network-first path. Add: a probe that a
  cached non-data shell module is served from cache, that a data module is **not**, that `sw.js` is
  never served from cache, and the **structural guard** that fails if any module writing player data
  is missing from the always-fresh list. Plus `test-bug-report.mjs`, `test-messages.mjs`,
  `test-admin-config.mjs`, `players-agg.test.mjs`, `test-stats-identity.mjs`.
- **Batch 2:** `test-game-conventions.mjs`, then `test-visual.mjs` on a sample of games (ask Matt
  before sweeping all of them — his rule, 2026-08-08).
- **Batch 3:** `test-game-conventions.mjs`, `skeeball/js/test.js`, and `test-visual.mjs` for
  pinball, hill-climb, escoba, dots-boxes.
- **Measured, not asserted:** re-run the launch and per-game harness (rebuild from this session's
  scratch scripts) and record before/after for bytes over the wire, requests, first paint, and
  tap→game-on-screen. A batch that does not move its number goes back.

## Deploy

Per root `CLAUDE.md`, each batch ships live: commit → push → PR into `main` → merge → verify the
`pages build and deployment` run reaches `completed`/`success` → confirm against the deployed
files. Bump `CACHE` **past what is on `main` at that moment**, not past the working copy.
