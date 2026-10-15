// minesweeper-odds.mjs - how winnable each Minesweeper level is for a player who never makes a
// mistake, and how often such a player is forced to guess. Read-only: no game state, no storage,
// no network. Run from the repo root.
//
//   node tools/minesweeper-odds.mjs                 all four levels, our rules, 4000 boards each
//   node tools/minesweeper-odds.mjs hard 20000      one level
//   node tools/minesweeper-odds.mjs 9x9:10 20000 --classic   any board, classic rules
//
// The perfect player: on every turn it works out, exactly, the chance that each closed square is a
// mine (every mine layout the numbers allow, weighted by how many ways the leftover mines fit in
// the squares nobody has information about). It opens every square that is certainly safe, flags
// every certain mine, and only when nothing is certain opens the safest square (ties at random).
//
// Our rules: the first tap opens an area (no mine in the 3x3 around it), as engine.js deals.
// --classic: only the tapped square is safe, the rule the published figures below use.
//
// CALIBRATED (2026-10-15) against Minesweepr's published 100,000-game results for this exact
// player ("None" strategy, mrgris.com/projects/minesweepr): 9x9/10 84.9% (published 84.8),
// 8x8/10 74.1% (74.1), 16x16/40 69.7% (69.2), 30x16/99 32.4% (33.1); all within error.
//
// A rare board makes the exact count explode (about 1 in 1,500 on Expert); after 3 million
// steps that board is dropped, replaced by a fresh one, and counted as "skipped" in the output.
import { LEVELS } from '../minesweeper/js/engine.js';

const args = process.argv.slice(2);
const CLASSIC = args.includes('--classic');
const pos = args.filter((a) => !a.startsWith('--'));
const N = Number(pos[1]) || 4000;
const boards = [];
if (!pos[0]) for (const [id, L] of Object.entries(LEVELS)) boards.push({ id, W: L.w, H: L.h, M: L.mines });
else if (LEVELS[pos[0]]) { const L = LEVELS[pos[0]]; boards.push({ id: pos[0], W: L.w, H: L.h, M: L.mines }); }
else { const m = /^(\d+)x(\d+):(\d+)$/.exec(pos[0]); if (!m) { console.error('level name or WxH:mines'); process.exit(1); } boards.push({ id: pos[0], W: +m[1], H: +m[2], M: +m[3] }); }

function comb(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }

function run({ id, W, H, M }) {
const OPENING = !CLASSIC;
let nodes = 0, skipped = 0; let guessesThis = 0, boardsGuessed = 0, totalGuesses = 0;
const T = W * H;
const NB = []; for (let i = 0; i < T; i++) { const x = i % W, y = (i / W) | 0, o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = x + dx, b = y + dy; if ((dx || dy) && a >= 0 && b >= 0 && a < W && b < H) o.push(b * W + a); } NB.push(o); }
function play() {
  const first = (Math.random() * T) | 0;
  guessesThis = 0; nodes = 0; const safe = new Set(OPENING ? [first, ...NB[first]] : [first]);
  const cand = []; for (let i = 0; i < T; i++) if (!safe.has(i)) cand.push(i);
  for (let i = cand.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const mine = new Uint8Array(T); for (let i = 0; i < M; i++) mine[cand[i]] = 1;
  const num = new Int8Array(T); for (let i = 0; i < T; i++) num[i] = NB[i].reduce((s, j) => s + mine[j], 0);
  const open = new Uint8Array(T), flag = new Uint8Array(T); let opened = 0;
  const reveal = (s) => { if (mine[s]) return false; const st = [s]; while (st.length) { const j = st.pop(); if (open[j]) continue; open[j] = 1; opened++; if (num[j] === 0) for (const n of NB[j]) if (!open[n]) st.push(n); } return true; };
  reveal(first);
  while (opened < T - M) {
    // exact probabilities with the GLOBAL mine count: enumerate each frontier group, then weight
    // group solutions by how many ways the remaining mines fit in the unconstrained squares.
    const cons = []; for (let i = 0; i < T; i++) if (open[i] && num[i] > 0) { const v = NB[i].filter((j) => !open[j] && !flag[j]); if (v.length) cons.push({ v, n: num[i] - NB[i].filter((j) => flag[j]).length }); }
    const front = [...new Set(cons.flatMap((c) => c.v))]; const fset = new Set(front);
    const comp = new Map(); let k = 0;
    for (const v of front) if (!comp.has(v)) { const st = [v]; comp.set(v, k); while (st.length) { const u = st.pop(); for (const c of cons) if (c.v.includes(u)) for (const w of c.v) if (!comp.has(w)) { comp.set(w, k); st.push(w); } } k++; }
    // per group: map mineCount -> {ways, perVarCount[]}
    const groups = [];
    for (let q = 0; q < k; q++) {
      const vars = front.filter((v) => comp.get(v) === q), cs = cons.filter((c) => comp.get(c.v[0]) === q);
      const at = new Map(vars.map((v, i) => [v, i])), a = new Int8Array(vars.length).fill(-1), byM = new Map();
      const ok = () => { for (const c of cs) { let m = 0, u = 0; for (const v of c.v) { const x = a[at.get(v)]; if (x === 1) m++; else if (x === -1) u++; } if (m > c.n || m + u < c.n) return false; } return true; };
      const rec = (d, m) => { if (++nodes > 3e6) throw new Error('cap'); if (d === vars.length) { let e = byM.get(m); if (!e) byM.set(m, e = { ways: 0, cnt: new Float64Array(vars.length) }); e.ways++; for (let i = 0; i < vars.length; i++) if (a[i] === 1) e.cnt[i]++; return; } for (const val of [0, 1]) { a[d] = val; if (ok()) rec(d + 1, m + val); } a[d] = -1; };
      rec(0, 0); groups.push({ vars, byM });
    }
    const flagged = flag.reduce((s, x) => s + x, 0);
    const interior = []; for (let i = 0; i < T; i++) if (!open[i] && !flag[i] && !fset.has(i)) interior.push(i);
    const left = M - flagged;
    // convolve groups over mine totals
    let dist = new Map([[0, 1]]);
    for (const g of groups) { const nd = new Map(); for (const [m0, w0] of dist) for (const [m1, e] of g.byM) nd.set(m0 + m1, (nd.get(m0 + m1) || 0) + w0 * e.ways); dist = nd; }
    let total = 0; for (const [m, w] of dist) total += w * comb(interior.length, left - m);
    const prob = new Map(); let interiorMines = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      // distribution of the other groups
      let other = new Map([[0, 1]]);
      groups.forEach((g, j) => { if (j === gi) return; const nd = new Map(); for (const [m0, w0] of other) for (const [m1, e] of g.byM) nd.set(m0 + m1, (nd.get(m0 + m1) || 0) + w0 * e.ways); other = nd; });
      const g = groups[gi], acc = new Float64Array(g.vars.length);
      for (const [m1, e] of g.byM) { let wRest = 0; for (const [m0, w0] of other) wRest += w0 * comb(interior.length, left - m1 - m0); for (let i = 0; i < g.vars.length; i++) acc[i] += e.cnt[i] * wRest; }
      g.vars.forEach((v, i) => prob.set(v, acc[i] / total));
    }
    for (const [m, w] of dist) interiorMines += w * comb(interior.length, left - m) * (left - m);
    const pInt = interior.length ? interiorMines / total / interior.length : 1;
    let moved = false;
    for (const [v, p] of prob) { if (p < 1e-12) { if (!reveal(v)) return false; moved = true; } else if (p > 1 - 1e-12) flag[v] = 1; }
    if (!moved && interior.length && pInt < 1e-12) { for (const i of interior) if (!reveal(i)) return false; moved = true; }
    if (moved) continue;
    // guess: safest square, random tie-break
    let best = 2, list = [];
    const consider = (i, p) => { if (p < best - 1e-12) { best = p; list = [i]; } else if (Math.abs(p - best) <= 1e-12) list.push(i); };
    for (const [v, p] of prob) if (p < 1 - 1e-12) consider(v, p);
    for (const i of interior) consider(i, pInt);
    if (!list.length) return false;
    guessesThis++;
    if (!reveal(list[(Math.random() * list.length) | 0])) return false;
  }
  return true;
}
let w = 0; for (let i = 0; i < N; i++) { let r; try { r = play(); } catch (e) { if (e.message !== 'cap') throw e; skipped++; i--; continue; } if (r) w++; if (guessesThis) boardsGuessed++; totalGuesses += guessesThis; }
const p = w / N, se = Math.sqrt(p * (1 - p) / N);
console.log(`${id} ${W}x${H}, ${M} mines${CLASSIC ? ' (classic first click)' : ''}, ${N} boards: wins ${(100 * p).toFixed(1)}% (±${(196 * se).toFixed(1)}), no guess needed ${(100 - 100 * boardsGuessed / N).toFixed(1)}%, average guesses ${(totalGuesses / N).toFixed(2)}, skipped ${skipped}`);
}
for (const b of boards) run(b);
