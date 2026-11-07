// hoops4/js/ui.js - CONNECT 4 HOOPS: the shell, the swipe, and the module contract.
//
// THE LAW applies here. Nothing in this folder stores anything earned: `gamehub.hoops4.v1` holds
// one preference (the opponent) and nothing else. A match vs the computer, and a pass-and-play match,
// is SAVED after every settled shot (2026-11-06, `gamehub.hoops4.save.v1` / `.passSave.v1`) and
// continues; see isInProgress() below for which meaning of the contract that is.
import { onViewportResize } from '../../js/viewport.js';
import { makeT } from '../../js/i18n.js';
import { loadProfile } from '../../js/profile-store.js';
import { recordResult, armQuitLoss, takeQuitLoss, withMode, modeTag, oneTierDown } from '../../js/game-stats.js';
/** WHICH game was played, recorded with its result (js/game-stats.js withMode, 2026-10-30): the shot
 *  rule (one shot, or until you sink one). A live room's rule is the host's (room config), on the
 *  Match either way. The player always shoots first vs the computer; the caption is words, not a rule. */
const modeOf = (m) => ({ one: m && m.oneShot ? 1 : 0 });
/** The match's mode from `me`'s side (2026-11-02): + who shot first (game.js `first`, a player). */
const modeFor = (m, me) => ({ ...modeOf(m), ...(m && (m.first === 0 || m.first === 1) ? { first: m.first === me ? 'me' : 'them' } : {}) });
/** The match's own numbers from `me`'s side: shots taken, made (a disc landed), missed. */
const hoopsDetail = (m, me) => {
  if (!m || !Array.isArray(m.shots)) return null;
  const shots = Math.max(0, m.shots[me] | 0);
  const made = Array.isArray(m.moves) ? m.moves.filter((x) => x && x.by === me).length : 0;
  return { shots, made, missed: Math.max(0, shots - made) };
};
import * as LL from '../../js/live-leave.js';
import { swipeSpeed, powerOf, MIN_UP_PX } from '../../skeeball/js/swipe.js';
import { STRINGS } from './strings.js';
import { BOARD, COLS } from './boarddef.js';
import { Match, RED, YELLOW } from './game.js';
import { Cpu } from './cpu.js';

// The other person's shot, replayed on opening a challenge, runs this much faster than real time.
const REPLAY_SPEED = 2.5;
const CPU_OPEN_KEY = 'gamehub.hoops4.cpuOpen.v1';   // setup screen: is the computer card open
const t = makeT(STRINGS);
// Other players' names go into innerHTML (the notify prompt): escaped.
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SETTINGS_KEY = 'gamehub.hoops4.v1';
const CSS_MARK = 'data-hoops4-css';
// THE MATCH IN PROGRESS (2026-11-06, Matt: "We should add resume to the other games that don't save").
// Vs the computer and two on one phone, one slot each, never a multiplayer match. Written at the start,
// at every launch (`fly`: the shot's power, aim and seed, so a throw left in the air is flown again on
// Continue and lands where it was going: leaving cannot take a shot back) and after every settled shot.
// Holds nothing earned; removed before the finished match is recorded.
const SAVE_KEY = 'gamehub.hoops4.save.v1';
const PASS_SAVE_KEY = 'gamehub.hoops4.passSave.v1';
const saveKeyOf = (vsCpu) => (vsCpu ? SAVE_KEY : PASS_SAVE_KEY);
/** The saved match of that kind, rebuilt, or null: `{ match, fly }`. */
function readSave(vsCpu) {
  try {
    const s = JSON.parse(localStorage.getItem(saveKeyOf(vsCpu)) || 'null');
    if (!s || s.v !== 1 || !!s.vsCpu !== !!vsCpu || ![1, 2, 3].includes(s.skill) || !Array.isArray(s.moves) || !Array.isArray(s.shots)) return null;
    const m = new Match({ vsCpu: !!vsCpu, cpuSkill: s.skill, oneShot: !!s.one, first: s.first === 1 ? 1 : 0 });
    for (const x of s.moves) {
      if (!x || (x.by !== RED && x.by !== YELLOW) || !Number.isInteger(x.col) || x.col < 0 || x.col >= COLS || !m.board.canPlay(x.col)) return null;
      m.board.play(x.col, x.by);
      m.moves.push({ by: x.by, col: x.col, shots: x.shots | 0 });
      if (m.board.isWin(x.by) || m.board.isFull()) return null;   // a finished match is never saved
    }
    if (s.turn !== RED && s.turn !== YELLOW) return null;
    m.turn = s.turn;
    m.shotsThisTurn = Math.max(0, s.sit | 0);
    m.shots = [Math.max(0, s.shots[0] | 0), Math.max(0, s.shots[1] | 0)];
    const f = s.fly;
    const fly = f && Number.isFinite(+f.p) && Number.isFinite(+f.a) && Number.isInteger(f.s) ? { p: +f.p, a: +f.a, s: f.s } : null;
    return { match: m, fly };
  } catch { return null; }
}
const clearSave = (vsCpu) => { try { localStorage.removeItem(saveKeyOf(vsCpu)); } catch (err) { console.error('[hoops4] saved match not cleared', err); } };
/** Any shot taken in it, the computer's included (or one in the air): throwing it away is a loss. */
const savedMoved = (sv) => !!sv && (sv.match.moves.length > 0 || sv.match.shots[0] + sv.match.shots[1] > 0 || !!sv.fly);

let instance = null;
/** Whether this player had a match going at the last look (this page's life only), so the first paint opens on the tab it will settle on. */
let ACTIVE_HINT = false;

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

// WHAT THIS DEVICE HAS ALREADY SEEN of each turn-by-turn match's chat: `{ <gameId>: <newest at> }`,
// so opening a match pops only what the other person said since. A convenience (THE LAW rule 2's
// carve-out, like the alert's seen-list), never history: losing it re-shows a few lines, nothing
// more. Bounded to the newest 60 matches.
const CHAT_SEEN_KEY = 'gamehub.hoops4.chatSeen.v1';
const readChatSeen = () => {
  try { const v = JSON.parse(localStorage.getItem(CHAT_SEEN_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
};
const writeChatSeen = (id, at) => {
  try {
    const all = { ...readChatSeen(), [id]: at };
    const keep = Object.entries(all).sort((x, y) => (+y[1] || 0) - (+x[1] || 0)).slice(0, 60);
    localStorage.setItem(CHAT_SEEN_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* a convenience: at worst a line pops twice */ }
};

/** Inject the shared primitives (css/ui.css) idempotently, THEN this game's own sheet. Module
 *  stylesheets are never removed on destroy() - they live in the shared document.head for the
 *  life of the page (a hub-wide fact), which is why every rule is scoped under .h4-root. Same
 *  injection marker skeeball/js/ui.js and bug-report-ui.js use, so a page that
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
    this._chat = null;       // the in-match quick chat (mp-ui.js createMatchChat), multiplayer only
    this._chatStop = null;
    this.busy = false;
    this._bound = [];
  }

  async mount() {
    await ensureCSS();
    if (this.disposed) return;
    this.root.classList.add('h4-root');
    this.renderSetup();
    this.maybeCeremony();
    // A match that ended while this phone was away: the Game Over popup (mp-ui showUnseenResults).
    // Only for a player with a code, so a solo-only device never loads the multiplayer module.
    import('./mp.js').then((MP) => {
      if (this.disposed || !MP.myCode()) return;
      return import('./mp-ui.js').then((mod) => { if (!this.disposed) mod.showUnseenResults(this); });
    }).catch(() => {});
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
    // FROM THE HUB'S CHALLENGES SCREEN (2026-10-05): a person to challenge, straight onto the terms.
    if (armed.kind === 'pick') {
      try {
        const mod = await import('./mp-ui.js');
        if (!this.disposed) mod.openMultiplayer(this, { pickFor: { code: armed.code, name: armed.name, emoji: armed.emoji } });
      } catch (err) { console.error('[hoops4] could not open the challenge', err); }
      return;
    }
    // FROM THE HUB'S MULTIPLAYER SCREEN (2026-10-29): a series owed its next game. Re-checked from
    // a fresh read, so game N+1 is never made twice; not yours to start = the multiplayer sheet.
    if (armed.kind === 'next') {
      try {
        const MP = await import('./mp.js');
        const owed = (await MP.readOwedSeries(await MP.readMyGames())).find((r) => r.id === `next:${armed.id}`);
        const game = owed && owed.yourTurn ? await MP.readGame(armed.id) : null;
        const res = game ? await MP.nextInSeries(game) : null;
        if (this.disposed) return;
        if (res && res.ok) { this.startAsync(res.game); return; }
        const mod = await import('./mp-ui.js');
        if (!this.disposed) this.renderSetup('online');
      } catch (err) { console.error('[hoops4] could not start the next game', err); }
      return;
    }
    // FROM A NOTIFICATION (2026-09-24): straight onto that match's board, no card. A match that
    // has already ended opens as its read-only review, which shows the Game Over card.
    if (armed.kind === 'open') {
      try {
        const MP = await import('./mp.js');
        MP.markResultSeen(armed.id);   // its own card shows the result; the away-popup must not too
        const game = await MP.readGame(armed.id);
        if (!this.disposed && game) this.startAsync(game, game.over ? { review: true } : {});
      } catch (err) { console.error('[hoops4] could not open the notified match', err); }
      return;
    }
    // ONCE PER MATCH (2026-09-23). Matt: "The animation should play the first time you click on it
    // - not every time. just go to the game i guess when it's not the first time." So a match that
    // has had its card goes straight to the board. The shown-list is a one-tap convenience (THE
    // LAW rule 2's exemption): losing it replays one animation, nothing more.
    const SHOWN = 'gamehub.hoops4.cerShown.v1';
    let shown = [];
    try { shown = JSON.parse(localStorage.getItem(SHOWN) || '[]'); if (!Array.isArray(shown)) shown = []; } catch { shown = []; }
    if (shown.includes(armed.id)) {
      try {
        const MP = await import('./mp.js');
        const game = await MP.readGame(armed.id);
        if (!this.disposed && game) this.startAsync(game);
      } catch (err) { console.error('[hoops4] could not open the match', err); }
      return;
    }
    try { localStorage.setItem(SHOWN, JSON.stringify([...shown, armed.id].slice(-200))); } catch { /* private mode */ }
    // THE TERMS COME FROM THE MATCH, NOT THE LAUNCHER. Matt: "when you accept a challenge and go
    // to play, you should see what the shot settings and the series selection is and stuff like
    // that." The launcher's index row does not carry the caption, so the document is read here -
    // and the card is shown either way, because a card without its terms is still better than no
    // card if the read fails.
    try {
      const MP = await import('./mp.js');
      const game = await MP.readGame(armed.id);
      if (this.disposed) return;
      if (game) {
        const bits = [game.oneShot ? t('shotsOne') : t('shotsUntil')];
        if (game.series > 1) {
          bits.push(t(game.series === 3 ? 'chBo3' : 'chBo5'));
          if (game.seriesNo > 1) bits.push(t('gameOf', { n: game.seriesNo, m: game.series }));
        }
        armed.terms = bits.join(' \u00B7 ');
        armed.caption = game.caption || '';
      }
    } catch { /* the card still shows; it just will not name the terms */ }
    if (this.disposed) return;
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
      <button type="button" class="h4-cer-skip">${t('cerSkip')} &rsaquo;</button>
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
        ${a.terms ? `<p class="h4-cer-terms">${a.terms}</p>` : ''}
        ${a.caption ? `<p class="h4-cer-caption">&ldquo;${a.caption}&rdquo;</p>` : ''}
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
    // SKIPPABLE (2026-09-24). Matt: "I should be able to skip the new challenge animation (i
    // thought we already added this)". Only the SECOND view of a match skipped it (the shown-list
    // in maybeCeremony). Now: Skip, top right from the first frame, goes straight into the match;
    // and a tap anywhere else on the card jumps the animation to its end (`is-still`, the same
    // final pose reduced motion uses), so the buttons are there at once.
    this.on(el.querySelector('.h4-cer-skip'), 'click', () => go.click());
    this.on(el, 'click', (e) => { if (!e.target.closest('button')) el.classList.add('is-still'); });
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
  renderSetup(tab, flash) {
    if (this.disposed) return;
    if (tab) this._tab = tab;
    this._flash = flash || this._flash || '';
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
    const saved = readSave(true);
    // "Let me collapse the computer game section too" (2026-09-24). A one-tap view preference in
    // its own key, never in the settings object (THE LAW rule 2's exemption: nothing earned).
    let cpuOpen = true;
    try { cpuOpen = localStorage.getItem(CPU_OPEN_KEY) !== '0'; } catch { /* default open */ }
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
    const cur = this._tab || (ACTIVE_HINT ? 'online' : 'cpu');
    const tabBtn = (k, label) => `<button type="button" class="gh-seg__item" data-tab="${k}" aria-pressed="${k === cur}"><span>${label}</span>${k === 'online' ? '<b class="h4-tab-n" hidden></b>' : ''}</button>`;
    this.root.innerHTML = `
      <div class="h4-setup">
        <h1 class="h4-title">${t('title')}</h1>
        <!-- TABS (2026-11-07, Cup Pong's way, Matt: "Do the same tabs for the other multiplayer games"):
             Online first (matches, who to challenge, the live-room tiles), then the computer card. -->
        <div class="gh-seg h4-tabs" role="group" data-role="tabs">${tabBtn('online', t('tabOnline'))}${tabBtn('cpu', t('tabCpu'))}</div>
        <div class="h4-panel" data-panel="online"${cur === 'online' ? '' : ' hidden'}>
          <div class="h4-online"><p class="h4-mp-note">${t('loading')}</p></div>
        </div>
        <div class="h4-panel" data-panel="cpu"${cur === 'cpu' ? '' : ' hidden'}>
        <div class="gh-card h4-card${cpuOpen ? '' : ' is-shut'}">
          <button type="button" class="h4-card-toggle" aria-expanded="${cpuOpen}">
            <span class="h4-card-head">${t('vsCpu')}</span>
            <span class="h4-card-chev" aria-hidden="true">${cpuOpen ? '\u25BE' : '\u25B8'}</span>
          </button>
          <div class="h4-card-body"${cpuOpen ? '' : ' hidden'}>
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
          ${saved ? `<button type="button" class="gh-btn gh-btn--primary gh-btn--block h4-cont">${t('continueGame')}</button>
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block h4-play">${t('newGame')}</button>`
    : `<button type="button" class="gh-btn gh-btn--primary gh-btn--block h4-play">${t('play')}</button>`}
          </div>
        </div>
        </div>
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
    // New game over a saved match someone has shot in throws it away: two taps, saying it is a loss.
    const play = this.root.querySelector('.h4-play');
    this.on(play, 'click', () => {
      if (this.discardCostsLoss() && play.dataset.armed !== '1') { play.dataset.armed = '1'; play.textContent = t('quitLoss'); return; }
      this.start({ vsCpu: true });
    });
    const cont = this.root.querySelector('.h4-cont');
    if (cont) this.on(cont, 'click', () => this.start({ vsCpu: true, resume: true }));
    this.on(this.root.querySelector('[data-role="tabs"]'), 'click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) { this._tab = b.dataset.tab; this.showTab(b.dataset.tab); }
    });
    this.on(this.root.querySelector('.h4-howto-link'), 'click', () => this.showHowto());
    this.on(this.root.querySelector('.h4-card-toggle'), 'click', () => {
      const card = this.root.querySelector('.h4-card');
      const open = card.classList.contains('is-shut');
      card.classList.toggle('is-shut', !open);
      card.querySelector('.h4-card-body').hidden = !open;
      const tg = card.querySelector('.h4-card-toggle');
      tg.setAttribute('aria-expanded', String(open));
      tg.querySelector('.h4-card-chev').textContent = open ? '\u25BE' : '\u25B8';
      try { localStorage.setItem(CPU_OPEN_KEY, open ? '1' : '0'); } catch { /* not remembered */ }
    });
    this._fillOnline();
  }

  /** Show one tab's panel (no re-render: the Online list and the chosen options stay as they are). */
  showTab(k) {
    const box = this.root.querySelector('.h4-setup');
    if (!box) return;
    for (const b of box.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === k));
    for (const p of box.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== k;
  }

  /** The Online tab: matches, who to challenge and the live-room tiles (mp-ui.js fillOnline), then the
   *  default tab. Online when a match is going, else Computer, unless the player has tapped a tab. */
  async _fillOnline() {
    const box = this.root.querySelector('.h4-online');
    if (!box) return;
    let UI;
    try { UI = await import('./mp-ui.js'); } catch { return; }
    if (this.disposed || !box.isConnected) return;
    const flash = this._flash; this._flash = '';
    const res = await UI.fillOnline(this, box, flash);
    if (!res || this.disposed || !box.isConnected) return;
    ACTIVE_HINT = res.active;
    const n = this.root.querySelector('.h4-tab-n');
    if (n) { n.textContent = res.mine ? String(res.mine) : ''; n.hidden = !res.mine; }
    if (!this._tab) this.showTab(res.active ? 'online' : 'cpu');
  }

  /** Back to the Online tab (the old multiplayer sheet's home), with an optional note on top. */
  async showMultiplayer(flash = '') {
    this.renderSetup('online', flash);
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
  async startAsync(game, opts = {}) {
    const MP = await import('./mp.js');
    if (this.disposed) return;
    const side = MP.sideOf(game, MP.myCode());
    if (!side) { this.renderSetup(); return; }
    // Cancelled, declined or expired (2026-10-13): there is no board to show, and nothing to count.
    const endText = this._endText(MP, game, side);
    if (endText) { this.showMultiplayer(endText); return; }
    // `review` is a FINISHED match opened from the challenge history: a replay with its result
    // card, READ ONLY. Nobody may shoot in it (isMyShot) and nothing is recorded again - every
    // write in js/game-stats.js is additive, so re-recording on each look would inflate the
    // play count by one per visit.
    const review = !!(opts && opts.review && game.over);
    // `applied` = how many entries of the shared move log this board already reflects, so the live
    // watch below applies only what is new - and never this device's own move a second time.
    this.mp = { kind: 'async', id: game.id, side, game, MP, sent: false, review, applied: game.moves.length };
    this.myPlayer = side === 'a' ? RED : YELLOW;
    this._trail = [];
    // THE REPLAY (2026-09-30). Matt: "Connect 4 hoops should show a fast motion replay of the
    // opponents shot when you open the challenge. The same way cup pong does... You should be able
    // to skip if you want." The board is built WITHOUT the other person's moves this phone has not
    // shown yet; those are then flown from their recorded throws (`_runReplay`). A finished match
    // too (a tapped "they won" notification opens its review): the winning shot, then the card.
    const from = MP.replayFrom(game, side, MP.readShown(game.id));
    const upto = game.moves.length;
    await this.start({ vsCpu: false, oneShot: !!game.oneShot, keepMp: true,
      replay: (m) => MP.replay(m, { moves: game.moves.slice(0, from) }) });
    if (this.disposed || !this.match) return;
    if (from < upto) {
      this._runReplay(game.moves.slice(from), upto, () => this._afterOpen(game, review));
      return;
    }
    MP.markShown(game.id, upto);
    this._afterOpen(game, review);
  }

  /** What to say about a match that ended with no result: called off by either side, or expired
   *  unanswered (js/challenge-life.js). '' for a match that is neither. */
  _endText(MP, game, side) {
    if (!game || !MP) return '';
    if (MP.lifeOf(game).expired) return t('mpExpired');
    if (!MP.isCalledOff(game)) return '';
    const why = game.over.why === 'declined' ? 'declined' : 'cancelled';
    // A cancel is always the sender's, a decline always the receiver's.
    const iSent = side !== MP.recipientOf(game);
    const mine = why === 'cancelled' ? iSent : !iSent;
    const them = side === 'a' ? game.b : game.a;
    return t(mine ? (why === 'cancelled' ? 'mpYouCancelled' : 'mpYouDeclined') : (why === 'cancelled' ? 'mpTheyCancelled' : 'mpTheyDeclined'),
      { who: (them && them.name) || '?' });
  }
  /** Leave the open match because it ended with no result (called off, or expired), saying so. */
  _leaveNoResult(text) {
    const mp = this.mp;
    if (mp && mp.MP) { try { mp.MP.markSeen(mp.id, mp.game && mp.game.updated); } catch { /* bubble again */ } }
    if (this._gameStop) { try { this._gameStop(); } catch { /* detached */ } this._gameStop = null; }
    this.recorded = true;                              // nothing to count, ever
    this.teardownEngine();
    this.showMultiplayer(text);
  }

  /** Resign, or CANCEL / DECLINE while the other person has not shot (2026-10-13). */
  _quitKind() {
    const mp = this.mp;
    if (!mp || mp.kind !== 'async' || !mp.MP || !mp.game || !mp.MP.lifeOf(mp.game).open) return 'resign';
    return mp.side === mp.MP.recipientOf(mp.game) ? 'decline' : 'cancel';
  }

  /** The rest of opening a turn-by-turn match, once the board shows everything that happened. */
  _afterOpen(game, review) {
    const mp = this.mp, MP = mp && mp.MP;
    if (this.disposed || !mp || !this.match || mp.id !== game.id) return;
    const side = mp.side;
    if (game.over) { if (review) this.recorded = true; this.finish(); return; }
    // The match is on the server, so leaving really is free - say so rather than leaving the
    // player to discover it. This is the reassurance half of the isInProgress() fix below.
    // A first game with no shot in it yet, on our side 'a', has not reached the other person:
    // the first shot is what sends it (mp.js createGame). Say so, or "saved" reads as "sent".
    const unsent = side === 'a' && !game.moves.length && (game.seriesNo | 0) <= 1;
    this.toast(!this.isMyShot() ? t('mpTheirTurn') : unsent ? t('mpShootToSend') : t('leaveKept'));
    // AND STAY LIVE (2026-09-23). Matt: "if you stay in the game it never shows the other
    // person's turn... it should auto be my turn whenever it's my turn." Their move arrives here
    // while the match is on screen, drops down its column, and hands the turn back.
    const id = game.id;
    MP.watchGame(id, (g) => this._onAsyncGame(g)).then((stop) => {
      if (this.disposed || !this.mp || this.mp.id !== id) { try { stop(); } catch {} return; }
      this._gameStop = stop;
    });
  }

  /** The open turn-by-turn match changed on the server. Apply only what is NEW and not ours. */
  _onAsyncGame(g) {
    const mp = this.mp, m = this.match;
    if (this.disposed || !mp || mp.kind !== 'async' || mp.review || !m || g.id !== mp.id) return;
    const fresh = g.moves.slice(mp.applied);
    const theirs = [];
    for (const e of fresh) {
      mp.applied++;
      if (e.by === mp.side) continue;                 // our own move, already on this board
      theirs.push(e);
    }
    mp.game = g;
    // Called off by the other person while this board was open (2026-10-13): nothing to count.
    if (mp.MP.isCalledOff(g)) { this._leaveNoResult(this._endText(mp.MP, g, mp.side)); return; }
    // Their move arriving while you watch is shown the same way as on opening: flown, skippable.
    if (theirs.length && !m.over) {
      if (this._rp) { this._rp.q.push(...theirs); this._rp.upto = mp.applied; return; }
      this._runReplay(theirs, mp.applied, () => {
        if (this.disposed || !this.match) return;
        if (this.match.over) { this.finish(); return; }
        if (this.mp && this.mp.game.over && !this.recorded) { this.finish(); return; }
        if (this.isMyShot()) this.toast(t('turnYou'));
      });
      return;
    }
    // THEY QUIT: the match is over on the server while this board is not.
    if (g.over && !m.over && !this.recorded && !this._rp) this.finish();
  }

  // --- the replay: the other person's shots, flown again from their recorded throws ------------
  //
  // Each move may carry `t` (hoops4/js/mp.js `trailFrom`): the power, aim and seed of the shots
  // that made it, which `startThrow` flies again at REPLAY_SPEED. THE RECORDED MOVE DECIDES, never
  // the flight (Cup Pong's rule): every shot but the last is scored a miss, the last lands in the
  // stored column, and a disc only falls on `through` when the flight agrees with that column.
  // A move with no `t` (every move before 2026-09-30) is shown as before, its disc dropping in.
  // SKIP applies whatever is left at once and hands the board over.

  _runReplay(entries, upto, done) {
    const rp = { q: entries.slice(), upto, done, cur: null };
    this._rp = rp;
    this.busy = true;
    const skip = this.root.querySelector('.h4-skip');
    if (skip) skip.hidden = false;
    this.paintHud();
    this._rpLater(rp, () => this._rpNext(rp), 450);
  }

  /** A timer that dies with its replay (a skip, a teardown), so nothing from it fires late. */
  _rpLater(rp, fn, ms) {
    setTimeout(() => { if (!this.disposed && this._rp === rp) fn(); }, ms);
  }

  _rpNext(rp) {
    const m = this.match;
    if (!rp.q.length || !m || m.over) { this._rpEnd(rp); return; }
    const e = rp.q[0];
    const trail = Array.isArray(e.t) ? e.t : [];
    const k = Math.min(trail.length, e.miss ? 1 : e.shots);
    // Shots older than the kept trail are charged silently, exactly as MP.replay charges them.
    const total = e.miss ? 1 : e.shots;
    for (let i = 0; i < total - (k || 1); i++) m.miss();
    if (!k) {
      rp.q.shift();
      this._paintShot(e.miss ? m.miss() : m.land(e.col));
      this._whenLanded(() => this._rpLater(rp, () => this._rpNext(rp), 500));
      return;
    }
    rp.cur = { e, flights: trail.slice(-k), i: 0 };
    this._rpFly(rp);
  }

  _rpFly(rp) {
    const f = rp.cur.flights[rp.cur.i];
    if (!this.engine || !this.match) return;
    if (this.rend) this.rend.setBallColor(this.match.turn === RED ? BOARD.look.red : BOARD.look.yellow);
    this.throwState = this.engine.phys.startThrow(BOARD, { power: f.p, aim: f.a, seed: f.s, closed: this.closedHoles() });
    this.throwState.replay = true;
    this.captured = null;
  }

  /** May the disc start falling on this `through`? Only for the recorded make, in its column. */
  _rpDropOk(hole) {
    const c = this._rp && this._rp.cur;
    const H = hole && BOARD.geom.holes[hole];
    return !!(c && H && !c.e.miss && c.i === c.flights.length - 1 && H.value - 1 === c.e.col);
  }

  /** A replayed flight has settled: the recorded move decides it. */
  _rpResolve() {
    const rp = this._rp, c = rp && rp.cur, m = this.match;
    if (!c || !m) return;
    const last = c.i === c.flights.length - 1;
    const res = (!last || c.e.miss) ? m.miss() : m.land(c.e.col);
    this._paintShot(res);
    if (!last) { c.i++; this._rpLater(rp, () => this._rpFly(rp), 300); return; }
    rp.cur = null;
    rp.q.shift();
    this._whenLanded(() => this._rpLater(rp, () => this._rpNext(rp), 500));
  }

  /** SKIP: everything still to show goes onto the board at once. */
  _rpSkip() {
    const rp = this._rp, m = this.match;
    if (!rp || !m) return;
    this.throwState = null;
    this.captured = null;
    if (rp.cur) {
      const { e, flights, i } = rp.cur;
      for (let j = i; j < flights.length - 1; j++) m.miss();
      if (!m.over) { if (e.miss) m.miss(); else m.land(e.col); }
      rp.q.shift();
      rp.cur = null;
    }
    for (const e of rp.q) {
      if (m.over) break;
      if (e.miss) { m.miss(); continue; }
      for (let i = 1; i < e.shots; i++) m.miss();
      m.land(e.col);
    }
    rp.q = [];
    this._predicted = null; this._dropping = false; this._afterDrop = null;
    if (this.rend) {
      this.rend.cancelDrop(m.cells(), m.over ? m.winCells : null);
      this.rend.setClosed(this.closedHoles());
      this.rend.setBallColor(m.turn === RED ? BOARD.look.red : BOARD.look.yellow);
    }
    this._rpEnd(rp);
  }

  _rpEnd(rp) {
    if (this._rp !== rp) return;
    this._rp = null;
    this.busy = false;
    const skip = this.root.querySelector('.h4-skip');
    if (skip) skip.hidden = true;
    if (this.mp && this.mp.MP) this.mp.MP.markShown(this.mp.id, rp.upto);
    this.paintHud();
    rp.done();
  }

  /** May this device shoot right now? Solo and two-players-on-one-phone: always. Multiplayer:
   *  only on this player's own turn. This is the ONE gate - `shoot()` asks it, so the swipe pad,
   *  the CPU and any future control all answer to the same rule. */
  isMyShot() {
    if (!this.match || this.match.over) return false;
    if (!this.mp) return true;
    if (this.mp.review) return false;              // a finished match from the history is read only
    return this.match.turn === this.myPlayer;
  }

  /** One entry of the shared move log arrived from the other device. */
  _onRoom(room) {
    if (!room || !this.mp || this.mp.kind !== 'live' || !this.match) return;
    // QUICK CHAT rides the room's own `reactions` child (net.sendReaction, one slot per seat) -
    // NEVER the move log, whose entries this loop walks strictly by `seq`. A chat line in `moves`
    // would stall the lockstep at the first gap it made.
    if (this._chat) this._chat.onReactions(room.reactions, this.mp.role);
    this.mp.lastRoom = room;
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
    if (room.status === 'ended' && this.match && !this.match.over && !this.mp.decided) {
      // A leave that decided the match (js/live-leave.js): this phone's win, or its loss on a claim.
      let res = 'none';
      if (this._liveInPlay()) {
        res = LL.onRoomEnded(room, { statsId: 'hoops4', key: this._liveKey(), n: 1, mySeat: this.mp.role,
          fn: 'recordResult', winArgs: ['hoops4', 'mp', true], opps: [], tag: modeTag(() => (modeFor(this.match, this.myPlayer)), 'mp') });
      }
      this.mp.decided = true;
      if (res !== 'none') this.recorded = true;
      LL.hideClaim(this.root);
      const name = this.themName();
      this.toast(res === 'won' ? LL.lt('ll_left_win', { name }) : res === 'lost' ? LL.lt('ll_lost', { name }) : t('mpLost'));
      return;
    }
    if (this._liveCanClaim()) LL.showClaim(this.root, () => this._liveClaim()); else LL.hideClaim(this.root);
  }

  // --- leaving a live room (2026-10-29, js/live-leave.js) ----------------------------------------
  // One match per room (key game number 1). After your first shot, leaving (Menu > leave, the hub,
  // any unmount: no rejoin here) is YOUR loss and the room ends with your forfeit, so the other phone
  // records its win. A closed app leaves the loss armed; after 90 s of silence the other phone may
  // "Claim win". No head-to-head (live Hoops never wrote any).
  _liveKey() { const mp = this.mp; return mp && mp.kind === 'live' ? LL.liveKey('hoops4', mp.code, 1) : null; }
  _liveInPlay() { return !!(this.mp && this.mp.kind === 'live' && !this.mp.decided && this.match && !this.match.over && !this.recorded); }
  _liveOppRole() { return this.mp.role === 'host' ? 'guest' : 'host'; }
  _liveOppAway() { const r = this.mp && this.mp.lastRoom; return r ? LL.awayMs(r[this._liveOppRole()]) : 0; }
  _liveOppMoved() {
    const r = this.mp && this.mp.lastRoom, by = this.mp && this._liveOppRole();
    return !!(r && Object.values(r.moves || {}).some((e) => e && e.by === by));
  }
  _liveCanClaim() { return this._liveInPlay() && this._liveOppAway() >= LL.CLAIM_MS && this._liveOppMoved(); }
  _liveCosts() { return this._liveInPlay() && this._liveOppAway() < LL.CLAIM_MS && LL.leaveCosts('hoops4', this._liveKey()); }
  _liveClaim() {
    if (!this._liveCanClaim()) return;
    const mp = this.mp;
    mp.decided = true;
    this.recorded = true;
    LL.recordLeaveWin('hoops4', this._liveKey(), 'recordResult', ['hoops4', 'mp', true], [], modeTag(() => (modeFor(this.match, this.myPlayer)), 'mp'));
    LL.hideClaim(this.root);
    if (this._roomStop) { try { this._roomStop(); } catch {} this._roomStop = null; }
    LL.leaveWithForfeit(this.net, mp.code, mp.role, this._liveOppRole(), 1, true).catch(() => {});
    this.toast(LL.lt('ll_claimed'));
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
    if (this._trail && this._trail.length) payload.t = this._trail.slice();
    this._trail = [];
    mp.applied++;                                     // this entry is already on our board
    const r = await mp.MP.pushMove(mp.id, payload);
    if (!r.ok) {
      // KEPT, not lost: a turn somebody actually took is retried on the next open. And the screen
      // SAYS SO - the first cut toasted "Sent. They play next." on top of the failure message a
      // line later, which is a silent write failure wearing a confirmation (THE LAW rule 6).
      if (r.retryable) { mp.MP.queueMove(mp.id, payload); this.toast(t('mpOffline')); }
      else if (r.reason === 'expired') this._leaveNoResult(t('mpExpired'));
      else if (r.reason === 'already-over' && mp.MP.isCalledOff(await mp.MP.readGame(mp.id).catch(() => null))) {
        this._leaveNoResult(t('mpTheyCancelled', { who: this.themName() }));
      } else this.toast(t('mpUnavailable'));
      return;
    }
    mp.game = r.game;
    if (!m.over) { mp.sent = true; this.toast(t('mpSent')); this._askPush(mp); }
  }

  /**
   * "WANT TO GET NOTIFIED WHEN <THEM> PLAYS BACK?" (2026-09-24). Matt: "I challenge someone, they
   * click on it and it says i challenged them, they accept and play, then it asks 'want to get
   * notified when MattyIce plays back?'" Asked right after a move of yours is SENT, because that is
   * the moment you start waiting on them - it covers the challenger's first shot too. Only while
   * notifications are OFF on this device (never when on, blocked, unsupported, or an iPhone Safari
   * tab where the button could not work), and once per match, so "Not now" is respected. The yes
   * tap IS the permission request, which iOS insists on.
   */
  async _askPush(mp) {
    if (!mp || mp.kind !== 'async' || mp.review) return;
    const KEY = 'gamehub.hoops4.pushAsk.v1';
    let asked = [];
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(v)) asked = v; } catch { /* none */ }
    if (asked.includes(mp.id)) return;
    let P;
    try { P = await import('../../js/push.js'); } catch { return; }
    const st = await P.pushState().catch(() => 'unsupported');
    if (st !== 'off' || this.disposed || this.mp !== mp) return;
    try { localStorage.setItem(KEY, JSON.stringify(asked.concat(mp.id).slice(-50))); } catch { /* asks again: harmless */ }
    const who = (mp.MP.otherLabel(mp.game, mp.MP.myCode()) || {}).name || '?';
    const ov = document.createElement('div');
    ov.className = 'gh-overlay';
    ov.innerHTML = `
      <div class="gh-modal" role="dialog" aria-modal="true" aria-label="${esc(t('pushAskQ', { who }))}">
        <h2 class="gh-modal__title">🔔 ${esc(t('pushAskQ', { who }))}</h2>
        <p class="h4-mp-note" data-role="err" hidden></p>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--block" data-role="no">${esc(t('pushAskNo'))}</button>
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="yes">${esc(t('pushAskYes'))}</button>
        </div>
      </div>`;
    this.root.appendChild(ov);
    const close = () => ov.remove();
    this.on(ov.querySelector('[data-role="no"]'), 'click', close);
    this.on(ov.querySelector('[data-role="yes"]'), 'click', async () => {
      const yes = ov.querySelector('[data-role="yes"]');
      yes.disabled = true;
      const res = await P.enablePush().catch(() => ({ ok: false, reason: 'subscribe-failed' }));
      if (res.ok) { close(); this.toast(t('pushDone')); return; }
      if (res.reason === 'dismissed') { close(); return; }
      yes.disabled = false;
      const err = ov.querySelector('[data-role="err"]');
      err.hidden = false;
      err.textContent = res.reason === 'denied' ? t('pushDenied') : t('pushFailed');
    });
  }

  // --- quick chat inside a match (2026-09-22) ------------------------------------------------
  //
  // The DOM is `mp-ui.js`'s `createMatchChat`; this is only the wiring to the two transports.
  //   LIVE          net.sendReaction into `rooms/<CODE>/reactions/<role>` (the hub's existing
  //                 facility), read back in `_onRoom`. Never the move log.
  //   TURN BY TURN  MP.sendChat into `hoops/games/<id>/chat`, and MP.watchChat while the match is
  //                 on screen. What the other person said since this device last looked pops on
  //                 open, remembered per match in CHAT_SEEN_KEY (a convenience, not history).
  async _mountChat() {
    this._unmountChat();
    const mp = this.mp;
    if (!mp) return;
    let mod;
    try { mod = await import('./mp-ui.js'); } catch { return; }
    if (this.disposed || this.mp !== mp || this._chat) return;
    const themLabel = () => {
      if (mp.kind === 'live') return { name: (mp.them && mp.them.name) || this.themName(), emoji: (mp.them && mp.them.emoji) || '' };
      const g = mp.game || {};
      const o = mp.side === 'a' ? g.b : g.a;
      return { name: (o && o.name) || this.themName(), emoji: (o && o.emoji) || '' };
    };
    const failText = (reason) => (reason === 'denied' || reason === 'dev-origin-blocked'
      ? t('mpUnavailable') : t('chatNotSent'));
    const chat = mod.createMatchChat({ root: this.root, send: (p) => this._sendChat(p), them: themLabel, failText });
    this._chat = chat;
    if (mp.kind !== 'async') return;

    const seen = readChatSeen();
    const seenAt = seen[mp.id] || 0;
    const mine = (c) => c.by === mp.side;
    const feed = (list) => {
      let newest = 0;
      for (const c of list || []) {
        const fresh = !mine(c) && c.at > seenAt;
        chat.add({ key: c.key, mine: mine(c), t: c.t, v: c.v, at: c.at }, { pop: fresh });
        if (!mine(c)) newest = Math.max(newest, c.at);
      }
      if (newest > (readChatSeen()[mp.id] || 0)) writeChatSeen(mp.id, newest);
    };
    feed(mp.game && mp.game.chat);
    const stop = await mp.MP.watchChat(mp.id, feed);
    if (this.disposed || this._chat !== chat) { try { stop(); } catch {} return; }
    this._chatStop = stop;
  }

  _unmountChat() {
    if (this._chatStop) { try { this._chatStop(); } catch {} this._chatStop = null; }
    if (this._chat) { try { this._chat.destroy(); } catch {} this._chat = null; }
  }

  /** Send one chat line over whichever transport this match uses. Resolves `{ ok, reason, entry }`. */
  async _sendChat(payload) {
    const mp = this.mp;
    if (!mp) return { ok: false, reason: 'no-match' };
    if (mp.kind === 'live') {
      if (!this.net) return { ok: false, reason: 'offline' };
      // net.sendReaction is BEST-EFFORT BY DESIGN (it swallows its own failure, so a dropped
      // reaction never costs an error in any game). The line shows as sent on this device.
      await this.net.sendReaction(mp.code, mp.role, payload);
      return { ok: true };
    }
    return mp.MP.sendChat(mp.id, payload);
  }

  showHowto() {
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal h4-sheet-in" role="dialog" aria-modal="true" aria-label="${t('howto')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="gh-modal__title">${t('howto')}</h2>
        <p class="h4-how-goal">${t('howtoGoal')}</p>
        ${this._howtoDiagram()}
        <p class="h4-how-cap">${t('howtoCap')}</p>
        <p class="h4-how-eg">${t('howtoEg')}</p>
        <p class="h4-how-line">${t('howtoArc')}</p>
        <p class="h4-how-line">${t('howtoAim')}</p>
        <p class="h4-how-line">${t('howtoRim')}</p>
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

  /**
   * THE ONE MECHANIC THAT IS NOT OBVIOUS, DRAWN. Seven hoops over a 7x6 grid, the third hoop
   * taking a ball, and a dashed arrow carrying it down column 3 to a disc at the bottom.
   *
   * Everybody already knows Connect 4 and everybody already knows basketball. The thing nobody
   * can guess is that the two are WIRED TOGETHER - which hoop you sink decides which column your
   * disc falls down. That is the whole diagram, and the rest of the screen is four short lines.
   * docs/BUILDING-A-GAME.md, "How-to-play screens": show it rather than describe it.
   *
   * COLOURBLIND-SAFE BY CONSTRUCTION: the chosen hoop is marked by a THICKER OUTLINE, a ball
   * sitting in it and the arrow leaving it - never by its colour (root CLAUDE.md).
   */
  _howtoDiagram() {
    const L = BOARD.look;
    const cols = 7, rows = 4;                 // four rows is enough to read; six crowds it
    const x0 = 14, dx = 24, hoopY = 16, gridY = 40, dy = 17, r = 6.2;
    const cx = (c) => x0 + c * dx;
    const pick = 2;                           // the third hoop, 0-based
    let hoops = '', grid = '';
    for (let c = 0; c < cols; c++) {
      const on = c === pick;
      hoops += `<ellipse cx="${cx(c)}" cy="${hoopY}" rx="8.5" ry="3.2" fill="none"
        stroke="${on ? L.ring : '#7c8797'}" stroke-width="${on ? 3 : 1.6}"/>`;
      for (let rw = 0; rw < rows; rw++) {
        const filled = on && rw === rows - 1;
        grid += `<circle cx="${cx(c)}" cy="${gridY + rw * dy}" r="${r}"
          fill="${filled ? L.red : '#0e1c30'}" stroke="${filled ? '#8f1f18' : '#2b3b52'}"
          stroke-width="${filled ? 2 : 1.2}"/>`;
      }
    }
    return `
      <div class="h4-how-fig" aria-hidden="true">
        <svg viewBox="0 0 ${x0 * 2 + dx * (cols - 1)} ${gridY + dy * (rows - 1) + 14}" width="100%">
          <rect x="4" y="${gridY - 12}" width="${x0 * 2 + dx * (cols - 1) - 8}"
                height="${dy * (rows - 1) + 24}" rx="5" fill="${L.face}" opacity="0.9"/>
          ${grid}
          ${hoops}
          <circle cx="${cx(pick)}" cy="${hoopY - 8}" r="4.4" fill="${L.ring}" stroke="#8f1f18" stroke-width="1"/>
          <path d="M ${cx(pick)} ${hoopY + 6} V ${gridY + dy * (rows - 1) - 9}"
                stroke="${L.ring}" stroke-width="2" stroke-dasharray="3 3" fill="none"/>
          <path d="M ${cx(pick) - 4} ${gridY + dy * (rows - 1) - 13} L ${cx(pick)} ${gridY + dy * (rows - 1) - 8}
                   L ${cx(pick) + 4} ${gridY + dy * (rows - 1) - 13}"
                stroke="${L.ring}" stroke-width="2" fill="none" stroke-linecap="round"/>
        </svg>
      </div>`;
  }

  // --- the match --------------------------------------------------------------------------------
  // A MATCH VS THE COMPUTER IS SAVED (2026-11-06; docs/INTEGRITY-CHECKS-SPEC.md "Games that SAVE and
  // resume"). Leaving it (Back to setup, the hub's back, a closed app, a challenge opened) costs
  // nothing: it is there to Continue. Only THROWING IT AWAY once any shot was taken (New game, from
  // the Menu or the setup screen) is a loss, asked twice. Pass and play saves too and records nothing.
  /** The level of the computer in `m` (its own, so a continued match keeps it), else the setting's. */
  cpuDiff(m = this.match) {
    const skill = m && m.vsCpu ? m.cpuSkill : this.settings.opponent;
    return ['easy', 'medium', 'hard'][skill - 1] || 'medium';
  }
  /** The RECORDED difficulty vs the computer (Matt, 2026-11-02): "shoot until you score" is easier, so
   *  it counts one level LOWER than chosen; "one shot" counts at the chosen level (Easy stays Easy).
   *  The mode keeps the CHOSEN level (withMode / modeTag's diff); online ('mp') is unchanged. */
  statsDiff(m) { const d = this.cpuDiff(m); return m && m.oneShot ? d : oneTierDown(d, ['easy', 'medium', 'hard']); }
  /** Live rooms only (js/live-leave.js): a saved match loses nothing by leaving. */
  quitCostsLoss() {
    if (this.mp && this.mp.kind === 'live') return this._liveCosts();
    return false;
  }
  /** Would a new match vs the computer throw away a saved one someone has shot in? */
  discardCostsLoss() { return savedMoved(readSave(true)); }
  /** Throw the saved match vs the computer away: the save first, then ONE loss through the quit-loss
   *  marker (armed and taken at once, so the play log says it was a quit), at that match's own level. */
  takeDiscard() {
    const sv = readSave(true);
    clearSave(true);
    if (!savedMoved(sv)) return;
    const m = sv.match;
    armQuitLoss('hoops4', 'recordResult', ['hoops4', this.statsDiff(m), false], modeTag(() => (modeFor(m, RED)), this.cpuDiff(m)));
    if (!takeQuitLoss('hoops4')) console.error('[hoops4] the thrown-away match was not recorded as a loss');
  }
  /** The match as it stands, saved (vs the computer or pass and play; `fly`: a shot in the air). A
   *  finished match keeps the save it had until finish() clears it, then records. */
  saveMatch(fly = null) {
    const m = this.match;
    if (this.mp || !m || this.recorded || m.over) return;
    const save = { v: 1, at: Date.now(), vsCpu: m.vsCpu ? 1 : 0, skill: m.cpuSkill, one: m.oneShot ? 1 : 0, first: m.first, turn: m.turn,
      sit: m.shotsThisTurn, shots: [m.shots[0] | 0, m.shots[1] | 0], moves: m.moves.map((x) => ({ by: x.by, col: x.col, shots: x.shots | 0 })), fly };
    try { localStorage.setItem(saveKeyOf(m.vsCpu), JSON.stringify(save)); } catch (err) { console.error('[hoops4] match not saved', err); }
  }
  /** Play again / New game: the same game again (its opponent, level and shot rule). */
  _sameGame() { const m = this.match; return m ? { vsCpu: m.vsCpu, oneShot: m.oneShot, skill: m.cpuSkill } : {}; }

  async start(opts = {}) {
    // A fresh solo match clears any multiplayer state; startLive/startAsync pass keepMp so their
    // own setup survives. Without that, "Play again" after a live match would silently keep
    // appending to a room nobody is in.
    if (!opts.keepMp) { this.mp = null; this.myPlayer = RED; this._stopRoom(); }
    const vsCpu = opts.vsCpu === undefined ? this.settings.opponent !== 'two' : !!opts.vsCpu;
    // CONTINUE picks the saved match of that kind up; anything else over a saved one throws it away
    // (vs the computer a loss once anyone has shot; pass and play records nothing). A multiplayer
    // match leaves both saves alone.
    let resumed = null;
    if (!opts.keepMp) {
      if (opts.resume) resumed = readSave(vsCpu);
      if (!resumed) { if (vsCpu) this.takeDiscard(); else clearSave(false); }
    }
    const oneShot = opts.oneShot === undefined ? this.settings.shots === 'one' : !!opts.oneShot;
    const skill = resumed ? resumed.match.cpuSkill
      : [1, 2, 3].includes(opts.skill) ? opts.skill : this.settings.opponent === 'two' ? 2 : this.settings.opponent;
    this.match = resumed ? resumed.match : new Match({ vsCpu, cpuSkill: vsCpu ? skill : 2, oneShot });
    if (typeof opts.replay === 'function') opts.replay(this.match);
    this.cpu = vsCpu ? new Cpu(skill) : null;
    this.recorded = false;
    // Nothing of the board it replaces carries over: not a ball in the air, not a computer about to shoot.
    this.throwState = null; this.busy = false;
    if (this._cpuT) { clearTimeout(this._cpuT); this._cpuT = 0; }
    if (!resumed) this.saveMatch();
    // A new match cannot inherit the last one's falling disc, or _whenLanded would hold its first
    // move for a drop that will never land.
    this._dropping = false; this._afterDrop = null; this._predicted = null;
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
      this.rend.setClosed(this.closedHoles());   // a resumed match may already have full columns
      this.rend.setBallColor(this.match.turn === RED ? BOARD.look.red : BOARD.look.yellow);
      // Multiplayer only: the machine wears YOUR colour for the whole match (render.setPlayerTint).
      if (this.mp) this.rend.setPlayerTint(this.myPlayer === RED ? BOARD.look.red : BOARD.look.yellow);
      this.offViewport = onViewportResize(() => this.fit());
      this.startLoop();
      // A continued match whose shot was in the air: that shot, flown again (same power, aim, seed).
      if (resumed && resumed.fly) this.shoot(resumed.fly.p, resumed.fly.a, resumed.fly.s);
      else this.maybeCpu();
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

  /**
   * WHERE THE SERIES STANDS, on the game-over card, and the button that starts the next one.
   *
   * Only for a turn-by-turn match of more than one game. The line is painted from the SAME pure
   * `seriesAfter()` both devices run, so the two cards cannot disagree about the score, and the
   * button is replaced by a verdict once the series is decided.
   */
  async _paintSeriesEnd(card) {
    const mp = this.mp;
    if (!mp || mp.kind !== 'async' || !mp.game || !(mp.game.series > 1)) return;
    let MP;
    const review = !!mp.review;
    try { MP = await import('./mp.js'); } catch { return; }
    if (this.disposed || !card.isConnected) return;
    // The local match knows the result; the stored document may not have caught up yet, so the
    // score is computed from the document plus THIS game's winner.
    const side = mp.side;
    const m = this.match;
    // The STORED winner when there is one (a resignation leaves the board unfinished).
    const ow = mp.game.over && mp.game.over.winner;
    const winnerSide = (ow === 'a' || ow === 'b') ? ow
      : m.winner === null ? null : (m.winner === this.myPlayer ? side : (side === 'a' ? 'b' : 'a'));
    const st = MP.seriesAfter({ ...mp.game, over: { winner: winnerSide } });
    const line = card.querySelector('.h4-series');
    if (line) {
      const mine = side === 'a' ? st.wins.a : st.wins.b;
      const theirs = side === 'a' ? st.wins.b : st.wins.a;
      const score = t('seriesScore', { a: mine, b: theirs });
      line.hidden = false;
      line.textContent = st.done
        ? `${score} \u00B7 ${st.winner === null ? t('seriesDrawn')
          : st.winner === side ? t('youTakeIt') : t('seriesWon', { who: this.themName() })}`
        : `${t('gameOf', { n: st.no, m: st.len })} \u00B7 ${score}`;
    }
    if (st.done) return;
    // A REVIEW offers the next game ONLY IF IT DOES NOT EXIST YET - a second one would fork the
    // series. (2026-09-23: this used to be never, which left the two series mis-scored "2-0" -
    // really 1-1 - with no way to reach the game 3 they are owed. See mp.js validateGame.)
    if (review) {
      const of = mp.game.seriesOf || mp.game.id;
      let rows = [];
      try { rows = await MP.readMyGames(); } catch { return; }
      if (this.disposed || !card.isConnected) return;
      if (rows.some((r) => r && r.seriesOf === of && (r.seriesNo | 0) > st.no)) return;
    }
    // A LIVE SERIES REPLACES "Play again", which in multiplayer only quits to the setup screen.
    const again = card.querySelector('.h4-again');
    if (!again) return;
    again.textContent = t('nextGame');
    again.replaceWith(again.cloneNode(true));            // drop the quit-to-setup handler
    const next = card.querySelector('.h4-again');
    this.on(next, 'click', async () => {
      next.disabled = true;
      const res = await MP.nextInSeries({ ...mp.game, over: { winner: winnerSide } });
      if (this.disposed) return;
      if (!res || !res.ok) {
        // Say it on the card. There is no toast on this screen and a dead button is worse than
        // a sentence (docs/BUILDING-A-GAME.md Part 0).
        if (line) line.textContent = t('mpOffline');
        next.disabled = false;
        return;
      }
      card.remove();
      this.startAsync(res.game);
    });
  }

  renderLoadError() {
    this.root.innerHTML = `<div class="h4-setup"><p class="h4-note">${t('loadError')}</p>
      <button type="button" class="gh-btn gh-btn-primary h4-play">${t('play')}</button></div>`;
    this.on(this.root.querySelector('.h4-play'), 'click', () => this.renderSetup());
  }

  renderPlay() {
    this.root.innerHTML = `
      <div class="h4-play-wrap">
        <div class="h4-hud${this.mp ? ' has-chat' : ''}">
          <div class="h4-turn" aria-live="polite">
            <span class="h4-who"></span>
            <span class="h4-sub"><span class="h4-shots"></span><span class="h4-leg" hidden></span></span>
          </div>
          <button type="button" class="h4-menu" aria-label="${t('menu')}">☰</button>
        </div>
        <div class="h4-stage">
          <canvas class="h4-canvas"></canvas>
          <div class="h4-swipe" aria-label="${t('swipeHint')}"></div>
          <p class="h4-toast" aria-live="polite"></p>
          <button type="button" class="h4-skip" hidden>${t('replaySkip')}</button>
        </div>
      </div>`;
    this.paintHud();
    this.bindSwipe();
    this.on(this.root.querySelector('.h4-menu'), 'click', () => this._showPause());
    this.on(this.root.querySelector('.h4-skip'), 'click', () => this._rpSkip());
    if (this.mp) this._mountChat();
  }

  /**
   * THE PAUSE SHEET, WHICH IS SKEEBALL'S. Matt: "make the 'menu' button look just like skeeball.
   * With the same options." So this is `skeeball/js/ui.js`'s `_showPause` ported: the same
   * `.gh-overlay`/`.gh-modal` primitives, the same X in the corner, the same Resume / New game /
   * leave stack, and the same 44x44 hamburger opening it.
   *
   * **The third option is this game's own destination, not skeeball's.** Skeeball's third button
   * quits to its machine gallery; this game has no gallery, and the Menu button has always gone
   * to its setup screen, which is where you change opponent and shot rule. In a turn-by-turn
   * match it goes to the multiplayer screen instead, because that is where the rest of your
   * matches are.
   *
   * **New game is hidden in any multiplayer match**, and that is a rule rather than tidiness:
   * there is nobody on the other end of a unilateral restart. In a live room both engines would
   * be replaying different boards from the next move on, and a turn-by-turn challenge is a shared
   * document with a move log - a rematch there is a new challenge, which the game-over card
   * already says.
   *
   * **PAUSED MEANS PAUSED.** The loop is stopped while the sheet is up, which is skeeball's own
   * lesson (2026-08-26) and is if anything more load-bearing here: a ball still in the air when
   * you tap the button would otherwise go on flying, drop through a hoop, take your turn and hand
   * the CPU its shot while you sat reading the menu. The canvas keeps showing its last frame.
   */
  _showPause() {
    // NOT ONCE THE MATCH IS OVER - the game-over card is already up or about to be, and it
    // carries its own Play again / Quit.
    if (!this.match || this.match.over) return;
    const isAsync = !!(this.mp && this.mp.kind === 'async');
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal h4-pause" role="dialog" aria-modal="true" aria-label="${t('paused')}">
        <button type="button" class="gh-modal__close" data-role="close" aria-label="${t('close')}">&times;</button>
        <h2 class="h4-pause-title">${t('paused')}</h2>
        <div class="gh-modal__actions">
          <button type="button" class="gh-btn gh-btn--primary gh-btn--block" data-role="resume">${t('resume')}</button>
          ${this.mp ? '' : `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="new">${t('newGame')}</button>`}
          <button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="leave">${isAsync ? t('backMp') : t('backSetup')}</button>
          ${isAsync && !(this.mp && this.mp.review) ? `<button type="button" class="gh-btn gh-btn--ghost gh-btn--block" data-role="quit">${this._quitKind() === 'resign' ? t('mpQuitQ').replace('?', '').replace('\u00bf', '') : t(this._quitKind() === 'cancel' ? 'mpCancelCh' : 'mpDeclineCh')}</button>` : ''}
        </div>
        <p class="h4-mp-note" data-role="qerr" hidden></p>
      </div>`;
    this.root.appendChild(el);
    this.stopLoop();
    const close = () => {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (!this.disposed) this.startLoop();
    };
    this.on(el.querySelector('[data-role="close"]'), 'click', close);
    this.on(el.querySelector('[data-role="resume"]'), 'click', close);
    const nw = el.querySelector('[data-role="new"]');
    // A live ball is abandoned, not banked: nothing is recorded until a match ENDS, so a
    // restart loses a board and no history (THE LAW rule 2).
    if (nw) this.on(nw, 'click', () => {
      // Two taps when it counts as a loss, the button saying so.
      if (this.match && this.match.vsCpu && this.discardCostsLoss() && nw.dataset.armed !== '1') { nw.dataset.armed = '1'; nw.textContent = t('quitLoss'); return; }
      if (el.parentNode) el.parentNode.removeChild(el); this.start(this._sameGame());
    });
    this.on(el.querySelector('[data-role="leave"]'), 'click', () => {
      if (el.parentNode) el.parentNode.removeChild(el);
      this.leaveMatch();
    });
    // QUIT A TURN-BY-TURN MATCH (2026-09-23): a resignation through MP.resignGame, asked twice
    // (the second tap says it counts as a loss). Nothing is deleted; the match ends for both.
    const qb = el.querySelector('[data-role="quit"]');
    if (qb) this.on(qb, 'click', async () => {
      const kind = this._quitKind();
      if (!qb.dataset.armed) {
        qb.dataset.armed = '1';
        const g = this.mp && this.mp.game;
        const other = g ? (this.mp.side === 'a' ? g.b : g.a) : null;
        const who = (other && other.name) || '?';
        qb.textContent = kind === 'resign' ? t('mpQuitYes') + ': ' + t('mpQuitBody', { who })
          // After the sender's first shot, calling it off is a loss for whoever does it (2026-10-29).
          : t(kind === 'cancel' ? 'mpCancelCh' : 'mpDeclineCh') + ': ' + t(g && typeof this.mp.MP.cancelCosts === 'function' && this.mp.MP.cancelCosts(g) ? 'mpLossBody' : 'mpNobodyBody');
        return;
      }
      qb.disabled = true;
      const mp = this.mp;
      const res = await mp.MP.resignGame(mp.id);
      if (!res || !res.ok) {
        qb.disabled = false;
        const e = el.querySelector('[data-role="qerr"]'); e.hidden = false; e.textContent = t('mpQuitFail');
        return;
      }
      if (el.parentNode) el.parentNode.removeChild(el);
      // Nobody had shot back: it was called off, not lost. Say so.
      if (res.cancelled) { this._leaveNoResult(this._endText(mp.MP, res.game, mp.side)); return; }
      this.teardownEngine();
      this.showMultiplayer();
    });
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
   *  multiplayer screen where the rest of your matches are. A match vs the computer or two on one
   *  phone is SAVED (2026-11-06), so it leaves with no question too. Only a live room really ends
   *  when you walk away, so it asks first. */
  leaveMatch() {
    const isAsync = !!(this.mp && this.mp.kind === 'async');
    const midGame = !!(this.match && !this.match.over && this.match.moves.length > 0);
    const go = () => {
      this.teardownEngine();
      if (isAsync) this.showMultiplayer(); else this.renderSetup();
    };
    if (isAsync || !midGame || !this.mp) { go(); return; }
    const el = document.createElement('div');
    el.className = 'gh-overlay';
    el.innerHTML = `
      <div class="gh-modal h4-sheet-in" role="dialog" aria-modal="true" aria-label="${t('leaveQ')}">
        <h2 class="gh-modal__title">${t('leaveQ')}</h2>
        <p class="h4-sheet-body">${this.quitCostsLoss() ? t('quitLoss') : t('leaveLost')}</p>
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
      return (other && other.name) || t('theirTurn');
    }
    if (this.match && this.match.vsCpu) {
      return t('cpu' + this.match.cpuSkill);   // the match's own level (a continued match keeps it)
    }
    return t('theirTurn');
  }

  /** The hoops over full columns, as hole ids ('c1'..'c7'). */
  closedHoles() {
    const m = this.match;
    if (!m) return [];
    const out = [];
    for (let c = 0; c < 7; c++) if (!m.board.canPlay(c)) out.push('c' + (c + 1));
    return out;
  }

  paintHud() {
    const m = this.match;
    if (!m) return;
    if (this.rend) this.rend.setClosed(this.closedHoles());
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
    // WHOSE TURN, IN WORDS, WITH THAT PLAYER'S BALL (2026-09-22). Matt: *"change the 'Your shot'
    // and the 'Hard is shooting'. Those are not good."* The CPU was named by its difficulty, so the
    // bar read "Hard is shooting". Now it is always "<who>'s turn": You / the computer / the other
    // player's name / Red or Yellow on one phone. The WORD says whose turn it is; the ball beside
    // it is the same basketball, in the same colour, as the ball on the lane - colour is never the
    // only signal (Matt is red/green colourblind), and the pill is filled on your turn, outlined
    // on theirs.
    const label = mine && (m.vsCpu || this.mp) ? t('turnYou')
      : m.vsCpu ? t('turnCpu')
        // Their NAME is on the line under the pill now, and at the pill's 19px it did not fit beside it.
        : this.mp ? t('theirTurn')
          : t('turnOf', { name: red ? t('red') : t('yellow') });
    const waiting = !mine && (m.vsCpu || (this.mp && this.mp.kind === 'live'));
    who.innerHTML = `${ballSVG(red ? BOARD.look.red : BOARD.look.yellow, red)}<span class="h4-who-txt"></span>`;
    who.querySelector('.h4-who-txt').textContent = label;
    who.className = 'h4-who ' + (red ? 'is-red' : 'is-yellow') + (mine ? ' is-mine' : ' is-them')
      + (waiting ? ' is-waiting' : '');
    sh.textContent = m.shotsThisTurn ? `${t('shot')} ${m.shotsThisTurn + 1}` : '';
    // WHICH GAME OF A SERIES, on the HUD, because it changes what the match is worth. Matt: "when
    // you accept a challenge and go to play, you should see what the shot settings and the series
    // selection is". The shot rule is visible in the play itself (a miss either passes the turn
    // or does not); the series is not visible anywhere else.
    const leg = this.root.querySelector('.h4-leg');
    const g = this.mp && this.mp.kind === 'async' ? this.mp.game : null;
    if (leg) {
      // YOUR COLOUR, IN WORDS, in any multiplayer match (2026-09-24) - the machine's tint says it
      // in colour (render.setPlayerTint), this says it for a red/green colourblind player.
      // WHO YOU ARE PLAYING, FIRST (2026-09-24). Matt, in two matches at once: "it's not clear who
      // i'm playing. i click on the challenge popup and im brought to a game that just says 'your
      // turn'". The pill only names them on THEIR turn, so on yours nothing did.
      const bits = [];
      if (this.mp) {
        const mp = this.mp, g2 = mp.game || {};
        const o = mp.kind === 'async' ? (mp.side === 'a' ? g2.b : g2.a) : mp.them;
        const emo = (o && typeof o === 'object' && o.emoji) || '';
        bits.push(t('vsName', { name: (emo ? emo + ' ' : '') + this.themName() }));
        // "You are Red/Yellow" was here for one deploy; Matt: "remove the 'you are yellow'". The
        // machine's tint (render.setPlayerTint) and the ball in the pill carry it.
      }
      if (g && g.series > 1) {
        bits.push(t('gameOf', { n: g.seriesNo, m: g.series }));
        // THE SERIES SCORE WHILE PLAYING (2026-09-24). Matt: "you can't see the series score
        // anywhere while playing. that needs to be added somewhere." It was only on the game-over
        // card. `seriesWins` is the score BEFORE this game (mp.js seriesAfter); yours first.
        const sw = g.seriesWins || { a: 0, b: 0 };
        const side = this.mp.side;
        bits.push(t('seriesScore', { a: (side === 'a' ? sw.a : sw.b) | 0, b: (side === 'a' ? sw.b : sw.a) | 0 }));
      }
      leg.hidden = !bits.length;
      // The name on its own line, the rest under it: one line cut "You are Red" off at 393px.
      leg.textContent = this.mp && bits.length > 1 ? bits[0] + '\n' + bits.slice(1).join(' \u00b7 ') : bits.join(' \u00b7 ');
    }
  }

  toast(msg, kind = '') {
    const el = this.root.querySelector('.h4-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'h4-toast is-on' + (kind ? ' ' + kind : '');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el && el.classList.remove('is-on'), 1400);
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
      const reach = G.aimReach > 0 ? G.aimReach : 1;   // boarddef: the outer columns' sweet spot
      const aim = Math.sign(raw) * Math.min(reach, Math.pow(Math.abs(raw), curve));
      this.shoot(power, aim);
    };
    this.on(pad, 'touchstart', start, { passive: true });
    this.on(pad, 'touchmove', move, { passive: false });
    this.on(pad, 'touchend', end);
    this.on(pad, 'mousedown', start);
    this.on(pad, 'mousemove', move);
    this.on(pad, 'mouseup', end);
  }

  /** `seedIn`: a continued match's shot that was in the air, flown again exactly. */
  shoot(power, aim, seedIn = null) {
    if (this.busy || !this.engine || !this.match || this.match.over) return;
    if (!this.isMyShot()) return;
    this.busy = true;
    // A FRESH SEED PER SHOT is what makes the release imperfect (boarddef's jitter*). Passing a
    // seed is opt-in at the engine, so every headless probe stays exactly deterministic.
    const seed = Number.isInteger(seedIn) ? seedIn : (Math.random() * 0x7fffffff) | 0;
    // THE BALL IS THE SHOOTER'S COLOUR. Matt: "the ball needs to be different colors. right now
    // it's the same color ball that both players throw, then it changes color on the board."
    // `setBallColor` has existed since the first build and was called EXACTLY ONCE, at match
    // start, so whoever shot first owned the ball for the whole game. Set per shot, so it is
    // right for a CPU turn, a remote turn and a pass-and-play turn without three call sites.
    if (this.rend) {
      this.rend.setBallColor(this.match.turn === RED ? BOARD.look.red : BOARD.look.yellow);
    }
    // A FULL COLUMN'S HOOP IS CAPPED (physics.js buildWorld `closed`): the ball bounces or rolls
    // off it and cannot score there. The same list paints the lids (paintHud -> setClosed).
    this.throwState = this.engine.phys.startThrow(BOARD, { power, aim, seed, closed: this.closedHoles() });
    this.captured = null;
    // Saved WITH the shot in the air, either side's (vs the computer, pass and play): leaving now
    // flies it again on Continue, so a shot can never be taken back by leaving.
    if (!this.mp) this.saveMatch({ p: power, a: aim, s: seed });
    // The throw is KEPT for the other person's replay (mp.js trailFrom): sent with the move.
    if (this.mp && this.mp.kind === 'async') {
      (this._trail || (this._trail = [])).push({ p: power, a: aim, s: seed });
      if (this._trail.length > 6) this._trail.shift();
    }
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
    // THE DISC FALLING DOWN ITS COLUMN, advanced by the game's own loop. A no-op unless one is
    // in the air - see render.js's startDrop.
    if (this.rend) this.rend.stepDrop(this._rp ? dt * REPLAY_SPEED : dt);
    const st = this.throwState;
    if (st && !st.done) {
      this.engine.phys.step(BOARD, st, st.replay ? dt * REPLAY_SPEED : dt);
      for (const ev of this.engine.phys.takeEvents(st)) {
        // THE DISC FALLS ON `through`, NOT ON `capture` (2026-09-22). Matt: "A ball can bounce
        // around on a rim and the ball falls down the column while the ball is still bouncing
        // around the rim." `capture` is the engine's GUESS, made while the ball is still up at rim
        // height, and since rimouts came back it can be wrong. `through` is the ball wholly below
        // the rim, inside the mouth and falling - it cannot come back out, and it fires about
        // 90 ms (median) before the throw resolves, so the disc still leaves with the ball.
        if (ev.type === 'capture') this.captured = ev.hole;
        if (ev.type === 'rimout') this.captured = null;
        if (ev.type === 'through') {
          this.captured = ev.hole;
          if (st.replay && !this._rpDropOk(ev.hole)) continue;   // the record says otherwise
          this.rend && this.rend.flashRim(ev.hole);
          this._dropOnCapture(ev.hole);
        }
      }
    } else if (st && st.done) {
      this.throwState = null;
      this.resolve(st);
    }
    // THE BALL STOPS BEING DRAWN THE MOMENT IT IS THROUGH THE RIM (2026-09-22). From then on the
    // disc falling down the column IS that ball. Matt, on a slow-motion recording: "now the ball
    // falls in front of the connect 4 board." It did: the physics keeps the ball falling through
    // the throat below the hoop until the throw resolves (83 ms median), and the screen is right
    // underneath the hoops, so the 3D ball dropped down the face of the board beside the disc.
    if (this.rend) this.rend.render(st && !st.done && !st.committed ? [st.ball] : [], dt);
  }

  resolve(st) {
    if (st.replay) { this._rpResolve(); return; }
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
    if (!this.mp && !m.over) this.saveMatch();   // the shot has settled (a finished match: finish() clears it)
    this._paintShot(res);
    if (this.mp) this._sendShot(res);
    if (this._liveInPlay()) LL.armLeave('hoops4', this._liveKey(), 'recordResult', ['hoops4', 'mp', false], [], modeTag(() => (modeFor(this.match, this.myPlayer)), 'mp'));

    if (m.over) { this._whenLanded(() => { if (!this.disposed) this.finish(); }); return; }
    this._whenLanded(() => { if (!this.disposed) this.maybeCpu(); });
  }

  /** Everything a settled shot changes on screen. Shared by a local shot and a remote one, so the
   *  two devices in a live match cannot paint different things for the same move. */
  _paintShot(res) {
    const m = this.match;
    // A made shot and a miss read differently by SHAPE (tick / cross), never by colour alone.
    if (res.type === 'miss') { this.toast('\u2715 ' + t('miss'), 'is-miss'); }
    else if (res.type === 'full') { this.toast('\u2715 ' + t('full'), 'is-miss'); }
    else { this.toast('\u2713 ' + t('inCol').replace('{n}', String(res.col + 1)), 'is-made'); }
    if (this.rend) {
      const win = res.type === 'win' ? res.cells : null;
      // A DISC THAT LANDED FALLS DOWN ITS COLUMN. Matt: "Can you show the ball fall down the
      // columns rather than go into the basket and just appear at the bottom of that column?"
      // A miss or a full column changes no cell, so there is nothing to drop and it paints at
      // once. `onDone` is what makes the game-over card wait: a winning disc's card would
      // otherwise cover the drop that won.
      // `_predicted` is the cell _dropOnCapture already started falling into, and it is matched
      // on the PREDICTION rather than on whether a disc is still in the air: a short fall
      // (0.22 s at the top row) can finish before the throw resolves (0.35 s median), and
      // restarting on that would replay the whole drop a second time.
      const pre = this._predicted; this._predicted = null;
      const landed = Number.isInteger(res.row) && Number.isInteger(res.col);
      if (pre && landed && pre.c === res.col && pre.r === res.row && pre.who === res.by) {
        // The disc the player is already watching IS this move. Hand it the real grid rather
        // than restarting it, or the fall would visibly jump back to the top. Once it has
        // already landed this is just the authoritative repaint of the same picture.
        this.rend.commitDrop(m.cells(), win);
      } else if (pre) {
        // The prediction did not survive the rules (a full column). Drop it and paint honestly.
        this._dropping = false; this._afterDrop = null;
        this.rend.cancelDrop(m.cells(), win);
      } else if (landed) {
        this._dropping = true;
        this.rend.startDrop(m.cells(), win, res.col, res.row, res.by, () => {
          this._dropping = false;
          if (this.disposed) return;
          if (this._afterDrop) { const fn = this._afterDrop; this._afterDrop = null; fn(); }
        });
      } else {
        this.rend.setGrid(m.cells(), win);
      }
      this.rend.setBallColor(m.turn === RED ? BOARD.look.red : BOARD.look.yellow);
    }
    this.paintHud();
  }

  /**
   * THE DISC STARTS FALLING THE MOMENT THE BALL IS IN THE BASKET, not when the throw resolves.
   * Matt: "There's a tiny lag between when the ball goes into the basket and when it's shown
   * falling... It should look like it's the same ball that goes in the basket falling down the
   * column." Measured over the 231-throw grid, resolving takes a further 0.35 s on average and
   * 0.92 s at worst, because capture COMMITS the score and the ball then falls 0.26 m through the
   * throat before `finishAt` fires. That whole window was dead time on screen.
   *
   * The cell is a PREDICTION and it is safe to make here for one reason only: this machine has no
   * rimout, so a captured ball scores in that column 100% of the time (hoops4/CLAUDE.md, "There is
   * NO rimout on this machine"). The prediction is never authoritative - `_paintShot` hands the
   * real grid to `commitDrop`, or cancels the drop outright if the rules refused the move.
   */
  _dropOnCapture(hole) {
    const m = this.match;
    const H = hole && BOARD.geom.holes[hole];
    if (!H || !m || m.over || !this.rend || this._predicted) return;
    const col = H.value - 1;
    if (!m.board.canPlay(col)) return;   // a full column is a miss, and no disc falls
    const row = m.board.heights[col];
    const who = m.turn;
    const cells = m.cells();
    cells[col][row] = who;               // the predicted grid, replaced by commitDrop
    this._predicted = { c: col, r: row, who };
    this._dropping = true;
    this.rend.startDrop(cells, null, col, row, who, () => {
      this._dropping = false;
      if (this.disposed) return;
      if (this._afterDrop) { const fn = this._afterDrop; this._afterDrop = null; fn(); }
    });
  }

  /** Run `fn` once the falling disc has landed, or immediately if nothing is falling. */
  _whenLanded(fn) {
    if (this._dropping) this._afterDrop = fn; else fn();
  }

  finish() {
    const m = this.match;
    // ONE-SHOT. Every write in js/game-stats.js is additive, so recording twice silently inflates
    // the play count rather than failing loudly.
    if (!this.recorded) {
      this.recorded = true;
      // The save goes first, so a continued match can never be finished and counted a second time.
      if (!this.mp) clearSave(m.vsCpu);
      const r = m.result();
      try {
        // 'mp' is the repo's own difficulty for a multiplayer match (js/game-stats.js) - it is
        // unmapped in js/difficulty-tiers.js, so it never lands in a difficulty tier. A
        // two-players-on-one-phone match records nothing, because there is no "you" in it.
        // A TURN-BY-TURN match: counted once per device through the ledger (mp.js), and scored
        // from the STORED winner when there is one - a resignation replays into an unfinished
        // board, whose m.winner would have scored the winner a loss.
        if (this.mp && this.mp.kind === 'async' && this.mp.game && this.mp.game.over && this.mp.game.over.winner === 'none') {
          // Called off (js/challenge-life.js): counts for nobody. Never reached in practice (the
          // board is left before this), and never allowed to score a loss if it is.
        } else if (this.mp && this.mp.kind === 'async') {
          const g = this.mp.game || {};
          const won = g.over && (g.over.winner === 'a' || g.over.winner === 'b')
            ? g.over.winner === this.mp.side : m.winner === this.myPlayer;
          // Its finish time keeps a fresh storage honest; the id rides with the count (2026-10-29).
          this.mp.MP.countFinished(this.mp.id, won, (g.over && g.over.at) || Date.now(), () => ({ ...(this.mp.MP.modeOfMatch(g) || {}), ...(m.first === 0 || m.first === 1 ? { first: m.first === this.myPlayer ? 'me' : 'them' } : {}) }), { detail: () => hoopsDetail(m, this.myPlayer) });
          // Seen right here, so the away-from-the-board Game Over popup never repeats it.
          try { this.mp.MP.markResultSeen(this.mp.id); } catch { /* display flag only */ }
        } else if (this.mp && LL.alreadyCounted(this._liveKey())) {
          // decided by a leave on this phone already (js/live-leave.js): it counts once, as that
        } else if (this.mp) { LL.endedNormally('hoops4', this._liveKey()); withMode(() => (modeFor(m, this.myPlayer)), 'mp', () => recordResult('hoops4', 'mp', m.winner === this.myPlayer), { detail: () => (hoopsDetail(m, this.myPlayer)) }); }
        else if (m.vsCpu) {
          withMode(() => (modeFor(m, RED)), this.cpuDiff(m), () => recordResult('hoops4', this.statsDiff(m), r.won), { detail: () => (hoopsDetail(m, RED)) });
        }
      } catch (e) { console.error('[hoops4] recordResult failed', e); }
    }
    const r = m.result();
    const acc = r.myShots ? Math.round((100 * r.myDiscs) / r.myShots) : 0;
    let head;
    // A resignation (reviewed, or arriving live while the match is open) - the board never ended.
    const rv = this.mp && this.mp.kind === 'async' && this.mp.game && this.mp.game.over;
    if (rv && !m.over) {
      // A REVIEWED match whose board never ended it - a resignation. The stored result is the
      // truth; the board alone would read as a draw.
      const w = rv.winner;
      head = (w !== 'a' && w !== 'b') ? t('draw') : (w === this.mp.side ? t('youWin') : t('youLose'));
    } else if (m.winner === null) head = t('draw');
    else if (this.mp) head = m.winner === this.myPlayer ? t('youWin') : t('youLose');
    else if (m.vsCpu) head = m.winner === RED ? t('youWin') : t('youLose');
    else head = m.winner === RED ? t('redWins') : t('yellowWins');

    const card = document.createElement('div');
    card.className = 'h4-over';
    // EVERY win/lose popup in this repo gets a close (X) in its top-right, so it can be dismissed
    // without being forced into a rematch (root CLAUDE.md).
    card.innerHTML = `<div class="h4-over-in" role="dialog" aria-modal="true">
        <button type="button" class="h4-x" aria-label="${t('close')}">&times;</button>
        <p class="h4-over-kicker">${t('gameOver')}</p>
        <h2>${head}</h2>
        <p class="h4-acc">${t('accuracy')} ${acc}% <span>(${r.myDiscs}/${r.myShots})</span></p>
        <p class="h4-series" hidden></p>
        <button type="button" class="gh-btn gh-btn-primary h4-again">${t('again')}</button>
        <button type="button" class="gh-btn h4-quit">${t('quit')}</button>
      </div>`;
    this.root.appendChild(card);
    this.on(card.querySelector('.h4-x'), 'click', () => card.remove());
    this._paintSeriesEnd(card);
    const again = card.querySelector('.h4-again');
    // "Play again" restarts a SOLO match. In multiplayer there is nobody on the other end of it -
    // a rematch is a new room or a new challenge - so the button quits to the setup screen.
    if (again) this.on(again, 'click', () => { card.remove(); if (this.mp) { this.teardownEngine(); this.renderSetup(); } else this.start(this._sameGame()); });
    this.on(card.querySelector('.h4-quit'), 'click', () => { card.remove(); this.teardownEngine(); this.renderSetup(); });
  }

  fit() {
    const stage = this.root.querySelector('.h4-stage');
    if (!stage || !this.rend) return;
    const r = stage.getBoundingClientRect();
    this.rend.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    // THE SHOT MESSAGE HANGS JUST UNDER THE BOARD (2026-09-23). Matt: "the 'column 4' and 'miss'
    // stuff and those notifications are in a bad spot and are tiny." They sat at the very bottom
    // of the lane in 13px type, under the thumb, while the player's eyes are on the hoops and the
    // board. The spot is MEASURED from the camera, so it follows the board on any screen size.
    const y = this.rend.boardBottomPx();
    if (y != null) stage.style.setProperty('--h4-toast-top', Math.round(y + 10) + 'px');
  }

  /** Detach from a live room, and end it for the other person too. A room nobody is in must not
   *  sit there looking joinable. */
  _stopRoom() {
    if (this._roomStop) { try { this._roomStop(); } catch {} this._roomStop = null; }
    const mp = this.mp;
    LL.hideClaim(this.root);
    if (this.net && mp && mp.kind === 'live' && mp.code && !mp.decided) {
      if (this._liveCanClaim()) this._liveClaim();
      else if (this._liveCosts()) {
        mp.decided = true;
        this.recorded = true;
        LL.forfeitNow('hoops4');
        LL.leaveWithForfeit(this.net, mp.code, mp.role, mp.role, 1).catch(() => {});
      } else {
        if (this._liveInPlay()) LL.disarmLeave('hoops4');
        try { this.net.leaveRoom(mp.code, mp.role); } catch {}
      }
    }
    if (this.net) { try { this.net.stopHeartbeat(); } catch {} }
  }

  teardownEngine() {
    this._unmountChat();
    this._stopRoom();
    if (this._gameStop) { try { this._gameStop(); } catch {} this._gameStop = null; }
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
    this._rp = null;
    this.engine = null;
    this.busy = false;
  }

  destroy() {
    // Leaving costs nothing: a match vs the computer (or pass and play) is saved, a challenge is in Firebase.
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
  // A marker armed by a build from before the save (2026-11-06): that match had no save, so under the
  // rule it was played by, it is a loss. This build arms none it does not take at once.
  takeQuitLoss('hoops4');
  LL.settleLeave('hoops4');  // the same for a live room (js/live-leave.js; no rejoin here)
  instance = new Hoops4(container);
  instance.mount();
  return instance;
}

export function destroy() {
  if (!instance) return;
  try { instance.destroy(); } finally { instance = null; }
}

/** ONLY A LIVE ROOM is abandoned by leaving. A match vs the computer and pass and play AUTOSAVE
 *  (2026-11-06, Continue), and a turn-by-turn match lives in `hoops/games/<id>` and re-opening
 *  replays it: saying "in progress" there would make the hub warn about losing something that cannot
 *  be lost (Matt: "you should be able to leave the game and play a regular game until the opponent plays"). */
export function isInProgress() {
  if (!(instance && instance.match && !instance.match.over && instance.match.moves.length > 0)) return false;
  return !!(instance.mp && instance.mp.kind === 'live');
}

/** A tiny basketball in a player's colour, for the turn pill - the same ball as on the lane. */
function ballSVG(fill, dark) {
  const seam = dark ? '#6e140e' : '#7a5800';
  return `<svg class="h4-ball" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="${fill}" stroke="${seam}" stroke-width="1.4"/>`
    + `<path d="M1 10h18M10 1v18M4 3.5c3 3 3 10 0 13M16 3.5c-3 3-3 10 0 13" fill="none" stroke="${seam}" stroke-width="1.3"/></svg>`;
}

/** The hub's leave confirm says "Counts as a loss" when this is true (a live room only). */
export function quitCostsLoss() { return !!(instance && instance.quitCostsLoss()); }

export default { init, destroy, isInProgress, quitCostsLoss };
