// js/signin-ask.js - ALLOW / DENY SIGN IN, the phone half (2026-11-15, Matt: "i like the allow/deny popup on the
// original phone" ... "cool yeah build"). Pure rules: js/signin-rules.js. Server (the only thing that grants):
// functions/signin.js. Approved mockup: docs/mockups/new-phone-approval.html. Story and release checklist:
// docs/SECURITY-DEVICE-KEYS.md, "Step B".
//
// NOT CLEARED FOR PLAYERS: everything here runs only for codes in the ask set (js/admin-config.js
// resolveSigninAsk: test1's DREG5 by default, plus codes Matt adds on Admin > People). Every other code links
// exactly as it always has, and its phones never watch anything.
//
// Two halves:
//   THE NEW PHONE (js/name-gate.js calls these): createRequest -> watchMine (until the server's `granted`, a
//     Deny, a Cancel or the 10 minutes) -> confirmClaim (msgAuth re-read) -> the gate's normal link.
//   THE CODE'S OTHER PHONES (js/hub.js calls startSigninWatch after paint): watch signIns/<own code> for waiting
//     requests (a query on `state`, so only waiting rows download), show "New sign in" with Deny / Allow, and
//     stamp who saw it (seen/<uid> = first, last, how often, and what was tapped) on the request itself.
//
// THE LAW: nothing here touches a stats key, a profile, a save or players/. A refused, failed or lapsed request
// leaves the new phone exactly as it was (it never had the code). Every write goes through writesAllowed()
// (dev origin, test automation: js/automation.js) and is verified by a fresh re-read. Nothing is ever deleted.

import { getStatsApp } from './firebase-boot.js';
import { writesAllowed } from './stats-net.js';
import { loadProfile } from './profile-store.js';
import { isSigninAsk, refreshAdminConfig, onAdminConfig } from './admin-config.js';
import { liveNow, serverNow, startServerTime } from './server-time.js';
import { deviceLine, nextSeen, waitingList, isWaiting, LAPSE_MS } from './signin-rules.js';
import { makeT, getLang } from './i18n.js';
import STRINGS from './strings.js';

const t = makeT(STRINGS);
/** t() with an English fallback: js/strings.js is cache-first, so a new key can be missing for one visit. */
export const tx = (key, en, p) => {
  const v = t(key, p);
  return v && v !== key ? v : String(en).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] != null ? p[k] : m));
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowS = () => { const l = liveNow(); return l != null ? l : serverNow(); };

// TEST SEAM (tools only): an in-memory database. No screen calls it.
let bootFn = getStatsApp;
export function __setBootForTest(fn) { bootFn = fn || getStatsApp; }

/** Does joining this code need an Allow? A fresh config read (at most `ms`) when the cache says no. */
export async function needsAllow(code, ms = 2500) {
  if (isSigninAsk(code)) return true;
  try { await Promise.race([refreshAdminConfig(), new Promise((r) => setTimeout(r, ms))]); } catch { /* cached answer */ }
  return isSigninAsk(code);
}

/** "Android · Chrome" for this phone. */
export function myDeviceLine() {
  try { return deviceLine(navigator.userAgent); } catch { return 'Phone'; }
}

/** The time line under the device: "Today, 2:14 PM" or "Nov 14, 2:14 PM", in the phone's own time. */
export function whenLine(ms, now = Date.now()) {
  if (!(ms > 0)) return '';
  const loc = getLang() === 'es' ? 'es-ES' : 'en-US';
  const d = new Date(ms), n = new Date(now);
  let time = '';
  try { time = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' }); } catch { time = ''; }
  if (d.toDateString() === n.toDateString()) return tx('si_today', 'Today, {t}', { t: time });
  let day = '';
  try { day = d.toLocaleDateString(loc, { month: 'short', day: 'numeric' }); } catch { day = ''; }
  return `${day}, ${time}`;
}

// --- the new phone ---------------------------------------------------------------------------------

/** Ask to join `code`. Returns { ok: true, id } or { ok: false, reason }. Never throws. */
export async function createRequest(code, { name, via }) {
  try {
    if (!writesAllowed('sign in request')) return { ok: false, reason: 'blocked' };
    const boot = await bootFn();
    if (!boot || !boot.uid) return { ok: false, reason: 'offline' };
    const { db, api, uid } = boot;
    const ref = api.push(api.ref(db, `signIns/${code}`));
    const rec = { uid, name: String(name || '').slice(0, 40), device: myDeviceLine().slice(0, 80), at: api.serverTimestamp(),
      via: via === 'thatsme' ? 'thatsme' : 'link', state: 'waiting' };
    await api.set(ref, rec);
    const back = await api.get(api.ref(db, `signIns/${code}/${ref.key}`));
    const v = back && back.exists() ? back.val() : null;
    if (!v || v.uid !== uid || v.state !== 'waiting') {
      console.error(`[signin] request VERIFY FAILED for signIns/${code}/${ref.key}`);
      return { ok: false, reason: 'did-not-land' };
    }
    return { ok: true, id: ref.key, at: +v.at || 0 };
  } catch (err) {
    console.error('[signin] could not send the request', err);
    return { ok: false, reason: 'failed' };
  }
}

/** Watch this phone's own request. `cb(req)` on every change. Returns an unsubscribe. */
export async function watchMine(code, id, cb) {
  try {
    const boot = await bootFn();
    if (!boot) return () => {};
    const { db, api } = boot;
    return api.onValue(api.ref(db, `signIns/${code}/${id}`), (s) => { try { cb(s && s.exists() ? s.val() : null); } catch (err) { console.error('[signin] watcher', err); } },
      (err) => console.warn('[signin] watch failed', err));
  } catch { return () => {}; }
}

/** Withdraw this phone's waiting request (Cancel). Verified by re-read. */
export async function cancelRequest(code, id) {
  try {
    if (!writesAllowed('sign in cancel')) return { ok: false };
    const boot = await bootFn();
    if (!boot) return { ok: false };
    const { db, api } = boot;
    await api.update(api.ref(db, `signIns/${code}/${id}`), { state: 'cancelled' });
    const v = (await api.get(api.ref(db, `signIns/${code}/${id}/state`))).val();
    return { ok: v === 'cancelled' };
  } catch (err) { console.warn('[signin] cancel failed', err); return { ok: false }; }
}

/** After `granted`: is msgAuth/<my uid> really this code now (fresh read)? */
export async function confirmClaim(code) {
  try {
    const boot = await bootFn();
    if (!boot || !boot.uid) return false;
    const { db, api, uid } = boot;
    return (await api.get(api.ref(db, `msgAuth/${uid}`))).val() === code;
  } catch { return false; }
}

/** "No other phone? Report to Matt": a bug report (admin-read). Returns true once it landed. */
export async function reportToMatt(name, code) {
  try {
    const br = await import('./bug-report.js');
    const rep = await br.buildBugReport({ description: `Sign in help: ${String(name || '').slice(0, 40)} ${code}`, gameId: null, gameTitle: null, context: 'signin' });
    const res = await br.submitBugReport(rep);
    if (res && res.ok) return true;
    if (res && res.retryable) br.queuePendingReport(rep);
    return false;
  } catch (err) { console.error('[signin] report failed', err); return false; }
}

// The wait survives a reload (the app closed while the other phone answers): which request this phone is
// waiting on. A one-tap convenience, never player data; cleared when the wait ends.
const WAIT_KEY = 'gamehub.signinWait.v1';
export function saveWait(w) { try { localStorage.setItem(WAIT_KEY, JSON.stringify(w)); } catch { /* memory only */ } }
export function clearWait() { try { localStorage.removeItem(WAIT_KEY); } catch { /* fine */ } }
export function readWait() {
  try {
    const w = JSON.parse(localStorage.getItem(WAIT_KEY) || 'null');
    if (w && w.code && w.id && Date.now() - (+w.t || 0) < LAPSE_MS + 5 * 60 * 1000) return w;
    if (w) clearWait();
  } catch { /* none */ }
  return null;
}

// --- the code's other phones, and Matt ----------------------------------------------------------------

/** Answer a waiting request: Allow (true) or Deny (false). Verified by re-read. */
export async function answerRequest(code, id, allow) {
  try {
    if (!writesAllowed('sign in answer')) return { ok: false, error: 'blocked' };
    const boot = await bootFn();
    if (!boot || !boot.uid) return { ok: false, error: 'offline' };
    const { db, api, uid } = boot;
    const want = allow ? 'allowed' : 'denied';
    await api.update(api.ref(db, `signIns/${code}/${id}`), { state: want, by: uid, answeredAt: api.serverTimestamp() });
    const v = (await api.get(api.ref(db, `signIns/${code}/${id}`))).val() || {};
    if (v.state !== want || v.by !== uid) return { ok: false, error: 'did not land' };
    return { ok: true };
  } catch (err) {
    console.error('[signin] answer failed', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

const _seen = new Map();   // `${code}/${id}` -> this phone's last stamp
/** Stamp that this phone's popup (or Matt's row) was really on screen, or what was tapped. Best effort. */
export async function noteSeen(code, id, tap = null) {
  try {
    if (!writesAllowed('sign in seen')) return;
    const boot = await bootFn();
    if (!boot || !boot.uid) return;
    const { db, api, uid } = boot;
    const k = `${code}/${id}`;
    let prev = _seen.get(k);
    if (!prev) { try { prev = (await api.get(api.ref(db, `signIns/${code}/${id}/seen/${uid}`))).val(); } catch { prev = null; } }
    const next = nextSeen(prev, Date.now(), tap);
    _seen.set(k, next);
    await api.set(api.ref(db, `signIns/${code}/${id}/seen/${uid}`), next);
  } catch (err) { console.warn('[signin] seen stamp failed', err); }
}

/** Admin: every waiting request, any code: [{code, id, ...req}], newest first. signIns/ is tiny (a row a sign in). */
export async function readAllWaiting() {
  try {
    const boot = await bootFn();
    if (!boot) return [];
    const { db, api } = boot;
    const all = (await api.get(api.ref(db, 'signIns'))).val() || {};
    const now = nowS();
    const out = [];
    for (const code of Object.keys(all)) for (const r of waitingList(all[code], now)) out.push(Object.assign({ code }, r));
    return out.sort((a, b) => (+b.at || 0) - (+a.at || 0));
  } catch { return []; }
}

// --- the popup ----------------------------------------------------------------------------------------

const CSS = `
.sia-root{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overscroll-behavior:contain}
.sia-root .sia-scrim{position:absolute;inset:0;background:rgba(9,24,48,.62)}
.sia-root .sia-card{position:relative;box-sizing:border-box;width:calc(100% - 24px);max-width:420px;padding:22px 18px;border-radius:18px;background:#fff;color:#0f2540;box-shadow:0 16px 50px rgba(0,0,0,.45)}
.sia-root .sia-h{margin:0 0 10px;font-size:26px;font-weight:800;line-height:1.2;text-wrap:balance}
.sia-root .sia-dev{display:flex;gap:14px;align-items:center;margin:6px 0 22px}
.sia-root .sia-dev svg{flex:0 0 auto}
.sia-root .sia-dev b{display:block;font-size:19px;line-height:1.3}
.sia-root .sia-dev span{display:block;font-size:17px;font-weight:600;color:#3b4d66;margin-top:2px}
.sia-root .sia-row{display:flex;gap:10px}
.sia-root .sia-btn{flex:1 1 0;white-space:nowrap;padding:14px 10px;font:inherit;font-size:18px;font-weight:800;border-radius:12px;border:1px solid transparent;cursor:pointer;touch-action:manipulation}
.sia-root .sia-btn:disabled{opacity:.55}
.sia-root .sia-pri{background:#1769d4;color:#fff}
.sia-root .sia-gh{background:#eef2f9;color:#14202f;border-color:#d5deec}
.sia-root .sia-msg{margin:12px 0 0;font-size:17px;font-weight:600;text-align:center}
.sia-root .sia-msg:empty{display:none}
html.gh-dark .sia-root .sia-card{background:#18233a;color:#f2f6fb}
html.gh-dark .sia-root .sia-dev span{color:#d6e0ee}
html.gh-dark .sia-root .sia-gh{background:#24324a;color:#f2f6fb;border-color:#3a4b63}
`;
const PHONE_SVG = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';
function ensureCss() {
  if (document.querySelector('style[data-sia-css]')) return;
  const s = document.createElement('style');
  s.setAttribute('data-sia-css', '1');
  s.textContent = CSS;
  document.head.appendChild(s);
}

/**
 * Show "New sign in" for `req` ({id, device, at}). `onAnswer(allow)` must resolve { ok }. Returns
 * { el, close }. Exported for tools (screens) and for startSigninWatch.
 */
export function showSigninPopup(req, onAnswer) {
  ensureCss();
  const box = document.createElement('div');
  box.className = 'sia-root';
  box.innerHTML = `<div class="sia-scrim"></div>
    <div class="sia-card" role="dialog" aria-modal="true" aria-label="${esc(tx('si_new_title', 'New sign in'))}">
      <h2 class="sia-h">${esc(tx('si_new_title', 'New sign in'))}</h2>
      <div class="sia-dev">${PHONE_SVG}<div><b>${esc(req.device || tx('si_a_phone', 'A phone'))}</b><span>${esc(whenLine(+req.at || 0))}</span></div></div>
      <div class="sia-row"><button type="button" class="sia-btn sia-gh" data-a="deny">${esc(tx('si_deny', 'Deny'))}</button><button type="button" class="sia-btn sia-pri" data-a="allow">${esc(tx('si_allow', 'Allow'))}</button></div>
      <p class="sia-msg" role="status" aria-live="polite"></p>
    </div>`;
  document.body.appendChild(box);
  const msg = box.querySelector('.sia-msg');
  const btns = [...box.querySelectorAll('.sia-btn')];
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || b.disabled) return;
    btns.forEach((x) => { x.disabled = true; });
    msg.textContent = '';
    let r = null;
    try { r = await onAnswer(b.dataset.a === 'allow'); } catch { r = null; }
    if (!box.isConnected) return;
    if (r && r.ok) { box.remove(); return; }
    btns.forEach((x) => { x.disabled = false; });
    msg.textContent = tx('si_try_again', "Didn't send. Try again.");
  });
  return { el: box, close: () => box.remove() };
}

/**
 * Watch this phone's own code for waiting requests, and ask (THE CODE'S OTHER PHONES). Only when the code is in
 * the ask set and this phone's msgAuth really is that code. `cover(on)` lets the hub pause a mounted game.
 * Returns a stop function. Never throws.
 */
export function startSigninWatch({ cover } = {}) {
  let stopped = false, unsub = null, shown = null, code = '', unCfg = null, retried = false;
  const answered = new Set();
  const onVis = () => { if (shown && document.visibilityState === 'visible') noteSeen(code, shown.id); };
  const close = () => {
    if (!shown) return;
    shown.pop.close(); shown = null;
    try { if (cover) cover(false); } catch { /* fine */ }
  };
  const paint = (list) => {
    const now = nowS();
    const live = (list || []).filter((r) => !answered.has(r.id) && isWaiting(r, now));
    if (shown && !live.some((r) => r.id === shown.id)) close();
    if (shown || !live.length) return;
    const req = live[0];
    const pop = showSigninPopup(req, async (allow) => {
      noteSeen(code, req.id, allow ? 'allow' : 'deny');
      const r = await answerRequest(code, req.id, allow);
      if (r.ok) { answered.add(req.id); shown = null; try { if (cover) cover(false); } catch { /* fine */ } setTimeout(() => paint(lastList), 0); }
      return r;
    });
    shown = { id: req.id, pop };
    try { if (cover) cover(true); } catch { /* fine */ }
    if (document.visibilityState === 'visible') noteSeen(code, req.id);
  };
  let lastList = [];
  const begin = async () => {
    if (stopped || unsub) return;
    const p = loadProfile();
    code = (p && typeof p.playerId === 'string') ? p.playerId.trim().toUpperCase() : '';
    if (!code || !isSigninAsk(code)) return;
    try {
      const boot = await bootFn();
      if (!boot || !boot.uid || stopped) return;
      const { db, api, uid } = boot;
      const mine = (await api.get(api.ref(db, `msgAuth/${uid}`))).val();
      if (mine !== code) {
        // The claim may land a moment after paint (js/messages.js ensureAuthClaim): look once more, later.
        if (!retried) { retried = true; setTimeout(begin, 15000); }
        return;
      }
      if (stopped || unsub) return;
      startServerTime();
      const q = api.query(api.ref(db, `signIns/${code}`), api.orderByChild('state'), api.equalTo('waiting'));
      unsub = api.onValue(q, (s) => { lastList = waitingList(s && s.exists() ? s.val() : {}, nowS()); paint(lastList); },
        (err) => console.warn('[signin] watch failed', err));
      document.addEventListener('visibilitychange', onVis);
    } catch (err) { console.warn('[signin] could not watch sign ins', err); }
  };
  begin();
  // Matt can add this code to the ask set while the app is open.
  try { unCfg = onAdminConfig(() => begin()); } catch { unCfg = null; }
  // A waiting row lapses with no write: re-check the clock now and then while one is up.
  const tick = setInterval(() => { if (shown) paint(lastList); }, 30000);
  return () => {
    stopped = true;
    clearInterval(tick);
    if (unCfg) unCfg();
    if (unsub) unsub();
    document.removeEventListener('visibilitychange', onVis);
    close();
  };
}

export default { needsAllow, createRequest, watchMine, cancelRequest, confirmClaim, reportToMatt, answerRequest, noteSeen, readAllWaiting, startSigninWatch, showSigninPopup };
