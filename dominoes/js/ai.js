// dominoes/js/ai.js — the three bot tiers. PURE: given a game and a seat, return one legal move
// (or null). No DOM, no timers — the "Bot thinking" pause is pacing and lives in ui.js.
//
//   easy    a random legal move.
//   medium  the highest-scoring move this turn; ties broken by playing the heaviest tile, so it
//           sheds pips instead of hoarding them.
//   hard    medium's score, minus what it would hand back: it looks one ply ahead at the best
//           score ANY tile it has not seen could make on the ends it is about to leave, and it
//           leans on the ends the opponent has already passed or drawn on (game.js's `voids`),
//           which is the only real information a dominoes player ever gets.

import { TILES, tileSum, isDouble, countAfter, scoreOf, legalMoves, placeOn, openEnds } from './game.js';

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

const cloneChain = (g) => ({
  line: g.line.map((e) => ({ ...e })),
  up: g.up.map((e) => ({ ...e })),
  down: g.down.map((e) => ({ ...e })),
  spinnerId: g.spinnerId,
  originId: g.originId,
});

/** Tiles the bot cannot see: the full set minus its own hand minus everything on the board. From
 *  the bot's seat these are exactly the opponent's hand plus the boneyard, which is the honest
 *  information set — it never peeks at hands[1 - seat]. */
function unseen(g, seat) {
  const seen = new Set(g.hands[seat]);
  for (const e of g.line) seen.add(e.id);
  for (const e of g.up) seen.add(e.id);
  for (const e of g.down) seen.add(e.id);
  const out = [];
  for (let id = 0; id < TILES.length; id++) if (!seen.has(id)) out.push(id);
  return out;
}

/** The best single score the opponent could make on `chain`, over tiles the bot has not seen.
 *  A cap, not a prediction — the opponent may not hold any of them. */
function bestReplyScore(chain, pool) {
  let best = 0;
  for (const id of pool) {
    for (const m of legalMoves(chain, [id])) {
      const s = scoreOf(countAfter(chain, m));
      if (s > best) best = s;
    }
  }
  return best;
}

/** How many of the ends this move leaves are values the opponent is KNOWN to be missing. Each
 *  one is a real chance the opponent has to draw or pass. */
function blockValue(chain, voids) {
  if (!voids || !voids.length) return 0;
  let n = 0;
  for (const e of openEnds(chain)) if (e.value != null && voids.indexOf(e.value) >= 0) n += 1;
  return n;
}

function pickHeaviest(moves) {
  let best = moves[0];
  for (const m of moves) {
    const a = tileSum(m.tileId), b = tileSum(best.tileId);
    if (a > b || (a === b && isDouble(m.tileId) && !isDouble(best.tileId))) best = m;
  }
  return best;
}

/** One move for `seat`, or null if there is nothing legal (the caller then draws or passes). */
export function chooseMove(g, seat, difficulty, rnd = Math.random) {
  const moves = g.legalMoves(seat);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];

  if (difficulty === 'easy') return moves[Math.floor(rnd() * moves.length)];

  const scored = moves.map((m) => ({ m, score: scoreOf(countAfter(g.chain, m)) }));
  const top = Math.max(...scored.map((s) => s.score));

  if (difficulty !== 'hard') {
    return pickHeaviest(scored.filter((s) => s.score === top).map((s) => s.m));
  }

  const pool = unseen(g, seat);
  const oppVoids = g.voids[1 - seat] || [];
  const goingOut = g.hands[seat].length === 1;          // this move ends the round: nothing comes back
  let best = null, bestVal = -Infinity;
  for (const { m, score } of scored) {
    const sim = cloneChain(g);
    placeOn(sim, m.tileId, m.side);
    // Weights: the opponent's reply is worth less than my own points because they may not hold
    // the tile at all; shedding pips matters because they become the opponent's bonus if I lose
    // the round; a known void is worth about half a scoring play.
    const reply = goingOut ? 0 : bestReplyScore(sim, pool) * 0.55;
    const val = score - reply + blockValue(sim, oppVoids) * 2.5 + tileSum(m.tileId) * 0.12;
    if (val > bestVal) { bestVal = val; best = m; }
  }
  return best;
}

export default { chooseMove, DIFFICULTIES };
