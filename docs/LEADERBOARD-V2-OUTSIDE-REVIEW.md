# Leaderboard v2: the outside "fresh eyes" review (2026-11-01)

A brand-new Claude.ai chat (Opus 5.5, top effort, no repo, no history) was given 50 screenshots of v2 as it was
live then (v1377; `docs/mockups/lb2-review/first-review/`, 25 dark + 25 light, real data, viewer *King of Games*)
and the prompt in `docs/mockups/lb2-review/PROMPT.txt`. It answered with review 1 (C+). Matt then gave it
`docs/LEADERBOARD-V2-REVIEWER-CONTEXT.md` (his rules + answers to its questions) and it revised to review 2 (B-).
Round 4 (v1380, screenshots `docs/mockups/lb2-review/round4/`) built the items Matt approved (section 4).

## Review 1 (no context): grade C+

Looks like a B+ app; the numbers often contradict each other, and a leaderboard lives or dies on trust.
Goals: find my stats B; compare to others D+; see what others achieved C+.

Strengths: clear 3-tab structure; highlighted own row + pinned bar; "X to take the record" hints; medals carry numbers
and difficulties have shapes; per-game metrics; thumbnails; dark/light parity; player pages.

Problems, worst first:
1. Critical: "All" doesn't mean all (Connect 4 All: 2 wins at #1 vs 85 wins on Easy; Unai 4 wins below 2; Minesweeper
   1:12 below 5:22; "Easy · 1 of 24 won" mixes a badge with an all-difficulty count).
2. Critical: rankings look like bugs (Tic Tac Toe 12 wins Medium is #2 behind 3 wins Medium; Sudoku 1 Expert solve below
   2 Medium solves).
3. Critical: "Record" means three things (gold count, standing feats, first place).
4. High: "take the record" hints are off by one (they reach a tie).
5. High: raw totals reward grinding (wanted win % / averages with a minimum).
6. High: same person under different names (Begoña/Bego, Andrew Powell/Andrew P.); avatars only on profiles.
7. Medium: the viewer is never called "You"; gray viewer name above the medal column reads like a stray name.
8. Medium: rank formats vary ("1st", "#5", "5", "=5", medal); tied bronzes with no "=".
9. Medium: filter controls don't match (Skeeball dropdown; "Med" vs "Medium").
10. Medium: Standing Records sit above the filter but ignore it; only visible after scrolling.
11. Medium: pinned bar repeats your row; its subtitle changes meaning.
12. Medium: Hall of Fame has too many medals (rank medals beside medal-count columns).
13-17. Low: number separators; Me truncates names and orphans "· Expert"; light-mode Expert icon reads "••"; short
   boards half empty; nothing shows rows are tappable.
Confusing: the All badge, "MP", "Old", taglines, Golf "-2", Contexto "🥇 9", "100 cups hit", Skeeball Points vs High
score, a Spelling Bee "win", asterisks, "Played 34" = "All 34", heart "0", unlabeled bottom nav (flask).
Missing: win % / averages, time windows, head-to-head on player pages, records feed with dates, Me sorted by closest /
at risk, an info button, a Games sort by my rank (it exists; not discoverable).

## Review 2 (after the context sheet): grade B-

Polish was never the problem; most "broken" items are deliberate rules that are unexplained. Fix 1-5 for an A-.
1. Critical: rule 1 (difficulty outranks score) is invisible. Fix: thin divider rows per difficulty on All, shape
   next to the number.
2. Critical: badge paired with a lifetime count, on every All row and player pages. Fixed by 1.
3. Critical: off-by-one hints. Fix: "Beat 5 wins" form (Matt then asked to also show the player's own number).
4. High: restore the "No hints" pill.
5. High: "Records" three meanings. (Matt: Records = games you hold the record for; the feats were renamed "Bests".)
6. High: Tic Tac Toe list vs board disagree: Matt's rule needed.
7. Medium: viewer's name in the accent colour everywhere (no "You").
8. Medium: Standing Records only on the All tab.
9. Medium labels: "2 under", "9 🥇", "Genius", "Total / Best game", "Balls in 100", "Online".
10. Medium: one rank format, "=" on every tie.
11. Medium: one filter pattern, "Medium" (Matt: only if it fits).
12. Medium: hide the pinned bar when your row is on screen (conflicts with the original spec; not done).
13. Medium: plain rank numbers in Hall of Fame (Matt: no).
14. Medium: drop the white tile behind shapes (conflicts with Matt's black diamonds; not done).
15-19. Low: separators, cramped Me rows, short boards' empty space, chevrons, a sort icon.
Removed after context: win %, time windows, head-to-head, "You", the Connect 4/Minesweeper/Sudoku "bugs" (rules), names
and taglines, "Old", bottom nav, the name merge (Matt's call), Played 34, feed (out of scope).
Optional "?" screen "How rankings work" (built in round 4, wording verified against the code).

## Matt's answers (2026-11-01) and what round 4 did

Built (v1380): 1, 2, 3 (as "3 wins · record 5"), 4, 5 (Records kept; feats -> "Bests", All tabs only), 7, 8, 9, 10,
11 ("Medium" fit everywhere at 360px), 15, 16, 18, 19, the "?" sheet. Not built: 12 (spec conflict, open), 13 (Matt
said no), 14 (black diamonds stay), 6 (Tic Tac Toe rule, open).
