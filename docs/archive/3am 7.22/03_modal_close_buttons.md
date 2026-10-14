# Batch 03 - End-of-Game Modal Close Buttons

Two end-of-game popups trap the user (only a primary action dismisses them). Add a small **X** to each.
**Escoba already implemented exactly this** ("an X button to close the end-of-match popup") - copy that
pattern and the shared modal/scrim idiom rather than inventing one. Follow the CSS scoping convention in
`CLAUDE.md`. Keep it terse - no added helper text (THE LAW rule 5).

---

## MODAL-1 - Filler end-game modal needs an X

- **Screenshot:** `12_filler_computer_wins_...jpg` (X location annotated)
- **Verbatim:** "After a game of filler, this popup appears. It needs a small X to close it. it should have the same effect as clicking view board"
- **Location:** `filler/`.

The X must reuse the existing **"View Board"** handler (same result - dismiss to the finished board). Do not
invent a different dismiss behavior.

**Acceptance:**
- [ ] Filler end-game modal shows a small X (per annotation) that does exactly what "View Board" does.
- [ ] X is tap/keyboard accessible, overlaps nothing.

---

## MODAL-2 - Chinchón end-game modal needs an X

- **Screenshots:** `19_chinch_n_...jpg`, `20_chinch_n_...jpg` (two variants: "Betty is not impressed" text, and a score line-graph version - both need the X)
- **Verbatim:** "After a game of Chinchon, this popup appears. It needs a small X to close it. there's no way to get out of this screen without clicking New Game, which isn't always what you want."
- **Location:** `chinchon/` (do not break `destroy()`).

The point is a way out that is not "New Game." Send the X to the same destination Escoba's X uses (match the
exemplar); if there is no finished-board view to return to, returning to the hub is acceptable - **state which
you chose.** New Game must still work.

**Acceptance:**
- [ ] Both Chinchón end-game variants show a small X that dismisses without starting a new game (state the destination).
- [ ] New Game unchanged.

---

## One check before you finish
- [ ] Confirm whether these popups (and other games' end-game modals, e.g. Monopoly Deal's "Computer wins") share a component. If shared, add the X once and verify every consumer. **Ask Matt** whether to apply the X to all end-of-game modals hub-wide, or only the two here.

### Batch exit
- [ ] Verified on Filler + Chinchón. Tests/validator clean. Commit, do not push. Update `CLAUDE.md` if the shared modal contract changed.
