# BUILD BRIEF — Pixel-exact recreation of a mobile Yahtzee game

**Read this whole document before writing a line of code.**

This is a *reproduction* brief, not a design brief. Every colour, coordinate, radius and
timing below was measured off the reference screenshot. **You have zero design latitude.**
Do not "improve" the palette, do not substitute a cleaner layout, do not modernise the
chrome. If something here looks unusual, it is because the original looks that way. Where
this document is silent, copy the reference image; where the image is ambiguous, ask.

The reference screenshot (`yahtzee.png`) must be placed next to your working file. You will
use it for visual diffing (§11).

---

## 0. Deliverable and stack

- **One file: `index.html`.** Vanilla HTML + CSS + JS. No React, no build step, no bundler,
  no CSS framework, no npm. It must run by double-clicking the file.
- Fonts from Google Fonts via `<link>`, with a graceful fallback stack (§3).
- No external images. Every graphic — dice pips, house icon, card fan, monster avatars,
  chevron, kebab menu — is drawn as inline SVG or CSS. No emoji anywhere, ever.
- Target: mobile portrait. Runs correctly in desktop Chrome too (letterboxed, §1).
- Code organisation inside the file: `<style>` block, then markup, then a single `<script>`
  with clearly separated sections (`STATE`, `SCORING`, `RENDER`, `ANIMATION`, `INPUT`, `AI`).

---

## 1. Stage and coordinate system

The whole game lives on a fixed logical stage of **410 × 730 px**. Every number in this
document is in stage coordinates with the origin at the stage's top-left.

```
body { background:#fff; display:grid; place-items:center; height:100vh; margin:0; overflow:hidden; }
#stage { position:relative; width:410px; height:730px; overflow:hidden;
         transform-origin: center center; }  /* scale via JS to fit viewport */
```

On load and on resize, set `scale = min(vw/410, vh/730)` and apply
`transform: scale(scale)`. Everything inside the stage is absolutely positioned at the exact
pixel coordinates given below. No flexbox guessing for the major layout — position it.

Vertical bands, top to bottom:

| Band | Y range | Height |
|---|---|---|
| Header bar | 0 – 63 | 64 |
| Gold rule | 64 – 67 | 4 |
| Dark amber shadow rule | 68 – 71 | 4 |
| Orange strip | 72 – 86 | 15 |
| Blue playfield | 87 – 730 | 643 |

---

## 2. Palette (measured — use these exact values)

```css
:root{
  /* header */
  --hdr-top:#D53922;  --hdr-bot:#CB3219;
  --pod-active:#F4584A;      /* current player's plate */
  --pod-idle:#7B1B0F;        /* waiting player's plate */
  --hdr-text:#FFFFFF;

  /* rules under the header */
  --gold-rule:#FBBB01;  --amber-shadow:#B74A0D;  --orange-strip:#FBA62F;

  /* playfield */
  --blue-field:#0878CE;  --cyan-rim:#10AEEF;  --cyan-rim-hi:#84DCF1;
  --teal-inset:#067299;

  /* scorecard */
  --card-border:#EAB74D;  --card-border-lo:#B1640A;  --card-hi:#FEFAEE;
  --row-a:#FDCF61;        /* odd rows  */
  --row-b:#F7BC4C;        /* even rows */
  --groove-dark:#D89334;  --groove-light:#FFDC8E;
  --divider:#FCF6F3;      /* centre column rule */

  /* score boxes */
  --box-top:#FFF5D3;  --box-bot:#FDD08F;  --box-border:#C1894B;
  --box-inner-shadow:rgba(140,80,10,.38);

  /* numerals */
  --ink:#8B4A0C;          /* solid brown numerals */
  --ink-ghost:rgba(139,74,12,.45);   /* live preview numerals */

  /* category icons */
  --icon-red-top:#FE4B4B;  --icon-red-bot:#CB2222;  --icon-red-edge:#9E1515;
  --icon-white:#FFFFFF;    --yahtzee-gold:#FFC93C;

  /* dice */
  --die-top:#FFFFFF;  --die-bot:#E3DDD0;  --die-edge:#B9B2A4;  --pip:#15181C;
  --die-hold:#FFD54A;

  /* buttons */
  --roll-rim:#0A88C4;  --roll-a:#9BF2FA; --roll-b:#33FEFE; --roll-c:#04D5F2;
  --roll-d:#027BAD;    --roll-lip:#012B4B;
  --play-on-a:#8CD44C; --play-on-b:#3F7A1B; --play-lip:#1F4A0A;
  --play-off-a:#4F822D; --play-off-b:#29650F; --play-off-text:#90958E;
}
```

---

## 3. Typography

```html
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Luckiest+Guy&display=swap" rel="stylesheet">
```

- **`Baloo 2` 800** — every number, player name, `ROLL`, `PLAY`, `3x`, `4x`, `SMALL`, `LARGE`, `?`.
- **`Luckiest Guy`** — the `Yahtzee` word inside its category icon, and the `YAHTZEE!!` celebration.
- Fallback: `"Baloo 2", "Nunito", system-ui, -apple-system, "Segoe UI", sans-serif`.

Outlined text (button labels, celebration) uses:

```css
paint-order: stroke fill;
-webkit-text-stroke: 4px <outline colour>;
```

Never use `text-shadow` stacks to fake an outline — they render mushy at this size.

---

## 4. The house style: "semi-3D"

Every raised element in this UI follows the same three-part recipe. Implement it once as a
mixin-like set of classes and reuse it. Do not skip any of the three parts — this is what
makes the original look extruded rather than flat.

1. **Body gradient** — vertical, light at the top, ~20% darker at the bottom.
2. **Top inner highlight** — `inset 0 2px 0 rgba(255,255,255,.55)`, 1–2 px.
3. **Bottom lip** — a solid darker band 3–4 px tall at the very bottom (use
   `box-shadow: 0 4px 0 <darker>`), plus a soft ground shadow
   `0 5px 6px rgba(0,0,0,.28)`.

Recessed elements (the cream score boxes, the unlit roll pip) invert it: darker at the top,
lighter at the bottom, `inset 0 3px 4px var(--box-inner-shadow)` and a 1 px light line along
the bottom inner edge.

Corner radii: category icons `12px`, score boxes `9px`, dice `11px`, buttons `16px`,
header pods `24px`, playfield frame `18px`, scorecard `16px`.

---

## 5. Header (Y 0 – 63)

Background: `linear-gradient(180deg, var(--hdr-top), var(--hdr-bot))`, full stage width.

Contents, left to right:

| Element | X | Y | Size | Notes |
|---|---|---|---|---|
| Back chevron `<` | 24 – 36 | 24 – 44 | 12 × 20 | White, 4 px round-capped SVG stroke |
| **Player-1 pod** | 75 – 205 | 12 – 59 | 130 × 47 | radius 24 |
| P1 avatar | centre (86, 31) | | ⌀ 42 | overlaps the pod's left end |
| P1 total `105` | 120 | baseline 41 | 30 px / 800 | white, left-aligned |
| P1 name `FabulousR…` | 120 | baseline 54 | 13 px / 700 | white, truncated with a real ellipsis |
| **Player-2 pod** | 204 – 330 | 12 – 59 | 126 × 47 | radius 24 |
| P2 total `67` | 232 | baseline 41 | 30 px / 800 | white |
| P2 name `Turtle` | 232 | baseline 54 | 13 px / 700 | white |
| P2 avatar | centre (327, 31) | | ⌀ 45 | overlaps the pod's right end |
| Kebab `⋮` | 377 – 385 | 18 – 46 | 3 dots ⌀ 5 | white, 6 px apart |

**Pod state is the turn indicator.** The player whose turn it is gets `--pod-active`
(salmon); the other gets `--pod-idle` (dark maroon). In the reference, Player 1 is active.
Cross-fade the two pod colours over 250 ms when the turn passes.

**Avatars.** Both are the same cartoon monster head: a rounded blob body, two large white
eyes with black pupils, a wide grin showing two square teeth, two small horns. P1's ring is
4 px `#FDFCF2` (cream/white) over a `#7DBE3C → #4E8C1E` green body. P2's ring is 4 px
`#C610A7` (magenta) over the same green body. Draw them as inline SVG; keep them simple —
they read as 40 px silhouettes.

**Rules below the header.** Three stacked full-width bars: gold `#FBBB01` (Y 64–67), dark
amber `#B74A0D` (Y 68–71), orange `#FBA62F` (Y 72–86).

---

## 6. Playfield and scorecard frame

Blue field: `#0878CE`, spans Y 87 → 730, full width.

Inside it, a cyan bevel frame hugs the scorecard on all four sides:

```
Frame outer:  X 0 – 410,  Y 87 – 552   (rounded 18px, clipped at the stage edges)
  background: var(--cyan-rim)
  box-shadow: inset 0 2px 0 var(--cyan-rim-hi),
              inset 0 -8px 12px rgba(3,60,86,.55);
```

The frame's left and right edges run flush to the stage edges (the original's rounded corners
are cut off by the screen). Between the frame and the scorecard there is a 6 px dark teal
inset shadow (`--teal-inset`).

**Scorecard:** `X 16 – 397` (382 wide), `Y 99 – 566` (467 tall), radius 16.
- 3 px border `--card-border`, with a 1 px `--card-hi` inner highlight inside it and a
  `--card-border-lo` line along the bottom edge.
- The card is a **7-row grid**, row pitch **66.5 px**, first row starting at `Y 104`.

---

## 7. Scorecard anatomy — this is the part everyone gets wrong

### 7.1 It is a shared two-player card

Each row has **four** slots:

```
[ category icon ] [ YOUR score box ] │ [ OPPONENT'S score ]
```

The cream box holds the **current viewer's** (Player 1's) committed score. The bare brown
numeral to the right of it holds **Player 2's** committed score for that same category.
There is no separate opponent card. This is verified: Player 1's five box values sum to 105
and Player 2's six right-hand values sum to 67, exactly matching the header totals.

Column X coordinates:

| Slot | Left half (upper section) | Right half (lower section) |
|---|---|---|
| Category icon | 23 – 71 (48 × 48) | 212 – 261 (49 × 48) |
| Own score box | 85 – 132 (48 × 47) | 274 – 321 (48 × 47) |
| Opponent numeral | zone 136 – 204, right-aligned to 204 | zone 325 – 392, right-aligned to 392 |

A 1 px vertical rule at `X 134` and `X 323` (colour `rgba(200,145,80,.45)`) separates the
own-score column from the opponent column, running the full card height.

The two halves are separated by a **3 px vertical rule at X 206 – 209**, colour `--divider`
with a 1 px `#F7D189` shadow on each side, running the full card height.

### 7.2 Rows

Left half has **6** rows (Ones…Sixes). Right half has **7** rows. Row 7 of the left half is
empty card background — do not put anything there.

| # | Left half | Right half |
|---|---|---|
| 1 | Ones | Three of a kind (`3x`) |
| 2 | Twos | Four of a kind (`4x`) |
| 3 | Threes | Full house (house glyph) |
| 4 | Fours | Small straight (`SMALL`) |
| 5 | Fives | Large straight (`LARGE`) |
| 6 | Sixes | Yahtzee (`Yahtzee` wordmark) |
| 7 | *(empty)* | Chance (`?`) |

Row banding: odd rows `--row-a` (#FDCF61), even rows `--row-b` (#F7BC4C), applied across the
full card width. Between rows, a 2 px groove: 1 px `--groove-dark` above 1 px
`--groove-light`.

### 7.3 Category icons

Red rounded squares, radius 12, `linear-gradient(180deg,#FE4B4B,#CB2222)`, 2 px `#9E1515`
bottom lip, `inset 0 2px 0 rgba(255,255,255,.45)` top highlight, soft ground shadow.

- **Ones–Sixes:** standard white pips on the red square, ⌀ 8 px, standard die layouts
  (1 = centre; 2 = TL+BR diagonal; 3 = diagonal of three; 4 = corners; 5 = corners + centre;
  6 = two columns of three).
- **`3x` / `4x`:** white Baloo 2 800, the digit ~26 px and the `x` ~19 px, baseline-aligned,
  slight italic lean.
- **Full house:** solid white house silhouette — wide triangular roof overhanging a square
  body, small door notch cut out. ~30 px wide, centred.
- **Small / Large straight:** a fan of 3 white rounded cards (each ~13 × 18, rotated −16°,
  0°, +16°, overlapping) in the upper two-thirds; below them a white rounded banner ~34 × 12
  containing the word `SMALL` / `LARGE` in red `#D42E2E`, 9 px, 800, letter-spacing 0.5 px.
- **Yahtzee:** the word `Yahtzee` in Luckiest Guy, ~13 px, gold `#FFC93C`, skewed −8°,
  slight arc, with a 2.5 px `#8B1A00` stroke.
- **Chance:** a white `?` ~30 px, Baloo 2 800, centred.

### 7.4 Score boxes

48 × 47, radius 9, `linear-gradient(180deg, var(--box-top), var(--box-bot))`, 2 px
`--box-border`, `inset 0 3px 4px var(--box-inner-shadow)`, plus `inset 0 -1px 0
rgba(255,255,255,.7)`. Recessed, not raised.

Committed numerals: `--ink`, Baloo 2 800, 24 px, centred, with a 1 px
`rgba(255,255,255,.55)` bottom highlight for the embossed look.

Opponent numerals: same style, same size, right-aligned in their zone, no box behind them.

Preview numerals (§9.3): same glyphs at `--ink-ghost`, rendered inside the empty box.

---

## 8. Dice tray and controls

**Dice:** five, each **56 × 56**, radius 11, at `X = 19, 98, 177, 256, 335` (pitch 79),
`Y = 591`.

Face: `linear-gradient(160deg,#FFFFFF 0%, #FFFFFF 45%, #E3DDD0 100%)`, 1 px `#B9B2A4`
border, `inset 0 2px 0 #fff`, `box-shadow: 0 4px 0 #C8C2B4, 0 7px 8px rgba(0,20,50,.4)`.
Pips: `#15181C`, ⌀ 9 px, positioned on a 3 × 3 grid inset 11 px from each edge.

**ROLL button:** `X 10 – 267`, `Y 664 – 723` (257 × 59), radius 16.

```css
background: linear-gradient(180deg,
  #0A88C4 0%, #0A88C4 5%, #9BF2FA 9%, #56FEF9 22%,
  #33FEFE 42%, #04D5F2 72%, #027BAD 92%, #012B4B 100%);
```

Label `ROLL` in Baloo 2 800, 26 px, white, `-webkit-text-stroke: 4px #05496E`, positioned at
`X 28`, vertically centred.

**Roll-count pips:** three rounded squares, **22 × 22**, radius 6, at `X = 178, 208, 238`,
`Y = 676`. A pip for a roll already used is white (`#FFFFFF`, `inset 0 -2px 0 #B9CEDB`) with
its number (`1`, `2`, `3`) in `#0A5A84`, 14 px, 800. An unused pip is
`rgba(1,60,95,.35)` with the number at 30% opacity. In the reference: pips 1 and 2 are lit,
pip 3 is dim.

**PLAY button:** `X 279 – 405`, `Y 672 – 723` (126 × 51), radius 16. Note it is deliberately
**shorter than ROLL and bottom-aligned with it.**

- *Disabled* (reference state): `linear-gradient(180deg,#4F822D,#29650F)`, label `PLAY` in
  `#90958E`, 22 px, 800, no stroke, no glow.
- *Enabled*: `linear-gradient(180deg,#8CD44C,#3F7A1B)`, label white with
  `-webkit-text-stroke: 3px #234E08`, top highlight, 4 px `#1F4A0A` lip, and a 1.6 s
  `scale(1) → scale(1.04)` breathing pulse.

---

## 9. Game model and rules

### 9.1 State

```js
state = {
  players: [
    { name:'FabulousR…', scores:{}, avatar:'cream' },
    { name:'Turtle',     scores:{}, avatar:'magenta' }
  ],
  current: 0,
  dice: [ {value:1, held:false}, ... ×5 ],
  rollsUsed: 0,
  selected: null,        // category key pending PLAY
  phase: 'idle'|'rolling'|'awaitingPick'|'celebrating'|'gameOver',
  yahtzeeBonusCount: [0,0]
}
```

Categories: `ones twos threes fours fives sixes threeKind fourKind fullHouse smallStraight
largeStraight yahtzee chance`.

### 9.2 Scoring (standard Yahtzee — implement exactly)

- Upper (ones…sixes): sum of matching dice.
- Three/four of a kind: sum of **all five dice**, else 0.
- Full house: 25, else 0. Small straight: 30. Large straight: 40. Yahtzee: 50. Chance: sum.
- **Upper bonus:** +35 when a player's upper section reaches 63. There is no bonus row on
  this card, so fold it into the header total and fire a small `+35 BONUS!` toast (gold,
  rises and fades over 1.2 s from the header pod).
- **Yahtzee bonus:** a second or later Yahtzee, when the yahtzee box already holds 50, scores
  +100 and the player still fills another category. If the yahtzee box holds 0, no bonus.
- **Joker rule:** with a bonus Yahtzee, the matching upper box must be used if free;
  otherwise any lower category is free, and full house / small / large straight score their
  full 25 / 30 / 40.

### 9.3 Turn flow

1. Turn starts: `rollsUsed = 0`, all dice unheld, all pips dim, ROLL enabled, PLAY disabled.
2. Tap **ROLL** → dice animate (§10.1) → `rollsUsed++`. At `rollsUsed === 3`, ROLL goes dim
   and unclickable.
3. Between rolls, tapping a die toggles hold. Held dice rise 10 px, gain a 3 px `#FFD54A`
   ring and a soft gold glow, and do not spin on the next roll.
4. After at least one roll, **every empty category belonging to the current player shows a
   ghost preview** of what the current dice would score there, drawn at `--ink-ghost` inside
   the empty box. Zero-scoring categories show a ghosted `0`. Recompute on every roll.
5. Tapping a previewed box selects it: the box gets a 3 px `#FFD54A` pulsing ring, its ghost
   number goes solid, PLAY switches to enabled.
6. Tapping **PLAY** commits: ghost → solid with a bounce (§10.2), header total ticks up,
   turn passes, pods cross-fade, dice reset.
7. Game ends when all 13 categories are filled for both players. Show a winner overlay in the
   same visual language (orange card, gold rule, chunky type) with final totals and a
   `PLAY AGAIN` button styled like the enabled PLAY button.

### 9.4 Opponent

Default `MODE = 'ai'`: Player 2 is a simple greedy AI. It rolls, holds the largest matching
group (or the straight-completing dice when a straight is one away), rolls up to 3 times,
then picks the highest-scoring free category, breaking ties toward the lower section. Insert
600–900 ms delays between its actions so the animations are visible. Also support
`MODE = 'hotseat'` (both players tap) behind a single constant at the top of the script.

---

## 10. Animation spec

Respect `prefers-reduced-motion: reduce` by cutting all durations to ~1 frame and skipping
confetti, but never by removing the animations entirely.

### 10.1 Dice roll — real 3D tumble

Build **each die as a genuine CSS 3D cube**, not a sprite flicker.

```css
.die { perspective: 600px; }
.cube { position:relative; width:56px; height:56px; transform-style:preserve-3d;
        transition: transform .72s cubic-bezier(.22,.8,.24,1); }
.face { position:absolute; inset:0; backface-visibility:hidden; /* die face styling */ }
```

Faces at `translateZ(28px)` with these rotations, opposite faces summing to 7:

| Face | Placement transform | To show it at the front |
|---|---|---|
| 1 | `translateZ(28px)` | `rotateX(0) rotateY(0)` |
| 6 | `rotateY(180deg) translateZ(28px)` | `rotateY(180deg)` |
| 2 | `rotateX(90deg) translateZ(28px)` | `rotateX(-90deg)` |
| 5 | `rotateX(-90deg) translateZ(28px)` | `rotateX(90deg)` |
| 3 | `rotateY(90deg) translateZ(28px)` | `rotateY(-90deg)` |
| 4 | `rotateY(-90deg) translateZ(28px)` | `rotateY(90deg)` |

Roll sequence per unheld die, **staggered 55 ms** left to right:

| Phase | t | Behaviour |
|---|---|---|
| Launch | 0 – 90 ms | `translateY(-22px) scale(1.14)`, ground shadow shrinks to 55% and blurs |
| Tumble | 90 – 640 ms | `rotateX(360·(2+rand(2)) + targetX) rotateY(360·(2+rand(2)) + targetY)`, plus `translateX(±7px)` wobble and `translateY` arc peaking at −34 px |
| Drop | 640 – 780 ms | back to `translateY(0)` on `cubic-bezier(.34,1.56,.64,1)` (overshoot) |
| Squash | 780 – 860 ms | `scaleY(.86) scaleX(1.08)` → `scale(1)`, ground shadow snaps back |

Add a 3-frame ±2 px tray shake when the last die lands. Optional but wanted: a short
WebAudio click-clack (2–3 filtered noise bursts) on each landing.

### 10.2 Score commit

Box flashes to `#FFF9E6` for 90 ms; the numeral animates
`scale(1.7) → scale(.92) → scale(1)` over 340 ms with `cubic-bezier(.34,1.56,.64,1)`; the
header total runs a count-up ticker over 450 ms; the committed row gets a left-to-right gold
shimmer sweep (linear-gradient highlight translating across, 500 ms, once).

### 10.3 `YAHTZEE!!` celebration — the set piece

Fires the moment a Yahtzee is committed (and on every bonus Yahtzee). Full-stage overlay,
`pointer-events:none`, total duration **2600 ms**.

Layers, back to front:

1. **Flash** — white full-stage, opacity 0 → .38 → 0 over 140 ms.
2. **Rays** — 16 golden triangular rays radiating from centre (conic-gradient or SVG),
   `#FFE680 → transparent`, rotating 360° over the full 2600 ms, scaling 0.3 → 1.9,
   opacity 0 → .85 → 0.
3. **Text** — `YAHTZEE!!` in Luckiest Guy, 62 px, centred at (205, 300).
   Fill `linear-gradient(180deg,#FFF2B0,#FFC400,#FF8A00)` via `background-clip:text`;
   `-webkit-text-stroke: 7px #8B1A00`; `filter: drop-shadow(0 6px 0 #6B1200) drop-shadow(0 10px 14px rgba(0,0,0,.5))`.

   Keyframes: `0% scale(.15) rotate(-20deg) opacity 0` → `28% scale(1.32) rotate(7deg)
   opacity 1` → `40% scale(.93) rotate(-4deg)` → `52% scale(1.09) rotate(2deg)` →
   `62% scale(1)` → `88% scale(1) opacity 1` → `100% scale(1.15) translateY(-38px) opacity 0`.
4. **Confetti** — 70 pieces spawned at centre with random velocity
   (`vx ±340 px/s`, `vy −260…−620 px/s`), gravity `1150 px/s²`, per-piece rotation
   `±720°/s`, sizes 6–13 px, mixed rectangles and circles, colours drawn from
   `#FFC93C #FE4B4B #10AEEF #7DBE3C #FFFFFF #C610A7`. Animate on `requestAnimationFrame`,
   fade over the last 500 ms, then remove from the DOM.
5. **Stage shake** — the whole `#stage` translates on a 6-step ±5 px path over 380 ms,
   starting at t = 120 ms. Apply it as a wrapper transform so it composes with the fit-scale.

Also: the Yahtzee category icon pulses gold and the header total ticker runs +50 during the
celebration.

### 10.4 Micro-interactions

- Any button press: `translateY(3px)`, lip shrinks from 4 px to 1 px, 60 ms. Release springs back.
- Die hold/unhold: 140 ms lift with a slight `rotate(±3deg)`.
- Category hover/tap-down: box brightens 6% and lifts 1 px.
- Turn change: pods cross-fade 250 ms; the incoming player's pod does one 1.06 scale pulse.
- Disabled ROLL/PLAY: 55% saturation, no lip, `cursor:not-allowed`.

---

## 11. Reference state — reproduce this frame exactly

Build a `DEBUG_REFERENCE = true` constant that renders this exact frozen state so you can
pixel-diff against `yahtzee.png`. It must reproduce with **zero** deviation.

- Header: P1 `105` / `FabulousR…` on the **active salmon** pod; P2 `67` / `Turtle` on the
  **idle maroon** pod. P1's turn.
- Dice, left to right: **5, 6, 3, 6, 6**. None held.
- Roll pips: 1 and 2 lit, 3 dim. (`rollsUsed = 2`.)
- PLAY disabled. Nothing selected. No previews rendered in this frozen frame.
- Scorecard:

| Row | Left category | P1 box | P2 numeral | Right category | P1 box | P2 numeral |
|---|---|---|---|---|---|---|
| 1 | Ones | — | **4** | Three of a kind | **14** | **18** |
| 2 | Twos | **8** | — | Four of a kind | **28** | — |
| 3 | Threes | — | — | Full house | — | **0** |
| 4 | Fours | — | **12** | Small straight | — | — |
| 5 | Fives | **15** | **10** | Large straight | **40** | — |
| 6 | Sixes | — | — | Yahtzee | — | — |
| 7 | *(empty)* | | | Chance | — | **23** |

Check: P1 boxes 8+15+14+28+40 = **105** ✓. P2 numerals 4+12+10+18+0+23 = **67** ✓.

- Two small 4-point sparkle glints on the card: one at `(363, 383)` and one at `(404, 372)`,
  white, ~9 px, twinkling on a 1.8 s loop. These sit near the Large Straight row.

---

## 12. Verification loop — do not skip

1. Render at exactly 410 × 730 with `DEBUG_REFERENCE = true`, screenshot it.
2. Overlay it on `yahtzee.png` (which is 456 × 761 with a white margin — the game area is
   at x 22–430, y 18–746, so crop it to that 409 × 729 region first) and compute a diff.
3. Fix every region where the diff shows structural error: wrong x/y, wrong width, wrong
   radius, wrong band colour. Anti-aliasing and font-rendering differences are acceptable;
   layout and colour differences are not.
4. Repeat until the diff is clean. Report the remaining known deltas honestly rather than
   claiming a match you have not verified.
5. Then set `DEBUG_REFERENCE = false` and play a full 13-round game end to end, confirming:
   every category scores correctly, the upper bonus fires at 63, the Yahtzee celebration
   fires, a bonus Yahtzee awards +100, the joker rule works, ROLL locks after 3 rolls,
   PLAY stays disabled until a category is selected, and the game-over screen shows the
   correct winner.

---

## 13. Explicit do-nots

- No emoji, no icon fonts, no Font Awesome. Everything is inline SVG or CSS.
- No flat design, no Material shadows, no soft neumorphism. Every raised surface gets the
  three-part §4 treatment.
- Do not change the palette "for accessibility" or "for contrast". Do not add a dark mode.
- Do not reorder categories, do not add a bonus row, do not add totals rows to the card —
  the totals live in the header pods and nowhere else.
- Do not make PLAY the same height as ROLL. Do not centre the two buttons as a pair.
- Do not swap the meaning of the two number columns: the cream box is the viewer's score,
  the bare numeral is the opponent's.
- Do not substitute a `<canvas>` renderer for the scorecard. DOM + CSS only, so the diff
  stays inspectable.
- Do not ship without running §12.
