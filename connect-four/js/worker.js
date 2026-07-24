// worker.js — runs the AI off the main thread so the board stays responsive
// while the engine searches (the Expert tier can take up to its time budget).
//
// Loaded as a module worker:
//   new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
//
// Protocol — main thread posts:
//   { id, kind: 'move', history, firstPlayer, difficulty, budgetMs }
//   { id, kind: 'eval', history, firstPlayer, budgetMs }
//   { id, kind: 'newgame' }
// worker replies:
//   { id, col }                                                    for a 'move' request
//   { id, evals: [{col,score,exact}], exact, reachedDepth }         for an 'eval' request
//   { id }                                                          for a 'newgame' request
//   { id, error: <string> }                                         on failure (caller falls back to main thread)
//
// The Expert exact solver's transposition table (ai.js's module-scope
// `transTable`) lives for as long as this worker does, so it accumulates
// across every 'eval'/'move' request for the whole game (2026-07-23: Pass 1 of
// evaluateColumns now attempts an exact solve on every turn, not just once the
// board is deep enough — see ai.js's evaluateColumns doc comment). 'newgame'
// clears it so a rematch starts cold rather than carrying the previous game's
// cache indefinitely.

import { Game } from './game.js';
import { AI, evaluateColumns, clearTranspositionTable } from './ai.js';

self.onmessage = (e) => {
  const { id, kind, history, firstPlayer, difficulty, budgetMs } = e.data;
  try {
    if (kind === 'newgame') {
      clearTranspositionTable();
      self.postMessage({ id });
      return;
    }
    const game = new Game(firstPlayer);
    for (const col of history) game.play(col);
    if (kind === 'eval') {
      const evals = evaluateColumns(game.board, game.currentPlayer, budgetMs);
      self.postMessage({
        id, evals: evals.map((v) => ({ col: v.col, score: v.score, exact: v.exact })),
        exact: evals.exact, reachedDepth: evals.reachedDepth,
      });
    } else {
      const ai = new AI(difficulty, { expertBudgetMs: budgetMs });
      self.postMessage({ id, col: ai.chooseMove(game) });
    }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
