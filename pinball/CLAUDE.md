# Pinball — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below overrides
> them. This game's answer to THE LAW is unusually short and is stated under "Persistence" — read
> that before adding anything to `store.js`.

A full single-table pinball machine: continuous 2D physics, two swinging flippers, a plunger with a
power meter, pop bumpers, slingshots, a drop target bank, a spinner, an orbit, a habitrail ramp, a
scoop, timed missions, lock-and-multiball, a wizard mode, an end-of-ball bonus count-up, and tilt.
Built 2026-08-11. The table is called **STARHUB** on the playfield art and the setup screen; the
game, the folder, the hub id and the stats id are all plainly `pinball`. The name is deliberately
short, machine-shaped and tied to the hub: the three top rollover lanes spell H-U-B, and the
playfield wordmark is painted STAR over H U B so the two echo each other. (It was "Nova Cadet" for
about an hour; that read as invented lore, which nothing else in this hub of plainly-named games
has.)

**Admin only for now.** The hub registry entry carries `devOnly: true`, so the card renders for Matt
and the tester and for nobody else, and the My Stats tab is gated the same way (`TABS` in
`js/game-stats-ui.js`) so an unreleased game does not leave a stray empty tab in everyone else's
stats. Releasing it is exactly two edits: delete `devOnly` from both.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../pinball/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `pinball` |
| Stats id | `pinball` (recorder `recordPinball`, sub-counter `pb`) |
| CSS root / prefix | `.pb-root` / `.pb-` |
| Settings key | `gamehub.pinball.v1` (one preference: the table) |
| Difficulty axis | the three TABLE settings, `easy` / `medium` / `hard`, straight onto the shared 1-4 tiers |
| `isInProgress()` | the **literal** meaning: `true` while a game is live |

`isInProgress()` is literal (Ball Run / Snake / Hill Climb's class, not Escoba's) because a ball in
flight cannot be meaningfully snapshotted: a saved mid-ball state would be a saved mid-shot, and
restoring it would either teleport the ball or silently drop the shot the player was in the middle
of. So leaving genuinely abandons the game and the hub confirms first. The setup screen is never in
progress; everything there is saved the instant it changes.

`immersive: true` because the game owns the whole viewport (a fixed edge-to-edge canvas, a
dot-matrix display, and full-height flipper touch zones). `.pb-root` is `position: fixed; inset: 0`
at `z-index: 1`, the same shape Hill Climb uses, so the hub's floating back button stays on top.
`.pb-hud-top` carries `padding-left: 84px` for exactly that reason: the back button sits in the
top-left corner in immersive mode.

## Files

| File | Role |
|---|---|
| `js/physics.js` | the deterministic solver: shapes, contacts, impulses. Pure, no DOM |
| `js/table.js` | the playfield as data: every wall, post, bumper, target, switch. Pure |
| `js/game.js` | the rules: balls, scoring, missions, multiball, bonus, tilt. Pure, emits an event stream |
| `js/render.js` | the canvas: cached static playfield art plus the whole effects layer |
| `js/store.js` | one preference, the table (see "Persistence") |
| `js/strings.js` | the EN/ES dictionary |
| `js/ui.js` | DOM shell, input, HUD, the hub module contract |
| `js/test.js` | headless tests, including the soak (see "Testing") |

The first three are DOM-free and that is load-bearing, not tidiness: `node pinball/js/test.js` plays
thousands of simulated seconds without constructing a single element.

## The table

400 x 760 logical units, y down, ball 18 across. **Every clearance in `table.js` is checked against
that 18**: a channel meant to pass a ball is at least 24 wide, and anything narrower than 18 is
deliberately sealed. See the shot map in `table.js`'s header comment.

Shots, and which flipper feeds them:

| Shot | Fed by | What it does |
|---|---|---|
| Ramp (centre) | either | habitrail to the right inlane. 5 ramps light the lock; during multiball it is the JACKPOT |
| Scoop (up the right wall) | left | mission start / lock / super jackpot, in that priority order |
| Drop bank (upper left, 4 targets) | right | clearing it lights the scoop for the next mission |
| Left orbit (past the spinner, round the arch) | right | spinner rips plus a combo-multiplied orbit award |
| H-U-B lanes (across the top) | bumper kickouts | each completed set raises the end-of-ball bonus multiplier, to 8x |
| Stand-up targets (both side walls) | anything | small points, and a soft outlane defence |

Three mechanisms carry most of the table's behaviour and each has a comment where it is defined:

- **The arch is a real 34-wide channel**, not a decorative ceiling, formed by two concentric arcs.
  The plunger fires into it and a left-orbit shot travels the whole way round and drops back into
  the playfield at the top right. The inner arc deliberately stops 20 degrees short of vertical on
  the right; that gap IS the orbit's exit. Closing it makes the orbit a dead end.
- **Two one-way gates.** The shooter-lane gate exists only for a DOWNWARD-moving ball, so a launch
  passes through it and a returning orbit ball is caught and rolled out into the playfield instead
  of dribbling back to the plunger. The orbit deflector uses the identical trick for the opposite
  reason: the left lane has to be enterable from below (that is the orbit shot) while still spitting
  a returning ball into the playfield rather than straight into the outlane.
- **The ramp is a scripted habitrail, not simulated.** Entering the mouth fast enough (`needUp`)
  hands the ball to `RAMP_PATH` for 1.15 s; entering it slowly bounces the ball back down. This is
  how a real ramp behaves and it is far kinder than trying to simulate a banked wire in 2D.

### Wedges: the failure mode this table actually has

A pinball table is convex shapes near other convex shapes, and **two convex surfaces a little under
one ball apart make a permanent parking space**. The ball rolls in, touches both, and stops forever;
it is a stable equilibrium, so nothing shakes it loose. Four of these shipped in the first draft and
all four were found by `test.js`'s soak, never by reading the code:

1. The scoop two units off the right wall — every ball parked at (358, 268).
2. The inlane divider's end cap a few units clear of the flipper pivot — parked at (258, 624), and
   untouchable, because the contact point is the pivot itself where the paddle's surface speed is
   exactly zero. Fixed by OVERLAPPING them into one convex blob, which has no stable top.
3. The stand-up targets a ball's width off the side walls.
4. The Casual outlane save, twice: a blocking post (an outlane is 56 wide, so no disc both fills it
   and leaves clearance) and then a rail across the bottom (an outlane is a dead end, so anything
   that stops the ball there has nowhere to send it). The right answer was a post at the outlane's
   MOUTH, wedged between the side wall and the top of the inlane divider, which rolls the ball into
   the inlane instead — which is what a real outlane post does.

**If you move the scoop, a bumper, a divider or a wall, re-run `node pinball/js/test.js` before
anything else.** The soak is the only thing that finds these.

A fifth failure of the same family showed up only in a browser: the cached static playfield bitmap
is painted WITH the centring transform already applied, so blitting it under that transform again
shifted the whole table sideways and clipped the shooter lane off the screen. Headless tests cannot
see it; `node test-visual.mjs pinball` and a screenshot can. Look at the contact sheet.

### The scoop loop: a stuck ball that was scoring, not silent

Shipped and found by Matt on his second test game (2026-08-11): he shot the scoop on ball one and
banked **1.5 million** while the ball sat in it. The switch edge-detector read
`!b.held && dist < r`, so a HELD ball counted as outside its own switch. A capture parks the ball on
the switch centre, so the instant the scoop ejected it - still well inside the 10-unit radius - the
detector saw a fresh rising edge and captured it again. Eject, re-capture, score, eject, at 2.2
awards a second, forever. `inside` is now purely geometric, which makes a held ball read as inside
its own switch and stops the switch re-arming until the ball has genuinely left the radius.

**The interesting half is why the tests missed it.** Both stuck-detectors in `test.js` are built on
"stuck means nothing is happening": the soak watched for the SCORE not moving, and the ball-search
watchdog watches for the BALL not moving. This bug maximises the first and is exempt from the second,
because a held ball is deliberately skipped by the watchdog. A stuck ball that is *scoring* fell
straight through the gap between them.

So there are now two new invariants, not a tightened threshold:

- `game.js` caps how long a ball may be HELD (`MAX_HOLD`, 3 s). Every legitimate hold is short and
  known - the ramp ride is `RAMP_TIME` (1.15 s), a scoop hold is under a second - so anything past
  that is a bug, and it releases the ball and logs loudly rather than letting it sit.
- `test.js` has a deterministic `[KNOWN-BUG PROBE]` firing a ball into the scoop and asserting ONE
  award, plus the same for the ramp, plus a soak invariant on the longest held time. All four were
  verified RED against the old code before the fix landed.

**If you add another capture switch, it is the held-time invariant that will catch you, not the
score one.**

The **ball-search watchdog** in `game.js` is the safety net under all of it, and it measures
DISPLACEMENT FROM AN ANCHOR, not speed. The first version watched for speed < 26 and never fired,
because a wedged ball jitters: it crosses any speed threshold several times a second while going
precisely nowhere. Displacement cannot be fooled that way.

## The rules

- 3 balls (5 on Casual). Ball save at the start of each ball, 12 / 8 / 3 seconds by table.
- **Missions**: clear the drop bank to light the scoop, shoot the scoop to start one. Four in fixed
  order (Bumper Rush, Spinner Mania, Ramp Frenzy, Target Storm), each timed and each scored off ONE
  kind of switch so the shot being asked for is obvious from the table, not only from the display.
- **Multiball**: 5 ramps light the lock, 3 locks start it. Ramp = jackpot (growing), 3 jackpots light
  the scoop for the super jackpot. Ends when one ball is left.
- **Wizard**: all four missions completed starts a 45-second 3-ball multiball at triple scoring.
  Ending it reopens the mission ladder, so a good player loops.
- **Bonus**: counted UP over 1.5 s at the end of every ball, because the count-up is the moment the
  player finds out whether chasing the H-U-B lanes was worth it.
- **Tilt**: three nudges inside the decay window kills the flippers, wipes the bonus and loses the
  ball. `_award()` returns early while tilted, so a tilted table scores literally nothing.
- Extra balls at 750,000 and 2,500,000, once each.

Scoring lives in one object, `PTS` in `game.js`. Retune there, nowhere else.

## Persistence

**`gamehub.pinball.v1` holds the difficulty and nothing else, and that is deliberate.** A pinball game's one piece of earned history is the score, and the obvious thing to
do is keep a local top-ten table — which would make `store.js` a second, unsynced, silently
truncating home for data a player earned. Instead the ONLY record of a pinball score is
`recordPinball()` in `js/game-stats.js`: per player, `Math.max` on both bests, mirrored to Firebase
by `stats-net.js`, combined across a person's devices by `players-agg.js`, displayed by My Stats.
`store.js`'s `bestScore()` READS that store to put the number on the setup screen; it never writes
one of its own. Nothing in this game's own storage can lose anything, because nothing earned is in
it. Both stored values are one-tap-recreatable preferences, so THE LAW rule 2's carve-out applies.

The `pb` sub-counter got all three of "Adding a game" item 7's edits on day one: `ensurePb` +
`recordPinball` in `js/game-stats.js`, `pinballScreen` in `js/game-stats-ui.js`, and an explicit
branch in `js/players-agg.js` (with a regression case in `players-agg.test.mjs`). Counters add; both
bests take `Math.max`. **Summing a best score would be the worst kind of wrong available here**: it
invents a game nobody played, and the shared store only ever grows, so it could never be undone.

## Testing

`node pinball/js/test.js` (wired into `run-all-tests.mjs`). 66 assertions in five blocks:

1. **The solver** — gravity, restitution, the one-way gate in BOTH directions, that a swinging
   flipper throws the ball and a flipper held at its stop does not, the speed cap, ball-vs-ball.
2. **Table geometry** — no switch buried in a solid, everything on the table, the habitrail
   continuous and ending at the right inlane.
3. **The rules** — driven through the real contact and switch entry points, never by poking fields,
   so a rename in `game.js` fails the test rather than silently passing.
4. **The soak** — six full games of random flipper input, asserting on EVERY step that no ball
   leaves the table, that nothing wedges, that balls really drain and that the ball count stays
   sane. It deliberately does NOT assert "every game finishes": random flipping is an
   unrealistically good pinball player, so a random driver on Casual legitimately keeps a ball alive
   for minutes, and failing on that would be testing the driver rather than the table. The full
   drain → bonus → next ball → game over chain is proved separately and deterministically in 4b.
5. **The recorder payload** — that `result()` reports the difficulty key and counters the stats layer
   expects.

`node test-game-conventions.mjs` covers the shared checklist (viewport, touch, overlays, the name
gate, the module contract, listener balance, the dictionary, the layout-class collision rule).

`node test-visual.mjs pinball` is the only suite that LOOKS at the game, and this one has a **PLAY
probe from day one** (`VISUAL-PROCESS.md` is the process it belongs to; the Pool incident in
`test-visual.mjs`'s PLAY header is why the rule exists). The probe holds the plunger the way a
player does, samples the canvas three times to prove the playfield is actually animating, then taps
the two flipper zones until the score moves. It asserts the score moved, which nothing but real
contacts with real scoring parts can do.

**There is deliberately no MOTION probe.** That harness follows a DOM element's bounding box over
time, and every moving thing in this game is drawn into one canvas: there is no element to follow.
Rather than invent one for the test's benefit, the canvas-shaped equivalent lives inside the PLAY
probe (three frames a fifth of a second apart, failing if they are identical), which catches the
same failure MOTION exists for. Every run still prints "No motion probe yet: pinball"; that is the
honest state and this paragraph is the reason.

## Every "Play again" left a loop running (2026-09-01)

Ported from Skeeball, which had this exact defect and fixed it on 2026-08-26
(`skeeball/CLAUDE.md`, "Frame rate: why it got slower the longer you played"). Found by an audit of
the whole hub for the same shape, not by a report.

`_startGame()` armed a rAF chain unconditionally, and it is reachable from **two** places: the setup
screen's Play, which `_renderSetup()` precedes with `_stopLoop()`, and the game-over card's "Play
again", which does not. `_frame` re-arms at the top of every frame and `_stopLoop()` only ever held
the LAST chain's id, so every "Play again" left the previous chain running with nothing able to
cancel it.

**The orphans outlive the game.** `destroy()` cannot reach them, so they keep stepping physics and
drawing **in the hub** for the life of the page — leave Pinball after a few replays and the
launcher, and whatever you open next, are sharing the frame budget with dead tables.

Measured in Chromium, counting rAF callbacks per half-second (one chain at 60 fps ≈ 30):

```
                                      before      after
one game running                          29         29
after three more "Play again"            116         29
after destroy(), back on the hub          87          0
```

The fix is `_startLoop()`, idempotent — `if (this.raf) return;` — exactly as in
`skeeball/js/ui.js:1275`. Re-run the count above after touching `_startGame`, `_frame` or
`_stopLoop`. **Nothing enforces this yet**: a `test-game-conventions.mjs` check for rAF idempotence
is planned but not written, so for now this defect is caught by reading the code, which is exactly
how it survived here for as long as it did.

## Things a future session will want to know

- **The speed cap is a correctness bound, not a difficulty knob.** `MAX_SPEED / PHYS_DT` is the
  distance a ball travels per step, and it has to stay well under the thinnest wall. Raising it
  without shortening `PHYS_DT` re-opens tunnelling, and the ball leaves the table.
- **The static playfield art is cached into an offscreen canvas keyed on device-pixel size.** If you
  add painted art that needs to change during play, it does NOT belong in `_paintPlayfield`.
- **Reduced motion thins the garnish, it does not freeze the game.** Shake, full-screen flashers and
  most particles go; the ball, the flippers and the lamps stay. A pinball table that does not move
  is not a pinball table, and `test-visual.mjs` drives this game in that mode.
- **There is no sound, and no audio layer.** Not muted, not defaulted off: `audio.js` is deleted and
  nothing constructs an AudioContext (Matt, 2026-08-11: "Delete the sound option. No sound."). The
  setup screen has no toggle. It is one commit back in git if it is ever wanted again.
- **The How To Play screen follows the repo-wide pattern** in `docs/BUILDING-A-GAME.md` and nothing
  else: one bold sentence, ONE diagram carrying the non-obvious part, a caption, an X = Y example,
  then short plain rules. The first version was five paragraphs of prose that re-explained pinball
  to people who already know what a flipper is; what a player actually does not know is WHERE THIS
  TABLE'S FOUR SHOTS ARE, and that is a picture. If you add a mode, resist adding a paragraph.
- Spanish keeps the borrowed pinball vocabulary (flipper, bumper, jackpot, tilt, multibola) because
  that is what Spanish players say — the same standing rule that keeps Oros/Copas in English.

## The second board: ROYAL FLUSH, imported (2026-08-29)

Matt, on STARHUB: *"our pinball is FAR from being finished. Sure, it might have all those things,
but they don't work."* And on the 2026-08-20 pitch/friction attempt at his "vertical wall"
complaint: *"You tried, but it didn't make the game better."* Then: *"I'd rather you do what i said
and find a board someone else created and 'import' it. Our board is not worth salvaging."*

**PROVENANCE, stated plainly.** The ROYAL FLUSH playfield is **table9.json from Vector Pinball by
dozingcat** (https://github.com/dozingcat/Vector-Pinball). The layout is that project's design. Only
the conversion, the rules and the renderer here are ours. **Vector Pinball is licensed GPL-3.0.**
This repo carries **no license file** and Matt has explicitly not decided to add one: he asked to
use the boards without one, and was told plainly that "not making money" does not exempt a
distribution from that license. So this note is a record of where the layout came from - it is
**not** a claim of compliance. If the repo is ever made to comply, the missing pieces are the
license text and keeping the hub publicly readable. **Do not delete this paragraph to tidy up.**

### Why it is a whole second engine and not a `board` flag in game.js

`game.js` is welded to STARHUB's shot map: missions keyed off a scoop, a lock lit by five ramps, the
H-U-B lanes, `RAMP_PATH`. Royal Flush has none of them - no scoop, no H-U-B, four drop banks instead
of one, an upper right flipper. Threading two shot maps through one 849-line class would put a board
check on every rule in it. So:

| File | Role |
|---|---|
| `tools/import-vp-table.mjs` | GENERATOR: their JSON -> our shapes. Re-runnable |
| `js/table-royal.js` | GENERATED geometry. Do not hand-edit |
| `js/royal.js` | `RoyalPinball` - the rules, small and deliberately dumb |
| `js/render-royal.js` | `RoyalRenderer` - draws the geometry, vector style |

`RoyalPinball` and `RoyalRenderer` expose exactly the surface `ui.js` already drives, so the engine
choice is **one line** at mount and nothing downstream knows which board is running.

### What the import includes

Matt, after the first attempt: *"the fix is to implement the board exactly as is. Don't simplify or
change anything. Make it work with our gamehub setup but do not take any creative liberties."* The
first import broke that twice and both are fixed:

- **ALL FOUR LAYERS.** 1,315 wall segments - 585 on the playfield and 730 across the three elevated
  ramps - plus the 18 sensors. Seven of those sensors MOVE the ball between levels (an entry and an
  exit per ramp); the other eleven are event triggers, live only while the ball is on their layer.
  The first import kept layer 0 only, throwing away roughly half the table.
- **EVERY COLOUR IS THE TABLE'S.** 53 elements carry an explicit `color`; where one does not, the
  generator fills in **Vector Pinball's own default read from their source** (wall rgb(64,64,160),
  bumper rgb(0,0,255), rollover/drop/flipper rgb(0,255,0), spinner rgb(224,224,224)). 37 elements
  carry an `inactiveLayerColor`, which is how their renderer shows a ramp the ball is not currently
  on - honoured exactly. **No colour in `render-royal.js` is a choice of ours**, and the background
  is black because Vector Pinball is a vector game. If a colour looks wrong, the conversion is wrong.
- **Arcs are tessellated, not converted.** 21 of their 39 arcs are ELLIPTICAL, which our circular
  `arc()` cannot express. Each carries its own `segments` count, so the resolution is theirs.
- **What is NOT taken is their RULES** - the Java `Field9Delegate`. Scoring is the parts themselves
  at the source table's own point values. No missions, multiball, bonus or tilt yet.

**The renderer was wrong twice before this, both times my fault, not the table's:** first flat
hairlines in invented colours ("what? it looks terrible"), then an invented felt-green playfield with
a glow and a vignette - a creative liberty, which is the thing that was explicitly not wanted. The
file header records both so a future session does not decorate it again.

### Two things the first soak found, both worth keeping

1. **`kill: true` is the DRAIN, not a wall.** Built as a collider it becomes a solid floor: the
   first soak scored normally and **never drained once in four 240-second games**, because the ball
   bounced off the bottom of the table forever. `DRAIN_Y` now comes from that element's own y.
2. **Imported geometry parks balls, and the ball search is not optional here.** With the drain
   fixed, the soak logged **44 episodes of a ball sitting still for over 12 seconds**, one of them
   taking **185 rollover awards while parked in a lane** - a stuck ball that SCORES, the exact
   failure this file records STARHUB shipping once already. `_ballSearch()` measures DISPLACEMENT
   FROM AN ANCHOR, never speed, for the reason written up above: a wedged ball jitters. That took
   stuck episodes to **zero**. This is 583 segments we did not shape, so the watchdog is the safety
   net, not a tuning knob.

### The number this board exists to expose

**Their gravity, in our units, is 80. STARHUB's is 564.** A ball crosses their field in **3.87 s**
against STARHUB's **1.64 s** - their ball is **2.4x floatier**, on a layout people actually enjoy
playing. Their field is also shorter (600 vs 760) and their ball bigger (20 vs 18). Every axis says
the same thing: tighter, busier, slower. Whatever happens to Royal Flush, that comparison is the
most useful thing to come out of it, and STARHUB's own gravity should be read against it.

### The bug actually behind "the ball never drains"

For two builds the ball almost never drained and parked constantly, and I blamed the physics: their
gravity was tuned against Box2D, our solver has no rolling, taking one without the other cannot
work. All of that is true. **None of it was the cause.**

**Their walls are zero-width lines** (`Box2DFactory.createThinWall`); ours are capsules. The import
gave every wall `r: 3`, and that radius is eaten out of every channel on the table FROM BOTH SIDES.
Their shooter lane is a 24-unit channel (x 374 to 398). Three a side leaves 18. **The ball is 20
across.** It could not fit down its own launch lane.

One 20-line histogram of where the ball actually sat found it immediately: **84% of ball life in the
top-right corner**, wedged at the top of a lane too narrow for it. `WALL_R = 1` leaves 22 units of
that 24-unit lane, and tunnelling stays bounded by a wide margin - 3.8 units of travel per step
against a ball+wall radius of 11.

Same soak, same seed, before and after:

| | before | after |
|---|---|---|
| parked over 12 s | 53 | **0** |
| drains across 5 games | 2 | **6** |
| ball searches | 358 | **40** |
| games reaching game over | 0/5 | **2/5** |

**The lesson worth keeping: profile where the ball IS before theorising about why it misbehaves.**
Three rounds of physics reasoning were downstream of one wrong constant.

Three of five games still run past 300 s, but that is the artifact STARHUB's own soak already
documents - a random flipper driver is an unrealistically good pinball player.

**Rolling friction was added along the way and is worth keeping** (`physics.js`'s `resolve()`).
`mu` is Coulomb now, bounded by the normal impulse, and `ball.spin` is a real degree of freedom
instead of a render-only fake that nothing ever drew. Plain Coulomb friction WITHOUT rolling made
this board dramatically worse (parked episodes 24 -> 96), because friction with nowhere to put the
energy can only brake: every slope became flypaper. STARHUB is untouched either way - all its
colliders pass `mu = 0`, so the branch multiplies out to zero.

### Four soaks said it worked. Playing it took thirty seconds to prove otherwise.

Matt, after the fourth green headless run: *"you need to play it."* He was right, and the first real
browser session found three things no headless test could:

1. **Every scoring event threw.** `ui.js`s `_drainEvents()` reaches into the renderer for each event
   - `R.hitBumper`, `R.spawnHit`, `R.kick`, `R.hitRamp`, `R.hitLane`, `R.popup` and more - and
   `RoyalRenderer` had none of them. One uncaught error per contact, forever. Those methods exist
   now: real where this board has something to show, honest no-ops where it does not (no scoop, no
   slingshots, no stand-ups).
2. **`ev.id.slice(3)` threw on every bumper hit.** That id is STARHUBs `pop0`/`pop1`/`pop2`; this
   board emits an index as `ev.i` and no id at all.
3. **The display named a shot the table does not have.** `_objective()` fell through every branch to
   `hint_bank` - "Drop the 4 targets" - which is STARHUBs bank.

All three are in the DOM/renderer glue, which `pinball/js/test.js` deliberately never constructs.
**So a green engine suite says nothing about whether this game runs.**

**`test-visual.mjs` CAN run on Matts machine**, and it was skipping for a fixable reason: it looks
for a Chromium and there is no playwright browser installed, but `playwright-core` IS in
`node_modules` and Chrome is at `C:\Program Files\Google\Chrome\Application\chrome.exe`. Point
`CHROMIUM_PATH` at it. There is no excuse for shipping this game unplayed again.

### Three more, all found by playing, none findable headlessly

A second real browser session, after the first one fixed the thrown events:

1. **`R.flash is not a function`.** `RoyalRenderer`'s constructor set `this.flash = new Map()`, and
   that instance property SHADOWED the `flash()` method `ui.js` calls. The Map is `flashes` now.
   A property quietly eating a method of the same name is invisible to anything that does not
   construct the class and then call it.

2. **A rollover paid out on every pass, forever.** Instrumented play showed the ball pinned against
   the left wall at x 16-20, y 400-430, drifting in and out of one lane: **eighteen awards over
   thirty-one seconds, 9,000 points, on ball one, with the player doing nothing.** It is the STARHUB
   scoop bug in a different coat. A lane LIGHTS now and pays nothing while lit; completing a set
   pays a bonus and clears it, which is what `RolloverGroupElement` is for.

3. **The ball rolled back down the shooter lane and died there.** Their table keeps it out with a
   `LaunchBarrier` wall their Java rules raise after a launch; it ships `disabled: true` and we do
   not take their rules, so nothing ever raised it. Result: launch, return, sit. **Score 0 for a
   hundred seconds with three balls unplayed.** `_shooterLane()` hands a slow ball in the lane back
   to the plunger - what a real machine does, and what STARHUB's own shooter-lane rest check does.

**And the ball search was measuring the wrong thing.** It reset its timer whenever the ball got 22
units from an anchor, so a ball oscillating in place kept resetting it and sat for thirty-one
seconds. It tracks a BOUNDING BOX over a window now: "not going anywhere" rather than "not moving".

After all three: ball one lasts about 75 seconds, drains, **the game advances to ball two**, ~20,000
points off 25 bumper hits, 10 drop targets and 2 cleared banks, no page errors, and no scoring
without a player. That is the first build of this board that is actually a game.

### The number that made it unplayable: `targetTimeRatio`

Matt, after the "playable" build: *"dude it's terrible. absolutely unplayable."*

He was right, and the cause was one field in the source table I had read past. `table9.json` carries
**`targetTimeRatio: 2.3`**, and Vector Pinball's `FieldDriver` uses it as the CLOCK:

```java
long fieldTickNanos = (long) (nanosPerFrame * field.getTargetTimeRatio());
```

**Their engine advances the world at 2.3x real time.** Run the same table at 1x - which is what every
build before this did - and every shot, drop, bounce and flip is 2.3 times too slow. A free fall down
the field takes **3.87 s instead of 1.68 s**. For comparison STARHUB's is 1.64 s and a real machine is
about the same. The board was not badly imported at that point; it was being played in slow motion.

`royal.js`'s `update()` multiplies the (already clamped) real dt by `T.TIME_RATIO`. Measured after,
in a real browser: peak ball speed **947-1036 units/s** where it had been ~200, the ball reaches the
top of the table (y 18), the score climbs continuously, and balls drain and advance.

**And the ball search now gives up.** Three failed shoves and the machine re-serves the ball to the
plunger, which is what a real machine does when ball search cannot find it. This board has narrow
pockets a sideways shove simply cannot empty - the shooter lane is one, and a browser session found
another on the right at about (363, 400-480) where the ball sat with the score frozen for twenty
seconds. Without the give-up rule a game can dead-end with balls still on the card, which is the
difference between hard and broken.

**Every one of these was a number that was in the source file the whole time.** The pattern across
this whole import is the same: wall radius, restitution, friction, and now the clock. When this board
feels wrong, the next thing to check is which of their constants is still being ignored - not our
physics.
