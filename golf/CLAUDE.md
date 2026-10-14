# Golf — CLAUDE.md

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. The law
> and its nine working rules are at the top of the root `CLAUDE.md`, always loaded alongside this
> file. Rules 4 and 5 do real work in this game: see "Stored shape" below.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md` (not auto-loaded; headings unchanged, so "golf/CLAUDE.md, \"X\"" references are found there).

## Status (2026-09-11): BUILT AND SHIPPED, admin-only right now, Pine Valley the only open course

- **Complete**: setup, tutorial hole, unlock ladder, three-tap swing, flight and putting, scorecard, mid-round save, per-hole/per-round records, own leaderboard, pause menu with Report a bug.
- **ADMIN-ONLY since 2026-09-10** (`adminConfig/v1/games/golf` `live: false`, Matt's switch while the swing is retuned). A config flip, not a code flag: **do not "fix" it by editing `devOnly`** (two switches for one decision ships a game hidden by accident). `js/admin-config.js`'s per-COURSE resolvers exist and are tested; `js/admin-ui.js` has no per-course section.
- **Only Pine Valley is open** (`COURSE_OPEN_BY_DEFAULT` `{ pinevalley: true }`). Matt: *"Pine Valley ONLY."* Red Mesa and Oasis Sands are finished and unreleased: a test or difficulty failure on ONLY those is no reason to hold a deploy. **Coral Keys (2026-09-29)**: 4th course, 9 holes, ADMIN ONLY (end of file).
- **Swing physics were rebuilt 2026-09-10.** Before changing a number in `swing.js`/`clubs.js`, read "Swing and meter" below and the four 2026-09-10 history sections: each reversed something a session did without asking.

**Open, each is Matt's call:**
1. **Leaderboard comparability**: scores set before 2026-09-10 came from physics that no longer exist. Leave, label, or void per player via `js/stats-corrections.js` (no golf path yet). Nothing deleted; nothing should be without him saying so.
2. **Oasis Sands hole 4** (par 5, 451 yd, reachable in two) is a NAMED GAP in `test.js` 15c, printed every run, as is Oasis' easier closing three (delete those branches when re-cut). Fix before that course opens.
3. **HUD top row (`.gf-tl`/`.gf-tc`) overlaps on phones <= 360 px.** Untouched.
4. **Club upgrade tiers** designed, NOT built (`clubs.js` `upgraded`; spec §21.3); must not turn every par 5 into an eagle look.
5. Only 2 of 5 aim-ladder dots show at address with a driver (feel call). Red Mesa 1 is a `bowl` with the pin at the low point (move the pin, par untouched); seven Red Mesa greens (Oasis worse) force a putt over 60 ft (needs redrawn greens).
6. Left alone: flight is played off wall clock (a stall teleports the ball; fix = the loop's clamped `dt`); `LOCK_MS` (1.4 s) also swallows the first tap after a ball comes to REST; unbuilt: the result screen's AI-opponent board, a walking golfer; Oasis palms have no `TREE_FILL` colour and Oasis no greenside bunkers.

**How Matt wants changes made.** For any feel change (swing, meter, distance, difficulty): *propose with numbers, agree, show a mockup, then build.* **An APPROVED table in `golf-reference-spec.md` is a decision, not a starting point**: a disagreeing measurement goes in the doc and the decision goes to Matt. **A measurement nobody asked to act on goes in the docs, not the build** (*"I did NOT instruct you to change anything about tempo"*). Measure rather than argue: `test.js` 15c plays every hole 24x vs par; a BEFORE/AFTER of the same robot is real evidence.

## The courses are EDITABLE, and the clone instruction is retired (2026-09-16)

Matt: *"This is my game. Nothing is locked to me."* The clone instruction governed the FIRST DRAFT of a hole only; any hole may be re-cut, reordered, lengthened or redesigned when Matt asks.

- Golf records in Firebase at that date were Matt's disposable test data (`MattyIce`); THE LAW is unchanged for real players' golf history from here on. **Before any renumbering re-run a fresh RTDB read**; with real history, mint new keys (rule 3's archive route), never rewrite old ones.
- Course design happens in the hole editor (`hole-editor/CLAUDE.md`). `golf/courses/redmesa.js` exports every recipe as `SPEC_n`/`SPECS` and `RM_DEFAULTS`. Placed things are authored in **yards from the tee** (`yd`); an edited hole carries its own `seed`, `greenSeed`, `hard`; `defend: false` / `belts: {left: false}` keep a deleted bunker/belt deleted.
- **Yardages are computed, never quoted** (`course.holes.reduce(... cardYards)`). Pars: Pine Valley 72, Red Mesa 71, Oasis Sands (9) 34, Coral Keys (9) 35, tutorial a par 4 of 372 yd.
- **Fold-back recipe** (a session, not the tool): replace the course file, `node golf/js/test.js`, check par against `GOLF_COURSE_PAR`, bump CACHE, `node validate-sw-assets.mjs`, deploy. A new course also needs `rounds.js` `COURSES`, `course_<id>`/`blurb_<id>` strings (EN+ES), `GOLF_COURSE_PAR` rows, `GOLF_COURSES`+`GOLF_COURSE_HOLES` (`js/game-stats-ui.js`), `sw.js` `ASSETS`, `sheet-course.mjs`.

### Red Mesa's first fold-back (2026-09-16)

Editor export folded in at CACHE v852 with three validator repairs. Guards every course inherits: `dropLoops` (`holes.js`), the editor flooring waypoints at tee + 10 yd.

### The power putter, and a stated wind (2026-09-16)

`POWER_PUTTER` (`clubs.js`): 150 ft at full power, ONLY on the green (`lockedToPutter`); `autoSelectClub` hands it over past the putter's reach, `_activeClub` hands it back off the green. Price: green band `ZONE_POWER_PUTTER` 0.55, 2.5x line error, 2x pace error. `puttRangeFt(club)` is what the ladder, HUD feet and stroke all read; `isPutter(club)` is the "putter in hand" test (never `club.id === 'putter'`). A recipe may carry `wind: { speed, deg }` (0 toward the green, 90 left to right, 180 into the face).

### Red Mesa 7's playtest, and four rules it changed (2026-09-16, CACHE v856)

A blocked shot animates as the shot it was (`BLOCKED_FALL_MS`); the wood is its own map layer at `TREE_SEE_THROUGH_ALPHA` over green/fringe; **no drop prompt on the green or its collar**; the camera follows a putt longer than `PUTT_FOLLOW_FT` (40). The putt ladder does NOT read the slope.

### The Course Creator (2026-09-22)

`/hole-editor/?course=new`; Play = `golf/?editor=custom` (the course is built from the editor document and pushed onto `COURSES` for that load; nothing recorded, `__gfNoRecord`). Contract: `hole-editor/CLAUDE.md`, "The Course Creator".

## Harbor Links is gone from the product, but its keys are not

Matt: *"I do not want to see 'harbor' anywhere in the hub."* **Stored keys are NOT deleted (rule 5)**: `gf.practice.harbor` and `bestRoundByCourse.harbor` are never written nor read, stay in `ensureGf`'s shape, no cleanup hunts for them.

## Names — frozen forever (THE LAW rule 5)

Folder `golf/` · stats id `'golf'` · settings key `gamehub.golf.v1` · recorder `recordGolf(difficulty, extras)` · CSS `.gf-root`/`.gf-` · hub: in-hub `module: '../golf/js/ui.js'`, `immersive: true`. **Do not mint `gamehub.golf.save.v1`**: the mid-round save is a `save` FIELD on `gamehub.golf.v1` (one key per game).

## Stored shape

`ensureGf()` in `js/game-stats.js` owns it: `rounds, holes, strokes, points, birdies, eagles, aces, longestDriveYd, bestRoundByCourse, practice`, `bestHole`. **Additive only**; `js/players-agg.js` has the matching merges (per-key `Math.min`).

- **`bestRoundByCourse` stores STROKES** keyed `<course.id><suffix>`, `Math.min`; par is subtracted at DISPLAY time from `GOLF_COURSE_PAR`, strokes shown beside it. `points` (Stableford) keeps being written.
- **Round keys are frozen once one round is recorded and never merged or compared** (rule 4). Suffixes: holes 1-3 `3`, 4-6 `3b`, 7-9 `3c`, 10-12 `3d`, 13-15 `3e`, 16-18 `3f`; front nine `9`; back nine `9b`; all 18 `18` (Oasis/Coral Keys: `3`/`3b`/`3c`/`9`). `roundKey()` = `` `${course.id}${round.suffix}` `` so `pinevalley3` falls out with no lookup (`test.js` asserts it).
- **`gf.bestHole`** keyed `<courseId>:<holeNumber>`, `Math.min`, never by round; written as the HOLE finishes (survives an abandoned round); a practice hole sets one via the `holeOnly` path in `recordGolf`. A never-played hole is a dash, not a zero.
- **A round is recorded only when COMPLETE**, practice never touches `bestRoundByCourse`, written once and **verified by fresh re-read** (rule 6). Difficulty bucket = the COURSE ID. `recordGolf`'s win/loss from `points >= 0` is a Stableford leftover nothing displays: left alone.
- Every new round key / course id needs `GOLF_COURSES` + `GOLF_COURSE_HOLES` rows (`js/game-stats-ui.js`) the day it ships (`test.js` 15 derives both from `rounds.js`). Nine-hole scorecards need `[data-n="9"]` mark sizing.
- **Coral Cove is RETIRED**: its par rows and names stay in `leaderboard-rank.js`/`game-stats-ui.js`; the id `coralcove` is never reused. `tutorial:1` is frozen (see the ladder).

## The leaderboard number changed in Stage A

Matt, 2026-09-03: the board number is the player's **best round on a named course as a score to par, lowest wins** (the only metric where lower wins and good is <= 0: the extractor, all six sort sites and the `metric > 0` filter changed together; `js/leaderboard-rank.js`, `test-leaderboard-rank.mjs`). `GOLF_BOARD_COURSE` stays `pinevalley3`; every other round is still stored and shown. `GOLF_COURSE_PAR` there duplicates the round pars (keeps ~60 KB of polygons off the hub critical path); **`test.js` fails if it disagrees with the course data**. Golf's plays are **Rounds** (own tally), not Runs. My Stats sorts best rounds by course then 18/front/back/sets (`compareGolfRounds`; an unparseable key keeps its row at the end) and shows "avg per hole" (dash if holes weren't counted).

## Job C: the leaderboard (2026-09-09)

`golf/js/board.js` = the detailed board INSIDE golf (length chips, round chips, one ranked list; lazy). Invents no data: round keys + `golfBestAt` + `aggregatePlayers()`. `hasPar()` refuses a key with no par row (raw strokes would pass as a score). Never-played is absent, not zero; chips are `data-bmode`/`data-bround` (NOT the setup screen's names); opening it skips `_askDiscard`.

## Who can play it right now

Nobody but a dev profile (Matt: *"The default should be testing mode. So only I can see or play it."*). Courses: use **`courseTestingOverride`, NOT `isCourseTesting`** (TRUE when nothing is written; hid all courses). `COURSE_ADMIN_ONLY_BY_DEFAULT` `{coralkeys: true}` HIDES a course from all but dev (an unopened course shows locked); it sits under the config override. To release Coral Keys: delete its line there, set `coralkeys: true` in `COURSE_OPEN_BY_DEFAULT`.

## The hole-data format

All of renderer, lie lookup, collision and putting break read the same objects. Courses: `golf/courses/<id>.js`.

### Units and axes, stated once
**Everything is YARDS** (heights too). `x` across, positive RIGHT; `y` up the hole, positive AWAY from the tee (screen-up is +y; camera only pans). Positions `[x, y]`; polygons simple, winding irrelevant.

### The hole object

`n`, `par`, `cardYards`, `tee`, `pin` (inside `green.poly`), `bounds` (explicit camera limits), `base`, `surfaces`, `green {poly, slope}`, `treeTypes`, `trees`, `treeBelts`, `decor`, optional `lines`; generated: `route` (playing line, MIDPOINT of the two fairway edges; art and tests only), `pins`, `wind`, `hedges`.

### Surfaces: one ordered list, painted and tested the same way
`surfaces` = ordered `{kind, poly}`; **later entries paint over earlier ones AND win the lie lookup**. `kind` is a closed set (`SURFACE_KINDS`): tee, fairway, lightRough, heavyRough, fairwayBunker, greensideBunker, trees, green, fringe, water, swamp, tallGrass, oob; the lie table is code (`clubs.js` `LIES`). **Bunker kinds are authored, never derived from pin distance.** **Every `SURFACE_KINDS` member needs its own `LIES` row and a `lie_` label in EN and ES** (a missing row silently plays as fairway). `{ kind: 'green', poly: 'green' }` references `green.poly` by name; the tee polygon is painted LAST.

### Trees are TWO separate things, and both are needed
1. The `trees` SURFACE (85 %/80 % lie). 2. Tree OBJECTS (`trees`, `treeBelts`) that block flight. A ball can be on the surface with a clear swing, or on the fairway behind a trunk; a belt does not imply the surface.
- Object `{x, y, type[, s, h]}`; type `{name, trunk, canopy, height}`: **trunk** blocks at any height, **canopy** blocks below **height**. Optional **`s`** (multiple of trunk and canopy) and **`h`** (own height) are read by `treeHit` AND the renderer. Belts `{poly, type, spacing, seed}` expand at load with a seeded PRNG into ordinary tree objects.
- **`s` is applied in THREE places and must stay in all three**: `render.js` (shadow and crown), `treeHit` (`trunk*s`, `canopy*s`), and the `near >= 3` escape reach (paired `[KNOWN-BUG PROBE]`, sec. 10). **Heights are deliberately NOT scaled** (the fly-over gate is tuned to the bag's apexes; `treeScale` is canopy-area-neutral via `BELT_SPREAD`).

### The green's outline, fringe widths and pins (2026-09-16, from the hole editor)
Recipe: `greenOutline` (replaces the shape family; fringe = `offsetOutline`), `fringe` (number or `{front,right,back,left}`, default 6), `pins` (2+ become `hole.pins`; `ui.js` picks one per play). `validateHole` refuses a pin off the green.

### The green and its slope grid
`slope {cols, rows, cells}` over the **bounding box of `poly`**; **`cells[0]` = LOWEST x and LOWEST y (front-left, front = nearest the tee), row-major `r*cols+c`** (flipped = every break backwards but plausible). Cells `[dx, dy]` in -1..+1 pointing **DOWNHILL**. **Chevrons are GENERATED from `cells`, never hand-drawn.** 8x8 default.

### Two different yardages, on purpose
`cardYards` = scorecard length along the playing centreline (within 10 yd of `route`; tested on every hole); the HUD distance is straight-line ball to pin. They differ on doglegs. **Do not derive one from the other.** Moving a pin or tweaking a hole must leave par untouched so stored `bestHole` keys keep their meaning (rule 4).

### `decor` never affects play
Art only, consulted by nothing: `{kind:'path', poly}`, wildflowers, or sprite `{at, kind:'bench'|'sign'|'flagpole', rot}` in **world yards** (not `{yd, side, off}`). **Anything that should STOP a ball is a tree object, never a decor sprite.**

### The obstacle catalogue (2026-09-22)

`golf/js/obstacles.js` `OBSTACLE_CATALOG` (55 entries; pole 17, gorse 18, spruce 19) is a Course Creator course's `treeTypes`; shipped courses keep their own 3-entry tables. **The engine reads only `{trunk, canopy, height}`**; `shape` is the renderer's word (unknown falls back to `canopy`); `looks` is ordering only; label `t('obst_' + name)`. A rock is `canopy === trunk`, `height: 40` (solid to every club; the 8 iron's 32.3 yd is the highest apex, `test.js` 21); a log `height: 1.5`. **THE ORDER IS FROZEN: append only, never reorder or remove.** Exported courses import it, never inline it. The one allowed re-index was `migrateDocument` (`catalog: 1`); there must not be a second.

### Swamp: a hazard you play OUT of (2026-09-22)
Not water: no penalty, no drop; the ball stops dead and comes out at half power. `LIES.swamp {0.55, 0.35, roll 0}`, `PUTT_DRAG.swamp` 7.00, in `groundPoint`'s `noHop` and `NO_BELT_TREE`, never offered a putter. Recipe: a `water` entry or `cross` band with `kind: 'swamp'`.

### Power lines: a wire is a BAND of heights (2026-09-22)
`lines: [{pts, h}]` (h 4..20). `makeHole` adds a `'pole'` tree per point and `hole.lines[i] = {pts, lo: h-1.0, hi: h+0.6}`. `wireHit` (shot.js): **blocked iff `lo <= height <= hi`**; over a high shot and under a runner/chip/any putt are clear; first of `treeHit`/`wireHit` wins; no roll, **no penalty**, banner `blocked_wire`, no trees prompt. `validateHole`: `'pole'` type exists, >= 2 points, inside `bounds`, height 4..20 (`test.js` 25).

### Tall grass and the island green (2026-09-23)

`tallGrass` surface: play it where it lies, no penalty (`LIES` 0.68/0.14/0.012; `PUTT_DRAG` 6.5; no hop); recipe `kind: 'tallGrass'` on a `water`/`cross` entry. `guard: ['island']` rings the green with water (the water drop searches 14 yd, wider than the moat). Course Creator pieces only.

### Hedges and out of bounds (2026-09-24)

`oob` surface (`LIES` 0.92/0.22/0.054; `PUTT_DRAG` 3.4): a ball that comes to REST there is stroke and distance (`oob: {at}`, `penalty: 1`, `rest` = struck-from); water walk-back, drops and tree push treat it as bad ground. A `lines` entry with `kind: 'hedge'` becomes `hole.hedges = [{pts, h}]` (0.8-4): a wall that stops flight (`hedgeHit`), run-outs and putts, no penalty. Course Creator only.

### What the validator asserts
`validateHole()` (`holes.js`, run by the engine test and at load in dev): pin in `green.poly`; a `green` surface exists and holds the pin; tee in a `tee` surface; polygons >= 3 points and inside `bounds`; kinds in the closed set; `slope.cells.length === cols*rows` in -1..+1; `cardYards > 0`, par 3..5; tree/belt `type` indexes `treeTypes`; no polygon crosses itself (`polySelfIntersects`); `lines`/hedge rules. It does NOT check reachability (`test.js` 14 plays the holes). **A failing hole must fail loudly at load.**

### Worked example: Pine Valley hole 1
Annotated hole-1 literal: CLAUDE-HISTORY.md. Its two decisions: the green polygon is written once and referenced by name; the tee polygon is painted last.

## File map

`js/holes.js` geometry, lie lookup, belts, `validateHole` · `holegen.js` hole constructor · `rounds.js` courses, round shapes, keys, `maxStrokes` · `clubs.js` bag (spec §21.3), `LIES` · `swing.js` meters/mishit · `shot.js` flight, trees/wires/hedges, roll, putt · `render.js` tilemap/camera/`THEMES` · `ui.js` DOM shell (**owns no rule**; everything else is pure so `test.js` measures it headless) · `save.js` · `progress.js` · `tutorial.js` · `board.js` · `obstacles.js` · `club-art.js` · `strings.js` (EN/ES, no duplicate keys) · `courses/{pinevalley,redmesa,oasissands,coralkeys,tutorial}.js`. Tools: `sheet-course.mjs`, `measure-hole-strip.mjs`, `test-visual.mjs golf`, `check-no-scroll.mjs`.

## Tests

`node golf/js/test.js` (bag, meters, mishit, flight, roll, putting, every hole played in sec. 14, difficulty 15c); `GF_PERHOLE=1` every hole vs par and ceiling hits, `GF_TRACE=1` each shot and any blocked coordinate. Also `test-leaderboard-rank.mjs`, `test-visual.mjs`, `check-no-scroll.mjs`, `test-hole-editor*.mjs`. `[KNOWN-BUG PROBE]` pins a defect: never delete one, rewrite it to the invariant. **Test the INPUT, not just the simulation** (11b tap window and 8b orange half-window >= 3 frames); **a harness must be a person, not an oracle** (the game's own club/aim, gaussian tap timing; sec. 14 SEARCHES so cannot see softlocks); a 1 fps survey is for layout only (footage: Dropbox `/Claude Code Refs/`); some probes read `ui.js`/`render.js` as TEXT; **removing a parameter is unsafe when callers pass positionally** (`mishit`'s 5th param is the green FLOOR); never let a test pin a drifted value.

## Swing and meter: current state

- **One needle, three taps** (1 backswing; 2 plants POWER and reverses; 3 sets ACCURACY near zero). One scale `pos` in power units (`swing.js`): 0 = accuracy point, 1 = 100 %, `SWING_MAX` 1.206, `BAR_HALF` 0.137; `ARC_A0_DEG` (zero at 90 deg; any other tilts the bar, probe) and `ARC_DEG_PER_UNIT` (2.08/1 %) live in `swing.js`, not the painter. Ticks 25/50/75, the green stripe IS the 100 % line, over-swing block from 107.6 %.
- **Tempo is ONE speed for the whole bag** (`UP_MS` 1585 / `DOWN_MS` 1080). Per-club tempo and a slower putter were shipped and reverted TWICE: never again. Past the top the next tap is the ACCURACY tap; the needle running off the bar fires at worst accuracy. Pause cancels a live swing with `reset()` (not `settle()`); a ball in the air is left alone.
- **Input**: fire on `pointerdown` timed by `ev.timeStamp` (`evNow`); non-passive `touchstart` + `preventDefault()` on the swing button (the pointer handler returns on `pointerType === 'touch'`); `selectstart` block + `selectionchange` backstop (Hill Climb's four layers).
- **`Swing.tap` refuses a tap until the needle moved `MIN_TAP_POS` (0.027, its drawn width)**, returns `null`, backswing carries on. Putter only: `PUTTER_DEAD_MS` 250 holds the needle at zero. Feedback: button label `swing`/`set power`/`set aim`, `data-armed`, needle CHARGES gold (`_chargeK`), a refused tap KICKS the button. The "charge ring" is gone for good (probe).
- **Green band**: the LIE decides it (`LIES[].zone`); `swingZone` tiers `ZONE_WOODS` 0.62 / `ZONE_IRONS` 0.80 / `ZONE_WEDGES` 1.00; `GREEN_FLOOR` per tier (0.16/0.21/0.26; must be per tier). **Orange is keyed on the lie alone.** `bandsFor` and `mishit` take the floor from the SAME call site.
- **mishit**: dead centre = 0 deg, distance x1.000 at every power; **a struck ball has NO randomness** (spray/seed deleted; Matt's "20-30 yd offline" meant a BAD aim at max power); green distance loss symmetric `1 - GREEN_DIST_LOSS(0.09)*(off/green)`; bands hand off continuously (green 1.00->0.91, orange ->0.83, red ->0.60); the miss keeps the side of the stop (`puttMishit` must not re-apply the sign). `PUTT_LINE_K` 3.6, `PUTT_PACE` 0.06.
- **Over-swing**: miss multiplier ramps 1.0x at 100 % to `OVER_SWING_MAX_MUL` 2.0; the green target shrinks live (`overZone`, `OVER_ZONE_LOSS` 0.64 = Matt's, picked by swinging; `OVER_MIN` 0.10); distance diminishes from 100 % (`BLOCK_KEEPS_DIST` 0.372): 100 % drive = 232.2 total, top of arc 250.0; Matt: *"do not add this as some insane hard rule game wide"* (a multiplier, not a cap). If the driver should be more forgiving, `ZONE_WOODS` and `OVER_ZONE_LOSS` are the levers (Matt's call).
- **Aim**: `AIM_STEP_DEG` 0.35 per tap, `AIM_STEP_HOLD_DEG` 1.4 at full hold ramp; arc +/- 180. The aim ladder NEVER re-scales for the lie (Matt: *"The game can't adjust and tell someone exactly how hard to swing"*). The ladder WRAPS (`stepClub` modulo).
- **Meter drawing**: canvas at `devicePixelRatio`; never faded; hatch is a `createPattern` `strokeStyle` (never `clip()` an arc); `lastShotYd` set in `_settleShot` from `a.from`.
- **Clubs**: stock ladder driver 215 / 3 wood 195 ... lob wedge 50 (spec §21.3 APPROVED); `apexYd` is quadratic in loft; every hole is cut to the STOCK bag (the reference's longer distances are an UPGRADED bag). Club art (Matt's): five heads on ONE shared viewBox `CLUB_ART_VIEWBOX` (never per-club), ids prefixed `gf-`, `CLUB_SCALE` driver 1.06 (the largest that fits) / 3 wood 0.98 / 5 wood 0.82.

## Putting, cup and roll: current state

- **Range is a fixed 60 ft** (`puttRangeFt`); never scale it to the putt (Matt reverted that rubber band). Distance = `range * power ** PUTT_GAMMA`, `PUTT_GAMMA` 1.6. Ladder dots are evenly spaced on the ground (15/30/45/60 ft) and the arc ticks move to `f ** (1/PUTT_GAMMA)`; **the two move together**; the ladder runs PAST the cup and is never clipped (Matt reverted a clip: *"Change d. Back."*). `puttPowerFor(ft, range)` is the inverse, for tests only. **Do not touch the dial, tempo or `PUTT_GAMMA` for short-putt trouble** (two reverts); the fixes were the dead zone and the gimme.
- `PUTT_DECEL` 1.81 (derived); `PUTT_DRAG` per-surface (green 1.00, fringe 1.55, fairway/tee 1.90) normalised by `avgPuttDrag` along the aim line; `rollMs` reuses it.
- **Predicates**: `mustPutt(lie)` = green/fringe (auto-pick, zoom); `canPutt(lie)` adds fairway/tee; `_putting()` = putter in hand (feet vs yards). `lockedToPutter` is the green ALONE. Feet readout follows the CLUB, zoom the LIE.
- **Anything can be holed** (`cupCheck`/`rollWatchingCup`). `CUP_CAPTURE_YD` 0.30 (the cup is DRAWN at that radius, imported from `shot.js`). **`puttGimmeFt()` = a quarter of `puttRangeFt()` (15 ft), derived, never typed**: inside it a putt over the hole is IN (Matt's rule; measured from where the putt is STRUCK); outside it `CUP_PAST_FT` 8 and `CUP_MAX_SPEED = sqrt(2*PUTT_DECEL*CUP_PAST_FT/3)` (derived; Matt chose 8). Struck full shots keep *"you can go over it if the ball is moving too fast"*.
- **Break**: `BREAK_K` 0.90 (the bend must beat the 10.8 in capture radius, probe 15c). PV 6 is the one deliberately FLAT green. **`LIES.green.roll` 0.090, fringe 0.075** (ordering green > fringe > rough pinned by test 19). Slope also bends/lengthens any run-out (stepped by distance carrying v^2; test on a SYNTHETIC green).
- **Wind**: `windFor(hole)` deterministic per hole (a hole's own `wind` wins; 0.0-2.0; 8 bearings; ~1 in 6 calm), folded in BEFORE the tree test. **Putts: no wind** and no wind panel (the panel reads `wind`, an arrow, a number; never the word "calm"). Coral Keys states `wind` per hole.
- **Flight**: lateral term on `p*p` (the ball CURVES toward its miss; `_fire` passes `mishitDeg: m.deg`); `rollWatchingCup` gets the TRUE heading.
- **Roll**: approved *fairway ~8 % of carry*: `tee`/`fairway` roll 0.0645 (x driver loft term 1.24 = 0.080); `rollFactor = surface * (1.6 - 1.2*loft)`; `landedOn` kills hops on sand/heavy rough; hops (`HOP_TIME` 0.28, `HOP_SHARE`/`HOP_DECAY` 0.62, height `apex*0.22+1.2` capped `rollYd*0.45`, no floor) then a smooth decel (`ROLL_DECEL` 4.3). The run-out STOPS at a trunk and at water. A skip in flight LANDS the ball.

## The penalty drop, and the ball in the trees

`resolveShot` returns `penalty: 1` and drops the ball where it last crossed dry ground on its flight line, never behind the shot's origin; `dropNear(hole, from, isBad)` is the ONE rule (rings from `MIN_DROP_YD`, 16 directions, on-map, off barred surfaces, preferring not nearer the pin). The caller (`_settleShot`) adds the stroke, keeping `resolveShot` pure (sec. 14 depends on it).

## The ball goes in the water, and the player picks the drop (2026-09-12)

`resolveShot` adds `water: { splash, before, beforeOn, prev, prevOn }` (additive; `rest` unchanged). `before` (default) is re-read from the FINAL `rest`; `prev` is `from` itself (stroke and distance); the off-map clamp populates `water` too. `ui.js` `waterBeat.phase` (`splash`->`ask`->`move`->`reveal`) is driven by `_frame`, not timers. HUD not repainted at the splash; the prompt (`.gf-drop`) auto-answers after `WATER_ASK_MS` 8 s with "before the water" (never the risky default); **nothing is saved while the beat runs**; `longestDriveYd` skips water.

## "In the water" / "In the trees": the player is told, and asked (2026-09-07)

Water = `.gf-banner` ("In the water" / "One penalty stroke", 2.5 s). Trees = `.gf-drop` modal (**Take a drop** / **Play from lie**, cost stated), never on the green or collar; `amongTrees` fires it for ANY tree. Strings EN+ES (`test.js` 15a).

## Sand runs a ball now (2026-09-12)

Two numbers, no new machinery: `fairwayBunker.roll` 0.030, `greensideBunker.roll` 0.018 (`rollFactor` already carries arrival steepness). Sand still does not hop. Pinned from BOTH ends: a lob wedge into sand runs under a yard, a driver over six, split >= 8x, greenside < fairway sand, both far below a fairway.

## Softlock guards in `shot.js` (all pinned by tests; never loosen)

A tree within `trunk + 1.2` is ignored leaving it; a canopy the ball is under blocks only with its trunk; `SKIRT_YD` 3; `ESCAPE_YD` 11 (inside a stand, canopies within it don't stop the shot; "in a wood" = 3+ canopies in reach, NOT the lie); a blocked ball finishes at least `MIN_BLOCKED_YD` from where it was struck, kicked perpendicular, never inside the trunk it hit; a ball off the map is pulled back inside (no stakes drawn); no ball rests inside a trunk (defers to `MIN_DROP_YD`).

## The back nine, as a SET - and the softlock the set test found (2026-09-06)

**Variety is a property of the SET**: render all nine/eighteen at one scale and tabulate `greenShape/slope/guard` before calling a set done. Every `cross` hazard is placed where the shot with a decision lands (all six were 222); `frontTrees` = two stands with a lane at `edge + 30`, never a wall; a ball at the DRIPLINE must be able to play out. Use `GF_PERHOLE`/`GF_TRACE` (block averages hid an unfinishable hole).

## The front nine, and the two things that only show up in a set (2026-09-06)

("Holes 1-3 NOT re-cut" is superseded.) Two greens on a course must not be the same idea at the same size; cross-hazard faces are waves, not slabs; length, not green-side sand, makes a par 5 hard: all four PV par 5s are unreachable in two (a real loss of variety).

## Course generation: rules from experience (`holegen.js`, `holes.js`)

- Holes are DESIGNED: a spec (centreline, width profile, hazards "at 0.55 of the way, 18 yd left") expands via `makeHole()` into the documented object and nothing else. Catmull-Rom spline; offset corridors **with a backward-point guard (load-bearing: bow-ties break the ray-cast lie)**; `cardYards` = measured centreline; `bounds` measured then padded **`BEHIND_TEE_YD` 60** (test 16b pins it against `VIEW_W_YDS`; hand-written bounds carry it too); min hole width 104; collar 6 yd on BOTH axes.
- **Fairways are not rectangles**: `EDGE_WOBBLE`, `CURVE_ASYM`, `PINCH` at the landing zones, `fwL`/`fwR`; a wood's inner edge **stays outside the rough**; `defend` adds a fairway bunker on the OUTSIDE of the bend where none is within `DEFEND_NEAR` 38 yd (`defend: false` opts out).
- **Greens**: `GREEN_SHAPES` `round long kidney peanut teardrop clover` (r(a) cannot express an L); fringe = same function plus a CONSTANT; **a green and its fringe share one seed**; guards use `gEdge(bearing, pad)`, never a fixed radius. Guard tokens: `front/left/right/back` + `Sand`/`Water`/`Trees`, `frontJaws`, `ringSand`, `island`. `SLOPE_PRESETS`: `flat gentle spine steep saddle crown bowl tier leftShed rightShed quarters runsAway runsAwaySteep`.
- **`cross` hazards are placed in YARDS FROM THE TEE, never a fraction**, where the shot with a decision lands (a band a driver can CARRY is not a lay-up); faces are low-frequency waves; `over` is authorable. `blob()` = first FOUR harmonics only (smooth by construction); `tiltedBlob()` for diagonal lakes. `sentinels` = trees too tall to fly (canopy over ~34 yd), corners only.
- **`hardnessOf(n)`** ramps 0 -> 1 over a round; par 5 and par 3 get relief. **What costs strokes in this engine is DRIVING difficulty and LENGTH, not green-side decoration or tree density.**
- **Woods (`expandBelt`)**: authored `spacing` drives the step (`spacing * 0.72`) above a floor `canopy * BELT_PITCH` (never closed past 55 % of authored spacing); feathered edges (`EDGE_KEEP`, `BELT_BLEED_YD`; `holegen` passes `depth` and `inner`); **`NO_BELT_TREE` applies to EVERY belt tree, hand-placed `trees` are never filtered**; the `trees` lie surface is INSET from generated belt polygons (`inner` = "generated"); hand-authored belts (PV 1, 3) get no feather/bleed.
- **Themes are PALETTE OVERLAYS only** (`THEMES`); both themes must define every key; tree art is keyed by the type NAME. **A new palette is not a new course** (*"it looks identical to Pine Valley"*): the GROUND and the SHAPE of a hole make it new.
- Every pin must be >= 3.0 yd inside its green edge (a cup got painted over by the edge stroke); when code looks right and the picture doesn't, sample the DEPLOYED raster.

## Rendering rules (game)
Pinned by `test.js` 12e: seam stroked OUTSIDE the clip (`SEAM_ALPHA`); tree shadows offset by the tree's own `height`, composited in ONE pass; **the wood is drawn in three passes** (keys, canopies, clumps); **the key line is FILLED under the canopy at a larger radius, never stroked over it**; silhouettes are a union of circles inside `type.canopy` (`treeShapes`). Slope chevrons: fixed-size screen-space overlay (`drawSlope`, skipped < 3.5 px; `slopeChevronGrid(mag)`); `slopeGlyphAngle` is a named pure function (screen y is flipped, probe). The lie readout is a PICTURE from `fillsFor` (name on `aria-label`; the lie NAME prints on its own line above the power cap). HUD panels share `--gf-hatch`.

## Camera, view and HUD fit
- `VIEW_W_YDS` 95 (ceiling `MAP_PPY` 2.4 px/yd), `VIEW_W_GREEN_YDS` 34 eased in as the ball settles. `makeCamera.clamp` must read `this.` scale. `_keepCupClear(wantY)` MEASURES the four HUD clusters and keeps the cup between them (ball wins if both can't fit).
- **Opening flyover**: pin `INTRO_HOLD_MS` 1.0 s, then ease in AND out over `INTRO_MOVE_MS` 2.6 s; any tap skips. **Free look** is two-axis, clamped, HOLDS where left, returns on a tap or when a swing begins (SNAPS home). **A touch during a shot PANS; the skip fires on release of a press that never moved.** The golfer is drawn at `golferAt`, stays after impact, never animates during the meter (`POSE_*_MS` pinned by 12c), hidden while lining a putt.
- **`_fit()`** takes the LARGER of `innerHeight` and `documentElement.clientHeight`; re-fits on `visibilitychange`, an underfill backstop, a ResizeObserver, and when `golf.css` loads (`ensureCSS()` callback); `js/hub.js launch()` unhides `.hub-game` BEFORE `init()`. `_fitInsets()` MEASURES `--gf-top-pad`/`--gf-gap-b` (so `env(safe-area-inset-bottom)` isn't charged twice in the hub), BEFORE `_fit`'s early return. If a "half-height strip" is reported again: ask which screen and whether reopening from the hub clears it.
- **No scroll, ever** (Matt: *"Everything MUST fit on a single screen. Always."*): `overflow: hidden` on setup; the safety net is the TEST (`check-no-scroll.mjs`, `test-visual.mjs` `fit` also walks inner scrollers).

## Setup screen rules

- ONE screen: length chips (3/9/18), course chips, round tiles. Tile label is the RANGE ALONE (`10-12`; full phrase on `aria-label`), `nowrap`, one height at 393/360/320. Blurbs are ONE line: 284 px budget (320 px viewport), written above `blurb_pinevalley` in `strings.js`. The GROUND colour comes inline from `THEMES[...].setupA/setupB` (a `golf.css` rule is silently overridden). Selected = `#ffce3a` plus border and weight. No `<h1>`, no "Which holes?".
- **Hole strip**: every hole, no text, no black, no scrolling; each canvas is the hole's SHAPE (`holeAspect`), rows are NINES (`holeRows`); `_sizeStripRows()` takes only what is LEFT after SUMMING siblings (never a collapsed `scrollHeight`) and re-runs from `_fit()`; `box-sizing: border-box` on the tile is load-bearing. Lazy thumbnails (`IntersectionObserver`; no IO -> paint all; never an empty box); `_dropStripObs()` on every exit. The 60 yd behind the tee stays in the picture.
- **Pause menu** (resume / report a bug / quit) REPLACED the top-left quit button; `_quit()` still asks and `test.js` 16a pins BOTH hops. Report form is a LAZY import (`openBugReport({ gameId: 'golf' })`): the repo's one deliberate in-game entry to Report a bug. `strings.js` key is `pause_resume` (a duplicate key silently wins).

## Rounds, scoring, save, progress

(Job B, Job A, the ladder and the tutorial follow; the leaderboard is Job C above.)

## Job B: a hole's maximum score is double par plus one (2026-09-09)

`maxStrokes(par)` in `rounds.js` (7/9/11; Matt: *"Double Par plus 1 should be each hole's max."*). **The hole ENDS at the cap** (`_capReached()`: `shotN - 1 >= maxStrokes(par)`). The score is the ALLOWANCE, not the counter (a water penalty adds two at once). `pickedUp` is a FLAG (card says "Picked up at 9"). `_pickUp` fires `_coach('holed')` and SAVES first. Existing records are never rewritten. `_showHoleResult` callers must be the holed or cap path (12b); never subtract one from `shotN`.

## Job A: a round survives leaving the app (2026-09-09)

`golf/js/save.js` (`validateSave`, `resumePos`, `isComplete`); `ui.js` reads/writes the `save` field. `recorded`/`newBest` are NOT stored; tutorial and practice holes are not saved. Saved on: entering a hole, the ball at REST (never mid-flight), a hole being scored (before the result card), a penalty drop. **The clear is on the WRITE**: `_recordRound` clears after the best landed by fresh re-read. `_resumeSaved()` branches on `scores[pos]` and **re-saves at the end** (probe, sec. 22). Resume names the hole it will ACTUALLY land on; starting a round/practice/tutorial goes through `_askDiscard`. **`isInProgress()` is `false`**; `_roundAtStake()` (the quit prompt) checks `saveOk` (the VERIFIED write).

## The unlock ladder, and the tutorial hole (2026-09-08)
- **Derived, nothing new stored** (`progress.js`): tutorial -> holes 1-3; par or better on each set unlocks the next; all six sets UNLOCKED (not beaten) -> front nine; par on front -> back; par on back -> 18. Read from `gf.bestRoundByCourse` and `gf.bestHole['tutorial:1']` (both `Math.min`), so **no gate can close once open**. `roundState`'s `mode === 9` branch is the line to change if "unlocked" should mean "beaten". **`tutorial:1` is FROZEN once anyone finishes the lesson.** `test-visual.mjs`'s PLAY probe SEEDS it.
- **Tutorial hole** (`courses/tutorial.js`): an ORDINARY validated hole, NOT in `COURSES`: par 4, 372 yd, straight, no hazards, calm. Changed from par 3 on 2026-09-09 after checking no `tutorial:*` record existed - **re-run that RTDB check before touching its par again** (rule 4).
- **The lesson** (`tutorial.js`; `Coach` WATCHES, never drives): 10 cards, <= 10 words per rail card and 16 per popup (build fails past it, EN+ES); **no skip button** (probe; only holing out writes the unlock); **NO CARD IS ON SCREEN WHILE THE NEEDLE MOVES** (a `key: null` step is silent; probe: no card waits on `tap-power`/`fire`); `SKIPPABLE` = `fire settled on-green holed`; `on-green` = `mustPutt(this._lie())`; `Coach.blocksSwing()` holds the swing until the gated aim/club control is used (`nudge()`); club lesson on the SECOND shot after a silent `after-drive` step (order pinned); `SETTLE_CARD_MS` 700; the rail is CSS-welded (`.gf-tut__rail` `bottom: 0`; the bottom clusters ride 30 px up under `[data-tut="1"]`); popups paint the REAL meter (`_drawMeter({ still: true, marks })`). The bad-swing card's 25/45 yd are **Matt's and illustrative - do not re-derive**. It teaches aim + club by USING them, that the red dots ARE the meter's 25/50/75/100, and that greens are sloped.

## Coral Keys: the fourth course, nine holes of ISLAND HOPPING, ADMIN ONLY (2026-09-29)

Matt: *"a fun new golf course... 9 holes and admin only to start."* `courses/coralkeys.js`, Tropical, par 35. The ocean is the ground (`base: 'water'`); `beach` rings land in sand playing as a fairway bunker and each WATER `cross` band becomes a GAP (`spans`/`capped`); `islands` for shortcuts; a stated sea breeze on every hole (1.2-2.0, never calm). No other course's holes changed (hashed). `test.js` 26. Release: "Who can play it right now".

## Repo rules that bite in this game specifically

Read `docs/BUILDING-A-GAME.md` Part 0 before touching UI. **`onViewportResize(cb)`** (`js/viewport.js`), never a raw resize/orientation/visualViewport listener. **`touchmove` binds to `.gf-root`**, never `document`/`window`; swipe `touch-action: none`; tappables `manipulation`; `overscroll-behavior: contain` on any fixed scrolling overlay. **Immersive fit** at a tall AND a short phone height, standalone AND in the hub. Reduced motion thins garnish, never freezes gameplay. No em dashes in user-facing copy; any result popup gets a close (X). Name from `loadProfile()`, defaults-only. **Every visible string via `t()` at RENDER time**, EN+ES. **No sound.** Colorblind-safe: never hue alone.

## Superseded (only in CLAUDE-HISTORY.md)
Oasis Sands "NOT built" (it is built); "Holes 1-3 NOT re-cut"; the hole-3 swap block (Matt declared that record disposable 2026-09-16); the 221-degree arc; per-club tempo; signed distance loss and `blockSpray`; the 18 % roll; the scaled putt range; old `BREAK_K`/`PUTT_GAMMA` 2.0/`LIES.green.roll` 0.036; the putt-ladder clip; the charge ring; the skip button; `wedge`/`boomerang`; `frontTrees` as a wall; pre-2026-09-10 distances measured against the reference.

