// eight-ball/js/ai.js - the computer. It does what a player does: for each ball it may hit and each
// pocket, it finds the "ghost ball" spot the cue ball must reach to send that ball into that pocket,
// keeps the ones with a clear line, and SIMULATES each candidate shot with the real physics
// (engine.js play) on a copy of the table. The best outcome is played. Difficulty changes how many
// shots it tries, whether it thinks about where the cue ball ends up (and what it leaves the other
// player), and how cleanly it hits the shot it chose.
//
// planShot is a generator so the UI can run it a slice at a time between frames; `plan` runs it to
// the end (the headless test).

import {
  W, R, CUE, EIGHT, POCKETS, HEAD_SPOT, FOOT_Y, targetsOf, canPlace, cloneMatch, play,
} from './engine.js';

export const DIFFS = ['easy', 'medium', 'hard'];
const LEVEL = {
  //        shots tried  aim noise (rad)  power noise  plays position  fears the reply  spins it tries
  easy:   { budget: 30, aim: 0.016, pow: 0.12, position: 0, safety: 0, spins: [0], places: 1 },
  medium: { budget: 90, aim: 0.0065, pow: 0.06, position: 0.5, safety: 0.5, spins: [0, 0.5, -0.5], places: 3 },
  hard:   { budget: 190, aim: 0.0025, pow: 0.03, position: 1, safety: 1, spins: [0, 0.6, -0.6, 0.3, -0.3], places: 5 },
};

/** A small seeded RNG so a test can replay a computer's choices. */
export function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function gauss(rng) {
  let u = 0; while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Is the straight path from (ax, ay) to (bx, by), swept by a ball, clear of every ball but `skip`? */
function clear(b, ax, ay, bx, by, skip) {
  const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
  if (l2 < 1e-9) return true;
  for (let j = 0; j < b.length; j++) {
    if (!b[j].on || skip.includes(j)) continue;
    const q = b[j];
    let t = ((q.x - ax) * ex + (q.y - ay) * ey) / l2;
    if (t < 0 || t > 1) continue;
    const dx = ax + ex * t - q.x, dy = ay + ey * t - q.y;
    if (dx * dx + dy * dy < 4 * R * R * 0.98) return false;
  }
  return true;
}

/** Every pot on offer from the cue ball at (cx, cy) for target list `targets`, as
 *  { t, k, dx, dy, q (0-1 quality), dist }. */
function pots(b, cx, cy, targets) {
  const out = [];
  for (const t of targets) {
    const o = b[t];
    if (!o.on) continue;
    for (let k = 0; k < POCKETS.length; k++) {
      const P = POCKETS[k];
      let ux = P.ax - o.x, uy = P.ay - o.y;
      const ul = Math.sqrt(ux * ux + uy * uy) || 1; ux /= ul; uy /= ul;
      // A side pocket only takes a ball coming at it fairly square.
      if ((k === 2 || k === 3) && Math.abs(ux) < 0.5) continue;
      const gx = o.x - ux * 2 * R, gy = o.y - uy * 2 * R;
      let dx = gx - cx, dy = gy - cy;
      const dl = Math.sqrt(dx * dx + dy * dy);
      if (dl < 0.5) continue;
      dx /= dl; dy /= dl;
      const cos = dx * ux + dy * uy;
      if (cos < 0.2) continue;
      if (!clear(b, cx, cy, gx, gy, [CUE, t]) || !clear(b, o.x, o.y, P.ax, P.ay, [CUE, t])) continue;
      const q = (cos * cos) / (1 + (dl + 1.6 * ul) / 160);
      out.push({ t, k, dx, dy, q, dist: dl + ul / Math.max(0.35, cos) });
    }
  }
  return out;
}

/** The best pot `seat` would have in match `m` as it stands (0 none - 1 a sitter). */
function bestPot(m, seat) {
  if (m.inHand) return 0.95;
  const c = m.b[CUE];
  let best = 0;
  for (const p of pots(m.b, c.x, c.y, targetsOf(m, seat))) if (p.q > best) best = p.q;
  return best;
}

/** Where to put the cue ball with the ball in hand: straight behind a ball, lined up on a pocket. */
function placements(m, seat, lv, rng) {
  const kitchen = m.inHand === 'kitchen';
  const out = [];
  for (const t of targetsOf(m, seat)) {
    const o = m.b[t];
    for (let k = 0; k < POCKETS.length; k++) {
      const P = POCKETS[k];
      let ux = P.ax - o.x, uy = P.ay - o.y;
      const ul = Math.sqrt(ux * ux + uy * uy) || 1; ux /= ul; uy /= ul;
      if ((k === 2 || k === 3) && Math.abs(ux) < 0.5) continue;
      for (const back of [14, 26, 40]) {
        // A little off the straight line, so the cue ball can be steered after the pot.
        const side = (rng() - 0.5) * 6;
        const x = o.x - ux * (2 * R + back) - uy * side, y = o.y - uy * (2 * R + back) + ux * side;
        if (!canPlace(m.b, x, y, kitchen)) continue;
        const p = pots(m.b, x, y, [t]).find((c) => c.k === k);
        if (p) out.push({ x, y, q: p.q });
      }
    }
  }
  out.sort((a, b) => b.q - a.q);
  const top = out.slice(0, lv.places);
  if (!top.length) {
    // Nothing lines up (a kitchen with every ball behind it): a few spots along the head string.
    for (const x of [W / 2, W * 0.3, W * 0.7]) if (canPlace(m.b, x, HEAD_SPOT[1], kitchen)) top.push({ x, y: HEAD_SPOT[1], q: 0 });
  }
  return top;
}

/** Every shot worth trying: { x?, y?, dx, dy, p, s }. */
function candidates(m, seat, lv, rng) {
  const out = [];
  const starts = m.inHand ? placements(m, seat, lv, rng) : [{ x: m.b[CUE].x, y: m.b[CUE].y }];
  const targets = targetsOf(m, seat);
  if (!m.broke) {
    // The break: from the kitchen, at the head ball, hard.
    let apex = -1, bd = Infinity;
    for (let i = 1; i < m.b.length; i++) {
      const o = m.b[i];
      if (!o.on) continue;
      const d = (o.x - W / 2) ** 2 + (o.y - FOOT_Y) ** 2;
      if (d < bd) { bd = d; apex = i; }
    }
    const A = m.b[apex];
    for (const off of [0, -10, 10, -22, 22]) {
      const x = W / 2 + off, y = HEAD_SPOT[1];
      if (!canPlace(m.b, x, y, true)) continue;
      for (const aim of [0, -0.6, 0.6]) for (const s of [0, -0.3]) out.push({ x, y, dx: A.x + aim - x, dy: A.y - y, p: 1, s });
    }
    return out;
  }
  for (const st of starts) {
    const place = m.inHand ? { x: st.x, y: st.y } : {};
    const list = pots(m.b, st.x, st.y, targets).sort((a, b) => b.q - a.q).slice(0, 12);
    for (const c of list) {
      const p0 = Math.max(0.28, Math.min(0.95, 0.22 + c.dist / 260));
      for (const pk of [0.85, 1, 1.2]) {
        for (const s of lv.spins) out.push({ ...place, dx: c.dx, dy: c.dy, p: Math.min(1, p0 * pk), s, q: c.q });
      }
    }
    // No pot on, or as a fallback: hit each target full and soft (a safety), or firmly.
    for (const t of targets) {
      const o = m.b[t];
      const dx = o.x - st.x, dy = o.y - st.y;
      out.push({ ...place, dx, dy, p: 0.32, s: 0 }, { ...place, dx, dy, p: 0.55, s: -0.3 });
    }
  }
  // Best-looking first, so a small budget still tries the good ones; then random top-ups.
  out.sort((a, b) => (b.q || 0) - (a.q || 0));
  out.length = Math.min(out.length, Math.max(10, lv.budget - 6));
  while (out.length < lv.budget) {
    const st = starts[Math.floor(rng() * starts.length)];
    const a = rng() * Math.PI * 2;
    out.push({ ...(m.inHand ? { x: st.x, y: st.y } : {}), dx: Math.cos(a), dy: Math.sin(a), p: 0.3 + rng() * 0.6, s: 0 });
  }
  return out;
}

/** How good the table is for `seat` after shot result `r` on copy `m2`. */
function judge(m2, r, seat, lv) {
  if (r.kind === 'win') return m2.winner === seat ? 1e6 : -1e6;
  if (r.kind === 'rack') return r.rackWinner === seat ? 5e5 : -5e5;
  if (r.kind === 'foul') return -4000 - 1000 * bestPot(m2, seat ^ 1);
  const pots = (m2.last && m2.last.pots) || [];
  if (r.kind === 'again') return 3000 + 250 * pots.length + lv.position * 2500 * bestPot(m2, seat);
  // The turn passes: what is left for the other player, and whose balls went down.
  const theirs = m2.groups ? pots.filter((i) => i !== EIGHT && targetsOf(m2, seat ^ 1).includes(i)).length : 0;
  return -200 * theirs - lv.safety * 1800 * bestPot(m2, seat ^ 1);
}

/** Generator: yields between candidates, returns the chosen shot (noise applied). */
export function* planShot(match, seat, diff, rng = Math.random) {
  const lv = LEVEL[diff] || LEVEL.medium;
  const list = candidates(match, seat, lv, rng);
  let best = null, bestScore = -Infinity;
  const scored = [];
  for (const c of list) {
    const m2 = cloneMatch(match);
    const r = play(m2, c, 12);
    if (!r) { yield; continue; }
    const s = judge(m2, r, seat, lv);
    scored.push([s, c]);
    if (s > bestScore) { bestScore = s; best = c; }
    yield;
  }
  if (!best) {
    // Every candidate refused (should not happen): straight at the first target, gently.
    const t = targetsOf(match, seat)[0], c = match.b[CUE], o = match.b[t];
    best = { dx: o.x - c.x, dy: o.y - c.y, p: 0.4, s: 0 };
  }
  // Easy is not only shaky, it also does not always see the best shot.
  if (diff === 'easy' && scored.length > 3 && rng() < 0.4) {
    scored.sort((a, b2) => b2[0] - a[0]);
    const pool = scored.slice(0, Math.max(2, Math.ceil(scored.length * 0.3)));
    best = pool[Math.floor(rng() * pool.length)][1];
  }
  // The hand is not perfect: a little error in angle and strength (the break, not much aim error).
  const a = Math.atan2(best.dy, best.dx) + gauss(rng) * lv.aim * (match.broke ? 1 : 0.3);
  const p = Math.max(0.05, Math.min(1, best.p * (1 + gauss(rng) * lv.pow)));
  const shot = { dx: Math.cos(a), dy: Math.sin(a), p, s: best.s || 0 };
  if (match.inHand && Number.isFinite(best.x)) { shot.x = best.x; shot.y = best.y; }
  return shot;
}

/** Run planShot to the end. */
export function plan(match, seat, diff, rng) {
  const g = planShot(match, seat, diff, rng);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

