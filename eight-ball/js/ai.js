// eight-ball/js/ai.js - the computer. It does what a player does: for each ball worth potting and
// each pocket, it finds the "ghost ball" spot the cue ball must reach to send that ball in (straight,
// or off a cushion when only banks count), keeps the lines that look clear, and SIMULATES each
// candidate shot with the real physics (engine.js play) on a copy of the table. The best outcome is
// played. Difficulty changes how many shots it tries, whether it thinks about where the cue ball
// ends up (and what it leaves the next player), and how cleanly it hits the shot it chose.
//
// planShot is a generator so the UI can run it a slice at a time between frames; `plan` runs it to
// the end (the headless test).

import {
  W, H, R, CUE, EIGHT, POCKETS, HEAD_SPOT, FOOT_Y, targetsOf, ownBalls, needCall, canPlace,
  cloneMatch, play, groupOf,
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

/** Is the straight path from (ax, ay) to (bx, by), swept by a ball, clear of every ball but `skip`
 *  and of every solid obstacle? */
function clear(m, ax, ay, bx, by, skip) {
  const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
  if (l2 < 1e-9) return true;
  const near = (qx, qy, rr) => {
    const t = ((qx - ax) * ex + (qy - ay) * ey) / l2;
    if (t < 0 || t > 1) return false;
    const dx = ax + ex * t - qx, dy = ay + ey * t - qy;
    return dx * dx + dy * dy < rr * rr;
  };
  for (let j = 0; j < m.b.length; j++) {
    if (!m.b[j].on || skip.includes(j)) continue;
    if (near(m.b[j].x, m.b[j].y, 2 * R * 0.99)) return false;
  }
  for (const o of m.obs) {
    if (o.k === 'spill') continue;
    if (near(o.x, o.y, R + o.r + (o.h || 0))) return false;
  }
  return true;
}

/** The aim points a ball can be sent at to reach pocket k: the pocket itself, and with banks, the
 *  pocket mirrored in each cushion (the ball hits the cushion where the line crosses it). */
function aimPoints(k, banks) {
  const P = POCKETS[k];
  const out = [{ x: P.ax, y: P.ay, bank: false }];
  if (banks) {
    out.push({ x: -P.ax, y: P.ay, bank: true }, { x: 2 * W - P.ax, y: P.ay, bank: true });
    out.push({ x: P.ax, y: -P.ay, bank: true }, { x: P.ax, y: 2 * H - P.ay, bank: true });
  }
  return out;
}

/** Every pot on offer from the cue ball at (cx, cy) for target list `targets`, as
 *  { t, k, dx, dy, q (0-1 quality), dist }. */
function pots(m, cx, cy, targets, banks) {
  const out = [];
  for (const t of targets) {
    const o = m.b[t];
    if (!o.on) continue;
    for (let k = 0; k < POCKETS.length; k++) {
      for (const A of aimPoints(k, banks)) {
        let ux = A.x - o.x, uy = A.y - o.y;
        const ul = Math.sqrt(ux * ux + uy * uy) || 1; ux /= ul; uy /= ul;
        // A side pocket only takes a ball coming at it fairly square.
        if (!A.bank && (k === 2 || k === 3) && Math.abs(ux) < 0.5) continue;
        const gx = o.x - ux * 2 * R, gy = o.y - uy * 2 * R;
        let dx = gx - cx, dy = gy - cy;
        const dl = Math.sqrt(dx * dx + dy * dy);
        if (dl < 0.5) continue;
        dx /= dl; dy /= dl;
        const cos = dx * ux + dy * uy;
        if (cos < 0.2) continue;
        if (!clear(m, cx, cy, gx, gy, [CUE, t])) continue;
        if (!A.bank && !clear(m, o.x, o.y, A.x, A.y, [CUE, t])) continue;
        const q = ((cos * cos) / (1 + (dl + 1.6 * ul) / 160)) * (A.bank ? 0.45 : 1);
        out.push({ t, k, dx, dy, q, dist: dl + ul / Math.max(0.35, cos), bank: A.bank });
      }
    }
  }
  return out;
}

/** The balls worth potting for `seat`: its targets, but in Cutthroat everybody else's. */
function wanted(m, seat) {
  if (m.mode === 'ct') { const mine = ownBalls(m, seat); return targetsOf(m, seat).filter((i) => !mine.includes(i)); }
  return targetsOf(m, seat);
}

/** The best pot `seat` would have in match `m` as it stands (0 none - 1 a sitter). */
function bestPot(m, seat) {
  if (m.inHand) return 0.95;
  const c = m.b[CUE];
  let best = 0;
  for (const p of pots(m, c.x, c.y, wanted(m, seat), m.opts.bank)) if (p.q > best) best = p.q;
  return best;
}

/** Where to put the cue ball with the ball in hand: straight behind a ball, lined up on a pocket. */
function placements(m, seat, lv, rng) {
  const kitchen = m.inHand === 'kitchen';
  const out = [];
  for (const t of wanted(m, seat)) {
    const o = m.b[t];
    for (let k = 0; k < POCKETS.length; k++) {
      const P = POCKETS[k];
      let ux = P.ax - o.x, uy = P.ay - o.y;
      const ul = Math.sqrt(ux * ux + uy * uy) || 1; ux /= ul; uy /= ul;
      if ((k === 2 || k === 3) && Math.abs(ux) < 0.5) continue;
      for (const back of [14, 26, 40]) {
        const side = (rng() - 0.5) * 6;
        const x = o.x - ux * (2 * R + back) - uy * side, y = o.y - uy * (2 * R + back) + ux * side;
        if (!canPlace(m, x, y, kitchen)) continue;
        const p = pots(m, x, y, [t], false).find((c) => c.k === k);
        if (p) out.push({ x, y, q: p.q });
      }
    }
  }
  out.sort((a, b) => b.q - a.q);
  const top = out.slice(0, lv.places);
  if (!top.length) {
    for (const x of [W / 2, W * 0.3, W * 0.7, W * 0.15, W * 0.85]) if (canPlace(m, x, HEAD_SPOT[1], kitchen)) top.push({ x, y: HEAD_SPOT[1], q: 0 });
  }
  return top;
}

/** Every shot worth trying: { x?, y?, dx, dy, p, s, c? }. */
function candidates(m, seat, lv, rng) {
  const out = [];
  const starts = m.inHand ? placements(m, seat, lv, rng) : [{ x: m.b[CUE].x, y: m.b[CUE].y }];
  const call = needCall(m, seat);
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
      if (!canPlace(m, x, y, true)) continue;
      for (const aim of [0, -0.6, 0.6]) for (const s of [0, -0.3]) out.push({ x, y, dx: A.x + aim - x, dy: A.y - y, p: 1, s });
    }
    return out;
  }
  const targets = targetsOf(m, seat);
  for (const st of starts) {
    const place = m.inHand ? { x: st.x, y: st.y } : {};
    let list = pots(m, st.x, st.y, wanted(m, seat), false);
    if (m.opts.bank) list = list.concat(pots(m, st.x, st.y, wanted(m, seat), true).filter((c) => c.bank));
    list = list.sort((a, b) => b.q - a.q).slice(0, 12);
    for (const c of list) {
      const p0 = Math.max(0.28, Math.min(0.95, 0.22 + c.dist / (c.bank ? 200 : 260)));
      for (const pk of [0.85, 1, 1.2]) {
        for (const s of lv.spins) out.push({ ...place, dx: c.dx, dy: c.dy, p: Math.min(1, p0 * pk), s, q: c.q, ...(call ? { c: c.k } : {}) });
      }
    }
    // No pot on, or as a fallback: hit each target full and soft (a safety), or firmly.
    for (const t of targets.slice(0, 8)) {
      const o = m.b[t];
      const dx = o.x - st.x, dy = o.y - st.y;
      const c = call ? { c: nearestPocket(o.x, o.y) } : {};
      out.push({ ...place, dx, dy, p: 0.32, s: 0, ...c }, { ...place, dx, dy, p: 0.55, s: -0.3, ...c });
    }
  }
  out.sort((a, b) => (b.q || 0) - (a.q || 0));
  out.length = Math.min(out.length, Math.max(10, lv.budget - 6));
  while (out.length < lv.budget) {
    const st = starts[Math.floor(rng() * starts.length)];
    const a = rng() * Math.PI * 2;
    out.push({ ...(m.inHand ? { x: st.x, y: st.y } : {}), dx: Math.cos(a), dy: Math.sin(a), p: 0.3 + rng() * 0.6, s: 0, ...(call ? { c: Math.floor(rng() * 6) } : {}) });
  }
  return out;
}
function nearestPocket(x, y) {
  let k = 0, bd = Infinity;
  POCKETS.forEach((p, j) => { const d = (p.cx - x) ** 2 + (p.cy - y) ** 2; if (d < bd) { bd = d; k = j; } });
  return k;
}

/** How good the table is for `seat` after shot result `r` on copy `m2` (taken from `m`). */
function judge(m, m2, r, seat, lv) {
  if (r.kind === 'win') return m2.winner === seat ? 1e6 : -1e6;
  if (r.kind === 'rack') return r.rackWinner === seat ? 5e5 : -5e5;
  let s = 0;
  if (m.mode === 'ct') {
    // Their balls down is good, mine is bad; somebody else put out is very good.
    const mine = ownBalls(m, seat);
    const was = (i) => m.b[i].on, now = (i) => m2.b[i].on;
    for (let i = 1; i < m.b.length; i++) {
      if (was(i) && !now(i)) s += mine.includes(i) ? -900 : 500;
      if (!was(i) && now(i)) s += mine.includes(i) ? 400 : -300;
    }
    if (m2.out[seat]) return -4e5;
    s += 4000 * m2.out.filter((o, k) => o && !m.out[k]).length;
  }
  if (r.kind === 'foul') return s - 4000 - 1000 * bestPot(m2, m2.turn);
  const potted = (m2.last && m2.last.counted) || [];
  if (r.kind === 'again') return s + 3000 + 250 * potted.length + lv.position * 2500 * bestPot(m2, seat);
  // The turn passes: what is left for the next player, and whose balls went down.
  if (m.mode === '8' && m2.groups) {
    const theirs = ((m2.last && m2.last.pots) || []).filter((i) => i !== EIGHT && groupOf(i, '8') === m2.groups[seat ^ 1]).length;
    s -= 200 * theirs;
  }
  return s - lv.safety * 1800 * bestPot(m2, m2.turn);
}

/** A random stream that is a pure function of (the match's seed, the position): the same position
 *  in the same match always plans the same shot, so killing the app before the computer shoots and
 *  resuming cannot re-roll its plan (2026-10-29). The seed is the match's own (`match.seed`, saved
 *  with it, random per match), so a new match plans differently. */
export function seededRng(match, seat) {
  let h = 2166136261 ^ (Number(match.seed) >>> 0);
  let key = `${seat}|${match.rack}|${match.shots}|`;
  for (const b of match.b) key += Math.round(b.x * 10) + ',' + Math.round(b.y * 10) + ',' + (b.on ? 1 : 0) + ';';
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
    const s = judge(match, m2, r, seat, lv);
    scored.push([s, c]);
    if (s > bestScore) { bestScore = s; best = c; }
    yield;
  }
  if (!best) {
    // Every candidate refused (should not happen): straight at the first target, gently.
    const t = targetsOf(match, seat)[0], c = match.b[CUE], o = match.b[t];
    best = { dx: o.x - c.x, dy: o.y - c.y, p: 0.4, s: 0, c: nearestPocket(o.x, o.y) };
    if (match.inHand && !canPlace(match, c.x, c.y, match.inHand === 'kitchen')) { best.x = HEAD_SPOT[0]; best.y = HEAD_SPOT[1]; }
  }
  // Easy is not only shaky, it also does not always see the best shot.
  if (diff === 'easy' && scored.length > 3 && rng() < 0.4) {
    scored.sort((a, b2) => b2[0] - a[0]);
    const top = scored.slice(0, Math.max(2, Math.ceil(scored.length * 0.3)));
    best = top[Math.floor(rng() * top.length)][1];
  }
  // The hand is not perfect: a little error in angle and strength (the break, not much aim error).
  const a = Math.atan2(best.dy, best.dx) + gauss(rng) * lv.aim * (match.broke ? 1 : 0.3);
  const p = Math.max(0.05, Math.min(1, best.p * (1 + gauss(rng) * lv.pow)));
  const shot = { dx: Math.cos(a), dy: Math.sin(a), p, s: best.s || 0 };
  if (Number.isInteger(best.c)) shot.c = best.c;
  else if (needCall(match, seat)) shot.c = 0;
  if (match.inHand && Number.isFinite(best.x)) { shot.x = best.x; shot.y = best.y; }
  return shot;
}

/** Run planShot to the end. */
export function plan(match, seat, diff, rng) {
  const g = planShot(match, seat, diff, rng);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}
