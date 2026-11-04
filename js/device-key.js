// js/device-key.js - this phone's DEVICE KEY for its player code (2026-11-04, Matt: privacy and
// security fixes, "Yes start on 1-3"). Server half and the whole story: functions/claim.js.
//
// STEP A (live, invisible): a phone that already holds its claim (msgAuth/<uid> === its code, see
// js/messages.js ensureAuthClaim) makes a random key, keeps it HERE (localStorage), and sends only its
// SHA-256 to the server (claimReq/<uid>, t 'reg'). Later (STEP B) a phone whose anonymous sign-in
// changed proves itself with the key instead of a PIN.
//
// Stored: gamehub.deviceKey.v1 = { <CODE>: { key, h, ok, at, sent } }. One entry per code this phone
// has played as; entries are added, never removed (a phone that switches player and back keeps its key).
// Best-effort: any failure leaves things as they were and is retried on a later load. Never throws.

import { automationBlocks } from './automation.js';

const KEY = 'gamehub.deviceKey.v1';
const RESEND_MS = 10 * 60 * 1000;
const CHECK_AFTER_MS = 8000;

function readAll() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function writeAll(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { return false; }
  // THE LAW rule 6: a key that did not land must not be reported to the server as this phone's.
  try { return localStorage.getItem(KEY) === JSON.stringify(v); } catch { return false; }
}

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(s) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
}
function newKey() { const b = new Uint8Array(32); crypto.getRandomValues(b); return hex(b); }

/** This phone's stored key for `code`, or null. */
export function keyFor(code) { const e = readAll()[code]; return e && e.key ? e : null; }

/** Mark ok if the server's answer is for this key. Returns true once registered. */
async function checkAnswer(boot, code) {
  const { db, api, uid } = boot;
  const snap = await api.get(api.ref(db, `claimRes/${uid}`));
  const res = snap && snap.exists() ? snap.val() : null;
  const all = readAll(), e = all[code];
  if (!e || !res || res.code !== code || res.h !== e.h) return false;
  if (!res.ok) { console.warn(`[device-key] the server did not register this phone's key for ${code}: ${res.why}`); return false; }
  e.ok = true; e.okAt = Date.now();
  writeAll(all);
  return true;
}

/**
 * Make sure this phone's key for `code` is registered. Call only after the phone's claim on `code`
 * succeeded. `mayWrite(what)` is the caller's write guard (dev origin, test automation).
 */
export async function ensureDeviceKey(boot, code, mayWrite) {
  try {
    if (!boot || !boot.uid || !code || typeof crypto === 'undefined' || !crypto.subtle) return false;
    let all = readAll();
    if (all[code] && all[code].ok) return true;
    if (!all[code] || !all[code].key) {
      const key = newKey();
      all[code] = { key, h: await sha256Hex(key), ok: false, at: Date.now(), sent: 0 };
      if (!writeAll(all)) return false;           // no local copy, no registration
    }
    if (await checkAnswer(boot, code)) return true;
    all = readAll();
    const e = all[code];
    if (Date.now() - (+e.sent || 0) < RESEND_MS) return false;
    if (automationBlocks('device key')) return false;   // js/automation.js
    if (typeof mayWrite === 'function' && !mayWrite('device key')) return false;
    const { db, api, uid } = boot;
    await api.set(api.ref(db, `claimReq/${uid}`), { t: 'reg', code, h: e.h, at: api.serverTimestamp() });
    e.sent = Date.now();
    writeAll(all);
    setTimeout(() => { checkAnswer(boot, code).catch(() => {}); }, CHECK_AFTER_MS);
    return false;
  } catch (err) {
    console.warn('[device-key] could not register this phone\'s key; will retry on a later load', err);
    return false;
  }
}
