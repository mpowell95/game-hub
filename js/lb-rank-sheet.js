// lb-rank-sheet.js - "how this board is calculated and ranked" for every game that is NOT ranked by points per
// win (Matt, 2026-11-02: "We should explain how everything is calculated and ranked"). Shown by Leaderboard v2's (i)
// and its "See how scores are calculated" button (js/leaderboard2-ui.js infoHTML); Leaderboard v2 opens only on admin
// devices. Session 7 (2026-11-04): every sheet is Matt's approved mockup, docs/mockups/final/sheet-<game>.html, word
// for word; the old lines' strings stay in js/strings.js (rule 5 spirit: nothing removed that a later screen may want).
//
// Every line was checked against the board's own code (js/leaderboard-ui.js gameMetricAt, boardTierOf,
// boardMetricCmp; js/leaderboard-rank.js; js/players-agg.js). Point values are READ from the games' own points
// modules, never typed in, so a sheet cannot drift from what the board adds up. Sudoku, Murdoku, Nuts & Bolts and
// Minesweeper are points boards on admin devices (js/puzzle-points.js, `isPuzzlePts`), the only place v2 opens.
// tools/test-lb-rank-sheet.mjs pins the numbers and the EN/ES strings.
import { WO_TIERS, woEarnedPoints } from './arrow-maze-time.js';
import { GL_TIERS, GL_BAND_START, glLevelPoints, glHintedPoints } from './gridlock-points.js';
import { WW_TIERS, WW_MULT, wwStarsFor } from './word-weaver-points.js';
import { HINT_STEPS, LEVEL_POINTS, LEVEL_CAP } from './puzzle-points.js';
import { ensurePointsSheetCss, pointsTableHTML, capNoteHTML, shapeHTML, LEVEL_KEY } from './lb-points-sheet.js';
import { makeT } from './i18n.js';
import { isAdminDevice } from './admin-config.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- the model ----------------------------------------------------------------------------------------------
// A sheet is a list of cards, each with an optional header `h` (string key; none = no header bar):
//   steps: [k]                 a numbered list ("Ranked by")
//   text:  k | [k]             one or more short lines
//   rows:  [{ ic, k }]         plain rows: ic = 'm:<medal>' or an emoji
//   grid:  { sup, cols, rows: [{ ic, k, vals }] }, foot?   points by level x a count (the first column bold)
//   table: { left, cols, rows: [{ ic, k, v | vk, cap }], cap }   Difficulty | Points (js/lb-points-sheet.js's table)
//   gl:    [{ ic, k, rows: [{ a, b, pts, hint }] }]   Gridlock: level ranges under each difficulty
const ranked = (...steps) => ({ h: 'lbrs_h_by', steps });
const hardest = (then) => ranked('lbrs_by_hardest', then);
/** Sudoku / Murdoku: points by level x help used (0, 1, 2, 3+), straight from HINT_STEPS. */
const helpGrid = (sup) => ({ h: 'lbrs_h_puz', grid: { sup, cols: ['0', '1', '2', '3+'],
  rows: [1, 2, 3, 4].map((tr) => ({ ic: tr, k: LEVEL_KEY[tr], vals: HINT_STEPS[tr].slice() })) } });
/** Nuts & Bolts / Minesweeper: Difficulty | Points per level (board), a circle where LEVEL_CAP limits a level. */
function levelTable(id, per) {
  const cap = LEVEL_CAP[id] || {};
  const rows = [1, 2, 3, 4].map((tr) => ({ ic: tr, k: LEVEL_KEY[tr], v: LEVEL_POINTS[id][tr], cap: cap[tr] != null }));
  const caps = Object.values(cap);
  return { table: { left: 'lbpt_diff', cols: [per], rows, cap: caps.length ? caps[0] : 0 } };
}
/** Gridlock: one row per 500 levels (glLevelPoints steps every 500) under each 1000-level band. */
function gridlockGroups() {
  return GL_TIERS.map((band, i) => ({ ic: i + 1, k: LEVEL_KEY[i + 1], rows: [0, 500].map((off) => {
    const a = GL_BAND_START[band] + off;
    const b = band === 'expert' && off ? null : a + 499;
    return { a, b, pts: glLevelPoints(a), hint: glHintedPoints(a) };
  }) }));
}

const SHEETS = {
  ballrun: () => [hardest('lbrs_br_by')],
  brickblitz: () => [hardest('lbrs_bz_by')],
  snake: () => [hardest('lbrs_sn_by')],
  tower: () => [hardest('lbrs_tw_by')],
  hillclimb: () => [
    { table: { left: 'lbrs_hc_stage', cols: ['lbrs_hc_level'], rows: ['countryside', 'desert', 'arctic', 'moon'].map((s, i) => ({ ic: i + 1, k: 'gs_hc_' + s, vk: LEVEL_KEY[i + 1] })) } },
    ranked('lbrs_hc_by1', 'lbrs_hc_by2'),
  ],
  contexto: () => [
    { rows: [['gold', 'lbrs_ct_gold'], ['silver', 'lbrs_ct_silver'], ['bronze', 'lbrs_ct_bronze'], ['iron', 'lbrs_ct_iron']].map(([m, k]) => ({ ic: 'm:' + m, k })) },
    ranked('lbrs_ct_by1', 'lbrs_ct_by2', 'lbrs_ct_by3'),
  ],
  golf: () => [{ h: 'lbrs_h_by', text: ['lbrs_gf_by1', 'lbrs_gf_by2'] }],
  gridlock: () => [{ gl: gridlockGroups() }],
  // Matt, 2026-11-03 (151 words to 30, mockup v4): ONE table, a level per row, points by hints used or lives lost
  // (0, 1, 2, 3+; read from woEarnedPoints, today's boards), and Rush in one line.
  wayout: () => [
    { h: 'lbrs_h_lvl', grid: { sup: 'lbrs_wo_sup', cols: ['0', '1', '2', '3+'],
      rows: WO_TIERS.map((b, i) => ({ ic: i + 1, k: LEVEL_KEY[i + 1], vals: [0, 1, 2, 3].map((n) => woEarnedPoints(b, n)) })) } },
    { h: 'lbrs_h_rush', text: 'lbrs_wo_rush' },
  ],
  // Points = stars (0 hints 3, 1 hint 2, 2+ 1) x the band's multiplier (1/2/3/4), both from word-weaver-points.js.
  wordweaver: () => [{ h: 'lbrs_h_lvl', grid: { sup: 'lbrs_ww_sup', cols: ['0', '1', '2+'],
    rows: WW_TIERS.map((b, i) => ({ ic: i + 1, k: LEVEL_KEY[i + 1], vals: [0, 1, 2].map((h) => wwStarsFor(h) * WW_MULT[b]) })) }, foot: 'lbrs_ww_foot' }],
  holdem: () => [{ h: 'gs_hb_bank', text: ['lbrs_hb_by1', 'lbrs_hb_by2'] }, { h: 'lbrs_h_wins', text: 'lbrs_hb_by3' }],
  minesweeper: () => [levelTable('minesweeper', 'lbpt_per_board')],
  // Points held for players (2026-11-04): the points table only where the board is on points (admin devices).
  nutsbolts: () => (isAdminDevice() ? [levelTable('nutsbolts', 'lbpt_per_level')] : [hardest('lbrs_nb_by')]),
  murdoku: () => [helpGrid('lbrs_mk_sup')],
  sudoku: () => [helpGrid('lbrs_su_sup')],
  skeeball: () => [{ h: 'lbrs_total', text: 'lbrs_sk_by1' }, { h: 'gs_sk_best_game', text: 'lbrs_sk_by2' }],
  spellingbee: () => [
    { h: 'lbrs_h_by', text: 'lbrs_sb_by' },
    { h: 'lbrs_h_days', rows: ['🥇', '🥈', '🥉', '🧠', '🐝', '📅'].map((ic, i) => ({ ic, k: 'lbrs_sb_d' + (i + 1) })) },
  ],
};
export const RANK_SHEET_GAMES = Object.keys(SHEETS);
/** The cards for a game, or [] when it has no rank sheet (the wins games use js/lb-points-sheet.js). */
export function rankSheetModel(id) { return SHEETS[id] ? SHEETS[id]() : []; }

// --- HTML -------------------------------------------------------------------------------------------------------
const medal = (m) => `<img class="lbrs-medal" src="${new URL(`../icons/medal-${m}.png`, import.meta.url).href}" alt="" draggable="false">`;
function icon(ic) {
  if (ic == null) return '';
  if (typeof ic === 'number') return shapeHTML(ic);
  if (ic.startsWith('m:')) return `<span class="lbrs-ic">${medal(ic.slice(2))}</span>`;
  return `<span class="lbrs-ic lbrs-emo" aria-hidden="true">${ic}</span>`;
}
/** A points grid: levels down the side, a count across the top. The first column is the full value. */
function gridHTML(g) {
  const head = `<thead><tr><th></th><th colspan="${g.cols.length}" class="lbrs-sup">${esc(t(g.sup))}</th></tr>`
    + `<tr><th></th>${g.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>`;
  const body = g.rows.map((r) => `<tr><td class="lbrs-gl">${icon(r.ic)}<span>${esc(t(r.k))}</span></td>${r.vals.map((v, i) => `<td${i === 0 ? ' class="lbrs-full"' : ''}>${v}</td>`).join('')}</tr>`).join('');
  return `<table class="lbrs-grid">${head}<tbody>${body}</tbody></table>`;
}
function glHTML(groups) {
  const head = `<thead><tr><th class="lbrs-glh" rowspan="2">${esc(t('lbrs_gl_levels'))}</th><th colspan="2" class="lbrs-sup">${esc(t('lbrs_gl_points'))}</th></tr>`
    + `<tr><th>${esc(t('lbrs_gl_nohint'))}</th><th>${esc(t('lbrs_gl_hint'))}</th></tr></thead>`;
  const rng = (r) => (r.b == null ? `${r.a}+` : `${r.a}-${r.b}`);
  const body = groups.map((g) => `<tr class="lbrs-grp"><td colspan="3">${icon(g.ic)}<span>${esc(t(g.k))}</span></td></tr>`
    + g.rows.map((r) => `<tr><td class="lbrs-rng">${rng(r)}</td><td class="lbrs-full">${r.pts}</td><td class="lbrs-hint">${r.hint}</td></tr>`).join('')).join('');
  return `<table class="lbrs-grid lbrs-glt"><colgroup><col><col class="lbrs-glc"><col class="lbrs-glc"></colgroup>${head}<tbody>${body}</tbody></table>`;
}
function tableHTML(tb) {
  const rows = tb.rows.map((r) => ({ ic: r.ic, label: t(r.k), vals: [r.vk ? { v: t(r.vk), txt: true } : { v: r.v, cap: !!r.cap }] }));
  return pointsTableHTML({ left: t(tb.left), cols: tb.cols.map((c) => t(c)), rows }) + (tb.cap ? capNoteHTML(tb.cap) : '');
}
function cardHTML(c) {
  const head = c.h ? `<div class="lbps-ch"><span class="lbps-ct">${esc(t(c.h))}</span></div>` : '';
  let body = '';
  if (c.grid) body = gridHTML(c.grid);
  else if (c.gl) body = glHTML(c.gl);
  else if (c.table) body = tableHTML(c.table);
  else if (c.steps) body = `<ol class="lbrs-ol">${c.steps.map((k) => `<li>${esc(t(k))}</li>`).join('')}</ol>`;
  else if (c.text) body = `<div class="lbrs-one">${[].concat(c.text).map((k) => esc(t(k))).join('<br>')}</div>`;
  else if (c.rows) body = c.rows.map((r) => `<div class="lbrs-r">${icon(r.ic)}<span class="lbrs-n">${esc(t(r.k))}</span></div>`).join('');
  const foot = c.foot ? `<div class="lbrs-foot">${esc(t(c.foot))}</div>` : '';
  return `<div class="lbps-card">${head}${body}${foot}</div>`;
}
/** The sheet's body for a non-points game, or '' when it has none. */
export function rankSheetHTML(id) {
  const cards = rankSheetModel(id);
  if (!cards.length) return '';
  ensurePointsSheetCss();
  ensureRankSheetCss();
  return `<div class="lbps lbrs">${cards.map(cardHTML).join('')}</div>`;
}
function ensureRankSheetCss() {
  if (typeof document === 'undefined' || document.getElementById('lbrs-css')) return;
  const el = document.createElement('style');
  el.id = 'lbrs-css';
  el.textContent = [
    '.lbrs-ol{margin:0;padding:12px 14px 12px 34px;font-size:16px;line-height:1.4}',
    '.lbrs-ol li+li{margin-top:8px}',
    '.lbrs-ol li::marker{font-weight:800}',
    '.lbrs-one{padding:14px;font-size:16px;line-height:1.4}',
    '.lbrs-r{display:flex;align-items:center;gap:12px;padding:0 14px;min-height:50px;border-top:1px solid var(--ps-row);font-size:16px}',
    '.lbrs-r:first-child,.lbps-ch+.lbrs-r{border-top:0}',
    '.lbrs-n{flex:1;min-width:0}',
    '.lbrs-ic{display:inline-flex;justify-content:center;width:26px;flex:none}',
    '.lbrs-emo{font-size:20px;line-height:1}',
    '.lbrs-medal{width:26px;height:auto;display:block}',
    '.lbrs-foot{padding:0 14px 12px;font-size:14px;color:var(--ps-note)}',
    // Points grids (Arrow Maze, Sudoku, Murdoku, Word Weaver, Gridlock). Headers bright (Matt, 2026-11-03).
    '.lbrs-grid{width:100%;border-collapse:collapse;font-size:17px;font-variant-numeric:tabular-nums}',
    '.lbrs-grid th{font-size:14px;font-weight:700;color:var(--ps-th);text-align:center;width:44px;padding:4px 0 7px;white-space:nowrap}',
    '.lbrs-grid th:first-child{width:auto}',
    '.lbrs-grid th.lbrs-sup{padding:9px 0 3px;border-bottom:1px solid var(--ps-line);white-space:normal;line-height:1.25}',
    '.lbrs-grid td{text-align:center;height:46px;padding:0;border-top:1px solid var(--ps-row);color:var(--ps-dim)}',
    '.lbrs-grid td.lbrs-full{color:var(--ps-ink);font-weight:800;font-size:20px}',
    '.lbrs-grid td.lbrs-gl{text-align:left;padding-left:14px;color:var(--ps-ink);font-size:16px;white-space:nowrap}',
    '.lbrs-gl span:last-child,.lbrs-grp span:last-child{margin-left:12px;vertical-align:middle}',
    '.lbrs-glt .lbrs-glc{width:88px}',
    '.lbrs-glt th{width:auto}',
    '.lbrs-glt th.lbrs-glh{text-align:left;padding:0 0 7px 46px;vertical-align:bottom;font-size:15px}',
    '.lbrs-glt th.lbrs-sup{font-size:15px}',
    '.lbrs-glt td{height:40px}',
    '.lbrs-glt tr.lbrs-grp td{text-align:left;padding:0 14px;height:34px;background:var(--ps-grp);color:var(--ps-th);font-size:14px;font-weight:700}',
    '.lbrs-glt td.lbrs-rng{text-align:left;padding-left:46px;font-size:17px;font-weight:600;color:var(--ps-ink);white-space:nowrap}',
    '.lbrs-glt td.lbrs-hint{color:var(--ps-ink);font-weight:700;font-size:18px}',
  ].join('\n');
  document.head.appendChild(el);
}

export default { RANK_SHEET_GAMES, rankSheetModel, rankSheetHTML };
