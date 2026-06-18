# Connect Four — Session 1 Kickoff Prompt (Engine Only)

Paste this into Claude Code to start.

---

I'm building Connect Four with a genuinely strong AI. It'll eventually live
inside a multi-game hub, but whether that hub is the existing business-deal
repo restructured or a brand new repo is still undecided — don't worry about
that for this session. Build this as a fully self-contained module in its
own folder so it can be dropped into either structure later without rework.

The full design spec is in `game-hub-and-connect-four-spec.md` in this
folder — read it in full before starting, especially the "Connect Four
Module Spec" section. That's the source of truth for board representation,
difficulty tiers, and the session plan. This prompt only covers Session 1.

For this session, build ONLY the engine — no AI, no UI yet:

1. Create folder structure: `connect-four/js/`
2. Build `board.js` — bitboard representation of the 7-column × 6-row
   board (two bit-packed integers, one per player, using `BigInt` since JS
   has no native 64-bit integers). Include:
   - Move generation (which columns are legal/not full)
   - Placing a piece in a column
   - Win detection: horizontal, vertical, both diagonals
   - Draw detection (board full, no winner)
   - A way to get/restore full board state as a value, for use as a
     transposition table key in a later session
3. Build `game.js` — turn state machine wrapping `board.js`: whose turn it
   is, legal moves available, game-over detection (win/draw), and a simple
   move history list.
4. Add a headless test function — `board.test()` and/or `game.test()` —
   that plays a few scripted move sequences (a known vertical/horizontal/
   diagonal win, and a known full-board draw) and logs pass/fail to the
   console. No UI needed for this.

Do not build the AI or UI in this session — engine only. AI (all four
difficulty tiers from the spec, including the full-search Expert tier)
comes in Session 2. UI comes after that.
