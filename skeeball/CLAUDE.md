# Skeeball — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below
> overrides them. This game's specific obligations are under "Persistence and THE LAW" — read
> that before touching anything that stores or records.

**`skeeball/DECISIONS.md`** carries the full tuning history (measurements, rejected approaches,
what broke and why) that used to live as narrative comments in `skeeball/js/*.js`. The source
files now keep only guards and short present-tense notes; a `// See DECISIONS.md#anchor` comment
points to the full story. Read it before touching physics, geometry, or the swipe/power curve.

## HARD RULE: never change the width of a basket

Matt, 2026-08-24, after a plan proposed resizing HOT SHOT's mouths to get a look he asked for:

> **"NEVER CHANGE THE WIDTH OR DIAMETER OF A BASKET UNLESS I SPECIFICALLY TELL YOU TO."**

A basket's `r` in `js/boards.js` - and so its mouth diameter - is HIS number on every machine. Not
a default, not a starting point, not something to re-derive from a proportion, and not something
to trade away because a sweep comes out nicer without it. **If a change would move a mouth and he
has not asked for that mouth to move, the change is wrong.** Find another way, or go back and ask.

Depth, position, colour and paint are ordinary work. The WIDTH is not.

Two things that led to this, both worth not repeating:

- **Do not invent a rule and then quote it back at him.** He asked for taller baskets; the reply
  turned that into a "depth-to-mouth ratio" he had never mentioned and wrote it up as a spec. His
  answer: *"You wrote that rule. You invented that rule. I did not tell you to, nor will I respect
  it."* A measurement recorded by an earlier session is data. It is not a constraint on what he is
  allowed to ask for.
- **Measure the two things before explaining the difference between them.** The gap Matt was
  pointing at between BRICK CITY and HOT SHOT was DEPTH and only depth - the mouths were never
  the question. Reading the nine numbers out of `boards.js` first would have got there in one
  step instead of through a rule nobody asked for.

## HARD RULE: every machine owns its own engine

Matt, 2026-08-23, on learning that one `physics.js` served all three machines: *"It's absolutely
insane you've been editing 1 file for different games and silently changing other machines."*
He is right, and it cost him the release.

**Each machine has its OWN copy of `physics.js`, `machine.js` and `render.js`,** under
`skeeball/js/machines/<board-id>/`. There is no shared engine. `skeeball/js/engines.js` maps a
board id to its three files and is the only thing that knows they exist.

```
skeeball/js/
  boards.js  game.js  goals.js  ui.js  swipe.js  strings.js   <- all machines
  engines.js                                                  <- board id -> its engine
  machines/classic/     physics.js  machine.js  render.js
  machines/popongo/     physics.js  machine.js  render.js
  machines/basketball/  physics.js  machine.js  render.js
  machines/brickcity/   physics.js  machine.js  render.js
```

**Editing `machines/popongo/physics.js` cannot affect THE CLASSIC, because the classic never
loads that file.** The isolation is the filesystem. There is no flag to set, no gate to remember
and no test you have to run first.

### Why it is built this way

Until 2026-08-23 all three ran one `physics.js`, one `machine.js` and one `render.js` - 2,330
lines - with per-machine behaviour written as branches (`cupBoard`, `collarH`, `cups`). Every
branch was somewhere a change for one machine could reach another, and one of them shipped:
`28299ac`, written for HOT SHOT, rewrote the capture rule "on every machine" and moved **456
of 861** throws on THE CLASSIC, dropping a fixed 861-throw grid from 12,240 points to 6,870. THE
CLASSIC went live 2026-08-22 01:21 and played differently by that afternoon with its own
`boards.js` entry untouched, so nothing in the per-machine data could explain it. Matt pulled the
game from the hub over it.

The fix that night (`24ba484`) gated that one rule on `st.cupBoard`. **Gating is not the answer
and was never going to be** - it works only for the branches somebody remembers to write.
Separate files are the answer.

### The cost, accepted deliberately

A genuine engine bug is now fixed once per machine that has it, and the copies drift. **The drift
is the point** - these are different machines. When you fix something real, say in the commit
which machines you applied it to and which you deliberately did not.

### Adding a machine

1. `cp -r skeeball/js/machines/classic skeeball/js/machines/<id>` - every machine starts as a copy
   of THE CLASSIC, then diverges freely.
2. Add one row to `skeeball/js/engines.js`.
3. Add the three files to `sw.js`'s `ASSETS` and bump `CACHE`.
4. Add the `boards.js` entry.

Nothing else changes, and nothing you do inside your folder can reach another machine.

### Still true, and still worth doing

`boards.js`, `game.js`, `goals.js` and `ui.js` ARE shared across machines - they are the registry,
the rules of a rack, the objectives and the shell, not the machine. A change there does reach every
machine. Before committing one, simulate a fixed grid (41 powers x 21 aims) on each machine before
and after and diff the outcomes; a machine you did not mean to touch must come back identical.

A realistic arcade skeeball alley, rebuilt **from scratch on 2026-08-13** (nothing of the
previous build — layout, art, physics, structure — was carried over or consulted). The previous
build was kept alongside it in the hub as **Skeeball_old** (`skeeball_old/`, hub id
`skeeball-old`) for side-by-side comparison while this machine was tuned, and **removed
2026-08-18 at Matt's ask** once the comparison was done (it is in git history). It recorded into
the SHARED `skeeball` stats id and used the same board id `classic`, so every rack it ever played
is still in this game's own records (bests, the daily map, the top-score panel) — one continuous
bucket, nothing orphaned by its removal. Four machines exist: **THE CLASSIC** (a
boardwalk cabinet with a varnished oak lane, the burnt-orange board with the white cup ladder,
twin corner 100 cups, and a marquee), **POPONGO** (2026-08-22, the real cup-board lawn game as
a second face on the same cabinet - see "POPONGO and the arrangement layer" below),
**HOT SHOT** (2026-08-22, the arcade basketball machine as a third face - see "HOT SHOT"
below), and **HOT SHOT: BRICK CITY** (2026-08-24, board id `brickcity`, HOT SHOT's sibling: the
same cabinet and ramp, a brick marquee, and a face whose bottom row TAKES points - **its own
documentation is `skeeball/MACHINE-BRICKCITY.md`**, and nothing about it is written up here). The
player swipes up the lane; the swipe's speed is the roll's power and its angle is the aim. Nine balls to
a rack.

**The board was rebuilt to the REAL classic layout on 2026-08-13** against reference photos Matt
provided, after the first version shipped a wrong "bullseye" board invented from memory — the
exact failure `VISUAL-PROCESS.md` exists to prevent (look at the picture before you write code;
if there is no picture, ask for one). That rule was read and skipped anyway; do not repeat this.
The photos and researched behavior now live in this file and in `boards.js`'s `scoring` comment.

**ADMIN ONLY AGAIN since 2026-08-23** (Matt's ask), exactly like Pinball: the hub entry carries
`devOnly: true` and no `released` date. It WAS released 2026-08-22 and pulled back the next day,
after work done for POPONGO and HOT SHOT turned out to be landing in the shared engine and
changing how THE CLASSIC plays - see "work on one machine, change one machine" above.

Re-releasing is four edits, and three of them are what stop the release being silently broken:
drop `devOnly` in `js/hub.js`, add a FRESH `released` date there (the only input to the launcher's
New pill - the old date is gone on purpose so the pill announces the real day), put the
`GAME_META` row back in `js/leaderboard-ui.js`, and take `skeeball` back out of
`players-agg.test.mjs`'s `OFF_THE_BOARD`. Miss the row and every Skeeball win counts as ZERO
while My Stats still shows it, which is how Yahtzee shipped.

Unlike Pinball, the stats id already has REAL family history (the game was live for a couple of
hours on 2026-08-11 under the previous build), which drives every storage decision below.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../skeeball/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `skeeball` |
| Stats id | `skeeball` (recorder `recordSkeeball`, sub-counter `sk`) — **pre-existing, frozen** |
| CSS root / prefix | `.sk-root` / `.sk-` |
| Settings key | `gamehub.skeeball.v1` (one preference: the selected machine) |
| Save key | `gamehub.skeeball.save.v1` (the mid-rack snapshot) |
| Difficulty axis | none — `byDiff` is keyed by BOARD ID (Hill Climb's stages-as-the-axis precedent) |
| `isInProgress()` | the **autosave/resume** meaning: always `false`; see below |

`isInProgress()` returns `false` even mid-rack (Escoba's class of the contract, not Ball Run's):
the between-throws state is the stable state of skeeball, `ui.js` snapshots it to
`gamehub.skeeball.save.v1` after **every settled ball**. While a snapshot is banked the setup
screen offers BOTH actions: "Resume rack · N/9" (primary) AND "New game" (ghost) — never only
one. New game discards the snapshot (`clearSave()` before `_startGame(null)`): the snapshot is a
resume convenience, not earned history, and the player pressed the button that says so with
Resume sitting directly above it (Matt, 2026-08-13: a save must never trap the player into
resuming). A ball actually in flight resolves in under two seconds and is deliberately not part
of the saved state — the throw a player abandons mid-air was theirs to abandon, and the ball is
only spent when it settles, so resuming re-serves it.

`immersive: true`: `.sk-root` is `position: fixed; inset: 0` at `z-index: 1` (Pinball's shape),
so the hub's floating back button rides on top; `.sk-hud` carries `padding-left: 76px` and the
gallery `padding-top: 84px` to clear it.

## Files

| File | Role |
|---|---|
| `js/vendor/` | **vendored battle-tested libraries** (2026-08-13, Matt's explicit instruction - see below): `cannon-es.js` (rigid-body physics, ESM), `three.module.min.js` + `three.core.min.js` (renderer). Committed files, no build step, no network fetch. Never hand-edit them |
| `js/machines/<id>/machine.js` | **one per machine.** That machine's GEOMETRY, once, in metres: every floor, wall, band segment and collar as data. physics.js builds cannon bodies from it and render.js builds three meshes from it, so the wall you see IS the wall the ball hits |
| `js/engines.js` | board id -> that machine's own `{ physics, buildMachine, Renderer }`. The ONLY file that knows the engine folders exist; see the HARD RULE above. **Loads them ON DEMAND since 2026-09-01** (`loadEngine(id, { physics })`); `engineFor(id)` stays synchronous for the hot paths and THROWS if that machine has not been loaded - see "What tapping Skeeball used to cost" below |
| `js/boards.js` | the machine registry: identity, look tokens, the `geom` block (sizes, angles, launch speeds, hole layout), unlock chain. Pure |
| `js/machines/<id>/physics.js` | **one per machine.** The ball, simulated by cannon-es: materials/contact tuning, speed-aware hole capture, trough scoring, the watchdog (NO magnetism - see below). Deterministic, no rng |
| `js/game.js` | the rules of a rack: nine balls, scoring, the event stream, snapshot/restore, the recorder payload. Pure |
| `js/machines/<id>/render.js` | **one per machine.** That machine on screen, drawn by three.js: scene from machine.js + cosmetic dressing, lights/shadows, painted textures, ball mesh synced from the physics body |
| `js/howto.js` | the How To Play sheet content (repo pattern, `docs/BUILDING-A-GAME.md`) |
| `js/strings.js` | the EN/ES dictionary |
| `js/ui.js` | DOM shell, the swipe, storage, records panel, the hub module contract |
| `js/test.js` | headless engine tests incl. the reachability sweep and the soak (wired into `run-all-tests.mjs`) |

Every `machines/<id>/machine.js` and `physics.js`, plus `boards.js` and `game.js`, are DOM-free and that is load-bearing:
`node skeeball/js/test.js` plays hundreds of throws in node (cannon-es runs fine there), and the
same determinism is why the tuning is testable at all.

## The vendored engines (the one "no dependencies" exception, and why)

Matt, 2026-08-13, after three rounds of hand-rolled physics kept failing his eye test and he was
told the good apps are built on general-purpose physics engines: *"Why didn't we use that from
the start??? Use ALL AVAILABLE resources like this. 'battle-tested' codes and scripts... are way
better and preferred by a TON over anything you build directly. Go - vendor cannon-es and
rebuild it on that... If any other things like this cannon-es thing exist - FIND AND USE IT."*

So `skeeball/js/vendor/` holds cannon-es 0.20.0 and three.js r185 as committed ES-module files.
This honors the repo's real constraints (static files, no build step, works offline - the three
files are in `sw.js`'s ASSETS) while bending the letter of "no dependencies" on Matt's explicit
instruction. The lesson generalizes: for solved hard problems (physics, 3D rendering), vendor
the proven library instead of imitating its output by hand. Do NOT hand-patch vendor files; to
upgrade, `npm pack <name>` and copy the dist build over.

## The setup screen and How To Play (rebuilt 2026-08-13 to the repo patterns)

The first versions of both were designed from scratch and Matt threw them out ("start the design
over" / "throw out 100% of it"). The rebuilds follow the documented references EXACTLY; a future
redesign starts from those documents, not from taste:

- **Setup** follows Escoba's page order (`escoba/js/ui.js`, the repo's setup reference): title →
  Resume button if a save exists → one stats line (Best · Today · Top · Last) → the settings card
  as a collapsed `.gh-acc` accordion row ("Machine / THE CLASSIC"; open it to pick a machine,
  each unlocked machine a card with its four records) → the How-to-play text link → ONE primary
  action (Play, or New game as a ghost when Resume is the primary). Built on `css/ui.css`'s
  `.gh-*` primitives (`ui.js` injects `css/ui.css` idempotently before its own sheet, the same
  marker `bug-report-ui.js` uses) — the accordion is `.gh-acc`, the buttons are `.gh-btn`; only
  the skeeball-specific bits (`.sk-statline`, `.sk-mrow`, `.sk-howto-link`) are local CSS.
- **How To Play** follows `docs/BUILDING-A-GAME.md`'s five-part pattern, restated in `howto.js`'s
  header: one bold goal line, ONE diagram of the one non-obvious mechanic (swipe strength =
  landing height, drawn as a side view with three numbered arcs), a caption, an X = Y example
  ("Half strength = the 50 cup"), then the edge cases one sentence each. Every text line is
  measured and shrunk to fit ONE row before nowrap locks it (`_fitHelpLines` in `ui.js`); the
  arcs are told apart by dash pattern AND numbered markers, never colour alone.

## The machine and its physics (cannon-es since 2026-08-13)

The hand-rolled collision model went through two full rebuilds (decided-at-contact → emergent
face simulation) and still failed Matt's eye test: *"you can clearly tell it's being told to
react a certain way."* It was replaced wholesale by cannon-es (see "The vendored engines"), and
nothing scripts a reaction any more:

- **The machine is real geometry** (`machine.js`): lane, hump quarter-pipe (launch angle IS the
  last segment's angle), trough, tilted board slab (45 degrees), ring band and cup collars as
  flush box-segment polygons, rails, tall backboard, the wire cage over the board, the front
  glass, a kick panel under the lip. The ball is a rigid sphere with mass and spin; rolling,
  hops, rim rattles and backboard reactions all come out of the contact solver.
- **The feel lives in exactly two places**: `boards.js`'s `geom` block (shapes, sizes, angles,
  launch speed range) and the four ContactMaterials at the top of `physics.js` (friction and
  restitution per surface pair - wood, board, slick steel walls, dead backboard/cage).
- **Hole capture is the one non-engine rule**, and it is what a hole IS: when the ball's centre
  is over an opening at face level AND IT IS SLOW ENOUGH TO DROP IN, its collision mask drops the
  board slab and GRAVITY takes it through the mouth. No teleport, no canned sink. The speed test
  (added 2026-08-14) is pure kinematics: in the time the ball takes to cross the mouth, does it
  fall far enough to be past the lip? Its own inward velocity counts, so a ball dropping into a
  cup goes in even at speed while a fast roll skims across and carries on UNCHANGED - not
  deflected, not slowed, not steered. That single test is what makes distance up the slope choose
  the cup, which is the whole game. Without it the first mouth a rolling ball crossed always
  swallowed it, so nothing above the bottom cup was reachable by rolling at all.
- **CAPTURE IS A PREDICTION; ONLY PASSING THROUGH THE PLANE SCORES** (2026-08-22, on every
  machine). Matt's clip showed HOT SHOT paying a ball that rattled a rim and bounced out:
  the collar walls stay solid after capture, so the ball can strike the far wall inside the
  mouth and climb back out - and the old commit rule ("fell 26cm below the capture point")
  scored it anyway, because with the floor slab intangible it always ends up below. Now the
  captured block in `physics.js` commits ONLY when the ball is below the surface plane INSIDE
  the mouth; a ball that gets clear of the slab outside the mouth has the floor restored
  (`rimout` event) and plays on, and one that slips under the slab outside the mouth resolves
  as a 0. Points are only ever awarded for a ball that fully passes through a hole.
- **The trough scores like the real bottom slot**: centre band = 10, corners = 0. A dead lob
  rolls into the 10, exactly like the real machine; the honest zero is the corner.
- **NO MAGNETISM, EVER. This is a standing, permanent ban.** Balls never curve toward holes, are
  never corrected and are never assisted; a ball goes where it was thrown. A "dish" used to live
  in `physics.js` section 5 - a constant pull toward the 20's mouth for slow balls inside the
  ring, justified as modelling a real dished bowl - and it was deleted on 2026-08-14 because it
  was exactly that: a ball being steered into a hole it was not thrown at. A ball that runs out
  of speed on the slope now does the honest thing, rolls back down and feeds the 10. **If a power
  band needs widening, widen it in the GEOMETRY.** The input side (how a swipe becomes a power and
  an aim, in `ui.js`) is a different thing and is fair game; the ball, once thrown, is not.
- **The 100s are corner holes reached by AIMING**, never by a straight ball: full power plus a
  hard sideways fling (aim >= ~0.9 at power >= 0.70; 18 of 189 cells in the aim x power grid).
  Miss the angle and the ball is gone for 0 or 10 - that risk is what stops "slam it straight"
  from being the whole game, since a straight slam reliably banks the 50.
- **The spacing rule** (in `boards.js`, learned twice): every gap between two pieces of
  furniture is either MERGED or wider than a ball plus margin. An in-between gap is a pocket,
  and a three-contact pocket LOCKS the cannon solver completely - velocity writes get solved
  back to zero. Check every neighbour pair before moving any cup.
- **The watchdog** (displacement-anchored, never speed): a parked ball gets two small nudges. A
  ball those two nudges cannot move is jammed - three contact normals can lock the solver
  completely. **A jammed ball scores ZERO and is gone** (Matt, 2026-08-22). It is never walked,
  steered or nudged toward a cup: THE CLASSIC used to slide it into the nearest mouth and pay for
  it, which is a score for touching a cup rather than falling through one. Both machines now
  resolve a jam the same way, so there is no per-board branch. The 12s cap should be unreachable;
  the tests keep the whole emergency path under 2% of the sweep.

Deterministic: fixed 1/240 step, fixed solver iterations, naive broadphase (stable pair order),
no rng anywhere. One fresh world per throw, so nothing leaks between balls. Retune freely, but
run `node skeeball/js/test.js` first - the sweep pins reachability of every hole, the rollback,
the straight-power ladder (30 → 40 → 50), **no dead zone at either end of the dial**, **few flips
between adjacent power steps**, **the 100 needing power AND aim (and costing the ball when the
angle is missed)**, real bounce events, and the emergency path staying rare. Pass `--auto` or a
group flag — a plain run skips every one of those (see Testing). `tune-ladder.mjs` and
`measure-reach.mjs` at the repo root are the bench tools those numbers came from; run
`tune-ladder.mjs` after touching anything in `geom`.

The renderer (`render.js`, three.js) builds its scene from the SAME `machine.js` description,
plus paint. Reduced motion drops popup rise and particles, never the ball.

## The 2026-08-14 rebuild: the camera, the throw, the cups, the trajectory

A play review drove the shipped build through a real browser with real touch and measured four
things that no static check could see. Each fix below is a rule now.

### The camera stands BEHIND the ball

It used to sit at z = -0.34, which is past the serve spot at z = -0.12 - the camera was in front
of the ball. Measured: the ball waiting to be thrown projected to **y = -3875px on a 773px
canvas**, i.e. nowhere near the screen, and stayed off screen for the **first 250ms of every
throw**. Most of the lane was behind the viewer too, so the bottom 187px (22%) of the screen -
the part the player is told to swipe on - was a featureless brown field.

The camera is now at (0, 0.42, 0.62) looking down the lane, and `resize()` derives the FOV from
**the two points that must always be visible** (the resting ball, and the top of the marquee),
widening only if the board would be cut off sideways. Never go back to fitting the board's width
alone: on a tall phone that produces a vertical field too narrow to hold the thing at the near
end of it. Measured after: ball on screen at rest and for **0 of 70 flight frames off screen**;
featureless bottom band **27px (3%)**.

### The ball FLIES. Read this before touching the ramp.

**The launch angle must EXCEED `boardTilt`.** Range up the slope for a projectile onto an incline
is `R = 2 v² cos(t) sin(t − a) / (g cos²(a))`, zero at `t = a` and negative below it. A ball
launched shallower than the face it is flying at cannot get above that face: it meets the bottom
edge and rolls from there, at every power, forever. That is geometry, not tuning.

**This was got wrong twice, in opposite directions, and the second time shipped.** The original
build launched at 0.62 rad into a lively board and the ball sailed over *everything*: 31 of 51
throws never touched the face, 25 of 51 died against the back wall, and a real 50 spent part of
its flight above the backglass. Correcting that, the ramp was flattened to **0.30 rad against a
0.56 rad board** - and `tune-ladder.mjs --touch` reported it as *"101 of 101 touched the scoring
face"* and it was written up here as a win. Matt, next morning:

> *"The ball doesn't go in the air. It hits a tiny bump rather than a ramp that shoots it in the
> air. Regardless of how hard I throw the ball, it touches the very bottom of the scoring board
> 100% of the time. You have made it impossible for the ball to go off the ramp and land directly
> in a scoring hole."*

Measured: peak clearance over the face 0.6-3.5cm, airborne 0.00-0.01s, **0 of 21 throws first
touched the board above v = 0.10**. A metric pointing the wrong way had been optimised to 100%.
**"Touched the scoring face" is not a virtue** - dropping into a cup out of the air is the shot
skeeball is FOR. What the first build got wrong was the arc's SHAPE, never that an arc existed.

The shape that works, all four parts load-bearing together:

- **Launch 0.88 rad (50 degrees)**, clearing the board's tilt by 18.
- **Six ramp segments, not four.** With four the ball met the steep part too abruptly and the exit
  velocity scattered: 34 flips, 42% repeatable. Six give it room to track the surface: 6 flips,
  88%. A ramp's job is to be FOLLOWABLE, not just steep.
- **The ramp stays 0.30 long**, so its crest stands 0.186m up. Shortening it lowers the crest and
  ruins the launch (that was the 42% case).
- **So the BOARD is raised instead**: `boardLipY` 0.07 -> 0.20, which is how a real cabinet is
  built. At 0.07 the crest stood proud of the playfield and hid the 20 and the 10 completely from
  a camera behind the ball. `sight.mjs` measures that clearance - keep it positive whenever the
  ramp, the board or the camera moves.

Measured after: **21 of 21 throws get airborne**, peak clearance 8-29cm, 19 of 21 first touch the
board above v = 0.10, the landing point spreads 0.04 -> 0.97 monotonically with power, and **70 of
101 straight throws drop into a cup without touching the board at all**. Run `measure-arc.mjs`
after touching any of it: `tune-ladder.mjs` alone cannot see this defect, which is how it shipped.

### The dial is a ladder, and its bands were measured, not guessed

The shipped power→outcome map was noise: **43 of 100 adjacent 0.01 power steps flipped the
outcome, 30 of the 44 bands were one step wide**, and two real throws 0.002 of power apart - 0.6px
of thumb travel over the measurement window - scored 30 and 10. The softest 25 steps of the dial
all scored the floor, and so did 12 of the hardest.

What fixed it, in order of how much each was worth:

- **Every cup is FLUSH** (`collarH: 0`). Walls of 14-20mm read as nothing on screen and behaved
  as a step to a 50mm ball; crossing three of them on the way to the 50 scattered the outcome.
  Measured: 34 flips with 20mm walls, 17 with none, on otherwise identical geometry. This
  reverses the old "wall heights are a physics parameter, deepen them to read as cups" rule -
  the numbers live on the BOARD now, so nothing needs a wall to be legible.
- **The big ring is PAINT, not a wall** (`ring.solid: false`). As a 7.5cm band it fenced the cup
  cluster off completely: a rolling ball stopped dead on its front arc, and the only route to the
  30/40/50 was over the top through the air.
- **Power is spent as ENERGY** (`physics.js` interpolates v², not v). Distance up the face goes as
  the square of arrival speed, so a dial that was linear in speed was quadratic in the thing the
  player aims with.
- **`minSpeed`/`maxSpeed` bracket the LADDER**, nothing more: at minSpeed the ball just reaches
  the 20, at maxSpeed it just reaches the 100s' row. The old 1.0-7.4 window spent most of the
  player's range past the top of the board.
- **The hole positions sit on the measured reach curve.** `measure-reach.mjs` runs the engine with
  the holes taken OUT and records how far up the face each power setting gets; the four cups are
  placed on that curve at even intervals. Do not guess these.

Measured after: **14 flips, 15 bands, mean band 6.7 steps, no dead zone at either end**, every
value reachable, quarter-by-quarter means 23 < 31 < 43 < 50 (harder goes further), max flight
1.31s (was 3.99s). `tune-ladder.mjs` prints all of it against the old numbers; run it after
touching any of `geom`.

### Every number is painted on the BOARD

Each cup used to wear a flat number panel placed at `z = radius * 0.995` - a flat plate set inside
a curved wall of that same radius. A plane cannot sit inside a cylinder without intersecting it,
so the wall cut a curved bite out of **every number on the board**: the 50, 40, 30, the ring's 20
and both 100s all rendered with their bottom halves missing. The mouth was laid flat on the face
while the tube was tilted -0.32 rad, so each black opening slid out from under its own cup and
read as a blob beside the next one down. And `if (!H.collarH) continue` left the 20 with no tube
and no number at all.

Now: values are stencilled into the field texture, up-slope of their own mouth, pre-stretched by
1.9 along v to survive the board's foreshortening. Nothing can occlude them because they are part
of the board. The corner 0s moved inboard to u = +/-0.30 and `resize()`'s fit margin clears them,
so they are no longer sliced by the frame edges. `_scallopedRim()` is kept for a future machine
that wants raised rims - it follows `machine.js`'s own per-segment height profile, so a wall that
IS drawn matches the wall the ball hits.

### The ball settles first, then the score

`capture` fires the instant the ball's centre crosses the mouth, ~325ms before it has finished
dropping through. Announcing there put the number on screen while the ball was still visibly
rattling. `capture` now only lights the rim; the `+N`, the burst and the marquee flash wait for
`ballDone`. Measured: capture at 853ms, settle at 1178ms, popup at 1178ms.

#### And on a collared board the capture can be WRONG, so the popup reads the outcome (2026-09-02)

Matt, with a screen recording of HOT SHOT: *"The 100 appears when I don't get a 100."* The lane
says MISS!, the score does not move, and a gold **+100** floats up the backboard with a burst and a
celebration behind it.

**Waiting for `ballDone` was only half the rule; the other half is WHOSE number to print.** On a
COLLARED cup board - HOT SHOT and POPONGO - `capture` is explicitly a PREDICTION and not a score
(the guard in `machines/classic/physics.js` says so: those mouths have walls standing above the
face, so a ball can strike the far collar and climb back out). `ui.js` stashed the predicted value
in `_pending` at capture and cleared it only on `returned` or `ballDone`, so a rattle-out - which
fires `rimout`, then `gutter`, then `ballDone` with value 0 at `corner0` - arrived at the popup
with a stale 100 still in hand, and every celebration downstream keyed off it.

Two rules close it: **`gutter` drops the pending capture**, and **a popup is drawn only when the
ball finished in the hole it was predicted for**, printing `ballDone`'s own value - the same number
`game.js` added to the score, so the screen and the record cannot disagree about a throw.

**Measured, at the real machines** (`test-skeeball-popup.mjs`, which is the regression probe):
HOT SHOT breaks its own capture prediction on **28.8% of captures**, POPONGO on ~7%, and **THE
CLASSIC on 0 of 248** - its capture rule commits, which is why this was never a classic bug and why
nobody had seen it in the machine that has the most play. The suite's structural half reads the
shipped `ui.js` and was born red on all six assertions.

## The 2026-08-14 board rebuild (batches 3a, 3b, 3f) - READ THIS BEFORE THE SECTION ABOVE

Matt specified the face as a drawing plus a table of proportions, and it **supersedes several
rules in "The dial is a ladder" above**. Where the two disagree, this section wins; the older text
is kept because its reasoning is still correct *for the board it describes*, which is not this one.

**Everything is a multiple of x, the hole diameter** (`X` at the top of `boards.js`). Board 6.875x
by 9.5x - which is 1 : 1.3818, and is where 3a's `boardLen` came from. Ball 0.78125x. Ring heights
all x. At `boardW` 1.00m, x = 0.1455m.

**Three tangency rules define the layout**, and `boards.js` states diameters only, deriving every
ring centre and every hole spacing from them, so no single number can be edited into an
inconsistent face:

1. Every hole touches its own ring at exactly ONE point - the hole's bottom. A ring is never
   concentric with its hole; it hangs above it.
2. The 30 ring's top touches the 40 ring's bottom.
3. The 40 ring's top, the 50 ring's bottom and the 20 ring's top all meet at a single point.

One number in Matt's table cannot hold with the others: bottom-of-20-ring to bottom-of-30-ring is
given as 1.25x, but at 1.25x rule 3's single point cannot exist (the 40 and 20 ring tops miss by
0.25x). The 4.875x diameter was kept and the distance is 1.5x, because 4.875x at x = 4in is the
19.5in circle actually dimensioned on the reference drawing. **This was Matt's call to make and he
was told**; do not silently re-resolve it the other way.

**What reverses from the older sections:**

- **Cups are NOT flush any more.** Every ring is a WALL x tall. "Every cup is FLUSH (`collarH: 0`)"
  above was right for a board scored by how far the ball ROLLS; this board is scored by where it
  LANDS, and the wall is the point.
- **The rings are NOT paint.** There is no `G.ring` object at all - each of the seven holes owns
  its own ring, built by `machine.js` from that hole.
- **A ring may hide its own mouth from the camera and that is fine.** Matt, explicitly. Do not
  shrink a ring or move the camera to keep every hole in view.
- **The resting-position rule is GONE** (batch 3f). Scoring a hole's value happens only by falling
  through it. A ball that misses rolls back down into the trough and takes the 10 or a corner 0
  there - a real outcome, not a consolation.

**The new constraint that governs tuning**: a ball must be `ringH + ballR` (0.202m) above the face
**at the moment it arrives** to drop in rather than bounce off the outside of a ring. Reaching a
hole's `v` is no longer sufficient. The 100s sit highest and are therefore the binding case - they
were unreachable at *every* aim until `maxSpeed` was raised, and clearance at their row is **not
monotonic in speed** (5.80 and 6.40 both score zero 100s over a 66-cell grid; 6.20 scores two).
Measure it, never extrapolate. More aim is also the wrong instinct: at `aimMax` 0.32 a full-aim
ball is on the side rail at u = 0.50 by v = 0.73, well below the corner it was aimed at.

**Known-red, deliberately not papered over.** Five `test.js` assertions fail on this board, all of
them ladder-smoothness checks written for the retired rolling ladder: the soft-end dead zone,
straight throws rolling back, flips between adjacent steps, one-step bands, and
harder-goes-further. The measured ladder is genuinely noisy (43/100 flips) because a tall ring
scatters a ball that clips it. **Do not fix this by loosening those assertions** - that is exactly
the "optimised a metric pointing the wrong way" failure recorded above. The items on Matt's hold
list (soft throws that cannot score the 10, balls that vanish without entering any hole, the
near-miss 100 reading as a 10) are the next batch and are what should move these numbers.

## POPONGO and the arrangement layer (2026-08-22)

The second machine, built from the real product in `skeeball/Machines/Machine 2 - Popongo/`
(rules PDF + photos): nine identical holes in a 1-2-3-2-1 diamond on bare light wood, each slot
wearing a raised cup collar, nine cups - one green 6, two yellow 4s, two red 2s, two blue 1s,
and two black **equalizers**.

- **The arrangement layer** (`boards.js`): SLOTS own the geometry, CUPS own the value and the
  paint. `geom.holes` uses slot-named ids (`top`/`uppL`/`uppR`/`midL`/`midC`/`midR`/`lowL`/
  `lowR`/`bot` - frozen, THE LAW rule 5, they ride the mid-rack autosave); `cups` holds the nine
  cups (`g6`..`eqB` - each cup's value frozen to its id forever); `arrangement` maps slot to cup.
  Hole values are STAMPED from the arrangement at
  module load, and `game.js` scores through `cupAt()`, so player-facing rearrangement later is a
  data remap plus a screen - never an engine or physics change (every cup is the same shape).
  PLAYER-FACING rearrangement is deliberately deferred: what custom layouts do to records and
  unlock comparability is Matt's call after he has played it.
- **The deal was RE-DEALT BY MEASURED DIFFICULTY on 2026-08-27, and the ramp went to 70 degrees
  with it.** Matt: *"It's not super easy, but it's easiest to get the 6 which is an issue."* A
  56 x 41 grid said the same thing: `top` owned the only wide straight-throw power band on the
  machine (5 unbroken steps at .66-.74, scoring again all the way up the dial) and was carrying
  the 6, while `midL`/`midR` had never been reached by a straight throw at all and both
  equalizers sat where no straight throw finds them. The 6 is at `midL` now, an equalizer mirrors
  it at `midR`, the 4s are at uppL/uppR, the 2s at lowL/lowR, the 1s at the two easy slots and
  the second equalizer at `top`. The ramp change is the same machine's other half: POPONGO was
  the only cup board still on THE CLASSIC's 64 degrees, and it was hitting the 12s emergency cap
  about once every three racks (9 of 2,296 throws; 0 at 70 degrees, slowest settle 12.00s ->
  4.88s). **The open problem neither half fixes: 84% of throws roll back to the trough for
  nothing, against THE CLASSIC's 71.5% scoring rate.** Full numbers, the control run and the
  collar-height dead end: `DECISIONS.md#popongo-rearrangement-and-the-70-degree-ramp-2026-08-27`.
- **The equalizer** (`game.js` `_settle`): landing in a black cup wipes what the previous ball
  EARNED this rack (its `earned` field, so an already-wiped ball or a previous equalizer wipes
  as zero; the score can never go negative). `ballDone` carries `{eq, wiped}`; ui.js shows
  `−N`. The rules PDF's "1 point if the ball sticks between cups" is deliberately NOT
  implemented - resting-position scoring is banned (see the batch 3f note above).
- **Goals are per-machine, and they count ONLY that machine's plays** (`goals.js`'s `GOALS`
  map; each goal carries a `labelKey`). Matt, 2026-08-22, after a POPONGO rack advanced the
  classic's Total points: *"they should be completely distinct."* Every score goal reads the
  machine's own `sk.boards.<id>` record; only the classic's five-100s goal uses a global
  counter (`sk.hundreds`), which is inherently classic-only because no other machine pays 100.
  POPONGO's trio: all four colors in one rack, 30+ in a single game, 1,000 points on the
  machine. The color sweep needed one new additive counter, **`sk.colorSweeps`** - item 7's
  three edits are done (`ensureSk`/`recordSkeeball`, the `players-agg.js` sk branch, the
  players-agg.test case).
- **The unlock is GOALS-BASED**: `{ board, goals: true }` = complete every objective on that
  board. POPONGO's own parent has moved twice since (it is `brickcity` now - see "The unlock
  chain" above, which is the one place that describes the order). Applied by ui.js's `_earnedUnlocks` (after each recorded rack) and
  `_ensureGoalUnlocks` (once per mount - retroactive, and cross-device since goals derive from
  the synced store). `unlocksEarned()` in boards.js stays score-only and ignores goals entries.
- **The locked slide grew its MACHINE-SPEC section 17 sliver**: the real render, CSS-cropped,
  greyed and blurred (`.sk-lock-peek`), behind the padlock.
- **The dev bypass** (Matt, 2026-08-22): a dev profile (`isDevProfile`) sees every machine OPEN
  on the gallery, marked with a `TEST` chip, so a new machine is playable the moment it deploys.
  Display and selection only - `sk.unlocked` is never written by it, and every other player
  still meets the real lock.
- **The layout was measured, not guessed, and one standing rule came out of it**: the first
  draft put midL/midR FLUSH against the side rails (the classic-100s pattern) and a sweep showed
  12% of ALL throws three-contact-locking in the crevice where the curved collar meets the flat
  rail - every one walked out by the watchdog and gifted to those cups. **A collar near a FLAT
  wall is a pocket even at zero gap**; every collar now keeps ≥ 0.78X wall gaps everywhere
  (boards.js documents the lattice numbers). Final sweep: all nine slots clean-capturable,
  0 emergencies in 459 throws.
- **The ping-pong ball** (Matt, 2026-08-22, same day: cups read tiny and too far apart): the
  real Popongo is a ping pong ball into solo cups (mouth ~2.4x the ball), and at the classic's
  0.35X ball the 3-across row physically caps the mouths at ~1.0X. So POPONGO's ball is
  **0.28X** (`ball.ratio` waived, `specWaivers` in its entry) and its cups are **0.5625X**
  (mouth/ball ~2.0), on a tighter lattice (t 1.63X, s 1.075X, min wall gap 0.64X vs the 0.56X
  ball).
- **Scoring is honest on cup boards, in physics** (Matt, same day: "points just from hitting a
  cup"): capture on a COLLARED hole requires falling below the RIM plane within the mouth, not
  just past the face plane (`physics.js`, the `needH` term - flush holes keep the classic's
  exact numbers), and a jammed or capped ball on a cup board resolves as the trough's zero
  instead of being walked into the nearest mouth (`st.cupBoard`). Falling through a mouth is
  the ONLY way to score here, including for the watchdog.
- **And the honest rule cuts BOTH ways** (Matt's 23:42 clip, 2026-08-22, on HOT SHOT): a
  ball whose CENTRE is below the rim plane while inside the mouth is inside the cup's VOLUME
  and captures at any rattle speed (`physics.js`, the `lip > 0 && f.h < lip` branch). Without
  it, a fast arrival that failed the kinematic prediction ended up sitting on the still-solid
  slab INSIDE the collar - visibly in the basket - and could hop back out over the rim. The
  pass-through commit still decides the score, so nothing pays without falling through; the
  classic's flush holes (lip 0) are untouched.
- **Renderer**: collars take their cup's color (`_scallopedRim` color param) and the cup's value
  rides `_cupPlate` - an arc on the cup's player-facing outer wall, where the real product
  prints it (a cup is CONCENTRIC with its hole, unlike a ring, so the arc centres on the hole).
  No hole has a `ringD`, so `_ringNumbers`/`platedHoles` no-op; the classic's bottom-slot band
  is gated on `!board.cups`. The setup slides, game-over card and hub average are all
  PER-BOARD numbers now - machines score on different scales, so blended averages meant nothing.

## HOT SHOT (2026-08-22)

**Naming (settled 2026-08-24 - do not "fix"):** the machine DISPLAYS as **HOT SHOT** (Matt
renamed it from BASKET FEVER); its board `id` stays **`'basketball'`**, and so does every
identifier built on it. That id is a frozen storage key, exactly like Monopoly Deal's
`business` (root CLAUDE.md, THE LAW rule 5): it keys `sk.unlocked.basketball`, the per-board
bests and totals under it, POPONGO's `unlock: { board: 'basketball' }`, and the `dressing:
'basketball'` render branch. Renaming any of them would orphan every player's earned unlock and
per-board history. A board id is not a display name. Only `name:` in `js/boards.js` is shown to
a player.

The third machine, built from the real Basket Fever cabinet in `skeeball/Machines/Machine 4 -
Basketball/` (photos): nine orange wire baskets on three shelves, 10/20/10 low, 30/60/30 middle,
50/100/50 top. In this engine a hoop IS a POPONGO cup: a raised collar on a hole, entered by a
ball dropping in out of the air - no new physics, no new capture rule.

- **THE BOARD IS A REAL STAIRCASE** (Matt, 2026-08-22, from his real-machine footage: "3
  stairs... even if that means new engines or physics must be calculated and created"). The
  single tilted face is GONE on this machine. `geom.steps` in the board entry lists six surface
  segments - three near-flat TREADS (2.475X / 0.36 m deep, leaning 0.10 rad toward the player
  so a miss rolls off the front edge instead of parking) alternating with three VERTICAL risers
  (1.925X / 0.28 m) - and `machine.js` builds the whole playing surface from
  them. **Face coordinates UNROLL along the staircase**: v runs up tread 1, up riser 1, along
  tread 2 and so on, so holes, collars, paint, capture and every render call keep the one
  (u, v) address system. `faceToWorld`/`worldToFace`/`tiltAt` are piecewise in machine.js; with
  one segment they reduce exactly to the old flat-face maths, so THE CLASSIC and POPONGO are
  byte-identical in behavior (the full heavy suite passed after the change).
- **Risers are walls, never floors** (`part: 'riser'`, GROUP_REST): a captured ball can only
  fall through a TREAD, and an overshoot hits a riser face-on and bounces back toward the
  player - which also killed the "ski jump" launch the old 50-degree face gave fast overshoots.
- **Each basket funnels into a hole in its TREAD, and the mouth is the only way in**: a
  full-circle collar (no lipLow) walls off every rolling entry; the mouth leans 0.10 rad toward
  the player with its tread. **THE BASKETS SIT AT THE BACK OF EACH TREAD, against the risers
  like the real cabinet's hanging baskets (0.75X from each tread's back edge; v 1.3125X / 5.3X
  / 9.2875X unrolled, u 0, ±2.07X) - MATT'S EXPLICIT CALL, 2026-08-23, do not move them
  forward again.** A front-of-tread placement shipped for a few hours to stop wall-killed and
  tier-falling balls dropping into baskets, and he ordered it undone: "a horrible fix that
  creates significantly more problems than it fixes." The accepted consequence, measured on the
  reverted layout: straight fast throws p0.60-1.30 score 12 of 15 (7 topC, 5 midC) via the
  wall - that is how the real machine plays. Small ball (0.28X, `ball.ratio` waived); mouths
  1.0X ("a little too easy" pass).
- **The back wall** rises from the third riser's top at backboardH 0.85 - the other machines'
  proportion (Matt: the 1.10 wall "seems larger than in the other games"; the taller staircase
  itself now keeps the top edge out of reach). `deadRest` 0.32 makes a hard throw BOUNCE BACK
  toward the player rather than dying flat; near-zero wall grip (`deadFric` 0.06 - a fast ball
  sliding down a GRIPPING wall gets flicked upward by the friction impulse) and deadened
  side-wall tops (`wallRest` 0.15) keep the vertical-pop probe at 5 per 117 hard throws, all
  rim rattles or hidden containment hits behind the backboard - zero off the wall itself.
- **Sweeps on the staircase** (post-revert layout): all nine mouths capturable, 0 emergencies
  in 459 throws, slowest settle 5.4s (DECISIONS.md#hot-shot-layout).
- **The tiers are painted on their own segments** (`_paintField` + one field plane per segment
  in `_build`, each mapping its v-slice of the one unrolled texture): cream shelf treads, blue
  star-scattered risers. Backboard value cards are flat planes ON the risers (`_hoopBackboard`)
  - real wall behind them, nothing phantom, nothing curved.
- **It rides the arrangement layer with a FIXED arrangement**: the cup layer is what puts a
  printed value on a collar wall (`_cupPlate`), so the nine hoops are "cups" `h10a`..`h100`
  (values frozen to ids) even though nothing about them is movable. All one orange.
- **`colorSweep` is gated on `need > 1`** (`game.js`): on a one-color cup board every scoring
  rack would otherwise count a "color sweep" into the GLOBAL `sk.colorSweeps` and falsely
  complete POPONGO's colors goal. A sweep of one color is not a sweep.
- **Goals** (`goals.js`, no new counters), RE-SET 2026-08-25 by Matt ahead of the machine going
  live: **land in every basket** at least once, **700+ in a single game** (was 300), **30,000
  points in total** on the machine (3,000 -> 10,000 -> 30,000, all on 2026-08-25). The first replaces "sink the 100 hoop", which read
  the per-board `bestThrow`; it now reads the per-board `slots` set the same way BRICK CITY's does,
  so no new counter was needed. `bestThrow` is still recorded and still shown on the machine's own
  records - the goal simply stopped reading it. All three read `sk.boards.basketball`, synced and
  cross-device merged by `js/arcade-scores.js`.
- **Unlock**: a goals unlock off the machine before it in the chain (see "The unlock chain"
  above - this machine's parent has changed since it was built). Same
  goals shape as POPONGO's own unlock; `ui.js` needed nothing.
- **The basketball dressing** (Matt, 2026-08-22: "cups instead of basketball baskets... shooting
  a basketball"): the board entry carries `dressing: 'basketball'` and `render.js` branches on
  it - the ball is an orange BASKETBALL (seamed texture in `_buildBall`, orange tray balls),
  each collar is drawn as an orange WIRE basket, and each value rides a white BACKBOARD above
  its hoop. Physics is untouched by all of it; THE CLASSIC and POPONGO render exactly as before
  (no `dressing`).
- **The face was rebuilt to Claude Design's 3D rendering on 2026-08-23** (Matt handed over the
  published design plus its exported project, in `skeeball/Machines/Machine 4 - Basketball/
  Basketball Skeeball Arcade Cabinet/`, alongside the real-cabinet photo it was modelled on).
  PAINT AND MESHES ONLY - no `geom`, no `machine.js`, no `physics.js`, so the sweep numbers
  below still stand. Six changes, each matched to the reference:
  - **The baskets went from 0.35X to 1.0X DEEP** (2026-08-24), where at 0.35X they read as wire
    rings rather than baskets. This is a `geom` change, so it was swept on the 41x21 grid
    (basketball's engine only) before it shipped: 167/861 -> 146/861 scored, all nine mouths
    capturable either way, 0 emergencies, slowest settle 5.51s -> 5.39s, and the low row's share
    of every score down from 46% to 40%. `boards.js` carries the numbers and the reason depth is
    nearly free - do not shallow the collar back out to "fix" scoring. (The rims and the depths
    have both moved several times since; `boards.js` is the live copy.)
  - **The baskets have NETS.** `_wireBasket` draws the design's basket: the orange rim on the
    physics profile, a small bottom ring, ten tapered ribs, and two crossing bands of white
    strands meeting at a ring - the thing that makes a hoop read as a basket. GUARD: every
    strand is merged into ONE buffer per colour by `_mergedTubes`, so a full netted basket is
    two draw calls. The old ring-per-tube version was already ~180 draw calls for nine baskets
    before a single strand existed; do not go back to one mesh per wire.
  - **The backboards are HALF DOMES** with an orange-bordered value box, extruded 12 mm proud of
    the riser (`_hoopBackboard`), not the flat red-boxed card they were. They are bolted clear
    of THE RIM, not at the riser's foot: the basket stands 0.75X in front of the riser, so a
    board mounted at the foot has its number hidden behind the hoop from the play camera.
  - **The treads are OAK, not cream**, with grain across the shelf, a shadow where the riser
    lands and a lit front lip; the risers are a saturated blue with a bigger star scatter.
  - **Red NEON frames the play window**: a tube up the front edge of each side wall and back
    along its top, traced from `machine.js`'s own `railProfile` so it follows the wall. Emissive
    plus one additive halo sleeve - no light source.
  - **The kick panel is the YELLOW ball-return apron**, paint only; its solid and its bounce are
    machine.js's and are untouched.
  - **`_paintField` and `_paintLane` now declare `SRGBColorSpace`.** This was the measured
    reason the riser blue rendered slate however far the paint was pushed: without it the sRGB
    hex on the canvas is handed to the shader as LINEAR albedo, which lifts and desaturates
    every colour on the board. It also darkened the lane, so basketball's `look.wood` was
    lifted to compensate (`woodDark` is unchanged, so the side walls stay the cabinet's black).
    THE CLASSIC and POPONGO have their own copies of both painters and were deliberately NOT
    changed - the same bug is in theirs, and fixing it there re-tunes two machines nobody asked
    about.
- **The ball, the 100 rim, and the back wall (2026-08-24, Matt).** THREE tuning changes on this
  machine only: (1) the ball is THE CLASSIC's now (`ballR: X * 0.375`, 0.75X diameter) - the
  0.28X ping-pong ball read too small; (2) the EIGHT standard hoops are unchanged, and ONLY the
  100 is smaller (`topC` r `X * 0.35417`, 0.7083X across - the design's tighter top-centre rim,
  4.25in vs 6in), the one shot meant to be hard **(SUPERSEDED twice the same day - see the two
  bullets below; every rim on this machine moved after this was written)**; (3) the back wall
  gets THE CLASSIC's rebound
  (basketball/physics.js's own `matBack`, `backRest 0.60 / backFric 0`) so a hard throw that used
  to bank high off the wall and drop into the 100 comes back at the player instead. The bounce is
  on the BACKBOARD ONLY - the tall wall ABOVE the top step; the riser directly behind the 100 is
  a normal surface, so a direct arc still drops in. Kick panel stays on `matDead`. Sweep after:
  emergencies 1.0%, all mouths reachable.
- **Every rim resized, twice, 2026-08-24 - and MATT ALWAYS SPEAKS IN DIAMETER.** He said it in
  those words: *"i have never given you a measurement that is defined by r. I've never mentioned
  r. EVER. I have ONLY ever stated measurement in diameter."* `r` in `geom.holes` is a RADIUS, so
  a diameter he gives is ALWAYS halved before it goes in the table. Getting this backwards
  doubles every basket, which is exactly what happened:
  - **The 6in build (`58a3f0c`, shipped).** All eight standard rims went 4in -> 6in and the 100
    went 2.83in -> 4.25in. Matt, on seeing it: *"They're massive now. The ball can't fit between
    them at all."* He was right, and it is arithmetic, not taste: the columns are 2.07X apart =
    8.28in centre to centre, the collar wall adds 0.33in to each outer diameter, so 6in rims
    leave a **1.95in gap against a 3in ball**. The ball could not pass between two columns at
    all - it could only sit on the rims or drop in one.
  - **The fix (this pass).** Bottom and middle rows **4.25in**, the top row's two 50s **4in**,
    the top row's 100 **3.5in**. Gaps are back to 3.70in (lower rows) and 4.20in (top row),
    both above the 3in ball.
  - **The check any future rim change owes:** `gap = 8.28in - (rim diameter + 0.33in)`, and it
    must stay above 3in. A rim change that skips it can silently wall the face off again.
- **DEPTH IS PER ROW, NOT PER BASKET (Matt, 2026-08-24):** *"all the hoops on a row should be the
  same height, regardless of the diameter of the basket"*, and *"the top of the backboard should
  never go higher than the wall the basket is on"*. So `collarH` is one value per row - the top
  row runs a single depth across its 4in and 3.5in baskets. The depths themselves are just the
  depths Matt asks for and are not derived from anything; `boards.js` holds the current ones and
  their history. The second half was a real bug in `basketball/render.js`: `_hoopBackboard`
  capped the card's dome radius against the WHOLE riser rather than the room left above its
  mount, so the card's top ran past the riser (0.315 m of card on a 0.28 m riser at 6in rims).
  The cap now subtracts the mount. Only `machines/basketball/` was touched - Brick City
  has its own engine copy and was left alone.
- **THE VALUE CARDS ARE AN ARCH, ONE SIZE PER ROW (2026-08-24, Matt, and it applies to BOTH Hot
  Shot machines).** He asked for two things and they are the whole design: *"I do not want the
  backboards to overlap each other. And I don't want them to ever be taller that the wall they're
  attached to."*
  - **The bug was the SHAPE.** The card was a semicircle (`absarc`), so its height WAS half its
    width - one radius doing both jobs. Height could then only be bought with width, and width is
    exactly what the no-overlap rule caps, so every card stopped well short of its wall and left a
    band of bare riser above it. Matt: *"notice the gap between the top of these backboards and
    the beginning of the next shelf. This doesn't look right."* It measured 1.35in on the lower
    rows and 2.05in on the top row, against a 7.70in wall.
  - **The fix is `absellipse`:** width answers to the column pitch, height answers to the riser,
    and neither can drag the other out of bounds. `_backboardRow(ti)` supplies what the ROW owns -
    its deepest mount, its column pitch, its widest rim - so one shelf's cards are cut identically
    and hung level, whatever the baskets under them measure. Reveals: `TOP_REVEAL` 0.33in of bare
    riser above every card, `SIDE_GAP` 0.50in between neighbours. Matt allowed the top one
    explicitly: *"the backboards do not have to be exactly to the top of the wall they're on. you
    could leave like a 0.5 in gap if that makes the backboards fit better."*
  - **WIDTH IS NOT "AS WIDE AS IT MAY BE", and this was measured, not guessed.** The first build
    stretched every card to the no-overlap cap; rendered, it looked WORSE than the gap it fixed -
    wide squat cards crowding each other, and the value box (a fraction of the card's HEIGHT)
    shrank until the number was hard to read. Width is now `1.5x the widest rim on the row`,
    widened only as far as needed to keep the arch under `ARCH_MAX` (height : half-width of 1.25),
    then clamped by the pitch. **If you change this, RENDER IT AND LOOK** - the numbers alone said
    the first version was fine.
  - Both `machines/basketball/` and `machines/brickcity/` carry the fix. Brick City's copy had
    never had even the mount fix, so its cards could exceed their wall outright.
- **The ramp is STEEPER than the classic's, deliberately** - final segment 70 degrees (the
  spec's section 5 maximum) in six even steps, so the throw reads as a basketball SHOT: range
  up the face barely moves but the peak is higher and the descent steeper, dropping the ball
  into a basket from above. Re-swept at 70 degrees under the post-POPONGO capture physics
  (the `needH` rim rule): all nine hoops clean-capturable, 0 emergencies in 459 throws; ladder
  low row from p~0.28, middle p~0.52, top p~0.8, the 100 straight at p0.76-0.8.

## Four per-board counters arrived with BRICK CITY (2026-08-24, two more 2026-08-25)

`js/arcade-scores.js`'s board record gained two fields, and they are **per board on purpose** -
they answer questions about ONE machine's face, and a global counter would let another machine
satisfy another machine's objective (Matt's "completely distinct" rule, 2026-08-22):

| field | shape | merged across devices by |
|---|---|---|
| `slots` | a SET of the hole ids ever landed on that board | **union** - a basket hit on a phone and another on a tablet are two baskets hit |
| `cleanRacks` | a counter of finished racks that scored without touching a penalty basket | **sum** |

**Two more arrived on 2026-08-25**, when Matt raised BRICK CITY's objectives ahead of it going
live (every basket THREE times, THREE perfect rounds - "no 0s and no negatives"). Neither of the
first two can answer those: a set cannot count to three, and a clean round allows a miss. So they
were ADDED BESIDE them rather than redefined - THE LAW rule 5, and `slots` is now what HOT SHOT's
own first objective reads:

| field | shape | merged across devices by |
|---|---|---|
| `slotHits` | how many times each hole has been landed on that board | **sum** - twice on the phone and once on the tablet is three |
| `perfectRacks` | a counter of finished rounds where all nine balls SCORED | **sum** |

All four are additive and all four default to empty on a device that has not played since, so a
record written before any of them existed loads with every number it had and gains nothing it did
not earn (`test-stats-replay.mjs` scenario G asserts that for the first pair, scenario H for the
second). `game.js`'s `result()` feeds them as `slotsHit` / `slotCounts` / `cleanRack` /
`perfectRack`; the two slot fields list REAL holes only, so "hit every basket" can never be
completed by missing into the trough. `cleanRack` is gated on the board actually having a penalty
basket, the same way `colorSweep` is gated on `need > 1`; `perfectRack` deliberately is NOT - nine
balls out of nine scoring is a hard, honest statement about any machine.

Only BRICK CITY reads `slotHits` and `perfectRacks` today, and only HOT SHOT reads `slots`. A
future machine that wants any of them gets it for free.

## Where the three objectives sit (2026-08-24: one per rail, the total above the machine)

One goal in each gutter rail - the signature goal on the left, the single-game score on the right -
and **the running total on a wide horizontal bar above the machine, IN FLOW**. That last word is
the whole section.

**The first attempt at the centre bar was pulled**, because it was `position: absolute` at
`safe-area + 134px`, a constant taken from THE CLASSIC's band. Measured through the real UI, the
gap between the ball pips and the top of the marquee is 53 / 69 / 77px on THE CLASSIC and POPONGO
at 375x667 / 393x852 / 430x932, but only **31 / 40 / 44px** on the staircase machines - which left
6px on the small phone for a 28px chip, so it sat across a designed sign. Matt: *"obviously I don't
want the objectives to cover any machine."*

**All three were moved into the rails, and that was the wrong fix.** Matt, the next day: *"The
previous way of putting the total point horizontal over the machine was great. I'm not sure why
there isn't enough space there anymore."* There was always enough space; the bar was positioned
badly.

**What it is now.** `.sk-gtotal-row` is a flex child of `.sk-play-wrap`, between `.sk-rack` and
`.sk-stage`. The stage is `flex: 1 1 auto` and the renderer fits the machine to whatever height the
stage ends up with, so a row above the stage takes its height first and the machine is drawn in
what is left. **The bar cannot reach a marquee on any board, at any size, and nothing is measured
to make that true.** It is the same reason `.sk-rack` is in flow, and `skeeball.css` already said
so in the guard above it.

Verified anyway, on all four machines at 375x667 / 393x852 / 430x932: the bar's bottom clears the
highest lit part of every machine by 31px at worst. It costs the stage ~40px, so every machine
renders about 5% smaller - that is the price, and it was paid deliberately.

**The one thing that still needs measuring** is WIDTH, because the bar is centred and the rails are
absolute: on a narrow phone they share a band of screen. At 360px there are only ~207px between the
rails, and Spanish `"Puntos totales"` completed measures 222px at the full type size. A single
`max-width: 400px` step (label 11px, value 14px, tighter padding) buys ~37px and keeps the worst
case clear at every width from 360 up. 11px is the repo's floor, so there is no room below it: **a
future machine with a longer third objective needs a re-measure**, since nothing truncates and a
label that does not fit will collide instead.

**Do not give this bar `position: absolute` again**, however tempting the 40px looks.

### An objective SAYS WHAT IT MEANS when you tap it (2026-08-25)

Matt, setting BRICK CITY's new three: *"'perfect rounds' must be defined when you click on the
objective."* Every box that shows an objective carries `data-def` - both rails, the wide total bar
and the game-over tiles - and a tap opens `_showGoalDefs`, a sheet with all three objectives, the
tapped one lit, each with its progress and one plain sentence. Every machine's goals carry a
`defKey` (`goals.js`), so the sheet is never half empty.

**The rails take taps now, and the guard above `.sk-grail` in `skeeball.css` had to change to say
why that is safe.** The COLUMN keeps `pointer-events: none`; only the box inside it takes them.
Throws are read by `.sk-swipe`, the bottom 52% of `.sk-stage`, and the rail boxes end 193px above
it on a 375x667 phone (measured through the real UI, both boxes 71x67). Move the rails down, grow
the box, or raise `.sk-swipe`, and measure those two rects again.

**The wide bar's hit area is 44px tall while the bar itself stays ~30px** (a transparent `::after`
overhanging into `.sk-gtotal-row`'s inert padding). That bar is IN FLOW, so every pixel of real
height it takes is a pixel of machine - paying ~14px of stage for the tap floor was the wrong
trade, and nothing else on that band takes a tap.

### The objectives VANISH once the machine has nothing left to ask for (2026-08-25)

Matt: *"objectives vanish once all three reached AND next board unlocked."* Both rails and the
total bar paint empty, and `.sk-gtotal-row:empty` collapses so the stage gets its ~40px back - a
machine you have finished renders slightly bigger than one you have not.

Two details that are load-bearing:

- **The decision is made ONCE, in `_startGame` (`this._goalsHidden = this._goalsSpent()`), not on
  every repaint.** The rack that completes the third objective has to KEEP its boxes on screen,
  because the ceremony below flies those very boxes to the middle of the screen. Re-deciding per
  paint would delete the thing being animated. The ceremony sets `_goalsHidden = true` itself when
  it finishes, so they go for the rest of that rack and every rack after.
- **A TERMINAL machine is spent on all-three-met alone.** Nothing hangs off RUNAWAY's objectives
  (it is last in the chain), so waiting for an unlock there would leave its rails up forever.
  `_goalsSpent()` treats "opens nothing" as spent. Anything unreadable answers NO, so the failure
  mode is showing the objectives, never hiding something still owed.

**But they are still REACHABLE, on a tap (2026-08-27).** Matt: they "disappear after they've been
achieved... add something above the machines that players can click to see the objectives after
they've already completed them." So the two RAILS still go entirely, and the wide bar becomes a
small **`Objectives ✓` chip** (`_goalDoneMarkup`, `.sk-gdone`) in the same in-flow row the running
total used - the one place above the machine that is measured clear on every board. Tapping it
opens the same `_showGoalDefs` sheet every objective box opens, so a finished machine still says
what it asked for and what the player did.

- **It carries `data-def` with NO id**, so the sheet opens with nothing singled out - there is no
  one objective being asked about - and deliberately **no `data-goal`**: `_checkGoalsNow` pops
  boxes by that attribute, and nothing on a spent machine can turn met.
- **It is smaller than the bar it replaces** (11px label, ~23px chip against ~30px, row 31px
  against 40px measured at 375x667 and 393x852), because this row is IN FLOW and every pixel it
  takes is a pixel of machine. A finished machine still renders bigger than one you are working
  on - just no longer by the whole bar.
- The 44px hit area is `.sk-gtotal`'s overhang trick, for the same reason and with the same
  clearance from `.sk-swipe`.
- `.sk-gtotal-row:empty` still collapses the row, and now only fires when there are no objectives
  to show at all. The chip is what gives the row a reason to exist.

## The unlock ceremony (2026-08-25)

Matt's sequence, in his words: the third objective completes, fireworks, the three objective tiles
turn gold, float together to the middle, merge into a pulsing blob, shrink to a point, a golden key
pops out - **all before the game-over screen** - and then the player goes to the gallery, finds the
machine they just opened, its lock glowing and pulsing, taps it, and the lock falls off.

**THE ONE RULE THIS IS BUILT ON: the key is theatre over an unlock that is already banked.** The
earn writes `sk.unlocked` exactly when it always did (`_rackOver` -> `_earnedUnlocks` ->
`unlockSkeeballBoard`, additive, THE LAW rule 2; `_ensureGoalUnlocks` still catches anything earned
on another device). **Nothing in the ceremony grants anything.** If tapping the lock were what
granted it, a player who earned a machine and closed the app would have lost it - which is exactly
the shape of THE LAW's founding incident.

- **`gamehub.skeeball.lockpop.v1`** (`{ [boardId]: true }`, local, cosmetic) is the whole of the
  new state: "this machine owes the player a lock-pop." It is **armed by the ceremony and never
  backfilled**, so an absent entry means "no ceremony owed" - every machine unlocked before this
  shipped stays open exactly as it was, and a wiped key can only ever SKIP a ceremony. It can never
  put a lock back on a machine somebody earned.
- **`pending` requires `earned`** (`_slideState`). The gallery shows the golden lock only for a
  machine the player already owns. A machine open to everyone by admin release never waits on a
  lock, and neither does a dev profile.
- **THE KEY GOES INTO THE LOCK.** Matt: *"The actual unlock could still be better. The key doesn't
  even float in and go into the lock."* Before that the lock simply fell off on its own and the key
  the player had just been handed on the lane never appeared again. It floats in from off the card,
  levels out, drives into the keyhole (the padlock has one now), turns, and only THEN does the lock
  react. 3.7 seconds over seven beats - the cut before it ran in 1s against a 54px lock (*"there's
  no animation at all that's visible"*: the slide re-rendered before anything registered).
- **The REVEAL is the point of the back half.** While the lock and key tumble off, the greyed
  sliver un-greys and GROWS into the machine, so the screen visibly becomes the unlocked card
  rather than being replaced by it. The 3700ms in `_popLock` and the `sk-lock-*` timeline in the
  stylesheet have to stay in step, and the flight/drive-in/turn/fall are ONE keyframe block for
  the same fill-mode reason the blob is.
- **`KEY_SVG` and `LOCK_SVG` in `ui.js` are the art, used by both halves.** Matt, with a reference
  picture: *"just make the key look a bit more like a key"* - so it is a chunky outlined cartoon
  key (round bow with a real hole, collar, shaft, two stepped teeth), not a stroked outline.
  **It is ONE path with `fill-rule="evenodd"`, not a pile of shapes**: the silhouette and the bow's
  hole are subpaths of the same `d`, so a single stroke draws the outer outline and the ring around
  the hole with no seam where the shaft meets the bow - and the hole is a real hole, so it works on
  the dark lane and on the gallery's white card without a mask or an id two copies on one page
  would fight over. Teeth point LEFT, bow sits RIGHT, because the gallery's key drives in from the
  right. Aspect is 106:58 - size it by width and let the height follow, or it shears.
- **`_slideState(b, sk, devAll)` is now the single answer to "what is this slide"** - testing /
  earned / released / pending / open. `_renderSetup` read those three sources in three separate
  places before, and the picture-painting loop's copy had already drifted from the markup's.
- **A MACHINE CAN BE BANKED WITHOUT ITS CEREMONY EVER HAVING BEEN SEEN, and that debt is now
  remembered** (`gamehub.skeeball.ceremonyowed.v1`, 2026-08-25). `_ensureGoalUnlocks` grants a
  machine whose parent's objectives were already complete - met on another device, or met while
  the machine was still in TESTING and therefore skipped by both unlock writers. That grant is
  silent by design (it runs at mount, with no rack on screen to animate), so the player's reward
  for finishing a machine was a slide that quietly stopped being grey. Matt, about King of Games,
  who had cleared HOT SHOT's three before BRICK CITY was ever released: *"I want him to see the
  unlock animations we created... set it so that the next time he scores a single point in hot
  shot, the animation plays."*
  - A retroactive grant **banks the unlock first, then arms the debt** - a player granted a machine
    at mount who closes the app still owns it.
  - `_checkOwedCeremony` (called from `_checkGoalsNow`, so it runs after every settled ball) fires
    when the round is on the PARENT machine, the score is above zero, and `allGoalsMet` still
    reads true from the RECORDED store. `_checkGoalsNow` itself can never fire this: it only
    celebrates a goal that turns met while you watch, and these were finished days ago.
  - Two things had to stop excluding it: `_unlockCeremony`'s `next` now accepts a machine the
    player already HOLDS if its ceremony is owed, and `_goalsSpent()` answers NO while one is -
    the ceremony flies the objective boxes to the middle of the screen, so hiding them as spent
    would leave it nothing to animate.
  - The debt is cleared as the ceremony STARTS, not when it ends, so quitting half way through
    does not replay it on the next point; the lock pop is the half that survives leaving.
  - Verified in a real browser against King of Games' exact stored shape: mount banked
    `brickcity` and armed the debt, the three completed objectives stayed on screen, one 60-point
    ball fired the ceremony, the debt cleared and the lock pop armed.
- **The ceremony can fire on ball 3; the unlock is banked at ball 9.** Quitting in between leaves
  the flag armed against a machine not yet earned, which the gallery reads as still locked
  (`pending` requires `earned`). The next finished rack banks it and the lock is waiting. Nothing
  is lost on either path.
- **Silent under reduced motion**, exactly like the fireworks: `_unlockCeremony` returns before
  building anything, `_popLock` re-renders with no animation, and the game-over card still says
  UNLOCKED. Nobody is gated behind an animation they cannot see.
- **IT ENDS ON A TAP, NOT A TIMER.** The key, the machine's name and an OK button hold on screen
  until the player dismisses them (Matt: *"make them have to click to get rid of it"*), so
  `_showWhenQuiet` holds the game-over card for as long as `_ceremony` is true and is deliberately
  **not** bounded by its own 4s while it is - that bound is there for a stuck score counter, not
  for something waiting on a person. A 60s auto-dismiss in `_unlockCeremony` is what makes that
  safe: a player who puts the phone down still gets their card.
- **It is deliberately slow, and every swap is a cross-fade or a morph.** The first cut ran the
  whole thing in 5.2s; Matt: *"you're rushing it... you just instantly swap what they are."* So the
  boxes FADE to gold rather than starting gold, their labels go mid-flight so three blank gold
  pills converge, the tiles are still on screen while the blob swells up out of them, and the key
  GROWS OUT OF the point the blob collapsed into rather than replacing it.
  **Three traps are commented in place and all three were real.** An expo-out on the key was 65%
  done in the first eighth of its run and read as an instant swap again. Three comma-separated
  `transform` animations on the blob let the last one's `both` fill erase the two before it - which
  is why the merge, the beats and the collapse are ONE keyframe block. And the key was once
  unmasked through a widening `clip-path` circle, which is a WIPE, not growth - Matt: *"make sure
  the key actually begins small and grows. Not just the visibility of the key."* It is pure scale
  now, `linear` with the pace stepped by hand in the keyframes, because every eased curve tried
  dumped most of the growth into a third of the run (measured: 3px to 185px in 0.65s of a 1.8s
  animation). **Measure it, don't eyeball it** - the preview generator reads the key's rendered
  width at each beat, and 2 / 9 / 21 / 59 / 133 / 234 px is what "watchable" looks like as numbers.
- **The CSS timeline lives in one comment** above `.sk-cer` in `skeeball.css`. Eight
  `animation-delay`s spread across six rules are unreadable otherwise; change a beat there and
  update that block.

`ui.js` measures the three real boxes and hands each gold tile its own `--tx`/`--ty`, so the
stylesheet never has to know where a rail is - which is what keeps this working on a machine whose
rails sit somewhere else.

## The records panel (the four numbers every machine shows)

Per Matt's spec, each machine displays: the **top score by ANY player**, the current player's
**all-time best**, their **best today**, and **the score they just rolled**. Where each one lives:

- **Top score (anyone)**: derived at read time — `readPlayersOnce()` → `aggregatePlayers()` →
  `appWideBest(rows, 'skeeball', 'sk', boardId)` (`js/arcade-scores.js`; there is deliberately no
  shared `highscores/` node — see that file's header). Local history is merged over it so an
  unsynced device still shows its own truth. Async; the panel renders local-first and fills in.
- **Your best / today**: `bestOn` / `todayBestOn` over the player's own `sk.boards[boardId]`
  (the daily best is a date-keyed map that never resets — arcade-scores' header explains why).
- **Just rolled**: the rack-over sheet, plus a session-only "Last game" slot on the machine card
  (deliberately not persisted: the durable copies already live in the daily map and bests).

"NEW BEST" pills on the rack-over sheet compare against what stood BEFORE the rack was recorded.

## Persistence and THE LAW

> **The Skeeball data in the store today is TEST DATA.** Matt's note, 2026-08-20: every Skeeball
> record currently in the hub - the MattyIce scores included - is his own testing, and he expects
> to clear it before the game goes public. So THE LAW's weight here is about the SHARED files, not
> about Skeeball's own counters: `js/game-stats.js` and `js/players-agg.js` carry every other
> game's real plays, and those are what must never be put at risk.
>
> **This does not license deleting anything.** Never delete player data - Skeeball's or any other
> game's - without Matt asking for it in so many words. "It is only test data" is his call to
> make, never an assumption to act on.
>
> **He asked, and it was cleared on 2026-08-22.** `clear-skeeball-stats.mjs` (repo root, kept for
> audit) deleted `players/*/stats/games/skeeball` on all 55 nodes carrying it - 64 plays, top score
> 700 - after a full backup, and verified by fresh re-read that every other game object was
> untouched. Every node with plays was Matt or MattyIce; the "family members may have real plays"
> worry above was checked against the data first and did not hold. **The server half is not the
> whole job**: `syncMyStats()` mirrors the device's entire local store, so any device still holding
> local Skeeball data re-uploads it on its next hub load. The dev-only "Reset Skeeball stats"
> button is the device half, and has to be pressed on each device still in use.

**The stats id `skeeball` and sub-counter `sk` predate this rewrite and carry real plays.**
Everything this build writes goes through the SAME shared plumbing the old one used, so that
history keeps accumulating rather than being orphaned:

- `recordSkeeball(boardId, { score, balls, hundreds, fifties, bestThrow, at })` in
  `js/game-stats.js` — called exactly once per finished rack (`recorded` guard; every write in
  the store is additive, so a double call would silently inflate). `byDiff` buckets by board id;
  the first machine's id is **`classic`**, which is also `recordSkeeball`'s own fallback id —
  frozen forever (rule 5). Rename a machine's display name freely; never its id.
- Per-machine records and unlocks ride `sk.boards` / `sk.unlocked` via `js/arcade-scores.js`
  (counters add, bests `Math.max`, each DAY takes the max, unlocks union across devices).
- The frozen vs-computer fields (`sk.won`/`lost`/`tied`, from the pre-2026-08-11 build) are
  untouched: never incremented, never cleared, still shown by My Stats when non-zero.
- This game's own keys hold nothing earned: `gamehub.skeeball.v1` is one preference and
  `gamehub.skeeball.save.v1` is a mid-rack snapshot that is cleared only AFTER the rack it
  describes has been recorded to the shared store. Nothing in this folder's storage can lose
  anything, because nothing earned lives in it (Pinball's model).
- Item 7's three edits (`ensureSk`/`recordSkeeball`, the My Stats screen, the `players-agg.js`
  branch) all predate this rewrite and were left as they are; `players-agg.test.mjs` carries the
  regression case.

The leaderboard row went in on 2026-08-22 with the release and came back OUT on 2026-08-23 with
the pull-back: no `GAME_META` entry in `js/leaderboard-ui.js`, and `skeeball` back in
`players-agg.test.mjs`'s `OFF_THE_BOARD` (that test asserts an `OFF_THE_BOARD` entry is not
stale, so the two can never disagree). That test's parser guard tracks the count of dev-only
games and went `>= 2` -> `>= 1` -> `>= 2` across the same three days. NOTHING WAS LOST either
time (THE LAW rule 1): every play stayed in each device's store and in `players/`. The My Stats tab is deliberately PRESENT and not devOnly — family members may have real
plays from the hours the old build was live, and hiding the tab would make their own history
invisible (rule 1; the comment on the `TABS` row records this).

## Releasing a machine from the admin page (2026-08-24)

A machine no longer has to be earned to be playable by the family. The hub's **🛠️ Admin** page
(`js/admin-ui.js`, Matt only) can open any machine for everyone, and hand it back to its unlock,
without a deploy — Matt's ask: *"I need to be able to release specific skeeball machines too."*

**Three states, not two** (Matt's correction the same day: *"this doesn't allow me to select which
skeeball machines are live and can be unlocked and played vs what is not able to be played yet"*):

| mode | who can play it | earnable? |
|---|---|---|
| Open | everyone, now | no unlock needed |
| Unlockable | everyone who earns it | yes, its normal goals/score |
| Testing | a dev profile only | no |

`adminOnly` in `boards.js` is now only the CODE DEFAULT for the third one. `isBoardTesting(b.id,
!!b.adminOnly)` resolves it, and **both unlock writers consult it** — `_earnedUnlocks()` and
`_ensureGoalUnlocks()` skip a machine in testing and unlock one that is merely Unlockable, which is
what makes that state real rather than cosmetic. Verified in a browser: with THE CLASSIC's three
objectives met, BASKET FEVER unlocks under Unlockable and stays locked under Testing.

How it lands in the gallery: `ui.js`'s three gates (the carousel slide, the deferred board paint,
and the scroll-snap selection) now read

```js
const testing = isBoardTesting(b.id, !!b.adminOnly);
const earned  = !testing && isUnlocked(sk, b.id, DEFAULT_BOARD);
const open    = devAll || earned || (!testing && isBoardReleased(b.id));
```

Both resolvers come from `js/admin-config.js` and are synchronous reads of the app-wide config
cache. Three things about those lines are load-bearing:

- **It is an OR, and the earned half is the player's own store.** A release grants nothing
  permanent, and moving a machine back cannot take it away from anybody who already unlocked it
  (THE LAW rule 2): Testing DECLINES TO HONOR the unlock while it is set and honors it again the
  moment it is not. There is no code path from the admin page to `sk.unlocked` at all.
- **It never writes.** `unlockSkeeballBoard()` is still only ever called by `_earnedUnlocks` and
  `_ensureGoalUnlocks`, from real objective completion. A released machine that someone then earns
  properly records the unlock the normal way, on the normal path.
- **It is separate from the dev bypass.** `devAll` (a dev profile sees every machine) is unchanged
  and still marks its slides TEST; the admin release applies to every player and does not.

`test-admin-config.mjs` asserts all three sites still consult the resolvers, that both unlock
writers skip a machine in testing, that nothing reads `b.adminOnly` directly any more, and that no
`isBoardReleased` call sits next to an `unlockSkeeballBoard` write.

## The unlock chain

```
THE CLASSIC -> HOT SHOT -> HOT SHOT: BRICK CITY -> HOT SHOT: RUNAWAY -> POPONGO
(always open)  (classic's   (hot shot's            (brick city's         (runaway's
                objectives)  objectives)            objectives)           objectives)
```

Every step is a goals unlock (`{ board, goals: true }`), applied by `ui.js`'s `_earnedUnlocks`
after each recorded rack and `_ensureGoalUnlocks` once per mount. Each machine's own entry in
`js/boards.js` is the source of truth; the per-machine sections in this file describe FACES, not
the chain, so **change the chain here and in `boards.js`, and nowhere else.** (Two of those
sections named a parent that had already gone stale by the time this was written, which is why
they now point here instead.)

RUNAWAY was added on the END on 2026-08-25, which moved nobody's unlock and could not have: a
machine appended to the chain changes no existing entry's `unlock`.

**RUNAWAY AND POPONGO SWAPPED on 2026-08-27** (Matt: *"Make runaway before popongo, duh"*), so the
newest machine is now fourth and POPONGO is terminal. Hanging RUNAWAY off POPONGO had made it
unreachable in practice: POPONGO's third objective is 1,000 points on a face whose baskets are
worth 1 to 6, and the player furthest along the chain had 122 of them - so nobody was going to see
the new machine. Unlike the append, this DOES re-point two existing entries, and it still takes
nothing from anyone for the usual reason (rule 2, an additive set nothing removes from).
`test-stats-replay.mjs` scenario G carries the chain as data and proves it against the real
records.

**The GALLERY's order is the `BOARDS` array's order, and it did NOT follow the swap.** The
2026-08-27 change re-pointed both `unlock` fields and left the array as it was, so the
carousel kept showing POPONGO fourth and RUNAWAY last - the chain said one thing and the
screen said another. Fixed 2026-09-02 (Matt: *"make popongo the last game. Runaway should
come before it"*); the array now carries a guard saying so, and `SK_MACHINES` in
`js/game-stats-ui.js` is in the same order. Nothing derives an unlock from either list.

**POPONGO is the TERMINAL machine now, and RUNAWAY is not.** Nothing in the code needed changing
for that - `_goalsSpent()` asks whether a machine opens anything rather than naming a last machine -
but two things that were written when RUNAWAY was last are no longer true of it: its objectives now
GATE POPONGO, and its rails no longer vanish on all-three-met alone.

Since 2026-08-25 a step in this chain is CELEBRATED as well as applied - see "The unlock ceremony"
above. That is theatre only: `_earnedUnlocks` / `_ensureGoalUnlocks` are still the only writers of
`sk.unlocked`, and the ceremony's own flag lives in its own local key.

BRICK CITY was inserted between HOT SHOT and POPONGO on 2026-08-24, which moved POPONGO's unlock
one step further out. **That took nothing from anyone** (THE LAW rule 2): `sk.unlocked` is an
additive set, union-merged across devices, and nothing removes an id from it. Proved rather than
argued - `test-stats-replay.mjs` scenario G replays the real synced records of the only two
devices that hold POPONGO and asserts they still do.
## The moving basket, and the one-shot face (2026-08-25, rebuilt 2026-08-26, HOT SHOT: RUNAWAY)

**The first moving part in this repo, and the first face that CHANGES SHAPE while you play it.**
Everything on every other machine is a static rigid body placed once at build time and still there
on the ninth ball. `runaway` opens with two still 100s on tread 3; land in one and it CLOSES while
its twin comes off its mark and sweeps the full width, and every basket you land in after that
closes too. Full build record, the measured numbers and the open questions:
`skeeball/MACHINE-RUNAWAY.md`. What a session touching ANY machine needs from here:

- **The motion is pure functions in `js/machines/runaway/machine.js`** - `sweepU`, `sweepVel`,
  `holeU`, `holeVel`, `holeOffset`. No state, no clock, no `Date.now()`; `sweeps` is the rack
  state - an object keyed by hole id, one entry per basket currently moving - handed in. `physics.js` drives the bodies with them, `render.js` draws with them, the
  tools measure the travel envelope with them. **Never write a second copy.** One anywhere else is
  a drawn basket drifting off its own collision wall.
- **A moving collar is a KINEMATIC body, never a static one whose position you rewrite.**
  cannon-es zeroes a kinematic body's inverse solve mass (the ball cannot shove the basket) and
  still feeds its velocity to the contact solver (a struck rim gives a real impulse). A static
  body has velocity 0 by definition, so moving one teleports a wall through the ball with the
  solver believing nothing moved - penetration, then an explosive push-out. Set position AND
  velocity every substep: position is authoritative so drift cannot accumulate, velocity is what
  the solver reads. **Both baskets that COULD move get kinematic bodies from the first frame** -
  cannon-es cannot change a body's type after the world is built, and either one can end up being
  the runaway.
- **Capture against a moving mouth is measured RELATIVE TO THE MOUTH, and latches on commit.**
  Skip the relative velocity and a ball sitting still on the tread reads zero speed across a
  mouth driving over it and is swallowed on contact - a magnet, which section 9 of the spec bans.
  Skip the latch and a basket that slides on after capture re-scores a clean 100 as a gutter ball
  halfway down its own drop.
- **CLOSING A BASKET IS TWO THINGS AND NEEDS BOTH.** `physics.js` does not build a closed basket's
  collar, AND the capture loop skips it. Do only the second and the cup becomes a BOWL the ball
  drops into and can never leave - which is BRICK CITY's parked-ball failure rebuilt on purpose.
  Do only the first and a mouth with no wall swallows a ball through a flat plate.
- **`js/game.js` carries the rack state, and `sweep` is SHARED BY REFERENCE.** `machineT` (the
  rack clock), `closed` (slot ids already landed in) and `sweep` (which 100 is running, and how
  fast). Every throw builds its own cannon world and two balls can be in the air at once, so two
  live sims plus the renderer are three independent things that each need to know what the face
  looks like right now. They agree only because all three read the same object through the same
  pure functions - **mutate `sweep` in place; never swap in a fresh one while a ball is live.**
  `game.js` is still pure: it accumulates the `dt` its caller hands `update()` and never reads a
  clock.
- **All three ride the autosave as ADDITIVE keys** and are inert on every other machine. An old
  save resumes with a fresh face and nothing moving, which is exactly right for a machine that has
  neither (THE LAW rule 5). `closed` is read back against the board's own holes, so a save cannot
  close a basket the machine does not have.

**Reachability on a machine like this needs THREE axes, and the face is different on ball 1 and
ball 9.** The same (power, aim) lands somewhere different depending on where the basket was at
release, so `skeeball/js/test.js`'s 41x21 (power x aim) grid measures one arbitrary frozen phase
of one arbitrary face. `sweep-mover.mjs` walks power x aim x phase at a chosen STAGE of a rack
(`--stage open|run|endgame`, `--rung N`, or `--ladder` for the whole escalation), and
`test-runaway-capped.mjs` sweeps the face with every basket closed. Re-run both after ANY change
to that face, the amplitude, the ladder or the materials.

**A moving basket needs its shelf to itself - and RUNAWAY threads that rather than breaking it.**
`holes.spacing`'s 1.30X would be violated at nearly every step of any travel worth having if a
static basket shared the row. On this machine a row's survivor only starts moving once every other
basket in that row has CLOSED, and a closed basket has no collar in the world at all - so a moving
collar never has an open neighbour on its own shelf.

**The spec test's spacing rule exempts a pair only when both are in the SAME group**, not merely
when both CAN move. Once every basket on a machine can move, the looser test exempts every pair
and silently stops checking travel envelopes altogether. Baskets in DIFFERENT rows can be moving
at the same time - a good rack on RUNAWAY ends with three - so those pairs still get the full
envelope.

**AND THE WALL-GAP RULE IS ALREADY BROKEN ON THE LOWER ROWS, MEASURED RATHER THAN ASSUMED.** Those
mouths are wider than the top row's (0.53125X against 0.5X), so at the ends of the same travel
their gap to the rail is 0.7538X against MACHINE-SPEC.md section 12's 0.78X. They have always sat
there as STATIC furniture; making one MOVE is the worst case that rule describes. It measures
clean - 0 walkouts with one moving, and 0 with all three moving at once - and `node sweep-mover.mjs
runaway --stage rows` is what re-measures it. **The rule is a threshold; the sweep is the
evidence.**

**A MOVING BASKET SWEEPS OVER THE ONE YOU CLOSED, so a closed basket must be FLUSH.** The capped
mark is one end of the travel. Anything standing proud there is a moving collar converging on a
static obstacle - the pinch that cost POPONGO's first draft 12% of all throws.

**NOTHING LYING FLAT ON THIS FACE CAN BE SEEN, and it cost the same mistake twice.** The camera
stands behind the ball, so every tread is foreshortened almost to nothing and occluded by the
riser in front of it. First a painted groove along the mover's travel was correctly placed and
completely invisible - in near-black AND in a lit accent, so geometry, not contrast. Then a flat
plate drawn where a closed basket had been did exactly the same thing, and a closed basket read as
one that had never existed. **Only furniture with HEIGHT reads here.** The signal for a closed
basket is its BACKBOARD left standing with its number on it and no hoop underneath - backboards
are vertical, face the player, and are the most legible things on the machine. Applies to any
machine on this staircase: if you are about to paint something flat on a tread, don't.

## Testing racks, and voided scores (2026-08-24)

Two changes that exist because THE CLASSIC and BASKET FEVER both handed out impossible scores while
they were being tuned, and those scores landed in the family's real records.

**A machine in Testing records to `sk.practice`.** `_rackOver` resolves `isBoardTesting(board.id,
!!board.adminOnly)` at record time and passes `practice: true`; `recordSkeeball` then writes only
`sk.practice.boards.<id>` and returns before `bumpTotals`, the lifetime counters, the bests and the
unlock. Nothing above it can see those racks: not goals, not the records panel, not My Stats' real
rows, not `players-agg`, not the leaderboard. They ARE kept and shown (a labelled "Practice (not
counted)" row in My Stats) because a stored number no screen shows reads as deleted (rule 1).

**Scores already recorded can be voided per player, per machine** from the admin page. That is an
overlay in `adminConfig/v1`, never an edit to anybody's record — see `js/CLAUDE.md`, "Score
corrections". It reaches this folder in one place: `myRecords()` runs the board through
`correctBoard()` before returning `mine`/`today`, so the backboard cannot show a number the
leaderboard has stopped counting. `appWideBest` is fed by `aggregatePlayers(..., corrections())`,
so the machine's app-wide record honors a void too.

## Frame rate: why it got slower the longer you played (2026-08-26)

Matt, with a screen recording of BRICK CITY: *"I did not slow it down at all. This is how slow and
choppy actual gameplay gets."*

### What the recording actually measured

The clip is 68 seconds, 1206x2622 at 60fps (an iPhone 16 Pro), and it is worth knowing what came out
of it, because the numbers ruled things OUT as much as in. Decoding it to greyscale and diffing
consecutive frames:

```
the canvas repainted 10.0 fps, every five-second window of the clip, start to finish
gap between new canvas frames    6 capture frames = 100.0 ms, 391 times out of 514
the phone's own UI beside it     60 fps (the score's sk-score-hit animation, 22 distinct
                                 frames in 367ms, while the canvas changed on 4 of the 22)
```

**A dead-flat 100.0 ms metronome is not a machine running out of CPU or GPU.** A loaded renderer
wobbles with what is on screen - a ball near the board costs more than an empty lane - and this did
not move at all, not between throws, not across the rack boundary at 27.5s, not once in 68 seconds.
Flat is what a THROTTLE looks like. That is what sent this at the WebGL context budget rather than
at triangle counts, and the budget is where the bug was.

Four causes, all measured in a real browser rather than reasoned about. The first is the answer.

### 1. Every Renderer leaked its WebGL context, and the browser started evicting (`js/ui.js`, all five `render.js`)

A browser holds a small GLOBAL budget of WebGL contexts - 16 in Chromium, fewer on iOS - and
throttles hard once it is over. Skeeball leaked **two per rack and ten before the first ball**:

- `WebGLRenderer.dispose()` frees three.js's buffers and programs and **leaves the context alive**.
  Only `forceContextLoss()` hands it back, and nothing called it. Every gallery machine picture
  (`renderMachineImage`), every how-to demo, and every rack (`_startGame` rebuilds the DOM, so the
  canvas is a new element and the old context is orphaned) took one and kept it.
- The software-GL probe in each `render.js` constructor took a SECOND one:
  `document.createElement('canvas').getContext('webgl')`, read once, never released, once per
  Renderer ever constructed.

Counted in a browser, live contexts:

```
                        origin/main              fixed
on the gallery            12                       0
rack 1                    12                       1
rack 4                    16  <- cap reached,      1
rack 6                    16     console repeating 1
                                 "Too many active WebGL contexts.
                                  Oldest context will be lost."
```

And what that does to the frame rate, same six racks, same swipe, same browser:

```
              origin/main        this branch
rack 1        33.6 rAF/s         35.1 rAF/s
rack 2        19.8               36.0
rack 3        13.7               40.3
rack 4        10.4               40.7
rack 5         8.1               39.8
rack 6         5.9               40.6
```

`releaseRenderer(r)` in `ui.js` is the fix for the first half: `dispose()` then `forceContextLoss()`,
guarded end to end, at every one of the five teardown sites. **It lives in `ui.js`, NOT in each
machine's `dispose()`, and that is deliberate**: the context budget belongs to the PAGE, and the
gallery builds a picture with every machine's own engine before you ever reach BRICK CITY, so a fix
inside one machine's file could not fix the screen it is needed on.

The probe is the second half, and it IS the same edit in all five `render.js` files - `isSoftGL()`,
memoised per page and releasing the probe through `WEBGL_lose_context`. That is not "keeping the
machines in sync" in the sense the HARD RULE forbids: it moves no geometry, no material and no
contact number, and leaving four copies of it in place would have left the leak that makes BRICK
CITY slow. A resource bug with five copies of its source line is one bug.

### 2. The render loop was running two, three and four times over (`js/ui.js`)

`_startGame` armed a rAF chain unconditionally, and two buttons reach it with a chain ALREADY
running: the pause sheet's **New game** and the game-over card's **Play again**. Each one left the
previous chain alive, so every rack you started added another loop stepping physics and rendering
the same scene on the same frames. Counted directly (a rAF ticker beside a counter inside `_frame`):

```
baseline                  1.00 _frame calls per animation frame      22 fps
after 1x New game         2.00                                       ~
after 2x New game         3.00                                       ~
after 3x New game         4.00                                        7.5 fps
quit to the gallery       3.00   <- three orphans still rendering behind the carousel
```

`_stopLoop()` could never clean it up: `this.raf` only ever holds the LAST chain's id. And `_frame`
re-armed itself BEFORE looking at anything, so a chain left running past `destroy()` went on waking
once a frame for the life of the page - one dead chain per rack ever played, surviving into the hub.

**The fix is `_startLoop()`, and it is now THE ONLY WAY the loop is ever started.** It is idempotent
(`if (this.raf) return`) and that guard is the whole thing; `_frame` also returns without re-arming
when `this.disposed`. Same numbers after: 1.00 everywhere, 0.00 on the gallery.

**The pause sheet now actually pauses**, which fell out of the same work. It said "Paused" and
stopped nothing: a ball in the air when you tapped the machines button went on flying, scored,
popped up and autosaved while you read the menu. `_showPause` stops the loop and its `close()`
starts it again. The game-over card and the how-to sheet deliberately keep rendering (the marquee
celebrates behind the first, the second runs a live demo throw). Nothing is lost by freezing: the
autosave lands at the last SETTLED ball, so a ball frozen in flight and abandoned via Quit is handed
back with the rack resuming, still owed (THE LAW rule 2).

### 3. The shadow map was re-rendered on every frame (`machines/brickcity/render.js`)

three.js re-renders the whole 1024x1024 shadow map every frame by default, drawing every caster in
the scene a second time - and the machine is a STILL LIFE for most of a rack, while the player is
lining up. Measured on the shipped scene:

```
shadow pass every frame   172 draw calls / 37,206 triangles
shadow pass on demand     138 draw calls / 26,026 triangles   (idle, verified in a browser)
```

`shadowMap.autoUpdate = false`, and the bottom of `render()` sets `needsUpdate` for exactly the
frames a caster moved. **Gate it on `live.length`, not on `used`**: `used` counts the ball parked on
the serve spot, which does not move, and gating on that left the pass running through the whole wait
between throws - which is the still life the gate exists for. `used` CHANGING still counts, or the
frame a ball stops being drawn leaves its shadow lying on the lane under nothing.

### 4. Every scoring popup leaked its texture (`machines/brickcity/render.js`)

`Material.dispose()` does NOT dispose the material's textures. Each score popup builds a 256x128
`CanvasTexture` and the sprite's `dispose()` left it on the GPU forever - about 1 MB a rack, never
freed, which is why a long session was choppier than a fresh one. Measured, 27 popups (three racks'
worth), same scene both sides:

```
origin/main   17 textures at rest -> 44 with the popups up -> 44 once they faded
fixed         17                  -> 44                    -> 17
```

Burst particles had the same shape of bug (removed from the scene, material never disposed).
**Dispose `.map` whenever you dispose a material here.**

### 5. The broadphase tested 20,100 pairs to find 200 (`machines/brickcity/physics.js`)

A throw's world holds ONE dynamic body - the ball - among ~200 static ones. `NaiveBroadphase` tests
every pair and throws all but the ball's away, because `needBroadphaseCollision` rejects
static-against-static: 4.8 million rejected pair tests a second at the 240Hz step. `BallBroadphase`
walks the ball's own pairs instead, **emitting them in NaiveBroadphase's exact order** (`for i, for
j < i`) because the solver's answer depends on the order it is handed its pairs, and falls back to
the naive sweep whenever the world does not hold exactly one non-static body.

Proven equal, not assumed: the same 41x21 power/aim grid the reachability tests use, run against
origin/main's engine side by side - **861 throws, 0 differ** on hole, value, settle time to six
decimal places, bounce count, board contact and the full event sequence. 26% less physics time per
frame.

### What was tried and NOT kept

**Turning MSAA off at dpr >= 2.** It looks free and is not: at dpr 2 the drawing buffer maps 1:1
onto the phone's physical pixels, so no downsample is doing the job instead, and mobile GPUs resolve
MSAA in tile memory where it is cheapest. Rendering the machine both ways and differencing the
frames, 1.5% of the screen changes by a visible amount and all of it is outline - the rails, the
marquee edge, the nine rims. The comment in `render.js` says so, so the next session does not
re-derive it.

### Scope, against the HARD RULE

- **1** is `js/ui.js` plus the probe helper in all five `render.js` - a page-global resource bug, and
  the reasoning for touching all five is written out above.
- **2** is `js/ui.js`, which every machine shares, so every machine got it.
- **3, 4 and 5** are per-machine work, and **are not to be carried across "to keep them in sync"** -
  that is the rule this repo paid for. Each is a machine's own work, on its own day.

**RUNAWAY got 3, 4 and 5 on 2026-08-27** (Matt: *"any of the tweaks we've made recently to other
boards like the back wall bounce or the glitchy/choppy rendering?"*). Its back wall was already
right - it was copied from HOT SHOT after that change - and the capture-frame and collar-frame
fixes had landed the day before. Still true and still owed elsewhere: **THE CLASSIC, POPONGO and
HOT SHOT all leak popup textures and all three run the naive broadphase.**

Two things RUNAWAY's copies do differently, and both are about its moving parts:

- **The broadphase guard counts DYNAMIC bodies, not non-static ones.** BRICK CITY's version falls
  back whenever the world holds more than one non-static body, which is correct there because every
  one of its solids is static. **Every collar on RUNAWAY is KINEMATIC** - any basket can end up the
  last one standing in its row - so that world holds 112 kinematic bodies and the stricter guard
  would fall back to the naive sweep every single step, buying nothing. Counting DYNAMIC bodies is
  safe because every machine body carries `collisionFilterMask: GROUP_BALL`, so a machine-vs-machine
  pair fails the FILTER check before its type is ever considered. **Widen any machine body's mask
  and that stops being true.** Measured: 17,391 -> 186 pair tests per substep (98.9% fewer), and
  proven equal on a 1,722-throw grid - identical hole, value, settle time to six decimals, bounces,
  board contact, watchdog and full event sequence.
- **A SWEEPING BASKET DOES NOT CAST A SHADOW.** The first cut of the shadow gate ignored the movers
  and was visibly wrong the moment a row went down to one: the map still held the basket where it
  stood at the last pass, so a DETACHED basket shadow sat on the riser while the basket slid away
  from it. Found by looking at a screenshot, not by reasoning. Firing the pass every frame something
  moves would fix it and hand most of the saving back, because on this machine something is moving
  for most of a rack - so a moving basket turns its shadow off instead, and the pass fires once on
  each transition to clear what it cast while standing still.

### The one red test, and it is not this

`node skeeball/js/test.js --full` finishes 78/1 on this branch, and the failure - *missing the
corner costs the ball (a half-aimed slam does not still pay 50)* - is THE CLASSIC's, on
`DEFAULT_BOARD`, and fails identically on a clean `origin/main` checkout. Verified before shipping
this, so a future session does not spend the afternoon blaming their own diff.

## The ball stuck IN a BRICK CITY penalty basket (2026-08-26) - an invisible ledge, put there by machine.js

Matt: *"the ball sometimes gets stuck IN the negative baskets. Like instead of falling in, it's
just stuck there... Half of the ball out and half completely in. I've even seen a second ball fall
into the same negative basket while one is stuck/frozen."* And: *"There's nothing for them to get
stuck on."*

There was, and he was describing it exactly.

**A collar is 14 boxes on a circle of radius `rr` around its hole at `(H.u, H.v)`**, each one
placed by `faceToWorld(pu, pv, h/2)`. `faceToWorld` resolves `v` through `frameAt(v)` - which
STAIRCASE SEGMENT that `v` lands on. The bottom row sits at `v` 0.1909 with `rr` 0.1151, so its
two rearmost segments carry `pv` 0.3031 - **past the first tread's back edge at 0.3000**. Those
two were built in the RISER's frame and landed **6.96 cm low and 6.86 cm forward**: a 5 cm-wide
bar straight across the throat of every -20 / -10 / -20 basket, 60% of the way down. `faceRot`
already used `tiltAt(H.v)`, so they were mis-oriented for a tread they were no longer standing on
as well.

**Nothing drew it.** `render.js` skips every `cupSeg` box and draws a smooth wire basket instead,
so the ledge was invisible - which is why Matt could see nothing to get stuck on, and why looking
at the screen could never have found it. A ball dropping into the basket came to rest on the bar
with its centre a hair under the rim: half in, half out, and still there when the next ball
arrived (`game.js` hands the next ball out on `st.arrived`, not on the ball settling).

**The mid and top rows never had it** - their collars are small enough that no segment reaches
past its own tread. Bottom row only, on this machine only.

**A second, smaller defect, fixed with it.** `worldToFace` returns the NEAREST segment's
coordinates, and a ball deep in a bottom-row basket is nearer the riser plane (0.1085 behind the
mouth) than the tread it is sunk into (the cup is 0.1455 deep). Above `h` 0.121 every basket on
this machine resolved to a riser frame, so `physics.js` section 2 measured that hole's distance
as **0.22 against a 0.09 mouth** and skipped the cup the ball was sitting in. Latent on its own -
it moves 0 of 861 outcomes once the ledge is gone - but it is what stopped capture rescuing the
parked ball, and it is why the "centre below the rim = captured" rule added on 2026-08-22 never
fired for this row.

**Both fixes are the same sentence:** ask each hole's question in THAT HOLE'S OWN frame.
`machine.js` gained `faceToWorldIn(fr, u, v, h)` and `worldToFaceIn(fr, p)`; the collar loop
resolves `frameAt(H.v)` once per hole, and `physics.js` sections 1 and 2 use the hole's frame
instead of the free one.

**Measured, full 41x21 grid, before -> after:**

| | before | after |
|---|---|---|
| throws parked INSIDE a basket | 4 of 861 | **0** |
| worst settle | 10.91 s | 5.51 s |
| watchdog fired | 82 | 75 |
| outcomes moved | - | 12, **10 of them against the player** |
| grid total | -530 | -630 |

**The 10-against-the-player number is the fix working, not a regression.** A ball that used to die
on the ledge and vanish as a 0 now falls in and takes its penalty - which is what Matt asked for:
*"I want them to not get stuck midway through the basket."* Nothing about a basket's size,
position or depth changed.

**What was NOT the answer**, so nobody re-derives it: v495 (`137eaef`) shortened the stall
watchdog from 0.9s x 3 to a single 0.6s window. That only made the stuck ball vanish faster and
Matt rejected it. **The 0.6s watchdog stays** - it covers a ball parked on a TREAD, which is a
different thing and still happens (103 of 861 throws). It was never a fix for this.

Two earlier sessions each reached a confident, wrong conclusion here, both the same way: they
trusted `worldToFace`'s face coordinates over what Matt was looking at. The stalled ball measured
0.32 m from any basket in face coordinates and 0.054 m from the cup axis in world coordinates -
half a mouth radius. **On a staircase, cross-check in world coordinates.**

`node test-brickcity-stall.mjs` carries both regression probes, born RED against the unfixed
engine: a STRUCTURAL one that rebuilds every collar segment in its hole's own frame and needs no
sweep at all (it would have caught this the day the staircase shipped), and a behavioural one that
asks, in world coordinates only, whether any parked ball is inside a basket's cylinder.

## The capture blind spot, closed on every machine (2026-08-26)

The second half of BRICK CITY's stuck ball (the section above) turned out not to be BRICK CITY's
at all. **Every stepped machine had it**, and `node test-skeeball-capture-frame.mjs` now says so
out loud.

`worldToFace(p)` returns the **nearest** staircase segment's coordinates. A ball deep in a
bottom-row basket is nearer the RISER plane standing behind the mouth (0.1085 m) than the tread
the basket is sunk into (the cup is 0.1455 m deep). So **above h 0.121 every basket on a stepped
machine resolved to a riser frame**, and `physics.js` section 2 then measured that hole's distance
as 0.22 against a 0.09 mouth and skipped the cup the ball was in.

Say the consequence plainly, because the symptom hides it: the *"a ball whose CENTRE is below the
rim while inside the mouth is captured"* rule, added 2026-08-22 for exactly this class of bug,
**could not fire on the deepest part of any basket on a staircase.**

**All five machines are clean now.** THE CLASSIC and POPONGO are flat-faced and never had it. HOT
SHOT and RUNAWAY were fixed the same evening, one machine per commit, per the HARD RULE - HOT SHOT
first, then RUNAWAY once its numbers were in hand. `test-skeeball-capture-frame.mjs` carries an
EMPTY `KNOWN_GAPS`, and the suite fails if an entry ever outlives its bug.

**RUNAWAY was done second and separately for a reason worth recording.** Another session was
rewriting that machine's engine the same evening (its single moving 100 becoming twin 100s), so
its `machine.js` and `physics.js` were being written while this work was going on. The fix was
therefore built and measured in a SEPARATE WORKTREE off `origin/main`, never in the shared
checkout - the two changes touch the same two files, and whoever lands the twin-100s work will
need to merge across this one. If you are that session: this commit adds `worldToFaceIn` to
`machine.js` and changes four lines in `physics.js` sections 1 and 2. Nothing else.

**Measured, full 41x21 grid per machine, before -> after:**

| | HOT SHOT | RUNAWAY |
|---|---|---|
| outcomes moved | **0 of 861** | **0 of 861** |
| settle time changed | **0 of 861**, to 4 dp | **0 of 861**, to 4 dp |
| grid total | 5510 -> 5510 | 6170 -> 6170 |
| worst settle | 6.48 s, unchanged | 7.13 s, unchanged |
| event sequence changed | 100 of 861 | 83 of 861 |
| `capture`+`rimout` pairs gained | 62 | 50 |
| captured earlier (same counts) | 35 | 31 |
| pairs lost | 3 | 2 |

The bottom half of that table is the whole story, and the two machines tell it identically.
**The engine now SEES baskets it was blind to** - a throw gains a `capture` + `rimout` pair when
the ball enters the mouth, is recognised, and then honestly bounces out and plays on - **while not
one score and not one trajectory moves on either machine.** That is what a latent bug looks like
when it is closed: capture only takes the tread slab out from under a ball, and in these frames
the ball was airborne inside the mouth rather than resting on the slab, so nothing downstream
changed.

**RUNAWAY's mover is untouched.** Its section 2 still measures against `holeU(G, id, t)` - where
the runaway basket is RIGHT NOW - and its captured branch still measures against the latched
`st.capturedU`. Only the FRAME those two are compared in moved. A basket that slides cannot lose
a ball it already has.

It is worth shipping anyway, and cheaply, because it is the safety net. On BRICK CITY this same
blind spot is what turned a parked ball into an unrescuable one.

**Also carried over, and proven inert on both:** the collar loop is now frame-locked
(`faceToWorldIn(cupFrame, ...)`), the same guard BRICK CITY needed. Neither machine's mouths are
wide enough for a segment to cross its tread's back edge - verified by hashing every `cupSeg`
position before and after (HOT SHOT 126 boxes, RUNAWAY 98), **byte-identical both times** - so this
buys a future wider mouth and costs nothing today.

**The probe is geometric, not a sweep, and that is deliberate.** It walks each hole's own axis
from cup floor to rim and asks the one question `physics.js` asks. The 41x21 grid reproduced
BRICK CITY's parked ball only 4 times in 861; a geometric check cannot be fooled by a grid that
misses the conditions, costs nothing to run, and discovers machines from `BOARDS`, so the next
one is covered the day it ships.

## The rack resumed on the wrong machine's engine (2026-09-01)

Matt, with a screenshot of HOT SHOT: RUNAWAY - a fully painted HUD (score 100, the ball pips, all
three goal rails) over a completely empty playfield: *"You broke skeeball. I can go back to the hub
but nothing else."*

Shipped and found the same day as the lazy-engine change below, and caused by it.

### The mechanism

`_startGame` resolved its board from **the carousel's selection** while `SkeeballGame.restore(snap)`
(`game.js`) rebuilds the rack on **the snapshot's board**:

```
_startGame      boardById(this.settings.board)  ->  await loadEngine(that)
restore(snap)   new SkeeballGame(snap.board)
then            engineFor(this.game.board.id)   ->  THROWS when they differ
```

They diverge constantly, because **the carousel writes `settings.board` on every swipe settle** (and
`_popLock`'s `done()` does too) while a mid-rack autosave stays pinned to the machine it was banked
on. Play a rack, leave mid-rack, swipe the gallery to anything else, come back: the constructor's
automatic resume restores the saved rack and loads a different machine's engine.

Harmless before the engines went lazy - `engineFor` returned a statically imported engine for any
id. Now it throws, and **where** it throws is what made it so bad: after the HUD's `innerHTML` is
written, before `_bindPlay`, `_fit` and `_startLoop`. So the player gets a painted score over a
dead, unsized canvas (300x150, the untouched default) with no input bound and nothing on screen
admitting anything is wrong. Only the hub's own back button works, because that is hub chrome.

The Resume BUTTON was always guarded (`snap.board === this.settings.board`, `_paintSetupActions`).
It is the constructor's resume-at-mount that had no such gate.

**No player data was ever at risk**: `_startGame` throws before anything writes, and `clearSave()`
only runs on an explicit Play / New game, so the banked rack survived and came straight back.

### The fix, both halves

1. **One source for the board.** `_startGame` now resolves
   `boardById(snap && snap.board ? snap.board : this.settings.board)`. `restore()` resolves
   `snap.board` through the same `boardById`, so the engine loaded and the engine used agree by
   construction rather than by coincidence.
2. **A mount that throws lands on the gallery.** The wrong engine was the defect; the
   unrecoverable screen is what cost a session. The body moved to `_startGameInner` and the caller
   catches, logs loudly (rule 6) and falls back to `_renderSetup()`. Any future throw between the
   HUD write and `_bindPlay` is now "it bounced me to the machine picker" - recoverable, and
   something a player can report.

### Why the suites missed it, and what now catches it

`test-visual.mjs`'s PLAY probe plays THE CLASSIC from the gallery, with no banked save and no
swipe - the ordinary path. Nothing anywhere resumed a rack, and nothing exercised a second machine.

- **`skeeball/js/test.js`** carries a `[KNOWN-BUG PROBE]` pair, born red against the broken build:
  `_startGame` must derive its board from the snapshot, and a mid-mount throw must fall back to the
  gallery. Structural, because the defect is in DOM code that node suite cannot mount.
- **`test-visual.mjs`**'s skeeball probe now finishes by banking a rack on RUNAWAY, pointing the
  selection at THE CLASSIC, re-mounting, and asserting the canvas gets a real size. Note it
  **re-mounts in place rather than reloading**: `checkPlay`'s `addInitScript` wipes every `*.save.*`
  key on every navigation, so a reload deletes the very snapshot the probe needs.

## The gallery drew each machine only when you reached it (2026-09-01)

Matt's SECOND screen recording that day, on v550 - which is to say, on a build where the broken
images were already fixed and the hub-wide records were already reading correctly. What it shows is
the thing underneath both of those:

```
2.0s   taps Skeeball -> the gallery is up, THE CLASSIC's picture box is EMPTY
3.0s   the picture paints                                        ~1.0s blank
4.5s   swipes to HOT SHOT                     blank -> 6.0s      ~1.5s blank
17.5s  swipes to RUNAWAY                      blank -> 19.0s     ~1.5s blank
25.0s  RE-ENTERS Skeeball; hub-wide record reads "-" -> 25.5s it fills in
28.0s  swipes again                           blank -> 28.5s     ~0.5s, every swipe, still
```

Both halves came out of the lazy-engine work earlier the same day (see "What tapping Skeeball used
to cost" below), and neither had a test.

### The picture is only STARTED when the carousel reaches the slide

`_machinesWorthPainting()` paints the selected slide and nothing else, so every other machine's
picture waits for the swipe that brings it into view - and that picture is a dynamic import of that
machine's `render.js` + `machine.js` (110-146 KB), a whole WebGL scene built, `toDataURL`, and the
context handed back. Cold that is ~1.5s; warm ~0.5s. And `_machineImg` was a field on the UI
INSTANCE, so leaving Skeeball and coming back threw every picture away and paid for all of it again.

- **The cache is module scope now** (`MACHINE_IMG`, capped at 16, oldest evicted). Safe because of
  the KEY, not luck: it is [board, all-time score, all-time holder, your best, today, last game] -
  every value the picture has baked into it - so a number that moves mints a new key and a stale
  picture cannot be served, including to a second player on a shared phone.
- **The two neighbouring machines are drawn at idle** (`_prewarmNeighbours`), so the next swipe is a
  cache hit. Three constraints hold it: NEIGHBOURS ONLY (each extra machine is 110-146 KB, and the
  set follows the player as the carousel settles); STRICTLY SEQUENTIAL, never `Promise.all`
  (`renderMachineImage` hands its context back before returning, so one at a time never adds to the
  page's WebGL context budget - and that budget is what made the whole hub choppy on 2026-08-26);
  and SETUP SCREEN ONLY, cancelled on `destroy()` and at the top of `_startGameInner`, because a
  queued picture must never build a scene on top of a live rack's frame budget.
- **A slide being drawn shows a quiet skeleton, not an empty box** (`[data-painting]` in
  `skeeball.css`). The emptiness is what read as BROKEN rather than slow, and a FAILED render left
  exactly the same box - ui.js clears the attribute only on success, so a failure keeps the
  skeleton. Not animated, for the reason `css/hub.css`'s `.hub-card-skel` gives about the launcher's
  own first paint: over a few hundred milliseconds a pulse reads as a glitch. Open slides only; a
  locked slide's picture lives in `.sk-lock-peek` and is already a greyed, blurred sliver.

### The hub-wide record arrived after the picture that has it baked in

`_refreshTopRecords()` awaits `readPlayersOnce()` - a full read of the `players/` node - with no
local cache, so every mount painted a dash in the "Hub-wide record" row and in the backboard's ALL
TIME column. And because the picture is KEYED on those values, the answer landing minted a new key
and **the selected machine was rendered in WebGL a second time, on every single mount.**

`this.top` is seeded from `TOP_KEY` (`gamehub.skeeball.top.v1`) before the first paint. Four things
about that cache, since it is the only part of this change that touches anything record-shaped:

- It is a **display cache of other people's records**. Nothing that scores, records or unlocks reads
  it, `myRecords()` (the player's own best and today) does not come through it at all, and the live
  read still runs every mount.
- **The live answer replaces it; there is deliberately no `Math.max`.** The reflex is THE LAW rule 2
  and it is the wrong reflex here: an admin void (`js/stats-corrections.js`) has to be able to bring
  an app-wide record DOWN, and a monotonic cache would pin a voided score on a backboard for ever.
- **An unanswered read never overwrites it and is never written back.** `readPlayersOnce()` returns
  `{}` both when it fails and when it is not signed in, so an offline mount arrives with every
  board's remote best reading 0 - and writing that back would erase the record the moment signal
  dropped. `answered` (`rows.length > 0`) gates both. The first draft of this got it wrong in a
  second way too, and `test-visual.mjs` caught it: with nothing held AND nothing answered the row
  was assigned `undefined`, and the next line read `.score` off it.
- Missing or malformed reads as "no cache" and behaves exactly as this screen did before.

### Measured, same harness both sides (`measure-gallery.mjs`)

Counts, not milliseconds: this browser is on SwiftShader, so the timings say nothing about a phone,
but "how many times is a scene built and read back" transfers exactly.

| | v550 (what Matt recorded) | after |
|---|---|---|
| slides holding a picture once the gallery settles | **1 of 5** | **3 of 5** |
| renders caused by swiping to the next machine | **1** | **0** |
| renders on re-entering Skeeball | **1** | **0** |

The guarantee is ONE MACHINE AHEAD, not the whole carousel: a player swiping faster than the
prewarm still meets a skeleton, and under SwiftShader a second immediate swipe measurably does.

Verified separately, by seeding `gamehub.skeeball.top.v1` (the container cannot reach Firebase):
the first paint reads `500 · King of Games` instead of a dash, and an offline mount leaves both the
displayed value and the stored cache untouched.

### What catches it now

- **`skeeball/js/test.js`**, structural (this is DOM code the node suite cannot mount): ten
  assertions, all born red against `4ca164c` except the slide-`src` one, which is born red against
  `8bd8879` - the build the broken images were reported on. They pin the module-scope cache and its
  cap, the prewarm existing / being sequential / being cancelled, the skeleton existing and not
  animating, the seeded record, the offline guard, and that the cache is display-only.
- **`test-visual.mjs`**'s skeeball probe asserts a second slide is drawn **without the carousel
  being touched**. Its bar is `>= 2` painted slides, not "the count grew": the selection sits on THE
  CLASSIC, which is first in the list and has exactly one neighbour, so a growing-count test fails
  on a correct build the moment that neighbour lands.

## What tapping Skeeball used to cost (2026-09-01)

Matt, with a screen recording from Anita's phone of opening this game: *"What's wrong with it? Why
does it take so long? I even opened and played a game before taking this screen recording. And
never closed or even left the gamehub. It needs to be better than this."*

### What the recording actually shows

19 seconds, 384x832 at 60fps. Stepped frame by frame, with the scene-change timestamps:

```
4.17s  she taps Skeeball
4.58s  the gallery appears                                    (0.4s - the good case)
8.15s  back on the hub
10.30s the app RESTARTS ITSELF - dark splash, then a blank white launch screen
11.02s the hub again, from scratch.  She never left it.
15.18s she taps Skeeball again
15.92s RAW UNSTYLED HTML - a page-high black padlock over left-aligned text
16.48s the CSS finally applies
16.55s the machine picture paints                             (1.4s, 570ms of it looking broken)
```

### The three causes, each measured

**1. The module graph was 2,318 KB across 41 files.** Walking the ES-module graph from
`js/ui.js`: Ball Run 988 KB is the next heaviest game in the hub, and the median of the ones
sampled (Pinball, Pool, Hill Climb, Escoba) is 328 KB. Skeeball was 7x that.

**2. All of it was re-downloaded on every single open.** With the whole game verifiably already in
the service worker's cache - warmed and confirmed present before the test - opening it still sent
**28 requests and 2,188 KB** to the server. `sw.js` was network-first for `.js`/`.css` with
`cache: 'reload'`, so the cached copy was only used if the network LOST the 2.5s race. The
deadline and the slow latch capped how bad that got; neither stopped it happening.

**3. Almost none of it was needed to draw that screen.** `engines.js` imported all five machines'
`physics.js` + `machine.js` + `render.js` statically, which drags in three.js (733 KB, its normal
two-file split build) and cannon-es (338 KB) - to show one still picture of THE CLASSIC. And
`_renderSetup` then drew a picture for EVERY slide, so five WebGL contexts were built against a
phone's small global budget before the player had swiped anywhere.

```
as shipped                                  41 files, 2318 KB
only the machine being shown                29 files, 1677 KB
... and physics deferred until Play         27 files, 1309 KB
```

The restart at 10.3s is the same story from the other end: 2.3 MB of resident JavaScript plus
three.js scenes is the footprint that gets a PWA's web view reclaimed on iOS. The GL teardown
itself was already careful (`releaseRenderer`, 2026-08-26) - this was weight, not a leak.

### What changed

- **`engines.js` loads a machine's three files on demand.** `loadEngine(id, { physics: false })`
  loads only what DRAWS a machine (the gallery picture, the how-to card); the default loads
  physics too and is what a rack needs. `engineFor(id)` is still synchronous - `game.js` calls it
  inside the physics step and cannot await - and now THROWS if that machine has not been loaded.
  **It does not fall back to the classic for a machine it simply has not loaded yet**: substituting
  one machine's physics for another is the precise failure the HARD RULE above exists to prevent,
  so it is loud instead. The unknown-board-id fallback is unchanged.
- **The gallery draws ONE machine at a time** (`_machinesWorthPainting`): the selected slide, plus
  any already drawn this session. The rest paint on the swipe that brings them into view, and the
  carousel's settle handler warms that machine's physics in the background - so Play is not where
  cannon-es gets downloaded.
- **`ensureCSS()` now resolves when the stylesheets have actually parsed**, and the constructor
  keeps the root hidden (an INLINE `visibility`, because `hub.js` sets `.hidden = false` on that
  same element the instant `init()` returns) until they have, capped at `CSS_WAIT_CAP_MS`. A sheet
  that 404s or hangs must never leave a player looking at a blank rectangle for ever. It also
  matches an existing `<link>` by resolved href now, so `skeeball/index.html`'s own
  `<link rel="stylesheet" href="css/skeeball.css">` is no longer loaded a second time on the
  standalone page.
- **`sw.js` serves the REST tier cache-first.** Root `CLAUDE.md`'s service-worker section carries
  the reasoning and what it deliberately does NOT cover; the short version is that the shell stays
  network-first, so the app still finds a new deploy on the next hub load.

### Measured after, same harness, warm cache

```
                                  before          after
bytes that left the device        2,188 KB        19 KB   (js/viewport.js + css/ui.css, both SHELL)
requests that left the device     28              2
import() the module graph         -               23 ms
init() (builds the DOM)           -                6 ms
tap -> the gallery on screen      -               ~50 ms, and never unstyled
```

The machine picture still costs one WebGL render after that (~100ms on Anita's phone, read off
her own recording at 16.48 -> 16.55s); it is deferred behind a painted screen and always was.

### Things that are still true, and one that is now a caveat

- The five machines are as isolated as they ever were - MORE so, since a machine is not even
  loaded unless it is the one on screen. Nothing in `machines/<id>/` was touched.
- Six node scripts call `engineFor` at module scope and now `await loadEngine(...)` first:
  `js/test.js`, `sweep-mover.mjs`, `test-brickcity-stall.mjs`, `test-runaway-capped.mjs`,
  `test-skeeball-capture-frame.mjs`, `test-skeeball-machine-spec.mjs`. A new one must too.
- **CAVEAT, accepted:** on the first hub load after a deploy, a game opened before `warmRest()`
  has reached its files runs the PREVIOUS build's code for that one visit. Measured on a fast
  local link, the window is about 15 seconds. Verified end to end (new worker installs -> new
  cache warms -> old cache deleted -> the device runs the new build), and it is why the shell is
  deliberately left on network-first.

## Adding the next machine

**Read `MACHINE-SPEC.md` Part 7 before you copy a `render.js` or a `physics.js`.** Every rule in it
is a defect that shipped on a real machine and made the hub sluggish, and none of them is catchable
by geometry, materials or colour rules. `test-skeeball-machine-spec.mjs` enforces the five that can
be read out of your source (`perf.context`, `perf.probe`, `perf.shadow`, `perf.textures`,
`perf.broadphase`); it runs over every board, so a new machine is covered the day its folder exists.
The one that is a CONTRACT rather than a preference: keep your `THREE.WebGLRenderer` in
`this.renderer`, because `js/ui.js`'s `releaseRenderer()` calls `r.renderer.forceContextLoss()` by
that name to hand the context back, and a machine that renames it leaks one per rack until the
browser throttles the whole hub.


1. Add an entry to `BOARDS` in `js/boards.js`: new frozen `id`, marquee `name` (a proper noun,
   untranslated), `taglineKey` (+ its `{en,es}` strings), `look`, `geom`, and
   `unlock: { board: '<previous id>', score: N }`. Obey `geom`'s spacing rule for every
   neighbour pair, and re-run the sweep - reachability is a property of the whole layout.
2. Run `node skeeball/js/test.js` — the sweep and soak run against every board in the list, and
   the unlock chain tests are already written (they currently exercise a synthetic future list).
3. `ui.js` needs nothing: the gallery, unlock checks (`unlocksEarned` → `unlockSkeeballBoard`),
   records panel and renderer are all board-generic. The unlock write is additive and merged as
   a union across devices, so a machine earned anywhere is earned everywhere.
4. Nothing in `sw.js` changes (no per-board assets). Update THIS file's header, which currently
   says one machine exists.

## Testing

- `node skeeball/js/test.js` — **50 assertions at `--full`, 20 without** (2026-08-22). The heavy
  physics blocks are grouped by what makes them go red, and a plain run skips all of them:

  ```bash
  node skeeball/js/test.js          # the cheap half only - what run-all-tests.mjs runs
  node skeeball/js/test.js --auto   # pick groups from what differs from origin/main
  node skeeball/js/test.js --mat    # or --reach --dial --ramp --holes
  node skeeball/js/test.js --full   # everything, minutes
  ```

  `reach` (the 41x21 sweep, the settle cap, the walkout rate) and `dial` (the power curve's
  shape) answer to any physical change; `ramp` (the ball gets airborne, a weak throw comes back)
  only to the ramp, lane and throw speeds; `mat` (the 100 stays a skill shot, the >2s rattle with
  real bounce events, the 250-throw soak) only to bounce and grip; `holes` (statistical left/right
  symmetry — knife-edge throws may split, since the solver iterates contacts in list order) only
  to hole positions and board dimensions. Always run, cheap: determinism, the nine-ball rules
  through the real API, the recorder payload shape, snapshot/restore, and the unlock chain.

  The old **harder-goes-further quarter-by-quarter** assertion was deleted 2026-08-21 at Matt's
  ask as obsolete; the ladder assertions in the `dial` group cover the same ground. Do not re-add
  it.
- `node test-game-conventions.mjs` — the shared checklist (viewport, touch, overlays, name gate,
  module contract, listener balance, dictionary, the layout-class collision rule).
- `node test-visual.mjs skeeball` — the only suite that LOOKS at it. Its PLAY probe swipes the
  real lane with real touch through full racks and asserts the score moved and the rack recorded.
  There is no separate MOTION probe for the same reason as Pinball: everything that moves is
  drawn into one canvas, so the canvas-sampling check lives inside the PLAY probe.

  **THE PLAY PROBE IS FLAKY, MEASURED, AND IT IS NOT YOUR DIFF** (2026-09-01). Run three times
  against an untouched `origin/main` checkout it failed **2 of 3** with *"threw a full rack and the
  rack-over sheet never appeared"*, and passed the third. The scripted swipes are timing-based
  against a SwiftShader canvas, so a slow frame turns a throw into a dribble and the rack never
  finishes inside the probe's budget. **Re-run it before you believe that particular failure**, and
  do not spend an afternoon bisecting your own change for it. A DIFFERENT failure message from the
  same probe is worth taking seriously. Fixing the flake properly means driving the rack off the
  game's own events rather than off wall-clock swipes, and is not yet done.

## Things a future session will want to know

- **No sound, no audio layer** — the arcade-cabinet precedent (Matt on Pinball, 2026-08-11:
  "Delete the sound option. No sound."). Nothing here constructs an AudioContext.
- **`skeeball.css` is two skins and the split is deliberate** (2026-08-13, the setup overhaul):
  the SETUP and HOW-TO screens belong to the hub — light `--sks-*` tokens on `.sk-root` with a
  `:root.gh-dark .sk-root` override (the pattern the retired build used) — while the PLAY screen
  keeps the warm dark arcade look in both themes (Ball Run/Hill Climb/Pinball's class). The
  header comment in the CSS marks where one skin ends and the other begins. Do not "unify" them.
- The swipe takes **the faster of the release flick and the whole gesture** (`swipeSpeed()` in
  `js/swipe.js`): the release window is the first sample within ~200ms of the end, to the end,
  and is discarded if it finished downward; the whole gesture is first sample to last. `max` of
  the two, so angling a throw costs no power. Power normalises against the stage height so a
  phone and a desktop feel alike. **Samples are clocked with `e.timeStamp`, never `performance.now()`** — under load the
  handlers run late and bunched, and handler-time clocking collapses a strong swipe into a
  dribble. That bug only shows on a busy main thread, which is exactly a cheap phone.
- `physics.js` has no randomness at all. If a future machine wants scatter, thread a seeded rng
  through `startThrow` and keep `simulateThrow` deterministic — the test suite depends on it.
- **Three WebGL lessons paid for in debugging time** (all in `render.js`, commented in place):
  a `position:absolute` canvas is a REPLACED element, so `inset:0` does not stretch it —
  `setSize(w, h, true)` must set the style or the frame is an unscaled top-left crop; software
  GL (SwiftShader — headless tests, GPU-less desktops) is detected up front and sheds shadows,
  antialiasing and resolution, or the main thread starves and even input dies; and
  `preserveDrawingBuffer: true` stays on because test-visual's play probe and Report a bug's
  screenshot both read the canvas, which is blank without it.
- `window.__skTest` (set in `init()`) is the read-only hook the headless drivers use to
  sequence real-touch play; the `__yzTest` precedent. Never used by the game itself.
- Machine names (`THE CLASSIC`) are proper nouns and stay untranslated, like STARHUB.
