// cup-pong/js/mp.js - CUP PONG CHALLENGES, turn by turn (2026-09-28). A match two people play hours
// or days apart, like Connect 4 Hoops' (hoops4/js/mp.js is the model; no code is shared with it).
//
// THE LAW applies. A match is not a player's earned history, but the writes still follow rule 6:
// every one is VERIFIED by a fresh re-read, and nothing here ever deletes anything.
//
// THE NODE: `cuppong/games/<id>` (the match) + `cuppong/index/<CODE>/<id>` (one row per person, so
// "what matches do I have" is ONE read). Addressed by PLAYER CODE, never by deviceId: several people
// here have two phones, and a match addressed to a device would be invisible on the other one.
//
// A MATCH IS A LOG, NEVER A SNAPSHOT. `log` is every action in order - each throw's launch vector
// (`p` power, `a` aim) AND its recorded outcome (`m` the cup it went in, `b` bounced), plus the
// options (Gentleman's, a rerack, an island call, an owed cup taken). The position is whatever
// match.js makes of replaying it, so both phones always agree, and a document whose log does not
// replay is refused whole (`validateGame`). The vectors are there so the other phone can SHOW the
// throw; the recorded outcome is what counts, even if a replayed flight lands differently.
//
// WRITTEN AS IT HAPPENS, one throw at a time (`appendLog`), so a turn cannot be lost to a closed app
// and a bad throw cannot be taken back by closing it. The index rows only change when the turn
// passes or the match ends, which is what the push function (functions/index.js) watches.
//
// THE CHALLENGE IS DELIVERED WHEN THE CHALLENGER'S FIRST TURN ENDS (Hoops' lesson, 2026-09-23): the
// challenger shoots first, so the other person's row is written only when the turn is theirs.
//
// NEEDS MATT: `cuppong` is a new top-level node, so it must be in the PUBLISHED rules
// (database.rules.json, pasted by hand). Until then every call fails softly: reads return [] and
// writes return { ok:false, reason:'denied' }.
import { getStatsApp } from '../../js/firebase-boot.js';
import { loadProfile } from '../../js/profile-store.js';
import { readPlayersOnce } from '../../js/stats-net.js';
import { buildIdentity, canonicalName, isPlaceholderName } from '../../js/players-agg.js';
import { recordResult } from '../../js/game-stats.js';
import { Match } from './match.js';

const NODE = 'cuppong';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
const KEY_RE = /^[a-z0-9_-]{1,12}$/i;           // cup ids, preset keys
const MAX_LOG = 3000;                            // a ceiling against a runaway writer, not a rule
export const RERACK_CHOICES = [0, 1, 2, 3, 'inf'];
// A SERIES IS 1, 3 OR 5 GAMES (Matt, 2026-09-30: "challenge someone to a series (same as connect 4
// hoops)"). Hoops' model: each game is its own match, linked by `seriesOf`, with the running score
// carried in `seriesWins` (by SIDE, swapped each game because the sides swap), and the next game
// started by a BUTTON (nextInSeries), never automatically. All the fields are OPTIONAL.
export const SERIES_LENGTHS = [1, 3, 5];
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
  console.warn(`[cup-pong] ${what} BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}
// TEST SEAM: test-cuppong-mp.mjs hands in an in-memory database. The game never calls it.
let bootFn = getStatsApp;
export function __setBootForTest(fn) { bootFn = fn || getStatsApp; }
async function ready() { try { return await bootFn(); } catch { return null; } }
function reasonOf(err) {
  const s = String((err && (err.code || err.message)) || err);
  return /permission|PERMISSION_DENIED/i.test(s) ? 'denied' : s;
}
const fail = (reason, retryable = false) => ({ ok: false, reason, retryable });

// --- the rules of a stored match ----------------------------------------------------------------

/** The rules a challenge was made under, frozen for both players. */
export function cleanRules(r) {
  const rr = RERACK_CHOICES.includes(r && r.rr) ? r.rr : (RERACK_CHOICES.includes(Number(r && r.rr)) ? Number(r.rr) : 2);
  // Bounce shots (brief 5d) were live for challenges for a short while on 2026-09-28, then turned
  // off by Matt. `bo` is only ever read, never written now: a challenge stored with it replays with
  // bounce on (its log may hold the owed cups a bounce made), every other one with it off.
  // Reracks against the back wall (2026-09-29): `bk`. A challenge without it replays with the old
  // placement, so the cups stand where its players saw them.
  // Only the called island counts (2026-10-06): `io`. A challenge without it replays as it was
  // played, where a called ball in another cup still took that cup.
  return { gent: !(r && r.gent === false), rr, bo: !!(r && r.bo === true), bk: !!(r && r.bk === true), lc: !!(r && r.lc === true), fb: !!(r && r.fb === true),
    io: !!(r && r.io === true),
    su: !!(r && r.su === true) };                        // STRAIGHT UP: no assists at all (match.js)
}
const reracksOf = (rules) => (rules.rr === 'inf' ? Infinity : rules.rr);

/** A fresh match under `rules`, in the STORED frame (side 'a' is the challenger and shoots first). */
export function freshMatch(rules) {
  const r = cleanRules(rules);
  return new Match({ first: 'a', gentlemans: r.gent, reracks: reracksOf(r), async: true, bounce: r.bo, backRack: r.bk, lastCupBack: r.lc, fireBallsBack: r.fb, islandOnly: r.io, straight: r.su });
}

/** One log entry, cleaned, or null if it is not a well-formed action. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.by !== 'a' && e.by !== 'b') return null;
  const at = ms(e.at);
  switch (e.k) {
    case 't': {
      const p = +e.p, a = +e.a;
      if (!Number.isFinite(p) || !Number.isFinite(a)) return null;
      const m = e.m ? String(e.m) : '';
      if (m && !KEY_RE.test(m)) return null;
      return { by: e.by, k: 't', p: Math.round(p * 1e5) / 1e5, a: Math.round(a * 1e5) / 1e5, m, b: e.b ? 1 : 0, at };
    }
    case 'g': return { by: e.by, k: 'g', at };
    case 'x': return { by: e.by, k: 'x', at };            // a bonus throw Matt granted (match.grantExtra)
    case 'r': case 'i': case 'o': {
      const v = String(e.k === 'r' ? e.key : e.id || '');
      if (!KEY_RE.test(v)) return null;
      if (e.k === 'r' && v === 'custom') {
        // A custom rerack carries the cells, one per standing cup in id order (match.rerackCustom).
        const src = Array.isArray(e.cells) ? e.cells : (e.cells && typeof e.cells === 'object' ? Object.values(e.cells) : null);
        if (!src || !src.length || src.length > 10) return null;
        const cells = src.map((x) => ({ c: +(x && x.c), r: +(x && x.r) }));
        if (!cells.every((x) => Number.isInteger(x.c) && Number.isInteger(x.r))) return null;
        return { by: e.by, k: 'r', key: v, cells, at };
      }
      return e.k === 'r' ? { by: e.by, k: 'r', key: v, at } : { by: e.by, k: e.k, id: v, at };
    }
    default: return null;
  }
}

/**
 * Apply one action to a match. `by` must be the side whose action it is. Returns the events, or
 * null when the rules refuse it (which makes the whole log invalid).
 */
export function applyEntry(match, e) {
  if (match.over) return null;
  // A granted bonus throw is for a side, not an action on the turn: it may sit anywhere in the log.
  if (e.k === 'x') { const ev = match.grantExtra(e.by); return ev.length ? ev : null; }
  const pre = match.queue.length ? [] : match.startTurn();
  if (e.by !== match.shooter) return null;
  let ev;
  if (e.k === 't') ev = match.throwResult({ made: e.m || null, bounced: !!e.b });
  else if (e.k === 'g') ev = match.applyGentlemans();
  else if (e.k === 'r') ev = e.key === 'custom' ? match.rerackCustom(e.cells) : match.rerack(e.key);
  else if (e.k === 'i') ev = match.callIsland(e.id);
  else if (e.k === 'o') ev = match.pickOwed(e.id);
  if (!ev || !ev.length) return null;
  return pre.concat(ev);
}

/** Turn a stored-frame entry into this phone's frame (me = 'a') and back. */
export const toLocal = (e, mySide) => ({ ...e, by: e.by === mySide ? 'a' : 'b' });
export const toStored = (e, mySide) => ({ ...e, by: e.by === 'a' ? mySide : other(mySide) });

/**
 * Replay the first `upto` entries into a match in THIS PHONE'S frame, where `mySide` is always 'a'
 * (its own red cups, near the camera). A spectator-free rule: only the two players open a match.
 */
export function buildLocal(game, mySide, upto = game.log.length) {
  const r = cleanRules(game.rules);
  const m = new Match({ first: mySide === 'a' ? 'a' : 'b', gentlemans: r.gent, reracks: reracksOf(r), async: true, bounce: r.bo, backRack: r.bk, lastCupBack: r.lc, fireBallsBack: r.fb, islandOnly: r.io, straight: r.su });
  for (let i = 0; i < upto; i++) {
    if (!applyEntry(m, toLocal(game.log[i], mySide))) break;   // validateGame already proved it replays
  }
  return m;
}

/**
 * WHOLE-DOCUMENT REJECTION (Hoops' rule, and js/career-store.js's): a log with one bad entry would
 * replay into a different position on the two phones with nothing on screen saying so. So the log
 * is REPLAYED here, and anything that does not replay, or whose stored turn / result disagrees with
 * the replay, is not a match. Every field added later must be OPTIONAL.
 */
export function validateGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = asCode(raw.a && raw.a.code);
  const b = asCode(raw.b && raw.b.code);
  if (!a || !b || a === b) return null;
  const rules = cleanRules(raw.rules);
  const src = raw.log && typeof raw.log === 'object' ? raw.log : {};
  const keys = Object.keys(src).sort();
  if (keys.length > MAX_LOG) return null;
  const log = [];
  const m = freshMatch(rules);
  for (const k of keys) {
    const e = cleanEntry(src[k]);
    if (!e) return null;
    if (!applyEntry(m, e)) return null;
    log.push(e);
  }
  let over = null;
  if (raw.over && typeof raw.over === 'object') {
    const w = raw.over.winner;
    if (w !== 'a' && w !== 'b') return null;
    over = { winner: w, why: String(raw.over.why || ''), at: ms(raw.over.at) };
    // A result the log did not produce is only allowed for a resignation.
    if (over.why !== 'resign' && (!m.over || m.winner !== w)) return null;
  } else if (m.over) {
    over = { winner: m.winner, why: m.how || 'cups', at: ms(raw.updated) };
  }
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  const series = SERIES_LENGTHS.includes(+raw.series) ? +raw.series : 1;
  const sw = raw.seriesWins && typeof raw.seriesWins === 'object' ? raw.seriesWins : {};
  return {
    series,
    seriesNo: Math.min(series, Math.max(1, ms(raw.seriesNo) || 1)),
    seriesWins: { a: Math.max(0, ms(sw.a) | 0), b: Math.max(0, ms(sw.b) | 0) },
    seriesOf: typeof raw.seriesOf === 'string' && ID_RE.test(raw.seriesOf) ? raw.seriesOf : id,
    v: 1, id,
    by: asCode(raw.by),
    created: ms(raw.created),
    updated: ms(raw.updated),
    rules,
    a: { code: a, name: String((raw.a && raw.a.name) || ''), emoji: String((raw.a && raw.a.emoji) || '🙂') },
    b: { code: b, name: String((raw.b && raw.b.name) || ''), emoji: String((raw.b && raw.b.emoji) || '🙂') },
    turn: over ? null : m.shooter,
    log,
    over,
    phase: m.phase,
    cups: { a: m.racks.a.length, b: m.racks.b.length },
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
export function themOf(game, code) { const s = sideOf(game, code); return (s === 'a' ? game.b : game.a) || { code: null, name: '', emoji: '🙂' }; }

/** Where the opponent's latest run of actions starts: what this phone should SHOW them doing. */
export function lastRunStart(game, theirSide) {
  let i = game.log.length;
  while (i > 0 && game.log[i - 1].by === theirSide) i--;
  return i;
}

// --- results ------------------------------------------------------------------------------------
export const RESULTS = ['won', 'lost'];
export function resultOf(game, side) {
  if (!game || !game.over || (side !== 'a' && side !== 'b')) return null;
  return game.over.winner === side ? 'won' : 'lost';
}

// --- the seen map (the launcher bubble, cup-pong/js/alert.js) -------------------------------------
// This module's own writes stamp it, so only the OTHER person's writes can raise the bubble (Hoops'
// "the challenge that was not a challenge", 2026-09-23). One-tap recreatable: losing it re-shows.
export const SEEN_KEY = 'gamehub.cuppong.seen.v1';
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
    let keys = Object.keys(map);
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

// --- how far into each match this phone has SHOWN the other person's throws ------------------------
const SHOWN_KEY = 'gamehub.cuppong.shown.v1';
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
  } catch { /* shows the throws again next time: harmless */ }
}

// --- counting a finished match exactly once, on BOTH phones (Hoops' ledger, 2026-09-23) -----------
export const LEDGER_KEY = 'gamehub.cuppong.counted.v1';
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
/** Record a finished match's result on this device, once (THE LAW rule 2: never twice). */
export function countResult(id, won) {
  if (!markCounted(id)) return false;
  try { recordResult('cuppong', 'mp', !!won); } catch (err) { console.error('[cup-pong] recordResult failed', err); }
  return true;
}
/** Count every finished row not yet counted here, and queue it for the Game Over popup. */
export function recordFinished(rows) {
  const ledger = readLedger();
  const todo = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && RESULTS.includes(r.result) && !ledger.has(r.id));
  for (const r of todo) countResult(r.id, r.result === 'won');
  addUnseen(todo.map((r) => r.id));
  return todo.length;
}
export const UNSEEN_KEY = 'gamehub.cuppong.unseenResults.v1';
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
function rowsFromIndex(val) {
  if (!val || typeof val !== 'object') return [];
  return sortRows(Object.keys(val).map((id) => {
    const r = val[id] || {};
    return {
      id, with: asCode(r.with), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      updated: ms(r.updated), yourTurn: !!r.yourTurn, over: !!r.over, rebuttal: !!r.rebuttal,
      result: RESULTS.includes(r.result) ? r.result : null, why: typeof r.why === 'string' ? r.why : '',
      mine: ms(r.mine), theirs: ms(r.theirs),
      series: SERIES_LENGTHS.includes(+r.series) ? +r.series : 1, seriesNo: Math.max(1, ms(r.seriesNo) || 1),
      seriesOf: typeof r.seriesOf === 'string' && ID_RE.test(r.seriesOf) ? r.seriesOf : id, su: r.su === true,
    };
  }).filter((r) => ID_RE.test(r.id) && r.with));
}
export async function readMyGames() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    const snap = await boot.api.get(boot.api.ref(boot.db, `${NODE}/index/${me}`));
    return rowsFromIndex(snap && snap.exists() ? snap.val() : null);
  } catch (err) { console.warn('[cup-pong] could not read your matches', err); return []; }
}
/** READ-ONLY live listener on your own index. Returns an unsubscribe that is always safe to call. */
export async function watchMyGames(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/index/${me}`), (snap) => {
      try { cb(rowsFromIndex(snap && snap.exists() ? snap.val() : null)); } catch (err) { console.warn('[cup-pong] list watch', err); }
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
    if (!game) { console.error(`[cup-pong] ${NODE}/games/${id} did not validate; refusing to open it.`); return null; }
    game.id = id;
    return game;
  } catch (err) { console.warn('[cup-pong] could not read that match', err); return null; }
}
/** READ-ONLY live listener on one match: `cb` gets the validated match on every change. */
export async function watchGame(id, cb) {
  if (!ID_RE.test(String(id || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/games/${id}`), (snap) => {
      try { const g = validateGame(snap && snap.exists() ? snap.val() : null); if (g) { g.id = id; cb(g); } }
      catch (err) { console.warn('[cup-pong] match watch', err); }
    }, () => {});
    return () => { try { stop(); } catch { /* detached */ } };
  } catch { return () => {}; }
}

/** WHO YOU CAN CHALLENGE, one row per PLAYER CODE (Hoops' `opponentsFrom`, 2026-09-24, and why). */
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
  try { return opponentsFrom(await readPlayersOnce(), myCode()); }
  catch (err) { console.warn('[cup-pong] could not read the player list', err); return []; }
}

// --- writing ------------------------------------------------------------------------------------

/** The index row one person gets: what the match looks like from `side`. `lastBy` says whose write
 *  this is from that row's point of view, which is what the push function reads. */
function rowFor(game, side, writer) {
  const them = side === 'a' ? game.b : game.a;
  return {
    with: them.code, name: them.name, emoji: them.emoji,
    updated: game.updated,
    yourTurn: !game.over && game.turn === side,
    rebuttal: !game.over && game.turn === side && game.phase === 'rebuttal',
    over: !!game.over,
    mine: game.cups[side], theirs: game.cups[other(side)],
    lastBy: writer === side ? 'me' : 'them',
    series: game.series || 1, seriesNo: game.seriesNo || 1, seriesOf: game.seriesOf || game.id,
    ...(game.rules && game.rules.su ? { su: true } : {}),
    ...(game.over ? { result: resultOf(game, side), why: String(game.over.why || '') } : {}),
  };
}
async function writeRows(api, db, game, writer, only = null) {
  if (only !== 'b') await api.update(api.ref(db, `${NODE}/index/${game.a.code}/${game.id}`), rowFor(game, 'a', writer));
  if (only !== 'a') await api.update(api.ref(db, `${NODE}/index/${game.b.code}/${game.id}`), rowFor(game, 'b', writer));
}

/** How many games one side must win to take a series of `len`. 1 -> 1, 3 -> 2, 5 -> 3. */
export function seriesTarget(len) { return ((SERIES_LENGTHS.includes(+len) ? +len : 1) + 1) / 2; }

/** Where a series stands AFTER this game (pure; Hoops' seriesAfter, which has no draws here). */
export function seriesAfter(game) {
  const len = SERIES_LENGTHS.includes(+(game && game.series)) ? +game.series : 1;
  const before = (game && game.seriesWins) || { a: 0, b: 0 };
  const w = game && game.over ? game.over.winner : null;
  const wins = { a: (before.a | 0) + (w === 'a' ? 1 : 0), b: (before.b | 0) + (w === 'b' ? 1 : 0) };
  const target = seriesTarget(len);
  const champion = wins.a >= target ? 'a' : wins.b >= target ? 'b' : null;
  const no = Math.max(1, (game && game.seriesNo) | 0 || 1);
  const done = !!champion || no >= len;
  return { len, no, wins, target, done, winner: champion || (done && wins.a !== wins.b ? (wins.a > wins.b ? 'a' : 'b') : null) };
}

/** Who starts the next game of a series: whoever LOST this one, so the two phones never both do. */
export function seriesStarter(game) {
  const w = game && game.over && game.over.winner;
  return w === 'a' ? 'b' : 'a';
}

/**
 * Start a challenge against `them` ({code, name, emoji}) under `rules` ({gent, rr, su}). Side 'a'
 * shoots first: normally the challenger, whose own row is the only one written here (the other
 * person's arrives when the first turn passes, appendLog). A series game where the OTHER person
 * shoots first (`first: 'them'`) makes them side 'a' and writes both rows now, since it is already
 * their turn. Returns { ok, id, game } or a failure.
 */
export async function createGame({ them, rules, series = 1, seriesNo = 1, seriesWins = null, seriesOf = null, first = 'me' }) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return fail('no-player-code');
  if (!to || to === me) return fail('bad-opponent');
  if (!writesAllowed('createGame')) return fail('dev-origin-blocked');
  const mine = meLabel();
  const now = Date.now();
  const id = mintGameId();
  const r = cleanRules(rules);
  const doc = {
    v: 1, id, by: me, created: now, updated: now,
    rules: { gent: r.su ? false : r.gent, rr: r.su ? 0 : r.rr, bk: true, lc: true, fb: true, io: true, ...(r.su ? { su: true } : {}) },
    a: { code: me, name: mine.name, emoji: mine.emoji },
    b: { code: to, name: String(them.name || ''), emoji: String(them.emoji || '🙂') },
    log: null, over: null,
  };
  const len = SERIES_LENGTHS.includes(+series) ? +series : 1;
  if (len > 1) {
    doc.series = len;
    doc.seriesNo = Math.min(len, Math.max(1, seriesNo | 0 || 1));
    doc.seriesWins = { a: Math.max(0, (seriesWins && seriesWins.a) | 0), b: Math.max(0, (seriesWins && seriesWins.b) | 0) };
    doc.seriesOf = typeof seriesOf === 'string' && ID_RE.test(seriesOf) ? seriesOf : id;
  }
  const theyFirst = first === 'them';
  if (theyFirst) { const x = doc.a; doc.a = doc.b; doc.b = x; }
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    await api.set(api.ref(db, `${NODE}/games/${id}`), doc);
    const back = await api.get(api.ref(db, `${NODE}/games/${id}`));
    const game = back && back.exists() ? validateGame(back.val()) : null;
    if (!game) { console.error(`[cup-pong] write VERIFY FAILED for ${NODE}/games/${id}`); return fail('did-not-land', true); }
    game.id = id;
    if (theyFirst) await writeRows(api, db, game, 'b');         // their turn already: both rows now
    else await writeRows(api, db, game, 'a', 'a');
    markSeen(id, game.updated);
    return { ok: true, id, game };
  } catch (err) {
    console.error('[cup-pong] could not start the match', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * Append this player's actions (`entries`, in the STORED frame) to the log, starting at `base` (the
 * log length this phone built them on). Idempotent: entries already there are not written twice,
 * and a log that has moved on differently is a conflict, never overwritten. Rows are rewritten when
 * the turn passes or the match ends. Returns { ok, game } or a failure.
 */
export async function appendLog(id, base, entries) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!writesAllowed('appendLog')) return fail('dev-origin-blocked');
  const list = (entries || []).map(cleanEntry);
  if (!list.length || list.some((e) => !e)) return fail('bad-entry');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (list.some((e) => e.by !== side)) return fail('bad-entry');
    const have = fresh.log.length;
    // Already landed (a retry after a verify that timed out): nothing to write.
    const same = (x, y) => x && y && x.k === y.k && x.by === y.by && x.m === y.m && x.key === y.key && x.id === y.id && x.p === y.p && x.a === y.a
      && JSON.stringify(x.cells || null) === JSON.stringify(y.cells || null);
    // The OTHER person's throws after `base` are ones this phone already watched land before taking
    // its own (Matt, 2026-10-02: two cups refused as "moved on" because the base was counted before
    // King of Games' throws arrived). Step past them; the full replay below still has to accept the
    // result, so nothing out of turn can get in this way.
    let start = Math.min(base, have);
    while (start < have && (fresh.log[start].by !== side || fresh.log[start].k === 'x')) start++;
    let skip = 0;
    while (skip < list.length && start + skip < have && same(fresh.log[start + skip], list[skip])) skip++;
    if (skip === list.length) return { ok: true, game: fresh };  // all landed already, whatever came after
    if (start + skip !== have) return fail('moved-on');      // the log is not where we left it
    const todo = list.slice(skip);
    const turnBefore = fresh.turn;
    if (!todo.length) return { ok: true, game: fresh };
    if (fresh.over) return fail('already-over');
    // Check the rules accept them before anything is written.
    const probe = { ...fresh, log: fresh.log.concat(todo) };
    const m = freshMatch(fresh.rules);
    for (const e of probe.log) if (!applyEntry(m, e)) return fail('rules-refused');
    const now = Date.now();
    const patch = { updated: now };
    todo.forEach((e, i) => { patch[`log/${String(have + i).padStart(4, '0')}`] = { ...e, at: now }; });
    if (m.over) patch.over = { winner: m.winner, why: m.how || 'cups', at: now };
    await api.update(api.ref(db, `${NODE}/games/${id}`), patch);
    const back = await readGame(id);
    if (!back || back.log.length !== have + todo.length) {
      console.error(`[cup-pong] VERIFY FAILED for ${NODE}/games/${id}: expected ${have + todo.length} entries.`);
      return fail('did-not-land', true);
    }
    back.id = id;
    if (back.over || back.turn !== turnBefore || have === 0) await writeRows(api, db, back, side, back.over || back.turn !== side ? null : side);
    markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[cup-pong] could not send the throw', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** Give the match up: the other person wins, nothing is deleted. A challenge never delivered (the
 *  other person has no row yet) is not handed to them as a win they never saw. */
/**
 * THE NEXT GAME OF A SERIES, from a finished one (Hoops' nextInSeries). Only whoever lost the last
 * game is offered it (seriesStarter), so the two phones cannot both create it. The sides swap and
 * so does the score, and whoever did NOT shoot first last game shoots first now.
 */
export async function nextInSeries(game) {
  const me = myCode();
  if (!game || !game.over) return fail('not-over');
  const side = sideOf(game, me);
  if (!side) return fail('not-your-game');
  const st = seriesAfter(game);
  if (st.done) return fail('series-over');
  return createGame({
    them: side === 'a' ? game.b : game.a,
    rules: game.rules,
    series: st.len,
    seriesNo: st.no + 1,
    seriesWins: { a: st.wins.b, b: st.wins.a },
    seriesOf: game.seriesOf || game.id,
    first: side === 'a' ? 'them' : 'me',
  });
}

export async function resignGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!writesAllowed('resignGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (fresh.over) return { ok: true, game: fresh };
    const now = Date.now();
    await api.update(api.ref(db, `${NODE}/games/${id}`), { over: { winner: other(side), why: 'resign', at: now }, updated: now });
    const back = await readGame(id);
    if (!back || !back.over) return fail('did-not-land', true);
    back.id = id;
    const r = await api.get(api.ref(db, `${NODE}/index/${back[other(side)].code}/${id}`));
    await writeRows(api, db, back, side, r && r.exists() ? null : side);
    markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[cup-pong] could not resign', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

// --- the offline outbox: a throw taken with no signal is KEPT and retried, never dropped ----------
export const OUTBOX_KEY = 'gamehub.cuppong.outbox.v1';
function readOutbox() {
  try { const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeOutbox(q) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.slice(-40))); } catch (err) { console.error('[cup-pong] outbox write failed', err); }
}
/** Queue entries for a match (they join any already waiting for it, in order). */
export function queueEntries(id, base, entries) {
  const q = readOutbox();
  const cur = q.find((x) => x.id === id);
  if (cur) cur.entries = cur.entries.concat(entries);
  else q.push({ id, base, entries });
  writeOutbox(q);
}
/** Mirror what this phone still owes the server for one match: replaced whole, removed when empty. */
export function savePending(id, base, entries) {
  const q = readOutbox().filter((x) => x.id !== id);
  if (entries && entries.length) q.push({ id, base, entries: entries.slice() });
  writeOutbox(q);
}
export function pendingFor(id) { const x = readOutbox().find((y) => y.id === id); return x ? x : null; }
export function outboxCount() { return readOutbox().length; }
/** Send everything waiting. Only a match that is OVER drops them (loudly); anything else is kept. */
export async function drainOutbox(onlyId = null) {
  const q = readOutbox();
  if (!q.length) return 0;
  const left = [];
  let sent = 0;
  for (const item of q) {
    if (onlyId && item.id !== onlyId) { left.push(item); continue; }
    const res = await appendLog(item.id, item.base, item.entries);
    if (res.ok) sent++;
    else if (res.retryable || res.reason !== 'already-over') { left.push(item); if (!res.retryable) console.error('[cup-pong] queued throws refused, KEPT:', res.reason, item); }
    else console.warn('[cup-pong] dropping queued throws that can no longer be sent:', res.reason, item);
  }
  writeOutbox(left);
  return sent;
}

// --- history --------------------------------------------------------------------------------------
/** Records per opponent (by CODE), and the finished rows newest first. Pure. */
export function recordsFrom(rows, code) {
  const me = asCode(code);
  const finished = (Array.isArray(rows) ? rows : []).filter((r) => r && r.over && asCode(r.with) && asCode(r.with) !== me)
    .map((r) => ({ ...r, resigned: r.why === 'resign' ? (r.result === 'won' ? 'them' : 'me') : null }))
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

export default {
  asCode, myCode, meLabel, validateGame, applyEntry, buildLocal, readMyGames, readGame, watchGame,
  watchMyGames, readOpponents, createGame, appendLog, resignGame, recordsFrom, seriesAfter, seriesStarter, nextInSeries,
};
