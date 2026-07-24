# Connect Four (`connect-four/`)

> **THE LAW applies to every file in this folder.** Player data is never deleted, never lost,
> never put at risk — THE LAW and its nine working rules sit at the top of the root `CLAUDE.md`, which is always
> loaded alongside this file (full rule rationale: `js/CLAUDE.md`). Settings keys, saves, and stats written by this game are governed by
> it: writes additive, keys never repurposed, no silent write failures.

Hub integration: in-hub `module:`.

## Notes

AI in a Web Worker (`new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`) with a main-thread fallback; needs the worker for its multi-second Expert solver. `ui.js`'s `_statsDisqualified` flag (2026-07-22): set by a confirmed undo or by confirming "Show best moves" (one shared flag, reset per game in `startGame()` - a rematch that starts with hints still on from before is pre-disqualified, silently, no re-prompt); `recordConnect4` is skipped entirely for a disqualified game and the result banner says so. The exact solver (`expertSolve`/`chooseExpert`, bitboard negamax + transposition table) has always been correct on its own (`test.js`'s "expert value matches reference" suite); what WAS a real bug (2026-07-22, batch 10) was `evaluateColumns`' "Estimate" fallback for the hint panel - it burned half its budget on a Pass 1 exact-solve attempt that's hopeless below `MIN_STONES_FOR_EXACT_ATTEMPT` (12 stones, measured empirically), starving the heuristic fallback of the depth it needed, so the empty board read as losing on every column. Fixed by skipping that doomed attempt early and replacing the fallback with a bitboard depth-limited negamax (`evaluateColumnsBounded`/`negamaxBounded`, reusing the exact solver's own move-ordering/win-detection primitives plus a bitboard port of the window-scoring heuristic) - reaches roughly 3-6x the depth in the same wall-clock time, so the empty board now reads center-highest and positive within the existing 3s hint budget. Also backs Expert's opening-fallback move choice (`chooseSearchTimed`), replacing a separate, weaker Board-object search there too. Still labeled "Estimate (depth N)", never "Solved", unless the value is actually exact. Discs also carry a shape token per THE LAW rule 9 (`.cf-piece.p1`/`.p2::after`, batch 10): P1 a ring, P2 a diamond, tonal (a darker shade of the disc's own color) rather than a second competing hue.

i18n: `connect-four/js/strings.js` (`{ en, es }`), `ui.js` builds `t()` at render time. Difficulty
values (`easy`/`medium`/`hard`/`expert`, `ai.js`'s `Difficulty` enum) stay canonical; only display
labels translate. The hidden-challenge strings in `syncChallengeUi()` are translated too even
though unreachable (`challengeActive` is hardcoded `false`), for consistency if it's ever revived.

### Hint panel: per-column exact/estimate mix (2026-07-23, batch 2 of the 2026-07-23 feedback arc)

`evaluateColumns` (`ai.js`) no longer gates the exact solver on a stone-count threshold. It runs
**two passes every call**, each on its own time slice so neither starves the other:
- **Pass 1** attempts an exact solve (`expertSolve`) for as many legal columns as fit in
  `exactBudgetMs` (default `DEFAULT_EXACT_ATTEMPT_BUDGET_MS` = 2500ms, worker path; the main-thread
  fallback in `ui.js` passes `INLINE_EXACT_ATTEMPT_MS` = 300ms instead, since that path blocks the
  UI thread). Columns proven before the deadline keep their exact value even if later columns
  time out — a proven result doesn't get discarded just because the position as a whole couldn't
  be fully solved this turn.
- **Pass 2** runs the bitboard depth-limited estimate (`evaluateColumnsBounded`) on whatever
  columns Pass 1 didn't prove, on its own full `budgetMs` (unaffected by however long Pass 1 took).
- Each returned `{ col, score, exact }` carries its own `exact` flag; the array-level `.exact` is
  true only when every column got proven. A turn can be fully solved, fully estimated, or a mix —
  `ui.js`'s `renderEvalRow` never labels a mixed row "Solved".
- The exact solver's transposition table (`transTable`, module scope in `ai.js`) is **persistent
  across the whole game** — every turn's Pass 1 attempt builds on the last, so the "when do numbers
  first appear" boundary shrinks as the game goes on instead of staying fixed at a hardcoded stone
  count. `worker.js`'s new `'newgame'` message (`clearTranspositionTable()`, called from
  `ui.js`'s `startGame()`) resets it for a fresh game/rematch.
- Measured cold (TT cleared before each solve — the worst case; a real session only gets faster
  than this): a single column's exact solve took 5.5-12.6s at 8 stones, 0.27-2.8s at 10 stones, and
  exceeded 25s at 6 stones. So most early turns still prove nothing within the budget, same
  practical effect as the old 12-stone gate — but the wasted attempts are not actually wasted,
  because the TT persists.
- `renderEvalRow` picks the single recommended column ("best") by: a proven win (exact, score > 0)
  always wins if one exists; else, if every column is exact this turn, compare exact scores
  directly; else, rank only the estimate columns (exact non-win scores use the Pons scale, which
  isn't comparable to the estimate's `evalBitboard`/`WIN_BASE` scale, so they're shown but not
  ranked against estimates).
- Caption copy (`strings.js`) is now honest about what it's showing: `eval_solved` (all columns
  proven) says "vs perfect play"; `eval_estimate` (any column unproven) says "Not solved yet · ★ =
  engine's guess" — no depth number, since depth isn't meaningful once some columns are exact. A
  new `eval_fallible` line ("The computer at this level can still make mistakes.") renders under
  the caption whenever every column's score is negative AND the difficulty is below Expert, so a
  losing-everywhere estimate (which the heuristic can still show near the opening — this is
  inherent depth-parity oscillation in the eval function, not a bug; see the AI.test() case 5
  comment in `ai.js`) doesn't read as hopeless against an AI that isn't actually perfect at that
  difficulty.
