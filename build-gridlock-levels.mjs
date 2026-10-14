#!/usr/bin/env node
// build-gridlock-levels.mjs - makes Gridlock's levels and writes gridlock/js/levels.js (GENERATED:
// never hand-edit it). Run: node build-gridlock-levels.mjs [--count 400] [--seed 1]
//
// HOW A LEVEL IS MADE (Michael Fogleman's idea, https://michaelfogleman.com/rush, done by sampling
// instead of by enumerating every board):
//   1. Lay out a random set of blocks (and, for Expert, a wall or two).
//   2. Find EVERY arrangement those same blocks can reach by sliding (the "cluster").
//   3. Breadth-first search outwards from every arrangement in it where red is at the exit. The
//      arrangement farthest from any of them is the hardest start those blocks have, and its
//      distance is its FEWEST moves. That start is the level, so no level has a shortcut start:
//      there is no harder arrangement of the same blocks.
//   4. Search by editing the deepest layouts found so far (add, remove, swap or shift a block, move
//      a wall). That is what reaches the long puzzles, which random layouts almost never are. It
//      runs one process per CPU for --minutes, so two runs do not make the same file: the file is
//      the record, and once shipped it is only ever appended to (below).
//
// THE LADDER is fixed by fewest moves: each level has a TARGET (rising smoothly through the
// keyframes below) and takes the unused puzzle nearest to it. Levels are numbered 1, 2, 3...
// Easy 1-50, Medium 51-100, Hard 101-150, Expert 151 on (with walls).
//
// THE OUTPUT IS APPEND-ONLY once shipped. A player's progress is "cleared levels 1..n", so changing
// level 37 after release would silently change what they cleared. gridlock/js/test.js pins the
// first SHIPPED levels by hash; to add more, run with --append, which keeps every existing line and
// adds new ones after it.

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, positions, moves, isSolved, keyOf, serialize, solve, N, EXIT_ROW, SOLVED_POS } from './gridlock/js/engine.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const COUNT = +arg('--count', 400);
const SEED = +arg('--seed', 1);
const APPEND = args.includes('--append');
const WORKER = arg('--worker', '');        // internal: "<walls 0|1>,<seconds>,<out file>"
const MINUTES = +arg('--minutes', 12);
const POOLS = arg('--pools', '');          // a folder of pool-*.txt from an earlier search: assemble only
const OUT = new URL('./gridlock/js/levels.js', import.meta.url);
const CLUSTER_CAP = 30000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(SEED);
const ri = (n) => (R() * n) | 0;

// Target fewest-moves per ladder level, linear between keyframes, held after the last.
const KEYS = [[1, 3], [10, 7], [50, 14], [100, 22], [150, 30], [200, 36], [300, 41], [400, 44]];
export function target(n) {
  if (n <= KEYS[0][0]) return KEYS[0][1];
  for (let k = 1; k < KEYS.length; k++) {
    const [a, ta] = KEYS[k - 1], [b, tb] = KEYS[k];
    if (n <= b) return ta + (tb - ta) * (n - a) / (b - a);
  }
  return KEYS[KEYS.length - 1][1];
}

// ---- boards as editable lists of blocks -------------------------------------------------------
// A "layout" = { walls: [cell...], blocks: [{h, len, line, pos}] } with blocks[0] red.
function occOf(L) {
  const occ = new Uint8Array(N * N);
  for (const w of L.walls) occ[w] = 1;
  for (const b of L.blocks) for (let k = 0; k < b.len; k++) occ[b.h ? b.line * N + b.pos + k : (b.pos + k) * N + b.line] = 1;
  return occ;
}
function fits(L, b) {
  if (b.pos < 0 || b.pos + b.len > N) return false;
  if (b.h && b.line === EXIT_ROW) return false;     // nothing but red lies across the exit row
  const occ = occOf(L);
  for (let k = 0; k < b.len; k++) if (occ[b.h ? b.line * N + b.pos + k : (b.pos + k) * N + b.line]) return false;
  return true;
}
function randomBlock() {
  const len = R() < 0.22 ? 3 : 2;
  return { h: R() < 0.5, len, line: ri(N), pos: ri(N - len + 1) };
}
function addRandom(L, tries = 60) {
  for (let t = 0; t < tries; t++) { const b = randomBlock(); if (fits(L, b)) { L.blocks.push(b); return true; } }
  return false;
}
function randomLayout(nBlocks, nWalls) {
  const L = { walls: [], blocks: [{ h: true, len: 2, line: EXIT_ROW, pos: ri(SOLVED_POS) }] };
  for (let w = 0; w < nWalls; w++) {
    for (let t = 0; t < 40; t++) {
      const c = ri(N * N);
      if (((c / N) | 0) === EXIT_ROW) continue;      // a wall on the exit row would make it unsolvable or trivial
      if (!occOf(L)[c]) { L.walls.push(c); break; }
    }
  }
  for (let i = 0; i < nBlocks; i++) addRandom(L);
  return L;
}
function toBoard(L) {
  const s = new Array(N * N).fill('o');
  for (const w of L.walls) s[w] = 'x';
  L.blocks.forEach((b, i) => { for (let k = 0; k < b.len; k++) s[b.h ? b.line * N + b.pos + k : (b.pos + k) * N + b.line] = String.fromCharCode(65 + i); });
  return s.join('');
}
const clone = (L) => ({ walls: L.walls.slice(), blocks: L.blocks.map((b) => ({ ...b })) });

// ---- the cluster --------------------------------------------------------------------------------
/** The hardest start of this layout's cluster: { depth, board, size } or null (unsolvable / too big).
 *  Written for speed (it runs hundreds of thousands of times): states live in one flat byte buffer,
 *  the edges found by the first search are kept so the second never re-derives a move. */
let BUF = new Uint8Array(1 << 22), EDGES = new Int32Array(1 << 23), EOFF = new Int32Array(1 << 19);
function hardest(L) {
  const pz = parse(toBoard(L));
  const P = pz.pieces.length;
  const H = pz.pieces.map((p) => p.h), LEN = pz.pieces.map((p) => p.len), LINE = pz.pieces.map((p) => p.line);
  const base = new Uint8Array(N * N);
  for (const w of pz.walls) base[w] = 255;
  const cell = (i, pos, k) => (H[i] ? LINE[i] * N + pos + k : (pos + k) * N + LINE[i]);
  const index = new Map();
  let n = 0, ne = 0;
  const push = (pos) => {
    if ((n + 1) * P > BUF.length) { const b = new Uint8Array(BUF.length * 2); b.set(BUF); BUF = b; }
    BUF.set(pos, n * P);
    index.set(keyOf(pos), n);
    return n++;
  };
  push(positions(pz));
  const goals = [];
  const occ = new Uint8Array(N * N);
  const cur = new Array(P);
  for (let s = 0; s < n; s++) {
    if (s + 2 > EOFF.length) { const e = new Int32Array(EOFF.length * 2); e.set(EOFF); EOFF = e; }
    EOFF[s] = ne;
    for (let i = 0; i < P; i++) cur[i] = BUF[s * P + i];
    if (cur[0] === SOLVED_POS) goals.push(s);
    occ.set(base);
    for (let i = 0; i < P; i++) for (let k = 0; k < LEN[i]; k++) occ[cell(i, cur[i], k)] = 1;
    for (let i = 0; i < P; i++) {
      const p0 = cur[i];
      for (let dir = -1; dir <= 1; dir += 2) {
        let q = p0;
        while (true) {
          q += dir;
          if (q < 0 || q + LEN[i] > N) break;
          if (occ[cell(i, q, dir < 0 ? 0 : LEN[i] - 1)]) break;
          cur[i] = q;
          const k = keyOf(cur);
          let t = index.get(k);
          if (t === undefined) {
            if (n >= CLUSTER_CAP) return null;
            t = push(cur);
          }
          if (ne >= EDGES.length) { const e = new Int32Array(EDGES.length * 2); e.set(EDGES); EDGES = e; }
          EDGES[ne++] = t;
        }
        cur[i] = p0;
      }
    }
  }
  EOFF[n] = ne;
  if (!goals.length) return null;
  const dist = new Int16Array(n).fill(-1);
  let frontier = goals;
  for (const g of goals) dist[g] = 0;
  let d = 0;
  while (true) {
    const next = [];
    for (const s of frontier) {
      for (let e = EOFF[s]; e < EOFF[s + 1]; e++) {
        const t = EDGES[e];
        if (dist[t] >= 0) continue;
        dist[t] = d + 1;
        next.push(t);
      }
    }
    if (!next.length) break;
    d++; frontier = next;
  }
  // Among the farthest, the one lowest in key order: deterministic for a given cluster.
  let best = -1, bk = Infinity;
  for (const s of frontier) {
    const pos = Array.from(BUF.subarray(s * P, s * P + P));
    const k = keyOf(pos);
    if (k < bk) { bk = k; best = s; }
  }
  return { depth: d, board: serialize(pz, Array.from(BUF.subarray(best * P, best * P + P))), size: n };
}

/** The blocks of a puzzle as a set, ignoring where they sit: one level per set of blocks. */
function signature(board) {
  const pz = parse(board);
  return pz.walls.join(',') + '|' + pz.pieces.map((p) => `${p.h ? 'h' : 'v'}${p.len}${p.line}`).sort().join(',');
}

// ---- the search ---------------------------------------------------------------------------------
const pool = new Map();      // board -> depth, one per signature
const sigs = new Set();
function offer(res) {
  if (!res || res.depth < 2) return;
  const sig = signature(res.board);
  if (sigs.has(sig)) return;
  sigs.add(sig);
  pool.set(res.board, res.depth);
}

/** How many pool puzzles each (walls, fewest moves) has. */
function histogram() {
  const h = { true: [], false: [] };
  for (const [b, d] of pool) { const k = b.includes('x'); h[k][d] = (h[k][d] | 0) + 1; }
  return h;
}

// ---- the deep search (one per CPU, see main) ------------------------------------------------------
// Random layouts almost never make long puzzles, so most of the time goes into EDITING the deepest
// layouts found so far (an "elite" list): add, remove, swap or shift a block, or move a wall.
function mutate(L) {
  const M = clone(L);
  const edits = 1 + ri(2);
  for (let e = 0; e < edits; e++) {
    const r = R();
    const k = M.blocks.length > 1 ? 1 + ri(M.blocks.length - 1) : 0;
    if (r < 0.28 && k) M.blocks.splice(k, 1);
    else if (r < 0.56) addRandom(M);
    else if (r < 0.8 && k) { M.blocks.splice(k, 1); addRandom(M); }
    else if (r < 0.93 && k) {
      const orig = M.blocks[k], b = { ...orig };
      M.blocks.splice(k, 1);
      b.line = Math.max(0, Math.min(N - 1, b.line + (R() < 0.5 ? -1 : 1)));
      M.blocks.splice(k, 0, fits(M, b) ? b : orig);
    } else if (M.walls.length) {
      const w = ri(M.walls.length);
      const old = M.walls[w];
      M.walls.splice(w, 1);
      const c = ri(N * N);
      if (((c / N) | 0) !== EXIT_ROW && !occOf(M)[c]) M.walls.push(c); else M.walls.push(old);
    }
  }
  return M;
}
const asLayout = (board) => { const pz = parse(board); return { walls: pz.walls.slice(), blocks: pz.pieces.map((p) => ({ h: p.h, len: p.len, line: p.line, pos: p.pos })) }; };

function deepSearch(walls, seconds, file) {
  const until = Date.now() + seconds * 1000;
  const elite = [];          // { L, depth, sig }, deepest first
  let written = 0, evals = 0;
  const flush = () => {
    const rows = [...pool].slice(written).map(([b, d]) => `${b} ${d}`);
    if (rows.length) { appendFileSync(file, rows.join('\n') + '\n'); written += rows.length; }
  };
  while (Date.now() < until) {
    let L;
    if (elite.length < 8 || R() < 0.08) L = randomLayout(9 + ri(6), walls ? 1 + (R() < 0.45 ? 1 : 0) : 0);
    else L = elite[ri(Math.min(elite.length, 24))].L;
    const res = hardest(elite.length < 8 ? L : mutate(L));
    evals++;
    if (!res) continue;
    offer(res);
    const sig = signature(res.board);
    if (elite.some((e) => e.sig === sig)) continue;
    if (elite.length < 60 || res.depth > elite[elite.length - 1].depth) {
      elite.push({ L: asLayout(res.board), depth: res.depth, sig });
      elite.sort((a, b) => b.depth - a.depth);
      if (elite.length > 60) elite.pop();
    }
    if (evals % 2000 === 0) flush();
    // Start over now and then: an elite list converges on one family of boards.
    if (evals % 6000 === 0) elite.length = 0;
  }
  flush();
}

if (WORKER) {
  const [w, secs, file] = WORKER.split(',');
  deepSearch(+w === 1, +secs, file);
  process.exit(0);
}

// ---- main ---------------------------------------------------------------------------------------
const existing = [];
if (APPEND && existsSync(OUT)) {
  const m = readFileSync(OUT, 'utf8').match(/'([A-Zox]{36}) (\d+)'/g) || [];
  for (const line of m) { const [b, d] = line.slice(1, -1).split(' '); existing.push([b, +d]); sigs.add(signature(b)); }
}
const first = existing.length + 1;
const t0 = Date.now();
const WALLS_FROM = 151;

// What each level wants, so the search can spend its time where the ladder needs puzzles.
const need = [];
for (let n = first; n <= COUNT; n++) need.push({ n, aim: Math.round(target(n)), walls: n >= WALLS_FROM });

// Search: one process per CPU for MINUTES. One searches boards without walls, the rest boards with
// walls. Each writes what it finds to its own file; this process reads them. --pools <dir> skips the
// search and re-reads an earlier one's files (the folder is printed at the start of every search).
let files = [];
if (POOLS) {
  files = readdirSync(POOLS).filter((f) => /^pool-\d+\.txt$/.test(f)).map((f) => join(POOLS, f));
  console.log(`assembling from ${files.length} pool files in ${POOLS}`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'gridlock-'));
  const cpus = Math.max(2, Math.min(8, availableParallelism()));
  const jobs = [];
  for (let w = 0; w < cpus; w++) {
    const file = join(tmp, `pool-${w}.txt`);
    writeFileSync(file, '');
    const walls = w === 0 ? 0 : 1;
    jobs.push(new Promise((done) => {
      const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), '--seed', String(SEED * 100 + w), '--worker', `${walls},${MINUTES * 60},${file}`], { stdio: 'inherit' });
      ch.on('exit', () => done(file));
    }));
  }
  console.log(`searching on ${cpus} processes for ${MINUTES} min, pools in ${tmp}`);
  files = await Promise.all(jobs);
}
for (const file of files) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [b, d] = line.split(' ');
    if (b && b.length === N * N) offer({ board: b, depth: +d });
  }
}
const h = histogram();
for (const w of [false, true]) console.log(`pool, ${w ? 'walls' : 'no walls'}: ` + h[w].map((c, d) => (c ? `${d}:${c}` : '')).filter(Boolean).join(' '));

// Assign. Easy to Hard (levels 1-150, no walls): each level takes the unused puzzle nearest its
// target. Expert (151 on): the hardest puzzles found, walls or not, in rising order. Long puzzles
// are rare, so a fixed target curve would run out of them; instead each fewest-moves value gets a
// share of Expert's levels in proportion to the SQUARE ROOT of how many puzzles have it (capped at
// how many there are). Plain proportion would spend the first fifty levels on the commonest value;
// the square root keeps Expert climbing about one move every twenty levels, then faster at the top,
// to the longest puzzle found, and it never steps back.
const used = new Set(existing.map(([b]) => b));
const out = existing.slice();
const easyToHard = need.filter((x) => x.n < WALLS_FROM);
// Early levels should LOOK simple too (Unblock Me's first boards are nearly empty), so among the
// puzzles at the right length a level prefers about `want` blocks: 5 at level 1 rising to 12 at 150.
// Boards with a row filled by sideways blocks or a column filled by upright ones are skipped
// (Fogleman's filter: those blocks can never move, so they are clutter, not puzzle).
const blocksOf = (b) => new Set(b.replace(/[ox]/g, '')).size;
function cluttered(b) {
  const pz = parse(b);
  for (let r = 0; r < N; r++) { let c = 0; for (const p of pz.pieces) if (p.h && p.line === r) c += p.len; if (c === N) return true; }
  for (let col = 0; col < N; col++) { let c = 0; for (const p of pz.pieces) if (!p.h && p.line === col) c += p.len; if (c === N) return true; }
  return false;
}
const clean = [...pool].filter(([b]) => !b.includes('x') && !cluttered(b));
for (const x of easyToHard) {
  const t = target(x.n);
  const want = 5 + 7 * (x.n - 1) / (WALLS_FROM - 2);
  let best = null, bd = Infinity;
  for (const [b, d] of clean) {
    if (used.has(b)) continue;
    const e = Math.abs(d - t) * 10 + Math.abs(blocksOf(b) - want);
    if (e < bd || (e === bd && b < best)) { bd = e; best = b; }
  }
  if (!best) { console.log(`ran out of puzzles at level ${x.n}`); break; }
  used.add(best);
  out.push([best, pool.get(best)]);
}
const expertNeed = need.filter((x) => x.n >= WALLS_FROM).length;
if (expertNeed) {
  const floor = out.length ? out[out.length - 1][1] : Math.round(target(WALLS_FROM));
  const byDepth = new Map();
  for (const [b, d] of pool) if (!used.has(b) && d >= floor) (byDepth.get(d) || byDepth.set(d, []).get(d)).push(b);
  const depths = [...byDepth.keys()].sort((x, y) => x - y);
  for (const d of depths) byDepth.get(d).sort();
  const supply = depths.reduce((n, d) => n + byDepth.get(d).length, 0);
  if (supply < expertNeed) console.log(`only ${supply} Expert puzzles for ${expertNeed} levels`);
  const want = Math.min(expertNeed, supply);
  const weight = depths.map((d) => Math.sqrt(byDepth.get(d).length));
  const wsum = weight.reduce((x, y) => x + y, 0);
  const quota = depths.map((d, k) => Math.min(byDepth.get(d).length, Math.floor(weight[k] * want / wsum)));
  // Hand out what rounding left over, lowest depths first, where there is room.
  let left = want - quota.reduce((x, y) => x + y, 0);
  for (let k = 0; left > 0 && k < depths.length; k = (k + 1) % depths.length) {
    if (quota[k] < byDepth.get(depths[k]).length) { quota[k]++; left--; }
    if (k === depths.length - 1 && quota.every((q, j) => q >= byDepth.get(depths[j]).length)) break;
  }
  depths.forEach((d, k) => {
    const list = byDepth.get(d);
    // Spread the picks through the (sorted) list so they are not all from one corner of the search.
    for (let j = 0; j < quota[k]; j++) {
      const b = list[quota[k] === 1 ? 0 : Math.round(j * (list.length - 1) / (quota[k] - 1))];
      used.add(b);
      out.push([b, d]);
    }
  });
}

// Every level is re-solved from scratch by the game's own solver before it is written.
for (const [b, d] of out) {
  const pz = parse(b);
  const p = solve(pz, positions(pz));
  if (!p || p.length !== d) throw new Error(`level ${b} claims ${d}, solver says ${p && p.length}`);
}

const lines = out.map(([b, d], i) => `  '${b} ${d}',${(i + 1) % 10 === 0 ? ` // ${i + 1}` : ''}`);
writeFileSync(OUT, `// gridlock/js/levels.js - GENERATED by build-gridlock-levels.mjs. NEVER HAND-EDIT.
// One line per ladder level (level 1 first): the board (gridlock/js/engine.js's notation) and its
// fewest moves. APPEND-ONLY once shipped: a player's progress is "levels 1..n", so a changed line
// would change what they cleared (gridlock/js/test.js pins it).
export const LEVELS = [
${lines.join('\n')}
];
`);
const depths = out.map(([, d]) => d);
console.log(`wrote ${out.length} levels in ${((Date.now() - t0) / 1000).toFixed(0)}s; fewest moves by band:`);
for (const [name, a, b] of [['easy', 1, 50], ['medium', 51, 100], ['hard', 101, 150], ['expert', 151, out.length]]) {
  const ds = depths.slice(a - 1, b);
  if (ds.length) console.log(`  ${name} ${a}-${b}: ${Math.min(...ds)}..${Math.max(...ds)}`);
}
let jump = 0;
for (let i = 1; i < depths.length; i++) jump = Math.max(jump, Math.abs(depths[i] - depths[i - 1]));
console.log(`  biggest step between neighbours: ${jump}`);
