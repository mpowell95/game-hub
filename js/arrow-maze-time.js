// js/arrow-maze-time.js - Arrow Maze's timer penalties, its stored finish lists (2026-10-13), and
// since 2026-10-14 its LADDER and POINTS: the four bands, and what each level is worth.
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
 *  r = rounds, m = hearts lost, h = hints (m and h only on finishes from the log); since
 *  2026-10-14 also l = the ladder level, g = the board generator, d = when (epoch ms). */
function asFinish(f) {
  if (!f || typeof f !== 'object') return null;
  const t = Number(f.t), a = Number(f.a), r = Number(f.r);
  if (!(t > 0) || !(a > 0) || !(r > 0)) return null;
  const out = { t: Math.round(t), a: Math.round(a), r: Math.round(r) };
  if (Number.isFinite(Number(f.m))) out.m = Math.max(0, Math.round(Number(f.m)));
  if (Number.isFinite(Number(f.h))) out.h = Math.max(0, Math.round(Number(f.h)));
  for (const k of ['l', 'g', 'd']) if (Number(f[k]) > 0) out[k] = Math.round(Number(f[k]));
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

// --- THE LADDER AND ITS POINTS (2026-10-14) -----------------------------------------------------------
//
// Matt replaced the timed score with the shape most level apps use: ONE ladder of levels, cut into
// four difficulties (Easy 1-50, Medium 51-100, Hard 101-200, Expert 201 on, for ever; see below), any of
// which a player may start, and a leaderboard of POINTS for levels cleared. Points are FLAT PER
// DIFFICULTY, the 1 / 2 / 4 / 6 Matt agreed to (WO_BAND_POINTS, set from how long each difficulty's
// levels take in the real saved times). A first build used 1 + 1 every 25 levels (Expert 7-8); Matt
// had never agreed to it and it was replaced the same day ("Change it to what we agreed to"). Ties
// stay tied.
//
// Inside a band a player always plays the next level, so HOW MANY levels of a band they have cleared
// says exactly WHICH: the first `cleared` of it. The points are therefore read from the per-band
// cleared counts the stats store has kept since the game shipped (byDiff[band].won), which covers
// every level ever cleared, timed or not. Levels cleared before the ladder (2026-10-14) were the old
// tiers' levels and count as that band's levels in order; nothing is lost and nothing is invented.
// The timed finish log (`wo.log`) is kept, untouched by any of this, for when time comes back in.
// (2026-10-14, the same evening) The bands MOVED: Hard is 101-200 and Expert 201 on (it was Hard
// 101-150, Expert 151 on). Real play showed Expert 152-156 were boards the size of the old HARD tier;
// Matt: "maybe we spread it out more and add more hard levels in and keep expert as expert". Nothing
// stored is renumbered by this file: the counts (byDiff) are per band, so points do not change; the
// game carries each player's place across (way-out/js/ui.js, `ladder2`).
/** Where each band starts on the ladder. Expert never ends. */
export const BAND_START = { easy: 1, medium: 51, hard: 101, expert: 201 };
const BAND_LAST = { easy: 50, medium: 100, hard: 200 };
/** The band (tier name) a ladder level belongs to. */
export function bandOf(n) {
  return n >= BAND_START.expert ? 'expert' : n >= BAND_START.hard ? 'hard' : n >= BAND_START.medium ? 'medium' : 'easy';
}
/** The last ladder level of a band, or Infinity for Expert. */
export function bandEnd(band) {
  return band === 'expert' ? Infinity : BAND_LAST[band];
}
/** What one cleared level of each difficulty is worth. */
export const WO_BAND_POINTS = { easy: 1, medium: 2, hard: 4, expert: 6 };
/** What ladder level n is worth: its difficulty's points. */
export function woLevelPoints(n) {
  const L = Math.max(1, Math.floor(Number(n) || 1));
  return WO_BAND_POINTS[bandOf(L)];
}
/** Points for `cleared` levels of a band. A count past the band's 50 (possible only from the old
 *  endless tiers) earns the same per level: never dropped, never more. */
export function woBandPoints(band, cleared) {
  const c = Math.max(0, Math.floor(Number(cleared) || 0));
  return WO_BAND_POINTS[band] ? c * WO_BAND_POINTS[band] : 0;
}
/** A player's Arrow Maze points from their stats record (`games.wayout`): one band, or all four. */
export function woPoints(rec, band = null) {
  const byDiff = (rec && rec.byDiff) || {};
  const one = (b) => woBandPoints(b, ((byDiff[b] || {}).won) | 0);
  return band ? (WO_TIERS.includes(band) ? one(band) : 0) : WO_TIERS.reduce((n, b) => n + one(b), 0);
}
