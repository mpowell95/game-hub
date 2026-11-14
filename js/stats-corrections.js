// js/stats-corrections.js - ADMIN CORRECTIONS: the read-time layer that lets Matt say "those scores
// were thrown on a machine that was broken at the time, and they do not count."
//
// WHY THIS EXISTS (2026-08-24). Twice - THE CLASSIC and BASKET FEVER - a machine handed out scores
// while its physics were half-tuned, and those scores went into everybody's real record. Editing
// them out of Firebase by hand does not work and cannot be made to work: js/stats-net.js mirrors
// each device's WHOLE local store on every hub load, so the phone's copy overwrites the edit within
// minutes. The device is the source of truth for its own history and this file does not change that
// (THE LAW: nothing here deletes, rewrites or risks a single stored number).
//
// Instead a correction is an OVERLAY, stored where no phone can reach it (`adminConfig/v1`, written
// by the admin page only) and applied every time a number is DISPLAYED. The raw record stays
// exactly as the player's device recorded it - which is also the only honest answer to "why does my
// best say 0 when I remember 700": the 700 is still there, it is marked as not counting, and the
// reason and the date are stored beside it.
//
// THE SHAPE of one correction, per player-device (statsId) per machine:
//
//   { plays, points, best, bestThrow,  // the board's raw totals AT THE MOMENT it was voided
//     upto: 'YYYY-MM-DD',              // daily entries up to and including this day are dropped
//     at, by, why }
//
// It is a BASELINE, not a fixed subtraction, and that is deliberate: everything recorded up to the
// moment of the void stops counting, and everything recorded AFTER it counts normally. Throw a
// legitimate 300 on the fixed machine tomorrow and it shows as 300 - the correction does not have
// to be undone, and it never has to be edited again.
//
// WHAT IT CANNOT DO, stated plainly rather than discovered later:
//   - A device that was offline through the bad build still holds those racks and will upload them
//     the next time it opens the hub. They land AFTER the baseline, so they count. The admin page
//     shows the raw numbers beside the corrected ones so that drift is visible, and re-voiding is
//     one tap. A per-machine cutoff by build number would catch it automatically; per-player is
//     what was asked for (Matt, 2026-08-24) and this is the cost of it.
//   - `sk.balls`, `hundreds`, `fifties`, `tens`..`forties` and `colorSweeps` are LIFETIME counters
//     with no per-machine breakdown stored anywhere, so a per-machine void cannot touch them. They
//     are left exactly as they are rather than guessed at (THE LAW rule 4: never fabricate a
//     conversion between things the store does not actually relate).

// --- voided online matches -------------------------------------------------------------------------
// Left out of every list and record, and taken back out of the stats of a phone that had counted it.
export const VOIDED_MATCHES = {
  darts: {
    muzgz01qh0z10nqo: { winner: '3VN33', loser: 'QZCC4' },
  },
  // A Spelling Bee DAY (Matt, 2026-10-27: "Do not add today to the leaderboard for Moonis... I meant that
  // it should not be transferred to the long term leaderboard"). `puzzle` = the save/board key. The day's
  // own board still shows him; his Genius win comes out of 'daily', and any long-term Spelling Bee
  // board (words, points) must leave that day out for him via voidedCodesFor.
  spellingbee: {
    // `keepPlayed`: the day still counts as PLAYED, with nothing in it (Matt, 2026-10-28: "show that he
    // played, but make it so his score is 0"); only the Genius win comes out.
    enachlnrt: { winner: '3VN33', puzzle: 'a:chlnrt', day: '2026-10-26', bucket: 'daily', keepPlayed: true },   // Oct 26 (Matt: "VOID")
    enaciltuy: { winner: '3VN33', puzzle: 'a:ciltuy', day: '2026-10-27', bucket: 'daily', keepPlayed: true },
    eneabcdhu: { winner: '3VN33', puzzle: 'e:abcdhu', day: '2026-10-28', bucket: 'daily', keepPlayed: true },   // Oct 28 (Matt: "void today for him too")
  },
};
// HAND ADDS: a Spelling Bee word Matt credits by hand to one player's day (Matt, 2026-10-29: "At 11:59pm eastern,
// count niggling for MattyIce's score. Adding 8 points to the final daily score"; "you MUST add it at 11:59"). Read time
// only, like the voids: nothing stored changes, the player's save, beeDaily row and log stay as they are. On from
// `from` (ms; the server's clock where known), counted in the in-game board, the long-term board and the Leaderboard.
export const HAND_ADDS = {
  spellingbee: [
    { code: 'QZCC4', puzzle: 'g:ailnvz', day: '2026-10-29', word: 'niggling', words: 1, points: 8, from: Date.UTC(2026, 9, 30, 3, 59) },   // 11:59 PM EDT
  ],
};
// HAND RESULTS: one result Matt counts by hand that the game filed somewhere that counts for nothing (Matt, 2026-11-08,
// of his Flick Soccer Test mode win: "That test win should count"). Read time only, like HAND_ADDS: the player's stored
// record (the win sits in games.flicksoccer.fx) and play log stay exactly as they are. Each entry is added the way the
// game's own recorder would have filed it (`diff` = the RECORDED bucket, `chosen` + `mode` = its byMode row, `detail`
// = its dt numbers), BEFORE the full-level move and the points, so it shows and scores like any other such win.
export const HAND_RESULTS = {
  // Matt's Nov 8 2:22 AM Test mode win was the first entry here; it now counts through FLICK_TEST_COUNTS below with
  // every other Test game (Matt, 2026-11-08: "count all test games"), so it is not listed twice.
  flicksoccer: [],
};
// FLICK SOCCER TEST GAMES COUNT (Matt, 2026-11-08: "count all test games"; "it's the same thing, just with the next
// change"). Builds from v1507 record a Test mode game like any other result (its mode carries test=1). Games played
// before that sit in the test bucket games.flicksoccer.fx (recordFlickSoccerTest): every fx byMode row whose mode has
// test=1 is added here, per RECORD at read time, as the recorder would have filed it (first to 1 one level down, as
// statsDiff does), wins AND losses. Expert games stay in fx, counted by nothing. The stored record is untouched.
const FLICK_LEVELS = ['easy', 'medium', 'hard'];
const isTestKey = (k) => /(^|\|)test=1(\||$)/.test(String(k || ''));
/** One record's Flick Soccer game with its pre-v1507 Test games (fx) counted; `gm` itself when there are none. */
export function flickTestGame(gm) {
  const fx = gm && gm.fx && gm.fx.byMode && typeof gm.fx.byMode === 'object' ? gm.fx.byMode : null;
  if (!fx) return gm;
  let out = null;
  for (const [k, ds] of Object.entries(fx)) {
    if (!isTestKey(k) || !ds || typeof ds !== 'object') continue;
    const short = modeParts(k).goals === '1';
    for (const lvl of FLICK_LEVELS) {
      const b = ds[lvl];
      if (!b || typeof b !== 'object') continue;
      const n = { played: Math.max(0, b.played | 0), won: Math.max(0, b.won | 0), lost: Math.max(0, b.lost | 0) };
      if (!n.played && !n.won && !n.lost) continue;
      if (!out) out = Object.assign({}, gm, { total: Object.assign({ played: 0, won: 0, lost: 0 }, gm.total), byDiff: Object.assign({}, gm.byDiff), byMode: Object.assign({}, gm.byMode) });
      const rec = short ? FLICK_LEVELS[Math.max(0, FLICK_LEVELS.indexOf(lvl) - 1)] : lvl;
      const add = (o) => { const x = Object.assign({ played: 0, won: 0, lost: 0 }, o); for (const f of Object.keys(n)) x[f] = (x[f] | 0) + n[f]; return x; };
      out.total = add(out.total);
      out.byDiff[rec] = add(out.byDiff[rec]);
      const row = Object.assign({}, out.byMode[k]);
      row[lvl] = add(row[lvl]);
      out.byMode[k] = row;
    }
  }
  return out || gm;
}
/** A whole stats store with its Flick Soccer Test games counted (My Stats' first paint). */
export function flickTestStats(st) {
  const g = st && st.games && st.games.flicksoccer;
  const f = g ? flickTestGame(g) : g;
  return f === g ? st : Object.assign({}, st, { games: Object.assign({}, st.games, { flicksoccer: f }) });
}
/** `gm` (one person's record in game `id`) with that person's HAND_RESULTS added; `gm` itself when none. Never mutates. */
export function handResultsGame(gm, id, code) {
  const list = (HAND_RESULTS[id] || []).filter((r) => r && r.code === code);
  if (!list.length) return gm;
  const g = gm || {};
  const out = Object.assign({}, g, {
    total: Object.assign({ played: 0, won: 0, lost: 0 }, g.total),
    byDiff: Object.assign({}, g.byDiff),
    byMode: Object.assign({}, g.byMode),
    dt: Object.assign({}, g.dt),
  });
  const bump = (b, won) => { const o = Object.assign({ played: 0, won: 0, lost: 0 }, b); o.played += 1; if (won === true) o.won += 1; else if (won === false) o.lost += 1; return o; };
  for (const r of list) {
    out.total = bump(out.total, r.won);
    out.byDiff[r.diff] = bump(out.byDiff[r.diff], r.won);
    const row = Object.assign({}, out.byMode[r.mode]);
    row[r.chosen] = bump(row[r.chosen], r.won);
    out.byMode[r.mode] = row;
    if (r.detail) { for (const [k, v] of Object.entries(r.detail)) out.dt[k] = (+out.dt[k] || 0) + v; out.dt._n = (+out.dt._n || 0) + 1; }
  }
  return out;
}
/** A whole stats store with `code`'s HAND_RESULTS added (My Stats' first paint). */
export function handResultsStats(st, code) {
  if (!st || !st.games || !code) return st;
  let games = null;
  for (const id of Object.keys(HAND_RESULTS)) {
    const f = handResultsGame(st.games[id], id, code);
    if (f !== st.games[id]) (games || (games = Object.assign({}, st.games)))[id] = f;
  }
  return games ? Object.assign({}, st, { games }) : st;
}
// FULL LEVEL: a shortened or easier setting the game RECORDS one level down (docs/INTEGRITY-CHECKS-SPEC.md, "Holes closed
// 2026-10-29: quitting and easier settings") SHOWS at the level PICKED. Matt, 2026-11-07 (Flick Soccer, him only), then
// everyone ("Yes. Of course. Obviously."), then every game with such a rule (2026-11-08, "FIX THIS ALL PERMANENTLY"):
// a Hard game is a Hard game. Read time only: byDiff stays exactly as recorded. byMode keeps the PICKED level, so it
// says which games they were, past and future alike; at most what byDiff holds is moved. POINTS never change: the
// result carries `fl` (what was moved) and js/lb-points.js gamePoints undoes it before pricing (fullLevelWins).
// Results from before 2026-10-30 saved no mode and stay where they were recorded. A table of computers still shows at
// its easiest computer (that IS the level its mode saved). `short` reads a byMode key's parts (strings; '.' is stripped
// from saved values, so Boggle's 1.5 minutes reads '15').
const L3 = ['easy', 'medium', 'hard'];
const ccShortMode = (m) => {   // Chinchón's isShortMatch, on its saved mode (vc / sl / rl)
  const pts = (+m.sl || 100) < 100, rnd = (+m.rl || 10) < 10;
  return m.vc === 'rounds' ? rnd : m.vc === 'roundsOrPoints' ? (pts || rnd) : pts;
};
export const FULL_LEVEL_GAMES = {
  flicksoccer: { ladder: L3, short: (m) => m.goals === '1' },                       // first to 1
  eightball: { ladder: L3, short: (m) => m.racks === '1' },                         // 1 rack
  cuppong: { ladder: L3, short: (m) => m.rr === 'inf' },                            // unlimited reracks
  darts: { ladder: L3, short: (m) => m.kind === '201' || m.kind === '101' },        // 201 / 101
  dominoes: { ladder: L3, short: (m) => +m.to > 0 && +m.to < 300 },                 // to 150
  boggle: { ladder: ['beginner', 'intermediate', 'pro'], short: (m) => m.min === '2' },   // the 2-minute timer
  hoops4: { ladder: L3, short: (m) => m.one === '0' },                              // until you score
  chinchon: { ladder: ['easy', 'normal', 'hard'], short: ccShortMode },             // a short match
};
/** Per game, its moves, top level first (so a level still holds the games being taken out of it): [{ level, from, short }]. */
export const FULL_LEVEL = Object.fromEntries(Object.entries(FULL_LEVEL_GAMES).map(([id, g]) => {
  const rules = [];
  for (let i = g.ladder.length - 1; i >= 1; i--) rules.push({ code: '*', level: g.ladder[i], from: g.ladder[i - 1], short: g.short });
  return [id, rules];
}));
const modeParts = (k) => {
  const m = {};
  for (const p of String(k || '').split('|')) { const i = p.indexOf('='); if (i > 0) m[p.slice(0, i)] = p.slice(i + 1); }
  return m;
};
/** `gm` (one person's game `id`) with FULL_LEVEL applied; `gm` itself when nothing moves. Never mutates. The result
 *  carries `fl` = [{ level, from, won, keys }] (what was moved, and the byMode keys it came from), read by gamePoints;
 *  a record that already has `fl` is returned as it is, so nothing is ever moved twice. `code` is kept for callers. */
export function fullLevelGame(gm, id, code) {   // eslint-disable-line no-unused-vars
  if (!gm || Array.isArray(gm.fl) || !gm.byDiff || !gm.byMode || typeof gm.byMode !== 'object') return gm;
  let out = null;
  for (const r of FULL_LEVEL[id] || []) {
    const n = { played: 0, won: 0, lost: 0 };
    const keys = [];
    for (const [k, ds] of Object.entries(gm.byMode)) {
      let ok = false;
      try { ok = k !== '?' && ds && typeof ds === 'object' && r.short(modeParts(k)); } catch { ok = false; }
      const b = ok ? ds[r.level] : null;
      if (!b || typeof b !== 'object') continue;
      keys.push(k);
      for (const f of Object.keys(n)) n[f] += Math.max(0, b[f] | 0);
    }
    const src = (out || gm).byDiff[r.from];
    if (!src || typeof src !== 'object') continue;
    const mv = {};
    let any = false;
    for (const f of Object.keys(n)) { mv[f] = Math.min(n[f], Math.max(0, src[f] | 0)); if (mv[f]) any = true; }
    if (!any) continue;
    if (!out) out = Object.assign({}, gm, { byDiff: Object.assign({}, gm.byDiff) });
    const from = Object.assign({}, out.byDiff[r.from]);
    const to = Object.assign({ played: 0, won: 0, lost: 0 }, out.byDiff[r.level]);
    for (const f of Object.keys(mv)) { from[f] = (from[f] | 0) - mv[f]; to[f] = (to[f] | 0) + mv[f]; }
    out.byDiff[r.from] = from;
    out.byDiff[r.level] = to;
    out.fl = (out.fl || []).concat([{ level: r.level, from: r.from, won: mv.won, keys }]);
  }
  return out || gm;
}
/** What FULL_LEVEL moved in `gm` ([{ level, from, won, keys }]; [] for a record it was not applied to). */
export function fullLevelWins(gm) {
  return gm && Array.isArray(gm.fl) ? gm.fl.filter((x) => x && typeof x === 'object') : [];
}
/** `gm` as it was recorded (the moved WINS put back where the game counted them), with the wins of `drop` (a subset
 *  of its fl) then taken out of their recorded level and of the byMode rows they came from. For points only. */
export function fullLevelRaw(gm, drop = []) {
  const fl = fullLevelWins(gm);
  if (!fl.length) return gm;
  const out = Object.assign({}, gm, { byDiff: Object.assign({}, gm.byDiff), total: Object.assign({}, gm.total) });
  delete out.fl;
  const add = (lvl, n) => { const b = Object.assign({ played: 0, won: 0, lost: 0 }, out.byDiff[lvl]); b.won = Math.max(0, (b.won | 0) + n); out.byDiff[lvl] = b; };
  for (const x of fl) { add(x.level, -(x.won | 0)); add(x.from, x.won | 0); }
  if (drop.length) {
    out.byMode = Object.assign({}, gm.byMode);
    for (const x of drop) {
      add(x.from, -(x.won | 0));
      out.total.won = Math.max(0, (out.total.won | 0) - (x.won | 0));
      let left = x.won | 0;
      for (const k of x.keys || []) {
        if (left <= 0) break;
        const ds = out.byMode[k];
        const b = ds && ds[x.level];
        if (!b) continue;
        const take = Math.min(left, Math.max(0, b.won | 0));
        out.byMode[k] = Object.assign({}, ds, { [x.level]: Object.assign({}, b, { won: (b.won | 0) - take }) });
        left -= take;
      }
    }
  }
  return out;
}
/** A whole stats store with FULL_LEVEL applied; `st` itself when nothing changes. */
export function fullLevelStats(st, code) {
  if (!st || !st.games) return st;
  let games = null;
  for (const id of Object.keys(FULL_LEVEL)) {
    const g = st.games[id];
    const f = g ? fullLevelGame(g, id, code) : g;
    if (f !== g) (games || (games = Object.assign({}, st.games)))[id] = f;
  }
  return games ? Object.assign({}, st, { games }) : st;
}
// ADJUSTMENTS (Matt, 2026-11-07: "I want to edit firebase directly and have it stick"). Numbers Matt types in the
// Firebase console at adminConfig/v1/corrections/adjust/<CODE>/<stats game id>/<level>/{played, won, lost} are ADDED to
// that person's record at read time (a negative number takes away; a result never goes below 0). `total` moves with the
// level. No phone ever writes adminConfig, so an edit sticks; players/ records are untouched; deleting the entry undoes
// it. Only played/won/lost: a game's own extra counters (points, bests) are not touched.
// HAND ADJUSTMENTS: the same slots as the console's adjust node, in CODE, merged into that person's adjust entry at read
// time (`withHandAdjust`), so a session can make one Matt asks for without writing adminConfig. Summed with his own edits.
// TOWER STACK RUNS BEFORE LOWS WERE SAVED (Matt, 2026-11-14: "I should be able to see their high, low, and average for
// every difficulty"). js/game-stats.js recordTower saves each difficulty's lowest run (`tw.lowByDiff`) only from
// 2026-11-14; byMode's running totals (`hs`/`hn`, the average) only from 2026-11-06. Every earlier run is in the play
// log (playLog/<CODE>, read 2026-11-14 with tools/read-play-log.mjs: 89 runs, the same counts as the stored records).
// Read time, display only (game-stats-ui.js rowsTower), per CODE: `lo` = the lowest run at each difficulty in the play
// log (a least, so overlapping the saved low is harmless); `pre` = the runs that carry no running total ({n, s}: count
// and blocks), added to byMode's `hs`/`hn` for the average. The stored records are untouched.
export const TOWER_BEFORE = {
  QZCC4: { lo: { easy: 33, medium: 24, hard: 5, expert: 10 }, pre: { medium: { n: 2, s: 51 }, expert: { n: 1, s: 15 } } },
  '3VN33': { lo: { easy: 37, medium: 30, hard: 18, expert: 1 } },
  K99MB: { lo: { medium: 17, hard: 11, expert: 2 } },
  '3G2EC': { lo: { medium: 2 } },
};
export const HAND_ADJUST = {
  // Matt, 2026-11-09: "Make them medium. I thought I was playing medium because I had clicked medium." His Connect 4
  // Hoops one-shot wins of Nov 9 1:16 and 1:17 AM ET were a saved Easy match resumed by Continue while Medium was picked.
  QZCC4: { hoops4: { 'easy~first=me|one=1': { played: -2, won: -2 }, 'medium~first=me|one=1': { played: 2, won: 2 } } },
};
/** One person's adjust entry ({ <game>: { <slot>: {played, won, lost} } }) with their HAND_ADJUST added. */
export function withHandAdjust(adj, code) {
  const h = HAND_ADJUST[String(code || '').trim().toUpperCase()];
  if (!h) return adj;
  const out = Object.assign({}, adj && typeof adj === 'object' ? adj : {});
  for (const [g, slots] of Object.entries(h)) {
    const gg = Object.assign({}, out[g] && typeof out[g] === 'object' ? out[g] : {});
    for (const [slot, f] of Object.entries(slots)) {
      const cur = Object.assign({}, gg[slot] && typeof gg[slot] === 'object' ? gg[slot] : {});
      for (const k of Object.keys(f)) cur[k] = (Math.trunc(Number(cur[k])) || 0) + f[k];
      gg[slot] = cur;
    }
    out[g] = gg;
  }
  return out;
}
const ADJ_F = ['played', 'won', 'lost'];
const ADJ_KEY = /^[A-Za-z0-9_-]{1,24}$/;
const adjNum = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };
/** `gm` (one person's record in one game) plus `adj` ({ <level>: { played, won, lost } }); `gm` itself when nothing applies. */
export function adjustGame(gm, adj) {
  if (!adj || typeof adj !== 'object' || Array.isArray(adj)) return gm;
  let out = null;
  for (const lvl of Object.keys(adj)) {
    const a = adj[lvl];
    if (!ADJ_KEY.test(lvl) || !a || typeof a !== 'object') continue;
    const d = {};
    let any = false;
    for (const f of ADJ_F) { d[f] = adjNum(a[f]); if (d[f]) any = true; }
    if (!any) continue;
    if (!out) {
      const g = gm || {};
      out = Object.assign({}, g, { total: Object.assign({ played: 0, won: 0, lost: 0 }, g.total), byDiff: Object.assign({}, g.byDiff) });
    }
    const b = Object.assign({ played: 0, won: 0, lost: 0 }, out.byDiff[lvl]);
    for (const f of ADJ_F) {
      const before = b[f] | 0, after = Math.max(0, before + d[f]);
      b[f] = after;
      out.total[f] = Math.max(0, (out.total[f] | 0) + (after - before));
    }
    out.byDiff[lvl] = b;
  }
  return out || gm;
}
// ADJUST BY GAME TYPE (Matt, 2026-11-09: "There needs to be an option to choose what game you're adjusting... It doesn't
// allow me to do a hard game first to 1 for 3 points"). A slot `<level>~<byMode key>` in the same adjust node is a result
// of THAT type at the level PICKED, filed as the recorder would: byMode[key][level] and byDiff at the level it RECORDS at
// (one down for a FULL_LEVEL short setting), BEFORE the full-level move, so it shows and prices exactly like a real game.
// Old builds' adjustGame skips these slots (ADJ_KEY has no '~'). Read time only; a result never goes below 0.
const ADJ_MODE = /^([A-Za-z0-9_-]{1,24})~(.+)$/;
/** The byDiff level a result of mode `key` picked at `level` is RECORDED at, in game `id`. */
export function recordedLevelOf(id, level, key) {
  const g = FULL_LEVEL_GAMES[id];
  if (!g || level === 'mp') return level;
  let short = false;
  try { short = !!g.short(modeParts(key)); } catch { short = false; }
  const i = g.ladder.indexOf(level);
  return short && i > 0 ? g.ladder[i - 1] : level;
}
/** `gm` plus `adj`'s by-type slots; `gm` itself when there are none. Never mutates. */
export function adjustModesGame(gm, id, adj) {
  if (!adj || typeof adj !== 'object' || Array.isArray(adj)) return gm;
  let out = null;
  for (const slot of Object.keys(adj)) {
    const mm = ADJ_MODE.exec(slot);
    const a = adj[slot];
    if (!mm || !a || typeof a !== 'object') continue;
    const [, level, key] = mm;
    const d = {};
    let any = false;
    for (const f of ADJ_F) { d[f] = adjNum(a[f]); if (d[f]) any = true; }
    if (!any) continue;
    if (!out) {
      const g = gm || {};
      out = Object.assign({}, g, { total: Object.assign({ played: 0, won: 0, lost: 0 }, g.total), byDiff: Object.assign({}, g.byDiff), byMode: Object.assign({}, g.byMode) });
    }
    const rec = recordedLevelOf(id, level, key);
    const b = Object.assign({ played: 0, won: 0, lost: 0 }, out.byDiff[rec]);
    const row = Object.assign({}, out.byMode[key]);
    const m = Object.assign({ played: 0, won: 0, lost: 0 }, row[level]);
    for (const f of ADJ_F) {
      const before = b[f] | 0, after = Math.max(0, before + d[f]);
      b[f] = after;
      m[f] = Math.max(0, (m[f] | 0) + (after - before));
      out.total[f] = Math.max(0, (out.total[f] | 0) + (after - before));
    }
    out.byDiff[rec] = b;
    row[level] = m;
    out.byMode[key] = row;
  }
  return out || gm;
}
/** A whole stats store with one person's by-type adjust slots applied (My Stats' first paint). */
export function adjustModesStats(st, adjByGame) {
  if (!st || !st.games || !adjByGame || typeof adjByGame !== 'object') return st;
  let games = null;
  for (const id of Object.keys(adjByGame)) {
    if (!st.games[id]) continue;
    const f = adjustModesGame(st.games[id], id, adjByGame[id]);
    if (f !== st.games[id]) (games || (games = Object.assign({}, st.games)))[id] = f;
  }
  return games ? Object.assign({}, st, { games }) : st;
}
/** A whole stats store with `adjByGame` ({ <game id>: { <level>: {...} } }, one person's adjust entry) applied. */
export function adjustStats(st, adjByGame) {
  if (!st || !st.games || !adjByGame || typeof adjByGame !== 'object') return st;
  let games = null;
  for (const id of Object.keys(adjByGame)) {
    if (!st.games[id]) continue;
    const f = adjustGame(st.games[id], adjByGame[id]);
    if (f !== st.games[id]) (games || (games = Object.assign({}, st.games)))[id] = f;
  }
  return games ? Object.assign({}, st, { games }) : st;
}
// ASSUMED MODES: how a player's wins from before a game saved its options were played, on that player's own word.
// Read time only, for POINTS (js/lb-points.js gamePoints): nothing stored changes. Monopoly Deal saved the computer
// count from 2026-10-30. Matt, 2026-11-04: "I only ever play monopoly deal against 2 robots. so 3 people total" and,
// of his 4 wins saved with no level ('legacy'), "yes count them as medium".
export const ASSUMED_MODES = {
  business: [{ code: 'QZCC4', mode: 'ai=2', legacy: 'normal' }],
};
/** `gm` (one person's record in game `id`) with ASSUMED_MODES applied for `code`; `gm` itself when none applies. */
export function assumedRecord(gm, id, code) {
  const c = String(code || '').trim().toUpperCase();
  const a = c && gm ? (ASSUMED_MODES[id] || []).find((x) => x.code === c) : null;
  if (!a) return gm;
  const out = JSON.parse(JSON.stringify(gm));
  const bd = out.byDiff || (out.byDiff = {});
  const add = (dst, src) => { for (const k of ['played', 'won', 'lost']) dst[k] = (dst[k] | 0) + (src[k] | 0); };
  if (a.legacy && bd.legacy) { add(bd[a.legacy] || (bd[a.legacy] = {}), bd.legacy); delete bd.legacy; }
  if (a.mode) {
    const bm = out.byMode || (out.byMode = {});
    for (const [d, b] of Object.entries(bd)) {
      if (d === 'mp' || !b) continue;
      let saved = 0;
      for (const ds of Object.values(bm)) saved += ((ds && ds[d] && ds[d].won) | 0);
      const n = Math.max(0, (b.won | 0) - saved);
      if (!n) continue;
      const row = (bm[a.mode] || (bm[a.mode] = {}))[d] || (bm[a.mode][d] = {});
      row.won = (row.won | 0) + n;
      row.played = (row.played | 0) + n;
    }
  }
  return out;
}

/** { words, points } Matt has added by hand to `code`'s day on `puzzle`, as of `now`. */
export function handAddFor(gameId, puzzle, code, now = Date.now()) {
  let words = 0, points = 0;
  for (const a of HAND_ADDS[gameId] || []) if (a.puzzle === puzzle && a.code === code && now >= a.from) { words += a.words; points += a.points; }
  return { words, points };
}
/** Did a hand add switch on after `since` (and by `now`)? The server rebuilds the board when one has. */
export function handAddDueSince(gameId, since, now = Date.now()) {
  return (HAND_ADDS[gameId] || []).some((a) => a.from > (since || 0) && a.from <= now);
}

/** Codes whose day on one puzzle counts for nothing long-term (Spelling Bee). Not the day's own board. */
export function voidedCodesFor(gameId, puzzle) {
  const out = new Set();
  for (const v of Object.values(VOIDED_MATCHES[gameId] || {})) if (v.puzzle && v.puzzle === puzzle && v.winner) out.add(v.winner);
  return out;
}
export function isVoidedMatch(gameId, matchId) {
  return !!(VOIDED_MATCHES[gameId] && Object.prototype.hasOwnProperty.call(VOIDED_MATCHES[gameId], matchId));
}
/** What a voided match was for `code`: 'won' | 'lost', or null when that code did not play it. */
export function voidedResultFor(gameId, matchId, code) {
  const v = isVoidedMatch(gameId, matchId) ? VOIDED_MATCHES[gameId][matchId] : null;
  if (!v || !code) return null;
  return v.winner === code ? 'won' : v.loser === code ? 'lost' : null;
}
/** A game record with its noted, still-voided results taken back out of `total` and their bucket
 *  ('mp', or the entry's own). Never mutates its input; returns it unchanged when there is nothing to take out. */
export function correctVoidedResults(gameRec, gameId) {
  const g = gameRec || {};
  const vd = g.vd && typeof g.vd === 'object' ? g.vd : null;
  if (!vd) return g;
  // Counted per bucket: online matches sit in 'mp', a Spelling Bee day in 'daily'.
  const per = {};
  const zero = () => ({ won: 0, lost: 0, draw: 0, played: 0 });
  const all = zero();
  for (const id of Object.keys(vd)) {
    if (!isVoidedMatch(gameId, id) || all[vd[id]] == null || vd[id] === 'played') continue;
    const v = VOIDED_MATCHES[gameId][id];
    const k = v.bucket || 'mp';
    const n = per[k] || (per[k] = zero());
    n[vd[id]] += 1; all[vd[id]] += 1;
    if (!v.keepPlayed) { n.played += 1; all.played += 1; }
  }
  if (!(all.won + all.lost + all.draw)) return g;
  const less = (b, n) => Object.assign({}, b || {}, {
    played: Math.max(0, ((b || {}).played | 0) - n.played),
    won: Math.max(0, ((b || {}).won | 0) - n.won),
    lost: Math.max(0, ((b || {}).lost | 0) - n.lost),
  });
  const byDiff = Object.assign({}, g.byDiff || {});
  for (const k of Object.keys(per)) if (byDiff[k]) byDiff[k] = less(byDiff[k], per[k]);
  return Object.assign({}, g, { total: less(g.total, all), byDiff });
}

/** Correction for one board, or null. Pure over a plain corrections map: `{ <boardId>: {...} }`. */
export function correctionFor(corrs, boardId) {
  const c = corrs && corrs[boardId];
  return c && typeof c === 'object' ? c : null;
}

/**
 * One board's record as it should be SHOWN.
 * - additive counters (plays, points) drop by what stood when the void was taken
 * - maxima (best, bestThrow) are NOT subtractable, so they survive only if a LATER score beat the
 *   voided one; otherwise they read 0 until the player throws something new
 * - daily bests are the one part with real dates on them, so they are filtered by date honestly
 */
export function correctBoard(raw, corr) {
  const b = raw || {};
  if (!corr) return b;
  const daily = {};
  const upto = String(corr.upto || '');
  for (const day of Object.keys(b.daily || {})) {
    if (!upto || day > upto) daily[day] = b.daily[day];
  }
  return {
    plays: Math.max(0, (b.plays | 0) - (corr.plays | 0)),
    points: Math.max(0, (b.points | 0) - (corr.points | 0)),
    best: (b.best | 0) > (corr.best | 0) ? (b.best | 0) : 0,
    bestThrow: (b.bestThrow | 0) > (corr.bestThrow | 0) ? (b.bestThrow | 0) : 0,
    daily,
  };
}

/**
 * A whole `games.skeeball` record as it should be SHOWN, given this player-device's corrections.
 * Returns a corrected COPY; the input is never mutated (it is the caller's live store or a synced
 * record, and mutating either would be the exact failure this file exists to avoid).
 * @param {object} gameRec  { total, byDiff, sk } from a stats store or a synced player record
 * @param {object} corrs    { <boardId>: correction }
 */
export function correctSkeeballRecord(gameRec, corrs) {
  const g = gameRec || {};
  const sk = g.sk || {};
  const ids = Object.keys(corrs || {}).filter((id) => correctionFor(corrs, id));
  if (!ids.length || !sk || typeof sk !== 'object') return g;

  const boards = Object.assign({}, sk.boards || {});
  let lostPlays = 0, lostPoints = 0;
  const byDiff = Object.assign({}, g.byDiff || {});
  for (const id of ids) {
    const before = boards[id];
    if (!before) continue;
    const after = correctBoard(before, corrs[id]);
    lostPlays += Math.max(0, (before.plays | 0) - (after.plays | 0));
    lostPoints += Math.max(0, (before.points | 0) - (after.points | 0));
    boards[id] = after;
    // `byDiff` is bucketed by BOARD id for Skeeball (js/game-stats.js's bumpTotals), so the voided
    // racks come out of that bucket too - otherwise the leaderboard's per-tier counts would still
    // carry them while every other screen had dropped them.
    const d = byDiff[id];
    if (d) {
      const drop = Math.max(0, (before.plays | 0) - (after.plays | 0));
      byDiff[id] = Object.assign({}, d, {
        played: Math.max(0, (d.played | 0) - drop),
        won: Math.max(0, (d.won | 0) - drop),
      });
    }
  }

  // The lifetime maxima blend every machine, so they can only be lowered when the record BELONGS to
  // a voided board - i.e. nothing else the player has ever thrown beat it. Otherwise it stands.
  const remainingBest = Math.max(0, ...Object.keys(boards).map((id) => boards[id].best | 0));
  const remainingThrow = Math.max(0, ...Object.keys(boards).map((id) => boards[id].bestThrow | 0));
  const voidedBest = Math.max(0, ...ids.map((id) => corrs[id].best | 0));
  const voidedThrow = Math.max(0, ...ids.map((id) => corrs[id].bestThrow | 0));
  const bestGame = (sk.bestGame | 0) > voidedBest ? (sk.bestGame | 0) : remainingBest;
  const bestThrow = (sk.bestThrow | 0) > voidedThrow ? (sk.bestThrow | 0) : remainingThrow;

  return Object.assign({}, g, {
    total: Object.assign({}, g.total || {}, {
      played: Math.max(0, ((g.total || {}).played | 0) - lostPlays),
      won: Math.max(0, ((g.total || {}).won | 0) - lostPlays),
    }),
    byDiff,
    sk: Object.assign({}, sk, {
      boards,
      played: Math.max(0, (sk.played | 0) - lostPlays),
      points: Math.max(0, (sk.points | 0) - lostPoints),
      bestGame,
      bestThrow,
    }),
  });
}

// --- Texas Hold'em bankroll voids (2026-09-28) ---------------------------------------------------
// Matt chose deterrents over a server dealer, and one of them is "void a bankroll from the admin
// page". Same idea as a Skeeball void, same reason it has to be an overlay: the device mirrors its
// whole ledger over players/<id> on every hub load, so an edit there would not survive a day.
//
// THE SHAPE, per player-device (statsId): the ledger's raw counters at the moment of the void,
//   { buyins, winnings, grants, best, cashes, entries, alley, at, why }   (alley: 2026-10-08; a void
//   stored before then has none, which reads as 0)
// A BASELINE, exactly like correctBoard: everything up to the void stops counting, so the bankroll
// reads as the starting stake again, and every game played AFTER it counts normally. `best` is a
// maximum and cannot be un-summed, so it survives only if a later prize beat the voided one (rule 4).
const HB_FIELDS = ['buyins', 'winnings', 'grants', 'cashes', 'entries', 'alley'];

/** A Hold'em ledger as it should be SHOWN after a void. Never mutates its input. */
export function correctHoldemLedger(hb, corr) {
  const h = hb || {};
  if (!corr || typeof corr !== 'object') return h;
  const out = {};
  const n = (v) => (Number.isFinite(+v) ? Math.floor(+v) : 0);     // not `| 0`: see holdemBalance
  for (const k of HB_FIELDS) out[k] = Math.max(0, n(h[k]) - n(corr[k]));
  out.best = (h.best | 0) > (corr.best | 0) ? (h.best | 0) : 0;
  return out;
}

/** What a Hold'em void stores for a ledger right now. */
export function holdemSnapshotOf(hb) {
  const h = hb || {};
  const out = {};
  for (const k of HB_FIELDS) out[k] = Number.isFinite(+h[k]) ? Math.floor(+h[k]) : 0;
  out.best = h.best | 0;
  return out;
}

// --- integrity voids (2026-10-28, js/integrity.js, docs/INTEGRITY-CHECKS-SPEC.md) --------------------
// The server flags a game on one device's record when a stored number is one the game cannot produce.
// Shown as Matt's rule 1 says: the games still count as PLAYED, with no win and every score, best and
// points at 0, so the record sorts last. The raw record is untouched; Matt's undo turns it back on.
// Per game, the score-like parts of its sub-counter to zero (counts of games or runs are kept).
// Two kinds of number cannot be zeroed, and getting either wrong puts a voided player at the TOP:
//   - a LOWER-is-better best kept in a per-key map (EMPTY below): 0 reads as a real, perfect score.
//   - a second copy of a score a different tab reads (Contexto's `ct.d`, the Daily tab): zeroing only
//     the lifetime fields leaves the Daily medals standing. List every place a board reads a score.
const ZERO = {
  snake: { sn: ['bestLen', 'bestLenByDiff', 'bestLenByWalls', 'bestLenByDiffWalls'] },
  yahtzee: { yz: ['bestScore', 'won', 'yahtzees'] },
  skeeball: { sk: ['bestGame', 'bestThrow', 'points', 'hundreds', 'fifties', 'colorSweeps', 'boards'] },
  battleship: { bs: ['won', 'hits', 'sunk', 'bestAccuracy', 'fewestShotsWin'] },
  tictactoe: { tt: ['classic.won', 'ultimate.won'] },
  cuppong: { cp: ['soloBest', 'soloRacks', 'soloThrows'], cr: ['*.w'] },
  golf: { gf: ['points', 'birdies', 'eagles', 'aces', 'longestDriveYd'] },   // bests: see EMPTY
  hillclimb: { hc: ['bestDistance', 'bestDistanceByStage', 'bestCoins', 'coins', 'flips'] },
  sudoku: { sd: ['bestTimeMs', 'perfect'] },
  minesweeper: { ms: ['bestTimeMs', 'bestClearedPct', 'flagsRight'] },
  airhockey: { ah: ['goalsFor', 'shutouts', 'bestShot', 'streak', 'bestStreak'] },
  boggle: { bg: ['won', 'bestScore', 'words', 'longestWord'] },
  dominoes: { dm: ['won', 'points', 'bestRound'] },
  dotsboxes: { db: ['won', 'boxes', 'bestChain'] },
  // `d` is the Daily board's own copy (js/game-stats.js recordContexto): its medals and solves go too, its
  // `played` (games) and `hints` (a count, kept at the top level as well) stay. `fewestNH` is a best.
  contexto: { ct: ['fewest', 'fewestNH', 'noHint', 'silver', 'bronze', 'solved', 'guesses',
    'd.solved', 'd.guesses', 'd.noHint', 'd.silver', 'd.bronze'] },
  wayout: { wo: ['pts', 'log', 'replay', 'best', 'recent', 'rush', 'cl', 'leg'] },
  brickblitz: { bz: ['bestScore', 'bestScoreByDiff', 'points', 'bestCombo'] },
  tower: { tw: ['best', 'bestByDiff', 'bestStreak', 'blocks', 'perfects', 'shapes'] },
  ballrun: { br: ['bestObstacles', 'bestObstaclesByDiff'], brOrbital: ['bestObstacles', 'bestObstaclesByDiff'] },
  nutsbolts: { nb: ['bestLevel', 'bestByTier'] },
  holdem: { hb: ['winnings', 'best', 'cashes'], hs: ['won', 'bigPot', 'best', 'bestCat', 'bestCards'] },
};
// Per-key maps of a LOWER-is-better best, EMPTIED rather than zeroed (2026-11-03). Golf's
// `bestRoundByCourse` is { courseId: strokes }: a course never played has NO key (the lowest possible
// round is not 0), so 0 is not "no score", it is a perfect one - golfBestAt turned it into 0 minus par,
// "12 under", the best number on the board, and players-agg merges this map with Math.min across a
// person's devices, so the zero also beat every real round on their OTHER phone. Absent is the only
// honest "no best". `bestHole` is the same shape (its readers skip a 0, but a fabricated record is
// still one). The raw record keeps every round; this is the overlay only.
const EMPTY = {
  golf: { gf: ['bestRoundByCourse', 'bestHole'] },
  tower: { tw: ['lowByDiff'] },   // a low of 0 is a real run, so a voided record keeps none
};
/** A copy of `v` with every number in it 0, every string '', every list emptied. */
function zeroed(v) {
  if (Array.isArray(v)) return [];
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = zeroed(v[k]); return o; }
  if (typeof v === 'number') return 0;
  if (typeof v === 'string') return '';
  return v;
}
function zeroPath(sub, path) {
  const [head, ...rest] = path.split('.');
  const keys = head === '*' ? Object.keys(sub) : [head];
  for (const k of keys) {
    if (!(k in sub)) continue;
    if (!rest.length) sub[k] = zeroed(sub[k]);
    else if (sub[k] && typeof sub[k] === 'object') { sub[k] = Object.assign({}, sub[k]); zeroPath(sub[k], rest.join('.')); }
  }
}
/** One game's record with an integrity void applied. Never mutates its input. */
export function voidIntegrityGame(gameRec, gameId) {
  const g = gameRec || {};
  const noWin = (b) => Object.assign({}, b || {}, { won: 0 });
  const byDiff = {};
  for (const k of Object.keys(g.byDiff || {})) byDiff[k] = noWin(g.byDiff[k]);
  const out = Object.assign({}, g, { total: noWin(g.total), byDiff });
  for (const [subKey, paths] of Object.entries(ZERO[gameId] || {})) {
    if (!g[subKey] || typeof g[subKey] !== 'object') continue;
    const sub = Object.assign({}, g[subKey]);
    for (const p of paths) zeroPath(sub, p);
    out[subKey] = sub;
  }
  for (const [subKey, keys] of Object.entries(EMPTY[gameId] || {})) {
    const cur = out[subKey] || g[subKey];
    if (!cur || typeof cur !== 'object') continue;
    const sub = Object.assign({}, cur);
    for (const k of keys) if (k in sub) sub[k] = {};
    out[subKey] = sub;
  }
  return out;
}

/**
 * Apply every correction that names this player-device to a whole stats store.
 * @param {object} stats  a `{ version, games }` store (local) or a synced record's `stats`
 * @param {string} id     the statsId this store belongs to
 * @param {object} all    every correction: { skeeball: { <statsId>: { <boardId>: {...} } },
 *                                            holdem: { <statsId>: {...} } }
 */
export function correctStats(stats, id, all) {
  let st = stats || {};
  for (const gid of Object.keys(VOIDED_MATCHES)) {
    const rec = st.games && st.games[gid];
    const fixed = rec ? correctVoidedResults(rec, gid) : rec;
    if (fixed !== rec) st = Object.assign({}, st, { games: Object.assign({}, st.games, { [gid]: fixed }) });
  }
  const corrs = (((all || {}).skeeball || {})[id]) || null;
  if (corrs && st.games && st.games.skeeball) {
    const fixed = correctSkeeballRecord(st.games.skeeball, corrs);
    if (fixed !== st.games.skeeball) st = Object.assign({}, st, { games: Object.assign({}, st.games, { skeeball: fixed }) });
  }
  const hc = (((all || {}).holdem || {})[id]) || null;
  if (hc && st.games && st.games.holdem && st.games.holdem.hb) {
    const hb = correctHoldemLedger(st.games.holdem.hb, hc);
    st = Object.assign({}, st, { games: Object.assign({}, st.games, { holdem: Object.assign({}, st.games.holdem, { hb }) }) });
  }
  // Integrity voids: { <statsId>: { <gameId>: true } }, from the server's flags minus Matt's undo
  // (js/integrity.js activeVoids). Applied last, so nothing above can put a voided number back.
  const iv = (((all || {}).integrity || {})[id]) || null;
  if (iv && st.games) {
    for (const gid of Object.keys(iv)) {
      if (iv[gid] !== true || !st.games[gid]) continue;
      st = Object.assign({}, st, { games: Object.assign({}, st.games, { [gid]: voidIntegrityGame(st.games[gid], gid) }) });
    }
  }
  return st;
}

/** What a void would store for a board right now: its raw totals, plus today. */
export function snapshotOf(board, day) {
  const b = board || {};
  return {
    plays: b.plays | 0, points: b.points | 0, best: b.best | 0, bestThrow: b.bestThrow | 0,
    upto: String(day || ''),
  };
}

// --- restored deleted records (2026-11-03) -----------------------------------------------------------
// Matt: "Restore mine yes. Admin only still". Between 2026-10-05 and 2026-11-03 about 188 records were
// deleted from players/ with no log (js/CLAUDE.md, "Deleted records"). Two of them were Matt's, and the
// 2026-08-31 backup (backups/rtdb-2026-08-31T13-17-01-416Z.json on Matt's PC) still holds what they had:
//   2b0d7c05  iPhone Safari tab, QZCC4: Boggle 3 (0-2, 1 tie), Mancala 1 (1-0)
//   50bf8077  MattyIce, no code: Ball Run 1
// They come back at READ TIME only, exactly as the backup holds them (THE LAW rule 4: nothing guessed).
// Nothing is written to players/. A restored record is used only when its id is NOT on the live data, so
// a device that comes back and syncs its own record is never counted twice. Its 3 Skeeball plays from
// September have no copy anywhere and are not restored.
// ADMIN DEVICES ONLY until Matt releases it (the callers gate on isAdminDevice(); functions/boards.js,
// which builds the board everyone else reads, does not use this).
export const RESTORED_RECORDS = {
  '2b0d7c05-e4c2-4a2f-8317-dac42424338a': {
    profile: { emoji: '🦖', message: '', messageAt: 0, name: 'MattyIce', playerId: 'QZCC4' },
    updatedAt: 1787077418512,
    stats: { games: {
      boggle: { bg: { bestScore: 30, longestWord: { len: 5, word: 'CRANE' }, lost: 2, played: 3, tied: 1, won: 0, words: 46 },
        byDiff: { beginner: { lost: 2, played: 3, won: 0 } }, total: { lost: 2, played: 3, won: 0 } },
      mancala: { byDiff: { intermediate: { lost: 0, played: 1, won: 1 } }, total: { lost: 0, played: 1, won: 1 } },
    } },
  },
  '50bf8077-ce91-4a14-8ce5-010e5b1f0d76': {
    profile: { emoji: '🙂', message: '', messageAt: 0, name: 'MattyIce', playerId: '' },
    updatedAt: 0,
    stats: { games: {
      ballrun: { _brMetricMigrated: true, _brRunsRefolded: true,
        br: { bestObstacles: 2, bestObstaclesByDiff: { easy: 0, hard: 0, medium: 2 }, runs: 1 },
        brOrbital: { bestObstacles: 0, bestObstaclesByDiff: { easy: 0, hard: 0, medium: 0 }, runs: 0 },
        byDiff: { medium: { lost: 0, played: 1, won: 1 } }, total: { lost: 0, played: 1, won: 1 } },
    } },
  },
};

/** players/ records plus every restored record whose id is not among them. `all` is never changed. */
export function withRestoredRecords(all) {
  const out = { ...(all || {}) };
  for (const [id, rec] of Object.entries(RESTORED_RECORDS)) if (!out[id]) out[id] = rec;
  return out;
}

// One merged counter object into another: a `best...` or `longest...` value keeps the larger, every
// other number adds (plays, wins, words, runs). Flags and strings are left as they are.
function _mergeInto(dst, src, keep) {
  for (const [k, v] of Object.entries(src || {})) {
    const max = keep || /^(best|longest|fewest)/i.test(k);
    if (typeof v === 'number') dst[k] = max ? Math.max(+dst[k] || 0, v) : (+dst[k] || 0) + v;
    else if (v && typeof v === 'object' && Number.isFinite(v.len) && typeof v.word === 'string') {
      if (!dst[k] || (+dst[k].len || 0) < v.len) dst[k] = { ...v };
    } else if (v && typeof v === 'object') { if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {}; _mergeInto(dst[k], v, max); }
  }
}

/** The server-built board ({ list, idsByKey }) with the restored records added to their owner's row,
 *  the same numbers aggregating players/ plus withRestoredRecords() gives. `agg` = { aggregatePlayers,
 *  buildIdentity } from players-agg.js (passed in: players-agg imports this file). A record already on
 *  the board, or whose owner has no row, adds nothing (a row is never invented). `board` is not changed. */
export function withRestoredBoard(board, agg) {
  if (!board || !board.list || !agg) return board;
  const present = new Set();
  for (const ids of (board.idsByKey || new Map()).values()) for (const id of ids || []) present.add(id);
  const missing = {};
  for (const [id, rec] of Object.entries(RESTORED_RECORDS)) if (!present.has(id)) missing[id] = rec;
  if (!Object.keys(missing).length) return board;
  const ident = agg.buildIdentity(missing);
  const list = board.list.slice(), idsByKey = new Map(board.idsByKey || []);
  for (const d of agg.aggregatePlayers(missing)) {
    const i = list.findIndex((g) => (d.playerId && g.playerId === d.playerId) || g.key === d.key);
    if (i < 0) continue;
    const row = JSON.parse(JSON.stringify(list[i]));
    for (const [g, v] of Object.entries(d.games || {})) {
      if (!((v.total || {}).played > 0)) continue;
      if (!row.games[g]) row.games[g] = { total: { played: 0, won: 0, lost: 0 }, byDiff: {} };
      _mergeInto(row.games[g], v, false);
    }
    if (row.comp && d.comp) _mergeInto(row.comp, d.comp, false);
    if (row.solo && d.solo) row.solo.solved = (row.solo.solved | 0) + (d.solo.solved | 0);
    row.totalPlays = (row.totalPlays | 0) + (d.totalPlays | 0);
    row.devices = (row.devices | 0) + (d.devices | 0);
    list[i] = row;
    const ids = Object.keys(missing).filter((id) => ident.keyFor((missing[id] || {}).profile || {}, id) === d.key);
    idsByKey.set(row.key, [...(idsByKey.get(row.key) || []), ...ids]);
  }
  return { ...board, list, idsByKey };
}

export default { VOIDED_MATCHES, isVoidedMatch, voidedResultFor, voidedCodesFor, correctVoidedResults, correctionFor, correctBoard, correctSkeeballRecord, correctStats, snapshotOf, correctHoldemLedger, holdemSnapshotOf, voidIntegrityGame, RESTORED_RECORDS, withRestoredRecords, withRestoredBoard };
