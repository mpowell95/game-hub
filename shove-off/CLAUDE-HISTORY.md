# Shove Off — CLAUDE-HISTORY.md

The story behind `shove-off/CLAUDE.md`. Append a dated section; never rewrite an old one.

## 2026-11-18: built, admin only

Matt filmed GamePigeon's Knockout and asked for our own version: sumo wrestlers, bumper cars and pucks, two colours
each, chosen like Tower Stack's looks; a tie is sudden death; online challenges only. Built by a session in one pass
(engine, challenges, push, screens, tests) and left admin-only until Matt says "release it". Every rule choice the
recording could not settle is listed in `CLAUDE.md`, "Rules ... and every choice made".

## 2026-11-18 (later): sumo art redrawn, vs the computer added

Matt: *"the sumo guys don't look like sumo wrestlers at all. they look like nothing."* The first sumo was a top-down
beige disc with a belt ring and a dark blob for a head; at 30-40 px it read as nothing. Two top-down redraws (belt band,
arms, topknot) still read as a disc with a hole for a mouth, so the sumo is now drawn from the FRONT and kept upright
(the pieces' aims are shown by the arrows anyway): topknot, face with brows, round belly, the mawashi in the side's
colour with its front flap and sagari cords, thick legs, both arms out shoving. The side marker became the belt
buckle. The sumo platform became a dohyo (straw circle with the four tokudawara gaps, two shikiri lines). Bumper cars
got bonnet stripes and headlights, and the driver's helmet became the marker (the marker used to sit on the bonnet
and covered the wheel); pucks got a raised rim, a groove, and a shine. The launcher tile was redrawn with the same
wrestlers on a dohyo (it was a blue water scene), and the hub entry's accent followed.

Matt: *"Add computer play to the game so i can test it"*, *"Everything is still admin only"*. A session's brief set the
shape (Computer tab, Easy / Medium / Hard, the computer's aims chosen at the start of each round and saved, save and
Continue, New game over a started match is a loss). Choices: the computer plays the player's own kind in the other
colour (sumo vs sumo on one dohyo) rather than another kind; "started" = one round played; the next round's aims
are chosen right after Launch, while the reveal shows (a short hitch then, never while aiming). The HUD moved below
the hub's floating Back / bug row (`max(safe top, 54px) + 42px`): with no safe area it sat under them.

## 2026-11-18 (evening): the circle, the 51% rule, sides that differ (rules version 2)

Matt, after playing the computer with the Sumo look: *"make the pieces move different. the colors of the background are
the same. it's only the wrestlers clothes you made different. make it so the piece falls off if 51% of it is off the
circle. Make the circle begin bigger. there's plenty of more space on the screen that's not being used"*. The parent
session read "move different" as "more different". The sumo pieces now stand on a mat in their side's colour, the
bumper cars' rubber rings took their side's colour, and pucks got a contrasting outline.

Matt played on the straw ring drawn INSIDE the square and treated it as the edge, while the rules used the square (a
piece had to pass well beyond the ring). The edge is now that circle, for every look (both phones replay one engine).
Because existing matches and computer saves must replay exactly (THE LAW), the change is a RULES VERSION: `rv` absent =
the old square; new matches and games carry `rv: 2`. Four logs made by the old engine are pinned bit for bit in test.js.

The 51% line is computed, not approximated: the share of a disc inside a circle by a fixed-step integral along the line
through both centres (sqrt only), and 50 bisections for the 49%-inside distance, cached per radius. It sits within 2
units of the circle itself (the circle's curve and the 1% roughly cancel), so on screen "the centre crosses the line".

Size: the piece's on-screen size was kept at least what it was (r 17.8 px at 393 wide), which fixes the circle at about
1050 units for a 375 px circle; the circle's AREA (3.46 M) is a little less than the old square's (4 M) but 56% more
than the straw ring Matt was actually playing in (840 radius). Seeded computer series, rv 1 then rv 2: Hard v Medium
14-4 / 14-3, Medium v Easy 16-4 / 17-3, average rounds 3.9 / 4.3 (Hard v Medium), Hard v Easy 37-3 / 35-5.

## 2026-11-23: full review + animations

Matt: *"Do a full review/test of the knockout game we started building last week. Make it as fun as possible (include
animations and stuff)"*. Review: engine (64), challenges (66), push, challenges list, no-scroll, and conventions all
green; three full matches vs the computer played through real pointer drags on the canvas with no errors. No game bugs
found. Added `js/fx.js` and the motion listed in CLAUDE.md, "Animations". Draw time at 4x CPU slowdown (headless):
median ~1.2 ms, p95 ~3 ms (~12 ms at a 2x pixel ratio). A first version cached the platform too and rebuilt it at
every shrink (spikes to 120 ms), so only the ground is cached. Impact bursts were first too big and faded into dull
brown "suns", and hits squashed pieces flat; both toned down after looking at frame-by-frame captures. Still admin only.

## 2026-11-23 (later): sumo and bumper cars redrawn

Matt: *"the new animations are sweet. But the pieces are still eh. The pucks are good. but the bumper cars don't look
like bumper cars, and the sumos don't look like sumos"*. Both had been drawn INSIDE a coloured disc with the big white
side marker in their middle (the sumo's belly, the car's cockpit), so at 36 px they read as coins. Now each is a figure
standing on its base and rising above it, with the marker moved to a small badge on the base. The sumo got the parts
that say sumo at a glance (the fan topknot, a body wider than tall, the belt running between the legs, the cord fringe,
the crouch); the car is seen from the front with the three things every bumper car has (the fat rubber skirt, the
driver at a wheel, the pole up to the ceiling with a spark). A car on a base of its own colour blurred into one blob, so
the car's base is the darker shade. Engine untouched.
