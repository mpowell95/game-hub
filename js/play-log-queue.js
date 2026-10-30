// js/play-log-queue.js - THE PLAY LOG'S QUEUE, local only (2026-10-28, Matt: "You must begin logging all
// of these things so we can catch when he cheats").
//
// Every finished game in every game (js/game-stats.js notePlay: the recorder's name and its arguments,
// so the score, time, moves, hints and difficulty come with it) and, for games that log more, every
// move (noteEvent: Contexto's guesses, hints and give-ups) is appended here with the phone's time and
// the player code. js/play-log.js sends it to playLog/<CODE>/<t>-<n> (admins read it; nobody else).
// No network here and no DOM, so js/game-stats.js (also copied to the server) can import it.
//
// THE LAW: a log entry is evidence, never a stat. Nothing reads it back on the phone; the stats store
// is untouched by it. The queue is capped (newest 3,000 kept) so an offline phone cannot fill storage.

export const QUEUE_KEY = 'gamehub.playlog.v1';
export const MAX_QUEUE = 3000;
const CODE_RE = /^[A-Z0-9]{3,12}$/;
let seq = 0;
const listeners = new Set();

export function readQueue() {
  try { const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
export function writeQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE))); } catch (err) { console.error('[play-log] queue not saved', err); }
}
/** Called after each append (js/play-log.js schedules a send). */
export function onAppend(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const str = (v, n) => String(v == null ? '' : v).slice(0, n);

/** Append one entry: { g: game, f?: recorder, a?: JSON of its arguments, e?: event, k?: puzzle/level,
 *  w?: word, r?: result }. `code` = the player it belongs to (entries wait for that player's code). */
export function appendPlayLog(code, entry) {
  try {
    if (!CODE_RE.test(String(code || '')) || !entry || !entry.g) return;
    const t = Date.now();
    const x = { c: code, id: `${t}-${seq++ % 10000}`, t, g: str(entry.g, 24) };
    if (entry.f) x.f = str(entry.f, 40);
    if (entry.a != null) x.a = str(entry.a, 1600);
    if (entry.e) x.e = str(entry.e, 12);
    if (entry.k != null) x.k = str(entry.k, 40);
    if (entry.w != null) x.w = str(entry.w, 40);
    if (entry.r != null) x.r = str(entry.r, 20);
    if (entry.m != null) x.m = str(entry.m, 150);   // the game's mode (game-stats.js withMode, 2026-10-30)
    const q = readQueue();
    q.push(x);
    writeQueue(q);
    for (const fn of listeners) { try { fn(); } catch { /* a listener never blocks a log */ } }
    return x.id;   // its key in playLog/<CODE> (Contexto keeps its finishing entry's, 2026-10-29)
  } catch (err) { console.error('[play-log] not logged', err); }
  return null;
}

/** A recorder's arguments as JSON (functions dropped, big values cut by appendPlayLog). */
export function argsJSON(args) {
  try { return JSON.stringify(Array.from(args || [], (v) => (typeof v === 'function' ? null : v === undefined ? null : v))); } catch { return '[]'; }
}

export default { QUEUE_KEY, MAX_QUEUE, readQueue, writeQueue, onAppend, appendPlayLog, argsJSON };
