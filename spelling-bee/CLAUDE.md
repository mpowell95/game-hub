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
(22,045; hints and ranks count only these); `extra` = 376 HAND-CHECKED words (2026-10-26, Matt: CRATCH, CRANCH, ANNA, CARL "aren't words"/"so many names": ENABLE ∩ SCOWL 70, no first names, read one by one into `BONUS_KEEP`; 2026-10-28 +123 incl. FUNGO, AGLET, and a kept word no longer needs the subtitle count). English stays hand-checked on purpose: 7 days of `beeLog` showed no real word refused (Spanish did, GONADA), accepted
and scored as a BONUS word (italic in the found list, toast "Bonus word!", the How to Play line "Italic = bonus, not in hints"), never counted. No S, ≤7 distinct letters, bad words
out of both, EXCEPT `ADULT_KEEP` (2026-10-29, Matt, refused VAGINA: "Words like this and profanity should count"): ~80 hand-checked adult words and profanity are BONUS words (never answers, so never in hints or Yesterday's Answers); slurs stay out (RAPE, PEDOPHILE count: Matt, "they would all count in scrabble"). Size 50 gave 22-word days and refused DUGONG; size 70 made CEORL, ORLE answers. Queen Bee needs
every answer (bonus points can pass the total). 2,000 puzzles from epoch 2026-10-22, 25-90 answers, median 51.
Append-only, EXCEPT `REPLACE` (2026-10-26, Matt: "I hate today's puzzle"): Oct 24, 26, 28 (33, 23, 28 words)
swapped once for 64, 55, 63. The old letters are in `retired` (day -> letters); anyone with words on one sees it
as a row under the calendar and can keep playing it (`_startDay(n, old)`), so no progress is hidden (rule 1).
A puzzle that reached Genius under the old list still shows at least Genius (`rank()`, rule 2). A word found under an older list keeps counting (`legal()` in ui.js; checkWord says Already found).
**Spanish (2026-10-26, Matt)**: `data/bee-es.json` from `tools/build-spelling-bee-es.mjs` (read its header); the
puzzle language is the in-game **EN/ES button** (2026-10-27, Matt; `gamehub.spellingbee.lang.v1`, per phone, words only, screens keep the hub's language), else the hub's EN/ES setting. The **board shows both languages** as two sections, the one being played first (`_watchOther`). A past day's date sits over the rank (the HUD has no room). Answers = top 20,000 subtitle words in
lemmatization-lists (conjugations count), ~46 a puzzle; bonus = EVERY other dictionary word and conjugation (2026-10-28, Ana: GONADA, "normal words ... not registered"; it used to need the subtitle list too, refusing DONDE, LUNA, ENELDO), plus common words Boggle's list lacks (DEDO), no names (`NAME_WORDS` keeps LUNA, CLARA), only words some puzzle can make (48,386, 134 KB gz). **No accents anywhere; Ñ is its own
letter** (Ana: "Ñ is different from n... for the rest do not use accents"): words are stored without accents and with
ñ, typing á gives a, ñ stays ñ; 13 puzzles have Ñ in the hive. Board keys write Ñ as `0` (ASCII rule). Keys
`es:<c>:<outer>` (save and board never meet English). Epoch 2026-10-26, 1,493 puzzles. The first build folded Ñ to N;
its day 0 (`o:aeimnt`) is `retired`, still playable. Names out of the answers (`NOT_ANSWERS`), vulgar families out of the answers (`BLOCK_RE`); since 2026-10-29 every blocked word is a BONUS word (as English), except `SLURS`.
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
| Stats id | `spellingbee`: **one PLAY per day per language with a word found** (2026-10-28, Matt: "Why would you only count it if someone reaches Genius?"; `countDays`, save `days: {"en:<day>": 1}`, on every open and word, so earlier days count from each phone's own save), Genius = that play's WIN (`recordSpellingBeeGenius`, won only). Before 2026-10-28 only Genius was recorded (played+won together, save `recorded`); such a day is only marked. Flags set only after the recorder returned. In `GAMES`, `GAME_META`, `TABS` + `HUB_ID`, `SOLO`, label `game_title_spellingbee` |
| Voided day (2026-10-27, Matt) | `VOIDED_MATCHES.spellingbee` in `js/stats-corrections.js`: King of Games (`3VN33`), Oct 26 (`a:chlnrt`), Oct 27 (`a:ciltuy`) and Oct 28 (`e:abcdhu`) English; `keepPlayed`: each still counts as played, only the Genius win comes out. **On the in-game board (since 2026-10-28) others see that day as played, 0, last; his own phone still shows his row unchanged** (the earlier "he should still appear here with his score", 2026-10-27, was replaced by Matt the next day); his Genius win comes out of the hub Leaderboard (`daily`; his phone notes it, `noteVoidedDays`, on its next Spelling Bee open). Read time only: save and `beeDaily` row untouched. **Any long-term Spelling Bee board (mockup B: words, points) must leave that day out for him via `voidedCodesFor`.** |
| CSS | `.sb-root` / `.sb-` |
| Save key | `gamehub.spellingbee.save.v1`: `{ v, games: { "<centre>:<outer>": { day, found: [in order found], recorded, seenGenius, seenQueen } }, days: { "<en|es>:<day>": 1 } }`. Found words only grow; nothing is ever removed |
| `isInProgress()` | always `false`: every word saves at once |
| Daily board (2026-10-26, Matt) | `js/board.js`: `beeDaily/<c-abcdef>/<CODE>` = `{name, emoji, words, points, rank, at}`, posted 2.5 s after a word (and on open if behind; `gamehub.spellingbee.posted.v1` = last verified count). Rules: own msgAuth code only, `words` never goes down. Watched while the puzzle is on screen. Trophy = the board (2026-10-26 redesign, Matt: "This is bad": place, emoji, name, a bar toward Genius (🧠/🐝 at its end at Genius/Queen Bee; the bee moved to Queen Bee 2026-10-27, Matt: "Obviously a bee should be the highest award"), words over points (Matt: "I wanna see how many points they have too"; no rank word, too tight at 360 wide); own row yellow; title "Today"); the progress row = Rankings. A report of the save, never the save. Test accounts hidden (`isHiddenName`). **Play times (2026-10-27, Matt: "Just record when he plays")**: the save keeps `times: {word: ms}` and `geniusAt`; the board row carries `t0` (first word), `tg` (Genius), `ts` (seconds after t0, comma list). Never shown in the game; `node tools/read-bee-times.mjs [name]` reads them. **Every guess and action (2026-10-27, Matt: "Record every guess he makes. Correct or not... Everything.")**: `js/log.js` queues `{t, e, w, r}` in `gamehub.spellingbee.log.v1` and sends batches to `beeLog/<puzzle>/<CODE>/<t>-<n>` (+ server time `s`): guess (typed letters + ok/bonus/refusal + `k` typing ms), open, close, hidden, visible, each sheet opened and closed (`shut`), list, shuffle, lang, Delete (`del`). **Nothing is skipped (Matt, 2026-10-29)**: no queue cap; the server checks every logged day hourly, every code with a log. Retried until sent; same key on retry. `read-bee-times.mjs --log [--words]` (accepted words masked by default: no spoilers). `BOARD_ONLY` in `tools/test-game-conventions.mjs` (no match, so no chat) |

**Fair play (2026-10-28, spec `docs/SPELLING-BEE-INTEGRITY-SPEC.md`)**: a puzzle counts only on its OWN day (Matt: "you have
to do it on the correct day"; `onDay`/`dayWords` in ui.js, by each word's time; no time = on the day): `countDays`, the Genius
win and the board row's `dw`/`dp`/`dr` (own-day words/points/rank) use only those. The in-game board sorts by POINTS
(`byPoints`), shows everyone else's own-day numbers (`shownRows`), and a VOIDED row (`voidedOn`: code list + server
`beeFlags/<puzzle>/<CODE>` - Matt's admin undo `adminConfig/v1/bee/undo/<puzzle>/<CODE>`) as played, 0, last. **A void never
touches the viewer's own row** (silence: the cheater's phone looks unchanged). **Your OWN row shows own-day numbers too (2026-10-30, Matt: "Fix it permanently"): every phone shows the same board.** Lili's phone counted 7 next-day words (486) and put her 1st; Ana's showed Lili's on-day 428 and Ana 1st (434). `tools/test-bee-fairplay.mjs`.
**Matt's settled view of fair play (2026-10-29, "what I've been telling you over and over... across multiple sessions"):
(1) the STRONG checks (sorted run, best words first) are what catch real copying, and they did (King of Games, Oct 28);
(2) NO "copied from another player" check: Matt, "irrelevant and unnecessary"; do not propose it again;
(3) speed alone means nothing for fluent players (Lili, Ana): fast streaks stay one of three supporting checks that must
ALL happen together. Do not re-propose weaker or extra checks; report the numbers and stop.**
**The server (`functions/bee.js`, `beeWatch` every 5 min)**: runs `js/bee-fairplay.js` `detectCopying` on yesterday/today/tomorrow's logs every 5 min and on EVERY logged day hourly
(**re-evaluated 2026-10-29, Matt: "You can't void everybody": strong = sorted run, best words first; supporting = burst, speed, re-typed, ALL THREE needed; leave and right vs wrong retired; every stored flag re-judged by `verdict`/`flagStands` from its saved numbers**; the original 7 checks, spec section 5: strong = sorted run, no-miss burst, best words first; any two supporting = back+5 in 60 s, Genius under 10 min from opening the puzzle (clock time, NOTHING skipped: Matt, 2026-10-29),
re-typed under 1 in 10 (right vs wrong RETIRED 2026-10-29: Ana, honest beside Matt, 30 right / 12 wrong was voided; a stored flag resting on it stops counting at read time, `flagStands`, used by the board, the server's board and the admin page); the last two added 2026-10-28 with best words first, from King of Games' Oct 28 log); a flagged
day is written ONCE to `beeFlags/` and pushed to admins; missing-log alerts (`beeAlerts/`) push only. `boards/v1/bee` (JSON string,
`buildBeeBoard`) = the long-term board (own day, voids, places by points). `tools/test-bee-server.mjs`.
**The server's clock (2026-10-29, `docs/INTEGRITY-CHECKS-SPEC.md` "Holes closed 2026-10-29")**: "today" and word times come from
`js/server-time.js`; **Yesterday's Answers opens only on this page's LIVE server time** (`answersShown`; offline = "No connection").
Log entries carry `z` (time zone). The server counts a word for its day only if sent within 24 h of its phone time and by that day's
midnight + 10 min; a full log (or a post over a day late, `isLatePost`) decides the row (`boards/v1/beeOwn`, read by the in-game board
too); the phone's `dw` stays stored. Late posts are not sent. Never let a phone clock decide a day again.
**Hub Leaderboard + My Stats (2026-10-28)**: Spelling Bee's numbers come from that board (`js/bee-board.js`): `leaderboard-ui.js`
`gameMetricAt`/`boardPlaysOf`/`lbUnitKeyOf` read it (so By Game and the You tab match), toggles Points | Words and All | English |
Español (`beeTabsHTML`), 🥇🥈🥉 · 🧠 · 🐝 · 📅 under each name; My Stats `spellingBeeScreen`. No board yet = the stats record, as before.
**Admin page, "Spelling Bee flags" (2026-10-28)**: every server flag with its rules and Undo / Void again (`setBeeUndone` ->
`adminConfig/v1/bee/undo/<boardKey>/<CODE>`; `beeOnUndo` rebuilds the board), the hand-voided days read only, log gaps folded.

**Never show Matt answer words** (2026-10-28, Matt: "I don't want to see the words tho!"): reading a log or board for him, run `read-bee-times.mjs` WITHOUT `--words` and report lengths/patterns only, even if he asks to "see the words"; confirm first.

## Tests

`node spelling-bee/js/test.js` (engine + every puzzle in the data is fair); `node tools/check-no-scroll.mjs
spelling-bee` (board, open list, each sheet); `window.__sbTest = { ui, answers, submit(word) }`.

## Yesterday's Answers, stamped (2026-10-29, second pass)

A phone in a zone a day ahead saw the Americas' today as "yesterday". Opening Yesterday's Answers now logs `answers` under THAT puzzle and shows them only once the server has it (`log.js logConfirmed`); no word for that puzzle sent after counts, and such a log always decides the row (`js/bee-fairplay.js answersSeenAt`). A zone moving more than an hour in one puzzle's log is an alert (`zoneShifts`, `beeAlerts/<puzzle>/<CODE>~zone`), never a void. Chosen over "answers once the day is over everywhere" (Spain would wait until early afternoon). Spec: `docs/INTEGRITY-CHECKS-SPEC.md`, "Holes closed 2026-10-29 (second pass)"; `node tools/test-puzzle-holes.mjs [--browser]`.
