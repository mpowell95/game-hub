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
// each alphabetically after the one before; or a NO-MISS BURST of 10+ right answers in a row averaging
// under 6 s each. Supporting (both together void the day): LEAVE AND BURST, 5+ right answers within
// 60 s of coming back to the app (misses allowed); and SPEED, Genius within 10 minutes of time in the
// game. A wrong or already-found guess restarts a run. Timing is each entry's `t` (the phone's clock).

export const RULES = { sortedRun: 6, burstWords: 10, burstAvgMs: 6000, leaveWords: 5, leaveMs: 60000, geniusMs: 10 * 60 * 1000, awayMs: 5 * 60 * 1000 };
const isOk = (x) => x.r === 'ok' || x.r === 'bonus';

/** entries: a player's beeLog for one puzzle ({key: {t, e, w, r}} or an array). `words`: that
 *  player's word count on the board; SPEED counts only when the log holds every one of them (a game
 *  begun before logging, or on another phone, would look fast: Lili, Oct 27). Returns
 *  { void, strong: [..], supporting: [..], sorted, burst: {n, avg}, leave, geniusMs } (ms of time in
 *  the game up to Genius, or null). */
export function detectCopying(entries, { words = 0 } = {}) {
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
    if (v.e !== 'visible') continue;
    let n = 0;
    for (const x of guesses) if (x.t > v.t && x.t - v.t <= RULES.leaveMs && isOk(x)) n++;
    leave = Math.max(leave, n);
  }

  // Speed: time in the game (no gap after hiding or closing, none over 5 min) up to Genius ('win').
  const win = ev.find((x) => x.e === 'win');
  const logged = new Set(guesses.filter(isOk).map((x) => x.w)).size;
  let geniusMs = null;
  if (win && logged >= words) {
    geniusMs = 0;
    for (let i = 1; i < ev.length && ev[i].t <= win.t; i++) {
      const gap = ev[i].t - ev[i - 1].t;
      if (ev[i - 1].e === 'hidden' || ev[i - 1].e === 'close' || gap > RULES.awayMs) continue;
      geniusMs += gap;
    }
  }

  const strong = [];
  if (sorted >= RULES.sortedRun) strong.push('sorted');
  if (burst.n >= RULES.burstWords) strong.push('burst');
  const supporting = [];
  if (leave >= RULES.leaveWords) supporting.push('leave');
  if (geniusMs != null && geniusMs < RULES.geniusMs) supporting.push('speed');
  return { void: strong.length > 0 || supporting.length >= 2, strong, supporting, sorted, burst, leave, geniusMs };
}

/** The flag line for Matt: "Sorted run 7, Burst 16 at 4.0 s, Back+5 in 60 s, Genius in 7.5 min". */
export function flagSummary(d) {
  const parts = [];
  if (d.strong.includes('sorted')) parts.push(`Sorted run ${d.sorted}`);
  if (d.strong.includes('burst')) parts.push(`Burst ${d.burst.n} at ${(d.burst.avg / 1000).toFixed(1)} s`);
  if (d.supporting.includes('leave')) parts.push(`Back+${d.leave} in 60 s`);
  if (d.supporting.includes('speed')) parts.push(`Genius in ${(d.geniusMs / 60000).toFixed(1)} min`);
  return parts.join(', ');
}

// --- the long-term board --------------------------------------------------------------------------
//
// Built from the daily board rows (beeDaily/<boardKey>/<CODE>). A row counts only what was found on
// the puzzle's OWN day: `dw`/`dp`/`dr` when the phone sent them, else the whole row (older builds,
// Oct 26). Nothing on the day = not played. A voided row = played, 0, no place, no Genius. Places are
// by POINTS per day per language, ties sharing (1, 1, 3). A replaced puzzle: the better row counts.

/** `voidedAt(puzzleKey, boardKey, flags, cfg)` -> Set of codes: the code list + the server's flags,
 *  minus Matt's undo. */
export function voidedAt(puzzleKey, boardKey, flags, cfg) {
  const out = voidedCodesFor('spellingbee', puzzleKey);
  for (const c of Object.keys(flags && typeof flags === 'object' ? flags : {})) out.add(c);
  for (const c of [...out]) if (resolveBeeUndone(cfg, boardKey, c)) out.delete(c);
  return out;
}

/**
 * daily: the whole beeDaily node. puzzles: { <boardKey>: { lang, day, key } } (functions/shared's
 * generated map). flags: the whole beeFlags node. cfg: the admin config.
 * Returns { v: 1, people: {CODE: {n, e}}, days: [{d, l, r: [[code, points, words, rank, place|0, void 0|1]]}] }.
 */
export function buildBeeBoard(daily, puzzles, flags, cfg) {
  const people = {};
  const nameAt = {};
  const best = new Map();   // `${lang}|${day}` -> Map(code -> row)
  for (const [bk, rows] of Object.entries(daily && typeof daily === 'object' ? daily : {})) {
    const pz = puzzles[bk];
    if (!pz || !rows || typeof rows !== 'object') continue;
    const off = voidedAt(pz.key, bk, (flags || {})[bk], cfg);
    for (const [code, r] of Object.entries(rows)) {
      if (!r || typeof r !== 'object' || isHiddenName(r.name)) continue;
      const own = Number.isFinite(r.dw);
      const words = (own ? r.dw : r.words) | 0;
      if (!(words > 0)) continue;   // nothing found on the puzzle's own day
      const at = Number(r.at) || 0;
      if (!nameAt[code] || at >= nameAt[code]) { nameAt[code] = at; people[code] = { n: String(r.name || code), e: String(r.emoji || '') }; }
      const v = off.has(code);
      const row = v ? { code, points: 0, words: 0, rank: 0, v: 1 } : { code, points: (own ? r.dp : r.points) | 0, words, rank: (own ? r.dr : r.rank) | 0, v: 0 };
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
