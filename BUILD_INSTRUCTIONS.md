# BUILD INSTRUCTIONS — Yahtzee clone

Start here. Read this file, then read `YAHTZEE_CLONE_SPEC.md` end to end, before writing
any code.

## Files

| File | Role |
|---|---|
| `YAHTZEE_CLONE_SPEC.md` | The pixel-level specification. Authoritative. |
| `yahtzee_ref_409x729.png` | Pre-cropped diff target, 409 × 729, no margin. |
| `yahtzee.png` | Uncropped original, 456 × 761. Use only to zoom into artwork detail. |

Do not re-crop anything. The crop has already been verified to have zero margin pixels on
all four edges.

## Ground rules

This is a reproduction task, not a design task. You have **zero design latitude**. Do not
improve, modernise, or clean up anything. Do not substitute a "better" palette, layout, or
component. If the spec and the reference image disagree, stop and ask.

**Deliverable:** a single self-contained `index.html` — vanilla HTML/CSS/JS, no build step,
no framework, no npm, no external images, no emoji, no icon fonts. It must run by
double-clicking the file.

Throughout:

- Do not claim a visual match you have not measured.
- Do not refactor into multiple files, and do not substitute a `<canvas>` renderer for the
  scorecard — DOM + CSS only, so the diff stays inspectable.
- If something in the spec is impossible or self-contradictory, say so instead of silently
  choosing an alternative.
- Stop at the end of each phase and show me the result before moving on.

---

## Phase 0 — Tooling

Install Playwright (or an equivalent headless screenshot tool) and prove you can:

1. Capture the page at exactly 410 × 730.
2. Produce a numeric pixel diff against a reference image.

Do this **first**. You must be able to see your own output; do not proceed on assumption.

### Diff methodology — read carefully

The stage is 410 × 730 and the reference is 409 × 729. Compare the reference against the
**top-left 409 × 729** of your screenshot. Do **not** rescale either image to force a
match — resampling will blur every edge and destroy the diff.

The reference was resampled at some point in its life, so its edges are soft. A strict
per-pixel diff will never approach zero, and chasing it will send you in circles. Instead:

- Gaussian-blur both images by ~1.5 px before differencing.
- Use a per-channel tolerance of about 30.
- Judge by **structural alignment** — edges landing on the same coordinates, bands the
  same colour — not by absolute pixel identity.
- Report the diff as a heatmap plus a named list of misaligned regions, not as a single
  percentage.

---

## Phase 1 — Static frame

Build the frozen reference state from spec §11 (`DEBUG_REFERENCE = true`): header, rules,
blue playfield, scorecard with all 13 categories and the exact score values given, dice
showing **5, 6, 3, 6, 6**, roll pips 1 and 2 lit, PLAY disabled. No interactivity yet.

Then run the diff loop: screenshot, blur, overlay, measure, fix. Iterate until structural
error is gone. Anti-aliasing and font-rendering deltas are acceptable; wrong coordinates,
wrong sizes, wrong radii and wrong colours are not.

Report the remaining deltas honestly and name the regions still off.

---

## Phase 2 — Game logic

Implement the full rules from spec §9: all 13 categories, upper bonus at 63, Yahtzee bonus
+100, the joker rule, 3-roll turns, hold/unhold, ghost previews, select-then-PLAY commit,
turn passing, the greedy AI opponent, and the game-over screen.

**Critical:** the scorecard is a **shared two-player card**. The cream box holds Player 1's
committed score; the bare brown numeral to its right holds Player 2's committed score for
that same category. It is *not* a score-preview column. Verification: Player 1's box values
(8 + 15 + 14 + 28 + 40) sum to 105 and Player 2's numerals (4 + 12 + 10 + 18 + 0 + 23) sum
to 67 — exactly the two header totals. Getting this wrong invalidates the whole build.

Play a complete 13-round game headlessly and assert every scoring path. Show me the test
output.

---

## Phase 3 — Animation

Implement spec §10 exactly:

- Real CSS 3D cube dice with the staggered tumble, launch/drop/squash phases.
- The score-commit bounce and header count-up ticker.
- The `YAHTZEE!!` set piece: rays, gradient text with stroke, 70-piece confetti, stage shake.
- The micro-interactions in §10.4.
- `prefers-reduced-motion: reduce` respected by shortening durations, not by removing the
  animations.

Capture several mid-animation frames so I can see the tumble and the celebration.

---

## Definition of done

- Phase 1 diff shows no structural misalignment, with remaining deltas named.
- A full 13-round game plays correctly end to end: every category scores right, the upper
  bonus fires at 63, the Yahtzee celebration fires, a bonus Yahtzee awards +100, the joker
  rule works, ROLL locks after 3 rolls, PLAY stays disabled until a category is selected,
  and the game-over screen names the correct winner.
- `DEBUG_REFERENCE = false` and the game is playable from a cold load.
