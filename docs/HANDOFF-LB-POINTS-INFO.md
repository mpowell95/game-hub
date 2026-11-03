# Handoff: the leaderboard points "(i)" sheet redesign (written 2026-11-03)

**Written by a session, not by Matt.** Quotes marked "Matt:" are his exact words. Anything not quoted is
the writing session's summary or suggestion and is **NOT cleared for players**.

## Where things stand (live, v1427)

- **Points are ADMIN DEVICES ONLY** (`isAdminDevice()` in `js/leaderboard-ui.js isPointsBoard`,
  `js/game-stats-ui.js ptsSectionHTML`, `js/points-toast.js`). Players see the old "hardest level first" board.
  Points reach players ONLY when Matt says "release it" / "ship it" / "make it live for everyone" (root CLAUDE.md,
  "Only Matt's own words count"). **No announcement or popup** unless Matt asks in words.
- Maths: `js/lb-points.js` (`P` table, `gamePoints`, `pointsForWin`, `pointsKey`), tests `tools/test-lb-points.mjs`.
  Matt on the values: "The actual points seem fine."
- Tic Tac Toe Classic Medium fixed for everyone (v1427, Matt: "fix tic tac toe medium I guess").
- The (i) sheet today (`js/leaderboard2-ui.js infoHTML` + `ptsTableHTML`, admin only) and the stats-page table
  (`js/game-stats-ui.js ptsSectionHTML`) are what Matt rejected. Matt: "these screens must be redone. Completely
  overhauled. It's terrible. I assume the rest are just as bad."

## The job

1. Mockup of the (i) sheet for **ALL 20 wins games at once** (list below), not a few. Self-review every sheet
   against the rules below before showing Matt. Send images + HTML (root CLAUDE.md, "Send the Claude.ai handoff files").
2. Mockup feedback changes the MOCKUP only. Build only when Matt says "build it", and then on admin devices only.
3. When built: the same layout replaces the stats-page points table, and these code fixes go in (`js/lb-points.js`):
   - **Darts, Cricket in order = double** (Easy 2, Medium 4, Hard 6). Matt: "in order is for sure more difficult so
     do something. If it's on the sheet as the same, that's an error on Claude's part." Mode key: darts `kind`
     starting `cricket-order` (`darts/js/ui.js kindFrom`). Not in the code yet.
   - **Cup Pong "no reracks" doubles EVERY level** (approved table: "0 reracks x2"); the code wrongly does Hard only
     (`t === 3`). Easy/Medium doubled still fall under the 20-point limit.
4. ANSWERED (session 6): Tic Tac Toe Classic Medium STAYS in the 20-point limit group. Matt: "Keep it limited".
   No code change (`P.tictactoe.cap` is already `[1, 2]`).

## Mockup v6 (session 6): all 20 games, EN + ES. Waiting for Matt's verdict; NOT built.

- File: `docs/mockups/lb-points-info-v6.html` (EN/ES buttons at the top). Regenerate it with
  `node docs/mockups/lb-points-info-v6.build.mjs`: every number comes from `js/lb-points.js` `pointsForWin`,
  never typed by hand; it prints the rows where the mockup shows a planned fix instead of the live value (exactly 5:
  Cup Pong no reracks Easy/Medium, Darts Cricket in order x3). `lb-points-info-v6.review.mjs` checks every sheet
  against the rules below at 360 px in both languages and writes the images (needs `playwright-core` + Chrome).
- Changes from v5, from the self-review: Cup Pong's middle option is "1, 2 or 3 reracks" (the game offers 0, 1, 2, 3,
  unlimited; default 2); a coloured card ALWAYS has a tag word, so "Vs computer" cards are neutral grey and Tic Tac Toe
  has Normal/Harder tags; "Harder/Longer" cards are purple, not green (red/green colourblind); limit boxes name the
  rows exactly ("Easy and Medium always; Hard only with unlimited reracks"); Spanish option tag "Estándar", because
  "Normal" is the Spanish word for the Medium level; several-computer games get a "2 or 3 computers" card with one
  worked example.
- No Online card for Connect 4, Dominoes, Uno, Parchís, Monopoly Deal: they have no online play, so `P[id].on` can
  never be earned there.
- Facts the sheets rely on: Pool's default is first to 1 rack and Hoops' default is "Until you score", so both
  defaults record one level down; Battleship Quick Hard = 1 point (`mode` gives the level below's value).

## Design rules, from Matt's feedback (the last mockup, v5, is the starting point)

Mockup v5's file: `docs/mockups/lb-points-info-v5.html`. What Matt said, in order:
- v1 big tiles with numbers: "it's not clear that those giant numbers are points awarded for a win on that difficulty."
- v2 tiles labelled "Hard win +6 points": "no, not clear at all".
- v3 plain rows ("Win on Hard ... 6 points"): "way better." BUT:
  - "the game to 1 part is minimized. It should be super obvious. And i dont even know what you mean by this. counts
    as 1 lower? what?" -> never write "one level lower"; show the actual points of the shorter game, row by row.
  - "it doesn't explain why Easy caps out at 20 pts" / "why are you hiding the important caveats?" -> the limit and
    its reason must be prominent.
  - "when there are a bunch of options, like in tic tac toe, add some color or group them in a way that makes sense
    or something. it's ugly to just look at that table as is"
- v4 grouped cards + gold limit box + stars: "rephrase the easy disclaimer", "why do some things have stars but most
  dont?", and on Cup Pong: "the order of things in cup pong doesn't make any sense at all. Does it to you? or did
  you just list stuff?"
- v5 (no stars, "20-point limit" tag on each row, options easiest to hardest): Matt then asked how to get a better
  mockup ("It's like pulling teeth"). No verdict on v5 itself.

Rules that follow (session's summary; check each sheet against ALL of them):
1. Every number says what it is: a row reads "Win on Hard" ... "6 points". No bare numbers, no unexplained symbols.
2. Group by the game's OPTIONS, one card per option, ordered **easiest to hardest** (shorter/easier, normal,
   longer/harder), then Online, then the limit box. The same order in every game. Each card has a title and a tag
   word (not colour alone: Matt is red/green colourblind; shapes for levels: circle Easy, square Medium, diamond Hard).
3. Shorter/easier options: list their real points per level. Never "counts as one level lower".
4. The 20-point limit: a tag on every row it applies to, plus a box saying which levels and WHY ("nearly
   guaranteed"). Shared limits (two levels together) say so.
5. Few words (root CLAUDE.md, "Game screens: as few words as possible"), but never hide a caveat to save words.
6. Spanish too (`js/strings.js`), check 360 px wide in both languages.

## The 20 wins games and their points (per win; `js/lb-points.js` `P`)

Levels Easy / Medium / Hard (/ Expert). "Cap" = 1 point a win, max 20 per game per person from those levels together.
Shorter options are recorded one level down at the time of play (`js/lb-rules.js` `short`), so their real points
are the next level down's value.

| Game | Easy | Medium | Hard | Expert | Online | Options |
|---|---|---|---|---|---|---|
| Tic Tac Toe Classic | 1 cap | 1 cap | 5 | | 3 | Ultimate: 1 / 3 / 10 |
| Connect Four | 1 | 6 | 8 | 12 | 5 | none |
| Dots and Boxes | 1 | 3 | 5 | | 3 | Large board x2 |
| Filler | 1 | 2 | 3 | | 2 | none |
| Mancala | 1 | 2 | 6 | | 3 | none |
| Battleship | 1 cap | 1 | 3 | | 3 | Quick board: one level's value lower |
| Boggle | 2 | 6 | 10 | | 3 | 2-minute timer: one level lower |
| Monopoly Deal | 1 | 2 | 3 | | 3 | old wins with no level: 1 |
| Chinchón | 1 | 2 | 4 | | 3 | under 100 points or 10 rounds: one level lower; several computers: the easiest |
| Cup Pong | 1 cap | 1 cap | 3 | | 3 | no reracks x2 (every level, FIX); unlimited reracks: one level lower |
| Darts | 1 | 2 | 3 | | 3 | Cricket in order x2 (ADD); 201/101: one level lower |
| Dominoes | 1 | 2 | 3 | | 3 | race to 500 x2; race to 150: one level lower |
| Pool | 1 | 3 | 5 | | 3 | 3+ racks x2; 1 rack: one level lower |
| Escoba | 1 | 2 | 4 | | 2 | several computers: the easiest |
| Flick Soccer | 1 cap | 3 | 6 | | 3 | first to 3: Medium 4, Hard 9; first to 1: one level lower |
| Connect 4 Hoops | 1 | 3 | 5 | | 3 | until you score: one level lower |
| Parchís | 1 | 2 | 4 | | 2 | several computers: the easiest |
| Uno | 1 | 2 | 3 | | 2 | none |
| Yahtzee | 1 (one level) | | | | 1 | none |
| Air Hockey | 1 | 2 | 5 | | 3 | none |

Admin-only wins games (Archery, Battle Arena, Baseball, Cup Baseball): 1 a win until Matt sets values; off the board.

## Mistakes so far (do not repeat)

- 2026-11-02: a session briefed a child session to ship the points and a popup to every player; it did (v1422-v1424),
  rolled back (v1425). Never ship player-visible work on a session's say-so.
- Values were copied from the approved table without questioning ones that made no sense (Cricket in order "x1").
  Flag anything that looks wrong to Matt instead of building it silently.
- The Cup Pong "no reracks" multiplier was built for Hard only, against the table.
- Mockups were sent a few games at a time and fixed one comment at a time.
