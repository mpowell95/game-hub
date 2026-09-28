# Cup Pong — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them. **Stage 1 stores nothing at all** (no
> settings key, no stats, no save), so there is nothing here yet to lose.

A clone of GamePigeon's Cup Pong (the iMessage game), as an in-hub module. The spec is
**`docs/CUP-PONG-BRIEF.md`** - read it before changing anything here. It builds in five stages;
this file says which are done.

## Where it stands (2026-09-28)

| Stage | What | State |
|---|---|---|
| 1 | Table + throw: three.js + cannon-es, the camera, flick to throw, cups vanish when made, rack as hex cells. Solo practice only | **Done.** Matt, 2026-09-28, after the third throw build: *"It feels good now, start stage 2"* |
| 2 | Rules (brief section 3, confirmed below), settings, Gentleman's, vs CPU, rebuttal, stats | **Built 2026-09-28, deployed devOnly, waiting on Matt's play-test.** The Reracks setting (brief 4a) moved to stage 3, see "Stage 2" below |
| 3 | Rerack: presets, then custom | not started |
| 4 | Bounce shots | not started - brief says show Matt the async design first |
| 5 | Challenges + push | not started |

### The GamePigeon rules, CONFIRMED by Matt 2026-09-27 ("1-7: yes")

1. 10 cups per side, triangle 4-3-2-1, point toward the shooter. **Yes.**
2. Each turn is 2 throws. A made cup disappears. **Yes.**
3. Balls back: make both throws in a turn and you get 2 more throws. Repeats. **Yes.**
4. Same cup twice cannot happen (a made cup vanishes at once). **Yes.**
5. Heating up / on fire IS in GamePigeon: cups on 2 turns in a row = heating up, the 3rd = on
   fire, shoot until you miss. **Yes.**
6. Win: clear all the opponent's cups. **Yes.**
7. Ball physics: rims, rolling round a rim and out, bouncing off table and cups, off the table.
   **Yes.**

### Matt's first feel check (2026-09-27): "the flick doesn't feel right"

He sent two screen recordings of real GamePigeon (Dropbox, `/Claude Code Refs/ScreenRecording_
09-27-2026 16-04-24_1.MOV` and its `(1)` twin). Stage 1's first build had been designed without a
reference and was wrong in almost every visible way: a camera low behind the shooter, a wood table,
red cups, the ball hanging in the air near the lens, a slow high lob. The second pass rebuilt it
from the recordings - see "The look" and "The throw" below. Aim: he was "not sure".

## Stage 2: a match against the computer (2026-09-28)

**The setup screen** (hub skin, `css/ui.css` primitives): Play the computer (Easy / Medium / Hard,
each with its shape from `js/difficulty-tiers.js`), Gentleman's On/Off, **Play**, and **Practice**
(stage 1's solo table, unchanged).

**The Reracks setting (brief 4a) is NOT on the setup screen yet, on purpose.** It picks how many
reracks each player gets, and the rerack itself is stage 3; a setting that does nothing is worse
than none. It ships with stage 3, frozen into the match exactly like Gentleman's.

**`js/match.js` decides everything**, as events: `made`, `miss`, `ballsBack`, `heatingUp`,
`onFire`, `cooled`, `rackCleared`, `rebuttal`, `overtime`, `gentlemans`, `turnOver`, `win`. The
screen only announces them. Five calls the rules left open, made here and written down so they are
not re-decided differently:

- **On fire** starts on the first make of the third turn running with a make, and from then the
  shooter throws until a miss, whatever throws the pair had left. **The miss ends the turn AND
  resets the streak** (you have to heat up again). Without the reset, a player would be back on
  fire with their very next make.
- **Balls back** needs both throws of a pair in. It repeats. It does not apply on fire or in a
  rebuttal, where you throw until you miss anyway.
- **The rebuttal** is "shoot until you miss" at the rack of the side that just cleared. A miss hands
  the match to the side that cleared; clearing everything goes to overtime.
- **Overtime**: 3 cups a side in a 2-1 triangle on the BACK rows (`OVERTIME_CELLS`), normal rules,
  streaks reset, and the side that cleared first shoots first. A rebuttal applies again at the end
  of overtime, so overtime can repeat.
- **Gentleman's** is checked at the start of every turn against the rack being shot at; a rack
  already standing in the line is left alone. The cups slide into place (`slideRack`, 0.6 s).

**The two ends of the table.** Your turn uses the fitted camera. The computer's turn glides the
camera to the other end, behind your own RED cups, looking back at it (the recording shows the
opponent's balls coming at you over your cups). Every rack and every throw is kept in the
SHOOTER'S frame; `render.js toWorld` turns side `a` (yours) half round for drawing. Physics never
needs to know whose throw it is.

**The spare ball**: while a pair still has a throw after this one, a greyed ball sits at the left
edge, as in the recording.

**The computer** (`js/cpu.js`) aims at a cup with the same launch point, angle, gravity and drag as
`physics.js`, then adds a Gaussian error to power and heading. Easy and Medium pick a cup at random;
Hard picks the cup with the most neighbours. The throw goes through the real physics, so its makes
and misses are real. **Measured** (`node cup-pong/js/test.js`, and 30-match simulations per
pairing, 2026-09-28):

| | sPower | sAim | make rate over whole matches | vs the next level |
|---|---|---|---|---|
| Easy | 0.30 | 0.080 | ~13% | lost 29 of 30 to Medium |
| Medium | 0.15 | 0.040 | ~20% | lost 29 of 30 to Hard |
| Hard | 0.06 | 0.025 | ~37% | won 30 of 30 against Easy |

Perfect aim (no error) lands in the cup it aimed at for all 10 cups. **Whether Easy loses to a new
player and Hard is hard is Matt's to say** - the sigmas are the only knob, in `SKILL`.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../cup-pong/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `cuppong`, **no `released` date** (Matt releases it from the admin page; that day gets the date) |
| Stats id | `cuppong`: plain `recordResult('cuppong', difficulty, won)` once per finished match vs the computer, difficulty `easy`/`medium`/`hard` (`mp` is reserved for challenges, stage 5). **No sub-counter**, so the three-edit rule does not apply. Registered 2026-09-28 in `js/game-stats.js` `GAMES`, `js/leaderboard-ui.js` `GAME_META` (on the board even while admin-only, `OFF_THE_BOARD` stays empty) and `js/game-stats-ui.js` `TABS` (devOnly, Air Hockey's shape), label `game_title_cuppong` in `js/strings.js`. Practice records nothing |
| CSS root / prefix | `.cp-root` / `.cp-` |
| Settings key | `gamehub.cuppong.v1`: `{ diff, gentlemans, nextFirst }` - preferences only, saved on every selection. `nextFirst` alternates after each finished match (the repo's turn-based default) |
| `isInProgress()` | the NO MID-GAME RESUME meaning (Hoops' class): `true` while a match vs the computer has had a throw and is not over, because a match is not persisted. Practice: `false`. A challenge (stage 5) must answer `false`: it will live in Firebase |
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
| `js/match.js` | **the rules of a match**, pure: turns, balls back, heating up / on fire, rebuttal, overtime, Gentleman's. Everything comes back as events |
| `js/cpu.js` | **the computer**, pure: aims with the same ballistics, misses by a skill-sized Gaussian error |
| `js/test.js` | `node cup-pong/js/test.js` - ~50 checks, ~25 s. Not in `sw.js` (dev only) |
| `css/cup-pong.css` | every rule under `.cp-root` |

## The rack is a set of hex cells (brief 4c: "build this first")

`js/rack.js`. A rack is `[{ id, c, r }]`. The grid is **doubled-width hex coordinates**: `r` is the
row (0 = furthest from the shooter), `c` counts HALF cup-widths, and a cell is real only when
`c + r` is odd - that parity is what shifts every other row by half a cup. The pitch IS one cup
across (plus 2 mm, so two cups' collision walls never overlap), so neighbouring cells are
touching cups. `cellXZ` turns a cup into table metres; the physics and the renderer only ever see
`{ id, x, z }` from `cupsXZ`. A cup keeps its id (`k0`..`k9`) for the whole game; a rerack will
move ids to new cells.

**A cup may instead sit at an exact SPOT, `{ id, u, v }` in cup-widths.** Straight lines toward the
shooter cannot live on a hex grid (touching cups one behind the other are 1 cup-width apart along
the table; hex rows are 0.866 apart), and that covers the Gentleman's and the Line presets. Matt,
2026-09-27: *"do whatever you have to do so that these racks are possible and look correct and are
placed correctly."* So `line2` (the Gentleman's), `line3` and `line4` are spots: centred, touching,
front cup exactly where the triangle's point stands, except `line4`, which is deeper than the
triangle and so has its back cup on the back row instead. `validRack` checks overlap and the area in
METRES, so cells and spots are checked against each other correctly. Custom racks (stage 3) snap to
cells; only the line shapes need spots.

`AREA` (|c| <= 5, r 0..4) is the rack area. The triangle is `PRESETS.tri10`.

## The throw (rebuilt 2026-09-27 from the recordings)

- **The ball waits ON THE TABLE at mid-court** (z = 0), where the recording serves it - not in the
  air in front of the camera.
- **The flick is skeeball's** (`skeeball/js/swipe.js`, imported, never copied): speed in
  screen-heights per second clocked with `e.timeStamp`, and its measured natural range
  (`SWIPE_SLOW` 0.65 -> power 0, `SWIPE_FAST` 4.20 -> power 1). Power is NOT clamped.
- **Power -> launch speed** is `THROW.minSpeed`/`maxSpeed` (1.87 / 3.64 m/s), interpolated as energy
  (v^2), at a fixed 1.00 rad under `GRAVITY` 6.5. Power 0 lands ~0.46 m on, power 0.55 reaches the
  middle of the rack, power ~0.65 and up flies off the end. The rack spans roughly power 0.35-0.65.
- **THE ARC WAS FITTED TO THE RECORDING, and it took three builds (2026-09-27/28).** The GamePigeon
  ball is a HIGH, FLOATY LOB: at 15 fps it climbs ABOVE the rack on screen, peaks over the front
  cups around frame 8, and drops in at ~0.67 s. Build 1 designed an arc with no reference; build 2
  read that peak as an overshoot and flattened the throw to 0.55 rad (Matt: *"It goes too low. It's
  like a straight line and I can barely get it to hit the top of a cup"*). Build 3 fitted launch
  angle, speed AND gravity to 11 frames of the ball's screen path, with one extra constraint: the
  ball must be AT THE RACK when the recording shows it there. **Without that constraint the fit
  cheats** - from this steep camera a near-vertical toss that never leaves mid-court traces the
  same path up the screen. Result: 1.00 rad, 3.05 m/s, gravity 6.5, every frame within ~0.02 of
  the screen, and the same trace measured again in the real browser matches.
- **Gravity is 6.5, not 9.81, on purpose** (`GRAVITY` in `geom.js`). No real-gravity arc matched
  both the path and the timing. Do not "correct" it.
- **AIM FOLLOWS THE FINGER** (`aimFromSwipe` in `ui.js`). The flick's direction on screen is carried
  up from the waiting ball to the rack's row on screen, that point is unprojected onto the table,
  and the heading is the line from the ball to it. A flick that points at a cup sends the ball at
  that cup, on any phone. The first build multiplied the flick's angle by 0.24 instead, so the
  ball went somewhere other than where the finger pointed.

**If the throw still feels wrong**, in order: `minSpeed`/`maxSpeed` (everything short or long),
`elev` and `GRAVITY` together (too flat, too loopy, too quick or too slow) - and re-fit to the
recording rather than guessing; the fitting scripts are described above. Aim has no knob any more: it is where you point. The "Power / Aim"
line bottom right shows the last throw so a report can quote numbers; remove it once the throw is
settled.

**Measured in a real browser:** scripted touch flicks through the real pad throw the ball, and aim
follows the flick. The harness CANNOT measure power: SwiftShader delays each synthetic touch event
by 35-200 ms, so every scripted flick reads as a slow push. Only a real hand can judge the band.

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

Measured on the lob (build 3), 858-throw power x aim grid over the full rack: every one of the 10
cups is made (11-34 times each), 23.9% of the even sweep scores, 445 throws touch a cup and stay
out, none reaches the time cap (slowest 4.1 s). Soft throws that bounce off the table go in again
(40 of 403); build 2's flat throw had made that 0 of 969. Bounce shots are still brief section 5d,
stage 4's; `test.js` prints the count as `info` until then.

## The look and the camera (fitted to the recording, 2026-09-27)

**The camera is FITTED, not designed.** `CAMERA` in `geom.js`: 1.305 m above the table, over
z = 0.803 (the near half), pitched 44 degrees down, 41.8 degree vertical field on a 1:2 screen. A
search over camera height, distance, pitch, field, table width and serve spot matched seven things
read off a GamePigeon frame: where the far edge sits (22% down), how wide it is (79% of the
screen), where the side edges leave the screen, where the ball sits (82% down) and how big it is,
where the rack's point and back row sit, and the rack's width (46%). `resize()` keeps that WIDTH
on a taller phone and that HEIGHT on anything wider.

**The table is 0.72 m wide**, not a real 0.61: the same fit says GamePigeon's table is wider
relative to its cups, and this is a clone of that.

The rest, from the recording: green felt (matte - a specular one washed out to grey) with a white
border and a white centre line down its length and NO crosswise line; the opponent's cups BLUE
(`LOOK.cups.blue`; your own will be red) with white insides that glow slightly so they read white;
a striped brown wall over a strip of dark panelling behind the far end (an UNLIT backdrop, because
the key light stands behind it); a pale plank floor just below the table, so it shows beside the
far end; black legs; the light high behind the far end on the right, so shadows fall toward the
player's left. **A made cup lifts out and is carried off** up and to the right, fading - not a
sink. No word pops up for a make or a miss (GamePigeon shows none; "Balls Back" is stage 2).

Headless Chromium is SwiftShader, so `render.js` turns shadows off there: screenshots from the
container never show them. A phone does.

## Tests

- `node cup-pong/js/test.js` - the rack model, the rules of a match, the computer and the real physics.
- `node test-game-conventions.mjs` - the shared checklist.
- `node check-no-scroll.mjs cup-pong` - no game in the hub may scroll.
