// flick-soccer/js/mp.js - FLICK SOCCER CHALLENGES, turn by turn (2026-10-11). A match two people play
// hours or days apart, one flick each. darts/js/mp.js is the model (and cup-pong's and hoops4's
// before it); no code is shared with any of them.
//
// THE LAW applies. A match is not a player's earned history, but the writes still follow rule 6:
// every one is VERIFIED by a fresh re-read, and nothing here ever deletes anything.
//
// THE NODE: `flicksoccer/games/<id>` (the match) + `flicksoccer/index/<CODE>/<id>` (one row per
// person, so "what matches do I have" is ONE read). Addressed by PLAYER CODE, never by deviceId:
// several people here have two phones.
//
// A MATCH IS A LOG OF FLICKS, NEVER A SNAPSHOT. Each entry is which disc (0-4 of that side's five),
// the direction (a unit vector, 6 decimals) and the strength (0-1, 4 decimals). The pitch is whatever
// the engine makes of replaying them, and engine.js is bit-for-bit deterministic across phones (its
// header says how), so both phones always agree. A document whose log does not replay is refused
// whole (`validateGame`). The flicking phone plays its OWN shot from the rounded numbers too, so what
// it saw is exactly what the other phone will see.
//
// WRITTEN AT THE MOMENT OF THE FLICK (`appendLog`), before the shot has even stopped rolling, so a
// closed app cannot lose a shot and cannot take a bad one back. Index rows change only when the turn
// passes or the match ends, which is what the push function (functions/index.js,
// flickSoccerTurnPush) watches.
//
// THE CHALLENGE IS DELIVERED WHEN THE CHALLENGER'S FIRST TURN ENDS (Hoops' lesson, 2026-09-23): the
// challenger kicks off, so the other person's row is written only once it is their turn.
//
// NEEDS MATT: `flicksoccer` is a new top-level node, so it must be in the PUBLISHED rules
// (database.rules.json, pasted by hand). Until then every call fails softly: reads return [] and
// writes return { ok:false, reason:'denied' }.
import { getStatsApp } from '../../js/firebase-boot.js';
import { readPath, watchPath } from '../../js/live-read.js';
import { loadProfile } from '../../js/profile-store.js';
import { readOpponentProfiles } from '../../js/stats-net.js';
import { buildIdentity, canonicalName, isPlaceholderName } from '../../js/players-agg.js';
import { recordResult, noteVoidedResult, withChallengeMatch, mayCountChallenge, countingSince } from '../../js/game-stats.js';
import { isVoidedMatch, voidedResultFor } from '../../js/stats-corrections.js';
import { onlineGate, codeMayPlayOnline } from '../../js/online-gate.js';
import { newMatch, flick, runToRest, settle, cleanForms, cleanPairs, GOAL_OPTIONS, DISCS } from './engine.js';
import { isNoResult, rowEnding, rowOpen, expiresAt, TIMEOUT, forfeitAt, turnStartOf, timeoutOver, rowTimeout } from '../../js/challenge-life.js';

const NODE = 'flicksoccer';
const STATS_ID = 'flicksoccer';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
const MAX_LOG = 600;                             // a ceiling against a runaway writer, not a rule
const ms = (v) => (Number.isFinite(+v) ? +v : 0);
const other = (s) => (s === 'a' ? 'b' : 'a');
const seatOf = (side) => (side === 'b' ? 1 : 0);
const sideOfSeat = (seat) => (seat === 1 ? 'b' : 'a');
/** Who a match was SENT to: the side that is not its maker (`by`). Every Flick Soccer challenge is
 *  made by side 'a', so this is 'b' unless a document says otherwise. */
const recipientOfRaw = (aCode, bCode, by) => (by && by === bCode && by !== aCode ? 'a' : 'b');

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
  console.warn(`[flick-soccer] ${what} BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}
// TEST SEAM: test-flicksoccer-mp.mjs (and the browser checks) hand in an in-memory database.
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

/** Goals to win. Absent or junk reads as 2, the default. */
export const goalsOfGame = (raw) => (raw && GOAL_OPTIONS.includes(+raw.goals) ? +raw.goals : 2);
/** The two line-ups [side a, side b] (optional field, added 2026-10-11; absent reads as balanced). */
export const formsOfGame = (raw) => cleanForms(raw && raw.forms);
/** Who kicks off (optional field, 2026-10-13): 1 = side b. Absent reads 0, the challenger, which is
 *  how every match before own-lineup challenges was played. */
export const starterOfGame = (raw) => (raw && +raw.starter === 1 ? 1 : 0);
/** Aiming help for both players (optional field, 2026-10-15, Matt: "We only assigned those by
 *  difficulty. But I want to be able to choose"): chosen by the challenger. Absent reads 'medium',
 *  what every challenge before it had. Display only: it never touches the physics or the log. */
export const AID_IDS = ['easy', 'medium', 'hard'];
export const aidsOfGame = (raw) => (raw && AID_IDS.includes(raw.aids) ? raw.aids : 'medium');
/** Each side's two line-ups (optional field, 2026-10-14): `pairs: { a: [kick-off, defending], b: [...] }`,
 *  as [[side a], [side b]] for engine.js, or null for a match without it (one line-up per side for
 *  the whole match, `forms`). Side b's is written when b first opens the match (`pickLineup`); until
 *  then, and for a phone that wrote only `forms/1`, b's line-up is its `forms` entry. */
export const pairsOfGame = (raw) => {
  const p = raw && raw.pairs;
  if (!p || typeof p !== 'object') return null;
  const one = (x) => (Array.isArray(x) || (x && typeof x === 'object') ? [x[0], x[1]] : null);
  return cleanPairs([one(p.a), one(p.b)]);
};

// --- the log --------------------------------------------------------------------------------------
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** A flick reduced to exactly what is stored: { k: disc 0-4, dx, dy (unit, 6 dp), p (0-1, 4 dp) }.
 *  The flicking phone plays THIS, not the raw numbers, so both phones play the same shot. Returns
 *  null for a flick that is not one (no direction, no strength). */
export function roundShot(k, dx, dy, p) {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 1e-9) || !Number.isFinite(len)) return null;
  const pp = r4(Math.max(0, Math.min(1, +p)));
  if (!(pp > 0)) return null;
  return { k: k | 0, dx: r6(dx / len), dy: r6(dy / len), p: pp };
}

/** One logged flick, cleaned, or null if it is not well formed. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.by !== 'a' && e.by !== 'b') return null;
  const k = +e.k;
  if (!Number.isInteger(k) || k < 0 || k >= DISCS) return null;
  const dx = +e.dx, dy = +e.dy, p = +e.p;
  if (![dx, dy, p].every(Number.isFinite)) return null;
  if (Math.abs(dx) > 1.0001 || Math.abs(dy) > 1.0001 || !(p > 0) || p > 1) return null;
  if (!(dx * dx + dy * dy > 0.98)) return null;   // a direction, not a stray pair of numbers
  return { by: e.by, k, dx: r6(dx), dy: r6(dy), p: r4(p), at: ms(e.at) };
}

/** The body index (engine.js) of side `by`'s disc `k`. */
export const bodyOf = (by, k) => 1 + seatOf(by) * DISCS + k;

/** Play one logged flick into a match (stored frame: seat 0 is side 'a', the challenger), to rest,
 *  and apply the rules. Returns settle's event ('turn' | 'goal' | 'win'), or null when it is not that
 *  side's turn (which makes the whole log invalid). */
export function applyEntry(m, e) {
  if (m.winner != null) return null;
  if (seatOf(e.by) !== m.turn) return null;
  flick(m.b, bodyOf(e.by, e.k), e.dx, e.dy, e.p);
  const r = runToRest(m.b);
  return settle(m, r.scorer);
}

/** Replay the first `upto` flicks. */
export function buildMatch(game, upto = game.log.length) {
  const m = newMatch(goalsOfGame(game), starterOfGame(game), formsOfGame(game), game.pairs || pairsOfGame(game));
  for (let i = 0; i < upto; i++) if (!applyEntry(m, game.log[i])) break;   // validateGame proved it replays
  return m;
}

/**
 * WHOLE-DOCUMENT REJECTION (Hoops' rule, and js/career-store.js's): a log with one bad entry would
 * replay into a different position on the two phones with nothing on screen saying so. So the log
 * is REPLAYED here, and anything that does not replay, or whose stored result disagrees with the
 * replay, is not a match. Every field added later must be OPTIONAL.
 */
export function validateGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = asCode(raw.a && raw.a.code);
  const b = asCode(raw.b && raw.b.code);
  if (!a || !b || a === b) return null;
  const src = raw.log && typeof raw.log === 'object' ? raw.log : {};
  const keys = Object.keys(src).sort();
  if (keys.length > MAX_LOG) return null;
  const log = [];
  const goals = goalsOfGame(raw);
  const forms = formsOfGame(raw);
  const starter = starterOfGame(raw);
  const pairs = pairsOfGame(raw);
  const m = newMatch(goals, starter, forms, pairs);
  for (const key of keys) {
    const e = cleanEntry(src[key]);
    if (!e) return null;
    if (!applyEntry(m, e)) return null;
    log.push(e);
  }
  let over = null;
  // CALLED OFF before its receiver answered (2026-10-13, js/challenge-life.js): counts for nobody.
  // Only honoured while the receiver has not flicked. A cancel that raced their first flick is void
  // and the match plays on, the same answer on both phones because both replay the same log.
  const to = recipientOfRaw(a, b, asCode(raw.by));
  const calledOff = !!raw.over && typeof raw.over === 'object' && raw.over.winner === 'none';
  if (calledOff && !isNoResult(String(raw.over.why || ''))) return null;
  if (calledOff && !log.some((e) => e.by === to)) {
    over = { winner: 'none', why: String(raw.over.why), at: ms(raw.over.at) };
  } else if (raw.over && typeof raw.over === 'object' && !calledOff) {
    const w = raw.over.winner;
    if (w !== 'a' && w !== 'b') return null;
    over = { winner: w, why: String(raw.over.why || ''), at: ms(raw.over.at) };
    // A result the log did not produce is only allowed for a resignation.
    if (over.why !== 'resign' && (m.winner == null || sideOfSeat(m.winner) !== w)) return null;
  } else if (m.winner != null) {
    over = { winner: sideOfSeat(m.winner), why: 'goals', at: ms(raw.updated) };
  }
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  // Side b still has to choose a line-up (own-lineup challenges, 2026-10-13). Only meaningful before
  // the first flick: nobody can flick until it is done, so a log with entries has no pick pending.
  const pick = raw.pick === 'b' && !log.length && !over ? 'b' : null;
  return {
    v: 1, id, goals, forms, starter, pick, ...(pairs ? { pairs } : {}), aids: aidsOfGame(raw),
    by: asCode(raw.by),
    created: ms(raw.created),
    updated: ms(raw.updated),
    // OPTIONAL (2026-10-13): expires if its receiver has not answered in 3 days. Absent on every
    // match made before, which never expires (js/challenge-life.js).
    ...(raw.lapse === true ? { lapse: true } : {}),
    a: { code: a, name: String((raw.a && raw.a.name) || ''), emoji: String((raw.a && raw.a.emoji) || '🙂') },
    b: { code: b, name: String((raw.b && raw.b.name) || ''), emoji: String((raw.b && raw.b.emoji) || '🙂') },
    turn: over ? null : sideOfSeat(m.turn),
    log,
    over,
    scores: { a: m.scores[0], b: m.scores[1] },
  };
}

export function sideOf(game, code) {
  const me = asCode(code);
  if (!game || !me) return null;
  if (game.a.code === me) return 'a';
  if (game.b.code === me) return 'b';
  return null;
}
export function isMyTurn(game, code) { return !!game && !game.over && sideOf(game, code) === game.turn; }

// --- before the challenge is answered (2026-10-13, js/challenge-life.js) ---------------------------
/** The side the challenge was sent to. */
export function recipientOf(game) { return game ? recipientOfRaw(game.a.code, game.b.code, game.by) : 'b'; }
/** PURE. { open, waiting, expires, expired }: open = not over and the receiver has not flicked
 *  (picking a line-up is not an answer: they can still decline after it); waiting = open and it is
 *  the receiver's turn; expires = when a waiting challenge lapses (0 = never: a match made before
 *  2026-10-13). The receiver kicks off, so a challenge waits on them from the moment it is made. */
export function lifeOf(game, now = Date.now()) {
  if (!game || game.over) return { open: false, waiting: false, expires: 0, expired: false, turnAt: 0, forfeits: 0 };
  const to = recipientOf(game);
  const open = !game.log.some((e) => e.by === to);
  const waiting = open && game.turn === to;
  const expires = expiresAt(game.lapse, waiting, game.updated);
  // ANSWERED: the side on turn has 7 days from when the turn became theirs (2026-10-29,
  // js/challenge-life.js), then forfeits. `turnAt` rides on the index rows so the lists agree.
  const turnAt = open ? 0 : turnStartOf(game.log, game.turn, game.updated);
  return { open, waiting, expires, expired: expires > 0 && now >= expires, turnAt, forfeits: open ? 0 : forfeitAt(turnAt) };
}
/** A match whose player on turn sat on it for 7 days is OVER: they lose, why 'timeout'. Derived on
 *  every read (nothing is written), so both phones agree and a late move is refused. */
export function withTimeout(game, now = Date.now()) {
  if (!game || game.over) return game;
  const life = lifeOf(game, now);
  const over = timeoutOver({ over: game.over, open: life.open, turn: game.turn, turnAt: life.turnAt, other }, now);
  if (over) { game.over = over; game.turn = null; }
  return game;
}
/** Was this match called off (cancelled or declined) rather than played to a result? */
export const isCalledOff = (game) => !!(game && game.over && game.over.winner === 'none');
export function themOf(game, code) { const s = sideOf(game, code); return (s === 'a' ? game.b : game.a) || { code: null, name: '', emoji: '🙂' }; }

/** Where the opponent's latest run of flicks starts: what this phone should SHOW them taking. */
export function lastRunStart(game, theirSide) {
  let i = game.log.length;
  while (i > 0 && game.log[i - 1].by === theirSide) i--;
  return i;
}

// --- results ------------------------------------------------------------------------------------
export const RESULTS = ['won', 'lost'];
export function resultOf(game, side) {
  if (!game || !game.over || (side !== 'a' && side !== 'b')) return null;
  if (game.over.winner === 'none') return null;             // called off: counts for nobody
  return game.over.winner === side ? 'won' : 'lost';
}

// --- the seen map (the launcher bubble, alert.js) -------------------------------------------------
// This module's own writes stamp it, so only the OTHER person's writes can raise the bubble (Hoops'
// "the challenge that was not a challenge", 2026-09-23). One-tap recreatable: losing it re-shows.
export const SEEN_KEY = 'gamehub.flicksoccer.seen.v1';
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

// --- how far into each match this phone has SHOWN the other person's flicks -----------------------
const SHOWN_KEY = 'gamehub.flicksoccer.shown.v1';
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
  } catch { /* shows the flicks again next time: harmless */ }
}

// --- counting a finished match exactly once, on BOTH phones (Hoops' ledger, 2026-09-23) -----------
export const LEDGER_KEY = 'gamehub.flicksoccer.counted.v1';
export function readLedger() {
  try {
    const raw = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}
/** Mark a match as counted here. False if it already was: the caller must then NOT record it. */
export function markCounted(id) {
  if (!id) return false;
  const set = readLedger();
  if (set.has(id)) return false;
  set.add(id);
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify([...set].slice(-400))); } catch { /* private mode */ }
  return true;
}
/** Record a finished match's result on this device, once (THE LAW rule 2: never twice). Online
 *  results go in the 'mp' bucket (docs/BUILDING-A-GAME.md, "Multiplayer save-key convention"). A
 *  VOIDED match (js/stats-corrections.js) is never counted, and is not marked counted either. */
export function countResult(id, won, finishedAt = Date.now()) {
  if (isVoidedMatch(STATS_ID, id)) return false;
  // A storage that never counted these challenges counts only what finished after it started
  // (2026-10-29, js/game-stats.js mayCountChallenge): a fresh install never re-counts history.
  if (!mayCountChallenge(LEDGER_KEY, finishedAt)) return false;
  if (!markCounted(id)) return false;
  try { withChallengeMatch(STATS_ID, id, () => recordResult(STATS_ID, 'mp', !!won)); } catch (err) { console.error('[flick-soccer] recordResult failed', err); }
  return true;
}
/** A voided match this phone HAD counted: noted once, so the stats screens take it back out. */
export function noteVoided() {
  const me = myCode();
  if (!me) return 0;
  let n = 0;
  for (const id of readLedger()) {
    const res = voidedResultFor(STATS_ID, id, me);
    if (res) { try { if (noteVoidedResult(STATS_ID, id, res)) n++; } catch (err) { console.error('[flick-soccer] noting a voided match failed', err); } }
  }
  return n;
}
/** Count every finished row not yet counted here, and queue it for the Game Over popup. */
export function recordFinished(rows) {
  // Start this storage's "counting since" clock at its FIRST launcher paint, not at its first finished
  // match: a new player's first win, finished while the app was closed, must still count (2026-10-29).
  countingSince(LEDGER_KEY);
  try { noteVoided(); } catch (err) { console.warn('[flick-soccer] noteVoided', err); }
  const ledger = readLedger();
  const todo = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && RESULTS.includes(r.result) && !ledger.has(r.id) && !isVoidedMatch(STATS_ID, r.id) && mayCountChallenge(LEDGER_KEY, r.updated));
  for (const r of todo) countResult(r.id, r.result === 'won', r.updated);
  addUnseen(todo.map((r) => r.id));
  return todo.length;
}
export const UNSEEN_KEY = 'gamehub.flicksoccer.unseenResults.v1';
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
function rowsFromIndex(val, now = Date.now()) {
  if (!val || typeof val !== 'object') return [];
  return sortRows(Object.keys(val).map((id) => {
    const r = val[id] || {};
    // Cancelled, declined or expired (js/challenge-life.js): finished, with no result for anybody.
    // That includes this game's first form of a called-off challenge (over, result 'cancelled').
    const ended = rowEnding(r, now);
    // Answered, and 7 days on one player's turn (js/challenge-life.js): they lost, why 'timeout'.
    const late = ended ? null : rowTimeout(r, now);
    return {
      id, with: asCode(r.with), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      updated: late ? late.at : ms(r.updated), yourTurn: !ended && !late && !!r.yourTurn, over: !!r.over || !!ended || !!late,
      result: late ? late.result : !ended && RESULTS.includes(r.result) ? r.result : null,
      why: ended || (late ? TIMEOUT : typeof r.why === 'string' ? r.why : ''),
      mine: ms(r.mine), theirs: ms(r.theirs), goals: GOAL_OPTIONS.includes(+r.goals) ? +r.goals : 2,
      ended, open: ended ? '' : rowOpen(r), expires: ms(r.expires), sent: !!r.sent,
      cancelled: ended === 'cancelled' || ended === 'declined',
    };
    // A voided match (js/stats-corrections.js) is left out of every list and record built from here.
    // A called-off or expired one stays in the list (the Challenges screen says how it ended) and is
    // left out of every record (recordsFrom).
  }).filter((r) => ID_RE.test(r.id) && r.with && !isVoidedMatch(STATS_ID, r.id)));
}
export async function readMyGames() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    return rowsFromIndex(await readPath(boot, `${NODE}/index/${me}`));
  } catch (err) { console.warn('[flick-soccer] could not read your matches', err); return []; }
}
/** READ-ONLY live listener on your own index. Returns an unsubscribe that is always safe to call. */
export async function watchMyGames(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = watchPath(boot, `${NODE}/index/${me}`, (v) => {
      try { cb(rowsFromIndex(v)); } catch (err) { console.warn('[flick-soccer] list watch', err); }
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
    if (!game) { console.error(`[flick-soccer] ${NODE}/games/${id} did not validate; refusing to open it.`); return null; }
    game.id = id;
    return withTimeout(game);
  } catch (err) { console.warn('[flick-soccer] could not read that match', err); return null; }
}
/** READ-ONLY live listener on one match: `cb` gets the validated match on every change. */
export async function watchGame(id, cb) {
  if (!ID_RE.test(String(id || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/games/${id}`), (snap) => {
      try { const g = validateGame(snap && snap.exists() ? snap.val() : null); if (g) { g.id = id; cb(withTimeout(g)); } }
      catch (err) { console.warn('[flick-soccer] match watch', err); }
    }, () => {});
    return () => { try { stop(); } catch { /* detached */ } };
  } catch { return () => {}; }
}

/** WHO YOU CAN CHALLENGE, one row per PLAYER CODE (Hoops' `opponentsFrom`, 2026-09-24). */
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
  try { return opponentsFrom(await readOpponentProfiles(), myCode()).filter((r) => codeMayPlayOnline(r.code, 'flick-soccer', r.name)); }
  catch (err) { console.warn('[flick-soccer] could not read the player list', err); return []; }
}

// --- writing ------------------------------------------------------------------------------------

/** The index row one person gets: what the match looks like from `side`. `lastBy` says whose write
 *  this is from that row's point of view, which is what the push function reads. */
/** The match as stored right now, read inside a write. Unlike readGame, a network failure THROWS
 *  (so the caller's catch calls it retryable) and a document that is there but does not validate is
 *  told apart from one that is not there at all: neither of those will ever start working, so
 *  neither may be retried for ever. */
async function readFresh(api, db, id) {
  const snap = await api.get(api.ref(db, `${NODE}/games/${id}`));
  if (!snap || !snap.exists()) return { game: null, why: 'not-found' };
  const game = validateGame(snap.val());
  if (!game) { console.error(`[flick-soccer] ${NODE}/games/${id} did not validate; refusing to write to it.`); return { game: null, why: 'invalid-match' }; }
  game.id = id;
  return { game: withTimeout(game), why: null };
}
/** Has the other person been handed this match yet? Side 'a' (the challenger) delivers it the moment
 *  its first turn ends; until then only the challenger's own row exists. */
function delivered(game, side) {
  return side === 'b' || !!game.over || game.turn !== side || game.log.some((e) => e.by !== side);
}

function rowFor(game, side, writer) {
  const them = side === 'a' ? game.b : game.a;
  const life = lifeOf(game);
  // A called-off match is stored over:false / yourTurn:false with `ended` saying why, so the deployed
  // push function (functions/decide.js, which knows no "cancelled") sends nothing for it. Every
  // reader turns it back into a finished row (rowsFromIndex, js/challenge-life.js rowEnding).
  const ended = isCalledOff(game) ? game.over.why : '';
  return {
    with: them.code, name: them.name, emoji: them.emoji,
    updated: game.updated,
    yourTurn: !game.over && game.turn === side,
    over: !!game.over && !ended,
    // Written on EVERY row write, so an answered challenge clears what its unanswered rows said.
    open: life.open ? (side === recipientOf(game) ? 'got' : 'sent') : '',
    expires: life.expires,
    turnAt: life.turnAt,                        // when the turn began: 7 days, then forfeit (2026-10-29)
    ended,
    sent: side !== recipientOf(game),           // this row's owner sent the challenge (2026-10-13)
    mine: game.scores[side], theirs: game.scores[other(side)],
    goals: game.goals,
    lastBy: writer === side ? 'me' : 'them',
    ...(game.over && !ended ? { result: resultOf(game, side), why: String(game.over.why || '') } : {}),
    ...(ended ? { why: ended } : {}),
  };
}
async function writeRows(api, db, game, writer, only = null) {
  if (only !== 'b') await api.update(api.ref(db, `${NODE}/index/${game.a.code}/${game.id}`), rowFor(game, 'a', writer));
  if (only !== 'a') await api.update(api.ref(db, `${NODE}/index/${game.b.code}/${game.id}`), rowFor(game, 'b', writer));
}

/**
 * Start a challenge against `them` ({code, name, emoji}). Own-lineup challenges (2026-10-13, Matt:
 * "Make sure they know their role before selecting"): the challenger (side 'a') picks THEIR line-up
 * (`form`); the other person sees it, picks theirs (pickLineup) and KICKS OFF. So the match is
 * theirs from the start and both rows are written now. Returns { ok, id, game } or a failure.
 */
export async function createGame({ them, goals = 2, form, pair, aids }) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return fail('no-player-code');
  if (!to || to === me) return fail('bad-opponent');
  // Both people must be allowed online (2026-10-08, the play-yourself cheat): js/online-gate.js.
  const gate = onlineGate();
  if (gate) return fail(gate);
  if (!codeMayPlayOnline(to, 'flick-soccer', String(them.name || ''))) return fail('them-not-approved');
  if (!allowed('createGame')) return fail('dev-origin-blocked');
  if (!GOAL_OPTIONS.includes(+goals)) return fail('bad-goals');
  const mine = meLabel();
  const now = Date.now();
  const id = mintGameId();
  const myPair = cleanForms(Array.isArray(pair) ? pair : [form, form]);
  const doc = {
    // Since 2026-10-14 each side brings TWO line-ups (`pair`: [kicking off, defending]); side b kicks
    // off, so side a starts on its defending one. A caller with one `form` uses it for both.
    v: 1, id, goals: +goals, forms: cleanForms([myPair[1], 'balanced']), pairs: { a: myPair }, starter: 1, pick: 'b',
    aids: AID_IDS.includes(aids) ? aids : 'medium',
    by: me, created: now, updated: now, lapse: true,
    a: { code: me, name: mine.name, emoji: mine.emoji },
    b: { code: to, name: String(them.name || ''), emoji: String(them.emoji || '🙂') },
    log: null, over: null,
  };
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    await api.set(api.ref(db, `${NODE}/games/${id}`), doc);
    const back = await api.get(api.ref(db, `${NODE}/games/${id}`));
    const game = back && back.exists() ? validateGame(back.val()) : null;
    if (!game) { console.error(`[flick-soccer] write VERIFY FAILED for ${NODE}/games/${id}`); return fail('did-not-land', true); }
    game.id = id;
    await writeRows(api, db, game, 'a');
    markSeen(id, game.updated);
    return { ok: true, id, game };
  } catch (err) {
    console.error('[flick-soccer] could not start the match', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * Side b chooses its line-up (own-lineup challenges). Allowed once, before any flick; verified by a
 * fresh re-read. Returns { ok, game } or a failure.
 */
export async function pickLineup(id, form) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('pickLineup')) return fail('dev-origin-blocked');
  // `form` is side b's pair [kicking off, defending] (2026-10-14), or one line-up for both roles.
  const pair = cleanForms(Array.isArray(form) ? form : [form, form]);
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const { game: fresh, why } = await readFresh(api, db, id);
    if (!fresh) return fail(why);
    if (sideOf(fresh, me) !== 'b') return fail('not-your-game');
    if (fresh.over) return fail('already-over');              // called off before she picked
    if (!fresh.pick) return { ok: true, game: fresh };          // already chosen (a retry)
    if (lifeOf(fresh).expired) return fail('expired');
    const now = Date.now();
    const f = pair[fresh.starter === 1 ? 0 : 1];                 // what b stands at the kick-off
    await api.update(api.ref(db, `${NODE}/games/${id}`), { 'forms/1': f, 'pairs/b': pair, pick: null, updated: now });
    const again = await readFresh(api, db, id);
    const back = again.game;
    if (!back || back.pick || back.forms[1] !== f) {
      console.error(`[flick-soccer] VERIFY FAILED: line-up for ${NODE}/games/${id}`);
      return fail('did-not-land', true);
    }
    await writeRows(api, db, back, 'b');
    return { ok: true, game: back };
  } catch (err) {
    console.error('[flick-soccer] could not save the line-up', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * Append this player's flicks (`entries`, stored frame) to the log, starting at `base` (the log
 * length this phone built them on). Idempotent: flicks already there are not written twice, and a
 * log that has moved on differently is a conflict, never overwritten. Rows are rewritten when the
 * turn passes or the match ends. Returns { ok, game } or a failure.
 */
export async function appendLog(id, base, entries) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('appendLog')) return fail('dev-origin-blocked');
  const list = (entries || []).map(cleanEntry);
  if (!list.length || list.some((e) => !e)) return fail('bad-entry');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const { game: fresh, why } = await readFresh(api, db, id);
    if (!fresh) return fail(why);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (list.some((e) => e.by !== side)) return fail('bad-entry');
    const have = fresh.log.length;
    // Already landed (a retry after a verify that timed out): nothing to write.
    const same = (x, y) => x && y && x.by === y.by && x.k === y.k && x.dx === y.dx && x.dy === y.dy && x.p === y.p;
    let skip = 0;
    while (skip < list.length && base + skip < have && same(fresh.log[base + skip], list[skip])) skip++;
    if (base + skip !== have) return fail('moved-on');       // the log is not where we left it
    const todo = list.slice(skip);
    if (!todo.length) {
      // The flicks landed but this phone never heard (the verify, or the index rows after it, did not
      // finish). Write the rows again: the same values, so a row already right is unchanged, and the
      // other person is told even when the first attempt dropped between the log and their row.
      if (!(fresh.over && fresh.over.why === TIMEOUT)) await writeRows(api, db, fresh, side, delivered(fresh, side) ? null : side);   // a derived timeout is never written
      if (fresh.over || fresh.turn !== side) markSeen(id, fresh.updated);
      return { ok: true, game: fresh };
    }
    if (fresh.over) return fail('already-over');   // includes 7 days on a turn (timeout)
    // Nobody answered it for 3 days, so it lapsed (js/challenge-life.js): no flick can revive it.
    if (lifeOf(fresh).expired) return fail('expired');
    // Check the rules accept them before anything is written.
    if (fresh.pick) return fail('not-picked');
    const m = newMatch(fresh.goals, fresh.starter, fresh.forms, fresh.pairs);
    for (const e of fresh.log.concat(todo)) if (!applyEntry(m, e)) return fail('rules-refused');
    const now = Date.now();
    const patch = { updated: now };
    todo.forEach((e, i) => { patch[`log/${String(have + i).padStart(4, '0')}`] = { ...e, at: now }; });
    if (m.winner != null) patch.over = { winner: sideOfSeat(m.winner), why: 'goals', at: now };
    await api.update(api.ref(db, `${NODE}/games/${id}`), patch);
    const back = await readGame(id);
    if (!back || back.log.length !== have + todo.length) {
      console.error(`[flick-soccer] VERIFY FAILED for ${NODE}/games/${id}: expected ${have + todo.length} flicks.`);
      return fail('did-not-land', true);
    }
    back.id = id;
    // Every flick rewrites the rows, so the lists always show the real score (an own goal keeps the
    // turn with the shooter and still changes it). The other person's row is written only once the
    // match is theirs to see; a row whose turn did not move notifies nobody (functions/decide.js).
    await writeRows(api, db, back, side, delivered(back, side) ? null : side);
    // Only a FINISHED turn is "seen" (Darts' lesson, 2026-10-04): the bubble stays while it is yours.
    if (back.over || back.turn !== side) markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[flick-soccer] could not send the flick', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * CALL OFF a challenge its receiver has not answered (2026-10-13, js/challenge-life.js): the sender
 * CANCELS it, the receiver DECLINES it. It counts for nobody, nobody is notified, nothing is deleted:
 * the match keeps its document and its log, and both rows say how it ended. Refused with 'accepted'
 * once the receiver has flicked; from then on the only way out is resignGame.
 * Returns { ok, game, cancelled: true } or a failure.
 */
export async function cancelGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('cancelGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const { game: fresh, why: bad } = await readFresh(api, db, id);
    if (!fresh) return fail(bad);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    let back = fresh;
    if (fresh.over) {
      // Already called off (a retry after the rows did not land): write them again. Any real result
      // stands exactly as it is.
      if (!isCalledOff(fresh)) return fail('already-over');
    } else {
      if (!lifeOf(fresh).open) return fail('accepted');
      const now = Date.now();
      const why = side === recipientOf(fresh) ? 'declined' : 'cancelled';
      await api.update(api.ref(db, `${NODE}/games/${id}`), { over: { winner: 'none', why, at: now }, updated: now });
      back = (await readFresh(api, db, id)).game;
      // validateGame voids a cancel that raced the receiver's first flick: then the match plays on.
      if (!back) return fail('did-not-land', true);
      if (!isCalledOff(back)) return back.over ? fail('already-over') : fail('accepted');
    }
    // A challenge that never reached them (a match from before 2026-10-13, where the maker kicked
    // off) gets no row: they are not told about a match they never saw.
    const r = await api.get(api.ref(db, `${NODE}/index/${back[other(side)].code}/${id}`));
    await writeRows(api, db, back, side, r && r.exists() ? null : side);
    markSeen(id, back.updated);
    return { ok: true, game: back, cancelled: true };
  } catch (err) {
    console.error('[flick-soccer] could not call the challenge off', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** Give the match up: the other person wins, nothing is deleted. A challenge its receiver has not
 *  answered yet is CALLED OFF instead (cancelGame): nobody is handed a win for a match that was never
 *  played. Returns { ok, game, cancelled }. (Before cancelGame existed, the same case wrote a
 *  resignation with both rows marked result 'cancelled'; those rows still read as cancelled.) */
export async function resignGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('resignGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const { game: fresh, why } = await readFresh(api, db, id);
    if (!fresh) return fail(why);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    const mineResign = (g) => g.over && g.over.why === 'resign' && g.over.winner === other(side);
    // Already over. If it was this resignation (a retry after the rows did not land), write the rows
    // again so the other person is told; any other ending is left exactly as it is.
    if (fresh.over && fresh.over.why === TIMEOUT) return fail('already-over');   // timed out: already decided
    if (fresh.over && !mineResign(fresh)) return { ok: true, game: fresh, cancelled: isCalledOff(fresh) };
    if (!fresh.over && lifeOf(fresh).open) return cancelGame(id);
    let back = fresh;
    if (!fresh.over) {
      const now = Date.now();
      await api.update(api.ref(db, `${NODE}/games/${id}`), { over: { winner: other(side), why: 'resign', at: now }, updated: now });
      const again = await readFresh(api, db, id);
      back = again.game;
      if (!back || !back.over) return fail('did-not-land', true);
    }
    const r = await api.get(api.ref(db, `${NODE}/index/${back[other(side)].code}/${id}`));
    const handed = !!(r && r.exists());
    // Nobody has flicked yet (a challenge declined, or called off before it was played): it counts
    // for nobody and is listed for nobody. Both rows are kept, marked 'cancelled'.
    const cancelled = !back.log.length;
    await writeRows(api, db, back, side, handed || cancelled ? null : side);
    if (cancelled) {
      await api.update(api.ref(db, `${NODE}/index/${me}/${id}`), { result: 'cancelled' });
      await api.update(api.ref(db, `${NODE}/index/${back[other(side)].code}/${id}`), { result: 'cancelled' });
    }
    markSeen(id, back.updated);
    return { ok: true, game: back, cancelled };
  } catch (err) {
    console.error('[flick-soccer] could not resign', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

// --- the offline outbox: a flick made with no signal is KEPT and retried, never dropped -----------
export const OUTBOX_KEY = 'gamehub.flicksoccer.outbox.v1';
function readOutbox() {
  try { const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeOutbox(q) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.slice(-40))); } catch (err) { console.error('[flick-soccer] outbox write failed', err); }
}
/** Mirror what this phone still owes the server for one match: replaced whole, removed when empty. */
export function savePending(id, base, entries) {
  const q = readOutbox().filter((x) => x.id !== id);
  if (entries && entries.length) q.push({ id, base, entries: entries.slice() });
  writeOutbox(q);
}
export function pendingFor(id) { const x = readOutbox().find((y) => y.id === id); return x ? x : null; }
export function outboxCount() { return readOutbox().length; }
/** Send everything waiting. A match that can never take them (moved on, over) drops them loudly. */
/** The only refusals that drop a queued flick: the MATCH says no, so no retry will ever land it.
 *  Anything about this phone or the connection (offline, denied, a dev server, no player code yet)
 *  keeps it queued: those can change, and a flick is never thrown away on a maybe. */
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
    else if (NEVER_SENDABLE.includes(res.reason)) { done.add(item.id); console.warn('[flick-soccer] dropping queued flicks that can no longer be sent:', res.reason, item); }
  }
  // Re-read before writing: the open match may have queued more while this ran, and that entry must
  // not be overwritten by the copy read at the start.
  if (done.size) writeOutbox(readOutbox().filter((x) => !done.has(x.id)));
  return sent;
}

// --- history --------------------------------------------------------------------------------------
/** Records per opponent (by CODE), and the finished rows newest first. Pure. */
export function recordsFrom(rows, code) {
  const me = asCode(code);
  // A cancelled, declined or expired challenge was never played: it is in no record (js/challenge-life.js).
  const finished = (Array.isArray(rows) ? rows : []).filter((r) => r && r.over && !r.ended && asCode(r.with) && asCode(r.with) !== me)
    .map((r) => ({ ...r, resigned: r.why === 'resign' ? (r.result === 'won' ? 'them' : 'me') : null, timedOut: r.why === TIMEOUT }))
    .sort((x, y) => ms(y.updated) - ms(x.updated));
  const by = new Map();
  for (const r of finished) {
    let o = by.get(r.with);
    if (!o) { o = { code: r.with, name: r.name, emoji: r.emoji, won: 0, lost: 0, played: 0, last: ms(r.updated) }; by.set(r.with, o); }
    o.played++;
    if (r.result === 'won') o.won++; else if (r.result === 'lost') o.lost++;
  }
  return { opponents: [...by.values()].sort((x, y) => (y.played - x.played) || (y.last - x.last)), finished };
}
