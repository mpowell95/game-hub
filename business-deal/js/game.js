/* =============================================================================
 * game.js — Rules engine & turn state machine for "Business Deal"
 * -----------------------------------------------------------------------------
 * Pure game logic. No DOM. Decisions that a player/AI must make (which move to
 * play, whether to play Just Say No, how to pay a debt, what to discard, how to
 * assign a wildcard's color) are delegated to an *agent* object attached to
 * each player. This keeps the engine UI-agnostic:
 *
 *   - ai.js  (Session 2) supplies a strategic agent for the AI player.
 *   - ui.js  (Session 3) supplies a promise/event-driven agent for the human.
 *   - RandomAgent (below) supplies a simple agent used by the headless test.
 *
 * Agent interface (all methods get a read-only `view` of the game):
 *   chooseMove(view, legalMoves) -> move object (or {type:'pass'})
 *   respondToAction(view, ctx)   -> boolean   (play Just Say No?)
 *   choosePayment(view, ctx)     -> [cardId]  (cards to pay a debt with)
 *   chooseDiscards(view, count)  -> [cardId]  (cards to discard to 7)
 *   assignWildColor(view, card, validColors) -> color (placement / received wild)
 *
 * Loaded as <script> after deck.js (exposes window.Game) and as a CommonJS
 * module in Node for the headless self-test (`require('./game.js').test()`).
 * ===========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./deck.js'));
  } else {
    root.Game = factory(root.Deck);
  }
})(typeof self !== 'undefined' ? self : this, function (Deck) {
  'use strict';

  const T = Deck.CARD_TYPES;
  const A = Deck.ACTIONS;
  const REQ = Deck.SET_REQUIREMENTS;

  const HAND_LIMIT = 7;     // discard down to this at end of turn
  const MAX_PLAYS = 3;      // cards playable per turn
  const STARTING_HAND = 5;  // dealt to each player at setup
  const DRAW_NORMAL = 2;    // cards drawn at start of a turn
  const DRAW_EMPTY = 5;     // cards drawn when starting a turn with no hand

  /* ==========================================================================
   * Game
   * ========================================================================*/
  class Game {
    /**
     * @param {Object} opts
     *   players: [{name, agent}, {name, agent}]
     *   rng:     optional () => [0,1) for deterministic shuffles
     *   verbose: log every action to console
     */
    constructor(opts) {
      opts = opts || {};
      this.rng = opts.rng || Math.random;
      this.verbose = !!opts.verbose;
      this.logs = [];
      this.winner = null;
      this.turn = 0;
      this.currentPlayerIndex = 0;
      this.playsRemaining = 0;
      this.phase = 'setup';

      const defs = opts.players || [
        { name: 'You', agent: new RandomAgent() },
        { name: 'AI', agent: new RandomAgent() },
      ];
      this.players = defs.map((d, i) => ({
        id: i,
        name: d.name || ('Player ' + (i + 1)),
        agent: d.agent || new RandomAgent(),
        hand: [],
        bank: [],          // money + banked action/rent cards (face-up)
        properties: {},    // color -> { color, cards:[], house:card|null, hotel:card|null }
      }));

      this.deck = [];      // draw pile (face-down)
      this.discard = [];   // discard pile (face-up)
    }

    /* ---- logging -------------------------------------------------------- */
    log(msg) {
      this.logs.push(msg);
      if (this.verbose) console.log(msg);
    }

    /* ---- setup ---------------------------------------------------------- */
    setup() {
      this.deck = Deck.shuffle(Deck.buildDeck(), this.rng);
      this.discard = [];
      for (const p of this.players) {
        p.hand = [];
        p.bank = [];
        p.properties = {};
      }
      for (let i = 0; i < STARTING_HAND; i++) {
        for (const p of this.players) p.hand.push(this._drawOne());
      }
      this.currentPlayerIndex = 0;
      this.turn = 1;
      this.phase = 'play';
      this.winner = null;
      this.log('Setup complete: dealt ' + STARTING_HAND + ' cards to each player.');
      return this;
    }

    /* ---- player accessors ---------------------------------------------- */
    current() { return this.players[this.currentPlayerIndex]; }
    opponentOf(player) { return this.players[(player.id + 1) % this.players.length]; }
    others(player) { return this.players.filter(p => p.id !== player.id); }
    playerById(id) { return this.players.find(p => p.id === id) || null; }

    /* ---- draw pile management ------------------------------------------ */
    _drawOne() {
      if (this.deck.length === 0) this._reshuffleDiscard();
      return this.deck.length ? this.deck.pop() : null;
    }

    _reshuffleDiscard() {
      if (this.discard.length === 0) return; // nothing to recycle
      this.log('Draw pile empty — reshuffling discard pile (' + this.discard.length + ' cards).');
      this.deck = Deck.shuffle(this.discard, this.rng);
      this.discard = [];
    }

    drawCards(player, n) {
      const drawn = [];
      for (let i = 0; i < n; i++) {
        const c = this._drawOne();
        if (!c) break; // both piles exhausted
        player.hand.push(c);
        drawn.push(c);
      }
      return drawn;
    }

    /* ======================================================================
     * Property collection helpers
     * ====================================================================*/
    group(player, color) { return player.properties[color]; }

    ensureGroup(player, color) {
      if (!player.properties[color]) {
        player.properties[color] = { color, cards: [], house: null, hotel: null };
      }
      return player.properties[color];
    }

    deleteGroupIfEmpty(player, color) {
      const g = player.properties[color];
      if (g && g.cards.length === 0 && !g.house && !g.hotel) delete player.properties[color];
    }

    isSetComplete(player, color) {
      const g = player.properties[color];
      return !!g && g.cards.length >= REQ[color];
    }

    completeColors(player) {
      return Object.keys(player.properties).filter(c => this.isSetComplete(player, c));
    }

    completeSetCount(player) { return this.completeColors(player).length; }

    /** Rent owed for a color set, including building bonuses for full sets. */
    setRent(player, color) {
      const g = player.properties[color];
      if (!g || g.cards.length === 0) return 0;
      const table = Deck.RENT_VALUES[color];
      const n = Math.min(g.cards.length, table.length);
      let rent = table[n - 1];
      if (this.isSetComplete(player, color) && Deck.NO_BUILDING_COLORS.indexOf(color) === -1) {
        if (g.house) rent += Deck.HOUSE_RENT_BONUS;
        if (g.hotel) rent += Deck.HOTEL_RENT_BONUS;
      }
      return rent;
    }

    /** Add a property/wildcard card into a player's collection under `color`. */
    addProperty(player, card, color) {
      if (card.type === T.PROPERTY_WILD) card.assignedColor = color;
      this.ensureGroup(player, color).cards.push(card);
    }

    /** Properties that can be stolen by Sly Deal (must not be in a full set). */
    stealableProps(player) {
      const out = [];
      for (const color of Object.keys(player.properties)) {
        if (this.isSetComplete(player, color)) continue; // can't take from a full set
        for (const card of player.properties[color].cards) {
          out.push({ cardId: card.id, color });
        }
      }
      return out;
    }

    /* ---- locate / remove cards anywhere on a player's table ------------- */
    removeFromHand(player, cardId) {
      const i = player.hand.findIndex(c => c.id === cardId);
      return i === -1 ? null : player.hand.splice(i, 1)[0];
    }

    /** Remove a card from bank or any property group (incl. buildings). */
    removeFromTable(player, cardId) {
      let i = player.bank.findIndex(c => c.id === cardId);
      if (i !== -1) return { card: player.bank.splice(i, 1)[0], from: 'bank' };
      for (const color of Object.keys(player.properties)) {
        const g = player.properties[color];
        i = g.cards.findIndex(c => c.id === cardId);
        if (i !== -1) {
          const card = g.cards.splice(i, 1)[0];
          this.deleteGroupIfEmpty(player, color);
          return { card, from: 'property', color };
        }
        if (g.house && g.house.id === cardId) { const card = g.house; g.house = null; this.deleteGroupIfEmpty(player, color); return { card, from: 'building', color }; }
        if (g.hotel && g.hotel.id === cardId) { const card = g.hotel; g.hotel = null; this.deleteGroupIfEmpty(player, color); return { card, from: 'building', color }; }
      }
      return null;
    }

    /** All cards a player could legally use to pay a debt (value > 0, canPay). */
    payableAssets(player) {
      const assets = [];
      for (const c of player.bank) if (c.canPay) assets.push({ card: c, source: 'bank' });
      for (const color of Object.keys(player.properties)) {
        const g = player.properties[color];
        for (const c of g.cards) if (c.canPay) assets.push({ card: c, source: 'property', color });
        if (g.house) assets.push({ card: g.house, source: 'building', color });
        if (g.hotel) assets.push({ card: g.hotel, source: 'building', color });
      }
      return assets;
    }

    /* ======================================================================
     * Turn loop
     * ====================================================================*/

    /** Play exactly one full turn for the current player. Returns the winner
     *  or null. Async because agent decisions (notably the human's) may be
     *  asynchronous; synchronous agents (AI/Random) simply resolve immediately.
     *  Safe to call repeatedly (awaited) until `this.winner` is set. */
    async playTurn() {
      if (this.winner) return this.winner;
      const player = this.current();

      // A player who reached 3 sets on someone else's turn declares now.
      if (this._checkWin(player)) return this.winner;

      // 1. Draw (5 if you start your turn empty-handed, else 2).
      const n = player.hand.length === 0 ? DRAW_EMPTY : DRAW_NORMAL;
      const drew = this.drawCards(player, n);
      this.log(`-- Turn ${this.turn}: ${player.name} draws ${drew.length} (hand ${player.hand.length}).`);
      if (typeof this.onTurnStart === 'function') await this.onTurnStart(player);
      if (this._checkWin(player)) return this.winner;

      // 2. Play up to 3 cards.
      this.playsRemaining = MAX_PLAYS;
      let guard = 0;
      // The turn ends only when the player PASSES — it does NOT auto-end when the
      // 3 plays are spent (#2: a human must tap Pass). At 0 plays the only legal
      // move is 'pass' (free wildcard reassigns aside), so the AI passes at once
      // and a human gets a "tap Pass" board state.
      while (!this.winner) {
        if (++guard > 120) break; // safety: never spin forever (free reassigns allowed)
        const legal = this.enumerateMoves(player);
        let move;
        try {
          move = await player.agent.chooseMove(this.getView(player.id), legal);
        } catch (e) {
          this.log('Agent error in chooseMove: ' + e.message);
          break;
        }
        if (!move || move.type === 'pass') break;
        const used = await this.executeMove(player, move);
        // Reassigning a placed wildcard is a FREE reorganize — it consumes no
        // play and must not end the turn (real-rules: move wilds any time).
        if (move.type === 'reassign') {
          if (used <= 0) break; // invalid reassign — don't spin
          if (typeof this.onAfterPlay === 'function') await this.onAfterPlay(player, move);
          if (this._checkWin(player)) return this.winner;
          continue;
        }
        if (used <= 0) break; // invalid move — stop to avoid an infinite loop
        this.playsRemaining -= used;
        if (typeof this.onAfterPlay === 'function') await this.onAfterPlay(player, move);
        if (this._checkWin(player)) return this.winner;
      }

      // 3. End turn: discard down to the hand limit.
      await this._discardDown(player);

      // Advance to the next player.
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      if (this.currentPlayerIndex === 0) this.turn++;
      if (typeof this.onTurnEnd === 'function') this.onTurnEnd(player);
      return this.winner;
    }

    async _discardDown(player) {
      const over = player.hand.length - HAND_LIMIT;
      if (over <= 0) return;
      let ids;
      try {
        ids = (await player.agent.chooseDiscards(this.getView(player.id), over)) || [];
      } catch (e) { ids = []; }
      // Validate selection; fall back to discarding the lowest-value cards.
      ids = ids.filter(id => player.hand.some(c => c.id === id)).slice(0, over);
      if (ids.length < over) {
        const remaining = player.hand
          .filter(c => ids.indexOf(c.id) === -1)
          .sort((a, b) => (a.value || 0) - (b.value || 0));
        for (const c of remaining) {
          if (ids.length >= over) break;
          ids.push(c.id);
        }
      }
      for (const id of ids) {
        const card = this.removeFromHand(player, id);
        if (card) this.discard.push(card);
      }
      this.log(`${player.name} discards ${over} card(s) to ${HAND_LIMIT}.`);
    }

    _checkWin(player) {
      if (this.winner) return true;
      if (this.completeSetCount(player) >= 3) {
        this.winner = player;
        this.phase = 'over';
        this.log(`*** ${player.name} WINS with 3 complete sets: ` +
          this.completeColors(player).join(', ') + ' ***');
        return true;
      }
      return false;
    }

    /* ======================================================================
     * Move execution
     * Each handler returns the number of play-slots consumed (0 = invalid).
     * ====================================================================*/
    async executeMove(player, move) {
      switch (move.type) {
        case 'bank':     return this._doBank(player, move);
        case 'property': return this._doPlaceProperty(player, move);
        case 'action':   return await this._doAction(player, move);
        case 'rent':     return await this._doRent(player, move);
        case 'reassign': return this._doReassign(player, move); // free (0 plays)
        default:         return 0;
      }
    }

    _doBank(player, move) {
      const card = player.hand.find(c => c.id === move.cardId);
      // Only money / action / rent cards may be banked (not properties/wilds).
      if (!card || card.type === T.PROPERTY || card.type === T.PROPERTY_WILD) return 0;
      this.removeFromHand(player, card.id);
      player.bank.push(card);
      this.log(`${player.name} banks ${Deck.describe(card)} ($${card.value}M).`);
      return 1;
    }

    _doPlaceProperty(player, move) {
      const card = player.hand.find(c => c.id === move.cardId);
      if (!card || !Deck.isPlaceableProperty(card)) return 0;
      const valid = Deck.placeableColors(card);
      let color = move.color;
      if (valid.indexOf(color) === -1) color = valid[0]; // defensive default
      this.removeFromHand(player, card.id);
      this.addProperty(player, card, color);
      this.log(`${player.name} plays ${Deck.describe(card)} into ${Deck.COLOR_META[color].label}.`);
      return 1;
    }

    /** Reassign an already-placed wildcard to another of its colors (free). */
    _doReassign(player, move) {
      const found = this.removeFromTable(player, move.cardId);
      if (!found || found.card.type !== T.PROPERTY_WILD) {
        if (found) this.addProperty(player, found.card, found.color); // put it back
        return 0;
      }
      const valid = Deck.placeableColors(found.card);
      const color = valid.indexOf(move.color) !== -1 ? move.color : found.color;
      this.addProperty(player, found.card, color);
      this.log(`${player.name} reassigns ${Deck.describe(found.card)} to ${Deck.COLOR_META[color].label}.`);
      // Return 1 to signal SUCCESS to the turn loop (it special-cases 'reassign'
      // and never subtracts a play); 0 means the reassign was invalid.
      return 1;
    }

    async _doAction(player, move) {
      const card = player.hand.find(c => c.id === move.cardId);
      if (!card || card.type !== T.ACTION) return 0;

      switch (card.action) {
        case A.PASS_GO: {
          this.removeFromHand(player, card.id);
          this.discard.push(card);
          const drew = this.drawCards(player, 2);
          this.log(`${player.name} plays Pass Go and draws ${drew.length}.`);
          return 1;
        }
        case A.HOUSE:
        case A.HOTEL:
          return this._doBuilding(player, card, move);
        case A.SLY_DEAL:
        case A.FORCED_DEAL:
        case A.DEAL_BREAKER:
        case A.DEBT_COLLECTOR:
        case A.BIRTHDAY:
          return await this._doTargetedAction(player, card, move);
        default:
          return 0; // JUST_SAY_NO / DOUBLE_RENT are never played on their own
      }
    }

    _doBuilding(player, card, move) {
      const color = move.color;
      if (!this.isSetComplete(player, color)) return 0;
      if (Deck.NO_BUILDING_COLORS.indexOf(color) !== -1) return 0; // not on rail/util
      const g = this.group(player, color);
      if (card.action === A.HOUSE) {
        if (g.house) return 0;
        this.removeFromHand(player, card.id);
        g.house = card;
        this.log(`${player.name} adds a House to ${Deck.COLOR_META[color].label}.`);
      } else { // HOTEL
        if (!g.house || g.hotel) return 0; // hotel needs a house, max one hotel
        this.removeFromHand(player, card.id);
        g.hotel = card;
        this.log(`${player.name} adds a Hotel to ${Deck.COLOR_META[color].label}.`);
      }
      return 1;
    }

    /**
     * Sly Deal / Forced Deal / Deal Breaker / Debt Collector / It's My Birthday.
     * Resolves the Just Say No chain, then applies the effect to each target.
     */
    async _doTargetedAction(player, card, move) {
      // Determine the set of target players up front (validate basic legality).
      let targets;
      if (card.action === A.BIRTHDAY) {
        targets = this.others(player);                 // everyone pays
      } else {
        const chosen = this.playerById(move.targetPlayerId);  // a specific opponent
        targets = chosen && chosen.id !== player.id ? [chosen] : [this.opponentOf(player)];
      }

      // Pre-validate the chosen action has something to act on.
      if (!this._actionHasValidTarget(player, card, move)) return 0;

      this.removeFromHand(player, card.id);
      this.log(`${player.name} plays ${card.name}.`);

      for (const target of targets) {
        const proceeds = await this._resolveJustSayNo(player, target, card);
        if (!proceeds) {
          this.log(`  ${card.name} against ${target.name} was cancelled.`);
          continue;
        }
        await this._applyActionEffect(player, target, card, move);
      }

      this.discard.push(card);
      return 1;
    }

    /** Sanity check that a targeted action can actually be played. */
    _actionHasValidTarget(player, card, move) {
      const target = this.playerById(move.targetPlayerId);
      switch (card.action) {
        case A.SLY_DEAL:
          return !!target && this.stealableProps(target).some(s => s.cardId === move.targetCardId);
        case A.FORCED_DEAL:
          return !!target &&
                 this.stealableProps(target).some(s => s.cardId === move.targetCardId) &&
                 this.stealableProps(player).some(s => s.cardId === move.myCardId);
        case A.DEAL_BREAKER:
          return !!target && this.isSetComplete(target, move.targetColor);
        case A.DEBT_COLLECTOR:
        case A.BIRTHDAY:
          return true; // legal even if target has nothing (they simply pay 0)
        default:
          return false;
      }
    }

    async _applyActionEffect(player, target, card, move) {
      switch (card.action) {
        case A.SLY_DEAL: {
          const found = this.removeFromTable(target, move.targetCardId);
          if (!found) return;
          await this._giveProperty(player, found.card, found.color);
          this.log(`  ${player.name} steals ${Deck.describe(found.card)} from ${target.name}.`);
          break;
        }
        case A.FORCED_DEAL: {
          const mine = this.removeFromTable(player, move.myCardId);
          const theirs = this.removeFromTable(target, move.targetCardId);
          // Name both cards (before they move) so the UI can show what each side
          // gave/got in a Forced Deal swap.
          const givesDesc = mine ? Deck.describe(mine.card) : 'nothing';
          const takesDesc = theirs ? Deck.describe(theirs.card) : 'nothing';
          if (mine) await this._giveProperty(target, mine.card, mine.color);
          if (theirs) await this._giveProperty(player, theirs.card, theirs.color);
          this.log(`  ${player.name} swaps with ${target.name}: takes ${takesDesc}, gives ${givesDesc}.`);
          break;
        }
        case A.DEAL_BREAKER: {
          this._stealCompleteSet(player, target, move.targetColor);
          break;
        }
        case A.DEBT_COLLECTOR:
          await this._charge(target, player, 5, { reason: 'debt', card });
          break;
        case A.BIRTHDAY:
          await this._charge(target, player, 2, { reason: 'birthday', card });
          break;
      }
    }

    _stealCompleteSet(player, target, color) {
      const g = target.properties[color];
      if (!g || !this.isSetComplete(target, color)) return;
      delete target.properties[color];
      const dest = this.ensureGroup(player, color);
      for (const c of g.cards) {
        if (c.type === T.PROPERTY_WILD) c.assignedColor = color;
        dest.cards.push(c);
      }
      // Buildings travel with the set; if the destination slot is taken, the
      // extra building is banked (it can't legally sit without a slot).
      for (const slot of ['house', 'hotel']) {
        if (!g[slot]) continue;
        if (!dest[slot]) dest[slot] = g[slot];
        else player.bank.push(g[slot]);
      }
      this.log(`  ${player.name} DEAL BREAKS ${target.name}'s ${Deck.COLOR_META[color].label} set!`);
    }

    /* ======================================================================
     * Rent
     * ====================================================================*/
    async _doRent(player, move) {
      const card = player.hand.find(c => c.id === move.cardId);
      if (!card || card.type !== T.RENT) return 0;

      // Color must be chargeable by this rent card and owned by the player.
      const color = move.color;
      if (card.colors.indexOf(color) === -1) return 0;
      if (this.setRent(player, color) <= 0) return 0;

      // Optional Double The Rent cards (each consumes a play slot).
      const doubleIds = (move.doubleCardIds || []).filter(id => {
        const c = player.hand.find(x => x.id === id);
        return c && c.action === A.DOUBLE_RENT;
      });
      const playsNeeded = 1 + doubleIds.length;
      if (playsNeeded > this.playsRemaining) return 0;

      // Targets: wild rent hits ONE chosen opponent; color rent hits all.
      let targets;
      if (card.isWild) {
        const t = this.players.find(p => p.id === move.targetPlayerId && p.id !== player.id);
        targets = t ? [t] : [this.opponentOf(player)];
      } else {
        targets = this.others(player);
      }

      // Commit cards (rent + any doubles) to the discard pile.
      this.removeFromHand(player, card.id);
      this.discard.push(card);
      for (const id of doubleIds) {
        const c = this.removeFromHand(player, id);
        if (c) this.discard.push(c);
      }

      const multiplier = Math.pow(2, doubleIds.length);
      const amount = this.setRent(player, color) * multiplier;
      this.log(`${player.name} plays ${card.name} on ${Deck.COLOR_META[color].label}` +
        (doubleIds.length ? ` x${multiplier} (Double the Rent)` : '') +
        ` for ${amount}M.`);

      for (const target of targets) {
        const proceeds = await this._resolveJustSayNo(player, target, card);
        if (!proceeds) { this.log(`  Rent on ${target.name} cancelled.`); continue; }
        await this._charge(target, player, amount, { reason: 'rent', card });
      }
      return playsNeeded;
    }

    /* ======================================================================
     * Just Say No chain
     * Returns true if the action proceeds, false if cancelled.
     * ====================================================================*/
    async _resolveJustSayNo(attacker, defender, actionCard) {
      let proceeds = true;
      let responder = defender;       // defender responds first (to cancel)
      let guard = 0;
      while (guard++ < 10) {
        const jsn = responder.hand.find(c => c.action === A.JUST_SAY_NO);
        if (!jsn) break; // responder cannot react

        let wants;
        try {
          wants = await responder.agent.respondToAction(this.getView(responder.id), {
            actionCard,
            attackerId: attacker.id,
            defenderId: defender.id,
            responderId: responder.id,
            responderRole: responder.id === defender.id ? 'defender' : 'attacker',
            willProceed: proceeds, // current outcome before this responder acts
          });
        } catch (e) { wants = false; }
        if (!wants) break;

        this.removeFromHand(responder, jsn.id);
        this.discard.push(jsn);
        proceeds = !proceeds;
        this.log(`  ${responder.name} plays Just Say No (` +
          (proceeds ? 'action will proceed' : 'action cancelled') + ').');
        // Surface each Just Say No so the player sees the back-and-forth (and
        // understands why their own JSN may or may not have stuck).
        if (typeof this.onJsnPlayed === 'function') {
          await this.onJsnPlayed({ responder, actionCard, proceeds, attackerId: attacker.id, defenderId: defender.id });
        }

        responder = responder.id === defender.id ? attacker : defender; // other side
      }
      return proceeds;
    }

    /* ======================================================================
     * Payment — debtor pays `amount` to creditor (no change given).
     * ====================================================================*/
    async _charge(debtor, creditor, amount, source) {
      if (amount <= 0) return;
      const assets = this.payableAssets(debtor);
      const totalAvailable = assets.reduce((s, a) => s + a.card.value, 0);
      const required = Math.min(amount, totalAvailable);
      if (required <= 0) {
        this.log(`  ${debtor.name} has nothing to pay — pays 0M.`);
        return;
      }

      // Ask the debtor's agent which cards to pay with.
      let ids;
      try {
        ids = (await debtor.agent.choosePayment(this.getView(debtor.id), {
          amount, required, creditorId: creditor.id,
          reason: source && source.reason, sourceCard: source && source.card,
        })) || [];
      } catch (e) { ids = []; }

      // Build the validated payment set, topping up with cheapest assets if the
      // agent under-pays while assets remain (rules require covering `required`).
      const byId = {};
      for (const a of assets) byId[a.card.id] = a;
      const chosen = [];
      let paid = 0;
      const take = (id) => {
        if (!byId[id] || chosen.indexOf(id) !== -1) return;
        chosen.push(id);
        paid += byId[id].card.value;
      };
      for (const id of ids) take(id);
      if (paid < required) {
        const rest = assets
          .filter(a => chosen.indexOf(a.card.id) === -1)
          .sort((x, y) => x.card.value - y.card.value);
        for (const a of rest) {
          if (paid >= required) break;
          take(a.card.id);
        }
      }

      // Transfer the chosen cards from debtor to creditor.
      let transferred = 0;
      for (const id of chosen) {
        const found = this.removeFromTable(debtor, id);
        if (!found) continue;
        transferred += found.card.value;
        await this._receivePayment(creditor, found.card);
      }
      this.log(`  ${debtor.name} pays ${creditor.name} ${transferred}M` +
        (transferred > amount ? ' (no change given)' : '') + '.');
    }

    /** Creditor receives a paid card: money/action/rent -> bank; property -> set. */
    async _receivePayment(creditor, card) {
      if (card.type === T.PROPERTY || card.type === T.PROPERTY_WILD) {
        await this._giveProperty(creditor, card);
      } else {
        creditor.bank.push(card); // buildings paid as cards also land in the bank
      }
    }

    /** Place a property a player has just acquired (steal / swap / payment).
     *  Wildcards let the RECEIVER choose the color (their agent decides — the
     *  human gets a picker), so acquiring a wild never silently auto-assigns. */
    async _giveProperty(recipient, card, fallbackColor) {
      if (card.type !== T.PROPERTY_WILD) {
        this.addProperty(recipient, card, card.color);
        return card.color;
      }
      const valid = Deck.placeableColors(card);
      let color = card.assignedColor || fallbackColor || valid[0];
      try {
        color = await recipient.agent.assignWildColor(this.getView(recipient.id), card, valid);
      } catch (e) { /* keep fallback */ }
      if (valid.indexOf(color) === -1) color = valid[0];
      this.addProperty(recipient, card, color);
      return color;
    }

    /* ======================================================================
     * Move enumeration — produces the set of legal moves for an agent to pick
     * from. Used by RandomAgent (and a useful basis for the Session-2 AI).
     * ====================================================================*/
    enumerateMoves(player) {
      const moves = [{ type: 'pass' }];
      const plays = this.playsRemaining;
      const opponents = this.others(player);

      for (const card of player.hand) {
        // Bank: money / action / rent cards.
        if (card.type === T.MONEY || card.type === T.ACTION || card.type === T.RENT) {
          moves.push({ type: 'bank', cardId: card.id });
        }
        // Place property / wildcard (one move per legal color).
        if (Deck.isPlaceableProperty(card)) {
          for (const color of Deck.placeableColors(card)) {
            moves.push({ type: 'property', cardId: card.id, color });
          }
        }
        // Action cards.
        if (card.type === T.ACTION) {
          switch (card.action) {
            case A.PASS_GO:
              moves.push({ type: 'action', cardId: card.id });
              break;
            case A.BIRTHDAY: // hits everyone — no chosen target
              moves.push({ type: 'action', cardId: card.id });
              break;
            case A.DEBT_COLLECTOR:
              for (const o of opponents) {
                moves.push({ type: 'action', cardId: card.id, targetPlayerId: o.id });
              }
              break;
            case A.SLY_DEAL:
              for (const o of opponents) {
                for (const s of this.stealableProps(o)) {
                  moves.push({ type: 'action', cardId: card.id, targetPlayerId: o.id, targetCardId: s.cardId });
                }
              }
              break;
            case A.FORCED_DEAL:
              for (const o of opponents) {
                for (const theirs of this.stealableProps(o)) {
                  for (const mine of this.stealableProps(player)) {
                    moves.push({
                      type: 'action', cardId: card.id, targetPlayerId: o.id,
                      targetCardId: theirs.cardId, myCardId: mine.cardId,
                    });
                  }
                }
              }
              break;
            case A.DEAL_BREAKER:
              for (const o of opponents) {
                for (const color of this.completeColors(o)) {
                  moves.push({ type: 'action', cardId: card.id, targetPlayerId: o.id, targetColor: color });
                }
              }
              break;
            case A.HOUSE:
              for (const color of this.completeColors(player)) {
                const g = this.group(player, color);
                if (Deck.NO_BUILDING_COLORS.indexOf(color) === -1 && !g.house) {
                  moves.push({ type: 'action', cardId: card.id, color });
                }
              }
              break;
            case A.HOTEL:
              for (const color of this.completeColors(player)) {
                const g = this.group(player, color);
                if (Deck.NO_BUILDING_COLORS.indexOf(color) === -1 && g.house && !g.hotel) {
                  moves.push({ type: 'action', cardId: card.id, color });
                }
              }
              break;
          }
        }
        // Rent cards.
        if (card.type === T.RENT) {
          const ownColors = Object.keys(player.properties)
            .filter(c => this.setRent(player, c) > 0);
          const chargeable = card.colors.filter(c => ownColors.indexOf(c) !== -1);
          const doubles = player.hand.filter(c => c.action === A.DOUBLE_RENT).map(c => c.id);
          const pushRent = (base) => {
            moves.push(base);
            // Variant that also plays one Double The Rent, if affordable.
            if (doubles.length > 0 && plays >= 2) {
              moves.push(Object.assign({}, base, { doubleCardIds: [doubles[0]] }));
            }
          };
          for (const color of chargeable) {
            if (card.isWild) {
              // Wild rent charges ONE chosen opponent — enumerate each.
              for (const o of opponents) {
                pushRent({ type: 'rent', cardId: card.id, color, targetPlayerId: o.id });
              }
            } else {
              // Color rent charges ALL opponents at once.
              pushRent({ type: 'rent', cardId: card.id, color });
            }
          }
        }
      }

      // Filter out anything that needs more play-slots than remain.
      return moves.filter(m => this._playsNeeded(m) <= plays);
    }

    _playsNeeded(move) {
      if (move.type === 'pass' || move.type === 'reassign') return 0;
      if (move.type === 'rent') return 1 + ((move.doubleCardIds || []).length);
      return 1;
    }

    /* ======================================================================
     * Views — a read-only snapshot handed to agents. Hides opponents' hands
     * (only counts), exposes face-up banks and property collections.
     * ====================================================================*/
    getView(playerId) {
      const me = this.players[playerId];
      const summarizeOpp = (p) => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        bank: p.bank.slice(),
        bankValue: p.bank.reduce((s, c) => s + c.value, 0),
        properties: p.properties,
        completeSets: this.completeSetCount(p),
      });
      return {
        playerId,
        turn: this.turn,
        playsRemaining: this.playsRemaining,
        deckCount: this.deck.length,
        discardCount: this.discard.length,
        me: {
          id: me.id,
          name: me.name,
          hand: me.hand.slice(),
          bank: me.bank.slice(),
          bankValue: me.bank.reduce((s, c) => s + c.value, 0),
          properties: me.properties,
          completeSets: this.completeSetCount(me),
        },
        opponents: this.others(me).map(summarizeOpp),
      };
    }

    /* ======================================================================
     * Snapshot for logging / tests.
     * ====================================================================*/
    snapshot() {
      return this.players.map(p => ({
        name: p.name,
        hand: p.hand.length,
        bankValue: p.bank.reduce((s, c) => s + c.value, 0),
        sets: this.completeColors(p),
        properties: Object.keys(p.properties).map(color => {
          const g = p.properties[color];
          return `${Deck.COLOR_META[color].label}:${g.cards.length}/${REQ[color]}` +
            (g.house ? '+H' : '') + (g.hotel ? '+Hotel' : '');
        }),
      }));
    }
  }

  /* ==========================================================================
   * RandomAgent — a simple legal-move-playing agent used by the headless test
   * and as a placeholder until ai.js / ui.js provide real agents.
   * ========================================================================*/
  class RandomAgent {
    constructor(rng) { this.rng = rng || Math.random; }

    chooseMove(view, legalMoves) {
      const active = legalMoves.filter(m => m.type !== 'pass');
      if (active.length === 0) return { type: 'pass' };
      // Mostly act (so games progress), occasionally pass to bank turns out.
      if (this.rng() < 0.12) return { type: 'pass' };
      return active[Math.floor(this.rng() * active.length)];
    }

    respondToAction(view, ctx) {
      // Flip the outcome in our favor ~35% of the time when we hold a JSN.
      return this.rng() < 0.35;
    }

    choosePayment(view, ctx) {
      // Pay with the lowest-value cards first; prefer bank over properties.
      const me = view.me;
      const assets = [];
      for (const c of me.bank) if (c.canPay) assets.push({ id: c.id, value: c.value, pref: 0 });
      for (const color of Object.keys(me.properties)) {
        const g = me.properties[color];
        for (const c of g.cards) if (c.canPay) assets.push({ id: c.id, value: c.value, pref: 1 });
        if (g.house) assets.push({ id: g.house.id, value: g.house.value, pref: 1 });
        if (g.hotel) assets.push({ id: g.hotel.id, value: g.hotel.value, pref: 1 });
      }
      assets.sort((a, b) => a.pref - b.pref || a.value - b.value);
      const chosen = [];
      let sum = 0;
      for (const a of assets) {
        if (sum >= ctx.required) break;
        chosen.push(a.id);
        sum += a.value;
      }
      return chosen;
    }

    chooseDiscards(view, count) {
      return view.me.hand
        .slice()
        .sort((a, b) => (a.value || 0) - (b.value || 0))
        .slice(0, count)
        .map(c => c.id);
    }

    assignWildColor(view, card, validColors) {
      // Place where it best advances a set; otherwise the first legal color.
      let best = validColors[0], bestScore = -1;
      for (const color of validColors) {
        const g = view.me.properties[color];
        const have = g ? g.cards.length : 0;
        const need = REQ[color] - have;
        const score = need > 0 ? have * 10 - need : -5; // favor near-complete sets
        if (score > bestScore) { bestScore = score; best = color; }
      }
      return best;
    }
  }

  /* ==========================================================================
   * Deterministic RNG (mulberry32) so the self-test is reproducible.
   * ========================================================================*/
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ==========================================================================
   * test() — headless sanity check. Deals a game, plays random turns, and
   * logs the resulting state. Throws if the engine reaches an invalid state.
   * Run via: node js/game.js   (or Game.test() in a console)
   * ========================================================================*/
  async function test(opts) {
    opts = opts || {};
    const seed = opts.seed || 12345;
    const maxTurns = opts.maxTurns || 10;
    const rng = mulberry32(seed);

    const game = new Game({
      rng,
      verbose: opts.verbose !== false,
      players: [
        { name: 'Alice', agent: new RandomAgent(rng) },
        { name: 'Bob', agent: new RandomAgent(rng) },
      ],
    });

    console.log('=== Business Deal — headless engine self-test (seed ' + seed + ') ===');
    game.setup();
    assertDeckIntegrity(game, 'after setup');

    let turnsPlayed = 0;
    while (!game.winner && turnsPlayed < maxTurns) {
      await game.playTurn();
      assertDeckIntegrity(game, 'after turn ' + (turnsPlayed + 1));
      turnsPlayed++;
    }

    console.log('\n--- Final state after ' + turnsPlayed + ' turn(s) ---');
    console.log(JSON.stringify(game.snapshot(), null, 2));
    console.log('Winner: ' + (game.winner ? game.winner.name : 'none yet'));
    console.log('Total cards accounted for: ' + countAllCards(game) + ' / 106');
    console.log('=== self-test PASSED (no crashes, deck integrity intact) ===');
    return game;
  }

  // Every card must exist exactly once across all zones (no dupes / leaks).
  function countAllCards(game) {
    const ids = new Set();
    const add = (arr) => arr.forEach(c => ids.add(c.id));
    for (const p of game.players) {
      add(p.hand); add(p.bank);
      for (const color of Object.keys(p.properties)) {
        const g = p.properties[color];
        add(g.cards);
        if (g.house) ids.add(g.house.id);
        if (g.hotel) ids.add(g.hotel.id);
      }
    }
    add(game.deck); add(game.discard);
    return ids.size;
  }

  function assertDeckIntegrity(game, when) {
    const total = countAllCards(game);
    if (total !== 106) {
      console.error(game.logs.slice(-15).join('\n'));
      throw new Error(`Card integrity check failed ${when}: ${total}/106 unique cards.`);
    }
  }

  /* ---- public surface --------------------------------------------------- */
  const api = { Game, RandomAgent, mulberry32, test };

  // When run directly with Node (`node js/game.js`), execute the self-test.
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    test({ verbose: true, maxTurns: 12 }).catch(e => { console.error(e); process.exit(1); });
  }

  return api;
});
