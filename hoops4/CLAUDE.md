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

`js/boarddef.js`. **Every value that differs from HOT SHOT was measured** — the sweep is
`reference/hoops/sweep-hoops-columns.mjs`, the write-up is `reference/hoops/FINDINGS.md`, and the
probe that holds it all is `hoops4/js/test.js`.

### The width is set by the COLLARS, not by the holes

Two rules, and the first alone is not enough:

```
holes.spacing    6 gaps x 1.30X + 0.5X margin each side        =  8.800X
MACHINE-SPEC 12  |u| + collar radius + a 0.78X wall gap        = 10.443X   <- this wins
```

At 8.800X the outer collars stood **0.041X through the side rails**, because the spacing rule
only constrains hole CENTRES while a collar is 0.541X in radius and a throat 0.916X. Measured
consequence: 4 captured balls escaped past the rail where their own throat was cut open by it.
**The holes did not move** when the cabinet widened — the pitch is still 1.30X and the outer pair
still at ±3.90X — which is why the aim mapping in `FINDINGS.md` still stands.

### Matt's four requirements, and the number that proves each

| he asked for | how | measured |
|---|---|---|
| "rims a little bouncier than other skeeball games" | `ringRest` 0.46 (HOT SHOT 0.30, THE CLASSIC 0.18) plus `captureDrop` 0.52 (HOT SHOT 0.35) | both asserted in `test.js` |
| "a little bit of unpredictability" | a SEEDED per-throw scatter on the launch only | seeded replays exactly; unseeded is bit-identical to before |
| "a ball can't get stuck balancing between two rims" | **the fins** — see below | 18 saddle drops, **0** stay |
| "once it goes into a basket, it goes down that column 100% of the time" | **no rimout**, plus a throat that runs above the rim | **100.00%** (was 94.07%) |

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
columns are 0.08 to 0.20, so a Beginner's 0.30 genuinely lands it in the wrong column often.

**It shoots through the same physics the player does.** Nothing places a CPU disc directly.

## The swipe

`aimCurve: 1` and `aimDiv: 1.10`, both departures from Skeeball's defaults and both deliberate.
Skeeball squares the swipe angle (forgiving near straight, steep at the corners), which is right
for a machine whose hard shots ARE the corners and wrong for this one — squaring compresses the
OUTER columns into the narrowest slivers of thumb arc, so columns would get harder to pick the
further out they are on top of already being smaller targets. BRICK CITY set `aimCurve: 1` for the
same reason. `aimDiv` spends the whole thumb arc on the aim range that actually exists (±0.42).

**`aimDiv` IS THE FIRST NUMBER TO TUNE if Matt finds the columns fiddly.** It is pure input
shaping and touches no physics.

## Still open

- **Async multiplayer.** Matt asked for challenge-a-player-and-hand-it-over ("that would be
  amazing"). Designed but NOT built: it is the shape of `js/messages.js` (addressed by player
  CODE so a match follows a person to every device), not `js/net.js` (a live room layer with a
  heartbeat and a TTL). The sketch is `skeeball/mockup-hoops-four.html`. There is no push
  notification in this repo, so the opponent would find out via a badge on their next hub load.
- **Whether a human swipe has the precision seven columns need.** The sweep drives `aim`
  directly; a real gesture goes through the curve above. This is the thing a playtest answers.
- **The outer columns are easier than the middle** (112 and 113 hits against 26-43 in the sweep),
  because everything past the aim needed to reach column 1 still lands in column 1. Arguably the
  right way round, since Connect 4's centre columns carry the most winning lines — but confirm it
  reads as skill.

## Testing

- `node hoops4/js/test.js` — the engine probe, headless, ~2 min. `POWERS`/`AIMS` env vars set the
  grid. It is the file that holds all four of Matt's requirements as numbers.
- `node test-game-conventions.mjs` — the shared checklist; it discovers game folders from disk.
- `node check-no-scroll.mjs hoops4` — **no game in this hub may scroll.**
- `node test-visual.mjs hoops4` — the only suite that LOOKS at it.
