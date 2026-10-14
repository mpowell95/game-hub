# Pinball 2 — engine and editor

THE LAW lives in the root `CLAUDE.md` and applies here. Nothing in this folder reads or writes any
player's stats yet: there is no hub `GAMES` entry, no stats id, and no recorder. When one is added
it must be a NEW id (`pinball2`), never the existing `pinball` id, whose records belong to the four
old machines and stay exactly where they are (rule 5).

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md` (append a dated section). Full original text: `CLAUDE-HISTORY.md`.

**This is a rebuild, alongside `pinball/`, not a replacement for it.** Matt, 2026-09-10, on the four
existing machines: *"none of them are even remotely playable... maybe it's better if we just start
from scratch."* `pinball/` is untouched by anything in here. Whether it is ever replaced is a
decision for after this one is judged. (Per the root `CLAUDE.md`, old Pinball was archived to `archive/pinball/` on 2026-09-28; its
`'pinball'` stats id stays in `js/game-stats.js`.)

**`pinball2/HANDOFF.md` is the complete reference** (every file, data-model field, constant, editor
control, check, and the landmines). Read it before changing anything here. THIS file holds the rules
in force; the incident log behind them is `CLAUDE-HISTORY.md`. The plan: `docs/PINBALL2-PLAN.md`.

## Where it is

Open `/pinball2/editor/` on a phone or desktop (`node server.mjs`). The editor loads the machine's own
engine, so Play in the editor IS the game. The playable table is `/pinball2/piernine/`.

## The one idea

**The ball is never inside anything, so nothing ever has to push it out.**

- Every collider is a circle, a segment or a circular arc with a closed-form time of first impact. A
  tick advances the ball to the exact instant it touches something, resolves it, carries on with the
  time left. Not a small step and a hope.
- **No code assigns a ball a position.** The only write is `p += v*t`. (Adding a ball in multiball is
  the one deliberate position write: `startMultiball` asks `world.isFree` for a spot. A `rescues`
  count that is not zero is a bug even when nothing visible goes wrong.)
- A contact under `REST_SPEED` slides instead of bouncing. Gravity is `g sin(6.5 deg)` = 1.111 m/s2.
- A ball already INSIDE a collider is invisible to both impact tests (flush rail junctions).
  `staticPenetration()` is the net; `World.rescues` counts every firing; firing at all means some
  junction has a graze worth looking at.
- **Single exception: a flipper swinging into a ball does move it.** Micro step bounded so overlap is
  at most a quarter ball radius; the ball takes the PADDLE SURFACE velocity, never a velocity derived
  from correction distance over dt (that threw a ball 0.4 to 10.8 m/s on the old engine,
  `pinball/CLAUDE.md`, "The ramps were unreachable").
- **One engine file per machine, forked, never shared.** A second machine copies `machines/testbox/`
  and edits its copy, so a shared fix cannot silently change a machine nobody was working on.

## PIER NINE, built (2026-09-13)

Matt: *"build it for testing."* `docs/PINBALL2-PIER-NINE.md` (rev C) is playable at
**`/pinball2/piernine/`**. The first GAME in this folder (not a test bed); still no hub entry, no
stats id. (Full story: CLAUDE-HISTORY.md.)

- **It is a new TABLE, not a new machine (a call).** Everything it needed from the engine is purely
  additive and inert for existing tables: `kind: 'sensor'`, `role: 'gate'` seg, a `down` flag, a
  `score` field. The "fork per machine" intent (a shared change must not silently break a machine
  nobody is working on) is discharged by proof: every probe runs against all three tables
  (TEST BOX, BOARDWALK, PIER NINE) and the others are unchanged. **If a future table needs a change
  that is NOT inert, fork then.**
- Engine additions: `sensor` (a region the ball's CENTRE crosses; not a collider, so `distToShape`,
  `checkGaps` and probes are untouched), the one-way gate in `firstImpact`, `setDown`/`rebuild`
  (raising a drop target is REFUSED while a ball stands where it would reappear), `score` on any
  shape (data only), `parks` on a table (places a ball is SUPPOSED to sit, e.g. a shooter lane;
  without it the rest sweep calls the plunger a trap).
- **A diverter is TWO RIBBONS SHARING A MOUTH, exactly one armed.** `enterRibbon` skips a ribbon whose
  `armed === false` (undefined = armed, so older tables are untouched). The choice is made at entry;
  the flap at the crest is DECOR. `rampProbe` arms one ribbon at a time.
  **Never write a hook into a doc as if it exists**: a sentence claiming `enterRibbon` skipped
  unarmed ribbons shipped before the check was written.
- Probes: `node pinball2/probes/run.mjs all --table piernine` (~5 min) and
  `node pinball2/probes/test-multiball.mjs 40 25` (~4 min). State at build: gap rule 0 ambiguous /
  18 deliberate overlaps; rest sweep 0 dead stops in 1,767 drops; escape 0 in 42,984; tunnel 0 in
  2,832; ramps 0 problems; flipper push 0 of 22,676 left; multiball soak 0 escapes/jams/NaN.
- **`flipper power` STAYS RED on PIER NINE (3 of 8 spots move the ball under 300 mm), honestly.** The
  300 mm bar was calibrated on an empty box; on a 67-part table named parts stop the short shots (own
  sling tip; posts flanking the Pier's mouth = a deliberate MISS). **Do not fix it by deleting the
  posts** (tried: broke the gap rule and ramp probe). The phase-8 robot's make rates decide.
- Layout rules the build found (each is a trap):
  - A target bank is a ramp for anything landing on it; its low end needs somewhere to go.
  - **A gate is a shelf**: angle it so a resting ball slides off, or put it where the lane is horizontal.
  - The inlane must deliver onto the BAT (dividers do not weld to the flipper pivot).
  - **A post is welded or it is a ball clear. No third option** (12 mm off a sling end = two Vs).
  - **A gate's pass test flips at the FAR FACE**, not the centreline, or it stops the plunge dead.
  - A ramp's EXIT needs clear air as much as its mouth.
  - **A post welded into a surface AT AN ANGLE is a bump, and a bump on a slope is a trap**
    (`checkGaps` calls 1.7 mm "shut", the right answer for a gap, wrong for a bump).
- **"Didn't flip the flipper once" (Matt's first real game):** every probe was green and the table was
  unplayable. Probes measure the BALL (stuck, out, through), none measured the PLAYER. Fixes: the
  top-run one-way gate was deleted (it blocked the ball's own plunge); both orbits ended in their own
  outlane, so each now ends in a **return deflector** dropping the ball inboard of the divider; and
  **a tap held the flipper for 0 frames** (press and release in one animation frame), so `game.js`
  holds a flip for a minimum of 75 ms (holding longer still holds the bat up). The two numbers to
  keep and to put in the phase-8 robot: **time until the ball is first reachable by a flipper**
  (7.4 s -> 1.5 s) and **does input change the outcome** (now 100,260 vs 19,410). Until the robot
  exists, check them by hand.
- Still not built: a gate is not tunnel-checked ("inside it" is a gate working); no stats/hub entry/
  leaderboard (after Matt judges it; NEW stats id); no robot player (phase 8), so the acceptance table
  in the blueprint is targets, not claims; no one-way gate in play on the orbit.

### The scoop holds the ball where it stopped

A saucer captures by setting velocity to zero and holding, and ejects by setting a velocity. **It
never centres the ball in the hole**: that settle would be a position write, which this engine does
not do. A real cup would funnel it; this one does not. Named, not quietly added.

## Files

| File | Role |
|---|---|
| `machines/testbox/config.js` | every tunable number, plus `TUNABLES` (the editor's Tune panel is generated from it; a constant with no row is not tunable by hand) |
| `machines/testbox/physics.js` | the swept solver. Pure, no DOM, no timers |
| `machines/testbox/table.js` | the bare box: rails, two flippers, a drain; `toJSON`/`fromJSON`, `buildRamp` |
| `machines/testbox/tables/boardwalk.js` | the physics test bed. Three red probes, on purpose (Matt's tuning; see HANDOFF.md "Tables this build SHIPS") |
| `machines/testbox/tables/piernine.js` | PIER NINE's geometry in mm, every deviation from the blueprint named in the file |
| `piernine/index.html`, `game.js`, `rules.js`, `style.css` | the playable machine; `rules.js` is the scoring spine the engine does not have |
| `machines/testbox/render.js` | canvas 2D; calls the solver's own flipper decomposition so drawn == hit |
| `editor/index.html`, `editor/editor.js` | the tool: Play, Edit, Tune, Check |
| `probes/checks.js` | the checks, written ONCE, run from the editor and node |
| `probes/run.mjs` | `node pinball2/probes/run.mjs [drain\|tunnel\|flip\|power\|escape\|gaps\|rests\|ramps\|all] [--table X]` (~2.5 min for all). **Unknown names exit 2** (it once printed "all checks passed" having run nothing). A file no probe looks at rots, so every shipped table is probed |
| `probes/test-multiball.mjs` | the 3-ball soak; the only probe with more than one ball. A soak is a sample (stated in its output); it varies plunge and robot phase because the engine is deterministic |
| `probes/test-checks.mjs` | pins the checks against gaps/launches known by construction, from both sides |
| `probes/test-editor.mjs` | does the TOOL work (touch accuracy after tab switch, NaN freeze, import-map network log, canvas box identical in all modes, tap floor on every control incl. small phone + landscape, user-select computed style, tap-with-drift on Tune). Needs `node server.mjs`; SKIPs without Chromium |
| `HANDOFF.md` | the complete reference |

## The checks report places

`probes/checks.js` reports COORDINATES, never a percentage (a soak samples where it happens to go).

- **`restSweep`**: ball at rest on every grid point; did it reach the drain? A dead stop REQUIRES a
  holder (gravity is constant 1.111 m/s2, so a ball held by no solid and on no ramp cannot be at
  rest; arc-apex balls are not traps). Speed, not the clock, separates a trap from play (bumpers);
  survivors are re-run with a nudge and "knife edge" ones reported, not failed.
- **`tunnelProbe`**: every collider from 24 angles at the speed cap.
- **`escapeProbe`**: hard from every reachable point at every angle with flippers working, still in
  the machine 2 s later. **The one that matters most.** A static "is the cabinet closed" check was
  written, gave a false OK, and was DELETED: a check that says OK about a table a ball can leave is
  worse than no check.
- **`flipProbe`** / **`flipPower`** (measures TRAVEL, both flippers). **`checkGaps`** flags gaps near
  ONE BALL wide; overlaps are a note, not a failure (an overlap SHUTS a gap). A gap must be clearly
  shut or clearly open.
- **`playable()` underpins both sweeps**: flood fill from the launch point over legal positions. The
  drain ABSORBS (a drain is a sensor, not a wall); a 3 mm cell rounds legal positions off-table so
  escape allows for it and launch does not; **test BOTH reachability (mask) and legality (exact
  distance)**. **Any new probe must filter its start positions through `playable()`** before its
  output is believed (first escape run: 532 "escapes", all from the dead corner (14, 14) mm).
- Bare-box numbers (2026-09-10): free fall 1.312 s vs 1.311 analytic; tunnel 0 of 883; flipper push 0
  of 22,220; escape 0 of 76,392; rest sweep 0 of 2,913. "About three seconds to drain" is NOT the
  gravity test; assert against the analytic `sqrt(2h/g sin tilt)`.
- **`surfacePoints` returns a shape's CENTRELINE** (callers subtract this shape's radius once); for a
  circle it once returned the surface, so every clearance next to a post read 9 mm short and next
  to a bumper 25 mm short, and real one-ball wedges there went unflagged. Pinned by `test-checks.mjs`.
  A measurement that disagrees with the design is not automatically the design's fault.
- **A new shape kind is INVISIBLE to every probe until `distToShape` is taught it**; it THROWS on an
  unknown kind now (the editor's hit testing uses the same function).
- **Gravity is a property of the config, not the table**: the free-fall check builds a bare table.

## Rules learned the hard way (all in force)

- **A frozen frame and a stuck ball look identical; the tell is the geometry.** A ball at rest
  touching nothing is a frozen frame, not physics. Chain was: empty number field -> `parseFloat('')`
  NaN -> geometry -> `createRadialGradient` throws -> exception out of the rAF callback -> rAF never
  rescheduled -> autosave had written it. Four fixes, all required: **the loop is scheduled in a
  `finally`** (the app must keep running and say what happened); **a field cannot inject a non-number**
  (empty/non-numeric restores the previous value); **the autosave is never written with a bad number
  and a stored table is repaired on load; `null` is rejected as hard as `NaN`** (JSON has no NaN, null
  in arithmetic is 0); the solver kills a ball whose numbers stop being numbers (`World.broken`) and
  the renderer skips it.
- **Never charge energy loss PER CONTACT.** A ball riding a surface touches it 14-22 times a tick.
  A **contact EPISODE**: the first touch of a surface in a tick is an impact paid in full; every
  touch after only keeps the ball out (no restitution, no friction). Both paths that can resolve a
  flipper contact share the map. (Third time this bug appeared: rolling drag, friction in a micro
  step, friction across a tick. Ask what anything costing the ball energy is charged PER.)
- **The flipper is NOT swept against.** A swept contact can return a normal from the FAR side of the
  bat. The flipper is resolved only through `penetration()` (measured from the bat's CENTRELINE, so
  the normal can only point from bat to ball), before and after each micro step's advance. **Watch
  the number a player feels (how far the ball TRAVELS after one flip), not top speed**; a number that
  will not move when you change its supposed cause means the cause is elsewhere. `flipPower` is the
  tripwire.
- **Build chip / stale builds.** `DEV_FRESH` in `sw.js` excludes `./pinball2/` from the cache-first set,
  so this tool is network-first (cache as offline fallback); `test-sw-strategy.mjs` asserts both
  halves, and the released `pinball/` stays cache-first. The editor header chip compares the worker's
  cache version to `version.json` (`v777 -> v778`; tap updates). **`pinball2/editor/index.html`
  fetches `version.json` (`cache: 'no-store'`), installs an IMPORT MAP stamping `?v=<build>` onto every
  module in the graph, then appends the module script (itself versioned)**. It has to be the import
  map, not `import('...?v=')` inside `editor.js`, or transitive imports (`render.js` -> `physics.js`)
  could be a MIXED build. Offline: fetch fails, no map, loads from cache; a 4 s timer starts the
  unversioned load. `test-editor.mjs` asserts on the NETWORK LOG. The corner of the screen lists what
  is on the table. (The chip reads the worker's version only; it cannot see which module copy loaded.)
- **A launch is an OUTCOME, not a position.** `table.launchV` (velocity; absent = the old drop, so
  nothing existing changes). `test-checks.mjs` fails a launch that touches fewer than two things that
  can hit back, or drains inside four seconds. BOARDWALK's band is 1.55-1.95 m/s (1.65 = 13.3 s of
  play); at or above 2.0 is the highway to the left drain. **An optional field is omitted, never
  nulled** (`fromJSON` writing `launchV: null` made `tableIsFinite` reject every save).
- **A built-in table is code, not a file on a phone.** BOARDWALK ships in `BUILTINS`, never stored
  (seeding it into the library rebuilds the stale-table bug); selector values are prefixed
  (`builtin:BOARDWALK`). **`validate-sw-assets.mjs`'s `SCAN_DIRS` now includes `pinball2`**; keep it
  there (it was blind to this folder).
- **The ramp tool** lays CONTROL POINTS and generates the rest through `buildRamp` in `table.js`, the
  SAME function the shipped table calls (so editor and table cannot drift). Resampling is by
  distance, not a fixed 8 points. A ramp's handles are its control points (older ramps with none keep
  the old behaviour; never invent some). **The ramp probe runs inside the app**, because a check that
  lives only in a terminal never runs.
- **Turn and scale a selection:** a dashed ghost (`drawGhost`/`ghostPath`) shows the pending angle
  before landing. **`app.placing` carries the prefab's SHAPES, not its name** (turning the dropped
  copy must not touch the library copy). **Anticlockwise on screen is a negative angle** (y runs
  down; stored angles `a0`/`a1`, `restAng`/`endAng` are atan2 in that frame, one `+= ang` turns
  geometry and spans together). **Scale is uniform, thicknesses included.**
- **`renderPanel()` runs every edit frame:** state that lives in the DOM (a `<details>` open state)
  must be carried back out of the DOM: module-level `groupOpen` Map keyed on title, written on
  `toggle`. A group open because something is SELECTED still overrides it (Tune opens the tapped
  part's group). Scroll position is the next one waiting to happen.
- **Prefabs exist only in editor storage.** Placing one runs `newId` per part and pushes ordinary
  shapes; nothing in `physics.js`, `checks.js` or the data model knows prefabs exist. Anchor is the
  centroid of the selection's centres; offsetting uses `moveShape`, same as a drag.
- **Table library:** Default is NOT stored (it is whatever `table.js` ships); the library is every
  table explicitly named and saved; a new build never touches it. No `edited` flag, no guessing.
  The old one-slot key was migrated once into "My table" and **left where it is** (not deleted).
- **Workspace:** the canvas is a FIXED grid row (a flex child that resizes on tab switch fires no
  `resize` and put taps an inch off). `--stage-h: 56svh`, not `dvh` (URL bar). One dock on a phone;
  at `min-width: 900px` the two halves become left/right docks (`#panel { display: contents }`).
  Zoom and object controls are chrome, not panel. Tune's sliders are collapsible groups, the selected
  part's group outlined. **Nothing was dropped (a test walks all four modes).** Any canvas in a flex
  layout needs a `ResizeObserver`; hit tolerance is 22 SCREEN pixels converted through live zoom.
- **Phones: a finger covers the thing it places.** Pinch zoom about the MIDPOINT, two-finger pan,
  `-`/`+`/Fit row. **A second finger cancels the first finger's edit and restores it** (from the
  `pushUndo` snapshot). Hold still then drag = fine mode, handle moves a QUARTER as far (`FINE_HOLD_MS`
  400, `FINE_RATIO` 0.25; engages on first movement, tracked as `drag.raw`/`drag.virt`). Magnifier at
  4x with the real renderer in the top corner the finger is NOT in, following the HANDLE. A wall or
  sling has Length (holds A, slides B) and Angle (holds A, swings B) rows. **`user-select: none` and
  `-webkit-touch-callout: none` app-wide** (inputs excepted) plus `contextmenu` preventDefault on the
  canvas; **any new hold-still gesture needs this checked**. **`setPointerCapture` is in a try/catch
  on purpose** (it throws, and that kills the whole tap).
- **Vocabulary:** BOUNCE (outgoing speed off a part), GRIP (sideways hold), PUSH (a gameplay lever
  adding speed no real part would). `SLING_KICK`->`SLING_BOUNCE`, `BUMPER_KICK`->`BUMPER_BOUNCE`,
  `FLIP_KICK`->`FLIP_PUSH`, bumper `kick`->`bounce`. **A rename must not drop a dialled-in number**
  (`cloneConfig` and `fromJSON` carry old keys). Each `TUNABLES` row names the shape kinds it governs;
  Tune filters to the tapped part (Show all is one tap). **A tap on Tune selects and never moves**
  (tested with six pixels of drift). The HUD wraps.
- **Bumpers/slingshots** are a fixed OUTGOING SPEED along the contact normal (not restitution), with a
  minimum approach speed and a cooldown. **The slingshot IS the feed rail** (a separate rail made
  dead pockets). Feed rails stop well short of flipper pivots; outer rails reach the bottom corners.
- **Ramps (second level):** a ball on a ramp is simulated along and across the lane; a mouth is a
  change of coordinates, never a move; there is no hand-off to lose a ball in (`HANDOFF.md`, "Ramps,
  and why they cannot lose a ball"). Probe jump assertion compares against the fastest speed during
  the tick. Behaviour: <1 m/s cannot get on, 1-1.5 rolls back out, 2+ makes it round.
- **Editor redesign (2026-09-12, "Unusable. It's bad.")**: quiet chrome (hairlines, ONE accent for the
  current thing; `button.primary` is not a filled slab); the tool rail lives in the dead gutter; the
  dock is a draggable sheet with a shut detent. **The object bar must not grow a row mid-edit; `#work`
  needs an explicit grid row (a layout measured at one size is not measured); a phone in landscape
  takes the four-column layout at `(min-width: 600px) and (max-height: 560px)`.** Checks run as a
  generator per slow check with the plain exported function draining it (**one implementation, two
  entry points**; verified identical: 2781 drops, 956 shots, 73152 escapes). `test-editor.mjs`
  measures every control in all modes on 393x852, a small phone and landscape; **fail on a single
  34 px button** (44 px floor, `docs/BUILDING-A-GAME.md` Part 0). Density comes from removing rows
  and quietening fills, never from shrinking controls.

## Open items

- BOARDWALK is Matt's to tune: three probes red on it (flippers move the ball under 300 mm on half
  the power range; r42's mouth takes no shot weak enough to roll back out; tunnel probe's 6 of 2325
  "OFF TABLE" most likely the probe, see `HANDOFF.md`).
- Remaining object types, one at a time with panel + probe: drop targets, spinner, rollover lanes,
  kicker/saucer, plunger (some exist on PIER NINE as sensors).
- Two levels are real geometry (a ramp is a ribbon with floor height and slope), never a transition.
- The editor overhaul is finished (2026-09-11, five steps); what is left is the GAME, not the tool.
- Robot player (phase 8); stats/hub entry only after Matt judges it, with a NEW id.
