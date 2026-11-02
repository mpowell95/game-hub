# Outside review, round 5 (2026-11-02): the reviewer's answer as Matt pasted it

Pack: `docs/LEADERBOARD-V2-REVIEWER-CONTEXT-2.md` + `docs/mockups/lb2-review/round5/`. Matt's answers and the plan:
`docs/HANDOFF-LEADERBOARD-V2-SESSION4.md`.

**Overall: B**
- Find own stats: **B-**
- Compare to others: **B**
- See what others achieved: **B+**

## 1. Strengths
- Clear three-tab layout. Every board row reads the same way: rank, name, plays, number.
- The pinned "your row" bar (05, 06) works well.
- Difficulty dividers with shapes explain "harder beats more" without any extra text (04, 07).
- The player page (21) is the best screen: tiles, every game, a number and a rank per game.
- The Medals table (24) is clean and easy to scan.
- The Me tab answers "where do I stand" in one glance.
- The help sheet (31) is short.
- Light mode and Spanish mostly hold up.

## 2. Problems (worst first)

**Critical**

1. **Board numbers don't match My Stats, and nothing connects them.** Connect 4 shows 2 on the board (04) but 88 wins in
   My Stats (32). Tic Tac Toe shows 12 (10) vs 110 + 4 (35). Battleship shows 3 (28) vs 8 (32). Ball Run shows 106 (29)
   vs 209 (32). A player will assume it's broken. *Fix:* In My Stats, show the ranked number first (shape + number, e.g.
   ◆◆ 2) with the total small underneath. Give every game the "Record by difficulty" table from 22. Tic Tac Toe (35) has
   no difficulty breakdown at all.
2. **The medal icon means five different things:** rank on every tab, including a silver for 0 wins (06); medal counts
   (24); Contexto solve counts: a giant gold "9" next to a gold rank medal (11); most *played* (27); every row of Past
   weeks (19) and Records held (28). This waters down "one gold per game." *Fix:* Use medals only for the game's real
   standing (All tab, Games list, Medals). Everywhere else, show "#1 #2 #3" and keep the colored left bar. For Contexto,
   use the compact "9 🥇" already used in 20 and 28. Show no medal on 0-win rows; the rank stays the same.

**High**

3. **"Closest" isn't close (29, 30).** It includes #16 Hold'em ($2,700 vs $220,500) and Nuts & Bolts (1 vs 354). It also
   compares across difficulties: Hill Climb: ● 6,210 m vs record ◆ 1,642 m looks like he beats the record. Sudoku: ◆◆ 1
   vs ■ 2 looks like he should be ahead, because the "No hints" reason is hidden. The sort order is also unclear. *Fix:*
   Show only the games where he is 2nd or 3rd, sorted by gap. Show his number at the record's difficulty. Add the "No
   hints" pill to the record line.
4. **Long tails of zeros (04, 05, 10, 26, 03, 07).** Nine "=7 … 0" rows push Bests far down. Anita Bonita's 0 in 03 sits
   under no divider. *Fix:* Collapse them into one row, "=7 · 9 players," that expands on tap. Ranks don't change.
5. **Sudoku dividers (08).** The order goes Medium, Expert, Medium, and "No hints" appears twice (on the divider and on
   the row). His Expert solve looks wrongly ranked. *Fix:* Add one top divider, "No hints," then the normal difficulty
   dividers. Drop the pill from the row.
6. **Hard to read for the owner's colorblindness:** Light-mode shapes are tiny bare glyphs, about 6 px (light-04,
   light-15). *Fix:* Match the dark-mode tile size. Contexto hint medals differ by color only (11, 20); the dark medal
   disappears on dark rows. *Fix:* Give each medal type a fixed slot, and show "·" for zero.

**Medium**

7. **The header "N played" changes meaning per tab**: 328 becomes 7 (04 → 06), and 36 becomes 1 (11 → 12). *Fix:*
   Always show the game total.
8. **Too many stacked controls.** Rush has three rows of tabs (17–19). *Fix:* Use the icon tab row from 15 for
   Easy/Hard, and make This week / Weeks won / Past weeks a dropdown. Skeeball (13) has an unlabeled "All" dropdown, and
   its column header "Total" repeats the tab. *Fix:* Label it "All machines" and drop the repeat.
9. **Inconsistent tabs.** Difficulty tabs look different in 15 vs 17. Contexto puts Daily first. *Fix:* One tab style,
   All first.
10. **The "Hall of Fame #" tile is ambiguous.** Ele's #4 (21) matches Medals, but he is #5 in Wins (25). *Fix:* "Medals."
11. **Stats screens use different words and layouts.** 22 says Wins/Losses/Plays with Tied in a separate card. 35 says
    Won/Lost/Tied/Played. 16 repeats 1,052 and 281 right under its header card. *Fix:* One vocabulary, Ties next to
    Losses, cut the repeats.
12. **My Stats (32) shows no rank or medal per game.** It's titled "Game Stats" but opened from "My Stats," and has both a
    back arrow and an X. *Fix:* Add the rank badge from 21. One title and one close control.
13. **Past weeks (19).** Every row is highlighted (all are his). Also "Oct 26 – Nov 1" is listed as finished while "This
    week" is empty (17), though it's still Nov 1 in the US: may be a UTC week-boundary bug.
14. **Skeeball machine cards (23, 34)** use gold and bronze left bars, the same as rank bars. *Fix:* Keep the dot, drop
    the bar.

**Low**

15. **Spanish:** truncated "Laberinto de flec…" (es-17), "Carrera de Bo…" (es-32); wrapping "Salón de la Fama" tile
    (es-28), two-line title (es-32); plural "1 victorias" (es-32); "4481" vs "198.830" (es-32); "Conecta 4" next to
    "Connect 4 Hoops".
16. **Possible bug:** Battleship appears as "Billar" in Spanish. (MISREAD: Spanish A-Z order; Billar = Pool.)
17. **Inconsistent dashes and dates:** "—" (07), "-" (16), "–" (06), and "2026-08-26" (23) vs "Oct 26" (19).
18. **No Play button on any game board header.** (MISREAD: the test browser cannot launch games.)

## 3. Confusing on first look
- Bests contradict the board: "79 wins going first" vs a board score of 2 (05), and "2 solved" vs 1 (08).
- A huge Easy number ranks low: *TP* has 193 wins and is #6 (10).
- "of 3" under the Weeks won row (18) reads like a fragment.
- The meaning of "Timed" in 16.
- Who the profile emoji next to each Best belongs to.

## 4. Missing
- Rank inside My Stats. On "Records held," who's 2nd and by how much. A way to find a player (38 players). Rush past
  weeks: runner-up and your own place. An empty "This week" should show last week's winner. The help sheet doesn't cover
  "=", lower-is-better times, "Closest," or the Hall of Fame tile. "Not played yet" not in any screenshot.

## 5. Settled rules that hurt (not graded)
- Difficulty outranks score: 2 wins out of 147 plays takes gold (04), 193 wins sits at #6 (10).
- No-hint solves first: an Expert solve ranks below a Medium one (08) with no visible reason on the row.
- Fewest words: a one- or two-word label like "All" on Bests or "Hard" on Closest would prevent most of the confusion.
