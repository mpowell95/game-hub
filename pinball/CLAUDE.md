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
- **The How To Play screen follows the repo-wide pattern** in `tic-tac-toe/CLAUDE.md` and nothing
  else: one bold sentence, ONE diagram carrying the non-obvious part, a caption, an X = Y example,
  then short plain rules. The first version was five paragraphs of prose that re-explained pinball
  to people who already know what a flipper is; what a player actually does not know is WHERE THIS
  TABLE'S FOUR SHOTS ARE, and that is a picture. If you add a mode, resist adding a paragraph.
- Spanish keeps the borrowed pinball vocabulary (flipper, bumper, jackpot, tilt, multibola) because
  that is what Spanish players say — the same standing rule that keeps Oros/Copas in English.
