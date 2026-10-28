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

## 2026-10-28 (later): the setup screen and the four difficulties

Matt, after playing it: *"it's sweet. Add a setup screen tho. and difficulties so you can start on more
challenging ones"*, then: harder bands are worth more (points = stars x 1 / 2 / 3 / 4, shown on the setup screen
as the leaderboard number; the done screen keeps stars).

- The one ladder is cut into four bands (Easy 1, Medium 501, Hard 1001, Expert 1501), each played in order, still
  no replays and no levels screen. A band's next level is read from the phone's own stats store (`ww.lv`) plus the
  pending queue, so a completed level is never offered twice.
- The game opens on a setup screen modelled on Gridlock's (title, points, four difficulties, Play, How to play,
  nothing else). The play screen gets Gridlock's back arrow, top left on the row under the Hub button (Matt has
  complained twice about a back button touching the Hub button); the chips stay on the Hub button's row. That row
  costs about 56px of height, so a 9-row grid on a 375x667 phone has ~25px cells (the wheel gives back down to 184px).
- **Save migration (THE LAW):** the single live save (`save.v1`) moves ONCE into `save.v2`'s band for its level, with
  its words, hints and cells; `save.v1` is never written or deleted; `best.v1` is left as stored and no longer read.
  Tested with a hand-built v1 save in the shape the live `ui.js` wrote (level 7, a found word, an extra, 2 hints, 2
  revealed cells): it resumes in Easy with all of it, `save.v1` byte-identical afterwards.
