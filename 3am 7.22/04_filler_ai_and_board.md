# Batch 04 - Filler: AI Behavior & Board Generation

Two logic bugs in **Filler** (`filler/`). Filler is not covered in the audit, so confirm the AI
move-selection and board-generation locations first (`01_repo_context.md`, confirmation 2). Read Filler's
rules as implemented before changing anything - the descriptions below are Matt's observations, not a spec.

> Filler primer (verify against code): two players start from opposite corners of a grid of colored tiles;
> on your turn you pick a color, your whole territory becomes it and absorbs adjacent same-color tiles;
> you cannot pick the opponent's current color; most tiles when the board is fully claimed wins.

**Colorblind note (THE LAW rule 9):** Filler's colors already carry shapes (Matt's feedback names "the blue
triangle," "the star," "the plus"). That shape channel is the colorblind-safety mechanism - do not remove or
desync it in any fix.

---

## FILLER-1 - The computer refuses to play the color that would end the game; cycles forever

- **Screenshots:** `05_...`, `06_...`, `07_...`, `08_...` (four examples of the same issue)
- **Verbatim:** "the computer player has 1, 2, 3, or whatever unfilled boxes in his territory that I cannot reach. But he just doesn't play that symbol. Instead of changing to the blue triangle and ending the game, he'll change to orange, then the star, then the plus, then yellow, then orange, etc etc etc. ... eventually the game just ends without it being filled but like what the hell? Please fix this."

**Symptom:** late-game, a few tiles adjacent to the computer only get absorbed by one specific color; the AI
keeps picking every other color and loops until the game force-ends with the board not fully claimed.

**Diagnose (do not assume which):** the AI's move scoring undervalues/ties away the closing move; a legality
filter (cannot-pick-opponent-color, or a cannot-repeat-own-color rule) wrongly excludes the needed color;
the AI's reachability/adjacency check does not see those tiles as capturable; or a turn-cap/stalemate
terminator ends the match early and masks the loop.

**Method:** add a temporary trace (per turn: candidate colors, their scores, the pick), set up or seed a
late-game position, and watch why the closing color loses. Remove the trace before committing. Fix so the AI
values/selects the closing move and the board reaches a true terminal state.

**Acceptance:**
- [ ] In positions where a specific color closes the board for the computer, it plays it (verified on a reproduced position).
- [ ] Games end because the board is legitimately claimed, not because a fallback timed out; earlier-game AI still sane on a few full playthroughs.

⚠️ If, under the real rules, some positions genuinely have no legal completing move, document that and check with Matt rather than forcing a wrong heuristic.

---

## FILLER-2 - Unfair starting boards: computer starts adjacent to a duplicate >=50% of the time

- **Screenshot:** `15_filler_mid_game_board_top_right_tiles_circled.jpg` (duplicate tiles by the computer's start circled)
- **Verbatim:** "this is a bad starting board for Filler. this happens more often than it doesn't happen - that the computer player starts with two of the same box next to him. so he always gets 2 immediately. this happens equal to or greater than 50% of the time."

**Symptom:** generated boards frequently give the computer's start an adjacent same-color tile (an immediate
2-tile region), estimated >=50% of the time.

**Fix direction:** make the start fair and symmetric - ensure the tiles adjacent to each player's starting
corner differ from that corner's start color (regenerate/recolor as needed). The hub already has a "board
quality gate" concept from Nuts & Bolts (a mixedness + solver probe) - a small start-fairness gate here is
the same idea. Confirm whether the human's start has the same property; the fix must be even-handed.

**Acceptance:**
- [ ] Over a large sample of fresh boards, neither player (computer especially) starts adjacent to a same-color tile at anything near the old rate; boards still look varied/valid.

⚠️ Pick and state the target rule ("no free adjacent match at all" vs "equal chance for both"); make it symmetric.

---

### Batch exit
- [ ] Both bugs reproduced, fixed, trace removed. Tests + validator clean.
- [ ] Commit (list any new constants old->new; e.g. board-gen params); do not push. Report the root cause of each to Matt. Update `CLAUDE.md` if a Filler rule/constant is now documented.
