// leaderboard-ui.js - the public "Leaderboard" overlay: every player sees everyone's record, rating
// and plays. Reads the synced players/ node live (watchPlayers) and aggregates it into ONE row per
// person by player code (js/players-agg.js), so a person's phone + laptop count once. Self-contained
// (injects its own lb- CSS once); mirrors game-stats-ui.js. Opened from the hub header.
//
// READ-ONLY consumer. This file never writes, migrates or normalizes stored data - the ranking rules
// live in js/leaderboard-rank.js and are pure read-time display transforms over the stored shape.
//
// Two segments, not a tab strip. The old design put 13 tabs in a horizontal scroller and re-sorted
// them by total plays on every render, so tab POSITIONS moved between visits and anything past the
// fourth was undiscoverable. Now: Standings (one ranked list of people) and Games (a grid of every
// game, alphabetical and fixed, tap through to that game's board).
//
// Colorblind-safe: rank, the viewer's own highlighted row, and the difficulty-mix bar all use
// weight, border and LIGHTNESS within one hue - never hue alone.

import { aggregatePlayers, buildIdentity, COMPETITIVE } from './players-agg.js';
import { watchPlayers } from './stats-net.js';
import { loadProfile } from './profile-store.js';
import { statsId } from './game-stats.js';
import { record, tierMix, tierRows, rankPlayers, cmp } from './leaderboard-rank.js';
import { TIERS, TIER_LABEL } from './difficulty-tiers.js';

// Old test/debug device records. They stay in Firebase untouched (no data is ever deleted); they are
// simply never rendered. Matched by deviceId prefix.
const HIDDEN_PREFIX = ['4392d978', 'f8ad1b82', 'zzz-prev'];   // "Tester", "test1", preview bot

// Every game, ALPHABETICAL BY TITLE - the hub launcher's convention (CLAUDE.md, "Adding a game",
// item 5). Fixed order: a tile never moves between visits, unlike the old plays-sorted tab strip.
const GAME_META = [
  { id: 'ballrun', label: 'Ball Run', accent: '#c22e8f' },
  { id: 'boggle', label: 'Boggle', accent: '#1f3864' },
  { id: 'chinchon', label: 'Chinchón', accent: '#d4a017' },
  { id: 'connect4', label: 'Connect 4', accent: '#1769d4' },
  { id: 'dotsboxes', label: 'Dots and Boxes', accent: '#16243a' },
  { id: 'escoba', label: 'Escoba', accent: '#1c7a4f' },
  { id: 'filler', label: 'Filler', accent: '#c2557f' },
  { id: 'mancala', label: 'Mancala', accent: '#e08a3c' },
  { id: 'business', label: 'Monopoly Deal', accent: '#6a4cff' },
  { id: 'nutsbolts', label: 'Nuts & Bolts', accent: '#607d8b' },
  { id: 'parchis', label: 'Parchís', accent: '#c0632b' },
  { id: 'snake', label: 'Snake', accent: '#3f7d2c' },
  { id: 'tictactoe', label: 'Tic Tac Toe', accent: '#0e7c86' },
].sort((a, b) => a.label.localeCompare(b.label));
const ACCENT = Object.fromEntries(GAME_META.map((g) => [g.id, g.accent]));
const LABEL = Object.fromEntries(GAME_META.map((g) => [g.id, g.label]));

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function labelOf(id) { return LABEL[id] || id; }

// --- identity chrome --------------------------------------------------------
function rankName(g) { return esc(g.name || 'Unnamed'); }

/** The player's synced profile emoji (aggregated in players-agg.js and, until now, never rendered),
 *  falling back to their first initial in a neutral circle. Free identity, already in the data. */
function avatarHTML(g) {
  const emoji = (g.emoji || '').trim();
  if (emoji) return `<span class="lb-av" aria-hidden="true">${esc(emoji)}</span>`;
  const initial = ((g.name || '?').trim()[0] || '?').toUpperCase();
  return `<span class="lb-av is-initial" aria-hidden="true">${esc(initial)}</span>`;
}

/** A thin bar segmented by share of plays per difficulty tier: darkest segment = highest tier.
 *  One hue, varying only in lightness, so it stays readable without color vision (and it carries a
 *  text title/aria-label as the non-visual equivalent). Answers "does this person play Pro or
 *  Beginner?" at a glance without spending a column on it. */
function tierBarHTML(mix) {
  const total = TIERS.reduce((a, t) => a + mix[t], 0) + mix.unranked;
  if (!total) return '';
  const parts = [];
  const words = [];
  for (const t of TIERS) {
    if (mix[t] <= 0) continue;
    parts.push(`<span class="lb-tseg is-t${t}" style="width:${((mix[t] / total) * 100).toFixed(2)}%"></span>`);
    words.push(`${TIER_LABEL[t]} ${pct(mix[t], total)}%`);
  }
  if (mix.unranked > 0) {
    parts.push(`<span class="lb-tseg is-t0" style="width:${((mix.unranked / total) * 100).toFixed(2)}%"></span>`);
    words.push(`Unrated ${pct(mix.unranked, total)}%`);
  }
  const text = esc(words.join(', '));
  return `<span class="lb-tbar" role="img" aria-label="Difficulty mix: ${text}" title="${text}">${parts.join('')}</span>`;
}

// --- standings --------------------------------------------------------------
/** Combined competitive W-L with draws folded into wins (see leaderboard-rank.js). */
function compRecord(group) {
  let wins = 0, losses = 0, played = 0;
  for (const id of COMPETITIVE) {
    const r = record(group.games[id].total);
    wins += r.wins; losses += r.losses; played += r.played;
  }
  return { wins, losses, played };
}

/** W-L is meaningless for someone who only plays solo games, so their record cell shows the
 *  headline achievement instead. They still carry a real rating and a real rank. */
function soloHeadline(group) {
  const br = group.games.ballrun.br;
  if (br && (br.runs | 0) > 0) return `Ball Run ${br.bestObstacles | 0}`;
  const sn = (group.games.snake || {}).sn;
  if (sn && (sn.runs | 0) > 0) return `Snake ${sn.bestLen | 0}`;
  const solved = group.solo.solved | 0;
  if (solved > 0) return `${solved} solved`;
  return '—';
}

function ratingCell(r) {
  if (r.rating == null) return '—';
  return `${r.rating}${r.provisional ? '<span class="lb-prov" aria-label="provisional">*</span>' : ''}`;
}

/** Every named player with ANY recorded play, ranked by the blended rating.
 *  The old board filtered on `comp.played > 0`, which put anyone who only plays Ball Run or
 *  Nuts & Bolts nowhere on the default screen at all - stored but invisible, THE LAW rule 1. */
function standingsBody(list) {
  const ranked = rankPlayers(list).filter((r) => r.plays > 0);
  if (!ranked.length) return emptyRows('No games recorded yet.');
  const allIds = GAME_META.map((g) => g.id);
  const rows = ranked.map((r, i) => {
    const g = r.group;
    const cr = compRecord(g);
    const recCell = cr.played > 0 ? `${cr.wins}-${cr.losses}` : esc(soloHeadline(g));
    const mix = tierMix(g, allIds);
    return rowHTML(g, i, [recCell, ratingCell(r), `${r.plays}`], tierBarHTML(mix));
  });
  const anyProv = ranked.some((r) => r.provisional);
  return table(['#', 'Player', 'W-L', 'Rating', 'Plays'], rows)
    + (anyProv ? `<p class="lb-note">* fewer than 5 plays, so the rating is still settling.</p>` : '')
    + `<p class="lb-note">Rating weighs win rate by difficulty and by how much you have played. A draw counts as a win.</p>`;
}

// --- games grid -------------------------------------------------------------
/** The leader line on a game tile: whoever tops that game's own board, with their headline number. */
function leaderOf(list, id) {
  if (id === 'nutsbolts') {
    const rows = list.filter((g) => (g.solo.solved | 0) > 0).sort(cmp((g) => g.solo.solved, (g) => g.updatedAt));
    return rows.length ? { g: rows[0], metric: `${rows[0].solo.solved | 0} solved` } : null;
  }
  if (id === 'ballrun') {
    const rows = list.filter((g) => g.games.ballrun.br && (g.games.ballrun.br.runs | 0) > 0)
      .sort(cmp((g) => (g.games.ballrun.br.bestObstacles | 0), (g) => g.updatedAt));
    return rows.length ? { g: rows[0], metric: `${rows[0].games.ballrun.br.bestObstacles | 0} obstacles` } : null;
  }
  if (id === 'snake') {
    const rows = list.filter((g) => (g.games.snake || {}).sn && (g.games.snake.sn.runs | 0) > 0)
      .sort(cmp((g) => (g.games.snake.sn.bestLen | 0), (g) => g.updatedAt));
    return rows.length ? { g: rows[0], metric: `length ${rows[0].games.snake.sn.bestLen | 0}` } : null;
  }
  const rows = list.filter((g) => (g.games[id].total.played | 0) > 0)
    .sort(cmp((g) => {
      const r = record(g.games[id].total);
      return pct(r.wins, r.played);
    }, (g) => g.games[id].total.played | 0, (g) => g.updatedAt));
  if (!rows.length) return null;
  const r = record(rows[0].games[id].total);
  return { g: rows[0], metric: `${r.wins}-${r.losses}` };
}

function gamesBody(list) {
  const tiles = GAME_META.map((meta) => {
    const lead = leaderOf(list, meta.id);
    const inner = lead
      ? `<span class="lb-tile-lead">${avatarHTML(lead.g)}<span class="lb-tile-who">${rankName(lead.g)}</span></span><span class="lb-tile-metric">${esc(lead.metric)}</span>`
      : `<span class="lb-tile-lead lb-tile-empty">No games yet</span><span class="lb-tile-metric">&nbsp;</span>`;
    return `<button type="button" class="lb-tile" data-game="${meta.id}" style="--lb-accent:${meta.accent}"><span class="lb-tile-name">${esc(meta.label)}</span>${inner}</button>`;
  }).join('');
  return `<div class="lb-grid">${tiles}</div>`;
}

// --- game detail ------------------------------------------------------------
// Nuts & Bolts difficulty tiers (byDiff keys are lowercased by the recorder).
const NB_TIERS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['extrahard', 'Extra']];
// Ball Run difficulty tiers (byDiff/bestObstaclesByDiff keys, lowercased by the recorder).
const BR_DIFFS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

function nutsBoltsRows(list) {
  // Levels beaten, overall and per difficulty. Best level / average moves are properties of the
  // puzzle rather than the player, so they are not ranked.
  const rows = list.filter((g) => g.solo.solved > 0).sort(cmp((g) => g.solo.solved, (g) => g.updatedAt));
  if (!rows.length) return emptyRows('No Nuts & Bolts levels solved yet.');
  return table(['#', 'Player', 'Solved', ...NB_TIERS.map(([, l]) => l)], rows.map((g, i) => {
    const bd = g.games.nutsbolts.byDiff || {};
    return rowHTML(g, i, [`${g.solo.solved}`, ...NB_TIERS.map(([k]) => `${(bd[k] && bd[k].played) | 0}`)]);
  }));
}

function ballrunRows(list) {
  // Score-based, not win/loss: rank by best obstacle count reached (any difficulty), like a
  // high-score table. Best-per-tier / total runs are shown but not ranked on, same reasoning as
  // Nuts & Bolts. Pre-migration (meter-based) records have no bestObstacles yet, so they read as 0
  // and sort to the bottom - the legacy data is preserved (see game-stats.js's brLegacyMeters) but
  // this board starts clean on the new metric.
  const rows = list.filter((g) => g.games.ballrun.br && (g.games.ballrun.br.runs | 0) > 0)
    .sort(cmp((g) => (g.games.ballrun.br.bestObstacles | 0), (g) => g.updatedAt));
  if (!rows.length) return emptyRows('No Ball Run runs recorded yet.');
  return table(['#', 'Player', ...BR_DIFFS.map(([, l]) => l), 'Runs'], rows.map((g, i) => {
    const br = g.games.ballrun.br;
    const bd = br.bestObstaclesByDiff || {};
    return rowHTML(g, i, [...BR_DIFFS.map(([k]) => `${bd[k] | 0}`), `${br.runs | 0}`]);
  }));
}

// Snake difficulty tiers (byDiff/bestLenByDiff keys, lowercased by the recorder).
const SN_DIFFS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

function snakeRows(list) {
  // Score-based like Ball Run: rank by best snake length reached (any difficulty), a high-score
  // table. Per-tier bests and total runs shown but not ranked on. The `|| {}` guard matters:
  // remote records synced before Snake existed have no `snake` key until their device updates.
  const rows = list.filter((g) => (g.games.snake || {}).sn && (g.games.snake.sn.runs | 0) > 0)
    .sort(cmp((g) => (g.games.snake.sn.bestLen | 0), (g) => g.updatedAt));
  if (!rows.length) return emptyRows('No Snake runs recorded yet.');
  return table(['#', 'Player', ...SN_DIFFS.map(([, l]) => l), 'Runs'], rows.map((g, i) => {
    const sn = g.games.snake.sn;
    const bd = sn.bestLenByDiff || {};
    return rowHTML(g, i, [...SN_DIFFS.map(([k]) => `${bd[k] | 0}`), `${sn.runs | 0}`]);
  }));
}

/** Standard per-game ranked table, with §2 draws-as-wins applied so W-L, win rate and plays all
 *  reconcile (they did not before: a 2W/2L/10D record rendered as "2-2 / 14% / 14"). */
function gameRows(list, id) {
  const rows = list.filter((g) => (g.games[id].total.played | 0) > 0)
    .sort(cmp(
      (g) => { const r = record(g.games[id].total); return pct(r.wins, r.played); },
      (g) => g.games[id].total.played | 0,
      (g) => g.updatedAt,
    ));
  if (!rows.length) return emptyRows(`No ${labelOf(id)} games recorded yet.`);
  return table(['#', 'Player', 'W-L', 'Win rate', 'Plays'], rows.map((g, i) => {
    const r = record(g.games[id].total);
    return rowHTML(g, i, [`${r.wins}-${r.losses}`, `${pct(r.wins, r.played)}%`, `${r.played}`],
      tierBarHTML(tierMix(g, [id])));
  }));
}

/** One row per difficulty tier: W-L and win rate each. This is where "10 wins on Easy" and "10 wins
 *  on Hard" stop looking like the same achievement. Unrated buckets ('legacy', 'unknown') get their
 *  own row rather than being dropped - THE LAW rule 1 applies to the data foldLegacy preserved. */
function tierTable(heading, rows) {
  const order = [...TIERS, 'unranked'];
  const present = order.filter((k) => rows[k] && rows[k].played > 0);
  if (!present.length) return '';
  const body = present.map((k) => {
    const r = rows[k];
    const label = k === 'unranked' ? 'Unrated' : TIER_LABEL[k];
    return `<tr><th scope="row" class="lb-name">${esc(label)}</th><td>${r.wins}-${r.losses}</td><td>${pct(r.wins, r.played)}%</td><td>${r.played}</td></tr>`;
  }).join('');
  const th = ['Difficulty', 'W-L', 'Win rate', 'Plays']
    .map((h, i) => `<th${i === 0 ? ' class="lb-name"' : ''} scope="col">${h}</th>`).join('');
  return `<h3 class="lb-h3">${esc(heading)}</h3><div class="lb-tblwrap"><table class="lb-table is-tiers"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Sum every listed player's per-tier buckets for one game, for the field-wide breakdown. */
function fieldTierRows(list, id) {
  const out = {};
  for (const g of list) {
    const rows = tierRows(g.games[id]);
    for (const k of Object.keys(rows)) {
      if (!rows[k]) continue;
      const d = out[k] || (out[k] = { played: 0, wins: 0, losses: 0 });
      d.played += rows[k].played; d.wins += rows[k].wins; d.losses += rows[k].losses;
    }
  }
  return out;
}

// Each game's own stored texture, aggregated by players-agg.js and - until now - never rendered
// anywhere but My Stats. Shown as "who leads this, and by how much" chips under the ranked table.
const TEXTURE = {
  connect4: [
    { label: 'Wins going first', get: (g) => sumGrid(g.games.connect4.grid, 'player') },
    { label: 'Wins going second', get: (g) => sumGrid(g.games.connect4.grid, 'computer') },
  ],
  chinchon: [
    { label: 'Chinchóns', get: (g) => ((g.games.chinchon.cc || {}).chinchons) | 0 },
    { label: 'Closes', get: (g) => ((g.games.chinchon.cc || {}).closed) | 0 },
    { label: 'Minus tens', get: (g) => ((g.games.chinchon.cc || {}).minusTen) | 0 },
  ],
  escoba: [{ label: 'Escobas', get: (g) => ((g.games.escoba.es || {}).escobas) | 0 }],
  nutsbolts: [
    { label: 'Best level', get: (g) => g.solo.bestLevel | 0 },
    { label: 'Levels solved', get: (g) => g.solo.solved | 0 },
  ],
  ballrun: [
    { label: 'Best obstacles', get: (g) => ((g.games.ballrun.br || {}).bestObstacles) | 0 },
    { label: 'Total runs', get: (g) => ((g.games.ballrun.br || {}).runs) | 0 },
  ],
  dotsboxes: [
    { label: 'Boxes claimed', get: (g) => ((g.games.dotsboxes.db || {}).boxes) | 0 },
    { label: 'Longest chain', get: (g) => ((g.games.dotsboxes.db || {}).bestChain) | 0 },
  ],
  boggle: [
    { label: 'Best score', get: (g) => ((g.games.boggle.bg || {}).bestScore) | 0 },
    { label: 'Words found', get: (g) => ((g.games.boggle.bg || {}).words) | 0 },
    // The only text-valued chip: the longest word is shown by name, not just its length, matching
    // My Stats. players-agg.js carries {word,len} as a unit so the text always fits the length.
    {
      label: 'Longest word',
      get: (g) => ((g.games.boggle.bg || {}).longestWord || {}).len | 0,
      show: (g) => ((g.games.boggle.bg || {}).longestWord || {}).word || '',
    },
  ],
  snake: [
    { label: 'Longest snake', get: (g) => (((g.games.snake || {}).sn || {}).bestLen) | 0 },
    { label: 'Total runs', get: (g) => (((g.games.snake || {}).sn || {}).runs) | 0 },
  ],
  tictactoe: [
    { label: 'Classic played', get: (g) => (((g.games.tictactoe.tt || {}).classic) || {}).played | 0 },
    { label: 'Ultimate played', get: (g) => (((g.games.tictactoe.tt || {}).ultimate) || {}).played | 0 },
    {
      label: 'Draws',
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

function textureHTML(list, id) {
  const specs = TEXTURE[id];
  if (!specs) return '';
  const chips = [];
  for (const spec of specs) {
    let best = null;
    for (const g of list) {
      const v = spec.get(g) | 0;
      if (v > 0 && (!best || v > best.v)) best = { v, g };
    }
    if (!best) continue;
    // `show` lets a chip rank on a number but DISPLAY something else (Boggle's longest word).
    const shown = spec.show ? esc(spec.show(best.g) || String(best.v)) : String(best.v);
    chips.push(`<div class="lb-chip"><b>${shown}</b><span>${esc(spec.label)}</span><em>${avatarHTML(best.g)}${rankName(best.g)}</em></div>`);
  }
  if (!chips.length) return '';
  return `<h3 class="lb-h3">Who leads what</h3><div class="lb-chips">${chips.join('')}</div>`;
}

function gameDetail(list, id) {
  const head = `<div class="lb-detail-top"><button type="button" class="lb-back" data-role="lb-back">&larr; Games</button><h3 class="lb-detail-h" style="--lb-accent:${ACCENT[id] || '#5b6b82'}">${esc(labelOf(id))}</h3></div>`;
  let board;
  if (id === 'nutsbolts') board = nutsBoltsRows(list);
  else if (id === 'ballrun') board = ballrunRows(list);
  else if (id === 'snake') board = snakeRows(list);
  else board = gameRows(list, id);
  // The viewer's own per-tier split, then the field's. When the viewer is the only person who has
  // played this game the two are the same table, so only one is drawn - a duplicate reads as a bug.
  // (`|| {}` on games[id]: remote records synced before a game existed have no key for it.)
  const players = list.filter((g) => ((g.games[id] || {}).total || {}).played > 0);
  const mine = players.find((g) => g.key === _meKey);
  const solo = mine && players.length === 1;
  const mineTable = mine ? tierTable(solo ? 'By difficulty' : 'Your record by difficulty', tierRows(mine.games[id])) : '';
  const fieldTable = solo ? '' : tierTable(mine ? 'Everyone, by difficulty' : 'By difficulty', fieldTierRows(list, id));
  return head + board + mineTable + fieldTable + textureHTML(list, id);
}

// --- shared table markup ----------------------------------------------------
function rowHTML(g, i, metrics, nameExtra) {
  const me = g.key === _meKey ? ' is-me' : '';
  const cells = metrics.map((m) => `<td>${m}</td>`).join('');
  const name = `<span class="lb-who">${avatarHTML(g)}<span class="lb-nm">${rankName(g)}</span></span>${nameExtra || ''}`;
  return `<tr class="lb-r${me}"${me ? ' aria-current="true"' : ''}><td class="lb-rank">${i + 1}</td><th scope="row" class="lb-name">${name}</th>${cells}</tr>`;
}

function table(head, bodyRows) {
  // join('') matters: interpolating an ARRAY stringifies it with commas, and any stray text inside
  // <table> (commas OR the template's own newlines) is foster-parented out by the HTML parser and
  // renders as a blank row of junk above the table. Keep this markup whitespace-free.
  const body = Array.isArray(bodyRows) ? bodyRows.join('') : bodyRows;
  const th = head.map((h, i) => `<th${i === 0 ? ' class="lb-rank"' : i === 1 ? ' class="lb-name"' : ''} scope="col">${h}</th>`).join('');
  // A per-difficulty column each (Nuts & Bolts, Ball Run) needs the tighter numeric geometry.
  const wide = head.length > 5 ? ' is-wide' : '';
  return `<div class="lb-tblwrap"><table class="lb-table${wide}"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function emptyRows(msg) { return `<p class="lb-none">${esc(msg)}</p>`; }

/** Fixed-height placeholder rows in the real table's geometry, so the panel does not jump when the
 *  live data lands. The repo's fixed-geometry convention (CLAUDE.md, Escoba's .eb-table note);
 *  the old "Connecting..." paragraph was replaced by content of a completely different height. */
function skeletonHTML(rows = 6) {
  // The name cell mirrors rowHTML's exactly - avatar circle, name bar, tier bar - so a skeleton row
  // is the same HEIGHT as the row that replaces it. Without the avatar and bar placeholders the
  // rows came out ~17px short each and the table visibly grew as the data landed.
  const body = Array.from({ length: rows }, () =>
    `<tr class="lb-r is-skel"><td class="lb-rank"><span class="lb-sk lb-sk-n"></span></td><th scope="row" class="lb-name"><span class="lb-who"><span class="lb-av is-initial"></span><span class="lb-sk lb-sk-w"></span></span><span class="lb-tbar"></span></th><td><span class="lb-sk"></span></td><td><span class="lb-sk"></span></td><td><span class="lb-sk"></span></td></tr>`).join('');
  const th = ['#', 'Player', 'W-L', 'Rating', 'Plays']
    .map((h, i) => `<th${i === 0 ? ' class="lb-rank"' : i === 1 ? ' class="lb-name"' : ''} scope="col">${h}</th>`).join('');
  return `<div class="lb-tblwrap" aria-busy="true" aria-label="Loading standings"><table class="lb-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
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
  if (_seg === 'games') return gamesBody(list);
  return standingsBody(list);
}

// --- overlay shell ----------------------------------------------------------
let _host = null;
let _seg = 'standings';     // 'standings' | 'games'
let _game = null;           // non-null => showing that game's detail board
let _all = {};
let _meKey = '';
let _unsub = null;
let _connected = false;

const SEGMENTS = [{ id: 'standings', label: 'Standings' }, { id: 'games', label: 'Games' }];

function segsHTML() {
  return SEGMENTS.map((s) =>
    `<button type="button" class="lb-seg${s.id === _seg ? ' is-active' : ''}" data-seg="${s.id}"${s.id === _seg ? ' aria-current="true"' : ''}>${esc(s.label)}</button>`
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
  if (bodyEl) bodyEl.innerHTML = `<p class="lb-none">The leaderboard needs a connection. It lights up when you are online.</p>`;
}

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (_game) { _game = null; rerender(); return; }   // Esc backs out of a game before closing
  closeLeaderboard();
}

function onClick(e) {
  if (e.target.closest('[data-role="lb-close"]')) { closeLeaderboard(); return; }
  if (e.target.closest('[data-role="lb-back"]')) { _game = null; rerender(); return; }
  const seg = e.target.closest('.lb-seg');
  if (seg && seg.dataset.seg) {
    const next = seg.dataset.seg;
    if (next === _seg && !_game) return;
    _seg = next; _game = null; rerender();
    return;
  }
  const tile = e.target.closest('.lb-tile');
  if (tile && tile.dataset.game) { _game = tile.dataset.game; rerender(); }
}

export function closeLeaderboard() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
  if (_host) { _host.remove(); _host = null; }
  document.removeEventListener('keydown', onKey);
}

export async function openLeaderboard() {
  ensureCss();
  closeLeaderboard();
  _seg = 'standings';
  _game = null;
  _all = {};
  _connected = false;
  _meKey = '';   // resolved in currentBody() once records load (identity needs the whole graph)
  const host = document.createElement('div');
  host.className = 'lb-overlay';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', 'Leaderboard');
  host.innerHTML = `
    <div class="lb-scrim" data-role="lb-close"></div>
    <div class="lb-panel">
      <header class="lb-top">
        <h2>Leaderboard</h2>
        <button type="button" class="lb-x" data-role="lb-close" aria-label="Close">&times;</button>
      </header>
      <nav class="lb-segs" data-role="lb-segs" aria-label="Standings or games">${segsHTML()}</nav>
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
    '.lb-top{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:max(env(safe-area-inset-top,0px),16px) 18px 12px;background:rgba(255,255,255,.94);backdrop-filter:saturate(1.2) blur(6px);border-bottom:1px solid var(--hub-surface-2,#eef2f8)}',
    '.lb-top h2{margin:0;font-size:1.15rem;font-weight:800;color:var(--hub-ink,#16243a)}',
    '.lb-x{appearance:none;border:1px solid var(--hub-surface-2,#eef2f8);background:var(--hub-surface,#fff);color:var(--hub-ink,#16243a);font-size:1.4rem;line-height:1;width:38px;height:38px;border-radius:10px;cursor:pointer}',
    // Two segments, fixed width, no scroller. Nothing here can move between visits.
    '.lb-segs{display:flex;gap:6px;padding:12px 16px 0;background:var(--hub-bg,#f4f6fb)}',
    '.lb-seg{flex:1 1 0;appearance:none;cursor:pointer;padding:9px 12px;font-size:.9rem;font-weight:700;color:var(--hub-muted,#5b6b82);background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:10px}',
    '.lb-seg.is-active{color:var(--hub-ink,#16243a);font-weight:900;border-color:var(--hub-ink,#16243a);box-shadow:inset 0 0 0 1px var(--hub-ink,#16243a)}',
    '.lb-body{padding:14px 16px 8px}',
    '.lb-h3{margin:18px 0 8px;font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--hub-muted,#5b6b82)}',
    '.lb-note{margin:8px 2px 0;color:var(--hub-muted,#5b6b82);font-size:.74rem;font-weight:600;line-height:1.4}',
    // overflow-x:auto, NOT hidden: the 7-column Nuts & Bolts and 6-column Ball Run boards are wider
    // than a 375px phone, and they must scroll INSIDE this wrapper rather than be clipped (or push
    // the page body sideways).
    '.lb-tblwrap{border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;background:var(--hub-surface,#fff);box-shadow:0 4px 16px rgba(20,40,80,.06);overflow-x:auto;-webkit-overflow-scrolling:touch}',
    // table-layout:fixed + white-space:nowrap is the wrap fix: "15-3" can never break across two
    // lines the way it did on the old board. With fixed layout the column widths come from the
    // FIRST row, so they must be declared on thead th - setting them on tbody td does nothing but
    // leave every column an equal share, which clipped even short names behind an ellipsis.
    '.lb-table{width:100%;border-collapse:collapse;table-layout:fixed}',
    '.lb-table th,.lb-table td{box-sizing:border-box;padding:9px 8px;text-align:right;font-size:.88rem;white-space:nowrap}',
    '.lb-table thead th{width:58px;background:var(--hub-surface-2,#eef2f8);color:var(--hub-muted,#5b6b82);font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em}',
    '.lb-table .lb-rank{text-align:center;color:var(--hub-muted,#5b6b82);font-weight:800}',
    '.lb-table thead th.lb-rank{width:30px}',
    // The name column takes whatever the fixed numeric columns leave.
    '.lb-table .lb-name{text-align:left;font-weight:800;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis}',
    '.lb-table thead th.lb-name{width:auto;min-width:120px;color:var(--hub-muted,#5b6b82)}',
    '.lb-table tbody td{font-weight:800;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    '.lb-table tbody tr+tr th,.lb-table tbody tr+tr td{border-top:1px solid var(--hub-surface-2,#eef2f8)}',
    '.lb-table.is-tiers thead th{width:62px}',
    // Boards with a per-difficulty column each (Nuts & Bolts, Ball Run): tighter numeric columns so
    // less of the table sits off-screen, and it scrolls inside .lb-tblwrap for the rest.
    '.lb-table.is-wide thead th{width:46px;padding:9px 6px}',
    '.lb-table.is-wide td{padding:9px 6px}',
    '.lb-who{display:flex;align-items:center;gap:7px;min-width:0}',
    '.lb-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // Avatar: the synced profile emoji, else the first initial in a neutral circle.
    '.lb-av{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--hub-surface-2,#eef2f8);font-size:.95rem;line-height:1}',
    '.lb-av.is-initial{font-size:.72rem;font-weight:900;color:var(--hub-muted,#5b6b82)}',
    '.lb-prov{font-weight:900;color:var(--hub-muted,#5b6b82)}',
    // Difficulty mix: ONE hue, lightness only (colorblind-safe), darkest = hardest.
    '.lb-tbar{display:flex;width:100%;height:4px;margin-top:5px;border-radius:2px;overflow:hidden;background:var(--hub-surface-2,#eef2f8)}',
    '.lb-tseg{display:block;height:100%}',
    '.lb-tseg.is-t1{background:#c3d0e2}', '.lb-tseg.is-t2{background:#8fa4c0}',
    '.lb-tseg.is-t3{background:#4d6b8a}', '.lb-tseg.is-t4{background:#1d2c44}',
    '.lb-tseg.is-t0{background:repeating-linear-gradient(135deg,#dfe5ee 0 3px,#eef2f8 3px 6px)}',
    // Games grid: every game visible at once, two columns, fixed alphabetical order.
    '.lb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.lb-tile{appearance:none;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-height:92px;padding:10px 11px;text-align:left;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-left:4px solid var(--lb-accent,#5b6b82);border-radius:12px;box-shadow:0 4px 16px rgba(20,40,80,.06)}',
    '.lb-tile-name{font-size:.88rem;font-weight:900;color:var(--hub-ink,#16243a);line-height:1.2}',
    '.lb-tile-lead{display:flex;align-items:center;gap:6px;min-width:0;max-width:100%;margin-top:auto;font-size:.78rem;font-weight:700;color:var(--hub-muted,#5b6b82)}',
    '.lb-tile-who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-tile-empty{font-style:normal;opacity:.75}',
    '.lb-tile-metric{font-size:.76rem;font-weight:800;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    // Game detail
    '.lb-detail-top{display:flex;align-items:center;gap:10px;margin:0 0 12px}',
    '.lb-back{appearance:none;cursor:pointer;padding:7px 11px;font-size:.8rem;font-weight:800;color:var(--hub-muted,#5b6b82);background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:9px;white-space:nowrap}',
    '.lb-detail-h{margin:0;font-size:1rem;font-weight:900;color:var(--hub-ink,#16243a);padding-left:9px;border-left:4px solid var(--lb-accent,#5b6b82);line-height:1.3}',
    '.lb-chips{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.lb-chip{display:flex;flex-direction:column;gap:2px;padding:10px 11px;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px}',
    // overflow-wrap:anywhere because one chip is text, not a number (Boggle's longest word) and a
    // 15-letter ENABLE word would otherwise run straight out of the chip.
    '.lb-chip b{font-size:1.15rem;font-weight:900;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums;line-height:1.1;overflow-wrap:anywhere}',
    '.lb-chip span{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em;color:var(--hub-muted,#5b6b82)}',
    '.lb-chip em{display:flex;align-items:center;gap:5px;min-width:0;font-style:normal;font-size:.76rem;font-weight:700;color:var(--hub-ink,#16243a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.lb-chip .lb-av{width:19px;height:19px;font-size:.78rem}',
    '.lb-r.is-me td,.lb-r.is-me th{background:rgba(23,105,212,.10)}',
    '.lb-r.is-me .lb-rank{box-shadow:inset 3px 0 0 var(--hub-accent,#1769d4)}',
    // Skeleton rows share the real row geometry, so nothing shifts when data lands.
    '.lb-sk{display:inline-block;width:100%;height:11px;border-radius:5px;background:var(--hub-surface-2,#eef2f8);vertical-align:middle}',
    '.lb-sk-n{width:14px}', '.lb-sk-w{width:66%}',
    '.lb-r.is-skel td,.lb-r.is-skel th{opacity:.65}',
    '.lb-none{margin:0;color:var(--hub-muted,#5b6b82);font-size:.92rem;font-weight:600;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;padding:22px 16px;text-align:center}',
    '.lb-foot{text-align:center;color:var(--hub-muted,#5b6b82);font-size:.76rem;padding:12px 16px 40px;margin:0}',
    '@media (max-width:359px){.lb-grid,.lb-chips{grid-template-columns:1fr}}',
  ].join('');
  document.head.appendChild(el);
}

export default { openLeaderboard, closeLeaderboard };
