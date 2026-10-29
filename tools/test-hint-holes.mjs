// test-hint-holes.mjs - the holes closed 2026-10-29 (docs/INTEGRITY-CHECKS-SPEC.md, "Holes closed
// 2026-10-29: Sudoku, Murdoku, Nuts & Bolts, Arrow Maze"). Run: node tools/test-hint-holes.mjs
//
//   C1  Sudoku and Murdoku: a solve with hints is a win, ranked below every no-hint solve.
//   C2  Murdoku's guided case records nothing.
//   C3  Nuts & Bolts: a level records one win, whatever Restart or reopening does.
//   C4  Arrow Maze: New game resets the clock, never the slips; a replay never pays past them.
//   C5  Arrow Maze: a level counts once per person, however many storages cleared it.
//
// Node only, no deps. Recorders run against a fake localStorage (never the real database); the
// leaderboard's order is checked by running its own functions, cut out of js/leaderboard-ui.js.

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
const R = await import('../js/leaderboard-rank.js');
const D = await import('../js/difficulty-tiers.js');

/** A fresh device: its own store, written only by the real recorders. Returns its `stats`. */
function device(play) {
  store.clear();
  play();
  return JSON.parse(store.get(G.statsKey()));
}
const rec = (name, code, stats) => ({ profile: { name, playerId: code }, stats, updatedAt: 1 });

// --- C1: Sudoku ---------------------------------------------------------------------------------
// A store the OLD writer made (rule 7): the recorder before 2026-10-29 bumped byDiff and sd only.
function oldSudoku(wins, hints) {
  const st = { version: 1, games: { sudoku: { total: { played: wins.length, won: wins.length, lost: 0 }, byDiff: {},
    sd: { solved: wins.length, perfect: 0, hints, mistakes: 0, bestTimeMs: {} } } } };
  for (const t of wins) { const b = st.games.sudoku.byDiff[t] || (st.games.sudoku.byDiff[t] = { played: 0, won: 0, lost: 0 }); b.played++; b.won++; }
  localStorage.setItem(G.statsKey(), JSON.stringify(st));
}
let s1 = device(() => { oldSudoku(['expert', 'expert', 'easy'], 0); G.recordSudoku('hard', { timeMs: 1000, hints: 0 }); G.recordSudoku('expert', { timeMs: 1000, hints: 9 }); });
let sd = s1.games.sudoku;
ok('C1 Sudoku: the first tracked solve snapshots the legacy record once', sd.sd.pre.hints === 0 && sd.sd.pre.won.expert === 2 && sd.sd.pre.won.easy === 1);
ok('C1 Sudoku: a no-hint solve adds to clean, a hint solve does not', sd.sd.clean.hard === 1 && !sd.sd.clean.expert);
ok('C1 Sudoku: every solve is still a win (THE LAW rule 1)', sd.total.won === 5 && sd.byDiff.expert.won === 3 && sd.byDiff.hard.won === 1);
let nh = A.sdNoHintOf(sd);
ok('C1 Sudoku: legacy wins with lifetime hints 0 are proven no-hint', nh.expert === 2 && nh.easy === 1 && nh.hard === 1);
const s1b = device(() => { oldSudoku(['expert', 'expert'], 3); G.recordSudoku('easy', { hints: 0 }); });
nh = A.sdNoHintOf(s1b.games.sudoku);
ok('C1 Sudoku: legacy wins with hints used rank with hint solves (unproven)', !nh.expert && nh.easy === 1);
const s1c = device(() => { oldSudoku(['medium'], 0); });
ok('C1 Sudoku: a record never played since (no snapshot) is read the same way', A.sdNoHintOf(s1c.games.sudoku).medium === 1);
// Per record, then added: device A's proof must survive device B's hints.
let grp = A.aggregatePlayers({ a: rec('Ann', 'AAAAA', s1c), b: rec('Ann', 'AAAAA', s1b) })[0];
ok('C1 Sudoku: no-hint solves are worked out per record before a person\'s devices add', grp.games.sudoku.sd.noHint.medium === 1 && grp.games.sudoku.sd.noHint.easy === 1 && !grp.games.sudoku.sd.noHint.expert);

// --- C1: Murdoku -------------------------------------------------------------------------------
const m1 = device(() => {
  G.recordResult('murdoku', 'expert', true);                 // the old writer: unknown hints
  G.recordMurdoku('easy', { hints: 0 });
  G.recordMurdoku('expert', { hints: 4 });
  G.recordMurdoku('hard', { hints: null });
});
const mu = m1.games.murdoku;
ok('C1 Murdoku: recordMurdoku keeps total/byDiff as recordResult did', mu.total.won === 4 && mu.total.played === 4 && mu.byDiff.expert.won === 2 && mu.byDiff.hard.won === 1);
ok('C1 Murdoku: clean / hinted / unknown', mu.mu.clean.easy === 1 && mu.mu.hinted.expert === 1 && mu.mu.hints === 4 && !mu.mu.clean.hard && !mu.mu.hinted.hard);
grp = A.aggregatePlayers({ a: rec('Bo', 'BBBBB', m1), b: rec('Bo', 'BBBBB', device(() => G.recordMurdoku('easy', { hints: 0 }))) })[0];
ok('C1 Murdoku: the mu sub-counter adds across devices (players-agg branch)', grp.games.murdoku.mu.clean.easy === 2 && grp.games.murdoku.byDiff.easy.won === 2);
ok('C1 Murdoku: the stats id and GAME_META row are unchanged', /\{ id: 'murdoku', labelKey: 'game_title_murdoku' \}/.test(src('js/leaderboard-ui.js')));

// --- C1: the leaderboard's order, run from the board's own code ---------------------------------
function cut(text, name) {
  const at = text.search(new RegExp(`\\nfunction ${name}\\(`));
  if (at < 0) throw new Error('not found: ' + name);
  let i = text.indexOf('{', at), depth = 0;
  for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) break; }
  return text.slice(at, i + 1);
}
const lb = src('js/leaderboard-ui.js');
const fns = ['noHintMap', 'noHintAt', 'noHintTierOf', 'compareNoHint', 'compareAllWins', 'winsAtTier', 'playsAtTier'].map((n) => cut(lb, n)).join('\n');
const board = new Function('bucketsOf', 'tierOf', 'boardRankTier', 'compareTierFirst',
  `let _tier = null; const NOHINT_GAMES = new Set(['sudoku', 'murdoku']);\n${fns}
   return { order: (id) => (a, b) => compareNoHint(a, b, id) || compareAllWins(a, b, id), noHintAt, noHintTierOf, setTier: (t) => { _tier = t; } };`)(
  R.bucketsOf, D.tierOf, R.boardRankTier, R.compareTierFirst);
const hintKing = rec('King', 'KKKKK', device(() => { for (let i = 0; i < 25; i++) G.recordSudoku('expert', { hints: 40 }); }));
const easyClean = rec('Ella', 'EEEEE', device(() => { G.recordSudoku('easy', { hints: 0 }); }));
const hardClean = rec('Hal', 'HHHHH', device(() => { G.recordSudoku('hard', { hints: 0 }); G.recordSudoku('easy', { hints: 0 }); G.recordSudoku('easy', { hints: 0 }); }));
const hardClean2 = rec('Hana', 'NNNNN', device(() => { G.recordSudoku('hard', { hints: 0 }); G.recordSudoku('expert', { hints: 2 }); }));
const easyHint = rec('Ed', 'DDDDD', device(() => { G.recordSudoku('medium', { hints: 1 }); }));
const people = A.aggregatePlayers({ k: hintKing, e: easyClean, h: hardClean, n: hardClean2, d: easyHint });
const byName = (n) => people.find((g) => g.name === n);
const sorted = people.slice().sort(board.order('sudoku')).map((g) => g.name);
ok('C1 board: every no-hint solve ranks above every hint-only row (25 Expert hint wins rank last but one)',
  sorted.indexOf('King') > sorted.indexOf('Ella') && sorted.indexOf('King') > sorted.indexOf('Hal'));
ok('C1 board: difficulty outranks score among no-hint solves (Hard 1 over Easy 1)', sorted.indexOf('Hal') < sorted.indexOf('Ella'));
ok('C1 board: a tie on no-hint solves falls to every win, tier first (Hana\'s hinted Expert breaks it)', sorted.indexOf('Hana') < sorted.indexOf('Hal'));
ok('C1 board: hint-only rows keep the usual tier-first order (Expert hint wins over Medium)', sorted.indexOf('King') < sorted.indexOf('Ed'));
ok('C1 board: the full order', sorted.join() === 'Hana,Hal,Ella,King,Ed');
ok('C1 board: a row\'s no-hint tier and count', board.noHintTierOf(byName('Hal'), 'sudoku') === 3 && board.noHintAt(byName('Hal'), 'sudoku', 3) === 1 && board.noHintTierOf(byName('King'), 'sudoku') === 0);
board.setTier(1);
const easyTab = people.filter((g) => board.noHintAt(g, 'sudoku', null) >= 0).sort(board.order('sudoku')).map((g) => g.name);
ok('C1 board: on the Easy tab, Easy no-hint solves lead (Hal 2, Ella 1)', easyTab[0] === 'Hal' && easyTab[1] === 'Ella');
board.setTier(null);
ok('C1 board: the number shown on a no-hint row is its no-hint count (gameMetricAt), with "no hints" under it',
  /if \(NOHINT_GAMES\.has\(id\) && noHintTierOf\(g, id\)\) return noHintAt\(g, id, tier\);/.test(lb) && /return tx\('lb_nohint', 'no hints'\)/.test(lb)
  && /if \(NOHINT_GAMES\.has\(id\)\) return \(a, b\) => compareNoHint\(a, b, id\) \|\| compareAllWins\(a, b, id\);/.test(lb));
const S = (await import('../js/strings.js')).default;
ok('C1 strings: "no hints" EN/ES', S.en.lb_nohint === 'no hints' && S.es.lb_nohint === 'sin pistas');

// --- C2 / C1 (Murdoku UI) --------------------------------------------------------------------------
const mui = src('murdoku/js/ui.js');
ok('C2 Murdoku: the guided case records nothing', /_recordOnce\(s, ui\) \{\s*\n\s*if \(s\.recorded\) return;[\s\S]{0,300}?if \(s\.guided\) return;/.test(mui));
ok('C1 Murdoku: every hint tap counts and is saved', /if \(this\.hint && this\.hints !== null\) \{ this\.hints \+= 1; if \(!this\._save\(\)\) \{ this\._leaveStale\(\); return; \} \}/.test(mui)
  && /recordMurdoku\(s\.puzzle\.tier, \{ hints:/.test(mui) && !/recordResult\(/.test(mui));
ok('C1 Murdoku: a case saved before hints were counted reads as unknown (null), a new case as 0',
  /hints: Number\.isInteger\(s\.hints\) && s\.hints >= 0 \? s\.hints : null/.test(mui) && /guided, hints: 0 \}\);/.test(mui));

// --- C3: Nuts & Bolts --------------------------------------------------------------------------
const nb = src('nuts-bolts/js/ui.js');
ok('C3 Nuts & Bolts: a level records only while it is above the last recorded level of its tier',
  /if \(!this\._winRecorded && \(this\.won\[tier\] \| 0\) < level\)/.test(nb) && /this\.won\[tier\] = level;\s*\n\s*this\.persist\(\);/.test(nb));
ok('C3 Nuts & Bolts: `won` rides the save and a solved level is moved past on open',
  /won: ui\.won \|\| \{\}/.test(nb) && /won: readWon\(parsed\.won\)/.test(nb) && /this\.levels\[tier\] = this\.won\[tier\] \+ 1;/.test(nb));

// --- C5: Arrow Maze, one level one score --------------------------------------------------------
store.clear();
// Storage A: an old store (the old writer, rule 7) with Expert 201-210 cleared, two of them scored.
for (let i = 0; i < 10; i++) G.recordResult('wayout', 'expert', true);
let st = JSON.parse(store.get(G.statsKey()));
st.games.wayout.wo = { timed: { expert: 2 }, mistakes: 1, hints: 0, log: { expert: [] }, pts: { expert: 8 }, ptsN: { expert: 2 } };
localStorage.setItem(G.statsKey(), JSON.stringify(st));
const before = T.woPoints(G.loadStats().games.wayout);
ok('C5 legacy: points unchanged for a record with no level set (8 full + 8 scored = 56)', before === 56);
localStorage.removeItem('gamehub.rate.v1');
for (let n = 211; n <= 213; n++) G.recordWayOut('expert', { timeMs: 60000, arrows: 80, rounds: 20, mistakes: 0, hints: 0, timed: true, n, level: n, gen: 10 });
const devA = JSON.parse(store.get(G.statsKey()));
let wo = devA.games.wayout.wo;
ok('C5 the first tracked clear snapshots the legacy part once', wo.leg.expert.w === 10 && wo.leg.expert.n === 2 && wo.leg.expert.p === 8 && wo.leg.expert.e === 211);
ok('C5 the level set holds each level\'s points', wo.cl.expert === '211:666');
ok('C5 the device\'s own points: legacy 56 + 3 x 6', T.woPoints(devA.games.wayout) === 74);
// Storage B (same person, a fresh storage): replays the SAME levels 201-213 clean.
const devB = device(() => { for (let n = 201; n <= 213; n++) G.recordWayOut('expert', { timeMs: 60000, arrows: 80, rounds: 20, timed: true, n, level: n, gen: 10 }); });
ok('C5 storage B on its own: 13 levels, 78 points', T.woPoints(devB.games.wayout) === 78);
const person = A.aggregatePlayers({ a: rec('Kay', 'KAYKA', devA), b: rec('Kay', 'KAYKA', devB) })[0];
ok('C5 a person counts each level once: A\'s legacy 201-210 + 211-213, B adds nothing (74, not 152)', T.woPoints(person.games.wayout) === 74);
ok('C5 the merged view: legacy covers 201-210, the sets unite', JSON.stringify(person.games.wayout.wo.lg.expert.cv) === '[[201,210]]' && person.games.wayout.wo.cl.expert === '201:6666666666666');
const devB2 = device(() => { for (let n = 211; n <= 215; n++) G.recordWayOut('expert', { timeMs: 60000, arrows: 80, rounds: 20, mistakes: 1, timed: true, n, level: n, gen: 10 }); });
const person2 = A.aggregatePlayers({ a: rec('Kay', 'KAYKA', devA), b: rec('Kay', 'KAYKA', devB2) })[0];
ok('C5 a level on two storages counts once, at its best; new levels count (74 + 214, 215 at 4 = 82)', T.woPoints(person2.games.wayout) === 82);
const other = A.aggregatePlayers({ a: rec('Kay', 'KAYKA', devA), b: rec('Lu', 'LULUL', devB) });
ok('C5 two different people are never deduplicated against each other', other.map((g) => T.woPoints(g.games.wayout)).sort().join() === '74,78');
const oldOnly = A.aggregatePlayers({ a: rec('Mo', 'MOMOM', { games: { wayout: { total: { played: 4, won: 4, lost: 0 }, byDiff: { hard: { played: 4, won: 4, lost: 0 } } } } }) })[0];
ok('C5 a record with wins but no `wo` at all still counts in full (16)', T.woPoints(oldOnly.games.wayout) === 16);
ok('C5 a voided record zeroes its level set and snapshot too', /wayout: \{ wo: \['pts', 'log', 'replay', 'best', 'recent', 'rush', 'cl', 'leg'\] \}/.test(src('js/stats-corrections.js')));
ok('C5 level sets: max per level, compact', T.woClSet(T.woClSet('', 205, 2), 205, 6) === '205:6' && T.woClMerge('201:6', '203:24') === '201:6024' && T.woClSet('201:6', 'x', 3) === '201:6');

// --- C4: Arrow Maze, slips stay with the level ---------------------------------------------------
store.clear();
G.recordWayOut('expert', { timeMs: 60000, arrows: 80, rounds: 20, mistakes: 0, hints: 0, timed: true, n: 201, level: 201, gen: 10, slips: 3, prior: 3 });
let gw = G.loadStats().games.wayout;
const f = gw.wo.log.expert[0];
ok('C4 a clean try after New game is scored with the carried slips (3 -> 1 point)', gw.wo.pts.expert === 1 && f.m === 0 && f.h === 0 && f.s === 3 && f.p === 3 && gw.wo.cl.expert === '201:1');
let miss = T.woMissed(gw, 'expert');
ok('C4 a replay can never win back slips from before the clearing try (nothing to replay)', miss.length === 0);
G.recordWayOut('expert', { timeMs: 60000, arrows: 80, rounds: 20, mistakes: 1, hints: 0, timed: true, n: 202, level: 202, gen: 10, slips: 1, prior: 0 });
gw = G.loadStats().games.wayout;
miss = T.woMissed(gw, 'expert');
ok('C4 a level messed up in its own clearing try is still listed for Replay (Matt\'s design)', miss.length === 1 && miss[0].n === 202 && miss[0].gain === 2);
const up1 = G.recordWayOutReplay('expert', { timeMs: 60000, arrows: 80, rounds: 20, mistakes: 0, hints: 0, level: 202, gen: 10, slips: 2 });
ok('C4 a replay is scored with the slips of its earlier tries (2 carried: 2 points, adds nothing)', up1 === 0);
const up2 = G.recordWayOutReplay('expert', { timeMs: 60000, arrows: 80, rounds: 20, mistakes: 0, hints: 0, level: 202, gen: 10, slips: 0 });
gw = G.loadStats().games.wayout;
ok('C4 a clean replay wins back what the clearing try lost, in the level set too', up2 === 2 && gw.wo.cl.expert === '201:16');
ok('C4 noteWayOutSlips keeps the most slips per level (max only)', G.noteWayOutSlips('expert', 300, 2) === true && G.noteWayOutSlips('expert', 300, 1) === true
  && G.loadStats().games.wayout.wo.sl.expert.L300 === 2 && T.woSlipsOf(G.loadStats().games.wayout, 'expert', 300) === 2);
ok('C4 noteWayOutSlips refuses junk', G.noteWayOutSlips('rush', 3, 1) === false && G.noteWayOutSlips('expert', 0, 1) === false);
const ui = src('way-out/js/ui.js');
ok('C4 New game carries the thrown-away try\'s slips; it resets only the clock',
  /if \(c && c\.n === level && c\.key === srcKey\(src\)\) addCarry\(tier, level, src, \(c\.mistakes \| 0\) \+ \(c\.hints \| 0\)\);/.test(ui));
ok('C4 every hint and lost heart is stored at once', (ui.match(/this\._noteSlip\(\);/g) || []).length === 2);
ok('C4 the clear is scored with max(carried + this try, other storages, this storage\'s stored slips from another tab)',
  /const mine = \(this\._carry \| 0\) \+ \(c\.mistakes \| 0\) \+ \(c\.hints \| 0\);/.test(ui) && /const slips = Math\.max\(mine, other, elsewhere\);/.test(ui)
  && /this\._carry = Math\.max\(this\._carry \| 0, readCarry\(this\.tier, this\.level, this\.src\)\);/.test(ui) && /woEarnedPoints\(this\.tier, slips\)/.test(ui));
ok('C4 a replay\'s slips ride its Restart and leaving until a replay of it is cleared',
  /this\._replayCarry = readReplaySlips\(band, miss\.n\);/.test(ui) && /slips: this\._slipsNow\(\) \}\);/.test(ui) && /else clearReplaySlips\(this\.tier, this\.level\);/.test(ui));

console.log(`\nhint-holes tests: ${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
