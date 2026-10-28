// way-out/js/test.js - headless engine checks. Run: node way-out/js/test.js
//
// For every tier, levels 1-60: the board is well formed (every arrow is a chain of at least two
// adjacent, distinct points; no point is used twice), it is the same board every time it is built,
// and a player who only ever taps clear arrows clears it (engine.js's header says why that greedy
// check is a proof of solvability, not a sample of it).
import { createHash } from 'node:crypto';
import { dirOf, TIERS, buildLevel, levelSpec, rampTarget, occupancy, blockerOf, hintArrow, generate, seedOf, peel, buildLadder, bandOf, bandEnd, BAND_START, buildRush, rushLevel, buildMore, moreLevel, isMore, ladderSpec, buildB8, b8Slot, hasB8, unpackB8, buildB9, hasB9, buildB10, b10Slot, hasB10, buildB11, hasB11 } from './engine.js';

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
// shouldn't be a big jump between individual levels"). For each ladder generator, every level in its
// range: well formed, deterministic, solvable by the player's own hint; the grid never shrinks and
// grows by at most one dot a level; neighbouring levels differ by at most 4 rounds.
function checkLadder(gen, from, to) {
  const info = {};
  let worstMs = 0;
  for (let n = from; n <= to; n++) {
    const t0 = performance.now();
    const lvl = buildLadder(n, gen);
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
    ok(`ladder g${gen} ${n}: well formed`, formed);
    ok(`ladder g${gen} ${n}: deterministic`, JSON.stringify(buildLadder(n, gen)) === JSON.stringify(lvl));
    const gone = new Array(arrows.length).fill(false);
    let left = arrows.length, guard = 0;
    while (left && guard++ < 100000) { const id = hintArrow(lvl, gone, null); if (id < 0) break; gone[id] = true; left--; }
    ok(`ladder g${gen} ${n}: solvable`, left === 0);
    info[n] = { n, W, H, a: arrows.length, r: peel(W, H, arrows).layers, json: JSON.stringify(lvl) };
  }
  let grow = true, roundsClose = true;
  for (let n = Math.max(3, from + 1); n <= to; n++) {   // level 1 is the special 8x4 first board
    const p = info[n - 1], q = info[n];
    if (q.W < p.W || q.H < p.H || q.W - p.W > 1 || q.H - p.H > 1) grow = false;
    if (Math.abs(q.r - p.r) > 4) roundsClose = false;
  }
  ok(`ladder g${gen}: the grid never shrinks, and grows by at most one dot a level`, grow);
  ok(`ladder g${gen}: neighbouring levels are within 4 rounds`, roundsClose);
  const avg = (lo, hi, k = 'r') => { let s = 0; for (let n = lo; n <= hi; n++) s += info[n][k]; return s / (hi - lo + 1); };
  const seamless = (edge) => { const a = info[edge], b = info[edge + 1]; return Math.abs(a.W - b.W) <= 1 && Math.abs(a.H - b.H) <= 1 && Math.abs(a.r - b.r) <= 3; };
  return { info, avg, seamless, worstMs };
}
// Generator 5, the first ladder (Hard 101-150, Expert 151 on). Kept unchanged for levels in progress
// on it, so it is pinned the day it shipped.
{
  const { avg, seamless, worstMs } = checkLadder(5, 1, 230);
  for (const edge of [50, 100, 150]) ok(`ladder g5: ${edge} -> ${edge + 1} is seamless`, seamless(edge));
  ok('ladder g5: each old band is deeper than the one before', avg(41, 50) < avg(91, 100) && avg(91, 100) < avg(141, 150) && avg(141, 150) < avg(191, 200));
  ok('ladder g5: it stops getting harder at the top', avg(201, 230) <= avg(191, 200) + 1.5);
  ok('ladder: level 1 is the gentle first board', JSON.stringify(buildLadder(1, 5)) === JSON.stringify(buildLevel('easy', 1, 1)));
  console.log(`ladder g5: 230 levels; rounds ${avg(41, 50).toFixed(1)} at 41-50, ${avg(91, 100).toFixed(1)} at 91-100, ${avg(141, 150).toFixed(1)} at 141-150, ${avg(191, 200).toFixed(1)} at 191-200; slowest build ${worstMs.toFixed(0)} ms`);
  // Never change it without a new ladder generator and keeping this one (see engine.js).
  const h = createHash('sha256');
  for (let n = 1; n <= 60; n++) h.update(JSON.stringify(buildLadder(n, 5)));
  for (const n of [101, 151, 200]) h.update(JSON.stringify(buildLadder(n, 5)));
  const pin = h.digest('hex').slice(0, 16);
  ok(`ladder g5 unchanged (${pin})`, pin === 'a3349c761be93816');
}
// Generator 6 (2026-10-14, the bands moved: Hard 101-200, Expert 201 on). Levels 1-100 are generator
// 5's boards exactly; Hard climbs through the old Hard tier's boards; Expert starts where the old
// Expert tier started and grows to its largest, deepest boards.
{
  let same = true;
  for (let n = 1; n <= 100; n++) if (JSON.stringify(buildLadder(n, 6)) !== JSON.stringify(buildLadder(n, 5))) same = false;
  ok('ladder g6: levels 1-100 are generator 5\'s boards exactly (Easy and Medium unchanged)', same);
  ok('ladder: the default is generator 6', JSON.stringify(buildLadder(151)) === JSON.stringify(buildLadder(151, 6)));
  const { avg, seamless, worstMs } = checkLadder(6, 99, 300);
  for (const edge of [100, 200]) ok(`ladder g6: ${edge} -> ${edge + 1} is seamless`, seamless(edge));
  const tierAvg = (t, lo, hi, k) => { let s = 0; for (let n = lo; n <= hi; n++) { const l = buildLevel(t, n); s += k === 'a' ? l.arrows.length : peel(l.cols, l.rows, l.arrows).layers; } return s / (hi - lo + 1); };
  ok('ladder g6: Hard keeps getting deeper', avg(101, 110) < avg(141, 150) && avg(141, 150) < avg(191, 200));
  ok('ladder g6: Expert starts at least as big and deep as the old Expert tier started',
    avg(201, 210, 'a') >= tierAvg('expert', 1, 10, 'a') * 0.9 && avg(201, 210) >= tierAvg('expert', 1, 10));
  ok('ladder g6: Expert goes on to the old Expert tier\'s deepest boards', avg(251, 260) >= tierAvg('expert', 64, 73) - 1);
  ok('ladder g6: it stops getting harder at the top', avg(271, 300) <= avg(251, 260) + 1.5);
  ok('ladder: bands', bandOf(50) === 'easy' && bandOf(51) === 'medium' && bandOf(200) === 'hard' && bandOf(201) === 'expert'
    && BAND_START.hard === 101 && bandEnd('hard') === 200 && BAND_START.expert === 201);
  console.log(`ladder g6: 99-300; rounds ${avg(101, 110).toFixed(1)} at 101-110, ${avg(141, 150).toFixed(1)} at 141-150, ${avg(191, 200).toFixed(1)} at 191-200, ${avg(201, 210).toFixed(1)} at 201-210 (${avg(201, 210, 'a').toFixed(0)} arrows), ${avg(251, 260).toFixed(1)} at 251-260; slowest build ${worstMs.toFixed(0)} ms`);
  const h = createHash('sha256');
  for (const n of [101, 125, 150, 175, 200, 201, 225, 260, 300]) h.update(JSON.stringify(buildLadder(n, 6)));
  const pin = h.digest('hex').slice(0, 16);
  ok(`ladder g6 unchanged (${pin})`, pin === '5b8571064bfd2397');
}

// MORE LEVELS (2026-10-26): Easy, Medium and Hard never end. Their boards past 50 / 100 / 200 are
// well formed, solvable, the same every time, all different, and never bigger than the band's last
// ladder board (the arrows never get smaller than that difficulty already has).
{
  let good = true, worst = 0, small = true;
  const seen = new Set();
  for (const band of ['easy', 'medium', 'hard']) {
    const last = buildLadder(bandEnd(band));
    for (let n = bandEnd(band) + 1; n <= bandEnd(band) + 40; n++) {
      const t0 = performance.now();
      const lvl = buildMore(band, n);
      worst = Math.max(worst, performance.now() - t0);
      if (n <= bandEnd(band) + 3 && JSON.stringify(lvl) !== JSON.stringify(buildMore(band, n))) good = false;
      seen.add(JSON.stringify(lvl.arrows));
      if (lvl.cols > last.cols || lvl.rows > last.rows) small = false;
      const gone = new Array(lvl.arrows.length).fill(false);
      let left = lvl.arrows.length, guard = 0;
      while (left && guard++ < 100000) { const id = hintArrow(lvl, gone, null); if (id < 0) break; gone[id] = true; left--; }
      if (left || lvl.arrows.some((c) => c.length < 2)) good = false;
      const m = moreLevel(band, n);
      if (!(m >= 1 && m <= bandEnd(band) && bandOf(m) === band)) good = false;
    }
  }
  ok('more levels: boards well formed, solvable, the same every time, from the top of their own band', good);
  ok('more levels: 120 boards, all different', seen.size === 120);
  ok('more levels: never bigger than the band\'s last ladder board', small);
  ok('more levels: Easy, Medium and Hard have them, Expert does not', isMore('easy', 51) && !isMore('easy', 50) && isMore('medium', 101)
    && isMore('hard', 201) && !isMore('hard', 200) && !isMore('expert', 5000));
  ok(`more levels: a board builds fast (slowest ${worst.toFixed(0)} ms)`, worst < 400);
  const h = createHash('sha256');
  for (const [b, n] of [['easy', 51], ['easy', 99], ['medium', 101], ['medium', 250], ['hard', 201], ['hard', 333]]) h.update(JSON.stringify(buildMore(b, n)));
  const pin = h.digest('hex').slice(0, 16);
  console.log(`more levels: pin ${pin}; slowest build ${worst.toFixed(0)} ms`);
  ok(`more levels (generator 7) unchanged (${pin})`, pin === '10a0cc7e78ac7353');
}

// GENERATOR 8 (2026-10-27): Hard from 101 and Expert from 201, packed boards GENERATED by
// tools/build-arrow-boards8.mjs. Every shipped board well formed and solvable; past the list they come
// round mirrored (still solvable); APPEND-ONLY: the boards already shipped are pinned by hash.
{
  const { B8, B8_W: W, B8_H: H } = await import('./boards8.js');
  const wellFormed = (lvl) => {
    const seen = new Set();
    for (const c of lvl.arrows) {
      if (c.length < 2) return false;
      for (const p of c) { if (!(p >= 0 && p < W * H) || seen.has(p)) return false; seen.add(p); }
      for (let k = 1; k < c.length; k++) { const a = c[k - 1], b = c[k]; if (Math.abs((a % W) - (b % W)) + Math.abs(((a / W) | 0) - ((b / W) | 0)) !== 1) return false; }
    }
    return lvl.cols === W && lvl.rows === H && !!peel(W, H, lvl.arrows);
  };
  let good = B8.hard.length >= 250 && B8.expert.length >= 250;
  for (const band of ['hard', 'expert']) {
    const from = band === 'hard' ? 101 : 201;
    for (let k = 0; k < B8[band].length; k++) if (!wellFormed(buildB8(band, from + k))) good = false;
    // past the list: mirrored, and still good
    for (const k of [B8[band].length, B8[band].length + 7, B8[band].length * 3 + 11]) {
      const s = b8Slot(band, from + k);
      if (!(s.t >= 1 && s.t <= 3) || !wellFormed(buildB8(band, from + k))) good = false;
    }
  }
  ok('generator 8: every Hard and Expert board well formed and solvable, mirrored ones too', good);
  ok('generator 8: Hard from 101, Expert from 201, nothing else', hasB8('hard', 101) && !hasB8('hard', 100) && hasB8('expert', 201)
    && !hasB8('expert', 200) && !hasB8('medium', 300) && !hasB8('easy', 60));
  ok('generator 8: Expert never comes round to its gentler start', b8Slot('expert', 201 + B8.expert.length).i >= Math.floor(B8.expert.length * 0.6));
  const h = createHash('sha256');
  for (const band of ['hard', 'expert']) for (let k = 0; k < 250; k++) h.update(B8[band][k]);
  const pin = h.digest('hex').slice(0, 16);
  console.log(`generator 8: ${B8.hard.length} Hard, ${B8.expert.length} Expert boards; pin ${pin}`);
  ok(`generator 8: the shipped boards never change (${pin})`, pin === '9f8510f265ee3cad');
  void unpackB8;
}

// GENERATOR 9 (2026-10-27): Expert from 201, forced order four in five; boards9.js GENERATED by
// tools/build-arrow-boards9.mjs, APPEND-ONLY, pinned.
{
  const { B9 } = await import('./boards9.js');
  const { B8_W: W, B8_H: H } = await import('./boards8.js');
  let good = B9.expert.length >= 250, forced = 0;
  for (const n of [...Array(B9.expert.length).keys()].map((k) => 201 + k).concat([201 + B9.expert.length, 201 + B9.expert.length * 2 + 5])) {
    const lvl = buildB9('expert', n), seen = new Set();
    for (const c of lvl.arrows) {
      if (c.length < 2) good = false;
      for (const p of c) { if (!(p >= 0 && p < W * H) || seen.has(p)) good = false; seen.add(p); }
    }
    const m = peel(W, H, lvl.arrows);
    if (!m) good = false; else if (m.layers >= lvl.arrows.length - 2) forced++;
  }
  ok('generator 9: every Expert board well formed and solvable, mirrored ones too', good);
  ok(`generator 9: mostly forced order (${forced} of ${B9.expert.length + 2})`, forced >= B9.expert.length * 0.7);
  ok('generator 9: Expert only, from 201', hasB9('expert', 201) && !hasB9('expert', 200) && !hasB9('hard', 150));
  const h = createHash('sha256');
  for (let k = 0; k < 250; k++) h.update(B9.expert[k]);
  const pin = h.digest('hex').slice(0, 16);
  console.log(`generator 9: ${B9.expert.length} Expert boards; pin ${pin}`);
  ok(`generator 9: the shipped boards never change (${pin})`, pin === '5eb30555834497dc');
}

// GENERATOR 10 (2026-10-28): EVERY Expert level, Impossible test board 11's recipe on 28x38; boards10.js
// GENERATED by tools/build-arrow-boards10.mjs, APPEND-ONLY, pinned. Checked by play, not the search's code:
// exactly one arrow free at every step, no trains, the next arrow 7+ dots from the one just removed.
{
  const { B10, B10_W: W, B10_H: H } = await import('./boards10.js');
  let good = B10.length >= 52 && W === 28 && H === 38, one = true, trains = 0, far = true, small = 99;
  const levels = [...Array(B10.length).keys()].map((k) => 201 + k).concat([201 + B10.length, 201 + B10.length * 2 + 5, 201 + B10.length * 3 + 1]);
  for (const n of levels) {
    const lvl = buildB10(n), arrows = lvl.arrows, N = arrows.length, seen = new Set();
    if (lvl.cols !== W || lvl.rows !== H || N < 65) good = false;
    small = Math.min(small, N);
    for (const c of arrows) {
      if (c.length < 2) good = false;
      for (const p of c) { if (!(p >= 0 && p < W * H) || seen.has(p)) good = false; seen.add(p); }
    }
    if (!peel(W, H, arrows)) { good = false; continue; }
    const gone = new Array(N).fill(false), d = [];
    let prev = -1;
    for (let step = 0; step < N; step++) {
      const occ = occupancy(lvl, gone), free = [];
      for (let id = 0; id < N; id++) if (!gone[id] && !blockerOf(arrows[id], occ, W, H, id)) free.push(id);
      if (free.length !== 1) { one = false; break; }
      const id = free[0];
      if (prev >= 0) {
        const before = occupancy(lvl, gone.map((g, k) => g && k !== prev));
        const b = blockerOf(arrows[id], before, W, H, id);
        const [dx, dy] = dirOf(arrows[id], W), [ex, ey] = dirOf(arrows[prev], W);
        const h = arrows[id][arrows[id].length - 1], g = arrows[prev][arrows[prev].length - 1];
        const line = dx ? ((h / W) | 0) === ((g / W) | 0) : (h % W) === (g % W);
        if (b && before[b.cell] === prev && dx === ex && dy === ey && line) trains++;
        d.push(Math.min(...arrows[prev].map((p) => Math.abs((p % W) - (h % W)) + Math.abs(((p / W) | 0) - ((h / W) | 0)))));
      }
      gone[id] = true; prev = id;
    }
    if (d.length && d.reduce((a, b) => a + b, 0) / d.length < 7) far = false;
  }
  ok(`generator 10: every Expert board well formed and solvable, mirrored ones too (fewest arrows ${small})`, good);
  ok('generator 10: exactly one arrow free at every step, no trains', one && trains === 0);
  ok('generator 10: the next arrow is 7+ dots away on average', far);
  // A save names how many boards had shipped (m): more boards are added in batches, and past the list a level wraps.
  const w4 = buildB10(205, 4);
  ok('generator 10: a save keeps its board when more ship (first m boards)', JSON.stringify(buildB10(203, 4)) === JSON.stringify(buildB10(203))
    && JSON.stringify(w4) !== JSON.stringify(buildB10(205)) && !!peel(W, H, w4.arrows));
  const L = B10.length, laps = new Set();
  for (let n = 290; n < 290 + L; n++) laps.add(b10Slot(n).i);
  ok('generator 10: a loop: from any level, the next L levels meet every board once', laps.size === L
    && b10Slot(201).i === 0 && b10Slot(201).t === 0 && b10Slot(201 + L).i === 0 && b10Slot(201 + L).t === 1);
  ok('generator 10: a v1321 save (no loop mark) keeps its board', JSON.stringify(buildB10(294, 52, false)) === JSON.stringify(buildB10(201 + 51 + 52 * 2, 52))   // old wrap: board 51, flipped top-bottom
    && JSON.stringify(buildB10(294, 52, false)) !== JSON.stringify(buildB10(294, 52)));
  ok('generator 10: every Expert level, nothing else', hasB10('expert') && !hasB10('hard') && !hasB10('medium'));
  const h = createHash('sha256');
  for (let k = 0; k < 52; k++) h.update(B10[k]);
  const pin = h.digest('hex').slice(0, 16);
  console.log(`generator 10: ${B10.length} Expert boards; pin ${pin}`);
  ok(`generator 10: the shipped boards never change (${pin})`, pin === '4d8eccaa7e501826');
  const h100 = createHash('sha256');
  for (let k = 0; k < 100; k++) h100.update(B10[k]);
  const pin100 = h100.digest('hex').slice(0, 16);
  ok(`generator 10: boards 1-100 never change (${pin100})`, B10.length >= 100 && pin100 === '54d4cacf85e19c4a');
}

// GENERATOR 11 (2026-10-28): EVERY Hard level from 101, Impossible boards 7-8's recipe on 18x25; boards11.js
// GENERATED by tools/build-arrow-boards11.mjs, APPEND-ONLY, pinned. Checked by play: one arrow free at every
// step, no trains, the next arrow 6+ dots away; a loop from 101, each lap mirrored.
{
  const { B11, B11_W: W, B11_H: H } = await import('./boards11.js');
  let good = B11.length >= 100 && W === 18 && H === 25, one = true, trains = 0, far = true, small = 99, big = 0;
  for (const n of [...Array(B11.length).keys()].map((k) => 101 + k).concat([101 + B11.length, 101 + B11.length * 2 + 5, 101 + B11.length * 3 + 1])) {
    const lvl = buildB11(n), arrows = lvl.arrows, N = arrows.length, seen = new Set();
    if (lvl.cols !== W || lvl.rows !== H || N < 44) good = false;
    small = Math.min(small, N); big = Math.max(big, N);
    for (const c of arrows) {
      if (c.length < 2) good = false;
      for (const p of c) { if (!(p >= 0 && p < W * H) || seen.has(p)) good = false; seen.add(p); }
    }
    if (!peel(W, H, arrows)) { good = false; continue; }
    const gone = new Array(N).fill(false), d = [];
    let prev = -1;
    for (let step = 0; step < N; step++) {
      const occ = occupancy(lvl, gone), free = [];
      for (let id = 0; id < N; id++) if (!gone[id] && !blockerOf(arrows[id], occ, W, H, id)) free.push(id);
      if (free.length !== 1) { one = false; break; }
      const id = free[0];
      if (prev >= 0) {
        const before = occupancy(lvl, gone.map((g, k) => g && k !== prev));
        const b = blockerOf(arrows[id], before, W, H, id);
        const [dx, dy] = dirOf(arrows[id], W), [ex, ey] = dirOf(arrows[prev], W);
        const h = arrows[id][arrows[id].length - 1], g = arrows[prev][arrows[prev].length - 1];
        const line = dx ? ((h / W) | 0) === ((g / W) | 0) : (h % W) === (g % W);
        if (b && before[b.cell] === prev && dx === ex && dy === ey && line) trains++;
        d.push(Math.min(...arrows[prev].map((p) => Math.abs((p % W) - (h % W)) + Math.abs(((p / W) | 0) - ((h / W) | 0)))));
      }
      gone[id] = true; prev = id;
    }
    if (d.length && d.reduce((a, b) => a + b, 0) / d.length < 6) far = false;
  }
  ok(`generator 11: every Hard board well formed and solvable, mirrored ones too (${small}-${big} arrows)`, good);
  ok('generator 11: exactly one arrow free at every step, no trains', one && trains === 0);
  ok('generator 11: the next arrow is 6+ dots away on average', far);
  ok('generator 11: Hard from 101 only', hasB11('hard', 101) && !hasB11('hard', 100) && !hasB11('expert', 250) && !hasB11('medium', 120));
  const h = createHash('sha256');
  for (let k = 0; k < 100; k++) h.update(B11[k]);
  const pin = h.digest('hex').slice(0, 16);
  console.log(`generator 11: ${B11.length} Hard boards (${small}-${big} arrows); pin ${pin}`);
  ok(`generator 11: the shipped boards never change (${pin})`, pin === '7da304f89dc1284e');
}

// IMPOSSIBLE TEST BOARDS (2026-10-28, admin only; GENERATED by tools/build-arrow-impossible.mjs). Checked
// here WITHOUT the search's own measure(): played one arrow at a time, exactly one arrow can go at every
// step (so one order solves it), 70+ arrows, and the arrow freed by each move is never the one right
// behind it pointing the same way in its row or column (no "trains").
{
  const { IMPOSSIBLE_TESTS, IMPOSSIBLE_GRID } = await import('./impossible-tests.js');
  let good = IMPOSSIBLE_TESTS.length >= 12 && IMPOSSIBLE_GRID.length === IMPOSSIBLE_TESTS.length
    && IMPOSSIBLE_GRID.slice(0, 6).every(([c, r]) => c === 16 && r === 22) && IMPOSSIBLE_GRID.slice(6, 10).every(([c, r]) => c === 18 && r === 25)
    && IMPOSSIBLE_GRID.slice(10).every(([c, r]) => c === 28 && r === 38);
  // every board but the two noise ones (9-10): exactly one arrow free at every step
  for (const arrows of IMPOSSIBLE_TESTS.filter((_, i) => i < 8 || i >= 10)) {
    const [W, H] = IMPOSSIBLE_GRID[IMPOSSIBLE_TESTS.indexOf(arrows)];
    const lvl = { cols: W, rows: H, arrows }, n = arrows.length, gone = new Array(n).fill(false);
    for (const c of arrows) for (const p of c) if (!(p >= 0 && p < W * H)) good = false;
    if (n < (IMPOSSIBLE_TESTS.indexOf(arrows) < 3 || IMPOSSIBLE_TESTS.indexOf(arrows) >= 10 ? 70 : 32)) good = false;
    let prev = -1;
    for (let step = 0; step < n; step++) {
      const occ = occupancy(lvl, gone);
      const free = [];
      for (let id = 0; id < n; id++) if (!gone[id] && !blockerOf(arrows[id], occ, W, H, id)) free.push(id);
      if (free.length !== 1) { good = false; break; }
      const id = free[0];
      if (prev >= 0) {
        // was `id` blocked by `prev` just before prev left, both pointing the same way in one line?
        const before = occupancy(lvl, gone.map((g, k) => g && k !== prev));
        const b = blockerOf(arrows[id], before, W, H, id);
        const [dx, dy] = dirOf(arrows[id], W), [ex, ey] = dirOf(arrows[prev], W);
        const h = arrows[id][arrows[id].length - 1], g = arrows[prev][arrows[prev].length - 1];
        const line = dx ? ((h / W) | 0) === ((g / W) | 0) : (h % W) === (g % W);
        if (b && before[b.cell] === prev && dx === ex && dy === ey && line) { good = false; break; }
      }
      gone[id] = true; prev = id;
    }
  }
  ok('impossible tests: 1-3 70+ arrows, 4-6 jump boards; exactly one arrow free at every step, no trains', good);
  // Boards 4-8 (rounds 2-3): on average the next free arrow's head is 5+ dots from the arrow just removed.
  let jumps = true;
  for (const arrows of IMPOSSIBLE_TESTS.slice(3)) {
    const [W, H] = IMPOSSIBLE_GRID[IMPOSSIBLE_TESTS.indexOf(arrows)];
    const lvl = { cols: W, rows: H, arrows }, gone = new Array(arrows.length).fill(false), d = [];
    let prev = -1;
    for (let step = 0; step < arrows.length; step++) {
      const occ = occupancy(lvl, gone);
      const id = arrows.findIndex((c, i) => !gone[i] && !blockerOf(c, occ, W, H, i));
      if (prev >= 0) { const h = arrows[id][arrows[id].length - 1]; d.push(Math.min(...arrows[prev].map((p) => Math.abs((p % W) - (h % W)) + Math.abs(((p / W) | 0) - ((h / W) | 0))))); }
      gone[id] = true; prev = id;
    }
    if (d.reduce((a, b) => a + b, 0) / d.length < 5) jumps = false;
  }
  ok('impossible tests 4-8: the next arrow is 5+ dots away on average', jumps);
  // Boards 9-10 (round 4, "every tap leads directly to the next one"): played following the trail (always
  // the arrow freed most recently), at most 3 arrows free at once, 30%+ of taps free nothing, no trains.
  let noise = true;
  for (const arrows of IMPOSSIBLE_TESTS.slice(8, 10)) {
    const [W, H] = IMPOSSIBLE_GRID[IMPOSSIBLE_TESTS.indexOf(arrows)];
    const lvl = { cols: W, rows: H, arrows }, n = arrows.length, gone = new Array(n).fill(false), at = new Array(n).fill(-1);
    const freeNow = () => { const occ = occupancy(lvl, gone); return arrows.map((c, i) => !gone[i] && !blockerOf(c, occ, W, H, i)); };
    freeNow().forEach((f, i) => { if (f) at[i] = 0; });
    let dead = 0;
    for (let t = 1; t <= n; t++) {
      const cand = at.map((v, i) => (!gone[i] && v >= 0 ? i : -1)).filter((i) => i >= 0);
      if (!cand.length || cand.length > 3) { noise = false; break; }
      const pick = cand.reduce((a, b) => (at[b] > at[a] ? b : a));
      const occBefore = occupancy(lvl, gone);
      gone[pick] = true;
      let freed = 0;
      freeNow().forEach((f, i) => {
        if (!f || at[i] >= 0) return;
        at[i] = t; freed++;
        const b = blockerOf(arrows[i], occBefore, W, H, i), [dx, dy] = dirOf(arrows[i], W), [ex, ey] = dirOf(arrows[pick], W);
        const h = arrows[i][arrows[i].length - 1], g = arrows[pick][arrows[pick].length - 1];
        if (b && occBefore[b.cell] === pick && dx === ex && dy === ey && (dx ? ((h / W) | 0) === ((g / W) | 0) : (h % W) === (g % W))) noise = false;   // a train
      });
      if (!freed && t < n) dead++;
    }
    if (gone.some((g) => !g) || dead < 0.3 * (n - 1)) noise = false;
  }
  ok('impossible tests 9-10: solvable, at most 3 free at once, 30%+ of taps free nothing, no trains', noise);
}

// RUSH (2026-10-14): a run's boards are well formed, solvable, the same for the same seed, different
// for another seed, and climb with the board number up to their cap.
{
  let good = true, worst = 0;
  for (const mode of ['easy', 'hard']) {
    for (const seed of [1, 987654321, 4294967295]) {
      for (let i = 0; i < 14; i++) {
        const t0 = performance.now();
        const lvl = buildRush(mode, i, seed);
        worst = Math.max(worst, performance.now() - t0);
        if (JSON.stringify(lvl) !== JSON.stringify(buildRush(mode, i, seed))) good = false;
        const gone = new Array(lvl.arrows.length).fill(false);
        let left = lvl.arrows.length, guard = 0;
        while (left && guard++ < 100000) { const id = hintArrow(lvl, gone, null); if (id < 0) break; gone[id] = true; left--; }
        if (left || lvl.arrows.some((c) => c.length < 2)) good = false;
      }
    }
  }
  ok('rush: boards well formed, solvable and the same for the same seed', good);
  ok('rush: another seed, other boards', JSON.stringify(buildRush('easy', 0, 1)) !== JSON.stringify(buildRush('easy', 0, 2)));
  ok('rush: boards climb, then hold', rushLevel('easy', 0) === 3 && rushLevel('easy', 1) > 3 && rushLevel('easy', 50) === 50
    && rushLevel('hard', 0) === 51 && rushLevel('hard', 50) === 120);
  ok(`rush: a board builds fast enough to be ready while the clock runs (slowest ${worst.toFixed(0)} ms)`, worst < 120);
}

console.log(fails ? `\n${fails} FAILED` : '\nall way-out engine checks passed');
process.exit(fails ? 1 : 0);
