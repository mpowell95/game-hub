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
 * THE RULE IS NOW FULL NET (2026-08-31): every pipe on the board must end up on one connected,
 * leak-free network. So this is a constraint search, not a path walk - assign each cell one of its
 * four rotations such that every shared edge agrees (both sides open, or both closed) and no
 * opening points off the board, then confirm the result is CONNECTED.
 *
 * THE HISTORY IS WORTH KEEPING, because this file has now been wrong in both directions. Its very
 * first draft did exactly this - demanded that every cell agree with every neighbour - and was
 * rejected as "the FULL NET rule, not this game's". It was then rewritten to walk a single path,
 * and later still had to stop deciding for itself what solved means and defer to `isSolved()`.
 * That last change is the one that survived the rule flip: the search below proposes, and the GAME
 * decides. A checker that holds its own opinion about the rule has to be rewritten every time the
 * rule moves; one that asks the game does not.
 */
function solve(board) {
  const { w, h } = board;
  const n = w * h;
  const rots = [];
  for (let i = 0; i < n; i++) {
    const set = [];
    let m = board.cells[i];
    for (let r = 0; r < 4; r++) { if (!set.includes(m)) set.push(m); m = rotate(m); }
    rots.push(set);
  }
  const chosen = new Array(n).fill(-1);
  let steps = 0;
  const MAX = 2000000;

  // Row-major assignment: when a cell is placed only its LEFT and UP neighbours are already fixed,
  // so those are the only two edges that can conflict. The right and bottom edges are checked when
  // those cells are reached; the board's own right and bottom borders are checked here.
  function place(i) {
    if (++steps > MAX) return false;
    if (i === n) {
      const g = new PipesGame({ board: { ...board, cells: Uint8Array.from(chosen) } });
      return g.isSolved();
    }
    const x = i % w, y = (i / w) | 0;
    for (const m of rots[i]) {
      if (y === 0 && (m & N)) continue;
      if (x === 0 && (m & W)) continue;
      if (x === w - 1 && (m & E)) continue;
      if (y === h - 1 && (m & S)) continue;
      if (x > 0 && (!!(m & W) !== !!(chosen[i - 1] & E))) continue;
      if (y > 0 && (!!(m & N) !== !!(chosen[i - w] & S))) continue;
      chosen[i] = m;
      if (place(i + 1)) return true;
    }
    chosen[i] = -1;
    return false;
  }
  return place(0) ? chosen : null;
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

    // Inlet and outlet are CAPS - single-opening cells, which is what draws as a bulb - and they
    // are two DIFFERENT cells. They are no longer required to sit on the board's edge: they are
    // leaves of the spanning tree and a leaf can be anywhere, which is also true of the reference
    // (its source bulb sits in the interior of the level in Matt's recording).
    if (b.src !== b.dst && popcount(b.solution[b.src]) === 1 && popcount(b.solution[b.dst]) === 1) capsOnEdge++;

    // only pieces the tier allows
    for (const m of b.solution) {
      const k = kindOf(m);
      // Every cell is on the network now, so a BLANK is a bug: it would be a hole in the field.
      if (k === 'blank') badPieces++;
    }
  }
  ok(`[${tier}] every board's constructed solution passes isSolved()`,
    solvableByConstruction === SEEDS, `${solvableByConstruction}/${SEEDS}`);
  ok(`[${tier}] no board arrives already solved`, alreadySolved === 0, `${alreadySolved} were`);
  ok(`[${tier}] no board is under 6 turns from solved`, tooEasy === 0, `${tooEasy} were`);
  ok(`[${tier}] at most 12% of pieces start correct`, prePlacedWorst <= 0.12,
    `worst board ${(prePlacedWorst * 100).toFixed(1)}%`);
  ok(`[${tier}] inlet and outlet are two different caps`, capsOnEdge === SEEDS, `${capsOnEdge}/${SEEDS}`);
  ok(`[${tier}] no blank cells - every cell is on the network`, badPieces === 0, `${badPieces} blanks`);
}

// (2) the independent solver, on the smaller tiers where an exhaustive search is quick
for (const tier of ['easy', 'medium']) {
  let solved = 0;
  const tries = 12;
  for (let s = 1; s <= tries; s++) {
    const b = generate(tier, s * 40503);
    const found = solve(b);
    // Verified against the real rule a second time, out here, so the assertion says what it means:
    // the solver did not merely terminate, it produced a board the GAME calls solved.
    if (found && new PipesGame({ board: { ...b, cells: Uint8Array.from(found) } }).isSolved()) solved++;
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

  // Boards have no blanks any more, so this exercises the guard directly rather than hunting one.
  {
    const probe = new PipesGame({ board: { ...g.toJSON(), cells: Uint8Array.from(g.cells) } });
    probe.cells[0] = 0;
    ok('a blank cell refuses to turn', probe.turn(0) === false);
  }

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
