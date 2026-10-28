// tools/build-arrow-impossible.mjs - GENERATES way-out/js/impossible-tests.js: Arrow Maze's IMPOSSIBLE test
// boards (2026-10-28, admin only). Matt: "an 'impossible' category ... 70+ arrows and there's exactly 1 way
// to solve it ... only one arrow can be moved at a time. And zero arrows ... from the same column or row
// facing the same direction", after filming Expert 251 where ten arrows in two rows went "just tapping
// directly in order". Then: "Add an impossible or 2 or 3 as tests for me to play before you publish them".
// Every board kept here is proved by tools/arrow-search.mjs's measure(): exactly ONE arrow free at every
// step (so exactly one order solves it), 70+ arrows, and ZERO trains (no arrow is ever freed by the one in
// front of it pointing the same way in its row or column). Boards that miss any of it are thrown away.
//
//   node tools/build-arrow-impossible.mjs   (round 1, boards 1-3: --count / --iters; round 2 below)
import { writeFileSync } from 'node:fs';
import { W, H, measure, search, setGrid, playThrough, noiseScore } from './arrow-search.mjs';
const E = await import('../way-out/js/engine.js');
const arg = (k, d) => (process.argv.includes(k) ? +process.argv[process.argv.indexOf(k) + 1] : d);
const COUNT = arg('--count', 3), ITERS = arg('--iters', 80000);

// APPEND-ONLY: the boards already in the file stay exactly as they are (Matt's results name them by
// number); new ones are added after them.
const shippedMod = await import('../way-out/js/impossible-tests.js');
const boards = shippedMod.IMPOSSIBLE_TESTS.map((b) => b.map((c) => c.slice()));
// Each board's grid, [cols, rows] (2026-10-28: boards 7-8 are 18 wide); the first six are 16x22.
const grids = boards.map((_, i) => (shippedMod.IMPOSSIBLE_GRID && shippedMod.IMPOSSIBLE_GRID[i]) || [16, 22]);
// Round 2 (2026-10-28, after 1:43 and 1:41 on boards 1-2): JUMPS. The next free arrow far from the one
// just removed. On 16x22 more arrows means shorter jumps, so three trade-offs to time:
//   4: ~35 arrows, nearly every move ~8 dots away;  5: ~45 arrows, ~6;  6: ~50 arrows, ~5.
const ROUND2 = [
  { min: 32, over: { jump: 16, near: 8, minN: 50, maxN: 70, fill: 0.55, rounds: 2.5 }, iters: 300000 },
  { min: 42, over: { jump: 14, near: 6, minN: 46, maxN: 70, fill: 0.55, rounds: 2.5 }, iters: 200000 },
  { min: 48, over: { jump: 14, near: 5, minN: 50, maxN: 70, fill: 0.55, rounds: 2.5 }, iters: 120000 },
];
if (boards.length < 3) throw new Error('round 1 boards missing');
for (let r = boards.length - 3; r < ROUND2.length; r++) {
  const { min, over, iters } = ROUND2[r];
  for (let seedK = 0; seedK < 20; seedK++) {
    const t0 = Date.now();
    const a = search(E.seedOf(`impossible-jumps-${r}`, seedK), 'jumps', iters, over);
    const m = measure(a);
    const ok = m && m.n >= min && m.rounds === m.n && m.maxFree === 1 && m.trains === 0;
    console.log(`board ${boards.length + 1} seed ${seedK}: ${m.n} arrows, most free ${m.maxFree}, trains ${m.trains}, jump ${m.jump.toFixed(1)}, near ${m.near} ${ok ? 'KEPT' : 'thrown away'} (${Date.now() - t0} ms)`);
    if (ok) { boards.push(a); break; }
  }
}
// Round 3 (2026-10-28, Matt on boards 1-6: "None of them are difficult as is"; board 4, the long-jump one,
// cost him 3.2 s a move against 1.0-1.9 on the rest). 18x25 (Matt: "make 2 at 18 wide"), so long jumps
// AND more arrows fit: 7 = ~45 arrows, next arrow ~8 dots away, most blockers far; 8 = ~55 arrows, ~6.
const ROUND3 = [
  { min: 42, minJump: 7.5, over: { jump: 18, near: 8, minN: 55, maxN: 75, fill: 0.58, rounds: 4, dist: 7, farS: 30 }, iters: 300000 },
  { min: 52, minJump: 6, over: { jump: 18, near: 8, minN: 55, maxN: 75, fill: 0.58, rounds: 4, dist: 7, farS: 30 }, iters: 300000 },
];
setGrid(18, 25);
for (let r = boards.length - 6; r >= 0 && r < ROUND3.length; r++) {
  const { min, minJump, over, iters } = ROUND3[r];
  for (let seedK = 0; seedK < 30; seedK++) {
    const t0 = Date.now();
    const a = search(E.seedOf(`impossible-18-${r}`, seedK), 'jumps', iters, over);
    const m = measure(a);
    const ok = m && m.n >= min && m.jump >= minJump && m.rounds === m.n && m.maxFree === 1 && m.trains === 0;
    console.log(`board ${boards.length + 1} seed ${seedK}: ${m.n} arrows, most free ${m.maxFree}, trains ${m.trains}, jump ${m.jump.toFixed(1)}, far ${(100 * m.farShare).toFixed(0)}% ${ok ? 'KEPT' : 'thrown away'} (${Date.now() - t0} ms)`);
    if (ok) { boards.push(a); grids.push([18, 25]); break; }
  }
}
// Round 4 (2026-10-28, Matt: "every tap leads directly to the next one" / "fill in the spaces with ...
// noise ... and make them closed loops"). With one arrow free at a time the trail is built in, so these
// give that up: up to 3 arrows free at once, and ~1 tap in 3 frees NOTHING (a dead tap: the next arrow is
// elsewhere, ~8 dots away), on a full board (~85%) of curlier arrows. Played through by playThrough()
// following the trail; no trains. 18x25.
const NOISE = { dead: 80, deadJump: 4, free: 25, maxFree: 3, avgFree: 3, turns: 18, minN: 70, fill: 0.72 };
for (let r = boards.length - 8; r >= 0 && r < 2; r++) {
  for (let seedK = 0; seedK < 20; seedK++) {
    const t0 = Date.now();
    const a = search(E.seedOf(`impossible-noise-${r}`, seedK), 'forced', 150000, undefined, noiseScore(NOISE));
    const m = playThrough(a);
    const ok = m && m.n >= 65 && m.deadShare >= 0.3 && m.maxFree <= 3 && m.trains === 0;
    console.log(`board ${boards.length + 1} seed ${seedK}: ${m.n} arrows, dead taps ${Math.round(100 * m.deadShare)}%, then ${m.deadJump.toFixed(1)} dots, most free ${m.maxFree}, trains ${m.trains} ${ok ? 'KEPT' : 'thrown away'} (${Date.now() - t0} ms)`);
    if (ok) { boards.push(a); grids.push([18, 25]); break; }
  }
}
void COUNT; void ITERS;
const out = `// way-out/js/impossible-tests.js - GENERATED by tools/build-arrow-impossible.mjs (2026-10-28). NEVER HAND-EDIT.
// Arrow Maze's IMPOSSIBLE test boards (admin only): one arrow free at every step, no trains; grids in IMPOSSIBLE_GRID.
export const IMP_W = 16;
export const IMP_H = 22;
export const IMPOSSIBLE_TESTS = ${JSON.stringify(boards)};
/** Each board's grid, [cols, rows], in the same order (boards 1-6 16x22, 7-8 18x25). */
export const IMPOSSIBLE_GRID = ${JSON.stringify(grids)};
`;
writeFileSync(new URL('../way-out/js/impossible-tests.js', import.meta.url), out);
console.log(`wrote way-out/js/impossible-tests.js (${boards.length} boards, ${(out.length / 1024).toFixed(1)} KB)`);
