# Building a game — docs/BUILDING-A-GAME.md

This file exists because a rule discovered while working on one game kept getting written down
only in that game's own folder, invisible to the next session working on a different game, and
rediscovered later as the same bug. Root `CLAUDE.md` is loaded every session regardless of task;
this file is loaded when the task actually calls for it — new-game work, or any change to a
game's UI/CSS/input handling (a `.claude/skills/` trigger does the loading; see its own file).

**How this relates to the other two process docs**: this file holds *rules a screen or a game
must satisfy*. `VISUAL-PROCESS.md` holds the *procedure for finding out whether it does*
(`test-visual.mjs`, screenshots, reference specs) — read it alongside this one for anything
visual. `js/CLAUDE.md` holds the *deep mechanics of the shared modules themselves* (THE LAW's
full rules, the multiplayer lockstep invariants, Firebase/data governance) — read it when working
inside `js/` or on stats/sync/MP code specifically, not for general game-building conventions.

THE LAW applies here like everywhere else in this repo. Nothing below overrides it.

---

## Part 0 — The UX floor

**Read this whenever you touch any game's UI, CSS, or animation — not just when building a new
one.** It exists because a 2026-08-21 Skeeball playtest found four real defects (sub-44px tap
targets, 10px text, no `safe-area-inset-bottom` handling, text left in the DOM invisible after a
fade) in an already-shipped game — and every one of those four had *already* been independently
discovered, fixed, and written up inside a *different* game's own folder doc, just never surfaced
anywhere a Skeeball session would see it. That is the whole thesis of this file.

- **Minimum text size is 11px.** Below that, text stops being comfortably readable on a phone.
  `tic-tac-toe/CLAUDE.md`'s how-to-play rule ("measure the actual rendered width, size down until
  it fits") is about *width*, not size — 11px is where that shrink-to-fit bottoms out. If a string
  still doesn't fit at 11px, shorten the string or rewrap it; do not go smaller.
- **Tap targets are 44×44px minimum, with a documented exception.** `dots-boxes/CLAUDE.md`
  deliberately uses `--db-tap: min(44px, dot+cell pitch)` instead of a flat 44px, because 220 edges
  cannot fit non-overlapping 44px hit zones inside a 540px board — and it verifies the alternative
  by testing `elementFromPoint` at all 220 centers for zero mismatches. That is the model: 44×44 is
  the default, and a real, verified, documented reason is how you depart from it — not a silent
  smaller number.
- **`safe-area-inset-bottom` on any screen with bottom-anchored controls.** A primary button
  pinned to the bottom edge can render under the home-indicator bar on notched devices without it.
- **Nothing stays in the accessibility tree, invisible, after it's done.** An element faded to
  `opacity: 0` (or otherwise hidden by decoration rather than removed) is still there for a screen
  reader. This is currently a doc-only rule — `test-game-conventions.mjs`'s "no class is both a
  layout container and something decoration hides" check catches one specific shape of this bug
  (a decorative class name colliding with a structural one, the exact way Battleship shipped a
  blank screen twice — see `battleship/CLAUDE.md`), but does not catch every case. Don't rely on
  the test; check it directly for anything you animate to invisible.
- **Animate only `transform`, `opacity`, `filter`, `box-shadow`.** Never `width`, `height`,
  `inset`, or `background-size` — those aren't compositor-only and will jank on a weak phone.
- **Every animation needs a `prefers-reduced-motion: reduce` branch that is an instant state
  change, and it must never `display: none` anything structural** — settle each element to its
  final pose instead of hiding it (`battleship/CLAUDE.md`). **Exception, and it matters**:
  reduced motion thins garnish, it does not freeze gameplay. `pinball/CLAUDE.md` states this
  directly — "a pinball table that does not move is not a pinball table." If the motion you're
  gating IS the game (a ball, a piece sliding into place, a card being dealt), reduced-motion
  should keep it moving and cut only the decorative extras (particles, screen shake, celebratory
  flourish) around it.
- **A blanket reduced-motion `transform: none !important` sweep can break elements that use
  `transform` for structural positioning, not just animation.** `.bs-sunk-banner` in Battleship
  used `translate(-50%, 0)` against `left: 50%` to CENTER itself; a blanket sweep zeroed that too
  and the banner rendered half off-screen. Check any new addition to a reduced-motion sweep list
  against this before assuming it's animation-only.
- **Dark mode is a `.gh-dark` class override, never a `prefers-color-scheme` media query in a
  game's own CSS.** `'auto'` is resolved once in JS (`js/theme.js`) so the toggle always wins.
- **Rapid taps on iOS Safari can trigger the text-selection gesture**, not a second tap. A control
  meant to be tapped repeatedly (a flipper, a fire button, a jump button) needs the four-layer fix
  `hill-climb/CLAUDE.md` worked out: `-webkit-user-select`/`-webkit-touch-callout`/
  `-webkit-tap-highlight-color: none` on the root's `*` descendant selector (not just the root —
  these don't inherit the way you'd expect), `pointer-events: none` on button label text nodes, a
  non-passive `touchstart` calling `preventDefault()` keyed by `Touch.identifier`, and a
  `selectstart`/`selectionchange` backstop.
- **An interactive tile or chip that's part of a repeating grid should not be a real `<button>`
  inside a flex/grid layout, on old WebKit.** Safari before 16.4 won't let a `<button>` be a flex
  container reliably. `dominoes/CLAUDE.md` states the fix — a `<div role="button" tabindex="0">`
  with delegated click/keyboard handling — as the general lesson, not a Dominoes-only workaround:
  "Nothing in the tile — the one component drawn hundreds of times per screen — should depend on a
  layout feature the parent has to cooperate with, or on a CSS property from the last three
  years." The same reasoning is why Dominoes avoids `aspect-ratio` (iOS 15+) in favor of the
  `width: 21%; height: 0; padding-top: 21%` square trick, which works everywhere.
- **A pulsing "look here" control should animate via glow, never scale.** A control that keeps
  changing size moves its own edge out from under a thumb already on the way down
  (`battleship/CLAUDE.md`).
- **If you paint before the data has arrived, name the path back to the truth.** Every glitch Matt
  filmed on 2026-09-01 - three recordings in one day - was this one bug wearing a different face: a
  screen painted a provisional state and had no way to correct itself.

  | what he saw | what was painted | what never arrived |
  |---|---|---|
  | broken machine images | an `<img>` with no `src` | - |
  | "the leaderboard needs a connection" | offline, on a 3.5s timer | reality |
  | "Hub-wide record: -" | a dash | the answer, with no repaint |
  | an empty machine box | nothing at all | the picture |
  | a version chip stuck on `v551 → v552` | a stale snapshot | the update landing |

  So when you paint a placeholder, a dash, a spinner or an empty box, write down in the same breath
  WHAT replaces it and WHEN - the event, the callback, the subscription. A screen whose only
  correction is a reload is not finished. The two shapes that keep recurring: **a timer standing in
  for a fact** (use the real event - `online`, `controllerchange`, a store's change hook), and **a
  one-shot paint of something asynchronous** (subscribe, or repaint when the answer lands).

- **A game screen that scrolls at all is a bug** (`dominoes/CLAUDE.md`). If content doesn't fit,
  that's a layout problem to fix, not something to let the page scroll around.

**If you are building a new game, keep reading — Parts 1-3 below are the rest of it. Otherwise
you're done; go make your change.**

---

## Part 1 — Building a game

### The module contract

A game module's entry (`<game>/js/ui.js`) exports exactly three functions, plus a default object
bundling them. All in-hub module games export all three; grep-verify before assuming otherwise:

```js
export function init(container) { /* mount the whole game UI into `container` */ }
export function destroy() { /* remove ALL document/window listeners, stop timers/workers, clear container */ }
export function isInProgress() { /* true if the hub should confirm before navigating away */ }
export default { init, destroy, isInProgress };
```

- The hub mounts with `const m = await import(game.module); m.init(el);` and tears down with
  `m.destroy()` on back-navigation. **`destroy()` must be leak-free** — the hub reuses the
  same container for the next game.
- Keep a module-level `let instance`; `init` replaces any prior instance.
- The game must also run **standalone** from its own `<game>/index.html`, which links its
  CSS and calls `init(document.getElementById('<game>'))`. Same `init` either way. Every
  module game's `index.html` must also be in `sw.js`'s `ASSETS` list (run
  `node validate-sw-assets.mjs` to check) — Connect Four's was missing for a long time before
  a July 2026 fix, which silently broke offline standalone play with no other symptom.
- **A standalone page must gate on the name before it mounts** (2026-07-31). Its inline module is
  `import { requireName } from '../js/name-gate.js';` then `await requireName();` **before**
  `init(...)` — copy the block from any existing game's `index.html`. A standalone page is a door
  into the hub like any other, and the ungated ones are exactly where the leaderboard's ~20
  permanent "Unnamed player" rows came from (`js/CLAUDE.md`, "Nameless devices"). The app is not
  playable without a name; a new game must not reopen that hole.
- `isInProgress()` gates the hub's "leave game?" confirm (`hub.js` calls it before
  navigating back to the launcher) and has **two legitimate meanings** depending on whether
  the game can resume:
  - **No mid-game resume** (Ball Run, Snake, Hill Climb, Pinball): returns `true` while a game/run
    is actually in progress, `false` otherwise. The literal meaning. Live-action runs; mid-run
    resume is meaningless.
  - **Autosave/resume built in** (every other module game — Escoba, Mancala, Connect Four,
    Tic Tac Toe, Dots and Boxes, Filler, Chinchón (solo), Boggle (solo), Nuts & Bolts, Uno, Pool
    (solo/practice), Skeeball): returns `false` for solo play even mid-game, because leaving is
    lossless — each game snapshots after every state-changing event and picks up where it left
    off on return. Save keys: `escoba-save`, `gamehub.mancala.game.v1`,
    `gamehub.connect4.save.v1`, `gamehub.tictactoe.save.v1`, `gamehub.dotsboxes.save.v1`,
    `gamehub.filler.save.v1`, `gamehub.chinchon.solo.v1`, `gamehub.boggle.save.v1`,
    `gamehub.uno.save.v1`, `gamehub.pool.save.v1`, `gamehub.dominoes.save.v1`,
    `gamehub.skeeball.save.v1` (Nuts & Bolts needed no new key — its existing
    `gamehub.nutsbolts.v1` kept-aside board already survived navigation). Escoba's, Chinchón's,
    Tic Tac Toe's, Mancala's, Dots and Boxes', Pool's and Boggle's MP paths are each the exception
    within the exception: `isInProgress()` returns `true` only while an active multiplayer match
    is live (leaving mid-MP genuinely abandons the room), so one function answers two different
    questions depending on solo-vs-MP context. **Yahtzee is a further exception within that
    exception**: it has no autosave at all, so leaving mid-solo-game IS a real abandonment, and its
    `destroy()` always calls `net.leaveRoom()` even on ordinary hub navigation — unlike Tic Tac
    Toe/Chinchón/Escoba, which deliberately do NOT abandon a room on ordinary back-navigation.
  When adding a game, decide up front which meaning applies and say so in a comment next to
  `isInProgress()` — don't leave the next session to guess from behavior alone.
- An `immersive: true` entry in `hub.js`'s `GAMES` array (Escoba, Mancala, Ball Run, Yahtzee, Pool,
  Hill Climb, Battleship, Skeeball, Pinball) collapses the hub's header to a floating back button
  for games with their own full-bleed chrome. It's a de facto fourth registry flag, same status as
  `module`/`href`/`devOnly` — set it when a game wants to own the whole viewport.
- **Module stylesheets, once injected, are never removed on `destroy()`.** They go into the shared
  `document.head` and stay there for the life of the page — this is a hub-wide fact, not specific
  to any one game (`poolv2/CLAUDE.md` is where it's spelled out, arguing for that game's separate
  CSS prefix). It's why a CSS prefix collision between two games is permanent for that session, not
  just "while the game is mounted" — one more reason the `.xx-` prefix + descendant-scoping
  discipline below is load-bearing, not decorative.

### Before you build: USE WHAT EXISTS

The generic Need/Use/Never table for shared infrastructure (viewport re-fit, i18n, theme, profile,
stats recording, difficulty markers, the name gate, multiplayer, hub tile art, `css/ui.css`'s
`.gh-*` primitives) lives in root `CLAUDE.md`, in the always-loaded file on purpose — it's read
there. This file assumes you've already read it.

### Adding a game — checklist

**Copy per axis, not per game. No single game is the reference for everything** — an earlier
version of this paragraph named Escoba for all three axes below, and was wrong on two of them.

| Axis | Reference | Notes |
|---|---|---|
| Setup screen | **Escoba** (`escoba/js/ui.js`; Chinchón mirrors it) | the accordion, one row open at a time. Not described in prose anywhere in this repo — read the code. Filler's flat/segmented screen is acceptable for a small game. Connect Four's is the weakest in the repo; do not copy it. |
| CSS scoping | **Mancala** | every rule descendant-scoped under its root class (`.mancala .mc-x`, never a bare top-level `.mc-x`). Its root class predates the `.xx-root` naming convention (it's `.mancala`, frozen); new games use `.xx-root` (Escoba's `.eb-root` is the naming model) with Mancala's descendant-scoping discipline. Escoba, Filler and Connect Four all carry large numbers of bare top-level prefixed rules — a prefix alone is not isolation. |
| Settings **key** | **Filler / Mancala / Nuts & Bolts** | `gamehub.<game>.v1`, per item 4 below. Escoba's `escoba-settings` is a frozen gen-1 key, kept per THE LAW rule 5, and must never be the model for a new game. |
| Persisting settings at all | every game does | Connect Four is not the exception it once was — it persists two keys today (`gamehub.connect4.v1`, `gamehub.connect4.save.v1`). Every new game persists. |

**The settings *key* and the settings *screen* are separate axes and their best examples are
different games.** The key is a localStorage name the player never sees; the screen is the
setup UI they interact with. Do not infer one from the other — citing a game for its CSS
scoping or its storage key says nothing about whether its screen is worth copying.

When restructuring an old game, migrate it toward the reference for each axis independently.

1. Create `<game>/` with `index.html`, `css/<game>.css`, `js/ui.js` (+ engine modules).
2. `ui.js` exports `init`/`destroy`/`isInProgress` (see "The module contract" above) and
   injects its stylesheet idempotently via `new URL('../css/<game>.css', import.meta.url)`
   (so it's self-contained in the hub).
3. **Scope all CSS** under a root class `.xx-root` (2-3 letter game prefix; see root
   `CLAUDE.md`'s games table for existing prefixes — they are not all derived from the game's
   name the same way, e.g. Escoba is `.eb-`). Prefix every class `.xx-` and every custom property
   `--xx-`. **Every rule must be descendant-scoped under `.xx-root`** (`.xx-root .xx-card`, not a
   bare top-level `.xx-card`) — a prefix alone is not isolation, it just makes a collision
   less likely. Mancala's CSS is the cleanest example of this in the repo; Connect Four and
   Filler are prefix-only and rely on no one else having minted a colliding class yet.
4. **Persist settings under `gamehub.<game>.v1`** (e.g. `gamehub.filler.v1`,
   `gamehub.nutsbolts.v1`). This is the only settings-key convention going forward — three
   earlier generations exist in this repo (dashed `chinchon-settings`/`escoba-settings`,
   dotted un-namespaced `ballrun.*`) and are **frozen in place per THE LAW** (rule 5: old
   keys are never renamed or repurposed), but every *new* key must use this form.
5. Add an entry to `GAMES` in `js/hub.js`:
   - in-hub module → `module: '../<game>/js/ui.js'`
   - separately-deployed app → `href: '/<game>/'`
   - plus `id, title, blurb, badge, accent, art` (inline SVG — see the art requirement below).
   - **plus `released: 'YYYY-MM-DD'`, the day the game actually goes live.** It is the only
     input to the launcher's "New" pill (`js/new-badge.js`): the tile wears it for
     `NEW_DAYS` (7) days and then stops on its own — no follow-up commit, nothing stored, no
     cleanup. Omitting it is not a crash, it just means the game ships unannounced, which is
     why `test-new-badge.mjs` exists. Pre-existing games deliberately carry NO date (they were
     already live when the badge shipped, 2026-08-02) — do not backfill git commit dates, they
     are not release dates.
   - **Array position affects only the favorites group.** Non-favorited games render
     alphabetically by display `title` (`localeCompare`), computed at render time from
     `js/favorites.js` — a new entry needs no special handling, it lands alphabetically among the
     rest. **Favorited games render in the player's own custom order instead** (an edit-mode
     reorder control backed by `js/favorites.js`'s `moveFavorite(id, delta)`) — favorites are
     first as a group, but "alphabetical" only describes the rest of that group, not the
     favorites themselves. (The hidden challenge/admin card is a further exception; it renders
     apart in `.hub-extra`.)
   - **Art must be landscape**: `viewBox="0 0 160 90"`, composed to fill that frame, with a
     full-bleed `<rect width="160" height="90" fill="…"/>` background. Do NOT draw a square
     composition and crop it with `preserveAspectRatio="slice"` — that was tried during the
     2026-07 tile redesign and rejected because it cuts shapes off mid-shape at the frame edge
     (it bisected Connect Four's discs). Compose for the frame you're given.
6. Add the game's files (including its `index.html`) to the `ASSETS` precache list in `sw.js`
   and **bump `CACHE`** (`game-hub-vN` → `vN+1`, past what's on `origin/main` right now — a
   concurrent session may have bumped it since you last checked) — or the new files won't be
   cached for offline. Run `node validate-sw-assets.mjs` before committing.
7. **If the game stores a per-game sub-counter** (`grid`/`cc`/`es`/`nb`/`br`/`tt`/`db`/`bg`/`yz`/`dm`/`hc`/`bs`/`sk`/`pb` —
   anything richer than `total`/`byDiff`), it needs **three** edits, not one, and missing the
   third is a THE LAW rule 1 bug that is invisible on a single device:
   - `js/game-stats.js` — an `ensureXx()` + its call in `normalize()`, plus the `recordXx()` writer.
   - `js/game-stats-ui.js` — a screen that actually RENDERS it (stored is not enough).
   - **`js/players-agg.js` — an explicit `else if (g === '<id>' && src.xx)` branch in
     `aggregatePlayers`.** The cross-device combine only carries sub-counters it names, so
     without this the game's own Stats screen reads zeroes the moment a person's second
     device syncs, even though `total`/`byDiff` stay correct and every device's local store
     is intact. Counters add; **bests take `Math.max`, never a sum**; a paired value (Boggle's
     `longestWord: {word,len}`) must move as a UNIT so the text always matches its own length.
   This was missed twice in a row (Dots and Boxes, then Boggle), both caught only by opening
   My Stats in a browser. `players-agg.test.mjs` now has a per-game regression case for each,
   and reads the sub-counter keys straight out of `game-stats.js`, so a forgotten surface fails
   `node run-all-tests.mjs` instead of waiting to be noticed in a browser.
8. **Add the game to `GAME_META` in `js/leaderboard-ui.js`** — `{ id: '<statsId>', labelKey:
   'game_title_<statsId>' }`, using the STATS id, not the hub id. This is a **separate registry
   from item 5's**, in a different file, and it is the one that gets forgotten. `ALL_IDS`,
   `COMP_IDS`, `winsOf()`, `playedOf()` and the whole By Game segment are all derived from it, so
   a game that is missing here has every win and every play counted as **zero on the leaderboard**
   while its own Stats screen shows them correctly. Yahtzee shipped like that until a player
   reported it (2026-08-11) — 14 wins stored, synced and invisible, THE LAW rule 1. The only
   legitimate reason to leave a game off is `devOnly` (an unreleased game has no business on the
   shared bragging wall); say so in `players-agg.test.mjs`'s `OFF_THE_BOARD`, which checks the
   claim against `js/hub.js` and fails the day the game is released.
9. **Create `<game>/CLAUDE.md`** — the game's own documentation, auto-loaded only when a session
   works inside that folder. Open it with the THE-LAW pointer block (copy it from any existing
   game file), then: hub integration (module/href, immersive or not, which `isInProgress()`
   meaning it uses and why), layout/responsibilities, key design decisions, correctness-critical
   engine notes, settings/persistence keys, tests. `escoba/CLAUDE.md` is the reference for depth
   and structure. Game-specific detail goes HERE, not in root or here — root's games table gets
   one row (integration, prefix, settings key, recorder) and nothing else.
10. **Create `<game>/js/strings.js` and route every user-visible string through `t()`** — the hub
    is bilingual (English/Spanish, `js/i18n.js`, preference in `gamehub.lang.v1`). Export
    `{ en: {...}, es: {...} }` (English is the source of truth; a missing Spanish key falls back
    to English, so partial translation never breaks), build `const t = makeT(STRINGS)` in ui.js,
    and call `t()` at RENDER time — never at module scope. Include aria-labels. Language changes
    apply to newly rendered UI; live re-render via `onLangChange` is optional (unsubscribe in
    `destroy()`). `snake/js/strings.js` + `snake/js/ui.js` are the reference implementation; the
    full mechanism doc is in `js/CLAUDE.md` ("Language support").
11. **Run `node test-game-conventions.mjs`, then `node run-all-tests.mjs`.** It discovers game
    folders from disk, so your new game is checked automatically — listener hygiene, the module
    contract, translation plumbing, folder layout, and (as of this file) the 11px text-size floor
    from Part 0. **If it fails, fix the game — do not add the game to its `KNOWN_GAPS` list.**
    That list is for pre-existing debt only, and a brand-new entry there is a shortcut, not an
    exception.

---

## Part 2 — Screen patterns

### How-to-play screens

Reference implementation: `tic-tac-toe/js/ui.js` (`openHelp()`); the pattern itself lives here so
it isn't tied to one game's folder — this is the repo-wide pattern (worked out 2026-07-21,
originally written up in `tic-tac-toe/CLAUDE.md`, which now points here).

**Explain only the one genuinely non-obvious mechanic.** Skip anything the player already
knows — do not re-explain basic rules of a game everyone grew up with. For Tic Tac Toe that
meant explaining only Ultimate's "your cell picks their board" rule and nothing else.

Structure, top to bottom:

1. **One short bold sentence** stating the goal or win condition.
2. **A small SVG diagram** illustrating the confusing mechanic directly. If you can show it,
   do not describe it in prose. (Tic Tac Toe's: nine board outlines, one showing its own
   mini-grid with a marked cell, and an arrow curving to the board that cell sends the
   opponent to.)
3. **A caption** under the diagram stating the rule in plain words.
4. **A concrete one-line example in "X = Y" format** (e.g. "Play top right box = Opponent
   plays top right board").
5. **Any remaining edge cases**, each as its own plain sentence. No bullets unless there are
   three or more.

Rules for the whole screen:

- **Every line of text must fit on a single row.** Do not guess a font-size. Measure the
  actual rendered width against the container's real available width, size down until it
  fits (see Part 0's 11px floor for where that bottoms out), then lock it with
  `white-space: nowrap`.
- **Spacing between elements must be explicit and deliberate** — one flex container with a
  fixed `gap`, or hard-coded margins. Never leave it to collapse naturally between two
  unrelated rules.
- **The diagram must carry its meaning through shape, outline, and arrows, never color
  alone** (colorblind-safe, same as root `CLAUDE.md`'s accessibility rule).

This pattern applies to EVERY game help screen, not just Tic Tac Toe's.

### Setup-screen defaults

- **Settings persist on selection, not only at game start.** In every game, save the settings
  object immediately when a setup control changes (the existing save function, called from the
  option handlers), keeping a save-on-start call as harmless belt-and-braces. A game whose only
  save call sits in its start path has this bug.
- **Turn-based games default to "Alternate who goes first."** An explicit saved you/opponent
  choice always wins over the default; "Alternate" swaps on every completed game including
  rematches; each game announces who opens (the way Mancala does). Confirmed live in Connect
  Four, Dots and Boxes, Filler, and Mancala (each with its own `nextStarter`-flip-in-`startGame()`
  mechanism), plus a solo-only variant in Chinchón.
- **Difficulty display vocabulary is Easy / Medium / Hard / Expert** (es Fácil/Normal/Difícil/
  Experto) — not Beginner/Intermediate/Pro, an earlier vocabulary that was tried and reversed the
  next day. Stored difficulty ids are unrelated and unchanged; this is a label-only convention.
  Pair it with the ski-slope shape/color mapping from `js/difficulty-tiers.js`'s `diffShapeSVG()`/
  `tierOf()` — green circle (Easy), blue square (Medium), black diamond (Hard), double black
  diamond (Expert) — never color alone.
- **Hub chrome knobs (language, theme, version pill) stay hidden on every mounted game screen,
  setup included** — not just during live play. Switching language from a game's own setup screen
  and bouncing to the launcher (because the toggle re-renders it) is the bug this prevents. The
  knobs live on the launcher and profile; that's enough.

### Multiplayer save-key convention

For any new MP-capable game: a separate `gamehub.<game>.mp.v1` key, not Escoba's sub-object-inside
-the-solo-key shape (which is frozen gen-1, THE LAW rule 5, and not a model to copy — follow
Chinchón or Tic Tac Toe instead). MP results always record under the `'mp'` difficulty bucket,
settled by Tic Tac Toe, never whatever local AI-tier was last selected. Never change `js/net.js`'s
protocol as a side effect of one game's MP work — a protocol change gets its own handoff, review,
and real-device verification pass, not a drive-by edit. See `js/CLAUDE.md`'s numbered MP-consumer
sections for the deep mechanics.

---

## Part 3 — Cross-game techniques

These are lessons that have already been independently learned — and separately written up — by
more than one game, with no cross-reference between the copies until now.

### Fitting a screen to available viewport space, by measurement

Reinvented independently in Dominoes and Battleship, and stated as a rule (without a fix) in
`VISUAL-PROCESS.md` §3c after Pool shipped 138px too tall inside the hub. The technique:

- **Measure with a PROBE, not a formula.** Dominoes' `_fit()` sets a tall probe height (2000px),
  reads `scrollHeight` against it (now pure content, not clamped by viewport), and computes what's
  left below. A static `vh`-based CSS formula doesn't know about host chrome (the hub adds ~98px of
  top padding for its floating back button and ~40px at the bottom) and will be wrong the moment a
  game is mounted inside it rather than viewed standalone.
- **Never measure with a raw `getBoundingClientRect().top`.** It's viewport-relative, so it moves
  when the page is scrolled — and the page is scrolled *because* of the overflow you're trying to
  remove. Add the scroll offset back, or measure something that can't move.
- **The surrounding gap isn't always on `el.parentElement`.** In the hub it can belong to a
  container two levels up (`.hub-main`), while the element's own immediate parent has no padding
  at all. Measure the actual distance, not a particular ancestor's style.
- **`window.innerWidth` includes the scrollbar; `document.documentElement.clientWidth` does not.**
  A width measurement that mixes the two is quietly wrong on desktop.
- **Out-of-flow children (absolutely positioned, `display: none`) pollute a height measurement**
  unless explicitly skipped.
- **Test at two viewport heights, not one.** Browser toolbars eat 100-190px on a real phone; a
  layout can pass at a tall viewport and fail at a short one. `test-visual.mjs`'s `fit` check
  covers both, standalone and mounted in the hub's real chrome.

### The `.hub-game` height trap

`.hub-game` (`css/hub.css`) sets no explicit `height` on the container a module mounts into. A
game root using `height: 100%` has nothing definite to resolve against, which collapses the whole
canvas/render chain toward its bare intrinsic size. This has independently sunk Pool, Poolv2, and
Escoba's layout (each documents hitting the same shared-shell gap). Fix: `min-height: 100dvh` on
the game's root, `flex: 1` (never a percentage height) down the chain, a zero-size guard plus
`requestAnimationFrame` retry around any canvas resize, and a `ResizeObserver` (not just
`window.resize`) so a flex settle or orientation change is caught too.

### Preventing physics tunnelling through thin geometry

Reinvented independently in Hill Climb and Pinball, via two related but distinct mechanisms —
write both if you're building a third physics-based game:

- **Cap the distance travelled per physics step below the thinnest collidable feature.** Pinball's
  rule: `MAX_SPEED / PHYS_DT` is the per-step travel distance, and it must stay well under the
  thinnest wall. Raising the speed cap without shortening the timestep re-opens tunnelling.
- **A fixed timestep needs a bounded catch-up cap**, separately. Hill Climb's `tick()` uses a fixed
  1/120s step with a `MAX_STEPS` cap, so a stalled tab can't make an object teleport through
  geometry on the next frame once it resumes.
