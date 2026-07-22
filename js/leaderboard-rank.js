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
// 1. A DRAW COUNTS AS A WIN, for every player, in every game. Against Tic Tac Toe's Classic Pro
//    ("exhaustive minimax, unbeatable by design", CLAUDE.md) a draw is the best achievable result,
//    so it earns credit. It also makes every record reconcile: bumpTotals() increments `played` but
//    neither `won` nor `lost` on a draw, so a stored 2W/2L/10D record used to render as W-L "2-2"
//    beside Plays "14" and a 14% win rate - three numbers that contradicted each other. Derived at
//    render time, NEVER stored: see record().
// 2. Difficulty is WEIGHTED, not filtered. Every play counts; harder tiers count for more.
//
// Draws stay visible in their own right on the My Stats screen (game-stats-ui.js shows Tic Tac
// Toe's, Dots and Boxes' and Boggle's explicit W/L/T), which is the surface that satisfies THE LAW
// rule 1 for the raw breakdown. The leaderboard is the ranked view and uses the simplified rule.

import { COMPETITIVE } from './players-agg.js';
import { tierOf, TIER_WEIGHT } from './difficulty-tiers.js';

/** Below this many rated plays a rating is shown but flagged: the sample is too small to mean much.
 *  Wilson already pushes those players down; the flag just makes the reason legible. */
export const PROVISIONAL_PLAYS = 5;

/** Draws-as-wins, derived. `wins = played - losses`, not `won + (played - won - lost)`: same result,
 *  one operation, and it cannot go negative on a legacy record where `won + lost > played`. Losses
 *  are clamped to `played` too, so W + L === Plays holds for EVERY record, however malformed. */
export function record(total) {
  const t = total || {};
  const played = Math.max(0, t.played | 0);
  const losses = Math.min(Math.max(0, t.lost | 0), played);
  return { wins: played - losses, losses, played };
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
  let sumPlayed = 0, sumLosses = 0;
  for (const key of Object.keys(bd)) {
    const b = bd[key] || {};
    const r = record(b);
    if (r.played <= 0) continue;
    sumPlayed += r.played; sumLosses += r.losses;
    out.push({ key, tier: tierOf(key), played: r.played, wins: r.wins, losses: r.losses });
  }
  const t = record(g.total);
  const restPlayed = t.played - sumPlayed;
  if (restPlayed > 0) {
    const restLosses = Math.max(0, Math.min(t.losses - sumLosses, restPlayed));
    out.push({ key: '', tier: null, played: restPlayed, wins: restPlayed - restLosses, losses: restLosses });
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
  let brBest = 0, nbSolved = 0;
  for (const g of list || []) {
    const br = g.games.ballrun.br;
    if (br) brBest = Math.max(brBest, br.bestObstacles | 0);
    nbSolved = Math.max(nbSolved, g.solo.solved | 0);
  }
  return { brBest, nbSolved };
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
  const fm = fieldMax || { brBest: 0, nbSolved: 0 };
  const parts = [];
  const br = group.games.ballrun.br;
  if (br && (br.runs | 0) > 0 && fm.brBest > 0) {
    parts.push({ score: Math.min(1, (br.bestObstacles | 0) / fm.brBest), plays: br.runs | 0 });
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

export default {
  record, bucketsOf, tierMix, tierRows, wilsonLower, competitiveRating,
  fieldMaxOf, soloRating, ratePlayer, rankPlayers, cmp, PROVISIONAL_PLAYS,
};
