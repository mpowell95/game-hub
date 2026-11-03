// test-lb-points-sheet.mjs - the points sheet (js/lb-points-sheet.js, Matt's mockup v7, 2026-11-02): the cards on
// the board's (i) and the stats page. Pure; no browser.
// The failure it exists for: a sheet that says something the board does not do. Mockup v6 marked Tic Tac Toe
// Ultimate Easy/Medium as under the 20-point limit because the limit was read from the level alone. So every row
// of every game is checked against gamePoints with real-shaped records: 100 such wins must give 100 x the row's
// points, or exactly 20 when the row shows the limit.
//   node tools/test-lb-points-sheet.mjs
import { sheetModel } from '../js/lb-points-sheet.js';
import { gamePoints, POINT_GAMES, CAP } from '../js/lb-points.js';
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
  const rank = { opt: 0, cpu: 0, table: 1, older: 1, online: 2, limit: 3 };
  ok(`${id}: order options, computers, online, limit`, kinds.every((k, i) => !i || rank[k] >= rank[kinds[i - 1]]), kinds);
  const tones = cards.filter((c) => c.kind === 'opt').map((c) => ({ s: 0, n: 1, h: 2 })[c.tone]);
  ok(`${id}: options easiest to hardest`, tones.every((x, i) => !i || x >= tones[i - 1]), tones);
  const limited = rows(id).filter((x) => x.r.cap).length;
  ok(`${id}: a limit box exactly when a row is limited`, (limited > 0) === kinds.includes('limit'));
  for (const { c, r } of rows(id)) ok(`${id}: ${c.key || c.kind} row ${r.tier} has points`, Number.isInteger(r.pts) && r.pts >= 1, r);
}

// Every limited row really is limited, and every other row really pays its points, per gamePoints.
const lvKey = { tictactoe: ['beginner', 'intermediate', 'pro'], dotsboxes: ['beginner', 'intermediate', 'pro'], boggle: ['beginner', 'intermediate', 'pro'] };
const LV = (id, t) => (lvKey[id] || ['easy', 'medium', 'hard', 'expert'])[t - 1];
const MODES = {   // what each option card's wins look like in a real record (withMode's key at the setup level)
  tt_classic: { v: 'classic' }, tt_ultimate: { v: 'ultimate' }, cp_none: { gent: 1, rr: 0 }, cp_some: { gent: 1, rr: 2 },
  dt_order: { kind: 'cricket-order', first: 'me' }, dt_normal: { kind: '301', first: 'me' }, fs_3: { goals: 3, off: 'x' },
  fs_2: { goals: 2, off: 'x' }, eb_3: { racks: 3 }, eb_2: { racks: 2 }, dm_500: { to: 500 }, dm_300: { to: 300 },
  db_large: { size: 'large' }, db_normal: { size: 'medium' }, bs_quick: { size: 'quick' }, bs_classic: { size: 'classic' },
};
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

// Strings: every key the sheet can ask for exists in EN and ES.
const keys = new Set(['lbps_lead', 'lbps_win_on', 'lbps_win_online', 'lbps_win', 'lbps_vs_cpu', 'lbps_tables', 'lbps_tables_note', 'lbps_easy_hard',
  'lbps_older', 'lbps_no_level', 'lbps_limit', 'lbps_limit_body', 'lbps_point', 'lbps_points', 'lb_pts_online']);
for (const id of POINT_GAMES) for (const c of sheetModel(id)) { if (c.key) keys.add('lbps_o_' + c.key); if (c.tag) keys.add('lbps_tag_' + c.tag); }
for (const k of keys) ok(`string ${k} in EN and ES`, STRINGS.en[k] != null && STRINGS.es[k] != null);
ok('limit text carries the ball', /\{ball\}/.test(STRINGS.en.lbps_limit_body) && /\{ball\}/.test(STRINGS.es.lbps_limit_body));
ok('no em dashes', [...keys].every((k) => !/—/.test(String(STRINGS.en[k]) + String(STRINGS.es[k]))));

console.log(`\nlb-points-sheet tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
