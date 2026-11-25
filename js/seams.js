// js/seams.js - TEST SEAMS EXIST ONLY ON A DEV SERVER (2026-11-24, Matt: "How the fuck are we allowing him
// to run a script to get better scores"). Until this day most games put their insides on `window`
// (`window.__sbTest.answers` = the day's Spelling Bee answers, `__sdTest.game` = the Sudoku solution,
// `__twTest.drop()`, `__ghHub` = the hub and through it the mounted game), on the LIVE site too, so a
// Safari tab or a computer browser could read answers or drive a game from the developer console. King of
// Games' two scripted Snake 62s (Nov 17: 223 and 242 turns from ONE tap) were made that way.
//
// Now a seam is set only on localhost / 127.0.0.1 (the dev server every test uses). The live site has none.
// `tools/test-no-seams.mjs` fails any game file that assigns `window.__…` itself.
//
// The hub reference Messages needs (open a game from an invite) is kept in this module, never on window.

export const DEV_SEAMS = (() => {
  try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); } catch { return false; }
})();

/** Put `value` on window[name] for the test tools, on a dev server only. */
export function exposeSeam(name, value) {
  if (!DEV_SEAMS) return;
  try { window[name] = value; } catch { /* no window */ }
}

let _hub = null;
/** The running hub (js/hub.js sets it). Not on window; a console can still import this module (every public file can be
 *  imported), so nothing here is a lock: client evidence is advisory, the server cross-checks it (functions/evidence.js). */
export function setHubRef(hub) { _hub = hub || null; }
export function hubRef() { return _hub; }

export default { DEV_SEAMS, exposeSeam, setHubRef, hubRef };
