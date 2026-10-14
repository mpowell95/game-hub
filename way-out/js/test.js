// way-out/js/test.js - headless engine checks. Run: node way-out/js/test.js
//
// For every tier, levels 1-60: the board is well formed (every arrow is a chain of at least two
// adjacent, distinct points; no point is used twice), it is the same board every time it is built,
// and a player who only ever taps clear arrows clears it (engine.js's header says why that greedy
// check is a proof of solvability, not a sample of it).
import { createHash } from 'node:crypto';
import { TIERS, buildLevel, levelSpec, rampTarget, occupancy, blockerOf, hintArrow, generate, seedOf, peel, buildLadder, bandOf, bandEnd, BAND_START } from './engine.js';

let fails = 0;
const ok = (label, cond) => { if (!cond) { fails++; console.log('FAIL ', label); } };

for (const tier of TIERS) {
  let worstMs = 0, minFill = 1, arrowsAt1 = 0;
  for (let level = 1; level <= 60; level++) {
    const t0 = performance.now();
    const lvl = buildLevel(tier, level);
    worstMs = Math.max(worstMs, performance.now() - t0);
    const { cols: W, rows: H, arrows } = lvl;
    const spec = levelSpec(tier, level);
    ok(`${tier} ${level}: size`, W === spec.cols && H === spec.rows);
    ok(`${tier} ${level}: has arrows`, arrows.length > 0);
    if (level === 1) arrowsAt1 = arrows.length;

    const seen = new Set();
    for (const cells of arrows) {
      ok(`${tier} ${level}: arrow length >= 2`, cells.length >= 2);
      for (let k = 0; k < cells.length; k++) {
        ok(`${tier} ${level}: point used once`, !seen.has(cells[k]));
        seen.add(cells[k]);
        if (k) {
          const a = cells[k - 1], b = cells[k];
          const d = Math.abs((a % W) - (b % W)) + Math.abs(((a / W) | 0) - ((b / W) | 0));
          ok(`${tier} ${level}: adjacent`, d === 1);
        }
      }
    }
    minFill = Math.min(minFill, seen.size / (W * H));

    const again = buildLevel(tier, level);
    ok(`${tier} ${level}: deterministic`, JSON.stringify(again) === JSON.stringify(lvl));

    // Greedy solve, driven by the same hint the player gets.
    const gone = new Array(arrows.length).fill(false);
    let left = arrows.length, guard = 0;
    while (left && guard++ < 100000) {
      const id = hintArrow(lvl, gone, null);
      if (id < 0) break;
      gone[id] = true; left--;
    }
    ok(`${tier} ${level}: solvable`, left === 0);

    // And at least one arrow is blocked at the start of every level past Easy 1 (it is a puzzle).
    if (!(tier === 'easy' && level === 1)) {
      const occ = occupancy(lvl, new Array(arrows.length).fill(false));
      ok(`${tier} ${level}: something is blocked`, arrows.some((c, id) => blockerOf(c, occ, W, H, id)));
    }
  }
  console.log(`${tier}: 60 levels ok-checked, level 1 has ${arrowsAt1} arrows, lowest fill ${(minFill * 100).toFixed(0)}%, slowest build ${worstMs.toFixed(1)} ms`);
}

// The rule itself, on a hand-made board: a 4x1 strip, arrow A = [0,1] pointing right, B = [2,3].
{
  const lvl = { cols: 4, rows: 1, arrows: [[0, 1], [2, 3]] };
  const occ = occupancy(lvl, [false, false]);
  const b = blockerOf(lvl.arrows[0], occ, 4, 1, 0);
  ok('A is blocked by B one step ahead', b && b.steps === 1 && b.cell === 2);
  ok('B is clear', blockerOf(lvl.arrows[1], occ, 4, 1, 1) === null);
  ok('hint picks B', hintArrow(lvl, [false, false], null) === 1);
  ok('after B goes, A is clear', blockerOf(lvl.arrows[0], occupancy(lvl, [false, true]), 4, 1, 0) === null);
}
// An arrow whose way out runs back through its own body is blocked by itself: on a 3x3 grid the
// spiral 2 -> 1 -> 0 -> 3 -> 6 -> 7 -> 4 ends at the centre pointing UP, straight into point 1.
{
  const lvl = { cols: 3, rows: 3, arrows: [[2, 1, 0, 3, 6, 7, 4]] };
  const occ = occupancy(lvl, [false]);
  const b = blockerOf(lvl.arrows[0], occ, 3, 3, 0);
  ok('a spiral pointing back into itself is blocked', b && b.cell === 1);
}

// Generator 2 is HARD (2026-10-12, Matt: "way too easy"): averaged over levels 2-21, at most this
// share of arrows may be free at the first tap, and the board must take at least this many rounds.
// Generator 1's Medium measured 0.46 / 5.0. A future change that quietly makes boards easy fails here.
// Expert's floor is generator 3's (2026-10-13): it must be DEEPER than Hard, not just bigger.
const FLOOR = { easy: [0.36, 5], medium: [0.32, 8], hard: [0.34, 12], expert: [0.32, 22] };
const avgRounds = {};
for (const tier of TIERS) {
  let c0 = 0, ly = 0;
  for (let level = 2; level <= 21; level++) {
    const l = buildLevel(tier, level);
    const m = peel(l.cols, l.rows, l.arrows);
    c0 += m.clear0; ly += m.layers;
  }
  c0 /= 20; ly /= 20; avgRounds[tier] = ly;
  console.log(`${tier}: the latest generator averages ${(c0 * 100).toFixed(0)}% free at the start, ${ly.toFixed(1)} rounds`);
  ok(`${tier}: hard enough (free ${c0.toFixed(2)} <= ${FLOOR[tier][0]}, rounds ${ly.toFixed(1)} >= ${FLOOR[tier][1]})`, c0 <= FLOOR[tier][0] && ly >= FLOOR[tier][1]);
}
// Generator 1 is kept unchanged, so a level saved before generator 2 rebuilds to the same board.
for (const tier of TIERS) for (const level of [1, 5, 17]) {
  ok(`${tier} ${level}: generator 1 unchanged`, JSON.stringify(buildLevel(tier, level, 1)) === JSON.stringify(generate(levelSpec(tier, level), seedOf(tier, level))));
}
ok('expert takes more rounds than hard', avgRounds.expert >= avgRounds.hard + 4);
// Generator 2 is kept unchanged too (a level saved on it rebuilds to the same board), and generator 3
// changes Expert only. The hash is of generator 2's levels 1-30 of every tier, taken when 3 shipped.
{
  const h = createHash('sha256');
  for (const tier of TIERS) for (let level = 1; level <= 30; level++) h.update(JSON.stringify(buildLevel(tier, level, 2)));
  ok('generator 2 unchanged', h.digest('hex').slice(0, 16) === 'b7ea80d6596f2252');
}
for (const tier of ['easy', 'medium', 'hard']) for (const level of [2, 9, 30]) {
  ok(`${tier} ${level}: generator 3 = generator 2`, JSON.stringify(buildLevel(tier, level, 3)) === JSON.stringify(buildLevel(tier, level, 2)));
}
// Generator 3 is kept unchanged too (pinned the day generator 4 shipped), and generator 4 is
// generator 3 for levels 1-13 (2026-10-13).
{
  const h = createHash('sha256');
  for (const tier of TIERS) for (let level = 1; level <= 30; level++) h.update(JSON.stringify(buildLevel(tier, level, 3)));
  ok('generator 3 unchanged', h.digest('hex').slice(0, 16) === '64c5cd7f026bc693');
}
for (const tier of TIERS) for (const level of [1, 7, 13]) {
  ok(`${tier} ${level}: generator 4 = generator 3 before the ramp`, JSON.stringify(buildLevel(tier, level, 4)) === JSON.stringify(buildLevel(tier, level, 3)));
}
// Generator 4's ramp (Matt: "make later levels keep getting harder"): levels 64-73 must take clearly
// more rounds than levels 14-23, and the target never goes down as the level goes up.
for (const tier of TIERS) {
  const avg = (a, b) => { let s = 0; for (let l = a; l <= b; l++) { const v = buildLevel(tier, l); s += peel(v.cols, v.rows, v.arrows).layers; } return s / (b - a + 1); };
  const early = avg(14, 23), late = avg(64, 73);
  console.log(`${tier}: rounds at levels 14-23 ${early.toFixed(1)}, at 64-73 ${late.toFixed(1)}`);
  ok(`${tier}: later levels are harder`, late >= early + 1.5);
  let up = true;
  for (let l = 14; l < 200; l++) if (rampTarget(tier, l + 1) < rampTarget(tier, l)) up = false;
  ok(`${tier}: the ramp never goes down`, up && rampTarget(tier, 13) === null);
}
ok('easy 1 stays the gentle generator-1 board', JSON.stringify(buildLevel('easy', 1)) === JSON.stringify(buildLevel('easy', 1, 1)));

// THE LADDER (2026-10-14, Matt: "I want easy level 50 to be basically medium level 51. There
// shouldn't be a big jump between individual levels"). Every ladder level 1-230: well formed,
// deterministic, solvable by the player's own hint; the grid never shrinks and grows by at most one
// dot a level; neighbouring levels differ by at most 4 rounds; and the band edges are seamless.
{
  const info = [];
  let worstMs = 0;
  for (let n = 1; n <= 230; n++) {
    const t0 = performance.now();
    const lvl = buildLadder(n);
    worstMs = Math.max(worstMs, performance.now() - t0);
    const { cols: W, rows: H, arrows } = lvl;
    const seen = new Set();
    let formed = arrows.length > 0;
    for (const cells of arrows) {
      if (cells.length < 2) formed = false;
      for (let k = 0; k < cells.length; k++) {
        if (seen.has(cells[k])) formed = false;
        seen.add(cells[k]);
        if (k && Math.abs((cells[k - 1] % W) - (cells[k] % W)) + Math.abs(((cells[k - 1] / W) | 0) - ((cells[k] / W) | 0)) !== 1) formed = false;
      }
    }
    ok(`ladder ${n}: well formed`, formed);
    ok(`ladder ${n}: deterministic`, JSON.stringify(buildLadder(n)) === JSON.stringify(lvl));
    const gone = new Array(arrows.length).fill(false);
    let left = arrows.length, guard = 0;
    while (left && guard++ < 100000) { const id = hintArrow(lvl, gone, null); if (id < 0) break; gone[id] = true; left--; }
    ok(`ladder ${n}: solvable`, left === 0);
    info.push({ n, W, H, a: arrows.length, r: peel(W, H, arrows).layers });
  }
  let grow = true, roundsClose = true;
  for (let i = 2; i < info.length; i++) {   // from level 2: level 1 is the special 8x4 first board
    const p = info[i - 1], q = info[i];
    if (i > 2 && (q.W < p.W || q.H < p.H || q.W - p.W > 1 || q.H - p.H > 1)) grow = false;
    if (Math.abs(q.r - p.r) > 4) roundsClose = false;
  }
  ok('ladder: the grid never shrinks, and grows by at most one dot a level', grow);
  ok('ladder: neighbouring levels are within 4 rounds', roundsClose);
  for (const edge of [50, 100, 150]) {
    const a = info[edge - 1], b = info[edge];
    ok(`ladder: ${edge} -> ${edge + 1} is seamless`, Math.abs(a.W - b.W) <= 1 && Math.abs(a.H - b.H) <= 1 && Math.abs(a.r - b.r) <= 3);
  }
  const avg = (lo, hi) => { const s = info.slice(lo - 1, hi); return s.reduce((x, y) => x + y.r, 0) / s.length; };
  ok('ladder: each band is deeper than the one before', avg(41, 50) < avg(91, 100) && avg(91, 100) < avg(141, 150) && avg(141, 150) < avg(191, 200));
  ok('ladder: it stops getting harder at the top', avg(201, 230) <= avg(191, 200) + 1.5);
  ok('ladder: level 1 is the gentle first board', JSON.stringify(buildLadder(1)) === JSON.stringify(buildLevel('easy', 1, 1)));
  ok('ladder: bands', bandOf(50) === 'easy' && bandOf(51) === 'medium' && bandOf(151) === 'expert' && BAND_START.hard === 101 && bandEnd('hard') === 150);
  console.log(`ladder: 230 levels ok-checked; rounds ${info[1].r} at 2, ${avg(41, 50).toFixed(1)} at 41-50, ${avg(91, 100).toFixed(1)} at 91-100, ${avg(141, 150).toFixed(1)} at 141-150, ${avg(191, 200).toFixed(1)} at 191-200; slowest build ${worstMs.toFixed(0)} ms`);
  // A level in progress must rebuild to the SAME board, so the ladder is pinned the day it shipped.
  // Never change it without a new ladder generator and keeping this one (see engine.js).
  const h = createHash('sha256');
  for (let n = 1; n <= 60; n++) h.update(JSON.stringify(buildLadder(n)));
  for (const n of [101, 151, 200]) h.update(JSON.stringify(buildLadder(n)));
  const pin = h.digest('hex').slice(0, 16);
  ok(`ladder unchanged (${pin})`, pin === 'a3349c761be93816');
}

console.log(fails ? `\n${fails} FAILED` : '\nall way-out engine checks passed');
process.exit(fails ? 1 : 0);
