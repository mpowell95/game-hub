# Spelling Bee: fair-play rules and the long-term board (spec, 2026-10-28)

Status: **FINAL (2026-10-28). Built and live the same day** in four stages (game, server, hub Leaderboard + My Stats, admin page).
Decisions are Matt's words from the 2026-10-27/28 session; open questions are in section 9.

## 1. Already live (v1304)

- **Every day played counts** (one play per day per language with at least one word; Genius = that
  play's win). Earlier days count from each phone's own save the next time it opens Spelling Bee.
- **Voided days (King of Games `3VN33`): Oct 26, 27, 28, English.** Read time only (`VOIDED_MATCHES.spellingbee`,
  `keepPlayed`): each still counts as played, its Genius win comes out of the hub Leaderboard and My
  Stats on every phone, his included (Matt: fine for him to see that there), **once his phone has opened
  Spelling Bee** (that is when it notes the void). His save and his `beeDaily`
  rows are untouched.
- Not yet: other people's in-game boards still show his score on those days (section 3).
- Known gap (section 9, item 7): v1304 also counts a past puzzle played later; fixed in the build.

## 2. What each person sees on a voided day

| Where | The cheater's phone | Everyone else's phone |
|---|---|---|
| In-game "Today" board | Unchanged: his words, points, place | **Played, 0 words, 0 points, last place** |
| Calendar, Rankings, Genius pop-up | Unchanged | (not shown to others) |
| Hub Leaderboard, My Stats | Day played, 0, no Genius, last place | Same |
| Long-term board (section 4) | Day played, 0, no placing credit | Same |

**Silence rule (Matt): nothing on the cheater's phone inside Spelling Bee may change or hint at a void.**
No label, no grey row, no "VOIDED". Every in-game surface is checked in the tests (section 8).

## 3. The in-game board on other phones

- A voided row is shown as **0 words, 0 points, empty bar, no 🧠/🐝, last place** (after everyone with a
  word). Ties among several 0 rows: alphabetical, as today.
- Places for everyone else are counted **without** him: the person behind him moves up.
- On his own phone his row is his live row, as today; other rows are unchanged.
- Voids come from two places, merged: the code list (`VOIDED_MATCHES.spellingbee`, the three manual days)
  and the server's automatic flags (section 5), minus any Matt has undone.

## 4. The long-term Spelling Bee board (mockup B)

Replaces the current Spelling Bee board on the hub Leaderboard (the one that shows "wins").

- **Toggle 1: Points | Words** (default Points). Changes the number shown and the order. **Each day's
  1st/2nd/3rd is always decided by points** (Matt, 2026-10-28).
- **Toggle 2: All | English | Español** (default All). Each language is its own daily race; All adds
  the two together.
- **Each row:** place medal (1-3), emoji, name, the number (total points or words), and under it:
  🥇/🥈/🥉 counts (days finished 1st/2nd/3rd), 🧠 Genius days, 🐝 Queen Bee days, 📅 days played.
- **Daily places:** per day per language, **by points**, words found on the puzzle's own day only; ties share the place; a voided day is
  always last with 0 and earns no place and no Genius.
- **Own-day numbers (review 2, 2026-10-28):** a board row stores totals only, and per-word times without
  points, so the server cannot tell what was found on the puzzle's own day. Each phone adds `dw`, `dp`,
  `dr` to its row: words, points and rank from words found on the puzzle's own day (local date = the
  puzzle's day, by each word's time; words with no time = on the day). Rows without them (older builds,
  Oct 26) count as found on the day. `database.rules.json` must allow the three fields.
- Other people's rows on a PAST day's in-game board show own-day numbers too; the viewer's own row stays
  live (section 9, item 8).
- **Source:** the daily board rows (`beeDaily/`, from 2026-10-26), built on the server into one small
  package (`boards/v1/bee`), so no phone downloads every day's rows. Rebuilt when a row changes (at
  most every 2 min) and when a void changes.
- Test accounts hidden as everywhere (`isHiddenName`).
- Fewest words: tab labels and numbers only.

## 5. Automatic detection

**RE-EVALUATED 2026-10-29 (Matt: "You can't void everybody. Undo today's voids and reevaluate the checks so this
doesn't happen").** That day the server voided Ana (playing beside Matt; Back+9, right 30 / wrong 12), Lili (Burst 23 at
5.1 s, Back+12) and King of Games (Back+6, Re-typed 2), all on checks fluent honest players trip. Now (`verdict` in
`js/bee-fairplay.js`, one function for a log and for a stored flag):

| | Check | Since 2026-10-29 |
|---|---|---|
| Strong (any one voids) | 1. Sorted run, 7. Best words first | unchanged |
| Supporting (ALL THREE void) | 2. No-miss burst, 5. Speed, 9. Re-typed | was any two; burst was strong |
| Retired (counted, never a reason) | 3. Leave and burst, 8. Right vs wrong | |

Every stored flag is RE-JUDGED by these rules at read time from the numbers it saved (`flagStands`: the phone's board,
the server's long-term board, the admin page). Nothing was written or deleted. The four real flags re-judged:

| Day | Player | Saved reasons | Now |
|---|---|---|---|
| Oct 28 EN | King of Games | sorted 7, burst 16 at 4.0 s, Back+5, Genius 7.6 min | VOID (sorted run) |
| Oct 29 ES | Ana | Back+9, right 30 / wrong 12 | counts |
| Oct 29 ES | Lili | burst 23 at 5.1 s, Back+12 | counts |
| Oct 29 EN | King of Games | Back+6, re-typed 2 | counts |

King of Games' hand voids (Oct 26, 27, 28; `VOIDED_MATCHES`) are Matt's and unchanged.

**Matt's settled decisions, same day:** the strong checks are what catch copying ("exactly what I've been telling you
over and over"); a "copied from another player" order check was proposed and REJECTED ("irrelevant and unnecessary");
speed alone never voids a fluent player. Do not propose new or weaker checks. The original design follows.

Runs on the server each time a player's guess log is saved (debounced), for **everyone, English and
Spanish**. Reads that player's log for that puzzle (`beeLog/<puzzle>/<CODE>`). Timing uses each entry's `t` (the
phone's clock at the guess); the server time `s` only stamps when a batch was uploaded.

**Strong: any one voids the day.**
1. **Sorted run:** 6+ right answers in a row, all the same length, each one alphabetically after the one
   before, with no wrong or already-found guess in between (one restarts the count). Honest high so far: 3.
2. **No-miss burst:** 10+ accepted words in a row (bonus words count as accepted), no refused or
   already-found guess between, averaging under 6 s each.
7. **Best words first** (added 2026-10-28, Matt: "coming back to the app and getting all of the best
   possible words in order including all pangrams is simply not plausible"): after opening or coming back
   to the app, within 2 minutes and before leaving again, the first 5 answers are all among the 6
   highest-scoring answers not yet found (ties count), each worth 7+ points. King of Games, Oct 28: 6.
   The server knows each puzzle's 15 highest answer scores (`bee-puzzles.json` `top`).

**Supporting: any two together void the day.**
3. **Leave and burst:** back from leaving the app OR reopening it, then 5+ accepted words within 60 s (misses allowed;
   reopening was skipped until 2026-10-29).
4. ~~Copy typo~~ **dropped**: honest players do it too (Lili 6 times on Oct 28, Natalia 2 on Oct 27).
5. **Speed:** Genius within 10 minutes of first opening the puzzle, clock time, nothing skipped (2026-10-29,
   Matt: "you SHOULD NOT SKIP ANYTHING"; until then it summed only open time and dropped breaks over 5 min).
8. ~~Right vs wrong~~ **RETIRED 2026-10-29**: Ana, playing honestly beside Matt, got 30 right / 12 wrong (2.5) on
   Spanish Oct 29 and was voided (with Back+9). Still counted and shown in the flag line; never a reason. A stored flag
   that no longer has enough live reasons counts for nothing at read time (`flagStands`); nothing is deleted. Was
   (added 2026-10-28): 2+ right answers per wrong guess, EVERY guess in the log (until 2026-10-29
   only up to Genius, and only with Genius) (King of Games
   46 / 17; every other Genius game 0.8 to 1.3).
9. **Re-typed** (added 2026-10-28, Matt: "an important fact"): fewer already-found guesses than 1 per
   10 right answers, every guess in the log (King of Games 3 of 46; others 9 to 71).

Speed, right vs wrong and re-typed count only when the log holds every word on the board (a game begun
before logging would look fast: Lili, Oct 27); the last two only with 20+ right answers.
**Nothing skipped (2026-10-29, Matt: "you SHOULD NOT SKIP ANYTHING")**: the server checks EVERY puzzle since
logging began (Oct 27) once an hour, not only yesterday/today/tomorrow; every code with a log, board row
or not; test accounts too (no push). The log keeps every queued entry (no 3,000 cap) and also records
Delete (`del`, what was left), each sheet closing (`shut`), and each guess's typing time (`k`, first letter
to Enter). Replayed on every log under these rules: still only King of Games, Oct 28. Replayed on every log 2026-10-28: only King of Games, Oct 28
(all 7 checks).

**Flag only (alert Matt, never void):**
6. **Missing log:** the daily board shows more words than the log has accepted guesses, 30+ minutes
   after the last board update (allows an offline phone to catch up). Only for puzzles from Oct 28 on,
   and only when that player has a log for that puzzle (a phone on an older build sends none).

**Replayed on every logged game (Oct 27-28, both languages; Oct 26 has no log), 2026-10-28:**

| Game | Sorted run (6+) | No-miss burst (10+, <6 s) | Leave and burst (5+) | Genius in <10 min | Voided? |
|---|---|---|---|---|---|
| King of Games, EN Oct 28 | **7** | **16 at 4.0 s** | **5** | **Yes (7.7 min, nothing skipped)** | **Yes** |
| MattyIce, EN Oct 28 | 2 | 6 at 4.8 s | 0 | No | No |
| MattyIce, EN Oct 27 | 1 | 0 | 2 | No | No |
| Ana, ES Oct 28 | 3 | 4 at 4.9 s | 0 | No | No |
| Lili, ES Oct 28 | 3 | 5 at 32 s | 2 | No | No |
| Lili, ES Oct 26 | 2 | 3 at 9 s | 1 | No | No |
| Lili, ES Oct 27 | 1 | 3 at 17 s | 0 | No | No |
| Natalia, ES Oct 27 | 1 | 4 at 4.5 s | 0 | No | No |

Every other logged game had 1 or no accepted words. Small sample: re-run on more days before trusting
the thresholds.

**When a day is flagged:**
- Server writes `beeFlags/<puzzle>/<CODE>` = `{rules: [...], numbers, at}` (server-only writes; anyone
  signed in can read, which the boards need).
- **Push to Matt:** "Spelling Bee: <name> flagged, <date>, <rule>".
- The day is voided everywhere in section 2 within about 2 minutes (boards rebuild).

## 6. Matt's admin page: "Spelling Bee flags"

- One row per flagged day: date, language, player, the rules that fired with their numbers
  (e.g. "Sorted run: 9 words, 4 s each").
- **Undo** (and Redo) per row: writes `adminConfig/v1/beeUndo/<puzzle>/<CODE>`; an undone day counts
  normally again everywhere. Manual voids (the code list) are listed too, read-only.
- Collapsed section, no prose (admin page rules).

## 7. Data rules (THE LAW)

- Nothing is deleted or rewritten: saves, `beeDaily`, `beeLog`, `players/` stay exactly as written.
  Voids and flags are separate nodes, applied when shown. Undo makes a day count again in full.
- New nodes `beeFlags/` (and the board package) added to `database.rules.json` and the backup's
  `BRANCHES`; backup run before the rules change.

## 8. Tests before it ships

- Replay every logged day through the rules (done once, table in section 5); repeat at build time.
- Silence: open each voided day on a phone set to his code (headless, test data offline) and compare
  every Spelling Bee screen to the same day un-voided: must be identical.
- Other phones: his row shows 0 / last; everyone else's place moves up; ties correct.
- Long-term board: totals and daily places recomputed by hand for 3 days of real data, Points and
  Words, All/EN/ES; voided days last with 0.
- Own day only: a past puzzle played later adds nothing anywhere (board, My Stats, stats count).
- Undo: a flagged day returns in full on every surface.
- Push: one alert per flagged day, never repeated.

## 9. Decisions (Matt, 2026-10-28)

1. Daily places: always by points.
2. Missing log: alert only, never void.
3. "sk" (65CNF): hidden (device `a49fcaf8`), data kept. Done, v1307.
4. Daily 1st/2nd/3rd: Spelling Bee only.
5. My Stats > Spelling Bee shows the long-term board's numbers (points, words, places, Genius, Queen Bee,
   days played) instead of won/played.
6. Sorted run is STRONG (Matt: "alphabetical order is probably enough to void"). Risk noted: Hints lists
   words by first letter and length; the no-miss requirement is what keeps honest Hints play under it.
7. **A puzzle counts only on its own day** (Matt: "you have to do it on the correct day"). Words found
   after the puzzle's day count for NOTHING: not played, not points, words, places, Genius or Queen Bee.
   Applies to the long-term board, My Stats and the stats count shipped in v1304 (which today counts a
   past puzzle played later; fix in the build). A word's day comes from its own time (`times`, from
   2026-10-27); rows without word times (Oct 26) count as found on the day.
8. A void never changes rows with the viewer's own code, on any screen. (Matt: ok)
9. Replaced puzzles: per person per day, the better of the two rows counts. (Matt: ok)
10. In-game daily board sorts by points (words still shown). (Matt: ok)
11. By Game's top 3 and the You tab use the new board's order. (Matt: ok)
12. Manual voids: not undoable from the admin page (Matt: "doesn't matter").

## 10. Limits (said plainly)

- Catches copying in list order and at list speed. Someone who knows the rules can type slower, shuffle
  the order, or read off a second device; it is a deterrent, not cheat-proof.
- If the cheater and someone else compare boards in person, the numbers differ (Matt: accepted).
