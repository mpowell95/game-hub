// worker.js — runs Poolv2's AI decision search off the main thread. BUILD-SPEC.md
// §6 #8: a decision can run ~90 full simulateToRest lookaheads (one per candidate
// ghost-ball aim x pocket) synchronously; on the main thread that stalls animation
// and input for the whole search. ai.js is pure/headless (no DOM), so it can run
// here unchanged.
//
// Loaded as a module worker:
//   new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
//
// Protocol — main thread posts { id, state, seat, difficulty, seed }
// worker replies { id, shot } (chooseShot's return value) or { id, error }.
import { chooseShot } from './ai.js';
import { mulberry32 } from './rng.js';

self.onmessage = (e) => {
  const { id, state, seat, difficulty, seed } = e.data;
  try {
    const shot = chooseShot(state, seat, difficulty, mulberry32(seed >>> 0));
    self.postMessage({ id, shot });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
