// ai.js : Escoba AI agents at three difficulty tiers.
//
//   easy    (Beginner)     : plays a uniformly random legal move.
//   normal  (Intermediate) : greedy capture value + basic escoba-risk avoidance
//                            (assumes all card values are equally likely).
//   hard    (Pro)          : the same evaluator driven by true card counting.
//                            Everything outside the opponents' hands is public
//                            in Escoba (table + every capture pile + own hand),
//                            so the Pro tracks what is unseen and weighs the
//                            real probability of handing over an escoba or a
//                            fat capture.
//
// Agents implement { chooseMove(view) -> { cardId, captureIds } }. The engine
// legalizes whatever comes back, so the AI never needs defensive code.

import { makeDeck, captureOptions, sumValues } from './deck.js';

// Point-ish worth of capturing one card (used to compare capture combos).
function cardWorth(c) {
  let w = 0.2;                                    // every card helps "most cards"
  if (c.suit === 'oros') w += 0.6;                // coins race + all-coins bonus
  if (c.rank === 7) w += 0.7;                     // sevens race
  if (c.suit === 'oros' && c.rank === 7) w += 1.6; // the guindis is a point on its own
  return w;
}

function comboWorth(card, combo) {
  return cardWorth(card) + combo.reduce((s, c) => s + cardWorth(c), 0);
}

/** All legal moves for a hand on a table: every capture combo per card, or the
 *  lay-down move for cards that cannot capture. */
function legalMoves(hand, table) {
  const moves = [];
  for (const card of hand) {
    const opts = captureOptions(table, card);
    if (opts.length) for (const combo of opts) moves.push({ card, combo });
    else moves.push({ card, combo: null });
  }
  return moves;
}

export class AIAgent {
  constructor({ difficulty = 'normal' } = {}) {
    this.difficulty = difficulty;
  }

  chooseMove(view) {
    const moves = legalMoves(view.hand, view.table);
    const pick = this.difficulty === 'easy' ? this.pickEasy(moves)
      : this.pickSmart(moves, view, this.difficulty === 'hard');
    return {
      cardId: pick.card.id,
      captureIds: pick.combo ? pick.combo.map((c) => c.id) : [],
    };
  }

  pickEasy(moves) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  /**
   * Count the unseen copies of each capture value (1..10). Unseen = the full
   * deck minus my hand, the table, and every capture pile. What remains is the
   * stock plus the other players' hands, which is exactly what an opponent
   * could be holding.
   */
  unseenByValue(view) {
    const seen = new Map();
    const mark = (c) => seen.set(c.id, true);
    view.hand.forEach(mark);
    view.table.forEach(mark);
    view.me.captured.forEach(mark);
    view.others.forEach((o) => o.captured.forEach(mark));
    const counts = new Array(11).fill(0);
    let total = 0;
    for (const c of makeDeck()) {
      if (!seen.has(c.id)) { counts[c.value] += 1; total += 1; }
    }
    return { counts, total };
  }

  /**
   * Risk that the table left behind gifts the next player, on a 0..n scale in
   * the same units as comboWorth. `counting` switches between true unseen
   * counts (Pro) and a flat distribution (Intermediate).
   */
  tableRisk(tableAfter, view, counting) {
    if (!tableAfter.length) return 0;   // an empty table can only be laid into
    const { counts, total } = counting ? this.unseenByValue(view)
      : { counts: new Array(11).fill(4), total: 40 };
    if (!total) return 0;

    let risk = 0;
    // Escoba gift: one card of value (15 - tableSum) sweeps everything.
    const sum = sumValues(tableAfter);
    const sweepVal = 15 - sum;
    if (sweepVal >= 1 && sweepVal <= 10) {
      const pSweep = counts[sweepVal] / total;
      risk += pSweep * (1.2 + tableAfter.length * 0.25 + 1.0); // escoba point + haul
    }
    // Plain capture gifts: for each single-card value an opponent might hold,
    // the best combo it could take from this table.
    for (let v = 1; v <= 10; v++) {
      if (!counts[v]) continue;
      const fake = { id: '?', suit: 'x', rank: v, value: v };
      const opts = captureOptions(tableAfter, fake);
      if (!opts.length) continue;
      let best = 0;
      for (const combo of opts) {
        const w = combo.reduce((s, c) => s + cardWorth(c), 0);
        if (w > best) best = w;
      }
      risk += (counts[v] / total) * best * 0.55;
    }
    return risk;
  }

  pickSmart(moves, view, counting) {
    // Evaluate every legal move in the same units: a capture is its immediate
    // haul (plus the escoba point) minus the danger of the table left behind;
    // laying a card is pure danger plus the cost of giving up a good card.
    // Capturing is only mandatory for the card actually played, so laying a
    // capture-less card to dodge a trap stays on the menu.
    let best = null, bestScore = -Infinity;
    for (const m of moves) {
      let score;
      if (m.combo) {
        const after = view.table.filter((c) => !m.combo.includes(c));
        const escoba = after.length === 0 ? 1.2 : 0;
        score = comboWorth(m.card, m.combo) + escoba - this.tableRisk(after, view, counting);
      } else {
        const after = view.table.concat([m.card]);
        score = -this.tableRisk(after, view, counting) - cardWorth(m.card) * 0.5;
      }
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }
}

export default { AIAgent };
