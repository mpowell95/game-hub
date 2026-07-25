// ai.js - pure Uno AI. Samples only from the engine's own getLegalMoves() list; every
// decision is a plain, replayable action object { type: 'play'|'draw', cardId?, color? }.
// Difficulty ids: easy/medium/hard (already mapped in js/difficulty-tiers.js).
//
// Stateless by construction (a pure function of game/playerIndex/difficulty/rng), with ONE
// optional read-only side channel: `memory` (see chooseAction). It is never required, so the
// AI stays trivially testable in a headless harness with no DOM (see uno/js/test.js).
//
// Easy   : uniform random over legal cards/colors.
// Medium : prefers the hand's majority colour, dumps non-numbers on a low opponent, holds
//          wilds until nothing else is legal (pickCard, difficulty 'medium').
// Hard   : a light Monte-Carlo planner (planHard). For each legal move it plays out
//          HARD_ROLLOUTS quick self-vs-self games and keeps the move with the best win
//          rate. The rollout POLICY is the same shaped heuristic Medium/Hard would play
//          (pickCard, difficulty 'hard': answer +2 stacks, chain Skip/Reverse for free 2p
//          turns, hold action cards until an opponent is low then aim them at the low seat,
//          prefer numbers otherwise, hold wilds) - so the requested Hard behaviours drive
//          every simulated line, and the rollout search on top lifts real strength well past
//          a pure-heuristic ceiling. Measured win rates are in uno/CLAUDE.md's AI notes and
//          are asserted (>=65% vs Easy, >=55% vs Medium, 500 games each) in uno/js/test.js.
//
// Why a planner and not just the heuristic: a pure-heuristic Hard topped out ~52% vs Medium
// in the same 500-game harness (Medium's majority-colour play is already strong), short of
// the 55% bar; the rollout planner clears both bars with a wide margin. See uno/CLAUDE.md.

import { COLORS, UnoGame } from './game.js';

const HARD_ROLLOUTS = 3; // playouts per candidate move (see uno/CLAUDE.md for the measured margin)

function handColorCounts(hand) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) if (counts[c.color] != null) counts[c.color]++;
  return counts;
}

function sample(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

/** First non-empty bucket of `cards` walking `order` (kind priority); the whole list if none match. */
function firstByKind(cards, order) {
  for (const k of order) { const g = cards.filter((c) => c.kind === k); if (g.length) return g; }
  return cards;
}

// Colours an OPPONENT (any seat but `playerIndex`) has forced with a wild, gathered from the
// optional per-game `memory` side channel. Hard uses these only as a tie-break away from
// handing an opponent back a colour it just chose (see pickWildColor).
function opponentForcedColors(memory, playerIndex) {
  if (!memory || !memory.byPlayer) return null;
  const avoid = {};
  for (const idx in memory.byPlayer) {
    if (Number(idx) === playerIndex) continue;
    for (const c in memory.byPlayer[idx]) avoid[c] = true;
  }
  return avoid;
}

function pickWildColor(restOfHand, rng, avoid) {
  const counts = handColorCounts(restOfHand);
  // My own colour strength dominates (weight 2); an opponent-forced colour costs a single
  // point, so `avoid` only ever breaks a tie between equally-strong colours - it never
  // overrides real strength. With no `avoid` (easy/medium) this is the original argmax.
  let best = COLORS[0], bestScore = -Infinity;
  for (const col of COLORS) {
    let score = counts[col] * 2;
    if (avoid && avoid[col]) score -= 1;
    if (score > bestScore) { bestScore = score; best = col; }
  }
  if (counts[best] > 0) return best;
  // I hold no coloured cards: pick a colour opponents have NOT been forcing, else random.
  if (avoid) { const fresh = COLORS.filter((c) => !avoid[c]); if (fresh.length) return sample(fresh, rng); }
  return sample(COLORS, rng);
}

// The shaped heuristic policy: Easy random; Medium majority-colour; Hard adds +2-stack
// answering, 2p Skip/Reverse tempo chaining, action-card holding + low-opponent targeting.
// Used directly for Easy/Medium play AND as the rollout policy inside planHard.
function pickCard(game, playerIndex, canPlay, difficulty, rng) {
  if (canPlay.length === 1) return canPlay[0];
  if (difficulty === 'easy') return sample(canPlay, rng);

  const hand = game.players[playerIndex].hand;
  const nonWild = canPlay.filter((c) => c.kind !== 'wild' && c.kind !== 'wild4');
  const wilds = canPlay.filter((c) => c.kind === 'wild' || c.kind === 'wild4');
  const numbers = nonWild.filter((c) => c.kind === 'number');
  const actions = nonWild.filter((c) => c.kind === 'skip' || c.kind === 'reverse' || c.kind === 'draw2');
  const opponents = game.players.map((p, i) => ({ i, len: p.hand.length })).filter((o) => o.i !== playerIndex);
  const lowestOpp = opponents.reduce((a, b) => (b.len < a.len ? b : a), opponents[0]);
  const someoneLow = opponents.some((o) => o.len <= 2);

  const counts = handColorCounts(hand);
  const majority = COLORS.reduce((a, b) => (counts[b] > counts[a] ? b : a), COLORS[0]);
  const majorityNumbers = numbers.filter((c) => c.color === majority);

  if (difficulty === 'hard') {
    // (a) Always answer an active +2 stack with a +2 - never voluntarily eat the pile.
    if (game.pendingDraw > 0) {
      const twos = canPlay.filter((c) => c.kind === 'draw2');
      if (twos.length) return sample(twos, rng);
    }

    if (game.n === 2) {
      // 2 players: a Skip or Reverse (Reverse acts as Skip at 2p) hands the turn straight
      // back to me at zero risk - a free extra card toward emptying my hand first - so I
      // spend them the instant they're legal and chain plays.
      const skipsRev = actions.filter((c) => c.kind === 'skip' || c.kind === 'reverse');
      if (skipsRev.length) return sample(skipsRev, rng);
      // A +2 also returns the turn to me IF unanswered, but the opponent will always answer
      // with a +2 when it holds one (getLegalMoves forces it), so a lone +2 can start a
      // stacking war I then lose. Only spend a +2 to punish a low opponent, or when I hold
      // two+ (enough to win the war and still keep tempo).
      const twos = actions.filter((c) => c.kind === 'draw2');
      if (twos.length && (someoneLow || twos.length >= 2)) return sample(twos, rng);
      // Otherwise keep the +2 and wilds in reserve; burn a number, my strongest colour first.
      if (majorityNumbers.length) return sample(majorityNumbers, rng);
      if (numbers.length) return sample(numbers, rng);
      if (twos.length) return sample(twos, rng); // only +2s / wilds left - prefer a +2 over a wild
    } else {
      // 3-4 players: a Skip/Reverse structurally only affects "whoever is next" - it cannot
      // be aimed at an arbitrary seat - so an action card is only worth spending when the
      // seat it WOULD hit (the next player) is a genuine low-card threat. Otherwise hold the
      // weapons and play a number, keeping my majority colour alive.
      const nextIdx = game.peekNext(1);
      if (lowestOpp.len <= 2 && nextIdx === lowestOpp.i && actions.length) {
        return sample(firstByKind(actions, ['draw2', 'skip', 'reverse']), rng);
      }
      if (majorityNumbers.length) return sample(majorityNumbers, rng);
      if (numbers.length) return sample(numbers, rng);
      // Only actions / wilds remain - fall through to the shared logic below.
    }
  }

  // Shared medium/hard fallback: dump non-numbers on a low opponent, else keep the majority
  // colour, else any non-wild, holding wilds until nothing else is legal.
  if (someoneLow) {
    const dumps = nonWild.filter((c) => c.kind !== 'number');
    if (dumps.length) return sample(dumps, rng);
  }
  const majorityCards = nonWild.filter((c) => c.color === majority);
  if (majorityCards.length) return sample(majorityCards, rng);
  if (nonWild.length) return sample(nonWild, rng);
  return sample(wilds, rng);
}

// One policy decision inside a rollout (mirrors chooseAction, minus the memory tie-break).
function rolloutAction(game, pi, rng) {
  const legal = game.getLegalMoves(pi);
  if (legal.canPlay.length === 0) return { type: 'draw' };
  const card = pickCard(game, pi, legal.canPlay, 'hard', rng);
  const action = { type: 'play', cardId: card.id };
  if (card.kind === 'wild' || card.kind === 'wild4') {
    action.color = pickWildColor(game.players[pi].hand.filter((c) => c.id !== card.id), rng, null);
  }
  return action;
}

// Play a cloned game to the end under the rollout policy; return true iff `meSeat` wins.
function rolloutWin(game, meSeat, rng) {
  let guard = 0;
  while (game.phase !== 'over' && guard++ < 2000) {
    if (game.phase === 'chooseColor') {
      const ch = game.pendingWild.playerIndex;
      game.chooseColor(ch, pickWildColor(game.players[ch].hand, rng, null));
      continue;
    }
    const pi = game.currentPlayer;
    const act = rolloutAction(game, pi, rng);
    if (act.type === 'draw') {
      const res = game.draw(pi);
      if (res.forcedPlay) {
        const c = game.players[pi].hand.find((x) => x.id === res.forcedPlay);
        const col = (c.kind === 'wild' || c.kind === 'wild4')
          ? pickWildColor(game.players[pi].hand.filter((x) => x.id !== res.forcedPlay), rng, null) : undefined;
        game.play(pi, res.forcedPlay, col);
      }
    } else {
      game.play(pi, act.cardId, act.color);
    }
  }
  return game.winner === meSeat;
}

// Hard's decision: Monte-Carlo over legal moves. Clones share the caller's rng so the whole
// search is a pure, reproducible function of the seed (the engine's reshuffles inside a
// rollout draw from clone.rng, which we pin to `rng`).
function planHard(game, playerIndex, canPlay, rng, memory) {
  if (canPlay.length === 1) return { card: canPlay[0] };
  if (game.players[playerIndex].hand.length === 1) return { card: canPlay[0] }; // any legal card wins now
  const avoid = opponentForcedColors(memory, playerIndex);
  const snap = game.snapshot();
  let best = null, bestWins = -1;
  for (const c of canPlay) {
    const color = (c.kind === 'wild' || c.kind === 'wild4')
      ? pickWildColor(game.players[playerIndex].hand.filter((x) => x.id !== c.id), rng, avoid) : undefined;
    let wins = 0;
    for (let r = 0; r < HARD_ROLLOUTS; r++) {
      const clone = UnoGame.fromSnapshot(snap, { rng });
      try { clone.play(playerIndex, c.id, color); if (rolloutWin(clone, playerIndex, rng)) wins++; } catch { /* skip an illegal branch */ }
    }
    if (wins > bestWins) { bestWins = wins; best = { card: c, color }; }
  }
  return best || { card: canPlay[0] };
}

/** @param memory optional per-game side channel: `{ byPlayer: { [seat]: { [color]: true } } }`
 *  of colours each seat has forced with a wild. Read-only, Hard-only, and purely a tie-break
 *  in wild-colour selection; omit it entirely and play is unchanged apart from that tweak. */
export function chooseAction(game, playerIndex, difficulty, rng, memory) {
  rng = rng || Math.random;
  const legal = game.getLegalMoves(playerIndex);
  if (legal.canPlay.length === 0) return { type: 'draw' };

  if (difficulty === 'hard') {
    const plan = planHard(game, playerIndex, legal.canPlay, rng, memory);
    const action = { type: 'play', cardId: plan.card.id };
    if (plan.color) action.color = plan.color;
    else if (plan.card.kind === 'wild' || plan.card.kind === 'wild4') {
      action.color = pickWildColor(
        game.players[playerIndex].hand.filter((c) => c.id !== plan.card.id), rng,
        opponentForcedColors(memory, playerIndex));
    }
    return action;
  }

  const card = pickCard(game, playerIndex, legal.canPlay, difficulty, rng);
  const action = { type: 'play', cardId: card.id };
  if (card.kind === 'wild' || card.kind === 'wild4') {
    action.color = pickWildColor(game.players[playerIndex].hand.filter((c) => c.id !== card.id), rng, null);
  }
  return action;
}
