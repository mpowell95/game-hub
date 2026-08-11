# Skeeball (`skeeball/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

Built 2026-08-11 as a clone of the Skee-Ball game in Matt's reference recording,
`reference/skeeball/Skeeball 1.MOV`. **Read `reference/skeeball/SPEC.md` before touching the
look** — it is the measured record of that recording (geometry as fractions, sampled hex), taken
while the video was open, and it is a citation, not a style opinion (`reference/README.md`). If
something here looks wrong, the fix is a new screenshot, not a new hex code.

Matt's one instruction beyond "clone it": *"it's ok if it's a little more cartoony. Like our other
games."* That licence was spent on **saturation and contrast only** — every hue and every position
in the layout is still the measured one. The nudge is in `render.js`'s `C` palette and nowhere else.

## Hub integration

In-hub `module:` (`skeeball/js/ui.js`), **immersive** — the alley is full-bleed and the HUD carries
its own scores, so the hub's header row would be wasted height (same call as Escoba and Ball Run).
The HUD's left padding (`64px`) exists to clear the hub's floating back button; do not remove it.

`isInProgress()` uses the **AUTOSAVE/RESUME** meaning and always returns `false`. Skeeball is
strictly turn-based with no clock of its own, so leaving mid-rack is lossless: every landed throw
snapshots to `gamehub.skeeball.save.v1` and the setup screen offers **Resume**. It is deliberately
NOT in the live-action class (Ball Run / Snake / Hill Climb) — do not "fix" this by making it
return true mid-game.

## Layout & responsibilities

```
skeeball/js/game.js      pure engine: the throw model, scoring, the multiplier, the AI, save/restore
skeeball/js/render.js    pure drawing: the alley, the board, the ball, the badge, the popups
skeeball/js/ui.js        DOM shell: setup, the rAF loop, flick input, the opponent's turn, stats
skeeball/js/strings.js   every user-visible string, { en, es }
skeeball/js/test.js      headless engine assertions (node skeeball/js/test.js), in run-all-tests.mjs
skeeball/css/skeeball.css  all styles, .sk- prefixed, every rule descendant-scoped under .sk-root
skeeball/index.html      standalone host (same init() as in-hub), name-gated before mount
```

## The throw model — the one thing to understand

**A throw is resolved from two numbers and nothing else**, by a PURE function
(`resolveThrow(power, aim)`):

| Input | Range | Meaning |
|---|---|---|
| `power` | 0..1 | how far the flick travelled, as a fraction of `POWER_SPAN` (42%) of the canvas height |
| `aim` | -1..1 | how far sideways, as a fraction of `AIM_SPAN` (30%) of its width |

**There is no random scatter on a player's throw, deliberately.** The player is judging a flick; a
hidden dice roll on top of that judgement would make practice pointless. It also means the
animation can be derived from the same resolved numbers (`res.offset`, `res.energy`), so what the
ball is drawn doing and what the scoreboard says can never disagree. If you add variance later,
add it to the AI's hand (where it already lives), not to the resolver.

Resolution order, all in `game.js`:

1. `aim` drifts the ball across the lane by `LATERAL_GAIN` (1.35), **folding at the rails** - a
   full-tilt flick banks, which is a legitimate way to line up a wide target and costs
   `BOUNCE_LOSS` (0.13) energy per bounce.
2. Below `SHORT_BELOW` (0.28) the ball never made the ramp; above `OVER_ABOVE` (0.94) it sails over
   the back. Both score nothing.
3. In between, energy maps to a DEPTH in board space and the offset to an x, and **the first target
   ellipse containing that point wins**. Targets are ordered small-and-valuable first, catch-all
   last, so the 100 cups beat the 50's area where they overlap.
4. Every board ends with a **catch-all** covering the whole playfield, so a ball that stays on the
   board always scores something - short of the 20, wide of the stack, or long of the 50 all give
   the 10. That is the classic machine's real behaviour and it is why there is no dead band.

**The drawn oval and the catch-all are deliberately different ellipses** (see `boards.js`): the
oval is scenery, the catch-all is scoring. Do not "fix" the mismatch by equating them.

`test.js` pins the target windows, both cups, the bank shot, that power walks the stack in order,
and that no power between short and over scores nothing.

## Machines, unlocking and the three scores (2026-08-11 rework)

Matt: *"I want skeeball and pinball to be similar in that they each have multiple maps that need to
be unlocked... this should replace the computer player."* So:

- **There is no computer opponent.** The old easy/medium/hard AI is gone. A game is nine balls
  against the scoreboard. (The tuning work that went into it is not lost - the numbers and the
  method are in git history and in this file's own history; do not re-derive them if the AI ever
  comes back for a reason.)
- **A board is DATA** (`js/boards.js`): a palette, a target layout, and the score that unlocks the
  next machine. Adding one should touch nothing else. `classic` is measured off IMG_3952;
  `stars` is a second machine with a genuinely different LAYOUT (targets scattered wide, so it
  rewards aim where classic rewards power control) rather than a recolour - the reference's own
  locked machines change the layout too, and a ladder of reskins is not worth climbing.
- **Unlock rule: beat the next machine's target score on the one before it** (Matt's choice from
  three options). `unlockScore` on the entry; `Game.unlocks()` decides; the end card announces it.
- **Boards ARE the difficulty axis**, so `byDiff` is keyed by board id - Hill Climb's precedent
  (`hillclimb/CLAUDE.md`, "Stages ARE the difficulty axis"). The old `easy`/`medium`/`hard` buckets
  from the vs-computer build are untouched and still count in the leaderboard's All filter.

### The three numbers on the cabinet head

The marquee shows the app-wide **RECORD** for that machine, the live **SCORE**, and your **BEST**.
IMG_3960's own `BALL  SCORE` LED panel is the precedent for putting them in the cabinet head rather
than in a floating HUD.

**The app-wide record is DERIVED at read time from the already-synced player records**
(`js/arcade-scores.js`'s `appWideBest`, fed by the same `watchPlayers` + `players-agg` the
leaderboard uses). There is deliberately **no shared `highscores/` node**: no new write path, no
rules change, no way for one device to corrupt a number everyone sees, and it cannot disagree with
the leaderboard. The cost is that a new record appears only after that player's device next syncs,
and offline the marquee shows a dash rather than a stale number. **Unverified against real
Firebase** - a cloud session cannot reach it (same honest caveat as Pool's and Boggle's MP).

### Why "resets every 24 hours" does not reset anything

The daily best is a **date-keyed map**, `daily: { '2026-08-11': 640 }`, and "today" is a READ of
today's key. Nothing is ever cleared, there is no expiry job to get wrong, and the player keeps a
real per-day history for free. A `todayBest` field plus a timer would have been THE LAW rule 2
violated with a cron attached. Local calendar day, not UTC - "today" has to mean what the player
thinks it means. `test-arcade-scores.mjs` pins all of it.

### Shared with Pinball from day one

`js/arcade-scores.js` owns the score/unlock semantics for both games rather than Skeeball owning
them and Pinball copying them later. Matt named both games in the same breath, this layer is where
THE LAW lives, and this repo's own notes record what happens when "extract it when the second one
arrives" meets a session with no memory of the first. Pinball needs to pass its own sub-counter key
(`pb`) to `appWideBest` - that parameter exists precisely so the shared module has no opinion about
whose boards it is reading.

## Deviations from the reference, and why

- **9 balls per rack, 1 round by default** (3 is a setup option). The reference shows `ROUND 1/3`
  with a rack of roughly this size, i.e. ~27 throws per player — fine for an async chat game played
  over hours, far too long for one sitting here. One rack of nine is a classic skeeball game and is
  the default; the reference's 3-round format is one tap away.
- **The opponent is a computer**, not a second human over the network. The reference is
  two-player-async inside a chat app; this hub has `js/net.js` for real multiplayer and Skeeball
  does not use it (see "Not done" below).
- **The aim guide and power bar are ours.** The recording never shows its input at all
  (`SPEC.md`, "What it does NOT show"), so the flick, the dashed predicted path and the power bar
  are this build's own choices. The dashed path runs the SAME fold maths the engine will apply, so
  the guide cannot lie about where the ball is going.
- **Turn handover is per ROUND, matching the reference** ("claycors scored 660 points" then
  "Your Turn"), not per ball.

## Rendering

`render.js` authors everything in a fixed **design box** (`DW` 480 x `DH` 1000, the recording's own
aspect once the host app's chrome is off) and `layoutFor()` scales it to fit whatever box the game
is mounted in, "contain" and centred. The leftover margin is painted with the same dark side-wall
grey the reference already has beside the lane, so a letterbox reads as more arcade rather than as
a bug — and that is *why* the same layout passes the `fit` check in both hosts and at both phone
heights without a second layout path.

One function does all the perspective:

```
sc(v) = 1 / (1 + v * (NEAR_OVER_FAR - 1))       v: 0 = foul line, 1 = the board
```

Widths, ball radius, rail chevron spacing and the screen `y` all derive from it. Getting them from
one function rather than three hand-tuned curves is why the ball never looks like it is sliding
against the lane it is rolling on. **`NEAR_OVER_FAR` (1.988) is measured** — SPEC.md's lane widths
at y 0.49 and the bottom edge. Do not round it to 2 "for tidiness"; re-measure if you change it.

The alley is static between throws, so `ui.js` paints it once per resize into an offscreen canvas
and blits it each frame; only the ball, badge, queue, popup and aim guide are drawn per frame.

**The canvas scene is identical in light and dark.** It is a dark arcade in both by design, so the
`:root.gh-dark .sk-root` block themes only the chrome around it (setup screen, help sheet, end
modal). That is a deliberate choice, not a missing Phase 2 pass.

## Fitting the screen

`_fit()` **collapses `.sk-game` to 0 height before measuring**, then sets an explicit pixel height
from `window.innerHeight - rect.top`. Both halves matter and both are lessons from
`VISUAL-PROCESS.md` 3c:

- The root never asks for `100dvh`. In the hub the same element sits under ~98px of
  floating-back-button padding, so a viewport-height request overflows the instant it is mounted.
- `getBoundingClientRect().top` is viewport-relative, so measuring it while our own overflow is
  scrolling the page reads a value that is wrong in exactly the direction that hides the bug.
  Collapsing first removes us as a possible cause of that scroll.

## Settings & persistence

| Key | Holds |
|---|---|
| `gamehub.skeeball.v1` | `{ difficulty, rounds }` — the setup screen's choices |
| `gamehub.skeeball.save.v1` | the in-progress match snapshot; removed on game over |

Precedence for `difficulty`: saved setting > profile skill (1/2/3 → easy/medium/hard) > medium.
A resumed match keeps the rules it was STARTED with, whatever the setup screen now says.

`Game.restore()` returns `null` (never throws) on anything malformed, so a corrupt or truncated
save can only ever mean "no game to resume", never a crash on mount. The rng is deliberately not
captured in the snapshot: a resumed match re-rolls its multipliers from a fresh stream, which
changes nothing a player could notice and keeps the save plain JSON.

## Stats

`recordSkeeball(difficulty, won, extras)` in `js/game-stats.js`. `won` is `true`/`false`/**`null`
for a tie** — both totals can genuinely land equal, so unlike Battleship this game really can draw
and `sk.tied` is stored explicitly rather than derived.

`sk: { played, won, lost, tied, balls, points, bestGame, bestThrow, hundreds, fifties }`.
Counters add; `bestGame`/`bestThrow` are `Math.max` only (THE LAW rule 2). `extras` describes the
HUMAN's side of the match only — `game.js` keeps that tally itself (`this.tally`) rather than the
UI counting, so a restored save carries it instead of restarting at zero.

All three mandatory surfaces exist from day one (root checklist item 7), and
`players-agg.test.mjs`'s structural guard fails the build if any goes missing:

1. `ensureSk()` + `recordSkeeball()` in `js/game-stats.js`
2. the `src.sk` branch in `js/players-agg.js` (without it the screen reads zeroes the moment a
   person's second device syncs, with every local store intact)
3. `skeeballScreen()` in `js/game-stats-ui.js`, plus the `game_title_skeeball` tab

Also registered on the leaderboard (`GAME_META` + three "who leads what" texture chips). Skeeball
is COMPETITIVE, not in `players-agg.js`'s `SOLO` set: it has a real opponent and a real loss axis.

Recorded ONCE per match in `_finish()`, before the modal shows, so a fast "play again" cannot skip
it. A quit game never reaches the recorder, so walking away can never mint a counter.

## Tests

```
node skeeball/js/test.js
```
Band edges (including that the bands are contiguous), both corner cups, the weak-and-wide miss,
the bank shot and its energy cost, purity, the multiplier's reach and its x3, match flow at 1 and 3
rounds, a genuine tie, the human-only tally, save/restore round trips and three malformed-save
cases, and the opponent twice over: per-ball averages ordered easy < medium < hard, and the
whole-match win-rate block described above.

**Played end to end through the real UI** (2026-08-11, standalone at 393x852): nine flicks
including a deliberate airball, a flat-out throw that sailed over for 10, and both corner cups;
the handover card; the opponent's full rack; the end modal; and the recorded stats
(`balls: 9, points: 450, bestGame: 450, bestThrow: 100, hundreds: 2, fifties: 2`). Resume was
checked separately: three throws, reload, Resume restores the same score on the same ball.

## Not done, on purpose

- **No multiplayer.** `js/net.js` is right there and the reference is a two-player game, but a
  lockstep pass is its own milestone with its own invariants (`js/CLAUDE.md`) — and Skeeball has an
  unusual shape for it: like Boggle, nothing either player does changes the other's board, so it
  would be a self-report protocol rather than a move log. Read that section before starting.
- **No how-to-play MOTION or PLAY probe tuning beyond the basics.** The `PLAY` probe added to
  `test-visual.mjs` drives a real flick to a real score; if you add mechanics, extend it.
