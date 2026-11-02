# Leaderboard points: Matt's decisions (2026-11-02) — the spec for the build

Approved by Matt on 2026-11-02 ("build it" after reviewing `docs/LEADERBOARD-POINTS-TABLE.md`). Analysis behind it:
`docs/LEADERBOARD-POINTS-PROPOSAL.md` (real win rates per level, minutes per game, proposed values, gaps).

## Status: BUILT (v1422, 2026-11-02)
- `js/lb-points.js` (pure, read-time): `gamePoints(record, id, tier)` -> { pts, wins }, `pointsForWin`, `pointsKey`.
  Wired in `js/leaderboard-ui.js` (`isPointsBoard`, `gameMetricAt`, `boardTierOf` -> null on All, `compareBoardRow`:
  points, then wins; Cup Pong then fewer reracks). Level tabs = that level's points; MP, Ultimate/Classic and Solo
  tabs unchanged (wins / throws). v2 reads the same functions (parity green, golden regenerated from the branch).
- Players: "Points a win" line on every wins board (old board); v2's (i) lists each level, the cap, online, options;
  one-time announcement `lb-points-2026-11-02` (EN/ES, "See it" opens the Leaderboard).
- Choices made in the build (not in the spec): Cup Pong EASY is in the 20-point group too (it was 0 in the proposal,
  like every other near-guaranteed level); wins with no level (legacy buckets, Yahtzee) = 1; admin-only wins games
  (Archery, Battle Arena, Baseball, Cup Baseball) = 1 a win until given values; Battleship Quick at Medium/Hard =
  one level's value lower; multipliers count only on computer wins.
- Verified on the live snapshot (2026-11-02, `tools/read-lb-snapshot.mjs`): all 20 boards' top 3 = the TABLE exactly.
  Golds vs main: Air Hockey, Filler, Monopoly Deal, Pool -> MattyIce; Uno -> Natalia; Flick -> King of Games
  (King 21 -> 17, MattyIce 6 -> 8, Natalia 0 -> 1; main's counts differ from the table by Gridlock's new board).
  Tic Tac Toe 3rd: TP 20 and Jojopow 20 are no longer tied (more wins breaks it: TP).

## Why
Today every WINS-ranked board counts only wins at the player's hardest level ("difficulty outranks score"). Players
(Moonis, bug reports 2026-11-02 Flick Soccer + Dots and Boxes) think wins are missing; one lucky Hard win decides
boards; easy guaranteed wins (Tic Tac Toe Easy, 4 s a game) could be farmed. Matt: reward harder games, every win
counts, but no farming of near-guaranteed levels ("I don't want moonis to be able to just farm his way so high he's
untouchable... on easy guaranteed win games").

## The rule (wins-ranked boards only: js/lb-rules.js by 'wins'/'cuppong', 20 released boards)
1. Board number = POINTS (unit "pts"); every win adds; ties: more wins, then tie.
2. Points per win are SET PER GAME AND LEVEL: the table in `docs/LEADERBOARD-POINTS-PROPOSAL.md` section 2
   (e.g. Tic Tac Toe Classic E/M/H, Ultimate higher; Connect 4 1/6/8/12; Flick 0->see 3, 3, 6; Darts 1/2/3 ...),
   online wins at that file's per-game online values (never above the game's hardest level).
3. NEAR-GUARANTEED levels (won 90%+ of the time; Matt also put Tic Tac Toe Classic MEDIUM in this group:
   "it should still probably be treated as one"): Tic Tac Toe Easy + Medium, Flick Easy, Battleship Easy,
   Cup Pong Medium: **1 point per win, capped at 20 points per game per person from those levels together**
   (Matt's rule, replacing the proposal's "0 points" + "lifetime cap of 20 on the easiest level").
4. Match-length / option multipliers only for options NOT already counted one level down (see the proposal file:
   Flick 3 goals, Dots Large x2, Dominoes 500 x2, Pool 3+ racks x2, Cup Pong 0 reracks x2, Battleship Quick one level
   down). Old wins with no saved mode = the game's default option. Existing statsDiff "one level lower" rules stay.
5. Tables of several computers keep today's rule (counted at the easiest computer).
6. DISPLAY / READ-TIME ONLY (THE LAW): no stored number or key changes. Old board (players) and v2 (admin) stay
   identical (`tools/test-lb2-parity.mjs`, regenerate golden from the branch); the projection in
   `docs/LEADERBOARD-POINTS-TABLE.md` is the expected result on the 2026-11-02 snapshot (golds King of Games 20->16,
   MattyIce 7->9, Natalia 0->1).
7. NOT changed: score/time boards (Minesweeper, Sudoku, Murdoku, Arrow Maze, Nuts & Bolts, Gridlock, Word Weaver,
   Contexto, Spelling Bee, Golf, Snake, Ball Run, Hill Climb, Brick Breaker, Skeeball, Tower, Hold'em bankroll).
   Matt may review Minesweeper's "hardest first" later.

## Superseded
- Branch `claude/lb-points` (commit 69d642c, NOT merged): Flick-only "level x goals, every win adds". Do not merge;
  the per-game table above replaces it (its tests/strings may be reused).
- Hoops "until you score = one level lower" (live since v1410) stays as a statsDiff rule.

## After this build (Matt, in order)
1. Update the (i) on every board AND the info on stats pages: say exactly how points are calculated for that game
   (per level values, the 20-point cap on near-guaranteed levels, online value, multipliers). Fewest words.
2. Show "+X pts" on every game's game-over / result screen so players see points being earned.
3. Fix Tic Tac Toe Classic Medium's computer (falls to a fork, 43/44) only if Matt asks.

## Context (all live 2026-11-02)
Online-pair alerts (v1421, watch only); Lost records on Me (v1419); stats screens rebuilt (admin); every result logs
mode + detail (v1410). Leaderboard v2 still admin-only; Matt has not said "release it".
