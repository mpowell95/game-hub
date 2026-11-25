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

## 2026-11-23 (evening): the sumo platform is only a circle

Matt: *"do you fall off the edge of the circle? or is the platform a square? it's confusing. please make it clearer"*.
Pieces fall off the circle (rules v2). The Sumo look drew a square clay mound behind the round ring, so the board looked
square. The mound is gone: the ring is a raised round clay platform on the dark hall floor, its shadow and darker clay
side showing the drop all the way round. Bumper cars and Pucks were already plain circles. Old rv 1 matches keep their
square (it is their rule).

## 2026-11-24: renamed Knockout

Matt asked for a better name; Ring Out was suggested, then Matt: *"Should we just go with knockout? It's not like that's
trademarked or anything"* and *"yes rename"*. Shown as Knockout (Spanish K.O.) in the game, the launcher, the
leaderboard, notifications, and the admin page. Nothing stored was renamed: the folder, hub id, stats id, keys, the
`shoveoff/` node, and the push tag keep the first name (THE LAW, rule 5). The trademark question was not checked.

## 2026-11-25: the flicker while aiming, a better bumper car, bigger setup pictures

Matt (a recording): *"when i set up a piece, the circle around them flickers a bunch"*. Frame by frame (60 fps), the
power ring round the dragged piece swapped between two looks every frame: at full power it turned pale, thicker, and
glowing, and a finger held at the end of the drag kept landing just under and just over "full" (the aim is rounded to
whole numbers). The piece also shook at full power. Now the ring keeps one look, its glow fades in over the last 10% of
power, and nothing shakes. *"create better bumper car pieces too"*: redrawn from the front and above so the fat rubber
bumper ring shows all the way round, with a glossy tub, racing stripe, big headlights, the driver at a big wheel, and the
pole and spark. *"update the pieces in the screenshot"* (the setup screen's look picker): each picture is now the piece
itself, big, on its look's plain floor (the whole platform had shrunk it to a speck).

## 2026-11-25: the computer retuned

Matt: *"fix the computer difficulty like the review said"*. Measured first against four simple strategies (shove the
nearest full power, at 70%, sloppy, mixed), 30-40 games each: Medium and Hard won 0-2 of 30 for the player, Hard usually
in round 1, because both planned against exactly that charge and stepped aside. In sudden death Hard chose -560,0 on every
seed. Changes (cpu.js CFG): Medium guesses only "standing still", top 2, noise 0.16, one pass; Hard reads the player's move
on 40% of rounds, top 2, noise 0.12/0.14, two passes, worst-case weight 0.1; sudden death picks among the top 3-4 with
extra noise on every level. After: Easy 24-29 of 40 for the player, Medium 13-24 of 40, Hard 2-12 of 40, games 3-4 rounds;
level order kept (Medium 31-9 Easy, Hard 20-10-10 Medium, Hard 33-7 Easy); Hard is also faster (two passes, not three).

## 2026-11-25: the rest of the review

Matt: *"fix the other things from the review too"*. Done here: How to play warns that a missed hard shove slides you off;
the board zooms in as the circle shrinks (round 7 and sudden death showed small pieces in a sea of empty floor); labels and
names fit instead of being cut ("Autochoq…" and "Cual…" in Spanish at 360 wide, long names on the Online tab); a match
vs the computer left mid-slide now replays that round on Continue (the save keeps `shown`), and one decided during an unseen
slide plays its last round on the next open and then shows the card (or shows the card on the setup screen when left from
there; before, the result was recorded silently); confirm buttons say what they confirm and New game in round 1 asks
nothing; the result card shows each side's pieces left. "Settings" (vs the computer) was left as is: it opens the screen
where the look and level are chosen. Hiding a first sender's online aims until both have sent is a separate change.

## 2026-11-25 (later): How to play cut to 16 words

Matt: *"the How to Play is terrible. How many words did you use?"* It had 43 words on 7 lines (a goal plus six rules,
the sixth added that day), against the repo's own pattern (docs/BUILDING-A-GAME.md, "How-to-play screens": one goal line,
a diagram, a caption). Now: "Last one on the circle wins." + the diagram + "Drag to aim. Both launch together." +
"Over half off = out." The shrink and sudden death explain themselves in play (the banner names sudden death).
## 2026-11-25: sealed rounds (online aims hidden until both have sent)

Written by a session, not by Matt. The review: "Online aims can be read before they are revealed (known, documented). The
first player's aims sit in the database until the other player sends, so the second player could read them with dev tools.
In a game where both sides move in secret, that is the whole game." Matt: "fix the other things from the review too". The
game is still ADMIN ONLY; nothing here shows it to players.

- Every NEW match carries `sv: 1`. Sending a round no longer appends to `shoveoff/games/<id>/log`: the phone writes
  `shoveoffSealed/<id>/r<round>/<side>` = `{ aims, at (server time), u (its sign-in) }` and, in the same multi-path write,
  the public marker `shoveoff/games/<id>/sealed/r<round>/<side>` = server time and `updated`. Round keys are `r<n>`
  because bare numbers come back from Firebase as arrays.
- Rules: the sealed entry is written once (`!data.exists()`), only when the writer's `msgAuth` code is that side's code,
  only on an `sv` match that is not over, `at` within 2 minutes, `u` = the sign-in, nothing else; never deletable. Read:
  admins, the reader key, and that side's own code (so a phone verifies its write and gets its arrows back after a reload).
  On an `sv` match the rules refuse a log entry from a phone; a marker cannot be moved. `shoveoffSealed` is in the backup
  BRANCHES (reader key).
- The server (`functions/shoveoff.js` `revealRound`, triggers `shoveOffSealed` on each sealed entry and `shoveOffPoke` on
  `shoveoff/games/<id>/poke`): when every side still owing the current round has a sealed entry, a transaction appends both
  entries in the order they were sealed (a tie: a first), exactly the old `{ by, r, aims, at }`, sets `updated` and, when the
  replay decides it, `over` as a phone did; then both index rows (`rowFor`, `lastBy` from the side that sealed last), which
  is what `shoveOffTurnPush` pushes from. Over (resign, cancel, decline) = never revealed. Reads one match + one round.
- The pure match code moved from `mp.js` into `js/match.js` unchanged (mp.js re-exports every name), so the server runs the
  phone's own validateGame / rowFor (copied by `tools/sync-functions-shared.mjs`). `validateGame` reads the markers of the
  current round: a sealed side does not owe it (`owes`, `lifeOf` open/waiting, `senderPlayed`, the 7-day timeout all count
  it as sent); both sealed = `resolving` (nobody owes, so no timeout; a phone pokes after 45 s, at most once a minute).
- A phone writes only its own row on a seal (both on delivery, as before); if the round resolved while it wrote, it repairs
  the rows from a fresh read (one push either way). A re-send of a sealed round is ok when the aims match its sealed entry
  (or this phone's copy), else `moved-on`.
- Old matches (no `sv`) play exactly as before: `tools/test-shoveoff-mp.mjs` strips `sv` from new matches to replay every
  older section unchanged, then plays a sealed match end to end against the function's own code.
- Not checked: the real database rules (the repo's rule evaluator only), the real Cloud Functions runtime, a real phone. An
  older build that opens an `sv` match cannot send in it (the rules refuse its log write); admin devices update quickly.

