# Spelling Bee — history

## 2026-10-23: built

Matt: "Build a clone of the NYT Spelling bee game. An exact clone. There's an app called wordscapes
that's similar too." Built the NYT game admin only. Wordscapes was not built (a different game:
crossword grid, letter wheel, levels); it would be its own folder if wanted.

## 2026-10-23: the word list grew (ROVER)

Matt, with a screenshot of "Not in word list" on ROVER: "Why isn't Rover on the list of words? That's a word."
SCOWL size 40 was too strict; ROVER is size 50. Moved to size ≤50 (14,439 -> 18,646 words). The puzzle
order was kept (the generator now appends only), so today's puzzle stayed the same and gained ROVER, VOLE,
ALOE, LOCO, CAROLER, ALLOVER, COEVAL, COROLLA, OLEO, ROCOCO. More answers means a higher total, so the rank
shown for a puzzle in progress can drop; a Genius already recorded stays recorded.

## 2026-10-28: Spanish bonus list widened (Ana: "some normal words are not registered")

Ana (and Lili) sent a screenshot: GONADA refused on puzzle `n:adeglo`. Cause, in `tools/build-spelling-bee-es.mjs`:
a bonus word had to be in Boggle's dictionary AND the 50k subtitle list AND lemmatization-lists, so ~30,000
dictionary words (GONADA, ENELDO, ALDEANO, FLEMA) and some very common ones (DONDE, ADONDE, AQUI: not lemmas)
were refused; the names filter also refused LUNA, CLARA, PALOMA, JULIO, ALLI (now `NAME_WORDS`). Boggle's list
itself lacks DEDO, RODILLA, TORTILLA: lemmatization-lists words also in subtitles are now bonus too, minus
English-only words (`SPANISH_TOO` keeps tortilla, yoga...) and `SKIP` (rude, slang, places). Answers and puzzles
unchanged (verified byte-equal); no playable bonus word lost. Bonus list 6,069 -> 48,386, trimmed to words some
puzzle can make (476 KB, 134 KB gzipped, was 40 KB). Checked against `beeLog`: every real word refused in the
three Spanish days logged is now accepted; what is still refused is typos and names.

## 2026-10-28: English bonus list, after the Spanish fix (Matt: "do what you think is best")

Checked first: 7 days of English `beeLog` had 65 refused guesses, only 3 dictionary words (HADE, CADE, YUCA, all
obscure), because English has 22,045 answers (Spanish 6,317). So English keeps its hand-checked `BONUS_KEEP`
(opening it to all of ENABLE would bring back CRATCH, CRANCH, HANT). Two changes: a kept word no longer also needs
50+ subtitle mentions (FUNGO, said 7 times, had stayed refused although the header named it), and the 824 SCOWL-70
words said 10-49 times were read; 123 recognisable ones added (AGLET, FUNGO, TAHINI, LATKE, GOOGOL...). 253 -> 376.
Answers and puzzles byte-identical.


## 2026-11-01: past days look-only, missed days for fun

Matt: "Can players play previous days in spelling bee right now? I don't think they should be able to." Until now any
past day was fully playable (late words never counted, `onDay`, but the day could be played after its answers were out).
Mockup (`docs/mockups/spelling-bee-past-days.html`) approved with: played days look-only with every word and bonus word,
yours ticked; missed days "play for fun" behind a popup (Matt's wording request: "doesn't count towards your stats or the
leaderboard"); answers hidden while playing for fun but available any time from the eye; that day's leaderboard shown
with the for-fun score clearly not counting; "no for fun playing on past days you actually played"; the Bonus list may
scroll (Spanish days have up to ~200+ bonus words). Built the same day.

## 2026-11-03: past days' boards were unreachable

Lili reported she could not see the scores for previous days. The 2026-11-01 rework made a past day you played
look-only (`_renderReview`), and that screen's top bar had only EN/ES, the calendar and How to Play: no trophy, so
no way to open that day's board (only a never-played day, opened for fun, still had it). The trophy is back on the
look-only screen. `_boardSection` now treats a for-fun day by `this.fun`, not the mode, so a for-fun day whose
answers were seen still shows its own row unplaced and dashed rather than as a real placed row.


## 2026-11-15: the Nov 14 voids (Ana's bug report, "The leaderboard doesn't get updated (only my score)")

Ana's Today board (v1574, Nov 14 1:43 PM ET) showed Lili 0 (Español), MattyIce 0 and King of Games 0 (English):
the "played, 0" look of a voided row, read as "not updating". Three server flags that day (`beeFlags`):
- `g-bhimnu` MattyIce "Best 5 first", King of Games "Best 6 first". The puzzle has 26 answers, 14 of them worth
  exactly 7 points (-ING words), so the bar (6th best still unfound, min 7) was met by over half the answers: any
  five long words in a row tripped a STRONG rule. Fix: `detectCopying` skips a window when the answers at or above
  the bar are over a third of those unfound (`RULES.bestShare`, `puzzle.n` from `bee-puzzles.json`).
- `es-a-dilnoz` Lili "Burst 13 at 5.1 s, Genius in 5.1 min, Re-typed 2": written at 3:00 AM from her first ~40
  words. Her whole day: 118 right, 151 re-typed, so the third supporting rule never held. Flags were written once and
  never re-checked against the log. Fix: `checkPlayer` re-judges every flag on the whole log each pass (the hourly
  pass covers every logged day), storing the result in `beeFlags/<puzzle>/<CODE>/re` only when it changes;
  `flagStands` reads `re` when present. The flag's own numbers stay (rule 5).
Replay over every logged puzzle 2026-10-27..2026-11-15 (real `beeLog`): old rules void 3 player-days (KoG Oct 28,
KoG Nov 14, MattyIce Nov 14); new rules void only KoG Oct 28 (sorted run 7 + best 6 + all supporting).
