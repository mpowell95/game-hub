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

// --- INPUT REPORT (2026-11-24, Matt: "How the fuck are we allowing him to run a script to get better
// scores without immediately being notified???"). King of Games' Snake 62s on Nov 17 turned the snake 223
// and 242 times from ONE tap: code steered it. Every log entry now carries `i` = what really touched the
// screen since this game's last RESULT entry: t = real (browser-made, `isTrusted`) touches, pointer moves and
// key presses; p = the presses among them (down / start / keydown); u = events a page script made up
// (`isTrusted` false). The server judges each result as it lands (js/integrity.js checkPlayInput) and pushes
// the admins at once. On the live site a made-up touch or key press is also STOPPED before any game sees it
// (none of our code makes one: only .click(), which is not watched). Evidence only; nothing reads it back.
// Guarded so the server copy (no window) does nothing.
const IN_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'keydown'];
const IN_PRESS = new Set(['pointerdown', 'touchstart', 'mousedown', 'keydown']);
const _in = { t: 0, p: 0, u: 0 };
const _inLive = (() => { try { return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); } catch { return false; } })();
(function watchInput() {
  try {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const on = (e) => {
      if (e.isTrusted) { _in.t++; if (IN_PRESS.has(e.type)) _in.p++; return; }
      _in.u++;
      if (_inLive) { try { e.stopImmediatePropagation(); e.preventDefault(); } catch { /* still counted */ } }
    };
    for (const ty of IN_TYPES) window.addEventListener(ty, on, { capture: true, passive: false });
  } catch (err) { console.error('[play-log] input report not started', err); }
})();
/** The input report for an entry; a RESULT entry (a recorder) starts the next count. */
function takeInput(isResult) {
  const out = JSON.stringify({ t: _in.t, p: _in.p, u: _in.u });
  if (isResult) { _in.t = 0; _in.p = 0; _in.u = 0; }
  return out;
}

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
    if (entry.m != null) x.m = str(entry.m, 150);   // the game's mode (game-stats.js withMode, 2026-10-30); '?' = none given
    if (entry.d != null) x.d = str(entry.d, 400);   // the match's detail, JSON (withMode's `detail`, 2026-11-02)
    if (entry.x != null) x.x = str(entry.x, 20000); // the play's PRIVATE data, JSON (withMode's `log`, logPlayData; 2026-11-16)
    x.i = takeInput(!!entry.f);                     // what really touched the screen (2026-11-24, above)
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
