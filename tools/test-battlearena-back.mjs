// test-battlearena-back.mjs - Battle Arena's back step (2026-11-13, Matt: "make sure it has the swipe to go back
// feature we added to all of the screens in the new leaderboard"). Real touch swipes (CDP Input.dispatchTouchEvent,
// the leaderboard's own test method, tools/test-lb2-swipe.mjs), the phone's back gesture (history.back()) and the
// hub's top-left button, on every screen with a step: Monsters, a monster card, How to play, the draft, the battle's
// menu, and the online screens. Nothing leaves localhost; the profile is the test profile (test1 / DREG5).
//   PORT=8123 node server.mjs &
//   NODE_PATH=$(npm root -g) BASE=http://localhost:8123 node tools/test-battlearena-back.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
const BASE = process.env.BASE || 'http://localhost:8123';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('ok   ' + n); } else { fail++; console.log('FAIL ' + n + (x ? '  ' + x : '')); } };

const browser = await pw.chromium.launch();
async function open(url) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🦊', playerId: 'DREG5', opponents: [] }));
    localStorage.setItem('gamehub.devAllowSync.v1', '0');
    window.__labels = [];
    window.addEventListener('gamehub:backlabel', (e) => window.__labels.push(!!e.detail));
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errs };
}
async function swipe(w, { x0 = 120, y0 = 420, dx = 150, dy = 4, ms = 260, steps = 10 } = {}) {
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 0.5 }];
  await w.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
  for (let i = 1; i <= steps; i++) {
    await w.page.waitForTimeout(Math.max(1, Math.round(ms / steps)));
    await w.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (dx * i) / steps, y0 + (dy * i) / steps) });
  }
  await w.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await w.page.waitForTimeout(450);
}
const st = (w) => w.page.evaluate(() => { const u = window.__baTest; return { screen: u && u.screen, level: u && u.backLevel(), pops: document.querySelectorAll('.ba-root .gh-overlay, .ba-root .ba-result-ov').length, label: window.__labels[window.__labels.length - 1] }; });
const SPEEDS = { fast: { ms: 80, steps: 4, dx: 110 }, normal: { ms: 260, steps: 10, dx: 150 }, slow: { ms: 1100, steps: 14, dx: 170 } };

// --- standalone: every menu screen, three speeds ------------------------------------------------------------
{
  const w = await open(`${BASE}/battle-arena/`);
  await w.page.waitForFunction(() => window.__baTest && window.__baTest.screen === 'home');
  await w.page.evaluate(() => window.__baTest.renderHome('cpu'));
  await w.page.waitForTimeout(300);
  let s = await st(w);
  ok('home: level 0, nothing to step', s.level === 0);
  await swipe(w);
  ok('home: a swipe does nothing (the hub owns that step)', (await st(w)).screen === 'home');
  for (const [name, sp] of Object.entries(SPEEDS)) {
    await w.page.click('.ba-home [data-role="dex"]');
    await w.page.waitForTimeout(300);
    s = await st(w);
    ok(`Monsters: level 1, the hub button reads Back (${name})`, s.screen === 'monsters' && s.level === 1 && s.label === true);
    await swipe(w, sp);
    s = await st(w);
    ok(`Monsters: a ${name} swipe right goes back to home, the hub button reads Hub`, s.screen === 'home' && s.label === false, JSON.stringify(s));
  }
  // A monster card over Monsters: one swipe closes the card, the next goes home.
  await w.page.click('.ba-home [data-role="dex"]'); await w.page.waitForTimeout(300);
  await w.page.click('.ba-dex .ba-pick'); await w.page.waitForTimeout(300);
  s = await st(w);
  ok('card: level 2', s.screen === 'monsters' && s.pops === 1 && s.level === 2);
  await swipe(w, { y0: 300 });
  s = await st(w);
  ok('card: a swipe closes the card, Monsters stays', s.screen === 'monsters' && s.pops === 0);
  await swipe(w);
  ok('card: the next swipe goes home', (await st(w)).screen === 'home');
  // Not a back: a swipe from the edge strip (the phone's own), a vertical drag, a leftward swipe.
  await w.page.click('.ba-home [data-role="dex"]'); await w.page.waitForTimeout(300);
  await swipe(w, { x0: 10 });
  ok('the 28px edge strip is the phone\'s: no step from the page', (await st(w)).screen === 'monsters');
  await swipe(w, { dx: 6, dy: 160 });
  ok('a vertical drag is not a back', (await st(w)).screen === 'monsters');
  await swipe(w, { x0: 300, dx: -150 });
  ok('a leftward swipe is not a back', (await st(w)).screen === 'monsters');
  await swipe(w, { dx: 26, ms: 600 });
  ok('a short slow drag is not a back', (await st(w)).screen === 'monsters');
  // The phone's back gesture (history): one screen back.
  await w.page.evaluate(() => history.back()); await w.page.waitForTimeout(450);
  ok('the phone\'s back gesture: Monsters -> home', (await st(w)).screen === 'home');
  await w.page.click('.ba-home [data-role="dex"]'); await w.page.waitForTimeout(300);
  await w.page.click('.ba-dex .ba-pick'); await w.page.waitForTimeout(300);
  await w.page.evaluate(() => history.back()); await w.page.waitForTimeout(450);
  s = await st(w);
  ok('the phone\'s back gesture: a card closes first', s.screen === 'monsters' && s.pops === 0);
  await w.page.evaluate(() => history.back()); await w.page.waitForTimeout(450);
  ok('...then Monsters -> home', (await st(w)).screen === 'home');
  // How to play, and the draft.
  await w.page.click('.ba-home [data-role="help"]'); await w.page.waitForTimeout(300);
  ok('How to play: level 1', (await st(w)).level === 1);
  await swipe(w, { y0: 600 });
  s = await st(w);
  ok('How to play: a swipe closes it', s.screen === 'home' && s.pops === 0);
  await w.page.click('.ba-home [data-role="play"]'); await w.page.waitForTimeout(300);
  ok('draft: level 1', (await st(w)).screen === 'draft');
  await swipe(w, { y0: 500 });
  ok('draft: a swipe goes home', (await st(w)).screen === 'home');
  // The battle: the board's swipes are moves, never a back; the menu closes by a swipe.
  await w.page.evaluate(() => window.__baTest.startMatch(['emberkit', 'zapup']));
  await w.page.waitForSelector('.ba-board .ba-tile'); await w.page.waitForTimeout(3500);
  const bx = await w.page.evaluate(() => { const r = document.querySelector('.ba-board').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await swipe(w, { x0: bx.x, y0: bx.y });
  s = await st(w);
  ok('battle: a swipe on the board never leaves the battle (level 0)', s.screen === 'battle' && s.level === 0);
  await w.page.waitForTimeout(2500);
  await w.page.click('.ba-menu'); await w.page.waitForTimeout(250);
  s = await st(w);
  ok('battle: the menu is level 1, the hub button reads Back', s.level === 1 && s.label === true);
  await swipe(w, { y0: 200 });
  s = await st(w);
  ok('battle: a swipe closes the menu, the match goes on', s.screen === 'battle' && s.pops === 0 && s.label === false);
  // The end card: a swipe closes it (its X), then the battle is the hub's step.
  await w.page.evaluate(() => { const u = window.__baTest; u.state.sides[1].hp = 0; u.state.winner = 0; u.canon = u.state; u.finish(); });
  await w.page.waitForTimeout(1600);
  s = await st(w);
  ok('end card: level 1', s.level === 1 && s.pops === 1);
  await swipe(w, { y0: 160 });
  s = await st(w);
  ok('end card: a swipe closes it', s.pops === 0 && s.level === 0);
  // Online: Join's code screen.
  await w.page.evaluate(() => window.__baTest.renderHome('online')); await w.page.waitForTimeout(800);
  const join = await w.page.$('.ba-home [data-role="join"], .ba-root [data-role="join"]');
  if (join) {
    await join.click(); await w.page.waitForTimeout(400);
    s = await st(w);
    ok('online Join: level 1', s.level === 1 && s.screen !== 'home', JSON.stringify(s));
    await swipe(w, { y0: 600 });
    ok('online Join: a swipe goes back to home', (await st(w)).screen === 'home');
  } else ok('online: a Join button to try (offline Online tab shows the retry instead)', true);
  ok('no page errors', !w.errs.length, w.errs.join(' | '));
  await w.ctx.close();
}

// --- inside the hub: the top-left button steps back while the game has a step ---------------------------------
{
  const w = await open(`${BASE}/`);
  await w.page.waitForSelector('.hub-card[data-id="battle-arena"]', { timeout: 15000 });
  await w.page.click('.hub-card[data-id="battle-arena"]');
  await w.page.waitForFunction(() => window.__baTest && window.__baTest.screen === 'home', null, { timeout: 15000 });
  await w.page.waitForTimeout(400);
  const hubTxt = () => w.page.evaluate(() => (document.querySelector('.hub-back') || {}).textContent || '');
  ok('hub: on the game\'s home the button reads Hub', /Hub/.test(await hubTxt()));
  await w.page.evaluate(() => window.__baTest.renderHome('cpu')); await w.page.waitForTimeout(300);
  await w.page.click('.ba-home [data-role="dex"]'); await w.page.waitForTimeout(300);
  ok('hub: on Monsters it reads Back', /Back/.test(await hubTxt()), await hubTxt());
  await w.page.click('.hub-back'); await w.page.waitForTimeout(450);
  ok('hub: its button takes the game one step back (Monsters -> home), the game stays open', await w.page.evaluate(() => !!window.__baTest && window.__baTest.screen === 'home'));
  ok('hub: and reads Hub again', /Hub/.test(await hubTxt()));
  await w.page.click('.ba-home [data-role="dex"]'); await w.page.waitForTimeout(300);
  await swipe(w);
  ok('hub: a swipe on Monsters steps back inside the game', await w.page.evaluate(() => !!window.__baTest && window.__baTest.screen === 'home'));
  ok('hub: the game\'s own history entries are all unwound on its home', await w.page.evaluate(() => { const g = history.state && history.state.ghb; return !g || Object.values(g).every((v) => !v); }));
  await w.page.click('.hub-back'); await w.page.waitForTimeout(700);
  ok('hub: on the game\'s home its button leaves to the launcher', await w.page.evaluate(() => !window.__baTest && !!document.querySelector('.hub-card')));
  ok('hub: no page errors', !w.errs.length, w.errs.join(' | '));
  await w.ctx.close();
}
await browser.close();
console.log(`\nBattle Arena back step: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
