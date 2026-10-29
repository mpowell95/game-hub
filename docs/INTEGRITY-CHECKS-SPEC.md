# Integrity checks for every game except Spelling Bee (spec, 2026-10-28)

Status: **built 2026-10-28** from the playbook (`docs/INTEGRITY-CHECKS.md`). Spelling Bee has its own
(`docs/SPELLING-BEE-INTEGRITY-SPEC.md`). Rules: `js/integrity.js`. Server: `functions/integrity.js`.
Void: `js/stats-corrections.js` `voidIntegrityGame`. Tests: `node tools/test-integrity.mjs [--db <snapshot>]`.

## 1. What the games record

Most games keep only results in the stats store (`players/<id>/stats`): counts, bests, totals. No game
except Spelling Bee keeps a timed log of every move, so the Spelling Bee kind of check (too fast, too
accurate, best moves first) is possible only where a log or per-level time exists:

| Data | Games |
|---|---|
| Per-level time | Arrow Maze (`wo.log`: time, arrows, hearts lost, hints, date), Gridlock and Word Weaver (admin only) |
| Online match log, every move kept | Darts (each dart's landing point), Cup Pong (each throw, made cup), Battleship (both fleets + shots), Connect 4 Hoops (columns), Pool, Flick Soccer, Archery, Chinchón, Escoba, Battle Arena |
| Live rooms, deleted after an hour | Tic Tac Toe, Mancala, Filler, Dots and Boxes, Boggle, Yahtzee, Hold'em, Air Hockey, Escoba, Chinchón |
| Results only | everything else |

Every number in the stats store and every match log is written by the player's own phone, so a check
can only prove a number IMPOSSIBLE (the game cannot produce it) or UNLIKELY (no real player comes close).

## 2. The checks

**Strong (voids that game on that device's record):** each bound is proven from the game's code.

| Game | Check | Proof |
|---|---|---|
| Every game | wins + losses more than games played (total or any difficulty) | the recorders bump them together |
| Snake | a snake longer than 255 | 15 x 17 board (`snake/js/game.js`) |
| Yahtzee | a score over 1,575; more than 13 Yahtzees a game | 375 + 12 bonus Yahtzees of 100 |
| Skeeball | a rack over 9 x the top pocket (900; Pop-O-Go 54), a ball over the top pocket, points over racks x 900, a daily best over the machine's top | 9 balls (`skeeball/js/boards.js`) |
| Battleship | a win in under 12 shots; more hits than shots; accuracy over 100% | the smallest fleet is 12 squares (`battleship/js/fleet.js`) |
| Tic Tac Toe | more Pro wins than Ultimate wins | Pro Classic is a full minimax, never beaten (`tic-tac-toe/js/ai.js`) |
| Cup Pong solo | a 10-cup rack in under 10 throws | one ball a throw, one cup a make |
| Golf | fewer strokes than holes; more aces + eagles + birdies than holes; a hole in 0 | a hole takes a stroke and is one of them at most |
| Hill Climb | fewer coins than 50 x flips | every landed flip adds 50 to the run's coins |
| Sudoku | more perfect solves than solves | |
| Minesweeper | a best time at a level never won | only a win sets it |
| Air Hockey | more than 7 goals a game (for or against); a shot over 9,900 | first to 7; mallet 3,800 + puck 2,300 x 2 caps the speed |
| Boggle | a longest word over 17 letters or not its own length; a best score over 11 x all words | 16 dice, one Qu; a word scores at most 11 |
| Dominoes | wins without 150 points each | a win reaches the target, 150 at the least |
| Dots and Boxes | a chain longer than the boxes taken, or than 100 | |
| Contexto | fewer guesses than solves | a hint never gives the word |
| Arrow Maze | a level faster than its own penalties | each heart lost costs at least the base, each hint the base (`js/arrow-maze-time.js`) |

**Alerts (Matt gets a push and the admin page lists it; nothing is voided):**

| Game | Alert | Real data, 2026-10-28 |
|---|---|---|
| Arrow Maze | a level under 0.2 s an arrow (10+ arrows) | fastest real level 0.49 s an arrow (King of Games, Natalia close behind) |
| Texas Hold'em | a bankroll play could not produce (`holdemSuspect`, already sorted last on the Leaderboard) | none |
| ~~Contexto~~ | ~~solved in 1 guess~~ **DROPPED the same day**: `fewest` counts typed guesses only, and 8 hints walk any puzzle from a blank board to rank 2 (300, 150, 75, 37, 18, 9, 4, 2), so a hint-heavy honest solve trips it | King of Games, once: his 5 Oct 28 solves used 8 hints in total, all in ONE solve, so that is almost certainly the "1 guess" |
| Darts (online) | 5 trebles or bullseyes in a row by one player in a match | best real run 2, over 1,461 darts in 18 matches |
| Cup Pong (online) | 10 cups in a row without a miss | best real run 6, over 1,457 throws in 24 matches |
| Battleship (online) | a winner hit 90%+ of their shots (12+ hits) | best accuracy in any record 47% |
| Connect 4 Hoops (online) | a stored winner the moves do not give | none in 75 finished matches |

## 3. Connect 4 Hoops: the hole is closed

Every other challenge game replays its log against the stored result and refuses a match that does not
agree. Hoops accepted any stored winner, so a hand-written `over` counted as a win on both phones.
Since 2026-10-28 `validateGame` (`hoops4/js/mp.js`) replays the columns (`hoops4/js/replay.js`) and
refuses a match whose winner is not the four-in-a-row (resignation excepted). Replayed on every match
in the database that day: **75 of 75 still open**, a forged winner is refused.

## 4. How it runs

- **Records**: every leaderboard rebuild (on a device's sync, at most every 2 min, and every 5 min)
  runs every visible device's record through the rules. A rule broken for the first time is written
  ONCE to `integrityFlags/<statsId>/<game>/<rule>` (`{void, v, lim, name, code, when}`) and every admin
  gets a push ("Integrity check: <name>, <game>: voided. <rule> (<value>, limit <limit>)"); a tap opens
  the admin page. Test names and hidden devices are skipped.
- **Matches**: when a Darts, Cup Pong, Battleship or Hoops challenge's `over` is written, the match is
  checked once; an alert goes to `integrityAlerts/<node>~<match>/<rule>~<side>` and to the admins.
- **The void** is in the server-built leaderboard (`boards/v1/lb`): that game on that record counts as
  PLAYED, with no win and every score, best and point at 0, so it sorts last (Matt's rule 1). The raw
  record and the phone's own store are untouched. **Silent**: the player's own phone (My Stats, the game)
  shows its own numbers as before; everyone else's Leaderboard shows the void.
- **Void and Undo, in the app** (2026-10-28, Matt: "Do I have a way to do this in app"): Admin > Integrity
  checks, one row per flagged game per record with ONE button: **Void** on an alert (or anything that
  counts), **Undo** on a void. `adminConfig/v1/integrity/void/<statsId>/<game>` and `.../undo/...`, written
  together; Undo beats everything; the board rebuilds at once. Match alerts are folded under "Online
  matches (N)" (a match is voided by hand in `VOIDED_MATCHES`).
- **Voided by hand in code**: `HAND_VOIDS` in `js/integrity.js`. King of Games' Contexto (Matt, 2026-10-28,
  on the 1-guess alert: "This must be voided"): the store keeps no day or word per puzzle, so the void is
  his whole Contexto record on that phone (10 played, 8 wins -> 0 wins, still played). Undo on the admin
  page counts it again.
- Rules: `integrityFlags`, `integrityAlerts` admin-read, written only by the server. Both in the backup.

**Known gap**: a phone that falls back to reading all of `players/` (no board package yet) does not see
the voids. The admin page shows raw numbers, as it always has.

## 5. Replayed over the whole database (2026-10-28, 89 device records, 119 finished matches)

| | Strong hits | Alerts |
|---|---|---|
| Records | **0** | 1: King of Games, Contexto solved in 1 guess (the dropped alert above) |
| Darts / Cup Pong / Battleship / Hoops matches | | **0** |

Also checked by hand (no rule): wins vs games add up for everyone (one old Nuts & Bolts difficulty split
from a past migration, not a cheat); Minesweeper best times are all human (fastest Easy 24.7 s).

### King of Games (3VN33), every game looked at first

Nothing impossible in any game. Computed from the snapshot: Arrow Maze 0.49 s an arrow at best (Natalia
0.50, MattyIce 0.55); online Darts 6.4% trebles over 563 darts, best run 2 (others 0-4.1%, run 1); online Cup Pong 36% of
throws made, best run 6 (others 26-30%, run 5); Hoops 79-95% of shots in (others 73-90%). Highest in
Cup Pong and Hoops, within reach of the others; no rule fires. The one alert is the 1-guess Contexto.

## 6. The play log (2026-10-28, Matt: "You must begin logging all of these things so we can catch when he cheats")

- **Every finished game in every game** (Monopoly Deal and Parchís excepted: their recorder is the
  separate `game-stats-global.js`): each recorder in `js/game-stats.js` calls `notePlay`, which queues
  the game, the recorder's name, its ARGUMENTS as JSON (score, time, moves, hints, difficulty, extras)
  and the phone's time (`js/play-log-queue.js`, `gamehub.playlog.v1`, newest 3,000 kept).
- **Contexto, every move**: open (new / resume / won / gave), every guess with its rank (`unknown` for a
  word not in the list, `again` for a repeat), every hint with its word and rank, win, give up, leaving
  the app and coming back. Puzzle key `en-31`.
- Sent by `js/play-log.js` (started by the hub; 5 s after the last entry, on leaving the app, on each
  sync) to **`playLog/<CODE>/<t>-<n>`** = `{t, s, g, f?, a?, e?, k?, w?, r?}` (`s` = server time),
  verified by re-read, retried until sent. **Admins read all; a phone reads and writes only its own
  claimed code's entries** (the re-read needs that; Contexto guesses hold answers, so nobody else's). In the backup's `BRANCHES` (an anonymous backup is denied:
  export it from the console).
- Nothing reads it yet. Checks on it come after real logs exist, replayed per Matt's rule 5.
- Before this, only Spelling Bee (`beeLog`) logged moves; nothing earlier can be recovered.

## 6b. Contexto's holes, closed (2026-10-28, Matt: "He's clearly just pressing hint until it basically gives him the word... All holes like this MUST be fixed")

- **A puzzle follows the PLAYER, not the phone.** The save is per phone storage (and on an iPhone, Safari
  and the Home Screen app are separate storages), so a hint or give-up in one place, or a solve on a
  second phone, was invisible in the other: look up the answer in Safari, solve hint-free in the app,
  gold. Now the game reads the player's own play log (`playLog/<CODE>`, indexed on `k`) at open and
  before recording (`contexto/js/ui.js` `_remote`, `engine.js` `logSummary`): hints taken anywhere count
  toward the medal; a puzzle given up or solved anywhere is finished everywhere and never recorded twice.
  A finished puzzle is recorded only after that check (closing the app during it records at next open).
- **Hints count as tries** in the tie-break (`leaderboard-rank.js` `ctAvgGuesses` = (guesses + hints) /
  solves, shown as "avg N tries"): 8 hints from a blank board reach rank 2 (300, 150, 75, 37, 18, 9, 4,
  2), so a typed-guesses-only average rewarded pressing hint. Medals were already hint-first (gold = no
  hints).
- **Server alerts on every logged Contexto win** (`contextoWinCheck`, `js/integrity.js`
  `checkContextoWin`, alerts only): solved after a solve or give-up elsewhere; hints taken elsewhere not
  counted (a phone offline at the time); **far jump**: no hints and never closer than rank 300 before
  the answer (or the answer as the first guess), the mark of a looked-up word. Thresholds are first
  guesses: re-check them against real logs.
- **Not closable in an app with no server answers**: a second player code (a made-up profile) or another
  person can still look an answer up; the far-jump alert is what catches the result.

## Holes closed 2026-10-29: Spelling Bee's clock, Skeeball challenges, and names

Matt: "All holes like this MUST be fixed." Four holes, each with its fix and what an honest player sees.

**1. Spelling Bee: the phone clock decided the puzzle day.** A phone set a day ahead opened Yesterday's
Answers on the REAL today's puzzle; setting it back typed them in. A phone set to a past day posted that
day late, and the board trusted the phone's own-day numbers (`dw`/`dp`/`dr`).
- Fix: `js/server-time.js` (Firebase's `.info/serverTimeOffset`, anchored to `performance.now()` per
  connection; the last gap cached for offline). "Today" and each word's time use it. Yesterday's
  Answers opens only when this page's LIVE server time says that day is over (`engine.js
  answersShown`; no connection = "No connection", a later day = "Not yet"). The log carries the phone's
  time zone (`z`). On the server (`js/bee-fairplay.js countsOnDay`, `ownDayFromLog`, `ownEntry`), a word
  counts for its puzzle only when its phone time falls on that day (local by `z`; without `z`, anywhere
  on Earth), it reached the server within 24 h of that time and not over 1 h before it, AND by that
  day's midnight plus 10 minutes (else the phone set back after Yesterday's Answers opened still
  worked). When the log holds every word, the board counts what the log proves, not the phone's
  numbers (`boards/v1/beeOwn`, also read by the in-game board). A row posted over a day after the
  puzzle's day ended everywhere (`isLatePost`) counts only what its log proves; with no log, nothing.
  Stored rows and logs are untouched; the phone stops posting such late rows.
- Honest player: nothing changes on the day. Words played OFFLINE and sent after the next midnight
  count on that phone, not on the boards. Yesterday's Answers needs a connection. A past puzzle played
  later still counts what was found on its day.
- Left open: changing the phone's TIME ZONE moves "today" by up to a day (the game's day is local
  midnight by design). The zone is now in every log entry, so it can be seen and a rule added.

**2. Skeeball challenges: one attempt existed only per storage.** Safari and the Home Screen app (or two
phones) could each play the same game and send the better score.
- Fix: `skeeball/js/challenge.js claimLeg` writes a write-once server marker
  (`skeeChallenges/games/<id>/<side>/started/<leg>` = `{at: server time, k: this storage's id}`) before the
  first ball; rules: write-once, server time, by that side's claimed code. Another storage finds it and
  cannot start the game ("Started on another device."); a game cannot start offline ("No connection.").
  A started game with no score 30 minutes after its marker counts 0 on every phone (derived on read,
  stored by the next write, `START_GRACE_MS`).
- Honest player: one extra round trip before the first ball. A rack left for over 30 minutes mid-game
  (a phone call) counts 0.
- Left open: someone with dev tools can delete a marker (the node is writable by any signed-in device).

**3. Skeeball: a challenge rack unlocked the machine for good.** The challenged person plays the
challenger's machine even when it is locked for them, and `recordSkeeball` unlocked any machine played.
- Fix: `recordSkeeball(board, {challenge: true})` records the rack and never writes `sk.unlocked`; a
  challenge rack runs no objective unlock; objectives open the next machine only from a machine the
  player owns (earned or open to everyone, `_ownsMachine`).
- Honest player: unlocks are earned exactly as before; challenge scores still count. Nothing earned
  before is taken away (rule 2).

**4. Names: the registry check failed open offline.** A phone with no signal could take "MattyIce" and
merge into Matt's row (and his name-gated extras); anyone could take "Matt" or "Lill", which the
leaderboard folds into MattyIce and Lili.
- Fix: a new or changed name is saved only after the check succeeds online (first-run gate: "Connect
  to the internet to choose a name.", the gate stays up; profile page: the old name stays, "No
  connection. Name not changed."). Typing on the profile page no longer saves the name before the
  check. An alias name (`NAME_ALIAS`) can be taken only by the code that owns its target. Darts' Cricket
  aim help, Skeeball's and Golf's dev bypass (every machine and course open), and "Everyone" in
  Messages now need Matt's admin DEVICE (`isAdminDevice()`, the `admins/<uid>` allowlist) as well as the
  name.
- Honest player: choosing or changing a name needs a connection. Matt on his own devices is unchanged.
- Left open: `usernames/` is writable by any signed-in device (dev tools). Names already taken offline
  before this are not undone. Launcher visibility of admin-only games stays on the dev name (no
  scoring advantage: those plays go to the test area).

## 7. What would make more checks possible (not built; Matt's call)

A timed log like Spelling Bee's, per game, is the only way to catch outside help (a solver, a copied
answer). Candidates, most useful first: **Contexto** (each guess and its time: a 1-guess solve or a
straight run to the word), **Sudoku / Murdoku / Minesweeper** (time per placement), **Boggle** (the
words and times), **Ball Run / Hill Climb / Brick Breaker / Snake** (run length and time, to judge a
best). Each needs a rules branch, the backup, a writer verified by re-read, and then thresholds set
from real logs before anything voids (rule 5). Also possible: a server replay of every challenge log
(Pool, Flick Soccer, Archery, Chinchón, Escoba, Battle Arena are deterministic), and per-move server
timestamps (every `at` today is the phone's clock).
