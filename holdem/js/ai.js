// ai.js - computer players. Pure; reads only what a real player at the table could see: its own
// two cards, the board, the pot, the bets and how many opponents are still in. It never looks at
// anyone else's hole cards or the deck (the state object has them, the bot does not read them).
//
// Strength is a Monte Carlo equity: deal the unseen cards at random a few hundred times and count
// how often this hand wins against that many random hands. Skill sets how many samples, how much
// noise sits on the estimate, how tight the calls are and how often it bluffs.

import { evaluate, legal, potTotal } from './engine.js';

// `commit` is the extra equity a bot wants before calling off most of its stack. It used to be
// 0.12 x skill, so Hard demanded ~90% equity to call an all-in and folded nearly everything to one:
// "all in every hand" beat one Hard computer 91% of the time (2026-10-10, King of Games ran a
// $25,000 bankroll to $50M that way). Now a better bot is LESS scared of a shove, as it should be,
// and Hard calls a shove on the price alone, a little looser than break-even (Matt: "over correct
// it"). holdem/js/test.js fails if shoving every hand beats a Hard computer again.
// 4 = Brutal: only ever used against a rigged player (see `peek` in decide()).
const SKILL = {
  1: { sims: 90, noise: 0.22, callMargin: -0.08, betRel: 1.55, raiseRel: 2.1, bluff: 0.03, looseCall: 0.22, commit: 0.08 },
  2: { sims: 220, noise: 0.08, callMargin: -0.02, betRel: 1.35, raiseRel: 1.8, bluff: 0.07, looseCall: 0.06, commit: 0.02 },
  3: { sims: 420, noise: 0.03, callMargin: -0.05, betRel: 1.25, raiseRel: 1.6, bluff: 0.12, looseCall: 0.0, commit: 0 },
  4: { sims: 500, noise: 0, callMargin: -0.08, betRel: 1.15, raiseRel: 1.45, bluff: 0.15, looseCall: 0.0, commit: 0 },
};

/** Share of the pot this hand wins against `nOpp` random hands, 0..1 (ties split). `known` is a
 *  list of opponents' actual hole cards, played as they are instead of at random (the rig). */
export function equity(hole, board, nOpp, sims, rand = Math.random, known = []) {
  const used = new Set([...hole, ...board, ...known.flat()]);
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
    for (const k of known) {
      const theirs = evaluate([k[0], k[1], ...full]);
      if (theirs > mine) { best = false; break; }
      if (theirs === mine) ties++;
    }
    for (let o = 0; best && o < nOpp; o++) {
      const b = needBoard + o * 2;
      const theirs = evaluate([rest[b], rest[b + 1], ...full]);
      if (theirs > mine) { best = false; break; }
      if (theirs === mine) ties++;
    }
    if (best) won += 1 / ties;
  }
  return won / sims;
}

/** Choose an action for the player to act. Returns { a, to? }.
 *  `opts.peek` (2026-10-10, Matt: "rig it against him"): the seat of a RIGGED player. While that
 *  player is still in the hand, this bot plays Brutal (skill 4) and reads that player's two cards
 *  as they really are. The one place a bot looks at another hand, and only for a seat ui.js names. */
export function decide(state, skill = 2, rand = Math.random, opts = {}) {
  const L = legal(state);
  if (!L) return { a: 'fold' };
  const h = state.hand;
  const i = L.i;
  const peek = opts && Number.isInteger(opts.peek) && opts.peek >= 0 && opts.peek !== i
    && !h.folded[opts.peek] && h.holes && h.holes[opts.peek] ? opts.peek : -1;
  const S = peek >= 0 ? SKILL[4] : (SKILL[skill] || SKILL[2]);
  const me = state.players[i];
  const opps = state.players.map((_, j) => j).filter((j) => j !== i && !h.folded[j]);
  const nOpp = Math.max(1, opps.length);
  const known = peek >= 0 ? [h.holes[peek]] : [];
  let eq = equity(h.holes[i], h.board, Math.max(0, opps.length - known.length), S.sims, rand, known);
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
  // A bot that can see the rigged player's cards never bluffs into a hand that beats it.
  const bluffing = rand() < S.bluff && nOpp <= 3 && late && !(peek >= 0 && eq < 0.5);

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
  const commit = stackShare > 0.45 ? S.commit : 0;

  if (L.canRaise && rel >= S.raiseRel && eq > 0.3) {
    if (eq > 0.8 && rand() < 0.35) return { a: 'raise', to: L.maxTo };
    return { a: 'raise', to: sizeTo(0.7 + rand() * 0.3) };
  }
  if (eq >= potOdds + S.callMargin + commit) return { a: 'call' };
  if (call <= bb * 3 && rand() < S.looseCall) return { a: 'call' };
  return { a: 'fold' };
}

export default { decide, equity };
