// test-dotsboxes-stats.mjs — regression guard for the 2026-07-30 bug (dots-boxes/CLAUDE.md,
// "Bug: solo results stopped recording after the first game of a session"): solo startGame()
// never reset _statsCommitted, so recordDotsBoxes() silently stopped running after the first
// game of a session — every "Play again"/Restart/change-settings rematch recorded NOTHING,
// win or lose. A real player (TP) had this happen for real; nothing was recoverable because
// nothing was ever written (THE LAW rule 4 - no data to carry forward, only a write-path fix).
//
// This test drives the REAL ui.js (not a mirror) through two consecutive solo games in one
// mounted session, exactly the "Play again" shape that broke, and asserts the stats store's
// `played` count increments after BOTH games, not just the first. Optional dependency, same
// pattern as smoke-ui.mjs/smoke-match.mjs: skip cleanly if jsdom isn't installed.
let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('SKIP  test-dotsboxes-stats.mjs: optional dependency \'jsdom\' not installed'); process.exit(0); }

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://example.test/dots-boxes/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;

const { init } = await import('./dots-boxes/js/ui.js');
const { legalMoves, applyMove, isOver } = await import('./dots-boxes/js/game.js');
const { loadStats } = await import('./js/game-stats.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };

/** Play the instance's current game to completion via the real engine (any legal moves; who
 *  wins is irrelevant to this test - the bug dropped EVERY result, win, loss or tie), then run
 *  the same post-move funnel a real move triggers so finish()/_commitStats() actually fires. */
function playToEnd(instance) {
  const s = instance.state;
  while (!isOver(s)) applyMove(s, legalMoves(s)[0]);
  instance._afterStateChange(false);
}

const instance = init(document.getElementById('app'));

instance.startGame();
playToEnd(instance);
const played1 = loadStats().games.dotsboxes.total.played;
ok(played1 === 1, `first game recorded (played === 1, got ${played1})`);

// The exact regression shape: Play again / Restart / change-settings all call startGame() again
// on this SAME instance without remounting - never a fresh DotsBoxesUI (that only happens via
// destroy()+init(), i.e. leaving and reopening the game).
instance.startGame();
playToEnd(instance);
const played2 = loadStats().games.dotsboxes.total.played;
ok(played2 === 2, `[KNOWN-BUG PROBE] second game (via startGame(), the Play again path) also recorded (played === 2, got ${played2}) - before the fix this stayed at 1 forever`);

// A third, to be sure it's not just "resets once then breaks again."
instance.startGame();
playToEnd(instance);
const played3 = loadStats().games.dotsboxes.total.played;
ok(played3 === 3, `third consecutive game recorded (played === 3, got ${played3})`);

console.log(`\nDots and Boxes stats regression: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
