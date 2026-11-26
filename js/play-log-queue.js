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
// EVERY TOUCH AND KEY, LOGGED (2026-11-24, Matt: "EVERY thing like this in EVERY game MUST be logged"). Ball
// Run kept no touches, so its 200 could not be checked. Now every play carries `n`: each touch down, move
// (one every 50 ms while pressed or touching), touch up and key press since the last RESULT, with its time and
// place, kept apart in INPUT_KEY and sent to playInput/<CODE>/<entry id> (js/play-log.js; admins only).
// Format: { v: 1, t0: epoch ms of the first event, w, h: the window, pt: touch|mouse|pen, ev: "<token> ..." },
// token = <ms since the previous token><kind><data>: d x,y (down) | m x,y (move) | u x,y (up) | c x,y (the
// browser took the touch, e.g. a page pan) | k <key> | o x,y (outside the game, 2026-11-25)
// (k T = typed into a text box, the letter not kept) | ! before a made-up one. Moves are dropped first when a
// play passes N_MAX characters; presses are never dropped until the cap itself (then `cut` says how many).
// `o` (2026-11-25): a touch that starts outside the mounted game (outsideGame) is counted as `o`, not in t / p, and
// logged once as `o x,y`. Notes: the private repository.
const IN_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'keydown'];
const IN_PRESS = new Set(['pointerdown', 'touchstart', 'mousedown', 'keydown']);
const _in = { t: 0, p: 0, u: 0, c: 0, o: 0 };
export const INPUT_KEY = 'gamehub.playinput.v1';
export const INPUT_MAX = 200;          // queued plays kept on the phone (newest), each at most N_MAX characters
export const N_MAX = 12000;
// THE WHOLE TEXT fits N_MAX (2026-11-26): the events alone used to fill 12,000, then the labels around them (`{"v":1,"t0":...}`,
// ~70 chars) put a long play just over the database's limit; it was refused and held back every touch log after it.
// The events now stop at EV_MAX, leaving room for the labels; takeInput still checks the finished text.
export const EV_MAX = N_MAX - 300;
const MOVE_MS = 50;
let _log = null;                       // { t0, last, pt, toks: [], moves: count, cut: presses lost, mcut: moves lost }
let _lastMove = 0;
let _lastReal = 0;
const _inLive = (() => { try { return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); } catch { return false; } })();
const _hasPointer = (() => { try { return typeof window !== 'undefined' && 'PointerEvent' in window; } catch { return false; } })();
function _editable(t) {
  try { const n = t && t.tagName; return n === 'INPUT' || n === 'TEXTAREA' || !!(t && t.isContentEditable); } catch { return false; }
}
function _tok(kind, data, fake, isMove) {
  const now = Date.now();
  if (!_log) _log = { t0: now, last: now, pt: '', toks: [], len: 0, moves: 0, cut: 0 };
  const tk = `${now - _log.last}${fake ? '!' : ''}${kind}${data}`;
  if (_log.len + tk.length + 1 > EV_MAX) {
    // `cut` counts PRESSES lost and `mcut` MOVES lost (2026-11-25: a long run's dropped moves used to count as cut, which
    // switched off every touch rule; a rule needs only the presses to be whole).
    if (isMove) { _log.mcut = (_log.mcut | 0) + 1; return; }
    // full: drop the oldest MOVE to make room for a press; with none left, the press is cut
    const i = _log.toks.findIndex((x) => /^\d+!?m/.test(x));
    if (i < 0) { _log.cut++; return; }
    _log.len -= _log.toks[i].length + 1; _log.toks.splice(i, 1); _log.mcut = (_log.mcut | 0) + 1;
  }
  _log.toks.push(tk); _log.len += tk.length + 1; _log.last = now;
}
// HARDER TO FOOL (2026-11-25, after a review that tried to get round all of this):
//  - a key held down repeats ~30 times a second; a repeat is not a press (it is counted in no rule);
//  - a made-up event counts only while a game is on screen (an autofill on the name box is not a cheat);
//  - a made-up CLICK (`el.click()`, the cheapest script) is counted as `c` and logged (`l`), never blocked: the hub's own
//    code calls .click() on a few buttons, and those never run during a play's input;
//  - the two calls that stop a made-up event are kept from the moment this file loads, so a script that later replaces
//    them on Event.prototype does not switch the block off.
const _stopImm = (() => { try { return Event.prototype.stopImmediatePropagation; } catch { return null; } })();
const _prevent = (() => { try { return Event.prototype.preventDefault; } catch { return null; } })();
function _inGame() {
  try {
    const h = document.documentElement;
    if (h && h.classList && h.classList.contains('gh-ingame')) return true;
    const p = String(location.pathname || '');
    return !/(\/|\/index\.html)$/.test(p) && !/\/profile\//.test(p);   // a game's own page (Monopoly Deal, a standalone game)
  } catch { return true; }
}
/** True when `target` is not part of the mounted game (the hub's own frame, the bare page, the hub's own sheets). */
export function outsideGame(target) {
  try {
    if (typeof document === 'undefined') return false;
    const game = document.querySelector('#hub-root [data-role="game"]');
    if (!game || game.hidden) return false;                             // not the hub (a game's own page): all of it is the game
    const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    if (!el) return false;
    if (game.contains(el) && el !== game) return false;                 // on the game itself
    if (el === game) return true;                                       // the game area's own padding, not the game
    if (el === document.body || el === document.documentElement) return true;
    const root = document.getElementById('hub-root');
    if (root && root.contains(el)) return true;                         // the hub's top bar, ‹ Hub, 🐞, margins
    if (el.closest && el.closest('.bug-overlay, .hub-tour')) return true;   // the hub's own sheets
    return false;
  } catch { return false; }
}
let _outPress = false;                 // the last press started outside the game
(function watchInput() {
  try {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const on = (e) => {
      const real = e.isTrusted;
      if (real && e.type === 'keydown' && e.repeat) return;              // a held key: not a press
      if (e.type === 'click') {                                          // only made-up clicks are of interest
        // The hub's own .click() calls (a back button, Enter on a tile, Skip) run inside a real tap or key press:
        // a made-up click within a second of a real event is ours, not a script's.
        if (!real && _inGame() && Date.now() - _lastReal > 1000) { _in.c++; try { _tok('l', '', true, false); } catch { /* counted */ } }
        return;
      }
      if (real) _lastReal = Date.now();
      if (!real && !_inGame()) return;                                   // not on a game: not a play's input
      if (real && e.type !== 'keydown') {
        const ty0 = e.type;
        const press = IN_PRESS.has(ty0);
        // a mouse moving with no button down belongs to no touch: judged by where it is
        const hover = !press && !/^touch|up$|cancel$/.test(ty0) && e.pointerType !== 'touch' && !((e.buttons | 0) > 0);
        if (press) _outPress = outsideGame(e.target);
        if (hover ? outsideGame(e.target) : _outPress) {
          // logged once per touch (the pointer copy where the browser has one), never counted as a game press
          if (/down|start/.test(ty0) && (_hasPointer ? ty0.startsWith('pointer') : true)) {
            _in.o++;
            try { const q = (e.touches && e.touches[0]) || e; _tok('o', `${Math.round(q.clientX || 0)},${Math.round(q.clientY || 0)}`, false, false); } catch { /* counted */ }
          }
          return;
        }
      }
      if (real) { _in.t++; if (IN_PRESS.has(e.type)) _in.p++; } else _in.u++;
      try {
        const ty = e.type;
        // One logged copy per touch: pointer events where the browser has them; made-up ones always.
        // (moves: pointer or touch, sampled by time, so a page pan that cancels the pointer still logs the finger)
        const logIt = !real || ty === 'touchmove' || (_hasPointer ? (ty.startsWith('pointer') || ty === 'keydown') : true);
        if (logIt) {
          if (ty === 'keydown') _tok('k', _editable(e.target) ? 'T' : String(e.key || '?').slice(0, 12).replace(/\s/g, '_'), !real, false);
          else {
            const p = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
            const xy = `${Math.round(p.clientX || 0)},${Math.round(p.clientY || 0)}`;
            if (/down|start/.test(ty)) { _tok('d', xy, !real, false); if (_log && !_log.pt) _log.pt = e.pointerType || (ty.startsWith('touch') ? 'touch' : 'mouse'); }
            else if (/up|end/.test(ty)) _tok('u', xy, !real, false);
            else if (ty === 'pointercancel') _tok('c', xy, !real, false);
            else {
              const pressed = (e.buttons | 0) > 0 || e.pointerType === 'touch' || ty === 'touchmove';
              const now = Date.now();
              if (pressed && now - _lastMove >= MOVE_MS) { _lastMove = now; _tok('m', xy, !real, true); if (_log) _log.moves++; }
            }
          }
        }
      } catch { /* the count above still stands */ }
      if (!real && _inLive) { try { (_stopImm || e.stopImmediatePropagation).call(e); (_prevent || e.preventDefault).call(e); } catch { /* still counted */ } }
    };
    for (const ty of IN_TYPES) window.addEventListener(ty, on, { capture: true, passive: false });
    window.addEventListener('click', on, { capture: true, passive: true });
  } catch (err) { console.error('[play-log] input report not started', err); }
})();
/** The input report for an entry: `i` (counts) and, for a RESULT entry, `n` (every event since the last
 *  result, the log then starts again). */
function takeInput(isResult) {
  const i = JSON.stringify({ t: _in.t, p: _in.p, u: _in.u, ...(_in.c ? { c: _in.c } : {}), ...(_in.o ? { o: _in.o } : {}) });
  let n = null;
  if (isResult) {
    if (_log && _log.toks.length) {
      let w = 0, h = 0;
      try { w = Math.round(window.innerWidth); h = Math.round(window.innerHeight); } catch { /* no window */ }
      const pack = () => JSON.stringify({ v: 1, t0: _log.t0, w, h, pt: String(_log.pt || '').slice(0, 12), ...(_log.cut ? { cut: _log.cut } : {}), ...(_log.mcut ? { mcut: _log.mcut } : {}), ev: _log.toks.join(' ') });
      n = pack();
      // Never over N_MAX, whatever happens above: drop the oldest moves, then the oldest presses (counted), until it fits.
      while (n.length > N_MAX && _log.toks.length) {
        const i = _log.toks.findIndex((x) => /^\d+!?m/.test(x));
        if (i >= 0) { _log.toks.splice(i, 1); _log.mcut = (_log.mcut | 0) + 1; } else { _log.toks.shift(); _log.cut++; }
        n = pack();
      }
    }
    _in.t = 0; _in.p = 0; _in.u = 0; _in.c = 0; _in.o = 0; _log = null;
  }
  return { i, n };
}
export function readInputQueue() {
  try { const q = JSON.parse(localStorage.getItem(INPUT_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}
export function writeInputQueue(q) {
  let keep = q.slice(-INPUT_MAX);
  // A full phone: keep the newest half, then a quarter, rather than lose the whole queue (rule 6: said loudly).
  for (let tries = 0; tries < 4; tries++) {
    try { localStorage.setItem(INPUT_KEY, JSON.stringify(keep)); return; }
    catch (err) { console.error('[play-log] input log not saved; keeping fewer', keep.length, err); keep = keep.slice(-Math.max(1, keep.length >> 1)); }
  }
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
    const inp = takeInput(!!entry.f);               // what really touched the screen (2026-11-24, above)
    x.i = inp.i;
    const q = readQueue();
    q.push(x);
    writeQueue(q);
    if (inp.n) { const iq = readInputQueue(); iq.push({ c: code, id: x.id, t, n: inp.n }); writeInputQueue(iq); }
    for (const fn of listeners) { try { fn(); } catch { /* a listener never blocks a log */ } }
    return x.id;   // its key in playLog/<CODE> (Contexto keeps its finishing entry's, 2026-10-29)
  } catch (err) { console.error('[play-log] not logged', err); }
  return null;
}

/** A recorder's arguments as JSON (functions dropped, big values cut by appendPlayLog). */
export function argsJSON(args) {
  try { return JSON.stringify(Array.from(args || [], (v) => (typeof v === 'function' ? null : v === undefined ? null : v))); } catch { return '[]'; }
}

export default { QUEUE_KEY, MAX_QUEUE, INPUT_KEY, readQueue, writeQueue, readInputQueue, writeInputQueue, onAppend, appendPlayLog, argsJSON };
