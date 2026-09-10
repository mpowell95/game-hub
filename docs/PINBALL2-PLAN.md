# Pinball 2 — plan, for approval before any code

Written 2026-09-10 from Matt's interview. **No code has been written. Nothing in `pinball/` is
touched by this plan.**

## What Matt said is wrong today

Verbatim, because it is the specification:

> "The physics initially felt like the ball was falling on a vertical wall not a slanted one, it
> goes through objects, it vanishes, it teleports, it gets stuck everywhere. objects overlap and go
> through one another, things that should be smooth flush rails are not, curved lines get rendered
> as if someone drew them using a computer mouse. No aspect of gameplay is satisfactory and no
> amount of asking CC to fix it gets the job done. We have 4 pinball machines right now and none of
> them are even remotely playable."

Seven complaints. Each one below has a cause and a mechanism that removes it, and a number that
proves it. That is the whole plan: **nothing ships on "feels better now."**

| Complaint | Cause | Fix | Proof |
|---|---|---|---|
| Falls like a vertical wall | Gravity is a tuned table-units number, not a tilted plane | `g x sin(TILT)`, TILT 6.5 deg, real metres. About 1.11 m/s2, a ninth of a free fall | Measured free fall matches `sqrt(2h/g sin tilt)` to within 5%. **Corrected 2026-09-10**: this row first said 2.4 to 3.0 s, which is how long a ball LIVES on a real machine, not how long it falls. A ball with nothing in its way crosses this playfield in 1.31 s and the analytic value is the honest assertion |
| Goes through objects | Step-then-push-out. Small steps make it rare, not impossible | Swept collision: solve the exact time of first contact, move the ball there, bounce, repeat | Fire the ball at every collider at max speed from 24 angles. Zero crossings, at any speed |
| Vanishes / teleports | Level transitions delete the ball and re-create it at a fixed point, and post-step position corrections fling it | No transitions exist. No position corrections exist, because the ball is never inside anything | Frame-to-frame position jump never exceeds distance travelled. Ball count is always 1 |
| Gets stuck everywhere | Two surfaces just under a ball apart form a stable parking space | Resting contacts slide instead of bounce, plus an exhaustive author-time trap sweep | `sweep-rests` finds 0 resting places outside the drain. This tool already took RAINBOW from 252 to 1 |
| Objects overlap | Nothing checks. Overlaps were found by playing | The editor validates on every edit: collider overlaps, and the gap rule (a gap is either under 0.75 balls or over 1.15) | Editor refuses to export a table with an unresolved red flag |
| Rails not smooth or flush | Rails are chains of short straight capsules | An arc is a first class collider: centre, radius, angle span. Exact to hit, exact to draw | No polyline approximates a curve anywhere in the data model |
| Curves look mouse drawn | Same cause, on the render side | The renderer draws the same arcs the physics uses, as SVG arcs | Render and physics read one shape list. They cannot disagree |

## The three decisions Matt made

1. **New editor, new engine, new machine. `pinball2/`.** Real Pinball keeps its four machines, its
   folder, its stats id and its scores. Nothing is deleted or migrated (THE LAW rules 2 and 5). The
   new game is admin-only until Matt says otherwise. If he prefers it later, replacing Pinball is a
   separate decision made then, not now.
2. **Clean 2D vector, top-down.** Real arcs, drawn from the shapes the physics uses.
3. **Two levels, done as real geometry.** Matt: "I would very much like to include two levels, even
   if that means just objects like a roller-coaster type thing for the ball. Every pinball game I've
   ever played has had at least that."

## How two levels work without a teleport

This is the part that matters most, so it is spelled out.

Every collider carries a floor height. The ball carries a height. A ramp is a **ribbon**: a centre
line (lines and arcs), a width, walls on both sides, and a height profile along its length. Rolling
onto it is geometry, not an event: the ball reaches the ribbon's entry lip moving into it, and the
lip is a small step it either climbs or does not.

On the ribbon the ball is a normal ball. Gravity along it is `g x sin(TILT + slope)`, so a weak shot
slows, stops, and rolls back out of the mouth. A good shot crests and comes down the other side.
Falling off the end of a wireform drops it back to the floor with the speed it had.

There is no code anywhere that sets a ball's position. That is what makes teleports impossible: not
a rule a session must remember, but the absence of the mechanism.

Skeeball is the precedent Matt named and it is the right one. That game works because its ball has a
real height on a real surface.

## The engine

One file per machine, forked, never shared (repo rule). Machine one is `pinball2/machines/<name>/`
with its own `physics.js`, `render.js`, `table.js`, `config.js`.

- **Units are real.** Playfield about 515 x 1067 mm, ball 27 mm and 80 g, tilt 6.5 degrees. Real
  units mean real constants, which is how feel comes out right the first time instead of by
  nudging. (The playfield dimension is the standard Williams body size to the best of my knowledge
  and is worth a sanity check against a photo before it is frozen; the ball figures are certain.)
- **Colliders, and that is the whole list**: circle, segment, arc, capsule, polygon, ribbon
  (a ramp), flipper (a swept capsule about a pivot). Every one has an exact time-of-impact
  solution. No mesh, no triangle soup, no approximations.
- **The step**: collect the earliest impact among all colliders, advance exactly to it, resolve,
  repeat until the frame's time is spent or an event budget is hit. A ball resting on a surface
  slides along it rather than jittering against it.
- **Kept from the current engine, because they are genuinely good ideas**: a flipper that
  accelerates and has real angular momentum so a late flip is a soft shot; flipper rubber whose
  bounce softens as impact speed rises; ball spin as a real degree of freedom; damping while a
  flipper is held up, so the ball can be cradled and aimed.
- **No magic numbers.** Every tunable lives in `config.js` as a named constant, is a slider in the
  editor, and is written back by the editor's Copy config button.

## The editor

`pinball2/editor/index.html`. Loads the machine's own engine, so **test mode is the real game**, not
a preview of it. Matt: "the only way to get ANY machine to a working state is to make the test mode
in the editor fully playable."

**Placeable objects, each with its own property panel**: flipper (pivot, rest and active angle,
length, torque, rubber), pop bumper (radius, kick, threshold), slingshot (kick, trigger face), ramp
or wireform ribbon (click a path of lines and arcs, width, height profile, entry lip), rollover lane,
standup and drop target (drop behaviour, respawn), spinner (resistance, score per turn), kicker or
saucer (hold time, launch angle and force), wall or rail (line and arc segments, thickness, bounce),
post, drain and outlane.

**Editor features**: place, move, rotate, scale, delete, duplicate, multi-select, snap to grid on by
default, zoom and pan, **undo and redo from the first version**, layer toggle for floor versus
ribbons, save and load JSON per table, and localStorage autosave that survives a reload.

**Three panels that are the point of the tool:**

- **Play.** Launch a ball and play the table with real flippers, right there. Slow motion, step one
  frame, and a ball trail.
- **Tune.** Every physics constant as a slider, live, while a ball is in play. Gravity, tilt, ball
  restitution and friction, flipper torque and rubber, bumper kick. Copy config writes the block.
- **Check.** Runs on demand over the table being edited: the trap sweep (drop a ball at rest on a
  grid over the whole playfield, six seconds each, list every place it does not reach the drain),
  the overlap and gap validator, and the tunnel probe. Results are drawn ON the table as red marks,
  not printed as a percentage. A percentage is what let four soaks pass a table that was unplayable
  in thirty seconds.

**Editor and game are decoupled.** The editor never writes a game file. It exports JSON; a session
applies it. Matt's call, and it also means shipping a gameplay fix cannot wipe unsaved editor work.

## Build order

1. **This document. Approve it before anything is written.**
2. **Engine core, editor shell, and exactly three objects: wall, flipper, drain.** DONE 2026-09-10,
   live at `/pinball2/editor/`. The deliverable is Matt flipping a ball around a bare box and saying
   whether the ball feels right. Nothing else is built until that is a yes. Numbers delivered:
   gravity 0.1% off analytic, 883 shots at 8 m/s with 0 through, 0 ambiguous gaps, 2913 drops with
   0 stuck. Details and the traps the sweep found in this table's own first layout: `pinball2/CLAUDE.md`.
3. **The rest of the objects, one at a time**, each with its panel and its own probe.
4. **Ribbons and the second level**, once the flat game feels right.
5. **Save and load, then build the first table** in the editor. **A brand new layout**, designed for
   fun. Matt, asked whether to start from FOUNDRY's: *"can you create a brand new one for me? I'm not
   committed to the current layouts. I just want it to be fun."* No existing machine is the starting
   point.

Steps 2 through 5 are each their own session with its own approval. This document is the handoff
between them.

## What this plan deliberately does not do

- It does not touch `pinball/`, its four machines, its stats, or the hub entry.
- It does not add a physics library. Pinball is circles, lines and arcs on a plane, all of which
  have exact closed-form impact solutions. A general 3D solver (cannon-es, vendored here for
  Skeeball) buys nothing here and brings the tunnelling and the resting-contact jitter that this
  plan exists to remove. Box2D would be a defensible choice; hand-written swept primitives are
  better still, because the failures Matt is reporting are exactly the ones a general solver hides.
- It does not promise the first table will be good. Getting a bare box to feel right is step 2 for a
  reason.
