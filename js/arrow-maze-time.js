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
// HINTS AND LOST LIVES COST POINTS (2026-10-17). Matt: "Using a hint or losing a life should reduce
// the number of points you get for that level. You should not be able to use a hint and lose a life
// and still get 6 points for completing an expert level round." A SLIP is a hint used or a heart lost
// on the level, across every Restart and Try again of it (they ride its clock; New game starts it
// over). The table is Matt's: Expert "6, 4, 2, and one"; Hard 4, 3, 2, 1; Medium 2, 1; Easy 1 (it
// has nothing to take away). A cleared level is always worth at least 1.
// From that day only: a level is SCORED this way when its slips are known (a timed level); the
// recorder adds what it earned to `wo.pts[band]` and counts it in `wo.ptsN[band]`, both plain
// counters that add across a person's phones. Every other cleared level (before this, untimed, or
// from a phone on an older build) keeps its difficulty's full points, as before. Matt: "Let's wait on
// going back and recalculating... once we have enough data we can use averages."
export const WO_SLIP_POINTS = { easy: [1], medium: [2, 1], hard: [4, 3, 2, 1], expert: [6, 4, 2, 1] };
/** What a cleared level of `band` earns after `slips` hints and lost lives. */
export function woEarnedPoints(band, slips) {
  const row = WO_SLIP_POINTS[band];
  if (!row) return 0;
  const n = Math.max(0, Math.floor(Number(slips) || 0));
  return row[Math.min(n, row.length - 1)];
}
/** A player's Arrow Maze points from their stats record (`games.wayout`): one band, or all four.
 *  Levels scored with their slips count what they earned; every other cleared level its full points. */
export function woPoints(rec, band = null) {
  const byDiff = (rec && rec.byDiff) || {};
  const wo = (rec && rec.wo) || {};
  const one = (b) => {
    const won = ((byDiff[b] || {}).won) | 0;
    const n = Math.min(won, Math.max(0, ((wo.ptsN || {})[b]) | 0));
    const earned = Math.max(0, Math.floor(Number((wo.pts || {})[b]) || 0));
    // A scored level earns between 1 and its full points; a count out of that range is clamped.
    return woBandPoints(b, won - n) + (n ? Math.min(n * (WO_BAND_POINTS[b] || 0), Math.max(n, earned)) : 0);
  };
  return band ? (WO_TIERS.includes(band) ? one(band) : 0) : WO_TIERS.reduce((n, b) => n + one(b), 0);
}

// --- RUSH (2026-10-14) ------------------------------------------------------------------------------
//
// A separate mode (Matt: "a new game mode where you only have a second or two ... Like those chess
// games where you start with a few seconds and get a second back for every move"). The clock starts
// at RUSH_START_MS and counts DOWN; every arrow sent off gives RUSH_GAIN_MS back, every bump costs
// RUSH_MISS_MS (Hard: rushMissMs). Boards keep coming, each a little harder, until the clock reaches
// zero. The clock never pauses during a board: leaving the app then loses the run (Matt: "If someone
// leaves the app, they lose that round"); between boards the run is saved (way-out/CLAUDE.md). Score = arrows cleared in the run. Two versions, Easy and Hard (different boards, same
// clock). The board ranks each person's BEST run of the WEEK; past weeks stay viewable.
//
// The numbers are a first guess to be tuned on real runs (every run is stored raw for that): Matt
// asked for half a second back per arrow and a 10 s start; the 3 s mistake was agreed.
export const RUSH_MODES = ['easy', 'hard'];
export const RUSH_START_MS = 10000;
export const RUSH_GAIN_MS = 500;
export const RUSH_MISS_MS = 3000;
/** The mistake cost on Rush board `i` (0 = the first), RULES 3 (Matt, 2026-10-22, after Thomas kept
 *  an Easy run going 10 minutes with 50 s banked: the cost keeps growing, never capped, so a long run
 *  gets harder even after the boards stop getting bigger).
 *    Easy: board 1 0 s, 2 1 s, 3 2 s, 4-6 3 s, 7-9 4 s, 10-12 5 s, then +0.5 s every board (30 = 14 s).
 *    Hard: boards 1-3 3 s, 4-6 4 s, 7-9 5 s, 10-12 6 s, then +0.5 s every board (30 = 15 s).
 *  Rules 1 (to v1215): 3 s flat. Rules 2 (v1216 only): Easy 3 s flat; Hard 3 s +1 s every 3 boards,
 *  capped at 7 s. Each run stores its rules number (`rv`; none = 1, or 2 by date). */
export const RUSH_RULES = 3;
export function rushMissMs(mode, i) {
  const b = Math.max(0, i | 0) + 1;
  const hard = mode === 'hard';
  if (b >= 13) return (hard ? 6000 : 5000) + 500 * (b - 12);
  if (hard) return 3000 + 1000 * Math.max(0, Math.ceil((b - 3) / 3));
  return b <= 3 ? (b - 1) * 1000 : 2000 + 1000 * Math.ceil((b - 3) / 3);
}
/** A run's tuning data (2026-10-22, Matt: "We need all this data so we know if we need to adjust the
 *  settings"), kept as short number lists so the mirror stays small:
 *    bt = play ms of each board (the last one is the board the run ended on, if any was played),
 *    ba = arrows cleared on each board (same order), bc = clock left (ms) when each board was cleared,
 *    mx = what each mistake cost (ms), mb = the board (1 = first) each mistake was on,
 *    pk = the highest the clock got (ms), gn / pn = total ms gained / lost to mistakes,
 *    res = times the run was resumed from its between-boards save, rv = RUSH_RULES it was played on.
 *  Anything malformed is left out (never crashes a reader). */
const RUSH_LISTS = ['bt', 'ba', 'bc', 'mx', 'mb'], RUSH_NUMS = ['pk', 'gn', 'pn', 'res', 'rv'];
export function woRushExtras(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of RUSH_LISTS) {
    const raw = Array.isArray(src[k]) ? src[k] : src[k] && typeof src[k] === 'object' ? Object.keys(src[k]).sort((a, b) => a - b).map((j) => src[k][j]) : null;
    if (!raw) continue;
    const v = raw.slice(0, 5000).map((x) => Math.round(+x)).filter((x) => Number.isFinite(x) && x >= 0);
    if (v.length) out[k] = v;
  }
  for (const k of RUSH_NUMS) { const x = Math.round(+src[k]); if (Number.isFinite(x) && x >= 0 && src[k] != null) out[k] = x; }
  return out;
}
/** m:ss (h:mm:ss from an hour) of a number of ms. */
export function woRushTime(ms) {
  const s = Math.max(0, Math.floor((+ms || 0) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The week a moment belongs to: the date of its MONDAY, in UTC ("2026-10-12"). One clock for
 *  everybody, wherever they play: the week turns over at Monday 00:00 UTC (Sunday evening in the
 *  US, early Monday in Spain). */
export function woWeekKey(ms = Date.now()) {
  const d = new Date(+ms || 0);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}
/** When the week that `ms` is in ends: the next Monday 00:00 UTC, in epoch ms. */
export function woWeekEnd(ms = Date.now()) {
  const [y, m, d] = woWeekKey(ms).split('-').map(Number);
  return Date.UTC(y, m - 1, d + 7);
}
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A list of runs in array or Firebase-object form; anything that is not a run is left out. A run is
 *  { s, b, ms, m, d, w, sd?, left? }: s = arrows cleared, b = boards cleared, ms = how long it
 *  lasted, m = mistakes, d = when it ended (epoch ms), w = its week, sd = the boards' seed, left = 1
 *  when it was lost by leaving the app (kept, never counted). */
export function woRushRuns(raw) {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.keys(raw).sort((a, b) => a - b).map((k) => raw[k]) : [];
  const out = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const s = Math.floor(+r.s), d = Math.floor(+r.d);
    if (!(s >= 0) || !(d > 0) || !WEEK_RE.test(r.w)) continue;
    const e = { s, b: Math.max(0, r.b | 0), ms: Math.max(0, Math.floor(+r.ms) || 0), m: Math.max(0, r.m | 0), d, w: r.w };
    if (Number.isFinite(+r.sd)) e.sd = +r.sd;
    if (r.left) e.left = 1;
    Object.assign(e, woRushExtras(r));
    out.push(e);
  }
  return out;
}
/** A best-per-week map ({ "<Monday>": arrows }) with anything malformed left out. */
export function woRushBestMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(raw)) { const v = Math.floor(+raw[k]); if (WEEK_RE.test(k) && v >= 0) out[k] = v; }
  return out;
}
/** A record's best Rush run in one week (`games.wayout`), or null when it has none that counted. */
export function woRushBest(rec, mode, week = woWeekKey()) {
  const best = woRushBestMap(((((rec || {}).wo || {}).rush || {}).best || {})[mode]);
  return Object.prototype.hasOwnProperty.call(best, week) ? best[week] : null;
}
/** Every week a record has a counted Rush run in, either mode, newest first. */
export function woRushWeeks(rec) {
  const best = ((((rec || {}).wo || {}).rush || {}).best) || {};
  const set = new Set();
  for (const m of RUSH_MODES) for (const k of Object.keys(woRushBestMap(best[m]))) set.add(k);
  return [...set].sort().reverse();
}
