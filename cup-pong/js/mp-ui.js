// cup-pong/js/mp-ui.js - the MULTIPLAYER screens (2026-09-28): your matches, challenging someone,
// history, and the Game Over popup for a match that ended while you were away. DOM only; the data
// is cup-pong/js/mp.js and the match itself is played in ui.js. Lazily imported, so a player who
// never opens multiplayer downloads none of it. Modelled on Hoops' multiplayer home
// (hoops4/CLAUDE.md, "The multiplayer home, reorganised"): one primary button, then "Your turn",
// then "Their turn", then History.
import { makeT } from '../../js/i18n.js';
import { STRINGS } from './strings.js';

const t = makeT(STRINGS);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RR = [0, 1, 2, 3, 'inf'];

function page(game, title, backRole, body) {
  game.unbindAll();
  game.root.innerHTML = `
    <div class="cp-mp">
      <div class="cp-mp-top">
        <button type="button" class="cp-back" data-role="${backRole}">‹ ${esc(backRole === 'setup' ? t('title') : t('multiplayer'))}</button>
        <h1 class="cp-mp-title">${esc(title)}</h1>
      </div>
      <div class="cp-mp-body">${body}</div>
    </div>`;
  game.on(game.root.querySelector('.cp-back'), 'click', () => {
    if (backRole === 'setup') game.renderSetup(); else home(game, game.MP);
  });
  return game.root.querySelector('.cp-mp-body');
}

function reasonText(reason) {
  if (reason === 'denied') return t('mpDenied');
  if (reason === 'offline') return t('mpOffline');
  if (reason === 'dev-origin-blocked') return t('mpDevBlocked');
  if (reason === 'no-player-code') return t('mpNoCode');
  return t('sendFailed');
}

const rowHTML = (r) => `
  <button type="button" class="cp-mrow${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
    <span class="cp-trow-face" aria-hidden="true">${esc(r.emoji)}</span>
    <span class="cp-mrow-text"><span class="cp-mrow-name">${esc(r.name)}</span>
      <span class="cp-mrow-sub">${r.rebuttal ? esc(t('rebuttal')) : esc(t('cupsVs', { a: r.mine, b: r.theirs, name: r.name }))}</span></span>
    <span class="cp-row-chev" aria-hidden="true">›</span>
  </button>`;

/** The multiplayer home. */
export async function home(game, MP) {
  const body = page(game, t('multiplayer'), 'setup', `
    <button type="button" class="gh-btn gh-btn--primary gh-btn--block cp-mp-go" data-role="challenge">${t('challengeSomeone')}</button>
    <div class="cp-mp-push" hidden></div>
    <div class="cp-mp-list"><p class="cp-mp-note">${t('loading')}</p></div>
    <button type="button" class="cp-mp-link" data-role="history">${t('history')} ›</button>`);
  game.on(body.querySelector('[data-role="challenge"]'), 'click', () => picker(game, MP));
  game.on(body.querySelector('[data-role="history"]'), 'click', () => history(game, MP));
  pushRow(game, body.querySelector('.cp-mp-push'));
  const rows = await MP.readMyGames();
  if (!body.isConnected) return;
  try { MP.recordFinished(rows); } catch (err) { console.warn('[cup-pong] recordFinished', err); }
  const live = rows.filter((r) => !r.over);
  const mine = live.filter((r) => r.yourTurn);
  const theirs = live.filter((r) => !r.yourTurn);
  const list = body.querySelector('.cp-mp-list');
  list.innerHTML = (mine.length ? `<h2 class="cp-mp-h">${t('yourTurn')} <span>${mine.length}</span></h2>${mine.map(rowHTML).join('')}` : '')
    + (theirs.length ? `<h2 class="cp-mp-h">${t('theirTurnH')} <span>${theirs.length}</span></h2>${theirs.map(rowHTML).join('')}` : '')
    + (live.length ? '' : `<p class="cp-mp-note">${t('noMatches')}</p>`);
  game.on(list, 'click', (e) => {
    const b = e.target.closest('.cp-mrow');
    if (b) game.openMatch(b.dataset.id);
  });
  showUnseen(game, MP, rows);
}

/** "Notify me when it's my turn" - only while notifications are off on this phone. */
async function pushRow(game, box) {
  try {
    const P = await import('../../js/push.js');
    const st = await P.pushState();
    if (st !== 'off' || !box.isConnected) return;
    box.innerHTML = `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block">${t('notifyMe')}</button>`;
    box.hidden = false;
    game.on(box.querySelector('button'), 'click', async () => {
      const res = await P.enablePush();
      if (res && res.ok) box.hidden = true;
    });
  } catch { /* no push on this phone: nothing to offer */ }
}

/** Who to challenge. */
async function picker(game, MP) {
  const body = page(game, t('challengeSomeone'), 'mp', `
    <input type="search" class="gh-input cp-mp-search" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}">
    <div class="cp-mp-list"><p class="cp-mp-note">${t('loading')}</p></div>`);
  const opps = await MP.readOpponents();
  if (!body.isConnected) return;
  const list = body.querySelector('.cp-mp-list');
  const paint = (q) => {
    const k = String(q || '').trim().toLowerCase();
    const show = opps.filter((o) => !k || o.name.toLowerCase().includes(k));
    list.innerHTML = show.length ? show.map((o) => `
      <button type="button" class="cp-mrow" data-code="${esc(o.code)}">
        <span class="cp-trow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="cp-mrow-text"><span class="cp-mrow-name">${esc(o.name)}</span></span>
        <span class="cp-row-chev" aria-hidden="true">›</span>
      </button>`).join('') : `<p class="cp-mp-note">${t('noOpponents')}</p>`;
  };
  paint('');
  game.on(body.querySelector('.cp-mp-search'), 'input', (e) => paint(e.target.value));
  game.on(list, 'click', (e) => {
    const b = e.target.closest('.cp-mrow');
    const o = b && opps.find((x) => x.code === b.dataset.code);
    if (o) terms(game, MP, o);
  });
}

/** The rules of this challenge, frozen for both players (brief 4a). */
function terms(game, MP, them) {
  const s = game.settings;
  let gent = s.gentlemans !== false;
  let rr = RR.includes(s.reracks) ? s.reracks : 2;
  const seg = (role, items, cur) => `<div class="gh-seg" role="group" data-role="${role}">${items.map(([v, label]) =>
    `<button type="button" class="gh-seg__item" data-v="${v}" aria-pressed="${v === cur}"><span>${label}</span></button>`).join('')}</div>`;
  const body = page(game, t('challengeSomeone'), 'mp', `
    <div class="gh-card cp-setup-card">
      <p class="cp-vs"><span aria-hidden="true">${esc(them.emoji)}</span> ${esc(them.name)}</p>
      <p class="cp-setup-label">${t('gentlemans')} <span class="cp-setup-hint">${t('gentlemansHint')}</span></p>
      ${seg('gent', [['on', t('on')], ['off', t('off')]], gent ? 'on' : 'off')}
      <p class="cp-setup-label">${t('reracks')} <span class="cp-setup-hint">${t('reracksHint')}</span></p>
      ${seg('rr', RR.map((n) => [String(n), n === 'inf' ? '∞' : String(n)]), String(rr))}
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="send">${t('startChallenge')}</button>
      <p class="cp-mp-note cp-mp-err" aria-live="polite" hidden></p>
    </div>`);
  for (const role of ['gent', 'rr']) {
    const g = body.querySelector(`[data-role="${role}"]`);
    game.on(g, 'click', (e) => {
      const b = e.target.closest('.gh-seg__item');
      if (!b) return;
      for (const x of g.querySelectorAll('.gh-seg__item')) x.setAttribute('aria-pressed', String(x === b));
      if (role === 'gent') gent = b.dataset.v === 'on';
      else rr = b.dataset.v === 'inf' ? 'inf' : Number(b.dataset.v);
    });
  }
  const send = body.querySelector('[data-role="send"]');
  game.on(send, 'click', async () => {
    send.disabled = true;
    const res = await game.sendChallenge(them, { gent, rr });
    if (res && !res.ok && body.isConnected) {
      const err = body.querySelector('.cp-mp-err');
      err.textContent = reasonText(res.reason);
      err.hidden = false;
      send.disabled = false;
    }
  });
}

/** Finished matches: a record per opponent, then each match. */
async function history(game, MP) {
  const body = page(game, t('history'), 'mp', `<div class="cp-mp-list"><p class="cp-mp-note">${t('loading')}</p></div>`);
  const rows = await MP.readMyGames();
  if (!body.isConnected) return;
  const { opponents, finished } = MP.recordsFrom(rows, MP.myCode());
  const list = body.querySelector('.cp-mp-list');
  if (!finished.length) { list.innerHTML = `<p class="cp-mp-note">${t('noHistory')}</p>`; return; }
  const word = (r) => (r.result === 'won' ? (r.resigned === 'them' ? t('wonTheyQuit') : t('won'))
    : r.result === 'lost' ? (r.resigned === 'me' ? t('youQuit') : t('lost')) : t('finished'));
  const mark = (r) => (r.result === 'won' ? '✓' : r.result === 'lost' ? '✗' : '=');
  list.innerHTML = `<h2 class="cp-mp-h">${t('records')}</h2>` + opponents.map((o) => `
      <div class="cp-mrow is-static">
        <span class="cp-trow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="cp-mrow-text"><span class="cp-mrow-name">${esc(o.name)}</span></span>
        <span class="cp-rec"><b>${o.won}</b>-<b>${o.lost}</b></span>
      </div>`).join('')
    + `<h2 class="cp-mp-h">${t('matches')}</h2>` + finished.slice(0, 30).map((r) => `
      <div class="cp-mrow is-static${r.result === 'won' ? ' is-won' : ''}">
        <span class="cp-hmark" aria-hidden="true">${mark(r)}</span>
        <span class="cp-mrow-text"><span class="cp-mrow-name">${esc(r.name)}</span>
          <span class="cp-mrow-sub">${esc(word(r))} · ${esc(new Date(r.updated).toLocaleDateString())}</span></span>
      </div>`).join('');
}

/** GAME OVER, for a match that ended while this phone was away (Hoops' lesson, 2026-09-24:
 *  "there isn't a You Lost screen or anything. the game just disappears"). */
export function showUnseen(game, MP, rows) {
  const ids = MP.readUnseen();
  const ended = (rows || []).filter((r) => r.over && ids.includes(r.id)).sort((a, b) => b.updated - a.updated);
  if (!ended.length || game.root.querySelector('.cp-unseen')) return;
  const r = ended[0];
  const el = document.createElement('div');
  el.className = 'gh-overlay cp-unseen';
  el.innerHTML = `
    <div class="gh-modal cp-card" role="dialog" aria-modal="true" aria-label="${t('gameOver')}">
      <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
      <p class="cp-card-kicker">${t('gameOver')}</p>
      <h2 class="cp-card-title">${r.result === 'won' ? t('youWin') : t('youLose')}</h2>
      <p class="cp-card-line">${esc(r.emoji)} ${esc(t(r.result === 'won' ? 'youWonVs' : 'youLostVs', { name: r.name }))}${r.why === 'resign' ? ` · ${esc(r.result === 'won' ? t('wonTheyQuit') : t('youQuit'))}` : ''}</p>
      ${ended.length > 1 ? `<p class="cp-card-line">${t('moreN', { n: ended.length - 1 })}</p>` : ''}
      <div class="gh-modal__actions">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="ok">${t('ok')}</button>
      </div>
    </div>`;
  game.root.appendChild(el);
  const done = () => { for (const x of ended) MP.markResultSeen(x.id); el.remove(); };
  game.on(el.querySelector('[data-role="ok"]'), 'click', done);
  game.on(el.querySelector('[data-role="close"]'), 'click', done);
}

export default { home, showUnseen };
