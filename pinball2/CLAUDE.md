# Pinball 2 — engine and editor

THE LAW lives in the root `CLAUDE.md` and applies here. Nothing in this folder reads or writes any
player's stats yet: there is no hub `GAMES` entry, no stats id, and no recorder. When one is added
it must be a NEW id (`pinball2`), never the existing `pinball` id, whose records belong to the four
old machines and stay exactly where they are (rule 5).

**This is a rebuild, alongside `pinball/`, not a replacement for it.** Matt, 2026-09-10, on the four
existing machines: *"none of them are even remotely playable... maybe it's better if we just start
from scratch."* `pinball/` is untouched by anything in here. Whether it is ever replaced is a
decision for after this one is judged.

**`pinball2/HANDOFF.md` is the complete reference** - every file, every field of the data model,
every constant, every editor control, every check, and the landmines in one list. Read it before
changing anything here. THIS file is the incident log beside it: what went wrong, and why each fix
is shaped the way it is.

The plan this is built against, including the interview it came from and the acceptance numbers, is
`docs/PINBALL2-PLAN.md`.

## Where it is

Open `/pinball2/editor/` on a phone or a desktop. There is nothing else to run: the editor loads the
machine's own engine, so Play in the editor IS the game.

## The one idea

**The ball is never inside anything, so nothing ever has to push it out.**

Every collider here is a circle, a segment or a circular arc, and each has a closed-form time of
first impact against a moving point. A tick advances the ball to the exact instant it touches
something, resolves it, and carries on with the time that is left. It is not a small step and a
hope, which is what every symptom in Matt's list came from:

| His words | What it was | Why it cannot happen here |
|---|---|---|
| "falling on a vertical wall not a slanted one" | gravity tuned by feel | `g sin(6.5 deg)` = 1.111 m/s2, in real metres |
| "it goes through objects" | fixed step, then push out | impact is a ROOT, not a sample. Measured: 883 shots at 8 m/s, 0 through |
| "it teleports" / "it vanishes" | level transitions that deleted and re-made the ball | there is no code that assigns a ball a position. The only write is `p += v*t` |
| "gets stuck everywhere" | each contact resolved alone, so two surfaces formed a parking space | a contact under `REST_SPEED` slides instead of bouncing. Measured: 2913 drops, 0 stuck |
| "objects overlap" | nothing checked | the gap rule runs in the editor and in `probes/run.mjs` |
| "rails not smooth", "curves look mouse drawn" | curves were chains of short straights | an arc is a first-class collider AND an SVG-style arc in the renderer, from one shape list |

**There was one case the invariant did not cover, and Matt found it in about a minute.** A ball
already INSIDE a collider is invisible to both impact tests: one returns null because the ball is
inside the outer surface, the other because it is outside the inner surface. So the collider is not
there and the ball sails through. It happens where two rails meet FLUSH, which is everywhere you
want them to: a ball riding up the left rail arrives exactly tangent to the corner arc, and a
fraction of a millimetre either way puts its centre inside the arc's band. Traced: `nearest a4 at
13.3mm (ball r 13.5)` on one tick, `-4.7mm` three ticks later. `staticPenetration()` is the net,
and `World.rescues` counts every time it fires, because it firing at all means some junction has a
graze worth looking at.

The single exception, and it is deliberate: **a flipper swinging into a ball does move it.** A driven
paddle has to. Its micro step is bounded so the overlap is at most a quarter of a ball radius, and
the ball takes the PADDLE SURFACE velocity, never a velocity derived from the correction distance
over dt. That derived velocity is exactly what threw a ball from 0.397 to 10.807 m/s in one step on
the old engine (`pinball/CLAUDE.md`, "The ramps were unreachable").

## PIER NINE, built (2026-09-13)

Matt: *"build it for testing."* `docs/PINBALL2-PIER-NINE.md` (rev C) is now a table you can play at
**`/pinball2/piernine/`**, not a plan. It is the first thing in this folder that is a GAME rather
than a physics test bed, and it is still not a hub entry and still has no stats id.

### It is a new TABLE, not a new machine, and that was a call

The folder rule is one engine per machine, forked. PIER NINE did not get one. Everything it needed
from the engine turned out to be **purely additive and inert for the tables that already exist** -
a `sensor` kind that no other table has a single instance of, a `role: 'gate'` seg, a `down` flag on
a seg, and a `score` field nothing else sets - so a fork would have been 1,300 lines copied to add
sixty, and the next engine fix would have had to be made twice. **The rule's intent is that a shared
change must not silently break a machine nobody is working on, and that is discharged by proof, not
by a copy:** every probe is run against all three tables, and TEST BOX and BOARDWALK are unchanged
in every one of them. If a future table needs a change that is NOT inert, fork then.

### What the engine gained

| Added | Where | Note |
|---|---|---|
| `kind: 'sensor'` | `physics.js` `checkSensors` | rollover, spinner, bullseye, saucer, kicker - all the same object: a region the ball's CENTRE crosses. **Not colliders**, so `distToShape`, `checkGaps` and every probe are untouched by them |
| the one-way gate | `firstImpact` | the only genuinely new collision behaviour, and it is two lines |
| `setDown` / `rebuild` | `World` | a drop target that is down is not a collider. Raising one is REFUSED while a ball stands where it would reappear - materialising geometry under a ball is the position write this engine does not do |
| `score` on any shape | data only | the `hit` event already carries the id, so a standup is a `seg` with a number on it and needs no collision code at all |
| `parks` on a table | `checks.js` | a place a ball is SUPPOSED to sit. Every machine with a shooter lane has one, and without it the rest sweep calls the plunger a trap |

### The scoop holds the ball where it stopped

A saucer captures by setting the velocity to zero and holding, and ejects by setting a velocity. **It
never centres the ball in the hole**, because that settle is the one thing here that would be a
position write. A real cup would funnel it; this one does not, and the ball leaves from exactly where
it rolled in. Named rather than quietly added.

### Six probes green, one red, and the red one is honest

Run: `node pinball2/probes/run.mjs all --table piernine` (about five minutes) and
`node pinball2/probes/test-multiball.mjs 40 25` (about four).

| Probe | Result |
|---|---|
| gap rule | **0 ambiguous gaps**, 18 deliberate overlaps |
| rest sweep | **0 dead stops in 1,767 drops** |
| escape probe | **0 escapes from 42,984 balls** fired hard from everywhere |
| tunnel probe | **0 through in 2,832 shots** at the speed cap |
| ramps | **0 problems**, both ramps, 24 entry speeds |
| flipper push | 0 of 22,676 left the machine |
| **flipper power** | **3 of 8 spots move the ball less than 300 mm. FAIL, and it stays red.** |
| multiball soak | 40 x 25 s of three-ball play: 0 escapes, 0 jams, 0 NaN, 0 balls added inside a collider |

**Why flipper power stays red.** The bar was calibrated on TEST BOX, which is an empty box: a ball
flipped there reaches 920 mm because there is nothing between the bat and the top rail. PIER NINE
has 67 parts. Measured, every one of the three short shots is stopped by a NAMED part doing its job:
u=0.3 (176 mm) clips its own slingshot's lower tip, which is what happens on a real machine and is
why nobody shoots from the base of the bat; u=0.5 (295 mm) and u=0.7 (206 mm) are stopped by the
posts flanking the Pier's mouth, which is a MISS on that ramp and exactly the "a near-miss kicks
live instead of rolling home" the rev C directive asked for. **Do not fix this by deleting the
posts.** It was tried: moving the ramp-mouth posts to open the shot broke the gap rule and the ramp
probe in the same edit, and the honest reading is that the 300 mm bar does not transfer from an
empty box to a dense table. A robot player (phase 8) measures make rates, and that is the number
that decides whether these shots are actually reachable.

### What the build found that the drawing did not

Six defects, and the shape of each is worth more than the fix:

1. **228 of 1,768 drops parked in ONE corner** - the Fishing Dock's low end against the left orbit's
   inner guide. The bank slopes up to the right, so a ball landing on it rolls down-left into that
   V. Moved 20 mm right. **A target bank is a ramp for anything that lands on it, and its low end
   needs somewhere to go.**
2. **A gate is a shelf.** Both one-way gates were first laid straight across their lane, and gravity
   on this table points down-table: 50 balls sat on the shooter gate and 34 on the orbit gate. A
   gate has to be angled so a resting ball slides off it into open space, or placed where the lane
   is HORIZONTAL. The orbit gate ended up at the top run for exactly that reason.
3. **The inlane must deliver onto the BAT.** Running each divider down to its flipper's pivot and
   welding it there is tidy and put 143 drops in the notch between the two - the ball reaches the
   pivot from the left and the base circle is then between it and the bat.
4. **A post is welded or it is a ball clear. There is no third option.** Posts sitting 12 mm off a
   sling's end made two upward-facing Vs and caught 19 balls.
5. **A gate's pass test flips at the FAR FACE, not at the centreline.** Written as "behind the line"
   it re-solidified under a ball whose centre was past it but whose body was still in the band, and
   it stopped the plunge dead - the first ball of the first real game was hit by the shooter gate at
   3.24 m/s and never reached the playfield.
6. **A ramp's EXIT needs clear air as much as its mouth.** The Coaster first dropped its ball 2 mm
   off the left divider's centreline; the ball left the lane, penetrated a wall, was rescued by the
   static net, and `rampProbe` measured the rescue as a 13.5 mm jump.

Two of these (2 and 5) were invisible to every probe in the folder and were found by **playing it**
- a ball ARRIVING somewhere slowly is a state the rest sweep cannot reach, because it drops balls at
rest and a ball dropped at the top of the shooter lane just rolls back down.

### The diverter, and a lie that got as far as `main`

The first build of PIER NINE shipped without the Coaster's diverter, and this file said:

> *`enterRibbon` now skips a ribbon whose `armed` is false, so a second Coaster path is a DATA
> change when it is wanted.*

**That was not true when it was written.** `armed: true` was set on the ramp shape and the check in
`enterRibbon` was never written - the only `armed` in the engine was the kickback's. The sentence
went into a commit message, a PR body and this file, and it was doing work: it made an unbuilt
mechanism read as a deliberate, cheap deferral. Matt asked what "not built" meant and the answer was
that a hook had been documented instead of written.

It is built now, and the shape of it is worth keeping:

- **A diverter here is TWO RIBBONS SHARING A MOUTH, exactly one armed.** `enterRibbon` skips a
  ribbon whose `armed === false` (undefined means armed, so TEST BOX and BOARDWALK are untouched).
  A ball cannot be handed from one lane to another part-way along without teleporting it, so the
  choice is made where a real flap makes it - at entry.
- **The flap at the crest is DECOR and swings between the two positions.** What that costs, stated
  plainly: the ball does not bounce off the flap. Where it ENDS UP is the real thing, and that is
  genuinely different - measured, the same shot at the same mouth at the same speed either returns
  to the left inlane or is captured by the Ferris Wheel.
- **Two physical routes, not rev B's three.** Rev C moved mode-start to the Fortune Teller ("locks
  live at the wheel, modes start at the scoop"), so two of the three collapsed into one. That is
  the rev C rule working, not a third route left out.
- `rampProbe` **arms one ribbon at a time**, or it fires at a shared mouth and measures whichever
  ribbon comes first in the shape list - testing one ramp twice and reporting the other as "too slow
  to get on".

### The multiball soak, run

`node pinball2/probes/test-multiball.mjs [runs] [seconds]`. Multiball is the only state where three
balls are in the same solver, two of them ADDED mid-game rather than served, and no other probe ever
puts a second ball on the table. It asserts no escape, no jam, no NaN, three balls really in play,
the game's own ball count never disagreeing with how many are alive, and nothing sitting still at
the end of a run.

It found two things on its first run, both in code that had already shipped:

1. **`rescues 16` - the two extra balls were being ADDED INSIDE the posts that gate the wheel.**
   Adding a ball is the one position write this engine makes on purpose, and it was landing in a
   collider, so the solver's rescue net pushed it out on its first tick. `startMultiball` now ASKS
   `world.isFree` for a spot from a list of candidates. A number that is not zero in this engine is
   a bug even when nothing visible goes wrong.
2. **All eight runs scored exactly 313,760.** This engine is deterministic - there is no randomness
   anywhere in it - so eight identical set-ups are ONE trajectory sampled eight times, which is a
   unit test wearing a soak's clothes. Each run now varies the plunge and the robot's phase.

**A soak is a sample and that is written into the file's own output.** `restSweep` and `escapeProbe`
are the ones that do not sample; this proves these runs were clean, not that multiball is.

### Still not built, and named rather than skipped

- **A gate is not tunnel-checked.** "The ball is inside it" is what a one-way gate WORKING looks like
  and the tunnel probe cannot tell that from a tunnel, so gates are excluded from that one test.
- **No stats, no hub entry, no leaderboard.** After Matt has judged it, and it must be a NEW stats id.
- **No robot player, so no make rates and no score spread** - build phase 8, and the reason the
  acceptance table in the blueprint is still targets rather than claims.

## Files

| File | Role |
|---|---|
| `machines/testbox/config.js` | every tunable number, plus `TUNABLES`, which is what the editor's Tune panel is generated from. A constant with no row is not tunable by hand |
| `machines/testbox/physics.js` | the swept solver. Pure, no DOM, no timers |
| `machines/testbox/table.js` | the bare box: rails, two flippers, a drain. Plus `toJSON`/`fromJSON` and `buildRamp` |
| `machines/testbox/tables/boardwalk.js` | the physics test bed. Three red probes, on purpose |
| `machines/testbox/tables/piernine.js` | **PIER NINE's geometry**, in millimetres, with every deviation from the blueprint named in the file |
| `piernine/index.html`, `game.js`, `rules.js`, `style.css` | **the playable machine.** `rules.js` is the scoring spine the engine does not have |
| `probes/test-multiball.mjs` | the 3-ball soak. The only probe that puts more than one ball on the table |
| `machines/testbox/render.js` | canvas 2D. Calls the solver's own flipper decomposition, so what is drawn and what is hit cannot drift |
| `editor/index.html`, `editor/editor.js` | the tool: Play, Edit, Tune, Check |
| `probes/checks.js` | the three checks, written ONCE and run from both the editor and node |
| `probes/run.mjs` | `node pinball2/probes/run.mjs [drain\|tunnel\|flip\|power\|escape\|gaps\|rests\|all]`, about 2 min for all |
| `HANDOFF.md` | the complete reference for a session that has never seen this tool |
| `probes/test-editor.mjs` | does the TOOL work. Touch accuracy after a tab switch, and the NaN freeze. Needs `node server.mjs`; SKIPs without Chromium |

**One engine file per machine, forked, never shared.** A second machine copies
`machines/testbox/` and edits its copy. That is the repo rule and it is why a shared fix cannot
silently change a machine nobody was working on.

## The checks, and why they report places

`probes/checks.js` reports COORDINATES, never a percentage. A soak samples where it happens to go;
`pinball/CLAUDE.md` records four soaks passing a table that was unplayable in thirty seconds. These
do not sample:

- **`restSweep`** drops a ball at rest on every point of a grid over the playfield and asks one
  question: did it reach the drain? Everything else is a trap, listed by coordinate.
- **`tunnelProbe`** fires a ball at every collider from 24 angles at the speed cap and fails if any
  ends up somewhere it could not have travelled to.
- **`escapeProbe`** fires a ball hard from every reachable point at every angle, with the flippers
  working, and asks whether it is still in the machine two seconds later. **This is the one that
  matters most**, because it is the one that catches a ball leaving the table, and the three checks
  that shipped before it all missed exactly that: the tunnel probe watched a quarter of a second
  and the ball took two, the rest sweep starts every ball at rest and this needs speed, and a
  static "is the cabinet closed" test passed the broken table outright. That third one was written,
  measured against the real defect, found to give a false OK, and DELETED rather than shipped. A
  check that says OK about a table a ball can leave is worse than no check.
- **`flipProbe`** holds a flipper up with a ball already against the bat, over a grid of positions.
  The bat is the only driven part, so it is the only thing that can move a ball the ball did not
  move itself, and every other probe starts with the flippers at rest.
- **`checkGaps`** flags any space between two parts that is near ONE BALL wide, which is where a
  ball wedges. A gap must be clearly shut or clearly open. Overlaps are a note, not a failure: an
  overlap is how you SHUT a gap.

**`playable()` underpins both sweeps and is the thing three drafts got wrong.** It is a flood fill
from the launch point over every legal ball position, and it is what tells the playfield apart from
the dead pocket behind a rail. Without it the tunnel probe reported 64 balls flying off the table,
every one fired from behind an outer rail. Three separate corrections are recorded in that
function's comments and each is a shape of mistake worth knowing:

1. the fill ran THROUGH the drain and back up behind the rails, because a drain is a sensor and not
   a wall. It absorbs now.
2. a 3 mm cell rounds a legal ball position to "off table", so the escape test allows for the
   rounding and the launch test does not.
3. a cell centre can be free while the exact point is a millimetre inside a rail, so a probe tests
   BOTH reachability (the mask) and legality (the exact distance). Four shots launched from inside
   a rail were reported as tunnelling through it.

**Every probe added since has had to relearn point 3.** The escape probe's first run reported 532
escapes and all 532 started at (14, 14) mm, the dead corner behind the corner rail. If you add a
probe to this file, filter its start positions through `playable()` before you believe a word of
its output.

## Numbers as at 2026-09-10, on the bare box

```
gravity        1.111 m/s2 = g sin(6.5 deg)
free fall      1.312 s against 1.311 s analytic, 0.1% off
tunnel         883 shots at 8 m/s from 24 angles, 0 got through
flipper push   22220 balls flipped from rest against the bat, 0 left the machine
escape probe   76392 balls fired hard from everywhere reachable, 0 left the machine
gap rule       0 ambiguous gaps, 6 deliberate overlaps
rest sweep     2913 drops, 0 never reached the drain
```

`node pinball2/probes/run.mjs` runs all of them in about two and a half minutes. The escape probe is
most of that, and it is worth every second of it.

**"About three seconds to drain" is not the gravity test, and the first draft of the probe used it
as one.** Three seconds is how long a ball LIVES on a real machine, and it lives that long because
it keeps hitting things. A ball with nothing in its way over this playfield takes 1.31 s, which is
`sqrt(2h/g sin tilt)` and nothing else. The honest assertion is against that analytic number.

## The app froze, and it looked exactly like a physics bug

Matt filmed it: a ball resting in mid air at 0.00 m/s, touching nothing, for the last four seconds
of the recording. *"You are really not giving me much confidence."*

It was not physics. Measured from the recording, the ball's rest position is 43 mm from the feed
rail's end cap and 27 mm from the flipper's pivot, and a ball is 27 mm across, so it could not have
been touching both: **a ball resting on nothing is not a rest, it is a frozen frame.**

The chain, reproduced in a browser in one run:

1. a number field in the property panel is empty for one keystroke
2. `parseFloat('')` is `NaN`, and the handler put it straight into the geometry
3. the ball's position goes non-finite
4. `createRadialGradient` **throws** on a non-finite argument rather than drawing nothing
5. the exception comes out of the `requestAnimationFrame` callback, so **rAF is never called
   again** and the page sits on its last painted frame for ever
6. the autosave had already written it, so a reload and a force quit did not help either

Four fixes, because any one alone leaves the hole open:

- **The loop is scheduled in a `finally`.** Nothing inside a frame can stop the app, and the error
  is printed in the corner instead of the app going quietly still. This is the one that matters:
  whatever else breaks, the app must keep running and say what happened.
- **A field cannot inject a non-number.** An empty or non-numeric box restores the previous value.
- **The autosave is never written when the table has a bad number, and a stored table is repaired
  on load.** A phone that already stored one heals on the next visit rather than needing its site
  data cleared. **`null` is rejected as hard as `NaN`**: JSON has no NaN, so a stored NaN comes back
  as null, and null in arithmetic is 0, which silently teleports a rail to the edge of the table.
- **The solver kills a ball whose numbers stop being numbers** (`World.broken`) and the renderer
  skips it, so one bad ball cannot spread NaN through every contact it touches.

`probes/test-editor.mjs` is the regression net, and every case in it is something Matt hit by using
the tool. It needs `node server.mjs` running and SKIPs without Chromium.

**The lesson worth keeping: a frozen frame and a stuck ball look identical, and the tell is the
geometry.** If a ball is at rest touching nothing, stop looking at the physics.

## The ball stuck to the flipper, and it was the grip, charged per contact

Matt, first real gameplay report: *"The ball sticks to the flipper on a lot of shots. Like a magnet
or something."*

Measured by asking the one question a player cares about, **how far up the table does the ball go
after one flip**, against where it sits on the bat (u = 0 at the pivot, 1 at the tip):

```
                        u=0.30   u=0.50   u=0.70   u=0.90
as Matt played it        35mm     40mm     46mm    924mm
```

Only the very tip threw the ball at all. And travel was pinned at 35 to 46mm no matter what: faster
flips, bouncier rubber, an explicit kick, all changed the ball's top SPEED (1.8 to 6.4 m/s) and none
of them changed how far it went. **A number that does not move when you change its supposed cause is
telling you the cause is somewhere else.** Three fixes were tried and rejected on measurement before
the control run named it:

```
no flipper friction      48mm     55mm    924mm    922mm
```

**It was the grip.** A ball riding a surface touches it again every fraction of a millimetre, and
how often that happens is a property of the solver, not of the table: 14 to 22 contacts per tick
against the flipper. Friction was charged at every one of them, so the bat gripped the ball about
fourteen times harder than physics says and carried it round instead of letting it slide off.

The fix is a **contact EPISODE**: the first touch of a surface in a tick is an impact and is paid
for in full, and every touch after it only keeps the ball out of the surface. No restitution, no
friction, no second helping of either. Both paths that can resolve a flipper contact share the map,
because the flipper push runs before the sweep and would otherwise pay twice.

```
after the fix            46mm     53mm    924mm    922mm
```

**This is the third time this exact bug has appeared in this file**: rolling drag was charged per
contact, then friction inside a micro step, now friction across a tick. If you add anything that
costs the ball energy, ask what it is charged PER. Per contact is almost always wrong.

### And then the real cause: the bat was in the swept contact set

Matt, on a second recording: *"Look at the first and third flipper hits."* Every contact in it is a
small hop.

```
                        u=0.30   u=0.50   u=0.70   u=0.90
before                    56mm     53mm    922mm    921mm
after                    924mm    925mm    921mm    924mm
```

**The flipper is no longer swept against.** A swept contact tests the bat's two flanks and its two
end circles separately, and it can return a normal belonging to the FAR side of the bat. One did:
with the ball measurably on top of the bat (side +20.7mm, instrumented inside the micro steps) the
keep-out clamp fired with a normal of `(0.39, 0.92)`, pointing straight down INTO it, and took the
ball from 2.82 m/s to 1.16 m/s in a single call at the instant the bat reached its stop.

`penetration()` cannot do that, because it measures from the bat's CENTRELINE: the normal is the
ball minus the closest point on that line, so it can only point from the bat towards the ball. The
flipper is resolved there and only there now, before and after each micro step's advance. A micro
step is bounded by the bat's tip travel, so the ball crosses at most a few millimetres inside one,
and the 22220-ball flipper push probe confirms nothing gets through.

**Six candidate fixes were tried and rejected on measurement first**, which is the part worth
keeping:

1. faster flip (30ms to 8ms): top speed 1.8 to 6.4 m/s, travel unchanged
2. bouncier rubber, a higher restitution floor, a gentler fade: travel unchanged
3. an explicit `FLIP_KICK`: worth 1mm in 924
4. restitution on the re-contact clamp: no better, slightly worse near the pivot
5. a floor holding the ball at the bat's speed on re-contact: unchanged
6. easing the bat into its stop instead of stopping dead: helped at mid bat only by halving the
   flipper's power everywhere else

**Every one of those moved the ball's top SPEED and not one moved how far it TRAVELLED.** That is
the whole lesson: a number that will not move when you change its supposed cause is telling you the
cause is somewhere else, and the number to watch is the one a player feels.

`flipPower` in `probes/checks.js` is the tripwire, and it measures travel. It covers BOTH flippers,
which none of the hand-written traces did.

## Chrome served the old build, and the Claude app did not

Matt, 2026-09-11: *"It's perfect when I open it within the Claude app. But when I open it in the
chrome app it's the old one with the holes."*

Not a physics bug and not a deploy failure. The hub's service worker serves the REST tier
**cache-first** (`sw.js`, 2026-09-01), and this tool's files are in that tier, so Chrome, which has
the worker registered, handed back the previous build's `physics.js` from its cache. The Claude app
has no service worker at all, so it fetched the new build over the network. Two browsers, two
builds, same URL.

**Cache-first is the right bargain for a released game** - it took opening Skeeball from 2,188 KB to
19 KB - **and the wrong one for a tool being changed several times an hour and judged by how it
plays.** A stale build here is not a slower open, it is the wrong answer to "is this fixed yet", and
it costs a round trip with Matt every time. `DEV_FRESH` in `sw.js` excludes `./pinball2/` from the
cache-first set, so this tool is network-first with the cache as an offline fallback. The released
`pinball/` keeps its cache-first open, and `test-sw-strategy.mjs` asserts both halves.

**The editor now says which build it is running**, in the header, next to the title. It compares the
active worker's cache version (`GET_VERSION`) against the deployed `version.json`, and when they
differ it turns red and reads `v777 -> v778`; tapping it updates the worker and reloads. A worker
already installed on a phone is still the old one until it updates, so the tool says so out loud
rather than leaving it to be guessed from how the ball behaves.

## The build chip told the truth and the table was still hours old

Matt, 2026-09-11, a screenshot of the tool on his phone: the chip reading **v782**, the current
build, and on the canvas the original bare box - no bumpers, no slingshots, no ramp. *"Is this what
it's supposed to look like?"*

The chip reads the SERVICE WORKER's cache version against `version.json`. It was right. What it
cannot see is which copy of each MODULE the page ended up with, and there are three separate places
an old one can come from: the browser's own HTTP cache, the service worker's cache, and the
slow-connection latch, which serves a cached copy even on a network-first path once the link has
proved slower than `NET_TIMEOUT_MS`. `DEV_FRESH` took this tool off the cache-first list; it did not
and could not make those three impossible.

**A URL with the build in it is a different URL, and no cache belonging to an older build can answer
one.** `pinball2/editor/index.html` fetches `version.json` with `cache: 'no-store'`, installs an
**import map** stamping `?v=<build>` onto every module in the graph, and only then appends the
module script (itself versioned, because an import map remaps specifiers resolved inside modules and
never the `src` of a script tag).

**It has to be the import map and not `import('...?v=')` inside `editor.js`.** That would version
only the five modules `editor.js` names. `render.js` imports `physics.js`; `checks.js` imports
`physics.js` and `config.js`. Those relative specifiers would resolve unversioned and could still
come back stale - a MIXED build, which is worse than the original bug, because the renderer and the
solver would then disagree about the geometry they share. An import map keyed on the resolved URLs
catches the transitive edges, which is the whole graph.

Offline the fetch fails, no map is installed, and the tool loads from cache exactly as before. A
hung request cannot leave a blank screen either: a 4 s timer starts the unversioned load.

`test-editor.mjs`'s last case asserts on the NETWORK LOG, not on the source - all six modules
fetched with the deployed build in the URL. Born red against the plain `<script type="module">`.

**And the corner of the screen now says what is on the table** (`2 arc, 3 bumper, 1 drain, 2
flipper, 1 ribbon, 3 seg, 2 sling`). One line, and the question would never have needed asking.

## A dead stop needs something holding the ball

BOARDWALK reported two dead stops, both `on nothing`, and a re-drop from each of those exact
coordinates rolled straight out - one of them all the way to the drain. They were balls at the APEX
OF AN ARC when the six second clock ran out: momentarily under 0.05 m/s, touching nothing, and
accelerating the entire time.

The rule is not a judgement call. Gravity along this playfield is a constant 1.111 m/s2, so **a ball
held by no solid and riding no ramp cannot be at rest**, and `restSweep` now requires a holder
before it calls something a dead stop. Not a workaround to make a table pass - the old test was
simply asking the wrong question, and a FAIL line that cries wolf is a FAIL line that stops being
read, which is the whole reason this repo reports coordinates instead of percentages.

`test-checks.mjs` pins it from both sides: a ball in a cup is still named, and an open playfield with
nothing but its outer walls reports nothing.

## The ramp tool, and the check that had to move with it

Matt: *"why can't i add ribbons?"* There was no reason beyond nobody having built it. The honest
version of the answer is that a ramp is the one part that does not fit the editor's shape: everything
else is two or three numbers you drag, and a ramp is a PATH with three rules running along it.

So the tool lays CONTROL POINTS and generates the rest, through `buildRamp` in `table.js` - **the
same function the shipped table already called.** That was the one decision worth making carefully.
A curve in the editor and a curve in the table file would agree on the day they were written and
drift the first time somebody fixed one of them, and the thing they would disagree about is the
geometry a ball rides.

Three things fell out of building it that were not obvious going in:

**The resampling had to change.** The old code put a fixed eight points on every control segment,
which is fine for a path written by hand with evenly spaced points and wrong for one a person taps:
long segments come out coarse, and coarse is exactly where a kink appears. It resamples by distance
now, so the turn between consecutive points depends on the curve's radius and nothing else. TEST
BOX's own ramp was re-measured through `rampProbe` afterwards rather than assumed.

**A ramp's handles had to become its control points,** which changes what the two end dots do on any
ramp that has them. A ramp built before the tool has no control points and keeps the old behaviour,
because inventing some for it would be a guess. **This is a deliberate change to an existing
control, not a side effect** - flagging it here because that is the kind of thing I have shipped
silently before.

**And the ramp probe had to move into the app.** It was node-only, which was defensible while every
ramp in existence was written in code and checked once by whoever wrote it. The moment a person can
lay one by hand, a check that lives in a terminal is a check that never runs, and the failure mode
is building a broken ramp and finding out by playing. Shipping the tool without the check would have
been shipping half of it.

## There was no plunger, and BOARDWALK has a shooter lane

Matt filmed it: tap Launch on BOARDWALK, the ball trickles down the right lane at half a metre a
second, drains, over and over, never once reaching the playfield. Six seconds, four launches, four
drains.

Nothing was broken. `newBall` has always dropped a ball at `table.launch` with 0.1 m/s and let
gravity have it, which is exactly right for TEST BOX, whose launch point sits in open play. BOARDWALK
has a real SHOOTER LANE between w2 and w6, and a ball dropped at the top of a lane that runs to the
drain has precisely one place to go. **A feature that is correct for every table you have tested
against is not a feature that is correct.**

A table may now carry `launchV`, a velocity. Absent means the old drop, so nothing existing changes.

**And then I shipped the wrong number and Matt had to tell me again:** *"you clearly didn't test it.
Now the ball goes up the right side, then along the top wall, and then down the left wall and off
the board. Just shoots straight out."* He was right. 3.2 m/s crests the top corner with so much
speed left that the ball skims the entire top rail, hugs the left rail and drains in one second
having touched no bumper, no slingshot and neither flipper.

**The test I wrote could not have caught it, and that is the real lesson.** It asked "did the ball
reach the playfield" - and the ball did reach the playfield, at 0.32 s, on its way past everything.
A launch is not a position, it is an OUTCOME: `test-checks.mjs` now fails a launch that touches
fewer than two things that can hit back, or that drains inside four seconds. Measured properly, the
band is 1.55 to 1.95 m/s, choppy inside itself, and 1.65 gives 13.3 seconds across all four bumpers,
a slingshot and both flippers. Everything at or above 2.0 is the highway to the left drain.

**And the near miss worth keeping.** The first version had `fromJSON` write `launchV: null` for a
table without one. `tableIsFinite` REJECTS null on purpose - JSON has no NaN, so a NaN comes back as
null and null in arithmetic is 0 - so every save on every table silently failed its own guard and
went nowhere. One existing test caught it ("editing a named table keeps the change in that name",
15 then 15), which is the entire argument for that test existing. **An optional field is omitted,
never nulled.**

## A built-in table is code, not a file on a phone

Matt: "make sure boardwalk is available in the tool." The tempting way to do that is to seed it into
the table library on first run. **That is the stale-table bug rebuilt from scratch** - a device that
seeded this build's copy would still be showing you this build's copy in December, which is exactly
the shape of the thing the library was written to end.

So BOARDWALK ships the way Default does: as a module, in `BUILTINS`, never stored, current by
construction. Open it and you are looking at this build's copy; edit it and you are editing a working
copy written nowhere; Save as is how you keep one. Selector values are prefixed (`builtin:BOARDWALK`)
so a person can have their own save called BOARDWALK and neither shadows the other.

The knock-on worth keeping: `probes/run.mjs` takes `--table` now. **A file in this repo that no probe
looks at is a file that rots**, and a shipped table is a file in this repo.

And one caught in passing: **`validate-sw-assets.mjs`'s `SCAN_DIRS` never included `pinball2`**, so
its "every deployed .js is precached" check was blind to this whole folder, and `boardwalk.js` went
into a build without a precache entry while the validator printed OK. `pinball2` is in the list now.
The root `CLAUDE.md` calls a missing precache entry "the one thing a deploy cannot survive"; a
hand-maintained list of folders to look in is how that happens quietly.

## Turning something you cannot see yet

Step 5 of the overhaul, and the last of it: turn and scale a SELECTION, where handles only ever
reshaped one part. The brief named the case it exists for - "you'll often want to rotate a saved
bumper cluster before dropping it, rather than rebuilding it at an angle."

**Before dropping it.** That half is where the work was. Rotating something already on the table is
a loop closed by looking at it; rotating something that has not landed is blind, and blind on a
phone in particular, because there is no hover and so no preview that can follow a pointer. Three
ways out, and only one of them is any good:

- Report the pending angle as a number. Honest, and useless: nobody can picture a saved cluster at
  30 degrees from the word "30".
- Drop it, turn it, drag it back. This is the rebuilding the prefab library was built to stop.
- **Draw it before it lands.** A dashed outline in the selection accent, in the middle of whatever
  is on screen, redrawn as you turn it.

The third one costs about forty lines (`drawGhost` / `ghostPath`) and cannot reuse the renderer,
because `draw()` clears the canvas and paints a playfield first - the loupe gets away with calling
it because the loupe redraws everything. So the ghost is centrelines only, in the editor's own
vocabulary, which is the right answer anyway: it is there to say WHICH WAY IS THIS POINTING, not
how thick anything is.

The other half is a data change with a rule behind it: **`app.placing` now carries the prefab's
SHAPES, not its name.** An armed prefab is a working copy. Turning the one you are about to drop
must not touch the one in the library, and looking a name up at drop time would have made those the
same object. The test that pins it reads the stored prefab back out of localStorage after two taps
of the turn button and asserts it has not moved.

Two smaller things worth not re-deriving. **Anticlockwise on screen is a negative angle** here,
because y runs down the table - and because the stored angles (`a0`/`a1`, `restAng`/`endAng`) are
atan2 in that same frame, one `+= ang` turns a part's geometry and its spans together, which is
what stops an arc being drawn one way and collided another. And **scale is uniform, thicknesses
included**: scaling positions alone looks right for one step and is wrong by the third, because the
gaps between parts move and the parts themselves do not, so a cluster this repo measured clear at
100% is a wedge at 60%.

## A panel that shuts itself under your finger

Step 4 of the overhaul is the placements list: every part on the table, by kind and id, tap one to
select it and bring the view to it. The list itself was twenty lines. The bug was in the mechanism
it sits in.

`renderPanel()` runs on every edit frame, and `group()` built each `<details>` with its open state
passed in as a literal. So a group you opened re-rendered SHUT on the next drag, the next nudge, the
next anything. Nobody had noticed, because until now every group was either short enough to leave
open or opened by a selection. A long list you scroll through is the first thing that made it
obvious, and it made the feature useless rather than annoying: tap a row, the part moves, the list
you were working down closes.

The fix is a module-level `groupOpen` Map keyed on title, written by the `toggle` event, read on the
next render. **A group that should be open because something is SELECTED still overrides it** - Tune
opens the tapped part's group whether or not you shut it last time, which is the behaviour that
answers "show me only the ones for this part" and must not regress.

The general lesson, and this repo has now met it twice in this editor: **a panel that re-renders
wholesale on every frame has to carry the state that lives in the DOM back out of the DOM.** Scroll
position is the next one of these waiting to happen.

## Prefabs are a way of not typing, not a new kind of object

Step 3 of the overhaul. The temptation with a "save a group of parts" feature is to make the group a
THING - an object with its own id that the engine, the checks and the data model all have to learn
about. That would have been a new shape kind in `physics.js`, a branch in `distToShape`, a case in
every probe, and a question ("what happens when a ball hits a group?") with no good answer.

**So a prefab exists only in the editor's storage.** Placing one runs `newId` per part and pushes
ordinary shapes. From the instant it lands it is indistinguishable from parts placed by hand:
selected, editable, movable, deletable one at a time. Nothing in `physics.js`, `checks.js` or the
data model knows prefabs exist, and no probe needed a line changing.

The two details worth keeping: the anchor is the **centroid of the selection's own centres**, so a
prefab lands centred on the tap rather than by a corner; and the offsetting is `moveShape` in both
directions, the same function a drag uses, so a prefab cannot move differently from a drag.

## The stale table, ended: a library instead of one slot and a guess

Matt, after the third build in a row showed him an old table: *"This is an ongoing issue I've asked
you to address multiple times. What is going on? Why isn't this fixed?"*

Three different causes had produced the same symptom, and the last one was this layer trying to be
clever. It was ONE autosave slot plus an `edited` flag, and on load it GUESSED whether a new build's
table should replace what was stored: keep an edited save, drop an unedited one, print a grey
warning line when it guessed "keep". **It worked exactly as designed and the design was the
problem.** One slot, a guess, and seeing a new build required noticing a line of grey text and then
finding a button called "Reset table". Worse, `afterEdit()` set `edited` on ANY drag, so the taps
Matt made while testing the fine drag marked his save as precious work.

**The fix is not a better guess. It is having nothing to guess about**, by making the two things
separate objects:

- **Default is not stored at all.** It is whatever `table.js` ships in the build you are running, so
  it is current by construction. Editing it is a working copy written nowhere.
- **The library** is every table explicitly named and saved. A new build never touches it.

`edited`, `shippedSig()`, the grey line and the compare-against-shipped logic are all gone. The old
one-slot key is migrated once into a save called "My table" and then **left where it is** rather
than deleted, so nobody has to trust the migration got it right.

**The general lesson, which is the reason this is written down:** a mechanism that has to GUESS what
somebody meant will be wrong often enough to be noticed, and every fix will be a better guess. Three
attempts here were better guesses. The fourth changed the question.

## The workspace: four full-page modes became one that never moves

Matt's brief, 2026-09-11: *"Switching modes replaces the whole screen, so the table view resizes and
every panel disappears and reappears... The tool works, but it feels disposable, not like something
you'd want to keep coming back to for the next table."*

**The canvas is a fixed grid row now**, and that is the load-bearing part rather than the tidy part.
It used to be a flex child that grew and shrank with whatever the panel below it contained, so
switching tabs resized it with no window `resize` event - which is exactly the bug that made every
tap land an inch from the finger, patched at the time with a `ResizeObserver`. A fixed row means
there is nothing to patch. `test-editor.mjs` measures the canvas box in all four modes and fails if
they ever differ again.

`--stage-h: 56svh`, not `dvh`: `dvh` changes as a phone's URL bar slides, which would resize the
canvas on every scroll.

**The brief asked for four docks round the canvas, and that was the one thing to push back on.** At
393px wide, a left dock and a right dock leave the table 199px - smaller than before, and it would
have made the magnifier and the fine drag pointless. So: one dock on a phone holding both halves
stacked, and at `min-width: 900px` the same two halves become the left and right docks the brief
described. `#panel { display: contents }` drops the wrapper out of the grid. Same DOM, same code.
Every GOAL in the brief survived; only the arrangement changed, and Matt approved the swap before a
line was written.

**Zoom and the object controls left the panel and became chrome.** Undo was unreachable the moment
you switched to Tune to see what a slider had done, and the only zoom on a phone was a pinch you had
to know about.

**Tune's 22 sliders became collapsible groups**, the selected part's group opening itself and
outlined in the accent colour, which is what makes "tap a part, tune that part" visible rather than
inferred.

**Nothing was dropped, and that is asserted rather than claimed**: a test walks all four modes and
fails if any control that existed before the overhaul has gone missing.

## The gap rule was measuring gaps wrong, and the wrong direction was the dangerous one

Found while laying out a second table: `checkGaps` kept failing clearances that were plainly wide
enough, and every one of them was next to a post or a bumper.

`surfacePoints` is supposed to return a shape's CENTRELINE, because its caller measures
`distToShape(other, p)` - already a distance to the OTHER shape's surface - and then subtracts this
shape's own radius once. It did that for a seg, an arc and a flipper. For a circle it returned the
SURFACE, so the radius came off twice.

**Every clearance next to a post read 9mm short and every clearance next to a bumper read 25mm
short.** The visible half was false alarms: a 47mm lane beside a bumper reported as 22mm and failed
a table that was fine. **The half that matters is the other one.** A real one-ball gap beside a post
measured 27 - 9 = 18mm, under the 0.75-ball floor, so it was not flagged at all - and anything that
came out NEGATIVE was filed as a deliberate overlap, which is a note rather than a failure. The
check written to find wedges was blind to the ones next to the parts a ball spends most of its time
hitting.

`pinball2/probes/test-checks.mjs` pins it, against gaps whose size is known by construction. Born
red on four of seven, including "a one-ball gap beside a post is found": MISSED.

**The lesson for the next probe, not just this one: a measurement that disagrees with the design is
not automatically the design's fault.** Six of the thirteen gaps that layout was failing on did not
exist.

## A finger covers the thing it is placing

Matt, 2026-09-11: *"When I select an object, the slingshot for example, and I want to extend or
shorten it, I need an enlarge option. If I hold it down I can precisely move stuff or a smaller
enlarged window comes up or something."*

At the default fit a millimetre of table is under a screen pixel and a finger is about 9mm across.
So an end handle is SMALLER THAN THE FINGER REACHING FOR IT, and hidden under it once reached: you
find out where you put it when you lift off. Four answers, because they are different problems
wearing the same complaint:

- **Zoom, which did not exist on a phone at all.** The only zoom control was a `wheel` handler,
  which is a desktop mouse. There is now pinch to zoom, two fingers to pan, and a `-` / `+` / Fit
  row in the Edit panel (a control you can see beats one you have to know about, and a phone held
  one-handed has one thumb). Zoom is about the pinch MIDPOINT, never the origin: zooming about the
  origin is what makes a pinch feel like the table is running away.
- **A second finger cancels the first finger's edit and puts it back.** Every two-finger gesture
  starts as one finger landing, and that finger can land on a part. Without the restore, a zoom
  would leave the part moved by however far the first finger travelled on its way to being joined.
  The snapshot `pushUndo` already took is what it is restored from, so the tolerance is `toJSON`'s
  own 0.1mm, the same one every undo here has.
- **Hold still, then drag, and the handle moves a QUARTER as far as the finger** (`FINE_HOLD_MS`
  400, `FINE_RATIO` 0.25). Fine mode engages on the first movement rather than on a timer, so
  nothing moves under a finger that is not moving. The drag tracks two points from then on:
  `drag.raw` is the finger and `drag.virt` is the handle.
- **A magnifier, drawn with the real renderer at 4x**, in whichever top corner the finger is NOT in.
  A magnifier under the hand is the original problem with an extra step. It follows the HANDLE, not
  the finger, which in a fine drag are deliberately different places, and it reads the handle's
  position back off the shape rather than assuming the pointer: an arc's radius handle and a
  flipper's tip are derived, not set.

**And a wall or a slingshot now has Length and Angle rows**, which is the edit four coordinates
cannot express. "Extend or shorten it" on a line that is not square to the table meant recomputing
both ends by hand and getting the angle slightly wrong every time. Length holds A and slides B along
the line; Angle holds A and swings B round it.

**And the press-and-hold selected the whole page**, which Matt found within minutes of it shipping:
*"it also selects everything, the whole page, as if I was going to copy something."* A long press IS
the OS gesture for "select this text", and a fine drag begins with one BY DEFINITION, so this tool
could not have the second without killing the first. `user-select: none` and `-webkit-touch-callout:
none` app-wide, with `input, textarea, select` given it back (a number field you cannot select
inside is one you cannot correct), plus a `contextmenu` preventDefault on the canvas, which CSS
alone does not stop. The test asserts on the COMPUTED style, because a stylesheet that fails to
apply reads exactly like one that was never written.

**Any new gesture that holds still needs this checked.** The selection highlight also repaints the
whole page mid-drag, which is the worst possible moment for it.

**`setPointerCapture` is in a try/catch now, and that is not defensive clutter.** It throws "no
active pointer with the given id" readily, it was the first line of `pointerdown`, and an exception
there means the tap does nothing at all - indistinguishable from the dead hit-testing bug this tool
already had once. Capture is a convenience (it keeps a drag alive off-canvas); it is never worth the
whole gesture.

## Say what the number does, and show me only the ones for this part

Matt, 2026-09-11: *"Fix the terminology. 'Slingshot kick' is so vague. Say bounce. And when I'm on
the Tune tab, I should be able to select an object and see the tune objects for only that object."*

**Kick was one word for three different things.** A bumper's and a slingshot's is a fixed OUTGOING
SPEED in m/s; a flipper's was a fraction added on top of the bat's own surface speed. Naming them
the same thing hides that, and none of the three names says what moving the slider does. The
vocabulary now, and the one to keep: **BOUNCE** for how fast a ball comes off something, **GRIP**
for how much sideways hold a surface has, **PUSH** for a gameplay lever that adds speed no real part
would add. So `SLING_KICK` -> `SLING_BOUNCE`, `BUMPER_KICK` -> `BUMPER_BOUNCE`, `FLIP_KICK` ->
`FLIP_PUSH`, and a bumper's per-part `kick` field -> `bounce`.

**A rename must not drop a number somebody dialled in.** `cloneConfig` carries the old keys across
and `fromJSON` carries the old per-part field across. A tune is a preference, not earned history, but
losing somebody's work because a label got clearer is still the tool being worse.

**The Tune tab now filters to what you tapped.** Twenty two sliders in one list is a list you scroll
rather than read, and the two that matter for the thing you are looking at are somewhere in the
middle of it. Each `TUNABLES` row names the shape kinds it governs; tapping a bumper leaves six
sliders (its two, plus the four table-wide ones, which are kept because they govern it too). Show
all is one tap and nothing is hidden permanently.

**Tapping on that tab selects and never moves.** A tap on a phone drags a few pixels, and Edit's
handler turns that into a move: on the one tab where nobody is watching the table for changes, the
geometry would drift under the person tuning it. The test drives a tap WITH six pixels of drift and
asserts the part is byte-for-byte unchanged.

**And the HUD wraps now.** The line naming what is on the table ran off the right edge of a phone,
which is a line that cannot answer the question it was added for.

## The editor's touch was offset, and the cause is worth knowing

Matt: *"the editor can't tell what I'm selecting, it's like it thinks I'm selecting something an
inch above where my finger actually is."*

The canvas is laid out by flex and the bottom panel is a different height per tab, so switching from
Play to Edit resizes the canvas with no window `resize` event at all. The backing store and the view
transform still described the previous height, which stretched the picture and put every tap out by
exactly that difference. A `ResizeObserver` on the canvas fixes it. **Any canvas in a flex layout
needs one; `window.resize` is not enough and the failure looks like a hit-testing bug rather than a
layout one.**

The hit tolerance was wrong too, in a way that only shows on a phone: it was 12 mm in TABLE units,
and at the default fit a millimetre is under a pixel, so the reach was 8 screen pixels. It is 22
screen pixels now, converted to table units through the live zoom.

## The rest sweep found a trap in this table's own first layout

The feed rails originally ran into the flipper pivots, and the V that made caught **1759 of 2803
drops**. It would catch a ball on a real table built the same way. The rails stop well short now:
the ball is delivered onto the bat, or it goes down the outlane outside it, and there is no notch
between the two. The fix after that one opened the bottom corners (the outer rails had been
shortened), and 96 balls fell out of the table sideways past the drain's own rectangle. Both are
recorded in `table.js` beside the geometry.

## Step 3: pop bumpers and slingshots (2026-09-11)

The first parts that HIT BACK. Both are solenoid driven on a real machine, so both are modelled as
a fixed OUTGOING SPEED along the contact normal rather than as a very bouncy wall: a dead slow roll
into a bumper still comes out fast, which is exactly what a real one does and the opposite of what
restitution gives you. A minimum approach speed stops a ball resting against one from turning it
into a machine gun, and a cooldown is the other half of that.

Three bugs came out of adding them, and each is a shape worth knowing:

- **A new shape kind is INVISIBLE to every probe until `distToShape` is taught it.** It returned
  `Infinity` for anything it did not recognise, which reads as "nowhere near", so bumpers and
  slingshots spent one build unseen by the playable-area fill, the gap rule and every sweep. It
  THROWS on an unknown kind now. The editor's own hit testing uses the same function, which is why
  `test-editor.mjs` caught it: five parts could not be tapped.
- **"Still alive" stopped meaning "stuck" the day the table got bumpers.** The rest sweep failed
  with balls "resting" at 2.8 m/s: a ball ricocheting between three bumpers has not reached the
  drain in six seconds and is not going to, which is the POINT of a bumper. Speed separates a trap
  from play, not the clock. A **knife edge** is separated too: every survivor is re-run with a
  nudge, and the ones that then drain are reported rather than failed, the same call
  `sweep-pinball-rests.mjs` makes for the old game.
- **Gravity is a property of the config, not of the table.** The free-fall check dropped a ball down
  the middle of the real table and reported NEVER DRAINED once a bumper stood there: a true
  statement about the ball and nothing at all about gravity. It builds a bare table for that one
  measurement now.

**The slingshot IS the feed rail.** The first version put a slingshot beside a separate feed rail
and the sweep found four dead stops in the pockets that made between the two of them and the wall.
A real lower third is one continuous line from the wall down to the flipper, so that is what this
is, and nothing can get behind it.

## Step 3b: ramps, and the second level (2026-09-11)

The thing the old game got catastrophically wrong. Full design and the four rules: `HANDOFF.md`,
"Ramps, and why they cannot lose a ball". The short version is that a ball on a ramp is simulated
along the lane and across it, so a mouth is a change of coordinates and not a move, and there is no
code that could drop a ball because there is no hand-off.

**Five defects, and every one was caught by the probe's own jump assertion rather than by playing:**

1. entry threw away how far past the mouth the ball was and started it at s = 0: a 9mm move
2. exit threw away the overshoot the same way: 2.5mm
3. a 24 degree kink in a hand-placed path swung an off-centre ball 6.6mm sideways in one step
4. a fast ball crossed several segments of the curve in one tick and the whole turn landed at once
5. the entry test was a WINDOW, so a ball at 6 m/s stepped straight over it and the probe reported
   it as "too slow to get on"

**And the assertion itself was wrong once**, which is worth as much as the rest: a ball leaving a
ramp at 3.86 m/s travels the 15mm that entitles it to and can hit something before the tick ends,
finishing at 1.89 m/s. Measured against its END speed that reads as a 3.2mm teleport and is not one.
It compares against the fastest speed during the tick now.

**The behaviour, measured:** below 1 m/s a ball cannot get on at all, 1 to 1.5 climbs and rolls back
out of the mouth it came in, and 2 and above makes it all the way round. Nobody wrote any of those
three cases. They fall out of the ramp having a height.

## "Unusable. It's bad." The editor looked like a settings page

Matt, 2026-09-12, on the build the previous session had just called finished: *"This pinball tool is
unusable. It's bad. Spend a bunch of time thinking and make it look like a polished, professional
editing software."*

He was right, and the interesting part is that every individual decision in it had been defensible.
The measurements, taken before anything was changed:

| | before | after |
|---|---|---|
| the table, drawn on a 393x852 phone | 230 x 477 | **306 x 635** (77% more area) |
| covered by the status box | the top rail and two lanes, in every mode | nothing |
| controls under the 44px tap floor, in Play alone | 14 | 0 |
| frames rendered during Find traps on BOARDWALK | 3 | 235 |
| the page, during that check | frozen 5.8 s, no progress, no way to stop | live, with a bar and a Stop |

**The layout was starving the thing the tool exists to show.** The canvas was a fixed `56svh` row
with the panel below it, and the table is 0.515 x 1.067 m - portrait, so it fits by HEIGHT and
leaves ~59% of the canvas's width as black margin. So the screen was spending 44% of its height on
a panel, and most of its width on nothing. Two changes, and the second is the one that mattered:
**the tool rail moved INTO the dead gutter** (a real grid column, so no table can ever sit under a
button), and **the dock became a draggable sheet with a shut detent**, which is what finally let the
table have the whole screen.

**The chrome was the visual language of a settings page.** 38-56px filled navy pills, 13-14px bold
text, everything the same weight. An editor is quiet: hairlines, a surface ladder, tabular numerals,
ONE accent used only for the current thing - which is also why `button.primary` stopped being a
filled yellow slab. A filled accent on every panel trains the eye to ignore it, and then the one
place it means something, the part you have selected, says nothing.

**Three real bugs came out of it, and none was a rendering bug:**

1. **The object bar was a COLUMN that grew a second row** whenever something was selected or a ramp
   path was open - silently resizing the canvas mid-edit with no window resize event. That is the
   exact class of bug the fixed-height workspace was built to end; it survived because
   `test-editor.mjs` compares the four modes with nothing selected.
2. **`#work`'s implicit grid row was `auto`**, so on a 360x640 phone the rail's own 557px of content
   set the canvas's height and pushed the status bar, the object bar and the whole sheet off the
   bottom of the screen. At 393x852 the content happened to fit, so it looked perfect. **A layout
   measured at one size is not measured.**
3. **A phone in landscape got a 794 x 58 canvas.** The stacked bands plus a sheet come to 334px of a
   393px screen. It takes the four-column layout now, at `(min-width: 600px) and (max-height: 560px)`.

**And the checks froze the page, which is the half of "unusable" that was not cosmetic.** They ran in
one blocking call inside a `setTimeout`. The fix is a generator per slow check with the plain
exported function draining it - **one implementation, two entry points**, because a chunked copy
written beside the tested copy is a second answer to "is this table safe" and the two will diverge.
Verified identical afterwards: 2781 drops, 956 shots, 73152 escapes, 528/920/927/933 mm.

**The lesson worth keeping is about the tap floor.** `docs/BUILDING-A-GAME.md` Part 0 has required
44x44 since it was written, and nothing in this tool had ever checked it - so it had never met it,
and the first pass at this redesign made several controls *smaller*, because a dense desktop
screenshot looks more professional and a screenshot has no fingers. Density has to come from
removing rows and quietening fills. `test-editor.mjs` measures every control in all four modes now,
plus a small phone and a landscape one, and it fails on a single 34px button.

**`node pinball2/probes/run.mjs ramps` used to print "all checks passed" and exit 0**, having run
nothing: the editor's button says Ramps and the CLI wanted `ramp`. A gate that can report green
without checking anything is worse than no gate. Unknown names exit 2, and the obvious aliases work.

## Where this goes next

**The editor overhaul is finished** (2026-09-11, all five steps: one workspace, the table library,
prefabs, the placements list, turn and scale). What is left is the GAME, not the tool.

The remaining object types, one at a time, each with its property panel and its own probe: drop
targets, a spinner, rollover lanes, a kicker or saucer, a plunger.

**BOARDWALK ships as a built-in** and is Matt's to tune. Three probes are red on it and two of them
are his tuning, not a session's: the flippers move the ball under 300 mm on half the power range,
and r42's mouth takes no shot weak enough to roll back out. The third, the tunnel probe's 6 of 2325
"OFF TABLE", is most likely the probe - see `HANDOFF.md`, "Tables this build SHIPS", which records
the measurement that says nothing is escaping and what question to fix instead.

**Two levels are real geometry here, never a transition.** A ramp will be a ribbon with a floor
height and a slope; the ball rolls up it and either crests or rolls back out of the mouth. There is
no hand-off to write and therefore none to drop a ball in.
