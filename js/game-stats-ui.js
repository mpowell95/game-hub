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

import { loadStats, statsId } from './game-stats.js';
import { loadProfile } from './profile-store.js';
import { isDevProfile } from './challenge/hooks.js';
import { isGameLive, corrections } from './admin-config.js';
import { correctStats } from './stats-corrections.js';
import { makeT } from './i18n.js';
import STRINGS from './strings.js';
import { GAME_ART } from './game-art.js';
import { SOLO } from './players-agg.js';
import { record } from './leaderboard-rank.js';

const t = makeT(STRINGS);

// Tab labels resolve through js/strings.js's game_title_* keys — the SAME keys the leaderboard
// uses, so the two overlays can never disagree on a game's name (Matt, 2026-07-23: titles
// translate, Spain Spanish; the hub registry carries matching {en,es} titles).
const TABS = [
  { id: 'connect4', labelKey: 'game_title_connect4' },
  { id: 'chinchon', labelKey: 'game_title_chinchon' },
  { id: 'business', labelKey: 'game_title_business' },
  { id: 'parchis', labelKey: 'game_title_parchis' },
  { id: 'nutsbolts', labelKey: 'game_title_nutsbolts' },
  { id: 'pipes', labelKey: 'game_title_pipes' },
  { id: 'escoba', labelKey: 'game_title_escoba' },
  { id: 'filler', labelKey: 'game_title_filler' },
  { id: 'mancala', labelKey: 'game_title_mancala' },
  { id: 'ballrun', labelKey: 'game_title_ballrun' },
  { id: 'tictactoe', labelKey: 'game_title_tictactoe' },
  { id: 'dotsboxes', labelKey: 'game_title_dotsboxes' },
  { id: 'boggle', labelKey: 'game_title_boggle' },
  { id: 'snake', labelKey: 'game_title_snake' },
  { id: 'uno', labelKey: 'game_title_uno' },
  { id: 'pool', labelKey: 'game_title_pool' },
  // retired: the rebuild was promoted to 'pool'. Kept so anything already recorded here stays
  // visible (THE LAW rules 1 and 5); hidden automatically for anyone with zero plays.
  { id: 'poolv2', labelKey: 'game_title_poolv2' },
  { id: 'yahtzee', labelKey: 'game_title_yahtzee' },
  { id: 'dominoes', labelKey: 'game_title_dominoes' },
  { id: 'hillclimb', labelKey: 'game_title_hillclimb' },
  { id: 'battleship', labelKey: 'game_title_battleship' },
  // NOT devOnly, unlike Pinball's row above, and the difference is deliberate. Pinball has been
  // admin-only since birth, so nobody outside the dev profiles can have plays and gating its tab
  // costs no one anything. Skeeball was LIVE to the family for a couple of hours on 2026-08-11
  // before being pulled back to admin-only, so someone may have real plays recorded - and hiding
  // this row would make their own history invisible to them (THE LAW rule 1). It costs nothing to
  // leave open: gameListHTML only renders a row for a game with plays, so anyone who never played
  // it sees nothing here either way.
  { id: 'skeeball', labelKey: 'game_title_skeeball' },
  // Unreleased: the tab renders only for Matt and the tester, matching the hub card's devOnly gate.
  { id: 'pinball', labelKey: 'game_title_pinball', devOnly: true },
];

// Hub registry id (for GAME_ART thumbnails) and headline-unit key, per stats id. Single source
// for both this overlay's game list and the Leaderboard's player detail (leaderboard-ui.js
// imports these instead of keeping its own copy), so the two screens can never disagree on a
// game's thumbnail or unit label. Verified against js/hub.js's GAMES registry (root CLAUDE.md,
// "Adding a game" item 7 warning).
const HUB_ID = {
  connect4: 'connect-four', nutsbolts: 'nuts-bolts', tictactoe: 'tic-tac-toe',
  dotsboxes: 'dots-boxes', ballrun: 'ball-run', business: 'business-deal',
  hillclimb: 'hill-climb',
};
export const hubIdOf = (id) => HUB_ID[id] || id;
const UNIT_KEY = { ballrun: 'lb_unit_obstacles', snake: 'lb_unit_longest', nutsbolts: 'lb_unit_solved', pipes: 'lb_unit_solved', hillclimb: 'lb_unit_meters', pinball: 'lb_unit_points', skeeball: 'lb_unit_points' };
export const unitKeyOf = (id) => UNIT_KEY[id] || 'lb_unit_wins';

/** Every game, as { id (stats id), hubId, title } in the ACTIVE language, alphabetical by the
 *  displayed title. Exported for js/bug-report-ui.js's "Where did it happen?" picker, which needs
 *  the same list of games under the same names but must not import js/hub.js for it (the same
 *  reason the Leaderboard doesn't). Derived from TABS + the shared game_title_* keys, so a new
 *  game appears here the moment it is added there and can never be named differently. */
export function gameChoices() {
  return TABS
    // The retired Pool build: it stays in TABS so already-recorded plays remain visible (THE LAW
    // rules 1 and 5), but nobody can be playing it today, so it is not a place a bug can happen.
    .filter((tab) => tab.id !== 'poolv2')
    .map((tab) => ({ id: tab.id, hubId: hubIdOf(tab.id), title: t(tab.labelKey) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The tabs this profile may see. A devOnly tab renders for Matt and the tester - and for everyone
 *  the day Matt releases that game from the admin page (js/admin-config.js), which is the same
 *  resolved answer the hub card uses. Without that second half, a game released from inside the app
 *  would appear on the launcher with no stats screen behind it. */
function visibleTabs() {
  let dev = false;
  try { const p = loadProfile(); dev = !!(p && isDevProfile(p.name)); } catch { /* stay hidden */ }
  return TABS.filter((tab) => !tab.devOnly || dev || isGameLive(hubIdOf(tab.id), !tab.devOnly));
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

/** Pipes: a solo puzzle like Nuts & Bolts, so no wins/losses/win-rate - you cannot lose a board,
 *  only keep turning. Boards solved, the hardest tier cleared, and the turns it took.
 *
 *  ITEM 7's SECOND EDIT. Storing a counter is not enough: history no screen shows reads as
 *  deleted (THE LAW rule 1), so a sub-counter without a renderer is a bug, not a shortcut. */
function pipesScreen(rec) {
  const pi = (rec && rec.pi) || {};
  const solved = pi.solved | 0, moves = pi.moves | 0, best = pi.bestLevel | 0;
  if (!solved) return emptyState('Pipes');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${solved}</b><span>${t('gs_pi_solved')}</span></div>
      <div class="gs-tally"><b>${best}</b><span>${t('gs_pi_best')}</span></div>
      <div class="gs-tally"><b>${moves}</b><span>${t('gs_pi_moves')}</span></div>
      <div class="gs-tally"><b>${Math.round(moves / solved)}</b><span>${t('gs_pi_avg')}</span></div>
    </div>`;
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
  popongo: { name: 'POPONGO', color: '#c9a36a' },
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
 *  one-point line says nothing a number has not already said. */
function skSparkHTML(daily) {
  const days = Object.keys(daily || {}).sort();
  if (days.length < 2) return '';
  const vals = days.map((d) => daily[d] | 0);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = Math.max(1, max - min);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * 316 + 2).toFixed(1)},${(34 - (v - min) / span * 28).toFixed(1)}`).join(' ');
  return `<div class="gs-sk-spark">
    <div class="gs-sk-spark-h"><span>${esc(t('gs_sk_best_per_day'))}</span><span>${esc(t('gs_sk_days_span', { n: days.length }))}</span></div>
    <svg viewBox="0 0 320 40" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline></svg>
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
  const ids = Object.keys(prac).filter((id) => ((prac[id] || {}).plays | 0) > 0);
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

/** One machine the player has actually thrown on: best game and points always visible, everything
 *  else behind a disclosure that starts closed (including the first machine's). */
function skMachineCardHTML(id, b) {
  const meta = skMachineMeta(id);
  const detail = [
    [t('gs_sk_games'), skNum(b.plays | 0)],
    [t('gs_sk_best_throw'), skNum(b.bestThrow | 0)],
  ].map(([k, v]) => `<div class="gs-sk-d"><span>${esc(k)}</span><b>${v}</b></div>`).join('');
  return `<div class="gs-sk-mc">
    <div class="gs-sk-mc-top">
      <span class="gs-sk-stripe" style="background:${meta.color}"></span>
      <div class="gs-sk-mc-body">
        <div class="gs-sk-mc-id"><span class="gs-sk-mark" style="background:${meta.color}"></span><span class="gs-sk-nm">${esc(meta.name)}</span></div>
        <div class="gs-sk-mc-nums">
          <div><b>${skNum(b.best | 0)}</b><span>${esc(t('gs_sk_best_game'))}</span></div>
          <div><b>${skNum(b.points | 0)}</b><span>${esc(t('gs_sk_points'))}</span></div>
        </div>
      </div>
    </div>
    <details class="gs-sk-more">
      <summary><span class="gs-sk-more-lbl">${esc(t('gs_sk_more'))}</span><span class="gs-sk-more-hint">${esc(t('gs_sk_games_hint', { n: b.plays | 0 }))}</span></summary>
      <div class="gs-sk-more-body">
        <div class="gs-sk-dgrid">${detail}</div>
        ${skSparkHTML(b.daily)}
      </div>
    </details>
  </div>`;
}

function skeeballScreen(rec) {
  const sk = (rec && rec.sk) || {};
  if (!(sk.played | 0)) return emptyState('Skeeball');
  const boards = sk.boards || {};
  // Known machines first, in the game's own unlock-chain order, then ANY other id the store
  // happens to hold (see skMachineMeta) so no recorded machine can fall off this screen.
  const known = Object.keys(SK_MACHINES);
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
  }
  // The best throw's note is the count of balls at that exact value, and only when the value maps
  // to a counter the store actually keeps. Anything else gets no note.
  const throwCounts = { 10: sk.tens, 20: sk.twenties, 30: sk.thirties, 40: sk.forties, 50: sk.fifties, 100: sk.hundreds };
  const throwN = throwCounts[sk.bestThrow | 0];
  const throwNote = throwN == null ? '' : t('gs_sk_hit_times', { n: Number(throwN).toLocaleString() });

  const lifetime = [
    [skNum(sk.played | 0), t('gs_sk_games')],
    [skNum(sk.balls | 0), t('gs_sk_balls')],
    [skNum(sk.points | 0), t('gs_sk_points')],
    [skNum(sk.hundreds), t('gs_sk_hundreds')],
    [skNum(sk.fifties), t('gs_sk_fifties')],
    [skNum(sk.colorSweeps), t('gs_sk_sweeps')],
    [skNum(sk.runaways), t('gs_sk_runaways')],
  ].map(([v, l]) => `<div class="gs-sk-cell"><b>${v}</b><span>${esc(l)}</span></div>`).join('');

  const ballRows = [
    [t('gs_sk_tens'), sk.tens], [t('gs_sk_twenties'), sk.twenties],
    [t('gs_sk_thirties'), sk.thirties], [t('gs_sk_forties'), sk.forties],
  ];
  const hasBalls = ballRows.some(([, v]) => v != null);
  const ballBreakdown = !hasBalls ? '' : `<details class="gs-sk-more is-flat">
    <summary><span class="gs-sk-more-lbl">${esc(t('gs_sk_every_ball'))}</span><span class="gs-sk-more-hint">${esc(t('gs_sk_ball_hint'))}</span></summary>
    <div class="gs-sk-balls">${ballRows.map(([l, v]) => `<div class="gs-sk-d"><span>${esc(l)}</span><b>${skNum(v)}</b></div>`).join('')}</div>
  </details>`;

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
        ${bestNote ? `<span class="gs-sk-note">${esc(bestNote)}</span>` : ''}
      </div>
      <div class="gs-sk-hero-b">
        <div>
          <span class="gs-sk-k">${esc(t('gs_sk_best_throw'))}</span>
          <b>${skNum(sk.bestThrow | 0)}</b>
        </div>
        ${throwNote ? `<span class="gs-sk-note">${esc(throwNote)}</span>` : ''}
      </div>
    </div>
    <h4 class="gs-tbl-h">${esc(t('gs_sk_lifetime_h', { n: playedIds.length }))}</h4>
    <div class="gs-sk-grid">${lifetime}</div>
    ${ballBreakdown}
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
  if (id === 'pinball') return !!(rec.pb && rec.pb.games);
  if (id === 'nutsbolts') return !!(rec.nb && rec.nb.solved);
  if (id === 'pipes') return !!(rec.pi && rec.pi.solved);
  if (id === 'skeeball') return !!(rec.sk && rec.sk.played);
  return ((rec.total || {}).played | 0) > 0;
}

/** The headline number + unit for a game's row in the shared game-list drill-down: wins
 *  (the stored `won` counter, ties excluded — the same maths the leaderboard uses) for
 *  competitive games, the game's own solo metric for Ball Run/Snake/Nuts & Bolts. */
function headlineOf(id, rec) {
  if (id === 'ballrun') return { n: Math.max((rec.br && rec.br.bestObstacles) | 0, (rec.brOrbital && rec.brOrbital.bestObstacles) | 0), unitKey: unitKeyOf(id) };
  if (id === 'snake') return { n: (rec.sn && rec.sn.bestLen) | 0, unitKey: unitKeyOf(id) };
  if (id === 'hillclimb') return { n: (rec.hc && rec.hc.bestDistance) | 0, unitKey: unitKeyOf(id) };
  if (id === 'pinball') return { n: (rec.pb && rec.pb.bestScore) | 0, unitKey: unitKeyOf(id) };
  if (id === 'skeeball') return { n: (rec.sk && rec.sk.bestGame) | 0, unitKey: unitKeyOf(id) };
  if (id === 'nutsbolts') return { n: (rec.nb && rec.nb.solved) | 0, unitKey: unitKeyOf(id) };
  if (id === 'pipes') return { n: (rec.pi && rec.pi.solved) | 0, unitKey: unitKeyOf(id) };
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
export function gameListHTML(games) {
  const g = games || {};
  const rows = visibleTabs()
    .filter((tab) => hasPlays(tab.id, g[tab.id] || {}))
    .sort((a, b) => t(a.labelKey).localeCompare(t(b.labelKey)))
    .map((tab) => {
      const rec = g[tab.id] || {};
      const head = headlineOf(tab.id, rec);
      const art = GAME_ART[hubIdOf(tab.id)] || '';
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
  let plays = 0, wins = 0, runs = 0;
  for (const tab of visibleTabs()) {
    const tot = (g[tab.id] || {}).total || {};
    plays += tot.played | 0;
    if (SOLO.has(tab.id)) runs += tot.played | 0;
    else wins += record(tot).wins;
  }
  return { plays, wins, runs };
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
      </div>
    </div>`;
}

// --- Pinball (solo, score-attack, table-tiered) -----------------------------
// The three TABLE settings are this game's difficulty axis, so byDiff's easy/medium/hard buckets
// are shown under the names the game itself uses (Hill Climb's by-stage table is the precedent).
// Deliberately NOT the shared diffTable(): that renders W-L and a win rate, and a pinball game has
// no loss axis at all, so every row would read "2-0, 100%" - a true number that means nothing.
const PB_TABLES = [['easy', 'gs_pb_casual'], ['medium', 'gs_pb_standard'], ['hard', 'gs_pb_tournament']];


/** Pinball: no wins or losses (a game ends when the last ball drains), so the honest numbers are
 *  games played and the best score, exactly like Ball Run's, Snake's and Hill Climb's screens.
 *  Best ball gets its own tile because it is the number pinball players actually compare, and the
 *  lifetime jackpot / multiball / mission counts are the only record of HOW a score was built.
 *  Average is derived at render time from `points` and `games`, never stored (a stored average
 *  would be a value that can go DOWN, which has no business in the shared store). */
function pinballScreen(rec) {
  const pb = (rec && rec.pb) || {};
  const games = pb.games | 0;
  if (!games) return emptyState('Pinball');
  const avg = games > 0 ? Math.round((pb.points | 0) / games) : 0;
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${(pb.bestScore | 0).toLocaleString()}</b><span>${t('gs_pb_best')}</span></div>
      <div class="gs-tally"><b>${(pb.bestBall | 0).toLocaleString()}</b><span>${t('gs_pb_bestball')}</span></div>
      <div class="gs-tally"><b>${games}</b><span>${t('gs_played')}</span></div>
      <div class="gs-tally"><b>${avg.toLocaleString()}</b><span>${t('gs_pb_avg')}</span></div>
    </div>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${pb.missions | 0}</b><span>${t('gs_pb_missions')}</span></div>
      <div class="gs-tally"><b>${pb.multiballs | 0}</b><span>${t('gs_pb_multiballs')}</span></div>
      <div class="gs-tally"><b>${pb.jackpots | 0}</b><span>${t('gs_pb_jackpots')}</span></div>
      <div class="gs-tally"><b>${pb.ramps | 0}</b><span>${t('gs_pb_ramps')}</span></div>
    </div>
    <h4 class="gs-tbl-h">${t('gs_pb_by_table')}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">${t('gs_played')}</th></tr></thead>
      <tbody>${PB_TABLES.map(([k, labelKey]) =>
        `<tr><th scope="row">${t(labelKey)}</th><td>${((rec && rec.byDiff && rec.byDiff[k] && rec.byDiff[k].played) | 0)}</td></tr>`).join('')}</tbody>
    </table>`;
}

function screenFor(id, st) {
  const rec = (st.games && st.games[id]) || {};
  if (id === 'connect4') return connect4Screen(rec);
  if (id === 'chinchon') return chinchonScreen(rec);
  if (id === 'nutsbolts') return nutsBoltsScreen(rec);
  if (id === 'pipes') return pipesScreen(rec);
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
  if (id === 'pinball') return pinballScreen(rec);
  return recordScreen(id, rec);   // business, parchis
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
  if (_game) return backRow() + screenFor(_game, st);
  return overviewHTML(st) + gameListHTML(st.games || {});
}

function rerender() {
  if (!_host) return;
  const bodyEl = _host.querySelector('[data-role="gs-body"]');
  if (bodyEl) bodyEl.innerHTML = bodyHTML();
}

/** Fetch every device record and re-render from THIS player's combined (code-aggregated) stats.
 *  Best-effort: offline / unconfigured leaves the local view in place. */
async function refreshCombined() {
  try {
    const [net, agg] = await Promise.all([import('./stats-net.js'), import('./players-agg.js')]);
    const all = await net.readPlayersOnce();
    if (!_host) return;
    // statsId(), not deviceId(): the fresh local store must overlay THIS player's own remote node.
    // Keyed by device, a second player on a shared phone would overlay (and hide) the first player's
    // record instead of their own.
    const me = agg.aggregateForViewer(all, loadProfile() || {}, statsId(), loadStats(), corrections());
    if (me && me.games) { _st = { games: me.games }; _combinedDevices = me.devices || 1; rerender(); }
  } catch { /* stay local */ }
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (_game) { _game = null; rerender(); return; }
  closeStats();
}

function onClick(e) {
  if (e.target.closest('[data-role="gs-close"]')) { closeStats(); return; }
  if (e.target.closest('[data-role="gs-back"]')) { _game = null; rerender(); return; }
  const row = e.target.closest('.gs-grow[data-game]');
  if (row) { _game = row.dataset.game; rerender(); }
}

export function closeStats() { if (_host) { _host.remove(); _host = null; } document.removeEventListener('keydown', onKey); }

export function openStatsOverlay() {
  ensureCss();
  closeStats();
  _game = null;
  // The first paint is local, before the network answers - so it applies the corrections too.
  // Without this, a voided score flashes up for a second and then disappears, which reads as a bug.
  _st = correctStats(loadStats(), statsId(), corrections());
  _combinedDevices = 1;
  const host = document.createElement('div');
  host.className = 'gs-overlay';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', t('gs_dialog_aria'));
  host.innerHTML = `
    <div class="gs-scrim" data-role="gs-close"></div>
    <div class="gs-panel">
      <header class="gs-top">
        <div class="gs-top-row">
          <h2>${t('gs_title')}</h2>
          <button type="button" class="gs-x" data-role="gs-close" aria-label="${t('gs_close_aria')}">&times;</button>
        </div>
      </header>
      <div class="gs-body" data-role="gs-body">${bodyHTML()}</div>
    </div>`;
  host.addEventListener('click', onClick);
  document.body.appendChild(host);
  _host = host;
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => host.classList.add('is-in'));
  refreshCombined();
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
    '.gs-scrim{position:fixed;inset:0;background:rgba(9,24,48,.5)}',
    '.gs-panel{position:relative;width:100%;max-width:560px;margin:0 auto;min-height:100%;background:var(--hub-bg,#f4f6fb);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.gs-top{position:sticky;top:0;z-index:2;padding:max(env(safe-area-inset-top,0px),8px) 18px 0;background:rgba(255,255,255,.94);backdrop-filter:saturate(1.2) blur(6px);border-bottom:1px solid var(--hub-surface-2,#eef2f8)}',
    '.gs-top-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:var(--gh-band-title,44px)}',
    '.gs-top h2{margin:0;font-size:17px;font-weight:600;color:var(--hub-ink,#16243a)}',
    '.gs-x{appearance:none;border:1px solid var(--hub-surface-2,#eef2f8);background:var(--hub-surface,#fff);color:var(--hub-ink,#16243a);font-size:1.4rem;line-height:1;width:38px;height:38px;border-radius:10px;cursor:pointer}',
    '.gs-body{padding:14px 16px 8px;display:grid;gap:14px}',
    '.gs-overview{display:grid;gap:10px}',
    '.gs-ov-id{display:flex;align-items:center;gap:8px;min-height:28px}',
    '.gs-ov-av{font-size:1.4rem;line-height:1}',
    '.gs-ov-name{font-size:1.05rem;font-weight:800;color:var(--hub-ink,#16243a)}',
    '.gs-glist{display:flex;flex-direction:column;gap:8px}',
    '.gs-grow{appearance:none;cursor:pointer;display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 11px;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;box-shadow:0 4px 16px rgba(20,40,80,.06);font:inherit;color:inherit}',
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
    '.gs-sk-hero{display:flex;gap:10px}',
    '.gs-sk-hero-a{flex:1.4;background:var(--hub-ink,#16243a);color:var(--hub-surface,#fff);border-radius:12px;padding:14px 15px;min-width:0}',
    '.gs-sk-hero-b{flex:1;background:var(--hub-surface-2,#eef2f8);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;padding:14px 15px;min-width:0;display:flex;flex-direction:column;justify-content:space-between;color:var(--hub-ink,#16243a)}',
    '.gs-sk-k{display:block;font-size:11px;letter-spacing:.13em;text-transform:uppercase;font-weight:800;opacity:.72}',
    '.gs-sk-hero-a b{display:block;font-size:46px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.035em;line-height:1;margin-top:4px}',
    '.gs-sk-hero-b b{display:block;font-size:34px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.03em;line-height:1;margin-top:4px}',
    '.gs-sk-note{display:block;font-size:11px;opacity:.72;margin-top:6px;overflow-wrap:anywhere}',
    '.gs-sk-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:var(--hub-surface-2,#eef2f8);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:10px;overflow:hidden}',
    '.gs-sk-cell{background:var(--hub-surface,#fff);padding:11px 10px 12px;min-width:0}',
    '.gs-sk-cell b{display:block;font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--hub-ink,#16243a);line-height:1.1}',
    '.gs-sk-cell span{display:block;font-size:11px;color:var(--hub-muted,#5b6b82);margin-top:3px;line-height:1.25}',
    // The disclosures are native <details>: no JS state to thread through two overlays, and the
    // reduced-motion behaviour is the browser's already.
    '.gs-sk-more{border:1px solid var(--hub-surface-2,#eef2f8);border-radius:0 0 10px 10px;border-top:0;overflow:hidden}',
    '.gs-sk-more.is-flat{border-radius:10px;border-top:1px solid var(--hub-surface-2,#eef2f8);margin-top:-4px}',
    '.gs-sk-more summary{list-style:none;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 14px;cursor:pointer;font-size:12.5px;font-weight:800;color:var(--hub-accent,#1769d4);background:var(--hub-surface,#fff)}',
    '.gs-sk-more summary::-webkit-details-marker{display:none}',
    '.gs-sk-more-hint{font-weight:600;color:var(--hub-muted,#5b6b82);font-variant-numeric:tabular-nums}',
    '.gs-sk-more[open] .gs-sk-more-hint{display:none}',
    '.gs-sk-more-body{border-top:1px solid var(--hub-surface-2,#eef2f8);padding:12px 14px 14px;display:flex;flex-direction:column;gap:12px;background:var(--hub-surface,#fff)}',
    '.gs-sk-dgrid,.gs-sk-balls{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}',
    '.gs-sk-balls{border-top:1px solid var(--hub-surface-2,#eef2f8);padding:12px 14px 14px;background:var(--hub-surface,#fff)}',
    '.gs-sk-d{display:flex;align-items:baseline;justify-content:space-between;gap:8px;border-bottom:1px dotted var(--hub-surface-2,#eef2f8);padding-bottom:5px;min-width:0}',
    '.gs-sk-d span{font-size:11.5px;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-d b{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--hub-ink,#16243a)}',
    '.gs-sk-spark{color:var(--hub-accent,#1769d4)}',
    '.gs-sk-spark-h{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--hub-muted,#5b6b82)}',
    '.gs-sk-spark-h span+span{letter-spacing:0;text-transform:none;font-weight:600;font-variant-numeric:tabular-nums}',
    '.gs-sk-spark svg{display:block;width:100%;height:40px;border:1px solid var(--hub-surface-2,#eef2f8);border-radius:6px;background:var(--hub-surface-2,#eef2f8)}',
    '.gs-sk-machines{display:flex;flex-direction:column;gap:10px}',
    '.gs-sk-mc{border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;overflow:hidden;background:var(--hub-surface,#fff)}',
    '.gs-sk-mc-top{display:flex;align-items:stretch}',
    // The stripe and the mark are the cabinet's OWN colour (skeeball/js/boards.js `look`), so the
    // swatch is visibly the same object the player throws at. The colour is decoration; the NAME
    // is the identifier, which is why both are always drawn together.
    '.gs-sk-stripe{width:6px;flex:none;border-right:1px solid var(--hub-surface-2,#eef2f8)}',
    '.gs-sk-mc-body{flex:1;min-width:0;padding:13px 14px}',
    '.gs-sk-mc-id{display:flex;align-items:center;gap:7px;min-width:0}',
    '.gs-sk-mark{width:9px;height:9px;flex:none;border-radius:2px;border:1px solid var(--hub-ink,#16243a)}',
    '.gs-sk-nm{font-size:13px;font-weight:800;letter-spacing:.05em;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.gs-sk-mc-nums{display:flex;gap:22px;margin-top:11px}',
    '.gs-sk-mc-nums b{display:block;font-size:26px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.03em;line-height:1;color:var(--hub-ink,#16243a)}',
    '.gs-sk-mc-nums span{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--hub-muted,#5b6b82);font-weight:700;margin-top:4px}',
    '.gs-sk-mc .gs-sk-more{border:0;border-top:1px solid var(--hub-surface-2,#eef2f8);border-radius:0}',
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
    '.gs-none{margin:0;color:var(--hub-muted,#5b6b82);font-size:.9rem;font-weight:600;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;padding:22px 16px;text-align:center}',
    '.gs-foot{text-align:center;color:var(--hub-muted,#5b6b82);font-size:.78rem;padding:10px 16px 40px;margin:0}',
  ].join('');
  document.head.appendChild(el);
}

// Exported for the Leaderboard's player detail screen (HANDOFF-FB2-STATS-NAV.md): it hands
// screenFor() an aggregated player's `games` map instead of the local loadStats(), reusing these
// exact per-game renderers so the two overlays never diverge on how a game's stats look, and
// reuses gameListHTML() (defined above) to render the SAME game-list drill-down My Stats uses.
// `ensureStatsCss` re-injects (id-guarded, so a second call is a no-op) the SAME `#gs-css` sheet
// My Stats uses, so the reused markup (gs-tallies/gs-grid/gs-glist/etc) renders identically there.
export { screenFor, ensureCss as ensureStatsCss };

export default { openStatsOverlay, closeStats };
