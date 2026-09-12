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
| 3 | **The Ferris Wheel** | teal frame, twelve bulbs round a 42 mm rim, three open cars, dark hub with an amber lamp | **rotates 120° per lock**; a loaded car is amber, an empty one is a slate outline; spins on release |
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

## 5. What this does NOT specify

Deliberately, so nobody treats a gap as an oversight:

- **No sprite sheet, no bitmap art.** Everything above is drawable with the shapes `render.js`
  already has plus gradients. That is the point: this is a vector table and it should stay one.
- **No animation timings.** The pulse, the wheel's rotation and the beam's sweep are named here and
  timed at build, against how they read at 306 px on a phone.
- **No backglass design.** The score display is its own screen and its own job.
