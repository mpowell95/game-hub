// golf/js/mp.js - GOLF CHALLENGES, turn by turn (2026-11-10). Matt: "Make golf multiplayer. Allow me
// to challenge someone to a course and certain number of holes. Turn based multiplayer".
//
// darts/js/mp.js is the model (and Cup Pong's before it); no code is shared with it, only the hub's
// shared modules (challenge-life, challenge-clock, online-gate, live-read, firebase-boot, stats-net,
// game-stats, stats-corrections).
//
// THE LAW applies. Every write is VERIFIED by a fresh re-read, and nothing here ever deletes anything.
//
// THE NODE: `golf/games/<id>` (the match) + `golf/index/<CODE>/<id>` (one row per person) +
// `golf/chat/<id>/<key>` (quick chat, js/match-chat.js, BESIDE the match). Addressed by PLAYER CODE.
//
// THE MATCH: a course id, a round id (golf/js/rounds.js, e.g. 'quick3', 'back9'), and the hole list
// fixed at creation: `holes = [{ i, n, par, pin }]` (`i` the hole's index on the course, `pin` the cup
// chosen for it, -1 when the hole has one cup), so both players play the same cups. Wind is already
// fixed per hole (shot.js windFor). The pars ride on the match so this file needs no course data
// (the launcher's alert check imports it, and the courses are ~60 KB).
//
// ONE HOLE PER TURN: the challenger ('a') plays hole 1, then the other ('b') plays hole 1, then 'a'
// hole 2, and so on. Delivered (the other's index row written) when the challenger's first hole ends.
//
// A MATCH IS A LOG, written as it happens: one entry per SHOT that comes to rest,
// `{ by, h, x, y, s, d?, at }` = who, which hole (index into `holes`), where the ball lies (yards,
// golf/CLAUDE.md "Units and axes"), strokes taken on the hole so far (penalties included), and `d: 1`
// when the hole is finished (holed or picked up at double par plus one; `s` is then the hole's score).
// Closing the app mid-hole resumes at the last rest with its stroke count: a bad shot cannot be
// taken back. `validateGame` replays the log and refuses a malformed document WHOLE.
//
// RESULT: fewest total strokes wins; equal totals are a draw (`over.winner: 'draw', why: 'tie'`).
import { getStatsApp } from '../../js/firebase-boot.js';
import { readPath, watchPath } from '../../js/live-read.js';
import { loadProfile } from '../../js/profile-store.js';
import { readOpponentProfiles } from '../../js/stats-net.js';
import { buildIdentity, canonicalName, isPlaceholderName } from '../../js/players-agg.js';
import { recordResult, noteVoidedResult, withChallengeMatch, mayCountChallenge, countingSince, withMode } from '../../js/game-stats.js';
import { isVoidedMatch, voidedResultFor } from '../../js/stats-corrections.js';
import { onlineGate, codeMayPlayOnline } from '../../js/online-gate.js';
import { automationBlocks } from '../../js/automation.js';
import { isNoResult, rowEnding, rowOpen, expiresAt, TIMEOUT, forfeitAt, turnStartOf, timeoutOver, rowTimeout, callOffCosts, rowStale } from '../../js/challenge-life.js';
import { stampFor, clockNow, decideNow, liveTime, noteTimeout, timeoutUnsure, queueConfirm, confirmsSettled } from '../../js/challenge-clock.js';

const NODE = 'golf';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
const COURSE_RE = /^[a-z0-9]{2,24}$/;
const ROUND_RE = /^[a-z0-9]{2,12}$/;
const MAX_LOG = 2000;                            // a ceiling against a runaway writer, not a rule
const MAX_XY = 5000;                             // yards; a hole's bounds are a few hundred
const ms = (v) => (Number.isFinite(+v) ? +v : 0);
const other = (s) => (s === 'a' ? 'b' : 'a');
/** Double par plus one: the most a hole can cost (golf/js/rounds.js maxStrokes, copied: no import). */
export const capOf = (par) => 2 * par + 1;
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

/** A match id: time-ordered, plus eight random characters. */
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
  console.warn(`[golf] ${what} BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}
// TEST SEAM: tools/test-golf-mp.mjs (and the browser checks) hand in an in-memory database.
let bootFn = getStatsApp;
let devGuard = true;
export function __setBootForTest(fn, { allowDev = false } = {}) { bootFn = fn || getStatsApp; devGuard = !allowDev; }
async function ready() { try { return await bootFn(); } catch { return null; } }
// Test automation never writes (js/automation.js), whatever the dev seam says.
const allowed = (what) => !automationBlocks(`golf ${what}`) && (!devGuard || writesAllowed(what));
function reasonOf(err) {
  const s = String((err && (err.code || err.message)) || err);
  return /permission|PERMISSION_DENIED/i.test(s) ? 'denied' : s;
}
const fail = (reason, retryable = false) => ({ ok: false, reason, retryable });

// --- the hole list ---------------------------------------------------------------------------------
/** The match's holes, cleaned, or null. Firebase may hand an array back as an object keyed 0..n. */
export function cleanHoles(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object'
    ? Object.keys(raw).sort((x, y) => +x - +y).map((k) => raw[k]) : null;
  if (!list || !list.length || list.length > 18) return null;
  const out = [];
  for (const h of list) {
    if (!h || typeof h !== 'object') return null;
    const i = +h.i, n = +h.n, par = +h.par, pin = h.pin == null ? -1 : +h.pin;
    if (!Number.isInteger(i) || i < 0 || i > 17) return null;
    if (!Number.isInteger(n) || n < 1 || n > 18) return null;
    if (!Number.isInteger(par) || par < 3 || par > 5) return null;
    if (!Number.isInteger(pin) || pin < -1 || pin > 9) return null;
    out.push({ i, n, par, pin });
  }
  return out;
}

// --- the log --------------------------------------------------------------------------------------
/** One logged shot, cleaned, or null if it is not well formed. Positions kept to 1/100 yd. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.by !== 'a' && e.by !== 'b') return null;
  const h = +e.h, s = +e.s, x = +e.x, y = +e.y;
  if (!Number.isInteger(h) || h < 0 || h > 17) return null;
  if (!Number.isInteger(s) || s < 1 || s > 11) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_XY || Math.abs(y) > MAX_XY) return null;
  const out = { by: e.by, h, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, s, at: ms(e.at) };
  if (e.d === 1 || e.d === true) out.d = 1;
  return out;
}

/** A fresh replay state: whose turn, which hole, every finished hole's score per side, and where
 *  each side's ball lies on a hole it has not finished. */
export function newPlay() {
  return { side: 'a', h: 0, lastS: 0, sc: { a: [], b: [] }, rest: { a: {}, b: {} } };
}
/** Apply one entry. True, or false when the rules refuse it (out of turn, wrong hole, strokes that
 *  do not go up, a score past the cap): one such entry makes the whole log invalid. */
export function applyEntry(st, holes, e) {
  if (st.h >= holes.length) return false;
  if (e.by !== st.side || e.h !== st.h) return false;
  const cap = capOf(holes[st.h].par);
  if (e.s <= st.lastS) return false;
  if (e.d) {
    if (e.s > cap) return false;
    st.sc[st.side][st.h] = e.s;
    delete st.rest[st.side][st.h];
    if (st.side === 'a') st.side = 'b'; else { st.side = 'a'; st.h += 1; }
    st.lastS = 0;
  } else {
    // A ball at rest has strokes left to play: at the cap the hole ends instead (a done entry).
    if (e.s >= cap) return false;
    st.rest[st.side][st.h] = { x: e.x, y: e.y, s: e.s };
    st.lastS = e.s;
  }
  return true;
}
const sum = (list) => list.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0);

/**
 * WHOLE-DOCUMENT REJECTION: a log with one bad entry would replay differently on the two phones
 * with nothing on screen saying so. The log is REPLAYED, and anything that does not replay, or whose
 * stored result disagrees with the replay, is not a match. Every field added later must be OPTIONAL.
 */
export function validateGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = asCode(raw.a && raw.a.code);
  const b = asCode(raw.b && raw.b.code);
  if (!a || !b || a === b) return null;
  if (!COURSE_RE.test(String(raw.course || '')) || !ROUND_RE.test(String(raw.round || ''))) return null;
  const holes = cleanHoles(raw.holes);
  if (!holes) return null;
  const src = raw.log && typeof raw.log === 'object' ? raw.log : {};
  const keys = Object.keys(src).sort();
  if (keys.length > MAX_LOG) return null;
  const log = [];
  const st = newPlay();
  for (const k of keys) {
    const e = cleanEntry(src[k]);
    if (!e) return null;
    if (!applyEntry(st, holes, e)) return null;
    log.push(e);
  }
  const finished = st.h >= holes.length;
  const totals = { a: sum(st.sc.a), b: sum(st.sc.b) };
  const played = finished ? (totals.a < totals.b ? 'a' : totals.b < totals.a ? 'b' : 'draw') : null;
  let over = null;
  const to = recipientOfRaw(a, b, asCode(raw.by));
  // CALLED OFF before its receiver answered (js/challenge-life.js): counts for nobody, and only
  // while the receiver has played nothing (a cancel that raced their first shot is void).
  const calledOff = !!raw.over && typeof raw.over === 'object' && raw.over.winner === 'none';
  if (calledOff && !isNoResult(String(raw.over.why || ''))) return null;
  if (calledOff && !log.some((e) => e.by === to)) {
    over = { winner: 'none', why: String(raw.over.why), at: ms(raw.over.at) };
  } else if (raw.over && typeof raw.over === 'object' && !calledOff) {
    const w = raw.over.winner;
    if (w !== 'a' && w !== 'b' && w !== 'draw') return null;
    over = { winner: w, why: String(raw.over.why || ''), at: ms(raw.over.at) };
    // A result the log did not produce is only allowed for a resignation (and nobody resigns a draw).
    if (over.why === 'resign' ? w === 'draw' : played !== w) return null;
  } else if (played) {
    over = { winner: played, why: played === 'draw' ? 'tie' : 'strokes', at: ms(raw.updated) };
  }
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  // Strokes and par over the holes BOTH players have finished: the fair comparison mid-match.
  const both = holes.map((_, i) => Number.isFinite(st.sc.a[i]) && Number.isFinite(st.sc.b[i]));
  const done = both.filter(Boolean).length;
  return {
    v: 1, id,
    course: String(raw.course), round: String(raw.round), holes,
    ...(raw.lapse === true ? { lapse: true } : {}),
    by: asCode(raw.by),
    created: ms(raw.created),
    updated: ms(raw.updated),
    a: { code: a, name: String((raw.a && raw.a.name) || ''), emoji: String((raw.a && raw.a.emoji) || '🙂') },
    b: { code: b, name: String((raw.b && raw.b.name) || ''), emoji: String((raw.b && raw.b.emoji) || '🙂') },
    turn: over ? null : st.side,
    hole: Math.min(st.h, holes.length - 1),     // the hole being played (or the last one, once over)
    log,
    over,
    scores: { a: holes.map((_, i) => (Number.isFinite(st.sc.a[i]) ? st.sc.a[i] : null)), b: holes.map((_, i) => (Number.isFinite(st.sc.b[i]) ? st.sc.b[i] : null)) },
    rest: st.rest,
    totals,
    common: { done, a: sum(st.sc.a.filter((_, i) => both[i])), b: sum(st.sc.b.filter((_, i) => both[i])), par: holes.reduce((t, h, i) => t + (both[i] ? h.par : 0), 0) },
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
/** Where `side`'s ball lies on the hole being played: { x, y, s } or null (on the tee). */
export function restOf(game, side) {
  if (!game || game.over || game.turn !== side) return null;
  const r = game.rest && game.rest[side] && game.rest[side][game.hole];
  return r ? { x: r.x, y: r.y, s: r.s } : null;
}
/** Every logged rest of `side` on hole `h` (their ball's resting spots, for the map). */
export function restsOn(game, side, h) {
  return (game && Array.isArray(game.log) ? game.log : []).filter((e) => e.by === side && e.h === h).map((e) => ({ x: e.x, y: e.y }));
}

// --- before the challenge is answered (js/challenge-life.js) -------------------------------------
export function recipientOf(game) { return game ? recipientOfRaw(game.a.code, game.b.code, game.by) : 'b'; }
/** PURE. { open, waiting, expires, expired, turnAt, forfeits }, Darts' rules exactly. */
export function lifeOf(game, now = decideNow()) {
  if (!game || game.over) return { open: false, waiting: false, expires: 0, expired: false, turnAt: 0, forfeits: 0 };
  const to = recipientOf(game);
  const open = !game.log.some((e) => e.by === to);
  const waiting = open && game.turn === to;
  const expires = expiresAt(game.lapse, waiting, game.updated);
  const turnAt = open ? 0 : turnStartOf(game.log, game.turn, game.updated, null, now);
  return { open, waiting, expires, expired: expires > 0 && now >= expires, turnAt, forfeits: open ? 0 : forfeitAt(turnAt) };
}
/** 7 days on one player's turn: they lose, why 'timeout'. Derived on every read, never written. */
export function withTimeout(game, now) {
  if (game && game.id) noteTimeout(NODE, game.id, true);
  if (!game || game.over) return game;
  const c = now == null ? clockNow() : { now, live: true };
  const life = lifeOf(game, c.now);
  const over = timeoutOver({ over: game.over, open: life.open, turn: game.turn, turnAt: life.turnAt, other }, c.now);
  if (over) { game.over = over; game.turn = null; noteTimeout(NODE, game.id, c.live); }
  return game;
}
export function senderPlayed(game) { return !!game && game.log.some((e) => e.by !== recipientOf(game)); }
export function cancelCosts(game) { return callOffCosts(senderPlayed(game)); }
export const isCalledOff = (game) => !!(game && game.over && game.over.winner === 'none');
export function themOf(game, code) { const s = sideOf(game, code); return (s === 'a' ? game.b : game.a) || { code: null, name: '', emoji: '🙂' }; }

// --- results ------------------------------------------------------------------------------------
export const RESULTS = ['won', 'lost', 'draw'];
export function resultOf(game, side) {
  if (!game || !game.over || (side !== 'a' && side !== 'b')) return null;
  if (game.over.winner === 'none') return null;
  if (game.over.winner === 'draw') return 'draw';
  return game.over.winner === side ? 'won' : 'lost';
}

// --- the seen map (the launcher bubble, golf/js/alert.js) -----------------------------------------
export const SEEN_KEY = 'gamehub.golf.seen.v1';
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

// --- counting a finished match exactly once per phone ---------------------------------------------
export const LEDGER_KEY = 'gamehub.golf.counted.v1';
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
/** The mode a finished match is recorded with (root CLAUDE.md, "Every result records its MODE"). */
export function modeOfGame(g, side) {
  return { course: String(g.course || ''), round: String(g.round || ''), holes: Array.isArray(g.holes) ? g.holes.length : (+g.holes || 0), first: side === 'a' ? 'me' : 'them', online: 1 };
}
/** Record a finished match's result on this device, once. `won`: true, false, or null for a draw.
 *  A VOIDED match is never counted. `mode` and `score` are withMode's thunks. */
export function countResult(id, won, finishedAt = Date.now(), mode = null, score = null) {
  if (isVoidedMatch('golf', id)) return false;
  if (timeoutUnsure(NODE, id)) return false;
  if (!mayCountChallenge(LEDGER_KEY, finishedAt)) return false;
  if (!markCounted(id)) return false;
  try { withChallengeMatch('golf', id, () => withMode(mode, 'mp', () => recordResult('golf', 'mp', won == null ? null : !!won), score)); } catch (err) { console.error('[golf] recordResult failed', err); }
  return true;
}
const wonOf = (result) => (result === 'won' ? true : result === 'lost' ? false : null);
export function noteVoided() {
  const me = myCode();
  if (!me) return 0;
  let n = 0;
  for (const id of readLedger()) {
    const res = voidedResultFor('golf', id, me);
    if (res) { try { if (noteVoidedResult('golf', id, res)) n++; } catch (err) { console.error('[golf] noting a voided match failed', err); } }
  }
  return n;
}
/** A row's mode, when the match itself is not to hand. */
const rowMode = (r) => ({ course: String(r.course || ''), round: String(r.round || ''), holes: ms(r.holes), first: r.sent ? 'me' : 'them', online: 1 });
const rowDetail = (r) => ({ strokes: ms(r.mineTotal), them: ms(r.theirsTotal) });
/** Count every finished row not yet counted here, and queue it for the Game Over popup. */
export function recordFinished(rows) {
  countingSince(LEDGER_KEY);
  try { noteVoided(); } catch (err) { console.warn('[golf] noteVoided', err); }
  const ledger = readLedger();
  const fresh = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && RESULTS.includes(r.result) && !ledger.has(r.id) && !isVoidedMatch('golf', r.id));
  queueConfirm(NODE, fresh.filter((r) => r.why === TIMEOUT), readGame, (r, g) => {
    const side = sideOf(g, myCode());
    const res = resultOf(g, side);
    if (!RESULTS.includes(res) || !countResult(g.id || r.id, wonOf(res), g.over.at, () => modeOfGame(g, side), () => ({ detail: () => ({ strokes: g.totals[side], them: g.totals[other(side)] }) }))) return false;
    addUnseen([r.id]);
    return true;
  });
  const todo = fresh.filter((r) => r.why !== TIMEOUT && mayCountChallenge(LEDGER_KEY, r.updated));
  for (const r of todo) countResult(r.id, wonOf(r.result), r.updated, () => rowMode(r), () => ({ detail: () => rowDetail(r) }));
  addUnseen(todo.map((r) => r.id));
  return todo.length;
}
export const timeoutsSettled = () => confirmsSettled(NODE);
export const UNSEEN_KEY = 'gamehub.golf.unseenResults.v1';
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

// --- the round record a finished challenge adds to golf's own stats (once per match per phone) ----
export const ROUND_LEDGER_KEY = 'gamehub.golf.mpRounds.v1';
/** Has this phone already written this match's round into golf's own record? */
export function roundRecorded(id) {
  try { const raw = JSON.parse(localStorage.getItem(ROUND_LEDGER_KEY) || '[]'); return Array.isArray(raw) && raw.includes(id); } catch { return false; }
}
export function markRoundRecorded(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(ROUND_LEDGER_KEY) || '[]');
    const list = Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
    if (!list.includes(id)) list.push(id);
    localStorage.setItem(ROUND_LEDGER_KEY, JSON.stringify(list.slice(-400)));
    return true;
  } catch (err) { console.error('[golf] the challenge round ledger did not save', err); return false; }
}

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
    const late = ended ? null : rowTimeout(r, now);
    return {
      id, with: asCode(r.with), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      updated: late ? late.at : ms(r.updated), yourTurn: !ended && !late && !!r.yourTurn, over: !!r.over || !!ended || !!late,
      result: late ? late.result : !ended && RESULTS.includes(r.result) ? r.result : null,
      why: ended || (late ? TIMEOUT : typeof r.why === 'string' ? r.why : ''),
      ended, open: ended ? '' : rowOpen(r), expires: ms(r.expires), sent: !!r.sent,
      course: COURSE_RE.test(String(r.course || '')) ? String(r.course) : '', round: ROUND_RE.test(String(r.round || '')) ? String(r.round) : '',
      holes: ms(r.holes), hole: ms(r.hole), done: ms(r.done),
      mine: ms(r.mine), theirs: ms(r.theirs), par: ms(r.par), mineTotal: ms(r.mineTotal), theirsTotal: ms(r.theirsTotal),
    };
  }).filter((r) => ID_RE.test(r.id) && r.with && !isVoidedMatch('golf', r.id)));
}
export async function readMyGames() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    return rowsFromIndex(await readPath(boot, `${NODE}/index/${me}`));
  } catch (err) { console.warn('[golf] could not read your matches', err); return []; }
}
/** READ-ONLY live listener on your own index. Returns an unsubscribe that is always safe to call. */
export async function watchMyGames(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = watchPath(boot, `${NODE}/index/${me}`, (v) => {
      try { cb(rowsFromIndex(v)); } catch (err) { console.warn('[golf] list watch', err); }
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
    if (!game) { console.error(`[golf] ${NODE}/games/${id} did not validate; refusing to open it.`); return null; }
    game.id = id;
    return withTimeout(game);
  } catch (err) { console.warn('[golf] could not read that match', err); return null; }
}
/** READ-ONLY live listener on one match: `cb` gets the validated match on every change. */
export async function watchGame(id, cb) {
  if (!ID_RE.test(String(id || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/games/${id}`), (snap) => {
      try { const g = validateGame(snap && snap.exists() ? snap.val() : null); if (g) { g.id = id; cb(withTimeout(g)); } }
      catch (err) { console.warn('[golf] match watch', err); }
    }, () => {});
    return () => { try { stop(); } catch { /* detached */ } };
  } catch { return () => {}; }
}

/** WHO YOU CAN CHALLENGE, one row per PLAYER CODE (Darts' opponentsFrom). */
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
  // Only people who may play online AND can see Golf (js/online-gate.js).
  try { return opponentsFrom(await readOpponentProfiles(), myCode()).filter((r) => codeMayPlayOnline(r.code, 'golf', r.name)); }
  catch (err) { console.warn('[golf] could not read the player list', err); return []; }
}

// --- writing ------------------------------------------------------------------------------------
/** The index row one person gets: what the match looks like from `side`. */
function rowFor(game, side, writer) {
  const them = side === 'a' ? game.b : game.a;
  const life = lifeOf(game);
  const ended = isCalledOff(game) ? game.over.why : '';
  return {
    with: them.code, name: them.name, emoji: them.emoji,
    updated: game.updated,
    yourTurn: !game.over && game.turn === side,
    over: !!game.over && !ended,
    open: life.open ? (side === recipientOf(game) ? 'got' : 'sent') : '',
    expires: life.expires,
    turnAt: life.turnAt,
    ended,
    sent: side !== recipientOf(game),
    pl: senderPlayed(game),
    course: game.course, round: game.round, holes: game.holes.length,
    hole: game.hole + 1, done: game.common.done,
    mine: game.common[side], theirs: game.common[other(side)], par: game.common.par,
    mineTotal: game.totals[side], theirsTotal: game.totals[other(side)],
    lastBy: writer === side ? 'me' : 'them',
    ...(game.over && !ended ? { result: resultOf(game, side), why: String(game.over.why || '') } : {}),
    ...(ended ? { why: ended } : {}),
  };
}
async function writeRows(api, db, game, writer, only = null) {
  if (only !== 'b') await api.update(api.ref(db, `${NODE}/index/${game.a.code}/${game.id}`), rowFor(game, 'a', writer));
  if (only !== 'a') await api.update(api.ref(db, `${NODE}/index/${game.b.code}/${game.id}`), rowFor(game, 'b', writer));
}
async function repairRows(api, db, game, writer) {
  if (!game || (game.over && game.over.why === TIMEOUT)) return;
  for (const s of ['a', 'b']) {
    const ref = api.ref(db, `${NODE}/index/${game[s].code}/${game.id}`);
    const snap = await api.get(ref);
    const cur = snap && snap.exists() ? snap.val() : null;
    if (!cur && s !== writer && !game.over && game.turn === writer && lifeOf(game).open) continue;
    const want = rowFor(game, s, writer);
    if (rowStale(cur, want)) await api.update(ref, want);
  }
}

/**
 * Start a challenge against `them` ({code, name, emoji}) on `course` (id), `round` (id) and `holes`
 * ([{i, n, par, pin}], built by ui.js from the course). The challenger is side 'a' and plays first;
 * only their own row is written here. Returns { ok, id, game } or a failure.
 */
export async function createGame({ them, course, round, holes }) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return fail('no-player-code');
  if (!to || to === me) return fail('bad-opponent');
  const gate = onlineGate();
  if (gate) return fail(gate);
  if (!codeMayPlayOnline(to, 'golf', String(them.name || ''))) return fail('them-not-approved');
  if (!allowed('createGame')) return fail('dev-origin-blocked');
  const hs = cleanHoles(holes);
  if (!COURSE_RE.test(String(course || '')) || !ROUND_RE.test(String(round || '')) || !hs) return fail('bad-round');
  const mine = meLabel();
  const id = mintGameId();
  const doc = {
    v: 1, id, course, round, holes: hs, lapse: true, by: me, created: 0, updated: 0,
    a: { code: me, name: mine.name, emoji: mine.emoji },
    b: { code: to, name: String(them.name || ''), emoji: String(them.emoji || '🙂') },
    log: null, over: null,
  };
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    doc.created = stampFor(api); doc.updated = stampFor(api);   // the SERVER's time
    await api.set(api.ref(db, `${NODE}/games/${id}`), doc);
    const back = await api.get(api.ref(db, `${NODE}/games/${id}`));
    const game = back && back.exists() ? validateGame(back.val()) : null;
    if (!game) { console.error(`[golf] write VERIFY FAILED for ${NODE}/games/${id}`); return fail('did-not-land', true); }
    game.id = id;
    await writeRows(api, db, game, 'a', 'a');
    markSeen(id, game.updated);
    return { ok: true, id, game };
  } catch (err) {
    console.error('[golf] could not start the match', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * Append this player's shots (`entries`) to the log at `base` (the log length this phone built them
 * on). Idempotent: shots already there are not written twice; a log that moved on differently is a
 * conflict, never overwritten. Rows are rewritten when the turn passes or the match ends.
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
    await liveTime(api);
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (list.some((e) => e.by !== side)) return fail('bad-entry');
    const have = fresh.log.length;
    const same = (x, y) => x && y && x.by === y.by && x.h === y.h && x.s === y.s && !!x.d === !!y.d && x.x === y.x && x.y === y.y;
    let skip = 0;
    while (skip < list.length && base + skip < have && same(fresh.log[base + skip], list[skip])) skip++;
    if (base + skip !== have) return fail('moved-on');
    const todo = list.slice(skip);
    const turnBefore = fresh.turn;
    if (!todo.length) { await repairRows(api, db, fresh, side); return { ok: true, game: fresh }; }
    if (fresh.over) return fail('already-over');
    if (lifeOf(fresh).expired) return fail('expired');
    // The rules accept them before anything is written.
    const st = newPlay();
    for (const e of fresh.log.concat(todo)) if (!applyEntry(st, fresh.holes, e)) return fail('rules-refused');
    const now = stampFor(api);
    const patch = { updated: now };
    todo.forEach((e, i) => { patch[`log/${String(have + i).padStart(4, '0')}`] = { ...e, at: now }; });
    if (st.h >= fresh.holes.length) {
      const ta = sum(st.sc.a), tb = sum(st.sc.b);
      const w = ta < tb ? 'a' : tb < ta ? 'b' : 'draw';
      patch.over = { winner: w, why: w === 'draw' ? 'tie' : 'strokes', at: now };
    }
    await api.update(api.ref(db, `${NODE}/games/${id}`), patch);
    const back = await readGame(id);
    if (!back || back.log.length !== have + todo.length) {
      console.error(`[golf] VERIFY FAILED for ${NODE}/games/${id}: expected ${have + todo.length} shots.`);
      return fail('did-not-land', true);
    }
    back.id = id;
    const answered = lifeOf(fresh).open && !lifeOf(back).open;
    if (back.over || back.turn !== turnBefore || have === 0 || answered) await writeRows(api, db, back, side, back.over || back.turn !== side || answered ? null : side);
    // Only a FINISHED turn is "seen": a player who leaves mid-hole still owes the rest of it.
    if (back.over || back.turn !== side) markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[golf] could not send the shot', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** CALL OFF a challenge its receiver has not answered: the sender CANCELS it, the receiver DECLINES
 *  it (js/challenge-life.js). After the sender has played, it is the caller's loss. */
export async function cancelGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('cancelGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    await liveTime(api);
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    let back = fresh;
    let lost = false;
    if (fresh.over) {
      lost = fresh.over.why === 'resign' && fresh.over.winner === other(side);
      if (!isCalledOff(fresh) && !lost) return fail('already-over');
    } else {
      if (!lifeOf(fresh).open) return fail('accepted');
      const now = stampFor(api);
      const why = side === recipientOf(fresh) ? 'declined' : 'cancelled';
      lost = cancelCosts(fresh);
      const over = lost ? { winner: other(side), why: 'resign', via: why, at: now } : { winner: 'none', why, at: now };
      await api.update(api.ref(db, `${NODE}/games/${id}`), { over, updated: now });
      back = await readGame(id);
      if (!back) return fail('did-not-land', true);
      if (lost) { if (!back.over || back.over.why !== 'resign' || back.over.winner !== other(side)) return fail('did-not-land', true); }
      else if (!isCalledOff(back)) return back.over ? fail('already-over') : fail('accepted');
    }
    back.id = id;
    const r = await api.get(api.ref(db, `${NODE}/index/${back[other(side)].code}/${id}`));
    await writeRows(api, db, back, side, lost || (r && r.exists()) ? null : side);
    markSeen(id, back.updated);
    return lost ? { ok: true, game: back, lost: true } : { ok: true, game: back, cancelled: true };
  } catch (err) {
    console.error('[golf] could not call the challenge off', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** Give the match up: the other person wins. An unanswered challenge is CALLED OFF instead. */
export async function resignGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('resignGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    await liveTime(api);
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (fresh.over && fresh.over.why === TIMEOUT) return fail('already-over');
    if (fresh.over) { await repairRows(api, db, fresh, side); return { ok: true, game: fresh, cancelled: isCalledOff(fresh) }; }
    if (lifeOf(fresh).open) return cancelGame(id);
    const now = stampFor(api);
    await api.update(api.ref(db, `${NODE}/games/${id}`), { over: { winner: other(side), why: 'resign', at: now }, updated: now });
    const back = await readGame(id);
    if (!back || !back.over) return fail('did-not-land', true);
    back.id = id;
    const r = await api.get(api.ref(db, `${NODE}/index/${back[other(side)].code}/${id}`));
    await writeRows(api, db, back, side, r && r.exists() ? null : side);
    markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[golf] could not resign', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

// --- the offline outbox: a shot played with no signal is KEPT and retried, never dropped ---------
export const OUTBOX_KEY = 'gamehub.golf.outbox.v1';
function readOutbox() {
  try { const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeOutbox(q) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.slice(-40))); } catch (err) { console.error('[golf] outbox write failed', err); }
}
export function savePending(id, base, entries) {
  const q = readOutbox().filter((x) => x.id !== id);
  if (entries && entries.length) q.push({ id, base, entries: entries.slice() });
  writeOutbox(q);
}
export function pendingFor(id) { const x = readOutbox().find((y) => y.id === id); return x ? x : null; }
export function outboxCount() { return readOutbox().length; }
export async function drainOutbox(onlyId = null) {
  const q = readOutbox();
  if (!q.length) return 0;
  const left = [];
  let sent = 0;
  for (const item of q) {
    if (onlyId && item.id !== onlyId) { left.push(item); continue; }
    const res = await appendLog(item.id, item.base, item.entries);
    if (res.ok) sent++;
    else if (res.retryable) left.push(item);
    else console.warn('[golf] dropping queued shots that can no longer be sent:', res.reason, item);
  }
  writeOutbox(left);
  return sent;
}

// --- a shot IN THE AIR when the app closed (golf/CLAUDE.md, "A shot in the air is saved") ---------
// The solo save keeps the shot's inputs before the ball leaves; a challenge keeps them HERE, never
// in `gamehub.golf.v1` (the solo round's save must not be touched). Cleared when the shot's rest is
// logged. Keyed by match id; `h`/`s` say which hole and stroke it was struck as.
export const SHOT_KEY = 'gamehub.golf.mpShot.v1';
function readShots() {
  try { const m = JSON.parse(localStorage.getItem(SHOT_KEY) || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch { return {}; }
}
export function saveShot(id, rec) {
  try {
    const m = readShots();
    if (rec) m[id] = rec; else delete m[id];
    const keys = Object.keys(m);
    if (keys.length > 20) delete m[keys[0]];
    localStorage.setItem(SHOT_KEY, JSON.stringify(m));
  } catch (err) { console.error('[golf] the challenge shot did not save', err); }
}
export function shotFor(id) { const r = readShots()[id]; return r && typeof r === 'object' ? r : null; }

// --- history --------------------------------------------------------------------------------------
/** Records per opponent (by CODE), and the finished rows newest first. Pure. */
export function recordsFrom(rows, code) {
  const me = asCode(code);
  const finished = (Array.isArray(rows) ? rows : []).filter((r) => r && r.over && !r.ended && asCode(r.with) && asCode(r.with) !== me)
    .map((r) => ({ ...r, resigned: r.why === 'resign' ? (r.result === 'won' ? 'them' : 'me') : null, timedOut: r.why === TIMEOUT }))
    .sort((x, y) => ms(y.updated) - ms(x.updated));
  const by = new Map();
  for (const r of finished) {
    let o = by.get(r.with);
    if (!o) { o = { code: r.with, name: r.name, emoji: r.emoji, won: 0, lost: 0, draw: 0, played: 0, last: ms(r.updated) }; by.set(r.with, o); }
    o.played++;
    if (r.result === 'won') o.won++; else if (r.result === 'lost') o.lost++; else if (r.result === 'draw') o.draw++;
  }
  return { opponents: [...by.values()].sort((x, y) => (y.played - x.played) || (y.last - x.last)), finished };
}
