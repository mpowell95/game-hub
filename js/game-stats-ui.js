// game-stats-ui.js - the player-facing "Game Stats" overlay. A leaderboard-style game-list
// drill-down (HANDOFF-FB2-STATS-NAV.md, replacing the old 13-tab strip): an overview (profile
// identity + total games/wins) tops a list of every game WITH recorded plays, art thumbnail +
// headline stat + chevron; tapping a row drills into that game's own tailored screen (not a
// generic played/won/lost card):
//   Connect 4 - Wins/Losses/Plays totals + a WHO-MOVED-FIRST grid (player vs computer, per level).
//   Chinchon  - Games played (finished/victories/draws/defeats + %) and close-quality stats
//               (total closed by you, total minus ten, total chinchons), on a dark panel.
//   Monopoly Deal / Parchis - Wins/Losses/Plays + win rate, and a record-by-difficulty table.
// Reads the local unified stats (game-stats.js); self-contained (injects its own CSS once). Opened
// from the hub header. `gameListHTML` (the shared drill-down list builder) and `screenFor` (the
// per-game screens) are both exported so the Leaderboard's player detail screen can reuse them
// verbatim - see the export block at the bottom of this file.

import { loadStoredStats, statsId, holdemBalance } from './game-stats.js';
import { loadProfile } from './profile-store.js';
import { isGameLive, corrections, isAdminDevice } from './admin-config.js';
import { correctStats } from './stats-corrections.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';
import LB2 from './leaderboard2-strings.js';
import { GAME_ART } from './game-art.js';
import { diffShapeSVG, tierOf } from './difficulty-tiers.js';
import { SOLO } from './players-agg.js';
import { record, formatBoardMetric, GOLF_COURSE_PAR } from './leaderboard-rank.js';
import { woPoints, RUSH_MODES, woRushBest, woRushBestMap, woRushRuns } from './arrow-maze-time.js';
import { GL_TIERS, glPoints, glCleared, glThreeStars, glNoHint } from './gridlock-points.js';
import { WW_TIERS, wwPoints, wwStars, wwCleared, wwThreeStars, wwExtra, wwDailyCount, wwCollected, wwSpent } from './word-weaver-points.js';
import { beeBoard, watchBeeBoard, beeTotals } from './bee-board.js';
import { backStack } from './back-stack.js';
import { gamePoints } from './lb-points.js';
import { pointsSheetHTML } from './lb-points-sheet.js';
import { LB_RULES } from './lb-rules.js';

const t = makeT(STRINGS);
/** t() with an English fallback, for a key newer than a cached js/strings.js (js/CLAUDE.md, Language support). */
const tf = (key, en) => { const v = t(key); return v === key ? en : v; };

// Tab labels resolve through js/strings.js's game_title_* keys — the SAME keys the leaderboard
// uses, so the two overlays can never disagree on a game's name (Matt, 2026-07-23: titles
// translate, Spain Spanish; the hub registry carries matching {en,es} titles).
const TABS = [
  { id: 'connect4', labelKey: 'game_title_connect4' },
  { id: 'chinchon', labelKey: 'game_title_chinchon' },
  { id: 'business', labelKey: 'game_title_business' },
  { id: 'parchis', labelKey: 'game_title_parchis' },
  { id: 'nutsbolts', labelKey: 'game_title_nutsbolts' },
  { id: 'sudoku', labelKey: 'game_title_sudoku' },
  { id: 'hoops4', labelKey: 'game_title_hoops4' },
  { id: 'minesweeper', labelKey: 'game_title_minesweeper' },
  { id: 'contexto', labelKey: 'game_title_contexto' },
  { id: 'murdoku', labelKey: 'game_title_murdoku' },
  { id: 'wayout', labelKey: 'game_title_wayout' },
  // devOnly matches js/hub.js (Matt, 2026-10-28: admin-only games off the leaderboard, for everyone).
  // tools/test-leaderboard-rank.mjs fails if this list and the hub's devOnly list drift apart.
  { id: 'gridlock', labelKey: 'game_title_gridlock' },
  // Word Weaver (2026-10-28, word-weaver/): admin only, so devOnly as in js/hub.js. Its `ww`
  // sub-counter has its own screen (wordWeaverScreen).
  { id: 'wordweaver', labelKey: 'game_title_wordweaver' },
  // Tower (2026-11-01, tower/): admin only, so devOnly as in js/hub.js. Its `tw` sub-counter: towerScreen.
  { id: 'tower', labelKey: 'game_title_tower', devOnly: true },
  { id: 'escoba', labelKey: 'game_title_escoba' },
  { id: 'filler', labelKey: 'game_title_filler' },
  { id: 'mancala', labelKey: 'game_title_mancala' },
  { id: 'ballrun', labelKey: 'game_title_ballrun' },
  { id: 'tictactoe', labelKey: 'game_title_tictactoe' },
  { id: 'dotsboxes', labelKey: 'game_title_dotsboxes' },
  { id: 'boggle', labelKey: 'game_title_boggle' },
  { id: 'snake', labelKey: 'game_title_snake' },
  { id: 'uno', labelKey: 'game_title_uno' },
  { id: 'yahtzee', labelKey: 'game_title_yahtzee' },
  { id: 'dominoes', labelKey: 'game_title_dominoes' },
  { id: 'hillclimb', labelKey: 'game_title_hillclimb' },
  { id: 'battleship', labelKey: 'game_title_battleship' },
  // NOT devOnly, and the difference is deliberate. Skeeball was LIVE to the family for a couple of hours on 2026-08-11
  // before being pulled back to admin-only, so someone may have real plays recorded - and hiding
  // this row would make their own history invisible to them (THE LAW rule 1). It costs nothing to
  // leave open: gameListHTML only renders a row for a game with plays, so anyone who never played
  // it sees nothing here either way.
  { id: 'skeeball', labelKey: 'game_title_skeeball' },
  // Brick Breaker (released 2026-09-23).
  { id: 'brickblitz', labelKey: 'game_title_brickblitz' },
  // Texas Hold'em (released 2026-09-27). total/byDiff only, so the generic screen draws it.
  { id: 'holdem', labelKey: 'game_title_holdem' },
  // Air Hockey and Cup Pong: released 2026-10-26 (live from the admin page since 2026-09-28).
  { id: 'airhockey', labelKey: 'game_title_airhockey' },
  { id: 'cuppong', labelKey: 'game_title_cuppong' },
  // Darts (2026-10-01): admin only at first, but NOT devOnly here (Murdoku's reasoning): a row only
  // renders for a game with plays, and a devOnly tab would stay hidden after Matt releases it from
  // the admin page. total/byDiff only, so the generic screen draws it.
  { id: 'darts', labelKey: 'game_title_darts' },
  // Flick Soccer (2026-10-11): admin only at first, NOT devOnly here (Darts' reasoning above).
  // total/byDiff only, so the generic screen draws it.
  { id: 'flicksoccer', labelKey: 'game_title_flicksoccer' },
  // Archery (2026-10-14): admin only, so devOnly here too (2026-10-28: without it the leaderboard
  // showed it to every player). Releasing it from the admin page still shows it (visibleTabs and
  // isGameOnLauncher resolve the admin switch); the release commit drops this flag with the hub's.
  // total/byDiff only, so the generic screen draws it.
  { id: 'archery', labelKey: 'game_title_archery', devOnly: true },
  // Pool (2026-10-22, eight-ball/): admin only at first, NOT devOnly here (Darts' reasoning above).
  // total/byDiff only, so the generic screen draws it.
  { id: 'eightball', labelKey: 'game_title_eightball' },
  // Cup Baseball (2026-10-23, cup-baseball/): admin only at first, NOT devOnly here (Darts' reasoning
  // above; devOnly since 2026-10-28, Archery's note). total/byDiff only, so the generic screen draws it.
  { id: 'cupbaseball', labelKey: 'game_title_cupbaseball', devOnly: true },
  // Spelling Bee (2026-10-23, spelling-bee/): admin only at first, NOT devOnly here (Darts' reasoning
  // above). total/byDiff only (a win = a puzzle taken to Genius), so the generic screen draws it.
  { id: 'spellingbee', labelKey: 'game_title_spellingbee' },
  // Battle Arena (2026-10-24, battle-arena/): admin only at first, NOT devOnly here (Darts' reasoning
  // above; devOnly since 2026-10-28, Archery's note). total/byDiff only, so the generic screen draws it.
  { id: 'battlearena', labelKey: 'game_title_battlearena', devOnly: true },
  // Golf is being rebuilt (golf-reference-spec.md) and is admin-only for the duration: the
  // adminConfig override `games.golf.live = false` hides it, so no code flag is involved and
  // releasing it is a tap on the admin page. The tab renders only for whoever can reach the game.
  { id: 'golf', labelKey: 'game_title_golf' },
  // Phase 0 (BB-0-phase-0-handoff.md): stats plumbing only, no game. devOnly matches the hub
  // card's gate (js/hub.js's `baseball` entry) so this tab renders only for a dev profile until
  // there is a game behind it.
  { id: 'baseball', labelKey: 'game_title_baseball', devOnly: true },
];

// Hub registry id (for GAME_ART thumbnails) and headline-unit key, per stats id. Single source
// for both this overlay's game list and the Leaderboard's player detail (leaderboard-ui.js
// imports these instead of keeping its own copy), so the two screens can never disagree on a
// game's thumbnail or unit label. Verified against js/hub.js's GAMES registry (root CLAUDE.md,
// "Adding a game" item 7 warning).
const HUB_ID = {
  connect4: 'connect-four', nutsbolts: 'nuts-bolts', tictactoe: 'tic-tac-toe',
  dotsboxes: 'dots-boxes', ballrun: 'ball-run', business: 'business-deal',
  hillclimb: 'hill-climb', brickblitz: 'brick-blitz', airhockey: 'air-hockey',
  wayout: 'way-out', flicksoccer: 'flick-soccer', eightball: 'eight-ball',
  cupbaseball: 'cup-baseball', spellingbee: 'spelling-bee', battlearena: 'battle-arena',
  wordweaver: 'word-weaver',
};
export const hubIdOf = (id) => HUB_ID[id] || id;
const UNIT_KEY = { ballrun: 'lb_unit_obstacles', snake: 'lb_unit_longest', nutsbolts: 'lb_unit_solved', sudoku: 'lb_unit_solved', contexto: 'lb_unit_solved', murdoku: 'lb_unit_solved', wayout: 'lb_unit_points', gridlock: 'lb_unit_points', wordweaver: 'lb_unit_points', minesweeper: 'lb_unit_cleared', hillclimb: 'lb_unit_meters', brickblitz: 'lb_unit_points', tower: 'lb_unit_blocks', skeeball: 'lb_unit_points', golf: 'lb_unit_points' };
export const unitKeyOf = (id) => UNIT_KEY[id] || 'lb_unit_wins';

/** Every game, as { id (stats id), hubId, title } in the ACTIVE language, alphabetical by the
 *  displayed title. Exported for js/bug-report-ui.js's "Where did it happen?" picker, which needs
 *  the same list of games under the same names but must not import js/hub.js for it (the same
 *  reason the Leaderboard doesn't). Derived from TABS + the shared game_title_* keys, so a new
 *  game appears here the moment it is added there and can never be named differently. */
export function gameChoices() {
  return TABS
    // A retired build stays in TABS so already-recorded plays remain visible (THE LAW rules 1 and
    // 5), but nobody can be playing it today, so it is not a place a bug can happen.
    .filter((tab) => !tab.retired)
    .map((tab) => ({ id: tab.id, hubId: hubIdOf(tab.id), title: t(tab.labelKey) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The tabs this profile may see. A devOnly tab renders for Matt and the tester - and for everyone
 *  the day Matt releases that game from the admin page (js/admin-config.js), which is the same
 *  resolved answer the hub card uses. Without that second half, a game released from inside the app
 *  would appear on the launcher with no stats screen behind it. */
function visibleTabs() {
  // NO dev bypass since 2026-10-28 (Matt: admin-only games "do not need to appear in My Stats
  // either"): a devOnly game shows only once it is live. Still more permissive than
  // isGameOnLauncher in the way that matters: a released game Matt pulls back keeps its screen.
  return TABS.filter((tab) => !tab.devOnly || isGameLive(hubIdOf(tab.id), !tab.devOnly));
}
/** THE LAUNCHER'S visibility rule, for a STATS id - exported 2026-09-09 so the leaderboard can ask
 *  the same question the hub card asks, rather than keeping a third copy of "which games are
 *  released". Matt: *"hide admin only games from the leaderboard too."* `js/hub.js` computes
 *  `isGameLive(g.id, !g.devOnly) || dev`; this is that, with `hubIdOf` in front and TABS supplying
 *  the same `devOnly` default the hub registry does, but WITHOUT `|| dev` since 2026-10-28 (Matt:
 *  admin-only games off the leaderboard "not for me and not for anyone else").
 *
 *  **It is NOT visibleTabs() above, and the difference is the point.** That one passes any tab that
 *  is not `devOnly`, so a game hidden by an admin OVERRIDE still has its My Stats screen - which is
 *  what keeps a player's own history reachable when Matt takes a game off the launcher (THE LAW
 *  rule 1: the leaderboard is the bragging wall and may hide an unreleased game; My Stats is that
 *  person's own ledger and must not). Do not "unify" the two: the asymmetry is load-bearing. */
export function isGameOnLauncher(statsId) {
  const tab = TABS.find((x) => x.id === statsId);
  // A RETIRED build is never on the launcher, for anyone, dev included: there is no card to tap.
  // Checked before the dev bypass for that reason.
  if (tab && tab.retired) return false;
  // NO dev bypass on the board (Matt, 2026-10-28: "Admin only games should not appear on the
  // leaderboard. Not for me and not for anyone else"). The leaderboard is its only caller.
  return isGameLive(hubIdOf(statsId), !(tab && tab.devOnly));
}

const C4_DIFFS = [['easy', 'gs_diff_easy'], ['medium', 'gs_diff_medium'], ['hard', 'gs_diff_hard'], ['expert', 'gs_diff_expert']];
/** A game's display title in the active language (call at render time, never module scope). */
function gameLabel(id) { const tab = TABS.find((x) => x.id === id); return tab ? t(tab.labelKey) : id; }

// Map each game's own difficulty vocabulary onto the hub's shared tier names, so the by-difficulty
// tables read consistently (Monopoly Deal uses easy/normal/hard, Parchis uses beginner/intermediate/
// pro/expert). 'legacy' is the folded-in pre-unified history (shown as "Earlier games"). Values
// (the object keys here) are storage vocabulary and stay canonical; only labelKey resolves via t().
const DIFF_META = {
  easy: { labelKey: 'gs_diff_beginner', order: 1 }, beginner: { labelKey: 'gs_diff_beginner', order: 1 }, facil: { labelKey: 'gs_diff_beginner', order: 1 },
  normal: { labelKey: 'gs_diff_intermediate', order: 2 }, medium: { labelKey: 'gs_diff_intermediate', order: 2 }, intermediate: { labelKey: 'gs_diff_intermediate', order: 2 }, average: { labelKey: 'gs_diff_intermediate', order: 2 },
  hard: { labelKey: 'gs_diff_pro', order: 3 }, pro: { labelKey: 'gs_diff_pro', order: 3 }, dificil: { labelKey: 'gs_diff_pro', order: 3 },
  expert: { labelKey: 'gs_diff_expert', order: 4 },
  // Multiplayer results record under their own bucket rather than inheriting
  // whatever AI tier the local setup screen happened to show (Tic Tac Toe, MP
  // phase 1 — see MP_DIFFICULTY in tic-tac-toe/js/ui.js). It is deliberately
  // unmapped in js/difficulty-tiers.js, so tierOf() returns null: these plays
  // count in every total and in the leaderboard's All filter, and claim no
  // tier pill. This row only gives the bucket a real name in the by-difficulty
  // table instead of the raw-key fallback ("Mp").
  mp: { labelKey: 'gs_diff_mp', order: 5 },
  legacy: { labelKey: 'gs_diff_legacy', order: 9 },
};

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// --- Connect 4 --------------------------------------------------------------
function c4Totals(grid) {
  let w = 0, l = 0;
  for (const side of ['player', 'computer']) {
    for (const [d] of C4_DIFFS) {
      const c = (grid && grid[side] && grid[side][d]) || {};
      w += c.w | 0; l += c.l | 0;
    }
  }
  return { w, l, plays: w + l };
}

function c4Table(titleKey, side) {
  const rows = C4_DIFFS.map(([k, labelKey]) => {
    const c = (side && side[k]) || {};
    return `<tr><th scope="row">${t(labelKey)}</th><td>${c.w | 0}</td><td>${c.l | 0}</td></tr>`;
  }).join('');
  return `<h4 class="gs-tbl-h">${t(titleKey)}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_wins')}</th><th scope="col">${t('gs_losses')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function connect4Screen(rec) {
  const grid = rec && rec.grid;
  const totals = c4Totals(grid);
  if (!totals.plays) return emptyState('Connect 4');
  return `
    <div class="gs-tallies">
      <div class="gs-tally"><b>${totals.w}</b><span>${t('gs_wins')}</span></div>
      <div class="gs-tally"><b>${totals.l}</b><span>${t('gs_losses')}</span></div>
      <div class="gs-tally"><b>${totals.plays}</b><span>${t('gs_plays')}</span></div>
    </div>
    ${c4Table('gs_c4_player_first', grid && grid.player)}
    ${c4Table('gs_c4_computer_first', grid && grid.computer)}`;
}

// --- Chinchon ---------------------------------------------------------------
function ccRow(label, n, showPct, finished) {
  const tail = showPct ? ` <em>(${pct(n, finished)}%)</em>` : '';
  return `<div class="gs-cc-row"><span class="gs-cc-k">${label}</span><span class="gs-cc-v">${n}${tail}</span></div>`;
}

function chinchonScreen(rec) {
  const total = (rec && rec.total) || { played: 0, won: 0, lost: 0 };
  const finished = total.played | 0, victories = total.won | 0, defeats = total.lost | 0;
  const draws = Math.max(0, finished - victories - defeats);
  if (!finished) return emptyState('Chinchón');
  const cc = (rec && rec.cc) || { closed: 0, minusTen: 0, chinchons: 0 };
  return `<div class="gs-cc">
    <section class="gs-cc-sec">
      <h4 class="gs-cc-h">${t('gs_cc_games_played')}</h4>
      ${ccRow(t('gs_cc_finished'), finished, false, finished)}
      ${ccRow(t('gs_cc_victories'), victories, true, finished)}
      ${ccRow(t('gs_cc_draws'), draws, true, finished)}
      ${ccRow(t('gs_cc_defeats'), defeats, true, finished)}
    </section>
    <section class="gs-cc-sec">
      <h4 class="gs-cc-h">${t('gs_cc_stats_h')}</h4>
      ${ccRow(t('gs_cc_closed'), cc.closed | 0, false, finished)}
      ${ccRow(t('gs_cc_minus_ten'), cc.minusTen | 0, false, finished)}
      ${ccRow(t('gs_cc_chinchons'), cc.chinchons | 0, false, finished)}
    </section>
  </div>`;
}

// --- Monopoly Deal / Parchis (record vs AI, by difficulty) ------------------
// Both are "win the table vs AI" games: the meaningful stat is the win rate overall and per
// opponent difficulty. Built from total + byDiff (what the classic recorder already tracks).
function diffTable(byDiff) {
  const meta = (k) => DIFF_META[k] || { labelKey: null, order: 8 };
  const keys = Object.keys(byDiff || {}).filter((k) => ((byDiff[k] || {}).played | 0) > 0);
  if (!keys.length) return '';
  keys.sort((a, b) => meta(a).order - meta(b).order);
  const rows = keys.map((k) => {
    const d = byDiff[k]; const w = d.won | 0, l = d.lost | 0, p = d.played | 0;
    const label = meta(k).labelKey ? t(meta(k).labelKey) : titleCase(k);
    return `<tr><th scope="row">${esc(label)}</th><td>${w}-${l}</td><td>${pct(w, p)}%</td></tr>`;
  }).join('');
  return `<h4 class="gs-tbl-h">${t('gs_diff_table_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_col_wl')}</th><th scope="col">${t('gs_win_rate')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function recordScreen(id, rec) {
  const total = (rec && rec.total) || { played: 0, won: 0, lost: 0 };
  const played = total.played | 0, won = total.won | 0, lost = total.lost | 0;
  if (!played) return emptyState(gameLabel(id));
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${won}</b><span>${t('gs_wins')}</span></div>
      <div class="gs-tally"><b>${lost}</b><span>${t('gs_losses')}</span></div>
      <div class="gs-tally"><b>${played}</b><span>${t('gs_plays')}</span></div>
      <div class="gs-tally"><b>${pct(won, played)}%</b><span>${t('gs_win_rate')}</span></div>
    </div>
    ${diffTable(rec && rec.byDiff)}`;
}

/** Spelling Bee (2026-10-28, docs/SPELLING-BEE-INTEGRITY-SPEC.md): the long-term board's numbers for
 *  this person, the same ones the Leaderboard ranks on: points and words found on each puzzle's OWN day,
 *  days finished 1st/2nd/3rd (by points), Genius and Queen Bee days, days played; All, then English and
 *  Español. Until the board has loaded once on this phone: the stats record, as before. */
let _beeWatching = false;
function spellingBeeScreen(rec, code) {
  const me = code || ((loadProfile() || {}).playerId) || '';
  const b = beeBoard();
  if (!_beeWatching) { _beeWatching = true; watchBeeBoard(() => { if (_game === 'spellingbee') rerender(); }); }
  if (!b) return recordScreen('spellingbee', rec);
  const of = (lang) => beeTotals(b, { lang }).find((r) => r.code === me) || null;
  const all = of('all');
  if (!all) return emptyState(gameLabel('spellingbee'));
  const tally = (n, label) => `<div class="gs-tally"><b>${n}</b><span>${esc(label)}</span></div>`;
  const line = (label, r) => r ? `<tr><th scope="row">${esc(label)}</th><td>${r.points}</td><td>${r.words}</td><td>${r.days}</td></tr>` : '';
  return `
    <div class="gs-tallies">
      ${tally(all.points, tf('lb_bee_points', 'Points'))}${tally(all.words, tf('lb_bee_words', 'Words'))}${tally(all.days, '📅')}
    </div>
    <div class="gs-tallies">${tally(all.first, '🥇')}${tally(all.second, '🥈')}${tally(all.third, '🥉')}</div>
    <div class="gs-tallies">${tally(all.genius, '🧠')}${tally(all.queen, '🐝')}</div>
    <table class="gs-tbl"><thead><tr><th></th><th scope="col">${esc(tf('lb_bee_points', 'Points'))}</th><th scope="col">${esc(tf('lb_bee_words', 'Words'))}</th><th scope="col">📅</th></tr></thead>
      <tbody>${line('English', of('en'))}${line('Español', of('es'))}</tbody></table>`;
}

/** Texas Hold'em: the usual wins/losses, plus the BANKROLL ledger (js/game-stats.js,
 *  recordHoldemBank) - the balance it adds up to, the biggest prize, and both sides of the book. */
function holdemScreen(rec) {
  const hb = (rec && rec.hb) || {};
  const hs = (rec && rec.hs) || {};
  const total = (rec && rec.total) || { played: 0, won: 0, lost: 0 };
  if (!(total.played | 0) && !(hb.entries | 0) && !(hb.grants | 0) && !(hs.hands | 0)) return emptyState("Texas Hold'em");
  const money = (n) => '$' + Math.max(0, Math.floor(+n || 0)).toLocaleString();
  // Per-hand stats (2026-09-28, recordHoldemHand): only once some exist, so a history from before
  // they were recorded is not shown as a row of zeros that reads like lost data.
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
  const cards = Array.isArray(hs.bestCards) && hs.bestCards.length === 5
    ? hs.bestCards.map((c) => `<span class="gs-pkc${(c & 3) === 1 || (c & 3) === 2 ? ' is-red' : ''}">${RANKS[c >> 2] || '?'}${SUITS[c & 3]}</span>`).join('') : '';
  const bestName = hs.bestCat >= 0 && hs.bestCat <= 9 ? t('lb_hb_cat_' + hs.bestCat) : '';
  const hands = (hs.hands | 0) ? `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${hs.hands | 0}</b><span>${t('gs_hs_hands')}</span></div>
      <div class="gs-tally"><b>${hs.won | 0}</b><span>${t('gs_hs_won')}</span></div>
      <div class="gs-tally"><b>${money(hs.bigPot)}</b><span>${t('gs_hs_pot')}</span></div>
      <div class="gs-tally"><b>${bestName ? esc(bestName) : '\u2014'}</b><span>${t('gs_hs_best')}</span></div>
    </div>
    ${cards ? `<p class="gs-pkbest">${cards}</p>` : ''}` : '';
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${money(holdemBalance(hb))}</b><span>${t('gs_hb_bank')}</span></div>
      <div class="gs-tally"><b>${money(hb.best)}</b><span>${t('gs_hb_best')}</span></div>
      <div class="gs-tally"><b>${total.won | 0}</b><span>${t('gs_wins')}</span></div>
      <div class="gs-tally"><b>${total.played | 0}</b><span>${t('gs_plays')}</span></div>
    </div>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${money(hb.winnings)}</b><span>${t('gs_hb_won')}</span></div>
      <div class="gs-tally"><b>${money(hb.buyins)}</b><span>${t('gs_hb_paid')}</span></div>
      <div class="gs-tally"><b>${hb.cashes | 0}</b><span>${t('gs_hb_cashes')}</span></div>
    </div>
    ${hands}
    ${diffTable(rec && rec.byDiff)}`;
}

function emptyState(label) { return `<p class="gs-none">${t('gs_empty', { label: esc(label) })}</p>`; }

/** Nuts & Bolts: a solo puzzle, so no wins/losses/win-rate (you cannot lose, only keep going).
 *  Levels solved, how far you got, and the moves it took are the honest numbers. */
function nutsBoltsScreen(rec) {
  const nb = (rec && rec.nb) || {};
  const solved = nb.solved | 0, moves = nb.moves | 0, best = nb.bestLevel | 0;
  if (!solved) return emptyState('Nuts & Bolts');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${solved}</b><span>${t('gs_nb_solved')}</span></div>
      <div class="gs-tally"><b>${best}</b><span>${t('gs_nb_best')}</span></div>
      <div class="gs-tally"><b>${moves}</b><span>${t('gs_nb_moves')}</span></div>
      <div class="gs-tally"><b>${Math.round(moves / solved)}</b><span>${t('gs_nb_avg_moves')}</span></div>
    </div>`;
}

const SD_DIFFS = [['easy', 'gs_diff_easy'], ['medium', 'gs_diff_medium'], ['hard', 'gs_diff_hard'], ['expert', 'gs_diff_expert']];

/** Sudoku: a solo puzzle like Nuts & Bolts, so no wins/losses/win-rate. Four lifetime
 *  tallies (solved, perfect, hints, mistakes) plus a per-tier table of solved count and best
 *  time. `bestTimeMs` is 0's "never set" sentinel, shown as an em dash rather than "0:00" —
 *  the same zero-glyph convention `skNum()` uses elsewhere on this screen. */
function sudokuScreen(rec) {
  const sd = (rec && rec.sd) || {};
  const solved = sd.solved | 0;
  if (!solved) return emptyState('Sudoku');
  const byDiff = rec.byDiff || {};
  const bestTimeMs = sd.bestTimeMs || {};
  const rows = SD_DIFFS.map(([k, labelKey]) => {
    const tierSolved = ((byDiff[k] || {}).won) | 0;
    const best = bestTimeMs[k] | 0;
    const bestStr = best > 0 ? fmtMmSs(best) : '&mdash;';
    return `<tr><th scope="row">${t(labelKey)}</th><td>${tierSolved}</td><td>${bestStr}</td></tr>`;
  }).join('');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${solved}</b><span>${t('gs_sd_solved')}</span></div>
      <div class="gs-tally"><b>${sd.perfect | 0}</b><span>${t('gs_sd_perfect')}</span></div>
      <div class="gs-tally"><b>${sd.hints | 0}</b><span>${t('gs_sd_hints')}</span></div>
      <div class="gs-tally"><b>${sd.mistakes | 0}</b><span>${t('gs_sd_mistakes')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_diff_table_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_pi_solved')}</th><th scope="col">${t('gs_sd_best_time')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Murdoku: a solo puzzle recorded through recordResult (total/byDiff only, no sub-counter), one
 *  play per SOLVED case. Solved in total, then solved per difficulty. Way Out records the same
 *  shape (one play per level cleared) and shares this screen; `titleKey` names the game. */
function murdokuScreen(rec, titleKey = 'game_title_murdoku') {
  const solved = ((rec && rec.total) || {}).won | 0;
  if (!solved) return emptyState(t(titleKey));
  const byDiff = rec.byDiff || {};
  const rows = SD_DIFFS.map(([k, labelKey]) => `<tr><th scope="row">${t(labelKey)}</th><td>${((byDiff[k] || {}).won) | 0}</td></tr>`).join('');
  return `
    <div class="gs-tallies">
      <div class="gs-tally"><b>${solved}</b><span>${t('gs_mk_solved')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_diff_table_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_pi_solved')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Arrow Maze: points (the ladder, 2026-10-14) and levels solved, plus how many of them were timed,
 *  per difficulty. */
function wayoutScreen(rec) {
  const solved = ((rec && rec.total) || {}).won | 0;
  const rush = (((rec && rec.wo) || {}).rush) || null;
  const rushRuns = (m) => woRushRuns(((rush || {}).runs || {})[m]).length;
  const hasRush = RUSH_MODES.some((m) => rushRuns(m) > 0);
  if (!solved && !hasRush) return emptyState(t('game_title_wayout'));
  // Rush (2026-10-14): its own table, this week's best and the best week per version, and how many
  // runs (a run lost by leaving is a run too).
  const rushTable = !hasRush ? '' : `
    <h4 class="gs-tbl-h">${t('gs_wo_rush_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_wo_rush_week')}</th><th scope="col">${t('gs_wo_rush_best')}</th><th scope="col">${t('gs_wo_rush_runs')}</th></tr></thead>
      <tbody>${RUSH_MODES.map((m) => {
        const wk = woRushBest(rec, m), all = Object.values(woRushBestMap(((rush || {}).best || {})[m]));
        return `<tr><th scope="row">${t(m === 'hard' ? 'gs_diff_hard' : 'gs_diff_easy')}</th><td>${wk == null ? '-' : wk}</td><td>${all.length ? Math.max(...all) : '-'}</td><td>${rushRuns(m)}</td></tr>`;
      }).join('')}</tbody>
    </table>`;
  const byDiff = rec.byDiff || {};
  const timed = ((rec && rec.wo) || {}).timed || {};
  const rows = SD_DIFFS.map(([k, labelKey]) =>
    `<tr><th scope="row">${t(labelKey)}</th><td>${((byDiff[k] || {}).won) | 0}</td><td>${woPoints(rec, k)}</td><td>${timed[k] | 0}</td></tr>`).join('');
  return `
    <div class="gs-tallies">
      <div class="gs-tally"><b>${woPoints(rec)}</b><span>${t('lb_unit_points')}</span></div>
      <div class="gs-tally"><b>${solved}</b><span>${t('lb_tex_wo_cleared')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_diff_table_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_wo_cleared')}</th><th scope="col">${t('lb_sort_points')}</th><th scope="col">${t('gs_wo_timed')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${rushTable}`;
}

/** Word Weaver (2026-10-28; bands and points 2026-10-29): points (stars x the band's 1/2/3/4), levels
 *  completed, stars, three-star levels and extra words found, then the same per band (Easy 1-500 ...
 *  Expert 1501+). Every level number comes from the per-level map (js/word-weaver-points.js), so a
 *  level finished on two phones counts once and a level finished before the bands shows under its
 *  band; total.won (one per first completion) gates the empty state too. New keys fall back to
 *  English for the one visit js/strings.js may be older than this file. */
function wordWeaverScreen(rec) {
  const ww = (rec && rec.ww) || {};
  const done = ((rec && rec.total) || {}).won | 0;
  if (!done && !Object.keys(ww.lv || {}).length && !Object.keys(ww.es || {}).length && !wwExtra(rec) && !wwDailyCount(rec)) return emptyState(tf('game_title_wordweaver', 'Word Weaver'));
  const rows = SD_DIFFS.filter(([k]) => WW_TIERS.includes(k)).map(([k, labelKey]) =>
    `<tr><th scope="row">${t(labelKey)}</th><td>${wwCleared(rec, k)}</td><td>${wwStars(rec, k)}</td><td>${wwPoints(rec, k)}</td><td>${wwThreeStars(rec, k)}</td></tr>`).join('');
  return `
    <div class="gs-tallies">
      <div class="gs-tally"><b>${wwPoints(rec)}</b><span>${t('lb_unit_points')}</span></div>
      <div class="gs-tally"><b>${wwCleared(rec)}</b><span>${tf('lb_tex_ww_cleared', 'Levels completed')}</span></div>
      <div class="gs-tally"><b>${wwDailyCount(rec)}</b><span>${tf('gs_ww_daily', 'Daily puzzles')}</span></div>
    </div>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${wwStars(rec)}</b><span>${tf('lb_unit_stars', 'stars')}</span></div>
      <div class="gs-tally"><b>${wwThreeStars(rec)}</b><span>${t('gs_gl_three')}</span></div>
      <div class="gs-tally"><b>${wwExtra(rec)}</b><span>${tf('gs_ww_extra', 'Extra words')}</span></div>
    </div>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${wwCollected(rec)}</b><span>${tf('lb_tex_ww_bonus', 'Bonus stars collected')}</span></div>
      <div class="gs-tally"><b>${wwSpent(rec)}</b><span>${tf('lb_tex_ww_spent', 'Bonus stars spent')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_diff_table_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_wo_cleared')}</th><th scope="col">${tf('lb_sort_stars', 'Stars')}</th><th scope="col">${t('lb_sort_points')}</th><th scope="col">${t('gs_gl_three')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Gridlock (2026-10-14): points, distinct levels cleared, three-star and no-hint levels, per
 *  difficulty. Every number comes from the per-level map (js/gridlock-points.js), so a replay is
 *  never counted twice; total.won (every solve, replays included) gates the empty state. */
function gridlockScreen(rec) {
  const solved = ((rec && rec.total) || {}).won | 0;
  const gl = (rec && rec.gl) || {};
  if (!solved && !Object.keys(gl.lv || {}).length) return emptyState(t('game_title_gridlock'));
  const rows = SD_DIFFS.filter(([k]) => GL_TIERS.includes(k)).map(([k, labelKey]) =>
    `<tr><th scope="row">${t(labelKey)}</th><td>${glCleared(rec, k)}</td><td>${glPoints(rec, k)}</td><td>${glThreeStars(rec, k)}</td></tr>`).join('');
  return `
    <div class="gs-tallies">
      <div class="gs-tally"><b>${glPoints(rec)}</b><span>${t('lb_unit_points')}</span></div>
      <div class="gs-tally"><b>${glCleared(rec)}</b><span>${t('lb_tex_gl_cleared')}</span></div>
    </div>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${glThreeStars(rec)}</b><span>${t('gs_gl_three')}</span></div>
      <div class="gs-tally"><b>${glNoHint(rec)}</b><span>${t('gs_gl_nohint')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_diff_table_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_wo_cleared')}</th><th scope="col">${t('lb_sort_points')}</th><th scope="col">${t('gs_gl_three')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Contexto: one finished puzzle per play; a give-up is a loss. Average guesses is computed here
 *  from two stored sums (guesses over SOLVED puzzles / solved), never stored itself. `fewest` is
 *  0's "never set" sentinel, shown as a dash. The table splits plays by word set (English /
 *  Spanish), which is what byDiff is keyed by for this game. */
function contextoScreen(rec) {
  const ct = (rec && rec.ct) || {};
  const played = ((rec && rec.total) || {}).played | 0;
  if (!played) return emptyState('Contexto');
  const solved = ct.solved | 0;
  const avg = solved > 0 ? (Math.round(((ct.guesses | 0) / solved) * 10) / 10).toString() : '&mdash;';
  const byDiff = rec.byDiff || {};
  const rows = [['en', 'gs_ct_lang_en'], ['es', 'gs_ct_lang_es']].map(([k, labelKey]) => {
    const b = byDiff[k] || {};
    return `<tr><th scope="row">${t(labelKey)}</th><td>${b.played | 0}</td><td>${b.won | 0}</td></tr>`;
  }).join('');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>&#x1F947; ${ct.noHint | 0}</b><span>${t('gs_ct_nohint')}</span></div>
      <div class="gs-tally"><b>&#x1F948; ${ct.silver | 0}</b><span>${t('gs_ct_silver')}</span></div>
      <div class="gs-tally"><b>&#x1F949; ${ct.bronze | 0}</b><span>${t('gs_ct_bronze')}</span></div>
      <div class="gs-tally"><b>${Math.max(0, solved - (ct.noHint | 0) - (ct.silver | 0) - (ct.bronze | 0))}</b><span>${t('gs_ct_nomedal')}</span></div>
    </div>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${solved}</b><span>${t('gs_ct_solved')}</span></div>
      <div class="gs-tally"><b>${avg}</b><span>${t('gs_ct_avg')}</span></div>
      <div class="gs-tally"><b>${(ct.fewestNH | 0) > 0 ? ct.fewestNH | 0 : '&mdash;'}</b><span>${t('gs_ct_fewest')}</span></div>
    </div>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_ms_played')}</th><th scope="col">${t('gs_ct_solved')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

const MS_LEVELS_UI = [['easy', 'gs_diff_easy'], ['medium', 'gs_diff_medium'], ['hard', 'gs_diff_hard'], ['expert', 'gs_diff_expert']];

/** Minesweeper: a solo puzzle with a real loss state, so unlike Sudoku it DOES show a win/loss
 *  record. Four lifetime tallies plus a per-level table of played, cleared and best time.
 *
 *  `bestTimeMs` uses 0 as its "never set" sentinel and is shown as an em dash rather than "0:00",
 *  the same zero-glyph convention as the Sudoku screen above. A level you have played but never
 *  cleared shows its plays and a dash, which is the honest reading: the plays happened. */
function minesweeperScreen(rec) {
  const ms = (rec && rec.ms) || {};
  const tot = (rec && rec.total) || {};
  const played = tot.played | 0;
  if (!played) return emptyState('Minesweeper');
  const cleared = ms.cleared | 0;
  const byDiff = rec.byDiff || {};
  const bestTimeMs = ms.bestTimeMs || {};
  const rate = played > 0 ? Math.round((cleared / played) * 100) : 0;
  const rows = MS_LEVELS_UI.map(([k, labelKey]) => {
    const b = byDiff[k] || {};
    const best = bestTimeMs[k] | 0;
    // Never cleared: the closest it got, as a % of the board (2026-10-15), else a dash.
    const pct = ((ms.bestClearedPct || {})[k] | 0);
    const cell = best > 0 ? fmtMmSs(best) : pct > 0 ? `${pct}%` : '&mdash;';
    return `<tr><th scope="row">${t(labelKey)}</th><td>${b.played | 0}</td><td>${b.won | 0}</td><td>${cell}</td></tr>`;
  }).join('');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${played}</b><span>${t('gs_ms_played')}</span></div>
      <div class="gs-tally"><b>${cleared}</b><span>${t('gs_ms_cleared')}</span></div>
      <div class="gs-tally"><b>${rate}%</b><span>${t('gs_ms_rate')}</span></div>
      <div class="gs-tally"><b>${ms.flagsRight | 0}</b><span>${t('gs_ms_flags')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_diff_table_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_ms_played')}</th><th scope="col">${t('gs_ms_cleared')}</th><th scope="col">${t('gs_ms_best_time')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function fmtMmSs(ms) {
  const total = Math.max(0, Math.floor((ms | 0) / 1000));
  const m = Math.floor(total / 60), s2 = total % 60;
  return `${m}:${String(s2).padStart(2, '0')}`;
}

/** Escoba: the standard record-vs-AI screen, the escoba counter, and multiplayer on its own.
 *
 *  The MULTIPLAYER block is its own row of tallies rather than one line in the by-difficulty
 *  table below, because online play is not a difficulty and reading it as one is exactly the
 *  mistake that made these plays invisible in the first place: they were filed under the AI's
 *  `'normal'` tier and could not be told apart from it. It reads `byDiff.mp`, which is the single
 *  stored source for both new online matches and the historical ones `splitEscobaMp`
 *  (js/game-stats.js) moved back out of the AI bucket, so this panel and that table can never
 *  disagree. Hidden entirely when there are no online plays -- a solo-only player is not shown a
 *  row of zeroes. */
function escobaMpBlock(rec) {
  const mp = ((rec && rec.byDiff) || {}).mp;
  const played = (mp && mp.played) | 0;
  if (!played) return '';
  const won = (mp && mp.won) | 0, lost = (mp && mp.lost) | 0;
  return `
    <h4 class="gs-tbl-h">${t('gs_diff_mp')}</h4>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${won}</b><span>${t('gs_wins')}</span></div>
      <div class="gs-tally"><b>${lost}</b><span>${t('gs_losses')}</span></div>
      <div class="gs-tally"><b>${played}</b><span>${t('gs_plays')}</span></div>
      <div class="gs-tally"><b>${pct(won, played)}%</b><span>${t('gs_win_rate')}</span></div>
    </div>`;
}

function escobaScreen(rec) {
  const total = (rec && rec.total) || { played: 0 };
  if (!(total.played | 0)) return emptyState('Escoba');
  const es = (rec && rec.es) || {};
  return recordScreen('escoba', rec) + escobaMpBlock(rec) + `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${es.escobas | 0}</b><span>${t('gs_es_escobas')}</span></div>
    </div>`;
}

// --- Ball Run (solo, difficulty-scaled, obstacles-passed-is-the-score) ------
const BR_DIFFS = [['easy', 'gs_diff_easy'], ['medium', 'gs_diff_medium'], ['hard', 'gs_diff_hard']];

/** One map's best-by-difficulty table (`br` for Classic, `brOrbital` for Orbital). */
function brMapTable(bucket, headingKey) {
  const bd = (bucket && bucket.bestObstaclesByDiff) || {};
  const rows = BR_DIFFS.map(([k, labelKey]) =>
    `<tr><th scope="row">${t(labelKey)}</th><td>${t('gs_br_obstacles_cell', { n: bd[k] | 0 })}</td></tr>`).join('');
  return `
    <h4 class="gs-tbl-h">${t(headingKey)}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_best')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Ball Run: no wins/losses (only a crash or a fall ends a run), so the honest numbers are runs
 *  played and the best obstacle count reached, overall and per difficulty (fourth-playthrough item
 *  2: the score is obstacle rows passed, not meters). BALLRUNMAP2ORBITALSPEC.md Phase 1: `br` is
 *  Classic's bucket (untouched, same shape it always had), `brOrbital` is the new second map's own
 *  sibling bucket - both are shown, runs/best combine across maps for the headline tallies (a
 *  player's total Ball Run history, not just one map's), and per-difficulty tables are broken out
 *  per map since a map's own best is not the same achievement as another map's. */
function ballRunScreen(rec) {
  const br = (rec && rec.br) || {};
  const brOrbital = (rec && rec.brOrbital) || {};
  const legacy = (rec && rec.brLegacyMeters) || null;
  const runs = (br.runs | 0) + (brOrbital.runs | 0);
  const best = Math.max(br.bestObstacles | 0, brOrbital.bestObstacles | 0);
  // A device with only pre-metric-change history still has runs (refolded from the archive in
  // game-stats.js), so the empty state genuinely means "never played", not "played before the
  // scoring change" - sixth-playthrough incident, where zeroed runs hid real history. A player who
  // has only ever played Orbital must not read as empty either - their history lives in
  // brOrbital.runs, not br.runs.
  if (!runs && !legacy) return emptyState('Ball Run');
  // Scores from before the scoring change are meters, not obstacle counts - the units are not
  // comparable, so they are shown as their own clearly-labeled record instead of being converted
  // (which would fabricate numbers) or hidden (which reads as deleted data).
  const lbd = (legacy && legacy.bestByDiff) || {};
  const legacyRows = legacy ? BR_DIFFS.map(([k, labelKey]) =>
    `<tr><th scope="row">${t(labelKey)}</th><td>${lbd[k] | 0} m</td></tr>`).join('') : '';
  const legacyHtml = legacy ? `
    <h4 class="gs-tbl-h">${t('gs_br_legacy_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_best')}</th></tr></thead>
      <tbody>${legacyRows}</tbody>
    </table>` : '';
  // Orbital's table only renders once the player has actually recorded a run there - an
  // all-zero table for a map nobody has tried yet would just be clutter, not hidden history.
  const orbitalHtml = brOrbital.runs ? brMapTable(brOrbital, 'gs_br_best_by_diff_orbital') : '';
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${runs}</b><span>${t('gs_runs')}</span></div>
      <div class="gs-tally"><b>${best}</b><span>${t('gs_br_best')}</span></div>
    </div>
    ${brMapTable(br, orbitalHtml ? 'gs_br_best_by_diff_classic' : 'gs_br_best_by_diff')}
    ${orbitalHtml}${legacyHtml}`;
}

// --- Tic Tac Toe (played by variant, ties shown explicitly) -----------------
function ttVariantTallies(labelKey, v) {
  return `<h4 class="gs-tbl-h">${t(labelKey)}</h4>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${v.won | 0}</b><span>${t('gs_won')}</span></div>
      <div class="gs-tally"><b>${v.lost | 0}</b><span>${t('gs_lost')}</span></div>
      <div class="gs-tally"><b>${v.tied | 0}</b><span>${t('gs_tied')}</span></div>
      <div class="gs-tally"><b>${v.played | 0}</b><span>${t('gs_played')}</span></div>
    </div>`;
}

/** Draw-heavy by design (Pro Classic is an unbeatable solved game -- see
 *  tic-tac-toe/js/ai.js's comment on it), so ties are shown explicitly per
 *  variant here rather than folded into a derived number. THE LAW rule 1: a
 *  screen that hides the most common outcome reads as deleted data to the
 *  player, and a tie is the single most common outcome this game produces. */
function ticTacToeScreen(rec) {
  const total = (rec && rec.total) || { played: 0 };
  if (!(total.played | 0)) return emptyState('Tic Tac Toe');
  const tt = (rec && rec.tt) || {};
  const classic = tt.classic || { played: 0, won: 0, lost: 0, tied: 0 };
  const ultimate = tt.ultimate || { played: 0, won: 0, lost: 0, tied: 0 };
  return ttVariantTallies('gs_tt_classic', classic) + ttVariantTallies('gs_tt_ultimate', ultimate);
}

/** Dots and Boxes: Won/Lost/Tied shown explicitly (Medium/4x4 can end 8-8, same
 *  reasoning as ticTacToeScreen above), plus the human's cumulative boxes claimed
 *  and longest single-turn chain -- never folded away, per THE LAW rule 1. */
function dotsBoxesScreen(rec) {
  const db = (rec && rec.db) || { played: 0, won: 0, lost: 0, tied: 0, boxes: 0, bestChain: 0 };
  if (!(db.played | 0)) return emptyState('Dots and Boxes');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${db.won | 0}</b><span>${t('gs_won')}</span></div>
      <div class="gs-tally"><b>${db.lost | 0}</b><span>${t('gs_lost')}</span></div>
      <div class="gs-tally"><b>${db.tied | 0}</b><span>${t('gs_tied')}</span></div>
      <div class="gs-tally"><b>${db.played | 0}</b><span>${t('gs_played')}</span></div>
    </div>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${db.boxes | 0}</b><span>${t('gs_db_boxes')}</span></div>
      <div class="gs-tally"><b>${db.bestChain | 0}</b><span>${t('gs_db_chain')}</span></div>
    </div>`;
}

/** Boggle: the standard record-vs-AI screen (recordScreen gives Won/Lost/
 *  Played/Win rate + the by-difficulty table) plus Tied shown explicitly
 *  (a round is scored against the AI's own found-word total, so it CAN tie,
 *  same reasoning as dotsBoxesScreen/ticTacToeScreen above) and the human's
 *  cumulative words found, best score, and longest word ever -- the
 *  longest word is shown by name, not just its length, since it's the most
 *  personal stat in the game and folding it away would read as deleted data
 *  per THE LAW rule 1. */
function boggleScreen(rec) {
  const total = (rec && rec.total) || { played: 0 };
  if (!(total.played | 0)) return emptyState('Boggle');
  const bg = (rec && rec.bg) || { tied: 0, words: 0, bestScore: 0, longestWord: { word: '', len: 0 } };
  const lw = bg.longestWord || { word: '', len: 0 };
  const longestDisplay = lw.word ? `${lw.word} (${lw.len | 0})` : '—';
  return recordScreen('boggle', rec) + `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${bg.tied | 0}</b><span>${t('gs_tied')}</span></div>
      <div class="gs-tally"><b>${bg.bestScore | 0}</b><span>${t('gs_bg_best_score')}</span></div>
      <div class="gs-tally"><b>${bg.words | 0}</b><span>${t('gs_bg_words')}</span></div>
      <div class="gs-tally"><b>${esc(longestDisplay)}</b><span>${t('gs_bg_longest')}</span></div>
    </div>`;
}

/** Yahtzee: Won/Lost/Tied/Played shown explicitly (a 13-round match is scored against an
 *  opponent's total, so it CAN tie, same reasoning as dotsBoxesScreen/boggleScreen/
 *  ticTacToeScreen above), plus the human's cumulative Yahtzee count and best single-game
 *  total ever reached -- never folded away, per THE LAW rule 1. */
function yahtzeeScreen(rec) {
  const yz = (rec && rec.yz) || { played: 0, won: 0, lost: 0, tied: 0, yahtzees: 0, bestScore: 0 };
  if (!(yz.played | 0)) return emptyState('Yahtzee');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${yz.won | 0}</b><span>${t('gs_won')}</span></div>
      <div class="gs-tally"><b>${yz.lost | 0}</b><span>${t('gs_lost')}</span></div>
      <div class="gs-tally"><b>${yz.tied | 0}</b><span>${t('gs_tied')}</span></div>
      <div class="gs-tally"><b>${yz.played | 0}</b><span>${t('gs_played')}</span></div>
    </div>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${yz.yahtzees | 0}</b><span>${t('gs_yz_yahtzees')}</span></div>
      <div class="gs-tally"><b>${yz.bestScore | 0}</b><span>${t('gs_yz_best')}</span></div>
    </div>`;
}

/** Dominoes: Won/Lost/Tied/Played shown explicitly (both players score the opponent's leftovers
 *  at every round end, so both totals can pass the target in the same settle and land equal --
 *  see ensureDm in js/game-stats.js), plus the human's cumulative rounds and points and their
 *  best single round, never folded away, per THE LAW rule 1. */
function dominoesScreen(rec) {
  const dm = (rec && rec.dm) || { played: 0, won: 0, lost: 0, tied: 0, rounds: 0, bestRound: 0, points: 0 };
  if (!(dm.played | 0)) return emptyState('Dominoes');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${dm.won | 0}</b><span>${t('gs_won')}</span></div>
      <div class="gs-tally"><b>${dm.lost | 0}</b><span>${t('gs_lost')}</span></div>
      <div class="gs-tally"><b>${dm.tied | 0}</b><span>${t('gs_tied')}</span></div>
      <div class="gs-tally"><b>${dm.played | 0}</b><span>${t('gs_played')}</span></div>
    </div>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${dm.rounds | 0}</b><span>${t('gs_dm_rounds')}</span></div>
      <div class="gs-tally"><b>${dm.bestRound | 0}</b><span>${t('gs_dm_best_round')}</span></div>
      <div class="gs-tally"><b>${dm.points | 0}</b><span>${t('gs_dm_points')}</span></div>
    </div>`;
}

// --- Snake (solo, speed-tiered, longest-snake-is-the-score) -----------------
const SN_DIFFS = [['easy', 'gs_diff_easy'], ['medium', 'gs_diff_medium'], ['hard', 'gs_diff_hard']];

/** Snake: no wins/losses (a run ends in a crash), so the honest numbers are runs played and the
 *  longest snake reached, overall and per speed tier — Ball Run's screen shape. The walls-mode
 *  split (2026-07-28) adds a second per-diff table: Walls off is easier (no wall death), so a
 *  combined table would let it bury every Walls on best under an easier ruleset's scores. Both
 *  tables read the split fields ensureSn() guarantees exist (seeded once from the legacy combined
 *  fields, which stay the overall numbers in the tallies row above — nothing here can regress
 *  those). */
function snakeScreen(rec) {
  const sn = (rec && rec.sn) || {};
  const runs = sn.runs | 0, best = sn.bestLen | 0;
  if (!runs) return emptyState('Snake');
  const bdw = sn.bestLenByDiffWalls || { on: {}, off: {} };
  const wallsTable = (walls, labelKey) => {
    const bd = bdw[walls] || {};
    const rows = SN_DIFFS.map(([k, dLabelKey]) =>
      `<tr><th scope="row">${t(dLabelKey)}</th><td>${bd[k] | 0}</td></tr>`).join('');
    return `
    <h4 class="gs-tbl-h">${t(labelKey)}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_best')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  };
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${runs}</b><span>${t('gs_runs')}</span></div>
      <div class="gs-tally"><b>${best}</b><span>${t('gs_sn_longest')}</span></div>
    </div>
    ${wallsTable('off', 'gs_sn_walls_off')}
    ${wallsTable('on', 'gs_sn_walls_on')}`;
}

// --- Hill Climb (solo, stage-tiered, furthest-distance-is-the-score) --------
const HC_STAGES = [
  ['countryside', 'gs_hc_countryside'], ['desert', 'gs_hc_desert'],
  ['arctic', 'gs_hc_arctic'], ['moon', 'gs_hc_moon'],
];

/** Hill Climb: no wins or losses (a run ends in a crash or an empty tank), so the honest numbers
 *  are runs driven and the furthest distance, overall and per stage — Ball Run's and Snake's screen
 *  shape. Lifetime coins and flips get their own tallies because they are the other two things the
 *  game actually accumulates, and neither is derivable from distance. The spendable coin wallet is
 *  deliberately NOT shown here: it lives in the game's own save and can go down, so it is not
 *  history (see game-stats.js's `hc` block). */
function hillClimbScreen(rec) {
  const hc = (rec && rec.hc) || {};
  const runs = hc.runs | 0;
  if (!runs) return emptyState('Hill Climb');
  const bs = hc.bestDistanceByStage || {};
  const rows = HC_STAGES.map(([k, labelKey]) =>
    `<tr><th scope="row">${t(labelKey)}</th><td>${bs[k] | 0}</td></tr>`).join('');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${runs}</b><span>${t('gs_runs')}</span></div>
      <div class="gs-tally"><b>${hc.bestDistance | 0}</b><span>${t('gs_hc_furthest')}</span></div>
      <div class="gs-tally"><b>${hc.coins | 0}</b><span>${t('gs_hc_coins')}</span></div>
      <div class="gs-tally"><b>${hc.flips | 0}</b><span>${t('gs_hc_flips')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_hc_by_stage')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_best')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// --- Battleship (W/L, shots/hit-rate/ships sunk, fewest-shots win) ----------

/** Battleship: the standard record-vs-AI screen (Won/Lost/Played/Win rate + by-difficulty table)
 *  plus shots fired, hit rate, ships sunk, and fewest shots to win — never folded away, per THE
 *  LAW rule 1. No Tied tile: this game cannot draw (js/game-stats.js's ensureBs comment).
 *  `fewestShotsWin` is 0 until the first win is recorded (an unset sentinel, not a real "won in
 *  zero shots" — js/game-stats.js), shown as an em dash rather than a misleading 0. */
function battleshipScreen(rec) {
  const bs = (rec && rec.bs) || { played: 0, won: 0, lost: 0, shots: 0, hits: 0, sunk: 0, bestAccuracy: 0, fewestShotsWin: 0 };
  if (!(bs.played | 0)) return emptyState('Battleship');
  const hitRate = bs.shots > 0 ? Math.round((bs.hits / bs.shots) * 100) : 0;
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${bs.won | 0}</b><span>${t('gs_bs_wins')}</span></div>
      <div class="gs-tally"><b>${bs.lost | 0}</b><span>${t('gs_bs_losses')}</span></div>
      <div class="gs-tally"><b>${bs.played | 0}</b><span>${t('gs_played')}</span></div>
      <div class="gs-tally"><b>${pct(bs.won | 0, bs.played | 0)}%</b><span>${t('gs_win_rate')}</span></div>
    </div>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${bs.shots | 0}</b><span>${t('gs_bs_shots')}</span></div>
      <div class="gs-tally"><b>${hitRate}%</b><span>${t('gs_bs_hit_rate')}</span></div>
      <div class="gs-tally"><b>${bs.sunk | 0}</b><span>${t('gs_bs_ships_sunk')}</span></div>
      <div class="gs-tally"><b>${bs.fewestShotsWin ? (bs.fewestShotsWin | 0) : t('gs_bs_no_wins_yet')}</b><span>${t('gs_bs_fewest_shots')}</span></div>
    </div>
    ${diffTable(rec && rec.byDiff)}`;
}

// Course id -> display name, hand-maintained like SK_MACHINES below (this file stays out of
// golf/'s own folder, same reason SK_MACHINES doesn't import skeeball/'s board list; a second,
// deliberate copy carrying each course's PAR lives in js/leaderboard-rank.js). Pine Valley's
// name is identical in both languages, so no i18n needed; an unknown id falls back to its own
// id in caps rather than disappearing a player's history (THE LAW rule 1), same fallback shape
// as skMachineMeta below.
//
// The hole count is IN the name because a 3-hole best and a 9-hole best are not comparable and
// are stored under separate keys (THE LAW rule 4). When holes 4-9 ship, 'pinevalley9' becomes a
// SECOND row here and both are listed; 'pinevalley3' is never repurposed (rule 5).
//
// `harbor` is deliberately absent. Harbor Links is gone from the product, its stored keys are
// never written and never read again, and no device has a Harbor record to render - the caps
// fallback covers the impossible case without naming a course that no longer exists.
// The bestRoundByCourse keys, named for a person. A key with no entry here still SHOWS (rule 1) -
// `golfCourseName` upper-cases it rather than hiding the row - but it shows as gibberish, so a new
// round key belongs here the day it ships. These are `<course.id><suffix>` (golf/js/rounds.js).
const GOLF_COURSES = {
  pinevalley3: 'Pine Valley (holes 1-3)',
  pinevalley3b: 'Pine Valley (holes 4-6)',
  pinevalley3c: 'Pine Valley (holes 7-9)',
  pinevalley3d: 'Pine Valley (holes 10-12)',
  pinevalley3e: 'Pine Valley (holes 13-15)',
  pinevalley3f: 'Pine Valley (holes 16-18)',
  pinevalley9: 'Pine Valley (front 9)',
  pinevalley9b: 'Pine Valley (back 9)',
  pinevalley18: 'Pine Valley (18 holes)',
  redmesa3: 'Red Mesa (holes 1-3)',
  redmesa3b: 'Red Mesa (holes 4-6)',
  redmesa3c: 'Red Mesa (holes 7-9)',
  redmesa3d: 'Red Mesa (holes 10-12)',
  redmesa3e: 'Red Mesa (holes 13-15)',
  redmesa3f: 'Red Mesa (holes 16-18)',
  redmesa9: 'Red Mesa (front 9)',
  redmesa9b: 'Red Mesa (back 9)',
  redmesa18: 'Red Mesa (18 holes)',
  tutorial: 'Tutorial',
  // Oasis Sands has NINE holes, so it offers three three-hole sets and one nine - there is no back
  // nine and no eighteen, and golf/js/rounds.js's `roundsFor` is what stops those being offered.
  // These four shipped with the course and were not added here (2026-09-07), so a stored best read
  // as "OASISSANDS3" on My Stats through the caps fallback below - which is exactly the failure
  // this block's own comment warns about.
  oasissands3: 'Oasis Sands (holes 1-3)',
  oasissands3b: 'Oasis Sands (holes 4-6)',
  oasissands3c: 'Oasis Sands (holes 7-9)',
  oasissands9: 'Oasis Sands (all 9)',
  coralcove3: 'Coral Cove (holes 1-3)',
  coralcove3b: 'Coral Cove (holes 4-6)',
  coralcove3c: 'Coral Cove (holes 7-9)',
  coralcove9: 'Coral Cove (all 9)',
  // Coral Cove above was retired the same day it shipped (admin only); its names stay so any round
  // recorded on it still reads. Coral Keys replaced it.
  coralkeys3: 'Coral Keys (holes 1-3)',
  coralkeys3b: 'Coral Keys (holes 4-6)',
  coralkeys3c: 'Coral Keys (holes 7-9)',
  coralkeys9: 'Coral Keys (all 9)',
  pinevalley: 'Pine Valley',
  redmesa: 'Red Mesa',
  oasissands: 'Oasis Sands',
  coralcove: 'Coral Cove',
  coralkeys: 'Coral Keys',
};
function golfCourseName(id) { return GOLF_COURSES[id] || String(id).toUpperCase(); }

/** A GOLF ORDER, NOT AN ALPHABETICAL ONE (2026-09-10). Matt, on his own Best rounds table: holes
 *  10-12 sat above holes 4-6, because the rows were sorted by their DISPLAY NAME and "10" sorts
 *  before "4". A scorecard reads longest first and then in hole order, so that is what this does:
 *  course by name, then 18, front 9, back 9, then each three-hole set from the first tee to the
 *  last. A key this cannot parse keeps its row (rule 1) and lands at the end of its course. */
const GOLF_ROUND_RANK = { '18': 0, '9': 1, '9b': 2, '3': 3, '3b': 4, '3c': 5, '3d': 6, '3e': 7, '3f': 8 };
function golfRoundParts(id) {
  const m = /^([a-z]+?)(18|9b|9|3[b-f]?)$/.exec(String(id));
  if (!m) return { course: String(id), rank: 99 };
  const rank = GOLF_ROUND_RANK[m[2]];
  return { course: m[1], rank: Number.isFinite(rank) ? rank : 99 };
}
function compareGolfRounds(a, b) {
  const pa = golfRoundParts(a);
  const pb = golfRoundParts(b);
  const na = GOLF_COURSES[pa.course] || pa.course;
  const nb = GOLF_COURSES[pb.course] || pb.course;
  return na.localeCompare(nb) || (pa.rank - pb.rank) || String(a).localeCompare(String(b));
}

/** HOW MANY HOLES A COURSE HAS, for the per-hole record row. Not derived from the records: a hole
 *  nobody has played yet has to show as an empty slot, which is the whole point of the row. An id
 *  with no entry gets 18, the shape every course had when this row was written.
 *
 *  Oasis Sands is the first course with fewer, and without this its row drew EIGHTEEN cells with
 *  nine permanent dashes for holes that do not exist. */
// THE TUTORIAL IS A ONE-HOLE COURSE. Finishing it writes `gf.bestHole['tutorial:1']` through the
// ordinary per-hole path, and golf/js/progress.js reads exactly that key to decide whether holes
// 1-3 are open - so the record is real, earned and load-bearing, and a record no screen shows
// reads as deleted (THE LAW rule 1). It gets a name here and a length of one, which is what stops
// the row printing "TUTORIAL" with seventeen dashes after it.
const GOLF_COURSE_HOLES = { pinevalley: 18, redmesa: 18, oasissands: 9, coralcove: 9, coralkeys: 9, tutorial: 1 };
function golfCourseHoles(id) { return GOLF_COURSE_HOLES[id] || 18; }

/** Rounds played on a course the admin page has set to TESTING (Part 8, §14) - stored in
 *  gf.practice and counted by nothing above (no rounds/strokes/points/bests/leaderboard).
 *  SHOWN, because a stored number no screen shows reads as deleted (THE LAW rule 1); shown below
 *  the real table, dashed, muted, under its own "not counted" label, mirroring skPracticeHTML
 *  exactly (same CSS classes - the box shape isn't Skeeball-specific, just named after its first
 *  user). Do not fold these into the lifetime tallies or the bestRoundByCourse table above. */
/** THE PER-HOLE RECORDS. Matt, 2026-09-05: *"we'll have individual hole records"*.
 *
 *  Stored in `gf.bestHole`, keyed `<courseId>:<holeNumber>` (golf/js/rounds.js `holeKey`). Shown as
 *  one row per COURSE with the eighteen numbers across it, because eighteen separate table rows per
 *  course is thirty-six rows nobody reads - and a record no screen shows reads as deleted (rule 1),
 *  which a wall of numbers is only barely better than.
 *
 *  A hole never played is a dash, not a zero: the lowest possible score on a hole is 1, so zero
 *  would be a fabricated record rather than an absent one (rule 4). */
function golfHolesHTML(gf) {
  const best = (gf || {}).bestHole || {};
  const byCourse = {};
  for (const [k, v] of Object.entries(best)) {
    if (!Number.isFinite(v) || v <= 0) continue;
    const i = k.lastIndexOf(':');
    if (i < 0) continue;
    const cid = k.slice(0, i);
    const n = parseInt(k.slice(i + 1), 10);
    if (!Number.isFinite(n)) continue;
    (byCourse[cid] || (byCourse[cid] = {}))[n] = v;
  }
  const ids = Object.keys(byCourse).sort((a, b) => golfCourseName(a).localeCompare(golfCourseName(b)));
  if (!ids.length) return '';
  return `<h4 class="gs-tbl-h">${t('gs_golf_holes_h')}</h4>
    ${ids.map((cid) => {
      const m = byCourse[cid];
      const cells = [];
      // The course's own hole count, never a fixed 18 - and never the highest hole with a record,
      // which would hide the empty slots this row exists to show.
      const holes = Math.max(golfCourseHoles(cid), ...Object.keys(m).map(Number));
      for (let n = 1; n <= holes; n++) {
        const v = m[n];
        cells.push(`<span class="gs-gf-cell${Number.isFinite(v) ? '' : ' is-empty'}"><b>${Number.isFinite(v) ? v : '–'}</b><i>${n}</i></span>`);
      }
      return `<div class="gs-gf-holes">
        <div class="gs-gf-hname">${esc(golfCourseName(cid))}</div>
        <div class="gs-gf-row">${cells.join('')}</div>
      </div>`;
    }).join('')}`;
}

function golfPracticeHTML(gf) {
  const prac = (gf || {}).practice || {};
  const ids = Object.keys(prac).filter((id) => ((prac[id] || {}).rounds | 0) > 0);
  if (!ids.length) return '';
  return `<div class="gs-sk-practice">
    <div class="gs-sk-practice-h">${esc(t('gs_golf_practice'))}</div>
    ${ids.map((id) => `<div class="gs-sk-prow">
      <span class="gs-sk-nm">${esc(golfCourseName(id))}</span>
      <span><b>${prac[id].rounds | 0}</b> ${esc(t('gs_golf_rounds'))}</span>
    </div>`).join('')}
  </div>`;
}

/** Golf: solo (no wins/losses/win-rate - see js/players-agg.js's SOLO set). Skill level is the
 *  lifetime Modified Stableford total and the only SIGNED number this file shows (it can go
 *  negative); everything else here is a plain running total. Avg strokes/round divides safely
 *  since hasPlays() already gates rounds > 0 before this screen is ever reached. One row per
 *  course actually played, best (lowest) strokes only - this repo's first per-key Math.min stat,
 *  see js/game-stats.js's ensureGf and js/players-agg.js's merge branch. */
function golfScreen(rec) {
  const gf = (rec && rec.gf) || { rounds: 0, holes: 0, strokes: 0, points: 0, birdies: 0, eagles: 0, aces: 0, longestDriveYd: 0, bestRoundByCourse: {}, bestHole: {} };
  if (!(gf.rounds | 0)) return emptyState('Golf');
  const pts = gf.points | 0;
  const skill = pts >= 0 ? `+${pts}` : String(pts);
  // AVERAGE PER HOLE, NOT PER ROUND (2026-09-10). This tile used to divide lifetime strokes by
  // lifetime ROUNDS, and a round here is three, nine or eighteen holes - so it averaged a 3-hole
  // round against an 18-hole one and produced a number that described nothing (measured on a real
  // record: 16.4, from 21 rounds that were mostly threes). Holes are already counted (`gf.holes`),
  // so this needs no new stored field: strokes per hole is the same measurement whatever length a
  // player chooses. A record from before holes were counted shows a dash rather than a fabricated
  // average (rule 4).
  const avg = (gf.holes | 0) > 0 ? (gf.strokes / gf.holes).toFixed(1) : '–';
  // A stored 0 is not a round (a hole costs a stroke): a record an integrity void zeroed before
  // stats-corrections.js started emptying this map would otherwise print "12 under" beside a 0.
  const courseIds = Object.keys(gf.bestRoundByCourse || {}).filter((id) => gf.bestRoundByCourse[id] > 0).sort(compareGolfRounds);
  // TO PAR SITS BESIDE THE STROKES, IT DOES NOT REPLACE THEM (queued 2026-09-03, done 2026-09-06).
  // The leaderboard shows a best round as a score to par and this table showed raw strokes, so the
  // two screens described the same round with two different numbers. Par is subtracted at DISPLAY
  // time from the same `GOLF_COURSE_PAR` the board uses - the stored value stays strokes, which is
  // the frozen recorder shape (THE LAW rule 5) - and the strokes column stays, because it is the
  // number the game's own scorecard shows and dropping it would hide data a screen used to show
  // (rule 1). A round key with no par row shows a dash rather than a fabricated 0.
  const rows = courseIds.map((id) => {
    const strokes = gf.bestRoundByCourse[id] | 0;
    const par = GOLF_COURSE_PAR[id];
    const toPar = Number.isFinite(par) ? formatBoardMetric(strokes - par, 'golf', t('lb_golf_even')) : null;
    return `<tr><th scope="row">${esc(golfCourseName(id))}</th><td>${toPar === null ? '–' : esc(toPar)}</td><td>${strokes}</td></tr>`;
  }).join('');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${esc(skill)}</b><span>${t('gs_golf_skill')}</span></div>
      <div class="gs-tally"><b>${gf.rounds | 0}</b><span>${t('gs_golf_rounds')}</span></div>
      <div class="gs-tally"><b>${avg}</b><span>${t('gs_golf_avg')}</span></div>
      <div class="gs-tally"><b>${gf.birdies | 0}</b><span>${t('gs_golf_birdies')}</span></div>
      <div class="gs-tally"><b>${gf.eagles | 0}</b><span>${t('gs_golf_eagles')}</span></div>
      <div class="gs-tally"><b>${gf.aces | 0}</b><span>${t('gs_golf_aces')}</span></div>
      <div class="gs-tally"><b>${Math.round(gf.longestDriveYd | 0)}</b><span>${t('gs_golf_drive')}</span></div>
    </div>
    ${rows ? `<h4 class="gs-tbl-h">${t('gs_golf_courses_h')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_golf_topar')}</th><th scope="col">${t('gs_golf_strokes')}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : ''}
    ${golfHolesHTML(gf)}
    ${golfPracticeHTML(gf)}`;
}

// --- Skeeball (screen 5, Archetype C: the machine dimension) -----------------
// Rebuilt 2026-08-25 from the "Leaderboard and My Stats" design handoff. Skeeball is the only game
// in the hub with a level the others do not have: every number exists both LIFETIME and PER
// MACHINE, so the screen is a lifetime block over one card per machine rather than one flat
// tally grid. Read this before changing it:
//
//  - THE MACHINE LIST IS THE WHOLE LIST, always. A machine the player has not earned still appears,
//    dashed and padlocked, so three machines always read as three machines.
//  - NOTHING IS INVENTED. The handoff's mock also showed "baskets ever landed" and "clean racks"
//    per machine; NEITHER IS STORED (js/arcade-scores.js keeps plays/points/best/bestThrow/daily,
//    and that is all), so neither is drawn. Do not add them here from a derivation - add the
//    counter to the writer first, or leave them out.
//  - A STORED ZERO PRINTS 0; A VALUE NEVER RECORDED PRINTS A DASH. The four ball-value counters
//    (tens..forties) and colorSweeps were added to the writer later than the rest, so they are
//    genuinely ABSENT on a record from a device that has not played since - `num()` tells the two
//    apart by `== null`, never by falsiness.
//  - The disclosures are `<details>`, not JS state. This screen is rendered as a STRING into two
//    different overlays (My Stats and the Leaderboard's player detail) with no per-screen state of
//    their own, and a native disclosure is also correct under prefers-reduced-motion for free.
//  - The vs-computer record (won/lost/tied) is FROZEN history from the pre-2026-08-11 build. It is
//    shown only when non-zero, at the bottom, labelled as what it is - never mixed in with the
//    solo numbers above it, where a "win rate" would be meaningless.

/** Every Skeeball machine, in the game's own unlock-chain order, with the colour it is actually
 *  drawn with in the cabinet (skeeball/js/boards.js `look`). Kept HERE rather than imported from
 *  the game so the hub's overlays never pull a whole board's geometry into the shell bundle; ids
 *  and names are frozen (boards.js: "rename the display name freely, never the id"), and machine
 *  NAMES are proper nouns that never route through t(). Exported for js/leaderboard-ui.js's
 *  machine filter on Skeeball's board, so the two screens can never disagree on a machine's name. */
export const SK_MACHINES = {
  classic: { name: 'THE CLASSIC', color: '#a86f38' },
  // Renamed to HOT SHOT in skeeball/js/boards.js on 2026-08-22; this copy was missed and went
  // on printing the old name on the leaderboard and My Stats. The ID stays `basketball` for
  // ever (THE LAW rule 5 - it keys every play ever thrown on the machine); only the display
  // name moved. boards.js is the source of truth for a machine's name: if the two ever
  // disagree again, boards.js wins.
  basketball: { name: 'HOT SHOT', color: '#f2c526' },
  // BRICK CITY and RUNAWAY were missing here from the day they shipped, so the leaderboard's
  // machine filter and the machine cards printed skMachineMeta's fallback - the raw id in caps,
  // "BRICKCITY" and "RUNAWAY". The fallback did its job (nobody's history disappeared, THE LAW
  // rule 1); it just is not a name. Colours are each machine's own marquee rather than its
  // cabinet, because all three HOT SHOTs share one yellow cabinet and would be one colour.
  brickcity: { name: 'HOT SHOT: BRICK CITY', color: '#a33427' },
  runaway: { name: 'HOT SHOT: RUNAWAY', color: '#39e0d0' },
  // ARCHIVED (Matt, 2026-11-02): never named on a screen again (no card, no tab, no picker row). Its racks stay
  // stored and still count in every Skeeball total; `archived` only keeps it off the lists.
  popongo: { name: 'POPONGO', color: '#c9a36a', archived: true },
};

/** A machine's display name and colour, tolerating an id this table has never heard of.
 *
 *  THE LAW rule 1: `sk.boards` is keyed by whatever the game wrote, and a machine that has been
 *  renamed, retired or is still only in a dev build (the live store already carries `brickcity`
 *  buckets from an earlier build) must NOT disappear from the player's own history just because
 *  the hub's copy of the machine list is behind. An unknown id renders under its own id in caps,
 *  in the neutral muted colour, with every number it has intact. */
export function skMachineMeta(id) {
  return SK_MACHINES[id] || { name: String(id).toUpperCase(), color: '#8a93a3' };
}

/** A stored number, or a dash when the field was never recorded at all. `0` is a real answer and
 *  prints as 0; `null`/`undefined` is missing data and prints as an em rule. */
function skNum(v) { return v == null ? '&mdash;' : Number(v).toLocaleString(); }

/** The daily best map as a sparkline, oldest day first. Returns '' for fewer than two days - a
 *  one-point line says nothing a number has not already said.
 *
 *  (2026-09-02) IT CARRIES ITS OWN SCALE NOW. Matt, on the old one: "It's not clear what you're
 *  looking at unless you really look." It was an unlabelled line on an unlabelled box - the same
 *  picture whether the days ran 10 to 20 or 260 to 330, because the y axis is normalised to the
 *  player's own min and max. So the low and the high are PRINTED, at the ends they belong to, and
 *  the last day gets a dot: the shape is then readable as a shape, and the numbers say what it
 *  spans. The area under the line is filled for the same reason - a 2px line on a phone, at arm's
 *  length, is nearly invisible. */
function skSparkHTML(daily) {
  const days = Object.keys(daily || {}).sort();
  if (days.length < 2) return '';
  const vals = days.map((d) => daily[d] | 0);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = Math.max(1, max - min);
  const x = (i) => (i / (vals.length - 1) * 316 + 2);
  const y = (v) => (34 - (v - min) / span * 26);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `2,38 ${pts} 318,38`;
  return `<div class="gs-sk-spark">
    <div class="gs-sk-spark-h">
      <span>${esc(t('gs_sk_best_per_day'))}</span>
      <span>${esc(t('gs_sk_days_span', { n: days.length }))}</span>
    </div>
    <div class="gs-sk-spark-plot">
      <svg viewBox="0 0 320 40" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="${area}" class="gs-sk-spark-fill"></polygon>
        <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <span class="gs-sk-spark-hi">${Number(max).toLocaleString()}</span>
      <span class="gs-sk-spark-lo">${Number(min).toLocaleString()}</span>
    </div>
  </div>`;
}

/** Practice racks (2026-08-24): thrown while a machine was set to TESTING on the admin page, kept
 *  in `sk.practice` and counted by nothing - no total, no best, no unlock, no ranking.
 *
 *  They are SHOWN, because a stored number no screen shows reads as deleted (THE LAW rule 1) and a
 *  tester who threw forty racks should be able to see where they went. They are shown BELOW the
 *  machines, dashed, muted, under their own "not counted" label, because the one thing that would
 *  be worse than hiding them is letting them read as part of the record. Do not fold these into the
 *  lifetime block or a machine card. */
function skPracticeHTML(sk) {
  const prac = ((sk || {}).practice || {}).boards || {};
  const ids = Object.keys(prac).filter((id) => ((prac[id] || {}).plays | 0) > 0 && !(SK_MACHINES[id] || {}).archived);
  if (!ids.length) return '';
  return `<div class="gs-sk-practice">
    <div class="gs-sk-practice-h">${esc(t('gs_sk_practice'))}</div>
    ${ids.map((id) => `<div class="gs-sk-prow">
      <span class="gs-sk-nm">${esc(skMachineMeta(id).name)}</span>
      <span><b>${skNum(prac[id].best | 0)}</b> ${esc(t('gs_sk_best_game'))}</span>
      <span><b>${skNum(prac[id].plays | 0)}</b> ${esc(t('gs_sk_games'))}</span>
    </div>`).join('')}
  </div>`;
}

/** One machine the player has actually thrown on.
 *
 *  (2026-09-02) ALL FOUR NUMBERS ARE VISIBLE; there is no "More" disclosure any more. It hid
 *  Games and Best throw behind a tap on a screen that has at most a handful of machines on it,
 *  which bought nothing and cost the card its shape - two numbers, a link, then a strip of empty
 *  card. Matt: "SO much wasted space everywhere, but it still feels crowded." A disclosure is
 *  right when the hidden thing is long or rare; four numbers about one machine are neither. */
function skMachineCardHTML(id, b) {
  const meta = skMachineMeta(id);
  const nums = [
    [skNum(b.best | 0), t('gs_sk_best_game')],
    [skNum(b.points | 0), t('gs_sk_points_short')],
    [skNum(b.plays | 0), t('gs_sk_games')],
    [skNum(b.bestThrow | 0), t('gs_sk_best_throw')],
  ].map(([v, l]) => `<div class="gs-sk-mn"><b>${v}</b><span>${esc(l)}</span></div>`).join('');
  return `<div class="gs-sk-mc" style="--mc:${meta.color}">
    <div class="gs-sk-mc-id"><span class="gs-sk-mark"></span><span class="gs-sk-nm">${esc(meta.name)}</span></div>
    <div class="gs-sk-mc-nums">${nums}</div>
    ${skSparkHTML(b.daily)}
  </div>`;
}

function skeeballScreen(rec, fresh = false) {
  const sk = (rec && rec.sk) || {};
  if (!(sk.played | 0)) return emptyState('Skeeball');
  const boards = sk.boards || {};
  // Known machines first, in the game's own unlock-chain order, then ANY other id the store
  // happens to hold (see skMachineMeta) so no recorded machine can fall off this screen.
  // An ARCHIVED machine (POPONGO, 2026-11-02) gets no card, played or locked: its racks stay in every
  // lifetime number above, it is just never named.
  const known = Object.keys(SK_MACHINES).filter((id) => !SK_MACHINES[id].archived);
  const playedIds = known.filter((id) => ((boards[id] || {}).plays | 0) > 0)
    .concat(Object.keys(boards).filter((id) => !SK_MACHINES[id] && ((boards[id] || {}).plays | 0) > 0));
  const lockedIds = known.filter((id) => !playedIds.includes(id));

  // The best game's own note: which machine holds it, and (from that machine's date-keyed daily
  // map) the day it was set. Both are READ off stored data - if no machine's best matches the
  // lifetime best (a record synced from a device that predates per-machine storage), the note is
  // simply omitted rather than guessed at.
  const bestId = playedIds.find((id) => (boards[id].best | 0) === (sk.bestGame | 0));
  let bestNote = '';
  if (bestId) {
    const day = Object.keys(boards[bestId].daily || {}).sort().find((d) => (boards[bestId].daily[d] | 0) === (sk.bestGame | 0));
    bestNote = skMachineMeta(bestId).name + (day ? `, ${day}` : '');
  } else {
    // The best game was on an ARCHIVED machine (never named): its day only, from the store.
    const arch = Object.keys(boards).find((id) => (SK_MACHINES[id] || {}).archived && (boards[id].best | 0) === (sk.bestGame | 0) && (sk.bestGame | 0) > 0);
    const day = arch ? Object.keys(boards[arch].daily || {}).sort().find((d) => (boards[arch].daily[d] | 0) === (sk.bestGame | 0)) : null;
    if (day) bestNote = day;
  }
  // The best throw's note is the count of balls at that exact value, and only when the value maps
  // to a counter the store actually keeps. Anything else gets no note.
  const throwCounts = { 10: sk.tens, 20: sk.twenties, 30: sk.thirties, 40: sk.forties, 50: sk.fifties, 100: sk.hundreds };
  const throwN = throwCounts[sk.bestThrow | 0];
  const throwNote = throwN == null ? '' : t('gs_sk_hit_times', { n: Number(throwN).toLocaleString() });

  const cells = (rows) => rows.map(([v, l]) => `<div class="gs-sk-cell"><b>${v}</b><span>${esc(l)}</span></div>`).join('');

  // THE LIFETIME BLOCK IS THREE EVEN ROWS, NOT ONE RAGGED GRID (2026-09-02). It used to be seven
  // cells in a three-column grid, so the last row was one number beside a hole the width of two -
  // the single most visible piece of the "so much wasted space" Matt reported. Three groups, each
  // of which divides evenly: what you did (3), what you threw (6), and the two rare counters (2).
  // Nothing was dropped, and the ball values are no longer behind a disclosure - see below.
  const totals = cells([
    [skNum(sk.played | 0), t('gs_sk_games')],
    [skNum(sk.balls | 0), t('gs_sk_balls')],
    [skNum(sk.points | 0), t('gs_sk_points')],
  ]);

  // The six ball values, ascending, ALWAYS VISIBLE. They were split across two places for no
  // reason a player could see: 100s and 50s sat in the lifetime grid while 10s-40s hid behind an
  // "Every ball value" disclosure. One strip, in order, is both smaller on the screen and easier
  // to read than a grid plus a link. A value the store has never recorded still prints a dash
  // (skNum), so a device that predates a counter is honest rather than showing a false zero.
  const ballRows = [
    [t('gs_sk_tens'), sk.tens], [t('gs_sk_twenties'), sk.twenties],
    [t('gs_sk_thirties'), sk.thirties], [t('gs_sk_forties'), sk.forties],
    [t('gs_sk_fifties'), sk.fifties], [t('gs_sk_hundreds'), sk.hundreds],
  ];
  const balls = cells(ballRows.map(([l, v]) => [skNum(v), l]));

  // Color sweeps and runaways are POPONGO's and RUNAWAY's, so on most records they are two zeros.
  // They stay (rule 1 - a stored counter no screen shows reads as deleted) but they sit last, in
  // their own quiet two-up row, instead of taking prime space in the middle of the grid.
  const rare = cells([
    [skNum(sk.colorSweeps), t('gs_sk_sweeps')],
    [skNum(sk.runaways), t('gs_sk_runaways')],
  ]);

  // Frozen pre-2026-08-11 vs-computer history: shown only when it exists, never merged with the
  // solo numbers, and never re-derived (THE LAW rule 1 keeps it on a screen; rule 5 keeps it stored).
  const vs = ((sk.won | 0) + (sk.lost | 0) + (sk.tied | 0)) > 0 ? `
    <h4 class="gs-tbl-h">${esc(t('gs_sk_vs_record'))}</h4>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${sk.won | 0}</b><span>${t('gs_sk_wins')}</span></div>
      <div class="gs-tally"><b>${sk.lost | 0}</b><span>${t('gs_sk_losses')}</span></div>
      <div class="gs-tally"><b>${sk.tied | 0}</b><span>${t('gs_tied')}</span></div>
      <div class="gs-tally"><b>${pct(sk.won | 0, (sk.won | 0) + (sk.lost | 0) + (sk.tied | 0))}%</b><span>${t('gs_win_rate')}</span></div>
    </div>` : '';

  return `
    <div class="gs-sk-hero">
      <div class="gs-sk-hero-a">
        <span class="gs-sk-k">${esc(t('gs_sk_best_game'))}</span>
        <b>${skNum(sk.bestGame | 0)}</b>
        <span class="gs-sk-note">${bestNote ? esc(bestNote) : '&nbsp;'}</span>
      </div>
      <div class="gs-sk-hero-b">
        <span class="gs-sk-k">${esc(t('gs_sk_best_throw'))}</span>
        <b>${skNum(sk.bestThrow | 0)}</b>
        <span class="gs-sk-note">${throwNote ? esc(throwNote) : '&nbsp;'}</span>
      </div>
    </div>
    <h4 class="gs-tbl-h">${esc(t('gs_sk_lifetime_h', { n: playedIds.length }))}</h4>
    <div class="gs-sk-grid is-3">${totals}</div>
    <div class="gs-sk-sub">${esc(t('gs_sk_every_ball'))}</div>
    <div class="gs-sk-grid is-3">${balls}</div>
    ${fresh ? '' : `<div class="gs-sk-grid is-2 is-quiet">${rare}</div>`}
    <h4 class="gs-tbl-h">${esc(t('gs_sk_machines_h'))}</h4>
    <div class="gs-sk-machines">
      ${playedIds.map((id) => skMachineCardHTML(id, boards[id])).join('')}
      ${lockedIds.map((id) => `<div class="gs-sk-locked">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="1.5"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>
        <span class="gs-sk-nm">${esc(skMachineMeta(id).name)}</span>
        <span class="gs-sk-lock-tag">${esc(t('gs_sk_locked'))}</span>
      </div>`).join('')}
    </div>
    ${skPracticeHTML(sk)}
    ${vs}
    ${diffTable(skLegacyBuckets(rec && rec.byDiff, boards))}`;
}


/** Skeeball's `byDiff` is keyed by MACHINE since 2026-08-11, so the generic by-difficulty table
 *  would repeat the machine cards above verbatim. It still holds the pre-rework easy/medium/hard
 *  buckets from the vs-computer era, and those have no other screen (THE LAW rule 1), so the table
 *  renders with every machine key filtered OUT - both the ones this file knows and any other id
 *  the store holds a board record for - and nothing else changed. Returns null (no table at all)
 *  when only machine buckets exist, which is every device that started after the rework. */
function skLegacyBuckets(byDiff, boards) {
  const src = byDiff || {};
  const out = {};
  for (const k of Object.keys(src)) if (!SK_MACHINES[k] && !(boards || {})[k]) out[k] = src[k];
  return Object.keys(out).length ? out : null;

}

/** Whether a game has ANY recorded play, matching each screen's own empty-state gate exactly —
 *  the same visibility bar the game list must honor (THE LAW rule 1: nothing shown today may
 *  become unreachable). */
function hasPlays(id, rec) {
  if (id === 'connect4') return c4Totals(rec.grid).plays > 0;
  if (id === 'ballrun') return !!((rec.br && rec.br.runs) || (rec.brOrbital && rec.brOrbital.runs) || rec.brLegacyMeters);
  if (id === 'snake') return !!(rec.sn && rec.sn.runs);
  if (id === 'hillclimb') return !!(rec.hc && rec.hc.runs);
  if (id === 'brickblitz') return !!(rec.bz && rec.bz.games);
  if (id === 'tower') return !!(rec.tw && rec.tw.games);
  if (id === 'cuppong') return ((rec.total || {}).played | 0) > 0 || !!(rec.cp && rec.cp.soloRacks);
  if (id === 'nutsbolts') return !!(rec.nb && rec.nb.solved);
  if (id === 'sudoku') return !!(rec.sd && rec.sd.solved);
  if (id === 'minesweeper') return ((rec.total || {}).played | 0) > 0;
  // A bankroll top-up or a hand played counts as having played, the same bar holdemScreen uses.
  if (id === 'holdem') return !!(((rec.total || {}).played | 0) || (rec.hb && ((rec.hb.entries | 0) || (rec.hb.grants | 0))) || (rec.hs && rec.hs.hands));
  if (id === 'skeeball') return !!(rec.sk && rec.sk.played);
  if (id === 'golf') return !!(rec.gf && rec.gf.rounds);
  if (id === 'baseball') return !!(rec.bb && rec.bb.careersStarted);
  return ((rec.total || {}).played | 0) > 0;
}

/** The headline number + unit for a game's row in the shared game-list drill-down: wins
 *  (the stored `won` counter, ties excluded — the same maths the leaderboard uses) for
 *  competitive games, the game's own solo metric for Ball Run/Snake/Nuts & Bolts. */
function headlineOf(id, rec) {
  if (id === 'ballrun') return { n: Math.max((rec.br && rec.br.bestObstacles) | 0, (rec.brOrbital && rec.brOrbital.bestObstacles) | 0), unitKey: unitKeyOf(id) };
  if (id === 'snake') return { n: (rec.sn && rec.sn.bestLen) | 0, unitKey: unitKeyOf(id) };
  if (id === 'hillclimb') return { n: (rec.hc && rec.hc.bestDistance) | 0, unitKey: unitKeyOf(id) };
  if (id === 'brickblitz') return { n: (rec.bz && rec.bz.bestScore) | 0, unitKey: unitKeyOf(id) };
  if (id === 'tower') return { n: (rec.tw && rec.tw.best) | 0, unitKey: unitKeyOf(id) };
  if (id === 'contexto') return { n: (rec.ct && rec.ct.solved) | 0, unitKey: unitKeyOf(id) };
  // Lifetime points, not the best single rack - the same fix leaderboard-ui.js's skPointsAt
  // already made for the Skeeball board's own Points sort (2026-09-01, Matt: "Points should
  // show lifetime points. Not your best single round"). This second call site (My Stats' and
  // the leaderboard player detail's shared game list) still read bestGame under a "POINTS"
  // label until 2026-09-02 - a player with 101 games and one 730 rack read "730 POINTS".
  if (id === 'skeeball') return { n: (rec.sk && rec.sk.points) | 0, unitKey: unitKeyOf(id) };
  // Lifetime Modified Stableford total (golfScreen's "Skill level") - SIGNED, the one metric in
  // this function that can go negative, so it needs its own "+"/"-" formatting rather than the
  // bare number every other branch prints. Missing this branch until caught by a real My Stats
  // check (Part 8) meant golf fell through to the generic `record(rec.total).wins` default,
  // which reads 0 for any round with a negative point total (bumpTotals's "won" flag is
  // `points >= 0`) - a player's actual points invisible on the one screen that lists every game.
  if (id === 'golf') {
    const pts = (rec.gf && rec.gf.points) | 0;
    return { n: pts >= 0 ? `+${pts}` : String(pts), unitKey: unitKeyOf(id) };
  }
  if (id === 'nutsbolts') return { n: (rec.nb && rec.nb.solved) | 0, unitKey: unitKeyOf(id) };
  if (id === 'sudoku') return { n: (rec.sd && rec.sd.solved) | 0, unitKey: unitKeyOf(id) };
  if (id === 'minesweeper') return { n: (rec.ms && rec.ms.cleared) | 0, unitKey: unitKeyOf(id) };
  // Arrow Maze: points for levels cleared (the ladder, 2026-10-14), the leaderboard's own number.
  if (id === 'wayout') return { n: woPoints(rec), unitKey: unitKeyOf(id) };
  if (id === 'gridlock') return { n: glPoints(rec), unitKey: unitKeyOf(id) };
  // Word Weaver: points (stars x the band's 1/2/3/4) over distinct levels, the leaderboard's own number.
  if (id === 'wordweaver') return { n: wwPoints(rec), unitKey: unitKeyOf(id) };
  // Baseball (phase 0): career wins, the same `total.won` maths every competitive game uses -
  // stated explicitly rather than left to the generic fallback below, since this list is read as
  // the contract for what each game's headline number means.
  if (id === 'baseball') return { n: record(rec.total).wins, unitKey: unitKeyOf(id) };
  return { n: record(rec.total).wins, unitKey: unitKeyOf(id) };
}

function emptyAll() { return `<p class="gs-none">${t('lb_empty_all')}</p>`; }

/** The shared game-list drill-down (Matt: "make it like the Leaderboard tab, but more detailed
 *  and specific to the user"). One row per game WITH plays — art thumbnail, title, headline stat,
 *  chevron — alphabetical by displayed title, resolved at render time (never sort at module
 *  scope: js/CLAUDE.md "Language support"). Games with zero plays are omitted. Fed either the
 *  local viewer's `st.games` (My Stats) or an aggregated player's `games`
 *  (Leaderboard's player detail, players-agg.js) — both are the same canonical shape, so this one
 *  function renders identically either way. */
export function gameListHTML(games, opts) {
  const g = games || {};
  // `order: 'plays'` (the leaderboard's player page, 2026-10-11 review) puts a person's most-played
  // games first; My Stats keeps the A-Z order it has always had.
  const plays = (id) => (((g[id] || {}).total || {}).played) | 0;
  const byPlays = !!(opts && opts.order === 'plays');
  const rows = visibleTabs()
    .filter((tab) => hasPlays(tab.id, g[tab.id] || {}))
    .sort((a, b) => (byPlays ? plays(b.id) - plays(a.id) : 0) || t(a.labelKey).localeCompare(t(b.labelKey)))
    .map((tab) => {
      const rec = g[tab.id] || {};
      const head = headlineOf(tab.id, rec);
      const art = GAME_ART[hubIdOf(tab.id)] || '';
      const pl = opts && opts.places ? opts.places[tab.id] : null;
      if (pl) {
        return `<button type="button" class="gs-grow gs-grow2" data-game="${tab.id}">
        <span class="gs-gart">${art}</span>
        <span class="gs-gname"><span class="gs-gn">${esc(t(tab.labelKey))}</span><small>${esc(lifeText(head))}</small></span>
        <span class="gs-gbd">${boardValHTML(tab.id, pl)}${rankHTML(pl)}</span>
        <span class="gs-gchev" aria-hidden="true">&rsaquo;</span>
      </button>`;
      }
      return `<button type="button" class="gs-grow" data-game="${tab.id}">
        <span class="gs-gart">${art}</span>
        <span class="gs-gname">${esc(t(tab.labelKey))}</span>
        <span class="gs-gnum"><b>${head.n}</b><span>${esc(t(head.unitKey))}</span></span>
        <span class="gs-gchev" aria-hidden="true">&rsaquo;</span>
      </button>`;
    });
  if (!rows.length) return emptyAll();
  return `<div class="gs-glist">${rows.join('')}</div>`;
}

/** Sum across every visible game: total plays, competitive wins, and solo runs. Ball Run/Snake
 *  runs and Nuts & Bolts solves are recorded as played+1/won+1 (they have no loss axis), so folding
 *  them into "Wins" made a crash read as a victory — they are counted and labeled as runs instead
 *  (Matt, 2026-07-28; same split as the Leaderboard's By Player card). `plays` still counts every
 *  game, solo included: it was always an honest number and stays one. */
function overviewTotals(games) {
  const g = games || {};
  let plays = 0, wins = 0, runs = 0, rounds = 0;
  for (const tab of visibleTabs()) {
    const tot = (g[tab.id] || {}).total || {};
    plays += tot.played | 0;
    // GOLF'S PLAYS ARE ROUNDS, NOT RUNS (2026-09-09, HANDOFF-GOLF-LAUNCH.md job C1). It is in
    // SOLO with Ball Run, Snake, Nuts & Bolts, Hill Climb and Skeeball, and `runs` is the
    // right word for all of them - which is exactly why golf needs its own and NOT a global rename.
    // A round of golf is not a run at anything, and calling it one is the kind of small wrongness
    // that makes a screen feel like it was written for a different game.
    if (tab.id === 'golf') rounds += tot.played | 0;
    else if (SOLO.has(tab.id)) runs += tot.played | 0;
    else wins += record(tot).wins;
  }
  return { plays, wins, runs, rounds };
}

function overviewHTML(st) {
  let profile = null;
  try { profile = loadProfile(); } catch { /* no profile */ }
  const name = (profile && profile.name) || '';
  const emoji = (profile && profile.emoji) || '';
  const totals = overviewTotals(st.games);
  return `
    <div class="gs-overview">
      <div class="gs-ov-id">
        ${emoji ? `<span class="gs-ov-av" aria-hidden="true">${esc(emoji)}</span>` : ''}
        ${name ? `<span class="gs-ov-name">${esc(name)}</span>` : ''}
      </div>
      <div class="gs-tallies is-4">
        <div class="gs-tally"><b>${totals.plays}</b><span>${t('gs_total_games')}</span></div>
        <div class="gs-tally"><b>${totals.wins}</b><span>${t('gs_wins')}</span></div>
        ${totals.runs > 0 ? `<div class="gs-tally"><b>${totals.runs}</b><span>${t('gs_runs')}</span></div>` : ''}
        ${totals.rounds > 0 ? `<div class="gs-tally"><b>${totals.rounds}</b><span>${t('gs_golf_rounds')}</span></div>` : ''}
      </div>
    </div>`;
}

// --- Brick Breaker (solo, score attack, three difficulties) -------------------------------------
/** No wins or losses (a run ends when the last ball is lost), so the honest numbers are runs,
 *  bests and lifetime counters, like Hill Climb's screen. Average is derived at render time from
 *  `points` and `games`, never stored. The per-difficulty table shows every stored best. */
/** Air Hockey (2026-09-28): the usual wins/losses plus the `ah` records. The fastest shot is
 *  STORED in table units per second and converted only here, on the same scale as the game's own
 *  readout (air-hockey/js/ui.js shotText: the 900-unit table is an 8 ft / 2.44 m table). */
function airHockeyScreen(rec) {
  const total = (rec && rec.total) || { played: 0, won: 0, lost: 0 };
  const ah = (rec && rec.ah) || {};
  const played = total.played | 0, won = total.won | 0;
  if (!played && !(ah.games | 0)) return emptyState(gameLabel('airhockey'));
  const ms = (ah.bestShot | 0) * 2.44 / 900;
  const shot = getLang() === 'es' ? `${Math.round(ms * 3.6)} km/h` : `${Math.round(ms * 2.23694)} mph`;
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${won}</b><span>${t('gs_wins')}</span></div>
      <div class="gs-tally"><b>${total.lost | 0}</b><span>${t('gs_losses')}</span></div>
      <div class="gs-tally"><b>${played}</b><span>${t('gs_plays')}</span></div>
      <div class="gs-tally"><b>${pct(won, played)}%</b><span>${t('gs_win_rate')}</span></div>
    </div>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${ah.bestShot ? shot : '-'}</b><span>${t('gs_ah_shot')}</span></div>
      <div class="gs-tally"><b>${ah.shutouts | 0}</b><span>${t('gs_ah_shutouts')}</span></div>
      <div class="gs-tally"><b>${ah.bestStreak | 0}</b><span>${t('gs_ah_streak')}</span></div>
      <div class="gs-tally"><b>${ah.goalsFor | 0}-${ah.goalsAgainst | 0}</b><span>${t('gs_ah_goals')}</span></div>
    </div>
    ${diffTable(rec && rec.byDiff)}`;
}

/** Tower (2026-11-01): the `tw` sub-counter (js/game-stats.js recordTower). */
function towerScreen(rec) {
  const tw = (rec && rec.tw) || {};
  const games = tw.games | 0;
  if (!games) return emptyState(tf('game_title_tower', 'Tower'));
  const by = tw.bestByDiff || {};
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${tw.best | 0}</b><span>${t('gs_tw_best')}</span></div>
      <div class="gs-tally"><b>${games}</b><span>${t('gs_played')}</span></div>
      <div class="gs-tally"><b>${(tw.perfects | 0).toLocaleString()}</b><span>${t('gs_tw_perfects')}</span></div>
      <div class="gs-tally"><b>${tw.bestStreak | 0}</b><span>${t('gs_tw_streak')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_bz_by_diff')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_played')}</th><th scope="col">${t('gs_tw_best')}</th></tr></thead>
      <tbody>${C4_DIFFS.map(([k, labelKey]) =>
        `<tr><th scope="row">${t(labelKey)}</th><td>${((rec && rec.byDiff && rec.byDiff[k] && rec.byDiff[k].played) | 0)}</td><td>${by[k] | 0}</td></tr>`).join('')}</tbody>
    </table>`;
}

function brickBlitzScreen(rec) {
  const bz = (rec && rec.bz) || {};
  const games = bz.games | 0;
  if (!games) return emptyState('Brick Breaker');
  const avg = Math.round((bz.points | 0) / games);
  const by = bz.bestScoreByDiff || {};
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${(bz.bestScore | 0).toLocaleString()}</b><span>${t('gs_bz_best')}</span></div>
      <div class="gs-tally"><b>${games}</b><span>${t('gs_played')}</span></div>
      <div class="gs-tally"><b>${avg.toLocaleString()}</b><span>${t('gs_bz_avg')}</span></div>
      <div class="gs-tally"><b>x${bz.bestCombo | 0}</b><span>${t('gs_bz_combo')}</span></div>
    </div>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${(bz.bricks | 0).toLocaleString()}</b><span>${t('gs_bz_bricks')}</span></div>
      <div class="gs-tally"><b>${bz.stages | 0}</b><span>${t('gs_bz_stages')}</span></div>
      <div class="gs-tally"><b>${bz.circuits | 0}</b><span>${t('gs_bz_circuits')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_bz_by_diff')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_played')}</th><th scope="col">${t('gs_bz_best')}</th></tr></thead>
      <tbody>${SN_DIFFS.map(([k, labelKey]) =>
        `<tr><th scope="row">${t(labelKey)}</th><td>${((rec && rec.byDiff && rec.byDiff[k] && rec.byDiff[k].played) | 0)}</td><td>${(by[k] | 0).toLocaleString()}</td></tr>`).join('')}</tbody>
    </table>`;
}

// --- Cup Pong (matches vs the computer + solo racks) -------------------------------------------
/** Two halves. Matches are the ordinary wins/losses screen (recordResult). SOLO is one cleared
 *  10-cup rack at a time (recordCupPongSolo): its headline is the fewest throws, lower is better,
 *  and "Not yet" stands in for the 0 sentinel, never a literal 0. */
function cupPongScreen(rec) {
  const cp = (rec && rec.cp) || {};
  const racks = cp.soloRacks | 0;
  const matches = ((rec && rec.total) || {}).played | 0;
  if (!racks && !matches) return emptyState('Cup Pong');
  const solo = racks ? `
    <h4 class="gs-tbl-h">${t('gs_cp_solo')}</h4>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${cp.soloBest ? cp.soloBest | 0 : t('gs_bs_no_wins_yet')}</b><span>${t('gs_cp_best')}</span></div>
      <div class="gs-tally"><b>${racks}</b><span>${t('gs_cp_racks')}</span></div>
      <div class="gs-tally"><b>${(Math.round(((cp.soloThrows | 0) / racks) * 10) / 10).toLocaleString()}</b><span>${t('gs_cp_avg')}</span></div>
    </div>` : '';
  const vs = matches ? `<h4 class="gs-tbl-h">${t('gs_cp_vs')}</h4>${recordScreen('cuppong', rec)}` : '';
  return solo + vs;
}

const BB_LEAGUE_LABEL = { little: 'Little League', highschool: 'High School', college: 'College', minors: 'Minors', majors: 'Majors' };
const BB_TROPHY_LABEL = { 0: 'None', 1: 'Bronze', 2: 'Silver', 3: 'Gold' };

/** Baseball (phase 0 - BB-0-phase-0-handoff.md). No game exists yet; this screen exists so every
 *  counter `ensureBb`/`recordBaseball` can ever write is reachable somewhere (THE LAW rule 1) the
 *  moment it starts being written, rather than needing a follow-up commit later. Reads `rec.bb`
 *  literally, per the handoff's own instruction, so a rename of that sub-counter key breaks this
 *  screen loudly rather than silently reading undefined. */
/** Baseball's derived batting/pitching lines. Derived at RENDER TIME, never stored — the
 *  raw counters (`bb.hits`, `bb.atBats`, ...) are THE LAW's rule-1 surface (stored is not
 *  enough only if it's also shown, so both the raw tallies AND these derived lines render
 *  below); a stored average would go stale the moment a formula changed, and would need its
 *  own migration to fix. A rate with a zero denominator reads as a dash, never a fabricated 0
 *  or an Infinity (rule 4: never invent a number two zero counters cannot support). */
function bbRate(num, den, digits) {
  if (!(den > 0)) return '–';
  return (num / den).toFixed(digits).replace(/^0\./, '.');
}
function bbBattingLine(bb) {
  const singles = (bb.hits | 0) - (bb.doubles | 0) - (bb.triples | 0) - (bb.homers | 0);
  const totalBases = Math.max(0, singles) + (bb.doubles | 0) * 2 + (bb.triples | 0) * 3 + (bb.homers | 0) * 4;
  const ab = bb.atBats | 0;
  const obpDen = ab + (bb.walksDrawn | 0) + (bb.sacFlies | 0);
  return {
    avg: bbRate(bb.hits | 0, ab, 3),
    obp: bbRate((bb.hits | 0) + (bb.walksDrawn | 0), obpDen, 3),
    slg: bbRate(totalBases, ab, 3),
  };
}
function bbPitchingLine(bb) {
  const outs = bb.inningsPitchedOuts | 0;
  return {
    era: bbRate((bb.runsAllowed | 0) * 27, outs, 2),
    whip: bbRate((bb.walksIssued | 0) + (bb.hitsAllowed | 0), outs / 3, 2),
    k9: bbRate((bb.strikeoutsPitched | 0) * 27, outs, 2),
  };
}

function baseballScreen(rec) {
  const bb = (rec && rec.bb) || {};
  const bat = bbBattingLine(bb);
  const pitch = bbPitchingLine(bb);
  const leagues = Object.keys(BB_LEAGUE_LABEL).map((lg) => {
    const trophy = (bb.bestTrophyByLeague && bb.bestTrophyByLeague[lg]) | 0;
    return `<tr><th scope="row">${esc(BB_LEAGUE_LABEL[lg])}</th><td>${esc(BB_TROPHY_LABEL[trophy] || trophy)}</td></tr>`;
  }).join('');
  const historyRows = Object.values(bb.history || {})
    .sort((a, b) => (b.endedAt | 0) - (a.endedAt | 0))
    .map((row) => `<tr>
        <td>${esc(row.careerId)}</td>
        <td>${row.seasons | 0}</td>
        <td>${row.won | 0}-${row.lost | 0}</td>
        <td>${row.wsTitles | 0}</td>
      </tr>`).join('');
  return `
    <div class="gs-tallies">
      <div class="gs-tally"><b>${bb.careersStarted | 0}</b><span>Careers started</span></div>
      <div class="gs-tally"><b>${bb.careersFinished | 0}</b><span>Careers finished</span></div>
      <div class="gs-tally"><b>${bb.seasons | 0}</b><span>Seasons</span></div>
      <div class="gs-tally"><b>${bb.wsTitles | 0}</b><span>World Series titles</span></div>
      <div class="gs-tally"><b>${bb.perfectSeasons | 0}</b><span>Perfect seasons</span></div>
      <div class="gs-tally"><b>${bb.forfeits | 0}</b><span>Forfeits</span></div>
      <div class="gs-tally"><b>${bb.hand ? esc(bb.hand.v) : '–'}</b><span>Batting hand</span></div>
      <div class="gs-tally"><b>${bb.bestWinStreak | 0}</b><span>Best win streak</span></div>
    </div>
    <h4 class="gs-tbl-h">Batting</h4>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${bat.avg}</b><span>AVG</span></div>
      <div class="gs-tally"><b>${bat.obp}</b><span>OBP</span></div>
      <div class="gs-tally"><b>${bat.slg}</b><span>SLG</span></div>
      <div class="gs-tally"><b>${bb.hits | 0}</b><span>Hits</span></div>
      <div class="gs-tally"><b>${bb.doubles | 0}</b><span>Doubles</span></div>
      <div class="gs-tally"><b>${bb.triples | 0}</b><span>Triples</span></div>
      <div class="gs-tally"><b>${bb.homers | 0}</b><span>Home runs</span></div>
      <div class="gs-tally"><b>${bb.rbi | 0}</b><span>RBI</span></div>
      <div class="gs-tally"><b>${bb.atBats | 0}</b><span>At bats</span></div>
      <div class="gs-tally"><b>${bb.runsScored | 0}</b><span>Runs scored</span></div>
      <div class="gs-tally"><b>${bb.walksDrawn | 0}</b><span>Walks drawn</span></div>
      <div class="gs-tally"><b>${bb.sacFlies | 0}</b><span>Sac flies</span></div>
      <div class="gs-tally"><b>${bb.sacBunts | 0}</b><span>Sac bunts</span></div>
      <div class="gs-tally"><b>${bb.stolenBases | 0}</b><span>Stolen bases</span></div>
      <div class="gs-tally"><b>${bb.caughtStealing | 0}</b><span>Caught stealing</span></div>
      <div class="gs-tally"><b>${bb.strikeoutsBatting | 0}</b><span>Strikeouts (batting)</span></div>
      <div class="gs-tally"><b>${bb.bestRunsGame | 0}</b><span>Best runs, one game</span></div>
    </div>
    <h4 class="gs-tbl-h">Pitching</h4>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${pitch.era}</b><span>ERA</span></div>
      <div class="gs-tally"><b>${pitch.whip}</b><span>WHIP</span></div>
      <div class="gs-tally"><b>${pitch.k9}</b><span>K/9</span></div>
      <div class="gs-tally"><b>${bb.runsAllowed | 0}</b><span>Runs allowed</span></div>
      <div class="gs-tally"><b>${bb.hitsAllowed | 0}</b><span>Hits allowed</span></div>
      <div class="gs-tally"><b>${bb.walksIssued | 0}</b><span>Walks issued</span></div>
      <div class="gs-tally"><b>${bb.homersAllowed | 0}</b><span>Home runs allowed</span></div>
      <div class="gs-tally"><b>${bb.pickoffs | 0}</b><span>Pickoffs</span></div>
      <div class="gs-tally"><b>${Math.floor((bb.inningsPitchedOuts | 0) / 3)}.${(bb.inningsPitchedOuts | 0) % 3}</b><span>Innings pitched</span></div>
      <div class="gs-tally"><b>${bb.strikeoutsPitched | 0}</b><span>Strikeouts (pitched)</span></div>
      <div class="gs-tally"><b>${bb.shutouts | 0}</b><span>Shutouts</span></div>
      <div class="gs-tally"><b>${bb.bestStrikeoutsPitchedGame | 0}</b><span>Best strikeouts, one game</span></div>
    </div>
    <h4 class="gs-tbl-h">Achievements</h4>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${bb.grandSlams | 0}</b><span>Grand slams</span></div>
      <div class="gs-tally"><b>${bb.noHitters | 0}</b><span>No-hitters thrown</span></div>
      <div class="gs-tally"><b>${bb.perfectGames | 0}</b><span>Perfect games thrown</span></div>
      <div class="gs-tally"><b>${bb.walkoffWins | 0}</b><span>Walkoff wins</span></div>
      <div class="gs-tally"><b>${bb.extraInningGames | 0}</b><span>Extra-inning games</span></div>
    </div>
    <h4 class="gs-tbl-h">Trophy case</h4>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${bb.golds | 0}</b><span>Gold</span></div>
      <div class="gs-tally"><b>${bb.silvers | 0}</b><span>Silver</span></div>
      <div class="gs-tally"><b>${bb.bronzes | 0}</b><span>Bronze</span></div>
    </div>
    <table class="gs-tbl"><tbody>${leagues}</tbody></table>
    ${historyRows ? `<h4 class="gs-tbl-h">Career history</h4>
    <table class="gs-tbl">
      <thead><tr><th scope="col">Career</th><th scope="col">Seasons</th><th scope="col">W-L</th><th scope="col">Titles</th></tr></thead>
      <tbody>${historyRows}</tbody>
    </table>` : ''}`;
}

// --- POINTS on a wins game's stats page (2026-11-02, Matt: say exactly how that game's points are calculated) ---
// The game's leaderboard number for this record (js/lb-points.js, the board's own maths) and what one win is
// worth at each level, online and with any option. Display only.
function ptsSectionHTML(id, st) {
  const r = LB_RULES[id];
  if (!r || (r.by !== 'wins' && r.by !== 'cuppong')) return '';
  if (!isAdminDevice()) return '';   // admin devices only until Matt releases the points (2026-11-02)
  const rec = (st && st.games && st.games[id]) || {};
  // What a win is worth: the same cards as the board's (i) (Matt's mockup v7, js/lb-points-sheet.js), behind the
  // board's own button (2026-11-03, Matt: "Why is the score calculation fully displayed on this page? We should hide
  // it behind the same 'see how scores are calculated' button"; same words on every game). In Leaderboard v2 the
  // button's data-act="info" opens the board's sheet over the page; anywhere else it unfolds the copy below it.
  watchPtsButtons();
  return `<h4 class="gs-tbl-h">${esc(t('lb_pts_total'))}: ${nf(gamePoints(rec, id).pts)}</h4>`
    + `<button type="button" class="lb2-more gs-ptsbtn" data-act="info" aria-expanded="false">${esc(t2('lb2_pts_how'))}</button>`
    + `<div class="gs-ptsheet" hidden>${pointsSheetHTML(id)}</div>`;
}
/** Outside Leaderboard v2 (My Stats, the old board's player page) the points button unfolds the sheet under it.
 *  One click listener for the page, added once; v2 handles its own (data-act="info"). */
let _ptsWatch = false;
function watchPtsButtons() {
  if (_ptsWatch || typeof document === 'undefined') return;
  _ptsWatch = true;
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('.gs-ptsbtn') : null;
    if (!b || b.closest('.lb2')) return;
    const sheet = b.nextElementSibling;
    if (!sheet || !sheet.classList.contains('gs-ptsheet')) return;
    sheet.hidden = !sheet.hidden;
    b.setAttribute('aria-expanded', String(!sheet.hidden));
  });
}
function screenFor(id, st) { return screenForBase(id, st) + ptsSectionHTML(id, st); }
function screenForBase(id, st) {
  const rec = (st.games && st.games[id]) || {};
  if (id === 'spellingbee') return spellingBeeScreen(rec, st.code);
  if (id === 'connect4') return connect4Screen(rec);
  if (id === 'chinchon') return chinchonScreen(rec);
  if (id === 'nutsbolts') return nutsBoltsScreen(rec);
  if (id === 'sudoku') return sudokuScreen(rec);
  if (id === 'minesweeper') return minesweeperScreen(rec);
  if (id === 'contexto') return contextoScreen(rec);
  if (id === 'murdoku') return murdokuScreen(rec);
  if (id === 'wayout') return wayoutScreen(rec);
  if (id === 'gridlock') return gridlockScreen(rec);
  if (id === 'wordweaver') return wordWeaverScreen(rec);
  if (id === 'escoba') return escobaScreen(rec);
  if (id === 'ballrun') return ballRunScreen(rec);
  if (id === 'tictactoe') return ticTacToeScreen(rec);
  if (id === 'dotsboxes') return dotsBoxesScreen(rec);
  if (id === 'boggle') return boggleScreen(rec);
  if (id === 'yahtzee') return yahtzeeScreen(rec);
  if (id === 'dominoes') return dominoesScreen(rec);
  if (id === 'snake') return snakeScreen(rec);
  if (id === 'hillclimb') return hillClimbScreen(rec);
  if (id === 'battleship') return battleshipScreen(rec);
  if (id === 'skeeball') return skeeballScreen(rec);
  if (id === 'brickblitz') return brickBlitzScreen(rec);
  if (id === 'tower') return towerScreen(rec);
  if (id === 'airhockey') return airHockeyScreen(rec);
  if (id === 'cuppong') return cupPongScreen(rec);
  if (id === 'holdem') return holdemScreen(rec);
  if (id === 'golf') return golfScreen(rec);
  return recordScreen(id, rec);   // business, parchis
}

// --- One vocabulary, the same layout in every game (2026-11-02, Matt's themes) ------------------------------------
// ADMIN DEVICES ONLY until Matt releases it: My Stats under `_s4`, leaderboard v2's person-in-a-game page always
// (`v2ScreenFor(id, st, { fresh: true })`); players keep `screenFor` above. Order: 1 Wins / Losses / Ties / Played,
// 2 Online (byDiff.mp), 3 Went first / Went second (byMode `went`, else `first` when it says me/them), 4 By
// difficulty (shape + word), 5 each game's modes (byMode), 6 a few numbers (`dt`, averaged over `dt._n`).
// DISPLAY ONLY: every number is stored, a sum of stored ones, or a ratio of two. A breakdown with no data is not
// drawn (no "since" notes, no tables of zeros). '?' (a result recorded outside withMode) has no options to group by.
const n0 = (v) => Math.max(0, Math.floor(+v || 0));
// Separators always (Spanish too: "4.481", Matt's item 9), like My Stats under `_s4`.
const fmtG = (v) => { try { return Number(v).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-US', { useGrouping: 'always', maximumFractionDigits: 1 }); } catch { return String(v); } };
const nf = (v) => fmtG(n0(v));
const r1 = (v) => fmtG(Math.round(v * 10) / 10);
function parseMode(key) {
  const o = {};
  for (const part of String(key || '').split('|')) { const i = part.indexOf('='); if (i > 0) o[part.slice(0, i)] = part.slice(i + 1); }
  return o;
}
/** Every byMode cell as { o (the options), d (difficulty chosen), played, won, lost, hi, lo }. */
function modeEntries(rec) {
  const out = [];
  const bm = rec && rec.byMode;
  if (!bm || typeof bm !== 'object' || Array.isArray(bm)) return out;
  for (const k of Object.keys(bm)) {
    const per = bm[k];
    if (k === '?' || !per || typeof per !== 'object') continue;
    const o = parseMode(k);
    for (const d of Object.keys(per)) {
      const b = per[d] || {};
      out.push({ o, d, played: n0(b.played), won: n0(b.won), lost: n0(b.lost), hi: +b.hi > 0 ? +b.hi : 0, lo: +b.lo > 0 ? +b.lo : 0 });
    }
  }
  return out;
}
/** byMode cells summed by `fn(options, diff)` (null = left out), in first-seen order. */
function groupModes(entries, fn) {
  const m = new Map();
  for (const e of entries) {
    let k = null;
    try { k = fn(e.o, e.d); } catch { k = null; }
    if (k == null || k === '') continue;
    const g = m.get(k) || { key: k, played: 0, won: 0, lost: 0, hi: 0, lo: 0 };
    g.played += e.played; g.won += e.won; g.lost += e.lost;
    if (e.hi > g.hi) g.hi = e.hi;
    if (e.lo > 0 && (!g.lo || e.lo < g.lo)) g.lo = e.lo;
    m.set(k, g);
  }
  return [...m.values()].filter((g) => g.played > 0);
}
const tiesOf = (r) => Math.max(0, n0(r.played) - n0(r.won) - n0(r.lost));
const pctOf = (r) => { const d = n0(r.won) + n0(r.lost); return d ? `${Math.round((n0(r.won) * 100) / d)}%` : '–'; };
const wentOf = (o) => { const w = o.went || o.first; return w === 'me' || w === 'them' ? w : null; };
const avgOf = (dt, k) => (dt && n0(dt._n) > 0 && Number.isFinite(+dt[k]) ? r1(+dt[k] / n0(dt._n)) : null);
const sumOf = (dt, k) => (dt && n0(dt._n) > 0 && Number.isFinite(+dt[k]) ? nf(dt[k]) : null);
/** The value a fact map ({value: count}) holds most often. */
function topOf(map) {
  let best = null, n = 0;
  for (const k of Object.keys(map || {})) if (n0(map[k]) > n) { n = n0(map[k]); best = k; }
  return best;
}
const fh = (k) => `<h4 class="gs-tbl-h">${esc(t(k))}</h4>`;
/** 1. Wins / Losses / Ties / Played (Ties only when there are some). */
function recCard(r, ties) {
  const tie = ties != null ? n0(ties) : tiesOf(r);
  const cells = [[r.won, 'st_wins'], [r.lost, 'st_losses']].concat(tie > 0 ? [[tie, 'st_ties']] : [], [[r.played, 'st_played']]);
  return `<div class="gs-rec is-${cells.length}">${cells.map(([v, k]) => `<div><b>${nf(v)}</b><span>${esc(t(k))}</span></div>`).join('')}</div>`;
}
/** A record table: label | W–L (–T when any row tied) | Win %. Rows: { label (HTML), won, lost, played }. */
function wlTable(titleKey, rows) {
  if (!rows.length) return '';
  const anyT = rows.some((r) => tiesOf(r) > 0);
  const body = rows.map((r) => `<tr><th scope="row">${r.label}</th><td>${nf(r.won)}–${nf(r.lost)}${anyT ? `–${nf(tiesOf(r))}` : ''}</td><td>${pctOf(r)}</td></tr>`).join('');
  return `${titleKey ? fh(titleKey) : ''}<table class="gs-grid gs-wl"><thead><tr><th scope="col"></th><th scope="col">${esc(t(anyT ? 'st_wlt' : 'st_wl'))}</th><th scope="col">${esc(t('st_pct'))}</th></tr></thead><tbody>${body}</tbody></table>`;
}
/** 2. Online: the 'mp' bucket, near the top. */
function onlineHTML(rec) {
  const mp = ((rec && rec.byDiff) || {}).mp;
  if (!mp || !n0(mp.played)) return '';
  return fh('st_online') + recCard(mp);
}
/** 3. Went first / went second, from byMode (or rows handed in, Connect 4's grid). */
function firstHTML(entriesOrRows, rowsGiven) {
  const rows = rowsGiven ? entriesOrRows : groupModes(entriesOrRows, (o) => wentOf(o));
  const pick = (k) => rows.find((r) => r.key === k);
  const out = [['me', 'st_first'], ['them', 'st_second']].map(([k, w]) => { const r = pick(k); return r && n0(r.played) ? { ...r, label: esc(t(w)) } : null; }).filter(Boolean);
  return wlTable(null, out);
}
/** A difficulty as the board shows it: its shape and word; a bucket with no tier keeps its own name. */
function diffLabelHTML(k) {
  const tr = tierOf(k);
  if (tr) return `<span class="lb2-tw">${v2shape(tr)}${esc(t(['', 'gs_diff_easy', 'gs_diff_medium', 'gs_diff_hard', 'gs_diff_expert'][tr]))}</span>`;
  const m = DIFF_META[k];
  return esc(m ? t(m.labelKey) : titleCase(String(k)));
}
const diffOrder = (k) => tierOf(k) || ((DIFF_META[k] || {}).order) || 8;
/** 4. By difficulty (online is its own card, so 'mp' is not a row). */
function diffHTML(byDiff) {
  const bd = byDiff || {};
  const rows = Object.keys(bd).filter((k) => k !== 'mp' && n0((bd[k] || {}).played) > 0).sort((a, b) => diffOrder(a) - diffOrder(b))
    .map((k) => ({ label: diffLabelHTML(k), won: bd[k].won, lost: bd[k].lost, played: bd[k].played }));
  return wlTable('st_by_diff', rows);
}
/** 5. A mode table from byMode: `fn(options, diff)` names the row, `labelOf(key)` prints it. */
function modeHTML(titleKey, entries, fn, labelOf, order) {
  let rows = groupModes(entries, fn);
  if (order) rows = rows.sort((a, b) => order(a.key) - order(b.key));
  return wlTable(titleKey, rows.map((r) => ({ ...r, label: esc(labelOf(r.key)) })));
}
/** 6. Named numbers: [labelKey or text, value]; a null value is not drawn. */
function factsHTML(list) {
  const rows = list.filter((x) => x && x[1] != null && x[1] !== '');
  if (!rows.length) return '';
  return `<div class="gs-tallies">${rows.map(([k, v]) => `<div class="gs-tally"><b>${v}</b><span>${esc(String(k).startsWith('st_') || String(k).startsWith('gs_') ? t(k) : k)}</span></div>`).join('')}</div>`;
}
/** The usual competitive screen, in the themes' order. `o.total` overrides rec.total (a game whose own counter is
 *  the record), `o.top` sits above everything, `o.modes` are mode tables, `o.facts` the named numbers. */
function stdScreen(id, rec, o = {}) {
  const tot = o.total || (rec && rec.total) || {};
  if (!n0(tot.played)) return o.top ? o.top + (o.tail || '') : emptyState(gameLabel(id));
  const E = modeEntries(rec);
  return [
    o.onlineFirst ? onlineHTML(rec) : '',
    o.top || '',
    recCard(tot, o.ties),
    o.onlineFirst ? '' : onlineHTML(rec),
    o.first === false ? '' : (o.firstRows ? firstHTML(o.firstRows, true) : firstHTML(E)),
    o.diff === false ? '' : diffHTML(o.byDiff || (rec && rec.byDiff)),
    ...(o.modes ? o.modes(E) : []),
    factsHTML(o.facts || []),
    o.tail || '',
  ].join('');
}
const playersLabel = (k) => t('st_players_n', { n: k });
const byNum = (k) => +k || 0;
const subTotal = (rec, sub) => { const t0 = (rec && rec.total) || {}; return n0(t0.played) ? t0 : (sub || t0); };
const FORM = { balanced: 'st_form_balanced', attack: 'st_form_attack', defend: 'st_form_defend', diamond: 'st_form_diamond' };
const formWord = (k) => (FORM[k] ? t(FORM[k]) : titleCase(String(k)));
const HD_TABLES = ['alley', 'free', 'buddy', 'vegas', 'regional', 'world', 'solar', 'galaxy', 'universe'];
const tableWord = (k) => (k === 'free' ? t('st_free_table') : HD_TABLES.includes(k) ? t('st_hd_' + k) : titleCase(String(k)));
const DARTS_KINDS = ['101', '201', '301', 'cricket'];
const dartsKind = (k) => (String(k).startsWith('cricket') ? 'cricket' : String(k));

function freshConnect4(rec) {
  const grid = (rec && rec.grid) || {};
  const side = (s) => { let w = 0, l = 0; for (const [d] of C4_DIFFS) { const c = (grid[s] || {})[d] || {}; w += c.w | 0; l += c.l | 0; } return { won: w, lost: l, played: w + l }; };
  const g = c4Totals(grid);
  const tot = n0(((rec && rec.total) || {}).played) >= g.plays ? rec.total : { won: g.w, lost: g.l, played: g.plays };
  const byDiff = {};
  for (const [d] of C4_DIFFS) {
    const a = (grid.player || {})[d] || {}, b = (grid.computer || {})[d] || {};
    const w = (a.w | 0) + (b.w | 0), l = (a.l | 0) + (b.l | 0);
    if (w + l) byDiff[d] = { won: w, lost: l, played: w + l };
  }
  return stdScreen('connect4', rec, { total: tot, byDiff, firstRows: [{ key: 'me', ...side('player') }, { key: 'them', ...side('computer') }] });
}
function freshTicTacToe(rec) {
  const tt = (rec && rec.tt) || {};
  const E = modeEntries(rec);
  let anyDiff = false;
  const variant = (v, key) => {
    const r = tt[v] || {};
    if (!n0(r.played)) return '';
    const rows = groupModes(E.filter((e) => e.o.v === v && e.d !== 'mp'), (o, d) => (tierOf(d) ? d : null))
      .sort((a, b) => diffOrder(a.key) - diffOrder(b.key)).map((x) => ({ ...x, label: diffLabelHTML(x.key) }));
    if (rows.length) anyDiff = true;
    return fh(key) + recCard(r, r.tied) + wlTable(null, rows);
  };
  const parts = variant('ultimate', 'gs_tt_ultimate') + variant('classic', 'gs_tt_classic');
  return stdScreen('tictactoe', rec, { diff: false, tail: parts + (anyDiff ? '' : diffHTML(rec && rec.byDiff)) });
}
function freshHoldem(rec) {
  const hb = (rec && rec.hb) || {}, hs = (rec && rec.hs) || {};
  const money = (n) => '$' + nf(n);
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const cards = Array.isArray(hs.bestCards) && hs.bestCards.length === 5
    ? hs.bestCards.map((c) => `<span class="gs-pkc${(c & 3) === 1 || (c & 3) === 2 ? ' is-red' : ''}">${RANKS[c >> 2] || '?'}${SUITS[c & 3]}</span>`).join('') : '';
  const bestName = hs.bestCat >= 0 && hs.bestCat <= 9 ? esc(t('lb_hb_cat_' + hs.bestCat)) : null;
  const hasBank = n0(hb.entries) || n0(hb.grants) || n0(hb.cashes) || +hb.winnings > 0;
  if (!n0(((rec && rec.total) || {}).played) && !hasBank && !n0(hs.hands)) return emptyState("Texas Hold'em");
  const top = factsHTML([
    ['gs_hb_bank', hasBank ? money(holdemBalance(hb)) : null],
    ['gs_hs_pot', n0(hs.hands) ? money(hs.bigPot) : null],
    ['gs_hs_best', n0(hs.hands) ? bestName : null],
  ]) + (cards ? `<p class="gs-pkbest">${cards}</p>` : '');
  const E = modeEntries(rec);
  const tables = groupModes(E, (o) => o.tier || null);
  const most = tables.slice().sort((a, b) => b.played - a.played)[0];
  return stdScreen('holdem', rec, {
    top, diff: false, first: false,
    modes: () => [wlTable('st_by_table', tables.sort((a, b) => HD_TABLES.indexOf(a.key) - HD_TABLES.indexOf(b.key)).map((r) => ({ ...r, label: esc(tableWord(r.key)) })))],
    facts: [['st_most_table', most ? esc(tableWord(most.key)) : null]],
  });
}
function freshCupPong(rec) {
  const cp = (rec && rec.cp) || {}, dt = (rec && rec.dt) || {};
  const racks = n0(cp.soloRacks);
  const solo = racks ? fh('st_solo') + factsHTML([
    ['gs_cp_best', cp.soloBest ? nf(cp.soloBest) : '–'],
    ['gs_cp_racks', nf(racks)],
    ['gs_cp_avg', r1(n0(cp.soloThrows) / racks)],
  ]) : '';
  if (!n0(((rec && rec.total) || {}).played)) return racks ? solo : emptyState('Cup Pong');
  const rack = topOf(dt.rack);
  // Make % from MATCH throws only (Matt, 2026-11-02): `mt`/`mm` are written by matches from v1417 on; the older
  // `throws`/`made` keys are kept (rule 5) but mixed with solo racks earlier that day, so they are not used here.
  const cpMake = n0(dt.mt) ? `${Math.round((n0(dt.mm) * 100) / n0(dt.mt))}%` : null;
  return stdScreen('cuppong', rec, {
    facts: [
      ['st_make_pct', cpMake], ['st_on_fire', sumOf(dt, 'onFire')], ['st_balls_back', sumOf(dt, 'ballsBack')],
      ['st_reracks', sumOf(dt, 'reracks')], ['st_fav_rack', rack ? esc(tf('st_rk_' + rack, titleCase(rack))) : null],
    ],
    tail: solo,
  });
}
function freshWayout(rec) {
  const solved = n0(((rec && rec.total) || {}).won);
  const wo = (rec && rec.wo) || {};
  const rush = wo.rush || null;
  const runsOf = (m) => woRushRuns(((rush || {}).runs || {})[m]);
  const hasRush = RUSH_MODES.some((m) => runsOf(m).length > 0);
  if (!solved && !hasRush) return emptyState(t('game_title_wayout'));
  // Arrows cleared: every timed level's arrows (wo.log, per difficulty) + every Rush run's arrows (its score).
  let arrows = 0;
  for (const k of Object.keys(wo.log || {})) for (const e of woList(wo.log[k])) arrows += n0(e && e.a);
  for (const m of RUSH_MODES) for (const r of runsOf(m)) arrows += n0(r.s);
  const byDiff = (rec && rec.byDiff) || {};
  const rows = SD_DIFFS.filter(([k]) => n0((byDiff[k] || {}).won) > 0 || woPoints(rec, k) > 0)
    .map(([k]) => `<tr><th scope="row">${diffLabelHTML(k)}</th><td>${nf((byDiff[k] || {}).won)}</td><td>${nf(woPoints(rec, k))}</td></tr>`).join('');
  const rushRows = RUSH_MODES.filter((m) => runsOf(m).length).map((m) => {
    const wk = woRushBest(rec, m), all = Object.values(woRushBestMap(((rush || {}).best || {})[m]));
    return `<tr><th scope="row">${diffLabelHTML(m === 'hard' ? 'hard' : 'easy')}</th><td>${wk == null ? '–' : nf(wk)}</td><td>${all.length ? nf(Math.max(...all)) : '–'}</td><td>${nf(runsOf(m).length)}</td></tr>`;
  }).join('');
  return factsHTML([['st_points', nf(woPoints(rec))], ['st_levels_cleared', nf(solved)], ['st_arrows', arrows ? nf(arrows) : null]])
    + (rows ? `${fh('st_by_diff')}<table class="gs-grid"><thead><tr><th scope="col"></th><th scope="col">${esc(t('st_levels_cleared'))}</th><th scope="col">${esc(t('st_points'))}</th></tr></thead><tbody>${rows}</tbody></table>` : '')
    + (rushRows ? `${fh('st_rush')}<table class="gs-grid"><thead><tr><th scope="col"></th><th scope="col">${esc(t('st_this_week'))}</th><th scope="col">${esc(t('st_best_week'))}</th><th scope="col">${esc(t('st_runs'))}</th></tr></thead><tbody>${rushRows}</tbody></table>` : '');
}
/** Arrow Maze's per-level log as stored: an array, or an object keyed by index (Firebase). */
function woList(raw) { return Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []; }
function freshMinesweeper(rec) {
  const ms = (rec && rec.ms) || {}, tot = (rec && rec.total) || {};
  if (!n0(tot.played)) return emptyState('Minesweeper');
  const bd = (rec && rec.byDiff) || {};
  const rows = MS_LEVELS_UI.filter(([k]) => n0((bd[k] || {}).played) > 0).map(([k]) => {
    const b = bd[k], best = (ms.bestTimeMs || {})[k] | 0, p = ((ms.bestClearedPct || {})[k] | 0);
    return `<tr><th scope="row">${diffLabelHTML(k)}</th><td>${nf(b.won)}–${nf(b.lost)}</td><td>${best > 0 ? fmtMmSs(best) : p > 0 ? `${p}%` : '–'}</td></tr>`;
  }).join('');
  return recCard(tot) + (rows ? `${fh('st_by_diff')}<table class="gs-grid"><thead><tr><th scope="col"></th><th scope="col">${esc(t('st_wl'))}</th><th scope="col">${esc(t('st_best'))}</th></tr></thead><tbody>${rows}</tbody></table>` : '')
    + factsHTML([['gs_ms_flags', nf(ms.flagsRight)]]);
}
function freshMurdoku(rec) {
  const html = murdokuScreen(rec);
  const best = groupModes(modeEntries(rec), (o, d) => (tierOf(d) ? d : null)).filter((g) => g.lo > 0).sort((a, b) => diffOrder(a.key) - diffOrder(b.key));
  if (!best.length || !n0(((rec && rec.total) || {}).won)) return html;
  return html + `<table class="gs-grid"><thead><tr><th scope="col"></th><th scope="col">${esc(t('gs_sd_best_time'))}</th></tr></thead><tbody>${best.map((g) => `<tr><th scope="row">${diffLabelHTML(g.key)}</th><td>${fmtMmSs(g.lo)}</td></tr>`).join('')}</tbody></table>`;
}
function freshBrickBlitz(rec) {
  const html = brickBlitzScreen(rec);
  const modes = groupModes(modeEntries(rec), (o) => o.m || null);
  if (modes.length < 2) return html;
  return html + `${fh('st_by_mode')}<table class="gs-grid"><thead><tr><th scope="col"></th><th scope="col">${esc(t('st_played'))}</th><th scope="col">${esc(t('st_best'))}</th></tr></thead><tbody>${modes.map((g) => `<tr><th scope="row">${esc(t(g.key === 'endless' ? 'st_bz_endless' : 'st_bz_arcade'))}</th><td>${nf(g.played)}</td><td>${g.hi ? nf(g.hi) : '–'}</td></tr>`).join('')}</tbody></table>`;
}

/** The new screen for one game (admin devices only for now; see the block comment above). */
function freshScreenFor(id, stt) { return freshScreenForBase(id, stt) + ptsSectionHTML(id, stt); }
function freshScreenForBase(id, stt) {
  const rec = (stt.games && stt.games[id]) || {};
  const dt = rec.dt || {};
  switch (id) {
    case 'connect4': return freshConnect4(rec);
    case 'tictactoe': return freshTicTacToe(rec);
    case 'holdem': return freshHoldem(rec);
    case 'cuppong': return freshCupPong(rec);
    case 'wayout': return freshWayout(rec);
    case 'minesweeper': return freshMinesweeper(rec);
    case 'murdoku': return freshMurdoku(rec);
    case 'brickblitz': return freshBrickBlitz(rec);
    case 'skeeball': return skeeballScreen(rec, true);
    case 'chinchon': {
      const cc = rec.cc || {};
      return stdScreen(id, rec, { modes: (E) => [modeHTML('st_by_players', E, (o) => o.n || null, playersLabel, byNum)],
        facts: [['gs_cc_closed', nf(cc.closed)], ['gs_cc_minus_ten', nf(cc.minusTen)], ['gs_cc_chinchons', nf(cc.chinchons)]] });
    }
    case 'escoba': return stdScreen(id, rec, { modes: (E) => [modeHTML('st_by_players', E, (o) => o.n || null, playersLabel, byNum)],
      facts: [['gs_es_escobas', nf((rec.es || {}).escobas)]] });
    case 'uno': return stdScreen(id, rec, { modes: (E) => [modeHTML('st_by_players', E, (o) => o.n || null, playersLabel, byNum)] });
    case 'darts': return stdScreen(id, rec, {
      modes: (E) => [modeHTML('st_by_game', E, (o) => (o.kind ? dartsKind(o.kind) : null), (k) => (k === 'cricket' ? t('st_cricket') : k), (k) => DARTS_KINDS.indexOf(k))],
      facts: [['st_avg_turns', avgOf(dt, 'turns')]] });
    case 'flicksoccer': {
      const E = modeEntries(rec);
      const forms = groupModes(E, (o) => (o.off && o.def ? `${o.off}|${o.def}` : null));
      const lab = (k) => k.split('|').map(formWord).join(' / ');
      const most = forms.slice().sort((a, b) => b.played - a.played)[0];
      return stdScreen(id, rec, {
        modes: () => [wlTable('st_by_form', forms.map((r) => ({ ...r, label: esc(lab(r.key)) })))],
        facts: [['st_most_form', most && forms.length > 1 ? esc(lab(most.key)) : null], ['st_goals_for', sumOf(dt, 'gf')], ['st_goals_against', sumOf(dt, 'ga')], ['st_flicks', sumOf(dt, 'flicks')]] });
    }
    case 'hoops4': {
      const make = n0(dt.shots) ? `${Math.round((n0(dt.made) * 100) / n0(dt.shots))}%` : null;
      return stdScreen(id, rec, {
        modes: (E) => [modeHTML('st_shot_rule', E, (o) => (o.one === '1' || o.one === '0' ? o.one : null), (k) => t(k === '1' ? 'st_one_shot' : 'st_until_score'))],
        facts: [['st_shots', sumOf(dt, 'shots')], ['st_made', sumOf(dt, 'made')], ['st_missed', sumOf(dt, 'missed')], ['st_make_pct', make]] });
    }
    case 'mancala': return stdScreen(id, rec, { facts: [['st_stones', sumOf(dt, 'mine')], ['st_avg_stones', avgOf(dt, 'mine')], ['st_avg_their_stones', avgOf(dt, 'theirs')]] });
    case 'filler': return stdScreen(id, rec, { facts: [['st_squares', sumOf(dt, 'mine')], ['st_avg_squares', avgOf(dt, 'mine')], ['st_avg_their_squares', avgOf(dt, 'theirs')], ['st_avg_moves', avgOf(dt, 'moves')],
      ...['yellow', 'blue', 'vermilion', 'teal', 'purple', 'pink'].map((c) => ['st_sq_' + c, sumOf(dt, 'sq_' + c)])] });
    case 'dotsboxes': {
      const db = rec.db || {};
      return stdScreen(id, rec, { total: subTotal(rec, db), ties: n0(((rec.total || {}).played)) ? undefined : db.tied,
        facts: [['st_boxes', nf(db.boxes)], ['st_avg_boxes', avgOf(dt, 'mine')], ['st_avg_their_boxes', avgOf(dt, 'theirs')], ['st_best_chain', nf(db.bestChain)]] });
    }
    case 'yahtzee': {
      const yz = rec.yz || {};
      return stdScreen(id, rec, { total: subTotal(rec, yz),
        facts: [['st_best_score', nf(yz.bestScore)], ['st_avg_score', avgOf(dt, 'score')], ['st_yahtzees', nf(yz.yahtzees)], ['st_upper', sumOf(dt, 'upper')]] });
    }
    case 'dominoes': {
      const dm = rec.dm || {};
      return stdScreen(id, rec, { total: subTotal(rec, dm),
        modes: (E) => [modeHTML('st_by_target', E, (o) => o.to || null, (k) => t('st_to_n', { n: k }), byNum)],
        facts: [['gs_dm_rounds', nf(dm.rounds)], ['gs_dm_best_round', nf(dm.bestRound)], ['gs_dm_points', nf(dm.points)], ['st_avg_points', avgOf(dt, 'pts')]] });
    }
    case 'battleship': {
      const bs = rec.bs || {};
      return stdScreen(id, rec, { total: subTotal(rec, bs),
        modes: (E) => [modeHTML('st_by_board', E, (o) => (o.size === 'quick' || o.size === 'classic' ? o.size : null), (k) => t('st_bs_' + k))],
        facts: [['gs_bs_shots', nf(bs.shots)], ['gs_bs_hit_rate', n0(bs.shots) ? `${Math.round((n0(bs.hits) * 100) / n0(bs.shots))}%` : null],
          ['gs_bs_ships_sunk', nf(bs.sunk)], ['gs_bs_fewest_shots', bs.fewestShotsWin ? nf(bs.fewestShotsWin) : null]] });
    }
    case 'boggle': {
      const bg = rec.bg || {};
      const lw = bg.longestWord || {};
      return stdScreen(id, rec, {
        modes: (E) => [modeHTML('gs_lang_h', E, (o) => (o.lang === 'en' || o.lang === 'es' ? o.lang : null), (k) => t('st_lang_' + k)),
          modeHTML('st_by_timer', E, (o) => o.min || null, (k) => t('st_min_n', { n: k }), byNum)],
        facts: [['gs_bg_best_score', nf(bg.bestScore)], ['gs_bg_words', nf(bg.words)], ['gs_bg_longest', lw.word ? esc(`${lw.word} (${lw.len | 0})`) : null]] });
    }
    case 'eightball': return stdScreen(id, rec, {
      modes: (E) => [modeHTML('st_by_game', E, (o) => (['8', '9', 'ct'].includes(o.game) ? o.game : null), (k) => t('st_pool_' + k), (k) => ['8', '9', 'ct'].indexOf(k))] });
    case 'airhockey': {
      const ah = rec.ah || {};
      const ms = (ah.bestShot | 0) * 2.44 / 900;
      const shot = getLang() === 'es' ? `${Math.round(ms * 3.6)} km/h` : `${Math.round(ms * 2.23694)} mph`;
      return stdScreen(id, rec, { facts: [['gs_ah_shot', ah.bestShot ? shot : null], ['gs_ah_shutouts', nf(ah.shutouts)], ['gs_ah_streak', nf(ah.bestStreak)], ['gs_ah_goals', `${nf(ah.goalsFor)}–${nf(ah.goalsAgainst)}`]] });
    }
    case 'business': case 'parchis': case 'archery': case 'cupbaseball': case 'battlearena':
      return stdScreen(id, rec);
    default: return screenFor(id, stt);
  }
}

// --- The v2 look (2026-11-02, Matt: "Restyle My Stats to match") --------------------------------------
// ONE set of rules for My Stats and the leaderboard v2 person-in-a-game page (js/leaderboard2-ui.js): rows,
// cards, no capitals, the board's difficulty shapes. Numbers are unchanged; only the markup around them.
const V2_CSS = `.gs-v2{--l2-bg:#F4F5F7;--l2-surf:#FFFFFF;--l2-text:#14161A;--l2-muted:#596170;--l2-line:#E2E5EA;--l2-accent:#1F5FD1}
:root.gh-dark .gs-v2{--l2-bg:#0E1014;--l2-surf:#171A20;--l2-text:#F1F3F6;--l2-muted:#A2A9B5;--l2-line:#272B33;--l2-accent:#7AA7FF}
.gs-v2 .lb2-shape{display:inline-flex;width:14px;height:14px;flex-shrink:0}
.gs-v2 .lb2-shape svg{width:100%;height:100%}
:root.gh-dark .gs-v2 .lb2-shape{background:#fff;border-radius:4px;padding:1px;box-sizing:content-box}
:root.gh-dark .gs-v2 .lb-dshape-t3,:root.gh-dark .gs-v2 .lb-dshape-t4{fill:#1c2430}
.gs-v2 .lb2-shape.x2{width:24px}
.gs-v2 .gs-ctm{position:relative;display:inline-block}
.gs-v2 .gs-sk-mc-nums{grid-template-columns:repeat(4,auto);justify-content:space-between}
.gs-v2 .lb2-card{background:var(--l2-surf);border:1px solid var(--l2-line);border-radius:14px;overflow:hidden}
.gs-v2 .gs-ctm img{display:block;width:100%;height:100%}
.gs-panel.gs-v2{background:var(--l2-bg);color:var(--l2-text)}
.gs-panel.gs-v2 .gs-top{background:var(--l2-bg);border-bottom:0}
.gs-panel.gs-v2 .gs-top h2{font-size:28px;font-weight:800;color:var(--l2-text)}
.gs-panel.gs-v2 .gs-hback{color:var(--l2-text)}
.gs-panel.gs-v2 .gs-x{background:none;border:0;color:var(--l2-muted);font-size:28px}
.gs-panel.gs-v2 .gs-body{gap:10px}
.gs-panel.gs-v2 .gs-overview{gap:10px}
.gs-panel.gs-v2 .gs-ov-av{width:44px;height:44px;border-radius:50%;background:var(--l2-surf);display:flex;align-items:center;justify-content:center;font-size:24px}
.gs-panel.gs-v2 .gs-ov-name{font-size:22px;font-weight:700;color:var(--l2-text)}
.gs-panel.gs-v2 .gs-glist{background:var(--l2-surf);border:1px solid var(--l2-line);border-radius:14px}
.gs-panel.gs-v2 .gs-grow{min-height:62px;gap:12px;color:var(--l2-text)}
.gs-panel.gs-v2 .gs-grow+.gs-grow{border-top-color:var(--l2-line)}
.gs-panel.gs-v2 .gs-grow:active{background:var(--l2-line)}
.gs-panel.gs-v2 .gs-gart{width:62px;height:36px;border-radius:7px}
.gs-panel.gs-v2 .gs-gname{font-size:17px;font-weight:600;color:var(--l2-text)}
.gs-panel.gs-v2 .gs-gnum b{font-size:16px;color:var(--l2-text)}
.gs-panel.gs-v2 .gs-gnum span{font-size:13px;font-weight:400;color:var(--l2-muted)}
.gs-panel.gs-v2 .gs-gchev{color:var(--l2-muted);font-size:20px}
.gs-v2 .gs-ghead{display:flex;align-items:center;gap:12px;min-height:62px;padding:0 12px;background:var(--l2-surf);border:1px solid var(--l2-line);border-radius:14px}
.gs-v2 .gs-ghead .gs-gart{width:62px;height:36px;border-radius:7px;overflow:hidden;flex:none}
.gs-v2 .gs-ghead b{font-size:17px;font-weight:600;display:block}
.gs-v2 .gs-ghead small{font-size:14px;color:var(--l2-muted)}
.gs-v2{display:flex;flex-direction:column;gap:10px}
.gs-v2:empty{display:none}
.gs-v2 .gs-tallies,.gs-v2 .gs-tallies.is-4{display:block;background:var(--l2-surf);border:1px solid var(--l2-line);border-radius:14px;overflow:hidden}
.gs-v2 .gs-tally{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:0 14px;text-align:left;background:none;border:0;border-radius:0;box-shadow:none;border-top:1px solid var(--l2-line)}
.gs-v2 .gs-tally:first-child{border-top:0}
.gs-v2 .gs-tally b{order:2;display:block;font-size:16px;font-weight:700;color:var(--l2-text);white-space:nowrap}
.gs-v2 .gs-tally span{order:1;font-size:16px;font-weight:400;color:var(--l2-text);text-transform:none;letter-spacing:0}
.gs-v2 .gs-tbl-h{margin:6px 4px -4px;font-size:13px;font-weight:600;color:var(--l2-muted)}
.gs-ptsbtn{width:100%;min-height:48px;margin:4px 0 0;border-radius:12px;display:flex;align-items:center;justify-content:center;font:inherit;font-size:16px;font-weight:600;background:var(--l2-surf,#fff);border:1px solid var(--l2-line,#E2E5EA);color:var(--l2-accent,#1F5FD1);touch-action:manipulation;cursor:pointer}
.gs-ptsheet{margin-top:8px}
.gs-v2 .gs-grid{background:var(--l2-surf);border:1px solid var(--l2-line);border-radius:14px;box-shadow:none;border-collapse:separate;border-spacing:0}
.gs-v2 .gs-grid th,.gs-v2 .gs-grid td{padding:0 14px;height:44px;text-align:right;font-size:15px;color:var(--l2-text)}
.gs-v2 .gs-grid thead th{height:36px;background:none;color:var(--l2-muted);font-size:13px;font-weight:600;text-transform:none;letter-spacing:0}
.gs-v2 .gs-grid th:first-child{text-align:left}
.gs-v2 .gs-grid tbody th{font-weight:400}
.gs-v2 .gs-grid tbody td{font-weight:600}
.gs-v2 .gs-grid tbody tr th,.gs-v2 .gs-grid tbody tr td{border-top:1px solid var(--l2-line)}
.gs-v2 .lb2-tw{display:inline-flex;align-items:center;gap:8px}
.gs-v2 .gs-none{background:var(--l2-surf);border-color:var(--l2-line);color:var(--l2-muted)}
.gs-v2 .gs-tally span{display:block}
.gs-v2 .gs-tally span::first-letter{text-transform:uppercase}
.gs-v2 *{text-transform:none !important;letter-spacing:0 !important}
.gs-v2 .gs-cc{background:var(--l2-surf);border-color:var(--l2-line);box-shadow:none;border-radius:14px}
.gs-v2 .gs-cc-h{color:var(--l2-muted);font-size:13px;font-weight:600}
.gs-v2 .gs-cc-k{color:var(--l2-text);font-size:16px;font-weight:400}
.gs-v2 .gs-cc-v{color:var(--l2-text);font-size:16px;font-weight:700}
.gs-v2 .gs-cc-v em{color:var(--l2-muted)}
.gs-v2 .gs-cc-row{border-color:var(--l2-line)}
.gs-v2 .gs-sk-hero-a,.gs-v2 .gs-sk-hero-b{background:var(--l2-surf);border:1px solid var(--l2-line);color:var(--l2-text)}
.gs-v2 .gs-sk-k{font-size:13px;font-weight:600;opacity:1;color:var(--l2-muted)}
.gs-v2 .gs-sk-grid{background:var(--l2-line);border-color:var(--l2-line);border-radius:14px}
.gs-v2 .gs-sk-cell{background:var(--l2-surf)}
.gs-v2 .gs-sk-cell b{color:var(--l2-text)}
.gs-v2 .gs-sk-cell span{color:var(--l2-muted)}
.gs-v2 .gs-sk-mc{background:var(--l2-surf);border-color:var(--l2-line);border-left-color:var(--mc,#8a93a3)}
.gs-v2 .gs-grid tbody th{white-space:normal}
.gs-v2 .lb2-pmed{display:grid;grid-template-columns:repeat(4,1fr);padding:12px 6px 10px;text-align:center}
.gs-v2 .lb2-pmed.is-3{grid-template-columns:repeat(3,1fr)}
.gs-v2 .lb2-pmed div{display:flex;flex-direction:column;align-items:center;gap:4px}
.gs-v2 .lb2-pmed b{font-size:20px;font-weight:800}
.gs-panel.gs-v2 .gs-grow2 .gs-gname{display:flex;flex-direction:column;gap:2px;white-space:normal}
.gs-panel.gs-v2 .gs-gname .gs-gn{white-space:normal;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.15}
.gs-panel.gs-v2 .gs-gname small{font-size:13px;font-weight:400;color:var(--l2-muted);white-space:nowrap}
.gs-v2 .gs-gbd{flex:0 0 auto;display:flex;align-items:center;gap:8px;margin-left:auto}
.gs-v2 .gs-bv{display:inline-flex;align-items:center;gap:5px;font-size:16px;font-weight:700;color:var(--l2-text);white-space:nowrap;font-variant-numeric:tabular-nums}
.gs-v2 .gs-rk{display:inline-flex;align-items:center;min-width:30px;justify-content:center}
.gs-v2 .gs-rk i{font-style:normal;font-weight:700;color:var(--l2-muted);margin-right:1px}
.gs-v2 .gs-rk .lb-ctm{position:relative;display:inline-block}
.gs-v2 .gs-rk .lb-ctm img{display:block;width:100%;height:100%}
.gs-v2 .gs-rk .lb-ctm-n{position:absolute;transform:translate(-50%,-50%);font-weight:800;line-height:1}
.gs-v2 .gs-rkp{min-width:30px;text-align:center;font-size:16px;font-weight:700;color:var(--l2-muted);font-variant-numeric:tabular-nums}
.gs-v2 .gs-ghn{flex:1;min-width:0}
.gs-v2 .gs-bv .lb2-shape{margin-right:2px}
.gs-panel.gs-v2 .gs-grow2{gap:10px}
.gs-panel.gs-v2 .gs-grow2 .gs-gname{flex:1 1 0;min-width:92px}
.gs-panel.gs-v2 .gs-grow2 .gs-gname small{white-space:normal;line-height:1.2}
.gs-panel.gs-v2 .gs-grow2 .gs-gbd{gap:6px}
.gs-panel.gs-v2 .gs-grow2 .gs-bv{font-size:15px}
.gs-panel.gs-v2 .gs-grow2 .gs-bv span{white-space:normal;text-align:right;max-width:104px;line-height:1.15}
@media (max-width:380px){.gs-panel.gs-v2 .gs-grow2 .gs-gart{width:44px;height:28px}.gs-panel.gs-v2 .gs-grow2 .gs-gname{min-width:76px}.gs-panel.gs-v2 .gs-grow2{gap:8px;padding-left:10px;padding-right:8px}}
.gs-s4 .gs-sk-mc{border-left:1px solid var(--l2-line)}
:root:not(.gh-dark) .gs-s4 .lb2-shape{background:#DCE0E6;border-radius:4px;padding:1px;box-sizing:content-box}
:root.gh-dark .gs-s4 .gs-ctm img{filter:drop-shadow(0 0 1px rgba(255,255,255,.55))}
.gs-overlay.gs-ov4{overflow-x:hidden;touch-action:pan-y}
.gs-s4.gs-panel{overflow-x:hidden}
.gs-s4 .gs-body,.gs-s4.gs-body{grid-template-columns:minmax(0,1fr)}
.gs-s4 .gs-gf-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(30px,1fr));overflow-x:visible;padding-bottom:0}
.gs-s4 .gs-gf-cell{min-width:0}
.gs-s4 .gs-grid{width:100%;max-width:100%;table-layout:fixed}
.gs-s4 .gs-grid th,.gs-s4 .gs-grid td{padding:0 8px;overflow-wrap:anywhere}
.gs-s4 .gs-grid thead th{white-space:normal;line-height:1.15;padding-top:4px;padding-bottom:4px;height:auto;min-height:36px}
.gs-s4 .gs-grid th:first-child{width:36%}
.gs-v2 .lb2-pmed small{font-size:12px;color:var(--l2-muted)}
.gs-v2 .lb2-stat{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:0 14px;min-height:48px;border-top:1px solid var(--l2-line);font-size:16px}
.gs-v2 .lb2-stat:first-child{border-top:0}
.gs-v2 .lb2-stat b{font-weight:700}
.gs-v2 .gs-rec{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--l2-surf);border:1px solid var(--l2-line);border-radius:14px;padding:12px 4px}
.gs-v2 .gs-rec.is-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.gs-v2 .gs-rec div{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;text-align:center}
.gs-v2 .gs-rec b{font-size:22px;font-weight:800;color:var(--l2-text);font-variant-numeric:tabular-nums;line-height:1.1}
.gs-v2 .gs-rec span{font-size:13px;color:var(--l2-muted);overflow-wrap:anywhere}
.gs-v2 .gs-wl td{font-variant-numeric:tabular-nums;white-space:nowrap}
.gs-v2 .gs-grid tbody th .lb2-tw{color:var(--l2-text)}`;
// Session 4 (2026-11-02): admin devices only until Matt approves (`_s4`, set at open): ranks, one close, 4.481, one dash.
let _s4 = false;
const v2fmt = (n) => { try { return Number(n).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-US', _s4 ? { useGrouping: 'always' } : undefined); } catch { return String(n); } };
const v2shape = (tier) => `<span class="lb2-shape${tier === 4 ? ' x2' : ''}" aria-hidden="true">${diffShapeSVG(tier)}</span>`;
const CT_IMG = { gold: ['medal-gold.png', 115 / 180], silver: ['medal-silver.png', 114 / 180], bronze: ['medal-bronze.png', 114 / 180], iron: ['medal-iron.png', 114 / 180] };
const ctImg = (k, h) => `<span class="gs-ctm" style="height:${h}px;width:${Math.round(h * CT_IMG[k][1])}px"><img src="${new URL('../icons/' + CT_IMG[k][0], import.meta.url).href}" alt="" draggable="false"></span>`;
/** Commas in 4+ digit tallies; a difficulty word heading a table row gets its shape. */
function v2Polish(html) {
  let out = html.replace(/<div class="gs-tally"><b>(\d{4,})<\/b>/g, (m, n) => `<div class="gs-tally"><b>${v2fmt(Number(n))}</b>`)
    .replace(/<td>(\d{4,})<\/td>/g, (m, n) => `<td>${v2fmt(Number(n))}</td>`)
    .replace(/<span class="gs-gnum"><b>(\d{4,})<\/b>/g, (m, n) => `<span class="gs-gnum"><b>${v2fmt(Number(n))}</b>`)
    .replace(/&mdash;|\u2014/g, (m) => (_s4 ? '\u2013' : m));
  for (const [tr, k] of [[1, 'gs_diff_easy'], [2, 'gs_diff_medium'], [3, 'gs_diff_hard'], [4, 'gs_diff_expert']]) {
    out = out.split(`<th scope="row">${t(k)}</th>`).join(`<th scope="row"><span class="lb2-tw">${v2shape(tr)}${t(k)}</span></th>`);
  }
  return out;
}
/** Contexto, the v2 way (the session 3 mockup): four medals in a row, plain rows, the languages. Same numbers as contextoScreen. */
function contextoV2(rec) {
  const ct = (rec && rec.ct) || {};
  if (!(((rec && rec.total) || {}).played | 0)) return emptyState('Contexto');
  const solved = ct.solved | 0, gold = ct.noHint | 0, silver = ct.silver | 0, bronze = ct.bronze | 0;
  const iron = Math.max(0, solved - gold - silver - bronze);
  const avg = solved > 0 ? (Math.round(((ct.guesses | 0) / solved) * 10) / 10).toString() : '–';
  const mc = (k, n, w) => `<div>${ctImg(k, 34)}<b class="num">${v2fmt(n)}</b><small>${esc(w)}</small></div>`;
  const row = (l, v) => `<div class="lb2-stat"><span>${esc(l)}</span><b class="num">${v}</b></div>`;
  const bd = rec.byDiff || {};
  const langs = [['en', 'gs_ct_lang_en'], ['es', 'gs_ct_lang_es']].map(([k, w]) => `<tr><th scope="row">${esc(t(w))}</th><td>${v2fmt((bd[k] || {}).played | 0)}</td><td>${v2fmt((bd[k] || {}).won | 0)}</td></tr>`).join('');
  return `<div class="lb2-card lb2-pmed">${mc('gold', gold, t('lb_ct_key_gold'))}${mc('silver', silver, t('lb_ct_key_silver'))}${mc('bronze', bronze, t('lb_ct_key_bronze'))}${mc('iron', iron, t('lb_ct_key_none'))}</div>
    <div class="lb2-card">${row(t('gs_ct_solved'), v2fmt(solved))}${row(t('gs_ct_avg'), esc(avg))}${row(t('gs_ct_fewest'), (ct.fewestNH | 0) > 0 ? v2fmt(ct.fewestNH | 0) : '–')}</div>
    <h4 class="gs-tbl-h">${esc(t('gs_lang_h'))}</h4><table class="gs-grid"><thead><tr><th scope="col"></th><th scope="col">${esc(t('gs_ms_played'))}</th><th scope="col">${esc(t('gs_ct_solved'))}</th></tr></thead><tbody>${langs}</tbody></table>`;
}
/** One game's stats in the v2 look (wrap the result in a `.gs-v2` element). */
/** Spelling Bee in the v2 look (Matt, 2026-11-02: the emoji-only tallies "look terrible"): the daily places as
 *  medals in fixed slots with words, one card of named numbers, the language table only when both were played.
 *  Same numbers as spellingBeeScreen (the long-term board, beeTotals). */
function spellingBeeV2(rec, code) {
  const me = code || ((loadProfile() || {}).playerId) || '';
  const b = beeBoard();
  if (!_beeWatching) { _beeWatching = true; watchBeeBoard(() => { if (_game === 'spellingbee') rerender(); }); }
  if (!b) return v2Polish(recordScreen('spellingbee', rec));
  const of = (lang) => beeTotals(b, { lang }).find((r) => r.code === me) || null;
  const all = of('all');
  if (!all) return emptyState(gameLabel('spellingbee'));
  const mc = (k, n, w) => `<div>${ctImg(k, 34)}<b class="num">${v2fmt(n)}</b><small>${esc(w)}</small></div>`;
  const row = (l, v) => `<div class="lb2-stat"><span>${esc(l)}</span><b class="num">${v2fmt(v)}</b></div>`;
  const en = of('en'), es = of('es');
  const line = (label, r) => `<tr><th scope="row">${esc(label)}</th><td>${v2fmt(r.points)}</td><td>${v2fmt(r.words)}</td><td>${v2fmt(r.days)}</td></tr>`;
  const langs = en && es && en.days && es.days ? `<h4 class="gs-tbl-h">${esc(t('gs_lang_h'))}</h4><table class="gs-grid"><thead><tr><th scope="col"></th><th scope="col">${esc(tf('lb_bee_points', 'Points'))}</th><th scope="col">${esc(tf('lb_bee_words', 'Words'))}</th><th scope="col">${esc(t('gs_bee_days'))}</th></tr></thead><tbody>${line('English', en)}${line('Español', es)}</tbody></table>` : '';
  return `<div class="lb2-card lb2-pmed is-3">${mc('gold', all.first, t('gs_bee_1st'))}${mc('silver', all.second, t('gs_bee_2nd'))}${mc('bronze', all.third, t('gs_bee_3rd'))}</div>
    <div class="lb2-card">${row(tf('lb_bee_points', 'Points'), all.points)}${row(tf('lb_bee_words', 'Words'), all.words)}${row(t('gs_sk_days'), all.days)}${row(t('gs_bee_genius'), all.genius)}${row(t('gs_bee_queen'), all.queen)}</div>
    ${langs}`;
}
/** `opts.fresh` (admin devices only, 2026-11-02): the one-vocabulary screens (freshScreenFor). Without it, today's. */
export function v2ScreenFor(id, st, opts) {
  if (id === 'contexto') return contextoV2((st.games || {}).contexto || {});
  if (id === 'spellingbee') return spellingBeeV2((st.games || {}).spellingbee || {}, st.code);
  if (opts && opts.fresh) return v2Polish(freshScreenFor(id, st));
  return v2Polish(screenFor(id, st));
}


// --- My Stats: the board's number and rank per game (session 4 mockup, 2026-11-02) --------------------------
// The SAME people list, number and standing the leaderboard uses (stats-net.js readPeople = the server-built
// board, the hidden-name filter, leaderboard-ui.js lb2PlayerGames = gameStanding). No board (offline, none yet)
// = no rank and the old row, never a guessed one. Display only.
const t2 = makeT(LB2);
let _places = null;           // { [statsId]: { text, tier, rank, tie, noMedal } } or null
const groupAlways = (n) => { try { return Number(n).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-US', { useGrouping: 'always' }); } catch { return String(n); } };
/** The lifetime number under a game's name, singular when it is 1 ("1 win", "1 victoria"). */
function lifeText(head) {
  const n = head.n;
  const one = Number(n) === 1 && t('gs_unit_one', { k: head.unitKey });
  const num = /^\d{4,}$/.test(String(n)) ? groupAlways(n) : String(n);
  return `${num} ${one && one !== 'gs_unit_one' ? one : t(head.unitKey)}`;
}
/** A board number as v2 prints it: golf in words, Contexto's count before its medal, separators, one dash. */
function boardText(id, text) {
  let x = String(text == null ? '' : text);
  const m = id === 'golf' && /^([+\-−])(\d+)$/.exec(x.trim());
  if (m) x = t2(m[1] === '+' ? 'lb2_over' : 'lb2_under', { n: m[2] });
  if (id === 'contexto') x = x.replace(/^(\S+) (\d+)$/u, '$2 $1');
  x = x.replace(/—/g, '–');
  return x.replace(/(?<![\d.,:#&])\d{4,}(?!\d|[.,:]\d)/g, (d) => groupAlways(d));
}
function boardValHTML(id, pl) {
  return `<b class="gs-bv">${pl.tier ? v2shape(pl.tier) : ''}<span>${esc(boardText(id, pl.text))}</span></b>`;
}
let _medalFn = null;
/** The player page's rank badge: a medal for 1st to 3rd ("=" when tied), "#5" / "=5" below, none for a 0. */
function rankHTML(pl) {
  if (!pl || !pl.rank) return '';
  const zero = String(pl.text || '').replace(/[^\d]/g, '') === '0' && !/[1-9]/.test(String(pl.text || ''));
  if (pl.rank <= 3 && !pl.noMedal && !zero && _medalFn) return `<span class="gs-rk">${_medalFn(pl.rank, 32)}</span>`;
  return `<span class="gs-rkp">#${pl.rank}</span>`;
}
function placesFrom(L, list, meKey) {
  const pg = meKey ? L.lb2PlayerGames(list, meKey) : null;
  if (!pg) return null;
  const out = {};
  for (const x of pg.games) out[x.id] = { text: x.text, tier: x.tier, rank: x.rank, tie: x.tie, noMedal: false };
  if (out.holdem) { try { const r = L.lb2Standing(list, 'holdem').find((y) => y.key === meKey); if (r && r.noMedal) out.holdem.noMedal = true; } catch { /* keep */ } }
  return out;
}
async function loadPlaces() {
  try {
    const [net, L, H] = await Promise.all([import('./stats-net.js'), import('./leaderboard-ui.js'), import('./hidden-players.js')]);
    const ppl = await net.readPeople();
    if (!ppl || !_host) return;
    _medalFn = L.lb2Medal;
    _places = placesFrom(L, ppl.list.filter((g) => !H.isHiddenName(g && g.name)), ppl.meKey);
    rerender();
  } catch { /* no board: no ranks */ }
}
/** Tests and the mockup harness: the board's people list and the viewer's key, no network. */
export async function __setBoardForTest(list, meKey) {
  const [L, H] = await Promise.all([import('./leaderboard-ui.js'), import('./hidden-players.js')]);
  _medalFn = L.lb2Medal;
  _places = placesFrom(L, (list || []).filter((g) => !H.isHiddenName(g && g.name)), meKey);
  rerender();
}

// --- overlay shell ----------------------------------------------------------
let _host = null;
let _game = null;             // non-null => drilled into that game's own screenFor
let _st = null;               // the stats to render: local first, then combined-across-devices when online
let _combinedDevices = 1;

function backRow() {
  return `<div class="gs-detail-top">
    <button type="button" class="gs-back" data-role="gs-back">${t('lb_back_games')}</button>
  </div>`;
}

function bodyHTML() {
  const st = _st || { games: {} };
  if (_game) {
    const tab = visibleTabs().find((x) => x.id === _game);
    const rec = (st.games || {})[_game] || {};
    const played = ((rec.total || {}).played) | 0;
    const pl = _places && _places[_game];
    const right = pl ? `<span class="gs-gbd">${boardValHTML(_game, pl)}${rankHTML(pl)}</span>` : '';
    // The new screens (admin, `_s4`) carry Played themselves, so the head card does not repeat it.
    const sub = _s4 && !SOLO.has(_game) ? '' : `<small>${esc(t('lb_played_count', { n: v2fmt(played) }))}</small>`;
    const head = `<div class="gs-ghead"><span class="gs-gart">${GAME_ART[hubIdOf(_game)] || ''}</span><span class="gs-ghn"><b>${esc(tab ? t(tab.labelKey) : _game)}</b>${sub}</span>${right}</div>`;
    return head + v2ScreenFor(_game, st, { fresh: _s4 });
  }
  return v2Polish(overviewHTML(st) + gameListHTML(st.games || {}, _places ? { places: _places } : undefined));
}

function rerender() {
  if (!_host) return;
  const bodyEl = _host.querySelector('[data-role="gs-body"]');
  if (bodyEl) bodyEl.innerHTML = bodyHTML();
  if (_bs) _bs.sync(_game ? 2 : 1);
}
// Matt's 12, item 12 (2026-11-02; admin devices, `_s4`): back to the list lands where it was scrolled, and a game
// opens at its top. The overlay itself is the scroll box.
let _listScroll = 0;
function openGameRow(id) {
  if (_s4 && _host) _listScroll = _host.scrollTop;
  _game = id; rerender();
  if (_s4 && _host) _host.scrollTop = 0;
}
function backToList() {
  _game = null; rerender();
  if (_s4 && _host) _host.scrollTop = _listScroll;
}

/** Fetch every device record and re-render from THIS player's combined (code-aggregated) stats.
 *  Best-effort: offline / unconfigured leaves the local view in place. */
async function refreshCombined() {
  try {
    const [net, agg] = await Promise.all([import('./stats-net.js'), import('./players-agg.js')]);
    // This person's own devices in full + everyone else's name (2026-10-22): a few KB, not all of
    // players/. Same group either way (tools/test-boards.mjs).
    const all = await net.readPlayersForMe();
    if (!_host) return;
    // statsId(), not deviceId(): the fresh local store must overlay THIS player's own remote node.
    // Keyed by device, a second player on a shared phone would overlay (and hide) the first player's
    // record instead of their own.
    const me = agg.aggregateForViewer(all, loadProfile() || {}, statsId(), loadStoredStats(), corrections());
    if (me && me.games) { _st = { games: me.games }; _combinedDevices = me.devices || 1; rerender(); }
  } catch { /* stay local */ }
}

// The phone's back gesture: one history entry per level (list 1, a game 2), js/back-stack.js.
let _bs = null;
function onBackSteps(n) {
  for (let i = 0; i < n && _host; i++) { if (_game) backToList(); else { closeStats(); return; } }
}
function goUp() { if (_bs) _bs.back(); else if (_game) backToList(); else closeStats(); }

function onKey(e) {
  if (e.key !== 'Escape') return;
  goUp();
}

function onClick(e) {
  if (e.target.closest('[data-role="gs-close"]')) { closeStats(); return; }
  // The top-left back (Matt, 2026-10-15: "there's no back button... only an X on the top right"):
  // up one level, a game's page to the list, and from the list out.
  if (e.target.closest('[data-role="gs-up"]')) { goUp(); return; }
  if (e.target.closest('[data-role="gs-back"]')) { goUp(); return; }
  const row = e.target.closest('.gs-grow[data-game]');
  if (row) openGameRow(row.dataset.game);
}

export function closeStats() {
  if (_host) { _host.remove(); _host = null; }
  document.removeEventListener('keydown', onKey);
  if (_bs) { const bs = _bs; _bs = null; bs.close(); }
}

export function openStatsOverlay() {
  ensureCss();
  closeStats();
  _game = null;
  _listScroll = 0;
  // The first paint is local, before the network answers - so it applies the corrections too.
  // Without this, a voided score flashes up for a second and then disappears, which reads as a bug.
  _st = correctStats(loadStoredStats(), statsId(), corrections());
  _combinedDevices = 1;
  _places = null;
  _s4 = isAdminDevice();
  const host = document.createElement('div');
  host.className = _s4 ? 'gs-overlay gs-ov4' : 'gs-overlay';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', t('gs_dialog_aria'));
  host.innerHTML = `
    <div class="gs-scrim" data-role="gs-close"></div>
    <div class="gs-panel gs-v2${_s4 ? ' gs-s4' : ''}">
      <header class="gs-top">
        <div class="gs-top-row">
          <button type="button" class="gs-hback" data-role="gs-up" aria-label="${STRINGS.en.gs_back_aria ? t('gs_back_aria') : 'Back'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
          <h2>${t(_s4 ? 'gs_title_me' : 'gs_title')}</h2>
          ${_s4 ? '' : `<button type="button" class="gs-x" data-role="gs-close" aria-label="${t('gs_close_aria')}">&times;</button>`}
        </div>
      </header>
      <div class="gs-body" data-role="gs-body">${bodyHTML()}</div>
    </div>`;
  host.addEventListener('click', onClick);
  document.body.appendChild(host);
  _host = host;
  document.addEventListener('keydown', onKey);
  _bs = backStack(onBackSteps);
  _bs.sync(1);
  requestAnimationFrame(() => host.classList.add('is-in'));
  refreshCombined();
  if (_s4) loadPlaces();
}

function ensureCss() {
  if (document.getElementById('gs-css')) return;
  const el = document.createElement('style');
  el.id = 'gs-css';
  el.textContent = [
    // overscroll-behavior:contain - see the same rule on `.lb-overlay` in leaderboard-ui.js. Both
    // overlays are position:fixed scroll containers over a scrollable hub, so both chain without it.
    '.gs-overlay{position:fixed;inset:0;z-index:300;opacity:0;transition:opacity .2s ease;overflow-y:auto;overscroll-behavior:contain}',
    '.gs-overlay.is-in{opacity:1}',
    // Compact (admin, session 4, Matt 2026-11-02: "Keep the navigation bar on the bottom of my stats"): stop on the tab bar, like v2.
    'html.gh-compact .gs-overlay.gs-ov4{z-index:19;padding-bottom:calc(53px + max(6px, calc(env(safe-area-inset-bottom,0px) - 16px)))}',
    '.gs-scrim{position:fixed;inset:0;background:rgba(9,24,48,.5)}',
    '.gs-panel{position:relative;width:100%;max-width:560px;margin:0 auto;min-height:100%;background:var(--hub-bg,#f4f6fb);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.gs-top{position:sticky;top:0;z-index:2;padding:max(env(safe-area-inset-top,0px),8px) 18px 0;background:rgba(255,255,255,.94);backdrop-filter:saturate(1.2) blur(6px);border-bottom:1px solid var(--hub-surface-2,#eef2f8)}',
    '.gs-top-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:var(--gh-band-title,44px)}',
    '.gs-top h2{margin:0;font-size:17px;font-weight:600;color:var(--hub-ink,#16243a);flex:1 1 auto;min-width:0}',
    '.gs-hback{appearance:none;flex:none;width:44px;height:44px;margin-left:-10px;display:flex;align-items:center;justify-content:center;background:none;border:0;padding:0;color:var(--hub-ink,#16243a);cursor:pointer;touch-action:manipulation}',
    '.gs-hback svg{width:24px;height:24px}',
    '.gs-x{appearance:none;border:1px solid var(--hub-surface-2,#eef2f8);background:var(--hub-surface,#fff);color:var(--hub-ink,#16243a);font-size:1.4rem;line-height:1;width:38px;height:38px;border-radius:10px;cursor:pointer}',
    '.gs-body{padding:14px 16px 8px;display:grid;gap:14px}',
    '.gs-overview{display:grid;gap:10px}',
    '.gs-ov-id{display:flex;align-items:center;gap:8px;min-height:28px}',
    '.gs-ov-av{font-size:1.4rem;line-height:1}',
    '.gs-ov-name{font-size:1.05rem;font-weight:800;color:var(--hub-ink,#16243a)}',
    // ONE LIST, NOT A STACK OF FLOATING CARDS (2026-09-02). Every row used to be its own bordered,
    // rounded, drop-shadowed card with an 8px gap - twelve games meant twelve shadows and eleven
    // gaps, which is a lot of chrome to say "here are some games". One container, hairline
    // separators, no per-row shadow: denser, quieter, and two more games fit on a phone screen.
    '.gs-glist{display:flex;flex-direction:column;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;overflow:hidden}',
    '.gs-grow{appearance:none;cursor:pointer;display:flex;align-items:center;gap:11px;width:100%;min-height:52px;text-align:left;padding:8px 12px;background:transparent;border:0;font:inherit;color:inherit}',
    '.gs-grow+.gs-grow{border-top:1px solid var(--hub-surface-2,#eef2f8)}',
    '.gs-grow:active{background:var(--hub-surface-2,#eef2f8)}',
    '.gs-gart{flex:0 0 auto;width:46px;height:26px;border-radius:6px;overflow:hidden;line-height:0}',
    '.gs-gart svg{width:100%;height:100%;display:block}',
    '.gs-gname{flex:1 1 auto;min-width:0;font-size:.9rem;font-weight:700;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.gs-gnum{flex:0 0 auto;min-width:56px;display:flex;flex-direction:column;align-items:flex-end;line-height:1.15}',
    '.gs-gnum b{font-size:1rem;font-weight:700;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    '.gs-gnum span{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--hub-muted,#5b6b82)}',
    '.gs-gchev{flex:0 0 auto;color:var(--hub-muted,#5b6b82);font-size:1.1rem;line-height:1}',
    '.gs-detail-top{display:flex;align-items:center;gap:10px;margin:2px 0 4px;min-height:var(--gh-band-title,44px)}',
    '.gs-back{appearance:none;cursor:pointer;padding:7px 11px;font-size:.8rem;font-weight:800;color:var(--hub-muted,#5b6b82);background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:9px;white-space:nowrap}',
    '.gs-tallies{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
    '.gs-tallies.is-4{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}',
    '.gs-tally{background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;padding:12px 4px;text-align:center;box-shadow:0 4px 16px rgba(20,40,80,.06)}',
    '.gs-tally b{display:block;font-size:1.5rem;font-weight:900;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    '.gs-tally span{font-size:.72rem;font-weight:700;color:var(--hub-muted,#5b6b82);text-transform:uppercase;letter-spacing:.04em}',
    '.gs-tbl-h{margin:2px 0 0;font-size:.95rem;font-weight:800;color:var(--hub-ink,#16243a)}',
    '.gs-grid{width:100%;border-collapse:collapse;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(20,40,80,.06)}',
    '.gs-grid th,.gs-grid td{padding:9px 12px;text-align:center;font-size:.9rem}',
    '.gs-grid thead th{background:var(--hub-surface-2,#eef2f8);color:var(--hub-muted,#5b6b82);font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em}',
    '.gs-grid thead th:first-child{width:38%}',
    '.gs-grid tbody th{text-align:left;font-weight:800;color:var(--hub-ink,#16243a)}',
    '.gs-grid tbody td{font-weight:800;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    '.gs-grid tbody tr+tr th,.gs-grid tbody tr+tr td{border-top:1px solid var(--hub-surface-2,#eef2f8)}',
    // Practice racks are real rows, deliberately quieter than the counted ones: they exist, they
    // are visible, and nothing about them should read as part of the record above.
    '.gs-grid tbody tr.gs-prow th,.gs-grid tbody tr.gs-prow td{color:var(--hub-muted,#5b6b82);font-weight:700;font-style:italic}',
    '.gs-cc{display:grid;gap:14px;background:#16211c;border:1px solid #23342c;border-radius:14px;padding:16px;box-shadow:0 6px 22px rgba(9,24,20,.28)}',
    '.gs-cc-sec{display:grid;gap:2px}',
    '.gs-cc-h{margin:0 0 6px;font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#e8b53a}',
    '.gs-cc-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)}',
    '.gs-cc-sec .gs-cc-row:last-child{border-bottom:0}',
    '.gs-cc-k{color:#c9d6cf;font-size:.92rem;font-weight:600}',
    '.gs-cc-v{color:#f4f6fb;font-size:1.05rem;font-weight:900;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.gs-cc-v em{color:#9fb4aa;font-style:normal;font-size:.82rem;font-weight:700}',
    // --- Skeeball, screen 5 (2026-08-25 design handoff) -----------------------------------------
    // 11px is the floor for every caption and unit word here, every control is at least 44px tall,
    // and every numeric slot is tabular-nums and sized for six digits (112,730 is the widest real
    // number in the system).
    '.gs-sk-hero{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    // Both halves are the SAME shape now. They used to be 1.4fr dark against 1fr light with two
    // different type sizes, which read as one card plus an afterthought rather than as the two
    // records they are. Equal width, equal type, one filled and one outlined.
    '.gs-sk-hero-a,.gs-sk-hero-b{border-radius:14px;padding:13px 14px 12px;min-width:0;display:flex;flex-direction:column}',
    '.gs-sk-hero-a{background:var(--hub-ink,#16243a);color:var(--hub-surface,#fff)}',
    '.gs-sk-hero-b{background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);color:var(--hub-ink,#16243a)}',
    '.gs-sk-k{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;opacity:.72}',
    '.gs-sk-hero-a b,.gs-sk-hero-b b{display:block;font-size:40px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.035em;line-height:1;margin-top:5px}',
    '.gs-sk-note{display:block;font-size:11px;opacity:.7;margin-top:5px;line-height:1.3;overflow-wrap:anywhere}',
    // A SUB-LABEL, not a second heading. The lifetime block is three even rows under one heading;
    // this names the middle one without competing with it (h4 is 15px ink, this is 11px muted).
    '.gs-sk-sub{margin:11px 0 -2px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-grid{display:grid;gap:1px;background:var(--hub-surface-2,#eef2f8);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;overflow:hidden}',
    '.gs-sk-grid.is-3{grid-template-columns:repeat(3,1fr)}',
    '.gs-sk-grid.is-2{grid-template-columns:repeat(2,1fr)}',
    '.gs-sk-grid+.gs-sk-grid{margin-top:8px}',
    '.gs-sk-cell{background:var(--hub-surface,#fff);padding:10px 11px 11px;min-width:0}',
    '.gs-sk-cell b{display:block;font-size:19px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--hub-ink,#16243a);line-height:1.05}',
    '.gs-sk-cell span{display:block;font-size:11px;color:var(--hub-muted,#5b6b82);margin-top:2px;line-height:1.25}',
    // The two rare counters (color sweeps, runaways) are two zeros on most records. Same grid,
    // dialled down, so they read as a footnote to the block rather than headline numbers.
    '.gs-sk-grid.is-quiet .gs-sk-cell b{font-size:15px;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-spark{color:var(--hub-accent,#1769d4);margin-top:11px}',
    '.gs-sk-spark-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:5px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-spark-h span+span{letter-spacing:0;text-transform:none;font-weight:600;font-variant-numeric:tabular-nums}',
    '.gs-sk-spark-plot{position:relative}',
    '.gs-sk-spark svg{display:block;width:100%;height:44px;border-radius:8px;background:var(--hub-surface-2,#eef2f8)}',
    '.gs-sk-spark-fill{fill:currentColor;opacity:.16}',
    // The two numbers that make the shape mean something: the high sits at the top of the plot,
    // the low at the bottom, both against the plot's own background rather than over the line.
    '.gs-sk-spark-hi,.gs-sk-spark-lo{position:absolute;right:7px;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--hub-muted,#5b6b82);background:var(--hub-surface-2,#eef2f8);padding:0 2px;border-radius:3px}',
    '.gs-sk-spark-hi{top:2px}',
    '.gs-sk-spark-lo{bottom:2px}',
    '.gs-sk-machines{display:flex;flex-direction:column;gap:10px}',
    // The cabinet's OWN colour (skeeball/js/boards.js `look`) rides the card as a left rail plus
    // the swatch beside the name, so the card is identifiable at a glance and still names itself
    // in words - colour is never the only signal (Matt is red/green colorblind).
    '.gs-sk-mc{border:1px solid var(--hub-surface-2,#eef2f8);border-left:5px solid var(--mc,#8a93a3);border-radius:12px;background:var(--hub-surface,#fff);padding:12px 14px 13px}',
    '.gs-sk-mc-id{display:flex;align-items:center;gap:7px;min-width:0}',
    '.gs-sk-mark{width:9px;height:9px;flex:none;border-radius:2px;background:var(--mc,#8a93a3);border:1px solid var(--hub-ink,#16243a)}',
    '.gs-sk-nm{font-size:13px;font-weight:800;letter-spacing:.05em;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // Four numbers, one row, no disclosure. minmax(0,1fr) rather than 1fr so a six-digit points
    // total shrinks its own column instead of pushing the row wider than the card.
    '.gs-sk-mc-nums{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:10px}',
    '.gs-sk-mn{min-width:0}',
    '.gs-sk-mn b{display:block;font-size:21px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.03em;line-height:1;color:var(--hub-ink,#16243a)}',
    '.gs-sk-mn span{display:block;font-size:11px;color:var(--hub-muted,#5b6b82);font-weight:600;margin-top:4px;line-height:1.2}',
    // A machine nobody has earned still appears, so three machines always read as three machines.
    '.gs-sk-locked{display:flex;align-items:center;gap:9px;min-height:44px;border:1px dashed var(--hub-surface-2,#eef2f8);border-radius:10px;padding:11px 13px;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-locked svg{width:15px;height:15px;flex:none}',
    '.gs-sk-locked .gs-sk-nm{flex:1;min-width:0;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-lock-tag{flex:none;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;border:1px solid var(--hub-surface-2,#eef2f8);padding:3px 6px;border-radius:4px}',
    // Practice racks sit apart on purpose - dashed, muted, under their own label - so they can
    // never be mistaken for part of the record (see skPracticeHTML).
    '.gs-sk-practice{border:1px dashed var(--hub-surface-2,#eef2f8);border-radius:10px;padding:10px 12px 11px;display:flex;flex-direction:column;gap:7px}',
    '.gs-sk-practice-h{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-prow{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:11.5px;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-prow .gs-sk-nm{flex:1 1 100%;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-prow b{font-weight:800;font-variant-numeric:tabular-nums;color:var(--hub-ink,#16243a)}',
    // The per-hole record strip: eighteen numbers on one line per course, wrapping on a phone. It
    // SCROLLS INSIDE ITSELF rather than widening the overlay - a fixed overlay that grows sideways
    // takes the whole page with it (root CLAUDE.md's scroll rules).
    '.gs-gf-holes{margin:8px 0 4px}',
    '.gs-gf-hname{font-size:12px;font-weight:700;color:var(--hub-muted,#5b6b82);margin:0 0 4px}',
    '.gs-gf-row{display:flex;gap:4px;overflow-x:auto;overscroll-behavior:contain;padding-bottom:4px}',
    '.gs-gf-cell{flex:0 0 auto;min-width:30px;display:flex;flex-direction:column;align-items:center;'
      + 'background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:8px;padding:4px 2px}',
    '.gs-gf-cell b{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--hub-ink,#16243a)}',
    '.gs-gf-cell i{font-style:normal;font-size:11px;color:var(--hub-muted,#5b6b82)}',
    '.gs-gf-cell.is-empty b{color:var(--hub-muted,#9aa8bb)}',
    '.gs-pkbest{display:flex;justify-content:center;gap:6px;margin:-4px 0 14px}',
    '.gs-pkc{min-width:40px;padding:6px 4px;border-radius:7px;background:#fff;color:#111;border:1px solid #c9d2df;font-weight:800;font-size:1rem;text-align:center}',
    '.gs-pkc.is-red{color:#c8102e}',
    '.gs-none{margin:0;color:var(--hub-muted,#5b6b82);font-size:.9rem;font-weight:600;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;padding:22px 16px;text-align:center}',
    '.gs-foot{text-align:center;color:var(--hub-muted,#5b6b82);font-size:.78rem;padding:10px 16px 40px;margin:0}',
    V2_CSS,
  ].join('');
  document.head.appendChild(el);
}

// Exported for the Leaderboard's player detail screen (HANDOFF-FB2-STATS-NAV.md): it hands
// screenFor() an aggregated player's `games` map instead of the local loadStoredStats(), reusing these
// exact per-game renderers so the two overlays never diverge on how a game's stats look, and
// reuses gameListHTML() (defined above) to render the SAME game-list drill-down My Stats uses.
// `ensureStatsCss` re-injects (id-guarded, so a second call is a no-op) the SAME `#gs-css` sheet
// My Stats uses, so the reused markup (gs-tallies/gs-grid/gs-glist/etc) renders identically there.
export { screenFor, ensureCss as ensureStatsCss };

export default { openStatsOverlay, closeStats };
