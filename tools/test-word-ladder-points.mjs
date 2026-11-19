// tools/test-word-ladder-points.mjs - Word Ladder's POINTS (js/word-ladder-points.js, 2026-11-19), everywhere they show:
// the table, the recorders' entries, the cross-device merge (phone AND the server's copy of players-agg), the
// leaderboard's board (run as if released: lb2Board directly; the shipped game stays admin only), My Stats' headline,
// the "+X pts" pill, the "See how scores are calculated" sheet, the integrity alert, and that it all stays HIDDEN while
// the game is admin only. Pure node, a fake localStorage, made-up players (never Matt's code or name).
// Run: node tools/test-word-ladder-points.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name + (info === undefined ? '' : '  ' + JSON.stringify(info))); } };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k), clear: () => store.clear(), key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'zzzladderpts', playerId: 'ZZZP4' }));
// The "+X pts" event needs a window (announceWin): an EventTarget is enough.
const win = new EventTarget();
globalThis.window = win;
const events = [];
win.addEventListener('gamehub:win', (e) => events.push(e.detail));
const flush = () => new Promise((r) => setTimeout(r, 5));

const G = await import('../js/game-stats.js');
const P = await import('../js/word-ladder-points.js');
const { aggregatePlayers } = await import('../js/players-agg.js');

// --- 1. the table (Matt's "Cool", 2026-11-19) --------------------------------------------------------------------------
ok('table: Easy 1/1/1, Medium 2/1/1, Hard 3/2/1, Expert 5/3/1', JSON.stringify(P.WL_POINTS) === JSON.stringify({ easy: [1, 1, 1], medium: [2, 1, 1], hard: [3, 2, 1], expert: [5, 3, 1] }));
ok('wlLevelPoints reads it by stars', P.wlLevelPoints('expert', 3) === 5 && P.wlLevelPoints('expert', 2) === 3 && P.wlLevelPoints('expert', 1) === 1 && P.wlLevelPoints('hard', 2) === 2 && P.wlLevelPoints('medium', 2) === 1);
ok('a finished level is never 0 (bad stars read as 1)', P.wlLevelPoints('hard', 0) === 1 && P.wlLevelPoints('hard', 9) === 3);
ok('most per language: 100 + 300 + 450 + 500 = 1,350', 100 * 1 + 150 * 2 + 150 * 3 + 100 * 5 === 1350);

// --- 2. points from a record: each number once, best over versions, both languages, daily 0 --------------------------
const rec = { wl: {
  lv: { L1: { s: 3, m: 3, p: 3, h: 0 }, L101: { s: 2, m: 5, p: 4, h: 0 }, L251: { s: 3, m: 4, p: 4, h: 0 },
    L401: { s: 3, m: 5, p: 5, h: 0 }, L401v2: { s: 1, m: 12, p: 6, h: 0 }, L402v2: { s: 2, m: 6, p: 5, h: 1 } },
  es: { L1: { s: 1, m: 9, p: 3, h: 0 }, L1v2: { s: 3, m: 3, p: 3, h: 0 }, L300v2: { s: 2, m: 6, p: 5, h: 0 } },
  dl: { 'en-2026-11-13': { s: 3, m: 4, p: 4, h: 0 } } } };
// en: L1 1 + L101 (2 stars) 1 + L251 3 + L401 (old puzzle, 3 stars) 5 + L402v2 (2 stars) 3 = 13; es: L1 best 3 stars 1 + L300v2 2 = 3.
ok('points: en 1 + 1 + 3 + 5 + 3, es 1 + 2 = 16', P.wlPoints(rec) === 16, P.wlPoints(rec));
ok('an OLD solve of a remade number pays at its stored stars (L401: 5), the replay never twice', P.wlPoints(rec, 'expert') === 8);
ok('per band', P.wlPoints(rec, 'easy') === 2 && P.wlPoints(rec, 'medium') === 1 && P.wlPoints(rec, 'hard') === 5);
ok('levels counted once each (en 5, es 2), the daily not a level', P.wlCleared(rec) === 7 && P.wlCleared(rec, 'expert') === 2);
ok('the daily pays nothing', P.wlPoints({ wl: { dl: rec.wl.dl } }) === 0);
ok('an empty or bad record reads 0', P.wlPoints(null) === 0 && P.wlPoints({}) === 0 && P.wlPoints({ wl: { lv: [1, 2] } }) === 0 && P.wlCleared(undefined) === 0);
ok('wlCleared = wlSolved (the old board count)', P.wlCleared(rec) === G.wlSolved(rec) && P.wlCleared(rec, 'hard') === G.wlSolved(rec, 'hard'));
ok('stars and at par over each number\'s best', P.wlStarsTotal(rec) === 3 + 2 + 3 + 3 + 2 + 3 + 2 && P.wlAtPar(rec) === 4);

// --- 3. the real recorders: first solve and a better result announce their points ------------------------------------
const gm = () => G.loadStats().games.wordladder;   // the game's own view (its test record while admin only)
const rl = (n, o) => G.withMode(() => ({ mode: 'ladder', lang: o.lang || 'en' }), G.wlBandOf(n), () => G.recordWordLadder(n, { band: G.wlBandOf(n), ...o }));
rl(401, { moves: 7, par: 5, hints: 0, ver: 2 });
await flush();
ok('first solve of an Expert level, 2 stars: 3 points', P.wlPoints(gm()) === 3);
const { winPoints } = await import('../js/points-toast.js');
ok('...announced as a win, +3', events.length === 1 && events[0].id === 'wordladder' && (winPoints(events[0]) || {}).pts === 3, events.map((e) => winPoints(e)));
rl(401, { moves: 5, par: 5, hints: 0, ver: 2 });
await flush();
ok('a better result on it (3 stars): 5 points, still one play', P.wlPoints(gm()) === 5 && gm().total.played === 1);
ok('...announced, +2', events.length === 2 && (winPoints(events[1]) || {}).pts === 2);
rl(401, { moves: 9, par: 5, hints: 0, ver: 2 });
await flush();
ok('a worse result: nothing announced, nothing lowered', events.length === 2 && P.wlPoints(gm()) === 5);
rl(1, { moves: 3, par: 3, hints: 0, lang: 'es', ver: 2 });
await flush();
ok('a Spanish Easy level: +1', events.length === 3 && (winPoints(events[2]) || {}).pts === 1 && P.wlPoints(gm()) === 6);
G.withMode(() => ({ mode: 'daily', lang: 'en' }), 'daily', () => G.recordWordLadderDaily('en-2026-11-19', { moves: 4, par: 4, hints: 0 }));
await flush();
ok('the daily: a win, +0 (no pill)', P.wlPoints(gm()) === 6 && !(((winPoints(events[events.length - 1]) || {}).pts) > 0));
ok('admin only: the pill never shows a test play (startPointsToast skips isTestGame)', G.isTestGame('wordladder')
  && /if \(!det \|\| isTestGame\(det\.id\)\) return;/.test(fs.readFileSync(path.join(ROOT, 'js/points-toast.js'), 'utf8')));

// --- 4. two phones, merged on the phone and on the SERVER (functions/shared, the same aggregatePlayers) ----------------
const dev = (id, games, upd) => [id, { profile: { name: 'Zed Ladder', playerId: 'ZZZQ9' }, stats: { games }, updatedAt: upd }];
const wlg = (wl, played) => ({ total: { played, won: played, lost: 0 }, byDiff: { easy: { played, won: played, lost: 0 } }, wl });
const other = (name, code, wl) => ['dev-' + code, { profile: { name, playerId: code }, stats: { games: { wordladder: wlg(wl, Object.keys(wl.lv || {}).length) } }, updatedAt: 300 }];
const all = Object.fromEntries([
  dev('dev-a', { wordladder: wlg({ lv: { L1: { s: 2, m: 5, p: 3, h: 0, t: 5 }, L401: { s: 3, m: 5, p: 5, h: 0, t: 6 } } }, 2) }, 100),
  dev('dev-b', { wordladder: wlg({ lv: { L1: { s: 3, m: 3, p: 3, h: 0, t: 9 }, L401v2: { s: 2, m: 7, p: 5, h: 0, t: 10 } }, es: { L101: { s: 3, m: 4, p: 4, h: 0, t: 11 } } }, 3) }, 200),
  other('Ann Ladder', 'ZZZR1', { lv: { L251: { s: 3, m: 4, p: 4, h: 0 }, L252: { s: 3, m: 4, p: 4, h: 0 } } }),
  other('Bo Ladder', 'ZZZR2', { lv: { L401: { s: 3, m: 5, p: 5, h: 0 }, L1: { s: 3, m: 3, p: 3, h: 0 } } }),
  other('Cy Ladder', 'ZZZR3', { lv: { L101: { s: 3, m: 4, p: 4, h: 0 }, L102: { s: 3, m: 4, p: 4, h: 0 }, L103: { s: 3, m: 4, p: 4, h: 0 } } }),
]);
const phone = aggregatePlayers(JSON.parse(JSON.stringify(all)));
const zed = phone.find((g) => g.name === 'Zed Ladder');
// Zed: L1 best 3 stars 1 + L401 (old 3 stars 5 beats v2's 2 stars) 5 + es L101 3 stars 2 = 8, 3 levels.
ok('two phones: each level once, the better entry (L1 3 stars), the old L401 kept: 8 points', zed && P.wlPoints(zed.games.wordladder) === 8 && P.wlCleared(zed.games.wordladder) === 3, zed && zed.games.wordladder.wl);
let server = null;
try {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/sync-functions-shared.mjs')], { cwd: ROOT, stdio: 'pipe' });
  server = await import('../functions/shared/js/players-agg.js');
} catch (err) { console.log('  (server copy not built: ' + String(err.message || err).split('\n')[0] + ')'); }
if (server) {
  const srv = server.aggregatePlayers(JSON.parse(JSON.stringify(all)));
  const norm = (list) => JSON.stringify(list.map((g) => [g.name, g.games.wordladder]).sort());
  ok('the SERVER board groups Word Ladder exactly as the phone (deep-equal)', norm(srv) === norm(phone));
  ok('...so its points are the same for every person', srv.every((g) => P.wlPoints(g.games.wordladder) === P.wlPoints(phone.find((x) => x.name === g.name).games.wordladder)));
} else ok('the server copy of players-agg builds (tools/sync-functions-shared.mjs)', false);

// --- 5. the board, run as if released (lb2Board directly; the shipped game is admin only) -----------------------------
const L = await import('../js/leaderboard-ui.js');
const list = phone.map((g, i) => ({ ...g, key: g.key || 'k' + i }));
const board = L.lb2Board(list, 'wordladder');
const order = board.rows.map((r) => `${r.g.name}:${r.text}`);
// Ann 6 (2 levels), Cy 6 (3 levels), Bo 6 (2 levels), Zed 8. Ties: the same points from FEWER levels rank higher (Matt,
// 2026-11-06, "the better average"); Ann and Bo, 6 from 2 each, stay tied.
ok('board: Zed 8, then Ann and Bo 6 from 2 levels (tied), then Cy 6 from 3', order.join() === 'Zed Ladder:8,Ann Ladder:6,Bo Ladder:6,Cy Ladder:6' || order.join() === 'Zed Ladder:8,Bo Ladder:6,Ann Ladder:6,Cy Ladder:6', order);
const rk = Object.fromEntries(board.rows.map((r) => [r.g.name, [r.rank, r.tie]]));
ok('board: Ann and Bo share 2nd, Cy is 4th', rk['Ann Ladder'][0] === 2 && rk['Bo Ladder'][0] === 2 && rk['Cy Ladder'][0] === 4, rk);
ok('board unit: points', /point/i.test(board.unit), board.unit);
const tabs = L.lb2Tabs(list, 'wordladder');
ok('board tabs: All + each band anyone finished a level in', JSON.stringify(tabs).includes('"tier":1') && JSON.stringify(tabs).includes('"tier":2') && JSON.stringify(tabs).includes('"tier":3') && JSON.stringify(tabs).includes('"tier":4'));
const expert = L.lb2Board(list, 'wordladder', { tier: 4 });
ok('Expert tab: that band\'s own points (Zed 5, Bo 5)', expert.rows.filter((r) => r.text === '5').length === 2 && expert.rows.length === 2, expert.rows.map((r) => r.g.name + ':' + r.text));
const stand = L.lb2Standing(list, 'wordladder');
ok('By Game / Medal Count standing: Zed first', stand && JSON.stringify(stand).indexOf('Zed Ladder') >= 0);

// --- 6. My Stats headline, the rows look, and the sheet -----------------------------------------------------------------
const gsSrc = fs.readFileSync(path.join(ROOT, 'js/game-stats-ui.js'), 'utf8');
ok('My Stats: unit points, headline wlPoints, a points tally, its own rows screen', /wordladder: 'lb_unit_points'/.test(gsSrc)
  && /id === 'wordladder'\) return \{ n: wlPoints\(rec\)/.test(gsSrc) && /<b>\$\{wlPoints\(rec\)\}<\/b>/.test(gsSrc) && /case 'wordladder': return rowsWordLadder\(rec\);/.test(gsSrc));
const S = await import('../js/lb-rank-sheet.js');
const STR = (await import('../js/strings.js')).default;
const cards = S.rankSheetModel('wordladder');
ok('sheet: one table, Stars 3 / 2 / 1, a row per band = WL_POINTS', cards[0].grid && cards[0].grid.sup === 'lbrs_wl_sup' && cards[0].grid.cols.join() === '3,2,1'
  && cards[0].grid.rows.map((r) => r.vals.join('/')).join(' ') === '1/1/1 2/1/1 3/2/1 5/3/1');
ok('sheet: how stars are earned, the hint cap, each level once, earlier puzzles, the daily', cards[0].foot.join() === 'lbrs_wl_stars,lbrs_wl_hints' && cards[1].text.join() === 'lbrs_wl_once,lbrs_wl_old,lbrs_wl_daily');
const words = ['lbrs_wl_sup', 'lbrs_wl_stars', 'lbrs_wl_hints', 'lbrs_wl_once', 'lbrs_wl_old', 'lbrs_wl_daily'];
ok('sheet strings in EN and ES, no em dash', words.every((k) => STR.en[k] && STR.es[k] && !/—/.test(STR.en[k] + STR.es[k])));
const html = S.rankSheetHTML('wordladder');
ok('sheet renders the table and every line', /<td class="lbrs-full">5<\/td>/.test(html) && html.includes(STR.en.lbrs_wl_daily) && html.includes(STR.en.lbrs_wl_hints));
const { LB_RULES } = await import('../js/lb-rules.js');
ok('(i) rule: points', LB_RULES.wordladder.by === 'points');

// --- 7. the integrity ALERT (never a void) -------------------------------------------------------------------------------
const I = await import('../js/integrity.js');
const hit = (wl) => I.checkGame('wordladder', { total: { played: 1, won: 1, lost: 0 }, byDiff: {}, wl });
ok('integrity: an honest record trips nothing', hit(rec.wl).length === 0 && hit(zed.games.wordladder.wl).length === 0);
ok('integrity: under par = an ALERT', (() => { const h = hit({ lv: { L5: { s: 3, m: 2, p: 3, h: 0 } } }); return h.length === 1 && h[0].rule === 'wordladder-under-par' && h[0].void === false; })());
ok('integrity: more hints than moves, or stars the moves do not give = an alert', hit({ es: { L5: { s: 1, m: 2, p: 2, h: 3 } } }).length === 1 && hit({ dl: { 'en-2026-11-19': { s: 3, m: 9, p: 4, h: 0 } } }).length === 1);

// --- 8. HIDDEN while admin only: the release flips flags only --------------------------------------------------------
const hub = fs.readFileSync(path.join(ROOT, 'js/hub.js'), 'utf8');
const hubEntry = hub.slice(hub.indexOf("id: 'word-ladder'"), hub.indexOf("id: 'word-ladder'") + 900);
ok('hidden: the hub entry is devOnly, no released date', /devOnly: true/.test(hubEntry) && !/released:/.test(hubEntry));
ok('hidden: My Stats TABS row is devOnly', /\{ id: 'wordladder', labelKey: 'game_title_wordladder', devOnly: true \}/.test(gsSrc));
ok('hidden: ADMIN_ONLY holds it (its plays go to the test record)', G.isTestGame('wordladder'));
const GSU = await import('../js/game-stats-ui.js');
ok('hidden: isGameOnLauncher(wordladder) is false (the leaderboard\'s only gate)', GSU.isGameOnLauncher('wordladder') === false);

console.log(`\nword-ladder points tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
