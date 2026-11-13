# Number Merge — archive/number-merge/CLAUDE.md

> **ARCHIVED 2026-11-13** (Matt: "remove this from the gamehub"). Moved from `number-merge/` to `archive/number-merge/`;
> removed from the app: launcher entry and `BUG_BTN_GAMES` (`js/hub.js`), tile art, strings, My Stats tab and
> `numberMergeScreen`, leaderboard GAME_META row, metric and `BEST_BOARDS`, `lb-rules.js`, `lb-rank-sheet.js`,
> `ADMIN_ONLY`, `recordNumberMerge` / `ensureNm` / `nmDayBest` (`js/game-stats.js`), its `players-agg.js` branch and
> SOLO entry, and `tools/test-number-merge.mjs`. It was admin-only and never in sw.js ASSETS. **Stored history NOT
> touched**: `'numbermerge'` stays in `GAMES` and is in `ARCHIVED_GAMES`; the real and test records (with `nm`) and
> `gamehub.numbermerge.v1` / `.save.v1` / `.daily.v1` stay on the phones and in `players/<id>` (pinned by
> `tools/test-admin-only-plays.mjs`). Its imports (`../../js/`) only resolve from the old path.
>
> **To restore:** revert the archive commit (everything above comes back from git).

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in `js/CLAUDE.md`.

A 4x4 merge puzzle: a swipe slides every tile; two equal tiles that meet become one, doubled; a new tile after each
move; no move left = game over. Built 2026-11-13 (Matt: "Start another session to build Number Merge. I've seen and
played that before, it's fun."). **ADMIN ONLY (`devOnly: true`) until Matt says "release it"**: no `released` date,
no announcement, no popup, no New bubble, no Game Hub message. Its own name, look and colours (not a copy of any game).

## Hub integration

| | |
|---|---|
| Folder / hub id / stats id | `number-merge/` / `number-merge` / `numbermerge` |
| Entry | module `../number-merge/js/ui.js`, **immersive**, prefix `.nm-root` / `.nm-`, in `BUG_BTN_GAMES` |
| Recorder | `recordNumberMerge(score, { mode, tile, moves, day })` (`js/game-stats.js`) in `withMode(() => ({ mode }), mode, ..., () => ({ hi: score, detail }))`, mode `classic` / `daily`; detail `moves`, `merges` (counters), `top` (the top tile, a string fact), `end` (`over` / `quit` / `day`) |
| Settings | `gamehub.numbermerge.v1` `{ seen }` (How to play shown once on this device; a preference) |
| Saves | `gamehub.numbermerge.save.v1` (Classic) `{ v, st, done, recorded, ended }`; `gamehub.numbermerge.daily.v1` `{ v: 1, d: { 'YYYY-MM-DD': same } }`; `st` = `{ grid: [16], rng, score, moves, merges, over }` |
| `isInProgress()` | always `false`: every move is saved, leaving is lossless (Continue) |

## Rules (`js/engine.js`, pure)

- `slide`: each line from the wall the tiles move toward; a tile merges at most once a move (2 2 2 2 = 4 4). Score =
  the sum of every merged tile. `move` = slide + ONE new tile, only when something moved.
- **Seeded tiles**: mulberry32, its state in the save (`rng`), so a resumed game gets the same next tiles. Each new tile
  draws twice: value (4 one time in ten, else 2), then its square among the empty ones.
- **Classic**: a random seed (`crypto.getRandomValues`), endless, best score.
- **Daily**: seed `dailySeed('YYYY-MM-DD')` (FNV-1a of a fixed prefix + the day), the same tiles for everyone that day;
  the day = the phone's LOCAL date of `bestNow()` (`js/server-time.js`, the server's clock where known). One try: the day's
  save is the only game; a finished daily reopens its final board and card. No board yet (a `nmDaily/` node would need a
  rules change: follow `wwDaily`, back up first).
- **Quitting (a solo game)**: Classic's New game over a game in progress asks ("This game ends at N.") and then RECORDS
  that game with its score (`end: 'quit'`). A daily left unfinished when its day is over is ended and recorded on the next
  open (`end: 'day'`). Leaving is never quitting. Nothing with 0 moves is recorded.
- Recording: the recorder runs FIRST at game over (before the card), `recorded` saved only after it returned the store;
  a refused record is retried on every open (`_flushAll`).
- Input: swipe on the board area (`touch-action: none` on `.nm-stage`, pointer events on the game's own root, never
  `document`/`window`), 24px to count; arrow keys and WASD on desktop.
- **The phone's back swipe steps back one screen** (`js/back-stack.js`): start screen 0, a game 1, How to play or the
  New game? sheet +1. The swipe, the hub's button (`back()`, "‹ Back" via `gamehub:backlabel`), the back arrow, the X's
  and Esc run ONE path (`_goBack`).

## Look

Deep slate in light and dark (bright text). **Colourblind-safe: tiles by NUMBER and LIGHTNESS**: every step down the ladder
is darker (L about 95 down to 18), light tiles carry dark numbers, dark tiles white, 2048 and up a gold ring (`.nm-v1` ..
`.nm-v12` in the CSS). Row 1 = the Hub button's row: only the mode chip. Row 2, 16px under it: back arrow top left,
Score / Best, How to play. The board is the biggest square the room allows (`_fit`, measured). Tiles slide by
`transform` (120 ms); merged tiles pop, new tiles grow. Reduced motion: the slide stays (80 ms; it IS the game), pop /
grow / the no-move bump go.

**UI review (2026-11-13, an independent reviewer; Matt: "Have another chat review the UI/UX")**: back navigation and every
flow passed. Fixed: the board sits a third of the spare height down (it floated centred), How to play text at 17px with
shorter lines (one row each at 320px, EN and ES), New game? makes Keep playing the gold button, Continue has no number,
the daily's game-over card says "No moves left" too, a lighter scrim so the final board shows. The game's own back
arrow stays (Part 0: under the Hub button, never removed).

## Stats (`nm` sub-counter)

`nm` = `{ games, moves, score }` (add), `best` (Classic), `bestDaily`, `bestTile` (Math.max), `dl: { 'YYYY-MM-DD': { sc, tl,
mv, t } }` (one per day; `nmDayBest` keeps the better whole). Merged per person in `js/players-agg.js`; shown by
`numberMergeScreen` in `js/game-stats-ui.js`. While admin-only the plays go to the TEST record (`ADMIN_ONLY`). Leaderboard
rule `best` (Classic's best score; average game `score / games` for ties). **At release**: drop `devOnly` (hub + TABS), add
`released`, remove from `ADMIN_ONLY`, decide `CARRY_TEST` with Matt, add every file to `sw.js` ASSETS, bump CACHE.

## Tests

`node tools/test-number-merge.mjs` (engine, recorder, merge), `node tools/test-game-conventions.mjs`,
`node tools/test-game-modes.mjs`, `node tools/test-i18n-strings.mjs`, `node tools/players-agg.test.mjs`,
`node tools/test-lb-rules.mjs`, `node tools/test-stats-screens.mjs`. The localhost-only seam `window.__nmTest`
(`state()`, `move(dir)`, `setGrid(grid)`).
