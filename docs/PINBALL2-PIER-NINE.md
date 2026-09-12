# PIER NINE — playfield blueprint and build sequence

**Status: designed, approved by nobody yet. No code written.** Written 2026-09-12 from Matt's brief:
*"take the boardwalk tuning too. make it a better, more organized pinball machine... write a plan
for how you would design a playable, fun, competitive, pinball board."*

The visual blueprint (to-scale plan drawing, keyed schedules) is the companion to this file. This
file is the buildable text. Where they disagree, this one wins and the drawing gets fixed.

**`docs/PINBALL2-PIER-NINE-ART.md` is the third piece and it is not optional.** This file says where
every part sits and what it scores; that one says what it LOOKS like - the palette, the state
language, and a rendering of the table lit, in the same coordinates. Section 4a below is the summary
of it; the art file is the source.

---

## 0. The finding that shapes everything

**BOARDWALK is not a pinball machine with problems. It is a physics sandbox with no game in it.**

44 parts: 18 segs, 10 posts, 5 arcs, 4 bumpers, 2 slings, 2 ramps, 2 flippers, 1 drain. There is no
score, no target, no lamp, no lock, no mode and no rule anywhere in `pinball2/`. **The engine has
eight shape kinds and not one of them can award a point**, so no amount of moving rails around makes
it a better pinball machine. Seven of the eight build phases below are engine work; the table is one
of them.

**BOARDWALK is not deleted, replaced or rewritten.** It stays as a built-in with its three red
probes. It is the physics test bed and it is good at that. PIER NINE is a new table beside it — the
same call this project already made about the old `pinball/` game.

---

## 1. Theme

**PIER NINE** — a seaside pier at night. It keeps BOARDWALK's world (which is already the hub's
arcade register) and gives every mechanism a thing it actually is:

| Mechanism | Is |
|---|---|
| centre saucer / ball lock | the **Ferris Wheel** |
| left wireform ramp | the **Coaster** |
| right wireform ramp | the **Pier** |
| pop bumper nest | the **Arcade** |
| drop target bank | the **Fishing Dock** |
| spinner | the **Lighthouse** |
| top rollover lanes | **P·I·E·R** |
| standup targets | **Ring Toss** |
| second saucer / mode start | the **Fortune Teller** |
| left-wall standups | the **Boathouse** |
| mystery standup | the **Ticket Booth** |
| right-orbit standups | the **Bait Shop** |

---

## 2. Playfield geometry

Standard Williams body. Everything in **millimetres**, origin top-left, **y positive DOWN the
playfield toward the drain** — the same frame `table.js` uses.

```
field            515 x 1067
usable playfield 409 wide (x 28 .. 437), once the shooter lane is taken out
tilt             6.5 deg, gravity 1.111 m/s2   (unchanged, config-level)
ball             27 mm diameter
```

### Fixed structure

| Part | Geometry |
|---|---|
| left rail | (22, 150) → (22, 806), r 6 |
| top-left corner | arc centre (134, 150) r 112, 180°→270° |
| top rail | (134, 38) → (381, 38) |
| top-right corner | arc centre (381, 150) r 112, 270°→360° |
| right rail | (493, 150) → (493, 1000) |
| shooter lane wall | (443, 218) → (443, 1000) — **34 mm clear lane** |
| drain | x 28, y 1000, w 409, h 60 |

**The lane must be 34 mm clear, not 30.** The gap rule bans any clearance between 20.3 and 31.1 mm,
so a 30 mm lane is illegal by construction — it is exactly the width a ball wedges in.

### Lower third

| Part | Geometry |
|---|---|
| left flipper | pivot (142, 905), len 76, rest −28°, end +32° |
| right flipper | pivot (323, 905), len 76, mirrored |
| tip gap | **47 mm** at rest — 1.7 balls, a real drain gap |
| left sling | (96, 812) → (136, 888) |
| right sling | (369, 812) → (329, 888) |
| left inlane guide | (74, 706) → (110, 902) |
| right inlane guide | (394, 706) → (358, 902) |
| outlanes | 30 mm clear |
| inlanes | 32 mm clear |
| kickback | left outlane, (46, 968), fires up-lane at 3.2 m/s |

### Features

| Key | Feature | Geometry |
|---|---|---|
| 3 | Ferris Wheel saucer | centre (232, 470), r 23. Ejects 2.4 m/s toward the left flipper |
| A | Arcade — 3 pop bumpers | (168, 272), (232, 222), (296, 272), r 25. **33 mm clear between them** so a ball can thread the nest |
| B | P·I·E·R — 4 rollover lanes | posts at x 131/186/241/296/351, y 96→150. Lane clear 38 mm |
| C | Lighthouse spinner | across the left orbit at (59, 430), span 38 mm |
| D | Ring Toss — 2 ring standups | (392, 496)–(392, 528) and (392, 566)–(392, 598), a **38 mm gap** between them, facing the left flipper |
| D | Ring Toss bullseye | recessed peg at (414, 547), r 12, behind the gap |
| H | Coaster diverter | flap pivoted at (330, 268), two positions |
| J | One-way gate | (100, 146) → (142, 122), at the top of the left orbit |
| 5 | Fishing Dock — 3 drop targets | (100,626)→(128,613), (136,609)→(164,596), (172,592)→(200,579). Angled at the right flipper |
| 2 | Coaster ramp | mouth (196, 742); crest **z = 62 mm** over the centre; exits left inlane (120, 838) at z 0 |
| 4 | Pier ramp | mouth (300, 716); **crest (360, 470)**, z = 55 mm; exits right inlane (368, 838) at z 0. *Crest moved inboard from (404, 470) on 2026-09-12: it passed directly over the Ring Toss plate and buried it. Found by drawing the table, not by a probe* |

### Rev C — density (2026-09-12)

Rev B could be touched in about 22 places. Everything below is an engine kind rev B already
commits to building, so **rev C adds zero new engine kinds**. Coordinates are provisional in the
same sense as everything above: placed to intent, cleared by hand against the 20.3–31.1 mm wedge
band, and `checkGaps` is still the authority.

#### Rubber posts — 14, r 6, rubber ring, **10 pts** (not derived: activity, same class as slings)

| Pair | Posts | Purpose |
|---|---|---|
| Coaster mouth | (164, 752) · (228, 748) | 52 mm gate on a 40 mm mouth; a near-miss kicks live instead of rolling home |
| Pier mouth | (270, 726) · (330, 722) | 48 mm gate on a 40 mm mouth, same job |
| Fishing Dock caps | (96, 644) · (210, 570) | welded to the bank's ends (12.4 / 7.5 mm — shut, not ambiguous); protects the corners |
| Sling tops | (88, 798) · (372, 790) | the classic sling-post cluster; both shut against their sling (10.1 / 16.2 mm) |
| Ferris Wheel entry | (206, 494) · (258, 494) | a 40 mm gate into the lock saucer, each post shut against the r 23 rim |
| Left dead band | (132, 432) · (124, 690) | the two ends of the strip the spinner and the Coaster mouth used to bracket with nothing between |
| Lower centre | (244, 796) · (292, 788) | kills the bare rectangle between the ramp mouths and the slings |

#### Targets on the empty walls

| Key | Part | Geometry |
|---|---|---|
| K | **Boathouse** — 2 standups | (78, 452)→(98, 477) and (86, 483)→(106, 508), welded to the left orbit's inner guide, angled at the right flipper. 13.4 mm between them: shut, deliberately |
| L | **Ticket Booth** — 1 standup | (250, 548)→(280, 552), facing the left flipper, clear of the wheel's eject path (57 mm) |
| M | **Bait Shop** — 2 standups | (404, 274)→(404, 306) and (404, 316)→(404, 348), flush with the right orbit's inner guide, clipped by a ball running the lane |

#### A second hole and a second spinner

| Key | Part | Geometry |
|---|---|---|
| N | **Fortune Teller** scoop | centre (100, 570), r 23, mouth 44 mm facing the left flipper, welded to the left orbit's inner guide. Ejects 2.4 m/s at the left flipper. Same kind and same 2 s watchdog as the wheel |
| P | **Coaster spinner** | across the Coaster mouth at (196, 742), span 38 mm. 250/rev, same kind as the Lighthouse |
| Q | **Ball-save eject** | (232, 992), fires up the centre at 3.4 m/s while armed. Kickback class, second instance |

**Two of the directive's own coordinates were unusable and moved**, both for the same reason — they
sat inside the left orbit's 40..78 mm lane, which is a shot, not a wall:

- Boathouse, given as the left rail face (34, 560)–(34, 640) → welded to the orbit's INNER guide at
  x 78..106. The rail face is the far side of a live lane; a target there is in the ball's path
  on every orbit.
- Fortune Teller, given as (58, 660) → (100, 570). At (58, 660) an r 23 scoop fills the orbit lane
  completely. **It then moved a second time, from (146, 530), because DRAWING it found the Coaster
  ramp passing over it** — the ramp's left edge is x 161 at that y against the scoop's right edge at
  169, an 8 mm overlap. That is the same failure as the Pier crest over the Ring Toss plate, on the
  other side of the table, and again a probe would not have caught it because both parts were legal
  on their own. **Three of the four errors in this design have been found by drawing it.**

**The Bait Shop is inside the x 380..437 band the directive bans, on purpose.** That ban exists
because three parts already share that width — but they share it at **y 484..610** (Ring Toss
plate, Pier crest, shooter wall). The Bait Shop sits at **y 274..348**, where the band holds only
the orbit lane and its guide, and "gives the right orbit a partial-credit outcome" cannot be
satisfied anywhere else. Clearances at that y: guide face x 404 to shooter-lane wall inner face
x 437 = 33 mm — the orbit's own lane, unchanged. Reported rather than quietly taken.

**The left wall is the new suspect band** and gets the treatment the right side got. The spinner,
the Boathouse, both left-band posts and the Fortune Teller now share **x 28..160, y 430..742**.
Placing them moved four coordinates off their first values to stay out of the wedge band; the
worst near-misses were the Fortune Teller against the left Ferris post at 25.9 mm and the same
scoop under the Coaster ramp at an 8 mm overlap — one caught by arithmetic, one only by drawing. Draw it before building it.

**The right-side stack is the one place to check clearances first.** The Ring Toss plate (out to
x 426), the right orbit lane (34 mm clear) and the shooter-lane wall (inner face x 437) share about
60 mm of width. The intent is that the ring targets are welded to the orbit's inner guide - a
deliberate overlap, which is how you SHUT a gap. **Two errors have already been found in this
60 mm band**: the bullseye at x 426 sat inside the shooter-lane wall, and the Pier ramp's crest at
(404, 470) passed directly over the Ring Toss plate. Both were caught by drawing, not by a probe.
Treat this band as suspect until `checkGaps` has passed it.

**Both ramps must obey the four ramp rules already enforced by `rampProbe`**: both ends at z=0, no
kink over 20° per junction, no level run, and entry decided by a CROSSING rather than a window.

---

## 3. The six major shots

Six, not ten, and that is a hard call driven by measurement: this table renders **306 px wide** on a
phone at the closed sheet detent, so a seventh shot is a 20-pixel target nobody can aim at. A
captive-ball lane and an upper flipper were both designed and then cut for the same reason.

| # | Shot | From | Returns to | Base |
|---|---|---|---|---|
| 1 | Left orbit (past the spinner, through the one-way gate) | right flipper | right inlane | 3,000 |
| 2 | The Coaster | right flipper | **whatever the diverter is set to** | 500 |
| 3 | Ferris Wheel (the 3-car lock) | either | left flipper | 3,000 |
| 4 | The Pier | left flipper | **right inlane** | 1,000 |
| 5 | Fishing Dock bank | right flipper | live rebound | 500 ea / 1,000 bank |
| 6 | Right orbit | left flipper | pop bumpers | 3,000 |
| D | Ring Toss standup / **bullseye** | left flipper | rebound | 4,000 / **6,000** |

**Shots 2 and 4 are the flow.** Each returns to the OPPOSITE flipper, so the two ramps together
make a figure-eight you can ride forever. That falls out of where the ramps exit; it costs nothing.

## 3a. The four mechanisms that make a shot mean different things

Matt's rev-A note: *"every shot scores the same way regardless of what mode is active, what's been
hit before, or how many times it's been hit."* Correct, and it was the real weakness. Four
mechanisms fix it, chosen because each is cheap in this engine and each changes what an EXISTING
shot does rather than adding another static target.

| Mechanism | States | What it gates |
|---|---|---|
| **Coaster diverter** (H) | left inlane *(default)* · wheel feed · lock feed | One physical shot, three destinations. Mode lit → the ramp starts the mode. Two balls locked → the ramp feeds the third lock. Otherwise → safe return and a combo. **The highest-value single addition**: the Coaster is the easiest shot on the table and now it is also the most context-dependent one. |
| **Ferris Wheel** (3) | 0 / 1 / 2 / 3 balls | A queue, not a one-shot saucer. Rotates 120° per lock with the ball VISIBLE in its car, so lock progress is a thing you can see on the playfield instead of a number on a backglass. Third lock spins the wheel and releases all three. |
| **Ring Toss bullseye** (D) | standup hit · gap threaded | Two ring standups with a 38 mm gap; thread the gap to the peg behind. 4,000 against 6,000, and the bullseye also steps the mode ladder. Precision, not hit/miss. |
| **One-way gate** (J) | open up · shut back | Top of the left orbit. A completed orbit cannot un-complete, and the pop nest cannot spit a ball back DOWN the orbit lane into the left outlane. |

**The diverter must fail safe.** Any fault, any unknown state, any mid-animation drain: it returns
to the left-inlane position. A diverter stuck on the lock feed with no lock available is a ball with
nowhere to go, which is the one failure this engine's whole thesis forbids.

## 3b. The small game (rev C)

The four mechanisms above all gate MAJOR shots. Nothing gated the small stuff, which is why a miss
on rev B was a silent roll back to the flipper. These are rules only — **zero new geometry beyond
§2's rev C block**.

| Rule | What it does |
|---|---|
| **Hurry-up** | Clearing the Fishing Dock bank starts a 15 s countdown from **25,000**, collected at the Fortune Teller scoop. Provisional, robot-tunable |
| **Timed ball save** | 8 s from plunge, the ball-save eject (Q) fires. Standard on every real machine since the 90s and absent from rev B |
| **Lane change** | Either flipper button rotates which P·I·E·R lamp is lit. Costs nothing and adds the classic top-lane skill layer |
| **Outlane trade** | Completing the Boathouse lights ONE outlane for **Last Cast** — big points for draining there. Lit state is shape + motion, never hue |
| **Rattle** | Any two rubber-post hits inside 1 s scores **100** and chases the marquee bulbs. Pure flavour; it teaches that the ball is alive |

**Two holes, two jobs.** The Ferris Wheel is now purely the LOCK hole and the Fortune Teller is the
MODE-START hole (and the mystery collect, and the hurry-up collect). That is a cleaner rule than
rev B's one saucer doing both, and it is the reason the second hole earns its place rather than
just being a second hole.

**The Ticket Booth is the mystery award**, cycling a visible 3-position prize wheel: points / light
lock / light mode. The state is drawn as a pointer, per the art rules — never as text.

## 4. Scoring, derived

Matt's rev-A note: *"Point values feel arbitrary... show the math, don't just assign numbers."* They
were arbitrary. They are computed now, and the computation reordered them - the ramps came out
CHEAP and the precision shot came out most valuable, which is the opposite of the first draft.

```
base = 1000 x D x R x (8 / W)      rounded to the nearest 500, floor 500

D   distance   flipper tip -> target, divided by 300 mm
R   risk       miss returns to a flipper 1.0 | down the middle 1.4 | to an outlane 1.8
W   aperture   degrees the entry subtends from that flipper tip
```

300 mm and 8 degrees are the two reference constants: a mid-length shot at a typical ramp-mouth
width scores `1000 x R`. Distances are measured from the flipper TIP at rest - left (209, 941),
right (256, 941) - because that is where the ball leaves the bat.

| Shot | Dist | D | W | R | Raw | Base |
|---|---|---|---|---|---|---|
| Ring Toss bullseye | 434 | 1.45 | 3.4° | 1.8 | 6,065 | **6,000** |
| Ring Toss standup | 442 | 1.47 | 4.1° | 1.4 | 3,985 | **4,000** |
| Ferris Wheel | 472 | 1.57 | 5.6° | 1.4 | 3,152 | **3,000** |
| Left orbit | 349 | 1.16 | 5.6° | 1.8 | 2,998 | **3,000** |
| Right orbit | 345 | 1.15 | 5.6° | 1.8 | 2,943 | **3,000** |
| Fishing Dock bank | 355 | 1.18 | 15.4° | 1.4 | 861 | **1,000** |
| The Pier | 243 | 0.81 | 9.4° | 1.4 | 962 | **1,000** |
| The Coaster | 208 | 0.69 | 11.0° | 1.4 | 706 | **500** |
| Boathouse standup *(C)* | 489 | 1.63 | 3.7° | 1.4 | 4,877 | **5,000** |
| Ticket Booth *(C)* | 395 | 1.32 | 4.3° | 1.4 | 3,390 | **3,500** |
| Fortune Teller scoop *(C)* | 387 | 1.29 | 6.5° | 1.4 | 2,217 | **2,000** |

The generator is **`docs/pier-nine-values.mjs`**; re-derive rather than hand-edit if any coordinate
moves. Every rev C value above came out of it after placement, not before.

**The Boathouse came out at 5,000, well above the 2,500–3,500 the rev C directive expected.** It is not
adjusted to fit. It is a 489 mm cross-table shot at a 32 mm target — the second-longest on the
table and the second-narrowest aperture — so the formula is right and the expectation was the
guess. If 5,000 plays too rich it is the PLACEMENT that should move, not the number — and note that it
already moved once, from y 470 up to y 452, when the Fortune Teller needed the room: the value went
4,500 → 5,000 with it, which is the derivation working.

**The Bait Shop is NOT derived, and this is where the formula meets its edge.** Derived straight it
returns **8,500** — the highest value on the table, for a partial-credit consolation on a shot
worth 3,000. The cause is the `D` term: it assumes free flight and charges a guided shot for every
millimetre the lane carries it, which is wrong for a target sitting *inside* the right orbit. The
ball is not aimed at the Bait Shop; it is aimed at the orbit mouth, and the lane does the rest.
So the Bait Shop is valued as a **fraction of the shot it partially completes: 1,000 each, 2,000
for both** — deliberately below the 3,000 for actually finishing the orbit, because partial credit
that beats full credit is a scoring bug. **General rule this exposes: the formula applies to a
target a flipper can aim at. A target inside a guided lane inherits its lane's difficulty.**

**A cheap shot is not a bad shot.** The Coaster is worth 500 because it is close and wide, and that
is the honest difficulty. It earns over a game through REPETITION - the combo chain and the mode
multiplier are multipliers ON the base, and the Coaster is the one shot you can hit five times in a
row. The bullseye is worth twelve times as much and you will hit it twice a game.

| Multiplier | Condition | Coaster (500) | Bullseye (6,000) |
|---|---|---|---|
| Combo x2 … x5 | 2nd-5th major inside 3 s | 1,000 … 2,500 | 12,000 … 30,000 |
| Mode x10 → x20 → x40 | the lit shot during its mode | 5,000 … 20,000 | 60,000 … 240,000 |

**Four groups of values are deliberately NOT derived**, and each has a stated reason:

- **Pops 100, slings 50, inlanes 250, both spinners 250/rev, rubber posts 10, Rattle 100.**
  Nothing here is aimed at. They are activity, not shots, so shot difficulty does not apply to
  them. The Coaster spinner shares the Lighthouse's rate for the same reason: a spinner's value is
  per revolution, and how hard it was ripped is already the multiplier.
- **Jackpot 25,000, super jackpot 100,000.** The difficulty in multiball is keeping three balls
  alive, not the shot. Flat, so that no ramp is the "wrong" jackpot to go for.
- **Locks 5,000 / 10,000 / 15,000.** Escalating with the tension rather than with the geometry: it
  is the same shot three times, and the third one is the one you can lose.

### Modes

Each Fishing Dock clear OR bullseye lights the wheel for one mode. One at a time, timed, no
stacking. Awards are stated as a multiple of the shot's own base, so the derivation carries through.

| Mode | Runs | Lit shots | Award |
|---|---|---|---|
| Ring Toss | 30 s | standups + bullseye | base x10, +x10 each |
| Coaster Run | 45 s | ramps, consecutive | base x10 / x20 / x40 |
| High Tide | 30 s | everything | base x2 |
| **Fireworks** (wizard) | 6 balls | all 3 modes played AND multiball completed | base x25 |

### End of ball

`bonus = (1,000 x ramps + 3,000 x banks + 2,000 x lane sets + 4,000 x bullseyes + 100 x spins) x multiplier`,
multiplier 1x to 5x, +1 per P·I·E·R completion.

Skill shot: lit P·I·E·R lane 8,000; soft plunge into the wheel 15,000.

**Extra ball at 250,000 and replay at 500,000 are PROVISIONAL** and marked as such wherever they
appear. Nobody can set a threshold before the phase 8 robot has measured what a real game scores.

## 4a. Visual identity

Matt's rev-A note: *"'Ferris Wheel' and 'Lighthouse' are labels on a circle and a line."* They were.

### The lighting language

Three channels carry state - hue, SHAPE and MOTION - never hue alone, because Matt is red/green
colorblind (root `CLAUDE.md`).

| State | Drawn |
|---|---|
| **Cold** | outlined chevron, slate. Nothing to collect |
| **Hot** | filled amber chevron + a slow pulsing ring |
| **Mode running** | white core + a rotating dashed ring |
| **Jackpot** | double chevron, fast pulse |
| **Spent** | flattened to an ellipse at 30% opacity (a dropped target, a used kickback) |
| **Bullseye** | ring and dot, vermilion. Always drawn this way, lit or not |

**An arrow insert sits in front of every major shot.** That is how mode state reaches the board
rather than a screen popup: when a mode lights the ramps, the two ramp chevrons fill and pulse and
everything else goes cold.

### The elements

| Element | Drawn as | Moving part |
|---|---|---|
| Ferris Wheel | 46 mm hub, three spokes, three open cars at 34 mm radius. Teal frame, amber cars | **rotates 120° per lock**; a locked ball sits visibly in its car; spins on release |
| The Coaster | blue wireform with cross-ties every 20 mm | **the diverter flap swings** at the crest, so you can see where the ramp will feed BEFORE you shoot it |
| The Pier | planked deck, boards across the lane, weathered grey-blue | none |
| The Arcade | three striped carnival-tent caps | flash white on fire (already in the engine) |
| Fishing Dock | three wooden posts with a slack rope between them | a dropped post lies flat; the rope sags |
| Lighthouse | slatted vane across the orbit lane, white tower base | **a beam sweeps** the left orbit while it spins, faster with RPM |
| P·I·E·R | four bulb inserts spelling the word above the lanes | each bulb fills as its lane is taken |
| Ring Toss | two ring standups, vermilion peg on a bullseye plate behind the gap | rings flick back on a hit |
| Rails | pier railing: rail plus vertical posts every 140 mm | none |
| Mode ladder | three square inserts beside the wheel, one per mode | lights when earned, solid when played |

## 5. What the engine is missing

Each new kind is the **five-place engine edit plus seven editor edits** the HANDOFF's landmine list
describes, and each needs its own probe or it is invisible to every check (`distToShape` throws on
an unknown kind, which is the only one that fails loudly).

| New kind | Risk | Note |
|---|---|---|
| `rollover` | **low** — a sensor | like `drain` but scores instead of killing |
| `standup` | **low** | a `seg` that scores |
| `spinner` | **low** — a sensor | counts crossings; does not block |
| `droptarget` | **medium** | must leave the collider set when down, and the bank reset must not re-materialise it under a ball |
| `saucer` | **high** | it HOLDS a ball and then ejects. It applies a velocity to a ball already at that position — **never a position write**, which is the invariant the whole engine rests on. Needs a watchdog that re-fires after 2 s |
| `kickback` | **medium** | same shape of risk as the saucer, in the outlane |
| `bullseye` | **low** | a recessed `standup` behind a gap. Two sensors, no new maths |
| `diverter` | **medium** | a `seg` with two endpoint sets, switched by game state. No new collision maths, but it MUST fail safe to the inlane position |
| `gate` (one-way) | **medium** | the only genuinely new collision behaviour here: a seg that collides from one side only. Needs its own probe - a one-way collider is invisible to `distToShape` from the passing side, which is the shape of bug that made bumpers invisible to every check for a build |

Plus the systems: a per-machine `rules.js` (score, ball, bonus, modes, lamps), a backglass, and
multiball (ball count, drain rules, serve-next — `World.balls` is already an array and `addBall`
already exists).

---

## 6. Build sequence

Each phase ships and is playable on its own.

| # | Phase | Gate |
|---|---|---|
| 1 | The scoring spine: `rules.js`, score/ball/bonus state, backglass, lamp state | headless rules tests |
| 2 | Sensor parts: `rollover`, `standup`, `spinner`, `bullseye` | every probe sees them |
| 3 | Mechanical parts: `droptarget`, wheel lock, `kickback` | rest sweep + a lock watchdog probe |
| 4 | State geometry: `diverter`, one-way `gate` | a probe per state, plus fail-safe |
| 5 | Multiball | 3-ball soak, 0 escapes |
| 6 | Build PIER NINE to this blueprint | all 8 probes green |
| 7 | The rules: modes, locks, jackpots, combos, skill shot, bonus | robot-player score spread |
| 8 | Tune on measurement | the table below |

**Rev C adds no phases.** Posts → phase 6 (geometry with a score hook). Boathouse, Ticket Booth,
Bait Shop, Coaster spinner → phase 2 kinds, phase 6 placement. Fortune Teller → phase 3 (saucer
class, watchdog included). Ball save → phase 3 (kickback class, second instance). Hurry-up, lane
change, outlane trade, Rattle → phase 7. The four density metrics → phase 8.

---

## 7. "Fun and competitive" as a number

This repo does not ship on "feels better now". A robot player measures these; the table gets tuned
until it meets them.

| Measure | Target | Why |
|---|---|---|
| median ball time | 25–45 s | under 25 is frustrating, over 45 the game never ends |
| make rate, any major | ≥ 25% | below this the shot is decoration |
| make rate, any major | ≤ 70% | above this it is a gimme and the skill ceiling collapses |
| bullseye make rate | 5-15% | it is the precision shot; over 15% it is not one, under 5% nobody tries |
| score 10th / 50th / 90th | 150k / 400k / 1.2M | an 8× spread over three balls is what makes a leaderboard mean anything |
| dead stops (`restSweep`) | 0 | non-negotiable |
| balls leaving (`escapeProbe`) | 0 | non-negotiable |
| ambiguous gaps (`checkGaps`) | 0 | non-negotiable |

**Density, added in rev C.** The table above measures SHOTS and nothing in it measures whether a
ball touches anything between them, which was the whole rev-B complaint.

| Measure | Target | Why |
|---|---|---|
| bare-deck rectangles | no empty area larger than ~120 x 120 mm in the usable field above the slings | directly kills the "3 things" read |
| contacts per ball (robot) | median ≥ 25 switch events | a ball that touches 8 things and drains is rev B |
| non-shot points share | 10–25% of game score from posts, slings, pops, spinners, lanes | below 10% the small stuff is decoration; above 25% aiming stops mattering |
| miss liveliness | ≥ 60% of failed major-shot attempts contact at least one scoring object before reaching a flipper | the real-table feel in one number |

All four are robot-measured in phase 8. **Until the robot exists they are targets, not claims** —
including the contact count below, which is a count of parts placed, not of parts hit.

**Contacts after rev C: 22 → ~43.** 22 (rev B) + 14 posts + 5 standups + 1 scoop + 1 spinner +
1 ball-save eject. The directive's "a WPC machine runs 40 to 60 switches" is **not quoted here as
fact** — the directive flagged it as approximate itself, and nothing in this repo has checked it
against a real switch matrix. The 43 is a real count of this table; the range it is compared
against is not yet verified.

**The robot player does not exist yet and is part of phase 7.** Without it, "make rate" and "score
spread" are opinions. A soak that wanders is not a measurement — this project has the receipts on
that (`pinball/CLAUDE.md` records four soaks passing a table that was unplayable in thirty seconds).

---

## 8. Deliberately NOT in this design

Each of these was considered and cut, and the reason matters more than the cut:

- **Upper flipper** — a 46-pixel control on a phone. The ramps already give the upper playfield a purpose.
- **Captive ball lane** — indistinguishable from a post at this render scale.
- **Subway / ball tunnel** — a place a ball can be lost, in an engine whose entire thesis is that there is nowhere for a ball to be lost.
- **Mini-playfield, spinning platform, magnet** — all of them need a driven position write.
- **A seventh major shot** — see §3. The bullseye is a second value on an existing target, not a new region.
- **Stats, a hub entry, a leaderboard** — that is after Matt has judged it, and when it comes it must be a NEW stats id (`pinball2`), never the existing `pinball` id (THE LAW rule 5).
