# Handoff: King of Games (Moonis, 3VN33) cheating, Spelling Bee, Contexto board (2026-10-30)

Matt will start the next session with "let's pick up where we just left off". This is where we left off.
Times are Eastern. Never show Matt Spelling Bee or Contexto answer words.

## Still open, in order

1. ~~Reader key~~ DONE 2026-10-30 (the rules checked `readers/<uid> === true`, the admin page writes `{on: true}`;
   fixed in PR #1356). ~~List King of Games' Contexto games~~ DONE: en-8 (Oct 5 puzzle) won Oct 28 11:40 PM-12:02 AM,
   95 typed, 0 hints; en-32 (Oct 29) won 12:04-12:08 AM, 46 typed, 0 hints; en-4 (Oct 1 puzzle) won Oct 29 1:11-1:15 PM,
   41 typed, 0 hints; en-31 opened, never played. The log starts Oct 28 10:44 PM ET.
3. **Contexto average guesses: MOCKUP, waiting for "build it".** Matt asked: "In the space between the lowest medal
   received and the # of gold medals, show avg guesses." Mockup: `docs/mockups/2026-10-30-contexto/contexto-avg.png`
   (+ `.html`, renderer `render-avg-mockup.cjs`). Each row: on the small-medal line, right side, the average
   (`(guesses + hints) / wins`, the board's tie-break, `ctAvgGuesses`) with "AVG GUESSES" small under it. Matt then
   asked what it counts: hints count as guesses, every win, not give-ups; Daily tab = daily wins only. Do NOT build
   until Matt says so (CLAUDE.md, mockups rule).
4. **Offered, not approved (ask before building):**
   - Upload every phone's Contexto history (its save: every puzzle number, guesses and hints in order, result,
     finish time) to an admin-only node, so games before Oct 28 can be listed too.
   - Close the Contexto "give up offline in Safari, solve in the Home Screen app" hole (count a past-puzzle win only
     once the server confirms it was not given up anywhere).

## Done and live (this session)

- **Spelling Bee**: the speed check counts clock time from opening to Genius, nothing skipped (v1342). Audit of every
  skip in the log and the 7 checks, all fixed (v1344): no 3,000-entry queue cap; Delete (`del`), sheet closes
  (`shut`) and typing time (`k`) logged; "back and burst" counts reopening the app; right/wrong and re-typed count
  every guess; the server checks every logged day hourly and every code with a log. Replay: still only King of Games,
  Oct 28. His Oct 26 and Oct 27 voids are Matt's hand voids: those days have NO guess log (logging began after he
  played), so the 7 checks never ran on them.
- **The Spelling Bee reply Matt sent Moonis** (proof): the checks never count words; after a 9-second break his next
  6 words were the puzzle's 6 highest-scoring, all 3 pangrams, 73 points in 67 seconds, no misses; Spanish accepts
  every dictionary word as a bonus (Oct 28: answers worth 202, Anita Bonita scored 434); Oct 28, every guess: King of
  Games 46 right / 17 wrong / 3 re-typed / 2 shuffles, Genius 7.7 min after opening, failed 7 of 7; Anita Bonita 87 /
  152 / 60 / 24 shuffles, Genius 11.7 h after opening; Lili 79 / 90 / 121 / 9 shuffles, 17.9 h, failed 0 of 7.
- **Contexto board** (Matt's approved mockups): Daily | All tabs (Daily = finished on its own day by the server's
  live clock, `ct.d`); medal IMAGES with the count on the face (`icons/medal-*.png`: gold is Matt's own edit, iron =
  3+ hints), dark numbers (contrast 5+); smaller medals under the name; one-line key. Then removed: the "MEDALS"
  label, "N played", and the "<name> is 4th." line (v1367). `contexto/CLAUDE.md`.
- **King of Games' Contexto hand void UNDONE** (v1366, Matt: "undo the void. Just correctly classify those games"):
  11 wins = 8 gold + 3 iron, All board only. He is 1st on All.
- **Reader access** (v1368): `readers/<uid>` may READ playLog, beeAlerts, integrityFlags, integrityAlerts.
  `tools/reader-auth.mjs`, `tools/read-play-log.mjs`. Root CLAUDE.md, Dev tooling.
- CLAUDE.md rule added: feedback on a mockup changes the mockup, never the live game.

## King of Games' Contexto record, rebuilt from his bug-report snapshots (totals only before Oct 28)

| When (ET) | Games | Result | Hints |
|---|---|---|---|
| Before Oct 5 (day not recorded) | 2 | 1 win, 1 give-up | 15 between them; the win used 3+ |
| Fri Oct 16, 11:15 to 11:23 PM | 3 | 2 wins, 1 give-up | 12 between them; one win 0, the other 3+ |
| Wed Oct 28, 4:28 to 4:40 PM | 5 | 5 wins | 8, all in one win; 4 wins had 0 (only one can be Oct 28's puzzle) |
| Thu Oct 29, by 1:15 PM | 3 | 3 wins | 0 (in the play log, with puzzle numbers) |
| **Total** | **13** | **11 wins, 2 give-ups** | **35** (give-ups' hints included) |

Matt was told twice wrongly that the earlier wins were "Oct 12": that is the week label; the games were Oct 16.
