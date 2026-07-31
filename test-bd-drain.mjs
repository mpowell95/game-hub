// test-bd-drain.mjs — THE LAW rule 6 for the Monopoly Deal pending-stats queue
// (gamehub.bd.pendingStats.v1, js/game-stats.js's drainPendingBusinessDeal).
//
// That queue is the ONLY copy of the plays in it: business-deal/js/ui.js writes a play there when
// window.__ghStats isn't available at game-end (its nested service worker may not have cached the
// script yet), and the hub drains it on the next load. Until 2026-07-31 the drain deleted the
// queue key inside loadStats() while the store write that absorbed those plays only happened
// afterwards (`if (changed) persist(st)`) and can fail on a full quota — one failed write and the
// plays were gone from both places, silently. Now the drain persists first, proves the write
// landed by a fresh re-read, and only then drops the queue.
//
// Node-only, no deps, the test-stats-replay.mjs idiom (same stubbed localStorage).
// Run: node test-bd-drain.mjs
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PENDING_KEY = 'gamehub.bd.pendingStats.v1';
const STATS_KEY = 'gamehub.stats';

let fail = 0;
function ok(name, cond) {
  if (cond) { console.log(`ok    ${name}`); return; }
  fail++; console.log(`FAIL  ${name}`);
}

let backing = new Map();
let failWrites = false;           // simulates a full quota: setItem throws, same as a real one
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => {
    if (failWrites && k === STATS_KEY) throw new Error('QuotaExceededError (simulated)');
    backing.set(k, String(v));
  },
  removeItem: (k) => { backing.delete(k); },
};
globalThis.self = globalThis;

const gs = await import(pathToFileURL(join(ROOT, 'js', 'game-stats.js')).href);

// The failing-write blocks below deliberately trip game-stats.js's own "persist failed" /
// "keeping the queue" console.error calls (THE LAW rule 6 -- no silent write failures). Those
// logs are the CORRECT behaviour here, so they're muted for the duration rather than dumped as
// stack traces on every deploy run; ok()/FAIL lines go through console.log and are unaffected.
const realError = console.error;
const muteErrors = () => { console.error = () => {}; };
const unmuteErrors = () => { console.error = realError; };

const QUEUE = [
  { game: 'business', diff: 'normal', won: true, ts: 1 },
  { game: 'business', diff: 'normal', won: false, ts: 2 },
];
const seedQueue = () => { backing.set(PENDING_KEY, JSON.stringify(QUEUE)); };
const queueLeft = () => {
  const raw = backing.get(PENDING_KEY);
  return raw ? JSON.parse(raw).length : 0;
};
const bdPlayed = () => {
  const raw = backing.get(STATS_KEY);
  if (!raw) return 0;
  return JSON.parse(raw).games.business.total.played | 0;
};

// ---- 1. The failing-write case: the queue must SURVIVE ------------------------------------
backing = new Map();
seedQueue();
failWrites = true;
muteErrors();
gs.loadStats();
unmuteErrors();
ok('a failed store write leaves the queued plays in the queue', queueLeft() === 2);
ok('and nothing was written to the store', bdPlayed() === 0);

// ---- 2. The write succeeds on the next load: drained exactly once --------------------------
failWrites = false;
gs.loadStats();
ok('the next load drains the queue', queueLeft() === 0);
ok('and both plays landed in the store', bdPlayed() === 2);

const st = JSON.parse(backing.get(STATS_KEY));
ok('one win, one loss, as queued', (st.games.business.total.won | 0) === 1 && (st.games.business.total.lost | 0) === 1);

// ---- 3. Never twice: a drained queue is gone, and re-loading adds nothing ------------------
gs.loadStats();
gs.loadStats();
ok('re-loading does not re-apply a drained queue', bdPlayed() === 2);

// ---- 4. A queue that survived a failed write is applied ONCE, not once per attempt ---------
backing = new Map();
seedQueue();
failWrites = true;
muteErrors();
gs.loadStats();
gs.loadStats();
gs.loadStats();
unmuteErrors();
failWrites = false;
gs.loadStats();
ok('three failed loads then one good one still record exactly the two queued plays', bdPlayed() === 2);
ok('and the queue is finally clear', queueLeft() === 0);

console.log(fail ? `\n${fail} FAILED` : '\nBusiness Deal pending-stats drain: all passed.');
process.exit(fail ? 1 : 0);
