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
// LADDER 2 (2026-10-14, Matt: "Add more levels. If other games have 18,000+, we should have more
// than 400"): Easy 1-1000 (3 -> 12 moves), Medium 1001-2000 (12 -> 20), Hard 2001-3000 (20 -> 28,
// walls allowed), Expert 3001 on (28 -> 51). Easy to Hard: each level takes the unused puzzle nearest
// a target that rises smoothly; Expert: the longest puzzles, spread by the square root of supply (see
// below). EVERY BOARD OF THE FIRST LADDER (the 400 of gridlock/data/levels-v1.txt) is placed in the
// new one, and js/gridlock-v1map.js records where, so a level cleared on the first ladder is read
// as the same board on this one (js/gridlock-points.js). Ladder 1 is frozen: never edit that file.
//
// Run: node build-gridlock-levels.mjs --pools <dir>[,<dir>...] --v1 gridlock/data/levels-v1.txt
// (or without --pools to search first: --minutes, one process per CPU).
//
// THE OUTPUT IS APPEND-ONLY once shipped: a player's progress is per level number, so a changed line
// would change what they cleared. gridlock/js/test.js pins it by hash. Expert can grow at the end.

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, positions, moves, isSolved, keyOf, serialize, solve, N, EXIT_ROW, SOLVED_POS } from './gridlock/js/engine.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const SEED = +arg('--seed', 1);
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

// ---- main: ladder 2 -----------------------------------------------------------------------------
const BAND = 1000;                     // levels per difficulty; Expert carries on past 3000
const WALLS_FROM = 2 * BAND + 1;       // walls appear from Hard on
const EXPERT_FROM = 3 * BAND + 1;
const EXPERT_COUNT = +arg('--expert', 1000);
const V1 = arg('--v1', '');
const t0 = Date.now();
const KEYS2 = [[1, 3], [BAND, 12], [2 * BAND, 20], [3 * BAND, 28]];
function target2(n) {
  for (let k = 1; k < KEYS2.length; k++) {
    const [a, ta] = KEYS2[k - 1], [b, tb] = KEYS2[k];
    if (n <= b) return ta + (tb - ta) * (n - a) / (b - a);
  }
  return KEYS2[KEYS2.length - 1][1];
}

// The pools: an earlier search's files (--pools a,b) or a fresh search.
let files = [];
if (POOLS) {
  for (const dir of POOLS.split(',')) files.push(...readdirSync(dir).filter((f) => /^pool-\d+\.txt$/.test(f)).map((f) => join(dir, f)));
  console.log(`assembling from ${files.length} pool files`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'gridlock-'));
  const cpus = Math.max(2, Math.min(8, availableParallelism()));
  const jobs = [];
  for (let w = 0; w < cpus; w++) {
    const file = join(tmp, `pool-${w}.txt`);
    writeFileSync(file, '');
    const walls = w % 2;            // half the processes without walls (they reach the longest puzzles), half with
    jobs.push(new Promise((done) => {
      const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), '--seed', String(SEED * 100 + w), '--worker', `${walls},${MINUTES * 60},${file}`], { stdio: 'inherit' });
      ch.on('exit', () => done(file));
    }));
  }
  console.log(`searching on ${cpus} processes for ${MINUTES} min, pools in ${tmp}`);
  files = await Promise.all(jobs);
}
// Ladder 1's boards first, so the de-duplication by block set can never drop one of them.
const v1 = V1 ? readFileSync(V1, 'utf8').split('\n').map((l) => l.trim().split(' ')).filter(([b]) => b && b.length === N * N).map(([b, d]) => [b, +d]) : [];
const isV1 = new Set(v1.map(([b]) => b));
for (const [b, d] of v1) { pool.set(b, d); sigs.add(signature(b)); }
for (const file of files) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [b, d] = line.split(' ');
    if (b && b.length === N * N) offer({ board: b, depth: +d });
  }
}
const h = histogram();
for (const w of [false, true]) console.log(`pool, ${w ? 'walls' : 'no walls'}: ` + h[w].map((c, d) => (c ? `${d}:${c}` : '')).filter(Boolean).join(' '));

// Candidates, by fewest moves. Boards with a row or column of blocks that can never move are
// skipped (Fogleman's filter: clutter, not puzzle). Within a length: ladder 1's boards first, then a
// fixed shuffle (a hash of the board), so neighbours do not come from one corner of the search.
const blocksOf = (b) => new Set(b.replace(/[ox]/g, '')).size;
function cluttered(b) {
  const pz = parse(b);
  for (let r = 0; r < N; r++) { let c = 0; for (const p of pz.pieces) if (p.h && p.line === r) c += p.len; if (c === N) return true; }
  for (let col = 0; col < N; col++) { let c = 0; for (const p of pz.pieces) if (!p.h && p.line === col) c += p.len; if (c === N) return true; }
  return false;
}
const hash = (b) => { let x = 2166136261; for (let i = 0; i < b.length; i++) { x ^= b.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
const byDepth = new Map();      // depth -> [{ b, d, walls, blocks, v1 }]
for (const [b, d] of pool) {
  if (!isV1.has(b) && cluttered(b)) continue;
  (byDepth.get(d) || byDepth.set(d, []).get(d)).push({ b, d, walls: b.includes('x'), blocks: blocksOf(b), v1: isV1.has(b), h: hash(b) });
}
for (const list of byDepth.values()) list.sort((x, y) => (y.v1 - x.v1) || (x.h - y.h));
const used = new Set();
const out = [];

// Easy, Medium, Hard: the unused puzzle nearest the target, about `want` blocks (5 at level 1 to 13
// at 3000), ladder 1's boards first when they are the right length.
for (let n = 1; n < EXPERT_FROM; n++) {
  const t = target2(n), want = 5 + 8 * (n - 1) / (EXPERT_FROM - 2);
  let best = null, bs = Infinity;
  for (let d = Math.floor(t) - 1; d <= Math.ceil(t) + 1; d++) {
    const list = byDepth.get(d) || [];
    let seen = 0;
    for (const c of list) {
      if (used.has(c.b) || (c.walls && n < WALLS_FROM)) continue;
      const sc = Math.abs(d - t) * 10 + Math.abs(c.blocks - want) - (c.v1 && Math.abs(d - t) <= 0.75 ? 100 : 0);
      if (sc < bs) { bs = sc; best = c; }
      if (++seen > 80) break;
    }
  }
  if (!best) throw new Error(`ran out of puzzles at level ${n} (target ${t.toFixed(1)})`);
  used.add(best.b);
  out.push([best.b, best.d]);
}

// Expert: the longest puzzles, each length's share in proportion to the SQUARE ROOT of how many there
// are (capped at how many), so Expert climbs steadily to the longest one and never steps back, and
// every ladder 1 board of that length is in.
{
  const floor = out[out.length - 1][1];
  const depths = [...byDepth.keys()].filter((d) => d >= floor).sort((x, y) => x - y);
  const avail = (d) => byDepth.get(d).filter((c) => !used.has(c.b));
  const weight = depths.map((d) => Math.sqrt(avail(d).length));
  const wsum = weight.reduce((x, y) => x + y, 0);
  const quota = depths.map((d, k) => Math.max(avail(d).filter((c) => c.v1).length, Math.min(avail(d).length, Math.floor(weight[k] * EXPERT_COUNT / wsum))));
  let left = EXPERT_COUNT - quota.reduce((x, y) => x + y, 0);
  for (let guard = 0; left > 0 && guard < 100000; guard++) {
    const k = guard % depths.length;
    if (quota[k] < avail(depths[k]).length) { quota[k]++; left--; }
  }
  depths.forEach((d, k) => {
    const list = avail(d);
    const v1s = list.filter((c) => c.v1), rest = list.filter((c) => !c.v1);
    const picks = v1s.slice();
    const more = quota[k] - picks.length;
    for (let j = 0; j < more; j++) picks.push(rest[more === 1 ? 0 : Math.round(j * (rest.length - 1) / (more - 1))]);
    // A fixed shuffle within the length, so ladder 1's boards are not all bunched together.
    picks.sort((x, y) => x.h - y.h);
    for (const c of picks) { if (used.has(c.b)) continue; used.add(c.b); out.push([c.b, d]); }
  });
}

// Every ladder 1 board must be in, exactly once.
const index = new Map(out.map(([b], i) => [b, i + 1]));
const missing = v1.filter(([b]) => !index.has(b));
if (missing.length) throw new Error(`${missing.length} ladder 1 boards were not placed`);

// Every level is re-solved from scratch by the game's own solver before it is written.
for (const [b, d] of out) {
  const pz = parse(b);
  const p = solve(pz, positions(pz));
  if (!p || p.length !== d) throw new Error(`level ${b} claims ${d}, solver says ${p && p.length}`);
}

writeFileSync(OUT, `// gridlock/js/levels.js - GENERATED by build-gridlock-levels.mjs. NEVER HAND-EDIT.
// LADDER 2: one line per level (level 1 first), the board (gridlock/js/engine.js's notation) and its
// fewest moves. Easy 1-${BAND}, Medium ${BAND + 1}-${2 * BAND}, Hard ${2 * BAND + 1}-${3 * BAND}, Expert ${EXPERT_FROM} on. APPEND-ONLY once
// shipped: progress is per level number, so a changed line would change what a player cleared
// (gridlock/js/test.js pins it).
export const LEVELS = [
${out.map(([b, d]) => `'${b} ${d}'`).join(',\n')},
];
`);
if (v1.length) {
  writeFileSync(new URL('./js/gridlock-v1map.js', import.meta.url), `// js/gridlock-v1map.js - GENERATED by build-gridlock-levels.mjs. NEVER HAND-EDIT.
// Where each board of Gridlock's FIRST ladder (400 levels, 2026-10-14, frozen in
// gridlock/data/levels-v1.txt) sits on ladder 2: V1_TO_V2[k] is the ladder 2 level of ladder 1 level
// k + 1. Read by js/gridlock-points.js, so a level cleared on ladder 1 counts as the same board.
export const V1_TO_V2 = [${v1.map(([b]) => index.get(b)).join(',')}];
`);
}
const depths = out.map(([, d]) => d);
console.log(`wrote ${out.length} levels in ${((Date.now() - t0) / 1000).toFixed(0)}s; fewest moves by band:`);
for (const [name, a, b] of [['easy', 1, BAND], ['medium', BAND + 1, 2 * BAND], ['hard', 2 * BAND + 1, 3 * BAND], ['expert', EXPERT_FROM, out.length]]) {
  const ds = depths.slice(a - 1, b);
  if (ds.length) console.log(`  ${name} ${a}-${b}: ${Math.min(...ds)}..${Math.max(...ds)}, average ${(ds.reduce((x, y) => x + y, 0) / ds.length).toFixed(1)}`);
}
let jump = 0, drop = 0;
for (let i = 1; i < depths.length; i++) { jump = Math.max(jump, depths[i] - depths[i - 1]); drop = Math.max(drop, depths[i - 1] - depths[i]); }
console.log(`  biggest rise between neighbours: ${jump}, biggest drop: ${drop}`);
