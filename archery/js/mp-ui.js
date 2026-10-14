// archery/js/mp-ui.js - the ONLINE screens: your matches, challenging someone, history, and the
// Game Over popup for a match that ended while you were away. DOM only; the data is archery/js/mp.js
// and the match itself is played in ui.js. Lazily imported. darts/js/mp-ui.js is the model.
//
// NOTHING HERE SCROLLS (docs/BUILDING-A-GAME.md, Part 0): every list is capped to what fits, and the
// player picker narrows by search instead of growing.
import { makeT } from '../../js/i18n.js';
import { onlineGateText } from '../../js/online-gate.js';
import { STRINGS } from './strings.js';

const t = makeT(STRINGS);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';

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

/** One page inside the online overlay. `back` is 'setup' or 'home'. Returns the body element. */
function page(ui, title, back, body) {
  const ov = ui.ov.mp;
  ov.innerHTML = `
    <div class="ar-card ar-mp" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="ar-mp-top">
        <button type="button" class="ar-mp-back" data-mp="back" aria-label="${esc(t('aria_back'))}">${BACK_SVG}</button>
        <h2 class="ar-h2 ar-mp-title">${esc(title)}</h2>
      </div>
      <div class="ar-mp-body">${body}</div>
    </div>`;
  ov.querySelector('[data-mp="back"]').addEventListener('click', () => {
    if (back === 'setup') ui._showSetup(); else home(ui, ui.MP);
  });
  ui.screen = 'mp';
  ui._showOnly('mp');
  return ov.querySelector('.ar-mp-body');
}

/** NO SCROLLING: drop rows from the end of `list` until the card fits, and say how many are not shown. */
function fitList(card, list, extra) {
  if (!card || !list) return;
  if (extra != null) { list.dataset.extra = String(extra | 0); list.dataset.dropped = '0'; }
  const boxes = [card, card.querySelector('.ar-mp-body'), list].filter(Boolean);
  const over = () => boxes.some((el) => el.scrollHeight > el.clientHeight + 1);
  let dropped = list.dataset.dropped | 0;
  const base = list.dataset.extra | 0;
  const paintNote = () => {
    let note = list.querySelector('.ar-mp-more');
    const n = base + dropped;
    if (n > 0 && !note) { note = document.createElement('p'); note.className = 'ar-mp-note ar-mp-more'; list.appendChild(note); }
    if (note) note.textContent = t('mp_more', { n });
  };
  paintNote();
  const rows = [...list.querySelectorAll('.ar-mrow')];
  while (over() && rows.length > 1) {
    rows.pop().remove();
    dropped++;
    for (const h of list.querySelectorAll('.ar-mp-h')) {
      const nx = h.nextElementSibling;
      if (!nx || !nx.classList.contains('ar-mrow')) h.remove();
    }
    paintNote();
  }
  list.dataset.dropped = String(dropped);
}
const cardOf = (el) => el.closest('.ar-mp');

const rowHTML = (r) => `
  <button type="button" class="ar-mrow${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
    <span class="ar-mrow-face" aria-hidden="true">${esc(r.emoji)}</span>
    <span class="ar-mrow-text"><span class="ar-mrow-name">${esc(r.name)}</span>
      <span class="ar-mrow-sub">${esc(t('mp_scores', { r: Math.min(r.round, 3), a: r.mine, b: r.theirs, name: r.name }))}</span></span>
    <span class="ar-mrow-chev" aria-hidden="true">›</span>
  </button>`;

/** The online home. */
export async function home(ui, MP) {
  const body = page(ui, t('mp_title'), 'setup', `
    <button type="button" class="gh-btn gh-btn--primary gh-btn--block ar-gobtn" data-mp="challenge">${esc(t('mp_challenge'))}</button>
    <button type="button" class="gh-btn gh-btn--block ar-alt" data-mp="pass">${esc(t('mp_pass'))}</button>
    <div class="ar-mp-push" hidden></div>
    <div class="ar-mp-list"><p class="ar-mp-note">${esc(t('mp_loading'))}</p></div>
    <button type="button" class="gh-btn gh-btn--block ar-alt" data-mp="history">${esc(t('mp_history'))}</button>`);
  body.querySelector('[data-mp="challenge"]').addEventListener('click', () => picker(ui, MP));
  body.querySelector('[data-mp="pass"]').addEventListener('click', () => ui._passPlay());
  body.querySelector('[data-mp="history"]').addEventListener('click', () => history(ui, MP));
  pushRow(body.querySelector('.ar-mp-push'), () => fitList(cardOf(body), body.querySelector('.ar-mp-list')));
  const rows = await MP.readMyGames();
  if (!body.isConnected) return;
  try { MP.recordFinished(rows); } catch (err) { console.warn('[archery] recordFinished', err); }
  const live = rows.filter((r) => !r.over);
  const mine = live.filter((r) => r.yourTurn), theirs = live.filter((r) => !r.yourTurn);
  const showMine = mine.slice(0, 8), showTheirs = theirs.slice(0, 12 - showMine.length);
  const hidden = live.length - showMine.length - showTheirs.length;
  const list = body.querySelector('.ar-mp-list');
  list.innerHTML = (mine.length ? `<h3 class="ar-mp-h">${esc(t('mp_your_turn'))} <span>${mine.length}</span></h3>${showMine.map(rowHTML).join('')}` : '')
    + (theirs.length ? `<h3 class="ar-mp-h">${esc(t('mp_their_turn'))} <span>${theirs.length}</span></h3>${showTheirs.map(rowHTML).join('')}` : '')
    + (live.length ? '' : `<p class="ar-mp-note">${esc(t('mp_none'))}</p>`);
  fitList(cardOf(body), list, hidden);
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.ar-mrow[data-id]');
    if (b) ui._openMatch(b.dataset.id);
  });
  showUnseen(ui, MP, rows);
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

/** Who to challenge: a search box and the first few names that match it. */
async function picker(ui, MP) {
  const body = page(ui, t('mp_challenge'), 'home', `
    <input type="search" class="gh-input ar-mp-search" placeholder="${esc(t('mp_search'))}" aria-label="${esc(t('mp_search'))}" autocomplete="off">
    <div class="ar-mp-list"><p class="ar-mp-note">${esc(t('mp_loading'))}</p></div>`);
  const opps = await MP.readOpponents();
  if (!body.isConnected) return;
  const list = body.querySelector('.ar-mp-list');
  const SHOW = 10;
  const paint = (q) => {
    const k = String(q || '').trim().toLowerCase();
    const all = opps.filter((o) => !k || o.name.toLowerCase().includes(k));
    list.innerHTML = all.length ? all.slice(0, SHOW).map((o) => `
      <button type="button" class="ar-mrow" data-code="${esc(o.code)}">
        <span class="ar-mrow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="ar-mrow-text"><span class="ar-mrow-name">${esc(o.name)}</span></span>
        <span class="ar-mrow-chev" aria-hidden="true">›</span>
      </button>`).join('') : `<p class="ar-mp-note">${esc(t('mp_no_opp'))}</p>`;
    if (all.length) fitList(cardOf(list), list, Math.max(0, all.length - SHOW));
  };
  paint('');
  body.querySelector('.ar-mp-search').addEventListener('input', (e) => paint(e.target.value));
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.ar-mrow');
    const o = b && opps.find((x) => x.code === b.dataset.code);
    if (o) confirm(ui, MP, o);
  });
}

/** One tap to send. Exported for the hub's Challenges screen. */
export function challengeTo(ui, MP, them) { confirm(ui, MP, them); }
function confirm(ui, MP, them) {
  const body = page(ui, t('mp_challenge'), 'home', `
    <p class="ar-mp-vs"><span aria-hidden="true">${esc(them.emoji)}</span> ${esc(them.name)}</p>
    <p class="ar-mp-note">${esc(t('mp_note'))}</p>
    <button type="button" class="gh-btn gh-btn--primary gh-btn--block ar-gobtn" data-mp="send">${esc(t('mp_send', { name: them.name }))}</button>
    <p class="ar-mp-note ar-mp-err" aria-live="polite" hidden></p>`);
  const send = body.querySelector('[data-mp="send"]');
  send.addEventListener('click', async () => {
    send.disabled = true;
    const res = await ui._sendChallenge(them);
    if (res && !res.ok && body.isConnected) {
      const err = body.querySelector('.ar-mp-err');
      err.textContent = reasonText(res.reason);
      err.hidden = false;
      send.disabled = false;
    }
  });
}

/** Finished matches: a record per opponent, then the latest matches. */
async function history(ui, MP) {
  const body = page(ui, t('mp_history'), 'home', `<div class="ar-mp-list"><p class="ar-mp-note">${esc(t('mp_loading'))}</p></div>`);
  const rows = await MP.readMyGames();
  if (!body.isConnected) return;
  const { opponents, finished } = MP.recordsFrom(rows, MP.myCode());
  const list = body.querySelector('.ar-mp-list');
  if (!finished.length) { list.innerHTML = `<p class="ar-mp-note">${esc(t('mp_no_history'))}</p>`; return; }
  const word = (r) => (r.result === 'won' ? (r.resigned === 'them' ? t('mp_won_quit') : t('mp_won')) : (r.resigned === 'me' ? t('mp_you_quit') : t('mp_lost')));
  // Won and lost are told apart by a mark (check, cross), never by colour alone.
  const mark = (r) => (r.result === 'won' ? '✓' : '✗');
  const opp = opponents.slice(0, 3), fin = finished.slice(0, 10);
  list.innerHTML = `<h3 class="ar-mp-h">${esc(t('mp_records'))}</h3>` + opp.map((o) => `
      <div class="ar-mrow is-static">
        <span class="ar-mrow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="ar-mrow-text"><span class="ar-mrow-name">${esc(o.name)}</span></span>
        <span class="ar-rec"><b>${o.won}</b>-<b>${o.lost}</b></span>
      </div>`).join('')
    + `<h3 class="ar-mp-h">${esc(t('mp_matches'))}</h3>` + fin.map((r) => `
      <div class="ar-mrow is-static${r.result === 'won' ? ' is-won' : ''}">
        <span class="ar-hmark" aria-hidden="true">${mark(r)}</span>
        <span class="ar-mrow-text"><span class="ar-mrow-name">${esc(r.name)}</span>
          <span class="ar-mrow-sub">${esc([word(r), t('mp_scores_done', { a: r.mine, b: r.theirs, name: r.name }), new Date(r.updated).toLocaleDateString()].join(' · '))}</span></span>
      </div>`).join('');
  fitList(cardOf(list), list, finished.length - fin.length);
}

/** GAME OVER, for a match that ended while this phone was away. */
export function showUnseen(ui, MP, rows) {
  const ids = MP.readUnseen();
  const ended = (rows || []).filter((r) => r.over && ids.includes(r.id)).sort((a, b) => b.updated - a.updated);
  if (!ended.length || ui.root.querySelector('.ar-unseen')) return;
  const r = ended[0];
  const won = r.result === 'won';
  const el = document.createElement('div');
  el.className = 'ar-ov ar-unseen';
  el.innerHTML = `
    <div class="ar-card ar-card-sm" role="dialog" aria-modal="true" aria-label="${esc(t('mp_game_over'))}">
      <button type="button" class="ar-x" data-mp="close" aria-label="${esc(t('aria_close'))}">${X_SVG}</button>
      <p class="ar-res-ava" aria-hidden="true">${esc(r.emoji)}</p>
      <h2 class="ar-h2">${esc(won ? t('win_you') : t('lose_you'))}</h2>
      <p class="ar-res-line">${esc(t(won ? 'mp_you_won_vs' : 'mp_you_lost_vs', { name: r.name }))}${r.why === 'resign' ? ` · ${esc(won ? t('mp_they_resigned', { name: r.name }) : t('mp_you_resigned'))}` : ` · ${esc(t('result_line', { a: r.mine, b: r.theirs }))}`}</p>
      ${ended.length > 1 ? `<p class="ar-res-line">${esc(t('mp_more', { n: ended.length - 1 }))}</p>` : ''}
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-mp="ok">${esc(t('mp_ok'))}</button>
    </div>`;
  ui.root.appendChild(el);
  const done = () => { for (const x of ended) MP.markResultSeen(x.id); el.remove(); };
  el.querySelector('[data-mp="ok"]').addEventListener('click', done);
  el.querySelector('[data-mp="close"]').addEventListener('click', done);
}

export default { home, showUnseen, reasonText };
