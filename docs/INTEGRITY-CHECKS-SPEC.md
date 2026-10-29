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

## Holes closed 2026-10-29: Sudoku, Murdoku, Nuts & Bolts, Arrow Maze

Every fix writes new fields only (THE LAW rule 2) and changes no stored number; the rankings are
read-time. Tests: `node tools/test-hint-holes.mjs` (48), `tools/test-arrow-maze-replay.mjs` (browser).

- **C1 Sudoku and Murdoku: hint solves.** Pressing Hint on every square solved an Expert puzzle and
  counted a full Expert win (Murdoku's hint shows the exact square, unlimited). **Matt's decision: "Win,
  but ranked below".** Every hint solve still counts and shows as a win; on the game's board EVERY row
  with a no-hint solve ranks above every row without one. Among those, difficulty outranks score on
  the no-hint solves (an Expert no-hint solve beats 50 Easy ones), then the usual tier-first rule over
  all wins breaks a tie; the rest rank by that usual rule (`js/leaderboard-ui.js` `compareNoHint`,
  `compareAllWins`). A no-hint row shows its no-hint count with "no hints" under it.
  Stored: Sudoku `sd.clean[tier]` (no-hint solves) and `sd.pre` (a snapshot, at the first tracked solve,
  of lifetime hints and wins per tier); Murdoku `recordMurdoku(tier, { hints })` (same total/byDiff as
  `recordResult` did) + `mu.clean[tier]` / `mu.hinted[tier]` / `mu.hints`, the hints counted per case in
  its save. Merged per record in `js/players-agg.js` (`sd.noHint`, `sdNoHintOf`; `mu`).
  **Legacy wins** (before 2026-10-29) have unknown hint use. A Sudoku record's legacy wins count as
  no-hint ONLY when proven: its lifetime `sd.hints` was 0 then (so no solve can have used one). Murdoku
  stored nothing, so its legacy wins, and a case saved before hints were counted, rank with the hint
  solves. **They still count and show as wins everywhere** (THE LAW rule 1); only the order changes.
  *Honest player:* nothing lost; a player who never used a hint keeps every win at the top.
- **C2 Murdoku "Learn to play".** The guided case shows the answer after every move and recorded a real
  Easy win, replayable for ever. Now it records nothing at all (`_recordOnce` returns on `guided`).
  *Honest player:* the lesson no longer counts; every real case does.
- **C3 Nuts & Bolts: replaying a solved board.** After a win, Restart reset the same board and the
  record guard, so one board gave unlimited top-tier wins; reopening on the win card did the same. The
  save now keeps `won[tier]` (the highest level recorded, only goes up): a level records once, and a
  tier whose current level is recorded opens on the next level. *Honest player:* the same one win per
  level as always; reopening after a win starts the next level instead of the solved one.
- **C4 Arrow Maze: New game wiped the slips.** New game put hints and hearts lost back to 0 on the SAME
  board, so free hints learned an Expert board's one order and a clean try took full points. Now New
  game resets only the clock: the thrown-away try's slips are carried (`gamehub.wayout.slips.v1`, per
  band, level and board, only added to), the clear is scored with every slip on the level, and each
  record keeps the most slips per level (`wo.sl[band]['L<n>']`, max only) so the person's other
  storages see them (a clear takes the max of its own and theirs, from the combined read). The log
  keeps `s` (slips scored, when more than its own m + h) and `p` (slips from before the clearing try).
  **Replay (decided here):** Matt's Replay is kept as designed: a perfect replay wins back what the
  clearing try lost. But a replay never wins back `p` (slips from tries New game threw away or from
  another storage), and a replay's own slips ride its Restart, Try again and leaving until a replay of
  that level is cleared, so learning by hints and restarting a replay clean pays nothing. *Honest
  player:* a level messed up and replayed perfectly still gets full points, as before; New game is still
  there, it just no longer erases slips.
- **C5 Arrow Maze: points doubled across storages.** Points were per-band clear COUNTS added across a
  person's records, so Safari next to the Home Screen app (or cleared data) climbed the ladder again
  from its band's first level and earned the same levels twice. Every clear now writes which level it
  was: `wo.cl[band]` = "<first level>:<one digit per level>" (the best points on each level), and
  `wo.leg[band]` snapshots the record's legacy part at its first tracked clear. A person's points are
  the legacy clears counted exactly as before (no level set exists for them: nothing invented) plus
  each level in the UNION of their level sets once, at its best, unless one of their records' legacy
  clears already covers that level number (legacy = the band's levels up to the record's first tracked
  level, or its latest logged level). `js/arrow-maze-time.js` `woPoints`, merged in `players-agg.js`
  (`wo.lg`, `wo.cl`); the server board runs the same code. Legacy clears on two storages before today
  keep counting as they did (they cannot be told apart). *Honest player:* every point earned before today
  stays; a level cleared again on a second phone simply earns nothing new.

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

## Holes closed 2026-10-29: online challenges

**Hole 1: one online win counted once per phone STORAGE, not once per player.** Every challenge game
(Darts, Cup Pong, Flick Soccer, Pool, Battleship, Connect 4 Hoops, Chinchón, Escoba, Archery, Battle
Arena) counts a finished match through a per-storage `counted` ledger, called on every launcher paint.
The same player code in Safari and in the iPhone Home Screen app (two storages), or on two phones,
counted the same match on each, and `js/players-agg.js` sums a person's devices: each win counted 2+
times. A storage with no ledger (fresh install, cleared site data) re-counted the player's whole
finished history.
- **Fix, part 1 (no double count)**: a challenge count now notes WHICH match it was, in the same write
  as the count (`js/game-stats.js` `withChallengeMatch`: `games.<id>.mpIds[<matchId>] = 'w' | 'l' | 'd'`,
  additive, never removed). `js/players-agg.js` (the phone's and the server's board, `functions/boards.js`)
  takes every extra copy of one id across ONE person's devices back out of `byDiff.mp` and `total`
  (Battleship's `bs` too), exactly as recorded (won, lost, or played only). Read time only; raw records
  untouched; the ids never ride into the board package. A match voided in `VOIDED_MATCHES` is left to its
  own `vd` correction; an integrity-voided device's copy counts as played only.
- **Fix, part 2 (no re-count of history)**: the first time a storage with no ledger asks, it stamps
  "counting since now" (`<ledgerKey>.since`, `countingSince` / `mayCountChallenge`) and counts only
  matches that FINISHED after it (the index row's `updated`, or the match's `over.at` on the game
  screen; 10 minutes' grace for two phones' clocks). A storage that already had a ledger never gets a
  stamp and behaves as before.
- **Mixed buckets**: Hoops, Chinchón, Escoba, Battleship and Battle Arena also file LIVE-ROOM games in
  `'mp'`; those carry no id and count exactly as before.
- **What an honest player sees**: nothing changes on screen. A match is counted once, by whichever
  storage was alive when it finished. Counts from before 2026-10-29 carry no id and cannot be
  de-duplicated (left as they are). One edge: a first-ever challenge in a game, finished before
  2026-10-29 and never opened since on any storage, is not counted by a storage that first opens
  after the deploy (it had nothing counted to lose either way; the old build, still loaded on that
  first open, usually counts it first).
- Proof: `tools/test-mp-dedupe.mjs` (two storages, one match, counted once on the merged board, for all
  ten games; a fresh storage does not re-count; records without ids aggregate as before; a queued older
  result never takes the id; a refused count notes none); `tools/test-boards.mjs`, `tools/players-agg.test.mjs`.

**Hole 2: a losing player could stall a challenge forever.** Expiry ended only an UNANSWERED challenge;
after the first move only Resign ended a match, so the player behind could stop moving and the winner
never got the win. **Matt's decision: "7 days, then forfeit".**
- **Fix**: once a match is answered (the receiver has moved, or it is game 2+ of a series), the player
  whose turn it is has `FORFEIT_MS` (7 days) from when the turn became theirs (`js/challenge-life.js`
  `turnStartOf`: the time of the other side's last move; a move made mid-turn does not restart the
  clock, so nobody can stall one dart or one shot at a time). Past it they LOSE, why `'timeout'`.
  Derived on every read like expiry (each game's `withTimeout` in `readGame` / `watchGame`, `rowTimeout`
  on index rows, which now carry `turnAt`): nothing is written to decide it, a late move is refused
  (`already-over`), Resign cannot change it, each phone counts it once through its own ledger. Turns that
  began before 2026-10-29 are timed from 2026-10-29 (`FORFEIT_FROM`), so nothing changes result before
  players could react. The 24-72 h reminder push is unchanged.
- **Pool's Cutthroat (3 players)**: the idle player loses, and the winner is decided exactly as if they
  had resigned (`resignWinner`: of the other two, the one with most of their own balls on the table,
  ties to whoever shoots next), on the table as it was when the turn began; every row carries `tw`
  (would I win a timeout) so the lists agree with the match. A Cutthroat row from before 2026-10-29 has
  no `tw` and is left to the match itself (opening it decides it).
- **Skeeball challenges**: every turn already had 3 days, after which the whole challenge EXPIRED for
  nobody, even when answered. Now an answered challenge whose 3 days ran out on or after 2026-10-29 does
  not expire: the player on turn has 7 days from the hand-over, then loses. One that expired before
  2026-10-29 stays expired. Unanswered ones still expire after 3 days.
- **What an honest player sees**: nothing for 7 days. Then the match shows as finished with a result and
  the short word "Timed out" / "Tiempo agotado" (every game's lists and history, the Game Over popup, the
  Multiplayer screen's Records).
- Proof: `tools/test-challenges.mjs` (the shared rule, pure), `tools/test-darts-mp.mjs` (a whole match:
  the clock, a mid-turn dart, the timeout on both phones, a late dart refused, Resign refused, counted
  once, an unanswered challenge still expires), `tools/test-eightball-mp.mjs` (Cutthroat),
  `tools/test-skee-challenge.mjs`, every game's `tools/test-*-mp.mjs`.

## Holes closed 2026-10-29: quit/resume and replay holes in single-player and vs-computer games

Found by the "King of Games" hunt. Each fix keeps the honest player's game exactly as it was; none of
them voids or rewrites a stored result (they change what a game lets you do, going forward).

| Game | Hole | Fix | What an honest player sees |
|---|---|---|---|
| Golf | Force-quit mid-flight undid a bad shot (the save was written only at rest) | The shot's inputs (club, aim, power, miss) are saved BEFORE the ball leaves (`pending` on the `save` field, `golf/js/save.js`); a resume replays that same shot to its settle (`_replayPending`), so the stroke counts and the ball lands where the engine put it. The pin of a multi-pin hole is saved too (`pinIdx`), so a resume plays the same cup. A malformed `pending` drops only that field, never the round | Nothing, unless the app dies mid-shot: it reopens with the shot taken |
| Flick Soccer | (checked) already saved the shot before the roll (`shot`, 2026-10-11) | Unchanged | Same |
| Minesweeper | The new-board confirm stopped the clock but left the board visible under the dim: free study time | The clock keeps running while the confirm is up. Leaving to the menu or How to play hides the board, so those still stop it. Backgrounding the app (board not on screen) still pauses | The seconds spent deciding on "New board?" count |
| Boggle | Round time came from the wall clock (a phone clock moved back lengthened a round); `remainingSec` was saved only after a scored word; MP end time came from the host's wall clock | Solo and MP count `performance.now()`; the wall clock can only take time away (a suspended page is charged). The remaining time is saved on every tick (exact ms). MP: each phone reads the wall clock once on receiving the round, capped at the whole round and at its own last saved tick on a rejoin (`entryRemainingMs`), then counts its own monotonic clock. MP no longer writes the solo save slot | A clock that is simply correct; resuming returns the time you had |
| Connect Four | The computer replayed identically, so a game learned with Undo / Show best moves could be replayed in a fresh game for a recorded win | A random seed per game, saved with the game (`aiSeed`); the computer's choice among equally good moves comes from (seed, stones on the board). In the first 10 stones it also varies among moves within a few heuristic points of the best (10 Medium, 5 Hard and Expert). Expert's exact solver picks randomly among moves of exactly equal value. No forced result is ever changed | A computer that does not open the same way every game; Medium strength measured unchanged (100 games varied vs not: 45-42-13); Hard only on a small sample (16 games at margin 10 went 4-8-4, so Hard now uses 5; re-measure before widening) |
| Chinchón (solo) | Draw, look, force-quit, reopen and choose the discard pile instead (the autosave was turn-end only) | The solo save is written the moment a draw happens (`snapshot({ midTurn: true })`) and the resume re-enters that turn at the discard, with the drawn card in hand and no second draw offered. Live-room and challenge play are untouched | Reopening mid-turn puts the drawn card in your hand |
| Mancala, Escoba, Uno, Flick Soccer, Pool | The computer's random choices were re-rolled by quit and resume | Each game's seed is saved with the game (Pool uses the match's own `seed`); the computer's random stream is a pure function of (seed, position), so a resume replays the same choice. Online play does not use these paths. Tiers that are timed searches (Mancala Intermediate / Pro) vary only with the clock and are not seeded | Nothing |
| Hold'em | Suspicion: shoving every hand beats the Easy / Medium computers | Measured, not changed (below) | Nothing |

### Hold'em shove, measured (3000 tournaments per row, the shover goes all in every hand; ROI is per 1 buy-in at the game's own prizes: heads-up 1.5x, otherwise 65/35)

| Computers | Bots | Shover wins | Fair share | ROI |
|---|---|---|---|---|
| Easy | 1 / 2 / 4 / 7 | 45.1% / 29.8% / 15.8% / 9.1% | 50 / 33 / 20 / 12.5% | -32% / -22% / -30% / -38% |
| Medium | 1 / 2 / 4 / 7 | 45.5% / 28.3% / 13.4% / 7.9% | same | -32% / -27% / -39% / -47% |
| Hard | 1 / 2 / 4 / 7 | 45.6% / 29.0% / 15.7% / 8.6% | same | -32% / -25% / -29% / -38% |

Easy and Medium are no softer to a shove than Hard, and shoving loses money everywhere, so no cap was
added. `holdem/js/test.js` now fails if any skill at 2, 4 or 7 computers is beaten by it (win rate under
1.25x fair share, ROI under 0).

## Holes closed 2026-10-29: quitting and easier settings

Matt: one player will use every hole to top the leaderboard. His decisions, built exactly: **E1** quitting a
game against the computer after your first move is a LOSS; **E2** easier settings count, but not at the top
tier; **E3** Monopoly Deal and Parchís get the ESM recorders' rate gate and play log. Every change chooses
only what a NEW result records (its bucket, or a loss that used to vanish); no stored number moves (THE LAW
2-5). Proof: `node tools/test-quit-loss.mjs` (100 checks; `--browser` adds 16 in a real page).

**E1: the rule.** "First move" = the player's own first move of that game (a card, a disc, a dart, a throw, a
roll, a word, a tap on the board), never the deal or the computer's opening. Before it a quit records nothing.
After it, exactly ONE result per game: each game's own one-shot flag (`_statsCommitted`, `recorded`,
`_statsRecorded`, `state.rec`, `_resultRecorded`) is set before the loss is written through the game's own
recorder at the difficulty bucket the finished game would use. Pass and play, live rooms and challenges are
untouched. A quit that costs a loss asks twice and the armed button or the sheet says **"Counts as a loss"**
(EN/ES in each `strings.js`; hub: `hub_confirm_loss`, "Leave? Counts as a loss.").
- **Games that SAVE and resume**: leaving (destroy, the hub's back, closing the app) is not quitting. Only an
  explicit discard records the loss: Restart / New game / Menu / Quit to setup, or a new game started over a
  moved-in save from the setup screen (Dominoes, Escoba, Darts, Flick Soccer, Pool, Archery, Parchís).
- **Games with NO resume** (Yahtzee, Cup Pong, Cup Baseball, Air Hockey, Connect 4 Hoops, Monopoly Deal):
  leaving after the first move is the loss. Closing the app runs no `destroy()`, so the game ARMS its loss in
  `gamehub.quitLoss.v1` (`js/game-stats.js armQuitLoss`: recorder name + the LOSS call's arguments, score
  so far, refreshed as it changes) and DROPS it in the same breath as its real result. `destroy()` and every
  quit route TAKE it (`takeQuitLoss`: marker removed BEFORE the write, so never twice); the game's next mount
  takes a marker its dead page left; the hub settles markers over 30 minutes old (`settleQuitLosses`, before
  the stats sync; a game open in another tab keeps its fresher marker). A marker is taken only under the
  stats store it was armed in. The play log notes `quitLoss`. Each such game exports `quitCostsLoss()`;
  `js/hub.js requestLeave` uses it for the leave confirm.

| Game | Quit route closed | Note |
|---|---|---|
| Connect Four | Restart, Quit to setup | Undo / Show best moves used to make a game count for NOTHING (undo a lost position, escape): now such a game can no longer be a WIN or draw, but a loss still counts; an undo after the end keeps the game recorded (`recorded` in the save) |
| Tic Tac Toe, Dots and Boxes, Filler | Restart, New game / Menu (now two taps when it costs) | Dots and Boxes' Undo: same rule as Connect Four |
| Mancala | Restart, Setup (two taps when it costs); vs computer only | `hm` in the save |
| Dominoes | Restart, the round card's restart, New match over a saved match | `moved` in the save |
| Uno | Restart, New game; **a hand past its 30-minute save is a loss on load** (it used to vanish) | `moved` in the save |
| Escoba, Chinchón | menu New game / Quit to setup, New game over a resumable save (Escoba) | `moved` in the save |
| Battleship | Restart, Exit | first move = first shot (placing ships is not) |
| Boggle | Give up (two taps) | first move = first word entered |
| Darts, Flick Soccer, Pool, Archery | Play (or Pass & play) over a moved-in saved match vs the computer | Quit keeps the save (Continue), so it is not a quit; Pool marks `m.ps` at the first shot |
| Battle Arena | menu New match / Home | `pm` in the save |
| Yahtzee, Cup Pong, Cup Baseball, Air Hockey, Connect 4 Hoops | every route, leaving included (marker) | |
| Minesweeper (solo) | the face's New board on a started board, New game over a level's paused board | **a loss at that level** (it protected a win rate); pausing a board is not quitting |
| Monopoly Deal | New Game, both Quits, the hub, a closed page (classic marker) | its own `bd-stats` too |
| Parchís | a new game over a rolled-in saved game vs the computer (a prompt says so) | BUILT FILE patched, see below |
| Hold'em | already: Give up / Leave record a loss (2026-09-28) | left alone |
| Baseball (admin only) | already: a career game forfeit is a loss | left alone |
| Contexto, Golf, Sudoku, Murdoku, Nuts & Bolts, Arrow Maze, Gridlock, Word Weaver, Snake, Ball Run, Brick Breaker, Hill Climb, Skeeball, Spelling Bee | none needed | no loss axis a quit avoids (solves, bests, a give-up that is already a loss), or already handled (Skeeball `_abandonRack`) |

**E2 (a): the easiest computer.** Escoba and Chinchón recorded at the FIRST computer's tier, Parchís at the
HARDEST: one Hard and one Easy computer filed a win as Hard. Now `easiestDiff` (Escoba, Chinchón) and
`parchisStatsDiff` take the easiest. Uno, Dominoes, Yahtzee, Monopoly Deal and Pool's Cutthroat have one
difficulty for every computer; Hold'em's table sets one skill for all (left alone).

**E2 (b): shortened matches one step down** (`oneTierDown` on the game's own ladder; the lowest stays the lowest):

| Game | Counts one step down | Standard (unchanged) |
|---|---|---|
| Chinchón | under 100 points, or under 10 rounds (1 hand) | 100 points / 10 rounds or more |
| Dominoes | race to 150 | 300, 500 |
| Flick Soccer | first to 1 | first to 2, 3 |
| Pool | 1 rack (Matt's call, and the default) | 2, 3 racks |
| Darts | 201, 101 | 301, Cricket (all variants) |
| Cup Pong | unlimited reracks | 0-3 reracks |
| Boggle | the 2-minute timer (the computer's share of the board does not depend on the clock) | 1, 1.5 minutes |

Decided NOT easier, left alone: Escoba's capture hints and Dominoes' +N badges (they show what the rules
allow, which the computer always sees; Connect Four's solver hints already cannot win), Battleship's board
size and salvo, Dots and Boxes' and Tic Tac Toe's variants (Pro solves small boards exactly), Cup Baseball's
innings (3 is already the shortest and the default), Connect 4 Hoops' one-shot rule, Escoba's 21/31 points,
Mancala's speed, every "computer speed" setting. No setup screen gained words (the tier shapes already there).

**E3: Monopoly Deal and Parchís** (`js/game-stats-global.js`, copied verbatim into
`business-deal/js/game-stats-global.js` after its header): the same 30 results per game per minute on the same
`gamehub.rate.v1` record (refused before the store is read, counted in `blocked`), the same play log queue
(`gamehub.playlog.v1`, `{c, id, t, g, f, a}`, sent by the hub's `js/play-log.js` on the next hub page), a
queued Monopoly Deal backlog drained past the gate (`record(queued)`), and the classic quit marker
(`armQuit` / `dropQuit` / `takeQuit`, the same `gamehub.quitLoss.v1`). Naming untouched (`business`).

**What an honest player sees**: nothing until they quit a game they have moved in; then the button asks twice
and says it counts as a loss. A short or easier match still counts, one tier lower. Leaving the app never
costs anything in a game that saves.

**Left open / honest limits**:
- **Parchís is a BUILT file** (`../Parchís/` is not in this repo): the patch is in `parchis/index.html`
  (`onRollTap` sets `cfg.hm`; `onPlay` prompts and records; `parchisStatsDiff`); port it to the source or the
  next rebuild drops it (`tools/test-quit-loss.mjs` Q3/Q4 fail when it does).
- Boggle's clock still pauses while the app is away (by design, "favoring the player"): a screenshot of the
  board, solved away from the game, is not prevented.
- A no-resume game open in TWO tabs, one of them idle over 30 minutes, can have its marker settled by the hub
  while it is still played: that game then counts its loss AND its result. Rare; not prevented.
- A loss the HUB settles for Monopoly Deal is not added to Monopoly Deal's own legacy `bd-stats` screen (the
  unified stats have it).
- Saves written before 2026-10-29 carry no "moved" flag: each game reads a conservative stand-in (a later
  round, a hand that is not the dealt one, two moves in), so an in-flight game at the deploy can be off by one move.
