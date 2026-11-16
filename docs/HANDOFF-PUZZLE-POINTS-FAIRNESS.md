# Handoff: are the puzzle games' points per difficulty fair? (2026-11-16)

**Written by a session, not by Matt.** Matt's words (2026-11-16): *"write a handoff document (open ended) listing
those games and asking the agent to evaluate them and see if the points per difficulty make sense are are fair...
Me and a session semi-arbitrarily assigned the point values."*

**Cleared: evaluation and a written recommendation only.** NOT cleared: changing any point value, any leaderboard,
or anything players can see. Players see a change only when Matt says "release it", "ship it", or "make it live for
everyone" (root `CLAUDE.md`).

## The question

Seven solo games pay leaderboard points for each level or board cleared, more for harder levels. The numbers were
picked by feel. Find out whether they make sense and are fair, and say what you would change, if anything.

## REAL HUMAN PLAYS ONLY (Matt, 2026-11-16: "everything should be based on actual, human plays")

- Every finding and every proposed number must come from real players' real games: times, wins, losses, hints,
  mistakes, quits, read from the database.
- **Not evidence:** simulations, solvers, generator grading, board counts, the code's own guesses, or your own
  judgement of how hard a level "should" be. `tools/minesweeper-odds.mjs` is a simulation, not human play.
- **Leave out non-human and test plays:** the test profile test1 / `DREG5`, any made-up test code, test-automation
  plays, and admin-only TEST-area plays (`testGames`).
- Where a level has too few human plays to judge, say so and leave its value alone. Never fill the gap with a guess.
- Every number in the report shows how many human plays it rests on.

This is open-ended. Some angles worth considering (not a checklist, and not a hint at the answer):

- **Within a game:** is Expert really worth 8x Easy (or 20x in Minesweeper)? Compare against time per level, win
  rate, mistakes, and how often people quit.
- **Across games:** is an hour of Arrow Maze worth roughly what an hour of Sudoku or Minesweeper is? Points never
  mix across games on one board, but medals and the Medal Count do. Should they line up at all?
- **Farming:** can someone pile up points by grinding easy levels? Nuts & Bolts Easy is capped at 20; nothing else is.
- **Hints and mistakes:** are the cuts consistent from game to game, and do they hurt about the right amount?
- **Luck:** Minesweeper boards can force a guess. Should a forced loss count the same as a skill loss? (Use the real
  loss reasons in `tools/read-minesweeper.mjs`, not the simulation.)
- **Ladders vs picks:** Arrow Maze, Gridlock, and Word Weaver make you play levels in order; Sudoku, Murdoku,
  Minesweeper, and Nuts & Bolts let you pick a difficulty and replay it. Does that change what is fair?
- **Small data:** some games have very few plays. Say plainly where the data is too thin to judge.

## The games and today's values

| Game | Easy / Medium / Hard / Expert | Hints and mistakes | Code |
|---|---|---|---|
| Arrow Maze | 1 / 2 / 4 / 8 a level (Easy 1-50, Medium 51-100, Hard 101-200, Expert 201+) | each hint or lost life steps it down: Medium 2, 1; Hard 4, 3, 2, 1; Expert 8, 5, 3, 1 (Expert was 6 before 2026-11-02, old clears keep 6) | `js/arrow-maze-time.js` (`WO_BAND_POINTS`, `WO_SLIP_POINTS`) |
| Minesweeper | 1 / 3 / 8 / 20 a board cleared | none; a loss costs nothing | `js/puzzle-points.js` (`LEVEL_POINTS`) |
| Sudoku | 1 / 2 / 4 / 8 a solve | each hint or mistake steps it down (same steps as Arrow Maze); helped solves from before 2026-11-03 pay half: 1, 1, 2, 4 | `js/puzzle-points.js` (`HINT_STEPS`, `HINT_UNKNOWN`) |
| Murdoku | same as Sudoku | same as Sudoku | same |
| Nuts & Bolts | 1 / 2 / 4 / 8 a level, Easy at most 20 in all | no hints exist | `js/puzzle-points.js`; **its points are admin-only, held by Matt** |
| Gridlock | 1 to 8 a level: +1 every 500 levels over a 4,000-level ladder (Easy 1-2, Medium 3-4, Hard 5-6, Expert 7-8) | a hint on a level halves it (rounded up) | `js/gridlock-points.js` (`glLevelPoints`) |
| Word Weaver | stars x 1 / 2 / 3 / 4 (bands of 500 levels) | 0 hints 3 stars, 1 hint 2, 2+ hints 1 | `js/word-weaver-points.js` (`WW_MULT`) |

Points are worked out when the board is shown, from what each phone already saved, so a new table changes no
stored data. It does move places and medals for real people, so show who moves.

## Where the history is

- How the values were chosen: `docs/LB-PUZZLE-POINTS-PROPOSAL.md` (Sudoku, Murdoku, Nuts & Bolts, Minesweeper,
  2026-11-03), `docs/LEADERBOARD-POINTS-DECISIONS.md`, each game's `CLAUDE.md`.
- Arrow Maze: Matt asked to revisit Expert's 8 points once there is more data (root `CLAUDE.md`).

## Data you can read (all read-only)

- `node tools/read-arrow-pace.mjs` - Arrow Maze points per minute, per person and per difficulty.
- `node tools/read-minesweeper.mjs` - wins and losses per level, and why each board was lost.
- `node tools/read-lb-snapshot.mjs` - a local copy of the server-built leaderboard (`backups/lb-z.json`).
- `node tools/read-play-log.mjs <CODE>` - every finished game with its time and mode.
- Most of these need the env var `GAMEHUB_READER` (the reader key) and `NODE_USE_ENV_PROXY=1`. If you cannot reach
  real player data, STOP and tell Matt. Do not evaluate without it.
- Plays logged before a game started saving a detail (e.g. hint counts per solve) are missing that detail. Say which
  dates each number covers.

## Rules that apply

- **Read only.** No Firebase writes, no `--write` flags, no changes to the live game.
- Never use Matt's code or name in a test or probe. Test profile: test1, code `DREG5`.
- Show times in US Eastern. Never put another player's code on a page.
- Delegate only big jobs, on the cheapest model that can do them (root `CLAUDE.md`, "Subagents").

## What to send back

A short report in `docs/` (e.g. `docs/PUZZLE-POINTS-REVIEW.md`):

1. For each game: is today's table fair, with the numbers behind the answer.
2. Anything unfair across games.
3. What you would change, as a before-and-after table, and who would move on each board (names, places, medals).
4. Where the data is too thin to decide.

Plain words, no padding. Matt decides; nothing ships from this report alone.
