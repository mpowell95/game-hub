// SIMULATION of Tic Tac Toe Classic Hard v2 (2026-11-16). The simulated person plays the best move, except
// with chance `q` a random one. Usage: node tools/sim-ttt-hard.mjs [games] [slip ...]
import { newClassicGame, applyMoveClassic, legalMovesClassic } from '../tic-tac-toe/js/game.js';
import { chooseClassicMove } from '../tic-tac-toe/js/ai.js';

function rngOf(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function game(q, aiOpts, seed, personFirst) {
  const rng = rngOf(seed); const s = newClassicGame('X'); const pm = personFirst ? 'X' : 'O';
  while (!s.over) {
    let m;
    if (s.turn === pm) {
      const l = legalMovesClassic(s);
      m = rng() < q ? l[Math.floor(rng() * l.length)] : chooseClassicMove(s, 'pro', rng);
    } else m = chooseClassicMove(s, 'pro', rng, aiOpts);
    applyMoveClassic(s, m);
  }
  return s.isDraw ? 'D' : (s.winner === pm ? 'W' : 'L');
}

const n = Number(process.argv[2] || 2000);
for (const slip of process.argv.slice(3).map(Number)) {
  for (const q of [0, 0.05, 0.1]) {
    const r = { W: 0, L: 0, D: 0 };
    for (let i = 0; i < n; i++) r[game(q, slip ? { v2: true, slip } : null, 5 + i, i % 2 === 0)]++;
    console.log(`Hard slip ${slip}, person slip ${q}: W${(100 * r.W / n).toFixed(1)}% D${(100 * r.D / n).toFixed(1)}% L${(100 * r.L / n).toFixed(1)}%`);
  }
}
