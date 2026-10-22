Surveyed all 20 module games. Nothing changed — this is the report.

## Headline: the re-download problem is gone everywhere, not just Skeeball

The `sw.js` cache-first change covers every game. Measured on a warm cache, mounting each game into the hub's own container: **`own files re-downloaded` is 0 for all 20**. That column is the one that was 2,188 KB for Skeeball this morning.

## Per game, warm cache, 4× CPU throttle

| game | import | init | unstyled | total | KB over wire | graph (files/KB) |
|---|---:|---:|---:|---:|---:|---|
| escoba | 49 | 18 | **137** | **204** | 46 | 18 / 328 |
| chinchon | 54 | 21 | **92** | **167** | 52 | 26 / 390 |
| skeeball | 38 | 28 | 30 *(gated)* | 96 | 19 | 23 / 477 |
| ball-run | 76 | 14 | 5 | 95 | 9 | 17 / **988** |
| hill-climb | 34 | 38 | 9 | 81 | 9 | 15 / 239 |
| pool | 46 | 19 | 10 | 75 | 46 | 19 / 288 |
| mancala | 50 | 15 | 6 | 71 | 46 | 17 / 287 |
| battleship | 43 | 17 | 6 | 66 | 46 | 18 / 352 |
| yahtzee | 40 | 18 | 7 | 65 | 41 | 13 / 251 |
| filler | 45 | 11 | 7 | 63 | 43 | 15 / 254 |
| pinball | 48 | 10 | 5 | 63 | 9 | 19 / 418 |
| boggle | 42 | 11 | 6 | 59 | 43 | 17 / 275 |
| tic-tac-toe | 37 | 13 | 7 | 57 | 43 | 15 / 266 |
| dots-boxes | 36 | 14 | 6 | 56 | 43 | 15 / 269 |
| connect-four | 35 | 14 | 5 | 54 | 11 | 16 / 260 |
| dominoes | 32 | 7 | 14 | 53 | 9 | 13 / 211 |
| pipes | 28 | 7 | 12 | 47 | 24 | 11 / 171 |
| uno | 31 | 7 | 5 | 43 | 9 | 10 / 195 |
| nuts-bolts | 28 | 7 | 5 | 40 | 9 | 10 / 186 |
| snake | 29 | 7 | 3 | 39 | 5 | 8 / 146 |

All times in ms. "unstyled" is how long the game's DOM is on screen before its own stylesheet has parsed — `hub.js` unhides the container the instant `init()` returns, so that window is what a player sees garbled.

## What's actually worth knowing

**1. Every game injects its CSS at mount without waiting for it.** Same pattern Skeeball had. Two are big enough to see: **escoba 137 ms** and **chinchon 92 ms**. Those are also the two with the largest stylesheets (48 KB, 38 KB) and the most bare top-level CSS rules in the repo. The other 17 are 3–14 ms — real, but below the threshold where you'd notice. Skeeball is the only one gated.

**2. Ball Run is now the heaviest game in the hub, by a lot.** 988 KB, and 672 KB of that is one file — a single-file `three.module.min.js` build, a different one from Skeeball's two-file split. It's a *different* problem from Skeeball's: nothing is redundant, it's just one big library, and it loads in 76 ms warm. Only a cold first-ever open would hurt.

**3. Pinball is the second-densest graph** (19 files, 418 KB) for a game that's still admin-only. `table-royal.js` alone is 105 KB.

**4. Every game still fetches 1–7 shared modules on every mount** — `js/net.js`, `js/difficulty-tiers.js`, `js/viewport.js`, `js/mp-code-copy.js`, `js/mp-reactions-ui.js`. That's 43–52 KB for the nine multiplayer games. It's correct by design (the shell stays network-first so a deploy is discovered), but it's the whole remaining cost, and `js/mp-*` is fetched by games whether or not the player is playing multiplayer.

**5. Yahtzee is the only game that render-blocks on a cross-origin stylesheet** — Google Fonts, for Baloo 2 and Luckiest Guy. The service worker can't precache it (different origin, not in `ASSETS`), so it's a real third-party request on every mount and it never resolves offline; Yahtzee falls back to Nunito. **I could not put a number on it** — Chromium in this container can't reach `fonts.googleapis.com` at all (it times out with the service worker *and* without it), so my first run's 8,007 ms is an artefact of my sandbox, not Yahtzee. The structural fact stands; the latency needs measuring on a real device.

**6. No JS errors on mount in any of the 20.**

For scale against where Skeeball started: the median game's total mount is **63 ms** and the worst is **204 ms**. Skeeball's was 4,400 ms on an unthrottled desktop before this morning.