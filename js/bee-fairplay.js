// bee-fairplay.js - Spelling Bee's fair-play rules and its long-term board, PURE (2026-10-28).
//
// Spec: docs/SPELLING-BEE-INTEGRITY-SPEC.md (Matt's decisions in its section 9). One module for the
// server (functions/bee.js: detection, the board package) and the phone (the Leaderboard's Spelling
// Bee board, My Stats), so both count exactly the same way. No storage, no network, no DOM.
//
// THE LAW: nothing here writes. A void is applied when numbers are SHOWN; saves, beeDaily rows and
// beeLog entries are never changed.

import { isHiddenName } from './hidden-players.js';
import { voidedCodesFor } from './stats-corrections.js';
import { resolveBeeUndone } from './admin-config.js';

export const GENIUS = 8;   // rank index of Genius (spelling-bee/js/engine.js RANKS)
export const QUEEN = 9;

// --- detection: did this player copy the answers? ------------------------------------------------
//
// Strong (any one voids the day): a SORTED RUN of 6+ right answers in a row, all the same length,
// each alphabetically after the one before; a NO-MISS BURST of 10+ right answers in a row averaging
// under 6 s each; or BEST WORDS FIRST (2026-10-28, Matt: "getting all of the best possible words in
// order including all pangrams is simply not plausible"): the first 5 answers after opening or coming
// back to the app, within 2 minutes, are all among the 6 highest-scoring answers not yet found, each
// worth 7+ points. Supporting (any two together void the day): LEAVE AND BURST, 5+ right answers
// within 60 s of coming back to or reopening the app (misses allowed); SPEED, Genius within 10 minutes of first
// opening the puzzle, clock time with NOTHING skipped (2026-10-29, Matt: "you SHOULD NOT SKIP
// ANYTHING"; it used to drop breaks); RIGHT VS WRONG, 2+ right answers per wrong guess; and RE-TYPED, fewer
// already-found guesses than 1 per 10 right answers (both over every guess in the log; honest players re-type words they
// forgot they had; a copied list never repeats). Speed, right vs wrong and re-typed count only when
// the log holds every word on the board; right vs wrong and re-typed only with 20+ right answers. A
// wrong or already-found guess restarts a run. Timing is each entry's `t` (the phone's clock).

export const RULES = {
  sortedRun: 6, burstWords: 10, burstAvgMs: 6000, bestWords: 5, bestOf: 6, bestMinPoints: 7, bestMs: 120000,
  leaveWords: 5, leaveMs: 60000, geniusMs: 10 * 60 * 1000, rightPerWrong: 2, retypeShare: 0.1, judgeRight: 20,
};
const isOk = (x) => x.r === 'ok' || x.r === 'bonus';

/** A puzzle key's seven letters: 'e:abcdhu' or 'es:a:deiqru' -> Set. */
function lettersOf(key) {
  const p = String(key || '').split(':');
  return new Set((p[p.length - 2] || '') + (p[p.length - 1] || ''));
}
/** The NYT score (spelling-bee/js/engine.js scoreWord) from the key alone. */
export function scoreOf(word, letters) {
  const w = String(word || '');
  let pan = letters.size === 7;
  for (const c of letters) if (!w.includes(c)) { pan = false; break; }
  return (w.length === 4 ? 1 : w.length) + (pan ? 7 : 0);
}

/** entries: a player's beeLog for one puzzle ({key: {t, e, w, r}} or an array). `words`: that
 *  player's word count on the board; SPEED, RIGHT VS WRONG and RE-TYPED count only when the log holds
 *  every one of them (a game begun before logging, or on another phone, would look fast: Lili, Oct
 *  27). `puzzle`: { key, top } (top = the puzzle's highest answer scores, high first; functions/bee.js
 *  PUZZLES); without it BEST WORDS FIRST is skipped. Returns { void, strong: [..], supporting: [..],
 *  sorted, burst: {n, avg}, best, leave, geniusMs (ms from the first logged event to Genius, or null),
 *  right, wrong, retyped (every guess in the log, or null) }. */
export function detectCopying(entries, { words = 0, puzzle = null } = {}) {
  const ev = (Array.isArray(entries) ? entries : Object.values(entries || {}))
    .filter((x) => x && Number.isFinite(x.t) && typeof x.e === 'string').sort((a, b) => a.t - b.t);
  const guesses = ev.filter((x) => x.e === 'guess');

  // Sorted run.
  let sorted = 0, run = 0, prev = null;
  for (const x of guesses) {
    if (!isOk(x) || typeof x.w !== 'string') { run = 0; prev = null; continue; }
    run = prev && prev.length === x.w.length && x.w > prev ? run + 1 : 1;
    prev = x.w;
    sorted = Math.max(sorted, run);
  }

  // No-miss burst: inside each unbroken run of right answers, the longest stretch whose average gap
  // is under the limit.
  let burst = { n: 0, avg: 0 };
  let cur = [];
  const closeRun = () => {
    for (let i = 0; i < cur.length; i++) {
      for (let j = cur.length - 1; j - i + 1 > Math.max(burst.n, 1); j--) {
        const avg = (cur[j] - cur[i]) / (j - i);
        if (avg < RULES.burstAvgMs) { burst = { n: j - i + 1, avg }; break; }
      }
    }
    cur = [];
  };
  for (const x of guesses) { if (isOk(x)) cur.push(x.t); else closeRun(); }
  closeRun();

  // Leave and burst.
  let leave = 0;
  for (const v of ev) {
    if (v.e !== 'visible' && v.e !== 'open') continue;   // back to the app, or reopened (2026-10-29: 'open' was skipped)
    let n = 0;
    for (const x of guesses) if (x.t > v.t && x.t - v.t <= RULES.leaveMs && isOk(x)) n++;
    leave = Math.max(leave, n);
  }

  // Best words first: from each open / return, the answers ('ok', not bonus words) before the player
  // leaves again or 2 minutes pass. `best` = the most of them in a row, from the start, that rank among
  // the 6 highest-scoring answers still unfound then (ties count) and score 7+.
  let best = 0;
  if (puzzle && Array.isArray(puzzle.top) && puzzle.top.length) {
    const letters = lettersOf(puzzle.key);
    for (const s of ev) {
      if (s.e !== 'open' && s.e !== 'visible') continue;
      const left = puzzle.top.slice();
      const seen = new Set();
      for (const x of guesses) {
        if (x.t > s.t || x.r !== 'ok' || seen.has(x.w)) continue;
        seen.add(x.w);
        const i = left.indexOf(scoreOf(x.w, letters));
        if (i >= 0) left.splice(i, 1);
      }
      if (left.length < RULES.bestOf) continue;
      const bar = Math.max(left[RULES.bestOf - 1], RULES.bestMinPoints);
      let n = 0;
      for (const x of ev) {
        if (x.t <= s.t) continue;
        if (x.t - s.t > RULES.bestMs || x.e === 'hidden' || x.e === 'close') break;
        if (x.e !== 'guess' || x.r !== 'ok' || seen.has(x.w)) continue;
        seen.add(x.w);
        if (scoreOf(x.w, letters) < bar) break;
        n++;
      }
      best = Math.max(best, n);
    }
  }

  // Speed: clock time from the first logged event (opening the puzzle) to Genius ('win'). Nothing is
  // skipped: breaks, hidden and closed time all count.
  const win = ev.find((x) => x.e === 'win');
  const logged = new Set(guesses.filter(isOk).map((x) => x.w)).size;
  let geniusMs = null, right = null, wrong = null, retyped = null;
  if (win && logged >= words) {
    geniusMs = win.t - ev[0].t;
  }
  // Right vs wrong and re-typed: EVERY guess in the log, Genius or not (2026-10-29, Matt: "you SHOULD
  // NOT SKIP ANYTHING"; it used to stop at Genius and need Genius). Needs the whole game in the log.
  if (logged >= words) {
    right = guesses.filter(isOk).length;
    retyped = guesses.filter((x) => x.r === 'already_found').length;
    wrong = guesses.length - right - retyped;
  }

  const strong = [];
  if (sorted >= RULES.sortedRun) strong.push('sorted');
  if (burst.n >= RULES.burstWords) strong.push('burst');
  if (best >= RULES.bestWords) strong.push('best');
  const supporting = [];
  if (leave >= RULES.leaveWords) supporting.push('leave');
  if (geniusMs != null && geniusMs < RULES.geniusMs) supporting.push('speed');
  const judged = right != null && right >= RULES.judgeRight;
  // RIGHT VS WRONG is RETIRED (2026-10-29): Ana, playing honestly next to Matt, got 30 right / 12 wrong (2.5) and was
  // voided with it (+ Back+9). docs/INTEGRITY-CHECKS.md rule 4: a check honest players trip is dropped. right/wrong stay counted.
  if (judged && retyped < RULES.retypeShare * right) supporting.push('retype');
  return { void: strong.length > 0 || supporting.length >= 2, strong, supporting, sorted, burst, best, leave, geniusMs, right, wrong, retyped };
}

/** The flag line for Matt: "Sorted run 7, Burst 16 at 4.0 s, Best 6 first, Back+5 in 60 s, Genius
 *  in 7.5 min, Right 46 / wrong 17, Re-typed 3". */
export function flagSummary(d) {
  const parts = [];
  if (d.strong.includes('sorted')) parts.push(`Sorted run ${d.sorted}`);
  if (d.strong.includes('burst')) parts.push(`Burst ${d.burst.n} at ${(d.burst.avg / 1000).toFixed(1)} s`);
  if (d.strong.includes('best')) parts.push(`Best ${d.best} first`);
  if (d.supporting.includes('leave')) parts.push(`Back+${d.leave} in 60 s`);
  if (d.supporting.includes('speed')) parts.push(`Genius in ${(d.geniusMs / 60000).toFixed(1)} min`);
  if (d.supporting.includes('ratio')) parts.push(`Right ${d.right} / wrong ${d.wrong}`);
  if (d.supporting.includes('retype')) parts.push(`Re-typed ${d.retyped}`);
  return parts.join(', ');
}

// --- whose clock: own-day words from the log, on the SERVER's clock (2026-10-29) -------------------
//
// The phone's `dw`/`dp`/`dr` come from its own clock: a phone set back to a puzzle's day could post that
// day's words later (after seeing its answers), a phone set ahead could read today's answers as
// "yesterday's". The log has both clocks: `t` (the phone's, at the guess), `s` (the server's, at upload),
// and since 2026-10-29 `z` (the phone's time-zone offset, minutes, Date#getTimezoneOffset). A word
// counts for its puzzle's day only when
//   1. `t` falls on the puzzle's day: local by `z`; without `z`, anywhere on Earth (UTC+14 to UTC-12);
//   2. it reached the server within 24 h after `t`, and `t` is not over 1 h AHEAD of the server;
//   3. it reached the server by the end of that day (same clock as 1) plus 10 minutes. Yesterday's
//      Answers opens at midnight, so a word sent after it (phone set back to the day before) is out.
//      Honest cost: words played OFFLINE and sent after the next midnight count on the phone only.
// A ROW posted more than a day after the puzzle's day ended everywhere (`isLatePost`) counts only
// what its log proves (a phone set back to a past day to post it); with no log, nothing.

export const OWN_DAY = {
  graceMs: 10 * 60 * 1000, uploadMs: 24 * 60 * 60 * 1000, aheadMs: 60 * 60 * 1000,
  lateMs: (36 + 24) * 60 * 60 * 1000,   // from the day's UTC midnight: its end at UTC-12, plus a day
};
const HOUR = 60 * 60 * 1000;
const dayStart = (day) => Date.parse(`${day}T00:00:00Z`);
const PCTS = [0, 2, 5, 8, 15, 25, 40, 50, 70, 100];   // spelling-bee/js/engine.js RANKS

/** [start, end) of `day` ('YYYY-MM-DD') in ms: local by `z` (minutes, getTimezoneOffset), or the
 *  widest span the date covers anywhere when `z` is unknown. */
export function dayWindow(day, z) {
  const d0 = dayStart(day);
  if (Number.isFinite(z) && Math.abs(z) <= 14 * 60) return [d0 + z * 60000, d0 + 24 * HOUR + z * 60000];
  return [d0 - 14 * HOUR, d0 + 36 * HOUR];
}

/** One accepted log entry {t, s, z?}: does it count for the puzzle's own day? */
export function countsOnDay(x, day) {
  if (!x || !Number.isFinite(x.t) || !Number.isFinite(x.s) || !day) return false;
  const [lo, hi] = dayWindow(day, x.z);
  if (x.t < lo || x.t >= hi) return false;
  if (x.s - x.t > OWN_DAY.uploadMs || x.t - x.s > OWN_DAY.aheadMs) return false;
  return x.s <= hi + OWN_DAY.graceMs;
}

/** A board row's `at` (server time of its last post) more than a day after the puzzle's day ended. */
export function isLatePost(day, at) {
  return !!day && Number.isFinite(Number(at)) && Number(at) > dayStart(day) + OWN_DAY.lateMs;
}

/** Rank index from points (engine.js rankIndex): Queen Bee needs every answer. */
export function rankOf(points, max, all) {
  let i = 0;
  for (let k = 0; k < PCTS.length; k++) if (points >= (PCTS[k] === 100 ? max : Math.round((PCTS[k] / 100) * max))) i = k;
  return i === QUEEN && !all ? GENIUS : i;
}

/** The own-day numbers a log proves. puzzle: { key, day, max, n } (n = answers in the puzzle).
 *  Returns { w, p, r, logged } (`logged` = distinct accepted words in the log, on any day). */
export function ownDayFromLog(entries, puzzle) {
  const ev = (Array.isArray(entries) ? entries : Object.values(entries || {}))
    .filter((x) => x && x.e === 'guess' && isOk(x) && typeof x.w === 'string' && Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  const letters = lettersOf(puzzle && puzzle.key);
  const seen = new Set();
  let w = 0, p = 0, answers = 0;
  for (const x of ev) {
    if (seen.has(x.w)) continue;
    seen.add(x.w);   // a word counts at its FIRST acceptance only
    if (!countsOnDay(x, puzzle.day)) continue;
    w++; p += scoreOf(x.w, letters);
    if (x.r === 'ok') answers++;
  }
  const max = Number(puzzle && puzzle.max) || 0;
  const r = max > 0 ? rankOf(p, max, Number(puzzle.n) > 0 && answers >= Number(puzzle.n)) : 0;
  return { w, p, r, logged: seen.size };
}

/** What the server stores per row (boards/v1/beeOwn/<boardKey>/<CODE>), or null = trust the row's own
 *  numbers (current behaviour: no log and on time, or a log that is missing words). `use: 1` = the board
 *  uses {w, p, r}. `at` = the row's `at` it was computed for. */
export function ownEntry(row, log, puzzle) {
  if (!row || !puzzle) return null;
  const late = isLatePost(puzzle.day, row.at);
  const hasLog = !!log && typeof log === 'object' && Object.keys(log).length > 0;
  if (!hasLog) return late ? { w: 0, p: 0, r: 0, at: Number(row.at) || 0, use: 1 } : null;
  const o = ownDayFromLog(log, puzzle);
  const full = o.logged >= (Number(row.words) | 0);
  if (!late && !full) return null;
  return { w: o.w, p: o.p, r: o.r, at: Number(row.at) || 0, use: 1 };
}

/** The numbers a row counts with: the server's own-day entry when it applies to this very post, else
 *  the phone's own-day fields, else the whole row; a late post with no entry counts nothing. */
export function countedRow(row, own, day) {
  if (own && own.use && Number(own.at) === Number(row.at)) return { words: own.w | 0, points: own.p | 0, rank: own.r | 0 };
  if (isLatePost(day, row.at)) return { words: 0, points: 0, rank: 0 };
  const d = Number.isFinite(row.dw);
  return { words: (d ? row.dw : row.words) | 0, points: (d ? row.dp : row.points) | 0, rank: (d ? row.dr : row.rank) | 0 };
}

// --- the long-term board --------------------------------------------------------------------------
//
// Built from the daily board rows (beeDaily/<boardKey>/<CODE>). A row counts only what was found on
// the puzzle's OWN day: `dw`/`dp`/`dr` when the phone sent them, else the whole row (older builds,
// Oct 26). Nothing on the day = not played. A voided row = played, 0, no place, no Genius. Places are
// by POINTS per day per language, ties sharing (1, 1, 3). A replaced puzzle: the better row counts.

const STRONG_RULES = new Set(['sorted', 'burst', 'best']);
const RETIRED_RULES = new Set(['ratio']);   // see detectCopying
/** Does a stored beeFlags entry still void under today's rules? A flag is written once and never re-checked, so
 *  one resting on a RETIRED rule (Ana, Oct 29: leave + ratio) stops counting at read time. Nothing is deleted. A
 *  flag without a rules list stands. */
export function flagStands(f) {
  if (!f || typeof f !== 'object') return false;
  if (!f.rules || typeof f.rules !== 'object') return true;
  const live = Object.values(f.rules).filter((r) => !RETIRED_RULES.has(r));
  return live.some((r) => STRONG_RULES.has(r)) || live.length >= 2;
}

/** `voidedAt(puzzleKey, boardKey, flags, cfg)` -> Set of codes: the code list + the server's flags that still
 *  stand (`flagStands`), minus Matt's undo. */
export function voidedAt(puzzleKey, boardKey, flags, cfg) {
  const out = voidedCodesFor('spellingbee', puzzleKey);
  for (const [c, f] of Object.entries(flags && typeof flags === 'object' ? flags : {})) if (flagStands(f)) out.add(c);
  for (const c of [...out]) if (resolveBeeUndone(cfg, boardKey, c)) out.delete(c);
  return out;
}

/**
 * daily: the whole beeDaily node. puzzles: { <boardKey>: { lang, day, key } } (functions/shared's
 * generated map). flags: the whole beeFlags node. cfg: the admin config. own: boards/v1/beeOwn (the
 * server's own-day numbers per row, `ownEntry`; absent = every row's own numbers, as before).
 * Returns { v: 1, people: {CODE: {n, e}}, days: [{d, l, r: [[code, points, words, rank, place|0, void 0|1]]}] }.
 */
export function buildBeeBoard(daily, puzzles, flags, cfg, own) {
  const people = {};
  const nameAt = {};
  const best = new Map();   // `${lang}|${day}` -> Map(code -> row)
  for (const [bk, rows] of Object.entries(daily && typeof daily === 'object' ? daily : {})) {
    const pz = puzzles[bk];
    if (!pz || !rows || typeof rows !== 'object') continue;
    const off = voidedAt(pz.key, bk, (flags || {})[bk], cfg);
    for (const [code, r] of Object.entries(rows)) {
      if (!r || typeof r !== 'object' || isHiddenName(r.name)) continue;
      const c = countedRow(r, ((own || {})[bk] || {})[code], pz.day);
      const words = c.words;
      if (!(words > 0)) continue;   // nothing found on the puzzle's own day (or a late post the log does not back)
      const at = Number(r.at) || 0;
      if (!nameAt[code] || at >= nameAt[code]) { nameAt[code] = at; people[code] = { n: String(r.name || code), e: String(r.emoji || '') }; }
      const v = off.has(code);
      const row = v ? { code, points: 0, words: 0, rank: 0, v: 1 } : { code, points: c.points, words, rank: c.rank, v: 0 };
      const k = `${pz.lang}|${pz.day}`;
      if (!best.has(k)) best.set(k, new Map());
      const m = best.get(k);
      const had = m.get(code);
      // A replaced puzzle: the better row counts; a void on either makes the day void.
      if (!had) m.set(code, row);
      else if (row.v || had.v) m.set(code, { code, points: 0, words: 0, rank: 0, v: 1 });
      else if (row.points > had.points || (row.points === had.points && row.words > had.words)) m.set(code, row);
    }
  }
  const days = [];
  for (const [k, m] of best) {
    const [l, d] = k.split('|');
    const rows = [...m.values()].sort((a, b) => a.v - b.v || b.points - a.points || b.words - a.words || a.code.localeCompare(b.code));
    let place = 0;
    const r = rows.map((x, i) => {
      if (!x.v && (i === 0 || x.points !== rows[i - 1].points)) place = i + 1;
      return [x.code, x.points, x.words, x.rank, x.v ? 0 : place, x.v];
    });
    days.push({ d, l, r });
  }
  days.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.l < b.l ? -1 : 1));
  return { v: 1, people, days };
}

/** One row per person for a toggle: lang 'all' | 'en' | 'es'; by 'points' | 'words'. Sorted by that
 *  number, then the other, then name. Each: {code, name, emoji, points, words, first, second, third,
 *  genius, queen, days}. `days` = distinct dates played (All counts a date once). */
export function beeTotals(board, { lang = 'all', by = 'points' } = {}) {
  const out = new Map();
  const dates = new Map();
  for (const day of (board && board.days) || []) {
    if (lang !== 'all' && day.l !== lang) continue;
    for (const [code, points, words, rank, place] of day.r) {
      if (!out.has(code)) {
        const p = (board.people || {})[code] || {};
        out.set(code, { code, name: p.n || code, emoji: p.e || '', points: 0, words: 0, first: 0, second: 0, third: 0, genius: 0, queen: 0, days: 0 });
        dates.set(code, new Set());
      }
      const t = out.get(code);
      t.points += points; t.words += words;
      if (place === 1) t.first++; else if (place === 2) t.second++; else if (place === 3) t.third++;
      if (rank >= GENIUS) t.genius++;
      if (rank >= QUEEN) t.queen++;
      dates.get(code).add(day.d);
    }
  }
  for (const [code, t] of out) t.days = dates.get(code).size;
  const other = by === 'words' ? 'points' : 'words';
  return [...out.values()].sort((a, b) => b[by] - a[by] || b[other] - a[other] || a.name.localeCompare(b.name));
}
