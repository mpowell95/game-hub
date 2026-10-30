// eight-ball/js/mp.js - POOL CHALLENGES, turn by turn (Stage 2, 2026-10-22). A match two or three
// people play hours or days apart, one shot at a time. flick-soccer/js/mp.js is the model (and
// Darts', Cup Pong's and Hoops' before it); no code is shared with any of them. What is new here:
// THREE players (Cutthroat), a first for the hub's challenges, so a match has a list of players
// `p` (seat 0 the challenger) instead of sides a and b.
//
// THE LAW applies. A match is not a player's earned history, but the writes still follow rule 6:
// every one is VERIFIED by a fresh re-read, and nothing here ever deletes anything.
//
// THE NODE: `eightball/games/<id>` (the match) + `eightball/index/<CODE>/<id>` (one row per player,
// so "what matches do I have" is ONE read) + `eightball/chat/<id>` (js/match-chat.js, beside the
// match). Addressed by PLAYER CODE, never by deviceId: several people here have two phones.
//
// A MATCH IS A LOG OF SHOTS, NEVER A SNAPSHOT. Each entry is a shot as engine.js plays it: who (the
// seat), where the cue ball was put (only with the ball in hand), the direction (unit, 6 decimals),
// the power (4), the spin (2) and the pocket called. The table is whatever the engine makes of
// replaying them from the match's seed, and engine.js is bit-for-bit deterministic across phones (its
// header says how), so every phone agrees. A document whose log does not replay is refused whole
// (`validateGame`). The shooting phone plays its OWN shot from the rounded numbers too.
//
// THE FIRST RECEIVER BREAKS (seat 1), so the challenge waits on them from the moment it is made and
// every player's row is written at once (Flick Soccer's own-lineup shape, 2026-10-13).
import { getStatsApp } from '../../js/firebase-boot.js';
import { readPath, watchPath } from '../../js/live-read.js';
import { loadProfile } from '../../js/profile-store.js';
import { readOpponentProfiles } from '../../js/stats-net.js';
import { buildIdentity, canonicalName, isPlaceholderName } from '../../js/players-agg.js';
import { recordResult, noteVoidedResult, withChallengeMatch, mayCountChallenge, countingSince, withMode } from '../../js/game-stats.js';
import { isVoidedMatch, voidedResultFor } from '../../js/stats-corrections.js';
import { onlineGate, codeMayPlayOnline } from '../../js/online-gate.js';
import { newMatch, play, nextRack, seatsOf, ballsOf, MODES, RACK_OPTIONS, TABLE_NOW, RULES_NOW } from './engine.js';
import { isNoResult, rowEnding, rowOpen, expiresAt, TIMEOUT, forfeitAt, turnStartOf, timeoutOver, rowTimeout, callOffCosts } from '../../js/challenge-life.js';
import { stampFor, clockNow, decideNow, liveTime, noteTimeout, timeoutUnsure, queueConfirm, confirmsSettled } from '../../js/challenge-clock.js';

const NODE = 'eightball';
const STATS_ID = 'eightball';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
const MAX_LOG = 900;                             // a ceiling against a runaway writer, not a rule
/** The seat that breaks the first rack: the first person the challenge was sent to. */
const BREAKER = 1;
const ms = (v) => (Number.isFinite(+v) ? +v : 0);
/** A chat "side" per seat (js/match-chat.js): a, b, c. */
export const sideLetter = (seat) => ['a', 'b', 'c'][seat] || null;

export function asCode(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return CODE_RE.test(s) ? s : null;
}
export function myCode() {
  try { const p = loadProfile(); return asCode(p && p.playerId); } catch { return null; }
}
export function meLabel() {
  try { const p = loadProfile() || {}; return { name: p.name || '', emoji: p.emoji || '🙂' }; }
  catch { return { name: '', emoji: '🙂' }; }
}

/** A match id: time-ordered, plus eight random characters (Hoops measured four as too few). */
export function mintGameId() {
  const t = Date.now().toString(36);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  try {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    for (const b of buf) r += alphabet[b % 36];
  } catch { for (let i = 0; i < 8; i++) r += alphabet[(Math.random() * 36) | 0]; }
  return t + r;
}
function mintSeed() {
  try { const b = new Uint32Array(1); crypto.getRandomValues(b); return (b[0] >>> 0) || 1; }
  catch { return ((Math.random() * 0xffffffff) >>> 0) || 1; }
}

// --- a dev server never writes to the family's database (js/stats-net.js's guard and opt-in key) --
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function isDevOrigin() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { return false; }
}
function writesAllowed(what) {
  if (!isDevOrigin()) return true;
  try { if (localStorage.getItem(DEV_SYNC_OK) === '1') return true; } catch { /* fall through */ }
  console.warn(`[eight-ball] ${what} BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}
// TEST SEAM: tools/test-eightball-mp.mjs (and the browser checks) hand in an in-memory database.
let bootFn = getStatsApp;
let devGuard = true;
export function __setBootForTest(fn, { allowDev = false } = {}) { bootFn = fn || getStatsApp; devGuard = !allowDev; }
async function ready() { try { return await bootFn(); } catch { return null; } }
const allowed = (what) => !devGuard || writesAllowed(what);
function reasonOf(err) {
  const s = String((err && (err.code || err.message)) || err);
  return /permission|PERMISSION_DENIED/i.test(s) ? 'denied' : s;
}
const fail = (reason, retryable = false) => ({ ok: false, reason, retryable });

// --- the terms --------------------------------------------------------------------------------------
export const AID_IDS = ['easy', 'medium', 'hard'];
/** The match's game, racks, options, aiming help and seed. Absent or junk fields read as defaults. */
export function termsOf(raw) {
  const o = raw && raw.opts && typeof raw.opts === 'object' ? raw.opts : {};
  return {
    mode: raw && MODES.includes(raw.mode) ? raw.mode : '8',
    racks: raw && RACK_OPTIONS.includes(+raw.racks) ? +raw.racks : 1,
    opts: { call: o.call === true, bank: o.bank === true, obst: o.obst === true },
    aids: raw && AID_IDS.includes(raw.aids) ? raw.aids : 'medium',
    seed: raw && Number.isInteger(+raw.seed) && +raw.seed > 0 ? (+raw.seed >>> 0) : 1,
    tb: raw && [2, 3, 4, 5, 6, 7].includes(+raw.tb) ? +raw.tb : 1,    // the table (engine.js, TABLE VERSIONS); none: the first
    rv: raw && [2, 3].includes(+raw.rv) ? +raw.rv : 1,    // the rules (engine.js, RULES VERSIONS); none: the first
    ...fixOf(raw),
  };
}
/** A hand correction to one match (2026-10-24, Matt: Moonis sank the 1 off the break under rules 2,
 *  "just give him solids and the one he sank"): `fix: { after: N, groups: [seat 0's, seat 1's] }`
 *  decides the 8-ball groups once N shots have been played, nothing else. Junk reads as none. */
function fixOf(raw) {
  const f = raw && raw.fix;
  if (!f || typeof f !== 'object' || !raw || raw.mode !== '8') return {};
  const after = +f.after, g = Array.isArray(f.groups) ? f.groups : [];
  if (!Number.isInteger(after) || after < 1 || g.length !== 2 || !['a', 'b'].includes(g[0]) || g[1] !== (g[0] === 'a' ? 'b' : 'a')) return {};
  return { fix: { after, groups: [g[0], g[1]] } };
}
/** Apply the match's fix once `n` shots have been played (call after every shot settles). */
export function fixAfter(m, game, n) {
  const f = game && game.fix;
  if (f && n === f.after && !m.groups && m.winner == null) m.groups = f.groups.slice();
}
/** A fresh engine match for these terms: what every replay starts from. */
export function freshMatch(terms) { return newMatch(terms.mode, terms.racks, BREAKER, terms.seed, terms.opts, terms.tb, terms.rv); }

// --- the log --------------------------------------------------------------------------------------
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r3 = (v) => Math.round(v * 1e3) / 1e3;
const r2 = (v) => Math.round(v * 1e2) / 1e2;

/** A shot reduced to exactly what is stored (the shooting phone plays THIS). Null if it is not one. */
export function roundShot(s) {
  if (!s) return null;
  const dx = +s.dx, dy = +s.dy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 1e-9) || !Number.isFinite(len)) return null;
  const p = r4(Math.max(0, Math.min(1, +s.p)));
  if (!(p > 0)) return null;
  const out = { dx: r6(dx / len), dy: r6(dy / len), p, s: r2(Math.max(-1, Math.min(1, +s.s || 0))) };
  if (Number.isFinite(+s.x) && Number.isFinite(+s.y) && s.x != null && s.y != null) { out.x = r3(+s.x); out.y = r3(+s.y); }
  if (Number.isInteger(s.c) && s.c >= 0 && s.c < 6) out.c = s.c;
  return out;
}

/** One logged shot, cleaned, or null if it is not well formed (`n`: seats in the match). */
export function cleanEntry(e, n = 3) {
  if (!e || typeof e !== 'object') return null;
  const by = +e.by;
  if (!Number.isInteger(by) || by < 0 || by >= n) return null;
  const dx = +e.dx, dy = +e.dy, p = +e.p, s = e.s == null ? 0 : +e.s;
  if (![dx, dy, p, s].every(Number.isFinite)) return null;
  if (Math.abs(dx) > 1.0001 || Math.abs(dy) > 1.0001 || !(p > 0) || p > 1 || Math.abs(s) > 1) return null;
  if (!(dx * dx + dy * dy > 0.98)) return null;   // a direction, not a stray pair of numbers
  const out = { by, dx: r6(dx), dy: r6(dy), p: r4(p), s: r2(s), at: ms(e.at) };
  if (e.x != null || e.y != null) {
    const x = +e.x, y = +e.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.x = r3(x); out.y = r3(y);
  }
  if (e.c != null) {
    const c = +e.c;
    if (!Number.isInteger(c) || c < 0 || c > 5) return null;
    out.c = c;
  }
  return out;
}
const shotOf = (e) => {
  const s = { dx: e.dx, dy: e.dy, p: e.p, s: e.s };
  if (e.x != null) { s.x = e.x; s.y = e.y; }
  if (e.c != null) s.c = e.c;
  return s;
};

/** Play one logged shot into a match, to rest, rules applied (a won rack racks the next). Returns
 *  settle's result, or null when it is not that seat's turn or the shot is not allowed (which makes
 *  the whole log invalid). */
export function applyEntry(m, e) {
  if (m.winner != null || e.by !== m.turn) return null;
  const r = play(m, shotOf(e));
  if (!r) return null;
  if (r.kind === 'rack') nextRack(m);
  return r;
}

/** Replay the first `upto` shots. */
export function buildMatch(game, upto = game.log.length) {
  const m = freshMatch(game);
  for (let i = 0; i < upto; i++) { if (!applyEntry(m, game.log[i])) break; fixAfter(m, game, i + 1); }   // validateGame proved it replays
  return m;
}

function playersOf(raw, n) {
  const src = raw && raw.p;
  const list = [];
  for (let k = 0; k < n; k++) {
    const x = src && src[k];
    const code = asCode(x && x.code);
    if (!code) return null;
    list.push({ code, name: String((x && x.name) || ''), emoji: String((x && x.emoji) || '🙂') });
  }
  if (new Set(list.map((x) => x.code)).size !== n) return null;
  return list;
}

/** Who wins a match one player gave up: the other one; with three, whoever of the other two has the
 *  most of their own balls still on the table (ties: the one who would shoot first after them). */
export function resignWinner(m, quitter) {
  const others = [];
  for (let k = 1; k < m.n; k++) others.push((quitter + k) % m.n);
  if (m.n === 2 || !m.groups) return others[0];
  let best = others[0], bestN = -1;
  for (const s of others) {
    const n = m.out[s] ? -1 : ballsOf(m.groups[s]).filter((i) => m.b[i].on).length;
    if (n > bestN) { bestN = n; best = s; }
  }
  return best;
}

/**
 * WHOLE-DOCUMENT REJECTION (Hoops' rule): a log with one bad entry would replay into a different
 * table on different phones with nothing on screen saying so. So the log is REPLAYED here, and
 * anything that does not replay, or whose stored result disagrees with the replay, is not a match.
 * Every field added later must be OPTIONAL.
 */
export function validateGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const terms = termsOf(raw);
  const n = seatsOf(terms.mode);
  const p = playersOf(raw, n);
  if (!p) return null;
  const src = raw.log && typeof raw.log === 'object' ? raw.log : {};
  const keys = Object.keys(src).sort();
  if (keys.length > MAX_LOG) return null;
  const log = [];
  const m = freshMatch(terms);
  for (const key of keys) {
    const e = cleanEntry(src[key], n);
    if (!e) return null;
    if (!applyEntry(m, e)) return null;
    log.push(e);
    fixAfter(m, terms, log.length);
  }
  let over = null;
  const answered = log.some((e) => e.by !== 0);
  const calledOff = !!raw.over && typeof raw.over === 'object' && raw.over.winner === 'none';
  if (calledOff && !isNoResult(String(raw.over.why || ''))) return null;
  if (calledOff && !answered) {
    over = { winner: 'none', why: String(raw.over.why), by: Number.isInteger(+raw.over.by) ? +raw.over.by : 0, at: ms(raw.over.at) };
  } else if (raw.over && typeof raw.over === 'object' && !calledOff) {
    const w = +raw.over.winner;
    if (!Number.isInteger(w) || w < 0 || w >= n) return null;
    over = { winner: w, why: String(raw.over.why || ''), at: ms(raw.over.at) };
    if (over.why === 'resign') {
      const q = +raw.over.by;
      if (!Number.isInteger(q) || q < 0 || q >= n || q === w) return null;
      over.by = q;
    } else if (m.winner == null || m.winner !== w) return null;   // a result the log did not produce
  } else if (m.winner != null) {
    over = { winner: m.winner, why: 'racks', at: ms(raw.updated) };
  }
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  return {
    v: 1, id, ...terms, n,
    by: asCode(raw.by),
    created: ms(raw.created),
    updated: ms(raw.updated),
    ...(raw.lapse === true ? { lapse: true } : {}),
    p,
    turn: over ? null : m.turn,
    log,
    over,
    scores: m.scores.slice(),
  };
}

export function seatOf(game, code) {
  const me = asCode(code);
  if (!game || !me) return -1;
  return game.p.findIndex((x) => x.code === me);
}
/** The chat side letter of `code` in a TWO-player match (js/game-chat-history.js reads a match's chat
 *  as one conversation between two people); null for a three-player match. */
export function sideOf(game, code) {
  if (!game || game.n !== 2) return null;
  const s = seatOf(game, code);
  return s < 0 ? null : sideLetter(s);
}
export function isMyTurn(game, code) { return !!game && !game.over && seatOf(game, code) === game.turn; }
/** Everybody but `code`, in seat order after them. */
export function othersOf(game, code) {
  const s = seatOf(game, code);
  if (s < 0) return [];
  const out = [];
  for (let k = 1; k < game.n; k++) out.push(game.p[(s + k) % game.n]);
  return out;
}
/** One label for the other players: "Ana", or "Ana & Ben". */
export function themLabel(game, code) {
  const o = othersOf(game, code);
  return { name: o.map((x) => x.name || '?').join(' & '), emoji: (o[0] && o[0].emoji) || '🙂', code: (o[0] && o[0].code) || null };
}

// --- before the challenge is answered (js/challenge-life.js) ---------------------------------------
/** PURE. { open, waiting, expires, expired }: open = not over and nobody it was sent to has shot yet;
 *  waiting = open and it is one of their turns; expires = when it lapses (3 days unanswered). */
export function lifeOf(game, now = decideNow()) {
  if (!game || game.over) return { open: false, waiting: false, expires: 0, expired: false, turnAt: 0, forfeits: 0 };
  const open = !game.log.some((e) => e.by !== 0);
  const waiting = open && game.turn !== 0;
  const expires = expiresAt(game.lapse, waiting, game.updated);
  // ANSWERED: the side on turn has 7 days from when the turn became theirs (2026-10-29,
  // js/challenge-life.js), then forfeits. `turnAt` rides on the index rows so the lists agree.
  const turnAt = open ? 0 : turnStartOf(game.log, game.turn, game.updated, null, now);   // safe times, capped at now (2026-10-29)
  return { open, waiting, expires, expired: expires > 0 && now >= expires, turnAt, forfeits: open ? 0 : forfeitAt(turnAt) };
}
/** Who wins if the player on turn times out: decided exactly like a resignation by them
 *  (`resignWinner`), on the table AS IT WAS when their turn began, so the index rows written at that
 *  moment (`tw`) and every later read agree. With two players: the other one. With three (Cutthroat,
 *  Matt's "7 days, then forfeit", 2026-10-29): the idle player loses, and of the other two the one
 *  with the most of their own balls still on the table wins, ties to whoever shoots next. */
export function timeoutWinner(game) {
  if (!game || game.over || !Number.isInteger(game.turn)) return null;
  if (game.n !== 3) return (game.turn + 1) % game.n;
  let start = game.log.length;
  while (start > 0 && game.log[start - 1].by === game.turn) start--;
  return resignWinner(buildMatch(game, start), game.turn);
}
/** A match whose player on turn sat on it for 7 days is OVER: they lose, why 'timeout'. Derived on
 *  every read (nothing is written), so every phone agrees and a late shot is refused. */
export function withTimeout(game, now) {
  if (game && game.id) noteTimeout(NODE, game.id, true);   // a fresh look: forget an earlier unsure one
  if (!game || game.over) return game;
  // Decided on the SERVER's clock (js/challenge-clock.js); a timeout decided without live server time
  // is shown but never counted (countResult asks timeoutUnsure). 2026-10-29, second pass.
  const c = now == null ? clockNow() : { now, live: true };
  const life = lifeOf(game, c.now);
  const quitter = game.turn;
  const over = timeoutOver({ over: game.over, open: life.open, turn: quitter, turnAt: life.turnAt, other: () => timeoutWinner(game) }, c.now);
  if (over) { game.over = { ...over, by: quitter }; game.turn = null; noteTimeout(NODE, game.id, c.live); }
  return game;
}
/** Has the SENDER (seat 0) shot yet? From then on a cancel or a decline counts as a loss for whoever
 *  does it (Matt, 2026-10-29, js/challenge-life.js callOffCosts). The first receiver breaks, so while a
 *  challenge is open the sender has never shot: calling it off stays free. */
export function senderPlayed(game) { return !!game && game.log.some((e) => e.by === 0); }
export function cancelCosts(game) { return callOffCosts(senderPlayed(game)); }
/** Was this match called off (cancelled or declined) rather than played to a result? */
export const isCalledOff = (game) => !!(game && game.over && game.over.winner === 'none');
/** Did `seat` make the challenge (seat 0) or receive it? */
export const sentBy = (seat) => seat === 0;

/** Where the latest run of OTHER players' shots starts: what this phone should SHOW being played. */
export function lastRunStart(game, mySeat) {
  let i = game.log.length;
  while (i > 0 && game.log[i - 1].by !== mySeat) i--;
  return i;
}

// --- results ------------------------------------------------------------------------------------
export const RESULTS = ['won', 'lost'];
export function resultOf(game, seat) {
  if (!game || !game.over || game.over.winner === 'none') return null;
  return game.over.winner === seat ? 'won' : 'lost';
}

// --- the seen map (the launcher bubble, alert.js) -------------------------------------------------
export const SEEN_KEY = 'gamehub.eightball.seen.v1';
export function readSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const k of Object.keys(raw)) if (ms(raw[k])) out[k] = ms(raw[k]);
    return out;
  } catch { return {}; }
}
function writeSeen(map) {
  try {
    const keys = Object.keys(map);
    if (keys.length > 200) {
      const trimmed = {};
      for (const k of keys.sort((x, y) => map[y] - map[x]).slice(0, 200)) trimmed[k] = map[k];
      map = trimmed;
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch { /* private mode: a bubble shows again, the safe direction */ }
}
export function markSeen(id, updated) {
  if (!id) return;
  const map = readSeen();
  map[id] = Math.max(ms(map[id]), ms(updated) || Date.now());
  writeSeen(map);
}

// --- how far into each match this phone has SHOWN the other players' shots ------------------------
const SHOWN_KEY = 'gamehub.eightball.shown.v1';
export function readShown(id) {
  try { return ms((JSON.parse(localStorage.getItem(SHOWN_KEY) || '{}') || {})[id]); } catch { return 0; }
}
export function markShown(id, n) {
  try {
    const map = JSON.parse(localStorage.getItem(SHOWN_KEY) || '{}') || {};
    map[id] = Math.max(ms(map[id]), n | 0);
    const keys = Object.keys(map);
    if (keys.length > 200) delete map[keys[0]];
    localStorage.setItem(SHOWN_KEY, JSON.stringify(map));
  } catch { /* shows the shots again next time: harmless */ }
}

// --- counting a finished match exactly once per phone (Hoops' ledger) -----------------------------
export const LEDGER_KEY = 'gamehub.eightball.counted.v1';
export function readLedger() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}
export function markCounted(id) {
  if (!id) return false;
  const set = readLedger();
  if (set.has(id)) return false;
  set.add(id);
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify([...set].slice(-400))); } catch { /* private mode */ }
  return true;
}
/** Record a finished match's result on this device, once (THE LAW rule 2: never twice), in the 'mp'
 *  bucket. A VOIDED match (js/stats-corrections.js) is never counted. */
/** WHICH game a challenge was, recorded with its result (js/game-stats.js withMode, 2026-10-30): from the
 *  match (termsOf) every term; from an index row only what the row carries (game and racks). */
export function modeOfMatch(raw) {
  const x = termsOf(raw);
  return { game: x.mode, racks: x.racks, call: x.opts.call ? 1 : 0, bank: x.opts.bank ? 1 : 0, obst: x.opts.obst ? 1 : 0, aids: x.aids };
}
const modeOfRow = (r) => ({ game: MODES.includes(r && r.mode) ? r.mode : '8', racks: RACK_OPTIONS.includes(+(r && r.racks)) ? +r.racks : 1 });
export function countResult(id, won, finishedAt = Date.now(), mode = null) {
  if (isVoidedMatch(STATS_ID, id)) return false;
  // A timeout this page could not confirm on live server time is shown, never counted (2026-10-29).
  if (timeoutUnsure(NODE, id)) return false;
  // A storage that never counted these challenges counts only what finished after it started
  // (2026-10-29, js/game-stats.js mayCountChallenge): a fresh install never re-counts history.
  if (!mayCountChallenge(LEDGER_KEY, finishedAt)) return false;
  if (!markCounted(id)) return false;
  try { withChallengeMatch(STATS_ID, id, () => withMode(mode, 'mp', () => recordResult(STATS_ID, 'mp', !!won))); } catch (err) { console.error('[eight-ball] recordResult failed', err); }
  return true;
}
export function noteVoided() {
  const me = myCode();
  if (!me) return 0;
  let n = 0;
  for (const id of readLedger()) {
    const res = voidedResultFor(STATS_ID, id, me);
    if (res) { try { if (noteVoidedResult(STATS_ID, id, res)) n++; } catch (err) { console.error('[eight-ball] noting a voided match failed', err); } }
  }
  return n;
}
/** Count every finished row not yet counted here, and queue it for the Game Over popup. */
export function recordFinished(rows) {
  // Start this storage's "counting since" clock at its FIRST launcher paint, not at its first finished
  // match: a new player's first win, finished while the app was closed, must still count (2026-10-29).
  countingSince(LEDGER_KEY);
  try { noteVoided(); } catch (err) { console.warn('[eight-ball] noteVoided', err); }
  const ledger = readLedger();
  const fresh = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && RESULTS.includes(r.result) && !ledger.has(r.id) && !isVoidedMatch(STATS_ID, r.id));
  // A TIMEOUT seen on a row is counted only once the match itself confirms it on live server time
  // (2026-10-29, second pass: a phone clock set forward made rows "time out"). The rest count now.
  queueConfirm(NODE, fresh.filter((r) => r.why === TIMEOUT), readGame, (r, g) => {
    const res = resultOf(g, seatOf(g, myCode()));
    if (!RESULTS.includes(res) || !countResult(r.id, res === 'won', g.over.at, modeOfMatch(g))) return false;
    addUnseen([r.id]);
    return true;
  });
  const todo = fresh.filter((r) => r.why !== TIMEOUT && mayCountChallenge(LEDGER_KEY, r.updated));
  for (const r of todo) countResult(r.id, r.result === 'won', r.updated, modeOfRow(r));
  addUnseen(todo.map((r) => r.id));
  return todo.length;
}
/** Resolves once every timeout queued by recordFinished has been confirmed (or not) and counted. */
export const timeoutsSettled = () => confirmsSettled(NODE);
export const UNSEEN_KEY = 'gamehub.eightball.unseenResults.v1';
export function readUnseen() {
  try { const raw = JSON.parse(localStorage.getItem(UNSEEN_KEY) || '[]'); return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}
function writeUnseen(list) { try { localStorage.setItem(UNSEEN_KEY, JSON.stringify(list.slice(-50))); } catch { /* private mode */ } }
export function addUnseen(ids) {
  if (!ids || !ids.length) return;
  const cur = readUnseen();
  for (const id of ids) if (id && !cur.includes(id)) cur.push(id);
  writeUnseen(cur);
}
export function markResultSeen(id) { const cur = readUnseen(); if (cur.includes(id)) writeUnseen(cur.filter((x) => x !== id)); }

// --- reading ------------------------------------------------------------------------------------
export function sortRows(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort((x, y) => {
    if (!!x.over !== !!y.over) return x.over ? 1 : -1;
    if (!x.over && !!x.yourTurn !== !!y.yourTurn) return x.yourTurn ? -1 : 1;
    return ms(y.updated) - ms(x.updated);
  });
}
function rowsFromIndex(val, now = decideNow()) {
  if (!val || typeof val !== 'object') return [];
  return sortRows(Object.keys(val).map((id) => {
    const r = val[id] || {};
    const ended = rowEnding(r, now);
    // Answered, and 7 days on one player's turn (js/challenge-life.js): they lost, why 'timeout'.
    // Three players: who wins is on the row (`tw`, written when the turn began); a row without it
    // (before 2026-10-29) is left to the match itself unless it is this player who sat on the turn.
    let late = ended ? null : rowTimeout(r, now);
    if (late && +r.n === 3 && !r.yourTurn) late = typeof r.tw === 'boolean' ? { ...late, result: r.tw ? 'won' : 'lost' } : null;
    return {
      id, with: asCode(r.with), with2: asCode(r.with2), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      updated: late ? late.at : ms(r.updated), yourTurn: !ended && !late && !!r.yourTurn, over: !!r.over || !!ended || !!late,
      result: late ? late.result : !ended && RESULTS.includes(r.result) ? r.result : null,
      why: ended || (late ? TIMEOUT : typeof r.why === 'string' ? r.why : ''),
      mine: ms(r.mine), theirs: ms(r.theirs),
      mode: MODES.includes(r.mode) ? r.mode : '8', racks: RACK_OPTIONS.includes(+r.racks) ? +r.racks : 1,
      n: +r.n === 3 ? 3 : 2,
      ended, open: ended ? '' : rowOpen(r), expires: ms(r.expires), sent: !!r.sent,
      cancelled: ended === 'cancelled' || ended === 'declined',
    };
  }).filter((r) => ID_RE.test(r.id) && r.with && !isVoidedMatch(STATS_ID, r.id)));
}
export async function readMyGames() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    return rowsFromIndex(await readPath(boot, `${NODE}/index/${me}`));
  } catch (err) { console.warn('[eight-ball] could not read your matches', err); return []; }
}
/** READ-ONLY live listener on your own index. Returns an unsubscribe that is always safe to call. */
export async function watchMyGames(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = watchPath(boot, `${NODE}/index/${me}`, (v) => {
      try { cb(rowsFromIndex(v)); } catch (err) { console.warn('[eight-ball] list watch', err); }
    }, () => {});
    return () => { try { stop(); } catch { /* detached */ } };
  } catch { return () => {}; }
}
export async function readGame(id) {
  if (!ID_RE.test(String(id || ''))) return null;
  try {
    const boot = await ready();
    if (!boot) return null;
    const snap = await boot.api.get(boot.api.ref(boot.db, `${NODE}/games/${id}`));
    if (!snap || !snap.exists()) return null;
    const game = validateGame(snap.val());
    if (!game) { console.error(`[eight-ball] ${NODE}/games/${id} did not validate; refusing to open it.`); return null; }
    game.id = id;
    return withTimeout(game);
  } catch (err) { console.warn('[eight-ball] could not read that match', err); return null; }
}
/** READ-ONLY live listener on one match: `cb` gets the validated match on every change. */
export async function watchGame(id, cb) {
  if (!ID_RE.test(String(id || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/games/${id}`), (snap) => {
      try { const g = validateGame(snap && snap.exists() ? snap.val() : null); if (g) { g.id = id; cb(withTimeout(g)); } }
      catch (err) { console.warn('[eight-ball] match watch', err); }
    }, () => {});
    return () => { try { stop(); } catch { /* detached */ } };
  } catch { return () => {}; }
}

/** WHO YOU CAN CHALLENGE, one row per PLAYER CODE (Hoops' `opponentsFrom`). */
export function opponentsFrom(all, me) {
  const mine = asCode(me);
  const ident = buildIdentity(all);
  const byCode = new Map();
  for (const id of Object.keys(all || {})) {
    const rec = (all || {})[id] || {};
    const p = rec.profile || {};
    const code = asCode(p.playerId);
    const name = String(p.name || '').trim();
    if (!code || !name || isPlaceholderName(name)) continue;
    const at = ms(rec.updatedAt);
    const cur = byCode.get(code);
    if (!cur || at >= cur.at) byCode.set(code, { code, name, emoji: p.emoji || '🙂', at, who: ident.keyFor(p, id) });
  }
  const rows = new Map();
  for (const r of byCode.values()) {
    const k = r.who + '|' + canonicalName(r.name);
    const cur = rows.get(k);
    if (!cur || r.at >= cur.at) rows.set(k, r);
  }
  return [...rows.values()].filter((r) => r.code !== mine)
    .map((r) => ({ code: r.code, name: r.name, emoji: r.emoji }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function readOpponents() {
  // Only people who may play online (js/online-gate.js): a made-up second account is never offered.
  try { return opponentsFrom(await readOpponentProfiles(), myCode()).filter((r) => codeMayPlayOnline(r.code, 'eight-ball', r.name)); }
  catch (err) { console.warn('[eight-ball] could not read the player list', err); return []; }
}

// --- writing ------------------------------------------------------------------------------------
async function readFresh(api, db, id) {
  const snap = await api.get(api.ref(db, `${NODE}/games/${id}`));
  if (!snap || !snap.exists()) return { game: null, why: 'not-found' };
  const game = validateGame(snap.val());
  if (!game) { console.error(`[eight-ball] ${NODE}/games/${id} did not validate; refusing to write to it.`); return { game: null, why: 'invalid-match' }; }
  game.id = id;
  return { game: withTimeout(game), why: null };
}

/** The index row one player gets: the match from seat `seat`. With three players `with` is the next
 *  seat (fixed, so records group by one person) and `with2` the other; `name` names both. `lastBy`
 *  says whose write this is from that row's point of view (what a push function would read). */
export function rowFor(game, seat, writer, tw = game.n === 3 ? timeoutWinner(game) : null) {
  const others = [];
  for (let k = 1; k < game.n; k++) others.push((seat + k) % game.n);
  const life = lifeOf(game);
  const ended = isCalledOff(game) ? game.over.why : '';
  let theirs = 0;
  for (const s of others) theirs = Math.max(theirs, game.scores[s] || 0);
  return {
    with: game.p[others[0]].code,
    ...(others[1] != null ? { with2: game.p[others[1]].code } : {}),
    name: others.map((s) => game.p[s].name || '?').join(' & '),
    emoji: game.p[others[0]].emoji,
    updated: game.updated,
    yourTurn: !game.over && game.turn === seat,
    over: !!game.over && !ended,
    open: life.open ? (seat === 0 ? 'sent' : 'got') : '',
    expires: life.expires,
    turnAt: life.turnAt,                        // when the turn began: 7 days, then forfeit (2026-10-29)
    // Three players: would this seat win if the player on turn timed out (timeoutWinner)?
    ...(game.n === 3 && !game.over && !life.open && Number.isInteger(tw) ? { tw: tw === seat } : {}),
    ended,
    sent: seat === 0,
    pl: senderPlayed(game),                     // the sender has shot: calling off costs a loss (2026-10-29)
    mine: game.scores[seat] || 0, theirs,
    mode: game.mode, racks: game.racks, n: game.n,
    lastBy: writer === seat ? 'me' : 'them',
    ...(game.over && !ended ? { result: resultOf(game, seat), why: String(game.over.why || '') } : {}),
    ...(ended ? { why: ended } : {}),
  };
}
async function writeRows(api, db, game, writer) {
  const tw = game.n === 3 ? timeoutWinner(game) : null;     // one replay for every row
  for (let s = 0; s < game.n; s++) await api.update(api.ref(db, `${NODE}/index/${game.p[s].code}/${game.id}`), rowFor(game, s, writer, tw));
}

/**
 * Start a challenge against `them` (one person, or two for Cutthroat: [{code, name, emoji}]) with
 * `terms` { mode, racks, opts, aids }. The first of them breaks, so every row is written now.
 * Returns { ok, id, game } or a failure.
 */
export async function createGame({ them, mode = '8', racks = 1, opts = {}, aids = 'medium' }) {
  const me = myCode();
  const list = (Array.isArray(them) ? them : [them]).filter(Boolean);
  if (!me) return fail('no-player-code');
  const md = MODES.includes(mode) ? mode : '8';
  if (list.length !== seatsOf(md) - 1) return fail('bad-opponent');
  const codes = list.map((x) => asCode(x && x.code));
  if (codes.some((c) => !c || c === me) || new Set(codes).size !== codes.length) return fail('bad-opponent');
  const gate = onlineGate();
  if (gate) return fail(gate);
  if (list.some((x) => !codeMayPlayOnline(asCode(x.code), 'eight-ball', String(x.name || '')))) return fail('them-not-approved');
  if (!allowed('createGame')) return fail('dev-origin-blocked');
  if (!RACK_OPTIONS.includes(+racks)) return fail('bad-racks');
  const mine = meLabel();
  const id = mintGameId();
  const doc = {
    v: 1, id, mode: md, racks: +racks,
    opts: { call: !!(opts && opts.call), bank: !!(opts && opts.bank), obst: !!(opts && opts.obst) },
    aids: AID_IDS.includes(aids) ? aids : 'medium',
    seed: mintSeed(), tb: TABLE_NOW, rv: RULES_NOW,
    by: me, created: 0, updated: 0, lapse: true,
    p: [{ code: me, name: mine.name, emoji: mine.emoji }, ...list.map((x, k) => ({ code: codes[k], name: String(x.name || ''), emoji: String(x.emoji || '🙂') }))],
    log: null, over: null,
  };
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    doc.created = stampFor(api); doc.updated = stampFor(api);   // the SERVER's time (2026-10-29)
    await api.set(api.ref(db, `${NODE}/games/${id}`), doc);
    const back = await api.get(api.ref(db, `${NODE}/games/${id}`));
    const game = back && back.exists() ? validateGame(back.val()) : null;
    if (!game) { console.error(`[eight-ball] write VERIFY FAILED for ${NODE}/games/${id}`); return fail('did-not-land', true); }
    game.id = id;
    await writeRows(api, db, game, 0);
    markSeen(id, game.updated);
    return { ok: true, id, game };
  } catch (err) {
    console.error('[eight-ball] could not start the match', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * Append this player's shots (`entries`) to the log, starting at `base` (the log length this phone
 * built them on). Idempotent: shots already there are not written twice, and a log that has moved
 * on differently is a conflict, never overwritten. Every player's row is rewritten on every write.
 */
export async function appendLog(id, base, entries) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('appendLog')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    await liveTime(api);            // expiry and timeouts are decided on the server's clock (2026-10-29)
    const { game: fresh, why } = await readFresh(api, db, id);
    if (!fresh) return fail(why);
    const seat = seatOf(fresh, me);
    if (seat < 0) return fail('not-your-game');
    const list = (entries || []).map((e) => cleanEntry(e, fresh.n));
    if (!list.length || list.some((e) => !e || e.by !== seat)) return fail('bad-entry');
    const have = fresh.log.length;
    const same = (x, y) => x && y && x.by === y.by && x.dx === y.dx && x.dy === y.dy && x.p === y.p && x.s === y.s
      && x.x === y.x && x.y === y.y && x.c === y.c;
    let skip = 0;
    while (skip < list.length && base + skip < have && same(fresh.log[base + skip], list[skip])) skip++;
    if (base + skip !== have) return fail('moved-on');
    const todo = list.slice(skip);
    if (!todo.length) {
      if (!(fresh.over && fresh.over.why === TIMEOUT)) await writeRows(api, db, fresh, seat);   // a derived timeout is never written
      if (fresh.over || fresh.turn !== seat) markSeen(id, fresh.updated);
      return { ok: true, game: fresh };
    }
    if (fresh.over) return fail('already-over');   // includes 7 days on a turn (timeout)
    if (lifeOf(fresh).expired) return fail('expired');
    const m = freshMatch(fresh);
    const all = fresh.log.concat(todo);
    for (let i = 0; i < all.length; i++) { if (!applyEntry(m, all[i])) return fail('rules-refused'); fixAfter(m, fresh, i + 1); }
    const now = stampFor(api);      // the SERVER stamps every shot (rules refuse any other time)
    const patch = { updated: now };
    todo.forEach((e, i) => {
      const { at, ...rest } = e;
      patch[`log/${String(have + i).padStart(4, '0')}`] = { ...rest, at: now };
    });
    if (m.winner != null) patch.over = { winner: m.winner, why: 'racks', at: now };
    await api.update(api.ref(db, `${NODE}/games/${id}`), patch);
    const back = await readGame(id);
    if (!back || back.log.length !== have + todo.length) {
      console.error(`[eight-ball] VERIFY FAILED for ${NODE}/games/${id}: expected ${have + todo.length} shots.`);
      return fail('did-not-land', true);
    }
    await writeRows(api, db, back, seat);
    if (back.over || back.turn !== seat) markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[eight-ball] could not send the shot', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** CALL OFF a challenge nobody it was sent to has answered: the sender CANCELS, a receiver DECLINES.
 *  Counts for nobody, nothing is deleted. Refused with 'accepted' once any receiver has shot. */
export async function cancelGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('cancelGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    await liveTime(api);
    const { game: fresh, why: bad } = await readFresh(api, db, id);
    if (!fresh) return fail(bad);
    const seat = seatOf(fresh, me);
    if (seat < 0) return fail('not-your-game');
    let back = fresh;
    let lost = false;
    if (fresh.over) {
      lost = fresh.over.why === 'resign' && fresh.over.by === seat;   // a costly call-off, retried
      if (!isCalledOff(fresh) && !lost) return fail('already-over');
    } else {
      if (!lifeOf(fresh).open) return fail('accepted');
      const now = stampFor(api);
      const why = seat === 0 ? 'cancelled' : 'declined';
      // Once the sender has shot, calling it off is a LOSS for whoever does it (Matt, 2026-10-29):
      // stored as their resignation (resignWinner wins), `via` saying how. Before that, for nobody.
      lost = cancelCosts(fresh);
      const over = lost ? { winner: resignWinner(buildMatch(fresh), seat), why: 'resign', by: seat, via: why, at: now } : { winner: 'none', why, by: seat, at: now };
      await api.update(api.ref(db, `${NODE}/games/${id}`), { over, updated: now });
      back = (await readFresh(api, db, id)).game;
      if (!back) return fail('did-not-land', true);
      if (lost) { if (!back.over || back.over.why !== 'resign' || back.over.by !== seat) return fail('did-not-land', true); }
      else if (!isCalledOff(back)) return back.over ? fail('already-over') : fail('accepted');
    }
    await writeRows(api, db, back, seat);
    markSeen(id, back.updated);
    return lost ? { ok: true, game: back, lost: true } : { ok: true, game: back, cancelled: true };
  } catch (err) {
    console.error('[eight-ball] could not call the challenge off', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** Give the match up (`resignWinner` wins; nothing is deleted). Unanswered: called off instead. */
export async function resignGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('resignGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    await liveTime(api);            // expiry and timeouts are decided on the server's clock (2026-10-29)
    const { game: fresh, why } = await readFresh(api, db, id);
    if (!fresh) return fail(why);
    const seat = seatOf(fresh, me);
    if (seat < 0) return fail('not-your-game');
    const mineResign = (g) => g.over && g.over.why === 'resign' && g.over.by === seat;
    if (fresh.over && fresh.over.why === TIMEOUT) return fail('already-over');   // timed out: already decided
    if (fresh.over && !mineResign(fresh)) return { ok: true, game: fresh, cancelled: isCalledOff(fresh) };
    if (!fresh.over && lifeOf(fresh).open) return cancelGame(id);
    let back = fresh;
    if (!fresh.over) {
      const now = stampFor(api);
      const w = resignWinner(buildMatch(fresh), seat);
      await api.update(api.ref(db, `${NODE}/games/${id}`), { over: { winner: w, why: 'resign', by: seat, at: now }, updated: now });
      back = (await readFresh(api, db, id)).game;
      if (!back || !back.over) return fail('did-not-land', true);
    }
    await writeRows(api, db, back, seat);
    markSeen(id, back.updated);
    return { ok: true, game: back, cancelled: false };
  } catch (err) {
    console.error('[eight-ball] could not resign', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

// --- the offline outbox: a shot made with no signal is KEPT and retried, never dropped -----------
export const OUTBOX_KEY = 'gamehub.eightball.outbox.v1';
function readOutbox() {
  try { const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeOutbox(q) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.slice(-40))); } catch (err) { console.error('[eight-ball] outbox write failed', err); }
}
export function savePending(id, base, entries) {
  const q = readOutbox().filter((x) => x.id !== id);
  if (entries && entries.length) q.push({ id, base, entries: entries.slice() });
  writeOutbox(q);
}
export function pendingFor(id) { const x = readOutbox().find((y) => y.id === id); return x ? x : null; }
export function outboxCount() { return readOutbox().length; }
/** The only refusals that drop a queued shot: the MATCH says no, so no retry will ever land it. */
export const NEVER_SENDABLE = ['moved-on', 'already-over', 'rules-refused', 'not-your-game', 'bad-entry', 'not-found', 'invalid-match', 'expired'];
export async function drainOutbox(onlyId = null, exceptId = null) {
  const q = readOutbox();
  if (!q.length) return 0;
  const done = new Set();
  let sent = 0;
  for (const item of q) {
    if ((onlyId && item.id !== onlyId) || (exceptId && item.id === exceptId)) continue;
    const res = await appendLog(item.id, item.base, item.entries);
    if (res.ok) { sent++; done.add(item.id); }
    else if (NEVER_SENDABLE.includes(res.reason)) { done.add(item.id); console.warn('[eight-ball] dropping queued shots that can no longer be sent:', res.reason, item); }
  }
  if (done.size) writeOutbox(readOutbox().filter((x) => !done.has(x.id)));
  return sent;
}

// --- history --------------------------------------------------------------------------------------
/** Records per opponent (by CODE; a three-player match counts against both), and the finished rows
 *  newest first. Pure. */
export function recordsFrom(rows, code) {
  const me = asCode(code);
  const finished = (Array.isArray(rows) ? rows : []).filter((r) => r && r.over && !r.ended && asCode(r.with) && asCode(r.with) !== me)
    .map((r) => ({ ...r, resigned: r.why === 'resign' ? 'yes' : null, timedOut: r.why === TIMEOUT }))
    .sort((x, y) => ms(y.updated) - ms(x.updated));
  const by = new Map();
  for (const r of finished) {
    const names = String(r.name || '').split(' & ');
    [[r.with, names[0]], [r.with2, names[1]]].forEach(([c, nm], k) => {
      if (!c) return;
      let o = by.get(c);
      if (!o) { o = { code: c, name: nm || r.name, emoji: k ? '🙂' : r.emoji, won: 0, lost: 0, played: 0, last: ms(r.updated) }; by.set(c, o); }
      o.played++;
      if (r.result === 'won') o.won++; else if (r.result === 'lost') o.lost++;
    });
  }
  return { opponents: [...by.values()].sort((x, y) => (y.played - x.played) || (y.last - x.last)), finished };
}
