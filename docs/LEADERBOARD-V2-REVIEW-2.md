# Leaderboard v2: review 2 (2026-10-31, round 1 of the overnight loop)

Build reviewed: v1372 (admin-only). Brief (Matt, 2026-10-30 night): review as a player looking for their stats, comparing
themselves to others, seeing what others have. "The number of gold medals this leaderboard gives out is SIGNIFICANTLY
more than we previously had... This is an interface redesign, not a stats redesign."

**Data used: the REAL server board** (`boards/v1/lb/z`, read-only with the reader key, 2026-10-31 ~04:00 Eastern):
38 people (after hidden test names), 34 games on the launcher. Counted with the app's own code in a headless browser
(`tools/lb2-harness.html` + the old board's `gameStanding` through the additive export `lb2Standing`).

## Grade: D

REVIEW-1 gave C+ before checking real data. The real data is worse than it guessed: v2 is a different leaderboard
wearing a nicer coat. The look and navigation are good; the numbers are not the family's numbers.

## Gold medals, old vs v2 (real data)

| | Golds | Silvers | Bronzes |
|---|---|---|---|
| Old board, one standing per game (By Game top 3 / You tab "records held") | **40** | 45 | 31 |
| v2 Hall of Fame, "All levels" (every board's 1st place) | **104** | 69 | 58 |
| v2 Hall of Fame, "Top level" | 36 | 22 | 18 |

v2 hands out **2.6x the golds**. 129 boards instead of 34 standings. Leaders: King of Games 33 golds in v2 (old: about
one per game he leads), MattyIce 22. Per game: Ball Run 4 golds vs 1, Boggle 5 vs 1, Snake 6 vs 1, Arrow Maze 6 vs 1,
Minesweeper 5 vs 1, Skeeball 5 vs 1, Nuts & Bolts 5 vs 1, Hold'em 4 vs 1. And the reverse: Chinchón, Uno, Dominoes,
Parchís, Air Hockey, Battleship, Monopoly Deal and Pool give **0 golds on their default board** (nobody has 10 games at
Hard), while the old board crowned someone in each.

## What a player sees (first board opened per game)

v2 opens a wins game on **Hardest level · Win % · 10+ games**. The old board opened on **All**, wins, difficulty first.

| Game | Old (All tab) | v2 default board |
|---|---|---|
| Battleship, Chinchón, Monopoly Deal, Parchís, Uno, Dominoes, Air Hockey, Pool | 3 to 7 players ranked | **empty: "1st place is open"** |
| Hold'em | Bankroll, 16 players, MattyIce 1st | Wins Hard Win %, 1 player (King of Games) |
| Connect Four | 6 players | Expert Win %, 1 player |
| Cup Pong | King of Games 1st | Anita Bonita 1st |
| Tic Tac Toe | MattyIce 1st | King of Games and HDJ tied 1st |
| Dots and Boxes | 3-way tie for 1st (12 players) | HDJ 1st, 2 players |
| Yahtzee | King of Games and Ele tied 1st | King of Games alone 1st |

A player who looks for "where am I in Uno?" finds an empty board and "Not ranked". THE LAW rule 1 (data must stay
visible): their plays are stored but the screen they land on hides them; they are one sheet + one toggle away.

## Strengths (keep all of these)

1. One home with three tabs; tile art; favorites first; search. Faster to find a game than the old By Game.
2. The pinned row: your name, your place, the gap to the next place. The most motivating thing on either board.
3. Calm board: 10 rows, medals for 1-3, gold row lit, tabular numbers, 44px targets, dark mode right.
4. Profile names, never "You"; no codes in the DOM; server-built board (no `players/` read); admin-gated; "Old" link.
5. Score and puzzle games (Sudoku, Minesweeper, Snake, Golf, Skeeball, Spelling Bee, Contexto...) already reuse the old
   board's own order and numbers (`lb2ScoreBoard`), so on a matching tab they agree with the old board.

## Weak areas (most serious first)

1. **Medal inflation, 104 vs 40.** Hall of Fame, the Boards list medal, Me "1sts" and the Player page all count a 1st on
   every board (every difficulty, every view, Multiplayer, every language/view of a score game).
2. **Wins games ranked by a new rule.** Win % with a 10-game floor, hardest level first; the old board is wins,
   difficulty outranks score (`boardMetricCmp`), no minimum. Different leaders in Cup Pong, Tic Tac Toe, Dots and Boxes,
   Yahtzee; empty boards in 8 games.
3. **No All tab on wins games**, so pre-difficulty history (unmapped buckets) only shows on a tierless board that most
   games never build. The old All tab showed every play.
4. **Different tabs from the old board.** v2 has no Tic Tac Toe Ultimate / Classic, no Hold'em Wins tab as a default,
   no Cup Pong reracks tie-break on wins boards, no "no hints" note on Sudoku / Murdoku; it adds mode boards, Win %, and
   Multiplayer per mode, none of which the old board had.
5. **Ties.** v2 wins boards break a tie by fewer games (Wins) or more games (Win %) for ORDER but call it a tie for
   rank, while the old board's comparator decides ties (e.g. Cup Pong: fewer reracks is not a tie). Where they differ the
   medal count differs.
6. **Hall of Fame "Top level"** picks the hardest level anyone played, not the game's real top, and has no old
   equivalent.
7. **Lost features**: "<name> is 3rd. <gap>" line; "Closest to breaking" at the record's tier (the old You tab); records
   held "N of M"; "Not played yet" with the record and Play; the full game list on a player page (every game, most played
   first, with numbers); Send message from a player page; the reracks / no hints sublines; the per-game total plays.
8. **Player page** lists only 1st places: no answer to "how do I compare with Rosa in Darts?".
9. **Me tab** "Closest" uses the 1st-place gap on any board including Win % boards; "Ranked" tile counts boards, which
   balloons with modes (129 boards).
10. **Copy**: board sub line "All modes · vs computer" on every wins game (modes recorded only since 2026-10-30, so nearly
   every mode board is empty or tiny); right column of the Boards list has no label.

## Direction (for the plan)

- Each game's board = the OLD board's tabs, rows, order, ties, numbers and units, drawn in v2's look. Default tab = the
  old default (All; Hold'em Bankroll; Skeeball Points; Arrow Maze Levels).
- Medals, Hall of Fame, Boards-list medal, Me, Player: ONLY the old per-game standing (`gameStanding`). One standing per
  game, so the totals equal the old board's: 40 / 45 / 31 today.
- Drop Win %, the 10-game floor, mode boards and "Top level" from v2 (no old equivalent). Modes stay recorded
  (`withMode`) for later.
- Restore the lost player features in the new look: the gap line, closest to breaking, records held N of M, not played
  yet + Play, a player page with every game they played and their place in it.
- Parity tests on the real snapshot: every tab of every game, v2 rows = old rows (order, rank, tie, number); Hall of Fame
  totals = old standing totals.

## Independent review (second reviewer, opus): see the merged section below.

### Second reviewer (opus, independent, same real data): grade C-

**Agrees:** golds 40 old vs 104 v2 (counted the same way, independently: old `gameStanding` ranks vs every v2 board's
ranks); players vanish from default boards (Uno, Dominoes, Chinchón, Parchís, Battleship empty; Hold'em 2 of 16, Dots
and Boxes 6 of 12, Filler 4 of 8); Win % is a new stat for all 22 win-type games; lost features (records held, gap at the
record's tier, Send message, full lists, Spelling Bee chips, Contexto's full medal row); medals must come only from the
standing; parity test on the real snapshot.

**Adds (new to my review):**
- `TOP_N = 10` hides everyone ranked 11th or lower (Ball Run has 18, Snake 16, Hold'em 16): a THE LAW rule 1 problem.
- Golds for 0%: Boggle Medium gives three golds at 0.0%, Tic Tac Toe Hard two. One-player boards give a free gold.
- Score games double-count: the All tab repeats the top difficulty tab (Snake: 3 golds for one run).
- Per person: King of Games 19 -> 33 golds, MattyIce 8 -> 22, Natalia 0 -> 7.
- The OLD standing itself has 14 Hold'em players tied 2nd on a $0 bankroll: copying it blindly would hand out 14 silvers.

**Disagrees:** grade C- vs my D (same findings; I weigh the empty default boards heavier). It suggests keeping
difficulty/mode tabs as medal-less views ranked the old way; I keep the old board's own tabs only (difficulty tabs are
old tabs; mode tabs are not, so they go). **Merged grade: D+.**
