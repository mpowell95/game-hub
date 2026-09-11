# Pinball 2 — complete handoff

**For a session that has never seen this tool.** Read this end to end before changing anything in
`pinball2/`. It describes what every file does, every field of the data model, every constant, every
control, every check, and every way this tool has already been broken.

`pinball2/CLAUDE.md` is the companion: it is the incident log, written as "here is what went wrong
and why the fix is shaped like that". This file is the reference. Where they disagree, the code
wins, and fix both.

---

## 0. The thirty second version

- A **pinball engine and a table editor**, live at `/pinball2/editor/`. Vanilla ES modules, no
  build step, no dependencies.
- It is **not a hub game**. No `GAMES` entry, no stats id, no recorder, no score. Opening the hub
  will not show it.
- The old `pinball/` game is **completely separate** and must stay untouched. Four machines, real
  player records. Nothing in `pinball2/` reads, writes or imports anything in `pinball/`.
- The editor loads the machine's own engine, so **Play in the editor is the real game**. There is
  no second code path and no preview mode.
- Everything is measured. Ten automated probes gate it, and every number quoted in the docs came
  from one of them.

---

## 1. Where things are

```
pinball2/
  HANDOFF.md              this file
  CLAUDE.md               the incident log: every bug, its cause, and why the fix looks like that
  index.html              a redirect to editor/
  editor/
    index.html            the shell: header, canvas, bottom panel, all the CSS
    editor.js             the whole tool. Modes, input, undo, panels, persistence, the build chip
  machines/testbox/       ONE MACHINE. A second machine COPIES this folder.
    config.js             every tunable number, and the TUNABLES list the sliders are built from
    physics.js            the solver. Pure: no DOM, no timers, no randomness
    table.js              the table content, plus toJSON / fromJSON / newId
    render.js             canvas 2D drawing
  probes/
    checks.js             every check, importable by both the editor and node
    run.mjs               the node CLI for those checks
    test-checks.mjs       headless tests for the checks themselves (the gap rule's maths)
    test-editor.mjs       browser tests for the TOOL itself
```

**One engine per machine, forked, never shared.** This is a repo-wide rule (root `CLAUDE.md`). A
second machine is a copy of `machines/testbox/` with its own `physics.js`. Do not factor the solver
out into something shared: a shared fix silently changing a machine nobody was working on is the
exact failure this rule exists for.

---

## 2. Running it

**Live:** <https://mpowell95.github.io/game-hub/pinball2/editor/>

**PUT THAT LINK AT THE END OF EVERY MESSAGE TO MATT.** His instruction, 2026-09-11: *"Resend the
link to the room every time."* He plays it on a phone, from a chat thread, and scrolling back to
find the URL is friction every single time. It costs one line. He has already had to ask "Where is
it?" once when a session answered a question about the tool without including it.

**Local:**
```
node server.mjs                 # serves the repo root on http://localhost:8123
# then open http://localhost:8123/pinball2/editor/
```
A plain file:// open will NOT work. ES modules need real HTTP.

**The checks:**
```
node pinball2/probes/run.mjs            # all of them, about 95 seconds
node pinball2/probes/run.mjs power      # one: drain,tunnel,flip,power,ramp,escape,gaps,rests
node pinball2/probes/test-checks.mjs    # are the checks themselves right? headless, under a second
node pinball2/probes/test-editor.mjs    # the browser tests; needs `node server.mjs` running
```
`test-editor.mjs` SKIPs cleanly when playwright-core or Chromium is missing. That is not a pass.

---

## 3. Deploying, and the three things that will bite you

This tool is served by the hub's service worker, and that has caused two separate incidents.

1. **Bump `CACHE` in `sw.js` past what is on `main` RIGHT NOW, not past your working copy.**
   ```
   git fetch origin main && git show origin/main:sw.js | grep -m1 '^const CACHE'
   ```
   Two branches open at once both compute the same next number. That has happened here: another
   session took v776 mid-session and the collision had to be caught by hand.

2. **Run `node validate-sw-assets.mjs` after ANY file change and commit `sw.js`.** It rewrites the
   generated `REST_MANIFEST` (a content hash per file) and writes `version.json`. A stale manifest
   fails `test-sw-strategy.mjs` and makes every device re-download the whole game tier.

3. **`pinball2/` is deliberately excluded from cache-first serving**, by `DEV_FRESH` in `sw.js`.
   Released games are cache-first for speed; this tool is network-first so a build you just shipped
   is the build that runs. Matt found this the hard way: the Claude app showed the new build and
   Chrome showed the old one, same URL, because Chrome had the service worker and the Claude app did
   not. `test-sw-strategy.mjs` has four assertions locking it down. **If you add a file under
   `pinball2/`, it is covered automatically by the path prefix. If you ever move this tool, move
   `DEV_FRESH` with it.**

Then the ordinary repo rule applies: commit, push, open a PR, **merge it**, and verify the
`pages build and deployment` run for the merge commit reports `conclusion: success`. A branch is not
a deploy. See the root `CLAUDE.md`.

**The build chip.** The editor header shows which build is running. It asks the active service
worker for its cache version and compares it with the deployed `version.json`. Matching shows
`v779`. Behind shows a red `v778 → v779`, and tapping it updates the worker and reloads. If someone
reports odd behaviour, ask what the chip says before debugging anything else.

**4. Every module is loaded with the build stamped into its URL, by an import map in
`pinball2/editor/index.html`.** The chip only knows about the service worker, and it was right on
the day Matt photographed a v782 chip above the bare box from hours earlier. Three separate layers
can hand back an old module - the browser's HTTP cache, the service worker's cache, and the
slow-connection latch, which serves a cached copy even on a network-first path. So `index.html`
fetches `version.json` with `cache: 'no-store'`, installs an import map rewriting every module URL
to `...js?v=<build>`, and only then appends the module script (versioned by hand, because an import
map remaps specifiers resolved inside modules and never a script tag's `src`).

**This must stay an import map; a versioned `import()` inside `editor.js` is not the same thing.**
That versions only the modules `editor.js` names. `render.js` imports `physics.js`, and `checks.js`
imports `physics.js` and `config.js`; those would resolve unversioned and could still be stale, so
the renderer and the solver could end up disagreeing about the geometry they share. **If you add a
module under `pinball2/`, add it to `MODULES` in `index.html`** - nothing fails loudly if you
forget, which is why it is on the landmine list. `test-editor.mjs`'s last case asserts on the real
network log.

---

## 4. The data model

A table is a plain object. Everything is **metres**, x to the right, **y DOWN the playfield toward
the drain**. Gravity is +y. Angles are **radians**, measured with `atan2(y, x)` in that same frame,
so a more negative angle is higher on screen.

```js
{
  name: 'TEST BOX',
  w: 0.515, h: 1.067,              // playfield size
  launch: { x: 0.452, y: 0.140 },  // where a new ball appears
  shapes: [ ... ]                  // everything else
}
```

Every shape has `id` (unique string) and `kind`. Ids are minted by `newId(prefix)` in `table.js`,
which keeps a counter that `fromJSON` advances past whatever it loaded, so a pasted file cannot
collide with a new part.

### The shape kinds

| kind | fields | what it is |
|---|---|---|
| `seg` | `a {x,y}`, `b {x,y}`, `r`, optional `e`, `mu` | a straight rail. `r` is its HALF thickness, so the drawn width is `2r`. It is a capsule: the ends are round |
| `arc` | `c {x,y}`, `radius`, `a0`, `a1`, `r` | a curved rail. A real arc, not a polyline. `radius` is the centreline, `r` the half thickness, `a0`→`a1` the span, always counter-clockwise in the maths frame. It is a solid BAND: a ball can be inside the hole or outside the ring |
| `circle` | `c {x,y}`, `r` | a post. Solid, it does not hit back |
| `bumper` | `c {x,y}`, `r`, optional `bounce` | a pop bumper. Hits back at a fixed speed |
| `sling` | `a {x,y}`, `b {x,y}`, `r`, optional `bounce` | a slingshot. A `seg` that hits back |
| `ribbon` | `pts [{x,y,z}]`, `w`, `r` | a RAMP. A lane with a centre path, a width and a height. It has NO footprint on the playfield: a ball on the floor passes underneath it |
| `flipper` | `pivot {x,y}`, `len`, `r0`, `r1`, `restAng`, `endAng`, `side` | the bat. Tapered: `r0` at the pivot, `r1` at the tip. `side` is `'L'` or `'R'` and is what the input binds to. `restAng`/`endAng` are its two stops |
| `drain` | `x`, `y`, `w`, `h` | a rectangle. A SENSOR, not a wall. A ball whose centre enters it is lost |

`e` overrides the ball's restitution for that part, `mu` its friction, `bounce` its outgoing speed.
Omit them and the config default applies. (`bounce` was called `kick` until 2026-09-11; `fromJSON`
carries the old field across so a saved override is not lost.)

**Adding a new kind is a five-place edit.** Miss one and the failure is silent:

1. `physics.js` `shapeImpact()` — how a moving ball hits it
2. `physics.js` `staticPenetration()` — how a ball found INSIDE it gets out
3. `physics.js` `isFree()` — whether a point is clear of it
4. `render.js` `draw()` — how it is drawn
5. `probes/checks.js` `distToShape()` and `surfacePoints()` — or every probe is blind to it

Plus the editor: `handlesFor`, `moveShape`, `rotateShape`, `scaleShape`, `ghostPath`, `centreOf`,
`addShape`, `PART_ICONS`, the add button row, and the property panel. And `test-editor.mjs`'s own
`centre()` helper.

`distToShape` now **throws** on an unknown kind rather than returning `Infinity`, because
`Infinity` reads as "nowhere near" and bumpers spent a whole build invisible to every check.

---

## 5. The config

`machines/testbox/config.js` holds every physical number. **Nothing physical is written anywhere
else** — if you find a bare number in `physics.js` that a player could feel, it belongs here.

`TUNABLES` is the list the Tune panel's sliders are generated from. A constant with no row there
cannot be tuned by hand; a row with no constant is a mistake.

Each `TUNABLES` row also carries `kinds`, the shape kinds it governs, which is what lets the Tune
tab show the two numbers belonging to the bumper you just tapped instead of all twenty two. **A new
tunable needs a `kinds` entry, or it only ever appears in the Show all list.** A row with no `kinds`
is table wide and belongs to no part.

**Say what the number DOES.** Matt, 2026-09-11: *"'Slingshot kick' is so vague. Say bounce."* The
vocabulary is BOUNCE for how fast a ball comes off something, GRIP for how much sideways hold a
surface has, and PUSH for a gameplay lever that adds speed no real part would add. `FLIP_KICK`,
`BUMPER_KICK` and `SLING_KICK` were all renamed then, and `cloneConfig` carries a tune saved under
the old names across rather than dropping it.

| constant | value | what it means |
|---|---|---|
| `TABLE_W`, `TABLE_H` | 0.515, 1.067 | a Williams-body playfield, in metres |
| `TILT_DEG` | 6.5 | the table's tilt. Gravity down the playfield is `G × sin(TILT)` = 1.111 m/s², about a ninth of a free fall |
| `G` | 9.81 | ordinary gravity |
| `BALL_R` | 0.0135 | a real pinball is 27 mm across |
| `BALL_E` | 0.42 | bounce off wood and plastic |
| `BALL_MU` | 0.10 | sliding friction at a contact |
| `ROLL_DECEL` | 0.035 | m/s lost per SECOND while riding a surface. Per second, never per contact |
| `REST_SPEED` | 0.055 | below this closing speed a contact slides instead of bouncing. This is what stops a ball buzzing in a corner |
| `MAX_SPEED` | 8.0 | a GAMEPLAY bound. Raising it cannot lose the ball, because impacts are solved exactly |
| `FLIP_UP_TIME` | 0.020 | seconds from rest to the top stop. 30 ms measured as a weak shot |
| `FLIP_DOWN_TIME` | 0.055 | and back down |
| `FLIP_E` | 0.55 | flipper rubber at a dead stop |
| `FLIP_E_FADE` | 0.16 | restitution lost per m/s of impact speed, the way real rubber softens |
| `FLIP_E_MIN` | 0.05 | the floor, so the rubber is never a dead wall |
| `FLIP_PUSH` | 0 | a gameplay lever, not physics: how much faster than the bat's own surface the ball leaves. Left at 0 because the real fix made it worth 1 mm in 924 |
| `FLIP_MU` | 0.28 | the rubber's grip |
| `CRADLE_DAMP` | 6.0 | velocity decay per second for a ball settling on a HELD bat that is AT ITS STOP |
| `CRADLE_MAX` | 0.6 | and only below this speed. Above it the ball is in play, not settling |
| `BUMPER_BOUNCE` | 2.6 | the speed a ball LEAVES a pop bumper at, in m/s, not a 0-to-1 ratio |
| `BUMPER_TRIP` | 0.15 | approach speed needed to fire it, so a resting ball is not a machine gun |
| `BUMPER_COOL` | 0.06 | seconds before the same bumper fires again |
| `SLING_BOUNCE` / `TRIP` / `COOL` | 3.0 / 0.25 / 0.06 | the same three for a slingshot |
| `RAMP_ENTER` / `RAMP_DRAG` / `RAMP_WALL_E` | 0.9 / 0.25 / 0.30 | speed needed at a ramp mouth, the lane's drag, and its side walls' bounce |
| `DT` | 1/240 | one solver tick |
| `MAX_EVENTS` | 64 | contacts resolved in one tick before the ball is called jammed |
| `SKIN` | 2e-5 | metres of clearance left after a contact so the same one is not re-solved |
| `FLIP_TIP_STEP` | 0.25 | how many ball radii a flipper tip may cross in one micro step |

**A bumper's bounce is an outgoing SPEED, not a bounciness.** A dead-slow roll into one comes out
just as fast, which is what a real solenoid does. Modelling it as a very bouncy wall gets it exactly
backwards.

---

## 6. The physics

### The one idea

**The ball is never inside anything, so nothing ever has to push it out.**

Every collider is a circle, a segment or a circular arc, and each has a closed-form time of first
impact against a moving point. A tick advances the ball to the exact instant it touches something,
resolves it, and continues with the time that is left. An impact is a ROOT, not a sample. That is
why tunnelling is impossible at any speed and why `MAX_SPEED` is a gameplay bound rather than a
correctness one.

### What a tick does, in order

`World.step(dt)`:

1. Resets each ball's `touched` map. See "contact episodes" below.
2. Works out how many micro steps this tick needs, from **flipper tip speed only** — never from the
   ball's speed, because the ball's motion is solved exactly. Capped at 64.
3. For each micro step, `micro(h)`:
   - advance every flipper by `h`
   - apply gravity, clamp to `MAX_SPEED`
   - **the static net**: if the ball is found inside any static collider, push it out along the
     shortest way and resolve. `World.rescues` counts it
   - **flipper contacts** (`flipperContacts`), resolved from the bat's CENTRELINE
   - **the swept advance**: repeatedly find the earliest impact in the time left, move exactly
     there, resolve, continue
   - **flipper contacts again**, because the bat is not in the swept set
   - cradle damping if the ball is settling on a held bat at its stop
   - rolling drag, charged by time
   - kill the ball if its numbers stopped being numbers (`World.broken`)
   - drain check, and the out-of-cabinet check (`World.escapes`)

### Contact episodes

A ball riding a surface touches it again every fraction of a millimetre, and **how often that
happens is a property of the solver, not of the table** — measured, 14 to 22 times per tick against
a flipper. So restitution and friction are paid **once per episode**: the first touch of a surface
in a tick is an impact and is paid in full, and every touch after it only keeps the ball out of the
surface. `b.touched` is the map that tracks it.

**If you add anything that costs the ball energy, ask what it is charged PER.** Per contact is
almost always wrong. This exact mistake has been made three times here: rolling drag, then friction
inside a micro step, then friction across a tick.

### The flipper is NOT in the swept contact set

It is resolved only by `penetration()`, which measures from the bat's centreline, so the contact
normal is "ball minus nearest point on the centreline" and can only ever point from the bat towards
the ball. The swept test could return a normal for the FAR side of the bat, and did: with the ball
measurably on top of it, a contact fired with a normal pointing straight down into it and took the
ball from 2.82 m/s to 1.16 m/s. That was the weak-flip bug. **Do not put flippers back in
`firstImpact`.**

### Ramps, and why they cannot lose a ball

A ramp is a **ribbon**: a lane with a centre path, a width, and a height. A ball on one is simulated
ALONG the lane (`s`) and ACROSS it (`q`), which is just a curved coordinate system over the same
playfield. At a mouth the two descriptions coincide exactly:

```
world position  ==  path(s) + q * perpendicular(s)
```

so getting on and off is a **change of coordinates, not a move**. The ball's x and y do not shift by
a millimetre. There is no hand-off to write and therefore none to drop a ball in, which is the whole
reason the old game's ramps could make a ball vanish.

Everything a player wants falls out of that rather than being special-cased: a weak shot climbs,
slows, stops and rolls back out of the mouth it came in; a good shot crests and runs down the far
side; the ball drifts to the low side of the lane and rides the wall; and while it is up there it
passes over everything on the playfield, because it is not in the playfield solver at all.

**Four rules a ramp must obey**, all checked by `rampProbe`, all learned by breaking them:

1. **Both ends at z = 0.** A ball leaving a mouth in mid air needs a flight model, and inventing a
   landing spot for it is exactly the teleport this design exists to avoid.
2. **No kinks, 20 degrees maximum per junction.** The lane's sideways axis turns with the path, so a
   sharp corner moves an off-centre ball by `q` times the turn, all at once. Hand-placed points
   kinked at 24 degrees and the ball jumped 6.6mm. The ramp in `table.js` is GENERATED: control
   points, a Catmull-Rom curve, resampled at about 8mm.
3. **No level RUN.** Along-lane force is the table's own slope resolved along the lane minus the
   cost of the climb, and those two CANCEL on a stretch that heads up the table while descending at
   just the wrong rate. One did, at 0.02 m/s2, and the sweep parked three balls on it. A crest is
   allowed, because a hilltop is a real balance point and a knife edge rather than a trap; 40mm of
   it is not. **The height crest sits at the top of the loop**, so past it the ramp is always
   descending AND always heading back down the table, and the two forces add instead of fighting.
4. **Getting on is a CROSSING, not a window.** Asking whether the ball is near the mouth fails for a
   fast one: at 6 m/s it covers 25mm in a tick and steps straight over. The position BEFORE the step
   is what decides it.

`ribbonStep` sub-steps by **arc length**, not time, so a fast ball cannot cross several segments of a
curve in one go and have its off-centre offset swing all at once.

### Counters, and what they mean

Every one of these is a diagnostic that should normally be zero. They are shown in the editor's HUD.

| counter | meaning |
|---|---|
| `World.jams` | a ball used its whole `MAX_EVENTS` budget in one tick. Usually a wedge |
| `World.rescues` | a ball was found INSIDE a static collider. Rare by design. If it fires, some junction has a graze worth looking at |
| `World.escapes` | a ball left the cabinet. **Always a bug, never routine** |
| `World.broken` | a ball's position or velocity stopped being a finite number |

### The one deliberate position write

A flipper swinging into a ball does move it — a driven paddle has to. Its micro step is bounded so
the overlap is at most a quarter of a ball radius, the destination is checked for legality first
(`isFree`), and **the ball takes the paddle's SURFACE velocity, never a velocity derived from the
correction distance over dt**. That derived velocity is what threw a ball from 0.4 to 10.8 m/s in a
single step on the old engine.

---

## 7. The renderer

`render.js`, canvas 2D. It draws the same shapes the solver hits, and for the flipper it calls the
solver's own decomposition (`_geom.taperedParts`), so what you see and what the ball touches cannot
drift apart.

`fitView(table, cw, ch)` builds the view; `toScreen(v, p)` and `toTable(v, p)` convert. The view has
`s` (scale), `ox`/`oy` (offset), `zoom`, `px`/`py` (pan).

`draw(ctx, table, view, state)` takes: `balls`, `ballR`, `trail`, `flipperAngles`, `grid`, `marks`,
`mask`, `hot`. `hot` is a map of shape id to true for parts that just fired, which is the flash.

It **skips a ball whose position is not finite**, because `createRadialGradient` throws on a
non-finite argument rather than drawing nothing, and that exception once killed the animation loop
permanently.

---

## 8. The editor

One file, `editor/editor.js`. Four modes, switched by the header tabs.

### The workspace (rebuilt 2026-09-11)

**A grid whose canvas row is a FIXED size.** Everything docks around it and the table never moves
or resizes when you switch modes. That is not tidiness: the canvas used to be a flex child that
grew and shrank with whatever the panel below happened to contain, so switching tabs resized it
with no window `resize` event, the view transform still described the previous height, and every
tap landed an inch from the finger. A `ResizeObserver` patches that. A fixed row means there is
nothing to patch, and `test-editor.mjs` measures the canvas box in all four modes and fails if they
ever differ (393x477@81 on a phone).

`--stage-h` is **56svh**, and svh is deliberate: `dvh` changes as a phone's URL bar slides, which
would resize the canvas on every scroll - the same bug wearing a different hat.

```
  header    title, build chip, ZOOM (- + Fit), tab strip
  stage     the canvas, fixed height, never reflows
  objbar    Undo, Redo, Snap, Duplicate, Delete - EVERY mode
  dock      #panel > #dockA + #dockB, scrolls inside its own row
```

**The dock has two halves and the tabs swap only their contents.** `#dockA` is the primary column
(palette / play controls / tune groups / check buttons) and `#dockB` the secondary (inspector /
results). A renderer just appends to `panel`, which is pointed at whichever half it is filling.

**On a phone they stack in one scroller; at `min-width: 900px` they become the left and right docks
either side of the table.** `#panel { display: contents }` drops the wrapper out of the grid so the
two halves land in it directly - same DOM, same code, two shapes. With a part selected, `#panel.sel`
gives `#dockB` `order: -1` so the inspector is above the palette on a phone; on the wide layout the
grid places both and order is moot.

**Zoom and the object controls are chrome, not panel content.** They were inside the Edit panel,
which meant undo was unreachable the moment you switched to Tune to see what a slider had done, and
the only zoom on a phone was a pinch you had to know about. `syncObjBar()` greys the whole bar in
Play, where there is nothing selected and nothing to undo.

### Play
The real engine. Hold the left or right half of the table to flip, or **Z** and **M** (or the arrow
keys) on a keyboard. **Space** drops a new ball. The panel has New ball, Slow motion, Pause and Step
frame. The HUD top-left shows ball speed, and any jams, escapes or draw errors.

### Edit
- **Tap** a part to select. **Shift/Ctrl/Cmd-tap** adds or removes. **Drag empty space** lassoes.
  **Ctrl/Cmd+A** selects everything.
- **Drag** a selected part to move it. Dragging a part that is not selected selects it alone first.
- **Handles** (yellow dots) resize and reshape: segment ends, arc centre and its two ends, flipper
  pivot and tip, drain corners.
- **Arrow keys** nudge by one grid step, **Shift+arrow** by five. **Delete**/**Backspace** deletes,
  **D** duplicates.
- **Ctrl/Cmd+Z** undo, **Ctrl/Cmd+Shift+Z** redo. 100 levels, stored as whole-table JSON snapshots.
- **The parts palette** is an icon grid (`PART_ICONS`, one inline SVG per kind) at the top of dock
  A: Wall, Arc, Post, Bumper, Sling, Flipper, Drain. Export JSON, Import and Reset table are in a
  collapsed **File** group below it, with the how-to notes in **How to**.
- Duplicate, Delete, Undo, Redo and Snap are in the **object bar**, present in every mode.
- The property panel is generated per selected kind, in **millimetres** and **degrees**, so the
  numbers are the ones you would read off a drawing.

**Hit tolerance is measured in SCREEN PIXELS** (22) and converted through the live zoom. It was
fixed in table units once, which is about 8 pixels on a phone, and a finger is not 8 pixels.

**Precision, added 2026-09-11.** At the default fit a millimetre of table is under a screen pixel
and a finger is about 9mm across, so an end handle is smaller than the finger reaching for it and
hidden under it once reached.

- **Zoom**: pinch, two fingers to pan, or the `-` / `+` / Fit cluster **in the top bar**. Zoom is about the pinch midpoint
  (`zoomAbout`), never the origin. `ZOOM_MIN` 0.5, `ZOOM_MAX` 12.
- **A second finger cancels the first finger's edit and restores it** (`cancelDragForPinch`), from
  the snapshot `pushUndo` already took. Without this a pinch leaves the part moved by however far
  the first finger travelled on its way to being joined.
- **Hold still, then drag, and the handle moves a quarter as far** (`FINE_HOLD_MS` 400,
  `FINE_RATIO` 0.25). Fine engages on the first MOVEMENT, not on a timer. The drag tracks two
  points from then on: `drag.raw` is the finger, `drag.virt` is the handle.
- **A magnifier** (`drawLoupe`, `LOUPE_MAG` 4, `LOUPE_R` 62) in whichever top corner the finger is
  not in, drawn by calling the real `draw()` into a clipped circle with its own view. It follows
  the HANDLE, not the finger, and reads the handle's position back off the shape: an arc's radius
  handle and a flipper's tip are derived, not set.
- **A wall and a slingshot have Length and Angle rows** (`lengthAndAngle`). Length holds A and
  slides B along the line; Angle holds A and swings B round it.

**Text selection is off app-wide and must stay off** (`user-select: none`, `-webkit-touch-callout:
none` in `editor/index.html`, with `input, textarea, select` exempted, plus a `contextmenu`
preventDefault on the canvas). A long press is the OS "select this text" gesture and the fine drag
begins with one, so the tool cannot have the drag without this.

**`setPointerCapture` is wrapped in try/catch and must stay that way.** It throws "no active pointer
with the given id" readily, it is the first line of `pointerdown`, and an exception there means the
tap does nothing at all, which is indistinguishable from a dead hit-testing bug.

### Tune
**The sliders are collapsible groups, one per part kind, not one flat list of 22.** `group()` and
`inGroup()` build them; the group belonging to the selected part opens itself and is outlined in the
accent colour. Copy config and Back to defaults moved to dock B, away from the sliders, so a thumb
reaching for Ramp drag cannot land on Back to defaults.

**Tap a part on the table and the panel filters to the numbers that govern it**, with the table-wide
ones (tilt, speed cap, rolling drag, rest threshold) always underneath, because they govern it too.
**Show all** puts the full list back, and tapping another part filters again. Nothing selected shows
everything, grouped by kind.

**A tap on this tab selects, it never moves.** A tap on a phone drags a few pixels and Edit's
handler turns that into a move, so sharing it would nudge the geometry every time somebody asked for
a slider, on the one tab where nobody is watching the table for changes.

Sliders are live while a ball is in play. **Copy config** puts the whole block on the clipboard for
pasting into `config.js`. **Back to defaults** restores.

### Check
**The buttons are in dock A and the report in dock B.** In one column a long result pushed the
buttons off the bottom of the screen, so you could not re-run the check you were reading.

Runs the real checks on the table as it stands and draws the results **on the table as red marks**,
not as a percentage. Find traps, Tunnel test, Gap rule, Show reachable, Clear marks. It also prints
gravity, the free-fall time against its analytic value, and how long a ball lives.

### Persistence: the table library (rebuilt 2026-09-11)

**There are two kinds of table and they are different objects. There is no guess anywhere.**

- **Default is not stored at all.** It is whatever `machines/testbox/table.js` ships in the build you
  are running, so it is current BY CONSTRUCTION. Editing it is a working copy that is written
  nowhere: leave, or take a new build, and those edits are gone exactly as if you had never saved.
  **Default means "what is actually in this build", full stop** - never "what I was last poking at".
- **The library** is `localStorage['pinball2.editor.tables']`, a dict of
  `{ name: { table, cfg, savedAt } }`. Only an explicit **Save as** writes to it. **A new build never
  touches it. Ever.** Editing a NAMED table does autosave into that name, because picking it up
  again is what naming it was for.
- `localStorage['pinball2.editor.current']` is the name last selected, absent for Default. A named
  selection is restored on the next load, because it was an explicit choice; Default is not a
  memory of anything.

**What this replaced, and why.** It was ONE autosave slot plus an `edited` flag, and on load it
guessed whether a new build's table should replace what was stored: keep an edited save, drop an
unedited one, print a grey warning line when it guessed "keep". Three builds in a row produced the
same symptom - Matt opening the tool and seeing an old table - from three different causes, and this
was the last of them. It worked as designed and the design was the problem: one slot, a guess, and
seeing a new build required noticing a line of grey text and then finding "Reset table".
`edited`, `shippedSig()`, the grey line and the compare-against-shipped logic are all **gone**, and
`test-editor.mjs` pins the replacement from both ends.

**The old key is migrated once and then left alone.** `migrateLegacy()` copies
`pinball2.editor.v1` into the library as **"My table"** on first load, sets
`pinball2.editor.migrated`, and does **not** delete the old key: it costs nothing and nobody has to
trust the migration got it right. The tool then opens on **Default**, which is the whole point.

**Controls.** The selector is in the top bar (Default first, then every saved name). Save as,
Delete, Revert, Export JSON and Import are in the **Table** group in Edit, open by default. Revert
reloads the current selection from its source: the build for Default, the library for a name.

- A table with any non-finite number is **never** written.
- A stored table with a bad number is **repaired on load**: the offending part is dropped and the
  count is shown in the HUD. A phone that stored one before the guard existed heals itself.
- `null` is rejected as hard as `NaN`. JSON has no NaN, so a stored NaN comes back as `null`, and
  `null` in arithmetic is 0 — which silently teleports a rail to the edge of the table.

### The prefab library (2026-09-11)

A pop bumper nest is five parts placed against each other and a lower third is eight. Building one
is fiddly; building the SAME one twice is worse.

`localStorage['pinball2.editor.prefabs']` is `{ name: { shapes, savedAt } }`, stored **apart from
any one table** so a prefab can be dropped on any of them.

- **Save selection...** stores the selected parts RELATIVE to an anchor, which is the **centroid of
  their own centres**. Placing therefore centres the group on the tap rather than dropping it by a
  corner nobody was thinking about.
- The offsetting both ways is `moveShape`, the same function a drag uses, so **a prefab cannot move
  differently from a drag**.
- **Place** arms it (`app.placing`) and the next tap on the table drops it. The armed branch sits
  at the top of `pointerdown`, before handles, select and lasso: while placing, a tap means one
  thing. It disarms itself on the drop, on **Escape**, on tapping Cancel, and on leaving Edit.
- **A placed prefab is NOT a group.** Each part gets a fresh `newId` and lands selected, so it is
  editable, movable and deletable one part at a time from the moment it appears. The library is a
  way of not typing, never a new kind of object for the engine to know about - nothing in
  `physics.js`, `checks.js` or the data model knows prefabs exist.

### The placements list (2026-09-11)

Every part on the table, listed by kind and id, in a **Parts (N)** group under the Inspector. Tap a
row and that part is selected and brought to the middle of the stage at 200% (`panTo(centre, 2)`).
It is the reverse of tapping the canvas, and it is the only way to reach a part that is under
another one, off the visible area, or two millimetres wide.

- **Sorted by kind, then by id numerically**, so the list does not reshuffle when a part is edited
  and two ids that differ by a digit do not sort `f10` before `f6`.
- **The row shows the same icon as the palette button that makes that kind** (`PART_ICONS`), so a
  kind is recognised without reading. A kind with no icon renders the name alone rather than a
  blank, which is what `ribbon` did until it got one.
- The group **remembers whether it is open** across re-renders (`groupOpen`), which every group now
  does. Without it, the panel re-renders on every drag frame and a list you opened shuts itself
  under your finger. A group that is open BECAUSE something is selected still wins over the
  remembered state, so Tune's tapped-part group keeps opening itself.

### The plunger (2026-09-11)

`newBall` drops a ball at `table.launch` with 0.1 m/s and lets gravity have it. That is right for a
table whose launch point sits in open play, which TEST BOX's does, and WRONG for a table with a
shooter lane: BOARDWALK's ball trickled down the right lane and drained on every single launch,
never reaching the playfield.

A table may carry **`launchV`**, a velocity. Absent means the old drop, so no existing table changes.
BOARDWALK fires up its lane at **1.65 m/s**, and that number is MEASURED THROUGH THE REAL ENGINE.

**The band is narrow and the first attempt sat miles outside it.** 3.2 m/s crested the top corner
with so much speed left that the ball skimmed the whole top rail, hugged the left rail and drained
in one second having touched no bumper, no slingshot and neither flipper. Matt, on the shipped
build: *"the ball goes up the right side, then along the top wall, and then down the left wall and
off the board. Just shoots straight out."* Every speed at or above 2.0 m/s does that; below about
1.5 it never leaves the lane. 1.65 measures 13.3 s in play across all four bumpers, a slingshot and
both flippers. The band 1.55-1.95 is CHOPPY inside itself (1.75 is a dud, 1.85 is ten seconds),
because a pinball is chaotic and a millimetre at the top corner is a different table by the bumpers.
**Re-measure after any change to the lane, arc a5 or the top rail.** A real plunger with a pull-back
meter is its own object and is still on the list.

**And the test that made this necessary was the wrong test.** It asked "did the ball reach the
playfield", which it had. The question is not where the ball got to, it is WHETHER ANYTHING
HAPPENED: `test-checks.mjs` now fails a launch that touches fewer than two things that can hit back,
or that drains inside four seconds.

**An optional field is OMITTED, never written as null.** `tableIsFinite` rejects null on purpose
(JSON has no NaN, so a NaN comes back as null, and null in arithmetic is 0), so the first version of
this - `fromJSON` setting `launchV: null` - made every save on every table fail its own guard and go
silently nowhere.

### Tables this build SHIPS (2026-09-11)

`Default` was never the only one it could be. `BUILTINS` in `editor.js` maps a name to a factory,
and every entry behaves exactly like Default and for the same reason: **never stored, so current by
construction**, editing one is a working copy written nowhere, and Save as is how you keep one under
your own name. `machines/testbox/tables/boardwalk.js` is the first.

- **They are not seeded into the library on first run.** That is the obvious alternative and it is
  the stale-table bug rebuilt from scratch: a device that seeded this build's BOARDWALK would still
  be showing you this build's BOARDWALK in December.
- **Selector values are prefixed** (`builtin:BOARDWALK`), so a built-in and a save can share a name
  without either shadowing the other, and `pinball2.editor.current` remembers which you were on.
- `app.tableName` still means "the LIBRARY save being edited, or null", which is what keeps `save()`
  from autosaving into a shipped table. `app.builtin` says WHICH shipped table when it is null.
- **`probes/run.mjs` takes `--table <name>`.** Every table this build ships has to pass the probes,
  not just the box: a built-in is code, and a file in this repo that no probe looks at is a file
  that rots.

**BOARDWALK's probe results as shipped** (`node pinball2/probes/run.mjs all --table boardwalk`,
~260 s): gaps OK (0 ambiguous, 19 deliberate overlaps), rest sweep OK (1588 drops, 0 dead stops),
escape probe OK (40,536 balls fired hard, 0 left), flipper push OK (19,484 balls, 0 left), free fall
0.1% off analytic. **Three are red and they are not the same kind of thing:**

1. **flipper power: 4 of 8 flips moved the ball under 300 mm.** Real, and it is TUNING - the bat
   angles and the config's push against this table's geometry. Matt asked to do this half himself.
2. **ramps: r42 has no shot weak enough to roll back out of its mouth, and none at all at the low
   end.** Also tuning: the mouth's entry angle and the ramp's rise.
3. **tunnel probe: 6 of 2325.** This one is most likely the PROBE, not the table. `escaped` is
   `!play.near(b.p)`, and `playable()` is a 3 mm floor flood needing `BALL_R` clearance - on lanes
   deliberately built at the gap rule's 1.15-ball edge, the band of legal ball CENTRES is about
   4 mm wide, which a 3 mm grid can miss entirely. Measured: a ball put at rest at (0.358, 0.830),
   one of the reported "OFF TABLE" endpoints, **rolls to the drain in under ten seconds**. Nothing
   is escaping. Before treating it as a table defect, fix the question: tunnelling is "inside a
   solid", and "off the table" should mean outside the table rectangle, neither of which needs the
   reachability approximation. The same mask is what `Show reachable` draws, so it is worth doing.

### Turn and scale (2026-09-11)

Handles reshape ONE part. These reshape a SELECTION, which is what the prefab library made
necessary: a bumper nest saved flat is wanted at an angle, and rebuilding it at that angle by
dragging five handles is exactly the typing the library exists to avoid.

Two controls, one mechanism (`turnSel` / `scaleSel` → `applyXform`):

- **A second row in the object bar** — `↺` `↻`, a step chip, `−` `+` — which appears only while
  there is something to turn. The chip cycles 1°/1%, 5°/5%, 15°/10%, 45°/25%: ONE chip for both,
  because coarse and fine is a state of mind rather than a per-axis setting, and a phone's bar has
  room for five buttons.
- **Exact fields in the Inspector** (`Turn by (deg)`, `Scale to (%)`) for the amounts the fixed
  steps cannot reach without counting taps. Same target, same anchor, so the two cannot disagree.

The load-bearing details:

- **The anchor is the selection's own centroid**, the same anchor a prefab is stored against. A
  prefab lands centred on the tap, so turning it about its centroid keeps it where the tap put it;
  turning about anything else walks it away from the finger every time.
- **Angles turn with positions.** An arc's `a0`/`a1` and a flipper's `restAng`/`endAng` are atan2
  in the same y-down frame as the coordinates, so one `+= ang` covers both. Move the position and
  leave the angle and the part is drawn one way and collided another.
- **Anticlockwise on screen is a NEGATIVE angle here**, because y runs down the table.
- **Scale is UNIFORM**: distances from the anchor AND every thickness by the same factor. Scaling
  positions alone looks right for one step and is wrong by the third, because the gaps move and the
  parts do not, so a cluster measured clear at 100% is a wedge at 60%. A ramp's `z` is a different
  axis and is left alone.
- **Nothing is snapped.** Snapping a turned rail to the 5 mm grid moves its two ends by different
  amounts, which does not rotate it, it BENDS it.
- **A drain turns its CENTRE and stays square to the table.** It is an axis-aligned rectangle and
  the data model has nowhere to put an angle; inventing a rotated one would be a sixth kind for
  `physics.js`, `checks.js` and every probe to learn.
- **The transform runs on a COPY and is checked before it commits.** A NaN reaching the renderer
  freezes the app, and half a transformed selection is worse than none.
- **A scale that would take any dimension below 0.5 mm is refused WHOLE**, not clamped per part:
  clamping one part of a group silently breaks the group's proportions.

**`app.placing` carries the prefab's shapes, not its name.** That is what lets an armed prefab be
turned before it lands without editing what is saved, and `armPrefab(name)` is where the working
copy is taken. The armed prefab is **drawn as a dashed outline in the middle of what you can see**
(`drawGhost`): a phone has no hover, so a preview that follows the pointer shows nothing to the
person who most needs it, and the alternative (drop it, look, turn, move it back) is the rebuilding
the library exists to avoid.

### Two things to know before editing `editor.js`

- **The animation loop is scheduled in a `finally`.** Nothing inside a frame can stop the app. Keep
  it that way: an exception escaping the callback means `requestAnimationFrame` is never called
  again and the page sits on its last painted frame for ever, looking exactly like a physics bug.
- **The canvas is watched by a `ResizeObserver`, not just `window.resize`.** It is laid out by flex
  and each tab's panel is a different height, so switching tabs resizes it with no window resize
  event at all. Without the observer, every tap is offset by exactly that difference.

`window.__pb2` exposes the whole app object (`table`, `cfg`, `world`, `view`, `sel`, `mode`) for the
browser tests to drive. The tests drive the real tool through it rather than a copy.

---

## 9. The checks

`probes/checks.js` is written once and run from **both** the editor's Check panel and the node CLI.
A check that only runs in a terminal is a check nobody runs; one that only runs in a browser cannot
gate a deploy.

**They report COORDINATES, never percentages.** A soak samples where it happens to go; the old
pinball's docs record four soaks passing a table that was unplayable in thirty seconds.

| check | what it asks | typical result |
|---|---|---|
| `drainTime` | is gravity a tilted plane? Measured on a BARE table, because gravity belongs to the config, not the content | 1.312 s against 1.311 s analytic |
| `tunnelProbe` | fire at every collider from 24 angles at the speed cap. Did anything get through? | 1212 shots, 0 |
| `flipProbe` | hold a flipper up with a ball already against the bat, over a grid. Does anything leave the machine? | 22676 balls, 0 |
| `flipPower` | place a ball on the bat, tap, and measure **how far up the table it travels**. Both flippers | 528 / 920 / 927 / 933 mm |
| `escapeProbe` | fire hard from every reachable point, every angle, flippers working. Still in the machine? | 73152 balls, 0 |
| `checkGaps` | any space between two parts that is near ONE BALL wide, which is where a ball wedges | 0 ambiguous |
| `rampProbe` | the four ramp rules above, structurally, then a ball at the mouth across the whole speed range: does it ever vanish, does its position ever JUMP further than it travelled, does a weak shot roll back out, does a strong one get all the way round | 12 shots, 0 problems |
| `restSweep` | drop a ball at rest on a grid. Did it reach the drain? | 2781 drops, 0 dead stops |

### The gap rule, and the contract inside it

`checkGaps` flags any clearance between **0.75 and 1.15 ball widths** (20.3mm to 31.1mm against a
27mm ball). Under that is SHUT, over it is OPEN, and there is no third option: design a layout so
every clearance is clearly one or the other.

It is built on `surfacePoints`, whose contract is **CENTRELINE points, never surface points**,
because `checkGaps` subtracts the shape's own radius afterwards. A circle's centreline is its
centre. Returning its surface subtracted the radius twice and made every clearance next to a post
read 9mm short and next to a bumper 25mm short - which both failed good tables AND hid real
one-ball gaps as "overlaps". Fixed 2026-09-11; `test-checks.mjs` pins it.

**A legally shut gap can still have a wedge sitting on top of it.** What holds a ball is the V
above a join, not the join. A post welded to a rail, or a rail leaning into an arc, passes the gap
rule and still parks balls - `restSweep` is the check that finds those, and it is the one to run
after moving anything.

### `playable()` underpins the sweeps, and three drafts got it wrong

It is a flood fill from the launch point over every legal ball position, and it is what tells the
playfield apart from the dead pocket behind a rail.

1. The fill ran **through the drain** and back up behind the rails, because a drain is a sensor and
   not a wall. It absorbs now.
2. A 3 mm cell rounds a legal ball position to "off table", so the escape test allows for the
   rounding and the launch test does not.
3. A cell centre can be free while the exact point is a millimetre inside a rail, so a probe tests
   **both** reachability (the mask) and legality (the exact distance).

**Every probe added since has had to relearn point 3.** The escape probe's first run reported 532
escapes and all 532 started in the dead corner behind a rail. **If you add a probe, filter its start
positions through `playable()` before you believe a word of its output.**

### Three things the rest sweep learned when the table got bumpers

- **"Still alive" is not "stuck".** A ball ricocheting between three bumpers has not reached the
  drain in six seconds and is not going to. Speed separates a trap from play, not the clock.
- **A knife edge is not a trap.** A ball balanced on a post apex or along a bat's spine is a real
  equilibrium in the maths and impossible on a real table. Every survivor is re-run with a nudge,
  and the ones that then drain are reported rather than failed.
- **A check that gives a false OK is worse than no check.** A static "is the cabinet closed" test
  was written, measured against a table a ball could demonstrably leave, found to pass it, and
  DELETED rather than shipped.

---

## 10. The landmines, in one list

1. **Never touch `pinball/`.** Different game, real player records, separate engine.
2. **Bump `CACHE` past `origin/main`, not past your working copy.**
3. **Run `validate-sw-assets.mjs` and commit `sw.js`** after any file change under `pinball2/`.
4. **A new shape kind is a five-place edit in the engine plus seven in the editor.** `distToShape`
   throws if you forget it, which is the only one that fails loudly.
5. **Do not put the flipper back in the swept contact set.**
6. **Anything that costs the ball energy must be charged per second or per contact EPISODE**, never
   per contact event.
7. **Keep the animation loop's `finally`.** Anything else can break; the loop cannot.
8. **Keep the `ResizeObserver`.** Without it, tapping is offset after every tab switch.
8a. **A new tunable needs a `kinds` entry in `TUNABLES`**, or the Tune tab only ever shows it
    under Show all. And say what it DOES: bounce, grip, push. Not kick.
8e. **Default is never written to storage, and a new build never touches the library.** Those two
    sentences are the whole persistence design. Anything that "helpfully" saves the working copy
    over Default brings back the bug three builds in a row could not shake.
8d. **Keep `user-select: none` app-wide.** The fine drag starts with a long press, which is the
    OS gesture for selecting text; without this every precise drag highlights the page.
8c. **Keep `setPointerCapture` in its try/catch.** It throws readily, it is the first line of
    `pointerdown`, and an exception there kills the whole gesture.
8b. **A new module under `pinball2/` goes in `MODULES` in `editor/index.html`**, or it is the one
    file in the graph a stale cache can still answer. Nothing fails loudly if you forget.
9. **Watch the number that matters.** Chasing the flipper bug, four separate fixes moved the ball's
   top SPEED from 1.8 to 6.4 m/s and not one moved how far it TRAVELLED. A number that will not move
   when you change its supposed cause is telling you the cause is elsewhere.
10. **Matt finds things in minutes that 76,000 automated balls miss.** Three of the four worst bugs
    here came from him playing it, not from a probe. Ship, then ask him to play it.

---

## 11. Where it stands, and what is next

**Done:** the solver, the editor, walls, arcs, posts, flippers, a drain, pop bumpers, slingshots, and
**ramps with a real second level**.
Matt's verdict on the ball and the flippers as of v779: *"It's great."*

**The plan** is `docs/PINBALL2-PLAN.md`, approved before any code was written. Step 2 (feel) and the
first half of step 3 (object types) are done.

**Next, in order:**
- the remaining object types, one at a time, each with its property panel and its own probe: drop
  targets, standup targets, a spinner, rollover lanes, a kicker or saucer
- save and load per table, then **build the first real table**. A brand new layout, designed for
  fun: *"can you create a brand new one for me? I'm not committed to the current layouts. I just
  want it to be fun."*

**Not started, and deliberately:** scoring, lamps, sound, missions, a hub entry, any stats. When a
stats id is finally added it must be a NEW one (`pinball2`), never the existing `pinball` id.
