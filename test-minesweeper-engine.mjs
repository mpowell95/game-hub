// test-minesweeper-engine.mjs - headless tests for minesweeper/js/engine.js, the pure Minesweeper
// rules (no DOM, no timers, no localStorage, no imports of its own).
//
// Run: node test-minesweeper-engine.mjs   (no deps, no browser)
//
// What this covers: mine placement and the derived `num` grid (recomputed independently here,
// never trusting the engine's own arithmetic back at itself), the safe-cell guarantee and the
// best-effort "first tap opens an area" behavior, iterative flood fill (contiguous, stops at
// numbers, never opens a flag), chord's match/no-match/misplaced-flag-kills-you cases, isWon,
// revealAll, minesLeft/clearedPct/correctFlags, and deserialize()'s never-throws contract against
// a table of garbage inputs plus a full round trip through serialize().
//
// What this deliberately does NOT cover: minesweeper/js/ui.js does not exist yet (this session
// only builds the engine); nothing here touches a DOM, a real localStorage, or a timer, since the
// engine touches none of those either. `elapsedMs` is UI-owned and only exercised as an opaque
// passthrough value across a save/load round trip, never as a clock.
//
// A small seeded PRNG (mulberry32) makes every "many seeded runs" loop below deterministic, so a
// failure is reproducible from the printed seed rather than a one-off flake.

import * as E from './minesweeper/js/engine.js';

let passed = 0;
const failures = [];
function ok(label, cond, extra) {
  if (cond) { passed++; console.log(`ok    ${label}`); return; }
  failures.push(label);
  console.log(`FAIL  ${label}${extra ? `\n        ${extra}` : ''}`);
}
const eq = (label, actual, expected) =>
  ok(label, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ---- mulberry32: tiny seeded PRNG, () => [0,1) ---------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- an independent num-grid recompute, so the test never trusts the engine's own arithmetic
// back at itself ------------------------------------------------------------------------------
function recomputeNum(w, h, mine) {
  const num = new Array(w * h).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mine[i]) { num[i] = -1; continue; }
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && mine[ny * w + nx]) n++;
        }
      }
      num[i] = n;
    }
  }
  return num;
}

const LEVEL_IDS = Object.keys(E.LEVELS);

// =================================================================================================
console.log('--- createGame ---');
eq('unknown level falls back to medium', E.createGame('nonsense').level, 'medium');
for (const id of LEVEL_IDS) {
  const g = E.createGame(id);
  const L = E.LEVELS[id];
  ok(`${id}: w/h/mines copied from LEVELS`, g.w === L.w && g.h === L.h && g.mines === L.mines);
  ok(`${id}: mine/num/cell are plain Arrays, never typed arrays`,
    Array.isArray(g.mine) && Array.isArray(g.num) && Array.isArray(g.cell));
  ok(`${id}: fresh board is all-hidden, ungenerated, nothing counted yet`,
    !g.generated && !g.dead && !g.won && g.boom === -1 && g.opened === 0 && g.flags === 0 &&
    g.cell.every((c) => c === E.HIDDEN) && g.mine.every((m) => m === false) &&
    g.num.every((n) => n === 0));
}

// =================================================================================================
console.log('\n--- generate: mine count and num, recomputed independently, over many seeded runs ---');
const GEN_RUNS = 200;
for (const id of LEVEL_IDS) {
  const L = E.LEVELS[id];
  let mineCountFails = 0, numMismatches = 0, safeCellHadMineNearby = 0, zeroCount = 0;
  const coordRng = mulberry32(1000 + id.length); // deterministic but different per level
  for (let run = 0; run < GEN_RUNS; run++) {
    const g = E.createGame(id);
    const safeX = Math.floor(coordRng() * g.w);
    const safeY = Math.floor(coordRng() * g.h);
    const rnd = mulberry32(run * 97 + 13);
    E.generate(g, safeX, safeY, rnd);

    const placed = g.mine.filter(Boolean).length;
    if (placed !== L.mines) mineCountFails++;

    const expectedNum = recomputeNum(g.w, g.h, g.mine);
    if (JSON.stringify(expectedNum) !== JSON.stringify(g.num)) numMismatches++;

    // The hard guarantee: no mine anywhere in the 3x3 block centred on the safe cell.
    let blockHasMine = false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = safeX + dx, y = safeY + dy;
        if (E.inBounds(g, x, y) && g.mine[E.idx(g, x, y)]) blockHasMine = true;
      }
    }
    if (blockHasMine) safeCellHadMineNearby++;

    if (g.num[E.idx(g, safeX, safeY)] === 0) zeroCount++;
  }
  ok(`${id}: exactly ${L.mines} mines placed on every one of ${GEN_RUNS} seeded runs`, mineCountFails === 0,
    `${mineCountFails} of ${GEN_RUNS} runs had the wrong mine count`);
  ok(`${id}: num matches an independent recompute on every run`, numMismatches === 0,
    `${numMismatches} of ${GEN_RUNS} runs disagreed with the independent recompute`);
  ok(`${id}: first tap is never a mine and never even borders one (3x3 block), every run`,
    safeCellHadMineNearby === 0, `${safeCellHadMineNearby} of ${GEN_RUNS} runs had a mine in the safe block`);
  const rate = zeroCount / GEN_RUNS;
  console.log(`      measured: ${id} first-tap-opens-an-area rate = ${(rate * 100).toFixed(1)}% (${zeroCount}/${GEN_RUNS})`);
  // Best-effort by design (see engine.js's generate() comment) - assert a rate, not every run.
  // Measured: because the hard guarantee already forbids a mine anywhere in the safe cell's own
  // 3x3 block, and num[safeIdx] counts mines in exactly that block, the safe cell is a zero on
  // attempt 1 every time here - the 40-attempt retry exists for robustness (e.g. if the exclusion
  // zone were ever narrowed) rather than being exercised by this board size/mine-count regime.
  ok(`${id}: first tap opens an area on the large majority of runs (>= 95%)`, rate >= 0.95,
    `measured ${(rate * 100).toFixed(1)}%`);
}

// =================================================================================================
console.log('\n--- flood fill: contiguous, stops at numbers, never opens a flag ---');
// A hand-built 5x3 board with a single mine in the far corner (4,2), so the whole rest of the
// board is reachable from (0,0) through one connected zero region plus its numbered border.
function floodBoard() {
  const w = 5, h = 3, total = w * h;
  const mine = new Array(total).fill(false);
  mine[2 * w + 4] = true; // (4,2)
  return {
    level: 'easy', w, h, mines: 1,
    mine, num: recomputeNum(w, h, mine), cell: new Array(total).fill(E.HIDDEN),
    generated: true, dead: false, won: false, boom: -1, opened: 0, flags: 0, elapsedMs: 0,
  };
}
{
  const g = floodBoard();
  const mineIdx = E.idx(g, 4, 2);
  const { changed, hitMine } = E.openCell(g, 0, 0);
  ok('flood: does not hit the mine', !hitMine);
  ok('flood: opens every non-mine cell (14 of 15)', changed.length === 14);
  ok('flood: the mine itself stays hidden', g.cell[mineIdx] === E.HIDDEN);
  ok('flood: every non-mine cell is now OPEN', g.cell.every((c, i) => i === mineIdx || c === E.OPEN));
  ok('flood: the numbered border cells opened too (they just did not spread further)',
    g.cell[E.idx(g, 3, 1)] === E.OPEN && g.cell[E.idx(g, 4, 1)] === E.OPEN && g.cell[E.idx(g, 3, 2)] === E.OPEN);
}
{
  // Same board, but flag a cell inside the would-be zero region first: flood must skip it and
  // leave it flagged, never silently opening a flag out from under the player.
  const g = floodBoard();
  const flaggedIdx = E.idx(g, 2, 2);
  E.toggleFlag(g, 2, 2);
  const { changed } = E.openCell(g, 0, 0);
  ok('flood: a flagged cell is not opened', g.cell[flaggedIdx] === E.FLAGGED);
  ok('flood: the flagged cell is not in the changed list', !changed.includes(flaggedIdx));
  ok('flood: every OTHER non-mine cell still opened around the flag (13 of 14)', changed.length === 13);
}
{
  // Opening a FLAGGED or already-OPEN cell is a no-op.
  const g = floodBoard();
  E.toggleFlag(g, 0, 0);
  eq('opening a flagged cell is a no-op', E.openCell(g, 0, 0), { changed: [], hitMine: false });
  const g2 = floodBoard();
  E.openCell(g2, 1, 1);
  const before = g2.cell.slice();
  eq('opening an already-open cell is a no-op', E.openCell(g2, 1, 1), { changed: [], hitMine: false });
  eq('...and nothing about the board changed', g2.cell, before);
}

// =================================================================================================
console.log('\n--- chord ---');
// A 3x3 board, mines at the two top corners. The center cell (1,1) has num=2 (both top corners
// are its neighbours). Built fully HIDDEN, then the center is opened by hand to simulate an
// already-revealed numbered cell, which is the only state chord ever fires from.
function chordBoard() {
  const w = 3, h = 3, total = 9;
  const mine = new Array(total).fill(false);
  mine[E_idx(w, 0, 0)] = true;
  mine[E_idx(w, 2, 0)] = true;
  const g = {
    level: 'easy', w, h, mines: 2,
    mine, num: recomputeNum(w, h, mine), cell: new Array(total).fill(E.HIDDEN),
    generated: true, dead: false, won: false, boom: -1, opened: 0, flags: 0, elapsedMs: 0,
  };
  g.cell[E_idx(w, 1, 1)] = E.OPEN;
  g.opened = 1;
  return g;
}
function E_idx(w, x, y) { return y * w + x; }

{
  const g = chordBoard();
  ok('setup: center cell has num 2 (both corner mines are its neighbours)', g.num[E_idx(3, 1, 1)] === 2);
}
{
  // Flag count too low: no-op.
  const g = chordBoard();
  E.toggleFlag(g, 0, 0); // only one of the two mines flagged
  const before = g.cell.slice();
  const { changed, hitMine } = E.chord(g, 1, 1);
  ok('chord: does nothing when the flag count is below the number', changed.length === 0 && !hitMine);
  eq('chord: board unchanged when it declines to fire', g.cell, before);
}
{
  // Flag count matches, both flags on the actual mines: chord opens every other neighbour safely
  // and (since this 3x3 board has only 7 non-mine cells and the center was already open) wins.
  const g = chordBoard();
  E.toggleFlag(g, 0, 0);
  E.toggleFlag(g, 2, 0);
  const { changed, hitMine } = E.chord(g, 1, 1);
  ok('chord: fires and opens the rest when the flag count matches', changed.length === 6 && !hitMine);
  ok('chord: both correctly-flagged mines are left alone (still flagged, not opened)',
    g.cell[E_idx(3, 0, 0)] === E.FLAGGED && g.cell[E_idx(3, 2, 0)] === E.FLAGGED);
  ok('chord: opening the last 6 safe cells completes the board', E.isWon(g) && g.won === true);
  eq('chord: correctFlags counts both', E.correctFlags(g), 2);
  eq('chord: minesLeft is 0', E.minesLeft(g), 0);
}
{
  // The case players actually hit: flag count matches the number, but the flags are on the WRONG
  // (safe) cells. Chord opens the real, unflagged mines right along with everything else.
  const g = chordBoard();
  E.toggleFlag(g, 1, 0); // safe cell, wrongly flagged
  E.toggleFlag(g, 0, 1); // safe cell, wrongly flagged
  const { changed, hitMine } = E.chord(g, 1, 1);
  ok('chord: a misplaced flag still satisfies the count, and chord opens the real mines', hitMine);
  ok('chord: changed includes both real mines', changed.includes(E_idx(3, 0, 0)) && changed.includes(E_idx(3, 2, 0)));
  ok('chord: the board is now dead', g.dead === true);
  eq('chord: boom is the FIRST mine opened (top-left, first in neighbour scan order)', g.boom, E_idx(3, 0, 0));
  ok('chord: the wrongly-flagged safe cells are untouched (still flagged, still wrong)',
    g.cell[E_idx(3, 1, 0)] === E.FLAGGED && g.cell[E_idx(3, 0, 1)] === E.FLAGGED);
  ok('chord: a dead board never counts as won', g.won === false);
}
{
  // num <= 0 (a zero or, degenerate, a mine) never fires.
  const g = chordBoard();
  eq('chord on a cell that is not OPEN is a no-op', E.chord(g, 0, 2), { changed: [], hitMine: false });
}

// =================================================================================================
console.log('\n--- isWon ---');
function winBoard() {
  // 2x2, 1 mine at (1,1). Non-mine cells: (0,0),(1,0),(0,1) - 3 of them.
  const w = 2, h = 2, total = 4;
  const mine = [false, false, false, true];
  return {
    level: 'easy', w, h, mines: 1,
    mine, num: recomputeNum(w, h, mine), cell: new Array(total).fill(E.HIDDEN),
    generated: true, dead: false, won: false, boom: -1, opened: 0, flags: 0, elapsedMs: 0,
  };
}
{
  const g = winBoard();
  g.cell[E_idx(2, 0, 0)] = E.OPEN;
  g.cell[E_idx(2, 1, 0)] = E.OPEN;
  ok('isWon: false one cell short', E.isWon(g) === false);
  g.cell[E_idx(2, 0, 1)] = E.OPEN;
  ok('isWon: true once every non-mine cell is open', E.isWon(g) === true);
}
{
  const g = winBoard();
  g.cell[E_idx(2, 0, 0)] = E.OPEN;
  g.cell[E_idx(2, 1, 0)] = E.OPEN;
  g.cell[E_idx(2, 0, 1)] = E.FLAGGED; // flagged, not opened
  ok('isWon: flagging a non-mine cell does not count as opening it', E.isWon(g) === false);
}
{
  const g = winBoard();
  g.cell[E_idx(2, 0, 0)] = E.OPEN;
  g.cell[E_idx(2, 1, 0)] = E.OPEN;
  g.cell[E_idx(2, 0, 1)] = E.OPEN;
  E.toggleFlag(g, 1, 1); // flag the mine itself
  ok('isWon: flagging the mine is irrelevant, still won', E.isWon(g) === true);
}

// =================================================================================================
console.log('\n--- revealAll ---');
{
  const g = winBoard();
  E.toggleFlag(g, 1, 1); // correctly flagged mine
  E.toggleFlag(g, 0, 1); // wrongly flagged safe cell
  E.revealAll(g);
  ok('revealAll: a correctly-flagged mine stays flagged (not converted to OPEN)', g.cell[E_idx(2, 1, 1)] === E.FLAGGED);
  ok('revealAll: a wrongly-flagged safe cell stays flagged too (UI strikes it through)', g.cell[E_idx(2, 0, 1)] === E.FLAGGED);
}
{
  const g = winBoard();
  E.revealAll(g);
  ok('revealAll: with no flags at all, the mine gets opened', g.cell[E_idx(2, 1, 1)] === E.OPEN);
}

// =================================================================================================
console.log('\n--- minesLeft / clearedPct / correctFlags ---');
{
  const g = winBoard(); // 1 mine, 3 safe cells
  eq('minesLeft: fresh board', E.minesLeft(g), 1);
  E.toggleFlag(g, 0, 0);
  E.toggleFlag(g, 1, 0);
  eq('minesLeft: can go negative (over-flagging)', E.minesLeft(g), -1);
  eq('clearedPct: 0 on a fresh, unopened board', E.clearedPct(winBoard()), 0);
  const won = winBoard();
  won.cell[E_idx(2, 0, 0)] = E.OPEN;
  won.cell[E_idx(2, 1, 0)] = E.OPEN;
  won.cell[E_idx(2, 0, 1)] = E.OPEN;
  won.opened = 3;
  eq('clearedPct: 100 on a won board', E.clearedPct(won), 100);
  eq('correctFlags: counts only flags actually on a mine', E.correctFlags(g), 0); // both flags here are on safe cells
}

// =================================================================================================
console.log('\n--- deserialize: never throws, garbage in -> null ---');
const GARBAGE = [
  ['undefined', undefined],
  ['null', null],
  ['empty object', {}],
  ['a string', 'not a save'],
  ['a number', 42],
  ['an array', [1, 2, 3]],
  ['right keys, wrong array lengths', { level: 'easy', w: 8, h: 10, mines: 10,
    mine: new Array(5).fill(false), num: new Array(5).fill(0), cell: new Array(5).fill(E.HIDDEN),
    generated: true, dead: false, won: false, boom: -1, opened: 0, flags: 0, elapsedMs: 0 }],
  ['unknown level', { level: 'nightmare', w: 8, h: 10, mines: 10,
    mine: new Array(80).fill(false), num: new Array(80).fill(0), cell: new Array(80).fill(E.HIDDEN),
    generated: true, dead: false, won: false, boom: -1, opened: 0, flags: 0, elapsedMs: 0 }],
];
for (const [label, input] of GARBAGE) {
  let threw = false, result;
  try { result = E.deserialize(input); } catch { threw = true; }
  ok(`deserialize(${label}) never throws`, !threw);
  if (!threw) ok(`deserialize(${label}) returns null`, result === null);
}

// =================================================================================================
console.log('\n--- round trip: deserialize(serialize(state)) reproduces an identical state ---');
{
  const g = E.createGame('hard');
  E.generate(g, 6, 8, mulberry32(42));
  // Simulate a mid-game board: some cells open, some flagged, some still hidden.
  E.openCell(g, 6, 8);
  E.toggleFlag(g, 0, 0);
  E.toggleFlag(g, g.w - 1, 0);
  g.elapsedMs = 12345;
  const roundTripped = E.deserialize(E.serialize(g));
  ok('round trip: not null', roundTripped !== null);
  eq('round trip: identical state, mid-game (open cells, flags, generated=true)', roundTripped, g);
}
{
  // Also round-trip a completely fresh, ungenerated board.
  const g = E.createGame('easy');
  const roundTripped = E.deserialize(E.serialize(g));
  eq('round trip: identical state, fresh/ungenerated', roundTripped, g);
}

// =================================================================================================
console.log(failures.length ? `\n${failures.length} FAILURE(S):` : `\nALL PASS (${passed} assertions)`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); }
process.exit(failures.length ? 1 : 0);
