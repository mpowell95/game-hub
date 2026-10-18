// escoba/js/mp-ui.js - the CHALLENGE screens (2026-10-18): your matches, picking a person, picking
// the length, and the result card. DOM strings only; the data is escoba/js/mp.js and the match
// itself is played in ui.js (the same table, the same engine). Lazily imported, so a player who
// never opens Challenges downloads none of it. darts/js/mp-ui.js is the model.
//
// FEWEST WORDS (root CLAUDE.md, "Game screens: as few words as possible"): names, numbers and one
// action word per button. Players are named by their profile name, never "You".
// NOTHING HERE SCROLLS (docs/BUILDING-A-GAME.md, Part 0): every list is trimmed to what fits, with
// "+N more", and the person picker narrows by search instead of growing.
import { makeT } from '../../js/i18n.js';
import { onlineGateText } from '../../js/online-gate.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const PEOPLE_SHOWN = 12;

export function reasonText(reason) {
  const gate = onlineGateText(reason);
  if (gate) return gate;
  if (reason === 'offline') return t('ch_offline');
  if (reason === 'dev-origin-blocked') return t('ch_dev');
  if (reason === 'no-player-code') return t('ch_no_code');
  if (reason === 'expired') return t('ch_expired');
  if (reason === 'not-found') return t('ch_not_found');
  return t('ch_failed');
}

/** "1 hand" / "To 11" / "To 21". */
export const lenText = (len) => (String(len) === '1' ? t('ch_len_1') : t('ch_len_n', { n: String(len || '21') }));

const head = (title) => `<div class="eb-ch-head">
    <button type="button" class="eb-ch-back" data-action="ch-back" aria-label="${esc(t('btn_back'))}">${BACK_SVG}</button>
    <h2 class="eb-ch-title">${title}</h2>
  </div>`;

const matchRow = (r) => `<button type="button" class="eb-ch-row${r.yourTurn ? ' is-mine' : ''}" data-action="ch-open" data-id="${esc(r.id)}">
    <span class="eb-ch-face" aria-hidden="true">${esc(r.emoji)}</span>
    <span class="eb-ch-text"><span class="eb-ch-name">${esc(r.name)}</span>
      <span class="eb-ch-sub">${esc(lenText(r.len))} · ${r.mine | 0}-${r.theirs | 0}</span></span>
    ${r.yourTurn ? `<span class="eb-ch-pill"><span aria-hidden="true">▶</span> ${esc(t('ch_play'))}</span>` : '<span class="eb-ch-wait" aria-hidden="true">⏳</span>'}
  </button>`;

const personRow = (o) => `<button type="button" class="eb-ch-row" data-action="ch-pick" data-code="${esc(o.code)}">
    <span class="eb-ch-face" aria-hidden="true">${esc(o.emoji)}</span>
    <span class="eb-ch-text"><span class="eb-ch-name">${esc(o.name)}</span></span>
    <span class="eb-ch-chev" aria-hidden="true">›</span>
  </button>`;

/** The whole setup panel for the current challenge screen (`ui._chv.screen`). */
export function paint(ui) {
  const v = ui._chv;
  const msg = `<p class="eb-mp-msg" data-role="ch-msg" aria-live="polite">${esc(v.msg || '')}</p>`;
  let body = '';
  if (v.screen === 'pick') {
    body = `${head(esc(t('ch_new')))}
      <input type="search" class="eb-ch-search" data-role="ch-search" placeholder="${esc(t('ch_search'))}"
        aria-label="${esc(t('ch_search'))}" autocomplete="off" value="${esc(v.q || '')}">
      <div class="eb-ch-list" data-role="ch-list">${peopleHTML(v)}</div>`;
  } else if (v.screen === 'len') {
    const them = v.them || {};
    body = `${head(`<span aria-hidden="true">${esc(them.emoji || '🙂')}</span> ${esc(them.name || '')}`)}
      <div class="eb-ch-lens">
        ${['1', '11', '21'].map((l) => `<button type="button" class="eb-btn eb-btn-primary eb-ch-len" data-action="ch-len" data-v="${l}" ${v.busy ? 'disabled' : ''}>${esc(lenText(l))}</button>`).join('')}
      </div>
      ${msg}`;
  } else {
    body = `${head(esc(t('ch_entry')))}
      <button type="button" class="eb-btn eb-btn-primary" data-action="ch-new">${esc(t('ch_new'))}</button>
      ${msg}
      <div class="eb-ch-list" data-role="ch-list">${homeListHTML(v)}</div>`;
  }
  ui.el.setup.innerHTML = `<div class="eb-panel eb-ch">${body}</div>`;
  fit(ui);
}

function homeListHTML(v) {
  if (!v.rows) return `<p class="eb-ch-note">${esc(t('ch_loading'))}</p>`;
  const live = v.rows.filter((r) => !r.over);
  if (!live.length) return `<p class="eb-ch-note">${esc(t('ch_none'))}</p>`;
  return live.slice(0, 12).map(matchRow).join('')
    + (live.length > 12 ? `<p class="eb-ch-note eb-ch-more">${esc(t('ch_more', { n: live.length - 12 }))}</p>` : '');
}
function peopleHTML(v) {
  if (!v.opps) return `<p class="eb-ch-note">${esc(t('ch_loading'))}</p>`;
  const k = String(v.q || '').trim().toLowerCase();
  const all = v.opps.filter((o) => !k || o.name.toLowerCase().includes(k));
  if (!all.length) return `<p class="eb-ch-note">${esc(t('ch_nobody'))}</p>`;
  return all.slice(0, PEOPLE_SHOWN).map(personRow).join('')
    + (all.length > PEOPLE_SHOWN ? `<p class="eb-ch-note eb-ch-more">${esc(t('ch_more', { n: all.length - PEOPLE_SHOWN }))}</p>` : '');
}

/** Just the person list, so typing in the search box never loses focus. */
export function repaintPeople(ui) {
  const list = ui.el.setup.querySelector('[data-role="ch-list"]');
  if (!list) return;
  list.innerHTML = peopleHTML(ui._chv);
  fit(ui);
}

/** NO SCROLLING: drop rows from the end of the list until the screen fits, and say how many are not
 *  shown. Measured, because the room left depends on the phone and on the hub's chrome. */
export function fit(ui) {
  const list = ui.el.setup.querySelector('[data-role="ch-list"]');
  const panel = ui.el.setup.querySelector('.eb-panel');
  if (!list || !panel) return;
  const de = document.documentElement;
  const over = () => de.scrollHeight > window.innerHeight + 1 || panel.getBoundingClientRect().bottom > window.innerHeight - 4;
  let rows = [...list.querySelectorAll('.eb-ch-row')];
  let note = list.querySelector('.eb-ch-more');
  let dropped = note ? (parseInt(note.textContent.replace(/\D+/g, ''), 10) || 0) : 0;
  while (over() && rows.length > 1) {
    rows.pop().remove();
    dropped++;
    if (!note) { note = document.createElement('p'); note.className = 'eb-ch-note eb-ch-more'; list.appendChild(note); }
    note.textContent = t('ch_more', { n: dropped });
  }
}

/** Set the reserved message line without repainting anything else. */
export function say(ui, text) {
  ui._chv.msg = text || '';
  const el = ui.el.setup.querySelector('[data-role="ch-msg"]');
  if (el) el.textContent = ui._chv.msg;
}

/**
 * The result card: title, an optional reason line, both players with their points, and the actions.
 * `players` = [{ avatar, name, pts, win }], highest first. `actions` = [{ action, label, primary }].
 * A win is marked with a crown AND bold, never colour alone. Always has a close (X).
 */
export function resultHTML({ title, sub, players, actions, close = 'ch-close-result' }) {
  return `<div class="eb-scrim" data-action="${close}"></div><div class="eb-sheet eb-ch-result" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <button type="button" class="eb-sheet-x" data-action="${close}" aria-label="${esc(t('aria_close'))}">✕</button>
    <h2 class="eb-sheet-title">${esc(title)}</h2>
    ${sub ? `<p class="eb-sheet-sub">${esc(sub)}</p>` : ''}
    <ol class="eb-standings">${players.map((p, i) => `<li class="${p.win ? 'is-winner' : ''}">
      <span class="eb-rank">${p.win ? '👑' : i + 1}</span><span>${esc(p.avatar)} ${esc(p.name)}</span><span class="num">${p.pts | 0}</span></li>`).join('')}</ol>
    <div class="eb-sheet-actions">${actions.map((a) => `<button type="button" class="eb-btn ${a.primary ? 'eb-btn-primary' : 'eb-btn-ghost'}" data-action="${a.action}">${esc(a.label)}</button>`).join('')}</div>
  </div>`;
}

export default { paint, repaintPeople, fit, say, resultHTML, reasonText, lenText };
