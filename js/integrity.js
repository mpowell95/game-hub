// js/integrity.js - INTEGRITY CHECKS for every game's stored record, PURE (2026-10-28).
//
// Playbook: docs/INTEGRITY-CHECKS.md. Spec, every rule's proof and the replay over every real record:
// docs/INTEGRITY-CHECKS-SPEC.md. One module for the server (functions/integrity.js: detection, flags,
// pushes, the leaderboard package) and the phone (the admin page), so both judge exactly the same way.
// No storage, no network, no DOM.
//
// TWO KINDS OF RULE:
//   STRONG (`void: true`): a number the game CANNOT produce, proven from the game's own code (a Snake
//     longer than the 255 squares of its board, a Yahtzee game over 1,575, Arrow Maze time shorter
//     than its own penalties). Any one voids that game on that device's record, at READ time.
//   ALERT (`void: false`): unlikely but not impossible, or data that may be partial. Matt gets a push
//     and the admin page lists it; nothing is voided (Matt's rule 3: missing or partial data is an
//     ALERT, never a void).
// A rule an honest player has tripped in the real data is not here (Matt's rule 4/5). Before adding
// one: prove the bound from the code, replay it over every record (tools/test-integrity.mjs --db).
//
// THE LAW: nothing here writes. A void is applied when numbers are SHOWN (js/stats-corrections.js
// voidIntegrityGame); the stats store and players/<id> are never changed.

import { holdemSuspect } from './game-stats.js';
import { WO_TIERS, WO_PENALTY_S, woList } from './arrow-maze-time.js';
import { scoreAt } from '../darts/js/engine.js';
import { SHIP_SETS, shipCells } from '../battleship/js/fleet.js';
import { replayResult, sameResult } from '../hoops4/js/replay.js';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const obj = (v) => (v && typeof v === 'object' ? v : {});
/** Every number in a (nested) map of bests, e.g. Snake's bestLenByDiffWalls. */
function numbersIn(v, out = []) {
  if (Number.isFinite(+v) && typeof v !== 'object' && typeof v !== 'boolean') out.push(+v);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) numbersIn(v[k], out);
  return out;
}
const maxIn = (v) => Math.max(0, ...numbersIn(v));

// Skeeball: 9 balls a rack (skeeball/js/boards.js BALLS_PER_GAME), the top pocket per machine.
const SK_BALLS = 9;
const SK_TOP = { classic: 100, basketball: 100, brickcity: 100, runaway: 100, popongo: 6 };

/** The rules. Each `test(g)` gets ONE device's record of that game ({ total, byDiff, <sub> }) and
 *  returns null, or { v: the stored value, lim: the bound it breaks }. `id` is stable (stored in
 *  flags); `text` is what the admin page and the push say. */
export const RULES = [
  // --- every game -------------------------------------------------------------------------------
  { id: 'more-results-than-games', game: '*', void: true, text: 'more wins and losses than games played',
    test(g) {
      const buckets = [obj(g.total), ...Object.values(obj(g.byDiff)).map(obj)];
      for (const b of buckets) {
        const p = num(b.played), wl = num(b.won) + num(b.lost);
        if (wl > p) return { v: wl, lim: p };
      }
      return null;
    } },

  // --- Snake: a 15 x 17 board (snake/js/game.js COLS, ROWS) holds at most 255 ------------------------
  { id: 'snake-longer-than-board', game: 'snake', void: true, text: 'a snake longer than the board',
    test(g) { const v = maxIn([obj(g.sn).bestLen, obj(g.sn).bestLenByDiff, obj(g.sn).bestLenByWalls, obj(g.sn).bestLenByDiffWalls]); return v > 255 ? { v, lim: 255 } : null; } },

  // --- Yahtzee: 375 + 12 bonus Yahtzees of 100 = 1,575; at most 13 Yahtzees a game ---------------------
  { id: 'yahtzee-score-too-high', game: 'yahtzee', void: true, text: 'a score over 1,575',
    test(g) { const v = num(obj(g.yz).bestScore); return v > 1575 ? { v, lim: 1575 } : null; } },
  { id: 'yahtzee-too-many-yahtzees', game: 'yahtzee', void: true, text: 'more than 13 Yahtzees a game',
    test(g) { const y = obj(g.yz), v = num(y.yahtzees), lim = 13 * num(y.played); return v > lim ? { v, lim } : null; } },

  // --- Skeeball: 9 balls, each at most the machine's top pocket -------------------------------------
  { id: 'skeeball-rack-too-high', game: 'skeeball', void: true, text: 'a rack or a ball over the machine\'s top score',
    test(g) {
      const sk = obj(g.sk);
      if (num(sk.bestGame) > SK_BALLS * 100) return { v: num(sk.bestGame), lim: SK_BALLS * 100 };
      if (num(sk.bestThrow) > 100) return { v: num(sk.bestThrow), lim: 100 };
      if (num(sk.points) > SK_BALLS * 100 * num(sk.played)) return { v: num(sk.points), lim: SK_BALLS * 100 * num(sk.played) };
      for (const [id, b0] of Object.entries(obj(sk.boards))) {
        const b = obj(b0), top = SK_TOP[id];
        if (!top) continue;
        if (num(b.best) > SK_BALLS * top) return { v: num(b.best), lim: SK_BALLS * top };
        if (num(b.bestThrow) > top) return { v: num(b.bestThrow), lim: top };
        if (num(b.points) > SK_BALLS * top * num(b.plays)) return { v: num(b.points), lim: SK_BALLS * top * num(b.plays) };
        const day = maxIn(b.daily);
        if (day > SK_BALLS * top) return { v: day, lim: SK_BALLS * top };
      }
      return null;
    } },

  // --- Battleship: the smallest fleet is 12 squares (battleship/js/fleet.js), so a win takes 12+ shots
  { id: 'battleship-win-too-few-shots', game: 'battleship', void: true, text: 'a win in fewer shots than the fleet has squares',
    test(g) { const v = num(obj(g.bs).fewestShotsWin); return v > 0 && v < 12 ? { v, lim: 12 } : null; } },
  { id: 'battleship-more-hits-than-shots', game: 'battleship', void: true, text: 'more hits than shots, or accuracy over 100%',
    test(g) {
      const bs = obj(g.bs);
      if (num(bs.bestAccuracy) > 100) return { v: num(bs.bestAccuracy), lim: 100 };
      return num(bs.hits) > num(bs.shots) ? { v: num(bs.hits), lim: num(bs.shots) } : null;
    } },

  // --- Tic Tac Toe: Pro Classic is a full minimax (tic-tac-toe/js/ai.js proClassic), never beaten, so
  // every Pro win is an Ultimate win.
  { id: 'tictactoe-beat-pro-classic', game: 'tictactoe', void: true, text: 'beat the unbeatable Pro Classic',
    test(g) { const v = num(obj(obj(g.byDiff).pro).won), lim = num(obj(obj(g.tt).ultimate).won); return v > lim ? { v, lim } : null; } },

  // --- Cup Pong solo: a 10-cup rack, one ball a throw, at most one cup a throw ------------------------
  { id: 'cuppong-solo-under-10', game: 'cuppong', void: true, text: 'a 10-cup rack cleared in under 10 throws',
    test(g) {
      const cp = obj(g.cp);
      if (num(cp.soloBest) > 0 && num(cp.soloBest) < 10) return { v: num(cp.soloBest), lim: 10 };
      const lim = 10 * num(cp.soloRacks);
      return num(cp.soloThrows) < lim ? { v: num(cp.soloThrows), lim } : null;
    } },

  // --- Golf: every hole takes a stroke; a hole is at most one of ace / eagle / birdie -----------------
  { id: 'golf-fewer-strokes-than-holes', game: 'golf', void: true, text: 'fewer strokes than holes, or a hole in 0',
    test(g) {
      const gf = obj(g.gf);
      if (num(gf.strokes) < num(gf.holes)) return { v: num(gf.strokes), lim: num(gf.holes) };
      const under = num(gf.aces) + num(gf.eagles) + num(gf.birdies);
      if (under > num(gf.holes)) return { v: under, lim: num(gf.holes) };
      for (const v of numbersIn(gf.bestHole)) if (v < 1) return { v, lim: 1 };
      return null;
    } },

  // --- Hill Climb: every flip adds 50 coins to the run (hill-climb/js/physics.js FLIP_BONUS) ---------
  { id: 'hillclimb-flips-without-coins', game: 'hillclimb', void: true, text: 'fewer coins than its flips paid',
    test(g) { const hc = obj(g.hc), lim = 50 * num(hc.flips); return num(hc.coins) < lim ? { v: num(hc.coins), lim } : null; } },

  // --- Sudoku: a perfect solve is a solve -----------------------------------------------------------
  { id: 'sudoku-more-perfect-than-solved', game: 'sudoku', void: true, text: 'more perfect solves than solves',
    test(g) { const sd = obj(g.sd); return num(sd.perfect) > num(sd.solved) ? { v: num(sd.perfect), lim: num(sd.solved) } : null; } },

  // --- Minesweeper: a best time is set only by a win at that level -----------------------------------
  { id: 'minesweeper-time-without-win', game: 'minesweeper', void: true, text: 'a best time at a level never won',
    test(g) {
      for (const [lv, t] of Object.entries(obj(obj(g.ms).bestTimeMs))) {
        if (num(t) > 0 && !(num(obj(obj(g.byDiff)[lv]).won) > 0)) return { v: num(t), lim: 0, at: lv };
      }
      return null;
    } },

  // --- Air Hockey: first to 7 (air-hockey/js/physics.js PHYS.WIN); the puck tops out under 9,900 ----
  { id: 'airhockey-goals-too-many', game: 'airhockey', void: true, text: 'more than 7 goals a game, or an impossible shot',
    test(g) {
      const ah = obj(g.ah), lim = 7 * num(ah.games);
      if (num(ah.goalsFor) > lim) return { v: num(ah.goalsFor), lim };
      if (num(ah.goalsAgainst) > lim) return { v: num(ah.goalsAgainst), lim };
      return num(ah.bestShot) > 9900 ? { v: num(ah.bestShot), lim: 9900 } : null;
    } },

  // --- Boggle: 16 dice (one Qu) spell at most 17 letters; a word scores at most 11 ---------------------
  { id: 'boggle-impossible-word', game: 'boggle', void: true, text: 'a word or a score no board can give',
    test(g) {
      const bg = obj(g.bg), lw = obj(bg.longestWord);
      const len = num(lw.len);
      if (len > 17) return { v: len, lim: 17 };
      if (typeof lw.word === 'string' && lw.word && lw.word.length !== len) return { v: len, lim: lw.word.length };
      return num(bg.bestScore) > 11 * num(bg.words) ? { v: num(bg.bestScore), lim: 11 * num(bg.words) } : null;
    } },

  // --- Dominoes: a win reaches the target, 150 at the least (dominoes/js/ui.js TARGETS) --------------
  { id: 'dominoes-win-without-points', game: 'dominoes', void: true, text: 'wins without the points a win takes',
    test(g) { const dm = obj(g.dm), lim = 150 * num(dm.won); return num(dm.points) < lim ? { v: num(dm.points), lim } : null; } },

  // --- Dots and Boxes: a chain is boxes taken; the biggest board has 100 -----------------------------
  { id: 'dotsboxes-chain-too-long', game: 'dotsboxes', void: true, text: 'a chain longer than the boxes taken',
    test(g) {
      const db = obj(g.db), lim = Math.min(100, num(db.boxes));
      return num(db.bestChain) > lim ? { v: num(db.bestChain), lim } : null;
    } },

  // --- Contexto: a win is a typed guess (a hint never gives rank 1) ------------------------------------
  { id: 'contexto-wins-without-guesses', game: 'contexto', void: true, text: 'puzzles solved without a guess',
    test(g) { const ct = obj(g.ct); return num(ct.guesses) < num(ct.solved) ? { v: num(ct.guesses), lim: num(ct.solved) } : null; } },

  // --- Arrow Maze: a level's time includes its own penalties (js/arrow-maze-time.js): each heart lost
  // costs at least the base, each hint the base, so time >= base x (hearts + hints).
  { id: 'arrowmaze-faster-than-penalties', game: 'wayout', void: true, text: 'a level faster than its own penalties',
    test(g) {
      const wo = obj(g.wo);
      for (const src of [obj(wo.log), obj(wo.replay)]) {
        for (const tier of WO_TIERS) {
          for (const f of woList(src[tier])) {
            if (f.m == null && f.h == null) continue;
            const lim = WO_PENALTY_S[tier] * 1000 * ((f.m | 0) + (f.h | 0));
            if (f.t < lim) return { v: f.t, lim, at: `${tier}:${f.l || 0}` };
          }
        }
      }
      return null;
    } },

  // --- ALERTS: unlikely, not provably impossible ---------------------------------------------------------
  // Arrow Maze: under 0.2 s an arrow over a whole level (the fastest real level, 2026-10-28: 0.49 s).
  { id: 'arrowmaze-too-fast', game: 'wayout', void: false, text: 'a level under 0.2 s an arrow',
    test(g) {
      const wo = obj(g.wo);
      for (const tier of WO_TIERS) {
        for (const f of woList(obj(wo.log)[tier])) if (f.a >= 10 && f.t < 200 * f.a) return { v: Math.round(f.t / f.a), lim: 200, at: `${tier}:${f.l || 0}` };
      }
      return null;
    } },
  // Hold'em: a ledger play could not have produced (js/game-stats.js holdemSuspect, already sorted last
  // on the Leaderboard).
  { id: 'holdem-ledger', game: 'holdem', void: false, text: 'a bankroll play could not produce',
    test(g) { const why = g.hb ? holdemSuspect(g.hb) : ''; return why ? { v: why, lim: '' } : null; } },
  // (Contexto's "solved in 1 guess" alert was DROPPED 2026-10-28: `fewest` counts typed guesses only, and
  // 8 hints walk any puzzle from a blank board to rank 2, so an honest hint-heavy solve trips it. King of
  // Games tripped it that way the day it shipped. Contexto's guesses are logged since (js/play-log.js).)
];

// --- ONLINE CHALLENGE MATCHES: ALERTS only, judged when a match ends (functions/integrity.js) ----------
// A finished match is never voided automatically: a match's result is counted by each phone from the
// match itself, so a void is Matt's hand entry in VOIDED_MATCHES (js/stats-corrections.js). The
// thresholds sit far above every real match in the database on 2026-10-28 (the spec's table).
const MATCH_RULES = [
  // Darts: 5 trebles or bullseyes in a row (best real run: 2, over 1,461 darts).
  { id: 'darts-treble-run', node: 'darts', text: 'trebles or bullseyes in a row', min: 5,
    run(log, side) {
      let run = 0, best = 0;
      for (const e of log) {
        if (e.by !== side) continue;
        const s = scoreAt(+e.x, +e.y);
        run = s.ring === 'treble' || s.ring === 'bull' ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best;
    } },
  // Cup Pong: 10 cups in a row without a miss (best real run: 6, over 1,457 throws).
  { id: 'cuppong-make-run', node: 'cuppong', text: 'cups in a row without a miss', min: 10,
    run(log, side) {
      let run = 0, best = 0;
      for (const e of log) {
        if (e.by !== side || e.k !== 't') continue;
        run = e.m ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best;
    } },
  // Battleship challenges store both fleets in the match: a winner who hit with 90%+ of their shots
  // (best real accuracy in any game: 47%). `run` returns the percentage.
  { id: 'battleship-accuracy', node: 'battleship', text: '% of shots hit in a win', min: 90,
    run(log, side, m) {
      if (!m.over || m.over.winner !== side) return 0;
      const target = (m[side === 'a' ? 'b' : 'a'] || {}).fleet;
      const cells = new Set();
      for (const s of Array.isArray(target) ? target : Object.values(target || {})) {
        const def = [...SHIP_SETS.classic, ...SHIP_SETS.quick].find((d) => d.id === (s || {}).id);
        if (def) for (const [r, c] of shipCells(def.len, +s.r, +s.c, s.dir)) cells.add(`${r},${c}`);
      }
      let shots = 0, hits = 0;
      for (const e of log) if (e.by === side) { shots++; if (cells.has(`${+e.r},${+e.c}`)) hits++; }
      return shots && hits >= 12 ? Math.round(100 * hits / shots) : 0;
    } },
];

/** A finished challenge match's alerts: [{ rule, side, v, lim }]. `node` is the match's top-level node
 *  ('darts', 'cuppong', 'battleship', 'hoops'); `m` the stored match. */
export function checkMatch(node, m) {
  if (!m || typeof m !== 'object' || !m.over) return [];
  const out = [];
  // Connect 4 Hoops: a stored winner the moves do not give (the phones refuse such a match since
  // 2026-10-28; before that it counted).
  if (node === 'hoops') {
    const w = m.over.winner;
    if ((w === 'a' || w === 'b' || w === null) && m.over.why !== 'resign') {
      const moves = Object.keys(m.moves || {}).sort().map((k) => m.moves[k]);
      if (!sameResult(replayResult(moves), w)) out.push({ rule: 'hoops-winner-not-moves', side: w || '', v: String(w), lim: '' });
    }
    return out;
  }
  const raw = m.log && typeof m.log === 'object' ? m.log : {};
  const log = Object.keys(raw).sort().map((k) => raw[k]).filter((e) => e && typeof e === 'object');
  for (const r of MATCH_RULES) {
    if (r.node !== node) continue;
    for (const side of ['a', 'b']) {
      let v = 0;
      try { v = r.run(log, side, m); } catch { v = 0; }
      if (v >= r.min) out.push({ rule: r.id, side, v, lim: r.min });
    }
  }
  return out;
}
export const MATCH_RULE_TEXT = Object.fromEntries([...MATCH_RULES.map((r) => [r.id, r.text]), ['hoops-winner-not-moves', 'a winner the moves do not give'],
  ['contexto-first-guess', 'solved in 1 typed guess (alert retired: hints do not count as guesses)'],
  ['contexto-solved-elsewhere', 'solved a puzzle already solved or given up on another phone'],
  ['contexto-hints-not-counted', 'hints taken elsewhere not counted (counted, taken)'],
  ['contexto-far-jump', 'solved with no hints straight from far away (closest guess before the answer, limit)']]);

// --- CONTEXTO, from the play log (2026-10-28; ALERTS only, never a void) ------------------------------
// Judged on the server when a win is logged (functions/integrity.js contextoWinCheck). `puzzle` = every
// playLog entry this player code has for that puzzle key, `near` = the code's entries within a minute of
// the win (where the recorder's own entry, with the hints it counted, sits). The phones already count a
// hint, give-up or solve from another phone (contexto/js/ui.js _remote); these catch what slipped past
// (a phone offline at the time) and the patterns a looked-up answer leaves.
export const CONTEXTO_FAR = 300;    // the "close" band: an honest solve almost always passes through it
export function checkContextoWin(puzzle, near, win) {
  const out = [];
  if (!win || win.e !== 'win') return out;
  const before = (puzzle || []).filter((x) => x && Number(x.t) < Number(win.t));
  if (before.some((x) => x.e === 'win' || x.e === 'giveup')) out.push({ rule: 'contexto-solved-elsewhere', v: 'yes', lim: '' });
  const hints = before.filter((x) => x.e === 'hint').length;
  const rec = (near || []).filter((x) => x && x.f === 'recordContexto' && Number(x.t) >= Number(win.t) - 1000)
    .sort((a, b) => a.t - b.t)[0];
  let counted = null;
  try { counted = rec ? (JSON.parse(rec.a)[2] || {}).hints | 0 : null; } catch { counted = null; }
  if (counted != null && hints > counted) out.push({ rule: 'contexto-hints-not-counted', v: counted, lim: hints });
  if (hints === 0) {
    const ranks = before.filter((x) => x.e === 'guess').map((x) => Number(x.r)).filter((r) => Number.isFinite(r) && r > 1);
    const best = ranks.length ? Math.min(...ranks) : null;
    if (best == null || best > CONTEXTO_FAR) out.push({ rule: 'contexto-far-jump', v: best == null ? 'first guess' : best, lim: CONTEXTO_FAR });
  }
  return out;
}

export const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]));

/** Every rule one game's record breaks: [{ rule, void, v, lim, at? }]. */
export function checkGame(gameId, rec) {
  const g = obj(rec);
  const out = [];
  for (const r of RULES) {
    if (r.game !== '*' && r.game !== gameId) continue;
    let hit = null;
    try { hit = r.test(g); } catch { hit = null; }
    if (hit) out.push({ rule: r.id, void: r.void, ...hit });
  }
  return out;
}

/** One device's whole stats store (`players/<id>/stats`): { <gameId>: [hits] } for games with hits.
 *  Only `games` (what the Leaderboard counts); an admin-only game's test plays are not judged. */
export function checkStats(stats) {
  const out = {};
  const games = obj(obj(stats).games);
  for (const gid of Object.keys(games)) {
    const hits = checkGame(gid, games[gid]);
    if (hits.length) out[gid] = hits;
  }
  return out;
}

/** Games voided BY HAND in code, per record: { <statsId>: { <gameId>: 'why' } }. An alert Matt wants
 *  voided goes on the admin page (Void); this list is for a void a session ships. Matt's Undo still wins. */
export const HAND_VOIDS = {
  // King of Games (3VN33): Contexto solved in 1 guess (the alert, 2026-10-28). Matt: "This must be voided."
  // The store keeps no day or word per puzzle, so it is his whole Contexto record on this phone.
  '090215fa-e525-4bbe-99d7-58f9ae3cd437': { contexto: '2026-10-28 Contexto in 1 guess' },
};

/** Is this game on this record voided? A strong flag, Matt's Void on the admin page
 *  (adminConfig/v1/integrity/void/<statsId>/<gameId>) or HAND_VOIDS; Matt's Undo
 *  (integrity/undo/<statsId>/<gameId>) beats all three. */
export function isVoided(flags, cfg, id, gid) {
  const ic = obj(obj(cfg).integrity);
  if (obj(obj(ic.undo)[id])[gid] === true) return false;
  if (obj(obj(ic.void)[id])[gid] === true) return true;
  if (obj(HAND_VOIDS[id])[gid]) return true;
  return Object.values(obj(obj(obj(flags)[id])[gid])).some((f) => f && f.void === true);
}

/** The voids in force: { <statsId>: { <gameId>: true } } (isVoided over every flagged record, every
 *  admin Void and every HAND_VOIDS entry). */
export function activeVoids(flags, cfg) {
  const ids = new Map();
  const add = (id, gid) => { if (!ids.has(id)) ids.set(id, new Set()); ids.get(id).add(gid); };
  for (const [id, games] of Object.entries(obj(flags))) for (const gid of Object.keys(obj(games))) add(id, gid);
  for (const [id, games] of Object.entries(obj(obj(obj(cfg).integrity).void))) for (const gid of Object.keys(obj(games))) add(id, gid);
  for (const [id, games] of Object.entries(HAND_VOIDS)) for (const gid of Object.keys(games)) add(id, gid);
  const out = {};
  for (const [id, gids] of ids) for (const gid of gids) if (isVoided(flags, cfg, id, gid)) (out[id] || (out[id] = {}))[gid] = true;
  return out;
}

/** Short words for the push and the admin page: "Snake: a snake longer than the board (300, at most 255)". */
export function hitText(hit) {
  const r = RULE_BY_ID[hit.rule];
  const text = r ? r.text : (MATCH_RULE_TEXT[hit.rule] || hit.rule);
  const nums = hit.lim === '' || hit.lim == null ? `${hit.v}` : `${hit.v}, limit ${hit.lim}`;
  return `${text} (${nums})`;
}

/** English game names for the push and the admin page (stats id -> name). */
export const GAME_NAMES = {
  snake: 'Snake', yahtzee: 'Yahtzee', skeeball: 'Skeeball', battleship: 'Battleship', tictactoe: 'Tic Tac Toe',
  cuppong: 'Cup Pong', golf: 'Golf', hillclimb: 'Hill Climb', sudoku: 'Sudoku', minesweeper: 'Minesweeper',
  airhockey: 'Air Hockey', boggle: 'Boggle', dominoes: 'Dominoes', dotsboxes: 'Dots and Boxes', contexto: 'Contexto',
  wayout: 'Arrow Maze', holdem: "Texas Hold'em", darts: 'Darts', hoops: 'Connect 4 Hoops', hoops4: 'Connect 4 Hoops',
  ballrun: 'Ball Run', brickblitz: 'Brick Breaker', nutsbolts: 'Nuts & Bolts', connect4: 'Connect Four',
  chinchon: 'Chinchón', escoba: 'Escoba', mancala: 'Mancala', filler: 'Filler', uno: 'Uno', murdoku: 'Murdoku',
  flicksoccer: 'Flick Soccer', eightball: 'Pool', archery: 'Archery', business: 'Monopoly Deal', parchis: 'Parchís',
  spellingbee: 'Spelling Bee', gridlock: 'Gridlock', wordweaver: 'Word Weaver', baseball: 'Baseball',
  battlearena: 'Battle Arena', cupbaseball: 'Cup Baseball',
};
export const gameName = (id) => GAME_NAMES[id] || id;

export default { RULES, RULE_BY_ID, checkGame, checkStats, checkMatch, checkContextoWin, activeVoids, isVoided, HAND_VOIDS, hitText, GAME_NAMES, gameName };
