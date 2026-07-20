// net.js - multiplayer room sync (M1 lockstep pilot). Mirrors stats-net.js's
// structure and reuses its NAMED Firebase app ('stats') so this coexists with
// the challenge's DEFAULT app on the admin device without an "app already
// exists" clash, and so a stats-net.js load elsewhere on the page never
// double-inits the same named app.
//
// Scope discipline: every write in this module targets rooms/<CODE> ONLY.
// Never players/, usernames/, challenge/, selfies/, or flight/. Fully
// guarded: if firebase-config.js is unconfigured, the SDK fails to load, or
// the device is offline, init() returns false and callers see an explicit
// error/throw (no silent retries or write queues in M1).
//
// The named app + auth are booted through js/firebase-boot.js, shared with stats-net.js, so there
// is only ever one initializeApp('stats') call on the page (see firebase-boot.js for why).

import { getStatsApp } from './firebase-boot.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 10000;

let _db = null, _api = null;
let _unsubRoom = null, _heartbeatTimer = null;

/** Ensure the shared named Firebase app + anonymous auth are ready. Idempotent. */
export async function init() {
  const r = await getStatsApp();
  if (!r) return false;
  _db = r.db; _api = r.api;
  return true;
}

function randomCode() {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return s;
}

const roomRef = (code) => _api.ref(_db, 'rooms/' + code);

/** 'game-hub-v108' -> 'v108' (null passes through). Mirrors hub.js's _shortVersion. */
function shortVersion(cache) {
  const m = /game-hub-(v\d+)/.exec(cache || '');
  return m ? m[1] : null;
}

/** Ask the active service worker which cache version it runs, via the same
 *  GET_VERSION message protocol as the hub's version pill (hub.js). Never
 *  blocks room creation on this: falls back to 'unknown'. */
function getSwVersion() {
  return new Promise((resolve) => {
    try {
      const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!ctrl) { resolve('unknown'); return; }
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve('unknown'), 1500);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(shortVersion(e.data && e.data.cache) || 'unknown'); };
      ctrl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    } catch { resolve('unknown'); }
  });
}

/** Create a room for `game` with `config`, hosted by `me` = {name, avatar, deviceId}. */
export async function createRoom(game, config, me) {
  if (!(await init())) return { error: 'offline' };
  const swv = await getSwVersion();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      const snap = await _api.get(roomRef(code));
      const existing = snap.val();
      const now = Date.now();
      const fresh = existing && (now - (existing.updated || 0)) < ROOM_TTL_MS;
      if (fresh) continue;   // occupied and not stale enough to reclaim: try another code
      const room = {
        v: 1, game, swv, created: now, updated: now, status: 'waiting',
        config, host: { ...me, lastSeen: now }, guest: null,
        round: null, moves: null, recovery: null, result: null,
      };
      await _api.set(roomRef(code), room);
      return { code };
    } catch { /* transient failure on this code: try the next one */ }
  }
  return { error: 'busy' };
}

/** Join (or rejoin) `code` as `me` = {name, avatar, deviceId}. */
export async function joinRoom(code, me) {
  if (!(await init())) return { error: 'offline' };
  const CODE = String(code || '').trim().toUpperCase();
  try {
    const snap = await _api.get(roomRef(CODE));
    const room = snap.val();
    const now = Date.now();
    if (!room || room.status === 'ended' || (now - (room.updated || 0)) > ROOM_TTL_MS) return { error: 'not-found' };
    if (room.v !== 1) return { error: 'version' };
    // Mid-deploy desync guard (S4-5/S5-9): the host's swv was already recorded at createRoom via
    // the same GET_VERSION read. A joiner on a different SW build would lockstep a different
    // build's state shape against the host's and hash-mismatch into the recovery loop instead of
    // a clean "update required" message. 'unknown' on either side (no active controller yet, or
    // the postMessage round-trip timed out) is never treated as a mismatch - this check must
    // never block a join it can't actually verify.
    const mySwv = await getSwVersion();
    if (room.swv && room.swv !== 'unknown' && mySwv !== 'unknown' && room.swv !== mySwv) {
      return { error: 'version' };
    }
    if (room.swv === 'unknown' || mySwv === 'unknown') {
      console.warn('[net] joinRoom: sw version unknown on host or guest, allowing join without a version check', { roomSwv: room.swv, mySwv });
    }
    const rejoined = !!(room.guest && room.guest.deviceId === me.deviceId);
    if (room.guest && !rejoined) return { error: 'full' };
    await _api.update(roomRef(CODE), { guest: { ...me, lastSeen: now }, updated: now });
    const fresh = await _api.get(roomRef(CODE));
    return { ok: true, room: fresh.val(), rejoined };
  } catch { return { error: 'offline' }; }
}

/** Host only: publish the round's deck order + dealer, reset the move log. */
export async function startRound(code, n, deckOrder, dealer) {
  if (!(await init())) throw new Error('net offline');
  await _api.update(roomRef(code), {
    round: { n, deck: deckOrder, dealer }, moves: null, recovery: null,
    status: 'active', updated: Date.now(),
  });
}

/** Append one lockstep move. `seq` is the shared, strictly-increasing index
 *  for the current round's move log (both players write into the same log). */
export async function appendMove(code, by, seq, move, hash) {
  if (!(await init())) throw new Error('net offline');
  const key = String(seq).padStart(4, '0');
  await _api.set(_api.ref(_db, `rooms/${code}/moves/${key}`), { by, seq, move, h: hash });
  await _api.update(roomRef(code), { updated: Date.now() });
}

/** Host only: publish the concluded match's outcome. */
export async function writeResult(code, result) {
  if (!(await init())) throw new Error('net offline');
  await _api.update(roomRef(code), { result, status: 'ended', updated: Date.now() });
}

/** Host only: publish a full-state recovery snapshot after a hash mismatch. */
export async function writeRecovery(code, seq, snapshot) {
  if (!(await init())) throw new Error('net offline');
  await _api.update(roomRef(code), { recovery: { state: snapshot, seq, at: Date.now() }, updated: Date.now() });
}

/** Guest side of a mismatch: flags the desync for the host to notice and
 *  respond with writeRecovery (M1 simplification: no direct push channel). */
export async function requestRecovery(code, seq) {
  if (!(await init())) throw new Error('net offline');
  await _api.update(roomRef(code), { recovery: { requested: seq, at: Date.now() }, updated: Date.now() });
}

export async function clearRecovery(code) {
  if (!(await init())) throw new Error('net offline');
  await _api.update(roomRef(code), { recovery: null, updated: Date.now() });
}

/** One onValue on rooms/CODE for the whole module (at most one at a time -
 *  attaching a new one detaches any prior). Returns the unsubscribe fn. */
export async function onRoom(code, cb) {
  if (!(await init())) return () => {};
  if (_unsubRoom) { _unsubRoom(); _unsubRoom = null; }
  const r = roomRef(code);
  const stop = _api.onValue(r, (snap) => cb(snap.val()));   // onValue returns its own unsubscribe fn
  _unsubRoom = () => { try { stop(); } catch { /* already detached */ } };
  return _unsubRoom;
}

/** Presence ping every ~10s: updates <role>/lastSeen so the peer can detect a
 *  stale opponent. Replaces any prior interval (one heartbeat at a time). */
export function heartbeat(code, role) {
  stopHeartbeat();
  _heartbeatTimer = setInterval(() => {
    if (!_api || !_db) return;
    _api.update(roomRef(code), { [`${role}/lastSeen`]: Date.now(), updated: Date.now() }).catch(() => {});
  }, HEARTBEAT_MS);
}

export function stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

/** Explicit abandon: mark the room ended, then detach everything. */
export async function leaveRoom(code, role) {
  try { if (await init()) await _api.update(roomRef(code), { status: 'ended', updated: Date.now() }); }
  finally { disconnect(); }
}

/** Synchronous teardown: unsubscribe onValue, clear the heartbeat, reset
 *  module state. Safe to call any time, including when nothing is active. */
export function disconnect() {
  if (_unsubRoom) { _unsubRoom(); _unsubRoom = null; }
  stopHeartbeat();
}

export default {
  init, createRoom, joinRoom, startRound, appendMove, writeResult,
  writeRecovery, requestRecovery, clearRecovery,
  onRoom, heartbeat, stopHeartbeat, leaveRoom, disconnect,
};
