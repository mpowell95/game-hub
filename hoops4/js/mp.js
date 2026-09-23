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
// A SERIES IS 1, 3 OR 5 GAMES. Matt: "if you want to play a single game, best of 3 series or best
// of 5 series." Only odd lengths, so a series always has a winner.
export const SERIES_LENGTHS = [1, 3, 5];
// What the challenger can say with the challenge. Matt: "Maybe include a caption option thing
// where you can say something to your opponent with the challenge request thing?"
export const MAX_CAPTION = 120;

/** Trim a caption to something a screen can hold. Never throws; always returns a string. */
export function cleanCaption(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, MAX_CAPTION);
}

// --- quick chat inside a match (2026-09-22) -------------------------------------------------------
// Matt's playtest list asked for it alongside the series and the caption. A chat line is the SAME
// tiny `{ t, v }` payload every other multiplayer game in the hub sends (js/mp-reactions.js):
//   t:'e' an emoji, t:'p' a preset phrase id, t:'c' a short free-text line.
// The receiver resolves a preset to ITS OWN language, so Anita reads "¡Bien!" when Matt tapped
// "Nice!". On a turn-by-turn match it is stored at `hoops/games/<id>/chat/<key>` as
// `{ by:'a'|'b', t, v, at }`.
//
// CHAT IS NOT PART OF THE MATCH. It never touches `moves`, `turn`, `over`, `updated` or either
// index row, so it cannot move the replay, the turn, the outbox or the launcher alert. And it is
// OPTIONAL in the strongest sense: every match written before it existed has no `chat` at all,
// and a malformed chat entry is DROPPED, never allowed to refuse the match - `validateGame`'s
// whole-document rejection exists to protect the REPLAY, and chat is not in the replay.
export const CHAT_MAXLEN = 24;      // the same cap js/mp-reactions.js puts on a custom line
export const MAX_CHAT = 40;         // how many a validated match carries (the newest)
const CHAT_TYPES = ['e', 'p', 'c'];

/** Trim a free-text chat line to what a bubble can hold. Never throws; always a string. */
export function cleanChat(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, CHAT_MAXLEN);
}

/**
 * The chat on a raw match document, cleaned: oldest first, the newest `MAX_CHAT` only, and every
 * entry that is not a well-formed `{ by, t, v, at }` DROPPED rather than rejected. Pure.
 */
export function chatFrom(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  for (const key of Object.keys(raw)) {
    const c = raw[key];
    if (!c || typeof c !== 'object') continue;
    if (c.by !== 'a' && c.by !== 'b') continue;
    if (!CHAT_TYPES.includes(c.t)) continue;
    const v = c.t === 'c' ? cleanChat(c.v) : String(c.v == null ? '' : c.v).slice(0, CHAT_MAXLEN);
    if (!v) continue;
    out.push({ key, by: c.by, t: c.t, v, at: ms(c.at) });
  }
  out.sort((x, y) => (x.at - y.at) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return out.slice(-MAX_CHAT);
}

/** The other side's chat lines newer than `seenAt` - what "since you were last here" shows. */
export function unseenChat(chat, side, seenAt) {
  const since = ms(seenAt);
  return (Array.isArray(chat) ? chat : []).filter((c) => c && c.by !== side && c.at > since);
}

/** How many games one side must win to take a series of `len`. 1 -> 1, 3 -> 2, 5 -> 3. */
export function seriesTarget(len) {
  const n = SERIES_LENGTHS.includes(+len) ? +len : 1;
  return (n + 1) / 2;
}

/**
 * Where a series stands AFTER this game, given its result. PURE, so the rules are testable
 * without a database.
 *
 * `wins` is what each side had won BEFORE this game; `winner` is this game's ('a', 'b' or null
 * for a draw). Returns the running total, whether the series is finished, and who took it.
 */
export function seriesAfter(game) {
  const len = SERIES_LENGTHS.includes(+(game && game.series)) ? +game.series : 1;
  const before = (game && game.seriesWins) || { a: 0, b: 0 };
  const w = game && game.over ? game.over.winner : undefined;
  const wins = {
    a: (before.a | 0) + (w === 'a' ? 1 : 0),
    b: (before.b | 0) + (w === 'b' ? 1 : 0),
  };
  const target = seriesTarget(len);
  const champion = wins.a >= target ? 'a' : wins.b >= target ? 'b' : null;
  // A DRAW COSTS THE SERIES A GAME AND GIVES NOBODY ANYTHING, so a series of drawn boards has to
  // end rather than run for ever. `no` is this game's number; once it reaches `len` we are done
  // whatever the score - the leader takes it, and a dead tie is an honest draw.
  const no = Math.max(1, (game && game.seriesNo) | 0 || 1);
  const exhausted = no >= len;
  const done = !!champion || exhausted;
  return {
    len, no, wins, target, done,
    winner: champion || (exhausted && wins.a !== wins.b ? (wins.a > wins.b ? 'a' : 'b') : null),
  };
}

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
/**
 * ALREADY EXPORTED, and worth keeping so: returning null here is a REFUSAL TO OPEN THE MATCH, so
 * every field added to this shape afterwards has to be OPTIONAL or every document already in the
 * database becomes unplayable. `test-hoops4-mp.mjs` pins that with a hand-written pre-series
 * document.
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
  // THE SERIES FIELDS ARE OPTIONAL AND DEFAULT TO A SINGLE GAME. Every match document written
  // before they existed has none of them, and `validateGame` returning null is a REFUSAL TO OPEN
  // THE MATCH - so a required field here would have made every match in the database unplayable
  // the moment this shipped. Defaults, never rejections.
  const series = SERIES_LENGTHS.includes(+raw.series) ? +raw.series : 1;
  const sw = (raw.seriesWins && typeof raw.seriesWins === 'object') ? raw.seriesWins : {};
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : null;
  return {
    v: 1,
    id,
    created: ms(raw.created),
    updated: ms(raw.updated),
    oneShot: !!raw.oneShot,
    series,
    seriesNo: Math.min(series, Math.max(1, ms(raw.seriesNo) || 1)),
    seriesWins: { a: Math.max(0, ms(sw.a)), b: Math.max(0, ms(sw.b)) },
    // A single game is its own series, so `seriesOf` is always a usable grouping key.
    seriesOf: (typeof raw.seriesOf === 'string' && ID_RE.test(raw.seriesOf)) ? raw.seriesOf : id,
    caption: cleanCaption(raw.caption),
    a: { code: a, name: String((raw.a && raw.a.name) || ''), emoji: String((raw.a && raw.a.emoji) || '🙂') },
    b: { code: b, name: String((raw.b && raw.b.name) || ''), emoji: String((raw.b && raw.b.emoji) || '🙂') },
    turn: raw.turn,
    moves,
    over,
    // OPTIONAL, and never a reason to refuse the match: see `chatFrom`.
    chat: chatFrom(raw.chat),
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
// --- "have I already seen this?" ---------------------------------------------------------------
// The launcher's seen map (read by hoops4/js/alert.js). It lives HERE, not in alert.js, because
// this module's own writes have to stamp it: Matt, 2026-09-23, having sent the King of Games a
// challenge: "once i sent it and went back to the hub, the popup appeared saying the king of games
// challenged me. but he didn't." The alert called ANY match id this device had never seen "a
// challenge", including the one this device had just created. So every write this device makes to
// a match - creating it, a move, a resignation - acknowledges it here, and only the OTHER person's
// writes can ever raise the bubble. A one-tap-recreatable preference (THE LAW rule 2's exemption):
// losing it shows a bubble twice, which is the harmless direction.
export const SEEN_KEY = 'gamehub.hoops4.seen.v1';
const MAX_SEEN = 200;

/** The seen map: { [gameId]: the `updated` stamp that was acknowledged }. Never throws. */
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
    // Oldest acknowledgements go first. A dropped entry re-shows one bubble; it loses nothing.
    if (keys.length > MAX_SEEN) {
      keys = keys.sort((a, b) => map[b] - map[a]).slice(0, MAX_SEEN);
      const trimmed = {};
      for (const k of keys) trimmed[k] = map[k];
      map = trimmed;
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch { /* private mode: the bubble simply shows again, which is the safe direction */ }
}

/** Acknowledge one match up to `updated`, so its bubble stops until something new happens. */
export function markSeen(id, updated) {
  if (!id) return;
  const map = readSeen();
  map[id] = Math.max(ms(map[id]), ms(updated) || Date.now());
  writeSeen(map);
}

/** One index row, normalised - shared by the one-off read and the live watch. */
function rowsFromIndex(val) {
  if (!val || typeof val !== 'object') return [];
  return sortRows(Object.keys(val).map((id) => {
    const r = val[id] || {};
    return {
      id,
      with: asCode(r.with),
      name: String(r.name || ''),
      emoji: String(r.emoji || '\u{1F642}'),
      updated: ms(r.updated),
      yourTurn: !!r.yourTurn,
      over: !!r.over,
      oneShot: !!r.oneShot,
      series: Math.max(1, ms(r.series) || 1),
      seriesNo: Math.max(1, ms(r.seriesNo) || 1),
      seriesOf: typeof r.seriesOf === 'string' && ID_RE.test(r.seriesOf) ? r.seriesOf : id,
      // OPTIONAL, and ABSENT on every finished row written before the history screen existed
      // (2026-09-22). `recordsFrom` works out an old row's result from its match instead.
      result: RESULTS.includes(r.result) ? r.result : null,
      why: typeof r.why === 'string' ? r.why : '',
    };
  }).filter((r) => ID_RE.test(r.id) && r.with));
}

/**
 * WATCH YOUR MATCH LIST LIVE (2026-09-23). Matt: "If i'm in the hub and someone plays me back,
 * will I see? or would i have to leave and come back for it to fetch?" He would have had to come
 * back: the launcher asked once per paint. This is a READ-ONLY listener on hoops/index/<you>, so
 * a challenge or a returned turn reaches the launcher the moment it is written. Returns an
 * unsubscribe that is always safe to call.
 */
export async function watchMyGames(cb) {
  const me = myCode();
  if (!me) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const { db, api } = boot;
    const stop = api.onValue(api.ref(db, `hoops/index/${me}`), (snap) => {
      try { cb(rowsFromIndex(snap && snap.exists() ? snap.val() : null)); }
      catch (err) { console.warn('[hoops4] match-list callback', err); }
    }, () => { /* denied or dropped: the launcher keeps what it last showed */ });
    return () => { try { stop(); } catch { /* already detached */ } };
  } catch { return () => {}; }
}

export async function readMyGames() {
  const me = myCode();
  if (!me) return [];
  try {
    const boot = await ready();
    if (!boot) return [];
    const { db, api } = boot;
    const snap = await api.get(api.ref(db, `hoops/index/${me}`));
    return rowsFromIndex((snap && snap.exists()) ? snap.val() : null);
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
    // Enough to write "Game 2 of 3" on the list without reading the match itself.
    series: game.series | 0 || 1,
    seriesNo: game.seriesNo | 0 || 1,
    seriesOf: game.seriesOf || game.id,
    // THE RESULT FROM THIS ROW'S OWN SIDE, once the match is over - what the history screen
    // counts. ADDED 2026-09-22 and OPTIONAL: rows written before it have none, and `recordsFrom`
    // falls back to the match itself for those. Only set when there is something to say, so an
    // `update` on an unfinished match never writes a field it does not need.
    ...(game.over ? { result: resultOf(game, side), why: String(game.over.why || 'four') } : {}),
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
export async function createGame({ them, oneShot = false, series = 1, caption = '',
  seriesNo = 1, seriesWins = null, seriesOf = null, first = 'me' } = {}) {
  const me = myCode();
  const to = asCode(them && them.code);
  if (!me) return { ok: false, reason: 'no-player-code', retryable: false };
  if (!to || to === me) return { ok: false, reason: 'bad-opponent', retryable: false };
  if (!writesAllowed('createGame')) return { ok: false, reason: 'dev-origin-blocked', retryable: false };

  const mine = meLabel();
  const now = Date.now();
  const id = mintGameId();
  // SIDE 'a' SHOOTS FIRST AND IS RED. `first` is what lets game 2 of a series start with the
  // OTHER person: it puts them on side 'a' instead, so "you challenged, you go first" stays true
  // of a challenge while a series still alternates.
  const meSide = first === 'me' ? 'a' : 'b';
  const seats = {
    [meSide]: { code: me, name: mine.name, emoji: mine.emoji },
    [meSide === 'a' ? 'b' : 'a']: { code: to, name: String(them.name || ''), emoji: String(them.emoji || '🙂') },
  };
  const len = SERIES_LENGTHS.includes(+series) ? +series : 1;
  const doc = {
    v: 1, id, created: now, updated: now, oneShot: !!oneShot,
    series: len,
    seriesNo: Math.min(len, Math.max(1, seriesNo | 0 || 1)),
    seriesWins: { a: Math.max(0, (seriesWins && seriesWins.a) | 0), b: Math.max(0, (seriesWins && seriesWins.b) | 0) },
    seriesOf: (typeof seriesOf === 'string' && ID_RE.test(seriesOf)) ? seriesOf : id,
    caption: cleanCaption(caption),
    a: seats.a, b: seats.b,
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
    markSeen(id, game.updated);          // this device made it: never "a challenge" here
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
    markSeen(id, back && back.updated);  // our own move is not news to us
    return { ok: true, game: back };
  } catch (err) {
    console.error('[hoops4] could not send the move', err);
    return { ok: false, reason: reasonOf(err), retryable: retryableOf(err) };
  }
}

/** Give the match up. The other person wins; nothing is deleted. */
/**
 * START THE NEXT GAME OF A SERIES, from a finished one. Either player may do it; whoever taps
 * first creates it, and the other sees it appear in their list.
 *
 * NOT AUTOMATIC, ON PURPOSE. Creating it inside the finishing device's `pushMove` would mean a
 * series silently stalls whenever that person happened to be offline at that moment - a failure
 * with nobody looking at it. A button has somebody in front of it, and `createGame` already
 * returns a reason it can say out loud.
 *
 * THE SIDES SWAP. Side 'a' shoots first, so alternating who holds it is the only thing that stops
 * a best-of-3 being "the challenger shoots first, three times".
 */
export async function nextInSeries(game) {
  const me = myCode();
  if (!game || !game.over) return { ok: false, reason: 'not-over', retryable: false };
  const side = sideOf(game, me);
  if (!side) return { ok: false, reason: 'not-your-game', retryable: false };
  const st = seriesAfter(game);
  if (st.done) return { ok: false, reason: 'series-over', retryable: false };
  const them = side === 'a' ? game.b : game.a;
  return createGame({
    them,
    oneShot: !!game.oneShot,
    series: st.len,
    seriesNo: st.no + 1,
    seriesWins: st.wins,
    seriesOf: game.seriesOf || game.id,
    // Whoever did NOT shoot first last time shoots first now. This device is `side`; if it was
    // 'a' it went first, so the next game hands 'a' to the other person.
    first: side === 'a' ? 'them' : 'me',
  });
}

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
    markSeen(id, back && back.updated);  // our own move is not news to us
    return { ok: true, game: back };
  } catch (err) {
    console.error('[hoops4] could not resign', err);
    return { ok: false, reason: reasonOf(err), retryable: retryableOf(err) };
  }
}

// --- quick chat: the write and the watch -----------------------------------------------------------

/**
 * Say something in a turn-by-turn match. `payload` is `{ t, v }` (see `chatFrom`). ANY time, not
 * only on your turn - the point of chat is the other person's turn - and on a finished match too.
 *
 * ADDITIVE: one new child at a fresh time-ordered key, never a `set` over `chat` itself, so two
 * people typing at once cannot overwrite each other. It touches NOTHING else on the match - not
 * `updated`, not either index row - so a chat line can never flip the launcher's "your turn"
 * alert, move the turn, or reach the move outbox. VERIFIED by a fresh re-read of that one key
 * (THE LAW rule 6). There is no outbox for chat: a line that does not land is reported as not
 * sent, and the player can tap it again.
 */
export async function sendChat(id, payload) {
  const me = myCode();
  if (!me) return { ok: false, reason: 'no-player-code', retryable: false };
  if (!ID_RE.test(String(id || ''))) return { ok: false, reason: 'not-found', retryable: false };
  const t = payload && CHAT_TYPES.includes(payload.t) ? payload.t : null;
  const raw = payload && payload.v != null ? payload.v : '';
  const v = t === 'c' ? cleanChat(raw) : String(raw).slice(0, CHAT_MAXLEN);
  if (!t || !v) return { ok: false, reason: 'empty', retryable: false };
  if (!writesAllowed('sendChat')) return { ok: false, reason: 'dev-origin-blocked', retryable: false };
  try {
    const boot = await ready();
    if (!boot) return { ok: false, reason: 'offline', retryable: true };
    const { db, api } = boot;
    const game = await readGame(id);
    if (!game) return { ok: false, reason: 'not-found', retryable: true };
    const side = sideOf(game, me);
    if (!side) return { ok: false, reason: 'not-your-game', retryable: false };
    const at = Date.now();
    const key = mintGameId() + side;
    const entry = { by: side, t, v, at };
    await api.set(api.ref(db, `hoops/games/${id}/chat/${key}`), entry);
    const back = await api.get(api.ref(db, `hoops/games/${id}/chat/${key}`));
    const got = back && back.exists() ? back.val() : null;
    if (!got || got.v !== v || got.by !== side) {
      console.error(`[hoops4] chat VERIFY FAILED for hoops/games/${id}/chat/${key} - nothing landed.`);
      return { ok: false, reason: 'did-not-land', retryable: true };
    }
    return { ok: true, entry: { key, ...entry } };
  } catch (err) {
    console.error('[hoops4] could not send the chat line', err);
    return { ok: false, reason: reasonOf(err), retryable: retryableOf(err) };
  }
}

/** Watch one match's chat while it is on screen. READ ONLY. Calls `cb(chat)` with the cleaned
 *  list (`chatFrom`) on every change; returns an unsubscribe that is always safe to call. */
export async function watchChat(id, cb) {
  if (!ID_RE.test(String(id || ''))) return () => {};
  try {
    const boot = await ready();
    if (!boot || typeof boot.api.onValue !== 'function') return () => {};
    const { db, api } = boot;
    const stop = api.onValue(api.ref(db, `hoops/games/${id}/chat`), (snap) => {
      try { cb(chatFrom(snap && snap.exists() ? snap.val() : null)); }
      catch (err) { console.warn('[hoops4] chat callback', err); }
    }, () => { /* a denied or dropped watch is not worth an error: the list keeps what it had */ });
    return () => { try { stop(); } catch { /* already detached */ } };
  } catch { return () => {}; }
}

// --- challenge history ------------------------------------------------------------------------------

export const RESULTS = ['won', 'lost', 'draw'];

/** One finished match's result from `side`'s point of view: 'won', 'lost' or 'draw'. null if the
 *  match is not over or `side` is not a side. A resignation is a win for the other person. */
export function resultOf(game, side) {
  if (!game || !game.over || (side !== 'a' && side !== 'b')) return null;
  const w = game.over.winner;
  if (w !== 'a' && w !== 'b') return 'draw';
  return w === side ? 'won' : 'lost';
}

/**
 * THE RECORDS, from a player's own index rows. PURE, so the maths is testable without a database.
 *
 * Only FINISHED rows count. A row's result is, in order: its own `result` (every row written since
 * 2026-09-22), else the result worked out from `row.game` - a validated match the screen read for
 * an OLD row that carries no result - else it is `unknown`: counted as played and listed, but in
 * no win/loss/draw column rather than guessed into one (THE LAW rule 4's spirit).
 *
 * GROUPED BY THE OPPONENT'S PLAYER CODE, never by name: a name can be changed and two people can
 * share one, a code cannot. The label is the name on their most recent match.
 *
 * Returns `{ opponents, finished }`: `opponents` sorted by games played (then most recent), each
 * `{ code, name, emoji, won, lost, draw, unknown, played, last }`; `finished` newest first, each
 * the row plus its `result` and `resigned` ('me' | 'them' | null).
 */
export function recordsFrom(rows, code) {
  const me = asCode(code);
  const finished = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object' || !r.over) continue;
    const them = asCode(r.with);
    if (!them || them === me) continue;
    let result = RESULTS.includes(r.result) ? r.result : null;
    let why = typeof r.why === 'string' ? r.why : '';
    if (!result && r.game && me) {
      result = resultOf(r.game, sideOf(r.game, me));
      if (r.game.over && !why) why = String(r.game.over.why || '');
    }
    const resigned = why === 'resign' && (result === 'won' || result === 'lost')
      ? (result === 'won' ? 'them' : 'me') : null;
    finished.push({ ...r, with: them, result: result || null, resigned, updated: ms(r.updated) });
  }
  finished.sort((x, y) => y.updated - x.updated);
  const by = new Map();
  for (const r of finished) {                 // newest first, so the first row seen names them
    let o = by.get(r.with);
    if (!o) {
      o = { code: r.with, name: String(r.name || ''), emoji: String(r.emoji || '🙂'),
        won: 0, lost: 0, draw: 0, unknown: 0, played: 0, last: r.updated };
      by.set(r.with, o);
    }
    o.played += 1;
    if (r.result === 'won') o.won += 1;
    else if (r.result === 'lost') o.lost += 1;
    else if (r.result === 'draw') o.draw += 1;
    else o.unknown += 1;
  }
  const opponents = [...by.values()].sort((x, y) => (y.played - x.played) || (y.last - x.last));
  return { opponents, finished };
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
  createGame, nextInSeries, pushMove, resignGame, outboxCount, queueMove, drainOutbox,
  cleanChat, chatFrom, unseenChat, sendChat, watchChat, resultOf, recordsFrom,
};
