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
| Settings | `gamehub.wordladder.v1` `{ lang, seen, band, tip1 }` (puzzle language; nothing saved = the hub's language; `tip1` = the first-move tip shown) |
| Saves | `gamehub.wordladder.save.v1` `{ '<lang>:<band>': attempt }` (+ the old `en`/`es`, kept); `gamehub.wordladder.daily.v1` `{ v:1, d: { '<en|es>-<YYYY-MM-DD>': attempt } }`; attempt = `{ v, n, ver, s, p, chain, moves, hints, done, recorded, redo?, log?, ab? }` (`ver` = the puzzle version, 2026-11-19; absent = 1; older saves also carry an unread `sel`; `redo` = Redo's words, newest undo last; `log` = the private play log so far; `ab` = a past day logged as abandoned) |
| `isInProgress()` | always `false`: every move is saved, leaving is lossless |

## Rules (`js/engine.js`, pure)

- Tap a letter of the current word (gold outline + caret), then a key. **Nothing is picked until the player taps a letter**,
  at the start and after every move or undo (Matt, 2026-11-14: "Don't default to have the first letter selected"); a key before
  that shakes the word and says "Tap a letter first". The new word must change exactly that one
  letter and be on the word list, else "Not a word" and a shake. A letter already right (same as the target's at that
  place) is a SOLID BRIGHT GREEN tile (`--wl-match` #22b84f; "make it a better green", 2026-11-14), nothing else (Matt, 2026-11-14: "Just make it green"; a dot under the letter and
  then a folded corner were both rejected; his call over the shape-plus-colour rule), its letter NAVY (6.2:1; white was 2.6:1, 2026-11-19). The target row has dashed gold tiles and a flag.
- **Moves count every change, Undo too** (an undo is a move back). Par = the fewest changes possible.
- **Redo (2026-11-19, Matt: "add a redo button")**: beside Undo, same look; Ctrl+Y, Ctrl/Cmd+Shift+Z, or Shift+Backspace.
  **Redo takes back an Undo**: the undone word returns and the Undo's move is refunded, so Undo then Redo leaves the ladder
  and Moves exactly as before (Dots and Boxes' Redo, 8247e98, "puts them back exactly"). Nothing can be gained: any other
  step (a word or a hint) clears Redo, and Undo shows only a word already played. Typing the undone word again is the same
  Redo (`R:` in the log). Off when nothing is undone; saved with the attempt (`redo`, checked on load by `_cleanRedo`).
- **Stars**: moves at par 3, par +1 or +2 = 2, more = 1; 1 hint caps at 2, 2+ hints at 1 (`starsFor`, = `wlStars` in
  `js/game-stats.js`). **Hint** = plays the next word on a shortest path from where you are (the commonest one) and
  counts as a move.
- **Four difficulties, each its own run of levels played in order (2026-11-14, Matt: "How do I get longer words? It should be
  like Arrows or word weaver where there's difficulty levels")**: the start screen's Easy / Medium / Hard / Expert (shape + name,
  `gamehub.wordladder.v1` `band`) = bands of one numbered ladder (`BANDS`, `bandRange`): 1-100 Easy (3-letter words), 101-250
  Medium (4), 251-400 Hard (5), 401-500 Expert (6). Play <n> = that band's attempt in progress, else its lowest level not
  completed; all done = "<Band> done". One attempt per band in the save (`<lang>:<band>`); the old one-per-language attempt
  (`<lang>`) is kept as stored and still read for its own band (rule 5). No replays.
- **Daily**: one ladder a day per language, the same for everyone: the phone's LOCAL date of `bestNow()`
  (`js/server-time.js`, the server's clock where known); day 0 = the data's epoch 2026-11-13; after the 730 days the
  list repeats. No board yet (a `wlDaily/` node would need a rules change: follow `wwDaily`, back up first).
- Desktop: letters type, ← → move the caret, Backspace = Undo, Shift+Backspace or Ctrl+Y = Redo.
- **The phone's back swipe steps back one screen, as in every leaderboard (2026-11-13, Matt)**: `js/back-stack.js`, levels
  start screen 0, a level / daily / done card 1, How to play +1. The swipe, the hub's top-left button (`back()`; it reads
  "‹ Back" via `gamehub:backlabel` while there is a step, "‹ Hub" on the start screen), the game's own back arrow, the X's
  and Esc all run ONE path (`_goBack` -> history -> `_stepBack`). `destroy()` closes the stack. Checked: history does not grow.
- **The goal is said on screen (2026-11-13, Matt: "not clear how to play AT ALL")**: How to play opens BY ITSELF the
  first time a device reaches a level (`seen` in `gamehub.wordladder.v1`, a preference), with a drawn example ladder
  (`howSVG`: each step's changed letter outlined gold, arrows, the flag) and a Got it button; until the first move the
  line above Undo/Hint reads "Change one letter. Get to <target>." (`_coach`). Each help line fits one row at 360px.

- **Feel (2026-11-19 UI/UX review, graded C+; `CLAUDE-HISTORY.md`)**: a step drops the new word in and flips the changed tile
  (~180ms; a tile turning green fills); a word not on the list shows the tried letter in a navy tile with a gold X for ~0.7 s, shakes,
  then goes back (the next tap cancels it at once: no move is ever lost); every earlier word's changed letter has How to play's gold
  outline; dashed empty rungs (full target-tile slots on faint gold rails, crossbars only BETWEEN rows, shrinking only when room is short) between the word and
  the target = par - moves - 1, never below 0 (moves left at par, no spoiler);
  **a picked letter previews the next word in the FIRST rung (Matt, 2026-11-19): the other letters faint grey, the picked spot blank** (none when no rung is left);
  the done screen lights the ladder row by row (60ms, 600ms at most), fills the stars one at a time, THEN pops the heading ("Par!"
  at 3 stars, else "Solved"); at 3 stars a small gold burst behind the stars and a shine across the target row; one progress line (`Medium · 12 of 150`, or the daily's date and a ticking "Next in H:MM:SS" to local midnight
  of `bestNow()`). Next is live at once. Every animation is off under `prefers-reduced-motion`.
- **First-move tip (2026-11-19)**: on a device's first level only, after the auto How to play's Got it, the letter that starts
  the level's par path (`h[1]`) pulses, then its key once that letter is tapped; it ends at the first move. Nothing is picked
  for the player. Shown once (`tip1`), reported via `js/tips-log.js` (`wordladder` / `first-move`; `tools/read-tips.mjs wordladder`).
  Unmissable (re-grade, 2026-11-19): a DASHED bright ring (unlike the selected letter's solid one) that stays on, a pulsing glow,
  and a bouncing arrow above; on a key the arrow is short and sits in the gap above it (still under reduced motion).
- **Daily streak (2026-11-19)**: a small flame (SVG) + number on the Daily button and the daily done card: days in a row with a finished
  daily, by the phone's LOCAL date, per language, ending today (or yesterday while today is open). WORKED OUT WHEN SHOWN from the
  daily save and `wl.dl` (`_streak`), never stored.

## Data (GENERATED: `node tools/build-word-ladder-data.mjs`, never hand-edited)

`data/<en|es>/words.json` (accepted words, 3-6 letters: Word Weaver's grid + extra words PLUS the whole Boggle
dictionary, ENABLE / `boggle/data/words-es.txt`, so every real word is a legal step, rude ones included (2026-11-13,
Matt: ASS was refused, "Yes it is" a word); grid words first, most common first), `levels.json` (500), `daily.json` (730). A level = `{ s, t, p, h }`.
**Par is the true minimum over EVERY accepted word** (so nobody beats it) and a path of that length exists through
Word Weaver's GRID words alone (common, hand-checked) when the level is made; start and target are grid words, the hint path prefers them.
`node word-ladder/js/data-test.js` (~2.5 min) checks every level and day of both languages by breadth-first search.
**Words review (2026-11-19, `CLAUDE-HISTORY.md`)**: Spanish adds verb forms said in films and TV, verb forms with a pronoun
(DEJAME), and every Boggle word's Ñ spelling (`tools/word-ladder-es-forms.txt`, `--fetch-es-forms`); English adds APP, EMAIL,
SELFIE (`ADD_EN`); hand lists `ADD_ES`. **Nothing once accepted is ever dropped.** `--keep-all` keeps every start, target and
number and works out par and the hint path again (14 Spanish levels and 12 dailies got shorter). Rude words sort last; the
hint takes the shortest path whose rarest word is the commonest (`hintFrom`). Accented desktop keys type the plain vowel.
**APPEND-ONLY once released**: progress is by level number. Levels 251-500 were remade ONCE, 2026-11-14 (`--keep-through 250`).
**Remade again 2026-11-19 (Matt: "Yes, remake the levels. Keep whatever points I've earned")**: English 251-500, Spanish 1-100 and
251-500, and 18 future Spanish dailies (days 216-722, par under 3, a rude end, or par only through an obscure word; days 0-7 never),
by `--remake en:251-500,es:1-100,es:251-500 --daily-from 8` (`REMAKE_SPECS`: a rising par and a falling greedy rate across each band,
easiest level first; every par path through Word Weaver words, start and target common, never rude). A remade level or day carries
`v: 2`; the version table is `REMADE` (engine) = `WL_REMADE` (`js/game-stats.js`), checked by both tests. Medium and English Easy
untouched. Before/after numbers: `CLAUDE-HISTORY.md`. Points: "Points and the leaderboard" below.
**A further remake** = the same `--remake` (v becomes 3) and a new `REMADE` row; never reuse a number's key for another puzzle.

## Stats (`wl` sub-counter)

**Remade levels keep what was earned (2026-11-19)**: a result is keyed by its PUZZLE, `wlKey(n, ver)`: `L<n>` = version 1 (every
entry before the remake), `L<n>v2` = the remade puzzle (`recordWordLadder(..., { ver })`, the level's `v`; a save without `ver` = 1).
Old entries are never moved or dropped. `wlLevels(gm)` = each level NUMBER once, its best entry over every version, so the board,
the stars, and the points count an old solve as before and a replay never twice. My Stats: Levels / Stars / At
par per number + "Earlier puzzles" (numbers solved on an old version). The start screen's progress and Play <n> follow the CURRENT
puzzles (`_solved`); a save from an older version never resumes (`cleanAttempt`). A first solve of a remade puzzle is one new play
in `byDiff` (byDiff is not the board). Test: `tools/test-word-ladder.mjs` runs the OLD writer from git (5dd10bc), then this code.
`wl.lv` (English) / `wl.es` (Spanish) `{ 'L<n>' | 'L<n>v<ver>': entry }`, `wl.dl { key: entry }`, entry `{ s, m, p, h, t }` (`wlBest`:
the BETTER attempt kept WHOLE: more stars, then fewer moves, then fewer hints; never one attempt's moves with another's hints,
rule 4; earliest time). First completion = one play + win in its band (`daily` for the
daily). Merged per person in `js/players-agg.js`; shown by `wordLadderScreen` in `js/game-stats-ui.js` (points, levels, stars,
at par = ladder levels in par moves, daily; the rows look `rowsWordLadder`). While admin-only the plays go to the TEST record (`ADMIN_ONLY`).

## Points and the leaderboard (BUILT 2026-11-19, Matt: "Cool. Make sure it's ready to be added to the leaderboard")

`js/word-ladder-points.js` (`WL_POINTS`, `wlPoints`, `wlCleared`): a level pays by band and stars, Easy 1/1/1, Medium 2/1/1,
Hard 3/2/1, Expert 5/3/1 (3/2/1 stars); each level NUMBER once per language at its best over every version (`wlLevels`: old solves
of remade levels at their stored stars); English and Spanish both count; the daily pays 0. Read time, from the merged maps (never
`byDiff`). Board: `gameMetricAt` = `wlPoints`, one number over all bands (`boardTierOf` null), band tabs = bands with a level,
a tie goes to FEWER distinct levels (`boardPlaysOf` = `wlCleared`: the better average). `lb-rules.js` `by: 'points'`; the "See how
scores are calculated" sheet = `lb-rank-sheet.js` `wordladder` (the table, how stars come, the hint cap, once per level, earlier
puzzles, daily 0; EN/ES). "+X pts": a first solve or a better result on a level (`recordWordLadder` announces a stars rise) via
`points-toast.js`; never for a test play. My Stats: unit points, headline `wlPoints`. Integrity: `wordladder-under-par` (moves
under the entry's own par, hints over moves, stars the moves do not give), an ALERT until a snapshot replay shows 0 honest hits.
The server board needs nothing (it runs the same `aggregatePlayers`). Tests: `node tools/test-word-ladder-points.mjs`
(the table, recorders, the pill, phone = server grouping, the board run as if released, the sheet, the alert, still hidden).
**HIDDEN while admin only** (`isGameOnLauncher` false: off every board, no pill). Not built: the proposal's hint-before-finish cap
across phones (`wl.hint`, Word Weaver's `ww.hint`): a hint solve replayed clean on a second phone still pays 3 stars.

**Release checklist (only when Matt says "release it")**: `js/hub.js` entry: drop `devOnly`, add `released`; `js/game-stats-ui.js`
TABS: drop `devOnly`; `js/game-stats.js`: remove from `ADMIN_ONLY`, decide `CARRY_TEST` with Matt (test plays carried or not);
`sw.js` ASSETS every file, `data/**` in LAZY, `node tools/validate-sw-assets.mjs`, bump CACHE. Points, board, sheet, and pill need
no change (they switch on with `isGameOnLauncher`). Run `node tools/test-word-ladder-points.mjs` (its "hidden" checks then fail by
design: flip them).

**Data reaches the phone on the next open (2026-11-13)**: `destroy()` forgets the loaded words and levels, so going back to
the Hub and in again fetches them fresh (the hub keeps this module loaded for the life of the page; before this a phone
kept old data until the app was closed, and Matt's refused LIEN). A data change that must reach admin phones at once also
bumps CACHE (they reload on a new build).

**A save from another puzzle counts nothing (2026-11-13, Matt: "How is this 5 moves? I never used the undo")**: `cleanAttempt`
drops a save whose first word (or stored `s`) is not this level's start, so a remade level or day starts at 0 moves; attempts
now store `s`. Matt's daily that day (KICK LICK LICE LIVE LOVE, saved as 5) is set to 4 moves and recorded again by the
one-time `_repair1113` (his code only, stamp `gamehub.wordladder.repair1113.v1`, verified by re-read; the entry only improves).

## Layout

Night blue in light and dark (bright text). The coach line sits at least 16px under the target (`.wl-msg` margin + `_fit`'s reserve). Row 1 = the Hub button's row: only the level chip. Row 2, 16px under it (10px
on short phones): back arrow (to setup) top left, Moves / Par, How to play. The ladder fits by measurement (`_fit`: tile sizes
from the room; when earlier words do not fit: the FIRST word, a ⋮, then the last ones; the tile shrinks (not under 34px) until
3 earlier words show, so a 360x640 Expert ladder keeps 28-29px earlier tiles with 16px letters; the rungs take what is left).
Tall phones (ladder room over 360px): the big tile grows to 80px (width allowing), leftover room goes to the rungs, then to earlier
words (0.62 up to 0.8 of the big tile); keys 56px tall from 800px high.
Start screen: the title picture is a real ladder (COLD CORD WORD WARD WARM, cold to warm; Spanish MAR MAL SAL SOL; short phones
show the short one, COLD CORD ⋮ WARM / MAR MAL ⋮ SOL, 112px tall, so it reads at 360x640), each
difficulty shows `12/100` and a thin bar. How to play's star rules are a drawn key (Par / +1 / +2 / More, and bulb 0 / 1 / 2+,
each with its stars). Buttons, keys, and tiles have a bottom edge that presses in. The
done screen's ladder (`_fitFinal`, refit on resize) keeps 30-44px tiles and shows the first word, a ⋮ and the last words when it
is too long (2026-11-13 review: an 18-word ladder had shrunk to 16px tiles, 9px letters, and overflowed). **Keys are 10 across like a phone keyboard, so narrower
than 44px** (33px at 360, 37px at 402, edge to edge with 3px gaps; a documented departure from the 44x44 floor; 50px tall).
Hints show as a badge on the bulb and beside Moves/Par on the done card (2026-11-13 UI review: a 1-star finish at par read
as a bug). How to play says Undo counts as a move. The star total on the start screen hides at 0. A finished, RECORDED save
is kept as saved even if a word later leaves the list. **The daily is the day it is OPENED on**: a ladder half done at
midnight stays saved under its day but the Daily button then opens the new day (not finishable after; kept simple).

## Tests

`node word-ladder/js/data-test.js`, `node tools/test-word-ladder.mjs` (recorders, merge, board count, stars = engine), `node tools/test-game-conventions.mjs`, `node tools/test-game-modes.mjs`,
`node tools/test-i18n-strings.mjs`, `node tools/players-agg.test.mjs`, `node tools/test-lb-rules.mjs`, `node tools/test-word-ladder-points.mjs`.
The localhost-only seam `window.__wlTest` (`state()`, `type(word)`, `hint()`, `undo()`, `redo()`, `key(L)`, `pick(i)`).

## The private play log (2026-11-19, Matt: "make sure all the game info and guesses ... errors and undos are tracked")

Admin-only `playLog/<CODE>` `x` (read: `node tools/read-play-log.mjs <CODE>`); never in the stats store, never shown. `detail`
(public, summed) stays `{ moves, par, hints }`. Entries (`e`): the finished level or daily (the withMode `log`, with `m`/`d`);
`left` = an unfinished attempt when the level is left (start screen, Hub, app closed; cumulative, the last one is the latest);
`abandon` = never finishable (`why`: `replaced` = its puzzle was remade, `day-over` = an earlier daily, logged once, `ab` stamped).
`left`/`abandon` go through `logPlayData` (count for nothing), `k` = `<lang>:<n>` or the day key. `x` = `{ kind, ver, key, n, lang,
band, start, target, par, path (the hint path), chain, moves, hints, stars, redo, secs (active), wall (ms since first open), away
(ms hidden or gone), res, cut, seq, why? }`. `seq` = every action, `<code>[:<arg>]@<ms since the attempt began>`: `p<i>` letter
picked (`p<i>a` by arrow key), `k:<L>` on-screen key, `K:<L>` keyboard key, then its outcome: `w:<WORD>` a step, `x:<WORD>` not a
word, `o:<WORD>` not one letter, `n` no letter picked, `=` same letter; `u:<WORD>` undo (word taken off), `r:<WORD>` Redo,
`R:<WORD>` the undone word retyped (a Redo), `h:<WORD>` hint (`h0` none), `?` / `?-` How to play opened / closed, `v-` / `v+:<ms>`
app hidden / back, `L` left the level, `B:<ms>` back after ms away, `T` first-move tip shown, `F` finished. The attempt's save keeps
its `log` (last 1,500 entries, `cut` counts dropped ones) so one attempt is one log across visits; `x` is trimmed oldest first
to 20,000 characters. Proof: the dev-server play in `CLAUDE-HISTORY.md` (2026-11-19) saw every code land.
