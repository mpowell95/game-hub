# Game Hub — CLAUDE.md

A small, ad-free, installable **PWA that hosts self-contained game modules**. Vanilla
JS (ES modules), **no build step, no dependencies, no framework**. Deploys as static
files (e.g. GitHub Pages).

## Run it

```
node server.mjs           # serves the repo root at http://localhost:8123
#   http://localhost:8123/              hub launcher
#   http://localhost:8123/connect-four/ a game, standalone
#   http://localhost:8123/chinchon/     a game, standalone
```
A plain dev server is required (ES modules, module workers, and the service worker
can't run from `file://`). It sends `Cache-Control: no-store` so dev edits aren't cached.

## Architecture

```
index.html              hub shell host
js/hub.js               launcher grid + module mount/unmount  (the GAMES registry)
css/hub.css             shell chrome only
sw.js                   shared service worker (network-first, precaches every game)
manifest.webmanifest    one manifest for the whole hub
<game>/                 one folder per game (connect-four/, chinchon/, …)
```

The hub shows a grid of game cards. Tapping a **module** game dynamically imports its
entry and mounts it into a content area (no page reload); tapping a **launch-out** game
navigates to its own deployed URL.

### The module contract

A game module's entry (`<game>/js/ui.js`) exports exactly:

```js
export function init(container) { /* mount the whole game UI into `container` */ }
export function destroy() { /* remove ALL document/window listeners, stop timers/workers, clear container */ }
export default { init, destroy };
```

- The hub mounts with `const m = await import(game.module); m.init(el);` and tears down with
  `m.destroy()` on back-navigation. **`destroy()` must be leak-free** — the hub reuses the
  same container for the next game.
- Keep a module-level `let instance`; `init` replaces any prior instance.
- The game must also run **standalone** from its own `<game>/index.html`, which links its
  CSS and calls `init(document.getElementById('<game>'))`. Same `init` either way.

### Adding a game — checklist

1. Create `<game>/` with `index.html`, `css/<game>.css`, `js/ui.js` (+ engine modules).
2. `ui.js` exports `init`/`destroy` and injects its stylesheet idempotently via
   `new URL('../css/<game>.css', import.meta.url)` (so it's self-contained in the hub).
3. **Scope all CSS** under a root class `.xx-root`; prefix every class `.xx-` and every
   custom property `--xx-`. No global selectors.
4. Add an entry to `GAMES` in `js/hub.js`:
   - in-hub module → `module: '../<game>/js/ui.js'`
   - separately-deployed app → `href: '/<game>/'`
   - plus `id, title, blurb, badge, accent, art` (inline SVG).
5. Add the game's files to the `ASSETS` precache list in `sw.js` and **bump `CACHE`**
   (`game-hub-vN` → `vN+1`), or the new files won't be cached for offline.

## The games

| Game | Integration | Notes |
|---|---|---|
| Connect Four | in-hub `module:` | AI in a Web Worker (`new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`) with a main-thread fallback; needs the worker for its multi-second Expert solver. |
| Chinchón | in-hub `module:` | Spanish rummy vs AI. No worker (light heuristic AI). See below. |
| Business Deal | launch-out `href:` | Its own full-screen PWA deployed alongside; uses `window.*` globals, not ESM. A precedent, not the preferred pattern. |

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
- **Multi-deck ready:** the registry supports more decks; a settings deck-picker is the
  natural next step. **Later polish (not built):** one-undo affordance, sound.

### Tests

```
node chinchon/js/test.js   # engine unit assertions (deck + meld)
node chinchon/js/sim.js     # 30 all-AI matches; checks termination, scoring, no exceptions
```
Run requires Node ≥22.7 (ESM syntax detection; there is no package.json).
