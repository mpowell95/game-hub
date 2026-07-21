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
//     _mpNewState            :1478          _mpNewState            :1702
//     humanAgent (decline)   :147-161       _makeRemoteAgent       :1717
//     _makeRemoteAgent       :1506          _mpTryDeliverNextMove  :1734
//     _mpTryDeliverNextMove  :1531          _mpAfterPlay           :1752
//     _mpAwaitDecisionValue  :1554          _mpHandleMismatch      :1781
//     _mpAwaitStockReset     :1567          _mpApplyRecovery       :1805
//     _mpAfterDecision       :1588          _mpApplyRoundData      :1836
//     _mpSendStockReset      :1617          _mpAwaitNextRound      :1844
//     _mpHandleMismatch      :1628          _mpOnRoomUpdate        :1919
//     _mpApplyRecovery       :1653          _mpHostStart           :1990
//     _mpAwaitNextRound      :1693          _mpGuestStartMatch     :2041
//     _mpOnRoomUpdate        :1767          onEvent MP hooks       :719-810
//     _mpHostStart           :1838          _saveSnapshot          :180-191
//     _mpGuestStartMatch     :1903          _tryRestoreMP          :2094
//     onEvent MP hooks       :706-786
//     _mpSaveSnapshot        :1971
//     _tryRestoreMP          :1993
//   Chinchón engine (chinchon/js/game.js): fromSnapshot :91, tryResetStock :270,
//   playMatch :322 (boundary-resume branch), finishRoundAfterPlay :374 (matchOver payload).
//   Shared room semantics mirrored from js/net.js: startRound clears the move log
//   (net.js:122-128), appendMove keys by padded seq (:132-137), writeRecovery replaces the
//   recovery field (:145-149), requestRecovery (:153-156), onValue fires once immediately on
//   subscribe (Firebase semantics; FakeRoom.onRoom does the same).
//
// SCENARIOS (per game where applicable) - ALL GREEN EXPECTED. The [KNOWN-BUG PROBE]
// assertions were born red against five real MP defects this suite surfaced when first
// written (chinchon guest match-end deadlock; stale cross-round presetStockResets;
// recovery seat swap in both games; escoba play-save seq off-by-one; chinchon restore
// initMatch wipe); all five were then fixed, and the probes now stand as regression
// tripwires - their failure messages still describe the original mechanism so a
// regression is instantly recognizable.
//   1. Full match to completion, deterministic scripted agents, hash verified on every applied
//      remote move (that IS the protocol) + final-state hash equality. C1 additionally probes
//      that the GUEST also concludes a points-ended match (payload.matchOver gate).
//   2. Chinchón only: stock exhaustion -> host-shuffled reset transmitted as a 'stock-reset'
//      entry -> identical post-reset play. 2a: within one round (the path QA never reached
//      live). 2b: a SECOND round that also exhausts (queue-consumption of presetStockResets).
//      (Escoba has no mid-round host-shuffle - decks are per-round only - noted as N/A.)
//   3. Forced desync: deliberately corrupt one guest-side application -> assert the mismatch is
//      DETECTED at the next hash compare, the recovery snapshot round-trips through
//      Game.fromSnapshot with seat-remapped isHuman flags, and the guest's own seat stays its
//      local human.
//   4. Mid-match rejoin: freeze the guest in-band, drop its live state, rebuild from its last
//      autosave exactly the way _tryRestoreMP does, replay the room-log tail, assert clean
//      convergence (no mismatches/recovery) and, for chinchon, that scores/round survive.
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
  awaitStockReset() {   // _mpAwaitStockReset (queue semantics: any queued entry is the next reset)
    const mp = this.mp;
    if (this.game.stock.length > 0 || this.game.resetsUsed >= this.game.config.maxResets) return Promise.resolve();
    const have = (this.game.config.presetStockResets || []).length;
    if (have > 0) return Promise.resolve();
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
  applyRecovery(recovery) {   // _mpApplyRecovery (seat-remapped isHuman + boundary-aware start - the C3/E3 fix)
    const mp = this.mp;
    if (!mp || this.dead) return;
    const snap = deep(recovery.state);
    const mySeat = this.role === 'host' ? 0 : 1;
    const agentsById = {};
    for (const sp of snap.players) {
      sp.isHuman = sp.id === mySeat;
      agentsById[sp.id] = sp.isHuman ? this.localAgent : this.remoteAgent();
    }
    if (this.game) this.game.abort();
    this.recoveriesApplied++;
    this.bindGame(CGame.fromSnapshot(snap, agentsById));
    mp.appliedSeq = recovery.seq;
    mp.pendingResolve = null; mp.pendingType = null; mp.pendingSeq = null; mp.pendingHash = null;
    mp.replayMode = false; mp.recoveryAttempts = 0;
    this.room.clearRecovery().catch(() => {});
    if (!snap.midRound && this.role === 'guest') this.awaitNextRound().then(() => this.startLoop());
    else this.startLoop();
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
        // _mpSaveSnapshot + guest gate, both on payload.matchOver (the engine decides
        // the match end BEFORE emitting and announces it in the payload - the C1 fix)
        if (!payload.matchOver) this.saves.push({ v: 1, code: 'T', role: this.role, seq: this.mp.appliedSeq, at: 0, snap: deep(this.game.snapshot()) });
        if (this.role === 'guest' && !payload.matchOver) await this.awaitNextRound();
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
  async restoreFromSave(save) {   // _tryRestoreMP (join/heartbeat elided; FakeRoom always reachable)
    const agentsById = {};
    for (const sp of save.snap.players) agentsById[sp.id] = sp.isHuman ? this.localAgent : this.remoteAgent();
    this.mp = mpNewState();
    this.mp.appliedSeq = save.seq | 0;
    this.bindGame(CGame.fromSnapshot(deep(save.snap), agentsById));
    // Boundary saves (the only kind chinchon MP writes) wait for the host's next-round
    // record before playing, mirroring the fixed _tryRestoreMP.
    if (this.role === 'guest' && !save.snap.midRound) await this.awaitNextRound();
    if (this.dead) return;
    this.startLoop();
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
  applyRecovery(recovery) {   // _mpApplyRecovery (seat-remapped isHuman + boundary-aware start - the E3 fix)
    const mp = this.mp;
    if (!mp || this.dead) return;
    const snap = deep(recovery.state);
    const mySeat = this.role === 'host' ? 0 : 1;   // mp.localSeat in the real glue
    const agentsById = {};
    for (const sp of snap.players) {
      sp.isHuman = sp.id === mySeat;
      agentsById[sp.id] = sp.isHuman ? this.localAgent : this.remoteAgent();
    }
    if (this.game) this.game.abort();
    this.recoveriesApplied++;
    this.bindGame(EGame.fromSnapshot(snap, agentsById));
    mp.appliedSeq = recovery.seq;
    mp.pendingResolve = null; mp.pendingSeq = null; mp.pendingHash = null;
    mp.replayMode = false; mp.recoveryAttempts = 0;
    this.room.clearRecovery().catch(() => {});
    if (!snap.midRound && this.role === 'guest') this.awaitNextRound().then(() => this.startLoop());
    else this.startLoop();
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
        // afterPlay FIRST, save second: _mpAfterPlay advances appliedSeq for this very
        // play, and the autosave records that seq (the E4 off-by-one fix).
        await this.afterPlay(p, payload);
        this.save('play');
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
  async restoreFromSave(save) {   // _tryRestoreMP (join elided; FakeRoom always reachable)
    const agentsById = {};
    for (const sp of save.snap.players) agentsById[sp.id] = sp.isHuman ? this.localAgent : this.remoteAgent();
    this.mp = mpNewState();
    this.mp.appliedSeq = save.mp.seq | 0;
    this.bindGame(EGame.fromSnapshot(deep(save.snap), agentsById));
    // Boundary saves resume with the next round: wait for the host's round record
    // (deck + dealer) first, mirroring the fixed _tryRestoreMP. Mid-round saves
    // (the common play-save) resume in place.
    if (this.role === 'guest' && !save.snap.midRound) await this.awaitNextRound();
    if (this.dead) return;
    this.startLoop();
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
       '      (REGRESSION GUARD: chinchon/js/game.js finishRoundAfterPlay (:374) must decide the match\n' +
       '      end BEFORE emitting roundScored and announce it as payload.matchOver, and the guest gate\n' +
       '      at chinchon/js/ui.js:772 must key on that field, never on this.game.winner - winner is\n' +
       '      null at that moment for every points/rounds ending. When the decision came after the\n' +
       '      emit, the guest blocked forever "waiting for host" at every normal match end and never\n' +
       '      ran its matchEnd hook, so recordChinchon/_commitStats never fired: the match was\n' +
       '      silently missing from the guest\'s gamehub.stats, a THE-LAW rule-6-class loss)',
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
       '      (REGRESSION GUARD: config.presetStockResets is a shift()-consumed QUEUE - chinchon/js/\n' +
       '      game.js tryResetStock (:270) - and _mpAwaitStockReset (chinchon/js/ui.js:1567) proceeds\n' +
       '      when ANY entry is queued. When it was an array indexed by the per-ROUND resetsUsed\n' +
       '      counter (which startRound zeroes while the array grew forever), round 2\'s first reset\n' +
       '      silently replayed round 1\'s shuffle order, the guest\'s stock diverged from the host\'s\n' +
       '      fresh shuffle, and every multi-round MP match with resets in two rounds desynced)',
      host.mismatches + guest.mismatches === 0 && host.game.round >= 3,
      `mismatches host=${host.mismatches} guest=${guest.mismatches} at round=${host.game.round}`);
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
       '      (REGRESSION GUARD: recovery snapshots carry the SENDER\'s isHuman flags, and isHuman is\n' +
       '      device-RELATIVE - _mpApplyRecovery (escoba/js/ui.js:1805) must remap by seat\n' +
       '      (mp.localSeat) and normalize the flags before rebuilding. Trusting the transmitted\n' +
       '      flags handed the guest\'s human agent to the HOST\'s seat and a network RemoteAgent to\n' +
       '      its own: the recovered player was prompted for the opponent\'s cards while their own\n' +
       '      turns waited on the network forever, so recovery - the safety net every other MP\n' +
       '      defect leans on - could never actually land)',
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
       '      (same REGRESSION GUARD as E3: chinchon/js/ui.js:1653 _mpApplyRecovery must remap the\n' +
       '      transmitted host-relative isHuman flags by seat before rebuilding)',
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
       '      (REGRESSION GUARD: escoba/js/ui.js\'s \'play\' hook (:768-780) must run _mpAfterPlay -\n' +
       '      which advances appliedSeq for this very play - BEFORE _saveSnapshot records that seq.\n' +
       '      When the save came first, every play-event autosave stored mp.seq one LOW relative to\n' +
       '      the play already in its snapshot, so _tryRestoreMP rebuilt at post-move-N state with\n' +
       '      appliedSeq N-1 and re-applied move N: a guaranteed desync on every rejoin, the exact\n' +
       '      case the 30-minute restore window exists for)',
      !snapAlreadyContainsNext,
      `save.mp.seq=${lastSave.mp.seq} (kind=play), room entry at seq ${(lastSave.mp.seq | 0) + 1} ${entry ? `hash-matches the snapshot state: ${snapAlreadyContainsNext}` : 'absent'}`);

    // End-to-end expression of the same defect through the mirrored restore path: the
    // restored side's first applied delivery re-applies a contained move and mismatches.
    restored = new EscobaSide('guest', room, escobaScript(), {});
    await restored.restoreFromSave(lastSave);
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
  // In-band freeze (same reasoning as E4): stop the guest's delivery a few decisions
  // into round 2, so the lockstep cascade halts there instead of racing the whole
  // match to completion between two timer polls.
  let guestRef = null;
  const frozen = () => guestRef !== null && guestRef.saves.length >= 1 && guestRef.mp.appliedSeq >= (guestRef.saves[0].seq | 0) + 4;
  const { room, host, guest } = await makeChinchon({ victoryCondition: 'points', scoreLimit: 500, maxResets: 2 }, true, { guest: { frozen } });
  guestRef = guest;
  try {
    await until(() => guest.saves.length >= 1, 20000, 'C4 round-1 boundary autosave exists');
    const boundarySave = deep(guest.saves[0]);
    const scoresAtSave = boundarySave.snap.players.map((p) => p.totalScore);
    // The restore path resumes with the NEXT round and (correctly) waits for the host's
    // round record - capture the real one the live host published before tearing down.
    await until(() => room.round && room.round.n === boundarySave.snap.round + 1, 15000, 'C4 host published the next round');
    const nextRound = deep(room.round);
    cleanup(room, host, guest);   // save + round record captured; the live match is no longer needed

    // Restore on an isolated room (carrying the captured round record) so the probe
    // reads the restore outcome itself, not the state after any subsequent live play.
    // playMatch()'s body runs synchronously through its resume branch and startRound()
    // up to the first await, so scores/round are observable right after restore.
    const isoRoom = new FakeRoom();
    isoRoom.round = nextRound;
    isoRoom.status = 'active';
    const restored = new ChinchonSide('guest', isoRoom, chinchonScript(true), {});
    await restored.restoreFromSave(boundarySave);
    const restoredScores = restored.game ? restored.game.players.map((p) => p.totalScore) : null;
    const restoredRound = restored.game ? restored.game.round : null;
    restored.kill(); isoRoom.dead = true;
    ok('C4 [KNOWN-BUG PROBE]: restored engine keeps the saved scores and round (no initMatch wipe)\n' +
       '      (REGRESSION GUARD: chinchon/js/game.js playMatch (:322) must take the _resumeNextRound\n' +
       '      branch for a midRound:false snapshot - the ONLY kind chinchon MP saves - continuing\n' +
       '      with the next round, scores/dealer kept, and _tryRestoreMP (chinchon/js/ui.js:1993)\n' +
       '      must await the host\'s round record before playing. When this fell through to\n' +
       '      initMatch(), every totalScore/scoreHistory was ZEROED and the match restarted at\n' +
       '      round 1 with a stale presetDeck; with BOTH devices restoring at once there was no\n' +
       '      authoritative host to recover from and the match\'s scores were simply gone - a\n' +
       '      THE-LAW-class loss)',
      restoredScores != null && JSON.stringify(restoredScores) === JSON.stringify(scoresAtSave) && restoredRound === boundarySave.snap.round + 1,
      `scores at save=${JSON.stringify(scoresAtSave)} (round ${boundarySave.snap.round}), after restore=${JSON.stringify(restoredScores)} (round ${restoredRound})`);
  } catch (e) { fail++; console.log(`FAIL  C4 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

console.log(fail
  ? `\n${fail} FAILURE(S) - a red [KNOWN-BUG PROBE] means a previously-fixed MP defect has REGRESSED; its message names the mechanism and file:line`
  : '\nALL PASS');
process.exit(fail ? 1 : 0);
