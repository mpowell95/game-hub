// battle-arena/js/cpu.js - the computer. Pure: (state, level, rand) -> move. No DOM, no clock.
//   easy   any legal swap
//   medium the best single swap by what it clears at once: energy to its monsters (more as a bar
//          nears full, a lot for one that fills), berries, a 4-match's extra move, bombs defused
//   hard   plans its whole turn (evolving included) on many GUESSED falls, scores where each plan
//          leaves both teams, and marks down what the other side could do next (2026-11-22)
// `rand` is the caller's (the UI's Math.random, the soak's seeded one); the match's own RNG is
// never touched, so the computer cannot change the board it is thinking about.
import { apply, legalMoves, previewSwap, evolveOptions } from './engine.js';
import { BY_ID, specialOf, costOf, BERRIES_TO_EVOLVE } from './monsters.js';

export const LEVELS = ['easy', 'medium', 'hard'];
/** Hard's search (2026-11-22, Matt: "So fix the difficulty"; it beat Medium only 59%). The falls are guessed, so the size of
 *  the guess sample matters most: 2 guesses beat Medium 59%, 6 72%, 12 77%. Measured over 400 matches each (Medium both
 *  sides swapped): GUESSES 12, FIRST 5, SECOND 2, REPLY 2 = 77% at ~76 ms a move on a laptop. */
const HARD_GUESSES = 12, HARD_FIRST = 5, HARD_SECOND = 2, HARD_REPLY = 2;
/** How much of the other side's best next move Hard counts against a plan (0 = ignore it: 65% instead of 77%). */
const HARD_REPLY_WEIGHT = 0.8;

/** What a special is worth, roughly in HP. */
function specialValue(id, evo, rv) {
  const sp = specialOf(id, evo, rv || 1);
  return (sp.dmg || 0) + (sp.heal || 0) * 0.7 + (sp.shield || 0) * 0.7 + (sp.drain || 0) * 2
    + (sp.freeze ? 6 : 0) + (sp.chain || 0) * 2 + (sp.curse ? sp.curse.tick * sp.curse.turns : 0)
    + (sp.rows ? 4 * sp.rows : 0) + (sp.convert ? sp.convert : 0);
}

/** What each of `side`'s monsters would gain from cleared `counts` (the engine's charge rule, per rules version: from v3 two
 *  monsters of one element SHARE the gems, the fuller one first). Rainbit gains 1 per 2 gems of any element. */
function gainsFor(state, side, counts, total) {
  const mons = state.sides[side].mons, rv = state.rv || 1;
  const gains = mons.map((m) => { const el = BY_ID[m.id].el; return el === 'all' ? Math.floor((m.part + total) / 2) : (counts[el] || 0); });
  if (rv >= 3) {
    for (const el of Object.keys(counts)) {
      const same = mons.map((m, mi) => ({ m, mi })).filter((x) => BY_ID[x.m.id].el === el);
      if (same.length < 2) continue;
      same.sort((a, b) => b.m.energy / costOf(b.m.id, rv) - a.m.energy / costOf(a.m.id, rv) || a.mi - b.mi);
      let left = counts[el];
      for (const x of same) { const g = Math.min(left, Math.max(0, costOf(x.m.id, rv) - x.m.energy)); gains[x.mi] = g; left -= g; }
    }
  }
  return gains;
}

/** Medium's eye: the first step of a swap, scored for `side`. */
export function scorePreview(state, side, p) {
  if (!p) return -Infinity;
  const sd = state.sides[side];
  let score = 0;
  const total = Object.values(p.counts).reduce((a, b) => a + b, 0);
  const gains = gainsFor(state, side, p.counts, total);
  for (const [mi, m] of sd.mons.entries()) {
    const gain = gains[mi];
    if (!gain) continue;
    const cost = costOf(m.id, state.rv || 1);
    score += gain * (1 + 2 * (m.energy / cost));
    if (m.energy + gain >= cost && !m.went) score += 8 + specialValue(m.id, m.evo, state.rv);   // v4: once a turn
  }
  if (p.berries && sd.mons.some((m) => !m.evo)) {
    score += p.berries * (sd.berries + p.berries >= BERRIES_TO_EVOLVE ? 7 : 2.5);
  }
  if (p.maxRun >= 4) score += 7;
  for (const n of p.bombs) score += 2 + Math.max(0, 4 - n);
  score += p.size * 0.15;
  return score;
}

function bestPreview(state, side) {
  let best = -Infinity;
  for (const m of legalMoves(state)) {
    const v = scorePreview(state, side, previewSwap(state, m.a, m.b));
    if (v > best) best = v;
  }
  return best;
}

/** Which monster to evolve: the one closer to a full bar. */
export function chooseEvolve(state, side) {
  const mons = state.sides[side].mons;
  let best = -1, bestFill = -1;
  mons.forEach((m, i) => {
    if (m.evo) return;
    const f = m.energy / costOf(m.id, state.rv || 1);
    if (f > bestFill) { bestFill = f; best = i; }
  });
  return best;
}

export function chooseMove(state, level, rand = Math.random) {
  const side = state.turn;
  if (level === 'hard') {
    const mv = hardMove(state, side, rand);
    if (mv) return mv;
  }
  // Evolving costs a move; Easy and Medium take it when they can (Easy only half the time). Hard weighs it like any move.
  const evo = evolveOptions(state);
  if (evo.length && (level !== 'easy' || rand() < 0.5)) return { type: 'evolve', mon: chooseEvolve(state, side) };
  const moves = legalMoves(state);
  if (!moves.length) return null;
  const swap = (m) => ({ type: 'swap', a: m.a, b: m.b });
  if (level === 'easy') return swap(moves[Math.floor(rand() * moves.length)]);

  let best = null, bestV = -Infinity;
  for (const m of moves) {
    let v = scorePreview(state, side, previewSwap(state, m.a, m.b));
    v += rand() * 0.5;          // break ties without always picking the top-left swap
    if (v > bestV) { bestV = v; best = m; }
  }
  return swap(best || moves[0]);
}

// --- HARD ---------------------------------------------------------------------------------------------------
// NO PEEKING (2026-11-14, Matt: "are you just calculating it so the robot gets luckier than me?"): every look ahead runs on
// GUESSED falls (a seed drawn from `rand`, never the match's own), so it sees the board exactly as the player does. It plays
// better FAIRLY (2026-11-22) by guessing many times and planning the whole turn: its best first moves (Medium's eye, plus
// evolving), each on HARD_GUESSES guessed boards, then its best follow-ups, scored by where the turn leaves both teams minus
// the other side's best reply.

/** Where `side` stands, roughly in HP: HP, shield, each bar's progress toward its special, an evolution, berries, a curse. */
function sideValue(st, side) {
  const sd = st.sides[side], rv = st.rv || 1;
  let v = sd.hp + sd.shield * 0.7;
  for (const m of sd.mons) {
    const cost = costOf(m.id, rv), f = Math.min(1, m.energy / cost), val = specialValue(m.id, m.evo, rv);
    v += val * (m.energy >= cost ? 0.85 : 0.6 * f * f + 0.1 * f);
    if (m.evo) v += 0.35 * (specialValue(m.id, true, rv) - specialValue(m.id, false, rv)) + 4;
  }
  if (sd.mons.some((m) => !m.evo)) v += Math.min(sd.berries, BERRIES_TO_EVOLVE) * (sd.berries >= BERRIES_TO_EVOLVE ? 3 : 1.8);
  v -= sd.curse.left * sd.curse.tick;
  if (sd.frozen) v -= 6;
  return v;
}

function evalFor(st, side) {
  if (st.winner != null) return st.winner === side ? 1000 : -1000;
  return sideValue(st, side) - sideValue(st, 1 - side);
}

/** The same match on a guessed future: only the seed that decides the falls is replaced. */
const guessOf = (st, rand) => ({ ...st, rng: (Math.floor(rand() * 4294967296) >>> 0) || 1 });

/** `side`'s best `k` swaps by Medium's eye, plus every evolve on offer. */
function candidates(st, side, k) {
  const out = legalMoves(st).map((m) => ({ mv: { type: 'swap', a: m.a, b: m.b }, p: scorePreview(st, side, previewSwap(st, m.a, m.b)) }))
    .sort((x, y) => y.p - x.p).slice(0, k);
  for (const mi of evolveOptions(st)) out.push({ mv: { type: 'evolve', mon: mi } });
  return out;
}

/** What the side now on turn gains with its best move (its few best picks, each played on one guess). */
function replyGain(st, rand) {
  const opp = st.turn, base = evalFor(st, opp);
  let best = 0;
  for (const { mv } of candidates(st, opp, HARD_REPLY)) {
    const r = apply(guessOf(st, rand), mv);
    if (r.ok) best = Math.max(best, evalFor(r.state, opp) - base);
  }
  return best;
}

/** A position's worth to `side`: its turn over = the score minus the reply; still its turn = its best follow-up. */
function planValue(st, side, rand, depth) {
  if (st.winner != null) return evalFor(st, side);
  if (st.turn !== side) return evalFor(st, side) - HARD_REPLY_WEIGHT * replyGain(st, rand);
  if (depth >= 3) return evalFor(st, side);
  let best = -Infinity;
  for (const { mv } of candidates(st, side, HARD_SECOND)) {
    const r = apply(guessOf(st, rand), mv);
    if (r.ok) best = Math.max(best, planValue(r.state, side, rand, depth + 1));
  }
  return best === -Infinity ? evalFor(st, side) : best;
}

function hardMove(state, side, rand) {
  let best = null, bestV = -Infinity;
  for (const { mv } of candidates(state, side, HARD_FIRST)) {
    let v = 0, n = 0;
    for (let k = 0; k < HARD_GUESSES; k++) {
      const r = apply(guessOf(state, rand), mv);
      if (!r.ok) break;
      v += planValue(r.state, side, rand, 1); n++;
    }
    if (!n) continue;
    v = v / n + rand() * 0.01;   // ties: not always the first
    if (v > bestV) { bestV = v; best = mv; }
  }
  return best;
}

/** The computer's draft: two different monsters, not the ones the player took. Easy and Medium
 *  stick to the starters; Hard drafts from everything the player has unlocked. */
export function chooseTeam(level, unlocked, taken, rand = Math.random) {
  const starters = unlocked.filter((id) => !BY_ID[id].unlock);
  let pool = (level === 'hard' ? unlocked : starters).filter((id) => !taken.includes(id));
  if (pool.length < 2) pool = unlocked.filter((id) => !taken.includes(id));
  if (pool.length < 2) pool = unlocked.slice();
  const out = [];
  while (out.length < 2 && pool.length) {
    const i = Math.floor(rand() * pool.length);
    const id = pool.splice(i, 1)[0];
    // Never two of one element (2026-11-14), unless nothing else is left.
    if (out.length && BY_ID[out[0]].el === BY_ID[id].el && pool.some((x) => BY_ID[x].el !== BY_ID[out[0]].el)) continue;
    out.push(id);
  }
  return out;
}
