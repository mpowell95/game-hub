// ai.js — offline opponent. Pure decision logic (no DOM): given a game state, pick
// a shot (aim direction, power, spin offset, elevation) by trying candidate
// ghost-ball aims at every legal target ball x every pocket, scoring each with a
// real physics lookahead (physics.js's own simulateToRest, on a cloned ball set —
// exactly the same deterministic engine the player shoots with, never a fudged
// approximation) and picking the best. Skill tiers vary aiming ERROR and how
// often the AI settles for a merely-good shot instead of the best one found — not
// the physics, which stays identical (and fully deterministic) at every tier.
import { R, TABLE, strikeCueBall, simulateToRest, pocketCenters } from './physics.js';
import { legalTarget } from './rules.js';
import { ballById } from './table.js';

const TIERS = {
  beginner: { aimErr: 0.09, powerErr: 0.25, topN: 4 },
  intermediate: { aimErr: 0.04, powerErr: 0.12, topN: 2 },
  pro: { aimErr: 0.012, powerErr: 0.05, topN: 1 },
};

function cloneBalls(balls) { return balls.map((b) => ({ ...b })); }
function len(x, y) { return Math.sqrt(x * x + y * y); }
function norm(x, y) { const l = len(x, y) || 1; return { x: x / l, y: y / l }; }

/** Any ball (other than a,b themselves) sitting close enough to the a->b segment
 *  to plausibly block a shot along it. Cheap and conservative on purpose. */
function pathBlocked(balls, from, to, ignoreIds) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const segLen = len(dx, dy);
  if (segLen < 1e-6) return false;
  const ux = dx / segLen, uy = dy / segLen;
  for (const b of balls) {
    if (b.pocketed || ignoreIds.indexOf(b.id) >= 0) continue;
    const tx = b.x - from.x, ty = b.y - from.y;
    const proj = tx * ux + ty * uy;
    if (proj <= 0 || proj >= segLen) continue;
    const perp = Math.abs(tx * uy - ty * ux);
    if (perp < R * 1.95) return true;
  }
  return false;
}

function candidateShots(state, seat) {
  const legal = legalTarget(state, seat);
  const cue = ballById(state.balls, 'cue');
  const targets = state.balls.filter((b) => !b.pocketed && b.id !== 'cue' &&
    (legal.kinds.indexOf(b.kind) >= 0 || (b.kind === 'eight' && legal.allowEight)));
  const pockets = pocketCenters();
  const out = [];
  for (const t of targets) {
    for (const p of pockets) {
      const toPocket = norm(p.x - t.x, p.y - t.y);
      const ghost = { x: t.x - toPocket.x * 2 * R, y: t.y - toPocket.y * 2 * R };
      if (Math.abs(ghost.x) > TABLE.w / 2 || Math.abs(ghost.y) > TABLE.h / 2) continue;
      const aim = norm(ghost.x - cue.x, ghost.y - cue.y);
      if (pathBlocked(state.balls, cue, ghost, [cue.id, t.id])) continue;
      if (pathBlocked(state.balls, t, p, [cue.id, t.id])) continue;
      const cueDist = len(ghost.x - cue.x, ghost.y - cue.y);
      const potDist = len(p.x - t.x, p.y - t.y);
      out.push({ targetId: t.id, aim, cueDist, potDist });
    }
  }
  return out;
}

function powerFor(cueDist, potDist) {
  const total = cueDist + potDist;
  return Math.max(0.9, Math.min(4.2, 0.9 + total * 1.6));
}

/** Default RNG when a caller doesn't supply one (kept so this file stays a drop-in
 *  for direct callers/tests that don't care about seeding). ui.js always passes a
 *  seeded generator from rng.js so a real game's AI decisions are reproducible. */
const defaultRng = Math.random;

function simulateCandidate(state, seat, cand, jitter) {
  const balls = cloneBalls(state.balls);
  const cue = ballById(balls, 'cue');
  const ang = Math.atan2(cand.aim.y, cand.aim.x) + jitter.aim;
  const dir = { x: Math.cos(ang), y: Math.sin(ang) };
  const power = Math.max(0.5, powerFor(cand.cueDist, cand.potDist) * (1 + jitter.power));
  strikeCueBall(cue, dir, power, { a: 0, b: 0.15 }, 0);
  const events = simulateToRest(balls);
  const potted = events.pocketed;
  const scratched = potted.indexOf('cue') >= 0;
  const eightPotted = potted.indexOf('b8') >= 0;
  const gotTarget = potted.indexOf(cand.targetId) >= 0;
  let score = -50;
  if (gotTarget) score = 100;
  if (scratched) score -= 200;
  if (eightPotted && cand.targetId !== 'b8') score -= 300;
  if (eightPotted && cand.targetId === 'b8' && !scratched) score += 500;
  // Prefer leaving the cue ball central (rough position play).
  const centerDist = len(cue.x, cue.y);
  score -= centerDist * 3;
  return { score, dir, power };
}

/** Choose a shot for `seat` given `state` (rules.js shape) at `difficulty`
 *  ('beginner'|'intermediate'|'pro'). `rng` is a `() => [0,1)` generator (rng.js's
 *  mulberry32, seeded by the caller); defaults to Math.random for callers that don't
 *  care about reproducibility. Returns { dir:{x,y}, power, offset:{a,b}, elevation }
 *  ready to pass straight into physics.js's strikeCueBall, or null if no legal
 *  target exists (shouldn't happen with balls left on the table). */
export function chooseShot(state, seat, difficulty, rng) {
  const rnd = rng || defaultRng;
  const tier = TIERS[difficulty] || TIERS.intermediate;
  const cands = candidateShots(state, seat);
  if (!cands.length) {
    // No clean line to anything legal: tap the nearest legal ball softly to
    // avoid a no-contact foul rather than freezing.
    const legal = legalTarget(state, seat);
    const cue = ballById(state.balls, 'cue');
    const t = state.balls.find((b) => !b.pocketed && b.id !== 'cue' &&
      (legal.kinds.indexOf(b.kind) >= 0 || (b.kind === 'eight' && legal.allowEight)));
    if (!t) return null;
    const dir = norm(t.x - cue.x, t.y - cue.y);
    return { dir, power: 1.1, offset: { a: 0, b: 0 }, elevation: 0 };
  }
  const scored = cands.map((c) => {
    const jitter = { aim: (rnd() * 2 - 1) * tier.aimErr, power: (rnd() * 2 - 1) * tier.powerErr };
    const r = simulateCandidate(state, seat, c, jitter);
    return { ...r, targetId: c.targetId };
  });
  scored.sort((a, b) => b.score - a.score);
  const pick = scored[Math.floor(rnd() * Math.min(tier.topN, scored.length))];
  return { dir: pick.dir, power: pick.power, offset: { a: 0, b: 0.15 }, elevation: 0 };
}
