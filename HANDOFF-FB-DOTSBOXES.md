# HANDOFF-FB-DOTSBOXES: highlight only on Beginner, drop the tie note, 10x10 Large, "Menu"

**Batch 7 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: medium.** Decisions made; execute,
verify, commit. (The How-to-play sheet edits for this game are in HANDOFF-FB-HOWTO, not here.)

## 1. Capturable-box highlight only on Beginner (Matt: "on easy highlights boxes when available. Make sure the other difficulties do not")

Reality check: the highlight currently runs at ALL difficulties — it is a render-time signal
with no tier gate (`dots-boxes/js/ui.js:341`, class `is-capturable` at `:347`). Matt believed
it was Beginner-only; make the code match his belief: apply `is-capturable` only when the
current difficulty is `beginner`. Intermediate and Pro render no hint. (Stored difficulty ids
are untouched.)

## 2. Remove the tie note from setup (Matt: "remove 'tie is possible' from settings")

`hint_size_boxes_tie` (`dots-boxes/js/strings.js:25`, es `:74`) and its even-box-count
selection branch in `_sizeContent()` (`ui.js:177-179`): delete the branch and the key from
BOTH languages; every size uses the plain `{rows}×{cols} boxes` string.

## 3. Large becomes 10x10 boxes (Matt: "Large box needs to be 10x10")

`SIZES` (`ui.js:34`): `['large','size_large',5,5]` → `10,10` (an 11x11 dot lattice).
This is a settings-only change (board size is not stats vocabulary; `db` counters and
`byDiff` are size-agnostic — verify nothing keys on size before assuming, then say so in the
commit message).

Two things MUST be proven before this ships, not assumed:

- **Rendering/input at 10x10 on a phone:** 220 edges on a 375px-wide board means thin tap
  targets. Keep the board playable: let the Large board render edge hit areas at a minimum
  comfortable size even if the visible lines are thin (hit-target padding, not visual bloat),
  and confirm a mis-tap-free game is possible at 375x812. If the grid needs to scroll or
  pinch, stop and flag to Matt instead of shipping something unplayable.
- **AI time at 10x10:** the Pro AI "plans chains and solves the endgame exactly" (its setup
  hint's words) — chain/endgame solving can blow up combinatorially at 100 boxes. Measure
  worst-case move time at Pro on Large (mid-game and endgame). If any move exceeds ~1s on a
  desktop (phones are slower), cap the exact solver by board size (boxes > 25 falls back to
  the Intermediate-style heuristic plus whatever bounded lookahead stays under budget) and
  note the cap in `dots-boxes/CLAUDE.md`. A frozen UI is worse than an imperfect big-board AI.

## 4. In-game "New game" → "Menu" (Matt: "It's not clear how to get to the game settings screen... 'New game' that's gotta be changed to 'game menu' or something")

The in-game button labeled `new_game` actually navigates to the setup screen
(`ui.js:376-379`). Rename the label to en `Menu` / es `Menú` (matches Connect Four's in-game
"Menu" button — screenshot-verified precedent). Keep the END-overlay's "Play again" /
"Change settings" labels as they are; the confusion was only the mid-game button.

## Verification

1. `node run-all-tests.mjs` green (dots-boxes engine tests included).
2. Browser at 375x812: Beginner shows the pulse on 3-sided boxes, Intermediate/Pro never do;
   no tie text on any size; a full Large 10x10 game against Pro completes with no move taking
   noticeably long (state the measured worst move time in the commit message); mid-game button
   reads Menu in EN/ES and lands on setup.
3. Stats after a Large game: `db` counters advance and My Stats renders them (rule 1).
4. `node test-i18n-strings.mjs` green (deleted keys gone from BOTH languages).
5. `sw.js` CACHE bump LAST; update `dots-boxes/CLAUDE.md` (sizes, highlight gate, any AI cap).
