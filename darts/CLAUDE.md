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

## Rules (engine.js, pure, tested by `node darts/js/test.js`)

- **301, down to exactly zero. No double-out**: any dart that lands on zero wins. **Below zero is
  a bust**: the score goes back to where that turn started and the turn ends. I could not confirm
  from the recording whether GamePigeon requires a double to finish (no finish was filmed); no
  double-out is the simpler rule and the one GamePigeon is generally described with. If Matt says
  otherwise, it is one branch in `throwDart()`.
- Board geometry is the standard board in units of R (the double's outer wire): bull 50 inside
  0.0374R, 25 inside 0.0935R, treble 0.5824-0.6294R, double 0.9529-1R. `RING.frame` (1.27R) is
  the black number ring: a dart there sticks and scores nothing ("MISS!"); beyond it the dart
  falls off the wall.
- **The computer** (`computerThrow`) aims (`chooseTarget`) and then misses by a 2D gaussian
  (`SPREAD`: easy 0.30R, medium 0.17R, hard 0.085R). Aim: an exact one-dart finish if there is one
  (single, then double, then treble or bull); otherwise treble 20 above 80; otherwise a single
  that leaves 20 or less. Easy has no plan and throws at the bull. Measured averages per dart
  (4000 darts, seeded): easy 12.2, medium 14.1, hard 22.1. Hard usually finishes 301 in 4-6 turns.

## The throw (the one thing to tune on a real phone)

`flickLanding()`: touch anywhere below the board (or on the dart), the dart follows the finger,
let go moving upward.

- **Left/right**: the dart flies along the flick's line from where it was let go, so swiping toward
  a number aims at it.
- **Height**: the flick's upward speed alone, in screen heights per second, measured over the last
  ~90 ms before release. `FLICK_MID` (2.3) lands at the height of the bull; `FLICK_GAIN` (1.45R per
  doubling of speed) is logarithmic, so a soft flick and a hard one are equally forgiving. Below
  `FLICK_MIN` (0.55) or a drag shorter than 24 px it is not a throw and the dart drops back.
- A tiny random wobble (gaussian, 0.02R) so two identical flicks do not land on the same pixel.
- These three constants were set by reasoning and a synthetic flick in headless Chromium, **not
  yet on a real phone**. If Matt finds throws all landing high, raise `FLICK_MID`; all low, lower
  it; too twitchy, lower `FLICK_GAIN`.

## How the dart FLIES (2026-10-01, `js/flight.js`)

Matt, after playing it: *"The darts go more like a line drive than in the example video."* The first
build slid a shrinking picture of a dart straight to the landing point. GamePigeon's, filmed at 60
fps, flies AWAY from a camera behind the thrower: it rises up the screen big and upright, is nearly
over its target while still big, then tips over onto its flights and sticks showing them end-on.

- **A 3D model, seen through a pinhole camera** at 2.37 m (the regulation oche) with the focal
  length set so the board lands exactly where it is drawn. Every dart (in the hand, in flight,
  falling off the wall, stuck in the board) is a world tip point plus an axis, projected to a
  screen tip and tail; `render.js drawDart` draws from those two points and blends the flights to an
  end-on cross as the projected length shrinks below the dart's width.
- **Paced to the video, not a stopwatch.** A true constant-speed throw shrank fourfold in the first
  third, went end-on as soon as it was level with its target, then crawled (filmed and rejected the
  same day). So: the screen position moves evenly and slows into the board (`ease`); depth lags it
  (the dart stays big until late); a small rise (`ARC`) bows the path; and the axis is STEERED,
  side-on along the path until `TIP_FROM` and then onto `STUCK_AXIS`.
- **A bigger arc, on request** (Matt, same day: *"Yes I want a bigger one"*): every flight is now
  a LOB that peaks `ARC` (0.45) board radii ABOVE its landing point, whatever the target (the rise
  is solved per flight in `makeFlight`), then drops in nose-first. `FLIGHT_T` 0.34 s (was 0.2 s,
  the reference's own pace, when the arc was a small bow); `TIP_FROM` 70%. The dart points along its
  path ON SCREEN (corrected for perspective, or off-centre darts lean sideways), and at the top of
  the lob, where it nearly stops on screen, it noses over THROUGH end-on rather than swinging round.
  One number makes it bigger or smaller: `ARC`.
- **It never decides where the dart lands.** The flight always ends exactly on the point the rules
  already chose (flick, computer, or an online log entry), so scoring and online replay are
  untouched; every stuck dart sits on `STUCK_AXIS`, so a replayed or restored dart looks the same as
  a fresh one. Tests in `darts/js/test.js` section 5 (lands exactly, no lob, upright a third of the
  way, end-on when stuck, the hand dart's size).
- Online search for a reusable darts engine (2026-10-01) found only three.js/cannon physics demos,
  nothing that fits a no-dependency canvas game; the published dart physics (5-6 m/s, 15-20 degrees
  up, lands nose-down) informed the model instead.

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
  win, no double-out, hand-over), the computer (never aims past what is left, harder scores more,
  games finish), the flick mapping.
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
  person ended. **Written 2026-10-01, NOT yet deployed** (Matt: "i can't do the notification code
  until tonight"). It is live only after `firebase deploy --only functions`. The app half needs no
  change: `sw.js` opens any match a payload names (`data.match`), and the hub hands it to
  `alert.js`'s `armOpen`.
- **Tests:** `node test-darts-mp.mjs` (31 checks, two phones against an in-memory database);
  `node test-push.mjs` (the `decideDarts` cases). The screens were checked in headless Chromium with
  two browser "phones" against a stand-in database server, a whole match played to zero.

## Not built yet

- Sound.
