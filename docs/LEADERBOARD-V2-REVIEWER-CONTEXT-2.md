# Leaderboard review, round 2: what you need to know (read before the screenshots)

You are reviewing the new leaderboard (and the "My Stats" screen) of a private game app for one family and their
friends. Everything below is what an earlier reviewer had to ask about. It is given up front so the review can focus
on how well the screens work, not on guessing the rules.

## The app

- About 38 players, one family and friends. iPhone first. Dark mode is the default; light mode exists.
- The bottom bar belongs to the whole app, left to right: Games (the launcher), Multiplayer, Messages, Leaderboards
  (the trophy, lit on these screens), Profile (shows the player's chosen emoji).
- Screenshots use real data. They are taken as the player **"\*King of Games\*"** (a real player; asterisks are part
  of the name he chose). He is the "viewer": his name is in the accent colour and his row is highlighted.
- The new leaderboard is still a preview for the app's owner only. Players still see the old one until release.
  The small "Old" link at the bottom of the Games list opens the old leaderboard; it disappears at release.
- English and Spanish. A few screenshots are Spanish at a 360-pixel-wide phone (`es360-`), to check long words.

## Owner's settled rules (will not change; judge how well the screens communicate them)

1. **Interface redesign, not a stats redesign.** Every rank, number, tie and medal equals the old leaderboard, checked
   by an automated test. Three rules were changed on purpose by the owner since the last review (below).
2. **Difficulty outranks score.** On a game's "All" tab, players are grouped under thin difficulty dividers (◆◆ Expert,
   ◆ Hard, ■ Medium, ● Easy); within a group, the higher number wins. 2 Expert wins rank above 85 Easy wins.
3. **No-hint solves rank first** (Sudoku, Murdoku): anyone with a solve that used no hints ranks above anyone whose
   solves all used hints. Those rows carry a "No hints" pill.
4. **Never call the viewer "You."** Everyone, viewer included, is shown by profile name. The tab for your own records
   is "Me".
5. **Wins only.** No win %, no averages for ranking, no minimum number of games.
6. **No time windows** (this week / this month) on boards. The one exception is Arrow Maze **Rush**, which is the
   game's own weekly challenge mode (see below).
7. **Head-to-head records live in one place only**: the app's Multiplayer screen. Not on the leaderboard.
8. **Fewest words on screen.** No taglines or explanatory sentences; explanations go in the "?" sheet.
9. **Colorblind-safe** (the owner is red/green colorblind): each difficulty has a shape: Easy green circle, Medium
   blue square, Hard diamond, Expert two diamonds. In dark mode the Hard/Expert diamonds are black on a small white
   tile: the owner's choice.
10. **One gold medal per game** (40 golds across 34 games), from one standing per game. Ties share the medal ("=").
11. **Names and taglines are typed by the players** (asterisks, nicknames, the line under a name on a player page).

## Changed on purpose since the last review

- **Tic Tac Toe**: its gold medal and the game list's leader now follow the board's All tab (every win, hardest
  difficulty first). Before, the list counted the harder "Ultimate" variant first and named a different leader.
- **Two pairs of names were merged** into one person each by the owner (Bego into Begoña, Andrew Powell into Andrew P).
- **Contexto "Fewest guesses"** now counts only puzzles solved with no hints (a 1-guess solve after 8 hints showed as 1).

## How navigation works

- **Leaderboards** (trophy) opens on **Games**. The three top tabs are **Games**, **Hall of Fame**, **Me**.
  - **Games**: every game with its leader (gold medal + name) and the viewer's own place at the right (a medal for
    1st-3rd, "#5", or "=5" when tied). Filters: heart = favourites (number = how many), "Played N" (games the viewer
    has played), "All N" (all 34). Sort button (arrows icon): A to Z, My rank, Most played, Recent. The magnifier in
    the title row opens a search box.
  - **Tap a game** = its board. Top: game name, total plays, Play (opens the game), heart (favourite). Then that
    game's tabs (difficulties, "Online" = played against people, game-specific views), then the players. "Bests"
    (lifetime feats, all difficulties) appear at the bottom of All tabs only. A bar pinned at the bottom shows the
    viewer's own row, but only while his row is off screen.
  - **Tap a name on a board** = that player's stats **for that game** (the same layout as My Stats). "All games" at the
    bottom = that player's page (every game they played, their place and number in each). Tapping a game there =
    their stats for that game. The speech-bubble icon = send them a message. Tapping the viewer's own name on Hall of
    Fame goes to Me.
  - **Hall of Fame**: **Medals** (each person's gold / silver / bronze count across all games) and **Wins** (the old
    "By Player" list). Wins has a filter: Everything (wins in every competitive game), Easy / Medium / Hard / Expert
    (wins at that difficulty), vs people (wins in online games against people), No difficulty (runs in solo games that
    have no difficulty, e.g. Ball Run). And a sort: Wins, Played, Name.
  - **Me**: tiles (Records = games where the viewer holds 1st; Hall of Fame place; games played), "Records held",
    "Closest" (games where he is nearest a record: his number · the record, and who holds it), "Not played yet"
    with Play buttons.
  - **"?"** (title row) = "How rankings work".
- **My Stats** = Profile (bottom bar) > My Stats. The viewer's own numbers, read from his phone (so a new result shows
  at once). The leaderboard's numbers are built on the server every few minutes, so they can trail My Stats briefly.

## What the numbers mean (game by game)

- **Golf**: "3 under" = strokes under par for the best round. Lower is better.
- **Contexto** (guess the secret word): a medal per solved puzzle by hints used: gold 0 hints, silver 1, bronze 2,
  dark medal 3+. The board number "9 🥇" = 9 gold solves; the small medals under a name are the other kinds.
  **Daily** = only puzzles solved on their own day; **All** = every puzzle. "Fewest guesses" = fewest typed guesses
  on a no-hint solve.
- **Skeeball**: several machines (a picker). "Total" = all points ever scored; "Best game" = best single game.
  "Balls in 100" = balls that landed in the 100 hole.
- **Spelling Bee**: one puzzle a day. The number is days the player reached "Genius".
- **Arrow Maze**: **Levels** = points from levels cleared (harder levels give more points). **Rush** = how many arrows
  you clear in one timed run, per week, Easy or Hard. "This week" = this week's best runs. "Weeks won" = weeks won,
  "of N" = weeks they played. "Past weeks" = each finished week's winner and score.
- **Hold'em**: Bankroll = chips held.
- **Minesweeper**: best time on the hardest level solved.
- "N played" under a name = lifetime plays of that game.

## Already decided: please do not re-raise

Win %, averages or minimums; time windows; head-to-head on the leaderboard; calling the viewer "You"; the "Old" link;
players' chosen names and taglines; the white tile behind dark-mode diamonds; the "Hall of Fame" name; one gold per
game; Bests showing on All tabs only.

## Screenshots: how to reach each one

Prefix: `en-` dark mode, `light-` light mode, `es360-` Spanish on a 360-wide phone. Light and Spanish are a subset;
the number matches the dark one.

| # | Screen | Taps from the Leaderboards tab |
|---|---|---|
| 01 | Games list | Games > "All 34" filter |
| 02 | Games search | Games > magnifier > type "co" |
| 03 | Darts board, All | Games > Darts |
| 04 | Connect 4 board, All | Games > Connect 4 |
| 05 | Connect 4, bottom of All (Bests) | Games > Connect 4 > scroll to the end |
| 06 | Connect 4, Hard tab | Games > Connect 4 > Hard |
| 07 | Minesweeper, All | Games > Minesweeper |
| 08 | Sudoku, All ("No hints" pills) | Games > Sudoku |
| 09 | Golf | Games > Golf |
| 10 | Tic Tac Toe, All | Games > Tic Tac Toe |
| 11 | Contexto, All (medal key on top) | Games > Contexto |
| 12 | Contexto, Daily | Games > Contexto > Daily |
| 13 | Skeeball | Games > Skeeball |
| 14 | Spelling Bee | Games > Spelling Bee |
| 15 | Arrow Maze, Levels | Games > Arrow Maze |
| 16 | 1st place in Arrow Maze: their Arrow Maze stats | Games > Arrow Maze > tap the 1st name |
| 17 | Arrow Maze Rush, This week (Easy) | Games > Arrow Maze > Rush |
| 18 | Rush, Weeks won | ... > Rush > Weeks won |
| 19 | Rush, Past weeks | ... > Rush > Past weeks |
| 20 | 2nd place in Contexto: their Contexto stats | Games > Contexto > tap the 2nd name |
| 21 | That player's page (every game) | ... (20) > All games |
| 22 | Their stats in their most-played game | ... (21) > tap the first game |
| 23 | 1st place in Skeeball: their Skeeball stats | Games > Skeeball > tap the 1st name |
| 24 | Hall of Fame, Medals | Hall of Fame > Medals |
| 25 | Hall of Fame, Wins (Everything, by Wins) | Hall of Fame > Wins |
| 26 | Wins filtered to Hard | Hall of Fame > Wins > filter: Hard |
| 27 | Wins, No difficulty, sorted by Played | Hall of Fame > Wins > filter: No difficulty > sort: Played |
| 28 | Me | Me |
| 29 | Me, Closest | Me > scroll to "Closest" |
| 30 | Me, Not played yet | Me > scroll to the end |
| 31 | How rankings work | "?" in the title row |
| 32 | My Stats | Profile > My Stats |
| 33 | My Stats, Contexto | Profile > My Stats > Contexto |
| 34 | My Stats, Skeeball | Profile > My Stats > Skeeball |
| 35 | My Stats, Tic Tac Toe | Profile > My Stats > Tic Tac Toe |

Note: in the screenshots, My Stats shows King of Games' numbers as of the same moment as the leaderboard.
