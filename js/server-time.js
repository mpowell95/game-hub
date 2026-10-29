// server-time.js - THE SERVER'S CLOCK, for anything a phone's own clock must not decide (2026-10-29).
//
// Spelling Bee's "today" and its Yesterday's Answers sheet used new Date(): setting the phone a day
// ahead showed the full answer list for the REAL today. Firebase measures the gap between the phone
// and its servers on every connection (`.info/serverTimeOffset`); this module keeps it.
//
//   liveNow()    the server's time, measured on THIS page's connection (null until connected). Anchored
//                to performance.now() at each connection, so changing the phone clock mid-session moves
//                nothing. Use it for anything that must not be early (answers).
//   serverNow()  liveNow(), else the last measured gap (cached in localStorage, for offline), else null.
//   bestNow()    serverNow(), else the phone's clock. For "which puzzle is today".
//   whenLive(ms) resolves liveNow() once connected, or null after `ms`.
//   onLive(cb)   called each time a connection measures the gap; returns an unsubscribe.
//
// A REPORT of the network, never player data; the cache key is a preference-class value (rebuilt on
// the next connection). Offline with a changed phone clock the cached gap is wrong, which is why
// answers wait for liveNow().
import { getStatsApp } from './firebase-boot.js';

const KEY = 'gamehub.serverTime.v1';   // { o: offset ms, at: phone ms when measured }
let _offset = null;     // latest .info/serverTimeOffset value
let _anchor = null;     // { server, perf } at the last connection
let _started = false;
const _subs = new Set();

const perfNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function cached() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    // A phone clock now BEHIND the moment it was cached has been set back: the gap is stale.
    if (v && Number.isFinite(v.o) && Number.isFinite(v.at) && Date.now() >= v.at) return v.o;
  } catch { /* none */ }
  return null;
}

function anchor(offset) {
  _anchor = { server: Date.now() + offset, perf: perfNow() };
  try { localStorage.setItem(KEY, JSON.stringify({ o: offset, at: Date.now() })); } catch { /* this page only */ }
  for (const cb of [..._subs]) { try { cb(liveNow()); } catch (err) { console.error('[server-time] listener', err); } }
}

/** Start measuring (idempotent). Called by every reader, so nothing has to remember to. */
export function startServerTime() {
  if (_started) return;
  _started = true;
  getStatsApp().then((boot) => {
    if (!boot || !boot.api || typeof boot.api.onValue !== 'function') return;
    const { db, api } = boot;
    api.onValue(api.ref(db, '.info/serverTimeOffset'), (s) => {
      const v = Number(s && s.val());
      if (Number.isFinite(v)) _offset = v;
    });
    // Firebase sets the offset from the handshake BEFORE it reports connected, so each "connected"
    // carries a fresh measurement (firebase-boot reconnects after 20 s away: re-measured then too).
    api.onValue(api.ref(db, '.info/connected'), (s) => {
      if (s && s.val() === true && Number.isFinite(_offset)) anchor(_offset);
    });
  }).catch(() => { /* offline: cached gap or the phone clock */ });
}

export function liveNow() {
  startServerTime();
  return _anchor ? Math.round(_anchor.server + (perfNow() - _anchor.perf)) : null;
}

export function serverNow() {
  const l = liveNow();
  if (l != null) return l;
  const o = cached();
  return o == null ? null : Date.now() + o;
}

export function bestNow() {
  const s = serverNow();
  return s == null ? Date.now() : s;
}

export function onLive(cb) {
  startServerTime();
  _subs.add(cb);
  return () => _subs.delete(cb);
}

export function whenLive(ms = 4000) {
  const l = liveNow();
  if (l != null) return Promise.resolve(l);
  return new Promise((res) => {
    let off = null;
    const t = setTimeout(() => { if (off) off(); res(null); }, ms);
    off = onLive((v) => { clearTimeout(t); off(); res(v); });
  });
}

/** Tests only: pretend a connection measured `offset` (null = never connected). */
export function __setServerTimeForTest(offset) {
  _started = true;
  if (offset == null) { _anchor = null; _offset = null; return; }
  _offset = offset;
  anchor(offset);
}
