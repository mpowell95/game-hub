# Spelling Bee — game documentation

> **THE LAW applies here.** Player data is never deleted, never lost, never put at risk. THE LAW
> and its nine working rules live at the top of the root `CLAUDE.md`, which is always loaded
> alongside this file. Nothing below overrides them.

**Keep this file short.** A new rule goes here in one or two lines; the story behind it goes in `CLAUDE-HISTORY.md`.

A clone of the NYT Spelling Bee (Matt, 2026-10-23: "An exact clone"). One puzzle a day, the same for
everyone (local midnight). Seven letters in a honeycomb; every word uses the yellow centre letter.

## Rules (engine.js, pure)

- 4+ letters, centre letter required, letters repeat. 4 letters = 1 point, longer = 1 per letter,
  pangram (all 7) +7. Praise: Good! (4), Nice! (5-6), Awesome! (7+), Pangram!
- Ranks at the NYT shares of the total, rounded: Beginner 0, Good Start 2, Moving Up 5, Good 8,
  Solid 15, Nice 25, Great 40, Amazing 50, Genius 70, Queen Bee 100 (%). Queen Bee stays hidden in
  Rankings until reached.
- Refusals in NYT order: Too short, Too long (>19), Bad letters, Missing center letter, Not in word
  list, Already found.

## Data (GENERATED, never hand-edit)

`data/bee.json` from `tools/build-spelling-bee-data.mjs` (read its header). **Two lists (2026-10-26, Matt:
"Obviously all words should count")**: `words` = the answers, SCOWL size ≤60 English + American ∩ ENABLE
(22,045; hints and ranks count only these); `extra` = 253 HAND-CHECKED words (2026-10-26, Matt: CRATCH, CRANCH, ANNA, CARL "aren't words"/"so many names": ENABLE ∩ SCOWL 70 ∩ said 50+ in subtitles, no first names, then read one by one into `BONUS_KEEP`), accepted
and scored as a BONUS word (italic in the found list, toast "Bonus word!", the How to Play line "Italic = bonus, not in hints"), never counted. No S, ≤7 distinct letters, bad words
out of both. Size 50 gave 22-word days and refused DUGONG; size 70 made CEORL, ORLE answers. Queen Bee needs
every answer (bonus points can pass the total). 2,000 puzzles from epoch 2026-10-22, 25-90 answers, median 51.
Append-only, EXCEPT `REPLACE` (2026-10-26, Matt: "I hate today's puzzle"): Oct 24, 26, 28 (33, 23, 28 words)
swapped once for 64, 55, 63. The old letters are in `retired` (day -> letters); anyone with words on one sees it
as a row under the calendar and can keep playing it (`_startDay(n, old)`), so no progress is hidden (rule 1).
A puzzle that reached Genius under the old list still shows at least Genius (`rank()`, rule 2). A word found under an older list keeps counting (`legal()` in ui.js; checkWord says Already found).
**Spanish (2026-10-26, Matt)**: `data/bee-es.json` from `tools/build-spelling-bee-es.mjs` (read its header); the
puzzle language follows the hub's EN/ES setting (switching reloads). Answers = top 20,000 subtitle words in
lemmatization-lists (conjugations count), ~46 a puzzle; bonus = other forms in the 50k subtitle list, no names (6,069). **No accents anywhere; Ñ is its own
letter** (Ana: "Ñ is different from n... for the rest do not use accents"): words are stored without accents and with
ñ, typing á gives a, ñ stays ñ; 13 puzzles have Ñ in the hive. Board keys write Ñ as `0` (ASCII rule). Keys
`es:<c>:<outer>` (save and board never meet English). Epoch 2026-10-26, 1,493 puzzles. The first build folded Ñ to N;
its day 0 (`o:aeimnt`) is `retired`, still playable. Names out of the answers (`NOT_ANSWERS`), vulgar families out (`BLOCK_RE`).
Credits: `data/CREDITS.md`. `bee.json` and `bee-es.json` stay LAZY in `sw.js`.

## Screens

HUD (beside the hub button): Past puzzles (calendar), Hints, Yesterday's Answers, Rankings, How to Play. Progress row (tap =
Rankings), the found-words bar (tap = the whole list, alphabetical, columns fit by measurement), the
input (centre letter yellow, wrong letters grey), the hive, Delete / shuffle / Enter. Keyboard:
letters, Backspace, Enter, Space = shuffle. Hints show what is LEFT, titled "Left to find" (Matt could not tell, 2026-10-26).
How to Play = the hive + four short lines (Matt, 2026-10-26: "Too. Many. Words."). Genius and Queen Bee each pop once per puzzle (`seenGenius` / `seenQueen`).
**Type-ahead (2026-10-26)**: typing during the accepted/refused feedback ends it at once (`_feedback`/`_settle`); it used to swallow the next word's first letter.
**Past puzzles (Matt, 2026-10-25)**: a month calendar, epoch to today; tap a day to play it (`_startDay(n)`). Same save
record per puzzle, same one Genius win per puzzle. The HUD shows the date while on a past day; Yesterday's Answers is
relative to the puzzle shown (hidden on day 0). Opening the game always starts on today.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../spelling-bee/js/ui.js'`, `immersive: true`, hub id `spelling-bee`, **released 2026-10-26** (Matt switched it live for Ana; release commit same day, IMPORTANT_SINCE 1249) |
| Stats id | `spellingbee`: `recordResult('spellingbee', 'daily', true)` once per puzzle that reaches Genius (save's `recorded` flag, set only after the recorder returned). In `GAMES`, `GAME_META`, `TABS` + `HUB_ID`, `SOLO`, label `game_title_spellingbee` |
| CSS | `.sb-root` / `.sb-` |
| Save key | `gamehub.spellingbee.save.v1`: `{ v, games: { "<centre>:<outer>": { day, found: [in order found], recorded, seenGenius, seenQueen } } }`. Found words only grow; nothing is ever removed |
| `isInProgress()` | always `false`: every word saves at once |
| Daily board (2026-10-26, Matt) | `js/board.js`: `beeDaily/<c-abcdef>/<CODE>` = `{name, emoji, words, points, rank, at}`, posted 2.5 s after a word (and on open if behind; `gamehub.spellingbee.posted.v1` = last verified count). Rules: own msgAuth code only, `words` never goes down. Watched while the puzzle is on screen. Trophy = the board (2026-10-26 redesign, Matt: "This is bad": place, emoji, name, a bar toward Genius (🐝/👑 at its end at Genius/Queen Bee), words over points (Matt: "I wanna see how many points they have too"; no rank word, too tight at 360 wide); own row yellow; title "Today"); the progress row = Rankings. A report of the save, never the save. Test accounts hidden (`isHiddenName`). `BOARD_ONLY` in `tools/test-game-conventions.mjs` (no match, so no chat) |

## Tests

`node spelling-bee/js/test.js` (engine + every puzzle in the data is fair); `node tools/check-no-scroll.mjs
spelling-bee` (board, open list, each sheet); `window.__sbTest = { ui, answers, submit(word) }`.
