// match-chat-ui.js - QUICK CHAT INSIDE A MATCH, the screen half, for EVERY multiplayer game
// (2026-10-14). The data half is js/match-chat.js; its header says why this exists.
//
// A 💬 button opens a panel: the last few lines of this match ("Matt:" / "Anita:" in bold, the player's own profile name), each on
// its own side), the player's own quick-chat palette (js/mp-reactions.js - the emojis and phrases
// they chose on the profile page), and one free-text line. What the other person says pops as a
// BIG card naming them, tap to close; the same line again bumps a "×5" instead of stacking (Matt,
// 2026-09-24: "King of games will send Your Turn 5 times and it blocks my entire connect 4 board").
// While the panel is shut, the button carries an unread COUNT. Who said what is never a colour.
//
// It is Connect 4 Hoops' chat (hoops4/js/mp-ui.js createMatchChat, 2026-09-22) made generic: the
// same behaviour, its own `ghc-` styles (a dark HUD skin that reads on any game), its own words,
// and a PLACEMENT the game chooses, because every game's HUD owns a different corner.
//
//   const chat = createMatchChat({ root, send, them, place });
//   chat.add({ key, mine, t, v, at, who? }, { pop })   // a turn-by-turn line (from watchChat); `who`
//                                                     // {name, emoji} names its sender (three players)
//   chat.onReactions(room.reactions, mySeat)     // a live room's reactions slot
//   chat.setActive(bool)                         // show / hide everything (e.g. hide on a menu)
//   chat.destroy()                               // the game's destroy() MUST call this
//
// `root`   the game's root element. Everything goes in ONE layer appended to it, so a teardown
//          that empties the root takes it all, and destroy() removes it explicitly as well.
// `send`   async ({ t, v }) => { ok, reason?, entry? }. For a live room, net.sendReaction is
//          best-effort and resolves nothing: wrap it and return { ok: true }.
// `them`   () => ({ name, emoji }) for the other person.
// `place`  optional { top, right, popsTop } CSS lengths for the button and the bubbles. The
//          defaults sit the button at the top right, LEFT of a 44px menu button at `right: 12px`
//          (the hub's floating chip owns the top left), and the bubbles under it.
// `failText` optional (reason) => sentence when a line did not send.
//
// No storage, no network: this file can be cache-first in sw.js.

import { getLang, makeT, myName } from './i18n.js';
import { loadPalette, paletteItems, reactionText } from './mp-reactions.js';
import { cleanChat, CHAT_MAXLEN } from './match-chat.js';

const t = makeT({
  en: {
    chat: 'Chat', with: 'Chat with {name}', ph: 'Say something', send: 'Send', none: 'Nothing said yet.',
    notSent: 'Message not sent. Try again.', offline: 'No connection. Try again.',
    blocked: 'Chat is off on a test server.', dismiss: 'Tap to close', close: 'Close',
  },
  es: {
    chat: 'Chat', with: 'Chat con {name}', ph: 'Di algo', send: 'Enviar', none: 'Nadie ha dicho nada.',
    notSent: 'Mensaje no enviado. Inténtalo otra vez.', offline: 'Sin conexión. Inténtalo otra vez.',
    blocked: 'El chat está apagado en un servidor de pruebas.', dismiss: 'Toca para cerrar', close: 'Cerrar',
  },
});

const SHOW = 20;          // lines the panel's conversation holds (it scrolls; the newest is in view)
const KEEP = 30;          // lines this device remembers for the match
const POP_MS = 4500;      // your own line
const POP_THEM_MS = 8000; // theirs: long enough to read a 120-character line
const MAX_POPS = 3;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function defaultFail(reason) {
  if (reason === 'offline') return t('offline');
  if (reason === 'dev-origin-blocked') return t('blocked');
  return t('notSent');
}

export function createMatchChat({ root, send, them, place, failText } = {}) {
  injectCss();
  const log = [];
  const known = new Set();
  const timers = new Set();
  const offs = [];
  const lastAt = Object.create(null);
  let unread = 0, open = false, busy = false, err = '', seeded = false, destroyed = false;
  const listen = (tg, ty, fn, o) => { tg.addEventListener(ty, fn, o); offs.push(() => tg.removeEventListener(ty, fn, o)); };
  const host = root || document.body;
  const sendFn = typeof send === 'function' ? send : async () => ({ ok: false, reason: 'no-send' });
  const themFn = typeof them === 'function' ? them : () => ({});
  const failFn = typeof failText === 'function' ? failText : defaultFail;

  const layer = document.createElement('div');
  layer.className = 'ghc';
  const p = place || {};
  if (p.top) layer.style.setProperty('--ghc-top', p.top);
  if (p.right) layer.style.setProperty('--ghc-right', p.right);
  if (p.popsTop) layer.style.setProperty('--ghc-pops-top', p.popsTop);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghc-btn';
  const panel = document.createElement('div');
  panel.className = 'ghc-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  const pops = document.createElement('div');
  pops.className = 'ghc-pops';
  pops.setAttribute('aria-live', 'polite');
  layer.append(pops, panel, btn);
  host.appendChild(layer);

  // A typed line shows WHOLE up to CHAT_MAXLEN; reactionText() would cut it at the 24-character
  // floating-bubble cap that js/mp-reactions-ui.js uses.
  const textOf = (e) => (e.t === 'c' ? cleanChat(e.v) : reactionText({ t: e.t, v: e.v }, getLang()));
  const whoOf = (e) => (e.mine ? myName() : ((e.who || themFn() || {}).name || '?'));

  function paintBtn() {
    btn.setAttribute('aria-label', t('chat') + (unread ? ` (${unread})` : ''));
    btn.setAttribute('aria-expanded', String(open));
    btn.innerHTML = `<span aria-hidden="true">💬</span>${unread
      ? `<span class="ghc-badge" aria-hidden="true">${unread > 9 ? '9+' : unread}</span>` : ''}`;
    btn.classList.toggle('is-open', open);
  }

  function paintPanel() {
    if (!open) return;
    const items = paletteItems(loadPalette(), getLang());
    const emojis = items.filter((i) => i.payload.t === 'e');
    const words = items.filter((i) => i.payload.t !== 'e');
    const lines = log.slice(-SHOW);
    panel.setAttribute('aria-label', t('chat'));
    // THE CONVERSATION FIRST (2026-10-14). Matt, with a screenshot of the panel: "You can't even tell
    // there are messages because the quick chat options take up almost all the space." The lines
    // get the room (a scrolling thread, newest at the bottom, in view); the palette shrinks to two
    // thin rows that swipe sideways, emojis then phrases, so it costs ~90px whatever its size.
    const them = (themFn() || {}).name || '';
    panel.innerHTML = `
      <div class="ghc-head"><b class="ghc-title">${esc(them ? t('with', { name: them }) : t('chat'))}</b>
        <button type="button" class="ghc-x" data-role="close" aria-label="${esc(t('close'))}">✕</button></div>
      <div class="ghc-log">${lines.length ? lines.map((e) => `
        <p class="ghc-line ${e.mine ? 'is-mine' : 'is-them'}"><b class="ghc-who">${esc(whoOf(e))}</b><span class="ghc-said">${esc(textOf(e))}</span></p>`).join('')
        : `<p class="ghc-none">${esc(t('none'))}</p>`}</div>
      <div class="ghc-quick">${emojis.map((i) => `
        <button type="button" class="ghc-emoji" data-k="${esc(i.key)}" aria-label="${esc(i.text)}">${esc(i.text)}</button>`).join('')}</div>
      <div class="ghc-quick">${words.map((i) => `
        <button type="button" class="ghc-phrase" data-k="${esc(i.key)}">${esc(i.text)}</button>`).join('')}</div>
      <form class="ghc-form">
        <input class="ghc-input" type="text" maxlength="${CHAT_MAXLEN}" autocomplete="off"
               enterkeyhint="send" placeholder="${esc(t('ph'))}" aria-label="${esc(t('ph'))}">
        <button type="submit" class="ghc-send">${esc(t('send'))}</button>
      </form>
      ${err ? `<p class="ghc-err" role="alert">${esc(err)}</p>` : ''}`;
    panel._items = Object.create(null);
    for (const i of items) panel._items[i.key] = i.payload;
    const logEl = panel.querySelector('.ghc-log');
    if (logEl) logEl.scrollTop = logEl.scrollHeight;   // the newest line in view
  }

  function setOpen(on) {
    open = !!on;
    panel.hidden = !open;
    // The panel already lists the newest lines, so the cards step aside while it is open: a card
    // under a translucent panel read as a ghost of the same words (seen in the first screenshots).
    layer.classList.toggle('is-open', open);
    if (open) { unread = 0; err = ''; paintPanel(); }
    paintBtn();
  }

  async function doSend(payload) {
    if (busy || !payload) return;
    busy = true;
    let res;
    try { res = await sendFn(payload); } catch (e) { res = { ok: false, reason: String(e) }; }
    busy = false;
    if (destroyed) return;
    if (!res || !res.ok) {
      // NO SILENT FAILURE (THE LAW rule 6): the panel stays open and says so.
      err = failFn(res && res.reason);
      if (!open) setOpen(true); else paintPanel();
      return;
    }
    const e = res.entry || {};
    add({ key: e.key || `me${Date.now()}`, mine: true, t: payload.t, v: payload.v, at: e.at || Date.now() }, { pop: true });
    setOpen(false);
  }

  listen(btn, 'click', () => setOpen(!open));
  listen(panel, 'click', (e) => {
    if (e.target.closest('[data-role="close"]')) { setOpen(false); return; }
    const b = e.target.closest('button[data-k]');
    if (b && panel._items) doSend(panel._items[b.getAttribute('data-k')]);
  });
  listen(panel, 'submit', (e) => {
    e.preventDefault();
    const input = panel.querySelector('.ghc-input');
    const v = cleanChat(input ? input.value : '');
    if (v) doSend({ t: 'c', v });
  });
  // A tap on the chat must never reach the game underneath (a swipe pad, a mallet, a dart).
  for (const ty of ['pointerdown', 'touchstart', 'mousedown']) {
    listen(btn, ty, (e) => e.stopPropagation(), { passive: true });
    listen(panel, ty, (e) => e.stopPropagation(), { passive: true });
  }
  // Closing on a tap anywhere else - bound to the game's own root, never document.
  listen(host, 'pointerdown', (e) => {
    if (!open || panel.contains(e.target) || btn.contains(e.target)) return;
    setOpen(false);
  }, true);

  function arm(el, ms) {
    if (el._t) { clearTimeout(el._t); timers.delete(el._t); }
    const t1 = setTimeout(() => {
      timers.delete(t1); el._t = null; el.classList.add('is-off');
      const t2 = setTimeout(() => { timers.delete(t2); el.remove(); }, 260);
      timers.add(t2);
    }, ms);
    el._t = t1;
    timers.add(t1);
  }
  function dismiss(el) {
    if (el._t) { clearTimeout(el._t); timers.delete(el._t); el._t = null; }
    el.remove();
  }
  // SEE-THROUGH AND TAP-THROUGH (2026-10-14). Matt, with a screenshot of a "Bum" card over his
  // Flick Soccer pitch: "Please make this pop up transparent. I was in the middle of my move." A
  // card no longer takes a touch at all: the drag that was under it reaches the game. Only its ✕
  // (a real 44px button) is tappable, so it can still be closed by hand.
  listen(pops, 'click', (ev) => { const x = ev.target.closest('.ghc-pop-x'); if (x) dismiss(x.closest('.ghc-pop')); });
  for (const ty of ['pointerdown', 'touchstart', 'mousedown']) {
    listen(pops, ty, (ev) => { if (ev.target.closest('.ghc-pop-x')) ev.stopPropagation(); }, { passive: true });
  }

  function popBubble(e) {
    const text = textOf(e);
    if (!text) return;
    const ms = e.mine ? POP_MS : POP_THEM_MS;
    const sig = `${e.mine ? 1 : 0}|${e.t}|${text}`;
    const same = Array.from(pops.children).find((n) => n._sig === sig && !n.classList.contains('is-off'));
    if (same) {
      same._n += 1;
      const n = same.querySelector('.ghc-pop-n');
      if (n) { n.textContent = `×${same._n}`; n.hidden = false; }
      pops.appendChild(same);
      arm(same, ms);
      return;
    }
    const who = e.mine ? { name: myName(), emoji: '' } : (e.who || themFn() || {});
    const el = document.createElement('div');
    el.className = 'ghc-pop' + (e.mine ? ' is-mine' : '') + (e.t === 'e' ? ' is-emoji' : '');
    el._sig = sig;
    el._n = 1;
    el.innerHTML = `<span class="ghc-pop-who">${who.emoji ? `<span aria-hidden="true">${esc(who.emoji)}</span> ` : ''}${esc(who.name || '?')}</span>`
      + `<span class="ghc-pop-text">${esc(text)}</span>`
      + '<span class="ghc-pop-n" hidden></span>'
      + (e.mine ? '' : `<button type="button" class="ghc-pop-x" aria-label="${esc(t('close'))}">✕</button>`);
    pops.appendChild(el);
    while (pops.children.length > MAX_POPS) dismiss(pops.firstChild);
    arm(el, ms);
  }

  /** One line of this match. Duplicates (by key) are ignored, so a watch re-delivering a line
   *  this device already added cannot show it twice. */
  function add(e, { pop = false } = {}) {
    if (destroyed || !e || known.has(e.key)) return;
    known.add(e.key);
    log.push(e);
    log.sort((x, y) => x.at - y.at);
    while (log.length > KEEP) log.shift();
    if (pop) popBubble(e);
    if (!e.mine && pop && !open) { unread += 1; paintBtn(); }
    if (open) paintPanel();
  }

  /** LIVE: `rooms/<CODE>/reactions` is one slot per seat. The first snapshot only ADOPTS the stamps
   *  already there, so joining never replays a line said before this device was looking. */
  function onReactions(rx, mySeat) {
    if (destroyed) return;
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

  function setActive(on) {
    layer.hidden = !on;
    if (!on && open) setOpen(false);
  }

  function destroy() {
    destroyed = true;
    for (const off of offs) { try { off(); } catch { /* gone */ } }
    offs.length = 0;
    for (const x of timers) clearTimeout(x);
    timers.clear();
    if (layer.parentNode) layer.parentNode.removeChild(layer);
  }

  paintBtn();
  return { add, onReactions, setOpen, setActive, destroy, get log() { return log.slice(); }, get el() { return layer; } };
}

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('ghc-css')) return;
  const s = document.createElement('style');
  s.id = 'ghc-css';
  s.textContent = `
.ghc { position: absolute; inset: 0; pointer-events: none; z-index: 40;
  --ghc-top: max(10px, env(safe-area-inset-top, 0px)); --ghc-right: 64px;
  --ghc-pops-top: calc(var(--ghc-top) + 54px);
  --ghc-bg: rgb(20, 22, 28); --ghc-see: rgba(20, 22, 28, 0.42); --ghc-ink: #f4f5f7; --ghc-dim: #b9bec8;
  --ghc-edge: rgba(255, 255, 255, 0.24); --ghc-accent: #ffce3a;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.ghc[hidden] { display: none; }
.ghc-btn { appearance: none; pointer-events: auto; position: absolute; top: var(--ghc-top); right: var(--ghc-right);
  width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  border-radius: 10px; border: 1px solid var(--ghc-edge); background: var(--ghc-bg); color: var(--ghc-ink);
  font: inherit; font-size: 19px; line-height: 1; cursor: pointer; touch-action: manipulation; }
.ghc-btn.is-open { border: 2px solid var(--ghc-accent); }
.ghc-badge { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px;
  box-sizing: border-box; border-radius: 999px; border: 2px solid #14161c; background: var(--ghc-accent); color: #1d1f24;
  font-size: 11px; font-weight: 800; line-height: 16px; text-align: center; }
.ghc-panel { pointer-events: auto; position: absolute; top: calc(var(--ghc-top) + 52px); right: 12px;
  width: min(360px, calc(100% - 24px)); max-height: calc(100% - var(--ghc-top) - 64px);
  display: flex; flex-direction: column; box-sizing: border-box; padding: 4px 10px 10px; border-radius: 14px;
  border: 1px solid var(--ghc-edge); background: var(--ghc-bg); color: var(--ghc-ink);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); }
.ghc-panel[hidden] { display: none; }
.ghc-head { display: flex; align-items: center; gap: 8px; min-height: 44px; flex: 0 0 auto; }
.ghc-title { flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The close X (Matt, 2026-10-19: "a little easier to select"): a visible 44px disc, plus 10px of
   invisible tap area all round, so a near miss still closes it. */
.ghc-x { appearance: none; position: relative; flex: 0 0 auto; width: 44px; height: 44px; margin: 4px -4px 4px 0;
  border: 0; border-radius: 50%; background: rgba(255, 255, 255, 0.12); color: var(--ghc-ink);
  font-size: 20px; font-weight: 700; line-height: 1; cursor: pointer; touch-action: manipulation; }
.ghc-x::after { content: ''; position: absolute; inset: -10px; }
/* THE THREAD: most of the panel, scrolls inside itself, never the page. */
.ghc-log { flex: 1 1 auto; min-height: 96px; max-height: 46vh; overflow-y: auto; overscroll-behavior: contain;
  display: flex; flex-direction: column; gap: 6px; padding: 8px; margin-bottom: 8px; border-radius: 10px;
  background: rgba(255, 255, 255, 0.05); }
.ghc-line { margin: 0; max-width: 85%; padding: 6px 10px; border-radius: 12px; font-size: 15px; line-height: 1.3;
  background: rgba(255, 255, 255, 0.10); overflow-wrap: anywhere; display: flex; flex-direction: column; gap: 1px; }
.ghc-line.is-mine { align-self: flex-end; border: 1px solid var(--ghc-edge); background: rgba(255, 206, 58, 0.12); }
.ghc-line.is-them { align-self: flex-start; }
.ghc-who { font-size: 12px; font-weight: 800; color: var(--ghc-dim); }
.ghc-none { margin: auto 0; text-align: center; font-size: 13px; color: var(--ghc-dim); }
/* THE PALETTE: two thin rows that swipe sideways. */
.ghc-quick { flex: 0 0 auto; display: flex; gap: 5px; overflow-x: auto; overscroll-behavior: contain;
  touch-action: pan-x; scrollbar-width: none; margin-bottom: 6px; }
.ghc-quick::-webkit-scrollbar { display: none; }
.ghc-emoji { appearance: none; flex: 0 0 auto; width: 40px; height: 40px; border: 0; border-radius: 9px; padding: 0;
  background: rgba(255, 255, 255, 0.09); font-size: 20px; line-height: 1; cursor: pointer; touch-action: manipulation; }
.ghc-phrase { appearance: none; flex: 0 0 auto; min-height: 36px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--ghc-edge);
  background: transparent; color: var(--ghc-ink); font: inherit; font-size: 13px; font-weight: 700; white-space: nowrap;
  cursor: pointer; touch-action: manipulation; }
.ghc-emoji:active, .ghc-phrase:active { background: rgba(255, 255, 255, 0.18); }
.ghc-form { flex: 0 0 auto; display: flex; gap: 6px; margin-top: 2px; }
.ghc-input { flex: 1 1 auto; min-width: 0; min-height: 44px; box-sizing: border-box; padding: 0 10px;
  border-radius: 10px; border: 1px solid var(--ghc-edge); background: rgba(255, 255, 255, 0.06); color: var(--ghc-ink);
  font: inherit; font-size: 16px; }
.ghc-send { appearance: none; flex: 0 0 auto; min-height: 44px; padding: 0 14px; border-radius: 10px; border: 0;
  background: var(--ghc-accent); color: #1d1f24; font: inherit; font-size: 15px; font-weight: 800;
  cursor: pointer; touch-action: manipulation; }
.ghc-err { margin: 6px 0 0; font-size: 13px; font-weight: 700; }
.ghc-err::before { content: "⚠ "; }
.ghc.is-open .ghc-pops { display: none; }
.ghc-pops { position: absolute; top: var(--ghc-pops-top); left: 12px; right: 12px;
  display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
.ghc-pop { position: relative; pointer-events: none;
  display: inline-flex; align-items: center; gap: 8px; max-width: 100%; box-sizing: border-box;
  padding: 6px 12px; border-radius: 14px 4px 14px 14px; background: var(--ghc-see); color: var(--ghc-ink);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  border: 1px solid var(--ghc-edge); font-size: 15px; font-weight: 600;
  transition: opacity 240ms ease; }
.ghc-pop.is-off { opacity: 0; }
.ghc-pop.is-mine { align-self: flex-end; }
.ghc-pop-who { font-size: 12px; font-weight: 800; white-space: nowrap; }
.ghc-pop-text { white-space: normal; overflow-wrap: anywhere; }
.ghc-pop.is-emoji .ghc-pop-text { font-size: 22px; }
.ghc-pop-n { font-size: 14px; font-weight: 800; opacity: .85; }
.ghc-pop-n[hidden] { display: none; }
.ghc-pop:not(.is-mine) { flex-direction: column; gap: 4px; width: min(92%, 420px); padding: 14px 18px;
  border-radius: 16px; border: 2px solid rgba(255, 255, 255, 0.55); font-size: 24px; line-height: 1.25; text-align: center; }
.ghc-pop:not(.is-mine) .ghc-pop-who { font-size: 16px; }
.ghc-pop.is-emoji:not(.is-mine) .ghc-pop-text { font-size: 44px; }
.ghc-pop-x { appearance: none; pointer-events: auto; position: absolute; top: 0; right: 0; width: 44px; height: 44px;
  border: 0; background: transparent; color: var(--ghc-ink); font: inherit; font-size: 16px; line-height: 1;
  opacity: .85; cursor: pointer; touch-action: manipulation; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); }
`;
  document.head.appendChild(s);
}

export default { createMatchChat };
