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
import { makeT, getLang } from '../../js/i18n.js';
import { loadPalette, paletteItems, reactionText } from '../../js/mp-reactions.js';
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
    // (2026-09-23) ONE BIG ACTION, THREE SMALL ONES, THEN YOUR GAMES SPLIT BY WHOSE MOVE IT IS.
    // Matt, with two screenshots of this screen: "Make this page better/easier to navigate. And
    // let people quit games." It was five full-width rows before the first game, so the list
    // scrolled off a phone; every row said "Waiting on <name>" beside the same name; names and
    // "Game 1 of 3" wrapped onto four lines. Now: Challenge is the one primary button, Host / Join
    // / Pass and play share a row, "Your turn" comes first, History is a link, and every game has
    // a Quit (a resignation - nothing is deleted, see MP.resignGame).
    const tile = (go, icon, label) => `
      <button type="button" class="h4-mp-tile" data-go="${go}"><span class="h4-mp-ico" aria-hidden="true">${icon}</span><span>${esc(label)}</span></button>`;
    shell(t('mpHome'), `
      <button type="button" class="h4-mp-act is-primary h4-mp-big" data-go="pick"><span aria-hidden="true">&#9876;&#65039;</span> ${esc(t('mpChallengeBig'))}</button>
      <div class="h4-mp-tiles">
        ${tile('host', '&#128225;', t('mpHostShort'))}
        ${tile('join', '&#128273;', t('mpJoinShort'))}
        ${tile('pass', '&#128241;', t('mpPassShort'))}
      </div>
      <div data-role="games"><p class="h4-mp-sub">${t('mpGames')}...</p></div>
      <button type="button" class="h4-mp-link" data-go="history">${esc(t('mpHistory'))} &rsaquo;</button>`);
    for (const b of el.querySelectorAll('[data-go]')) ui.on(b, 'click', () => go(b.dataset.go));
    // The list is filled in behind the painted screen rather than in front of it, the repo's own
    // rule for a screen that waits on a read: name what replaces it, and when.
    MP.drainOutbox().catch(() => {});
    const rows = await MP.readMyGames();
    const box = el.querySelector('[data-role="games"]');
    if (!box) return;                                   // the sheet closed while the read was out
    state.games = rows;
    // Every finished match this device has not yet counted is counted now, once (see
    // MP.recordFinished) - including a game the other person won, or quit.
    try { MP.recordFinished(rows); } catch (err) { console.warn('[hoops4] recordFinished', err); }
    const live = rows.filter((r) => r && !r.over);
    const mine = live.filter((r) => r.yourTurn);
    const theirs = live.filter((r) => !r.yourTurn);
    const sec = (title, list) => list.length ? `
      <section class="h4-mp-sec"><h3>${esc(title)} <span class="h4-mp-count">${list.length}</span></h3>
        <div class="h4-mp-games">${list.map(gameRow).join('')}</div></section>` : '';
    box.innerHTML = live.length
      ? sec(t('mpSecYours'), mine) + sec(t('mpSecTheirs'), theirs)
      : `<p class="h4-mp-sub">${t('mpNoActive')}</p>`;
    for (const b of box.querySelectorAll('[data-game]')) ui.on(b, 'click', () => openGame(b.dataset.game));
    for (const b of box.querySelectorAll('[data-quit]')) ui.on(b, 'click', (e) => { e.stopPropagation(); confirmQuit(b.dataset.quit); });
  }

  function gameRow(r) {
    const cls = r.yourTurn ? 'is-yours' : 'is-theirs';
    // Only a real series says so - "Game 1 of 1" is noise on a one-off.
    const bits = [];
    if (r.series > 1) bits.push(t('gameOf', { n: r.seriesNo, m: r.series }));
    if (r.oneShot) bits.push(t('shotsOne'));            // the default rule goes unsaid
    // NO STATUS CHIP: the section heading ("Your turn" / "Waiting on them") already says it in
    // words, and a chip repeating it squeezed every name to an ellipsis.
    return `<div class="h4-mp-game ${cls}">
        <button type="button" class="h4-mp-open" data-game="${esc(r.id)}">
          <span class="h4-mp-emo" aria-hidden="true">${esc(r.emoji)}</span>
          <span class="h4-mp-txt"><span class="h4-mp-name">${esc(r.name || '?')}</span>
            <span class="h4-mp-meta">${esc(bits.join(' · '))}</span></span>
        </button>
        <button type="button" class="h4-mp-quit" data-quit="${esc(r.id)}" aria-label="${esc(t('mpQuitAria', { who: r.name || '?' }))}">${esc(t('mpQuit'))}</button>
      </div>`;
  }

  /** QUITTING IS RESIGNING. It asks first, says it counts as a loss, and writes `over` on the
   *  match through MP.resignGame - it deletes nothing. The other person sees "Won, they
   *  resigned" in their history. */
  function confirmQuit(id) {
    const row = (state.games || []).find((r) => r && r.id === id);
    const who = (row && row.name) || '?';
    const ov = document.createElement('div');
    ov.className = 'gh-overlay';
    ov.innerHTML = `
      <div class="gh-modal" role="dialog" aria-modal="true" aria-label="${esc(t('mpQuitQ'))}">
        <h2 class="gh-modal__title">${esc(t('mpQuitQ'))}</h2>
        <p class="h4-sheet-body">${esc(t('mpQuitBody', { who }))}</p>
        <p class="h4-mp-note" data-role="err" hidden></p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--block" data-role="no">${esc(t('mpQuitNo'))}</button>
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="yes">${esc(t('mpQuitYes'))}</button>
        </div>
      </div>`;
    ui.root.appendChild(ov);
    const close = () => ov.remove();
    ui.on(ov.querySelector('[data-role="no"]'), 'click', close);
    ui.on(ov.querySelector('[data-role="yes"]'), 'click', async () => {
      const yes = ov.querySelector('[data-role="yes"]');
      yes.disabled = true;
      const res = await MP.resignGame(id);
      if (!res || !res.ok) {
        yes.disabled = false;
        const err = ov.querySelector('[data-role="err"]');
        err.hidden = false; err.textContent = t('mpQuitFail');
        return;
      }
      close();
      viewHome();
    });
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

  async function openGame(id, opts) {
    if (state.busy) return;
    state.busy = true;
    const game = await MP.readGame(id);
    state.busy = false;
    if (!game) { shell(t('mpGames'), note(failure('not-found'), 'warn'), 'home'); return; }
    el.remove();
    ui.startAsync(game, opts);
  }

  // --- challenge history ----------------------------------------------------------------------
  /**
   * EVERY FINISHED MATCH, AND THE RECORD AGAINST EACH PERSON. A SCREEN, NOT A SCHEMA CHANGE: the
   * data was already permanent (nothing in mp.js deletes a match or an index row), and
   * `readMyGames()` already returned finished rows - the active list just filtered them out.
   *
   * The maths is `MP.recordsFrom`, pure and tested. A row written since 2026-09-22 carries its own
   * `result`; an OLDER finished row does not, so its match is READ here (never written back) and
   * the result worked out from that. A match that cannot be read is listed as "Finished" and
   * counted in no column rather than guessed into one.
   *
   * Grouped by the other person's PLAYER CODE, labelled by their name. Result words plus a SHAPE
   * (tick / cross / equals), never a colour alone (Matt is red/green colourblind).
   */
  async function viewHistory() {
    shell(t('mpHistory'), `<p class="h4-mp-sub">${t('mpGames')}...</p>`, 'home');
    const me = MP.myCode();
    const rows = state.games && state.games.length ? state.games : await MP.readMyGames();
    const done = rows.filter((r) => r && r.over).map((r) => ({ ...r }));
    // Old rows only, newest first, and bounded: one read each.
    const old = done.filter((r) => !r.result).sort((x, y) => y.updated - x.updated).slice(0, 40);
    await Promise.all(old.map(async (r) => { try { r.game = await MP.readGame(r.id); } catch { r.game = null; } }));
    if (closed || state.view !== 'history') return;
    const { opponents, finished } = MP.recordsFrom(done, me);
    const lang = getLang();
    const day = (ms) => {
      if (!ms) return '';
      try { return new Date(ms).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short', day: 'numeric' }); }
      catch { return ''; }
    };
    const recRow = (o) => `
      <div class="h4-mp-game h4-hist-rec">
        <span class="h4-mp-who"><span aria-hidden="true">${esc(o.emoji)}</span> ${esc(o.name || o.code)}</span>
        <span class="h4-mp-state h4-hist-line">${esc(t('histLine', { w: o.won, l: o.lost, d: o.draw }))}</span>
      </div>`;
    const word = (r) => (r.resigned === 'me' ? t('histResigned')
      : r.resigned === 'them' ? t('histTheyResigned')
        : r.result === 'won' ? t('histWon') : r.result === 'lost' ? t('histLost')
          : r.result === 'draw' ? t('histDraw') : t('histUnknown'));
    const mark = (r) => (r.result === 'won' ? '\u2713' : r.result === 'lost' ? '\u2715'
      : r.result === 'draw' ? '=' : '\u2022');
    const gameRow2 = (r) => {
      const leg = r.series > 1 ? `<span class="h4-mp-leg">${esc(t('gameOf', { n: r.seriesNo, m: r.series }))}</span>` : '';
      return `<button type="button" class="h4-mp-game h4-hist-game is-${esc(r.result || 'unknown')}" data-past="${esc(r.id)}">
          <span class="h4-mp-who"><span aria-hidden="true">${esc(r.emoji)}</span> ${esc(r.name || '?')}${leg}</span>
          <span class="h4-mp-state h4-hist-res"><span class="h4-hist-mark" aria-hidden="true">${mark(r)}</span>${esc(word(r))}<span class="h4-hist-day">${esc(day(r.updated))}</span></span>
        </button>`;
    };
    shell(t('mpHistory'), finished.length ? `
      <section class="h4-mp-sec">
        <h3>${t('histRecords')}</h3>
        <div class="h4-mp-games">${opponents.map(recRow).join('')}</div>
      </section>
      <section class="h4-mp-sec">
        <h3>${t('histGames')}</h3>
        <div class="h4-mp-games">${finished.slice(0, 30).map(gameRow2).join('')}</div>
      </section>` : note(t('histNone')), 'home');
    // READ ONLY: a finished match opens as a replay with its result card, and nothing is recorded
    // again (ui.js's `review`).
    for (const b of el.querySelectorAll('[data-past]')) {
      ui.on(b, 'click', () => openGame(b.dataset.past, { review: true }));
    }
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
    if (view === 'history') return viewHistory();
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
  try { window.__h4Mp = { go, state, viewTerms, viewHistory }; } catch { /* no window */ }
  return { close };
}

// --- quick chat INSIDE a match (2026-09-22) ---------------------------------------------------------
//
// Matt's playtest list, alongside the series and the caption. A 💬 button on the play HUD opens the
// player's own quick-chat palette (the hub's shared one, `js/mp-reactions.js` - the same emojis
// and phrases every other multiplayer game offers, customised on the profile page) plus one short
// free-text line. What the other person says pops as a bubble NAMED BY THEIR NAME, and the last few
// lines of this match sit at the top of the panel, each labelled "You:" or "Anita:" in words (and
// aligned to its own side), never by colour alone.
//
// NOT js/mp-reactions-ui.js's floating button, deliberately: that one sits at the BOTTOM RIGHT,
// which on this game is the middle of the swipe pad. This button sits in the HUD's band, left of
// the Menu button - the top left belongs to the hub's floating chip (see hoops4.css).
//
// This controller is TRANSPORT-BLIND. ui.js hands it `send(payload)` and feeds it what arrives:
//   LIVE          net.sendReaction / `room.reactions` (one slot per seat, the hub's existing
//                 facility) through `onReactions()`. The room carries only the latest line per
//                 seat, so "the last few" is this device's memory of the match.
//   TURN BY TURN  MP.sendChat / MP.watchChat (`hoops/games/<id>/chat`) through `add()`.

const CHAT_SHOW = 4;      // lines shown at the top of the panel
const CHAT_KEEP = 30;     // lines this device remembers for the match
const POP_MS = 4500;
const MAX_POPS = 3;

/**
 * `root`  the game's .h4-root element; everything is appended inside it (so a module teardown
 *         that empties the root takes it all), and destroy() removes it explicitly as well.
 * `send`  async (payload {t, v}) => { ok, reason? }.
 * `them`  () => ({ name, emoji }) for the other person.
 * `failText` (reason) => the sentence to show when a line did not send.
 */
export function createMatchChat({ root, send, them, failText }) {
  const log = [];
  const known = new Set();
  const timers = new Set();
  const offs = [];
  let unread = 0;
  let open = false;
  let busy = false;
  let err = '';
  let seeded = false;
  let destroyed = false;
  const lastAt = Object.create(null);
  const listen = (tg, ty, fn, o) => { tg.addEventListener(ty, fn, o); offs.push(() => tg.removeEventListener(ty, fn, o)); };

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'h4-chat-btn';
  const panel = document.createElement('div');
  panel.className = 'h4-chat';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  const pops = document.createElement('div');
  pops.className = 'h4-chat-pops';
  pops.setAttribute('aria-live', 'polite');
  root.appendChild(pops);
  root.appendChild(panel);
  root.appendChild(btn);

  const textOf = (e) => reactionText({ t: e.t, v: e.v }, getLang());
  const whoOf = (e) => (e.mine ? t('chatYou') : ((them() || {}).name || '?'));

  function paintBtn() {
    btn.setAttribute('aria-label', t('chat') + (unread ? ` (${unread})` : ''));
    btn.setAttribute('aria-expanded', String(open));
    // THE BADGE IS A NUMBER, not a dot: a count says something a colour cannot.
    btn.innerHTML = `<span aria-hidden="true">💬</span>${unread
      ? `<span class="h4-chat-badge" aria-hidden="true">${unread > 9 ? '9+' : unread}</span>` : ''}`;
    btn.classList.toggle('is-open', open);
  }

  function paintPanel() {
    if (!open) return;
    const items = paletteItems(loadPalette(), getLang());
    const emojis = items.filter((i) => i.payload.t === 'e');
    const words = items.filter((i) => i.payload.t !== 'e');
    const lines = log.slice(-CHAT_SHOW);
    panel.setAttribute('aria-label', t('chat'));
    panel.innerHTML = `
      <div class="h4-chat-log">${lines.length ? lines.map((e) => `
        <p class="h4-chat-line ${e.mine ? 'is-mine' : 'is-them'}"><b class="h4-chat-who">${esc(whoOf(e))}:</b> <span>${esc(textOf(e))}</span></p>`).join('')
        : `<p class="h4-chat-none">${t('chatNone')}</p>`}</div>
      <div class="h4-chat-emojis">${emojis.map((i) => `
        <button type="button" class="h4-chat-emoji" data-k="${esc(i.key)}" aria-label="${esc(i.text)}">${esc(i.text)}</button>`).join('')}</div>
      <div class="h4-chat-phrases">${words.map((i) => `
        <button type="button" class="h4-chat-phrase" data-k="${esc(i.key)}">${esc(i.text)}</button>`).join('')}</div>
      <form class="h4-chat-form" data-role="form">
        <input class="gh-input h4-chat-input" type="text" maxlength="${MP.CHAT_MAXLEN}" autocomplete="off"
               enterkeyhint="send" placeholder="${esc(t('chatPh'))}" aria-label="${esc(t('chatPh'))}">
        <button type="submit" class="gh-btn gh-btn--primary h4-chat-send">${t('chatSend')}</button>
      </form>
      ${err ? `<p class="h4-chat-err" role="alert">${esc(err)}</p>` : ''}`;
    panel._items = Object.create(null);
    for (const i of items) panel._items[i.key] = i.payload;
  }

  function setOpen(on) {
    open = !!on;
    panel.hidden = !open;
    if (open) { unread = 0; err = ''; paintPanel(); }
    paintBtn();
  }

  async function doSend(payload) {
    if (busy || !payload) return;
    busy = true;
    let res;
    try { res = await send(payload); } catch (e) { res = { ok: false, reason: String(e) }; }
    busy = false;
    if (destroyed) return;
    if (!res || !res.ok) {
      // NO SILENT FAILURE (THE LAW rule 6): the panel stays open and says so.
      err = failText ? failText(res && res.reason) : t('chatNotSent');
      if (!open) setOpen(true); else paintPanel();
      return;
    }
    const e = res.entry || {};
    add({ key: e.key || `me${Date.now()}`, mine: true, t: payload.t, v: payload.v, at: e.at || Date.now() }, { pop: true });
    setOpen(false);
  }

  function onPanelClick(e) {
    const b = e.target.closest('button[data-k]');
    if (!b || !panel._items) return;
    doSend(panel._items[b.getAttribute('data-k')]);
  }
  function onSubmit(e) {
    e.preventDefault();
    const input = panel.querySelector('.h4-chat-input');
    const v = MP.cleanChat(input ? input.value : '');
    if (!v) return;
    doSend({ t: 'c', v });
  }
  // Closing on a tap anywhere else - bound to the game's own root, never document.
  function onOutside(e) {
    if (!open) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    setOpen(false);
  }
  listen(btn, 'click', () => setOpen(!open));
  listen(panel, 'click', onPanelClick);
  listen(panel, 'submit', onSubmit);
  listen(root, 'pointerdown', onOutside, true);

  function popBubble(e) {
    const text = textOf(e);
    if (!text) return;
    const who = e.mine ? { name: t('chatYou'), emoji: '' } : (them() || {});
    const el = document.createElement('div');
    el.className = 'h4-chat-pop' + (e.mine ? ' is-mine' : '') + (e.t === 'e' ? ' is-emoji' : '');
    el.innerHTML = `<span class="h4-chat-pop-who">${who.emoji ? `<span aria-hidden="true">${esc(who.emoji)}</span> ` : ''}${esc(who.name || '?')}</span>`
      + `<span class="h4-chat-pop-text">${esc(text)}</span>`;
    pops.appendChild(el);
    while (pops.children.length > MAX_POPS) pops.removeChild(pops.firstChild);
    const t1 = setTimeout(() => { timers.delete(t1); el.classList.add('is-off');
      const t2 = setTimeout(() => { timers.delete(t2); el.remove(); }, 260); timers.add(t2); }, POP_MS);
    timers.add(t1);
  }

  /** One line of this match. `pop` shows it as a bubble; a line from them also badges the
   *  button while the panel is shut. Duplicates (by key) are ignored, so a watch that delivers a
   *  line this device already added cannot show it twice. */
  function add(e, { pop = false } = {}) {
    if (!e || known.has(e.key)) return;
    known.add(e.key);
    log.push(e);
    log.sort((x, y) => x.at - y.at);
    while (log.length > CHAT_KEEP) log.shift();
    if (pop) popBubble(e);
    if (!e.mine && pop && !open) { unread += 1; paintBtn(); }
    if (open) paintPanel();
  }

  /** LIVE: `room.reactions` is one slot per seat, overwritten by that seat's newest line. The first
   *  snapshot only ADOPTS the stamps already there, so joining a room never replays a line that
   *  was said before this device was looking - js/mp-reactions-ui.js's own seeding rule. */
  function onReactions(rx, mySeat) {
    if (!rx || typeof rx !== 'object') { seeded = true; return; }
    if (!seeded) {
      for (const k of Object.keys(rx)) lastAt[k] = (rx[k] && rx[k].at) || 0;
      seeded = true;
      return;
    }
    for (const k of Object.keys(rx)) {
      if (k === String(mySeat)) continue;
      const r = rx[k];
      const at = (r && r.at) || 0;
      if (!(at > (lastAt[k] || 0))) continue;
      lastAt[k] = at;
      if (r.t !== 'e' && r.t !== 'p' && r.t !== 'c') continue;
      add({ key: `${k}:${at}`, mine: false, t: r.t, v: String(r.v || ''), at }, { pop: true });
    }
  }

  function destroy() {
    destroyed = true;
    for (const off of offs) { try { off(); } catch { /* gone */ } }
    offs.length = 0;
    for (const x of timers) clearTimeout(x);
    timers.clear();
    for (const n of [btn, panel, pops]) if (n.parentNode) n.parentNode.removeChild(n);
  }

  paintBtn();
  return { add, onReactions, setOpen, destroy, get log() { return log.slice(); } };
}

export default { openMultiplayer, createMatchChat };
