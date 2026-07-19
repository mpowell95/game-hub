// game.js : Escoba engine. Owns all rules and state; no DOM.
//
// The engine runs an async match loop and asks each player's `agent` for a
// move. Agents return promises: the AI resolves instantly, the human agent
// resolves when the UI gets a tap, so one loop drives both. UI work (pacing,
// animation) happens in the awaited `onEvent` hook, never here.
//
// Rules implemented (Fournier "Escoba" rules, 40-card Spanish deck):
//   - Each player is dealt 3 cards; 4 go face up on the table. If those 4 sum
//     to 15 the dealer captures them for one escoba (30: two escobas).
//   - On your turn you play one card. If it sums to 15 with one or more table
//     cards you capture them (mandatory when possible, you pick the combo).
//     Clearing the whole table is an escoba: 1 point.
//   - When hands run out, 3 more are dealt each ("last cards" on the final
//     deal). After the last card, leftover table cards go to the last player
//     who captured.
//   - Round scoring: escobas 1 each; most cards 1 (plus 2 more in a 2-player
//     game when the opponent holds fewer than 10); all coins 2, most coins 1;
//     the guindis (7 of Oros) 1; all four 7s 3 (subsumes the guindis point);
//     most 7s 1. Ties score nothing. First to the target with the sole lead
//     wins; a player who captures nothing all round loses the match outright
//     (2-player only).
//
// Resume support: snapshot()/Game.fromSnapshot() serialize/restore full match
// state (cards are plain JSON-safe objects already). The turn loop is split
// out as runTurnLoop() so a restored mid-round game can re-enter it at the
// saved player index instead of replaying the round from its start.

import { makeDeck, shuffle, sumValues, captureOptions } from './deck.js';

export const DEFAULT_CONFIG = {
  targetScore: 21,       // 21 or 31
  deckMode: 'spanish',   // 'spanish' (figures count 8/9/10) | 'american' (1-10 as printed)
};

export function makePlayer({ id, name, avatar, isHuman = false, agent = null, difficulty = null }) {
  return {
    id, name, avatar, isHuman, agent, difficulty,
    hand: [],
    captured: [],        // cards won this round
    escobas: 0,          // escobas this round
    totalScore: 0,       // match points
    scoreHistory: [0],   // cumulative, one entry per round (for the chart)
    roundScore: 0,       // points scored in the round just ended
    roundItems: [],      // scoring line items of the round just ended
  };
}

export class Game {
  constructor({ players, config = {}, rng = Math.random }) {
    this.players = players;
    this.config = Object.assign({}, DEFAULT_CONFIG, config);
    this.rng = rng;
    this.onEvent = null;      // async (type, payload) hook set by the UI
    this.aborted = false;

    this.round = 0;
    this.dealer = Math.floor(rng() * players.length);
    this.table = [];
    this.stock = [];
    this.lastDeckOrder = null; // ids of the deck order actually used for the current round (shuffled or preset)
    this.lastCapturer = null; // player id of the most recent capture this round
    this.lastCards = false;   // final deal of the round is in play
    this.winner = null;
    this.standings = null;
    this.matchEndReason = null; // 'target' | 'whitewash'

    this._midRound = false;    // true while a round's cards are live (safe to snapshot+resume mid-round)
    this._nextTurn = null;     // player index due to act next (checkpoint for resume)
    this._resumeMidRound = false;
    this._resumeNextTurn = null;
  }

  /**
   * Rebuild a Game from a snapshot() payload. `agentsById` maps each saved
   * player's id to a live agent (the human agent instance, or a fresh
   * AIAgent) since agents aren't serializable.
   */
  static fromSnapshot(snap, agentsById) {
    const g = Object.create(Game.prototype);
    g.config = snap.config;
    g.rng = Math.random;
    g.onEvent = null;
    g.aborted = false;
    g.round = snap.round;
    g.dealer = snap.dealer;
    g.table = snap.table;
    g.stock = snap.stock;
    g.lastCapturer = snap.lastCapturer;
    g.lastCards = snap.lastCards;
    g.lastDeckOrder = null;
    g.winner = null;
    g.standings = null;
    g.matchEndReason = null;
    g._whitewash = null;
    g._midRound = !!snap.midRound;
    g._nextTurn = snap.nextTurn;
    g._resumeMidRound = !!snap.midRound;
    g._resumeNextTurn = snap.nextTurn;
    g.players = snap.players.map((sp) => ({
      id: sp.id, name: sp.name, avatar: sp.avatar, isHuman: sp.isHuman, difficulty: sp.difficulty,
      agent: agentsById[sp.id],
      hand: sp.hand, captured: sp.captured, escobas: sp.escobas,
      totalScore: sp.totalScore, scoreHistory: sp.scoreHistory,
      roundScore: sp.roundScore, roundItems: sp.roundItems,
    }));
    return g;
  }

  /** Plain-JSON snapshot of the full match. Card objects are already plain
   *  data (id/suit/rank/value), so no id-based rehydration is needed. */
  snapshot() {
    return {
      v: 1,
      midRound: this._midRound,
      nextTurn: this._nextTurn,
      config: this.config,
      round: this.round,
      dealer: this.dealer,
      table: this.table,
      stock: this.stock,
      lastCapturer: this.lastCapturer,
      lastCards: this.lastCards,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar, isHuman: p.isHuman, difficulty: p.difficulty,
        hand: p.hand, captured: p.captured, escobas: p.escobas, totalScore: p.totalScore,
        scoreHistory: p.scoreHistory, roundScore: p.roundScore, roundItems: p.roundItems,
      })),
    };
  }

  byId(id) { return this.players.find((p) => p.id === id); }

  abort() { this.aborted = true; }

  async emit(type, payload) {
    if (this.aborted) return;
    if (this.onEvent) await this.onEvent(type, payload);
  }

  // --- match loop -------------------------------------------------------------

  async playMatch() {
    await this.emit('matchStart', {});
    if (this._resumeMidRound) {
      this._resumeMidRound = false;
      await this.resumeRound();
      if (this.aborted) return;
      await this.finishRoundAfterPlay();
    }
    while (!this.aborted && !this.winner) {
      this.round += 1;
      await this.playRound();
      if (this.aborted) return;
      await this.finishRoundAfterPlay();
    }
    if (this.aborted) return;
    await this.emit('matchEnd', { winner: this.winner });
  }

  /** Score the just-finished round, resolve match end, advance the dealer for
   *  the next round (only if the match continues), then emit 'roundScored'.
   *  Ordering matters for resume: by the time the UI can snapshot here, the
   *  dealer/round/winner all already reflect the state a fresh restore should
   *  continue from. */
  async finishRoundAfterPlay() {
    if (this.aborted) return;
    this.scoreRound();
    this._midRound = false;
    this.checkMatchEnd();
    if (!this.winner) this.dealer = (this.dealer + 1) % this.players.length;
    await this.emit('roundScored', { round: this.round });
  }

  // --- one round (one full deck) ----------------------------------------------

  async playRound() {
    const n = this.players.length;
    this._midRound = true;
    for (const p of this.players) { p.hand = []; p.captured = []; p.escobas = 0; }
    this.table = [];
    // Multiplayer lockstep: a host-supplied exact deck order (card ids), used
    // in place of a local shuffle so both sides deal an identical round. Absent
    // (the default) -> byte-identical to the original shuffle-only behavior.
    if (this.config.presetDeck && this.config.presetDeck.length) {
      const byId = new Map(makeDeck(this.config.deckMode).map((c) => [c.id, c]));
      this.stock = this.config.presetDeck.map((id) => byId.get(id)).filter(Boolean);
    } else {
      this.stock = shuffle(makeDeck(this.config.deckMode), this.rng);
    }
    this.lastDeckOrder = this.stock.map((c) => c.id);
    this.lastCapturer = null;
    this.lastCards = false;

    await this.emit('roundStart', { round: this.round, dealer: this.dealer });

    // First deal: 3 to each player, then 4 face up on the table. The turn
    // loop starts left of the dealer, so a snapshot taken here is already
    // stamped with the correct resume point (the initial-escoba check right
    // below hasn't run an await yet, so it can't be interrupted mid-way).
    this.dealHands();
    this.table = this.stock.splice(0, 4);
    this._nextTurn = (this.dealer + 1) % n;
    await this.emit('deal', { first: true });

    // Dealer's luck: table summing to 15 (or 30) goes straight to the dealer.
    const t = sumValues(this.table);
    if (t === 15 || t === 30) {
      const d = this.byId(this.dealer);
      const cards = this.table;
      const count = t === 30 ? 2 : 1;
      d.captured.push(...cards);
      d.escobas += count;
      this.table = [];
      this.lastCapturer = d.id;
      await this.emit('initialEscoba', { playerId: d.id, cards, count });
    }

    await this.runTurnLoop((this.dealer + 1) % n);
  }

  /** Play turns starting at player index `startTurn` until every card is
   *  played, then sweep any leftover table cards. Shared by a fresh round and
   *  by resumeRound() (which re-enters mid-round from a saved checkpoint). */
  async runTurnLoop(startTurn) {
    const n = this.players.length;
    let turn = startTurn;
    while (!this.aborted) {
      if (this.players.every((p) => p.hand.length === 0)) {
        if (this.stock.length === 0) break;
        this.dealHands();
        this.lastCards = this.stock.length === 0;
        this._nextTurn = turn;   // dealing doesn't consume a turn; `turn` still acts next
        await this.emit('deal', { first: false, lastCards: this.lastCards });
      }
      const p = this.players[turn];
      if (p.hand.length > 0) {
        // Set the resume checkpoint to the FOLLOWING player before this turn
        // plays out: by the time 'play' fires (mid playTurn), this player's
        // move is fully committed, so a snapshot taken then should resume
        // with whoever is next.
        this._nextTurn = (turn + 1) % n;
        await this.playTurn(p);
        if (this.aborted) return;
      }
      turn = (turn + 1) % n;
    }
    if (this.aborted) return;

    // Leftover table cards go to whoever captured last (never an escoba).
    if (this.table.length && this.lastCapturer != null) {
      const p = this.byId(this.lastCapturer);
      const cards = this.table;
      p.captured.push(...cards);
      this.table = [];
      await this.emit('sweepLeftovers', { playerId: p.id, cards });
    }
  }

  /** Resume a mid-round match: replay only the remaining turn loop, using the
   *  restored table/stock/hands and the saved next-turn checkpoint. */
  async resumeRound() {
    const start = this._resumeNextTurn != null ? this._resumeNextTurn : (this.dealer + 1) % this.players.length;
    await this.runTurnLoop(start);
  }

  dealHands() {
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[(this.dealer + 1 + i) % this.players.length];
        const c = this.stock.shift();
        if (c) p.hand.push(c);
      }
    }
  }

  /** Public view of the game for an agent (their own hand + all open info). */
  viewFor(p) {
    return {
      hand: p.hand.slice(),
      table: this.table.slice(),
      stockCount: this.stock.length,
      lastCards: this.lastCards,
      me: { id: p.id, captured: p.captured.slice(), escobas: p.escobas, totalScore: p.totalScore },
      others: this.players.filter((x) => x.id !== p.id).map((x) => ({
        id: x.id, handCount: x.hand.length, captured: x.captured.slice(),
        escobas: x.escobas, totalScore: x.totalScore,
      })),
      targetScore: this.config.targetScore,
      deckMode: this.config.deckMode,
    };
  }

  async playTurn(p) {
    await this.emit('turnStart', { playerId: p.id });
    if (this.aborted) return;

    const move = await p.agent.chooseMove(this.viewFor(p));
    if (this.aborted) return;

    // Validate: the card must be in hand; a capture must sum to 15 with table
    // cards; laying a card is only legal when it cannot capture (mandatory
    // capture). An invalid move falls back to a safe legal one.
    const legal = this.legalize(p, move);
    const card = p.hand.find((c) => c.id === legal.cardId);
    p.hand = p.hand.filter((c) => c.id !== card.id);

    if (legal.captureIds.length) {
      const taken = this.table.filter((c) => legal.captureIds.includes(c.id));
      this.table = this.table.filter((c) => !legal.captureIds.includes(c.id));
      p.captured.push(card, ...taken);
      this.lastCapturer = p.id;
      const escoba = this.table.length === 0;
      if (escoba) p.escobas += 1;
      await this.emit('play', { playerId: p.id, card, captured: taken, escoba });
    } else {
      this.table.push(card);
      await this.emit('play', { playerId: p.id, card, captured: [], escoba: false });
    }
  }

  /** Coerce an agent move into a legal one (never trusts the agent blindly). */
  legalize(p, move) {
    const card = (move && p.hand.find((c) => c.id === move.cardId)) || null;
    const pick = (c) => {
      const opts = captureOptions(this.table, c);
      return { cardId: c.id, captureIds: opts.length ? opts[0].map((x) => x.id) : [] };
    };
    if (!card) return pick(p.hand[0]);
    const opts = captureOptions(this.table, card);
    if (!opts.length) return { cardId: card.id, captureIds: [] };
    const ids = Array.isArray(move.captureIds) ? move.captureIds : [];
    const key = ids.slice().sort().join(',');
    const match = opts.find((o) => o.map((x) => x.id).sort().join(',') === key);
    return { cardId: card.id, captureIds: (match || opts[0]).map((x) => x.id) };
  }

  // --- scoring ------------------------------------------------------------------

  /** Score the finished round into totals, recording per-player line items. */
  scoreRound() {
    const ps = this.players;
    const twoPlayer = ps.length === 2;
    const stat = ps.map((p) => ({
      p,
      cards: p.captured.length,
      coins: p.captured.filter((c) => c.suit === 'oros').length,
      sevens: p.captured.filter((c) => c.rank === 7).length,
      guindis: p.captured.some((c) => c.suit === 'oros' && c.rank === 7),
    }));
    const soleMax = (key) => {
      let best = -1, who = null;
      for (const s of stat) {
        if (s[key] > best) { best = s[key]; who = s; }
        else if (s[key] === best) who = null;
      }
      return best > 0 ? who : null;
    };
    const mostCards = soleMax('cards');
    const mostCoins = soleMax('coins');
    const mostSevens = soleMax('sevens');

    for (const s of stat) {
      const items = [];
      const add = (key, label, points) => { if (points) items.push({ key, label, points }); };
      add('escobas', s.p.escobas === 1 ? 'Escoba' : `Escobas (${s.p.escobas})`, s.p.escobas);
      if (s === mostCards) {
        add('cards', `Most cards (${s.cards})`, 1);
        if (twoPlayer) {
          const opp = stat.find((x) => x !== s);
          if (opp && opp.cards < 10) add('cardsBonus', 'Opponent under 10 cards', 2);
        }
      }
      if (s.coins === 10) add('allCoins', 'All the coins', 2);
      if (s === mostCoins) add('coins', `Most coins (${s.coins})`, 1);
      if (s.sevens === 4) add('allSevens', 'All four 7s', 3);
      else if (s.guindis) add('guindis', 'The guindis (7 of Oros)', 1);
      if (s === mostSevens) add('sevens', `Most 7s (${s.sevens})`, 1);

      s.p.roundItems = items;
      s.p.roundScore = items.reduce((sum, it) => sum + it.points, 0);
      s.p.totalScore += s.p.roundScore;
      s.p.scoreHistory.push(s.p.totalScore);
    }

    // A player who captured nothing all round loses the match outright (2p).
    this._whitewash = twoPlayer ? stat.find((s) => s.cards === 0) : null;
  }

  checkMatchEnd() {
    const ps = this.players;
    if (this._whitewash) {
      this.winner = ps.find((p) => p !== this._whitewash.p);
      this.matchEndReason = 'whitewash';
    } else {
      const sorted = ps.slice().sort((a, b) => b.totalScore - a.totalScore);
      if (sorted[0].totalScore >= this.config.targetScore && sorted[0].totalScore > sorted[1].totalScore) {
        this.winner = sorted[0];
        this.matchEndReason = 'target';
      }
    }
    if (this.winner) {
      this.standings = ps.slice().sort((a, b) => b.totalScore - a.totalScore);
    }
  }
}

export default { Game, DEFAULT_CONFIG, makePlayer };
