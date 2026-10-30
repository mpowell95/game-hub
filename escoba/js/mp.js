// escoba/js/mp.js - ESCOBA CHALLENGES, turn by turn (2026-10-18). Matt: "You should be able to
// challenge someone to turn by turn games in all multiplayer games too." Two people, hours or days
// apart. darts/js/mp.js is the model (structure, not code: nothing is shared with it).
//
// THE LAW applies. A match is not a player's earned history, but the writes still follow rule 6:
// every one is VERIFIED by a fresh re-read, and nothing here ever deletes anything.
//
// THE NODE: `escoba/games/<id>` (the match) + `escoba/index/<CODE>/<id>` (one row per person, so
// "what matches do I have" is ONE read) + `escoba/chat/<id>` (js/match-chat.js, BESIDE the match,
// never inside it). Addressed by PLAYER CODE, never by deviceId (people here have two phones).
// Nothing here touches `rooms/` or js/net.js: live rooms are a separate thing and stay as they were.
//
// A MATCH IS A LOG, NEVER A SNAPSHOT. The document holds the config the SENDER chose (`len`: '1' one
// hand, '11' / '21' first to that many; `deck`: 'spanish' | 'american'), a random `seed`, and `log`:
// every play in order as { by, c (the hand card), k (the table cards it took, sorted, comma-joined) }.
// Each round's deck order is DERIVED from the seed (`deckIds`), so both phones deal the same cards
// and REPLAY the same engine (escoba/js/game.js, unchanged) to the same state. A document whose log
// does not replay, play for play, under the rules, is refused whole (`validateGame`).
//
// HONEST LIMIT: both hands are derivable from the stored seed, so a player with dev tools could
// read the other hand. Hold'em has the same limit. It is not hidden and must never be described as
// cheat-proof.
//
// WRITTEN AS IT HAPPENS, one play at a time (`appendLog`), so a closed app loses nothing. Index rows
// change only when the turn passes or the match ends, which is what the push function watches
// (functions/index.js, escobaTurnPush).
//
// THE CHALLENGE IS DELIVERED WHEN THE CHALLENGER'S FIRST TURN ENDS: the challenger (side 'a', seat
// 0) leads the first round (the engine's dealer is seat 1, and the player after the dealer leads),
// so the other person's row is written only when the turn is theirs.
//
// NEEDS MATT: `escoba` is a new top-level node, so it must be in the PUBLISHED rules
// (database.rules.json, pasted by hand). Until then every call fails softly: reads return [] and
// writes return { ok:false, reason:'denied' }.
import { getStatsApp } from '../../js/firebase-boot.js';
import { readPath, watchPath } from '../../js/live-read.js';
import { loadProfile } from '../../js/profile-store.js';
import { readOpponentProfiles } from '../../js/stats-net.js';
import { buildIdentity, canonicalName, isPlaceholderName } from '../../js/players-agg.js';
import { recordEscoba, noteVoidedResult, withChallengeMatch, mayCountChallenge, countingSince, withMode } from '../../js/game-stats.js';
import { isVoidedMatch, voidedResultFor } from '../../js/stats-corrections.js';
import { onlineGate, codeMayPlayOnline } from '../../js/online-gate.js';
import { isNoResult, rowEnding, rowOpen, expiresAt, TIMEOUT, forfeitAt, turnStartOf, timeoutOver, rowTimeout, callOffCosts, rowStale } from '../../js/challenge-life.js';
import { stampFor, clockNow, decideNow, liveTime, noteTimeout, timeoutUnsure, queueConfirm, confirmsSettled } from '../../js/challenge-clock.js';
import { Game, makePlayer } from './game.js';
import { makeDeck, captureOptions } from './deck.js';

const NODE = 'escoba';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
const SEED_RE = /^[a-z0-9]{8,32}$/;
const CARD_RE = /^[oceb](?:[1-9]|1[0-2])$/;
const MAX_LOG = 3000;                            // a ceiling against a runaway writer, not a rule
/** Match lengths the sender picks: one hand, or first to 11 / 21. */
export const LENS = ['1', '11', '21'];
const TARGET = { 1: 1, 11: 11, 21: 21 };
export const DECKS = ['spanish', 'american'];
const ms = (v) => (Number.isFinite(+v) ? +v : 0);
const other = (s) => (s === 'a' ? 'b' : 'a');
const seatOf = (side) => (side === 'b' ? 1 : 0);
const sideOfSeat = (seat) => (seat === 1 ? 'b' : 'a');
/** Who a match was SENT to: the side that is not its maker (`by`). Always 'b' unless a document says otherwise. */
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

function randomChars(n) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  try {
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    for (const b of buf) r += alphabet[b % 36];
  } catch { for (let i = 0; i < n; i++) r += alphabet[(Math.random() * 36) | 0]; }
  return r;
}
/** A match id: time-ordered, plus eight random characters. */
export function mintGameId() { return Date.now().toString(36) + randomChars(8); }

// --- the deal: every round's deck order, from the seed -----------------------------------------------
// Its OWN shuffle on purpose, not deck.js's `shuffle`: a stored match must replay forever, so the
// order may depend only on this function, the seed, the round number and the card ids.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** PURE. The deck order (card ids) for round `round` of the match with this seed and deck mode. */
export function deckIds(seed, round, mode) {
  const ids = makeDeck(mode).map((c) => c.id).sort();
  const rng = mulberry32(hash32(`${seed}:${round}`));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

// --- dev origins never write to the family's database (js/stats-net.js's guard and opt-in key) ------
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
  console.warn(`[escoba] ${what} BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}
// TEST SEAM: tools/test-escoba-mp.mjs (and the browser checks) hand in an in-memory database.
let bootFn = getStatsApp;
let devGuard = true;
let playersFn = readOpponentProfiles;
export function __setBootForTest(fn, { allowDev = false, players = null } = {}) {
  bootFn = fn || getStatsApp; devGuard = !allowDev; playersFn = players || readOpponentProfiles;
}
async function ready() { try { return await bootFn(); } catch { return null; } }
const allowed = (what) => !devGuard || writesAllowed(what);
function reasonOf(err) {
  const s = String((err && (err.code || err.message)) || err);
  return /permission|PERMISSION_DENIED/i.test(s) ? 'denied' : s;
}
const fail = (reason, retryable = false) => ({ ok: false, reason, retryable });

const lenOf = (raw) => (raw && LENS.includes(String(raw.len)) ? String(raw.len) : null);
const deckOf = (raw) => (raw && raw.deck === 'american' ? 'american' : 'spanish');

// --- the replay: escoba/js/game.js's own Game, driven one play at a time --------------------------
// The engine's turn loop is async and agent-driven (the UI uses it, with the log as the remote
// agent). Validation needs the SAME state synchronously, so this drives a real Game instance through
// the engine's own synchronous parts (dealHands, scoreRound, checkMatchEnd) in the order its loop
// uses them. tools/test-escoba-mp.mjs runs the async engine beside this on random matches and checks
// both reach identical snapshots at every turn.

/** One play, cleaned, or null if it is not a well-formed play. `k` is the captured ids, sorted. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.by !== 'a' && e.by !== 'b') return null;
  const c = String(e.c || '');
  if (!CARD_RE.test(c)) return null;
  const ks = typeof e.k === 'string' && e.k ? e.k.split(',') : [];
  if (ks.length > 12 || ks.some((x) => !CARD_RE.test(x)) || new Set(ks).size !== ks.length) return null;
  return { by: e.by, c, k: ks.slice().sort().join(','), at: ms(e.at) };
}
/** The engine move for a log entry (what an agent hands the engine). */
export const moveOf = (e) => ({ cardId: e.c, captureIds: e.k ? e.k.split(',') : [] });
/** The log entry for an engine 'play' event by `side`. */
export const entryOf = (side, card, captured) => ({ by: side, c: card.id, k: (captured || []).map((x) => x.id).sort().join(',') });

function startRound(d) {
  const g = d.g;
  g.round += 1;
  g._midRound = true;
  for (const p of g.players) { p.hand = []; p.captured = []; p.escobas = 0; }
  g.table = [];
  const order = deckIds(d.seed, g.round, g.config.deckMode);
  g.config.presetDeck = order;
  const byId = new Map(makeDeck(g.config.deckMode).map((c) => [c.id, c]));
  g.stock = order.map((id) => byId.get(id));
  g.lastDeckOrder = order.slice();
  g.lastCapturer = null;
  g.lastCards = false;
  g.dealHands();
  g.table = g.stock.splice(0, 4);
  g._nextTurn = (g.dealer + 1) % g.players.length;
}

/**
 * A replay of one match: { g (a game.js Game), over, len, seed }. `g._nextTurn` is the seat due to
 * play; `over` is null or { winner: 'a'|'b'|'draw', why: 'target'|'whitewash'|'tie' }.
 * `names` = [{name, avatar}, {name, avatar}] (cosmetic only; never part of the replay).
 */
export function newReplay({ len, deck, seed }, names = []) {
  const players = [0, 1].map((id) => makePlayer({
    id, name: (names[id] && names[id].name) || '', avatar: (names[id] && names[id].avatar) || '🙂',
  }));
  const g = new Game({ players, config: { targetScore: TARGET[len], deckMode: deck }, rng: () => 0.5 });
  g.dealer = 1;                // seat 0 (side 'a', the challenger) leads the first round
  const d = { g, over: null, len, seed };
  startRound(d);
  return d;
}

/** Apply one play. Returns { escoba, roundOver } or null when it is not a legal play here. */
export function applyPlay(d, e) {
  if (!d || d.over || !e) return null;
  const g = d.g;
  const n = g.players.length;
  const turn = g._nextTurn;
  if (seatOf(e.by) !== turn) return null;
  const p = g.players[turn];
  const card = p.hand.find((c) => c.id === e.c);
  if (!card) return null;
  const ids = e.k ? e.k.split(',') : [];
  const opts = captureOptions(g.table, card);
  if (opts.length) {
    // A capture is compulsory when one exists, and it must be one the rules allow.
    const key = ids.slice().sort().join(',');
    if (!opts.some((o) => o.map((x) => x.id).sort().join(',') === key)) return null;
  } else if (ids.length) return null;
  // Exactly what game.js's playTurn does, in its order.
  g._nextTurn = (turn + 1) % n;
  p.hand = p.hand.filter((c) => c.id !== card.id);
  let escoba = false;
  if (ids.length) {
    const take = new Set(ids);
    const taken = g.table.filter((c) => take.has(c.id));
    g.table = g.table.filter((c) => !take.has(c.id));
    p.captured.push(card, ...taken);
    g.lastCapturer = p.id;
    escoba = g.table.length === 0;
    if (escoba) p.escobas += 1;
  } else {
    g.table.push(card);
  }
  let roundOver = false;
  if (g.players.every((x) => x.hand.length === 0)) {
    if (g.stock.length) {
      // runTurnLoop: a new hand is dealt before the next player acts.
      g.dealHands();
      g.lastCards = g.stock.length === 0;
      g._nextTurn = (turn + 1) % n;
    } else {
      roundOver = true;
      // runTurnLoop's sweep, then finishRoundAfterPlay.
      if (g.table.length && g.lastCapturer != null) {
        const q = g.byId(g.lastCapturer);
        q.captured.push(...g.table);
        g.table = [];
      }
      g.scoreRound();
      g._midRound = false;
      g.checkMatchEnd();
      if (!g.winner) g.dealer = (g.dealer + 1) % n;
      if (g.winner) d.over = { winner: sideOfSeat(g.winner.id), why: g.matchEndReason || 'target' };
      else if (d.len === '1') d.over = { winner: 'draw', why: 'tie' };   // one hand, level on points
      else startRound(d);
    }
  }
  return { escoba, roundOver };
}

/** Replay the first `upto` plays of a VALIDATED match. */
export function replayTo(game, upto = game.log.length, names = []) {
  const d = newReplay(game, names);
  for (let i = 0; i < upto && i < game.log.length; i++) if (!applyPlay(d, game.log[i])) break;
  return d;
}

/**
 * WHOLE-DOCUMENT REJECTION (Darts' and Hoops' rule): a log with one bad play would replay into a
 * different position on the two phones with nothing on screen saying so. So the log is REPLAYED
 * here, and anything that does not replay, or whose stored result disagrees with the replay, is not
 * a match. Every field added later must be OPTIONAL.
 */
export function validateGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = asCode(raw.a && raw.a.code);
  const b = asCode(raw.b && raw.b.code);
  if (!a || !b || a === b) return null;
  const len = lenOf(raw);
  const seed = typeof raw.seed === 'string' && SEED_RE.test(raw.seed) ? raw.seed : null;
  if (!len || !seed) return null;
  const deck = deckOf(raw);
  const src = raw.log && typeof raw.log === 'object' ? raw.log : {};
  const keys = Object.keys(src).sort();
  if (keys.length > MAX_LOG) return null;
  const d = newReplay({ len, deck, seed });
  const log = [];
  for (const k of keys) {
    const e = cleanEntry(src[k]);
    if (!e) return null;
    if (!applyPlay(d, e)) return null;
    log.push(e);
  }
  const to = recipientOfRaw(a, b, asCode(raw.by));
  let over = null;
  // CALLED OFF before its receiver answered (js/challenge-life.js): counts for nobody. Honoured only
  // while the receiver has played nothing; a cancel that raced their first play is void and the
  // match plays on, the same answer on both phones because both replay the same log.
  const calledOff = !!raw.over && typeof raw.over === 'object' && raw.over.winner === 'none';
  if (calledOff && !isNoResult(String(raw.over.why || ''))) return null;
  if (calledOff && !log.some((e) => e.by === to)) {
    over = { winner: 'none', why: String(raw.over.why), at: ms(raw.over.at) };
  } else if (raw.over && typeof raw.over === 'object' && !calledOff) {
    const w = raw.over.winner;
    if (w !== 'a' && w !== 'b' && w !== 'draw') return null;
    over = { winner: w, why: String(raw.over.why || ''), at: ms(raw.over.at) };
    // A result the log did not produce is only allowed for a resignation (and nobody resigns a draw).
    if (over.why === 'resign' ? (w === 'draw' || !!d.over) : (!d.over || d.over.winner !== w)) return null;
  } else if (d.over) {
    over = { winner: d.over.winner, why: d.over.why, at: ms(raw.updated) };
  }
  const g = d.g;
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  return {
    v: 1, id, len, deck, seed,
    // OPTIONAL: this challenge expires if its receiver has not answered in 3 days (js/challenge-life.js).
    ...(raw.lapse === true ? { lapse: true } : {}),
    by: asCode(raw.by),
    created: ms(raw.created),
    updated: ms(raw.updated),
    a: { code: a, name: String((raw.a && raw.a.name) || ''), emoji: String((raw.a && raw.a.emoji) || '🙂') },
    b: { code: b, name: String((raw.b && raw.b.name) || ''), emoji: String((raw.b && raw.b.emoji) || '🙂') },
    turn: over ? null : sideOfSeat(g._nextTurn),
    log,
    over,
    round: g.round,
    scores: { a: g.players[0].totalScore, b: g.players[1].totalScore },
    escobas: { a: g.players[0].matchEscobas | 0, b: g.players[1].matchEscobas | 0 },
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

// --- before the challenge is answered (js/challenge-life.js) ---------------------------------------
/** The side the challenge was sent to. */
export function recipientOf(game) { return game ? recipientOfRaw(game.a.code, game.b.code, game.by) : 'b'; }
/** PURE. { open, waiting, expires, expired }: open = not over and the receiver has played nothing;
 *  waiting = open and it is the receiver's turn (delivered); expires = when a waiting challenge lapses. */
export function lifeOf(game, now = decideNow()) {
  if (!game || game.over) return { open: false, waiting: false, expires: 0, expired: false, turnAt: 0, forfeits: 0 };
  const to = recipientOf(game);
  const open = !game.log.some((e) => e.by === to);
  const waiting = open && game.turn === to;
  const expires = expiresAt(game.lapse, waiting, game.updated);
  // ANSWERED: the side on turn has 7 days from when the turn became theirs (2026-10-29,
  // js/challenge-life.js), then forfeits. `turnAt` rides on the index rows so the lists agree.
  const turnAt = open ? 0 : turnStartOf(game.log, game.turn, game.updated, null, now);   // safe times, capped at now (2026-10-29)
  return { open, waiting, expires, expired: expires > 0 && now >= expires, turnAt, forfeits: open ? 0 : forfeitAt(turnAt) };
}
/** A match whose player on turn sat on it for 7 days is OVER: they lose, why 'timeout'. Derived on
 *  every read (nothing is written), so both phones agree and a late move is refused. */
export function withTimeout(game, now) {
  if (game && game.id) noteTimeout(NODE, game.id, true);   // a fresh look: forget an earlier unsure one
  if (!game || game.over) return game;
  // Decided on the SERVER's clock (js/challenge-clock.js); a timeout decided without live server time
  // is shown but never counted (countResult asks timeoutUnsure). 2026-10-29, second pass.
  const c = now == null ? clockNow() : { now, live: true };
  const life = lifeOf(game, c.now);
  const over = timeoutOver({ over: game.over, open: life.open, turn: game.turn, turnAt: life.turnAt, other }, c.now);
  if (over) { game.over = over; game.turn = null; noteTimeout(NODE, game.id, c.live); }
  return game;
}
/** Has the SENDER played anything yet? From then on a cancel or a decline counts as a loss for
 *  whoever does it (Matt, 2026-10-29, js/challenge-life.js callOffCosts). */
export function senderPlayed(game) { return !!game && game.log.some((e) => e.by !== recipientOf(game)); }
export function cancelCosts(game) { return callOffCosts(senderPlayed(game)); }
/** Was this match called off (cancelled or declined) rather than played to a result? */
export const isCalledOff = (game) => !!(game && game.over && game.over.winner === 'none');
export function themOf(game, code) { const s = sideOf(game, code); return (s === 'a' ? game.b : game.a) || { code: null, name: '', emoji: '🙂' }; }

/** Where the opponent's latest run of plays starts: what this phone should SHOW them playing. */
export function lastRunStart(game, theirSide) {
  let i = game.log.length;
  while (i > 0 && game.log[i - 1].by === theirSide) i--;
  return i;
}

// --- results ------------------------------------------------------------------------------------
export const RESULTS = ['won', 'lost', 'draw'];
export function resultOf(game, side) {
  if (!game || !game.over || (side !== 'a' && side !== 'b')) return null;
  if (game.over.winner === 'none') return null;             // called off: counts for nobody
  if (game.over.winner === 'draw') return 'draw';
  return game.over.winner === side ? 'won' : 'lost';
}

// --- the seen map (the launcher bubble, escoba/js/alert.js) ---------------------------------------
// This module's own writes stamp it, so only the OTHER person's writes can raise the bubble.
// One-tap recreatable: losing it re-shows a bubble, the safe direction.
export const SEEN_KEY = 'gamehub.escoba.seen.v1';
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
  } catch { /* private mode: a bubble shows again */ }
}
export function markSeen(id, updated) {
  if (!id) return;
  const map = readSeen();
  map[id] = Math.max(ms(map[id]), ms(updated) || Date.now());
  writeSeen(map);
}

// --- how far into each match this phone has SHOWN the other person's plays ------------------------
const SHOWN_KEY = 'gamehub.escoba.shown.v1';
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
  } catch { /* shows the plays again next time: harmless */ }
}

// --- counting a finished match exactly once per phone (Hoops' ledger) ------------------------------
export const LEDGER_KEY = 'gamehub.escoba.counted.v1';
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
/**
 * Record a finished match on this device, once (THE LAW rule 2: never twice). The SAME bucket as a
 * live online match: recordEscoba('mp', won, { escobas }). `won`: true, false, or null for a draw.
 * NEVER recordHeadToHead: head-to-head is live rooms only (js/mp-records.js reads challenge results
 * from the index), and escoba's splitEscobaMp migration reads h2h as evidence. A VOIDED match
 * (js/stats-corrections.js) is never counted.
 */
/** WHICH game a challenge was (js/game-stats.js withMode, 2026-10-30): two players, its length (`len`
 *  '1' / '11' / '21') and the card numbering. An index row carries the length only. */
export const chModeOf = (raw) => ({ n: 2, len: lenOf(raw) || '21', deck: deckOf(raw) });
const chModeOfRow = (r) => ({ n: 2, len: LENS.includes(String(r && r.len)) ? String(r.len) : '21' });
export function countResult(id, won, escobas = 0, finishedAt = Date.now(), mode = null) {
  // A timeout this page could not confirm on live server time is shown, never counted (2026-10-29).
  if (timeoutUnsure(NODE, id)) return false;
  if (isVoidedMatch('escoba', id)) return false;
  // A storage that never counted these challenges counts only what finished after it started
  // (2026-10-29, js/game-stats.js mayCountChallenge): a fresh install never re-counts history.
  if (!mayCountChallenge(LEDGER_KEY, finishedAt)) return false;
  if (!markCounted(id)) return false;
  try { withChallengeMatch('escoba', id, () => withMode(mode, 'mp', () => recordEscoba('mp', won == null ? null : !!won, { escobas: Math.max(0, escobas | 0) }))); }
  catch (err) { console.error('[escoba] recordEscoba failed', err); }
  return true;
}
const wonOf = (result) => (result === 'won' ? true : result === 'lost' ? false : null);
/** A voided match this phone HAD counted: noted once, so the stats screens take it back out. */
export function noteVoided() {
  const me = myCode();
  if (!me) return 0;
  let n = 0;
  for (const id of readLedger()) {
    const res = voidedResultFor('escoba', id, me);
    if (res) { try { if (noteVoidedResult('escoba', id, res)) n++; } catch (err) { console.error('[escoba] noting a voided match failed', err); } }
  }
  return n;
}
/** Count every finished row not yet counted here, and queue it for the Game Over popup. */
export function recordFinished(rows) {
  // Start this storage's "counting since" clock at its FIRST launcher paint, not at its first finished
  // match: a new player's first win, finished while the app was closed, must still count (2026-10-29).
  countingSince(LEDGER_KEY);
  try { noteVoided(); } catch (err) { console.warn('[escoba] noteVoided', err); }
  const ledger = readLedger();
  const fresh = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && RESULTS.includes(r.result) && !ledger.has(r.id) && !isVoidedMatch('escoba', r.id));
  // A TIMEOUT seen on a row is counted only once the match itself confirms it on live server time
  // (2026-10-29, second pass: a phone clock set forward made rows "time out"). The rest count now.
  queueConfirm(NODE, fresh.filter((r) => r.why === TIMEOUT), readGame, (r, g) => {
    const res = resultOf(g, sideOf(g, myCode()));
    if (!RESULTS.includes(res) || !countResult(r.id, wonOf(res), r.mineEsc, g.over.at, chModeOf(g))) return false;
    addUnseen([r.id]);
    return true;
  });
  const todo = fresh.filter((r) => r.why !== TIMEOUT && mayCountChallenge(LEDGER_KEY, r.updated));
  for (const r of todo) countResult(r.id, wonOf(r.result), r.mineEsc, r.updated, chModeOfRow(r));
  addUnseen(todo.map((r) => r.id));
  return todo.length;
}
/** Resolves once every timeout queued by recordFinished has been confirmed (or not) and counted. */
export const timeoutsSettled = () => confirmsSettled(NODE);
export const UNSEEN_KEY = 'gamehub.escoba.unseenResults.v1';
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
    // Cancelled, declined or expired (js/challenge-life.js): finished, with no result for anybody.
    const ended = rowEnding(r, now);
    // Answered, and 7 days on one player's turn (js/challenge-life.js): they lost, why 'timeout'.
    const late = ended ? null : rowTimeout(r, now);
    return {
      id, with: asCode(r.with), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      updated: late ? late.at : ms(r.updated), yourTurn: !ended && !late && !!r.yourTurn, over: !!r.over || !!ended || !!late,
      result: late ? late.result : !ended && RESULTS.includes(r.result) ? r.result : null,
      why: ended || (late ? TIMEOUT : typeof r.why === 'string' ? r.why : ''),
      ended, open: ended ? '' : rowOpen(r), expires: ms(r.expires), sent: !!r.sent,
      mine: ms(r.mine), theirs: ms(r.theirs), mineEsc: ms(r.mineEsc), theirsEsc: ms(r.theirsEsc),
      len: LENS.includes(String(r.len)) ? String(r.len) : '21', round: ms(r.round),
    };
  }).filter((r) => ID_RE.test(r.id) && r.with && !isVoidedMatch('escoba', r.id)));
}
export async function readMyGames() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    return rowsFromIndex(await readPath(boot, `${NODE}/index/${me}`));
  } catch (err) { console.warn('[escoba] could not read your matches', err); return []; }
}
/** READ-ONLY live listener on your own index. Returns an unsubscribe that is always safe to call. */
export async function watchMyGames(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = watchPath(boot, `${NODE}/index/${me}`, (v) => {
      try { cb(rowsFromIndex(v)); } catch (err) { console.warn('[escoba] list watch', err); }
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
    if (!game) { console.error(`[escoba] ${NODE}/games/${id} did not validate; refusing to open it.`); return null; }
    game.id = id;
    return withTimeout(game);
  } catch (err) { console.warn('[escoba] could not read that match', err); return null; }
}
/** READ-ONLY live listener on one match: `cb` gets the validated match on every change. */
export async function watchGame(id, cb) {
  if (!ID_RE.test(String(id || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/games/${id}`), (snap) => {
      try { const g = validateGame(snap && snap.exists() ? snap.val() : null); if (g) { g.id = id; cb(withTimeout(g)); } }
      catch (err) { console.warn('[escoba] match watch', err); }
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
  try { return opponentsFrom(await playersFn(), myCode()).filter((r) => codeMayPlayOnline(r.code, 'escoba', r.name)); }
  catch (err) { console.warn('[escoba] could not read the player list', err); return []; }
}

// --- writing ------------------------------------------------------------------------------------

/** The index row one person gets: what the match looks like from `side`. `lastBy` says whose write
 *  this is from that row's point of view, which is what the push function reads. */
function rowFor(game, side, writer) {
  const them = side === 'a' ? game.b : game.a;
  const life = lifeOf(game);
  // A called-off match is stored over:false / yourTurn:false with `ended` saying why, so the push
  // function (which knows no "cancelled") sends nothing for it (js/challenge-life.js rowEnding).
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
    sent: side !== recipientOf(game),
    pl: senderPlayed(game),                     // the sender has played: calling off costs a loss (2026-10-29)
    mine: game.scores[side], theirs: game.scores[other(side)],
    mineEsc: game.escobas[side], theirsEsc: game.escobas[other(side)],
    round: game.round,
    len: game.len,
    lastBy: writer === side ? 'me' : 'them',
    ...(game.over && !ended ? { result: resultOf(game, side), why: String(game.over.why || '') } : {}),
    ...(ended ? { why: ended } : {}),
  };
}
async function writeRows(api, db, game, writer, only = null) {
  if (only !== 'b') await api.update(api.ref(db, `${NODE}/index/${game.a.code}/${game.id}`), rowFor(game, 'a', writer));
  if (only !== 'a') await api.update(api.ref(db, `${NODE}/index/${game.b.code}/${game.id}`), rowFor(game, 'b', writer));
}
/** A retry that finds its write already landed rewrites every row that disagrees with the MATCH
 *  (2026-10-29, second pass, js/challenge-life.js rowStale): the rows' write may be what failed. A
 *  derived timeout is never written; a challenge not yet delivered gets no receiver row. */
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
 * Start a challenge against `them` ({code, name, emoji}), `len` '1' | '11' | '21', `deck` the
 * sender's numbering. The challenger is side 'a' and plays first; only their own row is written here
 * (the other person's arrives when the first turn passes, appendLog). Returns { ok, id, game }.
 */
export async function createGame({ them, len = '21', deck = 'spanish' }) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return fail('no-player-code');
  if (!to || to === me) return fail('bad-opponent');
  // Both people must be allowed online (js/online-gate.js, the play-yourself cheat).
  const gate = onlineGate();
  if (gate) return fail(gate);
  if (!codeMayPlayOnline(to, 'escoba', String(them.name || ''))) return fail('them-not-approved');
  if (!allowed('createGame')) return fail('dev-origin-blocked');
  if (!LENS.includes(String(len))) return fail('bad-len');
  if (!DECKS.includes(deck)) return fail('bad-deck');
  const mine = meLabel();
  const id = mintGameId();
  const doc = {
    v: 1, id, len: String(len), deck, seed: randomChars(16), lapse: true, by: me, created: 0, updated: 0,
    a: { code: me, name: mine.name, emoji: mine.emoji },
    b: { code: to, name: String(them.name || ''), emoji: String(them.emoji || '🙂') },
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
    if (!game) { console.error(`[escoba] write VERIFY FAILED for ${NODE}/games/${id}`); return fail('did-not-land', true); }
    game.id = id;
    await writeRows(api, db, game, 'a', 'a');
    markSeen(id, game.updated);
    return { ok: true, id, game };
  } catch (err) {
    console.error('[escoba] could not start the match', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * Append this player's plays (`entries`) to the log, starting at `base` (the log length this phone
 * built them on). Idempotent: plays already there are not written twice, and a log that has moved on
 * differently is a conflict, never overwritten. Rows are rewritten when the turn passes or the match
 * ends. Returns { ok, game } or a failure.
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
    await liveTime(api);            // expiry and timeouts are decided on the server's clock (2026-10-29)
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (list.some((e) => e.by !== side)) return fail('bad-entry');
    const have = fresh.log.length;
    // Already landed (a retry after a verify that timed out): nothing to write.
    const same = (x, y) => x && y && x.by === y.by && x.c === y.c && x.k === y.k;
    let skip = 0;
    while (skip < list.length && base + skip < have && same(fresh.log[base + skip], list[skip])) skip++;
    if (base + skip !== have) return fail('moved-on');
    const todo = list.slice(skip);
    const turnBefore = fresh.turn;
    // Already landed: the rows' write may be what failed last time, so put right any row that
    // disagrees with the match (2026-10-29, second pass).
    if (!todo.length) { await repairRows(api, db, fresh, side); return { ok: true, game: fresh }; }
    if (fresh.over) return fail('already-over');   // includes 7 days on a turn (timeout)
    // Nobody answered it for 3 days, so it lapsed (js/challenge-life.js): no play can revive it.
    if (lifeOf(fresh).expired) return fail('expired');
    // The rules must accept them before anything is written.
    const d = replayTo(fresh);
    for (const e of todo) if (!applyPlay(d, e)) return fail('rules-refused');
    const now = stampFor(api);      // the SERVER stamps every play (rules refuse any other time)
    const patch = { updated: now };
    todo.forEach((e, i) => {
      patch[`log/${String(have + i).padStart(4, '0')}`] = { by: e.by, c: e.c, ...(e.k ? { k: e.k } : {}), at: now };
    });
    if (d.over) patch.over = { winner: d.over.winner, why: d.over.why, at: now };
    await api.update(api.ref(db, `${NODE}/games/${id}`), patch);
    const back = await readGame(id);
    if (!back || back.log.length !== have + todo.length) {
      console.error(`[escoba] VERIFY FAILED for ${NODE}/games/${id}: expected ${have + todo.length} plays.`);
      return fail('did-not-land', true);
    }
    back.id = id;
    // The receiver's first play ANSWERS the challenge: the rows stop saying it is waiting at once.
    const answered = lifeOf(fresh).open && !lifeOf(back).open;
    if (back.over || back.turn !== turnBefore || have === 0 || answered) {
      await writeRows(api, db, back, side, back.over || back.turn !== side || answered ? null : side);
    }
    if (back.over || back.turn !== side) markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[escoba] could not send the play', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * CALL OFF a challenge its receiver has not answered (js/challenge-life.js): the sender CANCELS it,
 * the receiver DECLINES it. Counts for nobody, nobody is notified, nothing is deleted. Refused with
 * 'accepted' once the receiver has played; from then on the only way out is resignGame.
 */
export async function cancelGame(id) {
  const me = myCode();
  if (!me) return fail('no-player-code');
  if (!allowed('cancelGame')) return fail('dev-origin-blocked');
  try {
    const boot = await ready();
    if (!boot) return fail('offline', true);
    const { db, api } = boot;
    await liveTime(api);            // expiry and timeouts are decided on the server's clock (2026-10-29)
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    let back = fresh;
    let lost = false;
    if (fresh.over) {
      // Already called off (a retry after the rows did not land): write them again.
      // A call-off that cost this side the match is a resignation by it (retried).
      lost = fresh.over.why === 'resign' && fresh.over.winner === other(side);
      if (!isCalledOff(fresh) && !lost) return fail('already-over');
    } else {
      if (!lifeOf(fresh).open) return fail('accepted');
      const now = stampFor(api);
      const why = side === recipientOf(fresh) ? 'declined' : 'cancelled';
      // Once the sender has played, calling it off is a LOSS for whoever does it (Matt, 2026-10-29):
      // stored as their resignation, `via` saying how. Before that it counts for nobody.
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
    // A loss is the other person's WIN: their row is written even if the challenge never reached them.
    await writeRows(api, db, back, side, lost || (r && r.exists()) ? null : side);
    markSeen(id, back.updated);
    return lost ? { ok: true, game: back, lost: true } : { ok: true, game: back, cancelled: true };
  } catch (err) {
    console.error('[escoba] could not call the challenge off', err);
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
    await liveTime(api);            // expiry and timeouts are decided on the server's clock (2026-10-29)
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (fresh.over && fresh.over.why === TIMEOUT) return fail('already-over');   // timed out: already decided
    if (fresh.over) { await repairRows(api, db, fresh, side); return { ok: true, game: fresh, cancelled: isCalledOff(fresh) }; }
    // Unanswered: called off instead (counts for nobody until the sender has played; then a loss).
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
    console.error('[escoba] could not resign', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

// --- the offline outbox: a play made with no signal is KEPT and retried, never dropped ------------
export const OUTBOX_KEY = 'gamehub.escoba.outbox.v1';
function readOutbox() {
  try { const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeOutbox(q) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.slice(-40))); } catch (err) { console.error('[escoba] outbox write failed', err); }
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
    else console.warn('[escoba] dropping queued plays that can no longer be sent:', res.reason, item);
  }
  // Re-read before writing back: anything queued or replaced while this drain was out (the match
  // screen saving a newer play) wins over what this drain started from.
  const same = (x, y) => y.id === x.id && y.base === x.base && JSON.stringify(y.entries) === JSON.stringify(x.entries);
  const newer = readOutbox().filter((x) => !q.some((y) => same(x, y)));
  writeOutbox(newer.concat(left.filter((x) => !newer.some((y) => y.id === x.id))));
  return sent;
}

// --- history --------------------------------------------------------------------------------------
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
