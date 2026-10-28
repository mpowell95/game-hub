// test-integrity.mjs - every game's integrity checks (js/integrity.js), the read-time void
// (js/stats-corrections.js voidIntegrityGame), the server half (functions/integrity.js) against an
// in-memory fake database, Connect 4 Hoops' result check, and the wiring. Headless, no network.
//
//   node tools/test-integrity.mjs                    the tests
//   node tools/test-integrity.mjs --db <snapshot>    ALSO replay every rule over a whole-database
//                                                    snapshot (backups/rtdb-backup.mjs); prints every
//                                                    hit and fails on any STRONG one (Matt's rule 5:
//                                                    no honest player may trip a check that voids)
//
// The honest stores below are written by the games' OWN recorders (js/game-stats.js), so a rule that
// fires on them is a rule an honest player could trip.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, ['tools/sync-functions-shared.mjs'], { cwd: ROOT, stdio: 'ignore' });

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

const G = await import('../js/game-stats.js');
const I = await import('../js/integrity.js');
const C = await import('../js/stats-corrections.js');
const AGG = await import('../js/players-agg.js');
const CFG = await import('../js/admin-config.js');
const HR = await import('../hoops4/js/replay.js');
const S = await import('../functions/integrity.js');
const BOARDS = await import('../functions/boards.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('ok   ', name); } else { fail++; console.log('FAIL ', name, extra ? `\n       ${extra}` : ''); } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const rules = (gid, rec) => I.checkGame(gid, rec).map((h) => h.rule);

// --- an honest store, written by the recorders ------------------------------------------------------
console.log('\n--- honest play trips nothing ---');
G.recordSnake(254, 'hard', 'off'); G.recordSnake(3, 'easy', 'on');
G.recordYahtzee('ai', true, { yahtzees: 13, score: 1575 }); G.recordYahtzee('ai', false, { yahtzees: 0, score: 120 });
G.recordSkeeball('classic', { score: 900, balls: 9, hundreds: 9, bestThrow: 100, at: Date.parse('2026-10-28T12:00:00') });
G.recordSkeeball('popongo', { score: 54, balls: 9, bestThrow: 6, at: Date.parse('2026-10-28T12:00:00') });
G.recordBattleship('beginner', true, { shots: 12, hits: 12, sunk: 4, accuracy: 100 });
G.recordBattleship('pro', false, { shots: 60, hits: 10, sunk: 2, accuracy: 17 });
G.recordTicTacToe('ultimate', 'pro', true); G.recordTicTacToe('classic', 'pro', null); G.recordTicTacToe('classic', 'beginner', true);
G.recordCupPongSolo(10); G.recordCupPongSolo(31);
G.recordGolf('pinevalley', { courseId: 'pinevalley3', holes: 3, strokes: 3, points: 12, aces: 3, holeScores: { 'pinevalley:1': 1 } });
G.recordHillClimb(400, 'countryside', { coins: 150, flips: 3 }); G.recordHillClimb(10, 'countryside', { coins: 0, flips: 0 });
G.recordSudoku('easy', { timeMs: 90000, mistakes: 0, hints: 0 });
G.recordMinesweeper('easy', true, { timeMs: 9000, cleared: 100, flagsRight: 10, mines: 10 }); G.recordMinesweeper('hard', false, { cleared: 40 });
G.recordAirHockey('easy', true, { goalsFor: 7, goalsAgainst: 6, shot: 9900 }); G.recordAirHockey('hard', false, { goalsFor: 0, goalsAgainst: 7, shot: 10 });
G.recordBoggle('beginner', true, { words: 3, score: 33, longestWord: { word: 'QUARTERBACKS', len: 12 } });
G.recordDominoes('easy', true, { rounds: 4, bestRound: 60, points: 150 }); G.recordDominoes('easy', null, { rounds: 5, bestRound: 10, points: 152 });
G.recordDotsBoxes('beginner', true, { boxes: 5, bestChain: 5 });
G.recordContexto('en', true, { guesses: 1, hints: 0 }); G.recordContexto('es', false, { guesses: 0, hints: 2 });
G.recordWayOut('easy', { timed: true, timeMs: 1, penaltyMs: 30000, arrows: 12, rounds: 3, mistakes: 2, hints: 0, level: 1, gen: 5 });
G.recordWayOut('expert', { timed: true, timeMs: 60000, penaltyMs: 0, arrows: 70, rounds: 9, mistakes: 0, hints: 0, level: 201, gen: 10 });
G.recordResult('uno', 'easy', true); G.recordResult('uno', 'hard', false); G.recordConnect4('easy', 'player', null);
const honest = G.loadStoredStats();
const honestHits = I.checkStats(honest);
const strongHonest = Object.entries(honestHits).flatMap(([g, l]) => l.filter((h) => h.void).map((h) => `${g}:${h.rule}`));
ok('the recorders\' own records break no strong rule, at every limit', strongHonest.length === 0, strongHonest.join(', '));
ok('...the only alert is the 1-guess Contexto, which is an alert, never a void',
  JSON.stringify(Object.keys(honestHits)) === '["contexto"]' && honestHits.contexto.every((h) => !h.void && h.rule === 'contexto-first-guess'));

// --- tampered records ---------------------------------------------------------------------------
console.log('\n--- a number the game cannot produce is caught ---');
const tamper = (gid, fn) => { const g = clone(honest.games[gid]); fn(g); return rules(gid, g); };
const cases = [
  ['snake', (g) => { g.sn.bestLen = 256; }, 'snake-longer-than-board'],
  ['snake', (g) => { g.sn.bestLenByDiffWalls.on.hard = 400; }, 'snake-longer-than-board'],
  ['yahtzee', (g) => { g.yz.bestScore = 1576; }, 'yahtzee-score-too-high'],
  ['yahtzee', (g) => { g.yz.yahtzees = 27; }, 'yahtzee-too-many-yahtzees'],
  ['skeeball', (g) => { g.sk.bestGame = 910; }, 'skeeball-rack-too-high'],
  ['skeeball', (g) => { g.sk.boards.popongo.best = 60; }, 'skeeball-rack-too-high'],
  ['skeeball', (g) => { g.sk.boards.classic.daily['2026-10-28'] = 1000; }, 'skeeball-rack-too-high'],
  ['battleship', (g) => { g.bs.fewestShotsWin = 11; }, 'battleship-win-too-few-shots'],
  ['battleship', (g) => { g.bs.hits = g.bs.shots + 1; }, 'battleship-more-hits-than-shots'],
  ['tictactoe', (g) => { g.byDiff.pro.won += 1; g.byDiff.pro.played += 1; g.total.won += 1; g.total.played += 1; }, 'tictactoe-beat-pro-classic'],
  ['cuppong', (g) => { g.cp.soloBest = 9; }, 'cuppong-solo-under-10'],
  ['cuppong', (g) => { g.cp.soloThrows = 19; }, 'cuppong-solo-under-10'],
  ['golf', (g) => { g.gf.strokes = 2; }, 'golf-fewer-strokes-than-holes'],
  ['golf', (g) => { g.gf.birdies = 1; }, 'golf-fewer-strokes-than-holes'],
  ['golf', (g) => { g.gf.bestHole['pinevalley:2'] = 0; }, 'golf-fewer-strokes-than-holes'],
  ['hillclimb', (g) => { g.hc.flips = 4; }, 'hillclimb-flips-without-coins'],
  ['sudoku', (g) => { g.sd.perfect = 2; }, 'sudoku-more-perfect-than-solved'],
  ['minesweeper', (g) => { g.ms.bestTimeMs.hard = 50000; }, 'minesweeper-time-without-win'],
  ['airhockey', (g) => { g.ah.goalsFor = 15; }, 'airhockey-goals-too-many'],
  ['airhockey', (g) => { g.ah.bestShot = 9901; }, 'airhockey-goals-too-many'],
  ['boggle', (g) => { g.bg.longestWord = { word: 'ABCDEFGHIJKLMNOPQR', len: 18 }; }, 'boggle-impossible-word'],
  ['boggle', (g) => { g.bg.bestScore = 34; }, 'boggle-impossible-word'],
  ['dominoes', (g) => { g.dm.points = 149; g.dm.won = 1; }, 'dominoes-win-without-points'],
  ['dotsboxes', (g) => { g.db.bestChain = 6; }, 'dotsboxes-chain-too-long'],
  ['contexto', (g) => { g.ct.solved = 2; }, 'contexto-wins-without-guesses'],
  ['wayout', (g) => { g.wo.log.easy[0].t = 19999; }, 'arrowmaze-faster-than-penalties'],
  ['uno', (g) => { g.byDiff.easy.won = 2; }, 'more-results-than-games'],
  ['connect4', (g) => { g.total.won = 2; }, 'more-results-than-games'],
];
for (const [gid, fn, rule] of cases) ok(`${gid}: ${rule}`, tamper(gid, fn).includes(rule), JSON.stringify(tamper(gid, fn)));
ok('every strong rule has a tamper case above', I.RULES.filter((r) => r.void).every((r) => cases.some((c) => c[2] === r.id)));
ok('a Arrow Maze level at 0.1 s an arrow is an ALERT, not a void',
  I.checkGame('wayout', (() => { const g = clone(honest.games.wayout); g.wo.log.expert[0].t = 7000; return g; })())
    .some((h) => h.rule === 'arrowmaze-too-fast' && h.void === false));
ok('Hold\'em: an impossible ledger is an alert (holdemSuspect), a clean one nothing',
  I.checkGame('holdem', { hb: { buyins: 0, winnings: 500, cashes: 0 } }).some((h) => h.rule === 'holdem-ledger' && !h.void)
  && I.checkGame('holdem', { hb: { buyins: 500, winnings: 0, entries: 1 } }).length === 0);
ok('junk records never throw and never flag', [null, {}, 'x', { total: 'x' }, { sn: null }].every((r) => I.checkGame('snake', r).length === 0));

// --- the void, at read time -------------------------------------------------------------------------
console.log('\n--- a voided game: played, no win, every score 0 ---');
{
  const raw = clone(honest.games.snake);
  const before = JSON.stringify(raw);
  const v = C.voidIntegrityGame(raw, 'snake');
  ok('the raw record is not touched', JSON.stringify(raw) === before);
  ok('played kept, wins 0', v.total.played === raw.total.played && v.total.won === 0 && v.byDiff.hard.won === 0 && v.byDiff.hard.played === 1);
  ok('runs kept, every best 0', v.sn.runs === 2 && v.sn.bestLen === 0 && v.sn.bestLenByDiff.hard === 0 && v.sn.bestLenByDiffWalls.off.hard === 0);
  const wo = C.voidIntegrityGame(honest.games.wayout, 'wayout');
  ok('Arrow Maze: no points, no log, levels still played', wo.byDiff.easy.won === 0 && wo.byDiff.easy.played === 1 && wo.wo.log.easy.length === 0 && wo.wo.pts.easy === 0);
  const st = { games: clone(honest.games) };
  ok('correctStats leaves a record alone without a void', JSON.stringify(C.correctStats(st, 'dev1', {})) === JSON.stringify(st));
  const cs = C.correctStats(st, 'dev1', { integrity: { dev1: { snake: true } } });
  ok('correctStats voids only that game on only that record', cs.games.snake.sn.bestLen === 0 && cs.games.yahtzee.yz.bestScore === 1575
    && C.correctStats(st, 'dev2', { integrity: { dev1: { snake: true } } }).games.snake.sn.bestLen === 254);
  const players = {
    dev1: { profile: { name: 'Cheat', playerId: 'AAAAA' }, stats: { games: { snake: clone(honest.games.snake) } }, updatedAt: 2 },
    dev2: { profile: { name: 'Honest', playerId: 'BBBBB' }, stats: { games: { snake: clone(honest.games.snake) } }, updatedAt: 1 },
  };
  players.dev2.stats.games.snake.sn.bestLen = 40;
  const groups = AGG.aggregatePlayers(players, { integrity: { dev1: { snake: true } } });
  const cheat = groups.find((g) => g.name === 'Cheat'), hon = groups.find((g) => g.name === 'Honest');
  ok('the Leaderboard: the voided person has 0, still played, the other is untouched',
    cheat.games.snake.sn.bestLen === 0 && cheat.games.snake.total.played === 2 && cheat.games.snake.total.won === 0 && hon.games.snake.sn.bestLen === 40);
}

// --- flags, undo -----------------------------------------------------------------------------------
console.log('\n--- flags and Matt\'s undo ---');
{
  const flags = { dev1: { snake: { 'snake-longer-than-board': { void: true } }, contexto: { 'contexto-first-guess': { void: false } } } };
  const mine = (v) => JSON.stringify(Object.fromEntries(Object.entries(v).filter(([id]) => !I.HAND_VOIDS[id])));
  ok('a strong flag voids its game; an alert voids nothing', mine(I.activeVoids(flags, {})) === JSON.stringify({ dev1: { snake: true } }));
  const cfg = { integrity: { undo: { dev1: { snake: true } } } };
  ok('Matt\'s undo counts it again', mine(I.activeVoids(flags, cfg)) === '{}');
  const vcfg = { integrity: { void: { dev1: { contexto: true } } } };
  ok('Matt\'s Void on the admin page voids an alert', mine(I.activeVoids(flags, vcfg)) === JSON.stringify({ dev1: { snake: true, contexto: true } })
    && I.isVoided(flags, vcfg, 'dev1', 'contexto') === true && I.isVoided(flags, {}, 'dev1', 'contexto') === false);
  ok('...and Undo beats it', I.isVoided(flags, { integrity: { void: { dev1: { contexto: true } }, undo: { dev1: { contexto: true } } } }, 'dev1', 'contexto') === false);
  const kog = '090215fa-e525-4bbe-99d7-58f9ae3cd437';
  ok('King of Games\' Contexto is voided by hand (Matt, 2026-10-28), and his Undo would count it again',
    I.activeVoids({}, {})[kog].contexto === true && I.isVoided({}, { integrity: { undo: { [kog]: { contexto: true } } } }, kog, 'contexto') === false);
  ok('admin-config reads the undo and the void', CFG.resolveIntegrityUndone(cfg, 'dev1', 'snake') === true && CFG.resolveIntegrityUndone(cfg, 'dev1', 'yahtzee') === false
    && CFG.resolveIntegrityUndone(null, 'dev1', 'snake') === false && CFG.resolveIntegrityVoid(vcfg, 'dev1', 'contexto') === true && CFG.resolveIntegrityVoid(null, 'dev1', 'contexto') === false);
  ok('hitText says the rule and the numbers', I.hitText({ rule: 'snake-longer-than-board', v: 300, lim: 255 }) === 'a snake longer than the board (300, limit 255)');
}

// --- the server, against a fake database ----------------------------------------------------------
console.log('\n--- the server writes each flag once ---');
function fakeDb(tree) {
  const parts = (p) => String(p).split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);
  const setAt = (p, v) => {
    const ks = parts(p); let o = tree;
    for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  return {
    tree,
    ref: (p) => ({
      get: async () => ({ val: () => { const v = getAt(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
      transaction: async (fn) => { const cur = getAt(p); const next = fn(cur === undefined ? null : cur); if (next === undefined) return { committed: false }; setAt(p, next); return { committed: true }; },
    }),
  };
}
{
  const bad = clone(honest); bad.games.snake.sn.bestLen = 999;
  const players = {
    cheat1: { profile: { name: 'Cheat', playerId: 'AAAAA' }, stats: bad },
    good1: { profile: { name: 'Honest', playerId: 'BBBBB' }, stats: clone(honest) },
    t1: { profile: { name: 'test1', playerId: 'DREG5' }, stats: bad },
  };
  const db = fakeDb({});
  const r1 = await S.writeFlags(db, players, 1000);
  const w = r1.written.map((f) => `${f.id}/${f.gid}/${f.rule}`).sort();
  ok('the first pass flags the cheat (void) and both 1-guess Contextos (alerts), never a test name',
    JSON.stringify(w) === JSON.stringify(['cheat1/contexto/contexto-first-guess', 'cheat1/snake/snake-longer-than-board', 'good1/contexto/contexto-first-guess']), JSON.stringify(w));
  ok('the flag holds the numbers, the name and the code', JSON.stringify(db.tree.integrityFlags.cheat1.snake['snake-longer-than-board'])
    === JSON.stringify({ void: true, v: 999, lim: 255, name: 'Cheat', code: 'AAAAA', when: 1000 }));
  const r2 = await S.writeFlags(db, players, 2000);
  ok('a second pass writes nothing and pushes nothing', r2.written.length === 0 && db.tree.integrityFlags.cheat1.snake['snake-longer-than-board'].when === 1000);
  const board = BOARDS.buildBoardParts(players, {}, db.tree.integrityFlags);
  const snakeOf = (parts, name) => { const p = Object.values(parts.people).map((x) => JSON.parse(x)).find((x) => x.name === name); return p && (p.games.snake || JSON.parse(parts.defaults.snake)); };
  const person = snakeOf(board, 'Cheat');
  ok('the leaderboard package carries the void', person && person.sn.bestLen === 0 && person.total.played === 2);
  const undone = BOARDS.buildBoardParts(players, { integrity: { undo: { cheat1: { snake: true } } } }, db.tree.integrityFlags);
  ok('...and Matt\'s undo takes it out', snakeOf(undone, 'Cheat').sn.bestLen === 999);
  const n = S.integrityNote('flag', r1.written.find((f) => f.gid === 'snake'));
  ok('the push names the person, the game and the rule', n.text('en').body === 'Cheat, Snake: voided. a snake longer than the board (999, limit 255)'
    && n.text('es').body.startsWith('Cheat, Snake: anulado.'));
}

// --- online matches -----------------------------------------------------------------------------
console.log('\n--- online challenges: alerts only ---');
{
  const dart = (by, x, y) => ({ by, x, y, at: 1 });
  const T20 = { x: 0, y: -0.606 };    // treble 20's middle
  const darts = (n) => ({ over: { winner: 'a' }, a: { name: 'A', code: 'AAAAA' }, b: { name: 'B', code: 'BBBBB' },
    log: Object.fromEntries([...Array(n).fill(dart('a', T20.x, T20.y)), dart('b', 0, 0.3)].map((e, i) => [String(i).padStart(4, '0'), e])) });
  ok('darts: 4 trebles in a row is nothing, 5 is an alert', I.checkMatch('darts', darts(4)).length === 0
    && I.checkMatch('darts', darts(5)).some((h) => h.rule === 'darts-treble-run' && h.side === 'a' && h.v === 5));
  ok('darts: an unfinished match is not judged', I.checkMatch('darts', { ...darts(9), over: null }).length === 0);
  const cups = (n) => ({ over: { winner: 'b' }, log: Object.fromEntries(Array.from({ length: n + 1 }, (_, i) => [String(i).padStart(4, '0'), { by: 'b', k: 't', m: i < n ? `k${i}` : '' }])) });
  ok('cup pong: 9 straight is nothing, 10 is an alert', I.checkMatch('cuppong', cups(9)).length === 0 && I.checkMatch('cuppong', cups(10)).length === 1);
  const fleet = [{ id: 'battleship', r: 0, c: 0, dir: 'h' }, { id: 'cruiser', r: 1, c: 0, dir: 'h' }, { id: 'submarine', r: 2, c: 0, dir: 'h' }, { id: 'destroyer', r: 3, c: 0, dir: 'h' }];
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 0], [3, 1]];
  const bs = (misses) => ({ over: { winner: 'a' }, a: { fleet: [] }, b: { fleet },
    log: Object.fromEntries([...cells, ...Array.from({ length: misses }, (_, i) => [7, i])].map(([r, c], i) => [String(i).padStart(4, '0'), { by: 'a', r, c }])) });
  ok('battleship: 12 of 13 is an alert, 12 of 14 (86%) is not', I.checkMatch('battleship', bs(1)).some((h) => h.rule === 'battleship-accuracy' && h.v === 92)
    && I.checkMatch('battleship', bs(2)).length === 0);
  const mv = (seq) => Object.fromEntries(seq.map(([by, col], i) => [String(i).padStart(4, '0'), { by, col, shots: 1 }]));
  const win = mv([['a', 0], ['b', 1], ['a', 0], ['b', 1], ['a', 0], ['b', 1], ['a', 0]]);
  ok('hoops: the replay finds the four', JSON.stringify(HR.replayResult(Object.values(win))) === '{"winner":"a","over":true}');
  ok('hoops: a stored winner the moves do not give is an alert; the right one, or a resignation, is not',
    I.checkMatch('hoops', { moves: win, over: { winner: 'b', why: 'four' } }).length === 1
    && I.checkMatch('hoops', { moves: win, over: { winner: 'a', why: 'four' } }).length === 0
    && I.checkMatch('hoops', { moves: win, over: { winner: 'b', why: 'resign' } }).length === 0);
  const db = fakeDb({});
  const m = darts(6);
  const w1 = await S.checkFinishedMatch(db, 'darts', 'abc123', m, 5);
  const w2 = await S.checkFinishedMatch(db, 'darts', 'abc123', m, 6);
  ok('a match alert is written once, with the player', w1.length === 1 && w2.length === 0
    && db.tree.integrityAlerts['darts~abc123']['darts-treble-run~a'].name === 'A');
}

// --- wiring ---------------------------------------------------------------------------------------
console.log('\n--- wiring ---');
{
  const read = (p) => readFileSync(new URL(p, new URL('..', import.meta.url)), 'utf8');
  const rulesJ = JSON.parse(read('database.rules.json')).rules;
  ok('rules: integrityFlags and integrityAlerts are admin-read, never written by a phone',
    ['integrityFlags', 'integrityAlerts'].every((k) => rulesJ[k] && rulesJ[k]['.write'] === false && /admins/.test(rulesJ[k]['.read'])));
  ok('backup: both branches are in BRANCHES', /'integrityFlags', 'integrityAlerts'/.test(read('backups/rtdb-backup.mjs')));
  const idx = read('functions/index.js');
  ok('server: every board rebuild runs the checks and builds with the flags',
    /await writeFlags\(db, players \|\| \{\}\)/.test(idx) && /buildBoardParts\(players \|\| \{\}, cfg \|\| null, flags\)/.test(idx));
  ok('server: an undo rebuilds; the four challenge games are checked when they end',
    /integrityOnUndo = onValueWritten\(\{ ref: '\/adminConfig\/v1\/integrity'/.test(idx)
    && ['darts', 'cuppong', 'battleship', 'hoops'].every((n) => idx.includes(`onMatchOver('${n}')`)));
  ok('server: functions that may push carry the VAPID secret',
    ['boardsOnSync', 'boardsOnConfig', 'integrityOnUndo', 'boardsCatchUp'].every((f) => (idx.split('\n').find((l) => l.startsWith(`export const ${f} =`)) || '').includes('secrets: [VAPID_PRIVATE_KEY]')));
  ok('shared: js/integrity.js is copied to the server', /'js\/integrity\.js'/.test(read('tools/sync-functions-shared.mjs')));
  ok('hub: a tap on the push opens the admin page, on an admin device only', /if \(id === 'admin'\) \{ this\._clearPushOpen\(\); if \(isAdminDevice\(\)\) this\.openAdmin\(\); return; \}/.test(read('js/hub.js')));
  const ui = read('js/admin-ui.js');
  ok('admin page: a section, read from both nodes, one button per row (Void an alert, Undo a void)', /sec\('integrity'/.test(ui) && /get\('integrityFlags'\), get\('integrityAlerts'\)/.test(ui) && /setIntegrityVoided\(id, gid, voided\)/.test(ui) && /data-ivset="\$\{voided \? 'count' : 'void'\}"/.test(ui));
  ok('hoops: validateGame checks the stored result against the moves', /if \(over\.why !== 'resign' && !sameResult\(replayResult\(moves\), over\.winner\)\) return null;/.test(read('hoops4/js/mp.js')));
}

// --- replay over a real snapshot -------------------------------------------------------------------
const dbArg = process.argv.indexOf('--db');
if (dbArg > 0) {
  console.log('\n--- replay over a snapshot ---');
  const d = JSON.parse(readFileSync(process.argv[dbArg + 1], 'utf8'));
  let records = 0, strong = 0;
  for (const [id, r] of Object.entries(d.players || {})) {
    records++;
    for (const [gid, list] of Object.entries(I.checkStats((r || {}).stats))) {
      for (const h of list) {
        if (h.void) strong++;
        console.log(`  ${h.void ? 'VOID ' : 'alert'}  ${(r.profile || {}).name} (${(r.profile || {}).playerId}) ${id.slice(0, 8)} ${I.gameName(gid)}: ${I.hitText(h)}`);
      }
    }
  }
  let matches = 0, alerts = 0;
  for (const node of ['darts', 'cuppong', 'battleship', 'hoops']) {
    for (const m of Object.values(((d[node] || {}).games) || {})) {
      if (!m || !m.over) continue;
      matches++;
      for (const h of I.checkMatch(node, m)) { alerts++; console.log(`  alert  ${I.gameName(node)} ${m.id}: ${I.hitText(h)} (${(m[h.side] || {}).name || h.side})`); }
    }
  }
  console.log(`  ${records} records, ${strong} strong hits; ${matches} finished matches, ${alerts} alerts`);
  ok('no record in the snapshot breaks a strong rule', strong === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
