# Leaderboard v2: review 3 (2026-10-31, round 2 of the overnight loop)

Build reviewed: v1373 (live, admin-only). Same brief and same real data as `LEADERBOARD-V2-REVIEW-2.md`.
Screenshots: `docs/mockups/lb2-shots/r1/`.

## Grade: B

The stats problem is fixed and proven: on real data every one of the old board's 149 tabs (34 games) equals v2's
board row for row (rank, tie, name, number, row count), and the gold count is **40 = 40** (`tools/test-lb2-parity.mjs`
against a golden file made from `main`'s untouched old board). What is left is look and reach, not numbers.

## Strengths

1. Numbers are the family's numbers: same leaders, same ties, same units, same sub lines (Minesweeper "2 of 35 won",
   Spelling Bee's day chips, Cup Pong reracks, Sudoku "no hints", the tier word on All rows).
2. Everyone is listed (Snake 16, Ball Run 18): nobody hides below a top 10.
3. The pinned own row with the old gap line ("Beat 43 long on Hard to take the record").
4. Hall of Fame now means something: one medal per game, King of Games 19 golds, MattyIce 8 (old By Game).
5. Me = the old You tab in a cleaner form: records held N of M, closest to a record with the gap, not played yet + Play.
6. Player page: every game played, most played first, their place and number, Message button, tagline.
7. Standing records ("Longest snake", "Total runs") are back under each board.

## Weak areas (most serious first)

1. **Tic Tac Toe disagrees with itself** (the old board does too): the Boards list, Hall of Fame and Player page give
   the gold to MattyIce (the standing ranks Ultimate wins first); the board's All tab puts HDJ, Inc. first (all wins).
   v2 puts the two one tap apart, so it shows more. The only game where this happens. Needs Matt's call (changing
   either order is a stats change).
2. **Tabs off-screen.** Snake (All, Easy, Medium, Hard, Walls off, Walls on) and Skeeball's machines scroll sideways;
   the Walls tabs and later machines are invisible until swiped. Ball Run / Hill Climb with 4+ tiers too.
3. **Player page drops the old totals**: wins and games played across everything (old player page header), and the
   tap into another person's full per-game stats (losses, per difficulty). A player comparing "what does she have?"
   gets places and one number per game, not the record.
4. **Boards list right column has no label**: "#14" next to Ball Run reads as a game number, not "your place".
5. **Arrow Maze Rush** opens the old board and Back leaves to the launcher, not to v2.
6. **Me tab "Closest" rows are dense**: your number, a medal, the holder and their number on one line; long names
   are cut ("Mat…"), and the tier shape squares are tiny.
7. **Contexto's big medal images** make every row tall (old look, kept on purpose); fine, but the pinned row has no
   line under the name.
8. Spanish not checked by the parity test (number formats differ: 1,234 vs 1.234).

## Not changed on purpose

- Hold'em: 14 people tied 2nd on an untouched bankroll, exactly as the old board; they earn no medal in the tallies.
- Rank arrows off; per-game tab memory off (the old board always opens on its default tab).
