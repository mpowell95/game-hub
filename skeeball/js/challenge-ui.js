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

const boardName = (id, fallback) => (BOARDS.some((b) => b.id === id) ? boardById(id).name : (fallback || id));

/** "2 days left" / "5 hours left" / "Expired". */
function timeLeft(expires, now = Date.now()) {
  const left = (+expires || 0) - now;
  if (left <= 0) return t('ch_expired');
  const h = Math.ceil(left / 3600000);
  return h >= 24 ? t('ch_days_left', { n: Math.ceil(h / 24) }) : t('ch_hours_left', { n: h });
}

// --- which machines two people can both play ------------------------------------------------------

/**
 * PURE. The machines a challenge between two players may be on: not in testing (a testing rack is
 * practice and counts for nothing), and open to BOTH - released to everyone, the first machine, or
 * earned by each of them. `mine`/`theirs` are Sets of unlocked board ids. `testing(b)`/`released(b)`
 * are injected so this is testable without the admin config.
 */
export function sharedBoards(mine, theirs, { boards = BOARDS, testing, released } = {}) {
  const isTesting = testing || ((b) => isBoardTesting(b.id, !!b.adminOnly));
  const isReleased = released || ((b) => isBoardReleased(b.id));
  const can = (set, b) => b.id === DEFAULT_BOARD || isReleased(b) || (set && set.has(b.id));
  return boards.filter((b) => !isTesting(b) && can(mine, b) && can(theirs, b));
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

// --- the challenge list, and everything reached from it -------------------------------------------

/**
 * Open the challenges sheet. `focus` = { kind:'challenge'|'over', id } lands straight on that one
 * (the launcher bubble's handoff). `pickFor` = { code, name, emoji } starts a new challenge to them.
 * `seed` is for local probes only (the __h4Test precedent): index rows to show instead of reading
 * Firebase, which a local browser cannot reach. The game never passes it.
 */
export function openChallenges(ui, { focus = null, pickFor = null, seed = null } = {}) {
  const el = document.createElement('div');
  el.className = 'gh-overlay sk-ch-veil';
  const state = { rows: null, players: null, them: null, board: null, caption: '', busy: false };
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
  // ui._closeOverlay() only removes the node; this makes it stop the live watch too.
  el._skClose = close;

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
    const machine = esc(boardName(r.board, r.boardName));
    let line; let side = '';
    if (r.over) {
      const head = r.result === 'won' ? t('ch_row_won') : r.result === 'lost' ? t('ch_row_lost') : t('ch_row_draw');
      line = `${esc(head)} · ${machine}`;
      side = `${r.mine == null ? '-' : r.mine} : ${r.theirs == null ? '-' : r.theirs}`;
    } else if (CH.isExpired(r)) {
      line = `${esc(t('ch_expired'))} · ${machine}`;
    } else if (r.yourTurn) {
      line = `${machine} · ${esc(t('ch_beat', { n: r.theirs }))}`;
      side = esc(timeLeft(r.expires));
    } else {
      line = `${machine} · ${esc(t('ch_you_scored', { n: r.mine }))}`;
      side = esc(timeLeft(r.expires));
    }
    const tag = r.yourTurn && !r.over && !CH.isExpired(r) ? 'button type="button"' : 'div';
    const end = tag === 'div' ? 'div' : 'button';
    return `<${tag} class="sk-ch-row${tag === 'div' ? '' : ' is-go'}" data-row="${i}">
        <span class="sk-ch-who"><span aria-hidden="true">${esc(r.emoji)}</span> ${esc(r.name || t('ch_someone'))}</span>
        <span class="sk-ch-line">${line}</span>
        ${side ? `<span class="sk-ch-side">${side}</span>` : ''}
      </${end}>`;
  };

  const viewList = () => {
    state.view = 'list';
    const rows = state.rows;
    let body;
    if (!rows) body = note(t('ch_loading'));
    else {
      const g = CH.groupRows(rows);
      const all = [...g.toPlay, ...g.sent, ...g.done.slice(0, 12)];
      const sec = (title, list) => (list.length ? `<section class="sk-ch-sec"><h3>${esc(title)}</h3>
        ${list.map((r) => rowHtml(r, all.indexOf(r))).join('')}</section>` : '');
      body = `${sec(t('ch_sec_play'), g.toPlay)}${sec(t('ch_sec_sent'), g.sent)}${sec(t('ch_sec_done'), g.done.slice(0, 12))}`
        || note(t('ch_none'));
      state.listed = all;
    }
    shell(t('ch_title'), `
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="new">${esc(t('ch_new'))}</button>
      <div class="sk-ch-list">${body}</div>`, null);
    el.querySelector('[data-act="new"]').addEventListener('click', () => viewPick());
    for (const b of el.querySelectorAll('button[data-row]')) {
      b.addEventListener('click', () => viewAnswer(state.listed[+b.dataset.row]));
    }
  };

  // --- pick a person ---
  const loadPlayers = async () => {
    if (state.players) return state.players;
    const all = await readPlayersOnce().catch(() => ({}));
    state.all = all || {};
    state.players = CH.opponentsFrom(state.all, CH.myCode());
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

  // --- the machine and a caption ---
  const viewTerms = async (them) => {
    if (!them) return viewList();
    state.view = 'terms';
    state.them = them;
    if (!state.all) { shell(t('ch_to', { name: them.name }), note(t('ch_loading')), viewPick); await loadPlayers(); }
    if (closed || state.view !== 'terms') return;
    const mine = new Set([...localUnlocked(), ...unlockedFrom(state.all, CH.myCode())]);
    const boards = sharedBoards(mine, unlockedFrom(state.all, them.code));
    if (!boards.some((b) => b.id === state.board)) state.board = (boards.find((b) => b.id === ui.settings.board) || boards[0] || {}).id || null;
    const chip = (b) => {
      const on = b.id === state.board;
      return `<button type="button" class="gh-btn sk-ch-opt${on ? ' is-on' : ''}" data-board="${b.id}" aria-pressed="${on}">${on ? '<span aria-hidden="true">&check; </span>' : ''}${esc(b.name)}</button>`;
    };
    shell(t('ch_to', { name: them.name }), boards.length ? `
      <p class="sk-ch-label">${esc(t('ch_machine'))}</p>
      <div class="sk-ch-opts">${boards.map(chip).join('')}</div>
      <label class="gh-field sk-ch-field">
        <span class="gh-field__label">${esc(t('ch_caption'))}</span>
        <input class="gh-input" type="text" maxlength="${CH.MAX_CAPTION}" data-role="caption"
               placeholder="${esc(t('ch_caption_ph'))}" value="${esc(state.caption)}">
      </label>
      ${note(t('ch_terms_note', { name: them.name }))}
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="play">${esc(t('ch_play_rack'))}</button>`
      : note(t('ch_no_machine')), viewPick);
    for (const b of el.querySelectorAll('[data-board]')) {
      b.addEventListener('click', () => {
        const box = el.querySelector('[data-role="caption"]');
        if (box) state.caption = box.value;
        state.board = b.dataset.board;
        viewTerms(them);
      });
    }
    const play = el.querySelector('[data-act="play"]');
    if (play) play.addEventListener('click', () => {
      const box = el.querySelector('[data-role="caption"]');
      const caption = CH.cleanCaption(box ? box.value : state.caption);
      close();
      ui._startChallenge({ mode: 'send', them, board: state.board, caption });
    });
  };

  // --- a challenge to you ---
  const viewAnswer = (r) => {
    if (!r) return viewList();
    state.view = 'answer';
    CH.markSeen(r.id, r.updated);
    const machine = boardName(r.board, r.boardName);
    const queued = CH.isQueued(r.id);
    const expired = CH.isExpired(r);
    shell(t('ch_from', { name: r.name || t('ch_someone') }), `
      <p class="sk-ch-machine">${esc(machine)}</p>
      <p class="sk-ch-label">${esc(t('ch_to_beat'))}</p>
      <p class="sk-ch-big">${r.theirs == null ? '-' : r.theirs}</p>
      <p class="sk-ch-caption" data-role="cap"></p>
      ${queued ? note(t('ch_queued')) : expired ? note(t('ch_expired_long')) : `
        ${note(t('ch_one_rack'))}
        <p class="sk-ch-left">${esc(timeLeft(r.expires))}</p>
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="go">${esc(t('play'))}</button>`}`, viewList);
    // The caption is on the MATCH, not the index row: one read, painted when it lands.
    CH.readChallenge(r.id).then((g) => {
      const cap = el.querySelector('[data-role="cap"]');
      if (cap && g && g.caption && !closed) cap.textContent = `“${g.caption}”`;
    });
    const go = el.querySelector('[data-act="go"]');
    if (go) go.addEventListener('click', () => {
      close();
      ui._startChallenge({ mode: 'answer', id: r.id, board: r.board, target: r.theirs,
        them: { code: r.with, name: r.name, emoji: r.emoji } });
    });
  };

  // --- a result (from the launcher bubble) ---
  const viewResult = (r) => {
    if (!r) return viewList();
    state.view = 'result';
    CH.markSeen(r.id, r.updated);
    const head = r.result === 'won' ? t('ch_won') : r.result === 'lost' ? t('ch_lost') : t('ch_draw');
    shell(head, `
      <p class="sk-ch-machine">${esc(boardName(r.board, r.boardName))}</p>
      <div class="sk-ch-vs">
        <div><b>${r.mine == null ? '-' : r.mine}</b><em>${esc(t('ch_you'))}</em></div>
        <div><b>${r.theirs == null ? '-' : r.theirs}</b><em>${esc(r.name || t('ch_someone'))}</em></div>
      </div>
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="again">${esc(t('ch_rematch'))}</button>
      <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-act="list">${esc(t('ch_all'))}</button>`, null);
    el.querySelector('[data-act="again"]').addEventListener('click', () =>
      viewTerms({ code: r.with, name: r.name, emoji: r.emoji }));
    el.querySelector('[data-act="list"]').addEventListener('click', viewList);
  };

  ui._closeOverlay();
  ui.root.appendChild(el);
  ui.overlay = el;
  el.addEventListener('click', (e) => { if (e.target === el) close(); });

  // What lands first: a named person, a focused challenge, or the list.
  let focused = false;
  const onRows = (rows) => {
    state.rows = rows;
    if (closed) return;
    if (focus && !focused) {
      focused = true;
      const r = rows.find((x) => x.id === focus.id);
      if (r && focus.kind === 'over') return viewResult(r);
      if (r && r.yourTurn && !r.over) return viewAnswer(r);
    }
    if (!state.view || state.view === 'list') viewList();
  };
  if (pickFor) viewTerms(pickFor);
  else { state.view = 'list'; viewList(); }
  if (Array.isArray(seed)) { onRows(CH.sortRows(seed)); return el; }
  // A score still owed from an earlier rack goes first, so the list it paints is already true.
  CH.flushOutbox().catch(() => {}).then(() => CH.readMyChallenges()).then((rows) => {
    onRows(rows);
    // LIVE while open: a challenge arriving or being answered repaints the list.
    return CH.watchMyChallenges((live) => { if (!closed) onRows(live); });
  }).then((stop) => { if (closed) { try { stop(); } catch { /* fine */ } } else stopWatch = stop; });
  return el;
}

// --- the card at the end of a challenge rack -------------------------------------------------------

/**
 * Replaces the ordinary game-over card for a challenge rack. `ch` is ui.challenge; the rack has
 * already been RECORDED by the caller (an ordinary rack) and, for an answer, QUEUED.
 */
export function showChallengeOver(ui, result) {
  const ch = ui.challenge;
  const el = document.createElement('div');
  el.className = 'gh-overlay sk-over-veil';
  const name = (ch.them && ch.them.name) || t('ch_someone');
  const machine = boardName(ch.board);
  const s = result.score | 0;

  const paint = (inner) => {
    el.innerHTML = `
      <div class="gh-modal sk-over sk-ch-over" role="dialog" aria-label="${esc(t('over_h'))}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${esc(t('close'))}">&times;</button>
        ${inner}
      </div>`;
    el.querySelector('[data-role="close"]').addEventListener('click', () => { ui.challenge = null; ui._renderSetup(); });
  };

  if (ch.mode === 'answer') {
    const target = ch.target | 0;
    const head = s > target ? t('ch_won') : s < target ? t('ch_lost') : t('ch_draw');
    paint(`
      <h2 class="sk-over-title">${esc(head)}</h2>
      <p class="sk-over-machine">${esc(machine)}</p>
      <div class="sk-ch-vs">
        <div><b>${s}</b><em>${esc(t('ch_you'))}</em></div>
        <div><b>${target}</b><em>${esc(name)}</em></div>
      </div>
      <p class="sk-ch-note" data-role="status">${esc(t('ch_sending'))}</p>
      <div class="gh-modal__actions">
        <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="done">${esc(t('ch_done'))}</button>
      </div>`);
    el.querySelector('[data-act="done"]').addEventListener('click', () => { ui.challenge = null; ui._renderSetup(); });
    const say = (k) => { const n = el.querySelector('[data-role="status"]'); if (n) n.textContent = t(k); };
    // Say what actually happened to THIS score: sent, still waiting on a connection, or refused
    // (a dev server never writes; a challenge somebody already answered cannot be answered twice).
    CH.flushOutbox().then((r) => {
      const no = r.refused.find((x) => x.id === ch.id);
      if (r.sent.some((x) => x.id === ch.id)) say('ch_sent_score');
      else if (no) say(no.reason === 'dev-origin-blocked' ? 'ch_err_dev' : no.reason === 'already-over' ? 'ch_err_answered' : 'ch_err_send');
      else say('ch_saved_later');
    }).catch(() => say('ch_saved_later'));
  } else {
    const sendView = (err) => {
      paint(`
        <h2 class="sk-over-title">${esc(t('over_h'))}</h2>
        <p class="sk-over-machine">${esc(machine)}</p>
        <p class="sk-over-score">${s}</p>
        <p class="sk-ch-note">${esc(t('ch_send_q', { name }))}</p>
        ${err ? `<p class="sk-ch-err" role="alert">${esc(err)}</p>` : ''}
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="send">${esc(t('ch_send', { name }))}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-act="again">${esc(t('ch_try_again'))}</button>
        </div>`);
      const btn = el.querySelector('[data-act="send"]');
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = t('ch_sending');
        const res = await CH.sendChallenge({ them: ch.them, board: ch.board, boardName: machine, score: s, caption: ch.caption });
        if (ui.disposed) return;
        if (!res.ok) {
          return sendView(res.reason === 'denied' ? t('ch_err_off') : res.reason === 'dev-origin-blocked'
            ? t('ch_err_dev') : t('ch_err_send'));
        }
        ui.challenge = null;
        paint(`
          <h2 class="sk-over-title">${esc(t('ch_sent_h'))}</h2>
          <p class="sk-over-machine">${esc(machine)}</p>
          <p class="sk-over-score">${s}</p>
          <p class="sk-ch-note">${esc(t('ch_sent_note', { name, n: s }))}</p>
          <div class="gh-modal__actions">
            <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="done">${esc(t('ch_done'))}</button>
          </div>`);
        el.querySelector('[data-act="done"]').addEventListener('click', () => ui._renderSetup());
      });
      el.querySelector('[data-act="again"]').addEventListener('click', () => ui._startGame(null, ch.board));
    };
    sendView('');
  }
  return el;
}
