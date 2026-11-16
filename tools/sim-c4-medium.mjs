// SIMULATION of Connect Four Medium (2026-11-16). A simulated "person" = a depth-d search that plays a
// random column with chance `slip`. Calibrated to win ~5% against today's Medium (the real rate), then
// run against the new Medium. Usage: node tools/sim-c4-medium.mjs [games] [depth,slip ...]
import { Game } from '../connect-four/js/game.js';
import { AI, Difficulty, _internals } from '../connect-four/js/ai.js';
import { PLAYER_ONE, PLAYER_TWO } from '../connect-four/js/board.js';

function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function personMove(game, depth, slip, rng) {
  if (rng() < slip) { const m = game.legalMoves(); return m[Math.floor(rng() * m.length)]; }
  const sc = _internals.scoreMovesAtDepth(game.board, game.currentPlayer, depth);
  let best = -Infinity; for (const s of sc) best = Math.max(best, s.score);
  const pool = sc.filter((s) => s.score === best);
  return pool[Math.floor(rng() * pool.length)].col;
}

export function play(person, aiOpts, seed, personFirst) {
  const rng = rngOf(seed);
  const pP = personFirst ? PLAYER_ONE : PLAYER_TWO;
  const game = new Game(PLAYER_ONE);
  const ai = new AI(Difficulty.MEDIUM, { ...aiOpts, seed: (seed * 7919) >>> 0 });
  while (!game.isOver()) {
    const col = game.currentPlayer === pP ? personMove(game, person.depth, person.slip, rng) : ai.chooseMove(game);
    game.play(col);
  }
  return game.winner === null ? 'D' : (game.winner === pP ? 'W' : 'L');
}

export function rate(person, aiOpts, n) {
  const r = { W: 0, L: 0, D: 0 };
  for (let i = 0; i < n; i++) r[play(person, aiOpts, 1000 + i, i % 2 === 0)]++;
  return r;
}

if (process.argv[1].endsWith('sim-c4-medium.mjs')) {
  const n = Number(process.argv[2] || 200);
  const people = process.argv.slice(3).map((a) => { const [d, s] = a.split(','); return { depth: +d, slip: +s }; });
  for (const p of people) {
    const old = rate(p, {}, n), nu = rate(p, { v2: true, ...(process.env.V2SLIP ? { v2Slip: +process.env.V2SLIP } : {}), ...(process.env.V2DEPTH ? { v2Depth: +process.env.V2DEPTH } : {}) }, n);
    console.log(`person d${p.depth} slip ${p.slip}: old Medium W${old.W} L${old.L} D${old.D} (${(100*old.W/n).toFixed(0)}%)  new Medium W${nu.W} L${nu.L} D${nu.D} (${(100*nu.W/n).toFixed(0)}%)`);
  }
}
