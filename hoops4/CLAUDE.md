# Connect 4 Hoops — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them. **Nothing in this folder stores anything
> earned**: `gamehub.hoops4.v1` holds one preference (the opponent) and nothing else, and the
> match itself is not persisted at all. Results go through the shared `recordResult('hoops4', …)`
> like every other game.

Matt's idea, 2026-09-21, from photos of the real Bay Tek **CONNECT 4 HOOPS** cabinet: seven
basketball hoops in a row over a 7 x 6 Connect 4 board. Sink a hoop and your disc drops down that
column. Four in a row wins.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../hoops4/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `hoops4` |
| Stats id | `hoops4` — plain `recordResult(id, difficulty, won)`, **no sub-counter**, so item 7's three-edit rule does not apply |
| CSS root / prefix | `.h4-root` / `.h4-` |
| Settings key | `gamehub.hoops4.v1` (one preference: the opponent) |
| Difficulty axis | the CPU skill — `easy` / `medium` / `hard`. A two-player match records nothing |
| `isInProgress()` | the **no mid-game resume** meaning (Ball Run / Snake / Pinball's class) |

`isInProgress()` returns `true` while a match has at least one disc on the board and is not over.
Nothing is persisted, so leaving genuinely abandons the match and the hub should confirm. A ball
mid-flight and a turn mid-shoot-until-you-make-it are not states worth snapshotting — the same
call Skeeball made when it removed its own mid-rack resume (Matt: *"you either finish or quit"*).

**`devOnly: true` and NO `released` date**, deliberately. Matt asked for it deployed *for
testing*. `released` is the only input to the launcher's New pill and must announce the day the
game actually goes live. Releasing it needs no commit — the admin page's live switch overrides
`devOnly` (root `CLAUDE.md`, "The admin control page").

It **does** have a `GAME_META` row in `js/leaderboard-ui.js` even while admin-only, because
`players-agg.test.mjs`'s `OFF_THE_BOARD` list is empty and must stay that way. `isGameOnLauncher`
hides an admin-only game from the board on its own.

## The three things it does NOT own

- **The Connect 4 rules.** `js/game.js` imports `connect-four/js/board.js` — a bitboard already
  running at exactly 7 x 6, with its own win detection and its own tests. Safe to share in a way
  a skeeball ENGINE would not be: it is pure rules with no per-game tuning in it.
- **The solver.** `js/cpu.js` imports `connect-four/js/ai.js`.
- **three.js and cannon-es.** Imported from `skeeball/js/vendor/`. They are libraries, not engine
  logic, and `sw.js` already precaches them — a second copy would be ~1 MB for nothing.

## The engine is a COPY of skeeball's BRICK CITY, and that is the rule, not a shortcut

`js/machine.js`, `js/physics.js` and `js/render.js` are this game's own files. They started as
copies of `skeeball/js/machines/brickcity/` — the most advanced engine in the repo, the one
carrying the throat, the fixed rimout, the solver-artefact ceiling and the repaired watchdog —
and they have diverged. **Editing them cannot affect any skeeball machine, and a skeeball change
does not reach here.** That isolation is the filesystem, and it is the whole point of
`skeeball/CLAUDE.md`'s "every machine owns its own engine" hard rule.

If you fix something genuinely universal, say in the commit which copies you applied it to and
which you deliberately did not.

## The cabinet, and why every number is what it is

`js/boarddef.js`. **Every value that differs from HOT SHOT was measured.** Three tools do the
measuring and all three answer to a change in here:

| tool | what it answers |
|---|---|
| `reference/hoops/sweep-speed.mjs` | the launch speed band, against THIS engine (`--scan`, then `--band=min,max`) |
| `hoops4/js/test.js` | Matt's four requirements, as numbers. Headless, ~2 min |
| `reference/hoops/check-display.mjs` | the machine as the PLAYER sees it, in a real browser: is the whole display on screen, is anything occluding it, is column N under hoop N, and does a real swipe reach all seven |

`reference/hoops/sweep-hoops-columns.mjs` is the original FEASIBILITY sweep (write-up:
`reference/hoops/FINDINGS.md`) and is kept for the record only — it predates this folder and
throws at a synthetic board through HOT SHOT's engine, so it cannot answer anything about the
cabinet as built.

### The cabinet is ONE STEP, the display is VERTICAL, and it is BELOW the hoops

It has been wrong twice, in opposite directions, and both are worth keeping because the second
one was a correct piece of arithmetic that still produced an unplayable machine.

**Build 1 — the grid two steps up a staircase.** It reused HOT SHOT's three-tread staircase
verbatim (the geometry already measured) and hung the Connect 4 screen on the back wall above it.
Matt: *"WHY did you put the connect 4 board way up on top of stairs? that is a bizarre choice. I
can't even reach the top of the board by throwing the ball."* Measured, he was describing it
exactly — the hoops sat at 0.53 m and the screen at **1.13 m, two full steps above them**, on a
machine whose own mockup and whose real Bay Tek cabinet both put the hoops UP and the grid BELOW.

**Build 2 — the grid raked back at 38 degrees.** Six rows at the column pitch is 7.80X; a panel
that size standing vertical puts the hoops at 1.335 m, and the sweep says scoring there is
0.0–1.3% at *every* launch speed up to 8.8 m/s (the ball has to rise 1.14 m in the 0.26 m between
the ramp crest and the board — a 75-degree launch off a 70-degree ramp). Raking the panel spends
that size along the cabinet instead of up it and brings the hoops back to 0.90 m. All of that is
true and none of it helped, because **a raked panel is seen edge on.** Measured through the real
play camera (`reference/hoops/check-display.mjs`): the display projected to **309 x 159 px** on a
393 x 852 phone, every round cell an ellipse 1.7 times wider than tall, the whole bottom row
hidden behind the cabinet's own furniture, and perspective fanning the hoop row 15 px off its own
columns. **A Connect 4 board you cannot read is not a Connect 4 board.**

**Build 3, what it is now — the size gives, not the angle.** The panel stands VERTICAL and is as
tall as the gap between the board's lip and the hoop shelf allows: 4.80X, which rises exactly what
the 7.80X rake rose, so the shelf, the hoop row and every height the sweep measured stay where
they were. Six rows in 4.80X is a row pitch of 0.80X against a column pitch of 1.30X, so the board
is WIDE — round cells with more air between columns than between rows, which is what a widescreen
panel showing a 7 x 6 grid looks like and is the reference cabinet's own shape.

| | |
|---|---|
| display | 4.80X, **vertical**, 9.10X wide. Six rows, seven columns, one under each hoop |
| hoop shelf | 4.0X, tilt 0.10, hoops **0.75X from its BACK edge** |
| back wall | 1.8X + `backboardH` 0.42 |
| heights | display 0.52–1.22 m · hoops 1.27 m |

**Three things about that shape are load-bearing, and each was arrived at by getting it wrong
first:**

- **There is no apron in front of the display.** A 1.0X near-flat tread at the board's bottom edge
  is a *parking spot* — a throw that fails to clear the face lands on it and waits out the
  watchdog. **49% of throws parked.** The face now rises straight off the bottom edge and a short
  throw hits it, drops to the trough and is a clean fast miss.
- **The hoops sit at the BACK of the shelf, not the front.** This is HOT SHOT's layout and Matt's
  explicit call on that machine. With them 1.2X from the *front*, 2.0X of bare shelf sat behind
  the row and **119 of 325 throws flew over the hoops and parked on it**. Shortening the shelf
  instead put the back wall so close that shots caromed across columns and the middle three
  columns' mean aims collapsed to −0.03 / 0.00 / +0.06 — aim stopped choosing anything. The shelf
  must be DEEP (the ball lands in front of the row, and the landing point is what picks the
  column) *and* the row must be at the BACK (nowhere to park). Both at once is the only thing
  that satisfies both.
- **The board stands ABOVE the ramp crest, and the gap in front of it is 0.70 m.** Both numbers
  are the same defect: the camera could not see the bottom of the display. The crest is 0.464 m up
  and the lip used to be 0.20 m, a quarter of a metre in front of it — so the ramp stood 0.26 m
  PROUD of the foot of the display and hid the bottom row, which on a board that FILLS FROM THE
  BOTTOM is the row that matters. **No camera can solve it**: the sightline from the serve spot's
  side of the crest only clears it from 3.2 m up, which is a bird's-eye view of a machine whose
  whole point is that it faces you. Raising the BOARD is skeeball's own fix for its own version of
  this (`boardLipY` 0.07 → 0.20) and it is how a real cabinet is built. Raising it costs distance,
  and the trough is what buys that back: at 0.225 m of run a ball off a 70-degree ramp can climb
  0.62 m at the very best and a board 0.32 m higher needs 0.73 m — impossible at any speed. At
  0.70 m of run the same shot clears the panel's top edge by 0.29 m and comes down on the shelf.

### The camera, and the ceiling it cannot beat

`reference/hoops/check-display.mjs` is the probe for all of this: it raycasts all 42 cells from
the real play camera and fails if one is clipped or occluded, checks a column is derived from its
hoop's own `u`, and checks every hoop still projects nearest to its OWN column.

**Where the camera stands is arithmetic, and the binding constraint is the BALL, not the machine.**
It has to keep the resting ball in shot (skeeball's rule, measured: a camera in front of the ball
leaves it off screen for the first 250 ms of every throw), and the ball sits low and very near.
Close in that is ruinously expensive — 0.62 m behind the ball and 1.35 m above it needs an 86
degree field, and the cabinet shrinks to a third of the frame. Standing BACK costs the ball almost
nothing while the machine loses only what distance takes:

| camera | display on a 393 x 852 phone |
|---|---|
| 1.15 m back, 1.02 m up | 171 x 90 px (44% of the frame's width) |
| **3.00 m back, 1.00 m up** | **326 x 172 px (83% of the width)** |

**Past 3.00 m the frame is capped by the cabinet's WIDTH.** 1.52 m of board on a 0.49-aspect phone
is a 3.09 m tall frame however far back you stand, so a 0.70 m display can never be more than
**22.6%** of a portrait screen. That is geometry, not tuning — which is why the probe measures the
display's share of the frame's WIDTH and not of its height. A "quarter of the frame tall" bar is
unsatisfiable by any camera, and asserting it would be exactly the failure
`test-runaway-capped.mjs`'s header records.

### A REAL THUMB, not a sweep, throws at all seven columns

The open question this game has carried since it was designed was whether a human gesture has the
precision seven columns need - every sweep drives `aim` as a number, and a real swipe goes through
`atan2`, `aimDiv` and `aimCurve` first. `check-display.mjs` now answers it in a real browser:
seven fresh matches (two-player, so the CPU's turns cannot be mistaken for the player's), a
scripted touch gesture per column built by INVERTING ui.js's own mapping, and the match's own
move list read back.

| | col 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| aim asked for | -0.413 | -0.253 | -0.133 | 0.000 | 0.131 | 0.256 | 0.420 |
| landed (of 4) | 3 | 2 | 3 | 3 | 3 | 3 | 2 |
| in the column aimed at | 2 | 1 | 2 | 3 | 2 | 2 | 1 |

**19 of 28 swipes scored, 13 of those in the column they asked for, and all 7 columns were hit.**
It is still a scripted thumb on a SwiftShader canvas and not a person - what it rules out is the
bad case, a column a real gesture simply cannot reach.

### The speed band answers to the cabinet's DEPTH, and has been re-measured twice

`reference/hoops/sweep-speed.mjs --scan` walks every launch speed and reports what reaches a hoop;
`--band=min,max` scores a candidate pair over the real power x aim grid. On this cabinet nothing
scores below 6.00 or above 6.65:

| band | scored | live powers | columns | ordered |
|---|---|---|---|---|
| 6.00 / 6.60 | 31.5% | 11 of 11 | 7 of 7 | yes |
| **6.05 / 6.50** | **39.2%** | **11 of 11** | **7 of 7** | **yes** |
| 5.95 / 6.65 | 30.6% | 11 of 11 | 7 of 7 | yes |

"Live powers" is the one that would be a spec failure on its own: at HOT SHOT's 2.60/6.60 nothing
scored below power 0.65, two thirds of the dial dead.

### The width is set by the COLLARS, not by the holes

Two rules, and the first alone is not enough:

```
holes.spacing    6 gaps x 1.30X + 0.5X margin each side        =  8.800X
MACHINE-SPEC 12  |u| + collar radius + a 0.78X wall gap        = 10.443X   <- this wins
```

At 8.800X the outer collars stood **0.041X through the side rails**, because the spacing rule only
constrains hole CENTRES while a collar is 0.541X in radius and a throat 0.916X. Measured
consequence: 4 captured balls escaped past the rail where their own throat was cut open by it.
**The holes did not move** when the cabinet widened — the pitch is still 1.30X and the outer pair
still at ±3.90X.

### The hoops were drawn 90 degrees wrong, and it shipped

`render.js` rotated each hoop group by `fr.tilt - Math.PI/2`, which maps its local +Y to nearly
−Z. Every rim therefore stood UP as a vertical ring facing the player with its net trailing
backwards into the cabinet. Matt: *"You put the baskets backwards."* The group's +Y must be the
face NORMAL, and `faceToWorld`'s h direction is `(0, cos tilt, sin tilt)` — which is exactly what
rotating `(0,1,0)` about X by `tilt` gives. **The rotation IS the tilt**, with no offset.

Nothing headless caught this: the physics never knew, because a collar's collision boxes are
placed by `machine.js` and were always right. Only looking at it catches a render-only bug, which
is what `VISUAL-PROCESS.md` is for.

### Matt's four requirements, and the number that proves each

| he asked for | how | measured |
|---|---|---|
| "rims a little bouncier than other skeeball games" | `ringRest` 0.46 (HOT SHOT 0.30, THE CLASSIC 0.18) plus `captureDrop` 0.52 (HOT SHOT 0.35) | both asserted in `test.js` |
| "a little bit of unpredictability" | a SEEDED per-throw scatter on the launch only | seeded replays exactly; unseeded is bit-identical to before |
| "a ball can't get stuck balancing between two rims" | **the fins** — see below | 18 saddle drops, **0** stay |
| "once it goes into a basket, it goes down that column 100% of the time" | **no rimout**, plus a throat 8 ball-radii tall | **100.00%** (94.07%, then 98.21%) |

### The fins

Rims sit 1.30X apart and are 1.0X across, so the clear gap between two rim walls is 3.2 cm
against a 10.9 cm ball. The ball cannot fall INTO the gap — it rests ON both rim tops in a stable
saddle, with a contact either side and no reason to leave. That is a real resting place.

A fin stands in each gap and rises above the rim, capped by a box rotated 45° about the tread's
own v axis so **the top of the fin is an edge, not a face**. There is no longer a level pair of
rim tops to sit across. **A fin is narrower than the gap and never overhangs a rim** (`inset`) —
a mouth's width is Matt's number and nothing may narrow one.

### There is NO rimout on this machine

BRICK CITY's rimout hands the floor and the collar back so a ball that bounces out over the rim
plays on. Correct there, where a rack is nine independent balls. **Here a capture IS a Connect 4
move** — the column is chosen, the screen is about to show a disc drop into it, and a ball that
climbed back out would leave the board and the physics disagreeing about the position.

This costs nothing Matt asked for, because **the bounce happens before capture, not after**. The
throat runs 2.4 ball-radii ABOVE the rim here (BRICK CITY's stops at the rim) precisely because
the removed rimout was what used to catch a ball bouncing up out of a basket.

### The rail chamfers

A near-flat tread meeting a vertical rail is the right-angled pocket `MACHINE-SPEC` §12 warns
about, and it is reachable here in a way it is not elsewhere: the hoops span ±3.90X while the
cabinet is ±5.22X, so there is 1.3X of bare shelf outside the last hoop for a ball to run onto.
Measured with square corners: **67 of 231 throws (29%) parked, every one against a rail.**
Chamfers took it to 12.5%. A tilt/friction sweep then confirmed the current 0.10 / 0.12 pair is
the best available — **steepening the tread makes parking WORSE** (7.2% → 12.4% at 0.28).

**A parked ball here is not a lost ball.** Under shoot-until-you-make-it the watchdog resolves it
as an honest miss 0.6 s after it stops, and the player shoots again. That is why `test.js` asserts
on the MEDIAN TIME TO RESOLVE A SHOT (2.53 s measured, 3.0 s bar) rather than on Skeeball's 2%
emergency rate — a threshold borrowed from a machine where a watchdog kill burns one of nine would
mean nothing here, which is the exact trap `test-runaway-capped.mjs`'s header records.

## The rules of a match

- **Shoot until you make it.** A miss does not pass the turn; it costs a shot. This is Matt's
  call and it is what makes the async format below viable at all — a handoff that takes hours must
  carry a move, or the match dies of dead air.
- **A ball that rims out into the NEXT hoop still counts, in that column.** Nothing steers a ball
  (`MACHINE-SPEC` §9's standing ban), so the wrong hoop is a real outcome and the best moment the
  format has.
- **A shot into a FULL column is a miss** and you shoot again. The only case where going in is not
  a move, and it is a rule about the board rather than about the shot.
- **The grid is a SCREEN**, exactly as on the real cabinet — an LCD above the hoops. That is also
  what makes this buildable: 42 discs are paint on a `CanvasTexture`, not 42 rigid bodies, and the
  physics only ever has to answer *which hoop did it go through*.

## The CPU's difficulty is SHOT ACCURACY, not search depth

Connect Four's solver already knows which column to play, so that is free. What makes an opponent
easy or hard here is whether it can hit the hoop it picked — a Beginner knows the right column and
bricks it. `js/cpu.js`'s `COLUMN_AIM` is the **measured** mean aim each column's baskets actually
came from; the per-skill `spread` is in those same units, and the gaps between neighbouring
columns are 0.12 to 0.16, so a Beginner's 0.19 genuinely lands it in the wrong column often.

**It shoots through the same physics the player does.** Nothing places a CPU disc directly.

## The swipe

`aimCurve: 1` and `aimDiv: 1.00`, both departures from Skeeball's defaults and both deliberate.
Skeeball squares the swipe angle (forgiving near straight, steep at the corners), which is right
for a machine whose hard shots ARE the corners and wrong for this one — squaring compresses the
OUTER columns into the narrowest slivers of thumb arc, so columns would get harder to pick the
further out they are on top of already being smaller targets. BRICK CITY set `aimCurve: 1` for the
same reason. `aimDiv` spends the whole thumb arc on the aim range that actually exists (±0.41,
which is about ±24 degrees of swipe end to end).

**`aimDiv` IS THE FIRST NUMBER TO TUNE if Matt finds the columns fiddly.** It is pure input
shaping and touches no physics.

## Still open

- **Async multiplayer.** Matt asked for challenge-a-player-and-hand-it-over ("that would be
  amazing"). Designed but NOT built: it is the shape of `js/messages.js` (addressed by player
  CODE so a match follows a person to every device), not `js/net.js` (a live room layer with a
  heartbeat and a TTL). The sketch is `skeeball/mockup-hoops-four.html`. There is no push
  notification in this repo, so the opponent would find out via a badge on their next hub load.
- **Whether a human swipe has the precision seven columns need.** `check-display.mjs` (without
  `--no-swipe`) now drives real touch gestures at each of the seven columns through the real pad,
  the real swipe maths and the real engine, and reports what lands. It is still a scripted thumb
  on a SwiftShader canvas, not a person — a playtest is what finally answers this.
- **The outer columns are easier than the middle**, because everything past the aim needed to
  reach column 1 still lands in column 1. Arguably the right way round, since Connect 4's centre
  columns carry the most winning lines — but confirm it reads as skill.

## Testing

- `node hoops4/js/test.js` — the engine probe, headless, ~2 min. `POWERS`/`AIMS` env vars set the
  grid. It is the file that holds all four of Matt's requirements as numbers.
- `node test-game-conventions.mjs` — the shared checklist; it discovers game folders from disk.
- `node check-no-scroll.mjs hoops4` — **no game in this hub may scroll.**
- `node test-visual.mjs hoops4` — the only suite that LOOKS at it.
