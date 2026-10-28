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
