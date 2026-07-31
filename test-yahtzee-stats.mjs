// test-yahtzee-stats.mjs — regression guard for the 2026-07-31 missing-result bug
// (yahtzee/CLAUDE.md, "an MP resync could swallow the whole match"). Same mechanism as the
// pool/poolv2 fixes of the same date, third game: commitStatsOnce() runs from endTurn() and
// nowhere else, but applyMpRecovery -> applyMpSnapshot can set state.gameOver directly, and
// mpTryDeliverNextMove then bails on gameOver. So a device that resynced onto an already-finished
// match showed the final scorecard and recorded nothing at all.
//
// Reachable because roll/hold/commit are each their own log entry: a device that diverges on a
// hash mid-turn sits in awaitingRecovery while the opponent plays on to the end, and the snapshot
// that comes back is a finished match.
//
// Drives the REAL ui.js through its documented dev/test seam (window.__yzTest, yahtzee/CLAUDE.md
// "Dev/test seam"), which now exposes the MP move-apply pipeline. Optional dependency, same
// pattern as the sister files: skip cleanly if jsdom isn't installed.
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); }
catch { console.log('SKIP  test-yahtzee-stats.mjs: optional dependency \'jsdom\' not installed'); process.exit(0); }

const virtualConsole = new VirtualConsole();
if (typeof virtualConsole.forwardTo === 'function') virtualConsole.forwardTo(console, { jsdomErrors: 'none' });
else if (typeof virtualConsole.sendTo === 'function') virtualConsole.sendTo(console, { omitJSDOMErrors: true });
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://example.test/yahtzee/', pretendToBeVisual: true, virtualConsole });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.location = dom.window.location;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
global.matchMedia = dom.window.matchMedia;

const { init } = await import('./yahtzee/js/ui.js');
const { loadStats } = await import('./js/game-stats.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };
const played = () => loadStats().games.yahtzee.total.played;

init(document.getElementById('app'));
const T = window.__yzTest;
ok(!!T && typeof T.mpApplyRecovery === 'function', 'the dev/test seam exposes the MP move-apply pipeline');

// Mount the game screen once: applyMpRecovery ends in render(), which needs the real board DOM.
// newGame() below swaps the state underneath it without remounting, exactly as beginMPGame does.
T.startSolo();

/** A full scorecard for both seats, i.e. exactly what isGameOver() tests for. `mine` is seat 0's
 *  per-category score and `theirs` seat 1's, so a caller can decide who wins. */
function finishedSnapshot(mine, theirs) {
  const fill = (v) => Object.fromEntries(T.CATEGORIES_ALL.map((c) => [c, v]));
  return {
    players: [
      { name: 'Host', scores: fill(mine), bonusTotal: 0 },
      { name: 'Guest', scores: fill(theirs), bonusTotal: 0 },
    ],
    current: 0,
    dice: [1, 2, 3, 4, 5].map((v) => ({ value: v, held: false })),
    rollsUsed: 0,
    yahtzeeBonusCount: [0, 0],
    gameOver: true,
  };
}

// ---- 1. THE BUG: the match ends for this device via a recovery snapshot -------------------
// This device is the guest, stuck in awaitingRecovery since before the last turn, so endTurn()
// (the only caller of commitStatsOnce) never runs for the move that ended the match.
T.newGame({ role: 'guest', code: 'TESTRM', opp: { deviceId: 'opp-device-1', name: 'Opponent' }, dealer: 0, hostName: 'Host', guestName: 'Guest' });
T.getState().mp.awaitingRecovery = true;
T.mpApplyRecovery({ seq: 12, state: finishedSnapshot(5, 3) });
ok(played() === 1, `[KNOWN-BUG PROBE] a match that ended via a resync IS recorded (played === 1, got ${played()}) - before the fix this stayed 0 and the whole match vanished`);
ok(T.getState().statsCommitted === true, 'the guard is set after the resync path records');

// A second recovery for the same match (a retry, or the room re-publishing) records nothing new.
T.mpApplyRecovery({ seq: 13, state: finishedSnapshot(5, 3) });
ok(played() === 1, `a repeat resync for the same match records nothing new (played === 1, got ${played()})`);

// ---- 2. The guard still only covers ONE match ---------------------------------------------
// newGame() builds a fresh state object, so statsCommitted resets with it. If that ever stops
// being true, every match after the first in a session goes unrecorded (the Dots and Boxes /
// Filler bug of 2026-07-30, in the game that shares this guard's shape).
for (let i = 2; i <= 4; i++) {
  T.newGame({ role: 'guest', code: 'TESTRM', opp: { deviceId: 'opp-device-1', name: 'Opponent' }, dealer: 0, hostName: 'Host', guestName: 'Guest' });
  T.getState().mp.awaitingRecovery = true;
  T.mpApplyRecovery({ seq: 12 + i, state: finishedSnapshot(3, 5) });
  ok(played() === i, `[KNOWN-BUG PROBE] match ${i} of a session recorded too (played === ${i}, got ${played()})`);
}

// ---- 3. The ordinary route still records exactly once --------------------------------------
// A device that finished normally (endTurn -> commitStatsOnce) must not be re-credited when the
// recovery snapshot for that same match lands afterwards.
T.newGame();
T.mpCommitStatsOnce();                        // stands in for endTurn's gameOver branch
ok(played() === 5, `the normal end-of-match path records (played === 5, got ${played()})`);
T.getState().mp = null;
T.mpCommitStatsOnce();
ok(played() === 5, `and does not record twice (played === 5, got ${played()})`);

console.log(`\nYahtzee stats regression: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
