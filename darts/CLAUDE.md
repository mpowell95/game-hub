# Darts — darts/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

A clone of GamePigeon's Darts (Matt, 2026-10-01: *"create a darts game for the game hub. I just
uploaded the game pigeon version to dropbox for you to clone"*). The reference is a 66 s screen
recording, `Claude Code Refs/Video Sep 30 2026, 11 54 01 PM.mp4` in Matt's Dropbox.

What the recording showed, and what was copied: a wooden wall, a full-width board (black and cream
beds, red and green rings, white numbers on a black frame), a big red dart waiting at the bottom
with its flights turning, swipe up to throw, three darts a turn (tiny dart icons count them down),
the points popping up at the hit with the bed flashing, "MISS!" off the scoring area, avatars and
green score plaques in the bottom corners, a menu button top right, 301 counting down.

## Hub integration

- In-hub `module: '../darts/js/ui.js'`, **immersive** (the wall is full bleed; the top row keeps
  right of the hub's floating back button). Hub id and stats id are both `darts`. Prefix
  `.dt-root` / `.dt-`.
- **ADMIN ONLY at first** (`devOnly: true`, no `released` date; still admin only on 2026-10-01). Matt releases it from the admin
  page with no commit; its `GAME_META` row, My Stats tab and leaderboard wiring already ship, so
  every result recorded before the release shows the moment it is released.
- `isInProgress()` is always `false`: the match autosaves after every dart and every hand-over
  (`gamehub.darts.save.v1`) and the setup screen offers **Continue match**. Leaving is lossless.

## The games (2026-10-01)

Matt, after the first build: *"Please add 201 and 101. And add cricket. With options of in order or
any order."* Setup has a **Game** row (301 / 201 / 101 / Cricket) and, for Cricket, an **Order** row
(Any order / In order); both persist in `gamehub.darts.v1` (`game`, `order`). The match carries
`kind` (engine.js `KINDS`: `'301' | '201' | '101' | 'cricket' | 'cricket-order'`). **A match with no
`kind` is 301**: every save and every online match made before this has none, and `validMatch` /
`mp.js kindOfGame` read it that way, so nothing saved is lost or misread.

- **201 and 101**: 301's rules from a lower start.
- **Cricket** (`throwCricket`): 20 down to 15 and the bull. A single is one mark, a double two, a
  treble three; the outer bull one, the bullseye two. Three marks close a number. Marks past the
  third score the number's value (the bull 25) while the other player has it open. **Win: every
  number closed and at least as many points**, checked after every dart (so a player who closes
  everything while behind keeps throwing to score). No bust in Cricket.
- **In order** (`cricket-order`): only the number you are on takes marks, 20, 19, 18, 17, 16, 15,
  then the bull (`cricketNext`). A number you have already closed still scores points. **This
  reading was my choice** (in-order cricket has several house rules); if Matt plays it another way,
  it is `cricketCounts` in engine.js.
- **The chalkboard** (`_marksHud`): each seat's marks (/ X circled X) above its own plaque, either
  side of the dart; in order, the number each player is on is ringed in `#ffce3a`; a number both
  have closed is struck through. The plaques show points. On a short phone the board shrinks a
  little so seven rows of at least 15px fit (`_layout`).
- **A dart on a bed that counts for nothing** (7, or 19 while 20 is open in order) pops up dimmed
  with no flash; a counting dart pops up its bed (T20, D16, BULL) and `+points` if it scored.
- **The computer** (`chooseCricketTarget`): behind on points with a number it can score on, it
  scores there; otherwise it goes for its next number (in order: the one it is on; any order: the
  highest open). Easy aims at singles and never chases points. Hard vs hard: ~18 turns a game.
- **Stats**: every game records into the same `recordResult('darts', ...)` buckets (one Darts record;
  no per-game split). Online: the challenger's setup choice is sent as the match's `kind`; a rematch
  is the same game; the match rows and the push say which game it is.

## Rules (engine.js, pure, tested by `node darts/js/test.js`)

- **301 (and 201, 101), down to exactly zero. No double-out**: any dart that lands on zero wins. **Below zero is
  a bust**: the score goes back to where that turn started and the turn ends. I could not confirm
  from the recording whether GamePigeon requires a double to finish (no finish was filmed); no
  double-out is the simpler rule and the one GamePigeon is generally described with. If Matt says
  otherwise, it is one branch in `throwDart()`.
- Board geometry is the standard board in units of R (the double's outer wire): bull 50 inside
  0.0374R, 25 inside 0.0935R, treble 0.5824-0.6294R, double 0.9529-1R. `RING.frame` (1.27R) is
  the black number ring: a dart there sticks and scores nothing ("MISS!"); beyond it the dart
  falls off the wall.
- **The computer** (`computerThrow`) aims (`chooseTarget`) and then misses by a 2D gaussian
  (`SPREAD`: easy 0.36R, medium 0.24R, hard 0.10R; until 2026-10-02 0.30 / 0.17 / 0.085, when
  Matt lost at Cricket to Medium, who "basically didn't miss": it made 1.5 marks a turn, now ~1.0;
  Hard ~2.7, Easy ~0.4, pinned by `darts/js/test.js`). Aim: an exact one-dart finish if there is one
  (single, then double, then treble or bull); otherwise treble 20 above 80; otherwise a single
  that leaves 20 or less. Easy has no plan and throws at the bull. Measured averages per dart
  aimed at the treble 20 (seeded): easy 12.0, medium 12.2, hard 19.4 (medium's edge in 301 is its
  finishing plan, not its aim).

## The throw (the one thing to tune on a real phone)

`flickLanding()`: touch anywhere below the board (or on the dart), the dart follows the finger,
let go moving upward.

- **Left/right**: the dart flies along the flick's line from where it was let go, so swiping toward
  a number aims at it.
- **Height**: the flick's upward speed alone, in screen heights per second, measured over the last
  ~90 ms before release. `FLICK_MID` (3.1; 2.3 until 2026-10-02, when Matt found the bottom of the board too hard to reach: *"I think the dart needs to feel heavier"*) lands at the height of the bull; `FLICK_GAIN` (1.45R per
  doubling of speed) is logarithmic, so a soft flick and a hard one are equally forgiving. Below
  `FLICK_MIN` (0.55) or a drag shorter than 24 px it is not a throw and the dart drops back.
- A tiny random wobble (gaussian, 0.02R) so two identical flicks do not land on the same pixel.
- These three constants were set by reasoning and a synthetic flick in headless Chromium, **not
  yet on a real phone**. If Matt finds throws all landing high, raise `FLICK_MID`; all low, lower
  it; too twitchy, lower `FLICK_GAIN`.

## How the dart FLIES (2026-10-01, `js/flight.js`)

Three models in one day. Matt, after the first build: *"The darts go more like a line drive than in
the example video."* Then, after a "bigger arc": *"Something has gone horribly wrong."* He asked for
a side view of every throw in both videos, then *"make it match game pigeon"*. What ships now is
COPIED from GamePigeon's video, not reasoned out.

- **A 3D dart seen through a pinhole camera** at 2.37 m (the regulation oche), focal length set so
  the board lands exactly where it is drawn. Every dart (in the hand, in flight, falling off the
  wall, stuck in the board) is a world tip point plus an axis, projected to a screen tip and tail;
  `render.js drawDart` draws from those two points and blends the flights to an end-on cross as the
  projected length shrinks below the dart's width.
- **The flight, measured.** Twelve GamePigeon throws were tracked at 60 fps (the dart's position on
  screen, and its size, which gives its depth). Every one takes about 0.47 s (`FLIGHT_T`) and does
  two things. **Climb** (first 60%, `CLIMB`): it rushes up the screen and slows (1-(1-k)^3) to a
  point ABOVE its target, `APEX` (0.33) board radii above plus `APEX_SLOPE` (0.128) per radius the
  target sits below the bull (measured: 0.24R aimed high, 0.33R mid, 0.43R low, 0.52R very low);
  its depth starts slow and speeds up (k^1.8), so it stays big off the hand. **Settle** (last 40%):
  small and end-on, nearly at the board, it drops straight down onto its target, gathering speed.
  Physically impossible (it slides down the face of the board) and exactly what the video shows.
  Both halves are written in screen terms (x/z, y/z) plus a depth, then lifted into the world.
- **Every throw climbs first, wherever it is let go** (2026-10-02, Matt: *"If I drag the dart up
  instead of doing a very quick flick, it reverts to do that weird impossible trajectory"*). A dart
  dragged up the screen could be let go ABOVE the point it climbs to, so the climb ran DOWN into the
  board. `makeFlight` now makes the climb end at least `MIN_RISE` (0.3R) above the release point and
  lets the settle drop the rest. Also: the dart in the hand stops following the finger at 60% down
  the board (`_pointerMove`; the finger's speed still throws), and a flick too soft or too hard to
  reach the board lands just past its edge (`FLICK_CAP`, 1.5R) rather than far down the wall, which
  read as a long slide down the wall. Both are misses either way.
- **The axis turns steadily, it is never derived from the path**: side-on in the hand (`REST_AXIS`)
  to end-on (`STUCK_AXIS`) by 42% of the flight (`TURN`), slow at first. Neither axis has a sideways
  part, so the dart only ever leans the way perspective leans it.
- **What went "horribly wrong" (v1041), so nobody brings it back:** a lob solved on screen with the
  axis STEERED along the screen path. At the top of the lob the screen path reversed, the steered
  axis swung through it, and for a frame the dart was drawn as a big sideways cross by the bull, then
  popped up by the 20 pointing down before falling onto its target. The side view also showed the
  "bigger arc" was the wrong fix: GamePigeon's real path is a gentle climb with almost no arc; the
  lob is what a camera behind the thrower makes of it.
- **End-on flights are drawn the size GamePigeon draws them**: the cross spans about what the
  flights span side-on (`a = u * 0.24` in `drawDart`, was 0.34, which made the stuck dart and the
  last half of every flight look too big).
- **It never decides where the dart lands.** The flight always ends exactly on the point the rules
  already chose (flick, computer, or an online log entry), so scoring and online replay are
  untouched; every stuck dart sits on `STUCK_AXIS`, so a replayed or restored dart looks the same as
  a fresh one. Tests in `darts/js/test.js` section 5 (lands exactly, climbs to the measured apex,
  climb then settle with no reversal, upright early, end-on by `TURN`, never sideways).
- How it was checked: GamePigeon frames and Game Hub frames (headless Chromium, `_tick(1/60)`)
  side by side, every second frame, same target. The tracking scripts are not in the repo; the
  method is: red pixels that are not red in the still frames, blob centre and width per frame.
- Online search for a reusable darts engine (2026-10-01) found only three.js/cannon physics demos,
  nothing that fits a no-dependency canvas game.

## Screens

- Setup (a cream card over the lower half, the board above it): Play Computer / 2 players / Online,
  Computer Easy/Medium/Hard (with the shared shape markers), First throw Alternate/Me/Them
  (Alternate is the default and flips every match, `nextStarter`), Play, Continue match, How to
  play. Settings persist on every tap (`gamehub.darts.v1`).
- Play: canvas board and darts (`render.js`, wall and board cached per layout), DOM for the
  plaques, darts-left icons, popups and banners. Banners sit in the gap between board and dart, or
  over the board's lower edge on a short screen. Seat colours red/blue, never red/green, and the
  active seat also carries a triangle marker.
- Pass and play: a "Pass to <name>" card between turns, tap when ready. Not recorded in stats.
- Result: winner's emoji, You win / You lose (or "<name> wins!"), the winner's turn count, a close
  X, Play again, Menu.
- How to play: one goal line, a ring diagram (x2, x3, 25/50), one-line rules, each measured to fit
  one row (`_fitHelp`, 11px floor).

## Stats

`recordResult('darts', difficulty, won)`, total/byDiff only (no sub-counter), recorded exactly
once per won match (`match.recorded`), vs computer only. My Stats draws it with the generic screen.
It is a competitive game, so it is NOT in `js/players-agg.js`'s `SOLO` set.

## Tests

- `node darts/js/test.js`: geometry (every target scores its value, wedge edges), the match (bust,
  win, no double-out, hand-over), 201 and 101, Cricket (marks, scoring, winning while behind does
  not count, in order, the computer finishing every game), the flick mapping, the flight.
- `node check-no-scroll.mjs darts`: setup, how to play, play screen, result, both hosts, both phone
  heights.
- `window.__dtTest.ui` is the test seam (`_launch(from, x, y)` throws a dart at board point x, y).

## Online challenges (2026-10-01)

Matt, after the first build: *"yes"* to turn-by-turn online play, GamePigeon's iMessage way. Cup
Pong's challenges (`cup-pong/js/mp.js`) are the model; no code is shared with them.

- **Where:** setup screen, Play: Computer / 2 players / **Online**. Online turns Play into "Online
  matches" (with "N waiting on you" under it) and opens the online home: Challenge someone, Your
  turn, Their turn, History. Files: `js/mp.js` (data), `js/mp-ui.js` (the list screens, lazily
  imported), `js/alert.js` (the launcher bubble; `alerts:` on the hub entry).
- **Which game:** `kind` on the match and on both index rows (optional; absent = 301). `validateGame`
  replays the log with that game's rules.
- **The node:** `darts/games/<id>` + `darts/index/<CODE>/<id>`, addressed by PLAYER CODE. Added to
  `database.rules.json` and `backups/rtdb-backup.mjs`'s `BRANCHES`. **PUBLISHED by Matt on
  2026-10-01** (he pasted the whole file; verified the same day: `darts/` reads, where it was
  refused before, and every other branch reads exactly as it did that morning, same 289 device
  records and 8597 plays).
- **A match is a LOG of darts**, each the point it landed on (x, y in R units, rounded to 1/10000),
  never a snapshot. `validateGame` replays it through `engine.js` and refuses the whole document if
  one dart does not replay (a dart out of turn, a claimed win the darts never produced). The phone
  rounds its own landing point the same way BEFORE scoring it (`_launch`), so a dart on a wire scores
  the same on both phones.
- **Written dart by dart** (`appendLog`, verified by re-read, idempotent on retry, a stale base is a
  conflict and never an overwrite), and kept in an outbox (`gamehub.darts.outbox.v1`) until the
  server has it. The index rows change only when the turn passes or the match ends.
- **The challenge is delivered when the challenger's first turn ends**: the other person's row is
  written only once it is their turn.
- **Opening a match** replays the log silently up to the other person's latest run, then FLIES that
  run one dart at a time to where each landed (`_mpCatchUp`). While it is their turn the match is
  watched, so their darts arrive live. You always sit on the LEFT (`.is-flip` when you are side 'b').
- **Counting:** each finished match is recorded once per phone (`gamehub.darts.counted.v1`) as
  `recordResult('darts', 'mp', won)`, whoever ended it. A match that ended while you were away
  gets a Game Over popup the next time you open online play.
- **Resign:** menu, Resign. The other person wins; a challenge never delivered is not handed to
  them as a win they never saw. Nothing is ever deleted.
- **No series yet** (Cup Pong and Hoops have 1/3/5); GamePigeon Darts is one game. Easy to add from
  Cup Pong's `seriesAfter` / `nextInSeries` if Matt asks.
- **No scrolling:** every list is drawn, then trimmed by measurement to what the card holds, with
  "+N more" (`fitList` in `mp-ui.js`). Matches beyond the cut are reached as the ones above them
  finish. The player picker narrows by search instead of growing.
- **Notifications:** `dartsTurnPush` in `functions/index.js` (decided by `decideDarts` in
  `functions/decide.js`): a challenge, your turn coming back (with the score), and a match the other
  person ended; a challenge names the game ("challenged you to Cricket (in order)"). **Written 2026-10-01, NOT yet deployed** (Matt: "i can't do the notification code
  until tonight"). It is live only after `firebase deploy --only functions`. The app half needs no
  change: `sw.js` opens any match a payload names (`data.match`), and the hub hands it to
  `alert.js`'s `armOpen`.
- **Tests:** `node test-darts-mp.mjs` (39 checks, including a 101 and a whole in-order Cricket match, two phones against an in-memory database);
  `node test-push.mjs` (the `decideDarts` cases). The screens were checked in headless Chromium with
  two browser "phones" against a stand-in database server, a whole match played to zero.

## Not built yet

- Sound.
