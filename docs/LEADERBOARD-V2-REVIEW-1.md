# Leaderboard v2: review 1 (2026-10-31, player's-eye view)

Build reviewed: v1372, admin-only (`js/leaderboard2-ui.js`, `js/leaderboard2-boards.js`). Reviewer: the session
that built it. Matt's brief: "This is an INTERFACE redesign, not a stats redesign." He noticed far more gold medals
than before. Every claim below about counts must be re-checked against REAL data (the board package
`boards/v1/lb/z` via `watchBoard`, or a snapshot) before acting on it.

## Grade: C+

Looks better and reads faster than the old overlay, but it quietly changed WHAT is ranked and HOW MANY places
exist, which Matt did not ask for. A player cannot trust a medal that means less than it did yesterday.

## Strengths

1. One clear home: Boards / Hall of Fame / Me tabs; tile art; favorites first; search.
2. Pinned "your row" with the gap to the next rank: the single most motivating element.
3. Board screen is calm: 10 rows, medals 1-3, one-tap difficulty, settings tucked in a sheet.
4. Dark mode, tabular numbers, 44px targets, no codes in the DOM, real profile names.
5. Reads the server board (fast), admin-gated cleanly, "Old" escape hatch.
6. Player page answers "what does this person hold?" in one screen.

## Weak areas (most serious first)

1. **Medal inflation (the bug Matt saw).** v2 makes a separate ranked list for every game x mode x difficulty x
   opponent x language (plus every old tab), and Hall of Fame / Boards-list crowns / Me / Player count a 1st
   on EACH of them. The old leaderboard had ONE standing per game (`gameStanding`, the board's own order:
   difficulty outranks score, `boardMetricCmp`) and its medals and "records held" came from that. Result: many
   more golds, and a player who is 1st on "Darts · 101 · Easy" with 3 games now owns a gold like the real Darts
   champion. Medals must come from the OLD standings only.
2. **Ranking rules changed.** Default vs-computer metric is Win % with a 10-game floor; the old board was
   wins-only, tier-first, no minimum (CLAUDE.md: "No minimum-games rule", "DIFFICULTY OUTRANKS SCORE"). Players
   with many wins can vanish or drop; small samples float up. Stats must match the old board.
3. **History hidden.** Win-game boards have no "All" difficulty, so plays filed under `legacy` / unmapped
   buckets (pre-difficulty history) show nowhere in v2 (THE LAW rule 1: data must stay visible). The old board's
   All tab showed them.
4. **"All modes" vs mode boards double-award.** The same wins earn a place on "All modes" AND on the mode board.
5. **Hall of Fame "Top level" uses the hardest tier anyone played**, not the game's real top tier; a 4-level
   game nobody has played on Expert treats Hard as top.
6. **Per-mode multiplayer boards can count a challenge twice** (byMode not de-duplicated per person).
7. **Lost old features a player used**: the old You tab's "closest to breaking a record" read at the record's
   tier, standing records (best scores) on each game page, tier pill on All rows, Sudoku/Murdoku "no hints"
   note, the "<name> is 3rd. <gap>" line, Send message from a player page, the per-game VS chip.
8. **Comparing myself to others is shallow**: the Player page lists only 1st places; it never answers "how do
   I compare with Rosa in Darts?" or "what did she play, how many wins?" (old player page had every game, most
   played first, with full numbers via the shared game list).
9. **Navigation**: board choice (mode, opponent, rank-by) hides in a sheet with no visible summary beyond the
   sub line; a player rarely discovers modes. Arrows only start after a day on that phone.
10. **Copy**: "Ranked" tile is vague; "1st in N" only shows when N > 1; Boards list right column (medal / #N /
    dash) has no label.

## Direction for the plan

- Keep v2's LOOK and navigation. Put the OLD numbers back: every board's rows, order, ties, units and medal
  counts must equal what the old leaderboard shows for the same game and tab (`js/leaderboard-ui.js`
  `gameStanding`, `boardMetricCmp`, `plainBoardHTML` tabs, `gapText`, records held).
- Medals and Hall of Fame count ONLY the old per-game standing (one gold per game, as before). Mode / Win %
  views may exist as optional filters but award nothing and are clearly secondary.
- Every play visible: an All tab wherever the old board had one.
- Restore the lost player features in the new look.
