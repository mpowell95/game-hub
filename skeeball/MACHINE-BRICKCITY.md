# HOT SHOT: BRICK CITY — machine 3

*Third in the chain and third on the setup carousel, which is what "machine 3" means here; it is
the fourth machine built. `BOARDS` order in `js/boards.js` drives the carousel, so it was inserted
as the third element rather than appended.*

> **This file documents ONE machine.** It can be rewritten end to end without touching a line
> another machine relies on, which is the point (`skeeball/CLAUDE.md`, "HARD RULE: every machine
> owns its own engine"). Do not restate or edit another machine's docs from here, and do not fold
> this one back into a shared section.
>
> The rules every machine must satisfy are in `skeeball/MACHINE-SPEC.md`; the tuning history of
> the machines that came before is in `skeeball/DECISIONS.md`. Nothing here overrides THE LAW or
> its nine working rules (root `CLAUDE.md`).

Built 2026-08-24 as a sibling of **HOT SHOT** (board id `basketball`): the same cabinet, the same
lane, the same 70-degree ramp, the same three-tier staircase and the same basketball, wearing a
brick marquee and a different face. Nine baskets on three treads. The row nearest the player
**takes points away**, which is the whole machine.

## Identity — frozen, THE LAW rule 5

| | |
|---|---|
| Board id | **`brickcity`** — frozen from first play. It keys `sk.unlocked.brickcity`, this machine's per-board bests and totals under `sk.boards.brickcity`, POPONGO's `unlock: { board: 'brickcity' }`, and the `byDiff` bucket in every player's `gamehub.stats`. **Never rename it, whatever the marquee says.** |
| Display name | **HOT SHOT: BRICK CITY** — a proper noun, never routed through `t()` (the standing rule THE CLASSIC and STARHUB follow). Only `name:` in `js/boards.js` is shown to a player. |
| Engine | `skeeball/js/machines/brickcity/` — its own `machine.js`, `physics.js`, `render.js`, started as a verbatim copy of `machines/basketball/` and free to diverge. One row in `skeeball/js/engines.js`. |
| Cup ids | `p100a` `p100b` `p50` `p40a` `p40b` `p20` `m20a` `m20b` `m10` — each cup's value is frozen to its id forever. |
| Slot ids | `lowL` `lowC` `lowR` `midL` `midC` `midR` `topL` `topC` `topR` — frozen; they ride the mid-rack autosave (`gamehub.skeeball.save.v1`). |
| Tagline | `board_brickcity_tag`, EN and ES in `skeeball/js/strings.js`. Taglines ARE translated; the name is not. |
| Ships as | `adminOnly: true` — Matt's call, 2026-08-24, the same as its two neighbours while he plays it. That is only the CODE DEFAULT: the in-app **Admin** page moves it between Testing / Unlockable / Open with no commit and no deploy. |

## You could not tell where the ball hit the wall (2026-09-03)

Matt: *"It's impossible to tell where on the back wall a ball that's overthrown bounces off.
Sometimes I'll throw it and it doesn't look like it even touched the back wall, but based off how
it lands I know it must have."*

The engine always knew and never said. `physics.js` fires a `backboard` event on contact, but it
carries a SPEED and no position, and `ui.js` only counts it for telemetry - so a bounce off the
back of the machine had no visual at all, and the ball simply changed direction in front of a flat
wall for no visible reason.

**Measured first, over 276 throws across the swipe/power range, counting what a ball touches once
it is past the ramp:**

| | contacts | times it was the FIRST thing touched |
|---|---|---|
| side rail | 510 | 95 |
| back wall | 113 | 88 |
| riser | 320 | 45 |
| basket collar | 1782 | 26 |

**So the side rails are in this, and they are not an extra.** "It must have hit the back wall" is,
as often as not, a rail: the rail is hit four and a half times as often, and it is the first thing
the ball meets more often than the back wall is. Marking only the back wall would have left half
of exactly the throws Matt is describing still unexplained. 41% of throws touch the back wall at
all.

**What the fix is not.** The `backboard` event's 0.4 m/s threshold looked like the cause of "it
didn't look like it even touched" and was not: of 113 back-wall touches exactly ONE was under it,
and they land at a median 1.75 m/s. The mark's own threshold is 0.1 m/s, which catches that one
and anything softer on a rail, and costs nothing.

**The mark.** `physics.js` emits a `wall` event (part, point, impact speed); `ui.js` hands it to
the renderer if that machine's renderer has a `wallMarkAt` - feature-tested, not machine-tested, so
the other four machines ignore an event they never emit and the next machine opts in by adding the
method. `render.js` draws a ring at the point, for 0.55s.

- **Two rings, dark behind bright**, for the same reason `popupAt` strokes its text before filling
  it: the lower wall is the cream-and-gold scoreboard and the upper is near-black cabinet, and a
  single-colour ring is invisible on one or the other.
- **Size is the impact speed** - 11.6 cm to 23 cm, one to two ball widths - so a graze and a
  hammer do not look alike. At one ball width it was legible on the back wall and too small to
  find on a rail, which is further away and a smaller target on screen.
- **It sits on the SURFACE, not where the ball was.** The event carries the ball's centre, which
  at contact stands a full ball radius (5.45 cm) off the wall; drawn there the mark floats in
  mid-air. Only the two coordinates along the wall come from the ball, and the third is the wall's
  own plane, read from `machine.js`.
- **And it faces the player.** Laid flat on a side rail the ring is seen almost edge-on and reads
  as a thin sliver. A mark is an annotation, not a sticker on the scenery.
- One mark per impact (the solver fires several callbacks per hit) and twelve per throw, so a ball
  grinding along a rail leaves a mark rather than forty.

**Verified by reading the pixels**, not by eye: with a mark placed at each of four real measured
contact points, the rendered frame carries the ring's gold at all four - 4605 gold pixels on the
back wall, 2058 and 291 on the right rail, 368 on the left. The eye missed the rail ones on a
scaled screenshot; the framebuffer did not.

## The 100 that was paid for a ball balanced on the rim (2026-09-02)

Matt, with three screen recordings, hours after the corner-100 fix below went live: *"You made the
game SIGNIFICANTLY worse."* He was right, and the cause was a rule added by that fix.

**What the recordings show.** In all three, every 100 has the same shape: the ball goes UP to the
top of the machine, loiters against the backboard or the right rail for half a second to a second,
comes back DOWN onto the top-right 100, comes to rest ON ITS RIM, and is paid 100. Same basket
every time. Not one was a ball thrown into a basket. One rack went from 140 to 440 on it.

**The rule that did it.** The corner-100 fix added a LIP-REST capture: a ball whose centre was
inside a widened radius (`rRest = r - ballR*0.10`, against the mouth's own `rEff = r - ballR*0.28`),
slower than 0.6 m/s, anywhere below rim + `ballR*1.15`, was captured. It was written for one
measured case - a ball sliding down the riser onto the rim, teetering, then rolling off into the
-10 - and it paid for a completely different one. Traced on the engine Matt filmed, a typical
"100" captured with the ball **5.3 cm off the basket's axis on a 4.3 cm opening, 5.4 cm above the
rim, drifting at 0.19 m/s and moving AWAY from the face.** It was sitting on the rim.

**The second half, and the one that made deleting the first rule insufficient.** That same fix
raised the capture height gate from `ballR*1.9` above the TREAD to `lip + ballR*1.9` - above the
RIM - for every ball. A collar stands 0.116 above its tread, so the raise also admits a ball
sitting still on top of the rim, and the kinematic test cannot refuse it: a stationary ball
trivially "falls past the lip before crossing the mouth". The rim-relative gate is right for the
shot it was written for (a ball DROPPED onto the basket has to be seen before the rim gets it), so
it is kept and **gated on the ball actually falling** - `hDot < -0.8` m/s into the face. A ball
arriving off this machine's 70-degree launch comes in at 2 to 3 m/s; a ball resting on a rim or
rolling across a tread is at essentially zero.

**It is also section 3b's standing guard, broken by the fix that added it**: a ball that comes to
rest on the face is never scored, and the only way to score a hole's value is to fall through its
mouth. A ball balanced on a rim is on the wall, not in the basket.

| corner 100s in a 23 x 10 swipe/power sweep | before | after |
|---|---|---|
| scored | 18 | 16 |
| **of those, PERCHED on the rim** | **11** | **0** |
| balls arriving over the mouth that score | 3 of 3 | 3 of 3 |
| points per throw (rack-of-9 equivalent) | 6.6 (59) | 5.9 (53) |

The shot the corner-100 fix existed for is untouched: `test-brickcity-corner100.mjs` still measures
20 of 26 over-the-mouth arrivals scoring, against 25% before that fix.

**The probe that would have caught it.** That suite's behavioural checks ALL PASSED while this was
happening, because a ball perched on the rim still counts as "arrived over the mouth". Only the
geometry AT THE MOMENT OF CAPTURE separates a basket from a ball balanced on its edge, so the suite
now checks exactly that, over a real sweep: every corner 100 must be captured either over the
opening or already below the rim plane. Born red against the engine Matt filmed.

## The perch, and why this machine no longer pops a parked ball (2026-08-26)

Matt, on the build that had just been made smooth: *"the ball sometimes gets stuck IN the negative
baskets. Like instead of falling in, it's just stuck there."*

It was real, it is this machine's own geometry, and it had never been tested - `skeeball/js/test.js`
sweeps `DEFAULT_BOARD`, so BRICK CITY had no engine suite at all.

**Every stall in a 41x21 sweep landed at the same place**: world `z -2.289`, `y 0.579` or `0.627`.
That is the back rim of the bottom row's cups where they stand against the riser behind them.

```
bottom cup centre   y 0.439   z -2.235      rim top y 0.585   r 0.109  collar 0.146
riser behind it     top y 0.620   front face z -2.234
ball                r 0.0545                 rests at y 0.579 / 0.627, z -2.289
```

The bottom cups are the widest on the machine (`r 0.109` against the middle row's `0.070`) and sit
3in back against their riser, exactly as the face spec calls for. Rim and riser therefore form a
cradle, and a slow ball can balance in it. **Capture cannot save it and should not**: the guard
needs `f.h < ballR * 1.9` (0.104) and a ball perched on top of a 0.146 collar is at `f.h ~ 0.20`.
It is not in the mouth, it is on the wall.

**THE CLASSIC never needed a rule for this.** One continuous slope means a resting ball always rolls
back down, which is what `physics.js` section 3b still assumes when it says a ball at rest is "left
alone" and "rolls back down into the trough like a real machine". A staircase removed that
guarantee and nothing replaced it.

**What was actually wrong was the watchdog's timing.** It waited 0.9s, popped the ball, waited 0.9s,
popped again, waited 0.9s, then gave up - 2.7s of a dead ball, with two visible twitches. Measured
over 861 throws: it fired on **65 (7.5%, about one ball every other rack)**, 57 went all the way to
jammed, and the two pops rescued **one ball in 861 - into a -20**. They bought nothing and cost the
player the wait.

**Now: parked for 0.6s = jammed, scores zero, vanishes.** Which is Matt's own standing rule from
2026-08-22: *"Stuck balls should score ZERO. and not be moved. It should vanish."* The pops were the
thing that moved it.

| | before | after |
|---|---|---|
| worst dead-still stretch | 2.62s | **0.57s** |
| median settle | 2.42s | 2.12s |
| outcomes changed (of 861) | - | **2, both a -20 becoming a 0** |

**GUARD: 0.6s is measured, not chosen.** At 0.45s the sweep starts killing real throws (a 100 became
a 0). Shortening the window while KEEPING the pops is worse still: 63 outcomes move and 44 go
against the player, because a pop near the bottom row mostly knocks the ball into a penalty cup.

`test-brickcity-stall.mjs` pins all of it and was born red against the pre-fix engine. **BRICK CITY
only** - the other four machines keep their pops, and THE CLASSIC has the slope that makes them
harmless.

## Where it sits in the unlock chain

```
THE CLASSIC  ->  HOT SHOT  ->  HOT SHOT: BRICK CITY  ->  POPONGO
 (always open)   (classic's     (hot shot's                (brick city's
                  objectives)    objectives)                objectives)
```

Confirmed by Matt, 2026-08-24. This machine was inserted BETWEEN HOT SHOT and POPONGO, so
POPONGO's `unlock` moved from `{ board: 'basketball' }` to `{ board: 'brickcity' }`.

**Nobody lost a machine they had already earned, and nobody could have** (THE LAW rule 2).
`sk.unlocked` is an additive SET in `js/arcade-scores.js`: `unlockSkeeballBoard()` only ever adds
an id, the cross-device merge is a union, and no code path anywhere removes one. A player holding
`sk.unlocked.popongo` keeps POPONGO whatever the chain says today, and re-pointing an `unlock`
only changes what a player who does NOT yet hold it must do next. Verified by replay rather than
assumed — see "Verification" below.

## The face

Columns `u = -2.07X / 0 / +2.07X` (-8.28 in / 0 / +8.28 in) and rows `v = 1.3125X / 5.3X /
9.2875X` unrolled, each basket 0.75X (3 in) back from its tread's rear edge against the riser.
All of that is HOT SHOT's, unchanged, including Matt's 2026-08-23 "do not move them forward
again" call about the set-back.

```
   row 3   v 9.2875X     100    50    100      3.20 / 3.50 / 3.20 in   the skill row
   row 2   v 5.3X         40    20     40      3.88 in                 a real shot, and OPEN
   row 1   v 1.3125X     -20   -10    -20      6.00 in                 the biggest mouths here
```

**Size and value move together, and the ladder runs BIG TO SMALL from the player outward: the
deeper into the machine a basket sits, the smaller its mouth and the more it pays.** The penalty
row is the widest thing on the face on purpose — it is the easiest thing to fall into, which is
what makes -20 a real risk rather than a decoration, and every shot selection on this machine
follows from wanting to clear it.

**The first build had this backwards** and it is worth recording why, because it looked defensible
on paper. A question about row 2's size was answered "keep them at whatever they're currently at",
which was read as HOT SHOT's live 1.5X rims — so the 6.00 in row landed in the MIDDLE with a
3.88 in row under it. Matt, on seeing it: *"Why are the baskets in the middle row so big? The ball
can't roll down to the bottom row because you made the middle row so large… The baskets in the
bottom row should be the size of what you put in the middle row. And vice versa."* He is right —
a 6.00 in middle row is a wall, and nothing that clears the top rows can get past it to the
penalty row it is supposed to threaten. The two rows are swapped now.

### Every dimension, three ways

`X` is the board's unit (the nominal hole diameter): **X = 4.00 in = 0.145455 m**, from
`boardW` 1.00 m = 6.875X = 27.5 in. `r` is the MOUTH RADIUS, so a mouth is `2r` across. A collar's
OUTER diameter is its mouth plus two `collarThick` (0.012 m = 0.0825X = 0.33 in).

| | X | inches | metres |
|---|---|---|---|
| **Ball** (HOT SHOT's, which is THE CLASSIC's) | 0.75X across (`ballR` X\*0.375) | 3.00 | 0.10909 |
| **Row 1 mouth** (-20 / -10 / -20) | 1.5X (`r` X\*0.75) | 6.00 | 0.21818 |
| Row 1 outer | 1.665X | 6.66 | 0.24218 |
| Row 1 depth (`collarH`) | 1.0X | 4.00 | 0.14545 |
| **Row 2 mouth** (40 / 20 / 40) | 0.97X (`r` X\*0.485) | 3.88 | 0.09891 |
| Row 2 outer | 1.135X | 4.54 | 0.11527 |
| Row 2 depth | 0.97X | 3.88 | 0.09891 |
| **Row 3 mouth, the 100s** | 0.8X (`r` X\*0.4) | 3.20 | 0.11636 |
| Row 3 outer, the 100s | 0.965X | 3.86 | 0.14036 |
| Row 3 depth, the 100s | 0.8X | 3.20 | 0.11636 |
| **Row 3 mouth, the 50** | 0.875X (`r` X\*0.4375) | 3.50 | 0.12727 |
| Row 3 outer, the 50 | 1.04X | 4.16 | 0.15127 |
| Row 3 depth, the 50 | 0.875X | 3.50 | 0.12727 |
| Column offset | 2.07X | 8.28 | 0.30109 |
| Row heights (unrolled `v`) | 1.3125X / 5.3X / 9.2875X | 5.25 / 21.20 / 37.15 | 0.19091 / 0.77091 / 1.35100 |
| Collar wall thickness | 0.0825X | 0.33 | 0.012 |
| Board width | 6.875X | 27.5 | 1.00 |
| Board length (unrolled) | 11.9625X | 47.85 | 1.74000 |
| Treads (3) | 2.0625X at 0.10 rad | 8.25 | 0.30 |
| Risers (3) | 1.925X, vertical | 7.70 | 0.28 |

Everything not in that table — `ballMass`, `laneLen`, `laneW`, `bedThick`, `humpLen`,
`humpAngles` (the 70-degree launch), `troughLen`, `troughDepth`, `boardLipY`, `boardTilt`,
`steps`, `boardLen`, `railH`, `laneRailH`, `backboardH`, `cupSegments`, `collarThick`, `ringH`,
`ringThick`, `lipLowFrac`, `captureDrop`, `minSpeed`, `maxSpeed`, `aimMax` and the whole `mat`
block — is HOT SHOT's, copied verbatim. **The face is the only thing that changes.**

### Why the 100s are 3.20 in

The ball is 3.00 in. A 3.20 in mouth leaves **0.10 in of clearance on each side**, which is the
tightest opening in the game by a wide margin and is the point: it is the one shot on this machine
that has to be AIMED rather than ranged, and there are two of them.

At 1.07 times the ball, that is the tightest mouth-to-ball ratio anywhere in Skeeball — HOT SHOT's
own 100 is 1.42, its standard hoops and POPONGO's cups are both about 2.0, and THE CLASSIC's holes
are 1.33.

3.20 in is also close to the FLOOR for a real opening. **A mouth narrower than the ball is a
painted dot, not a basket** — it cannot be scored at all, at any power, by any player, and it
would be a lie on the face. Anything in the range just under the ball's diameter is worse than
useless; it is a target that looks reachable and is not.

Measured, not asserted: the build sweep captures both 100s cleanly (see "Verification"), so the
shot is real. It is rare, which is what a 100 should be.

### The gaps, which decide whether a miss can travel

`boards.js`'s spacing rule, learned twice and written down after POPONGO's build: **a gap is
either MERGED or wider than a ball plus margin, and an in-between gap is a pocket.** A ball that
gets far enough into a too-tight channel to touch two things at once, with the tread as a third
contact, locks the cannon solver; the watchdog walks it out as a zero.

Both shipped rows are on the right side of that rule, from opposite directions:

| | outer | to the side rail | between adjacent baskets | |
|---|---|---|---|---|
| **row 1** at 6.00 in mouth | 6.66 in | 2.14 in | 1.62 in | both **MERGED** — far under the 3.00 in ball, so it cannot enter either and cannot wedge |
| **row 2** at 3.88 in mouth | 4.54 in | 3.20 in | 3.74 in | both **CLEAR** the ball, so a miss here really does carry on down the face |

A ball reaching row 1 therefore lands in a penalty basket or is stopped by one. The clear tread
strip in front of the row, the risers and the trough are the routes to a plain 0.

**The one size that must not come back is 4.34 in on row 1.** At 1.25X (5.00 in) outer it leaves a
**2.97 in** rail channel against a 3.00 in ball — the exact in-between case — and the full 41x21
grid measured **111 of 861 throws (12.89%)** walked out by the watchdog, **83 of them wedged in
that channel**, ball centre at u = ±12.25 in, which is the rail at ball radius. Depth was never the
cause: a variant with every collar at two thirds of its mouth still measured 8.66%.

**Do not resize either row without redoing all four of those gap numbers and re-running the
sweep.** There is not much room — three collars and four gaps across 27.5 in — and the sizes that
work are the ones either comfortably bigger than the ball or comfortably too small for it.

## The marquee

**The sign is the design Matt handed over, not a version of it.** `_paintMarquee()` in
`skeeball/js/machines/brickcity/render.js` paints the artifact's `.sign` block onto the marquee
panel the same way `_paintField` and `_paintLane` paint the board and the lane, with
`SRGBColorSpace` declared (without it the sRGB hex reaches the shader as linear albedo, the brick
goes pink and the chalk plate goes grey). 1024 x 252 canvas.

The CSS-to-canvas mapping, so a future session can check the sign against the artifact rather than
against taste:

| artifact CSS | painted as |
|---|---|
| `.sign` `background: linear-gradient(180deg, #A33427, #6E2018)` | the brick panel's vertical fade |
| `.sign` `border: 6px solid var(--bulb)` | the **bulb-yellow frame** around the whole sign |
| `.sign` `box-shadow: 0 0 0 5px #0D0E12` | the **dark edge ring** outside that frame |
| `.sign::before` horizontals `rgba(0,0,0,.34)` every 26px | mortar courses |
| `.sign::before` verticals `rgba(0,0,0,.28)` every 58px | brick joints |
| `.sign::after` the same verticals offset `29px 13px`, masked to alternate courses | every other course offset half a brick |
| both coursing layers at `opacity: .5` | one `globalAlpha = 0.5` pass |
| `.bulbs` 12 bulbs, `space-between`, one bar top and one bottom | `_signBulbs` |
| `.bulb` 11px `#FFC53D`, `0 0 10px 2px rgba(255,197,61,.75)` | lit glass with its glow |
| `.bulb` `inset 0 -2px 3px rgba(160,105,0,.5)` | shading **under** the glass, not a highlight on top |
| `.hot` `0 5px 0 #6E2018` | the hard drop shadow, drawn first |
| `.hot` `0 0 48px rgba(255,107,44,.45)` then `0 0 18px rgba(255,107,44,.85)` then `0 0 2px rgba(255,197,61,.9)` | three ember/bulb halo passes, widest first |
| `.hot` `color: #FFC53D` | the letters themselves |
| `.plate` `#14161B`, `border: 3px solid #EDE6DA`, `radius: 2px` | the BRICK CITY plate |
| `.plate` `box-shadow: 0 6px 0 rgba(0,0,0,.45)` | its hard, unblurred drop |
| the plate's inline SVG | `_signRimGlyph` — orange ball, its seams, chalk rim, five net strands |

**The one thing that is not the artifact's is the aspect ratio.** The mock's sign is about 2.3:1;
this cabinet's marquee panel is 4.06:1. So the sign is drawn WIDER — the ring, the frame, the bulb
bars, the lettering and the plate are all the artifact's, and the brick simply runs further to
each side. Nothing else was reinterpreted.

**Every letter is a path, not a font.** The design sets both names in Bungee. A webfont is not
something this game may fetch (no build step, must work offline, and a font that has not loaded yet
paints the sign in whatever the browser falls back to), so `_signWord` / `_signGlyph` draw a heavy
condensed alphabet out of lines and curves. Only the ten letters these two names need exist
(B C H I K O R S T Y); a letter with no glyph draws nothing rather than a tofu box.

The three numbers that make it read as condensed signage, and that have to agree in `_signWidth`,
`_signWord` and both callers: **advance 0.64 of cap height, tracking 0.12, stem 0.21.** Those came
off a look, not a preference (`VISUAL-PROCESS.md`): at a heavier weight the B and the S closed
their counters into a blob, and the first S — built out of squared `arcTo` corners — read as a
**5**. The S is two bezier S-curves now, and B and R share one `bowl` helper whose control points
sit past the box edge so the bowl is as full as the letter.

**Sizes on the canvas:** 6px dark ring, 9px bulb frame, then the brick; bulb bars 13px inside the
top and bottom edges; HOT SHOT at cap 78 from y 42; the plate 74 tall from y 132, carrying BRICK
CITY at cap 40 with a 58px glyph.

**No chase animation.** The artifact's own notes call its chase "a suggestion, not a requirement".
These bulbs are painted INTO the texture, so a chase would mean repainting a 1024 x 252 canvas and
re-uploading it every frame for something the player sees at the top of the screen while watching a
ball. The seven real bulb MESHES above the panel already flash on `celebrate()`, which is where
movement belongs; `REDUCED` at the top of `render.js` is the `prefers-reduced-motion` gate it would
need.

**The HUD used to cover this sign, and no longer does.** The shared centre goal chip sat on a
band measured only against THE CLASSIC's geometry, so on the taller staircase machines it landed
on the marquee, across the lettering. The chip is back, and it is IN FLOW above the stage now — the
machine is drawn in the height that is left, so it cannot reach this sign on any board. See
`skeeball/CLAUDE.md`, "Where the three objectives sit". That was a change to all four cabinets,
not a BRICK CITY one.

### The palette (`look`)

| key | hex | what it paints |
|---|---|---|
| `marquee` | `#A33427` | the brick panel |
| `marqueeText` | `#FFC53D` | the HOT SHOT lettering |
| `bulb` | `#FFC53D` | every bulb, painted and real |
| `glow` | `#FF6B2C` | the ember halo, and the ball in the plate glyph |
| `net` | `#EDE6DA` | the nets, and the BRICK CITY plate's border and lettering |
| `value` | `#EDE6DA` | the printed values on the baskets |
| `face` | `#1E63B8` | HOT SHOT's court blue, kept so the two read as siblings |
| `cabinetEdge` | `#14161B` | cabinet trim |
| `pocket` | `#14161B` | the dark inside every basket |
| `wood` `woodDark` `cabinet` `ring` `ringLip` `faceEdge` `wall` | HOT SHOT's | the cabinet, lane and side walls are that machine's |

## Negative values: what they touched, and what they deliberately did not

BRICK CITY is the first machine whose cups carry negative values. Three shared files were
involved, and each change is the smallest one that makes the machine honest:

- **`skeeball/js/game.js` floors the rack score at 0** after every settled ball. `recordSkeeball`
  in `js/game-stats.js` clamps with `Math.max(0, e.score | 0)`, so without the floor a rack shown
  as -40 would be FILED as 0 and the player would be told two different things about the same nine
  balls. Matt's call, asked and answered the day this was built: penalties eat what you have
  earned, they do not put you in debt. Clamping in `game.js` — the file that owns what is true —
  keeps this a display question rather than a THE LAW question, because nothing recorded changes
  shape. Boards with no negative cups are untouched by the line.
- **`skeeball/js/ui.js` prints the sign** on the landing popup (`signedValue`). Every popup used
  to be built as `` `+${value}` ``, which prints "+-20" the moment a machine like this exists. A
  real minus (U+2212) rather than a hyphen, matching POPONGO's equalizer popup, because at popup
  size a hyphen reads as a dash inside the number.
  **The printed value on the BASKET is a plain ASCII hyphen (`label: '-20'`), and that split is
  deliberate.** The popup is drawn by the same routine POPONGO's `−` already ships through, so
  U+2212 is proven to render there; the basket label is canvas text in a system font on a phone,
  where a missing glyph would be a tofu box on the board itself. A hyphen beside a digit reads as
  a minus in context, and it cannot fail to render. Both were checked on a real render at 393 px.
- **`test-skeeball-machine-spec.mjs`'s `holes.frozen` rule** tested `h.value >= 0`, which read as
  "has a numeric value" but also silently banned penalty baskets. It tests `Number.isFinite` now.
  `skeeball/MACHINE-SPEC.md` section 11 says so.

**Penalty balls are counted by nothing, on purpose.** `game.js`'s `result()` builds
`tens`/`twenties`/`thirties`/`forties` with `by(v)`, which matches EXACT values, so a -10 and a
-20 land in no counter. Those counters count points EARNED and are merged cross-device by
`js/players-agg.js`; folding a -20 into `twenties` would make a penalty read as a 20 in My Stats
and on the leaderboard. A machine that wants "penalties taken" gets its own additive counter and
item 7's three edits — do not overload these.

**This machine's 100s and 50 do not touch `sk.hundreds` / `sk.fifties` either.** `_settle` gates
those on `!this.board.cups`, and this is a cup board, so THE CLASSIC's five-100s goal stays
classic-only (Matt, 2026-08-22: machines are "completely distinct").

**`colorSweep` cannot fire here.** Every scoring cup is one orange and the penalty cups are one
asphalt, and `game.js` gates the sweep on `need > 1` scoring colours. A sweep of one colour is not
a sweep, and POPONGO's colours goal is safe from this machine.

## Objectives

In `skeeball/js/goals.js`. Matt replaced the first draft's "sink a 100" and "score 240 in a game"
on 2026-08-24, and **RAISED all three on 2026-08-25**, the day the machine was cleared to go live:
the first set was sized for a machine only he was playing.

| goal | label | target | reads |
|---|---|---|---|
| Every basket, three times | `g_baskets3` | all **9** slots landed **3 times each** | `sk.boards.brickcity.slotHits` |
| Perfect rounds | `g_perfect` | **3** finished rounds where every one of the nine balls scored | `sk.boards.brickcity.perfectRacks` |
| Net points | `g_net` | **30,000** (was 1,500) | `sk.boards.brickcity.points` |

**Every basket, three times.** *"you have to hit every basket 3 times."* It still counts the nine
SLOTS rather than the six point values (this face pays 100 twice, 40 twice and -20 twice, so
counting values would let a player skip three baskets), but a SET cannot count to three, so the
per-board record gained `slotHits` - counts, summed across devices. The `slots` set is untouched
and still written; HOT SHOT's own first objective reads it (THE LAW rule 5: an old key is never
repurposed). The rail says `Baskets x3` and its number is how many baskets are DONE, out of nine.

**A perfect round is no zeros and no negatives.** Matt's words: *"It means no 0s and no negatives.
You have to do that 3 times."* That is strictly harder than the clean round it replaces, which let
a ball miss the face entirely as long as it cost nothing. `game.js` reports `perfectRack` only when
all nine balls are spent and every one of them scored. `cleanRacks` is still counted and still
stored - nothing recorded stops being recorded - it is simply no longer what the objective reads.
Unlike `cleanRack`, `perfectRack` is NOT gated on the board having a penalty basket: nine for nine
is a true and hard statement on any machine.

**Net, because it goes down as well as up.** *"You gotta change the name of the total points one to
net total points or something since it goes up and down depending on the negative baskets."* The
number is the same per-board points total the other machines use; on this face a round contributes
what it FINISHED with after the penalties took their cut, so the label says so. Its own string key
(`g_net`), because the other machines' totals only ever climb. **Short on purpose, and measured
twice**: a rail box is `min(76px, 19vw)` and wraps; at completion (`30k/30k`) the wide bar has to
stay clear of both rails on a 375px phone. 30,000 is HOT SHOT's number, which Matt set here too.

**Tapping an objective says what it means** (2026-08-25). *"'perfect rounds' must be defined when
you click on the objective."* Every box that shows an objective carries `data-def` - both rails,
the wide total bar and the game-over tiles - and a tap opens a sheet with all three, the tapped one
lit, each with its progress and one plain sentence (`d_bc_*` in `strings.js`, EN and ES). Measured
at 375x667 and 393x852: the rail boxes are 71x67, the wide bar's hit area is 44px tall (the bar
itself stays 30px, because it is IN FLOW and every pixel of it costs the machine height), and the
rails end 193px above the top of `.sk-swipe`, so a tappable rail cannot eat a throw. Re-measure
those two rects if either the rails or the swipe surface move.

### The four counters these needed

All four are **per board** (`js/arcade-scores.js`'s board record), not the global `sk` block - they
answer questions about ONE machine's face, and a global counter would let another machine satisfy
them. All four are additive, and all four are absent-and-defaulted on any device that has not
played since:

- **`slots`** (2026-08-24) - a SET of the hole ids ever landed on this board. Unioned when a rack
  is recorded and unioned again across devices in `mergeBoards`, never intersected. Still written
  here; read by HOT SHOT's first objective, not by this machine's any more.
- **`cleanRacks`** (2026-08-24) - a counter of rounds that scored without touching a penalty
  basket. Still written; no objective reads it today.
- **`slotHits`** (2026-08-25) - HOW MANY TIMES each hole has been landed. Counts, SUMMED across
  devices where the set unions: a basket hit twice on the phone and once on the tablet has been hit
  three times. This is what "every basket x3" reads.
- **`perfectRacks`** (2026-08-25) - a counter of rounds where all nine balls scored. Summed.

`game.js`'s `result()` reports `slotsHit` and `slotCounts` (real holes only - the trough's `gutter`
and `corner0` are outcomes, not baskets, so no objective here can be completed by missing), plus
`cleanRack` and `perfectRack`. `test-stats-replay.mjs` scenario G covers the first pair and
scenario H the second: the union, the sums, that a board record written before either pair existed
loads with every number intact and no progress it did not earn, and that two hits on every basket
with two perfect rounds and 29,999 points completes nothing.

**POPONGO hangs off these three, so they have to be reachable.** Every one of the nine baskets is
capturable — that is what the build sweep asserts — so goal 1 is a matter of working across the
face rather than of luck. Goal 2 is the sharp one: the penalty row is the easiest thing on the face
to hit, by design. If either plays wrong once there are real racks behind it, **change it in
`goals.js` — do not resize a mouth**, which is what makes the face mean something. POPONGO can also
be opened for everyone from the in-app Admin page in the meantime.

## The corner 100s: a well-aimed ball goes in (2026-09-02)

Matt, with two screen recordings: a swipe that visually looks aimed at a corner 100 *"sometimes
scores, sometimes misses completely"*, and a degree of angle or a hair of power flips it. A first
fix capped `aimMax` to 0.12 rad (`a5ec37d`), which he rejected on sight: *"why would we move the
physical basket around instead of simply correcting that physics issue? ... Just fix that."* He
was right on both counts: the cap made a basket drawn 8.9 deg off the ball need a 20.8 deg swipe,
and it fixed nothing about what happened when the ball got there. **Neither the basket nor its
3.20 in mouth moved for this.** Every number below was measured with the real engine in node
(`simulateThrow` / `startThrow` + `step`, no browser).

### Where the basket is on screen is not where it is in the world

Projected through the play camera (render.js, eye (0, 0.50, 1.20), aimed at 20% up the face), the
corner 100 sits **8.9 deg** off the ball's own screen position (the 40 below it 11.3 deg, the -20
15.3 deg - perspective spreads the near rows). Its serve bearing is 6.3 deg, and the serve that
actually lands on its axis is **about 5.5 deg**: the lane's friction bleeds a serve's sideways skid
off in the first 40 cm (a 5 deg serve is rolling at 3 deg by z -0.2), then the 70-degree hump kicks
what is left, so the ball FLIES at ~8.4 deg. That flight angle is the "10-plus degrees" a swipe at
that basket looks like; the serve angle is an internal number.

`ui.js`'s swipe curve was `aim = raw^2`, `raw = swipe angle / 0.38` - forgiving near straight,
steep at the corners, and the corner 100 IS a corner. At the old `aimMax` 0.45 an 8.9 deg swipe
served at 4.3 deg (short) and 12 deg served at 7.8 deg (the side wall), so the whole window was
about two degrees of swipe with the sensitivity climbing the further out you aimed. **The curve is
per board now: `geom.aimCurve` is the exponent (unset = 2, every other machine byte-identical), and
this machine sets 1** - serve angle proportional to swipe angle - **with `aimMax` 0.235**, the
proportion (0.38 / 0.235 = 1.62) that puts an 8.9 deg swipe on a 5.5 deg serve. Measured end to
end (screen angle -> the ui.js curve -> the engine), the 100's hits form one contiguous band at
8.5-10.5 deg of swipe for powers 0.70-0.78, on the drawn basket, where before they were scattered
clumps at 12-13 deg.

### The engine threw well-aimed balls back out

The bigger half. Over the serve grid that reaches this basket (4.5-7.5 deg x power 0.62-0.92, 403
throws), **balls that arrived over the mouth scored 9 times in 36.** Stepped through at 5.5 deg /
power 0.70 the ball arrives 2 cm off the axis, dead centre, descending at 2.4 m/s - and
capture cannot see it: section 2's gate was `f.h < ballR * 1.9` (10.4 cm above the TREAD, THE
CLASSIC's number for flush holes a ball rolls over) and this rim stands 11.6 cm above its tread. So
the ball's underside grazes the rim's inner top EDGE, whose 45-degree contact normal turns the
descent into a 1.5 m/s kick across the mouth; the far edge turns that into 1.6 m/s straight UP; and
capture finally fires on the way out, as a rim-out. A 3.00 in ball into a 3.20 in rigid tube has
3.7 mm of clearance and no net - any off-axis entry meets an edge, and an edge meets it back.

Four rules in `machines/brickcity/physics.js`, this machine only:

| rule | what it does | the case it was measured on |
|---|---|---|
| **the gate is measured from the rim** (`st.maxLip`, and per hole `fh.h < lip + 1.9 ballR`) | a ball dropping toward a basket is seen while it is still above it | the 2 cm-off arrival above |
| **the net** (`cupBit`: each collar has its own collision group; a captured ball drops the one it was captured by) | capture already means "the floor is gone and gravity takes it through" - on a collar board the collar has to let go with the floor or the rule pays nothing. The other eight collars, the riser and the wall stay solid | same ball, which now drops straight through |
| **the lip-rest rule** (`rRest = r - 0.10 ballR`, speed < 0.6 m/s) | a ball resting on a rim with its centre over the opening falls in | a riser slide that sat on the inner edge 5.0 cm off the axis of a 5.8 cm mouth, was refused by the 4.3 cm crossing inset, teetered and rolled into the -10 |
| **a rim-out must be moving away from the face** | a captured ball still descending has not bounced out | forward momentum carried a captured centre 2 mm past the mouth radius toward the riser while still going down; the collar came back solid, kicked it 2.6 m/s up, and it rolled off the rim top in the crack against the riser |

After: **22 of 28 over-the-mouth arrivals score** (79%); 82 of the 403 throws are 100s (was 61). The
crossing inset (`rEff = r - 0.28 ballR`) and its kinematic test are THE CLASSIC's and unchanged, so
a ball never over the mouth is never captured and rattles the rim as it always did.

**Tried and rejected, so nobody tries them again:** rim restitution (`ringRest` 0.30 -> 0.05 on
every collar: 25% -> 28%; and `ring100Rest` is a dead knob on this machine, see physics.js's
material note), and the full rolling serve spin (`omega = (up x v) / R` instead of forward roll
only - the hump turned the sideways spin into a lateral kick and a 4.5 deg serve landed 6-11 cm
right of the axis instead of 1-2). The perspective ratio does differ by row (1.41 top, 1.59 middle,
1.89 bottom); one proportion cannot serve all three, and it is set for the row that has to be aimed.

`test-brickcity-corner100.mjs` pins all of it: 90 throws over the band, at least 70% of
over-the-mouth arrivals must score (born red at 25%), plus structural checks that the four rules
and the two aim numbers are still in the files.

## Spec waivers

Per `MACHINE-SPEC.md` section 20, keyed by rule id, in the board entry's `specWaivers`:

- **`ball.ratio`** — the ball is HOT SHOT's, which is THE CLASSIC's measured ball (0.375X, so
  0.75X across) against the spec sheet's 0.350X. This machine is HOT SHOT's sibling and shares its
  cabinet, ramp and ball. The spec sheet's ratio predates Matt's tape-measure pass of 2026-08-23.
- **`board.dims`** — HOT SHOT's staircase, carried over unchanged. `boardLen` is the UNROLLED
  length of three treads plus three risers (11.9625X), which necessarily exceeds the flat-board
  10.5X ceiling, and `boardTilt` is nominal because `steps` replaces the single tilted face.
- **`holes.uniform`** — mouth size IS the difficulty ladder on this machine, so the three rows are
  deliberately three sizes. A uniform face cannot express that ladder.

## Verification

Numbers below are from this machine's own engine. Re-run them after moving anything on the face —
reachability and the jam rate are properties of the WHOLE layout, not of one basket.

```bash
node skeeball/js/test.js --full        # the sweep and soak
node test-skeeball-machine-spec.mjs    # every MACHINE-SPEC rule, every board
node test-stats-replay.mjs             # scenario G: the chain move took nothing from anyone
node run-all-tests.mjs                 # everything
node test-visual.mjs skeeball          # the only suite that LOOKS at it
```

**The reachability sweep is NOT automatic for a new board** (MACHINE-SPEC section 19: the heavy
groups throw at `DEFAULT_BOARD` only). Sweep this machine by hand after moving anything on the
face — 41 powers x 21 aims of `simulateThrow` through `engineFor('brickcity')`.

The shipped sweep, 41 x 21 = 861 throws:

| | |
|---|---|
| all nine mouths clean-capturable | yes — lowL 54, lowC 65, lowR 57, midL 19, midC 14, midR 21, topL 3, topC 7, topR 3 |
| the penalty row really is the easiest thing to hit | 176 of 861 grid cells (20.4%) land in it |
| watchdog / emergency rate | **55 of 861 (6.39%)** |
| where all 55 are | corner-parked against riser 1, nearest rim 5.8 in away — **not one is in a basket, and not one is a collar wedge**. This is HOT SHOT's own failure mode, and HOT SHOT measures **13.36%** on the same grid (THE CLASSIC 0.00%, POPONGO 0.46%) |
| slowest settle | 5.74 s, under the 12 s cap |
| shared-file guard | the 41 x 21 grid AND a fixed nine-ball rack replayed on classic, basketball and popongo before and after every shared-file change: **all three byte-identical** |
| THE LAW rule 2 | `test-stats-replay.mjs` scenario G, against the real synced records of the only two devices holding POPONGO: both keep it |

The jam rate rose from 3.25% to 6.39% when the rows were swapped, and that is the trade being
made knowingly: big penalty baskets stop more balls short, and a ball stopped short on tread 1 has
more chances to park in the riser corner. It buys the ladder Matt asked for, and it is still less
than half the parent machine's rate. If it ever needs to come down, the lever is the **riser-1
corner**, which is HOT SHOT's geometry — not these mouths.

## The scuff had to be PALE, not dark (2026-09-03, third pass)

Matt, on the quiet version: *"I can't tell if you've added anything. If you did, now it's too
subtle. I don't see anything."*

Measured on the rendered frame, the back wall the mark lands on sits at **luminance 53-68 of 255** -
near-black cabinet above, dim scoreboard below. A BLACK smudge on that has almost nowhere to go:
at full opacity it could only take 53 down to 0, and with a soft edge it reached about 45. Eight
levels of change is not a mark, it is a rounding error.

So the scuff is pale (`rgba(214,203,186)`) and about two ball widths at a hard hit, which is also
what a real scuff on a dark painted panel is - dust and lifted paint, LIGHTER than the thing it is
on.

| | dark version | pale version |
|---|---|---|
| peak change against the wall | ~50 levels | **90 levels** |
| footprint over 4 levels | 190-400 px | **1900-2700 px** |
| size | 11.5-17 cm | 17.5-25 cm |

Everything else is unchanged: it still lies IN the wall (no billboard), still the back wall only,
still the first contact of a throw only, still two seconds.
