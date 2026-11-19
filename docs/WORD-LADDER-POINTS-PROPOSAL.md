# Word Ladder points: proposal (2026-11-19)

Written by a session, not by Matt. Matt's words: "Propose the point system." A PROPOSAL only: nothing here is built.
Word Ladder stays admin only.

## What exists today

- A level is finished once (no replays); its entry is `wl.lv` / `wl.es` `L<n>` = `{ s, m, p, h, t }` (stars, moves,
  par, hints, first time). Two phones merge per level with `wlBest` (the better attempt kept whole), so a level counts
  once per person. The board number is `wlSolved` (distinct levels, both languages).
- Stars: moves at par 3, par +1 or +2 = 2, more = 1; 1 hint caps at 2, 2+ hints at 1. Undo counts as a move.
- Bands: Easy 1-100 (3 letters), Medium 101-250 (4), Hard 251-400 (5), Expert 401-500 (6). English and Spanish are
  separate ladders. The daily is one ladder a day per language.

How the other puzzle games pay (for scale): Word Weaver = stars x 1/2/3/4 by band (a level 3 to 12); Sudoku and
Murdoku Expert 8, 5, 3, 1 by help; Arrow Maze Expert 8 a level; Gridlock 1 to 8 a level, half with a hint;
Minesweeper Expert 20 a board. A Word Ladder level takes under a minute at Easy and 1 to 3 minutes at Expert.

## Proposal A (recommended): a level's points by band and stars

| Band | 3 stars | 2 stars | 1 star | Levels | Most per language |
|---|---|---|---|---|---|
| Easy (3 letters) | 1 | 1 | 1 | 100 | 100 |
| Medium (4 letters) | 2 | 1 | 1 | 150 | 300 |
| Hard (5 letters) | 3 | 2 | 1 | 150 | 450 |
| Expert (6 letters) | 4 | 3 | 1 | 100 | 400 |
| **All** | | | | **500** | **1,250** (2,500 with both languages) |

- Read time only, from the merged per-level maps (nothing stored changes); each DISTINCT level counts once per person.
- English and Spanish both count (Word Weaver's rule): they are different puzzles.
- Hints already lower the stars, so they lower the points ("hints should always reduce how many points you get").
- **Daily: no points** (Word Weaver's daily has none). It gets its own Daily board later (`wlDaily/`, the `wwDaily`
  pattern: rules change and a backup first).

## Proposal B: Word Weaver's rule (stars x 1/2/3/4)

| Band | 3 stars | 2 stars | 1 star | Most per language |
|---|---|---|---|---|
| Easy | 3 | 2 | 1 | 300 |
| Medium | 6 | 4 | 2 | 900 |
| Hard | 9 | 6 | 3 | 1,350 |
| Expert | 12 | 8 | 4 | 1,200 |

Same as Word Weaver, but a 20-second Easy level would pay 3, three times a 5-minute Sudoku Easy. Not recommended.

## What stops farming

| Hole | Today | Proposed |
|---|---|---|
| Same level on two phones | Counted once (merged maps, `wlSolved`) | Same for points |
| Replay on a second phone after a hint solve on the first (the second starts at level 1 and knows the answer) | The better attempt wins: 1 star becomes 3 | Record each hint the moment it is used (`wl.hint` / `wl.esHint` `L<n>` = first hint time, Word Weaver's `ww.hint`) and cap a level's stars at read time when a hint came before its clean finish |
| Clearing the save and replaying | Same as above | Same cap |
| Fast farming | Rate gate 30 results a minute | Unchanged; levels are finite (500 a language), so no Easy cap is needed (Nuts & Bolts needs one only because its Easy never ends) |
| Impossible numbers | No integrity rule | STRONG rule after a replay over real data: moves at least the level's CURRENT par (pars only ever fall), hints at most moves |
| Par lowered later by new words (2026-11-19: 14 Spanish levels) | Earned stars stay (bests only improve) | Points read the stored stars, so nobody loses points |

## Before points go on (data)

English Expert is not fair to score yet: on 78% of levels 401-450 and 98% of 451-500, par is reachable only through a
word outside Word Weaver's lists (STANES, PULERS, CARKED, MAMMEE), so 3 stars there means knowing Scrabble words.
Spanish 451-500: 54%. Remake Expert (both languages, start and target kept common, every par reachable through common
words) before release, while it is admin only, or score Expert's 2 stars as 3.

## Where it would live (when Matt says build)

`js/word-ladder-points.js` (pure, Word Weaver's shape), `js/lb-rank-sheet.js` rows (the "See how scores are
calculated" sheet), `js/lb-rules.js` `wordladder: { by: 'points' }`, the "+X pts" pill (`js/points-toast.js`), tests
in `tools/test-word-ladder.mjs`.
