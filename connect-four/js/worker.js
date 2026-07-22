// worker.js — runs the AI off the main thread so the board stays responsive
// while the engine searches (the Expert tier can take up to its time budget).
//
// Loaded as a module worker:
//   new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
//
// Protocol — main thread posts:
//   { id, kind: 'move', history, firstPlayer, difficulty, budgetMs }
//   { id, kind: 'eval', history, firstPlayer, budgetMs }
// worker replies:
//   { id, col }                                            for a 'move' request
//   { id, evals: [{col,score}], exact, reachedDepth }       for an 'eval' request
//   { id, error: <string> }                                 on failure (caller falls back to main thread)

import { Game } from './game.js';
import { AI, evaluateColumns } from './ai.js';

self.onmessage = (e) => {
  const { id, kind, history, firstPlayer, difficulty, budgetMs } = e.data;
  try {
    const game = new Game(firstPlayer);
    for (const col of history) game.play(col);
    if (kind === 'eval') {
      const evals = evaluateColumns(game.board, game.currentPlayer, budgetMs);
      self.postMessage({
        id, evals: evals.map((v) => ({ col: v.col, score: v.score })),
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
