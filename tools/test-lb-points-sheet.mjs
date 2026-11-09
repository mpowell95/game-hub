// test-lb-points-sheet.mjs - the points sheet (js/lb-points-sheet.js, Matt's mockup v7, 2026-11-02): the cards on
// the board's (i) and the stats page. Pure; no browser.
// The failure it exists for: a sheet that says something the board does not do. Mockup v6 marked Tic Tac Toe
// Ultimate Easy/Medium as under the 20-point limit because the limit was read from the level alone. So every row
// of every game is checked against gamePoints with real-shaped records: 100 such wins must give 100 x the row's
// points, or exactly 20 when the row shows the limit.
//   node tools/test-lb-points-sheet.mjs
import { sheetModel, pointsSheetHTML } from '../js/lb-points-sheet.js';
import { gamePoints, POINT_GAMES, CAP } from '../js/lb-points.js';
import { ASSUMED_MODES } from '../js/stats-corrections.js';
import STRINGS from '../js/strings.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const W = 100;
const won = (n) => ({ played: n, won: n, lost: 0 });
const rows = (id) => sheetModel(id).flatMap((c) => (c.rows || []).map((r) => ({ c, r })));

for (const id of POINT_GAMES) {
  const cards = sheetModel(id);
  ok(`${id}: has a sheet`, cards.length > 0);
  const kinds = cards.map((c) => c.kind);
  const rank = { opt: 0, count: 0, cpu: 0, online: 2, limit: 3, table: 4, cutthroat: 5 };
  ok(`${id}: order options, online, limit, tables note`, kinds.every((k, i) => !i || rank[k] >= rank[kinds[i - 1]]), kinds);
  ok(`${id}: no "older wins" row (dropped, session 7)`, !kinds.includes('older'));
  const limited = rows(id).filter((x) => x.r.cap).length;
  ok(`${id}: a limit note exactly when a cell is limited`, (limited > 0) === kinds.includes('limit'));
  const opts = cards.filter((c) => c.kind === 'opt');
  ok(`${id}: every option column has the same levels`, opts.every((o) => o.rows.map((r) => r.tier).join() === (opts[0] || o).rows.map((r) => r.tier).join()));
  for (const { c, r } of rows(id)) ok(`${id}: ${c.key || c.kind} row ${r.tier} has points`, Number.isInteger(r.pts) && r.pts >= 1, r);
}

// Every limited row really is limited, and every other row really pays its points, per gamePoints.
const lvKey = { tictactoe: ['beginner', 'intermediate', 'pro'], dotsboxes: ['beginner', 'intermediate', 'pro'], boggle: ['beginner', 'intermediate', 'pro'] };
const LV = (id, t) => (lvKey[id] || ['easy', 'medium', 'hard', 'expert'])[t - 1];
const MODES = {   // what each option card's wins look like in a real record (withMode's key at the setup level)
  tt_classic: { v: 'classic' }, tt_ultimate: { v: 'ultimate' }, cp_none: { gent: 1, rr: 0 }, cp_some: { gent: 1, rr: 2 },
  dt_order: { kind: 'cricket-order', first: 'me' }, dt_normal: { kind: '301', first: 'me' }, fs_3: { goals: 3, off: 'x' },
  fs_2: { goals: 2, off: 'x' }, eb_3: { racks: 3 }, eb_2: { racks: 2 }, dm_500: { to: 500 }, dm_300: { to: 300 },
  db_large: { size: 'large' }, db_medium: { size: 'medium' }, db_small: { size: 'small' }, bs_quick: { size: 'quick' }, bs_classic: { size: 'classic' },
};
MODES.h4_until = { first: 'me', one: 0 }; MODES.h4_one = { first: 'me', one: 1 };
MODES.cc_short = { vc: 'points', sl: 50 }; MODES.cc_normal = { vc: 'points', sl: 100 };
const SHORT = new Set(['bg_2min', 'cc_short', 'h4_until', 'cp_inf', 'dt_short', 'dm_150', 'fs_1', 'eb_1']);
for (const id of POINT_GAMES) {
  for (const c of sheetModel(id)) {
    if (c.kind !== 'opt' && c.kind !== 'cpu') continue;
    for (const r of c.rows) {
      if (!r.tier) continue;
      const raw = LV(id, r.tier);
      const recd = c.key && SHORT.has(c.key) ? LV(id, Math.max(1, r.tier - 1)) : raw;
      const gm = { total: won(W), byDiff: { [recd]: won(W) } };
      const m = c.key && MODES[c.key];
      if (m) gm.byMode = { [Object.entries(m).map(([k, v]) => `${k}=${v}`).join('|')]: { [raw]: won(W) } };
      const got = gamePoints(gm, id).pts;
      ok(`${id} ${c.key || 'cpu'} tier ${r.tier}: ${r.cap ? 'limited to 20' : r.pts + ' a win'}`, got === (r.cap ? CAP : W * r.pts), { got, row: r });
    }
  }
}

// The cases Matt has looked at, by name.
const card = (id, key) => sheetModel(id).find((c) => c.key === key);
ok('Tic Tac Toe: only Classic Easy/Medium are limited', rows('tictactoe').filter((x) => x.r.cap).map((x) => `${x.c.key}${x.r.tier}`).join() === 'tt_classic1,tt_classic2');
ok('Tic Tac Toe Ultimate 1/3/10', card('tictactoe', 'tt_ultimate').rows.map((r) => r.pts).join() === '1,3,10');
ok('Cup Pong: 7 of 9 rows limited (Easy, Medium, unlimited Hard)', rows('cuppong').filter((x) => x.r.cap).length === 7);
ok('Cup Pong no reracks 2/2/6', card('cuppong', 'cp_none').rows.map((r) => r.pts).join() === '2,2,6');
ok('Darts Cricket in order 2/4/6', card('darts', 'dt_order').rows.map((r) => r.pts).join() === '2,4,6');
ok('Flick first to 1: 1/1/3, Easy and Medium limited', card('flicksoccer', 'fs_1').rows.map((r) => `${r.pts}${r.cap ? 'L' : ''}`).join() === '1L,1L,3');
ok('Battleship Quick 1/1/1, Easy limited', card('battleship', 'bs_quick').rows.map((r) => `${r.pts}${r.cap ? 'L' : ''}`).join() === '1L,1,1');
ok('Connect 4: Expert row, no online', sheetModel('connect4')[0].rows.length === 4 && !sheetModel('connect4').some((c) => c.kind === 'online'));
for (const id of ['connect4', 'dominoes', 'uno', 'parchis', 'business']) ok(`${id}: no Online card (no online play)`, !sheetModel(id).some((c) => c.kind === 'online'));
ok('not a wins game: no sheet', sheetModel('skeeball').length === 0);
// Session 7 (Matt, 2026-11-04): Hoops Until you score on Hard = 2; a table of computers adds up each one's points.
ok('Hoops Until you score 1/1/2, One shot 1/3/5', card('hoops4', 'h4_until').rows.map((r) => r.pts).join() === '1,1,2' && card('hoops4', 'h4_one').rows.map((r) => r.pts).join() === '1,3,5');
for (const id of ['chinchon', 'escoba', 'parchis']) {
  const tb = sheetModel(id).find((c) => c.kind === 'table');
  ok(`${id}: "Easy + Hard = 5" from the code`, tb && tb.ex.tiers.join() === '1,3' && tb.ex.pts === 5, tb);
  const g = gamePoints({ total: won(1), byDiff: { easy: won(1) }, byMode: { [id === 'parchis' ? 'ai=beginner-pro|humans=1' : 'ai=easy-hard']: { easy: won(1) } } }, id).pts;
  ok(`${id}: a real Easy + Hard win is worth what the note says`, g === tb.ex.pts, g);
}
ok('only the table games carry the note', POINT_GAMES.filter((id) => sheetModel(id).some((c) => c.kind === 'table')).sort().join() === 'chinchon,escoba,parchis');
ok('Chinchón: Under 100 points 1/1/2, 100+ points 1/2/4', card('chinchon', 'cc_short').rows.map((r) => r.pts).join() === '1,1,2' && card('chinchon', 'cc_normal').rows.map((r) => r.pts).join() === '1,2,4');
ok('Monopoly Deal: no older-wins row', !sheetModel('business').some((c) => c.kind === 'older'));

// Strings: every key the sheet can ask for exists in EN and ES, and the rendered sheet has nothing unfilled.
const keys = new Set(['lbpt_diff', 'lbpt_per_win', 'lbpt_cap', 'lbpt_tables_b', 'lbpt_tables', 'lbpt_tables_ex', 'lbps_vs_cpu', 'lb_pts_online',
  'gs_diff_beginner', 'gs_diff_intermediate', 'gs_diff_pro', 'gs_diff_expert']);
for (const id of POINT_GAMES) for (const c of sheetModel(id)) if (c.key) { keys.add('lbpt_k_' + c.key); keys.add('lbpt_h_' + id); }
for (const k of keys) ok(`string ${k} in EN and ES`, STRINGS.en[k] != null && STRINGS.es[k] != null);
ok('no em dashes', [...keys].every((k) => !/—/.test(String(STRINGS.en[k]) + String(STRINGS.es[k]))));
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const { setLang } = await import('../js/i18n.js');
for (const lang of ['en', 'es']) {
  setLang(lang);
  for (const id of POINT_GAMES) {
    const html = pointsSheetHTML(id), txt = html.replace(/<[^>]+>/g, ' ');
    ok(`${id} ${lang}: renders, nothing unfilled`, html.length > 300 && !/[{}]|undefined|null|NaN|lbpt_|lbps_/.test(txt), txt.slice(0, 200));
    ok(`${id} ${lang}: in ${lang}`, txt.includes(STRINGS[lang].gs_diff_beginner) || id === 'yahtzee');
    ok(`${id} ${lang}: one circle per limited cell`, (html.match(/class="lbpt-cap"/g) || []).length === rows(id).filter((x) => x.r.cap).length);
  }
}
setLang('en');

// More opponents pay more (Matt, 2026-11-04, docs/mockups/opponents/): every cell checked against gamePoints with a
// real-shaped record (the mode withMode saves), as above.
const CNT_MODE = { business: (n) => `ai=${n}`, uno: (n) => `n=${n + 1}` };
for (const id of Object.keys(CNT_MODE)) {
  const cs = sheetModel(id).filter((c) => c.kind === 'count');
  ok(`${id}: one column per number of computers`, cs.map((c) => c.n).join() === (id === 'business' ? '1,2,3,4' : '1,2,3'));
  for (const c of cs) for (const r of c.rows) {
    const d = id === 'business' ? ['easy', 'normal', 'hard'][r.tier - 1] : LV(id, r.tier);
    const got = gamePoints({ total: won(W), byDiff: { [d]: won(W) }, byMode: { [CNT_MODE[id](c.n)]: { [d]: won(W) } } }, id).pts;
    ok(`${id} ${c.n} computers tier ${r.tier}: ${r.pts} a win`, got === W * r.pts && r.pts === [1, 2, 3][r.tier - 1] * c.n, { got, row: r });
  }
}
ok('Monopoly Deal Hard: 3/6/9/12', sheetModel('business').filter((c) => c.kind === 'count').map((c) => c.rows[2].pts).join() === '3,6,9,12');
ok('Uno Hard: 3/6/9', sheetModel('uno').filter((c) => c.kind === 'count').map((c) => c.rows[2].pts).join() === '3,6,9');
const OPP_MODE = { chinchon: (n) => `n=${n + 1}|vc=points|sl=100`, escoba: (n) => `n=${n + 1}|to=21`, eightball: (n) => `game=${n === 2 ? 'ct' : '8'}|racks=1` };
for (const id of Object.keys(OPP_MODE)) {
  const on = sheetModel(id).find((c) => c.kind === 'online');
  ok(`${id}: online by opponents`, on && on.opp && on.opp.length >= 2, on);
  for (const o of on.opp) {
    const got = gamePoints({ total: won(W), byDiff: { mp: won(W) }, byMode: { [OPP_MODE[id](o.n)]: { mp: won(W) } } }, id).pts;
    ok(`${id} online ${o.n} opponents: ${o.pts} a win`, got === W * o.pts && o.pts === on.rows[0].pts * o.n, { got, o });
  }
}
ok('online with no saved seats = the plain online points', gamePoints({ total: won(1), byDiff: { mp: won(1) } }, 'chinchon').pts === 3);
const ct = sheetModel('eightball').find((c) => c.kind === 'cutthroat');
ok('Pool Cutthroat: Hard, 3 racks = 20', ct && ct.ex.pts === 20, ct);
ok('Pool Cutthroat Hard 3 racks, real record', gamePoints({ total: won(1), byDiff: { hard: won(1) }, byMode: { 'game=ct|racks=3': { hard: won(1) } } }, 'eightball').pts === 20);
ok('Pool Cutthroat Hard 1 rack (recorded Medium): 6', gamePoints({ total: won(1), byDiff: { medium: won(1) }, byMode: { 'game=ct|racks=1': { hard: won(1) } } }, 'eightball').pts === 6);
ok('Pool 8-ball 1 rack unchanged (Hard -> Medium 3)', gamePoints({ total: won(1), byDiff: { medium: won(1) }, byMode: { 'game=8|racks=1': { hard: won(1) } } }, 'eightball').pts === 3);
// ASSUMED_MODES (js/stats-corrections.js): Matt's own word on his Monopoly Deal history, read time only, his code only.
const md = { total: { played: 16, won: 11, lost: 5 }, byDiff: { hard: { played: 1, won: 0, lost: 1 }, normal: { played: 11, won: 7, lost: 4 }, legacy: { played: 4, won: 4, lost: 0 } },
  byMode: { 'ai=2': { hard: { played: 1, won: 0, lost: 1 }, normal: { played: 1, won: 1, lost: 0 } } } };
const before = JSON.stringify(md);
const WHO = ASSUMED_MODES.business[0].code;   // read from the config: no player code typed into a test
ok('assumed: 11 Medium wins against 2 computers = 44', gamePoints(md, 'business', null, WHO).pts === 44);
ok('assumed: the record itself is untouched', JSON.stringify(md) === before);
ok('assumed: nobody else gets it (same record, another code)', gamePoints(md, 'business', null, 'AAAAA').pts === 20);
ok('assumed: no code, no assumption', gamePoints(md, 'business').pts === 20);
ok('assumed: other games untouched', gamePoints(md, 'uno', null, WHO).pts === gamePoints(md, 'uno').pts);
console.log(`\nlb-points-sheet tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
