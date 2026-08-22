# Skeeball decisions

## How to use this file

This is where the history and rationale behind Skeeball's tuning lives. The source files
(`skeeball/js/*.js`) keep only the guards (bans, frozen ids, correctness constraints) and short
present-tense notes on what a number does. When a comment in code points here
(`// See DECISIONS.md#some-anchor`), the full story — what was tried, what broke, what the
measurements said — is in the matching section below. Read this file at the start of a session
touching Skeeball's tuning; it's faster than re-deriving the same history from git log.

## Frozen ids and storage compatibility

Several ids are written into player save data and Firebase and can never be renamed, per THE LAW
rule 5 (old keys are never repurposed):

- `classic` — the first machine's board id, also `recordSkeeball`'s fallback id in
  `js/game-stats.js`.
- `h20` — kept as the hole id for the 20 even though the layout around it changed.
- `corner0` — the outcome id for a ball that dies in the trough; it originally meant only the
  trough's corners, and now covers the whole trough, but the id itself never changed.
- `troughTenHalfW` — a retired config field in `boards.js`, kept only so an old saved rack still
  parses under the current code. Delete it only alongside a save-format version bump.

## Machine geometry

### Ball size

Ball diameter went from 0.78125x to 0.7x (x = the hole diameter unit) to open up clearance
between the ball and each hole's mouth.

### Lane length

The lane is shorter than a real alley on purpose, so the board dominates the frame on a phone
screen. It was shortened again after the camera moved to sit behind the ball, since the earlier
length left too much empty space between the ball and the board.

### Ramp width and hump

The ramp is 4.875x wide against a 6.875x board, wide enough to read as the base of the same
cabinet rather than a narrower part bolted onto the end of it.

The hump (the rising ramp segment) is kept short in length as well as steep in angle. A longer
hump raises the height of its own crest, and a tall crest sitting between the camera (behind the
ball) and the board blocks the view of the lower-value holes. Checked with `sight.mjs`; re-run it
if the ramp, board, or camera move.

### Launch angle

See DECISIONS.md#launch-angle-history. The governing rule (kept in code as a guard): launch angle
must exceed board tilt or the ball can never leave the ground — this is a geometric fact about
projectile range onto an incline, not a tuning preference.

#### Launch angle history

An earlier build launched too shallow relative to the board's tilt, which is geometrically
incapable of producing an arc: the ball crawls onto the bottom edge of the board and rolls from
there at every power. An automated check that only measured "did the ball touch the scoring
face" scored this as a full pass, because a ball that never leaves the ground still touches the
face — the metric couldn't see the missing arc. It shipped anyway and was only caught by playing
the game. The fix (launch angle raised well above board tilt, ramp broken into six segments
instead of four so the ball tracks the surface smoothly on exit) is what's in code now. A
follow-up script, `measure-arc.mjs`, checks actual airborne clearance and landing spread — run it
after touching ramp angle or segment count, since `tune-ladder.mjs` alone cannot detect a ramp
that fails to launch the ball.

### Trough and lip

The trough (the catch pit between the hump's crest and the board's bottom edge) is sized wide
enough that a ball rebounding off the board's lip drops into it and meets the hump's back side as
a wall, rather than skipping the gap and rolling all the way back to the player.

The board's bottom edge (`boardLipY`) sits above the hump's crest height, matching how a real
cabinet is built — the playfield starts above the ramp's lip. Raised from an earlier lower value
once the ramp became steep enough to have a crest that stood proud of the board and blocked the
view of the lowest holes.

### Board dimensions and aspect ratio

The board is proportionally much wider relative to the ball (10:1) than a real cabinet (about
6.7:1). This is deliberate, not a mistake to correct toward realism: the on-screen ratio is the
world ratio times the camera's distance ratio, and narrowing the board toward a realistic
proportion only works with a telephoto camera distance where the lane loses all sense of depth
and stops reading as a lane. A normal ~2m camera distance needs the wider board to fill the
frame correctly.

The board was originally built as a square (1:1), which was wrong — a reference drawing of a
real cabinet gives a target board ratio of 1 : 1.3818. Fixed by lengthening the board rather than
narrowing its width, since the width was already set by what the camera needs to frame (see
above). Holes and rings were left in their prior positions when this changed and were
repositioned separately (see Ring geometry).

### Ring geometry

Every ring's position is derived mathematically from its own hole and from two other rings, via
three tangency rules, rather than being placed by hand:

1. Every hole touches its own ring at exactly one point (the hole's bottom). A ring is never
   concentric with its hole; it hangs above it.
2. The 30 ring's top touches the 40 ring's bottom.
3. The 40 ring's top, the 50 ring's bottom, and the 20 ring's top all meet at one point.

`ringD` in `boards.js` is a ring's *inner* opening (the clear diameter a ball has to pass
through), not its wall centerline — this distinction matters because treating it as the
centerline shrinks the actual usable opening at every hole.

The 10's ring is a half-arc, not a full circle: a full circle at its diameter would cross into
the 50's mouth, which isn't a valid layout (the tangency rules produce touches, not crossings).

Ring segment count scales with the ring's own radius rather than using one fixed count for every
ring, since these rings range from a 100-hole's small ring up to the 10's much larger arc, and a
single fixed segment count would either facet the big rings into hittable flat corners or spend
far more geometry than needed on the small ones.

One value in the original spec table was internally inconsistent (the 20-to-30 ring spacing as
given made tangency rule 3 geometrically impossible). The diameter was kept and the spacing
adjusted instead, matching the dimension that was actually drawn on the reference image. This was
a deliberate, discussed resolution — don't silently resolve it the other way.

### Side walls

The side walls of the scoring area were rebuilt to be bankable: a real bank shot off a side wall
into a corner 100 needs a wall the ball actually meets up there, not a low rail whose only job is
stopping a ball from leaving the machine. The walls run world-vertical (like a real cabinet's
side panel, not perpendicular to the sloped board face) from the board's bottom corner up to the
top of the backboard.

A later fix (`railFrontH`) gave the player end of the wall real height instead of tapering to
zero. A true zero-height taper at the front meant a hard, wide throw could sail past the side of
the board at a height where no wall existed yet, scoring nothing and never touching a wall at
all — the opposite of the bankable shot the wall exists to provide.

### Popongo layout

POPONGO's nine slots form a 1-2-3-2-1 diamond, and every number in it is a consequence of four
fixed quantities: the ball (0.70X across), the collar's outer reach (0.5825X from a slot centre),
the board's half-width (3.4375X), and the reachable band of the face (v 2.3125X at minSpeed up to
just under the top edge at full power).

The first draft placed the middle row's outer slots flush against the side rails, copying the
classic's corner-100 pattern (merged furniture is one of the spacing rule's two legal answers). A
measured sweep (459 throws over the aim x power grid) rejected it: 12.6% of ALL throws ended in
the watchdog's emergency walkout, every single one wedged where the curved collar wall meets the
flat rail, and every walkout was then "scored" into the adjacent cup. A circle against a FLAT
wall converges gradually - the pinch zone where the gap is narrower than the ball extends far
from the tangent point - so a collar near a rail is a three-contact lock even when their closest
gap is zero. Merging works for ring segments against a rail (the classic's 100s); it does not
work for a collar a ball approaches along the rail. Standing rule: keep every collar at least a
ball plus margin off the rails.

The first shipped lattice (t = 1.65X, s = 1.035X, cups 0.5X, the classic's 0.35X ball) made
every wall gap at least 0.78X with nothing merged. Collars are 0.35X for the same two reasons
the sweep gave: at 0.5X the two upper-diagonal slots were unreachable at every cell of the grid
(the descending arc met the wall face instead of clearing it), and lower walls scatter clipped
balls less.

Matt's first play (2026-08-22, same day) resized the whole face: the real Popongo is a PING PONG
ball into SOLO cups - mouth about 2.4x the ball - and at the classic's ball our mouths read tiny
and sat far apart. They could not simply grow: the 3-across row binds cup size (three collars
plus four ball-passing gaps inside boardW), and at a 0.70X ball the mouths cap at ~1.0X, which
is where they already were. **Shrinking the ball is what buys the cup feel** - `ballR 0.28X`
under a `ball.ratio` waiver in the board entry - so the cups grew to `0.5625X` (mouth/ball
~2.0) on a tighter lattice: t = 1.63X, s = 1.075X, minimum wall gap 0.64X against the 0.56X
ball, top slot at v = 8.8325X. Re-swept after: all nine slots clean-capturable, 0 emergencies
in 459 throws.

The same play session found capture paying for balls that merely HIT a cup. Two causes, both
fixed in physics.js, both cup-board-gated so THE CLASSIC's numbers are byte-identical: the
capture test's `need` was calibrated for FLUSH holes, so a fast ball crossing a collared mouth
"captured" when it would really clip the far rim and bounce out (`needH` now adds
`max(0, h − collarH)` - past the lip means below the RIM); and the watchdog walked a jammed
ball into the nearest mouth, a scripted score. On a cup board a jammed or capped ball now
resolves as the trough's zero: falling through a mouth is the only way to score, watchdog
included.

### Basket Fever layout

BASKET FEVER's nine hoops are a 3x3 sub-lattice of POPONGO's measured lattice, on purpose: rows
at POPONGO's bot/mid/top v (2.3125X / 5.6125X / 8.9125X), columns at 0 and its rail-safe ±2.07X,
collars at its measured 0.35X. Nothing was re-derived because every constraint (the 0.78X wall
gap floor, the collar-off-the-rails rule, the arrival-clearance a 0.35X collar asks for) was
already paid for by POPONGO's sweep. Same-row wall gap 0.905X, row-to-row 2.135X, collar-to-rail
0.785X.

The build sweep (27 powers x 17 aims, 459 throws, the POPONGO method): all nine slots
clean-capturable, 0 emergencies. The ladder it measured: low row captures from p≈0.20, middle
from p≈0.44, top from p≈0.72; side hoops need aim (lowL at p0.20/a-0.38, topR at p0.72/a0.25);
the 100 (topC) takes a straight throw at p0.72-0.84. Row height picks the row, aim picks the
column, which is the real machine's game.

Same day, at Matt's ask ("shooting a basketball... needs to reflect that"), the ramp steepened
to a 70-degree final segment (the spec maximum) in six even steps. Range up an incline goes as
cos(t)sin(t - tilt), so at the 45-degree face the reach barely moves (0.289 v^2 at 70 vs 0.285
at 64 degrees) while the peak rises and the descent steepens - the ball drops into a basket
from above instead of skimming up to it. Re-swept at 70 degrees under the post-POPONGO capture
physics (the needH rim rule): all nine hoops clean-capturable, 0 emergencies in 459 throws,
slowest settle 9.1s; the ladder moved to low p≈0.28, middle p≈0.52, top p≈0.8, the 100 straight
at p0.76-0.8.

## Swipe and power

### Measured swipe data

The swipe-speed range (`SWIPE_SLOW`/`SWIPE_FAST` in `swipe.js`, and `minSpeed`/`maxSpeed` in
`boards.js`) is calibrated from real measured hand data, not guessed. Four earlier rounds of
picking these by feel were all wrong in the same direction — a bracket that looked reasonable on
a bench test doesn't survive contact with how an actual thumb swipes on an actual phone.

A measurement session captured a labeled range of real swipes (slowest, easy lob, normal, hard,
hardest) and their resulting speeds. The key finding: an ordinary "normal" flick was landing at
roughly 97% of maximum power under the old constants, meaning almost every real throw was
effectively a maximum-power throw regardless of intent. That's the root of most complaints about
how the game felt. The current constants are set from the low end of the measured "aiming for a
100" band, which puts a normal flick solidly in the middle of the range instead of pinned to
either end.

### Speed range history

See DECISIONS.md#speed-range-standing-rule for the rule now enforced in code.

#### Speed range standing rule

`minSpeed`/`maxSpeed` used to be set by bracketing them tightly to the scoring ladder — the
slowest speed that just reaches the nearest hole, the fastest that just reaches the furthest one.
That approach reads well as a bench measurement but is exactly wrong for a human hand: a real,
comfortable flick sits near a player's max effort, so a tightly bracketed ceiling gets hit by
almost every ordinary throw, and the softest holes become unreachable by a normal swipe. The
standing rule going forward: a comfortable, natural flick must land in the middle of the speed
range, never at either end. Do not re-tighten these values to bracket the ladder's endpoints
again.

### Aim angle

`aimMax` (in `boards.js`) sets how far sideways a swipe can aim, in radians. An earlier value was
tuned narrowly to thread the ball into the top corner holes, which as a side effect made the side
walls flatly unreachable at any power — a player could never intentionally throw the ball into a
wall and get nothing for it, which is a legitimate thing to want to do. Widened so both remain
possible: threading a corner hole, and deliberately throwing into a wall.

### Power curve rebuild

The power-to-outcome mapping was reworked after a play review found the original ladder
unlearnable — tiny, sub-pixel differences in swipe strength were flipping which hole the ball
landed in, and both ends of the dial (softest and hardest swipes) were dead zones that always
produced the same floor result. The fixed version interpolates speed as velocity-squared (since
rolling distance up the slope scales with the square of arrival speed, not linearly with it), and
moved the "risk" of an aggressive throw from the power axis onto the aim axis — overshooting on
power no longer costs a player anything by itself; only a hard sideways aim that misses does. The
current test suite in `test.js` is the executable record of what the resulting ladder must look
like: band width, no dead zones, and quarter-by-quarter improvement with more power.

### Swipe power is 2-D

Power used to be clocked from the swipe's UPWARD travel only (`first.y - end.y`), while aim was
read from the same swipe's ANGLE. That put the two inputs in direct opposition: angling toward a
100 discarded the sideways part of the gesture, so the harder a player angled the softer the game
heard them. Worse, the aim mapping clamps at 0.38 rad (21.8 degrees) — past that, extra angle
bought no extra aim and cost power anyway. A 45-degree swipe lost 29% of its speed for aim it
already had at 22 degrees, which is why an angled throw could land SHORTER than a straight one at
the same effort (Matt, 2026-08-21: "I aim for the 100 and throw it harder. It lands even shorter
than the one thrown straight.").

Speed is now the swipe's actual 2-D distance over time, so angling costs nothing. The gate that
decides whether a gesture was a throw at all stays vertical — a sideways smudge is still not a
throw — and a release window that finished downward is discarded rather than measured, which the
old signed subtraction got for free by going negative.

The key property: for a straight swipe `hypot(0, dy) === |dy|`, so the new ruler is bit-identical
to the old one at every speed a straight throw can have (verified over 780 synthetic gestures,
max difference 0). None of the measured tuning moved — `SWIPE_SLOW`/`SWIPE_FAST`, the speed
range, the power curve and the ladder all still stand. Only angled throws changed, and only by
getting back the effort they were already spending.

Note that `startThrow` applies a second cosine — launch velocity is rotated, so the forward
component is `speed * cos(aim * aimMax)`. That one is NOT a bug and must stay: a ball thrown
sideways genuinely travels less far up the face, and every measured number already includes it.

## Physics

### Why cannon-es

The ball is simulated with the vendored cannon-es rigid-body physics engine
(`skeeball/js/vendor/`) rather than hand-rolled collision code. Three earlier attempts at
hand-written physics were each visibly distinguishable from a real physical reaction — scripted
outcomes read as scripted. Using a general-purpose, battle-tested engine removes that failure
mode entirely: nothing in `physics.js` scripts a bounce, roll, or rattle any more, all of it comes
out of the contact solver.

### Contact materials

Each surface has its own material tuned for a specific feel: the lane and hump are low-bounce
wood, the scoring board is livelier so the ball settles into a roll rather than skidding, the side
walls are slick so a ball can bank off them, the rings are near-zero restitution plastic so a
clipped rim kills momentum instead of bouncing the ball around, and the backboard/cage material is
dead so a slammed ball loses its energy against it.

Wall and ring friction are both deliberately near zero. This is a guard, not a tuning choice: any
appreciable lateral grip is enough to physically wedge a ball against a ring on the slope,
locking it in place instead of letting it slide off and continue.

The board's own bounciness was tuned down substantially from an earlier, livelier value. A board
that bounces the ball around before it settles turns "how hard did I throw it" into noise, since
a bounce can send an otherwise well-aimed throw into a different hole than a slightly harder or
softer version of the same throw would have reached. A board the ball lands on and rolls up keeps
that relationship smooth and learnable.

### Hole capture

Capture is a kinematic test, not a "ball center is over the hole" test: given the ball's current
speed and the mouth's width, does the ball have time to drop below the hole's lip while crossing
it? A ball dropping steeply into a cup is captured even at speed; a ball skimming across at a flat
angle is not caught and continues unchanged. This is the only thing that makes distance up the
slope choose the cup — see DECISIONS.md#capture-history for why the naive version doesn't work.

#### Capture history

An earlier, simpler version of capture just checked whether the ball's center was over an open
mouth. Since a ball rolling up the slope crosses every lower-value hole before it can reach a
higher one, that version meant the first (lowest) hole a ball crossed always caught it — nothing
above the bottom hole was ever reachable by rolling, only by lobbing a ball through the air. The
kinematic version replaced it.

### A ball that comes back down the ramp is always given back

A ball that ends up back at the near end of the lane, rolling toward the player, is handed back
rather than spent. That rule exists for a throw too soft to clear the hump: the ball never reached
the board, so charging the player for it would be dishonest, and a real machine would not have
taken it either.

It applies to a hard throw too. A ball that clears the board, hits the back and runs all the way
home arrives at the same place by the same test, and is returned for the same reason: it is back
in your hand, so the machine has not taken it.

**This was briefly changed and changed back on 2026-08-21.** A playtest found that roughly one
hard throw in eight (measured headless across power 0.70-1.30 and aim 0-1) came back with no
score, no message and no ball spent, and read as the game ignoring the player. The fix shipped
was an `st.arrived` test that made the hard case resolve as a zero and spend the ball. Matt
reverted it the same day: the free return is the intended behaviour and nobody had asked for it
to change.

The finding underneath it still stands. A ball that silently reappears is a **feedback** problem,
not a scoring one, and it is open. Whatever fixes it must not spend the ball. Note that the
obvious answer is already ruled out: "Too soft, have it back" was deleted days earlier for being
noise, so it cannot simply come back as it was.

### Removed features and why they stay removed

These were built, then deliberately deleted, and must not be reintroduced:

- **No magnetism, ever.** A "dish" effect used to pull slow balls toward the 20's mouth from
  anywhere inside its ring, meant to model a real dished bowl shape. It was removed because it is,
  functionally, a ball being steered into a hole it wasn't thrown at — a standing, permanent ban
  on this game. A ball that runs out of speed on the slope now does the honest thing and rolls
  back down into the trough. If a power band needs widening, widen it in the geometry, never by
  moving the ball once thrown.
- **No resting-position scoring.** An earlier board scored a ball by wherever it came to rest on
  the face (inside a zone = that zone's value). This board's rings stand tall enough that a hole
  can only be entered by arcing over the wall and dropping through the mouth, so the only way to
  score a hole's value is falling through it — a ball that stops on the face without falling
  through anything scores nothing there. Do not reintroduce a rule that scores resting position.
- **No wire cage over the board.** A slanted canopy used to sit over the board to catch
  excessively high "rainbow" throws before they left the machine. It was removed because it
  directly contradicts the rule that there is no upper limit on throw power or height — a canopy
  whose entire purpose is to stop those throws can't coexist with that rule. A ball thrown hard
  enough to leave the machine is supposed to leave; it still resolves (arcs out, comes down,
  scores whatever it earned).
- **No tall side panels flanking the cabinet.** Large vertical panels used to stand on either side
  of the machine as background dressing. They weren't based on any reference photo, and from the
  in-play camera angle they read as the walls of a corridor rather than an arcade cabinet. If the
  background looks visually flat without them, the fix is lighting, not reintroducing the panels.

## Rendering

### Camera and framing

See DECISIONS.md#camera-history. The standing rule (kept as a guard in code): the field of view is
fit to a list of key world points that must always stay visible (the resting ball, the board's
corners, the top of the marquee, and so on), never to a single point. Fitting to one point alone
— even a well-chosen one — cannot guarantee every other important part of the machine stays on
screen at every device aspect ratio. If a future machine adds a part that must stay visible, add
its point to the list rather than reverting to a single-point fit.

#### Camera history

The camera originally sat in front of the ball rather than behind it, which pushed the ball
completely off screen for the first fraction of every throw. Moving the camera behind the ball
fixed visibility, but a later version over-corrected and framed too tightly around just the
resting ball, which cut off the top and bottom of the machine on many screens. The current
point-list based fit was built specifically to solve both problems at once.

### Scoreboard

The backboard is painted as a live four-column scoreboard (all-time best, your best, best today,
last game) rather than static signage. The columns are fixed pixel widths and the panel is a
fixed height, so a score gaining a digit or a long player name can never shift anything else in
the layout — only the text inside a column changes size to fit. Plain bold sans-serif text is
used for the values; more decorative styles (segmented "LED" digits, serif numerals) were tried
and none of them stayed legible once shrunk to the actual on-screen size of the panel on a phone.

### Where the point values live

Every value is painted on a RING, never on the board face. The face carried a mirrored pair of
stencilled numbers per hole until 2026-08-19; they read as scores scattered at random and were
removed. Do not paint them back.

A ring wall offers exactly two surfaces the player can see: the OUTER face of its near wall
(convex, curving away at the edges) and the INNER face of its far wall (concave, curving toward
you). Concave reads far better, but in this stack it is usually buried: the rings are TANGENT, so
the far wall of one ring stands back to back with the near wall of the next, touching it. Only
the TOP ring of the column has a free far wall. That is why the 50 can sit on its own ring and
nothing else in the column can - confirmed by colouring every inner face in, and by raising the
camera. Two touching surfaces stay touching from every angle; neither a camera move nor a tilt
change recovers them.

So the rule, in `render.js`:

- Top hole of the column: its own ring, far wall, concave. (The 50.)
- Any other hole: the OUTER wall of the ring above it, provided the number does not wrap more
  than `MAX_WRAP` on that ring. (The 10 and 20, whose rings are 36cm and 53cm across.)
- Past that threshold a digit turns edge-on and vanishes behind the ring silhouette, so the
  number gets a concave arc of its own: concentric with its own ring and the same height as it,
  set `INSET` in from the far wall so it clears the ring above while still reading as that
  ring's own inner face. (The 30 and 40, on the two tightest rings on the board.) The arc is
  cosmetic geometry with no physics body - a ball can pass through it.

`platedHoles()` decides this FROM THE BOARD, so a new machine configures itself: widen a ring and
its number moves back onto the wall, tighten one and it gets an arc. Nothing to set per board.

The 30 and 40 shipped clipped on 2026-08-19 because every number was put on a ring wall
regardless of how far it had to wrap.

### Removed scenery

See DECISIONS.md#removed-features-and-why-they-stay-removed for the wire cage and tall side panel
removals — both apply to rendering as much as to physics, since the geometry is shared between the
two.

Cup and ring rendering derives directly from the same physics collision data used by the solver,
rather than being drawn separately from a hand-placed description. This is a guard: an earlier
version drew rings independently of what the physics engine actually used for collision, and the
two silently went out of sync, producing an invisible wall the ball would bounce off with nothing
visible drawn there. Deriving what's drawn from the same data the solver uses makes that class of
bug structurally impossible, not just fixed once.

An earlier cup design also painted each hole's value onto a curved wall standing around the
mouth. A flat number painted onto a curved cylindrical surface geometrically can't avoid being
clipped by that same curve — every number ended up rendering with part of it cut off. Values are
now painted flat on the board's own texture instead, next to the hole rather than on any wall
around it.

## Test suite contracts

`test.js`'s reachability sweep, ladder-shape assertions (no dead zones, adjacent-step stability,
harder-goes-further), and rattle/settle timing checks are the executable specification of the
current power curve and machine feel. They replaced an earlier set of assertions written for a
different, retired scoring model (ball rolls to rest and scores by position, rather than falls
through a hole) — when those two models disagree about what "correct" looks like, the test suite
in code is authoritative, not this file.
