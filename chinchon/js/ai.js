// ai.js — Chinchón AI agent. Synchronous heuristics over the meld engine.
//
// The agent implements the same interface the engine calls for the human:
//   chooseDraw(view) -> 'stock' | 'discard'
//   chooseDiscard(view) -> cardId
//   decideClose(view) -> boolean   (only called when the engine has verified canClose)
//
// "Thinking" delays are added by the UI, never here. Difficulty is a blunder
// rate: with some probability the agent takes a plausible-but-suboptimal move
// instead of the best one (never a catastrophic, meld-breaking move). This
// mirrors the Business Deal AI's tiering.

import * as meld from './meld.js';

const TIERS = {
  easy:   { blunder: 0.40, closeEagerness: 0.7 },
  normal: { blunder: 0.15, closeEagerness: 1.0 },
  hard:   { blunder: 0.00, closeEagerness: 1.0 },
};

export class AIAgent {
  constructor({ difficulty = 'normal', name = 'AI', rng } = {}) {
    this.isHuman = false;
    this.name = name;
    this.difficulty = TIERS[difficulty] ? difficulty : 'normal';
    this.tier = TIERS[this.difficulty];
    this.rng = rng || Math.random;
  }

  _blunder() { return this.rng() < this.tier.blunder; }

  /** Min deadwood achievable after adding `card` to `hand` and discarding one. */
  _deadwoodAfterAdd(hand, card, cfg) {
    const hand8 = hand.concat(card);
    let best = Infinity;
    for (let i = 0; i < hand8.length; i++) {
      const rest = hand8.slice(0, i).concat(hand8.slice(i + 1));
      best = Math.min(best, meld.bestDeadwood(rest, cfg));
    }
    return best;
  }

  /** Take the discard only when it strictly lowers our achievable deadwood. */
  chooseDraw(view) {
    const { config: cfg, hand, discardTop: top } = view;
    if (!top) return 'stock';
    const cur = meld.bestDeadwood(hand, cfg);
    const afterTake = this._deadwoodAfterAdd(hand, top, cfg);
    const helps = afterTake < cur;
    // Easy tier sometimes ignores a helpful discard and draws blind.
    if (helps && this._blunder()) return 'stock';
    return helps ? 'discard' : 'stock';
  }

  /** Discard to minimise remaining deadwood; ties dump the highest-value card. */
  chooseDiscard(view) {
    const { config: cfg, hand } = view;
    const scored = hand.map((c, i) => {
      const rest = hand.slice(0, i).concat(hand.slice(i + 1));
      return { id: c.id, dw: meld.bestDeadwood(rest, cfg), val: c.value };
    });
    scored.sort((a, b) => a.dw - b.dw || b.val - a.val);
    if (scored.length > 1 && this._blunder()) {
      // A plausible (near-best) discard — never one that wrecks the hand.
      const floor = scored[0].dw;
      const plausible = scored.filter((s) => s.dw <= floor + 2);
      return plausible[Math.floor(this.rng() * plausible.length)].id;
    }
    return scored[0].id;
  }

  /** The engine only asks when closing is legal; close eagerly (easy hesitates). */
  decideClose() {
    return this.rng() < this.tier.closeEagerness;
  }

  /** Manual place-cards: always take all the free deadwood reduction. */
  choosePlacements(view, lockedMelds, attachable) {
    return attachable.map((c) => c.id);
  }
}
