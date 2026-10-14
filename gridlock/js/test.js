// gridlock/js/test.js - headless checks of the engine and the shipped levels.
// Run: node gridlock/js/test.js
//
// Every shipped level is re-solved from scratch by the game's own solver: its stated fewest moves
// must be exactly right (the stars are judged against it), it must not start solved, its blocks
// must be well formed, and the ladder must get harder smoothly. The first SHIPPED levels are then
// pinned by hash: a player's progress is "cleared levels 1..n", so changing a shipped level would
// change what they cleared (gridlock/CLAUDE.md, "The levels").
import { createHash } from 'node:crypto';
import { parse, positions, solve, range, moves, isSolved, serialize, N, EXIT_ROW, SOLVED_POS } from './engine.js';
import { LEVELS } from './levels.js';
import { readFileSync } from 'node:fs';
import { GL_BAND_START, glBandOf } from '../../js/gridlock-points.js';
import { V1_TO_V2 } from '../../js/gridlock-v1map.js';

let fails = 0;
const ok = (label, cond) => { if (!cond) { fails++; console.log('FAIL ', label); } };

// --- the engine on a known puzzle -------------------------------------------------------------
// Michael Fogleman's published 60-move puzzle (one wall), https://michaelfogleman.com/rush.
{
  const pz = parse('IBBxooIooLDDJAALooJoKEEMFFKooMGGHHHM');
  const path = solve(pz, positions(pz));
  ok('engine: Fogleman\'s 60-move puzzle solves in 60', path && path.length === 60);
  // Replaying the solution move by move is legal at every step and ends solved.
  const pos = positions(pz);
  let legal = true;
  for (const [i, q] of path) { const r = range(pz, pos, i); if (q < r.lo || q > r.hi) legal = false; pos[i] = q; }
  ok('engine: the solution is legal step by step and ends solved', legal && isSolved(pos));
}
ok('engine: a solved board answers []', solve(parse('o'.repeat(16) + 'AA' + 'o'.repeat(18)), [SOLVED_POS]).length === 0);
{
  const pz = parse('ooooooooooooAAoBoooooBoooooooooooooo');
  ok('engine: a block in the way is moved', solve(pz, positions(pz)).length === 2);
  ok('engine: moves() lists every slide (red 1, the block 4)', moves(pz, positions(pz)).length === 1 + 4);
}
for (const bad of ['', 'x'.repeat(36), 'oooooooooooooAoooooooooooooooooooooo', 'ooooooooooooAAAooooooooooooooooooooo']) {
  let threw = false;
  try { parse(bad); } catch { threw = true; }
  ok(`engine: rejects a malformed board "${bad.slice(0, 12)}..."`, threw);
}

// --- the shipped levels -----------------------------------------------------------------------
ok('levels: Easy, Medium and Hard are full (3000) and Expert has some', LEVELS.length > 3000);
const seen = new Set();
let worst = 0, prev = 0, biggestDrop = 0;
const t0 = performance.now();
const byBand = {};
LEVELS.forEach((line, k) => {
  const n = k + 1;
  const [board, d] = line.split(' ');
  const fewest = +d;
  let pz;
  try { pz = parse(board); } catch (e) { ok(`level ${n}: parses (${e.message})`, false); return; }
  const pos = positions(pz);
  ok(`level ${n}: not already solved`, !isSolved(pos));
  ok(`level ${n}: nothing but red lies across the exit row`, pz.pieces.every((p, i) => i === 0 || !p.h || p.line !== EXIT_ROW));
  ok(`level ${n}: walls only from Hard on`, pz.walls.length === 0 || n >= GL_BAND_START.hard);
  const s = performance.now();
  const path = solve(pz, pos);
  worst = Math.max(worst, performance.now() - s);
  ok(`level ${n}: solvable in exactly ${fewest} (solver says ${path && path.length})`, path && path.length === fewest);
  ok(`level ${n}: stored in canonical letters`, serialize(pz, pos) === board);
  ok(`level ${n}: unique`, !seen.has(board));
  seen.add(board);
  if (prev) biggestDrop = Math.max(biggestDrop, prev - fewest);
  prev = fewest;
  const b = glBandOf(n);
  (byBand[b] ||= []).push(fewest);
});
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
for (const b of Object.keys(byBand)) console.log(`${b}: ${byBand[b].length} levels, fewest moves ${Math.min(...byBand[b])}..${Math.max(...byBand[b])}, average ${avg(byBand[b]).toFixed(1)}`);
console.log(`slowest solve (the hint) ${worst.toFixed(1)} ms; biggest drop between neighbours ${biggestDrop}`);
ok('ladder: each band is harder on average than the one before', ['easy', 'medium', 'hard', 'expert'].filter((b) => byBand[b]).map((b) => avg(byBand[b])).every((v, i, a) => i === 0 || v > a[i - 1]));
ok('ladder: no level is more than 1 move easier than the one before it', biggestDrop <= 1);
ok('hint: the slowest solve stays under 150 ms', worst < 150);

// --- ladder 1 is frozen, and every one of its boards is on ladder 2 where the map says ----------
// (2026-10-14: the first build's 400 levels became part of the 4000-level ladder 2; a level a player
// cleared on ladder 1 is read as the same board, js/gridlock-points.js.)
{
  const v1 = readFileSync(new URL('../data/levels-v1.txt', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const h1 = createHash('sha256').update(v1.join('\n')).digest('hex').slice(0, 16);
  ok(`ladder 1: the frozen 400 levels are unchanged (${h1})`, v1.length === 400 && h1 === 'da9ad67d1c763857');
  ok('ladder 1: the map has one ladder 2 level for each', V1_TO_V2.length === 400 && new Set(V1_TO_V2).size === 400);
  ok('ladder 1: every board is where the map says, with the same fewest moves', v1.every((line, k) => LEVELS[V1_TO_V2[k] - 1] === line));
}

// --- the pin: shipped levels never change ----------------------------------------------------
// PINNED = how many ladder 2 levels have shipped. To add Expert levels, APPEND (keep every existing
// line) and leave this hash alone; it covers only the first PINNED lines.
const PINNED = 0;
const PIN_HASH = '';
if (PINNED) {
  const h = createHash('sha256').update(LEVELS.slice(0, PINNED).join('\n')).digest('hex').slice(0, 16);
  ok(`pin: the first ${PINNED} shipped levels are unchanged (${h})`, h === PIN_HASH);
}

console.log(fails ? `${fails} FAILED` : `all gridlock engine and level checks pass (${LEVELS.length} levels)`);
process.exit(fails ? 1 : 0);
