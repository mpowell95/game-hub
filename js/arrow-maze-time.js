// js/arrow-maze-time.js - Arrow Maze's timer penalties and its stored finish lists (2026-10-13).
// Pure: no imports, no storage, no DOM. (The game's folder, hub id and stats id are still
// `way-out` / `wayout`, its first name; those keep it because they key stored player data.)
//
// Mistakes and hints cost time (Matt): the first heart lost on a level adds the tier's base
// penalty, the second adds double; a hint adds the base once. The third heart ends the attempt.

export const WO_TIERS = ['easy', 'medium', 'hard', 'expert'];
/** The base time a mistake or a hint costs, per difficulty, in seconds (Matt, 2026-10-13). */
export const WO_PENALTY_S = { easy: 10, medium: 15, hard: 20, expert: 30 };

/** The k-th heart lost in an attempt (1 or 2) costs k times the tier's base. */
export function woMistakeMs(tier, k) {
  return (WO_PENALTY_S[tier] || WO_PENALTY_S.easy) * 1000 * Math.max(1, k | 0);
}
/** A hint costs the tier's base once. */
export function woHintMs(tier) {
  return (WO_PENALTY_S[tier] || WO_PENALTY_S.easy) * 1000;
}

/** One stored finish, or null when it is not one: t = ms including penalties, a = arrows,
 *  r = rounds, m = hearts lost, h = hints (m and h only on finishes from the log). */
function asFinish(f) {
  if (!f || typeof f !== 'object') return null;
  const t = Number(f.t), a = Number(f.a), r = Number(f.r);
  if (!(t > 0) || !(a > 0) || !(r > 0)) return null;
  const out = { t: Math.round(t), a: Math.round(a), r: Math.round(r) };
  if (Number.isFinite(Number(f.m))) out.m = Math.max(0, Math.round(Number(f.m)));
  if (Number.isFinite(Number(f.h))) out.h = Math.max(0, Math.round(Number(f.h)));
  return out;
}
/** A finish list. Firebase hands arrays back as objects keyed 0..n, so it may arrive either way. */
export function woList(x) {
  const arr = Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.keys(x).sort((p, q) => p - q).map((k) => x[k]) : []);
  return arr.map(asFinish).filter(Boolean);
}

/** m:ss for a duration in ms. */
export function woClock(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
