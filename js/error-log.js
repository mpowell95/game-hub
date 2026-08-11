// error-log.js - a small ring buffer of the last uncaught JS errors on this device, so a bug
// report can carry what actually broke instead of only what the player was able to describe.
//
// THE LAW (root CLAUDE.md): never touches player history. Its one key is NEW
// (`gamehub.errorlog.v1`), holds nothing a player earned, and is capped and overwritten by design -
// breadcrumbs, not a record. Only js/bug-report.js reads it.
//
// Why it persists rather than living in memory: the errors worth seeing are usually the ones that
// broke a screen badly enough that the player reloaded before reporting, which would take an
// in-memory buffer with it. So each entry writes through to localStorage as it happens (best
// effort - a full or disabled store must never become a second bug).
//
// Installed once by js/hub.js on load, covering the hub AND every in-hub module game (same page). A
// standalone `<game>/index.html` opened by direct URL is not covered - a known gap, not an
// oversight: the report buttons live on the hub and the profile page, so a report is always filed
// from a page where this has been running.

const KEY = 'gamehub.errorlog.v1';
const MAX = 20;              // enough to see a cascade, small enough to never crowd the store
const MAX_MSG = 300;
const MAX_STACK = 900;

const clip = (s, n) => {
  const str = typeof s === 'string' ? s : (s == null ? '' : String(s));
  return str.length > n ? str.slice(0, n) + '…(clipped)' : str;
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed && parsed.entries) ? parsed.entries : [];
  } catch { return []; }
}

function write(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, entries }));
  } catch (err) {
    // Not silent (rule 6's habit), but never escalated: a diagnostic buffer that cannot be stored
    // must not take a game down with it.
    try { console.warn('[error-log] could not persist error breadcrumb', err); } catch { /* ignore */ }
  }
}

/** Record one breadcrumb. Exported so a game can note something it caught itself. Never throws. */
export function noteError(kind, detail) {
  try {
    const entry = {
      at: new Date().toISOString(),
      kind: clip(kind || 'error', 40),
      msg: clip(detail && detail.msg, MAX_MSG),
      src: clip(detail && detail.src, 200),
      line: (detail && detail.line) | 0,
      col: (detail && detail.col) | 0,
      stack: clip(detail && detail.stack, MAX_STACK),
      url: clip(typeof location !== 'undefined' ? location.pathname + location.search : '', 200),
    };
    const entries = read();
    entries.push(entry);
    write(entries.slice(-MAX));
  } catch { /* a logger that throws is worse than no logger */ }
}

/** The breadcrumbs, oldest first. Read-only; used by js/bug-report.js. */
export function recentErrors() { return read(); }

let installed = false;

/** Subscribe to window errors + unhandled promise rejections. Idempotent. */
export function installErrorLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    // A failed <img>/<script>/<link> load fires 'error' with no `.error`. Worth keeping: a missing
    // precached asset is exactly the kind of bug this feature is for.
    if (e && e.target && e.target !== window && e.target.tagName) {
      noteError('resource', { msg: `${e.target.tagName} failed to load`, src: e.target.src || e.target.href || '' });
      return;
    }
    noteError('error', {
      msg: (e && e.message) || 'unknown error',
      src: (e && e.filename) || '',
      line: e && e.lineno,
      col: e && e.colno,
      stack: e && e.error && e.error.stack,
    });
  }, true);   // capture phase: resource errors do not bubble
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    noteError('unhandledrejection', {
      msg: (r && r.message) || String(r == null ? 'unknown rejection' : r),
      stack: r && r.stack,
    });
  });
}

export default { installErrorLog, noteError, recentErrors };
