// battle-arena/js/test.js - the rules, the computer, and an AI-vs-AI soak. Dev only, not in sw.js.
//   node battle-arena/js/test.js            rules + a 300-match soak
//   node battle-arena/js/test.js --soak=N   a different soak size
import {
  apply, newMatch, findRuns, legalMoves, adjacent, idx, COLS, ROWS,
} from './engine.js';
import { chooseMove, chooseTeam, LEVELS } from './cpu.js';
import { MONSTERS, BY_ID, unlockedIds, STARTERS } from './monsters.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };
const has = (ev, t, f = () => true) => ev.some((e) => e.t === t && f(e));
const count = (ev, t, f = () => true) => ev.filter((e) => e.t === t && f(e)).length;

const LETTER = { F: 'fire', W: 'water', S: 'spark', L: 'leaf', D: 'shadow', B: 'berry' };
/** A match with a hand-built board. Rows top to bottom; X1..X9 = a bomb with that countdown. */
function setup(teams, rows, opts = {}) {
  const s = newMatch({ seed: opts.seed || 7, teams, first: 0 });
  s.board = [];
  for (const row of rows) {
    const cells = row.match(/X\d|[FWSLDB]/g);
    if (cells.length !== COLS) throw new Error('bad row ' + row);
    for (const c of cells) {
      if (c[0] === 'X') s.board.push({ id: s.nextId++, k: 'bomb', n: Number(c[1]) });
      else s.board.push({ id: s.nextId++, k: LETTER[c] });
    }
  }
  if (rows.length !== ROWS) throw new Error('bad rows');
  return s;
}
const swap = (r1, c1, r2, c2) => ({ type: 'swap', a: idx(r1, c1), b: idx(r2, c2) });
const noRuns = (s) => findRuns(s.board).length === 0;

// A board with no lines: (r*2 + c) % 5 never repeats three in a row or column.
const BASE = ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDFWS', 'LDFWSLD'];
// Swapping (4,3)<->(4,4) makes fire at row 4 cols 1-3; the fall lines up water at row 3 cols 0-2.
const CASCADE = ['FWSLDFW', 'SLDFWSL', 'DWWSLDF', 'WSLDFWS', 'LFFSFLD'];
// Swapping (3,2)<->(4,2) makes FOUR fire at row 4 cols 0-3.
const FOUR = ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSFDFWS', 'FFSFDLD'];
// Swapping (4,3)<->(4,4) makes fire at row 4 cols 1-3 (three exactly), nothing else.
const THREE = ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDLWS', 'LFFSFLD'];
// Swapping (4,3)<->(4,4) makes leaf at row 4 cols 1-3.
const LEAF = ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDFWS', 'DLLSLFD'];

// Swapping (4,3)<->(4,4) makes three BERRIES at row 4 cols 1-3.
const BERRY3 = ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDFWS', 'LBBSBLD'];

const TEAM = [['emberkit', 'driplet'], ['zapup', 'sproutle']];

// --- the board -------------------------------------------------------------------------------------
{
  const s = setup(TEAM, BASE);
  ok('the base board has no lines', noRuns(s));
  ok('adjacent: right, down', adjacent(0, 1) && adjacent(0, COLS));
  ok('not adjacent: across a row end, diagonal, self, off board', !adjacent(COLS - 1, COLS) && !adjacent(0, COLS + 1) && !adjacent(3, 3) && !adjacent(-1, 0) && !adjacent(34, 35));
  const runs = findRuns(setup(TEAM, ['FFFLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDFWS', 'LDFWSLD']).board);
  ok('a row of three is a run', runs.length === 1 && runs[0].len === 3 && runs[0].k === 'fire');
  const v = findRuns(setup(TEAM, ['FWSLDFW', 'FLDFWSL', 'FFWSLDF', 'FSLDFWS', 'LDFWSLD']).board);
  ok('a column of four is one run of 4', v.length === 1 && v[0].len === 4);
  ok('three berries are a run', findRuns(setup(TEAM, ['BBBLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDFWS', 'LDFWSLD']).board).length === 1);
  ok('bombs never match', findRuns(setup(TEAM, ['X5X5X5LDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDFWS', 'LDFWSLD']).board).length === 0);
  ok('a fresh match has no lines and a legal move', [1, 2, 3, 99, 12345].every((seed) => {
    const m = newMatch({ seed, teams: TEAM });
    return noRuns(m) && legalMoves(m).length > 0 && m.board.length === COLS * ROWS;
  }));
}

// --- swaps -----------------------------------------------------------------------------------------
{
  const s = setup(TEAM, BASE);
  const before = JSON.stringify(s);
  const r = apply(s, swap(0, 0, 0, 1));
  ok('a swap that makes no line is refused', !r.ok && r.error === 'no-match');
  ok('a refused swap changes nothing', JSON.stringify(r.state) === before && JSON.stringify(s) === before);
  ok('a far swap is refused', apply(s, { type: 'swap', a: 0, b: 2 }).error === 'not-adjacent');
  ok('a wrong-side move is refused', apply(s, { ...swap(4, 3, 4, 4), side: 1 }).error === 'not-your-turn');
}
{
  const s = setup(TEAM, CASCADE);
  ok('cascade board starts clean', noRuns(s));
  const before = JSON.stringify(s);
  const r = apply(s, swap(4, 3, 4, 4));
  ok('apply never mutates its input', JSON.stringify(s) === before);
  ok('the swap is legal', r.ok && has(r.events, 'swap'));
  ok('the match and the cascade both clear', count(r.events, 'clear', (e) => e.cause === 'match') >= 2);
  ok('the board settles with no lines', noRuns(r.state));
  ok('fire charged Emberkit 3', r.state.sides[0].mons[0].energy >= 3);
  ok('water from the cascade charged Driplet', r.state.sides[0].mons[1].energy >= 3);
  ok('the other side is never charged', r.state.sides[1].mons.every((m) => m.energy === 0));
  ok('one move used, one left', r.state.movesLeft === 1 && r.state.turn === 0);
}

// --- charging, specials -----------------------------------------------------------------------------
{
  const s = setup(TEAM, THREE);
  const r = apply(s, swap(4, 3, 4, 4));
  ok('three fire = +3 to the fire monster only', r.state.sides[0].mons[0].energy === 3 && r.state.sides[0].mons[1].energy === 0);
  ok('the energy event names the element', has(r.events, 'energy', (e) => e.k === 'fire' && e.n === 3 && e.mon === 0));
}
{
  const s = setup(TEAM, THREE);
  s.sides[0].mons[0].energy = 6;                              // Emberkit costs 7
  const hp = s.sides[1].hp;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('a full bar fires on its own', has(r.events, 'special', (e) => e.side === 0 && e.mon === 0));
  ok('the special hits the other team (10)', r.state.sides[1].hp === hp - 10);
  ok('the bar resets, excess lost', r.state.sides[0].mons[0].energy < 7);
}
{
  const s = setup([['sproutle', 'driplet'], ['zapup', 'emberkit']], LEAF);
  ok('heal board clean', noRuns(s));
  s.sides[0].mons[0].energy = 5;                              // Sproutle costs 6
  s.sides[0].hp = s.sides[0].maxHp - 3;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('heal fires', has(r.events, 'special', (e) => e.id === 'sproutle'));
  ok('heal cannot pass max HP', r.state.sides[0].hp === r.state.sides[0].maxHp);
  ok('the heal event says it was capped', has(r.events, 'heal', (e) => e.capped && e.n === 3));
  ok('every team starts at 80, max 80', s.sides[0].maxHp === 80 && s.sides[1].hp === 80 && s.sides[1].maxHp === 80);
}
{
  // Shield: Pebbleop's Rock Toss shields; then the other side's Zapup hits through what is left.
  const SH = BY_ID.pebbleop.sp.shield, ZD = BY_ID.zapup.sp.dmg;
  const s = setup([['pebbleop', 'driplet'], ['zapup', 'sproutle']], THREE);
  s.sides[0].mons[0].energy = 7;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('Rock Toss shields', r.state.sides[0].shield === SH && has(r.events, 'shield'));
  const t = r.state;
  t.turn = 1; t.movesLeft = 2; t.extraUsed = false;
  t.board = setup(TEAM, ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDFWS', 'LSSFSLD']).board.map((x) => ({ ...x, id: x.id + 1000 }));
  // row 4: L S S F S -> swap (4,3)F<->(4,4)S: L S S S F
  t.sides[1].mons[0].energy = 3;                              // Zapup costs 4
  const hp = t.sides[0].hp;
  const r2 = apply(t, swap(4, 3, 4, 4));
  ok('the shield soaks first', r2.state.sides[0].hp === hp - Math.max(0, ZD - SH) && r2.state.sides[0].shield === 0);
  ok('the damage event shows what the shield took', has(r2.events, 'damage', (e) => e.side === 0 && e.absorbed === Math.min(SH, ZD) && e.n === Math.max(0, ZD - SH)));
}
{
  // Freeze: Frostling (water, 5).
  const s = setup([['frostling', 'emberkit'], ['zapup', 'sproutle']], ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDLWS', 'LWWSWLD']);
  ok('freeze board clean', noRuns(s));
  s.sides[0].mons[0].energy = 4;
  s.movesLeft = 1;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('Freeze fires', has(r.events, 'freeze', (e) => e.side === 1));
  ok('the frozen side gets 1 move', r.state.turn === 1 && r.state.movesLeft === 1 && has(r.events, 'turn', (e) => e.frozen));
}
{
  // Curse: Hexowl (shadow, 5): 5 now, then 5 at the start of each of their next 2 turns.
  const s = setup([['hexowl', 'emberkit'], ['zapup', 'sproutle']], ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDLWS', 'LDDSDLF']);
  ok('curse board clean', noRuns(s));
  s.sides[0].mons[0].energy = 4;
  s.movesLeft = 1;
  const hp = s.sides[1].hp;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('Curse: 5 now and 5 at the start of their turn', r.state.sides[1].hp === hp - 10 && r.state.sides[1].curse.left === 1);
  ok('the curse tick is an event', has(r.events, 'curseTick', (e) => e.side === 1));
}
{
  // Drain: Gloomite (shadow, 6) takes 2 energy from each enemy monster.
  const s = setup([['gloomite', 'emberkit'], ['zapup', 'sproutle']], ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDLWS', 'LDDSDLF']);
  s.sides[0].mons[0].energy = 5;
  s.sides[1].mons[0].energy = 3; s.sides[1].mons[1].energy = 1;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('Mind Bite drains 2 from each (never below 0)', r.state.sides[1].mons[0].energy === 1 && r.state.sides[1].mons[1].energy === 0);
}
{
  // Chain Bolt: Stormhorn (spark, 5) gives its partner 1.
  const s = setup([['stormhorn', 'emberkit'], ['zapup', 'sproutle']], ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDLWS', 'LSSDSLF']);
  ok('chain board clean', noRuns(s));
  s.sides[0].mons[0].energy = 4;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('Chain Bolt charges the other monster 1', r.state.sides[0].mons[1].energy >= 1 && has(r.events, 'energy', (e) => e.mon === 1 && e.n === 1));
}
{
  // Prismote: 1 energy per 2 gems of ANY element.
  const s = setup([['prismote', 'emberkit'], ['zapup', 'sproutle']], THREE);
  const r = apply(s, swap(4, 3, 4, 4));
  ok('Prismote charges at half rate (3 gems = 1, 1 carried)', r.state.sides[0].mons[0].energy === 1 && r.state.sides[0].mons[0].part === 1);
}
{
  // Scorch Row clears a row; Overgrowth turns gems into Leaf.
  const s = setup([['cinderwing', 'driplet'], ['zapup', 'sproutle']], THREE);
  s.sides[0].mons[0].energy = 7;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('Scorch Row clears a whole row', has(r.events, 'rows') && has(r.events, 'clear', (e) => e.cause === 'special' && e.cells.length >= COLS));
  const t = setup([['thornpaw', 'driplet'], ['zapup', 'sproutle']], LEAF);
  t.sides[0].mons[0].energy = 5;
  const r2 = apply(t, swap(4, 3, 4, 4));
  ok('Overgrowth turns gems into Leaf', has(r2.events, 'convert', (e) => e.cells.length === BY_ID.thornpaw.sp.convert));
  ok('the board is still settled after a convert', noRuns(r2.state));
}

// --- extra move ---------------------------------------------------------------------------------------
{
  const s = setup(TEAM, FOUR);
  ok('four board clean', noRuns(s));
  const r = apply(s, swap(3, 2, 4, 2));
  ok('a match of 4 gives +1 move', has(r.events, 'extra') && r.state.movesLeft === 2 && r.state.extraUsed);
  const t = r.state;
  t.board = setup(TEAM, FOUR).board.map((x) => ({ ...x, id: x.id + 5000 }));
  const r2 = apply(t, swap(3, 2, 4, 2));
  ok('only once per turn', !has(r2.events, 'extra') && r2.state.movesLeft === 1);
}

// --- berries and evolving -----------------------------------------------------------------------------
{
  // Three berries in a row (row 4 cols 1-3) are matched like gems: +3.
  const s = setup(TEAM, BERRY3);
  ok('berry board clean', noRuns(s));
  s.sides[0].berries = 1;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('a line of 3 berries counts 3', has(r.events, 'berry', (e) => e.side === 0 && e.n === 3));
  ok('berries charge no monster', !has(r.events, 'energy'));
  ok('4 berries: choose who evolves', r.state.pendingEvolve === 0 && has(r.events, 'evolveReady'));
  ok('a swap waits for the choice', apply(r.state, swap(0, 0, 0, 1)).error === 'evolve-first');
  const hp = r.state.sides[0].hp, max = r.state.sides[0].maxHp;
  const e = apply(r.state, { type: 'evolve', mon: 1 });
  ok('evolve: new form', e.ok && e.state.sides[0].mons[1].evo && !e.state.sides[0].mons[0].evo);
  ok('evolve: +5 HP, never past 80', e.state.sides[0].hp === Math.min(80, hp + 5) && e.state.sides[0].maxHp === 80 && max === 80);
  const low = { ...r.state, sides: r.state.sides.map((x, i) => i ? x : { ...x, hp: 50 }) };
  ok('evolve heals 5 when hurt', apply(low, { type: 'evolve', mon: 1 }).state.sides[0].hp === 55);
  ok('evolve: berries reset', e.state.sides[0].berries === 0 && e.state.pendingEvolve == null);
  ok('evolve: cannot evolve twice', apply({ ...e.state, pendingEvolve: 0 }, { type: 'evolve', mon: 1 }).error === 'bad-mon');
}
{
  const s = setup(TEAM, BERRY3);
  s.sides[0].berries = 1;
  s.sides[0].mons[0].evo = true;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('one monster left to evolve evolves on its own', r.state.sides[0].mons[1].evo && r.state.pendingEvolve == null && has(r.events, 'evolve'));
  const t = setup(TEAM, BERRY3);
  t.sides[0].mons.forEach((m) => { m.evo = true; });
  const r2 = apply(t, swap(4, 3, 4, 4));
  ok('both evolved: berries do nothing', r2.state.sides[0].berries === 0 && !has(r2.events, 'berry'));
  // Evolved special is stronger: Blazelynx 18.
  const u = setup(TEAM, THREE);
  u.sides[0].mons[0].evo = true; u.sides[0].mons[0].energy = 6;
  const hp = u.sides[1].hp;
  ok('the evolved special is stronger', apply(u, swap(4, 3, 4, 4)).state.sides[1].hp === hp - 18);
}

// --- bombs ----------------------------------------------------------------------------------------------
{
  // A bomb right next to the match (row 3 col 2, above the matched fire) detonates.
  const s = setup(TEAM, ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSX5DLWS', 'LFFSFLD']);
  ok('bomb board clean', noRuns(s));
  const r = apply(s, swap(4, 3, 4, 4));
  const b = r.events.find((e) => e.t === 'bomb');
  ok('a bomb next to a match detonates', !!b && b.at === idx(3, 2));
  ok('the blast covers its row and column', b && b.cells.length === COLS + ROWS - 1);
  ok('blast gems charge the mover (water in the blast)', r.state.sides[0].mons[1].energy > 0);
}
{
  // A bomb at 1 ticks to 0 at the end of the turn: it blows and hurts the side whose turn ended.
  const s = setup(TEAM, ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDLWS', 'LFFSFLX1']);
  ok('countdown board clean', noRuns(s));
  s.movesLeft = 1;
  const hp = s.sides[0].hp;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('countdown ticks at the end of the turn', has(r.events, 'tick'));
  ok('countdown 0 explodes', has(r.events, 'bomb', (e) => e.boom));
  ok('and deals 10 to the side whose turn ended', r.state.sides[0].hp === hp - 10 && has(r.events, 'damage', (e) => e.cause === 'bomb' && e.side === 0));
  ok('then it is the other side\'s turn', r.state.turn === 1 && r.state.movesLeft === 2);
}
{
  const s = setup(TEAM, ['FWSLDFW', 'SLDFWSL', 'DFWSLDF', 'WSLDLWS', 'LFFSFLX4']);
  s.movesLeft = 1;
  const r = apply(s, swap(4, 3, 4, 4));
  const tick = r.events.find((e) => e.t === 'tick');
  const bombId = s.board[idx(4, 6)].id;
  ok('a bomb counts down by 1 per turn', tick && tick.bombs.find((x) => x.id === bombId).n === 3);
}

// --- the turn timer -------------------------------------------------------------------------------------
{
  const s = setup(TEAM, BASE);
  const r = apply(s, { type: 'pass' });
  ok('pass ends the turn', r.ok && r.state.turn === 1 && r.state.movesLeft === 2 && has(r.events, 'pass'));
  const t = setup(TEAM, BASE);
  t.pendingEvolve = 0; t.sides[0].berries = 4;
  const r2 = apply(t, { type: 'pass' });
  ok('pass with an evolve pending evolves the first one', r2.ok && r2.state.sides[0].mons[0].evo && r2.state.turn === 1);
}

// --- winning --------------------------------------------------------------------------------------------
{
  const s = setup(TEAM, THREE);
  s.sides[0].mons[0].energy = 6;
  s.sides[1].hp = 5;
  const r = apply(s, swap(4, 3, 4, 4));
  ok('HP 0 wins', r.state.winner === 0 && has(r.events, 'win', (e) => e.side === 0));
  ok('HP never goes below 0', r.state.sides[1].hp === 0);
  ok('no moves after the end', apply(r.state, swap(0, 0, 0, 1)).error === 'over');
}

// --- unlocks --------------------------------------------------------------------------------------------
ok('6 starters open at 0 wins', unlockedIds(0).length === 6 && STARTERS.length === 6);
ok('3 wins opens Cinderwing', unlockedIds(3).includes('cinderwing') && !unlockedIds(5).includes('thornpaw'));
ok('30 wins opens all 12', unlockedIds(30).length === 12 && MONSTERS.length === 12);

// --- determinism ----------------------------------------------------------------------------------------
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function playOut(seed, teams, levels, rnd, log) {
  let s = newMatch({ seed, teams, first: seed % 2 });
  let guard = 0;
  while (s.winner == null && guard++ < 2000) {
    const mv = chooseMove(s, levels[s.turn], rnd);
    if (log) log.push(mv);
    const r = apply(s, mv);
    if (!r.ok) throw new Error('the computer chose an illegal move: ' + r.error + ' ' + JSON.stringify(mv));
    s = r.state;
  }
  return s;
}
{
  const log = [];
  const a = playOut(4242, TEAM, ['medium', 'medium'], seeded(1), log);
  let s = newMatch({ seed: 4242, teams: TEAM, first: 0 });
  for (const mv of log) s = apply(s, mv).state;
  ok('same seed + same moves = the same match (replay)', JSON.stringify(s) === JSON.stringify(a));
  const b = playOut(4242, TEAM, ['medium', 'medium'], seeded(1));
  ok('the same match twice is identical', JSON.stringify(a) === JSON.stringify(b));
  ok('a state survives JSON (save / network)', JSON.stringify(JSON.parse(JSON.stringify(a))) === JSON.stringify(a));
}

// --- the soak --------------------------------------------------------------------------------------------
{
  const arg = process.argv.find((x) => x.startsWith('--soak='));
  const games = arg ? Number(arg.split('=')[1]) : 300;
  const rnd = seeded(99);
  const all = MONSTERS.map((m) => m.id);
  const stats = { turns: [], errors: 0, specials: 0, evolves: 0, bombs: 0, extras: 0, wins: {}, pickWins: {}, pickGames: {} };
  const t0 = Date.now();
  const pairs = [['easy', 'easy'], ['medium', 'medium'], ['hard', 'hard'], ['easy', 'medium'], ['medium', 'hard'], ['easy', 'hard']];
  const vs = {};
  for (let g = 0; g < games; g++) {
    const levels = pairs[g % pairs.length].slice();
    if (g % 2) levels.reverse();
    const t0team = chooseTeam('hard', all, [], rnd);
    const t1team = chooseTeam('hard', all, t0team, rnd);
    try {
      let s = newMatch({ seed: 1000 + g, teams: [t0team, t1team], first: g % 2 });
      let guard = 0;
      while (s.winner == null && guard++ < 3000) {
        const r = apply(s, chooseMove(s, levels[s.turn], rnd));
        if (!r.ok) throw new Error(r.error);
        for (const e of r.events) {
          if (e.t === 'special') stats.specials++;
          else if (e.t === 'evolve') stats.evolves++;
          else if (e.t === 'bomb') stats.bombs++;
          else if (e.t === 'extra') stats.extras++;
        }
        s = r.state;
      }
      if (s.winner == null) throw new Error('no winner after 3000 moves ' + JSON.stringify(levels) + ' ' + JSON.stringify(s.sides.map((x) => [x.hp, x.maxHp, x.mons.map((m) => m.id + (m.evo ? '*' : ''))])));
      stats.turns.push((s.sides[0].turns + s.sides[1].turns) / 2);
      const key = levels.join(' v ');
      vs[key] = vs[key] || [0, 0];
      vs[key][s.winner]++;
      for (const [side, team] of [[0, t0team], [1, t1team]]) {
        for (const id of team) {
          stats.pickGames[id] = (stats.pickGames[id] || 0) + 1;
          if (s.winner === side) stats.pickWins[id] = (stats.pickWins[id] || 0) + 1;
        }
      }
    } catch (err) {
      stats.errors++;
      console.log('soak error', g, err.message);
    }
  }
  const tt = stats.turns.slice().sort((a, b) => a - b);
  const avg = tt.reduce((a, b) => a + b, 0) / (tt.length || 1);
  console.log(`soak: ${games} matches in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${stats.errors} errors`);
  console.log(`  turns per side: avg ${avg.toFixed(1)}, median ${tt[tt.length >> 1]}, min ${tt[0]}, max ${tt[tt.length - 1]}`);
  console.log(`  per match: ${(stats.specials / games).toFixed(1)} specials, ${(stats.evolves / games).toFixed(1)} evolves, ${(stats.bombs / games).toFixed(1)} bomb blasts, ${(stats.extras / games).toFixed(1)} extra moves`);
  console.log('  wins (first-named side v second):', Object.entries(vs).map(([k, [a, b]]) => `${k} ${a}-${b}`).join(', '));
  console.log('  monster win %:', Object.keys(stats.pickGames).sort().map((id) => `${id} ${Math.round(100 * (stats.pickWins[id] || 0) / stats.pickGames[id])}`).join(', '));
  ok('soak: no exceptions', stats.errors === 0);
  ok(`soak: sensible length (avg ${avg.toFixed(1)} turns per side)`, avg >= 6 && avg <= 25);
  const hardVsEasy = (vs['hard v easy'] || [0, 0])[0] + (vs['easy v hard'] || [0, 0])[1];
  const easyVsHard = (vs['hard v easy'] || [0, 0])[1] + (vs['easy v hard'] || [0, 0])[0];
  ok(`soak: hard beats easy more often (${hardVsEasy}-${easyVsHard})`, hardVsEasy > easyVsHard);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
