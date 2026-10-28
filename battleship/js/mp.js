// battleship/js/mp.js - BATTLESHIP CHALLENGES, turn by turn (2026-10-27). Two people play one match
// hours or days apart. battle-arena/js/mp.js is the model, line for line where it can be; no code is
// shared with it.
//
// Matt (2026-10-27): "Why hasn't battleship been modified to have turn based multiplayer???" Then, on
// how to keep the fleets secret with nobody online to say "hit": "Ships in the match". So BOTH FLEETS
// ARE STORED IN THE MATCH and every phone resolves every shot itself. The screen never draws the other
// fleet before the match is over, but anyone with dev tools could read it: never describe this as
// hidden (the live rooms, js/net.js, still never send a fleet). On shots a turn: "Isn't keep shooting
// on a hit the standard?" So a HIT SHOOTS AGAIN and a miss passes the turn (`bonus: true` on the
// match; a match without it would be one shot a turn, so the rule travels with the match).
// SHOTS A TURN (2026-10-27, Matt: "build the option for multiple shots per turn. 1, 3, or 5. So it
// doesn't take a month", and yes, "hits add a shot"): `shots` on the match, picked by the challenger.
// A turn is that many MISSES; a hit never uses one up. A match without the field is 1 (the first
// matches, made the same day), so nothing already started changes its rule.
// SALVOS (2026-10-27, Matt: "If you're playing with 3 shots, you should choose the 3 spots, they
// shoot at once, then if you hit one, you go again"): a match stored with `salvo: true` (every match
// made from then on) is played in VOLLEYS. The shooter picks N squares (fewer only if fewer are left
// unfired), all N land together, and if ANY of them hit the shooter fires another volley; if all
// miss the turn passes. The log still holds one entry per shot, a volley being N entries in a row;
// the state carries `chVol` (shots still owed in this volley) and `chVHit` (did one hit yet), so a
// log cut mid-volley still replays. A match without the flag keeps the rule above (N misses a turn).
// ONE BONUS SHOT PER HIT (2026-10-28, Matt: "you get ONE bonus shot. Not 3 or 5. You get a single bonus
// shot per hit. Misses get you nothing."): matches made since store `salvo: 2`. A turn opens with a full
// volley of N; after any volley with H hits the shooter fires a volley of H (state `chNext`), and a
// volley with no hit passes the turn. `salvo: true` (rule 1, the first day's matches) keeps "any hit =
// another full volley", so they still replay exactly as played.
export const SALVO_RULES = [1, 2];
/** The salvo rule a stored value means: 0 (not a salvo), 1 (`true`) or 2. */
export const salvoRule = (v) => (v === 2 ? 2 : v === true || v === 1 ? 1 : 0);
//
// THE LAW applies. A match is not a player's earned history, but the writes still follow rule 6:
// every one is VERIFIED by a fresh re-read, and nothing here ever deletes anything.
//
// THE NODE: `battleship/games/<id>` (the match) + `battleship/index/<CODE>/<id>` (one row per person,
// so "what matches do I have" is ONE read) + `battleship/chat/<id>` (js/match-chat.js, BESIDE the
// match). Addressed by PLAYER CODE, never by deviceId.
//
// A MATCH IS TWO FLEETS AND A LOG OF SHOTS, NEVER A SNAPSHOT. The boards, the sunk ships and the
// winner are whatever game.js makes of replaying the log against the fleets, so both phones always
// agree, and a document whose log does not replay is refused whole (`validateGame`).
//
// THE CHALLENGER PLACES THEIR FLEET AND SENDS IT; THE OTHER PERSON PLACES THEIRS WHEN THEY FIRST OPEN
// IT AND SHOOTS FIRST. A shot needs the fleet it lands on, and the receiver's does not exist until
// they open the challenge, so the challenger cannot go first. The challenge is delivered at once (both
// rows are written by createGame) and is OPEN until the receiver's first SHOT (placing is not an
// answer; js/challenge-life.js).
//
// WRITTEN AS IT HAPPENS, one shot at a time (`appendLog`), so a turn cannot be lost to a closed app
// and a miss cannot be taken back by closing it. The index rows only change when the turn passes, the
// challenge is answered, or the match ends: that is what battleshipTurnPush watches.
import { getStatsApp } from '../../js/firebase-boot.js';
import { readPath, watchPath } from '../../js/live-read.js';
import { loadProfile } from '../../js/profile-store.js';
import { readOpponentProfiles } from '../../js/stats-net.js';
import { buildIdentity, canonicalName, isPlaceholderName } from '../../js/players-agg.js';
import { recordBattleship, noteVoidedResult } from '../../js/game-stats.js';
import { isVoidedMatch, voidedResultFor } from '../../js/stats-corrections.js';
import { onlineGate, codeMayPlayOnline } from '../../js/online-gate.js';
import { isNoResult, rowEnding, rowOpen, expiresAt } from '../../js/challenge-life.js';
import { newGame, setFleet, isShotLegal, fireAndResolve, CELL_UNKNOWN, CELL_HIT, CELL_SUNK } from './game.js';
import { shipSetFor, boardSizeFor, emptyFleet, placeShip } from './fleet.js';

export const NODE = 'battleship';
const STATS_ID = 'battleship';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
const MAX_LOG = 210;                             // two full 10x10 boards and change: a ceiling, not a rule
const ms = (v) => (Number.isFinite(+v) ? +v : 0);
const other = (s) => (s === 'a' ? 'b' : 'a');
export const seatOfSide = (s) => (s === 'a' ? 0 : 1);
export const sideOfSeat = (n) => (n === 0 ? 'a' : 'b');
/** Who a match was SENT to: the side that is not its maker (`by`). Always 'b' today. */
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
  console.warn(`[battleship] ${what} BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}
// TEST SEAM: tools/test-battleship-mp.mjs hands in an in-memory database.
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

// --- fleets and shots -----------------------------------------------------------------------------
export const asSize = (v) => (v === 'quick' || v === 'classic' ? v : null);

/** A stored fleet ([{id, r, c, dir}], one per ship of the board's set, each legal, none overlapping)
 *  or null. Accepts an engine fleet too (fleet.js placeShip's ships carry the same four fields). */
export function cleanFleet(raw, size) {
  const sz = asSize(size);
  if (!sz || !raw || typeof raw !== 'object') return null;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.ships) ? raw.ships : Object.values(raw);
  const set = shipSetFor(sz);
  if (list.length !== set.length) return null;
  let fleet = emptyFleet(sz);
  const out = [];
  for (const def of set) {
    const s = list.find((x) => x && x.id === def.id);
    if (!s) return null;
    const r = Number(s.r), c = Number(s.c), dir = s.dir === 'v' ? 'v' : s.dir === 'h' ? 'h' : null;
    if (!Number.isInteger(r) || !Number.isInteger(c) || !dir) return null;
    fleet = placeShip(fleet, def, r, c, dir);
    if (!fleet) return null;
    out.push({ id: def.id, r, c, dir });
  }
  return out;
}
/** The engine's fleet (fleet.js shape, nothing hit yet) for a clean stored fleet. */
export function engineFleet(list, size) {
  const set = shipSetFor(size);
  let fleet = emptyFleet(size);
  for (const s of list || []) {
    const def = set.find((d) => d.id === s.id);
    const next = def && placeShip(fleet, def, s.r, s.c, s.dir);
    if (!next) return null;
    fleet = next;
  }
  return fleet;
}
/** One stored shot: { by: 'a'|'b', r, c }, or null. */
export function cleanShot(e, size = 'classic') {
  if (!e || typeof e !== 'object') return null;
  const by = e.by === 'a' || e.by === 'b' ? e.by : null;
  const n = boardSizeFor(size);
  const r = Number(e.r), c = Number(e.c);
  if (!by || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= n || c >= n) return null;
  return { by, r, c };
}

export const SHOTS = [1, 3, 5];
export const asShots = (v) => (SHOTS.includes(Number(v)) ? Number(v) : null);

/**
 * PURE. One shot by `shooter` (seat) at (r, c), with the turn rule of a match that has `perTurn`
 * shots a turn and hit-shoots-again: the state carries `chLeft`, the misses the shooter still has
 * this turn. Returns { state, answer }. Both the replay and the match screen (ui.js) go through
 * this, so the two can never disagree about whose turn it is.
 */
export function fireShot(state, shooter, r, c, perTurn = 1) {
  const n = asShots(perTurn) || 1;
  const left = state.turn === shooter && Number.isInteger(state.chLeft) ? state.chLeft : n;
  const res = fireAndResolve(state, 1 - shooter, r, c);
  let next = res.state;
  if (!next.over && res.answer.result === 'miss') {
    next = left > 1 ? { ...next, turn: shooter, chLeft: left - 1 } : { ...next, chLeft: n };
  } else if (!next.over) {
    next = { ...next, chLeft: left };
  }
  return { state: next, answer: res.answer };
}

/** PURE. How many squares the next volley at `target` holds: N, or every square left if fewer. */
export function volleySize(state, target, perTurn = 1) {
  const n = Number.isInteger(+perTurn) && +perTurn > 0 ? +perTurn : 1;
  let open = 0;
  for (const v of state.shots[target].cells) if (v === CELL_UNKNOWN) open++;
  return Math.max(1, Math.min(n, open));
}
/** PURE. Shots still owed in the volley `shooter` is firing: the next volley if none is under way (a
 *  bonus volley of one shot per hit under rule 2, else a full N). */
export function volleyLeft(state, shooter, perTurn = 1) {
  if (state.turn === shooter && state.chVol > 0) return state.chVol;
  if (state.turn === shooter && state.chNext > 0) return volleySize(state, 1 - shooter, state.chNext);
  return volleySize(state, 1 - shooter, asShots(perTurn) || 1);
}

/**
 * PURE. One shot of a SALVO match (see the header): the volley is `volleyLeft` shots; any hit in it
 * keeps the turn once it is complete, all misses pass it. The match ends the moment a fleet sinks,
 * so a winning volley stops at the shot that wins it. Returns { state, answer }.
 */
export function fireSalvoShot(state, shooter, r, c, perTurn = 1, rule = 1) {
  const target = 1 - shooter;
  const k = volleyLeft(state, shooter, perTurn);
  const mid = state.turn === shooter && state.chVol > 0;
  const hitsSoFar = mid ? (Number.isInteger(state.chVHits) ? state.chVHits : (state.chVHit ? 1 : 0)) : 0;
  const res = fireAndResolve(state, target, r, c);
  let next = res.state;
  if (!next.over) {
    const hits = hitsSoFar + (res.answer.result === 'hit' ? 1 : 0);
    next = k > 1
      ? { ...next, turn: shooter, chVol: k - 1, chVHit: hits > 0, chVHits: hits, chNext: 0 }
      : { ...next, turn: hits ? shooter : target, chVol: 0, chVHit: false, chVHits: 0, chNext: rule === 2 && hits ? hits : 0 };
  }
  return { state: next, answer: res.answer };
}
/** PURE. A whole volley of `cells` ([[r, c], ...]) in order, stopping at the shot that wins. Returns
 *  { state, answers, fired } (`fired` = the cells actually shot: what goes in the log). */
export function fireVolley(state, shooter, cells, perTurn = 1, rule = 1) {
  let s = state;
  const answers = [], fired = [];
  for (const [r, c] of cells) {
    if (s.over || s.turn !== shooter || !isShotLegal(s, 1 - shooter, r, c)) break;
    const res = fireSalvoShot(s, shooter, r, c, perTurn, rule);
    s = res.state; answers.push(res.answer); fired.push([r, c]);
    if (!s.chVol) break;   // the volley is complete (or the match is over)
  }
  return { state: s, answers, fired };
}

/**
 * PURE. The match after `log` (shots) against the two stored fleets: side a is seat 0, side b seat 1,
 * and B SHOOTS FIRST (see the header). `fleetB` may be null only while the log is empty. Returns
 * { ok, state, shots: [{ seat (the DEFENDER), r, c, result, shipId, sunk, cells }] } or { ok:false }.
 */
export function replay(size, fleetA, fleetB, log, bonus = true, perTurn = 1, salvo = false) {
  const sz = asSize(size);
  const fa = sz && engineFleet(fleetA, sz);
  const fb = sz && (fleetB ? engineFleet(fleetB, sz) : emptyFleet(sz));
  if (!fa || !fb || ((log || []).length && !fleetB)) return { ok: false };
  let s = newGame(boardSizeFor(sz), sz, bonus !== false, 1);
  s = setFleet(setFleet(s, 0, fa), 1, fb);
  const n = bonus !== false ? (asShots(perTurn) || 1) : 1;
  s = { ...s, chLeft: n };
  const shots = [];
  for (const e of log || []) {
    const shooter = seatOfSide(e.by);
    if (s.over || s.turn !== shooter) return { ok: false };
    const target = 1 - shooter;
    if (!isShotLegal(s, target, e.r, e.c)) return { ok: false };
    const res = salvoRule(salvo) && bonus !== false ? fireSalvoShot(s, shooter, e.r, e.c, n, salvoRule(salvo))
      : bonus !== false ? fireShot(s, shooter, e.r, e.c, n) : fireAndResolve(s, target, e.r, e.c);
    s = res.state;
    shots.push({ seat: target, r: e.r, c: e.c, result: res.answer.result, shipId: res.answer.shipId, sunk: res.answer.sunk, cells: res.answer.cells });
  }
  return { ok: true, state: s, shots };
}

/** The engine state after the first `upto` shots. validateGame proved they replay. */
export function buildState(game, upto = game.log.length) {
  return replay(game.size, game.a.fleet, game.b.fleet, game.log.slice(0, upto), game.bonus, game.shots, game.salvo).state;
}
/** Hits landed by `seat` on the other fleet, from the public grid. */
export function hitsBy(state, seat) {
  let n = 0;
  for (const v of state.shots[1 - seat].cells) if (v === CELL_HIT || v === CELL_SUNK) n++;
  return n;
}

/**
 * WHOLE-DOCUMENT REJECTION (Hoops' rule): a log with one bad entry would replay into a different
 * match on the two phones with nothing on screen saying so. So the log is REPLAYED here, and
 * anything that does not replay, or whose stored result disagrees with the replay, is not a match.
 * Every field added later must be OPTIONAL.
 */
export function validateGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = asCode(raw.a && raw.a.code);
  const b = asCode(raw.b && raw.b.code);
  if (!a || !b || a === b) return null;
  const size = asSize(raw.size);
  if (!size) return null;
  const bonus = raw.bonus !== false;
  const shots = raw.shots == null ? 1 : asShots(raw.shots);
  if (!shots) return null;
  const fleetA = cleanFleet(raw.a.fleet, size);
  if (!fleetA) return null;
  const fleetB = raw.b.fleet == null ? null : cleanFleet(raw.b.fleet, size);
  if (raw.b.fleet != null && !fleetB) return null;
  const src = raw.log && typeof raw.log === 'object' ? raw.log : {};
  const keys = Object.keys(src).sort();
  if (keys.length > MAX_LOG) return null;
  const log = [];
  for (const k of keys) {
    const e = cleanShot(src[k], size);
    if (!e) return null;
    log.push(e);
  }
  const salvo = salvoRule(raw.salvo);
  const rep = replay(size, fleetA, fleetB, log, bonus, shots, salvo);
  if (!rep.ok) return null;
  const st = rep.state;
  let over = null;
  const to = recipientOfRaw(a, b, asCode(raw.by));
  // CALLED OFF before its receiver answered (js/challenge-life.js): counts for nobody. Only honoured
  // while the receiver has fired no shot; a cancel that raced their first shot is void.
  const calledOff = !!raw.over && typeof raw.over === 'object' && raw.over.winner === 'none';
  if (calledOff && !isNoResult(String(raw.over.why || ''))) return null;
  if (calledOff && !log.some((e) => e.by === to)) {
    over = { winner: 'none', why: String(raw.over.why), at: ms(raw.over.at) };
  } else if (raw.over && typeof raw.over === 'object' && !calledOff) {
    const w = raw.over.winner;
    if (w !== 'a' && w !== 'b') return null;
    over = { winner: w, why: String(raw.over.why || ''), at: ms(raw.over.at) };
    // A result the log did not produce is only allowed for a resignation.
    if (over.why !== 'resign' && (!st.over || sideOfSeat(st.winner) !== w)) return null;
  } else if (st.over) {
    over = { winner: sideOfSeat(st.winner), why: 'sunk', at: ms(raw.updated) };
  }
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  const who = (x, fleet) => ({ code: asCode(x.code), name: String(x.name || ''), emoji: String(x.emoji || '🙂'), fleet });
  return {
    v: 1, id, size, bonus, shots,
    ...(salvo === 2 ? { salvo: 2 } : salvo ? { salvo: true } : {}),
    ...(raw.lapse === true ? { lapse: true } : {}),
    by: asCode(raw.by),
    created: ms(raw.created),
    updated: ms(raw.updated),
    a: who(raw.a, fleetA),
    b: who(raw.b, fleetB),
    turn: over ? null : sideOfSeat(st.turn),
    log,
    over,
    // Ships each side has sunk (the index rows' `mine` / `theirs`).
    sunk: { a: st.shots[1].sunkIds.length, b: st.shots[0].sunkIds.length },
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
/** Does `side` still have to place its fleet before it can play? */
export function needsFleet(game, side) { return !!game && !game.over && !game[side].fleet; }

// --- before the challenge is answered (js/challenge-life.js) ---------------------------------------
export function recipientOf(game) { return game ? recipientOfRaw(game.a.code, game.b.code, game.by) : 'b'; }
/** PURE. { open, waiting, expires, expired }: open = not over and the receiver has fired no SHOT
 *  (placing a fleet is not an answer); waiting = open and it is the receiver's turn. */
export function lifeOf(game, now = Date.now()) {
  if (!game || game.over) return { open: false, waiting: false, expires: 0, expired: false };
  const to = recipientOf(game);
  const open = !game.log.some((e) => e.by === to);
  const waiting = open && game.turn === to;
  const expires = expiresAt(game.lapse, waiting, game.updated);
  return { open, waiting, expires, expired: expires > 0 && now >= expires };
}
export const isCalledOff = (game) => !!(game && game.over && game.over.winner === 'none');
export function themOf(game, code) { const s = sideOf(game, code); return (s === 'a' ? game.b : game.a) || { code: null, name: '', emoji: '🙂' }; }

/** Where the opponent's latest run of shots starts: what this phone should SHOW them firing. */
export function lastRunStart(game, theirSide) {
  let i = game.log.length;
  while (i > 0 && game.log[i - 1].by === theirSide) i--;
  return i;
}

// --- results ------------------------------------------------------------------------------------
export const RESULTS = ['won', 'lost'];
export function resultOf(game, side) {
  if (!game || !game.over || (side !== 'a' && side !== 'b')) return null;
  if (game.over.winner === 'none') return null;
  return game.over.winner === side ? 'won' : 'lost';
}

// --- the seen map (the launcher bubble, alert.js). One-tap recreatable: losing it re-shows. --------
export const SEEN_KEY = 'gamehub.battleship.seen.v1';
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

// --- how far into each match this phone has SHOWN the other person's shots ------------------------
const SHOWN_KEY = 'gamehub.battleship.shown.v1';
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

// --- counting a finished match exactly once, on BOTH phones ------------------------------------------
export const LEDGER_KEY = 'gamehub.battleship.counted.v1';
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
/** Record a finished match's result on this device, once (THE LAW rule 2). Online results go in the
 *  'mp' bucket, beside the live rooms' (ui.js MP_DIFFICULTY); challenges never write head-to-head
 *  (js/mp-records.js reads them from the index). `extras` are this player's shots / hits / sunk /
 *  accuracy when the match screen saw the end; a result counted from the list alone has none. */
export function countResult(id, won, extras = null) {
  if (isVoidedMatch(STATS_ID, id)) return false;
  if (!markCounted(id)) return false;
  try { recordBattleship('mp', !!won, extras || {}); } catch (err) { console.error('[battleship] recordBattleship failed', err); }
  return true;
}
export function noteVoided() {
  const me = myCode();
  if (!me) return 0;
  let n = 0;
  for (const id of readLedger()) {
    const res = voidedResultFor(STATS_ID, id, me);
    if (res) { try { if (noteVoidedResult(STATS_ID, id, res)) n++; } catch (err) { console.error('[battleship] noting a voided match failed', err); } }
  }
  return n;
}
/** Count every finished row not yet counted here, and queue it for the Game Over popup. */
export function recordFinished(rows) {
  try { noteVoided(); } catch (err) { console.warn('[battleship] noteVoided', err); }
  const ledger = readLedger();
  const todo = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && RESULTS.includes(r.result) && !ledger.has(r.id) && !isVoidedMatch(STATS_ID, r.id));
  for (const r of todo) countResult(r.id, r.result === 'won');
  addUnseen(todo.map((r) => r.id));
  return todo.length;
}
export const UNSEEN_KEY = 'gamehub.battleship.unseenResults.v1';
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
export function rowsFromIndex(val, now = Date.now()) {
  if (!val || typeof val !== 'object') return [];
  return sortRows(Object.keys(val).map((id) => {
    const r = val[id] || {};
    const ended = rowEnding(r, now);
    return {
      id, with: asCode(r.with), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      updated: ms(r.updated), yourTurn: !ended && !!r.yourTurn, over: !!r.over || !!ended,
      result: !ended && RESULTS.includes(r.result) ? r.result : null,
      why: ended || (typeof r.why === 'string' ? r.why : ''),
      ended, open: ended ? '' : rowOpen(r), expires: ms(r.expires), sent: !!r.sent,
      mine: ms(r.mine), theirs: ms(r.theirs),
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
  } catch (err) { console.warn('[battleship] could not read your matches', err); return []; }
}
/** READ-ONLY live listener on your own index. Returns an unsubscribe that is always safe to call. */
export async function watchMyGames(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = watchPath(boot, `${NODE}/index/${me}`, (v) => {
      try { cb(rowsFromIndex(v)); } catch (err) { console.warn('[battleship] list watch', err); }
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
    if (!game) { console.error(`[battleship] ${NODE}/games/${id} did not validate; refusing to open it.`); return null; }
    game.id = id;
    return game;
  } catch (err) { console.warn('[battleship] could not read that match', err); return null; }
}
/** READ-ONLY live listener on one match: `cb` gets the validated match on every change. */
export async function watchGame(id, cb) {
  if (!ID_RE.test(String(id || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/games/${id}`), (snap) => {
      try { const g = validateGame(snap && snap.exists() ? snap.val() : null); if (g) { g.id = id; cb(g); } }
      catch (err) { console.warn('[battleship] match watch', err); }
    }, () => {});
    return () => { try { stop(); } catch { /* detached */ } };
  } catch { return () => {}; }
}

/** WHO YOU CAN CHALLENGE, one row per PLAYER CODE (Hoops' `opponentsFrom`, and why). */
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
/** The pick-a-person list: the small server-built directory (stats-net.js readOpponentProfiles),
 *  never all of players/. Only people who may play online (js/online-gate.js). */
export async function readOpponents() {
  try { return opponentsFrom(await readOpponentProfiles(), myCode()).filter((r) => codeMayPlayOnline(r.code, 'battleship', r.name)); }
  catch (err) { console.warn('[battleship] could not read the player list', err); return []; }
}

// --- writing ------------------------------------------------------------------------------------
/** The index row one person gets: what the match looks like from `side`. `lastBy` says whose write
 *  this is from that row's point of view, which is what the push function reads. */
function rowFor(game, side, writer) {
  const them = side === 'a' ? game.b : game.a;
  const life = lifeOf(game);
  // A called-off match is stored over:false / yourTurn:false with `ended` saying why, so the push
  // function sends nothing for it (js/challenge-life.js). Every reader turns it back into a finished row.
  const ended = isCalledOff(game) ? game.over.why : '';
  return {
    with: them.code, name: them.name, emoji: them.emoji,
    updated: game.updated,
    yourTurn: !game.over && game.turn === side,
    over: !!game.over && !ended,
    open: life.open ? (side === recipientOf(game) ? 'got' : 'sent') : '',
    expires: life.expires,
    ended,
    sent: side !== recipientOf(game),
    mine: game.sunk[side], theirs: game.sunk[other(side)],
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
 * Start a challenge against `them` ({code, name, emoji}) with this player's placed `fleet` on a
 * `size` board. The challenger is side 'a'; the other person places theirs and shoots first, so BOTH
 * rows are written here (the challenge reaches them at once). Returns { ok, id, game } or a failure.
 */
export async function createGame({ them, fleet, size = 'classic', shots = 1 }) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return fail('no-player-code');
  if (!to || to === me) return fail('bad-opponent');
  // Both people must be allowed online (js/online-gate.js).
  const gate = onlineGate();
  if (gate) return fail(gate);
  if (!codeMayPlayOnline(to, 'battleship', String(them.name || ''))) return fail('them-not-approved');
  if (!allowed('createGame')) return fail('dev-origin-blocked');
  const sz = asSize(size);
  const mine = sz && cleanFleet(fleet, sz);
  if (!mine) return fail('bad-fleet');
  const perTurn = asShots(shots);
  if (!perTurn) return fail('bad-shots');
  const label = meLabel();
  const now = Date.now();
  const id = mintGameId();
  const doc = {
    v: 1, id, size: sz, bonus: true, shots: perTurn, salvo: 2, lapse: true, by: me, created: now, updated: now,
    a: { code: me, name: label.name, emoji: label.emoji, fleet: mine },
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
    if (!game) { console.error(`[battleship] write VERIFY FAILED for ${NODE}/games/${id}`); return fail('did-not-land', true); }
    game.id = id;
    await writeRows(api, db, game, 'a');
    markSeen(id, game.updated);
    return { ok: true, id, game };
  } catch (err) {
    console.error('[battleship] could not start the match', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * The other person places their fleet the first time they open the challenge. Written once; the same
 * fleet again is a no-op, a different one is refused. It does not answer the challenge (only a shot
 * does) and does not move `updated` (so the 3-day clock and the launcher bubble are untouched).
 * Returns { ok, game } or a failure.
 */
export async function placeFleet(id, fleet) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('placeFleet')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    const f = cleanFleet(fleet, fresh.size);
    if (!f) return fail('bad-fleet');
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    if (fresh[side].fleet) return same(fresh[side].fleet, f) ? { ok: true, game: fresh } : fail('already-placed');
    if (fresh.over) return fail('already-over');
    if (lifeOf(fresh).expired) return fail('expired');
    await api.set(api.ref(db, `${NODE}/games/${id}/${side}/fleet`), f);
    const back = await readGame(id);
    if (!back || !back[side].fleet || !same(back[side].fleet, f)) {
      console.error(`[battleship] VERIFY FAILED for ${NODE}/games/${id}/${side}/fleet`);
      return fail('did-not-land', true);
    }
    back.id = id;
    return { ok: true, game: back };
  } catch (err) {
    console.error('[battleship] could not save the fleet', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * Append this player's shots (`entries`) to the log, starting at `base` (the log length this phone
 * fired them on). Idempotent: shots already there are not written twice, and a log that has moved on
 * differently is a conflict, never overwritten. Rows are rewritten when the turn passes, the
 * challenge is answered or the match ends. Returns { ok, game } or a failure.
 */
export async function appendLog(id, base, entries) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('appendLog')) return fail('dev-origin-blocked');
  const raw = Array.isArray(entries) ? entries : [];
  if (!raw.length) return fail('bad-entry');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const list = raw.map((e) => cleanShot(e, fresh.size));
    if (list.some((e) => !e)) return fail('bad-entry');
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (list.some((e) => e.by !== side)) return fail('bad-entry');
    if (!fresh[side].fleet) return fail('no-fleet');
    const have = fresh.log.length;
    const same = (x, y) => x && y && x.by === y.by && x.r === y.r && x.c === y.c;
    let skip = 0;
    while (skip < list.length && base + skip < have && same(fresh.log[base + skip], list[skip])) skip++;
    if (base + skip !== have) return fail('moved-on');
    const todo = list.slice(skip);
    const turnBefore = fresh.turn;
    if (!todo.length) return { ok: true, game: fresh };
    if (fresh.over) return fail('already-over');
    // Nobody answered it for 3 days, so it lapsed (js/challenge-life.js): no shot can revive it.
    if (lifeOf(fresh).expired) return fail('expired');
    const rep = replay(fresh.size, fresh.a.fleet, fresh.b.fleet, fresh.log.concat(todo), fresh.bonus, fresh.shots, fresh.salvo);
    if (!rep.ok) return fail('rules-refused');
    const now = Date.now();
    const patch = { updated: now };
    todo.forEach((e, i) => { patch[`log/${String(have + i).padStart(4, '0')}`] = { ...e, at: now }; });
    if (rep.state.over) patch.over = { winner: sideOfSeat(rep.state.winner), why: 'sunk', at: now };
    await api.update(api.ref(db, `${NODE}/games/${id}`), patch);
    const back = await readGame(id);
    if (!back || back.log.length !== have + todo.length) {
      console.error(`[battleship] VERIFY FAILED for ${NODE}/games/${id}: expected ${have + todo.length} shots.`);
      return fail('did-not-land', true);
    }
    back.id = id;
    const answered = lifeOf(fresh).open && !lifeOf(back).open;
    if (back.over || back.turn !== turnBefore || answered) await writeRows(api, db, back, side);
    // Only a FINISHED turn is "seen": a player who hits once and leaves still owes the rest.
    if (back.over || back.turn !== side) markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[battleship] could not send the shot', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** CALL OFF a challenge its receiver has not answered: the sender CANCELS, the receiver DECLINES.
 *  Counts for nobody, nobody is notified, nothing is deleted. 'accepted' once the receiver has shot. */
export async function cancelGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('cancelGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    let back = fresh;
    if (fresh.over) {
      if (!isCalledOff(fresh)) return fail('already-over');
    } else {
      if (!lifeOf(fresh).open) return fail('accepted');
      const now = Date.now();
      const why = side === recipientOf(fresh) ? 'declined' : 'cancelled';
      await api.update(api.ref(db, `${NODE}/games/${id}`), { over: { winner: 'none', why, at: now }, updated: now });
      back = await readGame(id);
      if (!back) return fail('did-not-land', true);
      if (!isCalledOff(back)) return back.over ? fail('already-over') : fail('accepted');
    }
    back.id = id;
    await writeRows(api, db, back, side);
    markSeen(id, back.updated);
    return { ok: true, game: back, cancelled: true };
  } catch (err) {
    console.error('[battleship] could not call the challenge off', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** Give the match up: the other person wins, nothing is deleted. An unanswered challenge is CALLED
 *  OFF instead (cancelGame), and the result says { cancelled: true }. */
export async function resignGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('resignGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (fresh.over) return { ok: true, game: fresh, cancelled: isCalledOff(fresh) };
    if (lifeOf(fresh).open) return cancelGame(id);
    const now = Date.now();
    await api.update(api.ref(db, `${NODE}/games/${id}`), { over: { winner: other(side), why: 'resign', at: now }, updated: now });
    const back = await readGame(id);
    if (!back || !back.over) return fail('did-not-land', true);
    back.id = id;
    await writeRows(api, db, back, side);
    markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[battleship] could not resign', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

// --- the offline outbox: a shot fired with no signal is KEPT and retried, never dropped -------------
export const OUTBOX_KEY = 'gamehub.battleship.outbox.v1';
function readOutbox() {
  try { const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeOutbox(q) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.slice(-40))); } catch (err) { console.error('[battleship] outbox write failed', err); }
}
/** Mirror what this phone still owes the server for one match: replaced whole, removed when empty. */
export function savePending(id, base, entries) {
  const q = readOutbox().filter((x) => x.id !== id);
  if (entries && entries.length) q.push({ id, base, entries: entries.slice() });
  writeOutbox(q);
}
export function pendingFor(id) { const x = readOutbox().find((y) => y.id === id); return x || null; }
export function outboxCount() { return readOutbox().length; }
/** Send everything waiting. A match that can never take them (moved on, over) drops them loudly. */
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
    else console.warn('[battleship] dropping queued shots that can no longer be sent:', res.reason, item);
  }
  writeOutbox(left);
  return sent;
}
