// test-battlearena-tips.mjs - Battle Arena's first-match tutorial (2026-11-15, Matt: Ana "didn't really know what was going
// on"). A fresh phone: hp, moves and swap show one after another on the first turn, each blocks the board until Got it;
// charge, berry, evolve, extra and bomb show the first time each matters; each shows ONCE (settings.tips) and is reported
// (gamehub.tipsLog.v1, js/tips-log.js). A phone that has seen them all sees none. Localhost only, test profile.
//   PORT=8123 node server.mjs &
//   NODE_PATH=$(npm root -g) BASE=http://localhost:8123 node tools/test-battlearena-tips.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const BASE = process.env.BASE || 'http://localhost:8123';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('ok   ' + n); } else { fail++; console.log('FAIL ' + n + (x ? '  ' + x : '')); } };
const ALL = ['hp', 'moves', 'swap', 'charge', 'berry', 'evolve', 'extra', 'bomb'];

const browser = await pw.chromium.launch();
async function start(seen) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.addInitScript((seen) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🦊', playerId: 'DREG5', opponents: [] }));
    localStorage.setItem('gamehub.devAllowSync.v1', '0');
    if (seen) localStorage.setItem('gamehub.battlearena.v1', JSON.stringify({ tips: Object.fromEntries(seen.map((k) => [k, 1])) }));
  }, seen || null);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/battle-arena/');
  await page.waitForFunction(() => window.__baTest && window.__baTest.screen === 'home');
  await page.evaluate(() => window.__baTest.startMatch(['sproutle', 'cinderwing']));
  return { ctx, page, errs };
}
const tipNow = (page) => page.evaluate(() => (window.__baTest._tip ? window.__baTest._tip.id : null));
const waitTip = (page, id) => page.waitForFunction((id) => window.__baTest._tip && window.__baTest._tip.id === id, id, { timeout: 15000 }).then(() => true, () => false);

{
  const { ctx, page, errs } = await start(null);
  for (const id of ['hp', 'moves', 'swap']) {
    ok(`fresh phone, first turn: "${id}" shows`, await waitTip(page, id), String(await tipNow(page)));
    ok(`"${id}" blocks the board`, await page.evaluate(() => !window.__baTest.canInput()));
    const ring = await page.evaluate(() => { const r = document.querySelector('.ba-coach-ring').getBoundingClientRect(); return r.width > 10 && r.height > 10; });
    ok(`"${id}" rings its target`, ring);
    const inside = await page.evaluate(() => { const r = document.querySelector('.ba-coach-bubble').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
    ok(`"${id}" bubble on screen`, inside);
    if (id === 'hp') ok('"hp" rings BOTH health numbers, an arrow at each', await page.evaluate(() => document.querySelectorAll('.ba-coach-ring').length === 2 && document.querySelectorAll('.ba-coach-arrow').length === 2));
    if (id === 'swap') ok('"swap" boxes a real 3-in-a-row and circles the tile to move', await page.evaluate(() => { const u = window.__baTest, ln = u.tipLine(3); return !!ln && ln.line.length === 3 && !!document.querySelector('.ba-coach-ring.is-box') && !!document.querySelector('.ba-coach-ring.is-round'); }));
    await page.click('[data-role="tip-ok"]');
  }
  ok('after the first-turn tips the board takes input', await page.evaluate(() => window.__baTest.canInput() && !window.__baTest._tip));
  const steps = [
    ['charge', () => { const u = window.__baTest; u.state.sides[0].mons[0].energy = 2; u.syncAll(); u.checkTips(); }],
    ['berry', () => { const u = window.__baTest; u.state.sides[0].berries = 1; u.syncAll(); u.checkTips(); }],
    ['evolve', () => { const u = window.__baTest; u.state.sides[0].berries = 4; u.syncAll(); u.checkTips(); }],
    ['extra', () => { const u = window.__baTest; u._sawExtra = true; u.checkTips(); }],
    ['bomb', () => { const u = window.__baTest; const t = u.state.board[30]; t.k = 'bomb'; t.n = 5; u.syncTiles(); u.checkTips(); }],
  ];
  for (const [id, fn] of steps) {
    await page.evaluate(fn);
    ok(`"${id}" shows when it first matters`, await waitTip(page, id), String(await tipNow(page)));
    if (id === 'bomb') ok('"bomb" boxes its row and column', await page.evaluate(() => document.querySelectorAll('.ba-coach-ring.is-box').length === 2));
    await page.click('[data-role="tip-ok"]');
  }
  const st = await page.evaluate(() => ({ tips: JSON.parse(localStorage.getItem('gamehub.battlearena.v1')).tips, log: JSON.parse(localStorage.getItem('gamehub.tipsLog.v1') || '{}').battlearena || {} }));
  ok('each tip saved as seen', ALL.every((k) => st.tips[k] === 1), JSON.stringify(st.tips));
  ok('each tip reported shown once and done', ALL.every((k) => st.log[k] && st.log[k].n === 1 && st.log[k].s > 0 && st.log[k].d >= st.log[k].s), JSON.stringify(st.log));
  // A new match on the same phone: none again.
  await page.evaluate(() => window.__baTest.startMatch(['driplet', 'hexowl']));
  await page.waitForFunction(() => window.__baTest.canInput(), null, { timeout: 15000 }).catch(() => {});
  ok('second match: no tip', (await tipNow(page)) === null);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const { ctx, page, errs } = await start(ALL);
  await page.waitForFunction(() => window.__baTest.canInput(), null, { timeout: 15000 }).catch(() => {});
  ok('a phone that saw them all: no tip, board takes input', (await tipNow(page)) === null && await page.evaluate(() => window.__baTest.canInput()));
  ok('no page errors (seen phone)', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  // A live room (25 s clock): the tip never blocks.
  const { ctx, page } = await start(null);
  await waitTip(page, 'hp');
  await page.evaluate(() => { const u = window.__baTest; u.hideTip(false); u.timed = true; u.checkTips(); });
  ok('timed match: the tip shows but does not block', (await tipNow(page)) === 'hp' && await page.evaluate(() => window.__baTest.canInput()));
  await ctx.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
