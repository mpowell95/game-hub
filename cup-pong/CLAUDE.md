# Cup Pong — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them. **Stage 1 stores nothing at all** (no
> settings key, no stats, no save), so there is nothing here yet to lose.

A clone of GamePigeon's Cup Pong (the iMessage game), as an in-hub module. The spec is
**`docs/CUP-PONG-BRIEF.md`** - read it before changing anything here. It builds in five stages;
this file says which are done.

## Where it stands (2026-09-27)

| Stage | What | State |
|---|---|---|
| 1 | Table + throw: three.js + cannon-es, the camera, flick to throw, cups vanish when made, rack as hex cells. Solo practice only | **Built, deployed devOnly, waiting on Matt's feel check** |
| 2 | Rules (brief section 3, as Matt confirms them), settings, Gentleman's, vs CPU, rebuttal, stats | not started - **blocked on Matt's yes/no to the section 3 list** |
| 3 | Rerack: presets, then custom | not started |
| 4 | Bounce shots | not started - brief says show Matt the async design first |
| 5 | Challenges + push | not started |

**Matt was sent the section 3 rules as one list on 2026-09-27 and has not answered yet.** Do not
build any rule from that list until he has. When he answers, write his answers here, line by
line, dated.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../cup-pong/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `cuppong`, **no `released` date** (Matt releases it from the admin page; that day gets the date) |
| Stats id | `cuppong` - **not registered yet.** Stage 1 records nothing, so it is deliberately NOT in `js/game-stats.js`'s `GAMES`, `js/leaderboard-ui.js`'s `GAME_META` or `js/game-stats-ui.js`'s `TABS`. Stage 2 adds all three in the same commit as the first `recordResult('cuppong', ...)` (brief section 2; `players-agg.test.mjs` then enforces the `GAME_META` row) |
| CSS root / prefix | `.cp-root` / `.cp-` |
| Settings key | `gamehub.cuppong.v1` - reserved for stage 2, **not written yet** |
| `isInProgress()` | always `false` in stage 1 (practice: nothing to abandon). Stage 2 switches to the NO MID-GAME RESUME meaning for a vs-CPU match (Hoops' class); a challenge stays `false` because it lives in Firebase |
| Tile art | `GAME_ART.cuppong` in `js/game-art.js` |
| Strings | `js/strings.js`, `{ en, es }`, `makeT` at render time |

## Files

| File | Role |
|---|---|
| `js/geom.js` | every size, once, in metres: table, cup, ball, the throw band, the camera. Pure |
| `js/rack.js` | **the rack model** (below). Pure |
| `js/physics.js` | the ball, simulated by cannon-es (`skeeball/js/vendor/`, not copied). DOM-free |
| `js/render.js` | three.js scene from `geom.js`'s numbers |
| `js/ui.js` | the shell, the flick, the loop, the module contract |
| `js/strings.js` | EN/ES |
| `js/test.js` | `node cup-pong/js/test.js` - 25 checks, ~15 s. Not in `sw.js` (dev only) |
| `css/cup-pong.css` | every rule under `.cp-root` |

## The rack is a set of hex cells (brief 4c: "build this first")

`js/rack.js`. A rack is `[{ id, c, r }]`. The grid is **doubled-width hex coordinates**: `r` is the
row (0 = furthest from the shooter), `c` counts HALF cup-widths, and a cell is real only when
`c + r` is odd - that parity is what shifts every other row by half a cup. The pitch IS one cup
across (plus 2 mm, so two cups' collision walls never overlap), so neighbouring cells are
touching cups. `cellXZ` turns a cell into table metres; the physics and the renderer only ever see
`{ id, x, z }` from `cupsXZ`. A cup keeps its id (`k0`..`k9`) for the whole game; a rerack will
move ids to new cells.

`AREA` (|c| <= 5, r 0..4) is the rack area. The triangle is `PRESETS.tri10`.

### OPEN QUESTION for Matt: the Gentleman's line does not fit a hex grid

Brief 4b: *"one centered at the front, one directly behind it, touching."* Two cups touching in a
straight line pointing at the shooter are one cup-width apart ALONG the table, and a hex grid's rows
are `0.866` of a cup-width apart - so no two cells are ever directly behind each other and touching.
The same is true of the brief's "Line 1-1-1" and "Line 1-1-1-1" presets. It is geometry: no
single lattice holds both the 4-3-2-1 triangle and a straight touching line. Options to put to
Matt before stage 2 builds Gentleman's: (a) the rack format also accepts free positions for the
line shapes; (b) the line cups sit on alternate rows, straight but with a small gap between them;
(c) a line is drawn slightly zig-zag on the grid.

## The throw

- **The flick is skeeball's** (`skeeball/js/swipe.js`, imported, never copied): speed in
  screen-heights per second clocked with `e.timeStamp`, and its measured natural range
  (`SWIPE_SLOW` 0.65 -> power 0, `SWIPE_FAST` 4.20 -> power 1). Power is NOT clamped.
- **Power -> launch speed** is `geom.js`'s `THROW.minSpeed`/`maxSpeed`, interpolated as energy
  (v^2). The ball leaves a fixed release point (`THROW.z0`, `y0`) at a fixed angle (`elev`
  0.62 rad); only speed and heading change.
- **Aim** is the swipe's angle off straight up times `aimGain` (0.24), clamped to `aimMax`.
  A 15 degree swipe is ~3.5 degrees of heading, which is the back corner cup.
- **The band was set by measurement, not by feel** (Matt has not thrown it yet): power 0 lands
  just past midcourt, power 0.55 lands at the rack, power 1 flies off the far end.
  `node cup-pong/js/test.js` prints the landing point per power.

**Stage 1's feel check is Matt's.** The numbers to change if the throw feels wrong, in order:
`aimGain` (fiddly aim), `minSpeed`/`maxSpeed` (everything short or long), `elev` (arc too flat or
too high). All pure input shaping - none of them changes the physics. A small "Power 0.55 · Aim
+1.8°" line bottom right shows the last throw, so a report can quote numbers. Remove it once the
throw is settled.

**Measured in a real browser (2026-09-27):** scripted touch flicks through the real pad throw
the ball, and aim follows the swipe's angle. The harness CANNOT measure power: SwiftShader delays
each synthetic touch event by 35-200 ms, so every scripted flick reads as a slow push. Only a real
hand can say whether the band is right.

## The physics

- **Real geometry.** Each cup is ONE static body holding 20 wall boxes round a cone (9.5 cm top,
  6 cm base, 12 cm tall), 40 small spheres along the rim so it is round to the ball, and a base.
  The table is a box. The ball is a 40 mm, 2.7 g sphere.
- **Made = all of the ball below the rim plane, inside the wall.** Nothing gets there except over
  the rim, because the walls are solid. It is decided, never predicted.
- **1/480 s step, not skeeball's 1/240.** At 1/240 a fast ball can move past a 6 mm wall's
  mid-plane in one step and be pushed out the wrong side, through the cup.
- **Air drag** (quadratic, `DRAG_K`) and **rolling resistance** on the table (`ROLL_DECEL` in
  `physics.js`). Without the second, a slowly rolling miss never stopped and ran to the 6 s cap.
- A throw ends as `made` (with `bounced`: it touched the table first - stage 4 reads it), `off`
  (fell off the table) or `miss` (came to rest, including on top of the cups).
- **No magnetism, ever** (skeeball's ban). Nothing steers the ball.

Measured, 858-throw power x aim grid over the full rack: every one of the 10 cups is made (5-10
times each), 9.3% of the even sweep scores, 380 throws touch a cup and stay out, none reaches
the time cap (slowest 4.2 s). **Bounce shots:** soft throws that bounce off the table score about
as often as direct throws on an even sweep (~12% vs ~11%). Table bounce (`MAT.tableRest`) is not a
clean lever for that (0.78 / 0.70 / 0.62 / 0.55 gave 12 / 12 / 15 / 6.5%). Revisit in stage 4.

## The camera

GamePigeon's view: behind the shooter's end, looking down the table, the rack in the middle of
the screen, the arc above it, the ball waiting at the bottom. `render.js` pitches the camera to
centre a fit list (the rack's outer rims, the far table corners, the resting ball, and the top of
a mid-dial arc, `CAMERA.apex`) and widens the field until all of it is on screen. The camera
stands well BEHIND the ball (`CAMERA.pos` z 2.60 against a release point at 1.30): closer, the
ball dominates the frame and the rack shrinks to a sliver. Measured on a 393x852 phone: the rack
is ~180 px wide.

## Tests

- `node cup-pong/js/test.js` - the rack model and the real physics (above).
- `node test-game-conventions.mjs` - the shared checklist.
- `node check-no-scroll.mjs cup-pong` - no game in the hub may scroll.
