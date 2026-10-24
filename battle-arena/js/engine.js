// battle-arena/js/engine.js - THE RULES. Pure, no DOM, no clock, no Math.random.
//
// A whole match is ONE plain JSON object (newMatch), and every move is a pure function:
//   apply(state, move) -> { ok, state, events, error? }
// The input state is never mutated (apply clones). The random number generator's state lives IN
// the match (`rng`, mulberry32), so the same seed and the same moves always give the same match:
// phase 2 (live rooms, turn-by-turn challenges) replays moves on every phone and gets one board.
//
// Moves: { type: 'swap', a, b } (two orthogonally adjacent cells; illegal = no match = refused,
// nothing changes) and { type: 'evolve', mon } (only while `pendingEvolve` is the mover's side).
// `events` is the ordered story of what happened, for the UI to animate (see the EVENTS list at
// the bottom of this file). Rules: docs/BATTLE-ARENA-SPEC.md; deviations in battle-arena/CLAUDE.md.
import {
  ELEMENTS, BY_ID, specialOf, BERRIES_TO_EVOLVE, EVOLVE_HP, TEAM_HP, BOMB_DAMAGE, MAX_BOMBS,
} from './monsters.js';

export const COLS = 7;
export const ROWS = 5;
export const N = COLS * ROWS;
export const MOVES_PER_TURN = 2;
export const BERRY_RATE = 0.04;
export const BOMB_RATE = 0.03;
const MAX_LOOPS = 40;            // cascade / special safety valve (never reached in the soak)
/** After each side's 20th turn, heals stop ("Sudden death"): two healing teams could otherwise
 *  out-heal each other for ever (the soak found one still going at 3000 moves). Our rule. */
export const SUDDEN_DEATH = 20;

export const idx = (r, c) => r * COLS + c;
export const rowOf = (i) => Math.floor(i / COLS);
export const colOf = (i) => i % COLS;
export const isGem = (t) => !!t && ELEMENTS.includes(t.k);
export function adjacent(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= N || b >= N) return false;
  const dr = Math.abs(rowOf(a) - rowOf(b)), dc = Math.abs(colOf(a) - colOf(b));
  return dr + dc === 1;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// --- seeded RNG (mulberry32), its state stored in the match ---------------------------------------
function rand(s) {
  let t = (s.rng = (s.rng + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];

function newTile(s, kind) {
  const t = { id: s.nextId++, k: kind };
  if (kind === 'bomb') t.n = 5 + (rand(s) < 0.5 ? 0 : 1);
  return t;
}
const bombCount = (board) => board.reduce((n, t) => n + (t && t.k === 'bomb' ? 1 : 0), 0);

/** A falling-in tile: ~4% Berry, ~3% Bomb (at most MAX_BOMBS on the board), the rest gems evenly. */
function spawnTile(s, bombsNow) {
  const r = rand(s);
  if (r < BERRY_RATE) return newTile(s, 'berry');
  if (r < BERRY_RATE + BOMB_RATE && bombsNow < MAX_BOMBS) return newTile(s, 'bomb');
  return newTile(s, pick(s, ELEMENTS));
}

// --- matching ----------------------------------------------------------------------------------
/** Every line of 3+ same-element gems: [{ cells, len, k }]. Berries and bombs never match. */
export function findRuns(board) {
  const runs = [];
  const scan = (cellAt, outer, inner) => {
    for (let o = 0; o < outer; o++) {
      let start = 0;
      for (let i = 1; i <= inner; i++) {
        const a = board[cellAt(o, start)], b = i < inner ? board[cellAt(o, i)] : null;
        if (i < inner && isGem(a) && isGem(b) && a.k === b.k) continue;
        if (i - start >= 3 && isGem(a)) {
          const cells = [];
          for (let j = start; j < i; j++) cells.push(cellAt(o, j));
          runs.push({ cells, len: cells.length, k: a.k });
        }
        start = i;
      }
    }
  };
  scan((r, c) => idx(r, c), ROWS, COLS);
  scan((c, r) => idx(r, c), COLS, ROWS);
  return runs;
}

function swapCells(board, a, b) { const t = board[a]; board[a] = board[b]; board[b] = t; }

/** Every legal swap [{ a, b }] (right and down neighbours, so each pair once). */
export function legalMoves(state) {
  const board = state.board.slice();
  const out = [];
  for (let i = 0; i < N; i++) {
    for (const j of [colOf(i) < COLS - 1 ? i + 1 : -1, rowOf(i) < ROWS - 1 ? i + COLS : -1]) {
      if (j < 0) continue;
      const x = board[i], y = board[j];
      if (x.k === y.k) continue;              // swapping two alike changes nothing
      swapCells(board, i, j);
      if (findRuns(board).length) out.push({ a: i, b: j });
      swapCells(board, i, j);
    }
  }
  return out;
}

/** The cells a set of matched cells takes with it: a berry orthogonally next to any matched gem;
 *  a bomb IN LINE with a match (just past either end of it); then every bomb's whole row and
 *  column (chaining into other bombs). `runs` null = no neighbours (a special, a bomb on its own). */
function expand(board, seed, runs) {
  const set = new Set(seed);
  const berryOrBomb = (j, kind) => j >= 0 && j < N && board[j] && board[j].k === kind;
  if (runs) {
    for (const i of seed) {
      for (const j of [i - COLS, i + COLS, colOf(i) > 0 ? i - 1 : -1, colOf(i) < COLS - 1 ? i + 1 : -1]) {
        if (berryOrBomb(j, 'berry')) set.add(j);
      }
    }
    for (const r of runs) {
      const first = r.cells[0], last = r.cells[r.cells.length - 1];
      const across = rowOf(first) === rowOf(last);
      const ends = across
        ? [colOf(first) > 0 ? first - 1 : -1, colOf(last) < COLS - 1 ? last + 1 : -1]
        : [first - COLS, last + COLS];
      for (const j of ends) if (berryOrBomb(j, 'bomb')) set.add(j);
    }
  }
  const blasts = [];
  const queue = [...set].filter((i) => board[i] && board[i].k === 'bomb');
  const done = new Set();
  while (queue.length) {
    const b = queue.shift();
    if (done.has(b)) continue;
    done.add(b);
    const cells = [];
    for (let c = 0; c < COLS; c++) cells.push(idx(rowOf(b), c));
    for (let r = 0; r < ROWS; r++) if (r !== rowOf(b)) cells.push(idx(r, colOf(b)));
    blasts.push({ at: b, cells });
    for (const j of cells) {
      set.add(j);
      if (board[j] && board[j].k === 'bomb' && !done.has(j)) queue.push(j);
    }
  }
  return { set, blasts };
}

/** What a swap would clear on its FIRST step (no refill, no cascade): for the computer's eye.
 *  null if the swap is not legal. */
export function previewSwap(state, a, b) {
  if (!adjacent(a, b)) return null;
  const board = state.board.slice();
  swapCells(board, a, b);
  const runs = findRuns(board);
  if (!runs.length) return null;
  const seed = new Set();
  for (const r of runs) for (const i of r.cells) seed.add(i);
  const { set, blasts } = expand(board, seed, runs);
  const counts = {};
  let berries = 0;
  const bombs = [];
  for (const i of set) {
    const t = board[i];
    if (isGem(t)) counts[t.k] = (counts[t.k] || 0) + 1;
    else if (t.k === 'berry') berries++;
    else if (t.k === 'bomb') bombs.push(t.n);
  }
  return { counts, berries, bombs, blasts: blasts.length, maxRun: Math.max(...runs.map((r) => r.len)), size: set.size };
}

// --- a new match ---------------------------------------------------------------------------------
/** teams: [[idA, idB], [idC, idD]] (side 0 = the player, side 1 = the computer / opponent).
 *  first: which side moves first. seed: any 32-bit integer. */
export function newMatch({ seed = 1, teams, first = 0, arena = 'boiler' }) {
  const s = {
    v: 1, arena, rng: (seed >>> 0) || 1, nextId: 1,
    board: [], turn: first === 1 ? 1 : 0, first: first === 1 ? 1 : 0,
    movesLeft: MOVES_PER_TURN, extraUsed: false, turnNo: 1, moveNo: 0,
    pendingEvolve: null, winner: null,
    sides: teams.map((ids) => {
      const mons = ids.map((id) => ({ id, evo: false, energy: 0, part: 0 }));
      return { mons, hp: TEAM_HP, maxHp: TEAM_HP, shield: 0, berries: 0, curse: { tick: 0, left: 0 }, frozen: false, turns: 0 };
    }),
  };
  s.sides[s.turn].turns = 1;
  fillFresh(s);
  return s;
}

/** A board of gems with no line already on it and at least one legal move; one berry somewhere. */
function fillFresh(s) {
  for (let tries = 0; tries < 100; tries++) {
    s.board = [];
    for (let i = 0; i < N; i++) {
      const r = rowOf(i), c = colOf(i);
      let k;
      for (let g = 0; g < 20; g++) {
        k = pick(s, ELEMENTS);
        const left = c >= 2 && s.board[i - 1].k === k && s.board[i - 2].k === k;
        const up = r >= 2 && s.board[i - COLS].k === k && s.board[i - 2 * COLS].k === k;
        if (!left && !up) break;
      }
      s.board.push(newTile(s, k));
    }
    const b = Math.floor(rand(s) * N);
    s.board[b] = newTile(s, 'berry');
    if (!findRuns(s.board).length && legalMoves(s).length) return;
  }
}

// --- the moving parts ----------------------------------------------------------------------------
function damage(s, ev, target, n, cause) {
  if (n <= 0 || s.winner != null) return;
  const side = s.sides[target];
  const absorbed = Math.min(side.shield, n);
  side.shield -= absorbed;
  const hit = n - absorbed;
  side.hp = Math.max(0, side.hp - hit);
  ev.push({ t: 'damage', side: target, n: hit, absorbed, hp: side.hp, shield: side.shield, cause });
  if (side.hp <= 0) {
    s.winner = 1 - target;
    ev.push({ t: 'win', side: s.winner });
  }
}

function heal(s, ev, target, n) {
  const side = s.sides[target];
  const before = side.hp;
  const blocked = s.turnNo > 2 * SUDDEN_DEATH;
  if (!blocked) side.hp = Math.min(side.maxHp, side.hp + n);
  ev.push({ t: 'heal', side: target, n: side.hp - before, capped: !blocked && side.hp - before < n, blocked, hp: side.hp });
}

function addEnergy(s, ev, side, mi, n, k) {
  const m = s.sides[side].mons[mi];
  const cost = BY_ID[m.id].cost;
  const before = m.energy;
  m.energy = Math.min(cost, m.energy + n);
  if (n > 0) ev.push({ t: 'energy', side, mon: mi, n, k, energy: m.energy, gained: m.energy - before });
}

/** Cleared element gems charge the mover's monsters of that element; Prismote (ALL) charges 1
 *  per 2 gems of any element, carrying the odd one. */
function charge(s, ev, side, counts) {
  s.sides[side].mons.forEach((m, mi) => {
    const el = BY_ID[m.id].el;
    if (el === 'all') {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (!total) return;
      m.part += total;
      const gain = Math.floor(m.part / 2);
      m.part %= 2;
      if (gain) addEnergy(s, ev, side, mi, gain, 'all');
    } else if (counts[el]) {
      addEnergy(s, ev, side, mi, counts[el], el);
    }
  });
}

/** Remove a set of cells. `side` null = nobody is charged (a bomb going off on its own). */
function collect(s, ev, side, set, cause) {
  const cells = [...set].filter((i) => s.board[i]).sort((a, b) => a - b);
  if (!cells.length) return;
  const counts = {};
  let berries = 0;
  for (const i of cells) {
    const t = s.board[i];
    if (isGem(t)) counts[t.k] = (counts[t.k] || 0) + 1;
    else if (t.k === 'berry') berries++;
  }
  ev.push({ t: 'clear', cells, ids: cells.map((i) => s.board[i].id), cause });
  for (const i of cells) s.board[i] = null;
  if (side == null) return;
  charge(s, ev, side, counts);
  const sd = s.sides[side];
  if (berries && sd.mons.some((m) => !m.evo)) {
    // Each monster evolves once; when both have, berries do nothing.
    sd.berries = Math.min(BERRIES_TO_EVOLVE, sd.berries + berries);
    ev.push({ t: 'berry', side, n: berries, berries: sd.berries });
  }
}

/** Tiles fall into the gaps; new ones fall in from above. */
function gravity(s, ev) {
  const moves = [], spawns = [];
  let bombs = bombCount(s.board);
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const t = s.board[idx(r, c)];
      if (!t) continue;
      if (write !== r) {
        s.board[idx(write, c)] = t;
        s.board[idx(r, c)] = null;
        moves.push({ id: t.id, from: idx(r, c), to: idx(write, c) });
      }
      write--;
    }
    const empty = write + 1;
    for (let r = write; r >= 0; r--) {
      const t = spawnTile(s, bombs);
      if (t.k === 'bomb') bombs++;
      s.board[idx(r, c)] = t;
      spawns.push({ id: t.id, k: t.k, n: t.n, to: idx(r, c), fromRow: r - empty });
    }
  }
  if (moves.length || spawns.length) ev.push({ t: 'fall', moves, spawns, board: s.board.map((t) => ({ ...t })) });
}

/** Clear lines until the board is still. `side` is charged (null: nobody). */
function settle(s, ev, side) {
  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const runs = findRuns(s.board);
    if (!runs.length) return;
    const seed = new Set();
    for (const r of runs) for (const i of r.cells) seed.add(i);
    if (side != null && side === s.turn && !s.extraUsed && runs.some((r) => r.len >= 4)) {
      s.extraUsed = true;
      s.movesLeft += 1;
      ev.push({ t: 'extra', side, moves: s.movesLeft });
    }
    const { set, blasts } = expand(s.board, seed, runs);
    for (const b of blasts) ev.push({ t: 'bomb', at: b.at, cells: b.cells });
    collect(s, ev, side, set, 'match');
    gravity(s, ev);
  }
}

/** Rows with the most Fire gems (ties: the lower row), for Scorch Row. */
function scorchRows(s, n) {
  const score = [];
  for (let r = 0; r < ROWS; r++) {
    let f = 0;
    for (let c = 0; c < COLS; c++) if (s.board[idx(r, c)].k === 'fire') f++;
    score.push({ r, f });
  }
  score.sort((a, b) => b.f - a.f || b.r - a.r);
  return score.slice(0, n).map((x) => x.r);
}

function fireSpecial(s, ev, side, mi) {
  const m = s.sides[side].mons[mi];
  const sp = specialOf(m.id, m.evo);
  const foe = 1 - side;
  m.energy = 0;
  ev.push({ t: 'special', side, mon: mi, id: m.id, evo: m.evo });
  if (sp.dmg) damage(s, ev, foe, sp.dmg, 'special');
  if (s.winner != null) return;
  if (sp.heal) heal(s, ev, side, sp.heal);
  if (sp.shield) {
    s.sides[side].shield += sp.shield;
    ev.push({ t: 'shield', side, n: sp.shield, shield: s.sides[side].shield });
  }
  if (sp.drain) {
    s.sides[foe].mons.forEach((fm, fi) => {
      const took = Math.min(fm.energy, sp.drain);
      fm.energy -= took;
      ev.push({ t: 'drain', side: foe, mon: fi, n: took, energy: fm.energy });
    });
  }
  if (sp.freeze) {
    s.sides[foe].frozen = true;
    ev.push({ t: 'freeze', side: foe });
  }
  if (sp.curse) {
    const c = s.sides[foe].curse;
    c.tick = sp.curse.tick;
    c.left = Math.max(c.left, sp.curse.turns);
    ev.push({ t: 'curse', side: foe, left: c.left, tick: c.tick });
  }
  if (sp.chain) {
    const other = 1 - mi;
    if (s.sides[side].mons[other]) addEnergy(s, ev, side, other, sp.chain, BY_ID[s.sides[side].mons[other].id].el);
  }
  if (sp.rows) {
    const rows = scorchRows(s, sp.rows);
    const cells = [];
    for (const r of rows) for (let c = 0; c < COLS; c++) cells.push(idx(r, c));
    const { set, blasts } = expand(s.board, cells, null);
    ev.push({ t: 'rows', side, rows });
    for (const b of blasts) ev.push({ t: 'bomb', at: b.at, cells: b.cells });
    collect(s, ev, side, set, 'special');
    gravity(s, ev);
  }
  if (sp.convert) {
    const cand = [];
    for (let i = 0; i < N; i++) if (isGem(s.board[i]) && s.board[i].k !== 'leaf') cand.push(i);
    const cells = [];
    for (let n = 0; n < sp.convert && cand.length; n++) {
      const j = Math.floor(rand(s) * cand.length);
      cells.push(cand.splice(j, 1)[0]);
    }
    for (const i of cells) s.board[i] = { id: s.board[i].id, k: 'leaf' };
    ev.push({ t: 'convert', side, cells, k: 'leaf', board: s.board.map((t) => ({ ...t })) });
  }
}

/** Full bars fire (in seat order), the board settles, repeat until nothing more fires. */
function firePending(s, ev, side) {
  for (let loop = 0; loop < MAX_LOOPS && s.winner == null; loop++) {
    let fired = false;
    s.sides[side].mons.forEach((m, mi) => {
      if (s.winner != null) return;
      if (m.energy >= BY_ID[m.id].cost) {
        fireSpecial(s, ev, side, mi);
        fired = true;
        if (s.winner == null) settle(s, ev, side);
      }
    });
    if (!fired) return;
  }
}

function evolve(s, ev, side, mi) {
  const sd = s.sides[side];
  sd.mons[mi].evo = true;
  sd.berries = 0;
  sd.hp = Math.min(sd.maxHp, sd.hp + EVOLVE_HP);
  ev.push({ t: 'evolve', side, mon: mi, id: sd.mons[mi].id, hp: sd.hp, maxHp: sd.maxHp });
}

/** Four berries: one monster left to evolve evolves at once; two = the mover chooses. */
function checkBerries(s, ev, side) {
  const sd = s.sides[side];
  if (sd.berries < BERRIES_TO_EVOLVE) return;
  const open = sd.mons.map((m, i) => (m.evo ? -1 : i)).filter((i) => i >= 0);
  if (!open.length) { sd.berries = 0; return; }
  if (open.length === 1) { evolve(s, ev, side, open[0]); return; }
  s.pendingEvolve = side;
  ev.push({ t: 'evolveReady', side });
}

/** No legal move left: the tiles are reshuffled (same tiles, new places) until there is one. */
function ensureMove(s, ev) {
  if (legalMoves(s).length) return;
  for (let tries = 0; tries < 60; tries++) {
    const tiles = s.board.slice();
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      const t = tiles[i]; tiles[i] = tiles[j]; tiles[j] = t;
    }
    s.board = tiles;
    if (!findRuns(s.board).length && legalMoves(s).length) {
      ev.push({ t: 'shuffle', board: s.board.map((t) => ({ ...t })) });
      return;
    }
  }
  // Practically unreachable: a fresh gem board.
  fillFresh(s);
  ev.push({ t: 'shuffle', board: s.board.map((t) => ({ ...t })) });
}

/** The end of a turn: bombs tick; one at 0 blows its row and column and hurts the side whose
 *  turn just ended. Then the other side's turn starts (a curse bites, a freeze takes a move). */
function endTurn(s, ev) {
  const ended = s.turn;
  const ticks = [];
  for (let i = 0; i < N; i++) {
    const t = s.board[i];
    if (t && t.k === 'bomb') { t.n -= 1; ticks.push({ id: t.id, at: i, n: t.n }); }
  }
  if (ticks.length) ev.push({ t: 'tick', bombs: ticks });
  const zero = ticks.filter((x) => x.n <= 0).map((x) => x.at);
  if (zero.length) {
    const { set, blasts } = expand(s.board, zero, null);
    for (const b of blasts) ev.push({ t: 'bomb', at: b.at, cells: b.cells, boom: zero.includes(b.at) });
    for (let k = 0; k < zero.length; k++) damage(s, ev, ended, BOMB_DAMAGE, 'bomb');
    collect(s, ev, null, set, 'boom');
    gravity(s, ev);
    settle(s, ev, null);
    if (s.winner != null) return;
  }
  const next = 1 - ended;
  const sd = s.sides[next];
  s.turn = next;
  s.movesLeft = sd.frozen ? 1 : MOVES_PER_TURN;
  const frozen = sd.frozen;
  sd.frozen = false;
  s.extraUsed = false;
  s.turnNo += 1;
  if (s.turnNo === 2 * SUDDEN_DEATH + 1) ev.push({ t: 'suddenDeath' });
  sd.turns += 1;
  ev.push({ t: 'turn', side: next, moves: s.movesLeft, frozen });
  if (sd.curse.left > 0) {
    sd.curse.left -= 1;
    ev.push({ t: 'curseTick', side: next, left: sd.curse.left });
    damage(s, ev, next, sd.curse.tick, 'curse');
  }
}

function afterMove(s, ev, side) {
  if (s.winner != null) return;
  checkBerries(s, ev, side);
  ensureMove(s, ev);
  if (s.pendingEvolve == null && s.movesLeft <= 0) {
    endTurn(s, ev);
    if (s.winner == null) ensureMove(s, ev);
  }
}

// --- the one entry point ---------------------------------------------------------------------------
export function apply(state, move) {
  const refuse = (error) => ({ ok: false, error, state, events: [] });
  if (!state || !move) return refuse('bad-move');
  if (state.winner != null) return refuse('over');
  if (move.side != null && move.side !== state.turn) return refuse('not-your-turn');
  const s = clone(state);
  const ev = [];
  const side = s.turn;

  if (move.type === 'evolve') {
    const mi = move.mon;
    if (s.pendingEvolve !== side) return refuse('no-evolve');
    const m = s.sides[side].mons[mi];
    if (!m || m.evo) return refuse('bad-mon');
    s.pendingEvolve = null;
    evolve(s, ev, side, mi);
    if (s.movesLeft <= 0) {
      endTurn(s, ev);
      if (s.winner == null) ensureMove(s, ev);
    }
    return { ok: true, state: s, events: ev };
  }

  if (move.type !== 'swap') return refuse('bad-move');
  if (s.pendingEvolve != null) return refuse('evolve-first');
  const { a, b } = move;
  if (!adjacent(a, b)) return refuse('not-adjacent');
  swapCells(s.board, a, b);
  if (!findRuns(s.board).length) return refuse('no-match');
  s.movesLeft -= 1;
  s.moveNo += 1;
  ev.push({ t: 'swap', side, a, b, ids: [s.board[b].id, s.board[a].id] });
  settle(s, ev, side);
  firePending(s, ev, side);
  afterMove(s, ev, side);
  return { ok: true, state: s, events: ev };
}

// EVENTS (in order of appearance; every one is plain JSON):
//   swap {side,a,b,ids}  clear {cells,ids,cause}  bomb {at,cells,boom?}  energy {side,mon,n,k,energy}
//   berry {side,n,berries}  extra {side,moves}  fall {moves,spawns,board}  special {side,mon,id,evo}
//   damage {side,n,absorbed,hp,shield,cause}  heal {side,n,capped,hp}  shield {side,n,shield}
//   drain {side,mon,n,energy}  freeze {side}  curse {side,left,tick}  rows {side,rows}
//   convert {side,cells,k,board}  evolveReady {side}  evolve {side,mon,id,hp,maxHp}
//   tick {bombs:[{id,at,n}]}  turn {side,moves,frozen}  curseTick {side,left}  shuffle {board}
//   win {side}
