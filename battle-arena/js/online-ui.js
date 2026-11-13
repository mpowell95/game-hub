// battle-arena/js/online-ui.js - BATTLE ARENA ONLINE (2026-10-24): the screens and the two "links"
// that tie a match on the battle screen (ui.js) to the network. Lazily imported by ui.js, so a
// player who only plays the computer downloads none of it.
//
//   Online home   Challenge · Host / Join · your challenges (yours first), cut to fit (no scrolling)
//   Challenge     pick a person (search) -> draft YOUR team -> the match opens, you move first
//   Host          draft -> a room code to share -> the match starts when they join
//   Join          the code -> draft -> the match
//
// THE LINK is what ui.js knows about a match's network side: { kind, seat, timed, them, send(),
// menuItems(), finish(), done(), resync(), mountChat(), destroy() }. ChallengeLink is turn by turn
// (mp.js, no clock); LiveLink is a live room (live.js over js/net.js, 25 s a move).
// FEWEST WORDS (root CLAUDE.md): names, numbers, one word per button. Profile names, never "You".
import { makeT, myName } from '../../js/i18n.js';
import { onlineGateText } from '../../js/online-gate.js';
import { loadProfile } from '../../js/profile-store.js';
import { STRINGS } from './strings.js';
import * as MP from './mp.js';
import { LiveRoom, readRoomSave, clearRoomSave, countLive, CLAIM_MS, STALE_MS } from './live.js';
import { seatOfSide, sideOfSeat, onlineMode, matchDetail } from './online.js';
import { lobbyBG, monsterSVG } from './art.js';

const t = makeT(STRINGS);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON = {
  swords: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><path d="M2.5 2.5h4l9 9-4 4-9-9z"/><path d="M21.5 2.5h-4l-9 9 4 4 9-9z" opacity=".75"/></g><g stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M10.5 17.5l7-7M16 16l4.5 4.5M13.5 17.5l-7-7M8 16l-4.5 4.5"/></g></svg>',
  host: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
  join: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M3 12h11M10 8l4 4-4 4"/></g></svg>',
};
const NODE = MP.NODE;
const myEmoji = () => { try { return (loadProfile() || {}).emoji || '🙂'; } catch { return '🙂'; } };

export function reasonText(reason) {
  const gate = onlineGateText(reason);
  if (gate) return gate;
  if (reason === 'offline' || reason === 'did-not-land') return t('e_offline');
  if (reason === 'not-found') return t('e_notFound');
  if (reason === 'full') return t('e_full');
  if (reason === 'version') return t('e_version');
  if (reason === 'dev-origin-blocked') return t('e_dev');
  if (reason === 'expired') return t('e_expired');
  return t('e_failed');
}

/** The entry point from ui.js. `armed`: only a handed-over match or a live room to resume (resolves
 *  true when one took the screen); otherwise the online home. */
export async function open(ui, { armed = false } = {}) {
  if (armed) {
    let o = null;
    try { o = (await import('./alert.js')).takeOpen(); } catch { o = null; }
    if (o && o.kind === 'pick') { pickTeamFor(ui, o.them); return true; }
    if (o && o.id) { await openChallenge(ui, o.id); return true; }
    const save = readRoomSave();
    if (save) return resumeLive(ui, save);
    return false;
  }
  ui.renderHome('online');
  return true;
}

// --- the screens --------------------------------------------------------------------------------
function frame(ui, name, title, body) {
  ui.newScreen(name);
  ui.root.innerHTML = `
    ${lobbyBG(true)}
    <div class="ba-draft ba-online">
      <div class="ba-draft-top">
        <button type="button" class="ba-iconbtn" data-role="back" aria-label="${esc(t('back'))}">${BACK}</button>
        <h2 class="ba-online-title">${title}</h2>
        <span class="ba-iconbtn-spacer"></span>
      </div>
      ${body}
    </div>`;
  return ui.root.querySelector('.ba-online');
}

/** NO SCROLLING: drop rows from the end until the screen fits, and say how many are not shown. */
function fitList(box, list, extra = 0) {
  if (!list || !list.isConnected) return;
  const over = () => box.scrollHeight > box.clientHeight + 1;
  let dropped = 0;
  const note = () => {
    let el = list.querySelector('.ba-ol-more');
    const n = extra + dropped;
    if (n > 0 && !el) { el = document.createElement('p'); el.className = 'ba-ol-note ba-ol-more'; list.appendChild(el); }
    if (el) el.textContent = t('more', { n });
  };
  note();
  let rows = [...list.querySelectorAll('.ba-ol-row')];
  while (over() && rows.length > 1) {
    rows.pop().remove();
    dropped++;
    for (const h of list.querySelectorAll('.ba-ol-h')) {
      const nx = h.nextElementSibling;
      if (!nx || !nx.classList.contains('ba-ol-row')) h.remove();
    }
    note();
    rows = [...list.querySelectorAll('.ba-ol-row')];
  }
}

function rowHTML(r) {
  const sub = r.mine || r.theirs ? `${myName()} ${r.mine} · ${r.name || '?'} ${r.theirs}` : '';
  return `<button type="button" class="ba-ol-row${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
    <span class="ba-ol-face" aria-hidden="true">${esc(r.emoji)}</span>
    <span class="ba-ol-text"><span class="ba-ol-name">${esc(r.name || '?')}</span>${sub ? `<span class="ba-ol-sub">${esc(sub)}</span>` : ''}</span>
    <span class="ba-ol-chev" aria-hidden="true">${r.yourTurn ? '▶' : '›'}</span>
  </button>`;
}

/** The old Online screen is the home screen's Online tab since 2026-11-07: back to it, with a note. */
export function home(ui, note = '') {
  ui.leaveOnline();
  ui.renderHome('online', note);
}

/**
 * THE HOME SCREEN'S ONLINE TAB (2026-11-07, the Cup Pong way): Matches (your turn first with Play, then
 * their turn), Challenge (Anyone = the full list, then the 4 people played most recently), then the live-room
 * buttons Host / Join. Fills `box`; returns { active, mine }.
 */
export async function fillOnline(ui, box, note = '') {
  const gen = ui.gen;
  box.innerHTML = `
    <div class="ba-ol-live"><p class="ba-ol-note">…</p></div>
    <div class="ba-ol-pair">
      <button type="button" class="ba-steelbtn" data-role="host">${ICON.host}<span>${esc(t('host'))}</span></button>
      <button type="button" class="ba-steelbtn" data-role="join">${ICON.join}<span>${esc(t('join'))}</span></button>
    </div>
    <p class="ba-ol-note ba-ol-err" aria-live="polite"${note ? '' : ' hidden'}>${esc(note)}</p>
    <div class="ba-ol-push" hidden></div>`;
  ui.on(box.querySelector('[data-role="host"]'), 'click', () => hostDraft(ui));
  ui.on(box.querySelector('[data-role="join"]'), 'click', () => joinCode(ui));
  pushRow(ui, box);
  try { await MP.drainOutbox(); } catch { /* sent next time */ }
  const rows = await MP.readMyGames();
  if (gen !== ui.gen || !box.isConnected) return null;
  try { MP.recordFinished(rows); } catch (err) { console.warn('[battle-arena] recordFinished', err); }
  const live = rows.filter((r) => !r.over);
  const mine = live.filter((r) => r.yourTurn), theirs = live.filter((r) => !r.yourTurn);
  const all = mine.concat(theirs);
  let nShow = Math.min(all.length, 4);
  // Most recent first, one face per person; an index into this list, never a code, in the page.
  const seen = new Set();
  const recent = rows.slice().sort((x, y) => (y.updated || 0) - (x.updated || 0))
    .filter((r) => r.with && !seen.has(r.with) && seen.add(r.with))
    .slice(0, 4).map((r) => ({ code: r.with, name: r.name, emoji: r.emoji }));
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || n;
  const liveRow = (r) => `
    <button type="button" class="ba-ol-row${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
      <span class="ba-ol-face" aria-hidden="true">${esc(r.emoji)}</span>
      <span class="ba-ol-text"><span class="ba-ol-name">${esc(r.name || '?')}</span>
        <span class="ba-ol-sub">${esc(r.yourTurn ? `${r.mine} - ${r.theirs}` : t('turnOf', { name: r.name || '?' }).replace(/\.$/, ''))}</span></span>
      ${r.yourTurn ? `<span class="ba-play-pill">${esc(t('play'))}</span>` : '<span class="ba-ol-chev" aria-hidden="true">›</span>'}
    </button>`;
  const matchesCard = () => `
      <div class="ba-on-card">
        <div class="ba-on-head">${esc(t('matchesH'))}</div>
        ${all.slice(0, nShow).map(liveRow).join('')}${all.length > nShow ? `<p class="ba-ol-note">${esc(t('more', { n: all.length - nShow }))}</p>` : ''}
      </div>`;
  const paint = () => { box.querySelector('.ba-ol-live').innerHTML = (live.length ? matchesCard() : '') + challengeCard; };
  const challengeCard = `
      <div class="ba-on-card">
        <div class="ba-on-head">${esc(t('challenge'))}</div>
        <div class="ba-faces">
          <button type="button" class="ba-face is-any" data-role="anyone"><span class="ba-face-dot" aria-hidden="true">+</span><span class="ba-face-name">${esc(t('anyone'))}</span></button>
          ${recent.map((o, i) => `<button type="button" class="ba-face" data-oi="${i}"><span class="ba-face-dot" aria-hidden="true">${esc(o.emoji)}</span><span class="ba-face-name">${esc(first(o.name))}</span></button>`).join('')}
        </div>
      </div>`;
  paint();
  // Nothing scrolls: drop matches from the end until the whole home screen fits, and count them.
  const menu = box.closest('.ba-home-menu');
  if (menu) {
    // Measured with the Online panel showing (it may be the hidden tab right now), then put back.
    const panels = [...menu.querySelectorAll('[data-panel]')], was = panels.map((p) => p.hidden);
    panels.forEach((p) => { p.hidden = p.dataset.panel !== 'online'; });
    while (nShow > 1 && menu.scrollHeight > menu.clientHeight + 1) { nShow--; paint(); }
    panels.forEach((p, i) => { p.hidden = was[i]; });
  }
  const live_ = box.querySelector('.ba-ol-live');
  ui.on(live_, 'click', (e) => {
    const m = e.target.closest('.ba-ol-row[data-id]');
    if (m) { openChallenge(ui, m.dataset.id); return; }
    if (e.target.closest('[data-role="anyone"]')) { picker(ui); return; }
    const f = e.target.closest('.ba-face[data-oi]');
    const them = f && recent[Number(f.dataset.oi)];
    if (them) pickTeamFor(ui, them);
  });
  showUnseen(ui, rows);
  return { active: live.length > 0, mine: mine.length };
}

/** "Notify me": only while notifications are off on this phone. */
async function pushRow(ui, box) {
  try {
    const P = await import('../../js/push.js');
    const st = await P.pushState();
    const el = box.querySelector('.ba-ol-push');
    if (st !== 'off' || !el || !el.isConnected) return;
    el.innerHTML = `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block">${esc(t('notify'))}</button>`;
    el.hidden = false;
    ui.on(el.querySelector('button'), 'click', async () => { const res = await P.enablePush(); if (res && res.ok) el.hidden = true; });
  } catch { /* no push on this phone */ }
}

/** A match that ended while this phone was away: who won, by profile name, a close (X) and OK. */
function showUnseen(ui, rows) {
  const ids = MP.readUnseen();
  const ended = (rows || []).filter((r) => r.over && r.result && ids.includes(r.id)).sort((a, b) => b.updated - a.updated);
  if (!ended.length || ui.root.querySelector('.ba-ol-unseen')) return;
  const r = ended[0];
  const winner = r.result === 'won' ? myName() : (r.name || '?');
  const el = document.createElement('div');
  el.className = 'gh-overlay ba-overlay ba-ol-unseen';
  el.innerHTML = `<div class="gh-modal ba-pause" role="dialog" aria-modal="true" aria-label="${esc(t('teamWins', { name: winner }))}">
      <button type="button" class="gh-modal__close" data-role="ok" aria-label="${esc(t('close'))}">&times;</button>
      <p class="ba-ol-big">${esc(r.emoji)} ${esc(t('teamWins', { name: winner }))}</p>
      ${r.why === 'timeout' ? `<p class="ba-ol-note">${esc(t('timedOut'))}</p>` : r.why === 'resign' ? `<p class="ba-ol-note">${esc(t('resigned', { name: r.result === 'won' ? (r.name || '?') : myName() }))}</p>` : ''}
      <div class="gh-modal__actions"><button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="ok">${esc(t('ok'))}</button></div>
    </div>`;
  ui.root.appendChild(el);
  for (const b of el.querySelectorAll('[data-role="ok"]')) ui.on(b, 'click', () => { for (const x of ended) MP.markResultSeen(x.id); el.remove(); });
}

/** Who to challenge: a search box and the names that match it (the small directory, never players/). */
async function picker(ui) {
  const box = frame(ui, 'online-pick', esc(t('challenge')), `
    <input type="search" class="ba-ol-search" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}" autocomplete="off">
    <div class="ba-ol-list"><p class="ba-ol-note">…</p></div>`);
  const gen = ui.gen;
  ui.on(box.querySelector('[data-role="back"]'), 'click', () => home(ui));
  const opps = await MP.readOpponents();
  if (gen !== ui.gen) return;
  const list = box.querySelector('.ba-ol-list');
  const SHOW = 10;
  const paint = (q) => {
    const k = String(q || '').trim().toLowerCase();
    const all = opps.filter((o) => !k || o.name.toLowerCase().includes(k));
    list.innerHTML = all.length ? all.slice(0, SHOW).map((o) => `
      <button type="button" class="ba-ol-row" data-oi="${opps.indexOf(o)}">
        <span class="ba-ol-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="ba-ol-text"><span class="ba-ol-name">${esc(o.name)}</span></span>
        <span class="ba-ol-chev" aria-hidden="true">›</span>
      </button>`).join('') : `<p class="ba-ol-note">${esc(t('nobody'))}</p>`;
    if (all.length) fitList(box, list, Math.max(0, all.length - SHOW));
  };
  paint('');
  ui.on(box.querySelector('.ba-ol-search'), 'input', (e) => paint(e.target.value));
  ui.on(list, 'click', (e) => {
    const b = e.target.closest('.ba-ol-row');
    const o = b && opps[Number(b.dataset.oi)];
    if (o) pickTeamFor(ui, o);
  });
}

/** Challenging `them`: draft your team, then the challenge is made and opens (you move first). */
function pickTeamFor(ui, them) {
  ui.renderDraft({
    onBack: () => home(ui),
    onFight: async (team) => {
      const fight = ui.root.querySelector('[data-role="fight"]');
      if (fight) fight.disabled = true;
      const res = await MP.createGame({ them, team });
      if (!res.ok) { home(ui, reasonText(res.reason)); return; }
      await openChallenge(ui, res.id, res.game);
    },
  });
}

// --- a challenge --------------------------------------------------------------------------------
/** Open a challenge on the battle screen. A first-time receiver drafts first. The other person's
 *  latest run of moves (not yet shown here) is played back exactly as the computer's moves are. */
export async function openChallenge(ui, id, given = null) {
  try { await MP.drainOutbox(id); } catch { /* still owed: sent next time */ }
  const game = given || await MP.readGame(id);
  if (ui.disposed) return;
  const me = MP.myCode();
  const side = game && MP.sideOf(game, me);
  if (!game || !side) { home(ui, reasonText('not-found')); return; }
  if (MP.isCalledOff(game)) { home(ui, t('calledOff')); return; }
  if (MP.needsDraft(game, side)) {
    if (MP.lifeOf(game).expired) { home(ui, t('e_expired')); return; }
    ui.renderDraft({
      onBack: () => home(ui),
      onFight: async (team) => {
        const fight = ui.root.querySelector('[data-role="fight"]');
        if (fight) fight.disabled = true;
        const res = await MP.draftTeam(id, team);
        if (!res.ok) { home(ui, reasonText(res.reason)); return; }
        openChallenge(ui, id, res.game);
      },
    });
    return;
  }
  const theirs = side === 'a' ? 'b' : 'a';
  const shown = Math.min(game.log.length, MP.readShown(id));
  const start = Math.max(MP.lastRunStart(game, theirs), shown);
  const link = new ChallengeLink(ui, game, side);
  // A move this phone made and still owes the server (the outbox): it is on the screen already.
  const owed = MP.pendingFor(id);
  let canon = MP.buildState(game, start);
  const queue = game.log.slice(start);
  if (owed && owed.base === game.log.length) {
    // replayed on top below by the link once the queue (none: it is our turn) is shown
    link.pending = owed.entries.slice();
    link.pendingBase = owed.base;
  }
  link.known = game.log.length + (link.pending ? link.pending.length : 0);
  if (link.pending) {
    // Our own unsent moves go straight onto the starting state (they are ours, nothing to show).
    const all = MP.buildState({ ...game, log: game.log.concat(link.pending) });
    if (!queue.length) canon = all;
  }
  MP.markShown(id, game.log.length);
  ui.startOnline(link, canon, queue);
  // Resigned, or 7 days on someone's turn (js/challenge-life.js): a result the log did not produce.
  if (game.over && (game.over.why === 'resign' || game.over.why === 'timeout')) ui.forceEnd(seatOfSide(game.over.winner), game.over.why);
  link.watch();
  if (link.pending) link.flush();
}

class ChallengeLink {
  constructor(ui, game, side) {
    this.kind = 'ch';
    this.timed = false;                    // NO move clock in challenges (Matt)
    this.ui = ui;
    this.id = game.id;
    this.game = game;
    this.side = side;
    this.seat = seatOfSide(side);
    const them = side === 'a' ? game.b : game.a;
    this.them = { name: them.name || '?', emoji: them.emoji || '🙂', code: them.code };
    this.known = game.log.length;          // moves this screen has applied or queued
    // The other person has not picked their team yet (a challenge they have not opened): their side
    // is a placeholder in the engine, so the screen shows no monsters there until they draft.
    this.foeUnknown = !game[side === 'a' ? 'b' : 'a'].team;
    this.pending = null;                   // our moves not yet on the server
    this.pendingBase = 0;
    this.sendingNow = false;
    this.stop = null;
    this.dead = false;
  }

  watch() {
    MP.watchGame(this.id, (g) => this.onGame(g)).then((stop) => { if (this.dead) { try { stop(); } catch {} } else this.stop = stop; });
  }

  onGame(g) {
    if (this.dead || !g) return;
    this.game = g;
    if (MP.isCalledOff(g)) { home(this.ui, t('calledOff')); return; }
    const theirs = this.side === 'a' ? 'b' : 'a';
    // They have just picked their team: draw the match again with it (the moves so far are unchanged).
    if (this.foeUnknown && g[theirs].team) { this.resync(); return; }
    if (g.log.length > this.known) {
      for (const e of g.log.slice(this.known)) {
        if (e.by !== theirs) { this.resync(); return; }      // our own move from another phone
        this.known++;
        this.ui.remoteEntry(e);
      }
      MP.markShown(this.id, g.log.length);
    }
    if (g.over && (g.over.why === 'resign' || g.over.why === 'timeout') && g.log.length <= this.known) this.ui.forceEnd(seatOfSide(g.over.winner), g.over.why);
  }

  /** Our move (stored-frame entry): sent at once, one at a time, kept in the outbox until it lands. */
  send(entry) {
    if (!this.pending) { this.pending = []; this.pendingBase = this.known; }
    this.pending.push(entry);
    this.known++;
    MP.savePending(this.id, this.pendingBase, this.pending);
    this.flush();
  }

  async flush() {
    if (this.sendingNow || !this.pending || !this.pending.length) return;
    this.sendingNow = true;
    const batch = this.pending.slice();
    const res = await MP.appendLog(this.id, this.pendingBase, batch);
    this.sendingNow = false;
    if (res.ok) {
      this.pending = this.pending.slice(batch.length);
      this.pendingBase += batch.length;
      MP.savePending(this.id, this.pendingBase, this.pending);
      if (!this.pending.length) this.pending = null;
      else this.flush();
      // The winning move is on the server now: count it (2026-11-13, see finish).
      if (!this.pending && this.owed) { const o = this.owed; this.owed = null; this.finish(o.canon, o.won); }
      return;
    }
    if (res.retryable && !this.dead) { setTimeout(() => this.flush(), 3000); return; }
    // The match moved on without these moves (expired, over, another phone): say so, start again.
    MP.savePending(this.id, this.pendingBase, []);
    this.pending = null;
    this.owed = null;            // the server never took the last move: its real result counts from the launcher
    if (!this.dead) home(this.ui, reasonText(res.reason));
  }

  menuItems() {
    const life = MP.lifeOf(this.game);
    if (life.open) {
      const mine = this.side === MP.recipientOf(this.game);
      // After the sender's first turn, calling it off is a loss for whoever does it (2026-10-29): asked first.
      if (typeof MP.cancelCosts === 'function' && MP.cancelCosts(this.game)) {
        return [{ label: t(mine ? 'declineCh' : 'cancelCh'), act: () => confirmResign(this.ui, () => this.callOff(), t(mine ? 'declineQLoss' : 'cancelQLoss'), t(mine ? 'declineCh' : 'cancelCh')) }];
      }
      return [{ label: t(mine ? 'declineCh' : 'cancelCh'), act: () => this.callOff() }];
    }
    return [{ label: t('resign'), act: () => confirmResign(this.ui, () => this.resign()) }];
  }

  async callOff() {
    const res = await MP.cancelGame(this.id);
    if (res.ok && res.lost) { this.ui.forceEnd(1 - this.seat); return; }   // it cost a loss (2026-10-29)
    home(this.ui, res.ok ? t('calledOff') : reasonText(res.reason));
  }

  async resign() {
    const res = await MP.resignGame(this.id);
    if (!res.ok) { home(this.ui, reasonText(res.reason)); return; }
    if (res.cancelled) { home(this.ui, t('calledOff')); return; }
    this.ui.forceEnd(1 - this.seat);
  }

  finish(canon, won) {
    // Counted only once the move that ended it is ON THE SERVER (2026-11-13): a knockout refused there
    // (the turn timed out first, another phone moved) was counted as a win here. A page closed before
    // then leaves it to the launcher, which counts the stored result (mp.js recordFinished).
    if (this.pending && this.pending.length) { this.owed = { canon, won }; return; }
    const ov = this.game && this.game.over;
    MP.countResult(this.id, won, (ov && ov.at) || Date.now(), () => onlineMode(canon, this.seat, 'ch'), () => matchDetail(canon, this.seat));   // the finish time keeps a fresh storage honest
    MP.markResultSeen(this.id);
  }

  done() { home(this.ui); }
  resync() { const id = this.id; this.destroy(); openChallenge(this.ui, id); }
  mountChat(ui) { mountChat(ui, this, (p) => sendChallengeChat(this, p)); }

  destroy() {
    this.dead = true;
    if (this.stop) { try { this.stop(); } catch {} this.stop = null; }
    unmountChat(this);
  }
}

// --- live rooms ---------------------------------------------------------------------------------
function hostDraft(ui) {
  ui.renderDraft({ onBack: () => home(ui), onFight: (team) => startHost(ui, team) });
}

async function startHost(ui, team) {
  const link = new LiveLink(ui, 0);
  const box = lobby(ui, link, '…');
  const res = await link.room.host(team);
  if (ui.disposed || !box.isConnected) { if (res.ok) link.room.leave(); return; }
  if (!res.ok) { link.dead = true; home(ui, reasonText(res.error)); return; }
  box.querySelector('.ba-ol-code').textContent = res.code;
}

/** The host's waiting screen: the code, big, and Cancel (the back arrow). */
function lobby(ui, link, code) {
  const box = frame(ui, 'online-lobby', esc(t('host')), `
    <div class="ba-ol-lobby">
      <span class="ba-ol-label">${esc(t('code'))}</span>
      <b class="ba-ol-code">${esc(code)}</b>
      <span class="ba-ol-wait">${esc(t('waiting'))}<i class="ba-ol-dots" aria-hidden="true"></i></span>
    </div>`);
  ui.on(box.querySelector('[data-role="back"]'), 'click', () => { link.room.leave(); link.dead = true; home(ui); });
  return box;
}

function joinCode(ui) {
  const box = frame(ui, 'online-join', esc(t('join')), `
    <div class="ba-ol-lobby">
      <span class="ba-ol-label">${esc(t('code'))}</span>
      <input class="ba-ol-input" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" aria-label="${esc(t('code'))}">
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="go" disabled>${esc(t('join'))}</button>
      <p class="ba-ol-note ba-ol-err" aria-live="polite" hidden></p>
    </div>`);
  ui.on(box.querySelector('[data-role="back"]'), 'click', () => home(ui));
  const input = box.querySelector('.ba-ol-input');
  const go = box.querySelector('[data-role="go"]');
  ui.on(input, 'input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    go.disabled = input.value.length !== 4;
  });
  ui.on(go, 'click', () => {
    const code = input.value;
    ui.renderDraft({ onBack: () => joinCode(ui), onFight: (team) => startJoin(ui, code, team) });
  });
  try { input.focus(); } catch {}
}

async function startJoin(ui, code, team) {
  const link = new LiveLink(ui, 1);
  const box = frame(ui, 'online-lobby', esc(t('join')), `<div class="ba-ol-lobby"><b class="ba-ol-code">${esc(code)}</b><span class="ba-ol-wait">${esc(t('waiting'))}<i class="ba-ol-dots" aria-hidden="true"></i></span></div>`);
  ui.on(box.querySelector('[data-role="back"]'), 'click', () => { link.room.leave(); link.dead = true; home(ui); });
  const res = await link.room.join(code, team);
  if (!res.ok) { link.dead = true; if (!ui.disposed) home(ui, reasonText(res.error)); }
}

async function resumeLive(ui, save) {
  const link = new LiveLink(ui, save.seat);
  const res = await link.room.rejoin(save);
  if (!res.ok) { clearRoomSave(); link.dead = true; return false; }
  // Still in the lobby (closed while waiting): the waiting screen again; the match replaces it.
  if (!link.room.started && !link.dead && ui.screen !== 'battle') lobby(ui, link, save.code);
  return true;
}

class LiveLink {
  constructor(ui, seat) {
    this.kind = 'live';
    this.timed = true;                     // 25 s a move, reset after every move (ui.js)
    this.ui = ui;
    this.seat = seat;
    this.them = { name: '?', emoji: '🙂' };
    this.dead = false;
    this.away = 0;
    this.left = false;
    this.room = new LiveRoom(null, {
      onStart: (canon) => this.onStart(canon),
      onMove: (e) => { if (!this.dead && this.ui.link === this) this.ui.remoteEntry(e); },
      onResync: (canon) => { if (!this.dead && this.ui.link === this) this.ui.startOnline(this, canon); },
      onPresence: (ms) => this.onPresence(ms),
      onEnded: (why) => this.onEnded(why),
    });
  }

  onStart(canon) {
    if (this.dead) return;
    const o = this.room.opp || {};
    this.them = { name: o.name || '?', emoji: o.avatar || '🙂' };
    this.ui.startOnline(this, canon);
  }

  onPresence(ms) {
    this.away = ms;
    const el = this.ui.root && this.ui.root.querySelector('.ba-presence');
    if (!el || this.ui.link !== this) return;
    const away = ms >= STALE_MS && !this.room.over;
    el.hidden = !away;
    if (away) el.textContent = t('away', { name: this.them.name });
  }

  onEnded(why) {
    if (this.dead) return;
    this.dead = true;
    home(this.ui, why === 'left' ? t('left', { name: this.them.name }) : t('gone'));
  }

  send(entry) { this.room.send(entry); }

  /** The hub's "Leave?" (js/hub.js quitCostsLoss / leaveMatch, root CLAUDE.md "Live rooms too"):
   *  after this player's first move, leaving resigns (a loss here, the other's win). */
  leaveCosts() { return !!(this.room.started && !this.room.over && this.room.leaveCosts()); }
  leaveForGood() {
    if (this.leaveCosts()) { this.room.resign(); this.ui.forceEnd(1 - this.seat); }
    this.left = true;
    this.dead = true;
    this.room.leave();
  }

  menuItems() {
    const items = [{ label: t('resign'), act: () => confirmResign(this.ui, () => { this.room.resign(); this.ui.forceEnd(1 - this.seat); }) }];
    if (this.away >= CLAIM_MS) items.push({ label: t('claim'), act: () => { this.room.resign(true); this.ui.forceEnd(this.seat); } });
    return items;
  }

  finish(canon, won) { countLive(this.room.resultKey(), won, this.room.opp, this.room.llKey(), () => onlineMode(canon, this.seat, 'live'), () => matchDetail(canon, this.seat)); }

  done() { this.left = true; this.room.leave(); this.dead = true; home(this.ui); }
  resync() { if (this.room.canon) this.ui.startOnline(this, this.room.canon); }
  mountChat(ui) {
    mountChat(ui, this, async (p) => { await this.room.net.sendReaction(this.room.code, String(this.seat), p); return { ok: true }; });
  }

  destroy() {
    unmountChat(this);
    // Closing the game is not leaving: the room stays, and the next mount rejoins (live.js).
    if (!this.left && !this.room.dead) this.room.detach();
  }
}

/** "Resign?" with Resign and Cancel. */
function confirmResign(ui, yes, q = t('resignQ'), yesText = t('resign')) {
  const el = document.createElement('div');
  el.className = 'gh-overlay ba-overlay';
  el.innerHTML = `<div class="gh-modal ba-pause" role="dialog" aria-modal="true" aria-label="${esc(q)}">
      <button type="button" class="gh-modal__close" data-role="no" aria-label="${esc(t('close'))}">&times;</button>
      <p class="ba-ol-big">${esc(q)}</p>
      <div class="gh-modal__actions">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="yes">${esc(yesText)}</button>
        <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="no">${esc(t('cancel'))}</button>
      </div></div>`;
  ui.root.appendChild(el);
  ui.on(el.querySelector('[data-role="yes"]'), 'click', () => { el.remove(); yes(); });
  for (const b of el.querySelectorAll('[data-role="no"]')) ui.on(b, 'click', () => el.remove());
}

// --- quick chat (REQUIRED in every online match, root CLAUDE.md) ---------------------------------
// js/match-chat-ui.js is the panel. Challenges: js/match-chat.js at `battlearena/chat/<id>`, BESIDE
// the match (never inside it). Live rooms: the room's `reactions` slot per seat (js/net.js
// sendReaction, which also keeps the line in Messages). The button sits on the subrow's left,
// under the hub's floating button (`.ba-chatslot`), measured.
async function mountChat(ui, link, send) {
  unmountChat(link);
  let UI, DATA;
  try { [UI, DATA] = await Promise.all([import('../../js/match-chat-ui.js'), import('../../js/match-chat.js')]); } catch { return; }
  if (link.dead || ui.link !== link || link.chat) return;
  const slot = ui.root.querySelector('.ba-chatslot');
  const host = ui.root.querySelector('.ba-battle') || ui.root;
  let place = {};
  if (slot && host) {
    const s = slot.getBoundingClientRect(), b = host.getBoundingClientRect();
    const top = Math.round(s.top - b.top);
    place = { top: `${top}px`, right: `${Math.round(b.right - s.left - 44)}px`, popsTop: `${top + 54}px` };
  }
  const chat = UI.createMatchChat({ root: host, send, them: () => ({ name: link.them.name, emoji: link.them.emoji }), place });
  link.chat = chat;
  if (link.kind === 'ch') {
    const seenAt = DATA.readChatSeen(NODE, link.id);
    const stop = await DATA.watchChat({ node: NODE, id: link.id }, (list) => {
      let newest = 0;
      for (const c of list) {
        const mine = c.by === link.side;
        chat.add({ key: c.key, mine, t: c.t, v: c.v, at: c.at }, { pop: !mine && c.at > seenAt });
        if (!mine) newest = Math.max(newest, c.at);
      }
      DATA.markChatSeen(NODE, link.id, newest);
    });
    if (link.dead || link.chat !== chat) { try { stop(); } catch {} return; }
    link.chatStop = stop;
  } else {
    const stop = await DATA.watchRoomReactions(link.room.code, (rx) => chat.onReactions(rx, String(link.seat)));
    if (link.dead || link.chat !== chat) { try { stop(); } catch {} return; }
    link.chatStop = stop;
  }
}
function unmountChat(link) {
  if (link.chatStop) { try { link.chatStop(); } catch {} link.chatStop = null; }
  if (link.chat) { try { link.chat.destroy(); } catch {} link.chat = null; }
}
async function sendChallengeChat(link, p) {
  const DATA = await import('../../js/match-chat.js');
  return DATA.sendChat({ node: NODE, id: link.id, side: link.side }, p);
}

export { sideOfSeat };
export default { open, home, fillOnline, openChallenge, reasonText };
