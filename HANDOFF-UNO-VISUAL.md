# HANDOFF — Uno visual rebuild (card face, fan hand, motion system)

**Read `UNO-DESIGN-SPEC.md` first. It is the contract.** This document says where to put things;
the spec says what they are. Where they disagree, the spec wins.

**Scope:** `uno/css/uno.css`, `uno/js/ui.js`, `uno/CLAUDE.md`. Nothing else.
**Zero new files** → `sw.js` `ASSETS` is unchanged. `uno/js/strings.js` gains exactly three keys
(the sort control's aria-labels, UN-6), in **both** EN and ES, routed through `t()` per the "Adding
a game" checklist item 9 — no other new strings. No engine, AI, or rules changes: `js/game.js`,
`js/ai.js`, `js/test.js` are untouched.

**Standing constraints (root CLAUDE.md):** all CSS `.un-` prefixed and descendant-scoped under
`.un-root`; system fonts only; no external assets; no em dashes in user-facing copy; colorblind
pairing is contractual; zero vertical layout shift. **Do not rename any existing identifier** —
`cardHTML`, `COLOR_META`, `shapeSVG`, `colorGlyphHTML`, `cardFaceGlyph`, `cardAriaLabel`, and all
`data-action` values keep their current names and signatures.

---

## UN-1 — Token block — TIER 1

Replace the `.un-root` custom property block (currently `uno.css` lines 4–20) with the full token
set from spec §2, §3, §4. Keep the four card hues and `--un-accent` bytewise identical.

Then **delete every hard-coded color, radius, shadow, duration, and font-size elsewhere in the
file** and point them at tokens. Current file has ~14 improvised `rgba()` shadows and 9 literal
`border-radius` values; after this task there must be zero literal colors or shadows below the
token block. Grep gate: `grep -nE "rgba?\(|#[0-9a-fA-F]{3,6}" uno/css/uno.css` returns hits only
inside the `:root`/`.un-root`/dark-mode token blocks.

**Acceptance:** game renders unchanged in shape but on tokens; no literal colors outside token
blocks; dark and light both correct.

---

## UN-2 — Card face rebuild — TIER 1

Per spec §7 and §3. Modify `cardHTML()` in `ui.js` (keep the signature) and the `.un-card` rules.

Structure of a colored card, outermost in:

1. `.un-card` — `62×92`, `border-radius: var(--un-r-card)`, background is the hue,
   `box-shadow: var(--un-sh-rest)`, `transform-style: preserve-3d`.
2. **Rim** — a `3px` inset white border drawn as `box-shadow: inset 0 0 0 var(--un-card-rim-w) var(--un-card-rim)`,
   plus `inset 0 0 0 calc(var(--un-card-rim-w) + 1px) var(--un-card-edge)` for the hairline.
   Do not use a real `border` — it would fight the existing box model.
3. **Gloss** — `::before`, `inset: var(--un-card-rim-w)`, `border-radius: 6px`,
   `background: linear-gradient(145deg, var(--un-gloss-hi) 0%, transparent 42%, var(--un-gloss-lo) 100%)`,
   `pointer-events: none`.
4. **Medallion** — new inline SVG from the existing `shapeSVG()`, sized per spec §7, class
   `.un-medallion`, `aria-hidden="true"`. Reuse `COLOR_META[card.color].shape`. Do **not** write a
   second shape function.
5. **Numeral** — `.un-glyph-big`, `z-index: 1`, spec §3 treatment including
   `-webkit-text-stroke` + `paint-order: stroke fill`.
6. **Corner** — keep `.un-corner-tl` only, at `--un-t-corner`, shape above value.
   **Delete `.un-corner-br` and its CSS rule** (never visible in a fan; see spec §5).

**Wild cards:** replace `.un-wildquad` with a quartered medallion showing all four shapes per spec
§7. Wilds get no rim hue; background stays `--un-wild`.

**Small cards** (`.un-card-sm`, used by the how-to diagram's `foreignObject`): medallion at 36px,
numeral hidden, corner hidden. Verify the how-to diagram still renders inside its SVG.

**Acceptance:**
- [ ] Every colored card shows a debossed medallion matching its corner shape.
- [ ] Numeral is legible on all four hues at 62px and at `fit=0.52`.
- [ ] `aria-label` output from `cardAriaLabel()` is byte-identical to before.
- [ ] How-to diagram unchanged in function.

---

## UN-3 — Fan hand — TIER 1 — **this is the primary fix**

Per spec §5. `overflow-x: auto` on `.un-hand` is the defect; deleting it is not sufficient on its
own, the fan replaces it.

**3a — layout math.** Add a pure function to `ui.js`:

```js
/** Fan geometry, spec §5. Pure: n -> per-card transforms + container fit scale. */
function fanLayout(n, { W = 62, STEP = 26, A = 428 } = {}) { … }
```

Returns `{ fit, cards: [{ x, y, rot, z }] }` using exactly the formulas in spec §5. Constants live
in one place; do not scatter magic numbers into the template string.

**3b — render.** `.un-hand` becomes:

```html
<div class="un-hand">              <!-- fixed 132px, overflow: visible, perspective: 1200px -->
  <div class="un-fan" style="--fit:…">   <!-- transform: scale(var(--fit)); origin 50% 100% -->
    <button class="un-card" style="--x:…;--y:…;--rot:…;--z:…" …>
```

`.un-card` inside `.un-fan` is `position: absolute; left: 50%;` with
`transform: translateX(calc(-50% + var(--x))) translateY(var(--y)) rotate(var(--rot));`
`transform-origin: 50% 150%; z-index: var(--z);`

Delete `overflow-x`, `-webkit-overflow-scrolling`, and the flex/gap rules from `.un-hand`.

**3c — DOM persistence (load-bearing, read carefully).**
`ui.js` currently rebuilds the whole screen as an HTML string each render, which destroys and
recreates the card nodes. **CSS transitions cannot animate across that**, so motion #2, #7, and
#11 in spec §6 will silently do nothing if the fan is rebuilt.

The fan subtree must therefore survive re-render. Implement `_syncFan(hand, legalIds)`:
- On first game render, build `.un-fan` and its cards once.
- On every subsequent render, reconcile by `data-id`: update `--x/--y/--rot/--z` and the
  `is-live`/`disabled`/`aria-label` state on surviving nodes, append nodes for new cards, and
  remove nodes for cards no longer in hand (after their play animation resolves, UN-4 #3).
- The rest of the screen may keep rebuilding as it does today. Only the fan is exempt.

Keep this contained: `_syncFan` is the only place that mutates card DOM outside the render string.
Document the exemption in `uno/CLAUDE.md` — a future session will otherwise "fix" it back.

**Acceptance:**
- [ ] No scroll container anywhere in the hand subtree. `overflow-x` does not appear in `uno.css`.
- [ ] Every card visible without scrolling at n = 1, 7, 14, 20, 30.
- [ ] `.un-hand` computed height is identical at all of those n.
- [ ] Card nodes persist across renders: play a card, confirm surviving siblings animate to their
      new positions rather than jumping.
- [ ] Tapping any visible sliver plays that card; the card under the tap point is the one played.

---

## UN-4 — Motion system — TIER 2

Implement spec §6 in order 2, 11, 7, 3, 4, 6, 10, 8, 1, 5, 9, 12 — that order gets the hand
feeling right before the flourishes, and each step is independently verifiable.

Rules:
- Every duration and easing comes from spec §6 verbatim. Define them as tokens
  (`--un-dur-relayout: 260ms`, `--un-ease-relayout: cubic-bezier(.32,.72,.32,1)`, etc.).
  No inline literals.
- Animate `transform`, `opacity`, and `box-shadow` only. Never animate width, height, top, or left.
- `perspective: 1200px` on `.un-mat` and `.un-hand`; `preserve-3d` on `.un-card`. That is the
  entire 3D system. **Do not add a canvas, WebGL, a physics library, or any dependency.**
- Flight animations (#3, #6, #12) need source and destination rects. Use
  `getBoundingClientRect()` on the existing pile and card nodes and animate a cloned node in a
  fixed-position layer, then remove the clone on `animationend`. Do not reparent live card nodes.

**`prefers-reduced-motion`** is not an afterthought: add the media block in the same task, per
spec §6. A build that ships motion without the reduced-motion block is not done.

**Acceptance:**
- [ ] Every row of spec §6 is implemented or explicitly reported as skipped with a reason.
- [ ] `@media (prefers-reduced-motion: reduce)` present; with it forced on, the game is fully
      playable and legible and nothing moves except the two permitted opacity fades.
- [ ] No animation blocks input: cards remain tappable throughout, and a fast tap sequence
      (play, play, play) does not desync the fan from engine state.
- [ ] No `width`/`height`/`top`/`left` in any transition or keyframe.

---

## UN-5 — Fixed geometry — TIER 2

Apply the reserved heights in spec §4 to `.un-opponents`, `.un-status`, `.un-mat`, `.un-handwrap`,
`.un-bar`. The UNO chip slot is reserved at 20px whether or not the chip renders (today it is
conditional markup and shifts the fan down when it appears). `.un-pendingbadge` and `.un-toast`
stay absolutely positioned inside already-reserved boxes.

**Acceptance:**
- [ ] Record a full match; no vertical shift at any point, including the UNO chip appearing, the
      pending badge appearing, the toast firing, and 2 → 3 → 4 opponent chips.

---

## UN-6 — Hand sort toggle — TIER 2

Per spec §5 "Hand sort". Three modes cycled by one control: `draw` → `color` → `rank` → `draw`.

**Correctness constraint, non-negotiable.** Sorting is applied to a **copy** of
`g.players[HUMAN].hand` at render time. The engine's hand array is never reordered. Nothing about
sort order may reach `play()`, the action log, the state hash, or any persisted game state — this
game is a candidate for the lockstep MP path, and a display order that leaked into the move log
would desync peers. Implement as:

```js
/** Display order only. Never mutates engine state. spec §5. */
function sortedHand(hand, mode) { … }   // returns a new array
```

`_syncFan()` consumes `sortedHand(...)`; every `data-id` and every `play()` call still uses the
card's real id, so reordering is invisible to the engine by construction.

**Control:** 28×28 icon button at the right end of the reserved UNO-chip row, `data-action="sort-hand"`.
Icon is inline SVG in the `dirArrowSVG` house style (`currentColor`, `aria-hidden`), showing the
*current* mode. No text label, no helper copy, no tooltip.

**Strings:** three new keys in `strings.js`, EN and ES, phrased as the mode being switched **to**
(e.g. `sort_to_color`). No em dashes.

**Persistence:** `handSort` in the existing `gamehub.uno.v1` settings object, via the existing
`loadSettings`/save path. Unknown or missing value falls back to `draw`. **Do not add a new
localStorage key** (THE LAW rule 5).

**Motion:** toggling runs spec §6 #13, which is just #2 at full width — if UN-3c and UN-4 #2 are
correct this needs no new animation code, and that is the acceptance test for whether the fan
reconciliation actually works.

**Acceptance:**
- [ ] Cycles `draw` → `color` → `rank` → `draw`; icon reflects the current mode.
- [ ] Setting survives reload and a new game.
- [ ] Cards **slide** to new positions on toggle; they do not jump or rebuild.
- [ ] `color` mode groups hues in the spec's order with wilds last; `rank` mode orders 0-9 then
      actions with a stable hue tiebreak.
- [ ] Tapping a card after sorting plays the card you tapped.
- [ ] Engine hand order is provably unchanged after any number of toggles (log or assert it once
      during development, then remove the log).
- [ ] `node test-mp-lockstep.mjs` and `node run-all-tests.mjs` still clean.

---

## Exit checklist

- [ ] UN-1 through UN-6 complete, or any deferral named explicitly with a reason.
- [ ] Mat and card tokens are theme-invariant: toggling dark/light changes chrome only, and the
      play surface is identical in both.
- [ ] Sort verified presentation-only: engine hand order unchanged, no new localStorage key.
- [ ] `node run-all-tests.mjs` clean.
- [ ] `node validate-sw-assets.mjs` clean (no new files expected; confirm anyway).
- [ ] `uno/js/test.js` still passes untouched — if it needed edits, the rules changed and that is
      out of scope, stop and report.
- [ ] Manual pass at n = 1, 7, 14, 20, 30 in both dark and light, portrait.
- [ ] No identifier renamed. No new strings. No new files.
- [ ] `uno/CLAUDE.md` updated: the token system, the fan formula and its constants, and the
      `_syncFan` render exemption with the reason it exists (THE LAW rule 9).
- [ ] Commit with UN-task IDs in the message. **Do not push.**

## Report back

For each task: done / partial / skipped, plus any place where the spec was unimplementable as
written and what you did instead. Flag anything in spec §6 that fought the render architecture —
that feedback determines whether the fan exemption in UN-3c needs to generalize to other games
before the shared token layer session.
