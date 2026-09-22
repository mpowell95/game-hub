// hoops4/js/mp-ui.js - the "Play a friend" screen: the two ways two people play Connect 4 Hoops.
//
// DOM ONLY. Every decision and every write is in `hoops4/js/mp.js` (turn by turn) or `js/net.js`
// (live), the same split `js/messages-ui.js` keeps from `js/messages.js`. It is lazily imported by
// `ui.js` so a solo player never downloads it.
//
// The two modes are genuinely different protocols and that is on purpose:
//
//   LIVE        js/net.js, `rooms/<CODE>`. Both people are looking at their phones. One hosts and
//               reads out a five-character code, the other types it in. A shared, append-only
//               move log keeps the two boards in lockstep. Needs no rules change to ship.
//   TURN BY TURN  hoops4/js/mp.js, `hoops/games/<id>`. Addressed by PLAYER CODE, so the match
//               follows a person to every device they own. You take your turn and hand it over;
//               they play next time they open the hub. There is no push notification in this repo
//               (js/CLAUDE.md says so in as many words), so the game waits for them on this list.
import { makeT } from '../../js/i18n.js';
import { STRINGS } from './strings.js';
import { deviceId } from '../../js/game-stats.js';
import * as MP from './mp.js';

const t = makeT(STRINGS);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Open the sheet. `ui` is the Hoops4 instance; the only things this module calls on it are
 * `on()` (so every listener is unbound by destroy()), `settings`, `startLive()` and
 * `startAsync()`.
 */
export function openMultiplayer(ui) {
  const el = document.createElement('div');
  el.className = 'gh-overlay h4-sheet';
  ui.root.appendChild(el);

  const state = { view: 'home', busy: false, error: '', games: [], opponents: [], room: null };
  let stopWatch = null;
  let closed = false;
  // ONCE. `shell()` re-renders in place and re-binds the backdrop each time, so by the third view
  // there are three handlers on the same element - and without this guard a single tap on the
  // backdrop would call leaveRoom() three times.
  const close = () => {
    if (closed) return;
    closed = true;
    if (stopWatch) { try { stopWatch(); } catch {} stopWatch = null; }
    // A room left on the lobby screen is abandoned rather than left waiting for somebody who
    // will never arrive. leaveRoom() is safe to call on a room that was never created.
    if (state.room && state.room.code && !state.room.started) {
      import('../../js/net.js').then((net) => { try { net.leaveRoom(state.room.code, 'host'); } catch {} });
    }
    el.remove();
  };

  const oneShot = () => ui.settings && ui.settings.shots === 'one';

  function shell(title, body, backTo) {
    el.innerHTML = `
      <div class="gh-modal h4-mp-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <button type="button" class="gh-modal__close" data-act="close" aria-label="${t('close')}">&times;</button>
        <h2 class="gh-modal__title">${esc(title)}</h2>
        <div class="h4-mp-body">${body}</div>
        ${backTo ? `<div class="gh-modal__actions"><button type="button" class="gh-btn gh-btn--block" data-act="back">${t('close')}</button></div>` : ''}
      </div>`;
    const closeBtn = el.querySelector('[data-act="close"]');
    if (closeBtn) ui.on(closeBtn, 'click', close);
    const back = el.querySelector('[data-act="back"]');
    if (back) ui.on(back, 'click', () => go(backTo));
    ui.on(el, 'click', (e) => { if (e.target === el) close(); });
  }

  function note(msg, kind) {
    if (!msg) return '';
    return `<p class="h4-mp-note${kind ? ' is-' + kind : ''}">${esc(msg)}</p>`;
  }

  // --- home ---------------------------------------------------------------------------------
  async function viewHome() {
    if (!MP.myCode()) {
      shell(t('mp'), note(t('mpNeedName'), 'warn'));
      return;
    }
    // FOUR WAYS TWO PEOPLE PLAY, AS FOUR ROWS THAT SAY WHAT THEY DO. Matt: "within multiplayer
    // options, there's a Host game option, a pass and play option, a challenge option and a Live
    // Challenges section that shows the active games and if it's your turn or their turn."
    //
    // Each row carries ONE line of what it is - not the two-paragraph section headers this screen
    // used to have. "Pass and play" has moved here from the setup screen's opponent row, where it
    // was labelled "Two players" and read as a mode of the computer game.
    // NAMES ONLY. The one-line hints under each of these went the way of the setup screen's
    // tagline - Matt: "Delete all the subtitles on the Multiplayer screen as well". Four buttons
    // whose names say what they are do not need four sentences explaining them.
    const act = (go, label, primary) => `
      <button type="button" class="h4-mp-act${primary ? ' is-primary' : ''}" data-go="${go}">${esc(label)}</button>`;
    shell(t('mpHome'), `
      <div class="h4-mp-acts">
        ${act('pick', t('mpChallenge'), true)}
        ${act('host', t('mpHost'))}
        ${act('join', t('mpJoin'))}
        ${act('pass', t('mpPassPlay'))}
      </div>
      <section class="h4-mp-sec">
        <h3>${t('mpActive')}</h3>
        <div class="h4-mp-games" data-role="games"><p class="h4-mp-sub">${t('mpGames')}...</p></div>
      </section>`);
    for (const b of el.querySelectorAll('[data-go]')) ui.on(b, 'click', () => go(b.dataset.go));
    // The list is filled in behind the painted screen rather than in front of it, the repo's own
    // rule for a screen that waits on a read: name what replaces it, and when.
    MP.drainOutbox().catch(() => {});
    const rows = await MP.readMyGames();
    const box = el.querySelector('[data-role="games"]');
    if (!box) return;                                   // the sheet closed while the read was out
    state.games = rows;
    // ACTIVE means active: a finished match is not something you can take a turn in, and Matt
    // asked for this list to say "if it's your turn or their turn". Finished ones belong in the
    // challenge history, which is the next round's work.
    const live = rows.filter((r) => r && !r.over);
    box.innerHTML = live.length ? live.map(gameRow).join('') : `<p class="h4-mp-sub">${t('mpNoActive')}</p>`;
    for (const b of box.querySelectorAll('[data-game]')) {
      ui.on(b, 'click', () => openGame(b.dataset.game));
    }
  }

  function gameRow(r) {
    const status = r.over ? t('mpOver')
      : r.yourTurn ? t('mpYourMove')
        : t('mpWaitingOn').replace('{who}', r.name || '?');
    const cls = r.over ? 'is-over' : r.yourTurn ? 'is-yours' : 'is-theirs';
    // Only a real series says so - "Game 1 of 1" is noise on a one-off.
    const leg = (r.series > 1) ? `<span class="h4-mp-leg">${esc(t('gameOf', { n: r.seriesNo, m: r.series }))}</span>` : '';
    return `<button type="button" class="h4-mp-game ${cls}" data-game="${esc(r.id)}">
        <span class="h4-mp-who"><span aria-hidden="true">${esc(r.emoji)}</span> ${esc(r.name || '?')}${leg}</span>
        <span class="h4-mp-state">${esc(status)}</span>
      </button>`;
  }

  // --- live: host ----------------------------------------------------------------------------
  async function viewHost() {
    shell(t('mpHost'), `<p class="h4-mp-sub">${t('mpWaiting')}</p>`, 'home');
    const net = await import('../../js/net.js');
    const me = { name: MP.meLabel().name, avatar: MP.meLabel().emoji, emoji: MP.meLabel().emoji, deviceId: deviceId() };
    const res = await net.createRoom('hoops4', { oneShot: oneShot() }, me);
    if (res.error || !res.code) { shell(t('mpHost'), note(t('mpLost'), 'warn'), 'home'); return; }
    state.room = { code: res.code, role: 'host', started: false };
    shell(t('mpHost'), `
      <p class="h4-mp-sub">${t('mpCodeHint')}</p>
      <p class="h4-mp-code" aria-label="${t('mpCode')}">${esc(res.code)}</p>
      <p class="h4-mp-sub" data-role="status">${t('mpWaiting')}</p>`, 'home');
    net.heartbeat(res.code, 'host');
    stopWatch = await net.onRoom(res.code, (room) => {
      if (!room || state.room.started) return;
      if (room.guest && room.guest.deviceId) {
        state.room.started = true;
        if (stopWatch) { try { stopWatch(); } catch {} stopWatch = null; }
        el.remove();
        ui.startLive({
          code: res.code, role: 'host', oneShot: oneShot(),
          them: { name: room.guest.name || '', emoji: room.guest.emoji || '🙂' },
        });
      }
    });
  }

  // --- live: join ----------------------------------------------------------------------------
  function viewJoin() {
    shell(t('mpJoin'), `
      <label class="gh-field">
        <span class="gh-field__label">${t('mpEnterCode')}</span>
        <input class="gh-input h4-mp-input" type="text" inputmode="text" autocapitalize="characters"
               autocomplete="off" spellcheck="false" maxlength="5" data-role="code">
      </label>
      <p class="h4-mp-note" data-role="err"></p>
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="join">${t('mpJoinBtn')}</button>`, 'home');
    const input = el.querySelector('[data-role="code"]');
    const err = el.querySelector('[data-role="err"]');
    const tryJoin = async () => {
      if (state.busy) return;
      state.busy = true;
      err.textContent = '';
      const net = await import('../../js/net.js');
      const me = { name: MP.meLabel().name, avatar: MP.meLabel().emoji, emoji: MP.meLabel().emoji, deviceId: deviceId() };
      const res = await net.joinRoom(String(input.value || '').trim().toUpperCase(), me);
      state.busy = false;
      if (res.error || !res.room) { err.textContent = t('mpBadCode'); return; }
      const code = String(input.value || '').trim().toUpperCase();
      net.heartbeat(code, 'guest');
      el.remove();
      ui.startLive({
        code, role: 'guest',
        // THE HOST'S CONFIG WINS. Both sides must agree on whether a miss passes the turn, or the
        // two boards disagree about whose turn it is from the first airball onward.
        oneShot: !!(res.room.config && res.room.config.oneShot),
        them: { name: (res.room.host && res.room.host.name) || '', emoji: (res.room.host && res.room.host.emoji) || '🙂' },
      });
    };
    ui.on(el.querySelector('[data-act="join"]'), 'click', tryJoin);
    ui.on(input, 'keydown', (e) => { if (e.key === 'Enter') tryJoin(); });
    try { input.focus(); } catch {}
  }

  // --- turn by turn: who ----------------------------------------------------------------------
  async function viewPick() {
    shell(t('mpPick'), `<p class="h4-mp-sub">${t('mpPick')}</p>`, 'home');
    const list = await MP.readOpponents();
    state.opponents = list;
    shell(t('mpPick'), list.length ? `
      <div class="h4-mp-games">${list.map((o, i) => `
        <button type="button" class="h4-mp-game" data-who="${i}">
          <span class="h4-mp-who"><span aria-hidden="true">${esc(o.emoji)}</span> ${esc(o.name)}</span>
          <span class="h4-mp-state">${esc(o.code)}</span>
        </button>`).join('')}</div>` : note(t('mpNoOne')), 'home');
    for (const b of el.querySelectorAll('[data-who]')) {
      ui.on(b, 'click', () => viewTerms(state.opponents[+b.dataset.who]));
    }
  }

  // --- turn by turn: the terms ------------------------------------------------------------------
  /**
   * WHAT THE CHALLENGE IS, before it is sent. Matt: "Before you challenge someone or anything,
   * you should be able to select the shots per turn setting and if you want to play a single
   * game, best of 3 series or best of 5 series... Maybe include a caption option thing where you
   * can say something to your opponent."
   *
   * The shot rule DEFAULTS to the setup screen's, because that is the one the challenger has
   * already chosen for themselves - but it is settable here, because it is the rule BOTH people
   * will play under and this is the only moment either of them agrees to it.
   */
  function viewTerms(them) {
    if (!them) return go('home');
    const terms = state.terms || (state.terms = { oneShot: oneShot(), series: 1, caption: '' });
    // A CHECKMARK, NOT JUST A COLOUR. The setup screen's own comment says it: "The selected
    // option is marked by a BORDER, A WEIGHT AND A CHECKMARK, never colour alone (Matt is
    // red/green colorblind)". The first version of this screen reused the class and forgot the
    // glyph, which a screenshot caught - the options looked identical apart from their tint.
    const pick = (group, value, label) => {
      const on = terms[group] === value;
      return `<button type="button" class="gh-btn h4-opt${on ? ' is-on' : ''}"
              data-set="${group}" data-val="${esc(String(value))}"
              aria-pressed="${on}">${on ? '<span class="h4-opt-check" aria-hidden="true">&check;</span>' : ''}${esc(label)}</button>`;
    };
    shell(t('chTitle', { who: them.name }), `
      <div class="h4-row">
        <p class="h4-row-label">${t('shotMode')}</p>
        <div class="h4-opts h4-opts-2">
          ${pick('oneShot', false, t('shotsUntil'))}${pick('oneShot', true, t('shotsOne'))}
        </div>
      </div>
      <div class="h4-row">
        <p class="h4-row-label">${t('chSeries')}</p>
        <div class="h4-opts h4-opts-3">
          ${pick('series', 1, t('chSingle'))}${pick('series', 3, t('chBo3'))}${pick('series', 5, t('chBo5'))}
        </div>
      </div>
      <label class="gh-field h4-row">
        <span class="gh-field__label">${t('chCaption')}</span>
        <input class="gh-input h4-mp-text" type="text" maxlength="${MP.MAX_CAPTION}"
               placeholder="${t('chCaptionPh')}" data-role="caption" value="${esc(terms.caption)}">
      </label>
      <p class="h4-mp-note" data-role="err"></p>
      <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-act="send">${t('chSend')}</button>`,
    'pick');
    for (const b of el.querySelectorAll('[data-set]')) {
      ui.on(b, 'click', () => {
        const g = b.dataset.set;
        terms[g] = g === 'series' ? +b.dataset.val : b.dataset.val === 'true';
        // Keep whatever they have typed so far - re-rendering must not eat the caption.
        const box = el.querySelector('[data-role="caption"]');
        if (box) terms.caption = box.value;
        viewTerms(them);
      });
    }
    ui.on(el.querySelector('[data-act="send"]'), 'click', async () => {
      if (state.busy) return;
      state.busy = true;
      const box = el.querySelector('[data-role="caption"]');
      terms.caption = box ? box.value : '';
      const err = el.querySelector('[data-role="err"]');
      if (err) err.textContent = '';
      const res = await MP.createGame({
        them, oneShot: !!terms.oneShot, series: terms.series, caption: terms.caption,
      });
      state.busy = false;
      if (!res.ok) {
        // Stay on the form with what they typed still in it, rather than throwing it away.
        const e2 = el.querySelector('[data-role="err"]');
        if (e2) { e2.textContent = failure(res.reason); e2.classList.add('is-warn'); }
        return;
      }
      state.terms = null;
      el.remove();
      ui.startAsync(res.game);
    });
  }

  async function openGame(id) {
    if (state.busy) return;
    state.busy = true;
    const game = await MP.readGame(id);
    state.busy = false;
    if (!game) { shell(t('mpGames'), note(failure('not-found'), 'warn'), 'home'); return; }
    el.remove();
    ui.startAsync(game);
  }

  /** A denied write means `database.rules.json` has not been published yet. Say what is wrong
   *  rather than showing a spinner for ever - "no silent write failures" (THE LAW rule 6). */
  function failure(reason) {
    // 'denied' means database.rules.json has not been published yet, and 'dev-origin-blocked'
    // means this is localhost. Neither is "lost the connection", and saying so would send Matt
    // looking for a network problem that is not there.
    if (reason === 'denied' || reason === 'dev-origin-blocked') return t('mpUnavailable');
    if (reason === 'offline' || reason === 'did-not-land') return t('mpOffline');
    if (reason === 'no-player-code') return t('mpNeedName');
    return t('mpLost');
  }

  function go(view) {
    state.view = view;
    if (view === 'host') return viewHost();
    if (view === 'join') return viewJoin();
    if (view === 'pick') return viewPick();
    if (view === 'terms') return viewTerms(state.them);
    if (view === 'pass') return startPassPlay();
    return viewHome();
  }

  /** TWO PEOPLE, ONE PHONE. No room, no match document, no network - `ui.start()` with vsCpu
   *  false and no `mp` is exactly the game the setup screen's "Two players" used to start. */
  function startPassPlay() {
    el.remove();
    ui.start({ vsCpu: false });
  }

  go('home');
  // Read-only hook for the headless drivers, the same precedent as `window.__skTest` and
  // `window.__h4Test`. The opponent list comes from Firebase, which a local probe has no access
  // to, so there is no other way to reach the terms screen and LOOK at it. The game never reads
  // this; `reference/hoops/` does.
  try { window.__h4Mp = { go, state, viewTerms }; } catch { /* no window */ }
  return { close };
}

export default { openMultiplayer };
