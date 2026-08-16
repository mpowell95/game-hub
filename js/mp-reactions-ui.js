// mp-reactions-ui.js — the DOM half of quick-chat reactions: a floating corner button
// that opens the device's palette, and the transient bubbles that pop when a reaction
// arrives. The model (storage, defaults, resolving a payload to text) is mp-reactions.js.
//
// One controller per mounted MP game. The layer is appended to document.body (not the
// game root) so `position: fixed` is honoured even inside a game whose own containers use
// transforms/filters (which would otherwise become the containing block and clip it). The
// controller owns the whole layer and removes it in destroy(), and the hub only ever has
// one game mounted at a time, so a body-level layer can't accumulate.
//
//   const rx = createReactions({ send, mySeatKey, resolveSender });
//   rx.setActive(true|false)   // show/hide the button (true only during a live MP match)
//   rx.onRoom(room)            // called from the game's room callback; pops incoming bubbles
//   rx.destroy()
//
// send(payload)         REQUIRED — forward to net.sendReaction(code, mySeatKey(), payload)
// mySeatKey()           REQUIRED — the sender's own seat key (so we never echo ourselves)
// resolveSender(key)    OPTIONAL — { name, emoji } for a sender; falls back to reading the
//                       room roster (host/guest/seats) passed to onRoom().

import { getLang } from './i18n.js';
import { loadPalette, paletteItems, reactionText } from './mp-reactions.js';

const LABELS = {
  open:  { en: 'Send a reaction', es: 'Enviar una reacción' },
  close: { en: 'Close',           es: 'Cerrar' },
};
const MAX_BUBBLES = 5;
const BUBBLE_MS = 4500;

let _cssInjected = false;

export function createReactions(opts) {
  const send = (opts && opts.send) || (() => {});
  const mySeatKey = (opts && opts.mySeatKey) || (() => null);
  const resolveSender = (opts && opts.resolveSender) || null;

  injectCss();

  const layer = document.createElement('div');
  layer.className = 'mpr-layer';
  layer.setAttribute('data-mpr', '');
  layer.hidden = true;   // shown by setActive(true)

  const bubbles = document.createElement('div');
  bubbles.className = 'mpr-bubbles';
  bubbles.setAttribute('aria-live', 'polite');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mpr-fab';
  btn.innerHTML = '<span aria-hidden="true">😀</span>';

  const panel = document.createElement('div');
  panel.className = 'mpr-panel';
  panel.hidden = true;

  layer.appendChild(bubbles);
  layer.appendChild(panel);
  layer.appendChild(btn);
  document.body.appendChild(layer);

  let active = false;
  let panelOpen = false;
  const lastAt = Object.create(null);
  let seeded = false;
  const timers = new Set();

  function relabel() {
    const lang = getLang();
    btn.setAttribute('aria-label', LABELS.open[lang] || LABELS.open.en);
    btn.title = LABELS.open[lang] || LABELS.open.en;
  }

  function buildPanel() {
    const lang = getLang();
    const items = paletteItems(loadPalette(), lang);
    const emojis = items.filter((i) => i.payload.t === 'e');
    const texts = items.filter((i) => i.payload.t !== 'e');
    panel.innerHTML =
      `<div class="mpr-emojis">${emojis.map((i) =>
        `<button type="button" class="mpr-emoji" data-key="${esc(i.key)}" aria-label="${esc(i.text)}">${esc(i.text)}</button>`).join('')}</div>` +
      (texts.length
        ? `<div class="mpr-phrases">${texts.map((i) =>
            `<button type="button" class="mpr-phrase" data-key="${esc(i.key)}">${esc(i.text)}</button>`).join('')}</div>`
        : '');
    // stash the payloads by key so a click doesn't re-parse
    panel._items = Object.create(null);
    for (const i of items) panel._items[i.key] = i.payload;
  }

  function openPanel() {
    buildPanel();
    panel.hidden = false;
    panelOpen = true;
    btn.classList.add('is-open');
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  }
  function closePanel() {
    panel.hidden = true;
    panelOpen = false;
    btn.classList.remove('is-open');
    document.removeEventListener('pointerdown', onOutside, true);
  }
  function onOutside(e) {
    if (!layer.contains(e.target)) closePanel();
  }

  function onPanelClick(e) {
    const b = e.target.closest('button[data-key]');
    if (!b) return;
    const payload = panel._items && panel._items[b.getAttribute('data-key')];
    if (!payload) return;
    try { send(payload); } catch { /* best-effort */ }
    // Show the sender their own reaction immediately (the room round-trip won't echo it back).
    popBubble({ t: payload.t, v: payload.v }, { name: null, emoji: null, self: true });
    closePanel();
  }

  function onBtn() { panelOpen ? closePanel() : openPanel(); }

  btn.addEventListener('click', onBtn);
  panel.addEventListener('click', onPanelClick);

  function senderFor(room, key) {
    if (resolveSender) { try { const r = resolveSender(key); if (r) return r; } catch { /* fall through */ } }
    // Derive from the room roster: N-seat rooms key by index, 2-seat by host/guest.
    const seats = room && room.seats;
    let p = null;
    if (seats && seats[key]) p = seats[key];
    else if (key === 'host' || key === '0' || key === 0) p = room && room.host;
    else if (key === 'guest' || key === '1' || key === 1) p = room && room.guest;
    return p ? { name: p.name || '', emoji: p.avatar || '' } : { name: '', emoji: '' };
  }

  function onRoom(room) {
    const rx = room && room.reactions;
    if (!rx || typeof rx !== 'object') return;
    const mine = String(mySeatKey());
    // First room snapshot after (re)join: adopt the current timestamps without replaying
    // anything already sitting in the room from before this device was looking.
    if (!seeded) {
      for (const k of Object.keys(rx)) lastAt[k] = (rx[k] && rx[k].at) || 0;
      seeded = true;
      return;
    }
    for (const k of Object.keys(rx)) {
      if (k === mine) continue;
      const entry = rx[k];
      const at = (entry && entry.at) || 0;
      if (at > (lastAt[k] || 0)) {
        lastAt[k] = at;
        popBubble(entry, senderFor(room, k));
      }
    }
  }

  function popBubble(entry, sender) {
    const text = reactionText(entry, getLang());
    if (!text) return;
    const isEmoji = entry.t === 'e';
    const el = document.createElement('div');
    el.className = 'mpr-bubble' + (isEmoji ? ' is-emoji' : '') + (sender && sender.self ? ' is-self' : '');
    const who = sender && (sender.emoji || sender.name)
      ? `<span class="mpr-who">${esc(sender.emoji || '')}${sender.name ? `<span class="mpr-who-name">${esc(sender.name)}</span>` : ''}</span>`
      : '';
    el.innerHTML = who + `<span class="mpr-react">${esc(text)}</span>`;
    bubbles.appendChild(el);
    while (bubbles.children.length > MAX_BUBBLES) bubbles.removeChild(bubbles.firstChild);
    requestAnimationFrame(() => el.classList.add('is-on'));
    const t = setTimeout(() => {
      el.classList.remove('is-on');
      const t2 = setTimeout(() => { el.remove(); timers.delete(t2); }, 260);
      timers.add(t2);
      timers.delete(t);
    }, BUBBLE_MS);
    timers.add(t);
  }

  function setActive(on) {
    active = !!on;
    layer.hidden = !active;
    if (!active) { closePanel(); relabel(); }
    else relabel();
  }

  function destroy() {
    closePanel();
    btn.removeEventListener('click', onBtn);
    panel.removeEventListener('click', onPanelClick);
    document.removeEventListener('pointerdown', onOutside, true);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (layer.parentNode) layer.parentNode.removeChild(layer);
  }

  relabel();
  return { setActive, onRoom, destroy, relabel };
}

function esc(x) {
  return String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function injectCss() {
  if (_cssInjected || typeof document === 'undefined') return;
  if (document.getElementById('mpr-css')) { _cssInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'mpr-css';
  s.textContent = `
.mpr-layer{ position:fixed; inset:0; z-index:2147483000; pointer-events:none; }
.mpr-layer[hidden]{ display:none; }
.mpr-fab{
  position:fixed; right:calc(env(safe-area-inset-right,0px) + 14px);
  bottom:calc(env(safe-area-inset-bottom,0px) + 14px);
  width:46px; height:46px; border-radius:50%; border:none; margin:0; padding:0;
  display:flex; align-items:center; justify-content:center; font-size:24px; line-height:1;
  background:#1F5FA8; color:#fff; cursor:pointer; pointer-events:auto;
  box-shadow:0 4px 14px rgba(0,0,0,0.28); -webkit-tap-highlight-color:transparent;
  transition:transform .12s ease, box-shadow .12s ease;
}
.mpr-fab:active{ transform:scale(0.92); }
.mpr-fab.is-open{ transform:scale(0.92); box-shadow:0 2px 8px rgba(0,0,0,0.3) inset; }
.mpr-panel{
  position:fixed; right:calc(env(safe-area-inset-right,0px) + 14px);
  bottom:calc(env(safe-area-inset-bottom,0px) + 68px);
  width:min(300px, calc(100vw - 28px)); max-height:52vh; overflow-y:auto;
  overscroll-behavior:contain; pointer-events:auto;
  background:var(--hub-surface,#fff); color:var(--hub-ink,#16181d);
  border:1px solid rgba(0,0,0,0.10); border-radius:16px; padding:10px;
  box-shadow:0 10px 34px rgba(0,0,0,0.26);
}
.mpr-panel[hidden]{ display:none; }
.mpr-emojis{ display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
.mpr-emoji{
  border:none; background:var(--hub-surface-2,rgba(0,0,0,0.05)); border-radius:12px;
  font-size:26px; line-height:1; padding:8px 0; cursor:pointer; -webkit-tap-highlight-color:transparent;
}
.mpr-emoji:active{ transform:scale(0.9); }
.mpr-phrases{ display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.mpr-phrase{
  border:1px solid rgba(0,0,0,0.12); background:transparent; color:inherit;
  border-radius:999px; padding:7px 12px; font-size:14px; font-weight:600; cursor:pointer;
  -webkit-tap-highlight-color:transparent;
}
.mpr-phrase:active{ transform:scale(0.96); }
.mpr-bubbles{
  position:fixed; left:0; right:0; bottom:calc(env(safe-area-inset-bottom,0px) + 72px);
  display:flex; flex-direction:column; align-items:center; gap:8px; padding:0 12px;
  pointer-events:none;
}
.mpr-bubble{
  max-width:min(88vw,360px); display:flex; align-items:center; gap:8px;
  background:rgba(20,22,26,0.92); color:#fff; border-radius:16px; padding:7px 13px;
  font-size:16px; font-weight:600; box-shadow:0 6px 20px rgba(0,0,0,0.3);
  opacity:0; transform:translateY(10px) scale(0.96); transition:opacity .22s ease, transform .22s ease;
}
.mpr-bubble.is-on{ opacity:1; transform:translateY(0) scale(1); }
.mpr-bubble.is-self{ background:rgba(31,95,168,0.94); }
.mpr-bubble.is-emoji .mpr-react{ font-size:26px; }
.mpr-who{ display:inline-flex; align-items:center; gap:5px; font-size:18px; }
.mpr-who-name{ font-size:12px; font-weight:600; opacity:0.85; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mpr-react{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
:root.gh-dark .mpr-panel{ background:#23262b; color:#f0f2f5; border-color:rgba(255,255,255,0.12); }
:root.gh-dark .mpr-emoji{ background:rgba(255,255,255,0.08); }
:root.gh-dark .mpr-phrase{ border-color:rgba(255,255,255,0.16); }
@media (prefers-reduced-motion: reduce){
  .mpr-fab, .mpr-fab:active, .mpr-fab.is-open, .mpr-emoji:active, .mpr-phrase:active{ transition:none; transform:none; }
  .mpr-bubble{ transition:opacity .22s ease; transform:none; }
  .mpr-bubble.is-on{ transform:none; }
}`;
  (document.head || document.documentElement).appendChild(s);
  _cssInjected = true;
}

export default { createReactions };
