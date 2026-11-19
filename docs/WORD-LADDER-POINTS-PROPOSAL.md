# Word Ladder points: proposal (revised 2026-11-19, after the remake)

Written by a session, not by Matt. Matt's words: "1. Yes, remake the levels. Keep whatever points I've earned, if any.
2. Revaluate once the difficulties are modified." **BUILT 2026-11-19** (Matt: "Cool. Make sure it's ready to be added to the
leaderboard"): the recommended table below, `js/word-ladder-points.js`; see `word-ladder/CLAUDE.md`, "Points and the leaderboard".
Not built: the hint cap across phones ("What stops farming"). Word Ladder stays admin only.
The first version of this proposal (same day, before the remake) is in git history; its table is replaced below.

## What changed

English Hard and Expert (251-500), Spanish Easy (1-100), and Spanish Hard and Expert (251-500) were remade
(`word-ladder/CLAUDE.md`, "Data"). Every par is now reachable through Word Weaver words (the old English Expert needed
Scrabble-only words on 78-98% of levels), and each band rises from its first level to its last.

| Band | Words | Par (first half / second half) | Greedy finishes at par | Estimated minutes a level |
|---|---|---|---|---|
| Easy 1-100 | 3 letters | EN 3.2 / 3.5, ES 3.3 / 3.4 | 82-78% / 84-78% | 0.5 |
| Medium 101-250 | 4 letters | EN 4.0 / 4.5, ES 4.0 / 4.5 | 72-49% / 84-65% | 1 |
| Hard 251-400 | 5 letters | 4.6 / 5.2 (both) | 47-35% (both) | 1.5 to 2 |
| Expert 401-500 | 6 letters | EN 4.8 / 5.6, ES 5.4 / 6.1 | EN 32-20%, ES 24-12% | 2.5 to 3 |

Minutes are an estimate, not a measurement (no timed real plays yet): seconds a move by word length (3 letters 8, 4
letters 11, 5 letters 16, 6 letters 22), times par plus the moves a player wastes (about half a move where greedy play
reaches par, about two where it does not). The private play log records `secs` on every finished level (`withMode`
`log`); once Matt has played some remade levels, `node tools/read-play-log.mjs <CODE>` gives real times to check this.

## Proposal (recommended): a level's points by band and stars

| Band | 3 stars | 2 stars | 1 star | Levels | Most per language | Points a minute at 3 stars |
|---|---|---|---|---|---|---|
| Easy | 1 | 1 | 1 | 100 | 100 | about 2 |
| Medium | 2 | 1 | 1 | 150 | 300 | about 2 |
| Hard | 3 | 2 | 1 | 150 | 450 | about 1.8 |
| Expert | 5 | 3 | 1 | 100 | 500 | about 2 |
| **All** | | | | **500** | **1,350** (2,700 with both languages) | |

Why these numbers:

- **The same pay a minute in every band** (about 2), so no band is the one to farm. Expert went from 4 to 5 against the
  first proposal: its levels are now longer (par 5 to 7 at the end) and greedy play solves only 12-32% of them at par.
- **Against the other puzzle games**: Word Weaver (stars x 1/2/3/4, a 3-star Easy level of about a minute = 3) pays
  more a minute; Sudoku and Murdoku Expert (8 for 15-25 minutes) and Arrow Maze Expert (8 a level) pay less. Gridlock
  pays 1 to 8 a level by band. Word Ladder at about 2 a minute sits between them, and its 500 levels a language are
  finite (no Easy cap needed, unlike Nuts & Bolts).
- Hints already lower the stars (1 hint caps at 2, 2+ at 1), so they lower the points.
- English and Spanish both count (Word Weaver's rule): they are different puzzles.

## Levels earned before the remake

- Read time only, from the merged per-level maps; nothing stored changes.
- **Each level NUMBER pays once, at its best entry over every puzzle version** (`wlLevels` in `js/game-stats.js`): an old
  solve of a remade number (`L401`) keeps paying exactly what it pays today, at its stored stars, and the band of its
  number. Playing the remade puzzle (`L401v2`) can only RAISE that number's points (more stars), never add a second copy.
- So nobody loses points, and nobody gains by replaying a remade level beyond its best result.
- Old English Expert solves were on the Scrabble-word puzzles; they still pay Expert's price (Matt: "Keep whatever
  points I've earned").

## What stops farming

| Hole | Today | Proposed |
|---|---|---|
| Same level on two phones | Counted once (merged maps, `wlSolved`) | Same for points |
| Old and new puzzle of a remade number | Counted once (`wlLevels`) | Same: the better one pays |
| Replay on a second phone after a hint solve on the first (the second starts at level 1 and knows the answer) | The better attempt wins: 1 star becomes 3 | Record each hint the moment it is used (`wl.hint` / `wl.esHint` `L<n>`, Word Weaver's `ww.hint`) and cap a level's stars at read time when a hint came before its clean finish |
| Clearing the save and replaying | Same as above | Same cap |
| Fast farming | Rate gate 30 results a minute | Unchanged; levels are finite |
| Impossible numbers | No integrity rule | STRONG rule after a replay over real data: moves at least the level's par for THAT version (pars only ever fall), hints at most moves |
| Par lowered later by new words | Earned stars stay (bests only improve) | Points read the stored stars, so nobody loses points |

## Daily

No points (Word Weaver's daily has none). Its own Daily board later (`wlDaily/`, the `wwDaily` pattern: a rules change
and a backup first). Days already played never change; the remake touched only future days with a bad par.

## Where it would live (when Matt says build)

`js/word-ladder-points.js` (pure, Word Weaver's shape, reading `wlLevels`), `js/lb-rank-sheet.js` rows (the "See how
scores are calculated" sheet), `js/lb-rules.js` `wordladder: { by: 'points' }`, the "+X pts" pill (`js/points-toast.js`),
tests in `tools/test-word-ladder.mjs`.
