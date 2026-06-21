// sim.js — headless full-match simulation (all AI). Node only; not deployed.
// Exercises game.js + ai.js + meld.js end-to-end to catch integration bugs.
//   node chinchon/js/sim.js

import { Game, makePlayer } from './game.js';
import { AIAgent } from './ai.js';

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0x100000000; }; }

async function run(seed, config) {
  const rng = lcg(seed);
  const players = [0, 1, 2].map((i) =>
    makePlayer({ id: i, name: 'AI' + i, difficulty: 'normal', agent: new AIAgent({ difficulty: 'normal', rng }) }));
  const g = new Game({ players, config, rng });

  let rounds = 0, closes = 0, chinchons = 0, doubles = 0, exhaustions = 0;
  g.onEvent = async (type) => {
    if (type === 'close') closes++;
    if (type === 'roundScored') {
      rounds++;
      if (g.closeType === 'chinchon') chinchons++;
      if (g.closeType === 'doubleMeld') doubles++;
      if (g.closeType === 'exhaustion') exhaustions++;
      if (rounds > 500) g.abort(); // safety net against a non-terminating match
    }
  };

  await g.playMatch();
  return { g, rounds, closes, chinchons, doubles, exhaustions };
}

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.error('  FAIL:', name)); };

const totals = { rounds: 0, closes: 0, chinchons: 0, doubles: 0, exhaustions: 0 };
for (let seed = 1; seed <= 30; seed++) {
  const r = await run(seed, { scoreLimit: 80, placeOnEnding: seed % 2 ? 'auto' : 'manual' });
  const g = r.g;
  ok(`seed ${seed}: a winner emerged`, !!g.winner);
  ok(`seed ${seed}: standings complete`, g.standings && g.standings.length === 3);
  ok(`seed ${seed}: scoreHistory tracks every round`, g.players.every((p) => p.scoreHistory.length === r.rounds + 1));
  ok(`seed ${seed}: match actually ended (<=500 rounds)`, r.rounds <= 500);
  totals.rounds += r.rounds; totals.closes += r.closes;
  totals.chinchons += r.chinchons; totals.doubles += r.doubles; totals.exhaustions += r.exhaustions;
}

ok('at least some rounds were closed across runs', totals.closes > 0);

console.log(`\nSim over 30 matches: ${totals.rounds} rounds, ${totals.closes} closes ` +
  `(${totals.chinchons} chinchón, ${totals.doubles} double-meld, ${totals.exhaustions} exhaustion).`);
console.log(`Chinchón simulation: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
