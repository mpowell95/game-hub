// test-pool-stats.mjs — regression guard for the 2026-07-31 missing-result bug (pool/CLAUDE.md,
// "an MP hash mismatch on the winning shot left the match uncounted"). Sister file to
// test-poolv2-stats.mjs and the dots-boxes/filler/mancala trio: same mechanism, third failure
// mode. Pool never double-counted -- its _onGameOver sites all sat on a not-over -> over
// transition -- but a state-hash mismatch on the game-WINNING shot returned before _onGameOver on
// BOTH devices (_mpApplyNextEntry bails into _mpHandleMismatch, and _mpApplyRecovery never
// recorded at all), so that match was recorded on neither. An MP hash mismatch is the realistic
// failure mode here (float non-associativity across two JS engines over hundreds of physics
// steps), which is why the recovery machinery exists in the first place.
//
// The fix records from both of those paths and adds the _commitStats guard the extra call sites
// now require. This test asserts all three properties that have to hold together:
//   1. a match that ends via a recovery snapshot IS recorded (the bug),
//   2. a match already recorded by its own winning shot is NOT recorded again (what the guard
//      protects, and what test-poolv2-stats.mjs's bug actually was), and
//   3. consecutive solo games each still record (a guard with no per-game reset is the bug Dots
//      and Boxes and Filler shipped on 2026-07-30).
//
// Drives the REAL ui.js: the recovery and mismatch legs go through the actual _mpApplyRecovery /
// _mpHandleMismatch. The plain end-of-game leg calls _onGameOver directly, which is exactly what
// both shot paths do (`if (this.game.over) this._onGameOver(seat, outcome)`) -- running a whole
// pool game through the physics loop in jsdom would be testing the simulator, not the recording.
//
// Optional dependency, same pattern as the sister files: skip cleanly if jsdom isn't installed.
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); }
catch { console.log('SKIP  test-pool-stats.mjs: optional dependency \'jsdom\' not installed'); process.exit(0); }

// jsdom has no 2d canvas without the native `canvas` package, and every render() logs a
// "not implemented" jsdomError for it. ui.js already treats a null context as "nothing to draw",
// so that noise is expected: drop it, keep everything else. (The two branches are jsdom's new and
// old spellings of the same thing.)
const virtualConsole = new VirtualConsole();
if (typeof virtualConsole.forwardTo === 'function') virtualConsole.forwardTo(console, { jsdomErrors: 'none' });
else if (typeof virtualConsole.sendTo === 'function') virtualConsole.sendTo(console, { omitJSDOMErrors: true });
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://example.test/pool/', pretendToBeVisual: true, virtualConsole });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.location = dom.window.location;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
global.matchMedia = dom.window.matchMedia;

const { init } = await import('./pool/js/ui.js');
const rules = await import('./pool/js/rules.js');
const { loadStats } = await import('./js/game-stats.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };
const played = () => loadStats().games.pool.total.played;
const h2h = (id) => {
  const row = ((loadStats().h2h || {}).pool || {})[id];
  return row ? { w: row.w | 0, l: row.l | 0 } : { w: 0, l: 0 };
};

/** A finished game, as rules.js leaves one: the real newGame() shape with the two fields
 *  _onGameOver actually reads set to "seat N just won". */
function overGame(winner) {
  const g = rules.newGame();
  g.over = true;
  g.winner = winner;
  return g;
}

const OPP = { deviceId: 'opp-device-1', name: 'Opponent' };

/** A live room as _mpJoinRoom/_mpRejoin leave it, for either role. */
function mpSession(instance, role) {
  instance.mode = 'online';
  instance.view = 'game';
  instance.mp = {
    role, code: 'TESTRM', localSeat: role === 'host' ? 0 : 1, opp: OPP,
    appliedSeq: 6, movesById: new Map(), maxKnownSeq: 6, delivering: false,
    awaitingRecovery: false, recoveryAttempts: 0, opponentLeft: false, gameNum: 1,
  };
}

const instance = init(document.getElementById('app'));
ok(!!instance, 'init() returns the instance (test hook)');

// ---- 1. THE BUG: a guest whose only route to the end is a recovery snapshot -----------------
// It diverged on an earlier shot and sat in awaitingRecovery while the host played on and won,
// so it never runs the `if (this.game.over) this._onGameOver(...)` line in _mpApplyNextEntry.
mpSession(instance, 'guest');
instance.game = rules.newGame();
instance.mp.awaitingRecovery = true;
const finishedHostState = overGame(0);            // host (seat 0) won; the guest lost
instance._mpApplyRecovery({ seq: 7, state: { balls: finishedHostState.balls, rules: { ...finishedHostState, balls: undefined } } });
ok(played() === 1, `[KNOWN-BUG PROBE] a match that ended via a recovery snapshot IS recorded (played === 1, got ${played()}) - before the fix this stayed 0 and the game vanished`);
ok(h2h(OPP.deviceId).l === 1, `[KNOWN-BUG PROBE] and its head-to-head loss is recorded (l === 1, got ${h2h(OPP.deviceId).l})`);

// A second recovery for the SAME game (the room re-publishing, or a retry) must not re-record.
instance._mpApplyRecovery({ seq: 8, state: { balls: finishedHostState.balls, rules: { ...finishedHostState, balls: undefined } } });
ok(played() === 1, `a repeat recovery for the same game records nothing new (played === 1, got ${played()})`);

// ---- 2. THE HOST SIDE: mismatch on the winning shot, host is authoritative ------------------
// _mpApplyNextEntry resolved the peer's shot into an over state, then the hashes disagreed, so it
// returns via _mpHandleMismatch - which is now where the host finishes.
instance._mpApplyRoundRecord({ n: 2, dealer: 0 }, null);
mpSession(instance, 'host');
instance.mp.gameNum = 2;
instance.game = overGame(0);                      // host is seat 0 here, so the host won
instance._mpHandleMismatch(7);
ok(played() === 2, `[KNOWN-BUG PROBE] the host records the match it just declared authoritative (played === 2, got ${played()}) - before the fix this stayed 1`);
ok(h2h(OPP.deviceId).w === 1, `[KNOWN-BUG PROBE] and its head-to-head win (w === 1, got ${h2h(OPP.deviceId).w})`);

// The guard's own job: the ordinary end-of-game path for a game already banked adds nothing.
instance._onGameOver(0, null);
ok(played() === 2, `_onGameOver after the mismatch already recorded adds nothing (played === 2, got ${played()})`);
ok(h2h(OPP.deviceId).w === 1, `no phantom second head-to-head win (w === 1, got ${h2h(OPP.deviceId).w})`);

// ---- 3. Solo: three games in a row, the Dots-and-Boxes/Filler failure shape -----------------
// _startLocalGame() is the "Play again" path (same instance, no remount). A guard without this
// reset silently drops every game after the first.
instance.mode = 'ai';
for (let i = 1; i <= 3; i++) {
  instance._startLocalGame();
  instance.game.over = true;
  instance.game.winner = 0;                       // solo local seat is 0
  instance._onGameOver(0, null);
  ok(played() === 2 + i, `[KNOWN-BUG PROBE] solo game ${i} of 3 recorded (played === ${2 + i}, got ${played()})`);
}

console.log(`\nPool stats regression: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
