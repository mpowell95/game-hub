// leaderboard2-ui.js - Leaderboard v2, ADMIN PREVIEW (2026-10-31, docs/LEADERBOARD-V2-PLAN.md, the look
// is docs/mockups/leaderboard-v2.html). Opened ONLY from js/leaderboard-ui.js openLeaderboard() on an admin
// device (isAdminDevice, the one gate); every other device keeps the old board. "Old" at the bottom of
// Boards opens the old one.
//
// READ ONLY. People come from the server-built board (stats-net.js watchBoard, falling back to players/
// exactly as the old board does), the same hidden-row filter, the same admin-only-game filter. Boards are
// built by js/leaderboard2-boards.js (pure); score and puzzle games through the old board's own orders
// (leaderboard-ui.js lb2ScoreSpecs/lb2ScoreBoard). Nothing here writes player data: the only storage is
// two per-device preferences/caches, `gamehub.lb2.v1` (last board per game, a preference) and
// `gamehub.lb2.ranks.v1` (yesterday's ranks for the arrows, until the server keeps a daily snapshot).
// Rows carry an index into an in-memory list, never a player code (tools/test-no-codes.mjs).
import { aggregatePlayers, buildIdentity, SOLO } from './players-agg.js';
import { isHiddenName, HIDDEN_DEVICE_PREFIX } from './hidden-players.js';
import { corrections } from './admin-config.js';
import { watchPlayers, watchBoard } from './stats-net.js';
import { watchBeeBoard } from './bee-board.js';
import { loadProfile } from './profile-store.js';
import { statsId, isTestGame } from './game-stats.js';
import { GAME_ART } from './game-art.js';
import { loadFavorites, toggleFavorite } from './favorites.js';
import { hubIdOf, isGameOnLauncher } from './game-stats-ui.js';
import { diffShapeSVG } from './difficulty-tiers.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';
import LB2 from './leaderboard2-strings.js';
import * as B from './leaderboard2-boards.js';
import { GAME_META, lb2ScoreSpecs, lb2ScoreBoard, ensureLeaderboardCss, openLeaderboard } from './leaderboard-ui.js';

const t = makeT(STRINGS);
const t2 = makeT(LB2);
const TIER_KEY = { 1: 'gs_diff_beginner', 2: 'gs_diff_intermediate', 3: 'gs_diff_pro', 4: 'gs_diff_expert' };
const PREF_KEY = 'gamehub.lb2.v1';
const RANKS_KEY = 'gamehub.lb2.ranks.v1';
const TOP_N = 10;
const PLAYER_LIST = 6;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (id) => { const m = GAME_META.find((x) => x.id === id); return m ? t(m.labelKey) : id; };
const tierName = (tier) => (tier ? t(TIER_KEY[tier]) : t('lb_diff_all'));
const isScore = (id) => SOLO.has(id);
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nameOf = (r) => (String((r && r.name) || '').trim() || t('anon_player'));
function fmt(x, digits) {
  const loc = getLang() === 'es' ? 'es-ES' : 'en-US';
  try { return Number(x).toLocaleString(loc, digits ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : undefined); } catch { return String(x); }
}
const pctText = (p) => (getLang() === 'es' ? `${fmt(p, 1)} %` : `${fmt(p, 1)}%`);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// --- preferences (try/catch; a preference, THE LAW rule 2's carve-out) ---------------------------------
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* best effort */ } }
function prefFor(game) { const p = readJSON(PREF_KEY); return p && p.games && p.games[game] && typeof p.games[game] === 'object' ? p.games[game] : null; }
function savePref(game, sel) {
  const p = readJSON(PREF_KEY) || {};
  const games = p.games && typeof p.games === 'object' ? p.games : {};
  games[game] = sel;
  writeJSON(PREF_KEY, { v: 1, games, updatedAt: Date.now() });
}

// --- state ---------------------------------------------------------------------------------------------
let _host = null;
let _opts = {};
let _people = [];
let _meKey = '';
let _connected = false;
let _model = null;
let _tab = 'boards';
let _chip = null;
let _q = '';
let _hofTop = false;
let _meSort = 'rank';
let _stack = [];          // [{ kind: 'board', game, sel } | { kind: 'player', key, all }]
let _sheet = false;
let _entryGame = null;
let _onPlay = null;
let _canPlay = () => false;
let _unsub = null;
let _beeOff = null;
let _histArmed = false;
let _ranks = null;
let _boardMemo = new Map();
let _pidx = [];           // row index -> person key (never in the DOM)
let _bidx = [];           // row index -> board

const scoreApi = {
  specs: (people, id) => lb2ScoreSpecs(people, id),
  board: (people, id, spec) => lb2ScoreBoard(people, id, spec),
  extras: (people, id) => (id === 'holdem' || id === 'cuppong' ? lb2ScoreSpecs(people, id) : null),
};

// --- the model: every default board, the Hall of Fame, the viewer's summary ------------------------------
function boardGames() {
  return GAME_META.map((m) => m.id).filter((id) => isGameOnLauncher(id) && !isTestGame(id));
}
function buildModel() {
  const games = boardGames();
  const byGame = {};
  const boards = [];
  for (const id of games) {
    let list = [];
    try { list = B.gameBoards(_people, id, { isScore, score: scoreApi }); } catch (err) { console.error('[leaderboard2] boards failed', id, err); }
    byGame[id] = list;
    boards.push(...list);
  }
  const hof = { all: B.hallOfFame(boards), top: B.hallOfFame(boards, { topLevel: true }) };
  _boardMemo = new Map(boards.map((b) => [b.id, b]));
  _model = { games, byGame, boards, hof, me: B.personSummary(boards, _meKey) };
  rollRanksNow();
}
function hofPseudo(which) { return { id: 'hof~' + which, rows: _model.hof[which] }; }
function rollRanksNow() {
  const stored = readJSON(RANKS_KEY);
  const day = B.nyDay();
  const cur = B.rankSnapshot(_model.boards.concat([hofPseudo('all'), hofPseudo('top')]), _meKey);
  if (stored && stored.day === day && stored.cur) for (const k of Object.keys(stored.cur)) if (!cur[k]) cur[k] = stored.cur[k];
  _ranks = B.rollRanks(stored, day, cur);
  writeJSON(RANKS_KEY, _ranks);
}
function noteRanks(board) {
  if (!_ranks || !board || !board.id || _ranks.cur[board.id]) return;
  Object.assign(_ranks.cur, B.rankSnapshot([board], _meKey));
  writeJSON(RANKS_KEY, _ranks);
}
const moveOf = (bid, r) => (_ranks ? B.moveOf(_ranks, bid, r.key, r.rank) : 0);

// --- labels --------------------------------------------------------------------------------------------
function modeLabel(game, key) {
  if (!key) return t2('lb2_all_modes');
  const m = B.parseModeKey(key);
  const parts = [];
  const n = (v) => Number(v);
  switch (game) {
    case 'darts': {
      const k = String(m.kind || '');
      if (!k.startsWith('cricket')) parts.push(k);
      else {
        parts.push(t2('lb2_m_cricket'));
        if (k.includes('order')) parts.push(t2('lb2_m_in_order'));
        if (k.endsWith('-np')) parts.push(t2('lb2_m_no_points'));
      }
      break;
    }
    case 'eightball': parts.push(({ 8: t2('lb2_m_8'), 9: t2('lb2_m_9'), ct: t2('lb2_m_ct') })[m.game] || m.game); break;
    case 'flicksoccer': parts.push(t2('lb2_m_goals', { n: n(m.goals) })); break;
    case 'cuppong': parts.push(t2('lb2_m_rr', { n: n(m.rr) })); break;
    case 'battleship': case 'dotsboxes': {
      const v = m.size;
      parts.push(({ quick: t2('lb2_m_quick'), classic: t2('lb2_m_classic'), small: t2('lb2_m_small'), medium: t2('lb2_m_medium'), large: t2('lb2_m_large') })[v] || v);
      break;
    }
    case 'boggle':
      if (m.lang) parts.push(m.lang === 'es' ? 'Español' : 'English');
      if (m.min) parts.push(t2('lb2_m_min', { n: m.min }));
      break;
    case 'chinchon': {
      if (m.n) parts.push(t2('lb2_m_players', { n: m.n }));
      const pts = m.sl ? t2('lb2_m_pts', { n: m.sl }) : '', rds = m.rl ? t2('lb2_m_rounds', { n: m.rl }) : '';
      if (pts && rds) parts.push(t2('lb2_m_or', { a: pts, b: rds })); else if (pts || rds) parts.push(pts || rds);
      break;
    }
    case 'escoba':
      if (m.n) parts.push(t2('lb2_m_players', { n: m.n }));
      if (m.to) parts.push(t2('lb2_m_to', { n: m.to }));
      if (m.deck) parts.push(t2(m.deck === 'american' ? 'lb2_m_american' : 'lb2_m_spanish'));
      break;
    case 'dominoes': parts.push(t2('lb2_m_to', { n: m.to })); break;
    case 'tictactoe': parts.push(m.v === 'ultimate' ? t2('lb2_m_ultimate') : t2('lb2_m_classic')); break;
    case 'uno': parts.push(t2('lb2_m_players', { n: m.n })); break;
    case 'business': parts.push(t2('lb2_m_computers', { n: n(m.ai) })); break;
    case 'holdem': { const k = 'lb2_m_' + m.tier; const v = t2(k); parts.push(v === k ? m.tier : v); break; }
    default: for (const v of Object.values(m)) parts.push(v);
  }
  return parts.filter(Boolean).join(' · ') || t2('lb2_all_modes');
}
function scoreSpecs(game) { try { return isScore(game) ? lb2ScoreSpecs(_people, game) : scoreApi.extras(_people, game); } catch { return null; } }
function viewLabel(game, view) {
  const sp = scoreSpecs(game);
  const v = sp && sp.views ? sp.views.find((x) => x.view === view) : null;
  return v ? v.label : '';
}
function langLabel(lang) { return lang === 'en' ? 'English' : lang === 'es' ? 'Español' : t2('lb2_en_es'); }
/** The line under a board's title: mode · opponent (or the language / the number's name). */
function subLine(b) {
  if (b.type === 'wins') return [modeLabel(b.game, b.mode), b.opp === 'mp' ? t2('lb2_mp') : t2('lb2_vs_cpu')].join(' · ');
  const parts = [];
  const vl = b.view ? viewLabel(b.game, b.view) : '';
  if (vl) parts.push(vl);
  if (b.game === 'spellingbee') parts.push(langLabel(b.lang));
  return parts.join(' · ') || cap(b.unit || '');
}
/** A board in one line, for lists (Me, Player): "Cricket · In order · Hard · vs computer". */
function boardDesc(b) {
  const parts = [];
  if (b.type === 'wins') {
    if (b.mode) parts.push(modeLabel(b.game, b.mode));
    if (b.diff) parts.push(tierName(b.diff));
    parts.push(b.opp === 'mp' ? t2('lb2_mp') : t2('lb2_vs_cpu'));
  } else {
    const vl = b.view ? viewLabel(b.game, b.view) : '';
    if (vl) parts.push(vl);
    if (b.diff) parts.push(tierName(b.diff));
    if (b.game === 'spellingbee') parts.push(langLabel(b.lang));
    if (!parts.length) parts.push(cap(b.unit || ''));
  }
  return parts.join(' · ');
}
function valueText(b, r) {
  if (b.metric === 'pct') return pctText(r.pct);
  if (b.metric === 'wins') return fmt(r.won);
  return r.text;
}
function valueHTML(b, r) {
  if (b.metric !== 'score') return esc(valueText(b, r));
  const shape = b.diff == null && r.tier ? `<span class="lb2-shape">${diffShapeSVG(r.tier)}</span>` : '';
  // A word in place of a number ("Under review") is set smaller so it never runs into the Games column.
  if (/[A-Za-zÀ-ſ]{3,}/.test(String(r.text || '')) && !/<img/.test(r.html || '')) return `<span class="lb2-word">${esc(r.text)}</span>`;
  return shape + (r.html || esc(r.text));
}
function metricHead(b) {
  if (b.metric === 'pct') return t2('lb2_col_pct');
  if (b.metric === 'wins') return t2('lb2_col_wins');
  return cap(b.unit || '');
}

// --- markup pieces ---------------------------------------------------------------------------------------
const SVG = {
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  heart: (s, on) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.2 3.4 4.5 7 4.5c2.1 0 3.6 1.1 5 2.9 1.4-1.8 2.9-2.9 5-2.9 3.6 0 6 3.7 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>`,
  crown: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  x: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const med = (n, cls = '') => (n <= 3 ? `<span class="lb2-med m${n} num ${cls}">${n}</span>` : `<span class="lb2-plain num">${n}</span>`);
const mv = (d) => (d > 0 ? `<span class="lb2-mv up num">▲${d}</span>` : d < 0 ? `<span class="lb2-mv dn num">▼${-d}</span>` : '');
function pIdx(key) { let i = _pidx.indexOf(key); if (i < 0) { i = _pidx.length; _pidx.push(key); } return i; }
function bIdx(b) { let i = _bidx.indexOf(b); if (i < 0) { i = _bidx.length; _bidx.push(b); } return i; }
function seg(items, on, act, fit = false) {
  return `<div class="lb2-seg${fit ? ' fit' : ''}" role="group" style="grid-template-columns:repeat(${items.length},minmax(0,1fr))">${items.map((x) => `<button type="button" class="${x.v === on ? 'on' : ''}${items.length > 4 ? ' sm' : ''}" data-act="${act}" data-v="${esc(x.v)}" aria-pressed="${x.v === on}">${esc(x.label)}</button>`).join('')}</div>`;
}
function headHTML(extra = '') {
  return `<div class="lb2-head"><div class="lb2-titlerow"><h1>${esc(t2('lb2_title'))}</h1><button type="button" class="lb2-icon lb2-x" data-act="close" aria-label="${esc(t2('lb2_close'))}">${SVG.x}</button></div>
    ${seg([{ v: 'boards', label: t2('lb2_tab_boards') }, { v: 'hof', label: t2('lb2_tab_hof') }, { v: 'me', label: t2('lb2_tab_me') }], _tab, 'tab', true)}${extra}</div>`;
}
const playable = (game) => !!(_onPlay && _canPlay(hubIdOf(game)));

// --- Boards (tab 1) --------------------------------------------------------------------------------------
function meGroup() { return _people.find((g) => g.key === _meKey) || null; }
function playedGame(id) {
  const g = meGroup();
  if (_model.me.best[id] != null) return true;
  return !!(g && g.games && g.games[id] && ((g.games[id].total || {}).played | 0) > 0);
}
function gameRows() {
  const favs = new Set(loadFavorites());
  return _model.games.map((id) => ({ id, title: title(id), fav: favs.has(hubIdOf(id)), played: playedGame(id),
    crowns: _model.me.crowns[id] || 0, best: _model.me.best[id], n: _model.byGame[id].length }));
}
function chipNow(rows) {
  if (_chip) return _chip;
  return rows.some((r) => r.fav) ? 'fav' : rows.some((r) => r.played) ? 'played' : 'all';
}
function boardsListHTML() {
  const rows = gameRows();
  const chip = chipNow(rows);
  const q = fold(_q.trim());
  let list = rows.filter((r) => (chip === 'fav' ? r.fav : chip === 'played' ? r.played : true));
  if (q) list = rows.filter((r) => fold(r.title).includes(q));
  const az = (a, b) => a.title.localeCompare(b.title);
  if (chip === 'all' && !q) list.sort(az);
  else list.sort((a, b) => ((a.best == null) - (b.best == null)) || ((a.best || 0) - (b.best || 0)) || az(a, b));
  const items = list.map((r) => {
    const art = GAME_ART[hubIdOf(r.id)] || '';
    const sub = r.id === 'spellingbee' ? t2('lb2_en_es') : t2('lb2_n_boards', { n: r.n });
    return `<button type="button" class="lb2-row" data-act="game" data-game="${esc(r.id)}">
      <span class="lb2-ic">${art}</span>
      <span class="lb2-grow"><span class="lb2-t1">${esc(r.title)}</span><span class="lb2-t2">${esc(sub)}</span></span>
      <span class="lb2-right"><span class="lb2-crown num${r.crowns ? '' : ' mute'}">${SVG.crown}${r.crowns}</span><span class="lb2-best num">${r.best != null ? '#' + r.best : '–'}</span></span>
    </button>`;
  }).join('');
  return (items ? `<div class="lb2-card">${items}</div>` : `<p class="lb2-empty-t">${esc(t2('lb2_none'))}</p>`)
    + `<button type="button" class="lb2-old" data-act="old">${esc(t2('lb2_old'))}</button>`;
}
function boardsHTML() {
  const rows = gameRows();
  const chip = chipNow(rows);
  const nFav = rows.filter((r) => r.fav).length, nPlayed = rows.filter((r) => r.played).length;
  const chips = `<div class="lb2-chips">
    <button type="button" class="lb2-chip${chip === 'fav' ? ' on' : ''}" data-act="chip" data-v="fav" aria-label="${esc(t2('lb2_favs_aria'))}" aria-pressed="${chip === 'fav'}">${SVG.heart(16, true)}<span class="num">${nFav}</span></button>
    <button type="button" class="lb2-chip${chip === 'played' ? ' on' : ''}" data-act="chip" data-v="played" aria-pressed="${chip === 'played'}">${esc(t2('lb2_played', { n: nPlayed }))}</button>
    <button type="button" class="lb2-chip${chip === 'all' ? ' on' : ''}" data-act="chip" data-v="all" aria-pressed="${chip === 'all'}">${esc(t2('lb2_all', { n: rows.length }))}</button></div>`;
  const search = `<label class="lb2-search">${SVG.search}<input type="search" data-role="q" value="${esc(_q)}" placeholder="${esc(t2('lb2_search', { n: rows.length }))}" aria-label="${esc(t2('lb2_search_aria'))}" autocomplete="off" enterkeyhint="search"></label>`;
  return headHTML(search + chips)
    + `<div class="lb2-scroll" data-role="scroll"><div class="lb2-body" data-role="glist">${boardsListHTML()}</div></div>`;
}

// --- one game's board -------------------------------------------------------------------------------------
function shapeOf(game) { return B.winsShape(_people, game); }
/** A valid selection for `game`, from `want` (a saved or tapped one) or the defaults. */
function selFor(game, want) {
  const w = want && typeof want === 'object' ? want : {};
  if (isScore(game)) {
    const sp = scoreSpecs(game) || { tiers: [], views: [{ view: '' }], rankBy: [], langs: null };
    const view = sp.views.some((v) => v.view === w.view) ? w.view : (sp.views[0] ? sp.views[0].view : '');
    const vt = (sp.views.find((v) => v.view === view) || {}).tiered;
    const diff = vt && sp.tiers.includes(w.diff) ? w.diff : null;
    const lang = sp.langs ? (sp.langs.some((l) => l.lang === w.lang) ? w.lang : 'all') : undefined;
    const by = sp.rankBy.length ? (sp.rankBy.some((r) => r.by === w.by) ? w.by : sp.rankBy[0].by) : undefined;
    return { view, diff: vt ? diff : null, lang, by };
  }
  const sh = shapeOf(game);
  const ex = scoreSpecs(game);
  if (w.extra && ex && ex.views.some((v) => v.view === w.extra)) return { extra: w.extra };
  let opp = w.opp === 'mp' && sh.mpModes.length ? 'mp' : w.opp === 'ai' && sh.aiTiers.length ? 'ai' : (sh.aiTiers.length ? 'ai' : sh.mpModes.length ? 'mp' : 'ai');
  const modes = opp === 'mp' ? sh.mpModes : sh.aiModes;
  const mode = modes.includes(w.mode) ? w.mode : '';
  const tiers = sh.aiTiers;
  const diff = opp === 'mp' ? null : (tiers.includes(w.diff) ? w.diff : (tiers.length ? tiers[tiers.length - 1] : null));
  const rankBy = opp === 'mp' ? 'wins' : (w.rankBy === 'wins' ? 'wins' : 'pct');
  return { opp, mode, diff, rankBy };
}
function specOf(game, sel) {
  if (isScore(game)) return { game, type: 'score', view: sel.view, diff: sel.diff, lang: sel.lang, by: sel.by };
  if (sel.extra) return { game, type: 'score', view: sel.extra, diff: null };
  return { game, type: 'wins', opp: sel.opp, mode: sel.mode, diff: sel.diff, rankBy: sel.rankBy };
}
function boardOf(game, sel) {
  const spec = specOf(game, sel);
  const id = B.boardId(spec.type === 'wins' ? { ...spec, rankBy: spec.opp === 'mp' ? 'wins' : spec.rankBy } : spec);
  let b = _boardMemo.get(id);
  if (!b) { b = B.buildBoard(_people, spec, scoreApi); _boardMemo.set(b.id, b); }
  noteRanks(b);
  return b;
}
function selFromBoard(b) {
  if (b.type === 'wins') return { opp: b.opp, mode: b.mode, diff: b.diff, rankBy: b.rankBy };
  if (!isScore(b.game)) return { extra: b.view };
  return { view: b.view, diff: b.diff, lang: b.lang, by: b.by };
}
function colsOf(b) {
  return b.game === 'spellingbee' ? '44px minmax(0,1fr) 96px' : '44px minmax(0,1fr) 58px 96px';
}
function boardScreenHTML(top) {
  const game = top.game;
  const sel = top.sel = selFor(game, top.sel);
  const b = boardOf(game, sel);
  const cols = colsOf(b);
  const games = b.game !== 'spellingbee';
  const fav = loadFavorites().includes(hubIdOf(game));
  const bar = `<div class="lb2-bar"><button type="button" class="lb2-icon" data-act="back" aria-label="${esc(t2('lb2_back'))}">${SVG.back}</button>
    <span class="lb2-grow"><h1>${esc(title(game))}</h1><span class="lb2-t2">${esc(subLine(b))}</span></span>
    <button type="button" class="lb2-icon lb2-heart" data-act="fav" aria-pressed="${fav}" aria-label="${esc(t2(fav ? 'lb2_fav_remove' : 'lb2_fav_add'))}">${SVG.heart(24, fav)}</button></div>`;
  const head = `<div class="lb2-cols" style="grid-template-columns:${cols}"><span class="c">${esc(t2('lb2_col_rank'))}</span><span>${esc(t2('lb2_col_player'))}</span>${games ? `<span class="r">${esc(t2('lb2_col_games'))}</span>` : ''}<span class="r">${esc(metricHead(b))}</span></div>`;
  const rows = b.rows.slice(0, TOP_N);
  let list;
  if (!rows.length) {
    const d = b.diff ? tierName(b.diff) : '';
    const play = playable(game) ? `<button type="button" class="lb2-play" data-act="play" data-game="${esc(game)}">${esc(d ? t2('lb2_play_diff', { d }) : t2('lb2_play'))}</button>` : '';
    list = `<div class="lb2-card"><div class="lb2-emptyst"><span class="lb2-med m1 big num">1</span><b>${esc(t2('lb2_open'))}</b>${play}</div></div>`;
  } else {
    list = `<div class="lb2-card">${rows.map((r) => `<button type="button" class="lb2-lr${r.key === _meKey ? ' me' : ''}" style="grid-template-columns:${cols}" data-act="person" data-pi="${pIdx(r.key)}">
      ${med(r.rank)}<span class="lb2-nm"><span class="lb2-nmt">${esc(nameOf(r))}</span>${mv(moveOf(b.id, r))}</span>${games ? `<span class="r lb2-gm num">${fmt(r.games)}</span>` : ''}<span class="r lb2-val num">${valueHTML(b, r)}</span></button>`).join('')}</div>`;
  }
  // Bottom controls: the difficulty (or Spelling Bee's language) in one tap, the rest behind the gear.
  let segHTML = '<span class="lb2-grow"></span>';
  const sp = scoreSpecs(game);
  if (b.type === 'wins' && b.opp !== 'mp') {
    const tiers = shapeOf(game).aiTiers.filter((x) => x != null);
    if (tiers.length > 1 || (tiers.length === 1)) segHTML = `<div class="lb2-grow">${seg(tiers.map((x) => ({ v: String(x), label: tierName(x) })), String(b.diff), 'diff')}</div>`;
  } else if (isScore(game) && sp) {
    if (sp.langs) segHTML = `<div class="lb2-grow">${seg(sp.langs.map((l) => ({ v: l.lang, label: l.label })), b.lang, 'lang')}</div>`;
    else {
      const vt = (sp.views.find((v) => v.view === b.view) || {}).tiered;
      if (vt && sp.tiers.length) segHTML = `<div class="lb2-grow">${seg(sp.tiers.map((x) => ({ v: x == null ? '' : String(x), label: tierName(x) })), b.diff == null ? '' : String(b.diff), 'diff')}</div>`;
    }
  }
  const gear = sheetSections(game, b).length ? `<button type="button" class="lb2-gear" data-act="sheet" aria-label="${esc(t2('lb2_settings'))}">${SVG.gear}</button>` : '';
  const ctrl = segHTML.includes('lb2-seg') || gear ? `<div class="lb2-ctrl">${segHTML}${gear}</div>` : '';
  // The pinned viewer row, always.
  const me = b.rows.find((r) => r.key === _meKey) || null;
  const meName = esc(nameOf(meGroup() || { name: (loadProfile() || {}).name }));
  let pin;
  if (me) {
    pin = `<div class="lb2-pin" style="grid-template-columns:${cols}"><span class="c num lb2-pinrank">#${me.rank}</span>
      <span class="lb2-grow"><span class="lb2-nm"><b class="lb2-nmt">${meName}</b>${mv(moveOf(b.id, me))}</span><span class="lb2-gap num">${esc(B.gapLine(b, me, t2, fmt))}</span></span>
      ${games ? `<span class="r num">${fmt(me.games)}</span>` : ''}<span class="r lb2-val num">${valueHTML(b, me)}</span></div>`;
  } else {
    const play = playable(game) ? `<button type="button" class="lb2-play sm" data-act="play" data-game="${esc(game)}">${esc(t2('lb2_play'))}</button>` : '';
    pin = `<div class="lb2-pin" style="grid-template-columns:${cols}"><span class="c num lb2-pinrank">–</span>
      <span class="lb2-grow"><b class="lb2-nmt">${meName}</b><span class="lb2-gap">${esc(t2('lb2_not_ranked'))}</span></span>
      <span class="lb2-pinplay" style="grid-column:${games ? '3 / span 2' : '3'}">${play}</span></div>`;
  }
  return `${bar}${head}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body">${list}</div></div>${ctrl}${pin}${_sheet ? sheetHTML(game, b) : ''}`;
}
/** The settings sheet's sections for a board: [{ label, html }]. */
function sheetSections(game, b) {
  const out = [];
  const sel = selFromBoard(b);
  if (isScore(game)) {
    const sp = scoreSpecs(game);
    if (!sp) return out;
    if (sp.views.length > 1) out.push({ label: t2('lb2_mode'), html: chips(sp.views.map((v) => ({ v: v.view, label: v.label || t2('lb2_all_modes') })), sel.view, 'view') });
    if (sp.rankBy.length > 1) out.push({ label: t2('lb2_rank_by'), html: seg(sp.rankBy.map((r) => ({ v: r.by, label: r.label })), sel.by, 'by') });
    return out;
  }
  const sh = shapeOf(game);
  const ex = scoreSpecs(game);
  const modes = (sel.extra ? sh.aiModes : (b.opp === 'mp' ? sh.mpModes : sh.aiModes));
  const modeChips = modes.map((m) => ({ v: 'm:' + m, label: modeLabel(game, m) }));
  if (ex && ex.views) for (const v of ex.views) modeChips.push({ v: 'x:' + v.view, label: v.label });
  if (modeChips.length > 1) out.push({ label: t2('lb2_mode'), html: chips(modeChips, sel.extra ? 'x:' + sel.extra : 'm:' + (sel.mode || ''), 'mode') });
  if (!sel.extra && sh.aiTiers.length && sh.mpModes.length) out.push({ label: t2('lb2_opponent'), html: seg([{ v: 'ai', label: t2('lb2_vs_cpu') }, { v: 'mp', label: t2('lb2_mp') }], b.opp, 'opp') });
  if (!sel.extra && b.opp === 'ai') out.push({ label: t2('lb2_rank_by'), html: seg([{ v: 'pct', label: t2('lb2_col_pct') }, { v: 'wins', label: t2('lb2_col_wins') }], b.rankBy, 'rankby') });
  return out;
}
function chips(items, on, act) {
  return `<div class="lb2-chips">${items.map((x) => `<button type="button" class="lb2-chip${x.v === on ? ' on' : ''}" data-act="${act}" data-v="${esc(x.v)}" aria-pressed="${x.v === on}">${esc(x.label)}</button>`).join('')}</div>`;
}
function sheetHTML(game, b) {
  const secs = sheetSections(game, b);
  return `<div class="lb2-sheet" data-act="sheet-close"><div class="lb2-sh" data-act="noop"><div class="lb2-grab"></div>
    ${secs.map((s) => `<div><div class="lb2-lbl">${esc(s.label)}</div>${s.html}</div>`).join('')}
    <button type="button" class="lb2-done" data-act="sheet-close">${esc(t2('lb2_done'))}</button></div></div>`;
}

// --- Hall of Fame ----------------------------------------------------------------------------------------
function hofHTML() {
  const which = _hofTop ? 'top' : 'all';
  const rows = _model.hof[which];
  const bid = 'hof~' + which;
  const cols = '44px minmax(0,1fr) 46px 46px 46px';
  const m = (n) => `<span class="c"><span class="lb2-med m${n} sm num">${n}</span></span>`;
  const head = `<div class="lb2-cols" style="grid-template-columns:${cols}"><span class="c">#</span><span>${esc(t2('lb2_col_player'))}</span>${m(1)}${m(2)}${m(3)}</div>`;
  const list = rows.length ? `<div class="lb2-card">${rows.map((r) => `<button type="button" class="lb2-lr${r.key === _meKey ? ' me' : ''}" style="grid-template-columns:${cols}" data-act="person" data-pi="${pIdx(r.key)}">
      <span class="c num lb2-hofrank${r.rank <= 3 ? ' top' : ''}">${r.rank}</span><span class="lb2-nm"><span class="lb2-nmt">${esc(nameOf(r))}</span>${mv(moveOf(bid, r))}</span>
      <span class="c num lb2-strong">${r.firsts}</span><span class="c lb2-gm num">${r.seconds}</span><span class="c lb2-gm num">${r.thirds}</span></button>`).join('')}</div>`
    : `<div class="lb2-card"><p class="lb2-empty-t">${esc(t2('lb2_nothing'))}</p></div>`;
  const me = rows.find((r) => r.key === _meKey) || null;
  const meName = esc(nameOf(meGroup() || { name: (loadProfile() || {}).name }));
  let gap;
  if (!me) gap = t2('lb2_not_ranked');
  else if (me.rank === 1) gap = t2('lb2_first');
  else { const above = B.aboveOf(rows, me); gap = t2('lb2_pass', { n: B.firstsToPass(me, above), r: above.rank }); }
  const pin = `<div class="lb2-pin" style="grid-template-columns:${cols}"><span class="c num lb2-pinrank">${me ? '#' + me.rank : '–'}</span>
    <span class="lb2-grow"><span class="lb2-nm"><b class="lb2-nmt">${meName}</b>${me ? mv(moveOf(bid, me)) : ''}</span><span class="lb2-gap num">${esc(gap)}</span></span>
    <span class="c num lb2-strong">${me ? me.firsts : ''}</span><span class="c num">${me ? me.seconds : ''}</span><span class="c num">${me ? me.thirds : ''}</span></div>`;
  const ctrl = `<div class="lb2-ctrl"><div class="lb2-grow">${seg([{ v: 'all', label: t2('lb2_all_levels') }, { v: 'top', label: t2('lb2_top_level') }], which, 'hoflvl')}</div></div>`;
  return `${headHTML()}${head}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body">${list}</div></div>${ctrl}${pin}`;
}
function hofRankOf(key) { const r = _model.hof.all.find((x) => x.key === key); return r ? r.rank : null; }

// --- Me ---------------------------------------------------------------------------------------------------
function meHTML() {
  const s = _model.me;
  const hr = hofRankOf(_meKey);
  const tiles = `<div class="lb2-tiles">
    <button type="button" class="lb2-tile" data-act="myfirsts"><b class="num">${s.firsts}</b><span>${esc(t2('lb2_firsts_tile'))}</span></button>
    <button type="button" class="lb2-tile" data-act="tab" data-v="hof"><b class="num">${hr ? '#' + hr : '–'}</b><span>${esc(t2('lb2_hof_tile'))}</span></button>
    <button type="button" class="lb2-tile" data-act="tab" data-v="boards"><b class="num">${s.ranked}</b><span>${esc(t2('lb2_boards_tile'))}</span></button></div>`;
  const close = [];
  for (const b of _model.boards) {
    const r = b.rows.find((x) => x.key === _meKey);
    if (!r || r.rank < 2 || r.rank > 5) continue;
    const lead = b.rows.find((x) => x.rank === 1);
    const gap = B.gapOf(b, r, lead, fmt);
    close.push({ b, r, gap });
  }
  close.sort((a, b) => a.r.rank - b.r.rank || (a.gap ? 0 : 1) - (b.gap ? 0 : 1) || title(a.b.game).localeCompare(title(b.b.game)));
  const closeHTML = close.length ? `<div><h2 class="lb2-h2">${esc(t2('lb2_closest'))}</h2><div class="lb2-card">${close.slice(0, 5).map(({ b, r, gap }) => `<button type="button" class="lb2-row" data-act="board" data-bi="${bIdx(b)}">
      ${med(r.rank)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(b.game))}</span><span class="lb2-t2">${esc(boardDesc(b))}</span></span>
      <span class="lb2-acc num">${gap && gap.k !== 'tier' ? esc(t2('lb2_amt', gap)) : ''}</span></button>`).join('')}</div></div>` : '';
  const games = _model.games.filter((id) => playedGame(id)).map((id) => ({ id, title: title(id), f: s.crowns[id] || 0, n: s.boards[id] || 0, best: s.best[id] }));
  if (_meSort === 'az') games.sort((a, b) => a.title.localeCompare(b.title));
  else games.sort((a, b) => ((a.best == null) - (b.best == null)) || ((a.best || 0) - (b.best || 0)) || (b.f - a.f) || a.title.localeCompare(b.title));
  const gamesHTML = `<div><div class="lb2-gh"><h2 class="lb2-h2">${esc(t2('lb2_games'))}</h2><div class="lb2-gseg">${seg([{ v: 'rank', label: t2('lb2_sort_rank') }, { v: 'az', label: t2('lb2_sort_az') }], _meSort, 'mesort')}</div></div>
    ${games.length ? `<div class="lb2-card">${games.map((x) => `<button type="button" class="lb2-row sm" data-act="game" data-game="${esc(x.id)}"><span class="lb2-ic sm">${GAME_ART[hubIdOf(x.id)] || ''}</span>
      <span class="lb2-grow"><span class="lb2-t1">${esc(x.title)}</span><span class="lb2-t2">${esc(x.id === 'spellingbee' ? t2('lb2_en_es') : x.f ? t2('lb2_firsts_line', { f: x.f, b: x.n }) : t2('lb2_n_boards', { n: x.n }))}</span></span>
      <span class="lb2-strong num">${x.best != null ? '#' + x.best : '–'}</span></button>`).join('')}</div>` : `<div class="lb2-card"><p class="lb2-empty-t">${esc(t2('lb2_nothing'))}</p></div>`}</div>`;
  return `${headHTML()}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body lb2-pad">${tiles}${closeHTML}${gamesHTML}</div></div>`;
}

// --- Player -----------------------------------------------------------------------------------------------
function playerHTML(top) {
  const g = _people.find((x) => x.key === top.key) || {};
  const s = B.personSummary(_model.boards, top.key);
  const hr = hofRankOf(top.key);
  const firsts = [];
  for (const b of _model.boards) { const r = b.rows.find((x) => x.key === top.key && x.rank === 1 && !x.noPodium); if (r) firsts.push({ b, r }); }
  firsts.sort((a, b) => title(a.b.game).localeCompare(title(b.b.game)));
  const shown = top.all ? firsts : firsts.slice(0, PLAYER_LIST);
  const face = String(g.emoji || '').trim() || esc(nameOf(g).slice(0, 1).toUpperCase());
  const bar = `<div class="lb2-bar"><button type="button" class="lb2-icon" data-act="back" aria-label="${esc(t2('lb2_back'))}">${SVG.back}</button>
    <span class="lb2-face">${esc(face)}</span><span class="lb2-grow lb2-pl"><h1>${esc(nameOf(g))}</h1><span class="lb2-t2">${hr ? esc(t2('lb2_hof_rank', { n: hr })) : ''}</span></span></div>`;
  const tiles = `<div class="lb2-tiles"><div class="lb2-tile"><b class="num">${s.firsts}</b><span>${esc(t2('lb2_firsts_tile'))}</span></div>
    <div class="lb2-tile"><b class="num">${hr ? '#' + hr : '–'}</b><span>${esc(t2('lb2_hof_tile'))}</span></div>
    <div class="lb2-tile"><b class="num">${s.ranked}</b><span>${esc(t2('lb2_boards_tile'))}</span></div></div>`;
  const list = firsts.length ? `<div><h2 class="lb2-h2">${esc(t2('lb2_firsts_h'))}</h2><div class="lb2-card">${shown.map(({ b, r }) => `<button type="button" class="lb2-row sm" data-act="board" data-bi="${bIdx(b)}">
      ${med(1)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(b.game))}</span><span class="lb2-t2">${esc(boardDesc(b))}</span></span><span class="lb2-strong num">${esc(valueText(b, r))}</span></button>`).join('')}</div></div>
    ${!top.all && firsts.length > PLAYER_LIST ? `<button type="button" class="lb2-more" data-act="seeall">${esc(t2('lb2_see_all', { n: firsts.length }))}</button>` : ''}` : '';
  return `${bar}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body lb2-pad">${tiles}${list}</div></div>`;
}

// --- render ----------------------------------------------------------------------------------------------
function screenHTML() {
  _pidx = []; _bidx = [];
  if (!_connected || !_model) return `${headHTML()}<div class="lb2-scroll"><p class="lb2-empty-t">${esc(t2(navigator.onLine === false ? 'lb2_offline' : 'lb2_loading'))}</p></div>`;
  const top = _stack[_stack.length - 1];
  if (top && top.kind === 'board') return boardScreenHTML(top);
  if (top && top.kind === 'player') return playerHTML(top);
  if (_tab === 'hof') return hofHTML();
  if (_tab === 'me') return meHTML();
  return boardsHTML();
}
let _lastHTML = '';
function render({ keepScroll = false } = {}) {
  if (!_host) return;
  const page = _host.querySelector('.lb2-page');
  const old = page.querySelector('[data-role="scroll"]');
  const top = keepScroll && old ? old.scrollTop : 0;
  const html = screenHTML();
  if (html === _lastHTML) return;
  const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.role === 'q';
  page.innerHTML = html;
  _lastHTML = html;
  const sc = page.querySelector('[data-role="scroll"]');
  if (sc) sc.scrollTop = top;
  if (focused) { const q = page.querySelector('[data-role="q"]'); if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch { /* type=search */ } } }
}
function onData() { if (!_host) return; buildModel(); render({ keepScroll: true }); }

// --- navigation ------------------------------------------------------------------------------------------
function openGame(game, sel) {
  _sheet = false;
  _stack.push({ kind: 'board', game, sel: sel || prefFor(game) });
  render();
}
function openPerson(key) {
  if (key === _meKey) { _stack = []; _tab = 'me'; render(); return; }
  _stack.push({ kind: 'player', key, all: false });
  render();
}
function stepBack() {
  if (_sheet) { _sheet = false; render({ keepScroll: true }); return true; }
  if (_stack.length === 1 && _entryGame && _stack[0].kind === 'board' && _stack[0].game === _entryGame) return false;
  if (_stack.length) { _stack.pop(); render(); return true; }
  return false;
}
function setSel(patch) {
  const top = _stack[_stack.length - 1];
  if (!top || top.kind !== 'board') return;
  top.sel = selFor(top.game, { ...(top.sel || {}), ...patch });
  savePref(top.game, top.sel);
  render();
}
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || !_host || !_host.contains(el)) return;
  const act = el.dataset.act, v = el.dataset.v;
  if (act === 'noop') return;
  if (act === 'sheet-close') { _sheet = false; render({ keepScroll: true }); return; }
  switch (act) {
    case 'close': closeLeaderboard2(); return;
    case 'tab': _stack = []; _tab = v; render(); return;
    case 'chip': _chip = v; _q = ''; render(); return;
    case 'game': openGame(el.dataset.game); return;
    case 'board': { const b = _bidx[Number(el.dataset.bi)]; if (b) openGame(b.game, selFromBoard(b)); return; }
    case 'person': { const k = _pidx[Number(el.dataset.pi)]; if (k != null) openPerson(k); return; }
    case 'back': if (!stepBack()) closeLeaderboard2(); return;
    case 'fav': { const top = _stack[_stack.length - 1]; if (top) { toggleFavorite(hubIdOf(top.game)); render({ keepScroll: true }); } return; }
    case 'sheet': _sheet = true; render({ keepScroll: true }); return;
    case 'diff': setSel({ diff: v === '' ? null : Number(v) }); return;
    case 'lang': setSel({ lang: v }); return;
    case 'view': setSel({ view: v, diff: null }); return;
    case 'by': setSel({ by: v }); return;
    case 'opp': setSel({ opp: v, mode: '' }); return;
    case 'rankby': setSel({ rankBy: v }); return;
    case 'mode': if (v.startsWith('x:')) setSel({ extra: v.slice(2) }); else setSel({ extra: '', mode: v.slice(2) }); return;
    case 'hoflvl': _hofTop = v === 'top'; render(); return;
    case 'mesort': _meSort = v === 'az' ? 'az' : 'rank'; render({ keepScroll: true }); return;
    case 'myfirsts': _stack.push({ kind: 'player', key: _meKey, all: false }); render(); return;
    case 'seeall': { const top = _stack[_stack.length - 1]; if (top) { top.all = true; render({ keepScroll: true }); } return; }
    case 'play': { const fn = _onPlay, hub = hubIdOf(el.dataset.game); closeLeaderboard2(); if (fn) fn(hub); return; }
    case 'old': { const o = { ..._opts, legacy: true }; closeLeaderboard2({ keepHistory: true }); openLeaderboard(o); return; }
    default:
  }
}
function onInput(e) {
  if (!e.target || e.target.dataset.role !== 'q') return;
  _q = e.target.value || '';
  const box = _host && _host.querySelector('[data-role="glist"]');
  if (box) { _pidx = []; _bidx = []; box.innerHTML = boardsListHTML(); }
}
function onKey(e) { if (e.key === 'Escape' && _host) { if (!stepBack()) closeLeaderboard2(); } }
function armHistory() { try { history.pushState({ gamehubOverlay: 'leaderboard2' }, ''); _histArmed = true; } catch { _histArmed = false; } }
function onPop() {
  if (!_host) return;
  _histArmed = false;
  if (stepBack()) armHistory(); else closeLeaderboard2();
}
// The compact layout's own tab bar stays usable (the Multiplayer screen's way): another tab puts this away.
function onTabTap(e) {
  const tab = e.target.closest && e.target.closest('.hub-tabs [data-tab]');
  if (tab && _host && tab.dataset.tab !== 'leaderboard') closeLeaderboard2();
}
function lightTab(on) {
  for (const el of document.querySelectorAll('.hub-tabs [data-tab]')) {
    const lit = on ? el.dataset.tab === 'leaderboard' : el.dataset.tab === 'games';
    el.classList.toggle('is-on', lit);
    if (lit) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  }
}

export function closeLeaderboard2({ keepHistory = false } = {}) {
  if (typeof _unsub === 'function') { try { _unsub(); } catch { /* gone */ } }
  _unsub = null;
  if (_beeOff) { try { _beeOff(); } catch { /* gone */ } _beeOff = null; }
  if (_host) { _host.remove(); _host = null; lightTab(false); }
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('click', onTabTap, true);
  window.removeEventListener('popstate', onPop);
  if (_histArmed) { _histArmed = false; if (!keepHistory) { try { history.back(); } catch { /* ignore */ } } }
  _connected = false; _model = null; _lastHTML = '';
}

/** Open Leaderboard v2. `opts.game` (a stats id): straight onto that game's board, back = close.
 *  `{onPlay, canPlay}`: the launcher's way to start a game (Play on an empty board / a pinned row). */
export async function openLeaderboard2(opts = {}) {
  closeLeaderboard2();
  ensureCss();
  try { ensureLeaderboardCss(); } catch { /* Minesweeper's % bar and Contexto's medals style from it */ }
  _opts = { ...opts };
  delete _opts.legacy;
  _onPlay = typeof opts.onPlay === 'function' ? opts.onPlay : null;
  _canPlay = typeof opts.canPlay === 'function' ? opts.canPlay : () => false;
  _tab = 'boards'; _chip = null; _q = ''; _hofTop = false; _meSort = 'rank'; _sheet = false; _stack = []; _entryGame = null;
  if (typeof opts.game === 'string' && isGameOnLauncher(opts.game)) { _entryGame = opts.game; _stack = [{ kind: 'board', game: opts.game, sel: prefFor(opts.game) }]; }
  const host = document.createElement('div');
  host.className = 'lb2';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', t2('lb2_title'));
  host.innerHTML = '<div class="lb2-page"></div>';
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  document.body.appendChild(host);
  _host = host;
  lightTab(true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onTabTap, true);
  window.addEventListener('popstate', onPop);
  armHistory();
  render();
  try {
    _beeOff = watchBeeBoard(() => { if (_host && _connected) onData(); });
    const sid = statsId(), code = String((loadProfile() || {}).playerId || '').toUpperCase();
    const off = await watchBoard((b) => {
      _people = b.list.filter((g) => !isHiddenName(g && g.name));
      const mine = b.list.find((g) => (b.idsByKey.get(g.key) || []).includes(sid)) || (code ? b.list.find((g) => g.playerId === code) : null);
      _meKey = mine ? mine.key : '';
      _connected = true; onData();
    });
    if (off) _unsub = off;
    else {
      _unsub = await watchPlayers((all) => {
        const recs = {};
        for (const id of Object.keys(all || {})) if (!HIDDEN_DEVICE_PREFIX.some((p) => id.startsWith(p))) recs[id] = all[id];
        _people = aggregatePlayers(recs, corrections()).filter((g) => !isHiddenName(g && g.name));
        try { _meKey = buildIdentity(recs).keyFor(loadProfile() || {}, statsId()); } catch { /* keep */ }
        _connected = true; onData();
      });
    }
    if (!_host && typeof _unsub === 'function') { _unsub(); _unsub = null; }
  } catch (err) { console.error('[leaderboard2] could not load', err); render(); }
}

/** For tests and the visual check: render from a given people list, no network. */
export function __setPeopleForTest(people, meKey) { _people = people || []; _meKey = meKey || ''; _connected = true; onData(); }

function ensureCss() {
  if (document.getElementById('lb2-css')) return;
  const el = document.createElement('style');
  el.id = 'lb2-css';
  el.textContent = `
.lb2{--l2-bg:#F4F5F7;--l2-surf:#FFFFFF;--l2-text:#14161A;--l2-muted:#596170;--l2-line:#E2E5EA;--l2-accent:#1F5FD1;--l2-accentText:#FFFFFF;--l2-chip:#E9ECF1;--l2-seg:#E4E7EC;--l2-segOn:#FFFFFF;--l2-you:#DCE7FB;--l2-youText:#0F3478;--l2-down:#B45309;--l2-scrim:rgba(10,12,16,.45);--l2-g:#E0A92E;--l2-s:#B9C0CA;--l2-b:#C98A55}
:root.gh-dark .lb2{--l2-bg:#0E1014;--l2-surf:#171A20;--l2-text:#F1F3F6;--l2-muted:#A2A9B5;--l2-line:#272B33;--l2-accent:#7AA7FF;--l2-accentText:#0E1014;--l2-chip:#252A33;--l2-seg:#1F232A;--l2-segOn:#323844;--l2-you:#1C2D4D;--l2-youText:#D6E4FF;--l2-down:#FDBA74;--l2-scrim:rgba(0,0,0,.6)}
.lb2{position:fixed;inset:0;z-index:300;display:flex;justify-content:center;background:var(--l2-bg);color:var(--l2-text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overscroll-behavior:contain;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);-webkit-tap-highlight-color:transparent}
html.gh-compact .lb2{z-index:19;padding-bottom:calc(64px + max(0px, env(safe-area-inset-bottom,0px) - 16px))}
.lb2 *{box-sizing:border-box}
:where(.lb2) button{font:inherit;color:inherit;touch-action:manipulation;cursor:pointer}
.lb2 .num{font-variant-numeric:tabular-nums}
.lb2-page{position:relative;width:min(560px,100%);height:100%;display:flex;flex-direction:column;overflow:hidden}
.lb2-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.lb2-scroll::-webkit-scrollbar{display:none}
.lb2-head{flex-shrink:0;padding:12px 16px 10px;display:flex;flex-direction:column;gap:12px}
.lb2-titlerow{display:flex;align-items:center;justify-content:space-between;min-height:44px}
.lb2 h1{margin:0;font-size:28px;font-weight:700;letter-spacing:-.02em;line-height:1.15}
.lb2-x{margin-right:-10px}
html.gh-compact .lb2-x{display:none}
.lb2-seg{display:grid;gap:3px;padding:3px;border-radius:12px;background:var(--l2-seg)}
.lb2-seg>button{min-height:42px;border:0;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px;font-size:15px;font-weight:500;color:var(--l2-muted);background:transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-seg.fit{display:flex}
.lb2-seg.fit>button{flex:1 1 auto;padding:0 10px}
.lb2-seg>button.sm{font-size:14px;padding:0 2px}
.lb2-seg>button.on{background:var(--l2-segOn);color:var(--l2-text);font-weight:700;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.lb2-search{height:48px;display:flex;align-items:center;gap:10px;padding:0 14px;border-radius:12px;background:var(--l2-surf);border:1px solid var(--l2-line);color:var(--l2-muted)}
.lb2-search input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;color:var(--l2-text);font:inherit;font-size:16px;-webkit-user-select:text;user-select:text}
.lb2-search input::placeholder{color:var(--l2-muted)}
.lb2-chips{display:flex;flex-wrap:wrap;gap:8px}
.lb2-chip{min-height:44px;padding:0 16px;border-radius:22px;border:0;display:flex;align-items:center;gap:6px;font-size:15px;font-weight:600;background:var(--l2-chip);color:var(--l2-text)}
.lb2-chip.on{background:var(--l2-accent);color:var(--l2-accentText)}
.lb2-body{padding:0 12px 12px;display:flex;flex-direction:column;gap:16px}
.lb2-pad{padding:4px 16px 16px}
.lb2-card{border-radius:14px;overflow:hidden;background:var(--l2-surf);border:1px solid var(--l2-line)}
.lb2-row{width:100%;display:flex;align-items:center;gap:12px;min-height:62px;padding:8px 14px;border:0;border-top:1px solid var(--l2-line);background:transparent;text-align:left}
.lb2-row.sm{min-height:58px}
.lb2-card>.lb2-row:first-child,.lb2-card>.lb2-lr:first-child{border-top:0}
.lb2-ic{width:44px;height:44px;flex-shrink:0;border-radius:10px;overflow:hidden;background:var(--l2-chip);display:flex;align-items:center;justify-content:center}
.lb2-ic.sm{width:40px;height:40px}
.lb2-ic svg{width:100%;height:100%;display:block}
.lb2-grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lb2-t1{font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-t2{font-size:14px;color:var(--l2-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0}
.lb2-crown{display:flex;align-items:center;gap:4px;font-size:16px;font-weight:700}
.lb2-crown.mute{color:var(--l2-muted)}
.lb2-best{font-size:13px;color:var(--l2-muted)}
.lb2-old{align-self:center;min-height:44px;padding:0 20px;border:0;background:transparent;color:var(--l2-muted);font-size:14px;font-weight:600;text-decoration:underline}
.lb2-bar{min-height:60px;flex-shrink:0;display:flex;align-items:center;gap:4px;padding:4px 4px 0}
.lb2-bar h1{font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-icon{width:48px;height:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--l2-text);border-radius:12px}
.lb2-heart{color:var(--l2-accent)}
.lb2-face{width:40px;height:40px;flex-shrink:0;border-radius:20px;background:var(--l2-chip);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700}
.lb2-pl{padding-left:8px}
.lb2-cols{flex-shrink:0;display:grid;gap:8px;padding:6px 16px;font-size:13px;font-weight:600;color:var(--l2-muted);align-items:center}
.lb2 .c{text-align:center;display:flex;justify-content:center}.lb2 .r{text-align:right;justify-content:flex-end}
.lb2-lr{width:100%;display:grid;gap:8px;align-items:center;min-height:48px;padding:0 4px;border:0;border-top:1px solid var(--l2-line);background:transparent;text-align:left}
.lb2-lr.me{background:var(--l2-you);color:var(--l2-youText)}
.lb2-lr.me .lb2-nm{font-weight:700}
.lb2-med{width:30px;height:30px;border-radius:15px;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#14161A;flex-shrink:0}
.lb2-med.m1{background:var(--l2-g)}.lb2-med.m2{background:var(--l2-s)}.lb2-med.m3{background:var(--l2-b)}
.lb2-med.sm{width:26px;height:26px;font-size:13px}
.lb2-med.big{width:56px;height:56px;border-radius:28px;font-size:24px}
.lb2-row .lb2-med{margin:0}
.lb2-plain{font-size:15px;font-weight:600;color:var(--l2-muted);text-align:center;display:block}
.lb2-nm{display:flex;align-items:center;gap:6px;min-width:0;font-size:16px;font-weight:500}
.lb2-nmt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.lb2-mv{flex-shrink:0;font-size:12px;font-weight:700}
.lb2-mv.up{color:var(--l2-accent)}.lb2-mv.dn{color:var(--l2-down)}
.lb2-val{font-size:16px;font-weight:700;padding-right:8px;display:flex;align-items:center;gap:4px;white-space:nowrap}
.lb2-val .lb-ctm{flex-shrink:0}
.lb2-val .lb-mspct{font-size:14px}
.lb2-shape{display:inline-flex;width:14px;height:14px;flex-shrink:0}
.lb2-shape svg{width:100%;height:100%}
.lb2-gm{font-size:14px;color:var(--l2-muted)}
.lb2-lr.me .lb2-gm{color:inherit}
.lb2-strong{font-weight:700;font-size:16px}
.lb2-hofrank{font-weight:700;color:var(--l2-muted)}.lb2-hofrank.top{color:var(--l2-text)}
.lb2-lr.me .lb2-hofrank{color:inherit}
.lb2-acc{font-size:14px;font-weight:700;color:var(--l2-accent);white-space:nowrap}
.lb2-ctrl{flex-shrink:0;display:flex;gap:8px;padding:10px 16px;align-items:center}
.lb2-gear{width:48px;height:48px;flex-shrink:0;border-radius:12px;border:0;display:flex;align-items:center;justify-content:center;background:var(--l2-seg);color:var(--l2-text)}
.lb2-pin{flex-shrink:0;display:grid;gap:8px;align-items:center;min-height:60px;padding:6px 16px;background:var(--l2-you);color:var(--l2-youText);border-top:1px solid var(--l2-line)}
.lb2-pin .lb2-val{padding-right:0}
.lb2-pinrank{font-weight:700}
.lb2-pinplay{display:flex;justify-content:flex-end}
.lb2-gap{font-size:13px;font-weight:500;line-height:1.25}
.lb2-word{font-size:13px;font-weight:600;white-space:normal;text-align:right;line-height:1.2}
.lb2-sheet{position:absolute;inset:0;z-index:5;background:var(--l2-scrim);display:flex;flex-direction:column;justify-content:flex-end}
.lb2-sh{border-radius:20px 20px 0 0;padding:10px 16px 24px;display:flex;flex-direction:column;gap:16px;background:var(--l2-surf);max-height:85%;overflow-y:auto;overscroll-behavior:contain}
.lb2-grab{width:40px;height:5px;border-radius:3px;align-self:center;background:var(--l2-line)}
.lb2-lbl{font-size:14px;font-weight:600;color:var(--l2-muted);margin-bottom:8px}
.lb2-done{min-height:52px;border-radius:14px;border:0;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;background:var(--l2-accent);color:var(--l2-accentText)}
.lb2-emptyst{min-height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px;text-align:center}
.lb2-emptyst b{font-size:18px}
.lb2-play{min-height:48px;padding:0 28px;border-radius:24px;border:0;display:flex;align-items:center;font-size:16px;font-weight:700;background:var(--l2-accent);color:var(--l2-accentText)}
.lb2-play.sm{min-height:44px;padding:0 20px}
.lb2-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.lb2-tile{min-height:84px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px 4px;background:var(--l2-surf);border:1px solid var(--l2-line);text-align:center}
.lb2-tile b{font-size:26px}
.lb2-tile span{font-size:14px;color:var(--l2-muted);line-height:1.15}
.lb2-h2{margin:0 0 8px;padding:0 4px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--l2-muted)}
.lb2-gh{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.lb2-gh .lb2-h2{flex:1;margin:0}
.lb2-gseg{width:170px}
.lb2-more{min-height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;background:var(--l2-surf);border:1px solid var(--l2-line);color:var(--l2-accent)}
.lb2-empty-t{margin:0;padding:24px 16px;text-align:center;color:var(--l2-muted);font-size:16px}
`;
  document.head.appendChild(el);
}

export default { openLeaderboard2, closeLeaderboard2 };
