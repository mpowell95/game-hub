// leaderboard-ui.js - the public "Leaderboard" overlay: every player sees everyone's per-game plays,
// wins and losses. Reads the synced players/ node live (watchPlayers) and aggregates it into ONE row
// per person by player code (js/players-agg.js), so a person's phone + laptop count once. Self-contained
// (injects its own lb- CSS once); mirrors game-stats-ui.js. Opened from the hub header.
//
// Colorblind-safe: rank + the viewer's own highlighted row use weight/border, never hue alone.

import { aggregatePlayers, identityKey, nameCodeMap } from './players-agg.js';
import { watchPlayers } from './stats-net.js';
import { loadProfile } from './profile-store.js';
import { deviceId } from './game-stats.js';

// Old test/debug device records. They stay in Firebase untouched (no data is ever deleted); they are
// simply never rendered. Matched by deviceId prefix.
const HIDDEN_PREFIX = ['4392d978', 'f8ad1b82', 'zzz-prev'];   // "Tester", "test1", preview bot

const TABS = [
  { id: 'overall', label: 'Overall', accent: '#5b6b82' },
  { id: 'connect4', label: 'Connect 4', accent: '#1769d4' },
  { id: 'chinchon', label: 'Chinchón', accent: '#d4a017' },
  { id: 'business', label: 'Monopoly Deal', accent: '#6a4cff' },
  { id: 'parchis', label: 'Parchís', accent: '#c0632b' },
  { id: 'escoba', label: 'Escoba', accent: '#1c7a4f' },
  { id: 'filler', label: 'Filler', accent: '#c2557f' },
  { id: 'mancala', label: 'Mancala', accent: '#e08a3c' },
  { id: 'nutsbolts', label: 'Nuts & Bolts', accent: '#607d8b' },
];
const ACCENT = Object.fromEntries(TABS.map((t) => [t.id, t.accent]));

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
const cmp = (...fns) => (a, b) => { for (const f of fns) { const d = f(b) - f(a); if (d) return d; } return 0; };

// --- ranking rows per tab ---------------------------------------------------
function rankName(g) { return esc(g.name || 'Unnamed'); }

function overallRows(list) {
  // Competitive record only. Nuts & Bolts is solo (no W/L) and has its own tab.
  const rows = list.filter((g) => g.comp.played > 0)
    .sort(cmp((g) => g.comp.won, (g) => pct(g.comp.won, g.comp.played), (g) => g.comp.played, (g) => g.updatedAt));
  if (!rows.length) return emptyRows('No games recorded yet.');
  return table(['#', 'Player', 'W-L', 'Win rate', 'Plays'], rows.map((g, i) =>
    rowHTML(g, i, [`${g.comp.won}-${g.comp.lost}`, `${pct(g.comp.won, g.comp.played)}%`, `${g.comp.played}`])));
}

function gameRows(list, id) {
  const rows = list.filter((g) => (g.games[id].total.played | 0) > 0)
    .sort(cmp((g) => g.games[id].total.won, (g) => pct(g.games[id].total.won, g.games[id].total.played), (g) => g.games[id].total.played, (g) => g.updatedAt));
  if (!rows.length) return emptyRows(`No ${labelOf(id)} games recorded yet.`);
  return table(['#', 'Player', 'W-L', 'Win rate', 'Plays'], rows.map((g, i) => {
    const t = g.games[id].total;
    return rowHTML(g, i, [`${t.won}-${t.lost}`, `${pct(t.won, t.played)}%`, `${t.played}`]);
  }));
}

function nutsBoltsRows(list) {
  const rows = list.filter((g) => g.solo.solved > 0)
    .sort(cmp((g) => g.solo.solved, (g) => g.solo.bestLevel, (g) => -g.solo.moves, (g) => g.updatedAt));
  if (!rows.length) return emptyRows('No Nuts & Bolts levels solved yet.');
  return table(['#', 'Player', 'Solved', 'Best', 'Avg moves'], rows.map((g, i) => {
    const avg = g.solo.solved > 0 ? Math.round(g.solo.moves / g.solo.solved) : 0;
    return rowHTML(g, i, [`${g.solo.solved}`, `${g.solo.bestLevel}`, `${avg}`]);
  }));
}

function rowHTML(g, i, metrics, nameExtra) {
  const me = g.key === _meKey ? ' is-me' : '';
  const cells = metrics.map((m) => `<td>${m}</td>`).join('');
  return `<tr class="lb-r${me}"${me ? ' aria-current="true"' : ''}><td class="lb-rank">${i + 1}</td><th scope="row" class="lb-name">${rankName(g)}${nameExtra || ''}</th>${cells}</tr>`;
}
function table(head, bodyRows) {
  return `<div class="lb-tblwrap"><table class="lb-table">
    <thead><tr>${head.map((h, i) => `<th${i === 0 ? ' class="lb-rank"' : ''} scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${bodyRows}</tbody></table></div>`;
}
function emptyRows(msg) { return `<p class="lb-none">${esc(msg)}</p>`; }
function labelOf(id) { const t = TABS.find((x) => x.id === id); return t ? t.label : id; }

/** Records to render: everything except the old test/debug devices (which stay stored, just hidden). */
function visibleRecords() {
  const out = {};
  for (const id of Object.keys(_all || {})) {
    if (HIDDEN_PREFIX.some((p) => id.startsWith(p))) continue;
    out[id] = _all[id];
  }
  return out;
}

function bodyFor(id) {
  const recs = visibleRecords();
  // Only players who have set a profile name are listed. Devices with no name keep every game they
  // recorded; that history joins a player automatically the moment the device sets a name.
  const list = aggregatePlayers(recs).filter((g) => (g.name || '').trim());
  try { _meKey = identityKey(loadProfile() || {}, deviceId(), nameCodeMap(recs)).key; } catch { /* keep */ }
  if (id === 'overall') return overallRows(list);
  if (id === 'nutsbolts') return nutsBoltsRows(list);
  return gameRows(list, id);
}

// --- overlay shell ----------------------------------------------------------
let _host = null;
let _active = 'overall';
let _all = {};
let _meKey = '';
let _unsub = null;
let _connected = false;

function tabsHTML() {
  return TABS.map((t) =>
    `<button type="button" class="lb-tab${t.id === _active ? ' is-active' : ''}" data-tab="${t.id}" style="--lb-accent:${t.accent}"${t.id === _active ? ' aria-current="true"' : ''}>${esc(t.label)}</button>`
  ).join('');
}

function rerender() {
  if (!_host) return;
  const tabsEl = _host.querySelector('[data-role="lb-tabs"]');
  const bodyEl = _host.querySelector('[data-role="lb-body"]');
  if (tabsEl) tabsEl.innerHTML = tabsHTML();
  if (bodyEl) bodyEl.innerHTML = _connected ? bodyFor(_active) : `<p class="lb-none">Connecting...</p>`;
}

function renderOffline() {
  const bodyEl = _host && _host.querySelector('[data-role="lb-body"]');
  if (bodyEl) bodyEl.innerHTML = `<p class="lb-none">The leaderboard needs a connection. It lights up when you are online.</p>`;
}

function onKey(e) { if (e.key === 'Escape') closeLeaderboard(); }
function onClick(e) {
  if (e.target.closest('[data-role="lb-close"]')) { closeLeaderboard(); return; }
  const tab = e.target.closest('.lb-tab');
  if (tab && tab.dataset.tab && tab.dataset.tab !== _active) { _active = tab.dataset.tab; rerender(); }
}

export function closeLeaderboard() {
  if (typeof _unsub === 'function') { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
  if (_host) { _host.remove(); _host = null; }
  document.removeEventListener('keydown', onKey);
}

export async function openLeaderboard() {
  ensureCss();
  closeLeaderboard();
  _active = 'overall';
  _all = {};
  _connected = false;
  try { _meKey = identityKey(loadProfile() || {}, deviceId()).key; } catch { _meKey = ''; }
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
      <nav class="lb-tabs" data-role="lb-tabs" aria-label="Choose a game">${tabsHTML()}</nav>
      <div class="lb-body" data-role="lb-body"><p class="lb-none">Connecting...</p></div>
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
    '.lb-tabs{display:flex;gap:4px;padding:10px 12px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;background:var(--hub-bg,#f4f6fb)}',
    '.lb-tab{flex:0 0 auto;appearance:none;border:0;background:none;cursor:pointer;padding:8px 12px 10px;font-size:.9rem;font-weight:700;color:var(--hub-muted,#5b6b82);border-bottom:3px solid transparent;white-space:nowrap}',
    '.lb-tab.is-active{color:var(--hub-ink,#16243a);font-weight:900;border-bottom-color:var(--lb-accent,#1769d4)}',
    '.lb-body{padding:14px 16px 8px}',
    '.lb-tblwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;background:var(--hub-surface,#fff);box-shadow:0 4px 16px rgba(20,40,80,.06)}',
    '.lb-table{width:100%;border-collapse:collapse;min-width:360px}',
    '.lb-table th,.lb-table td{padding:10px 12px;text-align:right;font-size:.9rem}',
    '.lb-table thead th{background:var(--hub-surface-2,#eef2f8);color:var(--hub-muted,#5b6b82);font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em}',
    '.lb-table .lb-rank{text-align:center;width:34px;color:var(--hub-muted,#5b6b82);font-weight:800}',
    '.lb-table .lb-name{text-align:left;font-weight:800;color:var(--hub-ink,#16243a)}',
    '.lb-table tbody td{font-weight:800;color:var(--hub-ink,#16243a);font-variant-numeric:tabular-nums}',
    '.lb-table tbody tr+tr th,.lb-table tbody tr+tr td{border-top:1px solid var(--hub-surface-2,#eef2f8)}',
    '.lb-dev{display:block;font-style:normal;font-size:.72rem;font-weight:700;color:var(--hub-muted,#5b6b82)}',
    '.lb-r.is-me td,.lb-r.is-me th{background:rgba(23,105,212,.10)}',
    '.lb-r.is-me .lb-rank{box-shadow:inset 3px 0 0 var(--hub-accent,#1769d4)}',
    '.lb-none{margin:0;color:var(--hub-muted,#5b6b82);font-size:.92rem;font-weight:600;background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:12px;padding:22px 16px;text-align:center}',
    '.lb-foot{text-align:center;color:var(--hub-muted,#5b6b82);font-size:.76rem;padding:12px 16px 40px;margin:0}',
  ].join('');
  document.head.appendChild(el);
}

export default { openLeaderboard, closeLeaderboard };
