// leaderboard2-ui.js - Leaderboard v2, ADMIN PREVIEW (2026-10-31, docs/LEADERBOARD-V2-PLAN.md, the look
// is docs/mockups/leaderboard-v2.html). Opened ONLY from js/leaderboard-ui.js openLeaderboard() on an admin
// device (isAdminDevice, the one gate); every other device keeps the old board. "Old" at the bottom of
// Boards opens the old one.
//
// ROUND 1 (2026-10-31, docs/LEADERBOARD-V2-PLAN-R1.md; Matt: "an interface redesign, not a stats redesign"):
// v2 draws ONLY the old board's numbers. Every board = the old board's tabs, rows, order, ranks, ties, numbers,
// sub lines, gap line and records block (leaderboard-ui.js lb2Tabs / lb2Board); every medal tally (Hall of
// Fame, the Boards list, Me, Player) = the old one standing per game (lb2Standing = gameStanding), so the gold
// count equals the old board's. tools/test-lb2-parity.mjs proves it against a golden file made from main.
// READ ONLY. People come from the server-built board (stats-net.js watchBoard, falling back to players/
// exactly as the old board does), the same hidden-row filter. Nothing here writes anything.
// Rows carry an index into an in-memory list, never a player code (tools/test-no-codes.mjs).
import { aggregatePlayers, buildIdentity } from './players-agg.js';
import { isHiddenName, HIDDEN_DEVICE_PREFIX } from './hidden-players.js';
import { corrections } from './admin-config.js';
import { watchPlayers, watchBoard, readPlayersForMe } from './stats-net.js';
import { watchBeeBoard } from './bee-board.js';
import { backStack } from './back-stack.js';
import { loadProfile } from './profile-store.js';
import { statsId, activityReport } from './game-stats.js';
import { GAME_ART } from './game-art.js';
import { loadFavorites, toggleFavorite } from './favorites.js';
import { hubIdOf, isGameOnLauncher, v2ScreenFor, ensureStatsCss } from './game-stats-ui.js';
import { diffShapeSVG } from './difficulty-tiers.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';
import LB2 from './leaderboard2-strings.js';
import * as B from './leaderboard2-boards.js';
import { GAME_META, lb2CtImg, lb2CtCounts, lb2Rush, lb2Standing, lb2Tabs, lb2Board, lb2Records, lb2PlayerGames, lb2Players, lb2TierWord, lb2Medal, ensureLeaderboardCss, openLeaderboard } from './leaderboard-ui.js';
import { trueBottom } from './tabbar-fix.js';
import { onViewportResize } from './viewport.js';

const t = makeT(STRINGS);
const t2 = makeT(LB2);
// The Hall of Fame tab's ONE label key: renaming it (Matt is choosing a name) is this line and the strings.
const HOF_LABEL = 'lb2_tab_hof';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (id) => { const m = GAME_META.find((x) => x.id === id); return m ? t(m.labelKey) : id; };
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nameOf = (r) => (String((r && r.name) || '').trim() || t('anon_player'));
function fmt(x, digits) {
  const loc = getLang() === 'es' ? 'es-ES' : 'en-US';
  try { return Number(x).toLocaleString(loc, digits ? { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: 'always' } : { useGrouping: 'always' }); } catch { return String(x); }
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// --- Round 4 (2026-11-01): display only. Every number below is the old board's, re-PRINTED, never re-counted. --
const LOC = () => (getLang() === 'es' ? 'es-ES' : 'en-US');
// Spanish leaves 4-digit numbers ungrouped (4000 beside 28.740 in one column); group every one alike.
const GROUP = { useGrouping: 'always' };
/** Thousands separators (470,700): a bare run of 4+ digits, never part of a time, a decimal or an entity. */
function sepText(s) {
  return String(s == null ? '' : s).replace(/(?<![\d.,:#&])\d{4,}(?!\d|[.,:]\d)/g, (m) => { try { return Number(m).toLocaleString(LOC(), GROUP); } catch { return m; } });
}
/** Golf's to-par in words: "-2" -> "2 under", "+3" -> "3 over" ("E" stays). */
function golfWords(s) {
  const m = /^([+\-\u2212])(\d+)$/.exec(String(s).trim());
  return m ? t2(m[1] === '+' ? 'lb2_over' : 'lb2_under', { n: m[2] }) : s;
}
/** A board number as v2 prints it (plain text): golf in words, Contexto's count before its medal, separators. */
function dispText(game, s) {
  let x = String(s == null ? '' : s);
  if (game === 'golf') x = golfWords(x);
  if (game === 'contexto') x = x.replace(/^(\S+) (\d+)$/u, '$2 $1');
  // Session 4: ONE dash style, the en dash "–" (no number, and ranges).
  x = x.replace(/\u2014/g, '\u2013');
  return sepText(x);
}
/** The same over HTML: only text between tags changes. */
function dispHTML(game, h) { return String(h == null ? '' : h).split(/(<[^>]*>)/).map((p) => (p.startsWith('<') ? p : dispText(game, p))).join(''); }
const sepHTML = (h) => dispHTML('', h).replace(/&mdash;/g, '\u2013');
const CHEV = '<span class="lb2-chev" aria-hidden="true"><svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg></span>';
/** The viewer's own name, in the accent colour wherever it is printed. */
const mineCls = (key) => (key && key === _meKey ? ' lb2-mine' : '');

// Preferences (THE LAW rule 2's carve-out: one-tap recreatable). `gamehub.lb2.v1` = { v, games, sort, updatedAt }:
// round 0 stored `games` (last board per game; no longer read, kept as is); round 3 (2026-10-31, Matt: "a way to
// sort the games in different ways") adds the Games tab's `sort`, written ADDITIVELY beside it. `gamehub.lb2.ranks.v1`
// (round 0's arrows) is no longer read or written; it stays on each phone untouched (rule 5).
const PREF_KEY = 'gamehub.lb2.v1';
const SORTS = ['az', 'rank', 'played', 'recent'];
function readPref() { try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; } }
function loadSort() { const v = readPref().sort; return SORTS.includes(v) ? v : 'az'; }
function saveSort(v) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPref(), v: 1, sort: v, updatedAt: Date.now() })); } catch { /* a preference: best effort */ }
}
// The viewer's last play per game, for "Recent": this phone's own activity log, merged (on first use) with the
// person's other devices' mirrored `activity` via readPlayersForMe (own devices only; never all of players/).
let _recent = null;
let _recentAsked = false;
let _fromBoard = false;
function mergeActivity(into, act) {
  if (!act || typeof act !== 'object') return;
  for (const id of Object.keys(act)) { const l = +((act[id] || {}).last) || 0; if (l > (into[id] || 0)) into[id] = l; }
}
function recentMap() {
  if (!_recent) { _recent = {}; try { mergeActivity(_recent, activityReport()); } catch { /* none */ } }
  if (!_recentAsked && _fromBoard) {
    _recentAsked = true;
    readPlayersForMe().then((recs) => {
      const code = String((loadProfile() || {}).playerId || '').toUpperCase();
      for (const r of Object.values(recs || {})) if (r && r.activity && (!code || ((r.profile || {}).playerId || '').toUpperCase() === code || r.activity)) mergeActivity(_recent, r.activity);
      if (_host && _tab === 'boards' && !_stack.length) render({ keepScroll: true });
    }).catch(() => {});
  }
  return _recent;
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
let _srch = false;        // the Games list's search field is open
let _stack = [];          // [{ kind: 'board', game, sel } | { kind: 'player', key, all } | { kind: 'pgame', key, game }]
let _entryGame = null;
let _onPlay = null;
let _canPlay = () => false;
let _unsub = null;
let _beeOff = null;
let _bs = null;             // the phone's back gesture: one history entry per level (js/back-stack.js)
let _boardMemo = new Map();
let _pidx = [];           // row index -> person key (never in the DOM)
let _offVp = null;
let _ty = 0;
/** iOS 26 can leave a fixed element's inset:0 at about half the screen (WebKit bug 297779, js/tabbar-fix.js):
 *  the launcher showed under the board. Size the page to the TRUE screen bottom, like the tab bar's repair. */
function fitHeight() { if (_host) _host.style.height = Math.max(trueBottom(), window.innerHeight || 0) + 'px'; }
/** Only a scroll list (or the sheet) moves under a finger; nothing chains to the page behind. */
function onTouchStart(e) { _ty = e.touches && e.touches[0] ? e.touches[0].clientY : 0; }
function onTouchMove(e) {
  const t = e.touches && e.touches[0];
  if (!t || e.target.closest('input')) return;
  const sc = e.target.closest('.lb2-scroll, .lb2-sh');
  if (!sc) { e.preventDefault(); return; }
  const dy = t.clientY - _ty;
  const atTop = sc.scrollTop <= 0, atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
  if ((dy > 0 && atTop) || (dy < 0 && atEnd)) e.preventDefault();
}

// --- the model: the old board's one standing per game, the Hall of Fame, the viewer's places --------------
function boardGames() {
  // The old By Game's rule exactly (isGameOnLauncher), so both boards list the same games.
  return GAME_META.map((m) => m.id).filter((id) => isGameOnLauncher(id));
}
function buildModel() {
  const games = boardGames();
  const standings = [];
  const byGame = {};
  for (const id of games) {
    let rows = [];
    try { rows = lb2Standing(_people, id).map((r) => ({ ...r, name: r.g.name || '', emoji: r.g.emoji || '' })); } catch (err) { console.error('[leaderboard2] standing failed', id, err); }
    const st = { game: id, id: 'st~' + id, rows };
    byGame[id] = st;
    standings.push(st);
  }
  const hof = B.hallOfFame(standings);
  _boardMemo = new Map();
  _model = { games, byGame, standings, hof, me: B.personPlaces(standings, _meKey) };
}
const moveOf = () => 0;

// --- markup pieces ---------------------------------------------------------------------------------------
const SVG = {
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  heart: (s, on) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.2 3.4 4.5 7 4.5c2.1 0 3.6 1.1 5 2.9 1.4-1.8 2.9-2.9 5-2.9 3.6 0 6 3.7 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>`,
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  x: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  help: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.9"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/></svg>',
  sort: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/></svg>',
  chat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
};
// Contexto's medal images (Matt, 2026-10-31), the place on the face; sized per use.
const MEDAL_H = { '': 38, sm: 32, xs: 24, big: 64 };
const medal = (n, cls = '') => `<span class="lb2-medal ${cls}" role="img" aria-label="${n}">${lb2Medal(n, MEDAL_H[cls] || 38)}</span>`;
/** ONE rank format: a medal for 1st to 3rd, "#5" below. A tie shows the SAME rank on each tied row, no "="
 *  (Matt, 2026-11-02: "I do not like '=4' for ties. It looks bad."). `tie` is kept for callers. */
const med = (n, tie, cls = '') => (n <= 3
  ? `<span class="lb2-rk">${medal(n, cls)}</span>`
  : `<span class="lb2-plain num">#${n}</span>`);
const pod = (r) => (r.rank <= 3 && earned(r) ? ` pod${r.rank}` : '');
/** Session 4 (display only): a rank WITHOUT a medal, "#1" / "=7". Used where a medal would not mean the game's
 *  standing (Past weeks, Records held, Wins sorted by Played) and on rows with nothing earned (a 0). */
const plainRank = (n, tie) => `<span class="lb2-plain num">#${n}</span>`;
/** A row whose ranked number is 0 earned no medal; its rank is unchanged. */
function earned(r) {
  if (!r || r.noPodium) return false;
  const x = String(r.text != null ? r.text : r.show != null ? r.show : '').replace(/[\s,.]/g, '');
  return x !== '0';
}
const rankCell = (r, cls = '') => (earned(r) ? med(r.rank, r.tie, cls) : plainRank(r.rank, r.tie));
const art = (id, cls = '') => `<span class="lb2-ic ${cls}">${GAME_ART[hubIdOf(id)] || ''}</span>`;
// Rank arrows are OFF (round 1): yesterday's ranks were taken from the old v2 boards, so they would be noise.
const mv = () => '';
const shape = (tier) => (tier ? `<span class="lb2-shape${tier === 4 ? ' x2' : ''}" role="img" aria-label="${esc(lb2TierWord(tier))}">${diffShapeSVG(tier)}</span>` : '');
// Round 4 (2026-11-01, Matt with an outside reviewer): the round-3 difficulty pill under the name is gone. A
// difficulty is the shape before a NUMBER (the number is what it qualifies) plus, on an All tab, a divider over
// each difficulty group with the shape and its word. The line under a name is lifetime only ("24 played").
function pIdx(key) { let i = _pidx.indexOf(key); if (i < 0) { i = _pidx.length; _pidx.push(key); } return i; }
function seg(items, on, act, fit = false, cls = '') {
  return `<div class="lb2-seg${fit ? ' fit' : ''}${cls ? ' ' + cls : ''}" role="group" style="grid-template-columns:repeat(${items.length},minmax(0,1fr))">${items.map((x) => `<button type="button" class="${x.v === on ? 'on' : ''}${items.length > 4 ? ' sm' : ''}" data-act="${act}" data-v="${esc(x.v)}" aria-pressed="${x.v === on}">${x.html || esc(x.label)}</button>`).join('')}</div>`;
}
function headHTML(extra = '', search = false) {
  const sb = search ? `<button type="button" class="lb2-icon" data-act="search" aria-pressed="${_srch}" aria-label="${esc(t2('lb2_search_aria'))}">${SVG.search}</button>` : '';
  return `<div class="lb2-head"><div class="lb2-titlerow"><h1>${esc(t2('lb2_title'))}</h1><span class="lb2-tbtns">${sb}<button type="button" class="lb2-icon lb2-help" data-act="help" aria-label="${esc(t2('lb2_help_aria'))}">${SVG.help}</button><button type="button" class="lb2-icon lb2-x" data-act="close" aria-label="${esc(t2('lb2_close'))}">${SVG.x}</button></span></div>
    ${seg([{ v: 'boards', label: t2('lb2_tab_boards') }, { v: 'hof', label: t2(HOF_LABEL) }, { v: 'me', label: t2('lb2_tab_me') }], _tab, 'tab', true)}${extra}</div>`;
}
const playable = (game) => !!(_onPlay && _canPlay(hubIdOf(game)));
/** A place in a game's standing: a medal for 1st to 3rd, "#N" below, a dash when not on it. */
function placeHTML(p) {
  // No place in the standing: nothing, as the old You tab showed no chip (a dash read as a rank).
  if (!p || !p.rank) return '';
  if (p.rank <= 3 && !p.noMedal) return med(p.rank, p.tie, 'sm');
  return `<span class="lb2-best num">#${p.rank}</span>`;
}

// --- Boards (tab 1) --------------------------------------------------------------------------------------
function meGroup() { return _people.find((g) => g.key === _meKey) || null; }
function playedGame(id) {
  if (defPlace(id, _meKey)) return true;
  const g = meGroup();
  return !!(g && g.games && g.games[id] && ((g.games[id].total || {}).played | 0) > 0);
}
function gameRows() {
  const favs = new Set(loadFavorites());
  return _model.games.map((id) => ({ id, title: title(id), fav: favs.has(hubIdOf(id)), played: playedGame(id), place: defPlace(id, _meKey) }));
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
  const rk = (r) => (r.place ? r.place.rank : 1e9);
  const sort = loadSort();
  const g = meGroup();
  const plays = (id) => ((((g && g.games) || {})[id] || {}).total || {}).played | 0;
  if (sort === 'rank') list.sort((a, b) => rk(a) - rk(b) || az(a, b));
  else if (sort === 'played') list.sort((a, b) => plays(b.id) - plays(a.id) || az(a, b));
  else if (sort === 'recent') { const rc = recentMap(); list.sort((a, b) => (rc[b.id] || 0) - (rc[a.id] || 0) || az(a, b)); }
  else list.sort(az);
  const items = list.map((r) => {
    const lead = _model.byGame[r.id].rows.filter((x) => x.rank === 1);
    const sub = lead.map((x) => `<span class="lb2-ld${mineCls(x.key)}">${esc(nameOf(x.g))}</span>`).join(', ');
    return `<button type="button" class="lb2-row" data-act="game" data-game="${esc(r.id)}">
      ${art(r.id)}
      <span class="lb2-grow"><span class="lb2-t1">${esc(r.title)}</span>${sub ? `<span class="lb2-t2">${medal(1, 'xs')}${sub}</span>` : ''}</span>
      <span class="lb2-right">${placeHTML(r.place)}</span>${CHEV}
    </button>`;
  }).join('');
  // The right column is the viewer's own place in each game: say whose, by profile name (never "You").
  const mg = meGroup() || { name: (loadProfile() || {}).name, emoji: (loadProfile() || {}).emoji };
  const meName = nameOf(mg);
  const meFace = String(mg.emoji || (loadProfile() || {}).emoji || '').trim();
  void meName; void meFace;
  return (items ? `<div class="lb2-card">${items}</div>` : `<p class="lb2-empty-t">${esc(t2('lb2_none'))}</p>`)
    + `<button type="button" class="lb2-old" data-act="old">${esc(t2('lb2_old'))}</button>`;
}
function boardsHTML() {
  const rows = gameRows();
  const chip = chipNow(rows);
  const nFav = rows.filter((r) => r.fav).length, nPlayed = rows.filter((r) => r.played).length;
  // Filters are the ONE control pattern (round 4): the segmented bar, like every board's tabs.
  const chips = seg([
    { v: 'fav', label: t2('lb2_favs_aria'), html: `<span class="lb2-favseg" aria-label="${esc(t2('lb2_favs_aria'))}">${SVG.heart(16, true)}<span class="num">${nFav}</span></span>` },
    { v: 'played', label: t2('lb2_played', { n: nPlayed }) },
    { v: 'all', label: t2('lb2_all', { n: rows.length }) },
  ], chip, 'chip', true);
  const search = _srch || _q ? `<label class="lb2-search">${SVG.search}<input type="search" data-role="q" value="${esc(_q)}" placeholder="${esc(t2('lb2_search', { n: rows.length }))}" aria-label="${esc(t2('lb2_search_aria'))}" autocomplete="off" enterkeyhint="search"></label>` : '';
  // Session 3 (Matt, 2026-11-01): the list starts higher. Search sits behind an icon; filters and sort share a line.
  const sortBtn = `<label class="lb2-sortbtn" aria-label="${esc(t2('lb2_sort_aria'))}: ${esc(t2('lb2_sort_' + loadSort()))}">${SVG.sort}<select data-role="gsort" aria-label="${esc(t2('lb2_sort_aria'))}">${SORTS.map((v) => `<option value="${v}"${v === loadSort() ? ' selected' : ''}>${esc(t2('lb2_sort_' + v))}</option>`).join('')}</select></label>`;
  return headHTML(search + `<div class="lb2-frow">${chips}${sortBtn}</div>`, true)
    + `<div class="lb2-scroll" data-role="scroll"><div class="lb2-body" data-role="glist">${boardsListHTML()}</div></div>`;
}

// --- one game's board: the OLD board's tabs and rows, in the new look -------------------------------------
const stKeyOf = (st) => [st.tier == null ? '' : st.tier, st.view || '', st.machine || 'all', st.lang || 'all', st.by || 'points'].join('~');
function tabsOf(game) {
  let tb = _boardMemo.get('tabs~' + game);
  if (!tb) { tb = lb2Tabs(_people, game); _boardMemo.set('tabs~' + game, tb); }
  return tb;
}
/** A valid tab state for `game` from `want` (saved or tapped), else the old board's default tab. Each row of
 *  tabs is one dimension (Skeeball: machine, then number; Spelling Bee: number, then language). */
function selFor(game, want) {
  const tb = tabsOf(game);
  const st = { ...tb.def };
  const w = want && typeof want === 'object' ? want : {};
  for (const row of tb.rows) {
    const hit = row.find((x) => Object.keys(x.st).every((k) => (w[k] ?? null) === (x.st[k] ?? null)));
    const pick = hit || row.find((x) => Object.keys(x.st).every((k) => (tb.def[k] ?? null) === (x.st[k] ?? null))) || row[0];
    if (pick) Object.assign(st, pick.st);
  }
  if (tb.rows.length === 1) { const only = tb.rows[0].find((x) => stKeyOf(x.st) === stKeyOf({ ...tb.def, ...w })); return only ? { ...only.st } : { ...tb.def }; }
  return st;
}
function boardOf(game, st) {
  const id = 'b~' + game + '~' + stKeyOf(st);
  let b = _boardMemo.get(id);
  if (!b) { b = lb2Board(_people, game, st); b.id = id; _boardMemo.set(id, b); }
  return b;
}
/** A game's DEFAULT board (the one a tap opens) and a person's place on it: what every list shows, so a
 *  list and the board one tap away always agree. Medal tallies stay the old standing (lb2Standing). */
// Round 2 tried the DEFAULT board's place here; reverted (critique R2): the old You tab and By Game read the
// standing, and a mix contradicted Records held and the Hall of Fame. Every list place = the standing.
function defPlace(game, key) {
  const st = _model.byGame[game];
  const r = st && key ? st.rows.find((x) => x.key === key) : null;
  return r ? { rank: r.rank, tie: r.tie, noMedal: r.noMedal } : null;
}
function tabOn(tab, st) { return Object.keys(tab.st).every((k) => (st[k] ?? null) === (tab.st[k] ?? null)); }
/** The words on a tab (round 4: display only; the state behind each tab is the old board's). */
function tabText(game, tab) {
  if (tab.st.view === 'mp') return t2('lb2_online');
  if (game === 'skeeball' && 'view' in tab.st && !('machine' in tab.st)) return t2(tab.st.view === 'high' ? 'lb2_sk_best' : 'lb2_sk_total');
  // "Medium" spelled out wherever the old board shortened it to "Med" (round 4: it fits at 360px, EN and ES).
  if (tab.tier === 2) return lb2TierWord(2);
  return tab.label;
}
function tabLabel(game, tab) { const w = esc(tabText(game, tab)); return tab.tier ? `${shape(tab.tier)}<span>${w}</span>` : w; }
/** One row of the old board's tabs, ALWAYS as segmented bars (round 4: one control pattern): up to five a bar,
 *  difficulties on one bar and the other tabs (Walls, Ultimate, Solo, Online) on the next. Nothing scrolls away. */
function tabRowHTML(game, row0, st, ri) {
  let row = row0;
  const on = row.find((x) => tabOn(x, st));
  // Four or more tabs with difficulty shapes: the shape sits OVER its word, so "Medium" and "Experto" fit at 360px.
  // Session 4: Contexto's All tab first, like every other board (display order only; data-v keeps each tab's index).
  if (game === 'contexto') row = [...row].sort((a, b) => (a.st.view === 'daily') - (b.st.view === 'daily'));
  const segOf = (xs) => seg(xs.map((x) => ({ v: ri + ':' + row0.indexOf(x), html: tabLabel(game, x), label: tabText(game, x) })), on && xs.includes(on) ? ri + ':' + row0.indexOf(on) : '', 'stab', false, xs.length >= 4 && xs.some((x) => x.tier) ? 'stk' : '');
  // Machine names (Skeeball: "HOT SHOT", "THE CLASSIC"...) do not fit a bar: one native picker, one line.
  if (row.every((x) => 'machine' in x.st) && row.some((x) => String(x.label).length > 8)) {
    return `<label class="lb2-pick"><select data-role="stab" aria-label="${esc(on ? on.label : '')}">${row.map((x, i) => `<option value="${ri}:${i}"${x === on ? ' selected' : ''}>${esc(x.st.machine === 'all' ? t2('lb2_all_machines') : x.label)}</option>`).join('')}</select></label>`;
  }
  if (row.length <= 5) return segOf(row);
  const tiers = row.filter((x) => !x.st.view), rest = row.filter((x) => x.st.view);
  const groups = tiers.length && rest.length && tiers.length <= 5 ? [tiers, rest] : [row];
  const bars = [];
  for (const g of groups) for (let i = 0; i < g.length; i += 5) bars.push(segOf(g.slice(i, i + 5)));
  return `<div class="lb2-segs">${bars.join('')}</div>`;
}
/** A tab that shows a game's whole history (every difficulty, every machine, every mode): where Bests belong. */
const SUB_VIEWS = new Set(['mp', 'ultimate', 'classic', 'off', 'on', 'solo', 'daily']);
function isAllTab(st) { return st.tier == null && (st.machine || 'all') === 'all' && !SUB_VIEWS.has(st.view || '') && !String(st.view || '').startsWith('bz:'); }
/** The board's bottom block: "Bests" (the old Standing records: lifetime, every difficulty), on the All tab only.
 *  Contexto's block is its medal key, a legend, so it stays on both tabs. */
function bestsHTML(game, st, html) {
  if (!html) return '';
  if (game === 'contexto') return html;
  if (!isAllTab(st)) return '';
  let out = html.replace(/<h3 class="lb-h3">[^<]*<\/h3>/, `<h3 class="lb-h3">${esc(t2('lb2_bests'))}<span class="lb2-pill lb2-why">${esc(t('lb_diff_all'))}</span></h3>`);
  out = out.split(`<span>${esc(t('lb_tex_sk_hundreds'))}</span>`).join(`<span>${esc(t2('lb2_sk_hundreds'))}</span>`);
  const me = meGroup();
  if (me && me.name) {
    // The viewer's name in the accent colour, like every other place it is printed.
    const nm = esc(String(me.name).trim());
    out = out.replace(/<em>([\s\S]*?)<\/em>/g, (m, inner) => (inner.endsWith(nm) ? `<em class="lb2-mine">${inner}</em>` : m));
  }
  return sepHTML(out);
}
/** The column's word over the numbers (display only). */
function unitLabel(game, st, unit) {
  if (game === 'spellingbee' && unit === t('lb_unit_wins')) return t2('lb2_genius');
  if (game === 'skeeball') return t2(st.view === 'high' ? 'lb2_sk_best' : 'lb2_sk_total');
  return unit;
}
/** The pinned row's line: 1st, or the record beside the viewer's own number (round 4: never "N more to take
 *  the record", which only reached a tie). */
function pinLine(game, b, me, tiered) {
  if (!me) return esc(t2('lb2_not_ranked'));
  if (me.rank === 1) return esc(t2(me.tie ? 'lb2_first_tie' : 'lb2_first'));
  const rec = b.rows[0];
  if (!rec || game === 'contexto' || !rec.text || rec.text === '—') return '';
  return `${esc(t2('lb2_record'))} ${tiered ? shape(rec.tier) : ''}<b>${esc(dispText(game, rec.text))}</b>`;
}
/** Contexto (session 4): the ranked count in the compact "9 🥇" form, and the four hint medals in FIXED slots
 *  (gold, silver, bronze, 3+ hints), "·" for none, so a medal's place says what it is, not only its colour. */
const CT_ORDER = ['gold', 'silver', 'bronze', 'iron'];
function ctValHTML(g, daily) {
  const c = lb2CtCounts(g, daily);
  const k = CT_ORDER.find((x) => c[x] > 0);
  return k ? `<span class="lb2-ctv"><span>${fmt(c[k])}</span>${lb2CtImg(k, 22)}</span>` : '<span>–</span>';
}
function ctSlotsHTML(g, daily) {
  const c = lb2CtCounts(g, daily);
  return `<span class="lb2-ctslots">${CT_ORDER.map((k) => `<span class="lb2-cts${c[k] ? '' : ' z'}">${lb2CtImg(k, 16)}<b class="num">${c[k] ? fmt(c[k]) : '·'}</b></span>`).join('')}</span>`;
}
const nohintPill = () => `<span class="lb2-pill lb2-nh">${esc(t2('lb2_nohint'))}</span>`;
/** Under the name: lifetime only ("24 played"); the difficulty went to the number and the group divider. */
function rowSub(r) {
  const parts = [r.sub, r.nohint ? '' : r.sub2].filter(Boolean).map((x) => esc(sepText(x)));
  const inner = sepHTML(r.subHtml || '') + parts.join(' · ');
  return inner ? `<span class="lb2-sub">${inner}</span>` : '';
}
/** A thin divider over each difficulty group on an All tab: the shape and its word, nothing else. */
function dividerHTML(r) {
  if (!r.tier) return '<div class="lb2-div lb2-div0" aria-hidden="true"></div>';
  return `<div class="lb2-div">${shape(r.tier)}<span>${esc(lb2TierWord(r.tier))}</span></div>`;
}
const COLS = '44px minmax(0,1fr) auto 10px';
const DOWN = '<span class="lb2-chev lb2-down" aria-hidden="true"><svg width="14" height="8" viewBox="0 0 14 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5 7 6.5l5.5-5"/></svg></span>';
/** Session 4 (display only): a board's tail of tied rows at 0 folds into ONE row, "=7 · 9 players", that opens on
 *  tap. Every row is still drawn (inside the fold), with its rank unchanged. `holder.fold` = opened. */
function foldTail(rows, rowHTML, holder, cols, game) {
  let k = rows.length;
  while (k > 0 && !earned(rows[k - 1]) && rows[k - 1].rank === rows[rows.length - 1].rank && String(rows[k - 1].text ?? rows[k - 1].show ?? '').replace(/[\s,.]/g, '') === '0') k--;
  const n = rows.length - k;
  if (n < 3) return rows.map(rowHTML).join('');
  const open = !!(holder && holder.fold);
  const last = rows[rows.length - 1];
  const head = `<button type="button" class="lb2-foldr" style="grid-template-columns:${cols}" data-act="fold" aria-expanded="${open}">
    ${plainRank(last.rank, n > 1)}<span class="lb2-who"><span class="lb2-nm">${esc(t2('lb2_n_players', { n: fmt(n) }))}</span></span><span class="r lb2-val num">${game === 'contexto' ? '–' : '0'}</span>${open ? '' : DOWN}</button>`;
  return rows.slice(0, k).map(rowHTML).join('') + (open ? '' : head) + `<div class="lb2-fold"${open ? '' : ' hidden'}>${rows.slice(k).map(rowHTML).join('')}</div>`;
}
/** The shape before a row's number on a grouped board (none beside a dash: there is no number to qualify). */
const numShape = (tiered, r) => (tiered && r.text && r.text !== '—' ? shape(r.tier) : '');
function rushHTML(top, modeRow) {
  const mode = top.rmode === 'hard' ? 'hard' : 'easy', view = ['won', 'past'].includes(top.rview) ? top.rview : 'week';
  const R = lb2Rush(_people, mode, view);
  // Session 4: two control rows, not three. Easy | Hard as the icon tabs (shape over word, like Levels), and
  // This week / Weeks won / Past weeks as one compact picker beside them.
  const tierTabs = `<div class="lb2-seg stk" role="group" style="grid-template-columns:repeat(2,minmax(0,1fr))">${[['easy', 1], ['hard', 3]].map(([v, tr]) => `<button type="button" class="${v === mode ? 'on' : ''}" data-act="worush" data-v="${v}" aria-pressed="${v === mode}">${shape(tr)}<span>${esc(lb2TierWord(tr))}</span></button>`).join('')}</div>`;
  const views = [['week', t('lb_wo_week')], ['won', t('lb_wo_won')], ['past', t('lb_wo_past')]];
  const vw = views.find((x) => x[0] === view)[1];
  const viewPick = `<label class="lb2-catpick lb2-rview"><span>${esc(vw)}</span><select data-role="woview" aria-label="${esc(vw)}">${views.map(([v, l]) => `<option value="${v}"${v === view ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const ctrl = `<div class="lb2-ctrl">${modeRow}<div class="lb2-ctrlrow">${tierTabs}${viewPick}</div></div>`;
  const cols = COLS;
  const head = `<div class="lb2-cols" style="grid-template-columns:${cols}"><span></span><span></span><span class="r">${esc(cap([R.head, R.unit].filter(Boolean).join(' · ')))}</span><span></span></div>`;
  // Past weeks: every row is a week's winner: "#1" with no medal, and only the viewer's NAME lit (no row fill).
  const list = R.rows.length ? `<div class="lb2-card" data-role="rows">${R.rows.map((r) => `<button type="button" class="lb2-lr${view === 'past' ? '' : pod(r)}${r.key === _meKey && view !== 'past' ? ' me' : ''}" style="grid-template-columns:${cols}" data-act="person" data-pi="${pIdx(r.key)}">
      ${view === 'past' ? plainRank(r.rank, r.tie) : med(r.rank, r.tie)}<span class="lb2-who"><span class="lb2-nm"><span class="lb2-nmt${mineCls(r.key)}">${esc(nameOf(r.g))}</span></span>${r.sub ? `<span class="lb2-sub">${esc(r.sub)}</span>` : ''}</span><span class="r lb2-val num">${fmt(r.val)}</span>${CHEV}</button>`).join('')}</div>`
    : `<div class="lb2-card"><p class="lb2-empty-t">${esc(R.empty)}</p></div>`;
  return `${ctrl}${R.rows.length ? head : ''}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body">${list}</div></div>`;
}
function boardScreenHTML(top) {
  const game = top.game;
  const st = top.sel = selFor(game, top.sel);
  const tb = tabsOf(game);
  const b = boardOf(game, st);
  const fav = loadFavorites().includes(hubIdOf(game));
  // Session 4: "N played" is the GAME'S total on every tab (the default tab's number, the old board's header).
  const total = boardOf(game, selFor(game, null)).plays;
  const bar = `<div class="lb2-bar"><button type="button" class="lb2-icon" data-act="back" aria-label="${esc(t2('lb2_back'))}">${SVG.back}</button>
    ${art(game, 'hd')}<span class="lb2-grow lb2-pl"><h1>${esc(title(game))}</h1><span class="lb2-t2 num">${esc(t('lb_played_count', { n: fmt(total) }))}</span></span>
    ${playable(game) && b.rows.length ? `<button type="button" class="lb2-play sm" data-act="play" data-game="${esc(game)}">${esc(t2('lb2_play'))}</button>` : ''}
    <button type="button" class="lb2-icon lb2-heart" data-act="fav" aria-pressed="${fav}" aria-label="${esc(t2(fav ? 'lb2_fav_remove' : 'lb2_fav_add'))}">${SVG.heart(24, fav)}</button></div>`;
  const cols = COLS;
  const unit = unitLabel(game, st, b.unit || '');
  const head = `<div class="lb2-cols" style="grid-template-columns:${cols}"><span></span><span></span><span class="r">${esc(cap(unit))}</span><span></span></div>`;
  // Difficulty made visible (round 4): on an All tab whose rows carry a difficulty, the board is grouped by it
  // (the old order already ranks the hardest difficulty first); ranks keep running across the groups.
  const tiered = st.tier == null && b.rows.some((r) => r.tier);
  let list;
  if (!b.rows.length) {
    const play = playable(game) ? `<button type="button" class="lb2-play" data-act="play" data-game="${esc(game)}">${esc(t2('lb2_play'))}</button>` : '';
    list = `<div class="lb2-card"><div class="lb2-emptyst"><b>${esc(b.empty || t2('lb2_nothing'))}</b>${play}</div></div>`;
  } else {
    // EVERY row, like the old board (a top 10 hid everyone below it: THE LAW rule 1).
    let lastGroup = null, inNh = false;
    const ctDaily = game === 'contexto' && st.view === 'daily';
    const rowHTML = (r) => {
      const grp = tiered ? `${r.tier || 0}${r.nohint ? 'n' : ''}` : null;
      let div = '';
      if (tiered && grp !== lastGroup) {
        // Sudoku / Murdoku (session 4): ONE "No hints" section header on top, the difficulty dividers inside it.
        if (r.nohint && !inNh) div += `<div class="lb2-div lb2-nhdiv">${nohintPill()}</div>`;
        if (!r.nohint && inNh) div += '<div class="lb2-div lb2-div0" aria-hidden="true"></div>';
        inNh = !!r.nohint;
        div += dividerHTML(r);
      }
      lastGroup = grp;
      const val = game === 'contexto' ? ctValHTML(r.g, ctDaily) : dispHTML(game, r.html);
      const sub = game === 'contexto' ? `<span class="lb2-sub">${ctSlotsHTML(r.g, ctDaily)}</span>` : rowSub(r);
      return `${div}<button type="button" class="lb2-lr${pod(r)}${r.key === _meKey ? ' me' : ''}" style="grid-template-columns:${cols}" data-act="person" data-pi="${pIdx(r.key)}" data-rank="${r.rank}" data-tie="${r.tie ? 1 : 0}">
      ${rankCell(r)}<span class="lb2-who"><span class="lb2-nm"><span class="lb2-nmt${mineCls(r.key)}">${esc(nameOf(r.g))}</span>${mv(moveOf(b.id, r))}</span>${sub}</span><span class="r lb2-val num">${numShape(tiered, r)}${val}</span>${CHEV}</button>`;
    };
    list = `<div class="lb2-card" data-role="rows">${foldTail(b.rows, rowHTML, top, cols, game)}</div>`;
  }
  // Arrow Maze's Rush (the old board) gets its own line: beside five tabs it squeezed every word off them.
  // Arrow Maze: Levels | Rush on top (2026-11-02, Matt's approved mockup); Rush is drawn here, not on the old board.
  const rush = game === 'wayout' ? `<div class="lb2-ctrlrow">${seg([{ v: 'levels', label: t2('lb2_levels') }, { v: 'rush', label: t2('lb2_rush') }], top.rush ? 'rush' : 'levels', 'womode', true)}</div>` : '';
  if (game === 'wayout' && top.rush) return bar + rushHTML(top, rush);
  const ctrl = tb.rows.length && (tb.rows.length > 1 || tb.rows[0].length > 1)
    ? `<div class="lb2-ctrl">${rush}${tb.rows.map((row, ri) => `<div class="lb2-ctrlrow">${tabRowHTML(game, row, st, ri)}</div>`).join('')}</div>`
    : (rush ? `<div class="lb2-ctrl">${rush}</div>` : '');
  const me = b.rows.find((r) => r.key === _meKey) || null;
  const meName = esc(nameOf(meGroup() || { name: (loadProfile() || {}).name }));
  const pinCols = cols;
  let pin;
  if (me) {
    pin = `<div class="lb2-pin" style="grid-template-columns:${pinCols}"><span class="c num lb2-pinrank">${rankCell(me, 'sm')}</span>
      <span class="lb2-grow"><span class="lb2-nm"><b class="lb2-nmt lb2-mine">${meName}</b>${mv(moveOf(b.id, me))}</span><span class="lb2-gap num">${pinLine(game, b, me, tiered)}</span></span>
      <span class="r lb2-val num">${numShape(tiered, me)}${game === 'contexto' ? ctValHTML(me.g, st.view === 'daily') : dispHTML(game, me.html)}</span><span></span></div>`;
  } else {
    const play = playable(game) ? `<button type="button" class="lb2-play sm" data-act="play" data-game="${esc(game)}">${esc(t2('lb2_play'))}</button>` : '';
    pin = `<div class="lb2-pin" style="grid-template-columns:${pinCols}"><span class="c num lb2-pinrank">–</span>
      <span class="lb2-grow"><b class="lb2-nmt lb2-mine">${meName}</b><span class="lb2-gap">${esc(t2('lb2_not_ranked'))}</span></span>
      <span class="lb2-pinplay">${play}</span><span></span></div>`;
  }
  const bests = bestsHTML(game, st, b.records);
  // Session 3 (Matt, 2026-11-01): the tabs sit on top and the players right under them; Contexto's medal key
  // goes with the tabs. The pinned row shows only while the viewer's own row is off screen (render()).
  const key = game === 'contexto' && bests ? `<div class="lb2-recs lb2-key">${bests}</div>` : '';
  const recs = bests && !key ? `<div class="lb2-recs">${bests}</div>` : '';
  const showHead = b.rows.length && unit && game !== 'skeeball';
  return `${bar}${ctrl}${key}${showHead ? head : ''}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body">${list}${recs}</div></div>${pin.replace('class="lb2-pin"', `class="lb2-pin${me ? ' lb2-pin-auto' : ''}"`)}`;
}

// --- Hall of Fame: medals from the old one-standing-per-game, nothing else ---------------------------------
const tiedIn = (rows) => { const n = {}; for (const r of rows) n[r.rank] = (n[r.rank] || 0) + 1; return (r) => n[r.rank] > 1; };
let _hofView = 'medals';
/** Me > Closest: 'a' = every game (today), 'b' = only 2nd and 3rd, closest first. Test-only switch for the mockup. */
let _closeVariant = 'a';
export function __setClosestForTest(v) { _closeVariant = v === 'b' ? 'b' : 'a'; if (_host) render({ keepScroll: true }); }
/** Hall of Fame's second view: the old By Player list as it opened (category All, by Wins), unchanged. */
/** Hall of Fame > Wins' filter and sort (2026-11-02, Matt's approved mockup): the old By Player list's categories
 *  (Everything, the four difficulties, vs people, No difficulty) and its Wins / Played / Name sorts. */
const HOF_CATS = ['all', 1, 2, 3, 4, 'VS', 'NT'];
let _hofCat = 'all';
let _hofSort = 'wins';
let _hofFold = false;
const catWord = (c) => (c === 'all' ? t('lb_cat_all') : c === 'VS' ? t('lb_cat_vs') : c === 'NT' ? t('lb_cat_nt') : lb2TierWord(c));
function winsRows() {
  let rows = lb2Players(_people, _hofCat);
  if (_hofSort === 'played') {
    rows = rows.slice().sort((a, b) => b.played - a.played || nameOf(a.g).localeCompare(nameOf(b.g)));
    let last = null, rank = 0;
    const n = {}; for (const r of rows) n[r.played] = (n[r.played] || 0) + 1;
    rows = rows.map((r, i) => { if (r.played !== last) { rank = i + 1; last = r.played; } return { ...r, rank, tie: n[r.played] > 1, show: r.played }; });
  } else {
    if (_hofSort === 'name') rows = rows.slice().sort((a, b) => nameOf(a.g).localeCompare(nameOf(b.g)));
    rows = rows.map((r) => ({ ...r, show: r.wins }));
  }
  return rows;
}
function winsCtrlHTML() {
  const pick = `<label class="lb2-catpick">${typeof _hofCat === 'number' ? shape(_hofCat) : ''}<span>${esc(catWord(_hofCat))}</span><select data-role="hofcat" aria-label="${esc(catWord(_hofCat))}">${HOF_CATS.map((c) => `<option value="${c}"${c === _hofCat ? ' selected' : ''}>${esc(catWord(c))}</option>`).join('')}</select></label>`;
  const sorts = [['wins', t('lb_sort_wins')], ['played', t2('lb2_played_col')], ['name', t('lb_sort_alpha')]];
  const sortBtn = `<label class="lb2-sortbtn" aria-label="${esc(t2('lb2_sort_aria'))}">${SVG.sort}<select data-role="hofsort" aria-label="${esc(t2('lb2_sort_aria'))}">${sorts.map(([v, l]) => `<option value="${v}"${v === _hofSort ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  return `<div class="lb2-frow">${pick}${sortBtn}</div>`;
}
function winsUnit() {
  if (_hofSort === 'played') return t2('lb2_played_col');
  return _hofCat === 'NT' ? t('lb_unit_runs') : _hofCat === 'VS' ? t('lb_unit_vs_wins') : t('lb_wins_unit');
}
function winsHTML() {
  const rows = winsRows();
  const cols = COLS;
  const byPlayed = _hofSort === 'played';
  const one = (r) => `<button type="button" class="lb2-lr${byPlayed ? '' : pod(r)}${r.key === _meKey ? ' me' : ''}" style="grid-template-columns:${cols}" data-act="person" data-pi="${pIdx(r.key)}" data-rank="${r.rank}" data-tie="${r.tie ? 1 : 0}">
      ${byPlayed ? plainRank(r.rank, r.tie) : rankCell(r)}<span class="lb2-who"><span class="lb2-nm"><span class="lb2-nmt${mineCls(r.key)}">${esc(nameOf(r.g))}</span></span></span><span class="r lb2-val num">${fmt(r.show)}</span>${CHEV}</button>`;
  const list = rows.length ? `<div class="lb2-card" data-role="rows">${_hofSort === 'name' ? rows.map(one).join('') : foldTail(rows, one, { fold: _hofFold }, cols, '')}</div>`
    : `<div class="lb2-card"><p class="lb2-empty-t">${esc(t2('lb2_nothing'))}</p></div>`;
  const me = rows.find((r) => r.key === _meKey) || null;
  const meName = esc(nameOf(meGroup() || { name: (loadProfile() || {}).name }));
  const head = `<div class="lb2-cols" style="grid-template-columns:${cols}"><span></span><span></span><span class="r">${esc(cap(winsUnit()))}</span><span></span></div>`;
  const pin = `<div class="lb2-pin${me ? ' lb2-pin-auto' : ''}" style="grid-template-columns:${cols}"><span class="c num lb2-pinrank">${me ? (byPlayed ? plainRank(me.rank, me.tie) : rankCell(me, 'sm')) : '–'}</span>
    <span class="lb2-grow"><b class="lb2-nmt lb2-mine">${meName}</b>${me ? `<span class="lb2-gap num">${esc(t('lb_played_count', { n: fmt(me.played) }))}</span>` : `<span class="lb2-gap">${esc(t2('lb2_not_ranked'))}</span>`}</span>
    <span class="r lb2-val num">${me ? fmt(me.show) : ''}</span><span></span></div>`;
  return `${headHTML(hofSeg() + winsCtrlHTML())}${head}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body">${list}</div></div>${pin}`;
}
const hofSeg = () => seg([{ v: 'medals', label: t2('lb2_medals') }, { v: 'wins', label: t('lb_sort_wins') }], _hofView, 'hofview');
function hofHTML() {
  if (_hofView === 'wins') return winsHTML();
  const rows = _model.hof;
  const tie = tiedIn(rows);
  const bid = 'hof~all';
  const cols = '40px minmax(0,1fr) 36px 36px 36px 10px';
  const m = (n) => `<span class="c">${medal(n, 'xs')}</span>`;
  const head = `<div class="lb2-cols lb2-hof-cols" style="grid-template-columns:${cols}"><span class="c">#</span><span>${esc(t2('lb2_col_player'))}</span>${m(1)}${m(2)}${m(3)}<span></span></div>`;
  const list = rows.length ? `<div class="lb2-card">${rows.map((r) => `<button type="button" class="lb2-lr lb2-hofr${pod(r)}${r.key === _meKey ? ' me' : ''}" style="grid-template-columns:${cols}" data-act="person" data-pi="${pIdx(r.key)}">
      ${med(r.rank, tie(r))}<span class="lb2-nm"><span class="lb2-nmt${mineCls(r.key)}">${esc(nameOf(r))}</span>${mv(moveOf(bid, r))}</span>
      <span class="c num lb2-strong">${fmt(r.firsts)}</span><span class="c lb2-gm num">${fmt(r.seconds)}</span><span class="c lb2-gm num">${fmt(r.thirds)}</span>${CHEV}</button>`).join('')}</div>`
    : `<div class="lb2-card"><p class="lb2-empty-t">${esc(t2('lb2_nothing'))}</p></div>`;
  const me = rows.find((r) => r.key === _meKey) || null;
  const meName = esc(nameOf(meGroup() || { name: (loadProfile() || {}).name }));
  let gap;
  if (!me) gap = t2('lb2_not_ranked');
  else if (me.rank === 1) gap = t2('lb2_first');
  else { const above = B.aboveOf(rows, me); gap = t2('lb2_pass', { n: B.firstsToPass(me, above), r: above.rank }); }
  const pin = `<div class="lb2-pin lb2-hof-cols${me ? ' lb2-pin-auto' : ''}" style="grid-template-columns:${cols}"><span class="c num lb2-pin lb2-hof-colsrank">${me ? med(me.rank, tie(me), 'sm') : '–'}</span>
    <span class="lb2-grow"><span class="lb2-nm"><b class="lb2-nmt lb2-mine">${meName}</b>${me ? mv(moveOf(bid, me)) : ''}</span><span class="lb2-gap num">${esc(gap)}</span></span>
    <span class="c num lb2-strong">${me ? fmt(me.firsts) : ''}</span><span class="c num">${me ? fmt(me.seconds) : ''}</span><span class="c num">${me ? fmt(me.thirds) : ''}</span><span></span></div>`;
  return `${headHTML(hofSeg())}${head}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body">${list}</div></div>${pin}`;
}
function hofRankOf(key) { const r = _model.hof.find((x) => x.key === key); return r ? r.rank : null; }

// --- Me: the old You tab in the new look ------------------------------------------------------------------
/** A board number with its difficulty SHAPE before it (round 4: the shape rides the number, never a word or a
 *  pill beside a lifetime count). */
function valHTML(id, v) { return `<span class="lb2-v">${shape(v.tier)}<span>${esc(dispText(id, v.text))}</span></span>`; }
const holderHTML = (x) => `${medal(1, 'xs')}<span class="lb2-nmt${mineCls(x.rec && x.rec.key)}">${esc(nameOf(x.rec))}</span>`;
function meHTML() {
  const R = lb2Records(_people, _meKey);
  const hr = hofRankOf(_meKey);
  const pg = lb2PlayerGames(_people, _meKey);
  // Matt, 2026-11-02: "#2 under medals ... reads like I only have 2 medals"; "/34" and the Games tile meant nothing.
  // Three tiles = the viewer's gold, silver and bronze medals (the Hall of Fame Medals row); a tap opens Hall of Fame.
  const mp = ((_model.hof.find((x) => x.key === _meKey) || {}).p) || [0, 0, 0];
  const tiles = `<div class="lb2-tiles">${[1, 2, 3].map((n) => `<button type="button" class="lb2-tile lb2-mtile" data-act="tab" data-v="hof">${medal(n, 'sm')}<b class="num">${fmt(mp[n - 1])}</b></button>`).join('')}</div>`;
  // Records held: the viewer's number under the game's name (full width), the gold medal at the right.
  const held = R.held.length ? `<div><h2 class="lb2-h2">${esc(t2('lb2_hold_h'))}</h2><div class="lb2-card">${R.held.map((x) => `<button type="button" class="lb2-row sm" data-act="game" data-game="${esc(x.id)}">
      ${art(x.id)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(x.id))}</span><span class="lb2-t2 lb2-vline num">${valHTML(x.id, x.mine)}</span></span><span class="lb2-right">${med(1, x.tie, 'sm')}</span>${CHEV}</button>`).join('')}</div></div>` : '';
  // Closest to a record: "3 wins · record 5", the viewer's number beside the record; the holder on its own line.
  // Closest (session 4): the viewer's number at the RECORD'S difficulty (the old gapText rule), and one word for why
  // the record ranks above when the numbers alone hide it: the record's difficulty ("Hard") or "No hints".
  // Variant B (Matt picks; test-only flag): only games where the viewer is 2nd or 3rd, closest gap first.
  const closeRows = _closeVariant === 'b' ? R.close.filter((x) => x.rank === 2 || x.rank === 3) : R.close;
  const whyPill = (x) => (x.why === 'tier' ? `<span class="lb2-pill lb2-why">${esc(lb2TierWord(x.whyTier))}</span>` : x.why === 'nohint' ? `<span class="lb2-pill lb2-why">${esc(t2('lb2_nohint'))}</span>` : '');
  const close = closeRows.length ? `<div><h2 class="lb2-h2">${esc(t2('lb2_close_h'))}</h2><div class="lb2-card">${closeRows.map((x) => `<button type="button" class="lb2-row lb2-close" data-act="game" data-game="${esc(x.id)}">
      ${art(x.id)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(x.id))}</span>
      <span class="lb2-t2 lb2-vline num">${(x.mineAt || x.mine).text === '–' ? '' : `<span class="lb2-nw"><b>${valHTML(x.id, x.mineAt || x.mine)}</b><span class="lb2-dot">·</span></span>`}<span class="lb2-nw lb2-recq"><span class="lb2-recw">${esc(t2('lb2_record'))}</span>${valHTML(x.id, x.recVal)}${whyPill(x)}</span></span></span>
      <span class="lb2-right">${placeHTML(defPlace(x.id, _meKey))}</span>${CHEV}</button>`).join('')}</div></div>` : '';
  const fresh = R.fresh.length ? `<div><h2 class="lb2-h2">${esc(t2('lb2_fresh_h'))}</h2><div class="lb2-card">${R.fresh.map((x) => `<div class="lb2-row sm">
      ${art(x.id)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(x.id))}</span><span class="lb2-t2 lb2-vsr">${holderHTML(x)}<span class="lb2-rv num">${valHTML(x.id, x.recVal)}</span></span></span>
      ${playable(x.id) ? `<button type="button" class="lb2-play sm" data-act="play" data-game="${esc(x.id)}">${esc(t2('lb2_play'))}</button>` : ''}</div>`).join('')}</div></div>` : '';
  const body = R.me ? tiles + held + close + fresh : `<div class="lb2-card"><p class="lb2-empty-t">${esc(t2('lb2_nothing'))}</p></div>`;
  return `${headHTML()}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body lb2-pad">${body}</div></div>`;
}

// --- Player: every game they played, their place and their number ----------------------------------------
const _msgTo = [];
let _pSort = 'best';   // a person's page: best place first (Matt, 2026-11-02), Most played, A to Z
/** The person's top bar (back, face, name, a second line, Message). Shared by their page and their game page. */
function personBarHTML(g, key, sub, link = false) {
  const face = String(g.emoji || '').trim() || esc(nameOf(g).slice(0, 1).toUpperCase());
  const code = typeof g.playerId === 'string' ? g.playerId.trim().toUpperCase() : '';
  let msg = '';
  if (code && key !== _meKey) {
    if (_msgTo.length > 200) _msgTo.length = 0;
    const mi = _msgTo.push({ code, name: nameOf(g), emoji: g.emoji || '🙂' }) - 1;
    msg = `<button type="button" class="lb2-icon lb2-msg" data-act="msg" data-mi="${mi}" aria-label="${esc(t2('lb2_message'))}">${SVG.chat}</button>`;
  }
  return `<div class="lb2-bar"><button type="button" class="lb2-icon" data-act="back" aria-label="${esc(t2('lb2_back'))}">${SVG.back}</button>
    ${link ? '<button type="button" class="lb2-plink" data-act="pall">' : ''}<span class="lb2-face">${esc(face)}</span><span class="lb2-grow lb2-pl"><h1 class="${mineCls(key).trim()}">${esc(nameOf(g))}</h1><span class="lb2-t2 num">${sub ? esc(sub) : ''}</span></span>${link ? '</button>' : ''}${msg}</div>`;
}
function playerHTML(top) {
  const pg = lb2PlayerGames(_people, top.key);
  const g = (pg && pg.g) || _people.find((x) => x.key === top.key) || {};
  const places = B.personPlaces(_model.standings, top.key);
  const hr = hofRankOf(top.key);
  const bar = personBarHTML(g, top.key, pg ? `${t('lb_played_count', { n: fmt(pg.played) })} · ${fmt(pg.wins)} ${t('lb_wins_unit')}` : '');
  const tag = String(g.message || '').trim();
  // Matt, 2026-11-02: "the Me page is way easier to read than someone else's profile": the same medal tiles as Me
  // (the Hall of Fame Medals row), and the games sorted best place first by default, with a sort picker.
  const mp = ((_model.hof.find((x) => x.key === top.key) || {}).p) || [0, 0, 0];
  const tiles = `<div class="lb2-tiles">${[1, 2, 3].map((n) => `<button type="button" class="lb2-tile lb2-mtile" data-act="tab" data-v="hof">${medal(n, 'sm')}<b class="num">${fmt(mp[n - 1])}</b></button>`).join('')}</div>`;
  const rankOf = (id) => { const p = defPlace(id, top.key); return p && p.rank ? p.rank : Infinity; };
  const list = pg ? pg.games.slice() : [];
  if (_pSort === 'best') list.sort((a, b) => (rankOf(a.id) - rankOf(b.id)) || ((b.plays | 0) - (a.plays | 0)));
  else if (_pSort === 'az') list.sort((a, b) => title(a.id).localeCompare(title(b.id), getLang()));
  else list.sort((a, b) => (b.plays | 0) - (a.plays | 0));
  const psorts = [['best', t2('lb2_sort_best')], ['played', t2('lb2_sort_played')], ['az', t2('lb2_sort_az')]];
  const psortBtn = `<label class="lb2-sortbtn lb2-psort" aria-label="${esc(t2('lb2_sort_aria'))}">${SVG.sort}<select data-role="psort" aria-label="${esc(t2('lb2_sort_aria'))}">${psorts.map(([v, l]) => `<option value="${v}"${v === _pSort ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  // Under the game's name: lifetime plays only. The difficulty is the shape before the number at the right.
  const games = list.length ? `<div><div class="lb2-h2row"><h2 class="lb2-h2">${esc(t2('lb2_games_h'))}</h2>${psortBtn}</div><div class="lb2-card">${list.map((x) => `<button type="button" class="lb2-row sm" data-act="pgame" data-game="${esc(x.id)}">
      ${art(x.id)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(x.id))}</span><span class="lb2-t2 num">${esc(t('lb_played_count', { n: fmt(x.plays) }))}</span></span>
      <span class="lb2-right"><span class="lb2-rv num">${valHTML(x.id, x)}</span>${placeHTML(defPlace(x.id, top.key))}</span>${CHEV}</button>`).join('')}</div></div>` : '';
  return `${bar}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body lb2-pad">${tag ? `<p class="lb2-tag">${esc(tag)}</p>` : ''}${tiles}${games}</div></div>`;
}

// --- One person, one game (Matt, 2026-11-01): a name tapped on a game's board opens THAT person's stats for
// THAT game, the old leaderboard's player-game screen (game-stats-ui.js screenFor, My Stats' own renderers).
// "All games" under it opens their whole page.
function personGameHTML(top) {
  const g = _people.find((x) => x.key === top.key) || {};
  const plays = (lb2PlayerGames(_people, top.key) || { games: [] }).games.find((x) => x.id === top.game);
  const bar = personBarHTML(g, top.key, title(top.game), true);   // tap the name: their page (Matt, 2026-11-02)
  const head = `<div class="lb2-card"><div class="lb2-row sm">${art(top.game)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(top.game))}</span>${plays ? `<span class="lb2-t2 num">${esc(t('lb_played_count', { n: fmt(plays.plays) }))}</span>` : ''}</span>
    ${plays ? `<span class="lb2-right"><span class="lb2-rv num">${valHTML(top.game, plays)}</span>${placeHTML(defPlace(top.game, top.key))}</span>` : ''}</div></div>`;
  let stats = '';
  try { stats = v2ScreenFor(top.game, { games: g.games || {}, code: g.playerId }); } catch (err) { console.error('[leaderboard2] player game screen failed', err); }
  const all = `<div class="lb2-card"><button type="button" class="lb2-row sm" data-act="pall"><span class="lb2-grow"><span class="lb2-t1">${esc(t2('lb2_all_games'))}</span></span>${CHEV}</button></div>`;
  return `${bar}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body lb2-pad">${head}<div class="gs-v2 gs-s4">${stats}</div>${all}</div></div>`;
}

// --- How rankings work (round 4): every line checked against leaderboard-ui.js ----------------------------
let _help = false;
function helpHTML() {
  const on = (ids) => ids.filter((id) => _model && _model.games.includes(id)).map((id) => title(id)).join(', ');
  const pts = on(['wayout', 'gridlock', 'wordweaver']), nh = on(['sudoku', 'murdoku']);
  const lines = [t2('lb2_help_harder'), pts ? t2('lb2_help_points', { g: pts }) : '', nh ? t2('lb2_help_nohint', { g: nh }) : '',
    t2('lb2_help_medals'), t2('lb2_help_bests'), t2('lb2_help_online'), t2('lb2_help_h2h')].filter(Boolean);
  return `<div class="lb2-sheet" data-act="helpclose"><div class="lb2-sh" role="dialog" aria-label="${esc(t2('lb2_help_h'))}" data-act="noop"><span class="lb2-grab"></span>
    <h2 class="lb2-shh">${esc(t2('lb2_help_h'))}</h2>
    <div class="lb2-shape-key">${[4, 3, 2, 1].map((tr) => `<span>${shape(tr)}${esc(lb2TierWord(tr))}</span>`).join('')}</div>
    <ul class="lb2-help">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    <button type="button" class="lb2-done" data-act="helpclose">${esc(t2('lb2_done'))}</button></div></div>`;
}

// --- render ----------------------------------------------------------------------------------------------
function screenHTML() {
  _pidx = [];
  if (!_connected || !_model) return `${headHTML()}<div class="lb2-scroll"><p class="lb2-empty-t">${esc(t2(navigator.onLine === false ? 'lb2_offline' : 'lb2_loading'))}</p></div>`;
  const top = _stack[_stack.length - 1];
  if (top && top.kind === 'board') return boardScreenHTML(top);
  if (top && top.kind === 'player') return playerHTML(top);
  if (top && top.kind === 'pgame') return personGameHTML(top);
  const sheet = _help ? helpHTML() : '';
  if (_tab === 'hof') return hofHTML() + sheet;
  if (_tab === 'me') return meHTML() + sheet;
  return boardsHTML() + sheet;
}
let _lastHTML = '';
function render({ keepScroll = false } = {}) {
  if (!_host) return;
  const page = _host.querySelector('.lb2-page');
  const old = page.querySelector('[data-role="scroll"]');
  const top = keepScroll && old ? old.scrollTop : 0;
  const html = screenHTML();
  if (html === _lastHTML) { if (_bs) _bs.sync(levelNow()); return; }
  const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.role === 'q';
  page.innerHTML = html;
  _lastHTML = html;
  const sc = page.querySelector('[data-role="scroll"]');
  if (sc) sc.scrollTop = top;
  watchPin(page, sc);
  if (focused) { const q = page.querySelector('[data-role="q"]'); if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch { /* type=search */ } } }
  if (_bs) _bs.sync(levelNow());
}
/** Screens deep (1 = the first screen): the game it was opened on is level 1, the help sheet one more. */
function levelNow() {
  const entry = _entryGame && _stack[0] && _stack[0].kind === 'board' && _stack[0].game === _entryGame ? 1 : 0;
  return 1 + _stack.length - entry + (_help && !_stack.length ? 1 : 0);
}
/** The pinned own row: hidden while the viewer's row on the board is fully on screen. */
function watchPin(page, sc) {
  const pin = page.querySelector('.lb2-pin-auto');
  const row = sc && sc.querySelector('.lb2-lr.me');
  if (!pin || !row) return;
  const check = () => {
    const a = sc.getBoundingClientRect(), r = row.getBoundingClientRect();
    const seen = r.top >= a.top - 1 && r.bottom <= a.bottom + 1;
    if (pin.hidden !== seen) pin.hidden = seen;
  };
  sc.addEventListener('scroll', check, { passive: true });
  check();
  requestAnimationFrame(check);
}
function onData() { if (!_host) return; buildModel(); render({ keepScroll: true }); }

// --- navigation ------------------------------------------------------------------------------------------
function openGame(game, sel) {
  _stack.push({ kind: 'board', game, sel: sel || null });
  render();
}
function openPerson(key) {
  const top = _stack[_stack.length - 1];
  // From a game's board: that person's stats for that game (the viewer's own too).
  if (top && top.kind === 'board') { _stack.push({ kind: 'pgame', key, game: top.game }); render(); return; }
  if (key === _meKey) { _stack = []; _tab = 'me'; render(); return; }
  _stack.push({ kind: 'player', key, all: false });
  render();
}
function stepBack() {
  if (_stack.length === 1 && _entryGame && _stack[0].kind === 'board' && _stack[0].game === _entryGame) return false;
  if (_stack.length) { _stack.pop(); render(); return true; }
  return false;
}
function setSel(patch) {
  const top = _stack[_stack.length - 1];
  if (!top || top.kind !== 'board') return;
  top.sel = selFor(top.game, { ...(top.sel || {}), ...patch });
  top.fold = false;
  render();
}
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || !_host || !_host.contains(el)) return;
  const act = el.dataset.act, v = el.dataset.v;
  if (act === 'noop') return;
  switch (act) {
    case 'close': closeLeaderboard2(); return;
    case 'help': _help = true; render({ keepScroll: true }); return;
    case 'helpclose': if (_bs) _bs.back(); else { _help = false; render({ keepScroll: true }); } return;
    case 'tab': _stack = []; _tab = v; render(); return;
    case 'chip': _chip = v; _q = ''; _srch = false; render(); return;
    case 'search': {
      _srch = !(_srch || _q); if (!_srch) _q = '';
      render({ keepScroll: true });
      if (_srch) { const q = _host.querySelector('[data-role="q"]'); if (q) q.focus(); }
      return;
    }
    case 'game': openGame(el.dataset.game); return;
    case 'person': { const k = _pidx[Number(el.dataset.pi)]; if (k != null) openPerson(k); return; }
    case 'pgame': { const top = _stack[_stack.length - 1]; if (top && top.kind === 'player') { _stack.push({ kind: 'pgame', key: top.key, game: el.dataset.game }); render(); } return; }
    case 'pall': {
      const top = _stack[_stack.length - 1];
      if (!top || top.kind !== 'pgame') return;
      const below = _stack[_stack.length - 2];
      if (below && below.kind === 'player' && below.key === top.key) { stepBack(); return; }
      _stack.push({ kind: 'player', key: top.key, all: false }); render(); return;
    }
    case 'back': if (_bs) _bs.back(); else if (!stepBack()) closeLeaderboard2(); return;
    case 'fav': { const top = _stack[_stack.length - 1]; if (top) { toggleFavorite(hubIdOf(top.game)); render({ keepScroll: true }); } return; }
    case 'hofview': _hofView = v === 'wins' ? 'wins' : 'medals'; render(); return;
    case 'fold': {
      const top = _stack[_stack.length - 1];
      if (top && top.kind === 'board') top.fold = true; else _hofFold = true;
      render({ keepScroll: true }); return;
    }
    case 'stab': {
      const top = _stack[_stack.length - 1];
      if (!top || top.kind !== 'board') return;
      const [ri, i] = String(v).split(':').map(Number);
      const tab = (tabsOf(top.game).rows[ri] || [])[i];
      if (tab) setSel(tab.st);
      return;
    }
    case 'womode': case 'worush': case 'woview': {
      const top = _stack[_stack.length - 1];
      if (!top || top.kind !== 'board') return;
      if (act === 'womode') top.rush = v === 'rush'; else if (act === 'worush') top.rmode = v; else top.rview = v;
      render(); return;
    }
    case 'rush': { const o = { ..._opts, game: 'wayout', woMode: 'rush', legacy: true }; closeLeaderboard2({ keepHistory: true }); openLeaderboard(o); return; }
    case 'msg': {
      const to = _msgTo[Number(el.dataset.mi)];
      if (to) import('./messages-ui.js').then((m) => m.openMessages({ to: to.code, toName: to.name, toEmoji: to.emoji })).catch((err) => console.error('[leaderboard2] messages failed to load', err));
      return;
    }
    case 'play': { const fn = _onPlay, hub = hubIdOf(el.dataset.game); closeLeaderboard2(); if (fn) fn(hub); return; }
    case 'old': { const o = { ..._opts, legacy: true }; closeLeaderboard2({ keepHistory: true }); openLeaderboard(o); return; }
    default:
  }
}
function onChange(e) {
  if (e.target && e.target.dataset.role === 'hofcat') { const v = e.target.value; _hofCat = /^\d$/.test(v) ? Number(v) : v; _hofFold = false; render(); return; }
  if (e.target && e.target.dataset.role === 'psort') { _pSort = e.target.value; render({ keepScroll: true }); return; }
  if (e.target && e.target.dataset.role === 'hofsort') { _hofSort = e.target.value; _hofFold = false; render(); return; }
  if (e.target && e.target.dataset.role === 'woview') { const top = _stack[_stack.length - 1]; if (top && top.kind === 'board') { top.rview = e.target.value; render(); } return; }
  if (e.target && e.target.dataset.role === 'gsort') { if (SORTS.includes(e.target.value)) { saveSort(e.target.value); render(); } return; }
  if (!e.target || e.target.dataset.role !== 'stab') return;
  const top = _stack[_stack.length - 1];
  if (!top || top.kind !== 'board') return;
  const [ri, i] = String(e.target.value).split(':').map(Number);
  const tab = (tabsOf(top.game).rows[ri] || [])[i];
  if (tab) setSel(tab.st);
}
function onInput(e) {
  if (!e.target || e.target.dataset.role !== 'q') return;
  _q = e.target.value || '';
  const box = _host && _host.querySelector('[data-role="glist"]');
  if (box) { _pidx = []; box.innerHTML = boardsListHTML(); }
}
function onKey(e) { if (e.key === 'Escape' && _host && _bs) _bs.back(); }
/** The phone's back gesture (and the back button, Esc): n screens back; past the first, close. */
function onBackSteps(n) {
  for (let i = 0; i < n && _host; i++) {
    if (_help && !_stack.length) { _help = false; render({ keepScroll: true }); continue; }
    if (!stepBack()) { closeLeaderboard2(); return; }
  }
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
  document.documentElement.classList.remove('gh-lb2-open');
  if (_offVp) { try { _offVp(); } catch { /* gone */ } _offVp = null; }
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('click', onTabTap, true);
  // `keepHistory` (the Old / Rush links) no longer matters: this unwinds its own entries and the
  // board opened next pushes its own once that has landed (js/back-stack.js).
  void keepHistory;
  if (_bs) { const bs = _bs; _bs = null; bs.close(); }
  _connected = false; _model = null; _lastHTML = '';
}

/** Open Leaderboard v2. `opts.game` (a stats id): straight onto that game's board, back = close.
 *  `{onPlay, canPlay}`: the launcher's way to start a game (Play on an empty board / a pinned row). */
export async function openLeaderboard2(opts = {}) {
  closeLeaderboard2();
  ensureCss();
  try { ensureLeaderboardCss(); } catch { /* Minesweeper's % bar and Contexto's medals style from it */ }
  try { ensureStatsCss(); } catch { /* a person's game page uses My Stats' gs-* screens */ }
  _opts = { ...opts };
  delete _opts.legacy;
  _onPlay = typeof opts.onPlay === 'function' ? opts.onPlay : null;
  _canPlay = typeof opts.canPlay === 'function' ? opts.canPlay : () => false;
  _tab = 'boards'; _chip = null; _q = ''; _srch = false; _hofView = 'medals'; _stack = []; _entryGame = null; _help = false;
  if (typeof opts.game === 'string' && isGameOnLauncher(opts.game)) { _entryGame = opts.game; _stack = [{ kind: 'board', game: opts.game, sel: null }]; }
  const host = document.createElement('div');
  host.className = 'lb2';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', t2('lb2_title'));
  host.innerHTML = '<div class="lb2-page"></div>';
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  host.addEventListener('touchstart', onTouchStart, { passive: true });
  host.addEventListener('touchmove', onTouchMove, { passive: false });
  document.body.appendChild(host);
  _host = host;
  document.documentElement.classList.add('gh-lb2-open');
  fitHeight();
  _offVp = onViewportResize(fitHeight);
  lightTab(true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onTabTap, true);
  _bs = backStack(onBackSteps);
  render();
  try {
    _beeOff = watchBeeBoard(() => { if (_host && _connected) onData(); });
    const sid = statsId(), code = String((loadProfile() || {}).playerId || '').toUpperCase();
    const off = await watchBoard((b) => {
      _people = b.list.filter((g) => !isHiddenName(g && g.name));
      const mine = b.list.find((g) => (b.idsByKey.get(g.key) || []).includes(sid)) || (code ? b.list.find((g) => g.playerId === code) : null);
      _meKey = mine ? mine.key : '';
      _fromBoard = true;
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
html.gh-lb2-open,html.gh-lb2-open body{overflow:hidden;overscroll-behavior:none}
.lb2{position:fixed;top:0;left:0;right:0;bottom:auto;height:100vh;z-index:300;display:flex;justify-content:center;background:var(--l2-bg);color:var(--l2-text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overscroll-behavior:contain;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);-webkit-tap-highlight-color:transparent}
html.gh-compact .lb2{z-index:19;padding-bottom:calc(53px + max(6px, calc(env(safe-area-inset-bottom,0px) - 16px)))}
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
.lb2-ic{width:64px;height:36px;flex-shrink:0;border-radius:8px;overflow:hidden;background:var(--l2-chip);display:flex;align-items:center;justify-content:center}
.lb2-ic.hd{width:56px;height:32px;margin-left:2px}
.lb2-ic svg{width:100%;height:100%;display:block}
.lb2-grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lb2-t1{font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-t2{font-size:14px;color:var(--l2-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0}
.lb2-right{flex-direction:row;align-items:center;gap:8px}
.lb2-best{font-size:16px;font-weight:700;color:var(--l2-muted);min-width:30px;text-align:center}
.lb2-lr.pod1 .lb2-medal{filter:drop-shadow(0 0 6px rgba(245,200,66,.55))}
.lb2-lr.pod1{background:linear-gradient(90deg,rgba(245,200,66,.24),rgba(245,200,66,.06) 70%);box-shadow:inset 5px 0 0 #f5c842}
.lb2-lr.pod1 .lb2-nm{font-weight:700}
.lb2-lr.pod2{box-shadow:inset 5px 0 0 #b9c0c9}
.lb2-lr.pod3{box-shadow:inset 5px 0 0 #c27a42}
.lb2-old{align-self:center;min-height:44px;padding:0 20px;border:0;background:transparent;color:var(--l2-muted);font-size:14px;font-weight:600;text-decoration:underline}
.lb2-bar{min-height:60px;flex-shrink:0;display:flex;align-items:center;gap:4px;padding:4px 4px 0}
.lb2-bar h1{font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-icon{width:48px;height:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--l2-text);border-radius:12px}
.lb2-heart{color:var(--l2-accent)}
.lb2-face{width:40px;height:40px;flex-shrink:0;border-radius:20px;background:var(--l2-chip);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700}
.lb2-pl{padding-left:8px}
.lb2-plink{flex:1;min-width:0;display:flex;align-items:center;background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;text-align:left;cursor:pointer;touch-action:manipulation}
.lb2-cols{flex-shrink:0;display:grid;gap:8px;padding:6px 16px;font-size:13px;font-weight:600;color:var(--l2-muted);align-items:center}
.lb2 .c{text-align:center;display:flex;justify-content:center}.lb2 .r{text-align:right;justify-content:flex-end}
.lb2-lr{width:100%;display:grid;gap:8px;align-items:center;min-height:52px;padding:0 4px;border:0;border-top:1px solid var(--l2-line);background:transparent;text-align:left}
.lb2-lr.me{background:var(--l2-you);color:var(--l2-youText)}
.lb2-lr.me .lb2-nm{font-weight:700}
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
.lb2-rv{min-width:72px;text-align:right}
.lb2-ctrl{flex-shrink:0;display:flex;gap:8px;padding:10px 16px;align-items:center}
.lb2-gear{width:48px;height:48px;flex-shrink:0;border-radius:12px;border:0;display:flex;align-items:center;justify-content:center;background:var(--l2-seg);color:var(--l2-text)}
.lb2-pin{flex-shrink:0;display:grid;gap:8px;align-items:center;min-height:60px;padding:6px 16px;background:var(--l2-you);color:var(--l2-youText);border-top:1px solid var(--l2-line)}
.lb2-pin .lb2-val{padding-right:0}
.lb2-tw{font-weight:500;color:var(--l2-muted);white-space:nowrap}
.lb2-tw{font-size:14px}
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
.lb2-mtile{flex-direction:row;gap:10px;font:inherit;color:inherit;cursor:pointer}
.lb2-recq{color:var(--l2-muted)}
.lb2-h2row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.lb2-h2row .lb2-h2{margin-bottom:0}
.lb2-h2row+.lb2-card{margin-top:8px}
.lb2-tile span{font-size:14px;color:var(--l2-muted);line-height:1.15}
.lb2-h2{margin:0 0 8px;padding:0 4px;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--l2-muted)}
.lb2-gh{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.lb2-gh .lb2-h2{flex:1;margin:0}
.lb2-gseg{width:170px}
.lb2-more{min-height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;background:var(--l2-surf);border:1px solid var(--l2-line);color:var(--l2-accent)}
.lb2-empty-t{margin:0;padding:24px 16px;text-align:center;color:var(--l2-muted);font-size:16px}

.lb2-who{display:flex;flex-direction:column;gap:2px;min-width:0}
.lb2-sub{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:13px;color:var(--l2-muted);line-height:1.25}
.lb2-lr.me .lb2-sub{color:inherit}
.lb2-pill{display:inline-flex;align-items:center;gap:4px;padding:1px 7px 1px 4px;border:1px solid currentColor;border-radius:10px;font-size:12px;font-weight:700;line-height:16px;white-space:nowrap;flex-shrink:0}
.lb2-pill .lb2-shape{width:11px;height:11px;margin:0}
.lb2-lr{min-height:58px;padding:6px 4px}
.lb2-val{max-width:46vw}
.lb2-val img{flex-shrink:0}
.lb2-ctrl{flex-direction:column;align-items:stretch}
.lb2-ctrlrow{display:flex;gap:8px;align-items:center}
.lb2-ctrlrow>.lb2-seg{flex:1;min-width:0}
.lb2-seg>button{gap:4px}
.lb2-seg .lb2-shape{width:12px;height:12px}
.lb2-segs{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.lb2-tabwrap{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:8px}
.lb2-tabwrap .lb2-chip{min-height:44px;padding:0 14px;font-size:14px}
.lb2-recs{padding:0 4px}
.lb2-recs .lb-h3{color:var(--l2-muted)}
.lb2-tag{margin:0;font-size:15px;color:var(--l2-muted);font-style:italic;text-align:center}
.lb2-msg{color:var(--l2-accent)}
.lb2-tile b small{font-size:15px;color:var(--l2-muted);font-weight:600}
.lb2-t2 .lb2-medal{display:inline-block;vertical-align:middle;margin:0 4px 0 0}
.lb2-t2 .lb2-shape{display:inline-flex;width:12px;height:12px;vertical-align:middle;margin:0 2px}
.lb2-rv{display:inline-flex;align-items:center;justify-content:flex-end;gap:4px}

.lb2-shape{background:#fff;border-radius:4px;padding:1px;box-sizing:content-box}
:root:not(.gh-dark) .lb2-shape{background:transparent;padding:0}
:root.gh-dark .lb2 .lb-dshape-t3,:root.gh-dark .lb2 .lb-dshape-t4{fill:#1c2430}
.lb2-close{align-items:flex-start;padding-top:10px;padding-bottom:10px}
.lb2-close .lb2-right{align-self:center}
.lb2-vs{display:flex;align-items:center;gap:10px;color:var(--l2-text)}
.lb2-vsr{display:inline-flex;align-items:center;gap:4px;min-width:0;color:var(--l2-muted)}
.lb2-vsr{flex-wrap:wrap;white-space:normal;gap:4px 6px}
.lb2-vsr .lb2-rv{min-width:0}
.lb2-vsr .lb2-nmt{max-width:none;white-space:normal;overflow:visible}
.lb2-close .lb2-right{flex-direction:column;align-items:flex-end;gap:4px}
.lb2-vs .lb2-medal{margin:0}
.lb2-gapw{font-size:13px;font-weight:700;color:var(--l2-accent);line-height:1.25}

.lb2-listhead{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:0 4px 0 0;margin-bottom:-8px;font-size:13px;font-weight:600;color:var(--l2-muted)}
.lb2-listhead span{max-width:50%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.lb2-pick{flex:1;min-width:0;position:relative;display:flex}
.lb2-pick select{flex:1;min-width:0;min-height:44px;border:0;border-radius:12px;padding:0 36px 0 14px;font:inherit;font-size:15px;font-weight:600;background:var(--l2-seg);color:var(--l2-text);-webkit-appearance:none;appearance:none}
.lb2-pick::after{content:'';position:absolute;right:16px;top:50%;width:8px;height:8px;margin-top:-6px;border-right:2px solid var(--l2-muted);border-bottom:2px solid var(--l2-muted);transform:rotate(45deg);pointer-events:none}

.lb2-cat .lb-pcats{margin:0}

.lb2-medal{width:auto;height:auto;display:flex;justify-content:center;align-items:center}
.lb2-medal.sm,.lb2-medal.xs{margin:0}
.lb2-medal .lb-ctm{flex-shrink:0}
.lb2-t2 .lb2-medal{display:inline-flex;vertical-align:middle}

.lb2-listhead .lb2-sortpick{flex:0 0 auto}
.lb2-head .lb2-chips{flex-wrap:nowrap}
.lb2-head .lb2-chip{flex-shrink:0;padding:0 14px}
.lb2-t2 .lb2-medal{margin-right:4px}
.lb2-sortpick select{min-height:40px;font-size:14px;padding-left:14px;border-radius:20px;background:var(--l2-chip)}

/* round 4 (2026-11-01) */
.lb2-tbtns{display:flex;align-items:center;margin-right:-10px}
.lb2-tbtns .lb2-x{margin-right:0}
.lb2-help{color:var(--l2-muted)}
.lb2 .lb2-mine,.lb2-lr.me .lb2-mine,.lb2-pin .lb2-mine{color:var(--l2-accent)}
.lb2-me-em{font-style:normal;margin-right:5px}
.lb2-listhead span.lb2-mine{font-size:14px;font-weight:700}
.lb2-chev{display:flex;align-items:center;justify-content:flex-end;color:var(--l2-muted);opacity:.75;flex-shrink:0}
.lb2-row>.lb2-chev{margin-left:-4px}
.lb2-lr>.lb2-chev{padding-right:6px}
.lb2-rk{display:flex;align-items:center;justify-content:center;gap:0}
.lb2-eq{font-size:15px;font-weight:700;color:var(--l2-muted);margin-right:1px}
.lb2-lr.me .lb2-eq,.lb2-pin .lb2-eq{color:inherit}
.lb2-div{display:flex;align-items:center;gap:6px;min-height:28px;padding:4px 14px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--l2-muted);background:var(--l2-bg);border-top:1px solid var(--l2-line)}
.lb2-card>.lb2-div:first-child{border-top:0}
.lb2-div .lb2-pill{text-transform:none;letter-spacing:0}
.lb2-div0{min-height:8px;padding:0}
.lb2-val .lb2-shape{margin-right:3px}
.lb2-shape.x2{width:24px}
.lb2-seg .lb2-shape.x2,.lb2-t2 .lb2-shape.x2{width:20px}
.lb2-pill.lb2-nh{padding:1px 7px}
.lb2-v{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.lb2-vline{display:flex;align-items:center;flex-wrap:wrap;gap:2px 6px;color:var(--l2-text);white-space:normal;overflow:visible}
.lb2-vline b{font-weight:700;display:inline-flex}
.lb2-dot,.lb2-recw{color:var(--l2-muted)}
.lb2-recs .lb-rec b,.lb2-recs .lb-rec em{color:var(--l2-text)}
.lb2-recs .lb-rec span{color:var(--l2-muted)}
.lb2-recs .lb-rec em.lb2-mine{color:var(--l2-accent)}
.lb2-seg.stk>button{flex-direction:column;gap:2px;font-size:13px;line-height:1.1;padding:2px 1px}
.lb2-seg.stk .lb2-shape{width:13px;height:13px}
.lb2-seg.stk .lb2-shape.x2{width:22px}
.lb2-rushrow{justify-content:flex-end}
.lb2-rushrow .lb2-chip{min-height:40px;padding:0 12px 0 16px;gap:8px}
.lb2-lr.lb2-hofr{gap:6px}
.lb2-hof-cols{gap:6px}
.lb2-nw{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.lb2-close>.lb2-chev{align-self:center}
.lb2-close .lb2-vsr{flex-wrap:nowrap;white-space:nowrap}
.lb2-close .lb2-vsr .lb2-nmt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-frow{display:flex;gap:8px;align-items:stretch}
.lb2-catpick{position:relative;flex:1;min-width:0;min-height:44px;border-radius:12px;background:var(--l2-seg);display:flex;align-items:center;gap:8px;padding:0 36px 0 14px;font-size:15px;font-weight:600;color:var(--l2-text)}
.lb2-catpick span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-catpick::after{content:'';position:absolute;right:16px;top:50%;width:8px;height:8px;margin-top:-6px;border-right:2px solid var(--l2-muted);border-bottom:2px solid var(--l2-muted);transform:rotate(45deg);pointer-events:none}
.lb2-catpick select{position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px;-webkit-appearance:none;appearance:none}
.lb2-frow>.lb2-seg{flex:1;min-width:0}
.lb2-sortbtn{position:relative;flex:0 0 44px;min-height:44px;border-radius:12px;background:var(--l2-seg);display:flex;align-items:center;justify-content:center;color:var(--l2-text)}
.lb2-sortbtn svg{pointer-events:none}
.lb2-sortbtn select{position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px;-webkit-appearance:none;appearance:none}
.lb2-key{flex-shrink:0;padding:0 16px 6px}
.lb2-key .lb-h3{display:none}
.lb2-pin[hidden]{display:none}
.lb2-sortpick svg{position:absolute;left:13px;top:50%;margin-top:-8px;pointer-events:none;color:var(--l2-text)}
.lb2-sortpick select{padding-left:36px}
.lb2-favseg{display:inline-flex;align-items:center;gap:5px}
.lb2-gap b{font-weight:700}
.lb2-gap .lb2-shape{width:12px;height:12px;vertical-align:-2px;margin-right:3px;display:inline-flex}
.lb2-gap .lb2-shape.x2{width:20px}
.lb2-shh{margin:0;font-size:20px;font-weight:700}
.lb2-help-key,.lb2-shape-key{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:15px;font-weight:600}
.lb2-shape-key>span{display:inline-flex;align-items:center;gap:6px}
ul.lb2-help{margin:0;padding:0 0 0 20px;display:flex;flex-direction:column;gap:10px;font-size:16px;line-height:1.35;color:var(--l2-text)}


/* session 4 mockup (2026-11-02) */
.lb2-foldr{width:100%;display:grid;gap:8px;align-items:center;min-height:52px;padding:6px 4px;border:0;border-top:1px solid var(--l2-line);background:transparent;text-align:left;color:var(--l2-muted)}
.lb2-foldr .lb2-nm{font-weight:600;color:var(--l2-text)}
.lb2-foldr .lb2-down{padding-right:4px}
.lb2-nhdiv{background:var(--l2-surf);padding:8px 14px 4px}
.lb2-nhdiv .lb2-pill{font-size:13px;padding:2px 10px;letter-spacing:0;text-transform:none;color:var(--l2-text)}
.lb2-why{font-size:11px;padding:0 6px;line-height:16px;font-weight:700;color:var(--l2-muted);margin-left:2px;text-transform:none;letter-spacing:0}
.lb2-recs .lb-h3{display:flex;align-items:center;gap:8px}
.lb2-ctv{display:inline-flex;align-items:center;gap:6px}
.lb2-ctslots{display:grid;grid-template-columns:repeat(4,40px);gap:2px}
.lb2-cts{display:inline-flex;align-items:center;gap:3px}
.lb2-cts b{font-size:13px;font-weight:700;color:var(--l2-text)}
.lb2-cts.z{opacity:.45}
.lb2-cts.z b{font-weight:600}
:root.gh-dark .lb2 .lb-ctm img,:root.gh-dark .gs-v2 .gs-ctm img{filter:drop-shadow(0 0 1px rgba(255,255,255,.55))}
.lb2-bar h1{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.1}
html[lang="es"] .lb2-bar h1{font-size:18px}
.lb2-rview{flex:0 0 auto;width:46%;min-height:48px}
.lb2-ctrlrow>.lb2-seg.stk{flex:1}
:root:not(.gh-dark) .lb2-shape{background:#DCE0E6;border-radius:4px;padding:1px;width:15px;height:15px}
:root:not(.gh-dark) .lb2-shape.x2{width:26px}
:root:not(.gh-dark) .lb2-seg .lb2-shape{width:13px;height:13px}
:root:not(.gh-dark) .lb2-seg .lb2-shape.x2,:root:not(.gh-dark) .lb2-t2 .lb2-shape.x2{width:22px}
.lb2-shape svg{width:100%;height:100%;display:block}
@media (max-width:380px){.lb2-ic{width:48px;height:30px}.lb2-row{gap:10px;padding:8px 10px}}
`;
  document.head.appendChild(el);
}

export default { openLeaderboard2, closeLeaderboard2 };
