# Points per win for the wins boards: proposal (2026-11-02, read-only analysis)

Data: board snapshot boards/v1/lb/z read 2026-11-02 (36 people after hidden-name filter); play logs for every
code (only 7 people have any; 555 of 849 entries are *King of Games*). Standings today = js/leaderboard-ui.js
lb2Standing in headless Chromium (tools/lb2-harness.html, port 8195, every non-localhost request aborted).
Scripts and raw outputs here: load.mjs, agg.mjs (winrates.txt), timing.mjs (timing.txt), stand.cjs
(standings.json), proj.mjs (proj-out.txt). *King of Games* = Moonis (3VN33).

Already true in code (keep it): a shortened match is FILED one level down at record time (Flick 1 goal,
Darts 101/201, Pool 1 rack, Dominoes 150, Chinchón short, Hoops "until you score", Cup Pong unlimited
reracks, Boggle 2-min timer). So every stored level already carries length; the tables below price the
STORED level and add a multiplier only for options that are not already folded in.

## 1. Win rates per level (all players; wins/played; people) + minutes + computer strength

Minutes = median gap between consecutive same-game, same-level results by one person (gaps > 20 min
dropped), play log since 2026-10-28. "est" = my estimate, no log data.

| Game | Level | Win rate | Min/game | Read of the computer |
|---|---|---|---|---|
| Tic Tac Toe | Easy | 365/403 = 91% (6) | 0.06 (4 s!) | wins if it can, blocks 60% of the time; NEAR-GUARANTEED |
| | Medium | 114/201 = 57% (11) | Classic 0.06, Ultimate 1.7 | Classic: win/block/center/corner, no fork defence: beaten every time by a fork (King 43/44 in the log, HDJ 52/56). Lili 0/31 (draws). Ultimate depth 3 is real (King 0/6) |
| | Hard | 0/52 = 0% (2) | | Classic = perfect minimax, UNWINNABLE by design; Ultimate = 380 ms alpha-beta |
| Connect Four | Easy | 113/134 = 84% (6) | est 1 | random, but takes wins and blocks |
| | Medium | 8/161 = 5% (13) | est 2 | depth-5 alpha-beta: GENUINELY HARD for this family |
| | Hard | 2/7 = 29% (2) | est 2 | depth 9 (sample too small; stronger than Medium in code) |
| | Expert | 2/26 = 8% (4) | est 2 | exact solver: hardest |
| Dots and Boxes | Easy | 14/17 = 82% (3) | est 0.5 | random after free boxes |
| | Medium | 21/59 = 36% (12) | est 0.5 | greedy, no double-cross |
| | Hard | 13/66 = 20% (3) | 0.51 (42 gaps) | double-cross + exact endgame: hard |
| Filler | Easy | 15/24 = 63% (5) | est 0.6 | random capturing colour |
| | Medium | 37/62 = 60% (10) | est 0.6 | best immediate capture |
| | Hard | 45/103 = 44% (3) | 0.62 (54) | 2-ply lookahead; MattyIce 21/34. Levels close together |
| Mancala | Easy | 19/30 = 63% (6) | est 1.5 | 40% random moves |
| | Medium | 5/11 = 45% (5) | est 1.5 | depth 5 |
| | Hard | 11/77 = 14% (2) | 1.70 (49) | iterative deepening to 13: GENUINELY HARD |
| Battleship | Easy | 11/11 = 100% (4) | est 2 | random + follow-up; NEAR-GUARANTEED |
| | Medium | 11/15 = 73% (5) | est 2 | hunt/target |
| | Hard | 5/5 = 100% (2) | 2.07 (2) | probability-density search; 5 games only, luck-heavy game |
| Boggle | Easy | 82/333 = 25% (5) | 1.53 (6) | finds 20% of the board's words (EN) |
| | Medium | 0/118 = 0% (9) | | 45% of words: nobody has ever won |
| | Hard | none played | | 70% |
| Monopoly Deal | Easy / Normal / Hard | 2/6 33%, 12/27 44%, 1/3 33% | est 10 | blunder-rate tiers; luck-heavy; thin |
| Chinchón | Easy / Normal / Hard | 2/5 40%, 9/26 35%, 0/1 | est 8 (one 1.8-min gap in the log) | blunder 40% / 15% / 0% |
| Cup Pong | Medium | 10/10 = 100% (3) | est 2.5 | aim noise 0.15/0.04 (CLAUDE.md make rates) |
| | Hard | 21/37 = 57% (3) | 2.52 (16) | aim noise 0.06/0.025 |
| | Online | 35/70 = 50% (5) | 4.13 (7) | |
| Darts | Easy | 15/19 = 79% (1) | est 3 | spread 0.36, aims bull |
| | Medium | 20/31 = 65% (4) | 2.20 (1) | spread 0.24 |
| | Hard | 322/537 = 60% (1: King only) | est 3 | spread 0.10. King alone; he is simply good at it |
| Dominoes | Easy / Medium / Hard | 4/4, 3/8 38%, 1/2 | est 5 | random / greedy / 1-ply + voids; thin |
| Pool | Easy / Medium / Hard | 2/2, 0/4, 1/6 17% | est 4 | physics, aim noise 0.016/0.0065/0.0025 |
| Escoba | Easy | 7/8 = 88% (4) | est 5 | uniform random move: near-guaranteed (card luck only) |
| | Normal | 45/80 = 56% (6) | | greedy + escoba risk |
| | Hard | 12/44 = 27% (2) | | card counting: hard (Lili 11/42) |
| Flick Soccer | Easy | 49/49 = 100% (2) | est 0.7 | 26 shots, big noise: NEAR-GUARANTEED (King 45/45) |
| | Medium | 12/33 = 36% (3) | 0.87 (6) | 80 shots |
| | Hard | 8/48 = 17% (2) | 1.05 (13) | 190 shots, tiny noise: GENUINELY HARD |
| Connect 4 Hoops | Easy / Medium / Hard | 7/9 78%, 1/3, 9/48 19% | Hard 1.21 (2) | shot accuracy; Hard King 9/33, MattyIce 0/15 |
| Parchís | Easy / Medium | 2/3, 5/14 36% | est 20 | thin |
| Uno | Easy / Medium / Hard | 1/3, 10/24 42%, 1/4 | est 5 | random / heuristic / Monte-Carlo; luck-heavy |
| Yahtzee | one level ("ai") | 64/106 = 60% (4) | est 8 | luck-heavy; no difficulty |
| Air Hockey | Easy / Medium / Hard | 2/2, 5/6 83%, 0/1 | Medium 1.93 (1) | speed limit + reaction delay; thin |

Online (all games): 50% by construction; samples: Hoops 136, Escoba 75, Cup Pong 70, Flick 50, Darts 34,
Dots 12, others under 10.

## 2. Proposed points per win (stored level; short matches already one level down)

| Game | Easy | Medium | Hard | Expert | Online | Option multipliers (new wins only; old = default) |
|---|---|---|---|---|---|---|
| Tic Tac Toe Classic | 0 | 1 | 5 (nominal; unwinnable) | | 3 | Ultimate replaces the row: 1 / 3 / 10 |
| Connect Four | 1 | 6 | 8 | 12 | 5 | none |
| Dots and Boxes | 1 | 3 | 5 | | 3 | Large board x2 (Small/Medium x1; default Medium) |
| Filler | 1 | 2 | 3 | | 2 | none |
| Mancala | 1 | 2 | 6 | | 3 | none |
| Battleship | 0 | 1 | 3 | | 3 | Quick board: count one level down (as other short matches) |
| Boggle | 2 | 6 | 10 | | 3 | timer already folded in (2 min = one level down) |
| Monopoly Deal | 1 | 2 | 3 | | 3 | legacy bucket 1 |
| Chinchón | 1 | 2 | 4 | | 3 | short already folded in; legacy 1 |
| Cup Pong | 0 | 1 | 3 | | 3 | 0 reracks x2 (default 2 reracks x1; unlimited already one level down) |
| Darts | 1 | 2 | 3 | | 3 | 301 / Cricket x1; Cricket in order x1; 101/201 already one level down |
| Dominoes | 1 | 2 | 3 | | 3 | 500 x2 (300 default x1; 150 already one level down) |
| Pool | 1 | 3 | 5 | | 3 | race to 3+ racks x2 (1 rack already one level down) |
| Escoba | 1 | 2 | 4 | | 2 | none |
| Flick Soccer | 0 | 3 | 6 | | 3 | 3 goals: Medium 4, Hard 9 (2 goals default x1; 1 goal already one level down) |
| Connect 4 Hoops | 1 | 3 | 5 | | 3 | one-shot = stored level (until-you-score already one level down) |
| Parchís | 1 | 2 | 4 | | 2 | none |
| Uno | 1 | 2 | 3 | | 2 | none |
| Yahtzee | 1 (single level) | | | | 1 | none |
| Air Hockey | 1 | 2 | 5 | | 3 | none |

Online win value: about a Medium-to-Hard win (50% by construction, against a real person, minutes long).
Never above the game's hardest level. Risk is two accounts feeding each
other; the online-pair alerts exist on branch `claude/online-pair-alerts` (commit c311dad, v1421) but are
NOT on main as of this read. Option to add: count at most N online wins per opponent per day.

## 3. Anti-farming options

- (a) Near-zero for near-guaranteed levels: a farmer's Easy wins add 0 (still wins in stats). Kills the
  TTT/Flick/Battleship/Cup Pong farm completely; does nothing for a 75-89% level (C4 Easy, Escoba Easy).
- (b) First N wins per level per day count: caps a farmer at N a day but still rewards daily grinding;
  NOT buildable from today's data (byDiff has no per-day split; the play log starts 10-28 and is
  admin-read), needs a new per-day counter, and old wins would be uncapped.
- (c) Cap on points from the easiest level (e.g. 20 per game, lifetime): a farmer's ceiling is fixed;
  read-time, works on all history today.
- RECOMMEND (a) + (c): 0 for the >=90% levels, and a 20-point lifetime cap on the easiest level in games
  where Easy is >=75% (Connect Four, Dots, Escoba, Darts, Hoops, Air Hockey, Dominoes, Pool, Battleship,
  Cup Pong, Flick, TTT). Not capped where Easy is genuinely contested (Boggle 25%, Chinchón, Monopoly Deal,
  Uno, Parchís, Filler, Mancala). Bound today only in Connect Four (King 85 Easy wins -> 20).

## 4. Projection (proposed table + (a)+(c)); TTT Ultimate wins assumed at Medium first, then Easy

| Game | Today top 3 | Proposed top 3 (points) |
|---|---|---|
| Battleship | King, TP, MattyIce | no change (9, 6, 5) |
| Boggle | Ele, Natalia, =3 King/TP | no change (146, 8, 4, 4) |
| Chinchón | Ele, Natalia, King | no change (10, 6, 4) |
| Hoops | King, MattyIce, Anita | no change (127, 111, 21) |
| Connect Four | King, MattyIce, Unai | no change (50, 42, 28) |
| Dots | King, MattyIce, HDJ | no change (42, 37, 24) |
| Escoba | Lili, MattyIce, Unai | Lili 116, Unai 52, Anita 31 (MattyIce out: 1 Hard win) |
| Filler | King, MattyIce, HDJ | MattyIce 88, King 73, Natalia 30 |
| Mancala | King, MattyIce, Begoña | no change (74, 17, 4) |
| Monopoly Deal | King, MattyIce, HDJ | MattyIce 16, HDJ 11, King 4 |
| Parchís | HDJ, =2 Begoña/Natalia | HDJ 6, =2 King/Begoña/Natalia 2 |
| Tic Tac Toe | King, HDJ, MattyIce | no change (63, 56, 15); TP's 193 Easy wins = 0 |
| Uno | King, Natalia, Lili | Natalia 10, Lili 6, King 4 |
| Dominoes | King, =2 Lili/Natalia/HDJ | King 5, Lili 3, =3 HDJ/Natalia 2 |
| Yahtzee | =1 Ele/King, Natalia | no change (29, 29, 5) |
| Air Hockey | =1 MattyIce/King, Anita | MattyIce 8, =2 King/Anita 5 |
| Cup Pong | King, Anita, MattyIce | no change (88, 64, 26) |
| Darts | King, Natalia, MattyIce | no change (1013, 36, 18) |
| Flick Soccer | MattyIce, King, Joe | King 75, MattyIce 72, Joe 9 (King's 45 Easy wins = 0; online wins decide it) |
| Pool | King, MattyIce, Anita | MattyIce 8, King 5, Anita 3 |

Golds (all 36 boards, only the 20 wins boards change): King of Games 20 -> 16, MattyIce 7 -> 9,
Natalia 0 -> 1, everyone else unchanged (Ele 3, Lili 2, Unai 2, HDJ 2, Anita 1, TP 1).

## 5. Guesses and thin data

- Minutes: measured only for TTT, Dots Hard, Filler Hard, Mancala Hard, Flick Medium/Hard, Cup Pong Hard,
  Boggle Easy (play log since 10-28, mostly one player). Every other figure is an estimate.
- Old wins have no variant/length: TTT Ultimate vs Classic is known only as totals (tt.*), not per level
  (assumed at Medium, then Easy). Everything else at the game's default (Flick 2 goals, Pool 1 rack,
  Dominoes 300, Cup Pong 2 reracks, Boggle 1.5 min, Dots Medium board, Battleship Classic, Darts as stored).
- Too thin to judge: Air Hockey, Pool, Dominoes, Uno, Parchís, Monopoly Deal, Chinchón Hard, Hoops Medium,
  Connect Four Hard, Battleship Hard, Boggle Hard (never played), Darts Easy/Hard (one player each).
- Win rates are dominated by King of Games where he plays most (Darts Hard, Flick Easy, Mancala Hard,
  TTT, Dots Hard); a level he finds easy may not be easy for others (Darts Hard).
- Connect Four Medium (5%) measured harder than Hard (29%, 7 games): priced by the code's order, not data.
