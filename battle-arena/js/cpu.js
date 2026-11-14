// battle-arena/js/cpu.js - the computer. Pure: (state, level, rand) -> move. No DOM, no clock.
//   easy   any legal swap
//   medium the best single swap by what it clears at once: energy to its monsters (more as a bar
//          nears full, a lot for one that fills), berries, a 4-match's extra move, bombs defused
//   hard   plays each swap out, adds the best follow-up swap of the same turn, and marks down a
//          turn-ending swap that leaves the other side a special in one move
// `rand` is the caller's (the UI's Math.random, the soak's seeded one); the match's own RNG is
// never touched, so the computer cannot change the board it is thinking about.
import { apply, legalMoves, previewSwap, evolveOptions } from './engine.js';
import { BY_ID, specialOf, costOf, BERRIES_TO_EVOLVE } from './monsters.js';

export const LEVELS = ['easy', 'medium', 'hard'];
/** Hard plays each swap out this many times on guessed falls (never the match's own seed) and averages. */
const HARD_GUESSES = 2;
/** Hard's turn plan: its best few first moves (Medium's eye), each with its best few second moves. Measured 2026-11-14 (300
 *  matches each): 4/4 beat Medium 56%, 8/6 55%, 12/8 50%; 4/4 is also the cheapest on a phone. */
const HARD_FIRST = 4, HARD_SECOND = 4;

/** What a special is worth, roughly in HP. */
function specialValue(id, evo, rv) {
  const sp = specialOf(id, evo, rv || 1);
  return (sp.dmg || 0) + (sp.heal || 0) * 0.7 + (sp.shield || 0) * 0.7 + (sp.drain || 0) * 2
    + (sp.freeze ? 6 : 0) + (sp.chain || 0) * 2 + (sp.curse ? sp.curse.tick * sp.curse.turns : 0)
    + (sp.rows ? 4 * sp.rows : 0) + (sp.convert ? sp.convert : 0);
}

/** What each of `side`'s monsters would gain from cleared `counts` (the engine's charge rule, per rules version: from v3 two
 *  monsters of one element SHARE the gems, the fuller one first). Prismote gains 1 per 2 gems of any element. */
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
    if (m.energy + gain >= cost) score += 8 + specialValue(m.id, m.evo, state.rv);
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

/** Can `side` fire a special with one swap from here? Returns the biggest one's value (0 if none). */
function threat(state, side) {
  let worst = 0;
  const sd = state.sides[side];
  for (const mv of legalMoves(state)) {
    const p = previewSwap(state, mv.a, mv.b);
    const total = Object.values(p.counts).reduce((a, b) => a + b, 0);
    const gains = gainsFor(state, side, p.counts, total);
    for (const [mi, m] of sd.mons.entries()) {
      const gain = gains[mi];
      if (gain && m.energy + gain >= costOf(m.id, state.rv || 1)) worst = Math.max(worst, specialValue(m.id, m.evo, state.rv));
    }
  }
  return worst;
}

/** Hard's eye: what a swap really did, from its events. */
function scoreOutcome(before, side, res) {
  let score = 0;
  for (const e of res.events) {
    if (e.t === 'damage') score += e.side === side ? -1.3 * e.n : 1.2 * (e.n + e.absorbed * 0.5);
    else if (e.t === 'heal' && e.side === side) score += 0.8 * e.n;
    else if (e.t === 'energy' && e.side === side) {
      const cost = costOf(before.sides[side].mons[e.mon].id, before.rv || 1);
      score += e.gained * (1 + 1.5 * (e.energy / cost));
    } else if (e.t === 'berry' && e.side === side) score += 2.5 * e.n;
    else if (e.t === 'evolve' && e.side === side) score += 12;
    else if (e.t === 'evolveReady' && e.side === side) score += 12;
    else if (e.t === 'extra' && e.side === side) score += 9;
    else if (e.t === 'shield' && e.side === side) score += 0.7 * e.n;
    else if (e.t === 'win') score += e.side === side ? 1000 : -1000;
  }
  return score;
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
  // Evolving costs a move; the computer takes it when it can (Easy only half the time).
  const evo = evolveOptions(state);
  if (evo.length && (level !== 'easy' || rand() < 0.5)) return { type: 'evolve', mon: chooseEvolve(state, side) };
  const moves = legalMoves(state);
  if (!moves.length) return null;
  const swap = (m) => ({ type: 'swap', a: m.a, b: m.b });
  if (level === 'easy') return swap(moves[Math.floor(rand() * moves.length)]);

  if (level === 'hard') return swap(hardMove(state, side, moves, rand) || moves[0]);
  let best = null, bestV = -Infinity;
  for (const m of moves) {
    let v;
    {
      v = scorePreview(state, side, previewSwap(state, m.a, m.b));
    }
    v += rand() * 0.5;          // break ties without always picking the top-left swap
    if (v > bestV) { bestV = v; best = m; }
  }
  return swap(best || moves[0]);
}

/** HARD, with NO PEEKING (2026-11-14, Matt: "are you just calculating it so the robot gets luckier than me?"). It used to
 *  play each swap out on the REAL state, whose random seed decides the tiles that fall in, so it knew every cascade before
 *  choosing (and beat Medium 84%). Now every look ahead runs on GUESSED falls (a seed of its own, never the match's), averaged
 *  over HARD_GUESSES, so it sees the board exactly as the player does. To play better FAIRLY it plans its whole turn: the best
 *  first moves (Medium's eye) each with the best second move after them, and how much the player could fire back. */
function hardMove(state, side, moves, rand) {
  const swap = (m) => ({ type: 'swap', a: m.a, b: m.b });
  const guess = (st) => ({ ...st, rng: (Math.floor(rand() * 4294967296) >>> 0) || 1 });
  const ranked = moves.map((m) => ({ m, p: scorePreview(state, side, previewSwap(state, m.a, m.b)) + rand() * 0.5 }))
    .sort((a, b) => b.p - a.p).slice(0, HARD_FIRST);
  let best = null, bestV = -Infinity;
  for (const { m, p } of ranked) {
    let v = 0, n = 0;
    for (let k = 0; k < HARD_GUESSES; k++) {
      const res = apply(guess(state), swap(m));
      if (!res.ok) break;
      let g = scoreOutcome(state, side, res);
      const st = res.state;
      if (st.winner == null && st.turn === side) {
        // The second move of the turn, on the same guessed board: the best of Medium's top picks, played out.
        const seconds = legalMoves(st).map((m2) => ({ m2, p2: scorePreview(st, side, previewSwap(st, m2.a, m2.b)) }))
          .sort((a, b) => b.p2 - a.p2).slice(0, HARD_SECOND);
        let b2 = 0;
        for (const { m2 } of seconds) {
          const r2 = apply(guess(st), swap(m2));
          if (!r2.ok) continue;
          let g2 = scoreOutcome(st, side, r2);
          if (r2.state.winner == null && r2.state.turn !== side) g2 -= 0.6 * threat(r2.state, r2.state.turn);
          b2 = Math.max(b2, g2);
        }
        g += 0.9 * b2;
      } else if (st.winner == null) g -= 0.6 * threat(st, st.turn);
      v += g; n++;
    }
    if (!n) continue;
    v = v / n + 0.3 * p;
    if (v > bestV) { bestV = v; best = m; }
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
