// js/push.js - PUSH NOTIFICATIONS, the app's half (2026-09-23).
//
// Matt: "are you sure there's no way to have real notifications or something close to it?" ...
// "mostly iphone, installed. go with firebase."
//
// Three pieces, and this is one:
//   js/push.js      asks permission (on a TAP - iOS refuses otherwise), subscribes this device,
//                   and stores the subscription at pushSubs/<PLAYER CODE>/<key>.
//   functions/      a Firebase Cloud Function that watches the data and SENDS. It alone holds the
//                   private key; shipped in the app, anybody could push anything to everybody.
//   sw.js           shows the notification and opens the hub when it is tapped.
//
// ADDRESSED BY PLAYER CODE, never by deviceId - the Messages rule. Several people here have two
// phones; a push addressed to a device reaches one of them. Every device a player turns it on for
// gets its own key under their code, so all of them buzz.
//
// iPHONE: web push works ONLY in the Game Hub ADDED TO THE HOME SCREEN (iOS 16.4+). In a Safari
// tab `PushManager` does not exist at all, so pushState() says 'install' there instead of
// pretending the button can work.
//
// NOT PLAYER DATA. A subscription is a delivery address the player recreates with one tap; the
// function removes one the phone has dropped (404/410). THE LAW is about earned history.
import { getStatsApp } from './firebase-boot.js';
import { getLang } from './i18n.js';
import { myCode, ensureAuthClaim } from './messages.js';

// The PUBLIC half of the VAPID pair. functions/index.js holds the same string; the private half
// is a Firebase secret (VAPID_PRIVATE_KEY) and is not in this repo.
export const VAPID_PUBLIC_KEY = 'BH_JRWqpFFAVoohah0iW7rb3MqCm6koAqxkh-MjEOqCiAdOasw6UThw5nH_pLtP14Ea1mGObqrGlzaKUF4OtKCM';

// What this device last stored, so a hub load only writes when something actually changed.
const LOCAL_KEY = 'gamehub.push.v1';

// --- a dev server never writes to the family's database (same guard as js/messages.js) ---------
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function isDevOrigin() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
      || h.endsWith('.localhost');
  } catch { return false; }
}
function writesAllowed(what) {
  if (!isDevOrigin()) return true;
  try { if (localStorage.getItem(DEV_SYNC_OK) === '1') return true; } catch { /* fall through */ }
  console.warn(`[push] ${what} BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}

function isIOS() {
  try {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch { return false; }
}
function isStandalone() {
  try {
    return navigator.standalone === true
      || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  } catch { return false; }
}
export function pushSupported() {
  try { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  catch { return false; }
}

function b64urlToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A stable, path-safe key for one subscription: a hash of its endpoint. */
export async function subKey(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(endpoint)));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function registration() {
  try { return await navigator.serviceWorker.ready; } catch { return null; }
}

/**
 * Where this device stands. One of:
 *   'unsupported'  no web push in this browser at all
 *   'install'      an iPhone in a Safari tab: add to Home Screen first
 *   'no-code'      no player code yet (the name gate has not run)
 *   'denied'       the player said no; only the phone's Settings can undo that
 *   'on' | 'off'
 */
export async function pushState() {
  if (isIOS() && !isStandalone()) return 'install';
  if (!pushSupported()) return 'unsupported';
  if (!myCode()) return 'no-code';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await registration();
  const sub = reg && await reg.pushManager.getSubscription().catch(() => null);
  return sub ? 'on' : 'off';
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch { return null; }
}
function writeLocal(v) {
  try { if (v) localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); else localStorage.removeItem(LOCAL_KEY); }
  catch { /* the next load simply writes again */ }
}

/** Store `sub` under this player's code, verified by a fresh re-read (THE LAW rule 6's shape). */
async function save(sub) {
  const me = myCode();
  if (!me || !sub) return { ok: false, reason: 'no-code' };
  if (!writesAllowed('push subscribe')) return { ok: false, reason: 'dev-origin-blocked' };
  const boot = await getStatsApp().catch(() => null);
  if (!boot) return { ok: false, reason: 'offline' };
  await ensureAuthClaim(boot);
  const json = sub.toJSON();
  const key = await subKey(json.endpoint);
  const lang = getLang() === 'es' ? 'es' : 'en';
  const rec = { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    lang, at: Date.now(), ios: isIOS() };
  const { db, api } = boot;
  try {
    await api.set(api.ref(db, `pushSubs/${me}/${key}`), rec);
    const back = await api.get(api.ref(db, `pushSubs/${me}/${key}`));
    if (!back || !back.exists() || back.val().endpoint !== rec.endpoint) {
      console.error(`[push] subscription VERIFY FAILED for pushSubs/${me}/${key}`);
      return { ok: false, reason: 'did-not-land' };
    }
  } catch (err) {
    console.error('[push] could not store the subscription', err);
    return { ok: false, reason: 'denied' };
  }
  writeLocal({ code: me, key, endpoint: rec.endpoint, lang });
  return { ok: true };
}

/**
 * TURN IT ON. Must be called from a tap: iOS only shows the permission prompt for a user gesture,
 * so the permission request is the FIRST thing that happens, before any await that could lose it.
 */
export async function enablePush() {
  if (isIOS() && !isStandalone()) return { ok: false, reason: 'install' };
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  let perm;
  try { perm = await Notification.requestPermission(); } catch { perm = Notification.permission; }
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
  const reg = await registration();
  if (!reg) return { ok: false, reason: 'no-worker' };
  let sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) {
    try {
      // BOUNDED: subscribe waits on the phone's push service, and with no signal it can wait for
      // ever. A button that never answers reads as broken; one that says "try again" does not.
      sub = await Promise.race([
        reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC_KEY) }),
        new Promise((_, no) => setTimeout(() => no(new Error('push service did not answer in 20s')), 20000)),
      ]);
    } catch (err) {
      console.error('[push] subscribe failed', err);
      return { ok: false, reason: 'subscribe-failed' };
    }
  }
  return save(sub);
}

/** TURN IT OFF on this device: drop the subscription and its stored address. */
export async function disablePush() {
  const reg = pushSupported() ? await registration() : null;
  const sub = reg && await reg.pushManager.getSubscription().catch(() => null);
  const me = myCode();
  if (sub) {
    const key = await subKey(sub.endpoint);
    try {
      const boot = await getStatsApp();
      if (boot && me && writesAllowed('push unsubscribe')) {
        await ensureAuthClaim(boot);
        await boot.api.remove(boot.api.ref(boot.db, `pushSubs/${me}/${key}`));
      }
    } catch (err) { console.warn('[push] could not remove the stored subscription', err); }
    try { await sub.unsubscribe(); } catch { /* already gone */ }
  }
  writeLocal(null);
  return { ok: true };
}

/**
 * ON EVERY HUB LOAD, quietly: if this device has notifications on, make sure the stored address is
 * current - the phone can rotate its subscription, the player can switch code or language. Writes
 * only when something differs from what was last stored. Never prompts, never throws.
 */
export async function refreshPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted' || !myCode()) return;
    const reg = await registration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    const was = readLocal();
    const lang = getLang() === 'es' ? 'es' : 'en';
    if (was && was.code === myCode() && was.endpoint === sub.endpoint && was.lang === lang) return;
    await save(sub);
  } catch (err) {
    console.warn('[push] refresh failed', err);
  }
}
