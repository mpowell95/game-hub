// tools/arrow-search.mjs - the board search behind Arrow Maze's hard-by-thinking boards (2026-10-26),
// used by tools/build-arrow-boards8.mjs (the Hard and Expert levels). It first built the admin test boards
// (tools/build-arrow-tricky.mjs, removed 2026-10-27 with them; in git history). Pure maths on a 16x22 grid; every board it keeps is proved solvable by
// peel. Changing ANY of it changes what both tools build: the shipped files are pinned by test.js.
const E = await import('../way-out/js/engine.js');
export let W = 16, H = 22;
/** The grid the search works on (2026-10-28: Impossible tests at 18 wide). 16x22 unless set; every
 *  shipped board file was built on 16x22, and its tool never calls this. */
export function setGrid(w, h) { W = w; H = h; }
/** A move whose next arrow is closer than this (dots) to the arrow just removed is "near" (no searching). */
export const JUMP_MIN = 5;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Everything the score needs, from one peel that also measures each blocked arrow's blocker distance. */
export function measure(arrows) {
  const n = arrows.length;
  const occ = new Int16Array(W * H).fill(-1);
  arrows.forEach((c, id) => { for (const p of c) occ[p] = id; });
  const gone = new Uint8Array(n);
  let left = n, rounds = 0, freeSum = 0, freeSq = 0, dSum = 0, dN = 0, far = 0, maxFree = 0, trains = 0;
  // JUMPS (2026-10-28, Matt cleared the first Impossible tests in 1:43 and 1:41: the next free arrow's head
  // was ~2 dots from the arrow just removed, so he never had to search). For each move, how far (dots)
  // the newly free arrow's head is from the arrow that just left; `near` counts the moves under JUMP_MIN.
  let jumpSum = 0, jumpN = 0, near = 0;
  let lastGone = null;
  const first = [];
  // TRAINS (2026-10-28, Matt's recording of Expert 251: a row of arrows all pointing the same way, each
  // freed by the one in front, "just tapping directly in order"): an arrow freed this round whose
  // blocker last round was an arrow pointing the SAME way with its head in the SAME row or column.
  const blk = new Int16Array(n).fill(-1);
  const same = (a, b) => {
    const [dx, dy] = E.dirOf(arrows[a], W), [ex, ey] = E.dirOf(arrows[b], W);
    if (dx !== ex || dy !== ey) return false;
    const h = arrows[a][arrows[a].length - 1], g = arrows[b][arrows[b].length - 1];
    return dx ? ((h / W) | 0) === ((g / W) | 0) : (h % W) === (g % W);
  };
  while (left) {
    const now = [];
    for (let id = 0; id < n; id++) {
      if (gone[id]) continue;
      const b = E.blockerOf(arrows[id], occ, W, H, id);
      if (!b) { now.push(id); if (blk[id] >= 0 && same(id, blk[id])) trains++; }
      else { dSum += b.steps; dN++; if (b.steps >= 4) far++; blk[id] = occ[b.cell]; }
    }
    if (!now.length) return null;
    if (lastGone) {
      for (const id of now) {
        const h = arrows[id][arrows[id].length - 1], hx = h % W, hy = (h / W) | 0;
        let d = Infinity;
        for (const g of lastGone) for (const p of arrows[g]) d = Math.min(d, Math.abs((p % W) - hx) + Math.abs(((p / W) | 0) - hy));
        jumpSum += Math.min(d, 10); jumpN++; if (d < JUMP_MIN) near++;
      }
    }
    lastGone = now;
    rounds++;
    if (rounds === 1) first.push(...now);
    freeSum += now.length; freeSq += (now.length - 1) ** 2; maxFree = Math.max(maxFree, now.length);
    for (const id of now) { gone[id] = 1; for (const p of arrows[id]) occ[p] = -1; }
    left -= now.length;
  }
  const cells = arrows.reduce((a, c) => a + c.length, 0);
  return { n, rounds, trains, jump: jumpN ? jumpSum / jumpN : 0, near, avgFree: freeSum / rounds, freeSq, maxFree, free0: first.length, dist: dN ? dSum / dN : 0, far, farShare: dN ? far / dN : 0, fill: cells / (W * H) };
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
  // (2026-10-28, Matt: "an 'impossible' category ... 70+ arrows and there's exactly 1 way to solve it ...
  // only one arrow can be moved at a time. And zero arrows ... from the same column or row facing the same
  // direction") IMPOSSIBLE: one arrow free at every step (so one order), 70+ arrows, and no trains.
  impossible: { rounds: 3, free: 12, dist: 3, farS: 8, minN: 73, maxN: 80, fill: 0.7, free0: 1, train: 25 },
  // (2026-10-28, Matt: "Make them harder. I want a puzzle that's going to take me 5+ minutes of active
  // focus") IMPOSSIBLE with JUMPS: as impossible, and every next arrow far from the one just removed.
  jumps: { rounds: 3, free: 12, dist: 3, farS: 8, minN: 60, maxN: 80, fill: 0.62, free0: 1, train: 25, jump: 6, near: 3 },
  // (2026-10-27, Matt: "I think you could upgrade hard a bit too") boards 11-15: a milder mix for
  // Hard: blockers a few dots away, two or three arrows free at a time, a fuller board.
  hard: { rounds: 0.8, free: 0.35, dist: 5, farS: 10, minN: 45, maxN: 55, fill: 0.6, free0: 5, maxR: 26 },
};
function score(m, S) {
  if (!m) return -Infinity;
  return S.rounds * m.rounds - S.free * m.freeSq - 6 * Math.max(0, m.free0 - (S.free0 || 3)) - 4 * Math.max(0, m.rounds - (S.maxR || Infinity)) + S.dist * m.dist + S.farS * m.farShare
    - 8 * Math.max(0, S.minN - m.n) - 8 * Math.max(0, m.n - S.maxN) - 60 * Math.max(0, S.fill - m.fill)
    - (S.train || 0) * m.trains + (S.jump || 0) * m.jump - (S.near || 0) * m.near;
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
export function search(seed, style, ITERS, over, scorer) {
  const S = over ? { ...STYLES[style], ...over } : STYLES[style];   // `over` (2026-10-27): per-board tweaks, e.g. Expert's growing arrow count
  // `scorer(arrows)` (2026-10-28): a whole other score, e.g. the played-through one below; -Infinity = unsolvable.
  const sc = scorer || ((a) => score(measure(a), S));
  const R = E.rng(seed);
  let cur = E.generate({ cols: W, rows: H, minLen: 3, maxLen: 9, density: 0.8, straight: 0.6, jitter: 0.3 }, seed).arrows;
  let cs = sc(cur), best = cur, bs = cs;
  for (let it = 0; it < ITERS; it++) {
    const temp = 3 * (1 - it / ITERS) + 0.05;
    const nx = mutate(R, cur);
    if (!nx) continue;
    const s = sc(nx);
    if (s === -Infinity) continue;
    if (s >= cs || R() < Math.exp((s - cs) / temp)) { cur = nx; cs = s; if (s > bs) { best = nx; bs = s; } }
  }
  return best;
}


// --- PLAYED THROUGH (2026-10-28) ----------------------------------------------------------------------
// Matt, after Impossible 7-8: "it's still just too straight forward. right now it's, click an arrow, scan
// the row and columns it blocked, and so on. every tap leads directly to the next one", and "fill in the
// spaces with ... noise. so you have to clear them to get to the real puzzle. and make them closed loops."
// With only one arrow free at a time, every tap MUST free the next one: that trail is built in. So this
// plays the board the way he does (always the arrow freed most recently, the trail) and counts what
// breaks the trail: DEAD taps, ones that free nothing, after which the next arrow is somewhere else.
/** Play `arrows` tap by tap following the trail. null when it jams (unsolvable). */
export function playThrough(arrows) {
  const n = arrows.length;
  const occ = new Int16Array(W * H).fill(-1);
  arrows.forEach((c, id) => { for (const p of c) occ[p] = id; });
  const gone = new Uint8Array(n), freeAt = new Int32Array(n).fill(-1), blk = new Int16Array(n).fill(-1);
  const isFree = (id) => { const b = E.blockerOf(arrows[id], occ, W, H, id); if (b) blk[id] = occ[b.cell]; return !b; };
  const sameLane = (a, b) => {
    const [dx, dy] = E.dirOf(arrows[a], W), [ex, ey] = E.dirOf(arrows[b], W);
    if (dx !== ex || dy !== ey) return false;
    const h = arrows[a][arrows[a].length - 1], g = arrows[b][arrows[b].length - 1];
    return dx ? ((h / W) | 0) === ((g / W) | 0) : (h % W) === (g % W);
  };
  const dist = (a, b) => { const h = arrows[b][arrows[b].length - 1], hx = h % W, hy = (h / W) | 0; let d = 99; for (const p of arrows[a]) d = Math.min(d, Math.abs((p % W) - hx) + Math.abs(((p / W) | 0) - hy)); return d; };
  for (let id = 0; id < n; id++) if (isFree(id)) freeAt[id] = 0;
  let dead = 0, deadJump = 0, trains = 0, maxFree = 0, freeSum = 0, last = -1;
  for (let t = 1; t <= n; t++) {
    let pick = -1, nFree = 0;
    for (let id = 0; id < n; id++) if (!gone[id] && freeAt[id] >= 0) { nFree++; if (pick < 0 || freeAt[id] > freeAt[pick]) pick = id; }
    if (pick < 0) return null;
    maxFree = Math.max(maxFree, nFree); freeSum += nFree;
    gone[pick] = 1; for (const p of arrows[pick]) occ[p] = -1;
    let freed = 0;
    for (let id = 0; id < n; id++) {
      if (gone[id] || freeAt[id] >= 0) continue;
      const was = blk[id];
      if (isFree(id)) { freeAt[id] = t; freed++; if (was === pick && sameLane(id, pick)) trains++; }
    }
    if (!freed && t < n) {
      // nothing new: the next tap is an arrow freed earlier, somewhere else
      let nxt = -1;
      for (let id = 0; id < n; id++) if (!gone[id] && freeAt[id] >= 0 && (nxt < 0 || freeAt[id] > freeAt[nxt])) nxt = id;
      if (nxt < 0) return null;
      dead++; deadJump += Math.min(10, dist(pick, nxt));
    }
    last = pick;
  }
  // "closed loops": how curly the arrows are (turns per arrow), Matt's small looped shapes
  let turns = 0;
  for (const c of arrows) for (let k = 2; k < c.length; k++) if ((c[k] - c[k - 1]) !== (c[k - 1] - c[k - 2])) turns++;
  const cells = arrows.reduce((a, c) => a + c.length, 0);
  void last;
  return { n, dead, deadShare: n > 1 ? dead / (n - 1) : 0, deadJump: dead ? deadJump / dead : 0, trains, maxFree, avgFree: freeSum / n, turns: turns / n, fill: cells / (W * H) };
}
/** A score for boards that break the trail: many dead taps, far from the next arrow, few arrows free at a
 *  time, curly arrows, a full board, no trains. */
export function noiseScore(o) {
  return (a) => {
    const m = playThrough(a);
    if (!m) return -Infinity;
    return o.dead * m.deadShare + o.deadJump * m.deadJump - o.free * Math.max(0, m.maxFree - o.maxFree) - o.avgFree * m.avgFree
      + o.turns * m.turns - 25 * m.trains - 8 * Math.max(0, o.minN - m.n) - 60 * Math.max(0, o.fill - m.fill);
  };
}
