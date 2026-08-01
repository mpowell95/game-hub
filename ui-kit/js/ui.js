// ui-kit/js/ui.js - the UI Kit gallery: a dev-only review surface for css/ui.css.
//
// WHAT THIS IS
// ------------
// Not a game. It is a card in the launcher, gated `devOnly: true` in js/hub.js exactly like
// poolv2, so it renders only for a profile that passes isDevProfile() (Matt or the tester) and
// no other player ever sees it. It exists so the shared design layer can be judged on a real
// phone, in the real hub shell, before any game adopts it.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// - Records nothing. It imports neither js/game-stats.js nor js/game-stats-global.js, reads and
//   writes no localStorage key, and touches no sync path. It is outside THE LAW's blast radius
//   by construction, not by care.
// - Writes no theme. js/theme.js owns `.gh-dark` on <html>. The light/dark switch here re-tints
//   a LOCAL preview container only (see .uk-stage--dark in ui-kit.css); the player's own theme
//   preference is never read or written.
// - Changes no game. css/ui.css is injected by this module when the gallery mounts and is
//   linked from nowhere else. No game has adopted it yet, so nothing in the hub looks different.
// - Is not in sw.js. Left out of ASSETS on purpose while under review: a bad ASSETS entry aborts
//   cache.addAll() atomically and silently leaves the old worker serving (root CLAUDE.md, the
//   version-pill diagnostic). Nothing here goes near the service worker until the layer ships.
//
// isInProgress(): the LOSSLESS meaning (root CLAUDE.md, "The module contract"). Always false.
// There is no game state to abandon, so the hub should never ask "leave game?" on the way out.

import { STRINGS } from './strings.js';
import { makeT, onLangChange } from '../../js/i18n.js';

const t = makeT(STRINGS);

// Measured with ripgrep across css/*.css and */css/*.css on 2026-08-01, before css/ui.css
// existed. Kept as data so the Drift panel cannot drift from the commit message.
const DRIFT = [
  { key: 'drift_hub_refs', value: 'drift_of16', literal: false },
  { key: 'drift_props', value: '397' },
  { key: 'drift_radius', value: '25+' },
  { key: 'drift_shadow', value: '220' },
  { key: 'drift_fs', value: '130' },
  { key: 'drift_font', value: '8' },
  { key: 'drift_btn', value: '9', keyRow: true },
];

const RADII = [
  ['--gh-r-sm', '8px'], ['--gh-r-md', '12px'], ['--gh-r-lg', '16px'], ['--gh-r-pill', '999px'],
];
const SHADOWS = [
  ['--gh-sh-1', '1'], ['--gh-sh-2', '2'], ['--gh-sh-3', '3'], ['--gh-sh-4', '4'],
];
const TYPE = [
  ['--gh-fs-xs', '12px'], ['--gh-fs-sm', '14px'], ['--gh-fs-md', '16px'],
  ['--gh-fs-lg', '20px'], ['--gh-fs-xl', '26px'], ['--gh-fs-2xl', '34px'],
];
const SPACE = [
  ['--gh-sp-1', 4], ['--gh-sp-2', 8], ['--gh-sp-3', 12],
  ['--gh-sp-4', 16], ['--gh-sp-5', 24], ['--gh-sp-6', 32],
];
const COLORS = [
  ['--gh-bg', 'var(--gh-bg)'], ['--gh-surface', 'var(--gh-surface)'],
  ['--gh-surface-2', 'var(--gh-surface-2)'], ['--gh-ink', 'var(--gh-ink)'],
  ['--gh-muted', 'var(--gh-muted)'], ['--gh-accent', 'var(--gh-accent)'],
];

// The colorblind-safe set: each hue carries its shape marker, never hue alone (root CLAUDE.md).
const CB = [
  { prop: '--gh-cb-yellow', hex: '#F2B705', labelKey: 'cb_yellow', shape: 'circle' },
  { prop: '--gh-cb-blue', hex: '#1F5FA8', labelKey: 'cb_blue', shape: 'triangle' },
  { prop: '--gh-cb-vermilion', hex: '#E0532F', labelKey: 'cb_vermilion', shape: 'square' },
  { prop: '--gh-cb-teal', hex: '#178A7A', labelKey: 'cb_teal', shape: 'diamond' },
];

function shapeSVG(shape, hex) {
  const body = {
    circle: '<circle cx="11" cy="11" r="8"/>',
    triangle: '<polygon points="11,3 20,19 2,19"/>',
    square: '<rect x="3" y="3" width="16" height="16" rx="2"/>',
    diamond: '<polygon points="11,2 20,11 11,20 2,11"/>',
  }[shape] || '';
  return `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="${hex}">${body}</svg>`;
}

let instance = null;

class UiKit {
  constructor(container) {
    this.el = container;
    this.tab = 'tokens';
    this.dark = false;
    this.modalOpen = false;
    this.openAcc = 'players';
    this._ensureCss();
    this._onClick = (e) => this._handleClick(e);
    this.el.addEventListener('click', this._onClick);
    // Esc closes the demo modal, mirroring how a real game's popup should behave.
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.modalOpen) { this.modalOpen = false; this.render(); }
    };
    document.addEventListener('keydown', this._onKey);
    this._offLang = onLangChange(() => this.render());
    this.render();
  }

  // Injects BOTH stylesheets idempotently: the shared layer under review, and this gallery's own
  // chrome. Same new URL(..., import.meta.url) pattern every game module uses, so the gallery
  // works identically mounted in the hub and standalone.
  _ensureCss() {
    const add = (rel) => {
      const href = new URL(rel, import.meta.url).href;
      if ([...document.styleSheets].some((s) => s.href === href)) return;
      if (document.querySelector(`link[href="${href}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    };
    add('../../css/ui.css');      // the layer being reviewed
    add('../css/ui-kit.css');     // this gallery's own chrome
  }

  // --- rendering ------------------------------------------------------------------------------
  render() {
    const tab = (id, labelKey) => `
      <button type="button" class="uk-tab" role="tab" data-tab="${id}"
        aria-selected="${this.tab === id}">${t(labelKey)}</button>`;

    this.el.innerHTML = `
      <div class="uk-root">
        <header class="uk-head">
          <h1 class="uk-title">${t('title')}</h1>
          <p class="uk-tagline">${t('tagline')}</p>
        </header>

        <div class="uk-tabs" role="tablist">
          ${tab('tokens', 'tab_tokens')}
          ${tab('parts', 'tab_parts')}
          ${tab('drift', 'tab_drift')}
        </div>

        ${this.tab === 'drift' ? '' : `
        <div class="uk-themebar">
          <span class="uk-themebar-label">${t('preview_theme')}</span>
          <div class="gh-seg" role="group">
            <button type="button" class="gh-seg__item" data-theme="light"
              aria-pressed="${!this.dark}">${t('theme_light')}</button>
            <button type="button" class="gh-seg__item" data-theme="dark"
              aria-pressed="${this.dark}">${t('theme_dark')}</button>
          </div>
          <p class="uk-themenote">${t('theme_note')}</p>
        </div>`}

        ${this.tab === 'tokens' ? this._tokensPanel()
          : this.tab === 'parts' ? this._partsPanel()
            : this._driftPanel()}
      </div>
      ${this.modalOpen ? this._modal() : ''}
    `;
  }

  _stage(inner) {
    return `<div class="uk-stage${this.dark ? ' uk-stage--dark' : ''}">${inner}</div>`;
  }

  _tokensPanel() {
    const radii = RADII.map(([prop, val]) => `
      <div class="uk-sw">
        <div class="uk-sw-box" style="border-radius: var(${prop});"></div>
        <span class="uk-sw-name">${prop.replace('--gh-r-', '')}</span>
        <span class="uk-sw-val">${val}</span>
      </div>`).join('');

    const shadows = SHADOWS.map(([prop, n]) => `
      <div class="uk-sw">
        <div class="uk-sw-box" style="box-shadow: var(${prop}); border-radius: var(--gh-r-md); border-color: transparent;"></div>
        <span class="uk-sw-name">sh-${n}</span>
        <span class="uk-sw-val">${prop}</span>
      </div>`).join('');

    const type = TYPE.map(([prop, val]) => `
      <div class="uk-type-row">
        <span class="uk-type-name">${prop.replace('--gh-fs-', '')}</span>
        <span class="uk-type-demo" style="font-size: var(${prop});">Aa</span>
        <span class="uk-sw-val">${val}</span>
      </div>`).join('');

    const space = SPACE.map(([prop, px]) => `
      <div class="uk-space-row">
        <span class="uk-space-bar" style="width: ${px * 4}px;"></span>
        <span class="uk-space-name">${prop.replace('--gh-sp-', 'sp-')} (${px}px)</span>
      </div>`).join('');

    const colors = COLORS.map(([prop, val]) => `
      <div class="uk-sw">
        <div class="uk-sw-box uk-sw-box--color" style="background: ${val}; border-radius: var(--gh-r-md);"></div>
        <span class="uk-sw-name">${prop.replace('--gh-', '')}</span>
      </div>`).join('');

    const cb = CB.map((c) => `
      <div class="uk-cb-item">${shapeSVG(c.shape, c.hex)}<span>${t(c.labelKey)}</span></div>`).join('');

    return `<div class="uk-panel">${this._stage(`
      <p class="uk-sec-note">${t('tokens_intro')}</p>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('tok_radius')}</h2>
        <p class="uk-sec-note">${t('replaces_one', { n: '25+' })}</p>
        <div class="uk-swatches">${radii}</div>
      </section>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('tok_shadow')}</h2>
        <p class="uk-sec-note">${t('replaces_one', { n: '220' })}</p>
        <div class="uk-swatches">${shadows}</div>
      </section>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('tok_type')}</h2>
        <p class="uk-sec-note">${t('replaces_one', { n: '130' })}</p>
        ${type}
      </section>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('tok_space')}</h2>
        ${space}
      </section>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('tok_color')}</h2>
        <div class="uk-swatches">${colors}</div>
      </section>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('tok_cb')}</h2>
        <p class="uk-sec-note">${t('tok_cb_note')}</p>
        <div class="uk-cb">${cb}</div>
      </section>
    `)}</div>`;
  }

  _partsPanel() {
    const acc = (id, headKey, valKey, bodyKey) => `
      <div class="gh-acc">
        <button type="button" class="gh-acc__head" data-acc="${id}"
          aria-expanded="${this.openAcc === id}">
          <span>${t(headKey)}</span>
          <span class="gh-acc__value">${t(valKey)}</span>
        </button>
        <div class="gh-acc__body"${this.openAcc === id ? '' : ' hidden'}>
          <p class="gh-card__note">${t(bodyKey)}</p>
        </div>
      </div>`;

    return `<div class="uk-panel">${this._stage(`
      <p class="uk-sec-note">${t('parts_intro')}</p>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('part_buttons')}</h2>
        <div class="uk-row">
          <button type="button" class="gh-btn">${t('btn_default')}</button>
          <button type="button" class="gh-btn gh-btn--primary">${t('btn_primary')}</button>
          <button type="button" class="gh-btn gh-btn--ghost">${t('btn_ghost')}</button>
          <button type="button" class="gh-btn gh-btn--danger">${t('btn_danger')}</button>
          <button type="button" class="gh-btn gh-btn--sm">${t('btn_small')}</button>
          <button type="button" class="gh-btn" disabled>${t('btn_disabled')}</button>
          <button type="button" class="gh-btn gh-btn--icon" aria-label="${t('close')}">&times;</button>
        </div>
      </section>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('part_cards')}</h2>
        <div class="gh-card">
          <h3 class="gh-card__title">${t('card_title')}</h3>
          <p class="gh-card__note">${t('card_note')}</p>
          <div class="uk-row" style="margin-top: var(--gh-sp-3);">
            <span class="gh-chip">${t('chip_example')}</span>
            <span class="gh-chip gh-chip--accent">${t('chip_new')}</span>
          </div>
        </div>
      </section>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('part_controls')}</h2>
        <div class="uk-row" style="align-items: flex-end;">
          <div>
            <span class="gh-field__label">${t('seg_label')}</span>
            <div class="gh-seg" role="group">
              <button type="button" class="gh-seg__item" data-demo-seg="easy"
                aria-pressed="${this._seg !== 'medium' && this._seg !== 'hard'}">${t('seg_easy')}</button>
              <button type="button" class="gh-seg__item" data-demo-seg="medium"
                aria-pressed="${this._seg === 'medium'}">${t('seg_medium')}</button>
              <button type="button" class="gh-seg__item" data-demo-seg="hard"
                aria-pressed="${this._seg === 'hard'}">${t('seg_hard')}</button>
            </div>
          </div>
          <label class="gh-field" style="flex: 1 1 180px;">
            <span class="gh-field__label">${t('field_label')}</span>
            <input class="gh-input" type="text" placeholder="${t('field_placeholder')}">
          </label>
        </div>
      </section>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('part_acc')}</h2>
        ${acc('players', 'acc_players', 'acc_players_val', 'acc_players_body')}
        ${acc('rules', 'acc_rules', 'acc_rules_val', 'acc_rules_body')}
      </section>

      <section class="uk-sec">
        <h2 class="uk-sec-title">${t('part_modal')}</h2>
        <button type="button" class="gh-btn gh-btn--primary" data-open-modal>${t('open_modal')}</button>
      </section>
    `)}</div>`;
  }

  _driftPanel() {
    const rows = DRIFT.map((d) => `
      <tr${d.keyRow ? ' class="is-key"' : ''}>
        <td>${t(d.key)}</td>
        <td>${d.literal === false ? t(d.value) : d.value}</td>
      </tr>`).join('');

    return `<div class="uk-panel">
      <p class="uk-sec-note">${t('drift_intro')}</p>
      <div class="uk-table-wrap">
        <table class="uk-table">
          <thead><tr><th>${t('drift_metric')}</th><th>${t('drift_count')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="uk-callout">${t('drift_note')}</p>
      <p class="uk-callout">${t('drift_scope')}</p>
    </div>`;
  }

  _modal() {
    return `
      <div class="gh-overlay" data-overlay>
        <div class="gh-modal" role="dialog" aria-modal="true" aria-label="${t('modal_title')}">
          <button type="button" class="gh-modal__close" data-close-modal
            aria-label="${t('close')}">&times;</button>
          <h2 class="gh-modal__title">${t('modal_title')}</h2>
          <p class="gh-card__note">${t('modal_body')}</p>
          <div class="gh-modal__actions">
            <button type="button" class="gh-btn gh-btn--primary" data-close-modal>${t('modal_again')}</button>
            <button type="button" class="gh-btn gh-btn--ghost" data-close-modal>${t('modal_close')}</button>
          </div>
        </div>
      </div>`;
  }

  // --- events ---------------------------------------------------------------------------------
  _handleClick(e) {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { this.tab = tabBtn.dataset.tab; this.render(); return; }

    const themeBtn = e.target.closest('[data-theme]');
    if (themeBtn) { this.dark = themeBtn.dataset.theme === 'dark'; this.render(); return; }

    const accBtn = e.target.closest('[data-acc]');
    if (accBtn) {
      // One row open at a time, the Escoba setup pattern. Tapping the open row closes it.
      const id = accBtn.dataset.acc;
      this.openAcc = this.openAcc === id ? null : id;
      this.render();
      return;
    }

    const seg = e.target.closest('[data-demo-seg]');
    if (seg) { this._seg = seg.dataset.demoSeg; this.render(); return; }

    if (e.target.closest('[data-open-modal]')) { this.modalOpen = true; this.render(); return; }
    if (e.target.closest('[data-close-modal]')) { this.modalOpen = false; this.render(); return; }
    // Tapping the backdrop (but not the modal itself) closes too.
    if (e.target.matches('[data-overlay]')) { this.modalOpen = false; this.render(); }
  }

  // Leak-free teardown: the hub reuses this container for the next game.
  destroy() {
    this.el.removeEventListener('click', this._onClick);
    document.removeEventListener('keydown', this._onKey);
    if (this._offLang) { this._offLang(); this._offLang = null; }
    this.el.innerHTML = '';
  }
}

export function init(container) {
  if (instance) instance.destroy();
  instance = new UiKit(container);
}

export function destroy() {
  if (instance) { instance.destroy(); instance = null; }
}

// Nothing to abandon: a gallery has no game state, so the hub must never confirm on the way out.
export function isInProgress() {
  return false;
}

export default { init, destroy, isInProgress };
