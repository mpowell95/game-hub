# Spelling Bee: fair-play rules and the long-term board (spec, 2026-10-28)

Status: **DRAFT for Matt's approval. Nothing below is built** except section 1.
Decisions are Matt's words from the 2026-10-27/28 session; open questions are in section 9.

## 1. Already live (v1304)

- **Every day played counts** (one play per day per language with at least one word; Genius = that
  play's win). Earlier days count from each phone's own save the next time it opens Spelling Bee.
- **Voided days (King of Games `3VN33`): Oct 26, 27, 28, English.** Read time only (`VOIDED_MATCHES.spellingbee`,
  `keepPlayed`): each still counts as played, its Genius win comes out of the hub Leaderboard and My
  Stats on every phone, his included (Matt: fine for him to see that there). His save and his `beeDaily`
  rows are untouched.
- Not yet: other people's in-game boards still show his score on those days (section 3).

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

- **Toggle 1: Points | Words** (default Points). Decides the number shown, the order, AND each day's
  1st/2nd/3rd.
- **Toggle 2: All | English | Español** (default All). Each language is its own daily race; All adds
  the two together.
- **Each row:** place medal (1-3), emoji, name, the number (total points or words), and under it:
  🥇/🥈/🥉 counts (days finished 1st/2nd/3rd), 🧠 Genius days, 🐝 Queen Bee days, 📅 days played.
- **Daily places:** per day per language, by the chosen metric; ties share the place; a voided day is
  always last with 0 and earns no place and no Genius.
- **Source:** the daily board rows (`beeDaily/`, from 2026-10-26), built on the server into one small
  package (`boards/v1/bee`), so no phone downloads every day's rows. Rebuilt when a row changes (at
  most every 2 min) and when a void changes.
- Test accounts hidden as everywhere (`isHiddenName`).
- Fewest words: tab labels and numbers only.

## 5. Automatic detection

Runs on the server each time a player's guess log is saved (debounced), for **everyone, English and
Spanish**. Reads that player's log for that puzzle (`beeLog/<puzzle>/<CODE>`), server timestamps.

**Strong: any one voids the day.**
1. **Sorted run:** 6+ accepted words in a row, all the same length, in alphabetical order.
2. **No-miss burst:** 10+ accepted words in a row, no refused guess between, averaging under 6 s each.

**Supporting: both together void the day.**
3. **Leave and burst:** back from leaving the app, then 5+ accepted words within 60 s (misses allowed).
4. ~~Copy typo~~ **dropped**: honest players do it too (Lili 6 times on Oct 28, Natalia 2 on Oct 27).
5. **Speed:** Genius within 10 minutes of time in the game.

**Flag only (alert Matt, never void):**
6. **Missing log:** the daily board shows more words than the log has accepted guesses, 30+ minutes
   after the last board update (allows an offline phone to catch up).

**Replayed on every logged game (Oct 27-28, both languages; Oct 26 has no log), 2026-10-28:**

| Game | Sorted run (6+) | No-miss burst (10+, <6 s) | Leave and burst (5+) | Genius in <10 min | Voided? |
|---|---|---|---|---|---|
| King of Games, EN Oct 28 | **7** | **16 at 4.0 s** | **5** | **Yes (7.5 min)** | **Yes** |
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
- Undo: a flagged day returns in full on every surface.
- Push: one alert per flagged day, never repeated.

## 9. Open questions for Matt

1. **Placings toggle:** does Points/Words also change who placed 1st/2nd/3rd each day (as written), or
   are placings always by points?
2. **Missing log (rule 6):** alert only, as written?
3. **"sk" (65CNF):** hide it from the Leaderboard? (Looks like another session's automated browser.)
4. **Other games:** you said "we do this for all games (rank 1, 2, 3...)". Daily 1st/2nd/3rd only exists
   for a game with one shared puzzle a day. Spelling Bee only for now, or another game too?
5. **My Stats > Spelling Bee:** show the same numbers as the long-term board (points, words, places,
   Genius, Queen Bee, days played) instead of today's won/played?

## 10. Limits (said plainly)

- Catches copying in list order and at list speed. Someone who knows the rules can type slower, shuffle
  the order, or read off a second device; it is a deterrent, not cheat-proof.
- If the cheater and someone else compare boards in person, the numbers differ (Matt: accepted).
