# Word Weaver — CLAUDE-HISTORY.md

## 2026-10-28: the game is asked for, named and specified

Matt asked for a Wordscapes-style game. The name changed from **Wordscapes** (a trademark) to **Word Weaver**
(Spanish: Tejepalabras). The approved mockup is `docs/mockups/wordscapes.html`: a sunset sky, white tiles,
translucent empty slots, a white wheel, a yellow path, the round shuffle button bottom-left and the hint button
bottom-right, the current word in a pill above the wheel, the extra-words star chip and the level number top right.

Matt's decisions, settled:

- English puzzles only. A wheel of 3-7 letters, a crossword grid of at most 9x9.
- One ladder, levels in order, no difficulty choice, no replays, no levels screen; opening the game goes to the
  current level.
- **Hints are unlimited.** One tap reveals one letter. **Stars: 0 hints 3, 1 hint 2, 2 or more 1.**
- **The leaderboard is total stars.**
- Extra words (valid words that are not in the grid) count toward the star chip and have no other reward.
- Admin only at first, like every new game.

The screens were built by one agent and the level data and stats by another, in parallel, against a written data
contract (`CLAUDE.md`, "Data").

Decisions made while building the screens (not Matt's words):

- Beyond the spec, a second key `gamehub.wordweaver.best.v1` (furthest level, only grows) and a queue
  `gamehub.wordweaver.pending.v1` (completions the recorder refused) exist so a bad save can never send a player
  back to level 1 and a refused recording is retried instead of lost (THE LAW rules 2 and 6).
- A word whose cells are all shown by hints and crossings is still not "found" until it is swiped, so the grid and
  the stars cannot disagree.
