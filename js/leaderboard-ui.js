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

import { aggregatePlayers, buildIdentity, SOLO } from './players-agg.js';
import { watchPlayers } from './stats-net.js';
import { loadProfile } from './profile-store.js';
import { statsId } from './game-stats.js';
import { bucketsOf, tierMix } from './leaderboard-rank.js';
import { TIERS, diffShapeSVG, TIER_COLOR } from './difficulty-tiers.js';
import { GAME_ART } from './game-art.js';
import { screenFor, ensureStatsCss, gameListHTML as gsGameListHTML, hubIdOf, unitKeyOf } from './game-stats-ui.js';
import { makeT } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
// difficulty-tiers.js is READ-path-only and out of scope for i18n edits (its TIER_LABEL is
// English-only, used elsewhere); this maps the same 1-4 tiers onto our own translated keys instead.
const TIER_LABEL_KEY = { 1: 'gs_diff_beginner', 2: 'gs_diff_intermediate', 3: 'gs_diff_pro', 4: 'gs_diff_expert' };
// Ski-slope shape language (colorblind-safe: shape carries the meaning, color is secondary).
// TIER_COLOR itself now lives in difficulty-tiers.js (2026-07-24) so every game's setup screen
// can use it too; imported above, values unchanged.

// Old test/debug device records. They stay in Firebase untouched (no data is ever deleted); they are
// simply never rendered. Matched by deviceId prefix.
const HIDDEN_PREFIX = ['4392d978', 'f8ad1b82', 'zzz-prev'];   // "Tester", "test1", preview bot

// Test/QA profile names (2026-07-29, widened 2026-07-31). Device-id prefixes above only hide
// devices that already existed when the prefix was written; a fresh test pass mints a new device id
// every time (new browser/profile/incognito), so a NAME match is what actually stays durable across
// repeat testing. That is why "Tester" kept reappearing: only the ONE device `4392d978` was hidden,
// so the same name on any new browser was a brand-new, visible row. Matt (2026-07-31): no test
// account should ever appear on the leaderboard.
//
// So the rule is now a PREFIX rule, not an exact list: any name starting with "test" (Test, Tester,
// test1, testing) or "zzz" (zzztest and friends), plus the exact names below. Deliberately blunt -
// a real player is not called "Testxyz", and the cost of a miss is a test row on the family board.
// Hidden here only: those plays stay recorded, stay synced, and stay visible on My Stats on the
// device that made them, same as every other hidden record. Case-insensitive, trimmed.
const HIDDEN_NAMES = new Set(['qa', 'dev', 'demo', 'preview', 'prueba']);
const HIDDEN_NAME_PREFIX = ['test', 'zzz'];

/** True for a row that must never render: a test/QA account, or a device with no real name.
 *
 *  Nameless rows (2026-07-31, superseding the 2026-07-30 "show players who never set a profile
 *  name" change): the app is no longer PLAYABLE without a name - js/name-gate.js gates the hub and
 *  every standalone game page - so a nameless record can only be pre-gate history, and its owner is
 *  gated into naming themselves the next time they open anything. At that moment players-agg.js's
 *  identity graph attaches that exact history to their real row and it reappears here, because the
 *  record was never altered. Until then it stays synced and fully visible to its owner on My Stats.
 *  THE LAW rule 1 is about history no screen shows; this history has a screen, and a way back onto
 *  this one. Do not re-hide nameless rows WITHOUT that gate in place - that combination is the
 *  stored-but-invisible bug 59f8e9b fixed. */
function isHiddenRow(g) {
  const name = (g.name || '').trim().toLowerCase();
  if (!name || name === 'you') return true;                          // 'You' is profile-store's blank default
  if (HIDDEN_NAMES.has(name)) return true;
  return HIDDEN_NAME_PREFIX.some((p) => name.startsWith(p));
}

// --- sort preference (2026-07-29, HANDOFF-LB-FILTER-SORT.md) ----------------------------------
// gamehub.lb.sort.v1 - follows js/favorites.js as the model (try/catch read, defensive
// normalize, best-effort write, never throws). A PREFERENCE, not history: THE LAW rule 2's
// carve-out applies, same class as favorites/theme/language. Unlike the difficulty filter
// (_diff, resets to All every open), the sort choice PERSISTS across opens (Matt, D6).
const SORT_KEY = 'gamehub.lb.sort.v1';
const VALID_SORTS = new Set(['alpha', 'played', 'wins']);
function loadSort() {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && VALID_SORTS.has(v.sort) ? v.sort : 'played';   // 'played' is the default (D5)
  } catch { return 'played'; }
}
function saveSort(sort) {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify({ version: 1, sort, updatedAt: Date.now() }));
  } catch { /* best-effort; never throw into the caller */ }
}

// Every game, ALPHABETICAL BY TITLE - the hub launcher's convention (CLAUDE.md, "Adding a game",
// item 5). Fixed order: a tile never moves between visits, unlike the old plays-sorted tab strip.
// `id` is the STATS id (game-stats.js's GAMES); js/game-art.js is keyed by the HUB registry id, so
// STATS_TO_HUB below maps between them for the tile art thumbnails.
// Labels resolve through js/strings.js's game_title_* keys (shared with the stats tabs, and
// matching the hub registry's {en,es} titles — Matt, 2026-07-23: game titles translate, Spain
// Spanish). Sort happens at CALL time via gameMetaSorted(): alphabetical by the DISPLAYED title
// in the active language, the launcher's own convention — a module-scope sort would freeze
// whichever language happened to be active at first import.
const GAME_META = [
  { id: 'ballrun', labelKey: 'game_title_ballrun' },
  { id: 'battleship', labelKey: 'game_title_battleship' },
  { id: 'boggle', labelKey: 'game_title_boggle' },
  { id: 'chinchon', labelKey: 'game_title_chinchon' },
  { id: 'connect4', labelKey: 'game_title_connect4' },
  { id: 'dotsboxes', labelKey: 'game_title_dotsboxes' },
  { id: 'escoba', labelKey: 'game_title_escoba' },
  { id: 'filler', labelKey: 'game_title_filler' },
  { id: 'mancala', labelKey: 'game_title_mancala' },
  { id: 'business', labelKey: 'game_title_business' },
  { id: 'nutsbolts', labelKey: 'game_title_nutsbolts' },
  { id: 'parchis', labelKey: 'game_title_parchis' },
  { id: 'snake', labelKey: 'game_title_snake' },
  { id: 'tictactoe', labelKey: 'game_title_tictactoe' },
  { id: 'uno', labelKey: 'game_title_uno' },
  { id: 'pool', labelKey: 'game_title_pool' },
  { id: 'poolv2', labelKey: 'game_title_poolv2' },
  { id: 'dominoes', labelKey: 'game_title_dominoes' },
  { id: 'hillclimb', labelKey: 'game_title_hillclimb' },
  // MISSING until 2026-08-11, and it took a bug report to find: Yahtzee shipped with every other
  // surface wired up (game-stats.js's GAMES, the yz sub-counter, players-agg's branch, a My Stats
  // screen) but never got a row here, so ALL_IDS/COMP_IDS did not contain it and its wins and plays
  // were worth nothing on the leaderboard. The player's own Stats screen showed 14 Yahtzee wins
  // while the board counted 0 - stored, synced, and invisible, which is THE LAW rule 1 exactly.
  // players-agg.test.mjs's second [KNOWN-BUG PROBE] block now fails if a shipped game is absent.
  { id: 'yahtzee', labelKey: 'game_title_yahtzee' },
  // Skeeball joined on 2026-08-22, the day its hub entry dropped `devOnly`. It was deliberately
  // absent before that, same as Pinball still is: the leaderboard is the shared bragging wall and
  // an unreleased game has no business on it. Its pre-release plays were never lost - they sat in
  // every device's store and in players/ the whole time, and counted the moment this row existed.
  { id: 'skeeball', labelKey: 'game_title_skeeball' },
];
function gameMetaSorted() { return GAME_META.slice().sort((a, b) => t(a.labelKey).localeCompare(t(b.labelKey))); }
const ALL_IDS = GAME_META.map((g) => g.id);
// Solo games (Ball Run/Snake/Nuts & Bolts) record every run/solve as played+1, won+1 (game-stats.js's
// recordBallRun/recordSnake/recordNutsBolts — a crash on obstacle 0 is a "win"), so folding them into
// the cross-game wins number let volume alone top the board. Matt, 2026-07-28: they are RUNS, counted
// and labeled separately. Derived from ALL_IDS (not players-agg's COMPETITIVE) so this file's two lists
// can never disagree about which games it renders.
const COMP_IDS = ALL_IDS.filter((id) => !SOLO.has(id));
const SOLO_IDS = ALL_IDS.filter((id) => SOLO.has(id));
// hubIdOf/unitKeyOf now live in game-stats-ui.js (single source, HANDOFF-FB2-STATS-NAV.md) so
// this file and My Stats' game-list drill-down can never disagree on a game's thumbnail or unit.

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function labelOf(id) { const m = GAME_META.find((g) => g.id === id); return m ? t(m.labelKey) : id; }

// --- identity chrome --------------------------------------------------------
/** The fallback label is unreachable in normal rendering as of 2026-07-31: isHiddenRow() filters
 *  nameless rows out before they get here, now that js/name-gate.js makes a nameless device
 *  impossible to create. Kept as a defensive label so a row that somehow arrives nameless renders
 *  as something rather than as a blank line. */
function rankName(g) { const n = (g.name || '').trim(); return n ? esc(n) : esc(t('lb_unnamed_player')); }

/** The player's synced profile emoji (aggregated in players-agg.js), falling back to their first
 *  initial in a neutral circle. */
function avatarHTML(g) {
  const emoji = (g.emoji || '').trim();
  if (emoji) return `<span class="lb-av" aria-hidden="true">${esc(emoji)}</span>`;
  const initial = ((g.name || '?').trim()[0] || '?').toUpperCase();
  return `<span class="lb-av is-initial" aria-hidden="true">${esc(initial)}</span>`;
}

/** The player's own message, shown only on their detail screen. Empty renders nothing at all -
 *  there is no data to hide, so no placeholder row. esc() is mandatory: this is free player text. */
function messageHTML(g) {
  const m = (g.message || '').trim();
  return m ? `<p class="lb-pmsg">${esc(m)}</p>` : '';
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
/** Solo plays (Ball Run/Snake runs, Nuts & Bolts solves) at `tier`. Every solo record bumps
 *  `total.played` exactly once per run/solve, so plays IS the run count — no need to read the
 *  br/sn/nb sub-counters, and this stays tier-filterable like everything else on this screen.
 *  Kept in place though its only caller (metaLine) lost its call sites 2026-07-29 (HANDOFF-LB-
 *  FILTER-SORT.md §0/§3.6) — the documented solo-plays helper, so the next session doesn't have
 *  to re-derive it. */
function runsAtTier(group, tier) { return playsAtTier(group, SOLO_IDS, tier); }
/** Total plays across EVERY game, competitive + solo runs (Matt, 2026-07-29): the leaderboard
 *  card's "played" number. Deliberately ALL_IDS, not COMP_IDS — see HANDOFF-LB-FILTER-SORT.md §0
 *  for why folding runs in here is the rule-1-safe choice. */
function playedOf(g, tier) { return playsAtTier(g, ALL_IDS, tier); }
/** Cross-game wins: competitive games only, UNCHANGED from before this redesign. A solo run is
 *  not a win (HANDOFF-LB-SOLO-RUNS.md, still in force). Do not "make them consistent" by moving
 *  wins onto ALL_IDS — that would re-fold solo runs into the wins number, exactly the bug that
 *  handoff fixed. The asymmetry is deliberate. */
function winsOf(g, tier) { return winsAtTier(g, COMP_IDS, tier); }
/** The unit word for a `{n} ...` count string (e.g. 'lb_played_count' -> 'played'), reused for
 *  the card's big-number stacked unit so it never needs its own translation key — deriving it
 *  from the same string that already renders the small subline keeps the two in lockstep. */
function unitWord(countKey) { return t(countKey, { n: '' }).trim(); }
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
// Hill Climb is the third such game: its metric is the furthest DISTANCE, and its per-tier bucket
// is keyed by STAGE id (not by a difficulty word) because its four stages ARE its difficulty axis,
// 1:1 and in unlock order - see js/game-stats.js's HC_STAGES.
const HC_TIER_KEYS = ['countryside', 'desert', 'arctic', 'moon'];
/** BALLRUNMAP2ORBITALSPEC.md Phase 1: combines Classic's `br` and Orbital's `brOrbital` buckets
 *  (Math.max, same as the players-agg.js combine) so a player who has only played the new map is
 *  not shown as 0 here - THE LAW rule 1, the same gap game-stats-ui.js's headlineOf closes. */
function brBestAt(g, tier) {
  const br = g.games.ballrun.br;
  const brOrbital = g.games.ballrun.brOrbital;
  if (!br && !brOrbital) return 0;
  if (tier == null) return Math.max((br && br.bestObstacles) | 0, (brOrbital && brOrbital.bestObstacles) | 0);
  const key = BR_TIER_KEYS[tier - 1];
  if (!key) return 0;
  return Math.max((br && (br.bestObstaclesByDiff || {})[key]) | 0, (brOrbital && (brOrbital.bestObstaclesByDiff || {})[key]) | 0);
}
function snBestAt(g, tier) {
  const sn = (g.games.snake || {}).sn;
  if (!sn) return 0;
  if (tier == null) return sn.bestLen | 0;
  const key = SN_TIER_KEYS[tier - 1];
  return key ? (sn.bestLenByDiff || {})[key] | 0 : 0;
}
// Walls-mode split (2026-07-28): Walls off is strictly easier (no wall death), so a combined
// number buries every Walls on score under an easier ruleset's — this reads the per-mode field
// `js/game-stats.js`/`js/players-agg.js` both keep in step with the combined `sn.bestLen*` above.
// Falls back to the combined legacy field ONLY for 'off' (Matt's explicit call: every pre-split
// score is Walls off, same as the one-time local seed in game-stats.js) so a remote record that
// hasn't re-synced since this shipped still shows correctly instead of reading as a zero.
function snBestAtWalls(g, tier, walls) {
  const sn = (g.games.snake || {}).sn;
  if (!sn) return 0;
  const bw = sn.bestLenByWalls, bdw = sn.bestLenByDiffWalls;
  if (tier == null) {
    if (bw) return bw[walls] | 0;
    return walls === 'off' ? sn.bestLen | 0 : 0;
  }
  const key = SN_TIER_KEYS[tier - 1];
  if (!key) return 0;
  if (bdw && bdw[walls]) return bdw[walls][key] | 0;
  return walls === 'off' ? (sn.bestLenByDiff || {})[key] | 0 : 0;
}
function hcBestAt(g, tier) {
  const hc = (g.games.hillclimb || {}).hc;
  if (!hc) return 0;
  if (tier == null) return hc.bestDistance | 0;
  const key = HC_TIER_KEYS[tier - 1];
  return key ? (hc.bestDistanceByStage || {})[key] | 0 : 0;
}
/** The number a game's leaderboard is ranked by, at `tier`. Nuts & Bolts needs no special case:
 *  every solve increments both `played` and `won` by exactly 1 (recordNutsBolts), so winsAtTier
 *  already equals "levels solved at this tier". */
function gameMetricAt(g, id, tier) {
  if (id === 'ballrun') return brBestAt(g, tier);
  if (id === 'snake') return snBestAt(g, tier);
  if (id === 'hillclimb') return hcBestAt(g, tier);
  return winsAtTier(g, [id], tier);
}

// --- difficulty pills --------------------------------------------------------
// diffShapeSVG now lives in js/difficulty-tiers.js (imported above) so every game's setup
// screen can share the exact same shape markup; behavior here is unchanged.
const DIFF_PILLS = [
  { tier: null, labelKey: 'lb_diff_all' },
  { tier: 1, labelKey: 'gs_diff_beginner' },
  { tier: 2, labelKey: 'gs_diff_intermediate' },
  { tier: 3, labelKey: 'gs_diff_pro' },
  { tier: 4, labelKey: 'gs_diff_expert' },
];

// --- control row: filter + sort dropdowns (2026-07-29, HANDOFF-LB-FILTER-SORT.md) -------------
// Replaces the old 5-pill difficulty row (`pillsHTML`). Two triggers, each opening a dropdown
// menu anchored under itself (Matt's explicit choice, D4) - not a bottom sheet, not a native
// <select>. `_menu` (null|'diff'|'sort') tracks which one is open; rerender() closes/opens them
// by re-emitting this markup, same as every other piece of state in this file.
const SORT_ITEMS_DEFAULT = [
  { sort: 'alpha', labelKey: 'lb_sort_alpha' },
  { sort: 'played', labelKey: 'lb_sort_played' },
  { sort: 'wins', labelKey: 'lb_sort_wins' },
];
// A game board's third sort option is labeled by ITS OWN metric (Wins/Obstacles/Longest/Solved),
// keyed off the same unitKeyOf() map/game-stats-ui.js already uses for the metric's own unit.
const UNIT_TO_SORT_LABEL = {
  lb_unit_wins: 'lb_sort_wins',
  lb_unit_obstacles: 'lb_sort_obstacles',
  lb_unit_longest: 'lb_sort_longest',
  lb_unit_solved: 'lb_sort_solved',
  lb_unit_meters: 'lb_sort_meters',
};
function sortItemsFor(id) {
  const labelKey = UNIT_TO_SORT_LABEL[unitKeyOf(id)] || 'lb_sort_wins';
  return [
    { sort: 'alpha', labelKey: 'lb_sort_alpha' },
    { sort: 'played', labelKey: 'lb_sort_played' },
    { sort: 'wins', labelKey },
  ];
}

/** The filter dropdown's menu panel. `showExpert` hides the Expert item where tier-4 data cannot
 *  exist (a specific game with no tier-4 bucket in the field); By Player/By Game always show it
 *  (cross-game context). Colorblind rule preserved: each item still carries its tier SHAPE
 *  (`diffShapeSVG`), never hue alone; the selected item is marked by `aria-checked` plus a
 *  trailing checkmark (CSS `.lb-mitem.is-sel::after`), also never by hue alone. */
function diffMenuHTML(showExpert) {
  const items = showExpert ? DIFF_PILLS : DIFF_PILLS.filter((p) => p.tier !== 4);
  return `<div class="lb-menu" role="menu" aria-label="${t('lb_diff_filter_aria')}">${items.map((p) => {
    const sel = _diff === p.tier;
    const color = p.tier ? TIER_COLOR[p.tier] : '#1c2430';
    return `<button type="button" role="menuitemradio" aria-checked="${sel}" class="lb-mitem${sel ? ' is-sel' : ''}" data-tier="${p.tier == null ? '' : p.tier}" style="--lb-pill-color:${color}">${p.tier ? diffShapeSVG(p.tier) : ''}<span>${esc(t(p.labelKey))}</span></button>`;
  }).join('')}</div>`;
}

/** The sort dropdown's menu panel. `items` is `SORT_ITEMS_DEFAULT` (By Player) or `sortItemsFor(id)`
 *  (a game board, D8's third option labeled by that game's own metric). */
function sortMenuHTML(items) {
  return `<div class="lb-menu" role="menu" aria-label="${t('lb_sort_aria')}">${items.map((it) => {
    const sel = _sort === it.sort;
    return `<button type="button" role="menuitemradio" aria-checked="${sel}" class="lb-mitem${sel ? ' is-sel' : ''}" data-sort="${it.sort}"><span>${esc(t(it.labelKey))}</span></button>`;
  }).join('')}</div>`;
}

/** The control row: filter always renders, sort renders only when `sortOptions` is given
 *  (D3: By Game's top-level tab has no sort control - alphabetical by title, as today). */
function controlsHTML({ showExpert = true, sortOptions = null } = {}) {
  const diffItem = DIFF_PILLS.find((p) => p.tier === _diff) || DIFF_PILLS[0];
  const diffOpen = _menu === 'diff';
  const filterSide = `<div class="lb-ctrl" data-ctrl="diff">
    <span class="lb-ctrl-lbl">${t('lb_filter_label')}</span>
    <button type="button" class="lb-ctrl-btn" data-menu="diff" aria-haspopup="menu" aria-expanded="${diffOpen}">${esc(t(diffItem.labelKey))}</button>
    ${diffOpen ? diffMenuHTML(showExpert) : ''}
  </div>`;
  if (!sortOptions) return `<div class="lb-ctrls">${filterSide}</div>`;
  const activeItem = sortOptions.find((it) => it.sort === _sort) || sortOptions[0];
  const sortOpen = _menu === 'sort';
  const sortSide = `<div class="lb-ctrl lb-ctrl-sort" data-ctrl="sort">
    <span class="lb-ctrl-lbl">${t('lb_sort_label')}</span>
    <button type="button" class="lb-ctrl-btn" data-menu="sort" aria-haspopup="menu" aria-expanded="${sortOpen}">${esc(t(activeItem.labelKey))}</button>
    ${sortOpen ? sortMenuHTML(sortOptions) : ''}
  </div>`;
  return `<div class="lb-ctrls">${filterSide}${sortSide}</div>`;
}

/** Mini tile row: one tile per tier in `tiers`, showing `valueFn(tier)`'s win/metric count.
 *  `valueFn` returning null renders a muted dash (game page: alignment across cards - a tier the
 *  field plays but this player hasn't gets a "-" tile rather than being omitted, so every card in
 *  the list has the same tile COUNT). On By Player, `tiers` is only the tiers this player has
 *  played, so `valueFn` never returns null there and no dash ever shows on that tab. */
// --- multiplayer, ON THE GAME'S OWN PAGE (2026-08-11) -------------------------
// Matt: "I don't give a fuck about generic multiplayer wins or losses. I care about game specific
// wins and losses... Add some way to tell how many multiplayer escoba wins someone has by looking
// at the escoba page."
//
// A multiplayer play records under the `'mp'` difficulty bucket, and `tierOf('mp')` is null, so it
// counts in the card's TOTAL wins but appears in none of the tier chips beside it. That is the
// documented convention for unmapped buckets, and on this screen it reads as an error: Lili's
// Escoba card says 31 wins over chips totalling 23, with the missing 8 explained nowhere. So the
// tier row grows a fourth chip carrying exactly that number, on the game's own board where it is
// about ONE game rather than summed across all of them.
//
// It is labelled with a WORD, not a shape or a hue: the tier chips' ski-slope shapes encode a 1-4
// scale that multiplayer is deliberately not on, so borrowing one would claim a difficulty this
// bucket does not have. Colorblind-safe by construction for the same reason.
const mpBucketOf = (g, id) => (((g.games || {})[id] || {}).byDiff || {}).mp || null;
const mpWinsOf = (g, id) => { const b = mpBucketOf(g, id); return b ? (b.won | 0) : 0; };
const mpPlaysOf = (g, id) => { const b = mpBucketOf(g, id); return b ? (b.played | 0) : 0; };
/** True if ANYONE on this board has multiplayer plays in this game -- the chip is not rendered at
 *  all for a game nobody has played online, rather than adding a column of dashes to every card. */
const anyMpPlays = (list, id) => list.some((g) => mpPlaysOf(g, id) > 0);

/** The multiplayer chip, appended to a card's tier row. A player with no online plays in this game
 *  gets the same em-dash treatment an unplayed tier gets, so the column stays readable. */
function mpTileHTML(g, id) {
  const played = mpPlaysOf(g, id);
  return `<span class="lb-tile2 lb-tile-mp${played ? '' : ' is-empty'}" title="${esc(t('gs_diff_mp'))}">`
    + `<i class="lb-mp-tag">${esc(t('lb_mp_short'))}</i><b>${played ? mpWinsOf(g, id) : '&mdash;'}</b></span>`;
}

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

/** The card's OLD sub-line ("N games · N runs"). Unused since 2026-07-29 (Matt: "Remove the N
 *  games N runs line... just don't show it on this screen") — left in place, along with its two
 *  string keys, per HANDOFF-LB-FILTER-SORT.md §0/§3.6: nothing deleted, just not rendered, and
 *  the helper is here if it's ever wanted back. */
function metaLine(games, runs) {
  const parts = [];
  if (games > 0 || !runs) parts.push(t('lb_games_count', { n: games }));
  if (runs > 0) parts.push(t('lb_runs_count', { n: runs }));
  return parts.join(' &middot; ');
}

/** Two-row card (2026-07-29 redesign). `big` is `{val, unit}` for the large row-1 number (the
 *  metric currently sorted by); `subText` is the small, muted, right-aligned row-2 number (the
 *  OTHER metric, already formatted, e.g. "105 wins"/"246 played"); `tilesHtml` is the tier-tile
 *  row (unchanged, wins-per-tier always - see gameDetail/playerListHTML, it never follows the
 *  sort). Every card is a button opening the player detail screen. */
function playerCardHTML(g, i, big, subText, tilesHtml) {
  const me = g.key === _meKey ? ' is-me' : '';
  const footer = (tilesHtml || subText)
    ? `<div class="lb-pfoot">${tilesHtml || ''}${subText ? `<span class="lb-psub">${esc(subText)}</span>` : ''}</div>`
    : '';
  return `<button type="button" class="lb-pcard${me}" data-pkey="${esc(g.key)}"${me ? ' aria-current="true"' : ''}>
    <div class="lb-pcard-row">
      <span class="lb-medal${medalClass(i)}">${i + 1}</span>
      ${avatarHTML(g)}
      <span class="lb-pname">${rankName(g)}</span>
      <span class="lb-pnum"><b>${big.val}</b><span>${esc(big.unit)}</span></span>
      <span class="lb-pchev" aria-hidden="true">&rsaquo;</span>
    </div>
    ${footer}
  </button>`;
}

/** By Player sort (D5/D6): 'alpha' | 'played' | 'wins', persisted in `_sort`. Row filter is
 *  UNCHANGED (playedOf(g,_diff) > 0, exactly `playsAtTier(g, ALL_IDS, _diff) > 0` — a solo-only
 *  player stays listed). */
function playerListHTML(list) {
  const rows = list.filter((g) => playedOf(g, _diff) > 0);
  if (!rows.length) return emptyState(t('lb_empty_all'));
  if (_sort === 'alpha') {
    rows.sort((a, b) => {
      const n = (a.name || '').localeCompare(b.name || '');
      if (n) return n;
      const w = winsOf(b, _diff) - winsOf(a, _diff);
      if (w) return w;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  } else if (_sort === 'played') {
    rows.sort((a, b) => {
      const p = playedOf(b, _diff) - playedOf(a, _diff);
      if (p) return p;
      const w = winsOf(b, _diff) - winsOf(a, _diff);
      if (w) return w;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  } else {   // 'wins'
    rows.sort((a, b) => {
      const w = winsOf(b, _diff) - winsOf(a, _diff);
      if (w) return w;
      const p = playedOf(a, _diff) - playedOf(b, _diff);   // fewer plays wins ties (today's tie-break, preserved)
      if (p) return p;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }
  return `<div class="lb-plist">${rows.map((g, i) => {
    const wins = winsOf(g, _diff);
    const played = playedOf(g, _diff);
    const tiers = tiersPresent(g, COMP_IDS);
    const tiles = miniTilesHTML(tiers, (tier) => winsAtTier(g, COMP_IDS, tier));   // wins per tier, ALWAYS - never follows the sort (§1b)
    const big = _sort === 'played' ? { val: played, unit: unitWord('lb_played_count') } : { val: wins, unit: t('lb_wins_unit') };
    const subText = _sort === 'played' ? t('lb_wins_count', { n: wins }) : t('lb_played_count', { n: played });
    return playerCardHTML(g, i, big, subText, tiles);
  }).join('')}</div>`;
}

// --- By Game ------------------------------------------------------------------
function gameListHTML(list) {
  const rows = gameMetaSorted().map((meta) => {
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
      <span class="lb-gmain"><span class="lb-gname">${esc(t(meta.labelKey))}</span>${body}</span>
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
  hillclimb: [
    { labelKey: 'lb_tex_furthest_drive', get: (g) => (((g.games.hillclimb || {}).hc || {}).bestDistance) | 0 },
    { labelKey: 'lb_tex_hc_coins', get: (g) => (((g.games.hillclimb || {}).hc || {}).coins) | 0 },
    { labelKey: 'lb_tex_hc_flips', get: (g) => (((g.games.hillclimb || {}).hc || {}).flips) | 0 },
  ],
  skeeball: [
    { labelKey: 'lb_tex_sk_best_game', get: (g) => (((g.games.skeeball || {}).sk || {}).bestGame) | 0 },
    { labelKey: 'lb_tex_sk_best_throw', get: (g) => (((g.games.skeeball || {}).sk || {}).bestThrow) | 0 },
    { labelKey: 'lb_tex_sk_hundreds', get: (g) => (((g.games.skeeball || {}).sk || {}).hundreds) | 0 },
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

// Tic Tac Toe's game page shows the Ultimate/Classic split instead of one wins number (Matt:
// "tic tac toe leaderboard just show ultimate vs classic") — same not-a-draw rule per variant as
// leaderboard-rank.js's record() (wins = the stored `won`, ties excluded; Matt, 2026-07-28),
// computed straight from the `tt` sub-counter, which has no per-tier
// storage (like Chinchón closes/Boggle words in textureHTML below), so it is filter-INDEPENDENT:
// the difficulty pills still gate which players are listed (via the generic total/byDiff bucket),
// but never change these two numbers. `tt` stores `tied` explicitly, so this needs no derivation.
function ttVariantWins(v) { return Math.max(0, Math.min((v && v.won) | 0, (v && v.played) | 0)); }

// Two side-by-side numbers, no single headline value — left STRUCTURALLY ALONE by the 2026-07-29
// filter/sort redesign (HANDOFF-LB-FILTER-SORT.md §3.5): no big/small swap, no secondary number.
// They still sit under the new control row, and Alphabetical/Games Played still reorder them
// (see sortRows below) — only the "wins" sort (this game's own metric) keeps its bespoke order.
function ttCardHTML(g, i) {
  const me = g.key === _meKey ? ' is-me' : '';
  const tt = (g.games.tictactoe && g.games.tictactoe.tt) || null;
  const hasTt = !!(tt && (tt.classic || tt.ultimate));
  const ultimate = hasTt ? ttVariantWins(tt.ultimate) : 0;
  const classic = hasTt ? ttVariantWins(tt.classic) : 0;
  // Legacy/pre-split history (or a device that only ever synced totals) carries no `tt` object -
  // nobody may fall off the board (rule 1), so show the generic wins number as a third, honestly
  // labeled fallback value instead of a silent zero.
  const fallback = hasTt ? '' : `<span class="lb-tt-val is-fallback"><b>${winsAtTier(g, ['tictactoe'], null)}</b><span>${esc(t('lb_wins_unit'))}</span></span>`;
  return `<button type="button" class="lb-pcard${me}" data-pkey="${esc(g.key)}"${me ? ' aria-current="true"' : ''}>
    <div class="lb-pcard-row">
      <span class="lb-medal${medalClass(i)}">${i + 1}</span>
      ${avatarHTML(g)}
      <span class="lb-pname">${rankName(g)}</span>
      <span class="lb-pchev" aria-hidden="true">&rsaquo;</span>
    </div>
    <div class="lb-tt-split">
      <span class="lb-tt-val"><b>${ultimate}</b><span>${esc(t('lb_tt_ultimate'))}</span></span>
      <span class="lb-tt-val"><b>${classic}</b><span>${esc(t('lb_tt_classic'))}</span></span>
      ${fallback}
    </div>
  </button>`;
}

// Snake's walls-mode split (2026-07-28) — TicTacToe's ultimate/classic split above is the
// template: two numbers per card instead of one, no toggle. Unlike TT's variants, Snake's bests
// ARE per-tier storage, so this one respects the difficulty pill (`_diff`), unlike ttCardHTML.
// Same "leave structurally alone" note as ttCardHTML above applies here (§3.5).
function snCardHTML(g, i) {
  const me = g.key === _meKey ? ' is-me' : '';
  const off = snBestAtWalls(g, _diff, 'off');
  const on = snBestAtWalls(g, _diff, 'on');
  return `<button type="button" class="lb-pcard${me}" data-pkey="${esc(g.key)}"${me ? ' aria-current="true"' : ''}>
    <div class="lb-pcard-row">
      <span class="lb-medal${medalClass(i)}">${i + 1}</span>
      ${avatarHTML(g)}
      <span class="lb-pname">${rankName(g)}</span>
      <span class="lb-pchev" aria-hidden="true">&rsaquo;</span>
    </div>
    <div class="lb-tt-split">
      <span class="lb-tt-val"><b>${off}</b><span>${esc(t('lb_sn_walls_off'))}</span></span>
      <span class="lb-tt-val"><b>${on}</b><span>${esc(t('lb_sn_walls_on'))}</span></span>
    </div>
  </button>`;
}

/** D8's three orders for a game board. 'alpha'/'played' are generic (name/plays, then this
 *  game's own metric as a tie-break, then recency) and apply to EVERY game including Tic Tac Toe
 *  and Snake. 'wins' (= "this game's own metric") is left EXACTLY as it was before this redesign -
 *  Tic Tac Toe's ultimate -> classic -> recency order, every other game's metric -> plays -> recency. */
function sortRows(rows, id, sort) {
  if (sort === 'alpha') {
    rows.sort((a, b) => {
      const n = (a.name || '').localeCompare(b.name || '');
      if (n) return n;
      const m = gameMetricAt(b, id, _diff) - gameMetricAt(a, id, _diff);
      if (m) return m;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return;
  }
  if (sort === 'played') {
    rows.sort((a, b) => {
      const p = playsAtTier(b, [id], _diff) - playsAtTier(a, [id], _diff);
      if (p) return p;
      const m = gameMetricAt(b, id, _diff) - gameMetricAt(a, id, _diff);
      if (m) return m;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return;
  }
  if (id === 'tictactoe') {
    rows.sort((a, b) => {
      const ta = (a.games.tictactoe && a.games.tictactoe.tt) || {};
      const tb = (b.games.tictactoe && b.games.tictactoe.tt) || {};
      const u = ttVariantWins(tb.ultimate) - ttVariantWins(ta.ultimate);
      if (u) return u;
      const c = ttVariantWins(tb.classic) - ttVariantWins(ta.classic);
      if (c) return c;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  } else {
    rows.sort((a, b) => {
      const m = gameMetricAt(b, id, _diff) - gameMetricAt(a, id, _diff);
      if (m) return m;
      const p = playsAtTier(a, [id], _diff) - playsAtTier(b, [id], _diff);
      if (p) return p;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }
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
  const controls = controlsHTML({ showExpert, sortOptions: sortItemsFor(id) });
  const showMp = anyMpPlays(list, id);
  const rows = list.filter((g) => playsAtTier(g, [id], _diff) > 0);
  sortRows(rows, id, _sort);
  const cardsHtml = rows.length
    ? `<div class="lb-plist">${rows.map((g, i) => {
        if (id === 'tictactoe') return ttCardHTML(g, i);
        if (id === 'snake') return snCardHTML(g, i);
        const metric = gameMetricAt(g, id, _diff);
        const played = playsAtTier(g, [id], _diff);
        const tiles = miniTilesHTML(fieldTiers, (tier) => (playsAtTier(g, [id], tier) > 0 ? gameMetricAt(g, id, tier) : null))
          + (showMp ? mpTileHTML(g, id) : '');
        const metricUnit = t(unitKeyOf(id));
        const big = _sort === 'played' ? { val: played, unit: unitWord('lb_played_count') } : { val: metric, unit: metricUnit };
        const subText = _sort === 'played' ? `${metric} ${metricUnit}` : t('lb_played_count', { n: played });
        return playerCardHTML(g, i, big, subText, tiles);
      }).join('')}</div>`
    : emptyState(t('lb_empty_game', { label: labelOf(id) }));
  return head + controls + cardsHtml + textureHTML(list, id);
}

// --- player detail (drill-in from either card list) --------------------------
// HANDOFF-FB2-STATS-NAV.md: header (emoji, name, total wins, games played, the same tier chips
// the card already shows) + a leaderboard-style game list (gameListHTML, shared with My Stats,
// game-stats-ui.js), replacing the old giant stacked-screen column. Tapping a row drills into
// that game's own screenFor() screen - pixel-identical to what the local player sees on My
// Stats - with its own `← Games` back row (`_playerGame`, independent of the top-level By Game
// drill's `_game`). No difficulty filter here (a stats sheet, not a ranking); games never played
// are omitted (no zero-row padding, THE LAW rule 1's mirror: nothing is hidden that has data,
// nothing is padded that doesn't).
function playerDetail(list, key) {
  // Entered from within a game page (`_game` stayed set - the card click that opens a player
  // never clears it) vs. from the top-level By Player list. Back BEHAVIOR already returns
  // whence you came either way (this handler only clears `_player`, leaving `_game` intact) -
  // this is the label only, so it stops claiming "Players" when it's actually going back to
  // that game's own page.
  const backLabel = _game ? t('lb_back_game', { title: labelOf(_game) }) : t('lb_back_players');
  const g = list.find((x) => x.key === key);
  if (!g) return `<div class="lb-detail-top"><button type="button" class="lb-back" data-role="lb-player-back">${backLabel}</button></div>` + emptyState(t('lb_empty_all'));
  if (_playerGame) {
    return `<div class="lb-detail-top">
      <button type="button" class="lb-back" data-role="lb-pgame-back">${t('lb_back_games')}</button>
    </div>` + screenFor(_playerGame, { games: g.games });
  }
  // No sort control on this screen, so the header always leads with wins (D1's default) - the
  // meta line becomes a single "N played" (playedOf, all games incl. runs), replacing the old
  // "N games · N runs" metaLine() (see that function's own comment for why it's kept, unused).
  const wins = winsOf(g, null);
  const played = playedOf(g, null);
  const tiers = tiersPresent(g, COMP_IDS);
  const tiles = miniTilesHTML(tiers, (tier) => winsAtTier(g, COMP_IDS, tier));
  const head = `<div class="lb-detail-top">
    <button type="button" class="lb-back" data-role="lb-player-back">${backLabel}</button>
  </div>
  <div class="lb-pdetail-head">
    ${avatarHTML(g)}
    <span class="lb-pdetail-id">
      <span class="lb-pdetail-name">${rankName(g)}</span>
      <span class="lb-pdetail-meta">${t('lb_played_count', { n: played })}</span>
    </span>
    <span class="lb-pnum"><b>${wins}</b><span>${t('lb_wins_unit')}</span></span>
  </div>
  ${tiles}`;
  return head + messageHTML(g) + gsGameListHTML(g.games);
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
  // Every real player with any recorded play is listed. Test accounts and nameless devices are not
  // - see isHiddenRow() above for both rules and why the nameless one is safe now.
  const list = aggregatePlayers(recs).filter((g) => !isHiddenRow(g));
  try { _meKey = buildIdentity(recs).keyFor(loadProfile() || {}, statsId()); } catch { /* keep */ }
  if (_player) return playerDetail(list, _player);
  if (_game) return gameDetail(list, _game);
  // D3: Sort renders on By Player, not on By Game (that tab stays alphabetical by title, as today).
  const controls = _seg === 'games' ? controlsHTML({ showExpert: true }) : controlsHTML({ showExpert: true, sortOptions: SORT_ITEMS_DEFAULT });
  return controls + (_seg === 'games' ? gameListHTML(list) : playerListHTML(list));
}

let _host = null;
let _seg = 'players';       // 'players' | 'games'
let _game = null;           // non-null => showing that game's detail board
let _player = null;         // non-null (a group key) => showing that player's detail screen
let _playerGame = null;     // non-null => drilled into that game from WITHIN player detail
let _diff = null;           // null (All) | 1-4, shared between By Player/By Game and a game page
let _sort = 'played';       // 'alpha' | 'played' | 'wins' (or a game's own metric on a game board) - persisted, see loadSort/saveSort
let _menu = null;           // null | 'diff' | 'sort' - which control-row dropdown is open
let _all = {};
let _meKey = '';
let _unsub = null;
let _connected = false;

const SEGMENTS = [{ id: 'players', labelKey: 'lb_by_player' }, { id: 'games', labelKey: 'lb_by_game' }];

// The segmented highlight follows the CONTENT on screen, not the last segment tapped: a player
// detail reached from By Game (tap a game, then a player) still shows as "By Player" - `_seg`
// itself is left untouched so backing out of the player still lands on the game (see the
// `lb-player-back` handler), but the display must not lie about which content is showing.
function displaySeg() { return _player ? 'players' : _seg; }

function segsHTML() {
  const active = displaySeg();
  return SEGMENTS.map((s) =>
    `<button type="button" class="lb-seg${s.id === active ? ' is-active' : ''}" data-seg="${s.id}"${s.id === active ? ' aria-current="true"' : ''}>${esc(t(s.labelKey))}</button>`
  ).join('');
}

// Last rendered markup, so an update that changes nothing costs a string compare instead of a full
// DOM rebuild. This matters because `watchPlayers` is a LIVE subscription to the whole `players/`
// node: every device in the family re-mirrors its profile+stats on every hub load, tab-hide, return
// to the launcher and reconnect, so the callback fires often and MOST of those pushes contain
// nothing this screen renders differently. Each one used to blow away and rebuild the entire list.
// Mid-scroll, that is exactly the reported "glitchy scrolling": the nodes under your finger are
// destroyed and recreated, momentum scrolling breaks, and a tap in flight lands on nothing.
let _lastSegHTML = '';
let _lastBodyHTML = '';

/** @param {{fromData?: boolean}} opts  `fromData` marks a re-render triggered by a remote update
 *  rather than by the viewer navigating: the scroll position is theirs and must survive it.
 *  Navigation legitimately starts the new screen at the top. */
function rerender({ fromData = false } = {}) {
  if (!_host) return;
  const segEl = _host.querySelector('[data-role="lb-segs"]');
  const bodyEl = _host.querySelector('[data-role="lb-body"]');
  const segHTML = segsHTML();
  const bodyHTML = _connected ? currentBody() : skeletonHTML();
  if (segEl && segHTML !== _lastSegHTML) { segEl.innerHTML = segHTML; _lastSegHTML = segHTML; }
  if (bodyEl && bodyHTML !== _lastBodyHTML) {
    // `.lb-overlay` (_host) is the scroll container, not the body element, so it survives the
    // innerHTML swap - but the browser clamps scrollTop while the replaced content has zero height,
    // which is what silently threw the viewer back to the top of a long board.
    const keepTop = fromData ? _host.scrollTop : 0;
    bodyEl.innerHTML = bodyHTML;
    _lastBodyHTML = bodyHTML;
    _host.scrollTop = keepTop;
  }
}

function renderOffline() {
  const bodyEl = _host && _host.querySelector('[data-role="lb-body"]');
  if (bodyEl) bodyEl.innerHTML = `<p class="lb-none">${t('lb_offline')}</p>`;
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (_menu) { _menu = null; rerender(); return; }   // Esc closes an open dropdown FIRST, ahead of everything else
  if (_playerGame) { _playerGame = null; rerender(); return; }   // Esc backs out of a player's game first
  if (_player) { _player = null; rerender(); return; }   // then out of a player before a game
  if (_game) { _game = null; rerender(); return; }   // Esc backs out of a game before closing
  closeLeaderboard();
}

function onClick(e) {
  // Outside click closes an open dropdown. Checked BEFORE every other handler (including the
  // scrim's own [data-role="lb-close"], which would otherwise close the whole overlay) so a tap
  // meant only to dismiss the menu can't also open a player detail or close the panel.
  if (_menu && !e.target.closest('.lb-menu, [data-menu]')) { _menu = null; rerender(); return; }
  const menuBtn = e.target.closest('[data-menu]');
  if (menuBtn) { _menu = _menu === menuBtn.dataset.menu ? null : menuBtn.dataset.menu; rerender(); return; }
  const mitem = e.target.closest('.lb-mitem');
  if (mitem) {
    if (mitem.dataset.tier !== undefined) {
      const raw = mitem.dataset.tier;
      _diff = raw === '' ? null : Number(raw);
    } else if (mitem.dataset.sort) {
      _sort = mitem.dataset.sort;
      saveSort(_sort);
    }
    _menu = null;
    rerender();
    return;
  }
  if (e.target.closest('[data-role="lb-close"]')) { closeLeaderboard(); return; }
  if (e.target.closest('[data-role="lb-pgame-back"]')) { _playerGame = null; rerender(); return; }
  if (e.target.closest('[data-role="lb-player-back"]')) { _player = null; _playerGame = null; rerender(); return; }
  if (e.target.closest('[data-role="lb-back"]')) { _game = null; rerender(); return; }
  const seg = e.target.closest('.lb-seg');
  if (seg && seg.dataset.seg) {
    const next = seg.dataset.seg;
    if (next === _seg && !_game && !_player) return;
    _seg = next; _game = null; _player = null; _playerGame = null; rerender();
    return;
  }
  const card = e.target.closest('.lb-pcard[data-pkey]');
  if (card) { _player = card.dataset.pkey; _playerGame = null; rerender(); return; }
  // Player detail's own game list (shared gs-grow rows) vs. the top-level By Game list (lb-grow) -
  // only one of the two is ever on screen at once, but check player context first to be explicit.
  const gsRow = e.target.closest('.gs-grow[data-game]');
  if (gsRow && _player) { _playerGame = gsRow.dataset.game; rerender(); return; }
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
  ensureStatsCss();   // the player detail screen reuses My Stats' gs-* renderers/markup verbatim
  closeLeaderboard();
  _seg = 'players';
  _game = null;
  _player = null;
  _playerGame = null;
  _diff = null;   // resets to All every time the overlay opens (not persisted, D7)
  _sort = loadSort();   // persisted across opens (D6)
  _menu = null;
  _all = {};
  _connected = false;
  _meKey = '';   // resolved in currentBody() once records load (identity needs the whole graph)
  _lastSegHTML = '';   // the skip-identical-render cache belongs to one open overlay, never across two
  _lastBodyHTML = '';
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
    _unsub = await watchPlayers((all) => { _all = all || {}; _connected = true; rerender({ fromData: true }); });
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
    // overscroll-behavior:contain stops SCROLL CHAINING. Without it, a flick that reaches the top or
    // bottom of this overlay keeps going and scrolls the hub launcher underneath it - so the board
    // rubber-bands, the page behind moves, and closing the overlay lands somewhere you never chose.
    // The overlay is position:fixed over a scrollable body, which is exactly the case the browser
    // chains by default.
    '.lb-overlay{position:fixed;inset:0;z-index:300;opacity:0;transition:opacity .2s ease;overflow-y:auto;overscroll-behavior:contain}',
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
    // padding-top (not touching --gh-band-controls, shared with the hub top bar/My Stats) trims
    // the gap under .lb-top's border to ~8px (Matt's spacing note 1, 2026-07-29).
    '.lb-segs{display:flex;align-items:center;gap:6px;min-height:var(--gh-band-controls,36px);padding:8px 16px 0;background:var(--hub-bg,#f4f6fb)}',
    '.lb-seg{flex:1 1 0;appearance:none;cursor:pointer;padding:8px 12px;font-size:12px;font-weight:700;color:var(--hub-muted,#5b6b82);background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:999px}',
    '.lb-seg.is-active{color:#fff;font-weight:800;background:var(--hub-ink,#16243a);border-color:var(--hub-ink,#16243a)}',
    // Control row (2026-07-29): filter + sort dropdown triggers, replacing the old pill row.
    // Shared 34px height, same band as the old pills.
    '.lb-ctrls{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:var(--gh-band-filter,34px)}',
    '.lb-ctrl{position:relative;display:flex;align-items:center;gap:6px;min-width:0}',
    '.lb-ctrl-lbl{font-size:.72rem;font-weight:700;color:var(--hub-muted,#5b6b82)}',
    '.lb-ctrl-btn{appearance:none;cursor:pointer;border-radius:999px;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);color:var(--hub-ink,#16243a);padding:5px 11px;font-size:.76rem;font-weight:800}',
    // Sort menu anchors right (under its trigger, right-aligned row); filter menu anchors left.
    '.lb-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:3;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;box-shadow:0 8px 24px rgba(20,40,80,.16);padding:4px;min-width:150px}',
    '.lb-ctrl-sort .lb-menu{left:auto;right:0}',
    '.lb-mitem{display:flex;align-items:center;gap:7px;width:100%;text-align:left;appearance:none;cursor:pointer;background:none;border:0;padding:8px 10px;border-radius:8px;font-size:.82rem;font-weight:700;color:var(--hub-ink,#16243a)}',
    '.lb-mitem.is-sel{background:var(--hub-surface-2,#eef2f8)}',
    // The checkmark is CSS-only (never hue alone) so a selected diff item's shape/color stays
    // exactly as diffShapeSVG rendered it - the ✓ is the selection signal, not a recolor.
    '.lb-mitem.is-sel::after{content:"\\2713";margin-left:auto;font-weight:900}',
    // No base `fill` declared here (2026-07-24): diffShapeSVG's svg now carries its own inline
    // fill (the TIER_COLOR per tier); circle/rect inherit it since neither has a fill of its own.
    '.lb-dshape{width:11px;height:11px;display:block}',
    '.lb-dshape-x2{width:19px;height:11px}',
    '.lb-body{padding:10px 16px 8px}',
    '.lb-h3{margin:18px 0 8px;font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--hub-muted,#5b6b82)}',
    // Player/game-detail card list.
    '.lb-plist{display:flex;flex-direction:column;gap:9px;margin-top:8px}',
    // .lb-pcard is a <button> (every card opens the player detail screen) - reset the native
    // button chrome so it still reads as the same card, not a form control.
    '.lb-pcard{display:block;width:100%;text-align:left;font:inherit;color:inherit;appearance:none;cursor:pointer;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:14px;padding:11px 12px;box-shadow:0 4px 16px rgba(20,40,80,.06)}',
    '.lb-pcard.is-me{box-shadow:inset 0 0 0 1.5px var(--hub-accent,#1769d4),0 4px 16px rgba(20,40,80,.06)}',
    '.lb-pcard.is-skel{opacity:.65;cursor:default}',
    '.lb-pchev{flex:0 0 auto;color:var(--hub-muted,#5b6b82);font-size:1.1rem;line-height:1;margin-left:1px}',
    // Tic Tac Toe's game-page card: Ultimate/Classic (+ an honest fallback for un-split legacy
    // history) instead of the single wins number every other game's card shows.
    '.lb-tt-split{display:flex;gap:14px;margin:8px 0 0 34px}',
    '.lb-tt-val{display:flex;flex-direction:column;line-height:1.15}',
    '.lb-tt-val b{font-size:1.1rem;font-weight:800;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    '.lb-tt-val span{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--hub-muted,#5b6b82)}',
    '.lb-tt-val.is-fallback{opacity:.7}',
    // Player detail screen (drill-in from any card).
    '.lb-pdetail-head{display:flex;align-items:center;gap:10px;margin:4px 0 6px}',
    '.lb-pdetail-head .lb-av{width:34px;height:34px;font-size:1.2rem}',
    '.lb-pdetail-id{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.lb-pdetail-name{font-size:1.05rem;font-weight:800;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-pdetail-meta{font-size:.76rem;font-weight:600;color:var(--hub-muted,#5b6b82)}',
    '.lb-pmsg{margin:0 0 12px;padding:10px 12px;border-radius:12px;background:var(--hub-surface-2,#f4f4f5);color:var(--hub-ink,#18181b);font-size:14px;line-height:1.4;overflow-wrap:anywhere}',
    '.lb-pgame{margin-top:10px}',
    // The multiplayer chip in a game board's tier row: same pill geometry as .lb-tile2 so the row
    // stays even, but a text tag where the ski-slope shape goes (see mpTileHTML for why).
    '.lb-tile-mp .lb-mp-tag{font-style:normal;font-size:.6rem;font-weight:900;letter-spacing:.04em;color:var(--hub-muted,#5b6b82)}',
    '.lb-pcard-row{display:flex;align-items:center;gap:8px}',
    '.lb-medal{flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.76rem;font-weight:900;background:#f1f4f9;color:var(--hub-muted,#5b6b82)}',
    '.lb-medal.is-gold{background:#f5c518;color:#5c4a00}',
    '.lb-medal.is-silver{background:#d9dee6;color:#3a4453}',
    '.lb-medal.is-bronze{background:#e0b490;color:#5c3a1e}',
    '.lb-av{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--hub-surface-2,#eef2f8);font-size:.9rem;line-height:1}',
    '.lb-av.is-initial{font-size:.7rem;font-weight:900;color:var(--hub-muted,#5b6b82)}',
    '.lb-pname{flex:1 1 auto;min-width:0;font-size:1.15rem;font-weight:800;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-pnum{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;line-height:1.15}',
    '.lb-pnum b{font-size:1.45rem;font-weight:700;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    '.lb-pnum span{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--hub-muted,#5b6b82)}',
    '.lb-pmeta{margin:4px 0 0 34px;font-size:.72rem;font-weight:600;color:var(--hub-muted,#5b6b82)}',
    // Row 2: tier tiles (left) + the other number, small and muted (right) - one line, wrapper
    // owns the indent/margin the tiles used to carry on their own.
    '.lb-pfoot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0 0 34px}',
    '.lb-psub{flex:0 0 auto;font-size:.74rem;font-weight:700;color:var(--hub-muted,#5b6b82);font-variant-numeric:tabular-nums}',
    '.lb-tiles{display:flex;flex-wrap:wrap;gap:5px;margin:0}',
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
