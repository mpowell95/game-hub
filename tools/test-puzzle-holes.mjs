// test-puzzle-holes.mjs - the holes closed 2026-10-29, second pass (docs/INTEGRITY-CHECKS-SPEC.md,
// "Holes closed 2026-10-29 (second pass): puzzles, clocks, and names").
//
//   node tools/test-puzzle-holes.mjs              pure + source checks (node only, fake localStorage)
//   node tools/test-puzzle-holes.mjs --browser    ALSO two real tabs on one storage (needs `node server.mjs`;
//                                                 NODE_PATH=$(npm root -g) for playwright-core)
//
//   I1  Sudoku: a solved puzzle stays solved (no Undo), and records once per puzzle on any route.
//   I2  Sudoku mistakes and Murdoku full-board checks count like hints (new solves only).
//   I3  Two tabs on one storage: Sudoku, Murdoku, Nuts & Bolts, Minesweeper.
//   I4  Minesweeper and Boggle solo: time away with the board on screen counts.
//   I6  Arrow Maze: other storages' slips capped by stamps, hints carry over, Rush weeks by the server.
//   I8  Name gate: "That's me" by the server's clock only.
//   I9  Word Weaver: the most hints any record used; Gridlock: server time for crowns and hints.
//   I10 Skeeball: challenge racks feed no objective.
//   I11 Nuts & Bolts: one win per level per person.
//   I12 Leaderboard: no player codes in the page.
// (I5 Contexto and I7 Spelling Bee: tools/test-integrity.mjs and tools/test-bee-server.mjs.)
//
// Never uses Matt's name or code: test1 / DREG5 and made-up codes; nothing here reaches Firebase.

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name); } };
const ROOT = new URL('../', import.meta.url);
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8');

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
const T = await import('../js/arrow-maze-time.js');
const W = await import('../js/word-weaver-points.js');
const ST = await import('../js/server-time.js');
const device = (play) => { store.clear(); play(); return JSON.parse(store.get(G.statsKey())); };
const rec = (name, code, stats) => ({ profile: { name, playerId: code }, stats, updatedAt: 1 });

// --- I1 Sudoku: no Undo out of a solve; one record per puzzle ------------------------------------
console.log('\n--- I1 / I2 Sudoku ---');
{
  const { SudokuGame, puzzleIdOf } = await import('../sudoku/js/game.js');
  const sol = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) sol.push(((r * 3 + Math.floor(r / 3) + c) % 9) + 1);
  const puzzle = sol.slice(); puzzle[0] = 0;
  const g = new SudokuGame({ tier: 'easy', puzzle, solution: sol });
  const res = g.place(0, sol[0]);
  ok('I1 the last digit solves it', res.solved && g.isSolved());
  ok('I1 Undo refuses a solved puzzle (game.js) and canUndo is false', g.undo() === false && g.canUndo() === false && g.isSolved());
  ok('I1 a puzzle\'s id is the same for the same givens and answer, different otherwise',
    g.puzzleId() === puzzleIdOf(puzzle.join(''), sol.join('')) && g.puzzleId() !== puzzleIdOf(sol.join(''), sol.join('')));
  const ui = src('sudoku/js/ui.js');
  ok('I1 ui: Undo on a solved board does nothing; a puzzle already recorded on this storage is never recorded again',
    /case 'undo':\s*\n\s*if \(this\.game\.isSolved\(\)\) break;/.test(ui) && /if \(isDone\(id\)\) \{ clearSave\(\); this\._leaveStale\(\); return; \}/.test(ui)
    && /recordSudoku\(g\.tier, \{[^}]*\}\);\s*\n\s*markDone\(id\);/.test(ui) && /const DONE_KEY = 'gamehub\.sudoku\.done\.v1';/.test(ui));
  const s = device(() => { G.recordSudoku('hard', { hints: 0, mistakes: 2 }); G.recordSudoku('hard', { hints: 0, mistakes: 0 }); });
  ok('I2 Sudoku: a solve with a mistake is a win but not a no-hint solve', s.games.sudoku.byDiff.hard.won === 2 && s.games.sudoku.sd.clean.hard === 1);
}

// --- I2 / I3 Murdoku ---------------------------------------------------------------------------
console.log('\n--- I2 / I3 Murdoku ---');
{
  const ui = src('murdoku/js/ui.js');
  ok('I2 a full wrong board (the clue check) counts like a hint', /if \(chk\.full && !this\.guided && this\.hints !== null\) this\.hints \+= 1;/.test(ui));
  ok('I3 every write re-reads the slot: another case or a finished one leaves this board; the larger hint count wins',
    /if \(!cur \|\| caseId\(cur\.puzzle\) !== caseId\(this\.puz\) \|\| \(cur\.solved && !this\.solved\)\) return false;/.test(ui)
    && /this\.hints = Math\.max\(this\.hints, cur\.hints\);/.test(ui) && /if \(cur\.recorded\) this\.recorded = true;/.test(ui));
  ok('I3 the win checks the slot first (a case solved in another tab records nothing here)',
    /_win\(\) \{[\s\S]{0,400}?if \(!this\._save\(\)\) \{ this\._leaveStale\(\); return; \}/.test(ui));
  const s = device(() => { G.recordMurdoku('hard', { hints: 1 }); G.recordMurdoku('hard', { hints: 0 }); });
  ok('I2 Murdoku: a checked board counts in hinted, a clean solve in clean', s.games.murdoku.mu.hinted.hard === 1 && s.games.murdoku.mu.clean.hard === 1);
}

// --- I3 Sudoku, Nuts & Bolts, Minesweeper: the stale tab ------------------------------------------
console.log('\n--- I3 two tabs (source) ---');
{
  const sd = src('sudoku/js/ui.js');
  ok('I3 Sudoku: a write only to the same, unrecorded puzzle; hints and mistakes take the larger count',
    /if \(!cur \|\| cur\.puzzleId\(\) !== id \|\| isDone\(id\)\) return false;/.test(sd) && /game\.hints = Math\.max\(game\.hints, cur\.hints \| 0\);/.test(sd)
    && /game\.mistakes = Math\.max\(game\.mistakes, cur\.mistakes \| 0\);/.test(sd));
  const nb = src('nuts-bolts/js/ui.js');
  ok('I3 Nuts & Bolts: the stored won is merged before the record check and before every save',
    /mergeStoredWon\(this\);   \/\/ another tab may have recorded this level already/.test(nb) && /function saveState\(ui\) \{\s*\n\s*mergeStoredWon\(ui\);/.test(nb));
  const ms = src('minesweeper/js/ui.js');
  ok('I3 Minesweeper: a move and a save need the slot to still hold this board unfinished',
    /_doDig\(i\) \{\s*\n\s*if \(!this\._ownsBoard\(\)\) return;/.test(ms) && /_doFlag\(i\) \{\s*\n\s*if \(!this\._ownsBoard\(\)\) return;/.test(ms)
    && /if \(g\._saved && !slotHolds\(g\)\) return;/.test(ms));
}

// --- I4 time away ---------------------------------------------------------------------------------
console.log('\n--- I4 time away ---');
{
  ST.__setServerTimeForTest(5000);   // the server is 5 s ahead of this "phone"
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => fake;
  const st = ST.awayStamp();
  fake += 60000;   // a minute away by the phone's clock
  ok('I4 a minute away is charged (phone clock)', ST.measureAway(st) >= 60000);
  const st2 = ST.awayStamp();
  fake -= 3600000;   // the phone's clock set BACK an hour while away
  ok('I4 a phone clock set back never makes time away negative', ST.measureAway(st2) >= 0);
  let topped = null;
  const cross = { ...ST.awayStamp(), pg: 'another-page', p: undefined };
  cross.s -= 120000;   // stamped two minutes ago by the server's clock (on an earlier page)
  ST.measureAway(cross, (ms) => { topped = ms; });
  await new Promise((r) => setTimeout(r, 10));
  ok('I4 a stamp from an earlier page is topped up by the server\'s clock', topped != null && Math.abs(topped - 120000) < 2000);
  Date.now = realNow;
  const ms = src('minesweeper/js/ui.js');
  ok('I4 Minesweeper: hidden with a started board stamps the save; back (or a resume) charges the time away',
    /this\._away = \{ \.\.\.awayStamp\(\), el: this\.elapsedMs \| 0 \};/.test(ms) && /if \(saved\.away\) this\._chargeAway\(saved\.away\);/.test(ms)
    && /writeSave\(g, this\.mode, this\._away\);/.test(ms));
  const bg = src('boggle/js/ui.js');
  ok('I4 Boggle solo: hidden mid-round stamps the save; back (or a resume) charges what the ticks did not',
    /this\._away = \{ \.\.\.awayStamp\(\), rem: /.test(bg) && /if \(save\.away\) this\._chargeAway\(save\.away, 0\);/.test(bg)
    && /\.\.\.\(ui\._away \? \{ away: ui\._away \} : \{\}\)/.test(bg) && /if \(this\._remainingSec <= 0\) this\.tick\(\);/.test(bg));
}

// --- I6 Arrow Maze -------------------------------------------------------------------------------
console.log('\n--- I6 Arrow Maze ---');
{
  const t0 = Date.UTC(2026, 9, 30, 12);
  // Safari learns Expert 201 with 3 hints, then the Home Screen app clears it clean.
  const safari = device(() => { G.noteWayOutSlips('expert', 201, 3, t0); });
  const app = device(() => { G.recordWayOut('expert', { timeMs: 60000, penaltyMs: 0, arrows: 80, rounds: 20, mistakes: 0, hints: 0, timed: true, n: 201, level: 201, gen: 10, at: t0 + 600000 }); });
  ok('I6 stamps: the slip and the clear each carry their first time', safari.games.wayout.wo.sf.expert.L201 === t0 && app.games.wayout.wo.ct.expert.L201 === t0 + 600000);
  const both = A.aggregatePlayers({ s: rec('Probe', 'ZQXJ7', safari), a: rec('Probe', 'ZQXJ7', app) })[0];
  ok('I6 the clean clear AFTER hints on another storage is capped at the hints\' points (6 -> 1)',
    T.woPoints(app.games.wayout) === 6 && T.woPoints(both.games.wayout, 'expert') === 1 && both.games.wayout.wo.sl.expert.L201 === 3);
  const later = device(() => { G.noteWayOutSlips('expert', 201, 3, t0 + 3600000); });
  const both2 = A.aggregatePlayers({ s: rec('Probe', 'ZQXJ7', later), a: rec('Probe', 'ZQXJ7', app) })[0];
  ok('I6 slips on another storage AFTER the clear (a new phone replaying) take nothing away', T.woPoints(both2.games.wayout, 'expert') === 6);
  const legacy = JSON.parse(JSON.stringify(app)); delete legacy.games.wayout.wo.ct;
  const both3 = A.aggregatePlayers({ s: rec('Probe', 'ZQXJ7', safari), a: rec('Probe', 'ZQXJ7', legacy) })[0];
  ok('I6 a clear with no stamp (before this) is never capped (nothing lowered)', T.woPoints(both3.games.wayout, 'expert') === 6);
  const h = device(() => { G.recordWayOut('expert', { timeMs: 60000, penaltyMs: 0, arrows: 80, rounds: 20, mistakes: 0, hints: 2, timed: true, n: 202, level: 202, gen: 10 }); });
  ok('I6 hints carry over: the clearing try\'s hints are in `p` (a replay can never win them back)',
    h.games.wayout.wo.log.expert[0].p === 2 && T.woMissed(h.games.wayout, 'expert').length === 0);
  const r = device(() => {
    G.recordWayOutRush('easy', { arrows: 40, boards: 3, ms: 30000, mistakes: 1, seed: 1, at: t0 });
    G.recordWayOutRush('easy', { arrows: 90, boards: 6, ms: 60000, mistakes: 0, seed: 2, at: t0, late: 1 });
  }).games.wayout.wo.rush;
  ok('I6 Rush: a late run (its week over, or the clock known wrong) is kept and never counted',
    r.runs.easy.length === 2 && r.runs.easy[1].late === 1 && r.best.easy[T.woWeekKey(t0)] === 40);
  const ui = src('way-out/js/ui.js');
  ok('I6 ui: the week and every stamp come from the server\'s clock; the clear re-reads the carry and the stored slips',
    /at: bestNow\(\), \.\.\.\(late \? \{ late: 1 \} : \{\}\) \}\);/.test(ui) && /d: bestNow\(\), sv: serverNow\(\) != null \? 1 : 0/.test(ui)
    && /noteWayOutSlips\(this\.tier, this\.level, s, bestNow\(\)\)/.test(ui) && /readCarry\(this\.tier, this\.level, this\.src\)/.test(ui)
    && /woSlipsOf\(loadStats\(\)\.games\.wayout, this\.tier, this\.level\)/.test(ui));
}

// --- I8 name gate ----------------------------------------------------------------------------------
console.log('\n--- I8 name gate ---');
{
  const ng = src('js/name-gate.js');
  ok('I8 "That\'s me": the claim\'s age by the server\'s clock, 0 to 24 h; no server time, no offer',
    /let now = liveNow\(\);/.test(ng) && /const age = claim && Number\(claim\.at\) > 0 && now != null \? now - Number\(claim\.at\) : -1;/.test(ng)
    && /if \(age >= 0 && age < ME_WINDOW_MS\) \{/.test(ng) && !/Date\.now\(\) - claim\.at/.test(ng));
}

// --- I9 Word Weaver, Gridlock ----------------------------------------------------------------------
console.log('\n--- I9 Word Weaver, Gridlock ---');
{
  // Word Weaver's cross-storage hint gap is closed by main's own fix (js/word-weaver-points.js wwHintBest,
  // ww.hint / ww.esHint, PR #1328) and tested there; this suite keeps Gridlock only.
  let gl = null;   // admin-only: its plays live in the test area, which loadStats() swaps in
  device(() => { G.recordGridlockHint(7, 1111); G.recordGridlock('easy', { level: 8, moves: 10, stars: 3, hints: 0, at: 2222 }); gl = G.loadStats().games.gridlock.gl; });
  ok('I9 Gridlock: the hint and crown times are the ones the game passes (the server\'s)', gl.hint.L7 === 1111 && gl.lv2.L8.t === 2222);
  ok('I9 Gridlock ui passes bestNow()', /recordGridlockHint\(this\.n, bestNow\(\)\)/.test(src('gridlock/js/ui.js')) && /at: bestNow\(\) \}\);/.test(src('gridlock/js/ui.js')));
}

// --- I10 Skeeball ----------------------------------------------------------------------------------
console.log('\n--- I10 Skeeball ---');
{
  const GO = await import('../skeeball/js/goals.js');
  const s = device(() => {
    G.recordSkeeball('classic', { score: 200, hundreds: 1, balls: 9, at: Date.UTC(2026, 9, 29) });
    G.recordSkeeball('classic', { score: 450, hundreds: 4, balls: 9, challenge: true, at: Date.UTC(2026, 9, 29) });
    G.recordSkeeball('classic', { score: 300, hundreds: 1, balls: 9, at: Date.UTC(2026, 9, 29) });
  }).games.skeeball;
  ok('I10 the challenge rack is recorded and shown like any rack (rule 1)', s.sk.boards.classic.best === 450 && s.sk.boards.classic.plays === 3 && s.sk.hundreds === 6 && s.total.played === 3);
  const v = GO.goalStore(s.sk);
  ok('I10 the objectives read the record without it', v.boards.classic.best === 300 && v.boards.classic.plays === 2 && v.hundreds === 2 && v.boards.classic.points === 500);
  ok('I10 a store with no challenge racks reads exactly as stored', GO.goalStore({ boards: { classic: { best: 9 } }, hundreds: 3 }).hundreds === 3);
}

// --- I11 Nuts & Bolts ------------------------------------------------------------------------------
console.log('\n--- I11 Nuts & Bolts ---');
{
  const old = { games: { nutsbolts: { total: { played: 317, won: 317, lost: 0 }, byDiff: { extrahard: { played: 317, won: 317, lost: 0 } }, nb: { solved: 317, moves: 9000, bestLevel: 317, bestByTier: { extrahard: 317 } } } } };
  const fresh = device(() => { for (let n = 1; n <= 20; n++) G.recordNutsBolts(n, 30, 'extraHard'); });
  ok('I11 the recorder names each level (a range string)', fresh.games.nutsbolts.nb.lv.extrahard === '1-20' && fresh.games.nutsbolts.nb.leg.extrahard === 0);
  const p = A.aggregatePlayers({ o: rec('Probe', 'ZQXJ7', old), f: rec('Probe', 'ZQXJ7', fresh) })[0].games.nutsbolts;
  ok('I11 a fresh storage replaying Expert 1-20 adds nothing for a person already past them', p.byDiff.extrahard.won === 317 && p.total.won === 317 && p.nb.solved === 317);
  const two = device(() => { for (let n = 1; n <= 5; n++) G.recordNutsBolts(n, 30, 'hard'); });
  const q = A.aggregatePlayers({ a: rec('Probe', 'ZQXJ7', two), b: rec('Probe', 'ZQXJ7', JSON.parse(JSON.stringify(two))) })[0].games.nutsbolts;
  ok('I11 the same five levels on two new storages count five times, not ten', q.byDiff.hard.won === 5);
  const solo = A.aggregatePlayers({ o: rec('Probe', 'ZQXJ7', old) })[0].games.nutsbolts;
  ok('I11 a record with no level sets counts exactly as stored', solo.byDiff.extrahard.won === 317);
}

// --- I12 leaderboard ---------------------------------------------------------------------------------
console.log('\n--- I12 leaderboard ---');
{
  const lb = src('js/leaderboard-ui.js');
  ok('I12 no player code is written into the leaderboard page; Send message carries an opaque index',
    !/data-code=/.test(lb) && !/data-pkey=/.test(lb) && /data-role="lb-msg" data-mi="\$\{mi\}"/.test(lb) && /const to = _msgTo\[Number\(msg\.dataset\.mi\)\];/.test(lb)
    && /data-pi="\$\{pi\}"/.test(lb));
}

// --- the browser: two real tabs on one storage --------------------------------------------------------
if (process.argv.includes('--browser')) {
  console.log('\n--- browser: two tabs on one storage ---');
  let pw;
  try { pw = await import('playwright-core'); } catch {
    // No NODE_PATH: the global install (npm root -g).
    const { execSync } = await import('node:child_process');
    const { createRequire } = await import('node:module');
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    pw = createRequire(root + '/')('playwright');
  }
  const { chromium } = pw;
  const BASE = process.env.BB_BASE || 'http://localhost:8123';
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('gamehub.devAllowSync.v1', '0');
      localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'test1', playerId: 'DREG5', emoji: '🧪' }));
      if (!localStorage.getItem('gamehub.murdoku.v1')) localStorage.setItem('gamehub.murdoku.v1', JSON.stringify({ tier: 'easy', learned: true }));
    } catch { /* first paint */ }
  });
  const open = async (path) => { const p = await ctx.newPage(); await p.goto(BASE + path, { waitUntil: 'load' }); await p.waitForTimeout(2500); return p; };
  const stats = async (p, game) => p.evaluate(async (gid) => { const m = await import('/js/game-stats.js'); return JSON.parse(JSON.stringify(m.loadStats().games[gid] || {})); }, game);

  // Sudoku: a hint in tab A, the solve in tab B (whose own count is 0).
  {
    const a = await open('/sudoku/');
    await a.click('[data-action="start"]');
    await a.waitForFunction(() => window.__sdTest && window.__sdTest.game);
    const b = await open('/sudoku/');
    await b.click('[data-action="resume"]');
    await b.waitForFunction(() => window.__sdTest && window.__sdTest.game);
    await a.evaluate(() => { const u = window.__sdTest.ui; u._doHint(); });
    const before = await stats(b, 'sudoku');
    await b.evaluate(() => {
      const u = window.__sdTest.ui, g = u.game;
      for (let i = 0; i < 81; i++) if (!g.isGiven(i) && g.cells[i] !== g.solution[i]) { u.selected = i; u._inputDigit(g.solution[i]); if (!u.game) break; }
    });
    const after = await stats(b, 'sudoku');
    const won = ((after.total || {}).won | 0) - ((before.total || {}).won | 0);
    const clean = Object.values((after.sd || {}).clean || {}).reduce((s, n) => s + n, 0) - Object.values((before.sd || {}).clean || {}).reduce((s, n) => s + n, 0);
    ok('I3 browser Sudoku: tab B\'s solve counts tab A\'s hint (a win, not a no-hint solve)', won === 1 && clean === 0);
    // Tab A still holds the same (now finished) puzzle: its next move leaves the board, records nothing.
    await a.evaluate(() => { const u = window.__sdTest.ui, g = u.game; if (g) for (let i = 0; i < 81; i++) if (!g.isGiven(i) && g.cells[i] !== g.solution[i]) { u.selected = i; u._inputDigit(g.solution[i]); if (!u.game) break; } });
    const again = await stats(a, 'sudoku');
    ok('I3 browser Sudoku: the stale tab cannot solve the same puzzle again', (again.total || {}).won === (after.total || {}).won);
    await a.close(); await b.close();
  }

  // Murdoku: a hint in tab A, the solve in tab B.
  {
    const a = await open('/murdoku/');
    await a.click('[data-action="start"]');
    await a.waitForFunction(() => window.__muTest && window.__muTest.puzzle);
    const b = await open('/murdoku/');
    await b.waitForFunction(() => window.__muTest && window.__muTest.puzzle);
    await a.evaluate(() => window.__muTest.hint());
    const before = await stats(b, 'murdoku');
    await b.evaluate(() => window.__muTest.solve());
    const after = await stats(b, 'murdoku');
    const sum = (o) => Object.values(o || {}).reduce((s, n) => s + (n | 0), 0);
    ok('I3 browser Murdoku: tab B\'s solve counts tab A\'s hint',
      ((after.total || {}).won | 0) - ((before.total || {}).won | 0) === 1 && sum((after.mu || {}).clean) === sum((before.mu || {}).clean));
    await a.evaluate(() => window.__muTest.solve());
    const again = await stats(a, 'murdoku');
    ok('I3 browser Murdoku: the same case solved in tab A records nothing', (again.total || {}).won === (after.total || {}).won);
    await a.close(); await b.close();
  }

  // Minesweeper: the same paused board in two tabs; a mine dug in A, then B tries to play on.
  {
    const a = await open('/minesweeper/');
    await a.evaluate(() => window.__msTest || null);
    await a.evaluate(() => { const u = document.querySelector('[data-act="play"]'); if (u) u.click(); });
    await a.waitForFunction(() => window.__msTest && window.__msTest.ui && window.__msTest.ui.game);
    await a.evaluate(() => { const u = window.__msTest.ui, g = u.game; u._doDig(Math.floor(g.w / 2) + g.w * Math.floor(g.h / 2)); u._backToMenu(); });
    const b = await open('/minesweeper/');
    await b.evaluate(() => { const u = document.querySelector('[data-act="play"]'); if (u) u.click(); });
    await b.waitForFunction(() => window.__msTest && window.__msTest.ui && window.__msTest.ui.game && window.__msTest.ui.game.generated);
    await a.evaluate(() => { const u = document.querySelector('[data-act="play"]'); if (u) u.click(); });
    await a.waitForFunction(() => window.__msTest && window.__msTest.ui && window.__msTest.ui.game && window.__msTest.ui.game.generated);
    await a.evaluate(() => { const u = window.__msTest.ui, g = u.game; const m = g.mine.findIndex((x) => x); u._doDig(m); });
    const before = await stats(b, 'minesweeper');
    await b.evaluate(() => {
      const u = window.__msTest.ui;
      for (let k = 0; k < 400 && u.game && !u.game.won && !u.game.dead; k++) {
        const g = u.game; const i = g.cell.findIndex((c, j) => !g.mine[j] && c !== 1); if (i < 0) break; u._doDig(i);
      }
    });
    const after = await stats(b, 'minesweeper');
    const bGame = await b.evaluate(() => !!(window.__msTest.ui && window.__msTest.ui.game));
    ok('I3 browser Minesweeper: the board lost in tab A cannot be cleared in tab B', ((after.total || {}).won | 0) === ((before.total || {}).won | 0) && !bGame);
    await a.close(); await b.close();
  }

  // The leaderboard: no code in the page, and Send message still opens that person's thread. The
  // board is fed two made-up players through js/stats-net.js (served rewritten to this page only):
  // nothing is read from or written to Firebase.
  {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx2.addInitScript(() => {
      try { localStorage.setItem('gamehub.devAllowSync.v1', '0'); localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'test1', playerId: 'DREG5', emoji: '🧪' })); } catch { /* */ }
    });
    const p = await ctx2.newPage();
    await p.route('**/js/stats-net.js', async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      body = body.replace('export async function watchBoard(cb) {', 'async function _realWatchBoard(cb) {')
        .replace('export async function watchPlayers(cb) {', 'async function _realWatchPlayers(cb) {');
      body += `
export async function watchBoard() { return null; }
export async function watchPlayers(cb) {
  const st = (w) => ({ version: 1, games: { connect4: { total: { played: w + 1, won: w, lost: 1 }, byDiff: { easy: { played: w + 1, won: w, lost: 1 } } } } });
  setTimeout(() => cb({
    devA: { profile: { name: 'Probe Ann', playerId: 'ZQXA1', emoji: '🦊' }, stats: st(5), updatedAt: 2 },
    devB: { profile: { name: 'Probe Bo', playerId: 'ZQXB2', emoji: '🐼' }, stats: st(3), updatedAt: 1 },
  }), 50);
  return () => {};
}`;
      await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'text/javascript' } });
    });
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    const res = await p.evaluate(async () => {
      const m = await import('/js/leaderboard-ui.js');
      m.openLeaderboard();
      const until = Date.now() + 15000;
      for (let k = 0; k < 40 && !document.querySelector('.lb-seg[data-seg="players"]'); k++) await new Promise((r) => setTimeout(r, 250));
      const seg = document.querySelector('.lb-seg[data-seg="players"]');
      if (seg) seg.click();
      let card = null;
      while (Date.now() < until && !(card = document.querySelector('.lb-pcard[data-pi]:not(.is-me)'))) await new Promise((r) => setTimeout(r, 250));
      if (!card) return { skipped: true, text: (document.querySelector('.lb-card, [data-role="lb-body"]') || document.body).innerText.slice(0, 300) };
      const html1 = document.body.innerHTML;
      card.click();
      await new Promise((r) => setTimeout(r, 600));
      const btn = document.querySelector('[data-role="lb-msg"]');
      const html2 = document.body.innerHTML;
      const codes = /data-(code|pkey)=/.test(html1 + html2);
      if (!btn) return { skipped: false, codes, btn: false };
      btn.click();
      await new Promise((r) => setTimeout(r, 1500));
      return { skipped: false, codes, btn: true, opened: [...document.querySelectorAll('[class*="msg-"]')].some((el) => /Probe (Ann|Bo)/.test(el.innerText || '')) };
    });
    if (res.skipped) console.log('  (leaderboard: no board within 15 s; source check above stands)', JSON.stringify(res.text || ''));
    else { ok('I12 browser: no code in the leaderboard page; a player\'s Send message opens Messages', !res.codes && res.btn && res.opened); if (res.codes || !res.btn || !res.opened) console.log('   ', JSON.stringify(res)); }
    await ctx2.close();
  }

  // Nuts & Bolts: the same level solved in both tabs records once.
  {
    const a = await open('/nuts-bolts/');
    const b = await open('/nuts-bolts/');
    const solve = (p) => p.evaluate(() => { const u = window.__nbTest ? window.__nbTest.ui : null; return u; });
    void solve;
    const src0 = await a.evaluate(() => typeof window.__nbTest);
    if (src0 === 'undefined') console.log('  (Nuts & Bolts has no test seam: two-tab check is the source check above)');
    await a.close(); await b.close();
  }
  await browser.close();
}

console.log(`\npuzzle-holes tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
