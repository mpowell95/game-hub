Pulled the clip out of `skeeball/` and stepped through it frame by frame (60 fps), then reproduced the launch in a real browser against the actual service worker.

## What the recording actually shows

| time | what's on screen |
|---|---|
| 4.17s | she taps Skeeball |
| 4.58s | gallery appears (0.4s — the good case) |
| 8.15s | back on the hub |
| **10.30 → 11.02s** | **the app restarts itself** — dark splash, then a blank white launch screen, then the hub again |
| 15.18s | she taps Skeeball again |
| 15.92s | **raw unstyled HTML** — giant black lock, no CSS at all |
| 16.48s | CSS finally applies |
| 16.55s | the machine picture paints (1.4s total, 570ms of it looking broken) |

She's right that she never left. That white gap at 10.3s is the PWA's web view being discarded and relaunched underneath her.

## Why

**1. Tapping Skeeball loads 2.3 MB of JavaScript across 41 module files.** For comparison, from the same walk of the import graph: Ball Run 988 KB, Pinball 418 KB, Escoba 328 KB, Pool 288 KB, Hill Climb 239 KB. Skeeball is 7× the median and 2.3× the next biggest.

**2. It re-downloads all of it, every single time.** I proved this rather than guessed it: I warmed the service worker cache until `three.core.min.js` was verifiably in it, reloaded, then opened Skeeball through a logging server. **28 requests and 2,188 KB left the device anyway.** `sw.js` is network-first with `cache: 'reload'` for `.js`/`.css`, so the cached copy is only used if the network *loses* a 2.5s race. On any connection that isn't outright broken the cache buys nothing, and `SLOW_LATCH_MS` only kicks in after one request has already stalled the full 2.5s.

**3. Almost none of that is needed to draw that screen.** `skeeball/js/engines.js` statically imports all five machines' `physics.js` + `machine.js` + `render.js`, which drags in three.js (733 KB, two files — that's the normal split build, not a duplicate) and cannon-es (338 KB), to show one still picture of THE CLASSIC:

```
as shipped                                  41 files, 2318 KB
only THE CLASSIC's engine up front          29 files, 1677 KB
+ cannon-es deferred until Play             27 files, 1309 KB
+ the 3D preview deferred (setup only)      23 files,  463 KB
```

**4. The unstyled flash is a one-line ordering bug.** `ensureCSS()` (`skeeball/js/ui.js:41`) appends the stylesheet `<link>`, and the constructor renders the DOM on the very next line (`:311-313`) without waiting for it. That's the 570ms of raw HTML. And `skeeball.css` is itself on the network-first path, so it's a fresh 64 KB download on every mount.

**5. The restart.** 2.3 MB of resident JS plus a WebGL context and full three.js scene built per carousel card (`renderMachineImage`, `:211`) is exactly the footprint that gets a PWA's web view reclaimed on iOS. The GL teardown itself is already careful (`releaseRenderer` does `forceContextLoss`), so it's the sheer size, not a context leak.

## What I'd do about it

1. `engines.js` → dynamic `import()` per machine, only the one being shown or played (−640 KB).
2. Split each machine's physics from its render so cannon-es loads on Play, not on the gallery (−338 KB).
3. Serve game code cache-first instead of network-first. The `CACHE` bump already *is* the version — that's what makes it safe, and it's what takes a warm-cache open from 2.2 MB to ~0. If you want that narrower, `/skeeball/js/vendor/*` and `machines/*` alone would cover most of it.
4. Await the stylesheet before the first paint, or move `skeeball.css` into the shell tier.

Together that should be tap → gallery with essentially nothing on the wire, and no unstyled flash.

Two side notes: the `.mp4` is committed to `main`, so it's live on the site and `validate-sw-assets.mjs` will flag it as an undeclared deployed file — say the word and I'll move it out. And I installed ffmpeg and `playwright-core` in this container to do the analysis; nothing was committed.

Want me to build the fix? Items 1, 2 and 4 are contained to Skeeball; item 3 touches `sw.js`'s strategy, which has a lot of documented history behind it, so I'd rather you say yes to that one explicitly.