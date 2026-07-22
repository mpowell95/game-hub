// ai.js - Filler AI, three tiers mapped from the shared profile skill (1-3):
//   1 Beginner:     mostly a random capturing color, only sometimes the best one.
//   2 Intermediate: best immediate capture.
//   3 Pro:          my move, the opponent's greedy reply, my best follow-up,
//                   plus a small frontier bonus for keeping the territory open.

import { legalColors, captureGain, cloneGame, applyMove, opponentOf, frontierSize } from './game.js';

/** Pick a color for the side to move in `s`. `level` is 1..3. */
export function chooseColor(s, level, rng = Math.random) {
  const options = legalColors(s);
  if (!options.length) return -1;   // unreachable with 6 colors; kept as a guard
  if (level <= 1) return beginner(s, options, rng);
  if (level === 2) return greedy(s, options, rng);
  return pro(s, options, rng);
}

function gainsFor(s, options) {
  const player = s.turn;
  return options.map((color) => ({ color, gain: captureGain(s, player, color) }));
}

function beginner(s, options, rng) {
  const gains = gainsFor(s, options);
  gains.sort((a, b) => b.gain - a.gain);
  if (rng() < 0.35) return gains[0].color;
  const capturing = gains.filter((g) => g.gain > 0);
  const pool = capturing.length ? capturing : gains;
  return pool[Math.floor(rng() * pool.length)].color;
}

function greedy(s, options, rng) {
  const gains = gainsFor(s, options);
  let best = -1;
  for (const g of gains) if (g.gain > best) best = g.gain;
  const top = gains.filter((g) => g.gain === best);
  return top[Math.floor(rng() * top.length)].color;
}

function pro(s, options, rng) {
  const me = s.turn;
  const opp = opponentOf(me);
  // Restrict to the colors that capture the most RIGHT NOW: a capture is always
  // strictly good in Filler (it only grows your territory, never a downside), so
  // it must never lose out to a captureless move. The 0.2 frontier bonus below is
  // meant to be a tie-breaker among equally-good captures, but its magnitude (the
  // frontier can be 10-40 tiles) dwarfs a real capture gain of 1-2 tiles, so
  // comparing it across the full option set let a captureless "grow the frontier"
  // move outscore an actual, available capture - including the move that would
  // legitimately end the game. That was FILLER-1: the AI would cycle through every
  // captureless color instead of the one closing tile it could still reach, until
  // the dry-move stalemate guard force-ended the game with the board unfilled.
  const gains = options.map((color) => ({ color, gain: captureGain(s, me, color) }));
  let maxGain = -Infinity;
  for (const g of gains) if (g.gain > maxGain) maxGain = g.gain;
  const candidates = gains.filter((g) => g.gain === maxGain).map((g) => g.color);
  let bestValue = -Infinity;
  let best = [];
  for (const color of candidates) {
    const sim = cloneGame(s);
    applyMove(sim, color);
    let value;
    if (sim.over) {
      value = sim.winner === me ? 1000 : sim.winner === 0 ? 0 : -1000;
    } else {
      // Opponent answers greedily, then I take my best available capture.
      const reply = greedy(sim, legalColors(sim), rng);
      applyMove(sim, reply);
      let followUp = 0;
      if (!sim.over) {
        for (const c3 of legalColors(sim)) {
          const g = captureGain(sim, me, c3);
          if (g > followUp) followUp = g;
        }
      }
      value = (sim.counts[me] + followUp) - sim.counts[opp] + 0.2 * frontierSize(sim, me);
    }
    if (value > bestValue + 1e-9) { bestValue = value; best = [color]; }
    else if (value > bestValue - 1e-9) best.push(color);
  }
  return best[Math.floor(rng() * best.length)];
}

export default { chooseColor };
