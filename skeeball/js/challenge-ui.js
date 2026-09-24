// skeeball/js/challenge-ui.js - the screens for Skeeball challenges (see challenge.js for the rules).
//
// Every screen is a css/ui.css .gh-overlay/.gh-modal owned by the SkeeballUI instance (`ui`), so
// ui._closeOverlay() and destroy() tear it down with everything else. The only thing that scrolls
// is the list body, inside the modal, with overscroll contained - the same call Connect 4 Hoops'
// "Play a friend" sheet made, because a list of people can be longer than a phone.
import STRINGS from './strings.js';
import { makeT } from '../../js/i18n.js';
import { BOARDS, boardById, DEFAULT_BOARD } from './boards.js';
import { isBoardReleased, isBoardTesting } from '../../js/admin-config.js';
import { loadStats } from '../../js/game-stats.js';
import { readPlayersOnce } from '../../js/stats-net.js';
import * as CH from './challenge.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v == null ? '-' : String(v));

const boardName = (id, fallback) => (BOARDS.some((b) => b.id === id) ? boardById(id).name : (fallback || id));

/** "2d left" / "5h left" / "Expired". */
function timeLeft(expires, now = Date.now()) {
  const left = (+expires || 0) - now;
  if (left <= 0) return t('ch_expired');
  const h = Math.ceil(left / 3600000);
  return h >= 24 ? t('ch_days_left', { n: Math.ceil(h / 24) }) : t('ch_hours_left', { n: h });
}

/** "THE CLASSIC", "3 games · THE CLASSIC · Most wins", "All machines · Total score". */
export function formatLine(x) {
  if (!x) return '';
  const n = x.n != null ? x.n : (x.legs || []).length;
  const machine = x.all ? t('ch_all_machines') : boardName(x.board || (x.legs && x.legs[0] && x.legs[0].board), x.boardName || (x.legs && x.legs[0] && x.legs[0].boardName));
  if (n <= 1 && !x.all) return machine;
  const scoring = x.scoring === 'total' ? t('ch_sc_total') : t('ch_sc_games');
  return x.all ? `${machine} · ${scoring}` : `${t('ch_n_games', { n })} · ${machine} · ${scoring}`;
}

// --- which machines a challenge can be on ---------------------------------------------------------

/**
 * PURE. The machines a challenge may be on: every machine THE CHALLENGER can play (the first
 * machine, one released to everyone, or one they have earned) that is not in Testing (a testing rack
 * is practice and counts for nothing). Matt, 2026-09-24, choosing it over "both players must have
 * it": the other person plays that machine for the challenge even if it is locked for them, and
 * playing it unlocks nothing (the challenge never writes sk.unlocked). `mine` is a Set of unlocked
 * board ids; `testing(b)`/`released(b)` are injected so this is testable without the admin config.
 */
export function challengeBoards(mine, { boards = BOARDS, testing, released } = {}) {
  const isTesting = testing || ((b) => isBoardTesting(b.id, !!b.adminOnly));
  const isReleased = released || ((b) => isBoardReleased(b.id));
  return boards.filter((b) => !isTesting(b) && (b.id === DEFAULT_BOARD || isReleased(b) || (mine && mine.has(b.id))));
}

/** PURE. Every board id a player code has unlocked, across ALL of that person's synced devices. */
export function unlockedFrom(all, code) {
  const out = new Set();
  const want = CH.asCode(code);
  if (!want) return out;
  for (const id of Object.keys(all || {})) {
    const rec = (all || {})[id] || {};
    if (CH.asCode(rec.profile && rec.profile.playerId) !== want) continue;
    const u = (((rec.stats || {}).games || {}).skeeball || {}).sk;
    const map = u && u.unlocked;
    if (map && typeof map === 'object') for (const k of Object.keys(map)) if (map[k]) out.add(k);
  }
  return out;
}

function localUnlocked() {
  const out = new Set();
  try {
    const map = (((loadStats().games || {}).skeeball || {}).sk || {}).unlocked || {};
    for (const k of Object.keys(map)) if (map[k]) out.add(k);
  } catch { /* none */ }
  return out;
}

/** The per-game table: # · machine · them · you. `g` is a match with this device's scores laid over. */
function legsTable(g, side) {
  const mine = CH.scoresOf(g, side);
  const theirs = CH.scoresOf(g, side === 'a' ? 'b' : 'a');
  // Every score to beat is on show by design. The CHALLENGER, while still playing, simply has an
  // empty column for the other person. Won / lost / tied per game is a mark, not only a colour.
  const rows = g.legs.map((l, i) => {
    const m = mine[i]; const o = theirs[i];
    const mark = (m != null && o != null) ? (m > o ? '✓' : m < o ? '✗' : '=') : '';
    return `<tr><td>${i + 1}</td><td class="sk-ch-tm">${esc(boardName(l.board, l.boardName))}</td>
      <td>${num(o)}</td><td><b>${num(m)}</b>${mark ? ` <span class="sk-ch-mark" aria-hidden="true">${mark}</span>` : ''}</td></tr>`;
  }).join('');
  const them = side === 'a' ? g.b : g.a;
  const tl = CH.tally(g);
  const myTot = side === 'a' ? tl.aTotal : tl.bTotal;
  const thTot = side === 'a' ? tl.bTotal : tl.aTotal;
  const foot = g.legs.length > 1
    ? `<tr class="sk-ch-foot"><td></td><td>${esc(g.scoring === 'total' ? t('ch_total') : t('ch_games_won'))}</td>
        <td>${g.scoring === 'total' ? thTot : (side === 'a' ? tl.bWins : tl.aWins)}</td>
        <td><b>${g.scoring === 'total' ? myTot : (side === 'a' ? tl.aWins : tl.bWins)}</b></td></tr>` : '';
  return `<table class="sk-ch-table"><thead><tr><th>#</th><th>${esc(t('ch_machine'))}</th>
    <th>${esc(them.name || t('ch_someone'))}</th><th>${esc(t('ch_you'))}</th></tr></thead>
    <tbody>${rows}${foot}</tbody></table>`;
}

// --- the challenge list, and everything reached from it -------------------------------------------

/**
 * Open the challenges sheet. `focus` = { kind:'challenge'|'over', id } lands straight on that one
 * (the launcher bubble's handoff); `open` = id does the same from anywhere. `pickFor` = { code,
 * name, emoji } starts a new challenge to them. `seed` is for local probes only (the __h4Test
 * precedent): index rows to show instead of reading Firebase, which a local browser cannot reach.
 * The game never passes it.
 */
export function openChallenges(ui, { focus = null, open = null, pickFor = null, seed = null, seedGame = null } = {}) {
  const el = document.createElement('div');
  el.className = 'gh-overlay sk-ch-veil';
  const state = { rows: null, players: null, recs: null, board: null, caption: '', count: 1, all: false, scoring: 'games', busy: false, view: null };
  let stopWatch = () => {};
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    try { stopWatch(); } catch { /* fine */ }
    if (el.parentNode) el.parentNode.removeChild(el);
    if (ui.overlay === el) ui.overlay = null;
    ui._paintChallengeBadge();
  };
  el._skClose = close;           // ui._closeOverlay() calls this, so the live watch stops too

  const shell = (title, body, back) => {
    el.innerHTML = `
      <div class="gh-modal sk-ch" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
        ${back ? `<button type="button" class="sk-ch-back" data-role="back" aria-label="${esc(t('ch_back'))}">&#8249;</button>` : ''}
        <h2 class="sk-ch-title">${esc(title)}</h2>
        <div class="sk-ch-body">${body}</div>
      </div>`;
    el.querySelector('[data-role="close"]').addEventListener('click', close);
    const b = el.querySelector('[data-role="back"]');
    if (b) b.addEventListener('click', back);
  };
  const note = (s) => `<p class="sk-ch-note">${esc(s)}</p>`;

  // --- list ---
  const rowHtml = (r, i) => {
    const fmt = esc(formatLine(r));
    let line; let side = '';
    const multi = r.n > 1 || r.all;
    if (r.over) {
      const head = r.result === 'won' ? t('ch_row_won') : r.result === 'lost' ? t('ch_row_lost') : t('ch_row_draw');
      line = `${esc(head)} · ${fmt}`;
      side = multi && r.scoring !== 'total' ? `${r.myWins} : ${r.theirWins}` : `${num(r.mine)} : ${num(r.theirs)}`;
    } else if (CH.isExpired(r)) {
      line = `${esc(t('ch_expired'))} · ${fmt}`;
    } else if (r.yourTurn && r.sent) {
      line = `${fmt} · ${esc(t('ch_your_games', { p: r.played, n: r.n }))}`;
    } else if (r.yourTurn) {
      line = multi ? `${fmt} · ${esc(t('ch_your_games', { p: r.played, n: r.n }))}` : `${fmt} · ${esc(t('ch_beat', { n: num(r.theirs) }))}`;
      side = esc(timeLeft(r.expires));
    } else {
      line = `${fmt} · ${esc(t('ch_waiting'))}`;
      side = r.expires ? esc(timeLeft(r.expires)) : '';
    }
    return `<button type="button" class="sk-ch-row is-go" data-row="${i}">
        <span class="sk-ch-who"><span aria-hidden="true">${esc(r.emoji)}</span> ${esc(r.name || t('ch_someone'))}</span>
        <span class="sk-ch-line">${line}</span>
        ${side ? `<span class="sk-ch-side">${side}</span>` : ''}
      </button>`;
  };

  const viewList = () => {
    state.view = 'list';
    const rows = state.rows;
    let body;
    if (!rows) body = note(t('ch_loading'));
    else {
      const g = CH.groupRows(rows);
      const done = g.done.slice(0, 12);
      const all = [...g.toPlay, ...g.sent, ...done];
      const sec = (title, list) => (list.length ? `<section class="sk-ch-sec"><h3>${esc(title)}</h3>
        ${list.map((r) => rowHtml(r, all.indexOf(r))).join('')}</section>` : '');
      body = `${sec(t('ch_sec_play'), g.toPlay)}${sec(t('ch_sec_sent'), g.sent)}${sec(t('ch_sec_done'), done)}`
        || note(t('ch_none'));
      state.listed = all;
    }
    shell(t('ch_title'), `
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="new">${esc(t('ch_new'))}</button>
      <div class="sk-ch-list">${body}</div>`, null);
    el.querySelector('[data-act="new"]').addEventListener('click', () => viewPick());
    for (const b of el.querySelectorAll('button[data-row]')) {
      b.addEventListener('click', () => viewMatch(state.listed[+b.dataset.row].id));
    }
  };

  // --- pick a person ---
  const loadPlayers = async () => {
    if (state.players) return state.players;
    const all = await readPlayersOnce().catch(() => ({}));
    state.recs = all || {};
    state.players = CH.opponentsFrom(state.recs, CH.myCode());
    return state.players;
  };
  const viewPick = async () => {
    state.view = 'pick';
    shell(t('ch_pick'), note(t('ch_loading')), viewList);
    const list = await loadPlayers();
    if (closed || state.view !== 'pick') return;
    shell(t('ch_pick'), list.length ? `<div class="sk-ch-list">${list.map((o, i) => `
      <button type="button" class="sk-ch-row is-go" data-who="${i}">
        <span class="sk-ch-who"><span aria-hidden="true">${esc(o.emoji)}</span> ${esc(o.name)}</span>
      </button>`).join('')}</div>` : note(t('ch_no_players')), viewList);
    for (const b of el.querySelectorAll('[data-who]')) {
      b.addEventListener('click', () => viewTerms(list[+b.dataset.who]));
    }
  };

  // --- the format, the machine and a caption ---
  const viewTerms = async (them, err = '') => {
    if (!them) return viewList();
    state.view = 'terms';
    if (!state.recs) { shell(t('ch_to', { name: them.name }), note(t('ch_loading')), viewPick); await loadPlayers(); }
    if (closed || state.view !== 'terms') return;
    const mine = new Set([...localUnlocked(), ...unlockedFrom(state.recs, CH.myCode())]);
    const boards = challengeBoards(mine);
    if (boards.length < 2) state.all = false;
    if (!boards.some((b) => b.id === state.board)) state.board = (boards.find((b) => b.id === ui.settings.board) || boards[0] || {}).id || null;
    // A CHECKMARK, NOT JUST A COLOUR (Matt is red/green colourblind): the chosen chip carries a
    // check, a heavier border and a heavier weight.
    const chip = (key, val, label, on) => `<button type="button" class="gh-btn sk-ch-opt${on ? ' is-on' : ''}"
      data-${key}="${esc(val)}" aria-pressed="${on}">${on ? '<span aria-hidden="true">&check; </span>' : ''}${esc(label)}</button>`;
    const fmtChips = [1, 3, 5].map((n) => chip('count', n, n === 1 ? t('ch_one_game') : t('ch_n_games', { n }), !state.all && state.count === n)).join('')
      + (boards.length > 1 ? chip('count', 'all', t('ch_all_machines'), state.all) : '');
    const multi = state.all || state.count > 1;
    const scChips = chip('scoring', 'games', t('ch_sc_games'), state.scoring === 'games') + chip('scoring', 'total', t('ch_sc_total'), state.scoring === 'total');
    const machines = state.all
      ? `<p class="sk-ch-note">${esc(boards.map((b) => b.name).join(', '))}</p>`
      : `<div class="sk-ch-opts">${boards.map((b) => chip('board', b.id, b.name, b.id === state.board)).join('')}</div>`;
    shell(t('ch_to', { name: them.name }), boards.length ? `
      <p class="sk-ch-label">${esc(t('ch_format'))}</p>
      <div class="sk-ch-opts">${fmtChips}</div>
      ${multi ? `<p class="sk-ch-label">${esc(t('ch_scoring'))}</p><div class="sk-ch-opts">${scChips}</div>` : ''}
      <p class="sk-ch-label">${esc(state.all ? t('ch_machines') : t('ch_machine'))}</p>
      ${machines}
      <label class="gh-field sk-ch-field">
        <span class="gh-field__label">${esc(t('ch_caption'))}</span>
        <input class="gh-input" type="text" maxlength="${CH.MAX_CAPTION}" data-role="caption"
               placeholder="${esc(t('ch_caption_ph'))}" value="${esc(state.caption)}">
      </label>
      ${note(t('ch_terms_note', { name: them.name }))}
      ${err ? `<p class="sk-ch-err" role="alert">${esc(err)}</p>` : ''}
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="start">${esc(t('ch_start'))}</button>`
      : note(t('ch_no_machine')), viewPick);
    const keep = () => { const box = el.querySelector('[data-role="caption"]'); if (box) state.caption = box.value; };
    for (const b of el.querySelectorAll('[data-count]')) b.addEventListener('click', () => {
      keep();
      if (b.dataset.count === 'all') state.all = true; else { state.all = false; state.count = +b.dataset.count; }
      viewTerms(them);
    });
    for (const b of el.querySelectorAll('[data-scoring]')) b.addEventListener('click', () => { keep(); state.scoring = b.dataset.scoring; viewTerms(them); });
    for (const b of el.querySelectorAll('[data-board]')) b.addEventListener('click', () => { keep(); state.board = b.dataset.board; viewTerms(them); });
    const start = el.querySelector('[data-act="start"]');
    if (start) start.addEventListener('click', async () => {
      if (state.busy) return;
      keep();
      state.busy = true;
      start.disabled = true;
      start.textContent = t('ch_starting');
      const legs = CH.makeLegs({ count: state.count, all: state.all, board: state.board, boards });
      const res = await CH.createChallenge({ them, legs, scoring: multi ? state.scoring : 'games', all: state.all,
        caption: CH.cleanCaption(state.caption) });
      state.busy = false;
      if (closed) return;
      if (!res.ok) {
        return viewTerms(them, res.reason === 'denied' ? t('ch_err_off') : res.reason === 'dev-origin-blocked'
          ? t('ch_err_dev') : t('ch_err_start'));
      }
      close();
      ui._startChallengeLeg({ id: res.game.id, side: 'a', leg: 0, game: res.game });
    });
  };

  // --- one match: where it stands, and the next game to play ---
  const viewMatch = async (id, fallbackRow = null) => {
    state.view = 'match';
    shell(t('ch_title'), note(t('ch_loading')), viewList);
    const raw = (seedGame && seedGame.id === id) ? seedGame : await CH.readChallenge(id);
    if (closed || state.view !== 'match') return;
    if (!raw) { shell(t('ch_title'), note(t('ch_err_read')), viewList); return; }
    const g = CH.withLocal(raw);
    const side = CH.sideOf(g, CH.myCode());
    if (!side) { shell(t('ch_title'), note(t('ch_err_read')), viewList); return; }
    CH.markSeen(id, raw.updated);
    const them = side === 'a' ? g.b : g.a;
    const expired = CH.isExpired({ over: g.over, expires: g.expires });
    const next = expired ? -1 : CH.nextLeg(g, side, (i) => CH.legPlayed(id, side, i));
    const res = CH.resultFor(g, side);
    const title = res ? (res === 'won' ? t('ch_won') : res === 'lost' ? t('ch_lost') : t('ch_draw'))
      : side === 'a' ? t('ch_yours_to', { name: them.name || t('ch_someone') })
        : t('ch_from', { name: them.name || t('ch_someone') });
    let status = '';
    if (!g.over && expired) status = t('ch_expired_long');
    else if (!g.over && next < 0) status = g.stage === side ? t('ch_queued') : t('ch_waiting_on', { name: them.name || t('ch_someone') });
    const play = next >= 0 ? `
      ${note(t('ch_one_rack'))}
      ${side === 'b' && g.expires ? `<p class="sk-ch-left">${esc(timeLeft(g.expires))}</p>` : ''}
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="go">${esc(g.legs.length > 1
        ? t('ch_play_n', { k: next + 1, n: g.legs.length, m: boardName(g.legs[next].board, g.legs[next].boardName) })
        : t('play'))}</button>` : '';
    shell(title, `
      <p class="sk-ch-machine">${esc(formatLine(g))}</p>
      <p class="sk-ch-caption" data-role="cap"></p>
      ${legsTable(g, side)}
      ${status ? note(status) : ''}
      ${play}
      ${g.over ? `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-act="again">${esc(t('ch_rematch'))}</button>` : ''}`, viewList);
    const cap = el.querySelector('[data-role="cap"]');
    if (cap && g.caption) cap.textContent = `“${g.caption}”`;
    const go = el.querySelector('[data-act="go"]');
    if (go) go.addEventListener('click', () => { close(); ui._startChallengeLeg({ id, side, leg: next, game: g }); });
    const again = el.querySelector('[data-act="again"]');
    if (again) again.addEventListener('click', () => viewTerms({ code: them.code, name: them.name, emoji: them.emoji }));
  };

  ui._closeOverlay();
  ui.root.appendChild(el);
  ui.overlay = el;
  el.addEventListener('click', (e) => { if (e.target === el) close(); });

  let focused = false;
  const onRows = (rows) => {
    state.rows = rows;
    if (closed) return;
    if (focus && !focused) {
      focused = true;
      if (rows.some((x) => x.id === focus.id)) return viewMatch(focus.id);
    }
    if (state.view === 'list') viewList();
  };
  if (pickFor) viewTerms(pickFor);
  else if (open) viewMatch(open);
  else viewList();
  if (Array.isArray(seed)) { onRows(CH.sortRows(seed)); return el; }
  // A score still owed from an earlier game goes first, so the list it paints is already true.
  CH.flushOutbox().catch(() => {}).then(() => CH.readMyChallenges()).then((rows) => {
    onRows(rows);
    // LIVE while open: a challenge arriving or being answered repaints the list.
    return CH.watchMyChallenges((live) => { if (!closed) onRows(live); });
  }).then((stop) => { if (closed) { try { stop(); } catch { /* fine */ } } else stopWatch = stop; });
  return el;
}

// --- the card at the end of each challenge game ---------------------------------------------------

/**
 * Replaces the ordinary game-over card for a challenge game. The rack has already been RECORDED as
 * an ordinary rack and its score FINALISED in the outbox by the caller; this sends it and says
 * what happened. `ctx` is ui.challenge: { id, side, leg, game }.
 */
export function showChallengeOver(ui, result) {
  const ctx = ui.challenge;
  const el = document.createElement('div');
  el.className = 'gh-overlay sk-over-veil';
  const s = result.score | 0;

  const paint = (g, status) => {
    const side = ctx.side;
    const n = g.legs.length;
    const them = side === 'a' ? g.b : g.a;
    const name = them.name || t('ch_someone');
    const target = CH.scoresOf(g, side === 'a' ? 'b' : 'a')[ctx.leg];
    // ONE GAME PER TURN (v3): after any game the turn passes, so this card never offers the next
    // game - it says who won, or that the challenge is sent, or whose turn it is now.
    const d = CH.decide(g);
    const first = side === 'a' && ctx.leg === 0;
    let head;
    if (g.over || d.done) {
      const w = g.over ? g.over.winner : d.winner;
      head = w === side ? t('ch_won') : w == null ? t('ch_draw') : t('ch_lost');
    } else if (first) head = t('ch_sent_h');
    else head = n > 1 ? t('ch_game_k', { k: ctx.leg + 1, n }) : t('over_h');
    const vs = target != null
      ? `<div class="sk-ch-vs"><div><b>${s}</b><em>${esc(t('ch_you'))}</em></div><div><b>${target}</b><em>${esc(name)}</em></div></div>`
      : `<p class="sk-over-score">${s}</p>`;
    const aNote = (g.over || d.done) ? '' : note(t('ch_turn_passed', { name }));
    el.innerHTML = `
      <div class="gh-modal sk-over sk-ch-over" role="dialog" aria-label="${esc(head)}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
        <h2 class="sk-over-title">${esc(head)}</h2>
        <p class="sk-over-machine">${esc(boardName(g.legs[ctx.leg].board, g.legs[ctx.leg].boardName))}${n > 1 ? ` · ${esc(t('ch_game_k', { k: ctx.leg + 1, n }))}` : ''}</p>
        ${vs}
        ${n > 1 ? legsTable(g, side) : ''}
        ${aNote}
        <p class="sk-ch-note" data-role="status">${esc(status)}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="done">${esc(t('ch_done'))}</button>
        </div>
      </div>`;
    const done = () => { ui.challenge = null; ui._renderSetup(); };
    el.querySelector('[data-role="close"]').addEventListener('click', done);
    el.querySelector('[data-act="done"]').addEventListener('click', done);
  };
  const note = (x) => `<p class="sk-ch-note">${esc(x)}</p>`;

  // Paint at once from what this device knows (its own finalised score laid over the match), then
  // again from the server's answer once the score has been sent.
  paint(CH.withLocal(ctx.game), t('ch_sending'));
  CH.flushOutbox().then((r) => {
    if (ui.disposed) return;
    const me = (x) => x.id === ctx.id && x.side === ctx.side && x.leg === ctx.leg;
    const mine = r.sent.find(me);
    const no = r.refused.find(me);
    if (mine) { ctx.game = mine.game; paint(CH.withLocal(mine.game), t('ch_sent_score')); return; }
    const later = r.sent.filter((x) => x.id === ctx.id).pop();
    const g = CH.withLocal(later ? later.game : ctx.game);
    if (no) paint(g, no.reason === 'dev-origin-blocked' ? t('ch_err_dev') : no.reason === 'already-over' ? t('ch_err_answered') : t('ch_err_send'));
    else paint(g, t('ch_saved_later'));
  }).catch(() => paint(CH.withLocal(ctx.game), t('ch_saved_later')));
  return el;
}
