// cup-pong/js/mp-ui.js - the MULTIPLAYER screens (2026-09-28): your matches, challenging someone,
// history, and the Game Over popup for a match that ended while you were away. DOM only; the data
// is cup-pong/js/mp.js and the match itself is played in ui.js. Lazily imported, so a player who
// never opens multiplayer downloads none of it. Modelled on Hoops' multiplayer home
// (hoops4/CLAUDE.md, "The multiplayer home, reorganised"): one primary button, then "Your turn",
// then "Their turn", then History.
import { makeT } from '../../js/i18n.js';
import { onlineGateText } from '../../js/online-gate.js';
import { STRINGS } from './strings.js';

const t = makeT(STRINGS);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RR = [0, 1, 2, 3, 'inf'];

function page(game, title, backRole, body) {
  game.unbindAll();
  game.root.innerHTML = `
    <div class="cp-mp">
      <div class="cp-mp-top">
        <button type="button" class="cp-back" data-role="${backRole}">‹ ${esc(backRole === 'setup' ? t('title') : t('tabOnline'))}</button>
        <h1 class="cp-mp-title">${esc(title)}</h1>
      </div>
      <div class="cp-mp-body">${body}</div>
    </div>`;
  game.on(game.root.querySelector('.cp-back'), 'click', () => {
    // Multiplayer lives on the setup screen's Online tab since 2026-11-07 (fillOnline below).
    if (backRole === 'setup') game.renderSetup(); else game.renderSetup('online');
  });
  return game.root.querySelector('.cp-mp-body');
}

function reasonText(reason) {
  const gate = onlineGateText(reason);
  if (gate) return gate;
  if (reason === 'denied') return t('mpDenied');
  if (reason === 'offline') return t('mpOffline');
  if (reason === 'dev-origin-blocked') return t('mpDevBlocked');
  if (reason === 'no-player-code') return t('mpNoCode');
  if (reason === 'expired') return t('mpExpired');
  return t('sendFailed');
}

/** "Game 2 of 3 · Straight up": only what differs from a plain one-off classic match. */
const tags = (r) => [r.series > 1 ? t('gameOf', { n: r.seriesNo, m: r.series }) : '', r.su ? t('straightUp') : ''].filter(Boolean);
const rowHTML = (r) => `
  <button type="button" class="cp-mrow${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
    <span class="cp-trow-face" aria-hidden="true">${esc(r.emoji)}</span>
    <span class="cp-mrow-text"><span class="cp-mrow-name">${esc(r.name)}</span>
      <span class="cp-mrow-sub">${esc([r.rebuttal ? t('rebuttal') : t('cupsVs', { a: r.mine, b: r.theirs, name: r.name }), ...tags(r)].join(' · '))}</span></span>
    <span class="cp-row-chev" aria-hidden="true">›</span>
  </button>`;

/**
 * Finished series games still owed a next game (Hoops' owedSeries). Reads each candidate match,
 * since the row does not carry the score. Only the one who LOST the last game may start the next.
 */
async function owedSeries(MP, rows) {
  const me = MP.myCode();
  const cands = (rows || []).filter((r) => r && r.over && r.series > 1
    && !(rows || []).some((x) => x && x.seriesOf === r.seriesOf && (x.seriesNo | 0) > (r.seriesNo | 0)));
  const out = [];
  for (const r of cands.slice(0, 8)) {
    let g = null;
    try { g = await MP.readGame(r.id); } catch { g = null; }
    if (!g || !g.over) continue;
    const st = MP.seriesAfter(g);
    const side = MP.sideOf(g, me);
    if (st.done || !side) continue;
    const mineW = side === 'a' ? st.wins.a : st.wins.b, theirW = side === 'a' ? st.wins.b : st.wins.a;
    out.push({ game: g, row: r, next: st.no + 1, mine: MP.seriesStarter(g) === side, score: t('seriesScore', { a: mineW, b: theirW }) });
  }
  return out;
}
const owedHTML = (o) => o.mine ? `
  <button type="button" class="cp-mrow is-mine" data-next="${esc(o.game.id)}">
    <span class="cp-trow-face" aria-hidden="true">${esc(o.row.emoji)}</span>
    <span class="cp-mrow-text"><span class="cp-mrow-name">${esc(o.row.name)}</span>
      <span class="cp-mrow-sub">${esc(o.score)}</span></span>
    <span class="cp-trow-go">${esc(t('startGameN', { n: o.next }))}</span>
  </button>` : `
  <div class="cp-mrow is-static">
    <span class="cp-trow-face" aria-hidden="true">${esc(o.row.emoji)}</span>
    <span class="cp-mrow-text"><span class="cp-mrow-name">${esc(o.row.name)}</span>
      <span class="cp-mrow-sub">${esc(o.score)} · ${esc(t('waitGameN', { name: o.row.name, n: o.next }))}</span></span>
  </div>`;

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
  const owed = await owedSeries(MP, rows);
  if (!body.isConnected) return;
  const mine = live.filter((r) => r.yourTurn);
  const theirs = live.filter((r) => !r.yourTurn);
  const oMine = owed.filter((o) => o.mine), oTheirs = owed.filter((o) => !o.mine);
  const list = body.querySelector('.cp-mp-list');
  const nMine = mine.length + oMine.length, nTheirs = theirs.length + oTheirs.length;
  list.innerHTML = (nMine ? `<h2 class="cp-mp-h">${t('yourTurn')} <span>${nMine}</span></h2>${oMine.map(owedHTML).join('')}${mine.map(rowHTML).join('')}` : '')
    + (nTheirs ? `<h2 class="cp-mp-h">${t('theirTurnH')} <span>${nTheirs}</span></h2>${oTheirs.map(owedHTML).join('')}${theirs.map(rowHTML).join('')}` : '')
    + (nMine + nTheirs ? '' : `<p class="cp-mp-note">${t('noMatches')}</p>`);
  game.on(list, 'click', async (e) => {
    const nx = e.target.closest('[data-next]');
    if (nx) {
      const o = owed.find((x) => x.game.id === nx.dataset.next);
      nx.disabled = true;
      const res = o && await game.startNextGame(o.game);
      if (res && !res.ok) { nx.disabled = false; game.toast(reasonText(res.reason), 2400); }
      return;
    }
    const b = e.target.closest('.cp-mrow[data-id]');
    if (b) game.openMatch(b.dataset.id);
  });
  showUnseen(game, MP, rows);
}

/**
 * THE SETUP SCREEN'S ONLINE TAB (2026-11-07, Matt's approved mockup B): the matches going (your turn
 * first, with Play), then Challenge: the people played most recently, one tap each, and Anyone (the
 * full list). The record chip opens History. Fills `box`; returns { active, mine } for the tab.
 */
export async function fillOnline(game, MP, box) {
  const rows = await MP.readMyGames();
  if (!box.isConnected) return null;
  try { MP.recordFinished(rows); } catch (err) { console.warn('[cup-pong] recordFinished', err); }
  const live = rows.filter((r) => !r.over);
  const owed = await owedSeries(MP, rows);
  if (!box.isConnected) return null;
  const mine = live.filter((r) => r.yourTurn), theirs = live.filter((r) => !r.yourTurn);
  const oMine = owed.filter((o) => o.mine), oTheirs = owed.filter((o) => !o.mine);
  const nMatches = live.length + owed.length;
  // Most recent first, one face per person; an index into this list, never a code, in the page.
  const seen = new Set();
  const recent = rows.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .filter((r) => r.with && !seen.has(r.with) && seen.add(r.with))
    .slice(0, 4).map((r) => ({ code: r.with, name: r.name, emoji: r.emoji }));
  let won = 0, lost = 0;
  try { for (const o of MP.recordsFrom(rows, MP.myCode()).opponents) { won += o.won | 0; lost += o.lost | 0; } } catch { /* no chip */ }
  const chip = won + lost ? `<button type="button" class="cp-rec-chip" data-role="history">${won}-${lost}</button>` : '';
  const sub = (r) => esc([r.rebuttal ? t('rebuttal') : t('cupsTo', { a: r.mine, b: r.theirs }), ...tags(r)].join(' · '));
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || n;
  const liveRow = (r) => `
    <button type="button" class="cp-mrow${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
      <span class="cp-trow-face" aria-hidden="true">${esc(r.emoji)}</span>
      <span class="cp-mrow-text"><span class="cp-mrow-name">${esc(r.name)}</span>
        <span class="cp-mrow-sub">${r.yourTurn ? sub(r) : `${esc(t('theirTurn', { name: r.name }))} · ${sub(r)}`}</span></span>
      ${r.yourTurn ? `<span class="cp-play-pill">${t('play')}</span>` : '<span class="cp-row-chev" aria-hidden="true">›</span>'}
    </button>`;
  box.innerHTML = (nMatches ? `
      <div class="gh-card cp-on-card">
        <div class="cp-on-head"><span>${t('matches')}</span>${chip}</div>
        ${oMine.map(owedHTML).join('')}${mine.map(liveRow).join('')}${oTheirs.map(owedHTML).join('')}${theirs.map(liveRow).join('')}
      </div>` : '') + `
      <div class="gh-card cp-on-card">
        <div class="cp-on-head"><span>${t('challengeH')}</span>${nMatches ? '' : chip}</div>
        <div class="cp-faces">
          <button type="button" class="cp-face is-any" data-role="anyone"><span class="cp-face-dot" aria-hidden="true">+</span><span class="cp-face-name">${t('anyone')}</span></button>
          ${recent.map((o, i) => `<button type="button" class="cp-face" data-oi="${i}"><span class="cp-face-dot" aria-hidden="true">${esc(o.emoji)}</span><span class="cp-face-name">${esc(first(o.name))}</span></button>`).join('')}
        </div>
      </div>
      <div class="cp-mp-push" hidden></div>`;
  game.on(box, 'click', async (e) => {
    const nx = e.target.closest('[data-next]');
    if (nx) {
      const o = owed.find((x) => x.game.id === nx.dataset.next);
      nx.disabled = true;
      const res = o && await game.startNextGame(o.game);
      if (res && !res.ok) { nx.disabled = false; game.toast(reasonText(res.reason), 2400); }
      return;
    }
    const m = e.target.closest('.cp-mrow[data-id]');
    if (m) { game.openMatch(m.dataset.id); return; }
    if (e.target.closest('[data-role="history"]')) { history(game, MP); return; }
    if (e.target.closest('[data-role="anyone"]')) { picker(game, MP); return; }
    const f = e.target.closest('.cp-face[data-oi]');
    const them = f && recent[Number(f.dataset.oi)];
    if (them) terms(game, MP, them);
  });
  pushRow(game, box.querySelector('.cp-mp-push'));
  showUnseen(game, MP, rows);
  return { active: nMatches > 0, mine: mine.length + oMine.length };
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
      <button type="button" class="cp-mrow" data-oi="${opps.indexOf(o)}">
        <span class="cp-trow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="cp-mrow-text"><span class="cp-mrow-name">${esc(o.name)}</span></span>
        <span class="cp-row-chev" aria-hidden="true">›</span>
      </button>`).join('') : `<p class="cp-mp-note">${t('noOpponents')}</p>`;
  };
  paint('');
  game.on(body.querySelector('.cp-mp-search'), 'input', (e) => paint(e.target.value));
  game.on(list, 'click', (e) => {
    const b = e.target.closest('.cp-mrow');
    const o = b && opps[Number(b.dataset.oi)];
    if (o) terms(game, MP, o);
  });
}

/** Straight onto `them`'s terms: the hub's Challenges screen hands a person over (2026-10-05). */
export function challengeTo(game, MP, them) { terms(game, MP, them); }

/** The rules of this challenge, frozen for both players (brief 4a). */
function terms(game, MP, them) {
  const s = game.settings;
  let gent = s.gentlemans !== false;
  let rr = RR.includes(s.reracks) ? s.reracks : 2;
  let su = false, series = 1;
  const seg = (role, items, cur) => `<div class="gh-seg" role="group" data-role="${role}">${items.map(([v, label]) =>
    `<button type="button" class="gh-seg__item" data-v="${v}" aria-pressed="${v === cur}"><span>${label}</span></button>`).join('')}</div>`;
  const body = page(game, t('challengeSomeone'), 'mp', `
    <div class="gh-card cp-setup-card">
      <p class="cp-vs"><span aria-hidden="true">${esc(them.emoji)}</span> ${esc(them.name)}</p>
      <p class="cp-setup-label">${t('series')}</p>
      ${seg('series', [['1', t('oneGame')], ['3', t('bestOf', { n: 3 })], ['5', t('bestOf', { n: 5 })]], '1')}
      <p class="cp-setup-label">${t('mode')}</p>
      ${seg('su', [['off', t('classic')], ['on', t('straightUp')]], 'off')}
      <p class="cp-setup-hint cp-su-hint" hidden>${t('straightHint')}</p>
      <div class="cp-assists">
      <p class="cp-setup-label">${t('gentlemans')} <span class="cp-setup-hint">${t('gentlemansHint')}</span></p>
      ${seg('gent', [['on', t('on')], ['off', t('off')]], gent ? 'on' : 'off')}
      <p class="cp-setup-label">${t('reracks')} <span class="cp-setup-hint">${t('reracksHint')}</span></p>
      ${seg('rr', RR.map((n) => [String(n), n === 'inf' ? '∞' : String(n)]), String(rr))}
      </div>
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="send">${t('startChallenge')}</button>
      <p class="cp-mp-note cp-mp-err" aria-live="polite" hidden></p>
    </div>`);
  for (const role of ['gent', 'rr', 'su', 'series']) {
    const g = body.querySelector(`[data-role="${role}"]`);
    game.on(g, 'click', (e) => {
      const b = e.target.closest('.gh-seg__item');
      if (!b) return;
      for (const x of g.querySelectorAll('.gh-seg__item')) x.setAttribute('aria-pressed', String(x === b));
      if (role === 'gent') gent = b.dataset.v === 'on';
      else if (role === 'su') {
        su = b.dataset.v === 'on';
        // Straight up has no assists to choose: the Gentleman's and Reracks rows go, a line says why.
        body.querySelector('.cp-assists').hidden = su;
        body.querySelector('.cp-su-hint').hidden = !su;
      } else if (role === 'series') series = Number(b.dataset.v);
      else rr = b.dataset.v === 'inf' ? 'inf' : Number(b.dataset.v);
    });
  }
  const send = body.querySelector('[data-role="send"]');
  game.on(send, 'click', async () => {
    send.disabled = true;
    const res = await game.sendChallenge(them, su ? { su: true } : { gent, rr }, { series });
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
  const word = (r) => (r.timedOut ? t('timedOut') : r.result === 'won' ? (r.resigned === 'them' ? t('wonTheyQuit') : t('won'))
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
          <span class="cp-mrow-sub">${esc([word(r), ...tags(r), new Date(r.updated).toLocaleDateString()].join(' · '))}</span></span>
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
      <p class="cp-card-line">${esc(r.emoji)} ${esc(t(r.result === 'won' ? 'youWonVs' : 'youLostVs', { name: r.name }))}${r.why === 'timeout' ? ` · ${esc(t('timedOut'))}` : r.why === 'resign' ? ` · ${esc(r.result === 'won' ? t('wonTheyQuit') : t('youQuit'))}` : ''}</p>
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

export default { home, showUnseen, challengeTo, fillOnline };
