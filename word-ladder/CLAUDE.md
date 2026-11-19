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
| Saves | `gamehub.wordladder.save.v1` `{ '<lang>:<band>': attempt }` (+ the old `en`/`es`, kept); `gamehub.wordladder.daily.v1` `{ v:1, d: { '<en|es>-<YYYY-MM-DD>': attempt } }`; attempt = `{ v, n, s, p, chain, moves, hints, done, recorded }` (older saves also carry an unread `sel`) |
| `isInProgress()` | always `false`: every move is saved, leaving is lossless |

## Rules (`js/engine.js`, pure)

- Tap a letter of the current word (gold outline + caret), then a key. **Nothing is picked until the player taps a letter**,
  at the start and after every move or undo (Matt, 2026-11-14: "Don't default to have the first letter selected"); a key before
  that shakes the word and says "Tap a letter first". The new word must change exactly that one
  letter and be on the word list, else "Not a word" and a shake. A letter already right (same as the target's at that
  place) is a SOLID BRIGHT GREEN tile (`--wl-match` #22b84f; "make it a better green", 2026-11-14), nothing else (Matt, 2026-11-14: "Just make it green"; a dot under the letter and
  then a folded corner were both rejected; his call over the shape-plus-colour rule), its letter NAVY (6.2:1; white was 2.6:1, 2026-11-19). The target row has dashed gold tiles and a flag.
- **Moves count every change, Undo too** (an undo is a move back). Par = the fewest changes possible.
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
- Desktop: letters type, ← → move the caret, Backspace = Undo.
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
  outline; dashed empty rungs between the word and the target = par - moves - 1, never below 0 (moves left at par, no spoiler);
  the done screen lights the ladder row by row (60ms, 600ms at most) then fills the stars one at a time; heading "Par!" at 3 stars,
  else "Solved"; one progress line (`Medium · 12 of 150`, or the daily's date and a ticking "Next in H:MM:SS" to local midnight
  of `bestNow()`). Next is live at once. Every animation is off under `prefers-reduced-motion`.
- **First-move tip (2026-11-19)**: on a device's first level only, after the auto How to play's Got it, the letter that starts
  the level's par path (`h[1]`) pulses, then its key once that letter is tapped; it ends at the first move. Nothing is picked
  for the player. Shown once (`tip1`), reported via `js/tips-log.js` (`wordladder` / `first-move`; `tools/read-tips.mjs wordladder`).

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
**Open (proposal only)**: English Expert's par needs a non-Word-Weaver word on 78-98% of levels; Spanish 451-500 54%;
`docs/WORD-LADDER-POINTS-PROPOSAL.md` (points, not built).
**APPEND-ONLY once released**: progress is by level number. Levels 251-500 were remade ONCE, 2026-11-14 (`--keep-through 250`:
1-250 and every daily untouched), for the 5- and 6-letter difficulties; Expert's middle steps may be any accepted word (`anyPath`;
6-letter grid words rarely chain), its start and target stay common.

## Stats (`wl` sub-counter)

`wl.lv` (English) / `wl.es` (Spanish) `{ 'L<n>': entry }`, `wl.dl { key: entry }`, entry `{ s, m, p, h, t }` (`wlBest`:
the BETTER attempt kept WHOLE: more stars, then fewer moves, then fewer hints; never one attempt's moves with another's hints,
rule 4; earliest time). First completion = one play + win in its band (`daily` for the
daily). Merged per person in `js/players-agg.js`; shown by `wordLadderScreen` in `js/game-stats-ui.js` (levels, stars,
at par = ladder levels in par moves, daily). While admin-only the plays go to the TEST record (`ADMIN_ONLY`). Leaderboard rule
`solves` (`js/lb-rules.js`); the board number is `wlSolved` (DISTINCT levels from the merged maps, both languages, by band via
`wlBandOf`), never `byDiff` wins: a second phone starts at level 1 and would count a level twice. No points yet (proposal: `docs/WORD-LADDER-POINTS-PROPOSAL.md`). No integrity
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

Night blue in light and dark (bright text). Row 1 = the Hub button's row: only the level chip. Row 2, 16px under it (10px
on short phones): back arrow (to setup) top left, Moves / Par, How to play. The ladder fits by measurement (`_fit`: tile sizes
from the room; when earlier words do not fit: the FIRST word, a ⋮, then the last ones; the tile shrinks (not under 34px) until
3 earlier words show, so a 360x640 Expert ladder keeps 28-29px earlier tiles with 16px letters; the rungs take what is left).
Start screen: the title picture is a real ladder (COLD CORD WORD WARD WARM, cold to warm; Spanish MAR MAL SAL SOL), each
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
`node tools/test-i18n-strings.mjs`, `node tools/players-agg.test.mjs`, `node tools/test-lb-rules.mjs`.
The localhost-only seam `window.__wlTest` (`state()`, `type(word)`, `hint()`).

Private play data (2026-11-16): logs start, target, chain, every try (valid, invalid, hint, undo) with time via withMode `log` / logPlayData.
