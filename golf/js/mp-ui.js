// golf/js/mp-ui.js - the ONLINE screens (2026-11-10): the setup screen's Online tab (your matches,
// challenging someone), the person picker, the course + holes card, History, the scorecard both
// players share, and the Game Over popup for a match that ended while this phone was away. DOM only;
// the data is golf/js/mp.js and the holes are played in ui.js. Lazily imported: a player who never
// opens the Online tab downloads none of it. darts/js/mp-ui.js is the model (no code shared).
//
// NOTHING HERE SCROLLS (golf/CLAUDE.md, "No scroll, ever"): lists are paged or capped to what fits.
// No other player's CODE goes into the page (root CLAUDE.md): rows carry an index into a list.
import { makeT } from '../../js/i18n.js';
import { onlineGateText } from '../../js/online-gate.js';
import { STRINGS } from './strings.js';
import { COURSES, courseById, modesForCourse, roundsForCourse, roundRange, roundPar, roundById } from './rounds.js';

const t = makeT(STRINGS);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const first = (n) => String(n || '').trim().split(/\s+/)[0] || String(n || '');

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

/** "Pine Valley 1-3" for a match or a row. */
export function roundLine(courseId, roundId) {
  const c = COURSES.find((k) => k.id === courseId);
  if (!c) return '';
  return `${t(`course_${c.id}`)} ${roundRange(roundById(roundId))}`;
}
const toPar = (d) => (d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`);

/**
 * THE SCORECARD both players share: hole numbers, par, then one row per player, nine holes to a
 * block. `rows` = [{ name, scores: [n|null], mine }]. A hole not played yet is a dash, never a 0.
 */
export function scorecardHTML(holes, rows, now = -1) {
  const blocks = [];
  for (let k = 0; k < holes.length; k += 9) blocks.push([k, Math.min(holes.length, k + 9)]);
  const cell = (v, i) => `<td class="${i === now ? 'is-now' : ''}">${Number.isFinite(v) ? v : '-'}</td>`;
  const body = blocks.map(([a, b]) => {
    const hs = holes.slice(a, b);
    return `<table class="gf-sc">
      <tr class="gf-sc__h"><th></th>${hs.map((h, j) => `<td class="${a + j === now ? 'is-now' : ''}">${h.n}</td>`).join('')}</tr>
      <tr class="gf-sc__p"><th>${esc(t('mp_par'))}</th>${hs.map((h) => `<td>${h.par}</td>`).join('')}</tr>
      ${rows.map((r) => `<tr class="gf-sc__r${r.mine ? ' is-mine' : ''}"><th>${esc(first(r.name))}</th>${hs.map((h, j) => cell(r.scores[a + j], a + j)).join('')}</tr>`).join('')}
    </table>`;
  }).join('');
  const totals = rows.map((r) => {
    let s = 0, p = 0, n = 0;
    holes.forEach((h, i) => { if (Number.isFinite(r.scores[i])) { s += r.scores[i]; p += h.par; n++; } });
    return `<span class="gf-sc__tot${r.mine ? ' is-mine' : ''}"><b>${esc(first(r.name))}</b> ${n ? `${s} (${toPar(s - p)})` : '-'}</span>`;
  }).join('');
  return `<div class="gf-scwrap">${body}<div class="gf-sc__tots">${totals}</div></div>`;
}

/** One page of the online flow, in place of the setup screen. Returns the body element. */
function page(ui, title, body, back) {
  const el = ui._mpPage(`
    <div class="gf-mp-top">
      <button type="button" class="gf-btn gf-mp-back" data-mp="back" aria-label="${esc(t('back'))}">${BACK_SVG}</button>
      <h2 class="gf-mp-title">${esc(title)}</h2>
    </div>
    <div class="gf-mp-body">${body}</div>`);
  el.querySelector('[data-mp="back"]').addEventListener('click', () => (back ? back() : ui._renderSetup('online')));
  return el.querySelector('.gf-mp-body');
}

/** NO SCROLLING: drop rows from the end until the screen fits, and say how many are not shown. */
function fitList(screen, list, extra) {
  if (!screen || !list) return;
  const over = () => screen.scrollHeight > screen.clientHeight + 1;
  let dropped = 0;
  const paint = () => {
    let note = list.querySelector('.gf-mp-more');
    const n = (extra | 0) + dropped;
    if (n > 0 && !note) { note = document.createElement('p'); note.className = 'gf-mp-note gf-mp-more'; list.appendChild(note); }
    if (note) note.textContent = t('mp_more', { n });
  };
  paint();
  const rows = [...list.querySelectorAll('.gf-mrow')];
  while (over() && rows.length > 1) { rows.pop().remove(); dropped++; paint(); }
}

const courseName = (id) => (COURSES.some((k) => k.id === id) ? t(`course_${id}`) : '');
const rowSub = (r) => `${r.yourTurn ? courseName(r.course) : roundLine(r.course, r.round)} · ${r.yourTurn ? t('mp_hole_short', { n: Math.max(1, r.hole), all: r.holes || '?' }) : t('mp_turn_of', { name: first(r.name) })}`;

/**
 * THE SETUP SCREEN'S ONLINE TAB (Darts' and Cup Pong's tabs): the matches going (your turn first,
 * with Play), then Challenge: Anyone and the four people played most recently. The record chip opens
 * History. Fills `box`; returns { active, mine } or null if the screen moved on.
 */
export async function fillOnline(ui, MP, box) {
  // Shots left on this phone when a hole was left mid-send go first (none is ever dropped).
  try { if (MP.outboxCount()) await MP.drainOutbox(); } catch { /* sent next time */ }
  const rows = await MP.readMyGames();
  if (!box.isConnected) return null;
  try { MP.recordFinished(rows); } catch (err) { console.warn('[golf] recordFinished', err); }
  const live = rows.filter((r) => !r.over);
  const mine = live.filter((r) => r.yourTurn), theirs = live.filter((r) => !r.yourTurn);
  const seen = new Set();
  const recent = rows.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .filter((r) => r.with && !seen.has(r.with) && seen.add(r.with))
    .slice(0, 4).map((r) => ({ code: r.with, name: r.name, emoji: r.emoji }));
  let won = 0, lost = 0;
  try { for (const o of MP.recordsFrom(rows, MP.myCode()).opponents) { won += o.won | 0; lost += o.lost | 0; } } catch { /* no chip */ }
  const chip = won + lost ? `<button type="button" class="gf-btn gf-rec-chip" data-mp="history">${won}-${lost}</button>` : '';
  const liveRow = (r) => `
    <button type="button" class="gf-btn gf-mrow${r.yourTurn ? ' is-mine' : ''}" data-id="${esc(r.id)}">
      <span class="gf-mrow-face" aria-hidden="true">${esc(r.emoji)}</span>
      <span class="gf-mrow-text"><span class="gf-mrow-name">${esc(r.name)}</span>
        <span class="gf-mrow-sub">${esc(rowSub(r))}</span></span>
      ${r.yourTurn ? `<span class="gf-play-pill">${esc(t('mp_play'))}</span>` : '<span class="gf-mrow-chev" aria-hidden="true">›</span>'}
    </button>`;
  const all = mine.concat(theirs).map(liveRow);
  box.innerHTML = (live.length ? `
      <div class="gf-on-sec" data-role="matches">
        <div class="gf-on-head"><span>${esc(t('mp_matches'))}</span>${chip}</div>
        <div class="gf-on-rows"></div>
      </div>` : '') + `
      <div class="gf-on-sec">
        <div class="gf-on-head"><span>${esc(t('mp_challenge_h'))}</span>${live.length ? '' : chip}</div>
        <div class="gf-faces">
          <button type="button" class="gf-btn gf-face is-any" data-mp="anyone"><span class="gf-face-dot" aria-hidden="true">+</span><span class="gf-face-name">${esc(t('mp_anyone'))}</span></button>
          ${recent.map((o, i) => `<button type="button" class="gf-btn gf-face" data-oi="${i}"><span class="gf-face-dot" aria-hidden="true">${esc(o.emoji)}</span><span class="gf-face-name">${esc(first(o.name))}</span></button>`).join('')}
        </div>
      </div>
      <div class="gf-mp-push" hidden></div>`;
  const rowsEl = box.querySelector('.gf-on-rows');
  if (rowsEl) { rowsEl._all = all; rowsEl._start = 0; }
  box.onclick = (e) => {
    const m = e.target.closest('.gf-mrow[data-id]');
    if (m) { ui._mpOpen(m.dataset.id); return; }
    const a = e.target.closest('[data-mp]');
    if (a) {
      const k = a.dataset.mp;
      if (k === 'history') history(ui, MP);
      else if (k === 'anyone') picker(ui, MP);
      else if (k === 'more' && rowsEl) {
        const st = (rowsEl._start | 0) + (Number(rowsEl.dataset.shown) || 1);
        rowsEl._start = st >= rowsEl._all.length ? 0 : st;
        fitOnline(ui);
      }
      return;
    }
    const f = e.target.closest('.gf-face[data-oi]');
    const them = f && recent[Number(f.dataset.oi)];
    if (them) confirm(ui, MP, them);
  };
  pushRow(box.querySelector('.gf-mp-push'), () => fitOnline(ui));
  showUnseen(ui, MP, rows);
  fitOnline(ui);
  return { active: live.length > 0, mine: mine.length };
}

/** NO SCROLLING: a page of match rows that fits, then "+N more" turns to the next page. */
export function fitOnline(ui) {
  const setup = ui.rootEl && ui.rootEl.querySelector('.gf-setup.is-online');
  const rowsEl = setup && setup.querySelector('.gf-on-rows');
  if (!rowsEl) return;
  const all = rowsEl._all || [];
  const start = Math.min(rowsEl._start | 0, Math.max(0, all.length - 1));
  rowsEl.innerHTML = all.slice(start).join('');
  const over = () => setup.scrollHeight > setup.clientHeight + 1;
  const rows = [...rowsEl.querySelectorAll('.gf-mrow')];
  while (over() && rows.length > 1) rows.pop().remove();
  let shown = rows.length;
  if (start > 0 || start + shown < all.length) {
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'gf-btn gf-more'; more.dataset.mp = 'more';
    rowsEl.appendChild(more);
    if (over() && rows.length > 1) { rows.pop().remove(); shown--; }
    more.textContent = t('mp_more', { n: all.length - shown });
  }
  rowsEl.dataset.shown = String(shown);
}

/** "Notify me" - only while notifications are off on this phone. */
async function pushRow(box, onShown) {
  try {
    const P = await import('../../js/push.js');
    const st = await P.pushState();
    if (st !== 'off' || !box || !box.isConnected) return;
    box.innerHTML = `<button type="button" class="gf-btn gf-mp-wide">${esc(t('mp_notify'))}</button>`;
    box.hidden = false;
    if (onShown) onShown();
    box.querySelector('button').addEventListener('click', async () => {
      const res = await P.enablePush();
      if (res && res.ok) { box.hidden = true; if (onShown) onShown(); }
    });
  } catch { /* no push on this phone */ }
}

/** Who to challenge: a search box and the first few names that match it. */
async function picker(ui, MP) {
  const body = page(ui, t('mp_challenge'), `
    <input type="search" class="gf-mp-search" placeholder="${esc(t('mp_search'))}" aria-label="${esc(t('mp_search'))}" autocomplete="off">
    <div class="gf-mp-list"><p class="gf-mp-note">${esc(t('mp_loading'))}</p></div>`);
  const opps = await MP.readOpponents();
  if (!body.isConnected) return;
  const list = body.querySelector('.gf-mp-list');
  const SHOW = 8;
  const paint = (q) => {
    const k = String(q || '').trim().toLowerCase();
    const all = opps.filter((o) => !k || o.name.toLowerCase().includes(k));
    list.innerHTML = all.length ? all.slice(0, SHOW).map((o) => `
      <button type="button" class="gf-btn gf-mrow" data-oi="${opps.indexOf(o)}">
        <span class="gf-mrow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="gf-mrow-text"><span class="gf-mrow-name">${esc(o.name)}</span></span>
        <span class="gf-mrow-chev" aria-hidden="true">›</span>
      </button>`).join('') : `<p class="gf-mp-note">${esc(t('mp_no_opp'))}</p>`;
    if (all.length) fitList(body.closest('.gf-setup'), list, Math.max(0, all.length - SHOW));
  };
  paint('');
  body.querySelector('.gf-mp-search').addEventListener('input', (e) => paint(e.target.value));
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.gf-mrow');
    const o = b && opps[Number(b.dataset.oi)];
    if (o) confirm(ui, MP, o);
  });
}

/** Exported for the hub's Multiplayer screen (alert.js armChallenge -> ui.js). */
export function challengeTo(ui, MP, them) { confirm(ui, MP, them); }

/**
 * THE CHALLENGE CARD: a course (only courses open to everyone), a length, and which holes, with
 * golf's own chips and tiles. The unlock ladder does NOT gate a challenge. Then Send.
 */
function confirm(ui, MP, them, sel = null) {
  const open = COURSES.filter((c) => ui._courseOpenToAll(c.id));
  if (!open.length) return;
  const s = sel || {};
  const course = open.find((c) => c.id === (s.course || ui.settings.lastCourse)) || open[0];
  const modes = modesForCourse(course);
  const mode = modes.includes(s.mode || ui.settings.lastMode) ? (s.mode || ui.settings.lastMode) : modes[0];
  const rounds = roundsForCourse(course, mode);
  const round = rounds.find((r) => r.id === s.round) || rounds[0];
  const body = page(ui, t('mp_challenge'), `
    <p class="gf-mp-vs"><span aria-hidden="true">${esc(them.emoji)}</span> ${esc(them.name)}</p>
    <div class="gf-coursepick gf-modepick">${modes.map((m) => `<button type="button" class="gf-btn gf-chip${m === mode ? ' is-on' : ''}" data-chmode="${m}" aria-pressed="${m === mode}"><span>${esc(t('mode_holes', { n: m }))}</span></button>`).join('')}</div>
    ${open.length > 1 ? `<div class="gf-coursepick">${open.map((c) => `<button type="button" class="gf-btn gf-chip${c.id === course.id ? ' is-on' : ''}" data-chcourse="${esc(c.id)}" aria-pressed="${c.id === course.id}"><span>${esc(t(`course_${c.id}`))}</span></button>`).join('')}</div>` : ''}
    <div class="gf-card"><div class="gf-rounds${rounds.length === 1 ? ' is-one' : ''}">${rounds.map((r) => `
      <button type="button" class="gf-btn gf-roundbtn${r.id === round.id ? ' is-on' : ''}" data-chround="${esc(r.id)}" aria-pressed="${r.id === round.id}"
        aria-label="${esc(t('holes_range', { range: roundRange(r) }))}"><span>${esc(roundRange(r))}</span><small>${esc(t('round_meta', { par: roundPar(course, r.id) }))}</small></button>`).join('')}
    </div></div>
    <button type="button" class="gf-btn gf-mp-wide is-cta" data-mp="send">${esc(t('mp_send', { name: first(them.name) }))}</button>
    <p class="gf-mp-note gf-mp-err" aria-live="polite" hidden></p>`);
  const pick = { course: course.id, mode, round: round.id };
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chmode], [data-chcourse], [data-chround]');
    if (!b) return;
    if (b.dataset.chmode) { pick.mode = +b.dataset.chmode; pick.round = null; }
    else if (b.dataset.chcourse) { pick.course = b.dataset.chcourse; pick.round = null; }
    else pick.round = b.dataset.chround;
    confirm(ui, MP, them, pick);
  });
  const send = body.querySelector('[data-mp="send"]');
  send.addEventListener('click', async () => {
    send.disabled = true;
    const res = await ui._mpSend(them, pick.course, pick.round);
    if (res && !res.ok && body.isConnected) {
      const err = body.querySelector('.gf-mp-err');
      err.textContent = reasonText(res.reason);
      err.hidden = false;
      send.disabled = false;
    }
  });
}

/** Finished matches: a record per opponent, then the latest matches. */
async function history(ui, MP) {
  const body = page(ui, t('mp_history'), `<div class="gf-mp-list"><p class="gf-mp-note">${esc(t('mp_loading'))}</p></div>`);
  const rows = await MP.readMyGames();
  if (!body.isConnected) return;
  const { opponents, finished } = MP.recordsFrom(rows, MP.myCode());
  const list = body.querySelector('.gf-mp-list');
  if (!finished.length) { list.innerHTML = `<p class="gf-mp-note">${esc(t('mp_no_history'))}</p>`; return; }
  const word = (r) => (r.result === 'draw' ? t('mp_draw') : r.timedOut ? t('mp_timed_out')
    : r.result === 'won' ? (r.resigned === 'them' ? t('mp_won_quit', { name: first(r.name) }) : t('mp_won')) : (r.resigned === 'me' ? t('mp_you_quit') : t('mp_lost')));
  // Won, lost and drawn are told apart by a mark (check, cross, equals), never by colour alone.
  const mark = (r) => (r.result === 'draw' ? '=' : r.result === 'won' ? '✓' : '✗');
  list.innerHTML = `<h3 class="gf-mp-h">${esc(t('mp_records'))}</h3>` + opponents.slice(0, 3).map((o) => `
      <div class="gf-mrow is-static">
        <span class="gf-mrow-face" aria-hidden="true">${esc(o.emoji)}</span>
        <span class="gf-mrow-text"><span class="gf-mrow-name">${esc(o.name)}</span></span>
        <span class="gf-rec"><b>${o.won}</b>-<b>${o.lost}</b>${o.draw ? `-<b>${o.draw}</b>` : ''}</span>
      </div>`).join('')
    + `<h3 class="gf-mp-h">${esc(t('mp_matches'))}</h3>` + finished.slice(0, 10).map((r) => `
      <div class="gf-mrow is-static">
        <span class="gf-hmark" aria-hidden="true">${mark(r)}</span>
        <span class="gf-mrow-text"><span class="gf-mrow-name">${esc(r.name)}</span>
          <span class="gf-mrow-sub">${esc([word(r), roundLine(r.course, r.round)].filter(Boolean).join(' · '))}</span></span>
      </div>`).join('');
  fitList(body.closest('.gf-setup'), list, Math.max(0, finished.length - 10));
}

/** GAME OVER, for a match that ended while this phone was away. Names players by profile name. */
export function showUnseen(ui, MP, rows) {
  const ids = MP.readUnseen();
  const ended = (rows || []).filter((r) => r.over && ids.includes(r.id)).sort((a, b) => b.updated - a.updated);
  if (!ended.length || !ui.rootEl || ui.rootEl.querySelector('.gf-unseen')) return;
  const r = ended[0];
  const me = (ui._myName && ui._myName()) || '';
  const title = r.result === 'draw' ? t('mp_draw') : t('mp_wins', { name: first(r.result === 'won' ? me : r.name) });
  const why = r.why === 'timeout' ? t('mp_timed_out') : r.why === 'resign' ? t('mp_resigned_by', { name: first(r.result === 'won' ? r.name : me) }) : '';
  const line = r.mineTotal || r.theirsTotal ? `${first(me)} ${r.mineTotal}, ${first(r.name)} ${r.theirsTotal}` : '';
  const el = document.createElement('div');
  el.className = 'gf-result gf-unseen';
  el.innerHTML = `
    <div class="gf-result__card gf-panel gf-mpres" role="dialog" aria-modal="true" aria-label="${esc(t('mp_game_over'))}">
      <button type="button" class="gf-result__x" data-mp="close" aria-label="${esc(t('back'))}">&times;</button>
      <div class="gf-mpres__face" aria-hidden="true">${esc(r.emoji)}</div>
      <div class="gf-result__name">${esc(title)}</div>
      ${roundLine(r.course, r.round) ? `<div class="gf-mpres__line">${esc(roundLine(r.course, r.round))}</div>` : ''}
      ${line ? `<div class="gf-mpres__line">${esc(line)}</div>` : ''}
      ${why ? `<div class="gf-mpres__line">${esc(why)}</div>` : ''}
      ${ended.length > 1 ? `<div class="gf-mpres__line">${esc(t('mp_more', { n: ended.length - 1 }))}</div>` : ''}
      <div class="gf-actions"><button type="button" class="gf-btn" data-mp="ok"><span>${esc(t('mp_ok'))}</span></button></div>
    </div>`;
  ui.rootEl.appendChild(el);
  const done = () => { for (const x of ended) MP.markResultSeen(x.id); el.remove(); };
  el.querySelector('[data-mp="ok"]').addEventListener('click', done);
  el.querySelector('[data-mp="close"]').addEventListener('click', done);
}

export { courseById };
export default { fillOnline, fitOnline, showUnseen, reasonText, scorecardHTML, roundLine, challengeTo };
