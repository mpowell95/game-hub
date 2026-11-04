// test-lb-rank-sheet.mjs - the "how it is calculated and ranked" sheets (js/lb-rank-sheet.js, Matt 2026-11-02):
// every game that is not ranked by points per win has one, every number on it is the games' own points code, and
// every line exists in English and Spanish with nothing left unfilled. Pure; no browser.
//   node tools/test-lb-rank-sheet.mjs
import { RANK_SHEET_GAMES, rankSheetModel, rankSheetHTML } from '../js/lb-rank-sheet.js';
import { LB_RULES } from '../js/lb-rules.js';
import { POINT_GAMES } from '../js/lb-points.js';
import { WO_BAND_POINTS, WO_TIERS, woEarnedPoints } from '../js/arrow-maze-time.js';
import { glLevelPoints, glHintedPoints, glBandOf } from '../js/gridlock-points.js';
import { puzzlePoints, LEVEL_POINTS, LEVEL_CAP } from '../js/puzzle-points.js';
import { wwStarsFor, WW_MULT } from '../js/word-weaver-points.js';
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

// Gridlock: each row is one points value all the way through its range, the ranges run on with no gap, and each
// sits under the band the board's tabs use; the Hint column is the hinted value.
{
  const groups = rankSheetModel('gridlock')[0].gl;
  let next = 1;
  groups.forEach((g, gi) => {
    ok(`gridlock group ${gi}: shape ${gi + 1}`, g.ic === gi + 1);
    for (const r of g.rows) {
      const { a, b } = r;
      ok(`gridlock ${a}-${b ?? 'up'} starts where the last ended`, a === next, { a, next });
      const end = b ?? a + 4999;
      ok(`gridlock ${a}-${b ?? 'up'}: ${r.pts} points all through`, [a, Math.floor((a + end) / 2), end].every((n) => glLevelPoints(n) === r.pts));
      ok(`gridlock ${a}-${b ?? 'up'}: ${r.hint} with a hint all through`, [a, end].every((n) => glHintedPoints(n) === r.hint));
      ok(`gridlock ${a}: under the band of the tab`, ['easy', 'medium', 'hard', 'expert'][gi] === glBandOf(a) && glBandOf(end) === glBandOf(a));
      next = (b ?? Infinity) + 1;
    }
  });
  ok('gridlock: last row runs on for ever', groups[3].rows[1].b == null);
  ok('gridlock: 1-500 1/1 ... 3501+ 8/4', groups.flatMap((g) => g.rows.map((r) => `${r.pts}/${r.hint}`)).join() === '1/1,2/1,3/2,4/2,5/3,6/3,7/4,8/4');
}

// Arrow Maze (2026-11-03, one table): column 0 = a clear's full points, then 1, 2 and 3+ hints used or lives lost,
// the last column holding for any more; every number is woEarnedPoints on today's boards.
{
  const [lvl, rush] = rankSheetModel('wayout');
  ok('arrow maze: two cards, the table and Rush', lvl.grid && rush.text === 'lbrs_wo_rush');
  ok('arrow maze: columns 0, 1, 2, 3+', lvl.grid.cols.join() === '0,1,2,3+');
  WO_TIERS.forEach((b, i) => {
    const v = lvl.grid.rows[i].vals;
    ok(`arrow maze ${b}: a clear is ${v[0]}`, v[0] === WO_BAND_POINTS[b] && lvl.grid.rows[i].ic === i + 1);
    ok(`arrow maze ${b}: ${v.join(', ')}`, [0, 1, 2, 3, 4, 7].every((k) => woEarnedPoints(b, k) === v[Math.min(k, 3)]));
  });
  ok('arrow maze: Expert row 8, 5, 3, 1', lvl.grid.rows[3].vals.join() === '8,5,3,1');
}

// Word Weaver: points per level = stars for 0 / 1 / 2+ hints x the band's multiplier.
{
  const [c] = rankSheetModel('wordweaver');
  ok('word weaver: one table + "bought hints" line', c.grid && c.foot === 'lbrs_ww_foot' && c.grid.cols.join() === '0,1,2+');
  ['easy', 'medium', 'hard', 'expert'].forEach((b, i) => {
    const v = c.grid.rows[i].vals;
    ok(`word weaver ${b}: ${v.join(', ')}`, [0, 1, 2, 5].every((h) => wwStarsFor(h) * WW_MULT[b] === v[Math.min(h, 2)]));
  });
  ok('word weaver: Expert 12, 8, 4', c.grid.rows[3].vals.join() === '12,8,4');
}

// Sudoku / Murdoku: the points table IS puzzle-points' HINT_STEPS; real records score what the cells say.
for (const id of ['sudoku', 'murdoku']) {
  const [c] = rankSheetModel(id);
  ok(`${id}: header "${id === 'sudoku' ? 'Hints or mistakes' : 'Hints or wrong boards'}"`, c.h === 'lbrs_h_puz' && c.grid.sup === (id === 'sudoku' ? 'lbrs_su_sup' : 'lbrs_mk_sup'));
  [1, 2, 3, 4].forEach((tr) => {
    const v = c.grid.rows[tr - 1].vals, d = ['easy', 'medium', 'hard', 'expert'][tr - 1];
    const sub = id === 'sudoku' ? 'sd' : 'mu', clean = id === 'sudoku' ? 'noHint' : 'clean';
    const rec = { total: { won: 4 }, byDiff: { [d]: { won: 4 } }, [sub]: { [clean]: { [d]: 1 }, hc: { [d]: { h1: 1, h2: 1, h3: 1 } } } };
    ok(`${id} ${d}: ${v.join(', ')} adds up on a record`, puzzlePoints(rec, id).pts === v.reduce((x, y) => x + y, 0), puzzlePoints(rec, id));
  });
}
// Nuts & Bolts / Minesweeper: Difficulty | Points per level (board); Nuts & Bolts Easy circled, 20 in the note.
for (const [id, per] of [['nutsbolts', 'lbpt_per_level'], ['minesweeper', 'lbpt_per_board']]) {
  const tb = rankSheetModel(id)[0].table;
  ok(`${id}: ${tb.rows.map((r) => r.v).join('/')}, header ${per}`, tb.cols[0] === per && tb.rows.map((r) => r.v).join() === [1, 2, 3, 4].map((x) => LEVEL_POINTS[id][x]).join());
  ok(`${id}: circled = LEVEL_CAP`, tb.rows.map((r) => r.cap).join() === [1, 2, 3, 4].map((x) => (LEVEL_CAP[id] || {})[x] != null).join() && tb.cap === ((LEVEL_CAP[id] || {})[1] || 0));
}
ok('nuts & bolts values untouched: 1, 2, 4, 8, Easy at most 20', LEVEL_POINTS.nutsbolts[1] === 1 && LEVEL_POINTS.nutsbolts[2] === 2 && LEVEL_POINTS.nutsbolts[3] === 4 && LEVEL_POINTS.nutsbolts[4] === 8 && LEVEL_CAP.nutsbolts[1] === 20);
ok('nuts & bolts html: one circle + the 20 note', (() => { const h = rankSheetHTML('nutsbolts'); return (h.match(/lbpt-cap"/g) || []).length === 1 && h.includes('first 20 points'); })());
ok('minesweeper html: no circle, no note', !/lbpt-cap/.test(rankSheetHTML('minesweeper')));
// The mockups' words, card by card (EN).
const words = (id) => rankSheetModel(id).map((c) => [c.h || '', ...(c.steps || []), ...[].concat(c.text || []), ...(c.rows || []).map((r) => r.k)].map((k) => (k ? STRINGS.en[k] : '')).join('|')).join(' / ');
const WORDS = {
  ballrun: 'Ranked by|Hardest level|Most obstacles on it', brickblitz: 'Ranked by|Hardest level|Best score on it',
  snake: 'Ranked by|Hardest level|Longest snake on it', tower: 'Ranked by|Hardest level|Tallest tower on it',
  golf: 'Ranked by|Best round on Pine Valley, holes 1 to 3.|Lowest score wins.',
  holdem: 'Bankroll|Biggest bankroll wins.|Everyone starts with $25,000. / Wins|Most tournaments won.',
  skeeball: 'Total|Every game added up. / Best game|Highest single game.',
  contexto: '|Gold: solved with no hints|Silver: solved with 1 hint|Bronze: solved with 2 hints|Iron: solved with 3+ hints / Ranked by|Most gold|Then silver, bronze, then iron|Then fewest guesses + hints per puzzle',
  spellingbee: "Ranked by|Points found on each puzzle's own day. / Under each name: total days|Finished 1st|Finished 2nd|Finished 3rd|Reached Genius|Got Queen Bee|Played",
};
for (const [id, w] of Object.entries(WORDS)) ok(`${id}: the mockup's words`, words(id) === w, words(id));

ok('hill climb: Countryside Easy ... Moon Expert', rankSheetModel('hillclimb')[0].table.rows.map((r) => `${r.k}:${r.ic}:${r.vk}`).join() === 'gs_hc_countryside:1:gs_diff_beginner,gs_hc_desert:2:gs_diff_intermediate,gs_hc_arctic:3:gs_diff_pro,gs_hc_moon:4:gs_diff_expert');
ok('hill climb: Ranked by Hardest stage, Furthest distance on it', rankSheetModel('hillclimb')[1].steps.join() === 'lbrs_hc_by1,lbrs_hc_by2');

// Strings: every sheet renders in both languages with every key found and every {var} filled.
// Node has no localStorage, so setLang would be a no-op and the Spanish pass would render English: a small shim.
const mem = {};
globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
const keysOf = (c) => [...(c.rows || []).map((r) => r.k), ...(c.steps || []), ...[].concat(c.text || []), ...(c.foot ? [c.foot] : []),
  ...(c.grid ? [c.grid.sup, ...c.grid.rows.map((r) => r.k)] : []), ...(c.table ? [c.table.left, ...c.table.cols, ...c.table.rows.flatMap((r) => [r.k, r.vk].filter(Boolean))] : []),
  ...(c.gl ? ['lbrs_gl_levels', 'lbrs_gl_points', 'lbrs_gl_nohint', 'lbrs_gl_hint', ...c.gl.map((g) => g.k)] : [])];
for (const id of RANK_SHEET_GAMES) {
  for (const c of rankSheetModel(id)) {
    for (const k of [...(c.h ? [c.h] : []), ...keysOf(c)]) ok(`${id}: string ${k} in EN and ES`, STRINGS.en[k] != null && STRINGS.es[k] != null);
  }
  for (const lang of ['en', 'es']) {
    setLang(lang);
    const html = rankSheetHTML(id);
    const k0 = rankSheetModel(id).flatMap((c) => [...(c.h ? [c.h] : []), ...keysOf(c)]).find((k) => STRINGS.en[k] !== STRINGS.es[k]);
    ok(`${id} ${lang}: in ${lang === 'es' ? 'Spanish' : 'English'}`, html.includes(esc(STRINGS[lang][k0]).split('\n')[0]), k0);
    ok(`${id} ${lang}: renders, nothing unfilled`, html.length > 150 && !/[{}]|undefined|null|NaN/.test(html.replace(/<[^>]+>/g, '')), html.match(/[^>]{0,30}(?:[{}]|undefined|null|NaN)[^<]{0,30}/));
  }
}
setLang('en');
ok('no em dashes', Object.keys(STRINGS.en).filter((k) => k.startsWith('lbrs_')).every((k) => !/—/.test(STRINGS.en[k] + STRINGS.es[k])));
ok('not a sheet: no rank sheet for a wins game', rankSheetHTML('cuppong') === '');

console.log(`\nlb-rank-sheet tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
