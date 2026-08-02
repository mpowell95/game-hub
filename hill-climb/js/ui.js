// hill-climb/js/ui.js — Hill Climb's DOM shell and the hub module contract.
//
// Two screens, both mounted into the one container the hub hands us:
//   GARAGE  the between-runs menu: coin balance, a live preview of the selected car, and the five
//           bottom tabs (Shop, Stage, Vehicle, Tune, Start) from the brief.
//   PLAY    a full-bleed canvas (render.js) with a fixed DOM HUD over it: fuel gauge, coin and
//           distance readouts, the distance ruler, pause, the two pedal buttons and the RPM/Boost
//           dials with the nitro canister.
//
// This file owns the clock and every listener. The rules live in physics.js, the hill in
// terrain.js, the money in catalog.js/store.js, the pixels in render.js. Nothing below computes
// physics, and nothing in those modules touches the DOM.
//
// isInProgress(): the LITERAL meaning (root CLAUDE.md, "The module contract"), the same class as
// Ball Run and Snake. A run is live action with no mid-run resume, so leaving genuinely abandons
// it and the hub should confirm. The garage itself is never "in progress": everything there is
// already saved to localStorage the instant it changes.

import { Run, RunState, EndReason, DT, MAX_STEPS, NITRO_MAX } from './physics.js';
import { makeTerrain } from './terrain.js';
import { Renderer } from './render.js';
import {
  VEHICLES, STAGES, PARTS, MAX_LEVEL, upgradeCost, tunedSpec,
  vehicleById, stageById, stageDiff,
} from './catalog.js';
import * as store from './store.js';
import STRINGS from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';
import { onViewportResize } from '../../js/viewport.js';
import { recordHillClimb } from '../../js/game-stats.js';
import { syncMyStats } from '../../js/stats-net.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);

let instance = null;

/** Inject the stylesheet once, resolved relative to this module so it works standalone and
 *  in-hub alike (root CLAUDE.md, "Adding a game" item 2). */
function ensureCSS() {
  const href = new URL('../css/hill-climb.css', import.meta.url).href;
  if (document.querySelector(`link[data-hc-css]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-hc-css', '1');
  document.head.appendChild(link);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (n) => (n | 0).toLocaleString();

// --- small inline icons (flat, thick-outlined, matching the world art) --------------------------
const ICON_COIN = `<svg viewBox="0 0 24 24" class="hc-ico" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#e0a007" stroke="#231f1c" stroke-width="2"/><circle cx="12" cy="12" r="6" fill="#F2B705"/></svg>`;
const ICON_FUEL = `<svg viewBox="0 0 24 24" class="hc-ico" aria-hidden="true"><rect x="4" y="6" width="14" height="15" rx="2.5" fill="#E0532F" stroke="#231f1c" stroke-width="2"/><rect x="9" y="3" width="5" height="4" rx="1" fill="#b53a1c" stroke="#231f1c" stroke-width="2"/><path d="M18 10h2.5v6" fill="none" stroke="#231f1c" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICON_NITRO = `<svg viewBox="0 0 24 24" class="hc-ico" aria-hidden="true"><rect x="7" y="4" width="10" height="17" rx="5" fill="#1F5FA8" stroke="#231f1c" stroke-width="2"/><rect x="10" y="1.5" width="4" height="3.5" rx="1" fill="#123c6c" stroke="#231f1c" stroke-width="1.6"/></svg>`;
const ICON_LOCK = `<svg viewBox="0 0 24 24" class="hc-ico" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2.5" fill="#8b8f96" stroke="#231f1c" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#231f1c" stroke-width="2"/></svg>`;
const TAB_ICONS = {
  shop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="18" height="12" rx="2" fill="#E0532F" stroke="#231f1c" stroke-width="2"/><rect x="2" y="6" width="20" height="4" rx="1.4" fill="#F2B705" stroke="#231f1c" stroke-width="2"/><path d="M12 6v15" stroke="#231f1c" stroke-width="2"/></svg>`,
  stage: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#1F5FA8" stroke="#231f1c" stroke-width="2"/><path d="M3.5 10h17M5 16h14M12 3.2c3 3.5 3 14.1 0 17.6M12 3.2c-3 3.5-3 14.1 0 17.6" fill="none" stroke="#231f1c" stroke-width="1.6"/></svg>`,
  vehicle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15v-3l3-4h9l3 4h3v3z" fill="#d8382b" stroke="#231f1c" stroke-width="2" stroke-linejoin="round"/><circle cx="7.5" cy="17" r="2.6" fill="#2b2b30" stroke="#231f1c" stroke-width="2"/><circle cx="17" cy="17" r="2.6" fill="#2b2b30" stroke="#231f1c" stroke-width="2"/></svg>`,
  tune: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 5.5a4.6 4.6 0 0 1-6.1 5.9L6 19.2 4 17.2l7.8-7.9A4.6 4.6 0 0 1 17.7 3l-2.8 2.8 1.6 1.6z" fill="#8b8f96" stroke="#231f1c" stroke-width="2" stroke-linejoin="round"/></svg>`,
  start: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5 20 12 7 19.5z" fill="#fff" stroke="#231f1c" stroke-width="2" stroke-linejoin="round"/></svg>`,
};

const VEH_NOTE = { jeep: 'veh_jeep_note', bike: 'veh_bike_note', truck: 'veh_truck_note', rover: 'veh_rover_note' };
const STAGE_NOTE = {
  countryside: 'stage_countryside_note', desert: 'stage_desert_note',
  arctic: 'stage_arctic_note', moon: 'stage_moon_note',
};
const PART_NOTE = {
  engine: 'part_engine_note', suspension: 'part_suspension_note',
  tires: 'part_tires_note', drive: 'part_drive_note',
};

class HillClimb {
  constructor(container) {
    this.root = container;
    this.save = store.load();
    this.tab = 'vehicle';
    this.screen = 'garage';
    this.run = null;
    this.renderer = null;
    this.raf = 0;
    this.lastT = 0;
    this.acc = 0;
    this.paused = false;
    this.keys = { gas: false, brake: false };
    this.pointers = new Map();     // pointerId -> 'gas' | 'brake'
    this.showHelp = false;
    this.result = null;
    this._previewRaf = 0;
    this._previewRO = null;
    this._previewWatched = null;

    this._onKeyDown = (e) => this.onKey(e, true);
    this._onKeyUp = (e) => this.onKey(e, false);
    this._onResize = () => { if (this.renderer) this.renderer.resize(); this.drawPreview(); };
    this._onVis = () => { if (document.visibilityState === 'hidden' && this.screen === 'play') this.setPaused(true); };
    this._onPointerUp = (e) => this.releasePointer(e.pointerId);
    this._offLang = onLangChange(() => this.rerender());

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    // Coalesced to one callback per frame by js/viewport.js. A raw resize listener re-fits the
    // canvas several times per frame while a mobile URL bar animates, which is scroll jank - see
    // that module's header and js/CLAUDE.md's "Overlay scrolling" section.
    this._offViewport = onViewportResize(this._onResize);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    document.addEventListener('visibilitychange', this._onVis);

    this.root.classList.add('hc-root');
    this.rerender();
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  persist() { store.save(this.save); }

  rerender() {
    if (this.screen === 'garage') this.renderGarage();
    else this.renderPlay();
  }

  // --- garage ------------------------------------------------------------------------------

  renderGarage() {
    const s = this.save;
    const veh = vehicleById(s.vehicle);
    const stage = stageById(s.stage);
    this.root.innerHTML = `
      <div class="hc-garage">
        <div class="hc-gtop">
          <div class="hc-wallet" aria-label="${esc(t('aria_coins'))}">
            ${ICON_COIN}<b>${fmt(s.coins)}</b>
          </div>
          <h2 class="hc-gtitle">${esc(t('title'))}</h2>
          <button type="button" class="hc-help-btn" data-act="help">?</button>
        </div>

        <div class="hc-panel">
          <canvas class="hc-preview" aria-hidden="true"></canvas>
          <div class="hc-panel-cap">
            <span class="hc-vname">${esc(t(veh.nameKey))}</span>
            <span class="hc-sname">${diffShapeSVG(tierOf(stage.diff))} ${esc(t(stage.nameKey))}</span>
          </div>
          <div class="hc-panel-best">
            ${esc(t('best_here', { stage: t(stage.nameKey) }))}: <b>${fmt(s.best[stage.id] | 0)}</b> ${esc(t('unit_m'))}
          </div>
        </div>

        <div class="hc-body">${this.tabBodyHTML()}</div>

        <nav class="hc-tabs">
          ${this.tabBtn('shop', 'tab_shop')}
          ${this.tabBtn('stage', 'tab_stage')}
          ${this.tabBtn('vehicle', 'tab_vehicle')}
          ${this.tabBtn('tune', 'tab_tune')}
          <button type="button" class="hc-tab hc-tab-start" data-act="start">
            <span class="hc-tab-ico">${TAB_ICONS.start}</span>
            <span class="hc-tab-label">${esc(t('tab_start'))}</span>
          </button>
        </nav>
      </div>
      ${this.showHelp ? this.helpHTML() : ''}`;

    this.bindGarage();
    this.drawPreview();
  }

  tabBtn(id, labelKey) {
    const on = this.tab === id;
    return `<button type="button" class="hc-tab${on ? ' is-on' : ''}" data-tab="${id}" aria-pressed="${on}">
      <span class="hc-tab-ico">${TAB_ICONS[id]}</span>
      <span class="hc-tab-label">${esc(t(labelKey))}</span>
    </button>`;
  }

  tabBodyHTML() {
    if (this.tab === 'stage') return this.stageListHTML();
    if (this.tab === 'tune') return this.tuneHTML();
    if (this.tab === 'shop') return this.shopHTML();
    return this.vehicleListHTML();
  }

  vehicleListHTML() {
    const s = this.save;
    return `<div class="hc-cards">${VEHICLES.map((v) => {
      const owned = !!s.owned[v.id];
      const on = s.vehicle === v.id;
      const afford = (s.coins | 0) >= v.price;
      return `<div class="hc-card${on ? ' is-on' : ''}${owned ? '' : ' is-locked'}">
        <div class="hc-card-h">${esc(t(v.nameKey))}</div>
        <div class="hc-card-note">${esc(t(VEH_NOTE[v.id]))}</div>
        <div class="hc-card-foot">
          ${owned
            ? `<button type="button" class="hc-btn${on ? ' is-on' : ''}" data-select-veh="${v.id}"${on ? ' disabled' : ''}>${esc(t(on ? 'selected' : 'select'))}</button>`
            : `<button type="button" class="hc-btn hc-buy" data-buy-veh="${v.id}"${afford ? '' : ' disabled'}>${ICON_LOCK}${ICON_COIN}<b>${fmt(v.price)}</b></button>`}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  stageListHTML() {
    const s = this.save;
    return `<div class="hc-cards">${STAGES.map((st) => {
      const owned = !!s.stages[st.id];
      const on = s.stage === st.id;
      const afford = (s.coins | 0) >= st.price;
      return `<div class="hc-card${on ? ' is-on' : ''}${owned ? '' : ' is-locked'}">
        <div class="hc-card-h">${diffShapeSVG(tierOf(st.diff))} ${esc(t(st.nameKey))}</div>
        <div class="hc-card-note">${esc(t(STAGE_NOTE[st.id]))}</div>
        <div class="hc-card-sub">${esc(t('r_best'))}: <b>${fmt(s.best[st.id] | 0)}</b> ${esc(t('unit_m'))}</div>
        <div class="hc-card-foot">
          ${owned
            ? `<button type="button" class="hc-btn${on ? ' is-on' : ''}" data-select-stage="${st.id}"${on ? ' disabled' : ''}>${esc(t(on ? 'selected' : 'select'))}</button>`
            : `<button type="button" class="hc-btn hc-buy" data-buy-stage="${st.id}"${afford ? '' : ' disabled'}>${ICON_LOCK}${ICON_COIN}<b>${fmt(st.price)}</b></button>`}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  tuneHTML() {
    const s = this.save;
    const veh = vehicleById(s.vehicle);
    const ups = s.upgrades[veh.id] || {};
    return `<p class="hc-intro">${esc(t('tune_intro', { vehicle: t(veh.nameKey) }))}</p>
      <div class="hc-tunes">${PARTS.map((p) => {
        const lvl = ups[p] | 0;
        const cost = upgradeCost(p, lvl);
        const afford = cost != null && (s.coins | 0) >= cost;
        const pips = Array.from({ length: MAX_LEVEL }, (_, i) =>
          `<i class="hc-pip${i < lvl ? ' is-on' : ''}"></i>`).join('');
        return `<div class="hc-tune">
          <div class="hc-tune-l">
            <div class="hc-tune-h">${esc(t(`part_${p}`))}</div>
            <div class="hc-tune-note">${esc(t(PART_NOTE[p]))}</div>
            <div class="hc-pips" role="img" aria-label="${esc(t('level_of', { n: lvl, max: MAX_LEVEL }))}">${pips}</div>
          </div>
          ${cost == null
            ? `<span class="hc-maxed">${esc(t('maxed'))}</span>`
            : `<button type="button" class="hc-btn hc-buy" data-buy-part="${p}"${afford ? '' : ' disabled'}>${ICON_COIN}<b>${fmt(cost)}</b></button>`}
        </div>`;
      }).join('')}</div>`;
  }

  shopHTML() {
    const s = this.save;
    const vehRows = VEHICLES.filter((v) => !s.owned[v.id]);
    const stRows = STAGES.filter((st) => !s.stages[st.id]);
    if (!vehRows.length && !stRows.length) {
      return `<p class="hc-intro">${esc(t('shop_intro'))}</p>
        <p class="hc-intro"><b>${esc(t('maxed'))}</b></p>`;
    }
    const row = (label, price, attr) => {
      const afford = (s.coins | 0) >= price;
      return `<div class="hc-shoprow">
        <span class="hc-shopname">${label}</span>
        <button type="button" class="hc-btn hc-buy" ${attr}${afford ? '' : ' disabled'}>${ICON_COIN}<b>${fmt(price)}</b></button>
      </div>`;
    };
    return `<p class="hc-intro">${esc(t('shop_intro'))}</p>
      ${vehRows.length ? `<h4 class="hc-shoph">${esc(t('shop_vehicles'))}</h4>
        ${vehRows.map((v) => row(esc(t(v.nameKey)), v.price, `data-buy-veh="${v.id}"`)).join('')}` : ''}
      ${stRows.length ? `<h4 class="hc-shoph">${esc(t('shop_stages'))}</h4>
        ${stRows.map((st) => row(esc(t(st.nameKey)), st.price, `data-buy-stage="${st.id}"`)).join('')}` : ''}`;
  }

  helpHTML() {
    return `<div class="hc-modal" role="dialog" aria-modal="true" aria-label="${esc(t('how_title'))}">
      <div class="hc-modal-card">
        <button type="button" class="hc-x" data-act="help-close" aria-label="${esc(t('aria_close'))}">&times;</button>
        <h3>${esc(t('how_title'))}</h3>
        <ol class="hc-how">
          <li>${esc(t('how_1'))}</li>
          <li>${esc(t('how_2'))}</li>
          <li>${esc(t('how_3'))}</li>
          <li>${esc(t('how_4'))}</li>
        </ol>
        <button type="button" class="hc-btn hc-primary" data-act="help-close">${esc(t('how_close'))}</button>
      </div>
    </div>`;
  }

  bindGarage() {
    const on = (sel, fn) => this.root.querySelectorAll(sel).forEach((el) => el.addEventListener('click', fn));
    on('[data-tab]', (e) => { this.tab = e.currentTarget.dataset.tab; this.renderGarage(); });
    on('[data-act="start"]', () => this.startRun());
    on('[data-act="help"]', () => { this.showHelp = true; this.renderGarage(); });
    on('[data-act="help-close"]', () => {
      this.showHelp = false;
      if (!this.save.seenHelp) { this.save = { ...this.save, seenHelp: true }; this.persist(); }
      this.renderGarage();
    });
    on('[data-select-veh]', (e) => this.apply(store.selectVehicle(this.save, e.currentTarget.dataset.selectVeh)));
    on('[data-select-stage]', (e) => this.apply(store.selectStage(this.save, e.currentTarget.dataset.selectStage)));
    on('[data-buy-veh]', (e) => this.apply(store.buyVehicle(this.save, e.currentTarget.dataset.buyVeh)));
    on('[data-buy-stage]', (e) => this.apply(store.buyStage(this.save, e.currentTarget.dataset.buyStage)));
    on('[data-buy-part]', (e) => this.apply(store.buyUpgrade(this.save, this.save.vehicle, e.currentTarget.dataset.buyPart)));
  }

  /** Commit a store.js result (null = the action was not allowed, so nothing changes). */
  apply(next) {
    if (!next) return;
    this.save = next;
    this.persist();
    this.renderGarage();
  }

  /**
   * The garage's parked-car preview, drawn with the same code the live game uses.
   *
   * Draws only once the canvas has a REAL box. `renderGarage()` calls this in the same task that
   * sets innerHTML, and on a cold load the stylesheet (a <link> injected by ensureCSS) has not
   * applied yet, so the canvas can measure ~1x1 CSS px — which is exactly how the preview shipped
   * as a solid red panel on 2026-08-02 (a 3x3 bitmap holding three pixels of the middle of the car,
   * stretched to fill once CSS landed). Two belts here: retry on the next frame while the box is
   * still degenerate, and a ResizeObserver that redraws whenever the box actually changes, which
   * also covers late CSS, orientation changes and the hub's own mount transition.
   */
  drawPreview() {
    if (this.screen !== 'garage') return;
    const canvas = this.root.querySelector('.hc-preview');
    if (!canvas) return;
    const stage = stageById(this.save.stage);
    const veh = vehicleById(this.save.vehicle);
    const r = new Renderer(canvas, stage);
    const ok = r.drawPreview(veh, tunedSpec(veh.id, this.save.upgrades[veh.id], stage));
    this._watchPreview(canvas);
    if (!ok) {
      cancelAnimationFrame(this._previewRaf);
      this._previewRaf = requestAnimationFrame(() => this.drawPreview());
    }
  }

  /** One ResizeObserver, re-pointed at whichever preview canvas is currently mounted. */
  _watchPreview(canvas) {
    if (typeof ResizeObserver !== 'function') return;
    if (!this._previewRO) {
      this._previewRO = new ResizeObserver(() => {
        if (this.screen === 'garage') this.drawPreview();
      });
    }
    if (this._previewWatched === canvas) return;
    this._previewRO.disconnect();
    this._previewWatched = canvas;
    this._previewRO.observe(canvas);
  }

  // --- play --------------------------------------------------------------------------------

  startRun() {
    const s = this.save;
    const stage = stageById(s.stage);
    const veh = vehicleById(s.vehicle);
    const spec = tunedSpec(veh.id, s.upgrades[veh.id], stage);
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.terrain = makeTerrain(seed, stage);
    this.run = new Run(spec, this.terrain);
    this.run.start();
    this.result = null;
    this.paused = false;
    this.keys = { gas: false, brake: false };
    this.pointers.clear();
    this.screen = 'play';
    this.renderPlay();
  }

  renderPlay() {
    const stage = stageById(this.save.stage);
    this.root.innerHTML = `
      <div class="hc-play hc-stage-${stage.id}">
        <canvas class="hc-canvas"></canvas>
        <div class="hc-hud">
          <div class="hc-hud-tl">
            <div class="hc-fuel">
              ${ICON_FUEL}
              <div class="hc-fuelbar" role="img" aria-label="${esc(t('aria_fuel'))}"><i data-fuel></i></div>
            </div>
            <div class="hc-chip">${ICON_COIN}<b data-coins>0</b></div>
          </div>

          <div class="hc-hud-tc">
            <div class="hc-dist"><b data-dist>0</b><span>${esc(t('unit_m'))}</span></div>
            <div class="hc-ruler" aria-hidden="true">
              <i class="hc-rtick"></i><i class="hc-rtick"></i><i class="hc-rtick"></i><i class="hc-rtick"></i>
              <span class="hc-flag" data-flag><svg viewBox="0 0 16 20"><path d="M3 20V1" stroke="#231f1c" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M4 2h10l-2.5 3.5L14 9H4z" fill="#E0532F" stroke="#231f1c" stroke-width="1.6" stroke-linejoin="round"/></svg><em data-flagm>100</em></span>
            </div>
          </div>

          <button type="button" class="hc-pausebtn" data-act="pause" aria-label="${esc(t('aria_pause'))}">
            <i></i><i></i>
          </button>

          <div class="hc-dials">
            <button type="button" class="hc-nitrobtn" data-act="nitro" aria-label="${esc(t('aria_boost'))}">
              ${ICON_NITRO}<b data-nitro>0</b>
            </button>
            ${this.dialHTML('rpm', t('rpm'))}
            ${this.dialHTML('boost', t('boost'))}
          </div>

          <button type="button" class="hc-pedal hc-pedal-brake" data-pedal="brake" aria-label="${esc(t('aria_brake'))}">
            ${this.pedalFaceHTML()}<span>${esc(t('brake'))}</span>
          </button>
          <button type="button" class="hc-pedal hc-pedal-gas" data-pedal="gas" aria-label="${esc(t('aria_gas'))}">
            ${this.pedalFaceHTML()}<span>${esc(t('gas'))}</span>
          </button>
        </div>
        <div class="hc-overlay" data-overlay hidden></div>
      </div>`;

    const canvas = this.root.querySelector('.hc-canvas');
    this.renderer = new Renderer(canvas, stageById(this.save.stage));
    this.renderer.resize();
    this.el = {
      fuel: this.root.querySelector('[data-fuel]'),
      coins: this.root.querySelector('[data-coins]'),
      dist: this.root.querySelector('[data-dist]'),
      flag: this.root.querySelector('[data-flag]'),
      flagm: this.root.querySelector('[data-flagm]'),
      nitro: this.root.querySelector('[data-nitro]'),
      rpm: this.root.querySelector('[data-needle-rpm]'),
      boost: this.root.querySelector('[data-needle-boost]'),
      overlay: this.root.querySelector('[data-overlay]'),
    };
    this.bindPlay();
    this.lastT = 0; this.acc = 0;
  }

  /** The chunky pedal face: a 2x3 grille of holes, per the brief's pedal description. */
  pedalFaceHTML() {
    return `<span class="hc-pedal-face" aria-hidden="true">${
      Array.from({ length: 6 }, () => '<i></i>').join('')}</span>`;
  }

  dialHTML(id, label) {
    return `<div class="hc-dial">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="21" fill="#efe9dc" stroke="#231f1c" stroke-width="3"/>
        <path d="M24 24 L38.8 9.2 A21 21 0 0 1 40.5 17 Z" fill="#E0532F" opacity="0.85"/>
        <g stroke="#231f1c" stroke-width="2" stroke-linecap="round">
          <path d="M9.2 38.8 11.7 36.3"/><path d="M6.5 24 10 24"/><path d="M9.2 9.2 11.7 11.7"/>
          <path d="M24 6.5 24 10"/><path d="M38.8 9.2 36.3 11.7"/>
        </g>
        <line data-needle-${id} x1="24" y1="24" x2="24" y2="9" stroke="#231f1c" stroke-width="3" stroke-linecap="round" transform="rotate(-135 24 24)"/>
        <circle cx="24" cy="24" r="3.4" fill="#231f1c"/>
      </svg>
      <span>${esc(label)}</span>
    </div>`;
  }

  bindPlay() {
    const pedals = this.root.querySelectorAll('[data-pedal]');
    pedals.forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.pointers.set(e.pointerId, el.dataset.pedal);
        el.classList.add('is-down');
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    this.root.querySelector('[data-act="pause"]').addEventListener('click', () => this.setPaused(!this.paused));
    this.root.querySelector('[data-act="nitro"]').addEventListener('click', () => {
      if (this.run) this.run.useNitro();
    });
  }

  releasePointer(id) {
    if (!this.pointers.has(id)) return;
    const which = this.pointers.get(id);
    this.pointers.delete(id);
    if (![...this.pointers.values()].includes(which)) {
      const el = this.root.querySelector(`[data-pedal="${which}"]`);
      if (el) el.classList.remove('is-down');
    }
  }

  onKey(e, down) {
    if (this.screen !== 'play') return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { this.keys.gas = down; e.preventDefault(); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { this.keys.brake = down; e.preventDefault(); }
    else if (down && (k === 'Escape' || k === 'p' || k === 'P')) this.setPaused(!this.paused);
    else if (down && (k === ' ' || k === 'Shift')) { if (this.run) this.run.useNitro(); }
  }

  get throttle() {
    const held = [...this.pointers.values()];
    const gas = this.keys.gas || held.includes('gas');
    const brake = this.keys.brake || held.includes('brake');
    return (gas ? 1 : 0) + (brake ? -1 : 0);
  }

  setPaused(on) {
    if (this.screen !== 'play' || this.result) return;
    this.paused = !!on;
    this.keys = { gas: false, brake: false };
    this.pointers.clear();
    this.root.querySelectorAll('[data-pedal]').forEach((el) => el.classList.remove('is-down'));
    if (this.paused) this.showOverlay(this.pauseHTML(), () => this.bindPause());
    else this.hideOverlay();
  }

  pauseHTML() {
    return `<div class="hc-modal-card">
      <button type="button" class="hc-x" data-act="resume" aria-label="${esc(t('aria_close'))}">&times;</button>
      <h3>${esc(t('paused'))}</h3>
      <div class="hc-modal-btns">
        <button type="button" class="hc-btn hc-primary" data-act="resume">${esc(t('resume'))}</button>
        <button type="button" class="hc-btn" data-act="restart">${esc(t('restart'))}</button>
        <button type="button" class="hc-btn" data-act="quit">${esc(t('quit'))}</button>
      </div>
    </div>`;
  }

  bindPause() {
    const o = this.el.overlay;
    o.querySelectorAll('[data-act="resume"]').forEach((b) => b.addEventListener('click', () => this.setPaused(false)));
    o.querySelector('[data-act="restart"]').addEventListener('click', () => this.startRun());
    o.querySelector('[data-act="quit"]').addEventListener('click', () => this.toGarage());
  }

  showOverlay(html, bind) {
    this.el.overlay.innerHTML = html;
    this.el.overlay.hidden = false;
    if (bind) bind();
  }

  hideOverlay() {
    this.el.overlay.hidden = true;
    this.el.overlay.innerHTML = '';
  }

  toGarage() {
    this.run = null;
    this.renderer = null;
    this.result = null;
    this.paused = false;
    this.screen = 'garage';
    this.renderGarage();
  }

  /** The run just ended: bank it locally, record it in the shared stats store, show the card. */
  finishRun() {
    const run = this.run;
    const stage = stageById(this.save.stage);
    const res = run.result();
    const banked = store.bankRun(this.save, stage.id, res);
    this.save = banked.save;
    this.persist();
    this.result = { ...res, isBest: banked.isBest, best: this.save.best[stage.id] | 0 };

    // Shared, cross-device stats. Guarded: a stats failure must never take the game down with it,
    // and the local save above is already committed by this point either way.
    try {
      recordHillClimb(res.distance, stage.id, { coins: res.coins, flips: res.flips });
    } catch (err) {
      console.error('[hill-climb] recordHillClimb failed', err);
    }
    try { syncMyStats(); } catch { /* offline is fine, the hub retries */ }

    this.showOverlay(this.resultHTML(), () => this.bindResult());
  }

  resultHTML() {
    const r = this.result;
    const reason = r.reason === EndReason.FUEL ? t('out_of_fuel') : t('crashed');
    return `<div class="hc-modal-card hc-result">
      <button type="button" class="hc-x" data-act="quit" aria-label="${esc(t('aria_close'))}">&times;</button>
      <h3>${esc(t('run_over'))}</h3>
      <p class="hc-reason">${esc(reason)}</p>
      ${r.isBest ? `<p class="hc-newbest">${esc(t('new_best'))}</p>` : ''}
      <div class="hc-rgrid">
        <div><b>${fmt(r.distance)}</b><span>${esc(t('r_distance'))} (${esc(t('unit_m'))})</span></div>
        <div><b>${fmt(r.coins)}</b><span>${esc(t('r_coins'))}</span></div>
        <div><b>${fmt(r.flips)}</b><span>${esc(t('r_flips'))}</span></div>
        <div><b>${fmt(r.best)}</b><span>${esc(t('r_best'))} (${esc(t('unit_m'))})</span></div>
      </div>
      <div class="hc-modal-btns">
        <button type="button" class="hc-btn hc-primary" data-act="retry">${esc(t('retry'))}</button>
        <button type="button" class="hc-btn" data-act="quit">${esc(t('quit'))}</button>
      </div>
    </div>`;
  }

  bindResult() {
    const o = this.el.overlay;
    o.querySelector('[data-act="retry"]').addEventListener('click', () => this.startRun());
    o.querySelectorAll('[data-act="quit"]').forEach((b) => b.addEventListener('click', () => this.toGarage()));
  }

  // --- the loop ----------------------------------------------------------------------------

  tick(now) {
    this.raf = requestAnimationFrame(this.tick);
    if (this.screen !== 'play' || !this.run || !this.renderer) { this.lastT = now; return; }
    if (!this.lastT) this.lastT = now;
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);

    const th = this.paused || this.result ? 0 : this.throttle;
    if (!this.paused && !this.result) {
      // Fixed-timestep sim with a catch-up cap, so physics is frame-rate independent and a stalled
      // tab cannot make the car teleport through a hill on the next frame.
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < MAX_STEPS) {
        this.run.step(th, DT);
        this.acc -= DT;
        steps++;
        if (this.run.state !== RunState.RUNNING) break;
      }
      if (steps >= MAX_STEPS) this.acc = 0;
    }

    this.renderer.pushEvents(this.run.events);
    this.renderer.draw(this.run, vehicleById(this.save.vehicle), th, dt, now / 1000);
    this.updateHUD(th);

    if (this.run.state === RunState.OVER && !this.result) this.finishRun();
  }

  updateHUD(th) {
    const run = this.run, el = this.el;
    if (!el || !el.fuel) return;
    const pct = Math.max(0, Math.min(1, run.fuel / run.maxFuel));
    el.fuel.style.width = `${(pct * 100).toFixed(1)}%`;
    el.fuel.style.background = pct < 0.2 ? '#E0532F' : pct < 0.45 ? '#F2B705' : '#3fae3a';
    const dist = Math.max(0, Math.floor(run.distance));
    el.coins.textContent = fmt(run.coins);
    el.dist.textContent = fmt(dist);
    el.nitro.textContent = String(Math.min(NITRO_MAX, run.nitro | 0));
    // The ruler's flag walks toward the left tick as the next 100 m checkpoint approaches.
    const nextMark = (Math.floor(dist / 100) + 1) * 100;
    const frac = (dist % 100) / 100;
    el.flag.style.left = `${(6 + (1 - frac) * 88).toFixed(1)}%`;
    el.flagm.textContent = String(nextMark);
    if (el.rpm) el.rpm.setAttribute('transform', `rotate(${(-135 + run.rpm01(th) * 250).toFixed(1)} 24 24)`);
    if (el.boost) el.boost.setAttribute('transform', `rotate(${(-135 + run.boost01() * 250).toFixed(1)} 24 24)`);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this._previewRaf);
    this.raf = 0;
    this._previewRaf = 0;
    if (this._previewRO) { this._previewRO.disconnect(); this._previewRO = null; }
    this._previewWatched = null;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this._offLang) this._offLang();
    this.run = null;
    this.renderer = null;
    this.root.classList.remove('hc-root');
    this.root.innerHTML = '';
  }

  isInProgress() {
    return this.screen === 'play' && !!this.run && this.run.live && !this.result;
  }
}

export function init(container) {
  if (!container) return;
  ensureCSS();
  if (instance) instance.destroy();
  instance = new HillClimb(container);
}

export function destroy() {
  if (instance) instance.destroy();
  instance = null;
}

export function isInProgress() {
  return !!instance && instance.isInProgress();
}

export default { init, destroy, isInProgress };
