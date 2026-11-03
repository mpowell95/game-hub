# Points for Sudoku, Murdoku, Nuts & Bolts, Minesweeper: proposal (2026-11-03)

**Written by a session, not by Matt.** Matt: "yes of course you should do this. You should propose point systems for
each of those games. And tell me all the stats you have on them, and the leaderboard as it currently stands and if we
changed them to a point system". NOTHING here is decided or cleared for players. Data: read-only snapshot of
`boards/v1/lb/z` taken 2026-11-03 ~9:47 PM Eastern, run through the app's own `lb2Tabs` / `lb2Board` / `lb2Standing`
(player and admin boards identical for these games). Points are read-time only: no stored number or key changes.
Each projected total was re-checked by hand from the per-level counts below.

## Sudoku

Stored: byDiff won per level (since 2026-09-12); lifetime `sd.solved`, `perfect`, `hints`, `mistakes`; best time per
level; since 2026-10-29 `sd.clean[tier]` + `sd.pre` (clean vs not per level). NOT stored: hints or mistakes per solve
or per level. So points can only tell clean from not clean.

| Now | Player | Shown | Medal | Solves | Clean |
|---|---|---|---|---|---|
| 1 | Anita Bonita | 2 no hints | gold | Medium 2 | 2 |
| 2 | King of Games | 1 | silver | Easy 1, Expert 1 | 0 |
| 3 | Natalia | 1 | bronze | Medium 1 | 0 |

Proposal: clean Easy 1, Medium 2, Hard 4, Expert 8; any hint or mistake (or unproven legacy) half, min 1: 1, 1, 2, 4.
Evidence: only 5 solves exist, so weights follow the generator's grading (Expert 22-26 givens vs Hard 27-31).

| New | Player | Points | Medal |
|---|---|---|---|
| 1 | King of Games | 5 | silver to gold |
| 2 | Anita Bonita | 4 | gold to silver |
| 3 | Natalia | 1 | bronze |

## Murdoku

Stored: byDiff per level (since 2026-09-29); since 2026-10-29 `mu.clean[tier]`, `mu.hinted[tier]` (a wrong full check
= a hint), lifetime `mu.hints`; times only since 2026-11-02. Solves before 10-29 are in neither count ("unknown").

| Now | Player | Shown | Medal | Easy | Medium | Expert | Clean / hinted / unknown |
|---|---|---|---|---|---|---|---|
| 1 | King of Games | 1 no hints | gold | 6 | 0 | 3 | 1 / 1 / 7 |
| 2 | Natalia | 3 no hints | silver | 18 | 43 | 0 | 3 / 10 / 48 |
| 3 | Ele | 1 | bronze | 4 | 1 | 0 | 0 / 0 / 5 |
| 4 | MattyIce | 4 | none | 4 | 0 | 0 | 0 / 0 / 4 |

Proposal: Sudoku's table; hinted and unknown both pay half. Evidence: boards 5x5 to 8x8, solver depth 1/2/3/3.

| New | Player | Points | Medal |
|---|---|---|---|
| 1 | Natalia | 64 | silver to gold |
| 2 | King of Games | 22 | gold to silver |
| 3 | Ele | 5 | bronze |
| 4 | MattyIce | 4 | none |

**Conflict with Matt's 2026-10-29 rule** ("every no-hint solve ranks above every hint solve"): plain points break it
in both games. Keeping it = rank by clean points first, then all points; both boards then stay exactly as now.

## Nuts & Bolts

Stored: byDiff per level (easy, medium, hard, extrahard), each level counted once per person (`dedupeNutsBolts`);
lifetime `nb.solved`, `nb.moves`; best level. Older wins with no level: MattyIce 30, Begoña 42. No hints exist.

| Now | Player | Shown | Medal | Easy | Medium | Hard | Expert | No level |
|---|---|---|---|---|---|---|---|---|
| 1 | Unai | 354 | gold | 20 | 44 | 30 | 354 | 0 |
| 2 | Lili | 218 | silver | 51 | 0 | 15 | 218 | 0 |
| 3 | MattyIce | 3 | bronze | 0 | 2 | 6 | 3 | 30 |
| 4 | King of Games | 1 | | 0 | 0 | 1 | 1 | 0 |
| =5 | Natalia | 3 | | 24 | 5 | 3 | 0 | 0 |
| =5 | Begoña | 3 | | 0 | 2 | 3 | 0 | 42 |
| 7 | TP | 1 | | 21 | 0 | 1 | 0 | 0 |
| 8 | Brian Spalding | 2 | | 0 | 2 | 0 | 0 | 0 |
| 9 | Anita Bonita | 1 | | 0 | 1 | 0 | 0 | 0 |
| 10 | HDJ, Inc. | 18 | | 18 | 0 | 0 | 0 | 0 |
| 11 | Ele | 12 | | 12 | 0 | 0 | 0 | 0 |
| 12 | Liz | 3 | | 3 | 0 | 0 | 0 | 0 |

Proposal: each level solved Easy 1, Medium 2, Hard 3, Expert 4; a no-level win 1. Evidence: moves per solve about
1 : 2 : 3 : 4 (generator scramble 24, 48, 64, 80).

| New | Player | Points | Now |
|---|---|---|---|
| 1 | Unai | 1,614 | 1 |
| 2 | Lili | 968 | 2 |
| 3 | MattyIce | 64 | 3 |
| 4 | Begoña | 55 | =5 |
| 5 | Natalia | 43 | =5 |
| 6 | TP | 24 | 7 |
| 7 | HDJ, Inc. | 18 | 10 |
| 8 | Ele | 12 | 11 |
| 9 | King of Games | 7 | 4 |
| 10 | Brian Spalding | 4 | 8 |
| 11 | Liz | 3 | 12 |
| 12 | Anita Bonita | 2 | 9 |

Medals unchanged.

## Minesweeper

Stored: byDiff played/won/lost per level (since 2026-09-21); best time per level (wins); `ms.bestClearedPct[tier]` and
`ms.lossBy` since 2026-10-15. No hints exist. Every board is new, so every clear counts.

| Now | Player | Shown | Medal | Easy | Medium | Hard | Expert (best %) |
|---|---|---|---|---|---|---|---|
| 1 | Unai | 5:22 Expert | gold | 0/0 | 0/0 | 1/3 | 1/48 (100) |
| 2 | MattyIce | 4:28 Hard | silver | 4/8 | 2/13 | 3/35 | 0/28 (85) |
| 3 | Anita Bonita | 7:00 Hard | bronze | 3/21 | 28/259 | 1/67 | 0/86 (97) |
| 4 | Lili | 2:02 Medium | | 2/3 | 3/227 | 0/0 | 0/0 |
| 5 | King of Games | 1:12 Easy | | 1/7 | 0/0 | 0/0 | 0/17 (62) |
| 6 | Natalia | none | | 0/12 | 0/0 | 0/0 | 0/0 |

Cells = won/played. Everyone's win rate: Easy 19.6%, Medium 6.6%, Hard 4.8%, Expert 0.6%.

Proposal: per clear Easy 1, Medium 3, Hard 8, Expert 20 (boards per clear in real play 1 : 3 : 4 : 35; best time /
perfect-play win rate 1 : 3.4 : 12.5 : 27). Losses cost nothing; best % orders players on 0 points.
Arrow Maze's 1, 2, 4, 8 gives the same medals.

| New | Player | 1/3/8/20 | 1/2/4/8 | Medal |
|---|---|---|---|---|
| 1 | Anita Bonita | 95 | 63 | bronze to gold |
| 2 | MattyIce | 34 | 20 | silver |
| 3 | Unai | 28 | 12 | gold to bronze |
| 4 | Lili | 11 | 8 | |
| 5 | King of Games | 1 | 1 | |
| 6 | Natalia | 0 | 0 | |

## Other boards without points (no proposal yet)

Ball Run, Hill Climb, Snake, Brick Breaker: runs and best score per level exist (every run counts as a win, so points
would reward volume unless tied to the best score). Contexto: no levels, but each solve's gold/silver/bronze (0/1/2
hints) is stored, so points per medal fit. Hold'em: wins per computer level + online, its Wins tab could take points.
Tower: nothing uploaded yet (admin-only). Golf, Skeeball: no levels. Spelling Bee: already points.
