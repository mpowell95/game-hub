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
```

**Editing `machines/popongo/physics.js` cannot affect THE CLASSIC, because the classic never
loads that file.** The isolation is the filesystem. There is no flag to set, no gate to remember
and no test you have to run first.

### Why it is built this way

Until 2026-08-23 all three ran one `physics.js`, one `machine.js` and one `render.js` - 2,330
lines - with per-machine behaviour written as branches (`cupBoard`, `collarH`, `cups`). Every
branch was somewhere a change for one machine could reach another, and one of them shipped:
`28299ac`, written for BASKET FEVER, rewrote the capture rule "on every machine" and moved **456
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
bucket, nothing orphaned by its removal. Three machines exist: **THE CLASSIC** (a
boardwalk cabinet with a varnished oak lane, the burnt-orange board with the white cup ladder,
twin corner 100 cups, and a marquee), **POPONGO** (2026-08-22, the real cup-board lawn game as
a second face on the same cabinet - see "POPONGO and the arrangement layer" below) and
**BASKET FEVER** (2026-08-22, the arcade basketball machine as a third face - see "BASKET FEVER"
below). The player
swipes up the lane; the swipe's speed is the roll's power and its angle is the aim. Nine balls to
a rack.

**The board was rebuilt to the REAL classic layout on 2026-08-13** against reference photos Matt
provided, after the first version shipped a wrong "bullseye" board invented from memory — the
exact failure `VISUAL-PROCESS.md` exists to prevent (look at the picture before you write code;
if there is no picture, ask for one). That rule was read and skipped anyway; do not repeat this.
The photos and researched behavior now live in this file and in `boards.js`'s `scoring` comment.

**ADMIN ONLY AGAIN since 2026-08-23** (Matt's ask), exactly like Pinball: the hub entry carries
`devOnly: true` and no `released` date. It WAS released 2026-08-22 and pulled back the next day,
after work done for POPONGO and BASKET FEVER turned out to be landing in the shared engine and
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
| `js/engines.js` | board id -> that machine's own `{ physics, buildMachine, Renderer }`. The ONLY file that knows the three engine folders exist; see the HARD RULE above |
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
  machine). Matt's clip showed BASKET FEVER paying a ball that rattled a rim and bounced out:
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
  cups (`g6`..`eqB` - each cup's value frozen to its id forever); `arrangement` maps slot to cup,
  defaulting to the product photo's staging. Hole values are STAMPED from the arrangement at
  module load, and `game.js` scores through `cupAt()`, so player-facing rearrangement later is a
  data remap plus a screen - never an engine or physics change (every cup is the same shape).
  Rearrangement is deliberately deferred: what custom layouts do to records and unlock
  comparability is Matt's call after he has played it.
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
- **The unlock is GOALS-BASED**: `unlock: { board: 'classic', goals: true }` = complete THE
  CLASSIC's three objectives. Applied by ui.js's `_earnedUnlocks` (after each recorded rack) and
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
- **And the honest rule cuts BOTH ways** (Matt's 23:42 clip, 2026-08-22, on BASKET FEVER): a
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

## BASKET FEVER (2026-08-22)

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
  in 459 throws, slowest settle 5.4s (DECISIONS.md#basket-fever-layout).
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
- **Goals** (`goals.js`, no new counters): sink the 100 hoop (per-board `bestThrow ≥ 100` -
  the top-centre hoop is the only 100 on the face, so the best throw IS the proof), 300+ in a
  single game (per-board best), 3,000 total points on the machine (per-board points). All three
  read `sk.boards.basketball`, synced and cross-device merged by `js/arcade-scores.js`.
- **Unlock**: `{ board: 'popongo', goals: true }` - complete POPONGO's three objectives. Same
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
  - **The baskets are a FULL 1.0X DEEP** (2026-08-24) - as deep as the mouth is wide, the real
    basket's proportion, where they were 0.35X and read as wire rings. This is a `geom` change,
    so it was swept on the 41x21 grid (basketball's engine only) before it shipped: 167/861 ->
    146/861 scored, all nine mouths capturable either way, 0 emergencies, slowest settle 5.51s ->
    5.39s, and the low row's share of every score down from 46% to 40%. `boards.js` carries the
    numbers and the reason depth is nearly free - do not shallow the collar back out to "fix"
    scoring.
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
  4.25in vs 6in), the one shot meant to be hard; (3) the back wall gets THE CLASSIC's rebound
  (basketball/physics.js's own `matBack`, `backRest 0.60 / backFric 0`) so a hard throw that used
  to bank high off the wall and drop into the 100 comes back at the player instead. The bounce is
  on the BACKBOARD ONLY - the tall wall ABOVE the top step; the riser directly behind the 100 is
  a normal surface, so a direct arc still drops in. Kick panel stays on `matDead`. Sweep after:
  emergencies 1.0%, all mouths reachable.
- **The ramp is STEEPER than the classic's, deliberately** - final segment 70 degrees (the
  spec's section 5 maximum) in six even steps, so the throw reads as a basketball SHOT: range
  up the face barely moves but the peak is higher and the descent steeper, dropping the ball
  into a basket from above. Re-swept at 70 degrees under the post-POPONGO capture physics
  (the `needH` rim rule): all nine hoops clean-capturable, 0 emergencies in 459 throws; ladder
  low row from p~0.28, middle p~0.52, top p~0.8, the 100 straight at p0.76-0.8.

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

## Adding the next machine

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
