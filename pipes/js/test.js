// pipes/js/test.js - headless tests for the generator and the rules. No DOM, no browser.
//
//   node pipes/js/test.js
//
// THE ASSERTION THAT MATTERS is "every generated board is solvable", run over every tier and many
// seeds. Solvability is guaranteed by construction (generator.js lays the board out solved and then
// scrambles it), so a failure here means the CONSTRUCTION broke - which is exactly the bug that
// would otherwise reach a player as a level they cannot finish.
//
// It is checked two ways on purpose:
//   1. restore each cell to its constructed rotation and assert isSolved() accepts it - this proves
//      the win rule and the generator agree about what "solved" means;
//   2. run an independent BFS solver over the scrambled board that knows nothing about the stored
//      solution, and assert it finds one - this proves a solution exists without taking the
//      generator's word for it.
// Only (1) would let a generator and a win check be wrong together and still pass.
import {
  generate, rotate, kindOf, popcount, turnsBetween, tierConfig, TIER_ORDER,
  DIRS, DX, DY, OPPOSITE, N, E, S, W,
} from './generator.js';
import { PipesGame } from './game.js';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}

// --- 1. the mask representation -------------------------------------------------------------------

ok('four rotations return the original mask',
  [0, N, N | S, N | E, N | E | S, 15].every((m) => rotate(rotate(rotate(rotate(m)))) === m));
ok('rotation preserves the piece kind',
  [N, N | S, N | E, N | E | S, 15].every((m) => kindOf(m) === kindOf(rotate(m))));
ok('kinds are derived correctly',
  kindOf(0) === 'blank' && kindOf(N) === 'cap' && kindOf(N | S) === 'straight'
  && kindOf(N | E) === 'elbow' && kindOf(N | E | S) === 'tee' && kindOf(15) === 'cross');
ok('a straight rotates onto itself in two turns', turnsBetween(N | S, E | W) === 1);
ok('turnsBetween refuses two different pieces', turnsBetween(N | S, N | E) === -1);
ok('opposite directions are mutual',
  DIRS.every((d) => OPPOSITE[OPPOSITE[d]] === d));
ok('direction offsets and opposites agree',
  DIRS.every((d) => DX[d] === -DX[OPPOSITE[d]] && DY[d] === -DY[OPPOSITE[d]]));

// --- 2. an independent solver ----------------------------------------------------------------------

/**
 * Find a solution using ONLY the scrambled board - never `board.solution`.
 *
 * ITS FIRST DRAFT WAS WRONG IN AN INSTRUCTIVE WAY: it required every cell on the board to agree
 * with every neighbour, which is the FULL NET rule (variant c), not the one this game uses. Under
 * "path with no leaks" a dry decoy in a corner may point at nothing at all, so that solver rejected
 * boards that are perfectly solvable and reported 0/12 on a generator that was fine. The lesson is
 * the one worth keeping: a checker that is stricter than the rule is not a stricter checker, it is
 * a broken one.
 *
 * So it searches what the rule actually asks for:
 *   1. a simple path from inlet to outlet whose every cell can be ROTATED to open exactly toward
 *      its path neighbours (one opening at each end, two in between - a cap, straight or elbow);
 *   2. every cell OFF that path rotated so no opening faces the path, so nothing leaks out of the
 *      water's network. Dry cells may point wherever they like.
 * Rotation sets come from the board in front of it, so it can prove a solution exists without
 * being told one.
 */
function solve(board) {
  const { w, h } = board;
  const n = w * h;
  const rots = [];
  for (let i = 0; i < n; i++) {
    const set = new Set();
    let m = board.cells[i];
    for (let r = 0; r < 4; r++) { set.add(m); m = rotate(m); }
    rots.push(set);
  }
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const onPath = new Uint8Array(n);
  const chosen = new Array(n).fill(null);
  let steps = 0;
  const MAX = 300000;

  // Can every off-path cell be turned so nothing faces the water?
  function decoysFit() {
    for (let i = 0; i < n; i++) {
      if (onPath[i]) continue;
      const x = i % w, y = (i / w) | 0;
      let forbidden = 0;
      for (const d of DIRS) {
        const nx = x + DX[d], ny = y + DY[d];
        if (inBounds(nx, ny) && onPath[ny * w + nx]) forbidden |= d;
      }
      let fits = false;
      for (const m of rots[i]) if ((m & forbidden) === 0) { chosen[i] = m; fits = true; break; }
      if (!fits) return false;
    }
    return true;
  }

  function walk(i, cameFrom) {
    if (++steps > MAX) return false;
    const x = i % w, y = (i / w) | 0;
    if (i === board.dst) {
      const need = cameFrom;                       // the outlet is a cap facing back up the path
      if (!rots[i].has(need)) return false;
      chosen[i] = need;
      return decoysFit();
    }
    for (const d of DIRS) {
      const nx = x + DX[d], ny = y + DY[d];
      if (!inBounds(nx, ny)) continue;
      const ni = ny * w + nx;
      if (onPath[ni]) continue;
      const need = cameFrom | d;                   // exactly: back the way we came, plus onward
      if (!rots[i].has(need)) continue;
      chosen[i] = need;
      onPath[ni] = 1;
      if (walk(ni, OPPOSITE[d])) return true;
      onPath[ni] = 0;
    }
    chosen[i] = null;
    return false;
  }

  onPath[board.src] = 1;
  const sx = board.src % w, sy = (board.src / w) | 0;
  for (const d of DIRS) {                          // the inlet is a cap; try each way it can point
    const nx = sx + DX[d], ny = sy + DY[d];
    if (!inBounds(nx, ny)) continue;
    if (!rots[board.src].has(d)) continue;
    chosen[board.src] = d;
    const ni = ny * w + nx;
    onPath[ni] = 1;
    if (walk(ni, OPPOSITE[d])) return chosen;
    onPath[ni] = 0;
  }
  return null;
}

// --- 3. generation, every tier, many seeds ---------------------------------------------------------

const SEEDS = 40;
for (const tier of TIER_ORDER) {
  const cfg = tierConfig(tier);
  let solvableByConstruction = 0, alreadySolved = 0, tooEasy = 0, prePlacedWorst = 0;
  let capsOnEdge = 0, badPieces = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const b = generate(tier, s * 2654435761);

    // (1) the constructed solution really is a solution
    const g = new PipesGame({ board: { ...b, cells: Uint8Array.from(b.solution) } });
    if (g.isSolved()) solvableByConstruction++;

    // no board arrives solved, and none is a couple of taps from done
    const live = new PipesGame({ board: b });
    if (live.isSolved()) alreadySolved++;
    if (b.turns < 6) tooEasy++;

    let pre = 0, pieces = 0;
    for (let i = 0; i < b.cells.length; i++) {
      if (popcount(b.solution[i]) === 0) continue;
      if (kindOf(b.solution[i]) === 'cross') continue;
      pieces++;
      if (b.cells[i] === b.solution[i]) pre++;
    }
    prePlacedWorst = Math.max(prePlacedWorst, pre / Math.max(1, pieces));

    // inlet and outlet are caps on an edge
    const edge = (i) => { const x = i % b.w, y = (i / b.w) | 0; return x === 0 || y === 0 || x === b.w - 1 || y === b.h - 1; };
    if (edge(b.src) && edge(b.dst) && popcount(b.solution[b.src]) === 1 && popcount(b.solution[b.dst]) === 1) capsOnEdge++;

    // only pieces the tier allows
    for (const m of b.solution) {
      const k = kindOf(m);
      if (k === 'blank' || k === 'cap') continue;
      if (!cfg.pieces.includes(k)) badPieces++;
    }
  }
  ok(`[${tier}] every board's constructed solution passes isSolved()`,
    solvableByConstruction === SEEDS, `${solvableByConstruction}/${SEEDS}`);
  ok(`[${tier}] no board arrives already solved`, alreadySolved === 0, `${alreadySolved} were`);
  ok(`[${tier}] no board is under 6 turns from solved`, tooEasy === 0, `${tooEasy} were`);
  ok(`[${tier}] at most 12% of pieces start correct`, prePlacedWorst <= 0.12,
    `worst board ${(prePlacedWorst * 100).toFixed(1)}%`);
  ok(`[${tier}] inlet and outlet are caps on an edge`, capsOnEdge === SEEDS, `${capsOnEdge}/${SEEDS}`);
  ok(`[${tier}] only pieces this tier allows`, badPieces === 0, `${badPieces} stray pieces`);
}

// (2) the independent solver, on the smaller tiers where an exhaustive search is quick
for (const tier of ['easy', 'medium']) {
  let solved = 0;
  const tries = 12;
  for (let s = 1; s <= tries; s++) {
    const b = generate(tier, s * 40503);
    if (solve(b)) solved++;
  }
  ok(`[${tier}] an INDEPENDENT solver finds a solution without seeing the generator's`,
    solved === tries, `${solved}/${tries}`);
}

// --- 4. the rules ------------------------------------------------------------------------------------

{
  const b = generate('easy', 12345);
  const g = new PipesGame({ board: b });

  ok('a turn is counted', (() => { const before = g.moves; g.turn(g.src); return g.moves === before + 1; })());
  ok('four turns of one cell return it to where it started', (() => {
    const i = g.src; const m0 = g.cells[i];
    g.turn(i); g.turn(i); g.turn(i); g.turn(i);
    return g.cells[i] === m0;
  })());

  const blank = g.cells.findIndex((m) => popcount(m) === 0);
  if (blank >= 0) ok('a blank cell refuses to turn', g.turn(blank) === false);
  else ok('a blank cell refuses to turn (no blank on this board)', true);

  // The leak rule, built by hand so it cannot pass by accident.
  const solvedBoard = { ...b, cells: Uint8Array.from(b.solution) };
  const good = new PipesGame({ board: solvedBoard });
  ok('the intended solution is accepted', good.isSolved());
  ok('the flow order starts at the inlet and includes the outlet',
    good.flow().order[0] === good.src && good.flow().reached.has(good.dst));
  ok('a solved board reports no leaks', good.flow().leaks.length === 0);

  // Open one pipe on the water's path: the outlet is still reachable, but it now leaks.
  const leaky = new PipesGame({ board: solvedBoard });
  const path = leaky.flow().order;
  const mid = path[Math.floor(path.length / 2)];
  let broke = false;
  for (const d of DIRS) {
    if (leaky.cells[mid] & d) continue;
    const [x, y] = leaky.xy(mid);
    const nx = x + DX[d], ny = y + DY[d];
    const off = nx < 0 || ny < 0 || nx >= leaky.w || ny >= leaky.h;
    if (!off && (leaky.cells[leaky.index(nx, ny)] & OPPOSITE[d])) continue;
    leaky.cells[mid] |= d;                       // an opening that leads nowhere
    broke = true;
    break;
  }
  ok('a pipe opened onto nothing is a leak, and a leaking board is NOT solved',
    !broke || (leaky.flow().reached.has(leaky.dst) && !leaky.isSolved()));

  // A dry decoy with an open end is not a leak - only the water's own network is checked.
  const dry = new PipesGame({ board: solvedBoard });
  const reached = dry.flow().reached;
  const off = dry.cells.findIndex((m, i) => popcount(m) > 0 && !reached.has(i));
  if (off >= 0) {
    dry.cells[off] = rotate(dry.cells[off]);
    ok('an open end on a DRY pipe is not a leak', dry.isSolved());
  } else ok('an open end on a DRY pipe is not a leak (no dry pipe on this board)', true);

  ok('checkSolved stamps once', (() => {
    const g2 = new PipesGame({ board: solvedBoard });
    return g2.checkSolved(100) === true && g2.checkSolved(200) === false && g2.solvedAt === 100;
  })());
  ok('a solved board refuses further turns', (() => {
    const g2 = new PipesGame({ board: solvedBoard });
    g2.checkSolved(1);
    return g2.turn(g2.src) === false;
  })());
}

// --- 5. the save round-trip ---------------------------------------------------------------------------

{
  const g = new PipesGame({ tier: 'medium', seed: 777 });
  g.turn(0); g.turn(1);
  const back = PipesGame.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  ok('a saved board restores identically',
    back && back.w === g.w && back.h === g.h && back.moves === g.moves
    && back.src === g.src && back.dst === g.dst
    && Array.from(back.cells).join() === Array.from(g.cells).join());
  ok('a corrupt save returns null instead of throwing',
    PipesGame.fromJSON(null) === null
    && PipesGame.fromJSON({ v: 1, w: 3, h: 3, cells: [1, 2] }) === null
    && PipesGame.fromJSON({ v: 9 }) === null);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) { console.log(fail + ' FAILURE(S)'); process.exit(1); }
console.log('ALL PASS');
