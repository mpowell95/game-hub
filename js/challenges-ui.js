// js/challenges-ui.js - the hub's CHALLENGES screen (2026-10-05). js/challenges.js is the data half
// and carries the reasoning.
//
// Matt: "a button you can press where you can see all your live challenges - if it's your turn vs
// theirs, more info on your records total and against specific players, etc. You should also be
// able to send challenges and jump into games from this page."
//
// THE LAW: this screen renders and writes nothing itself. Opening a match and starting a challenge
// are handed back to js/hub.js (`onOpen` / `onChallenge`), which arms the GAME's own handoff and
// mounts it. Cancel / Decline / Resign (2026-10-13) go through js/challenges.js `endMatch` to the
// game's own mp.js writer, which verifies by re-read and deletes nothing.
//
// Built on css/ui.css's `.gh-*` primitives, like js/messages-ui.js. Results are told apart by a MARK
// (check, cross, equals) and a WORD, never by colour alone (Matt is red/green colourblind).
//
// Entry point (lazily imported by js/hub.js):
//   openChallenges({ games: [{id, name}], onOpen(gameId, matchId), onChallenge(gameId, them) })

import { summarize, loadAll, watchAll, readOpponents, myCode, endAction, endMatch } from './challenges.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './challenges-strings.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _host = null;
let _onKey = null;
let _unwatch = null;
let _view = 0;                    // bumped on every render; an async render that lost the race stops

function current(gen) { return gen === _view && !!_host; }

export function closeChallenges() {
  _view += 1;
  if (_unwatch) { try { _unwatch(); } catch { /* gone */ } _unwatch = null; }
  if (_onKey) { document.removeEventListener('keydown', _onKey); _onKey = null; }
  if (_host) { _host.remove(); _host = null; }
}

// --- css ------------------------------------------------------------------------------------------

function ensureCss() {
  if (!document.querySelector('link[data-gh-ui-css="1"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/ui.css', import.meta.url).href;
    link.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(link);
  }
  if (document.getElementById('cx-css')) return;
  const style = document.createElement('style');
  style.id = 'cx-css';
  // (A JS template literal: never put a backtick in these comments.)
  style.textContent = `
  .cx-overlay { z-index: 300; padding: max(var(--gh-sp-4), env(safe-area-inset-top)) var(--gh-sp-4)
                max(var(--gh-sp-4), env(safe-area-inset-bottom)); align-content: center; }
  /* The modal does not scroll; the body does, so the title, tabs and button stay put. */
  .cx-modal { width: min(520px, 100%); max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
  .cx-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
               -webkit-overflow-scrolling: touch; margin: 0 calc(var(--gh-sp-4) * -1); padding: 0 var(--gh-sp-4); }
  .cx-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .cx-back { flex: 0 0 auto; width: 34px; padding: 0; font-size: 20px; line-height: 1; white-space: nowrap; }
  .cx-head-emoji { font-size: 22px; line-height: 1; flex: 0 0 auto; }
  .cx-head-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                  font-size: var(--gh-fs-md); }
  .cx-tabs { margin: 0 0 var(--gh-sp-3); }
  .cx-tabs .gh-seg__item { flex: 1 1 0; }
  .cx-note { margin: var(--gh-sp-2) 0 var(--gh-sp-3); font-size: var(--gh-fs-sm); color: var(--gh-muted); line-height: 1.5; }
  .cx-warn { margin: 0 0 var(--gh-sp-3); font-size: var(--gh-fs-xs); color: var(--gh-muted); }
  .cx-h { display: flex; align-items: baseline; gap: 8px; margin: var(--gh-sp-4) 0 var(--gh-sp-2);
          font-size: var(--gh-fs-xs); font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
          color: var(--gh-muted); }
  .cx-h:first-child { margin-top: 0; }
  .cx-h-n { font-variant-numeric: tabular-nums; }
  .cx-list { list-style: none; margin: 0; padding: 0; }
  .cx-list li + li { margin-top: var(--gh-sp-2); }
  .cx-row { display: flex; align-items: center; gap: var(--gh-sp-3); width: 100%; text-align: left;
            padding: 10px var(--gh-sp-3); min-height: var(--gh-tap, 44px); border: 1px solid var(--gh-border);
            border-radius: var(--gh-r-md); background: var(--gh-surface); color: var(--gh-ink);
            cursor: pointer; font-family: var(--gh-font); touch-action: manipulation; }
  /* Your turn: a heavier border AND a "Play" pill with words, never the accent hue alone. */
  .cx-row.is-yours { border: 2px solid var(--gh-accent); }
  .cx-row-emoji { font-size: 24px; line-height: 1; flex: 0 0 auto; }
  .cx-row-main { flex: 1 1 auto; min-width: 0; }
  .cx-row-name { display: block; font-size: var(--gh-fs-sm); font-weight: 800;
                 white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cx-row-sub { display: block; margin-top: 2px; font-size: var(--gh-fs-xs); color: var(--gh-muted);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cx-row-end { flex: 0 0 auto; font-size: var(--gh-fs-xs); color: var(--gh-muted); white-space: nowrap; text-align: right; }
  .cx-pill { flex: 0 0 auto; padding: 5px 12px; border-radius: var(--gh-r-pill); background: var(--gh-accent);
             color: var(--gh-accent-ink); font-size: var(--gh-fs-xs); font-weight: 800; white-space: nowrap; }
  .cx-mark { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
             font-size: 15px; font-weight: 900; border: 2px solid var(--gh-border-strong); color: var(--gh-ink); }
  .cx-mark.is-won { background: var(--gh-ink); color: var(--gh-surface); border-color: var(--gh-ink); }
  .cx-chev { flex: 0 0 auto; color: var(--gh-muted); font-size: 20px; line-height: 1; }
  .cx-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: var(--gh-sp-2); }
  .cx-stat { padding: var(--gh-sp-3) var(--gh-sp-2); border: 1px solid var(--gh-border); border-radius: var(--gh-r-md);
             background: var(--gh-surface-2); text-align: center; }
  .cx-stat-n { display: block; font-size: var(--gh-fs-xl); font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .cx-stat-l { display: block; margin-top: 2px; font-size: var(--gh-fs-xs); color: var(--gh-muted); font-weight: 700; }
  .cx-game { display: flex; align-items: center; justify-content: space-between; gap: var(--gh-sp-3);
             padding: 8px 2px; border-bottom: 1px solid var(--gh-border); font-size: var(--gh-fs-sm); }
  .cx-game:last-child { border-bottom: 0; }
  .cx-game-name { font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cx-game-rec { flex: 0 0 auto; color: var(--gh-muted); font-variant-numeric: tabular-nums; font-weight: 700; }
  .cx-search { width: 100%; margin: 0 0 var(--gh-sp-3); }
  /* A live row and its Cancel / Decline / Resign button side by side (2026-10-13). The button is a
     quiet outline with a WORD, never a colour alone, and always asks before it does anything. */
  .cx-live { display: flex; align-items: stretch; gap: 6px; }
  .cx-live .cx-row { flex: 1 1 auto; min-width: 0; }
  .cx-end { flex: 0 0 auto; min-width: 72px; min-height: var(--gh-tap, 44px); padding: 0 10px;
            border: 1px solid var(--gh-border-strong); border-radius: var(--gh-r-md); background: transparent;
            color: var(--gh-ink); font-family: var(--gh-font); font-size: var(--gh-fs-xs); font-weight: 800;
            cursor: pointer; touch-action: manipulation; }
  .cx-flash { margin: 0 0 var(--gh-sp-3); padding: 10px var(--gh-sp-3); border: 1px solid var(--gh-border);
              border-left: 4px solid var(--gh-accent); border-radius: var(--gh-r-md); background: var(--gh-surface-2);
              font-size: var(--gh-fs-sm); font-weight: 700; }
  .cx-confirm { font-size: var(--gh-fs-sm); line-height: 1.5; margin: 0 0 var(--gh-sp-3); }
  .cx-err { font-size: var(--gh-fs-sm); font-weight: 700; margin: 0 0 var(--gh-sp-3); }
  .cx-acts .gh-btn + .gh-btn { margin-top: var(--gh-sp-2); }
  .cx-acts { padding-top: var(--gh-sp-3); }
  `;
  document.head.appendChild(style);
}

// --- shell ----------------------------------------------------------------------------------------

function mountOverlay() {
  ensureCss();
  closeChallenges();
  const host = document.createElement('div');
  host.className = 'gh-overlay cx-overlay';
  host.innerHTML = `<div class="gh-modal cx-modal" role="dialog" aria-modal="true" aria-label="${esc(t('cx_title'))}"></div>`;
  document.body.appendChild(host);
  _host = host;
  host.addEventListener('click', (e) => { if (e.target === host) closeChallenges(); });
  _onKey = (e) => { if (e.key === 'Escape') closeChallenges(); };
  document.addEventListener('keydown', _onKey);
  return host.querySelector('.gh-modal');
}

function shell(card, { title, emoji, back, body, footer }) {
  const heading = back
    ? `<span class="cx-head">
         <button type="button" class="gh-btn gh-btn--ghost gh-btn--sm cx-back" data-role="back"
                 aria-label="${esc(t('cx_back'))}" title="${esc(t('cx_back'))}">&#8249;</button>
         ${emoji ? `<span class="cx-head-emoji" aria-hidden="true">${esc(emoji)}</span>` : ''}
         <span class="cx-head-name">${esc(title)}</span>
       </span>`
    : `⚔️ ${esc(title)}`;
  card.innerHTML = `
    <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('cx_close'))}">&times;</button>
    <h2 class="gh-modal__title">${heading}</h2>
    <div class="cx-scroll">${body}</div>
    ${footer ? `<div class="gh-modal__actions cx-acts">${footer}</div>` : ''}`;
  card.querySelector('[data-role="close"]').addEventListener('click', closeChallenges);
  const b = card.querySelector('[data-role="back"]');
  if (b && back) b.addEventListener('click', back);
}

// --- small render helpers -------------------------------------------------------------------------

function whenText(atMs) {
  const n = Number(atMs) || 0;
  if (!n) return '';
  return new Date(n).toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short' });
}

function wld(o) {
  return o.draw > 0 ? t('cx_wld_d', { w: o.won, l: o.lost, d: o.draw }) : t('cx_wld', { w: o.won, l: o.lost });
}

/** The few game-specific words under a row: which game, and its format. */
function subLine(r, gameName) {
  const i = r.info || {};
  const bits = [gameName(r.game)];
  if (r.game === 'darts' && i.kind) bits.push(i.kind === 'cricket' ? t('cx_cricket') : i.kind === 'cricket-order' ? t('cx_cricket_order') : i.kind);
  if (r.game === 'skeeball') {
    if (i.all) bits.push(t('cx_all_machines'));
    else if (i.n > 1) bits.push(t('cx_n_games', { n: i.n }));
    else if (i.boardName) bits.push(i.boardName);
  }
  if (i.su) bits.push(t('cx_straight_up'));
  if (i.series > 1) bits.push(t('cx_game_of', { n: i.seriesNo, m: i.series }));
  const left = untilText(r.expires);
  if (left) bits.push(t('cx_expires_in', { n: left }));
  return bits.filter(Boolean).join(' · ');
}

/** "2d" / "5h" until a live match stops waiting (js/challenge-life.js), or '' when it never will. */
function untilText(at, now = Date.now()) {
  const left = (Number(at) || 0) - now;
  if (!(Number(at) > 0) || left <= 0) return '';
  const h = Math.ceil(left / 3600000);
  return h >= 24 ? t('cx_d', { n: Math.ceil(h / 24) }) : t('cx_h', { n: h });
}

/** What the end button on a live row offers, from the row (the confirm screen re-reads the match):
 *  you sent it and they have not answered -> cancel; sent to you, unplayed -> decline; else resign. */
const endHint = (r) => (r.open === 'sent' ? 'cancel' : r.open === 'got' ? 'decline' : 'resign');

function liveRowHTML(r, gameName, { showName = true } = {}) {
  const yours = r.state === 'yours';
  const hint = endHint(r);
  const who = r.name || t('cx_someone');
  return `<li class="cx-live"><button type="button" class="cx-row${yours ? ' is-yours' : ''}" data-game="${esc(r.game)}" data-id="${esc(r.id)}">
      <span class="cx-row-emoji" aria-hidden="true">${esc(r.emoji)}</span>
      <span class="cx-row-main">
        <span class="cx-row-name">${esc(showName ? (r.name || t('cx_someone')) : gameName(r.game))}</span>
        <span class="cx-row-sub">${esc(showName ? subLine(r, gameName) : subLine(r, () => ''))}</span>
      </span>
      ${yours ? `<span class="cx-pill">${esc(t('cx_play'))}</span>`
        : `<span class="cx-row-end">${esc(t('cx_waiting_on', { name: r.name || t('cx_someone') }))}</span>`}
    </button><button type="button" class="cx-end" data-end-game="${esc(r.game)}" data-end-id="${esc(r.id)}"
      aria-label="${esc(t(`cx_end_${hint}_aria`, { name: who }))}">${esc(t(`cx_end_${hint}`))}</button></li>`;
}

function resultRowHTML(r, gameName) {
  const name = r.name || t('cx_someone');
  // Called off or expired (2026-10-13): say who did it. A cancel is always the sender's and a
  // decline always the receiver's, so `sent` says whether it was you. An expired row from before
  // that date carries no `sent`, and keeps its old words.
  const mine = (sent) => (sent ? 'me' : 'them');
  const key = r.ended === 'cancelled' ? `cx_res_cancelled_${mine(r.sent)}`
    : r.ended === 'declined' ? `cx_res_declined_${mine(!r.sent)}`
      : r.state === 'expired' ? (r.game === 'skeeball' ? 'cx_res_expired' : `cx_res_expired_${r.sent ? 'them' : 'me'}`)
        : r.result === 'won' ? 'cx_res_won'
          : r.result === 'lost' ? 'cx_res_lost' : r.result === 'draw' ? 'cx_res_draw' : 'cx_res_done';
  const mark = r.result === 'won' ? '✓' : r.result === 'lost' ? '✗' : r.result === 'draw' ? '=' : '·';
  const quit = r.resigned && (r.result === 'won' || r.result === 'lost')
    ? ` (${t(r.result === 'won' ? 'cx_quit_them' : 'cx_quit_me')})` : '';
  return `<li><button type="button" class="cx-row" data-game="${esc(r.game)}" data-id="${esc(r.id)}">
      <span class="cx-mark${r.result === 'won' ? ' is-won' : ''}" aria-hidden="true">${mark}</span>
      <span class="cx-row-main">
        <span class="cx-row-name">${esc(t(key, { name }) + quit)}</span>
        <span class="cx-row-sub">${esc(subLine(r, gameName))}</span>
      </span>
      <span class="cx-row-end">${esc(whenText(r.updated))}</span>
    </button></li>`;
}

function statsHTML(o) {
  return `<div class="cx-stats">
      <div class="cx-stat"><span class="cx-stat-n">${o.won}</span><span class="cx-stat-l">✓ ${esc(t('cx_won'))}</span></div>
      <div class="cx-stat"><span class="cx-stat-n">${o.lost}</span><span class="cx-stat-l">✗ ${esc(t('cx_lost'))}</span></div>
      ${o.draw > 0 ? `<div class="cx-stat"><span class="cx-stat-n">${o.draw}</span><span class="cx-stat-l">= ${esc(t('cx_drawn'))}</span></div>` : ''}
    </div>`;
}

function byGameHTML(byGame, games) {
  const rows = games.filter((g) => byGame[g.id] && byGame[g.id].played > 0);
  if (!rows.length) return '';
  return `<div>${rows.map((g) => `<div class="cx-game"><span class="cx-game-name">${esc(g.name)}</span>
      <span class="cx-game-rec">${esc(wld(byGame[g.id]))}</span></div>`).join('')}</div>`;
}

// --- entry point ----------------------------------------------------------------------------------

/**
 * Open the Challenges screen.
 * @param {{games: {id:string,name:string}[], onOpen:(game:string,id:string)=>void,
 *          onChallenge:(game:string,them:{code,name,emoji})=>void}} opts
 */
export async function openChallenges(opts = {}) {
  const games = Array.isArray(opts.games) ? opts.games.filter((g) => g && g.id) : [];
  const ids = games.map((g) => g.id);
  const nameOf = (id) => (games.find((g) => g.id === id) || {}).name || id;
  const card = mountOverlay();
  const gen0 = _view;
  const S = { rows: null, failed: [], tab: 'live', view: 'home', opp: null, people: null, flash: '' };

  const open = (game, id) => { closeChallenges(); if (opts.onOpen) opts.onOpen(game, id); };
  const challenge = (game, them) => { closeChallenges(); if (opts.onChallenge) opts.onChallenge(game, them); };
  // The screen a row was tapped from, so Back (and a finished cancel) returns there.
  const backTo = () => (S.view === 'opp' && S.opp ? () => renderOpponent(S.opp) : () => renderHome());
  const bindRows = (root) => {
    for (const b of root.querySelectorAll('.cx-row[data-game][data-id]')) {
      b.addEventListener('click', () => open(b.dataset.game, b.dataset.id));
    }
    for (const b of root.querySelectorAll('.cx-end[data-end-game][data-end-id]')) {
      b.addEventListener('click', () => renderEnd(b.dataset.endGame, b.dataset.endId, backTo()));
    }
  };
  /** One line at the top of the screen saying what just happened (a cancel, a resignation), once. */
  const flashHTML = () => {
    if (!S.flash) return '';
    const html = `<p class="cx-flash" role="status">${esc(S.flash)}</p>`;
    S.flash = '';
    return html;
  };

  shell(card, { title: t('cx_title'), body: `<p class="cx-note">${esc(t('cx_loading'))}</p>` });
  if (!(await myCode())) {
    if (current(gen0)) shell(card, { title: t('cx_title'), body: `<p class="cx-note">${esc(t('cx_no_code'))}</p>` });
    return;
  }

  // --- home: Live / Records ---
  function renderHome() {
    const gen = ++_view;
    S.view = 'home';
    const sum = summarize(S.rows || []);
    const tabs = `<div class="gh-seg cx-tabs" role="group">
        <button type="button" class="gh-seg__item" data-tab="live" aria-pressed="${S.tab === 'live'}">${esc(t('cx_tab_live'))}${sum.yours.length ? ` (${sum.yours.length})` : ''}</button>
        <button type="button" class="gh-seg__item" data-tab="records" aria-pressed="${S.tab === 'records'}">${esc(t('cx_tab_records'))}</button>
      </div>`;
    const warn = S.failed.length ? `<p class="cx-warn">${esc(t('cx_failed', { games: S.failed.map(nameOf).join(', ') }))}</p>` : '';
    let body;
    if (S.rows === null) body = `<p class="cx-note">${esc(t('cx_loading'))}</p>`;
    else if (S.tab === 'live') {
      body = (sum.yours.length ? `<h3 class="cx-h">${esc(t('cx_your_turn'))} <span class="cx-h-n">${sum.yours.length}</span></h3>
          <ul class="cx-list">${sum.yours.map((r) => liveRowHTML(r, nameOf)).join('')}</ul>` : '')
        + (sum.theirs.length ? `<h3 class="cx-h">${esc(t('cx_their_turn'))} <span class="cx-h-n">${sum.theirs.length}</span></h3>
          <ul class="cx-list">${sum.theirs.map((r) => liveRowHTML(r, nameOf)).join('')}</ul>` : '')
        + (sum.yours.length || sum.theirs.length ? '' : `<p class="cx-note">${esc(t('cx_none_live'))}</p>`);
    } else {
      const people = sum.opponents.filter((o) => o.played > 0 || o.live > 0);
      body = !sum.finished.length && !people.length ? `<p class="cx-note">${esc(t('cx_no_records'))}</p>` : `
        <h3 class="cx-h">${esc(t('cx_record'))}</h3>
        ${statsHTML(sum.total)}
        ${byGameHTML(sum.byGame, games)}
        ${people.length ? `<h3 class="cx-h">${esc(t('cx_by_player'))}</h3>
          <ul class="cx-list">${people.map((o) => `<li><button type="button" class="cx-row" data-opp="${esc(o.code)}">
              <span class="cx-row-emoji" aria-hidden="true">${esc(o.emoji)}</span>
              <span class="cx-row-main">
                <span class="cx-row-name">${esc(o.name || t('cx_someone'))}</span>
                <span class="cx-row-sub">${esc([o.played ? wld(o) : '', o.live ? t('cx_live_n', { n: o.live }) : ''].filter(Boolean).join(' · '))}</span>
              </span>
              <span class="cx-chev" aria-hidden="true">&rsaquo;</span>
            </button></li>`).join('')}</ul>` : ''}
        ${sum.finished.length ? `<h3 class="cx-h">${esc(t('cx_recent'))}</h3>
          <ul class="cx-list">${sum.finished.slice(0, 15).map((r) => resultRowHTML(r, nameOf)).join('')}</ul>` : ''}`;
    }
    shell(card, {
      title: t('cx_title'),
      body: flashHTML() + tabs + warn + body,
      footer: `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="new">${esc(t('cx_new'))}</button>`,
    });
    if (!current(gen)) return;
    for (const b of card.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { S.tab = b.dataset.tab; renderHome(); });
    for (const b of card.querySelectorAll('[data-opp]')) b.addEventListener('click', () => renderOpponent(b.dataset.opp));
    card.querySelector('[data-role="new"]').addEventListener('click', () => renderPickPerson());
    bindRows(card);
  }

  // --- one opponent: record vs them, live games with them, results, and Challenge ---
  function renderOpponent(code) {
    const gen = ++_view;
    S.view = 'opp'; S.opp = code;
    const mine = (S.rows || []).filter((r) => r.with === code);
    const sum = summarize(mine);
    const o = sum.opponents[0] || { code, name: '', emoji: '🙂', won: 0, lost: 0, draw: 0, played: 0 };
    const name = o.name || t('cx_someone');
    const live = sum.yours.concat(sum.theirs);
    shell(card, {
      title: name, emoji: o.emoji, back: () => renderHome(),
      body: `${flashHTML()}<h3 class="cx-h">${esc(t('cx_vs_record', { name }))}</h3>
        ${statsHTML(o)}
        ${byGameHTML(o.byGame || {}, games)}
        ${live.length ? `<h3 class="cx-h">${esc(t('cx_live_with', { name }))} <span class="cx-h-n">${live.length}</span></h3>
          <ul class="cx-list">${live.map((r) => liveRowHTML(r, nameOf, { showName: false })).join('')}</ul>` : ''}
        ${sum.finished.length ? `<h3 class="cx-h">${esc(t('cx_recent'))}</h3>
          <ul class="cx-list">${sum.finished.slice(0, 15).map((r) => resultRowHTML(r, nameOf)).join('')}</ul>` : ''}`,
      footer: `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="ch">${esc(t('cx_challenge_them', { name }))}</button>`,
    });
    if (!current(gen)) return;
    bindRows(card);
    card.querySelector('[data-role="ch"]').addEventListener('click', () =>
      renderPickGame({ code, name: o.name, emoji: o.emoji }, () => renderOpponent(code)));
  }

  // --- new challenge: who ---
  async function renderPickPerson() {
    const gen = ++_view;
    S.view = 'pick';
    shell(card, { title: t('cx_new'), back: () => renderHome(), body: `<p class="cx-note">${esc(t('cx_loading'))}</p>` });
    if (!S.people) S.people = await readOpponents();
    if (!current(gen)) return;
    const people = S.people;
    shell(card, {
      title: t('cx_new'), back: () => renderHome(),
      body: `<p class="cx-note">${esc(t('cx_pick_person'))}</p>
        <input type="search" class="gh-input cx-search" placeholder="${esc(t('cx_search'))}" aria-label="${esc(t('cx_search'))}" autocomplete="off">
        <ul class="cx-list" data-role="people"></ul>`,
    });
    const list = card.querySelector('[data-role="people"]');
    const paint = (q) => {
      const k = String(q || '').trim().toLowerCase();
      const show = people.filter((p) => !k || String(p.name).toLowerCase().includes(k));
      list.innerHTML = show.length ? show.map((p) => `<li><button type="button" class="cx-row" data-code="${esc(p.code)}">
          <span class="cx-row-emoji" aria-hidden="true">${esc(p.emoji)}</span>
          <span class="cx-row-main"><span class="cx-row-name">${esc(p.name)}</span></span>
          <span class="cx-chev" aria-hidden="true">&rsaquo;</span>
        </button></li>`).join('') : `<li><p class="cx-note">${esc(t('cx_no_people'))}</p></li>`;
    };
    paint('');
    card.querySelector('.cx-search').addEventListener('input', (e) => paint(e.target.value));
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-code]');
      const p = b && people.find((x) => x.code === b.dataset.code);
      if (p) renderPickGame(p, () => renderPickPerson());
    });
  }

  // --- new challenge: which game (the game's own screen takes it from there) ---
  function renderPickGame(them, back) {
    const gen = ++_view;
    S.view = 'game';
    const name = them.name || t('cx_someone');
    shell(card, {
      title: name, emoji: them.emoji, back,
      body: `<p class="cx-note">${esc(t('cx_pick_game', { name }))}</p>
        <ul class="cx-list">${games.map((g) => `<li><button type="button" class="cx-row" data-g="${esc(g.id)}">
            <span class="cx-row-main"><span class="cx-row-name">${esc(g.name)}</span></span>
            <span class="cx-chev" aria-hidden="true">&rsaquo;</span>
          </button></li>`).join('')}</ul>`,
    });
    if (!current(gen)) return;
    for (const b of card.querySelectorAll('[data-g]')) {
      b.addEventListener('click', () => challenge(b.dataset.g, { code: them.code, name: them.name, emoji: them.emoji }));
    }
  }

  // --- cancel / decline / resign one live match (2026-10-13) ---
  // The row's button says what it expects; this screen RE-READS the match, because the row can be a
  // turn behind (they may have just played, so a cancel has become a resignation). Nothing happens
  // until the second tap, and the button says what that tap does.
  async function renderEnd(game, id, back) {
    const gen = ++_view;
    S.view = 'end';
    const row = (S.rows || []).find((r) => r.game === game && r.id === id) || { name: '', emoji: '🙂' };
    const name = row.name || t('cx_someone');
    shell(card, { title: name, emoji: row.emoji, back, body: `<p class="cx-note">${esc(t('cx_loading'))}</p>` });
    const action = await endAction(game, id);
    if (!current(gen)) return;
    if (!action) {
      shell(card, { title: name, emoji: row.emoji, back, body: `<p class="cx-note">${esc(t('cx_end_gone'))}</p>` });
      return;
    }
    const paint = (err = '') => {
      shell(card, {
        title: name, emoji: row.emoji, back,
        body: `<p class="cx-confirm"><strong>${esc(t(`cx_end_q_${action}`))}</strong></p>
          <p class="cx-confirm">${esc(t(`cx_end_b_${action}`, { game: nameOf(game), name }))}</p>
          ${err ? `<p class="cx-err" role="alert">${esc(err)}</p>` : ''}`,
        footer: `<button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="yes">${esc(t(`cx_end_yes_${action}`))}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="no">${esc(t(action === 'resign' ? 'cx_end_keep_playing' : 'cx_end_keep'))}</button>`,
      });
      if (!current(gen)) return;
      card.querySelector('[data-role="no"]').addEventListener('click', back);
      const yes = card.querySelector('[data-role="yes"]');
      yes.addEventListener('click', async () => {
        yes.disabled = true;
        const res = await endMatch(game, id, action);
        if (!current(gen)) return;
        if (res && res.ok) {
          // A resign on a match that turned out to be unanswered was called off instead (mp.js).
          const why = res.cancelled ? String((res.game && res.game.over && res.game.over.why) || (action === 'decline' ? 'declined' : 'cancelled')) : '';
          S.flash = why ? t(why === 'declined' ? 'cx_end_done_decline' : 'cx_end_done_cancel') : t('cx_end_done_resign', { name });
          // The list catches up from the game's own watch; until then, show it as ended here.
          S.rows = (S.rows || []).map((r) => (r.game === game && r.id === id
            ? { ...r, state: why ? 'cancelled' : 'done', ended: why, result: why ? null : 'lost', resigned: !why,
              sent: why === 'cancelled' ? true : why === 'declined' ? false : r.sent, open: '', expires: 0, updated: Date.now() }
            : r));
          back();
          return;
        }
        const reason = res && res.reason;
        paint(reason === 'accepted' ? t('cx_end_err_accepted', { name })
          : reason === 'offline' ? t('cx_end_err_offline')
            : reason === 'already-over' ? t('cx_end_gone') : t('cx_end_err'));
      });
    };
    paint();
  }

  // A live change repaints the screen that shows challenges; the pickers are left alone.
  // The list keeps its scroll position, so a turn arriving does not throw the reader to the top.
  const repaint = () => {
    if (!_host) return;
    const sc = card.querySelector('.cx-scroll');
    const top = sc ? sc.scrollTop : 0;
    if (S.view === 'home') renderHome();
    else if (S.view === 'opp') renderOpponent(S.opp);
    else return;
    const after = card.querySelector('.cx-scroll');
    if (after && top) after.scrollTop = top;
  };

  renderHome();
  const { rows, failed } = await loadAll(ids);
  if (!_host) return;
  S.rows = rows; S.failed = failed;
  repaint();
  const stop = await watchAll(ids.filter((g) => !failed.includes(g)), (live, heard) => {
    // Replace only the games this update speaks for; the rest keep what was read.
    const covered = new Set(heard);
    S.rows = (S.rows || []).filter((r) => !covered.has(r.game)).concat(live);
    repaint();
  });
  if (!_host) { try { stop(); } catch { /* fine */ } } else _unwatch = stop;
}
