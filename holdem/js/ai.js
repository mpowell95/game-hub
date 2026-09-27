// ai.js - computer players. Pure; reads only what a real player at the table could see: its own
// two cards, the board, the pot, the bets and how many opponents are still in. It never looks at
// anyone else's hole cards or the deck (the state object has them, the bot does not read them).
//
// Strength is a Monte Carlo equity: deal the unseen cards at random a few hundred times and count
// how often this hand wins against that many random hands. Skill sets how many samples, how much
// noise sits on the estimate, how tight the calls are and how often it bluffs.

import { evaluate, legal, potTotal } from './engine.js';

const SKILL = {
  1: { sims: 90, noise: 0.22, callMargin: -0.08, betRel: 1.55, raiseRel: 2.1, bluff: 0.03, looseCall: 0.22 },
  2: { sims: 220, noise: 0.08, callMargin: 0.02, betRel: 1.35, raiseRel: 1.8, bluff: 0.07, looseCall: 0.06 },
  3: { sims: 420, noise: 0.03, callMargin: 0.04, betRel: 1.25, raiseRel: 1.6, bluff: 0.12, looseCall: 0.0 },
};

/** Share of the pot this hand wins against `nOpp` random hands, 0..1 (ties split). */
export function equity(hole, board, nOpp, sims, rand = Math.random) {
  const used = new Set([...hole, ...board]);
  const rest = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  const needBoard = 5 - board.length;
  let won = 0;
  for (let s = 0; s < sims; s++) {
    // partial Fisher-Yates: only as many cards as this sample needs
    const need = needBoard + nOpp * 2;
    for (let k = 0; k < need; k++) {
      const j = k + Math.floor(rand() * (rest.length - k));
      const t = rest[k]; rest[k] = rest[j]; rest[j] = t;
    }
    const full = board.concat(rest.slice(0, needBoard));
    const mine = evaluate(hole.concat(full));
    let best = true, ties = 1;
    for (let o = 0; o < nOpp; o++) {
      const b = needBoard + o * 2;
      const theirs = evaluate([rest[b], rest[b + 1], ...full]);
      if (theirs > mine) { best = false; break; }
      if (theirs === mine) ties++;
    }
    if (best) won += 1 / ties;
  }
  return won / sims;
}

/** Choose an action for the player to act. Returns { a, to? }. */
export function decide(state, skill = 2, rand = Math.random) {
  const L = legal(state);
  if (!L) return { a: 'fold' };
  const h = state.hand;
  const i = L.i;
  const S = SKILL[skill] || SKILL[2];
  const me = state.players[i];
  const nOpp = Math.max(1, state.players.filter((_, j) => j !== i && !h.folded[j]).length);
  let eq = equity(h.holes[i], h.board, nOpp, S.sims, rand);
  eq = Math.min(1, Math.max(0, eq + (rand() * 2 - 1) * S.noise));
  const rel = eq * (nOpp + 1);          // 1.0 = an average hand in this field
  const pot = potTotal(h);
  const call = L.callAmt;
  const bb = h.bb;
  const unit = Math.max(1, h.sb);
  const round = (x) => Math.round(x / unit) * unit;
  const sizeTo = (frac) => {
    let to;
    if (h.street === 'preflop' && h.currentBet <= bb) to = h.currentBet + round(bb * (2 + frac * 2) + (pot - h.sb - bb) * 0.5);
    else to = h.currentBet + round(Math.max(h.minRaise, (pot + call) * frac));
    to = Math.max(L.minTo, Math.min(L.maxTo, to));
    if (to >= L.maxTo * 0.85) to = L.maxTo;       // this much of the stack: just shove
    return to;
  };
  const late = h.street !== 'preflop';
  const bluffing = rand() < S.bluff && nOpp <= 3 && late;

  if (L.canCheck) {
    if (L.canRaise && (rel >= S.betRel || bluffing)) {
      const frac = rel > 2.2 ? 0.8 : (bluffing ? 0.5 : 0.6);
      return { a: 'raise', to: sizeTo(frac + rand() * 0.2) };
    }
    return { a: 'check' };
  }

  const potOdds = call / (pot + call);
  const stackShare = call / Math.max(1, me.chips);
  // Calling off most of a stack needs a real hand, not just the price.
  const commit = stackShare > 0.45 ? 0.12 * skill : 0;

  if (L.canRaise && rel >= S.raiseRel && eq > 0.3) {
    if (eq > 0.8 && rand() < 0.35) return { a: 'raise', to: L.maxTo };
    return { a: 'raise', to: sizeTo(0.7 + rand() * 0.3) };
  }
  if (eq >= potOdds + S.callMargin + commit) return { a: 'call' };
  if (call <= bb * 3 && rand() < S.looseCall) return { a: 'call' };
  return { a: 'fold' };
}

export default { decide, equity };
