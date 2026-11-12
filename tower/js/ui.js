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
import { recordTower, keepTowerShape, loadStats, withMode } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { onThemeChange } from '../../js/theme.js';
import * as A from './art.js';
import { noteError } from '../../js/error-log.js';
import { LOOKS, slabOf, heroSVG, lookThumb, svgBlock } from './art.js';
import { backStack } from '../../js/back-stack.js';

const t = makeT(STRINGS);
const KEY = 'gamehub.tower.v1';
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
/** A line in the phone's slow-step report (`gamehub.perf.v1`, the format js/firebase-boot.js writes; mirrored as
 *  players/<id>/perf by stats-net.js). A REPORT: nothing reads it back. Never throws. */
function notePerf(p, ms) {
  try {
    const list = JSON.parse(localStorage.getItem('gamehub.perf.v1') || '[]');
    const l = Array.isArray(list) ? list : [];
    l.push({ t: Date.now(), ms: Math.round(ms), p: String(p).slice(0, 79), ok: 0, back: -1 });
    localStorage.setItem('gamehub.perf.v1', JSON.stringify(l.slice(-30)));
  } catch { /* a report only */ }
}
const medal = (rank) => (rank >= 1 && rank <= 3 ? ['&#129351;', '&#129352;', '&#129353;'][rank - 1] + ' ' : '');   // by RANK: a tie shares it
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
      // Keys typed into anything else (the hub's bug report, a search box) are not the game's (2026-11-12 review:
      // typing a bug report during a run dropped blocks).
      const tg = e.target;
      if (tg && tg.closest && (tg.closest('input, textarea, select, [contenteditable]') || (tg !== document.body && !this.root.contains(tg)))) return;
      if (document.querySelector('.lb2, .lb-overlay')) return;   // a Leaderboard opened from Record towers owns Esc
      if (e.key === 'Escape') {
        if (this._twBs) this._twBs.back();
        else if (!this.el('help').hidden) this.el('help').hidden = true;
        else if (this.screen === 'play') this._pause();
        else if (this.screen === 'paused') this._resume();
        return;
      }
      if (this.screen === 'play' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); this._drop(); }
    };
    // Leaving the app mid-run pauses it (2026-11-12), so the block is not already moving on return.
    this._onVis = () => { if (document.hidden) { this._pause(); this._stop(); } else this._start(); };
    // The loop runs only while the canvas is what the player sees (play, game over), never behind the setup screen,
    // the pause card or Record towers (2026-11-12 review: battery and heat on iPhone). _start() checks _wantLoop().
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
    if (this._dead) return;
    if (!W || !H) { if (!this._layoutQ) this._layoutQ = requestAnimationFrame(() => { this._layoutQ = 0; this._layout(); }); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.W = W; this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * this.dpr); this.canvas.height = Math.round(H * this.dpr);
    // World units -> CSS px. Narrow screens fill the width; wide ones cap so the tower is not huge.
    this.k = Math.min(W / E.WORLD_W, (H * 0.62) / E.WORLD_W * 1.3);
    if (this.screen === 'over') this._fitOver();
    // A phone turned sideways is covered by the hub's "turn your phone upright" screen (css/hub.css .gh-rotate): pause.
    // (The hub also calls onCovered(); this covers the standalone page.)
    try { if (window.matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)').matches) this._pause(); } catch { /* old browser */ }
    this._draw();
    if (this._twBs) this._renderTowers();   // Record towers re-fits too
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
    this._stop();
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
    // The same ranking as Record towers (best, then the better average; only equal on both is a tie).
    const ranked = this._towerList(this.s.diff);
    const top = ranked.length ? ranked[0].best : 0;
    const lead = ranked.filter((r) => r.rank === 1);
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
          return { me, name: me ? (p.name || g.name || '') : g.name, emoji: me ? (p.emoji || g.emoji || '') : g.emoji, by: tw.bestByDiff || {}, shapes: tw.shapes || {}, gm: (g.games || {}).tower || null };
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
    this._stop();
    this._draw();
  }
  /** The hub's "Leave?" dialog or bug sheet covers the game (js/hub.js _coverGame): stop the block under it. */
  onCovered() { this._pause(); }
  _resume() {
    if (this.screen !== 'paused') return;
    this.el('pause').hidden = true;
    this.screen = 'play';
    this._start();
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
    else if (act === 'twPick') { this.twPick = Number(b.dataset.i) | 0; this._renderTowers(); }
    else if (act === 'twPrev' || act === 'twNext') {
      const n = (this._twList || []).length;
      if (n && this.twPick != null) { this.twPick = (this.twPick + (act === 'twNext' ? 1 : n - 1)) % n; this._renderTowers(); }
    }
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
    this._start();
  }

  _tap(e) {
    if (this.screen !== 'play') return;
    e.preventDefault();
    // Drop where the block IS at the tap, not where the last frame drew it (2026-11-12 review: at Expert speed a
    // frame is ~24 units against 3.5 of Perfect slack, so a 120 Hz phone had an edge). The loop carries on from here.
    const now = performance.now();
    if (this.run && !this.run.over && this.last && now > this.last) {
      E.stepMover(this.run, Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
    }
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
    const saved = this._record(run);
    const isNew = saved && sc > before && sc > 0;   // never "Best" for a run the store refused
    this.camTarget = 0;
    this._overBefore = before;
    this._fitOver();
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

  /** Game over: zoom out to show the whole tower AND the best line above the card (the ground lifts over it).
   *  Re-run on resize. Never a zero or negative zoom (a short landscape screen). */
  _fitOver() {
    const run = this.run;
    if (!run) return;
    this.liftTarget = Math.max(0, Math.min(this.H * 0.3, 210));
    const room = Math.max(60, this.H - Math.max(90, this.H * 0.13) - this.liftTarget - 110);
    const tall = (Math.max(run.stack.length, (this._overBefore | 0) + 1) + 1) * E.BLOCK_H * this.k;
    this.zoomTarget = Math.max(0.02, Math.min(1, room / Math.max(1, tall)));
  }

  // --- Record towers v2 (Matt, 2026-11-12: "I want the actual towers shown. Same as how I see my tower after
  // a round"; docs/mockups/tower/record-towers-v2.html). A: everyone's best tower at this difficulty, its real
  // shape, ONE scale, scrolling sideways. B: one tower tapped, drawn like the game (its own look), with ‹ ›.
  // A best set before shapes were kept (2026-11-12) has none: it is drawn as a straight stack of its height.
  _showTowers() {
    this.towersDiff = this.screen === 'over' && this.run ? this.run.diff : this.s.diff;
    this.twPick = null;
    if (!this.lead || Date.now() - this.lead.at > 60000) this._loadLead();
    this.el('towers').hidden = false;
    this._twScroll = null;
    this._stop();
    // The phone's back swipe and the Back button step back one screen (B -> A -> closed), js/back-stack.js.
    if (!this._twBs) this._twBs = backStack((n) => this._twStepBack(n));
    this._renderTowers();
  }
  _twStepBack(n) {
    if (this.twPick != null && n > 0) { this.twPick = null; n -= 1; }
    if (n > 0) this._closeTowers(); else this._renderTowers();
  }
  _closeTowers() {
    const box = this.el('towers');
    if (box) box.hidden = true;
    this.twPick = null;
    const bs = this._twBs;
    this._twBs = null;
    if (bs) bs.close();
    this._start();
  }
  /** Everyone with a best at difficulty d, tallest first: { me, name, emoji, best, stack, look, at, rank }. A tie on
   *  the best goes to the better AVERAGE at that difficulty (byMode hs/hn), else the all-time average (tw.blocks/games);
   *  equal on both = tied, same rank and medal (root CLAUDE.md, "Every leaderboard tie"). */
  _towerList(d) {
    const decode = (sv, best) => {
      if (!sv || typeof sv !== 'object' || (sv.n | 0) !== best || typeof sv.s !== 'string') return null;
      const st = sv.s.split(';').map((p) => { const [x, w] = p.split(',').map(Number); return { x, w }; });
      return st.length === best + 1 && st.every((q) => Number.isFinite(q.x) && Number.isFinite(q.w) && q.w >= 0) ? st : null;
    };
    // The same two averages, in the same order, as the Leaderboard's tie-break (leaderboard-ui.js cmpAvgGame).
    const avgAt = (gm) => {
      let s = 0, n = 0;
      for (const b of Object.values((gm && gm.byMode) || {})) { const x = b && b[d]; if (x && x.hn > 0) { s += +x.hs || 0; n += +x.hn || 0; } }
      return n > 0 ? s / n : null;
    };
    const avgAll = (gm) => { const tw = (gm && gm.tw) || {}; return tw.games > 0 ? (tw.blocks | 0) / tw.games : null; };
    const rows = ((this.lead && this.lead.rows) || []).map((r) => ({ ...r, best: r.by[d] | 0, sv: (r.shapes || {})[d] }));
    const ownRec = towerRec();
    const own = ((ownRec || {}).tw) || {};
    const mine = (own.bestByDiff || {})[d] | 0, myShape = (own.shapes || {})[d];
    let meRow = rows.find((r) => r.me);
    if (!meRow && mine > 0) {
      let p = {};
      try { p = loadProfile() || {}; } catch { p = {}; }
      meRow = { me: true, name: p.name || '', emoji: p.emoji || '', best: 0, sv: null };
      rows.push(meRow);
    }
    if (meRow && mine >= meRow.best) { meRow.best = mine; if (myShape) meRow.sv = myShape; meRow.gm = ownRec; }
    for (const r of rows) { r.avgD = avgAt(r.gm); r.avgA = avgAll(r.gm); }
    const cmp = (a, b) => {
      if (b.best !== a.best) return b.best - a.best;
      if (a.avgD != null && b.avgD != null) return b.avgD - a.avgD;
      return a.avgA == null || b.avgA == null ? 0 : b.avgA - a.avgA;
    };
    const list = rows.filter((r) => r.best > 0).sort(cmp);
    list.forEach((r, i) => { r.rank = i && cmp(list[i - 1], r) === 0 ? list[i - 1].rank : i + 1; });
    return list.map((r) => {
      const stack = decode(r.sv, r.best);
      return { me: r.me, name: r.name, emoji: r.emoji, best: r.best, rank: r.rank,
        stack: stack || Array.from({ length: r.best + 1 }, () => ({ x: (E.WORLD_W - E.START_W) / 2, w: E.START_W })),
        look: stack && LOOKS.indexOf(r.sv.l) >= 0 ? r.sv.l : this.s.look, at: stack ? Number(r.sv.t) || 0 : 0 };
    });
  }
  _renderTowers() {
    const box = this.el('towers');
    if (!box || box.hidden) return;
    const d = this.towersDiff;
    const list = this._towerList(d);
    this._twList = list;
    if (this.twPick != null && !list[this.twPick]) this.twPick = null;
    const oldPick = box.querySelector('.tw-pick-c');
    if (oldPick) { oldPick.width = 0; oldPick.height = 0; }   // iPhone: give its memory back at once
    const bar = `
      <div class="tw-twbar">
        <button type="button" class="tw-play tw-alt tw-back" data-act="towersClose">&#8249; ${esc(t('back'))}</button>
        <button type="button" class="tw-lead-all" data-act="fullBoard">${esc(t('leaderboard'))} &#8250;</button>
      </div>`;
    if (this.twPick != null) {
      const r = list[this.twPick];
      let when = '';
      if (r.at) { try { when = ' &middot; ' + esc(new Date(r.at).toLocaleDateString(document.documentElement.lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' })); } catch { when = ''; } }
      box.classList.add('is-pick');
      box.innerHTML = `
        <div class="tw-pick">
          <canvas class="tw-pick-c" aria-hidden="true"></canvas>
          <div class="tw-pick-n">${r.best}</div>
          <div class="tw-pick-who">${medal(r.rank)}${esc(r.emoji)} ${esc(r.name || t('anon_player'))}<small>${esc(t('diff_' + d))}${when}</small></div>
          ${list.length > 1 ? `<button type="button" class="tw-arrow is-l" data-act="twPrev" aria-label="${esc(t('aria_prev'))}">&#8249;</button>
          <button type="button" class="tw-arrow is-r" data-act="twNext" aria-label="${esc(t('aria_next'))}">&#8250;</button>` : ''}
          ${bar}
        </div>`;
      this._drawPick(r);
    } else {
      box.classList.remove('is-pick');
      const tabs = E.DIFFS.map((k) => `
        <button type="button" class="tw-tab${k === d ? ' is-sel' : ''}" data-act="twDiff" data-v="${k}" role="tab" aria-selected="${k === d}">${diffShapeSVG(tierOf(k))}<b>${t('diff_' + k)}</b></button>`).join('');
      box.innerHTML = `
        <div class="tw-tw-head"><h2>${esc(t('records'))}</h2></div>
        <div class="tw-tabs" role="tablist">${tabs}</div>
        <div class="tw-scene">${list.length ? '' : '<p class="tw-none">-</p>'}</div>
        ${bar}`;
      if (list.length) this._drawScene(box.querySelector('.tw-scene'), list);
    }
    if (this._twBs) this._twBs.sync(this.twPick != null ? 2 : 1);
  }
  /** A: the towers side by side on one ground, one scale (true heights AND widths), as SVG. */
  _drawScene(sc, list) {
    const W = Math.max(1, sc.clientWidth), H = Math.max(1, sc.clientHeight);
    const gy = H - 74;
    const top = list.reduce((m, r) => Math.max(m, r.best), 0);
    const k = Math.max(0.0005, Math.min(0.42, (gy - 44) / ((top + 1) * E.BLOCK_H)));
    const slot = Math.max(84, E.START_W * k + 14);
    const SW = Math.max(W, slot * list.length);
    const bh = E.BLOCK_H * k;
    let stars = '';
    for (let i = 0; i < 60; i++) stars += `<rect x="${((i * 97.3) % SW).toFixed(0)}" y="${((i * 53.7) % (gy * 0.8)).toFixed(0)}" width="2" height="2" fill="#fff" opacity=".6"/>`;
    let out = `<svg width="${SW}" height="${H}" viewBox="0 0 ${SW} ${H}" aria-hidden="true">
      <defs><linearGradient id="tw-rt-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1030"/><stop offset="1" stop-color="#2a2e62"/></linearGradient></defs>
      <rect width="${SW}" height="${H}" fill="url(#tw-rt-sky)"/>${stars}
      <rect y="${gy}" width="${SW}" height="${H - gy}" fill="#1a2440"/><rect y="${gy}" width="${SW}" height="5" fill="#3d5070"/>`;
    const maxCh = Math.max(5, Math.floor(slot / 9));
    list.forEach((r, i) => {
      const cx = slot * i + slot / 2, base = (E.WORLD_W - E.START_W) / 2;
      r.stack.forEach((b, j) => {
        const x = cx + (b.x - base - E.START_W / 2) * k, y = gy - (j + 1) * bh, w = b.w * k;
        if (bh >= 6) out += svgBlock(r.look, x, y, w, bh, j, k * 2);
        else { const c = slabOf(r.look, j); out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(bh + 0.3).toFixed(2)}" fill="${c.face}"/>`; }
      });
      const ty = gy - (r.best + 1) * bh - 9;
      out += `<text x="${cx}" y="${ty.toFixed(0)}" text-anchor="middle" font-size="20" font-weight="800" fill="${r.me ? '#ffce3a' : '#f2f6fc'}">${r.best}</text>`;
      const nm = Array.from(String(r.name || t('anon_player')));   // whole characters: never half an emoji
      const name = nm.length > maxCh ? nm.slice(0, maxCh - 1).join('') + '…' : nm.join('');
      if (r.me) out += `<rect x="${slot * i + 5}" y="${gy + 9}" width="${slot - 10}" height="58" rx="10" fill="none" stroke="#ffce3a" stroke-width="2.5"/>`;
      out += `<text x="${cx}" y="${gy + 32}" text-anchor="middle" font-size="17">${medal(r.rank)}${esc(r.emoji)}</text>`;
      out += `<text x="${cx}" y="${gy + 56}" text-anchor="middle" font-size="15" font-weight="700" fill="#f2f6fc">${esc(name)}</text>`;
      out += `<rect data-act="twPick" data-i="${i}" x="${slot * i}" y="0" width="${slot}" height="${H}" fill="transparent" style="cursor:pointer"/>`;
    });
    sc.innerHTML = out + '</svg>';
    sc.addEventListener('scroll', () => { this._twScroll = { d: this.towersDiff, x: sc.scrollLeft }; }, { passive: true });
    // A repaint (the board arriving, a resize) keeps where the player scrolled; a new tab starts on their own tower.
    if (this._twScroll && this._twScroll.d === this.towersDiff) sc.scrollLeft = this._twScroll.x;
    else {
      const me = list.findIndex((r) => r.me);
      if (me >= 0 && SW > W) sc.scrollLeft = Math.max(0, slot * me + slot / 2 - W / 2);
    }
  }
  /** B: one tower, drawn exactly like the game draws it (tower/js/art.js), on its own look's scene. */
  _drawPick(r) {
    const box = this.el('towers'), cv = box.querySelector('.tw-pick-c');
    if (!cv) return;
    const W = Math.max(1, box.clientWidth), H = Math.max(1, box.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const who = box.querySelector('.tw-pick-who');
    const topY = who ? who.getBoundingClientRect().bottom - box.getBoundingClientRect().top + 24 : 220;
    const groundY = H - Math.max(110, H * 0.14);
    const k = Math.max(0.0005, Math.min(W / E.WORLD_W * 0.95, (groundY - topY) / ((r.best + 1) * E.BLOCK_H)));
    const ox = (W - E.WORLD_W * k) / 2, bh = E.BLOCK_H * k;
    A.drawBackdrop(ctx, r.look, W, H, dpr, groundY, groundY, 0);
    ctx.save(); ctx.translate(0, groundY);
    A.drawShadow(ctx, r.look, ox + (r.stack[0].x + r.stack[0].w / 2) * k, r.stack[0].w * k);
    ctx.restore();
    r.stack.forEach((b, j) => A.drawBlock(ctx, r.look, ox + b.x * k, groundY - (j + 1) * bh, b.w * k, bh, j, k));
  }

  /** Once per run. withMode carries the LOOK and the DIFFICULTY (root CLAUDE.md, "Every result records
   *  its MODE") and the height as that mode's best. */
  _record(run) {
    if (this.recorded) return this.saved === true;
    this.recorded = true;
    this.saved = false;
    const d = run.diff;
    try {
      const st = withMode(() => ({ look: this.s.look }), d,
        () => recordTower(E.score(run), d, { perfects: run.perfects, bestStreak: run.bestStreak }),
        () => ({ hi: E.score(run) }));
      if (!st) console.warn('[tower] result not recorded (rate gate or store refused it)');
      else { this.saved = true; keepTowerShape(d, E.score(run), run.stack, this.s.look); }   // only a best's shape is kept
    } catch (err) { console.error('[tower] recording the result failed', err); }
    return this.saved;
  }

  // --- loop + drawing ------------------------------------------------------------------------------
  _wantLoop() {
    const tw = this.el && this.el('towers');
    return !this._dead && !document.hidden && (this.screen === 'play' || this.screen === 'over') && !(tw && !tw.hidden);
  }
  _start() {
    if (this.raf || !this._wantLoop()) return;
    this.last = performance.now();
    // The next frame is asked for FIRST, and a frame that throws is caught (2026-11-12, Matt's iPhone froze on a
    // half-drawn frame mid-run): one bad frame can never stop the game again. A throw or a stall on a visible
    // screen is written to the phone's slow-step report (`notePerf`), so the cause can be read back.
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const gap = now - this.last;
      if (gap > 1500 && (this.screen === 'play' || this.screen === 'over') && !document.hidden) notePerf('tower:stall:' + this.s.look, gap);
      const dt = Math.max(0, Math.min(0.05, gap / 1000));   // a tap can step the clock past this frame's stamp
      this.last = now;
      try { this._step(dt); this._draw(); } catch (err) { this._drawFailed(err); }
      // Game over: once the zoom, the lift and every falling piece have settled the picture no longer changes, so stop
      // (battery). Ice keeps drawing for its snow. Resize, theme and Record towers' close redraw it.
      if (this.screen === 'over' && this.s.look !== 'ice' && !this.fx.falling.length && !this.fx.flashes.length
        && Math.abs(this.zoom - this.zoomTarget) < 1e-3 && Math.abs(this.lift - this.liftTarget) < 0.5 && Math.abs(this.cam - this.camTarget) < 0.5) this._stop();
    };
    this.raf = requestAnimationFrame(loop);
  }
  _stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  _drawFailed(err) {
    try { this.ctx.restore(); this.ctx.restore(); } catch { /* unbalanced save is fine */ }
    this._drawErrs = (this._drawErrs | 0) + 1;
    if (this._drawErrs > 3) return;   // note the first few only
    console.error('[tower] a frame failed to draw', err);
    const msg = String((err && err.message) || err).slice(0, 50);
    notePerf('tower:draw:' + this.s.look + ':' + msg, 0);
    noteError('tower-draw', { msg: String((err && err.message) || err), stack: err && err.stack });
  }

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
    // Leaving through the hub (Hub button, back gesture) keeps the blocks stacked, exactly like Pause > Quit
    // (2026-11-12 review: the two exits differed). Once only (`recorded`).
    try { if (this.run && !this.run.over && !this.recorded && E.score(this.run) > 0) this._record(this.run); } catch (err) { console.error('[tower] run on leave not recorded', err); }
    this._dead = true;
    if (this._layoutQ) { cancelAnimationFrame(this._layoutQ); this._layoutQ = 0; }
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
    try { const pc = this.root.querySelector('.tw-pick-c'); if (pc) { pc.width = 0; pc.height = 0; } } catch { /* gone */ }
    try { this.canvas.width = 0; this.canvas.height = 0; } catch { /* gone */ }
    A.releaseArt();
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
/** The hub's "Leave?" dialog or bug sheet covers the game (js/hub.js _coverGame): pause the run under it. */
export function onCovered() { if (instance) instance.onCovered(); }
export default { init, destroy, isInProgress, onCovered };
