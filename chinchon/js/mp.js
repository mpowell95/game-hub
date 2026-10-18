// chinchon/js/mp.js - CHINCHÓN CHALLENGES, turn by turn (2026-10-18). Matt: "You should be able to
// challenge someone to turn by turn games in all multiplayer games too." Two people play one match
// hours or days apart. darts/js/mp.js is the model (structure only; no code is shared with it).
//
// THE LAW applies. A match is not a player's earned history, but the writes still follow rule 6:
// every one is VERIFIED by a fresh re-read, and nothing here ever deletes anything.
//
// THE NODE: `chinchon/games/<id>` (the match) + `chinchon/index/<CODE>/<id>` (one row per person, so
// "what matches do I have" is ONE read) + `chinchon/chat/<id>` (js/match-chat.js, BESIDE the match).
// Addressed by PLAYER CODE, never by deviceId (several people here have two phones).
//
// A MATCH IS A LOG, NEVER A SNAPSHOT. The match stores its rules (`rules`), its length (`len`: one
// hand, or played until somebody passes 50 / 100 points), a SEED for the deck, and `log`: every
// decision in order (which pile was drawn, which card was discarded, whether to close). Both phones
// REPLAY chinchon/js/game.js (unchanged) with a seeded shuffle and those decisions, so they always
// reach the same table, and a document that does not replay is refused whole (`validateGame`).
//
// HIDDEN CARDS, honestly: both hands follow from the stored seed, so a player with dev tools could
// work out the other hand. Accepted (Texas Hold'em has the same limit); never described as secret.
//
// WRITTEN AS IT HAPPENS, one decision at a time (`appendLog`), so a turn cannot be lost to a closed
// app and a discard cannot be taken back by closing it. The index rows only change when the turn
// passes or the match ends, which is what the push function (functions/index.js chinchonTurnPush)
// watches. A turn is everything one player does until the OTHER must act: draw and discard, or a
// close (and, when the closer also starts the next hand, that hand's first turn too).
//
// THE CHALLENGE IS DELIVERED WHEN THE CHALLENGER'S FIRST TURN ENDS: the challenger plays first, so
// the other person's row is written only when the turn is theirs.
//
// NEEDS MATT: `chinchon` is a new top-level node, so it must be in the PUBLISHED rules
// (database.rules.json, pasted by hand). Until then every call fails softly: reads return [] and
// writes return { ok:false, reason:'denied' }.
import { getStatsApp } from '../../js/firebase-boot.js';
import { loadProfile } from '../../js/profile-store.js';
import { readPlayersOnce } from '../../js/stats-net.js';
import { buildIdentity, canonicalName, isPlaceholderName } from '../../js/players-agg.js';
import { recordChinchon, noteVoidedResult } from '../../js/game-stats.js';
import { isVoidedMatch, voidedResultFor } from '../../js/stats-corrections.js';
import { onlineGate, codeMayPlayOnline } from '../../js/online-gate.js';
import { isNoResult, rowEnding, rowOpen, expiresAt } from '../../js/challenge-life.js';
import { Game, DEFAULT_CONFIG, makePlayer } from './game.js';

const NODE = 'chinchon';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
const CARD_RE = /^(?:[ocbe](?:[1-9]|1[0-2])|jk[12])$/;
const MAX_LOG = 6000;                            // a ceiling against a runaway writer, not a rule
const ms = (v) => (Number.isFinite(+v) ? +v : 0);
const other = (s) => (s === 'a' ? 'b' : 'a');
const seatOf = (side) => (side === 'b' ? 1 : 0);
const sideOfSeat = (seat) => (seat === 1 ? 'b' : 'a');
/** Who a match was SENT to: the side that is not its maker (`by`). Every challenge is made by side
 *  'a', so this is 'b' unless a document says otherwise. */
const recipientOfRaw = (aCode, bCode, by) => (by && by === bCode && by !== aCode ? 'a' : 'b');

// --- the match's shape -----------------------------------------------------------------------------
/** How long a match is, chosen by the sender. 'hand': one hand, lowest score wins. '50' / '100':
 *  the engine's own points ending (game.js checkMatchEnd: the match ends once somebody is OVER the
 *  limit, and the lowest total wins). There is no "first to 50": Chinchón is lowest-score-wins, so
 *  the limit is the elimination line. */
export const LENS = ['hand', '50', '100'];
export const lenOf = (raw) => (raw && LENS.includes(raw.len) ? raw.len : 'hand');

/** The rules a challenge is played with: the game's standard rules (DEFAULT_CONFIG as it is on
 *  2026-10-18), STORED on the match so a later change to the defaults never changes an old match.
 *  Placing cards on the closer's melds is automatic (a manual choice would be a decision of the
 *  OTHER player inside the closer's turn). */
const RULE_KEYS = {
  extended: (v) => typeof v === 'boolean',
  joker: (v) => typeof v === 'boolean',
  aceOrosWild: (v) => typeof v === 'boolean',
  winWithChinchon: (v) => typeof v === 'boolean',
  chinchonNegative: (v) => Number.isInteger(v) && v >= -100 && v <= 0,
  maxResets: (v) => Number.isInteger(v) && v >= 0 && v <= 6,
  maxClose: (v) => v === 3 || v === 4 || v === 5,
  figuresFaceValue: (v) => typeof v === 'boolean',
};
export function standardRules() {
  const r = {};
  for (const k of Object.keys(RULE_KEYS)) r[k] = DEFAULT_CONFIG[k];
  return r;
}
/** The stored rules, or null if any is malformed (the whole match is then refused). */
function cleanRules(raw) {
  const std = standardRules();
  if (raw == null) return std;
  if (typeof raw !== 'object') return null;
  const out = {};
  for (const k of Object.keys(RULE_KEYS)) {
    const v = raw[k] === undefined ? std[k] : raw[k];
    if (!RULE_KEYS[k](v)) return null;
    out[k] = v;
  }
  return out;
}
/** The engine config for a match: its rules, its length, automatic placing. */
export function configFor(len, rules) {
  const lenCfg = len === 'hand' ? { victoryCondition: 'rounds', roundsLimit: 1 }
    : { victoryCondition: 'points', scoreLimit: +len };
  return Object.assign({}, DEFAULT_CONFIG, rules || standardRules(), lenCfg, { placeOnEnding: 'auto', showRemaining: false });
}

/** mulberry32: a small seeded generator, so both phones shuffle every hand (and every reshuffle of
 *  the discard pile) the same way. The ENGINE draws from it; nothing else does. */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mintSeed() {
  try { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] >>> 0; }
  catch { return Math.floor(Math.random() * 4294967296) >>> 0; }
}
const okSeed = (v) => Number.isInteger(v) && v >= 0 && v <= 4294967295;

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
  console.warn(`[chinchon] ${what} BLOCKED: dev origin. To allow: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}
// TEST SEAM: tools/test-chinchon-mp.mjs (and the browser checks) hand in an in-memory database.
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

/** One decision, cleaned, or null if it is not well formed. Three kinds:
 *  { by, k:'draw', src:'stock'|'discard' }, { by, k:'discard', card:<card id> }, { by, k:'close', yes } */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.by !== 'a' && e.by !== 'b') return null;
  const at = ms(e.at);
  if (e.k === 'draw' && (e.src === 'stock' || e.src === 'discard')) return { by: e.by, k: 'draw', src: e.src, at };
  if (e.k === 'discard' && typeof e.card === 'string' && CARD_RE.test(e.card)) return { by: e.by, k: 'discard', card: e.card, at };
  if (e.k === 'close' && typeof e.yes === 'boolean') return { by: e.by, k: 'close', yes: e.yes, at };
  return null;
}
export const sameEntry = (x, y) => !!x && !!y && x.by === y.by && x.k === y.k && x.src === y.src && x.card === y.card && x.yes === y.yes;

/** What the engine gets from a logged entry when it asks seat `side` for a `kind` decision, or
 *  undefined when the entry is not an answer to that question (the log is then invalid). */
export function answerOf(e, side, kind, view) {
  if (!e || e.by !== side || e.k !== kind) return undefined;
  if (kind === 'draw') return e.src === 'stock' || (e.src === 'discard' && view.discardTop) ? e.src : undefined;
  if (kind === 'discard') return view.hand.some((c) => c.id === e.card) ? e.card : undefined;
  if (kind === 'close') return typeof e.yes === 'boolean' ? e.yes : undefined;
  return undefined;
}

/** The engine for a match: seat 0 is side 'a' (the challenger), seat 1 side 'b'. Seat 1 deals the
 *  first hand, so the challenger plays first; the deal then rotates (game.js). */
export function makeEngine(doc, agentFor, names = null) {
  const cfg = configFor(lenOf(doc), doc.rules);
  const who = (side) => (names && names[side]) || doc[side] || {};
  const players = [0, 1].map((seat) => {
    const p = who(sideOfSeat(seat));
    return makePlayer({ id: seat, name: String(p.name || '?'), avatar: String(p.emoji || '🙂'), isHuman: false, agent: agentFor(seat) });
  });
  return new Game({ players, config: cfg, rng: seededRng(doc.seed), startDealerIndex: 1 });
}

/** The stored result for a finished replay: 'a' | 'b' | 'draw' (level totals, no chinchón). */
export function winnerOfEngine(g) {
  if (!g.winner) return null;
  if (g.matchEndReason !== 'chinchon' && g.players[0].totalScore === g.players[1].totalScore) return 'draw';
  return sideOfSeat(g.winner.id);
}
const whyOfEngine = (g, len) => (g.matchEndReason === 'chinchon' ? 'chinchon' : len === 'hand' ? 'hand' : 'points');

/**
 * Replay the first `upto` decisions of a match. PURE apart from time (microtasks only). Resolves
 * { ok, engine, waiting: {seat, kind} | null, done, consumed, tally } where `waiting` is the
 * decision the engine is asking for next and `done` says the match finished. `ok` is false when an
 * entry does not answer the question the engine asked, or entries are left over after the end.
 * `tally` counts each side's closes, chinchones and -10 closes (recordChinchon's extras).
 */
export async function replay(doc, upto = doc.log.length) {
  const log = doc.log;
  let i = 0, bad = null, waiting = null;
  let stop;
  const stopped = new Promise((r) => { stop = r; });
  const never = () => new Promise(() => {});
  const agentFor = (seat) => {
    const side = sideOfSeat(seat);
    const next = (kind, view) => {
      if (bad || waiting) return never();
      if (i >= upto) { waiting = { seat, kind }; stop(); return never(); }
      const v = answerOf(log[i], side, kind, view);
      if (v === undefined) { bad = `entry ${i} does not answer ${side}'s ${kind}`; stop(); return never(); }
      i++;
      return Promise.resolve(v);
    };
    return {
      isHuman: false,
      chooseDraw: (view) => next('draw', view),
      chooseDiscard: (view) => next('discard', view),
      decideClose: (view) => next('close', view),
      choosePlacements: async (view, locked, attachable) => attachable.map((c) => c.id),
    };
  };
  let g;
  try { g = makeEngine(doc, agentFor); } catch (err) { return { ok: false, reason: String(err) }; }
  const tally = { closes: [0, 0], chinchons: [0, 0], minusTen: [0, 0] };
  g.onEvent = async (type) => {
    if (type !== 'roundScored' || g.whoClosed == null) return;
    const s = g.whoClosed;
    tally.closes[s]++;
    if (g.closeType === 'chinchon') tally.chinchons[s]++;
    else if (g.closeType === 'doubleMeld') tally.minusTen[s]++;
  };
  let done = false;
  g.playMatch().then(() => { done = !bad && !waiting; stop(); }, (err) => { bad = String((err && err.message) || err); stop(); });
  await stopped;
  if (bad) return { ok: false, reason: bad };
  if (done && i !== upto) return { ok: false, reason: 'entries after the end' };
  return { ok: true, engine: g, waiting, done, consumed: i, tally };
}

/**
 * WHOLE-DOCUMENT REJECTION (Hoops' rule): a log with one bad entry would replay into a different
 * table on the two phones with nothing on screen saying so. So the log is REPLAYED here, and
 * anything that does not replay, or whose stored result disagrees with the replay, is not a
 * match. Every field added later must be OPTIONAL. Async: it runs the engine.
 */
export async function validateGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = asCode(raw.a && raw.a.code);
  const b = asCode(raw.b && raw.b.code);
  if (!a || !b || a === b) return null;
  if (!okSeed(raw.seed)) return null;
  if (raw.len != null && !LENS.includes(raw.len)) return null;
  const len = lenOf(raw);
  const rules = cleanRules(raw.rules);
  if (!rules) return null;
  const src = raw.log && typeof raw.log === 'object' ? raw.log : {};
  const keys = Object.keys(src).sort();
  if (keys.length > MAX_LOG) return null;
  const log = [];
  for (const k of keys) {
    const e = cleanEntry(src[k]);
    if (!e) return null;
    log.push(e);
  }
  const doc = { a: { code: a, name: String((raw.a && raw.a.name) || ''), emoji: String((raw.a && raw.a.emoji) || '🙂') },
    b: { code: b, name: String((raw.b && raw.b.name) || ''), emoji: String((raw.b && raw.b.emoji) || '🙂') },
    seed: raw.seed, len, rules, log };
  const rep = await replay(doc);
  if (!rep.ok) return null;
  const g = rep.engine;
  const replayWinner = rep.done ? winnerOfEngine(g) : null;
  let over = null;
  const to = recipientOfRaw(a, b, asCode(raw.by));
  // CALLED OFF before its receiver answered (js/challenge-life.js): counts for nobody. Only honoured
  // while the receiver has played nothing. A cancel that raced their first move is void and the
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
    if (over.why === 'resign' ? w === 'draw' : replayWinner !== w) return null;
  } else if (replayWinner) {
    over = { winner: replayWinner, why: whyOfEngine(g, len), at: ms(raw.updated) };
  }
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  const turn = over || !rep.waiting ? null : sideOfSeat(rep.waiting.seat);
  return {
    v: 1, id, len, seed: raw.seed, rules,
    // OPTIONAL: this challenge expires if its receiver has not answered in 3 days (js/challenge-life.js).
    ...(raw.lapse === true ? { lapse: true } : {}),
    by: asCode(raw.by),
    created: ms(raw.created),
    updated: ms(raw.updated),
    a: doc.a, b: doc.b,
    turn,
    asking: turn ? rep.waiting.kind : null,     // 'draw' | 'discard' | 'close'
    log,
    over,
    round: g.round,
    scores: { a: g.players[0].totalScore, b: g.players[1].totalScore },
    tally: { a: { closed: rep.tally.closes[0], chinchons: rep.tally.chinchons[0], minusTen: rep.tally.minusTen[0] },
      b: { closed: rep.tally.closes[1], chinchons: rep.tally.chinchons[1], minusTen: rep.tally.minusTen[1] } },
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

// --- before the challenge is answered (js/challenge-life.js) --------------------------------------
/** The side the challenge was sent to. */
export function recipientOf(game) { return game ? recipientOfRaw(game.a.code, game.b.code, game.by) : 'b'; }
/** PURE. { open, waiting, expires, expired }: open = not over and the receiver has played nothing;
 *  waiting = open and it is the receiver's turn (it has been delivered); expires = when a waiting
 *  challenge lapses (0 = never). */
export function lifeOf(game, now = Date.now()) {
  if (!game || game.over) return { open: false, waiting: false, expires: 0, expired: false };
  const to = recipientOf(game);
  const open = !game.log.some((e) => e.by === to);
  const waiting = open && game.turn === to;
  const expires = expiresAt(game.lapse, waiting, game.updated);
  return { open, waiting, expires, expired: expires > 0 && now >= expires };
}
/** Was this match called off (cancelled or declined) rather than played to a result? */
export const isCalledOff = (game) => !!(game && game.over && game.over.winner === 'none');
export function themOf(game, code) { const s = sideOf(game, code); return (s === 'a' ? game.b : game.a) || { code: null, name: '', emoji: '🙂' }; }

/** Where the other person's latest run of decisions starts: what this phone should SHOW them doing. */
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

// --- the seen map (the launcher bubble, chinchon/js/alert.js) --------------------------------------
// This module's own writes stamp it, so only the OTHER person's writes can raise the bubble.
// One-tap recreatable: losing it re-shows a bubble, the safe direction.
export const SEEN_KEY = 'gamehub.chinchon.ch.seen.v1';
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

// --- how far into each match this phone has SHOWN the other person's play -------------------------
const SHOWN_KEY = 'gamehub.chinchon.ch.shown.v1';
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
  } catch { /* shows the play again next time: harmless */ }
}

// --- counting a finished match exactly once, on BOTH phones (Hoops' ledger) -----------------------
export const LEDGER_KEY = 'gamehub.chinchon.ch.counted.v1';
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
 *  results go in the 'mp' bucket, the same bucket a live room's match uses (ui.js MP_DIFFICULTY).
 *  `won`: true, false, or null for a draw. `extras`: this side's { closed, minusTen, chinchons }.
 *  Never recordHeadToHead: the Multiplayer screen's Records reads challenges from the index. */
export function countResult(id, won, extras = {}) {
  if (isVoidedMatch('chinchon', id)) return false;
  if (!markCounted(id)) return false;
  try {
    recordChinchon('mp', won == null ? null : !!won, {
      closed: extras.closed | 0, minusTen: extras.minusTen | 0, chinchons: extras.chinchons | 0,
    });
  } catch (err) { console.error('[chinchon] recordChinchon failed', err); }
  return true;
}
const wonOf = (result) => (result === 'won' ? true : result === 'lost' ? false : null);
/** A voided match this phone HAD counted: noted once, so the stats screens take it back out. */
export function noteVoided() {
  const me = myCode();
  if (!me) return 0;
  let n = 0;
  for (const id of readLedger()) {
    const res = voidedResultFor('chinchon', id, me);
    if (res) { try { if (noteVoidedResult('chinchon', id, res)) n++; } catch (err) { console.error('[chinchon] noting a voided match failed', err); } }
  }
  return n;
}
/** Count every finished row not yet counted here (with the extras its row carries), and queue it
 *  for the Game Over popup. */
export function recordFinished(rows) {
  try { noteVoided(); } catch (err) { console.warn('[chinchon] noteVoided', err); }
  const ledger = readLedger();
  const todo = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.over && RESULTS.includes(r.result) && !ledger.has(r.id) && !isVoidedMatch('chinchon', r.id));
  for (const r of todo) countResult(r.id, wonOf(r.result), { closed: r.cl, chinchons: r.cn, minusTen: r.m10 });
  addUnseen(todo.map((r) => r.id));
  return todo.length;
}
export const UNSEEN_KEY = 'gamehub.chinchon.ch.unseenResults.v1';
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
const n0 = (v) => (Number.isFinite(+v) ? +v : 0);
export function rowsFromIndex(val, now = Date.now()) {
  if (!val || typeof val !== 'object') return [];
  return sortRows(Object.keys(val).map((id) => {
    const r = val[id] || {};
    // Cancelled, declined or expired (js/challenge-life.js): finished, with no result for anybody.
    const ended = rowEnding(r, now);
    return {
      id, with: asCode(r.with), name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
      updated: ms(r.updated), yourTurn: !ended && !!r.yourTurn, over: !!r.over || !!ended,
      result: !ended && RESULTS.includes(r.result) ? r.result : null,
      why: ended || (typeof r.why === 'string' ? r.why : ''),
      ended, open: ended ? '' : rowOpen(r), expires: ms(r.expires), sent: !!r.sent,
      mine: n0(r.mine), theirs: n0(r.theirs), kind: LENS.includes(r.kind) ? r.kind : 'hand', round: ms(r.round) || 1,
      cl: n0(r.cl), cn: n0(r.cn), m10: n0(r.m10),
    };
    // A voided match (js/stats-corrections.js) is left out of every list and record built from here.
  }).filter((r) => ID_RE.test(r.id) && r.with && !isVoidedMatch('chinchon', r.id)));
}
export async function readMyGames() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    const snap = await boot.api.get(boot.api.ref(boot.db, `${NODE}/index/${me}`));
    return rowsFromIndex(snap && snap.exists() ? snap.val() : null);
  } catch (err) { console.warn('[chinchon] could not read your matches', err); return []; }
}
/** READ-ONLY live listener on your own index. Returns an unsubscribe that is always safe to call. */
export async function watchMyGames(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/index/${me}`), (snap) => {
      try { cb(rowsFromIndex(snap && snap.exists() ? snap.val() : null)); } catch (err) { console.warn('[chinchon] list watch', err); }
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
    const game = await validateGame(snap.val());
    if (!game) { console.error(`[chinchon] ${NODE}/games/${id} did not validate; refusing to open it.`); return null; }
    game.id = id;
    return game;
  } catch (err) { console.warn('[chinchon] could not read that match', err); return null; }
}
/** READ-ONLY live listener on one match: `cb` gets the validated match on every change (in order:
 *  a slower validation of an older value never overtakes a newer one). */
export async function watchGame(id, cb) {
  if (!ID_RE.test(String(id || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    let seq = 0;
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/games/${id}`), (snap) => {
      const mine = ++seq;
      validateGame(snap && snap.exists() ? snap.val() : null).then((g) => {
        if (g && mine === seq) { g.id = id; cb(g); }
      }).catch((err) => console.warn('[chinchon] match watch', err));
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
  // Only people who may play online (js/online-gate.js): a made-up second account is never offered.
  try { return opponentsFrom(await readPlayersOnce(), myCode()).filter((r) => codeMayPlayOnline(r.code)); }
  catch (err) { console.warn('[chinchon] could not read the player list', err); return []; }
}

// --- writing ------------------------------------------------------------------------------------

/** The index row one person gets: what the match looks like from `side`. `lastBy` says whose write
 *  this is from that row's point of view, which is what the push function reads. */
function rowFor(game, side, writer) {
  const them = side === 'a' ? game.b : game.a;
  const life = lifeOf(game);
  // A called-off match is stored over:false / yourTurn:false with `ended` saying why, so a push
  // function (functions/decide.js) sends nothing for it. Every reader turns it back into a finished
  // row (rowsFromIndex, js/challenge-life.js rowEnding).
  const ended = isCalledOff(game) ? game.over.why : '';
  const mine = game.tally[side] || {};
  return {
    with: them.code, name: them.name, emoji: them.emoji,
    updated: game.updated,
    yourTurn: !game.over && game.turn === side,
    over: !!game.over && !ended,
    // Written on EVERY row write, so an answered challenge clears what its unanswered rows said.
    open: life.open ? (side === recipientOf(game) ? 'got' : 'sent') : '',
    expires: life.expires,
    ended,
    sent: side !== recipientOf(game),           // this row's owner sent the challenge
    mine: game.scores[side], theirs: game.scores[other(side)],
    round: game.round,
    kind: game.len,                              // the match length, for the Multiplayer screen's line
    cl: mine.closed | 0, cn: mine.chinchons | 0, m10: mine.minusTen | 0,
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
 * Start a challenge against `them` ({code, name, emoji}), `len` 'hand' | '50' | '100'. The
 * challenger is side 'a' and plays first; only their own row is written here (the other person's
 * arrives when the first turn passes, appendLog). Returns { ok, id, game } or a failure.
 */
export async function createGame({ them, len = 'hand' }) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return fail('no-player-code');
  if (!to || to === me) return fail('bad-opponent');
  // Both people must be allowed online (js/online-gate.js).
  const gate = onlineGate();
  if (gate) return fail(gate);
  if (!codeMayPlayOnline(to)) return fail('them-not-approved');
  if (!allowed('createGame')) return fail('dev-origin-blocked');
  if (!LENS.includes(len)) return fail('bad-len');
  const mine = meLabel();
  const now = Date.now();
  const id = mintGameId();
  const doc = {
    v: 1, id, len, seed: mintSeed(), rules: standardRules(), lapse: true, by: me, created: now, updated: now,
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
    const game = back && back.exists() ? await validateGame(back.val()) : null;
    if (!game) { console.error(`[chinchon] write VERIFY FAILED for ${NODE}/games/${id}`); return fail('did-not-land', true); }
    game.id = id;
    await writeRows(api, db, game, 'a', 'a');
    markSeen(id, game.updated);
    return { ok: true, id, game };
  } catch (err) {
    console.error('[chinchon] could not start the match', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * Append this player's decisions (`entries`) to the log, starting at `base` (the log length this
 * phone built them on). Idempotent: entries already there are not written twice, and a log that has
 * moved on differently is a conflict, never overwritten. The engine must accept every entry (a
 * replay) before anything is written. Rows are rewritten when the turn passes or the match ends.
 * Returns { ok, game } or a failure.
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
    const fresh = await readGame(id);
    if (!fresh) return fail('not-found', true);
    const side = sideOf(fresh, me);
    if (!side) return fail('not-your-game');
    if (list.some((e) => e.by !== side)) return fail('bad-entry');
    const have = fresh.log.length;
    // Already landed (a retry after a verify that timed out): nothing to write.
    let skip = 0;
    while (skip < list.length && base + skip < have && sameEntry(fresh.log[base + skip], list[skip])) skip++;
    if (base + skip !== have) return fail('moved-on');       // the log is not where we left it
    const todo = list.slice(skip);
    const turnBefore = fresh.turn;
    if (!todo.length) return { ok: true, game: fresh };
    if (fresh.over) return fail('already-over');
    // Nobody answered it for 3 days, so it lapsed (js/challenge-life.js): no move can revive it.
    if (lifeOf(fresh).expired) return fail('expired');
    // The rules must accept them before anything is written.
    const now = Date.now();
    const patch = { updated: now };
    todo.forEach((e, i) => { patch[`log/${String(have + i).padStart(4, '0')}`] = { ...e, at: now }; });
    const trial = await validateGame({ ...fresh, log: Object.fromEntries(fresh.log.concat(todo).map((e, i) => [String(i).padStart(4, '0'), e])), over: null });
    if (!trial || trial.log.length !== have + todo.length) return fail('rules-refused');
    if (trial.over) patch.over = { winner: trial.over.winner, why: trial.over.why, at: now };
    await api.update(api.ref(db, `${NODE}/games/${id}`), patch);
    const back = await readGame(id);
    if (!back || back.log.length !== have + todo.length) {
      console.error(`[chinchon] VERIFY FAILED for ${NODE}/games/${id}: expected ${have + todo.length} entries.`);
      return fail('did-not-land', true);
    }
    back.id = id;
    // The receiver's first move ANSWERS the challenge: the rows stop saying it is waiting (and can
    // no longer expire) at once, not only when their turn ends.
    const answered = lifeOf(fresh).open && !lifeOf(back).open;
    if (back.over || back.turn !== turnBefore || have === 0 || answered) await writeRows(api, db, back, side, back.over || back.turn !== side || answered ? null : side);
    // Only a FINISHED turn is "seen": a player who draws and leaves still owes the discard, so the
    // launcher keeps saying "Your turn" (chinchon/js/alert.js).
    if (back.over || back.turn !== side) markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[chinchon] could not send the move', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/**
 * CALL OFF a challenge its receiver has not answered (js/challenge-life.js): the sender CANCELS it,
 * the receiver DECLINES it. It counts for nobody, nobody is notified, nothing is deleted: the match
 * keeps its document and its log, and both rows say how it ended. Refused with 'accepted' once the
 * receiver has played; from then on the only way out is resignGame.
 */
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
      // Already called off (a retry after the rows did not land): write them again.
      if (!isCalledOff(fresh)) return fail('already-over');
    } else {
      if (!lifeOf(fresh).open) return fail('accepted');
      const now = Date.now();
      const why = side === recipientOf(fresh) ? 'declined' : 'cancelled';
      await api.update(api.ref(db, `${NODE}/games/${id}`), { over: { winner: 'none', why, at: now }, updated: now });
      back = await readGame(id);
      // validateGame voids a cancel that raced the receiver's first move: then the match plays on.
      if (!back) return fail('did-not-land', true);
      if (!isCalledOff(back)) return back.over ? fail('already-over') : fail('accepted');
    }
    back.id = id;
    const r = await api.get(api.ref(db, `${NODE}/index/${back[other(side)].code}/${id}`));
    await writeRows(api, db, back, side, r && r.exists() ? null : side);
    markSeen(id, back.updated);
    return { ok: true, game: back, cancelled: true };
  } catch (err) {
    console.error('[chinchon] could not call the challenge off', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

/** Give the match up: the other person wins, nothing is deleted. A challenge its receiver has not
 *  answered yet is CALLED OFF instead (cancelGame), and the result says { cancelled: true }. */
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
    const r = await api.get(api.ref(db, `${NODE}/index/${back[other(side)].code}/${id}`));
    await writeRows(api, db, back, side, r && r.exists() ? null : side);
    markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[chinchon] could not resign', err);
    const reason = reasonOf(err);
    return fail(reason, reason !== 'denied');
  }
}

// --- the offline outbox: a move made with no signal is KEPT and retried, never dropped -----------
export const OUTBOX_KEY = 'gamehub.chinchon.ch.outbox.v1';
function readOutbox() {
  try { const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeOutbox(q) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.slice(-40))); } catch (err) { console.error('[chinchon] outbox write failed', err); }
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
    else console.warn('[chinchon] dropping queued moves that can no longer be sent:', res.reason, item);
  }
  writeOutbox(left);
  return sent;
}
