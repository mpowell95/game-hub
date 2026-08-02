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
  { id: 'poolv2', labelKey: 'game_title_poolv2' },
  { id: 'yahtzee', labelKey: 'game_title_yahtzee' },
  { id: 'dominoes', labelKey: 'game_title_dominoes' },
];

// Hub registry id (for GAME_ART thumbnails) and headline-unit key, per stats id. Single source
// for both this overlay's game list and the Leaderboard's player detail (leaderboard-ui.js
// imports these instead of keeping its own copy), so the two screens can never disagree on a
// game's thumbnail or unit label. Verified against js/hub.js's GAMES registry (root CLAUDE.md,
// "Adding a game" item 7 warning).
const HUB_ID = {
  connect4: 'connect-four', nutsbolts: 'nuts-bolts', tictactoe: 'tic-tac-toe',
  dotsboxes: 'dots-boxes', ballrun: 'ball-run', business: 'business-deal',
};
export const hubIdOf = (id) => HUB_ID[id] || id;
const UNIT_KEY = { ballrun: 'lb_unit_obstacles', snake: 'lb_unit_longest', nutsbolts: 'lb_unit_solved' };
export const unitKeyOf = (id) => UNIT_KEY[id] || 'lb_unit_wins';

/** The tabs this profile may see. devOnly tabs render only for Matt and the tester. */
function visibleTabs() {
  let dev = false;
  try { const p = loadProfile(); dev = !!(p && isDevProfile(p.name)); } catch { /* stay hidden */ }
  return TABS.filter((tab) => !tab.devOnly || dev);
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

/** Escoba: the standard record-vs-AI screen plus the escoba counter. */
function escobaScreen(rec) {
  const total = (rec && rec.total) || { played: 0 };
  if (!(total.played | 0)) return emptyState('Escoba');
  const es = (rec && rec.es) || {};
  return recordScreen('escoba', rec) + `
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

/** Whether a game has ANY recorded play, matching each screen's own empty-state gate exactly —
 *  the same visibility bar the game list must honor (THE LAW rule 1: nothing shown today may
 *  become unreachable). */
function hasPlays(id, rec) {
  if (id === 'connect4') return c4Totals(rec.grid).plays > 0;
  if (id === 'ballrun') return !!((rec.br && rec.br.runs) || (rec.brOrbital && rec.brOrbital.runs) || rec.brLegacyMeters);
  if (id === 'snake') return !!(rec.sn && rec.sn.runs);
  if (id === 'nutsbolts') return !!(rec.nb && rec.nb.solved);
  return ((rec.total || {}).played | 0) > 0;
}

/** The headline number + unit for a game's row in the shared game-list drill-down: wins
 *  (the stored `won` counter, ties excluded — the same maths the leaderboard uses) for
 *  competitive games, the game's own solo metric for Ball Run/Snake/Nuts & Bolts. */
function headlineOf(id, rec) {
  if (id === 'ballrun') return { n: Math.max((rec.br && rec.br.bestObstacles) | 0, (rec.brOrbital && rec.brOrbital.bestObstacles) | 0), unitKey: unitKeyOf(id) };
  if (id === 'snake') return { n: (rec.sn && rec.sn.bestLen) | 0, unitKey: unitKeyOf(id) };
  if (id === 'nutsbolts') return { n: (rec.nb && rec.nb.solved) | 0, unitKey: unitKeyOf(id) };
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

function screenFor(id, st) {
  const rec = (st.games && st.games[id]) || {};
  if (id === 'connect4') return connect4Screen(rec);
  if (id === 'chinchon') return chinchonScreen(rec);
  if (id === 'nutsbolts') return nutsBoltsScreen(rec);
  if (id === 'escoba') return escobaScreen(rec);
  if (id === 'ballrun') return ballRunScreen(rec);
  if (id === 'tictactoe') return ticTacToeScreen(rec);
  if (id === 'dotsboxes') return dotsBoxesScreen(rec);
  if (id === 'boggle') return boggleScreen(rec);
  if (id === 'yahtzee') return yahtzeeScreen(rec);
  if (id === 'dominoes') return dominoesScreen(rec);
  if (id === 'snake') return snakeScreen(rec);
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
    const me = agg.aggregateForViewer(all, loadProfile() || {}, statsId(), loadStats());
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
  _st = loadStats();
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
    '.gs-cc{display:grid;gap:14px;background:#16211c;border:1px solid #23342c;border-radius:14px;padding:16px;box-shadow:0 6px 22px rgba(9,24,20,.28)}',
    '.gs-cc-sec{display:grid;gap:2px}',
    '.gs-cc-h{margin:0 0 6px;font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#e8b53a}',
    '.gs-cc-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)}',
    '.gs-cc-sec .gs-cc-row:last-child{border-bottom:0}',
    '.gs-cc-k{color:#c9d6cf;font-size:.92rem;font-weight:600}',
    '.gs-cc-v{color:#f4f6fb;font-size:1.05rem;font-weight:900;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.gs-cc-v em{color:#9fb4aa;font-style:normal;font-size:.82rem;font-weight:700}',
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
