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
   row 3   v 9.2875X     100    50    100      <- the skill row: tightest mouth-to-ball in the game
   row 2   v 5.3X         40    20     40      <- HOT SHOT's row, kept at his ask
   row 1   v 1.3125X     -20   -10    -20      <- the penalty row, nearest the player
```

**Size and value move together: the deeper into the machine a basket sits, the smaller its mouth
and the more it pays** — except row 2, which is HOT SHOT's row kept as-is and is therefore the
widest thing on the face. That is deliberate and it is what makes the penalty row survivable: the
40s are the reliable shot, so there is always something safe to aim at.

### Every dimension, three ways

`X` is the board's unit (the nominal hole diameter): **X = 4.00 in = 0.145455 m**, from
`boardW` 1.00 m = 6.875X = 27.5 in. `r` is the MOUTH RADIUS, so a mouth is `2r` across. A collar's
OUTER diameter is its mouth plus two `collarThick` (0.012 m = 0.0825X = 0.33 in).

| | X | inches | metres |
|---|---|---|---|
| **Ball** (HOT SHOT's, which is THE CLASSIC's) | 0.75X across (`ballR` X\*0.375) | 3.00 | 0.10909 |
| **Row 1 mouth** (-20 / -10 / -20) | 0.97X (`r` X\*0.485) | 3.88 | 0.09891 |
| Row 1 outer | 1.135X | 4.54 | 0.11527 |
| Row 1 depth (`collarH`) | 0.97X | 3.88 | 0.09891 |
| **Row 2 mouth** (40 / 20 / 40) | 1.5X (`r` X\*0.75) | 6.00 | 0.21818 |
| Row 2 outer | 1.665X | 6.66 | 0.24218 |
| Row 2 depth | 1.0X | 4.00 | 0.14545 |
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

### Why row 1 is 0.97X and not the 1.085X it was first drawn at

**This is the one number that changed from the brief, and it changed because it was measured.**

Row 1 was specified as a 1.085X (4.34 in) mouth, 1.25X (5.00 in) outer, on the reasoning that
5.00 in outer collars at ±8.28 in leave 3.28 in between adjacent baskets, so a 3.00 in ball can
still fall BETWEEN two penalty baskets and take a plain 0 instead of a -20. That reasoning is
right and it is preserved. What it missed is the OTHER gap: the same collars leave only **2.97 in
between the outer basket and the side rail**, against a 3.00 in ball.

`boards.js`'s own spacing rule, learned twice and written down after POPONGO's build, says a gap
is **either MERGED or wider than a ball plus margin, and an in-between gap is a pocket** — and
2.97 in against a 3.00 in ball is the worst value available. The ball gets far enough into the
channel to touch the collar wall and the rail at once, the tread makes a third contact, and three
contact normals lock the cannon solver completely. The watchdog walks it out as a zero.

Measured on the full 41x21 grid (861 throws) through this machine's own engine, at the briefed
1.085X:

- **111 of 861 throws (12.89%) ended in the watchdog.**
- **83 of those 111 were the same wedge**: ball centre at u = ±12.25 in — which is exactly the
  rail, at ball radius — resting on the tread at row 1's height, 1.89 in outside the nearest
  collar's rim.
- **Not one jam was inside a basket.** Depth was never the problem, and a variant with every
  collar at two thirds of its mouth (HOT SHOT's real proportion) still measured 8.66%. That is
  why this machine keeps the as-deep-as-it-is-wide collars it was drawn with.

The fix keeps the columns where Matt put them and shrinks the mouth instead:

| | mouth | outer | rail channel | gap between adjacent baskets | jams (41x21) |
|---|---|---|---|---|---|
| as first drawn | 4.34 in | 5.00 in | **2.97 in** (ball cannot pass, ball CAN wedge) | 3.28 in | 111 (12.89%) |
| **shipped** | **3.88 in** | **4.54 in** | **3.20 in** (ball passes) | **3.74 in** | **28 (3.25%)** |
| measured alternative | 4.34 in | 5.00 in | 3.13 in | 3.12 in | 28 (3.25%) |

**The measured alternative was real and was not taken.** Leaving the mouth at 4.34 in and moving
row 1's columns in to ±2.03125X opens both gaps just past the ball and measures the SAME 3.25%,
with a livelier penalty row (77 of 861 grid cells catch a penalty against 53). It was rejected
because the columns are one of the things this machine copies from HOT SHOT unchanged — all three
rows line up in the same three columns, and row 1's size is the number that has to absorb the gap
arithmetic. If a future session wants the penalty row to bite harder, that variant is the measured
way to do it, and it costs the column alignment.

**For scale, HOT SHOT measures 13.36% on this same grid** — untouched, on `main`, the day this was
built. THE CLASSIC measures 0.00% and POPONGO 0.46%, so the jam rate is a property of the
STAIRCASE: three treads, three risers and two side rails make far more two-and-three-contact
corners than a single tilted face does.

The two kinds are distinguishable, and it is worth knowing which is which:

- **Corner-parking** — the ball comes to rest in the corner where a tread meets a side rail,
  nowhere near a collar (its nearest rim is 5.8 in away). This is HOT SHOT's, at all three rows:
  40 of its 115. It is what this machine's residual 28 are too, and chasing it means changing the
  row Matt asked to keep.
- **Collar-wedging** — the ball is held between a collar's outer wall and the rail at once, 1.9 in
  from the rim. **This one was BRICK CITY's own, and it is gone.** It was 83 of the original 111,
  and there are zero of them now.

So this face added a second failure mode on top of the inherited one, and closing it leaves the
machine running four times cleaner than its own parent.

Both routes to a plain 0 are now genuinely open, which is more than the original had: a ball can
pass down the side of the row AND between two baskets. The clear tread strip in front of the row,
the risers and the trough are still the other routes.

Row 1 is still the largest mouth after HOT SHOT's kept middle row (3.88 in vs the 50's 3.50 in and
the 100s' 3.20 in), so the ladder still reads correctly on the face.

**Do not resize row 1 without redoing all four numbers in that table**, and re-run the sweep after:
widening the mouth closes the rail channel back into the wedge, and moving the columns inward to
open the rail channel closes the centre gap into the same wedge. At this mouth and these columns
all four gaps clear the ball. There is not much room either way — the arithmetic is three collars
plus four gaps across 27.5 in.

## The marquee

Painted onto the marquee panel by `_paintMarquee()` in `skeeball/js/machines/brickcity/render.js`,
the same way `_paintField` and `_paintLane` paint the board and the lane, with `SRGBColorSpace`
declared (without it the sRGB hex is handed to the shader as linear albedo, the brick goes pink
and the chalk plate goes grey). 1024 x 252 canvas, 4.06:1, matching the panel mesh.

Top to bottom: a brick panel fading `#A33427` to `#6E2018`, with mortar drawn as courses 26 px
apart and verticals 58 px apart, every other course offset half a brick; a bulb bar across the top
AND bottom edge; **HOT SHOT** large and centred in `#FFC53D` over an `#FF6B2C` ember glow (a hard
`#6E2018` drop shadow, then two ember halo passes, then the letters); and below it a **BRICK CITY**
plate — `#14161B` fill, 3 px `#EDE6DA` border, chalk lettering, with a ball-through-a-rim glyph at
its left (orange ball, chalk rim and net). No tagline, no extra copy: those two names are the
entire sign. The plate is dark because brick red under a yellow bulb bar is a low-contrast pair,
and BRICK CITY needs somewhere to sit that does not compete with the glow above it.

**Every letter is a path, not a font.** The design sets both names in Bungee. A webfont is not
something this game may fetch (no build step, must work offline, and a font that has not loaded
yet paints the sign in whatever the browser falls back to), so `_signWord` / `_signGlyph` draw a
heavy condensed alphabet out of lines and curves. Only the ten letters these two names need exist
(B C H I K O R S T Y); a letter with no glyph draws nothing rather than a tofu box.

The three numbers that make it read as condensed signage, and that have to agree in `_signWidth`,
`_signWord` and the two callers: **advance 0.64 of cap height, tracking 0.12, stem 0.21.** Those
came off a look, not a preference (`VISUAL-PROCESS.md`): at the first weight (advance 0.60, stem
0.235) the B and the S closed their counters into a blob at display size, and the first S — built
out of squared `arcTo` corners — read as a **5**. The S is two bezier S-curves now, and B and R
share one `bowl` helper whose control points sit past the box edge so the bowl is as full as the
letter instead of a timid bulge.

**Sizes on the 1024 x 252 canvas:** HOT SHOT at cap 74 from y 30; the plate 86 tall from y 128,
carrying BRICK CITY at cap 46 with a 62 px glyph. HOT SHOT was 88 and the plate 74/38 in the first
pass, and it was corrected after looking at the real 3D scene at 393 px: at that balance the plate
was a dark bar with unreadable text at play distance. Matt's standing instruction on exactly this
is to **fix the sign, not the camera** — so HOT SHOT gave up the size and the plate took it. If the
plate ever stops reading again, that is the trade to make again.

**No chase animation.** The design offers one and calls it a suggestion. These bulbs are painted
INTO the texture, so a chase would mean repainting a 1024 x 252 canvas and re-uploading it every
frame for something the player sees at the top of the screen while watching a ball. The seven real
bulb MESHES above the panel already flash on `celebrate()`, which is where the movement belongs.
If a chase is ever wanted it goes on those meshes, and `REDUCED` at the top of `render.js` is the
`prefers-reduced-motion` gate it needs.

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

In `skeeball/js/goals.js`, all three derived from records this machine already keeps — no new
counters, so nothing new to sync, merge or test under item 7's three-edit rule.

| goal | target | reads |
|---|---|---|
| Sink a 100 | `bestThrow >= 100` | `sk.boards.brickcity.bestThrow` |
| Single game | `best >= 240` | `sk.boards.brickcity.best` |
| Total points | `points >= 2000` | `sk.boards.brickcity.points` |

Tuned to THIS face and deliberately not HOT SHOT's numbers (100 / 300 / 3,000): this machine pays
two 100s instead of one but through 3.20 in mouths, its reliable row pays 40 where HOT SHOT's pays
60, and its bottom row takes points back — so the same effort produces a lower number here, and
both bars drop to match.

What the grid says a rack is worth, which is where those two numbers come from:

- a rack thrown UNIFORMLY across the dial scores about **51**;
- **11.8%** of the dial pays 40, so a player who finds that band every ball scores **360**;
- two thirds of the balls in the 40 band and the rest in the 20 is **300**;
- **240** is six 40s, which is a good rack and not a perfect one.

**POPONGO hangs off these three, so they have to be reachable — and the 100 is the one to watch.**
It is **6 of 861 grid cells here against HOT SHOT's 26**, roughly four times harder to find on the
dial, and it is the only one of the three that could stall someone. It is genuinely capturable
(clean captures at p0.675-0.75 with a little aim) and there are two of them, so it is a shot to
learn rather than a wall. If it plays too hard once there are real racks behind it, **soften
`BC_HOOP` in `skeeball/js/goals.js` — do not widen the mouth**, which is the thing that makes the
shot worth anything. POPONGO can also be opened for everyone from the in-app Admin page in the
meantime, with no commit and no deploy.

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

The build sweep, 41 x 21 = 861 throws:

| | |
|---|---|
| all nine mouths clean-capturable | yes — lowL 15, lowC 20, lowR 18, midL 52, midC 37, midR 50, topL 3, topC 7, topR 3 |
| watchdog / emergency rate | **28 of 861 (3.25%)**, down from 111 (12.89%) as first drawn |
| where the residue is | all 28 in the MIDDLE row region, 19 of them wedged against a side rail — HOT SHOT's own geometry, which measures 13.36% on the same grid |
| slowest settle | 6.62 s, under the 12 s cap |
| shared-file guard | the 41 x 21 grid AND a fixed nine-ball rack replayed on classic, basketball and popongo before and after every shared-file change in this build: **all three byte-identical** |
| THE LAW rule 2 | `test-stats-replay.mjs` scenario G, against the real synced records of the only two devices holding POPONGO: both keep it |
