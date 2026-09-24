// skeeball/js/challenge.js - SKEEBALL CHALLENGES (2026-09-24). "Beat my score."
//
// Matt: "what about skeeball? challenge someone to a game for the higher score?" ... "yes all that
// sounds good." One rack each, the higher score wins:
//
//   1. The challenger picks a person and a machine BOTH of them can already play, and plays a rack.
//   2. Only a FINISHED rack can be sent. Sending writes the match with the challenger's score in it
//      and one index row per person - the other person's row is what notifies them.
//   3. The other person sees the score to beat and plays one rack on that machine. Their score is
//      posted the moment the rack ends (finished OR walked out of - walking out is quitting, the
//      same rule as every other rack), and that write ends the match.
//   4. A challenge nobody answers EXPIRES after 3 days. Expiry is worked out on READ from the
//      `expires` stamp; nothing is written and nobody wins.
//
// THE SAME SHAPE AS CONNECT 4 HOOPS' TURN-BY-TURN (hoops4/js/mp.js), much smaller, because there
// are no turns to replay: a match is two numbers. Addressed by PLAYER CODE, never deviceId (several
// people here have two phones); one index row per person so "what do I have" is ONE read; nothing
// is ever deleted. Every write is verified by a fresh re-read (THE LAW rule 6).
//
// THE RACKS ARE ORDINARY RACKS. Both of them are recorded through recordSkeeball exactly as any
// other rack (ui.js), so they count for bests, averages, goals and unlocks. The challenge itself
// is NOT player history: it adds no counter to gamehub.stats and records no win or loss there.
//
// WHAT A PUSH DOES NOT DEPLOY: `skeeChallenges` is a new top-level node and the database root is
// deny-by-default, so it must be added in the console (database.rules.json, published BY HAND).
// Until it is, every call here fails softly with reason 'denied' and the screen says so.
import { getStatsApp } from '../../js/firebase-boot.js';
// Player codes, the id minting and the per-CODE opponent list are Connect 4 Hoops' own, reused
// rather than copied (root CLAUDE.md, "USE WHAT EXISTS"). mp.js is pure at load: no side effects.
import { asCode, myCode, meLabel, mintGameId, opponentsFrom } from '../../hoops4/js/mp.js';

export { asCode, myCode, meLabel, opponentsFrom };

export const NODE = 'skeeChallenges';
export const EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_CAPTION = 120;
export const OUTBOX_KEY = 'gamehub.skeeball.challengeOutbox.v1';
export const SEEN_KEY = 'gamehub.skeeball.challengeSeen.v1';
const ID_RE = /^[a-z0-9]{6,24}$/;
const BOARD_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_SCORE = 100000;           // a ceiling against garbage, not a rule of the game

const ms = (v) => (Number.isFinite(+v) ? +v : 0);
const score = (v) => {
  const n = Number.isFinite(+v) ? Math.round(+v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MAX_SCORE ? n : null;
};

/** Trim a caption to what a screen can hold. Never throws. */
export function cleanCaption(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_CAPTION);
}

// --- pure rules -------------------------------------------------------------------------------

/** 'a' | 'b' | null for a tie. `a` is the challenger. */
export function winnerOf(aScore, bScore) {
  const a = ms(aScore); const b = ms(bScore);
  return a > b ? 'a' : b > a ? 'b' : null;
}

/** 'won' | 'lost' | 'draw' | null from one side's point of view. */
export function resultFor(game, side) {
  if (!game || !game.over || (side !== 'a' && side !== 'b')) return null;
  const w = game.over.winner;
  if (w !== 'a' && w !== 'b') return 'draw';
  return w === side ? 'won' : 'lost';
}

/** Has this unanswered challenge run out of time? A finished one never expires. */
export function isExpired(x, now = Date.now()) {
  return !!x && !x.over && ms(x.expires) > 0 && now >= ms(x.expires);
}

/**
 * WHOLE-DOCUMENT REJECTION, the same call hoops4/js/mp.js made: a match that does not validate is
 * not shown at all rather than half-shown. Every field added later must be OPTIONAL here, or every
 * document already stored becomes unreadable.
 */
export function validateChallenge(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = asCode(raw.a && raw.a.code);
  const b = asCode(raw.b && raw.b.code);
  if (!a || !b || a === b) return null;
  const board = String(raw.board || '');
  if (!BOARD_RE.test(board)) return null;
  const aScore = score(raw.a.score);
  if (aScore == null) return null;             // a challenge is only ever sent with a score in it
  const bScore = raw.b.score == null ? null : score(raw.b.score);
  if (raw.b.score != null && bScore == null) return null;
  let over = null;
  if (raw.over && typeof raw.over === 'object') {
    const w = raw.over.winner;
    if (w !== 'a' && w !== 'b' && w !== null && w !== undefined) return null;
    over = { winner: w == null ? null : w, at: ms(raw.over.at) };
  }
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  const created = ms(raw.created);
  return {
    v: 1,
    id,
    by: asCode(raw.by) || a,
    created,
    updated: ms(raw.updated) || created,
    expires: ms(raw.expires) || (created ? created + EXPIRE_MS : 0),
    board,
    boardName: String(raw.boardName || '').slice(0, 40),
    caption: cleanCaption(raw.caption),
    a: { code: a, name: String(raw.a.name || ''), emoji: String(raw.a.emoji || '🙂'), score: aScore, at: ms(raw.a.at) },
    b: { code: b, name: String(raw.b.name || ''), emoji: String(raw.b.emoji || '🙂'), score: bScore, at: ms(raw.b.at) },
    over,
  };
}

/** Which side this player is on, or null. */
export function sideOf(game, code) {
  const me = asCode(code);
  if (!game || !me) return null;
  if (game.a.code === me) return 'a';
  if (game.b.code === me) return 'b';
  return null;
}

/** The index row one side gets. Everything a list or a notification needs, so neither reads the match. */
export function rowFor(game, side) {
  const mine = side === 'a' ? game.a : game.b;
  const them = side === 'a' ? game.b : game.a;
  return {
    with: them.code,
    name: them.name,
    emoji: them.emoji,
    board: game.board,
    boardName: game.boardName || '',
    sent: side === 'a',
    updated: game.updated,
    expires: game.expires,
    yourTurn: !game.over && side === 'b',
    over: !!game.over,
    mine: mine.score == null ? null : mine.score,
    theirs: them.score == null ? null : them.score,
    ...(game.over ? { result: resultFor(game, side) } : {}),
  };
}

/** One index map, normalised and sorted: waiting on you first, then waiting on them, then done. */
export function rowsFromIndex(val) {
  if (!val || typeof val !== 'object') return [];
  const rows = [];
  for (const id of Object.keys(val)) {
    const r = val[id] || {};
    const code = asCode(r.with);
    if (!ID_RE.test(id) || !code) continue;
    rows.push({
      id,
      with: code,
      name: String(r.name || ''),
      emoji: String(r.emoji || '🙂'),
      board: BOARD_RE.test(String(r.board || '')) ? String(r.board) : '',
      boardName: String(r.boardName || ''),
      sent: !!r.sent,
      updated: ms(r.updated),
      expires: ms(r.expires),
      yourTurn: !!r.yourTurn,
      over: !!r.over,
      mine: r.mine == null ? null : score(r.mine),
      theirs: r.theirs == null ? null : score(r.theirs),
      result: ['won', 'lost', 'draw'].includes(r.result) ? r.result : null,
    });
  }
  return sortRows(rows);
}

export function sortRows(rows, now = Date.now()) {
  const rank = (r) => (r.over ? 3 : isExpired(r, now) ? 4 : r.yourTurn ? 0 : 1);
  return (Array.isArray(rows) ? rows.slice() : []).sort((x, y) =>
    (rank(x) - rank(y)) || (ms(y.updated) - ms(x.updated)));
}

/** The rows a list shows, split. Pure. */
export function groupRows(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    toPlay: list.filter((r) => !r.over && r.yourTurn && !isExpired(r, now)),
    sent: list.filter((r) => !r.over && !r.yourTurn && !isExpired(r, now)),
    done: list.filter((r) => r.over || isExpired(r, now)),
  };
}

// --- the seen map (launcher bubble) -----------------------------------------------------------
// { [id]: the `updated` stamp acknowledged }. A one-tap-recreatable display flag (THE LAW rule 2's
// exemption): losing it shows a bubble twice, which is the harmless direction.
const MAX_SEEN = 200;
export function readSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const k of Object.keys(raw)) if (ms(raw[k])) out[k] = ms(raw[k]);
    return out;
  } catch { return {}; }
}
export function markSeen(id, updated) {
  if (!id) return;
  const map = readSeen();
  map[id] = Math.max(ms(map[id]), ms(updated) || Date.now());
  let keys = Object.keys(map);
  if (keys.length > MAX_SEEN) {
    keys = keys.sort((x, y) => map[y] - map[x]).slice(0, MAX_SEEN);
    const trimmed = {};
    for (const k of keys) trimmed[k] = map[k];
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed)); } catch { /* shows again */ }
    return;
  }
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch { /* shows again */ }
}

// --- a dev server never writes to the family's database ---------------------------------------
// The same guard and opt-in key as js/stats-net.js, js/messages.js and hoops4/js/mp.js.
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function writesAllowed(what) {
  let dev = false;
  try {
    const h = String(location.hostname || '').toLowerCase();
    dev = h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch { dev = false; }
  if (!dev) return true;
  try { if (localStorage.getItem(DEV_SYNC_OK) === '1') return true; } catch { /* fall through */ }
  console.warn(`[skeeball] ${what} BLOCKED: dev origin, and dev never writes to the family database. `
    + `To allow it in this browser: localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}

async function ready() {
  try { return await getStatsApp(); } catch { return null; }
}
function reasonOf(err) {
  const s = String((err && (err.code || err.message)) || err);
  return /permission|PERMISSION_DENIED/i.test(s) ? 'denied' : s;
}

// --- reading ----------------------------------------------------------------------------------

/** Every challenge this player has, from their own index. ONE read; [] offline or when denied. */
export async function readMyChallenges() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    const snap = await boot.api.get(boot.api.ref(boot.db, `${NODE}/index/${me}`));
    return rowsFromIndex(snap && snap.exists() ? snap.val() : null);
  } catch (err) {
    console.warn('[skeeball] could not read your challenges', err);
    return [];
  }
}

/** LIVE: `cb(rows)` on every change to this player's index. Returns an unsubscribe. Never throws. */
export async function watchMyChallenges(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const stop = boot.api.onValue(boot.api.ref(boot.db, `${NODE}/index/${me}`), (snap) => {
      try { cb(rowsFromIndex(snap && snap.exists() ? snap.val() : null)); }
      catch (err) { console.warn('[skeeball] challenge-list callback', err); }
    }, () => { /* denied or dropped: keep what was last shown */ });
    return () => { try { stop(); } catch { /* already detached */ } };
  } catch { return () => {}; }
}

/** One match, validated. null when missing, unreadable or invalid. */
export async function readChallenge(id) {
  if (!ID_RE.test(String(id || ''))) return null;
  try {
    const boot = await ready();
    if (!boot) return null;
    const snap = await boot.api.get(boot.api.ref(boot.db, `${NODE}/games/${id}`));
    if (!snap || !snap.exists()) return null;
    const g = validateChallenge(snap.val());
    if (!g) { console.error(`[skeeball] ${NODE}/games/${id} did not validate; refusing to open it.`); return null; }
    g.id = id;
    return g;
  } catch (err) {
    console.warn('[skeeball] could not read that challenge', err);
    return null;
  }
}

// --- writing ----------------------------------------------------------------------------------

/**
 * SEND A CHALLENGE, carrying the challenger's finished rack. `them` is {code, name, emoji}.
 * Returns { ok:true, game } or { ok:false, reason }.
 */
export async function sendChallenge({ them, board, boardName = '', score: sc, caption = '' } = {}) {
  const me = myCode();
  const to = asCode(them && them.code);
  const s = score(sc);
  if (!me) return { ok: false, reason: 'no-player-code' };
  if (!to || to === me) return { ok: false, reason: 'bad-opponent' };
  if (!BOARD_RE.test(String(board || '')) || s == null) return { ok: false, reason: 'bad-challenge' };
  if (!writesAllowed('sendChallenge')) return { ok: false, reason: 'dev-origin-blocked' };
  const mine = meLabel();
  const now = Date.now();
  const id = mintGameId();
  const doc = {
    v: 1, id, by: me, created: now, updated: now, expires: now + EXPIRE_MS,
    board: String(board), boardName: String(boardName || '').slice(0, 40), caption: cleanCaption(caption),
    a: { code: me, name: mine.name, emoji: mine.emoji, score: s, at: now },
    b: { code: to, name: String((them && them.name) || ''), emoji: String((them && them.emoji) || '🙂') },
    over: null,
  };
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline' };
    const { db, api } = boot;
    await api.set(api.ref(db, `${NODE}/games/${id}`), doc);
    // VERIFY BY FRESH RE-READ before either index points at it (rule 6).
    const game = await readChallenge(id);
    if (!game) {
      console.error(`[skeeball] challenge VERIFY FAILED for ${NODE}/games/${id} - nothing landed.`);
      return { ok: false, reason: 'did-not-land' };
    }
    // Our row first: if theirs then fails, the sender can still see what they sent.
    await api.update(api.ref(db, `${NODE}/index/${game.a.code}/${id}`), rowFor(game, 'a'));
    await api.update(api.ref(db, `${NODE}/index/${game.b.code}/${id}`), rowFor(game, 'b'));
    markSeen(id, game.updated);              // our own challenge is never news to us
    return { ok: true, game };
  } catch (err) {
    console.error('[skeeball] could not send the challenge', err);
    return { ok: false, reason: reasonOf(err) };
  }
}

/**
 * ANSWER ONE: post the challenged player's score and end the match. Refused (not retryable) when
 * it is not theirs, already answered, or the score is not a score.
 * Returns { ok:true, game } or { ok:false, reason, retryable }.
 */
export async function answerChallenge(id, sc) {
  const me = myCode();
  const s = score(sc);
  if (!me) return { ok: false, reason: 'no-player-code', retryable: false };
  if (s == null) return { ok: false, reason: 'bad-score', retryable: false };
  if (!writesAllowed('answerChallenge')) return { ok: false, reason: 'dev-origin-blocked', retryable: false };
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline', retryable: true };
    const { db, api } = boot;
    const fresh = await readChallenge(id);
    if (!fresh) return { ok: false, reason: 'not-found', retryable: true };
    if (sideOf(fresh, me) !== 'b') return { ok: false, reason: 'not-yours', retryable: false };
    if (fresh.over || fresh.b.score != null) return { ok: false, reason: 'already-over', retryable: false };
    const now = Date.now();
    await api.update(api.ref(db, `${NODE}/games/${id}`), {
      updated: now,
      'b/score': s, 'b/at': now,
      over: { winner: winnerOf(fresh.a.score, s), at: now },
    });
    const back = await readChallenge(id);
    if (!back || !back.over || back.b.score !== s) {
      console.error(`[skeeball] answer VERIFY FAILED for ${NODE}/games/${id}.`);
      return { ok: false, reason: 'did-not-land', retryable: true };
    }
    await api.update(api.ref(db, `${NODE}/index/${back.a.code}/${id}`), rowFor(back, 'a'));
    await api.update(api.ref(db, `${NODE}/index/${back.b.code}/${id}`), rowFor(back, 'b'));
    markSeen(id, back.updated);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[skeeball] could not post your score', err);
    const reason = reasonOf(err);
    return { ok: false, reason, retryable: reason !== 'denied' };
  }
}

// --- the outbox: an answered rack is never lost to a bad signal --------------------------------
// The score is written HERE, synchronously, the instant the rack ends - before any network call -
// so walking out of the game, losing signal or closing the app cannot drop it. It is sent from
// here and removed only once the server has it (or has refused it for good).
export function readOutbox() {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && ID_RE.test(String(x.id || '')) && score(x.score) != null) : [];
  } catch { return []; }
}
function writeOutbox(list) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-20))); }
  catch (err) { console.error('[skeeball] could not save your challenge score on this device', err); }
}

/** Queue one answer. Keeps the FIRST score queued for a challenge: one rack, one answer. */
export function queueAnswer(id, sc) {
  const s = score(sc);
  if (!ID_RE.test(String(id || '')) || s == null) return false;
  const list = readOutbox();
  if (list.some((x) => x.id === id)) return false;
  list.push({ id, score: s, at: Date.now() });
  writeOutbox(list);
  return true;
}

/** Is an answer to this challenge already waiting on this device? */
export function isQueued(id) { return readOutbox().some((x) => x.id === id); }

let flushing = null;
/** Send everything queued. Returns { sent: [{id, game}], refused: [{id, reason}], failed }. Never throws; one at a time. */
export function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    const sent = []; const refused = []; let failed = 0;
    for (const item of readOutbox()) {
      const res = await answerChallenge(item.id, item.score);
      if (res.ok) sent.push({ id: item.id, game: res.game });
      else if (!res.retryable) {
        console.warn(`[skeeball] queued answer to ${item.id} refused: ${res.reason}`);
        refused.push({ id: item.id, reason: res.reason });
      } else { failed++; continue; }
      writeOutbox(readOutbox().filter((x) => x.id !== item.id));
    }
    return { sent, refused, failed };
  })().finally(() => { flushing = null; });
  return flushing;
}
