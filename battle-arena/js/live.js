// battle-arena/js/live.js - BATTLE ARENA LIVE ROOMS (2026-10-24): both players in the match at once,
// over js/net.js (`rooms/<CODE>`), the way Chinchón's live rooms work. No DOM: online-ui.js draws it.
//
// THE ROOM. The host drafts, then creates a room (a 4-letter code to share); the guest types the
// code, drafts, and joins with their team on their seat record (`guest.team`). The host then
// publishes the match: `round.deck = { seed, a, b }` (the seed and both teams), `round.dealer = 0`
// (THE HOST MOVES FIRST). From there it is LOCKSTEP like every live game here (js/CLAUDE.md,
// "Multiplayer lockstep - invariants"): `moves/<seq>` = { by: 0|1, seq, move: <online.js entry>, h },
// one per move, written by the player who made it; `h` is the FNV-1a hash of the whole match after
// it, which the other phone checks after replaying it. engine.js is deterministic, so a mismatch
// means a bug: the guest asks (`requestRecovery`) and the host answers with its state
// (`writeRecovery`), which the guest adopts.
//
// THE MOVE CLOCK is 25 s per move, reset after every move (ui.js `timed`); at 0 the mover's own phone
// writes a pass ({ k: 'p' }). Only the mover's phone ever writes the mover's moves.
//
// LEAVING IS RESIGNING: the menu's Resign writes { k: 'r' } (the other person wins) before the room is
// left. Closing the app is NOT leaving: the room code is kept in `gamehub.battlearena.room.v1` (a
// convenience, removed when the match is over) and the next mount rejoins and replays the moves.
// A player whose phone has been silent for a while (no 10 s heartbeat) can be resigned for by the
// other ("Claim win", CLAIM_MS), which writes the same { k: 'r' } for them.
//
// RESULTS: `recordResult('battlearena', 'mp', won)` + `recordHeadToHead('battlearena', opponent, won)`
// (the live rooms' Records, js/mp-records.js), once per match per phone (LIVE_LEDGER).
import { recordResult, recordHeadToHead, deviceId } from '../../js/game-stats.js';
import { loadProfile } from '../../js/profile-store.js';
import { cleanTeam, cleanEntry, moveOf, startState, stateHash, freshSeed, sideOfSeat } from './online.js';
import * as E from './engine.js';
import NET from '../../js/net.js';
import * as LL from '../../js/live-leave.js';

export const ROOM_KEY = 'gamehub.battlearena.room.v1';
const LIVE_LEDGER = 'gamehub.battlearena.liveCounted.v1';
export const GAME = 'battlearena';
export const STALE_MS = 30000;        // no heartbeat for this long: shown as away
export const CLAIM_MS = 90000;        // ...and for this long: the other may claim the win

function readJSON(store, k) { try { return JSON.parse(store.getItem(k) || 'null'); } catch { return null; } }
function writeJSON(store, k, v) { try { store.setItem(k, JSON.stringify(v)); } catch (err) { console.warn('[battle-arena] could not save', k, err); } }

export function readRoomSave() {
  const v = readJSON(localStorage, ROOM_KEY);
  return v && /^[A-Z0-9]{3,8}$/.test(String(v.code || '')) && (v.seat === 0 || v.seat === 1) ? v : null;
}
export function clearRoomSave() { try { localStorage.removeItem(ROOM_KEY); } catch { /* private mode */ } }

/** Record a finished live match on this phone, once (THE LAW rule 2). `llKey` (2026-10-29): the same
 *  match in js/live-leave.js's ledger, so a loss already settled from an armed leave is not counted
 *  again, and a counted match drops its armed leave. */
export function countLive(key, won, opp, llKey) {
  const done = readJSON(localStorage, LIVE_LEDGER);
  const list = Array.isArray(done) ? done.filter((x) => typeof x === 'string') : [];
  if (list.includes(key)) return false;
  list.push(key);
  writeJSON(localStorage, LIVE_LEDGER, list.slice(-200));
  if (llKey && LL.alreadyCounted(llKey)) return false;
  if (llKey) LL.endedNormally(GAME, llKey);
  try { recordResult(GAME, 'mp', !!won); } catch (err) { console.error('[battle-arena] recordResult failed', err); }
  if (opp && opp.deviceId) { try { recordHeadToHead(GAME, { deviceId: opp.deviceId, name: opp.name || '' }, !!won); } catch { /* never block the result */ } }
  return true;
}

/** The moves stored in a room, in seq order, cleaned. Stops at the first gap. */
export function movesOf(room) {
  const raw = (room && room.moves) || {};
  const list = Object.keys(raw).map((k) => raw[k]).filter((m) => m && Number.isInteger(m.seq)).sort((x, y) => x.seq - y.seq);
  const out = [];
  for (const m of list) {
    if (m.seq !== out.length) break;
    const e = cleanEntry(m.move, { pass: true, resign: true });
    if (!e) break;
    out.push({ seq: m.seq, entry: e, h: m.h || null });
  }
  return out;
}

/** The match a room's round describes (stored frame), or null. */
export function matchOf(room) {
  const d = room && room.round && room.round.deck;
  if (!d) return null;
  const a = cleanTeam(d.a), b = cleanTeam(d.b);
  const seed = Number(d.seed);
  if (!a || !b || !Number.isInteger(seed) || seed < 1) return null;
  return { seed, a, b, first: room.round.dealer === 1 ? 1 : 0 };
}

/**
 * One live room, from this phone's side. Callbacks (all optional):
 *   onLobby(room)            the room changed before the match started
 *   onStart(canon, entries)  the match exists: its first state and the moves already made (a rejoin)
 *   onMove(entry)            the OTHER player's move (or resignation), in order, after it is checked
 *   onResync(canon)          the phones disagreed; this is the host's state
 *   onPresence(awayMs)       how long the other player's phone has been silent
 *   onEnded(why)             the room ended before the match did ('left' | 'gone')
 */
export class LiveRoom {
  constructor(net, cb = {}) {
    this.net = net || NET;               // tools/test-battlearena-mp.mjs hands in a stand-in
    this.cb = cb;
    this.code = null;
    this.seat = null;
    this.team = null;
    this.match = null;      // { seed, a, b, first }
    this.canon = null;      // the stored-frame state after `applied` moves
    this.applied = 0;
    this.over = false;
    this.started = false;
    this.opp = null;        // the other seat's record { name, avatar, deviceId, code }
    this.sending = Promise.resolve();
    this.dead = false;
    this.recovering = false;
    this._presence = null;
  }

  me() {
    const p = (() => { try { return loadProfile() || {}; } catch { return {}; } })();
    return { name: p.name || '', avatar: p.emoji || '🙂', deviceId: deviceId(), team: this.team };
  }

  /** Make a room with `team`. Resolves { ok, code } or { error }. */
  async host(team) {
    this.team = cleanTeam(team);
    if (!this.team) return { error: 'bad-team' };
    const res = await this.net.createRoom(GAME, { v: 1 }, this.me());
    if (!res || res.error) return { error: (res && res.error) || 'offline' };
    this.code = res.code;
    this.seat = 0;
    writeJSON(localStorage, ROOM_KEY, { code: this.code, seat: 0, team: this.team, at: Date.now() });
    await this.listen();
    return { ok: true, code: this.code };
  }

  /** Join `code` with `team`. Resolves { ok } or { error }. */
  async join(code, team) {
    this.team = cleanTeam(team);
    if (!this.team) return { error: 'bad-team' };
    const res = await this.net.joinRoom(code, this.me());
    if (!res || res.error) return { error: (res && res.error) || 'offline' };
    if (res.room && res.room.game !== GAME) { return { error: 'not-found' }; }
    this.code = String(code).trim().toUpperCase();
    this.seat = 1;
    writeJSON(localStorage, ROOM_KEY, { code: this.code, seat: 1, team: this.team, at: Date.now() });
    await this.listen();
    return { ok: true };
  }

  /** Back into the room this phone was in (ROOM_KEY). Resolves { ok } or { error }. */
  async rejoin(save) {
    this.team = cleanTeam(save.team);
    this.code = save.code;
    this.seat = save.seat;
    if (save.seat === 1) {
      const res = await this.net.joinRoom(save.code, this.me());
      if (!res || res.error) return { error: (res && res.error) || 'offline' };
    } else if (!(await this.net.init())) return { error: 'offline' };
    await this.listen();
    return { ok: true };
  }

  async listen() {
    this.net.heartbeat(this.code, this.seat === 0 ? 'host' : 'guest');
    await this.net.onRoom(this.code, (room) => { try { this.onRoom(room); } catch (err) { console.error('[battle-arena] room update failed', err); } });
  }

  onRoom(room) {
    if (this.dead) return;
    if (!room || room.game !== GAME) { if (!this.over) this.end('gone'); return; }
    this.room = room;
    const oppRec = this.seat === 0 ? room.guest : room.host;
    if (oppRec) this.opp = oppRec;
    if (oppRec && oppRec.lastSeen && this.cb.onPresence) this.cb.onPresence(Math.max(0, Date.now() - oppRec.lastSeen));
    if (room.status === 'ended' && !this.over) {
      // A room ended by the other player. Mid-match they always resign first (a 'r' move), so an
      // end with the match still on is a room that went away: nothing is recorded.
      const moves = movesOf(room);
      if (!moves.some((m) => m.entry.k === 'r')) { this.end(this.started ? 'left' : 'gone'); return; }
    }
    // The host publishes the match once the guest is seated with a team.
    if (!room.round && this.seat === 0 && room.guest && cleanTeam(room.guest.team) && this.team && !this.publishing) {
      this.publishing = true;
      const deck = { seed: freshSeed(), a: this.team, b: cleanTeam(room.guest.team) };
      this.net.startRound(this.code, 1, deck, 0).catch((err) => { this.publishing = false; console.error('[battle-arena] could not start the match', err); });
    }
    const match = matchOf(room);
    if (!match) { if (this.cb.onLobby) this.cb.onLobby(room); return; }
    if (!this.started) {
      this.started = true;
      this.match = match;
      this.canon = startState(match.seed, { a: match.a, b: match.b }, match.first);
      // A rejoin: everything already stored is replayed silently (the screen starts on it).
      const done = [];
      for (const m of movesOf(room)) {
        if (!this.applyStored(m)) break;
        done.push(m.entry);
      }
      // This phone's armed leave was settled as a loss while it was away (js/live-leave.js, the hub
      // after 30 minutes): the match is lost here, so say so in the room (the other side wins).
      if (!this.over && LL.alreadyCounted(this.llKey())) this.resign();
      if (this.cb.onStart) this.cb.onStart(this.canon, done);
      return;
    }
    // Recovery (only after a hash mismatch, which a deterministic engine should never produce).
    const rec = room.recovery;
    if (this.seat === 0 && rec && rec.requested != null && !rec.state) {
      this.net.writeRecovery(this.code, this.applied, { canon: this.canon, applied: this.applied }).catch(() => {});
    }
    if (this.seat === 1 && this.recovering && rec && rec.state && rec.state.canon) {
      this.recovering = false;
      this.canon = rec.state.canon;
      this.applied = rec.state.applied | 0;
      this.net.clearRecovery(this.code).catch(() => {});
      if (this.cb.onResync) this.cb.onResync(this.canon);
      return;
    }
    for (const m of movesOf(room).slice(this.applied)) {
      const mine = m.entry.by === sideOfSeat(this.seat);
      if (mine) break;                       // our own move not echoed back yet in order: wait
      if (!this.applyStored(m)) return;
      if (this.cb.onMove) this.cb.onMove(m.entry);
      if (this.over) break;
    }
  }

  /** Apply one stored move to `canon`, checking its hash. False = stop (a mismatch asks for help). */
  applyStored(m) {
    if (this.over) return false;
    if (m.entry.k === 'r') {
      this.applied = m.seq + 1;
      this.over = true;
      this.canon = { ...this.canon, winner: 1 - (m.entry.by === 'b' ? 1 : 0), resigned: m.entry.by === 'b' ? 1 : 0 };
      return true;
    }
    const mv = moveOf(m.entry);
    const res = mv && E.apply(this.canon, mv);
    if (!res || !res.ok || (m.h && stateHash(res.state) !== m.h)) {
      console.error('[battle-arena] live move did not replay to the same match', m, res && res.error);
      if (this.seat === 1 && !this.recovering) {
        this.recovering = true;
        this.net.requestRecovery(this.code, m.seq).catch(() => {});
      }
      return false;
    }
    this.canon = res.state;
    this.applied = m.seq + 1;
    if (res.state.winner != null) this.over = true;
    return true;
  }

  /** This player's move (stored-frame entry), already shown on this phone. Written in order; a
   *  failed write is retried (never dropped) until the room is gone. */
  send(entry) {
    if (this.over || this.dead) return;
    const seq = this.applied;
    const res = entry.k === 'r' ? { ok: true, state: { ...this.canon, winner: 1 - this.seat } } : E.apply(this.canon, moveOf(entry));
    if (!res.ok) { console.error('[battle-arena] refusing to send a move the rules refuse', entry, res.error); return; }
    if (entry.k === 'r') { this.over = true; this.canon = { ...this.canon, winner: entry.by === 'b' ? 0 : 1, resigned: entry.by === 'b' ? 1 : 0 }; }
    else { this.canon = res.state; if (res.state.winner != null) this.over = true; }
    this.applied = seq + 1;
    const h = entry.k === 'r' ? null : stateHash(this.canon);
    // Your own first move arms the leave (js/live-leave.js): a phone that never comes back loses.
    if (entry.k !== 'r' && !this.over && entry.by === sideOfSeat(this.seat)) {
      LL.armLeave(GAME, this.llKey(), 'recordResult', [GAME, 'mp', false], this.opp ? [this.opp] : []);
    }
    this.sending = this.sending.then(async () => {
      for (let tries = 0; tries < 8 && !this.dead; tries++) {
        try { await this.net.appendMove(this.code, this.seat, seq, entry, h); return; }
        catch (err) { console.warn('[battle-arena] move not sent yet, retrying', err); await new Promise((r) => setTimeout(r, 1500 * (tries + 1))); }
      }
      console.error('[battle-arena] a live move could not be sent', entry);
    });
  }

  /** Resign (this player) or claim the win (`forThem`: the other player has been gone CLAIM_MS). */
  resign(forThem = false) {
    if (this.over || !this.started) return;
    const by = sideOfSeat(forThem ? 1 - this.seat : this.seat);
    this.send({ by, k: 'r' });
  }

  /** The other player's record for head-to-head, and this match's ledger key. */
  resultKey() { return `${this.code}:${this.match ? this.match.seed : 0}`; }
  /** This match's key in js/live-leave.js's ledger. */
  llKey() { return LL.liveKey(GAME, this.code, this.match ? this.match.seed : 0); }

  /** Leave the room for good (after the match, or the lobby). The save goes with it. */
  async leave() {
    this.dead = true;
    clearRoomSave();
    try { await this.sending; } catch { /* sent or not, the room is being left */ }
    try { await this.net.leaveRoom(this.code); } catch { this.net.disconnect(); }
  }

  /** Stop listening without leaving (the game was closed: the next mount rejoins). */
  detach() { this.dead = true; LL.detachLeave(GAME); try { this.net.disconnect(); } catch { /* gone */ } }

  end(why) {
    if (this.dead) return;
    // The room went away with the match on: an armed leave from this phone stands (it never came
    // back in time); ended by an older build's plain leave: nothing is recorded, as before.
    if (why === 'gone' && this.started) LL.settleLeave(GAME); else LL.disarmLeave(GAME);
    this.over = true;
    clearRoomSave();
    if (this.cb.onEnded) this.cb.onEnded(why);
  }
}

export default { LiveRoom, ROOM_KEY, readRoomSave, clearRoomSave, countLive, movesOf, matchOf, STALE_MS, CLAIM_MS };
