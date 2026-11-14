# Word Ladder — word-ladder/CLAUDE.md

> **THE LAW** (root `CLAUDE.md`): player data is never deleted, never lost, never put at risk.
> Read it there before touching anything that records or stores. The working rules are in `js/CLAUDE.md`.

Change one letter at a time, every step a real word, from a start word to a target (COLD, CORD, WORD, WARD, WARM).
Built 2026-11-13 (Matt: "start a new session to build Word Ladder"). **ADMIN ONLY (`devOnly: true`) until Matt says
"release it"**: no `released` date, no announcement, no popup, no New bubble, no Game Hub message.

## Hub integration

| | |
|---|---|
| Folder / hub id / stats id | `word-ladder/` / `word-ladder` / `wordladder` |
| Entry | module `../word-ladder/js/ui.js`, **immersive**, prefix `.wl-root` / `.wl-`, in `BUG_BTN_GAMES` |
| Recorder | `recordWordLadder(level, { moves, par, hints, lang, band })`, `recordWordLadderDaily(key, { moves, par, hints })` (`js/game-stats.js`), both in `withMode` (`{ mode: 'ladder'|'daily', lang }`, detail moves/par/hints) |
| Settings | `gamehub.wordladder.v1` `{ lang }` (puzzle language; nothing saved = the hub's language) |
| Saves | `gamehub.wordladder.save.v1` `{ en, es: attempt }`; `gamehub.wordladder.daily.v1` `{ v:1, d: { '<en|es>-<YYYY-MM-DD>': attempt } }`; attempt = `{ v, n, p, chain, moves, hints, sel, done, recorded }` |
| `isInProgress()` | always `false`: every move is saved, leaving is lossless |

## Rules (`js/engine.js`, pure)

- Tap a letter of the current word (gold outline + caret), then a key. The new word must change exactly that one
  letter and be on the word list, else "Not a word" and a shake. A letter already right (same as the target's at that
  place) is a SOLID GREEN tile (`--wl-match`), nothing else (Matt, 2026-11-14: "Just make it green"; a dot under the letter and
  then a folded corner were both rejected; his call over the shape-plus-colour rule). The target row has dashed gold tiles and a flag.
- **Moves count every change, Undo too** (an undo is a move back). Par = the fewest changes possible.
- **Stars**: moves at par 3, par +1 or +2 = 2, more = 1; 1 hint caps at 2, 2+ hints at 1 (`starsFor`, = `wlStars` in
  `js/game-stats.js`). **Hint** = plays the next word on a shortest path from where you are (the commonest one) and
  counts as a move.
- **One ladder per language, played in order** (no replays, no level picker): bands by level number (`BANDS`):
  1-100 Easy, 101-250 Medium, 251-400 Hard, 401-500 Expert (the stats `byDiff` bucket). Next level = the attempt in
  progress, else one past the highest completed in the stats map. Past 500: "More levels soon".
- **Daily**: one ladder a day per language, the same for everyone: the phone's LOCAL date of `bestNow()`
  (`js/server-time.js`, the server's clock where known); day 0 = the data's epoch 2026-11-13; after the 730 days the
  list repeats. No board yet (a `wlDaily/` node would need a rules change: follow `wwDaily`, back up first).
- Desktop: letters type, ← → move the caret, Backspace = Undo.
- **The phone's back swipe steps back one screen, as in every leaderboard (2026-11-13, Matt)**: `js/back-stack.js`, levels
  start screen 0, a level / daily / done card 1, How to play +1. The swipe, the hub's top-left button (`back()`; it reads
  "‹ Back" via `gamehub:backlabel` while there is a step, "‹ Hub" on the start screen), the game's own back arrow, the X's
  and Esc all run ONE path (`_goBack` -> history -> `_stepBack`). `destroy()` closes the stack. Checked: history does not grow.
- **The goal is said on screen (2026-11-13, Matt: "not clear how to play AT ALL")**: How to play opens BY ITSELF the
  first time a device reaches a level (`seen` in `gamehub.wordladder.v1`, a preference), with a drawn example ladder
  (`howSVG`: each step's changed letter outlined gold, arrows, the flag) and a Got it button; until the first move the
  line above Undo/Hint reads "Change one letter. Get to <target>." (`_coach`). Each help line fits one row at 360px.

## Data (GENERATED: `node tools/build-word-ladder-data.mjs`, never hand-edited)

`data/<en|es>/words.json` (accepted words, 3-5 letters: Word Weaver's grid + extra words PLUS the whole Boggle
dictionary, ENABLE / `boggle/data/words-es.txt`, so every real word is a legal step, rude ones included (2026-11-13,
Matt: ASS was refused, "Yes it is" a word); grid words first, most common first), `levels.json` (500), `daily.json` (730). A level = `{ s, t, p, h }`.
**Par is the true minimum over EVERY accepted word** (so nobody beats it) and a path of that length exists through
Word Weaver's GRID words alone (common, hand-checked); start, target and the hint path are grid words.
`node word-ladder/js/data-test.js` (~1 min) checks every level and day of both languages by breadth-first search.
**APPEND-ONLY once released**: progress is by level number.

## Stats (`wl` sub-counter)

`wl.lv` (English) / `wl.es` (Spanish) `{ 'L<n>': entry }`, `wl.dl { key: entry }`, entry `{ s, m, p, h, t }` (`wlBest`:
the BETTER attempt kept WHOLE: more stars, then fewer moves, then fewer hints; never one attempt's moves with another's hints,
rule 4; earliest time). First completion = one play + win in its band (`daily` for the
daily). Merged per person in `js/players-agg.js`; shown by `wordLadderScreen` in `js/game-stats-ui.js` (levels, stars,
at par = ladder levels in par moves, daily). While admin-only the plays go to the TEST record (`ADMIN_ONLY`). Leaderboard rule
`solves` (`js/lb-rules.js`); the board number is `wlSolved` (DISTINCT levels from the merged maps, both languages, by band via
`wlBandOf`), never `byDiff` wins: a second phone starts at level 1 and would count a level twice. No points yet. No integrity
rule yet (`GAME_NAMES` has it; candidate STRONG rule `m >= p`, replay over real data first). **At release**: drop `devOnly` (hub + TABS), add `released`, remove from `ADMIN_ONLY`,
decide `CARRY_TEST` with Matt, add every file to `sw.js` ASSETS with `data/**` in LAZY, bump CACHE.

**Data reaches the phone on the next open (2026-11-13)**: `destroy()` forgets the loaded words and levels, so going back to
the Hub and in again fetches them fresh (the hub keeps this module loaded for the life of the page; before this a phone
kept old data until the app was closed, and Matt's refused LIEN). A data change that must reach admin phones at once also
bumps CACHE (they reload on a new build).

**A save from another puzzle counts nothing (2026-11-13, Matt: "How is this 5 moves? I never used the undo")**: `cleanAttempt`
drops a save whose first word (or stored `s`) is not this level's start, so a remade level or day starts at 0 moves; attempts
now store `s`. Matt's daily that day (KICK LICK LICE LIVE LOVE, saved as 5) is set to 4 moves and recorded again by the
one-time `_repair1113` (his code only, stamp `gamehub.wordladder.repair1113.v1`, verified by re-read; the entry only improves).

## Layout

Night blue in light and dark (bright text). Row 1 = the Hub button's row: only the level chip. Row 2, 16px under it:
back arrow (to setup) top left, Moves / Par, How to play. The ladder fits by measurement (`_fit`: tile sizes from the
room; earlier words folded under a ⋮ when they do not fit; tiles never under 32px, so earlier words' letters stay over 11px). The
done screen's ladder (`_fitFinal`, refit on resize) keeps 30-44px tiles and shows the first word, a ⋮ and the last words when it
is too long (2026-11-13 review: an 18-word ladder had shrunk to 16px tiles, 9px letters, and overflowed). **Keys are 10 across like a phone keyboard, so narrower
than 44px** (33px at 360, 37px at 402, edge to edge with 3px gaps; a documented departure from the 44x44 floor; 50px tall).
Hints show as a badge on the bulb and beside Moves/Par on the done card (2026-11-13 UI review: a 1-star finish at par read
as a bug). How to play says Undo counts as a move. The star total on the start screen hides at 0. A finished, RECORDED save
is kept as saved even if a word later leaves the list. **The daily is the day it is OPENED on**: a ladder half done at
midnight stays saved under its day but the Daily button then opens the new day (not finishable after; kept simple).

## Tests

`node word-ladder/js/data-test.js`, `node tools/test-word-ladder.mjs` (recorders, merge, board count, stars = engine), `node tools/test-game-conventions.mjs`, `node tools/test-game-modes.mjs`,
`node tools/test-i18n-strings.mjs`, `node tools/players-agg.test.mjs`, `node tools/test-lb-rules.mjs`.
The localhost-only seam `window.__wlTest` (`state()`, `type(word)`, `hint()`).
