# Word Ladder: CLAUDE-HISTORY.md

The story behind the short rules in `word-ladder/CLAUDE.md`. Append a dated section; never rewrite one.

## 2026-11-19: review (words, difficulty steps, points proposal, bugs)

Matt: "Have an agent review Word Ladder again. Do test plays. Make sure all the English and Spanish words that should
count, actually do. Make sure the difficulties are appropriate steps up. Propose the point system. Fix all bugs."

**Words.** Measured against the 5,000 words most said in films and TV (FrequencyWords 2018), 3-6 letters: English refused
308 of 3,076 (10%), almost all names (GEORGE), contraction pieces (DIDN), and new words ENABLE lacks (ONLINE, EMAIL, APP,
SELFIE); Spanish refused 397 of 2,536 (15.7%), and besides names: GUSTA, SIENTO, PIENSA, SEÑORA, HABLAN, LEE, CIERRA,
DEJAME, VERTE, PONTE (Boggle's RLA-ES list keeps no conjugated verb, by design for Boggle, and folds Ñ to N). After:
Spanish refuses 292 (11.5%), the real words left being names and English; of the top 20,000, 2,509 refused before and
2,031 after. Spanish gained 1,401 words (22,143 to 23,544), English 18. Decisions: accents never matter (the lists and keys
have none; a desktop's á types A), Ñ is its own letter and its own key. The folded N spellings (SENOR, ANOS) stay
accepted: dropping any accepted word can break a saved ladder or LENGTHEN a par (a first run that dropped COLANA raised
level 499 from 6 to 7). Rude forms read for the hand list (CAGON, COÑAZO) were left out after one became a hint shortcut
(level 332).

**Pars that changed** (all shorter, all Spanish; start, target, and number unchanged; English unchanged; the dailies are
all in 2027 and later, day 0 = 2026-11-13):

- level 240 LATA->GIRO: 5 -> 4
- level 260 DEBES->MATAR: 6 -> 5
- level 310 MIREN->DIGAN: 4 -> 3
- level 349 POBRE->TONTO: 6 -> 5
- level 356 CALMA->HABLO: 5 -> 4
- level 386 SOBRA->HABIA: 4 -> 3
- level 403 VUELVE->SUELTO: 4 -> 3
- level 404 SABRAN->SALGAN: 5 -> 3
- level 415 HARIAN->SALVAR: 6 -> 5
- level 461 SABIAN->HALLAR: 5 -> 4
- level 470 SABRAN->HABLAR: 4 -> 3
- level 471 HARIAN->HABLAR: 4 -> 3
- level 479 SALVAR->HABRAN: 6 -> 5
- level 495 ANTENA->ENSEÑA: 4 -> 3
- days 216, 279, 293, 356, 428, 430, 438, 516, 533, 602, and 686: one or two shorter; day 433 VENDE->MENTE: 4 -> 2

A stored result keeps its own stars and par (bests only improve), so nobody loses anything.

**Hints.** A hint-only solve of all 1,230 English and 1,230 Spanish ladders always lands in exactly par moves, but the
hint (the commonest NEXT word on a shortest path) walked into TIT (level 42), BITCH, RAPE, PISS, and CUNT (dailies 92,
577, 638, and 691) and VERGA (Spanish dailies 467 and 513). Now rude words sort last in `words.json` and `hintFrom` takes
the shortest path whose rarest word is the commonest: no rude hint anywhere, and English hint words outside Word Weaver's
lists fell from 620 to 288 of 5,692.

**Difficulty** (par = avg; detour = par minus the letters that differ; greedy = always change toward the target,
commonest first, and finish at par; paths = shortest paths, median; branch = neighbours of each path word; uncommon =
levels whose par needs a word outside Word Weaver's lists):

| | len | par | detour | greedy | paths | branch | uncommon |
|---|---|---|---|---|---|---|---|
| EN Easy 1-50 / 51-100 | 3 | 3.2 / 3.5 | 0.3 / 0.5 | 82% / 78% | 3 / 4 | 20 | 0% |
| EN Medium 101-175 / 176-250 | 4 | 4.0 / 4.5 | 0.6 / 0.8 | 72% / 49% | 3 / 6 | 15.5 | 0% |
| EN Hard 251-325 / 326-400 | 5 | 4.6 / 4.6 | 0.9 / 0.9 | 64% / 67% | 4 / 3 | 10.4 | 0% |
| EN Expert 401-450 / 451-500 | 6 | 4.9 / 5.1 | 0.9 / 1.4 | 48% / 42% | 2 / 2 | 7.4 | 78% / 98% |
| EN Daily (days 0-119) | 4.3 | 4.7 | 1.0 | 57% | 7 | 14.7 | 0% |
| ES Easy | 3-3.4 | 3.1 / 3.3 | 0.2 / 0.3 | 96% / 96% | 3 / 4 | 14.7 | 0% |
| ES Medium | 4 | 4.0 / 4.5 | 0.4 / 0.8 | 84% / 65% | 8 / 12 | 17 | 0-1% |
| ES Hard | 5 | 4.7 / 4.7 | 0.8 / 0.7 | 56% / 67% | 4 / 4 | 11.4 | 3-4% |
| ES Expert | 6 | 4.2 / 4.5 | 0.6 / 0.8 | 76% / 60% | 3 / 2 | 8.7 | 6% / 54% |
| ES Daily | 4.3 | 4.3 | 0.5 | 83% | 8 | 15.4 | 0% |

Verdict: English steps up cleanly by length, par, and greedy rate through Hard; Expert is harder for the wrong reason
(obscure words through `anyPath`). Spanish Easy is too easy (96% greedy) and Spanish Expert is not harder than Spanish
Hard (shorter pars, more greedy wins). Inside the bands only Medium rises (par 4, then 4-5); Hard and Expert are flat.
Every fix needs new start/target pairs, so they stay proposals (levels are progress; Matt has saved progress): remake
Expert 401-500 in both languages with a common-word par path before release; Spanish Easy: prefer par 4 and detours;
Hard and Expert: a rising par (4 at the start of the band, 5-6 at its end).

**Test plays** (headless Chromium, localhost, test1 / DREG5; 360x640, 393x852, and 402x874; light and dark; both
languages): every band's first level by taps at par, an invalid word, a key before a letter, undo, hint, leave and resume,
the daily, Ñ by taps, How to play, the done card, the back swipe, the hub's Back, and history not growing: 132 of 133
checks passed; the one failure was the hub's Messages read refused on localhost (not Word Ladder).


## 2026-11-19: the UI/UX review's list, built (admin only, not cleared for players)

Matt: "have a different agent review the game for UI/UX ... I still will not be satisfied or release it until the reviewer is
impressed." The reviewer graded C+ (flat: no motion on a correct step, no finish moment, a sparse middle, the white letters on
green hard to read, the stars explained in text). Built from its ranked list: the step animation (drop, flip, green fill); the
finish (rows light up 60ms apart, stars pop one at a time, "Par!" / "Solved", progress or the daily's date and countdown); the
gold outline on each earlier word's changed letter (play and done); navy letters on the green (Matt's green kept, no shapes, as he
asked); the wrong word shown in its tile (navy, gold X, no red) before the shake; dashed rungs for the moves left at par
(par - moves - 1: counted from the start, shrinking with every move, undo included, so it never claims a path exists from
here); the first word kept in sight when earlier words fold, and at least 3 earlier words at 360x640 (the tile shrinks first;
a shorter keyboard and less space above the counters on short phones); the first-move tip (the par path's letter, then key,
once per device, reported); How to play's star key drawn; the title picture as a real ladder (English COLD to WARM, Spanish
MAR to SOL); progress per difficulty on the start screen; Spanish "Llega a la palabra 🏁." and "Primero toca una letra";
pressable depth on buttons, keys, and tiles. Not built, on purpose: smart keys that play a letter without a tapped tile (Matt's
rule, 2026-11-14), any change to level data, removing the game's own back arrow. Nothing recorded, saved, or logged changed
(only the additive `tip1` preference).
