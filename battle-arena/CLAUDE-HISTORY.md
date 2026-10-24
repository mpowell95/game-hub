# Battle Arena — history

## 2026-10-24: built (phase 1)

Built from `docs/BATTLE-ARENA-SPEC.md` (Matt's three Match Monsters recordings, 2026-10-23): vs the
computer only, admin only. The engine is pure JSON with a seeded RNG so phase 2 (live rooms and
turn-by-turn challenges) can replay moves on every phone. Twelve original monsters drawn as inline
SVG, each with an evolved form.

Tuning: the spec's numbers gave ~7 turns per side in an AI-vs-AI soak with ~25 specials a match, so
every HP went up by half and the weakest/strongest monsters were nudged (list in CLAUDE.md). Bombs
first went off from ANY orthogonal neighbour, which blew ~11 a match; they now go off only in line
with a match. The soak then found a match between two healing teams still going at 3000 moves, which
is where the Sudden death rule (no heals after each side's 20th turn) came from.


## 2026-10-24: v2, the battle screen rebuilt

Matt, after his first test: *"This game is NOT ready for me to waste my time testing it. It's very bad.
It's in no way, shape, or form a clone of the other game. Gameplay is missing pieces, it doesn't register
4 in a rows, it gives you 3 turns to begin, there's little to no animation at all."* A recording of the
first build confirmed it: specials were a small box, damage a tiny number, the extra move a tiny "+1 move"
pill, the move dots showed 3 after an extra move (likely the "3 turns"), gems vanished, monsters were
static. The rules missed that berries MATCH in the reference (they were picked up next to matches).
Rebuilt: engine (matchable berries, bombs set off by an adjacent match, a `pass` move for the 30 s timer),
glossy gems, a Boiler Room scene, and the whole event-to-animation layer (see CLAUDE.md, "The battle screen").


## 2026-10-24: v3, a frame-by-frame comparison with the reference

Matt: *"Now go back and review everything again. Compare the real game with ours. Find the
discrepancies. Fix them."* A move-by-move log of rec3 (vs oksurely09, 22 moves) plus my own frame
checks found: any adjacent swap is legal (fixed earlier the same night); a 5-match (incl. L/T) gives
an extra move outside the once-a-turn 4 cap and heals; evolving is a chosen move that costs a move and
heals nothing (the +5 seen in the bravomike match was a 5-match in the same turn); specials clear part
of the board; the timer is per move; the board dims on the other side's turn; the HUD, banners, stage
reveal and ending all looked different. The first two recordings (vs bravomike) were no longer in
Dropbox, so they could not be re-checked move by move.
