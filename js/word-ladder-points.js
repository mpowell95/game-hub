// js/word-ladder-points.js - Word Ladder's POINTS, the leaderboard's number (2026-11-19, Matt: "Cool. Make sure it's
// ready to be added to the leaderboard with the 'how scores are calculated' screen"; the table of
// docs/WORD-LADDER-POINTS-PROPOSAL.md). PURE and READ TIME: nothing stored changes, nothing earned is lost.
//
// A level's points = its band and its stars (moves at par 3, 1-2 over 2, more 1; 1 hint caps at 2, 2+ at 1):
//            3 stars  2 stars  1 star
//   Easy        1        1        1        levels 1-100
//   Medium      2        1        1        101-250
//   Hard        3        2        1        251-400
//   Expert      5        3        1        401-500
// Each level NUMBER counts once per language, at its best entry over every puzzle version (js/game-stats.js
// wlLevels: an old solve of a remade level pays at its stored stars, a replay never twice; the merged maps of
// js/players-agg.js, so a level on two phones counts once). English and Spanish both count. The daily pays nothing.
// Used by the leaderboard (js/leaderboard-ui.js gameMetricAt), My Stats, the "+X pts" pill (js/points-toast.js) and
// the "See how scores are calculated" sheet (js/lb-rank-sheet.js), so all of them agree on every number.
// tools/test-word-ladder.mjs pins it.
import { wlLevels, wlBandOf } from './game-stats.js';

export const WL_TIERS = ['easy', 'medium', 'hard', 'expert'];
/** Points for a level in each band, by stars: [3 stars, 2 stars, 1 star]. */
export const WL_POINTS = { easy: [1, 1, 1], medium: [2, 1, 1], hard: [3, 2, 1], expert: [5, 3, 1] };

/** What one level pays: its band and its stars (1-3; anything else reads as 1, a finished level is never 0). */
export function wlLevelPoints(band, stars) {
  const row = WL_POINTS[band] || WL_POINTS.easy;
  const s = Math.min(3, Math.max(1, Math.floor(Number(stars) || 0)));
  return row[3 - s];
}
/** Every ladder level number counted once, `band` = one band only (null = all). */
function rows(rec, band) {
  const out = [];
  try { for (const r of wlLevels(rec).values()) if (!band || wlBandOf(r.n) === band) out.push(r); } catch { /* no record */ }
  return out;
}
/** The leaderboard's number: points over every distinct level finished, both languages; `band` = that band's own. */
export function wlPoints(rec, band = null) {
  let n = 0;
  for (const r of rows(rec, band)) n += wlLevelPoints(wlBandOf(r.n), r.e && r.e.s);
  return n;
}
/** Distinct levels finished (both languages), optionally one band. */
export function wlCleared(rec, band = null) { return rows(rec, band).length; }
/** Stars over every distinct level (each number's best). */
export function wlStarsTotal(rec, band = null) { return rows(rec, band).reduce((n, r) => n + ((r.e && r.e.s) | 0), 0); }
/** Levels finished in par moves (each number's best). */
export function wlAtPar(rec, band = null) {
  return rows(rec, band).filter((r) => r.e && (r.e.m | 0) > 0 && (r.e.p | 0) > 0 && (r.e.m | 0) <= (r.e.p | 0)).length;
}

export default { WL_TIERS, WL_POINTS, wlLevelPoints, wlPoints, wlCleared, wlStarsTotal, wlAtPar };
