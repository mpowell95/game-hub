// tools/shoveoff-cpu-bench.mjs - Knockout: how often simple human strategies beat each computer level, and whether
// sudden death varies (2026-11-25, used to retune cpu.js). Read only, no server. Usage: node tools/shoveoff-cpu-bench.mjs [games] [--random]
// --random: every game on its own random start spots (the game's rule from 2026-11-25); without it, the fixed spots.
// Plays simple human-like strategies (side a) against the computer (side b) on rv 2 and prints win rates.
import * as E from '../shove-off/js/engine.js';
const C = await import('../shove-off/js/cpu.js');
const N = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 40);
const RANDOM = process.argv.includes('--random');
const rnd = C.rng(12345);
function human(m, kind, r) {
  const list = new Array(E.slotCount(m)).fill(null);
  const mine = m.pieces.filter((p) => p.alive && p.s === 'a'), foes = m.pieces.filter((p) => p.alive && p.s === 'b');
  for (const p of mine) {
    let q = null, bd = Infinity; for (const f of foes) { const d = (f.x - p.x) ** 2 + (f.y - p.y) ** 2; if (d < bd) { bd = d; q = f; } }
    let ang, pow;
    if (kind === 'nearest') { ang = Math.atan2(q.y - p.y, q.x - p.x); pow = 1; }
    else if (kind === 'nearest70') { ang = Math.atan2(q.y - p.y, q.x - p.x); pow = 0.7; }
    else if (kind === 'sloppy') { ang = Math.atan2(q.y - p.y, q.x - p.x) + (r() * 2 - 1) * 0.25; pow = 0.55 + r() * 0.45; }
    else if (kind === 'mixed') { if (r() < 0.3) { ang = Math.atan2(-p.y, -p.x); pow = 0.3; } else { ang = Math.atan2(q.y - p.y, q.x - p.x) + (r() * 2 - 1) * 0.15; pow = 0.6 + r() * 0.4; } }
    else if (kind === 'sidestep') { ang = Math.atan2(q.y - p.y, q.x - p.x) + (r() < 0.5 ? 1.5 : -1.5); pow = 0.35; }
    list[p.i] = E.clampAim(Math.cos(ang) * E.MAX_AIM * pow, Math.sin(ang) * E.MAX_AIM * pow);
  }
  return E.aimsToString(list);
}
const res = {};
let sdWins = { hard: [0, 0] };
for (const diff of C.DIFFS) for (const kind of ['nearest', 'nearest70', 'sloppy', 'mixed']) {
  let w = 0, l = 0, d = 0, rounds = 0;
  for (let g = 0; g < N; g++) {
    const seed = 1000 + g * 77; const m = E.newMatch(2, RANDOM ? (Math.imul(seed, 2654435761) >>> 0) || 1 : 0); const r = C.rng(seed + 5);
    while (m.winner == null && m.round < 60) {
      const cb = E.aimsToString(C.chooseAims(m, 'b', diff, C.roundSeed(seed, m.round)));
      const ca = human(m, kind, r);
      E.applyAims(m, 'a', m.round, ca); E.applyAims(m, 'b', m.round, cb);
    }
    rounds += m.round - 1;
    if (m.winner === 'a') w++; else if (m.winner === 'b') l++; else d++;
  }
  res[diff + ' vs ' + kind] = `${w}-${l}-${d}  avg rounds ${(rounds / N).toFixed(1)}`;
}
console.table(res);
// sudden death against Hard: distinct aims over seeds, and can a human ever win it?
const msd = E.newMatch(2); msd.sd = 1; msd.H = E.RULES[2].SD_H; msd.pieces = msd.pieces.filter((p) => p.i === 0).map((p) => ({ ...p, x: E.RULES[2].SD_START[p.s][0][0], y: E.RULES[2].SD_START[p.s][0][1], alive: true }));
for (const diff of C.DIFFS) {
  const seen = new Set(); for (let s = 1; s <= 40; s++) seen.add(String(C.chooseAims(msd, 'b', diff, s * 7919)[0]));
  // a human trying a grid of moves vs 40 seeds: share of (move, seed) pairs the human wins outright in one round
  let won = 0, tot = 0, bestMoveWins = 0;
  const moves = []; for (let a = 0; a < 16; a++) for (const p of [0.3, 0.6, 1]) moves.push([Math.cos(a * Math.PI / 8) * E.MAX_AIM * p, Math.sin(a * Math.PI / 8) * E.MAX_AIM * p]);
  for (const mv of moves) { let mw = 0; for (let s = 1; s <= 40; s++) {
    const m = JSON.parse(JSON.stringify(msd)); m.rounds = []; m.sent = { a: null, b: null };
    const cb = E.aimsToString(C.chooseAims(m, 'b', diff, s * 7919)); E.applyAims(m, 'a', m.round, E.aimsToString([E.clampAim(...mv)])); E.applyAims(m, 'b', m.round, cb);
    tot++; if (m.winner === 'a') { won++; mw++; } } bestMoveWins = Math.max(bestMoveWins, mw); }
  console.log(`SD ${diff}: ${seen.size} distinct opening moves over 40 seeds; a random human move wins ${(won / tot * 100).toFixed(0)}% of one-round tries; best single move wins ${bestMoveWins}/40`);
}
