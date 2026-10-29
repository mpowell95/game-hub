# Darts — darts/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

A clone of GamePigeon's Darts (Matt, 2026-10-01). Reference: a 66 s screen recording, `Claude Code
Refs/Video Sep 30 2026, 11 54 01 PM.mp4` in Matt's Dropbox. Wooden wall, full-width board, a red dart
waiting at the bottom, swipe up to throw, three darts a turn, points popping up at the hit, "MISS!" off
the scoring area, avatars and green score plaques in the bottom corners, 301 counting down.

## Hub integration

- In-hub `module: '../darts/js/ui.js'`, **immersive** (full-bleed wall; the top row keeps right of the
  hub's back button). Hub id and stats id both `darts`; `.dt-root` / `.dt-`.
- **Released** (2026-10-26 in code; live from the admin page since 2026-10-03).
- `isInProgress()` is always `false`: the match autosaves after every dart and hand-over
  (`gamehub.darts.save.v1`); setup offers **Continue match**.

## The games (2026-10-01)

Setup has a **Game** row (301 / 201 / 101 / Cricket) and for Cricket an **Order** row (Any order / In
order), persisted in `gamehub.darts.v1` (`game`, `order`). The match carries `kind` (engine.js `KINDS`:
`'301' | '201' | '101' | 'cricket' | 'cricket-order'`, plus `cricket-np` / `cricket-order-np`).
**A match with no `kind` is 301** (`validMatch` / `mp.js kindOfGame`), so nothing saved is misread.

- **201 / 101**: 301's rules from a lower start.
- **Cricket** (`throwCricket`): 20..15 and the bull; single 1 mark, double 2, treble 3, outer bull 1,
  bullseye 2; three marks close a number; marks past the third score the number's value (bull 25) while
  the other player has it open. **Win: every number closed and at least as many points**, checked after
  every dart. No bust.
- **In order** (`cricket-order`): only the number you are on takes marks (20, 19, 18, 17, 16, 15, bull;
  `cricketNext`); a closed number still scores. **This reading was my choice**; if Matt plays it another
  way it is `cricketCounts` in engine.js.
- **Points On/Off** (2026-10-05, Matt): Off = kinds `cricket-np` / `cricket-order-np` (`noPoints`,
  `inOrder`): marks past the third count for nothing, first to close all seven wins; plaques show
  numbers closed (`_plaques`). Shares a row with Order (`.dt-pair`).
- **Chalkboard** (`_marksHud`): marks above each plaque; in order the current number is ringed
  `#ffce3a`; a number both closed is struck through; board shrinks on a short phone so seven rows of
  >= 15px fit (`_layout`). A dart on a bed that counts for nothing pops up dimmed with no flash.
- **Computer** (`chooseCricketTarget`): behind with a scoreable number, score there; otherwise next
  number (in order: current; any order: highest open). Easy aims at singles, never chases points.
- **Stats**: every game records into the same `recordResult('darts', ...)` buckets (no per-game split).

## Rules (engine.js, pure, `node darts/js/test.js`)

- **301/201/101 down to exactly zero. No double-out** (could not be confirmed from the recording; one
  branch in `throwDart()` if Matt says otherwise). **Below zero is a bust**: score back to the turn's
  start, turn ends.
- **Equal turns (2026-10-08)** on matches with `eq: true` (absent = old rules): when the FIRST thrower
  finishes, the engine returns `'out'` and the other player gets one last turn ("Last turn"). Finish
  too = a draw (`m.winner === DRAW`, -1); otherwise the first player wins (event stays `'bust'`/`'end'`
  with `m.winner` set). The SECOND player finishing first wins at once. Online a draw is `over: {
  winner: 'draw', why: 'tie' }`, counts as a played game in `mp` with no win/loss. **Push gap:**
  `decideDarts` only notifies on the other's loss or resign, so a win on the other's last turn, or a
  draw, sends no push.
- **Overtime (2026-10-13)**, Matt: *"Draws shouldn't be allowed. It should go over time"*: on matches
  with `ot: true` (only with `eq`; absent = a tie stays a draw, so older matches replay unchanged), the
  tie returns `'tie'`, sets `m.bo = [null, null]` and hands the board to the first thrower.
  **Overtime is one dart each, closest to the bull's centre wins** (`throwOvertime`; off the wall still
  has a distance and loses to anything on the board); level throws again ("Still tied"). Scores/marks
  frozen; every overtime turn is one dart (`dartsPerTurn`); the computer aims at the bull. **The form
  was my choice** (standard bull tiebreak). Online `over.why: 'overtime'` ("Won in overtime"). Pinned by
  `darts/js/test.js` 3b3 and `tools/test-darts-mp.mjs`.
- `VOIDED_MATCHES` (`js/stats-corrections.js`) is honoured by `mp.js` (never counted; a phone that had
  counted one notes `games.darts.vd[<id>]`, `correctStats` subtracts it).
- Board geometry in units of R (the double's outer wire): bull 50 inside 0.0374R, 25 inside 0.0935R,
  treble 0.5824-0.6294R, double 0.9529-1R. `RING.frame` (1.27R) is the black number ring: a dart there
  scores nothing ("MISS!"); beyond it the dart falls off.
- **The computer** (`computerThrow`) aims (`chooseTarget`) then misses by a 2D gaussian (`SPREAD`: easy
  0.36R, medium 0.24R, hard 0.10R; was 0.30/0.17/0.085 until 2026-10-02, when Medium "basically didn't
  miss" at Cricket). Aim: exact one-dart finish if any; else treble 20 above 80; else a single leaving
  <= 20. Easy has no plan and throws at the bull. Pinned by `test.js`.

## The throw (the one thing to tune on a real phone)

`flickLanding()`: touch below the board (or on the dart), the dart follows the finger, let go moving up.

- **Left/right**: from release, the dart carries on in the direction of the WHOLE swipe (touch-down to
  release), so swiping toward a number aims at it (was the last ~90 ms; a swipe straightens at the end
  so diagonals went straight). Anchoring at touch-down was tried and rejected.
- **Height**: the flick's upward speed over the last ~90 ms. `FLICK_MID` (3.1; was 2.3, "the dart needs
  to feel heavier") lands at the bull; `FLICK_GAIN` (1.45R per doubling) is logarithmic. Below
  `FLICK_MIN` (0.55) or a drag under 24 px it is not a throw. A gaussian wobble of 0.02R.
- Matt tunes these on his own phone after real games (confirmed 2026-10-05). Throws all high: raise
  `FLICK_MID`; all low: lower it; twitchy: lower `FLICK_GAIN`.

### Matt's aim help on 19, 17, 16 and 15 (2026-10-06, MATT ONLY)

Matt: *"leave it as is for everyone other than me. BUT why is it so difficult for me to hit the 19 and
17? make it easier"*, then 16 and 15. `assistLanding()` in `engine.js`: in Cricket only, a dart of HIS
within 9 degrees either side of a bottom number he still needs (`assistTargets`: in order the current
number, any order every unclosed one) is moved just inside that number's edge keeping its ring (one in
the frame beside it comes back to the outer single). Bull, off-board darts, 20 and 18, x01, the
computer, the second seat in pass and play and everyone else are untouched. `_aimHelp()` in `ui.js` is
gated on `isAdminDevice()` AND `isAdmin(profile name)` (2026-10-29: the name alone could be typed by anyone) and his
seat (online `mySeat`; else seat 0). **Online it applies to his
darts only**: the moved point is what is thrown and logged, so `validateGame` replays it normally.

## How the dart FLIES (2026-10-01, `js/flight.js`)

Copied from GamePigeon's video, not reasoned. **Do not reintroduce a lob solved on screen with the axis
STEERED along the screen path** (v1041: the axis swung and the dart was drawn as a big sideways cross).

- A 3D dart seen through a pinhole camera at 2.37 m (the oche), focal length set so the board lands
  where it is drawn; every dart is a world tip point plus an axis, projected to a screen tip and tail;
  `render.js drawDart` blends the flights to an end-on cross as projected length shrinks (`a = u * 0.24`).
- Twelve GamePigeon throws tracked at 60 fps: ~0.47 s (`FLIGHT_T`), **Climb** (first 60%, `CLIMB`) to a
  point ABOVE its target (`APEX` 0.33R + `APEX_SLOPE` 0.128 per R below the bull; depth k^1.8) then
  **Settle** (last 40%) straight down onto the target. Physically impossible, exactly what the video shows.
- **Every throw climbs first, wherever it is let go**: `makeFlight` ends the climb at least `MIN_RISE`
  (0.3R) above the release point. The dart in the hand stops following the finger at 60% down the board
  (`_pointerMove`); a flick too soft/hard lands just past the board edge (`FLICK_CAP` 1.5R).
- **The axis turns steadily, never derived from the path**: side-on (`REST_AXIS`) to end-on
  (`STUCK_AXIS`) by 42% of the flight (`TURN`); no sideways part.
- **It never decides where the dart lands**: the flight ends exactly on the point the rules chose
  (flick, computer or online log), so scoring and replay are untouched; stuck darts sit on `STUCK_AXIS`.
  Tests: `darts/js/test.js` section 5.
- Online searches (2026-10-01, 2026-10-05) found no reusable darts engine (`golden-dart` has no
  license; `raulr/darts` is tap-to-stop; `DartsClone` is Unity).

## Screens

- Setup: a cream card CENTRED over a light scrim (auto margins; a taller card starts at the top
  padding): **Multiplayer ›**, Game (+ Order), Play the computer Easy/Medium/Hard (shape markers),
  Computer speed, First throw Alternate/Me/Computer (`nextStarter`), Continue match, **Practice** and
  Play side by side; How to play is the **?** circle top-right (the in-game menu keeps a labelled
  button). Settings persist on every tap in `gamehub.darts.v1` (`mode` is the LOCAL kind, 'cpu' or
  'pass'; an old 'online' reads as 'cpu').
- Play: canvas board and darts (`render.js`), DOM for plaques, dart icons, popups, banners. Seat colours
  red/blue, never red/green, and the active seat also carries a triangle marker.
- Pass and play: "Pass to <name>" card between turns; not recorded. Result: winner's emoji, close X,
  Play again, Menu. How to play fits one screen (`_fitHelp`, 11px floor).

## Practice (2026-10-08)

Beside Play; opens a card with **Against yourself** (`mode: 'self'`: the chosen game, you on both seats
"Tester"/"Tester 2", no pass card, Matt's aim help on both seats) and **Free throw** (`mode: 'free'`,
`_landFree`: no rules, three darts a round, the round total, the plaques show **3-dart avg** and **Best
round**; runs on a 301 container, `throwDart` never called). **Nothing recorded, nothing saved**: neither
calls `recordResult`, and `_save()` returns at once because the single save slot holds the match vs the
computer (a finished practice match would clear it). `tools/check-no-scroll.mjs darts` measures both.

## Computer speed (2026-10-08)

Matt: *"I want the computer to play on fast forward so i don't have to wait."* Slow / Normal / Fast
(`PACES` in `ui.js`: 0.6x / 1x / 3x), `pace` in `gamehub.darts.v1` (absent = Normal), on the setup card
and in the in-game menu (hidden in pass and play and online). `_pace()` scales GAME TIME
(`_tick(dt * pace)`) only on the computer's turn in a vs-computer match; score popups get a matching
`animationDuration`. Where it aims and lands is untouched. **Pills are DRAWN 32px and TAP 44px** (an
`::after` reaches 6px above and below): this game's documented exception to the 44px floor
(docs/BUILDING-A-GAME.md, Part 0), verified with `elementFromPoint`.

## Stats

`recordResult('darts', difficulty, won)`, total/byDiff only, once per won match (`match.recorded`), vs
computer only. A competitive game, so NOT in `js/players-agg.js`'s `SOLO` set. (Measured 2026-10-08, nothing
changed: Medium hits T18 then T17 back to back 1 in 1,700; Matt's aim help runs only in the flick path,
never `_cpuThrow`.)

## Tests

- `node darts/js/test.js` (geometry, match, 201/101, Cricket, flick mapping, flight);
  `node tools/check-no-scroll.mjs darts` (setup, how to play, play, result, practice, both hosts, both
  heights); `node tools/test-darts-mp.mjs` (39 checks); `node tools/test-push.mjs` (`decideDarts`).
- `window.__dtTest.ui` is the test seam (`_launch(from, x, y)`).

## Online challenges (2026-10-01)

(Full story: CLAUDE-HISTORY.md.) Turn-by-turn, GamePigeon's iMessage way. Cup Pong's challenges are the
model; no code shared.

- **Where**: the setup card's first row **Multiplayer ›** (with a "N waiting on you" badge), like Cup
  Pong and Hoops; behind it Challenge someone, **Pass & play**, notify row, Your turn, Their turn,
  History. A challenge uses the Game chosen on setup. Files: `js/mp.js` (data), `js/mp-ui.js` (lists,
  lazily imported), `js/alert.js` (launcher bubble; `alerts:` on the hub entry).
- **`kind`** on the match and both index rows (optional; absent = 301); `validateGame` replays with
  that game's rules.
- **Node** `darts/games/<id>` + `darts/index/<CODE>/<id>` by PLAYER CODE; in `database.rules.json` and
  `backups/rtdb-backup.mjs` `BRANCHES`; **rules PUBLISHED by Matt 2026-10-01**.
- **A match is a LOG of darts**, each the point it landed on (x, y in R, rounded to 1/10000), never a
  snapshot. `validateGame` replays it and refuses the whole document if one dart does not replay. The
  phone rounds its landing point the same way BEFORE scoring (`_launch`). Written dart by dart
  (`appendLog`, verified by re-read, idempotent, stale base = conflict, never overwrite), outbox
  `gamehub.darts.outbox.v1`. Index rows change only when the turn passes or the match ends. **Delivered
  when the challenger's first turn ends.**
- Opening a match replays the log silently to the other's latest run, then FLIES that run (`_mpCatchUp`);
  while their turn the match is watched live. You sit on the LEFT (`.is-flip` when side 'b').
- **The launcher's "Your turn" bubble stays up for as long as it IS your turn** (2026-10-04): only a
  FINISHED turn (or the bubble's X, or opening from the bubble) marks it seen, not watching
  (`_mpCatchUp`) or throwing a single dart. Pinned in `tools/test-darts-mp.mjs`.
- **Counting**: each finished match once per phone (`gamehub.darts.counted.v1`) as
  `recordResult('darts', 'mp', won)`; a match ended while away gets a Game Over popup. **Resign**: the
  other person wins; nothing deleted.
- **Cancel, decline, expire (2026-10-13)**, root `CLAUDE.md` "Cancel, decline, resign, expire": until
  the receiver's first dart the menu reads **Cancel challenge** / **Decline challenge** and calls it off
  for nobody (`cancelGame`; Resign does the same, `{ cancelled: true }`). A match from 2026-10-13
  carries `lapse: true` and **expires 3 days after delivery** if the receiver never threw (`lifeOf`;
  `appendLog` refuses a late dart with `'expired'`). The receiver's first dart rewrites both rows so they
  stop saying `open`.
- **No scrolling**: lists are trimmed by measurement with "+N more" (`fitList` in `mp-ui.js`); the picker
  narrows by search.
- **Notifications**: `dartsTurnPush` (`functions/index.js`, `decideDarts` in `functions/decide.js`):
  challenge (names the game), your turn back (with the score), a match the other ended. **DEPLOYED by
  Matt 2026-10-03; Cricket wording ("Closed: you 3, them 2", rows carry `mineClosed`/`theirsClosed`)
  redeployed 2026-10-11.** `sw.js` opens any match a payload names (`data.match`) via `alert.js armOpen`.

## Not built yet

- **A series (best of 3/5) for online challenges**: Matt wants it (2026-10-05), in its own session.
  (Cup Pong's `seriesAfter` / `nextInSeries` are the model.)
- **No sound, and none is ever to be added** unless Matt asks (root `CLAUDE.md`, "No sound, ever").

## Quick chat (2026-10-14)

A chat button on every online challenge (`_mpMountChat` in `js/ui.js`, torn down in `_mpLeave`; never in
vs-computer, pass and play or practice): `js/match-chat-ui.js` + `js/match-chat.js`, lazy-imported. It
sits on the top row LEFT of the darts-left icons and the menu button (`CHAT_PLACE`, `right: 118px`);
bubbles come down under that row. Node `darts/chat/<matchId>/<key>` beside `darts/games/<id>`; sends with
the STORED side (`mp.side`), right whichever seat the left plaque is.

## Challenge options on the pick path (2026-10-27)

- **The challenge card chooses the game** (2026-10-27): Game 301/201/101/Cricket, and Cricket's Order / Points, on
  `mp-ui.js` `confirm` (the setup card's own settings via `ui._saveSettings`). Before, a challenge from the
  Multiplayer screen could only be whatever game the setup card last had.

## Challenges: 7 days, then forfeit (2026-10-29)

- 7 days, then forfeit; one count per person: root `CLAUDE.md`, "Cancel, decline, resign, expire". Rows carry `turnAt`; `withTimeout` on every read; `countResult(id, won, finishedAt)`; a timeout shows "Timed out" (`mp_timed_out`). `tools/test-darts-mp.mjs` plays one.
