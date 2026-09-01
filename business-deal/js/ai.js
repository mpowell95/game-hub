/* =============================================================================
 * ai.js — Strategic AI agent for Monopoly Deal
 * -----------------------------------------------------------------------------
 * Implements the agent interface defined in game.js. The engine calls
 * chooseMove() once per play-slot (up to 3 per turn), so a strong move in one
 * slot is naturally followed by re-evaluation for the next — this is how the AI
 * "combines the best available plays across 3 slots" (per CLAUDE.md).
 *
 * The decision logic is a *scored evaluation*, not a rigid switch: every legal
 * move is assigned a score and the highest wins. Scores are organized into
 * priority TIERS (large gaps between tiers) so category order is guaranteed,
 * while fine-grained value within a tier breaks ties sensibly (e.g., complete
 * the higher-rent set first). Difficulty is applied on top of this scoring,
 * in the AIAgent constructor - see the measured knob table there.
 *
 * Priority order (CLAUDE.md "Turn Evaluation Priority"):
 *   1  win                         -> handled by the engine (auto-declared)
 *   2  Deal Breaker to win         -> WIN tier
 *   3  complete a set              -> COMPLETE_SET
 *   4  Sly/Forced Deal to complete -> COMPLETE_VIA_STEAL
 *   5  Deal Breaker for advantage  -> DEAL_BREAKER_ADV
 *   6  rent + Double the Rent 6M+  -> RENT_COMBO
 *   7  Debt Collector / Birthday   -> DEBT_BIRTHDAY
 *   8  standard rent (>2M)         -> STANDARD_RENT
 *   9  Pass Go (hand getting low)  -> PASS_GO
 *   10 property placement          -> ADVANCE
 *   11 House / Hotel               -> BUILDING (scored ABOVE rent on purpose,
 *                                     so buildings are added before charging
 *                                     rent — see CLAUDE.md's explicit note)
 *   12 bank filler                 -> BANK
 *
 * Loaded as <script> after deck.js + game.js (exposes window.AI) and as a
 * CommonJS module in Node for self-testing.
 * ===========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./deck.js'), require('./game.js'));
  } else {
    root.AI = factory(root.Deck, root.Game);
  }
})(typeof self !== 'undefined' ? self : this, function (Deck, GameModule) {
  'use strict';

  const T = Deck.CARD_TYPES;
  const A = Deck.ACTIONS;
  const REQ = Deck.SET_REQUIREMENTS;
  const RENT = Deck.RENT_VALUES;

  // Priority tiers. Gaps are wide so a higher tier always beats a lower one
  // regardless of intra-tier bonuses. These are the SHARED scoring weights;
  // difficulty is applied separately (see the AIAgent constructor), so changing
  // one of these changes every difficulty at once.
  const TIERS = {
    WIN: 1000000,
    COMPLETE_SET: 50000,
    COMPLETE_VIA_STEAL: 48000,
    DEAL_BREAKER_ADV: 30000,
    BUILDING: 25000,        // above rent so buildings go on before rent is charged
    RENT_COMBO: 20000,
    DEBT_BIRTHDAY: 12000,
    STANDARD_RENT: 10000,
    STEAL_GENERIC: 8000,
    PASS_GO: 6000,
    ADVANCE: 4000,
    BANK: 100,
  };

  /* ==========================================================================
   * Pure scoring helpers (operate on the read-only `view` data only).
   * ========================================================================*/

  // Count of property cards a player holds in a color group.
  function countOf(props, color) {
    return props[color] ? props[color].cards.length : 0;
  }
  function isComplete(props, color) {
    return countOf(props, color) >= REQ[color];
  }

  // Rent for owning exactly `count` cards of a color (no building bonus).
  function rentForCount(color, count) {
    if (count <= 0) return 0;
    const table = RENT[color];
    return table[Math.min(count, table.length) - 1];
  }

  // Full rent for a player's current set in a color, including buildings.
  function setRentFromProps(props, color) {
    const g = props[color];
    if (!g || g.cards.length === 0) return 0;
    let rent = rentForCount(color, g.cards.length);
    if (g.cards.length >= REQ[color] && Deck.NO_BUILDING_COLORS.indexOf(color) === -1) {
      if (g.house) rent += Deck.HOUSE_RENT_BONUS;
      if (g.hotel) rent += Deck.HOTEL_RENT_BONUS;
    }
    return rent;
  }

  // Total value an opponent could be forced to pay (bank + payable properties).
  function payableValue(summary) {
    let v = 0;
    for (const c of summary.bank) v += c.value;
    for (const color of Object.keys(summary.properties)) {
      const g = summary.properties[color];
      for (const c of g.cards) if (c.canPay) v += c.value;
      if (g.house) v += g.house.value;
      if (g.hotel) v += g.hotel.value;
    }
    return v;
  }

  // Locate a property/wildcard by id within a collection; returns {color, card}.
  function findProp(props, cardId) {
    for (const color of Object.keys(props)) {
      const card = props[color].cards.find(c => c.id === cardId);
      if (card) return { color, card };
    }
    return null;
  }

  // Best rent a given player could charge with a particular rent card, based on
  // their visible property sets (used to gauge incoming-rent threats for JSN).
  function estimateRent(summary, rentCard) {
    let max = 0;
    for (const color of rentCard.colors) {
      const r = setRentFromProps(summary.properties, color);
      if (r > max) max = r;
    }
    return max;
  }

  /* ==========================================================================
   * AIAgent
   * ========================================================================*/
  class AIAgent {
    constructor(opts) {
      opts = opts || {};
      this.tiers = Object.assign({}, TIERS, opts.tiers);
      this.name = opts.name || 'AI';
      this.rng = opts.rng || Math.random;
      // ---- Difficulty ---------------------------------------------------
      // Until 2026-09-01 difficulty tuned only TWO things: how often a
      // sub-optimal move was picked, and how reliably Just Say No was played.
      // Everything else - payment, discards, wildcard placement, card
      // valuation - was solved optimally at every level, which is most of what
      // a person actually notices. Measured, seat-balanced, 800 games each:
      // Normal beat Hard 49.5% and Easy beat Hard 42.0%, against a Hard-vs-Hard
      // baseline of 51.5%. Normal and Hard were the same opponent.
      //
      // EVERY value below was measured, seat-balanced, 500 games per cell
      // against Hard. Do not guess new ones - re-run the sweep, because the
      // obvious knobs turn out not to work:
      //
      //   stopEarly  THE lever, and sharply non-linear: don't squeeze all three
      //              plays out of every turn. 0.2 -> 23.5%, 0.4 -> 6.3%. It is
      //              also the most human thing on this list - a weaker player
      //              simply does not find a third play every turn. Gated so it
      //              can only fire AFTER at least one card is down, because an
      //              AI that sits out a whole turn reads as broken, not weak.
      //   jsn        the second real lever: failing to defend costs ~10 pts at
      //              0 (40.6% against a 50.5% baseline).
      //   blunder    play a good-but-not-best move. Weak until nearly total:
      //              0.45 -> 49.3%, 1.00 -> 38.6%. The engine hands out 3 slots
      //              a turn, so a passed-over move is usually just made one
      //              slot later.
      //   passivity  don't attack this slot; build instead. Worth much less
      //              than it first appeared (0.5 -> 49.9%, 0.75 -> 47.4%), but
      //              kept because it is what makes an easy opponent read as
      //              "quietly building sets" rather than "sharp but clumsy".
      //
      // CAUTION when re-tuning: the first sweep of these knobs was run before
      // the winning-move guard below existed, and was badly contaminated by it
      // - passivity appeared to be worth 20 points when most of that was the
      // easy AI declining to win. Any new number must be measured with the
      // guard in place.
      //
      // Two knobs below are deliberately kept even though they are worth ~0
      // win rate, because they fix how the AI FEELS rather than how strong it
      // is - which is what was actually reported:
      //   discard    (52.6% -> 52.4%: no strength effect) the only route by
      //              which an AI ever parts with a Just Say No. Before it, one
      //              was banked or discarded exactly 0 times in 300 games and
      //              the AI held one on 29% of its turns. That is what "they
      //              always have the perfect card" really was - not luck; the
      //              deck is a clean Fisher-Yates and every seat draws action
      //              cards at 32.2-32.7% against a 32.08% deck baseline.
      //   wild       (51.6%: no strength effect) a visible, ordinary misplay.
      //
      // A 'pay' knob (settle debts cheapest-first instead of with the optimal
      // knapsack) was built, measured at 54.0% - i.e. very slightly BETTER than
      // playing optimally, because giving up more low-rank bank money protects
      // property - and removed. Overpaying is also invisible to the person you
      // are paying. It is not a difficulty knob; do not re-add it.
      //
      // Hard is 0 across the board on purpose: it is the opponent that does not
      // make mistakes.
      //
      // WHERE THIS LANDED, seat-balanced, 1,200 games per cell (`node js/ai.js`
      // re-runs it). Before this rework the same measurement read 49.5 / 42.0
      // against a 51.5 baseline - Normal and Hard were the same opponent, which
      // is what prompted it:
      //     Hard   vs Hard   50.5% +/- 2.8   (baseline)
      //     Medium vs Hard   36.6% +/- 2.7
      //     Easy   vs Hard   18.8% +/- 2.2
      //     Easy   vs Medium 29.4% +/- 2.6
      // Cards played per turn, which is the visible face of stopEarly:
      //     Easy   1:33%  2:25%  3:41%
      //     Medium 1:18%  2:20%  3:61%
      //     Hard   1: 4%  2:17%  3:78%
      // No difficulty ever plays a turn with ZERO cards.
      const D = {
        easy:   { blunder: 0.45, jsn: 0.35, stop: 0.32, passive: 0.60, discard: 0.55, wild: 0.45, keepJSN: 0.35 },
        normal: { blunder: 0.22, jsn: 0.70, stop: 0.16, passive: 0.35, discard: 0.25, wild: 0.20, keepJSN: 0.70 },
        hard:   { blunder: 0.00, jsn: 1.00, stop: 0.00, passive: 0.00, discard: 0.00, wild: 0.00, keepJSN: 1.00 },
      };
      const d = D[opts.difficulty] || D.hard;
      this.blunderRate = d.blunder;
      this.jsnSkill = d.jsn;
      this.stopEarly = d.stop;           // chance of ending the turn with plays unspent
      this.passivity = d.passive;        // chance of not attacking at all this slot
      this.discardNoise = d.discard;     // chance of discarding carelessly
      this.wildNoise = d.wild;           // chance of a careless wildcard color
      this.keepJSN = d.keepJSN;          // how precious Just Say No is to keep
      this._maxPlays = 0;                // highest playsRemaining seen; see chooseMove
    }

    // Does this move take something from somebody? Drives `passivity`.
    isAttack(view, move) {
      if (move.type === 'rent') return true;
      if (move.type !== 'action') return false;
      const card = view.me.hand.find(c => c.id === move.cardId);
      if (!card) return false;
      return card.action === A.SLY_DEAL || card.action === A.FORCED_DEAL ||
             card.action === A.DEAL_BREAKER || card.action === A.DEBT_COLLECTOR ||
             card.action === A.BIRTHDAY;
    }

    /* ---- main move selection ------------------------------------------- */
    chooseMove(view, legalMoves) {
      // Score EVERY legal move first, before difficulty touches anything. The
      // win check below depends on it: a winning move is very often itself an
      // attack (a Deal Breaker that takes the third set, a Sly Deal that
      // completes it), so filtering attacks out first would hide it.
      const scored = [];
      let bestScore = 0;
      for (const m of legalMoves) {
        if (m.type === 'pass') continue;
        const s = this.scoreMove(view, m);
        if (s > 0) scored.push({ m, s });
        if (s > bestScore) bestScore = s;
      }
      if (!scored.length) return { type: 'pass' };

      // TIES ARE BROKEN AT RANDOM, and that is load-bearing (2026-09-01).
      // This used to keep the first move that beat the running best, and
      // enumerateMoves() lists victims in PLAYER-ID order, so every tied attack
      // landed on seat 0 - which is always the human. Measured over 400
      // four-player games of four IDENTICAL Hard AIs: seat 0 took 42.9% of all
      // targeted attacks against a 25% fair share, seats 1/2/3 took
      // 27.6/17.5/12.0%, and of the 44% of attacks that were exact ties, seat 0
      // won 1,122 of them and seat 3 won ZERO. Matt reported it as "they steal
      // from me more often than each other, even when it doesn't make sense" -
      // he was reading a real bug. Now 31.3/25.9/23.1/19.8%; the remainder is
      // legitimate and is NOT tie-breaking (turning threatOf off leaves it at
      // 30.5%): seat 0 moves first, so it carries the most property on the
      // board (4.70 cards against seat 3's 3.88) and is genuinely the biggest
      // target. See also threatOf().
      const pickTop = (pool, score) => {
        const top = pool.filter(x => x.s === score);
        return (top.length === 1 ? top[0] : top[Math.floor(this.rng() * top.length)]).m;
      };

      // Never blunder away an immediate win, at any difficulty. The blunder
      // pool below is every positive-scoring move, which included the winning
      // one: at 'easy' the AI declined an available win in roughly one game in
      // five (60 times in 300), at 'normal' one in twelve. Losing on purpose is
      // not a difficulty knob.
      if (bestScore >= this.tiers.WIN) return pickTop(scored, bestScore);

      // Easier AIs don't wring all three plays out of every turn. Only ever
      // AFTER something has already been played this turn (playsRemaining is
      // below its MAX_PLAYS starting value), so the AI is never seen doing
      // nothing at all on its go - that reads as a hung game, not a weak
      // opponent. Passing here ends the turn: see game.js playTurn().
      // `_maxPlays` self-calibrates from the highest playsRemaining the engine
      // has ever handed us, rather than hardcoding game.js's MAX_PLAYS: a
      // literal 3 here would silently stop firing (or fire every slot) if that
      // constant ever moved, and nothing would fail.
      if (view.playsRemaining > this._maxPlays) this._maxPlays = view.playsRemaining;
      if (this.stopEarly > 0 && view.playsRemaining < this._maxPlays &&
          this.rng() < this.stopEarly) {
        return { type: 'pass' };
      }

      // Easier AIs sometimes just play their own game this slot: bank, build,
      // place property, and leave everybody else alone. This is the strongest
      // difficulty lever by a distance (see the table in the constructor), and
      // it is also the one that reads right - an easy opponent should look like
      // somebody quietly building sets, not like a sharp player throwing a
      // punch you can't see coming.
      let pool = scored;
      if (this.passivity > 0 && this.rng() < this.passivity) {
        const tame = scored.filter(x => !this.isAttack(view, x.m));
        if (tame.length) {
          pool = tame;
          bestScore = tame.reduce((mx, x) => (x.s > mx ? x.s : mx), 0);
        }
      }

      // Easier AIs sometimes pick a random *plausible* (positive-scoring) move
      // instead of the optimal one — never a blunder like binning a Deal Breaker.
      if (this.blunderRate > 0 && pool.length > 1 && this.rng() < this.blunderRate) {
        return pool[Math.floor(this.rng() * pool.length)].m;
      }
      return pickTop(pool, bestScore);
    }

    /* ---- who deserves to be attacked ----------------------------------- */
    // How dangerous is this opponent right now? Added 2026-09-01 so that
    // CHOOSING A VICTIM is a decision rather than an accident of enumeration
    // order. scoreSly() in particular had no opponent term at all — robbing A
    // and robbing B for the same color scored identically, so the seat-order
    // tie-break above decided it every single time. Deliberately small (roughly
    // 0-160) so it sits inside a tier and breaks ties without ever outranking
    // "does this complete my set".
    threatOf(opp) {
      if (!opp) return 0;
      let t = opp.completeSets * 40;
      for (const color of Object.keys(opp.properties)) {
        const n = opp.properties[color].cards.length;
        if (n <= 0) continue;
        t += n * 4;
        if (REQ[color] - n === 1) t += 12;   // one card off a set is the real danger
      }
      return t + Math.min(opp.bankValue, 20);
    }

    scoreMove(view, move) {
      switch (move.type) {
        case 'bank':     return this.scoreBank(view, move);
        case 'property': return this.scoreProperty(view, move);
        case 'rent':     return this.scoreRent(view, move);
        case 'action':   return this.scoreAction(view, move);
        default:         return -1;
      }
    }

    /* ---- property placement (priorities 3 & 10) ------------------------ */
    scoreProperty(view, move) {
      const me = view.me;
      const card = me.hand.find(c => c.id === move.cardId);
      if (!card) return -1;
      const color = move.color;
      const before = countOf(me.properties, color);
      const wasComplete = before >= REQ[color];
      const after = before + 1;
      const completes = !wasComplete && after >= REQ[color];

      if (completes) {
        // Completing my 3rd distinct set wins the game outright.
        if (me.completeSets + 1 >= 3) return this.tiers.WIN + rentForCount(color, after);
        // Otherwise prioritize completing higher-rent sets.
        return this.tiers.COMPLETE_SET + rentForCount(color, after) * 100;
      }
      // Merely advancing toward a set: favor sets I'm already deep into and the
      // rent they'll eventually pay. Prefer real properties over flexible wilds.
      let s = this.tiers.ADVANCE + before * 60 + rentForCount(color, after) * 8;
      if (card.type === T.PROPERTY_WILD) s -= 50;
      return s;
    }

    /* ---- rent (priorities 6 & 8) --------------------------------------- */
    // Resolve the opponent a move targets (falls back to the first opponent).
    targetOf(view, move) {
      if (move.targetPlayerId != null) {
        const o = view.opponents.find(x => x.id === move.targetPlayerId);
        if (o) return o;
      }
      return view.opponents[0];
    }

    scoreRent(view, move) {
      const me = view.me;
      const color = move.color;
      const base = setRentFromProps(me.properties, color);
      if (base <= 0) return -1;

      const doubles = (move.doubleCardIds || []).length;
      const charge = base * Math.pow(2, doubles);

      // Wild rent hits one chosen opponent; color rent hits all opponents.
      const targets = move.targetPlayerId != null
        ? view.opponents.filter(o => o.id === move.targetPlayerId)
        : view.opponents;
      const collectible = targets.reduce((s, o) => s + Math.min(charge, payableValue(o)), 0);
      if (collectible <= 0) return -1; // nobody can pay — not worth the card

      if (doubles > 0) {
        // Only spend a Double the Rent when it produces a real haul (6M+).
        if (charge >= 6) return this.tiers.RENT_COMBO + charge * 100 + collectible * 20
          + (move.targetPlayerId != null ? this.threatOf(targets[0]) : 0);
        return -1; // don't waste the double on a small set
      }
      const threat = move.targetPlayerId != null ? this.threatOf(targets[0]) : 0;
      if (charge > 2) return this.tiers.STANDARD_RENT + charge * 80 + collectible * 30 + threat;
      return this.tiers.BANK + collectible * 10; // 1-2M rent: marginal, near filler
    }

    /* ---- action cards -------------------------------------------------- */
    scoreAction(view, move) {
      const me = view.me;
      const card = me.hand.find(c => c.id === move.cardId);
      if (!card) return -1;
      switch (card.action) {
        case A.PASS_GO:        return this.scorePassGo(view);
        case A.DEBT_COLLECTOR: return this.scoreDebt(view, move, 5);
        case A.BIRTHDAY:       return this.scoreBirthday(view, 2);
        case A.SLY_DEAL:       return this.scoreSly(view, move);
        case A.FORCED_DEAL:    return this.scoreForced(view, move);
        case A.DEAL_BREAKER:   return this.scoreDealBreaker(view, move);
        case A.HOUSE:
        case A.HOTEL:          return this.scoreBuilding(view, move, card);
        default:               return -1;
      }
    }

    scorePassGo(view) {
      const hand = view.me.hand.length;
      if (hand <= 4) return this.tiers.PASS_GO;       // refill a thin hand
      if (hand <= 6) return this.tiers.PASS_GO / 2;   // ok if nothing better
      return -50;                                     // near the discard limit
    }

    // Debt Collector: one chosen opponent pays `amount`.
    scoreDebt(view, move, amount) {
      const me = view.me;
      const opp = this.targetOf(view, move);
      if (!opp) return -1;
      const oppPay = payableValue(opp);
      if (oppPay <= 0) return -1;
      const collect = Math.min(amount, oppPay);
      let s = this.tiers.DEBT_BIRTHDAY + collect * 200 + this.threatOf(opp);
      if (me.bankValue < opp.bankValue) s += 500; // press when behind on cash
      return s;
    }

    // It's My Birthday: every opponent pays `amount`.
    scoreBirthday(view, amount) {
      const total = view.opponents.reduce((s, o) => s + Math.min(amount, payableValue(o)), 0);
      if (total <= 0) return -1;
      return this.tiers.DEBT_BIRTHDAY + total * 200;
    }

    scoreSly(view, move) {
      const me = view.me, opp = this.targetOf(view, move);
      const target = opp && findProp(opp.properties, move.targetCardId);
      if (!target) return -1;
      const color = target.color;
      const before = countOf(me.properties, color);
      const completes = before < REQ[color] && before + 1 >= REQ[color];
      if (completes) {
        if (me.completeSets + 1 >= 3) return this.tiers.WIN + 100;
        return this.tiers.COMPLETE_VIA_STEAL + rentForCount(color, before + 1) * 100;
      }
      // Generic theft: helps if I already hold some of that color; also denies
      // the opponent progress — and the further ahead they are, the more that
      // denial is worth. Without the threatOf() term this expression did not
      // reference `opp` at all, so who got robbed was decided entirely by
      // enumeration order (see chooseMove).
      return this.tiers.STEAL_GENERIC + before * 40 + rentForCount(color, before + 1) * 8
        + this.threatOf(opp);
    }

    scoreForced(view, move) {
      const me = view.me, opp = this.targetOf(view, move);
      const theirs = opp && findProp(opp.properties, move.targetCardId);
      const mine = findProp(me.properties, move.myCardId);
      if (!theirs || !mine) return -1;

      const tColor = theirs.color;
      const before = countOf(me.properties, tColor);
      const completes = before < REQ[tColor] && before + 1 >= REQ[tColor];
      if (completes && me.completeSets + 1 >= 3) return this.tiers.WIN + 100;

      const takeVal = (completes
        ? this.tiers.COMPLETE_VIA_STEAL + rentForCount(tColor, before + 1) * 100
        : this.tiers.STEAL_GENERIC + before * 40 + rentForCount(tColor, before + 1) * 8)
        + this.threatOf(opp);

      // Cost of giving a card away: cheap if it's from a set I'm far from
      // completing; costly if from a set I'm building up.
      const giveColor = mine.color;
      const giveCount = countOf(me.properties, giveColor);
      const giveCost = giveCount * 30 + rentForCount(giveColor, Math.max(1, giveCount)) * 5;
      return takeVal - giveCost;
    }

    scoreDealBreaker(view, move) {
      const me = view.me, opp = this.targetOf(view, move);
      const color = move.targetColor;
      if (!opp || !isComplete(opp.properties, color)) return -1;
      const alreadyMine = isComplete(me.properties, color);
      const newComplete = alreadyMine ? me.completeSets : me.completeSets + 1;
      if (newComplete >= 3) return this.tiers.WIN + rentForCount(color, REQ[color]) * 10;
      // Stealing a full set is a massive swing; weight by rent and by how close
      // the opponent is to winning.
      return this.tiers.DEAL_BREAKER_ADV +
        rentForCount(color, REQ[color]) * 150 + opp.completeSets * 1000 + this.threatOf(opp);
    }

    scoreBuilding(view, move, card) {
      const color = move.color;
      const bonus = card.action === A.HOUSE ? Deck.HOUSE_RENT_BONUS : Deck.HOTEL_RENT_BONUS;
      return this.tiers.BUILDING + bonus * 100 + rentForCount(color, REQ[color]) * 20;
    }

    /* ---- banking (priority 12, filler) --------------------------------- */
    scoreBank(view, move) {
      const me = view.me;
      const card = me.hand.find(c => c.id === move.cardId);
      if (!card) return -1;
      let s = this.tiers.BANK + (card.value || 0) * 5;
      // Banking an action/rent card forfeits its ability — only do it when the
      // card is not worth keeping (penalty = how useful the card is to keep).
      if (card.type !== T.MONEY) s -= this.cardUsefulness(view, card);
      // Defensive boost: if I'm low on bankable cash, prefer banking money so I
      // can pay debts without surrendering properties.
      if (card.type === T.MONEY && me.bankValue < 5) s += (5 - me.bankValue) * 1000;
      return s;
    }

    /* ======================================================================
     * Reactive decisions
     * ====================================================================*/

    // Just Say No logic (CLAUDE.md "JSN Logic").
    respondToAction(view, ctx) {
      const me = view.me;
      if (!me.hand.some(c => c.action === A.JUST_SAY_NO)) return false;
      // Easier AIs occasionally fail to defend even when they should.
      if (this.jsnSkill < 1 && this.rng() > this.jsnSkill) return false;
      const card = ctx.actionCard;
      const attacker = view.opponents.find(o => o.id === ctx.attackerId) || view.opponents[0];

      if (ctx.responderRole === 'attacker') {
        // My action was cancelled — counter to push through the important ones.
        if (card.action === A.DEAL_BREAKER) return true;
        if (card.action === A.SLY_DEAL || card.action === A.FORCED_DEAL) return true;
        if (card.type === T.RENT) return estimateRent(me, card) >= 5;
        return false; // small stuff (debt/birthday) — let the cancel stand
      }

      // I'm the defender: should I cancel the action against me?
      switch (card.action) {
        case A.DEAL_BREAKER:
          return true; // never surrender a full set
        case A.SLY_DEAL:
        case A.FORCED_DEAL:
          return this.hasValuableSetAtRisk(me);
        case A.DEBT_COLLECTOR:
        case A.BIRTHDAY:
          return false; // small cost — just pay it
        default:
          if (card.type === T.RENT) {
            const charge = estimateRent(attacker, card);
            // Cancel only big rent that would force me to pay with property.
            return charge >= 5 && me.bankValue < charge;
          }
          return false;
      }
    }

    // Do I hold a set worth protecting from a Sly/Forced Deal? (One card away
    // from completion, with at least two cards invested.)
    hasValuableSetAtRisk(me) {
      for (const color of Object.keys(me.properties)) {
        const n = countOf(me.properties, color);
        if (n < REQ[color] && n >= REQ[color] - 1 && n >= 2) return true;
      }
      return false;
    }

    // Payment logic (CLAUDE.md "Payment Logic"): cover the debt with the LEAST
    // value possible (no needless overpay), preferring bank money and, when a
    // property must go, the ones furthest from completion. The old greedy
    // "cheapest-first until covered" overshot badly (e.g. 7M to settle 5M).
    choosePayment(view, ctx) {
      const me = view.me;
      const assets = [];
      // rank = how reluctant we are to give a card up (lower = spend first):
      //   bank money 0  <  incomplete props (further-from-done lower)  <  complete-set props
      for (const c of me.bank) if (c.canPay !== false) assets.push({ id: c.id, value: c.value, rank: 0 });
      for (const color of Object.keys(me.properties)) {
        const g = me.properties[color];
        const complete = g.cards.length >= REQ[color];
        const distance = REQ[color] - g.cards.length;       // bigger = further from done
        const rank = complete ? 100 : (10 - Math.min(distance, 9)); // incomplete & further => give first
        for (const c of g.cards) if (c.canPay) assets.push({ id: c.id, value: c.value, rank });
        if (g.house) assets.push({ id: g.house.id, value: g.house.value, rank });
        if (g.hotel) assets.push({ id: g.hotel.id, value: g.hotel.value, rank });
      }
      const required = ctx.required;
      const total = assets.reduce((s, a) => s + a.value, 0);
      if (total <= required) return assets.map(a => a.id); // can't cover it — give everything

      // 0/1 knapsack DP over reachable sums. cost = rank*BIG + value, so we first
      // pick the smallest sum that still covers the debt (min overpay), then —
      // among subsets of that same sum — the one giving up the least-prized cards.
      const BIG = 1000;
      const cost = new Array(total + 1).fill(Infinity);
      const pick = new Array(total + 1).fill(null);
      cost[0] = 0;
      for (let i = 0; i < assets.length; i++) {
        const a = assets[i], c = a.rank * BIG + a.value;
        for (let s = total; s >= a.value; s--) {
          if (cost[s - a.value] + c < cost[s]) { cost[s] = cost[s - a.value] + c; pick[s] = { prev: s - a.value, idx: i }; }
        }
      }
      let best = -1;
      for (let s = required; s <= total; s++) if (cost[s] < Infinity) { best = s; break; }
      if (best === -1) return assets.map(a => a.id); // shouldn't happen (total > required)

      const chosen = [];
      for (let s = best; s > 0 && pick[s]; s = pick[s].prev) chosen.push(assets[pick[s].idx].id);
      return chosen;
    }

    // Discard the least useful cards down to the hand limit.
    chooseDiscards(view, count) {
      const hand = view.me.hand.slice();
      // Easy/Medium sometimes dump whatever is nearest to hand instead of the
      // card a solver would pick. Worth ~0 win rate (52.6% -> 52.4%) and kept
      // anyway: it is the ONLY route by which an AI ever parts with a Just Say
      // No. Before it existed one was banked or discarded exactly 0 times in
      // 300 games and the AI held one on 29% of its turns, which is what "they
      // always have the perfect card" actually was. Hard still discards
      // perfectly - that is what Hard is for.
      if (this.discardNoise > 0 && this.rng() < this.discardNoise) {
        for (let i = hand.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          const t = hand[i]; hand[i] = hand[j]; hand[j] = t;
        }
        return hand.slice(0, count).map(c => c.id);
      }
      return hand
        .sort((a, b) => this.cardUsefulness(view, a) - this.cardUsefulness(view, b))
        .slice(0, count)
        .map(c => c.id);
    }

    // Wildcard placement: the color where it best completes / advances a set.
    assignWildColor(view, card, validColors) {
      // Easy/Medium sometimes park a wildcard on the wrong color — an ordinary,
      // very visible mistake, worth ~0 win rate (51.6%) and kept for exactly
      // that visibility. Still confined to a color that isn't already complete,
      // so it stays a misjudgement rather than a nonsense play.
      if (this.wildNoise > 0 && validColors.length > 1 && this.rng() < this.wildNoise) {
        const open = validColors.filter(c => countOf(view.me.properties, c) < REQ[c]);
        const pool = open.length ? open : validColors;
        return pool[Math.floor(this.rng() * pool.length)];
      }
      let best = validColors[0], bestScore = -Infinity;
      for (const color of validColors) {
        const have = countOf(view.me.properties, color);
        if (have >= REQ[color]) continue; // already complete — don't waste here
        const need = REQ[color] - have;
        const score = have * 100 - need * 10 + rentForCount(color, Math.min(have + 1, REQ[color]));
        if (score > bestScore) { bestScore = score; best = color; }
      }
      return best;
    }

    /* ======================================================================
     * How valuable is a card to KEEP in hand? Drives banking & discard choices.
     * ====================================================================*/
    cardUsefulness(view, card) {
      const me = view.me;
      const opps = view.opponents;
      const anyComplete = opps.some(o => o.completeSets > 0);
      const anyStealable = opps.some(o => this.oppHasStealable(o));
      const anyPayable = opps.some(o => payableValue(o) > 0);
      switch (card.type) {
        case T.PROPERTY:
        case T.PROPERTY_WILD:
          return 3000; // properties win games — almost always keep
        case T.MONEY:
          return (card.value || 0) * 60; // bankable; low cards are cheap to drop
        case T.RENT: {
          const owned = card.colors.some(c => setRentFromProps(me.properties, c) > 0);
          return owned ? 1500 : 250;
        }
        case T.ACTION:
          switch (card.action) {
            // Scaled by difficulty (keepJSN): to Hard this is defensive gold it
            // will never bank or discard; to Easy it is merely a good card, so
            // the discard path above can genuinely take it away.
            case A.JUST_SAY_NO:    return Math.round(6000 * this.keepJSN);
            case A.DEAL_BREAKER:   return anyComplete ? 8000 : 4000;
            case A.SLY_DEAL:
            case A.FORCED_DEAL:    return anyStealable ? 2500 : 700;
            case A.DEBT_COLLECTOR:
            case A.BIRTHDAY:       return anyPayable ? 1600 : 400;
            case A.DOUBLE_RENT:    return this.hasOwnedRent(me) ? 1800 : 300;
            case A.PASS_GO:        return 800;
            case A.HOUSE:
            case A.HOTEL:          return me.completeSets > 0 ? 1800 : 500;
            default:               return 300;
          }
        default:
          return 200;
      }
    }

    oppHasStealable(opp) {
      if (!opp) return false;
      for (const color of Object.keys(opp.properties)) {
        if (isComplete(opp.properties, color)) continue;
        if (opp.properties[color].cards.length > 0) return true;
      }
      return false;
    }

    hasOwnedRent(me) {
      return me.hand.some(c =>
        c.type === T.RENT && c.colors.some(col => setRentFromProps(me.properties, col) > 0));
    }
  }

  /* ==========================================================================
   * test() — pit the AI against the RandomAgent (and itself) to confirm it
   * plays legally, completes games, and wins materially more than random.
   * ========================================================================*/
  async function test(opts) {
    opts = opts || {};
    const Game = GameModule.Game;
    const RandomAgent = GameModule.RandomAgent;
    const mulberry32 = GameModule.mulberry32;
    const games = opts.games || 300;

    async function play(makeP0, makeP1, seed) {
      const rng = mulberry32(seed);
      // NOTE: agents take the game's rng so a seeded run is reproducible. Since
      // 2026-09-01 the AI calls rng() to break scoring ties (see chooseMove) and
      // to apply its difficulty knobs, so an agent built without one falls back
      // to Math.random and the run stops being repeatable.
      const g = new Game({
        rng, verbose: false,
        players: [
          { name: 'P0', agent: makeP0(rng) },
          { name: 'P1', agent: makeP1(rng) },
        ],
      });
      g.setup();
      let turns = 0;
      while (!g.winner && turns < 500) { await g.playTurn(); turns++; }
      // integrity
      const ids = new Set();
      const add = a => a.forEach(c => ids.add(c.id));
      for (const p of g.players) {
        add(p.hand); add(p.bank);
        for (const col of Object.keys(p.properties)) {
          const gr = p.properties[col]; add(gr.cards);
          if (gr.house) ids.add(gr.house.id);
          if (gr.hotel) ids.add(gr.hotel.id);
        }
      }
      add(g.deck); add(g.discard);
      if (ids.size !== 106) throw new Error('integrity ' + ids.size + ' seed ' + seed);
      return { winnerIndex: g.winner ? g.winner.id : -1, turns };
    }

    console.log('=== Monopoly Deal — AI self-test (' + games + ' games each) ===');

    // 1) AI (P0) vs RandomAgent (P1) — AI should dominate.
    let aiWins = 0, rndWins = 0, unfinished = 0, totalTurns = 0;
    for (let s = 1; s <= games; s++) {
      const r = await play((rng) => new AIAgent({ rng }), (rng) => new RandomAgent(rng), s * 131 + 7);
      totalTurns += r.turns;
      if (r.winnerIndex === 0) aiWins++;
      else if (r.winnerIndex === 1) rndWins++;
      else unfinished++;
    }
    const aiRate = (100 * aiWins / games).toFixed(1);
    console.log(`AI vs Random:  AI ${aiWins} / Random ${rndWins} / unfinished ${unfinished}` +
      `  -> AI win rate ${aiRate}%  (avg ${(totalTurns / games).toFixed(1)} turns)`);

    // 2) Swap seats to confirm the edge isn't a first-player artifact.
    let aiWins2 = 0;
    for (let s = 1; s <= games; s++) {
      const r = await play((rng) => new RandomAgent(rng), (rng) => new AIAgent({ rng }), s * 197 + 13);
      if (r.winnerIndex === 1) aiWins2++;
    }
    console.log(`AI (2nd seat) win rate: ${(100 * aiWins2 / games).toFixed(1)}%`);

    // 3) AI vs AI — must always terminate with a valid winner.
    let mirrorFinished = 0;
    for (let s = 1; s <= games; s++) {
      const r = await play((rng) => new AIAgent({ rng }), (rng) => new AIAgent({ rng }), s * 311 + 5);
      if (r.winnerIndex !== -1) mirrorFinished++;
    }
    console.log(`AI vs AI: ${mirrorFinished}/${games} finished with a winner.`);

    // 4) Multiplayer: our AI (seat 0) vs N-1 RandomAgents — should beat the 1/N
    //    baseline by a wide margin, and every game must terminate.
    const playN = async (N, seed) => {
      const rng = mulberry32(seed);
      const players = [{ name: 'AI0', agent: new AIAgent({ rng }) }];
      for (let i = 1; i < N; i++) players.push({ name: 'R' + i, agent: new RandomAgent(rng) });
      const g = new Game({ rng, verbose: false, players });
      g.setup();
      let t = 0;
      while (!g.winner && t < 1000) { await g.playTurn(); t++; }
      return g.winner ? g.winner.id : -1;
    };
    let nFinished = 0;
    for (const N of [4, 5]) {
      let p0 = 0, fin = 0;
      for (let s = 1; s <= games; s++) {
        const w = await playN(N, s * 909 + N);
        if (w !== -1) fin++;
        if (w === 0) p0++;
      }
      nFinished += (fin === games ? 1 : 0);
      console.log(`${N}-player: AI win rate ${(100 * p0 / games).toFixed(1)}% ` +
        `(baseline ${(100 / N).toFixed(0)}%), ${fin}/${games} finished.`);
    }

    // 5) THE DIFFICULTY LADDER. This is the regression probe for the 2026-09-01
    //    rework: before it, Normal beat Hard 49.5% and Easy beat Hard 42.0%
    //    against a 51.5% Hard-vs-Hard baseline - i.e. the three settings were
    //    one setting, which is exactly the bug Matt reported. Seats are swapped
    //    so a first-player edge can't be mistaken for a difficulty edge.
    const ladder = async (a, b) => {
      let w = 0, n = 0;
      for (let s = 1; s <= games; s++) {
        const r = await play((rng) => new AIAgent({ difficulty: a, rng }),
                             (rng) => new AIAgent({ difficulty: b, rng }), s * 131 + 7);
        if (r.winnerIndex !== -1) { n++; if (r.winnerIndex === 0) w++; }
      }
      for (let s = 1; s <= games; s++) {
        const r = await play((rng) => new AIAgent({ difficulty: b, rng }),
                             (rng) => new AIAgent({ difficulty: a, rng }), s * 577 + 11);
        if (r.winnerIndex !== -1) { n++; if (r.winnerIndex === 1) w++; }
      }
      return n ? 100 * w / n : 0;
    };
    const base = await ladder('hard', 'hard');
    const mid = await ladder('normal', 'hard');
    const low = await ladder('easy', 'hard');
    console.log(`Difficulty ladder (vs Hard, seats swapped): baseline ${base.toFixed(1)}% | ` +
      `Medium ${mid.toFixed(1)}% | Easy ${low.toFixed(1)}%`);
    // Each rung must be clearly below the one above it. 6 points is well outside
    // the +/-2.8 confidence interval at the default 300 games/seat, and the
    // pre-rework build would have failed the first of these by 7 points.
    const ladderOk = base - mid >= 6 && mid - low >= 6;
    if (!ladderOk) {
      console.log('  !! difficulty ladder FAILED: the settings are not distinct opponents.');
    }

    // 6) A winning move is never declined, at any difficulty. The blunder pool
    //    used to include the winning move: 'easy' passed up an available win in
    //    about one game in five, 'normal' one in twelve.
    let declined = 0;
    for (const diff of ['easy', 'normal', 'hard']) {
      for (let s = 1; s <= Math.min(games, 100); s++) {
        const rng = mulberry32(s * 17 + 3);
        const probe = new AIAgent({ difficulty: diff, rng });
        const orig = probe.chooseMove.bind(probe);
        probe.chooseMove = (v, l) => {
          let top = 0;
          for (const m of l) { if (m.type !== 'pass') { const sc = probe.scoreMove(v, m); if (sc > top) top = sc; } }
          const out = orig(v, l);
          if (top >= probe.tiers.WIN &&
              (out.type === 'pass' || probe.scoreMove(v, out) < probe.tiers.WIN)) declined++;
          return out;
        };
        const g = new Game({ rng, verbose: false, players: [
          { name: 'P0', agent: probe }, { name: 'P1', agent: new AIAgent({ difficulty: 'hard', rng }) }] });
        g.setup();
        let t = 0;
        while (!g.winner && t < 500) { await g.playTurn(); t++; }
      }
    }
    console.log(`Declined an available winning move: ${declined} time(s) (must be 0).`);

    const pass = aiWins / games >= 0.6 && mirrorFinished === games && nFinished === 2
      && ladderOk && declined === 0;
    console.log(pass
      ? '=== AI self-test PASSED (AI dominates random; ladder distinct; all games valid) ==='
      : '=== AI self-test FAILED (review win rate / ladder / termination above) ===');
    return { aiRate: +aiRate, base, mid, low, declined, pass };
  }

  const api = { AIAgent, TIERS, test };

  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    test().then(r => { if (!r.pass) process.exit(1); })
      .catch(e => { console.error(e); process.exit(1); });
  }

  return api;
});
