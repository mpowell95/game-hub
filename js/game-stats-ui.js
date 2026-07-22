// game-stats-ui.js - the player-facing "Game Stats" overlay. A tab per game, each with its OWN
// tailored screen (not a generic played/won/lost card):
//   Connect 4 - Wins/Losses/Plays totals + a WHO-MOVED-FIRST grid (player vs computer, per level).
//   Chinchon  - Games played (finished/victories/draws/defeats + %) and close-quality stats
//               (total closed by you, total minus ten, total chinchons), on a dark panel.
//   Monopoly Deal / Parchis - Wins/Losses/Plays + win rate, and a record-by-difficulty table.
// Reads the local unified stats (game-stats.js); self-contained (injects its own CSS once). Opened
// from the hub header. Colorblind-safe: the active tab is marked by weight + ink + an accent
// underline together, never hue alone.

import { loadStats, deviceId } from './game-stats.js';
import { loadProfile } from './profile-store.js';
import { isDevProfile } from './challenge/hooks.js';

const TABS = [
  { id: 'connect4', label: 'Connect 4', accent: '#1769d4' },
  { id: 'chinchon', label: 'Chinchón', accent: '#d4a017' },
  { id: 'business', label: 'Monopoly Deal', accent: '#6a4cff' },
  { id: 'parchis', label: 'Parchís', accent: '#c0632b' },
  { id: 'nutsbolts', label: 'Nuts & Bolts', accent: '#607d8b' },
  { id: 'escoba', label: 'Escoba', accent: '#1c7a4f' },
  { id: 'filler', label: 'Filler', accent: '#c2557f' },
  { id: 'mancala', label: 'Mancala', accent: '#e08a3c' },
  { id: 'ballrun', label: 'Ball Run', accent: '#c22e8f' },
  { id: 'tictactoe', label: 'Tic Tac Toe', accent: '#0e7c86' },
];

/** The tabs this profile may see. devOnly tabs render only for Matt and the tester. */
function visibleTabs() {
  let dev = false;
  try { const p = loadProfile(); dev = !!(p && isDevProfile(p.name)); } catch { /* stay hidden */ }
  return TABS.filter((t) => !t.devOnly || dev);
}
const C4_DIFFS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert']];
const LABEL = Object.fromEntries(TABS.map((t) => [t.id, t.label]));

// Map each game's own difficulty vocabulary onto the hub's shared tier names, so the by-difficulty
// tables read consistently (Monopoly Deal uses easy/normal/hard, Parchis uses beginner/intermediate/
// pro/expert). 'legacy' is the folded-in pre-unified history (shown as "Earlier games").
const DIFF_META = {
  easy: { label: 'Beginner', order: 1 }, beginner: { label: 'Beginner', order: 1 }, facil: { label: 'Beginner', order: 1 },
  normal: { label: 'Intermediate', order: 2 }, medium: { label: 'Intermediate', order: 2 }, intermediate: { label: 'Intermediate', order: 2 }, average: { label: 'Intermediate', order: 2 },
  hard: { label: 'Pro', order: 3 }, pro: { label: 'Pro', order: 3 }, dificil: { label: 'Pro', order: 3 },
  expert: { label: 'Expert', order: 4 },
  legacy: { label: 'Earlier games', order: 9 },
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

function c4Table(title, side) {
  const rows = C4_DIFFS.map(([k, label]) => {
    const c = (side && side[k]) || {};
    return `<tr><th scope="row">${label}</th><td>${c.w | 0}</td><td>${c.l | 0}</td></tr>`;
  }).join('');
  return `<h4 class="gs-tbl-h">${title}</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">Wins</th><th scope="col">Losses</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function connect4Screen(rec) {
  const grid = rec && rec.grid;
  const t = c4Totals(grid);
  if (!t.plays) return emptyState('Connect 4');
  return `
    <div class="gs-tallies">
      <div class="gs-tally"><b>${t.w}</b><span>Wins</span></div>
      <div class="gs-tally"><b>${t.l}</b><span>Losses</span></div>
      <div class="gs-tally"><b>${t.plays}</b><span>Plays</span></div>
    </div>
    ${c4Table('Player first move', grid && grid.player)}
    ${c4Table('Computer first move', grid && grid.computer)}`;
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
      <h4 class="gs-cc-h">Games played</h4>
      ${ccRow('Finished games', finished, false, finished)}
      ${ccRow('Victories', victories, true, finished)}
      ${ccRow('Draws', draws, true, finished)}
      ${ccRow('Defeats', defeats, true, finished)}
    </section>
    <section class="gs-cc-sec">
      <h4 class="gs-cc-h">Stats</h4>
      ${ccRow('Total closed by you', cc.closed | 0, false, finished)}
      ${ccRow('Total minus ten', cc.minusTen | 0, false, finished)}
      ${ccRow('Total chinchóns', cc.chinchons | 0, false, finished)}
    </section>
  </div>`;
}

// --- Monopoly Deal / Parchis (record vs AI, by difficulty) ------------------
// Both are "win the table vs AI" games: the meaningful stat is the win rate overall and per
// opponent difficulty. Built from total + byDiff (what the classic recorder already tracks).
function diffTable(byDiff) {
  const meta = (k) => DIFF_META[k] || { label: titleCase(k), order: 8 };
  const keys = Object.keys(byDiff || {}).filter((k) => ((byDiff[k] || {}).played | 0) > 0);
  if (!keys.length) return '';
  keys.sort((a, b) => meta(a).order - meta(b).order);
  const rows = keys.map((k) => {
    const d = byDiff[k]; const w = d.won | 0, l = d.lost | 0, p = d.played | 0;
    return `<tr><th scope="row">${esc(meta(k).label)}</th><td>${w}-${l}</td><td>${pct(w, p)}%</td></tr>`;
  }).join('');
  return `<h4 class="gs-tbl-h">Record by difficulty</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">W-L</th><th scope="col">Win rate</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function recordScreen(id, rec) {
  const total = (rec && rec.total) || { played: 0, won: 0, lost: 0 };
  const played = total.played | 0, won = total.won | 0, lost = total.lost | 0;
  if (!played) return emptyState(LABEL[id] || 'These');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${won}</b><span>Wins</span></div>
      <div class="gs-tally"><b>${lost}</b><span>Losses</span></div>
      <div class="gs-tally"><b>${played}</b><span>Plays</span></div>
      <div class="gs-tally"><b>${pct(won, played)}%</b><span>Win rate</span></div>
    </div>
    ${diffTable(rec && rec.byDiff)}`;
}

function emptyState(label) { return `<p class="gs-none">No ${esc(label)} games recorded yet.</p>`; }

/** Nuts & Bolts: a solo puzzle, so no wins/losses/win-rate (you cannot lose, only keep going).
 *  Levels solved, how far you got, and the moves it took are the honest numbers. */
function nutsBoltsScreen(rec) {
  const nb = (rec && rec.nb) || {};
  const solved = nb.solved | 0, moves = nb.moves | 0, best = nb.bestLevel | 0;
  if (!solved) return emptyState('Nuts & Bolts');
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${solved}</b><span>Levels solved</span></div>
      <div class="gs-tally"><b>${best}</b><span>Best level</span></div>
      <div class="gs-tally"><b>${moves}</b><span>Total moves</span></div>
      <div class="gs-tally"><b>${Math.round(moves / solved)}</b><span>Avg moves</span></div>
    </div>`;
}

/** Escoba: the standard record-vs-AI screen plus the escoba counter. */
function escobaScreen(rec) {
  const total = (rec && rec.total) || { played: 0 };
  if (!(total.played | 0)) return emptyState('Escoba');
  const es = (rec && rec.es) || {};
  return recordScreen('escoba', rec) + `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${es.escobas | 0}</b><span>Escobas made</span></div>
    </div>`;
}

// --- Ball Run (solo, difficulty-scaled, obstacles-passed-is-the-score) ------
const BR_DIFFS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];

/** Ball Run: no wins/losses (only a crash or a fall ends a run), so the honest numbers are runs
 *  played and the best obstacle count reached, overall and per difficulty (fourth-playthrough item
 *  2: the score is obstacle rows passed, not meters). */
function ballRunScreen(rec) {
  const br = (rec && rec.br) || {};
  const legacy = (rec && rec.brLegacyMeters) || null;
  const runs = br.runs | 0, best = br.bestObstacles | 0;
  // A device with only pre-metric-change history still has runs (refolded from the archive in
  // game-stats.js), so the empty state genuinely means "never played", not "played before the
  // scoring change" - sixth-playthrough incident, where zeroed runs hid real history.
  if (!runs && !legacy) return emptyState('Ball Run');
  const bd = br.bestObstaclesByDiff || {};
  const rows = BR_DIFFS.map(([k, label]) =>
    `<tr><th scope="row">${label}</th><td>${bd[k] | 0} obstacles</td></tr>`).join('');
  // Scores from before the scoring change are meters, not obstacle counts - the units are not
  // comparable, so they are shown as their own clearly-labeled record instead of being converted
  // (which would fabricate numbers) or hidden (which reads as deleted data).
  const lbd = (legacy && legacy.bestByDiff) || {};
  const legacyRows = legacy ? BR_DIFFS.map(([k, label]) =>
    `<tr><th scope="row">${label}</th><td>${lbd[k] | 0} m</td></tr>`).join('') : '';
  const legacyHtml = legacy ? `
    <h4 class="gs-tbl-h">Best distance, before scoring changed to obstacles</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">Best</th></tr></thead>
      <tbody>${legacyRows}</tbody>
    </table>` : '';
  return `
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${runs}</b><span>Runs</span></div>
      <div class="gs-tally"><b>${best}</b><span>Best obstacles passed</span></div>
    </div>
    <h4 class="gs-tbl-h">Best obstacles passed by difficulty</h4>
    <table class="gs-grid">
      <thead><tr><th scope="col"></th><th scope="col">Best</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>${legacyHtml}`;
}

// --- Tic Tac Toe (played by variant, ties shown explicitly) -----------------
function ttVariantTallies(label, v) {
  return `<h4 class="gs-tbl-h">${esc(label)}</h4>
    <div class="gs-tallies is-4">
      <div class="gs-tally"><b>${v.won | 0}</b><span>Won</span></div>
      <div class="gs-tally"><b>${v.lost | 0}</b><span>Lost</span></div>
      <div class="gs-tally"><b>${v.tied | 0}</b><span>Tied</span></div>
      <div class="gs-tally"><b>${v.played | 0}</b><span>Played</span></div>
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
  return ttVariantTallies('Classic', classic) + ttVariantTallies('Ultimate', ultimate);
}

function screenFor(id, st) {
  const rec = (st.games && st.games[id]) || {};
  if (id === 'connect4') return connect4Screen(rec);
  if (id === 'chinchon') return chinchonScreen(rec);
  if (id === 'nutsbolts') return nutsBoltsScreen(rec);
  if (id === 'escoba') return escobaScreen(rec);
  if (id === 'ballrun') return ballRunScreen(rec);
  if (id === 'tictactoe') return ticTacToeScreen(rec);
  return recordScreen(id, rec);   // business, parchis
}

// --- overlay shell ----------------------------------------------------------
let _host = null;
let _active = 'connect4';
let _st = null;               // the stats to render: local first, then combined-across-devices when online
let _combinedDevices = 1;

function tabsHTML() {
  return visibleTabs().map((t) =>
    `<button type="button" class="gs-tab${t.id === _active ? ' is-active' : ''}" data-game="${t.id}" style="--gs-accent:${t.accent}"${t.id === _active ? ' aria-current="true"' : ''}>${esc(t.label)}</button>`
  ).join('');
}

function rerender() {
  if (!_host) return;
  const tabsEl = _host.querySelector('[data-role="gs-tabs"]');
  const bodyEl = _host.querySelector('[data-role="gs-body"]');
  if (tabsEl) tabsEl.innerHTML = tabsHTML();
  if (bodyEl) bodyEl.innerHTML = screenFor(_active, _st || { games: {} });
}

/** Fetch every device record and re-render from THIS player's combined (code-aggregated) stats.
 *  Best-effort: offline / unconfigured leaves the local view in place. */
async function refreshCombined() {
  try {
    const [net, agg] = await Promise.all([import('./stats-net.js'), import('./players-agg.js')]);
    const all = await net.readPlayersOnce();
    if (!_host) return;
    const me = agg.aggregateForViewer(all, loadProfile() || {}, deviceId(), loadStats());
    if (me && me.games) { _st = { games: me.games }; _combinedDevices = me.devices || 1; rerender(); }
  } catch { /* stay local */ }
}

function onKey(e) { if (e.key === 'Escape') closeStats(); }

function onClick(e) {
  if (e.target.closest('[data-role="gs-close"]')) { closeStats(); return; }
  const tab = e.target.closest('.gs-tab');
  if (tab && tab.dataset.game && tab.dataset.game !== _active) {
    _active = tab.dataset.game;
    rerender();
  }
}

export function closeStats() { if (_host) { _host.remove(); _host = null; } document.removeEventListener('keydown', onKey); }

export function openStatsOverlay() {
  ensureCss();
  closeStats();
  _active = 'connect4';
  _st = loadStats();
  _combinedDevices = 1;
  const host = document.createElement('div');
  host.className = 'gs-overlay';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', 'Game stats');
  host.innerHTML = `
    <div class="gs-scrim" data-role="gs-close"></div>
    <div class="gs-panel">
      <header class="gs-top">
        <h2>Game Stats</h2>
        <button type="button" class="gs-x" data-role="gs-close" aria-label="Close">&times;</button>
      </header>
      <nav class="gs-tabs" data-role="gs-tabs" aria-label="Choose a game">${tabsHTML()}</nav>
      <div class="gs-body" data-role="gs-body">${screenFor(_active, _st)}</div>
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
    '.gs-overlay{position:fixed;inset:0;z-index:300;opacity:0;transition:opacity .2s ease;overflow-y:auto}',
    '.gs-overlay.is-in{opacity:1}',
    '.gs-scrim{position:fixed;inset:0;background:rgba(9,24,48,.5)}',
    '.gs-panel{position:relative;width:100%;max-width:560px;margin:0 auto;min-height:100%;background:var(--hub-bg,#f4f6fb);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.gs-top{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:max(env(safe-area-inset-top,0px),16px) 18px 12px;background:rgba(255,255,255,.94);backdrop-filter:saturate(1.2) blur(6px);border-bottom:1px solid var(--hub-surface-2,#eef2f8)}',
    '.gs-top h2{margin:0;font-size:1.15rem;font-weight:800;color:var(--hub-ink,#16243a)}',
    '.gs-x{appearance:none;border:1px solid var(--hub-surface-2,#eef2f8);background:var(--hub-surface,#fff);color:var(--hub-ink,#16243a);font-size:1.4rem;line-height:1;width:38px;height:38px;border-radius:10px;cursor:pointer}',
    '.gs-tabs{display:flex;gap:4px;padding:10px 12px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;background:var(--hub-bg,#f4f6fb)}',
    '.gs-tab{flex:0 0 auto;appearance:none;border:0;background:none;cursor:pointer;padding:8px 12px 10px;font-size:.9rem;font-weight:700;color:var(--hub-muted,#5b6b82);border-bottom:3px solid transparent;white-space:nowrap}',
    '.gs-tab.is-active{color:var(--hub-ink,#16243a);font-weight:900;border-bottom-color:var(--gs-accent,#1769d4)}',
    '.gs-body{padding:14px 16px 8px;display:grid;gap:14px}',
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

export default { openStatsOverlay, closeStats };
