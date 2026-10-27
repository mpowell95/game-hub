// tools/build-arrow-tricky.mjs - Arrow Maze's TEST boards (2026-10-26): Medium-sized boards made hard by
// how they play, not by size. Matt: "Have you figured out how to make levels that are truly more
// challenging without simply making the board bigger?" Measured on the ladder: a blocked arrow's
// blocker is almost always the very next dot (1.1 dots on average) and a third of the arrows can go at
// the start, so a board is "more arrows", not "more thinking". These boards are searched for:
//   * blockers FAR away (open lanes; the whole line has to be read),
//   * only one or two arrows free at any time (a long forced order),
//   * decoys (arrows that look free, blocked by one dot of something across the board).
// Every board is proved solvable by peel() (remove every free arrow, repeat) after every change.
//
// The search is slow (seconds a board), so it runs HERE and writes way-out/js/tricky.js (GENERATED,
// never hand-edit). Deterministic: the same seeds give the same file.
//
//   node tools/build-arrow-tricky.mjs [--count 10] [--iters 12000] [--print]
import { writeFileSync } from 'node:fs';

const E = await import('../way-out/js/engine.js');
const arg = (k, d) => (process.argv.includes(k) ? +process.argv[process.argv.indexOf(k) + 1] : d);
const COUNT = arg('--count', 15), ITERS = arg('--iters', 20000);   // these defaults built the shipped file
const W = 16, H = 22;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Everything the score needs, from one peel that also measures each blocked arrow's blocker distance. */
function measure(arrows) {
  const n = arrows.length;
  const occ = new Int16Array(W * H).fill(-1);
  arrows.forEach((c, id) => { for (const p of c) occ[p] = id; });
  const gone = new Uint8Array(n);
  let left = n, rounds = 0, freeSum = 0, freeSq = 0, dSum = 0, dN = 0, far = 0, maxFree = 0;
  const first = [];
  while (left) {
    const now = [];
    for (let id = 0; id < n; id++) {
      if (gone[id]) continue;
      const b = E.blockerOf(arrows[id], occ, W, H, id);
      if (!b) now.push(id);
      else { dSum += b.steps; dN++; if (b.steps >= 4) far++; }
    }
    if (!now.length) return null;
    rounds++;
    if (rounds === 1) first.push(...now);
    freeSum += now.length; freeSq += (now.length - 1) ** 2; maxFree = Math.max(maxFree, now.length);
    for (const id of now) { gone[id] = 1; for (const p of arrows[id]) occ[p] = -1; }
    left -= now.length;
  }
  const cells = arrows.reduce((a, c) => a + c.length, 0);
  return { n, rounds, avgFree: freeSum / rounds, freeSq, maxFree, free0: first.length, dist: dN ? dSum / dN : 0, far, farShare: dN ? far / dN : 0, fill: cells / (W * H) };
}
// STYLES, so Matt can say which kind of hard he likes (boards 1-3, 4-7, 8-10, 11-15), each kept to a
// sane number of arrows (a 90-move forced chain is a chore, not a puzzle):
//   far    open lanes, almost every blocker 6+ dots away, a few arrows free at a time;
//   mixed  a fuller board (55%+ of the dots), blockers still a few dots away, one or two free;
//   forced a packed board where exactly one arrow (rarely two) can go at any moment.
const STYLES = {
  far: { rounds: 1.2, free: 0.6, dist: 12, farS: 40, minN: 30, maxN: 40, fill: 0.45 },
  mixed: { rounds: 1.0, free: 0.8, dist: 9, farS: 30, minN: 40, maxN: 50, fill: 0.55 },
  forced: { rounds: 2.2, free: 1.2, dist: 5, farS: 14, minN: 50, maxN: 65, fill: 0.62 },
  // (2026-10-27, Matt: "I think you could upgrade hard a bit too") boards 11-15: a milder mix for
  // Hard: blockers a few dots away, two or three arrows free at a time, a fuller board.
  hard: { rounds: 0.8, free: 0.35, dist: 5, farS: 10, minN: 45, maxN: 55, fill: 0.6, free0: 5, maxR: 26 },
};
export const styleOf = (i) => (i <= 3 ? 'far' : i <= 7 ? 'mixed' : i <= 10 ? 'forced' : 'hard');
let S = STYLES.far;
function score(m) {
  if (!m) return -Infinity;
  return S.rounds * m.rounds - S.free * m.freeSq - 6 * Math.max(0, m.free0 - (S.free0 || 3)) - 4 * Math.max(0, m.rounds - (S.maxR || Infinity)) + S.dist * m.dist + S.farS * m.farShare
    - 8 * Math.max(0, S.minN - m.n) - 8 * Math.max(0, m.n - S.maxN) - 60 * Math.max(0, S.fill - m.fill);
}

function clone(a) { return a.map((c) => c.slice()); }
function occOf(arrows) { const o = new Int16Array(W * H).fill(-1); arrows.forEach((c, id) => { for (const p of c) o[p] = id; }); return o; }
function walk(R, occ, start, len) {
  const path = [start], seen = new Set(path);
  let dir = DIRS[(R() * 4) | 0];
  while (path.length < len) {
    const at = path[path.length - 1], x = at % W, y = (at / W) | 0, opts = [];
    for (const d of DIRS) {
      const nx = x + d[0], ny = y + d[1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (occ[ni] < 0 && !seen.has(ni)) opts.push({ d, ni });
    }
    if (!opts.length) break;
    let pick = opts.find((o) => o.d === dir);
    if (!pick || R() > 0.55) pick = opts[(R() * opts.length) | 0];
    dir = pick.d; path.push(pick.ni); seen.add(pick.ni);
  }
  return path;
}
/** One random change; null when it does not apply. */
function mutate(R, arrows) {
  const a = clone(arrows), k = R();
  const id = (R() * a.length) | 0;
  if (k < 0.3) { a[id].reverse(); return a; }
  if (k < 0.42) { if (a.length <= 26) return null; a.splice(id, 1); return a; }
  if (k < 0.62) {   // grow a tail into an empty neighbour
    const occ = occOf(a), t = a[id][0], x = t % W, y = (t / W) | 0;
    const d = DIRS[(R() * 4) | 0], nx = x + d[0], ny = y + d[1];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || occ[ny * W + nx] >= 0 || a[id].length >= 14) return null;
    a[id].unshift(ny * W + nx); return a;
  }
  if (k < 0.72) { if (a[id].length <= 2) return null; a[id].shift(); return a; }
  // a new arrow somewhere empty
  const occ = occOf(a), empty = [];
  for (let i = 0; i < W * H; i++) if (occ[i] < 0) empty.push(i);
  if (!empty.length) return null;
  const p = walk(R, occ, empty[(R() * empty.length) | 0], 2 + ((R() * 8) | 0));
  if (p.length < 2) return null;
  a.push(R() < 0.5 ? p : p.reverse());
  return a;
}

function search(i) {
  const seed = E.seedOf('tricky', i);
  const R = E.rng(seed);
  let cur = E.generate({ cols: W, rows: H, minLen: 3, maxLen: 9, density: 0.8, straight: 0.6, jitter: 0.3 }, seed).arrows;
  let cs = score(measure(cur)), best = cur, bs = cs;
  for (let it = 0; it < ITERS; it++) {
    const temp = 3 * (1 - it / ITERS) + 0.05;
    const nx = mutate(R, cur);
    if (!nx) continue;
    const s = score(measure(nx));
    if (s === -Infinity) continue;
    if (s >= cs || R() < Math.exp((s - cs) / temp)) { cur = nx; cs = s; if (s > bs) { best = nx; bs = s; } }
  }
  return best;
}

const boards = [];
for (let i = 1; i <= COUNT; i++) {
  const t0 = Date.now();
  S = STYLES[styleOf(i)];
  const arrows = search(i);
  const m = measure(arrows);
  boards.push(arrows);
  console.log(`board ${i} (${styleOf(i)}): ${m.n} arrows, ${m.rounds} rounds, free at start ${m.free0}, avg free ${m.avgFree.toFixed(2)}, max free ${m.maxFree}, blocker ${m.dist.toFixed(2)} dots, far ${(100 * m.farShare).toFixed(0)}%, fill ${(100 * m.fill).toFixed(0)}% (${Date.now() - t0} ms)`);
}
const out = `// way-out/js/tricky.js - GENERATED by tools/build-arrow-tricky.mjs (2026-10-26). Never hand-edit; re-run it.
// Arrow Maze's TEST boards: Medium-sized (${W}x${H}) boards made hard by how they play (far blockers, one or
// two arrows free at a time, decoys), not by size. Admin only. Each arrow: its points, head last.
export const TRICKY_W = ${W};
export const TRICKY_H = ${H};
export const TRICKY = ${JSON.stringify(boards)};
`;
writeFileSync(new URL('../way-out/js/tricky.js', import.meta.url), out);
console.log(`wrote way-out/js/tricky.js (${(out.length / 1024).toFixed(1)} KB)`);
