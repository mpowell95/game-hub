// test-puzzle-points.mjs - points for Sudoku, Murdoku, Nuts & Bolts, Minesweeper (js/puzzle-points.js, Matt
// 2026-11-03) and the help counts they read (`sd.hc` / `mu.hc`, written by js/game-stats.js, added up per person by
// js/players-agg.js). Node only, fake localStorage, no network.
//   node tools/test-puzzle-points.mjs
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

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
const A = await import('../js/players-agg.js');
const P = await import('../js/puzzle-points.js');
const device = (play) => { store.clear(); play(); return JSON.parse(store.get(G.statsKey())); };
const rec = (name, code, stats) => ({ profile: { name, playerId: code }, stats, updatedAt: 1 });

// --- The recorders save how much help each solve used ------------------------------------------------
{
  const s = device(() => {
    G.recordSudoku('expert', { hints: 0, mistakes: 0 });
    G.recordSudoku('expert', { hints: 1, mistakes: 0 });
    G.recordSudoku('expert', { hints: 0, mistakes: 2 });
    G.recordSudoku('expert', { hints: 4, mistakes: 3 });
    G.recordSudoku('easy', { hints: 1, mistakes: 1 });
  }).games.sudoku;
  ok('sudoku: a clean solve is still clean only', s.sd.clean.expert === 1);
  ok('sudoku: help counted by 1, 2, 3+ (mistakes count as hints)', JSON.stringify(s.sd.hc.expert) === '{"h1":1,"h2":1,"h3":1}', s.sd.hc);
  ok('sudoku: easy 1 hint + 1 mistake = 2', s.sd.hc.easy.h2 === 1 && !s.sd.hc.easy.h1);
  ok('sudoku: every other counter unchanged', s.byDiff.expert.won === 4 && s.sd.solved === 5 && s.sd.hints === 6 && s.sd.mistakes === 6 && s.sd.perfect === 1);
}
{
  const m = device(() => {
    G.recordMurdoku('hard', { hints: 0 });
    G.recordMurdoku('hard', { hints: 1 });
    G.recordMurdoku('hard', { hints: 2 });
    G.recordMurdoku('hard', { hints: 7 });
    G.recordMurdoku('hard', {});
  }).games.murdoku;
  ok('murdoku: help counted by 1, 2, 3+', JSON.stringify(m.mu.hc.hard) === '{"h1":1,"h2":1,"h3":1}', m.mu.hc);
  ok('murdoku: clean / hinted / hints unchanged', m.mu.clean.hard === 1 && m.mu.hinted.hard === 3 && m.mu.hints === 10);
  ok('murdoku: a solve with no hint record adds to no count', m.byDiff.hard.won === 5);
}

// --- Two phones, one person: the counts add; a phone from before the field still counts ------------------
{
  const a = device(() => { G.recordSudoku('hard', { hints: 1 }); G.recordSudoku('hard', { hints: 0 }); });
  const b = device(() => { G.recordSudoku('hard', { hints: 1 }); G.recordSudoku('hard', { hints: 3 }); });
  const old = device(() => { G.recordSudoku('hard', { hints: 2 }); });
  delete old.games.sudoku.sd.hc;                       // the shape every phone saved before 2026-11-03
  const p = A.aggregatePlayers({ a: rec('Probe', 'ZQXJ7', a), b: rec('Probe', 'ZQXJ7', b), o: rec('Probe', 'ZQXJ7', old) })[0].games.sudoku;
  ok('merge: h1 2, h3 1', p.sd.hc.hard.h1 === 2 && p.sd.hc.hard.h3 === 1 && !p.sd.hc.hard.h2, p.sd.hc);
  ok('merge: 5 wins, 1 clean', p.byDiff.hard.won === 5 && p.sd.noHint.hard === 1);
  // Hard: clean 4, two 1-hint 3 + 3, one 3+-hint 1, the old phone's helped solve (count unknown) 2.
  ok('points: Hard 4 + 3 + 3 + 1 + 2 = 13', P.puzzlePoints(p, 'sudoku').pts === 13, P.puzzlePoints(p, 'sudoku'));
}

// --- The tables --------------------------------------------------------------------------------------------
{
  const sd = { total: { won: 6 }, byDiff: { easy: { won: 1 }, expert: { won: 5 } }, sd: { noHint: { expert: 1 }, hc: { expert: { h1: 1, h2: 1, h3: 1 } } } };
  // Expert: clean 8, 5, 3, 1, one unknown 4; Easy: one unknown 1.
  ok('sudoku: Expert 8+5+3+1+4, Easy 1 = 22', P.puzzlePoints(sd, 'sudoku').pts === 22);
  ok('sudoku: the Expert tab alone = 21', P.puzzlePoints(sd, 'sudoku', 4).pts === 21);
  ok('sudoku: more clean than wins never counts past the wins', P.puzzlePoints({ byDiff: { medium: { won: 1 } }, sd: { noHint: { medium: 9 } } }, 'sudoku').pts === 2);
  const mu = { byDiff: { easy: { won: 18 }, medium: { won: 43 } }, mu: { clean: { medium: 3 } } };
  ok('murdoku: Natalia\'s shape = 64 (18 + 3 x 2 + 40 x 1)', P.puzzlePoints(mu, 'murdoku').pts === 64);
  const nb = { total: { won: 40 }, byDiff: { easy: { won: 1 }, medium: { won: 1 }, hard: { won: 1 }, extrahard: { won: 2 } } };
  ok('nuts & bolts: 1 + 2 + 4 + 8 x 2, plus 35 with no level = 58', P.puzzlePoints(nb, 'nutsbolts').pts === 58);
  const farm = { total: { won: 51 }, byDiff: { easy: { won: 51 } } };
  ok('nuts & bolts: 51 Easy levels add 20 at most', P.puzzlePoints(farm, 'nutsbolts').pts === 20 && P.puzzlePoints(farm, 'nutsbolts', 1).pts === 20 && P.puzzlePoints(farm, 'nutsbolts').wins === 51);
  ok('nuts & bolts: no-level wins only on All', P.puzzlePoints(nb, 'nutsbolts', 1).pts === 1);
  const ms = { total: { won: 4 }, byDiff: { easy: { won: 1, lost: 9 }, medium: { won: 1 }, hard: { won: 1 }, expert: { won: 1, lost: 40 } } };
  ok('minesweeper: 1 + 3 + 8 + 20 = 32, losses cost nothing', P.puzzlePoints(ms, 'minesweeper').pts === 32);
  ok('an absent record is 0', P.puzzlePoints(undefined, 'sudoku').pts === 0 && P.puzzlePoints(null, 'minesweeper').wins === 0);
  ok('help keys', P.helpKey(0) === null && P.helpKey(1) === 'h1' && P.helpKey(2) === 'h2' && P.helpKey(9) === 'h3');
}

// --- Gated to admin devices in the leaderboard (players keep today's board) --------------------------------
{
  const { readFileSync } = await import('node:fs');
  const ui = readFileSync(new URL('../js/leaderboard-ui.js', import.meta.url), 'utf8');
  ok('leaderboard: puzzle points only on an admin device', /function isPuzzlePts\(id\) \{ return PUZZLE_POINT_GAMES\.includes\(id\) && isAdminDevice\(\); \}/.test(ui));
}

console.log(`\npuzzle-points tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
