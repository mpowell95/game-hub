# UNO — Design Spec v1

Status: **awaiting approval**. No implementation until approved.
Binds: `uno/css/uno.css`, `uno/js/ui.js` (render + card markup only).
Inherits: THE LAW colorblind rule, system fonts only, no external assets, CSS scoped under `.un-root`.

---

## 1. Direction statement

**Pressed plastic.** Every card is a saturated tile with its shape mark *debossed into the face* —
a large circle, triangle, square, or diamond pressed into the plastic, with the numeral riding on
top of it. Not a white oval, not a printed sticker: a molded surface with a rim, a gloss falloff,
and edges that catch light. The table beneath is a dark, quiet field so the cards are the only
bright objects on screen, and the hand is a real fan held below the mat — overlapping, arced,
tilted — never a row.

Why this and not a generic card game: the shape-per-color system is a hub-wide requirement Matt
already carries for colorblind safety, and no commercial Uno product has it. Treating the shape as
the card's structural motif instead of a corner tax is the one thing that makes this deck
identifiably his. **Color becomes confirmation; shape carries the information.** A build that
renders the shape as a small corner marker is not this design.

**Calibration check performed.** The first pass was a dark felt table with a warm accent and
glossy rounded cards — which is what I'd produce for any card game, so it was a default rather
than a choice. Changed: the felt-green table (replaced with neutral slate, because four saturated
hues on green muddies the teal), the white oval (replaced with the debossed medallion, which is
the actual point of difference), and the flat hand row (replaced with the arced fan, which is the
invariant that failed).

---

## 2. Color tokens

The four card hues are **fixed by THE LAW** and do not change. Everything else is new.

```css
/* card hues — LOCKED, colorblind pairing is contractual */
--un-red:    #E0532F;  /* square   */
--un-yellow: #F2B705;  /* circle   */
--un-green:  #178A7A;  /* diamond  */
--un-blue:   #1F5FA8;  /* triangle */
--un-wild:   #23232C;  /* four-way */

/* table + chrome */
--un-table:      #171C26;  /* mat field, the dark quiet ground */
--un-mat-muted:  #8B98AC;  /* UN-12: text painted ON the mat - theme-invariant, matches
                               dark-theme --un-muted. --un-muted itself flips to a DARK
                               color in light mode and fails contrast on the always-dark
                               mat (measured 3.71:1, below WCAG AA's 4.5:1) - use this,
                               never the chrome --un-muted, for anything drawn inside
                               .un-mat (pile count, direction arrow) */
--un-bg:         #10141C;  /* page behind the shell */
--un-surface:    #1E2531;  /* overlays, chips, sheets */
--un-ink:        #E8ECF3;
--un-muted:      #8B98AC;
--un-border:     rgba(255,255,255,.10);

/* card surface treatment */
--un-card-rim:      rgba(255,255,255,.94);  /* printed white border, 3px */
--un-card-edge:     rgba(0,0,0,.32);        /* hairline outside the rim */
--un-medallion:     rgba(255,255,255,.22);  /* debossed shape fill */
--un-medallion-lo:  rgba(0,0,0,.22);        /* pressed-in shadow, +1px down */
--un-medallion-hi:  rgba(255,255,255,.16);  /* pressed-in highlight, -1px up */
--un-gloss-hi:      rgba(255,255,255,.16);  /* top-left falloff */
--un-gloss-lo:      rgba(0,0,0,.12);        /* bottom-right falloff */
--un-numeral-shade: rgba(0,0,0,.28);        /* numeral drop, 0 2px 0 */
```

**Shadow stack** — three states only. No component improvises its own shadow.

```css
--un-sh-rest:   0 1px 1px rgba(8,12,20,.24), 0 2px 5px rgba(8,12,20,.20);
--un-sh-raised: 0 2px 3px rgba(8,12,20,.24), 0 9px 18px rgba(8,12,20,.26);
--un-sh-lift:   0 4px 6px rgba(8,12,20,.26), 0 20px 38px rgba(8,12,20,.34);
```

**Non-color cue, per hue:** the debossed medallion (§7) and the top-left corner mark both carry
the shape. Two independent shape channels per card. The color chooser keeps shape + hue chips.

**Light mode.** The **mat stays dark in both themes** (decided). `--un-table` and every card token
are theme-invariant, so the cards always sit on the same ground and never have to restate their
contrast. Light mode changes only the surrounding chrome: `--un-bg` → `#EEF1F6`, `--un-surface` →
`#FFF`, `--un-ink` → `#1C2430`, `--un-muted` → `#6B7686`, `--un-border` → `rgba(0,0,0,.10)`. The
dark mat then reads as a deliberate playing surface inset into a light page, which is what it is.
`.un-mat` itself renders `background: var(--un-table)` (UN-12; this was decided from day one but
not actually painted until then) — the mat is what makes the screen read as a game board rather
than a web page. Because the mat's *contents* (pile count, direction arrow) sit directly on that
always-dark ground, they read against `--un-mat-muted`, not the chrome `--un-muted` above, which
would go dark-on-dark in light mode.

---

## 3. Type scale

System stack only: `system-ui, -apple-system, 'Segoe UI', sans-serif`.

| Token | Size | Weight | Tracking | Line-height | Used for |
|---|---|---|---|---|---|
| `--un-t-numeral` | 34px | 900 | -0.03em | 1 | card face value (scales with card, see §4) |
| `--un-t-numeral-sm` | 22px | 900 | -0.03em | 1 | discard pile + small cards |
| `--un-t-corner` | 13px | 800 | 0 | 1 | top-left corner value |
| `--un-t-ui` | 15px | 600 | 0 | 1.3 | status line, buttons |
| `--un-t-label` | 12px | 700 | .02em | 1 | pile counts, chips |

**Numeral treatment** (this is what separates it from a `<span>` with a big font-size):
`color: #fff`, `text-shadow: 0 2px 0 var(--un-numeral-shade)`, and
`-webkit-text-stroke: 1.5px rgba(0,0,0,.22)` with `paint-order: stroke fill`. Action glyphs
(`+2`, `+4`, `⊘`, `⇄`) use the same treatment at 26px so they optically match the digits.

---

## 4. Space + geometry scale

```css
--un-sp-1: 4px;  --un-sp-2: 8px;  --un-sp-3: 12px;
--un-sp-4: 16px; --un-sp-5: 24px; --un-sp-6: 32px;

--un-r-card: 9px;    /* card corner */
--un-r-chip: 999px;  /* pills */
--un-r-sheet: 16px;  /* overlays */

--un-card-w: 62px;         /* hand + mat card */
--un-card-h: 92px;         /* 1.484 ratio, holds a 34px numeral with air */
--un-card-w-sm: 48px;
--un-card-h-sm: 71px;
--un-card-rim-w: 3px;
```

**Fixed regions** (reserved from first paint, never reflow — THE LAW, zero vertical shift):

| Region | Height | Notes |
|---|---|---|
| `.un-opponents` | 52px | fixed whether 1 or 3 opponents (UN-11: was 44px, grew for the two-line chip) |
| `.un-status` | 22px | already has `min-height`, promote to fixed |
| `.un-mat` | **148px floor**, flexible | UN-13: `flex: 1 1 auto; min-height: 148px` — grows to absorb the viewport's slack instead of a hard fixed height (see "Viewport fill" below); still holds a 92px card + 20px pile count + pending badge headroom at minimum |
| `.un-handwrap` | 170px | 150px fan region + 20px UNO chip slot, reserved even when empty |
| `.un-bar` | 40px | |

Shell stays `max-width: 480px`, padding `14px`. Usable interior width **A = 452px**.

**Viewport fill (UN-13).** The GAME shell (`.un-shell.un-game`, not the setup screen) is
`min-height: 100dvh; display: flex; flex-direction: column;` — `dvh`, not `vh`, so mobile browser
chrome (the address bar showing/hiding) doesn't clip content. Every region above keeps its fixed
height; only `.un-mat` is flexible (`flex: 1 1 auto`, 148px floor), so it absorbs whatever
vertical slack the viewport has. This does **not** reintroduce layout shift under THE LAW's
zero-vertical-shift rule: `.un-mat`'s height depends on the *viewport*, fixed for the life of the
mount (barring a resize/rotation, which every other fixed-height region here already lives with),
never on *game state* — nothing shifts as cards are played, drawn, or the hand grows or shrinks.
The net effect: no dead band below `.un-bar`, and no oversized gap between the piles and the hand
— the mat simply grows or shrinks to make the column exactly fill the screen.

---

## 5. Layout

**Target viewport, 7 cards (opening hand, one row):**

```
┌────────────────────────────────────────────────┐ 480
│  ◉ Lucía  3    ◉ Marco  5    ◉ Ana  7          │  44  fixed
│                                                │
│              Your turn                         │  22  fixed
│                                                │
│   ┌──────────────────────────────────────┐     │
│   │            ↻                         │     │
│   │    ┌────┐          ┌────┐            │     │ 148 fixed
│   │    │▓▓▓▓│          │  7 │            │     │  mat, dark field
│   │    │▓▓▓▓│          │ ◆  │◆           │     │  perspective:1200px
│   │    └────┘          └────┘            │     │
│   │      64             discard          │     │
│   └──────────────────────────────────────┘     │
│                                                │
│                  ┌ UNO ┐  (slot reserved)      │  20
│         ╭──┬──┬──┬──┬──┬──┬──╮                 │
│        ╱ ▲│ ●│ ■│ ◆│ ▲│ ●│ ■ ╲                │
│       ╱  3│ 5│ +2│ 9│ 0│ ⇄│ 7  ╲               │ 150 fixed, 1 row
│      ╰────┴──┴──┴──┴──┴──┴─────╯                │  arced fan
│                                                │
│   How to play      Restart      New game       │  40
└────────────────────────────────────────────────┘
```

**13-20 cards (two balanced rows, e.g. after a stacked +4):**

```
│         ╭──┬──┬──┬──┬──┬──┬──╮                 │
│        ╱ ▲│ ●│ ■│ ◆│ ▲│ ●│ ■ ╲                │ row 0 (top)
│       ╱  3│ 5│ +2│ 9│ 0│ ⇄│ 7  ╲               │
│      ╰────┴──┴──┴──┴──┴──┴─────╯                │
│        ╭──┬──┬──┬──┬──┬──╮                     │ 150 fixed, still full size
│       ╱ ▲│ ●│ ■│ ◆│ ▲│ ●│ ╲                    │ row 1 (bottom, paints in front,
│      ╱  4│ 1│ 8│ 2│ ⊘│ 6 │ ╲                   │ overlaps row 0 by ~37%)
│     ╰────┴──┴──┴──┴──┴──┴────╯                  │
```

13 cards splits 7+6 (balanced), never 12+1 (fill-then-spill). Both rows render at their
full 62px card width — two rows fit inside the fixed 150px region at `fit = 1`.

**Worst case, 30 cards (three rows, scaled down):**

```
│  ╭┬┬┬┬┬┬┬┬┬┬╮                                  │ row 0, fit≈0.72
│  ╭┬┬┬┬┬┬┬┬┬┬╮                                  │ row 1, fit≈0.72, 150 same height
│  ╭┬┬┬┬┬┬┬┬┬┬╮                                  │ row 2 (front), fit≈0.72
```

The fan region height is identical at n=1 and n=30. Rows are added (not the region height)
as the hand grows; only once a 3rd row is needed does the whole fan scale down uniformly.

**Fan geometry (the invariant mechanism, UN-8).** Cards are absolutely positioned inside
`.un-fan`, laid out in *design space* into balanced rows at a constant horizontal step, then
the whole fan is scaled to fit its fixed-height box:

```
W         = 62      card width
H         = 92      card height
STEP      = 32      horizontal step, just over 50% of W
ROW_PITCH = 58      vertical distance between rows (rows overlap ~37%)
A         = usable interior width, measured (do not hard-code)
AVAIL     = A - 24  edge breathing room

PER_ROW  = max(1, floor((AVAIL - W) / STEP) + 1)     // 12 at AVAIL = 428
rows     = ceil(n / PER_ROW)
perRow   = ceil(n / rows)                            // balance rows, do not fill-then-spill

// card i sits at row r = floor(i / perRow), index j within that row
// rowN = number of cards actually in row r
c_j   = (rowN - 1) / 2
x_ij  = (j - c_j) * STEP
y_ij  = r * ROW_PITCH                          // UN-10: flat - no bow term. Every card
                                                // in a row shares this y; only rot_ij varies
rot_ij= (j - c_j) * min(1.8, 14 / max(1, rowN - 1))   // degrees, total arc per row ≤ 14°
z_ij  = r * 100 + j                            // lower rows paint in front

needH = H + ROW_PITCH * (rows - 1)
fit   = min(1, RESERVED_H / needH)             // RESERVED_H = 150
shiftY = RESERVED_H - needH                    // see note below; added to every y_ij
```

`.un-fan` gets `transform: scale(fit)`, `transform-origin: 50% 100%` (the box's bottom -
"a fan held below the mat"). Because a point sitting exactly at that origin doesn't move under
`scale()`, `y_ij` must add the constant `shiftY` above so the content's bottom edge always sits
at `RESERVED_H` **before** scaling: 0 at exactly 2 rows (`needH` already equals `RESERVED_H`),
positive at 1 row (bottom-aligns it instead of leaving empty space below), negative at 3+ rows
(content starts above the box, fine under `overflow: visible`). Skipping `shiftY` still
satisfies `fit ≤ 1`, but a 3-row hand's content drifts past the box's bottom by roughly
`(needH - RESERVED_H) * fit` px (~42px at n=25) instead of landing inside it - caught by
measuring `cardsMaxBottom` against `.un-hand`'s bottom in a live browser, not by the `fit`
math alone. Each card gets `transform: translateX(x_ij) translateY(y_ij) rotate(rot_ij)` with
**`transform-origin: 50% 100%`** (UN-10: each card's own bottom edge, not `50% 150%`) so
rotation pivots there instead of swinging through an arc below the hand — combined with the flat
`y_ij` above, every card in a row lands its bottom edge on the exact same line; only the tilt
varies card to card. Row 0 is the top row; the last row is the bottom row and paints in front,
overlapping the row above it. New cards continue to arrive at the left end.

**Row alignment (UN-10).** The original single-row design bowed each row into a shallow arc
(`(j - c_j)² * 0.4`, capped at 8px) and paired it with `transform-origin: 50% 150%` so rotation
swung from a point below the hand — visually fine on its own, but it combined badly with row 7's
per-card lift (below): the two effects together made playable cards look like they'd popped out
of alignment rather than been highlighted. Flattening the bow and pivoting rotation at each
card's own bottom edge (`50% 100%`) removes the ambiguity: every card's bottom edge sits on one
line **within its row**, at any hand size, and the only thing that still varies card to card is
the per-row tilt (still capped at 14° total, per row).

**The 50%-visibility invariant.** `STEP` (32) is just over half of `W` (62), so the exposed
horizontal sliver of every overlapped card is `STEP / W ≈ 51.6%` of its width — and because the
whole fan scales *uniformly* (`fit` multiplies both `STEP` and `W`), that ratio is unaffected by
scale. **At least 50% of every card is visible at any hand size**, from n=1 (no overlap at all)
up through arbitrarily large hands — cards get smaller as rows fill up, never more overlapped
than the `STEP/W` ratio allows. Only height (`RESERVED_H`) drives `fit`; `PER_ROW` is derived
from the measured width, so width fits by construction and never needs its own scale factor.

Worked examples (interior width A=452, so PER_ROW=12):

At n=1: 1 row, needH=92, fit=1, cards at full 62px, no overlap (single card).
At n=7: 1 row (7 ≤ 12), needH=92, fit=1, cards at full size, ~51.6% exposed.
At n=13: 2 rows (7+6, balanced), needH=150, fit=1, still full size.
At n=20: 2 rows (10+10), needH=150, fit=1, still full size.
At n=24: 2 rows (12+12, exactly PER_ROW), needH=150, fit=1, last full-size case.
At n=25: 3 rows (9+9+7), needH=208, fit=150/208≈0.72, cards render ~45px, still ~51.6% exposed.
At n=30: 3 rows (10+10+10), needH=208, fit≈0.72, cards ~45px. Small, but every card is at
least half visible and it never scrolls.

**Why the top-left corner mark matters more than it used to:** with overlap, the only part of a
buried card the player sees is its left sliver. The corner mark is the entire read. It goes to
13px, shape above value, inside the exposed column. The bottom-right corner mark is
**removed** — it is never visible in a fan and only steals face area.

**Fan direction (decided).** Cards read **left to right**, and a newly drawn card arrives at the
**left end**. Paint order stays positional within a row (`z = r*100 + j`), so each card's exposed
strip is its left edge and the top-left corner mark is always the visible read. A newly arrived
card is therefore at the bottom of its row's stack, so it gets a brief edge highlight on arrival
(motion #6a) rather than relying on stacking to be noticed.

### Opponent chips (UN-11)

A vertical two-line stack, not a single horizontal line:

```
┌──────────────┐
│  Computer 1  │   name,  11px / 700, --un-muted
│      7       │   count, 16px / 800, --un-ink
└──────────────┘
```

Session 3.5's ellipsis fix (`flex: 1 1 0; min-width: 0`) stopped the clipping but a horizontal
`emoji + name + count` layout still didn't leave room for a full name at 4 players — "Computer 1"
still read as "Co…". Stacking name over count needs far less horizontal room per chip, so the
full name fits without ellipsis in the common case. The chip keeps `flex: 1 1 0; min-width: 0`
(still sharing the row equally, still able to shrink) but is now `flex-direction: column`,
centered. The name line keeps `min-width: 0; overflow: hidden; text-overflow: ellipsis;
white-space: nowrap` **only as a fallback** for an unusually long custom name — the default
"Computer 1/2/3" strings must never be shortened to make this work (root `CLAUDE.md`'s "Adding a
game" checklist: the layout handles any name, not the other way around). The robot emoji is
dropped entirely — it cost real horizontal room and carried no information once every opponent
chip already means "computer." `.un-opponents` grows from 44px to **52px** fixed (still fixed at
2, 3, and 4 players) to hold the two lines. The active opponent's chip stays visually
distinguishable the same way as before (`.is-turn`'s `border-color`, motion #12's pulse) — UN-11
didn't touch either.

### Hand sort

Three display orders, cycled by one control. **Presentation only** — see §8.

| Mode | Order |
|---|---|
| `draw` (default) | as held, newest at the left end, no reordering |
| `color` | red, yellow, green, blue, wild; within a hue ascending 0-9, then ⊘, ⇄, +2; wilds last (★ then +4) |
| `rank` | ascending 0-9 across all hues, then ⊘, ⇄, +2, ★, +4, with the hue order above as the stable tiebreak |

`color` mode is what pays off the medallion: sorting by hue produces visible runs of identical
shapes, so the grouping is fully legible without relying on hue at all.

**Control.** A 28×28 icon button at the right end of the already-reserved UNO-chip row (§4), so it
costs no new vertical space and cannot shift layout. The icon shows the *current* mode, drawn as
inline SVG in the existing `dirArrowSVG` house style: `draw` = a fanned-cards mark, `color` = three
stacked shape marks, `rank` = ascending bars. `aria-label` names the mode being switched **to**. No
text label, no helper copy. Persisted in `gamehub.uno.v1` as `handSort`.

**Switching sort is a motion moment, not a repaint.** The fan reconciles by card id, so every card
slides to its new slot under motion #2. That transition is the reward for the tap and the reason
the control needs no explanatory copy at all.

---

## 6. Motion spec

Every entry has a functional job. Anything that couldn't state one was cut.

| # | Trigger | Property | Duration | Easing | Communicates |
|---|---|---|---|---|---|
| 1 | Game start | deal: each card from draw-pile origin to fan slot, 55ms stagger | 420ms | `cubic-bezier(.16,.84,.44,1)` | the hand is *dealt*, not printed |
| 2 | Hand size changes | fan re-layout, all cards to new transform | 260ms | `cubic-bezier(.32,.72,.32,1)` | the hand is a physical object that reflows |
| 3 | Human plays a card | translate + rotate + scale from fan slot to discard, z above all | 340ms | `cubic-bezier(.34,1.16,.64,1)` | causality: that card became this card |
| 4 | Card lands on discard | settle: rotate to a stable random −6°..6°, shadow `raised`→`rest` | 180ms | `cubic-bezier(.4,0,.2,1)` | the pile is a stack of real objects |
| 5 | Wild resolved / first flip | `rotateY(0→180deg)`, `preserve-3d`, shadow peaks at 50% | 380ms | `cubic-bezier(.45,.05,.25,1)` | reveal, not replacement |
| 6 | Draw | card arcs from deck into the fan, then #2 runs | 380ms | `cubic-bezier(.16,.84,.44,1)` | where the card came from |
| 7 | Turn becomes yours | **(UN-10)** illegal cards dim to `opacity: .45` (legal stays `opacity: 1`), 30ms stagger left→right | 180ms | `cubic-bezier(.4,0,.2,1)` | which cards are playable, without copy |
| 8 | Penalty stack grows | `.un-pendingbadge` scale 1→1.12→1 | 300ms | `cubic-bezier(.34,1.56,.64,1)` | the stack got bigger, look here |
| 9 | Penalty draw resolves | drawn cards arrive 90ms apart | per-card 380ms | as #6 | the size of what you just ate |
| 10 | UNO reached | chip scale .6→1.08→1, opacity 0→1 | 320ms | `cubic-bezier(.34,1.56,.64,1)` | one card left |
| 11 | Press a card | translateY(−8px) scale(1.04), shadow → `lift` | 120ms | `cubic-bezier(.4,0,.2,1)` | tactile ack |
| 12 | AI plays | opponent chip pulses border, their card flies from chip to discard | 340ms | as #3 | who acted, without a status sentence |
| 6a | New card settles into the fan | rim brightens to `#fff` then returns, opacity only | 400ms | `cubic-bezier(.4,0,.2,1)` | which card is new, since it sits at the bottom of the stack |
| 13 | Sort toggle tapped | reuses #2 at full: every card slides to its new slot | 260ms | as #2 | the hand reordered, and how |

**`prefers-reduced-motion: reduce`:** all of the above collapse to `0.01ms` except #10 and #8,
which become opacity-only fades at 120ms. Fan re-layout is instant. Flips swap face with no
rotation. No parallax, no arcs. The game must remain fully legible with every animation disabled.
Row 7 (UN-10) needs no special-case exception here the way #10/#8 do — its opacity change is an
ordinary CSS `transition`, already covered by the blanket `transition-duration: 0.01ms` collapse,
so it applies instantly with no separate rule.

**3D scope, deliberately bounded.** `perspective: 1200px` on `.un-mat` and `.un-fan`,
`transform-style: preserve-3d` on `.un-card`. That is the whole 3D system — enough for real card
flips and depth-correct lift, with no WebGL, no bundle, no canvas, no external assets, and no
conflict with the scoped-CSS or system-font rules. A card game does not have geometry that earns
a renderer.

---

## 7. Signature element

**The debossed shape medallion.**

Centered on every colored card face, a 46px shape (circle / triangle / square / diamond, per the
locked hue pairing) rendered as inline SVG, appearing pressed *into* the plastic:

```css
.un-medallion {
  position: absolute; inset: 0; margin: auto;
  width: 46px; height: 46px;
  fill: var(--un-medallion);
  filter:
    drop-shadow(0 1.5px 0 var(--un-medallion-lo))
    drop-shadow(0 -1px 0 var(--un-medallion-hi));
}
```

The numeral sits on top of it, `z-index: 1`, with the §3 stroke + drop treatment. The medallion is
the same shape as the corner mark, so a player learns one mapping and reads it at two scales.

**Wild cards:** the medallion becomes a 46px disc quartered into all four shapes, replacing the
current flat `.un-wildquad` colored grid — wilds are the only card where four shapes coexist,
which is exactly what a wild *is*.

Scales with `--un-card-w`: medallion is `74%` of card width. On `--un-card-w-sm` it renders at
36px with the numeral hidden (the shape alone identifies a small card).

**Everything else stays quiet.** This is the one bold move. The mat is a flat dark field with no
texture, the chrome is plain, the buttons are unstyled ghosts. Do not add a second signature.

---

## 8. Invariant satisfaction

| Invariant | Mechanism |
|---|---|
| **Entire hand visible, any n, never scrolls, ≥50% of every card exposed** | `overflow-x: auto` deleted from `.un-hand`. Cards wrap into balanced rows (`rows = ceil(n/PER_ROW)`, `perRow = ceil(n/rows)` — never fill-then-spill), and the whole fan gets a computed `scale(fit)` where `fit = min(1, RESERVED_H/needH)`. `fit` is mathematically ≤1 for all n, so the fan cannot exceed its box's height, and `PER_ROW` is derived from the measured width so it never exceeds the box's width either. Because `STEP` (32) is just over half of `W` (62) and the fan scales uniformly, the exposed fraction of every overlapped card is a constant `STEP/W ≈ 51.6%` regardless of `fit` — the 50%-visibility rule holds by construction at any hand size, not just checked at a few sizes. There is no scroll container left in the hand subtree. |
| **Zero vertical layout shift** | Every region in §4 has a fixed height set from first paint, including the UNO chip slot (reserved at 20px whether or not the chip is present) and the pending badge (absolutely positioned inside the mat's reserved space). Card count changes alter only `transform`, which does not affect layout. **UN-13's one exception**: `.un-mat` is `flex: 1 1 auto` with a 148px floor rather than a hard fixed height — still zero-shift under THE LAW because its height is a function of the *viewport* (fixed for the life of the mount), never of *game state*; nothing about it changes as cards are played, drawn, or the hand grows or shrinks. |
| **Colorblind safety** | Two independent shape channels per card: the 46px medallion and the 13px corner mark, both driven by the same `COLOR_META[color].shape`. No state is signalled by hue alone. Color chooser keeps shape+hue chips. **Playable state (UN-10) uses opacity, not tint** — illegal cards dim to `.45`, a brightness cue, same colorblind-safe reasoning as the lift it replaced. |
| **No instructional copy in gameplay UI** | Motion #7 (UN-10: illegal cards dim) and #12 (opponent chip pulse) carry the information that helper sentences would otherwise carry. No new strings are added to `strings.js`. |
| **System fonts, no external assets** | All shapes are inline SVG generated by the existing `shapeSVG()`. Medallion, gloss, and rim are CSS gradients and filters. Zero new files, so `sw.js` `ASSETS` is unchanged. |
| **Scoped CSS** | Every new rule is `.un-` prefixed and descendant-scoped under `.un-root`, per the "Adding a game" checklist item 3. |
| **Minimum tap target** | Constant 32px design-space sliver (≥50% of the 62px card width) × 92px height, within its row. At `fit < 1` the sliver scales with the card, so the exposed proportion never degrades. Within a row the topmost card and the pressed card receive full card area via `z-index` (`z = r*100 + j`); across rows the last (bottom) row always paints in front of earlier rows. |
| **Sort never touches game state** | `handSort` is applied to a *copy* of `players[HUMAN].hand` at render time only. The engine's hand array, the action log, and every id passed to `play()` are unaffected, so sort order cannot reach the lockstep move log, the state hash, or replay. A build where sorting mutates engine state is a correctness bug, not a preference. |

---

## Decisions (resolved, 2026-07-25)

1. **Mat is dark in both themes.** Cards and table never theme; light mode changes chrome only (§2).
   Accepted consequence: Uno is the one game whose play surface ignores the hub theme. If that
   bothers you later, the fix is a hub-wide "play surfaces don't theme" rule, not a change here.
2. **Fan reads left to right; new cards arrive at the left end** (§5). Newly arrived cards sit at
   the bottom of the paint stack, so motion #6a carries the "this one is new" signal.
3. **Graceful shrink, no hard `n` cap.** `fit` scales the fan without limit; the invariant holds at
   any hand size (§8).
4. **Hand sort added**: three modes, one cycling control, persisted, presentation-only (§5, §8).
5. **(2026-07-25, UN-10..13) Row 7 is opacity, not lift; the mat is actually painted dark; the
   shell fills the viewport.** Four defects from real iPhone testing: the lift + bow combination
   read as broken alignment rather than a hint (fixed by flattening the bow and switching row 7
   to an opacity cue, §5/§6); opponent names still ellipsized in practice despite UN-9's fix, so
   the chip became a two-line name/count stack and dropped the emoji (§4/§5); `.un-mat` had never
   actually been painted with `--un-table` despite §2 always specifying it (now fixed, §2); and
   the shell didn't fill the viewport, leaving a dead band below the button bar (now `.un-mat` is
   `flex: 1 1 auto` with a 148px floor instead of a hard fixed height, §4/§8).
