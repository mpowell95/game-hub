// ai.js - pure Uno AI. Samples only from the engine's own getLegalMoves() list; every
// decision is a plain, replayable action object { type: 'play'|'draw', cardId?, color? }.
// Difficulty ids: easy/medium/hard (already mapped in js/difficulty-tiers.js).

import { COLORS } from './game.js';

function handColorCounts(hand) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const c of hand) if (counts[c.color] != null) counts[c.color]++;
  return counts;
}

function pickWildColor(restOfHand, rng) {
  const counts = handColorCounts(restOfHand);
  let best = null, bestN = -1;
  for (const col of COLORS) if (counts[col] > bestN) { bestN = counts[col]; best = col; }
  if (bestN > 0) return best;
  return COLORS[Math.floor(rng() * COLORS.length)];
}

function pickCard(game, playerIndex, canPlay, difficulty, rng) {
  if (canPlay.length === 1) return canPlay[0];
  if (difficulty === 'easy') return canPlay[Math.floor(rng() * canPlay.length)];

  const hand = game.players[playerIndex].hand;
  const nonWild = canPlay.filter((c) => c.kind !== 'wild' && c.kind !== 'wild4');
  const wilds = canPlay.filter((c) => c.kind === 'wild' || c.kind === 'wild4');
  const opponents = game.players.map((p, i) => ({ i, len: p.hand.length })).filter((o) => o.i !== playerIndex);
  const lowestOpp = opponents.reduce((a, b) => (b.len < a.len ? b : a), opponents[0]);
  const someoneLow = opponents.some((o) => o.len <= 2);

  if (difficulty === 'hard') {
    // Prefer a +2 to keep answering an active stack (avoid ever eating the pile).
    if (game.pendingDraw > 0) {
      const twos = canPlay.filter((c) => c.kind === 'draw2');
      if (twos.length) return twos[Math.floor(rng() * twos.length)];
    }
    // Target skips/reverses/+2s at whichever opponent is about to go and is lowest on cards.
    const nextIdx = game.peekNext(1);
    if (nextIdx === lowestOpp.i) {
      const targeted = nonWild.filter((c) => c.kind === 'skip' || c.kind === 'reverse' || c.kind === 'draw2');
      if (targeted.length) return targeted[Math.floor(rng() * targeted.length)];
    }
    // Play a +2 straight at the lowest opponent even off-target, still useful pressure.
    if (nextIdx === lowestOpp.i || lowestOpp.len <= 2) {
      const twos = nonWild.filter((c) => c.kind === 'draw2');
      if (twos.length) return twos[Math.floor(rng() * twos.length)];
    }
  }

  if (someoneLow) {
    const dumps = nonWild.filter((c) => c.kind !== 'number');
    if (dumps.length) return dumps[Math.floor(rng() * dumps.length)];
  }

  const counts = handColorCounts(hand);
  const majority = COLORS.reduce((a, b) => (counts[b] > counts[a] ? b : a), COLORS[0]);
  const majorityCards = nonWild.filter((c) => c.color === majority);
  if (majorityCards.length) return majorityCards[Math.floor(rng() * majorityCards.length)];

  if (nonWild.length) return nonWild[Math.floor(rng() * nonWild.length)];

  // Hold wilds until nothing else is legal (already true here: only wilds remain).
  // Hard also avoids choosing a color that would strand itself with a single-color
  // hand next turn - pickWildColor already prefers hand majority, which is the same
  // heuristic; nothing further to do at the card-selection step.
  return wilds[Math.floor(rng() * wilds.length)];
}

export function chooseAction(game, playerIndex, difficulty, rng) {
  rng = rng || Math.random;
  const legal = game.getLegalMoves(playerIndex);
  if (legal.canPlay.length === 0) return { type: 'draw' };

  const card = pickCard(game, playerIndex, legal.canPlay, difficulty, rng);
  const action = { type: 'play', cardId: card.id };
  if (card.kind === 'wild' || card.kind === 'wild4') {
    const rest = game.players[playerIndex].hand.filter((c) => c.id !== card.id);
    action.color = pickWildColor(rest, rng);
  }
  return action;
}
