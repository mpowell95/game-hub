// flick-soccer/js/mp-ui.js - the ONLINE screens (2026-10-11): your matches, challenging someone,
// history, and the Game Over popup for a match that ended while you were away. Darts' mp-ui.js is the
// model. DOM only; the data is flick-soccer/js/mp.js and the match itself is played in ui.js. Lazily imported, so a player who never
// opens online play downloads none of it. Cup Pong's multiplayer home is the model: one primary
// button, then "Your turn", then "Their turn", then History.
//
// NOTHING HERE SCROLLS (docs/BUILDING-A-GAME.md, Part 0): every list is capped to what fits, and the
// player picker narrows by search instead of growing.
import { makeT, getLang } from '../../js/i18n.js';
import { onlineGateText } from '../../js/online-gate.js';
import { STRINGS } from './strings.js';
import { lineupsRowHTML, aidsRowHTML } from './ui.js';
import { diffShapeSVG, tierOf } from '../../js/difficulty-tiers.js';

const t = makeT(STRINGS);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

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
    <div class="fs-card fs-mp" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="fs-mp-top">
        <button type="button" class="fs-mp-back" data-mp="back" aria-label="${esc(t('aria_back'))}">${BACK_SVG}</button>
        <h2 class="fs-h2 fs-mp-title">${esc(title)}</h2>
      </div>
      <div class="fs-mp-body">${body}</div>
    </div>`;
  ov.querySelector('[data-mp="back"]').addEventListener('click', () => {
    if (back === 'setup') ui._showSetup(); else home(ui, ui.MP);
  });
  ui.screen = 'mp';
  ui._showOnly('mp');
  return ov.querySelector('.fs-mp-body');
}

/** NO SCROLLING: drop rows from the end of `list` until the card fits the screen, and say how many
 *  are not shown. Measured, because the room left depends on the phone and the hub's chrome. Safe to
 *  call again when something above the list appears later (the "Notify me" row): the count of rows
 *  not shown is kept on the list itself. */
function fitList(card, list, extra) {
  if (!card || !list) return;
  if (extra != null) { list.dataset.extra = String(extra | 0); list.dataset.dropped = '0'; }
  // The card, its body and the list all clip (min-height: 0), so any one of them can be the one
  // hiding a row: check all three.
  const boxes = [card, card.querySelector('.fs-mp-body'), list].filter(Boolean);
  const over = () => boxes.some((el) => el.scrollHeight > el.clientHeight + 1);
  let dropped = list.dataset.dropped | 0;
  const base = list.dataset.extra | 0;
  const paintNote = () => {
    let note = list.querySelector('.fs-mp-more');
    const n = base + dropped;
    if (n > 0 && !note) {
      // A list that pages (home) makes this a button: the rows that did not fit are one tap away.
      note = document.createElement(list.dataset.pages === '1' ? 'button' : 'p');
      if (note.tagName === 'BUTTON') { note.type = 'button'; note.dataset.mp = 'more'; }
      note.className = 'fs-mp-note fs-mp-more';
      list.appendChild(note);
    }
    if (note) note.textContent = t('mp_more', { n });
  };
  paintNote();
  let rows = [...list.querySelectorAll('.fs-mrow')];
  while (over() && rows.length > 1) {
    rows.pop().remove();
    dropped++;
    // A heading left with no rows under it goes too.
    for (const h of list.querySelectorAll('.fs-mp-h')) {
      const nx = h.nextElementSibling;
      if (!nx || !nx.classList.contains('fs-mrow')) h.remove();
    }
    paintNote();
  }
  list.dataset.dropped = String(dropped);
}
const cardOf = (el) => el.closest('.fs-mp');
/** The score part of a match row: goals so far, and the target. */
const scoreLine = (r) => t('mp_scores', { a: r.mine, b: r.theirs, name: r.name }) + ' · ' + t('mp_first_to', { n: r.goals || 2 });

const rowHTML = (r) => `
  <button type="button" class="fs-mrow${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
    <span class="fs-mrow-face" aria-hidden="true">${esc(r.emoji)}</span>
    <span class="fs-mrow-text"><span class="fs-mrow-name">${esc(r.name)}</span>
      <span class="fs-mrow-sub">${esc(scoreLine(r))}</span></span>
    <span class="fs-mrow-chev" aria-hidden="true">›</span>
  </button>`;

/** The online home. */
export async function home(ui, MP) {
  const body = page(ui, t('mp_title'), 'setup', `
    <button type="button" class="gh-btn gh-btn--primary gh-btn--block fs-go" data-mp="challenge">${esc(t('mp_challenge'))}</button>
    <button type="button" class="gh-btn gh-btn--block fs-alt" data-mp="pass">${esc(t('mp_pass'))}</button>
    <div class="fs-mp-push" hidden></div>
    <div class="fs-mp-list"><p class="fs-mp-note">${esc(t('mp_loading'))}</p></div>
    <button type="button" class="gh-btn gh-btn--block fs-alt" data-mp="history">${esc(t('mp_history'))}</button>`);
  body.querySelector('[data-mp="challenge"]').addEventListener('click', () => picker(ui, MP));
  body.querySelector('[data-mp="pass"]').addEventListener('click', () => ui._passPlay());
  body.querySelector('[data-mp="history"]').addEventListener('click', () => history(ui, MP));
  let repaint = null;
  pushRow(body.querySelector('.fs-mp-push'), () => { if (repaint) repaint(); else fitList(cardOf(body), body.querySelector('.fs-mp-list')); });
  const rows = await MP.readMyGames();
  if (!body.isConnected) return;
  try { MP.recordFinished(rows); } catch (err) { console.warn('[flick-soccer] recordFinished', err); }
  const live = rows.filter((r) => !r.over);
  const mine = live.filter((r) => r.yourTurn), theirs = live.filter((r) => !r.yourTurn);
  const all = mine.concat(theirs);
  const list = body.querySelector('.fs-mp-list');
  list.dataset.pages = '1';
  // Pages, not a scroll (the card never scrolls): as many rows as fit, then "+N more" shows the
  // next page, and the last page's button goes back to the first. Every match is reachable.
  let start = 0;
  const paint = () => {
    const page = all.slice(start);
    const pm = page.filter((r) => r.yourTurn), pt = page.filter((r) => !r.yourTurn);
    list.innerHTML = (pm.length ? `<h3 class="fs-mp-h">${esc(t('mp_your_turn'))} <span>${mine.length}</span></h3>${pm.map(rowHTML).join('')}` : '')
      + (pt.length ? `<h3 class="fs-mp-h">${esc(t('mp_their_turn'))} <span>${theirs.length}</span></h3>${pt.map(rowHTML).join('')}` : '')
      + (live.length ? '' : `<p class="fs-mp-note">${esc(t('mp_none'))}</p>`);
    fitList(cardOf(body), list, start);
  };
  paint();
  repaint = paint;
  list.addEventListener('click', (e) => {
    if (e.target.closest('[data-mp="more"]')) {
      const shown = list.querySelectorAll('.fs-mrow').length;
      start = start + shown >= all.length ? 0 : start + shown;
      paint();
      return;
    }
    const b = e.target.closest('.fs-mrow[data-id]');
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
    <input type="search" class="gh-input fs-mp-search" placeholder="${esc(t('mp_search'))}" aria-label="${esc(t('mp_search'))}" autocomplete="off">
    <div class="fs-mp-list"><p class="fs-mp-note">${esc(t('mp_loading'))}</p></div>`);
  const opps = await MP.readOpponents();
  if (!body.isConnected) return;
  const list = body.querySelector('.fs-mp-list');
  const SHOW = 10;
  const paint = (q) => {
    const k = String(q || '').trim().toLowerCase();
    const all = opps.filter((o) => !k || o.name.toLowerCase().includes(k));
    list.innerHTML = all.length ? all.slice(0, SHOW).map((o) => `
      <button type="button" class="fs-mrow" data-code="${esc(o.code)}">
        <span class="fs-mrow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="fs-mrow-text"><span class="fs-mrow-name">${esc(o.name)}</span></span>
        <span class="fs-mrow-chev" aria-hidden="true">›</span>
      </button>`).join('') : `<p class="fs-mp-note">${esc(t('mp_no_opp'))}</p>`;
    if (all.length) fitList(cardOf(list), list, Math.max(0, all.length - SHOW));
  };
  paint('');
  body.querySelector('.fs-mp-search').addEventListener('input', (e) => paint(e.target.value));
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.fs-mrow');
    const o = b && opps.find((x) => x.code === b.dataset.code);
    if (o) confirm(ui, MP, o);
  });
}

/** Who the challenge is with, as a heading: their face and name. */
const whoHTML = (them) => `<p class="fs-mp-who"><span class="fs-mp-face" aria-hidden="true">${esc(them.emoji || '🙂')}</span><b>${esc(them.name || '?')}</b></p>`;

/** Who, the terms, your two line-ups, send (2026-10-14: offense and defense line-ups replaced the
 *  one line-up you picked per challenge, and the card lost its role paragraph). Exported for the
 *  hub's Challenges screen. */
export function challengeTo(ui, MP, them) { confirm(ui, MP, them); }
function confirm(ui, MP, them) {
  const body = page(ui, t('mp_new_ch'), 'home', `
    ${whoHTML(them)}
    <p class="fs-mp-terms">${esc(t('mp_terms_they', { n: ui.settings.goals }))}</p>
    <div class="fs-field"><span class="fs-label">${esc(t('aim_help'))}</span>${aidsRowHTML(ui.settings.aimHelp)}</div>
    <div class="fs-field"><span class="fs-label">${esc(t('mp_your_lineups'))}</span>${lineupsRowHTML(ui.settings)}</div>
    <button type="button" class="gh-btn gh-btn--primary gh-btn--block fs-go" data-mp="send">${esc(t('mp_send_ch'))}</button>
    <p class="fs-mp-note fs-mp-err" aria-live="polite" hidden></p>`);
  const send = body.querySelector('[data-mp="send"]');
  send.addEventListener('click', async () => {
    send.disabled = true;
    const res = await ui._sendChallenge(them, ui.settings.goals);
    if (res && !res.ok && body.isConnected) {
      const err = body.querySelector('.fs-mp-err');
      err.textContent = reasonText(res.reason);
      err.hidden = false;
      send.disabled = false;
    }
  });
}

/** Side b, opening a new challenge: who, the terms, your two line-ups (change them here or not),
 *  Kick off. Kick off writes your pair into the match (MP.pickLineup) and starts it. */
export function pickLineup(ui, MP, game) {
  const them = MP.themOf(game, MP.myCode());
  const body = page(ui, t('mp_new_ch'), 'home', `
    ${whoHTML(them)}
    <p class="fs-mp-terms">${esc(t('mp_terms_you', { n: game.goals }))}</p>
    <p class="fs-mp-aid">${diffShapeSVG(tierOf(game.aids))}<span>${esc(t('mp_aid_line', { level: t('diff_' + game.aids) }))}</span></p>
    <p class="fs-aid-note fs-mp-aid-note">${esc(t('aid_' + game.aids))}</p>
    <div class="fs-field"><span class="fs-label">${esc(t('mp_your_lineups'))}</span>${lineupsRowHTML(ui.settings)}</div>
    <button type="button" class="gh-btn gh-btn--primary gh-btn--block fs-go" data-mp="kick">${esc(t('mp_kickoff'))}</button>
    <p class="fs-mp-note fs-mp-err" aria-live="polite" hidden></p>`);
  const kick = body.querySelector('[data-mp="kick"]');
  kick.addEventListener('click', async () => {
    kick.disabled = true;
    const res = await MP.pickLineup(game.id, [ui.settings.offense, ui.settings.defense]);
    if (!body.isConnected) return;
    if (res && res.ok) { ui._mpBegin(res.game); return; }
    const err = body.querySelector('.fs-mp-err');
    err.textContent = reasonText(res && res.reason);
    err.hidden = false;
    kick.disabled = false;
  });
}

/** Finished matches: a record per opponent, then the latest matches. */
async function history(ui, MP) {
  const body = page(ui, t('mp_history'), 'home', `<div class="fs-mp-list"><p class="fs-mp-note">${esc(t('mp_loading'))}</p></div>`);
  const rows = await MP.readMyGames();
  if (!body.isConnected) return;
  const { opponents, finished } = MP.recordsFrom(rows, MP.myCode());
  const list = body.querySelector('.fs-mp-list');
  if (!finished.length) { list.innerHTML = `<p class="fs-mp-note">${esc(t('mp_no_history'))}</p>`; return; }
  const word = (r) => (r.result === 'won' ? (r.resigned === 'them' ? t('mp_won_quit') : t('mp_won')) : (r.resigned === 'me' ? t('mp_you_quit') : t('mp_lost')));
  // Win and loss are told apart by a mark (check, cross), never by colour alone.
  const mark = (r) => (r.result === 'won' ? '✓' : '✗');
  const opp = opponents.slice(0, 3), fin = finished.slice(0, 10);
  list.innerHTML = `<h3 class="fs-mp-h">${esc(t('mp_records'))}</h3>` + opp.map((o) => `
      <div class="fs-mrow is-static">
        <span class="fs-mrow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="fs-mrow-text"><span class="fs-mrow-name">${esc(o.name)}</span></span>
        <span class="fs-rec"><b>${o.won}</b>-<b>${o.lost}</b></span>
      </div>`).join('')
    + `<h3 class="fs-mp-h">${esc(t('mp_matches'))}</h3>` + fin.map((r) => `
      <div class="fs-mrow is-static${r.result === 'won' ? ' is-won' : ''}">
        <span class="fs-hmark" aria-hidden="true">${mark(r)}</span>
        <span class="fs-mrow-text"><span class="fs-mrow-name">${esc(r.name)}</span>
          <span class="fs-mrow-sub">${esc([word(r), new Date(r.updated).toLocaleDateString(getLang() === 'es' ? 'es-ES' : undefined)].join(' · '))}</span></span>
      </div>`).join('');
  fitList(cardOf(list), list, finished.length - fin.length);
}

/** GAME OVER, for a match that ended while this phone was away (Hoops' lesson, 2026-09-24: "there
 *  isn't a You Lost screen or anything. the game just disappears"). */
export function showUnseen(ui, MP, rows) {
  const ids = MP.readUnseen();
  const ended = (rows || []).filter((r) => r.over && ids.includes(r.id)).sort((a, b) => b.updated - a.updated);
  if (!ended.length || ui.root.querySelector('.fs-unseen')) return;
  const r = ended[0];
  const won = r.result === 'won';
  const el = document.createElement('div');
  el.className = 'fs-ov fs-unseen';
  el.innerHTML = `
    <div class="fs-card fs-card-sm" role="dialog" aria-modal="true" aria-label="${esc(t('mp_game_over'))}">
      <button type="button" class="fs-x" data-mp="close" aria-label="${esc(t('aria_close'))}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg></button>
      <p class="fs-res-ava" aria-hidden="true">${esc(r.emoji)}</p>
      <h2 class="fs-h2">${esc(won ? t('win_you') : t('lose_you'))}</h2>
      <p class="fs-res-line">${esc(t(won ? 'mp_you_won_vs' : 'mp_you_lost_vs', { name: r.name }))}${r.why === 'resign' ? ` · ${esc(won ? t('mp_they_resigned', { name: r.name }) : t('mp_you_resigned'))}` : ''}</p>
      ${ended.length > 1 ? `<p class="fs-res-line">${esc(t('mp_more', { n: ended.length - 1 }))}</p>` : ''}
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-mp="ok">${esc(t('mp_ok'))}</button>
    </div>`;
  ui.root.appendChild(el);
  const done = () => { for (const x of ended) MP.markResultSeen(x.id); el.remove(); };
  el.querySelector('[data-mp="ok"]').addEventListener('click', done);
  el.querySelector('[data-mp="close"]').addEventListener('click', done);
}

export default { home, showUnseen, reasonText };
