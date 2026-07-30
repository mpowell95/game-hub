// test-filler-stats.mjs — regression guard for the same class of bug fixed in Dots and Boxes
// 2026-07-30 (dots-boxes/CLAUDE.md, "Bug: solo results stopped recording after the first game of
// a session"): a full audit of every game with a `_statsCommitted`-style idempotence guard found
// Filler had the IDENTICAL bug. Solo startGame() never reset `_statsCommitted`, so finish()'s
// `if (!this._statsCommitted)` silently stopped recording after the first game of a session —
// every "Play again"/Restart/New game rematch recorded NOTHING, win, loss or tie. The MP rematch
// path (_mpApplyRoundRecord) already reset this same flag; solo's equivalent just never did.
//
// Drives the REAL ui.js (not a mirror) through three consecutive solo games in one mounted
// session and asserts the stats store's `played` count increments after every game. Optional
// dependency, same pattern as smoke-ui.mjs/test-dotsboxes-stats.mjs: skip cleanly if jsdom isn't
// installed.
let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('SKIP  test-filler-stats.mjs: optional dependency \'jsdom\' not installed'); process.exit(0); }

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://example.test/filler/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.location = dom.window.location;
dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
global.matchMedia = dom.window.matchMedia;

const { init } = await import('./filler/js/ui.js');
const { legalColors, applyMove } = await import('./filler/js/game.js');
const { loadStats } = await import('./js/game-stats.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } };

/** Play the instance's current game to completion via the real engine, then call finish()
 *  directly (bypassing the UI's animation-scheduling delay, which is irrelevant to this test —
 *  finish() is where the _statsCommitted guard lives). Who wins is irrelevant: the bug dropped
 *  EVERY result, win, loss or tie. */
function playToEnd(instance) {
  const s = instance.state;
  while (!s.over) applyMove(s, legalColors(s)[0]);
  instance.finish();
}

const instance = init(document.getElementById('app'));

instance.startGame();
playToEnd(instance);
const played1 = loadStats().games.filler.total.played;
ok(played1 === 1, `first game recorded (played === 1, got ${played1})`);

instance.startGame();
playToEnd(instance);
const played2 = loadStats().games.filler.total.played;
ok(played2 === 2, `[KNOWN-BUG PROBE] second game (via startGame(), the Play again path) also recorded (played === 2, got ${played2}) - before the fix this stayed at 1 forever`);

instance.startGame();
playToEnd(instance);
const played3 = loadStats().games.filler.total.played;
ok(played3 === 3, `third consecutive game recorded (played === 3, got ${played3})`);

console.log(`\nFiller stats regression: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
