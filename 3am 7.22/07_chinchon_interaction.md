# Batch 07 - Chinchón: Interaction & Hand Layout (Screenshot 18)

Two items from Screenshot 18 that were on Matt's list. Both are in `chinchon/` (`chinchon/js/ui.js` builds
the DOM in its constructor). Do NOT break Chinchón's `destroy()` teardown (it holds MP listeners - see
`01_repo_context.md` landmines). Escoba is the exemplar; two of its recent fixes are directly relevant and
are noted per item.

Screenshot: `18_chinch_n_discard_7_coins_sets_button_highlighted.jpg`

---

## CH-1 - Dislike of how the screen looks when "highlight sets" is on - SUBJECTIVE / APPROVAL-GATED

- **Verbatim:** "I don't have a recommendation or suggestion, but i don't like how the screen looks when i click the highlight sets button. idk how to describe it aside from just that I don't like it."

**There is no concrete instruction here** - do not guess at a redesign and ship it. This is approval-gated:
inspect the current highlight-sets rendering, propose 2-3 concrete alternatives (a quick mock/diagram), and
let Matt pick before implementing.

Constraints for whatever you propose:
- **Colorblind safety (THE LAW rule 9):** Matt is red-green colorblind. Set highlighting must not rely on color alone. Use `#ffce3a` for emphasis paired with a non-color cue (grouping, outline, spacing, a set label/badge). If the current look leans on color washes, that is a likely reason it reads badly to him - call that out in your options.
- **No layout shift / fixed geometry (rules 6-7):** toggling highlight-sets on/off must not jump the hand or reflow the screen.
- **No instructional text (rule 5).**
- Mirror how Escoba surfaces set/meld emphasis if it does anything comparable.

**Acceptance (post-approval):**
- [ ] Highlight-sets uses the approved treatment; colorblind-safe (non-color channel present); no layout shift when toggled.

---

## CH-2 - Allow 7 or 8 cards in either hand row

- **Verbatim:** "i don't like how cards i move around after i place them. I should be able to have 7 or 8 cards in either the top or the bottom row if that's what I want to do."

**Intent:** the hand is arranged across a top and bottom row; the user wants freedom to put 7 or 8 cards in
**either** row (currently something constrains/relayouts the split when they rearrange). Find what enforces
the per-row split / reflow on drag-and-place and relax it so either row can hold the full set the user drags
there, persisting their arrangement instead of snapping it back.

**Directly relevant precedent:** Escoba had a bug where 5+ cards wrapped to an invisible third row, since
fixed. Reuse that row-capacity/wrapping handling so a row of 7-8 cards lays out visibly and does not overflow
or clip (respect fixed geometry, rules 6-7). Confirm the max hand size in Chinchón so "7 or 8" is within
range.

**Acceptance:**
- [ ] The user can place 7-8 cards in either the top or bottom row and the arrangement holds (no forced re-split); a full row lays out visibly with no clipping/invisible-row overflow; no layout shift elsewhere.

---

### Batch exit
- [ ] CH-1 treatment approved before build; CH-2 verified. Tests + validator clean.
- [ ] Commit (list constant changes); do not push. Update `CLAUDE.md` if a Chinchón UI rule/constant changed.
