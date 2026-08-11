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

1. `aim` drifts the ball across the lane by `LATERAL_GAIN` (1.35), **folding at the rails** — a
   full-tilt flick banks, which is a legitimate way to line up a corner cup and costs
   `BOUNCE_LOSS` (0.13) energy per bounce.
2. Arrival energy below `SHORT_BELOW` (0.28) never made the ramp: it rolls back for nothing.
3. **Corner cups are checked BEFORE the rings** — a ball far enough out to reach one was never over
   the ring stack. Both conditions are required (`|u| >= 0.68` AND energy 0.74–0.92), which is what
   makes a 100 a real skill shot rather than "flick harder".
4. Otherwise the energy bands pick a ring. **The bands get narrower as they get more valuable**
   (10 is 0.16 wide, 50 is 0.08) — that gradient IS the difficulty of the game.
5. Above `OVER_ABOVE` (0.88) the ball flies over the back and drops into the 10. Scoring, but only
   just: the deliberate penalty that stops "flick as hard as possible" being a strategy.

`test.js` pins every band edge, both cups, the bank shot, and that the bands are contiguous (no
power between short and over scores nothing).

## The opponent, and why the tiers are the numbers they are

The AI is modelled as a HAND, not as a score: it picks a target and throws at it with a per-tier
error, so it misses the way a person misses (short, long, into the wrong ring) instead of being
handed points. Each tier also has a `greed`: how often it chases the x3 badge instead of its safe
target.

**Chasing the badge is the entire skill curve of this game**, and that is what the tuning is built
around. Measured over 600 full matches per cell, multiplier applied:

| | Easy | Medium | Hard |
|---|---|---|---|
| casual player (aims at the 40, never chases the badge) | 82% | 39% | 1% |
| player who chases the badge | 99% | 93% | 35% |

Easy was a **57% coin flip** for that casual player in the first build - it aimed at the 30 and got
there too often, which is not what the word Easy promises. It now aims at the 20 with more error
and almost never chases the badge.

**`test.js`'s per-ball averages UNDERSTATE every tier and must not be used for tuning** - they do
not apply the multiplier, and the AI chases it. That is why `test.js` has a second, whole-match
block that plays 300 real matches per cell against a simulated human and asserts the tiers stay in
order, that Easy is actually easy for someone who has not learned the badge (>65%), that Medium is
a contest and not a wall (15-60%), and that Hard is beatable by someone who has (>20%) but not a
pushover (<80%). Wide ranges on purpose: a tripwire for "the tiers got inverted", not a pin on the
exact tuning. Verified non-theatre by giving Easy Hard's config and watching four assertions go red.

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
