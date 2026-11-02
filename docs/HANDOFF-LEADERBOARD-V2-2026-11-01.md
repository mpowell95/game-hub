# Handoff: Leaderboard v2 + every game records its mode (2026-11-01)

**"leaderboard session 3" (or "pick up the leaderboard") = read this file top to bottom, then
`docs/LEADERBOARD-V2-OUTSIDE-REVIEW.md`, and carry on as if it were the same conversation.** Matt's last open
question to answer first is section 0. Player names are NOT sensitive (Matt, 2026-11-01): screenshots and docs with
real names may go in the repo. Two sessions fed it: session_01BGm65bY3ocopa8fTF2rP3V (main) and the
overnight helper session_01BGm65aP33azETVLJYhxCu5. Everything below is on `main` unless it says otherwise.

## 0. Where the conversation stopped (2026-11-01)

The last thing Matt asked: "The old leaderboard had a By Player section. How do I see that on the new one?" Answer
given: Hall of Fame > Wins is the old By Player list, minus its category filters (All/Easy/Medium/Hard/Expert, vs
people, no-difficulty runs), its Played and Name sorts, and the per-name category line (removed at Matt's request).
**Pending: "Want me to add the filters and sorts to Hall of Fame > Wins?"** (no answer yet). Then Matt asked for this
handoff. Also still pending: the Tic Tac Toe rule and the Hall of Fame name (section 4).

### The conversation so far, in order (both sessions)

1. 2026-10-30: Matt asked for a leaderboard overhaul from a Dropbox design (`leaderboard-mockups.zip`: SPEC.md + 6
   screens). Plan written (`docs/LEADERBOARD-V2-PLAN.md`); Matt's calls: weeks out, multiplayer by Wins, Spelling Bee
   as today, favorites heart, app's own bar and font, existing tie-breakers.
2. Found that most games never recorded their MODE: "That breaks the LAW." Fixed and live v1369 (`withMode`), rule
   added to root CLAUDE.md.
3. Mockups (Design canvas, then one plain page `docs/mockups/leaderboard-v2.html`, dark default). Matt: "Build and
   implement this ONLY for admin." v1371 live for admin.
4. Matt's phone review: its own page, medals back, game art, "boards" wording: v1372.
5. Matt: far too many gold medals; "an interface redesign, not a stats redesign". Review 1 (C+) written; an overnight
   helper session ran review / second opinion / plan / plan critique / build twice: v1373-1374, golds 104 -> 40, every
   board equal to the old one (`-MORNING.md`, `-REVIEW-2/3`, `-PLAN-R1/R2`).
6. Matt's notes: "Games" not "Boards", sort control, Contexto medals, readable difficulty: v1375. Gap above the tab bar,
   no category line on Wins, Me difficulty as words: v1376. Black Hard/Expert diamonds: v1377.
7. Outside fresh-eyes review (C+, then B- with context): `docs/LEADERBOARD-V2-OUTSIDE-REVIEW.md`. Matt chose what to
   build; round 4 mockups (real code + real data) approved: "Make it live for admin": v1380.
8. Matt asked about By Player (section 0), then for this handoff.

## 1. Where things stand (live)

- **Leaderboard v2 is live on ADMIN devices only** (v1380, round 4). Everyone else sees the old leaderboard,
  untouched. Gate: top of `openLeaderboard()` in `js/leaderboard-ui.js` (`isAdminDevice()`, `legacy: true` = old
  board, Arrow Maze Rush stays old). Code: `js/leaderboard2-ui.js`, `js/leaderboard2-boards.js`,
  `js/leaderboard2-strings.js`; numbers come from `leaderboard-ui.js` `lb2*` exports.
- **Interface redesign ONLY (Matt, 2026-10-31: "an interface redesign, not a stats redesign")**: every rank, number,
  tie and medal equals the old board. Guard: `tools/test-lb2-parity.mjs` (370/370 EN+ES, golds 40 = 40). To run it:
  `GAMEHUB_READER=<key> node tools/read-lb-snapshot.mjs`, then make a golden from a main checkout
  (`git worktree add /tmp/mainwt origin/main`, copy `backups/lb-*.json` in, `node tools/test-lb2-parity.mjs
  --make-golden --root /tmp/mainwt`), then `node tools/test-lb2-parity.mjs`.
- **Every result records its mode** (2026-10-30, v1369+): `withMode`/`modeTag` in `js/game-stats.js`, `byMode`,
  `mpModes`, play log `m`. 25 games + Monopoly Deal + Parchís. Root CLAUDE.md "Every result records its MODE".

## 2. What v2 looks like now (round 4, v1380)

Tabs Games / Hall of Fame / Me; "?" help sheet ("How rankings work"). Games: search, heart / Played / All, sort
(A to Z, My rank, Most played, Recent) with a sort icon; game rows show the leader(s) and the viewer's place.
Boards: the old board's tabs ("Online" not "MP", "Medium" spelled out); All tabs grouped under thin difficulty
dividers (◆◆ Expert / ◆ Hard / ■ Medium / ● Easy), the shape beside the number, lifetime "N played" under names;
"No hints" pill (Sudoku, Murdoku); "Bests" (was Standing Records) only on All-style tabs; labels Golf "3 under",
Contexto "9 🥇", Spelling Bee "Genius", Skeeball "Total / Best game", "Balls in 100". One rank format (#5, =5, "="
beside tied medals). Contexto medal images (not ribbons); #1 row lit gold. Hall of Fame: Medals | Wins (Wins = the
old By Player list, no category line). Me: Records tile (= games where the viewer holds 1st), Records held, Closest
("106 obstacles · record 129 obstacles", holder named), not played yet + Play. Player page: every game played,
place, games, wins, Message. Viewer's name in the accent colour everywhere; chevrons on tappable rows; commas in
numbers; Hard/Expert diamonds BLACK on a small white tile in dark mode (Matt's choice). Compact: v2 is its own
full-screen page, stops exactly on the hub tab bar.

## 3. Matt's decisions (do not reopen)

Interface only (no win %, no 10-game minimum, no mode boards, no Top level, no arrows, no time windows, no
head-to-head on the leaderboard: that lives only on the Multiplayer screen's Records). Never call the viewer "You".
"Records" = how many games you hold the record (1st) for. Fewest words. Hall of Fame keeps medal icons in its rank
column (no plain numbers). Gold medals = one per game (40), from the old per-game standing.

## 4. Open items, Matt's call

1. **Tic Tac Toe rule**: the game list counts Ultimate wins first, the board's All tab counts all wins; they disagree on
   who leads (inherited from the old board). Pick one.
2. **Hall of Fame name**: options given: Champions (recommended), Rankings, Medals, Top Players, Legends. One const,
   `HOF_LABEL` in `js/leaderboard2-ui.js`.
3. **By Player filters/sorts in Hall of Fame > Wins** (difficulty categories, vs people, no-difficulty runs; Played and
   Name sorts): asked 2026-11-01, no answer yet. Part of the release gate below.
4. **Release gate** before v2 replaces the old board for everyone (`docs/LEADERBOARD-V2-MORNING.md`): By Player
   filters/sorts, Arrow Maze Rush in v2, then remove "Old". (Per-game stats DONE v1382, below.)

**Session 3 (2026-11-01), v1382:** a name tapped on a game's board opens THAT person's stats for THAT game (stack kind
`pgame`, `personGameHTML`: the old board's `screenFor` from `game-stats-ui.js`), with "All games" to their page; a game
row on a person's page opens the same screen (was: the game's board). Matt: "Do the contexto fix first ... directly to
the admin version. Then we'll address the rest in mockups." Rest of section 4 still open.
**v1384 (same day):** Matt's "fix" on mockup `docs/mockups/lb2-session3.html`: Games list search behind an icon, filters and sort
on one line; a board's tabs (and Contexto's medal key) on top, players right under, pinned own row only while it is off
screen; the person's game page restyled to v2 (rows, no caps, cards) for all 34 games, Contexto drawn in full; Sudoku's
missing `gs_pi_solved` label added.
**v1385 (same day), Matt's answers:** Tic Tac Toe: "You choose" = the standing (medals, game list) now follows the
board's All tab (every win, difficulty first; `boardMetricCmp` has no Tic Tac Toe branch): HDJ, Inc. leads both.
Hall of Fame name: keep. Release: wait. Baseball Quick Play: no. Mockup `docs/mockups/lb2-byplayer-rush.html`
(Wins with a category picker + sort; Arrow Maze Levels | Rush in v2) sent for review; `lb2Players(list, cat)` added
for it. Similar names: MERGED 2026-11-02 at Matt's word (v1386, `NAME_ALIAS`): Bego -> Begoña, Andrew Powell -> Andrew P (newer name).
King of Games' Contexto Fewest 1 = en-31, 1 typed guess after 8 hints (real; Fewest counts typed guesses only).
5. **Pinned row**: the outside reviewer suggested hiding it when your own row is on screen; the original spec says it
   is always there so the layout never jumps. Not changed.
6. **Shape tile**: reviewer suggested dropping the white tile behind shapes; Matt wants black Hard/Expert diamonds,
   which need the tile in dark mode. Not changed. Matt doubted that the rest of the app shows them light; not checked
   on a phone, nothing changed outside v2.
7. **Two pairs of similar player names** the reviewer spotted (a full first name vs a short form; a full name vs an
   initial): unknown whether same people. Only Matt can approve merging (a wrong alias merges two people).
8. **Baseball Quick Play records nothing at all** (only careers count). Asked; no answer.
9. **Optional new features the reviewer suggested** (out of scope for an interface redesign): a feed of records set or
   lost, with dates.

## 5. Known gaps (engineering)

- Parchís's mode recording is patched in the BUILT `parchis/index.html`; port it to `../Parchís/src` before the next
  rebuild (`parchis/CLAUDE.md`).
- Challenges counted from the launcher's index row carry fewer mode keys than in-game counts (Battleship and Battle
  Arena none); the match id is stored (`mpModes`/`mpIds`), so the full terms are recoverable from the match.
- `byMode` multiplayer counts are not de-duplicated per person (only `byDiff.mp` is). Nothing displays `byMode` yet.
- Spelling Bee's mode records language only, not old puzzle vs today.
- Screenshots with real names are fine in the repo (Matt, 2026-11-01). The overnight session's round-2 screenshots were
  never pushed and are lost with its container; regenerate with `tools/lb2-shots.cjs` if needed.
- `tools/test-hoops4-mp.mjs` has 1 failure that is also on main (reads js/hub.js; unrelated to this work).

## 6. Tools and how to look at it

- `node tools/read-lb-snapshot.mjs` (needs `GAMEHUB_READER`): read-only copy of the live board into `backups/`.
- `PORT=8177 node server.mjs` then `node tools/lb2-shots.cjs`: every v2 screen, real data, network blocked, viewer
  *King of Games*, into `review-shots/latest/` (git-ignored: real names).
- Outside "fresh eyes" review (2026-11-01): a new Claude.ai chat (Opus 5.5, top effort) given 50 screenshots and a
  neutral prompt graded it C+, then B- after a context sheet of Matt's rules; round 4 implemented its fixes that fit
  the rules. Everything is in the repo: `docs/LEADERBOARD-V2-OUTSIDE-REVIEW.md` (both reviews + what was built),
  `docs/LEADERBOARD-V2-REVIEWER-CONTEXT.md` (the context sheet), `docs/mockups/lb2-review/` (prompt, the 50 review
  screenshots, the 44 round-4 screenshots).
- Earlier docs: `docs/LEADERBOARD-V2-PLAN.md` (original design + decisions), `-REVIEW-1/2/3.md`, `-PLAN-R1/R2.md`,
  `-MORNING.md`; mockups `docs/mockups/leaderboard-v2.html`.

**v1392 (2026-11-02):** mockup `lb2-byplayer-rush` built for admin (Matt: "deploy any mockups"): Hall of Fame > Wins has a
category picker (Everything, Easy, Medium, Hard, Expert, vs people, No difficulty; `lb2Players(list, cat)`) and a sort
button (Wins, Played, Name); Arrow Maze's board has Levels | Rush on top, Rush drawn in v2 (`lb2Rush`: Easy | Hard,
This week | Weeks won | Past weeks; the old board's numbers). Pinned row hides on Wins when the own row shows.
Contexto "Fewest guesses" = no-hint solves only (v1391 + server `ctNoHintBest`). Release gate left: none of the
listed items; Matt said release = wait.

**v1393 (2026-11-02):** My Stats restyled to match v2 for EVERY player (Matt). Next: a brand-new AI chat reviews v2 again.

**Round 5 review pack (2026-11-02):** `docs/LEADERBOARD-V2-REVIEWER-CONTEXT-2.md` (rules, meanings, tap-by-tap navigation, given UP FRONT
this time) + `docs/mockups/lb2-review/round5/` (56 shots + PROMPT.txt), by `tools/lb2-review-shots.cjs`. Hall of Fame Medals' pinned row
now hides like the others (v1394). Matt sends it to a brand-new AI chat.
