// test-battlearena-tips.mjs - Battle Arena's first-match tutorial (2026-11-15/16, Matt: Ana "didn't really know what was going
// on"; "tell them to do it ... have them collect them ... we should do that everywhere"). A fresh phone against the computer,
// played for real: "yours" (Got it), the GUIDED first swap (only that swap works, no Got it), what the gems did (real numbers),
// moves left, the other side's first turn (a note that goes by itself); later turns: guided 4 in a row / berries / bomb, each
// explained after it happens; evolve = tap the monster; the arena button. Each once (settings.tips), reported
// (gamehub.tipsLog.v1). Online: nothing guided. A timed room never blocks. Localhost only, test profile.
//   PORT=8123 node server.mjs &
//   NODE_PATH=$(npm root -g) BASE=http://localhost:8123 node tools/test-battlearena-tips.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const BASE = process.env.BASE || 'http://localhost:8123';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('ok   ' + n); } else { fail++; console.log('FAIL ' + n + (x ? '  ' + x : '')); } };

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
const waitTip = (page, id, ms = 15000) => page.waitForFunction((id) => window.__baTest._tip && window.__baTest._tip.id === id, id, { timeout: ms }).then(() => true, () => false);
const myTurnIdle = (page) => page.waitForFunction(() => { const u = window.__baTest; return u.state.turn === 0 && !u.busy && u.state.winner == null; }, null, { timeout: 30000 });
const gotIt = (page) => page.click('[data-role="tip-ok"]');
const noButton = (page) => page.evaluate(() => !document.querySelector('[data-role="tip-ok"]'));
// Put a board up that has the line we want (cells -> kinds); bombs get a count.
const rig = (page, cells) => page.evaluate((cells) => { const u = window.__baTest; for (const [i, k] of Object.entries(cells)) { u.state.board[i].k = k; if (k === 'bomb') u.state.board[i].n = 4; } u.syncTiles(); }, cells);

{
  const { ctx, page, errs } = await start(null);
  ok('fresh phone: "yours" first (whose monsters + health)', await waitTip(page, 'yours'), String(await tipNow(page)));
  ok('"yours" rings both monsters and both health numbers', await page.evaluate(() => document.querySelectorAll('.ba-coach-ring').length === 4));
  ok('"yours" blocks the board', await page.evaluate(() => !window.__baTest.canInput()));
  await gotIt(page);
  ok('then the GUIDED first swap', await waitTip(page, 'doSwap'), String(await tipNow(page)));
  ok('guided: no Got it, the board takes input', (await noButton(page)) && await page.evaluate(() => window.__baTest.canInput()));
  const g = await page.evaluate(() => window.__baTest._tip.tg.guide);
  ok('guided: two tiles ringed, the line boxed, a two-way arrow', await page.evaluate(() => document.querySelectorAll('.ba-coach-ring.is-round').length === 2 && !!document.querySelector('.ba-coach-ring.is-line') && !!document.querySelector('.ba-coach-swaparrow line')));
  const own = await page.evaluate((g) => { const u = window.__baTest; const b = u.state.board.slice(); const t = b[g.from]; b[g.from] = b[g.into]; b[g.into] = t; return u.myKinds().includes(b[g.line[0]].k); }, g);
  const ownAvail = await page.evaluate(() => !!window.__baTest.tipMove({ kinds: window.__baTest.myKinds() }));
  ok('guided: the line is one of the player\'s own colors whenever the board has one', own || !ownAvail);
  ok('guided: the bubble sits above the board', await page.evaluate(() => document.querySelector('.ba-coach-bubble').getBoundingClientRect().bottom <= document.querySelector('.ba-board').getBoundingClientRect().top));
  // Another legal swap is refused.
  const before = await page.evaluate(() => JSON.stringify(window.__baTest.state.board.map((t) => t.id)));
  await page.evaluate((g) => { const u = window.__baTest; const E = u.state; const other = [...Array(35).keys()].flatMap((i) => [[i, i + 1], [i, i + 7]]).find(([a, b]) => b < 35 && (a % 7 !== 6 || b !== a + 1) && !((a === g.from && b === g.into) || (a === g.into && b === g.from)) && u.state.board[a].k !== u.state.board[b].k); return u.trySwap(other[0], other[1]); }, g);
  await page.waitForTimeout(600);
  ok('guided: any other swap is refused (nothing moves)', before === await page.evaluate(() => JSON.stringify(window.__baTest.state.board.map((t) => t.id))) && (await tipNow(page)) === 'doSwap');
  await page.evaluate((g) => window.__baTest.trySwap(g.from, g.into), g);
  await page.waitForFunction(() => !window.__baTest.busy, null, { timeout: 15000 });
  const after = await tipNow(page);
  ok('the guided swap plays out, then it is explained (charged; the power if the bar filled; moves left if no own color)', own ? (after === 'charged' || after === 'power') : after === 'movesLeft' || after === 'extraMove', String(after));
  if (after === 'charged') ok('"charged" has the real numbers', await page.evaluate(() => /\d+\u00a0of\u00a0\d+/.test(document.querySelector('.ba-coach-bubble p').textContent)));
  let sawMoves = after === 'movesLeft';
  for (let k = 0; k < 4 && !sawMoves && await page.$('[data-role="tip-ok"]'); k++) { await gotIt(page); await page.waitForTimeout(150); sawMoves = (await tipNow(page)) === 'movesLeft'; }
  ok('then moves left', sawMoves, String(await tipNow(page)));
  if (await page.$('[data-role="tip-ok"]')) await gotIt(page);
  // (a lucky cascade can add another explained tip this turn: an extra move, a power)
  for (let k = 0; k < 4 && await page.$('[data-role="tip-ok"]'); k++) { await gotIt(page); await page.waitForTimeout(150); }
  ok('after the first-turn tips the board is free', await page.evaluate(() => window.__baTest.canInput() && !window.__baTest._tip));
  // Any legal move ends the turn: the other side's note shows (no button), then goes by itself.
  // Play out the rest of the turn (an extra move can leave one more), then the computer's turn starts.
  for (let k = 0; k < 16; k++) {
    const st = await page.evaluate(() => { const u = window.__baTest; return { turn: u.state.turn, busy: u.busy }; });
    if (st.turn !== 0) break;
    if (st.busy) { await page.waitForTimeout(200); continue; }
    if (await page.$('[data-role="tip-ok"]')) { await gotIt(page); continue; }
    await page.evaluate(async () => { const u = window.__baTest; const E = await import('/battle-arena/js/engine.js'); const g = u._tip && u._tip.tg.guide; const m = g ? { a: g.from, b: g.into } : E.legalMoves(u.state)[0]; await u.trySwap(m.a, m.b); });
    if (await page.evaluate(() => window.__baTest.state.turn !== 0)) break;   // trySwap returns as the computer's turn starts
  }
  ok('the computer\'s first turn: a note at its name, no button', await waitTip(page, 'theirTurn', 20000) && await noButton(page));
  ok('the note never blocks', await page.evaluate(() => window.__baTest._tip.block === false));
  await myTurnIdle(page);
  await page.waitForTimeout(300);
  ok('the note is gone on the player\'s turn, and saved as seen', await page.evaluate(() => (!window.__baTest._tip || window.__baTest._tip.id !== 'theirTurn') && JSON.parse(localStorage.getItem('gamehub.battlearena.v1')).tips.theirTurn === 1));
  // Clear whatever turn-2 tip came up, then rig each guided step.
  for (let k = 0; k < 6 && await tipNow(page); k++) { if (await page.$('[data-role="tip-ok"]')) await gotIt(page); else await page.evaluate(() => window.__baTest.hideTip(true)); await page.waitForTimeout(150); }
  // Guided 4 in a row (a new turn's guided slot)
  await myTurnIdle(page);
  await page.evaluate(() => { const u = window.__baTest; u.hideTip(false); u.settings.tips.arena = 1; delete u.settings.tips.doExtra; u._myTurns = Math.max(2, u._myTurns); u._guidedOn = null; u.settings.tips.extraMove = 0; u._sawExtra = false; u.state.extraUsed = false; u.state.movesLeft = 2; });
  await rig(page, { 28: 'fire', 29: 'fire', 30: 'fire', 31: 'water', 32: 'spark', 24: 'fire', 23: 'shadow', 25: 'leaf', 17: 'spark' });
  await page.evaluate(() => { const u = window.__baTest; for (const k of ['power', 'berries', 'doEvolve', 'boom', 'charged', 'movesLeft']) u.settings.tips[k] = 1; delete u.settings.tips.extraMove; u.checkTips(); });
  ok('guided 4 in a row', await waitTip(page, 'doExtra', 3000), String(await tipNow(page)));
  const gx = await page.evaluate(() => window.__baTest._tip.tg.guide);
  await page.evaluate((g) => window.__baTest.trySwap(g.from, g.into), gx);
  await page.waitForFunction(() => !window.__baTest.busy, null, { timeout: 15000 });
  ok('then "4 in a row: 1 extra move!"', await waitTip(page, 'extraMove', 3000), String(await tipNow(page)));
  await gotIt(page);
  // Guided berries
  await myTurnIdle(page);
  await page.evaluate(() => { const u = window.__baTest; u.hideTip(false); u._guidedOn = null; delete u.settings.tips.doBerry; u._myTurns = Math.max(2, u._myTurns); delete u.settings.tips.berries; u.state.sides[0].berries = 0; u.state.movesLeft = Math.max(1, u.state.movesLeft); });
  await rig(page, { 28: 'berry', 29: 'berry', 30: 'water', 31: 'fire', 23: 'berry', 22: 'spark', 24: 'shadow', 21: 'leaf' });
  await page.evaluate(() => window.__baTest.checkTips());
  ok('guided berries', await waitTip(page, 'doBerry', 3000), String(await tipNow(page)));
  const gb = await page.evaluate(() => window.__baTest._tip.tg.guide);
  await page.evaluate((g) => window.__baTest.trySwap(g.from, g.into), gb);
  await page.waitForFunction(() => !window.__baTest.busy && window.__baTest.state.turn === 0, null, { timeout: 30000 }).catch(() => {});
  await myTurnIdle(page);
  await page.waitForTimeout(300);
  if (await tipNow(page) === 'theirTurn') await page.evaluate(() => window.__baTest.hideTip(true));
  await page.evaluate(() => window.__baTest.checkTips());
  ok('then berries explained with the count', await waitTip(page, 'berries', 3000) && await page.evaluate(() => /\d+\u00a0of\u00a04/.test(document.querySelector('.ba-coach-bubble p').textContent)), String(await tipNow(page)));
  await gotIt(page);
  // Evolve: tap the monster
  await myTurnIdle(page);
  await page.evaluate(() => { const u = window.__baTest; u.hideTip(false); delete u.settings.tips.doEvolve; u.state.sides[0].berries = 4; u.state.movesLeft = 2; u.syncAll(); u.checkTips(); });
  ok('evolve: "Tap X to evolve it", no button', await waitTip(page, 'doEvolve', 3000) && await noButton(page), String(await tipNow(page)));
  const mi = await page.evaluate(() => window.__baTest._tip.tg.tap);
  ok('evolve step: board swaps wait for the tap', await page.evaluate(() => !window.__baTest.guideAllows(0, 1)));
  await page.click(`.ba-mon[data-side="0"][data-mon="${mi}"]`, { force: true });
  await page.waitForTimeout(400);
  ok('tapping it opens the evolve preview and the step is done', await page.evaluate(() => !!document.querySelector('.ba-root .gh-overlay') && JSON.parse(localStorage.getItem('gamehub.battlearena.v1')).tips.doEvolve === 1));
  await page.evaluate(() => { for (const o of document.querySelectorAll('.ba-root .gh-overlay')) o.remove(); });
  // Guided bomb
  await myTurnIdle(page);
  await page.evaluate(() => { const u = window.__baTest; u.hideTip(false); u._guidedOn = null; u._sawBoom = false; delete u.settings.tips.doBomb; u._myTurns = Math.max(2, u._myTurns); delete u.settings.tips.boom; u.state.movesLeft = 2; u.state.sides[0].berries = 0; });
  await rig(page, { 22: 'bomb', 28: 'spark', 29: 'spark', 30: 'water', 31: 'fire', 23: 'spark', 24: 'shadow', 21: 'leaf', 15: 'fire' });
  await page.evaluate(() => { window.__baTest.settings.tips.arena = 1; window.__baTest.checkTips(); });
  ok('guided bomb', await waitTip(page, 'doBomb', 3000), String(await tipNow(page)));
  const gm = await page.evaluate(() => window.__baTest._tip.tg.guide);
  await page.evaluate((g) => window.__baTest.trySwap(g.from, g.into), gm);
  await page.waitForFunction(() => !window.__baTest.busy, null, { timeout: 15000 });
  ok('then "Boom!" explained', await waitTip(page, 'boom', 3000), String(await tipNow(page)));
  await gotIt(page);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('gamehub.tipsLog.v1') || '{}').battlearena || {});
  ok('every tip shown is reported shown and done', Object.values(log).every((r) => r.s > 0 && r.d >= r.s), JSON.stringify(log));
  // Online: nothing guided.
  const online = await page.evaluate(() => { const u = window.__baTest; const keep = u.link; u.settings.tips = { yours: 1 }; u._myMoves = 0; u.link = { kind: 'cpu-test' }; const t = u.nextTip(); u.link = keep; return t && t.id; });
  ok('online: the first swap is not guided', online !== 'doSwap', String(online));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const ALL = ['yours', 'doSwap', 'charged', 'movesLeft', 'power', 'extraMove', 'berries', 'doEvolve', 'boom', 'doExtra', 'doBerry', 'doBomb', 'arena', 'theirTurn'];
  const { ctx, page, errs } = await start(ALL);
  await page.waitForFunction(() => window.__baTest.canInput(), null, { timeout: 15000 }).catch(() => {});
  ok('a phone that saw them all: no tip, board takes input', (await tipNow(page)) === null && await page.evaluate(() => window.__baTest.canInput()));
  ok('no page errors (seen phone)', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await start(null);
  await waitTip(page, 'yours');
  await page.evaluate(() => { const u = window.__baTest; u.hideTip(false); u.timed = true; u.checkTips(); });
  ok('timed match: the tip shows but does not block', (await tipNow(page)) === 'yours' && await page.evaluate(() => window.__baTest.canInput()));
  await ctx.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
