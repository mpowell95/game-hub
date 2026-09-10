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
| `probes/run.mjs` | `node pinball2/probes/run.mjs [drain\|tunnel\|gaps\|rests\|all]`, about 6 s |

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

## Numbers as at 2026-09-10, on the bare box

```
gravity      1.111 m/s2 = g sin(6.5 deg)
free fall    1.312 s against 1.311 s analytic, 0.1% off
tunnel       883 shots at 8 m/s from 24 angles, 0 got through
gap rule     0 ambiguous gaps, 6 deliberate overlaps
rest sweep   2913 drops, 0 never reached the drain
```

**"About three seconds to drain" is not the gravity test, and the first draft of the probe used it
as one.** Three seconds is how long a ball LIVES on a real machine, and it lives that long because
it keeps hitting things. A ball with nothing in its way over this playfield takes 1.31 s, which is
`sqrt(2h/g sin tilt)` and nothing else. The honest assertion is against that analytic number.

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
