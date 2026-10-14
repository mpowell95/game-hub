// js/gridlock-points.js - Gridlock's ladder, stars, crowns and points, pure (no DOM, no storage).
// Used by the game (gridlock/js/ui.js), the stats store (js/game-stats.js), the cross-device merge
// (js/players-agg.js), My Stats and the leaderboard, so all of them agree on every number.
//
// THE LADDER (ladder 2, 2026-10-14): levels 1, 2, 3...; Easy 1-1000, Medium 1001-2000, Hard
// 2001-3000, Expert 3001 to the last level shipped. A player may start any difficulty and plays its
// levels in order. (Ladder 1 was 400 levels in bands of 50; it is frozen, see LADDER 1 below.)
//
// WHAT IS STORED (the `gl` sub-counter, js/game-stats.js `recordGridlock` / `recordGridlockHint`):
//   gl.lv2['L<n>'] = { m, s, c, t }  ladder 2 level n: m = fewest moves the player solved it in
//                                    (lower is better, never 0), s = best stars 1-3, c = 1 once solved
//                                    with no hint ever used on it, t = when that first happened (ms).
//   gl.hint['L<n>'] = ms             when a hint was FIRST used on ladder 2 level n.
//   gl.lv['L<n>'] = { m, s, c }      LADDER 1 level n (the first build's 400 levels), frozen: never
//                                    written again, read through V1_TO_V2 as the same board.
// Keys are 'L13', never a bare number: Firebase turns an object with mostly numeric keys into an
// ARRAY. Each field only improves (THE LAW rule 2) and the cross-device merge takes the best of each,
// so a level cleared on two phones counts ONCE.
//
// HINTS COST POINTS (Matt, 2026-10-14, "Do 1-3" of: hints cost points; the test hook off the live
// site; hints remembered per level). A level earns its full points and its CROWN only if it was
// solved with no hint before any hint was ever used on it; otherwise it earns half its points,
// rounded up, for good. Times decide it, so it holds across phones: a no-hint solve on one phone
// AFTER a hint on another still earns half.
//
// POINTS are the leaderboard's number: the sum over every DISTINCT level cleared.

import { V1_TO_V2 } from './gridlock-v1map.js';

export const GL_TIERS = ['easy', 'medium', 'hard', 'expert'];
export const GL_BAND_SIZE = 1000;
export const GL_BAND_START = { easy: 1, medium: 1001, hard: 2001, expert: 3001 };

/** The band (difficulty) ladder level n belongs to. */
export function glBandOf(n) {
  return n >= GL_BAND_START.expert ? 'expert' : n >= GL_BAND_START.hard ? 'hard' : n >= GL_BAND_START.medium ? 'medium' : 'easy';
}
/** The last level of a band; Expert's is the last level that exists (`total`), Infinity if not given. */
export function glBandEnd(band, total = Infinity) {
  return band === 'expert' ? total : GL_BAND_START[band] + GL_BAND_SIZE - 1;
}

/** What ladder level n is worth with no hint: 1 for levels 1-500, one more every 500, up to 8. Never
 *  more than +1 between neighbours (Arrow Maze's rule). */
export function glLevelPoints(n) {
  const L = Math.max(1, Math.floor(Number(n) || 1));
  return Math.min(8, 1 + Math.floor((L - 1) / 500));
}
/** What it is worth when a hint was used on it: half, rounded up. */
export function glHintedPoints(n) { return Math.ceil(glLevelPoints(n) / 2); }

/** Stars for a solve: 3 in the fewest moves, 2 within a little of it, 1 for any solve. "A little"
 *  is a quarter of the fewest, and never less than 2 moves. */
export function glSlack(fewest) { return Math.max(2, Math.ceil((Number(fewest) || 0) / 4)); }
export function glStars(moves, fewest) {
  const m = Number(moves) || 0, f = Number(fewest) || 0;
  if (m <= f) return 3;
  return m <= f + glSlack(f) ? 2 : 1;
}

/** One stored level entry, cleaned, or null. `t` only exists with `c`; an old entry with c and no
 *  time (before hints were timed) counts as earned before any hint (t = 0). */
function entry(e) {
  if (!e || typeof e !== 'object') return null;
  const m = Math.floor(Number(e.m) || 0), s = Math.floor(Number(e.s) || 0);
  const c = Number(e.c) > 0 ? 1 : 0;
  const out = { m: m > 0 ? m : 0, s: Math.max(1, Math.min(3, s || 1)), c };
  if (c) out.t = Number(e.t) > 0 ? Math.floor(Number(e.t)) : 0;
  return out;
}

/** The better of two entries for one level, field by field (the cross-device merge). */
export function glBest(a, b) {
  const x = entry(a), y = entry(b);
  if (!x) return y;
  if (!y) return x;
  const m = x.m && y.m ? Math.min(x.m, y.m) : (x.m || y.m);
  const out = { m, s: Math.max(x.s, y.s), c: Math.max(x.c, y.c) };
  if (out.c) out.t = Math.min(x.c ? x.t : Infinity, y.c ? y.t : Infinity);
  return out;
}

/** A keyed map ('L<n>' -> anything) as { n: value }, n a number >= 1. */
function byLevel(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const k of Object.keys(map)) { const m = /^L(\d+)$/.exec(k); if (m && +m[1] >= 1) out[+m[1]] = map[k]; }
  return out;
}

/** A record's cleared levels on ladder 2 as { n: { m, s, c, t? } }. Ladder 1 entries are read
 *  through V1_TO_V2 as the same boards. `rec` is `games.gridlock`. */
export function glLevels(rec) {
  const gl = (rec && rec.gl) || {};
  const out = {};
  const old = byLevel(gl.lv);
  for (const k of Object.keys(old)) {
    const n2 = V1_TO_V2[+k - 1];
    const e = entry(old[k]);
    if (n2 && e) out[n2] = glBest(out[n2], e);
  }
  const now = byLevel(gl.lv2);
  for (const k of Object.keys(now)) { const e = entry(now[k]); if (e) out[+k] = glBest(out[+k], e); }
  return out;
}

/** When a hint was first used on each ladder 2 level: { n: ms }. */
export function glHints(rec) {
  const raw = byLevel(((rec && rec.gl) || {}).hint);
  const out = {};
  for (const k of Object.keys(raw)) { const v = Number(raw[k]); if (v > 0) out[+k] = Math.floor(v); }
  return out;
}

/** Did this level earn its crown (and full points)? Solved with no hint, before any hint on it. */
export function glCrowned(e, hintAt) {
  if (!e || !e.c) return false;
  return !(hintAt > 0) || (e.t || 0) < hintAt;
}

/** Levels cleared (one band, or all). */
export function glCleared(rec, band = null) {
  return Object.keys(glLevels(rec)).filter((n) => !band || glBandOf(+n) === band).length;
}
/** Levels cleared with three stars (one band, or all). */
export function glThreeStars(rec, band = null) {
  const lv = glLevels(rec);
  return Object.keys(lv).filter((n) => lv[n].s === 3 && (!band || glBandOf(+n) === band)).length;
}
/** Levels that earned the crown (one band, or all). */
export function glNoHint(rec, band = null) {
  const lv = glLevels(rec), hints = glHints(rec);
  return Object.keys(lv).filter((n) => glCrowned(lv[n], hints[n]) && (!band || glBandOf(+n) === band)).length;
}
/** What one cleared level is worth to this record. */
export function glPointsFor(n, e, hintAt) {
  return glCrowned(e, hintAt) ? glLevelPoints(n) : glHintedPoints(n);
}
/** A player's points (one band, or all four). */
export function glPoints(rec, band = null) {
  const lv = glLevels(rec), hints = glHints(rec);
  let p = 0;
  for (const k of Object.keys(lv)) if (!band || glBandOf(+k) === band) p += glPointsFor(+k, lv[k], hints[k]);
  return p;
}
