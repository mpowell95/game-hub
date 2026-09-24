// skeeball/js/challenge.js - SKEEBALL CHALLENGES. "Beat my score."
//
// v1 (2026-09-24): one rack each, the higher score wins.
// v2 (2026-09-24, same day), Matt: "You should not get to try again. It's 1 attempt only. You
// should be able to challenge it series like in connect 4. There should be an option to do best of
// individual games and a total best score... I want an option to challenge someone to play all
// machines too." And: "I want it to send their score as is if they leave in the middle of a game."
//
// A CHALLENGE IS A LIST OF GAMES ("legs"), each one rack on one machine:
//   1, 3 or 5 games on one machine, or ALL MACHINES (one game on every machine both can play).
// SCORED one of two ways (only matters for more than one game):
//   'games'  most games won; a tied game counts for nobody; level on games -> higher total wins
//   'total'  highest combined score across every game
//
// THE ORDER (v3, 2026-09-24): TURNS ALTERNATE, ONE GAME PER TURN. Matt: "You have to alternate
// games - seeing each others scores." The challenger plays game 1 (stage 'a'); that delivers the
// challenge (the other person's index row is written, which notifies them); they play game 1
// seeing the score to beat; the challenger plays game 2 seeing the standings; and so on. Each turn
// gets 3 days. The match ends the moment it is decided - a best-of one side can no longer win - or
// when every game has been played by both (a total is only ever settled then).
//
// ONE ATTEMPT PER GAME, AND LEAVING COUNTS. A game is committed the moment its rack STARTS: an
// entry for it goes into this device's outbox (score 0) before the first ball, its running score
// is saved after every ball, and the entry is finalised when the rack ends, is walked out of, or -
// if the app was killed mid-rack - the next time Skeeball opens. There is no path back to a game
// that has an entry, and the server refuses a second score for any game. (Only a SECOND DEVICE
// that has never heard of the first one's attempt could play the same game again, and its score
// is refused if the first one's has already landed.)
//
// Same store shape as Connect 4 Hoops' turn-by-turn (hoops4/js/mp.js): addressed by PLAYER CODE,
// one index row per person, nothing ever deleted, every write verified by a fresh re-read (THE LAW
// rule 6). The racks themselves are ORDINARY racks, recorded by ui.js through recordSkeeball; the
// challenge adds nothing to gamehub.stats.
//
// `skeeChallenges` must be enumerated in database.rules.json and PUBLISHED by hand; until then
// every write fails softly with reason 'denied' and the screen says so.
import { getStatsApp } from '../../js/firebase-boot.js';
// Player codes, id minting and the per-CODE opponent list are Connect 4 Hoops' own, reused rather
// than copied (root CLAUDE.md, "USE WHAT EXISTS"). mp.js is pure at load: no side effects.
import { asCode, myCode, meLabel, mintGameId, opponentsFrom } from '../../hoops4/js/mp.js';

export { asCode, myCode, meLabel, opponentsFrom };

export const NODE = 'skeeChallenges';
export const EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_CAPTION = 120;
export const COUNTS = [1, 3, 5];
export const SCORINGS = ['games', 'total'];
export const MAX_LEGS = 12;
export const OUTBOX_KEY = 'gamehub.skeeball.challengeOutbox.v1';
export const SEEN_KEY = 'gamehub.skeeball.challengeSeen.v1';
const ID_RE = /^[a-z0-9]{6,24}$/;
const BOARD_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_SCORE = 100000;           // a ceiling against garbage, not a rule of the game

const ms = (v) => (Number.isFinite(+v) ? +v : 0);
const score = (v) => {
  if (v == null || v === '') return null;
  const n = Number.isFinite(+v) ? Math.round(+v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MAX_SCORE ? n : null;
};
const other = (side) => (side === 'a' ? 'b' : 'a');

/** Trim a caption to what a screen can hold. Never throws. */
export function cleanCaption(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_CAPTION);
}

// --- pure rules -------------------------------------------------------------------------------

/** One side's scores as an array the length of the legs, null where not played. */
export function scoresOf(game, side) {
  const n = game && Array.isArray(game.legs) ? game.legs.length : 0;
  const src = (game && game[side] && game[side].s) || {};
  return Array.from({ length: n }, (_, i) => score(src[i]));
}

/** Where the match stands. Only games BOTH sides have played count for wins. */
export function tally(game) {
  const A = scoresOf(game, 'a'); const B = scoresOf(game, 'b');
  const out = { n: A.length, aWins: 0, bWins: 0, aTotal: 0, bTotal: 0, both: 0 };
  for (let i = 0; i < A.length; i++) {
    if (A[i] != null) out.aTotal += A[i];
    if (B[i] != null) out.bTotal += B[i];
    if (A[i] != null && B[i] != null) {
      out.both++;
      if (A[i] > B[i]) out.aWins++; else if (B[i] > A[i]) out.bWins++;
    }
  }
  return out;
}

/**
 * Is it decided, and who took it? PURE. Only games BOTH sides have played count; a most-wins match
 * is settled early once one side cannot be caught. Returns { done, winner: 'a'|'b'|null }.
 */
export function decide(game) {
  const t = tally(game);
  const left = t.n - t.both;
  if (game.scoring === 'total') {
    // Turns alternate, so BOTH totals can still grow while games are left: a total is only
    // settled once every game has been played by both.
    if (left > 0) return { done: false, winner: null };
    // GUARD (2026-09-24): BOTH SIDES CAN WIN. v3 dropped v2's "b passes a" early exit and left this
    // line answering only 'a' or a draw, so every total the challenged player WON was stored as a
    // tie (Matt: King of Games 1790 vs 1250, "How is this a tie...?").
    return { done: true, winner: t.aTotal > t.bTotal ? 'a' : t.bTotal > t.aTotal ? 'b' : null };
  }
  if (t.bWins > t.aWins + left) return { done: true, winner: 'b' };
  if (t.aWins > t.bWins + left) return { done: true, winner: 'a' };
  if (left > 0) return { done: false, winner: null };
  if (t.aWins !== t.bWins) return { done: true, winner: t.aWins > t.bWins ? 'a' : 'b' };
  // Level on games: the higher total takes it, and only an exact tie on both is a draw.
  return { done: true, winner: t.aTotal > t.bTotal ? 'a' : t.bTotal > t.aTotal ? 'b' : null };
}

/** 'won' | 'lost' | 'draw' | null from one side's point of view. */
export function resultFor(game, side) {
  if (!game || !game.over || (side !== 'a' && side !== 'b')) return null;
  const w = game.over.winner;
  if (w !== 'a' && w !== 'b') return 'draw';
  return w === side ? 'won' : 'lost';
}

/**
 * WHOSE TURN IS NEXT, after `side` has just played (2026-09-24, v3). Matt: "You have to alternate
 * games - seeing each others scores." One game per turn: a1, b1, a2, b2 ... - the other side if it
 * has a game left to play, otherwise the same side (which also carries a v2 match, where the
 * challenger had already played everything, through to its end).
 */
export function nextStage(game, side) {
  const o = side === 'a' ? 'b' : 'a';
  if (scoresOf(game, o).some((x) => x == null)) return o;
  if (scoresOf(game, side).some((x) => x == null)) return side;
  return 'over';
}

/** The next game this side has to play, or -1. `played(i)` can veto a leg (this device's outbox). */
export function nextLeg(game, side, played = () => false) {
  if (!game || game.over || game.stage !== side) return -1;
  const mine = scoresOf(game, side);
  for (let i = 0; i < mine.length; i++) if (mine[i] == null && !played(i)) return i;
  return -1;
}

/** Has this unanswered challenge run out of time? Only a delivered one has a clock. */
export function isExpired(x, now = Date.now()) {
  return !!x && !x.over && ms(x.expires) > 0 && now >= ms(x.expires);
}

/** Build the legs for a new challenge. `count` is 1/3/5 on one board, or `all` for every board. */
export function makeLegs({ count = 1, all = false, board = null, boards = [] } = {}) {
  const pick = (b) => ({ board: String(b.id), boardName: String(b.name || '').slice(0, 40) });
  if (all) return boards.slice(0, MAX_LEGS).map(pick);
  const b = boards.find((x) => x.id === board) || boards[0];
  if (!b) return [];
  const n = COUNTS.includes(+count) ? +count : 1;
  return Array.from({ length: n }, () => pick(b));
}

/**
 * WHOLE-DOCUMENT REJECTION, the same call hoops4/js/mp.js made: a match that does not validate is
 * not shown at all rather than half-shown. Every field added later must be OPTIONAL here.
 *
 * A v1 document (one game, `a.score` / `b.score`, written for a few hours on 2026-09-24) is READ
 * as a one-game v2 challenge. Nothing stored is rewritten.
 */
export function validateChallenge(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = asCode(raw.a && raw.a.code);
  const b = asCode(raw.b && raw.b.code);
  if (!a || !b || a === b) return null;
  const who = (x) => ({ code: asCode(x.code), name: String(x.name || ''), emoji: String(x.emoji || '🙂') });
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  const created = ms(raw.created);
  let over = null;
  if (raw.over && typeof raw.over === 'object') {
    const w = raw.over.winner;
    if (w !== 'a' && w !== 'b' && w !== null && w !== undefined) return null;
    over = { winner: w == null ? null : w, at: ms(raw.over.at) };
  }
  const base = {
    id, by: asCode(raw.by) || a, created, updated: ms(raw.updated) || created,
    caption: cleanCaption(raw.caption), over,
  };

  if (raw.v !== 2) {
    // v1: one game.
    if (!BOARD_RE.test(String(raw.board || ''))) return null;
    const as = score(raw.a.score);
    if (as == null) return null;
    const bs = raw.b.score == null ? null : score(raw.b.score);
    if (raw.b.score != null && bs == null) return null;
    return {
      ...base, v: 2, scoring: 'games', all: false,
      legs: [{ board: String(raw.board), boardName: String(raw.boardName || '').slice(0, 40) }],
      expires: ms(raw.expires) || (created ? created + EXPIRE_MS : 0),
      stage: over ? 'over' : 'b',
      a: { ...who(raw.a), s: { 0: as } },
      b: { ...who(raw.b), s: bs == null ? {} : { 0: bs } },
    };
  }

  const srcLegs = Array.isArray(raw.legs) ? raw.legs
    : (raw.legs && typeof raw.legs === 'object') ? Object.keys(raw.legs).sort((x, y) => x - y).map((k) => raw.legs[k]) : [];
  if (!srcLegs.length || srcLegs.length > MAX_LEGS) return null;
  const legs = [];
  for (const l of srcLegs) {
    if (!l || !BOARD_RE.test(String(l.board || ''))) return null;
    legs.push({ board: String(l.board), boardName: String(l.boardName || '').slice(0, 40) });
  }
  const sides = {};
  for (const side of ['a', 'b']) {
    const src = (raw[side].s && typeof raw[side].s === 'object') ? raw[side].s : {};
    const s = {};
    for (const k of Object.keys(src)) {
      const i = +k;
      if (!Number.isInteger(i) || i < 0 || i >= legs.length) return null;
      if (src[k] == null) continue;
      const v = score(src[k]);
      if (v == null) return null;
      s[i] = v;
    }
    sides[side] = { ...who(raw[side]), s };
  }
  const stage = ['a', 'b', 'over'].includes(raw.stage) ? raw.stage : (over ? 'over' : 'a');
  // THE RESULT IS RE-DERIVED FROM THE SCORES, never trusted from the stored winner. Firebase drops a
  // null, so a draw and a missing winner look identical on disk - and matches finished while
  // decide() had its total bug (above) were stored with no winner at all. Nothing is rewritten.
  if (over) {
    const d = decide({ legs, scoring: SCORINGS.includes(raw.scoring) ? raw.scoring : 'games', a: sides.a, b: sides.b });
    if (d.done) over.winner = d.winner;
  }
  return {
    ...base, v: 2,
    scoring: SCORINGS.includes(raw.scoring) ? raw.scoring : 'games',
    all: !!raw.all, legs,
    expires: ms(raw.expires),
    stage: over ? 'over' : stage,
    a: sides.a, b: sides.b,
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

/** The index row one side gets: everything a list or a notification needs, without the match. */
export function rowFor(game, side) {
  const t = tally(game);
  const mine = side === 'a' ? game.a : game.b;
  const them = side === 'a' ? game.b : game.a;
  const my = scoresOf(game, side).filter((x) => x != null).length;
  return {
    with: them.code,
    name: them.name,
    emoji: them.emoji,
    n: game.legs.length,
    all: !!game.all,
    scoring: game.scoring,
    board: game.legs[0].board,
    boardName: game.all ? '' : game.legs[0].boardName,
    sent: side === 'a',
    stage: game.stage,
    updated: game.updated,
    expires: game.expires || 0,
    yourTurn: !game.over && game.stage === side,
    over: !!game.over,
    played: my,
    theirPlayed: scoresOf(game, side === 'a' ? 'b' : 'a').filter((x) => x != null).length,
    // Totals and games won, from this row's side. `theirs` is what a single game has to beat.
    mine: side === 'a' ? t.aTotal : t.bTotal,
    theirs: side === 'a' ? t.bTotal : t.aTotal,
    myWins: side === 'a' ? t.aWins : t.bWins,
    theirWins: side === 'a' ? t.bWins : t.aWins,
    ...(game.over ? { result: resultFor(game, side) } : {}),
  };
}

/** One index map, normalised and sorted: your turn first, then waiting on them, then done. */
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
      n: Math.max(1, ms(r.n) || 1),
      all: !!r.all,
      scoring: SCORINGS.includes(r.scoring) ? r.scoring : 'games',
      board: BOARD_RE.test(String(r.board || '')) ? String(r.board) : '',
      boardName: String(r.boardName || ''),
      sent: !!r.sent,
      updated: ms(r.updated),
      expires: ms(r.expires),
      yourTurn: !!r.yourTurn,
      over: !!r.over,
      played: ms(r.played),
      theirPlayed: ms(r.theirPlayed),
      mine: r.mine == null ? null : score(r.mine),
      theirs: r.theirs == null ? null : score(r.theirs),
      myWins: ms(r.myWins),
      theirWins: ms(r.theirWins),
      result: rowResult(r),
    });
  }
  return sortRows(rows);
}

/**
 * A finished row's result, worked out from its own numbers rather than its stored `result` (see the
 * GUARD in decide: some rows were stored as 'draw' when the other person had won). Most wins: games
 * won, then total. Total: total. Falls back to the stored value for a row without the numbers.
 */
export function rowResult(r) {
  if (!r || !r.over) return null;
  const mine = ms(r.mine); const theirs = ms(r.theirs);
  const cmp = (x, y) => (x > y ? 'won' : x < y ? 'lost' : 'draw');
  if (r.mine != null && r.theirs != null) {
    if (r.scoring === 'total') return cmp(mine, theirs);
    const w = cmp(ms(r.myWins), ms(r.theirWins));
    return w !== 'draw' ? w : cmp(mine, theirs);
  }
  return ['won', 'lost', 'draw'].includes(r.result) ? r.result : null;
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
  let map = readSeen();
  map[id] = Math.max(ms(map[id]), ms(updated) || Date.now());
  const keys = Object.keys(map);
  if (keys.length > MAX_SEEN) {
    const keep = keys.sort((x, y) => map[y] - map[x]).slice(0, MAX_SEEN);
    const trimmed = {};
    for (const k of keep) trimmed[k] = map[k];
    map = trimmed;
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

async function writeRows(api, db, game) {
  await api.update(api.ref(db, `${NODE}/index/${game.a.code}/${game.id}`), rowFor(game, 'a'));
  // The challenged player hears nothing until the challenger's FIRST game is in: writing their row
  // is the delivery, and every later turn flipping to them is what the notification watches.
  if (scoresOf(game, 'a').some((x) => x != null)) {
    await api.update(api.ref(db, `${NODE}/index/${game.b.code}/${game.id}`), rowFor(game, 'b'));
  }
}

/**
 * START A CHALLENGE, before the challenger's first rack. `them` is {code, name, emoji}; `legs`
 * from makeLegs. Only the challenger's own row is written.
 * Returns { ok:true, game } or { ok:false, reason }.
 */
export async function createChallenge({ them, legs, scoring = 'games', all = false, caption = '' } = {}) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return { ok: false, reason: 'no-player-code' };
  if (!to || to === me) return { ok: false, reason: 'bad-opponent' };
  if (!Array.isArray(legs) || !legs.length || legs.length > MAX_LEGS
    || !legs.every((l) => l && BOARD_RE.test(String(l.board || '')))) return { ok: false, reason: 'bad-challenge' };
  if (!writesAllowed('createChallenge')) return { ok: false, reason: 'dev-origin-blocked' };
  const mine = meLabel();
  const now = Date.now();
  const id = mintGameId();
  const doc = {
    v: 2, id, by: me, created: now, updated: now, expires: 0,
    scoring: SCORINGS.includes(scoring) ? scoring : 'games', all: !!all,
    legs: legs.map((l) => ({ board: String(l.board), boardName: String(l.boardName || '').slice(0, 40) })),
    caption: cleanCaption(caption),
    a: { code: me, name: mine.name, emoji: mine.emoji },
    b: { code: to, name: String((them && them.name) || ''), emoji: String((them && them.emoji) || '🙂') },
    stage: 'a', over: null,
  };
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline' };
    const { db, api } = boot;
    await api.set(api.ref(db, `${NODE}/games/${id}`), doc);
    const game = await readChallenge(id);
    if (!game) {
      console.error(`[skeeball] challenge VERIFY FAILED for ${NODE}/games/${id} - nothing landed.`);
      return { ok: false, reason: 'did-not-land' };
    }
    await writeRows(api, db, game);
    markSeen(id, game.updated);
    return { ok: true, game };
  } catch (err) {
    console.error('[skeeball] could not start the challenge', err);
    return { ok: false, reason: reasonOf(err) };
  }
}

/**
 * POST ONE GAME'S SCORE. The FIRST score for a game stands: a second one is refused (not
 * retryable). The challenger's last game delivers the challenge; each of the challenged player's
 * games is checked against `decide`, which ends the match the moment it is settled.
 * Returns { ok:true, game } or { ok:false, reason, retryable }.
 */
export async function postLeg(id, side, leg, sc) {
  const me = myCode();
  const s = score(sc);
  if (!me) return { ok: false, reason: 'no-player-code', retryable: false };
  if (s == null || (side !== 'a' && side !== 'b')) return { ok: false, reason: 'bad-score', retryable: false };
  if (!writesAllowed('postLeg')) return { ok: false, reason: 'dev-origin-blocked', retryable: false };
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline', retryable: true };
    const { db, api } = boot;
    const fresh = await readChallenge(id);
    if (!fresh) return { ok: false, reason: 'not-found', retryable: true };
    // RETRYABLE, deliberately: on a phone two players share, the outbox can hold the OTHER
    // player's score while this one is signed in. It must wait for them, never be dropped.
    if (sideOf(fresh, me) !== side) return { ok: false, reason: 'not-yours', retryable: true };
    if (fresh.over) return { ok: false, reason: 'already-over', retryable: false };
    if (fresh.stage !== side) return { ok: false, reason: 'not-your-turn', retryable: false };
    if (!Number.isInteger(leg) || leg < 0 || leg >= fresh.legs.length) return { ok: false, reason: 'bad-leg', retryable: false };
    if (scoresOf(fresh, side)[leg] != null) return { ok: false, reason: 'already-played', retryable: false };

    const now = Date.now();
    const next = { ...fresh, updated: now, [side]: { ...fresh[side], s: { ...fresh[side].s, [leg]: s } } };
    const patch = { updated: now, [`${side}/s/${leg}`]: s };
    // One game per turn. Settled -> over; otherwise the turn passes and gets its own 3 days.
    const d = decide(next);
    const stage = d.done ? 'over' : nextStage(next, side);
    if (stage === 'over') {
      patch.stage = 'over';
      patch.over = { winner: d.winner, at: now };   // every game played by both: decide() is done
    } else {
      patch.stage = stage;
      if (stage !== side) patch.expires = now + EXPIRE_MS;
    }
    await api.update(api.ref(db, `${NODE}/games/${id}`), patch);
    const back = await readChallenge(id);
    if (!back || scoresOf(back, side)[leg] !== s) {
      console.error(`[skeeball] score VERIFY FAILED for ${NODE}/games/${id} game ${leg + 1}.`);
      return { ok: false, reason: 'did-not-land', retryable: true };
    }
    await writeRows(api, db, back);
    markSeen(id, back.updated);            // our own write is never news to us
    return { ok: true, game: back };
  } catch (err) {
    console.error('[skeeball] could not post your score', err);
    const reason = reasonOf(err);
    return { ok: false, reason, retryable: reason !== 'denied' };
  }
}

// --- the outbox: every game ever started on this device -----------------------------------------
// [{ id, side, leg, score, final, at }]. An entry is written when a rack STARTS (score 0), updated
// after every ball, and finalised when the rack ends or is left. Only final entries are sent; an
// entry leaves once the server has the score, or has refused it for good. While an entry exists,
// that game cannot be started again on this device (legPlayed) - one attempt.
export function readOutbox() {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && ID_RE.test(String(x.id || ''))
      && (x.side === 'a' || x.side === 'b') && Number.isInteger(x.leg) && score(x.score) != null) : [];
  } catch { return []; }
}
function writeOutbox(list) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-40))); }
  catch (err) { console.error('[skeeball] could not save your challenge score on this device', err); }
}
// Keyed by SIDE as well: one phone shared by two players (a family phone) can hold both people's
// games of the same challenge, and neither may block or overwrite the other's.
const same = (x, id, side, leg) => x.id === id && x.side === side && x.leg === leg;

/** Has this side's game of this challenge been started on this device (and not yet confirmed sent)? */
export function legPlayed(id, side, leg) { return readOutbox().some((x) => same(x, id, side, leg)); }

/** Commit a game BEFORE its first ball. Returns false if it was already started: one attempt. */
export function beginLeg(id, side, leg) {
  if (!ID_RE.test(String(id || '')) || (side !== 'a' && side !== 'b') || !Number.isInteger(leg)) return false;
  const list = readOutbox();
  if (list.some((x) => same(x, id, side, leg))) return false;
  list.push({ id, side, leg, score: 0, final: false, at: Date.now() });
  writeOutbox(list);
  return true;
}

/** The running score, saved after every ball, so a killed app still counts what was thrown. */
export function saveLeg(id, side, leg, sc, final = false) {
  const s = score(sc);
  if (s == null) return false;
  const list = readOutbox();
  const e = list.find((x) => same(x, id, side, leg));
  if (!e || e.final) return false;
  e.score = s;
  if (final) e.final = true;
  writeOutbox(list);
  return true;
}

/** Any game left unfinished by a closed app is over: finalise it at the score it had. */
export function finalizeStale() {
  const list = readOutbox();
  let n = 0;
  for (const e of list) if (!e.final) { e.final = true; n++; }
  if (n) writeOutbox(list);
  return n;
}

/** This device's unsent scores laid over a match, so the screens show what was actually played. */
export function withLocal(game) {
  if (!game) return game;
  const g = { ...game, a: { ...game.a, s: { ...game.a.s } }, b: { ...game.b, s: { ...game.b.s } } };
  for (const e of readOutbox()) {
    if (e.id !== game.id || !g[e.side] || e.leg >= g.legs.length) continue;
    if (g[e.side].s[e.leg] == null) g[e.side].s[e.leg] = e.score;
  }
  return g;
}

let flushing = null;
/** Send every FINAL entry, oldest first. Returns { sent:[{id,leg,game}], refused:[{id,leg,reason}], failed }. */
export function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    const sent = []; const refused = []; let failed = 0;
    const todo = readOutbox().filter((x) => x.final).sort((x, y) => (x.at - y.at) || (x.leg - y.leg));
    for (const item of todo) {
      const res = await postLeg(item.id, item.side, item.leg, item.score);
      if (res.ok) sent.push({ id: item.id, side: item.side, leg: item.leg, game: res.game });
      else if (!res.retryable) {
        console.warn(`[skeeball] challenge ${item.id} game ${item.leg + 1} refused: ${res.reason}`);
        refused.push({ id: item.id, side: item.side, leg: item.leg, reason: res.reason });
      } else { failed++; continue; }
      writeOutbox(readOutbox().filter((x) => !same(x, item.id, item.side, item.leg)));
    }
    return { sent, refused, failed };
  })().finally(() => { flushing = null; });
  return flushing;
}
