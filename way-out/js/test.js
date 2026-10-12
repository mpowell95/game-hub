// way-out/js/test.js - headless engine checks. Run: node way-out/js/test.js
//
// For every tier, levels 1-60: the board is well formed (every arrow is a chain of at least two
// adjacent, distinct points; no point is used twice), it is the same board every time it is built,
// and a player who only ever taps clear arrows clears it (engine.js's header says why that greedy
// check is a proof of solvability, not a sample of it).
import { TIERS, buildLevel, levelSpec, occupancy, blockerOf, hintArrow, generate, seedOf, peel } from './engine.js';

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
const FLOOR = { easy: [0.36, 5], medium: [0.32, 8], hard: [0.34, 12], expert: [0.36, 11] };
for (const tier of TIERS) {
  let c0 = 0, ly = 0;
  for (let level = 2; level <= 21; level++) {
    const l = buildLevel(tier, level);
    const m = peel(l.cols, l.rows, l.arrows);
    c0 += m.clear0; ly += m.layers;
  }
  c0 /= 20; ly /= 20;
  console.log(`${tier}: generator 2 averages ${(c0 * 100).toFixed(0)}% free at the start, ${ly.toFixed(1)} rounds`);
  ok(`${tier}: hard enough (free ${c0.toFixed(2)} <= ${FLOOR[tier][0]}, rounds ${ly.toFixed(1)} >= ${FLOOR[tier][1]})`, c0 <= FLOOR[tier][0] && ly >= FLOOR[tier][1]);
}
// Generator 1 is kept unchanged, so a level saved before generator 2 rebuilds to the same board.
for (const tier of TIERS) for (const level of [1, 5, 17]) {
  ok(`${tier} ${level}: generator 1 unchanged`, JSON.stringify(buildLevel(tier, level, 1)) === JSON.stringify(generate(levelSpec(tier, level), seedOf(tier, level))));
}
ok('easy 1 stays the gentle generator-1 board', JSON.stringify(buildLevel('easy', 1)) === JSON.stringify(buildLevel('easy', 1, 1)));

console.log(fails ? `\n${fails} FAILED` : '\nall way-out engine checks passed');
process.exit(fails ? 1 : 0);
