# HANDOFF — Battleship polish pass (bugs + visual rebuild)

**Target executor:** Sonnet, **high** effort.
**Branch:** `claude/battleship-game-handoff-s0r0nk`. The game already exists there (commit
`7141b31`). This is a fix-and-rebuild pass over it, not a new game.
**Read first:** root `CLAUDE.md`, `battleship/CLAUDE.md`, and `HANDOFF-BATTLESHIP.md` (the
original build spec, same branch, same folder).

Matt played it on a phone and reported four things. All four are confirmed in the code, with
exact causes below. Two are bugs, two are "this looks bad and it needs to look good."

> "There's an error or confusion on the setup screen with the bonus and the game feels like it
> glitches when it changes the zoom or perspective or whatever that is. It switches the sizes of
> the maps for like a split second. The graphics are bad too. I do not like the blocks as ships.
> They should be boats. The bomb dropping animation sucks too."

**Section 2 is my fault, not the previous session's.** The swapping board emphasis was specified
in the original handoff as "the single best interface idea in this document." It is the glitch.
It comes out.

---

## 1. BUG — the "Bonus shot on hit" row says Close / Ready

**What Matt sees:** the setup row reads `Bonus shot on hit    Close`, and opening it offers two
buttons, `Close` and `Ready`. Neither word means anything here. In Spanish it is worse: `Cerrar`
and `Listo`.

**Cause,** `battleship/js/ui.js:313` and `:349`:

```js
this._seg('set-bonus', s.bonusShotOnHit ? 'on' : 'off', [['off', t('close')], ['on', t('ready')]])
…
this._row('bonus', t('row_bonus'), s.bonusShotOnHit ? t('ready') : t('close'), …)
```

`t('close')` is the dialog dismiss button and `t('ready')` is the placement-screen confirm
button. There are no `off`/`on` keys in `battleship/js/strings.js` at all, so the nearest
plausible strings got borrowed and they are both verbs.

**Fix:**

- Add real keys to both dictionaries: `bonus_off` / `bonus_on` → EN `Off` / `On`, ES
  `Desactivado` / `Activado`.
- Use them in the segmented control and in the row's summary value.
- While you are there, check every other `_seg` and `_row` call for the same borrowing. Grep for
  `t('close')` and `t('ready')` and confirm each remaining use is genuinely a dismiss button or
  the placement confirm.

`node test-i18n-strings.mjs` will keep you honest about EN/ES pairing.

---

## 2. BUG — the boards resize on every turn flip

**What Matt sees:** the two maps swap sizes for a split second on every turn change, the page
jumps, and it reads as the game glitching its zoom.

**Cause, and it is three compounding things:**

1. `battleship/js/ui.js:775` — `const enemyPrimary = isMyTurn || s.over;` drives an
   `is-primary` / `is-secondary` class swap on both board panels at every turn flip.
2. `battleship/css/battleship.css:157` — `.bs-boardpanel { transition: max-width .35s ease; }`.
   **`max-width` is a layout property.** Animating it reflows the whole page, including both
   64-to-100-cell grids, on every frame for 350ms.
3. `battleship/css/battleship.css:162-163` — the inner `.bs-board` width switches between
   `min(58vw, 220px)` and `min(92vw, 460px)` **with no transition at all**. So the inner board
   snaps instantly while the outer panel animates around it. That mismatch is literally the
   "split second" size flash.

On top of that, the turn flip re-renders the panel DOM, so the transition restarts from a fresh
element, and the total page height changes, which moves the scroll position under the player's
thumb.

**Fix: the boards do not change size. Ever, during a match.**

- Enemy waters is the large board for the whole match. Your fleet is the small board for the
  whole match. Delete `enemyPrimary` and both `is-primary` / `is-secondary` size rules.
- Delete `transition: max-width`. Nothing in this game animates a layout property. Ever.
- Convey whose turn it is with **compositor-only** properties and text: the turn banner (already
  there and already correct), a 2px accent outline on the active board, and `opacity: .82` on the
  inactive one. `opacity`, `transform`, `filter` and `box-shadow` are fine; `width`, `height`,
  `max-width`, `margin`, `padding`, `font-size` and `gap` are not.
- **Size both boards once per viewport, not per turn.** Import `onViewportResize` from
  `js/viewport.js` (the game currently does not import it at all, so it also never re-fits on
  rotate) and compute a single `--bs-cell` pixel value from the available height and width, then
  derive every board, ship sprite and roster silhouette from it. `hill-climb/js/ui.js:120` is the
  current usage pattern; unsubscribe in `destroy()`.
- **The battle screen should fit the viewport without page scrolling.** The game is `immersive`
  and owns the whole screen. In the screenshots the boards are cut off at the bottom and the
  player has to scroll mid-match, which is what makes the reflow so visible. Lay the battle
  screen out as a column that fits: turn bar, status, enemy board, your fleet, actions, with the
  cell size solving for the space available. If something must scroll, it scrolls inside its own
  container with `overscroll-behavior: contain`, never the page.

---

## 3. VISUAL — ships must be boats, not blocks

**What Matt sees:** every ship is a run of dark navy squares. `battleship/css/battleship.css:141`
is the whole of it: `.bs-cell.bs-has-ship { background: var(--bs-ship); }`.

**What the references show:**

- **The classic pegboard photo** (grey moulded plastic ships on a blue pegboard): each ship is
  **one continuous object with a silhouette** — pointed bow, squared stern, a raised
  superstructure. Not a run of tiles. The whole shape sits *on* the grid rather than filling it.
- **The naval game screenshots** (top-down warship sprites on a translucent grid over real
  ocean): the ships are recognisably different vessels — a long flat carrier deck, a battleship
  with turret clusters, a low submarine hull with a conning tower, a small destroyer. Size and
  silhouette tell you which is which at a glance, before you read any label.

**Fix: one SVG per ship, spanning the whole ship, drawn once and positioned over the grid.**

- Build `battleship/js/ship-art.js`: `SHIP_ART[shipId]` → inline SVG with `viewBox="0 0 {len*10} 10"`,
  drawn horizontally, bow to the right. Vertical placement is a `rotate(90deg)` transform on the
  wrapper, never a second drawing.
- Render each ship as **one absolutely-positioned element** over the board grid, spanning
  `len × --bs-cell`, not as N cell backgrounds. The cells underneath stay water.
- Give each class a genuinely distinct silhouette:
  - **Carrier** (5) — long flat deck, island offset to one side, deck line markings
  - **Battleship** (4) — heavy hull, two turret clusters, bridge tower, funnel
  - **Cruiser** (3) — slimmer hull, single turret fore and aft
  - **Submarine** (3) — rounded hull, low profile, conning tower, no turrets
  - **Destroyer** (2) — small, sharp bow, single funnel
- Two-tone plus a shadow: hull in `--bs-ship`, deck details a lighter tint, a soft drop shadow so
  it reads as sitting on water rather than painted into it. Keep it flat-vector, not skeuomorphic
  — it has to hold up at ~28px per cell on a phone and in dark mode.
- **The same art is reused in three places**, so build it once: the placement drag chips
  (currently `.bs-shipchip-cell`, little squares, `ui.js:557`), the fleet roster silhouettes
  (currently `.bs-roster-cell`, 6px squares, CSS line ~232), and the board itself. A ship should
  look like the same object in all three.
- **Placement screen**: the dragged ghost is the real ship sprite, semi-transparent, not a run of
  tinted cells. Keep the existing valid/invalid shape-and-text feedback (solid vs dashed outline
  plus the ✕ badge) — that part is right and it is the colorblind-safe half.
- **Enemy board never renders a ship** until it is sunk. On sinking, the boat sprite reveals,
  lists, and settles (see section 4).

---

## 4. VISUAL — the firing animation

**What Matt sees:** a small hollow circle appears on the cell. That is the entire "bomb drop."
The current miss is a white circle peg (`.bs-peg-miss`) and the current hit is a vermilion circle
peg (`.bs-peg-hit`) — **the same shape in two colors**, which is also a repo accessibility
violation: wherever color is a choice it gets a shape marker, never hue alone, because Matt is
red/green colorblind.

**Fix: three distinct beats, each of which reads even at a glance.**

| Beat | Timing | What happens |
|---|---|---|
| **Launch** | 0-90ms | the target cell takes a brief reticle (keep the existing `bs-reticle-snap`, it is fine) |
| **Travel** | 90-450ms | a shell arcs in from off-board toward the cell: one absolutely-positioned element, `transform` only, translating along the arc while its **shadow ellipse on the water grows and darkens** underneath it. The shadow is what sells the height. |
| **Impact — miss** | 450-1000ms | a **vertical water plume**: a white column that shoots up, widens, and falls back, plus two expanding surface rings and a few droplet specks. Settles into a **small hollow white ring** peg. |
| **Impact — hit** | 450-1100ms | a **fireball**: white flash, orange-to-vermilion burst, a shockwave ring, 4-6 debris specks thrown outward on `transform`, then a **dark smoke puff that rises and fades**. Settles into a **filled vermilion peg with a burst/star outline**, visibly a different SHAPE from the miss ring. Board shake stays (`bs-shake`) but keep it to `translate` only. |
| **Impact — sunk** | +0-900ms | the whole boat sprite reveals, **lists to ~12deg, slides down, and fades under the water line**, with a spreading oil-slick darkening on its cells. Then the `Sunk: Cruiser` banner. |

Rules that do not bend:

- `transform` and `opacity` only. No animating `width`, `height`, `top`, `left`, `inset` or
  `background-size`. Every one of those reflows.
- The whole sequence is **skippable and non-blocking**: the game state is already updated; the
  animation is decoration over it. A player who taps again mid-animation is never blocked.
- **`prefers-reduced-motion`**: no travel, no plume, no smoke, no shake. The peg appears, the
  boat reveals, done. The CSS block at line ~281 already does some of this; extend it to cover
  every new animation you add.
- Miss and hit must differ by **shape** (hollow ring vs filled burst), with color as
  reinforcement, not as the signal.

### The teal wedge

`.bs-radar::before` is a `conic-gradient` at `inset: -20%` inside an `overflow: hidden` box. It
renders as a hard-edged teal triangle parked over the board, and in five of the ten screenshots
it looks like a rendering artifact rather than a sweep. Either soften it hard (radial mask to
fade the outer edge, drop opacity to ~.12, add a leading edge line so it reads as sweeping) or
cut it and show "Computer is aiming…" with a subtle pulse on the board outline. Do not ship it
as it is.

---

## 5. VISUAL — board and water

Lower priority than 3 and 4, but this is what makes the whole thing look cheap in the
screenshots.

- **The water is flat pale blue** (`--bs-water: #bfe0f2`) with a hard checker of cell gaps. The
  references have depth. Give the board a subtle vertical gradient (lighter at the top), a very
  low-contrast wave texture, and thinner, lighter grid lines. Your own waters can read slightly
  lighter and calmer than the enemy's.
- **There are no coordinate labels.** Add A-J down the side and 1-10 across the top (8×8 for
  Quick). Every reference has them, and they make "he's working the top row" legible. Size them
  from `--bs-cell` and drop them below a threshold rather than letting them crush the board.
- **The fleet roster wraps to two ragged lines** under the enemy board on a phone. Give it a
  fixed single-row layout with the new mini ship sprites, or move it into the turn bar.
- **Dark mode**: re-check every new color against the `:root.gh-dark .bs-root` block. The new
  smoke, plume and shadow layers all need a dark-mode value or they will vanish or glow.

---

## 6. What must not regress

- `node test-game-conventions.mjs`, `node validate-sw-assets.mjs`, `node run-all-tests.mjs` all
  green. If you add `battleship/js/ship-art.js`, it goes in `sw.js`'s `ASSETS` and `CACHE` gets
  bumped past whatever is on `main` right now, not past your working copy.
- No raw resize / `orientationchange` / `visualViewport` listeners — `onViewportResize` only.
- No `touchmove` on `document` or `window`.
- The multiplayer protocol is not in scope and must not be touched. Nothing in this pass changes
  `game.js`, `hash.js`, or any `_mp*` method. If a visual change needs state the engine does not
  expose, add a read-only derivation in `ui.js` rather than changing what is transmitted or
  hashed.
- Win/lose popup keeps its close (X).
- No em dashes in user-facing copy.

## 7. Verification — do these before you say it is done

1. Play a full solo game at phone width (390×844). **The boards must not change size, at all, at
   any point.** Watch the turn flips specifically.
2. Same game with `prefers-reduced-motion: reduce` forced on. Every state must still be legible
   with no animation whatsoever.
3. Same game in dark mode.
4. Rotate to landscape mid-match. The boards re-fit once, cleanly.
5. Open the setup screen and confirm the bonus row reads `Off` / `On`, in both languages.
6. Look at a placed fleet and confirm you can tell the carrier from the destroyer without
   reading a label.
