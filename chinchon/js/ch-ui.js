// chinchon/js/ch-ui.js - the CHALLENGE screens (2026-10-18): your matches, who to challenge, how
// long a match. DOM only; the data is chinchon/js/mp.js and the match itself is played on the table
// in ui.js. Lazily imported, so a player who never opens Challenge downloads none of it. Darts'
// mp-ui.js is the model.
//
// It all lives INSIDE the setup card, under the Solo / Host / Join / Challenge switch, so nothing
// new has to fit above it. FEWEST WORDS (root CLAUDE.md): names, numbers, one word per button.
// NOTHING HERE SCROLLS: every list is cut to what fits, with "+N more".
import { makeT, myName } from '../../js/i18n.js';
import { onlineGateText } from '../../js/online-gate.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

export function reasonText(reason) {
  const gate = onlineGateText(reason);
  if (gate) return gate;
  if (reason === 'denied') return t('ch_denied');
  if (reason === 'offline') return t('ch_offline');
  if (reason === 'dev-origin-blocked') return t('ch_dev');
  if (reason === 'expired') return t('ch_expired');
  if (reason === 'not-found') return t('ch_not_found');
  return t('ch_failed');
}

/** '1 hand' / '50 points' / '100 points'. */
export const lenLabel = (len) => (len === '50' || len === '100' ? t('ch_len_pts', { n: len }) : t('ch_len_hand'));

/** NO SCROLLING: drop rows from the end of `list` until the page fits, and say how many are not
 *  shown. Measured, because the room left depends on the phone and the hub's chrome. */
function fitList(list, extra = null) {
  if (!list || !list.isConnected) return;
  const de = document.documentElement;
  const over = () => de.scrollHeight > window.innerHeight + 1;
  // Safe to call again when something above the list appears later ("Notify me"): the count of
  // rows not shown is kept on the list itself.
  if (extra != null) { list.dataset.extra = String(extra | 0); list.dataset.dropped = '0'; }
  let dropped = list.dataset.dropped | 0;
  const base = list.dataset.extra | 0;
  const note = () => {
    let el = list.querySelector('.cc-ch-more');
    const n = base + dropped;
    if (n > 0 && !el) { el = document.createElement('p'); el.className = 'cc-ch-note cc-ch-more'; list.appendChild(el); }
    if (el) el.textContent = t('ch_more', { n });
  };
  note();
  let rows = [...list.querySelectorAll('.cc-ch-row')];
  while (over() && rows.length > 1) {
    rows.pop().remove();
    dropped++;
    for (const h of list.querySelectorAll('.cc-ch-h')) {
      const nx = h.nextElementSibling;
      if (!nx || !nx.classList.contains('cc-ch-row')) h.remove();
    }
    note();
  }
  list.dataset.dropped = String(dropped);
}

const top = (title) => `<div class="cc-ch-top">
    <button type="button" class="cc-ch-back" data-ch="back" aria-label="${esc(t('ch_back_aria'))}">${BACK_SVG}</button>
    <h2 class="cc-ch-title">${title}</h2></div>`;

/** One match on the list. Your turn: an accent border AND a "›" play arrow (never colour alone). */
function rowHTML(r) {
  const me = myName();
  const scored = r.mine || r.theirs || r.round > 1;
  const sub = [lenLabel(r.kind)].concat(scored ? [`${me} ${r.mine} · ${r.name || '?'} ${r.theirs}`] : []).join(' · ');
  return `<button type="button" class="cc-ch-row${r.yourTurn ? ' is-mine' : ''}" data-ch="open" data-id="${esc(r.id)}">
    <span class="cc-ch-face" aria-hidden="true">${esc(r.emoji)}</span>
    <span class="cc-ch-text"><span class="cc-ch-name">${esc(r.name || '?')}</span><span class="cc-ch-sub">${esc(sub)}</span></span>
    <span class="cc-ch-chev" aria-hidden="true">${r.yourTurn ? '▶' : '›'}</span>
  </button>`;
}

/** The home: New challenge, then your matches (yours first). */
export async function home(ui, MP, box) {
  box.innerHTML = `
    <button type="button" class="cc-btn cc-btn-primary cc-ch-go" data-ch="new">${esc(t('ch_new'))}</button>
    <div class="cc-ch-push" hidden></div>
    <div class="cc-ch-list"><p class="cc-ch-note">…</p></div>`;
  const list = box.querySelector('.cc-ch-list');
  pushRow(box.querySelector('.cc-ch-push'));
  const rows = await MP.readMyGames();
  if (!box.isConnected) return;
  try { MP.recordFinished(rows); } catch (err) { console.warn('[chinchon] recordFinished', err); }
  const live = rows.filter((r) => !r.over);
  const mine = live.filter((r) => r.yourTurn), theirs = live.filter((r) => !r.yourTurn);
  const showMine = mine.slice(0, 8), showTheirs = theirs.slice(0, 10 - showMine.length);
  const hidden = live.length - showMine.length - showTheirs.length;
  list.innerHTML = (mine.length ? `<h3 class="cc-ch-h">${esc(t('ch_your_turn'))} <span>${mine.length}</span></h3>${showMine.map(rowHTML).join('')}` : '')
    + (theirs.length ? `<h3 class="cc-ch-h">${esc(t('ch_waiting_h'))} <span>${theirs.length}</span></h3>${showTheirs.map(rowHTML).join('')}` : '')
    + (live.length ? '' : `<p class="cc-ch-note">${esc(t('ch_none'))}</p>`);
  fitList(list, hidden);
  showUnseen(ui, MP, rows);
}

/** "Notify me" - only while notifications are off on this phone. */
async function pushRow(el) {
  try {
    const P = await import('../../js/push.js');
    const st = await P.pushState();
    if (st !== 'off' || !el.isConnected) return;
    el.innerHTML = `<button type="button" class="cc-btn cc-btn-ghost cc-ch-go">${esc(t('ch_notify'))}</button>`;
    el.hidden = false;
    const list = el.parentNode && el.parentNode.querySelector('.cc-ch-list');
    if (list && list.dataset.extra != null) fitList(list);
    el.querySelector('button').addEventListener('click', async () => {
      const res = await P.enablePush();
      if (res && res.ok) el.hidden = true;
    });
  } catch { /* no push on this phone: nothing to offer */ }
}

/** Who to challenge: a search box and the names that match it. */
export async function picker(ui, MP, box) {
  box.innerHTML = `${top(esc(t('ch_new')))}
    <input type="search" class="cc-ch-search" data-role="ch-search" placeholder="${esc(t('ch_search'))}" aria-label="${esc(t('ch_search'))}" autocomplete="off">
    <div class="cc-ch-list"><p class="cc-ch-note">…</p></div>`;
  const opps = await MP.readOpponents();
  if (!box.isConnected) return;
  ui._chPeople = opps;
  const list = box.querySelector('.cc-ch-list');
  const SHOW = 10;
  const paint = (q) => {
    const k = String(q || '').trim().toLowerCase();
    const all = opps.filter((o) => !k || o.name.toLowerCase().includes(k));
    list.innerHTML = all.length ? all.slice(0, SHOW).map((o) => `
      <button type="button" class="cc-ch-row" data-ch="pick" data-code="${esc(o.code)}">
        <span class="cc-ch-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="cc-ch-text"><span class="cc-ch-name">${esc(o.name)}</span></span>
        <span class="cc-ch-chev" aria-hidden="true">›</span>
      </button>`).join('') : `<p class="cc-ch-note">${esc(t('ch_nobody'))}</p>`;
    if (all.length) fitList(list, Math.max(0, all.length - SHOW));
  };
  paint('');
  box.querySelector('.cc-ch-search').addEventListener('input', (e) => paint(e.target.value));
}

/** How long: three buttons, one tap sends. */
export function lengths(ui, MP, box, them) {
  box.innerHTML = `${top(`<span aria-hidden="true">${esc(them.emoji || '🙂')}</span> ${esc(them.name || '?')}`)}
    <div class="cc-ch-lens">${MP.LENS.map((l) => `<button type="button" class="cc-btn ${l === 'hand' ? 'cc-btn-primary' : 'cc-btn-ghost'} cc-ch-len" data-ch="len" data-v="${l}">${esc(lenLabel(l))}</button>`).join('')}</div>
    <p class="cc-ch-note cc-ch-err" aria-live="polite" hidden></p>`;
}

/** A failed send, said under the length buttons. */
export function showError(box, reason) {
  const el = box && box.querySelector('.cc-ch-err');
  if (!el) return false;
  el.textContent = reasonText(reason);
  el.hidden = false;
  for (const b of box.querySelectorAll('[data-ch="len"]')) b.disabled = false;
  return true;
}

/** GAME OVER, for a match that ended while this phone was away (Hoops' lesson: "the game just
 *  disappears"). Names both players by profile name; a close (X) and one button. */
export function showUnseen(ui, MP, rows) {
  const ids = MP.readUnseen();
  const ended = (rows || []).filter((r) => r.over && ids.includes(r.id)).sort((a, b) => b.updated - a.updated);
  if (!ended.length || ui.root.querySelector('.cc-ch-unseen')) return;
  const r = ended[0];
  const me = myName();
  const draw = r.result === 'draw';
  const winner = r.result === 'won' ? me : r.name || '?';
  const title = draw ? t('ch_draw') : t('match_title_plain', { winner });
  const why = r.why === 'timeout' ? t('ch_timed_out') : r.why === 'resign' ? t('ch_resigned', { name: r.result === 'won' ? (r.name || '?') : me }) : '';
  const el = document.createElement('div');
  el.className = 'cc-modal cc-ch-unseen';
  el.innerHTML = `<div class="cc-scrim" data-ch="ok"></div><div class="cc-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <button type="button" class="cc-sheet-x" data-ch="ok" aria-label="${esc(t('close_word'))}">✕</button>
      <h2 class="cc-sheet-title">${esc(r.emoji)} ${esc(title)}</h2>
      <p class="cc-ch-score">${esc(`${me} ${r.mine} · ${r.name || '?'} ${r.theirs}`)}</p>
      ${why ? `<p class="cc-sheet-sub">${esc(why)}</p>` : ''}
      ${ended.length > 1 ? `<p class="cc-sheet-sub">${esc(t('ch_more', { n: ended.length - 1 }))}</p>` : ''}
      <button type="button" class="cc-btn cc-btn-primary" data-ch="ok">${esc(t('ch_ok'))}</button>
    </div>`;
  ui.root.appendChild(el);
  const done = () => { for (const x of ended) MP.markResultSeen(x.id); el.remove(); };
  for (const b of el.querySelectorAll('[data-ch="ok"]')) b.addEventListener('click', done);
}

export default { home, picker, lengths, showError, showUnseen, reasonText, lenLabel };
