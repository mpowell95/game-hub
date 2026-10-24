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
