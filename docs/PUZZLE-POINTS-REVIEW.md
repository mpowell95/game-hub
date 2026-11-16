# Puzzle points review: are the points per difficulty fair? (2026-11-16)

**Written by a session, not by Matt.** Matt (2026-11-16): "evaluate them and see if the points per difficulty make
sense are are fair", "everything should be based on actual, human plays". **Evaluation only. NOTHING here is changed,
decided, or cleared for players.** Brief: `HANDOFF-PUZZLE-POINTS-FAIRNESS` (2026-11-16).

## Where the numbers come from

- Read-only copies taken 2026-11-16, about 2:15 PM Eastern: the server-built leaderboard (`boards/v1/lb/z`), `players/`,
  and the play log (`playLog/`, which starts Oct 28).
- Real people only: 35 named people on the board. Left out: test1 / DREG5, every hidden test name, nameless devices,
  "Guest", and the admin TEST area. No simulation, solver, or generator number is used anywhere.
- "Time per level" for Word Weaver, Gridlock, and Murdoku gaps = the gap between one finish and that person's
  previous finish, when under 15 minutes. It is real play, but it includes any pause between levels.
- Every number shows the plays it rests on.

## Short answer

| Game | Fair? | Change? |
|---|---|---|
| Arrow Maze | Yes. All four levels pay about the same per minute. | No |
| Murdoku | Yes, on what exists. Hard has never been played. | No |
| Minesweeper | Looks right for Easy, Medium, Hard. Expert rests on 1 clear. | No |
| Word Weaver | **No. Easy pays about twice Medium and three times Expert per minute.** | Yes, see below |
| Gridlock | Cannot tell. Nobody is past Easy level 27. | No |
| Sudoku | Cannot tell. 5 solves ever, none since Oct 25. | No |
| Nuts & Bolts | Cannot tell. No times exist, none played since Oct 23. | No |

## 1. Each game

### Arrow Maze: fair

608 timed finishes on today's boards (Oct 13 to Nov 16).

| Level | Points | Finishes (people) | Median time | No slips | Points kept after slips | Points per minute |
|---|---|---|---|---|---|---|
| Easy | 1 | 279 (1) | 0:29 | 65% | 100% | 1.8 |
| Medium | 2 | 163 (2) | 0:47 | 77% | 88% | 2.0 |
| Hard | 4 | 79 (4) | 1:53 | 73% | 91% | 1.7 |
| Expert | 8 | 87 (2) | 3:38 | 57% | 79% | 1.6 |

- Time doubles each level and so do the points. That is why it comes out flat.
- Expert's 8 holds up. It is the lowest per minute (1.6), because its slip steps (8, 5, 3, 1) cut hardest. A clean
  Expert level pays 2.1 a minute, in line with the rest. Only two people have played today's Expert boards, so I would
  not move it.
- Grinding Easy gains nothing: 1.8 a minute is no better than any other level.
- Quits are not recorded, so I cannot say how often people give up.

### Murdoku: fair on what exists

109 solves ever (Easy 44, Medium 48, Hard 0, Expert 17), by 4 people. Solve times are stored only for 23 recent ones.

| Level | Clean points | Timed solves (people) | Average time | Clean points per minute |
|---|---|---|---|---|
| Easy | 1 | 7 (2) | 0:50 | 1.2 |
| Medium | 2 | 3 (2) | 1:39 | 1.2 |
| Hard | 4 | 0 | none | none |
| Expert | 8 | 13 (1) | 6:16 | 1.3 |

- Flat, like Arrow Maze. Expert takes about 7.5 times as long as Easy and pays 8 times.
- Hints (46 logged solves since Oct 28): Expert solves used 0 hints 5 times, 1 hint once, and 3 to 30 hints 10 times.
  The heavy-hint solves pay 1 instead of 8. That looks right: with 10 or more hints the game is doing the solving.
- Medium rests on 3 timed solves and Expert on one person. Thin, but nothing points to a problem.

### Minesweeper: leave it

871 boards by 6 people; 54 clears.

| Level | Points | Won / played (people) | Win rate | Best clear times |
|---|---|---|---|---|
| Easy | 1 | 12 / 56 (5) | 21% | 0:25, 0:30, 0:54, 1:12 |
| Medium | 3 | 34 / 503 (4) | 6.8% | 1:17, 1:33, 2:03, 3:43 |
| Hard | 8 | 7 / 109 (4) | 6.4% | 3:32, 4:28, 7:00 |
| Expert | 20 | 1 / 203 (4) | 0.5% | 5:22 |

- Medium to Hard: same win rate, and a clear takes about 2.5 times as long. Points go up 2.7 times. Fair.
- Easy to Medium: a clear takes about 2.6 times as long and is won a third as often. Medium at 3 is, if anything, low.
- Expert: 1 clear in 203 boards. Too thin to judge 20.
- Win rates overstate how hard the upper levels are. Of the 42 Expert boards in the play log (Oct 28 on), the median
  one lasted 3 seconds: people tap, hit a mine, and start again. Those cost nothing.
- **Luck:** of 437 losses with a recorded reason (since Oct 15), 8 were forced guesses (1.8%): Easy 1, Medium 2,
  Hard 0, Expert 5. A loss already costs nothing, so there is nothing to fix.
- Time per board is known for only 55 boards (the play log), so points per minute cannot be worked out.

### Word Weaver: Easy pays too much

415 logged finishes since Oct 28; 374 have a usable time.

| Level | Multiplier | Timed levels (people) | Median time | Average time | Points per minute |
|---|---|---|---|---|---|
| Easy | x1 | 297 (4) | 0:18 | 0:25 | 7.2 |
| Medium | x2 | 59 (3) | 0:58 | 1:37 | 3.7 |
| Hard | x3 | 4 (2) | 2:13 | 2:52 | 2.9 |
| Expert | x4 | 14 (2) | 4:37 | 5:24 | 2.1 |

- A Medium level takes 3.2 times as long as an Easy one (median) and pays twice as much. Three people show the same
  thing each on their own (Ele 0:19 vs 0:58, King of Games 0:13 vs 0:58, MattyIce 0:30 vs 1:10).
- Hard looks like about 7 times Easy and Expert about 13 to 15 times, against x3 and x4. Those rest on 4 and 14
  levels.
- It shows on the board: 199 Easy levels are worth 597 points; 13 Expert levels are worth 156.
- Hints: 3 of 374 levels used one. The star rule (3, 2, 1) is barely tested.

### Gridlock: too early

183 logged finishes since Oct 28, by 7 people.

| Levels | Points | Timed levels (people) | Median time | Median moves |
|---|---|---|---|---|
| 1 to 500 | 1 | 86 (6) | 0:04 | 3 |
| 1001 to 1500 | 3 | 76 (5) | 0:23 | 14 |
| 2001 to 2500 | 5 | 1 (1) | 1:57 | 48 |
| 3001 to 3500 | 7 | 1 (1) | 1:46 | 73 |

- Every Easy play is one of the first 27 levels, which take 4 seconds. That says nothing about levels 28 to 1,000.
- Nobody has played a 2, 4, 6, or 8 point level. Hard and Expert have one timed level each.
- 1 hint in 183 levels, so the halving rule is untested.

### Sudoku: no data

5 solves ever by 3 people (Easy 1, Medium 3, Expert 1). Last played Oct 25. Nothing to judge.

### Nuts & Bolts: no times

912 level wins by 12 people, last played Oct 23, before the play log existed. No time per level was ever saved.

- The one real measure is moves. People who only played Easy averaged about 12 moves a level (55 levels, 4 people).
  The two who mostly played Expert averaged 33 and 37 moves a level across everything (732 levels).
- So an Expert level is roughly 3 to 4 times the moves of an Easy one, and pays 8 times. Moves are not time or
  difficulty, so I would not change it on this alone.
- Expert is not capped and never runs out: 354 Expert levels are worth 2,832 points. No other puzzle board has
  numbers that size. Its points are still admin-only.

## 2. Across games

Points per minute, where time exists:

| Game | Easy | Medium | Hard | Expert |
|---|---|---|---|---|
| Arrow Maze | 1.8 | 2.0 | 1.7 | 1.6 |
| Murdoku (clean) | 1.2 | 1.2 | none | 1.3 |
| Word Weaver | 7.2 | 3.7 | 2.9 | 2.1 |
| Gridlock (first levels only) | 11 | 3.9 | thin | thin |

- Word Weaver and Gridlock hand out points several times faster than Arrow Maze and Murdoku. It does not matter for
  fairness: points never mix across games, and a medal is a place on one game's board. They do not need to line up.
- What matters is inside each game. Arrow Maze and Murdoku are flat. Word Weaver is not.
- **Hints are cut four different ways:** steps down (Arrow Maze, Sudoku, Murdoku), half (Gridlock), one star of
  three (Word Weaver), nothing to cut (Minesweeper, Nuts & Bolts). On Easy, a hint costs nothing in four of the five
  games that have hints; only Word Weaver charges. Players almost never use hints outside Murdoku, so there is no
  data to say which rule is best.
- **Ladders vs picks:** ladder games pay each level once, so their totals have a ceiling. Sudoku, Murdoku, and
  Minesweeper can be replayed forever, but Murdoku pays the same per minute at every level, so replaying Easy is not
  a shortcut. Minesweeper and Sudoku Easy are barely played (56 boards, 1 solve).

## 3. What I would change

One thing: Word Weaver's multipliers.

| Level | Now | Proposed | Rests on |
|---|---|---|---|
| Easy | x1 | x1 | 297 levels, 4 people |
| Medium | x2 | x3 | 59 levels, 3 people |
| Hard | x3 | x6 | **4 levels, 2 people** |
| Expert | x4 | x12 | **14 levels, 2 people** |

Medium to x3 is well supported. Hard and Expert have to rise with it to stay above Medium, but x6 and x12 are
provisional: they follow the times seen so far and should be re-checked at about 30 timed levels each.

Who moves (ties go to fewer levels played, the board's own rule):

| Player | Levels | Now | Place | Proposed | Place | Medal |
|---|---|---|---|---|---|---|
| King of Games | 140 | 651 | 1 | 1,077 | 1 | gold, no change |
| Natalia | 199 | 597 | 2 | 597 | 2 | silver, no change |
| Ele | 37 | 172 | 3 | 243 | 5 | **loses bronze** |
| MattyIce | 30 | 169 | 4 | 270 | 3 | **gains bronze** |
| Lili | 9 | 88 | 5 | 264 | 4 | none |
| Anita Bonita | 2 | 9 | 6 | 12 | 6 | none |

Matt gains a medal under this table. With Medium at x3 only and a smaller step above it (x5, x8), Matt still takes
third (249) and Ele is fourth (235).

No change to any other game, so no one moves on any other board.

## 4. Too thin to decide

- **Sudoku:** everything (5 solves).
- **Murdoku:** Hard (0 solves); Medium times (3).
- **Minesweeper:** Expert's 20 (1 clear); time per board at every level (55 timed boards).
- **Word Weaver:** Hard (4 timed levels), Expert (14); the hint stars (3 hinted levels).
- **Gridlock:** every level past Easy 27; all of Hard and Expert; the hint rule (1 hint).
- **Nuts & Bolts:** time at every level. A new play is logged with its time of day, so gaps will exist once people
  play again.
- **Arrow Maze:** Expert rests on 2 people; quits are not recorded anywhere.
- **Quits, every game:** not recorded for any of the seven.
