# Flick Soccer — flick-soccer/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in
> `js/CLAUDE.md`.

Table soccer with flicked discs, the kind usually called *soccer pool*, *finger soccer* or *table
soccer* on phones (Miniclip's Soccer Stars is the best-known one). Matt, 2026-10-11: *"Build a full
new game hub game"*, after picking this one from a list. He chose **offline first** (vs the computer
and two players on one phone; online challenges are a later stage) and **admin only** at release. Stage 2, online challenges, followed the same day (below).
Our name is **Flick Soccer** (es *Fútbol de Chapas*, the Spanish bottle-cap game).

## Hub integration

- In-hub `module: '../flick-soccer/js/ui.js'`, **immersive** (a full-bleed portrait pitch). Hub id
  `flick-soccer` (the folder); stats id `flicksoccer`. Prefix `.fs-root` / `.fs-`.
- **Admin only** (`devOnly: true`, no `released` date: that is the New pill's input and must be the
  day Matt releases it from the admin page). Its `GAME_META` row, My Stats tab and title strings
  shipped with the game, so every result recorded before release shows the moment it is released.
- `isInProgress()` is always `false`: the match is saved every time the pitch comes to rest
  (`gamehub.flicksoccer.save.v1`) and the setup screen offers **Continue match**. Leaving while a
  shot is still rolling plays that shot out first, off screen (`_settleNow`), so a goal in flight is
  never lost and a bad shot can never be taken back by quitting.
- The top row shares the hub's floating back button's row (menu button on the right); the
  scoreboard and the status line sit under it, and the pitch fills the rest, measured
  (`_layout`, docs/BUILDING-A-GAME.md Part 3).

## Files

| File | Role |
|---|---|
| `js/engine.js` | the pitch, the bodies, the physics (`step`, `runToRest`) and the rules (`settle`). Pure, no DOM, deterministic |
| `js/ai.js` | the computer: candidate shots, each SIMULATED with the real physics, best outcome played. A generator so the UI runs it in slices |
| `js/render.js` | the canvas: pitch (cached offscreen per size), discs, ball, aim guide |
| `js/ui.js` | setup, play screen, input, turn flow, menus, autosave, stats, the module contract, `window.__fsTest` |
| `js/strings.js` | EN/ES, every visible string and aria-label |
| `js/mp.js` | online challenges: the node, validation by replay, verified writes, the outbox, counting once |
| `js/mp-ui.js` | the Multiplayer screens (home, picker, history, Game Over), lazily imported |
| `js/alert.js` | what the launcher says about challenges (bubble, Challenges count, armOpen) |
| `js/test.js` | headless checks, `node flick-soccer/js/test.js` (~12 s; not precached) |
| `css/flick-soccer.css` | all styling |
| `index.html` | the standalone page (name gate before `init`) |

## The rules

- Five discs a side (keeper, two defenders, two forwards) and a ball. Blue (seat 0, the player) at
  the bottom attacks the top goal; red (seat 1, the computer or player 2) the reverse.
- **One flick a turn**, then the turn passes, whatever happened. Drag back from one of your discs and
  let go: the further back, the harder (full strength at `PULL_MAX`, 34 pitch units). A pull inside
  the dead zone, or weaker than `MIN_POWER`, is a cancelled aim, not a shot.
- **A goal is the ball wholly over the line** (`ball.y + BALL_R < 0`, or past `H`). It counts for
  whoever's goal it went in, so **an own goal counts for the other side**. Both teams line up again
  and **the side that conceded kicks off**.
- **First to the target wins**: 1, 2 (default) or 3 goals, chosen on the setup screen. There is no
  draw and no clock.
- **Discs cannot enter a goal.** Each goal line is a wall for discs only (`discOnly` in `SEGS`), so
  nobody can park a keeper in the net. The ball passes.
- **Line-ups (2026-10-11)**, Matt: *"Let people have options of starting lineups. Offensive or
  defensive too."* `FORMATIONS` in `engine.js`: **Balanced** (the original: keeper, two defenders, two
  forwards), **Attack** (keeper, one back, three up), **Defend** (keeper, three back, one up) and
  **Diamond**. Picked on the setup card's **Lineup** row (each pill draws its five discs); the pitch
  behind the card shows the pick. Both teams line up the same way again after every goal
  (`match.forms`, `[seat 0, seat 1]`). **Vs the computer it picks its own at random**; pass and play
  uses the one choice for both teams; an online challenge stores the challenger's choice for BOTH
  sides (`forms` on the document, OPTIONAL: a match without it, or with an unknown id, reads as
  Balanced, so every match and save from before line-ups replays exactly as it did). Every line-up
  keeps each disc in its own half, clear of the centre circle and of each other; `test.js` pins that.
  A phone still on the build before line-ups replays a non-Balanced challenge from the Balanced
  start, so the two pitches differ until it updates (the hub applies a new build on its own on the
  launcher); harmless while the game is admin only, and gone once both phones are current.
- Kick-off follows the repo convention: **Alternate** by default (`nextStarter` flips each match), or
  You / Computer (Blue / Red in two-player).

## Physics (engine.js) — correctness-critical

- Fixed step `DT = 1/240`, at most `MAX_STEPS` (24) steps a frame, so a stalled tab cannot teleport
  anything. Per-step travel at `MAX_SPEED` (250) is ~1 unit and at `SPEED_CAP` (380, what a struck
  ball can reach) ~1.6, both well under `BALL_R` (3.6), the thinnest thing that can be hit: nothing
  tunnels (docs/BUILDING-A-GAME.md, Part 3). Raise a speed only with the step.
- Walls are segments; their end points are the corners and goal posts. A circle meeting an end
  point bounces off it like a post, with no separate post code.
- Friction is exponential damping plus a small constant drag, so bodies actually stop
  (`STOP` = 1.2 u/s). Measured: a full-strength disc rolls ~150 units (about the pitch's length) in
  ~2 s; a full-strength ball ~290. A shot that has not stopped after `MAX_SHOT_SECS` (14) is frozen.
- A pair where neither body moves is skipped, which is most pairs most of the time; that is what
  makes the computer's simulations cheap.
- **Deterministic**: the same flick from the same position always ends the same way (the test
  checks it). The computer's plan is only worth anything because of this, and it is also what a
  future online mode would rest on (send the flick, both phones replay it).

## The computer (ai.js)

For each of its discs it tries: the "ghost ball" shot (the point behind the ball that sends it at
the left, middle or right of the goal mouth), the same off either side wall (targets mirrored in the
wall), straight through the ball at two strengths, and a drop back toward its own goal; then random
flicks to fill its budget. Each is simulated to rest. A goal scores 10000, an own goal -20000;
otherwise `judge()` rewards the ball far from its own goal, and (Medium, Hard) punishes leaving an
opponent disc lined up behind the ball on its goal with nobody in the way, and rewards a disc
guarding its goal mouth.

| | shots tried | aim error (sd) | strength error | fears the reply |
|---|---|---|---|---|
| Easy | 26 | 0.11 rad | 14% | no; and 45% of the time picks from its top third instead of the best |
| Medium | 80 | 0.04 rad | 7% | partly |
| Hard | 190 | 0.013 rad | 2.5% | yes |

Measured (`node flick-soccer/js/test.js`): Hard beat Easy 10/10, Medium beat Easy 9/10, ~15 turns
for a first-to-2 match, slowest Hard plan ~140 ms (run in 7 ms slices between frames, so the
screen never stalls). The computer thinks for at least `CPU_MIN_THINK` (0.55 s), then its aim arrow
grows for `CPU_AIM_SECS` (0.5 s) before it flicks, so a player sees what it chose.

**Not tuned against people yet.** If Hard is unbeatable or Easy too easy, the knobs are the
`LEVEL` table in `ai.js`.

## The screen

- **Aiming help depends on the difficulty (2026-10-11)**, Matt: *"on easy it should show the power,
  aim arrow, and bounce line of the ball on medium, just the power and aim arrow and on hard just
  power"*. `AIDS` in `ui.js`:

  | | power ring | aim arrow | guide + ball's bounce line |
  |---|---|---|---|
  | Easy | yes | yes | yes |
  | Medium | yes | yes | no |
  | Hard | yes | no | no |

  **Pass and play and online are Medium** (there is no difficulty there, and online both players
  should get the same help). The thin pull string from the disc to the finger shows on every level:
  it is the drag itself. The **guide** is a dotted line from the disc to the first thing it will
  touch and a ghost circle there; the **bounce line** (`ballPath` in `engine.js`) is where the ball
  heads from that touch, reflected off the walls up to twice, ending at the first disc in its way or
  in a goal mouth, longer the harder the pull. It is a guide for the eye, not a prediction: no spin,
  friction or follow-through, and it is never on the physics path. The computer's own aim (and a
  replayed online flick) always draws its arrow, so you can see what it did.
- **Teams carry a SHAPE as well as a colour** (colourblind rule): blue discs a white triangle, red
  discs a white square, and the same chips sit on the scoreboard and the result line.
- **Whose turn** is shown three ways: the scoreboard side gets an accent border and underline bar,
  the status line names it ("Your turn: drag back from a blue disc"), and that side's discs carry a
  dashed accent ring (pulsing, steady under reduced motion).
- GOAL! banner over the centre circle for 1.7 s of game time, with "Own goal" when the shooter put
  it in their own net. Reduced motion keeps the banner and drops the zoom.
- No sound (root `CLAUDE.md`, "No sound, ever").

## Settings and storage

| Key | What |
|---|---|
| `gamehub.flicksoccer.v1` | `{ mode: 'cpu'|'pass', difficulty, goals: 1|2|3, first: 'alt'|'me'|'them', lineup, nextStarter }`, saved the moment a control changes (`lineup` added 2026-10-11, absent reads Balanced) |
| `gamehub.flicksoccer.save.v1` | `{ mode, diff, match }` at rest; removed once the match is won |

The difficulty default follows the shared profile's first opponent skill (1/2/3 -> Easy/Medium/Hard)
until a choice is saved.

## Stats

`recordResult('flicksoccer', difficulty, won)`, **vs the computer only** (two players on one phone
is not recorded, as in Darts), once per match (`match.recorded`). `total`/`byDiff` only: no
sub-counter, so the generic My Stats screen draws it and `players-agg.js` needs no branch.

## Tests

- `node flick-soccer/js/test.js`: 3600 random shots stay inside the pitch, never leave a disc in a
  goal, never overlap at rest and always end; a shot replays identically; the rules (turns, own
  goal, kick-off after a goal, the win); a ball rolled over the line is a goal and a disc driven at
  the mouth stops at the line; whole computer-vs-computer matches finish and the stronger level wins.
- `node check-no-scroll.mjs flick-soccer`: setup, how to play, play screen and result, standalone and
  in the hub, at two phone heights (16 screens, 0 scroll on 2026-10-11).
- Driven by hand in Chromium at 390x844 and 320x568: a real drag-and-flick, the computer's turn,
  a whole match to the result (recorded as one Easy win), two players, quitting mid-shot (the shot
  is played out and saved at rest) and Continue match, Spanish.

## Online challenges (stage 2, 2026-10-11)

Matt, after the offline release: *"Go"* (to stage 2, turn-by-turn online play). Darts' challenges
(`darts/js/mp.js`, `mp-ui.js`, `alert.js`) are the model; no code is shared with them.

- **Where:** the setup card's first row is **Multiplayer ›** (with a "N waiting on you" badge), as in
  Darts and Cup Pong. Behind it: Challenge someone, **Pass & play** (two people, this phone; it used
  to be the setup card's Opponent row, which is gone), the notify row, Your turn, Their turn,
  History. A challenge uses the Goals to win and the Lineup chosen on the setup card (the line-up for
  both sides, optional `forms` on the document); the challenger kicks off.
- **The node:** `flicksoccer/games/<id>` + `flicksoccer/index/<CODE>/<id>`, addressed by PLAYER CODE.
  In `database.rules.json` and `backups/rtdb-backup.mjs`'s `BRANCHES`. **PUBLISHED by Matt on
  2026-10-11** (verified the same day: `flicksoccer/` reads, every other branch reads as before).
- **A match is a LOG of flicks**: `{ by, k (disc 0-4 of that side), dx, dy (unit vector, 6 dp), p
  (strength, 4 dp) }`. `validateGame` replays it through `engine.js` and refuses the whole document if
  one flick does not replay (out of turn, a claimed win the flicks never produced). The flicking phone
  plays its own shot from the ROUNDED numbers (`roundShot`, in `_shoot`), so what it saw is exactly
  what the other phone replays.
- **Why replay is safe across phones:** the physics path uses only + - * / and `Math.sqrt`, which
  IEEE 754 requires to round exactly, so JavaScriptCore (iPhone) and V8 (Android, Chrome) produce the
  same bits. `Math.hypot` was taken off the physics path for this (it is not required to agree).
  `test-flicksoccer-mp.mjs` fails if any other `Math.` function appears there. **Proven in one engine
  (V8) only: both "phones" in the tests ran Chromium.** An iPhone against an Android phone is the
  real check, and a divergence would show as the two phones disagreeing about a goal.
- **Written at the moment of the flick** (`appendLog`, verified by re-read, idempotent on retry, a
  stale base is a conflict and never an overwrite), and kept in an outbox
  (`gamehub.flicksoccer.outbox.v1`) until the server has it. Rows change only when the turn passes or
  the match ends. The challenge reaches the other person when the challenger's first turn ends.
- **Opening a match** replays the log silently up to the other person's latest run, then PLAYS that
  run on the pitch (their aim arrow grows, then the flick rolls), reusing the computer's path
  (`this.cpu` with `replay: true`). While it is their turn the match is watched, so their flick plays
  as it lands.
- **You are always at the bottom**: the player on side b sees the pitch turned half round
  (`render.js` `flip`; a rotation, not a mirror, and the pitch is symmetric) and their own side of
  the scoreboard on the left (`.is-flip`). Team colours stay with the side: the challenger is blue.
- **Counting:** each finished match is recorded once per phone (`gamehub.flicksoccer.counted.v1`) as
  `recordResult('flicksoccer', 'mp', won)`. A match that ended while you were away gets a Game Over
  popup the next time you open Multiplayer. No draws exist.
- **Resign:** menu, Resign, confirm. The other person wins; a challenge never delivered is not handed
  to them as a win they never saw. Nothing is ever deleted.
- **Notifications:** `flickSoccerTurnPush` in `functions/index.js` (`decideFlickSoccer` in
  `functions/decide.js`): a challenge ("challenged you, first to 2"), your turn coming back (with the
  score), a match the other person ended. **DEPLOYED by Matt on 2026-10-11** ("done").
  Not yet seen arriving on a phone; the first real challenge is the test. A tap opens that match (`sw.js` reads `data.match`;
  the hub hands it to `alert.js`'s `armOpen`).
- **The hub:** the registry entry has `alerts:` (launcher bubble, Challenges button count), and
  `js/challenges.js` lists `flick-soccer`, so the hub's Challenges screen shows these matches.
- **Tests:** `node test-flicksoccer-mp.mjs` (42 checks: stored-shot rounding, a whole computer-played
  match replayed to the same pitch on both phones, delivery, retries, conflicts, own goal, resign,
  counting once, the outbox, the launcher bubble, rules/backup/push wiring, the determinism guard);
  `node test-push.mjs` (the `decideFlickSoccer` cases); `test-challenges.mjs` and
  `test-admin-config.mjs` (the online gate) include it. Driven in two Chromium "phones" against a
  shared stand-in database: challenge, Ana's phone replays Matt's flick on a turned-round pitch, her
  reply reaches Matt, both pitches identical after two flicks, resign, the win counted as `mp`.

## Not built yet

- A series (best of 3/5) for online challenges, if Matt wants one (Cup Pong's `seriesAfter` is the
  model).
