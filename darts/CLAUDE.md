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
- **ADMIN ONLY at first** (`devOnly: true`, no `released` date). Matt releases it from the admin
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

## Screens

- Setup (a cream card over the lower half, the board above it): Vs computer / Pass and play,
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

## Not built yet

- **Online / turn-by-turn challenges** like GamePigeon's iMessage play. That needs a new Firebase
  node (rules published by Matt) and, for notifications, a Cloud Function deploy by Matt - the
  same shape as Cup Pong's challenges (`cup-pong/CLAUDE.md`, "Challenges").
- Sound.
