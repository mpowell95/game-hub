// tower/js/ui.js — Tower: stack sliding blocks as high as you can. Module entry (init / destroy /
// isInProgress). The rules are in engine.js (pure); this file draws, times and records.
//
// isInProgress(): the LITERAL meaning (no mid-run resume, same class as Snake / Brick Breaker): true
// only while a run is live. Leaving mid-run abandons it and records nothing.
//
// Screens: setup (picture + "?", title + best, Look x3, Difficulty x4, Play, the leader footer),
// play (canvas, score, best, perfect streak), game over (card with an X: score, best, perfects, Again).
// Every finished run is recorded ONCE through recordTower inside withMode({ look }, diff, ..., { hi }).

import * as E from './engine.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordTower, loadStats, withMode } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { onThemeChange } from '../../js/theme.js';

const t = makeT(STRINGS);
const KEY = 'gamehub.tower.v1';
const LOOKS = ['city', 'ice', 'space'];
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { s = {}; }
  return { diff: E.normDiff(s.diff), look: LOOKS.indexOf(s.look) >= 0 ? s.look : 'city' };
}
function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify({ diff: s.diff, look: s.look })); } catch (err) { console.warn('[tower] settings not saved', err); }
}
function towerRec() {
  try { return (loadStats().games || {}).tower || null; } catch { return null; }
}
function bestFor(diff) {
  const tw = (towerRec() || {}).tw;
  return tw ? ((tw.bestByDiff || {})[diff] | 0) : 0;
}

// --- Looks: sky, skyline, block colours --------------------------------------------------------
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
/** Dark theme (js/theme.js puts .gh-dark on <html>): City and Ice play at NIGHT (Matt, 2026-11-02: "quality
 *  dark mode"); Space is already dark. Read at draw time, so a theme switch shows on the next frame. */
const isDark = () => { try { return document.documentElement.classList.contains('gh-dark'); } catch { return false; } };
function skyOf(look, level, dark = isDark()) {
  const k = Math.min(1, level / 60);
  const two = (a, b, c, kk) => (kk < 0.5 ? mix(a, b, kk * 2) : mix(b, c, (kk - 0.5) * 2));
  if (dark && look === 'city') {
    return { top: two([18, 26, 62], [12, 16, 46], [4, 6, 22], k), bot: two([58, 62, 118], [38, 40, 92], [16, 18, 48], k), stars: 0.45 + k * 0.55, k, night: true };
  }
  if (dark && look === 'ice') {
    return { top: two([10, 34, 58], [8, 26, 48], [2, 10, 24], k), bot: two([34, 96, 104], [22, 70, 88], [10, 34, 46], k), stars: 0.5 + k * 0.5, k, night: true };
  }
  if (look === 'ice') {
    return { top: two([150, 205, 235], [60, 120, 170], [8, 30, 60], k), bot: two([235, 248, 255], [170, 220, 235], [30, 90, 110], k), stars: Math.max(0, k - 0.5) * 2, k };
  }
  if (look === 'space') {
    return { top: two([20, 22, 60], [12, 12, 40], [4, 4, 16], k), bot: two([70, 50, 120], [40, 30, 90], [16, 12, 40], k), stars: 0.6 + k * 0.4, k };
  }
  return { top: two([94, 170, 240], [60, 70, 150], [10, 14, 40], k), bot: two([200, 230, 255], [245, 150, 120], [30, 40, 90], k), stars: Math.max(0, k - 0.55) * 2.2, k };
}
function slabOf(look, i) {
  let h, s, l;
  if (look === 'ice') { h = 185 + Math.sin(i / 6) * 25; s = 55; l = 66 + Math.sin(i / 3) * 8; }
  else if (look === 'space') { h = (250 + i * 7) % 360; s = 60; l = 60; }
  else { h = (200 + i * 9) % 360; s = 66; l = 56; }
  return { top: `hsl(${h} ${s + 4}% ${l + 8}%)`, face: `hsl(${h} ${s}% ${l}%)`, edge: `hsl(${h} ${s - 6}% ${l - 14}%)` };
}

/** The setup screen's picture: a short tower in the chosen look (SVG, no canvas). */
function heroSVG(look) {
  const dark = isDark();
  const sky = skyOf(look, dark ? 10 : 30);
  let blocks = '';
  let x = 50, w = 150;
  const offs = [0, 6, -4, 0, 8, 0, -5, 3, 0];
  for (let i = 0; i < 9; i++) {
    x += offs[i]; w -= Math.abs(offs[i]);
    const y = 218 - (i + 1) * 20, c = slabOf(look, i);
    blocks += `<rect x="${x}" y="${y + 4}" width="${w}" height="16" fill="${c.face}"/><rect x="${x}" y="${y}" width="${w}" height="4" fill="${c.top}"/><rect x="${x}" y="${y + 17}" width="${w}" height="3" fill="${c.edge}"/>`;
  }
  const c9 = slabOf(look, 9);
  blocks += `<rect x="${x + 34}" y="${218 - 10 * 20}" width="${w}" height="20" fill="${c9.face}"/>`;
  let scenery = '';
  if (look === 'city') scenery = `<g fill="${dark ? '#0b1230' : 'rgba(20,30,60,.25)'}"><rect x="0" y="150" width="28" height="70"/><rect x="34" y="170" width="24" height="50"/><rect x="190" y="140" width="26" height="80"/><rect x="222" y="165" width="30" height="55"/></g>`
    + (dark ? '<g fill="#F2B705" opacity=".85"><rect x="6" y="160" width="4" height="4"/><rect x="16" y="176" width="4" height="4"/><rect x="40" y="182" width="4" height="4"/><rect x="196" y="152" width="4" height="4"/><rect x="206" y="170" width="4" height="4"/><rect x="230" y="176" width="4" height="4"/><rect x="240" y="192" width="4" height="4"/></g><g fill="#fff"><rect x="40" y="30" width="2" height="2"/><rect x="120" y="18" width="2" height="2"/><rect x="210" y="44" width="2" height="2"/><rect x="70" y="90" width="2" height="2"/></g>' : '');
  else if (dark && look === 'ice') scenery = '<path d="M0 218 L40 160 L80 218Z M170 218 L215 150 L250 200 L250 218Z" fill="#244a5c"/><path d="M0 60 Q60 30 125 70 T250 50" stroke="#3fd6a8" stroke-width="10" fill="none" opacity=".35"/><g fill="#fff"><rect x="30" y="20" width="2" height="2"/><rect x="200" y="30" width="2" height="2"/><rect x="150" y="100" width="2" height="2"/></g>';
  else if (look === 'ice') scenery = '<path d="M0 218 L40 160 L80 218Z M170 218 L215 150 L250 200 L250 218Z" fill="rgba(255,255,255,.55)"/>';
  else scenery = '<g fill="#fff"><rect x="20" y="30" width="2" height="2"/><rect x="60" y="80" width="2" height="2"/><rect x="200" y="40" width="2" height="2"/><rect x="230" y="110" width="2" height="2"/><rect x="30" y="140" width="2" height="2"/><rect x="120" y="20" width="2" height="2"/></g><circle cx="205" cy="70" r="16" fill="#F2B705"/>';
  return `<svg viewBox="0 0 250 250" aria-hidden="true"><defs><linearGradient id="twsky-${look}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rgb(sky.top)}"/><stop offset="1" stop-color="${rgb(sky.bot)}"/></linearGradient></defs>
    <rect width="250" height="250" fill="url(#twsky-${look})"/>${scenery}
    <rect x="0" y="218" width="250" height="32" fill="${dark && look === 'ice' ? '#5d7f90' : '#2b3a55'}"/><rect x="0" y="218" width="250" height="4" fill="#3d5070"/>${blocks}</svg>`;
}
function lookThumb(look) {
  const dark = isDark();
  const sky = skyOf(look, look === 'space' ? 30 : 0);
  const b = [0, 1, 2].map((i) => slabOf(look, i).face);
  let extra = '';
  if (look === 'city') extra = `<g fill="${dark ? '#0b1230' : 'rgba(20,30,60,.25)'}"><rect x="4" y="20" width="12" height="24"/><rect x="80" y="16" width="14" height="28"/></g>` + (dark ? '<g fill="#F2B705"><rect x="7" y="25" width="2" height="2"/><rect x="11" y="32" width="2" height="2"/><rect x="84" y="22" width="2" height="2"/><rect x="88" y="30" width="2" height="2"/></g>' : '');
  else if (dark && look === 'ice') extra = '<path d="M0 44 L18 22 L34 44 Z M66 44 L84 18 L100 40 L100 44Z" fill="#244a5c"/><path d="M0 12 Q30 2 60 14 T100 8" stroke="#3fd6a8" stroke-width="4" fill="none" opacity=".5"/>';
  else if (look === 'ice') extra = '<path d="M0 44 L18 22 L34 44 Z M66 44 L84 18 L100 40 L100 44Z" fill="rgba(255,255,255,.7)"/>';
  else extra = '<g fill="#fff"><rect x="10" y="8" width="2" height="2"/><rect x="30" y="16" width="2" height="2"/><rect x="72" y="6" width="2" height="2"/><rect x="18" y="30" width="2" height="2"/></g><circle cx="84" cy="12" r="6" fill="#F2B705"/>';
  return `<svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="44" fill="${rgb(sky.top)}"/><rect y="22" width="100" height="22" fill="${rgb(sky.bot)}" opacity=".6"/>${extra}
    <rect x="38" y="34" width="24" height="7" fill="${b[0]}"/><rect x="40" y="27" width="20" height="7" fill="${b[1]}"/><rect x="41" y="20" width="18" height="7" fill="${b[2]}"/></svg>`;
}

class Tower {
  constructor(host) {
    this.host = host;
    this.s = loadSettings();
    this.screen = 'setup';
    this.run = null;
    this.fx = { falling: [], flashes: [] };
    this.cam = 0; this.camTarget = 0; this.zoom = 1; this.zoomTarget = 1; this.lift = 0; this.liftTarget = 0;
    this.lead = null; this.leadBusy = false;
    this.raf = 0; this.last = 0;
    this._ensureCss();
    this._build();
    this._onDown = (e) => this._tap(e);
    this._onKey = (e) => { if (this.screen === 'play' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); this._drop(); } };
    this._onVis = () => { if (document.hidden) this._stop(); else this._start(); };
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.root.addEventListener('click', this._onClick = (e) => this._click(e));
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('visibilitychange', this._onVis);
    this._offResize = onViewportResize(() => this._layout());
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this._layout()) : null;
    if (this._ro) this._ro.observe(this.root);
    this._offLang = onLangChange(() => { if (this.screen === 'setup') this._renderSetup(); this._renderHelp(); });
    this._offTheme = onThemeChange(() => { if (this.screen === 'setup') this._renderSetup(); this._renderTowers(); this._draw(); });
    this._layout();
    this._showSetup();
    this._start();
  }

  _ensureCss() {
    const href = new URL('../css/tower.css', import.meta.url).href;
    if (![...document.styleSheets].some((x) => x.href === href) && !document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      document.head.appendChild(link);
    }
  }

  _build() {
    this.host.innerHTML = `
      <div class="tw-root">
        <canvas class="tw-canvas" role="img"></canvas>
        <div class="tw-hud" data-role="hud" hidden>
          <div class="tw-best">&#9733; <b data-role="hudBest">0</b></div>
          <div class="tw-score" data-role="score">0</div>
          <div class="tw-streak" data-role="streak" hidden><span aria-hidden="true">&#9670;</span> <b data-role="streakN">0</b></div>
        </div>
        <div class="tw-setup" data-role="setup"></div>
        <div class="tw-ov" data-role="over" hidden></div>
        <div class="tw-ov" data-role="help" hidden></div>
        <div class="tw-towers" data-role="towers" hidden></div>
      </div>`;
    this.root = this.host.querySelector('.tw-root');
    this.canvas = this.root.querySelector('.tw-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.el = (r) => this.root.querySelector(`[data-role="${r}"]`);
    this.canvas.setAttribute('aria-label', t('aria_board'));
    this._renderHelp();
  }

  _layout() {
    const r = this.root.getBoundingClientRect();
    const W = Math.round(r.width), H = Math.round(r.height);
    if (!W || !H) { requestAnimationFrame(() => this._layout()); return; }
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(W * this.dpr); this.canvas.height = Math.round(H * this.dpr);
    // World units -> CSS px. Narrow screens fill the width; wide ones cap so the tower is not huge.
    this.k = Math.min(W / E.WORLD_W, (H * 0.62) / E.WORLD_W * 1.3);
    this._draw();
  }

  // --- screens ---------------------------------------------------------------------------------
  _showSetup() {
    this.screen = 'setup';
    this.run = null;
    this.fx = { falling: [], flashes: [] };
    this.cam = this.camTarget = 0; this.zoom = this.zoomTarget = 1; this.lift = this.liftTarget = 0;
    this.el('hud').hidden = true;
    this.el('towers').hidden = true;
    this.el('over').hidden = true;
    this.el('setup').hidden = false;
    this._renderSetup();
  }

  _renderSetup() {
    const s = this.s;
    const looks = LOOKS.map((k) => `
      <button type="button" class="tw-look${k === s.look ? ' is-sel' : ''}" data-act="look" data-v="${k}" role="radio" aria-checked="${k === s.look}">
        ${lookThumb(k)}<b>${t('look_' + k)}</b>${k === s.look ? '<span class="tw-chk" aria-hidden="true">&#10003;</span>' : ''}
      </button>`).join('');
    const diffs = E.DIFFS.map((d) => `
      <button type="button" class="tw-seg${d === s.diff ? ' is-sel' : ''}" data-act="diff" data-v="${d}" role="radio" aria-checked="${d === s.diff}">
        <span class="tw-seg-t">${diffShapeSVG(tierOf(d))}<b>${t('diff_' + d)}</b></span>
        <span class="tw-seg-n">&#9733; ${bestFor(d)}</span>
      </button>`).join('');
    this.el('setup').innerHTML = `
      <div class="tw-home">
        <div class="tw-herorow">
          <button type="button" class="tw-hero" data-act="play" aria-label="${esc(t('play'))}">${heroSVG(s.look)}</button>
          <button type="button" class="tw-q" data-act="help" aria-label="${esc(t('how_title'))}">?</button>
        </div>
        <div class="tw-head"><h1>${esc(t('title'))}</h1><p class="tw-hbest">&#9733; <b>${bestFor(s.diff)}</b></p></div>
        <div class="tw-card">
          <div class="tw-looks" role="radiogroup" aria-label="${esc(t('aria_look'))}">${looks}</div>
          <div class="tw-segs" role="radiogroup" aria-label="${esc(t('aria_diff'))}">${diffs}</div>
          <button type="button" class="tw-play" data-act="play">${esc(t('play'))}</button>
        </div>
        <div class="tw-lead">${this._leadHTML()}</div>
      </div>`;
  }

  /** The footer: the leader at the chosen difficulty (ties all named), and Leaderboard ›. Read from the
   *  server-built board (readPeople), at most once a minute. This phone's own best counts at once. */
  _leadHTML() {
    if (!this.lead || Date.now() - this.lead.at > 60000) this._loadLead();
    const d = this.s.diff;
    const rows = (this.lead && this.lead.rows) || [];
    const mine = bestFor(d);
    const all = rows.map((r) => (r.me ? { ...r, best: Math.max(r.by[d] | 0, mine) } : { ...r, best: r.by[d] | 0 }));
    if (!all.some((r) => r.me) && mine > 0) {
      let p = {};
      try { p = loadProfile() || {}; } catch { p = {}; }
      all.push({ me: true, name: p.name || '', emoji: p.emoji || '', best: mine });
    }
    const top = all.reduce((m, r) => Math.max(m, r.best || 0), 0);
    const lead = top > 0 ? all.filter((r) => r.best === top) : [];
    const names = lead.map((r) => `${esc(r.emoji)} ${esc(r.name)}`.trim()).filter(Boolean).join(' &amp; ');
    return `
      <span class="tw-lead-who"><span aria-hidden="true">&#127942;</span> <span class="tw-lead-name">${names || '-'}</span> <b>${lead.length ? top : ''}</b></span>
      <button type="button" class="tw-lead-all" data-act="board">${esc(t('leaderboard'))} &#8250;</button>`;
  }
  async _loadLead() {
    if (this.leadBusy) return;
    this.leadBusy = true;
    let rows = [];
    try {
      const [net, hidden] = await Promise.all([import('../../js/stats-net.js'), import('../../js/hidden-players.js')]);
      const people = await net.readPeople();
      if (people) {
        const p = loadProfile() || {};
        rows = people.list.filter((g) => g.key === people.meKey || !hidden.isHiddenName(g.name)).map((g) => {
          const me = g.key === people.meKey;
          const tw = (((g.games || {}).tower) || {}).tw || {};
          return { me, name: me ? (p.name || g.name || '') : g.name, emoji: me ? (p.emoji || g.emoji || '') : g.emoji, by: tw.bestByDiff || {} };
        });
      }
    } catch (err) { console.warn('[tower] leader not read', err); }
    this.leadBusy = false;
    this.lead = { at: Date.now(), rows };
    const box = this.root && this.screen === 'setup' && this.root.querySelector('.tw-lead');
    if (box) box.innerHTML = this._leadHTML();
    this._renderTowers();
  }
  async _openLeaderboard() {
    try {
      const m = await import('../../js/leaderboard-ui.js');
      await m.openLeaderboard({ game: 'tower' });
    } catch (err) { console.error('[tower] leaderboard', err); }
  }

  _renderHelp() {
    this.el('help').innerHTML = `
      <div class="tw-card tw-help">
        <button type="button" class="tw-x" data-act="helpClose" aria-label="${esc(t('aria_close'))}">${X_SVG}</button>
        <h2>${esc(t('how_title'))}</h2>
        <ol><li>${esc(t('how_1'))}</li><li>${esc(t('how_2'))}</li><li>${esc(t('how_3'))}</li><li>${esc(t('how_4'))}</li></ol>
        <button type="button" class="tw-play" data-act="helpClose">${esc(t('ok'))}</button>
      </div>`;
  }

  _click(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !this.root.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'look') { this.s.look = b.dataset.v; saveSettings(this.s); this._renderSetup(); this._draw(); }
    else if (act === 'diff') { this.s.diff = E.normDiff(b.dataset.v); saveSettings(this.s); this._renderSetup(); }
    else if (act === 'play' || act === 'again') this._play();
    else if (act === 'help') this.el('help').hidden = false;
    else if (act === 'helpClose') this.el('help').hidden = true;
    else if (act === 'board' || act === 'compare') this._showTowers();
    else if (act === 'towersClose') this.el('towers').hidden = true;
    else if (act === 'twDiff') { this.towersDiff = E.normDiff(b.dataset.v); this._renderTowers(); }
    else if (act === 'fullBoard') this._openLeaderboard();
    else if (act === 'menu') this._showSetup();
  }

  _play() {
    this.el('setup').hidden = true;
    this.el('over').hidden = true;
    this.el('help').hidden = true;
    this.el('hud').hidden = false;
    this.screen = 'play';
    this.run = E.createRun(this.s.diff);
    this.best = bestFor(this.s.diff);
    this.recorded = false;
    this.fx = { falling: [], flashes: [] };
    this.cam = this.camTarget = 0; this.zoom = this.zoomTarget = 1; this.lift = this.liftTarget = 0;
    this.el('towers').hidden = true;
    this._hud();
  }

  _tap(e) {
    if (this.screen !== 'play') return;
    e.preventDefault();
    this._drop();
  }

  _drop() {
    const run = this.run;
    if (!run || run.over) return;
    const i = run.stack.length;           // the level the block was sliding on
    const res = E.drop(run);
    if (res.kind === 'perfect') {
      const top = run.stack[run.stack.length - 1];
      this.fx.flashes.push({ i, x: top.x, w: top.w, t: 0 });
    }
    if (res.cut && res.cut.w > 0.5) {
      this.fx.falling.push({ x: res.cut.x, w: res.cut.w, y: this._yOf(i), vy: 0, rot: 0, vr: res.cut.dir * (res.kind === 'miss' ? 1.2 : 2.2), i });
    }
    if (res.kind === 'miss') { this._gameOver(); return; }
    this.camTarget = Math.max(0, (run.stack.length - 7) * E.BLOCK_H);
    this._hud();
  }

  _hud() {
    const run = this.run;
    if (!run) return;
    const sc = E.score(run);
    this.el('score').textContent = String(sc);
    this.el('hudBest').textContent = String(Math.max(this.best | 0, sc));
    const st = this.el('streak');
    st.hidden = run.streak < 2;
    this.el('streakN').textContent = String(run.streak);
  }

  _gameOver() {
    const run = this.run;
    this.screen = 'over';
    const sc = E.score(run);
    const before = this.best | 0;          // the PREVIOUS best: its line stays drawn at game over
    this._record(run);
    const isNew = sc > before && sc > 0;
    this.camTarget = 0;
    // Zoom out to show the whole tower AND the best line, above the card (the ground lifts over it).
    this.liftTarget = Math.min(this.H * 0.3, 210);
    const room = this.H - Math.max(90, this.H * 0.13) - this.liftTarget - 110;
    const tall = (Math.max(run.stack.length, before + 1) + 1) * E.BLOCK_H * this.k;
    this.zoomTarget = Math.min(1, room / tall);
    this.el('hud').hidden = true;
    clearTimeout(this._overT);
    this._overT = setTimeout(() => {
      if (this.screen !== 'over') return;
      const ov = this.el('over');
      ov.innerHTML = `
        <div class="tw-card tw-overcard">
          <button type="button" class="tw-x" data-act="menu" aria-label="${esc(t('aria_close'))}">${X_SVG}</button>
          <div class="tw-big">${sc}</div>
          ${isNew ? `<div class="tw-new">&#9733; ${esc(t('new_best'))}</div>` : `<div class="tw-obest">&#9733; ${before}</div>`}
          <div class="tw-btns">
            <button type="button" class="tw-play" data-act="again">${esc(t('again'))}</button>
            <button type="button" class="tw-play tw-alt" data-act="compare">${esc(t('compare'))}</button>
          </div>
        </div>`;
      ov.hidden = false;
    }, 750);
  }

  // --- Everyone's record tower (Matt, 2026-11-02: "the screen where you can see everyone's record tower") ---
  _showTowers() {
    this.towersDiff = this.screen === 'over' && this.run ? this.run.diff : this.s.diff;
    if (!this.lead || Date.now() - this.lead.at > 60000) this._loadLead();
    this.el('towers').hidden = false;
    this._renderTowers();
  }
  /** One column per person with a best at this difficulty, tallest first, drawn as a stack of slabs in
   *  the chosen look. Names are profile names (never "You"); this phone's own column is ringed + bold. */
  _renderTowers() {
    const box = this.el('towers');
    if (!box || box.hidden) return;
    const d = this.towersDiff;
    const rows = ((this.lead && this.lead.rows) || []).map((r) => ({ ...r, best: r.by[d] | 0 }));
    const mine = bestFor(d);
    let meRow = rows.find((r) => r.me);
    if (meRow) meRow.best = Math.max(meRow.best, mine);
    else if (mine > 0) {
      let p = {};
      try { p = loadProfile() || {}; } catch { p = {}; }
      rows.push({ me: true, name: p.name || '', emoji: p.emoji || '', best: mine });
    }
    const list = rows.filter((r) => r.best > 0).sort((a, b) => b.best - a.best);
    const top = list.reduce((m, r) => Math.max(m, r.best), 0);
    const look = this.s.look;
    const col = (r, i) => {
      const n = r.best, H = 100;
      const sh = H / Math.max(n, 1);   // the column's own height is set to n / top below
      const draw = Math.min(n, 120), step = n / draw;
      let rects = '';
      for (let j = 0; j < draw; j++) {
        const c = slabOf(look, Math.floor(j * step));
        const y = H - (j + 1) * sh * step;
        rects += `<rect x="0" y="${y.toFixed(2)}" width="20" height="${(sh * step + 0.05).toFixed(2)}" fill="${c.face}"/>`;
        if (sh * step > 2.5) rects += `<rect x="0" y="${y.toFixed(2)}" width="20" height="${(Math.min(1, sh * step * 0.2)).toFixed(2)}" fill="${c.top}"/>`;
      }
      return `
        <div class="tw-col${r.me ? ' is-me' : ''}">
          <b class="tw-col-n">${n}</b>
          <svg class="tw-col-t" viewBox="0 0 20 100" preserveAspectRatio="none" style="height:calc((100% - 64px) * ${(n / Math.max(top, 1)).toFixed(4)})" aria-hidden="true">${rects}</svg>
          <span class="tw-col-who">${i < 3 ? ['&#129351;', '&#129352;', '&#129353;'][i] + ' ' : ''}${esc(r.emoji)} ${esc(r.name || t('anon_player'))}</span>
        </div>`;
    };
    const tabs = E.DIFFS.map((k) => `
      <button type="button" class="tw-tab${k === d ? ' is-sel' : ''}" data-act="twDiff" data-v="${k}" role="tab" aria-selected="${k === d}">${diffShapeSVG(tierOf(k))}<b>${t('diff_' + k)}</b></button>`).join('');
    box.innerHTML = `
      <div class="tw-tw-head">
        <h2>${esc(t('records'))}</h2>
        <button type="button" class="tw-x" data-act="towersClose" aria-label="${esc(t('aria_close'))}">${X_SVG}</button>
      </div>
      <div class="tw-tabs" role="tablist">${tabs}</div>
      <div class="tw-cols">${list.length ? list.map(col).join('') : '<p class="tw-none">-</p>'}</div>
      <button type="button" class="tw-lead-all tw-full" data-act="fullBoard">${esc(t('leaderboard'))} &#8250;</button>`;
    const me = box.querySelector('.tw-col.is-me');
    if (me && me.scrollIntoView) { try { me.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch { /* old browser */ } }
  }

  /** Once per run. withMode carries the LOOK and the DIFFICULTY (root CLAUDE.md, "Every result records
   *  its MODE") and the height as that mode's best. */
  _record(run) {
    if (this.recorded) return;
    this.recorded = true;
    const d = run.diff;
    try {
      const st = withMode(() => ({ look: this.s.look }), d,
        () => recordTower(E.score(run), d, { perfects: run.perfects, bestStreak: run.bestStreak }),
        () => ({ hi: E.score(run) }));
      if (!st) console.warn('[tower] result not recorded (rate gate or store refused it)');
    } catch (err) { console.error('[tower] recording the result failed', err); }
  }

  // --- loop + drawing ------------------------------------------------------------------------------
  _start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this._step(dt);
      this._draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  _stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  _step(dt) {
    if (this.screen === 'play' && this.run) E.stepMover(this.run, dt);
    this.cam += (this.camTarget - this.cam) * Math.min(1, dt * 6);
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 4);
    this.lift += (this.liftTarget - this.lift) * Math.min(1, dt * 4);
    for (const f of this.fx.falling) { f.vy += 1300 * dt; f.y += f.vy * dt; f.rot += f.vr * dt; }
    this.fx.falling = this.fx.falling.filter((f) => f.y < 4000);
    for (const f of this.fx.flashes) f.t += dt;
    this.fx.flashes = this.fx.flashes.filter((f) => f.t < 0.45);
  }

  _groundY() { return this.H - Math.max(90, this.H * 0.13) - (this.lift || 0); }
  /** World y (units, up from the ground) of level i's top edge, in screen px before zoom. */
  _yOf(i) { return -(i + 1) * E.BLOCK_H; }

  _draw() {
    const ctx = this.ctx, W = this.W, H = this.H, k = this.k;
    if (!ctx || !W) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const look = this.s.look;
    const level = this.run ? this.run.stack.length : 0;
    const sky = skyOf(look, level);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(sky.top)); g.addColorStop(1, rgb(sky.bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (sky.stars > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, sky.stars)})`;
      for (let s = 0; s < 70; s++) ctx.fillRect((s * 97.3) % W, (s * 53.7) % (H * 0.75), 2, 2);
    }
    const gy = this._groundY();
    const camPx = this.cam * k;
    // Scenery behind the tower, scrolling slower than it.
    const par = camPx * 0.35;
    if (look === 'city') {
      ctx.fillStyle = sky.night ? '#0b1230' : `rgba(20,30,60,${0.18 + sky.k * 0.3})`;
      for (let b = 0; b < 12; b++) {
        const bw = W / 10, bh = 60 + ((b * 37) % 90);
        ctx.fillRect(b * bw * 0.95 - 10, gy - bh + par, bw * 0.8, bh + 400);
      }
      if (sky.night) {
        // Lit windows: a fixed pattern per building (no flicker), warm yellow.
        ctx.fillStyle = 'rgba(242,183,5,.8)';
        for (let b = 0; b < 12; b++) {
          const bw = W / 10, bh = 60 + ((b * 37) % 90), x0 = b * bw * 0.95 - 10;
          for (let r = 0; r * 14 + 10 < bh; r++) for (let c = 0; c < 3; c++) {
            if (((b * 7 + r * 3 + c * 5) % 4) !== 0) continue;
            ctx.fillRect(x0 + 5 + c * (bw * 0.8 - 10) / 3, gy - bh + par + 8 + r * 14, 4, 5);
          }
        }
      }
    } else if (look === 'ice' && sky.night) {
      // Aurora ribbons + dark peaks.
      for (let a = 0; a < 2; a++) {
        ctx.strokeStyle = a ? 'rgba(120,120,255,.18)' : 'rgba(63,214,168,.28)';
        ctx.lineWidth = 26 - a * 8;
        ctx.beginPath();
        const y0 = H * (0.18 + a * 0.08) + par * 0.2;
        ctx.moveTo(-20, y0);
        ctx.bezierCurveTo(W * 0.3, y0 - 50, W * 0.6, y0 + 60, W + 20, y0 - 10);
        ctx.stroke();
      }
      ctx.fillStyle = '#244a5c';
      ctx.beginPath();
      ctx.moveTo(0, gy + par); ctx.lineTo(W * 0.18, gy - 110 + par); ctx.lineTo(W * 0.36, gy + par);
      ctx.moveTo(W * 0.55, gy + par); ctx.lineTo(W * 0.8, gy - 140 + par); ctx.lineTo(W, gy - 40 + par); ctx.lineTo(W, gy + par);
      ctx.fill();
    } else if (look === 'ice') {
      ctx.fillStyle = `rgba(255,255,255,${0.55 - sky.k * 0.35})`;
      ctx.beginPath();
      ctx.moveTo(0, gy + par); ctx.lineTo(W * 0.18, gy - 110 + par); ctx.lineTo(W * 0.36, gy + par);
      ctx.moveTo(W * 0.55, gy + par); ctx.lineTo(W * 0.8, gy - 140 + par); ctx.lineTo(W, gy - 40 + par); ctx.lineTo(W, gy + par);
      ctx.fill();
    } else {
      ctx.fillStyle = '#F2B705';
      ctx.beginPath(); ctx.arc(W * 0.8, H * 0.22 + par * 0.3, 26, 0, Math.PI * 2); ctx.fill();
    }
    // Ground, full width at any zoom.
    ctx.fillStyle = look === 'ice' ? (sky.night ? '#5d7f90' : '#d8ecf5') : (sky.night ? '#1a2440' : '#2b3a55');
    ctx.fillRect(0, gy + camPx * this.zoom, W, H);

    // The world: x in units across WORLD_W centred on the screen, y up from the ground.
    ctx.save();
    ctx.translate(W / 2, gy + camPx * this.zoom);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-W / 2, 0);
    const ox = (W - E.WORLD_W * k) / 2;
    ctx.fillStyle = look === 'ice' ? (sky.night ? '#7fa3b4' : '#bcdcea') : '#3d5070';
    ctx.fillRect(-W, 0, W * 3, 6);
    const slab = (x, y, w, i, a) => {
      const c = slabOf(look, i), px = ox + x * k, pw = w * k, ph = E.BLOCK_H * k, py = y * k;
      ctx.globalAlpha = a == null ? 1 : a;
      ctx.fillStyle = c.face; ctx.fillRect(px, py + ph * 0.2, pw, ph * 0.8);
      ctx.fillStyle = c.top; ctx.fillRect(px, py, pw, ph * 0.2);
      ctx.fillStyle = c.edge; ctx.fillRect(px, py + ph - 3, pw, 3);
      ctx.globalAlpha = 1;
    };
    const stack = this.run ? this.run.stack : [{ x: (E.WORLD_W - E.START_W) / 2, w: E.START_W }];
    const viewTop = -(H / this.zoom) - camPx - 40, viewBot = 40;
    stack.forEach((s, i) => {
      const py = this._yOf(i) * k;
      if (py > viewTop && py < viewBot) slab(s.x, this._yOf(i), s.w, i);
    });
    // Your best at this difficulty, as a dashed line across at its height (play and game over;
    // at game over it is the PREVIOUS best). Matt, 2026-11-02: "so you know when you beat it".
    if (this.run && (this.best | 0) > 0) {
      const ly = this._yOf(this.best) * k;   // the top edge of block #best (a tower of `best`)
      const beat = E.score(this.run) > this.best;
      ctx.save();
      ctx.strokeStyle = beat ? 'rgba(255,206,58,.95)' : 'rgba(255,255,255,.9)';
      ctx.lineWidth = 2 / this.zoom;
      ctx.setLineDash([10 / this.zoom, 7 / this.zoom]);
      ctx.beginPath(); ctx.moveTo(-W, ly); ctx.lineTo(W * 2, ly); ctx.stroke();
      ctx.setLineDash([]);
      const fs = 15 / this.zoom, label = '\u2605 ' + this.best;
      ctx.font = `800 ${fs}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width + 12 / this.zoom;
      const lx = W / 2 + (W / 2 - 8) / this.zoom - tw;
      ctx.fillStyle = beat ? '#ffce3a' : 'rgba(0,0,0,.45)';
      ctx.fillRect(lx, ly - fs - 8 / this.zoom, tw, fs + 8 / this.zoom);
      ctx.fillStyle = beat ? '#16243a' : '#fff';
      ctx.fillText(label, lx + 6 / this.zoom, ly - 6 / this.zoom);
      ctx.restore();
    }
    for (const f of this.fx.flashes) {
      const p = f.t / 0.45, pad = 4 + p * 14;
      ctx.strokeStyle = `rgba(255,255,255,${1 - p})`; ctx.lineWidth = 3;
      ctx.strokeRect(ox + f.x * k - pad, this._yOf(f.i) * k - pad, f.w * k + pad * 2, E.BLOCK_H * k + pad * 2);
    }
    if (this.run && this.run.mover) {
      const m = this.run.mover, i = this.run.stack.length;
      slab(m.x, this._yOf(i), m.w, i);
    }
    for (const f of this.fx.falling) {
      ctx.save();
      ctx.translate(ox + (f.x + f.w / 2) * k, f.y * k + (E.BLOCK_H * k) / 2);
      ctx.rotate(f.rot);
      const c = slabOf(look, f.i);
      ctx.fillStyle = c.face; ctx.fillRect((-f.w / 2) * k, (-E.BLOCK_H / 2) * k, f.w * k, E.BLOCK_H * k);
      ctx.fillStyle = c.top; ctx.fillRect((-f.w / 2) * k, (-E.BLOCK_H / 2) * k, f.w * k, E.BLOCK_H * k * 0.2);
      ctx.restore();
    }
    ctx.restore();
  }

  destroy() {
    this._stop();
    clearTimeout(this._overT);
    try { this.canvas.removeEventListener('pointerdown', this._onDown); } catch { /* gone */ }
    try { this.root.removeEventListener('click', this._onClick); } catch { /* gone */ }
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._offResize) this._offResize();
    if (this._offLang) this._offLang();
    if (this._offTheme) this._offTheme();
    if (this._ro) this._ro.disconnect();
    this.host.innerHTML = '';
  }

  inProgress() { return this.screen === 'play' && !!this.run && !this.run.over; }

  /** Test seam (tools/test-tower.mjs drives the real screen through it). */
  _seam() {
    return { screen: () => this.screen, run: () => this.run, drop: () => this._drop(), play: () => this._play(),
      setLead: (rows) => { this.lead = { at: Date.now() + 1e9, rows }; this._renderTowers(); } };
  }
}

let instance = null;
export function init(container) {
  if (instance) instance.destroy();
  instance = new Tower(container);
  try { if (typeof window !== 'undefined') window.__twTest = instance._seam(); } catch { /* no window */ }
}
export function destroy() {
  if (instance) instance.destroy();
  instance = null;
  try { delete window.__twTest; } catch { /* no window */ }
}
// Literal meaning: a run is live (no resume). See the header.
export function isInProgress() { return !!(instance && instance.inProgress()); }
export default { init, destroy, isInProgress };
