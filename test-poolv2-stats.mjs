// test-poolv2-stats.mjs — regression guard for the 2026-07-31 double-count bug (poolv2/CLAUDE.md,
// "Bug: an MP recovery could record the same finished game twice"). Sister file to
// test-dotsboxes-stats.mjs / test-filler-stats.mjs, which guard the OPPOSITE failure of the same
// mechanism (a stats guard that never resets, so results stop recording). Poolv2 had no guard at
// all, and _onGameOver has TWO real call sites that can both fire for one finished game:
//
//   1. the shot that ends the game (_mpLocalShoot / _mpApplyNextEntry), and
//   2. _mpApplyRecovery, which calls _onGameOver whenever the snapshot it just applied is over.
//
// A hash mismatch on the peer's replay of the winning shot writes exactly such a recovery
// snapshot, so a guest that already recorded its own winning shot recorded the SAME game a second
// time when the host's recovery landed — and if the host's authoritative state named the other
// winner, the second write was a LOSS for a game already banked as a win. THE LAW says writes are
// additive and history is never fabricated; a phantom extra play/win is fabricated history.
//
// This test drives the REAL ui.js (not a mirror): the recovery leg goes through the actual
// _mpApplyRecovery. The other leg calls _onGameOver directly, which is what both shot paths do
// (`if (this.game.over) this._onGameOver(seat, outcome)`) — running a whole pool game through the
// physics loop in jsdom would test the simulator, not the recording. The last two blocks are the
// counterweight: a guard that never resets is the bug Dots and Boxes/Filler actually shipped, so
// three solo games in a row and a two-game MP series must still record EVERY game.
//
// Optional dependency, same pattern as the sister files: skip cleanly if jsdom isn't installed.
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); }
catch { console.log('SKIP  test-poolv2-stats.mjs: optional dependency \'jsdom\' not installed'); process.exit(0); }

// jsdom has no 2d canvas without the native `canvas` package, and every render() logs a
// "not implemented" jsdomError for it. ui.js already treats a null context as "nothing to
// draw" (_drawFrame's `if (!this.ctx) return`), so the noise is expected: drop it, keep
// everything else (a real page error still reaches the console).
// (the two branches are jsdom's new and old spellings of the same thing; a VirtualConsole with
// neither, i.e. some future third spelling, just stays silent, which is also fine here)
const virtualConsole = new VirtualConsole();
if (typeof virtualConsole.forwardTo === 'function') virtualConsole.forwardTo(console, { jsdomErrors: 'none' });
else if (typeof virtualConsole.sendTo === 'function') virtualConsole.sendTo(console, { omitJSDOMErrors: true });
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://example.test/poolv2/', pretendToBeVisual: true, virtualConsole });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.location = dom.window.location;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
global.matchMedia = dom.window.matchMedia;

const { init } = await import('./poolv2/js/ui.js');
const rules = await import('./poolv2/js/rules.js');
const { loadStats } = await import('./js/game-stats.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };
const played = () => loadStats().games.poolv2.total.played;
const won = () => loadStats().games.poolv2.total.won;
const h2h = (id) => {
  const row = ((loadStats().h2h || {}).poolv2 || {})[id];
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

/** The guest side of a live room, mid-series, as _mpApplyRoundRecord/_mpRejoin leave it. */
function guestSession(instance, gameNum) {
  instance.mode = 'online';
  instance.view = 'game';
  instance.mp = {
    role: 'guest', code: 'TESTRM', localSeat: 1, opp: OPP,
    appliedSeq: 6, movesById: new Map(), maxKnownSeq: 6, delivering: false,
    awaitingRecovery: false, recoveryAttempts: 0, opponentLeft: false, pendingPlacement: null,
    gameNum, nextDealer: 0, series: { wins: [0, 0] }, lastScoredGame: null,
  };
}

const instance = init(document.getElementById('app'));
ok(!!instance, 'init() returns the instance (test hook)');

// ---- 1. MP: the winning shot, then the host's recovery for the same game -----------------
guestSession(instance, 1);
instance.game = overGame(1);                 // guest is seat 1, so the guest won this one
instance._onGameOver(1, null);               // what _mpLocalShoot/_mpApplyNextEntry do
ok(played() === 1, `the finished game recorded once (played === 1, got ${played()})`);
ok(won() === 1, `recorded as a win (won === 1, got ${won()})`);
ok(h2h(OPP.deviceId).w === 1, `head-to-head recorded once (w === 1, got ${h2h(OPP.deviceId).w})`);

// The host's replay of that same winning shot hash-mismatched, so it published a recovery
// snapshot of its own (already over) state. The guest applies it — the second, unguarded
// _onGameOver call site.
instance._mpApplyRecovery({ seq: 7, state: instance._mpSnapshot() });
ok(played() === 1, `[KNOWN-BUG PROBE] the recovery did NOT re-record the same game (played === 1, got ${played()}) - before the fix this became 2`);
ok(won() === 1, `[KNOWN-BUG PROBE] no phantom second win (won === 1, got ${won()})`);
ok(h2h(OPP.deviceId).w === 1, `[KNOWN-BUG PROBE] no phantom second head-to-head win (w === 1, got ${h2h(OPP.deviceId).w})`);

// Worst shape of the same bug: the host's authoritative state names the OTHER winner, so the
// second write would have been a LOSS for a game already banked as a win - one game, two
// contradictory results, neither removable (writes are additive, THE LAW rule 2).
instance._mpApplyRecovery({ seq: 8, state: { ...instance._mpSnapshot(), rules: { ...overGame(0), balls: undefined } } });
ok(played() === 1, `[KNOWN-BUG PROBE] a disagreeing recovery snapshot records nothing new (played === 1, got ${played()})`);
ok(h2h(OPP.deviceId).l === 0, `[KNOWN-BUG PROBE] no contradictory loss for a game already banked as a win (l === 0, got ${h2h(OPP.deviceId).l})`);

// ---- 2. MP series: the NEXT game of the same room must record ----------------------------
instance._mpApplyRoundRecord({ n: 2, dealer: 1 }, null);
instance.game = overGame(0);                 // seat 0 (the host) took game 2
instance._onGameOver(0, null);
ok(played() === 2, `game 2 of the series recorded (played === 2, got ${played()})`);
ok(h2h(OPP.deviceId).l === 1, `game 2 recorded as a head-to-head loss (l === 1, got ${h2h(OPP.deviceId).l})`);

// ---- 3. Solo: three games in a row, the Dots-and-Boxes/Filler failure shape --------------
// _startLocalGame() is the "Play again" path (same instance, no remount). If the new guard is
// ever added without a reset here, every game after the first goes unrecorded - the exact bug
// this repo already shipped twice.
instance.mode = 'ai';
for (let i = 1; i <= 3; i++) {
  instance._startLocalGame();
  instance.game.over = true;
  instance.game.winner = 0;                  // solo local seat is 0
  instance._onGameOver(0, null);
  ok(played() === 2 + i, `[KNOWN-BUG PROBE] solo game ${i} of 3 recorded (played === ${2 + i}, got ${played()})`);
}

console.log(`\nPoolv2 stats regression: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
