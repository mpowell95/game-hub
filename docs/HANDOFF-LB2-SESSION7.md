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
