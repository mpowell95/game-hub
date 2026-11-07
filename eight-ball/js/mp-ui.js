// eight-ball/js/mp-ui.js - the ONLINE screens (Stage 2, 2026-10-22): your matches, challenging one
// person (or two, for Cutthroat), history, and the Game Over popup for a match that ended while you
// were away. Flick Soccer's mp-ui.js is the model. DOM only; the data is eight-ball/js/mp.js and the
// match itself is played in ui.js. Lazily imported, so a player who never opens online play
// downloads none of it.
//
// NOTHING HERE SCROLLS (docs/BUILDING-A-GAME.md, Part 0): every list is capped to what fits, and the
// player picker narrows by search instead of growing.
import { makeT, getLang } from '../../js/i18n.js';
import { onlineGateText } from '../../js/online-gate.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';
import { STRINGS } from './strings.js';
import { seatsOf, MODES, RACK_OPTIONS } from './engine.js';

const t = makeT(STRINGS);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const AIDS = ['easy', 'medium', 'hard'];
const OPTS = ['call', 'bank', 'obst'];

export function reasonText(reason) {
  const gate = onlineGateText(reason);
  if (gate) return gate;
  if (reason === 'denied') return t('mp_denied');
  if (reason === 'offline') return t('mp_offline');
  if (reason === 'dev-origin-blocked') return t('mp_dev');
  if (reason === 'no-player-code') return t('mp_no_code');
  if (reason === 'expired') return t('mp_expired');
  return t('mp_send_failed');
}

/** One page inside the online overlay. `back` is 'setup', 'home' or a function. Returns the body. */
function page(ui, title, back, body) {
  const ov = ui.ov.mp;
  ov.innerHTML = `
    <div class="ep-card ep-mp" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="ep-mp-top">
        <button type="button" class="ep-mp-back" data-mp="back" aria-label="${esc(t('aria_back'))}">${BACK_SVG}</button>
        <h2 class="ep-h2 ep-mp-title">${esc(title)}</h2>
      </div>
      <div class="ep-mp-body">${body}</div>
    </div>`;
  ov.querySelector('[data-mp="back"]').addEventListener('click', () => {
    if (typeof back === 'function') back();
    else ui._showSetup('online');       // 'home' and 'setup' both lead to the setup screen's Online tab (2026-11-07)
  });
  ui.screen = 'mp';
  ui._showOnly('mp');
  return ov.querySelector('.ep-mp-body');
}

/** NO SCROLLING: drop rows from the end of `list` until the card fits, and say how many are not
 *  shown (a button on a list that pages). Measured, because the room depends on the phone. */
function fitList(card, list, extra) {
  if (!card || !list) return;
  if (extra != null) { list.dataset.extra = String(extra | 0); list.dataset.dropped = '0'; }
  const boxes = [card, card.querySelector('.ep-mp-body'), list].filter(Boolean);
  const over = () => boxes.some((el) => el.scrollHeight > el.clientHeight + 1);
  let dropped = list.dataset.dropped | 0;
  const base = list.dataset.extra | 0;
  const paintNote = () => {
    let note = list.querySelector('.ep-mp-more');
    const n = base + dropped;
    if (n > 0 && !note) {
      note = document.createElement(list.dataset.pages === '1' ? 'button' : 'p');
      if (note.tagName === 'BUTTON') { note.type = 'button'; note.dataset.mp = 'more'; }
      note.className = 'ep-mp-note ep-mp-more';
      list.appendChild(note);
    }
    if (note) note.textContent = t('mp_more', { n });
  };
  paintNote();
  let rows = [...list.querySelectorAll('.ep-mrow')];
  while (over() && rows.length > 1) {
    rows.pop().remove();
    dropped++;
    for (const h of list.querySelectorAll('.ep-mp-h')) {
      const nx = h.nextElementSibling;
      if (!nx || !nx.classList.contains('ep-mrow')) h.remove();
    }
    paintNote();
  }
  list.dataset.dropped = String(dropped);
}
const cardOf = (el) => el.closest('.ep-mp');
/** A match row's second line: the game, and the racks score when there is more than one. */
const subLine = (r) => [t('mode_' + r.mode), r.racks > 1 ? t('mp_racks_score', { a: r.mine, b: r.theirs, n: r.racks }) : ''].filter(Boolean).join(' · ');
const rowHTML = (r) => `
  <button type="button" class="ep-mrow${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
    <span class="ep-mrow-face" aria-hidden="true">${esc(r.emoji)}</span>
    <span class="ep-mrow-text"><span class="ep-mrow-name">${esc(r.name)}</span>
      <span class="ep-mrow-sub">${esc(subLine(r))}</span></span>
    <span class="ep-mrow-chev" aria-hidden="true">›</span>
  </button>`;

/**
 * THE SETUP SCREEN'S ONLINE TAB (2026-11-07, Cup Pong's tabs, Matt: "Do the same tabs for the other
 * multiplayer games"): the matches going (your turn first, with Play), then Challenge: Anyone (the full
 * list) and the people played most recently, one tap each.
 * The record chip opens History. Fills `box`; returns { active, mine } or null if the screen moved on.
 */
export async function fillOnline(ui, MP, box) {
  const rows = await MP.readMyGames();
  if (!box.isConnected) return null;
  try { MP.recordFinished(rows); } catch (err) { console.warn('[eight-ball] recordFinished', err); }
  const live = rows.filter((r) => !r.over);
  const mine = live.filter((r) => r.yourTurn), theirs = live.filter((r) => !r.yourTurn);
  const all = mine.concat(theirs);
  const seen = new Set();
  // Most recent first, one face per person; an index into this list, never a code, in the page.
  const recent = rows.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .filter((r) => r.with && !r.with2 && !seen.has(r.with) && seen.add(r.with))
    .slice(0, 4).map((r) => ({ code: r.with, name: r.name, emoji: r.emoji }));
  let won = 0, lost = 0;
  try { for (const o of MP.recordsFrom(rows, MP.myCode()).opponents) { won += o.won | 0; lost += o.lost | 0; } } catch { /* no chip */ }
  const chip = won + lost ? `<button type="button" class="ep-rec-chip" data-mp="history">${won}-${lost}</button>` : '';
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || n;
  const liveRow = (r) => `
    <button type="button" class="ep-mrow${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
      <span class="ep-mrow-face" aria-hidden="true">${esc(r.emoji)}</span>
      <span class="ep-mrow-text"><span class="ep-mrow-name">${esc(r.name)}</span>
        <span class="ep-mrow-sub">${esc(r.yourTurn ? subLine(r) : [t('mp_turn_of', { name: r.name }), t('mode_' + r.mode)].join(' · '))}</span></span>
      ${r.yourTurn ? `<span class="ep-play-pill">${esc(t('mp_play'))}</span>` : '<span class="ep-mrow-chev" aria-hidden="true">›</span>'}
    </button>`;
  box.innerHTML = (live.length ? `
      <div class="ep-on-sec">
        <div class="ep-on-head"><span>${esc(t('mp_matches'))}</span>${chip}</div>
        <div class="ep-on-rows"></div>
      </div>` : '') + `
      <div class="ep-on-sec">
        <div class="ep-on-head"><span>${esc(t('mp_challenge_h'))}</span>${live.length ? '' : chip}</div>
        <div class="ep-faces">
          <button type="button" class="ep-face is-any" data-mp="anyone"><span class="ep-face-dot" aria-hidden="true">+</span><span class="ep-face-name">${esc(t('mp_anyone'))}</span></button>
          ${recent.map((o, i) => `<button type="button" class="ep-face" data-oi="${i}"><span class="ep-face-dot" aria-hidden="true">${esc(o.emoji)}</span><span class="ep-face-name">${esc(first(o.name))}</span></button>`).join('')}
        </div>
      </div>
      <div class="ep-mp-push" hidden></div>`;
  // Pages, not a scroll (the setup card never scrolls): as many rows as fit, then "+N more" shows the
  // next page, and the last page goes back to the first. Every match is reachable.
  const rowsEl = box.querySelector('.ep-on-rows');
  let start = 0;
  box._paint = () => {
    if (!rowsEl) return;
    const ov = box.closest('[data-ov="setup"]'), card = ov && ov.querySelector('.ep-card');
    rowsEl.innerHTML = all.slice(start).map(liveRow).join('');
    const els = [...rowsEl.querySelectorAll('.ep-mrow')];
    const over = () => card && card.getBoundingClientRect().bottom > ov.clientHeight - 8;
    const room = () => { while (over() && els.length > 1) els.pop().remove(); };
    room();
    let shown = els.length;
    if (start > 0 || start + shown < all.length) {
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'ep-more'; more.dataset.mp = 'more';
      more.textContent = t('mp_more', { n: all.length - shown });
      rowsEl.appendChild(more);
      if (over() && els.length > 1) { els.pop().remove(); shown--; more.textContent = t('mp_more', { n: all.length - shown }); }
    }
    rowsEl.dataset.shown = String(shown);
  };
  box.onclick = (e) => {
    const m = e.target.closest('.ep-mrow[data-id]');
    if (m) { ui._openMatch(m.dataset.id); return; }
    const a = e.target.closest('[data-mp]');
    if (a) {
      const k = a.dataset.mp;
      if (k === 'history') history(ui, MP);
      else if (k === 'anyone') picker(ui, MP, [], (o) => confirm(ui, MP, [o]));
      else if (k === 'more') {
        const shown = Number(rowsEl.dataset.shown) || 1;
        start = start + shown >= all.length ? 0 : start + shown;
        box._paint();
      }
      return;
    }
    const f = e.target.closest('.ep-face[data-oi]');
    const them = f && recent[Number(f.dataset.oi)];
    if (them) confirm(ui, MP, [them]);
  };
  pushRow(box.querySelector('.ep-mp-push'), () => fitOnline(ui));
  showUnseen(ui, MP, rows);
  fitOnline(ui);
  return { active: live.length > 0, mine: mine.length };
}

/** NO SCROLLING: re-lay the matches list so the setup card fits (only while the Online tab is shown). */
export function fitOnline(ui) {
  const ov = ui.root.querySelector('[data-ov="setup"]');
  const box = ov && ov.querySelector('[data-role="online"]');
  const panel = ov && ov.querySelector('[data-panel="online"]');
  if (!box || !box._paint || ov.hidden || panel.hidden) return;
  box._paint();
}

/** "Notify me when it is my turn" - only while notifications are off on this phone. */
async function pushRow(box, onShown) {
  try {
    const P = await import('../../js/push.js');
    const st = await P.pushState();
    if (st !== 'off' || !box.isConnected) return;
    box.innerHTML = `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block">${esc(t('mp_notify'))}</button>`;
    box.hidden = false;
    if (onShown) onShown();
    box.querySelector('button').addEventListener('click', async () => {
      const res = await P.enablePush();
      if (res && res.ok) box.hidden = true;
    });
  } catch { /* no push on this phone: nothing to offer */ }
}

/** Who to challenge: a search box and the first few names that match it. `exclude`: codes already
 *  picked (Cutthroat's second player). */
async function picker(ui, MP, exclude, onPick, back = 'home') {
  const body = page(ui, t(exclude.length ? 'mp_add_player' : 'mp_challenge'), back, `
    <input type="search" class="gh-input ep-mp-search" placeholder="${esc(t('mp_search'))}" aria-label="${esc(t('mp_search'))}" autocomplete="off">
    <div class="ep-mp-list"><p class="ep-mp-note">${esc(t('mp_loading'))}</p></div>`);
  const opps = (await MP.readOpponents()).filter((o) => !exclude.includes(o.code));
  if (!body.isConnected) return;
  const list = body.querySelector('.ep-mp-list');
  const SHOW = 10;
  const paint = (q) => {
    const k = String(q || '').trim().toLowerCase();
    const all = opps.filter((o) => !k || o.name.toLowerCase().includes(k));
    list.innerHTML = all.length ? all.slice(0, SHOW).map((o) => `
      <button type="button" class="ep-mrow" data-oi="${opps.indexOf(o)}">
        <span class="ep-mrow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="ep-mrow-text"><span class="ep-mrow-name">${esc(o.name)}</span></span>
        <span class="ep-mrow-chev" aria-hidden="true">›</span>
      </button>`).join('') : `<p class="ep-mp-note">${esc(t('mp_no_opp'))}</p>`;
    if (all.length) fitList(cardOf(list), list, Math.max(0, all.length - SHOW));
  };
  paint('');
  body.querySelector('.ep-mp-search').addEventListener('input', (e) => paint(e.target.value));
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.ep-mrow');
    const o = b && opps[Number(b.dataset.oi)];
    if (o) onPick(o);
  });
}

/** The hub's Multiplayer screen hands over a person: open the challenge card with them. */
export function challengeTo(ui, MP, them) { confirm(ui, MP, [them]); }

/** The challenge card: who, the game (8-Ball / 9-Ball / Cutthroat, which needs a second person),
 *  racks, the options, the aiming help for everybody, Send. Every choice is the setup card's own
 *  setting, so the two never disagree. */
function confirm(ui, MP, people) {
  const s = ui.settings;
  const need = seatsOf(s.game) - 1;
  const who = people.slice(0, need);
  const body = page(ui, t('mp_new_ch'), 'home', `
    <div class="ep-mp-whos">${who.map((o) => `<p class="ep-mp-who"><span class="ep-mp-face" aria-hidden="true">${esc(o.emoji || '🙂')}</span><b>${esc(o.name || '?')}</b></p>`).join('')}
      ${who.length < need ? `<button type="button" class="ep-mrow ep-mp-add" data-mp="add"><span class="ep-mrow-face" aria-hidden="true">＋</span><span class="ep-mrow-text"><span class="ep-mrow-name">${esc(t('mp_add_player'))}</span></span></button>` : ''}</div>
    <div class="gh-seg ep-seg" role="group" aria-label="${esc(t('aria_mode'))}">${MODES.map((m) => `<button type="button" class="gh-seg__item ep-seg-item" data-chgame="${m}" aria-pressed="${s.game === m}"><span>${esc(t('mode_' + m))}</span></button>`).join('')}</div>
    <div class="ep-row"><span class="ep-label">${esc(t('racks'))}</span><div class="gh-seg ep-seg ep-seg-racks" role="group" aria-label="${esc(t('racks'))}">${RACK_OPTIONS.map((n) => `<button type="button" class="gh-seg__item ep-seg-item" data-chracks="${n}" aria-pressed="${s.racks === n}"><span>${n}</span></button>`).join('')}</div></div>
    <div class="ep-opts" role="group" aria-label="${esc(t('aria_opts'))}">${OPTS.map((k) => `<button type="button" class="ep-opt" data-chopt="${k}" aria-pressed="${!!s.opts[k]}">${ui.optSVG(k)}<span>${esc(t('opt_' + k))}</span></button>`).join('')}</div>
    <div class="ep-field"><span class="ep-label">${esc(t('aim_help'))}</span>
      <div class="gh-seg ep-seg" role="group" aria-label="${esc(t('aim_help'))}">${AIDS.map((id) => `<button type="button" class="gh-seg__item ep-seg-item" data-chaid="${id}" aria-pressed="${s.aimHelp === id}">${diffShapeSVG(tierOf(id))}<span>${esc(t('diff_' + id))}</span></button>`).join('')}</div>
      <p class="ep-aid-note">${esc(t('aid_' + s.aimHelp))}</p></div>
    <button type="button" class="gh-btn gh-btn--primary gh-btn--block ep-go" data-mp="send"${who.length < need ? ' disabled' : ''}>${esc(t('mp_send_ch'))}</button>
    <p class="ep-mp-note ep-mp-err" aria-live="polite" hidden></p>`);
  const redraw = () => confirm(ui, MP, people);
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-chgame], [data-chracks], [data-chopt], [data-chaid], [data-mp]');
    if (!b) return;
    if (b.dataset.chgame) { s.game = b.dataset.chgame; ui._saveSettings(); redraw(); return; }
    if (b.dataset.chracks) { s.racks = +b.dataset.chracks; ui._saveSettings(); redraw(); return; }
    if (b.dataset.chopt) { s.opts[b.dataset.chopt] = !s.opts[b.dataset.chopt]; ui._saveSettings(); redraw(); return; }
    if (b.dataset.chaid) { s.aimHelp = b.dataset.chaid; ui._saveSettings(); redraw(); return; }
    if (b.dataset.mp === 'add') { picker(ui, MP, who.map((o) => o.code), (o) => confirm(ui, MP, who.concat([o])), redraw); return; }
    if (b.dataset.mp !== 'send') return;
    b.disabled = true;
    const res = await ui._sendChallenge(who);
    if (res && !res.ok && body.isConnected) {
      const err = body.querySelector('.ep-mp-err');
      err.textContent = reasonText(res.reason);
      err.hidden = false;
      b.disabled = false;
    }
  });
}

/** Finished matches: a record per opponent, then the latest matches. */
async function history(ui, MP) {
  const body = page(ui, t('mp_history'), 'home', `<div class="ep-mp-list"><p class="ep-mp-note">${esc(t('mp_loading'))}</p></div>`);
  const rows = await MP.readMyGames();
  if (!body.isConnected) return;
  const { opponents, finished } = MP.recordsFrom(rows, MP.myCode());
  const list = body.querySelector('.ep-mp-list');
  if (!finished.length) { list.innerHTML = `<p class="ep-mp-note">${esc(t('mp_no_history'))}</p>`; return; }
  const word = (r) => (r.result === 'won' ? t('mp_won') : t('mp_lost')) + (r.timedOut ? ` (${t('mp_timed_out_word')})` : r.resigned ? ` (${t('mp_resigned_word')})` : '');
  // Win and loss are told apart by a mark (check, cross), never by colour alone.
  const mark = (r) => (r.result === 'won' ? '✓' : '✗');
  const opp = opponents.slice(0, 3), fin = finished.slice(0, 10);
  list.innerHTML = `<h3 class="ep-mp-h">${esc(t('mp_records'))}</h3>` + opp.map((o) => `
      <div class="ep-mrow is-static">
        <span class="ep-mrow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="ep-mrow-text"><span class="ep-mrow-name">${esc(o.name)}</span></span>
        <span class="ep-rec"><b>${o.won}</b>-<b>${o.lost}</b></span>
      </div>`).join('')
    + `<h3 class="ep-mp-h">${esc(t('mp_matches'))}</h3>` + fin.map((r) => `
      <div class="ep-mrow is-static${r.result === 'won' ? ' is-won' : ''}">
        <span class="ep-hmark" aria-hidden="true">${mark(r)}</span>
        <span class="ep-mrow-text"><span class="ep-mrow-name">${esc(r.name)}</span>
          <span class="ep-mrow-sub">${esc([t('mode_' + r.mode), word(r), new Date(r.updated).toLocaleDateString(getLang() === 'es' ? 'es-ES' : undefined)].join(' · '))}</span></span>
      </div>`).join('');
  fitList(cardOf(list), list, finished.length - fin.length);
}

/** GAME OVER, for a match that ended while this phone was away (Hoops' lesson, 2026-09-24). */
export function showUnseen(ui, MP, rows) {
  const ids = MP.readUnseen();
  const ended = (rows || []).filter((r) => r.over && ids.includes(r.id)).sort((a, b) => b.updated - a.updated);
  if (!ended.length || ui.root.querySelector('.ep-unseen')) return;
  const r = ended[0];
  const won = r.result === 'won';
  const me = (MP.meLabel() || {}).name || '';
  const el = document.createElement('div');
  el.className = 'ep-ov ep-unseen';
  el.innerHTML = `
    <div class="ep-card ep-card-sm" role="dialog" aria-modal="true" aria-label="${esc(t('mp_game_over'))}">
      <button type="button" class="ep-x" data-mp="close" aria-label="${esc(t('aria_close'))}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg></button>
      <p class="ep-res-ava" aria-hidden="true">${esc(won ? (MP.meLabel() || {}).emoji : r.emoji)}</p>
      <h2 class="ep-h2">${esc(won ? t('win_name', { name: me || '?' }) : t('mp_game_over'))}</h2>
      <p class="ep-res-line ep-res-small">${esc([t('mode_' + r.mode), r.name].join(' · '))}${r.why === 'timeout' ? ` · ${esc(t('mp_timed_out_word'))}` : r.why === 'resign' ? ` · ${esc(t('mp_resigned_word'))}` : ''}</p>
      ${ended.length > 1 ? `<p class="ep-res-line ep-res-small">${esc(t('mp_more', { n: ended.length - 1 }))}</p>` : ''}
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-mp="ok">${esc(t('mp_ok'))}</button>
    </div>`;
  ui.root.appendChild(el);
  const done = () => { for (const x of ended) MP.markResultSeen(x.id); el.remove(); };
  el.querySelector('[data-mp="ok"]').addEventListener('click', done);
  el.querySelector('[data-mp="close"]').addEventListener('click', done);
}

export default { fillOnline, fitOnline, showUnseen, reasonText, challengeTo };
