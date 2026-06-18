// worker.js — runs the AI off the main thread so the board stays responsive
// while the engine searches (the Expert tier can take up to its time budget).
//
// Loaded as a module worker:
//   new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
//
// Protocol — main thread posts:
//   { id, history, firstPlayer, difficulty, budgetMs }
// worker replies:
//   { id, col }                 on success
//   { id, error: <string> }     on failure (caller falls back to main thread)

import { Game } from './game.js';
import { AI } from './ai.js';

self.onmessage = (e) => {
  const { id, history, firstPlayer, difficulty, budgetMs } = e.data;
  try {
    const game = new Game(firstPlayer);
    for (const col of history) game.play(col);
    const ai = new AI(difficulty, { expertBudgetMs: budgetMs });
    self.postMessage({ id, col: ai.chooseMove(game) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
