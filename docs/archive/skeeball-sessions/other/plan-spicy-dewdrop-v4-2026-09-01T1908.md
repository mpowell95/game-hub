# Skeeball's gallery: the machine picture arrives late, on every swipe

## Context

Matt uploaded a second screen recording (`reference/ScreenRecording_09-01-2026 14-45-19_1.mp4`,
commit `3aa1dfe`) and asked me to watch it and address it. It is 32 seconds, 1206x2622 at 60fps,
running the deployed **v550** — so the two fixes from this morning are in it and both hold:
the broken-image icons are gone, and the hub-wide records read correctly (`500 · King of Games`,
`900 · King of Games`, `490 · King of Games`), so the "they all say I have the record" symptom does
not appear anywhere in this clip.

What the clip shows instead, stepped at 2fps:

```
2.0s   taps Skeeball -> the gallery is up, THE CLASSIC's picture box is EMPTY
3.0s   the picture paints                                        ~1.0s blank
4.5s   swipes to HOT SHOT                     blank
6.0s   paints                                                    ~1.5s blank
7.0s   swipes to BRICK CITY                   blank
16.0s  swipes to POPONGO                      blank -> 16.5s     ~0.5s
17.5s  swipes to RUNAWAY                      blank -> 19.0s     ~1.5s
25.0s  RE-ENTERS Skeeball, hub-wide record reads "-" -> 25.5s fills in
28.0s  swipes                                 blank -> 28.5s     ~0.5s, every swipe, still
```

Two separate late-arriving things, and both are mine, from PR #300 (the lazy-engine change that
took Skeeball's launch from 2,188 KB to 19 KB):

1. **The machine picture.** `_machinesWorthPainting()` paints only the selected slide, so every
   other machine's picture is rendered on the swipe that brings it into view. That render is
   `loadEngine(id, {physics:false})` (a dynamic import of that machine's `render.js` + `machine.js`,
   110-146 KB each) → one rAF → build a whole WebGL scene → `toDataURL`. Cold that is ~1.5s,
   warm ~0.5s, and **it starts from scratch on every mount**: `this._machineImg` is a per-instance
   field (`ui.js:317`), so leaving Skeeball and coming back throws every picture away.
2. **The hub-wide record.** `_refreshTopRecords()` awaits `readPlayersOnce()` — a full read of the
   `players/` node — with no local cache, so the first paint of every slide shows a dash. Worse,
   the picture has the records **baked into it** and is keyed on them, so when that answer lands
   the key changes and **the selected machine is rendered in WebGL a second time, on every mount.**

The empty box is what makes it read as broken rather than slow: `.sk-slide-machine` paints a flat
`#140d0a` and nothing else, so a loading picture and a failed one look identical.

Nothing here is a data problem and nothing below touches a stored record.

---

## The fix — four changes, in the order they pay

### 1. The pictures survive a re-mount (`skeeball/js/ui.js`)

Move the `_machineImg` map from the instance to **module scope**, with a small cap (~12 entries,
oldest evicted). Re-entering Skeeball then costs zero renders instead of one per machine viewed.

Safe by construction, and worth saying why: the key is already
`[board.id, allTime.score, allTime.name, best, today, last]`, so a number that moves mints a new
key and a stale picture can never be served — including across a profile switch on a shared phone,
since the picture is a pure function of exactly those values plus the board.

### 2. The next swipe is already drawn (`skeeball/js/ui.js`)

After the selected slide has painted, prewarm the **two immediate neighbours** through
`requestIdleCallback` — the same `_ensureMachineImg(b, imgEl)` path, so it fills the same cache and
genuinely sets the neighbour's `src`. Re-run on each carousel settle, so walking the carousel one
machine at a time is a cache hit every time.

Three constraints, all load-bearing:

- **Neighbours only, not all five.** Each extra machine is 110-146 KB of `render.js` + `machine.js`
  (three.js is already loaded and shared; `physics: false` keeps cannon-es out). Two neighbours is
  the smallest working set that makes the next swipe free.
- **Strictly sequential — never `Promise.all`.** One WebGL context at a time.
  `renderMachineImage` already hands its context back through `releaseRenderer` before returning,
  so sequential prewarm never adds to the page's context budget. Parallel prewarm would, and the
  budget is what made the whole hub choppy on 2026-08-26.
- **Cancelled on dispose and on leaving the setup screen**, and it must never run on the play
  screen — that is a live frame budget.

### 3. The empty box says "loading", not "broken" (`skeeball/css/skeeball.css`, `ui.js`)

While a slide's picture is in flight, mark it (`data-painting` on `.sk-slide-machine`) and paint the
hub's own skeleton idiom over it — `.hub-card-skel` in `css/hub.css:263` is the precedent and its
comment is the brief: *"deliberately flat and quiet."* Static, no spinner, no animation, tinted from
that board's own `look` so it reads as the machine arriving rather than an error.

Cleared when the `src` lands. **A failed render keeps the placeholder** rather than reverting to the
dead box, so the one case that genuinely is broken still doesn't look like a bug the player caused.

### 4. The hub-wide record is there on the first paint (`skeeball/js/ui.js`)

Seed `this.top` synchronously at mount from a small local cache
(`gamehub.skeeball.top.v1`, `{ boardId: { score, name } }` — five tiny objects), written after each
successful `_refreshTopRecords()`. The live read still runs on every mount and still replaces it.

This is the change that pays twice: the dash flash goes, **and** the picture bakes the right number
on its first render, so the second full WebGL render per mount disappears.

Four things to hold to, since this is the only change that touches anything record-shaped:

- It is a **display cache of other people's records**. It is never a source of truth, is never
  written to `gamehub.stats` or `players/`, and is refreshed from the network every mount.
- **The live answer replaces it — no `Math.max`.** The reflex here is THE LAW rule 2, and it is the
  wrong reflex: an admin void (`js/stats-corrections.js`) must be able to bring an app-wide record
  *down*, and a monotonic cache would pin a voided score on the backboard for ever.
- `myRecords()` — the player's own best/today — is **untouched** and still read from the real store
  every time. Nothing about the player's own history goes through this cache.
- Missing, malformed or unreadable falls back to exactly today's behaviour (a dash until the read
  lands), so the failure mode is the current one.

### 5. Regression cover

- **`skeeball/js/test.js`**, structural (the defect is in DOM code the node suite cannot mount),
  in the repo's `[KNOWN-BUG PROBE]` idiom: every `sk-slide-img` ships with a `src` (this morning's
  v550 fix has no test at all), the picture cache is module-scoped, and the prewarm is sequential.
- **`test-visual.mjs`**'s skeeball probe: after the gallery is up, assert the neighbouring slides'
  `img.src` becomes a `data:` URL without the carousel being touched.

---

## Files

| File | Change |
|---|---|
| `skeeball/js/ui.js` | module-scope picture cache; idle neighbour prewarm; `this.top` seeded from cache; placeholder flag |
| `skeeball/css/skeeball.css` | the `data-painting` placeholder on `.sk-slide-machine` |
| `skeeball/js/test.js` | the structural probes above |
| `test-visual.mjs` | the neighbour-prewarm assertion |
| `sw.js` | `CACHE` bumped past what is on `main` at that moment |
| `skeeball/CLAUDE.md` | this incident, under "What tapping Skeeball used to cost" (rule 9) |

---

## Verification

**Measure counts, not milliseconds.** Chromium here runs SwiftShader, so absolute render times do
not transfer to Matt's phone — but the numbers that matter are exact and do transfer:

| | before | target |
|---|---|---|
| WebGL renders on first mount | 2 (the dash pass, then the Firebase pass) | 1 |
| renders on the swipe to a neighbour | 1 | 0 |
| renders on re-entering Skeeball | 1 per machine viewed | 0 |
| slides showing an empty box | every un-drawn slide | none |

Harness: mount `skeeball/` in Chromium, instrument `renderMachineImage`, drive the carousel through
all five machines, leave to the hub, re-enter, and count. Plus the same run with `players/`
unreachable, to prove the offline path still renders once and shows a dash.

Suites (only what this touches — root CLAUDE.md's instruction, not `run-all-tests.mjs`):
`node skeeball/js/test.js`, `node test-skeeball-machine-spec.mjs`, `node test-game-conventions.mjs`,
`node test-visual.mjs skeeball`, then `node validate-sw-assets.mjs` before the deploy (it also
rewrites `REST_MANIFEST` and `version.json`, which is still stamped v548).

**Known flake, already measured, not caused by this:** `test-visual.mjs`'s skeeball PLAY probe
failed 2 of 3 runs on unmodified `main` with "the rack-over sheet never appeared." A failure there
needs re-running before it is believed.

**And the standing blind spot, which this does not close:** Chromium in this container cannot reach
`gstatic.com`, so no verification here exercises a real Firebase read. The `this.top` seeding is
therefore verified against a stubbed `readPlayersOnce`, and the live path is verified by Matt
reloading. That gap is what let breakage reach him twice today and is still the highest-value thing
to fix next.

## Deploy

Per root CLAUDE.md, no further confirmation: commit → push → PR into `main` → merge → verify the
`pages build and deployment` run for the merge commit reaches `completed`/`success` → then tell Matt
it is **live**.
