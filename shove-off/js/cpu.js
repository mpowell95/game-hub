// shove-off/js/cpu.js - the COMPUTER player (2026-11-18, Matt: "Add computer play to the game so i can test it").
// PURE: no DOM, no storage, no clock, no Math.random. A seeded RNG, so a seed always gives the same aims.
//
// FAIR BY CONSTRUCTION: `chooseAims(m, side, diff, seed)` reads only the pieces and the platform of the
// round about to be played. It never reads `m.sent` (the player's aims): the match is copied with
// `sent` emptied before anything else, and ui.js calls it at the START of each round, before the player
// aims, and stores the result (the save holds it too).
//
// How it plays: the engine's own simulation. For each of its pieces it tries candidate aims (at each
// opponent straight, at each opponent from the side that drives it toward its nearest edge, back toward
// the middle, sideways, random), holding its other pieces fixed, against a guess of the player's move
// (standing still; everyone charging the nearest piece; everyone backing off). Score = opponent pieces off
// minus own pieces off, minus being left near the edge, plus opponents left near it. A few passes of that.
// Easy: one guess (standing still), few candidates, one pass, picks among its better options at random
// and aims sloppily. Medium: two guesses, more candidates, two passes, a little sloppy. Hard: four
// guesses (average mixed with the worst case), every candidate, three passes, exact.
import * as E from './engine.js';

export const DIFFS = ['easy', 'medium', 'hard'];
const CFG = {
  easy: { guesses: ['still'], pow: [1], edge: false, back: [0.35], side: false, rnd: 2, passes: 1, top: 3, noiseA: 0.32, noiseP: 0.3, worst: 0 },
  medium: { guesses: ['still', 'charge'], pow: [0.75, 1], edge: true, back: [0.3], side: false, rnd: 3, passes: 2, top: 1, noiseA: 0.07, noiseP: 0.08, worst: 0.2 },
  hard: { guesses: ['still', 'charge', 'edge', 'back'], pow: [0.6, 0.8, 1], edge: true, back: [0.25, 0.45], side: true, rnd: 4, passes: 3, top: 1, noiseA: 0, noiseP: 0, worst: 0.4 },
};

/** mulberry32: a small seeded RNG, 0 <= x < 1. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A seed for one round of one match (ui.js): the match's own seed mixed with the round number. */
export const roundSeed = (seed, round) => (((seed >>> 0) * 31 + (round | 0) * 2654435761) >>> 0) || 1;

/** A copy of the match with nobody's aims in it: everything the computer may look at. */
function snapshot(m) {
  return { round: m.round, H: m.H, sd: m.sd, sdr: m.sdr, winner: null, end: '', rounds: [], sent: { a: null, b: null },
    pieces: m.pieces.map((p) => ({ s: p.s, i: p.i, x: p.x, y: p.y, alive: p.alive })) };
}
const copy = (snap) => ({ ...snap, rounds: [], sent: { a: null, b: null }, pieces: snap.pieces.map((p) => ({ ...p })) });

function dirTo(x0, y0, x1, y1, len) {
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  return [dx / d * len, dy / d * len];
}
/** The direction from the middle to the edge a piece is nearest (the way a shove should drive it). */
function outward(p) {
  return Math.abs(p.x) >= Math.abs(p.y) ? [p.x >= 0 ? 1 : -1, 0] : [0, p.y >= 0 ? 1 : -1];
}
const living = (m, s) => m.pieces.filter((p) => p.alive && p.s === s);

/** A guess of what the other side will do this round (by slot), from the same snapshot. */
function guessAims(m, s, kind) {
  const list = new Array(E.slotCount(m)).fill(null);
  if (kind === 'still') return list;
  const foes = living(m, E.other(s));
  for (const p of living(m, s)) {
    if (kind === 'back') { list[p.i] = E.clampAim(...dirTo(p.x, p.y, 0, 0, E.MAX_AIM * 0.35)); continue; }
    let best = null, bd = Infinity;
    for (const q of foes) { const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; best = q; } }
    if (!best) continue;
    if (kind === 'edge') {
      const [ux, uy] = outward(best);
      list[p.i] = E.clampAim(...dirTo(p.x, p.y, best.x - ux * E.R * 1.8, best.y - uy * E.R * 1.8, E.MAX_AIM));
    } else list[p.i] = E.clampAim(...dirTo(p.x, p.y, best.x, best.y, E.MAX_AIM));
  }
  return list;
}

/** How good a played-out round is for side `s` (higher = better). */
function scoreRound(rec, s, winner) {
  let mine = 0, theirs = 0;
  for (const k of rec.falls.concat(rec.shrinkFalls)) { if (rec.before[k].s === s) mine++; else theirs++; }
  let v = theirs * 10 - mine * 11;
  if (winner === s) v += 60;
  else if (winner && winner !== E.DRAW) v -= 60;
  const H1 = rec.H1;
  for (const p of rec.after) {
    if (!p.alive) continue;
    const e = Math.max(Math.abs(p.x), Math.abs(p.y)) / H1;     // 0 = the middle, 1 = the edge
    const risk = Math.max(0, e - 0.5);
    if (p.s === s) v -= risk * 7; else v += risk * 3;
  }
  return v;
}

/** Play the round out on a copy: my aims vs one guess. */
function trial(snap, s, mine, theirs) {
  const m = copy(snap);
  m.sent[s] = mine; m.sent[E.other(s)] = theirs;
  const rec = E.resolveRound(m);
  return scoreRound(rec, s, m.winner);
}

function candidates(snap, p, cfg, rnd) {
  const out = [];
  const foes = living(snap, p.s === 'a' ? 'b' : 'a');
  for (const q of foes) {
    for (const k of cfg.pow) out.push(dirTo(p.x, p.y, q.x, q.y, E.MAX_AIM * k));
    if (cfg.edge) { const [ux, uy] = outward(q); out.push(dirTo(p.x, p.y, q.x - ux * E.R * 1.8, q.y - uy * E.R * 1.8, E.MAX_AIM)); }
    if (cfg.side) {
      const [dx, dy] = dirTo(p.x, p.y, q.x, q.y, 1);
      out.push(dirTo(p.x, p.y, q.x + -dy * E.R * 0.9, q.y + dx * E.R * 0.9, E.MAX_AIM));
      out.push(dirTo(p.x, p.y, q.x + dy * E.R * 0.9, q.y - dx * E.R * 0.9, E.MAX_AIM));
    }
  }
  for (const k of cfg.back) out.push(dirTo(p.x, p.y, -p.x * 0.01, -p.y * 0.01, E.MAX_AIM * k));
  for (let i = 0; i < cfg.rnd; i++) {
    const a = rnd() * Math.PI * 2, len = E.MAX_AIM * (0.3 + rnd() * 0.7);
    out.push([Math.cos(a) * len, Math.sin(a) * len]);
  }
  return out.map(([x, y]) => E.clampAim(x, y)).filter(([x, y]) => x * x + y * y >= (E.R * 1.2) ** 2);
}

/**
 * The computer's aims for side `s` this round: an array by SLOT ([dx, dy] integers inside MAX_AIM for every
 * living piece, null for a piece that is out), ready for E.aimsToString. Same (m, s, diff, seed) = same aims.
 */
export function chooseAims(m, s, diff = 'medium', seed = 1) {
  const cfg = CFG[diff] || CFG.medium;
  const snap = snapshot(m);                     // the ONLY thing read from m from here on
  const rnd = rng(seed);
  const slots = E.slotCount(snap);
  const mine = living(snap, s);
  const aims = new Array(slots).fill(null);
  for (const p of mine) aims[p.i] = E.clampAim(...dirTo(p.x, p.y, 0, 0, E.MAX_AIM * 0.3));
  // a piece at the very middle has no "toward the middle": nudge it along x
  for (const p of mine) { const a = aims[p.i]; if (a[0] * a[0] + a[1] * a[1] < (E.R * 1.2) ** 2) aims[p.i] = [E.R * 2, 0]; }
  const guesses = cfg.guesses.map((g) => guessAims(snap, E.other(s), g));
  const value = (list) => {
    let sum = 0, worst = Infinity;
    for (const g of guesses) { const v = trial(snap, s, list, g); sum += v; if (v < worst) worst = v; }
    return sum / guesses.length * (1 - cfg.worst) + worst * cfg.worst;
  };
  for (let pass = 0; pass < cfg.passes; pass++) {
    for (const p of mine) {
      const opts = candidates(snap, p, cfg, rnd);
      opts.push(aims[p.i]);
      const scored = opts.map((a) => { const list = aims.slice(); list[p.i] = a; return { a, v: value(list) }; });
      scored.sort((x, y) => y.v - x.v);
      const pick = cfg.top > 1 ? scored[Math.floor(rnd() * Math.min(cfg.top, scored.length))] : scored[0];
      aims[p.i] = pick.a;
    }
  }
  if (cfg.noiseA || cfg.noiseP) {
    for (const p of mine) {
      const [x, y] = aims[p.i];
      const ang = Math.atan2(y, x) + (rnd() * 2 - 1) * cfg.noiseA;
      const len = Math.sqrt(x * x + y * y) * (1 + (rnd() * 2 - 1) * cfg.noiseP);
      let a = E.clampAim(Math.cos(ang) * len, Math.sin(ang) * len);
      if (a[0] * a[0] + a[1] * a[1] < (E.R * 1.2) ** 2) a = E.clampAim(Math.cos(ang) * E.R * 1.3, Math.sin(ang) * E.R * 1.3);
      aims[p.i] = a;
    }
  }
  return aims;
}

/** The look the computer plays in: the player's own kind in its OTHER colour (sumo vs sumo on one dohyo),
 *  so the two sides always differ by colour as well as by their circle / triangle markers. */
export function cpuLook(playerLook) {
  const k = String(playerLook || 'sumo0').replace(/\d+$/, '');
  const kind = ['sumo', 'car', 'puck'].includes(k) ? k : 'sumo';
  return kind + (String(playerLook || '').endsWith('1') ? '0' : '1');
}
