# Pinball — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file; the full rules with rationale are in `js/CLAUDE.md`. Nothing below overrides
> them. This game's answer to THE LAW is unusually short and is stated under "Persistence" — read
> that before adding anything to `store.js`.

A full single-table pinball machine: continuous 2D physics on a real 6.5-degree playfield, four
swinging flippers (a main pair and an upper pair, on two buttons), a plunger with a power meter, pop
bumpers, slingshots, a drop target bank, a spinner, an orbit, a centre ramp, a scoop, a skill shot,
timed missions, lock-and-multiball, a wizard mode, an end-of-ball bonus count-up, and tilt.
Built 2026-08-11; **playfield and physics rebuilt 2026-08-14** (see "The 2026-08-14 rebuild" below,
which is the first thing to read if a number in here looks arbitrary). The table is called
**STARHUB** on the playfield art and the setup screen; the
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
| Difficulty axis | the three TABLE settings, `easy` / `medium` / `hard`, straight onto the shared 1-4 tiers. Each one IS a playfield pitch: 6.0 / 6.5 / 7.0 degrees |
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
| `js/physics.js` | the deterministic solver: shapes, contacts, impulses, Coulomb friction, coil re-arm. Pure, no DOM |
| `js/table.js` | the playfield as data: every wall, post, bumper, target, switch. Pure |
| `js/game.js` | the rules: balls, scoring, missions, multiball, bonus, tilt. Pure, emits an event stream |
| `js/render.js` | the canvas: cached static playfield art plus the whole effects layer |
| `js/store.js` | one preference, the table (see "Persistence") |
| `js/strings.js` | the EN/ES dictionary |
| `js/ui.js` | DOM shell, input, HUD, the hub module contract |
| `js/test.js` | headless tests, including the soak (see "Testing") |

The first three are DOM-free and that is load-bearing, not tidiness: `node pinball/js/test.js` plays
thousands of simulated seconds without constructing a single element.

## The table (rebuilt 2026-08-14)

**The whole table is on a real-world scale now, and that is the single most useful fact in this
file.** A pinball is 1 1/16 in (26.99 mm) across and it is 21 units across, so

```
1 unit = 1.285 mm = 0.0506 in        400 x 820 units = 20.2 x 41.5 in
```

and a real WPC playfield is 20.25 x 42 in. `table.js` exports `MM_PER_UNIT`; `probe`-style questions
("is that gap right?") are now arithmetic instead of taste. **Every clearance is checked against the
21-unit ball**: a channel meant to pass a ball is at least 24 clear, and anything narrower than 21 is
deliberately sealed. See the shot map in `table.js`'s header comment.

Shots, and which flipper feeds them (percentages are `test.js`'s REACH block: the share of a fan of
timed flips that lands the shot, which is the only honest way to say a shot exists):

| Shot | Fed by | What it does |
|---|---|---|
| Ramp (the teardrop, dead centre) | either (36% / 42%) | habitrail to the right inlane. 5 ramps light the lock; during multiball it is the JACKPOT |
| Scoop (upper right) | left (18%) | mission start / lock / super jackpot, in that priority order |
| Drop bank (across the TOP, 4 targets) | **the upper flippers** | clearing it lights the scoop for the next mission |
| Left orbit (past the spinner, round the arch) | right (8% spinner, 6% all the way round) | spinner rips plus a combo-multiplied orbit award |
| H-U-B lanes (under the arch) | upper flippers, bumper kickouts | each completed set raises the end-of-ball bonus multiplier, to 8x |
| Star rollover (centre, above the ramp) | either | the SKILL SHOT on the first shot of a ball, then a combo award |
| Stand-up targets (both side walls) | anything | small points, and a soft outlane defence |

Four mechanisms carry most of the table's behaviour and each has a comment where it is defined:

- **The arch is a real 38-wide channel**, not a decorative ceiling, formed by two concentric arcs.
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
- **There are FOUR flippers, on two buttons.** The upper pair sits on the shoulders and shares the
  left/right buttons with the mains, which is how every real machine with an upper flipper is wired
  (a pinball cabinet has two buttons). They are not decoration: the teardrop ramp stands between the
  main flippers and the top of the table on purpose, so the drop bank - and therefore every mission
  - is only reachable from the upper pair. `test.js` asserts that.

### The 2026-08-14 rebuild: what Matt reported, and what each thing actually was

Four reports in one message, and three of them turned out to be the same class of mistake - a
number that had never been checked against reality.

**1. "The ball falls as if the machine is a vertical wall. Real pinball is much flatter than 90
degrees vertical."** A real cabinet is pitched **6.5 degrees**, and the ball ROLLS rather than
slides, so a solid sphere's downhill acceleration is `(5/7) g sin(6.5) = 0.79 m/s^2` - one twelfth
of a free fall. The old table used a flat `GRAVITY = 1150` units/s^2, which on this scale is an
effective pitch of about 14 degrees: every shot arced back down roughly twice as fast as it should,
so trajectories curved instead of running long and nearly straight. `gravityForPitch(deg)` in
`game.js` does the conversion, and **the three difficulties are now literally the three pitches a
real operator picks between** - 6.0 / 6.5 / 7.0 - which is also why they are so close together: 6 to
7 degrees IS the whole adjustment range. A ball now takes ~1.5 s to roll the length of the
playfield, which `test.js` asserts.

**2. "The paddles are too close together. The space between them barely fits the ball... Look
online for a real answer for this spacing."** The real answer, from the WPC flipper-hole spec and
the Williams bat dimensions:

| | Real machine | Old table | Now |
|---|---|---|---|
| pivot to pivot | 6 13/16 - 7 in | 7.6 ball widths (~8 in) | 6.88 in |
| bat length | 2.8 - 3 in | 3.2 ball widths | 2.83 in |
| gap between tips AT REST | ~1.5 ball widths | **1.24** | **1.57** |
| gap with both flippers HELD UP | a shade over 1 ball | - | 1.18 |

The old table was measurably tighter than any real machine, which is exactly what "barely fits the
ball" describes. `flipperGap()` is exported and `test.js` asserts both figures **in ball diameters**,
so this cannot drift again with a change of scale.

**3. "When the ball is rolling on the bottom level, it drastically slows down when it hits the
paddle."** It was not the paddle. `resolve()` removed a fixed FRACTION of the tangential speed on
every resolved contact - and a resting contact is re-resolved on every physics step, 480 times a
second. At `mu = 0.05` that is a 42 ms time constant: a ball rolling along **any** surface in the
table lost 92% of its speed in a fifth of a second, and the flipper is simply where a rolling ball
spends longest. Friction is Coulomb now (the tangential impulse is bounded by `mu` x the NORMAL
impulse), so a resting ball barely feels it, and the honest constant per-second loss a rolling ball
should have comes from `ROLL_A` instead - a real rolling-resistance coefficient of about 0.006.
`test.js` carries the `[KNOWN-BUG PROBE]`, verified RED against the old resolver (400 -> 33 u/s).

**4. "Redesign the board layout to be a clone of the left side of the attached image."** Done, with
three deliberate deviations, all forced by (2). **The reference table's flippers are about eleven
ball-widths apart**; at the real 6.5 the same layout is unplayable, and where the two instructions
collided the real spacing won because Matt asked for it by name.

- **The centre teardrop is smaller than the reference's.** Its round bottom sits between the
  reference's very wide flippers; at real spacing a big round island directly above the drain gap
  swallows every shot. A fan of 2-degree test shots had the ramp at 45% and *everything else at
  zero*. It is now r=40 - as large as the left-flipper-to-scoop diagonal will allow, and that
  diagonal is what sets the number.
- **The middle arcs of coloured dots are painted lamp inserts, not posts.** The blueprint draws them
  as circles with a centre hole, which is a lamp; eleven posts across the middle of a playfield is a
  bagatelle, and as posts they were a wall with holes in it. Two real posts remain, out on the
  shoulders where a real machine guards the outlane approach.
- **The lower playfield keeps conventional slingshots, inlanes, outlanes and dividers**, which the
  reference render does not obviously show but its own blueprint's bottom corners imply.

Everything else is the reference: the four-target bank across the top, the twin pop bumpers under
it, the pair of upper flippers on the shoulders with their wire feeds, the centre rollover, the
insert arcs, the big teardrop centre ramp, the side stand-ups, and **the pop bumper dead centre
BELOW the main flippers** - the layout's most distinctive idea, which throws a ball that slips the
flipper gap back into play about half the time. It cannot seal the drain: the funnels leave a
95-unit channel down each side of it, so a centre drain is still a real way to lose a ball.

### Wedges: the failure mode this table actually has

A pinball table is convex shapes near other convex shapes, and **two convex surfaces a little under
one ball apart make a permanent parking space**. The ball rolls in, touches both, and stops forever;
it is a stable equilibrium, so nothing shakes it loose. Four of these shipped in the first draft and
all four were found by `test.js`'s soak, never by reading the code:

1. The scoop two units off the right wall — every ball parked beside it.
2. The inlane divider's end cap a few units clear of the flipper pivot — parked there for four
   minutes of game time and untouchable, because the contact point is the pivot itself where the
   paddle's surface speed is exactly zero. Fixed by OVERLAPPING them into one convex blob, which
   has no stable top.
3. The stand-up targets a ball's width off the side walls.
4. The Casual outlane save, twice: a blocking post (an outlane is wider than any disc that also
   leaves clearance) and then a rail across the bottom (an outlane is a dead end, so anything that
   stops the ball there has nowhere to send it). The right answer was a post at the outlane's
   MOUTH, overlapping both the side wall's clearance and the top of the divider, which rolls the
   ball into the inlane instead — which is what a real outlane post does.
5. **(2026-08-14, and it is number 2 all over again.)** The UPPER-left flipper's pivot 16 units from
   the orbit deflector: a soak parked the ball in the V between them for 33 seconds. Same cause,
   same tell, and the fix was to move the pivot until there was a full ball of clearance rather than
   to shave the gap. `FLIP.upX` / `upPivotY` carry a comment saying so.

**If you move the scoop, a bumper, a divider, a flipper pivot or a wall, re-run
`node pinball/js/test.js` before anything else.** The soak is the only thing that finds these — and
since the rebuild the REACH block is the only thing that finds the *opposite* failure, a shot that
is geometrically perfect and that no flipper can actually hit.

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

`node pinball/js/test.js` (wired into `run-all-tests.mjs`). 102 assertions in seven blocks:

1. **The solver** — gravity, restitution, the one-way gate in BOTH directions, that a swinging
   flipper throws the ball and a flipper held at its stop does not, the speed cap, ball-vs-ball.
1a. **The playfield is not a wall** — the pitch-to-gravity conversion in m/s^2, that every
   difficulty is a real operator pitch, and that a ball takes ~1.5 s to roll the table's length.
1b. **`[KNOWN-BUG PROBE]` rolling does not brake** — a ball rolling along a resting flipper keeps
   85%+ of its speed over 0.2 s (it kept 8% before the Coulomb fix), and rolling resistance still
   exists so a ball can still settle.
1c. **The flipper gap, in ball diameters** — the pivot spacing and bat length against the WPC spec
   in inches, and the tip gap at rest and held up.
2. **Table geometry** — no switch buried in a solid, everything on the table, the habitrail
   continuous and ending at the right inlane.
2b. **REACH: every shot is reachable from a flipper.** A fan of contact points x flip timings on
   each bat, asserting the ramp, the scoop, the orbit, the spinner and the inlanes all land, plus
   the drop bank from an upper flipper. **This is the block that would have saved an afternoon**:
   rebuilding the playfield produced, at various points, a scoop reachable in 2% of shots, an orbit
   in none, and an inlane that delivered the ball past the flipper into the drain — and every one
   of them passed every other assertion in this file.
2c. **`[KNOWN-BUG PROBE]` a solenoid cannot machine-gun** — a slingshot facing a wall a ball and a
   half away is a perfect resonator (15,633 hits in six soak games). `COIL_REARM` fixes the physics
   and `_contact`'s `fired` flag fixes the score, and both halves are asserted.
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

## Things a future session will want to know

- **The speed cap is a correctness bound, not a difficulty knob.** `MAX_SPEED / PHYS_DT` is the
  distance a ball travels per step, and it has to stay well under the thinnest wall. Raising it
  without shortening `PHYS_DT` re-opens tunnelling, and the ball leaves the table.
- **Difficulty is a PITCH, not a gravity multiplier.** If a table feels wrong, the question is "what
  angle is this cabinet on", and the answer has to stay inside 6 to 7 degrees, because that is the
  whole range a real operator can use. Reaching for a number outside it means the problem is
  somewhere else.
- **A solenoid has a re-arm (`COIL_REARM`), and `game.js` refuses to score a contact whose coil did
  not fire.** Both halves matter: fixing the resonance in the physics but not in the score would
  leave the half a player can actually see. If you add another kicking part, give it a `rearm`.
- **The static playfield art is cached into an offscreen canvas keyed on device-pixel size.** If you
  add painted art that needs to change during play, it does NOT belong in `_paintPlayfield`.
- **Reduced motion thins the garnish, it does not freeze the game.** Shake, full-screen flashers and
  most particles go; the ball, the flippers and the lamps stay. A pinball table that does not move
  is not a pinball table, and `test-visual.mjs` drives this game in that mode.
- **There is no sound, and no audio layer.** Not muted, not defaulted off: `audio.js` is deleted and
  nothing constructs an AudioContext (Matt, 2026-08-11: "Delete the sound option. No sound."). The
  setup screen has no toggle. It is one commit back in git if it is ever wanted again.
- **The How To Play screen follows the repo-wide pattern** in `tic-tac-toe/CLAUDE.md` and nothing
  else: one bold sentence, ONE diagram carrying the non-obvious part, a caption, an X = Y example,
  then short plain rules. The first version was five paragraphs of prose that re-explained pinball
  to people who already know what a flipper is; what a player actually does not know is WHERE THIS
  TABLE'S FOUR SHOTS ARE, and that is a picture. If you add a mode, resist adding a paragraph.
- Spanish keeps the borrowed pinball vocabulary (flipper, bumper, jackpot, tilt, multibola) because
  that is what Spanish players say — the same standing rule that keeps Oros/Copas in English.
