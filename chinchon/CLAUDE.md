# Chinchón (`chinchon/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — the nine full rules repeat throughout the root `CLAUDE.md`, which is always
> loaded alongside this file. Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`. No mid-game resume meaning for `isInProgress()` — see the
games table below and the root CLAUDE.md's module-contract section for the two-meanings list.

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

### UI notes (2026-07-22)

- **Per-opponent difficulty selector**: `_seg()`'s per-instance index (`data-i`) lives on the WRAPPING `.cc-segmented` div, not the button - the click handler must climb to it (`a.closest('.cc-segmented').dataset.i`, matching Escoba's own handler) rather than read `a.dataset.i` directly off the clicked button. Reading it directly (the bug, now fixed) always resolved to `NaN`, so the selection never actually changed and the highlight never moved.
- **End-game modal** (`_renderMatchModal`) has a `.cc-sheet-x` close button (mirrors Escoba's `.eb-sheet-x`) that just hides the modal and re-renders the board underneath - "New Game" is a separate, unrelated action.
- **Hand row split is player-controlled, not a fixed formula.** `ui.js`'s `_handBreak` (top-row card count) used to be recomputed every render as `order.length - 4` (always exactly 4 cards on the bottom), which silently undid any row a player dragged a card into. It's now a persisted value that only changes when a drag crosses the row boundary (`_dropRow`/`_applyDrop`), or resets to that same default split on a fresh hand or a resort - so 7 or 8 cards can sit in either row, including all of them in one row and none in the other. Because a row can now hold more than 4, `--cc-hand-overlap` is also computed dynamically per render (measured against the real container/card widths) whenever the largest row exceeds 4, so a full row still lays out on one visible line instead of silently wrapping onto a second line within itself.
- **Highlight-sets groups, it does not paint (batch 10 revision).** The `cc-meld-c0..c5` classes used to each carry a different hue (including both green and red, a THE LAW rule 9 violation), then a first fix rang every meld in one shared color - which fixed the colorblind issue but kept the "painted" look Matt disliked without being able to name why. The current treatment (`chinchon/css/chinchon.css`'s CH-1 block) drops the ring: each melded card lifts slightly (`transform: translateY`, so toggling highlight-sets on/off never shifts layout) and gets a thin `#ffce3a` accent bar along its own bottom edge (inside the card, since `.cc-card` is `overflow: hidden` for its rounded corners - reads the same at this size); the small numbered badge (`data-meld-num`, a card's own `::after`) stays as the actual non-color differentiator between simultaneous melds, since lift+bar alone don't distinguish which meld a card belongs to. Non-melded cards dim by a lighter notch than before (`grayscale(0.55)`/`opacity: 0.72`, was full grayscale at 0.5 opacity - read as harsh).
- Both fixes are phone-viewport / narrow-hand concerns; a `PHONE_WIDTH_MAX` (699) guard keeps a short-but-wide desktop window from triggering the row-fit logic, matching this file's own `@media (min-width: 700px)` desktop breakpoint.

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
- **Decks can be thin overrides.** A registry entry may set `base: '<deckId>'` plus an
  `own: Set` of the face names it actually ships (`'oros-1'`, `'back'`, …). `ownerDeck()`
  resolves every face to the deck that holds the file, so a *skin* can swap a few cards
  and inherit the rest from its base — no asset duplication. `anita` started as an Española
  skin (only `oros-1..9`) and grew card-by-card until it now owns **all 48 faces + back** (a
  full custom deck), so its `baraja-libre` fallback no longer fires. Plain decks (no
  `base`/`own`) resolve to themselves, so existing behaviour is unchanged.

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
- **Pass 4 (done):** a full second deck **`anita`** — a personal "friends" deck, complete.
  **Pips (1–9, all suits):** Oros = a supplied gold "Ana" coin, Copas = a beer mug, Bastos =
  a golf driver, Espadas = a pickleball paddle (original SVG emblems). **Court cards (10–12,
  all suits):** 12 AI-illustrated *baraja española* court cards of real friends (Ana + Matt)
  in period costume matched to each suit's theme, generated in ChatGPT/Gemini from a
  face-first portrait + a pose reference, then fit to 400×616. **Back:** Ana's photo
  (background-removed) on an original green/gold 180°-symmetric design. **Betty win/lose
  screens:** the end-of-match modal shows a toddler-reaction photo when the Anita deck is
  active (`decks/anita/betty-{win,loss}.webp`, gated in `ui.js`). A **deck picker** in setup
  (`open-deck`/`pick-deck`/`close-deck`) calls `setDeck()` + `preloadDeck()`, persists `deck`
  in `chinchon-settings`, and shows each deck by its full card back. `sw.js` precaches every
  anita asset; the default deck is `anita`
  (`DEFAULT_DECK` in cards.js, `DEFAULT_DECK_ID` in ui.js — flip both to change it). Pip/back art was built by scratch
  `sharp` scripts (not in-repo); court cards were AI-generated per the prompts in
  `../ChinChon/court-card-prompts.md`.
- **Roadmap (not built):** optionally unify the flat pip style with the illustrated court
  cards; one-undo affordance; sound.

### Tests

```
node chinchon/js/test.js   # engine unit assertions (deck + meld)
node chinchon/js/sim.js     # 30 all-AI matches; checks termination, scoring, no exceptions
```
Run requires Node ≥22.7 (ESM syntax detection; there is no package.json).

---

## Hub notes

Chinchón: in-hub `module:` — Spanish rummy vs AI. No worker (light heuristic AI). See the rest of this file.

## MP invariants (July 2026 hardening — full list + rationale in the root CLAUDE.md,
"Multiplayer lockstep — invariants"; regression tripwires in `test-mp-lockstep.mjs`)

The Chinchón-side obligations: the engine decides the match end BEFORE emitting `roundScored` and
announces it as `payload.matchOver` — every MP gate keys on that field, never `this.game.winner`
(null at that moment for points/rounds endings); `config.presetStockResets` is a shift()-consumed
queue, never indexed by the per-round `resetsUsed` counter; `_mpApplyRecovery` remaps the
transmitted snapshot's device-relative `isHuman` flags by seat before rebuilding; and a
round-boundary snapshot (`midRound:false`) resumes via `_resumeNextRound` (never `initMatch()`,
which zeroes every score), with a restoring guest awaiting the host's published round record
(`_mpAwaitNextRound`) before playing.
