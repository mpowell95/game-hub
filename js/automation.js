// js/automation.js - is this page driven by TEST AUTOMATION (Playwright, Puppeteer, Selenium)? Every WebDriver-
// controlled browser sets `navigator.webdriver` (the W3C WebDriver spec); a person's browser never does. Claude
// sessions test with Playwright, which sets it.
//
// Matt, 2026-10-29, after a session's test browser became a player ("Smokey"): "make it so the app lets test
// automations play anything and always ignore their scores/rounds etc". So, when this is true:
//   * NOTHING is written to Firebase: stats sync, names, Messages, push, admin settings, bug reports, Spelling Bee
//     boards and logs, challenges, careers, the retired challenge (every writer's guard calls this; no override).
//   * no online play (js/online-gate.js), and
//   * every game is on the launcher, admin-only ones too (js/hub.js), so a test can reach anything.
// Play is still recorded on the test browser's own storage (the games need it to work); it never leaves it.
// Dependency-free on purpose: every writer imports it.

/** True in a WebDriver-controlled browser. Never throws; false anywhere without a `navigator`. */
export function isAutomation() {
  try { return typeof navigator !== 'undefined' && navigator.webdriver === true; } catch { return false; }
}

let warned = false;
/** The writers' guard: true = BLOCK this write. Logs once per page. */
export function automationBlocks(what) {
  if (!isAutomation()) return false;
  if (!warned) { warned = true; console.warn(`[automation] ${what} BLOCKED: test automation never writes to the family database (js/automation.js).`); }
  return true;
}
