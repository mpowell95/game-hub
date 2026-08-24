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
on 2026-08-24 — these three are about the FACE, not about a number.

| goal | label | target | reads |
|---|---|---|---|
| Every basket | `g_baskets` | all **9** slots landed, at least once each | `sk.boards.brickcity.slots` |
| Clean round | `g_clean` | **1** finished round that scores and takes no penalty | `sk.boards.brickcity.cleanRacks` |
| Net points | `g_net` | **1,500** | `sk.boards.brickcity.points` |

**Every basket, not every point value.** *"they must hit every basket, not just every point
value."* This face pays 100 twice, 40 twice and -20 twice, so counting VALUES would let a player
skip three baskets and still finish. It counts the nine SLOTS. Spread over as many racks as it
takes — nine balls into nine different baskets in one rack is a lottery, not a goal — which is why
it reads a union rather than anything per-rack.

**A clean round means it scored.** *"must score points tho - can't just throw away all 9 balls, get
0s, and pass this objective."* `game.js` requires all nine balls spent, `score > 0`, and not one
ball in a negative basket. It also gates the whole thing on the board actually HAVING a penalty
basket — on a machine where nothing can cost you points every scoring rack would trivially be
"clean", and a flag every machine sets means nothing on the one machine that asks.

**Net, because it goes down as well as up.** *"You gotta change the name of the total points one to
net total points or something since it goes up and down depending on the negative baskets."* The
number is the same per-board points total the other machines use; on this face a rack contributes
what it FINISHED with after the penalties took their cut, so the label says so. Its own string key
(`g_net`), because the other three machines' totals only ever climb and "Total points" is still
true there. **Short on purpose, and it was measured twice.** It began short because a rail box is
`min(76px, 19vw)` and wraps to two lines. When the total moved to the wide bar above the machine
that reason expired, so "Net total points" was tried — and at completion (`1.5k/1.5k ✓`) it
measures 241px against the ~216px between the two rails on a 375px phone, overlapping both. In
Spanish it is worse. So the short name stays, for a new reason.

### The two counters these needed

Both are **per board** (`js/arcade-scores.js`'s board record), not the global `sk` block — they
answer questions about ONE machine's face, and a global counter would let another machine satisfy
them. Both are additive, and both are absent-and-defaulted on any device that has not played since:

- **`slots`** — a SET of the hole ids ever landed on this board. Unioned when a rack is recorded
  and unioned again across devices in `mergeBoards`, never intersected: a basket hit on a phone
  and a different one hit on a tablet are two baskets hit, not zero.
- **`cleanRacks`** — a counter, so it only climbs. Summed across devices.

`game.js`'s `result()` reports `slotsHit` (real holes only — the trough's `gutter` and `corner0`
are outcomes, not baskets, so "hit every basket" can never be completed by missing) and
`cleanRack`. `test-stats-replay.mjs` scenario G covers the union, the sum, and that a board record
written before these existed loads with every number intact and no progress it did not earn.

**POPONGO hangs off these three, so they have to be reachable.** Every one of the nine baskets is
capturable — that is what the build sweep asserts — so goal 1 is a matter of working across the
face rather than of luck. Goal 2 is the sharp one: the penalty row is the easiest thing on the face
to hit, by design. If either plays wrong once there are real racks behind it, **change it in
`goals.js` — do not resize a mouth**, which is what makes the face mean something. POPONGO can also
be opened for everyone from the in-app Admin page in the meantime.

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
