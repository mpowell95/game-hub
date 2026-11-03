# Handoff: the leaderboard points "(i)" sheet redesign (written 2026-11-03)

**Written by a session, not by Matt.** Quotes marked "Matt:" are his exact words. Anything not quoted is
the writing session's summary or suggestion and is **NOT cleared for players**.

## Five v2 tidy-ups, ADMIN DEVICES ONLY (2026-11-03 overnight, v1439-v1444)

Players still get the old board; none of this is released.
- (v1439, #1468) **No Bests block under any board** (`.lb2-recs`). Matt: "I don't like them anywhere ... Maybe down the
  road we can add a 'more stats' button." Display only: `lb2Board`'s `records` and `bestsHTML` still build it, for that
  button. Contexto's medal key under its tabs stays (a legend, not stats). The help sheet's "Bests" line went with it.
- (v1440, #1469) **Every v2 heart is red** (`--l2-heart`, light #E0243A, dark #F2384C): Games list rows, board header,
  favorites-first chip (filled + light red tint = on, outline = off). The launcher's ♥ is the red heart Matt sees on
  his iPhone (its CSS says #f2b705, but iOS draws U+2665 as the red emoji).
- (v1441, #1470) **The Expert double diamond is full size and centred.** The Me tab's need line forced every svg to
  14x14, shrinking ◆◆ into the left of its tile. Now ONE rule sizes the tile everywhere in v2: `--sh` = its height,
  shape centred, ◆◆ 1.7x as wide at the same height (a place sets only `--sh`). Sheets: `.lbps-sh.x2` 24 -> 31px.
- (v1442, #1471) **Spelling Bee rows: four fixed columns** under each name: the HIGHEST daily medal (gold, else
  silver, else bronze) and its count, 🧠, 🐝 (empty slot with none), 📅. `lb2Board` rows carry `bee` (beeRowFor,
  additive); the old board's chips are unchanged.
- (v1444) **Me tab: Golds | Lost | Closest**, one list at a time, under the medal tiles; the switcher sticks to the
  top while a long list scrolls. No section titles; "Not played yet" is gone (`lb2Records` still returns `fresh`).
  Opens on the list picked last (`meList` in `gamehub.lb2.v1`, a preference), else the first with rows. Empty
  list: "Nothing yet".

- (v1455) THE RELEASE POPUP, BUILT FOR ADMIN DEVICES (Matt: "set this up for just admin so next time I open the game hub I
  see it the same way the others will when we go live"). Matt's approved mockup: NEW pill, "New leaderboard layout / and
  point system"; page 1 "Points are now awarded / for every win", "Computer (robot) and (people) Online", "Harder /
  difficulties/modes = more points" ("=" in the middle of the screen; the words shrink, never wrap), Filler's own points
  cards; page 2 "Medals go to the players / with the most points.", an example board (made-up Player1-4), "Each game is
  different. / Find this on its leaderboard:", the button's picture; OK (pill) | Show me where. Both pages one height.
  "Show me where" dims all but the Leaderboard button, then a game, then "See how scores are calculated" (Skip; ends on
  the sheet). EN/ES, light/dark, 393/360 checked. On release: drop `adminDevice` in `js/announce.js`.
- (v1454) Every board and Medal Count show EVERY player: the tail of 0 rows no longer folds under "N players" (Matt:
  "Remove that. ALWAYS show everybody"; `foldTail` now draws every row).
- (v1453) REAL-DATA CHECK (Matt: "Check all data"; hearts red and the back swipe confirmed on his iPhone: "Yes and yes").
  Read-only snapshot (`tools/read-lb-snapshot.mjs`): test-stats-screens 61 real people, 788 screens, 1001/0;
  test-lb-points real top 3 ok; `tools/test-lb2-parity.mjs` 397/0 in EN and ES. Found and fixed: the Spelling Bee
  board's "N played" counted only the open language (23, not 40; `allPlaysSel`). The parity test now knows the
  Spelling Bee split and compares silver and bronze too (from the old board's full ranking: By Game's card cuts a
  tie for 3rd; Hold'em's untouched bankrolls get no medal in v2, by design). `tools/lb2-shots.cjs` loaded the bee
  board quoted (the real Spelling Bee board never showed in its shots); fixed.
- (v1452) A person's game page no longer repeats "Points: N" under the stats (the top card shows it; Matt: "Sure").
  My Stats keeps the line (it has no top card). CSS `.lb2 .gs-ptsline{display:none}`.
- (v1451) Matt: "Figure out the broken test and update so the swipe back works. Fix the contexto bug. Fix the sudoku line
  wrap." `tools/test-swipe-back.mjs` follows #1475 (admin device: My Stats button = v2 Me; My Stats itself opened as a
  player's button does), 232/0. `functions/boards.js`: Contexto's fewest guesses from `ctHistory` skips a voided phone.
  Me tab: "2 no-hint wins for gold" (was "solves", 5 px too long at 393).
- (v1450) **The points sheet on a person's game page is behind the button too.** Matt: "Why is the score calculation fully
  displayed on this page? We should hide it behind the same 'see how scores are calculated' button" (same words on every
  game, his choice). `ptsSectionHTML` = "Points: N" + the button; in v2 its `data-act="info"` opens the board's sheet over
  the person's page (`_info` now also on `pgame`, back closes it); elsewhere (My Stats) it unfolds the copy under it.
- (v1449) **Spelling Bee medals by language.** Moonis (bug report): "Leaderboard including Spanish is completely unfair.
  So many more points on that one". Matt: "Each game should be considered its own game for gold medal leaderboard
  purposes" (Spelling Bee only; not Contexto or Word Weaver). English and Español each give a gold, silver and bronze in
  Medal Count, Me (Golds / Lost / Closest rows "Spelling Bee · English"), and Lost records; the All board ranks with no
  medals; the board opens on the hub's language; the Games list shows each person's best place of the two. Splits
  only once `boards/v1/bee` has loaded (else one standing, so no medal is counted twice). Old board unchanged.

## BUILT, ADMIN DEVICES ONLY (v1429, session 6)

Matt: "Deploy to the Admin only leaderboard. DO NOT MAKE LIVE FOR ANYONE ELSE." Mockup v7 is built:
- `js/lb-points-sheet.js` (new): the cards, one body for both screens. `sheetModel(id)` is pure (rows from
  `pointsForWin`, the limit asked of `gamePoints` with 100 such wins); `pointsSheetHTML(id)` + its own light/dark CSS
  (`#lbps-css`, classes `lbps-*`). Option facts and the online list live in its `OPTIONS` / `ONLINE` tables.
- The board's (i) (`js/leaderboard2-ui.js infoHTML`): a wins board on an admin device shows the sheet instead of
  "Ranked by" / "Counts as". Leaderboard v2 itself opens only on admin devices.
- The stats page (`js/game-stats-ui.js ptsSectionHTML`, already `isAdminDevice()`-gated): "Points: N" + the sheet.
- (v1430) Matt: keep the (i) on top, and add a button under the board, "See how scores are calculated" /
  "Ver cómo se calculan los puntos" (`lb2_pts_how`). It opens the same sheet. `ptsInfo(game)` is the one gate for
  both, so the button is on exactly the boards whose (i) shows the sheet (admin devices, the 20 wins games).
- (v1433) Matt: "We should explain how everything is calculated and ranked." The button is now under EVERY board
  (gate: `rulesFor(game)`), and every game that is NOT a points game has its own sheet, `js/lb-rank-sheet.js`:
  "How it is calculated", "How it is ranked" (numbered), "Tabs", "Not counted", plus point tables where a game has
  them (Arrow Maze, Gridlock, Word Weaver, read from their own points modules, never typed in). Same cards and CSS
  as the points sheet. Every line was checked against the board code (gameMetricAt / boardTierOf /
  boardMetricCmp / lb2Tabs) on 2026-11-02; `tools/test-lb-rank-sheet.mjs` pins the numbers and EN/ES. Change a
  board's ranking and its sheet must change with it. The four unreleased wins games with no points table
  (archery, baseball, battlearena, cupbaseball) fall back to the old "Ranked by" line.
- (v1435) WHAT IT TAKES TO GET GOLD lives on the ME TAB, not the board. Ana likes how the old board shows how close
  you are to the record. v1433-v1434 put "N more to take the record" in the pinned row and then on your own row;
  Matt: "No I don't like that layout. I want it to be here in the Me tab... consolidate everything into 1 piece of
  info. Do not show my record and the all time record. Just show what is needed to beat the record." Both board
  lines are OUT again (round 4's pinned row is back), and each "Closest to a record" row on Me has ONE line:
  "5 points to get gold" (`lb2_need`, maths `needOf` in js/leaderboard-ui.js). A TOTAL game says how much to add
  at the record's level (record minus yours plus one; a tie-break loss is "1 point"); a BEST-RUN game (Ball Run,
  Brick Breaker, Snake, Hill Climb, Tower, Golf, Minesweeper) says the run that beats it ("Score 198,831",
  "Shoot 5 under", "Beat 5:22"); the level's shape rides the number. Sufficient, not always the least: any score
  on a level harder than the record's also passes it, and the line does not say so. Phrases were shortened until
  no line wraps at 393 px in EN or ES.
- (v1438) Matt: "Reach length 44 to get gold is incredibly wordy. And it doesn't tell me how close I already am...
  I want THE DIFFERENCE shown. And make the bold part gold. Convey the message in as few words as possible." So
  EVERY game now shows the difference at the record's level, plus one: "5 points for gold", "◆ 5 longer for gold",
  "2 strokes fewer for gold", "0:05 faster for gold". The difference is bold in gold (`--l2-gold`: #8A5A00 light,
  #FFCE3A dark). Only a time with none of yours on that level (or a golf course never played) shows the record
  ("Beat ◆◆ 5:22 for gold"). With nothing of yours on the record's level, the difference counts from 0 there.
- Found while checking, NOT fixed (reported to Matt): a Golf integrity void sets `bestRoundByCourse` to 0, which
  `golfBestAt` reads as 12 under, so a voided Golf player would rank FIRST. Minesweeper's void is safe (0 = no time).
- (v1443, FIXED, the item above) A voided Golf record now has NO best round (`bestRoundByCourse`/`bestHole` emptied in `js/stats-corrections.js`; `golfBestAt` and My Stats also refuse a stored 0), so it sorts last on the old board, Leaderboard v2 and My Stats; and a voided Contexto record loses its Daily medals too (`ct.d`, `fewestNH`). Overlay only, nothing stored changes; `tools/test-stats-corrections.mjs` pins both. No real record was voided on either game when checked.
- `js/lb-points.js`: Cup Pong no reracks doubles every level; Darts Cricket in order doubles (`kind` starting
  `cricket-order`). Every reader of `lb-points.js` is admin-gated, so player boards do not move.
- Strings `lbps_*` in `js/strings.js` (EN + ES); `lb_pts_x_cuppong` / new `lb_pts_x_darts` for the old board's line.
- Tests: `tools/test-lb-points-sheet.mjs` (every row of every game against `gamePoints`), `tools/test-lb-points.mjs`
  (+6 for the two fixes). Checked in Chromium as an admin device: all 20 games' (i) in EN/ES x light/dark at 360 px,
  the stats page, and a NON-admin device (old leaderboard, no sheet anywhere). Test note: the hub's
  `refreshAdminDevice()` clears the admin flag on a device that is not on `admins/`, so a browser test must keep the
  cached answer (route-patch that function in the browser's copy) or the sheet vanishes mid-run.
- (2026-11-03, navigation) Matt: "press back and go back to where I was on the stats page instead of having to go back
  to the hub landing page." Play, then Back (the Hub button OR the phone's back gesture) reopens Leaderboard v2 on the
  same tab, game board, filters or player page, at the same scroll. A game that is mid-play still asks its own "quit?"
  question first. Details: `js/CLAUDE.md`, the `back-stack.js` row. Admin devices only (the old board is unchanged).
- (2026-11-03, navigation) The profile page's "My Stats" button opens Leaderboard v2 on its **Me** tab on an admin
  device (`openLeaderboard2({tab: 'me', pageTabs: true})`); a player's device still opens the My Stats screen
  (`js/game-stats-ui.js`), because v2 is not released to players. The tab keeps its label "Me" (Matt).
- Releasing to players is still Matt's words only ("release it", "ship it", "make it live for everyone").
- (2026-11-03) BACK SWIPE: it worked "half the time on half the screens" because `onTouchMove` in `js/leaderboard2-ui.js`
  called `preventDefault()` on every touchmove that was not over a scroll list (header, tab bar, pinned row: always) and, over a
  list, on whichever ones drifted toward the list's end (a short list is at both ends: always), and a swipe the page cancels is
  one the system's back gesture never gets; nothing handled a swipe starting mid-screen at all. Now a finger is classified once it
  has moved 8 px, a sideways one is NEVER cancelled (nor anything in the 28 px edge strip the system owns), and a rightward swipe
  that starts past that strip calls `goBack()` = the back button's step (one screen; closes from the top level). Proof, every
  screen and sheet with real touch events at 393x852: `tools/test-lb2-swipe.mjs` (22 screens, 1,692 swipes: before 93, after all
  1,692; the history stack itself was never the fault, 33/33 stress cases pass on both).

## Where things stood before the build (live, v1427)

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

## Mockup v7 (session 6, current): all 20 games, EN + ES. Waiting for Matt's verdict; NOT built.

- File: `docs/mockups/lb-points-info-v7.html` (EN/ES buttons at the top; open it through the Pages site,
  https://mpowell95.github.io/game-hub/docs/mockups/lb-points-info-v7.html, since a raw.githubusercontent link shows
  the code). Regenerate with `node docs/mockups/lb-points-info.build.mjs`: every number comes from `js/lb-points.js`
  (`pointsForWin`, cross-checked per row against `gamePoints`), and whether a row is under the limit is asked of
  `gamePoints` with 100 such wins, never of the level alone. It prints the rows that show a planned fix instead of
  the live value (exactly 5: Cup Pong no reracks Easy/Medium, Darts Cricket in order x3).
  `docs/mockups/lb-points-info.review.mjs` checks every sheet against the rules below at 360 px in both languages and
  writes the images (needs `playwright-core` + Chrome).
- v6 -> v7, Matt's review of v6: "I don't like the 20 point limit yellow pill everywhere. i want it only at the bottom
  as the disclaimer. Maybe make a yellow 20 circle that looks kinda like a pool ball and put it on those rows instead?
  but don't put it under the description. Put it between the mode description and the point value where there's
  space." / "Escoba Easy + Hard computers wraps onto 2 lines. is that necessary??" / he "still really do[es] not
  like" the box text ("These wins are nearly guaranteed. Together they earn you 20 points at most. After that, they
  add 0.", with or without the "Easy always; Medium only first to 1 goal" list in front). Done: a yellow "20" ball on
  each limited row, on the label's line, before the points; the pill only as the box title; the box is the same in
  every game: "Wins marked (ball) are almost always won. Only your first 20 points from them count." (ES: "Las
  victorias con (ball) son casi seguras. Solo cuentan los primeros 20 puntos que te dan."); "Easy + Hard" (no
  "computers"); no row label or card title may wrap (the review fails on it; Chinchón ES became "Menos de 100 pts o
  10 rondas").
- Matt also asked "why is there a limit on basically every cup pong thing?" Answer given: Cup Pong Easy and Medium
  are both in the near-guaranteed group (`cap: [1, 2]`; Medium won 10 of 10, Easy is easier), and unlimited reracks
  record one level down, so Unlimited Hard counts as Medium. Only Hard with 1-3 reracks and Hard with no reracks are
  outside it (7 of 9 rows limited). No change asked.
- v5 -> v6 (self-review): Cup Pong's middle option is "1, 2 or 3 reracks" (the game offers 0, 1, 2, 3, unlimited;
  default 2); a coloured card ALWAYS has a tag word, so "Vs computer" cards are neutral grey and Tic Tac Toe has
  Normal/Harder tags; "Harder/Longer" cards are purple, not green (red/green colourblind); Spanish option tag
  "Estándar", because "Normal" is the Spanish word for the Medium level; several-computer games get a "2 or 3
  computers" card with one worked example.
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
4. The 20-point limit (v7, Matt): a yellow "20" ball on every row it applies to, on the label's line between the
   label and the points (never under the label); the words only once, in the box at the bottom, which shows the
   ball, says WHY (almost always won) and that the 20 is a total for all of them.
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
- v6 marked Tic Tac Toe ULTIMATE Easy/Medium as under the 20-point limit (the generator decided "limited" from the
  level alone; `gamePoints` counts Ultimate wins outside the limit). Fixed in v7 by asking `gamePoints` per row.
- A raw.githubusercontent link to a mockup HTML shows Matt the code; send the Pages URL instead.
