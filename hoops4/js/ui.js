// hoops4/js/ui.js - CONNECT 4 HOOPS: the shell, the swipe, and the module contract.
//
// THE LAW applies here. Nothing in this folder stores anything earned: `gamehub.hoops4.v1` holds
// one preference (the opponent) and nothing else. The match itself is not persisted - see
// isInProgress() below for which meaning of the contract that is, and why.
import { onViewportResize } from '../../js/viewport.js';
import { makeT } from '../../js/i18n.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult } from '../../js/game-stats.js';
import { swipeSpeed, powerOf, MIN_UP_PX } from '../../skeeball/js/swipe.js';
import { STRINGS } from './strings.js';
import { GAME_ART } from '../../js/game-art.js';
import { BOARD, COLS } from './boarddef.js';
import { Match, RED, YELLOW } from './game.js';
import { Cpu } from './cpu.js';

const t = makeT(STRINGS);
const SETTINGS_KEY = 'gamehub.hoops4.v1';
const CSS_MARK = 'data-hoops4-css';

let instance = null;

const readSettings = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      opponent: [1, 2, 3, 'two'].includes(raw.opponent) ? raw.opponent : 2,
      // 'until' = shoot until you sink one (the original rule), 'one' = one shot and the turn
      // passes. Matt asked for both, especially for multiplayer. Anything unrecognised falls
      // back to 'until' so a bad key can never leave a player unable to end a turn.
      shots: raw.shots === 'one' ? 'one' : 'until',
    };
  } catch { return { opponent: 2, shots: 'until' }; }
};
const writeSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} };

/** Inject the shared primitives (css/ui.css) idempotently, THEN this game's own sheet. Module
 *  stylesheets are never removed on destroy() - they live in the shared document.head for the
 *  life of the page (a hub-wide fact), which is why every rule is scoped under .h4-root. Same
 *  injection marker skeeball/js/ui.js, pipes/js/ui.js and bug-report-ui.js use, so a page that
 *  already loaded css/ui.css for another reason never double-loads it. */
function ensureCSS() {
  // Matched by RESOLVED HREF as well as by marker attribute: hoops4/index.html links
  // ../css/ui.css itself for the standalone page, with no marker attribute at all. Marker-only
  // matching would load a second, identical copy of it there (skeeball/js/ui.js's own guard,
  // same reason).
  const uiHref = new URL('../../css/ui.css', import.meta.url).href;
  const hasUi = document.head.querySelector('link[data-gh-ui-css="1"]')
    || [...document.head.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === uiHref);
  if (!hasUi) {
    const ui = document.createElement('link');
    ui.rel = 'stylesheet';
    ui.href = uiHref;
    ui.setAttribute('data-gh-ui-css', '1');
    document.head.appendChild(ui);
  }
  if (document.head.querySelector('[' + CSS_MARK + ']')) return Promise.resolve();
  return new Promise((res) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/hoops4.css', import.meta.url).href;
    link.setAttribute(CSS_MARK, '1');
    link.onload = link.onerror = () => res();       // a 404 must not hang the mount for ever
    document.head.appendChild(link);
    setTimeout(res, 2500);
  });
}

class Hoops4 {
  constructor(root) {
    this.root = root;
    this.settings = readSettings();
    this.disposed = false;
    this.raf = 0;
    this.match = null;
    this.throwState = null;
    this.offViewport = null;
    this.engine = null;
    this.recorded = false;
    this.mp = null;          // null | {kind:'live',...} | {kind:'async',...}
    this.myPlayer = RED;     // which side THIS device plays in a multiplayer match
    this.net = null;
    this._roomStop = null;
    this.busy = false;
    this._bound = [];
  }

  async mount() {
    await ensureCSS();
    if (this.disposed) return;
    this.root.classList.add('h4-root');
    this.renderSetup();
    this.maybeCeremony();
  }

  /**
   * THE FULL-SCREEN CHALLENGE CARD. Matt: "when you click into the game or click on the popup
   * thing, it goes to a new, full screen popup thing that shows the challengers emoji and your
   * emoji and it says 'XXXX Has Challenged You to Connect 4 Hoops'. The popup needs to clearly
   * show that the challengers emoji and your emoji are opponents. and it should have some kind
   * of animation. Like the key ceremony in Skeeball."
   *
   * ARMED, NEVER BACKFILLED - hoops4/js/alert.js holds the handoff, and the launcher arms it when
   * the player taps the bubble or the tile. An absent entry means no card is owed, so a device
   * that has never been challenged can never be shown one retroactively.
   */
  async maybeCeremony() {
    let armed = null;
    try { const A = await import('./alert.js'); armed = A.takeCeremony(); } catch { return; }
    if (!armed || this.disposed) return;
    this.showCeremony(armed);
  }

  /**
   * THE TIMELINE, in one place, because six animation-delays across five rules are unreadable.
   * The sheet plays it; this only builds the DOM. (Skeeball's ceremony comment is the model, and
   * so is its lesson - Matt on the first cut of that one: "you're rushing it... you just
   * instantly swap what they are". Nothing here switches state; everything arrives.)
   *
   *    0.00  the veil darkens whatever is behind                          (ends 0.45)
   *    0.25  THEIR avatar flies in from the left and overshoots           (ends 1.05)
   *    0.45  YOUR avatar flies in from the right and overshoots           (ends 1.25)
   *    1.15  VS lands between them with a flash                           (ends 1.60)
   *    1.45  the headline rises under the pair                            (ends 2.05)
   *    1.95  the buttons fade in                                          (ends 2.45)
   *    then  IT HOLDS until the player taps (no auto-dismiss)
   *
   * REDUCED MOTION builds the same DOM and adds `is-still`, which settles every element on its
   * final pose - never `display: none` on anything structural (docs/BUILDING-A-GAME.md Part 0).
   */
  showCeremony(a) {
    const me = loadProfile() || {};
    const still = (() => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
    })();
    const who = a.name || t('mpOpponent');
    const head = a.kind === 'challenge'
      ? t('cerChallenged', { who }) : t('cerYourTurn', { who });
    // THE RING COLOURS ARE THE SIDES THEY WILL ACTUALLY PLAY - the challenger is side 'a', which
    // is RED and shoots first. Paired with the same disc/triangle marker the turn pill uses, so
    // "who is who" survives being colourblind (root CLAUDE.md).
    const el = document.createElement('div');
    el.className = 'h4-cer' + (still ? ' is-still' : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', head);
    el.innerHTML = `
      <div class="h4-cer-veil" aria-hidden="true"></div>
      <div class="h4-cer-body">
        <p class="h4-cer-head">${a.kind === 'challenge' ? t('cerHead') : t('cerHeadTurn')}</p>
        <div class="h4-cer-pair">
          <div class="h4-cer-side h4-cer-them">
            <span class="h4-cer-face" aria-hidden="true">${a.emoji || '🙂'}</span>
            <span class="h4-cer-name"><span class="h4-cer-mark" aria-hidden="true">&#9679;</span>${who}</span>
          </div>
          <span class="h4-cer-vs" aria-hidden="true">${t('cerVs')}</span>
          <div class="h4-cer-side h4-cer-me">
            <span class="h4-cer-face" aria-hidden="true">${me.emoji || '🙂'}</span>
            <span class="h4-cer-name"><span class="h4-cer-mark" aria-hidden="true">&#9650;</span>${me.name || t('you')}</span>
          </div>
        </div>
        <p class="h4-cer-line">${head}</p>
        <div class="h4-cer-btns">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block h4-cer-go">
            ${a.kind === 'challenge' ? t('cerGo') : t('cerGoTurn')}</button>
          <button type="button" class="gh-btn gh-btn--block h4-cer-later">${t('cerLater')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    const close = () => { try { el.remove(); } catch {} };
    this.on(el.querySelector('.h4-cer-later'), 'click', close);
    // THE CARD STAYS UP UNTIL THE MATCH IS ACTUALLY OPEN. The first version closed it first and
    // fell back to `toast()`, which returns silently when `.h4-toast` is not on screen - and it
    // never is on the setup screen. So a match that had gone would have dropped the player back
    // with no explanation at all: docs/BUILDING-A-GAME.md Part 0, "if you paint before the data
    // has arrived, name the path back to the truth". The failure is said HERE, on the card.
    const go = el.querySelector('.h4-cer-go');
    this.on(go, 'click', async () => {
      go.disabled = true;
      try {
        const MP = await import('./mp.js');
        const game = await MP.readGame(a.id);
        if (this.disposed) return;
        if (!game) { this._ceremonyFailed(el, go); return; }
        close();
        this.startAsync(game);
      } catch (err) {
        console.error('[hoops4] could not open the challenge', err);
        if (!this.disposed) this._ceremonyFailed(el, go);
      }
    });
  }

  /** The challenge could not be opened. Say so on the card rather than closing it. */
  _ceremonyFailed(el, go) {
    const line = el.querySelector('.h4-cer-line');
    if (line) line.textContent = t('cerGone');
    if (go) go.remove();
    const later = el.querySelector('.h4-cer-later');
    if (later) later.textContent = t('close');
  }

  // --- listener hygiene: destroy() must leave nothing behind ---------------------------------
  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._bound.push([target, type, fn, opts]);
  }
  unbindAll() {
    for (const [tg, ty, fn, o] of this._bound) { try { tg.removeEventListener(ty, fn, o); } catch {} }
    this._bound = [];
  }

  // --- the setup screen -----------------------------------------------------------------------
  // Built on css/ui.css's shared primitives (.gh-card, .gh-btn) rather than the bespoke dark
  // card this screen used to be - Matt: "it looks nothing like the others. it's not on the
  // theme or on brand of the game hub at all." The setup and how-to screens are HUB-SKINNED
  // (light --h4s-* tokens on .h4-root, :root.gh-dark override, hoops4.css's own header) exactly
  // like skeeball's gallery/how-to; the PLAY screen below keeps its own dark arcade look in both
  // themes, unchanged.
  renderSetup() {
    if (this.disposed) return;
    this.stopLoop();
    const s = this.settings;
    // The selected option is marked by a BORDER, A WEIGHT AND A CHECKMARK, never colour alone
    // (Matt is red/green colorblind - root CLAUDE.md's accessibility conventions).
    const check = '<span class="h4-opt-check" aria-hidden="true">&check;</span>';
    // GUARD (THE LAW rule 5): `opponent: 'two'` is a real value in `gamehub.hoops4.v1` on any
    // device that used the old screen, and it is NOT deleted or rewritten here. The CPU row just
    // shows its nearest meaning (Medium) until the player picks something; `start()` reads the
    // same fallback, so a device that never touches this screen keeps behaving sensibly.
    const cpuPick = s.opponent === 'two' ? 2 : s.opponent;
    const opt = (v, label) => {
      const on = cpuPick === v;
      return `<button type="button" class="gh-btn h4-opt${on ? ' is-on' : ''}" data-opp="${v}" aria-pressed="${on}">${on ? check : ''}${label}</button>`;
    };
    const shotOpt = (v, label) => {
      const on = s.shots === v;
      return `<button type="button" class="gh-btn h4-opt${on ? ' is-on' : ''}" data-shots="${v}" aria-pressed="${on}">${on ? check : ''}${label}</button>`;
    };
    // ONE CARD IS THE COMPUTER GAME, AND MULTIPLAYER IS A DOOR. Matt: "What is 2 player? There
    // should be options to play the computer player and 'Multiplayer Options'... The computer
    // player options should just have the difficulties and the shots per turn option."
    //
    // "Two players" is gone from this row - it was pass-and-play wearing a label that read like
    // a mode of the computer game, which is exactly what made him ask what it was. It is now
    // "Pass and play" inside the multiplayer sheet, beside the other two ways two people play.
    this.root.innerHTML = `
      <div class="h4-setup">
        <h1 class="h4-title">${t('title')}</h1>
        <p class="h4-tag">${t('tagline')}</p>
        <!-- A PICTURE OF THE THING. Matt: the setup screen "looks nothing like the others. it's
             not on the theme or on brand of the game hub at all" - and what every other machine's
             setup screen leads with is a picture of the machine (skeeball's gallery is a rendered
             one per cabinet). This is the SAME art the launcher tile uses, from js/game-art.js,
             so the screen you tap and the screen you land on are the same picture. It is inline
             SVG already in the hub's bundle: no WebGL, no readback, no placeholder to correct
             later, and nothing to go wrong offline. -->
        <div class="h4-hero" aria-hidden="true">${GAME_ART['hoops4'] || ''}</div>
        <div class="gh-card h4-card">
          <p class="h4-card-head">${t('vsCpu')}</p>
          <div class="h4-row">
            <p class="h4-row-label">${t('difficulty')}</p>
            <div class="h4-opts h4-opts-3">
              ${opt(1, t('cpu1'))}${opt(2, t('cpu2'))}${opt(3, t('cpu3'))}
            </div>
          </div>
          <div class="h4-row">
            <p class="h4-row-label">${t('shotMode')}</p>
            <div class="h4-opts h4-opts-2">
              ${shotOpt('until', t('shotsUntil'))}${shotOpt('one', t('shotsOne'))}
            </div>
          </div>
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block h4-play">${t('play')}</button>
        </div>
        <button type="button" class="gh-btn gh-btn--block h4-mp">${t('multiplayer')}</button>
        <button type="button" class="h4-howto-link">${t('howto')}</button>
      </div>`;
    for (const b of this.root.querySelectorAll('[data-opp]')) {
      this.on(b, 'click', () => {
        const v = b.dataset.opp === 'two' ? 'two' : Number(b.dataset.opp);
        this.settings.opponent = v;
        writeSettings(this.settings);
        this.renderSetup();
      });
    }
    for (const b of this.root.querySelectorAll('[data-shots]')) {
      this.on(b, 'click', () => {
        this.settings.shots = b.dataset.shots === 'one' ? 'one' : 'until';
        writeSettings(this.settings);
        this.renderSetup();
      });
    }
    // Play means play the computer now, whatever `opponent` happens to hold - the row above can
    // no longer select 'two', so an old stored 'two' must not silently start a pass-and-play game.
    this.on(this.root.querySelector('.h4-play'), 'click', () => this.start({ vsCpu: true }));
    this.on(this.root.querySelector('.h4-mp'), 'click', () => this.showMultiplayer());
    this.on(this.root.querySelector('.h4-howto-link'), 'click', () => this.showHowto());
  }

  /** The multiplayer sheet: host or join a live game, or hand a turn-by-turn match over.
   *  Lazily imported so a solo player never downloads it. */
  async showMultiplayer() {
    try {
      const mod = await import('./mp-ui.js');
      if (this.disposed) return;
      mod.openMultiplayer(this);
    } catch (err) {
      console.error('[hoops4] could not open multiplayer', err);
      this.toast(t('mpLost'));
    }
  }

  // --- multiplayer: the two ways two people play it -------------------------------------------
  //
  // Both end up in the SAME match loop. The only thing `this.mp` changes is who may shoot, and
  // what happens to a shot once it has settled - see `_sendShot` and `_applyRemote` below. The
  // rules themselves are `js/game.js`'s, on both devices, driven by the same move list.

  /** A LIVE room (js/net.js). The host is RED and shoots first; the guest is YELLOW. */
  async startLive({ code, role, oneShot, them }) {
    try {
      this.net = await import('../../js/net.js');
    } catch (err) {
      console.error('[hoops4] net.js failed to load', err);
      this.renderSetup();
      return;
    }
    if (this.disposed) return;
    // `applied` is BOTH the number of log entries this device has consumed and the sequence
    // number its next append will use. One counter, so a move can never be applied twice or
    // written over the other person's.
    this.mp = { kind: 'live', code, role, applied: 0, them: them || null };
    this.myPlayer = role === 'host' ? RED : YELLOW;
    await this.start({ vsCpu: false, oneShot: !!oneShot, keepMp: true });
    if (this.disposed || !this.match) return;
    if (role === 'host') { try { await this.net.startRound(code, 1, null, 0); } catch { /* the room is already active */ } }
    try { this._roomStop = await this.net.onRoom(code, (room) => this._onRoom(room)); }
    catch (err) { console.error('[hoops4] could not watch the room', err); }
  }

  /** A TURN-BY-TURN match (hoops4/js/mp.js). The board is REPLAYED from the move log - there is
   *  no stored position, because a log is the thing that cannot silently be subtly wrong. */
  async startAsync(game) {
    const MP = await import('./mp.js');
    if (this.disposed) return;
    const side = MP.sideOf(game, MP.myCode());
    if (!side) { this.renderSetup(); return; }
    this.mp = { kind: 'async', id: game.id, side, game, MP, sent: false };
    this.myPlayer = side === 'a' ? RED : YELLOW;
    await this.start({ vsCpu: false, oneShot: !!game.oneShot, keepMp: true, replay: (m) => MP.replay(m, game) });
    if (this.disposed || !this.match) return;
    if (game.over) { this.finish(); return; }
    // The match is on the server, so leaving really is free - say so rather than leaving the
    // player to discover it. This is the reassurance half of the isInProgress() fix below.
    this.toast(this.isMyShot() ? t('leaveKept') : t('mpTheirTurn'));
  }

  /** May this device shoot right now? Solo and two-players-on-one-phone: always. Multiplayer:
   *  only on this player's own turn. This is the ONE gate - `shoot()` asks it, so the swipe pad,
   *  the CPU and any future control all answer to the same rule. */
  isMyShot() {
    if (!this.match || this.match.over) return false;
    if (!this.mp) return true;
    return this.match.turn === this.myPlayer;
  }

  /** One entry of the shared move log arrived from the other device. */
  _onRoom(room) {
    if (!room || !this.mp || this.mp.kind !== 'live' || !this.match) return;
    const log = room.moves || {};
    // STRICTLY IN ORDER, and only once. Out-of-order or duplicated application is how two boards
    // stop being the same board, which is the failure every lockstep invariant in js/CLAUDE.md
    // was written for.
    for (const key of Object.keys(log).sort()) {
      const entry = log[key];
      if (!entry || entry.seq !== this.mp.applied) continue;
      this.mp.applied++;
      if (entry.by === this.mp.role) continue;        // this device already applied its own shot
      this._applyRemote(entry.move);
    }
    if (room.status === 'ended' && this.match && !this.match.over) this.toast(t('mpLost'));
  }

  /** Apply the other player's shot to this board, and paint exactly what a local one paints. */
  _applyRemote(move) {
    const m = this.match;
    if (!m || m.over) return;
    const res = (move && Number.isInteger(move.col)) ? m.land(move.col) : m.miss();
    this._paintShot(res);
    if (m.over) this.finish();
  }

  /** Send this device's settled shot. Live: append to the room's log. Turn by turn: push the move
   *  and hand the match over. */
  async _sendShot(res) {
    const mp = this.mp;
    if (!mp) return;
    const landed = res.type === 'move' || res.type === 'win' || res.type === 'draw';
    const col = landed ? res.col : null;

    if (mp.kind === 'live') {
      const move = landed ? { col } : { miss: true };
      try {
        await this.net.appendMove(mp.code, mp.role, mp.applied, move, 0);
        mp.applied++;
      } catch (err) {
        console.error('[hoops4] could not send the move', err);
        this.toast(t('mpOffline'));
      }
      return;
    }

    // TURN BY TURN. A miss is only worth sending when it PASSED the turn (one-shot); under
    // shoot-until-you-make-it it changes nothing the other person can see.
    const passed = !!res.passed;
    if (!landed && !passed) return;
    const m = this.match;
    const over = m.over
      ? { winner: m.winner === null ? null : (m.winner === RED ? 'a' : 'b'), why: m.winner === null ? 'full' : 'four' }
      : null;
    const payload = { col: landed ? col : null, shots: res.shots || 1, passed, over };
    const r = await mp.MP.pushMove(mp.id, payload);
    if (!r.ok) {
      // KEPT, not lost: a turn somebody actually took is retried on the next open. And the screen
      // SAYS SO - the first cut toasted "Sent. They play next." on top of the failure message a
      // line later, which is a silent write failure wearing a confirmation (THE LAW rule 6).
      if (r.retryable) { mp.MP.queueMove(mp.id, payload); this.toast(t('mpOffline')); }
      else this.toast(t('mpUnavailable'));
      return;
    }
    mp.game = r.game;
    if (!m.over) { mp.sent = true; this.toast(t('mpSent')); }
  }

  showHowto() {
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal h4-sheet-in" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="gh-modal__title">${t('howto')}</h2>
        <p class="h4-sheet-body">${t('howtoBody')}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block h4-sheet-close">${t('close')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    const close = () => el.remove();
    this.on(el.querySelector('[data-role="close"]'), 'click', close);
    this.on(el.querySelector('.h4-sheet-close'), 'click', close);
    this.on(el, 'click', (e) => { if (e.target === el) close(); });
  }

  // --- the match --------------------------------------------------------------------------------
  async start(opts = {}) {
    // A fresh solo match clears any multiplayer state; startLive/startAsync pass keepMp so their
    // own setup survives. Without that, "Play again" after a live match would silently keep
    // appending to a room nobody is in.
    if (!opts.keepMp) { this.mp = null; this.myPlayer = RED; this._stopRoom(); }
    const vsCpu = opts.vsCpu === undefined ? this.settings.opponent !== 'two' : !!opts.vsCpu;
    const oneShot = opts.oneShot === undefined ? this.settings.shots === 'one' : !!opts.oneShot;
    const skill = this.settings.opponent === 'two' ? 2 : this.settings.opponent;
    this.match = new Match({ vsCpu, cpuSkill: vsCpu ? skill : 2, oneShot });
    if (typeof opts.replay === 'function') opts.replay(this.match);
    this.cpu = vsCpu ? new Cpu(skill) : null;
    this.recorded = false;
    this.renderPlay();
    try {
      const [phys, mach, rend] = await Promise.all([
        import('./physics.js'), import('./machine.js'), import('./render.js'),
      ]);
      if (this.disposed) return;
      this.engine = { phys, machine: mach.buildMachine(BOARD.geom), Renderer: rend.Renderer };
      const canvas = this.root.querySelector('.h4-canvas');
      this.rend = new this.engine.Renderer(canvas, BOARD, this.engine.machine);
      this.fit();
      this.rend.setGrid(this.match.cells(), null);
      this.rend.setBallColor(this.match.turn === RED ? BOARD.look.red : BOARD.look.yellow);
      this.offViewport = onViewportResize(() => this.fit());
      this.startLoop();
      this.maybeCpu();
      // Read-only hook for the headless drivers (skeeball's `window.__skTest` precedent). The
      // game itself never reads it; `reference/hoops/check-display.mjs` projects the display and
      // the hoops through the real play camera with it.
      try { window.__h4Test = this; } catch {}
    } catch (err) {
      // A mount that throws lands somewhere recoverable rather than on a dead canvas - the exact
      // failure skeeball shipped on 2026-09-01, where the HUD painted over a 300x150 default.
      console.error('[hoops4] engine failed to load', err);
      if (!this.disposed) this.renderLoadError();
    }
  }

  renderLoadError() {
    this.root.innerHTML = `<div class="h4-setup"><p class="h4-note">${t('loadError')}</p>
      <button type="button" class="gh-btn gh-btn-primary h4-play">${t('play')}</button></div>`;
    this.on(this.root.querySelector('.h4-play'), 'click', () => this.renderSetup());
  }

  renderPlay() {
    this.root.innerHTML = `
      <div class="h4-play-wrap">
        <div class="h4-hud">
          <button type="button" class="h4-menu" aria-label="${t('menu')}">
            <span aria-hidden="true">&lsaquo;</span> ${t('menu')}
          </button>
          <span class="h4-who" aria-live="polite"></span>
          <span class="h4-shots"></span>
        </div>
        <div class="h4-stage">
          <canvas class="h4-canvas"></canvas>
          <div class="h4-swipe" aria-label="${t('swipeHint')}"></div>
          <p class="h4-toast" aria-live="polite"></p>
        </div>
      </div>`;
    this.paintHud();
    this.bindSwipe();
    this.on(this.root.querySelector('.h4-menu'), 'click', () => this.leaveMatch());
  }

  /** OUT OF A MATCH, BUT NOT OUT OF THE GAME. Matt: "we had the Hub back button. That's more of
   *  a quit button. There is no back button to go back to the setup screen."
   *
   *  THE TWO ARE DIFFERENT DESTINATIONS AND THAT IS WHY THERE ARE TWO BUTTONS. The hub's floating
   *  chip unmounts the module and lands on the launcher; this one stays inside Connect 4 Hoops
   *  and goes to its setup screen, so you can switch opponent or shot rule without leaving. The
   *  first attempt at this shipped as a second chip ALSO labelled "Back", stacked above the hub's
   *  own - which is why it was pulled, and why this one is labelled by its DESTINATION. "Menu"
   *  against "Hub" is two words for two places; "Back" against "Back" was one word for two.
   *
   *  A TURN-BY-TURN match leaves with no question asked, because there is nothing to lose: the
   *  move log lives in `hoops/games/<id>` and re-opening replays it, so it goes straight to the
   *  multiplayer screen where the rest of your matches are. Everything else (solo, two on one
   *  phone, a live room) really does end when you walk away, so it asks first. */
  leaveMatch() {
    const isAsync = !!(this.mp && this.mp.kind === 'async');
    const midGame = !!(this.match && !this.match.over && this.match.moves.length > 0);
    const go = () => {
      this.teardownEngine();
      if (isAsync) this.showMultiplayer(); else this.renderSetup();
    };
    if (isAsync || !midGame) { go(); return; }
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal h4-sheet-in" role="dialog" aria-modal="true" aria-label="${t('leaveQ')}">
        <h2 class="gh-modal__title">${t('leaveQ')}</h2>
        <p class="h4-sheet-body">${t('leaveLost')}</p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--block h4-leave-no">${t('leaveNo')}</button>
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block h4-leave-yes">${t('leaveYes')}</button>
        </div>
      </div>`;
    this.root.appendChild(el);
    this.on(el.querySelector('.h4-leave-no'), 'click', () => el.remove());
    this.on(el.querySelector('.h4-leave-yes'), 'click', () => { el.remove(); go(); });
  }

  /** What to call the other side, for the turn bar. The CPU is named by its DIFFICULTY, which is
   *  the only name it has; a real opponent by their profile name. */
  themName() {
    const mp = this.mp;
    if (mp && mp.kind === 'live') return (mp.them && (mp.them.name || mp.them)) || t('theirTurn');
    if (mp && mp.kind === 'async') {
      const g = mp.game || {};
      const other = mp.side === 'a' ? g.b : g.a;
      return (other && (other.name || other.code)) || t('theirTurn');
    }
    if (this.match && this.match.vsCpu) {
      return t('cpu' + (this.settings.opponent === 'two' ? 2 : this.settings.opponent));   // see cpuPick
    }
    return t('theirTurn');
  }

  paintHud() {
    const m = this.match;
    if (!m) return;
    const who = this.root.querySelector('.h4-who');
    const sh = this.root.querySelector('.h4-shots');
    if (!who || !sh) return;
    // In multiplayer "mine" is THIS DEVICE's side, which is YELLOW for a guest - reading it off
    // RED would tell the guest it was their turn on every one of the host's.
    const mine = this.mp ? (m.turn === this.myPlayer) : (m.turn === RED);
    // WHOSE COLOUR IS ON THE LANE, which is not the same question as whose turn it is: in two
    // players on one phone BOTH sides are "mine", and the thing worth showing is red or yellow.
    const red = m.turn === RED;
    // COLOUR IS NEVER THE ONLY SIGNAL (Matt is red/green colourblind - root CLAUDE.md). The
    // marker is a SHAPE as well as a hue: a disc for red, a triangle for yellow, the same pairing
    // the rest of the hub uses.
    const mark = red ? '\u25CF' : '\u25B2';
    const name = (m.vsCpu || this.mp)
      ? (mine ? t('you') : this.themName())
      : (red ? t('red') : t('yellow'));
    // AND IT SAYS IT BEFORE THE SHOT, NOT AFTER. `waiting` is true while the other side is on
    // the clock - the CPU thinking, or a live opponent yet to swipe - so the bar reads
    // "Medium is shooting" during the pause rather than going quiet until a ball appears.
    const waiting = !mine && (m.vsCpu || (this.mp && this.mp.kind === 'live'));
    who.innerHTML = `<span class="h4-mark" aria-hidden="true">${mark}</span>`
      + `<span class="h4-who-txt"></span>`;
    who.querySelector('.h4-who-txt').textContent =
      mine ? t('yourShot') : `${name} ${waiting ? t('shooting') : ''}`.trim();
    who.className = 'h4-who ' + (red ? 'is-red' : 'is-yellow') + (mine ? ' is-mine' : ' is-them')
      + (waiting ? ' is-waiting' : '');
    sh.textContent = m.shotsThisTurn ? `${t('shots')} ${m.shotsThisTurn}` : '';
  }

  toast(msg) {
    const el = this.root.querySelector('.h4-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el && el.classList.remove('is-on'), 1100);
  }

  // --- input -------------------------------------------------------------------------------------
  bindSwipe() {
    const pad = this.root.querySelector('.h4-swipe');
    if (!pad) return;
    let samples = null;
    const start = (e) => {
      if (this.busy || !this.match || this.match.over || this.match.isCpuTurn()) return;
      const p = e.touches ? e.touches[0] : e;
      samples = [{ x: p.clientX, y: p.clientY, t: e.timeStamp }];
    };
    const move = (e) => {
      if (!samples) return;
      const p = e.touches ? e.touches[0] : e;
      samples.push({ x: p.clientX, y: p.clientY, t: e.timeStamp });
      // The pad owns the gesture, so the page must not also scroll it. Bound to the game's OWN
      // element, never to document - a non-passive touchmove on document turns off
      // compositor scrolling for the whole page while this game is mounted.
      if (e.cancelable) e.preventDefault();
    };
    const end = (e) => {
      if (!samples) return;
      const list = samples; samples = null;
      if (list.length < 2) return;
      const first = list[0], last = list[list.length - 1];
      if (first.y - last.y < MIN_UP_PX) return;          // not an upward swipe at all
      const perH = swipeSpeed(list, Math.max(320, window.innerHeight));
      const power = powerOf(perH);
      const G = BOARD.geom;
      const div = G.aimDiv > 0 ? G.aimDiv : 0.38;
      const raw = Math.max(-1, Math.min(1, Math.atan2(last.x - first.x, first.y - last.y) / div));
      const curve = G.aimCurve > 0 ? G.aimCurve : 2;
      const aim = Math.sign(raw) * Math.pow(Math.abs(raw), curve);
      this.shoot(power, aim);
    };
    this.on(pad, 'touchstart', start, { passive: true });
    this.on(pad, 'touchmove', move, { passive: false });
    this.on(pad, 'touchend', end);
    this.on(pad, 'mousedown', start);
    this.on(pad, 'mousemove', move);
    this.on(pad, 'mouseup', end);
  }

  shoot(power, aim) {
    if (this.busy || !this.engine || !this.match || this.match.over) return;
    if (!this.isMyShot()) return;
    this.busy = true;
    // A FRESH SEED PER SHOT is what makes the release imperfect (boarddef's jitter*). Passing a
    // seed is opt-in at the engine, so every headless probe stays exactly deterministic.
    const seed = (Math.random() * 0x7fffffff) | 0;
    // THE BALL IS THE SHOOTER'S COLOUR. Matt: "the ball needs to be different colors. right now
    // it's the same color ball that both players throw, then it changes color on the board."
    // `setBallColor` has existed since the first build and was called EXACTLY ONCE, at match
    // start, so whoever shot first owned the ball for the whole game. Set per shot, so it is
    // right for a CPU turn, a remote turn and a pass-and-play turn without three call sites.
    if (this.rend) {
      this.rend.setBallColor(this.match.turn === RED ? BOARD.look.red : BOARD.look.yellow);
    }
    this.throwState = this.engine.phys.startThrow(BOARD, { power, aim, seed });
    this.captured = null;
  }

  maybeCpu() {
    if (!this.match || this.match.over || !this.match.isCpuTurn() || this.busy) return;
    // Repaint FIRST so the bar says "Medium is shooting" for the whole pause. 800ms was too
    // short to read even once it said something, so the pause is 1100 - long enough to notice,
    // short enough not to be a wait.
    this.paintHud();
    this._cpuT = setTimeout(() => {
      if (this.disposed || !this.match || !this.match.isCpuTurn()) return;
      const col = this.cpu.pickColumn(this.match);
      const { aim, power } = this.cpu.aimFor(col);
      this.shoot(power, aim);
    }, 1100);
  }

  // --- the loop ------------------------------------------------------------------------------
  startLoop() {
    // Idempotent, and THE ONLY way the loop is ever started. Two buttons reach a restart with a
    // chain already running, and each orphan goes on stepping physics for the life of the page.
    if (this.raf) return;
    let prev = performance.now();
    const frame = (now) => {
      if (this.disposed) { this.raf = 0; return; }
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      this.tick(dt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
  stopLoop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }

  tick(dt) {
    const st = this.throwState;
    if (st && !st.done) {
      this.engine.phys.step(BOARD, st, dt);
      for (const ev of this.engine.phys.takeEvents(st)) {
        if (ev.type === 'capture') { this.captured = ev.hole; this.rend && this.rend.flashRim(ev.hole); }
      }
    } else if (st && st.done) {
      this.throwState = null;
      this.resolve(st);
    }
    if (this.rend) this.rend.render(st && !st.done ? [st.ball] : [], dt);
  }

  resolve(st) {
    const m = this.match;
    const hole = st.outcome && st.outcome.hole;
    const H = BOARD.geom.holes[hole];
    let res;
    if (H) {
      res = m.land(H.value - 1);            // hole value IS the column, 1-based
    } else {
      res = m.miss();
    }
    this.busy = false;
    this._paintShot(res);
    if (this.mp) this._sendShot(res);

    if (m.over) { this.finish(); return; }
    this.maybeCpu();
  }

  /** Everything a settled shot changes on screen. Shared by a local shot and a remote one, so the
   *  two devices in a live match cannot paint different things for the same move. */
  _paintShot(res) {
    const m = this.match;
    if (res.type === 'miss') { this.toast(t('miss')); }
    else if (res.type === 'full') { this.toast(t('full')); }
    else { this.toast(t('inCol').replace('{n}', String(res.col + 1))); }
    if (this.rend) {
      this.rend.setGrid(m.cells(), res.type === 'win' ? res.cells : null);
      this.rend.setBallColor(m.turn === RED ? BOARD.look.red : BOARD.look.yellow);
    }
    this.paintHud();
  }

  finish() {
    const m = this.match;
    // ONE-SHOT. Every write in js/game-stats.js is additive, so recording twice silently inflates
    // the play count rather than failing loudly.
    if (!this.recorded) {
      this.recorded = true;
      const r = m.result();
      try {
        // 'mp' is the repo's own difficulty for a multiplayer match (js/game-stats.js) - it is
        // unmapped in js/difficulty-tiers.js, so it never lands in a difficulty tier. A
        // two-players-on-one-phone match records nothing, because there is no "you" in it.
        if (this.mp) recordResult('hoops4', 'mp', m.winner === this.myPlayer);
        else if (m.vsCpu) recordResult('hoops4', ['easy', 'medium', 'hard'][this.settings.opponent - 1] || 'medium', r.won);
      } catch (e) { console.error('[hoops4] recordResult failed', e); }
    }
    const r = m.result();
    const acc = r.myShots ? Math.round((100 * r.myDiscs) / r.myShots) : 0;
    let head;
    if (m.winner === null) head = t('draw');
    else if (this.mp) head = m.winner === this.myPlayer ? t('youWin') : t('youLose');
    else if (m.vsCpu) head = m.winner === RED ? t('youWin') : t('youLose');
    else head = m.winner === RED ? t('redWins') : t('yellowWins');

    const card = document.createElement('div');
    card.className = 'h4-over';
    // EVERY win/lose popup in this repo gets a close (X) in its top-right, so it can be dismissed
    // without being forced into a rematch (root CLAUDE.md).
    card.innerHTML = `<div class="h4-over-in" role="dialog" aria-modal="true">
        <button type="button" class="h4-x" aria-label="${t('close')}">&times;</button>
        <h2>${head}</h2>
        <p class="h4-acc">${t('accuracy')} ${acc}% <span>(${r.myDiscs}/${r.myShots})</span></p>
        <button type="button" class="gh-btn gh-btn-primary h4-again">${t('again')}</button>
        <button type="button" class="gh-btn h4-quit">${t('quit')}</button>
      </div>`;
    this.root.appendChild(card);
    this.on(card.querySelector('.h4-x'), 'click', () => card.remove());
    const again = card.querySelector('.h4-again');
    // "Play again" restarts a SOLO match. In multiplayer there is nobody on the other end of it -
    // a rematch is a new room or a new challenge - so the button quits to the setup screen.
    if (again) this.on(again, 'click', () => { card.remove(); if (this.mp) { this.teardownEngine(); this.renderSetup(); } else this.start(); });
    this.on(card.querySelector('.h4-quit'), 'click', () => { card.remove(); this.teardownEngine(); this.renderSetup(); });
  }

  fit() {
    const stage = this.root.querySelector('.h4-stage');
    if (!stage || !this.rend) return;
    const r = stage.getBoundingClientRect();
    this.rend.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
  }

  /** Detach from a live room, and end it for the other person too. A room nobody is in must not
   *  sit there looking joinable. */
  _stopRoom() {
    if (this._roomStop) { try { this._roomStop(); } catch {} this._roomStop = null; }
    const mp = this.mp;
    if (this.net && mp && mp.kind === 'live' && mp.code) {
      try { this.net.leaveRoom(mp.code, mp.role); } catch {}
    }
    if (this.net) { try { this.net.stopHeartbeat(); } catch {} }
  }

  teardownEngine() {
    this._stopRoom();
    this.mp = null;
    this.myPlayer = RED;
    this.stopLoop();
    if (this.offViewport) { try { this.offViewport(); } catch {} this.offViewport = null; }
    if (this._cpuT) { clearTimeout(this._cpuT); this._cpuT = 0; }
    if (this.rend) {
      try { this.rend.dispose(); } catch {}
      // dispose() frees three.js's buffers and LEAVES THE CONTEXT ALIVE. Only forceContextLoss()
      // hands it back, and a browser holds ~16 globally - leaking one per match throttles the
      // whole hub, which is what happened to skeeball on 2026-08-26.
      try { this.rend.renderer && this.rend.renderer.forceContextLoss(); } catch {}
      try { this.rend.renderer && this.rend.renderer.dispose(); } catch {}
      this.rend = null;
    }
    this.throwState = null;
    this.engine = null;
    this.busy = false;
  }

  destroy() {
    this.disposed = true;
    try { if (window.__h4Test === this) delete window.__h4Test; } catch {}
    clearTimeout(this._toastT);
    this.teardownEngine();
    this.unbindAll();
    this.root.classList.remove('h4-root');
    this.root.innerHTML = '';
  }
}

export function init(container) {
  if (instance) { try { instance.destroy(); } catch {} }
  instance = new Hoops4(container);
  instance.mount();
  return instance;
}

export function destroy() {
  if (!instance) return;
  try { instance.destroy(); } finally { instance = null; }
}

/** THE "NO MID-GAME RESUME" MEANING of the contract (Ball Run / Snake / Pinball's class, not
 *  Escoba's): nothing about a match is persisted, so leaving really does abandon it and the hub
 *  should say so. A 3D throw mid-flight and a turn that is mid-shoot-until-you-make-it are not
 *  states worth snapshotting, and skeeball deliberately removed its own mid-rack resume for the
 *  same reason (Matt: "you either finish or quit"). */
export function isInProgress() {
  if (!(instance && instance.match && !instance.match.over && instance.match.moves.length > 0)) return false;
  // EXCEPT A TURN-BY-TURN MATCH, which is not abandoned by leaving: the move log lives in
  // `hoops/games/<id>` and re-opening replays it. Saying "in progress" there makes the hub warn
  // about losing something that cannot be lost, which is exactly the friction Matt hit - "you
  // should be able to leave the game and play a regular game until the opponent plays."
  return !(instance.mp && instance.mp.kind === 'async');
}

export default { init, destroy, isInProgress };
