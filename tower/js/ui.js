// tower/js/ui.js — Tower: stack sliding blocks as high as you can. Module entry (init / destroy /
// isInProgress). The rules are in engine.js (pure); this file draws, times and records.
//
// isInProgress(): the LITERAL meaning (no mid-run resume, same class as Snake / Brick Breaker): true
// only while a run is live. Leaving mid-run abandons it and records nothing.
//
// Screens: setup (picture + "?", title + best, Look x3, Difficulty x4, Play, the leader footer),
// play (canvas, score, best, perfect streak, pause button -> Paused card: Resume / Quit), game over (card with an X: score, best, perfects, Again).
// Every finished run is recorded ONCE through recordTower inside withMode({ look }, diff, ..., { hi }).

import * as E from './engine.js';
import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordTower, loadStats, withMode } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { onThemeChange } from '../../js/theme.js';
import * as A from './art.js';
import { LOOKS, slabOf, heroSVG, lookThumb } from './art.js';
import { backStack } from '../../js/back-stack.js';

const t = makeT(STRINGS);
const KEY = 'gamehub.tower.v1';
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
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
    this._onKey = (e) => {
      if (e.key === 'Escape') { if (this.screen === 'play') this._pause(); else if (this.screen === 'paused') this._resume(); return; }
      if (this.screen === 'play' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); this._drop(); }
    };
    // Leaving the app mid-run pauses it (2026-11-12), so the block is not already moving on return.
    this._onVis = () => { if (document.hidden) { this._pause(); this._stop(); } else this._start(); };
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.root.addEventListener('click', this._onClick = (e) => this._click(e));
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('visibilitychange', this._onVis);
    this._offResize = onViewportResize(() => this._layout());
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this._layout()) : null;
    if (this._ro) this._ro.observe(this.root);
    this._offLang = onLangChange(() => { if (this.screen === 'setup') this._renderSetup(); this._renderHelp(); this._renderPause(); this._renderTowers(); });
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
          <button type="button" class="tw-pause" data-act="pause" data-role="pauseBtn">${PAUSE_SVG}</button>
        </div>
        <div class="tw-setup" data-role="setup"></div>
        <div class="tw-ov" data-role="over" hidden></div>
        <div class="tw-ov" data-role="help" hidden></div>
        <div class="tw-ov" data-role="pause" hidden></div>
        <div class="tw-towers" data-role="towers" hidden></div>
      </div>`;
    this.root = this.host.querySelector('.tw-root');
    this.canvas = this.root.querySelector('.tw-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.el = (r) => this.root.querySelector(`[data-role="${r}"]`);
    this.canvas.setAttribute('aria-label', t('aria_board'));
    this._renderHelp();
    this._renderPause();
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
    this._closeTowers();
    this.el('over').hidden = true;
    this.el('pause').hidden = true;
    this.el('setup').hidden = false;
    this._renderSetup();
  }

  _renderSetup() {
    const s = this.s;
    this.root.dataset.look = s.look;   // the HUD's light-ground variants (tower.css)
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

  /** Pause (2026-11-12, Matt: "there's no back button or pause or anything in this game"). */
  _renderPause() {
    this.el('pauseBtn').setAttribute('aria-label', t('pause'));
    this.el('pause').innerHTML = `
      <div class="tw-card">
        <h2 class="tw-ph">${esc(t('paused'))}</h2>
        <div class="tw-btns">
          <button type="button" class="tw-play" data-act="resume">${esc(t('resume'))}</button>
          <button type="button" class="tw-play tw-alt" data-act="quit">${esc(t('quit'))}</button>
        </div>
      </div>`;
  }
  _pause() {
    if (this.screen !== 'play' || !this.run || this.run.over) return;
    this.screen = 'paused';
    this.el('pause').hidden = false;
  }
  _resume() {
    if (this.screen !== 'paused') return;
    this.el('pause').hidden = true;
    this.screen = 'play';
    this.last = performance.now();
  }
  /** Quit from the pause card: a run with blocks stacked is recorded like a finished one (its blocks
   *  were earned); an empty one records nothing. Then the setup screen. */
  _quit() {
    if (this.screen !== 'paused') return;
    const run = this.run;
    if (run && E.score(run) > 0) this._record(run);
    this._showSetup();
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
    else if (act === 'towersClose') { if (this._twBs) this._twBs.back(); else this._closeTowers(); }
    else if (act === 'pause') this._pause();
    else if (act === 'resume') this._resume();
    else if (act === 'quit') this._quit();
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
    this._closeTowers();
    this.el('pause').hidden = true;
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
    // The phone's back swipe and the Back button both close it (js/back-stack.js).
    if (!this._twBs) this._twBs = backStack(() => this._closeTowers());
    this._twBs.sync(1);
    this._renderTowers();
  }
  _closeTowers() {
    const box = this.el('towers');
    if (box) box.hidden = true;
    const bs = this._twBs;
    this._twBs = null;
    if (bs) bs.close();
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
      <div class="tw-tw-head"><h2>${esc(t('records'))}</h2></div>
      <div class="tw-tabs" role="tablist">${tabs}</div>
      <div class="tw-cols">${list.length ? list.map(col).join('') : '<p class="tw-none">-</p>'}</div>
      <div class="tw-twbar">
        <button type="button" class="tw-play tw-alt tw-back" data-act="towersClose">&#8249; ${esc(t('back'))}</button>
        <button type="button" class="tw-lead-all" data-act="fullBoard">${esc(t('leaderboard'))} &#8250;</button>
      </div>`;
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
    const gy = this._groundY();
    const camPx = this.cam * k;
    const groundY = gy + camPx * this.zoom;
    // Sky, scenery (scrolls slower than the tower), ground: tower/js/art.js.
    A.drawBackdrop(ctx, look, W, H, this.dpr, gy + camPx * 0.35, groundY, performance.now() / 1000);

    // The world: x in units across WORLD_W centred on the screen, y up from the ground.
    ctx.save();
    ctx.translate(W / 2, groundY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-W / 2, 0);
    const ox = (W - E.WORLD_W * k) / 2;
    const stack = this.run ? this.run.stack : [{ x: (E.WORLD_W - E.START_W) / 2, w: E.START_W }];
    A.drawShadow(ctx, look, ox + (stack[0].x + stack[0].w / 2) * k, stack[0].w * k);
    const ph = E.BLOCK_H * k;
    const viewTop = -(H / this.zoom) - camPx - 40, viewBot = 40;
    stack.forEach((s, i) => {
      const py = this._yOf(i) * k;
      if (py > viewTop && py < viewBot) A.drawBlock(ctx, look, ox + s.x * k, py, s.w * k, ph, i, k);
    });
    // Your best at this difficulty, as a dashed line across at its height (play and game over;
    // at game over it is the PREVIOUS best). Matt, 2026-11-02: "so you know when you beat it".
    if (this.run && (this.best | 0) > 0) {
      const ly = this._yOf(this.best) * k;   // the top edge of block #best (a tower of `best`)
      const beat = E.score(this.run) > this.best;
      const [lineC, tagC, inkC] = A.bestLineStyle(look);
      ctx.save();
      ctx.strokeStyle = beat ? 'rgba(255,206,58,.95)' : lineC;
      ctx.lineWidth = 2 / this.zoom;
      ctx.setLineDash([10 / this.zoom, 7 / this.zoom]);
      ctx.beginPath(); ctx.moveTo(-W, ly); ctx.lineTo(W * 2, ly); ctx.stroke();
      ctx.setLineDash([]);
      const fs = 16 / this.zoom, label = '★ ' + this.best;
      ctx.font = `800 ${fs}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width + 12 / this.zoom;
      const lx = W / 2 + (W / 2 - 8) / this.zoom - tw;
      ctx.fillStyle = beat ? '#ffce3a' : tagC;
      ctx.fillRect(lx, ly - fs - 8 / this.zoom, tw, fs + 8 / this.zoom);
      ctx.fillStyle = beat ? '#16243a' : inkC;
      ctx.fillText(label, lx + 6 / this.zoom, ly - 6 / this.zoom);
      ctx.restore();
    }
    for (const f of this.fx.flashes) {
      const p = f.t / 0.45, pad = 4 + p * 14;
      ctx.strokeStyle = look === 'space' ? `rgba(54,240,255,${1 - p})` : `rgba(255,255,255,${1 - p})`; ctx.lineWidth = 3;
      ctx.strokeRect(ox + f.x * k - pad, this._yOf(f.i) * k - pad, f.w * k + pad * 2, ph + pad * 2);
    }
    if (this.run && this.run.mover) {
      const m = this.run.mover, i = this.run.stack.length;
      A.drawBlock(ctx, look, ox + m.x * k, this._yOf(i) * k, m.w * k, ph, i, k);
    }
    for (const f of this.fx.falling) {
      ctx.save();
      ctx.translate(ox + (f.x + f.w / 2) * k, f.y * k + ph / 2);
      ctx.rotate(f.rot);
      A.drawBlock(ctx, look, (-f.w / 2) * k, -ph / 2, f.w * k, ph, f.i, k);
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
    if (this._twBs) { try { this._twBs.close(); } catch { /* gone */ } this._twBs = null; }
    this.host.innerHTML = '';
  }

  inProgress() { return (this.screen === 'play' || this.screen === 'paused') && !!this.run && !this.run.over; }

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
