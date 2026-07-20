// firebase-boot.js - the ONE place that boots the shared NAMED 'stats' Firebase app + anonymous
// auth. Both stats-net.js (family stats mirror) and net.js (multiplayer rooms) used to each load
// their own copy of the SDK and race to initialize the same named app: stats-net called
// initializeApp() unconditionally while net.js did getApp()-or-create, and whichever init lost
// that race threw into a swallowed `catch` and stayed dead for the rest of the session with zero
// symptoms visible to anyone (ARCH-REVIEW.md S4-2). Routing both consumers through the SAME
// in-flight promise here removes the race entirely - there is only ever one initializeApp('stats')
// call per page load, full stop.
//
// challenge/challenge-net.js is untouched: it boots Firebase's DEFAULT (unnamed) app, a fully
// separate app instance from 'stats' by design, so it was never part of this race and has no
// reason to consume this module.
//
// Bounded retry, not a dead-forever latch: the old `_tried` flags in stats-net.js/net.js meant a
// transient failure (briefly offline at page load, a flaky gstatic fetch) killed stats sync and
// multiplayer for the rest of the session. Here, a failed attempt is simply retried on the NEXT
// call, up to MAX_ATTEMPTS per page load - most transient failures get a second chance the next
// time a game or the hub actually needs the app.

const SDK = '10.12.2';
const MAX_ATTEMPTS = 3;

let _inFlight = null;
let _attempts = 0;
let _result = null; // { db, api } once booted successfully; never cleared once set (no reason to reboot)

async function readConfig() {
  try {
    const m = await import('./firebase-config.js');
    return m.firebaseConfig || (m.default && m.default.firebaseConfig) || m.default || null;
  } catch { return null; }
}

async function boot() {
  const cfg = await readConfig();
  if (!(cfg && cfg.apiKey && cfg.databaseURL)) return null;
  const appMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`);
  const dbMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-database.js`);
  const authMod = await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`);
  // fetch-or-create: safe even if something else on the page already created the named app
  // (e.g. a future consumer that isn't this module), never a duplicate 'stats' app.
  let app;
  try { app = appMod.getApp('stats'); }
  catch { app = appMod.initializeApp(cfg, 'stats'); }
  const db = dbMod.getDatabase(app);
  const auth = authMod.getAuth(app);
  if (!auth.currentUser) await authMod.signInAnonymously(auth);
  return { db, api: dbMod };
}

/** Resolves to { db, api } once the named 'stats' app + anonymous auth are ready, or null if
 *  unconfigured, offline, or every retry has been used up. Concurrent callers made before the
 *  first resolution all share this SAME in-flight promise, so there is exactly one init attempt
 *  in flight at a time regardless of how many modules call this at once. */
export function getStatsApp() {
  if (_result) return Promise.resolve(_result);
  if (_inFlight) return _inFlight;
  if (_attempts >= MAX_ATTEMPTS) return Promise.resolve(null);
  _attempts++;
  _inFlight = boot()
    .then((r) => { _inFlight = null; if (r) _result = r; return r; })
    .catch(() => { _inFlight = null; return null; });
  return _inFlight;
}

export default { getStatsApp };
