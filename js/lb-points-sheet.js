// lb-points-sheet.js - "what is a win worth" for one wins game: ONE table (Matt's approved scores-screen mockups,
// 2026-11-03/04, docs/mockups/final/sheet-<game>.html). Shown in two places: the board's (i) sheet
// (js/leaderboard2-ui.js infoHTML) and the game's stats page (js/game-stats-ui.js ptsSectionHTML). ADMIN DEVICES ONLY,
// like every other piece of the points: both callers check isAdminDevice (Matt: "Deploy to the Admin only
// leaderboard. DO NOT MAKE LIVE FOR ANYONE ELSE.").
//
// A game with options: levels down the side, one column per option under the option's name (Battleship "Board":
// 8x8 / 10x10). A game without: Difficulty | Points per win. Online below a gap, then the 20-point note (a yellow
// circle on every limited cell) and, for a table of computers, how 2 or 3 of them add up.
// Every number comes from js/lb-points.js: a cell's points are pointsForWin, and whether a cell is under the
// 20-point limit is asked of gamePoints with 100 such wins, never decided from the level alone (mockup v6 marked
// Tic Tac Toe Ultimate Easy/Medium as limited; gamePoints counts Ultimate outside the limit).
// A shortened option is recorded one level down (js/lb-rules.js `short`, each game's statsDiff), so its cells are
// worked out at the level it is RECORDED at; the option's saved mode (withMode) is passed for the multipliers.
// tools/test-lb-points-sheet.mjs pins the model against gamePoints for every cell of every game.
// The table renderer and its CSS are shared with js/lb-rank-sheet.js (Nuts & Bolts, Minesweeper, Hill Climb).
import { pointsForWin, pointsTable, gamePoints, CAP, POINT_GAMES } from './lb-points.js';
import { diffShapeSVG } from './difficulty-tiers.js';
import { makeT } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const L3 = ['easy', 'medium', 'hard'];
const down = (d) => L3[Math.max(0, L3.indexOf(d) - 1)];
export const LEVEL_KEY = { 1: 'gs_diff_beginner', 2: 'gs_diff_intermediate', 3: 'gs_diff_pro', 4: 'gs_diff_expert' };

// Per game: its options, easiest to hardest (column word `lbpt_k_<k>`, the header over them `lbpt_h_<game>`;
// `short` = recorded one level down, `mode` = the saved mode the multipliers read). No entry = Difficulty | Points.
// Option facts (checked 2026-11-02 against each game's setup): Battleship sizeKey quick/classic; Boggle timer
// 1 / 1.5 / 2 min (2 = one level down); Chinchón score under 100 or rounds under 10 = one level down; Hoops
// shots 'until' (default, one level down; mode one=0) / 'one'; Cup Pong reracks 0/1/2/3/inf (default 2, inf = one
// level down); Darts 301 (default) / 201 / 101 (one level down) / Cricket, Cricket in order; Dominoes 150 (one level
// down) / 300 (default) / 500; Dots small/medium (default) / large; Flick 1 (one level down) / 2 (default) / 3
// goals; Pool 1 (default, one level down) / 2 / 3 racks; Tic Tac Toe Classic / Ultimate.
const O = (k, opt = {}) => ({ k, ...opt });
const OPTIONS = {
  battleship: [O('bs_quick', { mode: { size: 'quick' } }), O('bs_classic', { mode: { size: 'classic' } })],
  boggle: [O('bg_2min', { short: true }), O('bg_1min')],
  chinchon: [O('cc_short', { short: true, mode: { vc: 'points', sl: 50 } }), O('cc_normal', { mode: { vc: 'points', sl: 100 } })],
  hoops4: [O('h4_until', { short: true, mode: { one: 0 } }), O('h4_one', { mode: { one: 1 } })],
  cuppong: [O('cp_inf', { short: true, mode: { rr: 'inf' } }), O('cp_some', { mode: { rr: 2 } }), O('cp_none', { mode: { rr: 0 } })],
  darts: [O('dt_short', { short: true, mode: { kind: '201' } }), O('dt_normal', { mode: { kind: '301' } }), O('dt_order', { mode: { kind: 'cricket-order' } })],
  dominoes: [O('dm_150', { short: true, mode: { to: 150 } }), O('dm_300', { mode: { to: 300 } }), O('dm_500', { mode: { to: 500 } })],
  dotsboxes: [O('db_normal', { mode: { size: 'medium' } }), O('db_large', { mode: { size: 'large' } })],
  flicksoccer: [O('fs_1', { short: true, mode: { goals: 1 } }), O('fs_2', { mode: { goals: 2 } }), O('fs_3', { mode: { goals: 3 } })],
  eightball: [O('eb_1', { short: true, mode: { racks: 1 } }), O('eb_2', { mode: { racks: 2 } }), O('eb_3', { mode: { racks: 3 } })],
  tictactoe: [O('tt_classic', { mode: { v: 'classic' } }), O('tt_ultimate', { mode: { v: 'ultimate' } })],
};
// Games a win can come from online (an mp.js room; js/hub.js LIVE_MP_GAMES lists only some of them). Connect 4,
// Dominoes, Uno, Parchís and Monopoly Deal have no online play, so their online value can never be earned.
const ONLINE = new Set(['airhockey', 'battleship', 'boggle', 'chinchon', 'cuppong', 'darts', 'dotsboxes', 'eightball',
  'escoba', 'filler', 'flicksoccer', 'hoops4', 'mancala', 'tictactoe', 'yahtzee']);
// A table of 2 or 3 computers: each computer's own points added up (js/lb-points.js tableSum, lb-rules `table`).
const TABLE = new Set(['chinchon', 'escoba', 'parchis']);
const TABLE_EX = [1, 3];   // the example under the table: Easy + Hard
// More opponents pay more (Matt, 2026-11-04, docs/mockups/opponents/): one column per number of computers (every
// computer at the one level chosen), and online one column per number of opponents. `mode(n)` = the mode a win
// against n of them saves (js/lb-points.js reads it).
const COUNTS = {
  business: { n: [1, 2, 3, 4], mode: (n) => ({ ai: n }) },
  uno: { n: [1, 2, 3], mode: (n) => ({ n: n + 1 }) },
};
const ONLINE_OPP = {
  chinchon: { n: [1, 2, 3], mode: (n) => ({ n: n + 1 }) },
  escoba: { n: [1, 2, 3], mode: (n) => ({ n: n + 1 }) },
  eightball: { n: [1, 2], mode: (n) => ({ game: n === 2 ? 'ct' : '8' }) },
};
// Pool's Cutthroat: 2 computers, every number x2; the example is Hard at 3 racks.
const CUTTHROAT = { id: 'eightball', tier: 3, mode: { racks: 3, game: 'ct' } };

const W = 100;
/** One cell's points and limit, from the real maths: 100 wins recorded at `rec`, saved with `mode` at `raw`. */
function cellFacts(id, rec, raw, mode) {
  const per = pointsForWin(id, rec, mode || undefined);
  const gm = { total: { won: W }, byDiff: { [rec]: { won: W } } };
  if (mode) gm.byMode = { [Object.entries(mode).map(([k, v]) => `${k}=${v}`).join('|')]: { [raw]: { won: W } } };
  const all = gamePoints(gm, id).pts;
  return { pts: per, cap: all < W * per };
}
const levelCells = (id, o = {}) => {
  const out = [];
  for (let tier = 1; tier <= pointsTable(id).lv.length; tier++) {
    const raw = tier === 4 ? 'expert' : L3[tier - 1];
    out.push({ tier, ...cellFacts(id, o.short ? down(raw) : raw, raw, o.mode) });
  }
  return out;
};

/** The sheet as data: [{ kind: 'opt'|'count'|'cpu'|'table'|'online'|'cutthroat'|'limit', key?, n?, rows?, opp?, ex? }].
 *  'opt' / 'count' (n computers) / 'cpu' rows: { tier (1-4, 0 = a win with no level), pts, cap }; 'online' one row
 *  { tier: 'on', pts }, plus `opp` [{ n, pts }] where a bigger online table pays more; 'table' ex: { tiers: [a, b],
 *  pts } (a win against those two computers); 'cutthroat' ex: { tier, racks, pts }. Pure: no DOM, no strings. */
export function sheetModel(id) {
  if (!POINT_GAMES.includes(id)) return [];
  const cards = [];
  if (id === 'yahtzee') cards.push({ kind: 'cpu', rows: [{ tier: 0, pts: pointsForWin(id, 'normal'), cap: false, win: true }] });
  else if (COUNTS[id]) for (const n of COUNTS[id].n) cards.push({ kind: 'count', n, rows: levelCells(id, { mode: COUNTS[id].mode(n) }) });
  else if (OPTIONS[id]) for (const o of OPTIONS[id]) cards.push({ kind: 'opt', key: o.k, rows: levelCells(id, o) });
  else cards.push({ kind: 'cpu', rows: levelCells(id) });
  if (ONLINE.has(id)) {
    const oo = ONLINE_OPP[id];
    cards.push(oo ? { kind: 'online', opp: oo.n.map((n) => ({ n, pts: pointsForWin(id, 'mp', oo.mode(n)) })), rows: [{ tier: 'on', pts: pointsTable(id).on, cap: false }] }
      : { kind: 'online', rows: [{ tier: 'on', pts: pointsTable(id).on, cap: false }] });
  }
  if (id === CUTTHROAT.id) cards.push({ kind: 'cutthroat', ex: { tier: CUTTHROAT.tier, racks: CUTTHROAT.mode.racks, pts: pointsForWin(id, L3[CUTTHROAT.tier - 1], CUTTHROAT.mode) } });
  if (cards.some((c) => c.rows && c.rows.some((r) => r.cap))) cards.push({ kind: 'limit' });
  if (TABLE.has(id)) {
    const ai = TABLE_EX.map((x) => L3[x - 1]).join('-');
    cards.push({ kind: 'table', ex: { tiers: TABLE_EX, pts: pointsForWin(id, L3[TABLE_EX[0] - 1], { ai, humans: 1 }) } });
  }
  return cards;
}

// --- HTML: one table, shared with js/lb-rank-sheet.js ------------------------------------------------------------
const PEOPLE = '<svg viewBox="0 0 22 20" aria-hidden="true"><circle cx="7" cy="6.5" r="3.6" fill="currentColor"/><circle cx="15" cy="6.5" r="3.6" fill="currentColor"/><path d="M0.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6zM8.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6z" fill="currentColor"/></svg>';
/** A level's shape on its tile (Matt is red/green colourblind: every level has a shape). */
export const shapeHTML = (tier) => `<span class="lbps-sh${tier === 4 ? ' x2' : ''}">${diffShapeSVG(tier)}</span>`;
const icon = (ic) => (ic === 'on' ? `<span class="lbps-ic lbps-ppl">${PEOPLE}</span>` : typeof ic === 'number' && ic > 0 ? shapeHTML(ic) : '');
const lines = (s) => esc(s).split('\n').join('<br>');
/** The yellow circle on a cell under the 20-point limit (its words are in the note under the table). */
const capCell = (v) => `<span class="lbpt-cap" role="img" aria-label="${esc(t('lbpt_cap', { n: CAP }))}">${esc(v)}</span>`;
/** The note under a table with a limited cell: "(circle) = Only your first 20 points from these count." */
export const capNoteHTML = (n = CAP, key = 'lbpt_cap') => `<div class="lbpt-capn"><span class="lbpt-dot" aria-hidden="true"></span><b aria-hidden="true">=</b><span>${esc(t(key, { n }))}</span></div>`;
/** The table: { left: header over the labels, sup: a header over every value column, cols: each value column's
 *  header ('\n' = a line break), rows: [{ ic, label, vals: [{ v, cap, txt }] }], online: { v } | null }.
 *  Two-column tables (one value column) get the wider value column of the mockups' Difficulty | Points per win. */
export function pointsTableHTML({ left = '', sup = '', cols = [], rows = [], online = null, cls = '' }) {
  const n = cols.length;
  const head = (sup ? `<tr><th></th><th colspan="${n}" class="lbpt-sup">${esc(sup)}</th></tr>` : '')
    + `<tr><th class="lbpt-lh">${esc(left)}</th>${cols.map((c) => `<th class="lbpt-ch">${lines(c)}</th>`).join('')}</tr>`;
  const cell = (x) => `<td${x.txt ? ' class="lbpt-txt"' : ''}>${x.cap ? capCell(x.v) : esc(x.v)}</td>`;
  const body = rows.map((r) => `<tr><td class="lbpt-lv">${icon(r.ic)}<span class="lbpt-n">${esc(r.label)}</span></td>${r.vals.map(cell).join('')}</tr>`).join('')
    + (online ? `<tr class="lbpt-on"><td class="lbpt-lv">${icon('on')}<span class="lbpt-n">${esc(t('lb_pts_online'))}</span></td>${n > 1 ? `<td colspan="${n - 1}"></td>` : ''}<td>${esc(online.v)}</td></tr>` : '');
  return `<table class="lbpt-t ${n > 1 ? 'lbpt-w' : 'lbpt-2'}${cls ? ' ' + cls : ''}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/** The sheet's body: one card holding the table and its notes. '' for a game that is not a wins board. */
export function pointsSheetHTML(id) {
  const cards = sheetModel(id);
  if (!cards.length) return '';
  ensurePointsSheetCss();
  const opts = cards.filter((c) => c.kind === 'opt');
  const counts = cards.filter((c) => c.kind === 'count');
  const cpu = cards.find((c) => c.kind === 'cpu');
  const onl = cards.find((c) => c.kind === 'online');
  const lvLabel = (r) => (r.win ? t('lbps_vs_cpu') : t(LEVEL_KEY[r.tier]));
  let table;
  const onlineRow = onl && !onl.opp ? { v: onl.rows[0].pts } : null;
  if (counts.length) {
    table = pointsTableHTML({
      sup: t('lbpt_h_computers'), cols: counts.map((c) => String(c.n)), cls: 'lbpt-cnt',
      rows: counts[0].rows.map((r, i) => ({ ic: r.tier, label: lvLabel(r), vals: counts.map((c) => ({ v: c.rows[i].pts, cap: c.rows[i].cap })) })),
      online: onlineRow,
    });
  } else if (opts.length) {
    table = pointsTableHTML({
      sup: t('lbpt_h_' + id), cols: opts.map((o) => t('lbpt_k_' + o.key)),
      rows: opts[0].rows.map((r, i) => ({ ic: r.tier, label: lvLabel(r), vals: opts.map((o) => ({ v: o.rows[i].pts, cap: o.rows[i].cap })) })),
      online: onlineRow,
    });
  } else {
    table = pointsTableHTML({
      left: t('lbpt_diff'), cols: [t('lbpt_per_win')],
      rows: cpu.rows.map((r) => ({ ic: r.tier, label: lvLabel(r), vals: [{ v: r.pts, cap: r.cap }] })),
      online: onlineRow,
    });
  }
  const cap = cards.some((c) => c.kind === 'limit') ? capNoteHTML(CAP, pointsTable(id).ownCap ? 'lbpt_cap_lv' : 'lbpt_cap') : '';   // ownCap: each level its own limit (2026-11-08)
  const tb = cards.find((c) => c.kind === 'table');
  const note = tb ? `<div class="lbpt-note"><b>${esc(t('lbpt_tables_b'))}</b> ${esc(t('lbpt_tables'))}<br>${esc(t('lbpt_tables_ex', {
    a: t(LEVEL_KEY[tb.ex.tiers[0]]), b: t(LEVEL_KEY[tb.ex.tiers[1]]), n: tb.ex.pts }))}</div>` : '';
  const ct = cards.find((c) => c.kind === 'cutthroat');
  const ctNote = ct ? `<div class="lbpt-note"><b>${esc(t('lbpt_ct_b'))}</b> ${esc(t('lbpt_ct'))}<br>${esc(t('lbpt_ct_ex', {
    a: t(LEVEL_KEY[ct.ex.tier]), r: ct.ex.racks, n: ct.ex.pts }))}</div>` : '';
  const opp = onl && onl.opp ? pointsTableHTML({
    sup: t('lbpt_h_opponents'), cols: onl.opp.map((o) => String(o.n)), cls: 'lbpt-gap',
    rows: [{ ic: 'on', label: t('lb_pts_online'), vals: onl.opp.map((o) => ({ v: o.pts })) }],
  }) : '';
  return `<div class="lbps"><div class="lbps-card">${table}${cap}${note}${ctNote}${opp}</div></div>`;
}

// Light and dark (`.gh-dark` on <html>, js/theme.js). Headers bright (Matt, 2026-11-03: "all those column headers
// are too faint... Make it easy to read"). Dark shapes sit on a white tile in dark mode.
export function ensurePointsSheetCss() {
  if (typeof document === 'undefined' || document.getElementById('lbps-css')) return;
  const el = document.createElement('style');
  el.id = 'lbps-css';
  el.textContent = [
    '.lbps{--ps-card:#F7F8FA;--ps-line:#E2E5EA;--ps-row:rgba(0,0,0,.07);--ps-ink:#14161A;--ps-dim:#596170;--ps-th:#20242C;--ps-note:#3E4553;--ps-x:#EEF0F3;--ps-xt:#14161A;--ps-grp:#ECEEF2;--ps-gap:#E2E5EA;display:flex;flex-direction:column;gap:18px;color:var(--ps-ink)}',
    ':root.gh-dark .lbps{--ps-card:#1E222A;--ps-line:#2B313B;--ps-row:rgba(255,255,255,.06);--ps-ink:#F1F3F6;--ps-dim:#A2A9B5;--ps-th:#E6E9EF;--ps-note:#C9CFD8;--ps-x:#2a2f3a;--ps-xt:#F1F3F6;--ps-grp:#232834;--ps-gap:#11141b}',
    '.lbps-card{border-radius:14px;overflow:hidden;border:1px solid var(--ps-line);background:var(--ps-card)}',
    '.lbps-ch{display:flex;align-items:center;gap:8px;padding:11px 14px;font-weight:800;font-size:16px;background:var(--ps-x);color:var(--ps-xt)}',
    '.lbps-ct{flex:1;min-width:0}',
    '.lbps-ic{width:20px;display:inline-flex;flex:none;justify-content:center;color:var(--ps-dim);vertical-align:middle}',
    '.lbps-ppl svg{width:22px;height:20px}',
    // The shape centred on its tile; the Expert double diamond the SAME height as the others, 1.7 times as wide.
    '.lbps-sh{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:none;vertical-align:middle}',
    '.lbps-sh.x2{width:34px}',
    '.lbps-sh svg{width:100%;height:100%;display:block}',
    ':root.gh-dark .lbps-sh{background:#fff;border-radius:4px;padding:2px;box-sizing:border-box}',
    ':root.gh-dark .lbps .lbps-sh .lb-dshape-t3,:root.gh-dark .lbps .lbps-sh .lb-dshape-t4{fill:#1c2430}',
    // The table (wins games, Nuts & Bolts, Minesweeper, Hill Climb).
    '.lbpt-t{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}',
    '.lbpt-t th{color:var(--ps-th);font-weight:700;font-size:15px;line-height:1.2;text-align:center;padding:4px 2px 7px;vertical-align:bottom}',
    '.lbpt-t th.lbpt-lh{text-align:left;padding-left:14px}',
    '.lbpt-t th.lbpt-sup{padding:9px 0 3px;border-bottom:1px solid var(--ps-line)}',
    // Options: the level column hugs its words, the option columns share the rest (Chinchón's "Under 100 points"
    // on two lines, as in the mockup, not three).
    '.lbpt-w th.lbpt-ch{min-width:58px}',
    '.lbpt-w td.lbpt-lv{width:1%;padding-right:10px}',
    // Number columns (computers 1-4, online opponents): narrow, so four fit beside the levels on a 360 px phone.
    '.lbpt-cnt th.lbpt-ch,.lbpt-gap th.lbpt-ch{min-width:44px}',
    '.lbpt-2 th{padding-top:9px;padding-bottom:9px;vertical-align:middle}',
    '.lbpt-2 th.lbpt-ch{width:96px}',
    '.lbpt-t td{text-align:center;height:46px;padding:0 2px;border-top:1px solid var(--ps-row);color:var(--ps-ink);font-weight:800;font-size:22px}',
    '.lbpt-2 td{height:50px}',
    '.lbpt-t td.lbpt-lv{text-align:left;padding-left:14px;font-weight:400;font-size:17px;white-space:nowrap}',
    '.lbpt-n{margin-left:12px;vertical-align:middle}',
    '.lbpt-t td.lbpt-txt{font-size:17px;font-weight:500}',
    '.lbpt-t tr.lbpt-on td{border-top:6px solid var(--ps-gap)}',
    '.lbpt-t.lbpt-gap{border-top:6px solid var(--ps-gap)}',
    '.lbpt-cap{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:15px;background:#ffce3a;color:#1c1606;font-size:17px;font-weight:800}',
    '.lbpt-capn{display:flex;align-items:center;gap:8px;padding:12px 14px;font-size:15px;color:var(--ps-note);border-top:1px solid var(--ps-row)}',
    '.lbpt-capn b{font-size:18px;color:var(--ps-th)}',
    '.lbpt-dot{display:inline-flex;width:26px;height:26px;border-radius:13px;background:#ffce3a;flex:none}',
    ':root:not(.gh-dark) .lbpt-cap,:root:not(.gh-dark) .lbpt-dot{box-shadow:inset 0 0 0 1px #d9a400}',
    '.lbpt-note{padding:12px 14px 14px;font-size:17px;line-height:1.4;color:var(--ps-note);border-top:1px solid var(--ps-row)}',
    '.lbpt-note b{color:var(--ps-th)}',
  ].join('\n');
  document.head.appendChild(el);
}

export default { sheetModel, pointsSheetHTML, pointsTableHTML, ensurePointsSheetCss };
