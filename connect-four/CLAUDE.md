# Connect Four (`connect-four/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — the nine full rules are stated near the top of the root `CLAUDE.md`, which is always
> loaded alongside this file. Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

AI in a Web Worker (`new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`) with a main-thread fallback; needs the worker for its multi-second Expert solver. `ui.js`'s `_statsDisqualified` flag (2026-07-22): set by a confirmed undo or by confirming "Show best moves" (one shared flag, reset per game in `startGame()` - a rematch that starts with hints still on from before is pre-disqualified, silently, no re-prompt); `recordConnect4` is skipped entirely for a disqualified game and the result banner says so. The exact solver (`expertSolve`/`chooseExpert`, bitboard negamax + transposition table) has always been correct on its own (`test.js`'s "expert value matches reference" suite); what WAS a real bug (2026-07-22, batch 10) was `evaluateColumns`' "Estimate" fallback for the hint panel - it burned half its budget on a Pass 1 exact-solve attempt that's hopeless below `MIN_STONES_FOR_EXACT_ATTEMPT` (12 stones, measured empirically), starving the heuristic fallback of the depth it needed, so the empty board read as losing on every column. Fixed by skipping that doomed attempt early and replacing the fallback with a bitboard depth-limited negamax (`evaluateColumnsBounded`/`negamaxBounded`, reusing the exact solver's own move-ordering/win-detection primitives plus a bitboard port of the window-scoring heuristic) - reaches roughly 3-6x the depth in the same wall-clock time, so the empty board now reads center-highest and positive within the existing 3s hint budget. Also backs Expert's opening-fallback move choice (`chooseSearchTimed`), replacing a separate, weaker Board-object search there too. Still labeled "Estimate (depth N)", never "Solved", unless the value is actually exact. Discs also carry a shape token per THE LAW rule 9 (`.cf-piece.p1`/`.p2::after`, batch 10): P1 a ring, P2 a diamond, tonal (a darker shade of the disc's own color) rather than a second competing hue.
