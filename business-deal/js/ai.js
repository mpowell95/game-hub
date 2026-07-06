/* =============================================================================
 * ai.js — Strategic AI agent for "Business Deal"
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
 * the higher-rent set first). The tier values are exposed for Session-5 tuning.
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
  // regardless of intra-tier bonuses. Tweak in Session 5 for difficulty tuning.
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
      // Difficulty tunes how often the AI plays a sub-optimal (but still
      // positive) move, and how reliably it defends with Just Say No.
      // 'hard' is the default and is fully deterministic (no rng calls).
      const D = {
        easy:   { blunder: 0.45, jsn: 0.40 },
        normal: { blunder: 0.18, jsn: 0.80 },
        hard:   { blunder: 0.00, jsn: 1.00 },
      };
      const d = D[opts.difficulty] || D.hard;
      this.blunderRate = d.blunder;
      this.jsnSkill = d.jsn;
    }

    /* ---- main move selection ------------------------------------------- */
    chooseMove(view, legalMoves) {
      // Score every legal move once.
      const scored = [];
      let best = { type: 'pass' }, bestScore = 0;
      for (const m of legalMoves) {
        if (m.type === 'pass') continue;
        const s = this.scoreMove(view, m);
        if (s > 0) scored.push({ m, s });
        if (s > bestScore) { bestScore = s; best = m; }
      }
      // Easier AIs sometimes pick a random *plausible* (positive-scoring) move
      // instead of the optimal one — never a blunder like binning a Deal Breaker.
      if (this.blunderRate > 0 && scored.length > 1 && this.rng() < this.blunderRate) {
        return scored[Math.floor(this.rng() * scored.length)].m;
      }
      return best;
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
        if (charge >= 6) return this.tiers.RENT_COMBO + charge * 100 + collectible * 20;
        return -1; // don't waste the double on a small set
      }
      if (charge > 2) return this.tiers.STANDARD_RENT + charge * 80 + collectible * 30;
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
      let s = this.tiers.DEBT_BIRTHDAY + collect * 200;
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
      // the opponent progress.
      return this.tiers.STEAL_GENERIC + before * 40 + rentForCount(color, before + 1) * 8;
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

      const takeVal = completes
        ? this.tiers.COMPLETE_VIA_STEAL + rentForCount(tColor, before + 1) * 100
        : this.tiers.STEAL_GENERIC + before * 40 + rentForCount(tColor, before + 1) * 8;

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
        rentForCount(color, REQ[color]) * 150 + opp.completeSets * 1000;
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
      return view.me.hand
        .slice()
        .sort((a, b) => this.cardUsefulness(view, a) - this.cardUsefulness(view, b))
        .slice(0, count)
        .map(c => c.id);
    }

    // Wildcard placement: the color where it best completes / advances a set.
    assignWildColor(view, card, validColors) {
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
            case A.JUST_SAY_NO:    return 6000; // defensive gold — never bank
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

    console.log('=== Business Deal — AI self-test (' + games + ' games each) ===');

    // 1) AI (P0) vs RandomAgent (P1) — AI should dominate.
    let aiWins = 0, rndWins = 0, unfinished = 0, totalTurns = 0;
    for (let s = 1; s <= games; s++) {
      const r = await play(() => new AIAgent(), (rng) => new RandomAgent(rng), s * 131 + 7);
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
      const r = await play((rng) => new RandomAgent(rng), () => new AIAgent(), s * 197 + 13);
      if (r.winnerIndex === 1) aiWins2++;
    }
    console.log(`AI (2nd seat) win rate: ${(100 * aiWins2 / games).toFixed(1)}%`);

    // 3) AI vs AI — must always terminate with a valid winner.
    let mirrorFinished = 0;
    for (let s = 1; s <= games; s++) {
      const r = await play(() => new AIAgent(), () => new AIAgent(), s * 311 + 5);
      if (r.winnerIndex !== -1) mirrorFinished++;
    }
    console.log(`AI vs AI: ${mirrorFinished}/${games} finished with a winner.`);

    // 4) Multiplayer: our AI (seat 0) vs N-1 RandomAgents — should beat the 1/N
    //    baseline by a wide margin, and every game must terminate.
    const playN = async (N, seed) => {
      const rng = mulberry32(seed);
      const players = [{ name: 'AI0', agent: new AIAgent() }];
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

    const pass = aiWins / games >= 0.6 && mirrorFinished === games && nFinished === 2;
    console.log(pass
      ? '=== AI self-test PASSED (AI dominates random; all games valid) ==='
      : '=== AI self-test WARNING (review win rate / termination above) ===');
    return { aiRate: +aiRate };
  }

  const api = { AIAgent, TIERS, test };

  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    test().catch(e => { console.error(e); process.exit(1); });
  }

  return api;
});
