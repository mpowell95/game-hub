# Audit: King of Games, every game since Oct 28 (2026-11-24)

Written by a session, not by Matt. Matt's words for what is cleared: "Option A, of course. No, don't void anything
yet until we've checked all his games since Oct 28" and "We MUST be able to identify and void games and rounds where
he cheated." **Nothing has been voided.** This report is the check Matt asked for before any void.

## What was checked

- Every result King of Games logged since Oct 28, 2026 (the play log's first day), under his code 3VN33 and his two
  other codes: CRK7E ("El Fantasma", Nov 17) and Y4FGD (a second iPhone, Nov 17). 5,260 result entries (Hold'em hands,
  hints, and purchases included) in 36 games.
- Every other player's results too: 8,479 results in all, replayed through the same rules.
- Snapshot: read on Nov 24, 2026, with the reader key. Nothing was written to the database.
- Times are US Eastern.

## The rules (trip wires)

All live in `js/integrity.js` `checkPlayInput`. The server judges each new play the moment it lands. PROVEN means
no person can do it through the game's own screen: Option A voids it. Suspicious means an alert with a Void button.

| Rule | Game | Kind | Why |
|---|---|---|---|
| input-made-by-code | every game | PROVEN | a touch or key press made by a script; the hub's own code makes none |
| no-real-touch | every game | suspicious | a result with no touch or key press at all since the last one |
| snake-turns-without-input | Snake | PROVEN | every turn passes through a tap, swipe, or key that counts itself first |
| ballrun-score-without-touch | Ball Run | suspicious | 30+ obstacles with under 10 touches |
| tower-blocks-without-taps | Tower Stack | PROVEN | one press drops one block; nothing drops on its own |
| tower-more-blocks-than-drops | Tower Stack | PROVEN | the run's own drop list is shorter than its score |
| tower-machine-precision | Tower Stack | suspicious | 20+ perfect drops averaging under 0.6 units off centre |
| arrowmaze-machine-taps | Arrow Maze | suspicious | 15+ arrows cleared with taps under 120 ms apart (middle value) |
| hillclimb-more-cans-than-road | Hill Climb | PROVEN | the road holds at most one fuel can per 50 m |
| hillclimb-fuel-from-nowhere | Hill Climb | PROVEN | the car burns at least 2.8 fuel a second; a run cannot outlast its fuel |
| gridlock-under-fewest | Gridlock | PROVEN | each level's fewest moves is computed by the game itself |
| wordladder-under-par | Word Ladder | PROVEN | par is the shortest ladder (`word-ladder/js/data-test.js` checks every one) |
| wordladder-bad-step | Word Ladder | PROVEN | a step must change exactly one letter |
| yahtzee-held-die-changed | Yahtzee | PROVEN | a held die keeps its value through the roll |
| yahtzee-four-rolls | Yahtzee | PROVEN | 3 rolls a turn, at most |
| dotsboxes-too-many-boxes | Dots and Boxes | PROVEN | both sides' boxes cannot pass the board's |
| filler-too-many-cells | Filler | PROVEN | both sides' squares cannot pass the board's |
| hoops-more-made-than-shot | Connect 4 Hoops | PROVEN | a basket needs a shot |
| cuppong-more-made-than-thrown | Cup Pong | PROVEN | a cup needs a throw |
| cuppong-solo-under-10 | Cup Pong | PROVEN | a 10-cup rack needs 10 throws |
| airhockey-goals-over-target | Air Hockey | PROVEN | the game ends at its target |
| golf-hole-in-zero | Golf | PROVEN | a hole needs a stroke |
| battleship-impossible-shots | Battleship | PROVEN | hits cannot pass shots; a win needs 17 hits |
| boggle-word-not-on-board | Boggle | PROVEN | every word must trace on the board, each die once |

These sit beside the older checks: the record checks (`RULES`, e.g. a snake longer than the board), the online
match checks (Darts, Cup Pong, Battleship, Hoops), Contexto's checks, and Spelling Bee's fair-play flags.

**Replay over every real play (8,479 results, every player):** 2 hits, both PROVEN, both King of Games' Snake 62s.
No other player tripped any rule.

## Proven cheating

### Snake: 2 runs, PROVEN

| When | Device | Score | Turns | Taps, swipes, and keys |
|---|---|---|---|---|
| Nov 17, 11:25 AM | iPhone, Safari tab | 62 | 223 | 1 |
| Nov 17, 1:47 PM | same tab | 62 | 242 | 1 |

- His other runs that morning, on his computer, match their inputs: 49 (253 turns, 259 keys), 45 (224, 228), 31,
  and 36.
- The two 62s turned on 158 and 165 moves that came 1 or 2 steps apart (85 ms a step), and grew to 62 in 44 and
  49 seconds.
- MattyIce had scored 61 the evening before (Nov 16, 6:49 PM). 62 took first place by 1.
- Both play-log keys: `playLog/3VN33/1794932722271-0` and `1794941242820-0`.

## Suspicious, not proven

### Ball Run: the 200 (Nov 17, 1:27 AM)

- MattyIce scored 199 (Orbital Hard) on Nov 16 at 3:52 PM. Every player's Hard board shows the best of both tracks.
- From 3:57 PM he ran 11 Classic Hard runs on his computer in about a minute, most scoring 0 to 3.
- 12:35 to 1:20 AM: 8 runs as "El Fantasma" (code CRK7E) in a Safari tab, with a 34-minute gap. None crashed under
  10 (his own record: 21 of 67 runs under 10).
- 1:25 AM: a second iPhone (414x896 screen) signed in as King of Games. Runs: 0, 140, then 200. That phone never
  played again. His best before was 182 (Nov 15).
- **What the data cannot show:** Ball Run saved no touches before Nov 24, so the run cannot be checked the way Snake
  can. From Nov 24 every run carries its touches.

### Hill Climb: the Nov 19 runs

- His best before Nov 19 was 729 m (Oct 29). Everyone else's best is 1,191 m (sk).
- Nov 19, 2:14 PM to 3:11 PM: 3,308 m, 2,663 m, 1,934 m, 1,516 m, and 1,462 m on Countryside, and 2,229 m on the Moon.
- Every run passes both physics checks: no more fuel cans than the road holds, and enough fuel for its length.
  Speeds (16 to 23 m/s) match his own and others' short runs.
- **What the data cannot show:** no touch data before Nov 24, so a script holding the throttle would look the same
  as a person. The jump is suspicious; nothing in the data proves it.

### Contexto: puzzle en-55 (Nov 21)

- The server alert `contexto-solved-elsewhere` fired at 4:57 PM: a win logged after a give-up.
- The recorded result is a **loss** (3 hints, then give up, 124 guesses). Nothing on any board came from it.
- Earlier that day, 10:17 to 10:21 AM, the game was hidden and shown again 8 times in 4 minutes, as when switching
  to another app. Not proof of anything.

### Spelling Bee

- Puzzle e-abcdhu: flagged Oct 28, 2:21 PM ("Sorted run 7, Burst 16 at 4.0 s, Back+5 in 60 s, Genius in 7.6 min"),
  re-checked Nov 14 and **voided** by the existing fair-play rules (already in force before this audit).
- Puzzles g-ailnvz ("Back+6 in 60 s, Re-typed 2") and g-bhimnu ("Best 6 first"): flagged, not voided.

## Every game he played since Oct 28

"Data" says what the play log holds. Input counts (`i`) and every touch exist only from Nov 24, so no game below has
them yet; private play data (`x`) exists from Nov 16.

| Game | Results | Checked by | Verdict | What the data cannot show |
|---|---|---|---|---|
| Snake | 32 (7 with turns) | snake-turns-without-input, snake-longer-than-board | **2 PROVEN (above)** | runs before Nov 16 have no turn data |
| Ball Run | 77 + 8 (El Fantasma) | score records | suspicious (above) | no touches before Nov 24 |
| Hill Climb | 44 (41 with run data) | both fuel rules | suspicious jump, physics clean | no touches |
| Tower Stack | 406 (79 with drops) | drops, precision | clean: his drops average 3.5 to 4.3 units off centre, like Joe's and Matt's | no taps before Nov 24 |
| Arrow Maze | 296 levels + 18 Rush (102 with taps) | tap pace | clean: taps 316 to 517 ms apart (Natalia 365 to 485) | levels before Nov 16 have no taps |
| Gridlock | 77 (77 with fewest) | gridlock-under-fewest | clean | |
| Word Ladder | 52 + 2 daily | under par, bad step | clean | |
| Word Weaver | 173 + 14 daily | none new | no rule fires | found words are not re-checked against the puzzle |
| Contexto | 26 | Contexto checks | 1 alert (above), recorded as a loss | |
| Spelling Bee | 36 days, 22 Genius | fair-play flags | 1 voided day, 2 flags (above) | |
| Air Hockey | 66 | goals over target, record checks | clean: 57 of 57 Medium wins, 2 of 9 Hard | a scripted paddle would look the same |
| Flick Soccer | 416 | none new | no rule fires; wins 94% Easy, 20% Medium, 0% Hard (others 80%, 20%, 26%) | |
| Dots and Boxes | 305 (71 with board size) | too many boxes, chain check | clean | |
| Filler | 102 (13 with board) | too many squares | clean | |
| Connect 4 Hoops | 78 | made vs shots | clean | |
| Cup Pong | 138 + 10 solo + 3 online | made vs thrown, solo under 10, online make runs | clean | |
| Yahtzee | 9 (7 with rolls) | held die, 4th roll, score checks | clean | |
| Texas Hold'em | 82 games, 2,351 hands | bankroll ledger | clean | |
| Battle Arena | 14 | none new | no rule fires | a replay of the seed and moves could check every match; not built |
| Monopoly Deal | 18 | none new | no rule fires | |
| Escoba | 16 | none new | no rule fires | |
| Mancala | 55 | none new | no rule fires | |
| Tic Tac Toe | 50 | beat Pro Classic | clean | |
| Murdoku | 26 | none new | no rule fires | no solve times are logged |
| Minesweeper | 12 | record check | clean | |
| Chinchón | 9 | none new | no rule fires | |
| Pool | 9 | none new | no rule fires | |
| Uno | 8 | none new | no rule fires | |
| Parchís | 8 | none new | no rule fires | |
| Boggle | 7 (2 with board) | word not on board | clean | |
| Golf | 5 | hole in 0 | clean | |
| Brick Breaker | 5 | none new | 294,550 on Hard (Nov 9) over Matt's 218,260; his runs climb 24,770, 185,060, 121,600, then 294,550 | no run data |
| Nuts & Bolts | 5 | none new | no rule fires | |
| Battleship | 3 | impossible shots | clean | |
| Skeeball | 3 | rack too high | clean | |
| Darts | 2 | treble runs (online) | clean | |

## What no rule can see yet

- Any play before Nov 24 in a game whose log holds only the score (Ball Run, Brick Breaker, Murdoku, Mancala, Uno,
  Chinchón, Monopoly Deal, and most of Flick Soccer). From Nov 24 every play carries every touch and key press, so the
  same question asked later can be answered.
- Computer games where a script plays well rather than impossibly (Air Hockey, Flick Soccer, Hill Climb). Touch
  counts from Nov 24 will show a game with no touches; a script that fakes touches is blocked and flagged.
- The Battle Arena engine is pure and seeded, so every match could be replayed exactly. That check is not built.

## Other players

No other player tripped any rule.
