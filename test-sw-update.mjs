#!/usr/bin/env node
// test-sw-update.mjs (2026-09-01) - does the app notice its own update?
//
// THE INCIDENT. Matt filmed a version chip reading "v551 -> v552" that never resolved. Tapping it
// flashed "Checking..." and came straight back; only force-quitting the app cleared it. Nothing was
// broken - the device had ALREADY updated itself. js/hub.js painted the chip once at load and
// subscribed to nothing, so a successful update could not reach it, and the tap handler read the
// controller before the new worker had activated and then reloaded into the same stale screen.
//
// WHY THIS IS A BROWSER TEST AND NOT A STRUCTURAL ONE. The defect is a RACE between the service
// worker lifecycle and the page, and every part of it (install, skipWaiting, activate, claim,
// controllerchange) only exists in a real browser. Reading hub.js as text can prove a listener is
// present; only this can prove the chip ends up telling the truth.
//
// It serves a COPY of the repo from a temp dir and edits that copy's sw.js + version.json to
// simulate a deploy - the working tree is never touched.
//
//   node test-sw-update.mjs            # all cases
//
// SKIPs (exit 0) without playwright-core or Chromium, like test-visual.mjs.

import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = new URL('.', import.meta.url).pathname;
const PORT = 8137;
const FROM = 'game-hub-v551';
const TO = 'game-hub-v552';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('SKIP: playwright-core not installed'); process.exit(0); }

let passed = 0; const failures = [];
const ok = (name, cond, why = '') => {
  if (cond) { passed++; console.log(`ok    ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${why ? `\n        ${why}` : ''}`); }
};

const site = mkdtempSync(join(tmpdir(), 'gh-swupdate-'));
cpSync(REPO, site, {
  recursive: true,
  filter: (src) => !/(^|\/)(\.git|node_modules|\.visual-out|backups)(\/|$)/.test(src.slice(REPO.length)),
});
// Pin the copy to the OLD version whatever the working tree says, so the test is about the
// transition and not about which build happens to be checked out.
const setVersion = (v) => {
  const p = join(site, 'sw.js');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/game-hub-v\d+/g, v));
  writeFileSync(join(site, 'version.json'), `${JSON.stringify({ cache: v }, null, 2)}\n`);
};
setVersion(FROM);

const srv = spawn('node', ['server.mjs'], { cwd: site, stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } });
let browser;
const cleanup = () => {
  try { browser && browser.close(); } catch { /* going away anyway */ }
  try { srv.kill(); } catch { /* ditto */ }
  try { rmSync(site, { recursive: true, force: true }); } catch { /* temp dir */ }
};
process.on('exit', cleanup);

const BASE = `http://localhost:${PORT}/`;
await new Promise((r) => setTimeout(r, 1200));

browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  .catch(() => null);
if (!browser) { console.log('SKIP: no Chromium at /opt/pw-browsers/chromium'); process.exit(0); }

const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'SW Probe', emoji: '🎯' }));
  });
  return page;
};
// GUARD: THE THING UNDER TEST NAVIGATES. The whole point of the fix is that the page reloads
// itself onto the new build, so any evaluate() can land exactly as that happens and throw
// "Execution context was destroyed". A poll that propagates that failure is testing its own
// timing, not the app - so a torn-down context reads as "no answer yet" and the poll comes back.
const settle = (p) => p.catch(() => null);
const chip = (page) => settle(page.evaluate(() => {
  const el = document.querySelector('[data-role="version"]');
  return el && !el.hidden ? el.textContent.trim() : null;
}));
const controller = (page) => settle(page.evaluate(() => new Promise((res) => {
  const c = navigator.serviceWorker.controller;
  if (!c) return res(null);
  const ch = new MessageChannel();
  const t = setTimeout(() => res(null), 2000);
  ch.port1.onmessage = (e) => { clearTimeout(t); res((e.data && e.data.cache) || null); };
  c.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
})));
/** Poll until `fn` is truthy or the budget runs out. Returns how long it took, or -1. */
const until = async (page, fn, ms = 30000, step = 500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return Date.now() - t0;
    await page.waitForTimeout(step);
  }
  return -1;
};

// --- case 1: a deploy while the launcher is open -------------------------------------------------
{
  const page = await newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await until(page, async () => (await controller(page)) === FROM, 20000);
  ok('the probe starts on the old build', (await controller(page)) === FROM, `controller was ${await controller(page)}`);

  setVersion(TO);                       // THE DEPLOY
  await page.goto(BASE, { waitUntil: 'load' });   // he reopens the app

  // [KNOWN-BUG PROBE] The chip must end up telling the truth WITHOUT a manual reload. Before the
  // fix it sat on "v551 → v552" for ever, on a device already running v552.
  const took = await until(page, async () => {
    const c = await chip(page);
    return c === 'v552' || (c && /^v552\b/.test(c));
  }, 40000);
  ok('[KNOWN-BUG PROBE] the chip reads the NEW version without a manual reload',
    took >= 0,
    `after 40s the chip still read ${JSON.stringify(await chip(page))} while the controller was `
    + `${await controller(page)} - the chip is not listening to the worker lifecycle`);
  ok('the chip never settles on a stale "old → new" arrow',
    !/→/.test((await chip(page)) || ''),
    `chip: ${JSON.stringify(await chip(page))}`);
  await page.context().close();
}

// --- case 2: a deploy while a GAME is open must not interrupt it ---------------------------------
{
  setVersion(FROM);
  const page = await newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await until(page, async () => (await controller(page)) === FROM, 20000);

  // Open a game and mark the document, so a reload is detectable by the mark disappearing.
  await settle(page.evaluate(() => { window.__mark = 'alive'; }));
  await page.waitForSelector('button.hub-card[data-id]', { timeout: 20000 }).catch(() => {});
  const opened = await page.evaluate(async () => {
    // A module game only: a launch-out card is an <a> and would navigate away, which is a
    // different thing entirely. Connect Four is the lightest module game in the hub.
    const card = document.querySelector('button.hub-card[data-id="connect-four"]')
      || document.querySelector('button.hub-card[data-id][data-coming-soon="false"]');
    if (!card) return null;
    card.click();
    for (let i = 0; i < 40 && !document.querySelector('.cf-root, .hub-game > *'); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    return document.querySelector('.cf-root, .hub-game > *') ? 'mounted' : null;
  }).catch((e) => `evaluate threw: ${String(e).slice(0, 120)}`);
  setVersion(TO);                       // deploy WHILE they are playing
  await settle(page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update())));
  await page.waitForTimeout(12000);

  const survived = await settle(page.evaluate(() => window.__mark === 'alive'));
  ok('[KNOWN-BUG PROBE] a new build never reloads the page while a game is open',
    opened === 'mounted' ? survived : true,
    opened === 'mounted'
      ? 'the document was replaced while a game was mounted - a player mid-rack would have lost the screen'
      : 'could not mount a game to test with (probe inconclusive, not a pass of the real check)');
  ok('a game was actually mounted for that check', opened === 'mounted',
    'no game card mounted, so the no-interrupt case above proved nothing');
  await page.context().close();
}

console.log(`\nService worker update: ${passed} passed, ${failures.length} failed.`);
if (failures.length) for (const f of failures) console.log(`  - ${f}`);
// EXIT EXPLICITLY. The Chromium instance and the dev server both keep the event loop alive, so
// without this a PASSING run never returns and looks exactly like a hang.
cleanup();
process.exit(failures.length ? 1 : 0);
