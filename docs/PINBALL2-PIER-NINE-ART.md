# PIER NINE — art direction

Companion to `docs/PINBALL2-PIER-NINE.md` (the engineering blueprint). That file says where every
part sits and what it scores. **This file says what it LOOKS like.**

Matt, 2026-09-12, on the blueprint: *"it's a wiring diagram, not a design. Every element is drawn as
its literal primitive... 'Ferris Wheel,' 'Lighthouse,' and 'Arcade' exist only as labels in the .md
file - nothing in the actual drawing reflects them."* Correct. The rev-B "visual identity" section
was a written description of a picture that did not exist, which is not the same thing as the
picture. This is the picture, plus the rules behind it.

**The rendering is `pier-nine-art.html`** in the design artifact, and the geometry in it is the SAME
coordinates as the blueprint, so the two overlay 1:1. If a coordinate moves in one, it moves in both.

---

## 1. The world

**A seaside pier, after dark.** The playfield IS the pier deck: weathered timber planks running
down-table, lit in warm sodium pools under each feature, with open water below the drain and a night
sky over the water behind the Arcade. Everything bright on this table is a carnival light.

That decides three things before any element is drawn:

- **The ground is dark and the features are the light sources.** Nothing is lit by an ambient key;
  every glow on the table comes from an object that would really be glowing.
- **The drain is water, not a red line.** A ball leaving play falls off the end of the pier.
- **Colour is scarce.** The deck, the rails and the sky are desaturated blue-greys. Amber, teal and
  vermilion appear only where an actual light or an actual painted object is.

## 2. Palette

| Token | Hex | Where |
|---|---|---|
| Water | `#05090f` | below the deck, and the drain |
| Sky | `#0d2038` | over the water, behind the Arcade |
| Deck | `#26313d` | weathered pier timber, moonlit. Plank lines `#313e4c` |
| Railing | `#cfdae8` | white painted rails and posts |
| **Hot** | `#ffce3a` | the repo's standing accent. **Shoot this.** Used sparingly, or it means nothing |
| Bulb | `#fff3d0` | marquee bulbs, the Ferris Wheel rim, the lighthouse lamp |
| Sodium | `#ffb35c` | the lamp pools on the deck |
| Teal neon | `#35d0c0` | the wheel frame, the Pier ramp's rope light, armed gates |
| Vermilion | `#e0532f` | the Coaster track, the rings, the slingshots |
| Cold | `#55697f` | anything unlit |

Amber and vermilion are the two warm hues and they never mean the same thing: **amber is state**
(this is lit, shoot it) and **vermilion is material** (this object is painted red). A vermilion
slingshot is not "hot"; it is just red.

## 3. The state language

Three channels carry state - **hue, SHAPE and MOTION** - and never hue alone, because Matt is
red/green colorblind (root `CLAUDE.md`).

| State | Drawn |
|---|---|
| **Cold** | outlined chevron, slate `#55697f`. Nothing to collect here |
| **Hot** | filled amber chevron + a slow pulsing ring |
| **Mode running** | white core + a rotating dashed ring |
| **Jackpot** | double chevron, fast pulse |
| **Spent** | flattened to a low ellipse at 30% (a dropped post, a used kickback) |
| **Bullseye** | ring and dot, vermilion. Drawn this way lit or unlit, so the precision shot is never mistaken for a standup |

**An arrow insert sits on the deck in front of every major shot.** That is how mode state reaches
the BOARD instead of a screen popup: when a ramp mode starts, the two ramp chevrons fill and pulse
and every other chevron goes slate. A player can read what to shoot without reading a word.

Three other things show state as GEOMETRY rather than as light, which is stronger:

- the **diverter flap physically swings**, so where the Coaster will feed is visible before you shoot it
- a **locked ball sits in its Ferris Wheel car**, so 2 of 3 is a thing you see, not a number you read
- a **dropped Fishing Dock post lies flat** and the rope between the posts sags

## 4. Element by element

| Key | Element | Looks like | Moves |
|---|---|---|---|
| 3 | **The Ferris Wheel** | teal frame, twelve bulbs round a 44 mm rim, three open cars, dark hub with an amber lamp | **rotates 120° per lock**; a loaded car is amber, an empty one is a slate outline; spins on release |
| 2 · H | **The Coaster** | a wooden coaster: cream sleepers between two vermilion rails, on a dark bed | **the diverter flap at the crest glows teal and swings** between its two positions |
| 4 | **The Pier** | weathered grey planks across the lane, a thin teal rope-light down each side | none. It is the calm shot beside the Coaster's noise |
| A | **The Arcade** | three striped tent caps, vermilion and cream, bulb at the centre | flash white on fire (the engine already does this) |
| 5 | **The Fishing Dock** | three timber mooring posts, warm oak, with a slack rope strung between them | **a dropped post lies flat**; the rope sags with it |
| C | **The Lighthouse** | a white vane with a vermilion band, on an axle across the left orbit | **a beam sweeps the lane** while it spins, faster the harder it was ripped |
| B | **P·I·E·R lanes** | a marquee sign above the lanes, bulbs around a dark panel | **each letter fills amber** as its lane is taken; unlit letters sit slate |
| D | **Ring Toss** | two vermilion rings on a fairground plate, a cream-ringed bullseye peg behind the gap | rings flick back on a hit |
| J · E | **Gate and kickback** | teal when armed, slate when spent. The gate is a hinged flap at the orbit's top; the kickback is a lit strip up the left outlane | the gate drops shut behind the ball |
| — | **Deck and railings** | planks down-table, sodium pools under each feature, white painted railing with posts every 140 mm | none |
| — | **The drain** | open water with faint wave lines, below the deck's edge | none |

### Rev C elements

| Key | Element | Looks like | Moves |
|---|---|---|---|
| — | **Rubber posts** (14) | white-capped railing stubs with a dark rubber ring, the same language as the pier railing | none. **They are furniture and are never lit amber** — amber means "shoot this", and nobody shoots a post |
| K | **The Boathouse** | a small clapboard face on the left rail, its two standups drawn as shuttered windows | a struck shutter flicks |
| L | **The Ticket Booth** | a striped booth face, vermilion and cream. The 3-position mystery state is a visible **pointer wheel** on the booth front | the pointer steps one position per hit |
| M | **The Bait Shop** | two hanging signs on the right orbit's guide, swinging from eyebolts | the signs swing when clipped |
| N | **The Fortune Teller** | a curtained tent mouth set into the left wall at (100, 570), bulbs round the arch | lit = the arch bulbs **chase** around the curtain (motion), not just colour |
| P | **The Coaster spinner** | a turnstile at the Coaster entry, which is exactly what it is | spins with the ball, the arms blurring with RPM |
| Q | **The ball-save eject** | a lifebuoy on the deck edge at the drain mouth | glows while armed, dark once spent |

Nothing here needs a shape primitive §5 does not already name. Every one of them is blocked on the
same three additions: the **decor layer**, the **lamp state** and the **clock**. The pointer wheel,
the chasing arch and the swinging signs are all clock work; the shutters and the lifebuoy are lamp
state.

## 5. What the engine cannot draw today

Named rather than quietly skipped. Every one of these is why the render is currently a picture and
not the game.

| Gap | What it blocks |
|---|---|
| **No decorative layer.** `render.js` draws colliders and nothing else | Almost everything in §4: the wheel's rim, bulbs and cars, the tent stripes, the plank texture, the marquee, the railing posts, the water. Needs a `decor` list on the table - drawn, never collided, invisible to every probe |
| **No lamp state.** There is a 110 ms `hot` flash map and nothing more | Cold / hot / mode / jackpot / spent. Needs a persistent per-shape lamp fed by `rules.js` |
| **No animation clock** in the renderer | The pulse ring, the wheel turning, the beam sweeping, the marquee chase |
| **Art bigger than its collider.** The wheel is drawn at r 44 against a saucer of r 23 | Correct for a Ferris wheel - the frame is around the hole, not the hole - and only possible once the decor layer exists. Until then the wheel can only be as big as its own hole |
| **Scale.** The render is 440 px wide; a phone gives the table 306 | At 0.6 px/mm the twelve rim bulbs and the tent stripes are about 2 px each. They read as texture, not as countable parts. Nothing in the design depends on counting them |

These belong in build phase 1 beside the scoring spine: **a decor list, a lamp state and a clock**
are three small additions to `render.js`, and none of them touches the solver.

## 5a. The Pier ramp moved, because the render found a collision

Drawing it is what caught this. The Pier ramp's crest sat at **(404, 470)**, and the Ring Toss plate
occupies **x 380..406, y 484..610**. The ramp passed directly over the target and buried it - the
whole feature was invisible under the wireform.

Crest moved inboard to **(360, 470)**. The lane's right edge is then x 378 against the plate's left
edge at 380, so they touch rather than overlap.

**`docs/PINBALL2-PIER-NINE.md` §2 carries the same correction.** The blueprint's own note already
said the right-side stack was the first clearance to check; this is the second thing found there
after the bullseye sitting inside the shooter-lane wall. **Two of the three errors in this design so
far have been on the right side, in the 60 mm shared by the Ring Toss, the right orbit, the Pier
ramp and the shooter lane.** Treat that band as suspect until a probe has passed it.

## 5b. The left wall is the new suspect band

The right-side 60 mm produced two of the three errors in this design, both caught by drawing.
Rev C stacks the same density onto the LEFT: the Lighthouse spinner, two posts, the Boathouse bank
and the Fortune Teller scoop now share **x 28..160, y 430..742**.

Placing them moved five coordinates off their first values. Two of the rev C directive's own
coordinates (Boathouse at the rail face, Fortune Teller at (58, 660)) were unusable as given
because both sat inside the left orbit lane. Then the arithmetic caught the Fortune Teller against
the left Ferris Wheel post at **25.9 mm**, squarely in the wedge band.

**And then the render caught a third one, which the arithmetic could not.** At (146, 530) the
scoop sat under the **Coaster ramp** — the ramp's left edge is x 161 at that y, the scoop's right
edge x 169, an 8 mm overlap, with the whole feature buried under the wireform. Exactly §5a's Pier
crest over the Ring Toss plate, on the opposite side of the table. Final position **(100, 570)**,
welded to the orbit's inner guide, which pushed the Boathouse up to y 452..508 and its derived
value from 4,500 to 5,000.

**Three of the four errors in this design have been found by drawing it.** That is now the
strongest argument in this file for the render existing at all.

**Treat x 28..160 as suspect until `checkGaps` has passed it**, exactly as §5a says of the right.

## 6. What this does NOT specify

Deliberately, so nobody treats a gap as an oversight:

- **No sprite sheet, no bitmap art.** Everything above is drawable with the shapes `render.js`
  already has plus gradients. That is the point: this is a vector table and it should stay one.
- **No animation timings.** The pulse, the wheel's rotation and the beam's sweep are named here and
  timed at build, against how they read at 306 px on a phone.
- **No backglass design.** The score display is its own screen and its own job.
