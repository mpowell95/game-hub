// js/admin-ui.js - the ADMIN CONTROL PAGE: the screen half of js/admin-config.js (which is the data
// half, and carries the reasoning behind every switch). Matt-only, opened from the launcher's Admin
// button; js/hub.js renders that button for nobody else and imports this file lazily, so no other
// device ever downloads it.
//
// WHAT IT CONTROLS
//   Games      - every hub tile: Live for everyone, or Admin only. The `devOnly` decision, taken
//                out of a commit-and-deploy cycle.
//   Skeeball   - each machine in three states: Open (everyone plays it now), Unlockable (live,
//                earned the normal way), Testing (nobody but a dev profile). Read-time only, and
//                none of them can un-earn a machine somebody already unlocked (THE LAW rule 2).
//   Scores     - per player, per machine: where they stand against that machine's objectives, and
//                a void for scores thrown while a board was broken. The void is an overlay applied
//                when numbers are DISPLAYED (js/stats-corrections.js); nothing is ever deleted.
//   This device - update check, bug inbox, device id, the dev-write opt-in, re-show announcements.
//
// WRITTEN FOR ONE READER. Matt, 2026-08-24: *"It's for me. I know what all the heading mean. I
// don't need 5 paragraphs explaining what live or admin only means."* So: no explanatory prose, no
// Default buttons (an override that matches the code default is the same thing, and the concept was
// only ever visible here), and every section is a COLLAPSED accordion so the page is four headings
// until he taps one - the score tools used to be a full screen of scrolling away.
//
// THE LAW (root CLAUDE.md): this screen writes nothing but `adminConfig/v1` (through
// admin-config.js) and two local preference keys. There is deliberately NO control here that
// deletes, resets or rewrites any player's stats, profile or history.
//
// BUILT ON css/ui.css's `.gh-*` primitives, like js/bug-report-ui.js.

import { GAMES } from './hub.js';
import { BOARDS, DEFAULT_BOARD, boardById } from '../skeeball/js/boards.js';
import { readGoals } from '../skeeball/js/goals.js';
import SK_STRINGS from '../skeeball/js/strings.js';
import { statsId } from './game-stats.js';
import { dayKey } from './arcade-scores.js';
import { aggregatePlayers, buildIdentity } from './players-agg.js';
import {
  readCachedConfig, refreshAdminConfig, resolveGameLive, resolveBoardMode, setGameLive,
  setBoardMode, resolveBoardCorrections, setSkeeballCorrection, corrections,
} from './admin-config.js';
import { correctionFor, snapshotOf } from './stats-corrections.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const skT = makeT(SK_STRINGS);          // the goal labels belong to Skeeball's own dictionary
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A GAMES entry's title in the active language (the registry holds either a string or {en,es}). */
function titleText(g) {
  const v = g.title;
  return typeof v === 'string' ? v : (v && (v[getLang()] || v.en)) || g.id;
}

/** Which accordion sections are open. A per-device preference, nothing more (rule 2's carve-out). */
const OPEN_KEY = 'gamehub.adminOpen.v1';
function openSections() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch { return new Set(); }
}
function rememberSection(id, open) {
  const s = openSections();
  if (open) s.add(id); else s.delete(id);
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); } catch { /* memory only */ }
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
  /* The modal itself does NOT scroll: the list inside it does, so the title and the status line
     stay put and the status line can never be pushed off the bottom edge. */
  .adm-modal { width: min(560px, 100%); max-height: 90vh; display: flex; flex-direction: column;
               overflow: hidden; }
  .adm-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
                margin: 0 calc(var(--gh-sp-4) * -1); padding: 0 var(--gh-sp-4); }
  /* --- accordion: four headings until one is tapped --- */
  .adm-sec { border-top: 1px solid var(--gh-border); }
  .adm-sec:last-of-type { border-bottom: 1px solid var(--gh-border); }
  .adm-sec > summary { display: flex; align-items: center; gap: var(--gh-sp-2); padding: var(--gh-sp-4) 0;
                       font-size: var(--gh-fs-md); font-weight: 800; color: var(--gh-ink);
                       cursor: pointer; list-style: none; min-height: 44px; }
  .adm-sec > summary::-webkit-details-marker { display: none; }
  .adm-sec > summary::after { content: '\\203A'; margin-left: auto; font-size: 22px; line-height: 1;
                              color: var(--gh-muted); transform: rotate(90deg); transition: transform .15s; }
  .adm-sec[open] > summary::after { transform: rotate(-90deg); }
  .adm-secbody { padding-bottom: var(--gh-sp-4); }
  .adm-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gh-sp-2);
             padding: var(--gh-sp-3) 0; border-top: 1px solid var(--gh-border); }
  .adm-row:first-child { border-top: 0; }
  .adm-row-main { flex: 1 1 200px; min-width: 0; }
  .adm-ctl { display: flex; align-items: center; gap: var(--gh-sp-2); margin-left: auto; }
  .adm-row--stack .adm-row-main { flex: 1 1 100%; }
  .adm-ctl--wide { flex: 1 1 100%; margin-left: 0; }
  .adm-ctl--wide .gh-seg { flex: 1 1 100%; }
  .adm-ctl--wide .gh-seg__item { flex: 1 1 0; }
  .adm-seg .gh-seg__item { font-size: var(--gh-fs-xs); padding: 0 var(--gh-sp-3); min-height: 40px; }
  .adm-name { font-size: var(--gh-fs-sm); font-weight: 700; color: var(--gh-ink); }
  .adm-note { margin-top: 2px; font-size: var(--gh-fs-xs); color: var(--gh-muted); line-height: 1.4; }
  .adm-voided { font-weight: 700; color: var(--gh-cb-teal); }
  /* --- players --- */
  .adm-player { padding: var(--gh-sp-3) 0; border-top: 1px solid var(--gh-border); }
  .adm-player:first-child { border-top: 0; }
  .adm-phead { font-size: var(--gh-fs-md); font-weight: 800; color: var(--gh-ink); }
  .adm-plife { margin-top: 2px; font-size: var(--gh-fs-xs); font-weight: 700; color: var(--gh-muted);
               font-variant-numeric: tabular-nums; }
  .adm-mach { margin-top: var(--gh-sp-3); padding-left: var(--gh-sp-3);
              border-left: 3px solid var(--gh-border); }
  .adm-mname { font-size: var(--gh-fs-sm); font-weight: 800; color: var(--gh-ink); }
  .adm-mnums { margin-top: 1px; font-size: var(--gh-fs-xs); color: var(--gh-muted);
               font-variant-numeric: tabular-nums; }
  /* One line per objective: label, progress, and a tick that is a SHAPE, not a colour (Matt is
     red/green colorblind - root CLAUDE.md's accessibility rule). */
  .adm-goals { list-style: none; margin: var(--gh-sp-2) 0 0; padding: 0; display: grid; gap: 2px; }
  .adm-goals li { display: flex; align-items: baseline; gap: var(--gh-sp-2); font-size: var(--gh-fs-xs);
                  color: var(--gh-muted); font-variant-numeric: tabular-nums; }
  .adm-goals b { margin-left: auto; font-weight: 800; color: var(--gh-ink); }
  .adm-goals li.is-met { color: var(--gh-ink); }
  .adm-goals li.is-met::before { content: '\\2713'; font-weight: 900; }
  .adm-goals li::before { content: '\\25CB'; font-size: 10px; }
  .adm-mact { display: flex; flex-wrap: wrap; gap: var(--gh-sp-2); margin-top: var(--gh-sp-2); }
  .adm-actions { display: flex; flex-wrap: wrap; gap: var(--gh-sp-2); }
  .adm-msg { flex: 0 0 auto; margin: var(--gh-sp-3) 0 0; min-height: 1.2em; font-size: var(--gh-fs-sm);
             font-weight: 600; line-height: 1.4; }
  .adm-msg.is-err { color: var(--gh-cb-vermilion); }
  .adm-msg.is-ok { color: var(--gh-cb-teal); }
  .adm-id { font-family: var(--gh-font-mono); font-size: var(--gh-fs-xs); word-break: break-all; }
  .adm-busy { opacity: .55; pointer-events: none; }`;
  document.head.appendChild(style);
}

// --- overlay ------------------------------------------------------------------------------------

let _host = null;
let _onKey = null;
let _busy = false;
/** Every synced device record, for the Scores section. {} when offline - the section then says so. */
let _players = {};

async function readPlayers() {
  try {
    const net = await import('./stats-net.js');
    return await net.readPlayersOnce();
  } catch { return {}; }
}

function closeOverlay() {
  if (_onKey) { document.removeEventListener('keydown', _onKey); _onKey = null; }
  if (_host) { _host.remove(); _host = null; }
}

/** Open the admin control page. js/hub.js gates the button on isAdmin(); this is a screen, not a lock. */
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
    <p class="adm-note">${esc(t('adm_loading'))}</p>`;
  card.querySelector('[data-role="close"]').addEventListener('click', () => closeOverlay());

  const [fresh, players] = await Promise.all([refreshAdminConfig(), readPlayers()]);
  _players = players;
  if (!_host) return;
  render(card, { offline: !fresh });
}

function render(card, opts = {}) {
  const cfg = readCachedConfig();
  const open = openSections();
  const sec = (id, title, body) => `<details class="adm-sec" data-sec="${id}"${open.has(id) ? ' open' : ''}>
      <summary>${esc(title)}</summary>
      <div class="adm-secbody">${body}</div>
    </details>`;
  card.innerHTML = `
    <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('adm_close'))}">&times;</button>
    <h2 class="gh-modal__title">🛠️ ${esc(t('adm_title'))}</h2>
    <div class="adm-scroll">
      ${sec('games', t('adm_games_title'), gamesSectionHTML(cfg))}
      ${sec('machines', t('adm_skeeball_title'), skeeballSectionHTML(cfg))}
      ${sec('scores', t('adm_sc_title'), scoresSectionHTML(cfg))}
      ${sec('device', t('adm_device_title'), deviceSectionHTML())}
    </div>
    <p class="adm-msg${opts.offline ? ' is-err' : ''}" data-role="msg">${opts.offline ? esc(t('adm_offline')) : ''}</p>`;
  card.querySelector('[data-role="close"]').addEventListener('click', () => closeOverlay());
  card.querySelectorAll('.adm-sec').forEach((d) =>
    d.addEventListener('toggle', () => rememberSection(d.dataset.sec, d.open)));
  wire(card);
}

/** The one status line. `kind` is 'ok' | 'err' | ''. */
function say(card, text, kind) {
  const el = card.querySelector('[data-role="msg"]');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-err', kind === 'err');
  el.classList.toggle('is-ok', kind === 'ok');
}

function segHTML(name, options, value) {
  return `<div class="gh-seg adm-seg" role="group" aria-label="${esc(name)}">`
    + options.map((o) => `<button type="button" class="gh-seg__item" role="button"
         aria-pressed="${o.value === value ? 'true' : 'false'}" data-set="${esc(String(o.value))}"
         >${esc(o.label)}</button>`).join('')
    + `</div>`;
}

// --- games --------------------------------------------------------------------------------------

function gamesSectionHTML(cfg) {
  return GAMES.slice().sort((a, b) => titleText(a).localeCompare(titleText(b))).map((g) => {
    const live = resolveGameLive(cfg, g.id, !g.devOnly);
    return `<div class="adm-row" data-game="${esc(g.id)}">
      <div class="adm-row-main"><div class="adm-name">${esc(titleText(g))}</div></div>
      <div class="adm-ctl">
        ${segHTML(titleText(g), [
          { value: 'live', label: t('adm_live') },
          { value: 'test', label: t('adm_testing') },
        ], live ? 'live' : 'test')}
      </div>
    </div>`;
  }).join('');
}

// --- skeeball machines ---------------------------------------------------------------------------

function skeeballSectionHTML(cfg) {
  return BOARDS.map((b) => {
    const first = b.id === DEFAULT_BOARD;
    const mode = resolveBoardMode(cfg, b.id, !!b.adminOnly);
    // Machine names are proper nouns and are never routed through t() (boards.js's standing rule).
    return `<div class="adm-row adm-row--stack" data-board="${esc(b.id)}">
      <div class="adm-row-main">
        <div class="adm-name">${esc(b.name)}</div>
        ${first ? `<div class="adm-note">${esc(t('adm_machine_first'))}</div>` : ''}
      </div>
      ${first ? '' : `<div class="adm-ctl adm-ctl--wide">
        ${segHTML(b.name, [
          { value: 'open', label: t('adm_mode_open') },
          { value: 'unlockable', label: t('adm_mode_unlockable') },
          { value: 'testing', label: t('adm_mode_testing') },
        ], mode)}
      </div>`}
    </div>`;
  }).join('');
}

// --- scores: one block per PLAYER, their objectives, and the void ---------------------------------

/**
 * One entry per person: their combined Skeeball record (corrections applied - what everyone
 * currently sees), the raw one, and the device-record ids behind them.
 *
 * Grouped by PERSON, not by device: Matt thinks in people, and a void has to reach every device a
 * person plays on or their other phone simply re-supplies the numbers on its next sync.
 */
function playerBlocks(cfg) {
  const all = _players || {};
  const ident = buildIdentity(all);
  const idsByKey = new Map();
  for (const id of Object.keys(all)) {
    const key = ident.keyFor((all[id] || {}).profile || {}, id);
    if (!idsByKey.has(key)) idsByKey.set(key, []);
    idsByKey.get(key).push(id);
  }
  const shown = new Map(aggregatePlayers(all, corrections()).map((g) => [g.key, g]));
  const raw = new Map(aggregatePlayers(all).map((g) => [g.key, g]));
  const out = [];
  for (const [key, ids] of idsByKey) {
    const s = shown.get(key), r = raw.get(key);
    if (!s || !r) continue;
    const skShown = ((s.games || {}).skeeball || {}).sk || {};
    const skRaw = ((r.games || {}).skeeball || {}).sk || {};
    const boards = Object.keys(skRaw.boards || {}).filter((id) => (skRaw.boards[id] || {}).plays | 0);
    if (!boards.length) continue;
    out.push({ key, ids, name: (s.name || '').trim() || t('adm_sc_unnamed'), skShown, skRaw, boards });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Is any of this person's device records voided on this machine? */
function voidedOn(cfg, ids, boardId) {
  return ids.some((id) => correctionFor(resolveBoardCorrections(cfg, id) || {}, boardId));
}

function goalsHTML(boardId, sk) {
  let goals = [];
  try { goals = readGoals(boardId, sk) || []; } catch { goals = []; }
  if (!goals.length) return '';
  return `<ul class="adm-goals">${goals.map((g) =>
    `<li class="${g.met ? 'is-met' : ''}">${esc(skT(g.labelKey))}<b>${g.now | 0} / ${g.target | 0}</b></li>`).join('')}</ul>`;
}

function scoresSectionHTML(cfg) {
  const blocks = playerBlocks(cfg);
  if (!blocks.length) return `<p class="adm-note">${esc(t('adm_sc_empty'))}</p>`;
  return blocks.map((p) => {
    const machines = p.boards.map((boardId) => {
      const bRaw = (p.skRaw.boards || {})[boardId] || {};
      const bShown = (p.skShown.boards || {})[boardId] || {};
      const isVoid = voidedOn(cfg, p.ids, boardId);
      const nums = t('adm_sc_nums', { plays: bShown.plays | 0, best: bShown.best | 0, points: bShown.points | 0 });
      const rawNums = isVoid
        ? `<div class="adm-note">${esc(t('adm_sc_was', { plays: bRaw.plays | 0, best: bRaw.best | 0, points: bRaw.points | 0 }))}</div>`
        : '';
      const b = boardById(boardId);
      return `<div class="adm-mach" data-score="${esc(p.key)}" data-board="${esc(boardId)}">
        <div class="adm-mname">${esc(b ? b.name : boardId)}</div>
        <div class="adm-mnums">${esc(nums)}</div>
        ${rawNums}
        ${goalsHTML(boardId, p.skShown)}
        <div class="adm-mact">
          ${isVoid ? `<button type="button" class="gh-btn gh-btn--sm" data-unvoid="1">${esc(t('adm_sc_undo'))}</button>` : ''}
          <button type="button" class="gh-btn gh-btn--sm${isVoid ? '' : ' gh-btn--danger'}" data-void="1">${
            esc(isVoid ? t('adm_sc_revoid') : t('adm_sc_void'))}</button>
        </div>
      </div>`;
    }).join('');
    const life = t('adm_sc_life', {
      best: p.skShown.bestGame | 0, points: p.skShown.points | 0,
      hundreds: p.skShown.hundreds | 0, plays: p.skShown.played | 0,
    });
    return `<div class="adm-player">
      <div class="adm-phead">${esc(p.name)}</div>
      <div class="adm-plife">${esc(life)}</div>
      ${machines}
    </div>`;
  }).join('');
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
  return `<div class="adm-actions">
      <button type="button" class="gh-btn gh-btn--sm" data-role="update">${esc(t('adm_update'))}</button>
      <button type="button" class="gh-btn gh-btn--sm" data-role="inbox">${esc(t('adm_inbox'))}</button>
      <button type="button" class="gh-btn gh-btn--sm" data-role="announce">${esc(t('adm_announce_reset'))}</button>
      <button type="button" class="gh-btn gh-btn--sm" data-role="copyid">${esc(t('adm_copy_id'))}</button>
      ${isDevOrigin() ? `<button type="button" class="gh-btn gh-btn--sm" data-role="devwrites">${
        esc(t(devWritesOn() ? 'adm_devwrites_off' : 'adm_devwrites_on'))}</button>` : ''}
    </div>
    <p class="adm-note adm-id">${esc(id || '?')}</p>`;
}

// --- wiring ----------------------------------------------------------------------------------------

function wire(card) {
  const scroll = card.querySelector('.adm-scroll');

  scroll.addEventListener('click', async (e) => {
    if (_busy) return;
    const seg = e.target.closest('.gh-seg__item');
    const gameRow = e.target.closest('[data-game]');
    const scoreRow = e.target.closest('[data-score]');
    const boardRow = scoreRow ? null : e.target.closest('[data-board]');

    let run = null;
    if (seg && gameRow) {
      run = () => setGameLive(gameRow.dataset.game, seg.dataset.set === 'live');
    } else if (seg && boardRow) {
      run = () => setBoardMode(boardRow.dataset.board, seg.dataset.set);
    } else if (scoreRow && (e.target.closest('[data-void]') || e.target.closest('[data-unvoid]'))) {
      const undo = !!e.target.closest('[data-unvoid]');
      const board = scoreRow.dataset.board;
      const block = playerBlocks(readCachedConfig()).find((p) => p.key === scoreRow.dataset.score);
      if (!block) return;
      // EVERY device this person plays on, not just one: a void that reached a single record would
      // be undone by their other phone's next sync (its own numbers are still whole).
      run = async () => {
        let last = { ok: true };
        for (const id of block.ids) {
          const raw = (((((_players[id] || {}).stats || {}).games || {}).skeeball || {}).sk || {}).boards || {};
          if (!undo && !raw[board]) continue;                 // this device never played it
          last = await setSkeeballCorrection(id, board, undo ? null : snapshotOf(raw[board], dayKey(Date.now())),
            undo ? '' : 'broken board');
          if (!last.ok) return last;
        }
        return last;
      };
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
