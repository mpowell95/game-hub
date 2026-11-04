# Handoff: Leaderboard v2, session 7 (written 2026-11-03)

**Written by a session, not by Matt.** Quotes marked "Matt:" are his exact words. Everything else is the writing
session's summary. **Nothing here is cleared for players**: v2, the points, the Spelling Bee split and the intro popup
reach players ONLY when Matt says, in his own words, "release it", "ship it" or "make it live for everyone".

Start here: **ask Matt what still needs work.** His last words: "It still needs work. and some other leaderboard screens
do as well." He did not say which screens or what. Do not guess; ask, then mock up before building (root CLAUDE.md,
"Mockups are sketches").

## Where it stands (live at v1455, ADMIN DEVICES ONLY)

Earlier detail: `docs/HANDOFF-LB-POINTS-INFO.md` (newest entries at the top of its first section).

| PR | What | Version |
|---|---|---|
| #1478 | Spelling Bee English and Español each give their own medals (Matt: "Each game should be considered its own game for gold medal leaderboard purposes"; Spelling Bee only, not Contexto or Word Weaver). All board ranks without medals; the board opens on the hub's language. `LB2_MEDAL_SPLIT` / `lb2MedalLangs` in `js/leaderboard-ui.js` | v1449 |
| #1479 | A person's game page: the points sheet sits behind "See how scores are calculated" (same words on every game, Matt's choice) | v1450 |
| #1481 | `tools/test-swipe-back.mjs` follows the Me tab (232/0); server: a voided phone's Contexto puzzles no longer refill "fewest guesses" (`functions/boards.js`); Me: "2 no-hint wins for gold" (no wrap) | v1451 |
| #1482 | A person's game page no longer repeats "Points: N" (My Stats keeps it: no top card there) | v1452 |
| #1483 | Real-data check: Spelling Bee "N played" counts everyone again; `tools/test-lb2-parity.mjs` covers silver, bronze and the split (397/0 EN and ES) | v1453 |
| #1484 | Every board and Medal Count show EVERY player (Matt: "ALWAYS show everybody") | v1454 |
| #1485 | The new leaderboard's intro popup + "Show me where" guide | v1455 |

Matt confirmed on his iPhone: red hearts and the back swipe work ("Yes and yes").

## The intro popup (built, admin devices only; Matt: "It still needs work")

- Entry: `js/announce.js` `lb2-points-2026-11-03`, `adminDevice: true` (shown on admin devices, SKIPPED on every other
  phone so it never blocks the next announcement), `pages: 'lb2-intro'`. Drawn by `js/announce-ui.js` `showLb2Intro`
  (two pages in one grid cell = one height; buttons never move) and `runLbGuide` ("Show me where": dims all but the
  Leaderboard button, then the first game row, then "See how scores are calculated"; the player taps; Skip; ends on the
  sheet, on Skip, when the leaderboard closes, or after 3 min). Example boards: `img/lb2-intro-board-{en,es}[-dark].png`
  (made-up Player1-4, Filler wins from the game's own recorder, quantized ~16 KB).
- **To show it again on a phone that already dismissed it**: give the entry a NEW id (e.g. `lb2-points-2026-11-04`);
  seen-lists are by id (`gamehub.announce.v1`). Never reuse an id at release.
- Approved mockup: `docs/mockups/lb2-intro-popup-approved.jpg`. As built: `docs/mockups/lb2-intro-popup-built-en.jpg`
  (pages 1-2 + guide steps), `docs/mockups/lb2-intro-popup-built-es-dark-360.jpg`.
- Matt's decisions along the way (mockups v1-v12): title "New leaderboard layout / and point system" on 2 lines, more
  prominent (NEW pill, 25px/800); all body text ONE style, bigger (20px, semi-bold); NO line that wraps one word ("use the
  two full rows by wrapping the text somewhere else in the sentence and increasing the font"); "Harder / difficulties/modes
  = more points" with the "=" in the MIDDLE OF THE SCREEN (his sketch); page 1 = points (Filler as the example: Easy 1,
  Medium 2, Hard 3, Online 2, the simplest table); the 20-point-cap slide was CUT (Matt agreed); page 2 = "Medals go to
  the players / with the most points." + example board + "Each game is different. / Find this on its leaderboard:" + a
  picture of the button; OK in a pill | Show me where; both pages the same size ("it's annoying for the user to have the
  Next button move places"); no words about the old system (Matt: "who cares what the system used to be? Say what it is
  nowwww"); first-open tab tips were dropped (Matt: "those popups are super obvious").
- Known gaps vs the mockup: the "=" line shrinks to fit (17px at 393 in English; "difficulties/modes" cannot fit half the
  width at 20px); the guide's game step points at the FIRST game row (Air Hockey / Atasco), not Filler.
- Matt's idea, not built: "Eventually I think we should move the info button that displays the point values to the setup
  screen of every game. That would be the best way to do this." The session suggested doing it BEFORE release so the
  popup (shown once) teaches the final place.

## Release checklist (only on Matt's words)

Every gate is `isAdminDevice()`: `openLeaderboard`'s v2 gate (`js/leaderboard-ui.js`), `isPointsBoard`,
`ptsSectionHTML` (`js/game-stats-ui.js`), `js/points-toast.js`, the profile page's My Stats button (`profile/index.html`,
#1475), and `adminDevice: true` on the popup entry (drop it). Then bump CACHE past main, `validate-sw-assets`, deploy,
verify Pages. Open decisions for Matt: keep the "Old" link (session suggested ~2 weeks), points on setup screens first?

## How to check (safe: localhost, fake database, made-up players)

- Real data, read-only: `GAMEHUB_READER` is set in the environment; `node tools/read-lb-snapshot.mjs` writes
  `backups/lb-z.json`, `lb-admin.json`, `lb-bee.json` (git-ignored). Parity: `git worktree add <dir> origin/main`, copy the
  three files into `<dir>/backups/`, `node tools/test-lb2-parity.mjs --make-golden --root <dir> [--lang es]`, then
  `node tools/test-lb2-parity.mjs [--lang es]`. `tools/lb2-shots.cjs` (fixed this session) = real-data screenshots.
- Browser harness pattern: `tools/test-lb2-swipe.mjs` (fake `firebase-boot.js` by route, `serviceWorkers: 'block'`,
  `gamehub.adminDevice.v1 = '1'`, all non-localhost aborted). Seed `gamehub.announce.v1` `{seen:[...]}` to skip or
  show the popup. Records via the games' own recorders (`tools/stats-screens-fixture.mjs`), boards via
  `functions/boards.js buildBoardParts` + `packBoard`, the bee board via `js/bee-fairplay.js buildBeeBoard` (the node's
  value is a JSON STRING).
- Suites touched this session: test-lb2-swipe (`--quick` 816/816), test-swipe-back 232/0, test-lb2-parity 397/0,
  test-stats-screens 211/0 (1001/0 with real people), test-lb-points-sheet, test-lb-rank-sheet, test-boards 12/0,
  test-stats-corrections 61/0. Pre-existing, not from this work: test-sw-update 2 failures (same on the commit before
  #1468); test-puzzle-holes 3 failures (I6, same on main before this session's changes).

## Smaller things noticed, not fixed

- A voided Golf record's person page still shows its average per hole (strokes and holes are not voided). Boards are clean.
- The old board's By Game card shows 3 names, so a tie for 3rd beyond them is cut (v2 shows every tied player).

## Session 7 progress (2026-11-03)

Matt's notes (screenshots of the popup and Arrow Maze's points sheet): popup "feels chaotic... The title isn't a title...
Everything looks the same"; the Arrow Maze sheet: "we could easily cut the number of words in half". Mockup v1 sent, NOT
built: `docs/mockups/lb2-fixes-mockup-v1.{html,jpg}`. Popup: medal + NEW + title as a real title (27px/800, white), a rule
under it, body ONE short line in a lighter grey 18px/400, one picture per page; page 1 drops the "Computer and Online" and
"=" lines (the Filler table shows both). Arrow Maze sheet (151 words to 45): ONE table (level x hints/hearts lost 0/1/2/3+)
replaces the points card and the hints card; "How it is ranked" and "Tabs" cut; Rush in 3 lines. Waiting on Matt.
Mockup v2 (Matt's notes on v1): popup table header "Difficulty" + "Points / per win" (two lines, centred over the
column, every value centred under it; no Filler thumbnail); Arrow Maze "Hints used or lives lost"; the "counts once" and
"Expert before 2 Nov" lines deleted; Rush = one line "Most arrows cleared wins." (Matt: "You're like explaining how to
play, which is not the purpose of this screen"). `docs/mockups/lb2-fixes-mockup-v2.{html,jpg}`. NOT built.
Mockup v3 (Matt: "nice", then 4 notes): a 6px gap sets Online apart from Hard; page 2 "Most points wins gold."; the
button picture sits in a dark frame with a 👆 under "Each game scores differently. / Tap this on its leaderboard:" (Matt:
a bare button "is confusing. People are going to try clicking on it"); Arrow Maze sheet hugs its content (no empty band
above Done). `docs/mockups/lb2-fixes-mockup-v3.{html,jpg}`. NOT built.
Mockup v4: v3's frame and 👆 on page 2 were NOT asked for (Matt: "put it back how we had it"); page 2 is back to the built
wording "Each game is different. / Find this on its leaderboard:" + the plain button. No stretched spacing: the popup is
as tall as its taller page (702 px vs 734 at 402 wide), centred; even gaps on both pages. Online's gap kept.
`docs/mockups/lb2-fixes-mockup-v4.{html,jpg}`. NOT built.
**BUILT on branch `claude/awesome-keller-sb41sq` (2026-11-03), NOT merged (Matt: "build it - do not make it live yet")**:
the popup = mockup v4 (`js/announce-ui.js` `drawLb2Intro`; Filler's numbers from `sheetModel('filler')`), Arrow Maze's
sheet = one table + one Rush line (`js/lb-rank-sheet.js` `grid`/`text` cards; strings `lbrs_h_lvl`, `lbrs_wo_sup`,
`lbrs_wo_rush`). On merge: bump CACHE past main, `validate-sw-assets`. Next (Matt): every other game's sheet, one at a
time, current screenshot then a mockup, same principles (151 -> 30 words on Arrow Maze).
Scores-screen mockups sent 2026-11-03 (NOT built; Matt reviewing): `docs/mockups/sheet-<game>-v1.{html,jpg}` for Sudoku (v3
approved: "That mockup is good"), Murdoku ("Good"), Nuts & Bolts, Minesweeper, Gridlock, Word Weaver, Contexto, Spelling
Bee, Hill Climb, Snake, Ball Run, Brick Breaker, Tower, Golf, Hold'em, Skeeball, and ONE shared layout for every wins game
(Flick Soccer, Cup Pong, Connect Four shown): a grid of level x option, circled = under the 20-point limit, Online apart.
**Every scores screen, current set: `docs/mockups/final/sheet-<game>.{html,jpg}`** (2026-11-03, after Matt's notes: bright
headers on all; Battleship 8x8 / 10x10; Chinchón "Under 100 points" / "100+ points"; Darts "101 or 201"; the 20-point
circle as "(circle) = Only your first 20 points from these count."; Hoops Hard + "Until you score" = 2 (PROPOSED points
change, `js/lb-points.js` not touched yet); Chinchón/Escoba/Parchís 2-3 computers = each computer's points added up
(PROPOSED; Matt: winning vs Easy + Hard is harder than 1v1 Hard; tables are saved in `byMode` `ai` since 2026-10-30,
older wins only know the easiest level). Nuts & Bolts A (1/2/4/8) or B (+ Easy capped at 20): Matt has not picked.

## On hold (Matt, 2026-11-04: "Not now. We'll deal with later. Don't change nuts and bolts scoring yet")

- **Nuts & Bolts points**: the branch has option B (1, 2, 4, 8 a level, Easy at most 20). Matt then said "too crazy";
  options shown: 1, 2, 3, 4 (session's pick) or 1, 1, 2, 2. Do NOT change it until Matt decides.
- **Matt's missing Nuts & Bolts history (THE LAW, rule 8: believe him)**: Matt: "I had WAY more levels completed";
  he ties it to the test1 / MattyIce mix-up. Facts (read-only, 2026-11-04): his records now are `dc1745bc` (app, QZCC4,
  11 solves, matches the game's own levels: Medium 3, Hard 7, Expert 3) and `e0e63fde` ("Mattyice", no code, 30
  solves, last sync 2026-07-17). Device **`2b0d7c05`** (his code QZCC4, renamed "test1", last sync 2026-09-13; see
  js/CLAUDE-HISTORY.md "A code's name is its NEWEST record's name") is **no longer in `players/`**, and no doc or
  commit records deleting it. Next: Matt's backups on his PC (`backups/rtdb-2026-09-12T22-08-55-909Z.json`, monthly
  exports, RESTORE.md (c)) show what it held; restore by a read-time add (`HAND_ADDS`-style), then find what deleted it.
