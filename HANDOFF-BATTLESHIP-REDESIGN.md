# HANDOFF — Battleship visual redesign (clone the reference)

**Target executor:** Sonnet, **high** effort.
**Branch:** `claude/battleship-game-handoff-s0r0nk`.
**Scope:** a full visual and interaction rebuild of `battleship/` to match a reference mobile game.
**Not in scope:** the engine (`game.js`, `fleet.js`, `ai.js`, `hash.js`), the multiplayer protocol
(every `_mp*` method), stats recording, storage keys, or hub integration. Those work. Do not touch
them except where this document explicitly says to.

Read first: root `CLAUDE.md`, `battleship/CLAUDE.md`, and **"How this ships broken" at the bottom
of this file** — the last two passes on this game both reached Matt's phone unplayable, and the
last one was invisible to every test in the repo.

---

## 0. The reference

Matt supplied a screenshot grid of a polished mobile Battleship ("Sea Battle" style). You will not
have the image. Everything you need is described below; build to this description.

**Take the layout, the palette, the interaction model and the feel. Do NOT copy its name, its logo,
or its literal artwork.** Our game stays `Battleship` / `Hundir la Flota`. Ship sprites, cannon and
icons are rebuilt as our own inline SVG in `ship-art.js`, not traced from theirs.

### The single biggest idea to steal

**The two boards are stacked and always both visible, in different materials:** the enemy's waters
on top as a dark navy grid, yours below as a **brown wooden grid on a salmon deck**. You are always
looking at both. There is no swapping, no resizing, no mode switch. A thin horizontal strip between
them carries both fleets as small silhouettes and the sunk score.

That vertical sandwich — navy on top, wood on the bottom, roster in the middle — is the whole
visual identity. Get that right and everything else is detail.

---

## 1. Palette

Replace the current `--bs-*` values wholesale. Light theme:

| Token | Value | Used for |
|---|---|---|
| `--bs-header` | `#2C3E5D` | the dark navy panel behind titles |
| `--bs-enemy-water` | `#1E3A5F` | enemy board fill |
| `--bs-enemy-line` | `#2F5480` | enemy grid lines |
| `--bs-deck` | `#F5A98B` | the salmon deck surrounding your board |
| `--bs-wood` | `#8B5A3C` | your board fill |
| `--bs-wood-line` | `#A56B48` | your grid lines |
| `--bs-mine` | `#E85D4A` | YOUR ships (coral red) |
| `--bs-theirs` | `#5BA3D0` | THEIR ships (light blue) |
| `--bs-btn-random` | `#2196F3` | the Random button |
| `--bs-btn-save` | `#3FB562` | the Save button |
| `--bs-btn-bot` | `#F5B800` | Play vs Bot |
| `--bs-btn-friend` | `#9C5FD0` | Play vs Friend |
| `--bs-valid` | `#3FB562` | legal placement |
| `--bs-invalid` | `#E0532F` | illegal placement |

Dark theme (`:root.gh-dark .bs-root`): deepen the navy and the wood, lift the deck to a muted
terracotta, keep the ship colors (they are already high-contrast on both).

**Colorblind rule, and it bites twice here.** Matt is red/green colorblind.

1. **Your ships red vs their ships blue is fine** and is the reference's own scheme — keep it.
2. **Valid green vs invalid red placement is NOT fine on its own.** Pair each with a shape: a valid
   ghost gets a solid outline and a ✓ badge, an invalid one gets a **dashed** outline and a ✕ badge.
   The color is reinforcement, never the signal.
3. The green SAVE button must also read as "confirm" from its label and its position, not its hue.

---

## 2. Screen 1 — the mode screen (replaces the current setup accordion)

The reference's first screen is not an accordion. Rebuild `renderSetup()` to match it:

- **Dark navy header**: the title, and under it one line of explanation — "Place your ships without
  showing your opponent, then take turns guessing where theirs are."
- **A centered card** over that header containing, in order:
  - a large circular **opponent avatar** showing the emoji. Take it from `loadProfile()`'s opponents
    (the profile is defaults-only — read it, never write it back).
  - the difficulty name in large gold caps: **EASY / MEDIUM / HARD**
  - a **slider** for difficulty, not pills: a rounded track with a round knob, three stops.
  - **`PLAY VS. BOT`** — full-width, amber, with a robot glyph
  - **`PLAY VS. FRIEND`** — full-width, purple, with a person glyph. This opens the existing
    Host/Join multiplayer lobby; do not build a second one.
- Board size, First shot and Bonus shot on hit move into a small **"Options"** row under the two
  buttons — a compact line of chips, not an accordion. Keep every existing setting and its key.
- Keep the **How to play** link.

**The difficulty slider is display only.** The stored values stay `beginner` / `intermediate` /
`pro` — they are storage vocabulary, they map onto tiers in `js/difficulty-tiers.js`, and
`DIFF_META` in `js/game-stats-ui.js` expects exactly those keys. Only the labels change. The
existing ski-slope tier shape (`diffShapeSVG`) must still appear somewhere on this screen — it is
the colorblind-safe difficulty marker and it is a repo-wide rule.

---

## 3. Screen 2 — Deploy your ships (`renderPlacement()`)

- **Dark navy upper panel**: "Deploy your ships", and under it "Drag to move, tap to rotate, or try
  random placement."
- **`RANDOM`** — a blue pill button. Re-rolls the whole fleet. (This is the existing Auto-place.)
- **`SAVE`** — a green button with a lightning glyph, **which appears only once every ship is
  placed.** Before that it is absent, not disabled-and-greyed. This is the existing Ready action.
- **A tray** on the salmon deck above the board holding the ships not yet placed, drawn as full
  sprites lying side by side.
- **The board**: brown wooden grid on the salmon deck.
- Ships are dragged **from the tray onto the board** and dragged around **on** the board. Each
  placed ship carries a small **curved rotate arrow** at one corner; tapping the ship or its arrow
  rotates it in place.
- While dragging, the cells the ship would occupy highlight **green with a ✓** when legal and
  **dashed red with a ✕** when not.
- A white circular **EXIT** button, vertical label, pinned to the right edge. It leaves to the mode
  screen. (The hub's own immersive back button also exists — that is fine, they do different
  things; make sure yours is not underneath it.)

Keep the existing keyboard path (arrows move, `R` rotates, Enter places). Pointer events only.
`touch-action: none` on the board, `manipulation` on buttons. **Never** bind `touchmove` to
`document` or `window` — `test-game-conventions.mjs` fails the build for it.

---

## 4. Screen 3 — the bot placing (new, small)

Between placement and battle, a brief screen: the enemy board empty and dark on top, the bot's blue
ships shown laid out below, and the line **"Bot is placing ships"**. Two seconds, skippable by tap.

In multiplayer this screen becomes "Waiting for {opponent}" and is driven by the **existing** ready
handshake — do not invent a second one.

---

## 5. Screen 4 — the battle (`renderBattle()`)

Top to bottom, fixed, no page scroll:

1. **Enemy waters** — dark navy grid. Tapping a cell aims. Misses leave a small `✕`; hits leave a
   filled marker; a sunk ship reveals in **their blue** on your grid.
2. **The roster strip** — a horizontal band between the boards: their fleet as small blue
   silhouettes on one line, yours as red silhouettes on the other, each ship struck through when
   sunk, plus the **sunk score `0 - 0`** at the left in red.
3. **Your board** — brown wooden grid on the salmon deck, with **your own ships shown as faint
   ghosted silhouettes** so you can see incoming fire land on them.

### The cannon — the centrepiece, and the thing the current build most lacks

A **large black cannon barrel on a dark ring base**, drawn in SVG, that physically sits on the board
being fired at and points at the target cell.

- When **you** fire: the cannon appears over the enemy grid at the tapped cell, recoils, and the
  shot resolves.
- When the **bot** fires: the cannon appears over **your** board, with a dark rounded pill label
  reading **"Bot thinking"** while it chooses, then it fires.
- A **crosshair reticle** (circle plus cross lines) marks the cell currently being aimed at.
- **Miss** → a burst of white bubbles spreading and fading on the water.
- **Hit** → an impact flash and the marker.
- **Sunk** → the ship reveals in its owner's color and settles.

The cannon replaces the current arcing-projectile idea entirely. Delete `.bs-ordnance` and its
keyframes when you do — do not leave both.

---

## 6. Hard constraints — every one of these has already broken this game once

1. **Never reuse a class name.** `.bs-shell` was the root layout container AND the flying shell;
   the second definition's `opacity: 0` animation and reduced-motion `display: none` made the whole
   game invisible. `test-game-conventions.mjs` now fails the build for it. Give ornaments their own
   namespace (`.bs-cannon`, `.bs-splash`), never a structural name.
2. **`prefers-reduced-motion`**: every animation you add needs a reduced-motion branch that makes it
   an instant state change. **Never `display: none` on anything structural** — that is precisely how
   the blank screen shipped. The game must be fully playable with every animation off.
3. **`onViewportResize`** from `js/viewport.js` is the only resize subscription. Unsubscribe in
   `destroy()`.
4. **`--bs-cell` is per board.** The two boards are different widths; a single root-level value drew
   the small board's ships at the large board's scale. Keep the current per-board implementation.
5. **Dark mode** via `:root.gh-dark .bs-root` overriding `--bs-*`. No `prefers-color-scheme` in game
   CSS.
6. **Every string through `t()`**, at render time, in `battleship/js/strings.js`'s `{en, es}`. All
   the new copy above needs Spanish. No em dashes in user-facing text.
7. **Scope every CSS rule** under `.bs-root`.
8. **Do not touch** `game.js`, `fleet.js`, `ai.js`, `hash.js`, any `_mp*` method, `recordBattleship`,
   or any storage key. `isInProgress()` keeps its current mode-split meaning.

---

## 7. How this ships broken — read before you say it is done

Two consecutive passes on this game reached Matt's phone unplayable. The second one rendered
**nothing at all** — a blank screen — while:

- `node battleship/js/test.js` passed, 29/29
- `node --check` was clean on every file
- `node run-all-tests.mjs` was green
- the DOM contained 21,288 characters of perfectly correct HTML
- and the session that built it reported everything was fine

Nothing in this repo looks at whether a game is **visible**. A DOM length is not a rendered screen.
The fix that finally found it was opening a screenshot.

**So your definition of done is a screenshot of every screen, looked at.** Not a character count,
not a passing suite, not "the elements are in the DOM."

Drive the real game in a real browser at 390×844 (Chromium is at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `playwright-core` installs fine) and capture:

1. the mode screen
2. the deploy screen, mid-drag, showing both a valid and an invalid ghost
3. the bot-placing screen
4. the battle screen before any shot
5. the battle screen after a miss, a hit, and a sink
6. the win overlay (it must have a close ✕ in its top-right — repo-wide rule)

**Then do all six again with `reducedMotion: 'reduce'`** — that is the setting that hid the entire
game last time, and headless Chromium defaults to it, which is why the blank screenshot existed and
was not read. **Then all six again in dark mode.**

Assert on painted pixels, not markup. This works and is worth copying:

```js
const painted = [...document.querySelectorAll('.bs-root *')].filter((e) => {
  const b = e.getBoundingClientRect(), c = getComputedStyle(e);
  return b.width > 2 && b.height > 2 && c.visibility !== 'hidden'
      && c.display !== 'none' && +c.opacity > 0.01;
}).length;
```

Then: `node test-game-conventions.mjs`, `node validate-sw-assets.mjs`, `node run-all-tests.mjs` —
all green. Add any new file to `sw.js`'s `ASSETS` and bump `CACHE` **past what is on `main` right
now**, not past your working copy.

Finally, update `battleship/CLAUDE.md` to describe the new screens and the cannon, and note the
class-namespace rule. THE LAW rule 9: a milestone is not done until CLAUDE.md reflects it.

## 8. Known outstanding, do not lose these

- **`PURGE_ALL_CACHES` in `sw.js` is currently `true`**, a one-time recovery lever from the blank
  screen incident. Set it back to `false` in your first commit — left on it re-downloads ~8.8 MB on
  every deploy.
- **`BS2` in `test-mp-lockstep.mjs` is flaky** (roughly 1 run in 3), a real race in multiplayer
  recovery. Out of scope here, but do not paper over it, and do not let a redesign commit be the
  thing that quietly makes it worse.
