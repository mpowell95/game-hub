// shove-off/js/match.js - KNOCKOUT'S MATCH DOCUMENT, PURE (2026-11-25). Moved out of mp.js unchanged so the
// SERVER (functions/shoveoff.js, copied in by tools/sync-functions-shared.mjs) validates, replays and writes
// rows with EXACTLY the phone's code. Imports only the pure engine and the pure challenge rules; no clock
// (every `now` is passed in), no storage, no network. mp.js re-exports all of it.
//
// SEALED ROUNDS (2026-11-25, the review: "Online aims can be read before they are revealed"). A match made
// from today carries `sv: 1`. Its players never write their aims into the public log: each round's aims go to
// `shoveoffSealed/<id>/r<round>/<side>` (readable only by that side's own code, admins and the reader key),
// and the match gets only a public marker `sealed/r<round>/<side>: <server time>` (so "your turn" / "waiting"
// still work). When BOTH sides of a round are sealed, the server (functions/shoveoff.js) appends both entries
// to the log, in the order they were sealed, exactly the `{ by, r, aims, at }` an older match holds, so every
// replay, validateGame, the private log and the push function work unchanged. A match WITHOUT `sv` (made
// before 2026-11-25) keeps the old path: aims straight into the log (THE LAW: it plays exactly as it did).
import { newMatch, applyAims, owes, aliveCount, tally, DRAW, asPs } from './engine.js';
import { isNoResult, expiresAt, forfeitAt, callOffCosts } from '../../js/challenge-life.js';

export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
export const ID_RE = /^[a-z0-9]{6,24}$/;
export const MAX_LOG = 200;            // 30 rounds + 10 sudden death, two entries each, with room to spare
export const SV = 1;                   // the sealed-rounds version every NEW match is made with
export const LOOK_IDS = ['sumo0', 'sumo1', 'car0', 'car1', 'puck0', 'puck1'];
export const asLook = (v) => (LOOK_IDS.includes(v) ? v : 'sumo0');
export const ms = (v) => (Number.isFinite(+v) ? +v : 0);
export const other = (s) => (s === 'a' ? 'b' : 'a');
/** The key a round goes under in `sealed/` and `shoveoffSealed/<id>/` ('r' + round: a bare number key would
 *  come back from Firebase as an array). */
export const roundKey = (r) => `r${r | 0}`;

export function asCode(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return CODE_RE.test(s) ? s : null;
}

// --- the log --------------------------------------------------------------------------------------
export function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.by !== 'a' && e.by !== 'b') return null;
  const r = +e.r;
  if (!Number.isInteger(r) || r < 1 || r > 999) return null;
  if (typeof e.aims !== 'string' || e.aims.length > 120) return null;
  return { by: e.by, r, aims: e.aims, at: ms(e.at) };
}

/** Replay a log into an engine match under rules version `rv` (absent = 1: every match made before
 *  2026-11-18's circle replays as it always did). `upto` entries; `frames` asks the LAST resolved round for
 *  its picture (the UI's animation). Returns the match, or null if an entry does not replay. */
export function replay(log, upto = log.length, framesFor = -1, frames = null, rv = 1, ps = 0) {
  const m = newMatch(rv, ps);
  for (let i = 0; i < upto; i++) {
    const e = log[i];
    if (!applyAims(m, e.by, e.r, e.aims, i === framesFor ? frames : null)) return null;
  }
  return m;
}
/** Replay a game (or a computer save): its own log under its own rules version. */
export function replayGame(g, upto = null, framesFor = -1, frames = null) {
  return replay(g.log, upto == null ? g.log.length : upto, framesFor, frames, rvOf(g), psOf(g));
}
/** A document's rules version: absent = 1 (the first rules), 2 = the circle. Anything else is not a match. */
export function rvOf(raw) {
  const v = raw && raw.rv;
  return v == null ? 1 : v === 2 ? 2 : 0;
}
/** A document's start seed (2026-11-25, random start spots): absent = 0, the fixed spots. A bad one: -1 (not a match). */
export function psOf(raw) {
  const v = raw && raw.ps;
  return v == null ? 0 : asPs(v) || -1;
}
/** A document's sealing: absent = 0 (aims straight into the log), 1 = sealed rounds. Anything else: null. */
export function svOf(raw) {
  const v = raw && raw.sv;
  return v == null ? 0 : v === SV ? SV : null;
}

/** Who went first: the challenger (`by`) is side 'a' unless a document says otherwise. */
const recipientOfRaw = (aCode, bCode, by) => (by && by === bCode && by !== aCode ? 'a' : 'b');
export const winnerOf = (m) => (m.winner === DRAW ? 'draw' : m.winner);

/** The public markers of the round being played: { a: <time sealed>|0, b: ... }, only for a side that still
 *  owes it in the log (a marker for a round already in the log, or any other round, means nothing). */
function marksFor(raw, m) {
  const out = { a: 0, b: 0 };
  if (m.winner != null) return out;
  const all = raw.sealed && typeof raw.sealed === 'object' ? raw.sealed : null;
  const cur = all && all[roundKey(m.round)];
  if (!cur || typeof cur !== 'object') return out;
  const ow = owes(m);
  for (const s of ['a', 'b']) if (ow[s] && ms(cur[s]) > 0) out[s] = ms(cur[s]);
  return out;
}

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
  const rv = rvOf(raw);
  if (!rv) return null;
  const sv = svOf(raw);
  if (sv == null) return null;
  const ps = psOf(raw);
  if (ps < 0) return null;
  const m = newMatch(rv, ps);
  for (const k of keys) {
    const e = cleanEntry(src[k]);
    if (!e) return null;
    if (!applyAims(m, e.by, e.r, e.aims)) return null;
    log.push(e);
  }
  const sealed = sv ? marksFor(raw, m) : { a: 0, b: 0 };
  let over = null;
  const to = recipientOfRaw(a, b, asCode(raw.by));
  const calledOff = !!raw.over && typeof raw.over === 'object' && raw.over.winner === 'none';
  if (calledOff && !isNoResult(String(raw.over.why || ''))) return null;
  if (calledOff && !log.some((e) => e.by === to) && !sealed[to]) {
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
  const eng = over ? { a: false, b: false } : owes(m);
  const ow = { a: eng.a && !sealed.a, b: eng.b && !sealed.b };
  return {
    v: 1, id,
    ...(rv === 2 ? { rv } : {}),
    ...(ps ? { ps } : {}),
    ...(sv ? { sv, sealed: over ? { a: 0, b: 0 } : sealed, resolving: !over && eng.a && eng.b && !!sealed.a && !!sealed.b } : {}),
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

export function sideOf(game, code) {
  const me = asCode(code);
  if (!game || !me) return null;
  if (game.a.code === me) return 'a';
  if (game.b.code === me) return 'b';
  return null;
}
export function recipientOf(game) { return game ? recipientOfRaw(game.a.code, game.b.code, game.by) : 'b'; }
/** Has `side` sent anything: an entry in the log, or (a sealed match) this round sealed. */
export function hasSent(game, side) { return !!game && (game.log.some((e) => e.by === side) || !!(game.sealed && game.sealed[side])); }
/** Has the challenger played anything yet? From then on a cancel or decline is a loss for whoever does it. */
export function senderPlayed(game) { return !!game && hasSent(game, other(recipientOf(game))); }
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

/** PURE. { open, waiting, expires, expired, turnAt, forfeits } at `now`. open = not over and the receiver has
 *  sent nothing; waiting = open and delivered (the challenger has sent round 1); expires = when a waiting
 *  challenge lapses (3 days). Answered: whoever still owes the round's aims 7 days after it began loses
 *  (both still owing = a draw by timeout). A sealed round counts as sent. */
export function lifeOf(game, now) {
  if (!game || game.over) return { open: false, waiting: false, expires: 0, expired: false, turnAt: 0, forfeits: 0 };
  const to = recipientOf(game);
  const open = !hasSent(game, to);
  const waiting = open && hasSent(game, other(to));
  const expires = expiresAt(game.lapse, waiting, game.updated);
  const turnAt = open ? 0 : roundStart(game, now);
  return { open, waiting, expires, expired: expires > 0 && now >= expires, turnAt, forfeits: open ? 0 : forfeitAt(turnAt) };
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
  return { on: 1, look: game[s].look, them: game[other(s)].look, first: recipientOf(game) === s ? 'them' : 'me', sd: game.sd > 0 ? 1 : 0, ...(rvOf(game) === 2 ? { rv: 2 } : {}), ...(psOf(game) > 0 ? { rs: 1 } : {}) };
}
/** The match's numbers: rounds played, their pieces knocked off, own pieces lost, sudden-death rounds. */
export function detailOfGame(game, side) {
  const s = side === 'b' ? 'b' : 'a';
  const m = replayGame(game);
  if (!m) return { rounds: 0 };
  const tl = tally(m);
  return { rounds: m.rounds.length, kos: tl[other(s)].lost, lost: tl[s].lost, sdr: m.sdr, end: (game.over && game.over.why) || '' };
}

/** The index row one person gets, at `now`. `lastBy` says whose write this is from that row's point of view
 *  (what the push function reads). Carries the mode and detail so a count from the list has them. */
export function rowFor(game, side, writer, now) {
  const them = side === 'a' ? game.b : game.a;
  const life = lifeOf(game, now);
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

// --- the server's half of a sealed round (functions/shoveoff.js runs it; pure so tests run it too) ----
/**
 * REVEAL A SEALED ROUND. `raw` = the match document as stored, `sealed` = `shoveoffSealed/<id>/r<round>`
 * as stored ({ a: { aims, at }, b: ... }), `r` = the round those entries are for, `now` = server time.
 * When every side that still owes round `r` has a sealed entry, returns the NEW document (both entries
 * appended to the log in the order they were sealed, `updated`, and `over` exactly as a phone sets it when
 * the replay decides the match), the validated game and the side whose seal completed the round
 * (`writer`, for the rows' `lastBy`). Otherwise { skip: <why> } and nothing is written.
 */
export function revealSealed(raw, sealed, r, now) {
  const g = validateGame(raw);
  if (!g) return { skip: 'invalid' };
  if (!g.sv) return { skip: 'not-sealed' };
  if (g.over) return { skip: 'over' };
  if (r !== g.round) return { skip: 'moved-on' };
  const m = replayGame(g);
  if (!m) return { skip: 'invalid' };
  const ow = owes(m);
  const need = ['a', 'b'].filter((s) => ow[s]);
  if (!need.length) return { skip: 'nothing-owed' };
  const src = sealed && typeof sealed === 'object' ? sealed : {};
  const add = [];
  for (const s of need) {
    const x = src[s];
    const e = x && typeof x === 'object' ? cleanEntry({ by: s, r, aims: x.aims, at: x.at }) : null;
    if (!e) return { skip: 'waiting' };
    add.push(e);
  }
  // The order they were sealed (a tie: 'a' first). Fixed once written: both phones replay the log in key order.
  add.sort((x, y) => (x.at - y.at) || (x.by < y.by ? -1 : 1));
  for (const e of add) if (!applyAims(m, e.by, e.r, e.aims)) return { skip: 'rules-refused' };
  const doc = JSON.parse(JSON.stringify(raw));
  doc.log = doc.log && typeof doc.log === 'object' ? doc.log : {};
  let have = g.log.length;
  for (const e of add) {
    const k = String(have++).padStart(4, '0');
    if (doc.log[k] !== undefined) return { skip: 'log-key-taken' };
    doc.log[k] = { by: e.by, r: e.r, aims: e.aims, at: e.at };
  }
  doc.updated = now;
  if (m.winner != null) doc.over = { winner: winnerOf(m), why: m.end || 'off', at: now };
  const game = validateGame(doc);
  if (!game || game.log.length !== g.log.length + add.length) return { skip: 'did-not-replay' };
  if (g.id || raw.id) game.id = g.id || raw.id;
  return { doc, game, writer: add[add.length - 1].by, added: add.length };
}
