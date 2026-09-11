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

## Files

| File | Role |
|---|---|
| `machines/testbox/config.js` | every tunable number, plus `TUNABLES`, which is what the editor's Tune panel is generated from. A constant with no row is not tunable by hand |
| `machines/testbox/physics.js` | the swept solver. Pure, no DOM, no timers |
| `machines/testbox/table.js` | the bare box: rails, two flippers, a drain. Plus `toJSON`/`fromJSON` |
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

## Where this goes next

Step 3 of the plan: the remaining object types, one at a time, each with its property panel and its
own probe. Then ribbons and the second level, then save/load and the first real table, which Matt
wants designed for fun rather than copied from any existing machine.

**Two levels are real geometry here, never a transition.** A ramp will be a ribbon with a floor
height and a slope; the ball rolls up it and either crests or rolls back out of the mouth. There is
no hand-off to write and therefore none to drop a ball in.
