# Game Hub Leaderboard — what it displays

A statement of facts only: what information exists on the leaderboard today. No layout, styling,
or interaction guidance.

Written structurally on purpose: it names rules and games, never counts, so that adding a game
cannot silently make it wrong.

## The app

The Game Hub is a phone-first web app that hosts a couple of dozen small games for one family, with
a shared player profile and a synced record of every game anyone plays on any of their devices.

## The leaderboard has two views

**By Player** ranks people against each other across all games at once.

**By Game** lists every game with the person currently leading it.

## By Player shows, per person

- Rank number (people who tie share a rank)
- Name and emoji avatar, with a "You" marker on the viewer's own row
- One number: their total in the selected category, or their total games played. It is labelled
  "wins" in the four difficulties and in Everything, "runs" in No tier, and "vs wins" in Versus
- A breakdown by category — only as many as fit the line, chosen biggest-first with the selected
  one always kept, and then shown in difficulty order. Their own page shows all six

Sorts: Wins, Played, Name.
Category filter: Everything, Easy, Medium, Hard, Expert, No tier, Versus.

## By Game shows, per game

- Game name and artwork
- The leading player's name, avatar, and difficulty tier
- That leader's number, and what the number counts
- Whether the game is one of the viewer's favorites

Sorts: A to Z, Most played, Favorites. A game nobody has played says so and has no leader.

## A game's own board (opened from By Game)

Header: the game's name and how many games everyone has played of it.

Per row: rank (ties share a rank), name, avatar, the difficulty tier that player is ranked at,
their games played, and the game's own number.

Under that, on most games, a breakdown: one tile per difficulty the field has played, holding that
player's number at that difficulty, with an em dash where they have none — and, once anyone has
played the game against real people, a VS tile holding that player's wins against real people in it.

**Some games have no tiles, for two different reasons.** Skeeball, Pinball and Golf because their
number cannot be split by difficulty. Tic Tac Toe and Snake because their rows are a different shape
entirely: two numbers side by side (Ultimate and Classic, Walls off and Walls on) and no tiles of any
kind — so Tic Tac Toe shows no VS tile even though it is played against other people.

Ranking: difficulty tier first, score second. A higher score at a lower difficulty never outranks
a lower score at a higher one.

Sorts: the game's own number (named after it — Wins, Obstacles, Longest, Solved, Distance, Points,
Best round), Games, Name. Skeeball has one more, High score.
Difficulty filter: only tiers somebody has actually played. Skeeball has a machine filter in its
place, and only once the field has played more than one machine. The games with no difficulty have
neither.

Below the rows, "Standing records": all-time bests and totals for that game, each with the holder's
name. They are different facts per game — Snake has longest snake and total runs; Boggle has best
score, words found and longest word; Skeeball has best game, best throw, 100 cups hit and points all
time; Chinchón has chinchóns, closes and minus tens.

The games with standing records are Connect 4, Chinchón, Escoba, Nuts & Bolts, Ball Run, Dots and
Boxes, Boggle, Snake, Hill Climb, Skeeball and Tic Tac Toe. Elsewhere the section is simply absent —
as it is on those games too, until somebody has a non-zero value for at least one of their records.

## A player's own page (opened from either view)

Their name, avatar, total games played, total wins, their tagline if they have written one, a
button to message them, all six categories with zeros included — the four difficulties under "Wins
by difficulty", then No tier and Versus under "Everything else", labelled "Runs, no difficulty" and
"Wins against people" — and a list of every game they have played with their number in each.
Opening one of those games shows a screen built for that game specifically: a win / loss record by
difficulty for the games with an opponent, and bests and lifetime counters for the ones without.

(The message button is absent on the viewer's own row, and on old records that predate player
codes.)

## Difficulty

Four tiers, in order: **Easy, Medium, Hard, Expert.** Each game's own difficulty words map onto
them — a game whose levels are called Beginner / Intermediate / Pro is Easy / Medium / Hard.

Games with no difficulty at all: Skeeball, Golf, Yahtzee. (Yahtzee still separates playing a
person from playing the computer — the computer games are No tier.)

Online matches against real people carry no difficulty tier and count as **Versus**: Chinchón,
Escoba, Tic Tac Toe, Mancala, Filler, Dots and Boxes, Pool, Boggle, Yahtzee and Battleship.
(Chinchón matches played before 2026-09-09 are the exception: they were filed under a difficulty
and stay there.)

Plays recorded before a game had difficulty carry no tier either and count as **No tier**.

## Every game's number is a different thing

| Number | Games |
|---|---|
| Wins | Connect 4, Tic Tac Toe, Chinchón, Escoba, Dominoes, Uno, Filler, Mancala, Dots and Boxes, Boggle, Battleship, Yahtzee, Pool, Monopoly Deal, Parchís |
| Obstacles | Ball Run |
| Longest | Snake |
| Solved | Nuts & Bolts, Pipes |
| Meters | Hill Climb |
| Points | Skeeball, Pinball |
| Best round | Golf |

Golf's number is a score against par: it is the only number where lower is better, it can be
negative, and level par reads as "E" rather than 0.

## Games with more than one machine, map, mode or course

- **Skeeball** — machines: THE CLASSIC, HOT SHOT, HOT SHOT: BRICK CITY, HOT SHOT: RUNAWAY, POPONGO.
  The board can be filtered to one machine, and plays, points, best game and best throw are all held
  per machine. "100 cups hit" is not: it is a lifetime total across every machine, and it drops out
  of the standing records entirely while a machine is selected.
- **Snake** — two modes: Walls off and Walls on. Both numbers are shown for every player.
- **Tic Tac Toe** — two variants: Classic and Ultimate. Both numbers are shown for every player.
- **Ball Run** — two maps: Classic and Orbital. They share one combined number.
- **Hill Climb** — stages, in this order: Countryside, Desert, Arctic, Moon. The stages are its
  difficulty.
- **Pinball** — table settings, in this order: Casual, Standard, Tournament. They are its
  difficulty. It is the one game with a difficulty but no per-difficulty score, so its number is one
  lifetime total.
- **Golf** — three courses. Pine Valley and Red Mesa have eighteen holes each, playable as
  three-hole sets, nines, or the full eighteen. Oasis Sands has nine, so it offers three-hole sets
  and one nine, and no eighteen. The board ranks one of those rounds only — Pine Valley's first
  three holes.

## Also true

- Everyone with any recorded play appears. Nobody is ever dropped for how they played.
- One person can play on several phones; their devices are merged into one row.
- Test and development accounts, and players who never chose a name, never appear at all.
- Every number is a lifetime total or a personal best, so it only ever improves. For all but one
  that means going up; Golf's is a score against par, so it improves downward. The one way a number
  falls is the admin voiding a player's scores on one Skeeball machine, which removes them from
  display without touching the stored record.
- **Two languages: English and Spanish**, and the Spanish label is usually the longer of the two.
- **The person this is mainly for is red/green colourblind.** Anything the leaderboard distinguishes
  by colour is also distinguished some other way — a shape, a word, a mark — never by hue alone.
- **An admin-only game is nowhere on the leaderboard** — no By Game row, no board of its own — just
  as it is nowhere on the launcher. Today those games are Pinball, Pipes and Pool. It is one switch
  inside the app, so any game can be hidden or released with no code change.
- **A retired game is off the board the same way**, and for the same reason: there is no longer a
  card to tap.
- **Hiding a game hides the board's row, never anybody's history.** Whether it is admin-only or
  retired, everyone who played it still sees their own record of it on their player page, and their
  wins on it still count in every cross-game total. Release it again and its row returns whole.
