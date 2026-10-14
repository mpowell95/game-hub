// js/gridlock-points.js - Gridlock's ladder, stars and points, pure (no DOM, no storage). Used by
// the game (gridlock/js/ui.js), the stats store (js/game-stats.js), the cross-device merge
// (js/players-agg.js), My Stats and the leaderboard, so all of them agree on every number.
//
// THE LADDER is Arrow Maze's (way-out/CLAUDE.md, "The ladder and points"): levels numbered 1, 2,
// 3...; Easy 1-50, Medium 51-100, Hard 101-150, Expert 151 on. A player may start any difficulty
// and plays its levels in order.
//
// WHAT IS STORED per level cleared (the `gl` sub-counter, js/game-stats.js `recordGridlock`):
//   gl.lv['L<n>'] = { m, s, c }  m = fewest moves the player solved it in (lower is better, never
//                                 0), s = best stars (1-3), c = 1 once solved without a hint.
// Keyed 'L13', never a bare number: Firebase turns an object with mostly numeric keys into an
// ARRAY, which would read back with holes. Each field only ever improves (THE LAW rule 2), and the
// cross-device merge takes the best of each, so a level cleared on two phones counts ONCE.
//
// POINTS are the leaderboard's number: the sum of `glLevelPoints(n)` over every level cleared.
// Read from the per-level map, not from byDiff counts, so replaying a level never adds points and a
// second phone never doubles them.

export const GL_TIERS = ['easy', 'medium', 'hard', 'expert'];
export const GL_BAND_SIZE = 50;
export const GL_BAND_START = { easy: 1, medium: 51, hard: 101, expert: 151 };

/** The band (difficulty) ladder level n belongs to. */
export function glBandOf(n) {
  return n >= GL_BAND_START.expert ? 'expert' : n >= GL_BAND_START.hard ? 'hard' : n >= GL_BAND_START.medium ? 'medium' : 'easy';
}
/** The last level of a band; Expert's is the last level that exists (`total`), Infinity if not given. */
export function glBandEnd(band, total = Infinity) {
  return band === 'expert' ? total : GL_BAND_START[band] + GL_BAND_SIZE - 1;
}

/** What ladder level n is worth: 1 for levels 1-25, one more every 25 levels, up to 8. */
export function glLevelPoints(n) {
  const L = Math.max(1, Math.floor(Number(n) || 1));
  return Math.min(8, 1 + Math.floor((L - 1) / 25));
}

/** Stars for a solve: 3 in the fewest moves, 2 within a little of it, 1 for any solve. "A little"
 *  is a quarter of the fewest, and never less than 2 moves. */
export function glSlack(fewest) { return Math.max(2, Math.ceil((Number(fewest) || 0) / 4)); }
export function glStars(moves, fewest) {
  const m = Number(moves) || 0, f = Number(fewest) || 0;
  if (m <= f) return 3;
  return m <= f + glSlack(f) ? 2 : 1;
}

/** One stored level entry, cleaned, or null. */
function entry(e) {
  if (!e || typeof e !== 'object') return null;
  const m = Math.floor(Number(e.m) || 0), s = Math.floor(Number(e.s) || 0);
  return { m: m > 0 ? m : 0, s: Math.max(1, Math.min(3, s || 1)), c: Number(e.c) > 0 ? 1 : 0 };
}

/** A record's cleared levels as { <n>: { m, s, c } } (n a number). `rec` is `games.gridlock`. */
export function glLevels(rec) {
  const lv = (rec && rec.gl && rec.gl.lv) || {};
  const out = {};
  if (typeof lv !== 'object') return out;
  for (const k of Object.keys(lv)) {
    const n = /^L(\d+)$/.exec(k);
    const e = n && entry(lv[k]);
    if (e && +n[1] >= 1) out[+n[1]] = e;
  }
  return out;
}

/** The better of two entries for one level, field by field (the cross-device merge). */
export function glBest(a, b) {
  const x = entry(a), y = entry(b);
  if (!x) return y;
  if (!y) return x;
  const m = x.m && y.m ? Math.min(x.m, y.m) : (x.m || y.m);
  return { m, s: Math.max(x.s, y.s), c: Math.max(x.c, y.c) };
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
/** Levels cleared without a hint (one band, or all). */
export function glNoHint(rec, band = null) {
  const lv = glLevels(rec);
  return Object.keys(lv).filter((n) => lv[n].c && (!band || glBandOf(+n) === band)).length;
}
/** A player's points (one band, or all four). */
export function glPoints(rec, band = null) {
  let p = 0;
  for (const n of Object.keys(glLevels(rec))) if (!band || glBandOf(+n) === band) p += glLevelPoints(+n);
  return p;
}
