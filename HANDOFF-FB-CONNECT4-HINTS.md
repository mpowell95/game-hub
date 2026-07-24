# HANDOFF-FB-CONNECT4-HINTS: "Best Moves" misleads before the solver kicks in

**Batch 2 of the 2026-07-23 feedback arc — see HANDOFF-FB-INDEX.md.**
**For a Sonnet execution session. Recommended effort: medium-high.** Decisions made; execute,
verify, commit. Read `connect-four/CLAUDE.md` first. The solver itself is reference-verified
and CORRECT — nothing in this batch changes `expertSolve`'s results, only when it runs and how
its absence is presented.

## What actually happened (Matt's game, fully diagnosed — do not re-litigate)

Matt went first with "Show best moves" on, followed the recommendation every turn, and at 12
stones the panel showed negative numbers on every column; he then won anyway. Sequence of
causes, all code-verified:

1. Below 12 stones the exact solver never runs (`MIN_STONES_FOR_EXACT_ATTEMPT`,
   `connect-four/js/ai.js:512-514`). "Best Moves" there is `evaluateColumnsBounded` — a
   depth-limited heuristic ★ with no numbers and NO game-theoretic guarantee
   (`ai.js:327-409`). Following it for the first six moves is what drifted the game into a
   theoretically lost position. Connect Four is a first-player win only through precise play;
   a heuristic opening can and did lose the win.
2. At 12 stones exact mode engaged for the first time and correctly reported the position lost
   against perfect defense (his screenshot: best −4, rest −15).
3. He won because the difficulty he was playing is not perfect (Easy blocks 60%, Medium
   depth-5, Hard depth-9 — `ai.js:703-756`); the AI blundered and the panel correctly flipped
   to +3 the very next turn (screenshot-confirmed). The sign convention is right, from the
   human's perspective, no display bug (`ui.js:937`, `:952-954`).

The product failure: both modes present as "Best Moves." The estimate carries solver
authority it does not have, and nothing says the numbers assume a perfect opponent.

## Reference implementation, inspected 2026-07-23 (Matt found it): jsreact.com/connect4

Their solver was fetched and read (assets/solver.worker-*.js, ~11KB, unminified enough to
audit). Architecture: a client-side Web Worker, BigInt bitboard negamax, transposition Map
capped at 250k entries, center-first order `[3,2,4,1,5,0,6]`, and a Master mode that runs a
**time-boxed exact proof attempt (900ms)** per root move, keeps any proven mate/draw results
on abort, and falls back to iterative deepening (350ms; lower tiers are depth 3/4/9
heuristics). Exact search gets unlimited time only at ≤14 moves remaining (≥28 stones).
**No opening book, no WASM, no server — it does NOT solve the opening exactly either.** Its
early-game recommendation is the same class of heuristic guess ours is; the difference is
product: **it never displays evaluation numbers, only the recommended column**, so it has no
numbers to be wrong about. This validates the plan below (same architecture) and calibrates
the budgets. Do not copy their code; the repo's own solver is the reference-verified one.

## The work

### 1. Make the exact solver cover as much of the game as it can (the real fix)

- Attempt the exact solve on EVERY human turn regardless of stone count, instead of gating on
  12 stones — keep a **persistent transposition table across turns** (module-scope, cleared on
  new game, capped like the reference's 250k entries) so each successive attempt builds on the
  last, and run the attempt off the UI thread (a module Web Worker; the current in-thread 3s
  budget is why the gate exists). Time-box the per-turn attempt (the reference proves in
  900ms; in a worker we can afford 2-3s since nothing blocks). If exact doesn't land in
  budget, keep any root moves it PROVED (a found forced win/draw is still exact — render
  those numerically) and fall back to today's estimate rendering for the rest. Expected
  result: numbers appear well before 12 stones; the estimate window shrinks instead of being
  fixed.
- **Measure before promising**: in Node, time `expertSolve` from the repo's own engine on
  boards with 0, 2, 4, 6, 8, 10 stones (worst-case lines, not just one sample). Report the
  numbers in the commit message. If near-empty solves are hopeless in JS (likely), that is
  fine — the persistent-TT worker still moves the boundary earlier and every solved turn after
  it gets faster.
- OPTIONAL tier, only if the measurements make it cheap: precompute plies ≤2 offline (a Node
  script using the same engine, symmetry-folded, emitted as a tiny JSON shipped with the game)
  so the very first moves are exact. If a full offline solve is not practical, skip this tier
  and say so — do NOT hardcode opening values from memory or from the internet without
  verifying them with this repo's own solver.

### 2. Stop letting the estimate wear the solver's badge

- Estimate-mode caption (`connect-four/js/strings.js:60`) becomes explicit that it is a guess:
  en `Not solved yet · ★ = engine's guess` / es `Aún sin resolver · ★ = intuición del motor`.
  Short, per the no-prose rule. If a turn ends MIXED (some columns proven, some not), proven
  columns show their numbers, unproven show the estimate dot, and the caption uses the
  not-solved wording — never label a partially solved row "Solved".
- Solved caption (`strings.js:59`) → `Solved vs perfect play · + you win, − you lose · best
  ringed` (es equivalent).
- Menu note (`strings.js:34`) → one added sentence covering both truths: before the board is
  solvable the mark is an estimate, and solved scores assume perfect play on both sides.
- When every column is negative on the human's turn AND difficulty is below `expert`, render
  one muted line under the caption (new string): en `The computer at this level can still make
  mistakes.` / es `El ordenador en este nivel todavía puede fallar.` (`renderEvalRow`,
  `connect-four/js/ui.js:932-972`).

### 3. Unchanged

The hint toggle's availability, the stats disqualification (`ui.js:465`), the AI difficulties,
and every stored id. `expertSolve`'s semantics and tests are untouched — the worker calls the
same function.

## Verification

1. `node run-all-tests.mjs` green (engine tests must be byte-identical in result).
2. The measurement table from work-item 1 in the commit message.
3. Browser: fresh game with hints — numbers appear earlier than stone 12 (state the observed
   boundary); mid-game UI never jank-freezes while the worker runs; estimate caption shows the
   new wording until numbers land; all-negative + sub-Expert shows the fallibility line;
   Expert does not. EN and ES; `node test-i18n-strings.mjs` green.
4. `sw.js` CACHE bump LAST (add the worker file to `ASSETS` — run
   `node validate-sw-assets.mjs`). Update `connect-four/CLAUDE.md` (two-mode design, worker,
   persistent TT), rule 9.
