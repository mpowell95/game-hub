// lb-rank-sheet.js - "how this board is calculated and ranked" for every game that is NOT ranked by points per
// win (Matt, 2026-11-02: "We should explain how everything is calculated and ranked"). The same cards as the
// points sheet (js/lb-points-sheet.js, whose CSS this reuses). Shown by Leaderboard v2's (i) and its "See how
// scores are calculated" button (js/leaderboard2-ui.js infoHTML); Leaderboard v2 opens only on admin devices.
//
// Every line here was checked against the board's own code on 2026-11-02 (js/leaderboard-ui.js gameMetricAt,
// boardTierOf, boardMetricCmp, lb2Tabs; js/leaderboard-rank.js; js/players-agg.js). Point values are READ from
// the games' own points modules, never typed in, so a sheet cannot drift from what the board adds up.
// tools/test-lb-rank-sheet.mjs pins the numbers and the EN/ES strings.
import { WO_BAND_POINTS, WO_SLIP_POINTS, WO_SLIP_POINTS_OLD, WO_TIERS } from './arrow-maze-time.js';
import { GL_TIERS, GL_BAND_START, glLevelPoints } from './gridlock-points.js';
import { WW_TIERS, WW_BAND_START, WW_MULT, wwStarsFor } from './word-weaver-points.js';
import { ensurePointsSheetCss } from './lb-points-sheet.js';
import { diffShapeSVG } from './difficulty-tiers.js';
import { makeT } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LEVEL_KEY = { 1: 'gs_diff_beginner', 2: 'gs_diff_intermediate', 3: 'gs_diff_pro', 4: 'gs_diff_expert' };
const lv = (tier) => t(LEVEL_KEY[tier]);
const levels = (n) => [1, 2, 3, 4].slice(0, n).map(lv).join(', ');

// --- the model ----------------------------------------------------------------------------------------------
// A sheet is a list of cards: { h: title key tail, rows?, lines?, steps?, foot? }.
//   rows:  [{ ic, k, vars, v }]  ic = a level 1-4, 'm:<medal>' or an emoji; v = { pts } | { stars } | { x } | { txt }
//   lines: [k | { k, vars }]    plain lines            steps: the same, numbered
const L = (k, vars) => ({ k, vars });
const TIE = 'lbrs_r_tie';
/** "Hardest level first, then the best there": Ball Run, Brick Breaker, Snake, Nuts & Bolts, Tower. */
const hardest = (then, first = 'lbrs_r_hardest', foot = 'lbrs_r_beats') => ({ h: 'rank', steps: [first, then, TIE], foot });
const levelTabs = (n) => ({ h: 'tabs', lines: [L('lbrs_t_levels', { levels: levels(n) })] });
const mostPoints = { h: 'rank', steps: ['lbrs_r_most_pts', TIE] };
const most = (...extra) => ({ h: 'rank', steps: ['lbrs_r_most', TIE, ...extra] });
const range = (tier, a, b) => (b === Infinity ? L('lbrs_lv_up', { lv: lv(tier), a }) : L('lbrs_lv_rng', { lv: lv(tier), a, b }));

/** Gridlock: one row per 500 levels (glLevelPoints steps every 500), in its four 1000-level bands. */
function gridlockRows() {
  const out = [];
  GL_TIERS.forEach((band, i) => {
    for (const a of [GL_BAND_START[band], GL_BAND_START[band] + 500]) {
      const b = band === 'expert' && a > GL_BAND_START.expert ? Infinity : a + 499;
      out.push({ ic: i + 1, ...range(i + 1, a, b), v: { pts: glLevelPoints(a) } });
    }
  });
  return out;
}
const SLIP = (pts) => pts.join(', ');

const SHEETS = {
  ballrun: () => [{ h: 'calc', lines: ['lbrs_br_1', 'lbrs_br_2'] }, hardest('lbrs_br_r'), levelTabs(3)],
  brickblitz: () => [{ h: 'calc', lines: ['lbrs_bz_1', 'lbrs_bz_2'] }, hardest('lbrs_bz_r'), levelTabs(3)],
  hillclimb: () => [
    { h: 'calc', lines: ['lbrs_hc_1'] },
    { h: 'stages', rows: ['countryside', 'desert', 'arctic', 'moon'].map((s, i) => ({ ic: i + 1, k: 'gs_hc_' + s, v: { txt: LEVEL_KEY[i + 1] } })) },
    hardest('lbrs_hc_r2', 'lbrs_hc_r1', L('lbrs_hc_beats', { hard: t('gs_hc_moon'), easy: t('gs_hc_countryside') })),
    { h: 'tabs', lines: [L('lbrs_hc_t', { levels: levels(4) })] },
  ],
  snake: () => [
    { h: 'calc', lines: ['lbrs_sn_1', 'lbrs_sn_2'] },
    hardest('lbrs_sn_r'),
    { h: 'tabs', lines: [L('lbrs_t_levels', { levels: levels(3) }), L('lbrs_sn_t', { on: t('gs_sn_walls_on'), off: t('gs_sn_walls_off') })] },
  ],
  nutsbolts: () => [{ h: 'calc', lines: ['lbrs_nb_1', 'lbrs_nb_2'] }, hardest('lbrs_nb_r2', 'lbrs_nb_r1'), levelTabs(4)],
  tower: () => [{ h: 'calc', lines: ['lbrs_tw_1'] }, hardest('lbrs_tw_r'), levelTabs(4)],
  contexto: () => [
    { h: 'medals', rows: [['gold', 'lbrs_ct_m0'], ['silver', 'lbrs_ct_m1'], ['bronze', 'lbrs_ct_m2'], ['iron', 'lbrs_ct_m3']].map(([m, k]) => ({ ic: 'm:' + m, k })) },
    { h: 'calc', lines: ['lbrs_ct_1', 'lbrs_ct_2'] },
    { h: 'rank', steps: ['lbrs_ct_r1', 'lbrs_ct_r2', 'lbrs_ct_r3', 'lbrs_ct_r4', 'lbrs_ct_r5', TIE] },
    { h: 'tabs', lines: ['lbrs_ct_t1', 'lbrs_ct_t2'] },
  ],
  golf: () => [
    { h: 'calc', lines: ['lbrs_gf_1', 'lbrs_gf_2'] },
    { h: 'rank', steps: ['lbrs_gf_r1', TIE], foot: 'lbrs_gf_r2' },
    { h: 'not', lines: ['lbrs_gf_n1', 'lbrs_gf_n2'] },
  ],
  gridlock: () => [
    { h: 'calc', rows: gridlockRows(), lines: ['lbrs_gl_1', 'lbrs_gl_2', 'lbrs_gl_3'] },
    mostPoints,
    { h: 'tabs', lines: [L('lbrs_t_bands', { levels: levels(4) })] },
  ],
  wayout: () => [
    { h: 'calc', rows: WO_TIERS.map((b, i) => ({ ic: i + 1, ...L('lbrs_wo_clear', { lv: lv(i + 1) }), v: { pts: WO_BAND_POINTS[b] } })), lines: ['lbrs_wo_1'] },
    { h: 'slip', lines: ['lbrs_wo_s0'], rows: WO_TIERS.map((b, i) => ({ ic: i + 1, k: LEVEL_KEY[i + 1], v: { txt: SLIP(WO_SLIP_POINTS[b]) } })),
      foot: L('lbrs_wo_s1', { pts: SLIP(WO_SLIP_POINTS_OLD.expert), lv: lv(4) }) },
    mostPoints,
    { h: 'tabs', lines: [L('lbrs_t_lvpts', { levels: levels(4) })] },
    { h: 'rush', lines: ['lbrs_wo_r1', L('lbrs_wo_r2', { w: t('lb_wo_week') }), L('lbrs_wo_r3', { w: t('lb_wo_won') }), L('lbrs_wo_r4', { w: t('lb_wo_past') }), 'lbrs_wo_r5'] },
  ],
  wordweaver: () => [
    { h: 'stars', rows: [0, 1, 2].map((h) => ({ k: 'lbrs_ww_h' + h, v: { stars: wwStarsFor(h) } })) },
    { h: 'band', rows: WW_TIERS.map((b, i) => ({ ic: i + 1, ...range(i + 1, WW_BAND_START[b], i < 3 ? WW_BAND_START[WW_TIERS[i + 1]] - 1 : Infinity), v: { x: WW_MULT[b] } })) },
    { h: 'calc', lines: ['lbrs_ww_1', 'lbrs_ww_2', 'lbrs_ww_3'] },
    mostPoints,
    { h: 'tabs', lines: [L('lbrs_t_bands', { levels: levels(4) })] },
  ],
  holdem: () => [
    { h: 'tabs', lines: [L('lbrs_hb_1', { bank: t('gs_hb_bank') }), 'lbrs_hb_2'] },
    most('lbrs_hb_r'),
  ],
  minesweeper: () => [
    { h: 'calc', lines: ['lbrs_ms_1', 'lbrs_ms_2'] },
    { h: 'rank', steps: ['lbrs_ms_r1', 'lbrs_ms_r2', 'lbrs_ms_r3', TIE], foot: 'lbrs_ms_f' },
    { h: 'tabs', lines: [L('lbrs_ms_t', { levels: levels(4) })] },
  ],
  murdoku: () => [
    { h: 'calc', lines: ['lbrs_nh_1', 'lbrs_nh_2', 'lbrs_mk_1', 'lbrs_mk_2'] },
    { h: 'rank', steps: ['lbrs_nh_r1', 'lbrs_nh_r2', 'lbrs_nh_r3', 'lbrs_nh_r4', TIE] },
    levelTabs(4),
  ],
  sudoku: () => [
    { h: 'calc', lines: ['lbrs_nh_1', 'lbrs_nh_2', 'lbrs_su_1', 'lbrs_su_2'] },
    { h: 'rank', steps: ['lbrs_nh_r1', 'lbrs_nh_r2', 'lbrs_nh_r3', 'lbrs_nh_r4', TIE] },
    levelTabs(4),
  ],
  skeeball: () => [
    { h: 'tabs', lines: [L('lbrs_sk_t1', { w: t('lbrs_total') }), L('lbrs_sk_t2', { w: t('gs_sk_best_game') }), 'lbrs_sk_t3'] },
    most(),
    { h: 'not', lines: ['lbrs_sk_n1', 'lbrs_sk_n2'] },
  ],
  spellingbee: () => [
    { h: 'tabs', lines: [L('lbrs_sb_t1', { w: t('lb_bee_points') }), L('lbrs_sb_t2', { w: t('lb_bee_words') }), 'lbrs_sb_t3', 'lbrs_sb_t4'] },
    most(),
    { h: 'chips', rows: [['🥇', 'lbrs_sb_c1'], ['🥈', 'lbrs_sb_c2'], ['🥉', 'lbrs_sb_c3'], ['🧠', 'lbrs_sb_c4'], ['🐝', 'lbrs_sb_c5'], ['📅', 'lbrs_sb_c6']].map(([ic, k]) => ({ ic, k })) },
    { h: 'not', lines: ['lbrs_sb_n'] },
  ],
};
export const RANK_SHEET_GAMES = Object.keys(SHEETS);
/** The cards for a game, or [] when it has no rank sheet (the wins games use js/lb-points-sheet.js). */
export function rankSheetModel(id) { return SHEETS[id] ? SHEETS[id]() : []; }

// --- HTML -------------------------------------------------------------------------------------------------------
const say = (x) => (typeof x === 'string' ? t(x) : t(x.k, x.vars));
const sh = (tier) => `<span class="lbps-sh${tier === 4 ? ' x2' : ''}">${diffShapeSVG(tier)}</span>`;
const medal = (m) => `<img class="lbrs-medal" src="${new URL(`../icons/medal-${m}.png`, import.meta.url).href}" alt="" draggable="false">`;
function icon(ic) {
  if (ic == null) return '';
  if (typeof ic === 'number') return `<span class="lbps-ic">${sh(ic)}</span>`;
  if (ic.startsWith('m:')) return `<span class="lbps-ic">${medal(ic.slice(2))}</span>`;
  return `<span class="lbps-ic lbrs-emo" aria-hidden="true">${ic}</span>`;
}
function value(v) {
  if (!v) return '';
  if (v.pts != null) return `<span class="lbps-p"><b>${v.pts}</b> ${esc(t(v.pts === 1 ? 'lbps_point' : 'lbps_points'))}</span>`;
  if (v.stars != null) return `<span class="lbps-p"><b>${v.stars}</b> ${esc(t(v.stars === 1 ? 'lbrs_star' : 'lbrs_stars'))}</span>`;
  if (v.x != null) return `<span class="lbps-p"><b>×${v.x}</b></span>`;
  return `<span class="lbps-p lbrs-pt">${esc(t(v.txt))}</span>`;
}
const row = (r) => `<div class="lbps-r">${icon(r.ic)}<span class="lbps-lb">${esc(say(r))}</span>${value(r.v)}</div>`;
function cardHTML(c) {
  const lines = c.lines ? `<ul class="lbrs-ul">${c.lines.map((x) => `<li>${esc(say(x))}</li>`).join('')}</ul>` : '';
  const steps = c.steps ? `<ol class="lbrs-ol">${c.steps.map((x) => `<li>${esc(say(x))}</li>`).join('')}</ol>` : '';
  const rows = (c.rows || []).map(row).join('');
  // A lead line sits above its rows, as plain text (Arrow Maze's "0, 1, 2, 3 or more"); otherwise rows come first.
  const body = c.h === 'slip' ? `<div class="lbps-cn">${c.lines.map((x) => esc(say(x))).join(' ')}</div>${rows}` : rows + lines;
  const foot = c.foot ? `<div class="lbps-cn lbrs-foot">${esc(say(c.foot))}</div>` : '';
  return `<div class="lbps-card lbps-k-x"><div class="lbps-ch"><span class="lbps-ct">${esc(t('lbrs_h_' + c.h))}</span></div>${body}${steps}${foot}</div>`;
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
    '.lbrs-ul,.lbrs-ol{margin:0;padding:9px 12px 10px 30px;font-size:15px;line-height:1.4}',
    '.lbps-r+.lbrs-ul,.lbps-r+.lbrs-ol{border-top:1px solid var(--ps-row)}',
    '.lbrs-ul li+li,.lbrs-ol li+li{margin-top:5px}',
    '.lbrs-ol li::marker{font-weight:800}',
    '.lbrs-foot{border-top:1px solid var(--ps-row);padding-top:8px;color:var(--ps-dim)}',
    '.lbrs-pt{font-size:15px;color:var(--ps-ink)}',
    // Values sit right-aligned, so the points sheet's fixed value column only cost label room ("Experto, niveles
    // 3001-3500" wrapped at 360 px).
    '.lbrs .lbps-p{min-width:0}',
    '.lbrs-emo{font-size:18px;line-height:1}',
    '.lbrs-medal{height:24px;width:auto;display:block}',
  ].join('\n');
  document.head.appendChild(el);
}

export default { RANK_SHEET_GAMES, rankSheetModel, rankSheetHTML };
