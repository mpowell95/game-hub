# UI Kit — CLAUDE.md

> **THE LAW applies here as everywhere: player data is never deleted, never lost, never put at
> risk, and you must always verify this.** THE LAW and its nine working rules live at the top of
> the root `CLAUDE.md`, which is always loaded alongside this file. This particular folder is
> outside its blast radius **by construction** (it reads and writes no storage key at all, see
> "What it deliberately does not do" below), but that is a property to preserve, not a licence.

## What this is

Not a game. A **dev-only review surface** for `css/ui.css`, the shared design layer. It exists so
the tokens and chrome primitives can be judged on a real phone, inside the real hub shell, before
any game adopts them.

Created 2026-08-01, in response to: *"The game engines you've built are fine. The UI is the
problem,"* followed by *"Is there a way for you to do this without affecting the real game hub
until I verify everything?"* and *"Can you make it admin only? Like pool and poolv2?"*

## Why the shared layer exists

Measured with ripgrep across `css/*.css` and `*/css/*.css` on 2026-08-01, before `css/ui.css`:

| Measure | Count |
|---|---|
| Game stylesheets referencing any `--hub-*` token | **0 of 16** |
| Custom properties defined independently | 397 |
| Distinct `border-radius` values | 25+ |
| Distinct `box-shadow` values | 220 |
| Distinct `font-size` values | 130 |
| Distinct `font-family` stacks | 8 |
| Games defining their own `-btn`/`-btn-primary`/`-btn-ghost`/`-btn-small` set | **9** |

The last row is the finding. Boggle, Ball Run, Chinchón, Connect Four, Dots and Boxes, Escoba,
Nuts & Bolts, Pool and Tic Tac Toe each define the same four button variants under a different
prefix. One component, nine implementations. Polish spent on any one of them buys exactly one
game, which is structurally why the root `CLAUDE.md`'s "Adding a game" axis table has to name a
different reference game per axis: with no shared layer, divergence is the default outcome, and
the docs end up tracking drift rather than preventing it.

These numbers are duplicated in three places on purpose (this file, `css/ui.css`'s header, and
the `DRIFT` array in `ui-kit/js/ui.js` that feeds the gallery's Drift panel). If they are
re-measured, update all three.

## Hub integration

- **`module: '../ui-kit/js/ui.js'`**, registered in `js/hub.js`'s `GAMES` with **`devOnly: true`**
  — the same gate `pool` and `poolv2` use. `js/hub.js:308` filters the card out unless
  `isDevProfile(profile.name)` passes (Matt or the tester, hashes in `js/challenge/secrets.js`).
  No other player ever sees the card.
- **Not `immersive`.** It is an ordinary scrolling page and wants the hub's normal header.
- **`isInProgress()` returns `false`, always** — the LOSSLESS meaning of the two documented in
  the root `CLAUDE.md`'s module contract. There is no game state to abandon, so the hub must
  never raise "leave game?" on the way out.
- Standalone at `ui-kit/index.html`, gated on `requireName()` before `init()` like every other
  standalone page. The gallery records nothing so it could not itself mint a nameless device
  record, but the convention is not worth a local exception.

## What it deliberately does not do

Each of these is a safety property of the preview, not an oversight:

- **Records nothing.** Imports neither `js/game-stats.js` nor `js/game-stats-global.js`. Reads
  and writes no `localStorage` key, touches no sync path, adds no `players-agg.js` branch. THE
  LAW cannot be violated by a module that never touches player data.
- **Writes no theme.** `js/theme.js` owns `.gh-dark` on `<html>`. The gallery's light/dark switch
  re-tints a **local** preview container only (`.uk-stage--dark` in `ui-kit/css/ui-kit.css`); the
  player's own `gamehub.theme.v1` is never read or written.
- **Changes no game.** `css/ui.css` is injected by this module on mount and is linked from
  nowhere else in the repo. No game has adopted it, so nothing in the hub looks different.
- **Is not in `sw.js`.** Left out of `ASSETS` on purpose while under review. A single `ASSETS`
  entry that 404s aborts `cache.addAll()` atomically and silently leaves the previous worker
  serving, with a version pill stuck at `vN → vN+1` as the only symptom (root `CLAUDE.md`, the
  diagnostic section). Nothing here goes near the service worker until the layer ships, which
  also means the gallery does not work offline. That is the accepted trade for the review phase.

## Layout

```
ui-kit/index.html         standalone page (name-gated), links both stylesheets
ui-kit/js/ui.js           the gallery module: init/destroy/isInProgress
ui-kit/js/strings.js      EN/ES dictionary (snake/js/strings.js is the reference)
ui-kit/css/ui-kit.css     the GALLERY's own chrome, scoped under .uk-root
css/ui.css                the SHARED LAYER under review (not part of this folder)
```

Keeping the gallery's chrome (`ui-kit.css`) apart from the layer being reviewed (`css/ui.css`) is
the point: if a primitive looks wrong, the fault is in `css/ui.css`, and the gallery's own styling
can never flatter it.

## Screens

Three tabs, all client-side state, no persistence:

- **Tokens** — radius, shadow, type, space, color scales, plus the colorblind-safe play palette
  with each hue's shape marker (circle / triangle / square / diamond).
- **Parts** — buttons (default, primary, ghost, danger, small, disabled, icon), card, chips,
  segmented control, field, accordion, and a modal. The modal demonstrates the close (X) that the
  root `CLAUDE.md` requires on every win/lose popup: it is part of `.gh-modal` itself, so a game
  adopting the primitive gets it without having to remember.
- **Drift** — the table above, rendered from the `DRIFT` array so the panel cannot drift from
  what was actually measured.

## Design decisions

- **Namespace `gh-` / `--gh-`.** Verified collision-free when written: the only pre-existing users
  are `.gh-dark` (stamped by `js/theme.js`) and `--gh-band-title`/`-controls`/`-filter` in
  `css/hub.css`'s unified chrome band spec. All left untouched.
- **`css/ui.css`'s colors default to the `--hub-*` values** (`var(--hub-surface, #fff)` style) so
  `css/hub.css` stays the single source of the palette and a theme edit still happens in one
  place, rather than forking a second palette that would immediately start drifting from the first.
- **Chrome only, never play surfaces.** The layer covers buttons, cards, chips, segments, fields,
  accordions, modals, overlays. It must not reach into Escoba's felt, Mancala's pits, Uno's cards,
  Connect Four's grid, Ball Run's canvas or Snake's board. Each game's board is its own identity,
  and the `immersive: true` games own their whole viewport on purpose.
- **The reduced-motion block is scoped to this layer's own primitives**, not a global `*` reset,
  so adopting `css/ui.css` can never silently disable a game's own animation (Ball Run and
  Chinchón both rely on theirs).
- **`ui-kit.css` is descendant-scoped under `.uk-root`** throughout, following Mancala's
  discipline. No bare top-level `.uk-` rules: a prefix alone is not isolation.

## Adoption plan (not started)

Opt-in, one game per commit: a game injects `css/ui.css` alongside its own stylesheet, swaps
`.xx-btn` for `.gh-btn`, and deletes its local button block. **Order by debt, not alphabetically** —
start with the clean stylesheets (Snake, Pool, Tic Tac Toe) to prove the layer, then work into the
ones carrying large numbers of bare top-level prefixed rules (Chinchón 246, Escoba 219, Connect
Four 99, Filler 68), where a shared class is most likely to collide with an existing unscoped rule.

`sw.js` (`ASSETS` + a `CACHE` bump) and `validate-sw-assets.mjs` come at the end, once the layer
stops moving, and cover `css/ui.css` and the `ui-kit/` files together.

## Three real defects the gallery caught on its first render

Worth recording (rule 9): each would have shipped into every game that adopted the layer, and
none was visible by reading the CSS.

1. **`.gh-input` overflowed its container.** `width: 100%` plus padding and border with no
   `box-sizing`. Fixed by setting `box-sizing: border-box` on the primitives themselves — never
   a global `*` reset, which in an opt-in layer would silently change the box model of whichever
   game adopted it.
2. **The dark preview rendered light colour swatches.** `css/ui.css` declares
   `--gh-bg: var(--hub-bg, …)` at `:root`, and a custom property's `var()` is substituted where
   the property is DECLARED, not where it is used — so overriding `--hub-bg` on a descendant
   cannot re-resolve it. Preview-only: the real app stamps `.gh-dark` on `<html>`, the same level
   the tokens are declared at. `.uk-stage--dark` now restates the `--gh-*` colours directly.
3. **Dark mode failed contrast on the accent.** An earlier draft flipped `--gh-accent-ink` to a
   dark ink under `.gh-dark`, which measured **3.66:1** on `.gh-btn--primary` and
   `.gh-chip--accent`, under the 4.5:1 minimum. `--hub-accent` is the one colour `css/hub.css`'s
   dark block deliberately leaves alone, so the accent surface is the same blue in both themes
   and white stays its correct pairing. Removed; both hold **5.24:1** in both themes now.

## Tests

No suite of its own, and none is owed: the gallery has no engine, no state worth asserting and no
stored data. What does cover it:

- **`node test-i18n-strings.mjs`** — `ui-kit/js/strings.js` was added to that suite's `DICTS`
  list. Green: 69 `en` keys, 0 missing from `es`.
- **`node run-all-tests.mjs`** — green, 25 suites, 0 failed (2 skipped for a missing optional
  `jsdom`, pre-existing and unrelated).
- **`node validate-sw-assets.mjs`** — passes, and warns that `css/ui.css` is not in `ASSETS`.
  **That warning is the intended state during review**, not a defect to silence. It resolves when
  the layer ships and `sw.js` is updated.
- **Browser check (Playwright, Chromium)** — the gallery renders with no console errors; the
  modal's close (X) is present and dismisses it; and loading the hub with an ordinary
  (non-`isDevProfile`) profile renders 13 cards with **no `ui-kit` card among them**, confirming
  the `devOnly` gate. Run with all non-localhost requests aborted, per the "never seed a browser
  that can reach the real Firebase" warning in `js/CLAUDE.md`.

**Known gap, unrelated to this folder:** `validate-sw-assets.mjs`'s `SCAN_DIRS` list is missing
`boggle`, `snake`, `uno`, `pool`, `poolv2`, `dots-boxes` and `yahtzee`, so its "deployed file not
in ASSETS" warning has a blind spot over seven games. Pre-existing; left alone here rather than
folded into an unrelated commit.
