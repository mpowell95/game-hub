// game.js — Chinchón turn/round/match state machine. No DOM.
//
// The engine is agent-driven and async: it `await`s decisions from each player's
// `agent` and is agnostic to human vs AI. The AI agent resolves instantly; the
// human agent (in ui.js) resolves a promise when the player taps. The engine
// also `await`s an optional `onEvent(type, payload)` hook so the UI can render
// and pace the table (e.g. an AI "thinking" beat, or blocking on the end-of-round
// modal until the player clicks "Next round").
//
// Pacing and pure rules are kept out of here: timing lives in the UI's onEvent;
// all rules questions delegate to meld.js. That keeps this module portable (it
// could be driven from a worker or a headless simulation unchanged).

import { makeDeck, shuffle } from './deck.js';
import * as meld from './meld.js';

/** Full default rules config. The settings panel (Pass 2) produces this shape;
 *  Pass 1 uses it as-is with a couple of overrides. */
export const DEFAULT_CONFIG = {
  victoryCondition: 'points',   // 'points' | 'rounds' | 'roundsOrPoints'
  roundsLimit: 10,
  scoreLimit: 100,
  showRemaining: false,
  extended: false,              // 48-card deck (adds 8s, 9s)
  joker: false,
  aceOrosWild: false,
  winWithChinchon: true,        // true: chinchón wins the match; false: scores chinchonNegative
  chinchonNegative: -25,
  maxResets: 2,
  placeOnEnding: 'auto',        // 'auto' | 'manual' | 'off'
  maxClose: 3,                  // inclusive leftover threshold to close (3 | 4 | 5)
  figuresFaceValue: false,      // false: figures flat 10; true: own value (10/11/12)
};

export function makePlayer({ id, name, avatar, isHuman, difficulty, agent }) {
  return {
    id, name, avatar, agent,
    isHuman: !!isHuman,
    difficulty: difficulty || null,
    hand: [],
    hasDrawn: false,
    hasHadTurn: false,
    roundScore: 0,
    totalScore: 0,
    scoreHistory: [0],
    placed: null,       // cards laid off onto the closer's melds this round
    closeInfo: null,    // classifyClosingHand result, on the closer
  };
}

/** Thrown to unwind the match loop cleanly when the UI tears the game down. */
class AbortError extends Error {}

export class Game {
  constructor({ players, config, rng } = {}) {
    this.players = players;
    this.config = Object.assign({}, DEFAULT_CONFIG, config);
    this.rng = rng || Math.random;

    this.stock = [];
    this.discard = [];
    this.currentPlayerIndex = 0;
    this.dealerIndex = 0;
    this.round = 1;
    this.phase = 'idle';      // idle | draw | discard | close | scoring | roundEnd | matchEnd
    this.resetsUsed = 0;
    this.whoClosed = null;    // player id, or null
    this.closeType = null;    // 'normal' | 'chinchon' | 'doubleMeld' | 'exhaustion'
    this.lockedMelds = null;  // closer's melds, frozen for place-cards
    this.winner = null;
    this.matchEndReason = null;
    this.standings = null;
    this.aborted = false;
    this.onEvent = null;      // async (type, payload) => void, set by the UI

    this.lastDeckOrder = null; // ids of the deck order actually used for the round (shuffled or preset)
    this._midRound = false;    // true while a round's cards are live (safe to snapshot+resume mid-round)
    this._nextTurn = null;     // player index due to act next (checkpoint for resume)
    this._resumeMidRound = false;
    this._resumeNextTurn = null;
  }

  /**
   * Rebuild a Game from a snapshot() payload. `agentsById` maps each saved
   * player's id to a live agent (the human agent instance, or a fresh
   * AIAgent) since agents aren't serializable. Mirrors escoba/js/game.js's
   * Game.fromSnapshot 1:1 (same v:1 shape, same _midRound/_nextTurn resume
   * convention); see snapshot() below for the field-by-field rationale.
   */
  static fromSnapshot(snap, agentsById) {
    const g = Object.create(Game.prototype);
    g.config = snap.config;
    g.rng = Math.random;
    g.onEvent = null;
    g.aborted = false;
    g.stock = snap.stock;
    g.discard = snap.discard;
    g.currentPlayerIndex = snap.currentPlayerIndex;
    g.dealerIndex = snap.dealerIndex;
    g.round = snap.round;
    g.phase = snap.phase;
    g.resetsUsed = snap.resetsUsed;
    g.whoClosed = snap.whoClosed;
    g.closeType = snap.closeType;
    g.lockedMelds = snap.lockedMelds;
    g.winner = null;
    g.matchEndReason = null;
    g.standings = null;
    g.lastDeckOrder = null;
    g._midRound = !!snap.midRound;
    g._nextTurn = snap.nextTurn;
    g._resumeMidRound = !!snap.midRound;
    g._resumeNextTurn = snap.nextTurn;
    g.players = snap.players.map((sp) => ({
      id: sp.id, name: sp.name, avatar: sp.avatar, isHuman: sp.isHuman, difficulty: sp.difficulty,
      agent: agentsById[sp.id],
      hand: sp.hand, hasDrawn: sp.hasDrawn, hasHadTurn: sp.hasHadTurn,
      roundScore: sp.roundScore, totalScore: sp.totalScore, scoreHistory: sp.scoreHistory,
      placed: sp.placed, closeInfo: sp.closeInfo,
    }));
    return g;
  }

  /**
   * Plain-JSON snapshot of the full match. Card objects are already plain
   * data (id/suit/rank/value/isJoker/isWild), so no id-based rehydration is
   * needed, same as Escoba.
   *
   * Snapshot point: ONLY valid between completed turns (after playTurn()'s
   * promise has resolved and before the next one starts), never mid-turn
   * (i.e. never between a player's draw and their discard). Chinchón's
   * per-turn phase machine (draw -> discard -> close) has no defined resume
   * behavior partway through -- fromSnapshot()/resumeRound() re-enter at the
   * START of whichever turn _nextTurn checkpoints, so a snapshot taken
   * mid-turn would silently replay that half-finished turn from scratch
   * (wrong hand/stock/discard state) rather than continuing it. This mirrors
   * Escoba's identical constraint (see escoba/js/game.js's "UI intentionally
   * never snapshots the very first deal of a round").
   */
  snapshot() {
    return {
      v: 1,
      midRound: this._midRound,
      nextTurn: this._nextTurn,
      config: this.config,
      stock: this.stock,
      discard: this.discard,
      currentPlayerIndex: this.currentPlayerIndex,
      dealerIndex: this.dealerIndex,
      round: this.round,
      phase: this.phase,
      resetsUsed: this.resetsUsed,
      whoClosed: this.whoClosed,
      closeType: this.closeType,
      lockedMelds: this.lockedMelds,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar, isHuman: p.isHuman, difficulty: p.difficulty,
        hand: p.hand, hasDrawn: p.hasDrawn, hasHadTurn: p.hasHadTurn,
        roundScore: p.roundScore, totalScore: p.totalScore, scoreHistory: p.scoreHistory,
        placed: p.placed, closeInfo: p.closeInfo,
      })),
    };
  }

  // --- queries --------------------------------------------------------------

  current() { return this.players[this.currentPlayerIndex]; }
  byId(id) { return this.players.find((p) => p.id === id); }
  advance() { this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length; }
  everyoneHadTurn() { return this.players.every((p) => p.hasHadTurn); }
  discardTop() { return this.discard.length ? this.discard[this.discard.length - 1] : null; }

  /** Is the current player allowed to close right now? (UI may use this for hints.) */
  canCurrentClose() {
    const p = this.current();
    return p.hasDrawn && this.everyoneHadTurn() && meld.canClose(p.hand, this.config);
  }

  /** Read-only snapshot handed to an agent. Never leaks opponents' hands. */
  getView(playerId) {
    const me = this.byId(playerId);
    return {
      config: this.config,
      myId: playerId,
      hand: me.hand.slice(),
      discardTop: this.discardTop(),
      discardPile: this.discard.slice(),   // public information
      stockCount: this.config.showRemaining ? this.stock.length : null,
      resetsUsed: this.resetsUsed,
      maxResets: this.config.maxResets,
      round: this.round,
      whoClosed: this.whoClosed,
      everyoneHadTurn: this.everyoneHadTurn(),
      opponents: this.players
        .filter((p) => p.id !== playerId)
        .map((p) => ({ id: p.id, name: p.name, handCount: p.hand.length, totalScore: p.totalScore })),
    };
  }

  // --- lifecycle ------------------------------------------------------------

  abort() { this.aborted = true; }
  _throwIfAborted() { if (this.aborted) throw new AbortError(); }
  async emit(type, payload) { if (this.onEvent) await this.onEvent(type, payload || {}); }

  initMatch() {
    for (const p of this.players) {
      p.totalScore = 0;
      p.scoreHistory = [0];
      p.roundScore = 0;
    }
    this.round = 1;
    this.dealerIndex = 0;
    this.winner = null;
    this.matchEndReason = null;
    this.standings = null;
  }

  startRound() {
    this._midRound = true;
    // Multiplayer lockstep: a host-supplied exact deck order (card ids), used
    // in place of a local shuffle so both sides deal an identical round.
    // Absent (the default) -> byte-identical to the original shuffle-only
    // behavior. Same pattern as Escoba's F1 (escoba/js/game.js).
    let deck;
    if (this.config.presetDeck && this.config.presetDeck.length) {
      const byId = new Map(makeDeck(this.config).map((c) => [c.id, c]));
      deck = this.config.presetDeck.map((id) => byId.get(id)).filter(Boolean);
    } else {
      deck = shuffle(makeDeck(this.config), this.rng);
    }
    this.lastDeckOrder = deck.map((c) => c.id);
    for (const p of this.players) p.hand = [];
    let k = 0;
    for (let r = 0; r < 7; r++) for (const p of this.players) p.hand.push(deck[k++]);
    this.discard = [deck[k++]];
    this.stock = deck.slice(k);

    this.whoClosed = null;
    this.closeType = null;
    this.lockedMelds = null;
    this.resetsUsed = 0;
    for (const p of this.players) { p.hasHadTurn = false; p.roundScore = 0; p.placed = null; p.closeInfo = null; }
    this.currentPlayerIndex = (this.dealerIndex + 1) % this.players.length;
  }

  /** Reshuffle the discard (minus its top) back into the stock. False if no reset left. */
  tryResetStock() {
    if (this.resetsUsed >= this.config.maxResets) return false;
    if (this.discard.length <= 1) return false;
    const top = this.discard.pop();
    this.stock = shuffle(this.discard, this.rng);
    this.discard = [top];
    this.resetsUsed++;
    return true;
  }

  drawFrom(source, player) {
    let card;
    if (source === 'discard' && this.discard.length) {
      card = this.discard.pop();
      source = 'discard';
    } else {
      card = this.stock.pop();
      source = 'stock';
    }
    player.hand.push(card);
    return { source, card };
  }

  discardCard(player, cardId) {
    let i = player.hand.findIndex((c) => c.id === cardId);
    if (i === -1) i = this._fallbackDiscardIndex(player.hand); // tolerate a bad/aborted choice
    const [card] = player.hand.splice(i, 1);
    this.discard.push(card);
    return card;
  }

  /** Index of the card whose removal leaves the least deadwood (tie: highest value). */
  _fallbackDiscardIndex(hand) {
    let bestI = 0, bestDw = Infinity, bestVal = -1;
    for (let i = 0; i < hand.length; i++) {
      const rest = hand.slice(0, i).concat(hand.slice(i + 1));
      const dw = meld.bestDeadwood(rest, this.config);
      if (dw < bestDw || (dw === bestDw && hand[i].value > bestVal)) { bestDw = dw; bestVal = hand[i].value; bestI = i; }
    }
    return bestI;
  }

  // --- the loop -------------------------------------------------------------

  async playMatch() {
    try {
      if (this._resumeMidRound) {
        this._resumeMidRound = false;
        await this.resumeRound();
        this._throwIfAborted();
        if (await this.finishRoundAfterPlay()) return;
      } else {
        this.initMatch();
      }
      while (true) {
        this.startRound();
        await this.emit('roundStart', { round: this.round });
        this._throwIfAborted();
        await this.runRound();
        if (await this.finishRoundAfterPlay()) break;
      }
    } catch (e) {
      if (!(e instanceof AbortError)) throw e;
    }
  }

  /** Score the just-finished round, resolve match end, advance the round/
   *  dealer for the next round (only if the match continues). Returns true
   *  once the match has concluded (emits 'matchEnd' itself), else false.
   *  Extracted from playMatch()'s loop body so the resume path (a snapshot
   *  restored mid-round) can share the exact same post-round sequence
   *  instead of duplicating it. */
  async finishRoundAfterPlay() {
    this._midRound = false;
    await this.resolveRoundScoring();
    this.applyRoundScores();
    this.phase = 'roundEnd';
    await this.emit('roundScored', { round: this.round });
    this._throwIfAborted();
    if (this.checkMatchEnd()) {
      this.phase = 'matchEnd';
      this.finalizeStandings();
      await this.emit('matchEnd', {});
      return true;
    }
    this.round++;
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    return false;
  }

  async runRound() {
    while (true) {
      // Checkpoint the FOLLOWING player before this turn plays out: by the
      // time playTurn()'s promise resolves, this player's turn is fully
      // committed, so a snapshot taken then should resume with whoever is
      // next. Same convention as Escoba's runTurnLoop/_nextTurn.
      this._nextTurn = (this.currentPlayerIndex + 1) % this.players.length;
      const p = this.current();
      const roundEnded = await this.playTurn(p);
      if (roundEnded) break;
      this.advance();
    }
  }

  /** Resume a mid-round match: jump to the saved checkpoint and replay only
   *  the remaining turn loop, using the restored hands/stock/discard. */
  async resumeRound() {
    if (this._resumeNextTurn != null) this.currentPlayerIndex = this._resumeNextTurn;
    await this.runRound();
  }

  async playTurn(player) {
    this._throwIfAborted();
    this.phase = 'draw';
    player.hasDrawn = false;
    await this.emit('turnStart', { playerId: player.id });
    this._throwIfAborted();

    // Ensure the stock has a card to offer; reset or end the round if not.
    if (this.stock.length === 0 && !this.tryResetStock()) {
      this.whoClosed = null;
      this.closeType = 'exhaustion';
      return true;
    }

    // 1) DRAW — stock or discard.
    const src = await player.agent.chooseDraw(this.getView(player.id));
    this._throwIfAborted();
    const drawn = this.drawFrom(src === 'discard' ? 'discard' : 'stock', player);
    player.hasDrawn = true;
    await this.emit('draw', { playerId: player.id, source: drawn.source, card: drawn.card });
    this._throwIfAborted();

    // 2) DISCARD — mandatory.
    this.phase = 'discard';
    const discardId = await player.agent.chooseDiscard(this.getView(player.id));
    this._throwIfAborted();
    const discarded = this.discardCard(player, discardId);
    await this.emit('discard', { playerId: player.id, card: discarded });
    this._throwIfAborted();

    // 3) CLOSE — only if eligible and everyone has had a turn.
    player.hasHadTurn = true;
    this.phase = 'close';
    if (this.everyoneHadTurn() && meld.canClose(player.hand, this.config)) {
      const wantsClose = await player.agent.decideClose(this.getView(player.id));
      this._throwIfAborted();
      if (wantsClose) {
        this.whoClosed = player.id;
        await this.emit('close', { playerId: player.id });
        return true;
      }
    }
    return false;
  }

  // --- scoring --------------------------------------------------------------

  async resolveRoundScoring() {
    this.phase = 'scoring';
    if (this.whoClosed != null) {
      const closer = this.byId(this.whoClosed);
      const res = meld.classifyClosingHand(closer.hand, this.config);
      closer.roundScore = res.score;
      closer.closeInfo = res;
      this.closeType = res.category === 'chinchon' ? 'chinchon'
        : res.category === 'doubleMeld' ? 'doubleMeld' : 'normal';
      // Place-cards is only available on a normal close.
      this.lockedMelds = this.closeType === 'normal' ? (res.lockedMelds || res.partition) : null;
      if (res.category === 'chinchon' && res.endsMatch) {
        this.winner = closer;
        this.matchEndReason = 'chinchon';
      }
    } else {
      this.closeType = 'exhaustion';
      this.lockedMelds = null;
    }

    for (const p of this.players) {
      if (this.whoClosed != null && p.id === this.whoClosed) continue;
      let hand = p.hand;
      p.placed = null;
      if (this.lockedMelds && this.config.placeOnEnding !== 'off') {
        const cand = meld.attachableCards(p.hand, this.lockedMelds, this.config);
        if (cand.attached.length) {
          let toPlace = cand.attached;
          if (this.config.placeOnEnding === 'manual') {
            const chosen = await p.agent.choosePlacements(this.getView(p.id), this.lockedMelds, cand.attached);
            this._throwIfAborted();
            const keep = new Set(Array.isArray(chosen) ? chosen : []);
            toPlace = cand.attached.filter((c) => keep.has(c.id));
          }
          if (toPlace.length) {
            const placedIds = new Set(toPlace.map((c) => c.id));
            hand = p.hand.filter((c) => !placedIds.has(c.id));
            p.placed = toPlace;
          }
        }
      }
      p.roundScore = meld.scoreHand(hand, this.config);
    }
  }

  applyRoundScores() {
    for (const p of this.players) {
      p.totalScore += p.roundScore;
      p.scoreHistory.push(p.totalScore);
    }
  }

  checkMatchEnd() {
    if (this.winner) return true;
    const overLimit = this.players.some((p) => p.totalScore > this.config.scoreLimit);
    const roundsDone = this.round >= this.config.roundsLimit;
    switch (this.config.victoryCondition) {
      case 'rounds': return roundsDone;
      case 'roundsOrPoints': return overLimit || roundsDone;
      case 'points':
      default: return overLimit;
    }
  }

  finalizeStandings() {
    const ranked = this.players.slice().sort((a, b) => a.totalScore - b.totalScore);
    if (!this.winner) this.winner = ranked[0];
    // Ensure the chinchón winner (if any) leads the standings.
    ranked.sort((a, b) => (a === this.winner ? -1 : b === this.winner ? 1 : a.totalScore - b.totalScore));
    this.standings = ranked;
  }
}
