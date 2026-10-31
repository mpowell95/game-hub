# Leaderboard v2: good morning (2026-10-31)

Live on admin devices only (v1374). Everyone else still sees the old leaderboard, unchanged.

## Final grade: B

It started the night at **D+**. Two reviewers rated round 1's result B and B-.

## Gold medals

| | Gold | Silver | Bronze |
|---|---|---|---|
| Old leaderboard | **40** | 32 shown | 30 shown |
| v2 last night | 104 | 69 | 58 |
| **v2 now** | **40** | 31 | 31 |

Silver and bronze differ by one each. The old By Game list drew only 3 names per game. v2 counts every tie: two
people tied for 3rd both get bronze. Hold'em bankrolls nobody ever used earn no medal.

## What changed overnight

- **Every board shows the old numbers.** Same tabs, same people in the same order, same ties, same numbers. A test
  checks all 149 tabs of all 34 games against the old leaderboard from `main`, in English and Spanish. All pass.
- **Medals count once per game**, the old way (who leads each game), not once per difficulty or mode.
- **Removed:** Win %, the 10-game minimum, mode boards, "Top level", movement arrows. These caused the extra medals
  and the empty boards.
- **Everyone is listed** on a board now, not just the top 10.
- **Back from the old board:**
  - Hall of Fame has **Medals | Wins**. Wins is the old By Player list.
  - **Me** is the old You tab: records held, closest to a record (with the gap), and games not played yet (with Play).
  - The **player page** lists every game they played, with their place, games played and wins, plus a Message button.
  - Standing records sit under each board, and Play is on every board.
- **Tabs never hide off-screen.** Skeeball's machines are in one picker.

## Look at first

1. **Hall of Fame:** gold totals per person. King of Games has 19, the same as the old By Game list.
2. **Tic Tac Toe.** The game list gives MattyIce the record, but the board's All tab puts HDJ, Inc. first. The old
   leaderboard does exactly the same thing: one counts Ultimate wins first, the other counts all wins. **Your call:**
   which one should both follow?
3. **Hold'em.** 14 people who never sat down are tied 2nd on Bankroll, the same as the old board.

## Not done yet

- **Before v2 can replace the old board for players:** v2 does not yet have the old By Player filters (difficulty,
  vs people, no-difficulty runs), its Played and Name sorts, the old player page's full per-game stats, or Arrow Maze
  Rush. The "Old" link stays until these are in or you drop them.
- **Round 2 screenshots were not pushed to the repo.** They show the family's names and the repo is public, so they
  stay in the session folder (`docs/mockups/lb2-shots/r2/`). Round 1's screenshots did go up last night
  (`docs/mockups/lb2-shots/r1/`). Say if you want those taken down.
- **The test does not cover everything yet:** silver and bronze totals, and the Me tab compared with the old You tab.

Details: `LEADERBOARD-V2-REVIEW-2.md`, `-REVIEW-3.md`, `-PLAN-R1.md`, `-PLAN-R2.md`.
Times: round 1 went live about 4:20 AM Eastern, round 2 about 4:35 AM Eastern.
