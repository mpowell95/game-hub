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
// first).
//
// SEALED ROUNDS (2026-11-25, every match made from today, `sv: 1`; match.js has the whole story): a phone
// never writes its aims into the public log. They go to `shoveoffSealed/<id>/r<round>/<side>` (readable by
// that side's own code, admins and the reader key only) with a public marker `sealed/r<round>/<side>` in the
// match, in ONE write; the server (functions/shoveoff.js) appends both sides' entries to the log once both
// are sealed. A match without `sv` (made before) keeps the old path, aims straight into the log.
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
import { newMatch, applyAims, RV } from './engine.js';
import { rowEnding, rowOpen, TIMEOUT, forfeitAt, FORFEIT_FROM, rowStale } from '../../js/challenge-life.js';
import { stampFor, clockNow, decideNow, liveTime, noteTimeout, timeoutUnsure, queueConfirm, confirmsSettled } from '../../js/challenge-clock.js';
import { ensureAuthClaim } from '../../js/messages.js';
import * as M from './match.js';
import { ID_RE, SV, ms, other, asCode, asLook, roundKey, winnerOf, replayGame, rvOf, psOf, validateGame, sideOf, recipientOf, hasSent,
  senderPlayed, cancelCosts, isCalledOff, RESULTS, resultOf, modeOfGame, detailOfGame } from './match.js';
// The pure match document lives in match.js (the server runs it too); every name stays importable from here.
export { LOOK_IDS, asLook, asCode, cleanEntry, replay, replayGame, rvOf, psOf, svOf, validateGame, sideOf, recipientOf, hasSent, senderPlayed,
  cancelCosts, isCalledOff, roundStart, RESULTS, resultOf, modeOfGame, detailOfGame, roundKey, SV } from './match.js';

export const NODE = 'shoveoff';
export const GAME = 'shoveoff';        // stats id
export const HUB_ID = 'shove-off';
export const SEALED = 'shoveoffSealed'; // a sealed match's aims until both sides have sent (match.js)
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

// --- the match document: PURE, in match.js (the server runs the same code) --------------------------
/** Your turn = you have not sent this round's aims (both can be true at once). */
export function isMyTurn(game, code) { const s = sideOf(game, code); return !!game && !game.over && !!s && !!game.owes[s]; }
export function themOf(game, code) { const s = sideOf(game, code); return (s === 'a' ? game.b : game.a) || { code: null, name: '', emoji: '🙂' }; }
/** lifeOf on this page's best server clock (match.js lifeOf takes `now`). */
export function lifeOf(game, now = decideNow()) { return M.lifeOf(game, now); }
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
  const m = replayGame(game) || newMatch(rvOf(game) || 1, psOf(game));
  const me = sideOf(game, myCode());
  const who = (p) => ({ name: (p && p.name) || '', emoji: (p && p.emoji) || '', look: (p && p.look) || '' });
  return {
    v: 1, rv: rvOf(game), ...(psOf(game) > 0 ? { ps: psOf(game) } : {}), id: game.id, me, first: recipientOf(game) === 'a' ? 'b' : 'a',
    ...(game.sv ? { sv: game.sv, sealed: game.sealed || null, sealedMine: sealedAimsFor(game, me) } : {}),
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
    if (g) await learnMySealed(boot, g);
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
/** The index row one person gets (match.js rowFor, on this page's clock). */
export function rowFor(game, side, writer, now = decideNow()) { return M.rowFor(game, side, writer, now); }
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
// Online random start spots: OFF until the server (mpowell95/game-hub-server, functions + rules) runs this build's
// match.js. The server settles sealed rounds by replaying the match; an older server would replay a seeded match from
// the fixed spots and its result would disagree with every phone's. Turn on only with the server deployed first.
export const ONLINE_RANDOM_START = true;
/** A start seed for a new match (random start spots, 2026-11-25): a whole number 1..2^32-1. */
export function newStartSeed() {
  let v = 0;
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); v = a[0]; } catch { v = (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0; }
  return v || 1;
}
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
    v: 1, rv: RV, sv: SV, ...(ONLINE_RANDOM_START ? { ps: newStartSeed() } : {}), id, lapse: true, by: me, created: 0, updated: 0,
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
    if (fresh.sv) return await sendSealed(boot, fresh, side, id, r, aims, look);
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
    const test = replayGame(fresh);
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

// --- SEALED ROUNDS (a match with `sv`, 2026-11-25) --------------------------------------------------
// The aims this phone sealed, per match: shown as "Sent" arrows while the round waits (the public match no
// longer holds them), compared on a re-send. A convenience copy: the sealed entry itself is the truth.
const SEALED_KEY = 'gamehub.shoveoff.sealed.v1';
function readSealedMap() { try { const o = JSON.parse(localStorage.getItem(SEALED_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } }
function rememberSealed(id, r, aims) {
  try {
    const map = readSealedMap();
    map[id] = { r, aims };
    const keys = Object.keys(map);
    if (keys.length > 40) delete map[keys[0]];
    localStorage.setItem(SEALED_KEY, JSON.stringify(map));
  } catch (err) { console.warn('[shoveoff] sealed aims not kept on this phone', err); }
}
/** The aims `side` sealed for the round being played, if this phone knows them (its own side only). */
export function sealedAimsFor(game, side) {
  if (!game || !game.sv || !game.sealed || !game.sealed[side] || side !== sideOf(game, myCode())) return null;
  const x = readSealedMap()[game.id];
  return x && x.r === game.round && typeof x.aims === 'string' ? x.aims : null;
}
/** This side's own sealed entry, fresh from the server (the rules let only its own code read it), or null. */
async function readMySealed(boot, id, r, side) {
  try {
    const snap = await boot.api.get(boot.api.ref(boot.db, `${SEALED}/${id}/${roundKey(r)}/${side}`));
    const v = snap && snap.exists() ? snap.val() : null;
    return v && typeof v.aims === 'string' ? v.aims : null;
  } catch (err) { console.warn('[shoveoff] could not re-read this phone\'s sealed aims', err); return null; }
}
/** A sealed round this phone's code sent (maybe from its other phone): fetch its aims once, for the arrows. */
async function learnMySealed(boot, g) {
  try {
    const side = sideOf(g, myCode());
    if (!g.sv || !side || !g.sealed || !g.sealed[side] || sealedAimsFor(g, side)) return;
    const aims = await readMySealed(boot, g.id, g.round, side);
    if (aims) rememberSealed(g.id, g.round, aims);
  } catch { /* the arrows just do not show */ }
}

/** Seal this side's aims for round `r`: the aims into `shoveoffSealed/` (private), a marker into the match, in
 *  ONE write. The server reveals the round once both sides are sealed. Idempotent; a different send for a
 *  round already sealed = 'moved-on'. Rows: this side's own (both on delivery); the server writes both when
 *  the round resolves, and a resolve that beat this write is repaired from a fresh re-read. */
async function sendSealed(boot, fresh, side, id, r, aims, look) {
  const { db, api } = boot;
  const mineThere = fresh.log.find((e) => e.by === side && e.r === r);
  if (mineThere) {
    if (mineThere.aims !== aims) return fail('moved-on');
    await repairRows(api, db, fresh, side);
    return { ok: true, game: fresh };
  }
  if (r === fresh.round && fresh.sealed && fresh.sealed[side]) {
    const have = await readMySealed(boot, id, r, side);
    const local = readSealedMap()[id];
    if (have != null ? have !== aims : (local && local.r === r && local.aims !== aims)) return fail('moved-on');
    rememberSealed(id, r, have != null ? have : aims);
    await repairRows(api, db, fresh, side);
    return { ok: true, game: fresh };
  }
  if (fresh.over) return fail('already-over');
  if (lifeOf(fresh).expired) return fail('expired');
  if (r !== fresh.round) return fail('moved-on');
  const test = replayGame(fresh);
  if (!test || !applyAims(test, side, r, aims)) return fail('rules-refused');
  // The rules let only this side's own code seal it (msgAuth/<uid>); an unclaimed phone is refused (retried).
  try { await ensureAuthClaim(boot); } catch { /* the write says */ }
  const delivered = !fresh.log.length && !hasSent(fresh, 'a') && !hasSent(fresh, 'b');
  const now = stampFor(api);
  const rk = roundKey(r);
  const patch = {};
  patch[`${SEALED}/${id}/${rk}/${side}`] = { aims, at: now, ...(boot.uid ? { u: boot.uid } : {}) };
  patch[`${NODE}/games/${id}/sealed/${rk}/${side}`] = now;
  patch[`${NODE}/games/${id}/updated`] = now;
  if (look && side === recipientOf(fresh) && !hasSent(fresh, side)) patch[`${NODE}/games/${id}/${side}/look`] = asLook(look);
  if (look && side !== recipientOf(fresh) && delivered) patch[`${NODE}/games/${id}/${side}/look`] = asLook(look);
  rememberSealed(id, r, aims);
  await api.update(api.ref(db), patch);
  const back = await readGame(id);
  const landed = !!back && (back.log.some((e) => e.by === side && e.r === r) || (back.round === r && !!back.sealed && !!back.sealed[side]));
  if (!landed) {
    console.error(`[shoveoff] VERIFY FAILED for ${NODE}/games/${id}: round ${r} not sealed for ${side}.`);
    return fail('did-not-land', true);
  }
  const mine = await readMySealed(boot, id, r, side);
  if (mine != null && mine !== aims) {
    console.error(`[shoveoff] ${SEALED}/${id}/${rk}/${side} holds other aims than this phone sent.`);
    return fail('moved-on');
  }
  if (mine == null) console.error(`[shoveoff] VERIFY: ${SEALED}/${id}/${rk}/${side} could not be re-read (its marker landed).`);
  back.id = id;
  await writeRows(api, db, back, side, delivered ? null : side);
  // A resolve that landed while this phone wrote its own row: rewrite the rows from a fresh read.
  const after = (await readGame(id)) || back;
  after.id = id;
  const resolved = after.resolved > fresh.resolved;
  if (resolved) await repairRows(api, db, after, side);
  markSeen(id, after.updated);
  return { ok: true, game: after, resolved };
}

/** Both sides of a round sealed but not revealed after POKE_AFTER: ask the server again (its trigger on
 *  `poke`, functions/shoveoff.js). Never more than once a minute per match from this page. */
const POKE_AFTER = 45000;
const poked = new Map();
export async function pokeIfStuck(game, now = decideNow()) {
  if (!game || !game.sv || !game.resolving || !game.id || !ID_RE.test(game.id)) return false;
  const last = Math.max(ms(game.sealed && game.sealed.a), ms(game.sealed && game.sealed.b));
  if (!last || now - last < POKE_AFTER) return false;
  if (now - (poked.get(game.id) || 0) < 60000) return false;
  if (!allowed('pokeIfStuck')) return false;
  poked.set(game.id, now);
  try {
    const boot = await ready();
    if (!boot) return false;
    const { db, api } = boot;
    await api.update(api.ref(db, `${NODE}/games/${game.id}`), { poke: stampFor(api) });
    const back = await api.get(api.ref(db, `${NODE}/games/${game.id}/poke`));
    if (!back || !back.exists()) { console.error(`[shoveoff] poke VERIFY FAILED for ${game.id}`); return false; }
    return true;
  } catch (err) { console.error('[shoveoff] could not ask the server to reveal the round', err); return false; }
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
