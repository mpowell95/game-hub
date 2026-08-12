# Skeeball (`skeeball/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`,
> which is always loaded alongside this file (full rule rationale: `js/CLAUDE.md`).

Built 2026-08-11 as a clone of the Skee-Ball game in Matt's reference recording,
`reference/skeeball/Skeeball 1.MOV`. **Read `reference/skeeball/SPEC.md` before touching the
look** — it is the measured record of that recording (geometry as fractions, sampled hex), taken
while the video was open, and it is a citation, not a style opinion (`reference/README.md`). If
something here looks wrong, the fix is a new screenshot, not a new hex code.

> **SPEC.md's FIRST colour table is the picker ICON, not the machine.** Read its "2026-08-11"
> section before using any hex from this file's history. Those teal-and-white values came off
> IMG_3952, which is the Collector's Edition menu screen showing a small stylised cabinet on a
> teal background — not the board you play on, which is cream, wood-brown and deep red with no
> green in it anywhere. Mistaking one for the other is why the first two builds of this game
> looked nothing like the thing they clone.

## The 2026-08-11 rebuild — what Matt actually saw

Matt uploaded two screen recordings of this game (`reference/skeeball/Skeeball 2.MOV`,
`reference/Skeeball 3.MOV`) with: *"SKEEBALL IS TERRIBLE. Look at how horrible the gameplay is."*
Watch them next to `Skeeball 1.MOV`. Six balls score 40 points, "Too hard!" fires over and over,
and the board is a flat grey donut on a green rectangle with two-thirds of the screen empty lane.

Both halves were real and both are fixed, each with its own note at the site:

| What was wrong | Where the fix and its reasoning live |
|---|---|
| Every cup was a **21px flick window**; 34% of the flick range scored zero | `game.js`'s constants block, `boards.js`'s target table |
| Green-and-silver, from the picker icon's palette | `boards.js`'s `CLASSIC_PALETTE` |
| A flat panel, not a dish: no concavity, no cast shadows, a rail with no thickness | `render.js`'s `drawMachine` |
| Small cold cylinders with floating labels | `render.js`'s `drawTube` |
| The board got 33% of the height, an empty lane got 44% | `render.js`'s `Y` anchors |
| The aim guide used `1.35` while the engine used a different gain — it could lie | `render.js`'s `drawAimGuide` |

A third round followed, on the gesture itself — *"the flick is really bad and unnatural"* — and it
turned out to be the deepest of the three: the swipe was read as DISTANCE when every game in the
genre reads it as SPEED AND ANGLE. That rewrite is "Where those two numbers come from" below.

**The lesson worth keeping** is not any one number: this game's difficulty was set three times in
units nobody plays in. Board-space fractions say nothing about whether a person can hit anything,
and neither does a distance in pixels once the gesture stopped being about distance. The guard is
`test.js`'s `[KNOWN-BUG PROBE]` blocks, which express the WHOLE model — target sizes, band
edges, and the gesture mapping — in the units a hand controls: percent of flick speed, and degrees
of swipe angle. They go red on the exact builds Matt recorded.

## The 2026-08-12 rebuild — THE RINGS TILE

Matt uploaded three more recordings of the build above — `reference/skeeball/Skeeball - terrible
1..3.MOV` — with: *"That's our current skeeball game. It's terrible. Everything about it is
awful."* Watch them: ~24 throws across the three, and virtually EVERY ball scores 10. The score
crawls 10 → 90 over an entire session, "Too hard!" still fires on natural hard flicks, and the
board reads as a thin dark donut with four small dark cups on a dark maroon screen.

The cup-stack model was the root cause and no retune could save it: four cups on a 0.19 pitch each
owned ~10% of the power range **with 10-paying dead space between, below and beside them, plus a
zero above the top**. Swept straight down the middle, roughly half the usable range paid the
consolation 10 — and a hand's natural ±15% speed spread landed in the dead space more often than
in a cup. The real machine — and the game in `Skeeball 1.MOV` — does not have dead space: its
rings are NESTED, every ball that stays on the board lands in exactly one ring, and deeper is
better. So that is what the board is now:

- **`classic`'s 20/30/40/50 are nested `zone` ellipses** (innermost first; `resolveThrow`'s
  first-containing-target-wins rule IS "the smallest ring you are inside"). They tile: the only
  zero left in the whole game is a flick too feeble to make the ramp. Straight-line sweep:
  10→20→30→40→50→40→30→20→10 (the back half is the rings' own back bands — nested ovals wrap).
- **"Too hard!" is gone, permanently.** Energy past `WALL_AT` hits the back wall and the excess
  walks the ball back DOWN the board (`WALL_RETURN`), deterministically and visibly (the flight
  animates the bounce). A max-strength slam lands around the 30: legal, scored, and still the
  wrong play — `test.js` pins that slamming averages well under aiming.
- **The catch-all now actually catches all.** Its old 1.05×0.55 ellipse missed the board's deep
  corners, so a deep banked ball could score a zero "Missed!" while sitting on the board (found by
  simulation, 17% of throws in one stars scenario). It is 1.45×0.80 now and `test.js` sweeps the
  whole reachable rectangle on every board.
- **Every zone carries `aimY`** — the middle of its own front band — because a nested ring's
  centre is buried under the rings behind it. `idealThrow`, the badge anchor and the how-to pages
  all use it.
- Measured after (test.js, in hand units): each ring owns 46%+ of the flick speed needed to reach
  it, ±8.7° or better of swipe angle, a casual hand (±12% speed, ±4°) averages ~406 a rack against
  the ~90 in Matt's recordings, and 0.0% of on-board balls score zero.
- **The look followed the model**: the rings are drawn AS the scoring boundaries (see "Rendering"),
  numbers on the front rim faces, a light pooled in the middle of the field, and the ball is the
  reference's pale pink speckled one instead of the old amber that vanished against the wood.

Matt's one instruction beyond "clone it": *"it's ok if it's a little more cartoony. Like our other
games."* That licence was spent on **saturation and contrast only** — every hue and every position
in the layout is still the measured one. The nudge lives in `boards.js`'s palettes and nowhere else.

## Hub integration

In-hub `module:` (`skeeball/js/ui.js`), **immersive** — the alley is full-bleed and the HUD carries
its own scores, so the hub's header row would be wasted height (same call as Escoba and Ball Run).
The HUD's left padding (`64px`) exists to clear the hub's floating back button; do not remove it.

`isInProgress()` uses the **AUTOSAVE/RESUME** meaning and always returns `false`. Skeeball is
strictly turn-based with no clock of its own, so leaving mid-rack is lossless: every landed throw
snapshots to `gamehub.skeeball.save.v1` and the setup screen offers **Resume**. It is deliberately
NOT in the live-action class (Ball Run / Snake / Hill Climb) — do not "fix" this by making it
return true mid-game.

## Layout & responsibilities

```
skeeball/js/game.js      pure engine: the throw model + its flick calibration, scoring, unlocks, save
skeeball/js/boards.js    the machines as DATA: palette, target layout, unlock score
skeeball/js/render.js    pure drawing: the cabinet, marquee, board, ball, badge, popups, picker art
skeeball/js/howto.js     the HOW TO PLAY carousel (repo pattern; yahtzee/js/howto.js is the model)
skeeball/js/ui.js        DOM shell: the machine carousel, the rAF loop, flick input, stats
skeeball/js/strings.js   every user-visible string, { en, es }
skeeball/js/test.js      headless engine assertions (node skeeball/js/test.js), in run-all-tests.mjs
skeeball/css/skeeball.css  all styles, .sk- prefixed, every rule descendant-scoped under .sk-root
skeeball/index.html      standalone host (same init() as in-hub), name-gated before mount
```

## The throw model — the one thing to understand

**A throw is resolved from two numbers and nothing else**, by a PURE function
(`resolveThrow(power, aim)`):

| Input | Range | Meaning |
|---|---|---|
| `power` | 0..1 | how hard it was thrown |
| `aim` | -1..1 | how far off straight it arrives |

### Where those two numbers come from: `flickToThrow`

Matt, 2026-08-11: *"The flick is really bad... it's just really bad and unnatural. Can you look
into what other games do? Like game pigeon's beer pong game or other darts games?"*

Those games are the answer, and they agree with each other: **Cup Pong keys on how FAST you swipe**
(guides describe cup 2 as "a medium speed swipe" and cup 4 as "the same direction with a slightly
faster swipe"), and mobile darts games map *"the speed and angle of your finger"* to the throw.
This game did neither. It used:

```
power = total vertical distance from the touch-down point, over the whole gesture
aim   = total horizontal distance from that same point
```

Four consequences, and together they ARE the "unnatural":

1. **Speed did nothing.** A slow deliberate drag to the top threw exactly as hard as a snap flick.
   Throwing is an act of acceleration; a model that ignores acceleration cannot feel like throwing
   however well its numbers are tuned.
2. **You could not wind up.** Pulling back first REDUCED power, because power was net displacement
   from where you first touched. The natural motion actively hurt you.
3. **Aim was offset, not angle.** Drifting 30px right is 4 degrees on a long flick and 17 on a
   short one, and both produced the same aim - so the same visible swipe direction sent the ball
   somewhere different depending on how hard you threw. Of the four this is the worst: the ball did
   not go where you pointed.
4. **Release was not a moment.** The value at pointerup was used even if the finger had been parked
   for a second. Android's `VelocityTracker` uses a ~100ms window precisely because only the end of
   a gesture describes a fling.

`game.js`'s **`flickToThrow(dx, dy, vx, vy)`** replaces all of it, and it is PURE - `ui.js` only
turns pointer events into those four numbers, and `test.js` drives realistic gestures straight
through it. Power is mostly release SPEED (`SPEED_W` 0.65) with the rest from distance, so a long
controlled push is still a real throw; aim is the swipe ANGLE, so it no longer changes with power.
Speeds are in **canvas heights per second** and the angle in radians, so the feel is identical on
any phone.

### The rails are not at board x +-1

`RAIL_X` (0.6162) is the one number `game.js` and `render.js` must agree on. The lane is measurably
NARROWER than the bowl it feeds — 118.3px against 192.0px at the join — so the whole lateral model
is in **board space**, with the rails sitting where the lane's edges actually are.

It used to be in lane-fractions, and the bowl reused those as bowl-fractions. A ball at 85% of the
lane's width was handed to the bowl as 85% of the *bowl's* width, which is a different, wider
place, so crossing the ramp teleported it 63px further out. On a banked throw that outward sweep
was three times the size of the bounce and pointed the other way, which is why the bounce was
invisible — Matt: *"It bounces off the wall, but then continues on the line it originally was on."*

Two consequences worth knowing before you move anything:

- **A target beyond `RAIL_X + rx` cannot be hit.** The 100s are drawn at ±0.75 in the reference but
  live at ±0.50 here, because no throw can arrive out at 0.75. `test.js` fails on any board with an
  unreachable target.
- **`test.js` derives the ratio from the drawn geometry and checks it against `RAIL_X`**, so the
  two cannot drift apart again.

**The units to judge any of this in are the ones a hand controls.** `test.js` reports each cup as a
percentage of the flick speed needed to reach it (14-24%, against a human repeatability of about
+-15%) and as degrees of swipe angle (+-5.1 to +-7.3). Board-space fractions say nothing about
whether a person can hit anything, and this game has now been mistuned twice by people reading
them - see the rebuild table above.

**There is no random scatter on a player's throw, deliberately.** The player is judging a flick; a
hidden dice roll on top of that judgement would make practice pointless. It also means the
animation can be derived from the same resolved numbers (`res.offset`, `res.energy`), so what the
ball is drawn doing and what the scoreboard says can never disagree. There is no opponent to hide
variance in either (see "Machines, unlocking..." below), so if you ever add scatter, it lands
squarely on the player and you should expect them to notice.

Resolution order, all in `game.js`:

1. `aim` drifts the ball across the lane by `LATERAL_GAIN`, **folding at the rails** - a
   full-tilt flick banks, which is a legitimate way to line up a wide target and costs
   `BOUNCE_LOSS` (0.13) energy per bounce.
2. Below `SHORT_BELOW` (0.10) the ball never made the ramp: it rolls back and scores nothing -
   the ONLY zero in the game. Above `WALL_AT` (0.78) it reaches the back wall and the excess
   walks it back down the board (`WALL_RETURN` x overshoot), deterministically. There is no
   "over" and no "Too hard!" - see "The 2026-08-12 rebuild" above.
3. In between, energy maps to a DEPTH in board space and the offset to an x, and **the first
   target ellipse containing that point wins**. Targets are ordered small-and-valuable first,
   catch-all last - on classic the zones NEST, so first-wins is "the smallest ring you are
   inside", the real machine's own rule.
4. Every board ends with a **catch-all** covering the whole REACHABLE rectangle (|x| ≤ RAIL_X,
   y 0..1 - test.js sweeps it), so a ball that stays on the board always scores something.

`test.js` pins the ring ladder up and back down, both cups, the bank shot, the wall bounce's
monotonic walk-back, that nothing on the board scores zero, and - the block that matters most -
that every window is a distance a thumb can actually repeat.

## Machines, unlocking and the three scores (2026-08-11 rework)

Matt: *"I want skeeball and pinball to be similar in that they each have multiple maps that need to
be unlocked... this should replace the computer player."* So:

- **There is no computer opponent.** The old easy/medium/hard AI is gone. A game is nine balls
  against the scoreboard. (The tuning work that went into it is not lost - the numbers and the
  method are in git history and in this file's own history; do not re-derive them if the AI ever
  comes back for a reason.)
- **A board is DATA** (`js/boards.js`): a palette, a target layout, and the score that unlocks the
  next machine. Adding one should touch nothing else. `classic` is measured off IMG_3952;
  `stars` is a second machine with a genuinely different LAYOUT (targets scattered wide, so it
  rewards aim where classic rewards power control) rather than a recolour - the reference's own
  locked machines change the layout too, and a ladder of reskins is not worth climbing.
- **Unlock rule: beat the next machine's target score on the one before it** (Matt's choice from
  three options). `unlockScore` on the entry; `Game.unlocks()` decides; the end card announces it.
- **Boards ARE the difficulty axis**, so `byDiff` is keyed by board id - Hill Climb's precedent
  (`hillclimb/CLAUDE.md`, "Stages ARE the difficulty axis"). The old `easy`/`medium`/`hard` buckets
  from the vs-computer build are untouched and still count in the leaderboard's All filter.

### The three numbers on the cabinet head

The marquee shows the app-wide **RECORD** for that machine, the live **SCORE**, and your **BEST**.
IMG_3960's own `BALL  SCORE` LED panel is the precedent for putting them in the cabinet head rather
than in a floating HUD.

**The app-wide record is DERIVED at read time from the already-synced player records**
(`js/arcade-scores.js`'s `appWideBest`, fed by the same `watchPlayers` + `players-agg` the
leaderboard uses). There is deliberately **no shared `highscores/` node**: no new write path, no
rules change, no way for one device to corrupt a number everyone sees, and it cannot disagree with
the leaderboard. The cost is that a new record appears only after that player's device next syncs,
and offline the marquee shows a dash rather than a stale number. **Unverified against real
Firebase** - a cloud session cannot reach it (same honest caveat as Pool's and Boggle's MP).

### Why "resets every 24 hours" does not reset anything

The daily best is a **date-keyed map**, `daily: { '2026-08-11': 640 }`, and "today" is a READ of
today's key. Nothing is ever cleared, there is no expiry job to get wrong, and the player keeps a
real per-day history for free. A `todayBest` field plus a timer would have been THE LAW rule 2
violated with a cron attached. Local calendar day, not UTC - "today" has to mean what the player
thinks it means. `test-arcade-scores.mjs` pins all of it.

### Shared with Pinball from day one

`js/arcade-scores.js` owns the score/unlock semantics for both games rather than Skeeball owning
them and Pinball copying them later. Matt named both games in the same breath, this layer is where
THE LAW lives, and this repo's own notes record what happens when "extract it when the second one
arrives" meets a session with no memory of the first. Pinball needs to pass its own sub-counter key
(`pb`) to `appWideBest` - that parameter exists precisely so the shared module has no opinion about
whose boards it is reading.

## Deviations from the reference, and why

- **9 balls per rack, one rack per game.** The reference shows `ROUND 1/3` with a rack of roughly
  this size, i.e. ~27 throws per player — fine for an async chat game played over hours, far too
  long for one sitting here. One rack of nine is a classic skeeball game.
- **There is no second player at all.** The reference is two-player-async inside a chat app; this
  build is one rack against the scoreboard, by Matt's instruction (see "Machines, unlocking and the
  three scores"). This hub has `js/net.js` for real multiplayer and Skeeball does not use it (see
  "Not done" below).
- **The aim guide and power bar are ours.** The recording never shows its input at all
  (`SPEC.md`, "What it does NOT show"), so the flick, the dashed predicted path and the power bar
  are this build's own choices. The dashed path runs the SAME fold maths the engine will apply, so
  the guide cannot lie about where the ball is going.

## The flight — one roll, one speed

Matt, 2026-08-11: *"You flick it, it goes some speed down the ramp, then it speeds up to go off the
jump, then it flies through the air. None of the different speeds feel related to or based on each
other... It goes SO slow down the ramp, then SO fast off the jump."*

Two faults, and the second is why fixing the first alone was not enough:

1. **Three hardcoded durations** — 720ms lane, 260ms board, 200ms drop — stapled together. Each
   covered a completely different distance, so each ran at a different apparent speed, and none had
   anything to do with how hard the ball was thrown. A `sin()` hop over the crest was the "flies
   through the air".
2. **A hole in the path.** The lane's top is at design y=660 and the bowl's lip at y=560, and the
   ramp between them was on nobody's path — the ball went straight from `lanePoint(1)` to
   `boardPoint(...)`, teleporting 100px in one frame. Traced, that frame ran at **6535 px/s**
   against 406 px/s the frame before it.

Now: `_buildPath` makes ONE polyline through lane → ramp → bowl (`render.js` owns each piece,
including `rampPoint`, so the ball rolls on the surface that is actually drawn), and the ball
advances along it by **arc length at a CONSTANT speed** set by the throw. No duration is declared
anywhere; it is length / speed. A wall-bounce throw's path simply continues: up to the wall and
back down to where it scored, same speed, because the bounce is the throw's own momentum. A
10-ball gets a second, slower, gravity-fed leg (`_buildReturn`) back down to its rest spot on the
apron, where it stays.

**Constant, not decelerating.** A first pass had it slow to 55% by the end, for "realism". Matt:
*"The ball slows down right before going off the ramp. Why are you messing with the speed so much?
Just keep it constant."* He is right, and the reason is positional: the ramp sits about two thirds
along the path, so any end-loaded deceleration is already visible exactly there, and a speed change
mid-throw reads as a fault whatever the physics says. The only place the ball changes speed is a
throw that falls SHORT, which has to slow to a stop in order to roll back. Measured after: 1099
px/s min AND max across the whole roll.

**And it rolls.** `drawBall` takes a `spin`, and the markings are points on a unit sphere rotated
about the horizontal axis, so the surface travels up and over the top the way a ball rolling away
from you does — a 2D pattern spun about the view axis would read as a ball spinning on the spot.
The specular highlight deliberately does NOT rotate: it is a reflection of the room, so it stays
where the light is while the surface turns under it. The angle is `distance / radius` — the plain
rolling relation, taken from the same arc length the position comes from, so the ball can never
look like it is skidding and there is no spin rate to tune. About 3.2 turns up the lane.

Arc length rather than a world coordinate is deliberate: the bowl is drawn oversized — the
reference cabinet does the same — so world units do not convert to screen pixels at the same rate
either side of the lip, and any model assuming they do puts a speed step back at exactly that seam.
For the same reason no easing curve is layered on top: the polyline already carries the
perspective.

To re-measure any of this, trace the ball's position per frame and print the frame-to-frame speed.
A discontinuity is then a number, not a feeling.

## Two things that must never come back

Matt, 2026-08-11, after asking for both before: *"Remove the below permanently. NEVER add them
back."* Both were physics dishonesty, and both are now pinned by assertions rather than by prose.

### 1. The holes do not attract the ball

*"The balls move slightly in the air towards the holes. It's like the holes attract the ball. The
ball deviates from the path it should be on and moves towards the hole."*

The ball never moved. What was wrong was that **the catch ellipse was bigger than the hole being
painted**, so a ball that came to rest BESIDE a cup was scored into it and then drawn sinking
through the floor next to it. It happened twice, in two axes:

- first `rx` was drawn at 0.86 of the catch — fixed, and written up as "rx IS the drawn width";
- then `ry` was left at nearly **twice** the depth of the drawn mouth, which nothing noticed
  because nobody had ever compared the two numbers. Measured on that build: **62% of throws scored
  as a cup landed outside the visible hole**, the worst 3.1× its radius away.

`render.js`'s **`mouthOf(t)`** is now the single source of a hole's drawn size — it projects the
target's own catch ellipse through `boardPoint`, exactly, and `drawTube` paints the dark opening at
precisely that with no scale factor anywhere. The cream lip is drawn OUTSIDE the opening
(`RIM_LIP`), so the only remaining fudge can make a cup look bigger than it scores, never smaller.

`test.js`'s `[KNOWN-BUG PROBE] THE HOLES DO NOT ATTRACT THE BALL` sweeps every board and asserts
that every scoring throw comes to rest inside the ellipse actually painted for the target it
scored. It measures in design pixels, not ratios, because a board-space ellipse does not project to
an exact screen ellipse and a few throws sit ~0.2px proud of the rim.

**Consequence to respect:** a target's `ry` is now visible geometry, not a free tuning knob. Making
a cup easier means drawing a bigger hole. That is the point.

### 2. The ball is never deleted in mid-air

*"Why does the ball disappear? If it doesn't go into a hole, you just have it disappear and a huge
point value and star popup. That's terrible. I HATE that. That is not realistic."*

A ball the floor keeps (the 10) now **rolls back down the bowl and comes to REST on the apron, in
plain sight, until the rack ends** — which is exactly what the reference machine's own missed
balls do (SPEC.md: "balls that came to rest without scoring sit on the apron in front of the
rings"; `ui.js`'s `rested` list, staggered so they pile up legibly). There are exactly two places
a ball may leave the screen:

| | |
|---|---|
| into a ring or cup | it drops in where it landed |
| off the bottom | a short throw returning to the player |

**There is no alpha fade anywhere in the flight and there must never be one again.** The score
callout is a small rising number, not a starburst, and it appears where the ball actually finished
— on the apron for a 10, in the hole for a hit — never over the middle of the board.

### 3. "Too hard!" and its zero (2026-08-12)

The third permanent removal, same family as the other two: an overthrown ball bounces off the back
wall and scores where it comes to rest, never zero, never a scolding popup. The `over` kind, the
`over`/`too_hard` strings and `OVER_ABOVE` are all gone; `test.js`'s "THE RINGS TILE" probe block
fails any build where an on-board ball scores nothing or where more overshoot lands deeper.

## Rendering

`render.js` authors everything in a fixed **design box** (`DW` 480 x `DH` 1000, the recording's own
aspect once the host app's chrome is off) and `layoutFor()` scales it to fit whatever box the game
is mounted in, "contain" and centred. The leftover margin is painted with the same dark side-wall
grey the reference already has beside the lane, so a letterbox reads as more arcade rather than as
a bug — and that is *why* the same layout passes the `fit` check in both hosts and at both phone
heights without a second layout path.

One function does all the perspective:

```
sc(v) = 1 / (1 + v * (NEAR_OVER_FAR - 1))       v: 0 = foul line, 1 = the board
```

Widths, ball radius, rail chevron spacing and the screen `y` all derive from it. Getting them from
one function rather than three hand-tuned curves is why the ball never looks like it is sliding
against the lane it is rolling on. **`NEAR_OVER_FAR` (1.988) is measured** — SPEC.md's lane widths
at y 0.49 and the bottom edge. Do not round it to 2 "for tidiness"; re-measure if you change it.

The alley is static between throws, so `ui.js` paints it once per resize into an offscreen canvas
and blits it each frame; only the ball, badge, queue, popup and aim guide are drawn per frame.

**The canvas scene is identical in light and dark.** It is a dark arcade in both by design, so the
`:root.gh-dark .sk-root` block themes only the chrome around it (setup screen, help sheet, end
modal). That is a deliberate choice, not a missing Phase 2 pass.

## Fitting the screen

`_fit()` **collapses `.sk-game` to 0 height before measuring**, then sets an explicit pixel height
from `window.innerHeight - rect.top`. Both halves matter and both are lessons from
`VISUAL-PROCESS.md` 3c:

- The root never asks for `100dvh`. In the hub the same element sits under ~98px of
  floating-back-button padding, so a viewport-height request overflows the instant it is mounted.
- `getBoundingClientRect().top` is viewport-relative, so measuring it while our own overflow is
  scrolling the page reads a value that is wrong in exactly the direction that hides the bug.
  Collapsing first removes us as a possible cause of that scroll.

## Settings & persistence

| Key | Holds |
|---|---|
| `gamehub.skeeball.v1` | `{ board }` — the machine you last picked, so the picker opens on it |
| `gamehub.skeeball.save.v1` | the in-progress rack snapshot; removed on game over |

Which machines are UNLOCKED is deliberately **not** here: it is earned history, so it lives in
`gamehub.stats` under `sk.unlocked` where it syncs across a person's devices and is union-merged
rather than overwritten (`js/arcade-scores.js`). A settings key is one device's preference; an
unlock is not. A resumed rack keeps the machine it was STARTED on, whatever the picker now shows.

The snapshot is **v2**. `Game.restore()` declines a `v: 1` save (the vs-computer build's shape)
rather than misreading it as a rack — those saves are only ever an in-progress game, never a
recorded result, so nothing earned is lost by declining one.

`Game.restore()` returns `null` (never throws) on anything malformed, so a corrupt or truncated
save can only ever mean "no game to resume", never a crash on mount. The rng is deliberately not
captured in the snapshot: a resumed match re-rolls its multipliers from a fresh stream, which
changes nothing a player could notice and keeps the save plain JSON.

## Stats

`recordSkeeball(boardId, extras)` in `js/game-stats.js`. A finished rack is always a "win" as far
as `bumpTotals` is concerned, the same solo pattern Ball Run and Hill Climb use: there is nobody to
lose to, so `byDiff[boardId].played` is the honest play count per machine.

`sk: { played, won, lost, tied, balls, points, bestGame, bestThrow, hundreds, fifties, boards,
unlocked }`. Counters add; `bestGame`/`bestThrow` are `Math.max` only (THE LAW rule 2). `boards`
and `unlocked` were added with the boards rework and are both ADDITIVE — `ensureSk()` fills them in
on any device that has not played since, and their shape and merge rules belong to
`js/arcade-scores.js`, not here.

**`sk.won` / `sk.lost` / `sk.tied` are FROZEN** (THE LAW rule 5). They are the vs-computer era's
win/loss record. There is no opponent to add to them any more, so the writer never increments them
again — and never clears them either. My Stats still shows them when they are non-zero, because a
number a player earned does not stop being theirs when the mode goes away (rule 1).

`extras` = `{ score, balls, hundreds, fifties, bestThrow, at }`. `game.js` keeps that tally itself
(`this.tally`) rather than the UI counting, so a restored save carries it instead of restarting at
zero. `at` is the finish time, used only to pick the local day bucket for the daily best, and is
injectable so the tests are not clock-dependent.

All three mandatory surfaces exist from day one (root checklist item 7), and
`players-agg.test.mjs`'s structural guard fails the build if any goes missing:

1. `ensureSk()` + `recordSkeeball()` in `js/game-stats.js`
2. the `src.sk` branch in `js/players-agg.js` (without it the screen reads zeroes the moment a
   person's second device syncs, with every local store intact)
3. `skeeballScreen()` in `js/game-stats-ui.js`, plus the `game_title_skeeball` tab

Skeeball is in `players-agg.js`'s **`SOLO`** set — with the opponent gone there is no loss axis, so
a win-rate column would read 100% and mean nothing. It is **not** on the leaderboard
(`js/leaderboard-ui.js`'s `GAME_META`) while it is `devOnly`: an admin-only game has exactly one
possible player, so a board of one is noise. The texture chips are still written and the comment
there says to put the entry back the day `devOnly` drops.

Recorded ONCE per rack in `_finish()`, before the modal shows, so a fast "play again" cannot skip
it. A quit game never reaches the recorder, so walking away can never mint a counter.

## Tests

```
node skeeball/js/test.js        the engine and the boards
node test-arcade-scores.mjs     the shared score/unlock layer (bests, the daily map, merges)
node test-visual.mjs skeeball   light/dark/reduced, both hosts at two phone heights, and a real flick
```

`test.js` covers: every board being well formed (unique ids, a catch-all last that covers the
whole reachable board, zones ordered innermost-first with a legal `aimY`, the badge never on the
catch-all), the ring ladder up and back down, both corner cups, the bank shot and its energy cost,
purity, the multiplier's reach and its x3, a nine-ball rack refusing a tenth throw, unlocking (and
the last board unlocking nothing), and save/restore including three malformed saves and a declined
`v: 1`.

**The "THE RINGS TILE" block is a [KNOWN-BUG PROBE]** for the `Skeeball - terrible 1..3.MOV`
recordings (2026-08-12, ~24 throws, ~all 10s). It pins the three facts that make the game a game:
nothing that reaches the board scores zero, the straight-line ladder is strict 10→20→30→40→50 with
no 10-paying dead space between rings, and past the wall more overshoot lands strictly shallower.
Its predecessor ("cups do NOT tile") pinned the OPPOSITE shape for the cup-stack board and is
retired with it — the invariant that survived is what-you-see-is-what-you-score, which for nested
zones means the rims are drawn ON the scoring boundaries (`render.js`'s `zonePath`) and the
holes-do-not-attract block asserts containment for every scoring throw.

**The other two probe blocks are the gesture's.** "a swipe becomes a throw" pins each of the four
failures the gesture rewrite fixed — a fast swipe must beat a slow one over the same distance, a
wind-up must not cancel the throw, aim must not shift with power, and yanking the finger back must
cancel rather than launch. Every one of them would pass trivially under the old distance model, so
they are worth exactly as much as the fact that they cannot. "a HAND can actually hit these" then
sweeps flick SPEED and swipe ANGLE across the whole board and reports the result in percent and
degrees, with a simulated casual player (+-12% speed, +-4 degrees) who has to average a real rack.

The `PLAY` probe in `test-visual.mjs` drives the real UI with real touch: it taps an unlocked
machine card, flicks, and fails unless a ball lands for actual points (last run: 40 on classic).
That is the automated floor, not a substitute for playing it — `VISUAL-PROCESS.md` applies.

## Not done, on purpose

- **No multiplayer.** `js/net.js` is right there and the reference is a two-player game, but a
  lockstep pass is its own milestone with its own invariants (`js/CLAUDE.md`) — and Skeeball has an
  unusual shape for it: like Boggle, nothing either player does changes the other's board, so it
  would be a self-report protocol rather than a move log. Read that section before starting.
  **Matt's stated end goal (2026-08-11) is a hub-wide turn-based multiplayer layer, for every
  game, with direct challenges** — *"you could directly challenge someone"* — and he named Skeeball
  as a good fit for it. That is a hub milestone, not a Skeeball feature; do not build a one-off
  here that the shared layer would then have to fight.
- **Only two machines.** Matt asked for one extra to start, with a "more machines to come" note in
  the picker, rather than ten at once. `boards.js` is data, so a third is an entry and nothing else.

## The two carousels

Both were Matt's requests, both were outstanding for a round, and both now exist.

**The machine picker** (`ui.js`'s `renderPicker`) is a scroll-snap carousel, one full-width slide
per machine. Its art is not an illustration of the board: `render.js`'s `drawThumb` paints the
REAL machine with the real renderer, so the picture and the game cannot drift apart. A locked
machine is dimmed, chained and padlocked, which is IMG_3959/IMG_3960's own treatment. Native
scroll-snap rather than a pointer handler — it keeps platform momentum, is keyboard-navigable for
free, and cannot fight the page for the gesture. Arrows and dots are conveniences on top of it.

**How to play** (`skeeball/js/howto.js`) follows the repo pattern — `yahtzee/js/howto.js` is the
reference implementation and `tic-tac-toe/CLAUDE.md` documents the shape. Five pages, a pointing
hand, dots, `[|◀] [OK] [▶|]`, swipeable, with a still informative pose under reduced motion.

The thing that makes it worth having: **every throw on every page is resolved by `game.js`**, and
the ball is drawn from that result. The tutorial physically cannot demonstrate a shot the engine
would score differently — the same discipline as the in-game aim guide sharing the engine's fold
maths instead of copying it.

What was there before was a static sheet of bullet points. Matt: *"You ignored the How To Play
instructions again. Yours is dogshit."* He was right twice: the repo had a pattern and that build
did not follow it, while a comment inside it claimed it did. Don't reintroduce a static sheet.
