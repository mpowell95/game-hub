# Batch 09 - Connect Four: Overhaul, Confirms & Stats Integrity

The largest, most open-ended batch - do it last, in sub-steps. Connect Four (`connect-four/`) is the crude
first game; the guiding rule is **copy Escoba, not Connect Four** (THE LAW rule 4). Three small/medium items
(C4-1/2/3), one diagnostic (C4-4), one approval-gated overhaul (C4-5). C4-2/C4-3 share the stats system with
LEAD-1 (Batch 08) - reuse that work. Confirm evaluator/undo/eval-render locations first
(`01_repo_context.md`, confirmation 3).

**SW note:** `connect-four/index.html` was once the precache-gap victim. If you add/rename files here, add
them to `sw.js` `ASSETS`, bump the cache version, and run `node validate-sw-assets.mjs`.

**Colorblind note:** Connect Four is red vs yellow discs; screenshot 13 shows a face on one player's disc as a
non-color cue. Keep/strengthen a non-color channel (THE LAW rule 9) in anything you touch.

---

## C4-1 - Do not show the best-move star while "Analyzing..."

- **Screenshot:** `13_connect_four_..._analyzing_star_button.jpg` (annotated: star-in-a-box shows during "Analyzing...")
- **Verbatim:** "When it's 'Analyzing...' it shouldn't show that star with the box around it."

Hide the best-move star/box while the engine is still computing (state = "Analyzing..."); show it only once
analysis produces a real best move.

**Acceptance:** no star during "Analyzing..."; star appears on the correct column after analysis; toggling
"show best moves" off hides it entirely.

---

## C4-2 - Undo confirm + game does not count towards stats

- **Screenshot:** `13_..._analyzing_star_button.jpg`
- **Verbatim:** "the first time you press undo, a popup should appear and say something like 'are you sure? Undoing a move means this game won't count towards your stats' or something. Then we need to build that logic so that actually happens."

Two parts: (1) on the **first** undo in a game, show a terse confirm (cancel/confirm) - once per game, not on
every subsequent undo (confirm this reading with Matt); (2) if confirmed, that game is **actually excluded**
from stats when it ends. Implement the exclusion as a per-game "counts towards stats" flag honored by BOTH
recorders + the `business-deal` copy (see Batch 08 / recorder-contract). Escoba's **unassisted mode** (hints/pre-selection
hidden) is the nearest existing pattern for "this run is different" - align with it where sensible.

**Acceptance:**
- [ ] First undo triggers the confirm; cancel leaves the move; after a confirmed undo the finished game records no W/L; a no-undo game records normally; no re-prompt on later undos in the same game (unless Matt decides otherwise).

---

## C4-3 - "See Best Moves" confirm + game does not count towards stats

- **Screenshot:** `13_..._analyzing_star_button.jpg`
- **Verbatim:** "Same with turning on See Best Moves - that should have a confirm screen and not count towards stats if they use it"

Same pattern as C4-2 for the **"See Best Moves"** toggle: turning it on shows a confirm; if proceeded, the game
is excluded from stats. **Reuse the same flag/mechanism as C4-2** (either taint the same "counts" flag) - one
mechanism, not two.

**Acceptance:**
- [ ] Turning on best-moves triggers a confirm; cancel leaves it off; after confirm the game records no W/L; a game where it was never on records normally; C4-2 and C4-3 share one disqualification path.

⚠️ Decide with Matt: if hints are already on (persisted) when a game starts, does it disqualify at start? Simplest rule: hints on at any point in the game -> it does not count. State your choice.

---

## C4-4 - Evaluation numbers say "you lose no matter what" after following the best moves

- **Screenshot:** `14_connect_four_solved_board_showing_15_3_move_evaluations.jpg` (per-column values like -15 / -3)
- **Verbatim:** "I followed all the suggested moves, but it says I'll lose regardless of where I play next. How? either the best move calculator is broken, or the graphics here are not accurate."

Matt's framing is the right split: **engine wrong, or display wrong.** Reproduce the position, then compare the
evaluator's **raw output** to what is **rendered per column** - that one comparison usually settles it. Likely
culprits: perspective/sign flip (score is from the opponent's side, so a win renders negative), column mapping
(right numbers over the wrong/reversed columns), a genuine scoring/depth bug, or a misleading display scale.

- If **display**: fix so higher/positive = better for the human, mapped to the correct column, on a sane scale.
- If **engine**: fix the evaluation (bigger; if the engine is deeply crude this folds into C4-5).

**Acceptance:**
- [ ] In a clearly winning/drawing position for the human, evaluations are not uniformly "losing," and the best-marked column matches the evaluator's actual best; following top-rated moves is consistent with the shown evaluations.

⚠️ Report which it was (Matt explicitly asked). If the engine needs real work, flag that it bleeds into C4-5.

---

## C4-5 - General overhaul - APPROVAL-GATED

- **Screenshot:** `13_..._analyzing_star_button.jpg`
- **Verbatim:** "Connect Four needs an overhaul. It was the first game we made so it's a little crude."

Deliberately vague. Do not free-style a rewrite. After C4-1..C4-4 you will know where it is rough; turn that
into a concrete, **Escoba-aligned** scope: visual polish (board/disc/animation/turn indicator to Escoba's
standard), mobile fit and fixed geometry (THE LAW rules 6-8), the analyzing/hints UX, colorblind channel,
code structure if markedly worse than newer games, engine strength if C4-4 exposed weakness. Group into
must / nice-to-have with rough effort, produce a mock, get Matt's approval, then implement in small commits.

**Acceptance:**
- [ ] A concrete overhaul scope proposed and approved (not assumed); approved items shipped in small increments without regressing C4-1..C4-4 or other games; Connect Four brought toward Escoba's look/feel and mobile fit as agreed.

---

## Stats-integrity note (ties C4-2/C4-3 to Batch 08)

One stats path, one "counts towards stats" flag, set false by a confirmed undo or by using best-move hints,
honored by both recorders + the `business-deal` copy. Verify end to end into the leaderboard: a Connect Four game using a
hint -> confirm -> does NOT appear in the leaderboard; a clean game -> does. Keep `test-recorder-contract.mjs`
+ `test-stats-replay.mjs` green.

### Batch exit
- [ ] C4-1..C4-4 done and verified; stats disqualification proven end-to-end. C4-4 root cause reported. C4-5 scope approved and shipped iteratively. Tests + validator clean.
- [ ] Commits split sensibly (overhaul separate from small fixes; list constant changes); do not push. Update `CLAUDE.md` (THE LAW rule 9).
