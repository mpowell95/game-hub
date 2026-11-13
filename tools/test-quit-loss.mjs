// tools/test-quit-loss.mjs - the holes closed 2026-10-29 (docs/INTEGRITY-CHECKS-SPEC.md, "Holes closed
// 2026-10-29: quitting and easier settings"). Run: node tools/test-quit-loss.mjs [--browser]
//
//   Q1  js/game-stats.js: easiestDiff / oneTierDown (the bucket choices), and the quit-loss marker
//       (armQuitLoss / takeQuitLoss / dropQuitLoss / settleQuitLosses): a quit after the first move
//       records exactly ONE loss through the game's own recorder; nothing armed = nothing recorded;
//       the real result drops it; another player's marker is left alone; a fresh marker survives the
//       hub's 30-minute settle.
//   Q2  js/game-stats-global.js (Monopoly Deal, Parchis): the same 30-a-minute rate gate as the ESM
//       recorders, the play log entry, a queued backlog not gated, and the classic quit marker
//       (taken once, readable by the ESM settle).
//   Q3  every game's bucket rule, cut out of its own source and run: easiest computer (Escoba,
//       Chinchon, Parchis), shortened matches one step down (Chinchon, Dominoes, Boggle, Darts, Flick
//       Soccer, Pool, Cup Pong), the lowest tier stays the lowest, and each game's "has the player
//       moved" rule (Darts, Flick Soccer, Filler, Tic Tac Toe, Dots and Boxes).
//   Q4  wiring: each game's quit routes call its quit-loss path, each guard is the game's own one-shot
//       flag, no-resume games take the marker in destroy() and init(), the hub settles markers and
//       says "Counts as a loss" on its leave confirm, every new string exists in EN and ES.
//   Q5  (--browser, needs `node server.mjs`): Connect Four, Tic Tac Toe, Dots and Boxes,
//       Minesweeper and Yahtzee in a real page: a quit before the first move records nothing, after
//       it exactly one loss; leaving a game that saves (destroy) records nothing and resumes; Yahtzee
//       (saves since 2026-11-06) records nothing on leaving and one loss for New game over its save.
//
// Node only for Q1-Q4, no deps, a fake localStorage (never the real database). Q5 uses a made-up
// player code with gamehub.devAllowSync.v1 = '0' (root CLAUDE.md: never Matt's name or code).

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name, extra); } };
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
const stats = () => JSON.parse(store.get(G.statsKey()) || 'null');
const profile = (code) => store.set('gamehub.profile', JSON.stringify({ version: 1, name: 'zzztest', playerId: code }));

// --- Q1: the shared helpers -------------------------------------------------------------------------
const L3 = ['easy', 'medium', 'hard'];
ok('Q1 easiestDiff: a Hard and an Easy computer record as Easy', G.easiestDiff(['hard', 'easy'], L3, 'medium') === 'easy');
ok('Q1 easiestDiff: unknown ids are ignored, none known = fallback', G.easiestDiff(['x', 'y'], L3, 'medium') === 'medium' && G.easiestDiff(['x', 'hard'], L3, 'medium') === 'hard');
ok('Q1 oneTierDown: Hard -> Medium, Medium -> Easy', G.oneTierDown('hard', L3) === 'medium' && G.oneTierDown('medium', L3) === 'easy');
ok('Q1 oneTierDown: the lowest stays the lowest; an unknown id is unchanged', G.oneTierDown('easy', L3) === 'easy' && G.oneTierDown('mp', L3) === 'mp');

store.clear(); profile('TQWX7');
ok('Q1 nothing armed: takeQuitLoss records nothing', G.takeQuitLoss('yahtzee') === false && !stats());
G.armQuitLoss('yahtzee', 'recordYahtzee', ['ai', false, { yahtzees: 1, score: 120 }]);
ok('Q1 armed: the marker is there', G.quitLossArmed('yahtzee'));
ok('Q1 a quit takes it once', G.takeQuitLoss('yahtzee') === true && G.takeQuitLoss('yahtzee') === false);
let s = stats();
ok('Q1 exactly ONE loss, through the game\'s own recorder (sub-counter too)',
  s.games.yahtzee.total.played === 1 && s.games.yahtzee.total.lost === 1 && s.games.yahtzee.byDiff.ai.lost === 1 && s.games.yahtzee.yz && s.games.yahtzee.yz.played === 1);
const log = JSON.parse(store.get('gamehub.playlog.v1') || '[]');
ok('Q1 the play log says it was a quit', log.some((x) => x.f === 'quitLoss' && x.g === 'yahtzee') && log.some((x) => x.f === 'recordYahtzee'));

store.clear(); profile('TQWX7');
G.armQuitLoss('cuppong', 'recordCupPong', ['medium', false, 1]);
G.dropQuitLoss('cuppong');
ok('Q1 the real result drops the marker: nothing more is taken', G.takeQuitLoss('cuppong') === false && !stats());
G.armQuitLoss('cuppong', 'recordCupPong', ['medium', false, 1]);
G.recordCupPong('medium', true, 0); G.dropQuitLoss('cuppong');
s = stats();
ok('Q1 a finished game counts once, as its real result', s.games.cuppong.total.played === 1 && s.games.cuppong.total.won === 1);
G.armQuitLoss('nope', 'recordNope', []);
ok('Q1 an unknown recorder is never armed', !G.quitLossArmed('nope'));

store.clear(); profile('TQWX7');
G.armQuitLoss('hoops4', 'recordResult', ['hoops4', 'hard', false]);
G.settleQuitLosses(30 * 60 * 1000);
ok('Q1 the hub settle leaves a fresh marker (a game may be open in another tab)', G.quitLossArmed('hoops4') && !stats());
const q = JSON.parse(store.get('gamehub.quitLoss.v1')); q.hoops4.t -= 31 * 60 * 1000; store.set('gamehub.quitLoss.v1', JSON.stringify(q));
G.settleQuitLosses(30 * 60 * 1000);
s = stats();
ok('Q1 a marker over 30 minutes old (a closed app) is the game\'s loss', !G.quitLossArmed('hoops4') && s.games.hoops4.byDiff.hard.lost === 1 && s.games.hoops4.total.played === 1);

store.clear(); profile('TQWX7');
G.recordResult('uno', 'easy', true);   // the first code owns gamehub.stats
G.armQuitLoss('airhockey', 'recordAirHockey', ['hard', false, { goalsFor: 2, goalsAgainst: 5, shot: 0 }]);
profile('FGHJK');                       // another player takes the phone
ok('Q1 another player\'s armed loss is never taken into this store', G.takeQuitLoss('airhockey') === false && G.quitLossArmed('airhockey'));
profile('TQWX7');
ok('Q1 its owner takes it', G.takeQuitLoss('airhockey') === true && stats().games.airhockey.total.lost === 1);

// --- Q2: the classic recorder ------------------------------------------------------------------------
store.clear(); profile('TQWX7');
const ctx = { localStorage: globalThis.localStorage, console: { warn() {}, error() {}, log() {} }, Date, JSON, isFinite };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(src('js/game-stats-global.js'), ctx);
const GS = ctx.__ghStats;
for (let i = 0; i < 31; i++) GS.record('business', 'hard', i % 2 === 0);
s = stats();
const rate = JSON.parse(store.get('gamehub.rate.v1'));
ok('Q2 the classic port gates at 30 a minute, like the ESM recorders', s.games.business.total.played === 30 && rate.blocked.business.n === 1);
const plog = JSON.parse(store.get('gamehub.playlog.v1') || '[]');
ok('Q2 every accepted result is in the play log (game, recorder, arguments, player code)',
  plog.filter((x) => x.g === 'business' && x.f === 'record').length === 30 && plog[0].c === 'TQWX7' && JSON.parse(plog[0].a)[1] === 'hard');
store.set('gamehub.bd.pendingStats.v1', JSON.stringify([{ game: 'business', diff: 'easy', won: false }, { game: 'business', diff: 'easy', won: true }]));
vm.runInContext(src('js/game-stats-global.js'), ctx);   // a page load drains the queue
ok('Q2 a queued backlog is drained past the gate (it is not a burst of play)', stats().games.business.total.played === 32);
store.clear(); profile('TQWX7');
GS.armQuit('business', 'normal');
ok('Q2 the classic marker is the same marker the ESM side reads', G.quitLossArmed('business'));
ok('Q2 a quit takes it once', GS.takeQuit('business') === true && GS.takeQuit('business') === false);
s = stats();
ok('Q2 one Monopoly Deal loss at the game\'s difficulty', s.games.business.total.lost === 1 && s.games.business.byDiff.normal.lost === 1 && s.games.business.total.played === 1);
GS.armQuit('parchis', 'beginner');
q.dummy = 1;
const qm = JSON.parse(store.get('gamehub.quitLoss.v1')); qm.parchis.t -= 40 * 60 * 1000; store.set('gamehub.quitLoss.v1', JSON.stringify(qm));
G.settleQuitLosses(30 * 60 * 1000);
ok('Q2 a classic page that died mid-game is settled by the hub', stats().games.parchis.byDiff.beginner.lost === 1);
const bd = src('business-deal/js/game-stats-global.js');
const marker = '// ---- everything below is the canonical file, verbatim ----\n//\n';
ok('Q2 the Monopoly Deal copy is the canonical file verbatim after its header', bd.slice(bd.indexOf(marker) + marker.length) === src('js/game-stats-global.js'));

// --- Q3: each game's bucket rule, cut from its own source ----------------------------------------------
/** The text of `function <name>(...) {...}` in `code`, brace-matched. */
function cut(code, name) {
  const at = code.search(new RegExp(`(export\\s+)?function\\s+${name}\\s*\\(`));
  if (at < 0) throw new Error(`no function ${name}`);
  let i = code.indexOf('{', code.indexOf(')', at)), depth = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}' && --depth === 0) return code.slice(at, j + 1).replace(/^export\s+/, '');
  }
  throw new Error(`unbalanced ${name}`);
}
function load(file, names, extra = {}) {
  const code = src(file);
  const env = { oneTierDown: G.oneTierDown, easiestDiff: G.easiestDiff, ...extra };
  const fns = names.map((n) => cut(code, n)).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(...Object.keys(env), `${fns}\nreturn { ${names.join(', ')} };`)(...Object.values(env));
}
const cc = load('chinchon/js/ui.js', ['isShortMatch', 'soloDiff'], { DIFF_LADDER: ['easy', 'normal', 'hard'] });
const base = { victoryCondition: 'points', scoreLimit: 100, roundsLimit: 10 };
const ccPlayers = [{ isHuman: true }, { difficulty: 'hard' }, { difficulty: 'normal' }, { difficulty: 'hard' }];
ok('Q3 Chinchon: a table records at its EASIEST computer', cc.soloDiff(ccPlayers, base) === 'normal');
ok('Q3 Chinchon: 1 hand (rounds 1) is one step down', cc.isShortMatch({ ...base, victoryCondition: 'rounds', roundsLimit: 1 }) && cc.soloDiff(ccPlayers, { ...base, victoryCondition: 'rounds', roundsLimit: 1 }) === 'easy');
ok('Q3 Chinchon: a 50-point limit is short, 100 and up is not', cc.isShortMatch({ ...base, scoreLimit: 50 }) && !cc.isShortMatch(base) && !cc.isShortMatch({ ...base, scoreLimit: 150 }));
ok('Q3 Chinchon: an Easy table stays Easy when short', cc.soloDiff([{ isHuman: true }, { difficulty: 'easy' }], { ...base, scoreLimit: 30 }) === 'easy');
const eb = load('escoba/js/ui.js', ['soloDiff']);
ok('Q3 Escoba: a Hard and an Easy computer record as Easy (was the first computer: Hard)', eb.soloDiff([{ isHuman: true }, { difficulty: 'hard' }, { difficulty: 'easy' }]) === 'easy');
ok('Q3 Escoba: one computer records at its own tier', eb.soloDiff([{ isHuman: true }, { difficulty: 'hard' }]) === 'hard');
const pa = src('parchis/index.html');
const pf = new Function(`${cut(pa, 'parchisStatsDiff')}\nreturn parchisStatsDiff;`)();
ok('Q3 Parchis: the EASIEST computer (was the hardest)', pf({ anchor: 'amarillo', humans: ['amarillo'], active: ['amarillo', 'azul', 'rojo'], skills: { azul: 'pro', rojo: 'beginner' } }) === 'beginner');
const dm = load('dominoes/js/ui.js', ['statsDiff']);
ok('Q3 Dominoes: a race to 150 is one step down; 300 and 500 are not', dm.statsDiff('hard', 150) === 'medium' && dm.statsDiff('hard', 300) === 'hard' && dm.statsDiff('hard', 500) === 'hard' && dm.statsDiff('easy', 150) === 'easy');
const bg = load('boggle/js/ui.js', ['statsDiff'], { DIFFICULTIES: ['beginner', 'intermediate', 'pro'] });
ok('Q3 Boggle: the 2-minute timer is one step down; 1 and 1.5 are not', bg.statsDiff('pro', 2) === 'intermediate' && bg.statsDiff('pro', 1.5) === 'pro' && bg.statsDiff('pro', 1) === 'pro' && bg.statsDiff('beginner', 2) === 'beginner');
const dt = load('darts/js/ui.js', ['statsDiff', 'playerThrew'], { DIFFS_LADDER: L3 });
ok('Q3 Darts: 201 and 101 are one step down; 301 and Cricket are not', dt.statsDiff('hard', '201') === 'medium' && dt.statsDiff('hard', '101') === 'medium' && dt.statsDiff('hard', '301') === 'hard' && dt.statsDiff('hard', 'cricket') === 'hard');
ok('Q3 Darts (second pass): quitting costs once ANYBODY has thrown, the computer\'s opening dart included',
  !dt.playerThrew({ turn: 0, darts: [], turns: 0, starter: 0 }) && dt.playerThrew({ turn: 0, darts: [{}], turns: 0, starter: 0 })
  && dt.playerThrew({ turn: 1, darts: [{}], turns: 0, starter: 1 }) && dt.playerThrew({ turn: 0, darts: [], turns: 1, starter: 1 }));
const fs = load('flick-soccer/js/ui.js', ['statsDiff', 'playerShot']);
ok('Q3 Flick Soccer: first to 1 is one step down; 2 and 3 are not', fs.statsDiff('hard', 1) === 'medium' && fs.statsDiff('hard', 2) === 'hard' && fs.statsDiff('hard', 3) === 'hard');
ok('Q3 Flick Soccer (second pass): the computer\'s opening flick counts too', !fs.playerShot({ shots: 0, starter: 1 }) && fs.playerShot({ shots: 1, starter: 1 }) && fs.playerShot({ shots: 1, starter: 0 }));
const ep = load('eight-ball/js/ui.js', ['statsDiff']);
ok('Q3 Pool: one rack is one step down (Matt\'s call); 2 and 3 racks are not', ep.statsDiff('hard', 1) === 'medium' && ep.statsDiff('hard', 2) === 'hard' && ep.statsDiff('easy', 1) === 'easy');
const cp = load('cup-pong/js/ui.js', ['statsDiff'], { DIFFS: L3 });
ok('Q3 Cup Pong: unlimited reracks are one step down; 0-3 are not', cp.statsDiff('hard', 'inf') === 'medium' && cp.statsDiff('hard', 2) === 'hard' && cp.statsDiff('hard', 0) === 'hard');

// --- Q4: wiring --------------------------------------------------------------------------------------
const W = (file, re, name) => ok(`Q4 ${name}`, re.test(src(file)));
// one-shot guards and quit routes, per game
W('connect-four/js/ui.js', /menu-restart[\s\S]*?_recordQuitLoss\(\); this\.closeMenu\(\); this\.startGame\(\)/, 'Connect Four: Restart records the quit');
W('connect-four/js/ui.js', /_recordQuitLoss\(\); clearC4Game\(\); this\.game = null/, 'Connect Four: Quit to setup records the quit');
W('connect-four/js/ui.js', /this\.game\._statsRecorded = true;\s*const firstMove[\s\S]*?recordConnect4\(this\.difficulty, firstMove, false\)/, 'Connect Four: the quit uses the game\'s own _statsRecorded guard');
W('connect-four/js/ui.js', /if \(!this\._statsDisqualified \|\| won === false\)/, 'Connect Four: an undone or hinted game still records a LOSS (never a win)');
W('dots-boxes/js/ui.js', /if \(!this\.mp && this\._undone && won !== false\) return;/, 'Dots and Boxes: an undone game still records a LOSS (never a win)');
for (const g of ['tic-tac-toe', 'dots-boxes', 'filler']) {
  W(`${g}/js/ui.js`, /this\.confirmDestructive\(btn, \(\) => \{ this\._recordQuitLoss\(\); this\.startGame\(\); \}\)/, `${g}: Restart records the quit`);
  W(`${g}/js/ui.js`, /_quitCostsLoss\(\) \? t\('quit_loss'\) : t\('tap_again_confirm'\)/, `${g}: the armed button says it counts as a loss`);
}
W('mancala/js/ui.js', /action === 'restart'\) \{\s*this\._confirmQuit\(btn, \(\) => \{ this\._recordQuitLoss\(\);/, 'Mancala: Restart asks twice and records the quit');
W('mancala/js/ui.js', /this\.mode === 'bot' && this\.view === 'game'/, 'Mancala: two players on one phone never lose by quitting');
W('dominoes/js/ui.js', /startMatch\(\) \{\s*this\._recordQuitLoss\(\);/, 'Dominoes: every new match records a thrown-away one');
W('uno/js/ui.js', /if \(!DIFF_KEYS\.some\(\(\[k\]\) => k === raw\.difficulty\)\) return null;\s*\/\/ No age limit[^\n]*\n\s*return raw;/, 'Uno (second pass): no 30-minute expiry, an old hand resumes');
W('escoba/js/ui.js', /this\._recordQuitLoss\(\);\s*if \(which === 'newgame'\) this\.startGame\(\);/, 'Escoba: the menu\'s New game / Quit record the quit');
W('escoba/js/ui.js', /case 'start':[\s\S]{0,300}this\._recordQuitLoss\(\); this\.startGame\(\); break;/, 'Escoba: New game over a resumable match records it');
W('chinchon/js/ui.js', /this\._recordQuitLoss\(\);\s*if \(which === 'newgame'\) this\.startGame\(\);/, 'Chinchon: the menu\'s New game / Quit record the quit');
W('battleship/js/ui.js', /return !this\.ch && this\.view === 'battle' && !!s && !s\.over && !this\._statsCommitted;/, 'Battleship (second pass): the battle on screen arms it (placing still is not a move)');
W('boggle/js/ui.js', /action === 'change-settings'\) \{[\s\S]{0,260}this\._recordQuitLoss\(\);/, 'Boggle: Give up records the loss');
W('darts/js/ui.js', /_newMatch\(\) \{\s*this\._recordQuitLoss\(\);/, 'Darts: a new match over a thrown-in one records it');
// (2026-11-07) Pass & play moved onto the setup screen's Online tab; the tapped button is passed directly.
W('darts/js/mp-ui.js', /ui\._quitGate\((?:e\.currentTarget|a), \(\) => ui\._passPlay\(\)\)/, 'Darts: Pass & play asks first too');
W('flick-soccer/js/ui.js', /_newMatch\(\) \{\s*this\._recordQuitLoss\(\);/, 'Flick Soccer: a new match over a flicked-in one records it');
W('eight-ball/js/ui.js', /_newMatch\(\) \{\s*this\._recordQuitLoss\(\);/, 'Pool: a new match over a shot-in one records it');
W('eight-ball/js/ui.js', /if \(this\.mode === 'cpu' && !opts\.replay\) m\.ps = 1;/, 'Pool (second pass): the first shot of the match arms it, the computer\'s break included');
W('archery/js/ui.js', /if \(mode === 'cpu'\) this\._recordQuitLoss\(\);/, 'Archery: a new match vs the computer over a saved one records it');
W('battle-arena/js/ui.js', /close\(\); this\.recordOutcome\(\); this\.recordQuitLoss\(\); this\.clearSave\(\);/, 'Battle Arena: New match / Home record the quit (and first a match already decided, 2026-11-13)');
W('minesweeper/js/ui.js', /newGame\(level\) \{[\s\S]{0,200}this\._recordQuitLoss\(lv\);/, 'Minesweeper: a started board thrown away is a loss');
W('business-deal/js/ui.js', /_takeQuitLoss\(\); this\._restartGame\(\);/, 'Monopoly Deal: New Game records the quit');
W('business-deal/js/ui.js', /window\.__ghStats\.takeQuit\('business'\)\) this\._bumpBdStats\(false\)/, 'Monopoly Deal: a page that closed mid-game is a loss on the next open');
W('parchis/index.html', /var pending = !!\(sv && sv\.cfg && sv\.cfg\.vsMode === "cpu" && sv\.cfg\.hm/, 'Parchis: a new game over a rolled-in saved game is a loss');
// the no-resume games: arm, drop with the real result, take in destroy() and at init()
for (const [g, id] of []) {   // none left: every game vs the computer saves since 2026-11-06
  const c = src(`${g}/js/ui.js`);
  ok(`Q4 ${g}: arms, drops at the real result, takes on a quit, at init and in destroy()`,
    c.includes(`armQuitLoss('${id}'`) && c.includes(`dropQuitLoss('${id}')`) && c.includes(`takeQuitLoss('${id}')`)
    && /destroy\(\)\s*\{[\s\S]{0,400}(takeQuit|_quitNow|takeQuitLoss)/.test(c) && /export function quitCostsLoss/.test(c));
}
// Air Hockey and Connect 4 Hoops SAVE since 2026-11-06 (Matt: "We should add resume to the other games
// that don't save"): leaving keeps the match for Continue; throwing a moved-in one away is ONE loss.
{
  const c = src('air-hockey/js/ui.js');
  ok('Q4 air-hockey: leaving is not quitting (destroy() takes no loss, quitCostsLoss online only, isInProgress online only)',
    !/destroy\(\)\s*\{[\s\S]{0,300}(takeQuit|_quitNow|_takeDiscard)/.test(c) && /quitCostsLoss\(\) \{ return this\.online \? this\._liveCosts\(\) : false; \}/.test(c)
    && /export function isInProgress\(\) \{\s*return !!\(instance && instance\.online && /.test(c));
  ok('Q4 air-hockey: New game over a saved match records ONE loss at its score, the save cleared first; Play asks twice',
    /_play\(\) \{\s*this\._takeDiscard\(\);/.test(c) && /_takeDiscard\(\) \{[\s\S]{0,120}clearSave\(\);[\s\S]{0,200}armQuitLoss\('airhockey'[\s\S]{0,200}takeQuitLoss\('airhockey'\)/.test(c)
    && /act === 'play' && readSave\(\) && b\.dataset\.armed !== '1'\) \{ b\.dataset\.armed = '1'; b\.textContent = t\('quit_loss'\);/.test(c));
  ok('Q4 air-hockey: saved at the start and after every goal; the finish clears the save BEFORE recording; an old marker is still taken at init',
    /this\._showOnly\(null\);[\s\S]{0,200}this\._saveMatch\(\);\s*this\._start\(\);/.test(c) && /if \(this\.match\.phase !== 'over'\) this\._saveMatch\(\);/.test(c)
    && /if \(!this\.online\) clearSave\(\);[\s\S]{0,600}recordAirHockey\(/.test(c) && /export function init[\s\S]{0,300}takeQuitLoss\('airhockey'\)/.test(c)
    && !/armQuitLoss\('airhockey'[^\n]*\n(?![\s\S]{0,120}takeQuitLoss)/.test(c));
}
{
  const c = src('hoops4/js/ui.js');
  ok('Q4 hoops4: leaving is not quitting (destroy() takes no loss, quitCostsLoss and isInProgress live rooms only)',
    !/destroy\(\)\s*\{[\s\S]{0,300}(takeQuit|takeDiscard)/.test(c) && /quitCostsLoss\(\) \{\s*if \(this\.mp && this\.mp\.kind === 'live'\) return this\._liveCosts\(\);\s*return false;/.test(c)
    && /return !!\(instance\.mp && instance\.mp\.kind === 'live'\);/.test(c));
  ok('Q4 hoops4: a new match vs the computer over a saved shot-in one records ONE loss at its own level, the save cleared first',
    /if \(!resumed\) \{ if \(vsCpu\) this\.takeDiscard\(\); else clearSave\(false\); \}/.test(c)
    && /takeDiscard\(\) \{[\s\S]{0,80}clearSave\(true\);[\s\S]{0,120}armQuitLoss\('hoops4', 'recordResult', \['hoops4', this\.statsDiff\(m\), false\][\s\S]{0,200}takeQuitLoss\('hoops4'\)/.test(c));
  ok('Q4 hoops4: New game (setup and Menu) asks twice over a saved shot-in match',
    /this\.discardCostsLoss\(\) && play\.dataset\.armed !== '1'\) \{ play\.dataset\.armed = '1'; play\.textContent = t\('quitLoss'\);/.test(c)
    && /this\.match\.vsCpu && this\.discardCostsLoss\(\) && nw\.dataset\.armed !== '1'\) \{ nw\.dataset\.armed = '1'; nw\.textContent = t\('quitLoss'\);/.test(c));
  ok('Q4 hoops4: saved at every launch (the shot in the air) and every settled shot; the finish clears the save BEFORE recording',
    /if \(!this\.mp\) this\.saveMatch\(\{ p: power, a: aim, s: seed \}\);/.test(c) && /if \(!this\.mp && !m\.over\) this\.saveMatch\(\);/.test(c)
    && /this\.recorded = true;\s*\/\/[^\n]*\n\s*if \(!this\.mp\) clearSave\(m\.vsCpu\);[\s\S]{0,3000}recordResult\('hoops4', this\.statsDiff\(m\), r\.won\)/.test(c)
    && /export function init[\s\S]{0,300}takeQuitLoss\('hoops4'\)/.test(c));
}
// Cup Pong SAVES since 2026-11-03 (Matt: "Why doesn't it save the game so you can continue it like the
// other games do??"): leaving keeps the match for Continue; throwing a thrown-in one away is the loss.
{
  const c = src('cup-pong/js/ui.js');
  ok('Q4 cup-pong: leaving is not quitting (destroy() takes no loss, no quitCostsLoss export, isInProgress false vs the computer)',
    !/destroy\(\)\s*\{[\s\S]{0,300}takeQuit\(\)/.test(c) && !/export function quitCostsLoss/.test(c)
    && /export function isInProgress\(\) \{[\s\S]{0,200}return false;\s*\}/.test(c));
  ok('Q4 cup-pong: a new match over a thrown-in one (live or saved) records ONE loss, the save cleared first',
    /newMatch\(cfg = null\) \{\s*this\.takeQuit\(\);/.test(c) && /takeQuit\(\) \{[\s\S]{0,200}clearSave\(\);[\s\S]{0,300}armQuitLoss\('cuppong'[\s\S]{0,200}takeQuitLoss\('cuppong'\)/.test(c));
  ok('Q4 cup-pong: Play over a saved thrown-in match asks twice; Change settings keeps the save',
    /data-role="play"\]'\), 'click', \(e\) => this\.quitGate\(e\.currentTarget, \(\) => this\.start\('cpu'\)\)\)/.test(c)
    && /data-role="setup"\]'\), 'click', \(\) => \{ el\.remove\(\); this\.renderSetup\(\); \}\);\s*\}/.test(c));
  ok('Q4 cup-pong: the finish clears the save BEFORE recording (a continued match counts once)',
    /this\.recorded = true;[\s\S]{0,250}clearSave\(\);[\s\S]{0,200}recordCupPong\(/.test(c));
}
// Yahtzee (and Cup Baseball, archived 2026-11-13) SAVE since 2026-11-06 (Matt: "We should add resume to the other games that
// don't save"): leaving keeps the game for Continue; New game over a thrown-in / rolled-in one is the loss.
{
  const c = src('yahtzee/js/ui.js');
  ok('Q4 yahtzee saves: leaving is not quitting (destroy() takes no loss, solo quitCostsLoss false, isInProgress false vs the computer)',
    !/export function destroy\(\)\{[\s\S]{0,300}takeQuitLoss/.test(c)
    && /export function quitCostsLoss\(\)\{\s*if\(!destroyed && state && state\.mp\) return mpLeaveCosts\(\);\s*return false;\s*\}/.test(c)
    && /export function isInProgress\(\)\{[\s\S]{0,300}return false;\s*\}/.test(c));
  ok('Q4 yahtzee saves: it never arms the marker except to take it at once (New game over a rolled-in save)',
    (c.match(/armQuitLoss\(/g) || []).length === 1 && /function takeSavedLoss\(\)\{\s*const sv = readSave\(\);\s*clearSave\(\);\s*if\(!savedMoved\(sv\)\) return;[\s\S]{0,500}armQuitLoss\('yahtzee'[\s\S]{0,250}takeQuitLoss\('yahtzee'\)/.test(c));
  ok('Q4 yahtzee saves: New game over a rolled-in save asks twice, then records it',
    /savedMoved\(readSave\(\)\) && startSolo\.dataset\.armed!=='1'\)\{[^}]*t\('quit_loss'\); return; \}\s*takeSavedLoss\(\);\s*newGame\(\);/.test(c));
  ok('Q4 yahtzee saves: the result clears the save BEFORE recording (a continued game counts once)',
    /state\.statsCommitted = true;\s*if\(!state\.mp\) clearSave\(\);[\s\S]{0,1400}recordYahtzee\(difficulty/.test(c));
  ok('Q4 yahtzee saves: a roll is saved the moment its dice are decided (no take-backs by leaving)',
    /applyRollResult\(values\);\s*if\(state\.mp\) mpAfterLocalMove\(\{ t:'roll', dice: values \}\);[\s\S]{0,200}else saveGame\(\);/.test(c));
  ok('Q4 yahtzee saves: init still takes a marker an older build armed', /export function init\(container\)\{[\s\S]{0,400}takeQuitLoss\('yahtzee'\);/.test(c));
}
W('js/hub.js', /settleQuitLosses\(30 \* 60 \* 1000\)/, 'Hub: settles the markers of games that died with their page');
W('js/hub.js', /m\.quitCostsLoss\(\)[\s\S]{0,700}hub_confirm_loss/, 'Hub: its leave confirm says "Counts as a loss" when the game says so');
// strings
const STR = [
  ['js/strings.js', ['hub_confirm_loss']],
  ['connect-four/js/strings.js', ['quit_loss']], ['tic-tac-toe/js/strings.js', ['quit_loss']], ['dots-boxes/js/strings.js', ['quit_loss']],
  ['filler/js/strings.js', ['quit_loss']], ['mancala/js/strings.js', ['quit_loss']], ['dominoes/js/strings.js', ['quit_loss']],
  ['uno/js/strings.js', ['quit_loss']], ['escoba/js/strings.js', ['quit_loss', 'menu_confirm_loss']], ['chinchon/js/strings.js', ['menu_confirm_loss']],
  ['battleship/js/strings.js', ['quit_loss']], ['boggle/js/strings.js', ['quit_loss']], ['darts/js/strings.js', ['quit_loss']],
  ['flick-soccer/js/strings.js', ['quit_loss']], ['eight-ball/js/strings.js', ['quit_loss']], ['archery/js/strings.js', ['quit_loss']],
  ['air-hockey/js/strings.js', ['quit_loss']], ['battle-arena/js/strings.js', ['quitLoss']], ['cup-pong/js/strings.js', ['quitLoss']],
  ['hoops4/js/strings.js', ['quitLoss']], ['minesweeper/js/strings.js', ['quit_loss']],
  ['yahtzee/js/strings.js', ['quit_loss', 'continue_game', 'new_game']],
];
for (const [file, keys] of STR) {
  const c = src(file);
  for (const k of keys) {
    const n = (c.match(new RegExp(`\\b${k}:\\s*['"]`, 'g')) || []).length;
    ok(`Q4 ${file}: "${k}" in EN and ES, no em dash`, n === 2 && !new RegExp(`${k}:\\s*['"][^'"]*—`).test(c));
  }
}

// --- Q6: the second pass (2026-10-29): hand-overs, loss once dealt, Uno, fresh markers -------------
// G2: every new-game route checks the SAVE, so a solo match set aside by a challenge or a live room
// cannot be thrown away for free.
W('chinchon/js/ui.js', /startGame\(\) \{[\s\S]{0,400}if \(!this\.mp && !this\.game\) this\._recordSavedQuitLoss\(\);[\s\S]{0,400}if \(!this\.mp\) this\._soloClearSave\(\);/, 'G2 Chinchon: Start game over a set-aside solo match records its loss before clearing the save');
W('chinchon/js/ui.js', /case 'start':[\s\S]{0,200}this\._savedQuitPending\(\) && a\.dataset\.armed !== '1'/, 'G2 Chinchon: that Start takes two taps, saying so');
W('battleship/js/ui.js', /startGame\(\) \{\s*this\._recordSavedQuitLoss\(\);/, 'G2 Battleship: a new solo battle over a set-aside one records its loss');
ok('G2 Battleship: a live room no longer clears the solo save for free', !/_mpHostStartMatch\(\) \{[\s\S]{0,200}clearGame\(\);/.test(src('battleship/js/ui.js')) && !/_mpGuestStartMatch\(room\) \{[\s\S]{0,120}clearGame\(\);/.test(src('battleship/js/ui.js')));
W('battleship/js/ui.js', /action === 'start'\) \{[\s\S]{0,200}this\._savedQuitPending\(\) && btn\.dataset\.armed !== '1'/, 'G2 Battleship: Play over it takes two taps, saying so');
W('battle-arena/js/ui.js', /startMatch\(team\) \{\s*this\.settleSavedMatch\(\);/, 'G2 Battle Arena: a new match settles a set-aside saved one first (loss, or the win its last move owed)');
W('battle-arena/js/ui.js', /savedMatchPending\(\) && btn\.dataset\.armed !== '1'/, 'G2 Battle Arena: Fight over it takes two taps, saying so');
W('escoba/js/ui.js', /_mpHostStart\(\) \{[\s\S]{0,700}this\._recordQuitLoss\(\);\s*const code = this\._mpPendingCode;/, 'G2 Escoba: a live room replacing a solo match in the one save slot records that match\'s loss (host)');
W('escoba/js/ui.js', /_mpGuestStartMatch\(room\) \{[\s\S]{0,300}this\._recordQuitLoss\(\);/, 'G2 Escoba: ...and as a guest');
// a set-aside Chinchon save, cut from the source and run
{
  const code = src('chinchon/js/ui.js');
  const body = (name) => { const at = code.indexOf(`  ${name}() {`); let i = code.indexOf('{', at), d = 0; for (let j = i; j < code.length; j++) { if (code[j] === '{') d++; else if (code[j] === '}' && --d === 0) return code.slice(i, j + 1); } return ''; };
  const calls = [];
  const self = { mp: null, ch: null, game: null, stats: { games: 0, wins: 0, losses: 0, closes: 0, chinchons: 0, minusTen: 0 },
    _soloLoadSave: () => ({ v: 1, snap: { players: [{ isHuman: true }, { difficulty: 'hard' }, { difficulty: 'easy' }], config: { victoryCondition: 'points', scoreLimit: 100 } }, counts: { closes: 2 } }),
    _soloClearSave: () => calls.push('clear') };
  const soloDiff = cc.soloDiff;
  self._savedQuitPending = new Function('soloDiff', `return function () ${body('_savedQuitPending')}`)(soloDiff);
  // withMode / modeOfMatch / pickedDiff (2026-10-30, the game's mode) pass straight through here:
  // tools/test-game-modes.mjs proves the mode itself.
  self._recordSavedQuitLoss = new Function('saveJSON', 'STORE_STATS', 'recordChinchon', 'withMode', 'modeOfMatch', 'pickedDiff', `return function () ${body('_recordSavedQuitLoss')}`)(
    () => calls.push('stats'), 'x', (d, w, x) => calls.push(['rec', d, w, x.closed]), (m, d, f) => f(), () => null, () => 'easy');
  self._recordSavedQuitLoss();
  ok('G2 Chinchon: the set-aside save\'s loss is recorded once, at its easiest computer, save cleared first',
    calls[0] === 'clear' && calls.some((c) => Array.isArray(c) && c[1] === 'easy' && c[2] === false && c[3] === 2) && self.stats.losses === 1);
  self.game = {};
  ok('G2 Chinchon: nothing pending while a match is on the table (the menu settles that one)', self._savedQuitPending() === null);
}

// G3: once DEALT / the board SHOWN / the computer's first move, whichever comes first.
W('chinchon/js/ui.js', /this\.game\.onEvent = \(type, payload\) => this\.onEvent\(type, payload\);\s*\/\/ Quitting is a loss once the hand is DEALT[\s\S]{0,200}this\._moved = true;/, 'G3 Chinchon: dealt = quitting costs');
W('escoba/js/ui.js', /this\._bindGame\(\);\s*\/\/ Quitting is a loss once the hand is DEALT[\s\S]{0,200}this\._moved = true;/, 'G3 Escoba: dealt = quitting costs');
W('escoba/js/ui.js', /function savedMoved\(save\) \{[\s\S]{0,250}return !!\(save && save\.snap\);/, 'G3 Escoba: every saved match was dealt');
W('dominoes/js/ui.js', /function movedIn\(save\) \{\s*return !!\(save && save\.snap\);/, 'G3 Dominoes: every saved match was dealt');
W('dominoes/js/ui.js', /clearSave\(\);\s*this\._moved = true;/, 'G3 Dominoes: dealt = quitting costs');
W('uno/js/ui.js', /function savedMoved\(raw\) \{\s*return !!\(raw && raw\.snap\);/, 'G3 Uno: every saved hand was dealt');
W('uno/js/ui.js', /this\.closeOverlays\(\);\s*this\._moved = true;/, 'G3 Uno: dealt = quitting costs');
W('boggle/js/ui.js', /this\._found = new Map\(\);\s*\/\/ The board is SHOWN[\s\S]{0,200}this\._moved = true;/, 'G3 Boggle: the board shown = giving up is a loss (before the first word too)');
W('yahtzee/js/ui.js', /function savedMoved\(s\)\{ return !!s && \(s\.rollsUsed>0 \|\| s\.players\.some\(p => Object\.keys\(p\.scores\)\.length>0\)\); \}/, 'G3 Yahtzee (saves since 2026-11-06): any roll in the saved game, the computer\'s included');
W('business-deal/js/ui.js', /this\.game = new Game\(\{ verbose: false, players \}\);[\s\S]{0,250}this\._armQuitLoss\(\);/, 'G3 Monopoly Deal: dealt = armed');
W('parchis/index.html', /function doRoll\(\) \{[\s\S]{0,400}if \(G\.cfg && G\.cfg\.vsMode === "cpu"\) G\.cfg\.hm = true;/, 'G3 Parchis: the first roll of the game, the computer\'s included');
W('cup-pong/js/ui.js', /const savedMoved = \(s\) => !!s && \(\(s\.match\.throwsTaken \| 0\) > 0 \|\| !!s\.fly\);/, 'G3 Cup Pong (saves since 2026-11-03): any throw in the saved match, the computer\'s or one still in the air included');
W('hoops4/js/ui.js', /const savedMoved = \(sv\) => !!sv && \(sv\.match\.moves\.length > 0 \|\| sv\.match\.shots\[0\] \+ sv\.match\.shots\[1\] > 0 \|\| !!sv\.fly\);/, 'G3 Connect 4 Hoops (saves since 2026-11-06): any shot in the saved match, the computer\'s or one still in the air included');
W('air-hockey/js/ui.js', /this\.screen = 'game';\s*this\._showOnly\(null\);[\s\S]{0,250}this\._saveMatch\(\);\s*this\._start\(\);/, 'G3 Air Hockey (saves since 2026-11-06): the puck live = saved, so New game over it is a loss');
W('archery/js/ui.js', /m\.shots\.some\(\(s\) => s && s\.length > 0\)/, 'G3 Archery: any arrow, the computer\'s included');
W('connect-four/js/ui.js', /if \(player === this\.humanPlayer\) this\.humanHasMoved = true;[\s\S]{0,250}this\._moved = true;/, 'G3 Connect Four: any disc, the computer\'s opening included');
W('mancala/js/ui.js', /if \(!this\.mp && this\.mode === 'bot'\) this\._humanMoved = true;/, 'G3 Mancala: any sowing vs the computer');
W('tic-tac-toe/js/ui.js', /s\.board\.some\(Boolean\)/, 'G3 Tic Tac Toe: any mark');
W('filler/js/ui.js', /return s\.moves >= 1;/, 'G3 Filler: any colour picked');
W('dots-boxes/js/ui.js', /return this\._moves\.length > 0;/, 'G3 Dots and Boxes: any edge');
W('battle-arena/js/ui.js', /this\.recorded = false;[\s\S]{0,300}this\.pm = true;\s*this\.save\(\);/, 'G3 Battle Arena: the board shown = armed');

// G4: Uno's 30-minute expiry is gone; an old hand resumes.
ok('G4 Uno: MAX_SAVE_AGE_MS no longer drives anything', !/Date\.now\(\) - Number\(raw\.at \|\| 0\) > MAX_SAVE_AGE_MS/.test(src('uno/js/ui.js')));

// G5: a marker this page armed is kept fresh, and a game whose marker was settled elsewhere records nothing more.
store.clear(); profile('TQWX7');
G.armQuitLoss('cuppong', 'recordCupPong', ['medium', false, 0]);
const q6 = JSON.parse(store.get('gamehub.quitLoss.v1')); q6.cuppong.t -= 40 * 60 * 1000; store.set('gamehub.quitLoss.v1', JSON.stringify(q6));
ok('G5 touchQuitLoss refreshes an armed marker', G.touchQuitLoss('cuppong') === true && Date.now() - JSON.parse(store.get('gamehub.quitLoss.v1')).cuppong.t < 5000);
G.settleQuitLosses(30 * 60 * 1000);
ok('G5 ...so the hub\'s 30-minute settle leaves a game still being played', G.quitLossArmed('cuppong') && !stats());
ok('G5 quitLossLost: false while this page\'s marker is there', G.quitLossLost('cuppong') === false);
const q7 = JSON.parse(store.get('gamehub.quitLoss.v1')); q7.cuppong.t -= 40 * 60 * 1000; store.set('gamehub.quitLoss.v1', JSON.stringify(q7));
G.settleQuitLosses(30 * 60 * 1000);   // a page frozen that long: the hub took it
ok('G5 quitLossLost: true once the hub settled this page\'s marker (the game must record nothing more)', G.quitLossLost('cuppong') === true && stats().games.cuppong.total.lost === 1);
G.dropQuitLoss('cuppong');
ok('G5 quitLossLost: false again once the game has dropped it', G.quitLossLost('cuppong') === false);
for (const [g, id] of [['yahtzee', 'yahtzee']]) {
  ok(`G5 ${g}: its real result is skipped when the marker was settled elsewhere`, new RegExp(`quitLossLost\\('${id}'\\)`).test(src(`${g}/js/ui.js`)));
}
W('js/game-stats.js', /function keepFresh\(gameId\) \{[\s\S]{0,200}setInterval\(quitTick, QUIT_TICK_MS\)/, 'G5 game-stats: an armed marker is refreshed every minute while its page lives');
store.clear(); profile('TQWX7');
const ctx6 = { localStorage: globalThis.localStorage, console: { warn() {}, error() {}, log() {} }, Date, JSON, isFinite, setInterval: () => ({ unref() {} }), clearInterval() {} };
ctx6.self = ctx6;
vm.createContext(ctx6);
vm.runInContext(src('js/game-stats-global.js'), ctx6);
const GS6 = ctx6.__ghStats;
GS6.armQuit('business', 'hard');
const q8 = JSON.parse(store.get('gamehub.quitLoss.v1')); q8.business.t -= 40 * 60 * 1000; store.set('gamehub.quitLoss.v1', JSON.stringify(q8));
ok('G5 Monopoly Deal: touchQuit refreshes the classic marker', GS6.touchQuit('business') === true && Date.now() - JSON.parse(store.get('gamehub.quitLoss.v1')).business.t < 5000);
const q9 = JSON.parse(store.get('gamehub.quitLoss.v1')); q9.business.t -= 40 * 60 * 1000; store.set('gamehub.quitLoss.v1', JSON.stringify(q9));
G.settleQuitLosses(30 * 60 * 1000);
ok('G5 Monopoly Deal: quitLost says the hub took it (one loss, no second result)', GS6.quitLost('business') === true && stats().games.business.total.played === 1);
// 2026-11-06: Monopoly Deal SAVES (gamehub.bd.save.v1), so leaving is not quitting: it arms no marker;
// a discard (Settings > New Game, or New Game over a save, confirmed) records the one loss.
ok('G5 Monopoly Deal saves: it never arms the closed-page marker', !/__ghStats\.armQuit\(/.test(src('business-deal/js/ui.js')));
W('business-deal/js/ui.js', /_discardAndStart\(numAI, diff\) \{[\s\S]{0,400}this\._recordResult\(false\);[\s\S]{0,120}this\.newGame\(numAI, diff\);/, 'G5 Monopoly Deal: New Game over a saved game is one loss');
W('business-deal/js/ui.js', /onTurnStart = async \(pl\) => \{\s*this\._armQuitLoss\(\);/, 'G5 Monopoly Deal: ...which runs every turn');
W('business-deal/js/ui.js', /window\.__ghStats\.quitLost\('business'\)[\s\S]{0,250}if \(!lost\) this\._recordResult\(w\.id === 0\);/, 'G5 Monopoly Deal: a game whose marker was settled elsewhere records nothing more');

// --- Q5: in a real page -------------------------------------------------------------------------------
if (process.argv.includes('--browser')) await browserPart();
else console.log('(skip) Q5 browser checks: run with --browser and `node server.mjs` up');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

async function browserPart() {
  const { createRequire } = await import('node:module');
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }
  const BASE = process.env.BB_BASE || 'http://localhost:8123';
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const fresh = async (path, settings = {}) => {
    await page.goto(`${BASE}/${path}`);
    await page.evaluate((settings) => {
      localStorage.clear();
      localStorage.setItem('gamehub.devAllowSync.v1', '0');
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'zzztest', emoji: '🙂', playerId: 'TQWX7', opponents: [] }));
      for (const [k, v] of Object.entries(settings)) localStorage.setItem(k, JSON.stringify(v));
    }, settings);
    await page.goto(`${BASE}/${path}`);
    await page.waitForTimeout(700);
  };
  const st = (id) => page.evaluate((id) => {
    const s = JSON.parse(localStorage.getItem('gamehub.stats') || 'null');
    const g = s && s.games && s.games[id];
    return g ? g.total : { played: 0, won: 0, lost: 0 };
  }, id);
  const click = (sel) => page.click(sel, { timeout: 5000 });
  const one = (t) => t.played === 1 && t.lost === 1 && t.won === 0;

  // Tic Tac Toe (saves and resumes): Restart before a move = nothing; after one = one loss, asked twice.
  await fresh('tic-tac-toe/', { 'gamehub.tictactoe.v1': { variant: 'classic', difficulty: 'beginner', firstMode: 'you' } });
  await click('[data-action="start"]');
  await page.waitForTimeout(300);
  await click('[data-role="restart"]'); await click('[data-role="restart"]');
  await page.waitForTimeout(300);
  ok('Q5 Tic Tac Toe: Restart before the first move records nothing', (await st('tictactoe')).played === 0);
  await click('[data-action="cell"][data-cell="4"]');
  await page.waitForTimeout(1500);
  await page.reload(); await page.waitForTimeout(800);
  ok('Q5 Tic Tac Toe: leaving (a reload) records nothing and resumes the board', (await st('tictactoe')).played === 0 && await page.$('[data-role="restart"]') !== null);
  await click('[data-role="restart"]');
  const armedText = await page.textContent('[data-role="restart"]');
  await click('[data-role="restart"]');
  await page.waitForTimeout(300);
  ok('Q5 Tic Tac Toe: the armed Restart says it counts as a loss', /loss/i.test(armedText || ''), armedText);
  let t1 = await st('tictactoe');
  ok('Q5 Tic Tac Toe: Restart after the first move records exactly one loss', one(t1), JSON.stringify(t1));
  await click('[data-role="restart"]'); await click('[data-role="restart"]');
  await page.waitForTimeout(300);
  ok('Q5 Tic Tac Toe: the new game, unplayed, adds nothing', (await st('tictactoe')).played === 1);

  // Dots and Boxes: Menu after an edge = one loss.
  await fresh('dots-boxes/', { 'gamehub.dotsboxes.v1': { size: 'small', difficulty: 'beginner', firstMode: 'you', humanFirst: true } });
  await click('[data-action="start"]');
  await page.waitForTimeout(400);
  await click('[data-action="edge"]');
  await page.waitForTimeout(1500);
  await click('[data-action="change-settings"]'); await click('[data-action="change-settings"]');
  await page.waitForTimeout(300);
  t1 = await st('dotsboxes');
  ok('Q5 Dots and Boxes: Menu after the first edge records exactly one loss', one(t1), JSON.stringify(t1));

  // Connect Four: a resume save is not a quit; Quit to setup after a move = one loss.
  await fresh('connect-four/', { 'gamehub.connect4.v1': { firstMode: 'you', nextStarter: 'you' } });
  await click('[data-role="start"]');
  await page.waitForTimeout(500);
  await click('.cf-cell[data-col="3"]');
  await page.waitForTimeout(2500);
  await page.reload(); await page.waitForTimeout(1200);
  const saved = await page.evaluate(() => !!localStorage.getItem('gamehub.connect4.save.v1'));
  ok('Q5 Connect Four: leaving (a reload) records nothing and keeps the save', saved && (await st('connect4')).played === 0);
  await click('[data-role="menu"]'); await click('[data-role="menu-quit"]'); await click('[data-role="menu-quit"]');
  await page.waitForTimeout(300);
  t1 = await st('connect4');
  ok('Q5 Connect Four: Quit to setup after a move records exactly one loss', one(t1), JSON.stringify(t1));

  // Minesweeper: the face on a started board = one loss at that level.
  await fresh('minesweeper/');
  await click('[data-act="play"]');
  await page.waitForTimeout(400);
  const box = await page.$eval('.ms-board', (b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(400);
  await click('[data-act="new"]');
  const sub = await page.textContent('.ms-sub');
  await click('[data-act="newyes"]');
  await page.waitForTimeout(300);
  t1 = await st('minesweeper');
  ok('Q5 Minesweeper: the New board question says it counts as a loss', /loss/i.test(sub || ''), sub);
  ok('Q5 Minesweeper: a started board thrown away records exactly one loss', one(t1), JSON.stringify(t1));

  // Yahtzee (saves since 2026-11-06): leaving keeps the game (Continue); New game over it = one loss.
  await fresh('yahtzee/');
  await click('[data-action="start-solo"]');
  await page.waitForTimeout(600);
  await click('#rollBtn');
  await page.waitForTimeout(1800);
  const ysave = await page.evaluate(() => JSON.parse(localStorage.getItem('gamehub.yahtzee.save.v1') || 'null'));
  ok('Q5 Yahtzee: a roll is saved', !!ysave && ysave.rollsUsed === 1);
  const costs = await page.evaluate(() => import('./js/ui.js').then((m) => m.quitCostsLoss() || m.isInProgress()));
  ok('Q5 Yahtzee: the hub asks nothing on leaving (the game is saved)', costs === false);
  await page.evaluate(() => import('./js/ui.js').then((m) => m.destroy()));
  await page.reload(); await page.waitForTimeout(1200);   // and a page that dies: no destroy() runs
  ok('Q5 Yahtzee: leaving after a roll records nothing', (await st('yahtzee')).played === 0);
  await click('[data-action="continue-solo"]');
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => { const s = window.__yzTest.getState(); return { r: s.rollsUsed, d: s.dice.map((x) => x.value) }; });
  ok('Q5 Yahtzee: Continue restores the dice as they were', back.r === 1 && back.d.join() === ysave.dice.map((x) => x.value).join(), JSON.stringify(back));
  await page.reload(); await page.waitForTimeout(1000);
  await click('[data-action="start-solo"]');
  const yArmed = await page.textContent('[data-action="start-solo"]');
  await click('[data-action="start-solo"]');
  await page.waitForTimeout(400);
  t1 = await st('yahtzee');
  ok('Q5 Yahtzee: New game over the save asks twice, then records exactly one loss', /loss/i.test(yArmed || '') && one(t1), yArmed + ' ' + JSON.stringify(t1));
  await page.reload(); await page.waitForTimeout(1000);
  ok('Q5 Yahtzee: opening it again records nothing more and offers no Continue', (await st('yahtzee')).played === 1 && !(await page.$('[data-action="continue-solo"]')));

  ok('Q5 no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
}
