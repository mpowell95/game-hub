# Batch 10 - Designed Follow-up Fixes (Opus -> Sonnet)

Closes the open items from your execution wrap-up. The design decisions here are made - implement them
against the real code; do not re-open the choices. Where I could not see the code, the spec is behavioural
(what to build + acceptance) and you fill in the implementation.

**All prior house rules still apply** (THE LAW in `00`/`CLAUDE.md`): no em dashes in any file; commit but do
NOT push; copy Escoba not Connect Four; colorblind rule (`#ffce3a` + a non-color indicator, Matt is red-green
colorblind); never rename Monopoly Deal's frozen ids; add new/renamed files to `sw.js` ASSETS (+ nested
`business-deal-hub` SW for `business-deal/` files) and bump cache versions; run `node run-all-tests.mjs` +
`node validate-sw-assets.mjs` before finishing; update `CLAUDE.md` for anything you land.

Order: A, B (quick, ship now) -> C (solver) -> D (Chinchón look) -> E (CF overhaul, folds in C).

---

## A. Roll the end-game close-X out hub-wide (DECISION: yes, do it)

Batch 03 added the X-to-close to Filler and Chinchón and left the "roll it everywhere?" question open. Decision:
roll it out. Audit every game's end-of-game modal (win/lose/draw). For each one lacking a close-X, add the
**same shared Escoba X pattern** used in batch 03. Known target: Monopoly Deal's "Computer wins". Check the
rest (Connect Four, Ball Run, Nuts & Bolts, Mancala, Escoba, Filler already done, Chinchón already done).

- Dismiss behaviour = that game's existing primary non-destructive exit (its "view board" / return-to-board;
  if none exists, return to hub). Reuse the existing handler; do not invent new behaviour.
- If a game routes end-game through the shared modal component, fix once and confirm all consumers.

**Acceptance:** every end-of-game modal in the hub has a working close-X with sane dismiss; New Game / primary
actions unchanged. List which modals you touched.

---

## B. Write up the `01_repo_context.md` five confirmations (DECISION: emit the checklist)

You answered these implicitly while working. Emit them as an explicit checklist with your findings, into the
repo's working notes, and reflect anything structural in `CLAUDE.md`: (1) Nuts & Bolts folder slug; (2) Filler
AI + board-gen locations; (3) Connect Four evaluator / undo / eval-render locations; (4) difficulty plumbing;
(5) Monopoly Deal Wild-card + rent/JSN flow. One line of "found: <path/answer>" each.

---

## C. C4-4 - fix the evaluation, and stop the panel from lying (DECISION: build a real solver)

Your diagnosis: the estimate-mode heuristic is too shallow to see Connect Four's first-player forced win early
game, so it reports losing evals; meanwhile the panel labels its output "Solved" (per screenshot 14: "Solved .
+ wins, - loses . best ringed"). Two problems: a weak evaluator, and a **false "Solved" claim**. Connect Four
is a solved game, so build the real thing.

**C-1 (immediate safety, ship even if C-2 slips):** the panel must never display "Solved" or a definitive
win/loss verdict unless the value is exact. While it is a heuristic/depth-capped guess, label it plainly (e.g.
"Estimate") with no verdict styling. This alone removes the "it says I lose but I do not" trust break.

**C-2 (the real fix): a proper Connect Four solver.**
- **Bitboard** representation (JS `BigInt`): standard 7-column x 6-row layout, 7 bits per column (6 playable +
  1 sentinel row) = 49-bit board; track `position` (side-to-move stones) and `mask` (all stones). Win test by
  bit-shifts of 1 (vertical), 7 (horizontal), 6 and 8 (both diagonals).
- **Negamax + alpha-beta**, center-out move ordering (`[3,2,4,1,5,0,6]`), a **transposition table** (Map keyed
  by `mask + 2*position` or an equivalent unique key), and a depth/time cap as a **named constant** (no magic
  numbers). Iterative deepening is fine.
- **Score + perspective:** standard "sooner win = higher" scoring; then map to the per-column display **from
  the human's perspective** so `+` = good for the human on the correct column (fix the current sign/perspective
  and column-mapping bug at the display boundary). The best column's ring must match the solver's actual best.
- **Only label "Solved"/exact** when the search returned an exact value within the cap; otherwise "Estimate
  (depth N)".

**Acceptance:** empty board -> center column rated highest and positive (first-player win); a position with an
immediate winning drop -> that column shows the win; a forced-loss position -> negative; following the top-rated
column never contradicts the shown verdict; no position mislabelled "Solved" when it was a capped guess. Report
final search depth/time and whether full-solve was feasible within the cap.

---

## D. CH-1 - Chinchón "highlight sets" look (DECISION: the treatment below)

You already shipped the colorblind fix. The remaining complaint is aesthetic ("I do not like how it looks").
Implement this specific treatment (it is a taste call; Matt can veto after seeing it live, but build this first):

- **Group, do not paint.** Do not fill or color-wash melded cards, and never use a different color per meld
  (rainbow). Instead show each valid meld as a visually grouped cluster: a slight **upward lift/offset** of the
  melded cards plus a single thin **grouping underline/bracket bar** beneath each meld, in one consistent accent
  (`#ffce3a`). One accent, non-color grouping cue - reads for a colorblind user and stays calm.
- **Dim the deadwood.** Non-melded cards get a subtle desaturation/reduced opacity so the eye reads "these do
  not count" without harsh color. Keep it gentle.
- **No layout shift.** Reserve the lift/underline geometry at all times so toggling highlight on/off moves
  nothing (THE LAW rules 6-7). No glow, no heavy borders, no card resize.

**Acceptance:** toggling "highlight sets" cleanly distinguishes melds from deadwood via grouping + dimming (not
color fills), colorblind-safe, single accent, zero layout shift.

---

## E. C4-5 - Connect Four overhaul (DECISION: the MUST scope below; Escoba is the standard)

Connect Four is the crude first game. Bring it to Escoba's standard. Implement the MUST items in small,
reviewable commits; do NICE items only if genuinely quick; anything bigger than described, stop and flag.

**MUST**
- **E1 (L):** the C-2 solver above is the evaluation backbone. Do it as part of this overhaul if not already shipped in C.
- **E2 (M):** mobile fit + fixed geometry to Escoba standard. The "Analyzing..." row and the best-moves panel must **reserve space and never shift the board** when they appear/update (ties to C4-1, already done).
- **E3 (S-M):** colorblind disc identity. Red vs yellow is not enough on its own. Ensure **both** players' discs carry a distinct non-color token (shape/icon), not just one; the best-move ring and any status dot use `#ffce3a` + a non-color cue.
- **E4 (S-M):** clear turn/status indicator and win/draw handling to Escoba standard (whose move, game-over state, the close-X from Task A).

**NICE (only if quick)**
- **N1 (M):** drop animation + input-feel polish.
- **N2 (S):** board/disc theming consistent with the hub / Escoba.
- **N3 (M):** post-game "step through the best line" review, powered by the C-2 solver.

**Acceptance:** Connect Four matches Escoba on mobile fit, fixed geometry, colorblind safety, and status
clarity; MUST items shipped without regressing C4-1/2/3; NICE items either done cleanly or left out (say which).

---

### Batch exit
- [ ] A + B committed (separately), not pushed. C, D, E committed in logical units, not pushed.
- [ ] `run-all-tests.mjs` + `validate-sw-assets.mjs` clean; SW ASSETS + cache versions bumped for any new files; `CLAUDE.md` updated.
- [ ] Report: modals touched (A); the 5 findings (B); solver depth/perspective result (C); D shipped; E MUST done + which NICE items landed.
