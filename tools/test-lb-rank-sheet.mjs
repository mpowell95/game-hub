// test-lb-rank-sheet.mjs - the "how it is calculated and ranked" sheets (js/lb-rank-sheet.js, Matt 2026-11-02):
// every game that is not ranked by points per win has one, every number on it is the games' own points code, and
// every line exists in English and Spanish with nothing left unfilled. Pure; no browser.
//   node tools/test-lb-rank-sheet.mjs
import { RANK_SHEET_GAMES, rankSheetModel, rankSheetHTML } from '../js/lb-rank-sheet.js';
import { LB_RULES } from '../js/lb-rules.js';
import { POINT_GAMES } from '../js/lb-points.js';
import { WO_BAND_POINTS, WO_TIERS, woEarnedPoints, WO_EXPERT8_SINCE } from '../js/arrow-maze-time.js';
import { glLevelPoints, glBandOf } from '../js/gridlock-points.js';
import { wwStarsFor, wwBandOf, WW_MULT } from '../js/word-weaver-points.js';
import { setLang } from '../js/i18n.js';
import STRINGS from '../js/strings.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// Coverage: every board game has a sheet, the points sheet or this one, never both and never neither.
for (const id of Object.keys(LB_RULES)) {
  const pts = POINT_GAMES.includes(id), rank = RANK_SHEET_GAMES.includes(id);
  const wins = LB_RULES[id].by === 'wins' || LB_RULES[id].by === 'cuppong';
  if (wins) ok(`${id}: a wins game, so no rank sheet`, !rank);
  else ok(`${id}: has a rank sheet`, rank && !pts);
}

// Gridlock: each row is one points value all the way through its range, the ranges run on with no gap, and they
// sit in the band the board's tabs use.
{
  const rows = rankSheetModel('gridlock')[0].rows;
  let next = 1;
  for (const r of rows) {
    const { a, b } = r.vars;
    ok(`gridlock ${a}-${b ?? 'up'} starts where the last ended`, a === next, { a, next });
    const end = b ?? a + 4999;
    ok(`gridlock ${a}-${b ?? 'up'}: ${r.v.pts} points all through`, [a, Math.floor((a + end) / 2), end].every((n) => glLevelPoints(n) === r.v.pts));
    ok(`gridlock ${a}: band shape matches the tab`, ['easy', 'medium', 'hard', 'expert'][r.ic - 1] === glBandOf(a));
    next = (b ?? Infinity) + 1;
  }
  ok('gridlock: last row runs on for ever', rows[rows.length - 1].vars.b === undefined);
}

// Arrow Maze: a clear is worth its band's points; each hint or lost heart steps down the listed values, never
// below the last; the old Expert line is what an Expert clear before the change earns.
{
  const [calc, slip] = rankSheetModel('wayout');
  WO_TIERS.forEach((b, i) => {
    ok(`arrow maze ${b}: a clear is ${calc.rows[i].v.pts}`, calc.rows[i].v.pts === WO_BAND_POINTS[b] && woEarnedPoints(b, 0) === WO_BAND_POINTS[b]);
    const listed = slip.rows[i].v.txt.split(', ').map(Number);
    ok(`arrow maze ${b}: slips ${listed.join(', ')}`, [0, 1, 2, 3, 4, 7].every((k) => woEarnedPoints(b, k) === listed[Math.min(k, listed.length - 1)]));
  });
  const old = slip.foot.vars.pts.split(', ').map(Number);
  ok('arrow maze: Expert before the change', [0, 1, 2, 3, 5].every((k) => woEarnedPoints('expert', k, 0, WO_EXPERT8_SINCE - 1) === old[Math.min(k, old.length - 1)]));
}

// Word Weaver: stars by hints, and each band's multiplier over the levels it lists.
{
  const [stars, band] = rankSheetModel('wordweaver');
  [0, 1, 2].forEach((h) => ok(`word weaver: ${h} hints = ${stars.rows[h].v.stars} stars`, wwStarsFor(h) === stars.rows[h].v.stars));
  ok('word weaver: 5 hints is still the last row', wwStarsFor(5) === stars.rows[2].v.stars);
  for (const r of band.rows) {
    const { a, b } = r.vars, end = b ?? a + 2000;
    ok(`word weaver ${a}-${b ?? 'up'}: x${r.v.x}`, [a, end].every((n) => WW_MULT[wwBandOf(n)] === r.v.x) && (b == null || wwBandOf(b + 1) !== wwBandOf(b)));
  }
}

// Hill Climb: stage -> level, in the order the recorder files them.
ok('hill climb: Countryside Easy ... Moon Expert', rankSheetModel('hillclimb')[1].rows.map((r) => `${r.k}:${r.ic}`).join() === 'gs_hc_countryside:1,gs_hc_desert:2,gs_hc_arctic:3,gs_hc_moon:4');

// Strings: every sheet renders in both languages with every key found and every {var} filled.
// Node has no localStorage, so setLang would be a no-op and the Spanish pass would render English: a small shim.
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const keysOf = (c) => [...(c.rows || []), ...(c.lines || []), ...(c.steps || []), ...(c.foot ? [c.foot] : [])].map((x) => (typeof x === 'string' ? x : x.k));
for (const id of RANK_SHEET_GAMES) {
  for (const c of rankSheetModel(id)) {
    for (const k of ['lbrs_h_' + c.h, ...keysOf(c)]) ok(`${id}: string ${k} in EN and ES`, STRINGS.en[k] != null && STRINGS.es[k] != null);
  }
  for (const lang of ['en', 'es']) {
    setLang(lang);
    const html = rankSheetHTML(id);
    ok(`${id} ${lang}: in ${lang === 'es' ? 'Spanish' : 'English'}`, html.includes(lang === 'es' ? STRINGS.es.lbrs_h_rank : STRINGS.en.lbrs_h_rank) || !rankSheetModel(id).some((c) => c.h === 'rank'));
    ok(`${id} ${lang}: renders, nothing unfilled`, html.length > 200 && !/[{}]|undefined|null|NaN/.test(html.replace(/<[^>]+>/g, '')), html.match(/[^>]{0,30}(?:[{}]|undefined|null|NaN)[^<]{0,30}/));
  }
}
setLang('en');
ok('no em dashes', Object.keys(STRINGS.en).filter((k) => k.startsWith('lbrs_')).every((k) => !/—/.test(STRINGS.en[k] + STRINGS.es[k])));
ok('not a sheet: no rank sheet for a wins game', rankSheetHTML('cuppong') === '');

console.log(`\nlb-rank-sheet tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
