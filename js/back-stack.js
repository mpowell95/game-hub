// js/back-stack.js - the phone's back gesture steps back ONE screen in every drill-down overlay
// (2026-11-02, Matt: "I want to be able to swipe left to right and move back 1 screen. Not leave
// the whole leaderboard. Everywhere should work like that."). Dependency-free.
//
// Each overlay keeps the browser history IN STEP with its own screen stack: one history entry per
// level (level 1 = the overlay open). Every entry's state carries `ghb: {<owner id>: <its level>}`
// for every open overlay (the state below is spread in, so the profile page's `pfView` rides along),
// so a popstate tells each overlay exactly how many levels deep it now is, and one jump of several
// entries is several steps. Entries are never pushed from inside a popstate (the old "re-arm one
// entry" pattern, which iOS's back swipe ignored, so the next swipe left the whole leaderboard).
//
//   const bs = backStack(n => { ...step back n levels; at the top, close (which calls bs.close()) });
//   bs.sync(level)  after each render: the level the screen now shows (pushes or unwinds the gap)
//   bs.back()       the on-screen back button and Esc: history.back(), so both paths run one code
//   bs.close()      closing any other way (X, tab bar, opening a game): unwinds what is left
// backDepth(): entries all open overlays hold (the profile page's tab bar counts past them).

const owners = new Map();   // id -> owner, in opening order
let seq = 0;
let inflight = 0;           // our own history.go() calls still waiting for their popstate
let owed = 0;               // entries to unwind at the next flush
let flushQueued = false;
let inflightTimer = 0;
// NO FORWARD PAGE LEFT BEHIND (2026-11-16, Matt: in Battle Arena a right-to-left swipe "shows me this sproutle page for a
// second then goes back"). Going back (our go(-n), or the phone's back) leaves the closed screen as a FORWARD entry; the
// iPhone's forward swipe from the right edge then slid that old screen's snapshot in, and onPopState stepped back out of it.
// So after any step back (while some screen uses this module), a FILLER entry (same depths, `ghbFill`) is pushed: a push drops
// every forward entry. Arriving off a filler with nothing changed = the back passes straight on (one more history.back());
// a new level replaces the filler instead of stacking on it; an unwind from a filler counts it.
const isFill = (st) => !!(st && typeof st === 'object' && st.ghbFill);
let onFill = false;
function seal() {
  if (inflight || owed || isFill(history.state)) return;
  if (!owners.size || [...owners.values()].some((o) => o.noHist)) return;   // nobody's screens to keep, or history refused
  try { history.pushState({ ...(history.state && typeof history.state === 'object' ? history.state : {}), ghbFill: 1 }, ''); onFill = true; }
  catch (err) { console.warn('[back-stack] filler refused', err); }
}

function depths() {
  const s = history.state;
  return s && typeof s === 'object' && s.ghb && typeof s.ghb === 'object' ? s.ghb : {};
}

function pushFor(o) {
  const s = history.state && typeof history.state === 'object' ? history.state : {};
  try {
    const next = { ...s, ghb: { ...depths(), [o.id]: o.hist + 1 } };
    if (isFill(s)) { delete next.ghbFill; history.replaceState(next, ''); onFill = false; }   // the filler becomes the new level
    else history.pushState(next, '');
    o.hist += 1;
    return true;
  } catch (err) { console.warn('[back-stack] pushState refused', err); o.noHist = true; return false; }
}

// Push any missing entries, only once no traversal of ours is in flight (a push during one can be
// lost or land behind it).
function settle() {
  if (inflight || owed) return 0;
  let pushed = 0;
  for (const o of [...owners.values()]) {
    while (!o.noHist && o.hist < o.level) { if (!pushFor(o)) break; pushed += 1; }
  }
  return pushed;   // a push already dropped the forward entries
}

function flush() {
  flushQueued = false;
  if (!owed) { settle(); return; }
  const n = owed + (isFill(history.state) ? 1 : 0);   // the filler on top is one more step
  owed = 0;
  inflight += 1;
  clearTimeout(inflightTimer);
  // A go() that never fires popstate (nothing left to go back to) must not stall later pushes.
  inflightTimer = setTimeout(() => { inflight = 0; settle(); }, 1500);
  try { history.go(-n); } catch { inflight = 0; settle(); }
}
function owe(n) {
  if (n <= 0) return;
  owed += n;
  if (!flushQueued) { flushQueued = true; Promise.resolve().then(flush); }
}

function onPopState() {
  const d = depths();
  const leftFill = onFill;
  onFill = isFill(history.state);
  if (inflight > 0) {
    // Our own unwind landed: the screens already match; read where history really is.
    inflight -= 1;
    if (!inflight) clearTimeout(inflightTimer);
    for (const o of owners.values()) o.hist = Math.max(0, d[o.id] | 0);
    if (!inflight && !settle()) seal();
    return;
  }
  // Stepped back off a filler and nothing changed: that back was meant for the screen behind it.
  if (leftFill && !onFill && [...owners.values()].every((o) => Math.max(0, d[o.id] | 0) === o.hist)) {
    try { history.back(); } catch { /* no history */ }
    return;
  }
  // The user went back (swipe, Back button, history.back()): each overlay steps to its new depth.
  for (const o of [...owners.values()].reverse()) {
    if (!owners.has(o.id)) continue;
    const h = Math.max(0, d[o.id] | 0);
    o.hist = h;
    if (h < o.level) {
      const n = o.level - h;
      o.level = h;
      try { o.onBack(n); } catch (err) { console.error('[back-stack] step back failed', err); }
    } else if (h > o.level) {
      owe(h - o.level);   // forward into a screen already left: go back out of it
    }
  }
  if (!settle()) seal();
}
// Guarded: Node test scripts import the screens that import this.
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('popstate', onPopState);

/** One overlay's history. `onBack(n)`: step back n levels; reaching level 0 closes the overlay
 *  (its close calls `close()`, which then has nothing left to unwind). */
export function backStack(onBack) {
  seq += 1;
  const o = { id: `b${Date.now().toString(36)}${seq}`, level: 0, hist: 0, noHist: false, onBack };
  owners.set(o.id, o);
  return {
    get level() { return o.level; },
    /** The level the screen now shows (1 = the overlay's first screen). */
    sync(level) {
      if (!owners.has(o.id)) return;
      level = Math.max(0, level | 0);
      o.level = level;
      if (o.hist > level) { owe(o.hist - level); o.hist = level; }
      settle();
    },
    /** The on-screen back button / Esc: one level back, through history when it can. */
    back() {
      if (!owners.has(o.id)) return;
      if (!o.noHist && !inflight && !owed && o.hist > 0 && o.hist === o.level) { history.back(); return; }
      o.level = Math.max(0, o.level - 1);
      onBack(1);
    },
    /** The overlay closed some other way: unwind its remaining entries (no second close). */
    close() {
      if (!owners.has(o.id)) return;
      owners.delete(o.id);
      o.level = 0;
      if (o.hist > 0) { owe(o.hist); o.hist = 0; }
    },
  };
}

/** Entries the open overlays hold right now. */
export function backDepth() {
  let n = 0;
  for (const o of owners.values()) n += o.hist;
  return n;
}

export default { backStack, backDepth };
