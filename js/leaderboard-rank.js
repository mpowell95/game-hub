// leaderboard-rank.js - the leaderboard's ranking maths, extracted from the DOM so it unit-tests
// headless with `node` (test-leaderboard-rank.mjs), the same way players-agg.js does.
//
// PURE and READ-ONLY. Nothing here writes, migrates, or normalizes stored data: every rule below is
// a read-time DISPLAY TRANSFORM over the aggregated groups from players-agg.js. `gamehub.stats` and
// `players/<deviceId>` keep the exact shape they already have, so all of this is reversible by
// editing these functions and nothing else.
//
// Two rules carry most of the weight:
//
// 1. A DRAW IS NOT A WIN (Matt, 2026-07-28: "Tictactoe ties are being counted as wins. That's
//    wrong."). `wins` is the stored `won` counter and nothing else. This REVERSES the original
//    draws-as-wins rule, which folded every tie into the wins number for every game - most visibly
//    in Tic Tac Toe, where Classic vs Pro is unbeatable by design and therefore draw-heavy, so a
//    long stalemate streak read as a winning streak. The reconciliation argument that motivated the
//    old rule (W + L === Plays) is dropped deliberately: plays now legitimately exceed wins +
//    losses by the number of draws, which is the honest shape.
// 2. Difficulty is WEIGHTED, not filtered. Every play counts; harder tiers count for more.
//
// Draws are not shown as their own number on the leaderboard (Matt's call, same day): they stay
// visible in their own right on the My Stats screen (game-stats-ui.js shows Tic Tac Toe's, Dots
// and Boxes' and Boggle's explicit W/L/T), which is the surface that satisfies THE LAW rule 1 for
// the raw breakdown. Nothing stored changed - `played`/`won`/`lost` are byte-identical before and
// after, and this is reversible by editing these functions and nothing else.

import { COMPETITIVE } from './players-agg.js';
import { tierOf, TIER_WEIGHT } from './difficulty-tiers.js';

/** Below this many rated plays a rating is shown but flagged: the sample is too small to mean much.
 *  Wilson already pushes those players down; the flag just makes the reason legible. */
export const PROVISIONAL_PLAYS = 5;

/** Wins are the STORED `won` counter: a draw is not a win (see rule 1 in the header). Losses clamp
 *  to `played`, and wins clamp to whatever `played` has left after losses, so W + L <= Plays holds
 *  for EVERY record however malformed (a legacy record with `won + lost > played` cannot inflate
 *  either number, and neither can go negative). The difference, `played - wins - losses`, is the
 *  draw count - not surfaced here, since no caller displays it. */
export function record(total) {
  const t = total || {};
  const played = Math.max(0, t.played | 0);
  const losses = Math.min(Math.max(0, t.lost | 0), played);
  const wins = Math.min(Math.max(0, t.won | 0), played - losses);
  return { wins, losses, played };
}

/**
 * Every byDiff bucket of one game as { key, tier, played, wins, losses }, PLUS a synthetic
 * null-tier bucket for any plays `total` counts that `byDiff` does not.
 *
 * That remainder is not hypothetical: records predating per-difficulty tracking have totals with an
 * empty or partial byDiff, and recordBallRun/recordNutsBolts skip the bucket entirely when the tier
 * string is unrecognised. Attributing the remainder at weight 1.0 keeps `Σ buckets.played` equal to
 * `total.played` so no play is ever lost to the rating - a THE LAW rule 1 concern, asserted in the test.
 */
export function bucketsOf(game) {
  const g = game || {};
  const bd = g.byDiff || {};
  const out = [];
  let sumPlayed = 0, sumWins = 0, sumLosses = 0;
  for (const key of Object.keys(bd)) {
    const b = bd[key] || {};
    const r = record(b);
    if (r.played <= 0) continue;
    sumPlayed += r.played; sumWins += r.wins; sumLosses += r.losses;
    out.push({ key, tier: tierOf(key), played: r.played, wins: r.wins, losses: r.losses });
  }
  const t = record(g.total);
  const restPlayed = t.played - sumPlayed;
  if (restPlayed > 0) {
    // Wins in the remainder are the total's own wins that no bucket accounted for - derived, not
    // assumed: a play with no difficulty bucket is not automatically a win now that draws are not.
    const restLosses = Math.max(0, Math.min(t.losses - sumLosses, restPlayed));
    const restWins = Math.max(0, Math.min(t.wins - sumWins, restPlayed - restLosses));
    out.push({ key: '', tier: null, played: restPlayed, wins: restWins, losses: restLosses });
  }
  return out;
}

/** One player's play mix across the four tiers for a set of games: [{ tier, played }] plus the
 *  unranked (null-tier) share. Feeds the standings row's tier bar and the detail screen's table. */
export function tierMix(group, gameIds) {
  const mix = { 1: 0, 2: 0, 3: 0, 4: 0, unranked: 0 };
  for (const id of gameIds) {
    for (const b of bucketsOf(group.games[id])) {
      if (b.tier) mix[b.tier] += b.played; else mix.unranked += b.played;
    }
  }
  return mix;
}

/** Per-tier W-L for ONE game, for the detail screen's breakdown table. */
export function tierRows(game) {
  const rows = { 1: null, 2: null, 3: null, 4: null, unranked: null };
  for (const b of bucketsOf(game)) {
    const k = b.tier || 'unranked';
    const r = rows[k] || (rows[k] = { played: 0, wins: 0, losses: 0 });
    r.played += b.played; r.wins += b.wins; r.losses += b.losses;
  }
  return rows;
}

/**
 * Wilson score lower bound at 95% confidence. `p` comes from difficulty-WEIGHTED counts; `n` from
 * the RAW play count, so the confidence term reflects the real sample size rather than a weighted
 * fiction - difficulty should move your rate, not fake how much you have played.
 *
 * This is what stops both failure modes of the old "sort by absolute wins": 100 games at 30% cannot
 * brute-force past 14 games at 86%, and a 2-0 start cannot leapfrog a 15-3 record.
 */
export function wilsonLower(p, n, z = 1.96) {
  if (!(n > 0)) return 0;
  const pp = Math.min(1, Math.max(0, p));
  const d = 1 + (z * z) / n;
  const centre = pp + (z * z) / (2 * n);
  const margin = z * Math.sqrt((pp * (1 - pp)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - margin) / d);
}

/**
 * Wilson lower bound on the win rate, scaled by the difficulty the player actually plays at.
 * Null when the player has no competitive history at all (solo-only players).
 *
 * TWO separate uses of TIER_WEIGHT, and they do different jobs:
 *
 *   p      = Σ(wins·w) / Σ(played·w)   - the player's own MIX. Weighting both sides keeps p inside
 *                                        [0,1] and means beating Pro matters more than beating
 *                                        Beginner *within* one player's record.
 *   avgW   = Σ(played·w) / Σ(played)   - the difficulty they play AT, in [0.8, 1.5].
 *   score  = min(1, wilson(p, nRaw) · avgW)
 *
 * The avgW factor is load-bearing, not decoration. Weighting numerator and denominator ALONE (the
 * obvious formulation) cancels exactly for any player who plays a single tier - 10-5 on Pro and
 * 10-5 on Beginner both give p = 0.667 - so difficulty would have changed nothing for the common
 * case and "10 wins on Easy" would have ranked identically to "10 wins on Hard". Multiplying the
 * confidence-bounded rate by the tier they earned it at is what makes difficulty actually count.
 *
 * `n` for the Wilson term is the RAW play count, never the weighted one: difficulty should move
 * your rate, not fake your sample size. The min(1, ...) only binds for a near-perfect record on
 * tier 4, which is a reasonable ceiling for a 0-100 display number.
 */
export function competitiveRating(group) {
  let weightedWins = 0, weightedPlays = 0, rawPlays = 0;
  for (const gameId of COMPETITIVE) {
    for (const b of bucketsOf(group.games[gameId])) {
      const w = TIER_WEIGHT[b.tier] || 1.0;         // null tiers count, at neutral weight
      weightedWins += b.wins * w;
      weightedPlays += b.played * w;
      rawPlays += b.played;
    }
  }
  if (rawPlays === 0) return null;
  const p = weightedPlays > 0 ? weightedWins / weightedPlays : 0;
  const avgW = weightedPlays / rawPlays;
  return { score: Math.min(1, wilsonLower(p, rawPlays) * avgW), plays: rawPlays };
}

/** Best Ball Run obstacle count and best Nuts & Bolts solved count across the whole visible field.
 *  Computed once per render and passed to soloRating, which scores relative to these maxima. */
export function fieldMaxOf(list) {
  let brBest = 0, nbSolved = 0, snBest = 0, hcBest = 0;
  for (const g of list || []) {
    const br = g.games.ballrun.br;
    if (br) brBest = Math.max(brBest, br.bestObstacles | 0);
    // Guarded: hand-built fixtures (and pre-Snake remote records) may have no snake key at all.
    const sn = (g.games.snake || {}).sn;
    if (sn) snBest = Math.max(snBest, sn.bestLen | 0);
    // Guarded the same way: a record synced before Hill Climb existed has no hillclimb key.
    const hc = (g.games.hillclimb || {}).hc;
    if (hc) hcBest = Math.max(hcBest, hc.bestDistance | 0);
    nbSolved = Math.max(nbSolved, g.solo.solved | 0);
  }
  return { brBest, nbSolved, snBest, hcBest };
}

/**
 * Solo games have NO LOSS AXIS - recordBallRun/recordNutsBolts write played+won and never touch
 * `lost` - so they cannot feed a win-rate model: a Wilson score on zero losses trends to 1.0 with
 * volume, which would let someone top the family board by grinding Ball Run with no skill involved.
 *
 * Instead: achievement RELATIVE TO THE FIELD, which is grind-proof because it is built on maxima.
 * Ball Run's bestObstacles is already a Math.max (players-agg.js), so extra runs cannot inflate it
 * past genuine skill. Nuts & Bolts' `solved` IS a count and so is grind-sensitive - capping it at
 * the field max makes it saturate at 1.0 rather than run away.
 */
export function soloRating(group, fieldMax) {
  const fm = fieldMax || { brBest: 0, nbSolved: 0, snBest: 0, hcBest: 0 };
  const parts = [];
  const br = group.games.ballrun.br;
  if (br && (br.runs | 0) > 0 && fm.brBest > 0) {
    parts.push({ score: Math.min(1, (br.bestObstacles | 0) / fm.brBest), plays: br.runs | 0 });
  }
  // Snake: same best-relative-to-field shape as Ball Run (a length best is a Math.max, so extra
  // runs can't inflate it past genuine skill). Guarded like fieldMaxOf above.
  const sn = (group.games.snake || {}).sn;
  if (sn && (sn.runs | 0) > 0 && (fm.snBest | 0) > 0) {
    parts.push({ score: Math.min(1, (sn.bestLen | 0) / fm.snBest), plays: sn.runs | 0 });
  }
  // Hill Climb: same best-relative-to-field shape as Ball Run and Snake (a distance best is a
  // Math.max, so extra runs cannot inflate it past genuine skill). Guarded like fieldMaxOf above.
  const hc = (group.games.hillclimb || {}).hc;
  if (hc && (hc.runs | 0) > 0 && (fm.hcBest | 0) > 0) {
    parts.push({ score: Math.min(1, (hc.bestDistance | 0) / fm.hcBest), plays: hc.runs | 0 });
  }
  const solved = group.solo.solved | 0;
  if (solved > 0 && fm.nbSolved > 0) {
    parts.push({ score: Math.min(1, solved / fm.nbSolved), plays: solved });
  }
  if (!parts.length) return null;
  const n = parts.reduce((a, p) => a + p.plays, 0);
  const raw = parts.reduce((a, p) => a + p.score * p.plays, 0) / n;
  // Discounted by sample size, exactly like the competitive side. Without this the two axes are
  // measured on different scales and solo always wins: a competitive score is a Wilson LOWER bound
  // (a strong 15-3 on Pro only reaches ~0.76), while a raw relative-achievement ratio hits a flat
  // 1.0 for whoever holds the field maximum - which, in a game only one person plays, is that
  // person by default, on any sample size. That put a player with 12 Nuts & Bolts levels at
  // rating 100, above a 22-match Chinchón record, on the very first render of real-shaped data.
  // Same conservatism on both axes keeps a single blended number honest.
  return { score: wilsonLower(raw, n), plays: n };
}

/**
 * One player's rating: competitive and solo blended by PLAY COUNT, so a mostly-competitive player's
 * rating is mostly their competitive score, and a solo-only player still gets a real, comparable
 * number instead of being absent from the board entirely (which is what used to happen).
 * Returns { rating, plays, comp, solo, provisional }; `rating` is null when there is nothing to rate.
 */
export function ratePlayer(group, fieldMax) {
  const c = competitiveRating(group);
  const s = soloRating(group, fieldMax);
  const blended = (!c && !s) ? null
    : !s ? c.score
      : !c ? s.score
        : (c.score * c.plays + s.score * s.plays) / (c.plays + s.plays);
  const plays = (c ? c.plays : 0) + (s ? s.plays : 0);
  return {
    rating: blended == null ? null : Math.round(blended * 100),
    plays,
    comp: c,
    solo: s,
    // Small samples are flagged, not hidden. Measured on TOTAL rated plays rather than competitive
    // ones alone: solo plays now feed the rating, so a Ball Run regular is not a small sample.
    provisional: blended != null && plays < PROVISIONAL_PLAYS,
  };
}

/** Descending comparator over a list of numeric extractors; first non-zero difference wins. */
export const cmp = (...fns) => (a, b) => { for (const f of fns) { const d = f(b) - f(a); if (d) return d; } return 0; };

/**
 * Rate and rank every group. Returns [{ ...rated, group }] sorted rating desc -> plays desc ->
 * updatedAt desc. Unrated players (no plays anywhere) sort last but are still returned - the
 * caller decides visibility, and per THE LAW rule 1 the caller's job is to show them.
 */
export function rankPlayers(list) {
  const fieldMax = fieldMaxOf(list);
  return (list || [])
    .map((group) => Object.assign({ group }, ratePlayer(group, fieldMax)))
    .sort(cmp((r) => (r.rating == null ? -1 : r.rating), (r) => r.plays, (r) => r.group.updatedAt));
}


// --- golf: the one board metric where LOWER WINS -----------------------------------------------
//
// Every other number on this leaderboard is "more is better" - wins, points, obstacles, metres -
// and the whole file was written on that assumption: rankMap and every sortRows branch in
// leaderboard-ui.js compare `b - a`, and gameListHTML filtered leaders with `metric > 0`.
//
// Golf breaks BOTH halves of that assumption, which is why this lives here, pure and tested,
// rather than as a special case scattered through the DOM file:
//
//  1. LOWER IS BETTER. A stroke score sorted descending puts the WORST golfer in the family on
//     top of the board, and it looks plausible enough to go unnoticed for weeks.
//  2. THE GOOD SCORES ARE <= 0. The number shown is a score to PAR, so level par is 0 and every
//     under-par round is negative. A `> 0` filter therefore drops exactly the best rounds ever
//     played - a stored best that no screen shows reads as deleted (THE LAW rule 1).
//
// The board shows ONE NAMED COURSE, never a blind minimum across bestRoundByCourse's keys. A
// 3-hole best and a 9-hole best are not comparable, so they are stored under different keys and
// only ever displayed apart (THE LAW rule 4). When holes 4-9 ship, `pinevalley9` becomes a
// SECOND entry here and the board names which one it is showing; `pinevalley3` is not repurposed
// and not merged into it (rule 5).
/** WHICH ROUND THE LEADERBOARD RANKS. Pine Valley's three-hole round, and deliberately so: it is
 *  the round a person on a phone actually finishes, everyone has the course, and it was already
 *  the frozen key before holes 4-18 existed. Every other round is still stored, still shown on My
 *  Stats and still reachable from a player's own leaderboard detail screen (THE LAW rule 1) - it
 *  is only the single number on the board that this names. Changing which round the board shows is
 *  one line here plus its row in GOLF_COURSE_PAR below. */
export const GOLF_BOARD_COURSE = 'pinevalley3';

/** Total par of each course, for turning a stored STROKE count into a score to par. The stored
 *  value stays strokes - that is the frozen recorder shape (js/game-stats.js's bestRoundByCourse,
 *  Math.min per key) - and par is subtracted at DISPLAY time only. Since par is a constant per
 *  course, ordering by strokes and ordering by to-par are identical, so nothing about the stored
 *  Math.min merge has to change.
 *
 *  THESE NUMBERS ARE DUPLICATED FROM THE COURSE DATA ON PURPOSE, and golf/js/test.js fails if they
 *  ever disagree with it. This module is in the service worker's NETWORK-FIRST shell tier and is
 *  imported by the hub's launcher path; importing golf/courses/ to derive them would drag two
 *  courses' worth of polygon data (~60 KB) onto the critical path of every hub load, for eight
 *  integers. The test is the link that keeps the copy honest. */
export const GOLF_COURSE_PAR = {
  // Pine Valley (par 72 over 18): 4 3 5 4 4 3 5 4 4 | 4 5 3 4 4 5 3 4 4
  pinevalley3: 12, pinevalley9: 36, pinevalley9b: 36, pinevalley18: 72,
  // Red Mesa (par 71 over 18):    4 4 3 5 4 3 4 5 4 | 4 3 4 5 4 4 3 4 4
  redmesa3: 11, redmesa9: 36, redmesa9b: 35, redmesa18: 71,
};

/** Golf's board number: the player's best round on the named course, as a score to par.
 *  Returns null - NOT 0 - when they have no recorded round there, because 0 is a real, good
 *  score (level par) and the two must never collide. */
export function golfBestAt(group, courseId = GOLF_BOARD_COURSE) {
  const gf = group && group.games && group.games.golf && group.games.golf.gf;
  const best = gf && gf.bestRoundByCourse ? gf.bestRoundByCourse[courseId] : undefined;
  if (!Number.isFinite(best)) return null;
  return best - (GOLF_COURSE_PAR[courseId] || 0);
}

/** Board metrics where a SMALLER number is the better result. */
export const LOWER_IS_BETTER = new Set(['golf']);

/** Does this player have a number on this board at all? For a lower-is-better metric that is
 *  "is there a value", never "is it positive" - see reason 2 in the header. */
export function hasBoardMetric(value, id) {
  if (value === null || value === undefined || Number.isNaN(value)) return false;
  return LOWER_IS_BETTER.has(id) ? true : value > 0;
}

/** Sort-ready comparator over two already-extracted metric values. Descending for every
 *  more-is-better metric, ASCENDING for golf. A player with no number sinks in both directions,
 *  so an absent value can never outrank a real one. */
export function compareBoardMetric(va, vb, id) {
  const na = !hasBoardMetric(va, id) && (va === null || va === undefined || Number.isNaN(va));
  const nb = !hasBoardMetric(vb, id) && (vb === null || vb === undefined || Number.isNaN(vb));
  if (na || nb) return na === nb ? 0 : (na ? 1 : -1);
  return LOWER_IS_BETTER.has(id) ? va - vb : vb - va;
}

/** How a board metric is PRINTED. Golf's is a score to par, so it takes a sign, and 0 is level
 *  par - which reads as "E" on every scorecard there has ever been, never as "0". `evenLabel` is
 *  passed in already translated: this module stays free of i18n. */
export function formatBoardMetric(value, id, evenLabel = 'E') {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (!LOWER_IS_BETTER.has(id)) return String(value);
  if (value === 0) return evenLabel;
  return value > 0 ? `+${value}` : String(value);
}

export default {
  record, bucketsOf, tierMix, tierRows, wilsonLower, competitiveRating,
  fieldMaxOf, soloRating, ratePlayer, rankPlayers, cmp, PROVISIONAL_PLAYS,
  golfBestAt, hasBoardMetric, compareBoardMetric, formatBoardMetric,
  LOWER_IS_BETTER, GOLF_BOARD_COURSE, GOLF_COURSE_PAR,
};
