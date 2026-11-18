# Online leaderboard: plan (2026-11-18)

Matt, 2026-11-18: "We should create a leaderboard that is focused on multiplayer. And once it's fully up and
running we should make it the default." Goal: get Moonis challenging the Spain players, Spanish players playing
each other, and strangers challenging each other.

**Status: MOCKUP ONLY** (`docs/mockups/online-board/online-board.html`). Nothing built. Players see nothing until
Matt says "release it". Every number in the mockup is real data (2026-11-18 snapshot, read only); viewer shown
= *King of Games* (the lb2-shots viewer).

## The board

- New first tab in Leaderboard v2: **Online | Games | Medal Count | Me**. Admin devices first; becomes the tab
  the Leaderboard opens on when Matt releases it.
- Two views: **All time** and **this month** (resets each month at the player's local midnight; history kept).
- **Points: a win = 1, each different person played = 5.** Playing many people beats farming one person.
  All time: each person ever. This month: each person played this month.
- Each row: name, flag, "8 people · 88 wins", points, and a challenge button. On a person the viewer has never
  played, the button is yellow with **+5**. Tap = their name and the challenge games; tap a game = that game's
  challenge screen with them picked (the existing `armChallenge`).
- **"Not played online yet"**: every person who may play online but never has, with a challenge button.
- **USA vs España strip**: wins in games between a US phone and a Spain phone. Country = the phone's time zone
  (`players/<id>/device.tz`: `America/*` = USA, `Europe/Madrid` = España); no time zone = no flag, not counted.

## Real numbers (2026-11-18)

All time: MattyIce 128 (8 people, 88 wins), Anita Bonita 112 (7, 77), *King of Games* 77 (2, 67), Lili 36,
Unai 18, Natalia 15, Liz 14, Joe 11, Brian Spalding 11, Ele 10. USA 17, España 18 (35 games between them).
*King of Games* has played only MattyIce and Anita Bonita: 7 people on the board are +5 each for him.
Lili and Unai have played no online game in the last 30 days.

## How it would be built (when Matt says "build it")

- **Server-built**, like `boards/v1/lb/z`: a new `boards/v1/online` package rebuilt in the existing board
  rebuild (`functions/boards.js`), from the same reader the online-pairs check uses (`js/integrity.js`
  `onlinePairs`: challenge indexes + live-room `h2h`, by player code). Phones download one small package,
  never `players/` (root CLAUDE.md, "Performance").
- **Gap: live-room games keep no date per opponent.** `h2h` has opponent but no time; the play log has time
  but no opponent. Monthly numbers would count challenges only until live rooms also note the opponent's
  code with the result (an additive field on the play log entry, from the day it ships; older live games
  count in All time only).
- Read only. Nothing about a stored record changes (THE LAW). Recording unchanged.
- Head-to-head stays on the Multiplayer screen's Records (Matt, 2026-10-18): this board shows each person's
  own totals, never one person's record against another.

## Open questions for Matt

1. Points: win 1, each different person 5. Right numbers?
2. "This month" or "This week"?
3. USA vs España strip: keep?
4. Does #1 of the month earn a medal on Medal Count?
