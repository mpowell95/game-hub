// tools/arrow-search.mjs - the board search behind Arrow Maze's hard-by-thinking boards (2026-10-26),
// shared by tools/build-arrow-tricky.mjs (the admin test boards) and tools/build-arrow-boards8.mjs (the
// Hard and Expert levels). Pure maths on a 16x22 grid; every board it keeps is proved solvable by
// peel. Changing ANY of it changes what both tools build: the shipped files are pinned by test.js.
const E = await import('../way-out/js/engine.js');
export const W = 16, H = 22;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Everything the score needs, from one peel that also measures each blocked arrow's blocker distance. */
export function measure(arrows) {
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
export const STYLES = {
  far: { rounds: 1.2, free: 0.6, dist: 12, farS: 40, minN: 30, maxN: 40, fill: 0.45 },
  mixed: { rounds: 1.0, free: 0.8, dist: 9, farS: 30, minN: 40, maxN: 50, fill: 0.55 },
  forced: { rounds: 2.2, free: 1.2, dist: 5, farS: 14, minN: 50, maxN: 65, fill: 0.62 },
  // (2026-10-27, Matt: "I think you could upgrade hard a bit too") boards 11-15: a milder mix for
  // Hard: blockers a few dots away, two or three arrows free at a time, a fuller board.
  hard: { rounds: 0.8, free: 0.35, dist: 5, farS: 10, minN: 45, maxN: 55, fill: 0.6, free0: 5, maxR: 26 },
};
function score(m, S) {
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

/** One board: a generated start, then ITERS random changes kept by simulated annealing on `style`'s
 *  score. Every kept board is solvable (score() is -Infinity for one peel cannot empty). */
export function search(seed, style, ITERS) {
  const S = STYLES[style];
  const R = E.rng(seed);
  let cur = E.generate({ cols: W, rows: H, minLen: 3, maxLen: 9, density: 0.8, straight: 0.6, jitter: 0.3 }, seed).arrows;
  let cs = score(measure(cur), S), best = cur, bs = cs;
  for (let it = 0; it < ITERS; it++) {
    const temp = 3 * (1 - it / ITERS) + 0.05;
    const nx = mutate(R, cur);
    if (!nx) continue;
    const s = score(measure(nx), S);
    if (s === -Infinity) continue;
    if (s >= cs || R() < Math.exp((s - cs) / temp)) { cur = nx; cs = s; if (s > bs) { best = nx; bs = s; } }
  }
  return best;
}

