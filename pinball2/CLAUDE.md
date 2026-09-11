# Pinball 2 — engine and editor

THE LAW lives in the root `CLAUDE.md` and applies here. Nothing in this folder reads or writes any
player's stats yet: there is no hub `GAMES` entry, no stats id, and no recorder. When one is added
it must be a NEW id (`pinball2`), never the existing `pinball` id, whose records belong to the four
old machines and stay exactly where they are (rule 5).

**This is a rebuild, alongside `pinball/`, not a replacement for it.** Matt, 2026-09-10, on the four
existing machines: *"none of them are even remotely playable... maybe it's better if we just start
from scratch."* `pinball/` is untouched by anything in here. Whether it is ever replaced is a
decision for after this one is judged.

The plan this is built against, including the interview it came from and the acceptance numbers, is
`docs/PINBALL2-PLAN.md`. Read it first.

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

## Where this goes next

Step 3 of the plan: the remaining object types, one at a time, each with its property panel and its
own probe. Then ribbons and the second level, then save/load and the first real table, which Matt
wants designed for fun rather than copied from any existing machine.

**Two levels are real geometry here, never a transition.** A ramp will be a ribbon with a floor
height and a slope; the ball rolls up it and either crests or rolls back out of the mouth. There is
no hand-off to write and therefore none to drop a ball in.
