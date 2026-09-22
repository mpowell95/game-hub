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
| Settings key | `gamehub.hoops4.v1` (two preferences: the opponent, and `shots`: `'until'` \| `'one'`) |
| Multiplayer | LIVE via `js/net.js` (`rooms/<CODE>`); TURN BY TURN via `hoops4/js/mp.js` (`hoops/games/<id>`, a NEW top-level node) |
| Outbox key | `gamehub.hoops4.outbox.v1` (turn-by-turn moves waiting on a signal) |
| Difficulty axis | the CPU skill — `easy` / `medium` / `hard`, plus `'mp'` for a multiplayer match (the repo's own convention — `'mp'` is unmapped in `js/difficulty-tiers.js`, so `tierOf('mp')` is null and it never lands in a difficulty tier). A two-player-on-one-phone match records nothing, because there is no "you" in it |
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
| `reference/hoops/probe-bounce.mjs` | DOES A MISS ACTUALLY BOUNCE? Counts, per throw, every surface the ball touches and every time it goes from falling to rising - which is what found that the rim was lively and everything a miss LANDS on was dead. `--set boardRest=0.3,riserRest=0.4,captureDrop=0.4` measures a candidate without editing `boarddef.js`, the same shape `tune-boggle-es.mjs` uses. Note `captureDrop` measurably does nothing here: on a collared basket the binding rule is "the centre is below the rim inside the mouth", not the kinematic prediction |

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

### "NOT VERY BOUNCY" WAS NEVER THE RIM (2026-09-22)

Matt asked for bouncier rims when the machine was built, and again after a build whose `ringRest`
was already 0.62, the highest in the repo: *"they're not very bouncy, like I asked."*

He was right, and the rim was never the problem. `reference/hoops/probe-bounce.mjs` throws the
real grid and counts, per throw, what the ball TOUCHES and whether it ever goes from falling to
rising fast enough to see. On the 0.62 build: **47% of misses bounced at all**, 0.60 bounces per
miss, mean best rebound **0.38 m/s** - a dribble. And here is what a miss actually meets, counted
over 231 throws:

| surface | throws that touch it | restitution it had |
|---|---|---|
| **riser** (the display panel) | 165 | 0.05 |
| **cupSeg** (the rims) | 115 | 0.62 |
| **fin / finCap** | 111 | 0.03 |
| **board** (the hoop shelf) | 51 | 0.05 |

**A lively rim over a beanbag floor feels like a beanbag.** The rim is struck by half the throws
and the ball then lands on something dead. Three changes, each on a surface the measurement named:

- **The shelf and the display panel got real restitution** (0.58 and 0.70). The riser needed its
  OWN contact material to get there - it used to share the shelf's, so the most-struck surface on
  the machine could not be tuned apart from the floor a scored ball lands on. The trough got one
  too and stays dead on purpose: a bouncy catch pit throws a dead ball back out onto the lane.
- **The fins and the chamfers are hoop hardware, so they bounce like the rims.** They fell through
  to `matWall` (0.03) and a near-miss that clipped one simply died. A ball kicking off a fin into
  the next basket is exactly the unpredictability Matt asked for, and nothing steers it there.
- **The side rails stay dead** (0.03). That is a measured fix - a live rail made the outer columns
  catch-alls for every over-aimed ball - and it is not what anyone is looking at when they say the
  machine does not bounce.

Measured after, same grid: **60% of misses bounce, 1.31 bounces each, mean best rebound 0.72 m/s.**

**The cost, real and accepted: the scoring rate falls**, 37.7% of the grid to 23.7%, because a
lively machine throws more balls back out. That is the trade Matt asked for, it is well inside
`test.js`'s own 8-75% band, and under shoot-till-you-make-one a lower rate buys more shots per
turn rather than a worse game. Parking went DOWN with it, 8.9% to 4.6%.

**He rejected that trade the moment he played it, and he was right to** - see the next section.
The bounce was kept; the accuracy was bought back by turning the bounce sideways and by taking
`ringRest` back down from 0.72 to 0.55.

**THE METRIC THAT SHOULD HAVE CAUGHT THIS WAS BROKEN.** `test.js` printed "rattled without scoring
0 (0.0%)" under Matt's own bounce requirement, on every build ever shipped, for two reasons:
`events` is an array of OBJECTS and the test asked `ev.includes('rattle')`, and on this machine a
`rattle` only fires on a ball that WAS captured, so the "without scoring" half can never be true
anyway. A number that cannot move is worse than no number. It is replaced by a measurement of the
thing Matt can see - what fraction of misses bounce, and how hard - as two assertions that can go
red.

### The bounce goes SIDEWAYS, not forwards (2026-09-22)

Matt, on the build the section above shipped: *"The bounce is good. But can we make it so it only
bounces sideways? Like right now it bounces forward and rolls off the front of the machine a lot.
I don't want that... I want the bounce just to make it more difficult to play a move where you
intended. I want the bounce to add some randomness, not make the game measurably more
difficult/players measurably less accurate."*

Those are two different properties of a bounce and **every number in the section above measures
only the first one.** How many misses bounced, how many times, how hard - all of them say HOW BIG,
none of them says WHICH WAY. A bounce across the hoop row changes which column a shot finds, which
is the randomness he asked for. A bounce toward the player only walks the ball off the shelf's
front edge, which costs a shot and buys nothing. They look identical on screen and they were
indistinguishable to the probe, which is how a build shipped that traded 14 points of scoring rate
for the wrong one.

So `reference/hoops/probe-bounce.mjs` was taught to tell them apart: the lateral/forward split of
every bounce, and how many misses come back over the shelf's front edge.

**The first thing it found is that the front-edge departure is NOT the bounce.** 89.6% of the
misses that reach the shelf come off its front - and 89.7% of them did on the dead-shelf build
too, and 89.7% again with the shelf's restitution set to 0.05. That is the shelf's own 0.10 rad
**forward tilt**, which is HOT SHOT's and is there so a miss rolls home instead of parking. It is
not optional: flattening it does raise scoring (32.5%) and does cut front departures (75.9%), but
**parking goes from 6.1% to 11.7%** - one shot in nine stopping dead and vanishing, which is a far
worse thing to watch than a ball rolling back to you.

So the tilt stays and the fix is two things:

**1. The sideways redirect** (`bounceSideways` in `boarddef.js`, the rule in `physics.js` section
0a). When the ball bounces off the shelf or the hoop row's own furniture and comes off moving
toward the player, its horizontal velocity is **rotated onto the u axis**. It is a rotation, not a
kick: `hypot(vx, vz)` is identical before and after and the vertical component is never touched,
so no energy is added and a livelier rim cannot become a ball fired off the machine. At 1.0 the
whole forward component is turned, which is Matt's sentence literally.

**It is not magnetism** (MACHINE-SPEC section 9). It never reads `G.holes`, never asks where a
hoop is and never picks a side - the direction is the sign of the sideways drift the ball already
had, so a ball drifting left comes off further left. That a bounced ball more often finds a basket
is a consequence of the baskets being in a row along that axis, not of anything steering it.
`test.js` asserts structurally that the rule reads no hole position, because this is exactly the
rule a future session would "improve" by nudging the ball at the nearest hoop and no sweep would
fail if it did. It is also deliberately **forward only**: a ball still travelling into the machine
needs that momentum to reach the row at all.

**2. `ringRest` back to 0.55 from 0.72.** Of every knob on the machine the rim is the one that
moves the scoring rate, and the redirect alone is only worth about two points of it. The rest of
the machine still carries the bounce he can see - the shelf at 0.58 and the display panel at 0.70,
which is what the previous section was actually about - and 0.55 is still 1.8x HOT SHOT and 3x
THE CLASSIC.

The sweep, on the 11x21 grid, at the shipped 0.10 shelf tilt:

| K (sideways) | ringRest | scored | parked | lateral:forward | misses bouncing / mean rebound |
|---|---|---|---|---|---|
| - | - | **30.7%** | 5.2% | 1.54:1 | 48% / 0.43 m/s | *(v889, before any bounce work)* |
| 0.00 | 0.72 | **22.9%** | 6.1% | 1.43:1 | 59% / 0.71 m/s | *(v890, the build he played)* |
| 0.55 | 0.72 | 25.1% | 6.5% | 2.73:1 | 58% / 0.69 m/s |
| 0.80 | 0.62 | 25.5% | 10.4% | 3.44:1 | 58% / 0.64 m/s |
| 0.80 | 0.55 | 27.7% | 7.8% | 3.73:1 | 58% / 0.63 m/s |
| 0.80 | 0.46 | 29.4% | 6.9% | 2.95:1 | 56% / 0.59 m/s |
| 0.90 | 0.46 | 30.3% | 6.9% | 2.69:1 | 56% / 0.58 m/s |
| 1.00 | 0.72 | 26.4% | 6.9% | 3.36:1 | 58% / 0.70 m/s |
| 1.00 | 0.62 | 28.6% | 8.7% | 3.45:1 | 56% / 0.62 m/s |
| **1.00** | **0.55** | **29.4%** | 7.8% | **4.37:1** | 56% / 0.61 m/s | **<- shipped** |

Forward velocity per bounce fell from 0.29 m/s to 0.10 m/s, lateral held at 0.46, and the scoring
rate came back to within 1.3 points of the build before any of this started - with the bounce
itself almost entirely intact (56% of misses bounce against 59%, mean best rebound 0.61 against
0.71, both far above the 48% / 0.43 of the build he called not bouncy).

**Two things this deliberately does not claim.** Balls still leave over the front edge at about
the same rate, because the tilt is what sends them there and the tilt is load-bearing; what
changed is that they leave having first been thrown ACROSS the row rather than straight at the
player. And the scoring rate is 29.4%, not 30.7% - a bouncy machine costs something, and the
honest number is printed here rather than rounded up.

On `test.js`'s own bigger grid (861 shots, which is the number to quote): **scored 28.9%, parked
7.32%, lateral 0.57 m/s against forward 0.14, a 4.00:1 ratio, 56% of misses bouncing at a mean
best rebound of 0.66 m/s**, and every column still reachable. Parking is up from v890's 4.6% and
still below the 8.9% of the build before any of the bounce work.

`test.js` carries the bar as section 1b: the lateral:forward ratio must stay at or above 2.0, the
redirect must be switched on, and it must read no hole position.

### Round 1 of the playtest list (2026-09-22)

Matt, having played the shipped multiplayer. Five things, all small, all shipped together.

**The difficulties were invented here.** `Beginner / Steady / Sharpshooter` existed in this game
and nowhere else in the repo. Matt: *"you created brand new terminology for the difficulties.
Don't do that."* They are `Easy / Medium / Hard` now, the hub's own words.

**The setup screen was an essay.** Two explanatory paragraphs (`cpuNote`, `shotModeNote`) under
controls that need no explanation. Both strings are deleted, not just hidden. The full restructure
Matt asked for (Play the computer vs Multiplayer Options, with host / pass and play / challenge /
active games / history underneath) is round 2; this is only the prose coming off.

**The ball was one colour for the whole game.** `setBallColor` has existed in `render.js` since the
first build and was called EXACTLY ONCE, in `start()`, so whoever shot first owned the ball's
colour for the rest of the match - then the disc landed on the board in the other colour. Matt:
*"that's not good. the ball should be the same red and yellow as they appear when on the board as
a piece."* It is set per SHOT now, in `shoot()`, which covers a CPU turn, a remote turn and a
pass-and-play turn from one call site. Verified in a real browser: my shot `e8463f`, the CPU's
`ffce3a`.

**Whose turn it was, said only in colour and only after the fact.** The HUD was a 14px word whose
hue was the entire signal - which is unreadable for Matt (red/green colourblind, root CLAUDE.md)
and too quiet to notice anyway, so the CPU's turn looked like the machine doing nothing until a
ball appeared: *"it's not clear when it's the computers turn. There's no indication until they've
thrown."* Now a pill with a SHAPE marker (disc for red, triangle for yellow), the opponent's actual
name, filled for your own shot and outlined for theirs, and it says **"Medium is shooting"** during
the pause - which is painted BEFORE the timer starts and runs 1100ms rather than 800 so there is
something to read. Verified in a browser at exactly that moment.

**"There is no back button" - TWO separate faults, and the first fix only caught one.**

The one it caught: `isInProgress()`. `js/hub.js`'s `requestLeave()` confirms whenever the mounted
module says a game is under way, and this one said yes for a TURN-BY-TURN challenge whose move log
lives in `hoops/games/<id>` and replays on re-entry. Nothing can be lost, so nothing should be
warned about. It now returns false for `mp.kind === 'async'`, true for everything else, and
entering a challenge toasts that the match is saved.

The one it missed, and the reason a second pass was needed the same day: **the hub's chip is a
QUIT, not a back.** Matt: *"we had the Hub back button. That's more of a quit button. There is no
back button to go back to the setup screen."* It unmounts the module and lands on the launcher;
what was missing is a way to stay inside Connect 4 Hoops and change opponent or shot rule.

So there ARE two buttons, deliberately, and **they are labelled by DESTINATION**. The first
attempt built the second chip and labelled it "Back", stacked over the hub's own "Back" - two
words for two places was the fix; one word for two was the bug. It is `.h4-menu`, reading "Menu",
in the HUD row (y 9-42) while the hub's chip floats at y 54+, measured as non-overlapping. A
turn-by-turn match leaves it with no question (straight to the multiplayer screen, where the rest
of your matches are); solo, pass-and-play and a live room ask first, because those really do end.

The HUD's `padding-left` was 76px to clear the hub's chip. That was never needed - the two rows do
not overlap - and the Menu button now leads the row, so it is a normal 16px gutter.

Measured after: `test-game-conventions.mjs` 11/11, `test-visual.mjs hoops4` 13/13,
`check-no-scroll.mjs hoops4` 4 screens / 0 scroll.

**Still open from that list** (rounds 2-4): the launcher challenge alert and the full-screen
challenge ceremony; the Multiplayer Options restructure with active games and history; series
(single / best of 3 / best of 5), a caption with a challenge and quick chat in a match; a visual
How to Play; a taller board with bigger cells. And the SCORING RATE, which is what Matt actually
wants from the bounce work - *"i don't care where balls roll off, front or back... I want more
balls to bounce around, but ultimately go in a basket"* - so the front-edge question is closed and
the next lever to measure is making the per-hoop backboards SOLID so a shot can be banked in.

### The challenge has to reach you on the LAUNCHER (2026-09-22)

Matt, having played the shipped multiplayer: *"to see a challenge, you must go into the hoops
connect 4, click play a friend, then it's displayed below 'Challenge'. There is no other
notification anywhere. Instead of that, can it be super obvious? at least the first time?"* - with
mockups: a chunky speech bubble, hard black outline, tail pointing at the tile. Purple for a new
challenge, blue for your turn.

**Three pieces, and the hub deliberately owns none of the vocabulary.**

**`hoops4/js/alert.js`** decides. `decideAlert(rows, seen)` is pure and tested
(`test-hoops4-mp.mjs`): a match id this device has never seen is a **challenge**; one it has seen
whose `updated` has moved past the acknowledged stamp, with the turn back on you, is a **turn**; a
finished match is neither. A challenge outranks a turn, because it is the bigger event and the one
with a person's name on it. Matt's rule for when it shows: *"Whenever there's something new... A
new challenge, or the turn flipping to you, brings it back"* - so the seen map records a STAMP per
match, not a boolean, and anything newer re-arms it.

**`js/hub.js` knows only that a registry entry may declare an `alerts` module.** The hoops4 entry
declares one; the hub imports it lazily AFTER the launcher has painted, draws the bubble into that
game's `.hub-cell`, and scrolls the tile into view once. Everything is guarded - a game tile must
never be able to break the launcher. Putting it on the critical path would trade a launcher that
appears in 6 requests for one that waits on a Firebase read.

**WHY alert.js IS IN hoops4/ AND NOT js/.** It writes a `gamehub.*` key, and `test-sw-strategy.mjs`
has a structural check that no cache-first SHELL module does that. The game's own folder is the
REST tier, where the rule does not apply.

**The bubble's geometry is measured, not assumed.** It is wider than a tile, so it anchors to
whichever side of the grid its tile is on (`is-col-left` / `is-col-right`, from the cell's real
offset) and always grows inward - it can never hang off the edge of a phone. On the top row there
is nothing above to grow into, so it flips underneath and the tail turns over (`is-below`).

**The two states are told apart by their WORDS, not their colour.** "{who} challenged you!" against
"Your Turn!". Matt is red/green colourblind and purple-against-blue would be exactly the hue-only
signal this repo does not ship.

**The ceremony** (`showCeremony` in `ui.js`) is armed by the launcher and taken once on mount -
skeeball's key-ceremony shape, ARMED and never backfilled, so a device that has never been
challenged cannot be shown one retroactively. Their emoji flies in from the left, yours from the
right, VS lands between them: *"The popup needs to clearly show that the challengers emoji and your
emoji are opponents."* The rings are the sides they will actually play (the challenger is side 'a',
which is RED and shoots first), each paired with the same disc/triangle marker the in-game turn
pill uses. The timeline lives in one comment above the DOM it builds, which is skeeball's rule, and
so is the lesson underneath it - nothing switches state, everything arrives.

**Two things caught by looking rather than by a test.** The veil was `rgba(...,0.92)` and the
hub-skinned setup card behind it is WHITE in light mode, so its headings read straight through and
the ceremony sat in a jumble of its own setup screen - skeeball's ceremony comment says exactly
this about a lit machine, and it had to be rediscovered from a screenshot. And the first version of
"Let's play" closed the card before reading the match, falling back to `toast()` - which returns
silently when `.h4-toast` is not on screen, and it never is on the setup screen. A match that had
gone would have dropped the player back with no explanation at all. The card stays up and says so.

### THE SCORING RATE: every lever measured, and Matt's call (2026-09-22)

Matt, after playing the square board: *"I don't understand why you can't make it better than 20
something % made shots."*

**First, the number he is quoting is the GRID's, not a player's.** `probe-bounce.mjs` and
`test.js` sweep every power x aim combination evenly, including the ones no thumb would ever
produce - it is a floor, not an experience. The one measurement of a real gesture
(`check-display.mjs`'s scripted thumb, seven columns) landed **19 of 28, 68%**. Both numbers are
honest and they answer different questions; do not quote the grid as what a person shoots.

**Second, it really did fall on purpose, twice.** Making the machine bouncy cost 37.7% -> 23.7%,
and turning the bounce sideways bought back to 29.4%. Those were Matt's own asks on two different
days, in two different directions.

Every lever was then swept on the full 231-throw grid, against the shipped build (**28.6% scored,
1.7% parked, 45.5% of misses bouncing, mean rebound 0.48 m/s**):

| lever | scored | parked | misses bouncing / mean rebound |
|---|---|---|---|
| **shipped** | **28.6%** | **1.7%** | 45.5% / 0.48 |
| **hoop mouth r x1.10** | **31.6%** | **0.9%** | 43.0% / 0.51 |
| hoop mouth r x1.05 | 26.4% | 0.9% | 44.1% / 0.50 |
| ringRest 0.30 | 29.9% | 3.5% | 40.1% / 0.38 |
| ringRest 0.40 / 0.46 / 0.62 / 0.72 | 28.1 / 26.4 / 26.0 / 26.8% | 3.5 / 1.7 / 1.3 / 1.3% | ~45% / 0.44-0.53 |
| riserRest 0.05 | 31.2% | 5.2% | 41.5% / 0.43 |
| riserRest 0.30 | 30.3% | 3.5% | 44.1% / 0.46 |
| speed band 6.45/6.70 | 30.7% | **6.1%** | 45.0% / 0.46 |
| speed band 6.40/6.85 | 21.6% | 3.5% | 48.1% / 0.50 |
| boardRest 0.40 / 0.20 / 0.05 | **28.6%, all three** | 1.7% | bounce only falls |
| deadRest 0.32 / 0.20 / 0.06 | **28.6%, all three** | 3.0 / 1.7 / 1.7% | bounce only falls |
| jitterAim / jitterSpeed, 0.000 to 0.013 | **28.6%, every value** | 1.7% | unchanged |
| bounceSideways 0.8 | 28.6% | 1.7% | worse ratio (3.92:1 vs 4.48:1) |

**Four findings worth keeping:**

1. **Only ONE change raises scoring without paying for it: widening the hoop mouth.** +3.0 points
   AND parked nearly halved AND the bounce intact. Everything else that scores higher does it by
   tripling the parked rate or by flattening the machine's most-struck surface back toward the
   "beanbag" it was raised out of.
2. **The two candidate wins do not stack.** `holeR x1.10` + `ringRest 0.30` measured **28.1%** -
   worse than the mouth alone and back at baseline. Never assume two levers add.
3. **Three knobs are NOT scoring levers at all**: `boardRest`, `deadRest` and the jitter pair move
   the scoring rate by exactly zero at every value tested. Lowering them is pure cost.
4. **`holeR x1.05` measured WORSE than baseline (26.4%) while x1.10 measured better.** That is a
   quantisation artefact of 21 discrete aim steps, not a curve - so a midpoint cannot be
   interpolated from this grid, and a small delta on this instrument means nothing.

**MATT'S CALL, ASKED AND ANSWERED: leave the hoops alone.** He was given the table above and chose
it, so the rate stays at 28.6% and **this question is closed.** A future session must not widen
the mouth, deaden the rim, or retune the band to chase a scoring number - `boarddef.js` already
says `RIM` is never changed without him, root `CLAUDE.md` says a mouth's width is his number, and
he has now said no to the one change that would have worked. Re-open it only if he does.

#### The Menu button is SKEEBALL'S button, with skeeball's sheet (2026-09-22)

Matt, with a screenshot of each: *"make the 'menu' button look just like skeeball. With the same
options."*

It was a 13px pill reading "Menu" that QUIT the match on one tap (straight into `leaveMatch`).
Skeeball's is a 44x44 hamburger that opens a **pause sheet**, and that difference is the point: a
button that ends a game on a single tap with no way to say you did not mean it is the exact
complaint skeeball itself got on 2026-08-21.

So `.h4-menu` is now `.sk-menu`'s box verbatim - absolute, `top: max(10px, env(safe-area-inset-top))`,
`right: 12px`, 44x44, `☰` - and `_showPause()` is `skeeball/js/ui.js`'s `_showPause` ported:
the same `.gh-overlay`/`.gh-modal` primitives, the same X in the corner, the same
Resume / New game / leave stack.

**Top right is not a style choice, it is the fix this game already needed once.** The hub's
floating "Hub" chip owns the top LEFT, and the previous Menu button shared its band on a notched
phone. The HUD row's `padding-left: 76px` stays for the turn pill and gains a mirrored
`padding-right: 64px`, because the button is absolutely positioned now and the row no longer
CONTAINS it.

**Three things differ from skeeball, each for a reason:**

- **The third button is this game's own destination.** Skeeball's quits to its machine gallery;
  this game has no gallery, and the Menu button has always gone to the setup screen where you
  change opponent and shot rule. In a turn-by-turn match it reads "Back to multiplayer" instead,
  because that is where the rest of your matches are.
- **New game is HIDDEN in any multiplayer match**, and that is a rule rather than tidiness: there
  is nobody on the other end of a unilateral restart. In a live room both engines would replay
  different boards from the next move on; a turn-by-turn challenge is a shared move log, and a
  rematch there is a new challenge.
- **Leaving still routes through `leaveMatch()`**, so the mid-game confirm and the async
  "your match is saved" toast are unchanged - the sheet is a new door onto the same behaviour,
  not a replacement for it.

**PAUSED MEANS PAUSED.** The loop is stopped while the sheet is up (skeeball's 2026-08-26 lesson),
and it is if anything more load-bearing here: a ball still in the air when you tap would otherwise
go on flying, drop through a hoop, take your turn and hand the CPU its shot while you read the
menu. `preserveDrawingBuffer` keeps the last frame on the canvas, so the machine freezes rather
than going black. `leaveMatch`'s cancel path restarts the loop, or declining the confirm would
leave a permanently frozen game.

Measured in a browser **with a 59px inset simulated**, since a headless one has none: the button
is 44x44 at x 337 / y 59 and `elementFromPoint` returns it at its own centre; the sheet reads
Paused / Resume / New game / Back to setup screen with an X; `raf` is 0 while it is up and
non-zero after Resume; no page errors. `test-game-conventions.mjs` 11/11, `test-hoops4-mp.mjs`
77/77, `check-no-scroll.mjs hoops4` 4 screens / 0 scroll, `test-visual.mjs hoops4` 13/13.

#### Two buttons in one place, and why a measurement said otherwise

Matt, on the build that shipped the Menu button: *"whatever back button you made is hidden behind
the Hub quit button."*

**The measurement that cleared it was taken in a browser with no notch, which is the wrong
browser.** `.h4-play-wrap` carries `padding-top: env(safe-area-inset-top)`. In headless Chromium
that inset is **0**, so the HUD row sat at y 9-42 and the hub's floating chip at 54+, and they read
as separate rows - which is exactly what was reported at the time, and it was true and useless. On
a real iPhone the inset is about 59px: the HUD is pushed down by it, the chip's own top is
`max(inset, 54px)`, and the two land in the SAME BAND with the hub's chrome painting above the
game.

**So the separation is HORIZONTAL now, because that is the axis a notch cannot move.** The Menu
button sits at the far right (`margin-left: auto`), the hub's chip is always at the far left, and
the HUD's `padding-left: 76px` - which this file had and which was removed on the strength of that
bad measurement, with its own comment saying what it was for - keeps the turn pill clear of the
chip.

The probe simulates the inset rather than hoping for one, and asks `elementFromPoint` whether the
Menu button is actually the thing at its own centre. Against the old layout at a 59px inset it
reports **`Menu tappable false`**, which is Matt's sentence as a number.

**The lesson, since this is the second time on this game**: a headless browser has no safe area, no
notch and no home indicator. Any claim about two fixed-position elements not colliding has to name
the inset it assumed, or simulate one.

#### The bubble that would not go away

Matt, on the first build of it: *"the popup looks great as is! and the versus / matchup page and
everything. The only thing is that once I've clicked on the new challenge popup and gone into the
matchup and played and stuff, it should go away. I just did that and it stayed there even though
it's not my turn."*

**Two faults, and either one alone brings it back.**

`_dismissGameAlert` took a `paint = false` on the open-the-game path, reasoning that mounting a
game was about to replace the view anyway. **It is not: `launch()` only HIDES the grid and
`showLauncher()` only un-hides it.** Neither re-renders, so the bubble element was still sitting in
its cell the whole time and simply came back into view on return. And `_checkGameAlerts` assigned
`this._gameAlert` only when it FOUND something, so an alert that had stopped being true was never
cleared either.

The decision logic was right all along - `decideAlert` returns null for a match whose stamp you
have acknowledged and whose turn is not yours. Nothing was wrong with WHAT it decided; the DOM just
never heard about it. `showLauncher()` now re-asks as well, which also catches the other direction:
a different match coming back round to you while you were playing something else.

Three `[KNOWN-BUG PROBE]` assertions in `test-hoops4-mp.mjs`, verified born red by reintroducing
the faults.

### "What is 2 player?" - the setup screen, split (2026-09-22)

Matt: *"What is 2 player? There should be options to play the computer player and 'Multiplayer
Options'. Then within multiplayer options, there's a Host game option, a pass and play option, a
challenge option and a Live Challenges section that shows the active games and if it's your turn or
their turn... The computer player options should just have the difficulties and the shots per turn
option."*

**The question answers itself: "Two players" was pass-and-play sitting in the OPPONENT row**, next
to three CPU difficulties, so it read as a fourth difficulty. It is now "Pass and play" in the
multiplayer sheet, beside the other two ways two people play.

- **The setup screen is one card and one door.** "Play the computer" holds difficulty and shots per
  turn and nothing else, with Play inside it; **Multiplayer** is a separate button below.
- **The multiplayer sheet is four rows** - Challenge, Host a game, Join a game, Pass and play -
  replacing the section headings and paragraphs it used to carry. Then **Active games**, which
  lists only matches still in play and says whose turn each one is. They shipped with one line of
  explanation under each name and Matt deleted all four the same day (*"Delete all the subtitles on
  the Multiplayer screen as well"*), along with the setup screen's tagline: *"DO NOT replace it."*
  Four buttons whose names say what they are do not need four sentences explaining them.
- **And it has a picture of the machine now.** Matt, on the old screen: *"it looks nothing like the
  others."* What every other machine's setup screen leads with is a picture of the machine, and
  this had none. It reuses `GAME_ART['hoops4']` - the SAME inline SVG the launcher tile draws - so
  the tile you tap and the screen you land on are the same picture, at no cost: no WebGL, no
  readback, no placeholder needing correction, nothing to fail offline. A short phone drops the
  picture rather than a control, because no game in this hub may scroll.

**`opponent: 'two'` IS STILL A REAL VALUE** in `gamehub.hoops4.v1` on any device that used the old
screen, and it is neither deleted nor rewritten (THE LAW rule 5). The difficulty row shows its
nearest meaning (Medium) until the player picks again, `start()` and `themName()` read the same
fallback, and Play now passes `vsCpu: true` explicitly so a stored `'two'` can never silently start
a pass-and-play game from a button labelled "Play".

**Still to come in this thread**: series (single / best of 3 / best of 5) with the shot rule and an
optional caption attached to a challenge, shown to whoever accepts it; quick chat inside a match;
challenge history with records; and the visual How to Play, which is still just words.

### A series, and the terms of a challenge (2026-09-22)

Matt: *"Before you challenge someone or anything, you should be able to select the shots per turn
setting and if you want to play a single game, best of 3 series or best of 5 series. And when you
accept a challenge and go to play, you should see what the shot settings and the series selection
is and stuff like that. Maybe include a caption option thing where you can say something to your
opponent with the challenge request thing?"*

**Picking an opponent no longer sends the challenge.** It opens a terms screen: shots per turn
(defaulting to the challenger's own setup choice, because it is the rule BOTH people will play
under and this is the only moment either agrees to it), the series, and an optional caption. A
failed send keeps the form and everything typed in it.

**THE NEW FIELDS ARE OPTIONAL, AND THAT IS THE LOAD-BEARING PART.** `validateGame` returning null
is a REFUSAL TO OPEN THE MATCH - so a required `series` would have made every match already in
`hoops/games/` unplayable the moment this shipped. Everything defaults: `series` 1, `seriesNo` 1,
`seriesWins` 0-0, `seriesOf` the game's own id, `caption` empty. `test-hoops4-mp.mjs` pins it with
a hand-written pre-series document.

**`seriesAfter(game)` is pure and is the only place the rules live**, so the two devices cannot
disagree about the score. A best of 3 needs two wins, a best of 5 needs three. **A drawn board
gives nobody a win**, so a series also ends when it runs out of games - the leader takes it, and a
dead tie is an honest draw. Without that, three drawn boards would chase a target neither side can
reach for ever.

**The next game is started by a BUTTON, never automatically.** Creating it inside the finishing
device's `pushMove` would stall a series silently whenever that person happened to be offline at
that moment - a failure with nobody looking at it. A button has somebody in front of it, and
`createGame` already returns a reason it can say out loud. `test-hoops4-mp.mjs` asserts `pushMove`'s
own body never calls it.

**The sides swap each game** (`first: 'them'`), because side 'a' shoots first and otherwise a best
of 3 is just "the challenger shoots first, three times".

**Where the terms are shown**: on the full-screen card when you accept (read from the MATCH, not
from the launcher's index row, which carries no caption), as "Game 2 of 3" on the play HUD and on
each row of the active list, and as the running score on the game-over card.

**Two things a screenshot caught that a test would not have.** The terms screen reused `.h4-opt`
for its selectors but not the CHECKMARK that goes with it - the setup screen's own comment says
selection is marked "by a BORDER, A WEIGHT AND A CHECKMARK, never colour alone", and without the
glyph the options differed only by tint. And the caption box reused `.h4-mp-input`, which is
styled for the five-character ROOM CODE: uppercase, letter-spaced, centred. "First to three, no
excuses" rendered as spaced capitals running off the end of its own box.

### Square, and what it cost (2026-09-22)

Matt, with an old screenshot beside a new one: *"The connect 4 board is shorter than it used to
be. It should be a square. Not a short rectangle."*

He was right and it was this repo's own doing: the board WAS 7.80X tall when it was raked, and the
rebuild that stood it upright (v884, the one that fixed "I can't read the board") cut it to 4.80X.
Width never changed, so the cells went to 1.63:1.

**`PANEL_L` 4.80 -> 7.80X, `boardLipY` 0.52 -> 0.39.** Six rows over 7.80X is a row pitch of 1.30X,
exactly the column pitch, so the cells are square. It grows BOTH ways: down to where the ramp crest
starts hiding the bottom row, the rest up, which lifts the hoop row 1.265 -> 1.572 m.

**The launch band had to move with the hoops, and that is the whole difference between this working
and not.** On the old 6.05/6.50 nothing reached below power 0.50 - half the swipe dead, which is
the exact failure this game's own `boarddef.js` already records against HOT SHOT's band. Re-derived
to 6.35/6.80.

**A COARSE GRID LIED.** A 77-throw sweep (7 aim steps) was used first because it runs in seconds.
It ranked a different band best AND said the taller board outscored the short one outright. The
real 231-throw grid (21 aim steps) disagreed on both. **Aim resolution is exactly what a narrow
hoop row is sensitive to** - so a fast sweep can rank BANDS roughly, and must never be the thing a
decision is made on.

Measured on the 861-throw suite grid, against the 4.80X board:

| | 4.80X shipped | 7.80X square |
|---|---|---|
| scored | 28.9% | **29.2%** |
| parked (a ball that vanishes) | 7.32% | **2.44%** |
| misses that bounce | 56% | 42% |
| mean best rebound | 0.61 m/s | 0.47 m/s |

`check-display.mjs` 13/13 - all 42 cells on screen, none behind the cabinet's own furniture - and
**"every column is hit by the gesture that asks for it" now passes 7 of 7, where the 4.80X board
fails at 6 of 7.**

**THE COST IS THE BOUNCE, AND IT IS RECORDED AS A KNOWN GAP RATHER THAN PAPERED OVER.** The taller
board lifts the hoops, the faster band makes balls arrive flatter, and they stop landing on the
SHELF - the surface made live in v890 specifically to create bounce. `board` has dropped out of the
top eight surfaces a miss touches entirely. Restoring it (riserRest 0.85) costs about four points
of scoring, which is a trade between two things Matt has asked for at different times, so it was
his to make: *"Ship square now, tune the bounce after you've felt it."*

So `hoops4/js/test.js` gained a `KNOWN_GAPS` map, the same shape as
`test-game-conventions.mjs`'s and for the same reason. The two bars are NOT lowered: the real
number is measured and printed every run, the summary says `2 KNOWN GAP(S) STILL OWED`, and **a
gap whose check starts passing FAILS the run and tells you to delete the entry** (verified by
listing a passing check and watching it go red). A silently lowered bar is how a requirement
disappears.

**`deadRest` 0.32 -> 0.50 came free** on the way: same scoring, parking 3.0% -> 1.7%, a little
bounce back. It SATURATES there - 0.50, 0.62 and 0.75 return byte-identical numbers. Found by
teaching `probe-bounce.mjs` to PRINT which surfaces a miss touches, which it had collected since
its first version and never shown; every restitution decision before that was a guess across
variants instead of one look.

### The disc FALLS down its column (2026-09-22)

Matt: *"Can you show the ball fall down the columns rather than go into the basket and just appear
at the bottom of that column?"* It did exactly that - `setGrid` repainted the whole grid the
instant a ball was captured, so the disc teleported to the bottom of its column and the one piece
of feedback tying the basket you sank to the move you made was missing.

`render.js` gained `startDrop` / `stepDrop` / `_dropY`, and `setGrid` a third `drop` argument. The
falling disc is drawn on the SAME `CanvasTexture` as the counters - there is no second layer and
no new draw call, because the grid was already a painted canvas on a plane (see "The grid is a
SCREEN").

**Three things about it are load-bearing:**

- **It is driven by the game's own loop**, not its own `requestAnimationFrame`. `ui.js`'s `tick`
  calls `stepDrop(dt)` first, so a drop cannot outlive the screen, cannot run twice, and stops
  with everything else when the loop stops. A private rAF here would be the one animation in the
  game that `destroy()` does not cancel.
- **The target cell is drawn EMPTY while the disc is in the air**, and the win ring is suppressed
  for the whole drop. Otherwise the disc is already sitting in the hole it is falling into, and a
  winning move rings four cells before the fourth one arrives.
- **`onDone` is what makes everything downstream wait.** `resolve()` defers `finish()` and
  `maybeCpu()` through `_whenLanded`, so a game-over card cannot cover the drop that won and the
  CPU cannot start its shot while the player's disc is still falling. A miss or a shot into a full
  column changes no cell, so there is nothing to drop and it paints at once - `_whenLanded` runs
  its callback immediately in that case, which is why the timing of a miss is unchanged.

`start()` clears `_dropping`/`_afterDrop`: a new match inheriting the last one's flag would hold
its first move for a drop that will never land.

The fall is a quadratic (accelerating, like a dropped disc) for the first 80% of it and one
decaying hop of a fifth of a cell for the rest. Duration is per row - about 0.45 s to the bottom
row, 0.22 s to the top - so a disc that falls further takes longer, and a nearly full column does
not feel sluggish.

Measured: 28 frames from y -77.8 to 931.6 with the gaps widening 2.1 / 6.1 / 10.2 / 14.3, a bounce
back up to 912.5 settling at 929.4, `onDone` fired, no page errors. `test-game-conventions.mjs`
11/11, `check-no-scroll.mjs hoops4` 4 screens / 0 scroll, `test-visual.mjs hoops4` 13/13.

#### It starts when the ball goes IN, not when the throw resolves

Matt, on a screen recording of the first build: *"There's a tiny lag between when the ball goes into
the basket and when it's shown falling. There shouldn't be. It should look like it's the same ball
that goes in the basket falling down the column."*

**It was not tiny and it was not a frame-timing problem. Measured over the 231-throw grid, the gap
between the capture and the throw resolving is a median of 0.346 s, p90 0.712 s, worst 0.917 s** -
and the drop was started at `resolve()`, so every one of those milliseconds was dead time with the
ball already in the basket and nothing happening on the board.

The gap is the throat. `physics.js` treats capture as COMMITTED here, and `finishAt` only fires
once the ball has fallen 0.26 m below the capture point. That fall is correct and is not being
shortened - it is what makes a captured ball unable to come back out.

So the drop starts on the **capture event** in `tick`, from a PREDICTED cell (`_dropOnCapture`).
Predicting is safe here for exactly one reason, and it is a property of this machine rather than a
guess: **there is no rimout, so a captured ball scores in that column 100% of the time** (measured;
see "There is NO rimout on this machine"). It is still never authoritative - `_paintShot` hands the
real grid to `commitDrop` when the move lands, or calls `cancelDrop` if the rules refused it (a
full column is a miss, so `_dropOnCapture` checks `canPlay` before starting at all).

**The match is matched on the PREDICTION, not on whether a disc is still in the air.** A top-row
fall is 0.22 s and the median resolve gap is 0.35 s, so the drop routinely FINISHES before the
throw resolves; keying off `dropTarget()` would then see nothing flying and start the whole fall a
second time. `_predicted` is set at capture and consumed by `_paintShot`, which covers both
orderings.

Verified in a real browser, instrumenting the renderer over made shots: **exactly one `startDrop`
and one `commitDrop` per made shot, the drop starting on the same frame as the capture**, no page
errors. `test-game-conventions.mjs` 11/11, `test-hoops4-mp.mjs` 77/77,
`check-no-scroll.mjs hoops4` 4 screens / 0 scroll, `test-visual.mjs hoops4` 13/13.

### How to play, drawn (2026-09-22)

Matt: *"The How To Play is even worse. it's JUST words. That goes against everything I've ever
told you."* It was one paragraph of five sentences.

Rebuilt to `docs/BUILDING-A-GAME.md`'s "How-to-play screens" pattern, which already existed and
which this screen had simply never followed: one bold sentence, **a diagram of the ONE
non-obvious mechanic**, a caption, a concrete "X = Y" example, then the edge cases as plain
single-row lines.

**The one non-obvious mechanic is that the two games are WIRED TOGETHER.** Everybody already
knows Connect 4 and everybody already knows basketball; nobody can guess that the hoop you sink
decides which column your disc falls down. So the diagram is seven hoops over a grid with the
third taking a ball and a dashed arrow carrying it down column 3 to a disc at the bottom. The
chosen hoop is marked by a **thicker outline, the ball in it and the arrow leaving it** - never by
its colour (root CLAUDE.md; Matt is red/green colourblind).

**Every line fits on one row, and that was measured rather than eyeballed.** The first build had
two lines wrapping to two rows at 393px; the fix was shortening both strings in both languages,
not shrinking the type, which is already 13px against the UX floor's 11px. The probe in
`reference/` reports wrapped lines, the minimum font size and whether anything scrolls.

### What makes a hoop read as a hoop (2026-09-22)

Matt, on a phone screenshot of the shipped v886: *"These don't look like real baskets to me."*

They were real wire baskets, ported from HOT SHOT, and they still read as a **wire fence**. Four
things were wrong at once, and each one is only visible at the size a hoop actually occupies -
about thirty pixels tall on a 393 px phone:

**Then it was still not HOT SHOT's.** Matt, on the build that followed: *"They're still not the
same."* The construction had been ADAPTED rather than ported - a threshold changed here, the orange
moved there - and each small departure made it something else. It is HOT SHOT's `_wireBasket` now,
at its own proportions and its own tube radii: the orange carries the rim AND the bottom ring AND
the ten ribs, and the white net gets THREE bands because `collarH > R * 0.9` (the adapted version
used a threshold that gave this machine ONE band, and one band of strands over an orange frame is
the wire fence). The backboard is HOT SHOT's cream ARCH with a white box outlined in orange,
bottomed at the rim so the net hangs clear below it, rather than the flat rectangle that replaced
it first.

The four readings that came before that are all still true, and are why the port was needed:

- **The rim was PALE and so was the net.** The pale rim came from reading the reference photo, and
  optimising for it was the wrong call: two greys, one on top of the other, is a mesh band. The
  rim is **orange** now and the net is **white**, because that pair is what a basketball hoop IS
  at thirty pixels. The photo reading is recorded in `boarddef.js`'s `look` block next to the
  value that replaced it.
- **The ribs and the bottom ring were painted in the RIM's material**, so ten orange verticals
  hung under an orange ring and the silhouette came out SQUARE. Only the rim ring is orange now;
  everything below it belongs to the net.
- **There was no backboard behind any hoop.** There were seven white boards - half a metre ABOVE
  the row, on the cabinet's header, connected to nothing. A ring with a net is a ring with a net;
  what makes the eye say "basketball hoop" is the board immediately behind it. `_hoopBackboards()`
  hangs one on the back riser behind each rim, bottomed just under it so the rim reads as bolted
  on, width = the column pitch minus a gap (HOT SHOT's own no-overlap rule), **one draw call for
  all seven** via an `InstancedMesh`. The header strip is what it always actually was: a fascia.
- **The fins spiked black against the wall.** They are load-bearing physics (nothing else stops a
  ball balancing across two rims) and they had been pale grey, which made them fence posts, then
  near-black, which made them silhouettes. They are the RISER'S OWN BLUE now - they stand in front
  of that wall, so its colour is the only thing that makes them disappear.

Draw calls: 33 before, 34 after (the backboards' one instanced mesh).

**The lesson, and it is the same one `VISUAL-PROCESS.md` keeps teaching:** the construction was
right and the READING was wrong. Nothing headless can see this, and neither can a crop at 6x zoom
- it took a phone screenshot at play size. Crop the hoop row at the size it renders and ask what a
stranger would call it.

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
| "rims a little bouncier than other skeeball games", and then "they're not very bouncy, like I asked" | `ringRest` 0.72 (HOT SHOT 0.30, THE CLASSIC 0.18) AND the shelf, the display panel, the fins and the chamfers made live - see "NOT VERY BOUNCY WAS NEVER THE RIM" above | 60% of misses bounce, 1.31 bounces each, mean best rebound 0.72 m/s, all three asserted in `test.js` |
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

- **Two shot rules, and the player picks** (2026-09-22). Matt: *"there should be an option to play
  shoot til you make one, OR 1 shot and that's it. especially for the multiplayer."*
  - **Shoot until you sink one** (`shots: 'until'`, the original): a miss costs a shot, not the
    turn. A turn only ends when a ball goes in.
  - **One shot only** (`shots: 'one'`): a miss passes the turn.

  **It lives on the `Match`, not in the UI** (`oneShot` in `js/game.js`), and that is the whole
  reason: under one-shot a miss is a RULE OF THE GAME, and in a multiplayer match both sides have
  to agree on it or their boards diverge on the very first airball. In a live room the HOST'S
  setting wins and is carried in the room's `config`; in a turn-by-turn match it is frozen on the
  match document at creation. A shot into a FULL column takes the same path as a miss, through one
  shared `_passTurn()`, so the two can never drift apart.
- **A ball that rims out into the NEXT hoop still counts, in that column.** Nothing steers a ball
  (`MACHINE-SPEC` §9's standing ban), so the wrong hoop is a real outcome and the best moment the
  format has.
- **A shot into a FULL column is a miss** and you shoot again. The only case where going in is not
  a move, and it is a rule about the board rather than about the shot.
- **The grid is a SCREEN**, exactly as on the real cabinet — an LCD above the hoops. That is also
  what makes this buildable: 42 discs are paint on a `CanvasTexture`, not 42 rigid bodies, and the
  physics only ever has to answer *which hoop did it go through*.

## Multiplayer: TWO protocols, on purpose (2026-09-22)

Matt asked for both halves in one line: *"build the multiplayer (host game live and turn based
sending to each other like we discussed)"*. They are genuinely different problems and they use
different layers. `js/mp-ui.js` is the one screen both are reached from ("Play a friend" on the
setup screen); it is DOM only and lazily imported, so a solo player downloads none of it.

| | LIVE | TURN BY TURN |
|---|---|---|
| layer | `js/net.js`, `rooms/<CODE>` | `hoops4/js/mp.js`, `hoops/games/<id>` |
| addressed by | a five-character room code, typed in | the other person's PLAYER CODE |
| who is present | both, now | neither has to be |
| how they find it | the host reads the code out | it is sitting in their list next time they open the hub |
| ships without a rules change | **yes** | **no — see below** |

**ADDRESSED BY PLAYER CODE, never by deviceId.** Several people here have two phones, and a match
addressed to a device is playable on one of them and invisible on the other. This is the one thing
`bugReplies/` gets wrong and `js/messages.js` gets right, and it is why turn-by-turn is built on
messages' shape rather than on net.js's.

**A MOVE LOG, never a board snapshot.** An async match has no stored position: `replay()` runs the
log into a fresh `Match`. A log either replays identically on both devices or `validateGame()`
refused it before anything was drawn — where a snapshot can be subtly wrong and look fine.
`validateGame` is WHOLE-DOCUMENT REJECTION for the same reason `js/career-store.js` is: one bad
entry replays into a DIFFERENT position on the two phones, with nothing on either screen saying so.

**The log carries TWO kinds of entry, and it needs both.** A landed shot is `{by, col, shots}` —
`shots` is how many it took, so a replay can charge the shooter the misses that came first, which
is what keeps the accuracy line honest. A `{by, miss:true}` entry exists ONLY under one-shot, where
a miss hands the turn over; under shoot-until-you-make-it a miss changes nothing the other person
can see and is never sent.

**Nothing is ever deleted.** A finished match keeps its move list and both index rows. Resigning
writes `over: {winner, why:'resign'}` — it does not remove anything.

**Every write is verified by a fresh re-read before it is reported as sent** (THE LAW rule 6), and
a move that cannot be sent is QUEUED on the device (`gamehub.hoops4.outbox.v1`) and retried the
next time the screen opens, rather than lost with an apology.

### `hoops` is a new top-level node, so THE RULES HAVE TO BE PUBLISHED BY HAND

Since the Messages work the database's root is `.read: false / .write: false` with every branch
enumerated in `database.rules.json` (root `CLAUDE.md`, "Messages"). `hoops` is added to that file
here — but **no script in this repo deploys it**: it is pasted into the Firebase console (Realtime
Database → Rules → paste → Publish). Until that happens, turn-by-turn fails SOFTLY and says so:
`readMyGames()` returns `[]`, `createGame()` returns `{ ok:false, reason:'denied' }`, and a denied
write is deliberately **not retryable**, so it can never sit in the outbox for ever.

**LIVE multiplayer is unaffected and needs no rules change** — `rooms/` is already enumerated.
That is why the two halves are separated the way they are: the half that can ship on a push does.

`backups/rtdb-backup.mjs`'s `BRANCHES` list has `hoops` in it too, because that list must stay in
step with the rules file or a branch is silently missing from every snapshot.

### What is NOT built

- **No push notification.** The badge-on-next-open model is all this repo has; real push needs FCM
  and a permission prompt, and `js/CLAUDE.md` says so in as many words about Messages.
- **No launcher badge yet.** `countMyTurns(rows, code)` is exported and tested and is exactly what
  a badge would count, but nothing on the hub reads it. A badge goes where the thing it counts is
  reached (`js/CLAUDE.md`), and that is a hub-side change, not a hoops4 one.
- **No rematch button on a finished async match.** Challenge them again from the picker.

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

- **The `hoops` rules are not published.** Turn-by-turn cannot write until they are pasted into
  the Firebase console — see "Multiplayer" above. Live multiplayer works without it.
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
- `node test-hoops4-mp.mjs` — the PURE halves of turn-by-turn multiplayer: whole-document
  rejection, the replay (position AND shot counts), the turn rules under both shot modes, the
  listing's order and the badge count, plus structural checks that every write is verified, a dev
  origin cannot write, and `hoops` is in both `database.rules.json` and the backup script's branch
  list. The Firebase write path and `js/mp-ui.js` are NOT covered, and the suite header says so.
- `node test-visual.mjs hoops4` — the only suite that LOOKS at it.
