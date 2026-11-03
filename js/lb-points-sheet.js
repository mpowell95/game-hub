// lb-points-sheet.js - "what is a win worth" for one wins game, as cards (Matt's mockup v7, 2026-11-02,
// docs/HANDOFF-LB-POINTS-INFO.md, docs/mockups/lb-points-info-v7.html). ONE body for both places that show it:
// the board's (i) sheet (js/leaderboard2-ui.js infoHTML) and the game's stats page (js/game-stats-ui.js
// ptsSectionHTML). ADMIN DEVICES ONLY, like every other piece of the points: both callers check isAdminDevice
// (Matt: "Deploy to the Admin only leaderboard. DO NOT MAKE LIVE FOR ANYONE ELSE.").
//
// One card per OPTION, easiest to hardest, then the several-computers card, then Online, then the 20-point box.
// Every number comes from js/lb-points.js: a row's points are pointsForWin, and whether a row is under the
// 20-point limit is asked of gamePoints with 100 such wins, never decided from the level alone (mockup v6 marked
// Tic Tac Toe Ultimate Easy/Medium as limited; gamePoints counts Ultimate outside the limit).
// A shortened option is recorded one level down (js/lb-rules.js `short`, each game's statsDiff), so its rows are
// worked out at the level it is RECORDED at; the option's saved mode (withMode) is passed for the multipliers.
// tools/test-lb-points-sheet.mjs pins the model against gamePoints for every row of every game.
import { pointsForWin, pointsTable, gamePoints, CAP, POINT_GAMES } from './lb-points.js';
import { diffShapeSVG, tierOf } from './difficulty-tiers.js';
import { makeT } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const L3 = ['easy', 'medium', 'hard'];
const down = (d) => L3[Math.max(0, L3.indexOf(d) - 1)];
const LEVEL_KEY = { 1: 'gs_diff_beginner', 2: 'gs_diff_intermediate', 3: 'gs_diff_pro', 4: 'gs_diff_expert' };

// Per game: its options (title key `lbps_o_<k>`, tag s/n/l/e/h, tone s/n/h, `short` = recorded one level down,
// `mode` = the saved mode the multipliers read). No entry = one "Vs computer" card.
// Option facts (checked 2026-11-02 against each game's setup): Battleship sizeKey quick/classic; Boggle timer
// 1 / 1.5 / 2 min (2 = one level down); Chinchón score under 100 or rounds under 10 = one level down; Hoops
// shots 'until' (default, one level down) / 'one'; Cup Pong reracks 0/1/2/3/inf (default 2, inf = one level
// down); Darts 301 (default) / 201 / 101 (one level down) / Cricket, Cricket in order; Dominoes 150 (one level
// down) / 300 (default) / 500; Dots small/medium (default) / large; Flick 1 (one level down) / 2 (default) / 3
// goals; Pool 1 (default, one level down) / 2 / 3 racks; Tic Tac Toe Classic / Ultimate.
const O = (k, tag, tone, opt = {}) => ({ k, tag, tone, ...opt });
const OPTIONS = {
  battleship: [O('bs_quick', 's', 's', { mode: { size: 'quick' } }), O('bs_classic', 'n', 'n', { mode: { size: 'classic' } })],
  boggle: [O('bg_2min', 'e', 's', { short: true }), O('bg_1min', 'n', 'n')],
  chinchon: [O('cc_short', 's', 's', { short: true }), O('cc_normal', 'n', 'n')],
  hoops4: [O('h4_until', 'e', 's', { short: true }), O('h4_one', 'h', 'h')],
  cuppong: [O('cp_inf', 'e', 's', { short: true, mode: { rr: 'inf' } }), O('cp_some', 'n', 'n', { mode: { rr: 2 } }), O('cp_none', 'h', 'h', { mode: { rr: 0 } })],
  darts: [O('dt_short', 's', 's', { short: true, mode: { kind: '201' } }), O('dt_normal', 'n', 'n', { mode: { kind: '301' } }), O('dt_order', 'h', 'h', { mode: { kind: 'cricket-order' } })],
  dominoes: [O('dm_150', 's', 's', { short: true, mode: { to: 150 } }), O('dm_300', 'n', 'n', { mode: { to: 300 } }), O('dm_500', 'l', 'h', { mode: { to: 500 } })],
  dotsboxes: [O('db_normal', 'n', 'n', { mode: { size: 'medium' } }), O('db_large', 'l', 'h', { mode: { size: 'large' } })],
  flicksoccer: [O('fs_1', 's', 's', { short: true, mode: { goals: 1 } }), O('fs_2', 'n', 'n', { mode: { goals: 2 } }), O('fs_3', 'l', 'h', { mode: { goals: 3 } })],
  eightball: [O('eb_1', 's', 's', { short: true, mode: { racks: 1 } }), O('eb_2', 'n', 'n', { mode: { racks: 2 } }), O('eb_3', 'l', 'h', { mode: { racks: 3 } })],
  tictactoe: [O('tt_classic', 'n', 'n', { mode: { v: 'classic' } }), O('tt_ultimate', 'h', 'h', { mode: { v: 'ultimate' } })],
};
// Games a win can come from online (an mp.js room; js/hub.js LIVE_MP_GAMES lists only some of them). Connect 4,
// Dominoes, Uno, Parchís and Monopoly Deal have no online play, so their online value can never be earned.
const ONLINE = new Set(['airhockey', 'battleship', 'boggle', 'chinchon', 'cuppong', 'darts', 'dotsboxes', 'eightball',
  'escoba', 'filler', 'flicksoccer', 'hoops4', 'mancala', 'tictactoe', 'yahtzee']);
const TABLE = new Set(['chinchon', 'escoba', 'parchis']);   // several computers: the easiest one's level (lb-rules `table`)
const OLDER = new Set(['business']);                          // wins saved before levels existed

const W = 100;
/** One row's points and limit, from the real maths: 100 wins recorded at `rec`, saved with `mode` at `raw`. */
function rowFacts(id, rec, raw, mode) {
  const per = pointsForWin(id, rec, mode || undefined);
  const gm = { total: { won: W }, byDiff: { [rec]: { won: W } } };
  if (mode) gm.byMode = { [Object.entries(mode).map(([k, v]) => `${k}=${v}`).join('|')]: { [raw]: { won: W } } };
  const all = gamePoints(gm, id).pts;
  return { pts: per, cap: all < W * per };
}
const levelRows = (id, o = {}) => {
  const rows = [];
  for (let tier = 1; tier <= pointsTable(id).lv.length; tier++) {
    const raw = tier === 4 ? 'expert' : L3[tier - 1];
    rows.push({ tier, ...rowFacts(id, o.short ? down(raw) : raw, raw, o.mode) });
  }
  return rows;
};

/** The sheet as data: [{ kind: 'opt'|'cpu'|'table'|'older'|'online'|'limit', key?, tag?, tone?, rows? }].
 *  Rows: { tier (1-4, 'on', 'mix', 0), pts, cap }. Pure: no DOM, no strings. */
export function sheetModel(id) {
  if (!POINT_GAMES.includes(id)) return [];
  const cards = [];
  if (id === 'yahtzee') cards.push({ kind: 'cpu', rows: [{ tier: 0, pts: pointsForWin(id, 'normal'), cap: false, win: true }] });
  else if (OPTIONS[id]) for (const o of OPTIONS[id]) cards.push({ kind: 'opt', key: o.k, tag: o.tag, tone: o.tone, rows: levelRows(id, o) });
  else cards.push({ kind: 'cpu', rows: levelRows(id) });
  if (TABLE.has(id)) cards.push({ kind: 'table', rows: [{ tier: 'mix', ...rowFacts(id, 'easy', 'easy') }] });
  if (OLDER.has(id)) cards.push({ kind: 'older', rows: [{ tier: 0, pts: pointsForWin(id, 'none'), cap: false }] });
  if (ONLINE.has(id)) cards.push({ kind: 'online', rows: [{ tier: 'on', pts: pointsTable(id).on, cap: false }] });
  if (cards.some((c) => c.rows && c.rows.some((r) => r.cap))) cards.push({ kind: 'limit' });
  return cards;
}

// --- HTML -------------------------------------------------------------------------------------------------------
const PEOPLE = '<svg viewBox="0 0 22 20" aria-hidden="true"><circle cx="7" cy="6.5" r="3.6" fill="currentColor"/><circle cx="15" cy="6.5" r="3.6" fill="currentColor"/><path d="M0.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6zM8.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6z" fill="currentColor"/></svg>';
const sh = (tier) => `<span class="lbps-sh${tier === 4 ? ' x2' : ''}">${diffShapeSVG(tier)}</span>`;
function icon(tier) {
  if (tier === 'on') return `<span class="lbps-ic lbps-ppl">${PEOPLE}</span>`;
  if (tier === 'mix') return `<span class="lbps-ic lbps-mix">${sh(1)}${sh(3)}</span>`;
  return `<span class="lbps-ic">${tier ? sh(tier) : ''}</span>`;
}
// The 20-point limit on a row: a yellow ball with "20" (Matt, v6 review: "a yellow 20 circle that looks kinda like
// a pool ball"), between the label and the points, never under the label. Its words are only in the box below.
const ball = () => `<span class="lbps-ball" role="img" aria-label="${esc(t('lbps_limit'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.4" fill="#ffce3a" stroke="#a37c12" stroke-width="1.2"/><ellipse cx="7.6" cy="6.2" rx="3.2" ry="1.7" fill="#fff" opacity=".5" transform="rotate(-35 7.6 6.2)"/><circle cx="12" cy="12" r="7.6" fill="#fff"/><text x="12" y="15.4" text-anchor="middle" font-size="9.6" font-weight="800" fill="#1c1606" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${CAP}</text></svg></span>`;
function label(card, r) {
  if (r.tier === 'on') return t('lbps_win_online');
  if (r.tier === 'mix') return t('lbps_easy_hard');
  if (card.kind === 'older') return t('lbps_no_level');
  if (r.win) return t('lbps_win');
  return t('lbps_win_on', { lv: t(LEVEL_KEY[r.tier]) });
}
const row = (card, r) => `<div class="lbps-r">${icon(r.tier)}<span class="lbps-lb">${esc(label(card, r))}</span>${r.cap ? ball() : ''}`
  + `<span class="lbps-p"><b>${r.pts}</b> ${esc(t(r.pts === 1 ? 'lbps_point' : 'lbps_points'))}</span></div>`;
const head = (title, tag) => `<div class="lbps-ch"><span class="lbps-ct">${esc(title)}</span>${tag ? `<span class="lbps-tag">${esc(t('lbps_tag_' + tag))}</span>` : ''}</div>`;
function cardHTML(c) {
  const rows = (c.rows || []).map((r) => row(c, r)).join('');
  if (c.kind === 'opt') return `<div class="lbps-card lbps-k-${c.tone}">${head(t('lbps_o_' + c.key), c.tag)}${rows}</div>`;
  if (c.kind === 'cpu') return `<div class="lbps-card lbps-k-x">${head(t('lbps_vs_cpu'))}${rows}</div>`;
  if (c.kind === 'table') return `<div class="lbps-card lbps-k-x">${head(t('lbps_tables'))}<div class="lbps-cn">${esc(t('lbps_tables_note'))}</div>${rows}</div>`;
  if (c.kind === 'older') return `<div class="lbps-card lbps-k-x">${head(t('lbps_older'))}${rows}</div>`;
  if (c.kind === 'online') return `<div class="lbps-card lbps-k-x">${head(t('lb_pts_online'))}${rows}</div>`;
  if (c.kind === 'limit') return `<div class="lbps-card lbps-cap"><div class="lbps-ch"><span class="lbps-lim">${esc(t('lbps_limit'))}</span></div>`
    + `<div class="lbps-cn">${esc(t('lbps_limit_body', { n: CAP })).split('{ball}').join(ball())}</div></div>`;
  return '';
}
/** The sheet's body: "Every win adds points:" and the cards. '' for a game that is not a wins board. */
export function pointsSheetHTML(id) {
  const cards = sheetModel(id);
  if (!cards.length) return '';
  ensurePointsSheetCss();
  return `<div class="lbps"><p class="lbps-lead">${esc(t('lbps_lead'))}</p>${cards.map(cardHTML).join('')}</div>`;
}

// Light and dark (`.gh-dark` on <html>, js/theme.js). A coloured card header always carries a tag word
// (red/green colourblind: purple, not green, for harder; amber for easier). Dark shapes sit on a white tile.
export function ensurePointsSheetCss() {
  if (typeof document === 'undefined' || document.getElementById('lbps-css')) return;
  const el = document.createElement('style');
  el.id = 'lbps-css';
  el.textContent = [
    '.lbps{--ps-card:#F7F8FA;--ps-line:#E2E5EA;--ps-row:rgba(0,0,0,.07);--ps-ink:#14161A;--ps-dim:#596170;--ps-x:#EEF0F3;--ps-xt:#14161A;--ps-n:#E6ECF5;--ps-nt:#1D2B45;--ps-s:#FBEBD3;--ps-st:#6B3F0A;--ps-sb:#E9C48F;--ps-h:#ECE6FA;--ps-ht:#3B2A78;--ps-hb:#C9BBEF;--ps-tag:rgba(0,0,0,.08);--ps-cap:#FFF7DA;--ps-capb:#E0A800;display:flex;flex-direction:column;gap:12px;color:var(--ps-ink)}',
    ':root.gh-dark .lbps{--ps-card:#1E222A;--ps-line:#2B313B;--ps-row:rgba(255,255,255,.07);--ps-ink:#F1F3F6;--ps-dim:#A2A9B5;--ps-x:#2a2f3a;--ps-xt:#e6e9f0;--ps-n:#263040;--ps-nt:#dfe6f1;--ps-s:#4a3720;--ps-st:#ffd9a3;--ps-sb:#7a5a2a;--ps-h:#352c5a;--ps-ht:#d9ccff;--ps-hb:#5a4a8a;--ps-tag:rgba(255,255,255,.14);--ps-cap:#2a2614;--ps-capb:#ffce3a}',
    '.lbps-lead{margin:0;font-size:16px;font-weight:700}',
    '.lbps-card{border-radius:14px;overflow:hidden;border:1px solid var(--ps-line);background:var(--ps-card)}',
    '.lbps-ch{display:flex;align-items:center;gap:8px;padding:9px 12px;font-weight:800;font-size:15px;background:var(--ps-x);color:var(--ps-xt)}',
    '.lbps-ct{flex:1;min-width:0}',
    '.lbps-tag{flex:none;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--ps-tag)}',
    '.lbps-k-n .lbps-ch{background:var(--ps-n);color:var(--ps-nt)}',
    '.lbps-k-s{border-color:var(--ps-sb)}.lbps-k-s .lbps-ch{background:var(--ps-s);color:var(--ps-st)}',
    '.lbps-k-h{border-color:var(--ps-hb)}.lbps-k-h .lbps-ch{background:var(--ps-h);color:var(--ps-ht)}',
    '.lbps-cap{border:2px solid var(--ps-capb);background:var(--ps-cap)}',
    '.lbps-cap .lbps-ch{background:transparent;padding-bottom:4px}',
    '.lbps-lim{display:inline-block;font-size:13px;font-weight:800;color:#1c1606;background:#ffce3a;border-radius:999px;padding:3px 10px}',
    '.lbps-cn{padding:8px 12px 10px;font-size:14px;line-height:1.45}',
    '.lbps-cap .lbps-cn{padding-top:2px}',
    '.lbps-r{display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--ps-row);min-height:44px}',
    '.lbps-ch+.lbps-r{border-top:0}',
    '.lbps-ic{width:22px;display:flex;gap:3px;flex:none;justify-content:center;color:var(--ps-dim)}',
    '.lbps-mix{width:44px}',
    '.lbps-ppl svg{width:22px;height:20px}',
    // The shape centred on its tile; the Expert double diamond the SAME height as the others, 1.7 times as wide
    // (2026-11-03: at 24px it was smaller than a single diamond and, in dark mode, lost on its white tile).
    '.lbps-sh{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:none}',
    '.lbps-sh.x2{width:31px}',
    '.lbps-sh svg{width:100%;height:100%;display:block}',
    ':root.gh-dark .lbps-sh{background:#fff;border-radius:4px;padding:2px;box-sizing:border-box}',
    ':root.gh-dark .lbps .lbps-sh .lb-dshape-t3,:root.gh-dark .lbps .lbps-sh .lb-dshape-t4{fill:#1c2430}',
    '.lbps-lb{flex:1;min-width:0;font-size:15px}',
    '.lbps-ball{display:inline-flex;width:28px;height:28px;flex:none}',
    '.lbps-ball svg{width:100%;height:100%;display:block}',
    '.lbps-cn .lbps-ball{vertical-align:middle;margin:-6px 1px -4px}',
    '.lbps-p{flex:none;min-width:86px;text-align:right;font-size:14px;color:var(--ps-dim);white-space:nowrap}',
    '.lbps-p b{font-size:20px;font-weight:800;color:var(--ps-ink)}',
  ].join('\n');
  document.head.appendChild(el);
}

export default { sheetModel, pointsSheetHTML, ensurePointsSheetCss };
