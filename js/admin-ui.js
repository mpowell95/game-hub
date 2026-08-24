// js/admin-ui.js - the ADMIN CONTROL PAGE: the screen half of js/admin-config.js (which is the data
// half, and carries the reasoning for the two switches). Matt-only, opened from the launcher's
// Admin button; js/hub.js renders that button for nobody else and imports this file lazily, so no
// other device ever downloads it.
//
// WHAT IT CONTROLS
//   Games      - every hub tile, Live for everyone or Admin only (for testing). This is the
//                `devOnly` decision, taken out of a commit-and-deploy cycle. The code default is
//                always shown and always one tap away (Default), so the source stays the baseline.
//   Skeeball   - each machine, in THREE states (Matt's correction on the first version: it must
//                separate "live and can be unlocked and played" from "not able to be played yet"):
//                OPEN to everyone, UNLOCKABLE (live, earned the normal way), or TESTING (only a dev
//                profile). All three are read-time only and can NEVER un-earn a machine somebody
//                already unlocked (js/admin-config.js's header, THE LAW rule 2).
//   Scores     - per player, per machine: void the scores somebody threw on a machine that was
//                broken at the time (Matt, 2026-08-24, after THE CLASSIC and BASKET FEVER both
//                handed out impossible scores while they were being tuned). Nothing is deleted:
//                the void is an overlay applied when numbers are DISPLAYED, and the raw record is
//                shown beside the corrected one so the two are never confused. See
//                js/stats-corrections.js for what it can and cannot do.
//   This device - the local switches that used to need a console: an update check, the bug inbox,
//                this device's id, the dev-write opt-in (dev origins only), and a reset of the
//                one-time announcement seen-list so a popup can be re-checked.
//
// THE LAW (root CLAUDE.md): this screen writes nothing but `adminConfig/v1` (through admin-config.js)
// and two local preference keys. There is deliberately NO control here that deletes, resets or
// rewrites any player's stats, profile or history - the app-wide clears that do exist are node
// scripts with backups, dry runs and re-read verification (clear-skeeball-stats.mjs), and a button
// is the wrong home for them.
//
// BUILT ON css/ui.css's `.gh-*` primitives, like js/bug-report-ui.js (root CLAUDE.md's "USE WHAT
// EXISTS" table): overlay, modal, buttons and segmented controls come from there, and the local
// `.adm-*` block adds only the row layout that does not exist yet.

import { GAMES } from './hub.js';
import { BOARDS, DEFAULT_BOARD } from '../skeeball/js/boards.js';
import { loadStats, statsId } from './game-stats.js';
import { isUnlocked } from './arcade-scores.js';
import {
  readCachedConfig, refreshAdminConfig, gameOverride, boardOverride, boardTestingOverride,
  resolveGameLive, resolveBoardMode, setGameLive, setBoardMode, resolveBoardCorrections,
  setSkeeballCorrection,
} from './admin-config.js';
import { correctBoard, correctionFor, snapshotOf } from './stats-corrections.js';
import { dayKey } from './arcade-scores.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A GAMES entry's title in the active language (the registry holds either a string or {en,es}). */
function titleText(g) {
  const v = g.title;
  return typeof v === 'string' ? v : (v && (v[getLang()] || v.en)) || g.id;
}

// --- css ----------------------------------------------------------------------------------------

function ensureCss() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/ui.css', import.meta.url).href;
    link.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(link);
  }
  if (document.getElementById('adm-css')) return;
  const style = document.createElement('style');
  style.id = 'adm-css';
  style.textContent = `
  .adm-overlay { z-index: 300; padding: max(var(--gh-sp-4), env(safe-area-inset-top)) var(--gh-sp-4)
                 max(var(--gh-sp-4), env(safe-area-inset-bottom)); align-content: center; }
  /* The modal itself does NOT scroll (overflow: hidden): the list inside it does, so the title and
     the status line stay put and the status line can never be pushed off the bottom edge. */
  .adm-modal { width: min(560px, 100%); max-height: 90vh; display: flex; flex-direction: column;
               overflow: hidden; }
  /* The list scrolls, not the page behind it: a fixed overlay that scrolls needs its own
     containment or a flick at either end pans the launcher underneath (root CLAUDE.md). */
  .adm-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
                margin: 0 calc(var(--gh-sp-4) * -1); padding: 0 var(--gh-sp-4); }
  .adm-lead { margin: 0 0 var(--gh-sp-3); font-size: var(--gh-fs-sm); color: var(--gh-muted); line-height: 1.5; }
  .adm-sec { margin-top: var(--gh-sp-5); }
  .adm-sec:first-of-type { margin-top: var(--gh-sp-3); }
  .adm-sec > h3 { margin: 0 0 var(--gh-sp-1); font-size: var(--gh-fs-md); }
  .adm-sec > p { margin: 0 0 var(--gh-sp-3); font-size: var(--gh-fs-xs); color: var(--gh-muted); line-height: 1.5; }
  /* Wraps rather than squeezes: at 393px the controls drop onto their own line under the name
     instead of crushing it into a two-word column (which is what the first draft did). */
  .adm-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gh-sp-2);
             padding: var(--gh-sp-3) 0; border-top: 1px solid var(--gh-border); }
  .adm-row:first-of-type { border-top: 0; }
  .adm-row-main { flex: 1 1 220px; min-width: 0; }
  .adm-ctl { display: flex; align-items: center; gap: var(--gh-sp-2); margin-left: auto; }
  /* Three labels do not fit beside a name at 393px, so a machine row always stacks and its
     segmented control takes the full width. */
  .adm-row--stack .adm-row-main { flex: 1 1 100%; }
  .adm-ctl--wide { flex: 1 1 100%; margin-left: 0; flex-wrap: wrap; }
  .adm-ctl--wide .gh-seg { flex: 1 1 100%; }
  .adm-ctl--wide .gh-seg__item { flex: 1 1 0; }
  /* Default drops under the three-way control and sits at the right, rather than being squeezed
     off the edge beside it (which is what it did at 393px on the first try). */
  .adm-ctl--wide > .gh-btn { margin-left: auto; }
  .adm-name { font-size: var(--gh-fs-sm); font-weight: 700; color: var(--gh-ink); }
  .adm-note { margin-top: 2px; font-size: var(--gh-fs-xs); color: var(--gh-muted); line-height: 1.4; }
  .adm-seg { flex: 0 0 auto; }
  .adm-seg .gh-seg__item { font-size: var(--gh-fs-xs); padding: 0 var(--gh-sp-3); min-height: 40px; }
  .adm-actions { display: flex; flex-wrap: wrap; gap: var(--gh-sp-2); }
  .adm-msg { flex: 0 0 auto; margin: var(--gh-sp-3) 0 0; min-height: 1.2em; font-size: var(--gh-fs-sm);
             font-weight: 600; line-height: 1.4; }
  .adm-msg.is-err { color: var(--gh-cb-vermilion); }
  .adm-msg.is-ok { color: var(--gh-cb-teal); }
  .adm-id { font-family: var(--gh-font-mono); font-size: var(--gh-fs-xs); word-break: break-all; }
  /* The corrected line sits under the raw one so the two are never confused for each other. */
  .adm-voided { font-weight: 700; color: var(--gh-cb-teal); }
  .adm-busy { opacity: .55; pointer-events: none; }`;
  document.head.appendChild(style);
}

// --- overlay ------------------------------------------------------------------------------------

let _host = null;
let _onKey = null;

function closeOverlay() {
  if (_onKey) { document.removeEventListener('keydown', _onKey); _onKey = null; }
  if (_host) { _host.remove(); _host = null; }
}

/** True while a write is in flight, so two taps cannot race each other onto the same node. */
let _busy = false;

/** Every synced device record, for the Scores section. {} when offline - the section then says so. */
let _players = {};

async function readPlayers() {
  try {
    const net = await import('./stats-net.js');
    return await net.readPlayersOnce();
  } catch { return {}; }
}

/**
 * Open the admin control page. Callers gate on isAdmin() first (js/hub.js does); this is a screen,
 * not a lock. Awaits a config refresh before painting so the switches show what is actually live -
 * a stale cache here would have Matt flipping a switch that is already flipped.
 */
export async function openAdmin() {
  ensureCss();
  closeOverlay();
  const host = document.createElement('div');
  host.className = 'gh-overlay adm-overlay';
  host.innerHTML = `<div class="gh-modal adm-modal" role="dialog" aria-modal="true" aria-label="${esc(t('adm_title'))}"></div>`;
  document.body.appendChild(host);
  _host = host;
  host.addEventListener('click', (e) => { if (e.target === host && !_busy) closeOverlay(); });
  _onKey = (e) => { if (e.key === 'Escape' && !_busy) closeOverlay(); };
  document.addEventListener('keydown', _onKey);

  const card = host.querySelector('.gh-modal');
  card.innerHTML = `
    <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('adm_close'))}">&times;</button>
    <h2 class="gh-modal__title">🛠️ ${esc(t('adm_title'))}</h2>
    <p class="adm-lead">${esc(t('adm_loading'))}</p>`;
  card.querySelector('[data-role="close"]').addEventListener('click', () => closeOverlay());

  // Best effort: a failed refresh leaves the cached config in force and says so in the status line,
  // rather than showing an empty screen or pretending the switches are unknown. The player records
  // ride the same await: the Scores section needs everyone's raw numbers to show what a void would
  // remove, and an empty list is honest when they cannot be read.
  const [fresh, players] = await Promise.all([refreshAdminConfig(), readPlayers()]);
  _players = players;
  if (!_host) return;                       // closed while we were waiting
  render(card, { offline: !fresh });
}

function render(card, opts = {}) {
  const cfg = readCachedConfig();
  card.innerHTML = `
    <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('adm_close'))}">&times;</button>
    <h2 class="gh-modal__title">🛠️ ${esc(t('adm_title'))}</h2>
    <p class="adm-lead">${esc(t('adm_lead'))}</p>
    <div class="adm-scroll">
      ${gamesSectionHTML(cfg)}
      ${skeeballSectionHTML(cfg)}
      ${scoresSectionHTML(cfg)}
      ${deviceSectionHTML()}
    </div>
    <p class="adm-msg${opts.offline ? ' is-err' : ''}" data-role="msg">${opts.offline ? esc(t('adm_offline')) : ''}</p>`;
  card.querySelector('[data-role="close"]').addEventListener('click', () => closeOverlay());
  wire(card);
}

/** The one status line, used by every action. `kind` is 'ok' | 'err' | ''. */
function say(card, text, kind) {
  const el = card.querySelector('[data-role="msg"]');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-err', kind === 'err');
  el.classList.toggle('is-ok', kind === 'ok');
}

// --- games --------------------------------------------------------------------------------------

function segHTML(name, options, value) {
  return `<div class="gh-seg adm-seg" role="group" aria-label="${esc(name)}">`
    + options.map((o) => `<button type="button" class="gh-seg__item" role="button"
         aria-pressed="${o.value === value ? 'true' : 'false'}" data-set="${esc(String(o.value))}"
         >${esc(o.label)}</button>`).join('')
    + `</div>`;
}

function gamesSectionHTML(cfg) {
  const rows = GAMES.slice().sort((a, b) => titleText(a).localeCompare(titleText(b))).map((g) => {
    const codeDefault = !g.devOnly;
    const live = resolveGameLive(cfg, g.id, codeDefault);
    const over = gameOverride(cfg, g.id);
    const note = over === null
      ? t('adm_game_default', { state: codeDefault ? t('adm_live') : t('adm_testing') })
      : t('adm_game_override', { state: codeDefault ? t('adm_live') : t('adm_testing') });
    return `<div class="adm-row" data-game="${esc(g.id)}">
      <div class="adm-row-main">
        <div class="adm-name">${esc(titleText(g))}</div>
        <div class="adm-note">${esc(note)}</div>
      </div>
      <div class="adm-ctl">
        ${segHTML(titleText(g), [
          { value: 'live', label: t('adm_live') },
          { value: 'test', label: t('adm_testing') },
        ], live ? 'live' : 'test')}
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm" data-default="${esc(g.id)}"
          ${over === null ? 'disabled' : ''}>${esc(t('adm_default'))}</button>
      </div>
    </div>`;
  }).join('');
  return `<section class="adm-sec">
    <h3>${esc(t('adm_games_title'))}</h3>
    <p>${esc(t('adm_games_note'))}</p>
    ${rows}
  </section>`;
}

// --- skeeball machines ---------------------------------------------------------------------------

function skeeballSectionHTML(cfg) {
  let sk = {};
  try { sk = (loadStats().games.skeeball || {}).sk || {}; } catch { sk = {}; }
  const rows = BOARDS.map((b) => {
    const first = b.id === DEFAULT_BOARD;
    const mode = resolveBoardMode(cfg, b.id, !!b.adminOnly);
    const set = boardOverride(cfg, b.id) !== null || boardTestingOverride(cfg, b.id) !== null;
    const earnedHere = isUnlocked(sk, b.id, DEFAULT_BOARD);
    // Machine names are proper nouns and are never routed through t() (boards.js's standing rule).
    const note = first ? t('adm_machine_first')
      : mode === 'open' ? t('adm_machine_open_note')
      : mode === 'unlockable' ? t('adm_machine_unlockable_note')
      : t('adm_machine_testing_note');
    // "You have unlocked it" is worth saying next to a machine in testing especially: it is the
    // proof that the unlock is still there, being declined rather than deleted.
    const mine = (!first && earnedHere) ? ' ' + t('adm_machine_mine') : '';
    return `<div class="adm-row adm-row--stack" data-board="${esc(b.id)}">
      <div class="adm-row-main">
        <div class="adm-name">${esc(b.name)}</div>
        <div class="adm-note">${esc(note + mine)}</div>
      </div>
      ${first ? '' : `<div class="adm-ctl adm-ctl--wide">
        ${segHTML(b.name, [
          { value: 'open', label: t('adm_mode_open') },
          { value: 'unlockable', label: t('adm_mode_unlockable') },
          { value: 'testing', label: t('adm_mode_testing') },
        ], mode)}
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm" data-boarddefault="${esc(b.id)}"
          ${set ? '' : 'disabled'}>${esc(t('adm_default'))}</button>
      </div>`}
    </div>`;
  }).join('');
  return `<section class="adm-sec">
    <h3>${esc(t('adm_skeeball_title'))}</h3>
    <p>${esc(t('adm_skeeball_note'))}</p>
    ${rows}
  </section>`;
}

// --- scores: per player, per machine ---------------------------------------------------------

/** Machine display name for a board id, from boards.js (proper nouns, never translated). */
function machineName(id) {
  const b = BOARDS.find((x) => x.id === id);
  return b ? b.name : id;
}

/** One row per (player-device, machine) that has any recorded Skeeball play. */
function scoreRows(cfg) {
  const out = [];
  for (const id of Object.keys(_players || {})) {
    const rec = _players[id] || {};
    const sk = ((((rec.stats || {}).games || {}).skeeball || {}).sk) || {};
    const boards = sk.boards || {};
    const corrs = resolveBoardCorrections(cfg, id) || {};
    const name = ((rec.profile || {}).name || '').trim() || t('adm_sc_unnamed');
    for (const boardId of Object.keys(boards)) {
      const raw = boards[boardId] || {};
      if (!((raw.plays | 0) || (raw.best | 0))) continue;
      const corr = correctionFor(corrs, boardId);
      out.push({ id, boardId, name, raw, corr, shown: correctBoard(raw, corr) });
    }
  }
  // Worst offenders first within a player: a name is what Matt is looking for, then the machine.
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.boardId.localeCompare(b.boardId));
}

function scoresSectionHTML(cfg) {
  const rows = scoreRows(cfg);
  const body = !rows.length
    ? `<p class="adm-note">${esc(t('adm_sc_empty'))}</p>`
    : rows.map((r) => {
      const rawLine = t('adm_sc_raw', { plays: r.raw.plays | 0, best: r.raw.best | 0, points: r.raw.points | 0 });
      const shownLine = t('adm_sc_shown', { plays: r.shown.plays | 0, best: r.shown.best | 0, points: r.shown.points | 0 });
      return `<div class="adm-row adm-row--stack" data-score="${esc(r.id)}" data-board="${esc(r.boardId)}">
        <div class="adm-row-main">
          <div class="adm-name">${esc(r.name)} &middot; ${esc(machineName(r.boardId))}</div>
          <div class="adm-note">${esc(rawLine)}</div>
          ${r.corr ? `<div class="adm-note adm-voided">${esc(shownLine)}</div>` : ''}
        </div>
        <div class="adm-ctl">
          ${r.corr
            ? `<button type="button" class="gh-btn gh-btn--sm" data-unvoid="1">${esc(t('adm_sc_undo'))}</button>`
            : ''}
          <button type="button" class="gh-btn gh-btn--sm${r.corr ? '' : ' gh-btn--danger'}" data-void="1">${
            esc(r.corr ? t('adm_sc_revoid') : t('adm_sc_void'))}</button>
        </div>
      </div>`;
    }).join('');
  return `<section class="adm-sec">
    <h3>${esc(t('adm_sc_title'))}</h3>
    <p>${esc(t('adm_sc_note'))}</p>
    ${body}
  </section>`;
}

// --- this device ----------------------------------------------------------------------------------

const ANNOUNCE_KEY = 'gamehub.announce.v1';
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';

function devWritesOn() {
  try { return localStorage.getItem(DEV_SYNC_OK) === '1'; } catch { return false; }
}
function isDevOrigin() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { return false; }
}

function deviceSectionHTML() {
  let id = '';
  try { id = statsId() || ''; } catch { id = ''; }
  return `<section class="adm-sec">
    <h3>${esc(t('adm_device_title'))}</h3>
    <p>${esc(t('adm_device_note'))}</p>
    <div class="adm-actions">
      <button type="button" class="gh-btn gh-btn--sm" data-role="update">${esc(t('adm_update'))}</button>
      <button type="button" class="gh-btn gh-btn--sm" data-role="inbox">${esc(t('adm_inbox'))}</button>
      <button type="button" class="gh-btn gh-btn--sm" data-role="announce">${esc(t('adm_announce_reset'))}</button>
      <button type="button" class="gh-btn gh-btn--sm" data-role="copyid">${esc(t('adm_copy_id'))}</button>
      ${isDevOrigin() ? `<button type="button" class="gh-btn gh-btn--sm" data-role="devwrites">${
        esc(t(devWritesOn() ? 'adm_devwrites_off' : 'adm_devwrites_on'))}</button>` : ''}
    </div>
    <p class="adm-note adm-id">${esc(t('adm_device_id', { id: id || '?' }))}</p>
  </section>`;
}

// --- wiring ----------------------------------------------------------------------------------------

function wire(card) {
  const scroll = card.querySelector('.adm-scroll');

  // One delegated handler for every switch: each write goes through admin-config.js, which verifies
  // it by fresh re-read and reports a failure loudly rather than leaving a dead-looking button.
  scroll.addEventListener('click', async (e) => {
    if (_busy) return;
    const seg = e.target.closest('.gh-seg__item');
    const gameDefault = e.target.closest('[data-default]');
    const boardDefault = e.target.closest('[data-boarddefault]');
    const gameRow = e.target.closest('[data-game]');
    const scoreRow = e.target.closest('[data-score]');
    // A score row also carries data-board (the machine it is about), so it has to be excluded here
    // or its buttons would be read as the machine-mode control above it.
    const boardRow = scoreRow ? null : e.target.closest('[data-board]');

    let run = null;
    // Tapping the side a game is ALREADY on is not a no-op on purpose: it pins that state as an
    // explicit override, which is exactly what "leave this one alone until I say otherwise" means.
    if (seg && gameRow) {
      run = () => setGameLive(gameRow.dataset.game, seg.dataset.set === 'live');
    } else if (seg && boardRow) {
      run = () => setBoardMode(boardRow.dataset.board, seg.dataset.set);
    } else if (gameDefault) {
      run = () => setGameLive(gameDefault.dataset.default, null);
    } else if (boardDefault) {
      run = () => setBoardMode(boardDefault.dataset.boarddefault, null);
    } else if (scoreRow && (e.target.closest('[data-void]') || e.target.closest('[data-unvoid]'))) {
      const undo = !!e.target.closest('[data-unvoid]');
      const { score: who, board } = scoreRow.dataset;
      // The void stores TODAY's raw totals as the line everything before is measured against, so
      // anything thrown after it counts normally and the correction never has to be edited again
      // (js/stats-corrections.js). Re-voiding simply takes a fresh line.
      const raw = (((((_players[who] || {}).stats || {}).games || {}).skeeball || {}).sk || {}).boards || {};
      run = () => setSkeeballCorrection(who, board, undo ? null : snapshotOf(raw[board], dayKey(Date.now())),
        undo ? '' : 'broken board');
    }
    if (!run) return;

    _busy = true;
    card.classList.add('adm-busy');
    say(card, t('adm_saving'), '');
    let res;
    try { res = await run(); } catch (err) { res = { ok: false, error: String((err && err.message) || err) }; }
    _busy = false;
    card.classList.remove('adm-busy');
    if (!_host) return;
    render(card);
    say(card, res && res.ok ? t('adm_saved') : t('adm_save_failed', { why: (res && res.error) || '?' }),
      res && res.ok ? 'ok' : 'err');
  });

  // --- device tools ---
  const on = (role, fn) => {
    const el = card.querySelector(`[data-role="${role}"]`);
    if (el) el.addEventListener('click', fn);
  };
  on('update', async () => {
    say(card, t('adm_updating'), '');
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
      location.reload();
    } catch (err) { say(card, t('adm_save_failed', { why: String((err && err.message) || err) }), 'err'); }
  });
  on('inbox', async () => {
    try {
      const m = await import('./bug-report-ui.js');
      closeOverlay();
      await m.openBugInbox();
    } catch (err) { say(card, t('adm_save_failed', { why: String((err && err.message) || err) }), 'err'); }
  });
  on('announce', () => {
    // A PREFERENCE, not history (js/announce.js's own header says the same): the worst case is
    // seeing a notice twice. Nothing else on this screen clears anything.
    try { localStorage.removeItem(ANNOUNCE_KEY); say(card, t('adm_announce_done'), 'ok'); }
    catch (err) { say(card, t('adm_save_failed', { why: String((err && err.message) || err) }), 'err'); }
  });
  on('copyid', async () => {
    let id = '';
    try { id = statsId() || ''; } catch { id = ''; }
    try { await navigator.clipboard.writeText(id); say(card, t('adm_copied'), 'ok'); }
    catch { say(card, id, ''); }
  });
  on('devwrites', () => {
    try {
      if (devWritesOn()) localStorage.removeItem(DEV_SYNC_OK); else localStorage.setItem(DEV_SYNC_OK, '1');
      render(card);
      say(card, t(devWritesOn() ? 'adm_devwrites_now_on' : 'adm_devwrites_now_off'), 'ok');
    } catch (err) { say(card, t('adm_save_failed', { why: String((err && err.message) || err) }), 'err'); }
  });
}

export default { openAdmin };
