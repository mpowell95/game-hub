// hoops4/js/mp.js - CONNECT 4 HOOPS, turn by turn. The store for a match two people play hours
// or days apart, one shot at a time.
//
// THE LAW applies. Nothing here is a player's earned history - a match is a match, not a record -
// but the writes still follow rule 6: every one is VERIFIED by a fresh re-read before it is
// reported as sent, and a move that cannot be sent is QUEUED on the device rather than dropped
// with an apology (rule 2's spirit: a turn somebody actually took is not something to lose).
//
// WHY THIS IS NOT js/net.js. `rooms/<CODE>` is a LIVE room: it has a heartbeat, a 24-hour TTL on
// joining, and it assumes both people are looking at the screen. A turn-by-turn match is the
// opposite of all three. It is the shape of js/messages.js instead:
//
//   - ADDRESSED BY PLAYER CODE, never by deviceId. Several people here have two phones, and a
//     match addressed to a device would be playable on one of them and invisible on the other.
//   - AN INDEX ROW PER PERSON, so "what games do I have" is ONE read no matter how many exist.
//   - NOTHING IS EVER DELETED. A finished match keeps its move list and both index rows.
//
// WHAT IT NEEDS THAT IS NOT DEPLOYED BY A PUSH: `hoops` is a new top-level node, and since the
// messages work the database's root is `.read: false / .write: false` with every branch
// enumerated in `database.rules.json`. **That file is published BY HAND** (console -> Realtime
// Database -> Rules -> paste -> Publish); no script in this repo deploys it. Until it is
// published, every call below fails softly - `readMyGames()` returns [], `createGame()` returns
// `{ ok:false, reason:'denied' }` - and the screen says so rather than hanging. Live multiplayer
// (js/net.js, `rooms/`) is unaffected and needs no rules change.
import { getStatsApp } from '../../js/firebase-boot.js';
import { loadProfile } from '../../js/profile-store.js';
import { readPlayersOnce } from '../../js/stats-net.js';
import { aggregatePlayers, isPlaceholderName } from '../../js/players-agg.js';
import { COLS, ROWS } from './game.js';

export const OUTBOX_KEY = 'gamehub.hoops4.outbox.v1';
export const MAX_OUTBOX = 20;
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
const ID_RE = /^[a-z0-9]{6,24}$/;
// 42 discs is all a board can hold, but the log also carries the MISSES that passed a turn under
// one-shot, and a miss is cheap. 600 is a ceiling against a runaway writer, not a rule of the game.
const MAX_MOVES = 600;

const ms = (v) => (Number.isFinite(+v) ? +v : 0);

/** A player code, or null. The same 5-character alphabet js/net.js and js/messages.js use. */
export function asCode(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return CODE_RE.test(s) ? s : null;
}

/** This device's player code, from the shared profile. */
export function myCode() {
  try { const p = loadProfile(); return asCode(p && p.playerId); } catch { return null; }
}

/** This player's name and emoji, for the copy that lands on the other person's index row. */
export function meLabel() {
  try { const p = loadProfile() || {}; return { name: p.name || '', emoji: p.emoji || '🙂' }; }
  catch { return { name: '', emoji: '🙂' }; }
}

/**
 * A game id. Time-ordered so a listing sorts sensibly even before anything has an `updated`, plus
 * eight random characters so two devices minting in the same millisecond cannot collide.
 *
 * EIGHT, not four, and that is measured rather than chosen: `test-hoops4-mp.mjs` mints 1000 ids
 * in a tight loop - all in the same millisecond, so the time half is a constant - and at four
 * characters it got 999 distinct ones. 36^4 is 1.7 million, and the birthday bound over 1000 draws
 * is about a third of a collision expected, so that was not bad luck. A collision is two people's
 * matches sharing a node.
 */
export function mintGameId() {
  const t = Date.now().toString(36);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  try {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    for (const b of buf) r += alphabet[b % 36];
  } catch {
    // No crypto (an old browser, or a node run without one): Math.random still gives 36^8.
    for (let i = 0; i < 8; i++) r += alphabet[(Math.random() * 36) | 0];
  }
  return t + r;
}

// --- a dev server never writes to the family's database ---------------------------------------
// The same guard and the same opt-in key as js/stats-net.js and js/messages.js. A localhost
// session verifying this screen must not be able to start a real match with somebody. Reads stay
// on: a list with nothing in it cannot be checked.
const DEV_SYNC_OK = 'gamehub.devAllowSync.v1';
function isDevOrigin() {
  try {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
      || h.endsWith('.localhost');
  } catch { return false; }
}
function writesAllowed(what) {
  if (!isDevOrigin()) return true;
  try { if (localStorage.getItem(DEV_SYNC_OK) === '1') return true; } catch { /* fall through */ }
  console.warn(`[hoops4] ${what} BLOCKED: this is a dev origin (${location.hostname}) and dev never `
    + `writes to the family database. To allow it in this browser: `
    + `localStorage.setItem('${DEV_SYNC_OK}', '1')`);
  return false;
}

async function ready() {
  try { return await getStatsApp(); } catch { return null; }
}

// --- validation -------------------------------------------------------------------------------

/**
 * WHOLE-DOCUMENT REJECTION, deliberately, the same call js/career-store.js made. A half-accepted
 * match is worse than none: a move list with one bad entry silently replays into a different
 * position on the two devices, and then the two people are looking at different boards with
 * nothing on screen saying so. Anything that does not validate is not a match.
 */
export function validateGame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = asCode(raw.a && raw.a.code);
  const b = asCode(raw.b && raw.b.code);
  if (!a || !b || a === b) return null;
  if (raw.turn !== 'a' && raw.turn !== 'b') return null;

  // TWO KINDS OF ENTRY, and the log needs both to REPLAY EXACTLY on the other device.
  //   a landed shot  { by, col, shots }  - `shots` is how many it took, so a replay can charge
  //                                        the shooter the misses that came before it
  //   a passed miss  { by, miss: true }  - only under one-shot, where a miss hands the turn over.
  //                                        Under shoot-until-you-make-it a miss changes nothing
  //                                        the other person can see, so it is never sent.
  const moves = [];
  const src = raw.moves && typeof raw.moves === 'object' ? raw.moves : {};
  for (const key of Object.keys(src).sort()) {
    const m = src[key];
    if (!m || typeof m !== 'object') return null;
    if (m.by !== 'a' && m.by !== 'b') return null;
    if (m.miss) { moves.push({ by: m.by, col: null, miss: true, shots: 1, at: ms(m.at) }); continue; }
    const col = +m.col;
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return null;
    moves.push({ by: m.by, col, miss: false, shots: Math.max(1, ms(m.shots) || 1), at: ms(m.at) });
  }
  if (moves.length > MAX_MOVES) return null;

  let over = null;
  if (raw.over && typeof raw.over === 'object') {
    const w = raw.over.winner;
    if (w !== 'a' && w !== 'b' && w !== null && w !== undefined) return null;
    over = { winner: w == null ? null : w, why: String(raw.over.why || 'four'), at: ms(raw.over.at) };
  }
  return {
    v: 1,
    id: typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null,
    created: ms(raw.created),
    updated: ms(raw.updated),
    oneShot: !!raw.oneShot,
    a: { code: a, name: String((raw.a && raw.a.name) || ''), emoji: String((raw.a && raw.a.emoji) || '🙂') },
    b: { code: b, name: String((raw.b && raw.b.name) || ''), emoji: String((raw.b && raw.b.emoji) || '🙂') },
    turn: raw.turn,
    moves,
    over,
  };
}

/** Which side of `game` this player is, or null if it is not their match. */
export function sideOf(game, code) {
  const me = asCode(code);
  if (!game || !me) return null;
  if (game.a.code === me) return 'a';
  if (game.b.code === me) return 'b';
  return null;
}

/** Is it this player's move? A finished match is nobody's. */
export function isMyTurn(game, code) {
  if (!game || game.over) return false;
  return sideOf(game, code) === game.turn;
}

/** The other side's label, for "waiting on Anita". */
export function otherLabel(game, code) {
  const side = sideOf(game, code);
  const them = side === 'a' ? game.b : game.a;
  return them || { code: null, name: '', emoji: '🙂' };
}

/** How many of a listing's games are waiting on this player. What a launcher badge would count. */
export function countMyTurns(rows, code) {
  const me = asCode(code);
  if (!me || !Array.isArray(rows)) return 0;
  return rows.filter((r) => r && !r.over && r.yourTurn).length;
}

/** Newest first, with the ones waiting on you at the top and finished ones at the bottom. */
export function sortRows(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort((x, y) => {
    if (!!x.over !== !!y.over) return x.over ? 1 : -1;
    if (!x.over && !!x.yourTurn !== !!y.yourTurn) return x.yourTurn ? -1 : 1;
    return ms(y.updated) - ms(x.updated);
  });
}

// --- reading ----------------------------------------------------------------------------------

/** Every match this player has, from their own index. ONE read. [] when offline or not allowed. */
export async function readMyGames() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    const { db, api } = boot;
    const snap = await api.get(api.ref(db, `hoops/index/${me}`));
    const val = (snap && snap.exists()) ? snap.val() : null;
    if (!val || typeof val !== 'object') return [];
    return sortRows(Object.keys(val).map((id) => {
      const r = val[id] || {};
      return {
        id,
        with: asCode(r.with),
        name: String(r.name || ''),
        emoji: String(r.emoji || '🙂'),
        updated: ms(r.updated),
        yourTurn: !!r.yourTurn,
        over: !!r.over,
        oneShot: !!r.oneShot,
      };
    }).filter((r) => ID_RE.test(r.id) && r.with));
  } catch (err) {
    console.warn('[hoops4] could not read your games', err);
    return [];
  }
}

/** One match, validated. null when it is missing, unreadable or does not validate. */
export async function readGame(id) {
  if (!ID_RE.test(String(id || ''))) return null;
  try {
    const boot = await ready();
    if (!boot) return null;
    const { db, api } = boot;
    const snap = await api.get(api.ref(db, `hoops/games/${id}`));
    if (!snap || !snap.exists()) return null;
    const game = validateGame(snap.val());
    if (!game) { console.error(`[hoops4] hoops/games/${id} did not validate; refusing to open it.`); return null; }
    game.id = id;
    return game;
  } catch (err) {
    console.warn('[hoops4] could not read that game', err);
    return null;
  }
}

/** Who can be challenged: every synced player who is not this device's own. */
export async function readOpponents() {
  const me = myCode();
  try {
    const all = await readPlayersOnce();
    return aggregatePlayers(all)
      .filter((r) => r && asCode(r.playerId) && asCode(r.playerId) !== me && !isPlaceholderName(r.name))
      .map((r) => ({ code: asCode(r.playerId), name: r.name, emoji: r.emoji || '🙂' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn('[hoops4] could not read the player list', err);
    return [];
  }
}

// --- writing ----------------------------------------------------------------------------------

/** The index row both people get. `update`, never `set`, wherever a row already exists. */
function rowFor(game, side) {
  const them = side === 'a' ? game.b : game.a;
  return {
    with: them.code,
    name: them.name,
    emoji: them.emoji,
    updated: game.updated,
    yourTurn: !game.over && game.turn === side,
    over: !!game.over,
    oneShot: !!game.oneShot,
  };
}

/** Write both index rows for a game. Best effort per row, so one failure cannot strand the other
 *  person with a match they can see and this one with nothing. */
async function writeRows(api, db, game) {
  await api.update(api.ref(db, `hoops/index/${game.a.code}/${game.id}`), rowFor(game, 'a'));
  await api.update(api.ref(db, `hoops/index/${game.b.code}/${game.id}`), rowFor(game, 'b'));
}

/**
 * Start a match against `them` ({code, name, emoji}). The challenger is side 'a' and shoots first,
 * which is also RED on the board - so "you challenged, you go first" needs no extra field.
 *
 * Returns { ok:true, id, game } or { ok:false, reason, retryable }.
 */
export async function createGame({ them, oneShot = false } = {}) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return { ok: false, reason: 'no-player-code', retryable: false };
  if (!to || to === me) return { ok: false, reason: 'bad-opponent', retryable: false };
  if (!writesAllowed('createGame')) return { ok: false, reason: 'dev-origin-blocked', retryable: false };

  const mine = meLabel();
  const now = Date.now();
  const id = mintGameId();
  const doc = {
    v: 1, id, created: now, updated: now, oneShot: !!oneShot,
    a: { code: me, name: mine.name, emoji: mine.emoji },
    b: { code: to, name: String(them.name || ''), emoji: String(them.emoji || '🙂') },
    turn: 'a', moves: null, over: null,
  };
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline', retryable: true };
    const { db, api } = boot;
    await api.set(api.ref(db, `hoops/games/${id}`), doc);
    // VERIFY BY FRESH RE-READ before either index points at it (rule 6). An index row pointing at
    // a match that is not there opens an empty board, which reads as data loss.
    const back = await api.get(api.ref(db, `hoops/games/${id}`));
    const game = back && back.exists() ? validateGame(back.val()) : null;
    if (!game) {
      console.error(`[hoops4] write VERIFY FAILED for hoops/games/${id} - nothing landed.`);
      return { ok: false, reason: 'did-not-land', retryable: true };
    }
    game.id = id;
    await writeRows(api, db, game);
    return { ok: true, id, game };
  } catch (err) {
    console.error('[hoops4] could not start the game', err);
    return { ok: false, reason: reasonOf(err), retryable: retryableOf(err) };
  }
}

/**
 * Append one MOVE and hand the turn over.
 *
 * `move` is `{ col, shots }` - a ball that went through a hoop. A miss is not sent: under
 * shoot-until-you-make-it it changes nothing, and under one-shot the turn flip is implied by
 * `passed`, which the caller sets. That keeps the wire format the same in both modes and means a
 * match can never be desynced by a miss going astray.
 *
 * `over` is `{ winner:'a'|'b'|null, why }` when this move ended it, or null.
 *
 * The append is `set` at a padded sequence key derived from the CURRENT move count, re-read from
 * the server rather than from the local copy: two moves can never share a key, and a stale local
 * copy cannot overwrite the other person's move.
 */
export async function pushMove(id, { col, shots = 1, passed = false, over = null } = {}) {
  const me = myCode();
  if (!me) return { ok: false, reason: 'no-player-code', retryable: false };
  if (!writesAllowed('pushMove')) return { ok: false, reason: 'dev-origin-blocked', retryable: false };
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline', retryable: true };
    const { db, api } = boot;
    const fresh = await readGame(id);
    if (!fresh) return { ok: false, reason: 'not-found', retryable: true };
    const side = sideOf(fresh, me);
    if (!side) return { ok: false, reason: 'not-your-game', retryable: false };
    if (fresh.over) return { ok: false, reason: 'already-over', retryable: false };
    if (fresh.turn !== side) return { ok: false, reason: 'not-your-turn', retryable: false };

    const now = Date.now();
    const other = side === 'a' ? 'b' : 'a';
    const patch = { updated: now };
    const landed = Number.isInteger(col) && col >= 0 && col < COLS;
    const key = String(fresh.moves.length).padStart(4, '0');
    if (landed) {
      await api.set(api.ref(db, `hoops/games/${id}/moves/${key}`), {
        by: side, col, shots: Math.max(1, ms(shots) || 1), at: now,
      });
    } else if (passed) {
      // A one-shot miss IS an entry. Without it the other device replays a log in which this
      // player never shot, and the two boards disagree about whose turn it is from then on.
      await api.set(api.ref(db, `hoops/games/${id}/moves/${key}`), { by: side, miss: true, at: now });
    }
    if (landed || passed) patch.turn = other;
    if (over) patch.over = { winner: over.winner == null ? null : over.winner, why: String(over.why || 'four'), at: now };
    await api.update(api.ref(db, `hoops/games/${id}`), patch);

    const back = await readGame(id);
    if (!back) {
      console.error(`[hoops4] move VERIFY FAILED for hoops/games/${id} - could not read it back.`);
      return { ok: false, reason: 'did-not-land', retryable: true };
    }
    if ((landed || passed) && back.moves.length !== fresh.moves.length + 1) {
      console.error(`[hoops4] move VERIFY FAILED for hoops/games/${id}: ${fresh.moves.length} -> `
        + `${back.moves.length} moves, expected ${fresh.moves.length + 1}.`);
      return { ok: false, reason: 'did-not-land', retryable: true };
    }
    await writeRows(api, db, back);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[hoops4] could not send the move', err);
    return { ok: false, reason: reasonOf(err), retryable: retryableOf(err) };
  }
}

/** Give the match up. The other person wins; nothing is deleted. */
export async function resignGame(id) {
  const me = myCode();
  if (!me) return { ok: false, reason: 'no-player-code', retryable: false };
  if (!writesAllowed('resignGame')) return { ok: false, reason: 'dev-origin-blocked', retryable: false };
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline', retryable: true };
    const { db, api } = boot;
    const fresh = await readGame(id);
    if (!fresh) return { ok: false, reason: 'not-found', retryable: true };
    const side = sideOf(fresh, me);
    if (!side) return { ok: false, reason: 'not-your-game', retryable: false };
    if (fresh.over) return { ok: true, game: fresh };
    const now = Date.now();
    await api.update(api.ref(db, `hoops/games/${id}`), {
      over: { winner: side === 'a' ? 'b' : 'a', why: 'resign', at: now }, updated: now,
    });
    const back = await readGame(id);
    if (!back || !back.over) return { ok: false, reason: 'did-not-land', retryable: true };
    await writeRows(api, db, back);
    return { ok: true, game: back };
  } catch (err) {
    console.error('[hoops4] could not resign', err);
    return { ok: false, reason: reasonOf(err), retryable: retryableOf(err) };
  }
}

/** A Firebase permission failure is NOT retryable and must not sit in the outbox forever: it
 *  means `database.rules.json` has not been published yet, which no amount of retrying fixes. */
function reasonOf(err) {
  const s = String((err && (err.code || err.message)) || err);
  return /permission|PERMISSION_DENIED/i.test(s) ? 'denied' : s;
}
function retryableOf(err) { return reasonOf(err) !== 'denied'; }

// --- the offline outbox -------------------------------------------------------------------------
// A turn taken on a phone with no signal is KEPT and retried, not lost with an apology. Same shape
// as js/messages.js's and js/bug-report.js's, and drained from the same place: the next time this
// screen opens.

function readOutbox() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed && parsed.queue) ? parsed.queue : [];
  } catch { return []; }
}
function writeOutbox(queue) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify({ version: 1, queue: queue.slice(-MAX_OUTBOX) })); }
  catch (err) { console.error('[hoops4] could not update the outbox', err); }
}
export function outboxCount() { return readOutbox().length; }
export function queueMove(id, move) {
  try { writeOutbox(readOutbox().concat([{ id, move }])); return true; }
  catch (err) { console.error('[hoops4] could not queue the move', err); return false; }
}

/** Try everything waiting. Anything still failing for a retryable reason stays queued; a move that
 *  can never succeed (not your turn any more, the match is over) is dropped rather than retried
 *  forever. Returns how many were sent. */
export async function drainOutbox() {
  const queue = readOutbox();
  if (!queue.length) return 0;
  const left = [];
  let sent = 0;
  for (const item of queue) {
    const res = await pushMove(item.id, item.move);
    if (res.ok) sent += 1;
    else if (res.retryable) left.push(item);
    else console.warn('[hoops4] dropping an unsendable queued move:', res.reason);
  }
  writeOutbox(left);
  if (sent) console.info(`[hoops4] sent ${sent} move(s) that were waiting on this device.`);
  return sent;
}

/**
 * REPLAY a match's move log into a fresh `Match`, so the board on this phone is the board on the
 * other one. It is the only way an async match has a position at all - nothing snapshots the
 * board, because a move list is the thing that cannot silently go wrong: if it replays, it
 * replays identically, and if it does not, `validateGame` refused it before we got here.
 *
 * `shots` is what makes the ACCURACY line honest: a landed move that took three shots charges the
 * shooter two misses first, exactly as the shooter's own device did.
 */
export function replay(match, game) {
  for (const m of game.moves) {
    if (m.miss) { match.miss(); continue; }
    for (let i = 1; i < m.shots; i++) match.miss();
    match.land(m.col);
    if (match.over) break;
  }
  return match;
}

export default {
  asCode, myCode, meLabel, mintGameId, validateGame, replay, sideOf, isMyTurn, otherLabel,
  countMyTurns, sortRows, readMyGames, readGame, readOpponents,
  createGame, pushMove, resignGame, outboxCount, queueMove, drainOutbox,
};
