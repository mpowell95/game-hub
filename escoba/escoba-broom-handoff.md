# Escoba Broom Sweep Animation: Handoff for Claude Code

## What this adds

A cartoon broom sweeps across the felt whenever anyone scores an escoba (including the dealer's initial-table escoba). Attached asset: `broom-sprite.webp`, a 10-frame horizontal spritesheet, 480x360 per frame (4800x360 total, ~116KB), transparent background, WebP with alpha. The broom's left-to-right traversal is baked into the frames, so playing the frames in place produces the full sweep; no positional tweening of the overlay is required.

Also attached: `broom-anim.webp`, a looping animated WebP of the same frames. It is a PREVIEW for the user only. Do not ship it; the game uses the spritesheet so playback can be triggered exactly once per escoba via CSS.

## Placement in the repo

Put the sheet at `escoba/img/broom-sprite.webp` (or wherever the module keeps the deck art; match the existing convention).

## Integration spec

All existing rules from the polish pass still apply: zero layout shift, no instructional text, `#ffce3a` untouched, no em dashes in strings.

1. Overlay element. Add a `.eb-broom` div absolutely positioned inside `.eb-mat` (the mat is `position: relative` already), `inset: 0`, `pointer-events: none`, z-index above the table cards but below the fixed overlays (ESCOBA banner, modals). Because it is absolute inside the fixed-height mat it causes zero reflow.

2. Sprite playback via CSS steps. Background-image the sheet, `background-size: 1000% 100%`, and animate `background-position` from `0 0` to `-900% 0` (or equivalently 0% to 100% with the right sizing) using `steps(9)` for a 10-frame sheet played once, `animation-fill-mode: forwards`. Duration ~0.9s to 1.0s feels right at 10 frames. The sprite frame is 4:3 while the mat is wider and shorter; anchor the sprite to the bottom of the mat and size by height (the broom occupies the lower band of each frame, upper area is empty) so the broom head sweeps through the card zone. Verify at 390px width that the broom head visually crosses the card rows, not above or below them.

3. Trigger points in `ui.js`:
   - `play` event with `payload.escoba === true`
   - `initialEscoba` event
   Sequence per escoba: start the broom sweep, and while it runs give the captured cards their fly-out. Then the existing ESCOBA banner pops. Suggested timing: broom starts at t=0, cards start flying at ~t=150ms, banner pops around t=400-500ms overlapping the tail of the sweep. Tune what feels good; total added delay to the game beat should stay under ~1s so the pacing does not drag.
   - Remove the overlay element (or clear its animation class) when done so a later escoba can replay it cleanly. Use the `animationend` event or a timer consistent with the existing beat helpers.

4. Directional card fly-out (nice touch, do it). On an escoba specifically, replace the generic `is-taken` exit with an escoba variant class where cards fly off to the RIGHT with slight rotation and fade, matching the broom's left-to-right sweep, as if swept away. Non-escoba captures keep the current exit.

5. Preload. Load the sheet once at game start (extend the existing deck preload) so the first escoba does not flash while the image fetches.

6. Reduced motion. Under `prefers-reduced-motion: reduce`, skip the broom entirely (consistent with confetti) and use the non-animated capture exit.

7. Service worker. Add the new asset to the cache manifest and bump the SW version, same as the last deploy.

## Verification

See the single lean verification pass at the end of this document. Do not build auto-drivers or run a full test matrix for this session.

---

# Round 2 UI Fixes (from the second playthrough)

Do these in the same session as the broom work. Screenshots attached: one shows the clipped/overlapping highlight states mid-capture, the other shows the misaligned scoring popup. All prior rules still apply (zero layout shift, no instructional text, #ffce3a attention color, colorblind-safe never-hue-alone, no em dashes).

## A. Highlight states clip and collide (bug, fix first)

The fixed-height mat solved the shifting but introduced clipping. Observed at 390px:

- Selected/hinted table cards in the top row are cut off by the top edge of the mat (their lift transform + ring extends past the container).
- Two adjacent highlighted cards overlap each other's outlines. Cause: the hinted dashed outline sits at `inset: -7px` (7px outside the card) while the table gap is 8px, so neighboring adornments collide.
- A selected hand card (lifted -10px) covers the player name pill above the hand.
- The value badge on the bottom-right corner of every card in the lower table row is clipped by the mat's bottom/right edges (badges overhang the card by ~5px).

Fix as a system, not per-symptom. Define the max adornment overhang once (lift distance + ring width + badge overhang) as a CSS variable, then:

1. Give the card zones internal padding at least equal to that overhang on every side where adornments extend. Do not solve it with `overflow: hidden`; if the mat clips for its rounded corners, clip only the felt background layer, never the card layer.
2. Shrink the adornments so they cannot collide: pull the hinted dashed outline inside or just at the card edge (inset 0 to -2px max) instead of floating 7px outside. Then the existing gap is sufficient. Keep ring + lift as the selected state.
3. Reserve headroom between the self pill row and the hand equal to the hand-card lift so a selected card never touches the pill. This space is part of the design (see D below), not waste.

Acceptance: select a hand card while every table card is hinted, at 390px, in both table rows: nothing clips, nothing overlaps, badges fully visible.

## B. Scoring popup: one aligned grid

Current popup has the category table and the points/totals box as separate structures with different column widths, so numbers do not line up under the player headers and it reads poorly.

Rebuild the sheet as ONE shared column grid (category label column + one column per player) that every row uses:

- Category rows (Escobas, Cards, Coin cards, 7 de Oros, Sevens) as today, with the sole-leader tint+bold cells.
- `Round N points` becomes the final row of the SAME table, visually emphasized (heavier top rule, bold `+X` values) so it clearly totals the rows above it.
- `Total score` sits below, outside the table body as its own distinct band (tinted background), but built on the identical grid template so each total lands exactly under its player column.
- Numbers centered consistently in their columns, tabular-nums throughout.

Acceptance: every number on the sheet sits in a straight vertical line under its player header, including the two summary rows.

## C. Top bar redesign (clarity over compression)

The compact bar is the right direction but currently cryptic. Specific complaints: the match score is tiny and hidden; the three card-back rectangles read as meaningless shapes; `R1 · 21` plus `Last` is crammed and undecipherable (the user never figured out what `Last` meant).

- Match points are the most important number on screen. Make them the visual anchor of each player area: large and bold, clearly labeled `pts`, not a small muted suffix.
- Opponent hand count: either drop it (it is marginal information) or make it unmistakably cards: small overlapping card-back miniatures with proper card proportions and a count numeral, sized so they read as cards at a glance. Same treatment for the captured-pile chip if kept.
- Round and target chips get real words: `Round 1` and `First to 21`. There is room once the bar stops abbreviating.
- `Last` means the final deal of the round is in play. Rename to `Last hand` and move it out of the crammed corner: surface it in the reserved announce row (or as an overlay chip on the mat) when the final deal starts, styled with `#ffce3a` plus an icon or bold text so it is not color-alone. It should feel like a game state change, not a mystery pill.

## D. Selection sum where the player is looking, and block invalid picks

The running capture sum currently lives only in the Capture button at the bottom, which repeats the earlier mistake of putting feedback far from where the player is looking.

- Show the running sum as a chip anchored to the mat (absolutely positioned, zero reflow), bottom-center of the felt or adjacent to the selected hand card: `7 / 15`, tabular-nums, visible only while a capture-capable card is selected. The Capture button then just reads `Capture`, disabled until the sum is exactly 15.
- Block over-selection: tapping a table card that would push the running sum above 15 is rejected (brief shake or dim pulse as feedback, no text). Values are all positive, so a pick that exceeds 15 can never become part of the current valid combo without deselection; the UI should not allow it.
- Bonus polish: while a partial selection is active, dim table cards whose value exceeds the remaining amount (opacity + no lift affordance, not color alone), so what is pickable is obvious.

## E. Space philosophy: distribute, don't minimize

Direct feedback, follow it as the governing principle for this pass: "instead of approaching it with the mentality of 'I need to minimize excess space,' approach it as 'I have X amount of space to use. How do I best use all the space and distribute it evenly so it looks as good as possible and is easy to use and understand at a glance.'"

Concretely: after the compaction pass there is now a dead strip (~1 inch) at the bottom of the screen that is never used. Fix by designing to the viewport:

- Treat available height as `100dvh` minus hub chrome and safe-area insets, and distribute it deliberately across top bar, announce row, mat, self row, hand, and actions so nothing is left over. The mat and hand get the lion's share; the headroom reserved for lift states (Task A) counts as designed space.
- Scale card sizes up until the budget is consumed at iPhone widths. Bigger cards beat empty margin every time.
- Acceptance: at a modern iPhone viewport, the game fills the screen with even, intentional spacing, no scrolling, and no dead band at the bottom; on taller screens the extra height goes into the mat and cards, not into a gap.

## Verification: single lean pass (replaces all prior verification requirements)

Keep this session fast. One manual browser session at 390px, no auto-drivers, no full-match scripting, no test matrix:

- Start a game and play a few turns by hand. While selecting a capture with a two-row table: nothing clips, adjacent highlights do not overlap, the selected hand card clears the name pill, value badges fully visible, sum chip shows on the felt, an over-15 pick is rejected.
- Force one escoba (temporarily rig the deal order in code if needed, then revert): broom sweeps once, cards fly right, banner reads, nothing shifts.
- Open the round popup once: columns aligned under player headers, summary rows on the same grid.
- Eyeball the viewport fill: no dead band at the bottom.
- Re-run the existing engine smoke test file as-is (it is cheap) since the engine is untouched this session; skip if any of it needs modification to run.

Skip entirely this session: 3-player and deck-mode matrix, resume re-testing, reduced-motion pass, Lighthouse, and deploy polling. Bump the SW version, push, and stop; the user will verify on his phone. Flag anything you consciously did not verify in your summary.
