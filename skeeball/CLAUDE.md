# Skeeball (`skeeball/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

Built 2026-08-11 as a clone of the Skee-Ball game in Matt's reference recording,
`reference/skeeball/Skeeball 1.MOV`. **Read `reference/skeeball/SPEC.md` before touching the
look** — it is the measured record of that recording (geometry as fractions, sampled hex), taken
while the video was open, and it is a citation, not a style opinion (`reference/README.md`). If
something here looks wrong, the fix is a new screenshot, not a new hex code.

> **SPEC.md's FIRST colour table is the picker ICON, not the machine.** Read its "2026-08-11"
> section before using any hex from this file's history. Those teal-and-white values came off
> IMG_3952, which is the Collector's Edition menu screen showing a small stylised cabinet on a
> teal background — not the board you play on, which is cream, wood-brown and deep red with no
> green in it anywhere. Mistaking one for the other is why the first two builds of this game
> looked nothing like the thing they clone.

## The 2026-08-11 rebuild — what Matt actually saw

Matt uploaded two screen recordings of this game (`reference/skeeball/Skeeball 2.MOV`,
`reference/Skeeball 3.MOV`) with: *"SKEEBALL IS TERRIBLE. Look at how horrible the gameplay is."*
Watch them next to `Skeeball 1.MOV`. Six balls score 40 points, "Too hard!" fires over and over,
and the board is a flat grey donut on a green rectangle with two-thirds of the screen empty lane.

Both halves were real and both are fixed, each with its own note at the site:

| What was wrong | Where the fix and its reasoning live |
|---|---|
| Every cup was a **21px flick window**; 34% of the flick range scored zero | `game.js`'s constants block, `boards.js`'s target table |
| Green-and-silver, from the picker icon's palette | `boards.js`'s `CLASSIC_PALETTE` |
| A flat panel, not a dish: no concavity, no cast shadows, a rail with no thickness | `render.js`'s `drawMachine` |
| Small cold cylinders with floating labels | `render.js`'s `drawTube` |
| The board got 33% of the height, an empty lane got 44% | `render.js`'s `Y` anchors |
| The aim guide used `1.35` while the engine used a different gain — it could lie | `render.js`'s `drawAimGuide` |

**The lesson worth keeping** is not any one number: it is that this game's difficulty was twice
set in board-space fractions, which say nothing about whether a person can hit anything. The
guard is `test.js`'s `[KNOWN-BUG PROBE] a thumb can actually hit these` block, which converts the
whole model — target sizes, band edges, POWER_SPAN, AIM_SPAN — into the pixels a thumb has to
travel on a 393x852 phone and fails under 40px. It goes red on the exact build Matt recorded.
`POWER_SPAN`/`AIM_SPAN` live in `game.js` for this reason: while they sat in `ui.js` no test
could see both halves of the model at once.

Matt's one instruction beyond "clone it": *"it's ok if it's a little more cartoony. Like our other
games."* That licence was spent on **saturation and contrast only** — every hue and every position
in the layout is still the measured one. The nudge lives in `boards.js`'s palettes and nowhere else.

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
skeeball/js/game.js      pure engine: the throw model + its flick calibration, scoring, unlocks, save
skeeball/js/boards.js    the machines as DATA: palette, target layout, unlock score
skeeball/js/render.js    pure drawing: the cabinet, marquee, board, ball, badge, popups, picker art
skeeball/js/howto.js     the HOW TO PLAY carousel (repo pattern; yahtzee/js/howto.js is the model)
skeeball/js/ui.js        DOM shell: the machine carousel, the rAF loop, flick input, stats
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
| `power` | 0..1 | how far the flick travelled, as a fraction of `POWER_SPAN` (55%) of the canvas height |
| `aim` | -1..1 | how far sideways, as a fraction of `AIM_SPAN` (42%) of its width |

`POWER_SPAN` and `AIM_SPAN` are exported from **`game.js`**, not `ui.js`. They are half of the
model: a target's size in board space is meaningless until multiplied through them, and while they
lived in the UI file no test could check the two halves together. Both bad tunings shipped that way.

**There is no random scatter on a player's throw, deliberately.** The player is judging a flick; a
hidden dice roll on top of that judgement would make practice pointless. It also means the
animation can be derived from the same resolved numbers (`res.offset`, `res.energy`), so what the
ball is drawn doing and what the scoreboard says can never disagree. There is no opponent to hide
variance in either (see "Machines, unlocking..." below), so if you ever add scatter, it lands
squarely on the player and you should expect them to notice.

Resolution order, all in `game.js`:

1. `aim` drifts the ball across the lane by `LATERAL_GAIN` (1.15), **folding at the rails** - a
   full-tilt flick banks, which is a legitimate way to line up a wide target and costs
   `BOUNCE_LOSS` (0.13) energy per bounce.
2. Below `SHORT_BELOW` (0.10) the ball never made the ramp; above `OVER_ABOVE` (0.96) it sails over
   the back. Both score nothing. **Judge these in flick-pixels, never as fractions** - 47px and
   450px on an 852px phone. The old pair (0.28/0.94) meant a third of every flick scored zero.
3. In between, energy maps to a DEPTH in board space and the offset to an x, and **the first target
   ellipse containing that point wins**. Targets are ordered small-and-valuable first, catch-all
   last, so the 100 cups beat the 50's area where they overlap.
4. Every board ends with a **catch-all** covering the whole playfield, so a ball that stays on the
   board always scores something - short of the 20, wide of the stack, or long of the 50 all give
   the 10. That is the classic machine's real behaviour and it is why there is no dead band.

**The drawn oval and the catch-all are deliberately different ellipses** (see `boards.js`): the
oval is scenery, the catch-all is scoring. Do not "fix" the mismatch by equating them.

`test.js` pins the target windows, both cups, the bank shot, that power walks the stack in order,
that no power between short and over scores nothing, and - the block that matters most - that
every one of those windows is a distance a thumb can actually repeat.

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

- **9 balls per rack, one rack per game.** The reference shows `ROUND 1/3` with a rack of roughly
  this size, i.e. ~27 throws per player — fine for an async chat game played over hours, far too
  long for one sitting here. One rack of nine is a classic skeeball game.
- **There is no second player at all.** The reference is two-player-async inside a chat app; this
  build is one rack against the scoreboard, by Matt's instruction (see "Machines, unlocking and the
  three scores"). This hub has `js/net.js` for real multiplayer and Skeeball does not use it (see
  "Not done" below).
- **The aim guide and power bar are ours.** The recording never shows its input at all
  (`SPEC.md`, "What it does NOT show"), so the flick, the dashed predicted path and the power bar
  are this build's own choices. The dashed path runs the SAME fold maths the engine will apply, so
  the guide cannot lie about where the ball is going.

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
| `gamehub.skeeball.v1` | `{ board }` — the machine you last picked, so the picker opens on it |
| `gamehub.skeeball.save.v1` | the in-progress rack snapshot; removed on game over |

Which machines are UNLOCKED is deliberately **not** here: it is earned history, so it lives in
`gamehub.stats` under `sk.unlocked` where it syncs across a person's devices and is union-merged
rather than overwritten (`js/arcade-scores.js`). A settings key is one device's preference; an
unlock is not. A resumed rack keeps the machine it was STARTED on, whatever the picker now shows.

The snapshot is **v2**. `Game.restore()` declines a `v: 1` save (the vs-computer build's shape)
rather than misreading it as a rack — those saves are only ever an in-progress game, never a
recorded result, so nothing earned is lost by declining one.

`Game.restore()` returns `null` (never throws) on anything malformed, so a corrupt or truncated
save can only ever mean "no game to resume", never a crash on mount. The rng is deliberately not
captured in the snapshot: a resumed match re-rolls its multipliers from a fresh stream, which
changes nothing a player could notice and keeps the save plain JSON.

## Stats

`recordSkeeball(boardId, extras)` in `js/game-stats.js`. A finished rack is always a "win" as far
as `bumpTotals` is concerned, the same solo pattern Ball Run and Hill Climb use: there is nobody to
lose to, so `byDiff[boardId].played` is the honest play count per machine.

`sk: { played, won, lost, tied, balls, points, bestGame, bestThrow, hundreds, fifties, boards,
unlocked }`. Counters add; `bestGame`/`bestThrow` are `Math.max` only (THE LAW rule 2). `boards`
and `unlocked` were added with the boards rework and are both ADDITIVE — `ensureSk()` fills them in
on any device that has not played since, and their shape and merge rules belong to
`js/arcade-scores.js`, not here.

**`sk.won` / `sk.lost` / `sk.tied` are FROZEN** (THE LAW rule 5). They are the vs-computer era's
win/loss record. There is no opponent to add to them any more, so the writer never increments them
again — and never clears them either. My Stats still shows them when they are non-zero, because a
number a player earned does not stop being theirs when the mode goes away (rule 1).

`extras` = `{ score, balls, hundreds, fifties, bestThrow, at }`. `game.js` keeps that tally itself
(`this.tally`) rather than the UI counting, so a restored save carries it instead of restarting at
zero. `at` is the finish time, used only to pick the local day bucket for the daily best, and is
injectable so the tests are not clock-dependent.

All three mandatory surfaces exist from day one (root checklist item 7), and
`players-agg.test.mjs`'s structural guard fails the build if any goes missing:

1. `ensureSk()` + `recordSkeeball()` in `js/game-stats.js`
2. the `src.sk` branch in `js/players-agg.js` (without it the screen reads zeroes the moment a
   person's second device syncs, with every local store intact)
3. `skeeballScreen()` in `js/game-stats-ui.js`, plus the `game_title_skeeball` tab

Skeeball is in `players-agg.js`'s **`SOLO`** set — with the opponent gone there is no loss axis, so
a win-rate column would read 100% and mean nothing. It is **not** on the leaderboard
(`js/leaderboard-ui.js`'s `GAME_META`) while it is `devOnly`: an admin-only game has exactly one
possible player, so a board of one is noise. The texture chips are still written and the comment
there says to put the entry back the day `devOnly` drops.

Recorded ONCE per rack in `_finish()`, before the modal shows, so a fast "play again" cannot skip
it. A quit game never reaches the recorder, so walking away can never mint a counter.

## Tests

```
node skeeball/js/test.js        the engine and the boards
node test-arcade-scores.mjs     the shared score/unlock layer (bests, the daily map, merges)
node test-visual.mjs skeeball   light/dark/reduced, both hosts at two phone heights, and a real flick
```

`test.js` covers: every board being well formed (unique ids, a catch-all last, the badge never on
it), the short/over bands, that power walks the stack `20 → 30 → 40 → 50` in order, both corner
cups and the weak-and-wide miss, the bank shot and its energy cost, purity, the multiplier's reach
and its x3, a nine-ball rack refusing a tenth throw, unlocking (and the last board unlocking
nothing), and save/restore including three malformed saves and a declined `v: 1`.

**The "cups do NOT tile" block is a [KNOWN-BUG PROBE]** for Matt's *"the balls are guided in. That's
not fun"* (2026-08-11). Three things had compounded: the catch ellipses were ~16% wider than the
cups actually drawn, their depth (`ry`) exceeded half the pitch so the stack tiled with no gap
between cups, and the ball animation lerped to the target's centre instead of to where it landed.
The test asserts a real gap between consecutive cups AND the observable consequence — that sweeping
power straight down the middle falls OUT of the stack into the 10 several times rather than sliding
seamlessly from one cup to the next. If that goes red, the catch areas have started overlapping
again and the game is a gimme.

The `PLAY` probe in `test-visual.mjs` drives the real UI with real touch: it taps an unlocked
machine card, flicks, and fails unless a ball lands for actual points (last run: 40 on classic).
That is the automated floor, not a substitute for playing it — `VISUAL-PROCESS.md` applies.

## Not done, on purpose

- **No multiplayer.** `js/net.js` is right there and the reference is a two-player game, but a
  lockstep pass is its own milestone with its own invariants (`js/CLAUDE.md`) — and Skeeball has an
  unusual shape for it: like Boggle, nothing either player does changes the other's board, so it
  would be a self-report protocol rather than a move log. Read that section before starting.
  **Matt's stated end goal (2026-08-11) is a hub-wide turn-based multiplayer layer, for every
  game, with direct challenges** — *"you could directly challenge someone"* — and he named Skeeball
  as a good fit for it. That is a hub milestone, not a Skeeball feature; do not build a one-off
  here that the shared layer would then have to fight.
- **Only two machines.** Matt asked for one extra to start, with a "more machines to come" note in
  the picker, rather than ten at once. `boards.js` is data, so a third is an entry and nothing else.

## The two carousels

Both were Matt's requests, both were outstanding for a round, and both now exist.

**The machine picker** (`ui.js`'s `renderPicker`) is a scroll-snap carousel, one full-width slide
per machine. Its art is not an illustration of the board: `render.js`'s `drawThumb` paints the
REAL machine with the real renderer, so the picture and the game cannot drift apart. A locked
machine is dimmed, chained and padlocked, which is IMG_3959/IMG_3960's own treatment. Native
scroll-snap rather than a pointer handler — it keeps platform momentum, is keyboard-navigable for
free, and cannot fight the page for the gesture. Arrows and dots are conveniences on top of it.

**How to play** (`skeeball/js/howto.js`) follows the repo pattern — `yahtzee/js/howto.js` is the
reference implementation and `tic-tac-toe/CLAUDE.md` documents the shape. Five pages, a pointing
hand, dots, `[|◀] [OK] [▶|]`, swipeable, with a still informative pose under reduced motion.

The thing that makes it worth having: **every throw on every page is resolved by `game.js`**, and
the ball is drawn from that result. The tutorial physically cannot demonstrate a shot the engine
would score differently — the same discipline as the in-game aim guide sharing the engine's fold
maths instead of copying it.

What was there before was a static sheet of bullet points. Matt: *"You ignored the How To Play
instructions again. Yours is dogshit."* He was right twice: the repo had a pattern and that build
did not follow it, while a comment inside it claimed it did. Don't reintroduce a static sheet.
