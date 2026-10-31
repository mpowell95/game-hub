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
import { watchPlayers, watchBoard } from './stats-net.js';
import { watchBeeBoard } from './bee-board.js';
import { loadProfile } from './profile-store.js';
import { statsId } from './game-stats.js';
import { GAME_ART } from './game-art.js';
import { loadFavorites, toggleFavorite } from './favorites.js';
import { hubIdOf, isGameOnLauncher } from './game-stats-ui.js';
import { diffShapeSVG } from './difficulty-tiers.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';
import LB2 from './leaderboard2-strings.js';
import * as B from './leaderboard2-boards.js';
import { GAME_META, lb2Standing, lb2Tabs, lb2Board, lb2Records, lb2PlayerGames, lb2Players, lb2TierWord, ensureLeaderboardCss, openLeaderboard, medalSVG } from './leaderboard-ui.js';
import { trueBottom } from './tabbar-fix.js';
import { onViewportResize } from './viewport.js';

const t = makeT(STRINGS);
const t2 = makeT(LB2);

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (id) => { const m = GAME_META.find((x) => x.id === id); return m ? t(m.labelKey) : id; };
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nameOf = (r) => (String((r && r.name) || '').trim() || t('anon_player'));
function fmt(x, digits) {
  const loc = getLang() === 'es' ? 'es-ES' : 'en-US';
  try { return Number(x).toLocaleString(loc, digits ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : undefined); } catch { return String(x); }
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Round 0 kept `gamehub.lb2.v1` (last board per game) and `gamehub.lb2.ranks.v1` (yesterday's ranks). Round 1
// reads and writes neither (the old board opens every board on its default tab; arrows are off). The keys stay
// where they are on each phone, untouched (THE LAW rule 5: never deleted, never repurposed).

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
let _stack = [];          // [{ kind: 'board', game, sel } | { kind: 'player', key, all }]
let _entryGame = null;
let _onPlay = null;
let _canPlay = () => false;
let _unsub = null;
let _beeOff = null;
let _histArmed = false;
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
  chat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
};
// The old board's ribboned medals (leaderboard-ui.js medalSVG), number on the face, for 1st to 3rd.
const medal = (n, cls = '') => `<span class="lb2-medal ${cls}" role="img" aria-label="${n}">${medalSVG(n)}</span>`;
const tieMark = (tie) => (tie ? '<span class="lb2-tie" aria-hidden="true">=</span>' : '');
const med = (n, tie, cls = '') => (n <= 3 ? medal(n, cls) : `<span class="lb2-plain num">${tie ? '=' : ''}${n}</span>`);
const pod = (r) => (r.rank <= 3 ? ` pod${r.rank}` : '');
const art = (id, cls = '') => `<span class="lb2-ic ${cls}">${GAME_ART[hubIdOf(id)] || ''}</span>`;
// Rank arrows are OFF (round 1): yesterday's ranks were taken from the old v2 boards, so they would be noise.
const mv = () => '';
const shape = (tier) => (tier ? `<span class="lb2-shape" aria-label="${esc(lb2TierWord(tier))}">${diffShapeSVG(tier)}</span>` : '');
function pIdx(key) { let i = _pidx.indexOf(key); if (i < 0) { i = _pidx.length; _pidx.push(key); } return i; }
function seg(items, on, act, fit = false) {
  return `<div class="lb2-seg${fit ? ' fit' : ''}" role="group" style="grid-template-columns:repeat(${items.length},minmax(0,1fr))">${items.map((x) => `<button type="button" class="${x.v === on ? 'on' : ''}${items.length > 4 ? ' sm' : ''}" data-act="${act}" data-v="${esc(x.v)}" aria-pressed="${x.v === on}">${x.html || esc(x.label)}</button>`).join('')}</div>`;
}
function headHTML(extra = '') {
  return `<div class="lb2-head"><div class="lb2-titlerow"><h1>${esc(t2('lb2_title'))}</h1><button type="button" class="lb2-icon lb2-x" data-act="close" aria-label="${esc(t2('lb2_close'))}">${SVG.x}</button></div>
    ${seg([{ v: 'boards', label: t2('lb2_tab_boards') }, { v: 'hof', label: t2('lb2_tab_hof') }, { v: 'me', label: t2('lb2_tab_me') }], _tab, 'tab', true)}${extra}</div>`;
}
const playable = (game) => !!(_onPlay && _canPlay(hubIdOf(game)));
/** A place in a game's standing: a medal for 1st to 3rd, "#N" below, a dash when not on it. */
function placeHTML(p) {
  // No place in the standing: nothing, as the old You tab showed no chip (a dash read as a rank).
  if (!p || !p.rank) return '';
  if (p.rank <= 3 && !p.noMedal) return medal(p.rank, 'sm');
  return `<span class="lb2-best num">${p.tie ? '=' : '#'}${p.rank}</span>`;
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
  if (chip === 'all' && !q) list.sort(az); else list.sort((a, b) => rk(a) - rk(b) || az(a, b));
  const items = list.map((r) => {
    const lead = _model.byGame[r.id].rows.filter((x) => x.rank === 1).map((x) => x.g);
    const sub = lead.length ? lead.map((x) => nameOf(x)).join(', ') : '';
    return `<button type="button" class="lb2-row" data-act="game" data-game="${esc(r.id)}">
      ${art(r.id)}
      <span class="lb2-grow"><span class="lb2-t1">${esc(r.title)}</span>${sub ? `<span class="lb2-t2">${medal(1, 'xs')}${esc(sub)}</span>` : ''}</span>
      <span class="lb2-right">${placeHTML(r.place)}</span>
    </button>`;
  }).join('');
  // The right column is the viewer's own place in each game: say whose, by profile name (never "You").
  const meName = nameOf(meGroup() || { name: (loadProfile() || {}).name });
  const colHead = items ? `<div class="lb2-listhead"><span>${esc(meName)}</span></div>` : '';
  return (items ? `${colHead}<div class="lb2-card">${items}</div>` : `<p class="lb2-empty-t">${esc(t2('lb2_none'))}</p>`)
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
function tabLabel(tab) { return tab.tier ? `${shape(tab.tier)}<span>${esc(tab.label)}</span>` : esc(tab.label); }
/** One row of the old board's tabs. Fits = segmented; too many = difficulties on one line and the other tabs
 *  (Walls, Ultimate, Solo, MP) on a second; still too many = wrapping chips. Nothing scrolls out of sight. */
function tabRowHTML(row, st, ri) {
  const on = row.find((x) => tabOn(x, st));
  const fits = (xs) => xs.length <= 5 && xs.every((x) => String(x.label).length <= 9);
  const segOf = (xs) => seg(xs.map((x) => ({ v: ri + ':' + row.indexOf(x), html: tabLabel(x), label: x.label })), on && xs.includes(on) ? ri + ':' + row.indexOf(on) : '', 'stab');
  if (fits(row)) return segOf(row);
  const tiers = row.filter((x) => !x.st.view), rest = row.filter((x) => x.st.view);
  if (tiers.length && rest.length && fits(tiers) && fits(rest)) return `<div class="lb2-segs">${segOf(tiers)}${segOf(rest)}</div>`;
  // A long list of names (Skeeball's machines): one native picker, one line, instead of three rows of chips.
  if (row.every((x) => 'machine' in x.st)) {
    return `<label class="lb2-pick"><select data-role="stab" aria-label="${esc(on ? on.label : '')}">${row.map((x, i) => `<option value="${ri}:${i}"${x === on ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>`;
  }
  return `<div class="lb2-tabwrap">${row.map((x, i) => `<button type="button" class="lb2-chip${x === on ? ' on' : ''}" data-act="stab" data-v="${ri}:${i}" aria-pressed="${x === on}">${tabLabel(x)}</button>`).join('')}</div>`;
}
/** The pinned row's line, the old maths (gapParts): to the row above, or "1st". */
function pinLine(b, me) {
  if (!me) return t2('lb2_not_ranked');
  if (me.rank === 1) return t2(me.tie ? 'lb2_first_tie' : 'lb2_first');
  return gapWords(b.gap(me.key));
}
function rowSub(r) {
  const parts = [r.sub, r.sub2].filter(Boolean).map((x) => esc(x));
  const pill = r.tier ? `<span class="lb2-tierw">${shape(r.tier)}${esc(lb2TierWord(r.tier))}</span>` : '';
  const inner = (r.subHtml || '') + pill + parts.join(' · ');
  return inner ? `<span class="lb2-sub">${inner}</span>` : '';
}
function boardScreenHTML(top) {
  const game = top.game;
  const st = top.sel = selFor(game, top.sel);
  const tb = tabsOf(game);
  const b = boardOf(game, st);
  const fav = loadFavorites().includes(hubIdOf(game));
  const bar = `<div class="lb2-bar"><button type="button" class="lb2-icon" data-act="back" aria-label="${esc(t2('lb2_back'))}">${SVG.back}</button>
    ${art(game, 'hd')}<span class="lb2-grow lb2-pl"><h1>${esc(title(game))}</h1><span class="lb2-t2 num">${esc(t('lb_played_count', { n: fmt(b.plays) }))}</span></span>
    ${playable(game) && b.rows.length ? `<button type="button" class="lb2-play sm" data-act="play" data-game="${esc(game)}">${esc(t2('lb2_play'))}</button>` : ''}
    <button type="button" class="lb2-icon lb2-heart" data-act="fav" aria-pressed="${fav}" aria-label="${esc(t2(fav ? 'lb2_fav_remove' : 'lb2_fav_add'))}">${SVG.heart(24, fav)}</button></div>`;
  const cols = '44px minmax(0,1fr) auto';
  const head = `<div class="lb2-cols" style="grid-template-columns:${cols}"><span></span><span></span><span class="r">${esc(cap(b.unit || ''))}</span></div>`;
  let list;
  if (!b.rows.length) {
    const play = playable(game) ? `<button type="button" class="lb2-play" data-act="play" data-game="${esc(game)}">${esc(t2('lb2_play'))}</button>` : '';
    list = `<div class="lb2-card"><div class="lb2-emptyst"><b>${esc(b.empty || t2('lb2_nothing'))}</b>${play}</div></div>`;
  } else {
    // EVERY row, like the old board (a top 10 hid everyone below it: THE LAW rule 1).
    list = `<div class="lb2-card" data-role="rows">${b.rows.map((r) => `<button type="button" class="lb2-lr${pod(r)}${r.key === _meKey ? ' me' : ''}" style="grid-template-columns:${cols}" data-act="person" data-pi="${pIdx(r.key)}" data-rank="${r.rank}" data-tie="${r.tie ? 1 : 0}">
      ${med(r.rank, r.tie)}<span class="lb2-who"><span class="lb2-nm"><span class="lb2-nmt">${esc(nameOf(r.g))}</span>${mv(moveOf(b.id, r))}</span>${rowSub(r)}</span><span class="r lb2-val num">${r.html}</span></button>`).join('')}</div>`;
  }
  const rush = game === 'wayout' ? `<button type="button" class="lb2-chip" data-act="rush">${esc(t2('lb2_rush'))}</button>` : '';
  const ctrl = tb.rows.length && (tb.rows.length > 1 || tb.rows[0].length > 1)
    ? `<div class="lb2-ctrl">${tb.rows.map((row, ri) => `<div class="lb2-ctrlrow">${tabRowHTML(row, st, ri)}${ri === tb.rows.length - 1 ? rush : ''}</div>`).join('')}</div>`
    : (rush ? `<div class="lb2-ctrl"><div class="lb2-ctrlrow">${rush}</div></div>` : '');
  const me = b.rows.find((r) => r.key === _meKey) || null;
  const meName = esc(nameOf(meGroup() || { name: (loadProfile() || {}).name }));
  const pinCols = '44px minmax(0,1fr) auto';
  let pin;
  if (me) {
    pin = `<div class="lb2-pin" style="grid-template-columns:${pinCols}"><span class="c num lb2-pinrank">${me.rank <= 3 ? medal(me.rank, 'sm') : (me.tie ? '=' : '#') + me.rank}</span>
      <span class="lb2-grow"><span class="lb2-nm"><b class="lb2-nmt">${meName}</b>${mv(moveOf(b.id, me))}</span><span class="lb2-gap num">${esc(pinLine(b, me))}</span></span>
      <span class="r lb2-val num">${me.html}</span></div>`;
  } else {
    const play = playable(game) ? `<button type="button" class="lb2-play sm" data-act="play" data-game="${esc(game)}">${esc(t2('lb2_play'))}</button>` : '';
    pin = `<div class="lb2-pin" style="grid-template-columns:${pinCols}"><span class="c num lb2-pinrank">–</span>
      <span class="lb2-grow"><b class="lb2-nmt">${meName}</b><span class="lb2-gap">${esc(t2('lb2_not_ranked'))}</span></span>
      <span class="lb2-pinplay">${play}</span></div>`;
  }
  const recs = b.records ? `<div class="lb2-recs">${b.records}</div>` : '';
  return `${bar}${b.rows.length && b.unit ? head : ''}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body">${list}${recs}</div></div>${ctrl}${pin}`;
}

// --- Hall of Fame: medals from the old one-standing-per-game, nothing else ---------------------------------
const tiedIn = (rows) => { const n = {}; for (const r of rows) n[r.rank] = (n[r.rank] || 0) + 1; return (r) => n[r.rank] > 1; };
let _hofView = 'medals';
/** Hall of Fame's second view: the old By Player list as it opened (category All, by Wins), unchanged. */
function winsHTML() {
  const rows = lb2Players(_people);
  const tie = tiedIn(rows);
  const cols = '44px minmax(0,1fr) auto';
  const list = rows.length ? `<div class="lb2-card" data-role="rows">${rows.map((r) => `<button type="button" class="lb2-lr${pod(r)}${r.key === _meKey ? ' me' : ''}" style="grid-template-columns:${cols}" data-act="person" data-pi="${pIdx(r.key)}" data-rank="${r.rank}" data-tie="${r.tie ? 1 : 0}">
      ${med(r.rank, r.tie)}<span class="lb2-who"><span class="lb2-nm"><span class="lb2-nmt">${esc(nameOf(r.g))}</span></span><span class="lb2-sub lb2-cat">${r.cat}</span></span><span class="r lb2-val num">${fmt(r.wins)}</span></button>`).join('')}</div>`
    : `<div class="lb2-card"><p class="lb2-empty-t">${esc(t2('lb2_nothing'))}</p></div>`;
  const me = rows.find((r) => r.key === _meKey) || null;
  const meName = esc(nameOf(meGroup() || { name: (loadProfile() || {}).name }));
  const head = `<div class="lb2-cols" style="grid-template-columns:${cols}"><span></span><span></span><span class="r">${esc(cap(t('lb_wins_unit')))}</span></div>`;
  const pin = `<div class="lb2-pin" style="grid-template-columns:${cols}"><span class="c num lb2-pinrank">${me ? (me.rank <= 3 ? medal(me.rank, 'sm') : (me.tie ? '=' : '#') + me.rank) : '–'}</span>
    <span class="lb2-grow"><b class="lb2-nmt">${meName}</b>${me ? `<span class="lb2-gap num">${esc(t('lb_played_count', { n: fmt(me.played) }))}</span>` : `<span class="lb2-gap">${esc(t2('lb2_not_ranked'))}</span>`}</span>
    <span class="r lb2-val num">${me ? fmt(me.wins) : ''}</span></div>`;
  return `${headHTML(hofSeg())}${head}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body">${list}</div></div>${pin}`;
}
const hofSeg = () => seg([{ v: 'medals', label: t2('lb2_medals') }, { v: 'wins', label: t('lb_sort_wins') }], _hofView, 'hofview');
function hofHTML() {
  if (_hofView === 'wins') return winsHTML();
  const rows = _model.hof;
  const tie = tiedIn(rows);
  const bid = 'hof~all';
  const cols = '44px minmax(0,1fr) 46px 46px 46px';
  const m = (n) => `<span class="c">${medal(n, 'xs')}</span>`;
  const head = `<div class="lb2-cols" style="grid-template-columns:${cols}"><span class="c">#</span><span>${esc(t2('lb2_col_player'))}</span>${m(1)}${m(2)}${m(3)}</div>`;
  const list = rows.length ? `<div class="lb2-card">${rows.map((r) => `<button type="button" class="lb2-lr${pod(r)}${r.key === _meKey ? ' me' : ''}" style="grid-template-columns:${cols}" data-act="person" data-pi="${pIdx(r.key)}">
      ${med(r.rank, tie(r))}<span class="lb2-nm"><span class="lb2-nmt">${esc(nameOf(r))}</span>${mv(moveOf(bid, r))}</span>
      <span class="c num lb2-strong">${r.firsts}</span><span class="c lb2-gm num">${r.seconds}</span><span class="c lb2-gm num">${r.thirds}</span></button>`).join('')}</div>`
    : `<div class="lb2-card"><p class="lb2-empty-t">${esc(t2('lb2_nothing'))}</p></div>`;
  const me = rows.find((r) => r.key === _meKey) || null;
  const meName = esc(nameOf(meGroup() || { name: (loadProfile() || {}).name }));
  let gap;
  if (!me) gap = t2('lb2_not_ranked');
  else if (me.rank === 1) gap = t2('lb2_first');
  else { const above = B.aboveOf(rows, me); gap = t2('lb2_pass', { n: B.firstsToPass(me, above), r: above.rank }); }
  const pin = `<div class="lb2-pin" style="grid-template-columns:${cols}"><span class="c num lb2-pinrank">${me ? (me.rank <= 3 ? medal(me.rank, 'sm') : (tie(me) ? '=' : '#') + me.rank) : '–'}</span>
    <span class="lb2-grow"><span class="lb2-nm"><b class="lb2-nmt">${meName}</b>${me ? mv(moveOf(bid, me)) : ''}</span><span class="lb2-gap num">${esc(gap)}</span></span>
    <span class="c num lb2-strong">${me ? me.firsts : ''}</span><span class="c num">${me ? me.seconds : ''}</span><span class="c num">${me ? me.thirds : ''}</span></div>`;
  return `${headHTML(hofSeg())}${head}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body">${list}</div></div>${pin}`;
}
function hofRankOf(key) { const r = _model.hof.find((x) => x.key === key); return r ? r.rank : null; }

// --- Me: the old You tab in the new look ------------------------------------------------------------------
function valHTML(v) { return `${shape(v.tier)}<span>${esc(v.text)}</span>`; }
function gapWords(p) {
  if (!p) return '';
  if (p.k === 'tier') return t('lb_gap', { k: 'tier', v: p.v, tier: p.tier });
  return t('lb_gap', { k: p.k, v: p.v, n: p.n });
}
function meHTML() {
  const R = lb2Records(_people, _meKey);
  const hr = hofRankOf(_meKey);
  const pg = lb2PlayerGames(_people, _meKey);
  const tiles = `<div class="lb2-tiles">
    <div class="lb2-tile"><b class="num">${R.held.length}<small>/${R.withRecord}</small></b><span>${esc(t2('lb2_records_tile'))}</span></div>
    <button type="button" class="lb2-tile" data-act="tab" data-v="hof"><b class="num">${hr ? '#' + hr : '–'}</b><span>${esc(t2('lb2_hof_tile'))}</span></button>
    <div class="lb2-tile"><b class="num">${pg ? pg.games.length : 0}</b><span>${esc(t2('lb2_games_tile'))}</span></div></div>`;
  const held = R.held.length ? `<div><h2 class="lb2-h2">${esc(t2('lb2_hold_h'))}</h2><div class="lb2-card">${R.held.map((x) => `<button type="button" class="lb2-row sm" data-act="game" data-game="${esc(x.id)}">
      ${art(x.id)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(x.id))}</span></span><span class="lb2-right">${medal(1, 'xs')}<span class="lb2-strong lb2-rv num">${valHTML(x.mine)}</span></span></button>`).join('')}</div></div>` : '';
  const close = R.close.length ? `<div><h2 class="lb2-h2">${esc(t2('lb2_close_h'))}</h2><div class="lb2-card">${R.close.map((x) => {
    const gw = gapWords(x.gap);
    return `<button type="button" class="lb2-row lb2-close" data-act="game" data-game="${esc(x.id)}">
      ${art(x.id)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(x.id))}</span>
      <span class="lb2-t2 lb2-vsr">${medal(1, 'xs')}<span class="lb2-nmt">${esc(nameOf(x.rec))}</span> <span class="lb2-rv num">${valHTML(x.recVal)}</span></span>
      ${gw ? `<span class="lb2-gapw">${esc(gw)}</span>` : ''}</span>
      <span class="lb2-right"><span class="lb2-rv num lb2-strong">${valHTML(x.mine)}</span>${placeHTML(defPlace(x.id, _meKey))}</span></button>`;
  }).join('')}</div></div>` : '';
  const fresh = R.fresh.length ? `<div><h2 class="lb2-h2">${esc(t2('lb2_fresh_h'))}</h2><div class="lb2-card">${R.fresh.map((x) => `<div class="lb2-row sm">
      ${art(x.id)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(x.id))}</span><span class="lb2-t2">${medal(1, 'xs')}${esc(nameOf(x.rec))} ${valHTML(x.recVal)}</span></span>
      ${playable(x.id) ? `<button type="button" class="lb2-play sm" data-act="play" data-game="${esc(x.id)}">${esc(t2('lb2_play'))}</button>` : ''}</div>`).join('')}</div></div>` : '';
  const body = R.me ? tiles + held + close + fresh : `<div class="lb2-card"><p class="lb2-empty-t">${esc(t2('lb2_nothing'))}</p></div>`;
  return `${headHTML()}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body lb2-pad">${body}</div></div>`;
}

// --- Player: every game they played, their place and their number ----------------------------------------
const _msgTo = [];
function playerHTML(top) {
  const pg = lb2PlayerGames(_people, top.key);
  const g = (pg && pg.g) || _people.find((x) => x.key === top.key) || {};
  const places = B.personPlaces(_model.standings, top.key);
  const hr = hofRankOf(top.key);
  const face = String(g.emoji || '').trim() || esc(nameOf(g).slice(0, 1).toUpperCase());
  const code = typeof g.playerId === 'string' ? g.playerId.trim().toUpperCase() : '';
  let msg = '';
  if (code && top.key !== _meKey) {
    if (_msgTo.length > 200) _msgTo.length = 0;
    const mi = _msgTo.push({ code, name: nameOf(g), emoji: g.emoji || '🙂' }) - 1;
    msg = `<button type="button" class="lb2-icon lb2-msg" data-act="msg" data-mi="${mi}" aria-label="${esc(t2('lb2_message'))}">${SVG.chat}</button>`;
  }
  const bar = `<div class="lb2-bar"><button type="button" class="lb2-icon" data-act="back" aria-label="${esc(t2('lb2_back'))}">${SVG.back}</button>
    <span class="lb2-face">${esc(face)}</span><span class="lb2-grow lb2-pl"><h1>${esc(nameOf(g))}</h1><span class="lb2-t2 num">${pg ? esc(`${t('lb_played_count', { n: fmt(pg.played) })} · ${fmt(pg.wins)} ${t('lb_wins_unit')}`) : ''}</span></span>${msg}</div>`;
  const tag = String(g.message || '').trim();
  const nHeld = Object.values(places.place).filter((p) => p.rank === 1 && !p.noMedal).length;
  const tiles = `<div class="lb2-tiles"><div class="lb2-tile"><b class="num">${nHeld}</b><span>${esc(t2('lb2_records_tile'))}</span></div>
    <div class="lb2-tile"><b class="num">${hr ? '#' + hr : '–'}</b><span>${esc(t2('lb2_hof_tile'))}</span></div>
    <div class="lb2-tile"><b class="num">${pg ? pg.games.length : 0}</b><span>${esc(t2('lb2_games_tile'))}</span></div></div>`;
  const games = pg && pg.games.length ? `<div><h2 class="lb2-h2">${esc(t2('lb2_games_h'))}</h2><div class="lb2-card">${pg.games.map((x) => `<button type="button" class="lb2-row sm" data-act="game" data-game="${esc(x.id)}">
      ${art(x.id)}<span class="lb2-grow"><span class="lb2-t1">${esc(title(x.id))}</span><span class="lb2-t2">${esc(t('lb_played_count', { n: x.plays }))}</span></span>
      <span class="lb2-right"><span class="lb2-rv num">${valHTML(x)}</span>${placeHTML(defPlace(x.id, top.key))}</span></button>`).join('')}</div></div>` : '';
  return `${bar}<div class="lb2-scroll" data-role="scroll"><div class="lb2-body lb2-pad">${tag ? `<p class="lb2-tag">${esc(tag)}</p>` : ''}${tiles}${games}</div></div>`;
}

// --- render ----------------------------------------------------------------------------------------------
function screenHTML() {
  _pidx = [];
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
  _stack.push({ kind: 'board', game, sel: sel || null });
  render();
}
function openPerson(key) {
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
  render();
}
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || !_host || !_host.contains(el)) return;
  const act = el.dataset.act, v = el.dataset.v;
  if (act === 'noop') return;
  switch (act) {
    case 'close': closeLeaderboard2(); return;
    case 'tab': _stack = []; _tab = v; render(); return;
    case 'chip': _chip = v; _q = ''; render(); return;
    case 'game': openGame(el.dataset.game); return;
    case 'person': { const k = _pidx[Number(el.dataset.pi)]; if (k != null) openPerson(k); return; }
    case 'back': if (!stepBack()) closeLeaderboard2(); return;
    case 'fav': { const top = _stack[_stack.length - 1]; if (top) { toggleFavorite(hubIdOf(top.game)); render({ keepScroll: true }); } return; }
    case 'hofview': _hofView = v === 'wins' ? 'wins' : 'medals'; render(); return;
    case 'stab': {
      const top = _stack[_stack.length - 1];
      if (!top || top.kind !== 'board') return;
      const [ri, i] = String(v).split(':').map(Number);
      const tab = (tabsOf(top.game).rows[ri] || [])[i];
      if (tab) setSel(tab.st);
      return;
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
  document.documentElement.classList.remove('gh-lb2-open');
  if (_offVp) { try { _offVp(); } catch { /* gone */ } _offVp = null; }
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
  _tab = 'boards'; _chip = null; _q = ''; _hofView = 'medals'; _stack = []; _entryGame = null;
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
html.gh-lb2-open,html.gh-lb2-open body{overflow:hidden;overscroll-behavior:none}
.lb2{position:fixed;top:0;left:0;right:0;bottom:auto;height:100vh;z-index:300;display:flex;justify-content:center;background:var(--l2-bg);color:var(--l2-text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overscroll-behavior:contain;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);-webkit-tap-highlight-color:transparent}
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
.lb2-ic{width:64px;height:36px;flex-shrink:0;border-radius:8px;overflow:hidden;background:var(--l2-chip);display:flex;align-items:center;justify-content:center}
.lb2-ic.hd{width:56px;height:32px;margin-left:2px}
.lb2-ic svg{width:100%;height:100%;display:block}
.lb2-grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lb2-t1{font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-t2{font-size:14px;color:var(--l2-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb2-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0}
.lb2-right{flex-direction:row;align-items:center;gap:8px}
.lb2-best{font-size:16px;font-weight:700;color:var(--l2-muted);min-width:30px;text-align:center}
.lb2-medal{display:block;width:30px;height:36px;margin:0 auto;flex-shrink:0}
.lb2-medal svg{width:100%;height:100%;display:block}
.lb2-medal.sm{width:26px;height:31px;margin:0}
.lb2-medal.xs{width:22px;height:26px}
.lb2-medal.big{width:56px;height:67px}
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

.lb2-who{display:flex;flex-direction:column;gap:2px;min-width:0}
.lb2-sub{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:13px;color:var(--l2-muted);line-height:1.25}
.lb2-lr.me .lb2-sub{color:inherit}
.lb2-tierw{display:inline-flex;align-items:center;gap:3px;font-weight:600}
.lb2-tierw .lb2-shape{width:12px;height:12px}
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
.lb2-close{align-items:flex-start;padding-top:10px;padding-bottom:10px}
.lb2-close .lb2-right{align-self:center}
.lb2-vs{display:flex;align-items:center;gap:10px;color:var(--l2-text)}
.lb2-vsr{display:inline-flex;align-items:center;gap:4px;min-width:0;color:var(--l2-muted)}
.lb2-vsr{flex-wrap:wrap;white-space:normal}
.lb2-vsr .lb2-nmt{max-width:none;white-space:normal;overflow:visible}
.lb2-close .lb2-right{flex-direction:column;align-items:flex-end;gap:4px}
.lb2-vs .lb2-medal{margin:0}
.lb2-gapw{font-size:13px;font-weight:700;color:var(--l2-accent);line-height:1.25}

.lb2-listhead{display:flex;justify-content:flex-end;padding:0 14px;margin-bottom:-8px;font-size:13px;font-weight:600;color:var(--l2-muted)}
.lb2-listhead span{max-width:50%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.lb2-pick{flex:1;min-width:0;position:relative;display:flex}
.lb2-pick select{flex:1;min-width:0;min-height:44px;border:0;border-radius:12px;padding:0 36px 0 14px;font:inherit;font-size:15px;font-weight:600;background:var(--l2-seg);color:var(--l2-text);-webkit-appearance:none;appearance:none}
.lb2-pick::after{content:'';position:absolute;right:16px;top:50%;width:8px;height:8px;margin-top:-6px;border-right:2px solid var(--l2-muted);border-bottom:2px solid var(--l2-muted);transform:rotate(45deg);pointer-events:none}

.lb2-cat .lb-pcats{margin:0}
`;
  document.head.appendChild(el);
}

export default { openLeaderboard2, closeLeaderboard2 };
