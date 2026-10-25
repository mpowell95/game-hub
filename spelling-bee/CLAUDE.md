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

`data/bee.json` from `tools/build-spelling-bee-data.mjs` (read its header): SCOWL size ≤50 English +
American ∩ ENABLE, no S, ≤7 distinct letters, bad words out (18,646 words); 2,000 puzzles from epoch
2026-10-22 (picked when the list was size ≤40: 20-60 answers; now 21-84, median 45), each with a pangram.
**Size 40 refused ROVER** (Matt, 2026-10-23: "That's a word"); 50 is where everyday words like it are.
A re-run KEEPS the shipped puzzle order and only appends. Answers are computed on the phone.
**The puzzle order is append-only** (changing it changes "today" for everyone). Credits: `data/CREDITS.md`.
`sw.js` already lists `bee.json` in the LAZY regex; **at release add the game's files to ASSETS**
(none are listed while devOnly) and the data file stays LAZY.

## Screens

HUD (beside the hub button): Past puzzles (calendar), Hints, Yesterday's Answers, Rankings, How to Play. Progress row (tap =
Rankings), the found-words bar (tap = the whole list, alphabetical, columns fit by measurement), the
input (centre letter yellow, wrong letters grey), the hive, Delete / shuffle / Enter. Keyboard:
letters, Backspace, Enter, Space = shuffle. Hints show what is LEFT (grid + two-letter list).
Genius and Queen Bee each pop once per puzzle (`seenGenius` / `seenQueen`).
**Past puzzles (Matt, 2026-10-25)**: a month calendar, epoch to today; tap a day to play it (`_startDay(n)`). Same save
record per puzzle, same one Genius win per puzzle. The HUD shows the date while on a past day; Yesterday's Answers is
relative to the puzzle shown (hidden on day 0). Opening the game always starts on today.

## Hub integration

| Thing | Value |
|---|---|
| Registry | `module: '../spelling-bee/js/ui.js'`, `immersive: true`, `devOnly: true`, hub id `spelling-bee`, no `released` date |
| Stats id | `spellingbee`: `recordResult('spellingbee', 'daily', true)` once per puzzle that reaches Genius (save's `recorded` flag, set only after the recorder returned). In `GAMES`, `GAME_META`, `TABS` + `HUB_ID`, `SOLO`, label `game_title_spellingbee` |
| CSS | `.sb-root` / `.sb-` |
| Save key | `gamehub.spellingbee.save.v1`: `{ v, games: { "<centre>:<outer>": { day, found: [in order found], recorded, seenGenius, seenQueen } } }`. Found words only grow; nothing is ever removed |
| `isInProgress()` | always `false`: every word saves at once |

## Tests

`node spelling-bee/js/test.js` (engine + every puzzle in the data is fair); `node tools/check-no-scroll.mjs
spelling-bee` (board, open list, each sheet); `window.__sbTest = { ui, answers, submit(word) }`.
