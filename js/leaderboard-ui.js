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
//    no difficulty axis at all - Skeeball machines, Hill Climb stages), counted as
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
//  - The tab, both sorts and the category are REMEMBERED per device as they change, see VIEW_KEY
//    (2026-10-27; the "Make this my default view" button that did it by hand is gone).
//  - A game board with no difficulty axis gets no difficulty filter. Skeeball gets a MACHINE
//    filter in its place, which belongs to that visit and is deliberately not persisted.

import { isHiddenName, HIDDEN_DEVICE_PREFIX } from './hidden-players.js';
import { aggregatePlayers, buildIdentity, SOLO } from './players-agg.js';
import { corrections, isAdminDevice } from './admin-config.js';
import { watchPlayers, watchBoard } from './stats-net.js';
import { beeBoard, watchBeeBoard, beeTotals } from './bee-board.js';
import { loadProfile } from './profile-store.js';
import { statsId, holdemBalance, holdemSuspect, isTestGame } from './game-stats.js';
import { ctMedalScore, ctBest, ctAvgGuesses, compareContexto } from './leaderboard-rank.js';
import { bucketsOf, tierMix, golfBestAt, hasBoardMetric, compareBoardMetric, compareTierFirst,
  boardRankTier, formatBoardMetric, formatTimeMetric, GOLF_BOARD_COURSE, LOWER_IS_BETTER } from './leaderboard-rank.js';
import { TIERS, diffShapeSVG, TIER_COLOR, tierOf } from './difficulty-tiers.js';
import { GAME_ART } from './game-art.js';
import { WO_TIERS, woPoints, RUSH_MODES, woRushBestMap, woRushRuns, woWeekKey } from './arrow-maze-time.js';
import { GL_TIERS, glPoints, glCleared, glThreeStars } from './gridlock-points.js';
import { WW_TIERS, wwPoints, wwCleared, wwThreeStars } from './word-weaver-points.js';
import { loadFavorites } from './favorites.js';
import { screenFor, ensureStatsCss, gameListHTML as gsGameListHTML, hubIdOf, unitKeyOf,
  isGameOnLauncher, SK_MACHINES, skMachineMeta } from './game-stats-ui.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
// difficulty-tiers.js is READ-path-only and out of scope for i18n edits (its TIER_LABEL is
// English-only, used elsewhere); this maps the same 1-4 tiers onto our own translated keys instead.
const TIER_LABEL_KEY = { 1: 'gs_diff_beginner', 2: 'gs_diff_intermediate', 3: 'gs_diff_pro', 4: 'gs_diff_expert' };
// Ski-slope shape language (colorblind-safe: shape carries the meaning, color is secondary).
// TIER_COLOR itself now lives in difficulty-tiers.js (2026-07-24) so every game's setup screen
// can use it too; imported above, values unchanged.

// WHO NEVER RENDERS lives in js/hidden-players.js now (2026-09-09) - a dependency-free module, so
// the launcher-path callers that used to copy this rule by hand can import it instead. The
// reasoning that used to sit here (why the name rule is a PREFIX and the durable half, why nameless
// is only safe while js/name-gate.js exists, and Matt's 2026-08-26 rule that a name is a real
// person until he says otherwise) moved there with it. This file stays the canonical CALLER.
const HIDDEN_PREFIX = HIDDEN_DEVICE_PREFIX;

/** True for a row that must never render: a test/QA account, or a device with no real name. */
function isHiddenRow(g) {
  return isHiddenName(g && g.name);
}

// --- sort preference (2026-07-29, HANDOFF-LB-FILTER-SORT.md) ----------------------------------
// gamehub.lb.sort.v1 - follows js/favorites.js as the model (try/catch read, defensive
// normalize, best-effort write, never throws). A PREFERENCE, not history: THE LAW rule 2's
// carve-out applies, same class as favorites/theme/language. Unlike the difficulty filter
// (which resets to All every open), the sort choice PERSISTS across opens (Matt, D6).
const SORT_KEY = 'gamehub.lb.sort.v1';
const VALID_SORTS = new Set(['alpha', 'played', 'wins', 'high']);   // 'high' = Skeeball's best single rack
function loadSort() {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && VALID_SORTS.has(v.sort) ? v.sort : 'wins';   // 'wins' is the default (2026-10-11 review: a leaderboard ranks by wins; was 'played', D5)
  } catch { return 'wins'; }
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
// The TAB is remembered too (2026-10-27, Matt: "whatever tab and sort the person leaves it on is
// where it opens next time"). A record written before this has no `seg` and opens on By Game.
const VALID_SEGS = new Set(['players', 'games', 'you']);
/** Stored cats are strings (JSON has no distinction between 1 and '1'); tiers live in memory as
 *  NUMBERS, because every helper below compares them against `bucketsOf`'s numeric tier. */
function catFromStored(v) { return v === '1' || v === '2' || v === '3' || v === '4' ? Number(v) : v; }
function catToStored(v) { return typeof v === 'number' ? String(v) : v; }
function loadView() {
  const fallback = { sort: loadSort(), cat: 'all', gameSort: 'alpha', seg: 'games' };
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return fallback;
    return {
      sort: VALID_SORTS.has(v.sort) ? v.sort : fallback.sort,
      cat: VALID_CATS.has(String(v.cat)) ? catFromStored(String(v.cat)) : 'all',
      gameSort: VALID_GAME_SORTS.has(v.gameSort) ? v.gameSort : 'alpha',
      seg: VALID_SEGS.has(v.seg) ? v.seg : 'games',
    };
  } catch { return fallback; }
}
function saveView(view) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      version: 1, sort: view.sort, cat: catToStored(view.cat), gameSort: view.gameSort, seg: view.seg, updatedAt: Date.now(),
    }));
  } catch { /* best-effort; never throw into the caller */ }
}
/** Every change the viewer makes is remembered as it happens: tab, both sorts, the category. */
function persistView() { saveView({ sort: _sort, cat: _cat, gameSort: _gameSort, seg: _seg }); }

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
  { id: 'hoops4', labelKey: 'game_title_hoops4' },
  { id: 'connect4', labelKey: 'game_title_connect4' },
  { id: 'dotsboxes', labelKey: 'game_title_dotsboxes' },
  { id: 'escoba', labelKey: 'game_title_escoba' },
  { id: 'filler', labelKey: 'game_title_filler' },
  { id: 'mancala', labelKey: 'game_title_mancala' },
  { id: 'business', labelKey: 'game_title_business' },
  { id: 'nutsbolts', labelKey: 'game_title_nutsbolts' },
  { id: 'sudoku', labelKey: 'game_title_sudoku' },
  { id: 'minesweeper', labelKey: 'game_title_minesweeper' },
  { id: 'contexto', labelKey: 'game_title_contexto' },
  // Murdoku (2026-09-29): admin only at first, but the row ships with the game - the Yahtzee
  // lesson above. isGameOnLauncher keeps its board hidden until Matt releases it.
  { id: 'murdoku', labelKey: 'game_title_murdoku' },
  // Arrow Maze (2026-10-11, stats id 'wayout'): admin only at first; the row ships with the game, as Murdoku's did.
  { id: 'wayout', labelKey: 'game_title_wayout' },
  // Gridlock (2026-10-14): admin only at first; the row ships with the game, as Arrow Maze's did.
  { id: 'gridlock', labelKey: 'game_title_gridlock' },
  // Word Weaver (2026-10-28, stats id 'wordweaver'): admin only at first; the row ships with the game.
  { id: 'wordweaver', labelKey: 'game_title_wordweaver' },
  { id: 'parchis', labelKey: 'game_title_parchis' },
  { id: 'snake', labelKey: 'game_title_snake' },
  { id: 'tictactoe', labelKey: 'game_title_tictactoe' },
  { id: 'uno', labelKey: 'game_title_uno' },
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
  // Brick Breaker (2026-09-23): released with this row in the same commit - the Yahtzee lesson above.
  { id: 'brickblitz', labelKey: 'game_title_brickblitz' },
  // Texas Hold'em (2026-09-27): released with this row in the same commit - the Yahtzee lesson.
  { id: 'holdem', labelKey: 'game_title_holdem' },
  { id: 'airhockey', labelKey: 'game_title_airhockey' },
  { id: 'cuppong', labelKey: 'game_title_cuppong' },
  // Darts (2026-10-01): admin only at first; the row ships with the game (the Yahtzee lesson
  // above). isGameOnLauncher keeps its board hidden until Matt releases it.
  { id: 'darts', labelKey: 'game_title_darts' },
  // Flick Soccer (2026-10-11): admin only at first; the row ships with the game (the Yahtzee
  // lesson above). isGameOnLauncher keeps its board hidden until Matt releases it.
  { id: 'flicksoccer', labelKey: 'game_title_flicksoccer' },
  // Archery (2026-10-14): admin only at first; the row ships with the game (the Yahtzee lesson
  // above). isGameOnLauncher keeps its board hidden until Matt releases it.
  { id: 'archery', labelKey: 'game_title_archery' },
  // Pool (2026-10-22, eight-ball/): admin only at first; the row ships with the game (the Yahtzee
  // lesson above). isGameOnLauncher keeps its board hidden until Matt releases it.
  { id: 'eightball', labelKey: 'game_title_eightball' },
  // Cup Baseball (2026-10-23, cup-baseball/): admin only at first; the row ships with the game (the
  // Yahtzee lesson above). isGameOnLauncher keeps its board hidden until Matt releases it.
  { id: 'cupbaseball', labelKey: 'game_title_cupbaseball' },
  // Spelling Bee (2026-10-23, spelling-bee/): admin only at first; the row ships with the game (the
  // Yahtzee lesson above). isGameOnLauncher keeps its board hidden until Matt releases it.
  { id: 'spellingbee', labelKey: 'game_title_spellingbee' },
  // Battle Arena (2026-10-24, battle-arena/): admin only at first; the row ships with the game (the
  // Yahtzee lesson above). isGameOnLauncher keeps its board hidden until Matt releases it.
  { id: 'battlearena', labelKey: 'game_title_battlearena' },
  // Golf is solo (js/players-agg.js's SOLO set) and ranks by lifetime points, same shape as
  // Skeeball - see golfPointsAt below. The row exists from Part 7 even though the one
  // course starts admin-gated to 'testing' (js/admin-config.js): the row costs nothing while nobody but the dev profile can play, and a row added later (after
  // someone already has plays) is exactly the Yahtzee bug this comment chain keeps citing.
  { id: 'golf', labelKey: 'game_title_golf' },
  // Phase 0 (BB-0-phase-0-handoff.md): the row exists from the first commit for the same reason
  // Golf's does - a game with no row here is worth zero wins and zero plays on every screen of
  // it (root CLAUDE.md, "GAME_META is a registry"), and `devOnly` games are only DEFAULTS now
  // (the admin control page), so a game can go live from inside the app with no commit at all.
  { id: 'baseball', labelKey: 'game_title_baseball' },
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
/** The cross-game numbers (By Player's wins, plays, runs, VS) leave out every game that is admin-only
 *  RIGHT NOW (Matt, 2026-10-28: "Admin only games should NOT be counted towards the total win
 *  number"). Narrower than isGameOnLauncher on purpose: only js/game-stats.js ADMIN_ONLY games not yet
 *  switched live, so a released game pulled back from the admin page still counts (THE LAW rule 1).
 *  At release they count again, with everything recorded before 2026-10-28 (Matt's choice). */
const counted = (ids) => ids.filter((id) => !isTestGame(id));
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

/** "Send message" on a player's own detail screen (2026-08-31). This is the natural place to want
 *  it - you are already looking at the person - so it is the second way into Messages after the
 *  profile page.
 *
 *  Not rendered for YOUR OWN row (nobody messages themselves; js/messages.js's pairKey refuses it
 *  anyway), and not for a row with no player code, which is what a message is addressed to. A
 *  legacy record with no code cannot receive one, and a dead button would be worse than none.
 *
 *  (2026-09-01) It is an ICON BESIDE THE NAME, not a full-width bar under the tier grid. Matt:
 *  "This is a bad spot for the send a message button. It should be a smaller icon and be next to
 *  the players name." A full-width accent bar mid-screen read as the primary action of a stats
 *  page whose actual content is the game list below it, and it pushed that list down a phone
 *  screen. It is icon-only, so the label lives in `aria-label`/`title` rather than being dropped -
 *  and it is still 44x44, the UX floor's tap-target minimum (docs/BUILDING-A-GAME.md, Part 0);
 *  "smaller" here means smaller than a full-width bar, never smaller than a thumb. */
// NO PLAYER CODES IN THE PAGE (2026-10-29): a code is the whole identity ("link by code" on a new
// phone becomes that person), and the button carried it in `data-code` for anyone to read off the
// leaderboard. It carries an opaque index into this list instead; the tap reads the code from here.
const _msgTo = [];
function sendMsgHTML(g) {
  if (!g || g.key === _meKey) return '';
  const code = (typeof g.playerId === 'string' ? g.playerId : '').trim().toUpperCase();
  if (!code) return '';
  const label = esc(t('lb_send_message'));
  if (_msgTo.length > 1000) _msgTo.length = 0;
  const mi = _msgTo.push({ code, name: rankName(g), emoji: g.emoji || '🙂' }) - 1;
  return `<button type="button" class="lb-msgbtn" data-role="lb-msg" data-mi="${mi}"
            aria-label="${label}" title="${label}"
    ><span aria-hidden="true">💬</span><span class="lb-msgbtn-t">${esc(tx('lb_msg_short', 'Message'))}</span></button>`;
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
function runsAtTier(group, tier) { return playsAtTier(group, counted(SOLO_IDS), tier); }
/** Total plays across EVERY game, competitive + solo runs (Matt, 2026-07-29): the leaderboard
 *  card's "played" number. Deliberately ALL_IDS, not COMP_IDS — see HANDOFF-LB-FILTER-SORT.md §0
 *  for why folding runs in here is the rule-1-safe choice. */
function playedOf(g, tier) { return playsAtTier(g, counted(ALL_IDS), tier); }
/** Cross-game wins: competitive games only, UNCHANGED from before this redesign. A solo run is
 *  not a win (HANDOFF-LB-SOLO-RUNS.md, still in force). Do not "make them consistent" by moving
 *  wins onto ALL_IDS — that would re-fold solo runs into the wins number, exactly the bug that
 *  handoff fixed. The asymmetry is deliberate. */
function winsOf(g, tier) { return winsAtTier(g, counted(COMP_IDS), tier); }
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
// not multiplayer - Skeeball's machines, Hill Climb's stages, plus 'legacy' and
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
  for (const id of counted(ALL_IDS)) for (const b of bucketsOf(g.games[id])) if (b.tier == null && b.key !== 'mp') n += b.played;
  return n;
}
/** Wins against real people: the `mp` bucket, across every game that has online play. */
function vsWinsOf(g) {
  let n = 0;
  for (const id of counted(ALL_IDS)) for (const b of bucketsOf(g.games[id])) if (b.key === 'mp') n += b.wins;
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
  return winsAtTier(g, counted(COMP_IDS), cat);
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
const MS_TIER_KEYS = ['easy', 'medium', 'hard', 'expert'];
/** Minesweeper: the BEST TIME at this tier, in ms, or null when there is none.
 *
 *  NULL, NEVER 0, and that is the whole care needed here. `ms.bestTimeMs` uses 0 as its "never
 *  set" sentinel, and `hasBoardMetric` treats a lower-is-better metric as present whenever it has
 *  a VALUE (golf's to-par can legitimately BE 0, which is level par). So returning the raw 0 would
 *  rank a player who has never cleared that level as having done it instantaneously - first place,
 *  for ever. Returning null sinks them the way every other absent score sinks.
 *
 *  With no tier (a row the board could not place on the 1-4 scale) the answer is the best time at
 *  ANY level, which is the same "their all-tier number" fallback every other board uses. */
function msBestAt(g, tier) {
  const ms = (g.games.minesweeper || {}).ms;
  const best = ms && ms.bestTimeMs;
  if (!best || typeof best !== 'object') return null;
  if (tier == null) {
    let low = null;
    for (const k of MS_TIER_KEYS) {
      const v = best[k] | 0;
      if (v > 0 && (low === null || v < low)) low = v;
    }
    return low;
  }
  const key = MS_TIER_KEYS[tier - 1];
  if (!key) return null;
  const v = best[key] | 0;
  return v > 0 ? v : null;
}

// --- MINESWEEPER'S OWN BOARD (2026-10-15) --------------------------------------------------------
// Matt: "The default view should show everyone's score. Regardless of what level. But it should
// be clear that Ana solved a hard puzzle... and it should show the % complete Natalia and Unai
// achieved when they tried easy. If you click on hard, it should show Ana's time on her complete
// round, my best completion % and anyone else who has tried hard."
//
// So: tabs All / Easy / Med / Hard / Expert (all four always), All first. All = ONE number per
// person, their best: the hardest level they SOLVED (fastest time), else the hardest level with a
// best % cleared. A level tab = everyone who PLAYED it: times first (fastest), then best % (highest).
// `ms.bestClearedPct` was first written 2026-10-15, so a level played only before then has plays
// and no % - it prints a dash, never a guess (THE LAW rule 4).
function msPctAt(g, tier) {
  const ms = (g.games.minesweeper || {}).ms;
  const pc = ms && ms.bestClearedPct;
  const key = MS_TIER_KEYS[tier - 1];
  return pc && typeof pc === 'object' && key ? Math.max(0, Math.min(100, pc[key] | 0)) : 0;
}
/** One player's result at one level: {ms} solved, {pct} best % on a board never solved, {} played
 *  with no % kept, or null when that level was never played. */
function msCellAt(g, tier) {
  if (playsAtTier(g, ['minesweeper'], tier) <= 0) return null;
  const ms = msBestAt(g, tier);
  if (ms != null) return { ms };
  const pct = msPctAt(g, tier);
  return pct > 0 ? { pct } : {};
}
function msCellRank(c) { return c.ms != null ? [0, c.ms] : c.pct != null ? [1, -c.pct] : [2, 0]; }
function msCellCmp(a, b) { const x = msCellRank(a); const y = msCellRank(b); return x[0] - y[0] || x[1] - y[1]; }
/** All's one number: hardest level solved, else hardest level with a %, else hardest played. */
function msHeadline(g) {
  const cells = [4, 3, 2, 1].map((tier) => ({ tier, c: msCellAt(g, tier) })).filter((x) => x.c);
  return cells.find((x) => x.c.ms != null) || cells.find((x) => x.c.pct != null) || cells[0] || null;
}
function msAllCmp(a, b) {
  const x = msHeadline(a); const y = msHeadline(b);
  if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
  const sx = x.c.ms != null ? 0 : x.c.pct != null ? 1 : 2;
  const sy = y.c.ms != null ? 0 : y.c.pct != null ? 1 : 2;
  return sx - sy || y.tier - x.tier || msCellCmp(x.c, y.c);
}
function msCellHTML(c) {
  if (c.ms != null) return `<span class="lb-mstime">${esc(formatBoardMetric(c.ms, 'minesweeper', ''))}</span>`;
  if (c.pct != null) return `<span class="lb-mspct"><span class="lb-msbar" aria-hidden="true"><i style="width:${c.pct}%"></i></span>${c.pct}%</span>`;
  return '<span class="lb-msnone">&mdash;</span>';
}
/** A board's tabs: All, then each difficulty in `tiers` (shape + word), then `extras`
 *  ([{view, label}]: MP, Solo, Ultimate, Walls on...). A tier tab sets `_tier` and clears `_view`;
 *  an extra sets `_view`. Past five tabs the difficulty tabs drop to their shape alone. */
function boardTabsHTML(tiers, extras = []) {
  const narrow = tiers.length + extras.length + 1 > 5;
  const tabs = [null, ...tiers].map((tier) => {
    const sel = !_view && _tier === tier;
    const word = tier == null ? t('lb_diff_all') : tier === 2 ? tx('lb_tab_med', 'Med') : t(TIER_LABEL_KEY[tier]);
    const shapeHtml = tier ? `<span class="lb-mstab-sh" style="--lb-pill-color:${TIER_COLOR[tier]}">${diffShapeSVG(tier)}</span>` : '';
    const label = tier && narrow ? '' : esc(word);
    return `<button type="button" class="lb-pill lb-mstab${sel ? ' is-sel' : ''}" data-mstier="${tier == null ? '' : tier}" aria-pressed="${sel}" aria-label="${esc(word)}">${shapeHtml}${label}</button>`;
  });
  for (const x of extras) {
    const sel = _view === x.view;
    tabs.push(`<button type="button" class="lb-pill lb-mstab${sel ? ' is-sel' : ''}" data-lbview="${x.view}" aria-pressed="${sel}">${esc(x.label)}</button>`);
  }
  return `<div class="lb-pills lb-mstabs" role="group">${tabs.join('')}</div>`;
}
function msTabsHTML() { return boardTabsHTML([1, 2, 3, 4]); }
function msBoardHTML(list) {
  const tier = _tier;
  const rows = tier == null
    ? list.filter((g) => msHeadline(g))
    : list.filter((g) => msCellAt(g, tier));
  const cmp = tier == null ? msAllCmp : (a, b) => msCellCmp(msCellAt(a, tier), msCellAt(b, tier));
  rows.sort((a, b) => cmp(a, b) || rankName(a).localeCompare(rankName(b)));
  const { rankOf, tiedAt } = rankMap(rows, () => 0, cmp);
  const cards = rows.length
    ? `<div class="lb-plist is-board">${rows.map((g) => {
        const h = tier == null ? msHeadline(g) : { tier: null, c: msCellAt(g, tier) };
        // Wins on that level (All: every level) beside the plays, one line (Matt, 2026-10-20: "how
        // many times a person has won on a given difficulty without making it too crowded").
        const n = playsAtTier(g, ['minesweeper'], tier);
        const w = winsAtTier(g, ['minesweeper'], tier);
        const big = { cls: 'lb-msval', val: msCellHTML(h.c), unit: tx('lb_ms_won_of', `${w} of ${n} won`, { w, n }) };
        return playerCardHTML(g, rankChipHTML(rankOf[g.key], tiedAt(g.key)), big, '', '', tierPillHTML(h.tier), '');
      }).join('')}</div>`
    : emptyState(t('lb_empty_game', { label: labelOf('minesweeper') }));
  // Minesweeper ranks its own way (msAllCmp / msCellCmp), so its gap is read off the same cells.
  const cellOf = (g) => (tier == null ? msHeadline(g) : { tier, c: msCellAt(g, tier) });
  const msGap = (me, rec) => {
    const hm = cellOf(me), hr = cellOf(rec);
    if (!hr || hr.c.ms == null) return '';
    if (hm && hm.c.ms != null && hm.tier === hr.tier) {
      const d = Math.floor(hm.c.ms / 1000) - Math.floor(hr.c.ms / 1000);
      return d > 0 ? tx('lb_gap', '', { k: 'time', v: `<b>${formatTimeMetric(d * 1000)}</b>`, n: d }) : '';
    }
    return hr.tier ? tx('lb_gap', '', { k: 'tier', v: `<b>${formatTimeMetric(hr.c.ms)}</b>`, tier: esc(t(TIER_LABEL_KEY[hr.tier])) }) : '';
  };
  return msTabsHTML() + cards + (rows.length ? standLineHTML(rows, rankOf, tiedAt, msGap) : '');
}

// --- EVERY OTHER PLAIN BOARD, SAME SHAPE (2026-10-15) ---------------------------------------------
// Matt: "Yes, do the same for every game. If a game's leaderboard shows specific info to that game,
// make a note of it and ask me before changing it." So every board EXCEPT `SPECIAL_BOARDS` gets
// Minesweeper's layout: tabs (All, the difficulties the field has played, MP when anyone played
// online), one number per row (All: the hardest-difficulty-first number with its shape), games
// played under it, the unit named once above the list. No sort pills, no tier tiles, no note.
// The ranking itself is the board's own, unchanged (boardMetricCmp). The special boards keep the
// old layout until Matt decides each one; standing records stay under every board as before.
// THE NINE GAME-SPECIFIC BOARDS (same day, Matt: "Yes to all"): each keeps what is its own as TABS.
// Tic Tac Toe: All / Ultimate / Classic (its `tt` split has no per-difficulty storage, so no
// difficulty tabs). Snake: All, difficulties, Walls off / Walls on. Skeeball: a machine row (All +
// every machine the field played) over Points / High score. Cup Pong: the usual tabs + Solo (fewest
// throws to clear a rack). Hold'em: Bankroll / Wins. Contexto, Golf, Arrow Maze, Gridlock: the plain
// shape, their own numbers and orders untouched.

/** Snake, one walls mode: the hardest difficulty with a best in that mode, and the best there. */
function snWallsCell(g, walls) {
  for (const tier of [3, 2, 1]) { const v = snBestAtWalls(g, tier, walls); if (v > 0) return { tier, v }; }
  const v = snBestAtWalls(g, null, walls);
  return v > 0 ? { tier: null, v } : null;
}
const ttOf = (g) => (g.games.tictactoe && g.games.tictactoe.tt) || {};

/** Which view a board is on, as one object every renderer below reads. */
function boardView(list, id) {
  const tabsExtra = [];
  let tiers = (id === 'skeeball' || id === 'holdem' || id === 'tictactoe') ? [] : fieldTiersPresent(list, [id]);
  // Word Weaver: a band tab for every band anyone has completed a level in (the per-level map, so
  // levels finished before the bands, filed under 'ladder', still make their band's tab).
  if (id === 'wordweaver') tiers = [1, 2, 3, 4].filter((k) => list.some((g) => wwCleared((g.games || {}).wordweaver, WW_TIERS[k - 1]) > 0));
  if (id === 'tictactoe') tabsExtra.push({ view: 'ultimate', label: t('lb_tt_ultimate') }, { view: 'classic', label: t('lb_tt_classic') });
  if (id === 'snake') tabsExtra.push({ view: 'off', label: t('lb_sn_walls_off') }, { view: 'on', label: t('lb_sn_walls_on') });
  if (id === 'cuppong' && list.some((g) => cpSoloBest(g) !== null)) tabsExtra.push({ view: 'solo', label: tx('lb_tab_solo', 'Solo') });
  if (anyMpPlays(list, id)) tabsExtra.push({ view: 'mp', label: t('lb_mp_short') });
  if (_view && !tabsExtra.some((x) => x.view === _view) && id !== 'skeeball' && id !== 'holdem' && !(id === 'contexto' && _view === 'daily')) _view = '';
  let tabs = tiers.length || tabsExtra.length ? boardTabsHTML(tiers, tabsExtra) : '';
  const recent = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  const byDesc = (f) => (a, b) => f(b) - f(a);
  // The default view: the board's own number, ranked by its own one order.
  const plain = () => {
    const rows = list.filter((g) => boardPlaysOf(g, id) > 0);
    // Tic Tac Toe's own comparator orders Ultimate -> Classic, which is what its tabs now show;
    // its All tab is the generic difficulty-first wins number, so it takes the generic comparator.
    const cmp = id === 'tictactoe' ? (a, b) => compareBoardRow(a, b, id) : boardMetricCmp(id);
    rows.sort((a, b) => cmp(a, b) || (boardPlaysOf(a, id) - boardPlaysOf(b, id)) || recent(a, b));
    const unit = id === 'contexto' ? t('lb_unit_ct_medals') : unitTextOf(id, null);
    return {
      rows, cmp, unit, gap: true,
      val: (g) => {
        const txt = id === 'holdem' && hbReview(g) ? t('lb_hb_review') : metricText(boardMetricOf(g, id), id);
        return `<span>${esc(txt)}</span>`;
      },
      tier: (g) => (_tier == null ? boardTierOf(g, id) : null),
      // Spelling Bee: days played is already 📅 under the name.
      sub: (g) => (id === 'spellingbee' && beeBoard() ? '' : t('lb_played_count', { n: boardPlaysOf(g, id) })),
      // Cup Pong's reracks go on their own line under "played": on one line the column grew wide
      // enough to run over the name and the tier pill (2026-10-28).
      sub2: (g) => {
        // Sudoku / Murdoku: the number above is no-hint solves (2026-10-29).
        if (noHintTierOf(g, id)) return tx('lb_nohint', 'no hints');
        const cr = id === 'cuppong' ? cpReracksOf(g) : null;
        return cr && cr.w ? tx('lb_cp_reracks', `${cr.r} reracks`, { n: cr.r }) : '';
      },
      subHtml: id === 'spellingbee' && beeBoard() ? beeChipsHTML : id === 'contexto' ? (g) => ctSubHTML(ctOf(g)) : null,
      // Contexto (Matt, 2026-10-30): the medals say it all; no "MEDALS" label, no "N played", no
      // "<name> is 4th." line under the list.
      ...(id === 'contexto' ? { val: (g) => ctBigHTML(ctOf(g)), unit: '', sub: () => '', gap: false } : {}),
    };
  };
  const simple = (rows, f, unit, played, cmp) => {
    const c = cmp || byDesc(f);
    rows.sort((a, b) => c(a, b) || recent(a, b));
    return { rows, cmp: c, unit, val: (g) => `<span>${esc(String(f(g)))}</span>`, sub: (g) => played(g) };
  };
  let v;
  if (id === 'skeeball') {
    // Two rows of tabs: which machine (only once the field has played more than one), then which number.
    const machines = skMachinesPresent(list);
    if (_machine !== 'all' && !machines.includes(_machine)) _machine = 'all';
    const mtab = (mid, label) => `<button type="button" class="lb-pill lb-mstab${_machine === mid ? ' is-sel' : ''}" data-lbmachine="${mid}" aria-pressed="${_machine === mid}">${esc(label)}</button>`;
    const machineRow = machines.length > 1
      ? `<div class="lb-pills lb-mstabs is-wrap" role="group">${mtab('all', t('lb_diff_all'))}${machines.map((m) => mtab(m, skMachineMeta(m).name)).join('')}</div>` : '';
    const vtab = (view, label) => `<button type="button" class="lb-pill lb-mstab${(_view || 'points') === view ? ' is-sel' : ''}" data-lbview="${view}" aria-pressed="${(_view || 'points') === view}">${esc(label)}</button>`;
    tabs = machineRow + `<div class="lb-pills lb-mstabs" role="group">${vtab('points', t('lb_sort_points'))}${vtab('high', t('lb_sort_high'))}</div>`;
    const rows = list.filter((g) => skPlaysAt(g, _machine) > 0);
    const played = (g) => t('lb_played_count', { n: skPlaysAt(g, _machine) });
    v = _view === 'high'
      ? simple(rows, (g) => skBestAt(g, _machine), t('lb_unit_high'), played)
      : { ...simple(rows, (g) => skPointsAt(g, _machine), t('lb_unit_points'), played), gap: true };
  } else if (id === 'contexto') {
    // Daily | All (2026-10-30): Daily = puzzles finished on their own day (ct.d), ranked the same way.
    const vtab = (view, label) => `<button type="button" class="lb-pill lb-mstab${(_view === 'daily' ? 'daily' : 'all') === view ? ' is-sel' : ''}" data-lbview="${view === 'all' ? 'ctall' : view}" aria-pressed="${(_view === 'daily' ? 'daily' : 'all') === view}">${esc(label)}</button>`;
    tabs = `<div class="lb-pills lb-mstabs" role="group">${vtab('daily', tx('lb_ct_daily', 'Daily'))}${vtab('all', t('lb_diff_all'))}</div>`;
    if (_view === 'daily') {
      const rows = list.filter((g) => (ctDailyOf(g).played | 0) > 0);
      const cmp = (a, b) => compareContexto(ctDailyOf(a), ctDailyOf(b));
      rows.sort((a, b) => cmp(a, b) || recent(a, b));
      v = { rows, cmp, unit: '', empty: tx('lb_ct_daily_none', 'No daily wins yet.'),
        val: (g) => ctBigHTML(ctDailyOf(g)),
        sub: () => '',
        subHtml: (g) => ctSubHTML(ctDailyOf(g)) };
    } else {
      v = plain();
    }
  } else if (id === 'holdem') {
    const vtab = (view, label) => `<button type="button" class="lb-pill lb-mstab${(_view || 'bank') === view ? ' is-sel' : ''}" data-lbview="${view}" aria-pressed="${(_view || 'bank') === view}">${esc(label)}</button>`;
    tabs = `<div class="lb-pills lb-mstabs" role="group">${vtab('bank', t('lb_sort_bank'))}${vtab('wins', t('lb_sort_wins'))}</div>`;
    v = _view === 'wins'
      ? simple(list.filter((g) => boardPlaysOf(g, id) > 0), (g) => winsAtTier(g, ['holdem'], null), t('lb_unit_wins'), (g) => t('lb_played_count', { n: boardPlaysOf(g, id) }))
      : plain();
  } else if (_view === 'mp') {
    v = simple(list.filter((g) => mpPlaysOf(g, id) > 0), (g) => mpWinsOf(g, id), t('lb_unit_wins'), (g) => t('lb_played_count', { n: mpPlaysOf(g, id) }));
  } else if (_view === 'solo') {
    v = simple(list.filter((g) => cpSoloBest(g) !== null), cpSoloBest, t('lb_unit_fewest'),
      (g) => `${cpSoloRacks(g)} ${t('lb_unit_cleared')}`, (a, b) => cmpCpFewest(a, b));
  } else if (_view === 'ultimate' || _view === 'classic') {
    const k = _view;
    v = simple(list.filter((g) => ((ttOf(g)[k] || {}).played | 0) > 0), (g) => ttVariantWins(ttOf(g)[k]), t('lb_unit_wins'),
      (g) => t('lb_played_count', { n: (ttOf(g)[k] || {}).played | 0 }));
  } else if (_view === 'off' || _view === 'on') {
    const w = _view;
    const rows = list.filter((g) => snWallsCell(g, w));
    const cmp = (a, b) => { const x = snWallsCell(a, w); const y = snWallsCell(b, w); return ((y.tier || 0) - (x.tier || 0)) || (y.v - x.v); };
    rows.sort((a, b) => cmp(a, b) || recent(a, b));
    v = { rows, cmp, unit: unitTextOf('snake', null),
      val: (g) => `<span>${snWallsCell(g, w).v}</span>`,
      tier: (g) => snWallsCell(g, w).tier,
      sub: (g) => t('lb_played_count', { n: boardPlaysOf(g, id) }) };
  } else {
    v = plain();
  }
  return { tabs, ...v };
}

// --- ARROW MAZE: LEVELS | RUSH (2026-10-16) -------------------------------------------------------
// Matt: "for Minesweeper, we linked the Leaderboard. Let's do that instead. We should do the same on
// the Rush tab... it should rank players for the current week, and show a weeks won leaderboard."
// The game's own Results screens were replaced by this. Levels is the plain points board, unchanged.
// Rush: Easy | Hard, then This week (each person's best run this week, from the per-person merged
// `wo.rush.best`, so the best on any of their phones), Weeks won (finished weeks only; ties all win)
// and Past weeks (each finished week's winner). Read-only, like every board here.
function woModesHTML() {
  const pill = (m, label) => `<button type="button" class="lb-pill lb-mstab lb-wohalf${_woMode === m ? ' is-sel' : ''}" data-lbwomode="${m}" aria-pressed="${_woMode === m}">${esc(label)}</button>`;
  return `<div class="lb-pills lb-mstabs" role="group">${pill('levels', tx('lb_wo_levels', 'Levels'))}${pill('rush', tx('lb_wo_rush', 'Rush'))}</div>`;
}
const woRushOf = (g) => ((((g.games || {}).wayout || {}).wo || {}).rush) || {};
function woBestMapOf(g, mode) { return woRushBestMap((woRushOf(g).best || {})[mode]); }
/** Counted runs in one version (left runs are kept but never counted). The merged record keeps the
 *  run list of the person's phone with the most runs, so this is a size for the header, not a total. */
function woRunsOf(g, mode) { return woRushRuns((woRushOf(g).runs || {})[mode]).filter((r) => !r.left).length; }
/** "Oct 12 – 18" / "Sep 28 – Oct 4" for the week starting Monday `key` (UTC, as the weeks are). */
function woWeekRange(key) {
  const [y, m, d] = key.split('-').map(Number);
  const a = new Date(Date.UTC(y, m - 1, d)), b = new Date(Date.UTC(y, m - 1, d + 6));
  const lang = (document.documentElement.lang || 'en').slice(0, 2) === 'es' ? 'es' : 'en';
  const fmt = (dt, o) => { try { return dt.toLocaleDateString(lang, Object.assign({ timeZone: 'UTC' }, o)); } catch { return dt.toISOString().slice(5, 10); } };
  const md = { month: 'short', day: 'numeric' };
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${fmt(a, md)} – ${fmt(b, md)}`;
  // Same month: "Oct 12 – 18" in English, "12 – 18 oct" in Spanish (the day comes first).
  return lang === 'es' ? `${fmt(a, { day: 'numeric' })} – ${fmt(b, md)}` : `${fmt(a, md)} – ${fmt(b, { day: 'numeric' })}`;
}
function woRushHTML(list) {
  const mode = _woRush;
  const view = _view === 'won' || _view === 'past' ? _view : 'week';
  const thisWeek = woWeekKey();
  const sh = (tier) => `<span class="lb-mstab-sh" style="--lb-pill-color:${TIER_COLOR[tier]}">${diffShapeSVG(tier)}</span>`;
  const mpill = (m, tier) => `<button type="button" class="lb-pill lb-mstab lb-wohalf${mode === m ? ' is-sel' : ''}" data-lbworush="${m}" aria-pressed="${mode === m}">${sh(tier)}${esc(tx('lb_wo_' + m, m === 'easy' ? 'Easy' : 'Hard'))}</button>`;
  const vpill = (v, label) => `<button type="button" class="lb-pill lb-mstab lb-wothird${view === v ? ' is-sel' : ''}" data-lbview="${v}" aria-pressed="${view === v}">${esc(label)}</button>`;
  const tabs = `<div class="lb-pills lb-mstabs" role="group">${mpill('easy', 1)}${mpill('hard', 3)}</div>`
    + `<div class="lb-pills lb-mstabs" role="group">${vpill('week', tx('lb_wo_week', 'This week'))}${vpill('won', tx('lb_wo_won', 'Weeks won'))}${vpill('past', tx('lb_wo_past', 'Past weeks'))}</div>`;
  const best = new Map(list.map((g) => [g.key, woBestMapOf(g, mode)]));
  const arrows = tx('lb_wo_arrows', 'arrows');
  // Every finished week anyone has a counted run in, newest first, with its best score and winners.
  const weeks = [...new Set(list.flatMap((g) => Object.keys(best.get(g.key)).filter((w) => w < thisWeek)))].sort().reverse()
    .map((w) => {
      const top = list.reduce((m, g) => Math.max(m, best.get(g.key)[w] ?? -1), -1);
      return { w, top, winners: top > 0 ? list.filter((g) => best.get(g.key)[w] === top) : [] };
    });
  let body;
  if (view === 'week') {
    const rows = list.filter((g) => best.get(g.key)[thisWeek] != null);
    const val = (g) => best.get(g.key)[thisWeek];
    rows.sort((a, b) => val(b) - val(a) || rankName(a).localeCompare(rankName(b)));
    const { rankOf, tiedAt } = rankMap(rows, val);
    body = `<div class="lb-unith lb-wounith"><span>${esc(woWeekRange(thisWeek))}</span><span>${esc(arrows)}</span></div>`
      + (rows.length ? `<div class="lb-plist is-board">${rows.map((g) => playerCardHTML(g, rankChipHTML(rankOf[g.key], tiedAt(g.key)),
        { cls: 'lb-msval', val: `<span>${val(g)}</span>`, unit: '' }, '', '', '', '')).join('')}</div>`
        : emptyState(tx('lb_wo_none_week', 'No runs this week yet')));
  } else if (view === 'won') {
    const won = {}, played = {};
    for (const wk of weeks) {
      for (const g of list) if (best.get(g.key)[wk.w] != null) played[g.key] = (played[g.key] || 0) + 1;
      for (const g of wk.winners) won[g.key] = (won[g.key] || 0) + 1;
    }
    const rows = list.filter((g) => won[g.key] > 0);
    const val = (g) => won[g.key];
    rows.sort((a, b) => val(b) - val(a) || (played[a.key] - played[b.key]) || rankName(a).localeCompare(rankName(b)));
    const { rankOf, tiedAt } = rankMap(rows, val);
    body = rows.length ? `<div class="lb-unith">${esc(tx('lb_wo_won_unit', 'weeks won'))}</div><div class="lb-plist is-board">${rows.map((g) => playerCardHTML(g,
      rankChipHTML(rankOf[g.key], tiedAt(g.key)), { cls: 'lb-msval', val: `<span>${val(g)}</span>`, unit: tx('lb_wo_of', 'of {n}', { n: played[g.key] }) }, '', '', '', '')).join('')}</div>`
      : emptyState(tx('lb_wo_none_past', 'No finished weeks yet'));
  } else {
    const cards = weeks.flatMap((wk) => wk.winners.map((g) => playerCardHTML(g, '<span class="lb-chip"></span>',
      { cls: 'lb-msval', val: `<span>${wk.top}</span>`, unit: arrows }, woWeekRange(wk.w), '', '', '')));
    body = cards.length ? `<div class="lb-unith">${esc(tx('lb_wo_winner', 'winner'))}</div><div class="lb-plist is-board lb-wopast">${cards.join('')}</div>`
      : emptyState(tx('lb_wo_none_past', 'No finished weeks yet'));
  }
  return tabs + body;
}

function plainBoardHTML(list, id) {
  const v = boardView(list, id);
  const { rankOf, tiedAt } = rankMap(v.rows, () => 0, v.cmp);
  const cards = v.rows.length
    ? `${v.unit ? `<div class="lb-unith">${esc(v.unit)}</div>` : ''}<div class="lb-plist is-board">${v.rows.map((g) => {
        const big = { cls: 'lb-msval', val: v.val(g), unit: v.sub(g), unit2: v.sub2 ? v.sub2(g) : '' };
        return playerCardHTML(g, rankChipHTML(rankOf[g.key], tiedAt(g.key)), big, '', '', v.subHtml ? v.subHtml(g) : v.tier ? tierPillHTML(v.tier(g)) : '', '');
      }).join('')}</div>`
    : emptyState(v.empty || t('lb_empty_game', { label: labelOf(id) }));
  // Only on a view ranked by the board's own number (gameMetricAt), which is what gapText reads.
  const line = v.gap && v.rows.length
    ? standLineHTML(v.rows, rankOf, tiedAt, (me, rec) => gapText(me, rec, id, (x) => `<b>${x}</b>`)) : '';
  return v.tabs + cards + line;
}

/** ONE LINE UNDER A BOARD (2026-10-27, Matt's mockup 2b): where the viewer stands and what it takes
 *  to be first, "MattyIce is 3rd. 1:43 faster to take the record." By profile name, never "You"
 *  (root CLAUDE.md). Nothing when the viewer is not on this board. */
function standLineHTML(rows, rankOf, tiedAt, gapFn) {
  const me = rows.find((g) => g.key === _meKey);
  const rank = me && rankOf[me.key];
  if (!rank) return '';
  const gap = rank > 1 ? gapFn(me, rows[0]) : '';
  return `<p class="lb-note lb-standline">${rankWords('lb_rank_name', rank, tiedAt(me.key), rankName(me))}${gap ? ' ' + gap : ''}</p>`;
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
/** Brick Breaker's board: best single run, per difficulty tier (the same shape as Snake's). */
const BZ_TIER_KEYS = ['easy', 'medium', 'hard'];
function bzBestAt(g, tier) {
  const bz = (g.games.brickblitz || {}).bz;
  if (!bz) return 0;
  if (tier == null) return bz.bestScore | 0;
  const key = BZ_TIER_KEYS[tier - 1];
  return key ? (bz.bestScoreByDiff || {})[key] | 0 : 0;
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
/** LIFETIME points - every point this player has ever scored on Skeeball, or on ONE machine when
 *  the filter names one. This is what the board's Points sort ranks by (2026-09-01). Matt: "Points
 *  should show lifetime points. Not your best single round."
 *  It used to read skBestAt below, so a player with 1451 games and one 900 rack read "900 POINTS" -
 *  a single rack's ceiling standing in for a lifetime, which told you nothing about how much anyone
 *  had actually played. Both numbers were always stored; only the wrong one was on the board.
 *  Adds across a person's devices in players-agg.js, which is what makes a lifetime total honest
 *  for somebody who plays on two phones. */
function skPointsAt(g, machine) {
  const sk = g.games.skeeball && g.games.skeeball.sk;
  if (!sk) return 0;
  if (!machine || machine === 'all') return sk.points | 0;
  return ((sk.boards || {})[machine] || {}).points | 0;
}
/** BEST SINGLE RACK - the high score. The same reading it always was; it is just no longer what
 *  "Points" means. The board offers it as its own sort now (see sortItemsFor). */
function skBestAt(g, machine) {
  const sk = g.games.skeeball && g.games.skeeball.sk;
  if (!sk) return 0;
  if (!machine || machine === 'all') return sk.bestGame | 0;
  return ((sk.boards || {})[machine] || {}).best | 0;   // the per-machine record, exactly as stored
}
/** One player's stored record for ONE Skeeball machine, exactly as arcade-scores.js wrote it
 *  ({plays, points, best, bestThrow, daily, slots, slotHits, cleanRacks, perfectRacks}), already
 *  carrying any score correction (players-agg.js applies those per source record, before merging).
 *  Absent machine, absent record: an empty object, so every caller reads a stored 0 rather than
 *  needing its own guard. */
function skBoardRec(g, machine) {
  const sk = (g.games.skeeball || {}).sk;
  return (sk && (sk.boards || {})[machine]) || {};
}
/** Skeeball's plays, machine-filtered. Its byDiff IS keyed by machine, so playsAtTier cannot slice
 *  it (tierOf('classic') is null); the per-board record is the stored answer. */
function skPlaysAt(g, machine) {
  const sk = g.games.skeeball && g.games.skeeball.sk;
  if (!sk) return 0;
  if (!machine || machine === 'all') return sk.played | 0;
  return ((sk.boards || {})[machine] || {}).plays | 0;
}
// Golf's board number changed on 2026-09-03 (Matt): from the LIFETIME Modified Stableford total
// to the player's BEST ROUND on one named course, shown as a score to par, lowest wins. The
// lifetime `gf.points` counter is still written and still shown - it is My Stats' "Skill level"
// (js/game-stats-ui.js) - so nothing was hidden by this change, only re-ranked.
//
// It is the ONLY metric on this board where lower wins and where the good values are <= 0, so
// three things had to move together in one commit, and a test guards each: this extractor, the
// SORT DIRECTION at every one of its six call sites, and gameListHTML's `metric > 0` leader
// filter (which dropped every under-par and every level-par round). See js/leaderboard-rank.js.
/** THE GAMES WHOSE METRIC IGNORES THE TIER IT IS HANDED - the map two sessions had to rediscover
 *  the hard way (2026-09-08), so it is written down once here rather than re-derived from the
 *  extractors below. Skeeball's number is scoped by MACHINE, golf's by COURSE; neither has a
 *  per-tier breakdown to read (their stored buckets are keyed by machine and by course, which map
 *  to no tier), so neither gets per-tier tiles. */
const METRIC_IS_TIER_BLIND = new Set(['skeeball', 'golf', 'holdem', 'contexto']);

/** TEXAS HOLD'EM'S BOARD RANKS BY BANKROLL (2026-09-28, Matt: "We definitely need" a bankroll
 *  leaderboard). The number is the person's combined ledger (js/game-stats.js holdemBalance, summed
 *  across their devices by players-agg, admin voids already applied). `null` - printed as a dash,
 *  sorted last - for somebody who never played for money, and for a ledger holdemSuspect() says no
 *  real play could produce; that row reads "Under review" (metricText) until Matt voids or clears
 *  it. The bankroll has no difficulty axis, so this board is untiered, like Skeeball's. */
function hbOf(g) { return ((g.games && g.games.holdem) || {}).hb || null; }
function hbReview(g) { const hb = hbOf(g); return !!(hb && holdemSuspect(hb)); }
function hbBankOf(g) {
  const hb = hbOf(g);
  if (!hb || holdemSuspect(hb)) return null;
  // An untouched (or voided) ledger is the starting stake - which is what this row's own game
  // shows them. Only rows with Hold'em plays reach this board, so nobody else is given it.
  return Math.max(0, holdemBalance(hb));
}
/** Has this person ever moved money? The Standing Records bankroll chip asks this first, or the
 *  starting stake every device carries would put a non-player on the podium. */
function hbTouched(g) { const hb = hbOf(g); return !!(hb && ((hb.entries | 0) || (hb.grants | 0))); }
const bankText = (n) => '$' + Math.max(0, Math.floor(+n || 0)).toLocaleString();

// --- SPELLING BEE'S BOARD (2026-10-28, docs/SPELLING-BEE-INTEGRITY-SPEC.md, Matt's mockup B) ------
// Its numbers come from the server's long-term board (boards/v1/bee, js/bee-board.js), not from the
// stats record: points or words found on each puzzle's OWN day, voided days counted as played with 0,
// 1st/2nd/3rd per day by points. Two toggles on the board itself (Points | Words, All | English |
// Español); By Game and the You tab always read All by points, so they match the board as it opens.
let _beeBy = 'points';
let _beeLang = 'all';
let _beeOff = null;
let _beeMemo = { board: null, key: '', map: null };
function beeView() { return _game === 'spellingbee' ? { lang: _beeLang, by: _beeBy } : { lang: 'all', by: 'points' }; }
/** This person's totals on the Spelling Bee board for the current view, or null (no board yet). */
function beeRowFor(g) {
  const b = beeBoard();
  if (!b) return null;
  const v = beeView();
  const key = `${v.lang}|${v.by}`;
  if (_beeMemo.board !== b || _beeMemo.key !== key) _beeMemo = { board: b, key, map: new Map(beeTotals(b, v).map((r) => [r.code, r])) };
  return _beeMemo.map.get(g.playerId) || { points: 0, words: 0, days: 0, first: 0, second: 0, third: 0, genius: 0, queen: 0 };
}
function beeTabsHTML() {
  const pill = (attr, v, sel, label) => `<button type="button" class="lb-pill lb-mstab lb-wohalf${sel ? ' is-sel' : ''}" data-${attr}="${v}" aria-pressed="${sel}">${esc(label)}</button>`;
  const third = (v, label) => pill('lbbeelang', v, _beeLang === v, label).replace('lb-wohalf', 'lb-wothird');
  return `<div class="lb-pills lb-mstabs" role="group">${pill('lbbeeby', 'points', _beeBy === 'points', tx('lb_bee_points', 'Points'))}${pill('lbbeeby', 'words', _beeBy === 'words', tx('lb_bee_words', 'Words'))}</div>`
    + `<div class="lb-pills lb-mstabs" role="group">${third('all', tx('lb_bee_all', 'All'))}${third('en', 'English')}${third('es', 'Español')}</div>`;
}
/** Under the name: 🥇🥈🥉 days (only the ones held), Genius 🧠 and Queen Bee 🐝 days, days played 📅. */
function beeChipsHTML(g) {
  const r = beeRowFor(g);
  if (!r) return '';
  const c = (glyph, n) => `<span class="lb-beechip"><span aria-hidden="true">${glyph}</span> ${n}</span>`;
  return `<span class="lb-beechips">${r.first ? c('🥇', r.first) : ''}${r.second ? c('🥈', r.second) : ''}${r.third ? c('🥉', r.third) : ''}${c('🧠', r.genius)}${r.queen ? c('🐝', r.queen) : ''}${c('📅', r.days)}</span>`;
}

function gameMetricAt(g, id, tier) {
  if (id === 'spellingbee' && beeBoard()) { const r = beeRowFor(g); return beeView().by === 'words' ? r.words : r.points; }
  if (id === 'ballrun') return brBestAt(g, tier);
  if (id === 'snake') return snBestAt(g, tier);
  if (id === 'hillclimb') return hcBestAt(g, tier);
  if (id === 'skeeball') return skPointsAt(g, _machine);
  if (id === 'brickblitz') return bzBestAt(g, tier);
  // Contexto ranks on MEDALS (Matt, 2026-09-29): golds, then silvers, then bronzes, then solves
  // with no medal, packed into one number by ctMedalScore (js/leaderboard-rank.js). Ties go to
  // the lower average guesses in boardMetricCmp below. Every solve is still stored and shown.
  if (id === 'contexto') return ctMedalScore(ctOf(g));
  if (id === 'golf') return golfBestAt(g);   // to par, LOWER WINS, null when never played
  // Best time at this difficulty, LOWER WINS, null when that level was never cleared. The tier
  // machinery does the rest: a row ranks at the HIGHEST level it has both played and cleared,
  // so a fast Expert clear outranks a faster Easy one (Matt, 2026-09-21: "the fastest time to
  // clear the highest level of difficulty").
  if (id === 'minesweeper') return msBestAt(g, tier);
  if (id === 'holdem') return hbBankOf(g);
  // Arrow Maze ranks on POINTS for levels cleared (2026-10-14, the ladder: js/arrow-maze-time.js),
  // all four difficulties added together; at a tier, that difficulty's own points.
  if (id === 'wayout') return woPoints(g.games.wayout, tier == null ? null : WO_TIERS[tier - 1]);
  // Gridlock ranks on POINTS for distinct levels cleared (js/gridlock-points.js), the same shape.
  if (id === 'gridlock') return glPoints(g.games.gridlock, tier == null ? null : GL_TIERS[tier - 1]);
  // Word Weaver ranks on POINTS: stars x the band's multiplier (1/2/3/4), over distinct levels
  // completed (js/word-weaver-points.js, Matt 2026-10-29); at a tier, that band's own points.
  if (id === 'wordweaver') return wwPoints(g.games.wordweaver, tier == null ? null : WW_TIERS[tier - 1]);
  // Sudoku / Murdoku: a row with a no-hint solve is ranked and shown by its no-hint solves (2026-10-29).
  if (NOHINT_GAMES.has(id) && noHintTierOf(g, id)) return noHintAt(g, id, tier);
  return winsAtTier(g, [id], tier);
}
/** How a board metric is PRINTED here. Everything more-is-better prints as the bare number it
 *  always did; golf takes a sign and shows level par as "E" (js/leaderboard-rank.js does the
 *  maths, this supplies the translated word). A player with no number gets the same em-dash
 *  glyph the empty leader cell already uses, never a literal "null". */
/** A row's Contexto sub-counter, or {} (never undefined). */
function ctOf(g) { return (((g && g.games) || {}).contexto || {}).ct || {}; }
const CT_MEDAL_GLYPH = { gold: '\u{1F947}', silver: '\u{1F948}', bronze: '\u{1F949}', solved: '\u2713' };
// CONTEXTO'S MEDALS ON ITS BOARD (2026-10-30, Matt's approved mockup): images, not emoji, so every phone
// shows the same four (gold is Matt's own edit; 3+ hints is the iron medal). The count sits on the face,
// in a colour dark enough to read (contrast 5+). [file, width/height, face centre x %, y %, number colour]
const CT_MEDAL_IMG = {
  gold: ['medal-gold.png', 115 / 180, 50, 69, '#7a3e00'],
  silver: ['medal-silver.png', 114 / 180, 50, 69.4, '#3d3d42'],
  bronze: ['medal-bronze.png', 114 / 180, 49.7, 69.4, '#5c2304'],
  iron: ['medal-iron.png', 114 / 180, 50, 69.4, '#ffffff'],
};
const CT_KINDS = ['gold', 'silver', 'bronze', 'iron'];
/** One medal `h` px tall, with `n` on its face (no number when `n` is null). */
function ctMedalHTML(kind, n, h) {
  const [file, ar, cx, cy, col] = CT_MEDAL_IMG[kind];
  const src = new URL(`../icons/${file}`, import.meta.url).href;
  const len = String(n == null ? '' : n).length;
  const fs = Math.round(h * (len >= 3 ? 0.24 : len === 2 ? 0.3 : 0.4));
  const num = n == null ? '' : `<span class="lb-ctm-n" style="left:${cx}%;top:${cy}%;font-size:${fs}px;color:${col}">${n}</span>`;
  return `<span class="lb-ctm" style="height:${h}px;width:${Math.round(h * ar)}px"><img src="${src}" alt="" draggable="false">${num}</span>`;
}
/** Wins per medal from a `ct` (or its daily `ct.d`): iron = solved with 3+ hints. */
function ctCounts(ct) {
  const c = ct || {};
  const gold = c.noHint | 0, silver = c.silver | 0, bronze = c.bronze | 0;
  return { gold, silver, bronze, iron: Math.max(0, (c.solved | 0) - gold - silver - bronze) };
}
/** The row's big medal: the best one held, with its count; a dash when nothing is solved. */
function ctBigHTML(ct) {
  const c = ctCounts(ct);
  const k = CT_KINDS.find((x) => c[x] > 0);
  return k ? ctMedalHTML(k, c[k], 58) : '<span>\u2014</span>';
}
/** Under the name: every other medal held, smaller, each with its count (ties read off these). */
function ctSubHTML(ct) {
  const c = ctCounts(ct);
  const big = CT_KINDS.find((x) => c[x] > 0);
  const rest = CT_KINDS.filter((x) => x !== big && c[x] > 0).map((x) => ctMedalHTML(x, c[x], 34)).join('');
  return rest ? `<span class="lb-ctsub">${rest}</span>` : '';
}
const ctDailyOf = (g) => ctOf(g).d || {};
/** The unit word under a board number. Contexto's changes per row with the medal it shows
 *  ("gold", "silver", ...), so it cannot be one static key like every other game's. */
function unitTextOf(id, metric) {
  if (id === 'contexto') { const b = ctBest(metric); return t(b.medal ? 'lb_ct_unit_' + b.medal : 'lb_ct_unit_solved'); }
  return t(lbUnitKeyOf(id));
}
function metricText(value, id) {
  // Contexto: the medal glyph (it carries 1/2/3 in its own face, so it reads without colour) and
  // how many of the player's BEST medal they hold. Not the packed number.
  if (id === 'contexto') { const b = ctBest(value); return b.medal ? `${CT_MEDAL_GLYPH[b.medal]} ${b.n}` : '\u2014'; }
  if (id === 'holdem') return value == null ? '\u2014' : bankText(value);
  const s = formatBoardMetric(value, id, t('lb_golf_even'));
  return s === null ? '\u2014' : s;
}

/** The metric's UNIT LABEL on this board only. It is deliberately not unitKeyOf(): that map is
 *  shared with My Stats, where golf's number is still the lifetime points total and "points" is
 *  still the right word. This board's golf number is a best round, so it needs its own label and
 *  My Stats must not inherit it. */
function lbUnitKeyOf(id) {
  if (id === 'golf') return 'lb_unit_golf_best';
  // Same split as golf: this BOARD ranks on a best time, while My Stats' game list still leads
  // with boards cleared, which is the right headline for a list of every game you have played.
  if (id === 'minesweeper') return 'lb_unit_ms_best';
  // Same split: this board ranks medals; My Stats' list still leads with every solve.
  if (id === 'contexto') return 'lb_unit_ct_medals';
  if (id === 'holdem') return 'lb_unit_bank';
  if (id === 'spellingbee' && beeBoard()) return beeView().by === 'words' ? 'lb_unit_words' : 'lb_unit_points';
  return unitKeyOf(id);
}

/** Plays for one game, honoring whichever filter that game's board actually offers. */
function boardPlaysOf(g, id) {
  if (id === 'spellingbee' && beeBoard()) return beeRowFor(g).days;
  if (id === 'holdem') return playsAtTier(g, [id], null);   // no difficulty filter on this board
  // Word Weaver at a band: the levels completed in it (one play each), read from the per-level map,
  // so plays recorded before the bands (byDiff 'ladder') still show under their band.
  if (id === 'wordweaver' && _tier != null) return wwCleared(g.games.wordweaver, WW_TIERS[_tier - 1]);
  return id === 'skeeball' ? skPlaysAt(g, _machine) : playsAtTier(g, [id], _tier);
}

// --- DIFFICULTY OUTRANKS SCORE, on a game's own board (2026-09-08) ----------------------------
// The spec, in Matt's words: "a player can only outrank someone by matching or beating their
// difficulty tier. A higher score in a lower tier never beats a lower score in a higher tier."
// Snake, Easy < Medium < Hard: Hard/10 is #1 over Medium/40.
//
// Scope is THIS SCREEN ONLY - a game's own board (the list you get by tapping into a game), which
// is what the spec asks for. By Player's cross-game list is untouched: its number is already
// difficulty-aware in a different way (the category filter picks a tier and counts wins IN it),
// and the tier-weighted rating model is a separate thing again (leaderboard-rank.js).
//
// The comparison itself is compareTierFirst() in leaderboard-rank.js, so it is pure and tested
// headless; everything below only decides what "this player's tier" is.

/** THE TIER THIS ROW IS RANKED AT, and the tier its NUMBER is read at - one answer for both, which
 *  is the whole point (2026-09-08, second pass). The first pass ranked by tier but still showed and
 *  tie-broke on the ALL-TIER number, so Snake's board put King of Games first at 51 - a score he set
 *  on Easy - while ranking him as a Hard player off a Hard best of 6. A board cannot rank on one
 *  number and print another; that is the bug Matt caught on the live board.
 *
 *  It is the highest tier this player has an actual SCORE at (hasBoardMetric: a win, a best, a
 *  solve - not merely plays). Plays alone would rank someone at Hard off fifty Hard games they
 *  never won, above a Medium player with forty wins, and print a 0 next to their name. An
 *  achievement is what the spec compares.
 *
 *  `null` = no tier: a game with no difficulty axis at all (Skeeball, Golf, Hill Climb -
 *  every row is null, so those boards are exactly what they were), and legacy/unmapped history in a
 *  game that has one. Their number stays the all-tier number and their row sorts below the tiered
 *  rows - still listed, still showing what they scored (THE LAW rule 1).
 *
 *  While a difficulty FILTER is selected it is that tier for every row, so a filtered board is the
 *  pure score board it always was. */
function boardTierOf(g, id) {
  if (id === 'holdem') return null;                          // ranked by bankroll alone
  // Arrow Maze: ONE number across all four difficulties, never hardest-difficulty-first (Matt,
  // 2026-10-14: a slow Expert player must not outrank a good Hard one; the points already make a
  // harder difficulty worth more: 1/2/4/6 a level). A filter still shows one difficulty's own points.
  if ((id === 'wayout' || id === 'gridlock' || id === 'wordweaver') && _tier == null) return null;
  if (_tier != null) return _tier;
  // BOTH accessors, always: plays prove this game HAS a difficulty axis (Skeeball's bucket is keyed
  // by machine, golf's by course, Hill Climb's by stage - none of them map to a tier), and the
  // metric proves the player actually SCORED at it. See boardRankTier's own header.
  return boardRankTier((tier) => gameMetricAt(g, id, tier), id, (tier) => playsAtTier(g, [id], tier));
}

/** The number this board ranks and PRINTS for a row: the game's own metric AT that row's tier.
 *  Every headline, every sort and every rank badge on a game board goes through this one function,
 *  so the order and the number on screen can never disagree again. */
function boardMetricOf(g, id) { return gameMetricAt(g, id, boardTierOf(g, id)); }

/** THE ONE comparator every metric sort on a game board goes through. Tier first, then that tier's
 *  own score via compareBoardMetric - which is what still gets golf's direction right. */
function compareBoardRow(a, b, id) {
  return compareTierFirst(boardTierOf(a, id) || 0, boardTierOf(b, id) || 0,
    boardMetricOf(a, id), boardMetricOf(b, id), id);
}

// --- NO-HINT SOLVES RANK FIRST: Sudoku and Murdoku (2026-10-29) --------------------------------
// Matt: a solve that used hints is still a WIN, "but ranked below" (Pressing Hint on every square
// solved an Expert Sudoku and counted as a full Expert win). So, the way Contexto ranks golds first:
// every row with a no-hint solve ranks above every row without one; among those, difficulty
// outranks score on the NO-HINT solves (an Expert no-hint solve beats 50 Easy ones), then the usual
// tier-first rule over ALL wins breaks a tie; every other row is ranked by that usual rule. A row
// with a no-hint solve has its no-hint count as its number (gameMetricAt), with "no hints" under it. No-hint counts come from players-agg.js (Sudoku
// `sd.noHint`, worked out per record; Murdoku `mu.clean`). Wins from before hints were tracked per
// solve count as no-hint only when proven (sdNoHintOf); otherwise they rank with the hint solves,
// still counted and shown as wins (THE LAW rule 1). Read-time only: nothing stored changes.
const NOHINT_GAMES = new Set(['sudoku', 'murdoku']);
function noHintMap(g, id) {
  const gm = ((g && g.games) || {})[id] || {};
  const m = id === 'sudoku' ? (gm.sd || {}).noHint : (gm.mu || {}).clean;
  return m && typeof m === 'object' ? m : {};
}
/** No-hint solves at `tier` (null = every tier), never more than the stored wins there. */
function noHintAt(g, id, tier) {
  const m = noHintMap(g, id), bd = (((g && g.games) || {})[id] || {}).byDiff || {};
  let n = 0;
  for (const k of Object.keys(m)) {
    if (tier != null && tierOf(k) !== tier) continue;
    n += Math.min(Math.max(0, m[k] | 0), Math.max(0, ((bd[k] || {}).won) | 0));
  }
  return n;
}
/** The tier a row's no-hint solves rank at: the selected filter's, else the hardest with one. 0 = none. */
function noHintTierOf(g, id) {
  if (!NOHINT_GAMES.has(id)) return 0;
  if (_tier != null) return noHintAt(g, id, _tier) > 0 ? _tier : 0;
  for (let tier = 4; tier >= 1; tier--) if (noHintAt(g, id, tier) > 0) return tier;
  return 0;
}
/** No-hint rows first, tier-first on their no-hint solves; 0 when that does not separate the pair. */
function compareNoHint(a, b, id) {
  const ta = noHintTierOf(a, id), tb = noHintTierOf(b, id);
  if (!ta && !tb) return 0;
  if (ta !== tb) return tb - ta;
  return noHintAt(b, id, tb) - noHintAt(a, id, ta);
}
/** The usual tier-first order over ALL wins (hint solves included), for a pair the no-hint rule
 *  does not separate. */
function compareAllWins(a, b, id) {
  const tierOfRow = (g) => (_tier != null ? _tier
    : boardRankTier((tier) => winsAtTier(g, [id], tier), id, (tier) => playsAtTier(g, [id], tier)));
  const ta = tierOfRow(a), tb = tierOfRow(b);
  return compareTierFirst(ta || 0, tb || 0, winsAtTier(a, [id], ta), winsAtTier(b, [id], tb), id);
}

/** THE BOARD'S ORDER, AS ONE FUNCTION - which is what stops the rows and their rank badges
 *  disagreeing (2026-09-08). `sortRows` orders the list with it, `gameDetail` numbers the badges
 *  with it, and By Game picks its leader row with it, so #1 on the board, the "1" chip and the
 *  name on the By Game row are the same person by construction.
 *
 *  They HAD drifted, and Tic Tac Toe is where it showed: its rows are ordered Ultimate -> Classic
 *  (Matt's own 2026-07-28 split) while the badges were numbered off the generic wins count, so a
 *  board could read 3, 2, 1, T4, T4, 7, 6, T8 down the page. Matt, on a screenshot of exactly
 *  that: "The leaderboard is weird."
 *
 *  Deliberately WITHOUT the plays/recency tie-breaks `sortRows` adds after it: those decide which
 *  of two equally-ranked rows is drawn first, and a rank badge must call that pair TIED. */
function boardMetricCmp(id) {
  if (id === 'tictactoe') {
    return (a, b) => {
      // Difficulty leads (2026-09-08); the Ultimate -> Classic order inside a tier is untouched.
      const d = (boardTierOf(b, id) || 0) - (boardTierOf(a, id) || 0);
      if (d) return d;
      const ta = (a.games.tictactoe && a.games.tictactoe.tt) || {};
      const tb = (b.games.tictactoe && b.games.tictactoe.tt) || {};
      return (ttVariantWins(tb.ultimate) - ttVariantWins(ta.ultimate))
        || (ttVariantWins(tb.classic) - ttVariantWins(ta.classic));
    };
  }
  // Contexto: medals, then the LOWER average guesses (Matt, 2026-09-29). Only a pair equal on
  // both is tied, so the rank badges agree with the order (see the note above).
  if (id === 'contexto') return (a, b) => compareContexto(ctOf(a), ctOf(b));
  // Sudoku / Murdoku: no-hint solves first (2026-10-29), then every win.
  if (NOHINT_GAMES.has(id)) return (a, b) => compareNoHint(a, b, id) || compareAllWins(a, b, id);
  // Cup Pong: equal wins, FEWER RERACKS ranks higher (Matt, 2026-10-28; counted from that day).
  if (id === 'cuppong') return (a, b) => compareBoardRow(a, b, id) || (cpReracksOf(a).r - cpReracksOf(b).r);
  return (a, b) => compareBoardRow(a, b, id);
}

/** Cup Pong's reracks spent in wins vs the computer at the row's board tier (`games.cuppong.cr`,
 *  js/game-stats.js recordCupPong): { w: wins tracked, r: reracks }. Tracked since 2026-10-28. */
function cpReracksOf(g) {
  const cr = (g.games.cuppong || {}).cr || {};
  const tier = boardTierOf(g, 'cuppong');
  let w = 0, r = 0;
  for (const [d, c] of Object.entries(cr)) {
    if (tier != null && tierOf(d) !== tier) continue;
    w += (c && c.w) | 0; r += (c && c.r) | 0;
  }
  return { w, r };
}

/** The board's metric order with DIFFICULTY TAKEN OUT: the game's own number, all tiers together,
 *  exactly as it was ranked before any of this. Matt, 2026-09-08: *"Number of games played
 *  shouldn't be based on difficulty at all. But the wins should be."* So this is what breaks a tie
 *  in the GAMES PLAYED sort - a volume order has no business consulting a difficulty tier, not
 *  even to settle a draw. Nothing else uses it. */
function comparePlainMetric(a, b, id) {
  return compareBoardMetric(gameMetricAt(a, id, _tier), gameMetricAt(b, id, _tier), id);
}

/** The tier a row is ranked at, said out loud on the card: the same ski-slope shape the filter and
 *  the tier tiles use, plus the word. Without it the board prints "6" under a name with nothing
 *  saying "that is a Hard score", which is how a board managed to look sorted while being ranked on
 *  something else. Nothing for an untiered row - there is no tier to name.
 *
 *  IT RIDES THE NAME LINE, NEXT TO THE PLAYER (2026-09-08). Its first home was the subline, beside
 *  the plays count, where "22 played  MEDIUM" read as "22 games played on Medium" - and games
 *  played is the one number on this card that has nothing to do with difficulty (Matt: "Number of
 *  games played shouldn't be based on difficulty at all. But the wins should be."). Attached to the
 *  name it says what it means: this PLAYER is ranked at this tier. */
function tierChipHTML(tier) {
  // Nothing while a difficulty FILTER is selected: the control directly above the list already says
  // "Showing: Easy", and repeating it on all twelve rows is noise that also reads as if the tier
  // varied from row to row when it is the one thing on that screen that cannot.
  if (_tier != null) return '';
  if (!tier) return '';
  return `<span class="lb-tierchip" style="--lb-pill-color:${TIER_COLOR[tier]}">${diffShapeSVG(tier)}<span>${esc(t(TIER_LABEL_KEY[tier]))}</span></span>`;
}

/** The same fact with no room for the word: the shape alone, carrying the tier in its `title` and
 *  its accessible name. By Game's row prints the leader's score AT THEIR TIER (it has to - it must
 *  name the person the board puts at #1, and that person's number is their tier's), so without a
 *  marker that row reads as the game's all-time record and is off by however much easier the
 *  record-holder's tier was. Shape, not hue (the colorblind rule); the word is one tap away on the
 *  board itself. */
/** The row's difficulty, said LOUD (Matt, 2026-10-15: "Make the difficulty played more obvious.
 *  Rn it's just a tiny symbol"): a bordered pill under the name, shape + word, on All views. */
function tierPillHTML(tier) {
  if (!tier) return '';
  const word = esc(t(TIER_LABEL_KEY[tier]));
  return `<span class="lb-tierpill" style="--lb-pill-color:${TIER_COLOR[tier]}">${diffShapeSVG(tier)}<span>${word}</span></span>`;
}
function tierMarkHTML(tier) {
  if (!tier) return '';
  const label = esc(t(TIER_LABEL_KEY[tier]));
  return `<span class="lb-tiermark" style="--lb-pill-color:${TIER_COLOR[tier]}" title="${label}" role="img" aria-label="${label}">${diffShapeSVG(tier)}</span>`;
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
  lb_unit_cleared: 'lb_sort_cleared',
  lb_unit_meters: 'lb_sort_meters',
  // Skeeball and Brick Breaker rank on points; without this row their sort menus said "Wins".
  lb_unit_points: 'lb_sort_points',
  // Word Weaver ranks on stars.
  lb_unit_stars: 'lb_sort_stars',
  // Golf ranks on a best round, not on wins or points.
  lb_unit_golf_best: 'lb_sort_golf_best',
  // Minesweeper ranks on a best time, not on how many boards were cleared.
  lb_unit_ms_best: 'lb_sort_ms_best',
  // Contexto ranks on medals.
  lb_unit_ct_medals: 'lb_sort_ct_medals',
  // Texas Hold'em ranks on the bankroll.
  lb_unit_bank: 'lb_sort_bank',
};
function sortItemsFor(id) {
  const labelKey = UNIT_TO_SORT_LABEL[lbUnitKeyOf(id)] || 'lb_sort_wins';
  // CUP PONG ONLY (2026-09-28, Matt): "a leaderboard for who can clear the full rack with the
  // fewest throws". Solo racks and matches vs the computer are two different records, so this is
  // its own sort, FIRST so the board opens on it, the way Skeeball's 'high' is its own.
  if (id === 'cuppong') {
    return [
      { sort: 'fewest', labelKey: 'lb_sort_fewest' },
      { sort: 'wins', labelKey },
      { sort: 'played', labelKey: 'lb_sort_games_short' },
      { sort: 'alpha', labelKey: 'lb_sort_name' },
    ];
  }
  return [
    { sort: 'wins', labelKey },
    // SKEEBALL ONLY, and only since Points started meaning a lifetime (2026-09-01). Matt: "Another
    // sort option should be added for best single round tho. High scores or something like that."
    // It is offered nowhere else because no other game stores a per-game best AND a lifetime total
    // as two separate numbers - everywhere else the metric already IS the one number there is.
    ...(id === 'skeeball' ? [{ sort: 'high', labelKey: 'lb_sort_high' }] : []),
    // TEXAS HOLD'EM ONLY: its board leads with the bankroll, and wins stay one tap away.
    ...(id === 'holdem' ? [{ sort: 'hwins', labelKey: 'lb_sort_wins' }] : []),
    { sort: 'played', labelKey: 'lb_sort_games_short' },
    { sort: 'alpha', labelKey: 'lb_sort_name' },
  ];
}
/** `_sort` is ONE value shared by By Player and every game board, and 'high' means something on
 *  exactly one of them. Everywhere else it resolves to the metric sort, so a saved default of
 *  'high' can never leave a screen with no pill lit and no order anybody asked for. */
/** A BOARD'S SORT IS ITS OWN, AND IT RESETS EVERY TIME YOU OPEN ONE (2026-09-11). Matt: *"if I
 *  click into a game, it should be on the Longest, High Score, wins. Whatever the leftmost option
 *  is."* `_boardSort` is set from `sortItemsFor(id)[0]` on the way in, so it follows that list
 *  rather than restating it - move the metric out of first place and this default moves with it.
 *
 *  It is deliberately SEPARATE from `_sort`, which By Player still owns and still persists (the
 *  saved default view, `gamehub.lb.sort.v1`). They were one value, so landing on a board used to
 *  inherit whatever By Player was sorted by - and, worse, changing a board's sort silently rewrote
 *  the persisted By Player preference. The 'high' guard stays: it is Skeeball's alone, and a
 *  `_boardSort` carried into a game that does not offer it would light no pill at all. */
function effectiveSort(id) {
  if (id == null) return _sort;
  if (_boardSort === 'hwins' && id !== 'holdem') return 'wins';
  if (_boardSort === 'fewest' && id !== 'cuppong') return 'wins';
  return _boardSort === 'high' && id !== 'skeeball' ? 'wins' : _boardSort;
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
 *  field-wide total beside each. (The "Make this my default view" row went 2026-10-27: every
 *  choice is now remembered as it is made, see persistView.) */
function catControlsHTML(list) {
  const cur = catMeta(_cat);
  const total = (id) => list.reduce((a, g) => a + catValueOf(g, id), 0);
  const panel = _panel !== 'cat' ? '' : `<div class="lb-panel-list" role="listbox" aria-label="${esc(t('lb_cat_filter_aria'))}">
    ${[CAT_ALL, ...CATS].map((c) => optionHTML({
      attr: 'cat', value: catToStored(c.id), keyText: t(c.keyKey), name: t(c.nameKey),
      count: total(c.id), selected: _cat === c.id,
    })).join('')}
  </div>`;
  return `<div class="lb-ctrls">
    ${sortPillsHTML(SORT_ITEMS_DEFAULT, effectiveSort(null), 'sort')}
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
  const pills = sortPillsHTML(sortItemsFor(id), effectiveSort(id), 'sort');
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
  // A solo Cup Pong rack has no difficulty, so its sort offers no difficulty filter to do nothing.
  if (!fieldTiers.length || effectiveSort(id) === 'fewest') return `<div class="lb-ctrls">${pills}</div>`;
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

function miniTilesHTML(tiers, valueFn, markTier) {
  if (!tiers.length) return '';
  return `<div class="lb-tiles">${tiers.map((tier) => {
    const v = valueFn(tier);
    // Marked = the tier this row is RANKED at (the board card passes it), or the selected filter
    // on every other surface. Same highlight either way: "this is the tier that counts here".
    const sel = (markTier === undefined ? _tier === tier : markTier === tier) ? ' is-sel' : '';
    const empty = v == null ? ' is-empty' : '';
    return `<span class="lb-tile2${sel}${empty}" style="--lb-pill-color:${TIER_COLOR[tier]}" title="${esc(t(TIER_LABEL_KEY[tier]))}">${diffShapeSVG(tier)}<b>${v == null ? '&mdash;' : v}</b></span>`;
  }).join('')}</div>`;
}

/** The difficulty breakdown on a By Player card, INLINE on the line that already exists under the
 *  name - not a row of its own (2026-08-31). Matt, after the chip strip came off: "I want the
 *  difficuly information. But don't want you to waste so much space on it." So this costs ZERO
 *  extra height: the card stays the 66px of a Skeeball board row, and the breakdown simply takes
 *  the place of the old "N wins"/"N played" subline text.
 *
 *  It is SHAPES, not the letter badges it replaces ("E 3003", "NT 33"), which is what makes it fit
 *  and what makes it readable at the same time. The ski-slope shapes are this app's own difficulty
 *  vocabulary - circle/square/diamond/double-diamond, the same `diffShapeSVG()` on every game's
 *  setup screen, in the filter dropdown two inches above this list, and on the tier tiles of the
 *  game boards Matt likes. Nobody has to learn them here. They are also colorblind-safe by
 *  construction (shape first, hue second), which a one-letter badge never was.
 *
 *  TIER ORDER, never value order. The old strip sorted by value, so the shapes landed in a
 *  different sequence on every card and the column could not be read downwards. In tier order the
 *  same shape sits in the same place on every row, which is exactly what miniTilesHTML does on a
 *  game board.
 *
 *  The two buckets with no shape are the two that are not difficulties: 'NT' (Skeeball machines,
 *  Hill Climb stages, plus legacy history) and 'VS' (wins against real people).
 *  They are drawn with their real WORD, never their initials - they are the last things to fit,
 *  and an unlabelled shape invented for them would claim a difficulty they do not have (rule 4's
 *  habit). Dropping them entirely was the alternative and is worse: 'NT' is the BIGGEST bucket for
 *  anyone who mostly plays Skeeball, so a card without it would show shapes summing to a small
 *  fraction of that player's real wins. */
// TIER ORDER, and the two shapeless ones last - which also makes them the first to be dropped when
// the row runs out of width, and that is the right order to lose them in: they are the two that
// are not difficulties, and difficulty is what this line is for.
const CAT_ORDER = [1, 2, 3, 4, 'NT', 'VS'];
// The cap is a WIDTH ESTIMATE IN PIXELS, not a character count and not an item count. The first
// draft counted characters and was wrong in both directions at once - it treated a 4px-wide "1"
// and a whole word as comparable units, so it clipped "No tier 1342" while still refusing a fourth
// two-digit tier that had 20px of room going spare. These five constants were read off a real
// Chromium at 393x852 against .lb-cat's own type (11.5px/800 tabular, 10.5px/700 for the word) and
// predict the measured natural widths to within a few px; BUDGET is the narrowest row the card
// produces (164px on the widest name), minus a little slack. `overflow:hidden` in the CSS is the
// belt to this braces - if an estimate is ever off, a category vanishes rather than half-drawing.
const CAT_W = { shape: 10, shapeX2: 18, digit: 8, word: 5.9, inner: 4, gap: 9, budget: 158 };
function catInlineHTML(g) {
  const vals = CAT_ORDER.map((id) => ({ c: catMeta(id), v: catValueOf(g, id) }));
  // A category with no plays is not drawn - EXCEPT the one being filtered on, which is drawn even
  // at zero so that picking Expert shows you the zero instead of an empty line (the one rule worth
  // keeping from the strip this replaces).
  const widthOf = (x) => (typeof x.c.id !== 'number' ? t(x.c.nameKey).length * CAT_W.word
    : x.c.id === 4 ? CAT_W.shapeX2 : CAT_W.shape)
    + CAT_W.inner + String(x.v).length * CAT_W.digit;
  // WHAT to show is chosen by VALUE; WHERE it goes is tier order. Those are two different
  // questions and the first draft answered both with tier order, so the row filled up left to
  // right and Expert - the one number on the line anybody brags about - was always the first to be
  // dropped. Taking the biggest first and then sorting the survivors back into CAT_ORDER keeps the
  // shapes lined up down the column AND keeps the numbers worth reading.
  const pinned = vals.filter((x) => x.c.id === _cat);
  const rest = vals.filter((x) => x.c.id !== _cat && x.v > 0).sort((a, b) => b.v - a.v);
  const shown = [];
  let cost = 0;
  for (const x of pinned.concat(rest)) {
    const w = widthOf(x) + (shown.length ? CAT_W.gap : 0);
    // The first one always earns its place, budget or not: a player whose whole history is in one
    // bucket (a Skeeball-only player has nothing BUT 'No tier') must not get a blank line.
    if (shown.length && cost + w > CAT_W.budget) continue;
    shown.push(x);
    cost += w;
  }
  if (!shown.length) return '';
  shown.sort((a, b) => CAT_ORDER.indexOf(a.c.id) - CAT_ORDER.indexOf(b.c.id));
  return `<span class="lb-cats">${shown.map(({ c, v }) => {
    const sel = _cat === c.id ? ' is-sel' : '';
    const label = esc(t(c.nameKey));
    const mark = typeof c.id === 'number'
      ? diffShapeSVG(c.id)
      : `<i class="lb-cat-w">${label}</i>`;
    const color = typeof c.id === 'number' ? `style="--lb-pill-color:${TIER_COLOR[c.id]}"` : '';
    return `<span class="lb-cat${sel}" ${color} title="${label}">${mark}<b>${v}</b></span>`;
  }).join('')}</span>`;
}

/** UNUSED since 2026-08-31 - left in place, with its CSS, exactly as metaLine() above was: nothing
 *  deleted, just not rendered, and the helper is here if it is ever wanted back. Matt: "i don't
 *  like the chips. they are not obvious. try a new approach." See the note at its old call site in
 *  playerListHTML for where the six categories are read in full words instead. The history below
 *  is kept because it records what this line already cost once, and why the grid it replaced is
 *  not the thing to reach for either.
 *
 *  The category breakdown on a LIST CARD: ONE line, never two (Matt, 2026-08-25, seeing the 3x2
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
/** The player-detail breakdown (2026-09-02, rewritten).
 *
 *  It was one six-cell grid with no heading: "E 1 · M 12 · H 0 · X 0 · NT 36 · VS 8". Matt: "It's
 *  not clear what you're looking at unless you really look." Two things were wrong with it. It had
 *  no stated subject, and it was not one subject: four of the six cells are WINS AT A DIFFICULTY,
 *  the fifth is a count of RUNS in games that have no difficulty, and the sixth is wins against
 *  people. Three kinds of number under one unlabelled roof.
 *
 *  So: four tiers in their own row under their own heading (four cells, four columns, no ragged
 *  last row), then the other two under a heading of their own, each spelled out in words rather
 *  than left to a two-letter chip. The chips stay because the By Game filter uses the same six
 *  keys, and dropping them here would break that legend; they are just no longer carrying the
 *  meaning by themselves. Every number is the same number as before - catValueOf is untouched. */
function catGridHTML(g) {
  const cell = (c, label) => {
    const sel = _cat === c.id;
    return `<span class="lb-cell${sel ? ' is-sel' : ''}">
      <span class="lb-cell-top">${typeof c.id === 'number' ? `<span class="lb-cell-shape" style="--lb-pill-color:${TIER_COLOR[c.id]}">${diffShapeSVG(c.id)}</span>` : ''}<em>${esc(label)}</em></span>
      <b>${catValueOf(g, c.id)}</b>
    </span>`;
  };
  const tiers = CATS.filter((c) => typeof c.id === 'number');
  const nt = CATS.find((c) => c.id === 'NT');
  const vs = CATS.find((c) => c.id === 'VS');
  return `<h4 class="lb-h4">${esc(t('lb_pd_wins_h'))}</h4>
    <div class="lb-grid6 is-4">${tiers.map((c) => cell(c, t(c.nameKey))).join('')}</div>
    <h4 class="lb-h4">${esc(t('lb_pd_other_h'))}</h4>
    <div class="lb-grid6 is-2">${cell(nt, t('lb_pd_nt'))}${cell(vs, t('lb_pd_vs'))}</div>`;
}

// --- By Player ---------------------------------------------------------------
/** THE SHAPE KEY (2026-10-11 review): the circle / square / diamond / double diamond on the rows
 *  meant nothing to a first-time reader. One line, the shape beside its word, so the colour is
 *  never the only thing carrying the tier (Matt is red/green colorblind). */
function legendHTML() {
  return `<div class="lb-legend" role="note" aria-label="${esc(tx('lb_legend_aria', 'Difficulty key'))}">${[1, 2, 3, 4].map((tier) => {
    const meta = DIFF_PILLS.find((p) => p.tier === tier);
    return `<span class="lb-legend-i" style="--lb-pill-color:${TIER_COLOR[tier]}">${diffShapeSVG(tier)}${esc(t(meta.labelKey))}</span>`;
  }).join('')}</div>`;
}
/** Rank chips carry SHAPE, never hue (Matt is red/green colorblind, and the gold/silver/bronze
 *  medals this replaced were hue alone): 1st filled square, 2nd heavy outlined rounded square,
 *  3rd thin outlined circle, 4th and below a plain numeral with no chrome. A tie gets a dashed
 *  chip and a T prefix, and the next rank skips accordingly. Print it in greyscale: the podium
 *  is still readable. */
/** The tie prefix on a rank chip, in the viewer's language; falls back to 'T' for the one visit
 *  after a deploy when a cache-first js/strings.js may not have the key yet. */
function tieMark() { return tx('lb_tie_mark', 'T'); }
/** t() with an English fallback for a key added after the cached dictionary (see tieMark). */
function tx(key, fallback, params) { const v = t(key, params); return v === key ? fallback : v; }
// THE PODIUM GETS MEDALS (Matt, 2026-10-15, after the old square / rounded / circle chips: "You
// have things to differentiate between 1, 2, 3, etc. But barely. Ana is the current leader. She's
// in first. Act like it." - with his office Skeeball board's ribboned medals as the reference).
// Gold, silver and bronze carry the number on their face, so the rank never rests on hue alone.
const MEDAL = {
  1: { face: '#f5c842', rim: '#c9971c', ink: '#5a4106' },
  2: { face: '#e3e7ec', rim: '#9aa3ae', ink: '#3b4450' },
  3: { face: '#d9925a', rim: '#9c5a2a', ink: '#ffffff' },
};
function medalSVG(rank) {
  const m = MEDAL[rank];
  return `<svg class="lb-medal" viewBox="0 0 40 48" aria-hidden="true">
    <path d="M11 30 L5 46 L11 43 L14 48 L19 33 Z" fill="#d6452f"/><path d="M29 30 L35 46 L29 43 L26 48 L21 33 Z" fill="#e8762c"/>
    <circle cx="20" cy="19" r="17" fill="${m.rim}"/><circle cx="20" cy="19" r="13.5" fill="${m.face}"/>
    <circle cx="20" cy="19" r="13.5" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>
    <text x="20" y="24.5" text-anchor="middle" font-size="15" font-weight="800" fill="${m.ink}" font-family="system-ui,-apple-system,sans-serif">${rank}</text>
  </svg>`;
}
function rankChipHTML(rank, tie) {
  if (rank >= 1 && rank <= 3) {
    return `<span class="lb-chip lb-medalchip is-r${rank}" role="img" aria-label="${tie ? esc(tieMark()) : ''}${rank}">${medalSVG(rank)}</span>`;
  }
  return `<span class="lb-chip${tie ? ' is-tie' : ''}">${tie ? esc(tieMark()) : ''}${rank}</span>`;
}

/** Standard competition ranking over `list` by `valueOf`, with ties sharing a rank and the next
 *  rank skipping. Returns { rankOf, tiedAt } keyed by group key, so a row's chip never depends on
 *  which order the list happens to be SORTED in - re-sorting by name cannot renumber the podium. */
// `cmp` overrides the default more-is-better order. It exists for golf, where the badge numbers
// are the sort direction made visible: rank the rows descending and the #1 chip lands on the
// worst golfer even when sortRows has the list the right way up.
function rankMap(list, valueOf, cmp) {
  const ranked = list.slice().sort(cmp || ((a, b) => valueOf(b) - valueOf(a)));
  const rankOf = {};
  const countAt = {};
  let prev = null;
  let rank = 0;
  // WHEN A COMPARATOR IS GIVEN, IT DECIDES WHAT A TIE IS (2026-09-08). Equal `valueOf` is only the
  // same rank when the value is the whole order - and since difficulty now outranks score, two
  // players on the same score in DIFFERENT tiers are not tied, they are #1 and #2. Golf is
  // unaffected: its comparator returns 0 exactly when the two rounds are equal, as before.
  ranked.forEach((g, i) => {
    const v = valueOf(g);
    const same = i > 0 && (cmp ? cmp(ranked[i - 1], g) === 0 : v === prev);
    if (!same) { rank = i + 1; }
    prev = v;
    rankOf[g.key] = rank;
    countAt[rank] = (countAt[rank] || 0) + 1;
  });
  return { rankOf, tiedAt: (key) => countAt[rankOf[key]] > 1 };
}

/** The "this is you" marker, which is a LABEL, not a color: a filled YOU badge beside the name
 *  plus the row's own accent rail (see .lb-pcard.is-me). Never hue alone. */
// RETIRED 2026-10-15 (root CLAUDE.md: name every player by their profile name, never "You"). The
// viewer's own row keeps its highlight (.lb-pcard.is-me); the word cut names short ("Mat...").
function youBadge(g) { return ''; }

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
// `subHtml` (optional) replaces the escaped `subText` on the subline with real markup - the By
// Player card passes catInlineHTML(g) there, which is how the difficulty breakdown rides a line
// that already exists instead of costing the card a row. Every game board omits it and is
// byte-identical to before.
const _pkeys = [];
function playerCardHTML(g, chip, big, subText, tilesHtml, subHtml, tierHtml) {
  const me = g.key === _meKey ? ' is-me' : '';
  const podium = (/lb-medalchip is-r([123])/.exec(chip || '') || [])[1];
  const pod = podium ? ` is-pod${podium}` : '';
  // Row 2 is the breakdown alone; the OTHER number moved under the name (row 1) in the 2026-08-25
  // handoff, so the card reads name / what they played on one line and the breakdown below it.
  const footer = tilesHtml ? `<div class="lb-pfoot">${tilesHtml}</div>` : '';
  const sub = subHtml || esc(subText || '');
  // The identity key ("code:XXXXX") stays in memory; the card carries an opaque index (2026-10-29).
  if (_pkeys.length > 2000) _pkeys.length = 0;
  const pi = _pkeys.push(g.key) - 1;
  return `<button type="button" class="lb-pcard${me}${pod}" data-pi="${pi}"${me ? ' aria-current="true"' : ''}>
    <div class="lb-pcard-row">
      ${chip}
      ${avatarHTML(g)}
      <span class="lb-pid"><span class="lb-pline"><span class="lb-pname">${rankName(g)}</span>${youBadge(g)}${tierHtml || ''}</span><span class="lb-psubline">${sub}</span></span>
      <span class="lb-pnum"><b${big.cls ? ` class="${big.cls}"` : ''}>${big.val}</b><span>${esc(big.unit)}</span>${big.unit2 ? `<span>${esc(big.unit2)}</span>` : ''}</span>
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
  // 'high' is Skeeball's board sort and means nothing here; effectiveSort resolves it to the
  // measure sort so a saved default of it cannot leave this screen with no pill lit (see its own
  // note). Everything below reads pSort, never _sort, so the pills and the order cannot disagree.
  const pSort = effectiveSort(null);
  // THE BADGE RANKS BY WHATEVER THE LIST IS SORTED BY, when that sort is a MEASURE (2026-08-26).
  // rankMap's own comment says the chip must not depend on the list's order, so that re-sorting
  // by name cannot renumber the podium - which is right for NAME, and was applied to all three
  // sorts without anyone checking the middle one. Sorting by Played DOES produce a ranking (the
  // list is literally in order of most played), so a badge frozen to the wins order sat beside it
  // reading 1, 2, 6, 3, 5, 4. Matt, from the live board: "Why did that break?"
  // Alphabetical is not a ranking, so it keeps the wins podium exactly as before.
  const { rankOf, tiedAt } = rankMap(rows, pSort === 'played' ? (g) => playedOf(g, null) : value);
  if (pSort === 'alpha') {
    rows.sort((a, b) => {
      const n = (a.name || '').localeCompare(b.name || '');
      if (n) return n;
      const w = value(b) - value(a);
      if (w) return w;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  } else if (pSort === 'played') {
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
  const tieNote = rows.some((g) => tiedAt(g.key)) ? `<p class="lb-note">${esc(tx('lb_note_tie', 'T = tied.'))}</p>` : '';
  return `${tieNote}<div class="lb-plist">${rows.map((g) => {
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
    const big = pSort === 'played'
      ? { val: played, unit: unitWord('lb_played_count') }
      : { val: value(g), unit: catUnit(_cat) };
    const subText = pSort === 'played'
      ? `${value(g)} ${catUnit(_cat)}`
      : t('lb_played_count', { n: played });
    // NO FOOTER ROW HERE (2026-08-31). Matt, on this screen beside a game board's: "I don't like
    // the spacing on the leaderboard homepage. I DO like the spacing on the individual game
    // leaderboard (skeeball for example)" - then, on the chips themselves: "i don't like the chips.
    // they are not obvious. try a new approach."
    //
    // Both complaints have the same cause. Skeeball's board has no difficulty axis, so its cards
    // carry no footer at all and are one clean row; every card here carried the six-category strip,
    // which took the card from ~61px to ~99px AND made the height vary with how many categories a
    // person happened to have played, so the list had no rhythm. Passing no footer makes this card
    // structurally identical to the board card he likes - same markup, same height, one row.
    //
    // The breakdown itself is NOT gone - Matt, when it was: "I want the difficuly information. But
    // don't want you to waste so much space on it." It moved INLINE, onto the subline that already
    // exists under the name, as shapes rather than letter badges (see catInlineHTML). So the card
    // carries the difficulty split AND stays 66px: the strip cost a whole row, this costs none.
    //
    // What the subline no longer carries is the OTHER metric ("1082 wins" beside a "3490 PLAYED"
    // headline). That is the trade Matt picked, and it is the cheap half: under the Wins sort the
    // shapes ARE that number, split up, and under either sort the full pair is one tap away on the
    // player's detail screen - which also renders all six categories under their real names,
    // zeroes included (catGridHTML). Nothing became unreachable (THE LAW rule 1).
    return playerCardHTML(g, rankChipHTML(rankOf[g.key], tiedAt(g.key)), big, subText, '', catInlineHTML(g));
  }).join('')}</div>`;
}

// --- one game's standing: who leads, and where everyone is (2026-10-27) ----------------------
/** Everyone with a number on this game's board, in the board's OWN order (boardMetricCmp, the same
 *  function that numbers the board's rank badges), with the ranks. By Game's top three and the You
 *  tab both read this, so #1 here, the "1" on the board and the record on the You tab are the same
 *  person by construction. */
function gameStanding(list, id) {
  const order = boardMetricCmp(id);
  const rows = list.filter((g) => hasBoardMetric(gameMetricAt(g, id, null), id))
    .sort((a, b) => order(a, b) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const { rankOf, tiedAt } = rankMap(rows, () => 0, order);
  return { rows, rankOf, tiedAt };
}

/** Which unit family a game's number is in, for the "your best" value and the gap line. Contexto's
 *  packed medal score has no honest difference to print, so it gets no gap (null). */
function gapKind(id) {
  if (id === 'contexto') return null;
  return ({
    lb_unit_ms_best: 'time', lb_unit_golf_best: 'golf', lb_unit_meters: 'meters', lb_unit_points: 'points', lb_unit_stars: 'stars',
    lb_unit_obstacles: 'obstacles', lb_unit_longest: 'longest', lb_unit_solved: 'solved', lb_unit_bank: 'bank', lb_unit_words: 'words',
  })[lbUnitKeyOf(id)] || 'wins';
}
function numText(n) {
  try { return Number(n).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-US'); } catch { return String(n); }
}
/** A board number with its short unit ("820 pts", "7:05", "43 long", "3 wins"). Plain text. */
function youValText(id, v) {
  const k = gapKind(id);
  if (v == null || (typeof v === 'number' && Number.isNaN(v))) return '—';
  if (!k || k === 'time' || k === 'golf') return metricText(v, id);
  if (k === 'bank') return bankText(v);
  return tx('lb_yval', numText(v), { k, v: numText(v), n: v });
}
/** What it takes to reach #1, in one plain line, or '' when there is no honest number to give.
 *  `b` wraps the number (the board line bolds it). The gap is read at the RECORD'S tier, because
 *  difficulty outranks score on every board: a Medium 40 is not "30 ahead" of a Hard 10. When the
 *  viewer has no score at that tier, the line says what to beat and where instead of a difference. */
function gapText(me, rec, id, b = (x) => x) {
  const p = gapParts(me, rec, id);
  if (!p) return '';
  if (p.k === 'tier') return tx('lb_gap', '', { k: 'tier', v: b(esc(p.v)), tier: esc(p.tier) });
  return tx('lb_gap', '', { k: p.k, v: b(p.v), n: p.n });
}
/** gapText's maths as parts (2026-10-31, shared with Leaderboard v2's pinned row so both boards
 *  print the same gap): { k, v, n } for a difference in one unit (`v` formatted), { k: 'tier', v,
 *  tier } when `rec` is at a harder difficulty, or null when there is no honest number. Same rules. */
function gapParts(me, rec, id) {
  const k = gapKind(id);
  if (!k || !me || !rec || me.key === rec.key) return null;
  // A no-hint record over a hint-only row: no difference in one unit to give (2026-10-29).
  if (!noHintTierOf(rec, id) !== !noHintTierOf(me, id)) return null;
  const tier = boardTierOf(rec, id);
  const r = gameMetricAt(rec, id, tier);
  const m = gameMetricAt(me, id, tier);
  const myTier = boardTierOf(me, id);
  if (m == null || (tier || 0) !== (myTier || 0)) {
    if (!tier || (myTier || 0) > tier) return null;
    return { k: 'tier', v: youValText(id, r), tier: t(TIER_LABEL_KEY[tier]) };
  }
  let d;
  let v;
  if (k === 'time') {
    d = Math.floor(m / 1000) - Math.floor(r / 1000);
    v = formatTimeMetric(d * 1000);
  } else {
    d = LOWER_IS_BETTER.has(id) ? m - r : r - m;
    v = k === 'bank' ? bankText(d) : numText(d);
  }
  if (!(d > 0)) return null;
  return { k, v, n: d };
}
/** How close `me` is to the record, 0..1, for "Closest first". Anything with no gap sorts last. */
function closeness(me, rec, id) {
  if (!gapText(me, rec, id)) return -1;
  const tier = boardTierOf(rec, id);
  const r = gameMetricAt(rec, id, tier);
  const m = gameMetricAt(me, id, tier);
  if (!LOWER_IS_BETTER.has(id)) return r > 0 ? Math.max(0, m) / r : 0;
  if (r > 0 && m > 0) return r / m;
  return 1 / (1 + Math.max(0, m - r));   // golf: scores to par can be 0 or below, so no ratio
}
/** The rank in words: "You're 3rd" on the You tab, "{name} is 3rd." under a board. */
function rankWords(key, rank, tie, name) { return tx(key, String(rank), { n: rank, tie, name }); }

/** A rank badge for By Game's top three: the number in a circle, FILLED for first and outlined
 *  for second and third, so the order reads without colour (Matt is red/green colorblind). */
function topBadgeHTML(rank, tie) {
  return `<i class="lb-tb${rank === 1 ? ' is-1' : ''}">${tie ? esc(tieMark()) : ''}${rank}</i>`;
}
/** One name in By Game's top three. The viewer's own name is drawn inside an outline, never a
 *  word: root CLAUDE.md, profile names, never "You", outside the You tab (Matt, 2026-10-27). */
function topNameHTML(g, rank, tie, first) {
  const me = g.key === _meKey ? ' is-me' : '';
  return `<span class="lb-gtop${first ? ' is-first' : ''}">${topBadgeHTML(rank, tie)}<span class="lb-gtop-who${me}">${avatarHTML(g)}<span class="lb-gtop-nm">${rankName(g)}</span></span></span>`;
}

// --- By Game: the top three in every game (2026-10-27) ------------------------------------------
// Ana: the list mixed units (points, a time, solved, obstacles, wins, metres), so the numbers on
// the right could not be compared and read as noise. So: NO NUMBERS on this list, just who is 1st,
// 2nd and 3rd in each game; the scores are one tap away on the game's own board. Every game, always,
// in one of three orders. A game nobody has played still gets a card that says so and sorts to the
// bottom. The favorites order reads js/favorites.js, the launcher's own list.
function gameListHTML(list) {
  let favs = [];
  try { favs = loadFavorites() || []; } catch { favs = []; }
  const isFav = (id) => favs.includes(hubIdOf(id));
  // ADMIN-ONLY GAMES ARE OFF THIS LIST (2026-09-09, Matt: "hide admin only games from the
  // leaderboard too"). Same rule as the hub card, asked through the one shared helper, so the
  // launcher and the board cannot disagree about what is released. THREE THINGS ARE DELIBERATELY
  // NOT FILTERED, and each is THE LAW rule 1: GAME_META itself (ALL_IDS/COMP_IDS are built from
  // it, so filtering here would silently drop those wins out of every cross-game total), the
  // player-detail game list (a person's own record of a game Matt has pulled back stays reachable,
  // via game-stats-ui's visibleTabs, which is deliberately more permissive), and the stored data,
  // which is untouched. A game released later simply reappears with its whole history intact.
  const rows = gameMetaSorted().filter((meta) => isGameOnLauncher(meta.id)).map((meta) => {
    const plays = list.reduce((a, g) => a + playsAtTier(g, [meta.id], null), 0);
    return { meta, plays, st: gameStanding(list, meta.id), fav: isFav(meta.id) };
  });
  rows.sort((a, b) => {
    // Unplayed games always sink, in every order: they have no leader to rank.
    if (!a.plays !== !b.plays) return a.plays ? -1 : 1;
    if (_gameSort === 'popular' && b.plays !== a.plays) return b.plays - a.plays;
    if (_gameSort === 'fav' && a.fav !== b.fav) return a.fav ? -1 : 1;
    return t(a.meta.labelKey).localeCompare(t(b.meta.labelKey));
  });
  const chevron = '<svg class="lb-gchev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"></polyline></svg>';
  const cards = rows.map(({ meta, st, fav }) => {
    const art = GAME_ART[hubIdOf(meta.id)] || '';
    const top = st.rows.slice(0, 3);
    const rankOf = (g) => st.rankOf[g.key];
    const body = top.length
      ? topNameHTML(top[0], rankOf(top[0]), st.tiedAt(top[0].key), true)
        + (top.length > 1 ? `<span class="lb-gtop-rest">${top.slice(1).map((g) => topNameHTML(g, rankOf(g), st.tiedAt(g.key), false)).join('')}</span>` : '')
      : `<span class="lb-glead lb-glead-empty">${esc(t('lb_no_games_yet'))}</span>`;
    return `<button type="button" class="lb-gcard${top.length ? '' : ' is-empty'}" data-game="${meta.id}">
      <span class="lb-gcard-head">
        <span class="lb-gart is-sm">${art}</span>
        <span class="lb-gtitle">${fav ? '<i class="lb-star" aria-hidden="true">★</i>' : ''}<span class="lb-gname">${esc(t(meta.labelKey))}</span></span>
        ${chevron}
      </span>
      ${body}
    </button>`;
  });
  if (!cards.length) return emptyState(t('lb_empty_all'));
  // Favorites with none picked used to just show the alphabetical list, which read as a broken
  // tab. Say why, once. (A new key can be missing for one visit after a deploy - js/strings.js is
  // cache-first - and makeT then returns the key itself, so that case shows nothing.)
  const favNote = _gameSort === 'fav' && !rows.some((r) => r.fav) && t('lb_fav_none') !== 'lb_fav_none'
    ? `<p class="lb-note">${esc(t('lb_fav_none'))}</p>` : '';
  const caption = tx('lb_bygame_note', 'The top 3 players in every game. Tap a game to see their scores.');
  return `<div class="lb-ctrls">${sortPillsHTML(GAME_SORTS, _gameSort, 'gsort')}</div>${favNote}<p class="lb-note">${esc(caption)}</p><div class="lb-glist">${cards.join('')}</div>`;
}

// --- You: your records, and the ones you are closest to (2026-10-27) ----------------------------
// Matt: "The You tab is great." Three blocks: the records the viewer holds, every game they have
// played and do not lead (closest to the record first, with what it takes in one plain line), and
// the games they have not played yet with that game's record and a Play button. "You" is allowed on
// THIS tab only (Matt, 2026-10-27); every other screen names people by their profile name.
// Read-only, like the rest of this file: every number is the board's own, read the board's way.
function youHTML(list) {
  const me = list.find((g) => g.key === _meKey);
  if (!me) return emptyState(tx('lb_you_empty', 'Play a game to see your records here.'));
  const held = [];
  const close = [];
  const fresh = [];
  let withRecord = 0;
  for (const meta of gameMetaSorted()) {
    const id = meta.id;
    if (!isGameOnLauncher(id)) continue;
    const st = gameStanding(list, id);
    const rec = st.rows[0] || null;
    if (rec) withRecord++;
    const played = boardPlaysOf(me, id) > 0;
    const rank = st.rankOf[me.key];
    if (rank === 1) held.push({ id, meta });
    else if (played && rec) close.push({ id, meta, rec, rank, tie: st.tiedAt(me.key), c: closeness(me, rec, id) });
    else if (!played && rec) fresh.push({ id, meta, rec });
  }
  close.sort((a, b) => b.c - a.c || t(a.meta.labelKey).localeCompare(t(b.meta.labelKey)));
  let favs = [];
  try { favs = loadFavorites() || []; } catch { favs = []; }
  const star = (id) => (favs.includes(hubIdOf(id)) ? '<i class="lb-star" aria-hidden="true">★</i>' : '');
  const val = (g, id) => {
    const tier = boardTierOf(g, id);
    return `${tierMarkHTML(tier)}<span>${esc(youValText(id, boardMetricOf(g, id)))}</span>`;
  };
  const hold = tx('lb_you_hold', '', { x: `<b>${esc(tx('lb_n_of_m', `${held.length} of ${withRecord}`, { n: held.length, m: withRecord }))}</b>`, m: withRecord });
  const head = `<div class="lb-you-head">${avatarHTML(me)}<span class="lb-you-id"><span class="lb-you-nm">${rankName(me)}</span><span class="lb-you-sub">${hold}</span></span></div>`;
  const heldHTML = held.length
    ? `<h3 class="lb-yh">${esc(tx('lb_you_hold_h', 'Records you hold'))}</h3><div class="lb-ylist">${held.map(({ id, meta }) =>
      `<button type="button" class="lb-yrow" data-ygame="${id}">${topBadgeHTML(1, false)}<span class="lb-yrow-nm">${star(id)}${esc(t(meta.labelKey))}</span><span class="lb-yrow-v">${val(me, id)}</span></button>`).join('')}</div>`
    : '';
  const closeHTML = close.length
    ? `<div class="lb-yh-row"><h3 class="lb-yh">${esc(tx('lb_you_close_h', 'Closest to breaking'))}</h3><span class="lb-yh-k">${esc(tx('lb_you_close_k', 'Closest first'))}</span></div><div class="lb-ylist">${close.map(({ id, meta, rec, rank, tie }) => {
      const gap = gapText(me, rec, id);
      const chip = rank ? `<span class="lb-ychip">${esc(rankWords('lb_you_rank', rank, tie))}</span>` : '';
      return `<button type="button" class="lb-ycard" data-ygame="${id}">
        <span class="lb-ycard-head"><span class="lb-ycard-nm">${star(id)}${esc(t(meta.labelKey))}</span>${chip}</span>
        <span class="lb-ybox">
          <span class="lb-ybox-c is-me"><em>${esc(tx('lb_you_best', 'Your best'))}</em><b>${val(me, id)}</b></span>
          <span class="lb-ybox-c is-rec"><em>${esc(tx('lb_you_record', 'Record'))} · ${avatarHTML(rec)}${rankName(rec)}</em><b>${val(rec, id)}</b></span>
        </span>
        ${gap ? `<span class="lb-ygap">${gap}</span>` : ''}
      </button>`;
    }).join('')}</div>`
    : '';
  const freshHTML = fresh.length
    ? `<h3 class="lb-yh">${esc(tx('lb_you_new_h', 'Not played yet'))}</h3><div class="lb-ylist">${fresh.map(({ id, meta, rec }) =>
      `<div class="lb-ynew"><span class="lb-ynew-id"><span class="lb-ycard-nm">${star(id)}${esc(t(meta.labelKey))}</span>`
      + `<span class="lb-ynew-rec">${tx('lb_you_rec_by', '', { v: esc(youValText(id, boardMetricOf(rec, id))), who: `${avatarHTML(rec)}${rankName(rec)}` })}</span></span>${playBtnHTML(id)}</div>`).join('')}</div>`
    : '';
  return head + heldHTML + closeHTML + freshHTML;
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
  // No fastest-time record on the leaderboard in v1 (deliberate - a TEXTURE `get` ranks
  // higher-is-better everywhere else, and bestTimeMs is lower-is-better; see js/CLAUDE.md's
  // sudoku section, root CLAUDE.md item 7).
  sudoku: [
    { labelKey: 'lb_tex_sd_solved', get: (g) => ((g.games.sudoku || {}).sd || {}).solved | 0 },
    { labelKey: 'lb_tex_sd_perfect', get: (g) => ((g.games.sudoku || {}).sd || {}).perfect | 0 },
  ],
  contexto: [
    { labelKey: 'lb_tex_ct_gold', get: (g) => ctOf(g).noHint | 0 },
    { labelKey: 'lb_tex_ct_silver', get: (g) => ctOf(g).silver | 0 },
    { labelKey: 'lb_tex_ct_bronze', get: (g) => ctOf(g).bronze | 0 },
  ],
  // Arrow Maze (2026-10-13): levels cleared, and how many were timed.
  wayout: [
    { labelKey: 'lb_tex_wo_cleared', get: (g) => ((g.games.wayout || {}).total || {}).won | 0 },
    { labelKey: 'lb_tex_wo_timed', get: (g) => { const tm = (((g.games.wayout || {}).wo || {}).timed) || {}; return WO_TIERS.reduce((n, k) => n + (tm[k] | 0), 0); } },
  ],
  // Gridlock (2026-10-14): distinct levels cleared, and how many of them in the fewest moves.
  gridlock: [
    { labelKey: 'lb_tex_gl_cleared', get: (g) => glCleared(g.games.gridlock) },
    { labelKey: 'lb_tex_gl_three', get: (g) => glThreeStars(g.games.gridlock) },
  ],
  // Word Weaver (2026-10-28): distinct levels completed, and how many with three stars (no hint).
  wordweaver: [
    { labelKey: 'lb_tex_ww_cleared', get: (g) => wwCleared(g.games.wordweaver) },
    { labelKey: 'lb_tex_ww_three', get: (g) => wwThreeStars(g.games.wordweaver) },
  ],
  minesweeper: [
    { labelKey: 'lb_tex_ms_cleared', get: (g) => ((g.games.minesweeper || {}).ms || {}).cleared | 0 },
    { labelKey: 'lb_tex_ms_flags', get: (g) => ((g.games.minesweeper || {}).ms || {}).flagsRight | 0 },
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
  // The bankroll is only anyone's once they have played for money; a player with no ledger shows 0
  // rather than the untouched starting stake, which would put every non-player on the podium.
  holdem: [
    { labelKey: 'lb_tex_hb_bank', get: (g) => (hbTouched(g) ? hbBankOf(g) || 0 : 0), show: (g) => bankText(hbBankOf(g)) },
    { labelKey: 'lb_tex_hb_best', get: (g) => (hbReview(g) ? 0 : ((hbOf(g) || {}).best) | 0), show: (g) => bankText((hbOf(g) || {}).best) },
    // Per-hand stats (2026-09-28, recordHoldemHand). The best hand ranks on its score and prints
    // its NAME ("Four of a Kind"), the way Boggle's longest word does.
    { labelKey: 'lb_tex_hs_won', get: (g) => (((g.games.holdem || {}).hs || {}).won) | 0 },
    { labelKey: 'lb_tex_hs_pot', get: (g) => (((g.games.holdem || {}).hs || {}).bigPot) | 0, show: (g) => bankText(((g.games.holdem || {}).hs || {}).bigPot) },
    {
      labelKey: 'lb_tex_hs_best',
      get: (g) => (((g.games.holdem || {}).hs || {}).best) | 0,
      show: (g) => { const c = ((g.games.holdem || {}).hs || {}).bestCat; return c >= 0 && c <= 9 ? t('lb_hb_cat_' + c) : ''; },
    },
  ],
  brickblitz: [
    { labelKey: 'lb_tex_bz_bricks', get: (g) => (((g.games.brickblitz || {}).bz || {}).bricks) | 0 },
    { labelKey: 'lb_tex_bz_combo', get: (g) => (((g.games.brickblitz || {}).bz || {}).bestCombo) | 0 },
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
  // Skeeball is the one board with a MACHINE filter, so three of its four records carry a second,
  // machine-scoped getter (`machine`) - see recordsHTML. `lb_tex_sk_hundreds` has none because
  // sk.hundreds is a LIFETIME counter with no per-machine breakdown anywhere in the store
  // (js/CLAUDE.md, "Score corrections"): the per-board record keeps `slotHits` keyed by each
  // machine's own hole ids, and turning those into "how many 100s" would mean importing that
  // board's geometry to learn which hole is worth 100. Add the counter to the writer before
  // showing it per machine; never derive it here.
  skeeball: [
    {
      labelKey: 'lb_tex_sk_best_game',
      get: (g) => (((g.games.skeeball || {}).sk || {}).bestGame) | 0,
      machine: (g, mid) => skBoardRec(g, mid).best | 0,
    },
    {
      labelKey: 'lb_tex_sk_best_throw',
      get: (g) => (((g.games.skeeball || {}).sk || {}).bestThrow) | 0,
      machine: (g, mid) => skBoardRec(g, mid).bestThrow | 0,
    },
    { labelKey: 'lb_tex_sk_hundreds', get: (g) => (((g.games.skeeball || {}).sk || {}).hundreds) | 0 },
    {
      labelKey: 'lb_tex_sk_points',
      get: (g) => (((g.games.skeeball || {}).sk || {}).points) | 0,
      machine: (g, mid) => skBoardRec(g, mid).points | 0,
    },
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
 *
 *  They are LIFETIME figures on every board that filters by DIFFICULTY - several of them
 *  (Chinchon closes, Boggle words) have no per-tier storage at all, so a filtered version would
 *  have to be invented.
 *
 *  SKEEBALL IS THE EXCEPTION, because its filter is a MACHINE and its store really does keep
 *  per-machine numbers. Matt, 2026-08-25, looking at the board filtered to BRICKCITY: "none of
 *  these stats on the bottom are specific to brickcity. They're all skeeball combined. That
 *  shouldn't be the case." Every other number on that screen (the games count in the header, each
 *  card's best and plays) already honored the filter, so the records were the one block quietly
 *  answering a different question. Now: a spec that declares a `machine` getter is re-read from
 *  the selected machine's own stored record, and a spec that has none is DROPPED while a machine
 *  is selected rather than printed under a heading that would make it a lie. Nothing is derived,
 *  apportioned or estimated (THE LAW rule 4), and nothing is hidden that this block is the only
 *  home for - the lifetime figure is one tap away under All machines, and My Stats shows it
 *  unfiltered regardless. */
function recordsHTML(list, id) {
  if (id === 'contexto') return ctMedalKeyHTML();
  const all = TEXTURE[id];
  if (!all) return '';
  const byMachine = id === 'skeeball' && _machine && _machine !== 'all';
  const specs = byMachine ? all.filter((s) => s.machine) : all;
  const cells = [];
  specs.forEach((spec) => {
    let best = null;
    for (const g of list) {
      const v = (byMachine ? spec.machine(g, _machine) : spec.get(g)) | 0;
      if (v > 0 && (!best || v > best.v)) best = { v, g };
    }
    if (!best) return;
    // `show` lets a record rank on a number but DISPLAY something else (Boggle's longest word).
    const shown = spec.show ? esc(spec.show(best.g) || String(best.v)) : String(best.v);
    cells.push(`<div class="lb-rec"><b>${shown}</b><span>${esc(t(spec.labelKey))}</span><em>${avatarHTML(best.g)}${rankName(best.g)}</em></div>`);
  });
  if (!cells.length) return '';
  if (cells.length % 2) cells[cells.length - 1] = cells[cells.length - 1].replace('class="lb-rec"', 'class="lb-rec is-wide"');
  // The heading names the machine when one is selected: this block sits at the bottom of a long
  // scroll, well below the filter button that set it.
  const heading = byMachine ? t('lb_records_h_machine', { name: skMachineMeta(_machine).name }) : t('lb_records_h');
  return `<h3 class="lb-h3">${esc(heading)}</h3><div class="lb-recs">${cells.join('')}</div>`;
}

/** Contexto's bottom block is the MEDAL KEY, not standing records (Matt, 2026-10-29: "Why would there
 *  be a record for most silver or bronze medals? That space should be used to define what each medal
 *  is"); ONE line since 2026-10-30 (Matt: "Don't use a ton of space"). Its TEXTURE specs are kept but
 *  no longer shown. */
function ctMedalKeyHTML() {
  const item = (kind, key, en) => `<span class="lb-ctkey-i">${ctMedalHTML(kind, null, 24)}<span>${esc(tx(key, en))}</span></span>`;
  return `<div class="lb-ctkey">`
    + item('gold', 'lb_ct_key_gold', '0 hints')
    + item('silver', 'lb_ct_key_silver', '1 hint')
    + item('bronze', 'lb_ct_key_bronze', '2 hints')
    + item('iron', 'lb_ct_key_none', '3+ hints')
    + '</div>';
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
function ttCardHTML(g, chip, bSort) {
  // The `tt` sub-counter has NO per-tier storage (see the note above ttVariantWins), so unlike
  // every other board these two numbers cannot be read at one tier. The chip still names the tier
  // the ROW ranks at, so the order is legible; the numbers stay the honest all-tier split.
  const rowTier = boardTierOf(g, 'tictactoe');
  const tt = (g.games.tictactoe && g.games.tictactoe.tt) || null;
  const hasTt = !!(tt && (tt.classic || tt.ultimate));
  const ultimate = hasTt ? ttVariantWins(tt.ultimate) : 0;
  const classic = hasTt ? ttVariantWins(tt.classic) : 0;
  // Legacy/pre-split history (or a device that only ever synced totals) carries no `tt` object -
  // nobody may fall off the board (rule 1), so it leads with the generic wins number instead.
  // THE HEADLINE IS WHAT YOU SORTED BY (2026-09-11). Under "Games" the generic card above leads
  // with the play count and demotes the score to the subline; this card and Snake's took no sort
  // at all, so they went on leading with the score. Matt, on the Snake board sorted by Games:
  // rank 1 printed 39 and rank 3 printed 43, with the 307 plays that actually set that order in
  // small grey type. Nothing is hidden either way (rule 1) - the split moves to the subline.
  if (bSort === 'played') {
    const split = hasTt
      ? `${ultimate} ${t('lb_tt_ultimate')} \u00b7 ${classic} ${t('lb_tt_classic')}`
      : `${winsAtTier(g, ['tictactoe'], null)} ${t('lb_wins_unit')}`;
    return playerCardHTML(g, chip,
      { val: boardPlaysOf(g, 'tictactoe'), unit: unitWord('lb_played_count') },
      split, '', '', tierChipHTML(rowTier));
  }
  // ONE ROW SKELETON FOR EVERY BOARD (2026-10-11 review): rank, avatar, name, subline, one big
  // number. This card used to be a second layout of its own (two big numbers under the name, a
  // 114px card); the Ultimate count leads because the board orders by it, and Classic rides the
  // subline beside the plays. Nothing left the card (rule 1).
  const played = t('lb_played_count', { n: boardPlaysOf(g, 'tictactoe') });
  if (!hasTt) {
    return playerCardHTML(g, chip, { val: winsAtTier(g, ['tictactoe'], null), unit: t('lb_wins_unit') },
      played, '', '', tierChipHTML(rowTier));
  }
  return playerCardHTML(g, chip, { val: ultimate, unit: t('lb_tt_ultimate') },
    `${played} \u00b7 ${classic} ${t('lb_tt_classic')}`, '', '', tierChipHTML(rowTier));
}

// Snake's walls-mode split (2026-07-28). Unlike TT's variants, Snake's bests ARE per-tier storage,
// so this one respects the board's own difficulty filter (`_tier`), unlike ttCardHTML. Since the
// 2026-10-11 review both cards use the standard one-number row; the split lives on the subline.
function snCardHTML(g, chip, bSort) {
  // At the tier this row is RANKED at (2026-09-08), not the all-tier best: this card is the one
  // Matt caught printing a 51 set on Easy beside a Hard ranking.
  const rowTier = boardTierOf(g, 'snake');
  const off = snBestAtWalls(g, rowTier, 'off');
  const on = snBestAtWalls(g, rowTier, 'on');
  // THE HEADLINE IS WHAT YOU SORTED BY - see the same block in ttCardHTML above; this is the
  // card Matt was looking at when he said the board made no sense.
  if (bSort === 'played') {
    return playerCardHTML(g, chip,
      { val: boardPlaysOf(g, 'snake'), unit: unitWord('lb_played_count') },
      `${off} ${t('lb_sn_walls_off')} \u00b7 ${on} ${t('lb_sn_walls_on')}`,
      '', '', tierChipHTML(rowTier));
  }
  // Same one-row skeleton as every board (see ttCardHTML): the best at the row's tier leads, the
  // walls split rides the subline.
  return playerCardHTML(g, chip, { val: metricText(boardMetricOf(g, 'snake'), 'snake'), unit: unitTextOf('snake', boardMetricOf(g, 'snake')) },
    `${t('lb_played_count', { n: boardPlaysOf(g, 'snake') })} \u00b7 ${off} ${t('lb_sn_walls_off')} \u00b7 ${on} ${t('lb_sn_walls_on')}`,
    '', '', tierChipHTML(rowTier));
}

/** D8's three orders for a game board. 'alpha'/'played' are generic (name/plays, then this
 *  game's own metric as a tie-break, then recency) and apply to EVERY game including Tic Tac Toe
 *  and Snake. 'wins' (= "this game's own metric") is left EXACTLY as it was before this redesign -
 *  Tic Tac Toe's ultimate -> classic -> recency order, every other game's metric -> plays -> recency. */
function sortRows(rows, id, sort) {
  const metric = boardMetricCmp(id);
  const recent = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  if (sort === 'alpha') {
    rows.sort((a, b) => (a.name || '').localeCompare(b.name || '') || metric(a, b) || recent(a, b));
    return;
  }
  if (sort === 'played') {
    // GAMES PLAYED IS A VOLUME ORDER AND KNOWS NOTHING ABOUT DIFFICULTY (2026-09-08, Matt). Plays
    // first, and a tie is settled by the plain all-tier number, never by a tier.
    rows.sort((a, b) => (boardPlaysOf(b, id) - boardPlaysOf(a, id))
      || comparePlainMetric(a, b, id) || recent(a, b));
    return;
  }
  if (sort === 'high') {
    rows.sort((a, b) => (skBestAt(b, _machine) - skBestAt(a, _machine)) || metric(a, b) || recent(a, b));
    return;
  }
  if (sort === 'fewest') {
    rows.sort((a, b) => cmpCpFewest(a, b) || (cpSoloRacks(b) - cpSoloRacks(a)) || recent(a, b));
    return;
  }
  if (sort === 'hwins') {
    rows.sort((a, b) => (winsAtTier(b, ['holdem'], null) - winsAtTier(a, ['holdem'], null)) || metric(a, b) || recent(a, b));
    return;
  }
  // The game's own metric: difficulty first (that is the half Matt does want tiered), then this
  // board's own score order - Tic Tac Toe's Ultimate -> Classic, everyone else's single number.
  // Fewer plays breaks a dead-equal pair, as it always did, and the badges call that pair tied.
  rows.sort((a, b) => metric(a, b) || (boardPlaysOf(a, id) - boardPlaysOf(b, id)) || recent(a, b));
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

/** Cup Pong's fewest throws to clear a solo rack, or null when this person never has. NULL, never
 *  the stored 0 sentinel - the msBestAt care: a 0 would rank "never cleared" first. */
function cpSoloBest(g) {
  const cp = (g.games.cuppong || {}).cp;
  const v = cp ? cp.soloBest | 0 : 0;
  return v > 0 ? v : null;
}
function cpSoloRacks(g) { return (((g.games.cuppong || {}).cp || {}).soloRacks) | 0; }
/** Fewer throws first. This is the RANK order, so two equal bests share a badge; sortRows then
 *  draws the one with more racks cleared first. */
function cmpCpFewest(a, b) { return cpSoloBest(a) - cpSoloBest(b); }

/** Every back control on these screens: the same chevron, the same 44px target. `label` is
 *  already-escaped markup (some strings carry an arrow entity, dropped here so the chevron is
 *  the only arrow). `iconOnly` keeps the label for screen readers only. */
function backBtnHTML(role, label, iconOnly) {
  const text = String(label).replace(/^&larr;\s*/, '');
  return `<button type="button" class="lb-back${iconOnly ? ' is-icon' : ''}" data-role="${role}"${iconOnly ? ` aria-label="${text}"` : ''}>`
    + '<svg class="lb-back-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>'
    + `${iconOnly ? '' : `<span>${text}</span>`}</button>`;
}

/** PLAY FROM A GAME'S BOARD (Matt, 2026-10-20: "I should be able to click Play from there").
 *  Only when the launcher handed us `onPlay` and this game is on that launcher; a game's own
 *  Leaderboard button opens over the running game and passes neither, so no button there. */
function playBtnHTML(id) {
  const hub = hubIdOf(id);
  if (typeof _onPlay !== 'function' || !_canPlay(hub)) return '';
  return `<button type="button" class="lb-play" data-role="lb-play" data-hub="${esc(hub)}">${esc(tx('lb_play', 'Play'))}</button>`;
}

function gameDetail(list, id) {
  const fieldTiers = id === 'skeeball' || id === 'holdem' ? [] : fieldTiersPresent(list, [id]);
  const machineIds = id === 'skeeball' ? skMachinesPresent(list) : [];
  const woRush = id === 'wayout' && _woMode === 'rush';
  const totalPlays = woRush ? list.reduce((a, g) => a + woRunsOf(g, _woRush), 0)
    : id === 'contexto' && _view === 'daily' ? list.reduce((a, g) => a + (ctDailyOf(g).played | 0), 0)
    : list.reduce((a, g) => a + boardPlaysOf(g, id), 0);
  // Screen 3's header: the way back, the game's name at full size, and how much this game has
  // been played by everyone, which is the one number that says whether the board means anything.
  // One row (2026-10-11 spacing pass): the back chevron sits beside the title instead of on a row
  // of its own, which was 44px of a phone screen spent before the first player.
  const head = `<div class="lb-board-head">
    ${backBtnHTML('lb-back', esc(t('lb_by_game')), true)}
    <div class="lb-board-id">
      <h3 class="lb-board-h">${esc(labelOf(id))}</h3>
      <span class="lb-board-n"><b>${totalPlays}</b><span>${esc(woRush ? tx('lb_wo_runs_unit', 'runs') : t('lb_games_unit'))}</span></span>
    </div>
    ${playBtnHTML(id)}
  </div>`;
  if (id === 'minesweeper') return head + msBoardHTML(list);
  if (id === 'spellingbee' && beeBoard()) return head + beeTabsHTML() + plainBoardHTML(list, id) + recordsHTML(list, id);
  if (id === 'wayout') return head + woModesHTML() + (woRush ? woRushHTML(list) : plainBoardHTML(list, id) + recordsHTML(list, id));
  return head + plainBoardHTML(list, id) + recordsHTML(list, id);
  const controls = boardControlsHTML(id, fieldTiers, machineIds);
  const showMp = anyMpPlays(list, id);
  const bSort0 = effectiveSort(id);
  // The solo board lists exactly the people with a cleared solo rack; every other sort lists the
  // people with a match, as before. Nobody's record is hidden: each sort is one pill away.
  const rows = bSort0 === 'fewest'
    ? list.filter((g) => cpSoloBest(g) !== null)
    : list.filter((g) => boardPlaysOf(g, id) > 0);
  // Same rule as By Player above: the badge follows the sort when the sort is a measure. This
  // board scrambled identically under "Games Played" - the badge stayed on the game's own metric.
  // The badge follows the sort whenever the sort is a MEASURE (By Player above has the same rule):
  // ranking by lifetime points and then numbering the rows by best rack reads as a broken board.
  const bSort = effectiveSort(id);
  const byMetric = bSort !== 'played' && bSort !== 'high' && bSort !== 'hwins';
  // Cup Pong's solo board is its own order (fewest first), so it takes its own comparator.
  const { rankOf, tiedAt } = bSort === 'fewest' ? rankMap(rows, cpSoloBest, cmpCpFewest) : rankMap(rows, bSort === 'played'
    ? (g) => boardPlaysOf(g, id)
    : bSort === 'high'
      ? (g) => skBestAt(g, _machine)
      : bSort === 'hwins'
        ? (g) => winsAtTier(g, ['holdem'], null)
        : (g) => boardMetricOf(g, id),
    byMetric ? boardMetricCmp(id) : null);
  sortRows(rows, id, bSort);
  const cardsHtml = rows.length
    ? `<div class="lb-plist is-board">${rows.map((g) => {
        const chip = rankChipHTML(rankOf[g.key], tiedAt(g.key));
        if (id === 'tictactoe') return ttCardHTML(g, chip, bSort);
        if (id === 'snake') return snCardHTML(g, chip, bSort);
        // The row's OWN tier, and the score at it - never the all-tier number, which is how a
        // Hard-ranked player printed an Easy 51 on the live board.
        const rowTier = boardTierOf(g, id);
        const metric = boardMetricOf(g, id);
        const played = boardPlaysOf(g, id);
        // The tile for the tier this row ranks at is marked, so the headline is visibly one of
        // the tiles rather than a number from nowhere. Every other tier is still printed beside
        // it - nothing about a player's record leaves this card (THE LAW rule 1).
        const tiles = (METRIC_IS_TIER_BLIND.has(id) ? ''
          // Printed through formatBoardMetric like the headline, or a time board's tiles show raw
          // milliseconds (Minesweeper read "248338" beside a headline of "4:08", 2026-10-11).
          : miniTilesHTML(fieldTiers, (tier) => (playsAtTier(g, [id], tier) > 0
            ? formatBoardMetric(gameMetricAt(g, id, tier), id, t('lb_golf_even')) : null), rowTier))
          + (showMp ? mpTileHTML(g, id) : '');
        const metricUnit = unitTextOf(id, metric);
        // A Hold'em ledger no real play could produce says so instead of printing a number.
        const metricStr = id === 'holdem' && hbReview(g) ? t('lb_hb_review') : metricText(metric, id);
        // THE HEADLINE IS WHAT YOU SORTED BY, the rule this file already keeps for By Player and
        // for Games Played. Skeeball's 'high' sort leads with the best single rack and keeps the
        // lifetime total on the subline, so the two are never confusable and neither is hidden.
        let big;
        let subText;
        if (bSort === 'fewest') {
          // A solo rack has no difficulty, so no tier chip and no tier tiles on this sort.
          return playerCardHTML(g, chip, { val: cpSoloBest(g), unit: t('lb_unit_fewest') },
            `${cpSoloRacks(g)} ${t('lb_unit_cleared')}`, '', '', '');
        }
        if (bSort === 'played') {
          big = { val: played, unit: unitWord('lb_played_count') };
          subText = `${metricStr} ${metricUnit}`;
        } else if (bSort === 'high') {
          big = { val: skBestAt(g, _machine), unit: t('lb_unit_high') };
          subText = `${metricStr} ${metricUnit}`;
        } else if (bSort === 'hwins') {
          big = { val: winsAtTier(g, ['holdem'], null), unit: t('lb_unit_wins') };
          subText = `${metricStr} ${metricUnit}`;
        } else if (id === 'holdem') {
          big = { val: esc(metricStr), unit: metricUnit };
          subText = t('lb_played_count', { n: played });
        } else {
          big = { val: metricStr, unit: metricUnit };
          subText = t('lb_played_count', { n: played });
          // Contexto: every medal the player holds, and the average guesses that breaks a tie,
          // so the order on the board can be read straight off the rows (2026-09-29).
          if (id === 'contexto') {
            const ct = ctOf(g);
            const parts = [['gold', ct.noHint], ['silver', ct.silver], ['bronze', ct.bronze]]
              .filter(([, n]) => (n | 0) > 0).map(([m, n]) => `${CT_MEDAL_GLYPH[m]}${n | 0}`);
            const avg = ctAvgGuesses(ct);
            if (parts.length) subText += ` \u00b7 ${parts.join(' ')}`;
            if (Number.isFinite(avg)) subText += ` \u00b7 ${t('lb_ct_avg', { n: Math.round(avg * 10) / 10 })}`;
          }
        }
        return playerCardHTML(g, chip, big, subText, tiles, '', tierChipHTML(rowTier));
      }).join('')}</div>`
    : emptyState(t('lb_empty_game', { label: labelOf(id) }));
  // ONE LINE THAT SAYS HOW THE BOARD IS ORDERED (2026-10-11 review). A blind reviewer read a
  // Hard 6 above an Easy 110 as a bug: the difficulty-first rule was nowhere on screen. Only the
  // parts that apply are said: the tier rule when this board actually ranks by tier, golf's
  // lower-is-better, and what a "T" on a badge means when one is showing.
  const notes = [];
  if (byMetric && _tier == null && rows.some((g) => boardTierOf(g, id) != null)) notes.push(tx('lb_note_tier', 'Ranked by hardest difficulty first, then score.'));
  if (byMetric && LOWER_IS_BETTER.has(id)) notes.push(tx('lb_note_low', 'Lowest score wins.'));
  if (rows.some((g) => tiedAt(g.key))) notes.push(tx('lb_note_tie', 'T = tied.'));
  const note = notes.length ? `<p class="lb-note">${esc(notes.join(' '))}</p>` : '';
  return head + controls + note + cardsHtml + recordsHTML(list, id);
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
  if (!g) return `<div class="lb-detail-top">${backBtnHTML('lb-player-back', backLabel)}</div>` + emptyState(t('lb_empty_all'));
  // THE DRILL-IN SAYS WHOSE PAGE IT IS AND WHICH GAME (2026-09-02). It used to be a bare
  // "< Games" link above a wall of numbers: the overlay's own title says "Leaderboard", the
  // player's name was two screens back, and the game's name appeared nowhere at all. Matt, on a
  // screenshot of exactly this screen: "It's not clear what you're looking at unless you really
  // look... I created both and I can't even tell from a distance." One compact strip - avatar,
  // name, game - fixes that for every game's screen at once, since they all render through here.
  if (_playerGame) {
    return `<div class="lb-detail-top">
      ${backBtnHTML('lb-pgame-back', _game ? t('lb_back_game', { title: labelOf(_game) }) : t('lb_back_games'))}
    </div>
    <div class="lb-ctx">
      ${avatarHTML(g)}
      <span class="lb-ctx-id">
        <span class="lb-ctx-name">${rankName(g)}${youBadge(g)}</span>
        <span class="lb-ctx-game">${esc(labelOf(_playerGame))}</span>
      </span>
    </div>` + screenFor(_playerGame, { games: g.games, code: g.playerId });
  }
  // No sort control on this screen, so the header always leads with wins (D1's default) - the
  // meta line becomes a single "N played" (playedOf, all games incl. runs), replacing the old
  // "N games · N runs" metaLine() (see that function's own comment for why it's kept, unused).
  const wins = winsOf(g, null);
  const played = playedOf(g, null);
  // The same six-cell strip By Player shows, so a person's whole mix reads identically on both
  // screens - and every play they have made is on it, not just the four tiered ones.
  const head = `<div class="lb-detail-top">
    ${backBtnHTML('lb-player-back', backLabel)}
  </div>
  <div class="lb-pdetail-head">
    ${avatarHTML(g)}
    <span class="lb-pdetail-id">
      <span class="lb-pdetail-name">${rankName(g)}${youBadge(g)}</span>
      <span class="lb-pdetail-meta">${t('lb_played_count', { n: played })}</span>
    </span>
    <span class="lb-pnum"><b>${wins}</b><span>${t('lb_wins_unit')}</span></span>
    ${sendMsgHTML(g)}
  </div>
  ${catGridHTML(g)}`;
  return head + messageHTML(g) + `<h4 class="lb-h4">${esc(t('lb_pd_games_h'))}</h4>` + gsGameListHTML(g.games, { order: 'plays' });
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
  // THE SERVER-BUILT BOARD (2026-10-22): when functions/boards.js has published one, the people
  // come already grouped and corrected (the same aggregatePlayers, run once on the server), and
  // this phone never downloads players/. Otherwise the old way below.
  if (_board) {
    const list = _board.list.filter((g) => !isHiddenRow(g));
    const sid = statsId(), code = String((loadProfile() || {}).playerId || '').toUpperCase();
    const mine = _board.list.find((g) => (_board.idsByKey.get(g.key) || []).includes(sid))
      || (code ? _board.list.find((g) => g.playerId === code) : null);
    _meKey = mine ? mine.key : '';
    return bodyFor(list);
  }
  const recs = visibleRecords();
  // Every real player with any recorded play is listed. Test accounts and nameless devices are not
  // - see isHiddenRow() above for both rules and why the nameless one is safe now.
  // Admin score corrections (js/stats-corrections.js) are applied inside the aggregation, per
  // device record. The board is the one screen where a score thrown on a broken machine does the
  // most damage, so it reads them like every other surface.
  const list = aggregatePlayers(recs, corrections()).filter((g) => !isHiddenRow(g));
  try { _meKey = buildIdentity(recs).keyFor(loadProfile() || {}, statsId()); } catch { /* keep */ }
  return bodyFor(list);
}

function bodyFor(list) {
  if (_player) return playerDetail(list, _player);
  // A board for a game this person cannot see is not rendered: `_game` is only ever set by tapping
  // a row that the filter above already allowed, but a stale value must not become a way in.
  if (_game && !isGameOnLauncher(_game)) _game = null;
  if (_game) return gameDetail(list, _game);
  // Each list owns its own control row now (By Game's is three sort pills and no filter), so the
  // shell no longer emits one on their behalf.
  if (_seg === 'you') return youHTML(list);
  return _seg === 'games' ? gameListHTML(list) : catControlsHTML(list) + legendHTML() + playerListHTML(list);
}

let _host = null;
let _seg = 'players';       // 'players' | 'games' | 'you' - remembered (persistView)
let _game = null;           // non-null => showing that game's detail board
let _onPlay = null;         // openLeaderboard({onPlay}): the launcher's own way to open a game (hub id)
let _canPlay = () => false; // openLeaderboard({canPlay}): is that hub id on this launcher
let _entryGame = null;      // the board openLeaderboard({game}) opened on: backing out of it closes
let _player = null;         // non-null (a group key) => showing that player's detail screen
let _playerGame = null;     // non-null => drilled into that game from WITHIN player detail
let _cat = 'all';           // 'all' | 1-4 | 'NT' | 'VS' - By Player's category filter (opens on the saved default)
let _tier = null;           // null (All) | 1-4 - a GAME BOARD's own difficulty filter, reset per board
let _view = '';            // a game board's non-difficulty tab ('mp', 'solo', 'high', 'ultimate', 'off'...), reset with _tier
let _machine = 'all';       // 'all' | a Skeeball machine id - that board's filter, deliberately not persisted
let _woMode = 'levels';     // Arrow Maze's board: 'levels' | 'rush' (2026-10-16), per visit
let _woRush = 'easy';       // which Rush version (RUSH_MODES), per visit
let _sort = 'wins';         // 'alpha' | 'played' | 'wins' (or a game's own metric on a game board) - persisted, see loadView/saveView
let _gameSort = 'alpha';    // 'alpha' | 'popular' | 'fav' - By Game's own order, remembered (persistView)
let _boardSort = 'wins';    // a game board's own sort, reset to that board's leftmost pill on every entry
let _panel = null;          // null | 'cat' | 'machine' - which in-place select panel is open
let _all = {};
let _board = null;          // the server-built board ({ list, idsByKey }, stats-net.js watchBoard), when there is one
let _meKey = '';
let _unsub = null;
let _connected = false;
let _onLine = null;   // 'online' listener, removed in closeLeaderboard (listeners must balance)

const SEGMENTS = [{ id: 'players', labelKey: 'lb_by_player' }, { id: 'games', labelKey: 'lb_by_game' }, { id: 'you', labelKey: 'lb_you_tab' }];

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

function renderMessage(key) {
  const bodyEl = _host && _host.querySelector('[data-role="lb-body"]');
  if (bodyEl) bodyEl.innerHTML = `<p class="lb-none">${t(key)}</p>`;
}

function renderOffline() {
  const bodyEl = _host && _host.querySelector('[data-role="lb-body"]');
  if (bodyEl) bodyEl.innerHTML = `<p class="lb-none">${t('lb_offline')}</p>`;
}

/** Up one level: an open select panel first, then a player's game, then a player, then a game.
 *  Returns false at the top, where the only step left is closing. Esc and the phone's own Back
 *  button both go through this, so they can never disagree about where "back" is. */
function stepBack() {
  if (_panel) { _panel = null; rerender(); return true; }
  if (_playerGame) { _playerGame = null; rerender(); return true; }
  if (_player) { _player = null; rerender(); return true; }
  if (_game && _game === _entryGame) return false;   // came in from that game: back = close
  if (_game) { _game = null; _tier = null; _view = ''; _machine = 'all'; rerender(); return true; }
  return false;
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (!stepBack()) closeLeaderboard();
}

// THE PHONE'S BACK BUTTON (2026-10-11 review). The hub has no routes, so Back used to leave the
// app from inside the leaderboard (a blank page in a test browser) instead of going up a screen.
// Opening pushes ONE history entry; each Back consumes it, steps up a level and pushes it again,
// until the top level, where Back closes the overlay. Closing any other way (the X, Esc, the
// scrim) pops that entry itself so it never lingers behind the launcher. The URL never changes.
let _histArmed = false;
function armHistory() {
  try { history.pushState({ gamehubOverlay: 'leaderboard' }, ''); _histArmed = true; } catch { _histArmed = false; }
}
function onPop() {
  if (!_host) return;
  _histArmed = false;
  if (stepBack()) armHistory();
  else closeLeaderboard();
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
    if (pill.dataset.gsort) { _gameSort = pill.dataset.gsort; persistView(); }
    // On a board this is that board's own sort and nothing else: it is not persisted, and it does
    // not touch the By Player preference the saved default view owns.
    else if (_game) { _boardSort = pill.dataset.sort; }
    else { _sort = pill.dataset.sort; saveSort(_sort); persistView(); }
    rerender();
    return;
  }
  const msTab = e.target.closest('[data-mstier]');
  if (msTab) { _tier = msTab.dataset.mstier === '' ? null : Number(msTab.dataset.mstier); _view = ''; rerender(); return; }
  const viewTab = e.target.closest('[data-lbview]');
  if (viewTab) { _tier = null; _view = viewTab.dataset.lbview; rerender(); return; }
  const machTab = e.target.closest('[data-lbmachine]');
  if (machTab) { _machine = machTab.dataset.lbmachine; rerender(); return; }
  const woModeTab = e.target.closest('[data-lbwomode]');
  if (woModeTab) { _woMode = woModeTab.dataset.lbwomode === 'rush' ? 'rush' : 'levels'; _tier = null; _view = ''; rerender(); return; }
  const beeBy = e.target.closest('[data-lbbeeby]');
  if (beeBy) { _beeBy = beeBy.dataset.lbbeeby === 'words' ? 'words' : 'points'; rerender(); return; }
  const beeLang = e.target.closest('[data-lbbeelang]');
  if (beeLang) { _beeLang = ['en', 'es'].includes(beeLang.dataset.lbbeelang) ? beeLang.dataset.lbbeelang : 'all'; rerender(); return; }
  const woRushTab = e.target.closest('[data-lbworush]');
  if (woRushTab) { if (RUSH_MODES.includes(woRushTab.dataset.lbworush)) _woRush = woRushTab.dataset.lbworush; rerender(); return; }
  const opt = e.target.closest('.lb-opt');
  if (opt) {
    if (opt.dataset.cat !== undefined) { _cat = catFromStored(opt.dataset.cat); persistView(); }
    else if (opt.dataset.tier !== undefined) _tier = opt.dataset.tier === '' ? null : Number(opt.dataset.tier);
    else if (opt.dataset.machine !== undefined) _machine = opt.dataset.machine;
    _panel = null;
    rerender();
    return;
  }
  // Messages is imported LAZILY, only when somebody actually taps this - the leaderboard opens on
  // every device and must not pull that module's chain just to render a button.
  const msg = e.target.closest('[data-role="lb-msg"]');
  if (msg) {
    const to = _msgTo[Number(msg.dataset.mi)];
    if (!to) return;
    const { code, name, emoji } = to;
    import('./messages-ui.js')
      .then((m) => m.openMessages({ to: code, toName: name, toEmoji: emoji }))
      .catch((err) => console.error('[leaderboard] messages failed to load', err));
    return;
  }
  if (e.target.closest('[data-role="lb-close"]')) { closeLeaderboard(); return; }
  // ... AND BACK OUT THE WAY YOU CAME IN. Having skipped the every-game list on the way in, backing
  // out onto it would drop the viewer somewhere they never chose - so from a game's board this
  // returns to that board. From By Player (no `_game`) it still steps back to the player's list.
  if (e.target.closest('[data-role="lb-pgame-back"]')) {
    if (_game) { _player = null; _playerGame = null; } else { _playerGame = null; }
    rerender(); return;
  }
  const play = e.target.closest('[data-role="lb-play"]');
  if (play) { const fn = _onPlay, hub = play.dataset.hub; closeLeaderboard(); if (fn) fn(hub); return; }
  if (e.target.closest('[data-role="lb-player-back"]')) { _player = null; _playerGame = null; rerender(); return; }
  // Leaving a board drops that board's own filters: they belong to the visit, not to the overlay.
  if (e.target.closest('[data-role="lb-back"]')) {
    if (_game && _game === _entryGame) { closeLeaderboard(); return; }
    _game = null; _tier = null; _view = ''; _machine = 'all'; rerender(); return;
  }
  const seg = e.target.closest('.lb-seg');
  if (seg && seg.dataset.seg) {
    const next = seg.dataset.seg;
    if (next === _seg && !_game && !_player) return;
    _seg = next; persistView(); _game = null; _player = null; _playerGame = null; _tier = null; _view = ''; _machine = 'all'; rerender();
    return;
  }
  const card = e.target.closest('.lb-pcard[data-pi]');
  // A NAME TAPPED ON A GAME'S BOARD OPENS THAT GAME (2026-09-02). Matt: "I'm viewing skeeball only
  // stats, I click on a name, it shows me everything, I have to scroll to skeeball and click again.
  // That middle step shouldn't be there." Drilling in from a game's board carried `_game` the whole
  // way and then ignored it, landing on the player's every-game list - a screen the viewer had
  // already answered the question of by choosing a board. From By Player there is no game in hand,
  // so that path is unchanged and still opens the list.
  if (card) { const pk = _pkeys[Number(card.dataset.pi)]; if (pk == null) return; _player = pk; _playerGame = _game || null; rerender(); return; }
  // Player detail's own game list (shared gs-grow rows) vs. the top-level By Game list (lb-grow) -
  // only one of the two is ever on screen at once, but check player context first to be explicit.
  const gsRow = e.target.closest('.gs-grow[data-game]');
  if (gsRow && _player) { _playerGame = gsRow.dataset.game; rerender(); return; }
  const row = e.target.closest('.lb-grow, .lb-gcard, [data-ygame]');
  if (row && (row.dataset.game || row.dataset.ygame)) {
    _game = row.dataset.game || row.dataset.ygame;
    // Always the game's own number - Longest, Points, Wins, whatever that board calls it. See
    // effectiveSort for why this is read off the pill list rather than hardcoded.
    _boardSort = sortItemsFor(_game)[0].sort;
    _tier = null; _view = ''; _machine = 'all'; rerender();
  }
}

export function closeLeaderboard() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
  if (_host) { _host.remove(); _host = null; }
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('popstate', onPop);
  if (_histArmed) { _histArmed = false; try { history.back(); } catch { /* ignore */ } }
  if (_onLine) { window.removeEventListener('online', _onLine); _onLine = null; }
  if (_beeOff) { _beeOff(); _beeOff = null; }
  _connected = false;
  _board = null;
}

/** `opts.game` (a stats id, 2026-10-15): open straight onto that game's board, the way a game's own
 *  Leaderboard button does (Matt: Minesweeper's "My stats" "should be a leaderboard button instead
 *  and show you everyone who's played"). The board's back chevron, Esc and the phone's Back then
 *  return to the GAME, not to the every-game list it never passed through. */
export async function openLeaderboard(opts = {}) {
  // LEADERBOARD V2, ADMIN PREVIEW (2026-10-31): THE ONE GATE. On an admin device the new screen
  // (js/leaderboard2-ui.js) opens instead, so Matt reviews it with real data; every other device
  // takes the path below, unchanged. `legacy: true` is its "Old" link back here. Arrow Maze's Rush
  // board exists only here, so a Rush button keeps opening it.
  if (!(opts && opts.legacy) && !(opts && opts.woMode === 'rush') && isAdminDevice()) {
    try { const m = await import('./leaderboard2-ui.js'); m.openLeaderboard2(opts || {}); return; }
    catch (err) { console.error('[leaderboard] v2 failed to load; opening the old one', err); }
  }
  ensureCss();
  ensureStatsCss();   // the player detail screen reuses My Stats' gs-* renderers/markup verbatim
  closeLeaderboard();
  // THE LEADERBOARD OPENS WHERE IT WAS LEFT (2026-10-27, Matt, reversing his 2026-09-11 "always By
  // Game, Most played"): Ana could not tell why the games were in that order. Tab, both sorts and the
  // category are remembered as they change (persistView); nothing saved yet = By Game, A to Z.
  const view = loadView();
  _seg = view.seg;
  _gameSort = view.gameSort;
  _game = null;
  _entryGame = null;
  _onPlay = opts && typeof opts.onPlay === 'function' ? opts.onPlay : null;
  _canPlay = opts && typeof opts.canPlay === 'function' ? opts.canPlay : () => false;
  _player = null;
  _playerGame = null;
  // A board's own sort and filters are per-visit and start clean.
  _sort = view.sort;
  _cat = view.cat;
  _tier = null;
  _view = '';
  _machine = 'all';
  _panel = null;
  // Arrow Maze's own Leaderboard buttons open on the tab they were pressed from (Levels or a Rush version).
  _woMode = opts && opts.woMode === 'rush' ? 'rush' : 'levels';
  _woRush = opts && RUSH_MODES.includes(opts.woRush) ? opts.woRush : 'easy';
  if (opts && typeof opts.game === 'string' && isGameOnLauncher(opts.game)) {
    _game = _entryGame = opts.game;
    _boardSort = sortItemsFor(_game)[0].sort;
  }
  _all = {};
  _board = null;
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
  window.addEventListener('popstate', onPop);
  armHistory();
  requestAnimationFrame(() => host.classList.add('is-in'));

  // ARM THE FALLBACK BEFORE AWAITING ANYTHING (2026-09-01, second pass).
  //
  // THE BUG THIS FIXES, and it was mine from earlier the same day. All of this used to sit AFTER
  // `await watchPlayers(...)`. That await can hang for ever rather than reject - getting the first
  // value costs three serial cross-origin module imports from gstatic, and an import that stalls
  // neither resolves nor throws - so on a device where the SDK load stalls, the timer was never
  // armed, the `online` listener was never added, and the catch never ran because nothing threw.
  // The loading skeleton then sat there permanently: a screen with height, no text and no
  // controls. Measured: at t+20s, no message, no rows, no JS error. That is what "the leaderboard
  // is blank" looks like from the outside.
  //
  // Nothing below depends on the subscription, so it belongs before it. Now the board always ends
  // up saying something, whatever Firebase does.
  //
  // DO NOT TELL A PLAYER THEY ARE OFFLINE WHEN THEY ARE NOT (2026-09-01).
    //
    // Matt: "you broke the leaderboard too. it says 'The leaderboard needs a connection...' But I
    // am online and have a strong wifi connection. That I confirmed is working properly."
    //
    // This used to hard-swap to that message 3.5s after opening, on the assumption that a
    // watchPlayers which had not fired by then meant Firebase was unconfigured. It is not a safe
    // assumption: getting the first value costs THREE serial cross-origin module imports from
    // gstatic plus an anonymous sign-in round trip, and on a phone - especially one whose service
    // worker is warming a fresh deploy in the background - that can comfortably exceed 3.5s. The
    // board then accused a perfectly good wifi connection of being down, which is worse than
    // saying nothing: it sends the player to go and check their router.
    //
    // Now the message is only ever shown when the browser itself says the device is offline.
    // Otherwise the loading skeleton stays up, the subscription stays live, and the board fills in
    // whenever the answer lands - plus an honest "still loading" note once the wait is long enough
    // to need explaining.
  const GRACE_MS = 3500;         // long enough that a normal load never shows anything extra
  const SLOW_MS = 12000;         // ...and past this, say so rather than leaving a dead skeleton
  const openedAt = Date.now();
  const tick = () => {
    if (!_host || _connected) return;                       // gone, or the data arrived
    if (navigator.onLine === false) { renderOffline(); return; }
    const waited = Date.now() - openedAt;
    if (waited >= SLOW_MS) { renderMessage('lb_slow'); return; }
    setTimeout(tick, 500);
  };
  setTimeout(tick, GRACE_MS);
  // A connection that comes back should not need the overlay reopening to notice.
  _onLine = () => { if (_host && !_connected) { renderMessage('lb_slow'); } };
  window.addEventListener('online', _onLine);

  // Subscribe live. Offline / unconfigured -> the fallback above already covers it; never throws.
  try {
    // The server-built board first (a fraction of the download, no grouping on the phone); no board
    // yet, or unreadable: the whole players/ node, as it always was.
    _beeBy = 'points'; _beeLang = 'all';
    _beeOff = watchBeeBoard(() => { if (_host && _connected) rerender({ fromData: true }); });
    const offBoard = await watchBoard((b) => { _board = b; _connected = true; rerender({ fromData: true }); });
    if (offBoard) _unsub = offBoard;
    else _unsub = await watchPlayers((all) => { _board = null; _all = all || {}; _connected = true; rerender({ fromData: true }); });
    if (!_host) { if (typeof _unsub === 'function') _unsub(); return; }
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
    '.lb-overlay{--lb-bg:#f4f6fb;--lb-surface:#ffffff;--lb-surface-2:#eef2f8;--lb-ink:#16243a;--lb-muted:#5b6b82;--lb-line:#dde5ef;--lb-accent:#1769d4;--lb-accent-text:#1769d4;--lb-sel:#ffce3a;--lb-sel-ink:#16243a;--lb-gap:#8a5a00}',
    ':root.gh-dark .lb-overlay{--lb-bg:#0e1420;--lb-surface:#1b2333;--lb-surface-2:#2b3547;--lb-ink:#e9eef6;--lb-muted:#9db0c9;--lb-line:#33405a;--lb-accent:#1769d4;--lb-accent-text:#6db0fb;--lb-sel:#ffce3a;--lb-sel-ink:#16243a;--lb-gap:#ffce3a}',
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
    '.lb-segs{display:flex;gap:1px;background:var(--lb-line);border:1px solid var(--lb-line);border-radius:9px;overflow:hidden;margin:8px 16px 12px}',
    '.lb-seg{flex:1 1 0;appearance:none;cursor:pointer;border:0;min-height:40px;font-size:13px;font-weight:800;color:var(--lb-muted);background:var(--lb-surface)}',
    '.lb-seg.is-active{color:var(--lb-surface);background:var(--lb-ink)}',
    // css/hub.css paints the active segment with --hub-accent in dark, which predates these
    // tokens and leaves dark text on a mid blue. The inverted-ink fill reads in both themes, so
    // this takes it back with one more class of specificity rather than editing hub.css (whose
    // rule still covers any older markup that might render outside this panel).
    ':root.gh-dark .lb-panel .lb-seg.is-active{background:var(--lb-ink);border-color:var(--lb-ink);color:var(--lb-surface)}',
    '.lb-body{padding:0 16px 24px}',
    // --- controls: three sort pills, then a full-width select that opens IN PLACE ---------------
    '.lb-ctrls{position:relative;display:flex;flex-direction:column;gap:8px;margin:0 0 12px}',
    '.lb-pills{display:flex;gap:6px}',
    // #ffce3a marks the selected pill and nothing else on these screens; the pressed state also
    // carries weight and an inset ring, so it is never colour alone.
    '.lb-pill{flex:1 1 0;min-height:40px;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0 8px;white-space:nowrap;font-size:12.5px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid var(--lb-line);background:transparent;color:var(--lb-muted)}',
    '.lb-pill.is-sel{border-color:var(--lb-sel);background:var(--lb-sel);color:var(--lb-sel-ink);box-shadow:inset 0 0 0 1px var(--lb-sel)}',
    '.lb-star{font-style:normal;font-size:12px;line-height:1}',
    '.lb-select{width:100%;min-height:40px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 12px;cursor:pointer;font-size:13px;font-weight:800;color:var(--lb-ink);background:var(--lb-surface-2);border:1px solid var(--lb-line);border-radius:8px}',
    '.lb-select.is-open{border-radius:8px 8px 0 0}',
    '.lb-caret{width:15px;height:15px;flex:none}',
    '.lb-select.is-open .lb-caret{transform:rotate(180deg)}',
    '.lb-panel-list{display:flex;flex-direction:column;gap:1px;background:var(--lb-line);border:1px solid var(--lb-line);border-top:0;border-radius:0 0 10px 10px;overflow:hidden;position:absolute;left:0;right:0;top:100%;z-index:1;box-shadow:0 10px 24px rgba(9,24,48,.18)}',
    '.lb-opt{width:100%;min-height:40px;display:flex;align-items:center;gap:9px;padding:0 12px;cursor:pointer;font-size:13px;font-weight:600;color:var(--lb-ink);background:var(--lb-surface);border:0;text-align:left}',
    '.lb-opt.is-sel{font-weight:800;background:var(--lb-surface-2);box-shadow:inset 3px 0 0 var(--lb-sel)}',
    '.lb-opt-nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-opt-n{flex:none;font-size:13px;font-weight:700;color:var(--lb-muted);font-variant-numeric:tabular-nums}',
    '.lb-opt-shape{flex:none;display:flex;align-items:center;width:19px}',
    '.lb-tick{flex:none;width:12px;font-size:12px;font-weight:900;color:var(--lb-ink)}',
    // The key badge: one or two characters, always beside the full name, filled when selected.
    '.lb-key{flex:none;font-style:normal;font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--lb-muted);border:1px solid var(--lb-line);border-radius:3px;padding:1px 4px;background:transparent}',
    '.lb-key.is-sel{color:var(--lb-sel-ink);background:var(--lb-sel);border-color:var(--lb-sel)}',
    // --- the card list ------------------------------------------------------------------------
    '.lb-plist{display:flex;flex-direction:column;gap:8px}',
    // .lb-pcard is a <button> (every card opens the player detail screen) - reset the native
    // button chrome so it still reads as the same card, not a form control.
    '.lb-pcard{display:block;width:100%;text-align:left;font:inherit;color:inherit;appearance:none;cursor:pointer;background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:12px;padding:12px 13px}',
    // "This is you" is a LABEL (the YOU badge) plus an accent rail, never colour alone.
    '.lb-pcard.is-me{border-left:3px solid var(--lb-accent);background:var(--lb-surface-2)}',
    '.lb-pcard.is-skel{opacity:.65;cursor:default}',
    // The podium (2026-10-15): a metal rail down the left edge, and first place lit gold.
    '.lb-pcard.is-pod1{border-left:6px solid #f5c842;background:linear-gradient(90deg,rgba(245,200,66,.22),rgba(245,200,66,.06) 70%),var(--lb-surface);border-color:rgba(245,200,66,.55);border-left-color:#f5c842}',
    '.lb-pcard.is-pod2{border-left:6px solid #b9c0c9}',
    '.lb-pcard.is-pod3{border-left:6px solid #c27a42}',
    '.lb-pcard.is-pod1 .lb-pname{font-weight:800;font-size:1.08em}',
    '.lb-pcard.is-pod1 .lb-pnum b{font-size:27px}',
    '.lb-chip.lb-medalchip.lb-medalchip{width:40px;height:48px;border:0;background:none;padding:0;border-radius:0}',
    '.lb-medal{width:40px;height:48px;display:block}',
    '.lb-pcard.is-pod1 .lb-medal{filter:drop-shadow(0 0 6px rgba(245,200,66,.55))}',
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
    '.lb-pline{flex:1 0 100%;min-width:0;display:flex;align-items:center;gap:6px}',
    '.lb-pline .lb-pname{flex:0 1 auto;min-width:0}',
    '.lb-pname{max-width:100%;font-size:15px;font-weight:700;color:var(--lb-ink);letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-pcard.is-me .lb-pname{font-weight:800}',
    '.lb-you{flex:none;font-style:normal;font-size:11px;font-weight:800;letter-spacing:.1em;background:var(--lb-ink);color:var(--lb-surface);padding:3px 5px;border-radius:3px}',
    '.lb-psubline{flex:1 0 100%;font-size:11.5px;color:var(--lb-muted);margin-top:2px;font-variant-numeric:tabular-nums;min-width:0}',
    // Spelling Bee's row (2026-10-28): days placed, Genius / Queen Bee days, days played, as glyph + number.
    '.lb-beechips{display:inline-flex;flex-wrap:wrap;gap:4px 10px}',
    '.lb-beechip{white-space:nowrap}',
    // The tier chip on a game board's card (2026-09-08): the ski-slope shape plus the word, on the
    // NAME line (`.lb-pid`'s own 6px gap spaces it), so it costs the card no height and reads as a
    // fact about the PLAYER. It is what makes the headline number legible - "6" means nothing until
    // the row says the 6 is a Hard score - and it must not sit beside the plays count, which is the
    // one number here that difficulty never touches.
    // Shape first, hue second (the colorblind rule); the word carries it on its own if neither reads.
    '.lb-tierpill{display:inline-flex;align-items:center;gap:6px;margin-top:4px;padding:3px 9px 3px 7px;border-radius:999px;border:1.5px solid var(--lb-pill-color);font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--lb-ink);line-height:1.2}',
    '.lb-tierpill .lb-dshape{width:13px;height:13px;fill:var(--lb-pill-color)}.lb-tierpill .lb-dshape-x2{width:23px}',
    ':root.gh-dark .lb-tierpill .lb-dshape-t3,:root.gh-dark .lb-tierpill .lb-dshape-t4{fill:#e6e9f0}:root.gh-dark .lb-tierpill{border-color:color-mix(in srgb,var(--lb-pill-color) 60%,#e6e9f0)}',
    '.lb-tierchip{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--lb-ink);text-transform:uppercase}',
    '.lb-tierchip .lb-dshape{width:12px;height:12px;fill:var(--lb-pill-color,#5b6b82)}',
    '.lb-tierchip .lb-dshape-x2{width:21px}',
    // The wordless form, for By Game's leader row (see tierMarkHTML).
    '.lb-tiermark{flex:0 0 auto;display:inline-flex;align-items:center;margin-left:2px}',
    '.lb-tiermark .lb-dshape{width:12px;height:12px;fill:var(--lb-pill-color,#5b6b82)}',
    '.lb-tiermark .lb-dshape-x2{width:21px}',
    // The inline difficulty breakdown (catInlineHTML). It lives INSIDE .lb-psubline, so it costs
    // the card no height at all. NO WRAP and no sideways scroll, same rule the old strip had: the
    // JS budget decides what fits, and `overflow:hidden` is only the belt to that braces - a number
    // must never be half-drawn.
    // The padding/negative-margin pair gives the selected item's 2px underline somewhere to be
    // drawn: `overflow:hidden` clips to the padding box, so without it the marker was clipped away
    // and the class painted nothing. The negative margin hands the 3px straight back, so the row
    // - and therefore the card - is exactly the height it would be without any of this.
    '.lb-cats{display:flex;flex-wrap:nowrap;align-items:center;gap:9px;min-width:0;overflow:hidden;padding-bottom:3px;margin-bottom:-3px}',
    '.lb-cat{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums}',
    '.lb-cat .lb-dshape{width:12px;height:12px;fill:var(--lb-pill-color,#5b6b82)}',
    // Expert is a DOUBLE diamond, drawn on a 2:1 viewBox. Squaring it here (the rule above sizes
    // every other shape) collapsed it into two dots that read as neither diamond, which is the one
    // pair in the ski-slope set a player has to be able to tell apart.
    '.lb-cat .lb-dshape-x2{width:21px}',
    // The two shapeless categories carry their real word, muted so the shapes still lead the eye.
    '.lb-cat-w{font-style:normal;font-size:11px;font-weight:700;color:var(--lb-muted)}',
    // The filtered-on category is underlined in the selection accent - a LINE, plus the dropdown
    // directly above already naming it in full, so never hue alone. box-shadow rather than
    // text-decoration (which does not paint across a flex container, so the first draft applied
    // the class and drew nothing) and rather than a border (which would shift every other item on
    // the row by 2px the moment a filter was picked).
    '.lb-cat.is-sel{box-shadow:0 2px 0 var(--lb-sel)}',
    '.lb-pnum{flex:none;display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1}',
    '.lb-pnum b{font-size:23px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.025em}',
    '.lb-pnum span{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--lb-muted);margin-top:3px}',
    '.lb-pfoot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;padding-left:96px}',
    // --- the six-category strip: 3 by 2, so it fits 360px with nothing truncated ----------------
    // .lb-strip/.lb-chipv are UNRENDERED since 2026-08-31 (see catStripHTML) - kept, not deleted,
    // so the helper still paints correctly if it is ever wanted back. `.lb-key` below is NOT dead:
    // the filter dropdown's own option rows use it.
    // The card's one-line strip. NO WRAP: `flex-wrap:nowrap` plus a chip count capped in JS
    // (MAX_CHIPS) is what keeps it to one line without ever clipping a number - a row that could
    // overflow would need either a second line or a sideways scroll, and neither is allowed here.
    '.lb-strip{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;width:100%;min-width:0}',
    '.lb-chipv{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:7px;background:var(--lb-surface-2);font-size:12.5px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums}',
    '.lb-chipv.is-sel{box-shadow:inset 0 0 0 1px var(--lb-sel)}',
    '.lb-chipv.is-more{color:var(--lb-muted);font-weight:700}',
    // The full six, on the player detail screen only (see catGridHTML).
    // A SECTION HEADING. Both blocks on this screen (the breakdown, the game list) had none,
    // which is most of why the screen did not say what it was showing.
    '.lb-h4{margin:16px 0 8px;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--lb-muted)}',
    '.lb-grid6{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--lb-line);border:1px solid var(--lb-line);border-radius:10px;overflow:hidden;width:100%}',
    '.lb-grid6.is-4{grid-template-columns:repeat(4,minmax(0,1fr))}',
    '.lb-grid6.is-2{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.lb-cell{display:flex;flex-direction:column;background:var(--lb-surface);padding:8px 6px 9px;min-width:0}',
    '.lb-cell.is-sel{background:var(--lb-surface-2)}',
    '.lb-cell-top{display:flex;align-items:center;gap:5px;min-width:0}',
    // (2026-10-11 review) the tier's shape beside its word, replacing the E/M/H/X letter codes.
    '.lb-cell-shape{flex:none;display:inline-flex}.lb-cell-shape .lb-dshape{width:12px;height:12px;fill:var(--lb-pill-color,#5b6b82)}.lb-cell-shape .lb-dshape-x2{width:21px}',
    '.lb-cell-top em{font-style:normal;font-size:11px;color:var(--lb-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-cell b{font-size:18px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin-top:4px;line-height:1}',
    // The label wraps rather than truncating: "Wins against people" says what the number is,
    // and an ellipsis in the middle of it would put the screen back where it started.
    '.lb-grid6.is-2 .lb-cell-top em{overflow:visible;white-space:normal;text-overflow:clip;line-height:1.25}',
    '.lb-grid6.is-2 .lb-cell{padding:9px 10px 10px}',
    // A game board's per-tier tiles (unchanged shape vocabulary, new chrome).
    '.lb-tiles{display:flex;flex-wrap:wrap;gap:5px;margin:0}',
    '.lb-tile2{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;background:var(--lb-surface-2);border:1.5px solid transparent;font-size:12px;font-weight:800;color:var(--lb-muted)}',
    '.lb-tile2 .lb-dshape{fill:var(--lb-pill-color,#5b6b82)}',
    '.lb-tile2.is-sel{border-color:var(--lb-pill-color,#1c2430);color:var(--lb-ink);background:var(--lb-surface)}',
    ':root.gh-dark .lb-tile2.is-sel{border-color:var(--lb-ink)}',
    '.lb-tile2.is-empty{opacity:.55}',
    // The YOU row (.lb-pcard.is-me) is itself --lb-surface-2, so its tiles flip to --lb-surface
    // with a hairline, or they melt into the row (Matt, 2026-10-14).
    '.lb-pcard.is-me .lb-tile2{background:var(--lb-surface);border-color:var(--lb-line)}',
    '.lb-pcard.is-me .lb-tile2.is-sel{border-color:var(--lb-pill-color,#1c2430)}',
    '.lb-tile-mp .lb-mp-tag{font-style:normal;font-size:11px;font-weight:900;letter-spacing:.04em;color:var(--lb-muted)}',
    '.lb-dshape{width:11px;height:11px;display:block}',
    '.lb-dshape-x2{width:19px;height:11px}',
    // Tic Tac Toe / Snake: two headline numbers instead of one (see ttCardHTML, snCardHTML).
    '.lb-tt-split{display:flex;gap:22px;margin:11px 0 0 45px}',
    '.lb-tt-val{display:flex;flex-direction:column;line-height:1}',
    '.lb-tt-val b{font-size:22px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.025em}',
    '.lb-tt-val span{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--lb-muted);margin-top:4px}',
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
    '.lb-glead-k{flex:none;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--lb-muted)}',
    '.lb-glead-empty{font-style:italic}',
    // No medal and no "Top" here (Matt, 2026-10-15): a list of leaders makes that obvious; medals
    // belong only on lists of every player.
    '.lb-glead:not(.lb-glead-empty) .lb-glead-nm{color:var(--lb-ink);font-weight:800;font-size:13px}',
    '.lb-gnum{flex:none;display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1}',
    '.lb-gnum b{font-size:19px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em}',
    '.lb-gnum span{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--lb-muted);margin-top:3px}',
    '.lb-gnum.is-empty b{color:var(--lb-muted)}',
    // Spanish units run long (VICTORIAS, MEJOR TIEMPO) and squeezed the leader's name to "*King of Ga...".
    'html[lang="es"] .lb-gnum span,html[lang="es"] .lb-pnum span,html[lang="es"] .lb-tt-val span,html[lang="es"] .lb-board-n span,html[lang="es"] .lb-unith{letter-spacing:.02em;font-size:11px}',
    'html[lang="es"] .lb-grow{gap:9px}',
    // --- a game board (screen 3) ----------------------------------------------------------------
    '.lb-board-head{display:flex;align-items:center;gap:4px;margin:0 0 12px}',
    '.lb-back{align-self:flex-start;appearance:none;cursor:pointer;min-height:44px;display:flex;align-items:center;gap:6px;background:none;border:0;padding:0 8px 0 0;color:var(--lb-accent-text);font-size:14px;font-weight:600}',
    // Icon-only beside a title: still a 44px target; the negative margin puts the chevron on the
    // 16px gutter instead of indenting the title.
    '.lb-back.is-icon{flex:none;align-self:center;width:44px;justify-content:flex-start;padding:0;margin:0 -10px 0 -6px}',
    '.lb-back.is-icon .lb-back-i{width:22px;height:22px}',
    '.lb-back-i{width:16px;height:16px;flex:none}',
    '.lb-board-id{flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '.lb-board-h{margin:0;min-width:0;font-size:24px;font-weight:800;letter-spacing:-.025em;color:var(--lb-ink);line-height:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-board-n{flex:none;display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1}',
    '.lb-board-n b{font-size:19px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums}',
    '.lb-board-n span{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--lb-muted);margin-top:3px}',
    '.lb-play{flex:none;margin-left:10px;min-height:40px;padding:0 14px;border:0;border-radius:999px;cursor:pointer;background:var(--lb-accent);color:#fff;font-size:15px;font-weight:800;touch-action:manipulation}',
    // --- standing records -----------------------------------------------------------------------
    '.lb-h3{margin:24px 0 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.13em;color:var(--lb-muted)}',
    '.lb-recs{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--lb-line);border:1px solid var(--lb-line);border-radius:10px;overflow:hidden}',
    '.lb-ctm{position:relative;display:inline-block;vertical-align:middle;flex:none}',
    '.lb-ctm img{display:block;width:100%;height:100%;pointer-events:none}',
    '.lb-ctm-n{position:absolute;transform:translate(-50%,-50%);font-weight:900;line-height:1;font-family:system-ui,-apple-system,sans-serif;letter-spacing:0}',
    '.lb-ctsub{display:flex;gap:6px;margin-top:4px}',
    '.lb-ctkey{display:flex;justify-content:space-between;align-items:center;gap:6px;margin:14px 0 0;padding:8px 10px;border:1px solid var(--lb-line);border-radius:10px}',
    '.lb-ctkey-i{display:flex;align-items:center;gap:5px;white-space:nowrap;font-size:12px;font-weight:700;color:var(--lb-muted)}',
    '.lb-rec{background:var(--lb-surface);padding:12px 13px 13px;min-width:0}',
    '.lb-rec.is-wide{grid-column:span 2}',
    '.lb-rec b{display:block;font-size:20px;font-weight:800;color:var(--lb-ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1.05;overflow-wrap:anywhere}',
    '.lb-rec span{display:block;font-size:11px;color:var(--lb-muted);margin-top:3px;line-height:1.3}',
    '.lb-rec em{display:flex;align-items:center;gap:5px;min-width:0;font-style:normal;font-size:11.5px;font-weight:700;color:var(--lb-ink);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-rec .lb-av{width:18px;height:18px;font-size:12px;border:0;background:transparent}',
    // --- player detail (screen 4) ----------------------------------------------------------------
    '.lb-detail-top{display:flex;align-items:center;gap:10px;min-height:44px}',
    '.lb-pdetail-head{display:flex;align-items:center;gap:12px;margin:8px 0 8px}',
    '.lb-pdetail-head .lb-av{width:42px;height:42px;font-size:22px}',
    '.lb-pdetail-id{flex:0 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.lb-pdetail-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:18px;font-weight:800;color:var(--lb-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-pdetail-meta{font-size:11.5px;font-weight:600;color:var(--lb-muted)}',
    // A quote, not a field: no box around it, so it does not read as somewhere to type.
    '.lb-pmsg{margin:12px 0 0;padding:2px 0 2px 12px;border-left:3px solid var(--lb-line);color:var(--lb-ink);font-size:14px;font-style:italic;line-height:1.4;overflow-wrap:anywhere}',
    // Send message, at the RIGHT EDGE of the detail header, after the wins number (2026-10-11
    // spacing pass; it used to hug the name, floating mid-row). Built from this overlay's own
    // --lb-* tokens rather than css/ui.css's .gh-* set, because the leaderboard does not inject
    // that stylesheet. The wins number takes the slack (`margin-left:auto` below), so it stays
    // right-aligned whether or not the button is rendered. 44x44 is the tap-target floor.
    '.lb-pdetail-head .lb-pnum{margin-left:auto}',
    '.lb-msgbtn{flex:0 0 auto;min-width:44px;height:40px;padding:0 12px;gap:6px;display:inline-flex;'
      + 'align-items:center;justify-content:center;border-radius:20px;border:1px solid var(--lb-line);'
      + 'background:var(--lb-surface-2);color:var(--lb-ink);font:inherit;font-size:19px;line-height:1;'
      + 'cursor:pointer;touch-action:manipulation}',
    '.lb-msgbtn:active{transform:translateY(1px)}',
    // (2026-10-11 review) the button says what it does; a 💬 alone was a guess.
    '.lb-msgbtn-t{font-size:13px;font-weight:800}',
    // The drill-in's context strip: whose page, which game. Quiet by design - it is orientation,
    // not a headline, and the game's own numbers start immediately under it.
    '.lb-ctx{display:flex;align-items:center;gap:12px;margin:8px 0 12px;padding-bottom:12px;border-bottom:1px solid var(--lb-line)}',
    '.lb-ctx .lb-av{width:34px;height:34px;font-size:18px}',
    '.lb-ctx-id{min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.lb-ctx-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;font-weight:700;color:var(--lb-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-ctx-game{font-size:19px;font-weight:800;letter-spacing:-.02em;color:var(--lb-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-pgame{margin-top:8px}',
    '.lb-panel .gs-grow{min-height:56px}',
    '.lb-note{margin:0 0 12px;font-size:13px;line-height:1.4;color:var(--lb-muted)}',
    // Minesweeper's own board (2026-10-15): level tabs, a time or a best-% bar per row.
    '.lb-mstabs{margin:0 0 12px}',
    '.lb-mstabs.is-wrap{flex-wrap:wrap}.lb-mstabs.is-wrap .lb-mstab{flex:1 1 auto;min-width:0}',
    '.lb-unith{text-align:right;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--lb-muted);margin:0 16px 6px}',
    // Arrow Maze's Levels | Rush and Rush's tabs share the row evenly (2026-10-16); the week's dates sit left of the unit.
    '.lb-pill.lb-wohalf,.lb-pill.lb-wothird{flex:1 1 0;justify-content:center;min-width:0}',
    '.lb-unith.lb-wounith{display:flex;justify-content:space-between}',
    '.lb-mstab{flex:1 1 auto;padding:0 6px}',
    '.lb-mstab-sh{display:inline-flex}.lb-mstab-sh .lb-dshape{width:11px;height:11px;fill:var(--lb-pill-color)}.lb-mstab-sh .lb-dshape-x2{width:19px}',
    ':root .lb-mstab.is-sel .lb-dshape-t3,:root .lb-mstab.is-sel .lb-dshape-t4{fill:var(--lb-sel-ink)}',
    '.lb-pnum b.lb-msval{display:inline-flex;align-items:center;gap:6px}',
    '.lb-pnum b.lb-msval span{font-size:inherit;font-weight:inherit;text-transform:none;letter-spacing:inherit;margin:0;color:inherit}',
    '.lb-pnum b.lb-msval .lb-tiermark{margin:0}',
    '.lb-pnum b.lb-msval .lb-mspct{display:inline-flex;align-items:center;gap:6px;font-size:19px;color:var(--lb-muted)}',
    '.lb-pnum b.lb-msval .lb-msnone{color:var(--lb-muted)}',
    '.lb-msbar{display:block;width:40px;height:6px;border-radius:3px;background:var(--lb-line);overflow:hidden}',
    '.lb-msbar i{display:block;height:100%;background:var(--lb-muted)}',
    '.lb-legend{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;margin:0 0 12px;font-size:12px;font-weight:700;color:var(--lb-muted)}',
    '.lb-legend-i{display:inline-flex;align-items:center;gap:5px}',
    '.lb-legend-i .lb-dshape{width:12px;height:12px;fill:var(--lb-pill-color,#5b6b82)}',
    '.lb-legend-i .lb-dshape-x2{width:21px}',
    // Small phones: the score had eaten the name. Shrink the fixed-width pieces, not the name.
    '@media (max-width:360px){.lb-pcard{padding:12px 10px}.lb-pcard-row{gap:8px}.lb-chip{width:28px;height:28px;font-size:12px}'
      + '.lb-av{width:32px;height:32px;font-size:17px}.lb-pnum b{font-size:20px}.lb-pfoot{padding-left:0}.lb-msgbtn-t{display:none}.lb-msgbtn{padding:0}'
      + '.lb-pill{padding:0 4px;font-size:12px}.lb-board-h{font-size:22px}}',
    // --- By Game's top three, and the You tab (2026-10-27) ------------------------------------------
    '.lb-gcard{appearance:none;cursor:pointer;display:flex;flex-direction:column;gap:8px;width:100%;text-align:left;padding:12px;background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:14px;font:inherit;color:inherit;touch-action:manipulation}',
    '.lb-gcard.is-empty{opacity:.72}',
    '.lb-gcard-head{display:flex;align-items:center;gap:10px;min-width:0}',
    '.lb-gcard-head .lb-gtitle{flex:1 1 auto}',
    '.lb-gart.is-sm{width:38px;height:28px}',
    '.lb-gchev{flex:none;width:20px;height:20px;color:var(--lb-muted)}',
    '.lb-gtop{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;color:var(--lb-muted)}',
    '.lb-gtop.is-first{padding:7px 10px;border-radius:10px;background:var(--lb-surface-2);font-size:15px;font-weight:800;color:var(--lb-ink)}',
    '.lb-gtop-rest{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 2px}',
    '.lb-gtop-who{display:inline-flex;align-items:center;gap:5px;min-width:0;padding:1px 7px 1px 2px;border:1.5px solid transparent;border-radius:999px}',
    '.lb-gtop-who.is-me{border-color:var(--lb-sel)}',
    '.lb-gtop .lb-av{width:20px;height:20px;font-size:14px;border:0;background:transparent}',
    '.lb-gtop.is-first .lb-av{width:24px;height:24px;font-size:17px}',
    '.lb-gtop-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-tb{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 4px;box-sizing:border-box;border-radius:999px;border:1.5px solid var(--lb-muted);font-style:normal;font-size:12px;font-weight:800;color:var(--lb-muted);font-variant-numeric:tabular-nums}',
    '.lb-tb.is-1{background:#f5c842;border-color:#f5c842;color:#3a2a00}',
    '.lb-you-head{display:flex;align-items:center;gap:12px;margin:4px 0 4px}',
    '.lb-you-head .lb-av{width:52px;height:52px;font-size:28px}',
    '.lb-you-id{display:flex;flex-direction:column;gap:2px;min-width:0}',
    '.lb-you-nm{font-size:22px;font-weight:800;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-you-sub{font-size:14px;color:var(--lb-muted)}',
    '.lb-you-sub b{color:var(--lb-ink)}',
    '.lb-yh{margin:20px 0 10px;font-size:18px;font-weight:800;color:var(--lb-ink)}',
    '.lb-yh-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
    '.lb-yh-k{flex:none;font-size:12px;font-weight:700;color:var(--lb-muted)}',
    '.lb-ylist{display:flex;flex-direction:column;gap:8px}',
    '.lb-yrow{appearance:none;cursor:pointer;display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:8px 14px;text-align:left;background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:12px;font:inherit;color:inherit;touch-action:manipulation}',
    '.lb-yrow-nm{flex:1 1 auto;min-width:0;font-size:15px;font-weight:700;line-height:1.25;overflow-wrap:anywhere}',
    '.lb-yrow-v{flex:none;display:inline-flex;align-items:center;gap:5px;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}',
    '.lb-ycard{appearance:none;cursor:pointer;display:flex;flex-direction:column;gap:10px;width:100%;padding:12px 14px;text-align:left;background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:14px;font:inherit;color:inherit;touch-action:manipulation}',
    '.lb-ycard-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
    '.lb-ycard-nm{font-size:16px;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-ychip{flex:none;font-size:12px;font-weight:800;padding:3px 8px;border-radius:999px;background:var(--lb-surface-2);color:var(--lb-muted)}',
    '.lb-ybox{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
    '.lb-ybox-c{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:10px;min-width:0;border:1px solid var(--lb-line)}',
    '.lb-ybox-c.is-rec{background:var(--lb-surface-2);border-color:var(--lb-surface-2)}',
    '.lb-ybox-c em{font-style:normal;font-size:12px;font-weight:700;color:var(--lb-muted);display:flex;align-items:center;gap:3px;flex-wrap:wrap;line-height:1.3}',
    '.lb-ybox-c em .lb-av{width:16px;height:16px;font-size:12px;border:0;background:transparent}',
    '.lb-ybox-c b,.lb-yrow-v{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}',
    '.lb-ybox-c b{font-size:20px;font-weight:800;letter-spacing:-.01em;min-width:0}',
    '.lb-ybox-c b .lb-tiermark,.lb-yrow-v .lb-tiermark{margin:0}',
    '.lb-ygap{font-size:13px;font-weight:800;color:var(--lb-gap)}',
    '.lb-ynew{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:14px}',
    '.lb-ynew-id{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
    '.lb-ynew-rec{font-size:13px;color:var(--lb-muted);line-height:1.35}',
    '.lb-ynew-rec .lb-av{display:inline-flex;width:16px;height:16px;font-size:12px;border:0;background:transparent;vertical-align:-3px}',
    '.lb-standline{margin:12px 0 0}',
    '.lb-standline b{color:var(--lb-ink)}',
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

// --- LEADERBOARD V2: the score/puzzle boards, read through THIS file's own orders (2026-10-31) -----
// js/leaderboard2-ui.js (admin preview) ranks every score and puzzle game exactly the way this file's
// boards do: the same rows, the same comparator (boardView / msAllCmp / msCellCmp), the same number and
// the same ties (rankMap). These two functions only borrow the board state for one computation and put
// it back, so this overlay's own behaviour is untouched. ADDITIVE; read-only like everything here.
const LB2_RANK_ALT = { skeeball: [{ by: '', key: 'lb_sort_points' }, { by: 'high', key: 'lb_sort_high' }],
  spellingbee: [{ by: 'points', key: 'lb_bee_points' }, { by: 'words', key: 'lb_bee_words' }] };
function lb2With(id, st, fn) {
  const saved = [_game, _tier, _view, _machine, _beeLang, _beeBy];
  _game = id; _tier = st.tier == null ? null : st.tier; _view = st.view || ''; _machine = st.machine || 'all';
  _beeLang = st.lang || 'all'; _beeBy = st.by || 'points';
  try { return fn(); } finally { [_game, _tier, _view, _machine, _beeLang, _beeBy] = saved; }
}
/** What boards a score/puzzle game has: its difficulty tabs (`tiers`, All = null first), its other
 *  tabs as `views` ([{view, label, tiered}], the first is the default), alternative numbers (`rankBy`)
 *  and Spelling Bee's languages. Holdem and Cup Pong return only their extra boards (Bankroll, Solo);
 *  their wins boards are built from byDiff/byMode by js/leaderboard2-boards.js. */
export function lb2ScoreSpecs(list, id) {
  const all = t('lb_diff_all');
  if (id === 'holdem') return { tiers: [], views: [{ view: 'bank', label: t('lb_sort_bank'), tiered: false }], rankBy: [], langs: null };
  if (id === 'cuppong') return { tiers: [], views: list.some((g) => cpSoloBest(g) !== null) ? [{ view: 'solo', label: tx('lb_tab_solo', 'Solo'), tiered: false }] : [], rankBy: [], langs: null };
  if (id === 'skeeball') {
    const views = [{ view: '', label: all, tiered: false }].concat(skMachinesPresent(list).map((m) => ({ view: 'm:' + m, label: skMachineMeta(m).name, tiered: false })));
    return { tiers: [], views, rankBy: LB2_RANK_ALT.skeeball.map((r) => ({ by: r.by, label: t(r.key) })), langs: null };
  }
  if (id === 'spellingbee') {
    return { tiers: [], views: [{ view: '', label: '', tiered: false }], rankBy: LB2_RANK_ALT.spellingbee.map((r) => ({ by: r.by, label: tx(r.key, r.by) })),
      langs: [{ lang: 'all', label: tx('lb_bee_all', 'All') }, { lang: 'en', label: 'English' }, { lang: 'es', label: 'Español' }] };
  }
  if (id === 'contexto') return { tiers: [], views: [{ view: '', label: all, tiered: false }, { view: 'daily', label: tx('lb_ct_daily', 'Daily'), tiered: false }], rankBy: [], langs: null };
  if (id === 'minesweeper') return { tiers: [null, 1, 2, 3, 4], views: [{ view: '', label: '', tiered: true }], rankBy: [], langs: null };
  let tiers = fieldTiersPresent(list, [id]);
  if (id === 'wordweaver') tiers = [1, 2, 3, 4].filter((k) => list.some((g) => wwCleared((g.games || {}).wordweaver, WW_TIERS[k - 1]) > 0));
  const views = [{ view: '', label: id === 'snake' || id === 'brickblitz' ? all : '', tiered: true }];
  if (id === 'snake') views.push({ view: 'off', label: t('lb_sn_walls_off'), tiered: false }, { view: 'on', label: t('lb_sn_walls_on'), tiered: false });
  if (id === 'brickblitz') {
    for (const m of ['arcade', 'endless']) if (list.some((g) => lb2BzModeRow(g, m, null))) views.push({ view: 'bz:' + m, label: m === 'arcade' ? 'Arcade' : 'Endless', tiered: true });
  }
  return { tiers: tiers.length ? [null, ...tiers] : [], views, rankBy: [], langs: null };
}
/** Brick Breaker's best per mode (js/game-stats.js withMode `{m}` + `{hi}`, recorded from 2026-10-30):
 *  { tier, hi, played } at `tier` (null = the hardest tier with a best), or null. */
function lb2BzModeRow(g, m, tier) {
  const bm = (((g.games || {}).brickblitz || {}).byMode) || {};
  const per = {};
  for (const k of Object.keys(bm)) {
    if (!k.split('|').includes('m=' + m)) continue;
    for (const d of Object.keys(bm[k] || {})) {
      const b = bm[k][d] || {}; const tr = tierOf(d) || 0;
      const c = per[tr] || (per[tr] = { hi: 0, played: 0 });
      c.hi = Math.max(c.hi, +b.hi || 0); c.played += b.played | 0;
    }
  }
  if (tier != null) { const c = per[tier]; return c && c.hi > 0 ? { tier, hi: c.hi, played: c.played } : null; }
  for (const tr of [4, 3, 2, 1, 0]) { const c = per[tr]; if (c && c.hi > 0) return { tier: tr || null, hi: c.hi, played: c.played }; }
  return null;
}
function lb2SmallMedal(ct) {
  const c = ctCounts(ct);
  const k = CT_KINDS.find((x) => c[x] > 0);
  return k ? ctMedalHTML(k, c[k], 30) : '—';
}
/** One score/puzzle board: rows in the board's own order with ranks (ties share one), each row's
 *  printed number (`html` and plain `text`), games, and `num`/`tier` for the gap line. `gap(me, above)`
 *  returns { k, v, n } (v already formatted), { k: 'tier' } across difficulties, or null. */
export function lb2ScoreBoard(list, id, spec = {}) {
  const view = spec.view || '';
  const st = { tier: spec.tier, lang: spec.lang, by: spec.by,
    view: view.startsWith('m:') || view.startsWith('bz:') ? (id === 'skeeball' ? spec.by || '' : '') : (id === 'skeeball' ? spec.by || '' : view),
    machine: view.startsWith('m:') ? view.slice(2) : 'all' };
  return lb2With(id, st, () => {
    let rows, cmp, kind = gapKind(id), lower = LOWER_IS_BETTER.has(id), unit = '';
    let games = (g) => boardPlaysOf(g, id), num = (g) => boardMetricOf(g, id), tierOfRow = (g) => boardTierOf(g, id);
    let html = null, text = null;
    if (id === 'minesweeper') {
      const tier = _tier;
      rows = tier == null ? list.filter((g) => msHeadline(g)) : list.filter((g) => msCellAt(g, tier));
      cmp = tier == null ? msAllCmp : (a, b) => msCellCmp(msCellAt(a, tier), msCellAt(b, tier));
      rows.sort((a, b) => cmp(a, b) || rankName(a).localeCompare(rankName(b)));
      const cell = (g) => (tier == null ? msHeadline(g) : { tier, c: msCellAt(g, tier) });
      html = (g) => msCellHTML(cell(g).c);
      text = (g) => { const c = cell(g).c; return c.ms != null ? formatBoardMetric(c.ms, 'minesweeper', '') : c.pct != null ? c.pct + '%' : '—'; };
      games = (g) => playsAtTier(g, ['minesweeper'], tier);
      num = (g) => { const c = cell(g); return c && c.c.ms != null ? c.c.ms : null; };
      tierOfRow = (g) => { const c = cell(g); return c ? c.tier : null; };
      kind = 'time'; lower = true; unit = t('lb_unit_ms_best');
    } else if (view.startsWith('bz:')) {
      const m = view.slice(3);
      const at = (g) => lb2BzModeRow(g, m, _tier);
      rows = list.filter((g) => at(g));
      cmp = (a, b) => ((at(b).tier || 0) - (at(a).tier || 0)) || (at(b).hi - at(a).hi);
      rows.sort((a, b) => cmp(a, b) || rankName(a).localeCompare(rankName(b)));
      num = (g) => at(g).hi; tierOfRow = (g) => at(g).tier; games = (g) => at(g).played;
      text = (g) => numText(at(g).hi); kind = 'points'; lower = false; unit = t('lb_unit_points');
    } else {
      const v = boardView(list, id);
      rows = v.rows; cmp = v.cmp; unit = v.unit || unitTextOf(id, null);
      html = (g) => v.val(g);
      if (id === 'skeeball') {
        games = (g) => skPlaysAt(g, _machine);
        num = _view === 'high' ? (g) => skBestAt(g, _machine) : (g) => skPointsAt(g, _machine);
        tierOfRow = () => null; kind = 'points';
        text = (g) => numText(num(g));
      } else if (id === 'contexto') {
        const src = _view === 'daily' ? ctDailyOf : ctOf;
        games = (g) => (_view === 'daily' ? (ctDailyOf(g).played | 0) : boardPlaysOf(g, id));
        html = (g) => lb2SmallMedal(src(g)); kind = null; unit = t('lb_unit_ct_medals');
        text = (g) => { const c = ctCounts(src(g)); const k = CT_KINDS.find((x) => c[x] > 0); return k ? `${CT_MEDAL_GLYPH[k === 'iron' ? 'solved' : k]} ${c[k]}` : '—'; };
      } else if (id === 'cuppong' && _view === 'solo') {
        games = cpSoloRacks; num = cpSoloBest; tierOfRow = () => null; kind = 'throws'; lower = true;
        text = (g) => String(cpSoloBest(g)); unit = t('lb_unit_fewest');
      } else if (id === 'snake' && (_view === 'off' || _view === 'on')) {
        const w = _view;
        num = (g) => snWallsCell(g, w).v; tierOfRow = (g) => snWallsCell(g, w).tier; text = (g) => String(snWallsCell(g, w).v);
      } else if (id === 'holdem') {
        kind = 'bank'; tierOfRow = () => null;
      } else if (id === 'spellingbee' && beeBoard()) {
        games = (g) => beeRowFor(g).days; tierOfRow = () => null;
        kind = beeView().by === 'words' ? 'words' : 'points';
      }
    }
    if (!text) text = (g) => (id === 'holdem' && hbReview(g) ? t('lb_hb_review') : metricText(num(g), id));
    if (!html) html = (g) => `<span>${esc(text(g))}</span>`;
    const { rankOf } = rankMap(rows, () => 0, cmp);
    const out = rows.map((g) => ({ g, key: g.key, rank: rankOf[g.key], games: games(g) | 0, num: num(g), tier: tierOfRow(g), html: html(g), text: text(g), noPodium: id === 'holdem' && _view === 'bank' && num(g) == null }));
    const gap = (me, above) => {
      if (!kind || !me || !above) return null;
      if ((me.tier || 0) !== (above.tier || 0) || me.num == null || above.num == null) return { k: 'tier' };
      let d = lower ? me.num - above.num : above.num - me.num;
      let v;
      if (kind === 'time') { d = Math.floor(me.num / 1000) - Math.floor(above.num / 1000); v = formatTimeMetric(d * 1000); }
      else v = kind === 'bank' ? bankText(d) : numText(d);
      return d > 0 ? { k: kind, v, n: d } : null;
    };
    return { rows: out, unit, kind, lower, gap };
  });
}
/** The OLD board's one standing per game (gameStanding: the All tab's own order, boardMetricCmp, ties
 *  shared), read with no tab selected. Leaderboard v2's medals, Hall of Fame and records come ONLY from
 *  this (Matt, 2026-10-31: "an interface redesign, not a stats redesign"). [{ g, key, rank }]. */
export function lb2Standing(list, id) {
  return lb2With(id, {}, () => {
    const st = gameStanding(list, id);
    // Hold'em: a bankroll never used (no entry, no grant) sits on the starting stack and ties for 2nd with
    // everyone else who never sat down. The board still shows them there; it earns no medal in v2's tallies.
    return st.rows.map((g) => ({ g, key: g.key, rank: st.rankOf[g.key], tie: st.tiedAt(g.key), noMedal: id === 'holdem' && !hbTouched(g) }));
  });
}

// --- Leaderboard v2, round 1 (2026-10-31): the OLD board's numbers, for the new look ------------------
// Matt: "This is an interface redesign, not a stats redesign." v2 (js/leaderboard2-ui.js) draws ONLY what
// the functions below return, and they are this board's own code run on a borrowed state (lb2With): the
// same tabs (boardView / msBoardHTML / beeTabsHTML / the Skeeball, Hold'em and Contexto tabs), the same
// rows, order, ranks, ties, numbers and sub lines, the same gap maths (gapParts), the same You-tab lists
// (youHTML) and the same per-game standing (gameStanding). tools/test-lb2-parity.mjs renders both
// overlays from one people list and compares them row by row. ADDITIVE and read-only.
const stKey = (st) => [st.tier == null ? '' : st.tier, st.view || '', st.machine || 'all', st.lang || 'all', st.by || 'points'].join('~');
const tierWord = (tier) => (tier == null ? t('lb_diff_all') : t(TIER_LABEL_KEY[tier]));
/** The old board's tabs for a game: { rows: [[{ st, key, label, tier }]], def } (`st` = { tier, view,
 *  machine, lang, by }; one row of tabs, two for Skeeball and Spelling Bee). `def` = the tab it opens on. */
export function lb2Tabs(list, id) {
  // Each tab's state is COMPLETE for its own dimension, the way the old tab handlers set it: a difficulty
  // tab clears the view (_view = ''), a view tab clears the difficulty (_tier = null).
  const tab = (st0, label, tier = null) => {
    const st = ('tier' in st0 || 'view' in st0) ? { tier: null, view: '', ...st0 } : st0;
    return { st, key: stKey(st), label, tier };
  };
  if (id === 'minesweeper') return { rows: [[null, 1, 2, 3, 4].map((tr) => tab({ tier: tr }, tierWord(tr), tr))], def: { tier: null } };
  if (id === 'holdem') return { rows: [[tab({ view: 'bank' }, t('lb_sort_bank')), tab({ view: 'wins' }, t('lb_sort_wins'))]], def: { view: 'bank' } };
  if (id === 'contexto') return { rows: [[tab({ view: 'daily' }, tx('lb_ct_daily', 'Daily')), tab({ view: '' }, t('lb_diff_all'))]], def: {} };
  if (id === 'skeeball') {
    const ms = skMachinesPresent(list);
    const rows = [];
    if (ms.length > 1) rows.push([tab({ machine: 'all' }, t('lb_diff_all'))].concat(ms.map((m) => tab({ machine: m }, skMachineMeta(m).name))));
    rows.push([tab({ view: '' }, t('lb_sort_points')), tab({ view: 'high' }, t('lb_sort_high'))]);
    return { rows, def: { machine: 'all', view: '' } };
  }
  if (id === 'spellingbee' && beeBoard()) {
    return { rows: [[tab({ by: 'points' }, tx('lb_bee_points', 'Points')), tab({ by: 'words' }, tx('lb_bee_words', 'Words'))],
      [tab({ lang: 'all' }, tx('lb_bee_all', 'All')), tab({ lang: 'en' }, 'English'), tab({ lang: 'es' }, 'Español')]], def: { lang: 'all', by: 'points' } };
  }
  return lb2With(id, {}, () => {
    let tiers = id === 'tictactoe' ? [] : fieldTiersPresent(list, [id]);
    if (id === 'wordweaver') tiers = [1, 2, 3, 4].filter((k) => list.some((g) => wwCleared((g.games || {}).wordweaver, WW_TIERS[k - 1]) > 0));
    const row = [null, ...tiers].map((tr) => tab({ tier: tr }, tr === 2 && tiers.length > 3 ? tx('lb_tab_med', 'Med') : tierWord(tr), tr));
    if (id === 'tictactoe') row.push(tab({ view: 'ultimate' }, t('lb_tt_ultimate')), tab({ view: 'classic' }, t('lb_tt_classic')));
    if (id === 'snake') row.push(tab({ view: 'off' }, t('lb_sn_walls_off')), tab({ view: 'on' }, t('lb_sn_walls_on')));
    if (id === 'cuppong' && list.some((g) => cpSoloBest(g) !== null)) row.push(tab({ view: 'solo' }, tx('lb_tab_solo', 'Solo')));
    if (anyMpPlays(list, id)) row.push(tab({ view: 'mp' }, t('lb_mp_short')));
    return { rows: [row], def: {} };
  });
}
const stripTags = (h) => String(h == null ? '' : h).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
/** One old-board tab, fully built: { rows: [{ g, key, rank, tie, html, text, sub, sub2, subHtml, tier }],
 *  unit, empty, gap(meKey) -> gap parts to the row above ({ k, v, n } | { k: 'tier', v, tier } | null),
 *  standing gap only on views ranked by the board's own number (the old board's stand line rule). */
export function lb2Board(list, id, st = {}) {
  return lb2With(id, st, () => {
    let rows, cmp, rowOut, gapFn = null, unit = '', empty = '';
    if (id === 'minesweeper') {
      const tier = _tier;
      rows = tier == null ? list.filter((g) => msHeadline(g)) : list.filter((g) => msCellAt(g, tier));
      cmp = tier == null ? msAllCmp : (a, b) => msCellCmp(msCellAt(a, tier), msCellAt(b, tier));
      rows.sort((a, b) => cmp(a, b) || rankName(a).localeCompare(rankName(b)));
      const cellOf = (g) => (tier == null ? msHeadline(g) : { tier: null, c: msCellAt(g, tier) });
      rowOut = (g) => {
        const h = cellOf(g); const n = playsAtTier(g, ['minesweeper'], tier); const w = winsAtTier(g, ['minesweeper'], tier);
        return { html: msCellHTML(h.c), sub: tx('lb_ms_won_of', `${w} of ${n} won`, { w, n }), tier: h.tier };
      };
      unit = t('lb_unit_ms_best');
      empty = t('lb_empty_game', { label: labelOf('minesweeper') });
      const cell = (g) => (tier == null ? msHeadline(g) : { tier, c: msCellAt(g, tier) });
      gapFn = (me, rec) => {
        const hm = cell(me), hr = cell(rec);
        if (!hr || hr.c.ms == null) return null;
        if (hm && hm.c.ms != null && hm.tier === hr.tier) {
          const d = Math.floor(hm.c.ms / 1000) - Math.floor(hr.c.ms / 1000);
          return d > 0 ? { k: 'time', v: formatTimeMetric(d * 1000), n: d } : null;
        }
        return hr.tier ? { k: 'tier', v: formatTimeMetric(hr.c.ms), tier: t(TIER_LABEL_KEY[hr.tier]) } : null;
      };
    } else {
      const v = boardView(list, id);
      rows = v.rows; cmp = v.cmp; unit = v.unit || ''; empty = v.empty || t('lb_empty_game', { label: labelOf(id) });
      rowOut = (g) => ({ html: v.val(g), sub: v.sub ? v.sub(g) : '', sub2: v.sub2 ? v.sub2(g) : '', subHtml: v.subHtml ? v.subHtml(g) : '', tier: v.tier ? v.tier(g) : null });
      if (v.gap) gapFn = (me, rec) => gapParts(me, rec, id);
    }
    const { rankOf, tiedAt } = rankMap(rows, () => 0, cmp);
    const out = rows.map((g) => { const o = rowOut(g); return { g, key: g.key, rank: rankOf[g.key], tie: tiedAt(g.key), ...o, text: stripTags(o.html) }; });
    // The pinned row's gap = the old stand line's (standLineHTML): to the board's FIRST row, read at its
    // tier, only on the views the old board printed it on. Computed NOW (the borrowed state ends below).
    const gaps = new Map();
    if (gapFn && out.length) for (const me of out) if (me.rank > 1) gaps.set(me.key, gapFn(me.g, out[0].g));
    // The board's header number (all plays, gameDetail's) and its standing records block (recordsHTML).
    const plays = id === 'contexto' && _view === 'daily' ? list.reduce((a, g) => a + (ctDailyOf(g).played | 0), 0)
      : list.reduce((a, g) => a + boardPlaysOf(g, id), 0);
    let records = '';
    try { records = id === 'minesweeper' ? '' : recordsHTML(list, id); } catch { records = ''; }
    return { rows: out, unit, empty, plays, records, gap: (key) => gaps.get(key) || null };
  });
}
/** The old You tab's three lists for `meKey` (youHTML, same order and same lines): records held, closest to
 *  breaking (closeness order, gap to the record at the record's tier), not played yet (the record + holder). */
export function lb2Records(list, meKey) {
  const me = list.find((g) => g.key === meKey);
  const out = { held: [], close: [], fresh: [], withRecord: 0, me: me || null };
  if (!me) return out;
  for (const meta of gameMetaSorted()) {
    const id = meta.id;
    if (!isGameOnLauncher(id)) continue;
    lb2With(id, {}, () => {
      const st = gameStanding(list, id);
      const rec = st.rows[0] || null;
      if (rec) out.withRecord++;
      const played = boardPlaysOf(me, id) > 0;
      const rank = st.rankOf[me.key];
      const val = (g) => ({ text: youValText(id, boardMetricOf(g, id)), tier: boardTierOf(g, id) });
      if (rank === 1) out.held.push({ id, mine: val(me), tie: st.tiedAt(me.key) });
      else if (played && rec) out.close.push({ id, rank, tie: st.tiedAt(me.key), c: closeness(me, rec, id), gap: gapParts(me, rec, id), mine: val(me), rec, recVal: val(rec) });
      else if (!played && rec) out.fresh.push({ id, rec, recVal: val(rec) });
    });
  }
  out.close.sort((a, b) => b.c - a.c || labelOf(a.id).localeCompare(labelOf(b.id)));
  return out;
}
/** A person's page: every game on the launcher they played, most played first, with their place in that
 *  game's standing and their board number; plus the old player page's totals (wins, played). */
export function lb2PlayerGames(list, key) {
  const g = list.find((x) => x.key === key);
  if (!g) return null;
  const games = [];
  for (const meta of GAME_META) {
    const id = meta.id;
    if (!isGameOnLauncher(id)) continue;
    lb2With(id, {}, () => {
      const plays = boardPlaysOf(g, id);
      if (!(plays > 0)) return;
      const st = gameStanding(list, id);
      games.push({ id, plays, rank: st.rankOf[g.key] || null, tie: st.rankOf[g.key] ? st.tiedAt(g.key) : false,
        text: youValText(id, boardMetricOf(g, id)), tier: boardTierOf(g, id) });
    });
  }
  games.sort((a, b) => b.plays - a.plays || labelOf(a.id).localeCompare(labelOf(b.id)));
  return { g, games, wins: winsOf(g, null), played: playedOf(g, null) };
}
/** The old By Player list as it opens (category All, sorted by Wins: playerListHTML's own order and
 *  rankMap ties): [{ g, key, rank, tie, wins, played }], everyone with any play. */
export function lb2Players(list) {
  const rows = list.filter((g) => playedOf(g, null) > 0);
  const value = (g) => catValueOf(g, 'all');
  const { rankOf, tiedAt } = rankMap(rows, value);
  rows.sort((a, b) => (value(b) - value(a)) || (playedOf(a, null) - playedOf(b, null)) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
  // `cat` = the old card's line under the name (catInlineHTML: wins per tier shape, runs, VS wins), as HTML.
  return rows.map((g) => ({ g, key: g.key, rank: rankOf[g.key], tie: tiedAt(g.key), wins: value(g), played: playedOf(g, null), cat: catInlineHTML(g) }));
}
/** The tab-word for a difficulty, and the old board's unit-less number text (v2's lists). */
export function lb2TierWord(tier) { return tierWord(tier); }
/** Tests only (tools/test-lb2-parity.mjs): render this overlay from a given board, no network. */
export function __lbSetBoardForTest(board) { _board = board; _connected = true; rerender({ fromData: true }); }
export { GAME_META, ensureCss as ensureLeaderboardCss, medalSVG };

export default { openLeaderboard, closeLeaderboard };
