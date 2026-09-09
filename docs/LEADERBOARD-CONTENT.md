# Game Hub Leaderboard — what it displays

A statement of facts only: what information exists on the leaderboard today. No layout, styling,
or interaction guidance.

## The app

The Game Hub is a phone-first web app that hosts 24 small games for one family, with a shared
player profile and a synced record of every game anyone plays on any of their devices.

## The leaderboard has two views

**By Player** ranks people against each other across all games at once.

**By Game** lists every game with the person currently leading it.

## By Player shows, per person

- Rank number (people who tie share a rank)
- Name and emoji avatar, with a "You" marker on the viewer's own row
- One number: their wins in the selected category, or their total games played
- A breakdown of their wins across all six categories

Sorts: Wins, Games Played, Name.
Category filter: Everything, Easy, Medium, Hard, Expert, No tier, Versus.

## By Game shows, per game

- Game name and artwork
- The leading player's name, avatar, and difficulty tier
- That leader's number, and what the number counts
- Whether the game is one of the viewer's favorites

Sorts: A to Z, Most played, Favorites. A game nobody has played says so and has no leader.

## A game's own board (opened from By Game)

Header: the game's name and how many games everyone has played of it.

Per row: rank, name, avatar, the difficulty tier that player is ranked at, their games played, and
the game's own number.

Ranking: difficulty tier first, score second. A higher score at a lower difficulty never outranks
a lower score at a higher one.

Sorts: the game's own number, Games Played, Name.
Difficulty filter: only tiers somebody has actually played.

Below the rows, "Standing records": all-time bests for that game, each with the holder's name.
They differ per game — Snake has longest snake and total runs; Boggle has best score, words found
and longest word; Skeeball has best game, best throw, 100 cups hit and points all time; Chinchón
has chinchóns, closes and minus tens.

## A player's own page (opened from either view)

Their name, avatar, total games played, their six-category breakdown, a button to send them a
message, and a list of every game they have played with their number in each. Opening one of those
games shows their full record for it, including a win / loss / draw table broken down by difficulty.

## Difficulty

Four tiers, in order: **Easy, Medium, Hard, Expert.** Each game's own difficulty words map onto
them — a game whose levels are called Beginner / Intermediate / Pro is Easy / Medium / Hard.

Games with no difficulty at all: Skeeball, Golf, Yahtzee.

Online matches against real people carry no difficulty tier and count as **Versus**. Plays recorded
before a game had difficulty carry no tier either and count as **No tier**.

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

Golf's number is a score against par: it is the only number where lower is better, and it can be
negative or zero.

## Games with more than one machine, map, mode or course

- **Skeeball** — five machines: THE CLASSIC, HOT SHOT, HOT SHOT: BRICK CITY, HOT SHOT: RUNAWAY,
  POPONGO. The board can be filtered to one machine, and plays, points and records are all held per
  machine.
- **Snake** — two modes: Walls off and Walls on. Both numbers are shown for every player.
- **Tic Tac Toe** — two variants: Classic and Ultimate. Both numbers are shown for every player.
- **Ball Run** — two maps: Classic and Orbital. They share one combined number.
- **Hill Climb** — four stages: Countryside, Desert, Arctic, Moon. The stages are its difficulty,
  in that order.
- **Pinball** — three table settings: Casual, Standard, Tournament. They are its difficulty, in
  that order.
- **Golf** — several courses at 3, 9 or 18 holes. The board ranks one course.

## Also true

- Everyone with any recorded play appears. Nobody is ever dropped for how they played.
- One person can play on several phones; their devices are merged into one row.
- Every number is a lifetime total or a personal best, so nothing on the leaderboard goes down.
- Two languages: English and Spanish.
- Pinball is currently visible to the admin only; every other game listed here is live for everyone.
