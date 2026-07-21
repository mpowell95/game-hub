// test-mp-lockstep.mjs - headless two-engine lockstep simulation for BOTH multiplayer games
// (Chinchón M2b, Escoba M1). No Firebase, no DOM: an in-file FakeRoom emulates the rooms/<CODE>
// node (move log, round records, recovery field, result) and two mirrored "glue" sides drive the
// REAL engine/hash/preset-deck/snapshot modules exactly the way each game's ui.js does.
//
// WHY MIRRORS, NOT IMPORTS: chinchon/js/ui.js and escoba/js/ui.js construct DOM in their module
// class constructors (mount(), stylesheet injection), so they cannot load headless. The engines,
// hashes, and snapshot paths ARE the real modules; only the ~150 lines of MP glue per game are
// mirrored here, statement-for-statement, from the citations below. If the glue changes, update
// the mirror WITH it - each mirror method cites its source so the drift is checkable:
//
//   Chinchón (chinchon/js/ui.js):        Escoba (escoba/js/ui.js):
//     _mpNewState            :1470-1481    _mpNewState            :1696-1706
//     humanAgent (decline)   :147-161      _makeRemoteAgent       :1711-1722
//     _makeRemoteAgent       :1498-1514    _mpTryDeliverNextMove  :1728-1739
//     _mpTryDeliverNextMove  :1523-1544    _mpAfterPlay           :1746-1770
//     _mpAwaitDecisionValue  :1546-1552    _mpHandleMismatch      :1775-1785
//     _mpAwaitStockReset     :1559-1566    _mpApplyRecovery       :1790-1807
//     _mpAfterDecision       :1575-1598    _mpApplyRoundData      :1809-1812
//     _mpSendStockReset      :1604-1610    _mpAwaitNextRound      :1817-1827
//     _mpHandleMismatch      :1615-1625    _mpOnRoomUpdate        :1892-1941
//     _mpApplyRecovery       :1630-1652    _mpHostStart           :1963-1981
//     _mpAwaitNextRound      :1657-1667    _mpGuestStartMatch     :2014-2033
//     _mpOnRoomUpdate        :1731-1780    onEvent MP hooks       :719-804
//     _mpHostStart           :1802-1826    _saveSnapshot          :180-191
//     _mpGuestStartMatch     :1867-1893    _tryRestoreMP          :2067-2097
//     onEvent MP hooks       :706-779
//     _mpSaveSnapshot        :1933-1941
//     _tryRestoreMP          :1955-1985
//   Shared room semantics mirrored from js/net.js: startRound clears the move log
//   (net.js:122-128), appendMove keys by padded seq (:132-137), writeRecovery replaces the
//   recovery field (:145-149), requestRecovery (:153-156), onValue fires once immediately on
//   subscribe (Firebase semantics; FakeRoom.onRoom does the same).
//
// SCENARIOS (per game where applicable):
//   1. Full match to completion, deterministic scripted agents, hash verified on every applied
//      remote move (that IS the protocol) + final-state hash equality. Expected green.
//   2. Chinchón only: stock exhaustion -> host-shuffled reset transmitted as a 'stock-reset'
//      entry -> identical post-reset play. 2a: within one round (expected green - the path QA
//      never reached live). 2b: a SECOND round that also exhausts - probes that
//      config.presetStockResets from round 1 doesn't poison round 2 (game.js:264 indexes
//      presets by the per-round resetsUsed counter, but startRound() never clears the array).
//      (Escoba has no mid-round host-shuffle - decks are per-round only - noted as N/A.)
//   3. Forced desync: deliberately corrupt one guest-side application -> assert the mismatch is
//      DETECTED at the next hash compare, the recovery snapshot round-trips through
//      Game.fromSnapshot, and play continues to a convergent match end.
//   4. Mid-match rejoin: freeze the guest, drop its live state, rebuild from its last autosave
//      exactly the way _tryRestoreMP does, replay the room-log tail, assert convergence with no
//      recovery and no move-log overwrites (the INTENDED behavior of the restore feature).
//
// Node-only, no deps, players-agg.test.mjs idiom. Run: node test-mp-lockstep.mjs

import { Game as CGame, makePlayer as cMakePlayer, DEFAULT_CONFIG as C_DEFAULT } from './chinchon/js/game.js';
import { stateHash as cHash } from './chinchon/js/hash.js';
import { Game as EGame, makePlayer as eMakePlayer } from './escoba/js/game.js';
import { stateHash as eHash } from './escoba/js/hash.js';

let fail = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`ok    ${name}`); return; }
  fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`);
}
const deep = (x) => JSON.parse(JSON.stringify(x));
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Poll until cond() or timeout; timers keep the event loop alive so a lockstep
 *  deadlock surfaces as a timeout instead of a silent node exit. */
function until(cond, ms, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (cond()) { resolve(); return; }
      if (Date.now() - t0 > ms) { reject(new Error(`timeout: ${label}`)); return; }
      setTimeout(tick, 5);
    };
    tick();
  });
}

// --- the fake rooms/<CODE> node ---------------------------------------------------
class FakeRoom {
  constructor() {
    this.status = 'waiting'; this.round = null; this.moves = {}; this.recovery = null; this.result = null;
    this.config = null;      // the host's published room config (net.js createRoom stores it)
    this.listeners = new Set();
    this.overwrites = [];   // {seq, oldBy, newBy}: a same-seq entry replaced with DIFFERENT content
    this.dead = false;      // harness kill-switch: a finished scenario silences its room
  }
  snapshotRoom() {
    return deep({ status: this.status, round: this.round, moves: this.moves, recovery: this.recovery, result: this.result, config: this.config, host: { lastSeen: Date.now() }, guest: { lastSeen: Date.now() } });
  }
  _notify() { if (this.dead) return; for (const cb of [...this.listeners]) queueMicrotask(() => { if (!this.dead) cb(this.snapshotRoom()); }); }
  onRoom(cb) { this.listeners.add(cb); queueMicrotask(() => cb(this.snapshotRoom())); }   // onValue fires immediately
  offRoom(cb) { this.listeners.delete(cb); }
  async startRound(n, deck, dealer) { this.round = { n, deck, dealer }; this.moves = {}; this.recovery = null; this.status = 'active'; this._notify(); }   // net.js:122-128
  async appendMove(by, seq, move, h) {   // net.js:132-137
    const key = String(seq).padStart(4, '0');
    const prev = this.moves[key];
    const entry = { by, seq, move, h };
    if (prev && JSON.stringify(prev) !== JSON.stringify(entry)) this.overwrites.push({ seq, oldBy: prev.by, newBy: by });
    this.moves[key] = entry;
    this._notify();
  }
  async writeResult(result) { this.result = result; this.status = 'ended'; this._notify(); }        // net.js:140-143
  async writeRecovery(seq, snapshot) { this.recovery = { state: snapshot, seq, at: Date.now() }; this._notify(); }   // net.js:145-149
  async requestRecovery(seq) { this.recovery = { requested: seq, at: Date.now() }; this._notify(); }                 // net.js:153-156
  async clearRecovery() { this.recovery = null; this._notify(); }
}

const MP_RECOVERY_MAX_ATTEMPTS = 3;   // chinchon/js/ui.js:50 / escoba/js/ui.js:50

function mpNewState() {   // chinchon/js/ui.js:1470-1481 / escoba/js/ui.js:1696-1706 (UI-only fields dropped)
  return {
    appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
    pendingResolve: null, pendingType: null, pendingSeq: null, pendingHash: null,
    replayMode: false, recoveryAttempts: 0, lastRoomSnapshot: null,
    lastRecoveryHandled: null, lastRecoveryApplied: null,
    awaitingRoundN: null, awaitingRoundResolve: null, awaitingStockReset: null,
  };
}

// ==================================================================================
// CHINCHÓN side (mirror of chinchon/js/ui.js's MP glue; citations per method)
// ==================================================================================
class ChinchonSide {
  constructor(role, room, script, opts = {}) {
    this.role = role; this.room = room; this.script = script; this.opts = opts;
    this.mp = mpNewState();
    this.game = null; this.dead = false; this.matchEnded = false; this.failedHard = false;
    this.mismatches = 0; this.recoveriesApplied = 0; this.errors = [];
    this.saves = [];   // in-memory _mpSaveSnapshot (:1933-1941)
    const side = this;
    this.localAgent = {   // humanAgent @ :147-161
      isHuman: true,
      chooseDraw: (v) => side.script.chooseDraw(v),
      chooseDiscard: (v) => side.script.chooseDiscard(v),
      decideClose: async (v) => {
        const wants = await side.script.decideClose(v);
        if (!wants) await side.afterDecision(side.human(), { t: 'close', kind: false });   // :158
        return wants;
      },
      choosePlacements: async (v, locked, attachable) => attachable.map((c) => c.id),
    };
    this._roomCb = (r) => this.roomCallback(r);
    room.onRoom(this._roomCb);
  }
  human() { return this.game.players.find((p) => p.isHuman); }
  remotePlayer() { return this.game.players.find((p) => !p.isHuman); }   // :1468
  remoteAgent() {   // :1498-1514
    const side = this;
    return {
      isHuman: false,
      chooseDraw() { return side.awaitDecision('draw'); },
      chooseDiscard() { return side.awaitDecision('discard'); },
      async decideClose() {
        const kind = await side.awaitDecision('close');
        if (!kind) await side.afterDecision(side.remotePlayer(), null);   // :1509
        return kind;
      },
      async choosePlacements(view, locked, attachable) { return attachable.map((c) => c.id); },
    };
  }
  awaitDecision(expectedType) {   // _mpAwaitDecisionValue @ :1546-1552
    return new Promise((resolve) => { this.mp.pendingResolve = resolve; this.mp.pendingType = expectedType; this.tryDeliver(); });
  }
  tryDeliver() {   // _mpTryDeliverNextMove @ :1523-1544
    const mp = this.mp;
    if (!mp || !mp.movesById || this.dead) return;
    // harness-only freeze for scenario 4 (drops delivery, mirrors a backgrounded device)
    if (this.opts.frozen && this.opts.frozen()) return;
    while (true) {   // greedy leading stock-reset consumption (:1526-1533)
      const seq = mp.appliedSeq + 1;
      const entry = mp.movesById.get(seq);
      if (!entry || entry.move.t !== 'stock-reset') break;
      this.game.config.presetStockResets = (this.game.config.presetStockResets || []).concat([entry.move.order]);
      mp.appliedSeq = seq;
      if (mp.awaitingStockReset) { const r = mp.awaitingStockReset; mp.awaitingStockReset = null; r(); }
    }
    if (!mp.pendingResolve) return;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry) return;
    const resolve = mp.pendingResolve;
    mp.pendingResolve = null; mp.pendingType = null;
    mp.pendingSeq = seq; mp.pendingHash = entry.h;
    const m = entry.move;
    resolve(m.t === 'draw' ? m.src : m.t === 'discard' ? m.cardId : !!m.kind);   // :1543
  }
  awaitStockReset() {   // _mpAwaitStockReset @ :1559-1566
    const mp = this.mp;
    if (this.game.stock.length > 0 || this.game.resetsUsed >= this.game.config.maxResets) return Promise.resolve();
    const have = (this.game.config.presetStockResets || []).length;
    if (have > this.game.resetsUsed) return Promise.resolve();
    return new Promise((resolve) => { mp.awaitingStockReset = resolve; });
  }
  async afterDecision(p, moveIfLocal) {   // _mpAfterDecision @ :1575-1598
    const mp = this.mp;
    if (!mp || this.dead) return;
    if (p.isHuman) {
      const seq = ++mp.appliedSeq;   // reserved synchronously (:1582)
      const hash = cHash(this.game);
      this.room.appendMove(this.role, seq, moveIfLocal, hash).catch(() => {});
      return;
    }
    const expectedSeq = mp.pendingSeq, expectedHash = mp.pendingHash;
    mp.pendingSeq = null; mp.pendingHash = null;
    if (expectedSeq == null) return;
    if (this.opts.corruptAtSeq === expectedSeq && !this._corrupted) { this._corrupted = true; if (this.game.stock.length >= 2) { const s = this.game.stock; [s[0], s[1]] = [s[1], s[0]]; } }
    const hash = cHash(this.game);
    if (hash === expectedHash) {
      mp.appliedSeq = expectedSeq;
      mp.recoveryAttempts = 0;
      if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
      return;
    }
    this.mismatches++;
    await this.handleMismatch(expectedSeq);
  }
  sendStockReset(order) {   // _mpSendStockReset @ :1604-1610
    const mp = this.mp;
    if (!mp || this.dead) return;
    const seq = ++mp.appliedSeq;
    const hash = cHash(this.game);
    this.room.appendMove(this.role, seq, { t: 'stock-reset', order }, hash).catch(() => {});
  }
  async handleMismatch(seq) {   // _mpHandleMismatch @ :1615-1625
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { this.failedHard = true; if (this.game) this.game.abort(); return; }
    try {
      if (this.role === 'host') await this.room.writeRecovery(mp.appliedSeq, this.game.snapshot());
      else await this.room.requestRecovery(seq);
    } catch { /* retried on next room update */ }
  }
  applyRecovery(recovery) {   // _mpApplyRecovery @ :1630-1652
    const mp = this.mp;
    if (!mp || this.dead) return;
    const snap = recovery.state;
    const agentsById = {};
    for (const sp of snap.players) agentsById[sp.id] = sp.isHuman ? this.localAgent : this.remoteAgent();
    if (this.game) this.game.abort();
    this.recoveriesApplied++;
    this.bindGame(CGame.fromSnapshot(deep(snap), agentsById));
    mp.appliedSeq = recovery.seq;
    mp.pendingResolve = null; mp.pendingType = null; mp.pendingSeq = null; mp.pendingHash = null;
    mp.replayMode = false; mp.recoveryAttempts = 0;
    this.room.clearRecovery().catch(() => {});
    this.startLoop();
  }
  awaitNextRound() {   // _mpAwaitNextRound @ :1657-1667
    const mp = this.mp;
    const target = this.game.round + 1;
    const room = mp.lastRoomSnapshot;
    if (room && room.round && room.round.n === target) { this.game.config.presetDeck = room.round.deck; return Promise.resolve(); }
    return new Promise((resolve) => { mp.awaitingRoundN = target; mp.awaitingRoundResolve = resolve; });
  }
  roomCallback(room) {   // _mpRoomCallback @ :1721-1728 + _mpOnRoomUpdate @ :1731-1780
    if (this.dead) return;
    if (!this.game) {   // guest auto-start (:1726-1727)
      if (this.role === 'guest' && this.opts.autoStart && room.status === 'active' && room.round) this.guestStart(room);
      return;
    }
    const mp = this.mp;
    mp.lastRoomSnapshot = room;
    if (room.recovery) {
      if (this.role === 'host' && room.recovery.requested != null && room.recovery.requested !== mp.lastRecoveryHandled) {
        mp.lastRecoveryHandled = room.recovery.requested;
        this.room.writeRecovery(mp.appliedSeq, this.game.snapshot()).catch(() => {});
      }
      if (this.role === 'guest' && room.recovery.state && room.recovery.seq !== mp.lastRecoveryApplied) {
        mp.lastRecoveryApplied = room.recovery.seq;
        this.applyRecovery(room.recovery);
      }
    }
    const entries = Object.values(room.moves || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq), 0);
    if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
    mp.maxKnownSeq = maxSeq;
    this.tryDeliver();
    if (mp.awaitingRoundResolve && room.round && room.round.n === mp.awaitingRoundN) {
      this.game.config.presetDeck = room.round.deck;
      const resolve = mp.awaitingRoundResolve;
      mp.awaitingRoundN = null; mp.awaitingRoundResolve = null;
      resolve();
    }
  }
  bindGame(game) {
    this.game = game;
    game.onEvent = (t, p) => this.onEvent(t, p);
  }
  async onEvent(type, payload) {   // onEvent MP hooks @ :706-779 (render/pacing/toasts omitted)
    if (this.dead) return;
    const p = payload && payload.playerId != null ? this.game.byId(payload.playerId) : null;
    switch (type) {
      case 'roundStart':
        if (this.role === 'host') await this.room.startRound(this.game.round, this.game.lastDeckOrder, this.game.dealerIndex);   // :716-719
        break;
      case 'turnStart':
        if (this.role === 'guest') await this.awaitStockReset();   // :729
        break;
      case 'draw': await this.afterDecision(p, { t: 'draw', src: payload.source }); break;              // :735
      case 'discard': await this.afterDecision(p, { t: 'discard', cardId: payload.card.id }); break;    // :741
      case 'close': await this.afterDecision(p, { t: 'close', kind: true }); break;                     // :745
      case 'roundScored':
        this.saves.push({ v: 1, code: 'T', role: this.role, seq: this.mp.appliedSeq, at: 0, snap: deep(this.game.snapshot()) });   // _mpSaveSnapshot @ :758/1933-1941
        if (this.role === 'guest' && !this.game.winner) await this.awaitNextRound();   // :764
        break;
      case 'matchEnd':
        this.matchEnded = true;
        if (this.role === 'host') await this.room.writeResult({ winnerId: this.game.winner.id });   // :772-775
        break;
    }
  }
  startLoop() { this.game.playMatch().catch((e) => { this.errors.push(e); }); }
  hostStart(config) {   // _mpHostStart @ :1802-1826
    const cfg = Object.assign({}, C_DEFAULT, config);
    if (cfg.placeOnEnding === 'manual') cfg.placeOnEnding = 'auto';   // _mpBuildConfig @ :1487-1491
    cfg.onStockReset = (order) => this.sendStockReset(order);         // :1811
    const players = [
      cMakePlayer({ id: 0, name: 'Host', avatar: 'H', isHuman: true, agent: this.localAgent }),
      cMakePlayer({ id: 1, name: 'Guest', avatar: 'G', isHuman: false, agent: this.remoteAgent() }),
    ];
    this.bindGame(new CGame({ players, config: cfg, rng: mulberry32(1234) }));
    this.startLoop();
  }
  guestStart(room) {   // _mpGuestStartMatch @ :1867-1893
    const cfg = Object.assign({}, C_DEFAULT, room.round ? this._roomConfig : {});
    Object.assign(cfg, this._roomConfig || {});
    if (cfg.placeOnEnding === 'manual') cfg.placeOnEnding = 'auto';
    cfg.presetDeck = room.round.deck;   // :1874
    const players = [
      cMakePlayer({ id: 0, name: 'Host', avatar: 'H', isHuman: false, agent: this.remoteAgent() }),
      cMakePlayer({ id: 1, name: 'Guest', avatar: 'G', isHuman: true, agent: this.localAgent }),
    ];
    this.bindGame(new CGame({ players, config: cfg }));
    this.startLoop();
  }
  restoreFromSave(save) {   // _tryRestoreMP @ :1955-1985 (join/heartbeat elided; FakeRoom always reachable)
    const agentsById = {};
    for (const sp of save.snap.players) agentsById[sp.id] = sp.isHuman ? this.localAgent : this.remoteAgent();
    this.mp = mpNewState();
    this.mp.appliedSeq = save.seq | 0;   // :1973
    this.bindGame(CGame.fromSnapshot(deep(save.snap), agentsById));   // :1974
    this.startLoop();   // :1984
  }
  kill() { this.dead = true; if (this.game) this.game.abort(); this.room.offRoom(this._roomCb); }
}

// ==================================================================================
// ESCOBA side (mirror of escoba/js/ui.js's MP glue; citations per method)
// ==================================================================================
class EscobaSide {
  constructor(role, room, script, opts = {}) {
    this.role = role; this.room = room; this.script = script; this.opts = opts;
    this.mp = mpNewState();
    this.game = null; this.dead = false; this.matchEnded = false; this.failedHard = false;
    this.mismatches = 0; this.recoveriesApplied = 0; this.errors = [];
    this.saves = [];   // in-memory _saveSnapshot (:180-191)
    const side = this;
    this.localAgent = { isHuman: true, chooseMove: (v) => side.script(v) };
    this._roomCb = (r) => this.roomCallback(r);
    room.onRoom(this._roomCb);
  }
  remoteAgent() {   // _makeRemoteAgent @ :1711-1722
    const side = this;
    return { isHuman: false, chooseMove() { return new Promise((resolve) => { side.mp.pendingResolve = resolve; side.tryDeliver(); }); } };
  }
  tryDeliver() {   // _mpTryDeliverNextMove @ :1728-1739
    const mp = this.mp;
    if (!mp || !mp.pendingResolve || !mp.movesById || this.dead) return;
    if (this.opts.frozen && this.opts.frozen()) return;   // harness-only freeze (scenario 4)
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry) return;
    const resolve = mp.pendingResolve;
    mp.pendingResolve = null;
    mp.pendingSeq = seq; mp.pendingHash = entry.h;
    resolve(entry.move);
  }
  async afterPlay(p, payload) {   // _mpAfterPlay @ :1746-1770
    const mp = this.mp;
    if (!mp || this.dead) return;
    if (p.isHuman) {
      const seq = mp.appliedSeq + 1;
      const move = { cardId: payload.card.id, captureIds: payload.captured.map((c) => c.id) };
      const hash = eHash(this.game);
      try { await this.room.appendMove(this.role, seq, move, hash); mp.appliedSeq = seq; }
      catch { /* connection error status in real UI */ }
      return;
    }
    const expectedSeq = mp.pendingSeq, expectedHash = mp.pendingHash;
    mp.pendingSeq = null; mp.pendingHash = null;
    if (expectedSeq == null) return;
    if (this.opts.corruptAtSeq === expectedSeq && !this._corrupted) { this._corrupted = true; if (this.game.stock.length >= 2) { const s = this.game.stock; [s[0], s[1]] = [s[1], s[0]]; } }
    const hash = eHash(this.game);
    if (hash === expectedHash) {
      mp.appliedSeq = expectedSeq;
      mp.recoveryAttempts = 0;
      if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
      return;
    }
    this.mismatches++;
    await this.handleMismatch(expectedSeq);
  }
  async handleMismatch(seq) {   // _mpHandleMismatch @ :1775-1785
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { this.failedHard = true; if (this.game) this.game.abort(); return; }
    try {
      if (this.role === 'host') await this.room.writeRecovery(mp.appliedSeq, this.game.snapshot());
      else await this.room.requestRecovery(seq);
    } catch { /* retried on next room update */ }
  }
  applyRecovery(recovery) {   // _mpApplyRecovery @ :1790-1807
    const mp = this.mp;
    if (!mp || this.dead) return;
    const snap = recovery.state;
    const agentsById = {};
    for (const sp of snap.players) agentsById[sp.id] = sp.isHuman ? this.localAgent : this.remoteAgent();
    if (this.game) this.game.abort();
    this.recoveriesApplied++;
    this.bindGame(EGame.fromSnapshot(deep(snap), agentsById));
    mp.appliedSeq = recovery.seq;
    mp.pendingResolve = null; mp.pendingSeq = null; mp.pendingHash = null;
    mp.replayMode = false; mp.recoveryAttempts = 0;
    this.room.clearRecovery().catch(() => {});
    this.startLoop();
  }
  applyRoundData(round) { this.game.config.presetDeck = round.deck; this.game.dealer = round.dealer; }   // _mpApplyRoundData @ :1809-1812
  awaitNextRound() {   // _mpAwaitNextRound @ :1817-1827
    const mp = this.mp;
    const target = this.game.round + 1;
    const room = mp.lastRoomSnapshot;
    if (room && room.round && room.round.n === target) { this.applyRoundData(room.round); return Promise.resolve(); }
    return new Promise((resolve) => { mp.awaitingRoundN = target; mp.awaitingRoundResolve = resolve; });
  }
  roomCallback(room) {   // _mpRoomCallback @ :1882-1890 + _mpOnRoomUpdate @ :1892-1941
    if (this.dead) return;
    if (!this.game) {
      if (this.role === 'guest' && this.opts.autoStart && room.status === 'active' && room.round) this.guestStart(room);
      return;
    }
    const mp = this.mp;
    mp.lastRoomSnapshot = room;
    if (room.recovery) {
      if (this.role === 'host' && room.recovery.requested != null && room.recovery.requested !== mp.lastRecoveryHandled) {
        mp.lastRecoveryHandled = room.recovery.requested;
        this.room.writeRecovery(mp.appliedSeq, this.game.snapshot()).catch(() => {});
      }
      if (this.role === 'guest' && room.recovery.state && room.recovery.seq !== mp.lastRecoveryApplied) {
        mp.lastRecoveryApplied = room.recovery.seq;
        this.applyRecovery(room.recovery);
      }
    }
    const entries = Object.values(room.moves || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq), 0);
    if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
    mp.maxKnownSeq = maxSeq;
    this.tryDeliver();
    if (mp.awaitingRoundResolve && room.round && room.round.n === mp.awaitingRoundN) {
      this.applyRoundData(room.round);
      const resolve = mp.awaitingRoundResolve;
      mp.awaitingRoundN = null; mp.awaitingRoundResolve = null;
      resolve();
    }
  }
  bindGame(game) { this.game = game; game.onEvent = (t, p) => this.onEvent(t, p); }
  save(kind) {   // _saveSnapshot @ :180-191 - NOTE: seq recorded BEFORE _mpAfterPlay bumps appliedSeq
    // `kind` is a harness-only annotation (which event triggered the save) so scenarios can
    // select a specific save; the payload fields mirror the real _saveSnapshot exactly.
    this.saves.push({ v: 1, kind, snap: deep(this.game.snapshot()), mp: { code: 'T', role: this.role, seq: this.mp.appliedSeq, at: 0 } });
  }
  async onEvent(type, payload) {   // onEvent MP hooks @ :719-804 (render/pacing/broom omitted)
    if (this.dead) return;
    const p = payload && payload.playerId != null ? this.game.byId(payload.playerId) : null;
    switch (type) {
      case 'roundStart':
        if (this.role === 'host') await this.room.startRound(this.game.round, this.game.lastDeckOrder, this.game.dealer);   // :729-732
        break;
      case 'deal': if (!payload.first) this.save('deal'); break;    // :739
      case 'initialEscoba': this.save('initialEscoba'); break;               // :744
      case 'play':
        this.save('play');                                          // :771 - fires BEFORE _mpAfterPlay (:772)
        await this.afterPlay(p, payload);
        break;
      case 'sweepLeftovers': this.save('sweep'); break;              // :777
      case 'roundScored':
        if (!this.game.winner) this.save('roundScored');                   // :784
        if (this.role === 'guest' && !this.game.winner) await this.awaitNextRound();   // :791
        break;
      case 'matchEnd':
        this.matchEnded = true;
        if (this.role === 'host') await this.room.writeResult({ winnerId: this.game.winner.id });   // :798-801
        break;
    }
  }
  startLoop() { this.game.playMatch().catch((e) => { this.errors.push(e); }); }
  hostStart(config) {   // _mpHostStart @ :1963-1981
    const players = [
      eMakePlayer({ id: 0, name: 'Host', avatar: 'H', isHuman: true, agent: this.localAgent }),
      eMakePlayer({ id: 1, name: 'Guest', avatar: 'G', agent: this.remoteAgent() }),
    ];
    this.bindGame(new EGame({ players, config, rng: mulberry32(99) }));
    this.startLoop();
  }
  guestStart(room) {   // _mpGuestStartMatch @ :2014-2033
    const cfg = room.config || {};
    const players = [
      eMakePlayer({ id: 0, name: 'Host', avatar: 'H', agent: this.remoteAgent() }),
      eMakePlayer({ id: 1, name: 'Guest', avatar: 'G', isHuman: true, agent: this.localAgent }),
    ];
    this.bindGame(new EGame({ players, config: { targetScore: cfg.targetScore, deckMode: cfg.deckMode, presetDeck: room.round.deck } }));
    this.game.dealer = room.round.dealer;   // :2027
    this.startLoop();
  }
  restoreFromSave(save) {   // _tryRestoreMP @ :2067-2097 (join elided; FakeRoom always reachable)
    const agentsById = {};
    for (const sp of save.snap.players) agentsById[sp.id] = sp.isHuman ? this.localAgent : this.remoteAgent();
    this.mp = mpNewState();
    this.mp.appliedSeq = save.mp.seq | 0;   // :2088
    this.bindGame(EGame.fromSnapshot(deep(save.snap), agentsById));   // :2089
    this.startLoop();   // :2096
  }
  kill() { this.dead = true; if (this.game) this.game.abort(); this.room.offRoom(this._roomCb); }
}

// ==================================================================================
// Deterministic scripted agents
// ==================================================================================
// Chinchón: always draw stock; discard the highest-value card (tie: id order);
// close per policy. Deterministic on both sides; only the DECIDING side's choice
// matters (the other side receives it via the room).
const chinchonScript = (closePolicy) => ({
  chooseDraw: () => 'stock',
  chooseDiscard: (v) => v.hand.slice().sort((a, b) => (b.value - a.value) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0].id,
  decideClose: () => closePolicy,
});
// Escoba: play the first hand card; let the engine's legalize() coerce to its first
// (mandatory) capture option - deterministic and exercises real capture combos.
const escobaScript = () => (view) => ({ cardId: view.hand[0].id, captureIds: [] });

// Scenario runners
// ==================================================================================
// Findings note: four of the probes below are KNOWN-BUG PROBES - they assert the
// INTENDED behavior of a path whose current implementation does not meet it, with the
// mechanism cited in the failure message. They are mechanism-level (they probe the
// exact broken invariant right when it forms) rather than waiting out the chaotic
// aftermath, so they are deterministic and fast. See the tripwire report for the
// full write-ups.
// ==================================================================================

function cleanup(room, ...sides) {
  for (const s of sides) { try { s.kill(); } catch { /* already dead */ } }
  room.dead = true;
}

async function makeEscoba(opts = {}) {
  const room = new FakeRoom();
  room.config = { targetScore: 21, deckMode: 'spanish' };
  const host = new EscobaSide('host', room, escobaScript(), opts.host || {});
  const guest = new EscobaSide('guest', room, escobaScript(), Object.assign({ autoStart: true }, opts.guest || {}));
  host.hostStart({ targetScore: 21, deckMode: 'spanish' });
  return { room, host, guest };
}

async function makeChinchon(config, closePolicy, opts = {}) {
  const room = new FakeRoom();
  room.config = config;
  const host = new ChinchonSide('host', room, chinchonScript(closePolicy), opts.host || {});
  const guest = new ChinchonSide('guest', room, chinchonScript(closePolicy), Object.assign({ autoStart: true }, opts.guest || {}));
  guest._roomConfig = config;
  host.hostStart(config);
  return { room, host, guest };
}

// --- E1: Escoba full match ---------------------------------------------------------
console.log('\n--- E1: Escoba full match, lockstep, hash-verified every applied move ---');
{
  const { room, host, guest } = await makeEscoba();
  try {
    await until(() => (host.matchEnded && guest.matchEnded) || host.failedHard || guest.failedHard, 15000, 'E1 match end');
    ok('E1: both sides completed (no hard failure)', host.matchEnded && guest.matchEnded && !host.failedHard && !guest.failedHard);
    ok('E1: zero hash mismatches across the whole match', host.mismatches === 0 && guest.mismatches === 0, `host=${host.mismatches} guest=${guest.mismatches}`);
    ok('E1: zero recoveries needed', host.recoveriesApplied === 0 && guest.recoveriesApplied === 0);
    ok('E1: final states hash-identical', eHash(host.game) === eHash(guest.game));
    ok('E1: same winner on both sides', host.game.winner && guest.game.winner && host.game.winner.id === guest.game.winner.id);
    ok('E1: no move-log overwrites', room.overwrites.length === 0, JSON.stringify(room.overwrites));
    ok('E1: no engine errors', host.errors.length === 0 && guest.errors.length === 0, String(host.errors[0] || guest.errors[0] || ''));
  } catch (e) { fail++; console.log(`FAIL  E1 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- C1: Chinchón full match + the match-end deadlock probe ------------------------
console.log('\n--- C1: Chinchón full match (KNOWN-BUG PROBE: guest deadlocks at a points match end) ---');
{
  // scoreLimit 1 ends the match after round 1 (any positive total exceeds it).
  const { room, host, guest } = await makeChinchon({ victoryCondition: 'points', scoreLimit: 1 }, true);
  try {
    await until(() => host.matchEnded || host.failedHard || guest.failedHard, 15000, 'C1 host match end');
    ok('C1: full round of lockstep play, zero hash mismatches', host.mismatches === 0 && guest.mismatches === 0, `host=${host.mismatches} guest=${guest.mismatches}`);
    ok('C1: host reached matchEnd', host.matchEnded);
    ok('C1: no move-log overwrites', room.overwrites.length === 0, JSON.stringify(room.overwrites));
    // Give the guest a generous beat to also conclude, then probe.
    await new Promise((r) => setTimeout(r, 500));
    ok('C1 [KNOWN-BUG PROBE]: guest also reaches matchEnd when the match ends on points\n' +
       '      (fails while chinchon/js/game.js:339-346 emits roundScored BEFORE checkMatchEnd() runs:\n' +
       '      the guest-side gate `if (... && !this.game.winner) await this._mpAwaitNextRound()` at\n' +
       '      chinchon/js/ui.js:764 sees winner==null on the FINAL round of every points/rounds-limit\n' +
       '      match (winner is only pre-set by a chinchon close), so the guest blocks forever waiting\n' +
       '      for a round the host will never publish. Escoba is immune - escoba/js/game.js:166-173\n' +
       '      runs checkMatchEnd() BEFORE emitting roundScored; the gate was copied across that\n' +
       '      ordering difference. Consequence beyond the hang: the guest never runs its matchEnd\n' +
       '      hook, so recordChinchon/_commitStats (chinchon/js/ui.js:766-768) NEVER fires - every\n' +
       '      points-ended MP match is silently missing from the guest\'s gamehub.stats, a THE-LAW\n' +
       '      rule-6-class silent data loss)',
      guest.matchEnded,
      `guest.matchEnded=${guest.matchEnded} guest awaitingRoundN=${guest.mp.awaitingRoundN} (stuck waiting for a round ${guest.mp.awaitingRoundN} that will never be published)`);
  } catch (e) { fail++; console.log(`FAIL  C1 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- C2a: stock exhaustion + transmitted resets, single round ----------------------
console.log('\n--- C2a: Chinchón stock resets transmitted via stock-reset entries (one round) ---');
{
  // Never close -> the round exhausts the stock repeatedly: both maxResets resets fire
  // and the round ends by exhaustion. All within round 1, where the preset queue is
  // fresh - the transmitted-reset path itself (the path QA never reached live).
  const { room, host, guest } = await makeChinchon({ victoryCondition: 'points', scoreLimit: 1, maxResets: 2 }, false);
  try {
    await until(() => host.matchEnded || host.failedHard || guest.failedHard, 15000, 'C2a host match end');
    const resets = Object.values(room.moves).filter((m) => m.move.t === 'stock-reset').length;
    ok('C2a: host transmitted stock-reset entries', resets >= 1, `stock-reset entries in the final round log: ${resets}`);
    ok('C2a: round ended by exhaustion on the host', host.game.closeType === 'exhaustion');
    ok('C2a: zero hash mismatches incl. all post-reset play', host.mismatches === 0 && guest.mismatches === 0, `host=${host.mismatches} guest=${guest.mismatches}`);
    ok('C2a: guest consumed the same resets (appliedSeq caught up to host)', guest.mp.appliedSeq === host.mp.appliedSeq, `guest=${guest.mp.appliedSeq} host=${host.mp.appliedSeq}`);
    // (The guest-side match-end hang after this point is C1's finding; not re-asserted here.)
  } catch (e) { fail++; console.log(`FAIL  C2a did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- C2b: resets in TWO different rounds (stale presetStockResets probe) -----------
console.log('\n--- C2b: Chinchón resets in two rounds (KNOWN-BUG PROBE: stale presetStockResets) ---');
{
  // scoreLimit high enough that a second round happens; never close -> both rounds
  // exhaust. INTENDED: round 2's reset is awaited and applied like round 1's.
  const { room, host, guest } = await makeChinchon({ victoryCondition: 'points', scoreLimit: 500, maxResets: 2 }, false);
  try {
    // Wait until a mismatch appears (the bug), or round 3 is reached cleanly (intended).
    await until(() => host.mismatches + guest.mismatches > 0 || host.game.round >= 3 || host.failedHard || guest.failedHard, 20000, 'C2b round-2 reset outcome');
    ok('C2b [KNOWN-BUG PROBE]: a reset in a LATER round stays in sync\n' +
       '      (fails while chinchon/js/game.js:264 indexes config.presetStockResets - which is\n' +
       '      appended-to forever and NEVER cleared between rounds - with the per-ROUND resetsUsed\n' +
       '      counter, and chinchon/js/ui.js:1562-1563 skips the wait whenever stale entries make\n' +
       '      presets.length > resetsUsed: the guest silently replays round 1\'s shuffle order for\n' +
       '      round 2\'s reset, its stock diverges from the host\'s fresh shuffle, and the next\n' +
       '      applied move hash-mismatches. Live consequence: any multi-round MP match with stock\n' +
       '      resets in two different rounds desyncs and leans on the (also broken, see E3/C3)\n' +
       '      recovery path)',
      host.mismatches + guest.mismatches === 0 && host.game.round >= 3,
      `mismatches host=${host.mismatches} guest=${guest.mismatches} at round=${host.game.round} (host mismatching = it verified the guest's post-stale-reset moves; the guest's config was then replaced wholesale by the recovery snapshot)`);
  } catch (e) { fail++; console.log(`FAIL  C2b did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- E3: forced desync -> detected -> recovery round-trip --------------------------
console.log('\n--- E3: Escoba forced desync + recovery (KNOWN-BUG PROBE: recovery swaps the seats) ---');
{
  const { room, host, guest } = await makeEscoba({ guest: { corruptAtSeq: 4 } });
  try {
    await until(() => guest.recoveriesApplied >= 1 || guest.failedHard || host.failedHard, 15000, 'E3 recovery applied');
    ok('E3: corruption was DETECTED as a hash mismatch', guest.mismatches >= 1, `guest mismatches=${guest.mismatches}`);
    ok('E3: host answered the desync flag with a recovery snapshot', guest.recoveriesApplied >= 1, `recoveries=${guest.recoveriesApplied}`);
    ok('E3: recovered state round-tripped through Game.fromSnapshot (game live again)', !!guest.game && guest.game.round >= 1);
    const ownSeat = guest.game && guest.game.players.find((p) => p.id === 1);
    ok('E3 [KNOWN-BUG PROBE]: after recovery, the guest\'s own seat is still its local human\n' +
       '      (fails while escoba/js/ui.js:1795 (and chinchon/js/ui.js:1635) assigns agents by the\n' +
       '      snapshot\'s isHuman flags - but the snapshot came from the HOST, whose players[0] is\n' +
       '      the human and players[1] (the guest\'s own seat) is not. isHuman is device-RELATIVE;\n' +
       '      transmitting it without remapping hands the guest\'s human agent to the HOST\'s seat\n' +
       '      and a network RemoteAgent to the guest\'s own seat. Post-recovery the guest is\n' +
       '      prompted to play the host\'s cards and its own turns wait on the network forever -\n' +
       '      recovery, the safety net for every other MP defect, cannot actually land)',
      !!(ownSeat && ownSeat.isHuman),
      `guest post-recovery players: ${guest.game ? guest.game.players.map((p) => `id${p.id}:isHuman=${p.isHuman}`).join(', ') : 'no game'}`);
  } catch (e) { fail++; console.log(`FAIL  E3 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- C3: forced desync -> detected -> recovery round-trip --------------------------
console.log('\n--- C3: Chinchón forced desync + recovery (same seat-swap probe) ---');
{
  // Single-round config (scoreLimit 1) so the C2b staleness bug cannot interfere; the
  // corruption targets seq 4 - always the HOST's first discard as seen by the guest
  // (each round the guest's seat acts first: seq 1-2 are its own draw/discard, seq 3-4
  // the host's), so the guest's verify path is guaranteed to be the one that trips.
  const { room, host, guest } = await makeChinchon({ victoryCondition: 'points', scoreLimit: 1 }, true, { guest: { corruptAtSeq: 4 } });
  try {
    await until(() => guest.recoveriesApplied >= 1 || guest.failedHard || host.failedHard, 15000, 'C3 recovery applied');
    ok('C3: corruption was DETECTED as a hash mismatch', guest.mismatches >= 1, `guest mismatches=${guest.mismatches}`);
    ok('C3: host answered the desync flag with a recovery snapshot', guest.recoveriesApplied >= 1, `recoveries=${guest.recoveriesApplied}`);
    const ownSeat = guest.game && guest.game.players.find((p) => p.id === 1);
    ok('C3 [KNOWN-BUG PROBE]: after recovery, the guest\'s own seat is still its local human\n' +
       '      (same mechanism as E3: chinchon/js/ui.js:1635 maps agents by the HOST-relative isHuman\n' +
       '      flags in the transmitted snapshot)',
      !!(ownSeat && ownSeat.isHuman),
      `guest post-recovery players: ${guest.game ? guest.game.players.map((p) => `id${p.id}:isHuman=${p.isHuman}`).join(', ') : 'no game'}`);
  } catch (e) { fail++; console.log(`FAIL  C3 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- E4: mid-match rejoin from the autosave ----------------------------------------
console.log('\n--- E4: Escoba rejoin from autosave (KNOWN-BUG PROBE: play-save seq off-by-one) ---');
{
  // The lockstep cascade runs microtask-to-microtask, so a timer-flipped freeze flag
  // would only be observed after the whole match finished. The freeze must be IN-BAND:
  // a predicate on the guest's own progress, evaluated inside tryDeliver. Delivery stops
  // once the guest has applied seq 8 - mimicking a device backgrounded mid-round.
  let guestRef = null;
  const { room, host, guest } = await makeEscoba({ guest: { frozen: () => guestRef !== null && guestRef.mp.appliedSeq >= 8 } });
  guestRef = guest;
  let restored = null;
  try {
    // Wait for the freeze point, with a PLAY-triggered autosave in hand: those are the
    // ones the off-by-one affects, and plays vastly outnumber the other save triggers,
    // so this is the save a real backgrounding almost always picks up.
    await until(() => guest.mp.appliedSeq >= 8 && guest.saves.some((s) => s.kind === 'play'), 15000, 'E4 guest frozen at seq 8 with a play-save');
    await new Promise((r) => setTimeout(r, 200));
    const playSaves = guest.saves.filter((s) => s.kind === 'play');
    const lastSave = playSaves[playSaves.length - 1];
    guest.kill();

    // The mechanism probe, direct: a valid autosave's snapshot must NOT already contain
    // the move at seq+1 (the restore path replays seq+1 onto it, _tryRestoreMP:2088 +
    // _mpTryDeliverNextMove). Rebuild an engine from the snapshot and compare its hash
    // to the room log's entry at save.seq+1: equal means the save is off by one and a
    // restore will re-apply a move its state already contains.
    const entry = room.moves[String((lastSave.mp.seq | 0) + 1).padStart(4, '0')];
    let snapAlreadyContainsNext = false;
    if (entry) {
      const probeAgents = {};
      for (const sp of lastSave.snap.players) probeAgents[sp.id] = { chooseMove: () => new Promise(() => {}) };
      const probeGame = EGame.fromSnapshot(deep(lastSave.snap), probeAgents);
      snapAlreadyContainsNext = eHash(probeGame) === entry.h;
    }
    ok('E4 [KNOWN-BUG PROBE]: the autosave\'s seq matches its snapshot (restore replays only genuinely-new moves)\n' +
       '      (fails while escoba/js/ui.js:771 calls _saveSnapshot() BEFORE :772 _mpAfterPlay() bumps\n' +
       '      appliedSeq: every play-event autosave stores mp.seq one LOW relative to the state in its\n' +
       '      own snapshot, so _tryRestoreMP (:2088) rebuilds at post-move-N state with appliedSeq N-1\n' +
       '      and re-applies move N - a guaranteed desync on rejoin, converging only via the recovery\n' +
       '      path, which E3 shows is itself broken. Live consequence: backgrounding an MP escoba\n' +
       '      match mid-round and reopening within 30 min - the exact case _tryRestoreMP exists for -\n' +
       '      cannot resume cleanly)',
      !snapAlreadyContainsNext,
      `save.mp.seq=${lastSave.mp.seq} (kind=play), room entry at seq ${(lastSave.mp.seq | 0) + 1} ${entry ? `hash-matches the snapshot state: ${snapAlreadyContainsNext}` : 'absent'}`);

    // End-to-end expression of the same defect through the mirrored restore path: the
    // restored side's first applied delivery re-applies a contained move and mismatches.
    restored = new EscobaSide('guest', room, escobaScript(), {});
    restored.restoreFromSave(lastSave);
    await until(() => restored.mp.appliedSeq > (lastSave.mp.seq | 0) || restored.mismatches > 0 || restored.failedHard || restored.errors.length > 0, 10000, 'E4 restored side applies something');
    ok('E4 [KNOWN-BUG PROBE]: restored guest replays the tail cleanly (zero mismatches, no errors)',
      restored.mismatches === 0 && !restored.failedHard && restored.errors.length === 0,
      `restored mismatches=${restored.mismatches} failedHard=${restored.failedHard} errors=${restored.errors.map(String).join('; ') || 'none'}`);
  } catch (e) {
    fail++;
    let diag = '';
    if (restored) {
      const g = restored.game;
      diag = `\n      diagnostics: appliedSeq=${restored.mp.appliedSeq} pending=${!!restored.mp.pendingResolve} awaitingRoundN=${restored.mp.awaitingRoundN}` +
             (g ? ` round=${g.round} nextTurn=${g._nextTurn} stock=${g.stock.length} hands=${g.players.map((p) => p.hand.length).join('/')} winner=${!!g.winner}` : ' (no game)') +
             (restored.errors.length ? `\n      engine errors: ${restored.errors.map(String).join('; ')}` : '');
    }
    console.log(`FAIL  E4 did not complete: ${e.message}${diag}`);
  }
  finally { cleanup(room, host, guest); if (restored) restored.kill(); }
}

// --- C4: mid-match rejoin from the round-boundary autosave -------------------------
console.log('\n--- C4: Chinchón rejoin from autosave (KNOWN-BUG PROBE: restore re-runs initMatch) ---');
{
  const { room, host, guest } = await makeChinchon({ victoryCondition: 'points', scoreLimit: 500, maxResets: 2 }, true, {});
  try {
    await until(() => guest.saves.length >= 1, 20000, 'C4 round-1 boundary autosave exists');
    const boundarySave = deep(guest.saves[0]);
    const scoresAtSave = boundarySave.snap.players.map((p) => p.totalScore);
    cleanup(room, host, guest);   // the save is captured; the live match is no longer needed

    // Restore on an isolated room so the probe reads the fromSnapshot outcome itself,
    // not the state after the desync/recovery churn the buggy restore then triggers
    // (playMatch()'s body runs synchronously through initMatch() and startRound() up to
    // its first await, so the wipe - if it happens - is observable immediately).
    const isoRoom = new FakeRoom();
    isoRoom.round = { n: boundarySave.snap.round, deck: [], dealer: 0 };
    isoRoom.status = 'active';
    const restored = new ChinchonSide('guest', isoRoom, chinchonScript(true), {});
    restored.restoreFromSave(boundarySave);
    const restoredScores = restored.game ? restored.game.players.map((p) => p.totalScore) : null;
    const restoredRound = restored.game ? restored.game.round : null;
    restored.kill(); isoRoom.dead = true;
    ok('C4 [KNOWN-BUG PROBE]: restored engine keeps the saved scores and round (no initMatch wipe)\n' +
       '      (fails while chinchon/js/game.js:311-320 playMatch() takes the else-branch for a\n' +
       '      midRound:false snapshot - the ONLY kind chinchon MP ever saves, see the roundScored-\n' +
       '      boundary constraint at chinchon/js/ui.js:1925-1932 - and calls initMatch(), which\n' +
       '      ZEROES every totalScore/scoreHistory and restarts at round 1 with the snapshot\'s\n' +
       '      stale presetDeck. The restore feature\'s own doc comment promises "resumes from the\n' +
       '      last completed round\'s start, fast-replaying via the move log"; what it actually does\n' +
       '      is restart the match. Live consequences: the rejoining player sees zeroed scores; its\n' +
       '      replayed own-turn decisions OVERWRITE the host\'s entries in the shared move log; and\n' +
       '      if BOTH devices restore from autosaves (both backgrounded mid-match), there is no\n' +
       '      authoritative host left to recover from - the match\'s scores are simply gone, a\n' +
       '      THE-LAW-class loss)',
      restoredScores != null && JSON.stringify(restoredScores) === JSON.stringify(scoresAtSave) && restoredRound >= boundarySave.snap.round,
      `scores at save=${JSON.stringify(scoresAtSave)} (round ${boundarySave.snap.round}), after restore=${JSON.stringify(restoredScores)} (round ${restoredRound})`);
  } catch (e) { fail++; console.log(`FAIL  C4 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

console.log(fail
  ? `\n${fail} FAILURE(S) - the [KNOWN-BUG PROBE] failures assert intended behavior the product does not yet meet; see the probe messages and the tripwire report for mechanisms`
  : '\nALL PASS');
process.exit(fail ? 1 : 0);
