# The version chip lied, and tapping it made things worse

## Context

Matt's third recording of the day (`reference/ScreenRecording_09-01-2026 17-19-40_1.mp4`, 13.6s).
The chip in the top bar reads **`v551 → v552`** for the whole clip. At 7.0s he taps it, it says
"Checking…", and by 7.3s it is back to `v551 → v552`. At 8.7s he force-quits the app, which fixed
it. His question: *why was that happening?* And his standing goal: *"I want people to be wowed at
this. All these weird glitches and bugs make me seem like an idiot."*

**Nothing was broken. The app had already updated itself. The chip never noticed.**

Measured, not inferred:

1. **The install was not failing.** Root `CLAUDE.md` says a stuck `vN → vN+1` means the new service
   worker's install failed — the atomic `cache.addAll(SHELL)` aborting on one 404. I pulled the
   deployed `sw.js`, extracted its 62 SHELL entries and requested every one against the live site:
   **0 non-200.** That documented cause is ruled out, and the doc sends the next session hunting it.
2. **The chip is painted exactly once and never repainted.** `_initVersionPill()` (`js/hub.js:845`)
   runs on load. There is no `controllerchange`, `updatefound` or `statechange` listener anywhere in
   the repo — grep confirms zero hits. So a successful update cannot reach the chip.
3. **Reproduced in a real browser** (scratchpad copy of the site, `v551` cache, then `v552`
   deployed exactly as a real deploy does):

   ```
   t+1000ms  pill=v551 → v552   controller=v551     <- new worker still installing
   t+4000ms  pill=v551 → v552   controller=v551
   t+8000ms  pill=v551 → v552   controller=v552     <- the update LANDED
   controllerchange events fired on this load: 1    <- the browser DID tell the page
   ```

   The device was running v552 while the chip insisted it was not.
4. **Tapping it cannot help, by construction.** `_forceUpdate()` (`js/hub.js:869`) awaits
   `reg.update()` — which resolves when the registration job completes, **not** when the new worker
   has activated — then immediately reads the controller (still the old one), concludes "stale", and
   calls `location.reload()`. A reload at that exact moment is the one reload that changes nothing.
   The page comes back and paints the same stale chip. That is the "Checking… → `v551 → v552`" the
   recording shows, at 300ms.

Force-quitting worked because it is the only action that guarantees a fresh `_initVersionPill()`
with the new worker already in charge.

**Also observed, and deliberately not attributed:** at ~2.1s the launcher's first-paint skeleton
appears for ~170ms — the page reloaded on its own, before he touched anything. The same shape
appeared in the morning's recording ("the app RESTARTS ITSELF"). Most likely iOS reclaiming the web
view, but I have no evidence and will not guess; the breadcrumbs below are what would settle it.

### The through-line worth naming

Every glitch he has filmed today is the same bug wearing a different face — **a screen paints a
provisional state and has no path back to the truth:**

| what he saw | what was painted | what never arrived |
|---|---|---|
| broken machine images (v549) | an `<img>` with no `src` | — |
| "the leaderboard needs a connection" (v549) | offline, on a 3.5s timer | reality |
| "Hub-wide record: -" (v550) | a dash | the answer, with no repaint |
| empty machine box (v550) | nothing at all | the picture |
| **`v551 → v552` stuck** | a stale snapshot | the update landing |

That is one root cause, five symptoms, and it is why the app feels glitchy rather than broken.

---

## The change

**Matt's call (asked and answered): the hub refreshes itself silently.** New build lands while he is
on the launcher → the hub reloads itself. Mid-game → nothing happens, and it applies when he next
returns to the launcher. He should effectively never see the chip do anything again.

### 1. Subscribe to the update lifecycle — `js/hub.js`

The missing half. Register once, at init:

- `navigator.serviceWorker.addEventListener('controllerchange', …)` — the new build is now in
  charge. This is the event that already fires today and that nothing listens to.
- `reg.addEventListener('updatefound', …)` → the installing worker's `statechange`, so the chip can
  say **"Updating…"** during the download instead of the alarming `v551 → v552` arrow. That arrow
  read as *"you are stuck, do something"*, which was never true — with `skipWaiting()` the app is
  already updating itself, unprompted.

### 2. Silent refresh, gated on the launcher — `js/hub.js`

On `controllerchange`: repaint the chip to the new running version, then

- **`this.current` is set** (a game is mounted — `js/hub.js:380`, and `js/hub.js:427` already uses
  `if (!this.current)` as the precedent for exactly this gate) → **do nothing.** Set a flag; apply
  it when he next lands on the launcher. A game is never interrupted, mid-rack or not.
- **on the launcher** → `location.reload()`.

**Two guards, both load-bearing against a reload loop:**

- Reload **at most once per page session** (`this._reloaded`).
- Reload **only when the running version actually CHANGED** from the one this page loaded with —
  never merely because `latest !== running`. That distinction is the whole safety property: a
  half-deployed state where `version.json` and the worker's `CACHE` disagree must be able to sit
  there looking stale, not reload the app in a loop for ever.

### 3. Make the tap incapable of the useless reload — `js/hub.js` `_forceUpdate()`

Rewritten so it **waits for the new worker to actually take over** instead of reading a controller
that has not swapped yet:

- `reg.update()`, then await `controllerchange` with a bounded timeout (~20s).
- Fired → the new build is in charge → reload. That is the tap doing its job.
- `update()` found nothing new → "Up to date" (unchanged behaviour).
- Timed out → say **"Still updating…"** honestly and leave the listener armed, so the silent path in
  (2) finishes the job. **Never reload before activation** — that is the exact action that wasted
  his time and sent him to the app switcher.

### 4. Breadcrumbs — reuse `noteError()` in `js/error-log.js`

Measured cost: **0.067 ms per breadcrumb** with the ring at its full 20-entry cap (worst case), 2.8
KB stored. At ~3 per app open that is 0.2 ms — roughly 0.1% of one frame. It reuses the exported
`noteError(kind, detail)` that already exists for this ("Exported so a game can note something it
caught itself"), the existing `gamehub.errorlog.v1` key, and the existing Report-a-bug pipeline. No
new storage, no new UI, nothing on the render path.

Record: page load + running version, update found, update took over, and a `pageshow`/
`visibilitychange` that reveals an iOS relaunch. Today's second mystery would have been one line
instead of a video.

### 5. Fix the diagnostic that is now actively misleading — root `CLAUDE.md`

The "Diagnostic: the version pill stuck at `vN → vN+1`" section states that a stuck arrow means the
install failed. **That is now the less likely of two causes, and it cost me the first twenty minutes
of this investigation.** Rewrite it: a stuck arrow means either the chip is not listening (this bug)
or the shell install failed (the older one), and give the two-line check that tells them apart —
request the deployed `sw.js`'s SHELL entries, and look for a `controllerchange` listener.

### 6. The convention, so the other four faces stop recurring — `docs/BUILDING-A-GAME.md` Part 0

One bullet in the UX floor (auto-loaded on any UI change): **if you paint before the data has
arrived, name the path back to the truth** — the event, the callback or the repaint that replaces
the provisional state — and never leave a screen whose only correction is a reload. Carry the
five-faces table above into `js/CLAUDE.md` so the reasoning survives.

---

## Files

| File | Change |
|---|---|
| `js/hub.js` | the lifecycle listeners; silent refresh gated on `this.current`; `_forceUpdate()` waits for activation; breadcrumbs |
| `js/strings.js` | `hub_version_updating`, `hub_version_still_updating` (EN + ES) |
| `test-sw-update.mjs` (new) | the regression probe below |
| `CLAUDE.md` | rewrite the stuck-pill diagnostic; one row for the new script |
| `docs/BUILDING-A-GAME.md`, `js/CLAUDE.md` | the convention and the five-faces table |

## Verification

**The probe already exists and is already born red.** The scratchpad script that reproduced this
becomes `test-sw-update.mjs`: serve a copy of the site at v551, load it, flip `sw.js` + `version.json`
to v552 exactly as a deploy does, and assert

1. the chip ends up reading **`v552`** with no manual reload — it currently sits on `v551 → v552`
   for ever, which is the failure I measured above;
2. `controllerchange` fires and the chip repaints within a bounded window;
3. **no reload happens while a game is mounted** (mount one, deploy, assert the game survives);
4. tapping mid-install never reloads before activation.

Plus: `node test-sw-strategy.mjs`, `node test-game-conventions.mjs` (listener balance — the new
`controllerchange` listener must be removed on teardown), `node validate-sw-assets.mjs`, and a
`CACHE` bump past whatever is on `main` at that moment.

**Honest limit:** all of this is verified in Chromium. Matt's phone is iOS/WebKit, whose service
worker lifecycle is more conservative — so the silent refresh may land a beat later there. The chip
telling the truth does not depend on that; it is a pure repaint driven by an event WebKit also
fires.

## Deploy

Per root `CLAUDE.md`, no further confirmation: commit → push → PR into `main` → merge → verify the
`pages build and deployment` run reaches `completed`/`success` → confirm the deployed file → then
tell Matt it is **live**.
