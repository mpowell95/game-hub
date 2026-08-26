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
// Two segments (By Player / By Game, renamed from Standings/Games) plus a shared difficulty
// dropdown filter (All/Easy/Medium/Hard/Expert, 2026-07-29 - the old 5-pill row is gone) that
// filters both. Colorblind-safe: menu items carry a
// SHAPE per tier (circle/square/diamond/double-diamond), never hue alone; the viewer's own row uses
// a border highlight, never color alone.
//
// 2026-08-25 DESIGN HANDOFF ("Leaderboard and My Stats", screens 1/2/3). What changed and why the
// next session should not quietly undo it:
//
//  - SIX CATEGORIES, not four tiers. Easy/Medium/Hard/Expert still mean what they meant, and two
//    more join them so that EVERY play a person makes lands in exactly one cell: NT (a game with
//    no difficulty axis at all - Skeeball machines, Pinball tables, Hill Climb stages), counted as
//    RUNS, and VS (a win against a real person, the `mp` bucket). Before this, a Skeeball rack or
//    an online Escoba win counted in the total and appeared in no chip beside it, so the strip
//    never added up. THE LAW rule 1's spirit: a number the screen can show, it shows.
//  - The headline number FOLLOWS the filter, and its unit word follows with it (wins / runs /
//    vs wins). The selected category is marked in two places: the filter button and a filled key
//    badge in the strip.
//  - NOTHING SCROLLS SIDEWAYS. The filter is a full-width select button that opens a stacked list
//    of 44px options in place; the strip is a 3x2 grid so all six fit at 360px with no truncation.
//    There is no chip rail and no horizontal scroller anywhere on these screens.
//  - RANK CHIPS CARRY SHAPE, never hue: 1st filled square, 2nd heavy outlined rounded square, 3rd
//    thin outlined circle, 4th and below a plain numeral. Ties get a dashed chip and a T prefix.
//    (This replaced the gold/silver/bronze medals, which were hue alone - Matt is red/green
//    colorblind.) Rank is computed from the CATEGORY VALUE with ties, never from the row's
//    position, so re-sorting by name cannot renumber the podium.
//  - #ffce3a marks the selected sort pill, the selected list option and the selected key badge.
//    Nothing else. It is never first place, never a win, never "good".
//  - A saved DEFAULT VIEW (sort + category, and By Game's own sort) per device, see VIEW_KEY.
//  - A game board with no difficulty axis gets no difficulty filter. Skeeball gets a MACHINE
//    filter in its place, which belongs to that visit and is deliberately not persisted.

import { aggregatePlayers, buildIdentity, SOLO } from './players-agg.js';
import { corrections } from './admin-config.js';
import { watchPlayers } from './stats-net.js';
import { loadProfile } from './profile-store.js';
import { statsId } from './game-stats.js';
import { bucketsOf, tierMix } from './leaderboard-rank.js';
import { TIERS, diffShapeSVG, TIER_COLOR } from './difficulty-tiers.js';
import { GAME_ART } from './game-art.js';
import { loadFavorites } from './favorites.js';
import { screenFor, ensureStatsCss, gameListHTML as gsGameListHTML, hubIdOf, unitKeyOf, SK_MACHINES, skMachineMeta } from './game-stats-ui.js';
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
// WHO ACTUALLY RUNS TEST ROUNDS, from Matt, 2026-08-26: test1, test2 and MattyIce. NOBODY ELSE.
// He said it after a session called *TP* - a real player, and the board's most-played account - a
// test account on the strength of its initials. Do not infer "test" from a name's shape, from
// initials, from an odd play count, or from a name you do not recognise: every name in this family
// is a real person until Matt says otherwise, and hiding one makes their whole history vanish from
// the board (THE LAW rule 1). Adding a name here needs him to name it.
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
// (which resets to All every open), the sort choice PERSISTS across opens (Matt, D6).
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

// --- saved default view (2026-08-25 handoff, "Default view") -----------------------------------
// gamehub.lb.view.v1 - the sort + category pair By Player OPENS on, plus By Game's own sort.
// A PREFERENCE, one-tap recreatable, so THE LAW rule 2's carve-out applies (same class as
// favorites/theme/language). SORT_KEY above is NOT repurposed and NOT deleted (rule 5): it stays
// exactly as it was and is read once, as the seed for `sort`, so a device that already chose a
// sort keeps it the first time this ships.
const VIEW_KEY = 'gamehub.lb.view.v1';
const VALID_CATS = new Set(['all', '1', '2', '3', '4', 'NT', 'VS']);
const VALID_GAME_SORTS = new Set(['alpha', 'popular', 'fav']);
/** Stored cats are strings (JSON has no distinction between 1 and '1'); tiers live in memory as
 *  NUMBERS, because every helper below compares them against `bucketsOf`'s numeric tier. */
function catFromStored(v) { return v === '1' || v === '2' || v === '3' || v === '4' ? Number(v) : v; }
function catToStored(v) { return typeof v === 'number' ? String(v) : v; }
function loadView() {
  const fallback = { sort: loadSort(), cat: 'all', gameSort: 'alpha' };
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return fallback;
    return {
      sort: VALID_SORTS.has(v.sort) ? v.sort : fallback.sort,
      cat: VALID_CATS.has(String(v.cat)) ? catFromStored(String(v.cat)) : 'all',
      gameSort: VALID_GAME_SORTS.has(v.gameSort) ? v.gameSort : 'alpha',
    };
  } catch { return fallback; }
}
function saveView(view) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      version: 1, sort: view.sort, cat: catToStored(view.cat), gameSort: view.gameSort, updatedAt: Date.now(),
    }));
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
  // Skeeball is BACK on the board 2026-08-24, the day its hub entry dropped `devOnly` and took a
  // fresh released date (Classic playable, the other two machines goal-unlocked). It was off from
  // 2026-08-23 (pulled back the day after its first release) to now. NOTHING WAS LOST either way
  // (THE LAW rule 1) - every play stayed in every device's store and in players/. It is also out
  // of players-agg.test.mjs's OFF_THE_BOARD now; the two can never disagree.
  { id: 'skeeball', labelKey: 'game_title_skeeball' },
  // Pinball joined the board 2026-08-24, the day the admin control page shipped (js/admin-config.js).
  // It is still `devOnly` in js/hub.js, but `devOnly` is now only a DEFAULT: Matt can release a game
  // to everyone from inside the app, with no commit and no deploy - so a game cannot wait for its
  // GAME_META row to be added by the release commit any more. Without a row here every Pinball score
  // would be worth zero on the board the moment it was released, while My Stats showed it: THE LAW
  // rule 1, and exactly how Yahtzee shipped. The row costs nothing while the game is hidden -
  // gameListHTML only renders a game somebody has actually played.
  { id: 'pinball', labelKey: 'game_title_pinball' },
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

// --- the six categories (2026-08-25 handoff) ---------------------------------
// 1-4 are the shared difficulty tiers. 'NT' is every play in a bucket that maps to NO tier and is
// not multiplayer - Skeeball's machines, Pinball's tables, Hill Climb's stages, plus 'legacy' and
// any unmapped vocabulary - counted as RUNS, because in a game with no opponent a run is the only
// honest unit. 'VS' is the `mp` bucket, counted as WINS against real people.
//
// Partition guarantee, and the reason this is safe to sum: bucketsOf() emits one bucket per
// byDiff key plus a synthetic remainder bucket, so every recorded play appears in exactly one
// bucket, and every bucket falls into exactly one of the six by (tier, key). Nothing is
// double-counted and nothing is dropped.
const CATS = [
  { id: 1, nameKey: 'gs_diff_beginner', keyKey: 'lb_key_t1' },
  { id: 2, nameKey: 'gs_diff_intermediate', keyKey: 'lb_key_t2' },
  { id: 3, nameKey: 'gs_diff_pro', keyKey: 'lb_key_t3' },
  { id: 4, nameKey: 'gs_diff_expert', keyKey: 'lb_key_t4' },
  { id: 'NT', nameKey: 'lb_cat_nt', keyKey: 'lb_key_nt' },
  { id: 'VS', nameKey: 'lb_cat_vs', keyKey: 'lb_key_vs' },
];
const CAT_ALL = { id: 'all', nameKey: 'lb_cat_all', keyKey: 'lb_key_all' };
const catMeta = (id) => (id === 'all' ? CAT_ALL : CATS.find((c) => c.id === id) || CAT_ALL);

/** Runs: plays in tier-less, non-multiplayer buckets, across EVERY game (a run only exists in a
 *  game with no difficulty axis, but reading over ALL_IDS also picks up 'legacy' history in a
 *  tiered game, which is exactly where that history belongs - it has no tier either). */
function runsOf(g) {
  let n = 0;
  for (const id of ALL_IDS) for (const b of bucketsOf(g.games[id])) if (b.tier == null && b.key !== 'mp') n += b.played;
  return n;
}
/** Wins against real people: the `mp` bucket, across every game that has online play. */
function vsWinsOf(g) {
  let n = 0;
  for (const id of ALL_IDS) for (const b of bucketsOf(g.games[id])) if (b.key === 'mp') n += b.wins;
  return n;
}
/** The number one person shows for one category. 'all' is the cross-game wins number, UNCHANGED
 *  (competitive games only - a solo run is not a win, HANDOFF-LB-SOLO-RUNS.md, still in force).
 *
 *  KNOWN, DELIBERATE: the four tier cells plus VS do not always add up to 'all'. A COMPETITIVE
 *  game whose difficulty bucket maps to no tier (Yahtzee records 'ai', folded history records
 *  'legacy') contributes its wins to 'all' and its PLAYS to NT, so those wins appear in no cell.
 *  The alternative is worse: NT would have to carry wins and runs in one number, and a solo game
 *  has no wins to carry. Nothing is hidden - every one of those plays is on the game's own board
 *  and on My Stats - and nothing is invented, which is the line rule 4 draws. If a future session
 *  wants the strip to reconcile exactly, the fix is at the WRITER (give those games a real tier),
 *  not here. */
function catValueOf(g, cat) {
  if (cat === 'NT') return runsOf(g);
  if (cat === 'VS') return vsWinsOf(g);
  if (cat === 'all') return winsOf(g, null);
  return winsAtTier(g, COMP_IDS, cat);
}
/** The unit word under the headline number, which follows the filter. */
function catUnit(cat) {
  if (cat === 'NT') return t('lb_unit_runs');
  if (cat === 'VS') return t('lb_unit_vs_wins');
  return t('lb_wins_unit');
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
/** Skeeball's best single rack. GUARD: NEVER winsAtTier for this game. recordSkeeball calls
 *  bumpTotals(..., true), so every rack is stored as a "win" and wins is just played wearing a
 *  different label - the card showed the same number twice, one of them meaningless (Matt,
 *  2026-08-22, from the live board: "6 PLAYED / 6 wins"). Solo games rank on a BEST, the way Ball
 *  Run, Snake and Hill Climb already do; this game only ever fell through to wins because it had
 *  no case here.
 *
 *  Tier-blind on purpose: Skeeball's byDiff is keyed by MACHINE (classic, popongo), and
 *  tierOf('classic') is null, so there is no tier to slice a best by. gameDetail already drops
 *  rows with no plays at the selected tier, so this is only ever asked with tier null today.
 *  When the filter becomes a MACHINE filter, read sk.boards[machine].best here. */
function skBestAt(g, machine) {
  const sk = g.games.skeeball && g.games.skeeball.sk;
  if (!sk) return 0;
  if (!machine || machine === 'all') return sk.bestGame | 0;
  return ((sk.boards || {})[machine] || {}).best | 0;   // the per-machine record, exactly as stored
}
/** Skeeball's plays, machine-filtered. Its byDiff IS keyed by machine, so playsAtTier cannot slice
 *  it (tierOf('classic') is null); the per-board record is the stored answer. */
function skPlaysAt(g, machine) {
  const sk = g.games.skeeball && g.games.skeeball.sk;
  if (!sk) return 0;
  if (!machine || machine === 'all') return sk.played | 0;
  return ((sk.boards || {})[machine] || {}).plays | 0;
}
function gameMetricAt(g, id, tier) {
  if (id === 'ballrun') return brBestAt(g, tier);
  if (id === 'snake') return snBestAt(g, tier);
  if (id === 'hillclimb') return hcBestAt(g, tier);
  if (id === 'skeeball') return skBestAt(g, _machine);
  return winsAtTier(g, [id], tier);
}
/** Plays for one game, honoring whichever filter that game's board actually offers. */
function boardPlaysOf(g, id) {
  return id === 'skeeball' ? skPlaysAt(g, _machine) : playsAtTier(g, [id], _tier);
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

// --- control row: sort pills + an in-place select panel (2026-08-25 handoff) -------------------
// Supersedes the 2026-07-29 anchored dropdowns (HANDOFF-LB-FILTER-SORT.md's D4). Same two
// decisions, different mechanics, for one reason: NOTHING MAY SCROLL SIDEWAYS and nothing may
// float over the list on a 393px phone. Sort is three 44px pills sharing the row's width;
// the filter is a full-width 44px select button that opens a STACKED list of 44px options IN
// PLACE, pushing the list down, so it can never be clipped by the overlay's own scroll container.
// `_panel` (null|'cat'|'machine') tracks which one is open; rerender() closes/opens it by
// re-emitting this markup, same as every other piece of state in this file.
const SORT_ITEMS_DEFAULT = [
  { sort: 'wins', labelKey: 'lb_sort_wins' },
  { sort: 'played', labelKey: 'lb_sort_played_short' },
  { sort: 'alpha', labelKey: 'lb_sort_name' },
];
// A game board's third sort option is labeled by ITS OWN metric (Wins/Obstacles/Longest/Solved),
// keyed off the same unitKeyOf() map/game-stats-ui.js already uses for the metric's own unit.
const UNIT_TO_SORT_LABEL = {
  lb_unit_wins: 'lb_sort_wins',
  lb_unit_obstacles: 'lb_sort_obstacles',
  lb_unit_longest: 'lb_sort_longest',
  lb_unit_solved: 'lb_sort_solved',
  lb_unit_meters: 'lb_sort_meters',
  // Skeeball and Pinball both rank on points; without this row both sort menus said "Wins".
  lb_unit_points: 'lb_sort_points',
};
function sortItemsFor(id) {
  const labelKey = UNIT_TO_SORT_LABEL[unitKeyOf(id)] || 'lb_sort_wins';
  return [
    { sort: 'wins', labelKey },
    { sort: 'played', labelKey: 'lb_sort_games_short' },
    { sort: 'alpha', labelKey: 'lb_sort_name' },
  ];
}
// By Game's own three orders, remembered the same way By Player's are (saved default view).
// 'fav' reads js/favorites.js, the launcher's own favorites list, keyed by HUB id.
const GAME_SORTS = [
  { sort: 'alpha', labelKey: 'lb_gsort_alpha' },
  { sort: 'popular', labelKey: 'lb_gsort_popular' },
  { sort: 'fav', labelKey: 'lb_gsort_fav', star: true },
];

/** The three sort pills. `active` is compared against `_sort` (player/board) or `_gameSort`
 *  (By Game), whichever `attr` names, so one renderer serves both. */
function sortPillsHTML(items, current, attr) {
  return `<div class="lb-pills" role="group">${items.map((it) => {
    const sel = current === it.sort;
    return `<button type="button" class="lb-pill${sel ? ' is-sel' : ''}" data-${attr}="${it.sort}"`
      + `${sel ? ' aria-pressed="true"' : ' aria-pressed="false"'}>`
      + `${it.star ? '<i class="lb-star" aria-hidden="true">★</i>' : ''}${esc(t(it.labelKey))}</button>`;
  }).join('')}</div>`;
}

/** The select button that opens a stacked panel below itself. `kind` is the panel id ('cat' or
 *  'machine'); `label` is the whole button text, already framed ("Showing: Everything"). */
function selectBtnHTML(kind, label) {
  const open = _panel === kind;
  return `<button type="button" class="lb-select${open ? ' is-open' : ''}" data-panel="${kind}" aria-haspopup="listbox" aria-expanded="${open}">
    <span>${esc(label)}</span>
    <svg class="lb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
  </button>`;
}

/** One option row inside an open panel: 44px, key badge (never hue alone), name, optional count,
 *  and a checkmark on the selected one. */
function optionHTML({ attr, value, keyText, name, count, selected }) {
  return `<button type="button" role="option" aria-selected="${selected}" class="lb-opt${selected ? ' is-sel' : ''}" data-${attr}="${value}">
    ${keyText ? `<i class="lb-key${selected ? ' is-sel' : ''}">${esc(keyText)}</i>` : ''}
    <span class="lb-opt-nm">${esc(name)}</span>
    ${count == null ? '' : `<span class="lb-opt-n">${count}</span>`}
    <span class="lb-tick" aria-hidden="true">${selected ? '✓' : ''}</span>
  </button>`;
}

/** By Player's category filter: the select button, and (when open) all seven options with the
 *  field-wide total beside each, plus the save-as-default row. */
function catControlsHTML(list) {
  const cur = catMeta(_cat);
  const total = (id) => list.reduce((a, g) => a + catValueOf(g, id), 0);
  const isDefault = _saved.sort === _sort && _saved.cat === _cat;
  const panel = _panel !== 'cat' ? '' : `<div class="lb-panel-list" role="listbox" aria-label="${esc(t('lb_cat_filter_aria'))}">
    ${[CAT_ALL, ...CATS].map((c) => optionHTML({
      attr: 'cat', value: catToStored(c.id), keyText: t(c.keyKey), name: t(c.nameKey),
      count: total(c.id), selected: _cat === c.id,
    })).join('')}
    <button type="button" class="lb-default${isDefault ? ' is-set' : ''}" data-role="lb-default"${isDefault ? ' disabled' : ''}>${esc(t(isDefault ? 'lb_is_default' : 'lb_make_default'))}</button>
  </div>`;
  return `<div class="lb-ctrls">
    ${sortPillsHTML(SORT_ITEMS_DEFAULT, _sort, 'sort')}
    ${selectBtnHTML('cat', t('lb_showing', { name: t(cur.nameKey) }))}
    ${panel}
  </div>`;
}

/** A game board's own filter, under its three sort pills.
 *
 *  Which filter a board gets is a property of the GAME, not a constant:
 *   - a game with difficulty tiers gets the tier filter, listing ONLY the tiers the field has
 *     actually played (`fieldTiers`) - offering Expert where no Expert bucket exists invites a
 *     tap that empties the board for no reason;
 *   - Skeeball's axis is MACHINES, so it gets a machine filter instead (the handoff: offering a
 *     difficulty filter on a game with no difficulty is wrong). That choice belongs to this visit
 *     and is deliberately not persisted;
 *   - a game with neither gets no filter at all, and the row is just the sort pills.
 *  Tier items keep their SHAPE (`diffShapeSVG`), never hue alone. */
function boardControlsHTML(id, fieldTiers, machineIds) {
  const pills = sortPillsHTML(sortItemsFor(id), _sort, 'sort');
  if (id === 'skeeball' && machineIds.length > 1) {
    const cur = _machine === 'all' ? t('lb_machine_all') : skMachineMeta(_machine).name;
    const panel = _panel !== 'machine' ? '' : `<div class="lb-panel-list" role="listbox" aria-label="${esc(t('lb_machine_filter_aria'))}">
      ${optionHTML({ attr: 'machine', value: 'all', keyText: '', name: t('lb_machine_all'), count: null, selected: _machine === 'all' })}
      ${machineIds.map((mid) => optionHTML({
        attr: 'machine', value: mid, keyText: '', name: skMachineMeta(mid).name, count: null, selected: _machine === mid,
      })).join('')}
    </div>`;
    return `<div class="lb-ctrls">${pills}${selectBtnHTML('machine', t('lb_machine_label', { name: cur }))}${panel}</div>`;
  }
  if (!fieldTiers.length) return `<div class="lb-ctrls">${pills}</div>`;
  const curTier = DIFF_PILLS.find((p) => p.tier === _tier) || DIFF_PILLS[0];
  const panel = _panel !== 'cat' ? '' : `<div class="lb-panel-list" role="listbox" aria-label="${esc(t('lb_diff_filter_aria'))}">
    ${[null, ...fieldTiers].map((tier) => {
      const meta = DIFF_PILLS.find((p) => p.tier === tier);
      return `<button type="button" role="option" aria-selected="${_tier === tier}" class="lb-opt${_tier === tier ? ' is-sel' : ''}" data-tier="${tier == null ? '' : tier}" style="--lb-pill-color:${tier ? TIER_COLOR[tier] : 'currentColor'}">
        <span class="lb-opt-shape">${tier ? diffShapeSVG(tier) : ''}</span>
        <span class="lb-opt-nm">${esc(t(meta.labelKey))}</span>
        <span class="lb-tick" aria-hidden="true">${_tier === tier ? '✓' : ''}</span>
      </button>`;
    }).join('')}
  </div>`;
  return `<div class="lb-ctrls">${pills}${selectBtnHTML('cat', t('lb_showing', { name: t(curTier.labelKey) }))}${panel}</div>`;
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
    const sel = _tier === tier ? ' is-sel' : '';
    const empty = v == null ? ' is-empty' : '';
    return `<span class="lb-tile2${sel}${empty}" style="--lb-pill-color:${TIER_COLOR[tier]}" title="${esc(t(TIER_LABEL_KEY[tier]))}">${diffShapeSVG(tier)}<b>${v == null ? '&mdash;' : v}</b></span>`;
  }).join('')}</div>`;
}

/** The category breakdown on a LIST CARD: ONE line, never two (Matt, 2026-08-25, seeing the 3x2
 *  grid on a real phone - "the 6 difficulty boxes take up a lot of space"). It replaced a six-cell
 *  grid that cost ~105px of every card; this costs ~20px.
 *
 *  Three rules make one line enough, and each is load-bearing:
 *   1. A category with NO plays is not drawn. Most people have played two or three of the six, so
 *      most cards are two or three chips wide. The card is a SUMMARY - all six always render on
 *      the player's own detail screen (catGridHTML), so nothing becomes unreachable.
 *   2. The SELECTED category is pinned first and drawn even at zero, so filtering to Expert shows
 *      you the zero rather than emptying the row and leaving you wondering.
 *   3. The rest follow by value, and anything past MAX_CHIPS collapses into a +N chip rather than
 *      wrapping or being clipped. NO WRAP AND NO SIDEWAYS SCROLL: the row must fit 360px with the
 *      widest number in the system (112,730) in it, which is what MAX_CHIPS is sized for. Tapping
 *      the card opens the detail screen, where the collapsed ones are.
 *  A chip is a key badge plus a number - the badge is the label, and it is never hue alone. */
// A chip's width is its padding plus its characters, so the cap is BOTH a chip count and a
// character budget: three short chips fit where three six-digit ones would not. Measured against
// the narrowest supported screen (360px, which leaves a ~300px row) at the chip's 12.5px/800
// tabular type, with room kept for the +N. Numbers here are wins and runs, which are in the
// thousands today - the budget is what stops a future six-digit one from silently clipping.
const MAX_CHIPS = 3;
const CHIP_CHARS = 20;
function catStripHTML(g) {
  const vals = CATS.map((c) => ({ c, v: catValueOf(g, c.id) }));
  const pinned = vals.filter((x) => x.c.id === _cat);
  const rest = vals.filter((x) => x.c.id !== _cat && x.v > 0).sort((a, b) => b.v - a.v);
  const candidates = pinned.concat(rest);
  const shown = [];
  let chars = 0;
  for (const x of candidates) {
    const cost = t(x.c.keyKey).length + String(x.v).length;
    // The pinned category always earns its place; the rest have to fit.
    if (shown.length && (shown.length >= MAX_CHIPS || chars + cost > CHIP_CHARS)) break;
    shown.push(x);
    chars += cost;
  }
  if (!shown.length) return '';
  const hidden = candidates.length - shown.length;
  const chips = shown.map(({ c, v }) => {
    const sel = _cat === c.id;
    return `<span class="lb-chipv${sel ? ' is-sel' : ''}" title="${esc(t(c.nameKey))}">`
      + `<i class="lb-key${sel ? ' is-sel' : ''}">${esc(t(c.keyKey))}</i><b>${v}</b></span>`;
  });
  if (hidden > 0) chips.push(`<span class="lb-chipv is-more">+${hidden}</span>`);
  return `<div class="lb-strip">${chips.join('')}</div>`;
}

/** The same six categories in full, on the player's own detail screen: a 3x2 grid that fits 360px
 *  with nothing truncated. This is where every category is always shown, including the zeroes and
 *  the ones the card's one-line strip collapsed - so the card can stay a summary without any
 *  number becoming unreachable (THE LAW rule 1). */
function catGridHTML(g) {
  return `<div class="lb-grid6">${CATS.map((c) => {
    const sel = _cat === c.id;
    return `<span class="lb-cell${sel ? ' is-sel' : ''}">
      <span class="lb-cell-top"><i class="lb-key${sel ? ' is-sel' : ''}">${esc(t(c.keyKey))}</i><em>${esc(t(c.nameKey))}</em></span>
      <b>${catValueOf(g, c.id)}</b>
    </span>`;
  }).join('')}</div>`;
}

// --- By Player ---------------------------------------------------------------
/** Rank chips carry SHAPE, never hue (Matt is red/green colorblind, and the gold/silver/bronze
 *  medals this replaced were hue alone): 1st filled square, 2nd heavy outlined rounded square,
 *  3rd thin outlined circle, 4th and below a plain numeral with no chrome. A tie gets a dashed
 *  chip and a T prefix, and the next rank skips accordingly. Print it in greyscale: the podium
 *  is still readable. */
function rankChipHTML(rank, tie) {
  const cls = rank === 1 ? ' is-r1' : rank === 2 ? ' is-r2' : rank === 3 ? ' is-r3' : '';
  return `<span class="lb-chip${cls}${tie ? ' is-tie' : ''}">${tie ? 'T' : ''}${rank}</span>`;
}

/** Standard competition ranking over `list` by `valueOf`, with ties sharing a rank and the next
 *  rank skipping. Returns { rankOf, tiedAt } keyed by group key, so a row's chip never depends on
 *  which order the list happens to be SORTED in - re-sorting by name cannot renumber the podium. */
function rankMap(list, valueOf) {
  const ranked = list.slice().sort((a, b) => valueOf(b) - valueOf(a));
  const rankOf = {};
  const countAt = {};
  let prev = null;
  let rank = 0;
  ranked.forEach((g, i) => {
    const v = valueOf(g);
    if (v !== prev) { rank = i + 1; prev = v; }
    rankOf[g.key] = rank;
    countAt[rank] = (countAt[rank] || 0) + 1;
  });
  return { rankOf, tiedAt: (key) => countAt[rankOf[key]] > 1 };
}

/** The "this is you" marker, which is a LABEL, not a color: a filled YOU badge beside the name
 *  plus the row's own accent rail (see .lb-pcard.is-me). Never hue alone. */
function youBadge(g) { return g.key === _meKey ? `<i class="lb-you">${esc(t('lb_you'))}</i>` : ''; }

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
function playerCardHTML(g, chip, big, subText, tilesHtml) {
  const me = g.key === _meKey ? ' is-me' : '';
  // Row 2 is the breakdown alone; the OTHER number moved under the name (row 1) in the 2026-08-25
  // handoff, so the card reads name / what they played on one line and the breakdown below it.
  const footer = tilesHtml ? `<div class="lb-pfoot">${tilesHtml}</div>` : '';
  return `<button type="button" class="lb-pcard${me}" data-pkey="${esc(g.key)}"${me ? ' aria-current="true"' : ''}>
    <div class="lb-pcard-row">
      ${chip}
      ${avatarHTML(g)}
      <span class="lb-pid"><span class="lb-pname">${rankName(g)}</span>${youBadge(g)}<span class="lb-psubline">${esc(subText || '')}</span></span>
      <span class="lb-pnum"><b>${big.val}</b><span>${esc(big.unit)}</span></span>
    </div>
    ${footer}
  </button>`;
}

/** By Player sort (D5/D6): 'alpha' | 'played' | 'wins', persisted in `_sort`. Row filter is
 *  WIDENED 2026-08-25: every player with any recorded play is listed whatever the category is,
 *  so nobody vanishes for choosing to play differently (see the note in the body). */
function playerListHTML(list) {
  // EVERY person with any recorded play is listed, whatever category is selected (2026-08-25).
  // The old code filtered the list by the tier as well, so picking Expert made everyone who had
  // never played an Expert game disappear from the board entirely; now the filter changes what
  // the headline number COUNTS, and the strip shows the other five categories regardless, so
  // nobody vanishes for choosing to play differently.
  const rows = list.filter((g) => playedOf(g, null) > 0);
  if (!rows.length) return emptyState(t('lb_empty_all'));
  const value = (g) => catValueOf(g, _cat);
  // THE BADGE RANKS BY WHATEVER THE LIST IS SORTED BY, when that sort is a MEASURE (2026-08-26).
  // rankMap's own comment says the chip must not depend on the list's order, so that re-sorting
  // by name cannot renumber the podium - which is right for NAME, and was applied to all three
  // sorts without anyone checking the middle one. Sorting by Played DOES produce a ranking (the
  // list is literally in order of most played), so a badge frozen to the wins order sat beside it
  // reading 1, 2, 6, 3, 5, 4. Matt, from the live board: "Why did that break?"
  // Alphabetical is not a ranking, so it keeps the wins podium exactly as before.
  const { rankOf, tiedAt } = rankMap(rows, _sort === 'played' ? (g) => playedOf(g, null) : value);
  if (_sort === 'alpha') {
    rows.sort((a, b) => {
      const n = (a.name || '').localeCompare(b.name || '');
      if (n) return n;
      const w = value(b) - value(a);
      if (w) return w;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  } else if (_sort === 'played') {
    rows.sort((a, b) => {
      const p = playedOf(b, null) - playedOf(a, null);
      if (p) return p;
      const w = value(b) - value(a);
      if (w) return w;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  } else {   // 'wins' - the selected category's own number
    rows.sort((a, b) => {
      const w = value(b) - value(a);
      if (w) return w;
      const p = playedOf(a, null) - playedOf(b, null);   // fewer plays wins ties (today's tie-break, preserved)
      if (p) return p;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }
  return `<div class="lb-plist">${rows.map((g) => {
    const played = playedOf(g, null);
    // THE HEADLINE NUMBER IS WHAT YOU SORTED BY. Matt, 2026-08-26: "Before you touched the
    // leaderboard tonight, it showed the played number when I clicked on played and the wins
    // number when I clicked on wins. Now it doesn't do that."
    //
    // He is right that it used to, and this is where it went: the 2026-08-25 redesign (1a789aa)
    // replaced this pair of lines with a flat `value(g)`, so the card kept its wins headline no
    // matter which pill was lit. Sorted by Played the big numbers then ran 3103, 269, 100, 23, 36,
    // 54 - out of order, because they were not the thing the list was ordered by, which reads as a
    // broken board however correct the ordering underneath is.
    //
    // gameDetail below never lost this (see its own `big`), so the two screens had drifted apart.
    // Restored here in the redesign's category vocabulary: the category value is still what the
    // Wins and Name sorts lead with, and the OTHER number moves to the subline either way.
    const big = _sort === 'played'
      ? { val: played, unit: unitWord('lb_played_count') }
      : { val: value(g), unit: catUnit(_cat) };
    const subText = _sort === 'played'
      ? `${value(g)} ${catUnit(_cat)}`
      : t('lb_played_count', { n: played });
    return playerCardHTML(g, rankChipHTML(rankOf[g.key], tiedAt(g.key)), big, subText, catStripHTML(g));
  }).join('')}</div>`;
}

// --- By Game ------------------------------------------------------------------
// Every game, always, in one of three orders (2026-08-25). A game NOBODY has played still gets a
// row - it says so in words and sorts to the bottom, rather than dropping off the list, so "22
// games" always reads as 22 games. The favorites order reads js/favorites.js, the same list the
// launcher's own star writes, so a game starred on the hub is starred here too.
function gameListHTML(list) {
  let favs = [];
  try { favs = loadFavorites() || []; } catch { favs = []; }
  const isFav = (id) => favs.includes(hubIdOf(id));
  const rows = gameMetaSorted().map((meta) => {
    const plays = list.reduce((a, g) => a + playsAtTier(g, [meta.id], null), 0);
    const leaders = list.filter((g) => gameMetricAt(g, meta.id, null) > 0)
      .sort((a, b) => gameMetricAt(b, meta.id, null) - gameMetricAt(a, meta.id, null) || (b.updatedAt || 0) - (a.updatedAt || 0));
    return { meta, plays, lead: leaders.length ? leaders[0] : null, fav: isFav(meta.id) };
  });
  rows.sort((a, b) => {
    // Unplayed games always sink, in every order: they have no leader to rank.
    if (!a.plays !== !b.plays) return a.plays ? -1 : 1;
    if (_gameSort === 'popular' && b.plays !== a.plays) return b.plays - a.plays;
    if (_gameSort === 'fav' && a.fav !== b.fav) return a.fav ? -1 : 1;
    return t(a.meta.labelKey).localeCompare(t(b.meta.labelKey));
  });
  const cards = rows.map(({ meta, lead, fav }) => {
    const art = GAME_ART[hubIdOf(meta.id)] || '';
    const body = lead
      ? `<span class="lb-glead">${avatarHTML(lead)}<span class="lb-glead-nm">${rankName(lead)}</span></span>`
      : `<span class="lb-glead lb-glead-empty">${esc(t('lb_no_games_yet'))}</span>`;
    const metric = lead
      ? `<span class="lb-gnum"><b>${gameMetricAt(lead, meta.id, null)}</b><span>${esc(t(unitKeyOf(meta.id)))}</span></span>`
      : `<span class="lb-gnum is-empty"><b>&mdash;</b><span>${esc(t('lb_no_games_yet'))}</span></span>`;
    return `<button type="button" class="lb-grow${lead ? '' : ' is-empty'}" data-game="${meta.id}">
      <span class="lb-gart">${art}</span>
      <span class="lb-gmain">
        <span class="lb-gtitle">${fav ? '<i class="lb-star" aria-hidden="true">★</i>' : ''}<span class="lb-gname">${esc(t(meta.labelKey))}</span></span>
        ${body}
      </span>
      ${metric}
    </button>`;
  });
  if (!cards.length) return emptyState(t('lb_empty_all'));
  return `<div class="lb-ctrls">${sortPillsHTML(GAME_SORTS, _gameSort, 'gsort')}</div><div class="lb-glist">${cards.join('')}</div>`;
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
    { labelKey: 'lb_tex_sk_points', get: (g) => (((g.games.skeeball || {}).sk || {}).points) | 0 },
    // POPONGO's all-four-colors objective. Recorded since 2026-08-22 and shown nowhere until now.
    // A record with no positive value is skipped by recordsHTML, so this stays invisible until
    // somebody actually sweeps.
    { labelKey: 'lb_tex_sk_sweeps', get: (g) => (((g.games.skeeball || {}).sk || {}).colorSweeps) | 0 },
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
function sumGrid(grid, side) {
  if (!grid || !grid[side]) return 0;
  let n = 0;
  for (const d of Object.keys(grid[side])) n += (grid[side][d] || {}).w | 0;
  return n;
}

/** "Standing records" (2026-08-25; this is the old "who leads what" chip row, re-presented).
 *  Each record is a VALUE, a LABEL and the PERSON who holds it, in a two-column grid with a
 *  hairline between cells; an odd last record spans both columns rather than leaving a hole.
 *  They are LIFETIME figures and are deliberately unaffected by the board's filter - several of
 *  them (Chinchon closes, Boggle words) have no per-tier storage at all, so a filtered version
 *  would have to be invented. */
function recordsHTML(list, id) {
  const specs = TEXTURE[id];
  if (!specs) return '';
  const cells = [];
  specs.forEach((spec) => {
    let best = null;
    for (const g of list) {
      const v = spec.get(g) | 0;
      if (v > 0 && (!best || v > best.v)) best = { v, g };
    }
    if (!best) return;
    // `show` lets a record rank on a number but DISPLAY something else (Boggle's longest word).
    const shown = spec.show ? esc(spec.show(best.g) || String(best.v)) : String(best.v);
    cells.push(`<div class="lb-rec"><b>${shown}</b><span>${esc(t(spec.labelKey))}</span><em>${avatarHTML(best.g)}${rankName(best.g)}</em></div>`);
  });
  if (!cells.length) return '';
  if (cells.length % 2) cells[cells.length - 1] = cells[cells.length - 1].replace('class="lb-rec"', 'class="lb-rec is-wide"');
  return `<h3 class="lb-h3">${esc(t('lb_records_h'))}</h3><div class="lb-recs">${cells.join('')}</div>`;
}

// Tic Tac Toe's game page shows the Ultimate/Classic split instead of one wins number (Matt:
// "tic tac toe leaderboard just show ultimate vs classic") — same not-a-draw rule per variant as
// leaderboard-rank.js's record() (wins = the stored `won`, ties excluded; Matt, 2026-07-28),
// computed straight from the `tt` sub-counter, which has no per-tier
// storage (like Chinchón closes/Boggle words in recordsHTML below), so it is filter-INDEPENDENT:
// the difficulty pills still gate which players are listed (via the generic total/byDiff bucket),
// but never change these two numbers. `tt` stores `tied` explicitly, so this needs no derivation.
function ttVariantWins(v) { return Math.max(0, Math.min((v && v.won) | 0, (v && v.played) | 0)); }

// Two side-by-side numbers, no single headline value — left STRUCTURALLY ALONE by the 2026-07-29
// filter/sort redesign (HANDOFF-LB-FILTER-SORT.md §3.5): no big/small swap, no secondary number.
// They still sit under the new control row, and Alphabetical/Games Played still reorder them
// (see sortRows below) — only the "wins" sort (this game's own metric) keeps its bespoke order.
function ttCardHTML(g, chip) {
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
      ${chip}
      ${avatarHTML(g)}
      <span class="lb-pid"><span class="lb-pname">${rankName(g)}</span>${youBadge(g)}<span class="lb-psubline">${esc(t('lb_played_count', { n: boardPlaysOf(g, 'tictactoe') }))}</span></span>
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
// ARE per-tier storage, so this one respects the board's own difficulty filter (`_tier`), unlike ttCardHTML.
// Same "leave structurally alone" note as ttCardHTML above applies here (§3.5).
function snCardHTML(g, chip) {
  const me = g.key === _meKey ? ' is-me' : '';
  const off = snBestAtWalls(g, _tier, 'off');
  const on = snBestAtWalls(g, _tier, 'on');
  return `<button type="button" class="lb-pcard${me}" data-pkey="${esc(g.key)}"${me ? ' aria-current="true"' : ''}>
    <div class="lb-pcard-row">
      ${chip}
      ${avatarHTML(g)}
      <span class="lb-pid"><span class="lb-pname">${rankName(g)}</span>${youBadge(g)}<span class="lb-psubline">${esc(t('lb_played_count', { n: boardPlaysOf(g, 'snake') }))}</span></span>
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
      const m = gameMetricAt(b, id, _tier) - gameMetricAt(a, id, _tier);
      if (m) return m;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return;
  }
  if (sort === 'played') {
    rows.sort((a, b) => {
      const p = boardPlaysOf(b, id) - boardPlaysOf(a, id);
      if (p) return p;
      const m = gameMetricAt(b, id, _tier) - gameMetricAt(a, id, _tier);
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
      const m = gameMetricAt(b, id, _tier) - gameMetricAt(a, id, _tier);
      if (m) return m;
      const p = boardPlaysOf(a, id) - boardPlaysOf(b, id);
      if (p) return p;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }
}

/** Which machines this field has actually played, in the game's own chain order. Only these are
 *  offered in the machine filter: a machine nobody has touched would filter the board to nothing. */
function skMachinesPresent(list) {
  const seen = new Set();
  for (const g of list) {
    const sk = (g.games.skeeball || {}).sk || {};
    for (const mid of Object.keys(sk.boards || {})) if (((sk.boards[mid] || {}).plays | 0) > 0) seen.add(mid);
  }
  // Known machines in the game's own chain order first, then anything else the store holds - an
  // id this file has never heard of still has to be reachable (THE LAW rule 1, see skMachineMeta).
  return Object.keys(SK_MACHINES).filter((mid) => seen.has(mid))
    .concat([...seen].filter((mid) => !SK_MACHINES[mid]));
}

function gameDetail(list, id) {
  const fieldTiers = id === 'skeeball' ? [] : fieldTiersPresent(list, [id]);
  const machineIds = id === 'skeeball' ? skMachinesPresent(list) : [];
  const totalPlays = list.reduce((a, g) => a + boardPlaysOf(g, id), 0);
  // Screen 3's header: the way back, the game's name at full size, and how much this game has
  // been played by everyone, which is the one number that says whether the board means anything.
  const head = `<div class="lb-board-head">
    <button type="button" class="lb-back" data-role="lb-back">
      <svg class="lb-back-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
      ${esc(t('lb_by_game'))}
    </button>
    <div class="lb-board-id">
      <h3 class="lb-board-h">${esc(labelOf(id))}</h3>
      <span class="lb-board-n"><b>${totalPlays}</b><span>${esc(t('lb_games_unit'))}</span></span>
    </div>
  </div>`;
  const controls = boardControlsHTML(id, fieldTiers, machineIds);
  const showMp = anyMpPlays(list, id);
  const rows = list.filter((g) => boardPlaysOf(g, id) > 0);
  // Same rule as By Player above: the badge follows the sort when the sort is a measure. This
  // board scrambled identically under "Games Played" - the badge stayed on the game's own metric.
  const { rankOf, tiedAt } = rankMap(rows, _sort === 'played'
    ? (g) => boardPlaysOf(g, id)
    : (g) => gameMetricAt(g, id, _tier));
  sortRows(rows, id, _sort);
  const cardsHtml = rows.length
    ? `<div class="lb-plist is-board">${rows.map((g) => {
        const chip = rankChipHTML(rankOf[g.key], tiedAt(g.key));
        if (id === 'tictactoe') return ttCardHTML(g, chip);
        if (id === 'snake') return snCardHTML(g, chip);
        const metric = gameMetricAt(g, id, _tier);
        const played = boardPlaysOf(g, id);
        const tiles = miniTilesHTML(fieldTiers, (tier) => (playsAtTier(g, [id], tier) > 0 ? gameMetricAt(g, id, tier) : null))
          + (showMp ? mpTileHTML(g, id) : '');
        const metricUnit = t(unitKeyOf(id));
        const big = _sort === 'played' ? { val: played, unit: unitWord('lb_played_count') } : { val: metric, unit: metricUnit };
        const subText = _sort === 'played' ? `${metric} ${metricUnit}` : t('lb_played_count', { n: played });
        return playerCardHTML(g, chip, big, subText, tiles);
      }).join('')}</div>`
    : emptyState(t('lb_empty_game', { label: labelOf(id) }));
  return head + controls + cardsHtml + recordsHTML(list, id);
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
  // The same six-cell strip By Player shows, so a person's whole mix reads identically on both
  // screens - and every play they have made is on it, not just the four tiered ones.
  const head = `<div class="lb-detail-top">
    <button type="button" class="lb-back" data-role="lb-player-back">${backLabel}</button>
  </div>
  <div class="lb-pdetail-head">
    ${avatarHTML(g)}
    <span class="lb-pdetail-id">
      <span class="lb-pdetail-name">${rankName(g)}${youBadge(g)}</span>
      <span class="lb-pdetail-meta">${t('lb_played_count', { n: played })}</span>
    </span>
    <span class="lb-pnum"><b>${wins}</b><span>${t('lb_wins_unit')}</span></span>
  </div>
  ${catGridHTML(g)}`;
  return head + messageHTML(g) + gsGameListHTML(g.games);
}

// --- shared shell -------------------------------------------------------------
function emptyState(msg) { return `<p class="lb-none">${esc(msg)}</p>`; }

/** Fixed-height placeholder cards in the real card list's geometry, so the panel does not jump
 *  when live data lands (the repo's fixed-geometry convention, CLAUDE.md/Escoba's .eb-table note). */
function skeletonHTML(rows = 6) {
  const card = () => `<div class="lb-pcard is-skel">
    <div class="lb-pcard-row">
      <span class="lb-chip"><span class="lb-sk lb-sk-n"></span></span>
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
  // Admin score corrections (js/stats-corrections.js) are applied inside the aggregation, per
  // device record. The board is the one screen where a score thrown on a broken machine does the
  // most damage, so it reads them like every other surface.
  const list = aggregatePlayers(recs, corrections()).filter((g) => !isHiddenRow(g));
  try { _meKey = buildIdentity(recs).keyFor(loadProfile() || {}, statsId()); } catch { /* keep */ }
  if (_player) return playerDetail(list, _player);
  if (_game) return gameDetail(list, _game);
  // Each list owns its own control row now (By Game's is three sort pills and no filter), so the
  // shell no longer emits one on their behalf.
  return _seg === 'games' ? gameListHTML(list) : catControlsHTML(list) + playerListHTML(list);
}

let _host = null;
let _seg = 'players';       // 'players' | 'games'
let _game = null;           // non-null => showing that game's detail board
let _player = null;         // non-null (a group key) => showing that player's detail screen
let _playerGame = null;     // non-null => drilled into that game from WITHIN player detail
let _cat = 'all';           // 'all' | 1-4 | 'NT' | 'VS' - By Player's category filter (opens on the saved default)
let _tier = null;           // null (All) | 1-4 - a GAME BOARD's own difficulty filter, reset per board
let _machine = 'all';       // 'all' | a Skeeball machine id - that board's filter, deliberately not persisted
let _sort = 'wins';         // 'alpha' | 'played' | 'wins' (or a game's own metric on a game board) - persisted, see loadView/saveView
let _gameSort = 'alpha';    // 'alpha' | 'popular' | 'fav' - By Game's own order, persisted the same way
let _saved = { sort: 'wins', cat: 'all' };   // what "Make this my default view" last stored, for the row's own label
let _panel = null;          // null | 'cat' | 'machine' - which in-place select panel is open
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
  if (_panel) { _panel = null; rerender(); return; }   // Esc closes an open select panel FIRST, ahead of everything else
  if (_playerGame) { _playerGame = null; rerender(); return; }   // Esc backs out of a player's game first
  if (_player) { _player = null; rerender(); return; }   // then out of a player before a game
  if (_game) { _game = null; rerender(); return; }   // Esc backs out of a game before closing
  closeLeaderboard();
}

function onClick(e) {
  // Outside click closes an open select panel. Checked BEFORE every other handler (including the
  // scrim's own [data-role="lb-close"], which would otherwise close the whole overlay) so a tap
  // meant only to dismiss the panel can't also open a player detail or close the overlay.
  if (_panel && !e.target.closest('.lb-panel-list, [data-panel]')) { _panel = null; rerender(); return; }
  const panelBtn = e.target.closest('[data-panel]');
  if (panelBtn) { _panel = _panel === panelBtn.dataset.panel ? null : panelBtn.dataset.panel; rerender(); return; }
  // The sort pills stay in place; the panel options close the panel behind them.
  const pill = e.target.closest('[data-sort],[data-gsort]');
  if (pill) {
    if (pill.dataset.gsort) { _gameSort = pill.dataset.gsort; saveView({ sort: _sort, cat: _cat, gameSort: _gameSort }); }
    else { _sort = pill.dataset.sort; saveSort(_sort); saveView({ sort: _sort, cat: _cat, gameSort: _gameSort }); }
    rerender();
    return;
  }
  const opt = e.target.closest('.lb-opt');
  if (opt) {
    if (opt.dataset.cat !== undefined) _cat = catFromStored(opt.dataset.cat);
    else if (opt.dataset.tier !== undefined) _tier = opt.dataset.tier === '' ? null : Number(opt.dataset.tier);
    else if (opt.dataset.machine !== undefined) _machine = opt.dataset.machine;
    _panel = null;
    rerender();
    return;
  }
  // "Make this my default view": stores the sort + category pair By Player opens on next time.
  // A preference, one tap to set and one tap to change, so THE LAW rule 2's carve-out applies.
  if (e.target.closest('[data-role="lb-default"]')) {
    _saved = { sort: _sort, cat: _cat };
    saveView({ sort: _sort, cat: _cat, gameSort: _gameSort });
    rerender();
    return;
  }
  if (e.target.closest('[data-role="lb-close"]')) { closeLeaderboard(); return; }
  if (e.target.closest('[data-role="lb-pgame-back"]')) { _playerGame = null; rerender(); return; }
  if (e.target.closest('[data-role="lb-player-back"]')) { _player = null; _playerGame = null; rerender(); return; }
  // Leaving a board drops that board's own filters: they belong to the visit, not to the overlay.
  if (e.target.closest('[data-role="lb-back"]')) { _game = null; _tier = null; _machine = 'all'; rerender(); return; }
  const seg = e.target.closest('.lb-seg');
  if (seg && seg.dataset.seg) {
    const next = seg.dataset.seg;
    if (next === _seg && !_game && !_player) return;
    _seg = next; _game = null; _player = null; _playerGame = null; _tier = null; _machine = 'all'; rerender();
    return;
  }
  const card = e.target.closest('.lb-pcard[data-pkey]');
  if (card) { _player = card.dataset.pkey; _playerGame = null; rerender(); return; }
  // Player detail's own game list (shared gs-grow rows) vs. the top-level By Game list (lb-grow) -
  // only one of the two is ever on screen at once, but check player context first to be explicit.
  const gsRow = e.target.closest('.gs-grow[data-game]');
  if (gsRow && _player) { _playerGame = gsRow.dataset.game; rerender(); return; }
  const row = e.target.closest('.lb-grow');
  if (row && row.dataset.game) { _game = row.dataset.game; _tier = null; _machine = 'all'; rerender(); }
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
  // The saved default view (2026-08-25): By Player opens on the sort + category this device chose,
  // By Game on its own saved order. A board's own filters are per-visit and start clean.
  const view = loadView();
  _sort = view.sort;
  _cat = view.cat;
  _gameSort = view.gameSort;
  _saved = { sort: view.sort, cat: view.cat };
  _tier = null;
  _machine = 'all';
  _panel = null;
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
    // --- tokens (2026-08-25 handoff) -----------------------------------------------------------
    // These screens carry their OWN palette rather than borrowing --hub-* directly, because the
    // handoff defines a value for every colour in both themes and they have to move together.
    // The values sit inside the hub's existing ones (same bg/surface/ink/muted), so the overlay
    // still reads as part of the app. Dark is a CLASS on <html> (js/theme.js), never a
    // prefers-color-scheme query: the player's explicit choice has to win.
    '.lb-overlay{--lb-bg:#f4f6fb;--lb-surface:#ffffff;--lb-surface-2:#eef2f8;--lb-ink:#16243a;--lb-muted:#5b6b82;--lb-line:#dde5ef;--lb-accent:#1769d4;--lb-accent-text:#1769d4;--lb-sel:#ffce3a;--lb-sel-ink:#16243a}',
    ':root.gh-dark .lb-overlay{--lb-bg:#0e1420;--lb-surface:#1b2333;--lb-surface-2:#2b3547;--lb-ink:#e9eef6;--lb-muted:#9db0c9;--lb-line:#33405a;--lb-accent:#1769d4;--lb-accent-text:#6db0fb;--lb-sel:#ffce3a;--lb-sel-ink:#16243a}',
    // overscroll-behavior:contain stops SCROLL CHAINING. Without it, a flick that reaches the top or
    // bottom of this overlay keeps going and scrolls the hub launcher underneath it - so the board
    // rubber-bands, the page behind moves, and closing the overlay lands somewhere you never chose.
    // The overlay is position:fixed over a scrollable body, which is exactly the case the browser
    // chains by default. scrollbar-width:none keeps a gutter from eating the 393px column.
    '.lb-overlay{position:fixed;inset:0;z-index:300;opacity:0;transition:opacity .2s ease;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}',
    '.lb-overlay::-webkit-scrollbar{width:0;height:0;display:none}',
    '.lb-overlay.is-in{opacity:1}',
    '.lb-scrim{position:fixed;inset:0;background:rgba(9,24,48,.5)}',
    '.lb-panel{position:relative;width:100%;max-width:620px;margin:0 auto;min-height:100%;background:var(--lb-bg);color:var(--lb-ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.lb-top{position:sticky;top:0;z-index:2;padding:max(env(safe-area-inset-top,0px),8px) 16px 0;background:var(--lb-surface);border-bottom:1px solid var(--lb-line)}',
    // css/hub.css carries its own :root.gh-dark .lb-top background; this one is more specific so
    // the header follows THESE tokens in both themes rather than two sources disagreeing.
    ':root.gh-dark .lb-panel .lb-top{background:var(--lb-surface)}',
    '.lb-top-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:var(--gh-band-title,44px)}',
    '.lb-top h2{margin:0;font-size:28px;font-weight:800;letter-spacing:-.025em;line-height:1;color:var(--lb-ink)}',
    '.lb-x{appearance:none;border:0;background:none;color:var(--lb-muted);font-size:26px;line-height:1;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer}',
    // The two segments, as one hairline-joined control (never a scrolling rail).
    '.lb-segs{display:flex;gap:1px;background:var(--lb-line);border:1px solid var(--lb-line);border-radius:9px;overflow:hidden;margin:0 16px 12px}',
    '.lb-seg{flex:1 1 0;appearance:none;cursor:pointer;border:0;min-height:44px;font-size:13px;font-weight:800;color:var(--lb-muted);background:var(--lb-surface)}',
    '.lb-seg.is-active{color:var(--lb-surface);background:var(--lb-ink)}',
    // css/hub.css paints the active segment with --hub-accent in dark, which predates these
    // tokens and leaves dark text on a mid blue. The inverted-ink fill reads in both themes, so
    // this takes it back with one more class of specificity rather than editing hub.css (whose
    // rule still covers any older markup that might render outside this panel).
    ':root.gh-dark .lb-panel .lb-seg.is-active{background:var(--lb-ink);border-color:var(--lb-ink);color:var(--lb-surface)}',
    '.lb-body{padding:0 16px 24px}',
    // --- controls: three sort pills, then a full-width select that opens IN PLACE ---------------
    '.lb-ctrls{display:flex;flex-direction:column;gap:7px;margin:0 0 12px}',
    '.lb-pills{display:flex;gap:6px}',
    // #ffce3a marks the selected pill and nothing else on these screens; the pressed state also
    // carries weight and an inset ring, so it is never colour alone.
    '.lb-pill{flex:1 1 0;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0 8px;white-space:nowrap;font-size:12.5px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid var(--lb-line);background:transparent;color:var(--lb-muted)}',
    '.lb-pill.is-sel{border-color:var(--lb-sel);background:var(--lb-sel);color:var(--lb-sel-ink);box-shadow:inset 0 0 0 1px var(--lb-sel)}',
    '.lb-star{font-style:normal;font-size:12px;line-height:1}',
    '.lb-select{width:100%;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 12px;cursor:pointer;font-size:13px;font-weight:800;color:var(--lb-ink);background:var(--lb-surface-2);border:1px solid var(--lb-line);border-radius:8px}',
    '.lb-select.is-open{border-radius:8px 8px 0 0}',
    '.lb-caret{width:15px;height:15px;flex:none}',
    '.lb-select.is-open .lb-caret{transform:rotate(180deg)}',
    '.lb-panel-list{display:flex;flex-direction:column;gap:1px;background:var(--lb-line);border:1px solid var(--lb-line);border-top:0;border-radius:0 0 10px 10px;overflow:hidden;margin-top:-7px}',
    '.lb-opt{width:100%;min-height:44px;display:flex;align-items:center;gap:9px;padding:0 12px;cursor:pointer;font-size:13px;font-weight:600;color:var(--lb-ink);background:var(--lb-surface);border:0;text-align:left}',
    '.lb-opt.is-sel{font-weight:800;background:var(--lb-surface-2);box-shadow:inset 3px 0 0 var(--lb-sel)}',
    '.lb-opt-nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-opt-n{flex:none;font-size:13px;font-weight:700;color:var(--lb-muted);font-variant-numeric:tabular-nums}',
    '.lb-opt-shape{flex:none;display:flex;align-items:center;width:19px}',
    '.lb-tick{flex:none;width:12px;font-size:12px;font-weight:900;color:var(--lb-ink)}',
    // The key badge: one or two characters, always beside the full name, filled when selected.
    '.lb-key{flex:none;font-style:normal;font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--lb-muted);border:1px solid var(--lb-line);border-radius:3px;padding:1px 4px;background:transparent}',
    '.lb-key.is-sel{color:var(--lb-sel-ink);background:var(--lb-sel);border-color:var(--lb-sel)}',
    '.lb-default{width:100%;min-height:44px;border:0;cursor:pointer;font-size:12.5px;font-weight:800;background:var(--lb-surface);color:var(--lb-accent-text)}',
    '.lb-default.is-set{color:var(--lb-muted);cursor:default}',
    // --- the card list ------------------------------------------------------------------------
    '.lb-plist{display:flex;flex-direction:column;gap:8px}',
    // .lb-pcard is a <button> (every card opens the player detail screen) - reset the native
    // button chrome so it still reads as the same card, not a form control.
    '.lb-pcard{display:block;width:100%;text-align:left;font:inherit;color:inherit;appearance:none;cursor:pointer;background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:12px;padding:12px 13px}',
    // "This is you" is a LABEL (the YOU badge) plus an accent rail, never colour alone.
    '.lb-pcard.is-me{border-left:3px solid var(--lb-accent);background:var(--lb-surface-2)}',
    '.lb-pcard.is-skel{opacity:.65;cursor:default}',
    '.lb-pcard-row{display:flex;align-items:center;gap:11px}',
    // Rank chips: shape first, so the podium survives greyscale (see rankChipHTML).
    '.lb-chip{flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.01em;color:var(--lb-muted);background:transparent;border:1px solid transparent;border-radius:5px}',
    '.lb-chip.is-r1{background:var(--lb-ink);color:var(--lb-surface);border:2px solid var(--lb-ink);border-radius:5px}',
    '.lb-chip.is-r2{color:var(--lb-ink);border:2px solid var(--lb-ink);border-radius:11px}',
    '.lb-chip.is-r3{color:var(--lb-ink);border:1px solid var(--lb-ink);border-radius:50%}',
    '.lb-chip.is-tie{border:1px dashed var(--lb-line);font-size:12px}',
    '.lb-av{flex:none;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:var(--lb-surface-2);border:1px solid var(--lb-line);font-size:21px;line-height:1}',
    '.lb-av.is-initial{font-size:17px;font-weight:800;color:var(--lb-ink)}',
    '.lb-pid{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:0 6px}',
    '.lb-pname{max-width:100%;font-size:15px;font-weight:700;color:var(--lb-ink);letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-pcard.is-me .lb-pname{font-weight:800}',
    '.lb-you{flex:none;font-style:normal;font-size:11px;font-weight:800;letter-spacing:.1em;background:var(--lb-ink);color:var(--lb-surface);padding:3px 5px;border-radius:3px}',
    '.lb-psubline{flex:1 0 100%;font-size:11.5px;color:var(--lb-muted);margin-top:2px;font-variant-numeric:tabular-nums}',
    '.lb-pnum{flex:none;display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1}',
    '.lb-pnum b{font-size:23px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.025em}',
    '.lb-pnum span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--lb-muted);margin-top:3px}',
    '.lb-pfoot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:11px}',
    // --- the six-category strip: 3 by 2, so it fits 360px with nothing truncated ----------------
    // The card's one-line strip. NO WRAP: `flex-wrap:nowrap` plus a chip count capped in JS
    // (MAX_CHIPS) is what keeps it to one line without ever clipping a number - a row that could
    // overflow would need either a second line or a sideways scroll, and neither is allowed here.
    '.lb-strip{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;width:100%;min-width:0}',
    '.lb-chipv{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:7px;background:var(--lb-surface-2);font-size:12.5px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums}',
    '.lb-chipv.is-sel{box-shadow:inset 0 0 0 1px var(--lb-sel)}',
    '.lb-chipv.is-more{color:var(--lb-muted);font-weight:700}',
    // The full six, on the player detail screen only (see catGridHTML).
    '.lb-grid6{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:var(--lb-line);border:1px solid var(--lb-line);border-radius:8px;overflow:hidden;width:100%}',
    '.lb-cell{display:flex;flex-direction:column;background:var(--lb-surface);padding:8px 6px 9px;min-width:0}',
    '.lb-cell.is-sel{background:var(--lb-surface-2)}',
    '.lb-cell-top{display:flex;align-items:baseline;gap:4px;min-width:0}',
    '.lb-cell-top em{font-style:normal;font-size:11px;color:var(--lb-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-cell b{font-size:15px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.01em;margin-top:3px}',
    // A game board's per-tier tiles (unchanged shape vocabulary, new chrome).
    '.lb-tiles{display:flex;flex-wrap:wrap;gap:5px;margin:0}',
    '.lb-tile2{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;background:var(--lb-surface-2);border:1.5px solid transparent;font-size:12px;font-weight:800;color:var(--lb-muted)}',
    '.lb-tile2 .lb-dshape{fill:var(--lb-pill-color,#5b6b82)}',
    '.lb-tile2.is-sel{border-color:var(--lb-pill-color,#1c2430);color:var(--lb-ink);background:var(--lb-surface)}',
    '.lb-tile2.is-empty{opacity:.55}',
    '.lb-tile-mp .lb-mp-tag{font-style:normal;font-size:11px;font-weight:900;letter-spacing:.04em;color:var(--lb-muted)}',
    '.lb-dshape{width:11px;height:11px;display:block}',
    '.lb-dshape-x2{width:19px;height:11px}',
    // Tic Tac Toe / Snake: two headline numbers instead of one (see ttCardHTML, snCardHTML).
    '.lb-tt-split{display:flex;gap:22px;margin:11px 0 0 45px}',
    '.lb-tt-val{display:flex;flex-direction:column;line-height:1}',
    '.lb-tt-val b{font-size:22px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.025em}',
    '.lb-tt-val span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--lb-muted);margin-top:4px}',
    '.lb-tt-val.is-fallback{opacity:.7}',
    // --- By Game ------------------------------------------------------------------------------
    '.lb-glist{display:flex;flex-direction:column;gap:8px}',
    '.lb-grow{appearance:none;cursor:pointer;display:flex;align-items:center;gap:12px;width:100%;min-height:64px;text-align:left;padding:9px 11px;background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:11px;font:inherit;color:inherit}',
    '.lb-grow.is-empty{opacity:.72}',
    // Each game ships its own inline SVG at roughly 3:2 - dropped in at its own aspect, clipped to
    // the radius, never recoloured or filtered in either theme (handoff, "Game art is real").
    '.lb-gart{flex:none;width:58px;height:39px;border-radius:6px;overflow:hidden;line-height:0;background:var(--lb-surface-2)}',
    '.lb-gart svg{width:100%;height:100%;display:block}',
    '.lb-gmain{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
    '.lb-gtitle{display:flex;align-items:center;gap:5px;min-width:0}',
    '.lb-gname{font-size:15px;font-weight:800;color:var(--lb-ink);letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-glead{display:flex;align-items:center;gap:5px;min-width:0;font-size:12px;color:var(--lb-muted)}',
    '.lb-glead .lb-av{width:18px;height:18px;font-size:12px;border:0;background:transparent}',
    '.lb-glead-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-glead-empty{font-style:italic}',
    '.lb-gnum{flex:none;display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1}',
    '.lb-gnum b{font-size:19px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em}',
    '.lb-gnum span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--lb-muted);margin-top:3px}',
    '.lb-gnum.is-empty b{color:var(--lb-muted)}',
    // --- a game board (screen 3) ----------------------------------------------------------------
    '.lb-board-head{display:flex;flex-direction:column;gap:10px;margin:0 0 12px}',
    '.lb-back{align-self:flex-start;appearance:none;cursor:pointer;min-height:44px;display:flex;align-items:center;gap:7px;background:none;border:0;padding:0 6px 0 0;color:var(--lb-accent-text);font-size:14px;font-weight:600}',
    '.lb-back-i{width:16px;height:16px;flex:none}',
    '.lb-board-id{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}',
    '.lb-board-h{margin:0;font-size:28px;font-weight:800;letter-spacing:-.025em;color:var(--lb-ink);line-height:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-board-n{flex:none;display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1}',
    '.lb-board-n b{font-size:19px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums}',
    '.lb-board-n span{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--lb-muted);margin-top:3px}',
    // --- standing records -----------------------------------------------------------------------
    '.lb-h3{margin:20px 0 9px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.13em;color:var(--lb-muted)}',
    '.lb-recs{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--lb-line);border:1px solid var(--lb-line);border-radius:10px;overflow:hidden}',
    '.lb-rec{background:var(--lb-surface);padding:12px 13px 13px;min-width:0}',
    '.lb-rec.is-wide{grid-column:span 2}',
    '.lb-rec b{display:block;font-size:20px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1.05;overflow-wrap:anywhere}',
    '.lb-rec span{display:block;font-size:11px;color:var(--lb-muted);margin-top:3px;line-height:1.3}',
    '.lb-rec em{display:flex;align-items:center;gap:5px;min-width:0;font-style:normal;font-size:11.5px;font-weight:700;color:var(--lb-ink);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-rec .lb-av{width:18px;height:18px;font-size:12px;border:0;background:transparent}',
    // --- player detail (screen 4) ----------------------------------------------------------------
    '.lb-detail-top{display:flex;align-items:center;gap:10px;min-height:44px}',
    '.lb-pdetail-head{display:flex;align-items:center;gap:11px;margin:4px 0 11px}',
    '.lb-pdetail-head .lb-av{width:42px;height:42px;font-size:22px}',
    '.lb-pdetail-id{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.lb-pdetail-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:18px;font-weight:800;color:var(--lb-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-pdetail-meta{font-size:11.5px;font-weight:600;color:var(--lb-muted)}',
    '.lb-pmsg{margin:12px 0 0;padding:11px 13px;border-radius:12px;background:var(--lb-surface-2);border:1px solid var(--lb-line);color:var(--lb-ink);font-size:14px;line-height:1.4;overflow-wrap:anywhere}',
    '.lb-pgame{margin-top:10px}',
    // --- skeleton + empty -------------------------------------------------------------------------
    '.lb-sk{display:inline-block;width:100%;height:11px;border-radius:5px;background:var(--lb-surface-2);vertical-align:middle}',
    '.lb-sk-n{width:14px}', '.lb-sk-w{width:60%}',
    '.lb-none{margin:8px 0 0;color:var(--lb-muted);font-size:14px;font-weight:600;background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:12px;padding:22px 16px;text-align:center}',
    // The only motion on these screens is the panel/disclosure open, and it becomes an instant
    // swap under prefers-reduced-motion, losing no information.
    '@media (prefers-reduced-motion:reduce){.lb-overlay{transition:none}}',
  ].join('');
  document.head.appendChild(el);
}

export default { openLeaderboard, closeLeaderboard };
