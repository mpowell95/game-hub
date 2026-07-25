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
--un-table:   #171C26;  /* mat field, the dark quiet ground */
--un-bg:      #10141C;  /* page behind the shell */
--un-surface: #1E2531;  /* overlays, chips, sheets */
--un-ink:     #E8ECF3;
--un-muted:   #8B98AC;
--un-border:  rgba(255,255,255,.10);

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
| `.un-opponents` | 44px | fixed whether 1 or 3 opponents |
| `.un-status` | 22px | already has `min-height`, promote to fixed |
| `.un-mat` | 148px | holds a 92px card + 20px pile count + pending badge headroom |
| `.un-handwrap` | 152px | 132px fan region + 20px UNO chip slot, reserved even when empty |
| `.un-bar` | 40px | |

Shell stays `max-width: 480px`, padding `14px`. Usable interior width **A = 452px**.

---

## 5. Layout

**Target viewport, 7 cards (opening hand):**

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
│        ╱ ▲│ ●│ ■│ ◆│ ▲│ ●│ ■ ╲                │ 132 fixed
│       ╱  3│ 5│ +2│ 9│ 0│ ⇄│ 7  ╲               │  arced fan
│      ╰────┴──┴──┴──┴──┴──┴─────╯                │
│                                                │
│   How to play      Restart      New game       │  40
└────────────────────────────────────────────────┘
```

**Worst case, 20 cards (after two stacked +4s):**

```
│         ╭┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬╮                  │
│        ╱▲●■◆▲●■◆▲●■◆▲●■◆▲●■◆╲                  │ 132 same height
│       ╱ 3 5 2 9 0 ⇄ 7 4 1 8 …╲                 │ fan scales to fit
│      ╰──────────────────────────╯               │ NEVER scrolls
```

The fan region height is identical at n=1 and n=30. Only the scale factor changes.

**Fan geometry (the invariant mechanism).** Cards are absolutely positioned inside
`.un-fan`, laid out in *design space* at a constant step, then the whole fan is scaled to fit:

```
W    = 62                       card width
STEP = 26                       constant exposed sliver, design space
c    = (n - 1) / 2              center index
x_i  = (i - c) * STEP           horizontal offset from center
rot_i= (i - c) * min(2.4, 26/(n-1))   degrees, total arc capped at ~26°
y_i  = (i - c)² * 0.55          px downward, capped at 14 — makes the arc
z_i  = i                        later cards paint on top

need = STEP * (n - 1) + W
fit  = min(1, (A - 24) / need)      A = 452, 24 = edge breathing room
```

`.un-fan` gets `transform: scale(fit)`, `transform-origin: 50% 100%`.
Each card gets `transform: translateX(x_i) translateY(y_i) rotate(rot_i)` with
`transform-origin: 50% 150%` so rotation swings from a point below the hand, like a held fan.

At n=7: need=218, fit=1, cards at full 62px.
At n=14: need=400, fit=1, still full size.
At n=20: need=556, fit=0.77, cards render ~48px with ~20px slivers.
At n=30: need=816, fit=0.52, cards ~32px. Small, but every card is visible and it never scrolls.

**Why the top-left corner mark matters more than it used to:** with overlap, the only part of a
buried card the player sees is its left sliver. The corner mark is the entire read. It goes to
13px, shape above value, inside the exposed 26px column. The bottom-right corner mark is
**removed** — it is never visible in a fan and only steals face area.

**Fan direction (decided).** Cards read **left to right**, and a newly drawn card arrives at the
**left end**. Paint order stays positional (`z = index`), so each card's exposed strip is its left
edge and the top-left corner mark is always the visible read. A newly arrived card is therefore at
the bottom of the stack, so it gets a brief edge highlight on arrival (motion #6a) rather than
relying on stacking to be noticed.

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
| 7 | Turn becomes yours | legal cards lift 4px, 30ms stagger left→right | 180ms | `cubic-bezier(.4,0,.2,1)` | which cards are playable, without copy |
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
| **Entire hand visible, any n, never scrolls** | `overflow-x: auto` deleted from `.un-hand`. Fan is absolutely positioned with `overflow: visible` and a computed `scale(fit)` where `fit = min(1, 428/need)`. `fit` is mathematically ≤1 for all n, so the fan cannot exceed its box. There is no scroll container left in the hand subtree. |
| **Zero vertical layout shift** | Every region in §4 has a fixed height set from first paint, including the UNO chip slot (reserved at 20px whether or not the chip is present) and the pending badge (absolutely positioned inside the mat's reserved 148px). Card count changes alter only `transform`, which does not affect layout. |
| **Colorblind safety** | Two independent shape channels per card: the 46px medallion and the 13px corner mark, both driven by the same `COLOR_META[color].shape`. No state is signalled by hue alone. Color chooser keeps shape+hue chips. Playable state uses lift + shadow, not tint. |
| **No instructional copy in gameplay UI** | Motion #7 (legal cards lift) and #12 (opponent chip pulse) carry the information that helper sentences would otherwise carry. No new strings are added to `strings.js`. |
| **System fonts, no external assets** | All shapes are inline SVG generated by the existing `shapeSVG()`. Medallion, gloss, and rim are CSS gradients and filters. Zero new files, so `sw.js` `ASSETS` is unchanged. |
| **Scoped CSS** | Every new rule is `.un-` prefixed and descendant-scoped under `.un-root`, per the "Adding a game" checklist item 3. |
| **Minimum tap target** | Constant 26px design-space sliver × 92px height. At `fit < 1` the sliver scales with the card, so the exposed proportion never degrades. The topmost card and the pressed card receive full card area via `z-index`. |
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
