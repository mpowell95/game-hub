// leaderboard-ui.js - the public "Leaderboard" overlay: every player sees everyone's record and
// plays. Reads the synced players/ node live (watchPlayers) and aggregates it into ONE row per
// person by player code (js/players-agg.js), so a person's phone + laptop count once. Self-contained
// (injects its own lb- CSS once); mirrors game-stats-ui.js. Opened from the hub header.
//
// READ-ONLY consumer. This file never writes, migrates or normalizes stored data - the win/tier
// maths lives in js/leaderboard-rank.js and is a pure read-time display transform over the stored
// shape.
//
// 2026-07-23 redesign (HANDOFF-LEADERBOARD-REDESIGN.md): WINS ONLY everywhere here. No W-L, no
// losses, no win rate, no rating. Losses and full records stay visible on My Stats (game-stats-ui.js)
// - that is the surface satisfying THE LAW rule 1 for the raw breakdown; this overlay is the
// bragging wall. The 0-100 rating (leaderboard-rank.js's rankPlayers/ratePlayer/soloRating) is
// retired from DISPLAY only - the module and its tests are untouched and still green, kept for a
// possible future dedicated rating page (Matt's call). This file now only imports record/bucketsOf/
// tierMix/tierRows/cmp from it.
//
// Two segments (By Player / By Game, renamed from Standings/Games) plus a shared difficulty pill
// row (All/Beginner/Intermediate/Pro/Expert) that filters both. Colorblind-safe: pills carry a
// SHAPE per tier (circle/square/diamond/double-diamond), never hue alone; the viewer's own row uses
// a border highlight, never color alone.

import { aggregatePlayers, buildIdentity } from './players-agg.js';
import { watchPlayers } from './stats-net.js';
import { loadProfile } from './profile-store.js';
import { statsId } from './game-stats.js';
import { bucketsOf, tierMix } from './leaderboard-rank.js';
import { TIERS } from './difficulty-tiers.js';
import { GAME_ART } from './game-art.js';
import { makeT } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
// difficulty-tiers.js is READ-path-only and out of scope for i18n edits (its TIER_LABEL is
// English-only, used elsewhere); this maps the same 1-4 tiers onto our own translated keys instead.
const TIER_LABEL_KEY = { 1: 'gs_diff_beginner', 2: 'gs_diff_intermediate', 3: 'gs_diff_pro', 4: 'gs_diff_expert' };
// Ski-slope shape language (colorblind-safe: shape carries the meaning, color is secondary).
const TIER_COLOR = { 1: '#2e9e44', 2: '#1F5FA8', 3: '#1c2430', 4: '#1c2430' };

// Old test/debug device records. They stay in Firebase untouched (no data is ever deleted); they are
// simply never rendered. Matched by deviceId prefix.
const HIDDEN_PREFIX = ['4392d978', 'f8ad1b82', 'zzz-prev'];   // "Tester", "test1", preview bot

// Every game, ALPHABETICAL BY TITLE - the hub launcher's convention (CLAUDE.md, "Adding a game",
// item 5). Fixed order: a tile never moves between visits, unlike the old plays-sorted tab strip.
// `id` is the STATS id (game-stats.js's GAMES); js/game-art.js is keyed by the HUB registry id, so
// STATS_TO_HUB below maps between them for the tile art thumbnails.
const GAME_META = [
  { id: 'ballrun', label: 'Ball Run' },
  { id: 'boggle', label: 'Boggle' },
  { id: 'chinchon', label: 'Chinchón' },
  { id: 'connect4', label: 'Connect 4' },
  { id: 'dotsboxes', label: 'Dots and Boxes' },
  { id: 'escoba', label: 'Escoba' },
  { id: 'filler', label: 'Filler' },
  { id: 'mancala', label: 'Mancala' },
  { id: 'business', label: 'Monopoly Deal' },
  { id: 'nutsbolts', label: 'Nuts & Bolts' },
  { id: 'parchis', label: 'Parchís' },
  { id: 'snake', label: 'Snake' },
  { id: 'tictactoe', label: 'Tic Tac Toe' },
].sort((a, b) => a.label.localeCompare(b.label));
const LABEL = Object.fromEntries(GAME_META.map((g) => [g.id, g.label]));
const ALL_IDS = GAME_META.map((g) => g.id);
// Verified against js/hub.js's GAMES registry (root CLAUDE.md, "Adding a game" item 7 warning).
const STATS_TO_HUB = {
  connect4: 'connect-four', nutsbolts: 'nuts-bolts', tictactoe: 'tic-tac-toe',
  dotsboxes: 'dots-boxes', ballrun: 'ball-run', business: 'business-deal',
};
const hubIdOf = (id) => STATS_TO_HUB[id] || id;
const UNIT_KEY = { ballrun: 'lb_unit_obstacles', snake: 'lb_unit_longest', nutsbolts: 'lb_unit_solved' };
const unitKeyOf = (id) => UNIT_KEY[id] || 'lb_unit_wins';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function labelOf(id) { return LABEL[id] || id; }

// --- identity chrome --------------------------------------------------------
function rankName(g) { return esc(g.name || ''); }

/** The player's synced profile emoji (aggregated in players-agg.js), falling back to their first
 *  initial in a neutral circle. */
function avatarHTML(g) {
  const emoji = (g.emoji || '').trim();
  if (emoji) return `<span class="lb-av" aria-hidden="true">${esc(emoji)}</span>`;
  const initial = ((g.name || '?').trim()[0] || '?').toUpperCase();
  return `<span class="lb-av is-initial" aria-hidden="true">${esc(initial)}</span>`;
}

// --- difficulty tier maths ---------------------------------------------------
// Solo games (Ball Run/Nuts & Bolts/Snake) ALSO populate total/byDiff with the standard
// {played,won,lost} bucket shape (game-stats.js's bumpTotals path) - every recordX() call bumps it
// alongside its own br/nb/sn sub-object. So winsAtTier/playsAtTier below work generically across
// EVERY game: a solo run/solve counts as a win at its tier (played === won for a solo game, lost
// never touched), matching the handoff's "a solve/run at a tier is a win at that tier".

/** Sum of wins across `gameIds`, at `tier` (1-4), or every tier + unranked/legacy when tier is null.
 *  null-tier (unranked/legacy) buckets only ever count under the `tier === null` (All) case - by
 *  definition they belong to no tier, so they must not vanish from the default view (THE LAW rule 1). */
function winsAtTier(group, gameIds, tier) {
  let w = 0;
  for (const id of gameIds) for (const b of bucketsOf(group.games[id])) if (tier == null || b.tier === tier) w += b.wins;
  return w;
}
function playsAtTier(group, gameIds, tier) {
  let n = 0;
  for (const id of gameIds) for (const b of bucketsOf(group.games[id])) if (tier == null || b.tier === tier) n += b.played;
  return n;
}
/** Sorted tiers (1-4) this player/field has ANY play in, across `gameIds`. */
function tiersPresent(group, gameIds) {
  const mix = tierMix(group, gameIds);
  return TIERS.filter((k) => mix[k] > 0);
}
function fieldTiersPresent(list, gameIds) {
  const seen = new Set();
  for (const g of list) for (const k of tiersPresent(g, gameIds)) seen.add(k);
  return TIERS.filter((k) => seen.has(k));
}

// Ball Run / Snake: the shared metric is a BEST value (obstacles/length), not a play count, so it
// needs its own per-tier lookup into bestObstaclesByDiff/bestLenByDiff - these are the only two
// games where "wins at a tier" and "the number this game is ranked by" are genuinely different
// things (see js/leaderboard-rank.js's soloRating comment for the same distinction).
const BR_TIER_KEYS = ['easy', 'medium', 'hard'];
const SN_TIER_KEYS = ['easy', 'medium', 'hard'];
function brBestAt(g, tier) {
  const br = g.games.ballrun.br;
  if (!br) return 0;
  if (tier == null) return br.bestObstacles | 0;
  const key = BR_TIER_KEYS[tier - 1];
  return key ? (br.bestObstaclesByDiff || {})[key] | 0 : 0;
}
function snBestAt(g, tier) {
  const sn = (g.games.snake || {}).sn;
  if (!sn) return 0;
  if (tier == null) return sn.bestLen | 0;
  const key = SN_TIER_KEYS[tier - 1];
  return key ? (sn.bestLenByDiff || {})[key] | 0 : 0;
}
/** The number a game's leaderboard is ranked by, at `tier`. Nuts & Bolts needs no special case:
 *  every solve increments both `played` and `won` by exactly 1 (recordNutsBolts), so winsAtTier
 *  already equals "levels solved at this tier". */
function gameMetricAt(g, id, tier) {
  if (id === 'ballrun') return brBestAt(g, tier);
  if (id === 'snake') return snBestAt(g, tier);
  return winsAtTier(g, [id], tier);
}

// --- difficulty pills --------------------------------------------------------
function diffShapeSVG(tier) {
  if (tier === 1) return '<svg viewBox="0 0 20 20" class="lb-dshape" aria-hidden="true"><circle cx="10" cy="10" r="8"/></svg>';
  if (tier === 2) return '<svg viewBox="0 0 20 20" class="lb-dshape" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="3"/></svg>';
  if (tier === 3) return '<svg viewBox="0 0 20 20" class="lb-dshape" aria-hidden="true"><rect x="4.9" y="4.9" width="10.2" height="10.2" rx="1.6" transform="rotate(45 10 10)"/></svg>';
  if (tier === 4) return '<svg viewBox="0 0 34 20" class="lb-dshape lb-dshape-x2" aria-hidden="true"><rect x="1.9" y="4.9" width="10.2" height="10.2" rx="1.6" transform="rotate(45 7 10)"/><rect x="21.9" y="4.9" width="10.2" height="10.2" rx="1.6" transform="rotate(45 27 10)"/></svg>';
  return '';
}
const DIFF_PILLS = [
  { tier: null, labelKey: 'lb_diff_all' },
  { tier: 1, labelKey: 'gs_diff_beginner' },
  { tier: 2, labelKey: 'gs_diff_intermediate' },
  { tier: 3, labelKey: 'gs_diff_pro' },
  { tier: 4, labelKey: 'gs_diff_expert' },
];

/** The filter row, single-select, shared between By Player and By Game (and carried into a game
 *  page). `showExpert` hides the Expert pill where tier-4 data cannot exist (a specific game with
 *  no tier-4 bucket in the field); By Player/By Game always show it (cross-game context). */
function pillsHTML(showExpert) {
  const items = showExpert ? DIFF_PILLS : DIFF_PILLS.filter((p) => p.tier !== 4);
  return `<div class="lb-pills" role="group" aria-label="${t('lb_diff_filter_aria')}">${items.map((p) => {
    const active = _diff === p.tier;
    const color = p.tier ? TIER_COLOR[p.tier] : '#1c2430';
    return `<button type="button" class="lb-pill${active ? ' is-active' : ''}" data-tier="${p.tier == null ? '' : p.tier}" style="--lb-pill-color:${color}" aria-pressed="${active}">${p.tier ? diffShapeSVG(p.tier) : ''}<span>${esc(t(p.labelKey))}</span></button>`;
  }).join('')}</div>`;
}

/** Mini tile row: one tile per tier in `tiers`, showing `valueFn(tier)`'s win/metric count.
 *  `valueFn` returning null renders a muted dash (game page: alignment across cards - a tier the
 *  field plays but this player hasn't gets a "-" tile rather than being omitted, so every card in
 *  the list has the same tile COUNT). On By Player, `tiers` is only the tiers this player has
 *  played, so `valueFn` never returns null there and no dash ever shows on that tab. */
function miniTilesHTML(tiers, valueFn) {
  if (!tiers.length) return '';
  return `<div class="lb-tiles">${tiers.map((tier) => {
    const v = valueFn(tier);
    const sel = _diff === tier ? ' is-sel' : '';
    const empty = v == null ? ' is-empty' : '';
    return `<span class="lb-tile2${sel}${empty}" style="--lb-pill-color:${TIER_COLOR[tier]}" title="${esc(t(TIER_LABEL_KEY[tier]))}">${diffShapeSVG(tier)}<b>${v == null ? '&mdash;' : v}</b></span>`;
  }).join('')}</div>`;
}

// --- By Player ---------------------------------------------------------------
function medalClass(i) { return i === 0 ? ' is-gold' : i === 1 ? ' is-silver' : i === 2 ? ' is-bronze' : ''; }

function playerCardHTML(g, i, wins, games, tilesHtml) {
  const me = g.key === _meKey ? ' is-me' : '';
  return `<div class="lb-pcard${me}"${me ? ' aria-current="true"' : ''}>
    <div class="lb-pcard-row">
      <span class="lb-medal${medalClass(i)}">${i + 1}</span>
      ${avatarHTML(g)}
      <span class="lb-pname">${rankName(g)}</span>
      <span class="lb-pnum"><b>${wins}</b><span>${t('lb_wins_unit')}</span></span>
    </div>
    <div class="lb-pmeta">${t('lb_games_count', { n: games })}</div>
    ${tilesHtml}
  </div>`;
}

function playerListHTML(list) {
  const rows = list.filter((g) => playsAtTier(g, ALL_IDS, _diff) > 0);
  if (!rows.length) return emptyState(t('lb_empty_all'));
  rows.sort((a, b) => {
    const w = winsAtTier(b, ALL_IDS, _diff) - winsAtTier(a, ALL_IDS, _diff);
    if (w) return w;
    const gg = playsAtTier(a, ALL_IDS, _diff) - playsAtTier(b, ALL_IDS, _diff);   // fewer games wins ties
    if (gg) return gg;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  return `<div class="lb-plist">${rows.map((g, i) => {
    const wins = winsAtTier(g, ALL_IDS, _diff);
    const games = playsAtTier(g, ALL_IDS, _diff);
    const tiers = tiersPresent(g, ALL_IDS);
    const tiles = miniTilesHTML(tiers, (tier) => winsAtTier(g, ALL_IDS, tier));
    return playerCardHTML(g, i, wins, games, tiles);
  }).join('')}</div>`;
}

// --- By Game ------------------------------------------------------------------
function gameListHTML(list) {
  const rows = GAME_META.map((meta) => {
    const leaders = list.filter((g) => gameMetricAt(g, meta.id, _diff) > 0)
      .sort((a, b) => gameMetricAt(b, meta.id, _diff) - gameMetricAt(a, meta.id, _diff) || (b.updatedAt || 0) - (a.updatedAt || 0));
    const lead = leaders.length ? leaders[0] : null;
    if (!lead && _diff != null) return '';   // drops off the list entirely under a specific tier
    const art = GAME_ART[hubIdOf(meta.id)] || '';
    const body = lead
      ? `<span class="lb-glead">${avatarHTML(lead)}<span class="lb-glead-nm">${rankName(lead)}</span></span>`
      : `<span class="lb-glead lb-glead-empty">${t('lb_no_games_yet')}</span>`;
    const metric = lead
      ? `<span class="lb-gnum"><b>${gameMetricAt(lead, meta.id, _diff)}</b><span>${esc(t(unitKeyOf(meta.id)))}</span></span>`
      : `<span class="lb-gnum">&nbsp;</span>`;
    return `<button type="button" class="lb-grow" data-game="${meta.id}">
      <span class="lb-gart">${art}</span>
      <span class="lb-gmain"><span class="lb-gname">${esc(meta.label)}</span>${body}</span>
      ${metric}
      <span class="lb-gchev" aria-hidden="true">&rsaquo;</span>
    </button>`;
  }).filter(Boolean);
  if (!rows.length) return emptyState(t('lb_empty_all'));
  return `<div class="lb-glist">${rows.join('')}</div>`;
}

// --- game detail (drill-in from By Game) -------------------------------------
// Each game's own stored texture, aggregated by players-agg.js. Filter-INDEPENDENT (lifetime
// numbers; several - Chinchón closes, Boggle words - have no per-tier storage at all), shown as
// "who leads what" chips below the player cards.
const TEXTURE = {
  connect4: [
    { labelKey: 'lb_tex_wins_first', get: (g) => sumGrid(g.games.connect4.grid, 'player') },
    { labelKey: 'lb_tex_wins_second', get: (g) => sumGrid(g.games.connect4.grid, 'computer') },
  ],
  chinchon: [
    { labelKey: 'lb_tex_chinchons', get: (g) => ((g.games.chinchon.cc || {}).chinchons) | 0 },
    { labelKey: 'lb_tex_closes', get: (g) => ((g.games.chinchon.cc || {}).closed) | 0 },
    { labelKey: 'lb_tex_minus_tens', get: (g) => ((g.games.chinchon.cc || {}).minusTen) | 0 },
  ],
  escoba: [{ labelKey: 'lb_tex_escobas', get: (g) => ((g.games.escoba.es || {}).escobas) | 0 }],
  nutsbolts: [
    { labelKey: 'lb_tex_best_level', get: (g) => g.solo.bestLevel | 0 },
    { labelKey: 'lb_tex_levels_solved', get: (g) => g.solo.solved | 0 },
  ],
  ballrun: [
    { labelKey: 'lb_tex_best_obstacles', get: (g) => ((g.games.ballrun.br || {}).bestObstacles) | 0 },
    { labelKey: 'lb_tex_total_runs', get: (g) => ((g.games.ballrun.br || {}).runs) | 0 },
  ],
  dotsboxes: [
    { labelKey: 'lb_tex_boxes_claimed', get: (g) => ((g.games.dotsboxes.db || {}).boxes) | 0 },
    { labelKey: 'lb_tex_longest_chain', get: (g) => ((g.games.dotsboxes.db || {}).bestChain) | 0 },
  ],
  boggle: [
    { labelKey: 'lb_tex_best_score', get: (g) => ((g.games.boggle.bg || {}).bestScore) | 0 },
    { labelKey: 'lb_tex_words_found', get: (g) => ((g.games.boggle.bg || {}).words) | 0 },
    // The only text-valued chip: the longest word is shown by name, not just its length, matching
    // My Stats. players-agg.js carries {word,len} as a unit so the text always fits the length.
    {
      labelKey: 'lb_tex_longest_word',
      get: (g) => ((g.games.boggle.bg || {}).longestWord || {}).len | 0,
      show: (g) => ((g.games.boggle.bg || {}).longestWord || {}).word || '',
    },
  ],
  snake: [
    { labelKey: 'lb_tex_longest_snake', get: (g) => (((g.games.snake || {}).sn || {}).bestLen) | 0 },
    { labelKey: 'lb_tex_total_runs', get: (g) => (((g.games.snake || {}).sn || {}).runs) | 0 },
  ],
  tictactoe: [
    { labelKey: 'lb_tex_classic_played', get: (g) => (((g.games.tictactoe.tt || {}).classic) || {}).played | 0 },
    { labelKey: 'lb_tex_ultimate_played', get: (g) => (((g.games.tictactoe.tt || {}).ultimate) || {}).played | 0 },
    {
      labelKey: 'lb_tex_draws',
      get: (g) => {
        const tt = g.games.tictactoe.tt || {};
        return ((tt.classic || {}).tied | 0) + ((tt.ultimate || {}).tied | 0);
      },
    },
  ],
};
const CHIP_TINTS = ['a', 'b', 'c'];

function sumGrid(grid, side) {
  if (!grid || !grid[side]) return 0;
  let n = 0;
  for (const d of Object.keys(grid[side])) n += (grid[side][d] || {}).w | 0;
  return n;
}

function textureHTML(list, id) {
  const specs = TEXTURE[id];
  if (!specs) return '';
  const chips = [];
  specs.forEach((spec, i) => {
    let best = null;
    for (const g of list) {
      const v = spec.get(g) | 0;
      if (v > 0 && (!best || v > best.v)) best = { v, g };
    }
    if (!best) return;
    // `show` lets a chip rank on a number but DISPLAY something else (Boggle's longest word).
    const shown = spec.show ? esc(spec.show(best.g) || String(best.v)) : String(best.v);
    const tint = CHIP_TINTS[i % CHIP_TINTS.length];
    chips.push(`<div class="lb-chip lb-chip-${tint}"><b>${shown}</b><span>${esc(t(spec.labelKey))}</span><em>${avatarHTML(best.g)}${rankName(best.g)}</em></div>`);
  });
  if (!chips.length) return '';
  return `<h3 class="lb-h3">${t('lb_who_leads_h')}</h3><div class="lb-chips">${chips.join('')}</div>`;
}

function gameDetail(list, id) {
  const art = GAME_ART[hubIdOf(id)] || '';
  const head = `<div class="lb-detail-top">
    <button type="button" class="lb-back" data-role="lb-back">${t('lb_back_games')}</button>
    <span class="lb-detail-art">${art}</span>
    <h3 class="lb-detail-h">${esc(labelOf(id))}</h3>
  </div>`;
  const fieldTiers = fieldTiersPresent(list, [id]);
  const showExpert = fieldTiers.includes(4);
  const pills = pillsHTML(showExpert);
  const rows = list.filter((g) => playsAtTier(g, [id], _diff) > 0)
    .sort((a, b) => {
      const m = gameMetricAt(b, id, _diff) - gameMetricAt(a, id, _diff);
      if (m) return m;
      const p = playsAtTier(a, [id], _diff) - playsAtTier(b, [id], _diff);
      if (p) return p;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  const cardsHtml = rows.length
    ? `<div class="lb-plist">${rows.map((g, i) => {
        const metric = gameMetricAt(g, id, _diff);
        const games = playsAtTier(g, [id], _diff);
        const tiles = miniTilesHTML(fieldTiers, (tier) => (playsAtTier(g, [id], tier) > 0 ? gameMetricAt(g, id, tier) : null));
        return playerCardHTML(g, i, metric, games, tiles);
      }).join('')}</div>`
    : emptyState(t('lb_empty_game', { label: labelOf(id) }));
  return head + pills + cardsHtml + textureHTML(list, id);
}

// --- shared shell -------------------------------------------------------------
function emptyState(msg) { return `<p class="lb-none">${esc(msg)}</p>`; }

/** Fixed-height placeholder cards in the real card list's geometry, so the panel does not jump
 *  when live data lands (the repo's fixed-geometry convention, CLAUDE.md/Escoba's .eb-table note). */
function skeletonHTML(rows = 6) {
  const card = () => `<div class="lb-pcard is-skel">
    <div class="lb-pcard-row">
      <span class="lb-medal"><span class="lb-sk lb-sk-n"></span></span>
      <span class="lb-av is-initial"></span>
      <span class="lb-sk lb-sk-w" style="flex:1 1 auto"></span>
      <span class="lb-sk" style="width:34px"></span>
    </div>
  </div>`;
  return `<div class="lb-plist" aria-busy="true" aria-label="${t('lb_loading_aria')}">${Array.from({ length: rows }, card).join('')}</div>`;
}

/** Records to render: everything except the old test/debug devices (which stay stored, just hidden). */
function visibleRecords() {
  const out = {};
  for (const id of Object.keys(_all || {})) {
    if (HIDDEN_PREFIX.some((p) => id.startsWith(p))) continue;
    out[id] = _all[id];
  }
  return out;
}

function currentBody() {
  const recs = visibleRecords();
  // Only players who have set a profile name are listed. Devices with no name keep every game they
  // recorded; that history joins a player automatically the moment the device sets a name.
  const list = aggregatePlayers(recs).filter((g) => (g.name || '').trim());
  try { _meKey = buildIdentity(recs).keyFor(loadProfile() || {}, statsId()); } catch { /* keep */ }
  if (_game) return gameDetail(list, _game);
  return pillsHTML(true) + (_seg === 'games' ? gameListHTML(list) : playerListHTML(list));
}

let _host = null;
let _seg = 'players';       // 'players' | 'games'
let _game = null;           // non-null => showing that game's detail board
let _diff = null;           // null (All) | 1-4, shared between By Player/By Game and a game page
let _all = {};
let _meKey = '';
let _unsub = null;
let _connected = false;

const SEGMENTS = [{ id: 'players', labelKey: 'lb_by_player' }, { id: 'games', labelKey: 'lb_by_game' }];

function segsHTML() {
  return SEGMENTS.map((s) =>
    `<button type="button" class="lb-seg${s.id === _seg ? ' is-active' : ''}" data-seg="${s.id}"${s.id === _seg ? ' aria-current="true"' : ''}>${esc(t(s.labelKey))}</button>`
  ).join('');
}

function rerender() {
  if (!_host) return;
  const segEl = _host.querySelector('[data-role="lb-segs"]');
  const bodyEl = _host.querySelector('[data-role="lb-body"]');
  if (segEl) segEl.innerHTML = segsHTML();
  if (bodyEl) bodyEl.innerHTML = _connected ? currentBody() : skeletonHTML();
}

function renderOffline() {
  const bodyEl = _host && _host.querySelector('[data-role="lb-body"]');
  if (bodyEl) bodyEl.innerHTML = `<p class="lb-none">${t('lb_offline')}</p>`;
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (_game) { _game = null; rerender(); return; }   // Esc backs out of a game before closing
  closeLeaderboard();
}

function onClick(e) {
  if (e.target.closest('[data-role="lb-close"]')) { closeLeaderboard(); return; }
  if (e.target.closest('[data-role="lb-back"]')) { _game = null; rerender(); return; }
  const pill = e.target.closest('.lb-pill');
  if (pill) {
    const raw = pill.dataset.tier;
    _diff = raw === '' ? null : Number(raw);
    rerender();
    return;
  }
  const seg = e.target.closest('.lb-seg');
  if (seg && seg.dataset.seg) {
    const next = seg.dataset.seg;
    if (next === _seg && !_game) return;
    _seg = next; _game = null; rerender();
    return;
  }
  const row = e.target.closest('.lb-grow');
  if (row && row.dataset.game) { _game = row.dataset.game; rerender(); }
}

export function closeLeaderboard() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
  if (_host) { _host.remove(); _host = null; }
  document.removeEventListener('keydown', onKey);
}

export async function openLeaderboard() {
  ensureCss();
  closeLeaderboard();
  _seg = 'players';
  _game = null;
  _diff = null;   // resets to All every time the overlay opens (not persisted)
  _all = {};
  _connected = false;
  _meKey = '';   // resolved in currentBody() once records load (identity needs the whole graph)
  const host = document.createElement('div');
  host.className = 'lb-overlay';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', t('lb_dialog_aria'));
  host.innerHTML = `
    <div class="lb-scrim" data-role="lb-close"></div>
    <div class="lb-panel">
      <header class="lb-top">
        <div class="lb-top-row">
          <h2>${t('lb_title')}</h2>
          <button type="button" class="lb-x" data-role="lb-close" aria-label="${t('gs_close_aria')}">&times;</button>
        </div>
      </header>
      <nav class="lb-segs" data-role="lb-segs" aria-label="${t('lb_segs_aria')}">${segsHTML()}</nav>
      <div class="lb-body" data-role="lb-body">${skeletonHTML()}</div>
    </div>`;
  host.addEventListener('click', onClick);
  document.body.appendChild(host);
  _host = host;
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => host.classList.add('is-in'));

  // Subscribe live. Offline / unconfigured -> a friendly state; never throws.
  try {
    _unsub = await watchPlayers((all) => { _all = all || {}; _connected = true; rerender(); });
    if (!_host) { if (typeof _unsub === 'function') _unsub(); return; }
    // If watchPlayers never fires (unconfigured), show offline after a short grace.
    setTimeout(() => { if (_host && !_connected) renderOffline(); }, 3500);
  } catch { renderOffline(); }
}

function ensureCss() {
  if (document.getElementById('lb-css')) return;
  const el = document.createElement('style');
  el.id = 'lb-css';
  el.textContent = [
    '.lb-overlay{position:fixed;inset:0;z-index:300;opacity:0;transition:opacity .2s ease;overflow-y:auto}',
    '.lb-overlay.is-in{opacity:1}',
    '.lb-scrim{position:fixed;inset:0;background:rgba(9,24,48,.5)}',
    '.lb-panel{position:relative;width:100%;max-width:620px;margin:0 auto;min-height:100%;background:var(--hub-bg,#f4f6fb);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    // Title band: shared 44px height, 17px/600 title (unified chrome spec).
    '.lb-top{position:sticky;top:0;z-index:2;padding:max(env(safe-area-inset-top,0px),8px) 18px 0;background:rgba(255,255,255,.94);backdrop-filter:saturate(1.2) blur(6px);border-bottom:1px solid var(--hub-surface-2,#eef2f8)}',
    // The measured title band: exactly --gh-band-title tall, matching the hub top bar's
    // .hub-top-info and My Stats' .gs-top-row (the outer .lb-top only adds safe-area clearance).
    '.lb-top-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:var(--gh-band-title,44px)}',
    '.lb-top h2{margin:0;font-size:17px;font-weight:600;color:var(--hub-ink,#16243a)}',
    '.lb-x{appearance:none;border:1px solid var(--hub-surface-2,#eef2f8);background:var(--hub-surface,#fff);color:var(--hub-ink,#16243a);font-size:1.4rem;line-height:1;width:38px;height:38px;border-radius:10px;cursor:pointer}',
    // Control band: shared 36px height, 999px-radius pills, 12px text.
    '.lb-segs{display:flex;align-items:center;gap:6px;min-height:var(--gh-band-controls,36px);padding:0 16px;background:var(--hub-bg,#f4f6fb)}',
    '.lb-seg{flex:1 1 0;appearance:none;cursor:pointer;padding:8px 12px;font-size:12px;font-weight:700;color:var(--hub-muted,#5b6b82);background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:999px}',
    '.lb-seg.is-active{color:#fff;font-weight:800;background:var(--hub-ink,#16243a);border-color:var(--hub-ink,#16243a)}',
    // Filter band: shared 34px height, the difficulty pills.
    '.lb-pills{display:flex;align-items:center;gap:6px;min-height:var(--gh-band-filter,34px);padding:0 2px;overflow-x:auto;-webkit-overflow-scrolling:touch}',
    '.lb-pill{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;appearance:none;cursor:pointer;border:1.5px solid var(--lb-pill-color,#1c2430);color:var(--lb-pill-color,#1c2430);background:#fff;border-radius:999px;padding:5px 11px;font-size:.76rem;font-weight:800}',
    '.lb-pill.is-active{background:var(--lb-pill-color,#1c2430);color:#fff}',
    '.lb-dshape{width:11px;height:11px;fill:currentColor;display:block}',
    '.lb-dshape-x2{width:19px;height:11px}',
    '.lb-body{padding:10px 16px 8px}',
    '.lb-h3{margin:18px 0 8px;font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--hub-muted,#5b6b82)}',
    // Player/game-detail card list.
    '.lb-plist{display:flex;flex-direction:column;gap:9px;margin-top:8px}',
    '.lb-pcard{background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:14px;padding:11px 12px;box-shadow:0 4px 16px rgba(20,40,80,.06)}',
    '.lb-pcard.is-me{box-shadow:inset 0 0 0 1.5px var(--hub-accent,#1769d4),0 4px 16px rgba(20,40,80,.06)}',
    '.lb-pcard.is-skel{opacity:.65}',
    '.lb-pcard-row{display:flex;align-items:center;gap:8px}',
    '.lb-medal{flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.76rem;font-weight:900;background:#f1f4f9;color:var(--hub-muted,#5b6b82)}',
    '.lb-medal.is-gold{background:#f5c518;color:#5c4a00}',
    '.lb-medal.is-silver{background:#d9dee6;color:#3a4453}',
    '.lb-medal.is-bronze{background:#e0b490;color:#5c3a1e}',
    '.lb-av{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--hub-surface-2,#eef2f8);font-size:.9rem;line-height:1}',
    '.lb-av.is-initial{font-size:.7rem;font-weight:900;color:var(--hub-muted,#5b6b82)}',
    '.lb-pname{flex:1 1 auto;min-width:0;font-size:.92rem;font-weight:700;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-pnum{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;line-height:1.15}',
    '.lb-pnum b{font-size:1.3rem;font-weight:700;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    '.lb-pnum span{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--hub-muted,#5b6b82)}',
    '.lb-pmeta{margin:4px 0 0 34px;font-size:.72rem;font-weight:600;color:var(--hub-muted,#5b6b82)}',
    '.lb-tiles{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 0 34px}',
    '.lb-tile2{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:8px;background:var(--hub-surface-2,#eef2f8);border:1.5px solid transparent;font-size:.72rem;font-weight:800;color:var(--hub-muted,#5b6b82)}',
    '.lb-tile2 .lb-dshape{fill:var(--lb-pill-color,#5b6b82)}',
    '.lb-tile2.is-sel{border-color:var(--lb-pill-color,#1c2430);color:var(--hub-ink,#16243a);background:#fff}',
    '.lb-tile2.is-empty{opacity:.5}',
    '.lb-sk{display:inline-block;width:100%;height:11px;border-radius:5px;background:var(--hub-surface-2,#eef2f8);vertical-align:middle}',
    '.lb-sk-n{width:14px}', '.lb-sk-w{width:60%}',
    // Games list.
    '.lb-glist{display:flex;flex-direction:column;gap:8px;margin-top:8px}',
    '.lb-grow{appearance:none;cursor:pointer;display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 11px;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;box-shadow:0 4px 16px rgba(20,40,80,.06);font:inherit;color:inherit}',
    '.lb-gart{flex:0 0 auto;width:46px;height:26px;border-radius:6px;overflow:hidden;line-height:0}',
    '.lb-gart svg{width:100%;height:100%;display:block}',
    '.lb-gmain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.lb-gname{font-size:.9rem;font-weight:700;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-glead{display:flex;align-items:center;gap:5px;min-width:0;font-size:.76rem;font-weight:600;color:var(--hub-muted,#5b6b82)}',
    '.lb-glead-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-glead-empty{font-style:normal;opacity:.75}',
    // Fixed-width stack (spec: the old free-form gray text made the column ragged).
    '.lb-gnum{flex:0 0 auto;min-width:56px;display:flex;flex-direction:column;align-items:flex-end;line-height:1.15}',
    '.lb-gnum b{font-size:1rem;font-weight:700;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    '.lb-gnum span{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--hub-muted,#5b6b82)}',
    '.lb-gchev{flex:0 0 auto;color:var(--hub-muted,#5b6b82);font-size:1.1rem;line-height:1}',
    // Game detail header.
    '.lb-detail-top{display:flex;align-items:center;gap:10px;margin:8px 0 4px;min-height:var(--gh-band-title,44px)}',
    '.lb-back{appearance:none;cursor:pointer;padding:7px 11px;font-size:.8rem;font-weight:800;color:var(--hub-muted,#5b6b82);background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:9px;white-space:nowrap}',
    '.lb-detail-art{flex:0 0 auto;width:40px;height:23px;border-radius:6px;overflow:hidden;line-height:0}',
    '.lb-detail-art svg{width:100%;height:100%;display:block}',
    '.lb-detail-h{margin:0;font-size:17px;font-weight:600;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // "Who leads what" chips: tinted backgrounds, rotating a small fixed palette; text is always
    // the dark pair of its own tint, never gray/black (Matt's restyle note).
    '.lb-chips{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.lb-chip{display:flex;flex-direction:column;gap:2px;padding:10px 11px;border-radius:12px}',
    '.lb-chip-a{background:#fdf3e2;color:#8a5b00}',
    '.lb-chip-b{background:#e5f3f0;color:#0d5c4d}',
    '.lb-chip-c{background:#e8eff8;color:#173f6e}',
    '.lb-chip b{font-size:1.15rem;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.1;overflow-wrap:anywhere;color:inherit}',
    '.lb-chip span{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:inherit;opacity:.82}',
    '.lb-chip em{display:flex;align-items:center;gap:5px;min-width:0;font-style:normal;font-size:.76rem;font-weight:700;color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-chip .lb-av{width:19px;height:19px;font-size:.78rem;background:rgba(255,255,255,.55)}',
    '.lb-none{margin:8px 0 0;color:var(--hub-muted,#5b6b82);font-size:.92rem;font-weight:600;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;padding:22px 16px;text-align:center}',
    '@media (max-width:359px){.lb-chips{grid-template-columns:1fr}}',
  ].join('');
  document.head.appendChild(el);
}

export default { openLeaderboard, closeLeaderboard };
