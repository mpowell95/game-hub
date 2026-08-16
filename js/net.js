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
const MAX_SEATS = 8;

// --- N-SEAT ROOMS (2026-07-28, Chinchón 3-4 player MP) --------------------
//
// Every function below that mentions a SEAT is an ADDITIVE extension. This
// module shipped as a strictly 2-seat protocol (`host` + `guest`) and eight
// games are built on that shape; `js/CLAUDE.md`'s Tic Tac Toe section called
// the N-player extension "phase 3 and separate work". This is that phase.
//
// The contract for every change here: **omit the seat argument and you get
// today's byte-identical behaviour.** An N-seat room is opted into at
// createRoom (`opts.seats`), which adds two NEW sibling fields, `seats` and
// `maxSeats`, and leaves `host`/`guest` populated exactly as before (seat 0
// mirrors to `host`, seat 1 to `guest`) so a room is still legible to the
// 2-seat readers in every other game. No existing signature changed meaning,
// so escoba/, tic-tac-toe/, mancala/, filler/, dots-boxes/, pool/
// and boggle/ needed zero edits for this.
//
// Two genuine 3+-seat CORRECTNESS problems are fixed here, neither of which
// could occur with two seats:
//
//   1. Seat claiming must be TRANSACTIONAL. joinRoom() below does a `get`
//      then an `update`, which is safe when there is exactly one seat to win
//      but hands two simultaneous joiners the same index once there are
//      three. joinSeat() claims through runTransaction instead and then
//      re-reads the committed roster to find where it actually landed,
//      rather than trusting the updater's last-run local variable.
//   2. `recovery` was ONE shared field carrying two different shapes -- the
//      host's answer `{state, seq}` and a guest's plea `{requested}` -- which
//      simply overwrite each other. With one guest that is harmless (the two
//      never race meaningfully). With three, guest B's request clobbers the
//      host's answer before guest A has read it, so guest A never resyncs and
//      burns its three-attempt budget straight into "Connection error" -- and
//      recovery is the safety net every other MP guarantee sits on top of.
//      Seat-addressed callers now use `recovery/requests/<seat>` and
//      `recovery/answers/<seat>`, which cannot collide by construction.
//
// Deliberately NOT changed: leaveRoom() still ends the room for everyone. A
// player dropping out mid-match ends the match for the whole table (see
// chinchon/CLAUDE.md) -- Chinchón's engine has no way to remove a seat from a
// live match without every other device diverging, and inventing one is a
// rules change, not a networking change. vacateSeat() below is the LOBBY-only
// counterpart: it frees a seat of someone who backed out before the match
// started, without killing the room the others are still sitting in.

/** localStorage-free seat->path helper. A numeric seat addresses the new
 *  `seats/<n>` roster; a legacy 'host'/'guest' string passes straight
 *  through, so every pre-existing caller keeps writing where it always did. */
function seatPath(seatOrRole) {
  return typeof seatOrRole === 'number' ? `seats/${seatOrRole}` : seatOrRole;
}

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

/** Create a room for `game` with `config`, hosted by `me` = {name, avatar, deviceId}.
 *  `opts.seats` (2-8) opts into an N-SEAT room: `seats`/`maxSeats` are written
 *  alongside the unchanged `host`/`guest` fields, and the returned result also
 *  carries the host's own seat (always 0). Omit `opts` for a classic 2-seat
 *  room -- the written record is then byte-identical to what this always wrote. */
export async function createRoom(game, config, me, opts) {
  if (!(await init())) return { error: 'offline' };
  const want = opts && opts.seats ? Math.max(2, Math.min(MAX_SEATS, opts.seats | 0)) : 0;
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
      if (want) {
        room.maxSeats = want;
        room.seats = { 0: { ...me, lastSeen: now } };
      }
      await _api.set(roomRef(code), room);
      return { code, seat: want ? 0 : null };
    } catch { /* transient failure on this code: try the next one */ }
  }
  return { error: 'busy' };
}

/** Shared joinability gate for joinRoom/joinSeat: reads the room and returns
 *  either `{ error }` or `{ room }`. Factored out so the two join paths can
 *  never drift on the TTL / protocol-version / service-worker-version rules.
 *
 *  Mid-deploy desync guard (S4-5/S5-9): the host's swv was already recorded at
 *  createRoom via the same GET_VERSION read. A joiner on a different SW build
 *  would lockstep a different build's state shape against the host's and
 *  hash-mismatch into the recovery loop instead of a clean "update required"
 *  message. 'unknown' on either side (no active controller yet, or the
 *  postMessage round-trip timed out) is never treated as a mismatch - this
 *  check must never block a join it can't actually verify. */
async function readJoinableRoom(CODE, label) {
  const snap = await _api.get(roomRef(CODE));
  const room = snap.val();
  const now = Date.now();
  if (!room || room.status === 'ended' || (now - (room.updated || 0)) > ROOM_TTL_MS) return { error: 'not-found' };
  if (room.v !== 1) return { error: 'version' };
  const mySwv = await getSwVersion();
  if (room.swv && room.swv !== 'unknown' && mySwv !== 'unknown' && room.swv !== mySwv) {
    return { error: 'version' };
  }
  if (room.swv === 'unknown' || mySwv === 'unknown') {
    console.warn(`[net] ${label}: sw version unknown on host or joiner, allowing join without a version check`, { roomSwv: room.swv, mySwv });
  }
  return { room };
}

/** Join (or rejoin) `code` as `me` = {name, avatar, deviceId}. The classic
 *  2-seat path, unchanged: one guest slot, first-come. */
export async function joinRoom(code, me) {
  if (!(await init())) return { error: 'offline' };
  const CODE = String(code || '').trim().toUpperCase();
  try {
    const gate = await readJoinableRoom(CODE, 'joinRoom');
    if (gate.error) return { error: gate.error };
    const room = gate.room;
    const now = Date.now();
    const rejoined = !!(room.guest && room.guest.deviceId === me.deviceId);
    if (room.guest && !rejoined) return { error: 'full' };
    await _api.update(roomRef(CODE), { guest: { ...me, lastSeen: now }, updated: now });
    const fresh = await _api.get(roomRef(CODE));
    return { ok: true, room: fresh.val(), rejoined };
  } catch { return { error: 'offline' }; }
}

/** N-seat join (or rejoin): claim the lowest free seat in an `opts.seats` room.
 *  Returns `{ ok, seat, rejoined, room }` or `{ error }`.
 *
 *  The claim goes through runTransaction because, unlike the single-guest slot
 *  above, three people can be racing for two free indices -- a `get`-then-
 *  `update` hands two of them the same seat, and two devices holding the same
 *  engine player id diverge on the very first move with no way back. The
 *  committed roster is then re-read to find where this device ACTUALLY landed
 *  rather than trusting the updater closure's last-run local: runTransaction
 *  may invoke the updater several times, and reading the result is the only
 *  statement of fact about the outcome.
 *
 *  A room created WITHOUT `opts.seats` has no roster to claim, so it is
 *  reported as 'version' (the caller is a newer build than the room). */
export async function joinSeat(code, me) {
  if (!(await init())) return { error: 'offline' };
  const CODE = String(code || '').trim().toUpperCase();
  try {
    const gate = await readJoinableRoom(CODE, 'joinSeat');
    if (gate.error) return { error: gate.error };
    const room = gate.room;
    const maxSeats = room.maxSeats | 0;
    if (!maxSeats) return { error: 'version' };

    const res = await _api.runTransaction(_api.ref(_db, `rooms/${CODE}/seats`), (seats) => {
      const s = seats || {};
      for (let i = 0; i < maxSeats; i++) {
        if (s[i] && s[i].deviceId === me.deviceId) { s[i] = { ...me, lastSeen: Date.now() }; return s; }
      }
      for (let i = 1; i < maxSeats; i++) {
        if (!s[i]) { s[i] = { ...me, lastSeen: Date.now() }; return s; }
      }
      return undefined;   // every seat taken by someone else: abort, no write
    });
    if (!res || !res.committed) return { error: 'full' };

    const finalSeats = (res.snapshot && res.snapshot.val()) || {};
    let seat = -1;
    for (let i = 0; i < maxSeats; i++) {
      if (finalSeats[i] && finalSeats[i].deviceId === me.deviceId) { seat = i; break; }
    }
    if (seat < 0) return { error: 'full' };
    const rejoined = !!(room.seats && room.seats[seat] && room.seats[seat].deviceId === me.deviceId);

    // Mirror seat 1 into the legacy `guest` field so an N-seat room stays
    // legible to anything still reading the 2-seat shape.
    const now = Date.now();
    const patch = { updated: now };
    if (seat === 1) patch.guest = { ...me, lastSeen: now };
    await _api.update(roomRef(CODE), patch);
    const fresh = await _api.get(roomRef(CODE));
    return { ok: true, seat, rejoined, room: fresh.val() };
  } catch { return { error: 'offline' }; }
}

/** LOBBY-only seat release: free `seat` without ending the room, for a player
 *  who backed out before the match started. Never call this for seat 0 (the
 *  host abandoning IS the room ending -- use leaveRoom) and never mid-match,
 *  where a departure ends the match for the whole table by design. */
export async function vacateSeat(code, seat) {
  if (!(await init())) return;
  const now = Date.now();
  const patch = { [`seats/${seat}`]: null, updated: now };
  if (seat === 1) patch.guest = null;
  try { await _api.update(roomRef(code), patch); } catch { /* best-effort; the TTL reclaims it anyway */ }
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

/** EITHER peer: publish its OWN finished round's result, under `<role>Result`
 *  (`hostResult`/`guestResult`, both siblings of `result` above, never
 *  overwriting it). Added for Boggle (2026-07-28) -- see js/CLAUDE.md's
 *  "Nth consumer: Boggle" section for the full reasoning, in short: a Boggle
 *  round is a simultaneous, independent sprint with no shared mutable state
 *  during play (no move by one side can affect the other's board), so there
 *  is nothing to lockstep and no single side is authoritative over "the"
 *  result the way a host is in every other game here. `writeResult` does not
 *  fit for two reasons: it is documented host-only (a bare host call would
 *  silently drop the guest's own outcome), and it sets `status:'ended'`,
 *  which this room must NOT do mid-series (status:'ended' means "abandoned"
 *  everywhere else in this file). Both sides call this independently after
 *  their own local timer ends; the caller is expected to embed a round
 *  number in `result` so a stale prior round's entry can never be mistaken
 *  for the current one once a rematch overwrites it. Scope discipline is
 *  unchanged: still `rooms/<CODE>` only. */
export async function reportRoundResult(code, role, result) {
  if (!(await init())) throw new Error('net offline');
  if (role !== 'host' && role !== 'guest') throw new Error('reportRoundResult: bad role');
  await _api.update(roomRef(code), { [`${role}Result`]: { ...result, at: Date.now() }, updated: Date.now() });
}

/** ANY seat: fire a quick-chat reaction into the room under the sender's OWN slot
 *  (`rooms/<CODE>/reactions/<seatKey>`). Ephemeral and per-seat by design: a new
 *  reaction OVERWRITES the sender's previous one, so the node is bounded (at most one
 *  entry per seat) and never needs pruning -- the opposite of the seq-keyed move log.
 *  `payload` is the tiny { t, v } shape from js/mp-reactions.js (an emoji, a preset
 *  phrase id, or a short custom string); the receiver resolves it to display text in
 *  its own language. Writing the child is enough to wake every peer's onRoom, so there
 *  is no `updated` bump here (the heartbeat keeps the room's TTL fresh anyway). Fully
 *  best-effort: a dropped reaction is never worth surfacing. Scope discipline unchanged:
 *  `rooms/<CODE>` only. */
export async function sendReaction(code, seatKey, payload) {
  if (!code || seatKey == null || !payload || (payload.t !== 'e' && payload.t !== 'p' && payload.t !== 'c')) return;
  if (!(await init())) return;
  const slot = String(seatKey).replace(/[.#$/[\]]/g, '_');   // RTDB keys can't contain . # $ / [ ]
  const v = String(payload.v == null ? '' : payload.v).slice(0, 40);
  if (!v) return;
  try {
    await _api.set(_api.ref(_db, `rooms/${code}/reactions/${slot}`), { t: payload.t, v, at: Date.now() });
  } catch { /* best-effort: a reaction that fails to send is never worth an error */ }
}

/** Host only: publish a full-state recovery snapshot after a hash mismatch.
 *  With `seat` given, the snapshot is addressed to THAT seat
 *  (`recovery/answers/<seat>`) and retires that seat's outstanding request in
 *  the same write; without it, the legacy single shared `recovery` field is
 *  written exactly as before. Addressing matters for two reasons once there is
 *  more than one guest: a healthy guest must not tear down and rebuild its
 *  live game from a snapshot meant for someone else, and two answers written
 *  back-to-back must not overwrite each other before their recipients read
 *  them. */
export async function writeRecovery(code, seq, snapshot, seat) {
  if (!(await init())) throw new Error('net offline');
  const at = Date.now();
  if (seat == null) {
    await _api.update(roomRef(code), { recovery: { state: snapshot, seq, at }, updated: at });
    return;
  }
  await _api.update(roomRef(code), {
    [`recovery/answers/${seat}`]: { state: snapshot, seq, at },
    [`recovery/requests/${seat}`]: null,
    updated: at,
  });
}

/** Guest side of a mismatch: flags the desync for the host to notice and
 *  respond with writeRecovery (M1 simplification: no direct push channel).
 *  With `seat` given, the plea goes to this seat's OWN child
 *  (`recovery/requests/<seat>`) instead of the shared field, so it cannot
 *  clobber another seat's pending answer. */
export async function requestRecovery(code, seq, seat) {
  if (!(await init())) throw new Error('net offline');
  const at = Date.now();
  if (seat == null) {
    await _api.update(roomRef(code), { recovery: { requested: seq, at }, updated: at });
    return;
  }
  await _api.update(roomRef(code), { [`recovery/requests/${seat}`]: { seq, at }, updated: at });
}

/** Clear the whole shared recovery field (no seat), or just one seat's
 *  answer+request (seat given). RTDB prunes `recovery` itself once its last
 *  child is nulled, so a settled N-seat room ends up with no recovery node at
 *  all, same as the 2-seat path. */
export async function clearRecovery(code, seat) {
  if (!(await init())) throw new Error('net offline');
  const now = Date.now();
  if (seat == null) {
    await _api.update(roomRef(code), { recovery: null, updated: now });
    return;
  }
  await _api.update(roomRef(code), {
    [`recovery/answers/${seat}`]: null,
    [`recovery/requests/${seat}`]: null,
    updated: now,
  });
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

/** Presence ping every ~10s: updates <role>/lastSeen so peers can detect a
 *  stale player. Replaces any prior interval (one heartbeat at a time).
 *  `role` is either a legacy 'host'/'guest' string or a numeric seat; seats 0
 *  and 1 additionally keep the legacy `host`/`guest` stamps fresh so an
 *  N-seat room's staleness is readable both ways. */
export function heartbeat(code, role) {
  stopHeartbeat();
  const path = seatPath(role);
  _heartbeatTimer = setInterval(() => {
    if (!_api || !_db) return;
    const now = Date.now();
    const patch = { [`${path}/lastSeen`]: now, updated: now };
    if (role === 0) patch['host/lastSeen'] = now;
    else if (role === 1) patch['guest/lastSeen'] = now;
    _api.update(roomRef(code), patch).catch(() => {});
  }, HEARTBEAT_MS);
}

export function stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

/** Explicit abandon: mark the room ended, then detach everything. This ends
 *  the room for EVERY seat, N-seat rooms included -- see the N-SEAT ROOMS note
 *  at the top of this file for why a mid-match departure deliberately ends the
 *  match for the whole table, and vacateSeat() for the lobby-only counterpart. */
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
  init, createRoom, joinRoom, joinSeat, vacateSeat, startRound, appendMove, writeResult, reportRoundResult,
  sendReaction, writeRecovery, requestRecovery, clearRecovery,
  onRoom, heartbeat, stopHeartbeat, leaveRoom, disconnect,
};
