# Handoff: Leaderboard v2 + every game records its mode (2026-11-01)

"Pick up the leaderboard" = this file. Two sessions fed it: session_01BGm65bY3ocopa8fTF2rP3V (main) and the
overnight helper session_01BGm65aP33azETVLJYhxCu5. Everything below is on `main` unless it says otherwise.

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
   filters/sorts, the old player page's full per-game stats, Arrow Maze Rush in v2, then remove "Old".
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
- Round-1 overnight screenshots with real names are in the public repo at `docs/mockups/lb2-shots/r1/`; Matt was
  asked whether to take them down, no answer.
- `tools/test-hoops4-mp.mjs` has 1 failure that is also on main (reads js/hub.js; unrelated to this work).

## 6. Tools and how to look at it

- `node tools/read-lb-snapshot.mjs` (needs `GAMEHUB_READER`): read-only copy of the live board into `backups/`.
- `PORT=8177 node server.mjs` then `node tools/lb2-shots.cjs`: every v2 screen, real data, network blocked, viewer
  *King of Games*, into `review-shots/latest/` (git-ignored: real names).
- Outside "fresh eyes" review (2026-11-01): a new Claude.ai chat (Opus 5.5, top effort) given 50 screenshots and a
  neutral prompt graded it C+, then B- after a context sheet of Matt's rules; round 4 implemented its fixes that fit
  the rules. The prompt and context sheet are kept locally only (they name players).
- Earlier docs: `docs/LEADERBOARD-V2-PLAN.md` (original design + decisions), `-REVIEW-1/2/3.md`, `-PLAN-R1/R2.md`,
  `-MORNING.md`; mockups `docs/mockups/leaderboard-v2.html`.
