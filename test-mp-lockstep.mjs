// test-mp-lockstep.mjs - headless two-engine lockstep simulation for ALL FIVE multiplayer games
// (Chinchón M2b, Escoba M1, Tic Tac Toe phase 1, Mancala/Filler/Dots and Boxes phase 2). No Firebase,
// no DOM: an in-file FakeRoom
// emulates the rooms/<CODE> node (move log, round records, recovery field, result) and two
// mirrored "glue" sides drive the REAL engine/hash/preset-deck/snapshot modules exactly the way
// each game's ui.js does.
//
// WHY MIRRORS, NOT IMPORTS: chinchon/js/ui.js, escoba/js/ui.js and tic-tac-toe/js/ui.js all
// construct DOM in their module class constructors (mount(), stylesheet injection), so they
// cannot load headless. The engines, hashes, and snapshot paths ARE the real modules; only the
// MP glue per game is mirrored here, statement-for-statement, from the citations below. If the
// glue changes, update the mirror WITH it - each mirror method cites its source so the drift is
// checkable:
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
//   Tic Tac Toe (tic-tac-toe/js/ui.js) - every _mp* method plus the seat helpers:
//     _localSeat/_myMark/_oppMark/_seatOfMark, _isLegal, _mpNewState, _mpEncodeMove/_mpDecodeMove,
//     _mpAfterLocalMove, _mpTryDeliverNextMove, _mpApplyNextEntry, _mpHandleMismatch, _mpSnapshot,
//     _mpApplyRecovery, _mpApplyRoundRecord, _mpStartNextGame, _mpAwaitNextGame, _mpAfterGameEnd,
//     _mpRoomCallback, _mpOnRoomUpdate, _mpSaveSnapshot, _tryRestoreMP, and the MP branch of
//     _afterStateChange. Named rather than line-numbered on purpose: this game's MP pass shipped
//     with the file, so the names are stable and line numbers would rot on the first edit.
//   Mancala (mancala/js/ui.js) - the same _mp* family plus _localSeat/_remoteSeat/_humanSide,
//     _isLegal, _mpNewState, _mpEncodeMove/_mpDecodeMove, _mpAfterLocalMove,
//     _mpTryDeliverNextMove/_mpApplyNextEntry (ASYNC here - see the class comment below for why),
//     _mpOnDivergence, _mpSnapshot, _mpApplyRecovery, _mpStartMatch/_mpApplyRoundRecord,
//     _mpRoomCallback/_mpOnRoomUpdate, _mpSaveSnapshot/_mpLoadSave, _tryRestoreMP, and the MP
//     branch of finishMove/finish. Also named rather than line-numbered, same reasoning.
//   Filler (filler/js/ui.js) - the same _mp* family plus _localSeat/_remoteSeat, _isLegal,
//     _mpNewState, _mpEncodeMove/_mpDecodeMove, _mpAfterLocalMove, _mpTryDeliverNextMove/
//     _mpApplyNextEntry (ASYNC and PACED, like Mancala's - see the class comment below for why),
//     _mpOnDivergence, _mpNormalizeSeries, _mpSnapshot, _mpApplyRecovery, _mpStartNextGame/
//     _mpApplyRoundRecord, _mpAfterGameEnd/_seriesLine, _mpRoomCallback/_mpOnRoomUpdate,
//     _mpSaveSnapshot/_mpLoadSave, _tryRestoreMP, and the MP branch of _afterMove/finish. Also
//     named rather than line-numbered, same reasoning.
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
import { newGame as tNewGame, applyMove as tApply, legalMoves as tLegal, X as TX, O as TO } from './tic-tac-toe/js/game.js';
import { stateHash as tHash } from './tic-tac-toe/js/hash.js';
import { P1 as mP1, P2 as mP2, P1_STORE as mP1_STORE, P2_STORE as mP2_STORE, newGame as mNewGame, legalMoves as mLegal, applyMove as mApply } from './mancala/js/game.js';
import { stateHash as mHash } from './mancala/js/hash.js';
import { P1 as fP1, P2 as fP2, newGame as fNewGame, cloneGame as fCloneGame, legalColors as fLegalColors, applyMove as fApplyMove } from './filler/js/game.js';
import { stateHash as fHash } from './filler/js/hash.js';
import { newGame as dNewGame, legalMoves as dLegal, applyMove as dApply, edgeKey as dEdgeKey, isOver as dIsOver, score as dScore } from './dots-boxes/js/game.js';
import { stateHash as dHash } from './dots-boxes/js/hash.js';

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
// TIC TAC TOE side (mirror of tic-tac-toe/js/ui.js's MP glue)
//
// Shape difference worth stating once: this game has NO agent interface. Chinchón and
// Escoba's engines await a per-player `agent` object, so their MP glue swaps in a
// _makeRemoteAgent(). Tic Tac Toe's engine is a synchronous applyMove(state, move) and
// the UI decides who acts, so the remote seat is a third kind of TURN OWNER in the UI's
// own dispatch: where solo schedules the AI on a timer, MP waits for the next entry in
// the room's move log. Everything else - the seq-keyed log, the per-move hash verify,
// host-authoritative recovery - is the same protocol.
//
// Vocabulary map (js/net.js is untouched, so its field names are reused as-is):
//   a "round" record  = ONE GAME of a rematch series in the room
//   round.n           = the game number
//   round.deck        = unused (no cards)
//   round.dealer      = the SEAT that plays X in that game (the "who opens" datum)
//   writeResult       = deliberately NOT used; status:'ended' means somebody abandoned
// ==================================================================================
function tttNewState(role, variant) {   // _mpNewState (UI-only fields dropped)
  return {
    role, localSeat: role === 'host' ? 0 : 1,
    variant: variant === 'classic' ? 'classic' : 'ultimate',
    gameNum: 0, xSeat: 0,
    series: { wins: [0, 0], draws: 0 },
    appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
    replayMode: false, recoveryAttempts: 0, delivering: false, awaitingRecovery: false,
    opponentLeft: false, lastRoomSnapshot: null,
    lastRecoveryHandled: null, lastRecoveryApplied: null,
    lastScoredGame: 0, awaitingGameN: null, awaitingGameResolve: null,
  };
}
const tttNormSeries = (s) => ({ wins: [((s && s.wins) || [])[0] | 0, ((s && s.wins) || [])[1] | 0], draws: (s && s.draws) | 0 });

class TicTacToeSide {
  constructor(role, room, policy, opts = {}) {
    this.role = role; this.room = room; this.policy = policy; this.opts = opts;
    this.mp = null; this.state = null; this.marks = [TX, TO];
    this.dead = false; this.failedHard = false;
    this.mismatches = 0; this.recoveriesApplied = 0; this.errors = [];
    this.statsCommitted = false;
    this.gamesFinished = 0;
    this.statsCommits = [];   // _commitStats's arguments, captured instead of written
    this.saves = [];          // in-memory _mpSaveSnapshot
    this.roundResets = [];    // harness-only: what each applyRoundRecord reset actually saw
    this._roomCb = (r) => this.roomCallback(r);
    room.onRoom(this._roomCb);
  }

  // --- seats: the whole point of _localSeat(). A guest's own seat is 1. -----------
  localSeat() { return this.mp ? this.mp.localSeat : 0; }
  remoteSeat() { return 1 - this.localSeat(); }
  myMark() { return this.marks[this.localSeat()]; }
  oppMark() { return this.marks[this.remoteSeat()]; }
  seatOfMark(mark) { return this.marks[0] === mark ? 0 : 1; }

  isLegal(move) {   // _isLegal - the ONE legality gate, read by the local tap AND every remote move
    const s = this.state;
    if (!s || s.over) return false;
    const legal = tLegal(s);
    return s.variant === 'ultimate'
      ? legal.some((m) => m.board === move.board && m.cell === move.cell)
      : legal.includes(move);
  }

  encodeMove(move) {   // _mpEncodeMove - `g` stamps the game number onto every entry
    const g = this.mp.gameNum;
    return this.state.variant === 'ultimate'
      ? { t: 'move', g, b: move.board | 0, c: move.cell | 0 }
      : { t: 'move', g, c: move | 0 };
  }
  decodeMove(m) {   // _mpDecodeMove
    return this.state.variant === 'ultimate' ? { board: m.b | 0, cell: m.c | 0 } : (m.c | 0);
  }

  afterLocalMove(move) {   // _mpAfterLocalMove - seq reserved SYNCHRONOUSLY, before any await
    const mp = this.mp;
    if (!mp) return;
    const seq = ++mp.appliedSeq;
    const hash = tHash(this.state);
    this.room.appendMove(this.role, seq, this.encodeMove(move), hash).catch(() => {});
  }

  tryDeliver() {   // _mpTryDeliverNextMove - the `delivering` flag turns re-entry into iteration
    const mp = this.mp;
    if (!mp || mp.delivering || mp.awaitingRecovery || this.dead || !this.state) return;
    if (this.opts.frozen && this.opts.frozen()) return;   // harness-only freeze (a backgrounded device)
    mp.delivering = true;
    try { while (this.applyNextEntry()) { /* drain */ } }
    finally { mp.delivering = false; }
  }

  applyNextEntry() {   // _mpApplyNextEntry
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !mp.movesById || !this.state || this.state.over) return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry || !entry.move || entry.move.t !== 'move') return false;
    if ((entry.move.g | 0) !== (mp.gameNum | 0)) return false;   // never consume another game's entry
    const move = this.decodeMove(entry.move);
    let agreed = this.isLegal(move);
    if (agreed) {
      tApply(this.state, move);
      if (this.opts.corruptAtSeq === seq && !this._corrupted) {
        // A pure HASH divergence with zero gameplay effect (winLine is recomputed by the
        // engine on every move and read by nothing else), so the probe measures detection
        // and recovery rather than the chaos of an illegal board.
        this._corrupted = true;
        this.state.winLine = [0, 1, 2];
      }
      agreed = tHash(this.state) === entry.h;
    }
    if (!agreed) { this.mismatches++; return this.onDivergence(seq); }
    mp.appliedSeq = seq;
    mp.recoveryAttempts = 0;
    if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
    this.afterStateChange();
    return true;
  }

  onDivergence(seq) {   // _mpOnDivergence - host takes the seq and publishes; guest latches
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { this.failedHard = true; return false; }
    if (mp.role === 'host') {
      mp.appliedSeq = seq;
      this.room.writeRecovery(seq, this.snapshot()).catch(() => {});
      this.afterStateChange();
      return true;
    }
    mp.awaitingRecovery = true;
    this.room.requestRecovery(seq).catch(() => {});
    return false;
  }

  snapshot() {   // _mpSnapshot - seat-indexed/absolute ONLY, nothing device-relative
    const mp = this.mp;
    return {
      v: 1, variant: mp.variant, gameNum: mp.gameNum, xSeat: mp.xSeat,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      state: deep(this.state),
    };
  }

  applyRecovery(recovery) {   // _mpApplyRecovery - own mark RE-DERIVED from own seat
    const mp = this.mp;
    if (!mp || this.dead) return;
    const snap = deep(recovery.state);
    mp.variant = snap.variant;
    mp.gameNum = snap.gameNum | 0;
    mp.xSeat = snap.xSeat === 1 ? 1 : 0;
    mp.series = tttNormSeries(snap.series);
    this.marks = mp.xSeat === 0 ? [TX, TO] : [TO, TX];
    this.state = snap.state;
    mp.appliedSeq = recovery.seq | 0;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq | 0, mp.appliedSeq);
    mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    this.recoveriesApplied++;
    this.room.clearRecovery().catch(() => {});
    this.afterStateChange();
  }

  applyRoundRecord(round, room) {   // _mpApplyRoundRecord - the ONE place a game's seat->mark is decided
    const mp = this.mp;
    if (!mp || this.dead || !round) return;
    mp.gameNum = round.n | 0;
    mp.xSeat = round.dealer === 1 ? 1 : 0;
    this.marks = mp.xSeat === 0 ? [TX, TO] : [TO, TX];
    mp.appliedSeq = 0; mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    const entries = Object.values((room && room.moves) || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    mp.maxKnownSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
    this.statsCommitted = false;
    this.state = tNewGame(mp.variant, TX);
    // HARNESS ONLY: freeze what the per-game reset actually saw, so T5 can probe the
    // exact instant a new game begins rather than whatever the log looks like a few
    // microtasks later (by then the new game's own first move has already landed).
    this.roundResets.push({
      n: mp.gameNum,
      appliedSeq: mp.appliedSeq,
      cached: mp.movesById.size,
      staleCached: [...mp.movesById.values()].filter((e) => (e.move.g | 0) !== mp.gameNum).length,
    });
    this.afterStateChange();
  }

  /** _mpStartNextGame. The real method resolves who opens through _resolveStarter()
   *  (localStorage + the setup screen); the harness passes the resolved seat in, which
   *  is the only thing that method contributes. Default: alternate, so game 2 puts X on
   *  the GUEST's seat - the case a seat bug hides in. */
  async startNextGame(xSeat) {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this.dead) return;
    const n = (mp.gameNum | 0) + 1;
    const seat = xSeat != null ? xSeat : (mp.gameNum | 0) % 2;
    await this.room.startRound(n, null, seat);
    if (this.dead || !this.mp) return;
    if ((this.mp.gameNum | 0) < n) this.applyRoundRecord({ n, dealer: seat }, null);
  }

  awaitNextGame() {   // _mpAwaitNextGame - the guest NEVER derives who opens locally
    const mp = this.mp;
    const target = (mp.gameNum | 0) + 1;
    const room = mp.lastRoomSnapshot;
    if (room && room.round && (room.round.n | 0) >= target) {
      this.applyRoundRecord(room.round, room);
      return Promise.resolve();
    }
    return new Promise((resolve) => { mp.awaitingGameN = target; mp.awaitingGameResolve = resolve; });
  }

  afterGameEnd() {   // _mpAfterGameEnd - series tally, idempotent per game number
    const mp = this.mp, s = this.state;
    if (!mp || !s || !s.over) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    if (s.isDraw) mp.series.draws += 1;
    else mp.series.wins[this.seatOfMark(s.winner)] += 1;
    this.save();
  }

  commitStats() {   // _commitStats - `won` resolves through myMark(), i.e. through localSeat()
    if (this.statsCommitted) return;
    this.statsCommitted = true;
    const s = this.state;
    const won = s.isDraw ? null : (s.winner === this.myMark());
    this.statsCommits.push({ game: this.mp.gameNum, variant: s.variant, difficulty: 'mp', won });
  }

  save() {   // _mpSaveSnapshot - seq read AFTER this move's own MP bookkeeping
    const mp = this.mp;
    if (!mp || !this.state) return;
    this.saves.push({
      v: 1, code: 'T', role: this.role, seq: mp.appliedSeq | 0, at: 0,
      variant: mp.variant, gameNum: mp.gameNum | 0, xSeat: mp.xSeat | 0,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      midGame: !this.state.over, statsCommitted: !!this.statsCommitted,
      state: deep(this.state),
    });
  }

  afterStateChange() {   // _afterStateChange, MP branch (save FIRST is the invariant-4 ordering)
    if (this.dead) return;
    this.save();
    if (this.state.over) {
      this.commitStats();      // finish(): _commitStats then _mpAfterGameEnd
      this.afterGameEnd();
      this.gamesFinished++;
      return;
    }
    this.tryDeliver();
    this.takeTurnIfMine();
  }

  /** HARNESS ONLY: stands in for the local human's tap. The real UI waits for a click on
   *  a live cell; humanMove() below is the real method it calls. */
  takeTurnIfMine() {
    if (this.dead || !this.state || this.state.over) return;
    if (this.state.turn !== this.myMark()) return;
    queueMicrotask(() => {
      if (this.dead || !this.state || this.state.over) return;
      if (this.state.turn !== this.myMark()) return;
      this.humanMove(this.policy(this.state));
    });
  }

  humanMove(move) {   // humanMove - local apply, MP bookkeeping, then the funnel
    if (!this.state || this.state.over || this.state.turn !== this.myMark()) return;
    if (!this.isLegal(move)) return;
    tApply(this.state, move);
    this.afterLocalMove(move);
    this.afterStateChange();
  }

  roomCallback(room) {   // _mpRoomCallback
    if (this.dead) return;
    if (this.mp) { this.onRoomUpdate(room); return; }
    if (this.role === 'guest' && this.opts.autoStart && room.status === 'active' && room.round) this.guestStart(room);
  }

  guestStart(room) {   // _mpGuestStartMatch
    if (this.mp || this.dead) return;
    this.mp = tttNewState('guest', room.config && room.config.variant);
    this.mp.lastRoomSnapshot = room;
    this.applyRoundRecord(room.round, room);
  }

  hostStartMatch(variant, xSeat) {   // _mpHostStartMatch
    this.mp = tttNewState('host', variant);
    return this.startNextGame(xSeat);
  }

  onRoomUpdate(room) {   // _mpOnRoomUpdate
    if (this.dead || !this.mp || !room) return;
    const mp = this.mp;
    mp.lastRoomSnapshot = room;
    if (room.status === 'ended' && !mp.opponentLeft) { mp.opponentLeft = true; return; }
    if (room.recovery) {
      if (mp.role === 'host' && room.recovery.requested != null && room.recovery.requested !== mp.lastRecoveryHandled) {
        mp.lastRecoveryHandled = room.recovery.requested;
        this.room.writeRecovery(mp.appliedSeq, this.snapshot()).catch(() => {});
      }
      if (mp.role === 'guest' && room.recovery.state && room.recovery.seq !== mp.lastRecoveryApplied) {
        mp.lastRecoveryApplied = room.recovery.seq;
        this.applyRecovery(room.recovery);
      }
    }
    const roundN = room.round ? (room.round.n | 0) : 0;
    if (room.round && roundN > (mp.gameNum | 0)) {
      this.applyRoundRecord(room.round, room);
    } else if (roundN === (mp.gameNum | 0)) {
      const entries = Object.values(room.moves || {});
      mp.movesById = new Map(entries.map((m) => [m.seq, m]));
      const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
      if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
      mp.maxKnownSeq = maxSeq;
      this.tryDeliver();
      this.takeTurnIfMine();
    }
    // roundN < gameNum: a snapshot that predates the record we already applied. Its move
    // log belongs to the previous game and is ignored entirely.
    if (mp.awaitingGameResolve && room.round && roundN >= mp.awaitingGameN) {
      const resolve = mp.awaitingGameResolve;
      mp.awaitingGameN = null; mp.awaitingGameResolve = null;
      resolve();
    }
  }

  async restoreFromSave(save) {   // _tryRestoreMP (the join/heartbeat half elided: FakeRoom is always reachable)
    this.mp = tttNewState(this.role, save.variant);
    const mp = this.mp;
    mp.gameNum = save.gameNum | 0;
    mp.xSeat = save.xSeat === 1 ? 1 : 0;
    mp.appliedSeq = save.seq | 0;
    mp.maxKnownSeq = mp.appliedSeq;
    mp.series = tttNormSeries(save.series);
    mp.lastScoredGame = save.midGame ? 0 : mp.gameNum;
    this.marks = mp.xSeat === 0 ? [TX, TO] : [TO, TX];
    this.state = deep(save.state);
    this.statsCommitted = !!save.statsCommitted;
    if (save.midGame) { this.tryDeliver(); this.takeTurnIfMine(); return; }
    if (this.state.over) this.commitStats();
    if (this.role === 'guest') await this.awaitNextGame();
    else await this.startNextGame();
  }

  kill() { this.dead = true; this.room.offRoom(this._roomCb); }
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
// Tic Tac Toe: both sides run the SAME deterministic policy, so the move stream is
// identical no matter which seat is deciding (only the deciding side's choice is ever
// used; the other receives it through the room).
//   tttFirstLegal - always legalMoves(s)[0]. DECISIVE on Classic (X completes 2-4-6 on
//                   move 7) and plays a full Ultimate game through real board routing.
//   tttDrawScript - a hand-checked Classic cell order that fills all nine cells with no
//                   line. The DRAW is what invariant 1's probe needs: a drawn game is
//                   over with winner === null, so any "is it finished" gate written
//                   against `winner` instead of `over` hangs exactly there (see T2).
const tttFirstLegal = () => (s) => tLegal(s)[0];
const TTT_DRAW_CELLS = [0, 2, 1, 3, 5, 4, 6, 7, 8];
const tttDrawScript = () => (s) => TTT_DRAW_CELLS[s.moves];

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

function makeTicTacToe(variant, policy, opts = {}) {
  const room = new FakeRoom();
  room.config = { variant };
  const host = new TicTacToeSide('host', room, policy, opts.host || {});
  const guest = new TicTacToeSide('guest', room, policy, Object.assign({ autoStart: true }, opts.guest || {}));
  host.hostStartMatch(variant, opts.xSeat != null ? opts.xSeat : 0);
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


// ==================================================================================
// TIC TAC TOE (phase 1, HANDOFF-MP-ROADMAP.md). T1/T3 are ordinary lockstep coverage;
// T2/T4/T5/T6/T7 are the five js/CLAUDE.md:271 invariants ported into this game's own
// vocabulary. Invariant 3 is the one that does not map literally - its reason is in
// T5's own message, not silently dropped.
// ==================================================================================

// --- T1: Classic full game + the seat-identity (THE LAW rule 2) check ---------------
console.log('\n--- T1: Tic Tac Toe Classic full game, lockstep, hash-verified every applied move ---');
{
  const { room, host, guest } = makeTicTacToe('classic', tttFirstLegal());
  try {
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 15000, 'T1 game end');
    ok('T1: both sides completed the game (no hard failure)',
      host.gamesFinished === 1 && guest.gamesFinished === 1 && !host.failedHard && !guest.failedHard);
    ok('T1: zero hash mismatches across the whole game', host.mismatches === 0 && guest.mismatches === 0, `host=${host.mismatches} guest=${guest.mismatches}`);
    ok('T1: zero recoveries needed', host.recoveriesApplied === 0 && guest.recoveriesApplied === 0);
    ok('T1: final states hash-identical', tHash(host.state) === tHash(guest.state));
    ok('T1: same winner on both sides', host.state.winner === guest.state.winner, `host=${host.state.winner} guest=${guest.state.winner}`);
    ok('T1: no move-log overwrites (the shared seq never collided)', room.overwrites.length === 0, JSON.stringify(room.overwrites));
    ok('T1: host holds seat 0 / X, guest holds seat 1 / O',
      host.localSeat() === 0 && host.myMark() === TX && guest.localSeat() === 1 && guest.myMark() === TO,
      `host seat ${host.localSeat()} mark ${host.myMark()} / guest seat ${guest.localSeat()} mark ${guest.myMark()}`);
    const hc = host.statsCommits[0], gc = guest.statsCommits[0];
    ok('T1: each device recorded exactly one result, in the mp difficulty bucket',
      host.statsCommits.length === 1 && guest.statsCommits.length === 1 && hc.difficulty === 'mp' && gc.difficulty === 'mp',
      JSON.stringify([host.statsCommits, guest.statsCommits]));
    ok('T1: the guest recorded ITS OWN result, not the host\'s (X won, so host=true / guest=false)\n' +
       '      (THE LAW rule 2: a loss written as a win is not additive-safe. This is the headless\n' +
       '      half of HANDOFF-MP-LOCAL-MACHINE.md\'s B2 check - the other half needs two real devices)',
      hc.won === true && gc.won === false, `host.won=${hc.won} guest.won=${gc.won} winner=${host.state.winner}`);
  } catch (e) { fail++; console.log(`FAIL  T1 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- T2: INVARIANT 1 ported - a DRAW is a game end, and winner is null at it --------
console.log('\n--- T2: Tic Tac Toe drawn game (KNOWN-BUG PROBE: guest hangs at a winner-less end) ---');
{
  const { room, host, guest } = makeTicTacToe('classic', tttDrawScript());
  try {
    await until(() => host.gamesFinished || host.failedHard || guest.failedHard, 15000, 'T2 host game end');
    ok('T2: the scripted game really is a DRAW (all nine cells, no line)',
      host.state.over && host.state.isDraw && host.state.winner === null,
      `over=${host.state.over} isDraw=${host.state.isDraw} winner=${host.state.winner} moves=${host.state.moves}`);
    ok('T2: zero hash mismatches', host.mismatches === 0 && guest.mismatches === 0);
    await new Promise((r) => setTimeout(r, 400));
    ok('T2 [KNOWN-BUG PROBE]: the GUEST also concludes a drawn game, and records it\n' +
       '      (REGRESSION GUARD, invariant 1 in Tic Tac Toe\'s vocabulary: every "is this game\n' +
       '      finished" gate must key on state.OVER, which applyMove sets before returning for a\n' +
       '      win AND a draw - never on state.winner, which is null at the exact moment a drawn\n' +
       '      game ends. This is Chinchon\'s payload.matchOver bug in a game with no rounds: there,\n' +
       '      gating on game.winner deadlocked the guest at every points/rounds ending and silently\n' +
       '      skipped its stats recording. Classic vs a perfect opponent is DRAW-HEAVY by\n' +
       '      construction (Classic Pro is solved), so a winner-gated end would strand the guest on\n' +
       '      the majority of real games and lose the play from its gamehub.stats)',
      guest.gamesFinished === 1 && guest.statsCommits.length === 1,
      `guest.gamesFinished=${guest.gamesFinished} commits=${JSON.stringify(guest.statsCommits)} state.over=${guest.state && guest.state.over}`);
    ok('T2: both devices recorded the draw AS a draw (won === null, never a fabricated win/loss)',
      host.statsCommits[0].won === null && guest.statsCommits[0].won === null,
      JSON.stringify([host.statsCommits[0], guest.statsCommits[0]]));
  } catch (e) { fail++; console.log(`FAIL  T2 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- T3: Ultimate - the board-routing variant --------------------------------------
console.log('\n--- T3: Tic Tac Toe Ultimate full game (board routing stays in step) ---');
{
  const { room, host, guest } = makeTicTacToe('ultimate', tttFirstLegal());
  try {
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 30000, 'T3 game end');
    ok('T3: both sides completed the Ultimate game', host.gamesFinished === 1 && guest.gamesFinished === 1 && !host.failedHard && !guest.failedHard);
    ok('T3: zero hash mismatches', host.mismatches === 0 && guest.mismatches === 0, `host=${host.mismatches} guest=${guest.mismatches}`);
    ok('T3: it really was a long routed game, not a 9-move accident', host.state.moves > 9, `moves=${host.state.moves}`);
    ok('T3: final states hash-identical', tHash(host.state) === tHash(guest.state));
    ok('T3: both sides agree on the META-BOARD and the FORCED BOARD\n' +
       '      (the derived routing state is what an Ultimate desync hides in - the wrong sub-board\n' +
       '      unlocked on the remote side. tic-tac-toe/js/hash.js puts meta and forcedBoard IN the\n' +
       '      hash precisely so that shows up as a detected mismatch instead of silent divergence)',
      JSON.stringify(host.state.meta) === JSON.stringify(guest.state.meta) && host.state.forcedBoard === guest.state.forcedBoard,
      `meta host=${JSON.stringify(host.state.meta)} guest=${JSON.stringify(guest.state.meta)}; forced host=${host.state.forcedBoard} guest=${guest.state.forcedBoard}`);
    ok('T3: no move-log overwrites', room.overwrites.length === 0, JSON.stringify(room.overwrites));
  } catch (e) { fail++; console.log(`FAIL  T3 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- T4: INVARIANT 2 ported - forced desync, recovery, seat identity ----------------
console.log('\n--- T4: Tic Tac Toe forced desync + recovery (KNOWN-BUG PROBE: recovery swaps the seats) ---');
{
  const { room, host, guest } = makeTicTacToe('classic', tttFirstLegal(), { guest: { corruptAtSeq: 3 } });
  try {
    await until(() => guest.recoveriesApplied >= 1 || guest.failedHard || host.failedHard, 15000, 'T4 recovery applied');
    ok('T4: corruption was DETECTED as a hash mismatch', guest.mismatches >= 1, `guest mismatches=${guest.mismatches}`);
    ok('T4: host answered the desync flag with a recovery snapshot', guest.recoveriesApplied >= 1, `recoveries=${guest.recoveriesApplied}`);
    ok('T4 [KNOWN-BUG PROBE]: after recovery the guest still plays ITS OWN seat\n' +
       '      (REGRESSION GUARD, invariant 2: a transmitted snapshot\'s "which side am I" fields are\n' +
       '      the SENDER\'s. tic-tac-toe/js/ui.js\'s _mpSnapshot therefore transmits nothing\n' +
       '      device-relative at all - only the absolute board and the seat-indexed xSeat/series -\n' +
       '      and _mpApplyRecovery re-derives this device\'s own mark from _localSeat(). If a\n' +
       '      sender-relative field (a "humanMark", a "myWins") is ever added to that snapshot, a\n' +
       '      recovered guest starts playing the HOST\'s side of the board: it is prompted on the\n' +
       '      opponent\'s turns, its own turns wait forever, and it records the host\'s result as its\n' +
       '      own - the rule-2 loss the whole seat indirection exists to prevent)',
      guest.myMark() === TO && guest.marks[1] === TO && host.myMark() === TX,
      `guest marks=${JSON.stringify(guest.marks)} myMark=${guest.myMark()} / host myMark=${host.myMark()}`);
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 15000, 'T4 game end after recovery');
    ok('T4: the game finished cleanly on both sides after recovery',
      host.gamesFinished === 1 && guest.gamesFinished === 1 && !host.failedHard && !guest.failedHard);
    ok('T4: final states hash-identical after recovery', tHash(host.state) === tHash(guest.state));
    ok('T4: the recovered guest still recorded ITS OWN result',
      host.statsCommits[0].won === true && guest.statsCommits[0].won === false,
      `host.won=${host.statsCommits[0].won} guest.won=${guest.statsCommits[0].won}`);
  } catch (e) { fail++; console.log(`FAIL  T4 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- T5: INVARIANT 3 ported by analogy - a rematch never reads game 1's log ---------
console.log('\n--- T5: Tic Tac Toe rematch (KNOWN-BUG PROBE: stale per-game consumption state) ---');
{
  const { room, host, guest } = makeTicTacToe('classic', tttDrawScript());
  try {
    await until(() => host.gamesFinished === 1 && guest.gamesFinished === 1, 15000, 'T5 game 1 end');
    const game1Log = Object.keys(room.moves).length;
    const seqAtEndOfGame1 = host.mp.appliedSeq;
    // The host taps "Play again". startNextGame alternates, so game 2 puts X on the
    // GUEST's seat - the case a seat bug hides in.
    await host.startNextGame();
    await until(() => guest.mp.gameNum === 2 || host.failedHard || guest.failedHard, 10000, 'T5 guest adopts game 2');
    ok('T5: both sides moved to game 2', host.mp.gameNum === 2 && guest.mp.gameNum === 2);
    ok('T5: game 2 alternated the opening seat - X is now the GUEST',
      host.mp.xSeat === 1 && guest.myMark() === TX && host.myMark() === TO,
      `xSeat=${host.mp.xSeat} guest mark=${guest.myMark()} host mark=${host.myMark()}`);
    // Measured AT the reset, not after it: by the time the poll above returns, game 2's
    // own first move has already been written and applied.
    const hostReset = host.roundResets.find((r) => r.n === 2);
    const guestReset = guest.roundResets.find((r) => r.n === 2);
    ok('T5 [KNOWN-BUG PROBE]: game 2 starts from a CLEARED move log on both sides\n' +
       '      (REGRESSION GUARD, invariant 3 ported BY ANALOGY. The original mechanism -\n' +
       '      config.presetStockResets, a shift()-consumed queue that must not be indexed by a\n' +
       '      per-round counter - has NO Tic Tac Toe equivalent: this game has no deck, no rng and\n' +
       '      no per-round consumable of any kind, so that literal probe cannot be ported and is\n' +
       '      not being silently dropped. What DOES port is the failure shape it encodes: per-round\n' +
       '      consumption state leaking into the next round. Here the consumable is the seq-keyed\n' +
       '      move log. net.js startRound clears `moves` atomically with the record, and\n' +
       '      _mpApplyRoundRecord rebuilds the cache from THAT room snapshot and resets appliedSeq\n' +
       '      to 0; every entry also carries its game number. Carry any of that over and game 2\n' +
       '      replays game 1\'s moves - the exact way round 2 replayed round 1\'s shuffle)',
      !!(hostReset && guestReset)
        && hostReset.appliedSeq === 0 && guestReset.appliedSeq === 0
        && hostReset.staleCached === 0 && guestReset.staleCached === 0,
      `game1 log had ${game1Log} entries (seq reached ${seqAtEndOfGame1}); at the game-2 reset ` +
      `host=${JSON.stringify(hostReset)} guest=${JSON.stringify(guestReset)}`);
    await until(() => (host.gamesFinished === 2 && guest.gamesFinished === 2) || host.failedHard || guest.failedHard, 15000, 'T5 game 2 end');
    ok('T5: game 2\'s log holds only game 2\'s moves (9 entries, all stamped g=2)',
      Object.values(room.moves).length === 9 && Object.values(room.moves).every((e) => (e.move.g | 0) === 2),
      `entries=${Object.values(room.moves).length} games=${JSON.stringify([...new Set(Object.values(room.moves).map((e) => e.move.g))])}`);
    ok('T5: game 2 played to completion with zero mismatches', host.mismatches === 0 && guest.mismatches === 0 && host.gamesFinished === 2 && guest.gamesFinished === 2);
    ok('T5: the series tally counts both games on both devices, seat-indexed the same way',
      JSON.stringify(host.mp.series) === JSON.stringify(guest.mp.series) && host.mp.series.draws === 2,
      `host=${JSON.stringify(host.mp.series)} guest=${JSON.stringify(guest.mp.series)}`);
  } catch (e) { fail++; console.log(`FAIL  T5 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- T6: INVARIANT 4 ported - the autosave's seq matches its own snapshot -----------
console.log('\n--- T6: Tic Tac Toe rejoin from autosave (KNOWN-BUG PROBE: save seq off-by-one) ---');
{
  // In-band freeze (same reasoning as E4): stop the guest's DELIVERY once it has applied
  // seq 3, mimicking a device backgrounded mid-game with the host one move ahead.
  let guestRef = null;
  const { room, host, guest } = makeTicTacToe('classic', tttFirstLegal(), {
    guest: { frozen: () => guestRef !== null && guestRef.mp !== null && guestRef.mp.appliedSeq >= 3 },
  });
  guestRef = guest;
  let restored = null;
  try {
    await until(() => guest.mp && guest.mp.appliedSeq >= 4 && room.moves['0005'], 15000, 'T6 guest frozen with a tail waiting');
    await new Promise((r) => setTimeout(r, 100));
    const midSaves = guest.saves.filter((s) => s.midGame);
    const lastSave = midSaves[midSaves.length - 1];
    guest.kill();

    // Mechanism probe, direct. CORRECT: the saved state contains exactly moves 1..seq, so
    // it hashes equal to the log entry AT seq and NOT to the entry at seq+1 (which the
    // restore path is about to replay onto it).
    const atSeq = room.moves[String(lastSave.seq | 0).padStart(4, '0')];
    const atNext = room.moves[String((lastSave.seq | 0) + 1).padStart(4, '0')];
    const savedHash = tHash(lastSave.state);
    ok('T6 [KNOWN-BUG PROBE]: the autosave\'s seq matches its own snapshot\n' +
       '      (REGRESSION GUARD, invariant 4: tic-tac-toe/js/ui.js\'s _afterStateChange must run\n' +
       '      the move\'s MP bookkeeping FIRST - _mpAfterLocalMove reserving+appending the seq, or\n' +
       '      _mpApplyNextEntry advancing it - and only THEN call _mpSaveSnapshot. Saving first\n' +
       '      stores mp.seq one LOW relative to the move already inside the snapshot, so\n' +
       '      _tryRestoreMP rebuilds post-move-N state with appliedSeq N-1 and re-applies move N:\n' +
       '      a guaranteed desync on every rejoin, which is the exact case the 30-minute restore\n' +
       '      window exists for. Escoba shipped this bug on its play hook)',
      !!atSeq && savedHash === atSeq.h && !(atNext && savedHash === atNext.h),
      `save.seq=${lastSave.seq}; entry@seq ${atSeq ? (savedHash === atSeq.h ? 'matches the snapshot (correct)' : 'does NOT match') : 'absent'}; entry@seq+1 ${atNext ? (savedHash === atNext.h ? 'ALSO matches - the save is one behind' : 'does not match (correct)') : 'absent'}`);

    // End-to-end: a fresh device restores from that save and replays the tail.
    restored = new TicTacToeSide('guest', room, tttFirstLegal(), {});
    await restored.restoreFromSave(lastSave);
    await until(() => restored.gamesFinished > 0 || restored.mismatches > 0 || restored.failedHard, 15000, 'T6 restored guest finishes');
    ok('T6: the restored guest replayed the tail cleanly (zero mismatches, no hard failure)',
      restored.mismatches === 0 && !restored.failedHard,
      `restored mismatches=${restored.mismatches} appliedSeq=${restored.mp.appliedSeq} failedHard=${restored.failedHard}`);
    ok('T6: the restored guest reached the same finished game as the host',
      !!restored.state && restored.state.over && tHash(restored.state) === tHash(host.state),
      `restored over=${restored.state && restored.state.over} host over=${host.state.over}`);
    ok('T6: the restored guest kept its own seat (1) and its own mark',
      restored.localSeat() === 1 && restored.myMark() === TO, `seat=${restored.localSeat()} mark=${restored.myMark()}`);
  } catch (e) { fail++; console.log(`FAIL  T6 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); if (restored) restored.kill(); }
}

// --- T7: INVARIANT 5 ported - a boundary restore keeps the series and waits ---------
console.log('\n--- T7: Tic Tac Toe restore at a game boundary (KNOWN-BUG PROBE: restore wipes the series) ---');
{
  const { room, host, guest } = makeTicTacToe('classic', tttDrawScript());
  let restored = null;
  const isoRoom = new FakeRoom();
  try {
    await until(() => host.gamesFinished === 1 && guest.gamesFinished === 1, 15000, 'T7 game 1 end');
    await new Promise((r) => setTimeout(r, 50));
    const boundarySaves = guest.saves.filter((sv) => !sv.midGame);
    const boundarySave = deep(boundarySaves[boundarySaves.length - 1]);
    ok('T7: the guest wrote a BOUNDARY save carrying the series tally',
      !!boundarySave && boundarySave.midGame === false && boundarySave.series.draws === 1 && boundarySave.statsCommitted === true,
      JSON.stringify(boundarySave && { midGame: boundarySave.midGame, series: boundarySave.series, statsCommitted: boundarySave.statsCommitted }));
    cleanup(room, host, guest);   // the live match is no longer needed

    // Restore onto an isolated room that has NOT yet been given the next game's record.
    // The promise is deliberately NOT awaited: a guest MUST block here.
    isoRoom.config = { variant: 'classic' };
    isoRoom.status = 'active';
    restored = new TicTacToeSide('guest', isoRoom, tttDrawScript(), {});
    const pending = restored.restoreFromSave(boundarySave);
    await new Promise((r) => setTimeout(r, 150));
    ok('T7: the restored guest WAITS for the host\'s record instead of starting a game itself',
      restored.mp.gameNum === boundarySave.gameNum && restored.mp.awaitingGameN === boundarySave.gameNum + 1 && restored.state.over,
      `gameNum=${restored.mp.gameNum} awaitingGameN=${restored.mp.awaitingGameN} state.over=${restored.state.over}`);
    ok('T7: it did not double-record the finished game it restored',
      restored.statsCommits.length === 0 && restored.statsCommitted === true,
      `commits=${JSON.stringify(restored.statsCommits)} statsCommitted=${restored.statsCommitted}`);

    // The host now publishes game 2 with X on the GUEST's seat - a value the guest could
    // not have derived locally (its own setup would have said otherwise).
    await isoRoom.startRound(boundarySave.gameNum + 1, null, 1);
    await until(() => restored.mp.gameNum === boundarySave.gameNum + 1, 10000, 'T7 restored guest adopts the host record');
    await pending;
    ok('T7 [KNOWN-BUG PROBE]: the restore KEPT the series tally (no wipe) and took the host\'s\n' +
       '      opening seat rather than deriving one\n' +
       '      (REGRESSION GUARD, invariant 5: a boundary snapshot must resume with the NEXT game,\n' +
       '      records kept - never a fresh match init that zeroes them - and a restoring GUEST must\n' +
       '      await the host\'s freshly published round record before playing. Chinchon shipped the\n' +
       '      other branch: playMatch fell through to initMatch(), every totalScore was ZEROED and\n' +
       '      the match restarted at round 1; with BOTH devices restoring at once there was no\n' +
       '      authoritative host left to recover from and the scores were simply gone, a THE-LAW-\n' +
       '      class loss. Here the equivalents are the series tally and, in place of the next\n' +
       '      round\'s deck, which seat plays X - derive it locally and the two devices disagree\n' +
       '      about who moves first, which desyncs on move one)',
      restored.mp.series.draws === boundarySave.series.draws
        && JSON.stringify(restored.mp.series.wins) === JSON.stringify(boundarySave.series.wins)
        && restored.mp.xSeat === 1 && restored.myMark() === TX,
      `series at save=${JSON.stringify(boundarySave.series)} after restore=${JSON.stringify(restored.mp.series)}; xSeat=${restored.mp.xSeat} myMark=${restored.myMark()}`);
  } catch (e) { fail++; console.log(`FAIL  T7 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); if (restored) restored.kill(); isoRoom.dead = true; }
}

// ==================================================================================
// MANCALA side (mirror of mancala/js/ui.js's MP glue)
//
// Shape difference worth stating once, beyond what Tic Tac Toe's own comment already covers:
// like Tic Tac Toe, this game has no agent interface and its engine is a synchronous
// applyMove(state, pit) -- but mancala/js/ui.js's playMove() ANIMATES every sow (stones fly pit
// to pit), and a remote move is deliberately routed through that same animated call rather than
// an instant-snap side channel (better UX, and it's the whole point of "route seat 1's input
// over the network instead of the same screen" rather than building a second rendering path).
// That makes the real UI's remote-delivery loop asynchronous and SEQUENTIAL (each move must
// finish animating before the next one in the log can be applied). This harness mirrors that:
// tryDeliver()/applyNextEntry() are async and await each other, unlike Tic Tac Toe's tight
// synchronous `while` drain. The harness itself has no animation to await (headless), but the
// async shape is preserved so the mirror stays honest about what the real glue does.
//
// Vocabulary map (js/net.js is untouched, so its field names are reused as-is):
//   a "round" record  = ONE GAME of a rematch series this room hosts, same vocabulary as Tic
//                        Tac Toe (2026-07-27: Mancala gained a rematch series -- see
//                        mancala/CLAUDE.md)
//   round.n           = the game number
//   round.deck        = unused (no cards, no rng)
//   round.dealer      = the seat that opens that game, alternated by the HOST every game via
//                        mp.nextDealer (_mpStartNextGame). Sides themselves never swap (host
//                        stays P1/bottom, guest stays P2/top for the whole room -- see the
//                        _localSeat() deviation note in mancala/js/ui.js); only who opens does.
//   writeResult       = deliberately NOT used; status:'ended' means somebody abandoned the room
// ==================================================================================
function mancalaNewState(role) {   // _mpNewState (UI-only fields dropped)
  return {
    role, localSeat: role === 'host' ? mP1 : mP2,
    gameNum: 0,
    nextDealer: mP1,   // host only: who opens the NEXT game (flipped by startNextGame)
    series: { wins: [0, 0], draws: 0 },   // seat-indexed (P1=0, P2=1), never device-relative
    lastScoredGame: 0,   // afterGameEnd's idempotence guard
    appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
    replayMode: false, recoveryAttempts: 0, delivering: false, awaitingRecovery: false,
    // See _mpTryDeliverNextMove's comment in mancala/js/ui.js: an async drain can check "is
    // there a next entry" against a stale cache right as a room update lands with the answer.
    // This is a real bug this harness surfaced, not a test-only concern -- fixed in ui.js too.
    redeliverRequested: false,
    opponentLeft: false, lastRoomSnapshot: null,
    lastRecoveryHandled: null, lastRecoveryApplied: null,
  };
}
const mancalaNormSeries = (s) => ({ wins: [((s && s.wins) || [])[0] | 0, ((s && s.wins) || [])[1] | 0], draws: (s && s.draws) | 0 });

class MancalaSide {
  constructor(role, room, policy, opts = {}) {
    this.role = role; this.room = room; this.policy = policy; this.opts = opts;
    this.mp = null; this.state = null;
    this.dead = false; this.failedHard = false;
    this.mismatches = 0; this.recoveriesApplied = 0;
    this.statsCommitted = false;
    this.gamesFinished = 0;
    this.statsCommits = [];   // commitStats's result, captured instead of written
    this.saves = [];          // in-memory _mpSaveSnapshot
    this.roundResets = [];    // harness-only: what each applyRoundRecord reset actually saw
    this._roomCb = (r) => this.roomCallback(r);
    room.onRoom(this._roomCb);
  }

  localSeat() { return this.mp ? this.mp.localSeat : mP1; }
  remoteSeat() { return 1 - this.localSeat(); }

  isLegal(pit) {   // _isLegal - the ONE legality gate, read by the local tap AND every remote move
    const s = this.state;
    if (!s || s.over) return false;
    return mLegal(s).includes(pit);
  }

  encodeMove(pit) { return { t: 'move', g: this.mp.gameNum, p: pit | 0 }; }   // _mpEncodeMove
  decodeMove(m) { return m.p | 0; }   // _mpDecodeMove

  afterLocalMove(pit) {   // _mpAfterLocalMove - seq reserved SYNCHRONOUSLY, before any await
    const mp = this.mp;
    if (!mp) return;
    const result = mApply(this.state, pit);
    if (!result) return;
    const seq = ++mp.appliedSeq;
    const hash = mHash(result.state);
    this.room.appendMove(this.role, seq, this.encodeMove(pit), hash).catch(() => {});
  }

  async tryDeliver() {   // _mpTryDeliverNextMove - ASYNC here (see the class comment above)
    const mp = this.mp;
    if (!mp || mp.delivering || mp.awaitingRecovery || this.dead || !this.state) return;
    if (this.opts.frozen && this.opts.frozen()) return;   // harness-only freeze (a backgrounded device)
    mp.delivering = true;
    mp.redeliverRequested = false;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (await this.applyNextEntry()) continue;
        if (mp.redeliverRequested) { mp.redeliverRequested = false; continue; }
        break;
      }
    } finally { mp.delivering = false; }
  }

  async applyNextEntry() {   // _mpApplyNextEntry
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !mp.movesById || !this.state || this.state.over) return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry || !entry.move || entry.move.t !== 'move') return false;
    if ((entry.move.g | 0) !== (mp.gameNum | 0)) return false;   // never consume another game's entry
    const pit = this.decodeMove(entry.move);
    let agreed = this.isLegal(pit);
    let result = null;
    if (agreed) {
      result = mApply(this.state, pit);
      if (this.opts.corruptAtSeq === seq && !this._corrupted) {
        // A pure HASH divergence with zero effect on the real gameplay path (the corrupted
        // result is only ever used for the comparison below -- it is never committed to
        // this.state unless the hash happens to still agree, which it won't).
        this._corrupted = true;
        result = { state: { ...result.state, pits: result.state.pits.slice() }, events: result.events };
        result.state.pits[0] += 1;
      }
      agreed = !!result && mHash(result.state) === entry.h;
    }
    if (!agreed) { this.mismatches++; return this.onDivergence(seq); }
    mp.appliedSeq = seq;
    mp.recoveryAttempts = 0;
    if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
    this.state = result.state;
    await this.afterStateChange();
    return true;
  }

  onDivergence(seq) {   // _mpOnDivergence - host takes the seq and publishes; guest latches
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { this.failedHard = true; return false; }
    if (mp.role === 'host') {
      mp.appliedSeq = seq;
      this.room.writeRecovery(seq, this.snapshot()).catch(() => {});
      return true;
    }
    mp.awaitingRecovery = true;
    this.room.requestRecovery(seq).catch(() => {});
    return false;
  }

  snapshot() {   // _mpSnapshot - nothing device-relative: the absolute board, seat derived locally
    const mp = this.mp;
    return {
      v: 1, gameNum: mp.gameNum, nextDealer: mp.nextDealer,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      state: deep(this.state),
    };
  }

  async applyRecovery(recovery) {   // _mpApplyRecovery
    const mp = this.mp;
    if (!mp || this.dead) return;
    const snap = deep(recovery.state);
    mp.gameNum = snap.gameNum | 0;
    mp.nextDealer = snap.nextDealer === mP2 ? mP2 : mP1;
    mp.series = mancalaNormSeries(snap.series);
    this.state = snap.state;
    mp.appliedSeq = recovery.seq | 0;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq | 0, mp.appliedSeq);
    mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    mp.lastScoredGame = this.state.over ? mp.gameNum : mp.lastScoredGame;
    this.recoveriesApplied++;
    this.room.clearRecovery().catch(() => {});
    await this.afterStateChange();
  }

  async applyRoundRecord(round, room) {   // _mpApplyRoundRecord
    const mp = this.mp;
    if (!mp || this.dead || !round) return;
    mp.gameNum = round.n | 0;
    mp.appliedSeq = 0; mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    const entries = Object.values((room && room.moves) || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    mp.maxKnownSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
    this.statsCommitted = false;
    this.state = mNewGame(round.dealer === mP2 ? mP2 : mP1);
    // HARNESS ONLY: freeze what the per-game reset actually saw, so M4 can probe the exact
    // instant a new game begins rather than whatever the log looks like a few microtasks
    // later (by then the new game's own first move has already landed). Mirrors Tic Tac
    // Toe's roundResets exactly (test-mp-lockstep.mjs's T5).
    this.roundResets.push({
      n: mp.gameNum,
      dealer: round.dealer === mP2 ? mP2 : mP1,
      appliedSeq: mp.appliedSeq,
      cached: mp.movesById.size,
      staleCached: [...mp.movesById.values()].filter((e) => (e.move.g | 0) !== mp.gameNum).length,
    });
    await this.afterStateChange();
  }

  /** _mpStartNextGame. The real method alternates mp.nextDealer itself; the harness accepts
   *  an explicit dealer override for opts-driven tests, defaulting to the alternation. */
  async startNextGame(dealer) {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this.dead) return;
    const n = (mp.gameNum | 0) + 1;
    const seat = dealer != null ? dealer : (mp.nextDealer === mP2 ? mP2 : mP1);
    mp.nextDealer = seat === mP1 ? mP2 : mP1;
    await this.room.startRound(n, null, seat);
    if (this.dead || !this.mp) return;
    if ((this.mp.gameNum | 0) < n) await this.applyRoundRecord({ n, dealer: seat }, null);
  }

  afterGameEnd() {   // _mpAfterGameEnd - series tally, idempotent per game number
    const mp = this.mp, s = this.state;
    if (!mp || !s || !s.over) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    if (s.winner === null) mp.series.draws += 1;
    else mp.series.wins[s.winner] += 1;
    this.save();
  }

  /** The MP branch of finishMove - save FIRST is the invariant-4 ordering. FULLY AWAITED here
   *  (unlike Tic Tac Toe's fire-and-forget `this._mpTryDeliverNextMove();`), because Mancala's
   *  own tryDeliver()/applyNextEntry() are async (see the class comment): a harness auto-play
   *  driver that fired tryDeliver and immediately read `this.state.turn` afterward (the same
   *  shape as TicTacToeSide, whose tryDeliver is fully synchronous) would race ahead of the
   *  drain and read STALE state. Awaiting end-to-end removes that race entirely; it has no
   *  bearing on the real UI, which has no auto-play driver at all. */
  async afterStateChange() {
    if (this.dead) return;
    this.save();
    if (this.state.over) {
      this.commitStats();
      this.afterGameEnd();
      this.save();   // finish() - re-save with statsCommitted (and any series bump) set
      this.gamesFinished++;
      return;
    }
    await this.tryDeliver();
    await this.takeTurnIfMine();
  }

  /** HARNESS ONLY: stands in for the local human's tap. The real UI waits for a click on a
   *  live pit; humanMove() below is the real method it calls. */
  async takeTurnIfMine() {
    if (this.dead || !this.state || this.state.over) return;
    if (this.state.turn !== this.localSeat()) return;
    await this.humanMove(this.policy(this.state));
  }

  async humanMove(pit) {   // humanMove - local apply, MP bookkeeping, then the funnel
    if (!this.state || this.state.over || this.state.turn !== this.localSeat()) return;
    if (!this.isLegal(pit)) return;
    const result = mApply(this.state, pit);
    if (!result) return;
    this.afterLocalMove(pit);
    this.state = result.state;
    await this.afterStateChange();
  }

  commitStats() {   // finish() - `won` resolves through localSeat()
    if (this.statsCommitted) return;
    this.statsCommitted = true;
    const s = this.state;
    const won = s.winner === null ? null : (s.winner === this.localSeat());
    this.statsCommits.push({ difficulty: 'mp', won });
  }

  save() {   // _mpSaveSnapshot - seq read AFTER this move's own MP bookkeeping
    const mp = this.mp;
    if (!mp || !this.state) return;
    this.saves.push({
      v: 1, code: 'M', role: this.role, seq: mp.appliedSeq | 0, at: 0,
      gameNum: mp.gameNum | 0, nextDealer: mp.nextDealer,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      lastScoredGame: mp.lastScoredGame | 0,
      statsCommitted: !!this.statsCommitted,
      state: deep(this.state),
    });
  }

  roomCallback(room) {   // _mpRoomCallback
    if (this.dead) return;
    if (this.mp) { this.onRoomUpdate(room); return; }
    if (this.role === 'guest' && this.opts.autoStart && room.status === 'active' && room.round) this.guestStart(room);
  }

  guestStart(room) {   // _mpGuestStartMatch
    if (this.mp || this.dead) return;
    this.mp = mancalaNewState('guest');
    this.mp.lastRoomSnapshot = room;
    this.applyRoundRecord(room.round, room);
  }

  hostStartMatch(dealer) {   // _mpHostStartMatch
    this.mp = mancalaNewState('host');
    return this.startNextGame(dealer);
  }

  onRoomUpdate(room) {   // _mpOnRoomUpdate
    if (this.dead || !this.mp || !room) return;
    const mp = this.mp;
    mp.lastRoomSnapshot = room;
    if (room.status === 'ended' && !mp.opponentLeft) { mp.opponentLeft = true; return; }
    if (room.recovery) {
      if (mp.role === 'host' && room.recovery.requested != null && room.recovery.requested !== mp.lastRecoveryHandled) {
        mp.lastRecoveryHandled = room.recovery.requested;
        this.room.writeRecovery(mp.appliedSeq, this.snapshot()).catch(() => {});
      }
      if (mp.role === 'guest' && room.recovery.state && room.recovery.seq !== mp.lastRecoveryApplied) {
        mp.lastRecoveryApplied = room.recovery.seq;
        this.applyRecovery(room.recovery);
      }
    }
    const roundN = room.round ? (room.round.n | 0) : 0;
    if (room.round && roundN > (mp.gameNum | 0)) {
      this.applyRoundRecord(room.round, room);
    } else if (roundN === (mp.gameNum | 0) && this.state) {
      const entries = Object.values(room.moves || {});
      mp.movesById = new Map(entries.map((m) => [m.seq, m]));
      const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
      if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
      mp.maxKnownSeq = maxSeq;
      mp.redeliverRequested = true;
      this.tryDeliver();
    }
  }

  async restoreFromSave(save) {   // _tryRestoreMP (the join/heartbeat half elided: FakeRoom is always reachable)
    this.mp = mancalaNewState(this.role);
    const mp = this.mp;
    mp.gameNum = save.gameNum | 0;
    mp.nextDealer = save.nextDealer === mP2 ? mP2 : mP1;
    // The series tally is carried through UNTOUCHED, same as Tic Tac Toe's restore (see M6).
    mp.series = mancalaNormSeries(save.series);
    mp.lastScoredGame = save.lastScoredGame | 0;
    mp.appliedSeq = save.seq | 0;
    mp.maxKnownSeq = mp.appliedSeq;
    this.state = deep(save.state);
    this.statsCommitted = !!save.statsCommitted;
    // No separate "boundary between games" await path is needed the way Tic Tac Toe's restore
    // has one -- either the saved game is still live (drain the tail) or it already finished
    // (commitStats()'s own guard, plus afterGameEnd's lastScoredGame guard, keep re-showing the
    // result idempotent; see M6). If the series has since moved on, the ordinary
    // onRoomUpdate roundN > gameNum branch picks up the next game ONCE the host publishes it --
    // no separate await path, matching mancala/js/ui.js's _tryRestoreMP.
    if (this.state.over) { this.commitStats(); return; }
    this.tryDeliver();
    this.takeTurnIfMine();
  }

  kill() { this.dead = true; this.room.offRoom(this._roomCb); }
}

function makeMancala(policy, opts = {}) {
  const room = new FakeRoom();
  room.config = {};
  const host = new MancalaSide('host', room, policy, opts.host || {});
  const guest = new MancalaSide('guest', room, policy, Object.assign({ autoStart: true }, opts.guest || {}));
  host.hostStartMatch();
  return { room, host, guest };
}

// Mancala: deterministic scripted policies, same shape as Tic Tac Toe's (both sides run the
// SAME policy; only the DECIDING side's choice is ever used).
//   mcFirstLegal - always legalMoves(s)[0]. A real, decisive, fast game (10 moves vs AI-less
//                  "always leftmost legal pit" play on both sides) -- verified offline.
//   mcTieScript  - a seeded pseudo-random legal-move policy (mulberry32) that reaches a genuine
//                  TIE (winner === null, over === true) after 46 moves. Found by an offline
//                  search over mulberry32 seeds against the real engine (game.js has no rng of
//                  its own, so this is purely a test-authoring device, not new engine surface);
//                  seed 23 is the first hit. This is what invariant 1's probe (M2) needs: a tied
//                  game is over with winner === null, so any "is it finished" gate written
//                  against `winner` instead of `over` hangs exactly there.
const mcFirstLegal = () => (s) => mLegal(s)[0];
const mcTieScript = (seed) => {
  let a = seed | 0;
  const rng = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return (s) => { const legal = mLegal(s); return legal[Math.floor(rng() * legal.length)]; };
};

// --- M1: Mancala full match + the seat-identity (THE LAW rule 2) check -------------
console.log('\n--- M1: Mancala full match, lockstep, hash-verified every applied move ---');
{
  const { room, host, guest } = makeMancala(mcFirstLegal());
  try {
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 15000, 'M1 game end');
    ok('M1: both sides completed the game (no hard failure)',
      host.gamesFinished === 1 && guest.gamesFinished === 1 && !host.failedHard && !guest.failedHard);
    ok('M1: zero hash mismatches across the whole game', host.mismatches === 0 && guest.mismatches === 0, `host=${host.mismatches} guest=${guest.mismatches}`);
    ok('M1: zero recoveries needed', host.recoveriesApplied === 0 && guest.recoveriesApplied === 0);
    ok('M1: final states hash-identical', mHash(host.state) === mHash(guest.state));
    ok('M1: same winner on both sides', host.state.winner === guest.state.winner, `host=${host.state.winner} guest=${guest.state.winner}`);
    ok('M1: no move-log overwrites (the shared seq never collided)', room.overwrites.length === 0, JSON.stringify(room.overwrites));
    ok('M1: host holds seat P1 (bottom), guest holds seat P2 (top)',
      host.localSeat() === mP1 && guest.localSeat() === mP2, `host=${host.localSeat()} guest=${guest.localSeat()}`);
    const hc = host.statsCommits[0], gc = guest.statsCommits[0];
    ok('M1: each device recorded exactly one result, in the mp difficulty bucket',
      host.statsCommits.length === 1 && guest.statsCommits.length === 1 && hc.difficulty === 'mp' && gc.difficulty === 'mp',
      JSON.stringify([host.statsCommits, guest.statsCommits]));
    ok('M1: the guest recorded ITS OWN result, not the host\'s\n' +
       '      (THE LAW rule 2: a loss written as a win is not additive-safe. This is the headless\n' +
       '      half of HANDOFF-MP-LOCAL-MACHINE.md\'s B2 check - the other half needs two real devices)',
      hc.won === (host.state.winner === mP1) && gc.won === (guest.state.winner === mP2) && hc.won !== gc.won,
      `host.won=${hc.won} guest.won=${gc.won} winner=${host.state.winner}`);
  } catch (e) { fail++; console.log(`FAIL  M1 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- M2: INVARIANT 1 ported - a TIE is a game end, and winner is null at it --------
console.log('\n--- M2: Mancala tied game (KNOWN-BUG PROBE: a `winner`-keyed gate hangs at a winner-less end) ---');
{
  const { room, host, guest } = makeMancala(mcTieScript(23));
  try {
    await until(() => host.gamesFinished || host.failedHard || guest.failedHard, 15000, 'M2 host game end');
    ok('M2: the scripted game really is a TIE (equal stores, winner null)',
      host.state.over === true && host.state.winner === null && host.state.pits[mP1_STORE] === host.state.pits[mP2_STORE],
      `over=${host.state.over} winner=${host.state.winner} p1=${host.state.pits[mP1_STORE]} p2=${host.state.pits[mP2_STORE]}`);
    ok('M2: zero hash mismatches', host.mismatches === 0 && guest.mismatches === 0);
    ok('M2 [KNOWN-BUG PROBE]: the GUEST also concludes a tied game, and records it\n' +
       '      (REGRESSION GUARD, invariant 1 ported: mancala/js/ui.js\'s finishMove/finish() must\n' +
       '      gate on events.over/state.over, NEVER on state.winner - winner is null for a genuine\n' +
       '      tie, so a gate written against "if (winner)" would silently skip both the end-of-game\n' +
       '      overlay and the stats commit on a tied match, the same shape as Chinchon\'s original\n' +
       '      match-end deadlock, ported to a game with no points/rounds of its own)',
      guest.gamesFinished === 1 && guest.state.over === true && guest.state.winner === null,
      `guest.gamesFinished=${guest.gamesFinished} over=${guest.state && guest.state.over} winner=${guest.state && guest.state.winner}`);
    ok('M2: both devices recorded the tie AS a draw (won === null, never a fabricated win/loss)',
      host.statsCommits[0].won === null && guest.statsCommits[0].won === null,
      JSON.stringify([host.statsCommits[0], guest.statsCommits[0]]));
  } catch (e) { fail++; console.log(`FAIL  M2 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- M3: INVARIANT 2 ported - forced desync, recovery, seat identity ----------------
console.log('\n--- M3: Mancala forced desync + recovery (KNOWN-BUG PROBE: recovery swaps the seats) ---');
{
  const { room, host, guest } = makeMancala(mcFirstLegal(), { guest: { corruptAtSeq: 3 } });
  try {
    await until(() => guest.recoveriesApplied >= 1 || guest.failedHard || host.failedHard, 15000, 'M3 recovery applied');
    ok('M3: corruption was DETECTED as a hash mismatch', guest.mismatches >= 1, `guest mismatches=${guest.mismatches}`);
    ok('M3: host answered the desync flag with a recovery snapshot', guest.recoveriesApplied >= 1, `recoveries=${guest.recoveriesApplied}`);
    ok('M3 [KNOWN-BUG PROBE]: after recovery the guest still plays ITS OWN seat (P2), never the\n' +
       '      HOST\'s (P1)\n' +
       '      (REGRESSION GUARD, invariant 2: a transmitted snapshot must carry nothing device-\n' +
       '      relative. mancala/js/ui.js\'s _mpSnapshot transmits only { gameNum, state } - the\n' +
       '      absolute board - and _localSeat() is fixed at match start (host=P1, guest=P2) and\n' +
       '      never re-derived from anything in the recovery payload, so there is no isHuman-style\n' +
       '      flag here to get swapped the way Chinchon/Escoba\'s original bug swapped one)',
      guest.localSeat() === mP2, `guest.localSeat()=${guest.localSeat()}`);
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 15000, 'M3 game end after recovery');
    ok('M3: the game finished cleanly on both sides after recovery',
      host.gamesFinished === 1 && guest.gamesFinished === 1 && !host.failedHard && !guest.failedHard);
    ok('M3: final states hash-identical after recovery', mHash(host.state) === mHash(guest.state));
    ok('M3: the recovered guest still recorded ITS OWN result',
      guest.statsCommits[0].won === (guest.state.winner === mP2), `guest.won=${guest.statsCommits[0].won} winner=${guest.state.winner}`);
  } catch (e) { fail++; console.log(`FAIL  M3 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- M4: INVARIANT 3 ported DIRECTLY - a rematch never reads game 1's log ----------
console.log('\n--- M4: Mancala rematch (KNOWN-BUG PROBE: stale per-game consumption state) ---');
// Corrected 2026-07-27: this used to be "ported by analogy, no literal analogue" because
// Mancala hosted exactly one game per room. Now that it hosts a rematch series (same
// vocabulary as Tic Tac Toe -- see mancala/CLAUDE.md), the probe ports directly, mirroring
// Tic Tac Toe's T5 almost line for line.
{
  // mcFirstLegal, not mcTieScript: the tie script's seed was hand-found for a game that opens
  // with P1 (see M2's comment), so replaying it with P2 opening (game 2, alternated) is not
  // guaranteed to tie -- board symmetry means mcFirstLegal stays decisive and fast regardless
  // of which seat opens, so it is the safe choice for a test whose whole point is game 2, not
  // game 1's outcome.
  const { room, host, guest } = makeMancala(mcFirstLegal());
  try {
    await until(() => host.gamesFinished === 1 && guest.gamesFinished === 1, 15000, 'M4 game 1 end');
    const game1Log = Object.keys(room.moves).length;
    ok('M4: game 1 opened with the host (P1), mp.nextDealer\'s default at match start',
      host.roundResets.find((r) => r.n === 1).dealer === mP1 && game1Log > 0);
    // The host taps "Play again". startNextGame alternates, so game 2 opens with the
    // GUEST's seat -- the case a seat bug hides in.
    await host.startNextGame();
    await until(() => guest.mp.gameNum === 2 || host.failedHard || guest.failedHard, 10000, 'M4 guest adopts game 2');
    ok('M4: both sides moved to game 2', host.mp.gameNum === 2 && guest.mp.gameNum === 2);
    // Measured AT the reset (roundResets), not by reading the live board after the fact: by
    // the time the poll above returns, game 2's own first move may already have been written
    // and applied, which would make a `state.turn` check racy -- mirrors why Tic Tac Toe's T5
    // reads mp.xSeat rather than the live board.
    const hostReset = host.roundResets.find((r) => r.n === 2);
    const guestReset = guest.roundResets.find((r) => r.n === 2);
    ok('M4: game 2 alternated the opening seat - P2 (the guest) opens now',
      !!(hostReset && guestReset) && hostReset.dealer === mP2 && guestReset.dealer === mP2,
      `hostReset.dealer=${hostReset && hostReset.dealer} guestReset.dealer=${guestReset && guestReset.dealer}`);
    ok('M4 [KNOWN-BUG PROBE]: game 2 starts from a CLEARED move log on both sides\n' +
       '      (REGRESSION GUARD, invariant 3 ported directly now that a rematch series exists.\n' +
       '      net.js startRound clears `moves` atomically with the record, and\n' +
       '      _mpApplyRoundRecord rebuilds the cache from THAT room snapshot and resets appliedSeq\n' +
       '      to 0; every entry also carries its game number. Carry any of that over and game 2\n' +
       '      replays game 1\'s moves - the exact way round 2 replayed round 1\'s shuffle in\n' +
       '      Chinchon\'s original bug)',
      !!(hostReset && guestReset)
        && hostReset.appliedSeq === 0 && guestReset.appliedSeq === 0
        && hostReset.staleCached === 0 && guestReset.staleCached === 0,
      `game1 log had ${game1Log} entries; at the game-2 reset ` +
      `host=${JSON.stringify(hostReset)} guest=${JSON.stringify(guestReset)}`);
    await until(() => (host.gamesFinished === 2 && guest.gamesFinished === 2) || host.failedHard || guest.failedHard, 15000, 'M4 game 2 end');
    ok('M4: game 2\'s log holds only game 2\'s moves, all stamped g=2',
      Object.values(room.moves).every((e) => (e.move.g | 0) === 2),
      `games=${JSON.stringify([...new Set(Object.values(room.moves).map((e) => e.move.g))])}`);
    ok('M4: game 2 played to completion with zero mismatches', host.mismatches === 0 && guest.mismatches === 0 && host.gamesFinished === 2 && guest.gamesFinished === 2);
    const seriesTotal = (s) => s.wins[0] + s.wins[1] + s.draws;
    ok('M4: the series tally counts both games on both devices, seat-indexed the same way',
      JSON.stringify(host.mp.series) === JSON.stringify(guest.mp.series) && seriesTotal(host.mp.series) === 2,
      `host=${JSON.stringify(host.mp.series)} guest=${JSON.stringify(guest.mp.series)}`);
  } catch (e) { fail++; console.log(`FAIL  M4 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- M5: INVARIANT 4 ported - rejoin from autosave -----------------------------------
console.log('\n--- M5: Mancala rejoin from autosave (KNOWN-BUG PROBE: save seq off-by-one) ---');
{
  // In-band freeze (same reasoning as T6): stop the guest's DELIVERY once it has applied
  // seq 5, mimicking a device backgrounded mid-game with the host one or more moves ahead.
  let guestRef = null;
  const { room, host, guest } = makeMancala(mcTieScript(23), {
    guest: { frozen: () => guestRef !== null && guestRef.mp !== null && guestRef.mp.appliedSeq >= 5 },
  });
  guestRef = guest;
  let restored = null;
  try {
    await until(() => guest.mp && guest.mp.appliedSeq >= 5 && room.moves['0006'], 15000, 'M5 guest frozen with a tail waiting');
    await new Promise((r) => setTimeout(r, 100));
    const midSaves = guest.saves.filter((s) => !s.state.over);
    const lastSave = midSaves[midSaves.length - 1];
    guest.kill();

    // Mechanism probe, direct. CORRECT: the saved state contains exactly moves 1..seq, so it
    // hashes equal to the log entry AT seq and NOT to the entry at seq+1 (which the restore
    // path is about to replay onto it).
    const atSeq = room.moves[String(lastSave.seq | 0).padStart(4, '0')];
    const atNext = room.moves[String((lastSave.seq | 0) + 1).padStart(4, '0')];
    const savedHash = mHash(lastSave.state);
    ok('M5 [KNOWN-BUG PROBE]: the autosave\'s seq matches its own snapshot\n' +
       '      (REGRESSION GUARD, invariant 4: mancala/js/ui.js\'s finishMove must run the move\'s\n' +
       '      MP bookkeeping FIRST - _mpAfterLocalMove reserving+appending the seq before\n' +
       '      playMove(), or _mpApplyNextEntry advancing appliedSeq before awaiting playMove() -\n' +
       '      and only THEN call _mpSaveSnapshot. Saving first stores mp.seq one LOW relative to\n' +
       '      the move already inside the snapshot, so _tryRestoreMP rebuilds post-move-N state\n' +
       '      with appliedSeq N-1 and re-applies move N: a guaranteed desync on every rejoin, the\n' +
       '      exact case the 30-minute restore window exists for. Escoba shipped this bug on its\n' +
       '      play hook)',
      !!atSeq && savedHash === atSeq.h && !(atNext && savedHash === atNext.h),
      `save.seq=${lastSave.seq}; entry@seq ${atSeq ? (savedHash === atSeq.h ? 'matches the snapshot (correct)' : 'does NOT match') : 'absent'}; entry@seq+1 ${atNext ? (savedHash === atNext.h ? 'ALSO matches - the save is one behind' : 'does not match (correct)') : 'absent'}`);

    // End-to-end: a fresh device restores from that save and replays the tail.
    restored = new MancalaSide('guest', room, mcTieScript(23), {});
    await restored.restoreFromSave(lastSave);
    await until(() => restored.gamesFinished > 0 || restored.mismatches > 0 || restored.failedHard, 15000, 'M5 restored guest finishes');
    ok('M5: the restored guest replayed the tail cleanly (zero mismatches, no hard failure)',
      restored.mismatches === 0 && !restored.failedHard,
      `restored mismatches=${restored.mismatches} appliedSeq=${restored.mp.appliedSeq} failedHard=${restored.failedHard}`);
    ok('M5: the restored guest reached the same finished game as the host',
      !!restored.state && restored.state.over && mHash(restored.state) === mHash(host.state),
      `restored over=${restored.state && restored.state.over} host over=${host.state.over}`);
    ok('M5: the restored guest kept its own seat (P2)',
      restored.localSeat() === mP2, `seat=${restored.localSeat()}`);
  } catch (e) { fail++; console.log(`FAIL  M5 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); if (restored) restored.kill(); }
}

// --- M6: INVARIANT 5 ported by analogy - restoring an already-finished game ---------
console.log('\n--- M6: Mancala restore at a game boundary (KNOWN-BUG PROBE: restore re-runs a finished game) ---');
{
  const { room, host, guest } = makeMancala(mcFirstLegal());
  let restored = null;
  try {
    await until(() => host.gamesFinished === 1 && guest.gamesFinished === 1, 15000, 'M6 game end');
    await new Promise((r) => setTimeout(r, 30));
    const boundarySave = deep(guest.saves[guest.saves.length - 1]);
    ok('M6: the guest\'s final save is a BOUNDARY save (state over, statsCommitted true)',
      !!boundarySave && boundarySave.state.over === true && boundarySave.statsCommitted === true,
      JSON.stringify({ over: boundarySave.state.over, statsCommitted: boundarySave.statsCommitted }));
    cleanup(room, host, guest);

    restored = new MancalaSide('guest', new FakeRoom(), mcFirstLegal(), {});
    await restored.restoreFromSave(boundarySave);
    ok('M6 [KNOWN-BUG PROBE, ported by analogy]: restoring an ALREADY-FINISHED game does not\n' +
       '      re-run or re-initialize it\n' +
       '      (REGRESSION GUARD, invariant 5 ported: now that a rematch series exists\n' +
       '      (2026-07-27, see M4), a boundary restore has a real "next game" it could wrongly\n' +
       '      derive locally instead of awaiting the host\'s record -- mancala/js/ui.js\'s\n' +
       '      _tryRestoreMP deliberately does NOT call _mpApplyRoundRecord (which calls\n' +
       '      newGame()) on a save whose game already ended; that would silently start a SECOND\n' +
       '      game nobody asked for and re-arm statsCommitted for a game that was already\n' +
       '      recorded, the same class of bug as Chinchon\'s initMatch wipe, just replacing\n' +
       '      "scores zeroed" with "a phantom rematch begins". The restored side must instead\n' +
       '      recognize state.over and stop, relying on the ordinary onRoomUpdate roundN >\n' +
       '      gameNum branch to pick up the next game once the host actually publishes one)',
      restored.mp.gameNum === boundarySave.gameNum && restored.state.over === true
        && mHash(restored.state) === mHash(boundarySave.state) && restored.statsCommitted === true,
      `gameNum=${restored.mp.gameNum} over=${restored.state && restored.state.over} committed=${restored.statsCommitted}`);
    ok('M6: it did not double-record the finished game it restored',
      restored.statsCommits.length === 0,
      `commits=${JSON.stringify(restored.statsCommits)}`);
    ok('M6: the series tally is carried through the restore UNTOUCHED, not zeroed\n' +
       '      (the initMatch-wipe failure shape from js/CLAUDE.md\'s invariant 5, translated to\n' +
       '      this game\'s vocabulary: a restore that reset mp.series to {wins:[0,0],draws:0}\n' +
       '      would silently erase the series tally the moment either device backgrounds and\n' +
       '      restores mid-series)',
      JSON.stringify(restored.mp.series) === JSON.stringify(boundarySave.series),
      `restored=${JSON.stringify(restored.mp.series)} saved=${JSON.stringify(boundarySave.series)}`);
  } catch (e) { fail++; console.log(`FAIL  M6 did not complete: ${e.message}`); }
  finally { if (restored) restored.kill(); }
}

// ==================================================================================
// FILLER side (mirror of filler/js/ui.js's MP glue)
//
// Shape difference worth stating once, beyond what Mancala's own comment already covers: like
// Mancala, this game has no agent interface and its engine's applyMove(state, color) MUTATES
// its argument (unlike Mancala's pure applyMove, which returns a new state) -- so both the local
// move path and the remote-entry path here speculate on a CLONE (cloneGame) and only commit it
// to `this.state` once the hash agrees, exactly mirroring filler/js/ui.js's _mpAfterLocalMove/
// _mpApplyNextEntry. Delivery is ASYNC and PACED like Mancala's (each remote move gets the same
// flood-fill ripple a local move gets, and a settle beat runs before the next entry is even
// checked), so this harness's tryDeliver()/applyNextEntry() are async and await each other, same
// as MancalaSide -- the harness itself has no animation to await (headless), but the async shape
// stays honest about what the real glue does, and is what makes the redeliverRequested race
// reproducible here too.
//
// Vocabulary map (js/net.js is untouched, so its field names are reused as-is):
//   a "round" record  = ONE GAME of a rematch series this room hosts, same vocabulary as Tic Tac
//                        Toe/Mancala.
//   round.n           = the game number
//   round.deck        = the board SEED for that game (a 32-bit int), NOT a deck order -- Filler
//                        is the first game on the roadmap to give this field a real payload
//                        (see the DEVIATION note in filler/js/ui.js's class comment: the
//                        handoff's literal wording said "seed in room config", but a rematch
//                        series needs a FRESH seed each game, and room.config is fixed once at
//                        createRoom, so the seed rides round.deck instead, same field Chinchón
//                        uses for its own per-round deck order). Both sides call
//                        newGame(mulberry32(seed)) locally; the board itself is never
//                        transmitted.
//   round.dealer      = the seat that opens that game, alternated by the HOST every game via
//                        mp.nextDealer (_mpStartNextGame). Sides themselves never swap (host
//                        stays P1/bottom-left, guest stays P2/top-right for the whole room);
//                        only who opens does.
//   writeResult       = deliberately NOT used; status:'ended' means somebody abandoned the room
// ==================================================================================

const fMulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};
const fPlain = (s) => ({
  colors: Array.from(s.colors), owner: Array.from(s.owner), turn: s.turn,
  counts: s.counts.slice(), current: s.current.slice(), over: s.over, winner: s.winner,
  moves: s.moves, dryMoves: s.dryMoves,
});
const fFromPlain = (p) => ({
  colors: Uint8Array.from(p.colors), owner: Uint8Array.from(p.owner), turn: p.turn === fP2 ? fP2 : fP1,
  counts: p.counts.slice(), current: p.current.slice(), over: !!p.over, winner: p.winner | 0,
  moves: p.moves | 0, dryMoves: p.dryMoves | 0,
});

function fillerNewState(role) {   // _mpNewState (UI-only fields dropped)
  return {
    role, localSeat: role === 'host' ? fP1 : fP2,
    gameNum: 0,
    nextDealer: fP1,   // host only: who opens the NEXT game (flipped by startNextGame)
    // Indexed DIRECTLY by seat value (P1=1, P2=2 in game.js), index 0 unused -- see
    // filler/js/ui.js's _mpNewState comment on why this differs from Mancala's 0-indexed pair.
    series: { wins: [0, 0, 0], draws: 0 },
    lastScoredGame: 0,   // afterGameEnd's idempotence guard
    appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
    replayMode: false, recoveryAttempts: 0, delivering: false, awaitingRecovery: false,
    // See _mpTryDeliverNextMove's comment in filler/js/ui.js: an async, PACED drain can check
    // "is there a next entry" against a stale cache right as a room update lands with the
    // answer. This is a real bug shape this harness surfaces, not a test-only concern -- fixed
    // in ui.js too (same as mancala/js/ui.js's redeliverRequested).
    redeliverRequested: false,
    opponentLeft: false, lastRoomSnapshot: null,
    lastRecoveryHandled: null, lastRecoveryApplied: null,
  };
}
const fillerNormSeries = (s) => ({ wins: [0, ((s && s.wins) || [])[1] | 0, ((s && s.wins) || [])[2] | 0], draws: (s && s.draws) | 0 });

class FillerSide {
  constructor(role, room, policy, opts = {}) {
    this.role = role; this.room = room; this.policy = policy; this.opts = opts;
    this.mp = null; this.state = null;
    this.dead = false; this.failedHard = false;
    this.mismatches = 0; this.recoveriesApplied = 0;
    this.statsCommitted = false;
    this.gamesFinished = 0;
    this.statsCommits = [];   // commitStats's result, captured instead of written
    this.saves = [];          // in-memory _mpSaveSnapshot
    this.roundResets = [];    // harness-only: what each applyRoundRecord reset actually saw
    this._roomCb = (r) => this.roomCallback(r);
    room.onRoom(this._roomCb);
  }

  localSeat() { return this.mp ? this.mp.localSeat : fP1; }
  remoteSeat() { return 3 - this.localSeat(); }   // P1=1, P2=2: the other one.

  isLegal(color) {   // _isLegal - the ONE legality gate, read by the local tap AND every remote move
    const s = this.state;
    if (!s || s.over) return false;
    return fLegalColors(s).indexOf(color) >= 0;
  }

  encodeMove(color) { return { t: 'move', g: this.mp.gameNum, c: color | 0 }; }   // _mpEncodeMove
  decodeMove(m) { return m.c | 0; }   // _mpDecodeMove

  afterLocalMove(color) {   // _mpAfterLocalMove - seq reserved SYNCHRONOUSLY, before any await;
    // speculates on a CLONE since fApplyMove mutates its argument (unlike Mancala's pure one).
    const mp = this.mp;
    if (!mp) return;
    const trial = fCloneGame(this.state);
    fApplyMove(trial, color);
    const seq = ++mp.appliedSeq;
    const h = fHash(trial);
    this.room.appendMove(this.role, seq, this.encodeMove(color), h).catch(() => {});
  }

  async tryDeliver() {   // _mpTryDeliverNextMove - ASYNC + PACED (see the class comment above)
    const mp = this.mp;
    if (!mp || mp.delivering || mp.awaitingRecovery || this.dead || !this.state) return;
    if (this.opts.frozen && this.opts.frozen()) return;   // harness-only freeze (a backgrounded device)
    mp.delivering = true;
    mp.redeliverRequested = false;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (await this.applyNextEntry()) continue;
        if (mp.redeliverRequested) { mp.redeliverRequested = false; continue; }
        break;
      }
    } finally { mp.delivering = false; }
  }

  async applyNextEntry() {   // _mpApplyNextEntry
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !mp.movesById || !this.state || this.state.over) return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry || !entry.move || entry.move.t !== 'move') return false;
    if ((entry.move.g | 0) !== (mp.gameNum | 0)) return false;   // never consume another game's entry
    const color = this.decodeMove(entry.move);
    let agreed = this.isLegal(color);
    let trial = null;
    if (agreed) {
      trial = fCloneGame(this.state);
      fApplyMove(trial, color);
      if (this.opts.corruptAtSeq === seq && !this._corrupted) {
        // A pure HASH divergence with zero effect on the real gameplay path (the corrupted
        // trial is only ever used for the comparison below -- it is discarded, never committed,
        // unless the hash happens to still agree, which it won't).
        this._corrupted = true;
        trial.counts = trial.counts.slice();
        trial.counts[fP1] += 1;
      }
      agreed = fHash(trial) === entry.h;
    }
    if (!agreed) { this.mismatches++; return this.onDivergence(seq); }
    mp.appliedSeq = seq;
    mp.recoveryAttempts = 0;
    if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
    this.state = trial;
    await this.afterStateChange();
    return true;
  }

  onDivergence(seq) {   // _mpOnDivergence - host takes the seq and publishes; guest latches
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { this.failedHard = true; return false; }
    if (mp.role === 'host') {
      mp.appliedSeq = seq;
      this.room.writeRecovery(seq, this.snapshot()).catch(() => {});
      return true;
    }
    mp.awaitingRecovery = true;
    this.room.requestRecovery(seq).catch(() => {});
    return false;
  }

  snapshot() {   // _mpSnapshot - nothing device-relative: the absolute board, seat derived locally
    const mp = this.mp;
    return {
      v: 1, gameNum: mp.gameNum, nextDealer: mp.nextDealer,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      state: deep(fPlain(this.state)),
    };
  }

  async applyRecovery(recovery) {   // _mpApplyRecovery
    const mp = this.mp;
    if (!mp || this.dead) return;
    const snap = deep(recovery.state);
    mp.gameNum = snap.gameNum | 0;
    mp.nextDealer = snap.nextDealer === fP2 ? fP2 : fP1;
    mp.series = fillerNormSeries(snap.series);
    this.state = fFromPlain(snap.state);
    mp.appliedSeq = recovery.seq | 0;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq | 0, mp.appliedSeq);
    mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    mp.lastScoredGame = this.state.over ? mp.gameNum : mp.lastScoredGame;
    this.recoveriesApplied++;
    this.room.clearRecovery().catch(() => {});
    await this.afterStateChange();
  }

  async applyRoundRecord(round, room) {   // _mpApplyRoundRecord - board built from round.deck (the seed)
    const mp = this.mp;
    if (!mp || this.dead || !round) return;
    mp.gameNum = round.n | 0;
    mp.appliedSeq = 0; mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    const entries = Object.values((room && room.moves) || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    mp.maxKnownSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
    this.statsCommitted = false;
    this.state = fNewGame(fMulberry32(round.deck >>> 0));
    if (round.dealer === fP2) this.state.turn = fP2;
    // HARNESS ONLY: freeze what the per-game reset actually saw, so F4 can probe the exact
    // instant a new game begins rather than whatever the log looks like a few microtasks
    // later. Mirrors Tic Tac Toe's/Mancala's roundResets exactly.
    this.roundResets.push({
      n: mp.gameNum,
      dealer: round.dealer === fP2 ? fP2 : fP1,
      appliedSeq: mp.appliedSeq,
      cached: mp.movesById.size,
      staleCached: [...mp.movesById.values()].filter((e) => (e.move.g | 0) !== mp.gameNum).length,
    });
    await this.afterStateChange();
  }

  /** _mpStartNextGame. The real method rolls a fresh Math.random() seed every game; the harness
   *  accepts an explicit seed for reproducibility, defaulting to a deterministic per-game value
   *  so a run is never flaky. The real method alternates mp.nextDealer itself; the harness also
   *  accepts an explicit dealer override for opts-driven tests, defaulting to the alternation. */
  async startNextGame(dealer, seed) {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this.dead) return;
    const n = (mp.gameNum | 0) + 1;
    const seat = dealer != null ? dealer : (mp.nextDealer === fP2 ? fP2 : fP1);
    mp.nextDealer = seat === fP1 ? fP2 : fP1;
    const useSeed = (seed != null ? seed : (1000 + n)) >>> 0;
    await this.room.startRound(n, useSeed, seat);
    if (this.dead || !this.mp) return;
    if ((this.mp.gameNum | 0) < n) await this.applyRoundRecord({ n, deck: useSeed, dealer: seat }, null);
  }

  afterGameEnd() {   // _mpAfterGameEnd - series tally, idempotent per game number
    const mp = this.mp, s = this.state;
    if (!mp || !s || !s.over) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    if (s.winner === 0) mp.series.draws += 1;
    else mp.series.wins[s.winner] += 1;
    this.save();
  }

  async afterStateChange() {   // the MP branch of _afterMove - save FIRST is the invariant-4 ordering
    if (this.dead) return;
    this.save();
    if (this.state.over) {
      this.commitStats();
      this.afterGameEnd();
      this.save();   // finish() - re-save with statsCommitted (and any series bump) set
      this.gamesFinished++;
      return;
    }
    await this.tryDeliver();
    await this.takeTurnIfMine();
  }

  /** HARNESS ONLY: stands in for the local human's tap. The real UI waits for a click on a
   *  live color button; humanMove() below is the real method it calls. */
  async takeTurnIfMine() {
    if (this.dead || !this.state || this.state.over) return;
    if (this.state.turn !== this.localSeat()) return;
    await this.humanMove(this.policy(this.state));
  }

  async humanMove(color) {   // humanMove - local apply, MP bookkeeping, then the funnel
    if (!this.state || this.state.over || this.state.turn !== this.localSeat()) return;
    if (!this.isLegal(color)) return;
    this.afterLocalMove(color);
    fApplyMove(this.state, color);
    await this.afterStateChange();
  }

  commitStats() {   // finish() - `won` resolves through localSeat()
    if (this.statsCommitted) return;
    this.statsCommitted = true;
    const s = this.state;
    const won = s.winner === 0 ? null : (s.winner === this.localSeat());
    this.statsCommits.push({ difficulty: 'mp', won });
  }

  save() {   // _mpSaveSnapshot - seq read AFTER this move's own MP bookkeeping
    const mp = this.mp;
    if (!mp || !this.state) return;
    this.saves.push({
      v: 1, code: 'F', role: this.role, seq: mp.appliedSeq | 0, at: 0,
      gameNum: mp.gameNum | 0, nextDealer: mp.nextDealer,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      lastScoredGame: mp.lastScoredGame | 0,
      statsCommitted: !!this.statsCommitted,
      state: deep(fPlain(this.state)),
    });
  }

  roomCallback(room) {   // _mpRoomCallback
    if (this.dead) return;
    if (this.mp) { this.onRoomUpdate(room); return; }
    if (this.role === 'guest' && this.opts.autoStart && room.status === 'active' && room.round) this.guestStart(room);
  }

  guestStart(room) {   // _mpGuestStartMatch
    if (this.mp || this.dead) return;
    this.mp = fillerNewState('guest');
    this.mp.lastRoomSnapshot = room;
    this.applyRoundRecord(room.round, room);
  }

  hostStartMatch(dealer, seed) {   // _mpHostStartMatch
    this.mp = fillerNewState('host');
    return this.startNextGame(dealer, seed);
  }

  onRoomUpdate(room) {   // _mpOnRoomUpdate
    if (this.dead || !this.mp || !room) return;
    const mp = this.mp;
    mp.lastRoomSnapshot = room;
    if (room.status === 'ended' && !mp.opponentLeft) { mp.opponentLeft = true; return; }
    if (room.recovery) {
      if (mp.role === 'host' && room.recovery.requested != null && room.recovery.requested !== mp.lastRecoveryHandled) {
        mp.lastRecoveryHandled = room.recovery.requested;
        this.room.writeRecovery(mp.appliedSeq, this.snapshot()).catch(() => {});
      }
      if (mp.role === 'guest' && room.recovery.state && room.recovery.seq !== mp.lastRecoveryApplied) {
        mp.lastRecoveryApplied = room.recovery.seq;
        this.applyRecovery(room.recovery);
      }
    }
    const roundN = room.round ? (room.round.n | 0) : 0;
    if (room.round && roundN > (mp.gameNum | 0)) {
      this.applyRoundRecord(room.round, room);
    } else if (roundN === (mp.gameNum | 0) && this.state) {
      const entries = Object.values(room.moves || {});
      mp.movesById = new Map(entries.map((m) => [m.seq, m]));
      const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
      if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
      mp.maxKnownSeq = maxSeq;
      mp.redeliverRequested = true;
      this.tryDeliver();
    }
  }

  async restoreFromSave(save) {   // _tryRestoreMP (the join/heartbeat half elided: FakeRoom is always reachable)
    this.mp = fillerNewState(this.role);
    const mp = this.mp;
    mp.gameNum = save.gameNum | 0;
    mp.nextDealer = save.nextDealer === fP2 ? fP2 : fP1;
    // The series tally is carried through UNTOUCHED, same as Tic Tac Toe's/Mancala's restore.
    mp.series = fillerNormSeries(save.series);
    mp.lastScoredGame = save.lastScoredGame | 0;
    mp.appliedSeq = save.seq | 0;
    mp.maxKnownSeq = mp.appliedSeq;
    this.state = fFromPlain(deep(save.state));
    this.statsCommitted = !!save.statsCommitted;
    // No separate "boundary between games" await path is needed the way Tic Tac Toe's restore
    // has one -- either the saved game is still live (drain the tail) or it already finished
    // (commitStats()'s own guard, plus afterGameEnd's lastScoredGame guard, keep re-showing the
    // result idempotent; see F6). If the series has since moved on, the ordinary onRoomUpdate
    // roundN > gameNum branch picks up the next game ONCE the host publishes it -- no separate
    // await path, matching filler/js/ui.js's _tryRestoreMP.
    if (this.state.over) { this.commitStats(); return; }
    this.tryDeliver();
    this.takeTurnIfMine();
  }

  kill() { this.dead = true; this.room.offRoom(this._roomCb); }
}

function makeFiller(policy, opts = {}) {
  const room = new FakeRoom();
  room.config = {};
  const host = new FillerSide('host', room, policy, opts.host || {});
  const guest = new FillerSide('guest', room, policy, Object.assign({ autoStart: true }, opts.guest || {}));
  host.hostStartMatch(opts.dealer, opts.seed);
  return { room, host, guest };
}

// Filler: a single deterministic policy - always the FIRST legal color (fLegalColors(s)[0]).
// Unlike Tic Tac Toe/Mancala's split into a decisive vs. a tie-seeking script, this ONE policy
// produces both outcomes depending only on the seed (verified offline against the real engine):
// it never seeks captures, so nearly every game ends via the dry-move stalemate guard rather
// than a full board, and whether that stalemate is decisive or an exact tie depends on the
// board's own color layout for that seed. seed 1 (dealt to a first-legal-vs-first-legal game)
// is decisive (P2 wins, 50 moves); seed 4 is a genuine TIE (equal territory, 24 moves) - what
// invariant 1's probe (F2) needs: a tied game is over with winner === 0 (never a real seat), so
// any "is it finished" gate written against `winner` instead of `over` hangs exactly there.
const fFirstLegal = () => (s) => fLegalColors(s)[0];

// --- F1: Filler full match + the seat-identity (THE LAW rule 2) check --------------
console.log('\n--- F1: Filler full match, lockstep, hash-verified every applied move ---');
{
  const { room, host, guest } = makeFiller(fFirstLegal(), { seed: 1 });
  try {
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 15000, 'F1 game end');
    ok('F1: both sides completed the game (no hard failure)',
      host.gamesFinished === 1 && guest.gamesFinished === 1 && !host.failedHard && !guest.failedHard);
    ok('F1: zero hash mismatches across the whole game', host.mismatches === 0 && guest.mismatches === 0, `host=${host.mismatches} guest=${guest.mismatches}`);
    ok('F1: zero recoveries needed', host.recoveriesApplied === 0 && guest.recoveriesApplied === 0);
    ok('F1: final states hash-identical', fHash(host.state) === fHash(guest.state));
    ok('F1: same winner on both sides', host.state.winner === guest.state.winner, `host=${host.state.winner} guest=${guest.state.winner}`);
    ok('F1: no move-log overwrites (the shared seq never collided)', room.overwrites.length === 0, JSON.stringify(room.overwrites));
    ok('F1: host holds seat P1 (bottom-left), guest holds seat P2 (top-right)',
      host.localSeat() === fP1 && guest.localSeat() === fP2, `host=${host.localSeat()} guest=${guest.localSeat()}`);
    const hc = host.statsCommits[0], gc = guest.statsCommits[0];
    ok('F1: each device recorded exactly one result, in the mp difficulty bucket',
      host.statsCommits.length === 1 && guest.statsCommits.length === 1 && hc.difficulty === 'mp' && gc.difficulty === 'mp',
      JSON.stringify([host.statsCommits, guest.statsCommits]));
    ok('F1: the guest recorded ITS OWN result, not the host\'s\n' +
       '      (THE LAW rule 2: a loss written as a win is not additive-safe. This is the headless\n' +
       '      half of HANDOFF-MP-LOCAL-MACHINE.md\'s B2 check - the other half needs two real devices)',
      hc.won === (host.state.winner === fP1) && gc.won === (guest.state.winner === fP2) && hc.won !== gc.won,
      `host.won=${hc.won} guest.won=${gc.won} winner=${host.state.winner}`);
  } catch (e) { fail++; console.log(`FAIL  F1 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- F2: INVARIANT 1 ported - a TIE is a game end, and winner is 0 (no real seat) at it -----
console.log('\n--- F2: Filler tied game (KNOWN-BUG PROBE: a `winner`-keyed gate hangs at a winner-less end) ---');
{
  const { room, host, guest } = makeFiller(fFirstLegal(), { seed: 4 });
  try {
    await until(() => host.gamesFinished || host.failedHard || guest.failedHard, 15000, 'F2 host game end');
    ok('F2: the scripted game really is a TIE (equal territory, winner 0)',
      host.state.over === true && host.state.winner === 0 && host.state.counts[fP1] === host.state.counts[fP2],
      `over=${host.state.over} winner=${host.state.winner} p1=${host.state.counts[fP1]} p2=${host.state.counts[fP2]}`);
    ok('F2: zero hash mismatches', host.mismatches === 0 && guest.mismatches === 0);
    ok('F2 [KNOWN-BUG PROBE]: the GUEST also concludes a tied game, and records it\n' +
       '      (REGRESSION GUARD, invariant 1 ported: filler/js/ui.js\'s _afterMove/finish() must\n' +
       '      gate on state.over, NEVER on state.winner - winner is 0 (no real seat) for a genuine\n' +
       '      tie, so a gate written against "if (winner)" would silently skip both the end-of-game\n' +
       '      overlay and the stats commit on a tied match, the same shape as Chinchon\'s original\n' +
       '      match-end deadlock, ported to a game with no points/rounds of its own)',
      guest.gamesFinished === 1 && guest.state.over === true && guest.state.winner === 0,
      `guest.gamesFinished=${guest.gamesFinished} over=${guest.state && guest.state.over} winner=${guest.state && guest.state.winner}`);
    ok('F2: both devices recorded the tie AS a draw (won === null, never a fabricated win/loss)',
      host.statsCommits[0].won === null && guest.statsCommits[0].won === null,
      JSON.stringify([host.statsCommits[0], guest.statsCommits[0]]));
  } catch (e) { fail++; console.log(`FAIL  F2 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- F3: INVARIANT 2 ported - forced desync, recovery, seat identity ----------------
console.log('\n--- F3: Filler forced desync + recovery (KNOWN-BUG PROBE: recovery swaps the seats) ---');
{
  const { room, host, guest } = makeFiller(fFirstLegal(), { seed: 1, guest: { corruptAtSeq: 3 } });
  try {
    await until(() => guest.recoveriesApplied >= 1 || guest.failedHard || host.failedHard, 15000, 'F3 recovery applied');
    ok('F3: corruption was DETECTED as a hash mismatch', guest.mismatches >= 1, `guest mismatches=${guest.mismatches}`);
    ok('F3: host answered the desync flag with a recovery snapshot', guest.recoveriesApplied >= 1, `recoveries=${guest.recoveriesApplied}`);
    ok('F3 [KNOWN-BUG PROBE]: after recovery the guest still plays ITS OWN seat (P2), never the\n' +
       '      HOST\'s (P1)\n' +
       '      (REGRESSION GUARD, invariant 2: a transmitted snapshot must carry nothing device-\n' +
       '      relative. filler/js/ui.js\'s _mpSnapshot transmits only { gameNum, state } - the\n' +
       '      absolute board - and _localSeat() is fixed at match start (host=P1, guest=P2) and\n' +
       '      never re-derived from anything in the recovery payload, so there is no isHuman-style\n' +
       '      flag here to get swapped the way Chinchon/Escoba\'s original bug swapped one)',
      guest.localSeat() === fP2, `guest.localSeat()=${guest.localSeat()}`);
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 15000, 'F3 game end after recovery');
    ok('F3: the game finished cleanly on both sides after recovery',
      host.gamesFinished === 1 && guest.gamesFinished === 1 && !host.failedHard && !guest.failedHard);
    ok('F3: final states hash-identical after recovery', fHash(host.state) === fHash(guest.state));
    ok('F3: the recovered guest still recorded ITS OWN result',
      guest.statsCommits[0].won === (guest.state.winner === fP2), `guest.won=${guest.statsCommits[0].won} winner=${guest.state.winner}`);
  } catch (e) { fail++; console.log(`FAIL  F3 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- F4: INVARIANT 3 ported DIRECTLY - a rematch never reads game 1's log ----------
console.log('\n--- F4: Filler rematch (KNOWN-BUG PROBE: stale per-game consumption state) ---');
{
  const { room, host, guest } = makeFiller(fFirstLegal(), { seed: 1001 });
  try {
    await until(() => host.gamesFinished === 1 && guest.gamesFinished === 1, 15000, 'F4 game 1 end');
    const game1Log = Object.keys(room.moves).length;
    ok('F4: game 1 opened with the host (P1), mp.nextDealer\'s default at match start',
      host.roundResets.find((r) => r.n === 1).dealer === fP1 && game1Log > 0);
    // The host taps "Play again". startNextGame alternates, so game 2 opens with the GUEST's
    // seat -- the case a seat bug hides in. A fresh seed (1002) is rolled, never game 1's.
    await host.startNextGame(undefined, 1002);
    await until(() => guest.mp.gameNum === 2 || host.failedHard || guest.failedHard, 10000, 'F4 guest adopts game 2');
    ok('F4: both sides moved to game 2', host.mp.gameNum === 2 && guest.mp.gameNum === 2);
    // Measured AT the reset (roundResets), not by reading the live board after the fact: by the
    // time the poll above returns, game 2's own first move may already have been written and
    // applied, which would make a `state.turn` check racy -- mirrors why Tic Tac Toe's/
    // Mancala's own invariant-3 probe reads the frozen reset rather than the live board.
    const hostReset = host.roundResets.find((r) => r.n === 2);
    const guestReset = guest.roundResets.find((r) => r.n === 2);
    ok('F4: game 2 alternated the opening seat - P2 (the guest) opens now',
      !!(hostReset && guestReset) && hostReset.dealer === fP2 && guestReset.dealer === fP2,
      `hostReset.dealer=${hostReset && hostReset.dealer} guestReset.dealer=${guestReset && guestReset.dealer}`);
    ok('F4 [KNOWN-BUG PROBE]: game 2 starts from a CLEARED move log on both sides\n' +
       '      (REGRESSION GUARD, invariant 3 ported directly (a rematch series exists from the\n' +
       '      start here, same as Mancala\'s post-2026-07-27 shape). net.js startRound clears\n' +
       '      `moves` atomically with the record, and _mpApplyRoundRecord rebuilds the cache from\n' +
       '      THAT room snapshot and resets appliedSeq to 0; every entry also carries its game\n' +
       '      number. Carry any of that over and game 2 replays game 1\'s moves - the exact way\n' +
       '      round 2 replayed round 1\'s shuffle in Chinchon\'s original bug)',
      !!(hostReset && guestReset)
        && hostReset.appliedSeq === 0 && guestReset.appliedSeq === 0
        && hostReset.staleCached === 0 && guestReset.staleCached === 0,
      `game1 log had ${game1Log} entries; at the game-2 reset ` +
      `host=${JSON.stringify(hostReset)} guest=${JSON.stringify(guestReset)}`);
    await until(() => (host.gamesFinished === 2 && guest.gamesFinished === 2) || host.failedHard || guest.failedHard, 15000, 'F4 game 2 end');
    ok('F4: game 2\'s log holds only game 2\'s moves, all stamped g=2',
      Object.values(room.moves).every((e) => (e.move.g | 0) === 2),
      `games=${JSON.stringify([...new Set(Object.values(room.moves).map((e) => e.move.g))])}`);
    ok('F4: game 2 played to completion with zero mismatches', host.mismatches === 0 && guest.mismatches === 0 && host.gamesFinished === 2 && guest.gamesFinished === 2);
    const seriesTotal = (s) => s.wins[fP1] + s.wins[fP2] + s.draws;
    ok('F4: the series tally counts both games on both devices, seat-indexed the same way',
      JSON.stringify(host.mp.series) === JSON.stringify(guest.mp.series) && seriesTotal(host.mp.series) === 2,
      `host=${JSON.stringify(host.mp.series)} guest=${JSON.stringify(guest.mp.series)}`);
  } catch (e) { fail++; console.log(`FAIL  F4 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- F5: INVARIANT 4 ported - rejoin from autosave -----------------------------------
console.log('\n--- F5: Filler rejoin from autosave (KNOWN-BUG PROBE: save seq off-by-one) ---');
{
  // In-band freeze (same reasoning as Mancala's M5/Tic Tac Toe's T6): stop the guest's DELIVERY
  // once it has applied seq 5, mimicking a device backgrounded mid-game with the host one or
  // more moves ahead.
  let guestRef = null;
  const { room, host, guest } = makeFiller(fFirstLegal(), {
    seed: 1,
    guest: { frozen: () => guestRef !== null && guestRef.mp !== null && guestRef.mp.appliedSeq >= 5 },
  });
  guestRef = guest;
  let restored = null;
  try {
    await until(() => guest.mp && guest.mp.appliedSeq >= 5 && room.moves['0006'], 15000, 'F5 guest frozen with a tail waiting');
    await new Promise((r) => setTimeout(r, 100));
    const midSaves = guest.saves.filter((s) => !s.state.over);
    const lastSave = midSaves[midSaves.length - 1];
    guest.kill();

    // Mechanism probe, direct. CORRECT: the saved state contains exactly moves 1..seq, so it
    // hashes equal to the log entry AT seq and NOT to the entry at seq+1 (which the restore
    // path is about to replay onto it).
    const atSeq = room.moves[String(lastSave.seq | 0).padStart(4, '0')];
    const atNext = room.moves[String((lastSave.seq | 0) + 1).padStart(4, '0')];
    const savedHash = fHash(fFromPlain(lastSave.state));
    ok('F5 [KNOWN-BUG PROBE]: the autosave\'s seq matches its own snapshot\n' +
       '      (REGRESSION GUARD, invariant 4: filler/js/ui.js\'s _afterMove/_mpApplyNextEntry must\n' +
       '      run the move\'s MP bookkeeping FIRST - _mpAfterLocalMove reserving+appending the seq\n' +
       '      before the real applyMove(), or _mpApplyNextEntry advancing appliedSeq before the\n' +
       '      ripple settle-await - and only THEN call _mpSaveSnapshot. Saving first stores mp.seq\n' +
       '      one LOW relative to the move already inside the snapshot, so _tryRestoreMP rebuilds\n' +
       '      post-move-N state with appliedSeq N-1 and re-applies move N: a guaranteed desync on\n' +
       '      every rejoin, the exact case the 30-minute restore window exists for. Escoba shipped\n' +
       '      this bug on its play hook)',
      !!atSeq && savedHash === atSeq.h && !(atNext && savedHash === atNext.h),
      `save.seq=${lastSave.seq}; entry@seq ${atSeq ? (savedHash === atSeq.h ? 'matches the snapshot (correct)' : 'does NOT match') : 'absent'}; entry@seq+1 ${atNext ? (savedHash === atNext.h ? 'ALSO matches - the save is one behind' : 'does not match (correct)') : 'absent'}`);

    // End-to-end: a fresh device restores from that save and replays the tail.
    restored = new FillerSide('guest', room, fFirstLegal(), {});
    await restored.restoreFromSave(lastSave);
    await until(() => restored.gamesFinished > 0 || restored.mismatches > 0 || restored.failedHard, 15000, 'F5 restored guest finishes');
    ok('F5: the restored guest replayed the tail cleanly (zero mismatches, no hard failure)',
      restored.mismatches === 0 && !restored.failedHard,
      `restored mismatches=${restored.mismatches} appliedSeq=${restored.mp.appliedSeq} failedHard=${restored.failedHard}`);
    ok('F5: the restored guest reached the same finished game as the host',
      !!restored.state && restored.state.over && fHash(restored.state) === fHash(host.state),
      `restored over=${restored.state && restored.state.over} host over=${host.state.over}`);
    ok('F5: the restored guest kept its own seat (P2)',
      restored.localSeat() === fP2, `seat=${restored.localSeat()}`);
  } catch (e) { fail++; console.log(`FAIL  F5 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); if (restored) restored.kill(); }
}

// --- F6: INVARIANT 5 ported by analogy - restoring an already-finished game ---------
console.log('\n--- F6: Filler restore at a game boundary (KNOWN-BUG PROBE: restore re-runs a finished game) ---');
{
  const { room, host, guest } = makeFiller(fFirstLegal(), { seed: 1 });
  let restored = null;
  try {
    await until(() => host.gamesFinished === 1 && guest.gamesFinished === 1, 15000, 'F6 game end');
    await new Promise((r) => setTimeout(r, 30));
    const boundarySave = deep(guest.saves[guest.saves.length - 1]);
    ok('F6: the guest\'s final save is a BOUNDARY save (state over, statsCommitted true)',
      !!boundarySave && boundarySave.state.over === true && boundarySave.statsCommitted === true,
      JSON.stringify({ over: boundarySave.state.over, statsCommitted: boundarySave.statsCommitted }));
    cleanup(room, host, guest);

    restored = new FillerSide('guest', new FakeRoom(), fFirstLegal(), {});
    await restored.restoreFromSave(boundarySave);
    ok('F6 [KNOWN-BUG PROBE, ported by analogy]: restoring an ALREADY-FINISHED game does not\n' +
       '      re-run or re-initialize it\n' +
       '      (REGRESSION GUARD, invariant 5 ported: a rematch series exists here from the start\n' +
       '      (see F4), so a boundary restore has a real "next game" it could wrongly derive\n' +
       '      locally instead of awaiting the host\'s record -- filler/js/ui.js\'s _tryRestoreMP\n' +
       '      deliberately does NOT call _mpApplyRoundRecord (which calls newGame()) on a save\n' +
       '      whose game already ended; that would silently start a SECOND game nobody asked for\n' +
       '      and re-arm statsCommitted for a game that was already recorded, the same class of\n' +
       '      bug as Chinchon\'s initMatch wipe, just replacing "scores zeroed" with "a phantom\n' +
       '      rematch begins". The restored side must instead recognize state.over and stop,\n' +
       '      relying on the ordinary onRoomUpdate roundN > gameNum branch to pick up the next\n' +
       '      game once the host actually publishes one)',
      restored.mp.gameNum === boundarySave.gameNum && restored.state.over === true
        && fHash(restored.state) === fHash(fFromPlain(boundarySave.state)) && restored.statsCommitted === true,
      `gameNum=${restored.mp.gameNum} over=${restored.state && restored.state.over} committed=${restored.statsCommitted}`);
    ok('F6: it did not double-record the finished game it restored',
      restored.statsCommits.length === 0,
      `commits=${JSON.stringify(restored.statsCommits)}`);
    ok('F6: the series tally is carried through the restore UNTOUCHED, not zeroed\n' +
       '      (the initMatch-wipe failure shape from js/CLAUDE.md\'s invariant 5, translated to\n' +
       '      this game\'s vocabulary: a restore that reset mp.series to {wins:[0,0,0],draws:0}\n' +
       '      would silently erase the series tally the moment either device backgrounds and\n' +
       '      restores mid-series)',
      JSON.stringify(restored.mp.series) === JSON.stringify(boundarySave.series),
      `restored=${JSON.stringify(restored.mp.series)} saved=${JSON.stringify(boundarySave.series)}`);
  } catch (e) { fail++; console.log(`FAIL  F6 did not complete: ${e.message}`); }
  finally { if (restored) restored.kill(); }
}


// ==================================================================================
// DOTS AND BOXES side (mirror of dots-boxes/js/ui.js's MP glue)
//
// Shape: no agent interface, engine is a synchronous applyMove(state, edge) that MUTATES its
// argument in place and returns { claimed, again, boxes } rather than a new state (Tic Tac Toe's
// shape, not Mancala's pure-returns-a-new-state one) -- so this class re-uses TTT's "state stays
// the same reference" pattern for humanMove()/applyNextEntry(), not Mancala's `this.state =
// result.state` reassignment.
//
// MOVE GRANULARITY (the one design decision this web session could not fully de-risk without a
// real network -- see this file's header and dots-boxes/js/ui.js's own header comment): ONE
// LOCKSTEP MOVE PER DRAWN EDGE, matching applyMove()'s own grain. A single real turn can chain-
// capture many boxes (completing a box's 4th side grants another move, see game.js's header), so
// this is many rapid appendMove calls inside one turn, not one batched "chain" move -- the
// simplest thing that can work. `turn` only flips when a move claims nothing, so both sides stay
// in lockstep on "whose turn is it" after every single edge, verified by the hash check on every
// one of them (dots-boxes/js/hash.js includes `turn` and `drawnEdges` in the canonical form for
// exactly this reason).
//
// DELIVERY IS ASYNC, same reasoning as Mancala: dots-boxes/js/ui.js's real _mpApplyNextEntry
// gives each remote edge a brief PACED delay (MP_DELIVER_STEP_MS, so a chain capture's box-claim
// pop animation has time to play before the next edge lands) before the next log entry can be
// delivered -- that await is exactly the gap mancala/js/ui.js's redeliverRequested flag exists
// to cover (a room update landing mid-delay, right after the drain loop's own "nothing left to
// apply" check already read a stale cache). This harness mirrors the async shape with a much
// shorter delay (1ms vs. the real 260ms) to keep the suite fast -- the race the delay opens is
// the same regardless of its duration.
//
// Vocabulary map (js/net.js is untouched, so its field names are reused as-is):
//   a "round" record  = ONE GAME of a rematch series this room hosts, same vocabulary as Tic Tac
//                        Toe/Mancala.
//   round.n           = the game number
//   round.deck        = unused (no cards, no rng)
//   round.dealer      = the NETWORK seat (0 host / 1 guest) that plays ENGINE seat 0 (i.e.
//                        opens) that game, alternated by the HOST every game
//                        (_resolveStarter()/startNextGame). Engine seat 0/1 is SYMMETRIC here
//                        (unlike Mancala's physically different board halves), so which engine
//                        seat a network seat plays is reassigned every game -- Tic Tac Toe's
//                        "swappable marks" shape, not Mancala's fixed-seat deviation. humanSeat/
//                        aiSeat below are the resolved ENGINE seats.
//   writeResult       = deliberately NOT used; status:'ended' means somebody abandoned the room
// ==================================================================================
const DB_ROWS = 2, DB_COLS = 2;   // small, fast board (12 edges, 4 boxes) for the whole suite

function dbNewState(role) {   // _mpNewState (UI-only fields dropped)
  return {
    role, localSeat: role === 'host' ? 0 : 1,
    gameNum: 0,
    dealer: 0,   // the NETWORK seat that plays engine seat 0 (opens) in the CURRENT game
    series: { wins: [0, 0], draws: 0 },   // seat-indexed by NETWORK seat, never device-relative
    lastScoredGame: 0,   // afterGameEnd's idempotence guard
    appliedSeq: 0, maxKnownSeq: 0, movesById: new Map(),
    replayMode: false, recoveryAttempts: 0, delivering: false, awaitingRecovery: false,
    // See tryDeliver()'s comment: an async drain can check "is there a next entry" against a
    // stale cache right as a room update lands with the answer. Real bug this harness surfaces
    // for Mancala's identical shape, fixed in both games' real ui.js too.
    redeliverRequested: false,
    opponentLeft: false, lastRoomSnapshot: null,
    lastRecoveryHandled: null, lastRecoveryApplied: null,
  };
}
const dbNormSeries = (s) => ({ wins: [((s && s.wins) || [])[0] | 0, ((s && s.wins) || [])[1] | 0], draws: (s && s.draws) | 0 });

class DotsBoxesSide {
  constructor(role, room, policy, opts = {}) {
    this.role = role; this.room = room; this.policy = policy; this.opts = opts;
    this.mp = null; this.state = null;
    this.humanSeat = 0; this.aiSeat = 1;   // resolved ENGINE seats, set by applyRoundRecord/applyRecovery
    this.dead = false; this.failedHard = false;
    this.mismatches = 0; this.recoveriesApplied = 0;
    this.statsCommitted = false;
    this.gamesFinished = 0;
    this.statsCommits = [];   // commitStats's result, captured instead of written
    this.saves = [];          // in-memory _mpSaveSnapshot
    this.roundResets = [];    // harness-only: what each applyRoundRecord reset actually saw
    this._roomCb = (r) => this.roomCallback(r);
    room.onRoom(this._roomCb);
  }

  localSeat() { return this.mp ? this.mp.localSeat : 0; }
  remoteSeat() { return 1 - this.localSeat(); }

  isLegal(edge) {   // _isLegal - the ONE legality gate, read by the local tap AND every remote move
    const s = this.state;
    if (!s || dIsOver(s)) return false;
    return dLegal(s).some((m) => dEdgeKey(m) === dEdgeKey(edge));
  }

  encodeMove(edge) { return { t: 'move', g: this.mp.gameNum, e: edge.type, r: edge.r | 0, c: edge.c | 0 }; }   // _mpEncodeMove
  decodeMove(m) { return { type: m.e === 'v' ? 'v' : 'h', r: m.r | 0, c: m.c | 0 }; }   // _mpDecodeMove

  afterLocalMove(edge) {   // _mpAfterLocalMove - seq reserved SYNCHRONOUSLY, before any await
    const mp = this.mp;
    if (!mp) return;
    const seq = ++mp.appliedSeq;
    const hash = dHash(this.state);
    this.room.appendMove(this.role, seq, this.encodeMove(edge), hash).catch(() => {});
  }

  delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async tryDeliver() {   // _mpTryDeliverNextMove - ASYNC (see the class comment above)
    const mp = this.mp;
    if (!mp || mp.delivering || mp.awaitingRecovery || this.dead || !this.state) return;
    if (this.opts.frozen && this.opts.frozen()) return;   // harness-only freeze (a backgrounded device)
    mp.delivering = true;
    mp.redeliverRequested = false;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (await this.applyNextEntry()) continue;
        if (mp.redeliverRequested) { mp.redeliverRequested = false; continue; }
        break;
      }
    } finally { mp.delivering = false; }
  }

  async applyNextEntry() {   // _mpApplyNextEntry
    const mp = this.mp;
    if (!mp || mp.awaitingRecovery || !mp.movesById || !this.state || dIsOver(this.state)) return false;
    const seq = mp.appliedSeq + 1;
    const entry = mp.movesById.get(seq);
    if (!entry || !entry.move || entry.move.t !== 'move') return false;
    if ((entry.move.g | 0) !== (mp.gameNum | 0)) return false;   // never consume another game's entry
    const edge = this.decodeMove(entry.move);
    let agreed = this.isLegal(edge);
    let res = null;
    if (agreed) {
      res = dApply(this.state, edge);   // mutates this.state in place
      if (this.opts.corruptAtSeq === seq && !this._corrupted) {
        // A pure HASH divergence, zero bearing on real gameplay (drawnEdges is never read for
        // legality; overwritten wholesale by the next recovery), same device as T3/M3's approach.
        this._corrupted = true;
        this.state.drawnEdges += 1;
      }
      agreed = dHash(this.state) === entry.h;
    }
    if (!agreed) { this.mismatches++; return this.onDivergence(seq); }
    mp.appliedSeq = seq;
    mp.recoveryAttempts = 0;
    if (mp.replayMode && mp.appliedSeq >= mp.maxKnownSeq) mp.replayMode = false;
    // Harness-only pacing (see the class comment: 1ms here vs. the real ui.js's 260ms) -- the
    // await is what opens the redeliverRequested race.
    await this.delay(1);
    if (this.dead || !this.mp) return false;
    await this.afterStateChange();
    return true;
  }

  onDivergence(seq) {   // _mpOnDivergence - host takes the seq and publishes; guest latches
    const mp = this.mp;
    mp.recoveryAttempts = (mp.recoveryAttempts || 0) + 1;
    if (mp.recoveryAttempts > MP_RECOVERY_MAX_ATTEMPTS) { this.failedHard = true; return false; }
    if (mp.role === 'host') {
      mp.appliedSeq = seq;
      this.room.writeRecovery(seq, this.snapshot()).catch(() => {});
      return true;
    }
    mp.awaitingRecovery = true;
    this.room.requestRecovery(seq).catch(() => {});
    return false;
  }

  snapshot() {   // _mpSnapshot - nothing device-relative: absolute state, seat re-derived locally
    const mp = this.mp;
    return {
      v: 1, gameNum: mp.gameNum, dealer: mp.dealer,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      state: deep(this.state),
    };
  }

  async applyRecovery(recovery) {   // _mpApplyRecovery - engine seat RE-DERIVED from network seat
    const mp = this.mp;
    if (!mp || this.dead) return;
    const snap = deep(recovery.state);
    mp.gameNum = snap.gameNum | 0;
    mp.dealer = snap.dealer === 1 ? 1 : 0;
    mp.series = dbNormSeries(snap.series);
    this.humanSeat = this.localSeat() === mp.dealer ? 0 : 1;
    this.aiSeat = 1 - this.humanSeat;
    this.state = snap.state;
    mp.appliedSeq = recovery.seq | 0;
    mp.maxKnownSeq = Math.max(mp.maxKnownSeq | 0, mp.appliedSeq);
    mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    mp.lastScoredGame = dIsOver(this.state) ? mp.gameNum : mp.lastScoredGame;
    this.recoveriesApplied++;
    this.room.clearRecovery().catch(() => {});
    await this.afterStateChange();
  }

  async applyRoundRecord(round, room) {   // _mpApplyRoundRecord - the ONE place a game's dealer is decided
    const mp = this.mp;
    if (!mp || this.dead || !round) return;
    mp.gameNum = round.n | 0;
    mp.dealer = round.dealer === 1 ? 1 : 0;
    this.humanSeat = this.localSeat() === mp.dealer ? 0 : 1;
    this.aiSeat = 1 - this.humanSeat;
    mp.appliedSeq = 0; mp.replayMode = false; mp.recoveryAttempts = 0; mp.awaitingRecovery = false;
    const entries = Object.values((room && room.moves) || {});
    mp.movesById = new Map(entries.map((m) => [m.seq, m]));
    mp.maxKnownSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
    this.statsCommitted = false;
    this.state = dNewGame(DB_ROWS, DB_COLS);
    // HARNESS ONLY: freeze what the per-game reset actually saw, so DB4 can probe the exact
    // instant a new game begins, same reasoning as T5/M4's roundResets.
    this.roundResets.push({
      n: mp.gameNum,
      dealer: mp.dealer,
      appliedSeq: mp.appliedSeq,
      cached: mp.movesById.size,
      staleCached: [...mp.movesById.values()].filter((e) => (e.move.g | 0) !== mp.gameNum).length,
    });
    await this.afterStateChange();
  }

  /** _mpStartNextGame. The real method resolves who opens through _resolveStarter(); the
   *  harness passes the resolved dealer in, defaulting to alternation (game 1 = host, game 2 =
   *  guest, ...), matching the real default (firstMode 'alternate' on a fresh settings store). */
  async startNextGame(dealer) {
    const mp = this.mp;
    if (!mp || mp.role !== 'host' || this.dead) return;
    const n = (mp.gameNum | 0) + 1;
    const seat = dealer != null ? dealer : (mp.gameNum | 0) % 2;
    await this.room.startRound(n, null, seat);
    if (this.dead || !this.mp) return;
    if ((this.mp.gameNum | 0) < n) await this.applyRoundRecord({ n, dealer: seat }, null);
  }

  afterGameEnd() {   // _mpAfterGameEnd - series tally, idempotent per game number
    const mp = this.mp, s = this.state;
    if (!mp || !s || !dIsOver(s)) return;
    if (mp.lastScoredGame === mp.gameNum) return;
    mp.lastScoredGame = mp.gameNum;
    const sc = dScore(s);
    const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
    if (humanScore === aiScore) mp.series.draws += 1;
    else mp.series.wins[humanScore > aiScore ? this.localSeat() : this.remoteSeat()] += 1;
    this.save();
  }

  commitStats() {   // _commitStats - `won` resolves through humanSeat, i.e. through localSeat()/dealer
    if (this.statsCommitted) return;
    this.statsCommitted = true;
    const s = this.state;
    const sc = dScore(s);
    const humanScore = this.humanSeat === 0 ? sc.p0 : sc.p1, aiScore = this.aiSeat === 0 ? sc.p0 : sc.p1;
    const won = humanScore === aiScore ? null : humanScore > aiScore;
    this.statsCommits.push({ difficulty: 'mp', won, humanScore, aiScore });
  }

  save() {   // _mpSaveSnapshot - seq read AFTER this move's own MP bookkeeping
    const mp = this.mp;
    if (!mp || !this.state) return;
    this.saves.push({
      v: 1, code: 'D', role: this.role, seq: mp.appliedSeq | 0, at: 0,
      gameNum: mp.gameNum | 0, dealer: mp.dealer | 0,
      series: { wins: mp.series.wins.slice(), draws: mp.series.draws | 0 },
      midGame: !dIsOver(this.state), statsCommitted: !!this.statsCommitted,
      lastScoredGame: mp.lastScoredGame | 0,
      state: deep(this.state),
    });
  }

  /** _afterStateChange, MP branch (save FIRST is the invariant-4 ordering). Fully awaited
   *  end-to-end for the same reason as MancalaSide: this class's own tryDeliver()/
   *  applyNextEntry() are async, so a harness auto-play driver that fired-and-forgot would race
   *  ahead and read stale state; the real UI has no such driver. */
  async afterStateChange() {
    if (this.dead) return;
    this.save();
    if (dIsOver(this.state)) {
      this.commitStats();
      this.afterGameEnd();
      this.save();   // finish() - re-save with statsCommitted (and any series bump) set
      this.gamesFinished++;
      return;
    }
    await this.tryDeliver();
    await this.takeTurnIfMine();
  }

  /** HARNESS ONLY: stands in for the local human's tap. Naturally repeats for a chain capture --
   *  after a capturing move, `state.turn` stays this seat, so afterStateChange calls this again
   *  and the policy just plays the next edge of its own chain, mirroring a real player clicking
   *  through a capture streak. */
  async takeTurnIfMine() {
    if (this.dead || !this.state || dIsOver(this.state)) return;
    if (this.state.turn !== this.humanSeat) return;
    await this.humanMove(this.policy(this.state));
  }

  async humanMove(edge) {   // humanMove - local apply, MP bookkeeping, then the funnel
    if (!this.state || dIsOver(this.state) || this.state.turn !== this.humanSeat) return;
    if (!this.isLegal(edge)) return;
    dApply(this.state, edge);   // mutates this.state in place
    this.afterLocalMove(edge);
    await this.afterStateChange();
  }

  roomCallback(room) {   // _mpRoomCallback
    if (this.dead) return;
    if (this.mp) { this.onRoomUpdate(room); return; }
    if (this.role === 'guest' && this.opts.autoStart && room.status === 'active' && room.round) this.guestStart(room);
  }

  guestStart(room) {   // _mpGuestStartMatch
    if (this.mp || this.dead) return;
    this.mp = dbNewState('guest');
    this.mp.lastRoomSnapshot = room;
    this.applyRoundRecord(room.round, room);
  }

  hostStartMatch(dealer) {   // _mpHostStartMatch
    this.mp = dbNewState('host');
    return this.startNextGame(dealer);
  }

  async onRoomUpdate(room) {   // _mpOnRoomUpdate
    if (this.dead || !this.mp || !room) return;
    const mp = this.mp;
    mp.lastRoomSnapshot = room;
    if (room.status === 'ended' && !mp.opponentLeft) { mp.opponentLeft = true; return; }
    if (room.recovery) {
      if (mp.role === 'host' && room.recovery.requested != null && room.recovery.requested !== mp.lastRecoveryHandled) {
        mp.lastRecoveryHandled = room.recovery.requested;
        this.room.writeRecovery(mp.appliedSeq, this.snapshot()).catch(() => {});
      }
      if (mp.role === 'guest' && room.recovery.state && room.recovery.seq !== mp.lastRecoveryApplied) {
        mp.lastRecoveryApplied = room.recovery.seq;
        await this.applyRecovery(room.recovery);
      }
    }
    const roundN = room.round ? (room.round.n | 0) : 0;
    if (room.round && roundN > (mp.gameNum | 0)) {
      await this.applyRoundRecord(room.round, room);
    } else if (roundN === (mp.gameNum | 0)) {
      const entries = Object.values(room.moves || {});
      mp.movesById = new Map(entries.map((m) => [m.seq, m]));
      const maxSeq = entries.reduce((mx, e) => Math.max(mx, e.seq | 0), 0);
      if (maxSeq > mp.appliedSeq + 1) mp.replayMode = true;
      mp.maxKnownSeq = maxSeq;
      mp.redeliverRequested = true;
      this.tryDeliver();
    }
  }

  async restoreFromSave(save) {   // _tryRestoreMP (the join/heartbeat half elided: FakeRoom is always reachable)
    this.mp = dbNewState(this.role);
    const mp = this.mp;
    mp.gameNum = save.gameNum | 0;
    mp.dealer = save.dealer === 1 ? 1 : 0;
    mp.series = dbNormSeries(save.series);
    mp.lastScoredGame = save.midGame ? 0 : (save.lastScoredGame | 0);
    mp.appliedSeq = save.seq | 0;
    mp.maxKnownSeq = mp.appliedSeq;
    this.humanSeat = this.localSeat() === mp.dealer ? 0 : 1;
    this.aiSeat = 1 - this.humanSeat;
    this.state = deep(save.state);
    this.statsCommitted = !!save.statsCommitted;
    if (save.midGame) { await this.tryDeliver(); await this.takeTurnIfMine(); return; }
    // A BOUNDARY save: re-show the finished game's result (finish()'s own idempotence guard,
    // mirrored here as commitStats(), covers the double-count risk) rather than deriving or
    // auto-starting the next game -- mirrors mancala/js/ui.js's restore, deliberately NOT tic-
    // tac-toe/js/ui.js's auto-startNextGame-on-restore shape. See dots-boxes/js/ui.js's
    // _tryRestoreMP comment for why this game picked Mancala's shape.
    if (dIsOver(this.state)) this.commitStats();
  }

  kill() { this.dead = true; this.room.offRoom(this._roomCb); }
}

function makeDotsBoxes(policy, opts = {}) {
  const room = new FakeRoom();
  room.config = { size: 'small' };
  const host = new DotsBoxesSide('host', room, policy, opts.host || {});
  const guest = new DotsBoxesSide('guest', room, policy, Object.assign({ autoStart: true }, opts.guest || {}));
  host.hostStartMatch();
  return { room, host, guest };
}

// Dots and Boxes: deterministic scripted policies, same shape as Tic Tac Toe's/Mancala's (both
// sides run the SAME policy; only the DECIDING side's choice is ever used).
//   dbLastLegal  - always legalMoves(s)[legalMoves.length-1]. On the 2x2 test board this is a
//                  real, decisive game (4-0) that includes a genuine multi-box CHAIN CAPTURE --
//                  verified offline -- exactly what DB1 needs to prove the per-edge move
//                  granularity: many lockstep moves inside one real turn, not one batched move.
//   dbFirstLegal - always legalMoves(s)[0]. On the 2x2 board this reaches a genuine TIE (2-2,
//                  drawnEdges === totalEdges) -- verified offline -- what invariant 1's probe
//                  (DB2) needs.
const dbLastLegal = () => (s) => { const l = dLegal(s); return l[l.length - 1]; };
const dbFirstLegal = () => (s) => dLegal(s)[0];

// --- DB1: Dots and Boxes full match + the seat-identity (THE LAW rule 2) check -----
console.log('\n--- DB1: Dots and Boxes full match, lockstep, hash-verified every applied EDGE ---');
{
  const { room, host, guest } = makeDotsBoxes(dbLastLegal());
  try {
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 15000, 'DB1 game end');
    ok('DB1: both sides completed the game (no hard failure)',
      host.gamesFinished === 1 && guest.gamesFinished === 1 && !host.failedHard && !guest.failedHard);
    ok('DB1: zero hash mismatches across the whole game', host.mismatches === 0 && guest.mismatches === 0, `host=${host.mismatches} guest=${guest.mismatches}`);
    ok('DB1: zero recoveries needed', host.recoveriesApplied === 0 && guest.recoveriesApplied === 0);
    ok('DB1: final states hash-identical', dHash(host.state) === dHash(guest.state));
    ok('DB1: it really was a decisive game with a real chain capture, not a trivial accident\n' +
       '      (all 12 edges logged, but a 2x2 board has only 4 boxes, and the score is 4-0 -- one\n' +
       '      side must have captured MULTIPLE boxes across MULTIPLE lockstep moves without the\n' +
       '      turn ever passing back, proving per-edge granularity actually threads a chain\n' +
       '      correctly rather than only ever exercising single, non-chaining moves)',
      Object.keys(room.moves).length === 12 && (host.state.boxes.flat().filter((o) => o === 0).length === 4
        || host.state.boxes.flat().filter((o) => o === 1).length === 4),
      `edges=${Object.keys(room.moves).length} boxes=${JSON.stringify(host.state.boxes)}`);
    ok('DB1: no move-log overwrites (the shared seq never collided)', room.overwrites.length === 0, JSON.stringify(room.overwrites));
    ok('DB1: host holds network seat 0, guest holds network seat 1',
      host.localSeat() === 0 && guest.localSeat() === 1, `host=${host.localSeat()} guest=${guest.localSeat()}`);
    const hc = host.statsCommits[0], gc = guest.statsCommits[0];
    ok('DB1: each device recorded exactly one result, in the mp difficulty bucket',
      host.statsCommits.length === 1 && guest.statsCommits.length === 1 && hc.difficulty === 'mp' && gc.difficulty === 'mp',
      JSON.stringify([host.statsCommits, guest.statsCommits]));
    ok('DB1: the guest recorded ITS OWN result, not the host\'s\n' +
       '      (THE LAW rule 2: a loss written as a win is not additive-safe. This is the headless\n' +
       '      half of HANDOFF-MP-LOCAL-MACHINE.md\'s B2 check - the other half needs two real devices)',
      hc.won !== gc.won, `host.won=${hc.won} guest.won=${gc.won}`);
  } catch (e) { fail++; console.log(`FAIL  DB1 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- DB2: INVARIANT 1 ported - a TIE is a game end, and there is no `winner` field to mis-gate on --
console.log('\n--- DB2: Dots and Boxes tied game (KNOWN-BUG PROBE: an equal-score gate hangs at a tie) ---');
{
  const { room, host, guest } = makeDotsBoxes(dbFirstLegal());
  try {
    // Waits for BOTH sides here, unlike T2/M2's host-only wait: DB's remote delivery has a real
    // (harness: 1ms) paced setTimeout between entries (mirroring the production pacing delay,
    // see the class comment above), so the guest's tail replay does not necessarily finish
    // inside the same microtask flush as the host's local finish the way Mancala's does.
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 15000, 'DB2 both sides game end');
    const sc = dScore(host.state);
    ok('DB2: the scripted game really is a TIE (equal boxes, all edges drawn)',
      dIsOver(host.state) && sc.p0 === sc.p1, `over=${dIsOver(host.state)} p0=${sc.p0} p1=${sc.p1}`);
    ok('DB2: zero hash mismatches', host.mismatches === 0 && guest.mismatches === 0);
    ok('DB2 [KNOWN-BUG PROBE]: the GUEST also concludes a tied game, and records it\n' +
       '      (REGRESSION GUARD, invariant 1 ported: unlike Chinchon/Tic Tac Toe/Mancala, this\n' +
       '      game has no `winner` FIELD on its state to gate on in the first place -- isOver(s) is\n' +
       '      purely drawnEdges>=totalEdges, so there is no separate "match over" flag that could\n' +
       '      lag behind a genuine tie the way a points/rounds `winner` can. The equivalent mistake\n' +
       '      here would be gating game-end on a derived proxy (e.g. "every box has an owner",\n' +
       '      which is NOT equivalent on a board with an odd edge count if one were ever added) -\n' +
       '      dots-boxes/js/ui.js\'s _afterStateChange/finish() gate on isOver(state) directly, and\n' +
       '      that must stay true for the GUEST\'s copy too, not just the host\'s)',
      guest.gamesFinished === 1 && dIsOver(guest.state) && dScore(guest.state).p0 === dScore(guest.state).p1,
      `guest.gamesFinished=${guest.gamesFinished} over=${guest.state && dIsOver(guest.state)}`);
    ok('DB2: both devices recorded the tie AS a tie (won === null, never a fabricated win/loss)',
      host.statsCommits[0].won === null && guest.statsCommits[0].won === null,
      JSON.stringify([host.statsCommits[0], guest.statsCommits[0]]));
  } catch (e) { fail++; console.log(`FAIL  DB2 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- DB3: INVARIANT 2 ported - forced desync, recovery, seat identity --------------
console.log('\n--- DB3: Dots and Boxes forced desync + recovery (KNOWN-BUG PROBE: recovery swaps the seats) ---');
{
  const { room, host, guest } = makeDotsBoxes(dbLastLegal(), { guest: { corruptAtSeq: 3 } });
  try {
    await until(() => guest.recoveriesApplied >= 1 || guest.failedHard || host.failedHard, 15000, 'DB3 recovery applied');
    ok('DB3: corruption was DETECTED as a hash mismatch', guest.mismatches >= 1, `guest mismatches=${guest.mismatches}`);
    ok('DB3: host answered the desync flag with a recovery snapshot', guest.recoveriesApplied >= 1, `recoveries=${guest.recoveriesApplied}`);
    ok('DB3 [KNOWN-BUG PROBE]: after recovery the guest still holds ITS OWN network seat (1),\n' +
       '      never the HOST\'s (0)\n' +
       '      (REGRESSION GUARD, invariant 2: a transmitted snapshot must carry nothing device-\n' +
       '      relative. dots-boxes/js/ui.js\'s _mpSnapshot transmits only { gameNum, dealer, state }\n' +
       '      - all absolute/seat-indexed - and localSeat() is fixed at match start (host=0,\n' +
       '      guest=1) and never re-derived from the recovery payload, so there is no isHuman-style\n' +
       '      flag here to get swapped the way Chinchon/Escoba\'s original bug swapped one; the\n' +
       '      humanSeat/aiSeat ENGINE seats are re-derived from localSeat()+dealer on every\n' +
       '      recovery, which is what this probe actually exercises)',
      guest.localSeat() === 1, `guest.localSeat()=${guest.localSeat()}`);
    await until(() => (host.gamesFinished && guest.gamesFinished) || host.failedHard || guest.failedHard, 15000, 'DB3 game end after recovery');
    ok('DB3: the game finished cleanly on both sides after recovery',
      host.gamesFinished === 1 && guest.gamesFinished === 1 && !host.failedHard && !guest.failedHard);
    ok('DB3: final states hash-identical after recovery', dHash(host.state) === dHash(guest.state));
    ok('DB3: the recovered guest still recorded ITS OWN result',
      guest.statsCommits[0].won === (guest.statsCommits[0].humanScore > guest.statsCommits[0].aiScore),
      JSON.stringify(guest.statsCommits[0]));
  } catch (e) { fail++; console.log(`FAIL  DB3 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- DB4: INVARIANT 3 ported DIRECTLY - a rematch never reads game 1's log ---------
console.log('\n--- DB4: Dots and Boxes rematch (KNOWN-BUG PROBE: stale per-game consumption state) ---');
{
  const { room, host, guest } = makeDotsBoxes(dbLastLegal());
  try {
    await until(() => host.gamesFinished === 1 && guest.gamesFinished === 1, 15000, 'DB4 game 1 end');
    const game1Log = Object.keys(room.moves).length;
    ok('DB4: game 1 opened with the host (network seat 0), the default at match start',
      host.roundResets.find((r) => r.n === 1).dealer === 0 && game1Log > 0);
    // The host taps "Play again". startNextGame alternates, so game 2 opens with the GUEST's
    // network seat -- the case a seat bug hides in.
    await host.startNextGame();
    await until(() => guest.mp.gameNum === 2 || host.failedHard || guest.failedHard, 10000, 'DB4 guest adopts game 2');
    ok('DB4: both sides moved to game 2', host.mp.gameNum === 2 && guest.mp.gameNum === 2);
    // Measured AT the reset (roundResets), not by reading the live board after the fact - see
    // T5/M4's identical reasoning: by the time the poll above returns, game 2's own first move
    // may already have landed, which would make a live-state check racy.
    const hostReset = host.roundResets.find((r) => r.n === 2);
    const guestReset = guest.roundResets.find((r) => r.n === 2);
    ok('DB4: game 2 alternated the opening network seat - seat 1 (the guest) opens now',
      !!(hostReset && guestReset) && hostReset.dealer === 1 && guestReset.dealer === 1,
      `hostReset.dealer=${hostReset && hostReset.dealer} guestReset.dealer=${guestReset && guestReset.dealer}`);
    ok('DB4 [KNOWN-BUG PROBE]: game 2 starts from a CLEARED move log on both sides\n' +
       '      (REGRESSION GUARD, invariant 3 ported directly: net.js startRound clears `moves`\n' +
       '      atomically with the record, and _mpApplyRoundRecord rebuilds the cache from THAT\n' +
       '      room snapshot and resets appliedSeq to 0; every entry also carries its game number.\n' +
       '      Carry any of that over and game 2 replays game 1\'s edges - the exact way round 2\n' +
       '      replayed round 1\'s shuffle in Chinchon\'s original bug)',
      !!(hostReset && guestReset)
        && hostReset.appliedSeq === 0 && guestReset.appliedSeq === 0
        && hostReset.staleCached === 0 && guestReset.staleCached === 0,
      `game1 log had ${game1Log} entries; at the game-2 reset ` +
      `host=${JSON.stringify(hostReset)} guest=${JSON.stringify(guestReset)}`);
    await until(() => (host.gamesFinished === 2 && guest.gamesFinished === 2) || host.failedHard || guest.failedHard, 15000, 'DB4 game 2 end');
    ok('DB4: game 2\'s log holds only game 2\'s moves, all stamped g=2',
      Object.values(room.moves).every((e) => (e.move.g | 0) === 2),
      `games=${JSON.stringify([...new Set(Object.values(room.moves).map((e) => e.move.g))])}`);
    ok('DB4: game 2 played to completion with zero mismatches', host.mismatches === 0 && guest.mismatches === 0 && host.gamesFinished === 2 && guest.gamesFinished === 2);
    const seriesTotal = (s) => s.wins[0] + s.wins[1] + s.draws;
    ok('DB4: the series tally counts both games on both devices, seat-indexed the same way',
      JSON.stringify(host.mp.series) === JSON.stringify(guest.mp.series) && seriesTotal(host.mp.series) === 2,
      `host=${JSON.stringify(host.mp.series)} guest=${JSON.stringify(guest.mp.series)}`);
  } catch (e) { fail++; console.log(`FAIL  DB4 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); }
}

// --- DB5: INVARIANT 4 ported - rejoin from autosave mid-chain ----------------------
console.log('\n--- DB5: Dots and Boxes rejoin from autosave (KNOWN-BUG PROBE: save seq off-by-one) ---');
{
  // In-band freeze (same reasoning as T6/M5): stop the guest's DELIVERY once it has applied
  // seq 5, mimicking a device backgrounded mid-game with the host one or more moves ahead --
  // deliberately mid-CHAIN on the dbLastLegal script, so this also exercises restoring into the
  // middle of a capture streak, not just an ordinary alternating exchange.
  let guestRef = null;
  const { room, host, guest } = makeDotsBoxes(dbLastLegal(), {
    guest: { frozen: () => guestRef !== null && guestRef.mp !== null && guestRef.mp.appliedSeq >= 5 },
  });
  guestRef = guest;
  let restored = null;
  try {
    await until(() => guest.mp && guest.mp.appliedSeq >= 5 && room.moves['0006'], 15000, 'DB5 guest frozen with a tail waiting');
    await new Promise((r) => setTimeout(r, 50));
    const midSaves = guest.saves.filter((s) => s.midGame);
    const lastSave = midSaves[midSaves.length - 1];
    guest.kill();

    // Mechanism probe, direct. CORRECT: the saved state contains exactly edges 1..seq, so it
    // hashes equal to the log entry AT seq and NOT to the entry at seq+1 (which the restore
    // path is about to replay onto it).
    const atSeq = room.moves[String(lastSave.seq | 0).padStart(4, '0')];
    const atNext = room.moves[String((lastSave.seq | 0) + 1).padStart(4, '0')];
    const savedHash = dHash(lastSave.state);
    ok('DB5 [KNOWN-BUG PROBE]: the autosave\'s seq matches its own snapshot\n' +
       '      (REGRESSION GUARD, invariant 4: dots-boxes/js/ui.js\'s _afterStateChange must run the\n' +
       '      move\'s MP bookkeeping FIRST - _mpAfterLocalMove reserving+appending the seq before\n' +
       '      the funnel, or _mpApplyNextEntry advancing appliedSeq before the paced delay/funnel -\n' +
       '      and only THEN call _mpSaveSnapshot. Saving first stores mp.seq one LOW relative to\n' +
       '      the edge already inside the snapshot, so _tryRestoreMP rebuilds post-edge-N state\n' +
       '      with appliedSeq N-1 and re-applies edge N: a guaranteed desync on every rejoin, the\n' +
       '      exact case the 30-minute restore window exists for. Escoba shipped this bug on its\n' +
       '      play hook)',
      !!atSeq && savedHash === atSeq.h && !(atNext && savedHash === atNext.h),
      `save.seq=${lastSave.seq}; entry@seq ${atSeq ? (savedHash === atSeq.h ? 'matches the snapshot (correct)' : 'does NOT match') : 'absent'}; entry@seq+1 ${atNext ? (savedHash === atNext.h ? 'ALSO matches - the save is one behind' : 'does not match (correct)') : 'absent'}`);

    // End-to-end: a fresh device restores from that save and replays the tail.
    restored = new DotsBoxesSide('guest', room, dbLastLegal(), {});
    await restored.restoreFromSave(lastSave);
    await until(() => restored.gamesFinished > 0 || restored.mismatches > 0 || restored.failedHard, 15000, 'DB5 restored guest finishes');
    ok('DB5: the restored guest replayed the tail cleanly (zero mismatches, no hard failure)',
      restored.mismatches === 0 && !restored.failedHard,
      `restored mismatches=${restored.mismatches} appliedSeq=${restored.mp.appliedSeq} failedHard=${restored.failedHard}`);
    ok('DB5: the restored guest reached the same finished game as the host',
      !!restored.state && dIsOver(restored.state) && dHash(restored.state) === dHash(host.state),
      `restored over=${restored.state && dIsOver(restored.state)} host over=${dIsOver(host.state)}`);
    ok('DB5: the restored guest kept its own network seat (1)',
      restored.localSeat() === 1, `seat=${restored.localSeat()}`);
  } catch (e) { fail++; console.log(`FAIL  DB5 did not complete: ${e.message}`); }
  finally { cleanup(room, host, guest); if (restored) restored.kill(); }
}

// --- DB6: INVARIANT 5 ported by analogy - restoring an already-finished game -------
console.log('\n--- DB6: Dots and Boxes restore at a game boundary (KNOWN-BUG PROBE: restore re-runs a finished game) ---');
{
  const { room, host, guest } = makeDotsBoxes(dbLastLegal());
  let restored = null;
  try {
    await until(() => host.gamesFinished === 1 && guest.gamesFinished === 1, 15000, 'DB6 game end');
    await new Promise((r) => setTimeout(r, 30));
    const boundarySave = deep(guest.saves[guest.saves.length - 1]);
    ok('DB6: the guest\'s final save is a BOUNDARY save (state over, statsCommitted true)',
      !!boundarySave && boundarySave.state.drawnEdges === boundarySave.state.totalEdges && boundarySave.statsCommitted === true,
      JSON.stringify({ drawnEdges: boundarySave.state.drawnEdges, totalEdges: boundarySave.state.totalEdges, statsCommitted: boundarySave.statsCommitted }));
    cleanup(room, host, guest);

    restored = new DotsBoxesSide('guest', new FakeRoom(), dbLastLegal(), {});
    await restored.restoreFromSave(boundarySave);
    ok('DB6 [KNOWN-BUG PROBE, ported by analogy]: restoring an ALREADY-FINISHED game does not\n' +
       '      re-run or re-initialize it\n' +
       '      (REGRESSION GUARD, invariant 5 ported: a boundary restore has a real "next game" it\n' +
       '      could wrongly derive locally instead of awaiting the host\'s record -\n' +
       '      dots-boxes/js/ui.js\'s _tryRestoreMP deliberately does NOT call _mpApplyRoundRecord\n' +
       '      (which calls newGame()) on a save whose game already ended; that would silently\n' +
       '      start a SECOND game nobody asked for and re-arm statsCommitted for a game that was\n' +
       '      already recorded, the same class of bug as Chinchon\'s initMatch wipe, just replacing\n' +
       '      "scores zeroed" with "a phantom rematch begins". The restored side must instead\n' +
       '      recognize isOver(state) and stop, relying on the ordinary onRoomUpdate roundN >\n' +
       '      gameNum branch to pick up the next game once the host actually publishes one)',
      restored.mp.gameNum === boundarySave.gameNum && dIsOver(restored.state)
        && dHash(restored.state) === dHash(boundarySave.state) && restored.statsCommitted === true,
      `gameNum=${restored.mp.gameNum} over=${restored.state && dIsOver(restored.state)} committed=${restored.statsCommitted}`);
    ok('DB6: it did not double-record the finished game it restored',
      restored.statsCommits.length === 0,
      `commits=${JSON.stringify(restored.statsCommits)}`);
    ok('DB6: the series tally is carried through the restore UNTOUCHED, not zeroed\n' +
       '      (the initMatch-wipe failure shape from js/CLAUDE.md\'s invariant 5, translated to\n' +
       '      this game\'s vocabulary: a restore that reset mp.series to {wins:[0,0],draws:0}\n' +
       '      would silently erase the series tally the moment either device backgrounds and\n' +
       '      restores mid-series)',
      JSON.stringify(restored.mp.series) === JSON.stringify(boundarySave.series),
      `restored=${JSON.stringify(restored.mp.series)} saved=${JSON.stringify(boundarySave.series)}`);
  } catch (e) { fail++; console.log(`FAIL  DB6 did not complete: ${e.message}`); }
  finally { if (restored) restored.kill(); }
}

console.log(fail
  ? `\n${fail} FAILURE(S) - a red [KNOWN-BUG PROBE] means a previously-fixed MP defect has REGRESSED; its message names the mechanism and file:line`
  : '\nALL PASS');
process.exit(fail ? 1 : 0);
