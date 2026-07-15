// game-stats-ui.js - the player-facing "Your Game Stats" screen. Reads the local unified stats
// (game-stats.js) and shows, per game, total played/won/lost + win rate and a per-difficulty
// breakdown. Light hub theme; self-contained (injects its own CSS once). Opened from the hub header.

import { loadStats } from './game-stats.js';

const GAMES = [
  { id: 'connect4', label: 'Connect 4', accent: '#d21f3c' },
  { id: 'chinchon', label: 'Chinchón', accent: '#c8102e' },
  { id: 'business', label: 'Monopoly Deal', accent: '#1a7a3e' },
  { id: 'parchis', label: 'Parchís', accent: '#1769d4' },
];
const DIFF_ORDER = ['easy', 'beginner', 'facil', 'medium', 'normal', 'average', 'intermediate', 'hard', 'pro', 'dificil', 'expert'];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function rate(w, p) { return p > 0 ? Math.round((w / p) * 100) : 0; }
function titleCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function diffRows(byDiff) {
  const keys = Object.keys(byDiff || {}).filter((k) => (byDiff[k].played | 0) > 0);
  if (!keys.length) return '';
  keys.sort((a, b) => {
    if (a === 'legacy') return 1; if (b === 'legacy') return -1;
    return (DIFF_ORDER.indexOf(a) + 1 || 99) - (DIFF_ORDER.indexOf(b) + 1 || 99);
  });
  return '<ul class="gs-diffs">' + keys.map((k) => {
    const d = byDiff[k];
    const label = k === 'legacy' ? 'Earlier games' : titleCase(k);
    return `<li><span class="gs-diff-name">${esc(label)}</span><span class="gs-diff-nums">${d.played | 0} played &middot; ${d.won | 0}W ${d.lost | 0}L</span></li>`;
  }).join('') + '</ul>';
}

function gameCard(g, rec) {
  const t = (rec && rec.total) || { played: 0, won: 0, lost: 0 };
  const played = t.played | 0;
  if (!played) {
    return `<section class="gs-card gs-empty">
      <div class="gs-card-head"><span class="gs-dot" style="background:${g.accent}"></span><h3>${esc(g.label)}</h3></div>
      <p class="gs-none">Not played yet</p></section>`;
  }
  return `<section class="gs-card">
    <div class="gs-card-head"><span class="gs-dot" style="background:${g.accent}"></span><h3>${esc(g.label)}</h3><span class="gs-rate">${rate(t.won | 0, played)}% won</span></div>
    <div class="gs-tallies">
      <div class="gs-tally"><b>${played}</b><span>played</span></div>
      <div class="gs-tally"><b>${t.won | 0}</b><span>won</span></div>
      <div class="gs-tally"><b>${t.lost | 0}</b><span>lost</span></div>
    </div>
    ${diffRows(rec && rec.byDiff)}
  </section>`;
}

let _host = null;
function onKey(e) { if (e.key === 'Escape') closeStats(); }
export function closeStats() { if (_host) { _host.remove(); _host = null; } document.removeEventListener('keydown', onKey); }

export function openStatsOverlay() {
  ensureCss();
  closeStats();
  const st = loadStats();
  const cards = GAMES.map((g) => gameCard(g, st.games && st.games[g.id])).join('');
  const host = document.createElement('div');
  host.className = 'gs-overlay';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', 'Your game stats');
  host.innerHTML = `
    <div class="gs-scrim" data-role="gs-close"></div>
    <div class="gs-panel">
      <header class="gs-top">
        <h2>Your Game Stats</h2>
        <button type="button" class="gs-x" data-role="gs-close" aria-label="Close">&times;</button>
      </header>
      <div class="gs-body">${cards}</div>
      <p class="gs-foot">Saved on this device. Counts every game you finish.</p>
    </div>`;
  host.addEventListener('click', (e) => { if (e.target.closest('[data-role="gs-close"]')) closeStats(); });
  document.body.appendChild(host);
  _host = host;
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => host.classList.add('is-in'));
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
    '.gs-top{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:max(env(safe-area-inset-top,0px),16px) 18px 14px;background:rgba(255,255,255,.94);backdrop-filter:saturate(1.2) blur(6px);border-bottom:1px solid var(--hub-surface-2,#eef2f8)}',
    '.gs-top h2{margin:0;font-size:1.15rem;font-weight:800;color:var(--hub-ink,#16243a)}',
    '.gs-x{appearance:none;border:1px solid var(--hub-surface-2,#eef2f8);background:var(--hub-surface,#fff);color:var(--hub-ink,#16243a);font-size:1.4rem;line-height:1;width:38px;height:38px;border-radius:10px;cursor:pointer}',
    '.gs-body{padding:16px 16px 8px;display:grid;gap:12px}',
    '.gs-card{background:var(--hub-surface,#fff);border:1px solid var(--hub-surface-2,#eef2f8);border-radius:14px;padding:14px 16px;box-shadow:0 4px 16px rgba(20,40,80,.06)}',
    '.gs-card-head{display:flex;align-items:center;gap:9px;margin-bottom:10px}',
    '.gs-card-head h3{margin:0;font-size:1rem;font-weight:800;color:var(--hub-ink,#16243a)}',
    '.gs-dot{width:12px;height:12px;border-radius:50%;flex:none}',
    '.gs-rate{margin-left:auto;font-size:.8rem;font-weight:800;color:var(--hub-muted,#5b6b82)}',
    '.gs-tallies{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
    '.gs-tally{background:var(--hub-surface-2,#eef2f8);border-radius:10px;padding:8px 4px;text-align:center}',
    '.gs-tally b{display:block;font-size:1.3rem;font-weight:900;color:var(--hub-ink,#16243a)}',
    '.gs-tally span{font-size:.72rem;font-weight:700;color:var(--hub-muted,#5b6b82);text-transform:uppercase;letter-spacing:.04em}',
    '.gs-diffs{list-style:none;margin:12px 0 0;padding:12px 0 0;border-top:1px solid var(--hub-surface-2,#eef2f8);display:grid;gap:6px}',
    '.gs-diffs li{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:.86rem}',
    '.gs-diff-name{font-weight:700;color:var(--hub-ink,#16243a)}',
    '.gs-diff-nums{color:var(--hub-muted,#5b6b82);font-weight:600;white-space:nowrap}',
    '.gs-empty{opacity:.75}',
    '.gs-none{margin:0;color:var(--hub-muted,#5b6b82);font-size:.88rem;font-weight:600}',
    '.gs-foot{text-align:center;color:var(--hub-muted,#5b6b82);font-size:.78rem;padding:6px 16px 40px;margin:0}',
  ].join('');
  document.head.appendChild(el);
}

export default { openStatsOverlay, closeStats };
