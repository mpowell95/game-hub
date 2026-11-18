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
