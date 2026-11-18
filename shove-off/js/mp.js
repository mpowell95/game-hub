// shove-off/js/mp.js - SHOVE OFF CHALLENGES (2026-11-18). Matt: "Online challenges" ONLY (no computer, no
// pass and play, no live room). darts/js/mp.js and golf/js/mp.js are the model; no code is shared with
// them, only the hub's shared modules (challenge-life, challenge-clock, online-gate, live-read,
// firebase-boot, stats-net, game-stats, stats-corrections).
//
// THE LAW applies. A match is not a player's earned history, but every write follows rule 6: VERIFIED
// by a fresh re-read, and nothing here ever deletes anything.
//
// THE NODE: `shoveoff/games/<id>` (the match) + `shoveoff/index/<CODE>/<id>` (one row per person) +
// `shoveoff/chat/<id>` (quick chat, js/match-chat.js). Addressed by PLAYER CODE, never by deviceId.
//
// A MATCH IS A LOG, NEVER A SNAPSHOT. `log` is every side's aims, one entry per side per round:
// { by: 'a'|'b', r: <round>, aims: "dx,dy;dx,dy;-;dx,dy", at }. Both phones REPLAY it through the pure,
// deterministic engine (engine.js), so they always agree where every piece is; a document whose log does
// not replay is refused WHOLE (validateGame).
//
// ROUNDS ARE SIMULTANEOUS: both players aim in secret, then the round plays. "Your turn" = you have not
// sent this round, so BOTH rows can say "your turn" at once (at the start of every round after the
// first). KNOWN LIMIT: the first sender's aims sit in the database until the other sends; the app never
// shows them, but someone with dev tools could read them.
//
// THE CHALLENGE IS DELIVERED WHEN THE CHALLENGER SENDS ROUND 1 (Darts' rule): only then is the other
// person's row written.
import { getStatsApp } from '../../js/firebase-boot.js';
import { readPath, watchPath } from '../../js/live-read.js';
import { loadProfile } from '../../js/profile-store.js';
import { readOpponentProfiles } from '../../js/stats-net.js';
import { buildIdentity, canonicalName, isPlaceholderName } from '../../js/players-agg.js';
import { recordResult, noteVoidedResult, withChallengeMatch, mayCountChallenge, countingSince, withMode, logPlayData } from '../../js/game-stats.js';
import { isVoidedMatch, voidedResultFor } from '../../js/stats-corrections.js';
import { onlineGate, codeMayPlayOnline } from '../../js/online-gate.js';
import { automationBlocks } from '../../js/automation.js';
import { newMatch, applyAims, owes, aliveCount, tally, DRAW } from './engine.js';
import { isNoResult, rowEnding, rowOpen, expiresAt, TIMEOUT, forfeitAt, FORFEIT_FROM, callOffCosts, rowStale } from '../../js/challenge-life.js';
import { stampFor, clockNow, decideNow, liveTime, noteTimeout, timeoutUnsure, queueConfirm, confirmsSettled } from '../../js/challenge-clock.js';

export const NODE = 'shoveoff';
export const GAME = 'shoveoff';        // stats id
export const HUB_ID = 'shove-off';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
const MAX_LOG = 200;                   // 30 rounds + 10 sudden death, two entries each, with room to spare
export const LOOK_IDS = ['sumo0', 'sumo1', 'car0', 'car1', 'puck0', 'puck1'];
export const asLook = (v) => (LOOK_IDS.includes(v) ? v : 'sumo0');
const ms = (v) => (Number.isFinite(+v) ? +v : 0);
const other = (s) => (s === 'a' ? 'b' : 'a');

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
export function mintGameId() {
  const t = Date.now().toString(36);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  try { const buf = new Uint8Array(8); crypto.getRandomValues(buf); for (const b of buf) r += alphabet[b % 36]; }
  catch { for (let i = 0; i < 8; i++) r += alphabet[(Math.random() * 36) | 0]; }
  return t + r;
}

// --- a dev server never writes to the family's database; test automation never writes at all --------
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function isDevOrigin() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { return false; }
}
function writesAllowed(what) {
  if (automationBlocks(`[shoveoff] ${what}`)) return false;
  if (!isDevOrigin()) return true;
  try { if (localStorage.getItem(DEV_SYNC_OK) === '1') return true; } catch { /* fall through */ }
  console.warn(`[shoveoff] ${what} BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}
// TEST SEAM: tools/test-shoveoff-mp.mjs and the browser screenshots hand in an in-memory database.
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

// --- the log --------------------------------------------------------------------------------------
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.by !== 'a' && e.by !== 'b') return null;
  const r = +e.r;
  if (!Number.isInteger(r) || r < 1 || r > 999) return null;
  if (typeof e.aims !== 'string' || e.aims.length > 120) return null;
  return { by: e.by, r, aims: e.aims, at: ms(e.at) };
}

/** Replay a log into an engine match. `upto` entries; `frames` asks the LAST resolved round for its
 *  picture (the UI's animation). Returns the match, or null if an entry does not replay. */
export function replay(log, upto = log.length, framesFor = -1, frames = null) {
  const m = newMatch();
  for (let i = 0; i < upto; i++) {
    const e = log[i];
    if (!applyAims(m, e.by, e.r, e.aims, i === framesFor ? frames : null)) return null;
  }
  return m;
}

/** Who went first: the challenger (`by`) is side 'a' unless a document says otherwise. */
const recipientOfRaw = (aCode, bCode, by) => (by && by === bCode && by !== aCode ? 'a' : 'b');

/**
 * WHOLE-DOCUMENT REJECTION: the log is REPLAYED, and anything that does not replay, or whose stored
 * result disagrees with the replay, is not a match. Every field added later must be OPTIONAL.
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
  const m = newMatch();
  for (const k of keys) {
    const e = cleanEntry(src[k]);
    if (!e) return null;
    if (!applyAims(m, e.by, e.r, e.aims)) return null;
    log.push(e);
  }
  let over = null;
  const to = recipientOfRaw(a, b, asCode(raw.by));
  const calledOff = !!raw.over && typeof raw.over === 'object' && raw.over.winner === 'none';
  if (calledOff && !isNoResult(String(raw.over.why || ''))) return null;
  if (calledOff && !log.some((e) => e.by === to)) {
    over = { winner: 'none', why: String(raw.over.why), at: ms(raw.over.at) };
  } else if (raw.over && typeof raw.over === 'object' && !calledOff) {
    const w = raw.over.winner;
    if (w !== 'a' && w !== 'b' && w !== 'draw') return null;
    over = { winner: w, why: String(raw.over.why || ''), at: ms(raw.over.at), ...(raw.over.via ? { via: String(raw.over.via) } : {}) };
    // A result the log did not produce is only allowed for a resignation (and nobody resigns a draw).
    if (over.why === 'resign' ? w === 'draw' : (m.winner == null || winnerOf(m) !== w)) return null;
  } else if (m.winner != null) {
    over = { winner: winnerOf(m), why: m.end || 'off', at: ms(raw.updated) };
  }
  const look = (s) => asLook(raw[s] && raw[s].look);
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  const ow = over ? { a: false, b: false } : owes(m);
  return {
    v: 1, id,
    ...(raw.lapse === true ? { lapse: true } : {}),
    by: asCode(raw.by),
    created: ms(raw.created),
    updated: ms(raw.updated),
    a: { code: a, name: String((raw.a && raw.a.name) || ''), emoji: String((raw.a && raw.a.emoji) || '🙂'), look: look('a') },
    b: { code: b, name: String((raw.b && raw.b.name) || ''), emoji: String((raw.b && raw.b.emoji) || '🙂'), look: look('b') },
    log, over, owes: ow,
    round: m.round, sd: m.sd, sdr: m.sdr,
    left: { a: aliveCount(m, 'a'), b: aliveCount(m, 'b') },
    resolved: m.rounds.length,
  };
}
const winnerOf = (m) => (m.winner === DRAW ? 'draw' : m.winner);

export function sideOf(game, code) {
  const me = asCode(code);
  if (!game || !me) return null;
  if (game.a.code === me) return 'a';
  if (game.b.code === me) return 'b';
  return null;
}
/** Your turn = you have not sent this round's aims (both can be true at once). */
export function isMyTurn(game, code) { const s = sideOf(game, code); return !!game && !game.over && !!s && !!game.owes[s]; }
export function recipientOf(game) { return game ? recipientOfRaw(game.a.code, game.b.code, game.by) : 'b'; }
export function themOf(game, code) { const s = sideOf(game, code); return (s === 'a' ? game.b : game.a) || { code: null, name: '', emoji: '🙂' }; }
/** Has the challenger played anything yet? From then on a cancel or decline is a loss for whoever does it. */
export function senderPlayed(game) { return !!game && game.log.some((e) => e.by !== recipientOf(game)); }
export function cancelCosts(game) { return callOffCosts(senderPlayed(game)); }
export const isCalledOff = (game) => !!(game && game.over && game.over.winner === 'none');

/** When the current round began: the time of the entry that resolved the previous round, else the
 *  match's creation. Server times (rules refuse any other); clamped so a time in the future cannot
 *  start the clock early. */
export function roundStart(game, cap = 0) {
  let at = ms(game.created);
  // A round is resolved by its second entry; the next round begins then.
  const count = new Map();
  for (const e of game.log) {
    const n = (count.get(e.r) || 0) + 1;
    count.set(e.r, n);
    if (n === 2) at = Math.max(at, ms(e.at));
  }
  return cap > 0 ? Math.min(at, cap) : at;
}

/** PURE. { open, waiting, expires, expired, turnAt, forfeits }. open = not over and the receiver has
 *  sent nothing; waiting = open and delivered (the challenger has sent round 1); expires = when a waiting
 *  challenge lapses (3 days). Answered: whoever still owes the round's aims 7 days after it began loses
 *  (both still owing = a draw by timeout). */
export function lifeOf(game, now = decideNow()) {
  if (!game || game.over) return { open: false, waiting: false, expires: 0, expired: false, turnAt: 0, forfeits: 0 };
  const to = recipientOf(game);
  const open = !game.log.some((e) => e.by === to);
  const waiting = open && game.log.some((e) => e.by !== to);
  const expires = expiresAt(game.lapse, waiting, game.updated);
  const turnAt = open ? 0 : roundStart(game, now);
  return { open, waiting, expires, expired: expires > 0 && now >= expires, turnAt, forfeits: open ? 0 : forfeitAt(turnAt) };
}
/** 7 days on a round = over, derived on every read (nothing written). One side owing: it loses. Both
 *  owing: a draw. Decided on the SERVER's clock; one decided without live server time is never counted. */
export function withTimeout(game, now) {
  if (game && game.id) noteTimeout(NODE, game.id, true);
  if (!game || game.over) return game;
  const c = now == null ? clockNow() : { now, live: true };
  const life = lifeOf(game, c.now);
  if (life.open || !life.turnAt) return game;
  const at = forfeitAt(life.turnAt);
  if (c.now < at) return game;
  const oa = game.owes.a, ob = game.owes.b;
  if (!oa && !ob) return game;
  game.over = { winner: oa && ob ? 'draw' : oa ? 'b' : 'a', why: TIMEOUT, at };
  game.owes = { a: false, b: false };
  noteTimeout(NODE, game.id, c.live);
  return game;
}

export const RESULTS = ['won', 'lost', 'draw'];
export function resultOf(game, side) {
  if (!game || !game.over || (side !== 'a' && side !== 'b')) return null;
  if (game.over.winner === 'none') return null;
  if (game.over.winner === 'draw') return 'draw';
  return game.over.winner === side ? 'won' : 'lost';
}

// --- mode and detail of a finished match, from one side (every result goes through withMode) ------
/** Every option that defines the match: online, both looks, who went first, whether sudden death came. */
export function modeOfGame(game, side) {
  const s = side === 'b' ? 'b' : 'a';
  return { on: 1, look: game[s].look, them: game[other(s)].look, first: recipientOf(game) === s ? 'them' : 'me', sd: game.sd > 0 ? 1 : 0 };
}
/** The match's numbers: rounds played, their pieces knocked off, own pieces lost, sudden-death rounds. */
export function detailOfGame(game, side) {
  const s = side === 'b' ? 'b' : 'a';
  const m = replay(game.log);
  if (!m) return { rounds: 0 };
  const tl = tally(m);
  return { rounds: m.rounds.length, kos: tl[other(s)].lost, lost: tl[s].lost, sdr: m.sdr, end: (game.over && game.over.why) || '' };
}

// --- the seen map (the launcher bubble, alert.js) -------------------------------------------------
export const SEEN_KEY = 'gamehub.shoveoff.seen.v1';
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
    if (keys.length > 200) { const t = {}; for (const k of keys.sort((x, y) => map[y] - map[x]).slice(0, 200)) t[k] = map[k]; map = t; }
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch { /* a bubble shows again: the safe direction */ }
}
export function markSeen(id, updated) {
  if (!id) return;
  const map = readSeen();
  map[id] = Math.max(ms(map[id]), ms(updated) || Date.now());
  writeSeen(map);
}

// --- how many rounds of each match this phone has SHOWN sliding ------------------------------------
const SHOWN_KEY = 'gamehub.shoveoff.shown.v1';
export function readShown(id) { try { return ms((JSON.parse(localStorage.getItem(SHOWN_KEY) || '{}') || {})[id]); } catch { return 0; } }
export function markShown(id, n) {
  try {
    const map = JSON.parse(localStorage.getItem(SHOWN_KEY) || '{}') || {};
    map[id] = Math.max(ms(map[id]), n | 0);
    const keys = Object.keys(map);
    if (keys.length > 200) delete map[keys[0]];
    localStorage.setItem(SHOWN_KEY, JSON.stringify(map));
  } catch { /* the round slides again next time: harmless */ }
}

// --- counting a finished match exactly once per phone ---------------------------------------------
export const LEDGER_KEY = 'gamehub.shoveoff.counted.v1';
export function readLedger() {
  try { const raw = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]'); return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []); }
  catch { return new Set(); }
}
export function markCounted(id) {
  if (!id) return false;
  const set = readLedger();
  if (set.has(id)) return false;
  set.add(id);
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify([...set].slice(-400))); } catch (err) { console.error('[shoveoff] ledger not saved', err); }
  return true;
}
/**
 * Record a finished match's result on this device, once. `mode` / `detail` / `log` are THUNKS (withMode
 * reads them inside its own try). A VOIDED match is never counted. Returns true if it counted now.
 */
export function countResult(id, won, finishedAt = Date.now(), mode = null, detail = null, log = null) {
  if (isVoidedMatch(GAME, id)) return false;
  if (timeoutUnsure(NODE, id)) return false;
  if (!mayCountChallenge(LEDGER_KEY, finishedAt)) return false;
  if (!markCounted(id)) return false;
  try {
    withChallengeMatch(GAME, id, () => withMode(() => (typeof mode === 'function' ? mode() : mode) || { on: 1 }, 'mp',
      () => recordResult(GAME, 'mp', won == null ? null : !!won),
      { detail: () => (typeof detail === 'function' ? detail() : detail), log: () => (typeof log === 'function' ? log() : null) }));
  } catch (err) { console.error('[shoveoff] recordResult failed', err); }
  return true;
}
const wonOf = (result) => (result === 'won' ? true : result === 'lost' ? false : null);
/** Count a finished match this phone holds IN FULL (mode, detail and the private log from the match). */
export function countGame(game) {
  const side = sideOf(game, myCode());
  const res = resultOf(game, side);
  if (!RESULTS.includes(res)) return false;
  const ok = countResult(game.id, wonOf(res), ms(game.over && game.over.at) || ms(game.updated),
    () => modeOfGame(game, side), () => detailOfGame(game, side), () => privateMatch(game));
  if (ok) logMatchOnce(game, null, true);
  return ok;
}
export function noteVoided() {
  const me = myCode();
  if (!me) return 0;
  let n = 0;
  for (const id of readLedger()) {
    const res = voidedResultFor(GAME, id, me);
    if (res) { try { if (noteVoidedResult(GAME, id, res)) n++; } catch (err) { console.error('[shoveoff] noting a voided match failed', err); } }
  }
  return n;
}
/** Count every finished row not yet counted here, and queue it for the Game Over popup. */
export function recordFinished(rows) {
  countingSince(LEDGER_KEY);
  try { noteVoided(); } catch (err) { console.warn('[shoveoff] noteVoided', err); }
  const ledger = readLedger();
  const fresh = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && RESULTS.includes(r.result) && !ledger.has(r.id) && !isVoidedMatch(GAME, r.id));
  queueConfirm(NODE, fresh.filter((r) => r.why === TIMEOUT), readGame, (r, g) => {
    if (!countGame(g)) return false;
    addUnseen([r.id]);
    return true;
  });
  const todo = fresh.filter((r) => r.why !== TIMEOUT && mayCountChallenge(LEDGER_KEY, r.updated));
  for (const r of todo) countResult(r.id, wonOf(r.result), r.updated, () => r.md || { on: 1 }, () => r.dt || null);
  addUnseen(todo.map((r) => r.id));
  logFinishedRows(rows);
  return todo.length;
}

// --- PRIVATE play data (root CLAUDE.md, "EVERYTHING, PRIVATELY") ------------------------------------
// Every finished match this phone sees is logged ONCE per phone to the admin play log: every round's
// aims, the pieces before and after, who fell and how. Names only, never codes.
const MLOG_KEY = 'gamehub.shoveoff.mlogged.v1';
const mlogTried = new Set();
function mlogSeen() { try { const a = JSON.parse(localStorage.getItem(MLOG_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
const r1 = (v) => Math.round(v);
export function privateMatch(game, why = null) {
  const m = replay(game.log) || newMatch();
  const me = sideOf(game, myCode());
  const who = (p) => ({ name: (p && p.name) || '', emoji: (p && p.emoji) || '', look: (p && p.look) || '' });
  return {
    v: 1, id: game.id, me, first: recipientOf(game) === 'a' ? 'b' : 'a',
    a: who(game.a), b: who(game.b), created: game.created || null, updated: game.updated || null,
    over: game.over || (why ? { why } : null), sd: m.sd, sdr: m.sdr, n: game.log.length,
    sent: game.log.map((e) => [e.by, e.r, e.aims, e.at && game.created ? Math.round((e.at - game.created) / 1000) : null]),
    rounds: m.rounds.map((rec) => ({
      r: rec.r, sd: rec.sd, H: r1(rec.H), H1: r1(rec.H1), steps: rec.steps,
      before: rec.before.filter((p) => p.alive).map((p) => `${p.s}${p.i}:${r1(p.x)},${r1(p.y)}`).join(' '),
      after: rec.after.filter((p) => p.alive).map((p) => `${p.s}${p.i}:${r1(p.x)},${r1(p.y)}`).join(' '),
      fell: rec.falls.map((k) => `${rec.before[k].s}${rec.before[k].i}`).join(' '),
      edge: rec.shrinkFalls.map((k) => `${rec.before[k].s}${rec.before[k].i}`).join(' '),
    })),
  };
}
export function logMatchOnce(game, why = null, force = false) {
  try {
    if (!game || !game.id || !(game.over || why)) return false;
    const seen = mlogSeen();
    if (seen.includes(game.id)) return false;
    const side = sideOf(game, myCode());
    // countGame already sent the match through withMode's `log`; only mark it here.
    const id = force ? 'counted' : logPlayData(GAME, 'match', () => privateMatch(game, why), { mode: () => modeOfGame(game, side), diff: 'mp', key: game.id });
    if (!id) return false;
    seen.push(game.id);
    localStorage.setItem(MLOG_KEY, JSON.stringify(seen.slice(-400)));
    return true;
  } catch (err) { console.error('[shoveoff] match not logged privately', err); return false; }
}
export function logFinishedRows(rows) {
  try {
    const seen = new Set(mlogSeen());
    const todo = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && !seen.has(r.id) && !mlogTried.has(r.id)).slice(0, 4);
    for (const r of todo) { mlogTried.add(r.id); readGame(r.id).then((g) => { if (g) logMatchOnce(g, r.ended || r.why || 'over'); }, () => {}); }
  } catch (err) { console.error('[shoveoff] finished matches not logged privately', err); }
}
export const timeoutsSettled = () => confirmsSettled(NODE);
export const UNSEEN_KEY = 'gamehub.shoveoff.unseenResults.v1';
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
/** A row's derived timeout (7 days on a round): both owing = a draw (the shared rowTimeout would call
 *  both rows a loss). */
function rowLate(r, now) {
  if (!r || r.over || (typeof r.ended === 'string' && r.ended)) return null;
  if (!Object.prototype.hasOwnProperty.call(r, 'open') || r.open) return null;
  const at = forfeitAt(ms(r.turnAt) || ms(r.updated));
  if (now < at) return null;
  return { result: r.both ? 'draw' : r.yourTurn ? 'lost' : 'won', at };
}
export function rowsFromIndex(val, now = decideNow()) {
  if (!val || typeof val !== 'object') return [];
  return sortRows(Object.keys(val).map((id) => {
    const r = val[id] || {};
    const ended = rowEnding(r, now);
    const late = ended ? null : rowLate(r, now);
    return {
      id, with: asCode(r.with), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      updated: late ? late.at : ms(r.updated), yourTurn: !ended && !late && !!r.yourTurn, over: !!r.over || !!ended || !!late,
      result: late ? late.result : !ended && RESULTS.includes(r.result) ? r.result : null,
      why: ended || (late ? TIMEOUT : typeof r.why === 'string' ? r.why : ''),
      ended, open: ended ? '' : rowOpen(r), expires: ms(r.expires), sent: !!r.sent,
      mine: ms(r.mine), theirs: ms(r.theirs), rnd: ms(r.rnd) || 1, sd: !!r.sd,
      md: r.md && typeof r.md === 'object' ? r.md : null, dt: r.dt && typeof r.dt === 'object' ? r.dt : null,
    };
  }).filter((r) => ID_RE.test(r.id) && r.with && !isVoidedMatch(GAME, r.id)));
}
export async function readMyGames() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    return rowsFromIndex(await readPath(boot, `${NODE}/index/${me}`));
  } catch (err) { console.warn('[shoveoff] could not read your matches', err); return []; }
}
export async function watchMyGames(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = watchPath(boot, `${NODE}/index/${me}`, (v) => { try { cb(rowsFromIndex(v)); } catch (err) { console.warn('[shoveoff] list watch', err); } }, () => {});
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
    if (!game) { console.error(`[shoveoff] ${NODE}/games/${id} did not validate; refusing to open it.`); return null; }
    game.id = id;
    const g = withTimeout(game);
    if (g && g.over) logMatchOnce(g);
    return g;
  } catch (err) { console.warn('[shoveoff] could not read that match', err); return null; }
}
export async function watchGame(id, cb) {
  if (!ID_RE.test(String(id || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/games/${id}`), (snap) => {
      try { const g = validateGame(snap && snap.exists() ? snap.val() : null); if (g) { g.id = id; const w = withTimeout(g); if (w && w.over) logMatchOnce(w); cb(w); } }
      catch (err) { console.warn('[shoveoff] match watch', err); }
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
  return [...rows.values()].filter((r) => r.code !== mine).map((r) => ({ code: r.code, name: r.name, emoji: r.emoji }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function readOpponents() {
  // Only people who may play online AND can see this game (admin-only: js/online-gate.js).
  try { return opponentsFrom(await readOpponentProfiles(), myCode()).filter((r) => codeMayPlayOnline(r.code, 'shove-off', r.name)); }
  catch (err) { console.warn('[shoveoff] could not read the player list', err); return []; }
}

// --- writing ------------------------------------------------------------------------------------
/** The index row one person gets. `lastBy` says whose write this is from that row's point of view
 *  (what the push function reads). Carries the mode and detail so a count from the list has them. */
export function rowFor(game, side, writer) {
  const them = side === 'a' ? game.b : game.a;
  const life = lifeOf(game);
  const ended = isCalledOff(game) ? game.over.why : '';
  const live = !game.over;
  let md = null, dt = null;
  try { md = modeOfGame(game, side); dt = game.over && !ended ? detailOfGame(game, side) : null; } catch { /* the row still goes */ }
  return {
    with: them.code, name: them.name, emoji: them.emoji,
    updated: game.updated,
    yourTurn: live && !!game.owes[side],
    both: live && !!game.owes.a && !!game.owes.b,
    over: !!game.over && !ended,
    open: life.open ? (side === recipientOf(game) ? 'got' : 'sent') : '',
    expires: life.expires,
    turnAt: life.turnAt,
    ended,
    sent: side !== recipientOf(game),
    pl: senderPlayed(game),
    mine: game.left[side], theirs: game.left[other(side)],
    rnd: game.round, sd: game.sd > 0 ? 1 : 0,
    lastBy: writer === side ? 'me' : 'them',
    ...(md ? { md } : {}), ...(dt ? { dt } : {}),
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
    if (!cur && s !== writer && !game.over && lifeOf(game).open && !lifeOf(game).waiting) continue;
    const want = rowFor(game, s, writer);
    if (rowStale(cur, want)) await api.update(ref, want);
  }
}

/** Start a challenge against `them` ({code, name, emoji}). The challenger is side 'a' and aims first;
 *  only their own row is written (the other person's arrives with round 1's aims). `look` is the
 *  challenger's look; the receiver's is set by their first send. */
export async function createGame({ them, look = 'sumo0' }) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return fail('no-player-code');
  if (!to || to === me) return fail('bad-opponent');
  const gate = onlineGate();
  if (gate) return fail(gate);
  if (!codeMayPlayOnline(to, 'shove-off', String(them.name || ''))) return fail('them-not-approved');
  if (!allowed('createGame')) return fail('dev-origin-blocked');
  const mine = meLabel();
  const id = mintGameId();
  const doc = {
    v: 1, id, lapse: true, by: me, created: 0, updated: 0,
    a: { code: me, name: mine.name, emoji: mine.emoji, look: asLook(look) },
    b: { code: to, name: String(them.name || ''), emoji: String(them.emoji || '🙂'), look: 'sumo0' },
    log: null, over: null,
  };
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    doc.created = stampFor(api); doc.updated = stampFor(api);
    await api.set(api.ref(db, `${NODE}/games/${id}`), doc);
    const back = await api.get(api.ref(db, `${NODE}/games/${id}`));
    const game = back && back.exists() ? validateGame(back.val()) : null;
    if (!game) { console.error(`[shoveoff] write VERIFY FAILED for ${NODE}/games/${id}`); return fail('did-not-land', true); }
    game.id = id;
    await writeRows(api, db, game, 'a', 'a');
    markSeen(id, game.updated);
    return { ok: true, id, game };
  } catch (err) {
    console.error('[shoveoff] could not start the match', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * Send this player's aims for round `r` (a string, engine.js aimsToString), with the look they play in.
 * Idempotent: the same aims already there = ok. A round that moved on = a conflict, never overwritten.
 * Rows: the sender's own row always; both when the round resolved, the match ended, the challenge was
 * delivered (round 1 by the challenger) or answered (the receiver's first send).
 */
export async function sendAims(id, r, aims, look = null) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('sendAims')) return fail('dev-origin-blocked');
  if (typeof aims !== 'string') return fail('bad-entry');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    await liveTime(api);
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    const mineThere = fresh.log.find((e) => e.by === side && e.r === r);
    if (mineThere) {
      if (mineThere.aims !== aims) return fail('moved-on');
      await repairRows(api, db, fresh, side);
      return { ok: true, game: fresh };
    }
    if (fresh.over) return fail('already-over');
    if (lifeOf(fresh).expired) return fail('expired');
    if (r !== fresh.round) return fail('moved-on');
    // The rules must accept it before anything is written.
    const test = replay(fresh.log);
    if (!test || !applyAims(test, side, r, aims)) return fail('rules-refused');
    const lifeBefore = lifeOf(fresh);
    const have = fresh.log.length;
    const now = stampFor(api);
    const patch = { updated: now };
    patch[`log/${String(have).padStart(4, '0')}`] = { by: side, r, aims, at: now };
    if (look && side === recipientOf(fresh) && !fresh.log.some((e) => e.by === side)) patch[`${side}/look`] = asLook(look);
    if (look && side !== recipientOf(fresh) && have === 0) patch[`${side}/look`] = asLook(look);
    if (test.winner != null) patch.over = { winner: winnerOf(test), why: test.end || 'off', at: now };
    await api.update(api.ref(db, `${NODE}/games/${id}`), patch);
    const back = await readGame(id);
    if (!back || back.log.length !== have + 1) {
      console.error(`[shoveoff] VERIFY FAILED for ${NODE}/games/${id}: expected ${have + 1} entries.`);
      return fail('did-not-land', true);
    }
    back.id = id;
    const resolved = back.resolved > fresh.resolved;
    const delivered = have === 0;
    const answered = lifeBefore.open && !lifeOf(back).open;
    await writeRows(api, db, back, side, resolved || back.over || delivered || answered ? null : side);
    markSeen(id, back.updated);
    return { ok: true, game: back, resolved };
  } catch (err) {
    console.error('[shoveoff] could not send the aims', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** CALL OFF a challenge its receiver has not answered: the sender cancels, the receiver declines. Counts
 *  for nobody until the sender has played; after that it is the caller's loss (stored as a resignation,
 *  `via`). Nothing deleted. */
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
    console.error('[shoveoff] could not call the challenge off', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** Give the match up: the other person wins. Unanswered = called off instead (cancelGame). */
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
    console.error('[shoveoff] could not resign', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

// --- the offline outbox: aims sent with no signal are KEPT and retried, never dropped --------------
export const OUTBOX_KEY = 'gamehub.shoveoff.outbox.v1';
function readOutbox() { try { const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; } }
function writeOutbox(q) { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.slice(-40))); } catch (err) { console.error('[shoveoff] outbox write failed', err); } }
export function savePending(id, r, aims, look) {
  const q = readOutbox().filter((x) => x.id !== id);
  if (aims) q.push({ id, r, aims, look });
  writeOutbox(q);
}
export function pendingFor(id) { return readOutbox().find((y) => y.id === id) || null; }
export async function drainOutbox(onlyId = null) {
  const q = readOutbox();
  if (!q.length) return 0;
  const left = [];
  let sent = 0;
  for (const item of q) {
    if (onlyId && item.id !== onlyId) { left.push(item); continue; }
    const res = await sendAims(item.id, item.r, item.aims, item.look);
    if (res.ok) sent++;
    else if (res.retryable) left.push(item);
    else console.warn('[shoveoff] dropping queued aims that can no longer be sent:', res.reason, item);
  }
  writeOutbox(left);
  return sent;
}

/** Records per opponent (by CODE), and the finished rows newest first. Pure. */
export function recordsFrom(rows, code) {
  const me = asCode(code);
  const finished = (Array.isArray(rows) ? rows : []).filter((r) => r && r.over && !r.ended && asCode(r.with) && asCode(r.with) !== me)
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
export { FORFEIT_FROM };
