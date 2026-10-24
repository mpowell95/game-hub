// battle-arena/js/cpu.js - the computer. Pure: (state, level, rand) -> move. No DOM, no clock.
//   easy   any legal swap
//   medium the best single swap by what it clears at once: energy to its monsters (more as a bar
//          nears full, a lot for one that fills), berries, a 4-match's extra move, bombs defused
//   hard   plays each swap out, adds the best follow-up swap of the same turn, and marks down a
//          turn-ending swap that leaves the other side a special in one move
// `rand` is the caller's (the UI's Math.random, the soak's seeded one); the match's own RNG is
// never touched, so the computer cannot change the board it is thinking about.
import { apply, legalMoves, previewSwap } from './engine.js';
import { BY_ID, specialOf, BERRIES_TO_EVOLVE } from './monsters.js';

export const LEVELS = ['easy', 'medium', 'hard'];

/** What a special is worth, roughly in HP. */
function specialValue(id, evo) {
  const sp = specialOf(id, evo);
  return (sp.dmg || 0) + (sp.heal || 0) * 0.7 + (sp.shield || 0) * 0.7 + (sp.drain || 0) * 2
    + (sp.freeze ? 6 : 0) + (sp.chain || 0) * 2 + (sp.curse ? sp.curse.tick * sp.curse.turns : 0)
    + (sp.rows ? 4 * sp.rows : 0) + (sp.convert ? sp.convert : 0);
}

/** Medium's eye: the first step of a swap, scored for `side`. */
export function scorePreview(state, side, p) {
  if (!p) return -Infinity;
  const sd = state.sides[side];
  let score = 0;
  const total = Object.values(p.counts).reduce((a, b) => a + b, 0);
  for (const m of sd.mons) {
    const def = BY_ID[m.id];
    const gain = def.el === 'all' ? Math.floor((m.part + total) / 2) : (p.counts[def.el] || 0);
    if (!gain) continue;
    score += gain * (1 + 2 * (m.energy / def.cost));
    if (m.energy + gain >= def.cost) score += 8 + specialValue(m.id, m.evo);
  }
  if (p.berries && sd.mons.some((m) => !m.evo)) {
    score += p.berries * (sd.berries + p.berries >= BERRIES_TO_EVOLVE ? 7 : 2.5);
  }
  if (p.maxRun >= 4 && !state.extraUsed) score += 7;
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
    for (const m of sd.mons) {
      const def = BY_ID[m.id];
      const gain = def.el === 'all' ? Math.floor((m.part + total) / 2) : (p.counts[def.el] || 0);
      if (gain && m.energy + gain >= def.cost) worst = Math.max(worst, specialValue(m.id, m.evo));
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
      const def = BY_ID[before.sides[side].mons[e.mon].id];
      score += e.gained * (1 + 1.5 * (e.energy / def.cost));
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
    const f = m.energy / BY_ID[m.id].cost;
    if (f > bestFill) { bestFill = f; best = i; }
  });
  return best;
}

export function chooseMove(state, level, rand = Math.random) {
  const side = state.turn;
  if (state.pendingEvolve === side) return { type: 'evolve', mon: chooseEvolve(state, side) };
  const moves = legalMoves(state);
  if (!moves.length) return null;
  const swap = (m) => ({ type: 'swap', a: m.a, b: m.b });
  if (level === 'easy') return swap(moves[Math.floor(rand() * moves.length)]);

  let best = null, bestV = -Infinity;
  for (const m of moves) {
    let v;
    if (level === 'hard') {
      const res = apply(state, swap(m));
      if (!res.ok) continue;
      v = scoreOutcome(state, side, res);
      const st = res.state;
      if (st.winner == null) {
        if (st.turn === side && st.pendingEvolve == null) v += 0.8 * Math.max(0, bestPreview(st, side));
        else if (st.turn !== side) v -= 0.6 * threat(st, st.turn);
      }
    } else {
      v = scorePreview(state, side, previewSwap(state, m.a, m.b));
    }
    v += rand() * 0.5;          // break ties without always picking the top-left swap
    if (v > bestV) { bestV = v; best = m; }
  }
  return swap(best || moves[0]);
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
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
