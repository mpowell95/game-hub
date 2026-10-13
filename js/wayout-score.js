// js/wayout-score.js - Arrow Maze's timed score (2026-10-13). Pure: no imports, no storage, no DOM.
//
// Matt and Ana: rank by difficulty first, add a timer, make a mistake cost time, and find a way that
// does not reward new players over people who have played for a long time. Two things made a plain
// best time unfair here, and this module answers both:
//
//   1. LATER LEVELS ARE BIGGER AND DEEPER (way-out/CLAUDE.md, generator 4), so a raw time favours
//      whoever is on an early level. Every finish is therefore scored against its own board's PAR,
//      a time worked out from that board's size: arrows to tap plus rounds to think through. 100 is
//      par; 120 is 20% faster than par.
//   2. ONE LUCKY BOARD should not top the board. A player's number is their best RUN OF 10 finishes
//      in a row on that difficulty, averaged. Finishes not played yet count as par (100), so two
//      lucky boards from somebody new average out near 100 instead of beating ten good ones.
//
// A finish is stored RAW as { t, a, r }: total ms including penalties, arrows, rounds. Par is worked
// out here at READ time, so if the par constants are ever retuned against real times, every stored
// finish is re-scored the same way and nothing has to be migrated.
//
// Mistakes and hints cost time (Matt): the first heart lost on a level adds the tier's base penalty,
// the second adds double; a hint adds the base once. The third heart ends the attempt as before.

export const WO_TIERS = ['easy', 'medium', 'hard', 'expert'];
/** How many finishes in a row make a run. */
export const WO_RUN = 10;
/** Par: this long per arrow on the board, plus this long per round (a round = every arrow that is
 *  free at that moment). A first guess with no play data behind it; retune here. */
export const WO_PAR_ARROW_MS = 1500;
export const WO_PAR_ROUND_MS = 2500;
/** One finish can score at most this much, so a fluke (or a typed number) cannot carry a run. */
export const WO_SCORE_CAP = 300;
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

export function woParMs(arrows, rounds) {
  return Math.max(1, arrows | 0) * WO_PAR_ARROW_MS + Math.max(1, rounds | 0) * WO_PAR_ROUND_MS;
}

/** A stored finish, or null when it is not one. Firebase hands arrays back as objects keyed 0..n,
 *  so a list may arrive either way. */
function asFinish(f) {
  if (!f || typeof f !== 'object') return null;
  const t = Number(f.t), a = Number(f.a), r = Number(f.r);
  if (!(t > 0) || !(a > 0) || !(r > 0)) return null;
  return { t: Math.round(t), a: Math.round(a), r: Math.round(r) };
}
export function woList(x) {
  const arr = Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.keys(x).sort((p, q) => p - q).map((k) => x[k]) : []);
  return arr.map(asFinish).filter(Boolean);
}

/** One finish's score: 100 = par, higher is faster. */
export function woFinishScore(f) {
  const g = asFinish(f);
  if (!g) return null;
  return Math.min(WO_SCORE_CAP, (100 * woParMs(g.a, g.r)) / Math.max(1000, g.t));
}

/** A run's score: the average of its last WO_RUN finishes, with any not yet played counting as par.
 *  null for a run with no finishes at all. */
export function woRunScore(list) {
  const run = woList(list).slice(-WO_RUN);
  if (!run.length) return null;
  let sum = (WO_RUN - run.length) * 100;
  for (const f of run) sum += woFinishScore(f);
  return sum / WO_RUN;
}

/** The number a player is ranked by at one difficulty: their best run's score, rounded. null when
 *  they have no timed finish there. */
export function woRating(wo, tier) {
  if (!wo || !wo.best) return null;
  const s = woRunScore(wo.best[tier]);
  return s === null ? null : Math.round(s);
}

/** m:ss for a duration in ms. */
export function woClock(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
