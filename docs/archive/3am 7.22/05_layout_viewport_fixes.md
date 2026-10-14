# Batch 05 - Layout / Viewport Fixes

Two games render taller than the screen, forcing a small vertical scroll on mobile. Same class of fix in
both: fit within the viewport at phone widths. **Mirror Escoba's approach** - its recent pass did exactly
this ("space-utilization overhaul," fixed geometry, no layout shift, viewport-as-budget). Apply THE LAW
rules 6, 7 (fixed geometry, distribute the space budget). Any sizing thresholds you introduce are named
constants, not magic numbers. Verify at ~390-430px width (or the 900x1956 device); this does not reproduce
on desktop. Visual QA is a separate Chrome pass - keep your own verification light.

---

## LAYOUT-1 - Nuts & Bolts is slightly too tall

- **Screenshots:** `03_nuts_bolts_...jpg`, `04_nuts_bolts_...jpg`
- **Verbatim:** "the nuts & bolts screen is still a little too big for the screen. You have to scroll a little bit"
- **Location:** `nuts-bolts/` (confirm slug per `01_repo_context.md`).

"Still" implies a prior partial fix - build on it, do not fight it. Find what overflows (board plus
header/controls exceeding the viewport) and constrain the playfield to the available height after
header/controls, the way Escoba does. Prefer `dvh`/`svh` and a fit-to-height board size over a fixed pixel
value. Both shown states (fresh "EXTRA HARD - Level 1" start and mid-game) must fit.

**Acceptance:**
- [ ] Both Nuts & Bolts states fit at phone width with no vertical scroll; board and controls (UNDO/HELP, counters) stay visible and tappable.
- [ ] No desktop regression; no new layout shift.

---

## LAYOUT-2 - Chinchón is slightly too tall, with wasted space at the top

- **Screenshots:** `16_chinch_n_...jpg`, `17_chinch_n_...jpg` (same screen, two scroll positions)
- **Verbatim:** "Chinchon screen is a little too big for the screen. You have to scroll a little bit. even though there's plenty of space that's watsed at the top"
- **Location:** `chinchon/js/ui.js` (builds DOM in its constructor). Do NOT break Chinchón's `destroy()` teardown (it holds MP listeners - see landmines in `01_repo_context.md`); this is a pure layout change.

Matt names the cause: **wasted space at the top.** Per THE LAW rule 7, redistribute that budget rather than
only shrinking the board. Tighten the top (header/margins/reserved rows), then, if still needed, apply the
same fit-to-height constraint as LAYOUT-1.

**Acceptance:**
- [ ] Chinchón fits at phone width with no vertical scroll; top space reduced so content sits higher and looks intentional.
- [ ] Hand, opponent scores (Lucía/Diego), round indicator, and action buttons stay visible/usable; no desktop regression; no layout shift.

---

### Batch exit
- [ ] Both verified at phone width. `node validate-sw-assets.mjs` + `node run-all-tests.mjs` clean.
- [ ] Commit (list any new constants old->new); do not push. Update `CLAUDE.md` if a documented layout rule/constant changed.
