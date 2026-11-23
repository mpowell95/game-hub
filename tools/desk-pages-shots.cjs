// desk-pages-shots.cjs - the desktop layouts of Multiplayer, Messages, Leaderboards, and Profile (2026-11-23,
// docs/mockups/desktop/pages.html). A FAKE database (served in place of js/firebase-boot.js; writes refused; nothing
// leaves localhost) gives test1 / DREG5 matches, messages, and a few people with wins; this browser is an admin device
// (fake `admins/fake-uid`), so `html.gh-deskpg` is on. Shots go to .visual-out/desk-pages/ (git-ignored).
//   node server.mjs &            (port 8123)
//   node tools/desk-pages-shots.cjs [w=1440] [h=900] [theme=light] [lang=en] [admin=1]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '.visual-out', 'desk-pages');
fs.mkdirSync(OUT, { recursive: true });
const [W, H, THEME, LANG, ADMIN] = [+(process.argv[2] || 1440), +(process.argv[3] || 900), process.argv[4] || 'light', process.argv[5] || 'en', process.argv[6] !== '0'];
const TAG = `${W}x${H}-${THEME}-${LANG}${ADMIN ? '' : '-player'}`;
const BASE = 'http://localhost:8123';
const ME = 'DREG5';
const NOW = Date.now();
const FAKE_BOOT = fs.readFileSync(path.join(__dirname, 'review-setup-cards.cjs'), 'utf8').match(/const FAKE_BOOT = `([\s\S]*?)`;/)[1];
const PEOPLE = { ZQXWV: ['Zed', '🐻'], KMNPR: ['Kay', '🐙'], HJKRT: ['Hal', '🦁'], WPLMN: ['Ivy', '🦋'] };
const ONLINE = Object.fromEntries(Object.keys(PEOPLE).concat([ME]).map((c) => [c, true]));
const row = (c, i, yourTurn) => ({ with: c, name: PEOPLE[c][0], emoji: PEOPLE[c][1], updated: NOW - 3600e3 * (i + 1), created: NOW - 86400000, yourTurn, over: false, open: '', expires: 0, turnAt: NOW - 3600e3 * (i + 1), ended: '', sent: !yourTurn, mine: 3, theirs: 4, lastBy: yourTurn ? 'them' : 'me', kind: '301', target: 2, cups: 6, series: 3, seriesNo: 1, opp: c, others: [c], players: [ME, c] });
const g = (won, played) => ({ played, won, lost: played - won, byDiff: { medium: { played, won, lost: played - won } } });
const players = {};
Object.entries(PEOPLE).forEach(([c, [name, emoji]], i) => { players['dev' + i] = { profile: { name, emoji, playerId: c }, updatedAt: NOW, stats: { games: { darts: g(9 - i * 2, 12), uno: g(5 + i, 10), connect4: g(3 * i + 1, 9) } } }; });
players.devme = { profile: { name: 'test1', emoji: '🙂', playerId: ME }, updatedAt: NOW, stats: { games: { darts: g(6, 10), uno: g(4, 8), connect4: g(5, 7) } } };
const pair = (a, b) => [a, b].sort().join('_');
const threads = {}; const index = {};
const convo = [['ZQXWV', [['them', 'You still up for darts?', 140], ['me', 'Yes, sending one now', 137], ['them', 'Good game!', 60]]],
  ['KMNPR', [['them', 'Rematch tonight?', 86400 * 1.5]]], ['HJKRT', [['me', 'Nice putt', 86400 * 3]]], ['WPLMN', [['them', 'Ok', 86400 * 6]]]];
for (const [c, msgs] of convo) {
  const t = {}; msgs.forEach(([who, text, ago], i) => { t['m' + i] = { from: who === 'me' ? ME : c, text, atMs: NOW - ago * 1000 }; });
  threads[pair(ME, c)] = { msgs: t };
  const last = msgs[msgs.length - 1];
  index[c] = { at: NOW - last[2] * 1000, from: last[0] === 'me' ? ME : c, preview: last[1], name: PEOPLE[c][0], emoji: PEOPLE[c][1], seenAt: c === 'ZQXWV' ? 0 : NOW };
}
const fakeDb = { admins: ADMIN ? { 'fake-uid': true } : {}, adminConfig: { v1: { online: ONLINE } }, msgAuth: { 'fake-uid': ME }, players,
  directory: Object.fromEntries(Object.entries(PEOPLE).map(([c, [n, e]]) => [c, { name: n, emoji: e, at: NOW }])),
  messages: { threads, index: { [ME]: index } } };
for (const n of ['cuppong', 'darts', 'battleship', 'chinchon']) fakeDb[n] = { index: { [ME]: { ['m1' + n]: row('ZQXWV', 0, n === 'darts' || n === 'cuppong'), ['m2' + n]: row('KMNPR', 1, false) } } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, serviceWorkers: 'block', deviceScaleFactor: 1 });
  await ctx.route((url) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url.href), (route) => route.abort());
  await ctx.route('**/js/firebase-boot.js', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_BOOT }));
  await ctx.addInitScript(({ db, me, online, theme, lang, admin }) => {
    window.__FAKE_DB__ = db;
    try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); } catch {}
    localStorage.setItem('gamehub.devAllowSync.v1', '0');
    localStorage.setItem('gamehub.adminDevice.v1', admin ? '1' : '0');
    localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ online }));
    localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🙂', preferredColor: null, opponents: [{ name: 'Bot', emoji: '🤖', skill: 2 }], message: 'Always one more game', playerId: me, updatedAt: 1 }));
    localStorage.setItem('gamehub.lang.v1', lang); localStorage.setItem('gamehub.theme.v1', theme);
    try { const seen = JSON.parse(localStorage.getItem('gamehub.announce.v1') || '[]'); localStorage.setItem('gamehub.announce.v1', JSON.stringify(seen)); } catch {}
  }, { db: fakeDb, me: ME, online: ONLINE, theme: THEME, lang: LANG, admin: ADMIN });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const home = async () => {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__ghHub, null, { timeout: 20000 });
    await page.waitForTimeout(900);
    await page.evaluate(async () => { try { const m = await import('/js/announce.js'); for (const a of (m.ANNOUNCEMENTS || [])) m.markSeen(a.id); } catch {} document.querySelectorAll('.ann-overlay').forEach((n) => n.remove()); });
  };
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.jpg`), type: 'jpeg', quality: 88 }); };
  if (process.env.INTERACT) {
    // Click through each page: what opens, what is lit, what closes.
    const lit = () => page.evaluate(() => (document.querySelector('.hub-tabs .hub-tab.is-on') || {}).dataset?.tab);
    const has = (q) => page.evaluate((q) => !!document.querySelector(q), q);
    const log = (k, v) => console.log(k.padEnd(44), JSON.stringify(v));
    await home();
    await page.click('.hub-tabs [data-tab="messages"]'); await page.waitForTimeout(1500);
    log('messages: side list + open convo, tab lit', [await has('.msg-side .msg-row.is-sel'), await page.textContent('.msg-modal .msg-head-name'), await lit()]);
    await page.locator('.msg-side .msg-row').nth(1).click(); await page.waitForTimeout(900);
    log('messages: 2nd row opens Kay, row lit', [await page.textContent('.msg-modal .msg-head-name'), await page.evaluate(() => [...document.querySelectorAll('.msg-side .msg-row')].findIndex((b) => b.classList.contains('is-sel')))]);
    await page.click('[data-role="side-new"]'); await page.waitForTimeout(900);
    log('messages: New message -> picker', [await page.textContent('.msg-modal .gh-modal__title'), await has('.msg-side .msg-row.is-sel')]);
    await shot('i-msg-new');
    await page.click('.hub-tabs [data-tab="leaderboard"]'); await page.waitForTimeout(1800);
    log('lb tab: messages closed, lb open, lit', [await has('.msg-overlay'), await has('.lb2-split'), await lit()]);
    const g = page.locator('.lb2-dsl [data-act="game"][data-game="darts"]'); const gname = await g.getAttribute('data-game'); await g.click(); await page.waitForTimeout(700);
    log('lb: pick a game -> right board', [gname, await page.evaluate(() => (document.querySelector('.lb2-dsl .is-sel') || {}).dataset?.game)]);
    const person = page.locator('.lb2-dsr [data-act="person"]').first();
    if (await person.count()) {
      await person.click(); await page.waitForTimeout(900);
      log('lb: a person -> their page (no split)', [await has('.lb2-split'), await has('.lb2 [data-act="back"]')]);
      await shot('i-lb-person');
      await page.keyboard.press('Escape'); await page.waitForTimeout(900);
      log('lb: Esc -> split again, same game', [await has('.lb2-split'), await page.evaluate(() => (document.querySelector('.lb2-dsl .is-sel') || {}).dataset?.game)]);
    } else log('lb: no person row on this board', gname);
    await page.click('.lb2 .lb2-seg button:nth-child(2)'); await page.waitForTimeout(900);
    log('lb: Medal Count -> single column', [await has('.lb2-split'), await page.evaluate(() => Math.round(document.querySelector('.lb2-page').getBoundingClientRect().width))]);
    await shot('i-lb-medals');
    await page.click('.lb2 .lb2-seg button:nth-child(1)'); await page.waitForTimeout(900);
    log('lb: back to Games -> split', await has('.lb2-split'));
    await page.click('.hub-tabs [data-tab="challenges"]'); await page.waitForTimeout(1800);
    log('mp tab: lb gone?, mp open, lit', [await page.evaluate(() => { const e = document.querySelector('.lb2'); return !!e && getComputedStyle(e).display !== 'none'; }), await has('.cx-cols'), await lit()]);
    await page.locator('.cx-tile[data-tile="darts"]').click(); await page.waitForTimeout(1200);
    log('mp: Darts tile -> centred person sheet', await page.evaluate(() => { const r = document.querySelector('.cx-sheet')?.getBoundingClientRect(); return r && [Math.round(r.x), Math.round(r.width), Math.round(r.y)]; }));
    await shot('i-mp-sheet');
    await page.goto(BASE + '/profile/'); await page.waitForTimeout(1500);
    await page.click('[data-go="theme"]'); await page.waitForTimeout(600);
    log('profile: Theme screen, phone column', await page.evaluate(() => Math.round(document.querySelector('.pf-app').getBoundingClientRect().width)));
    await shot('i-pf-theme');
    await page.goBack(); await page.waitForTimeout(600);
    log('profile: back -> two columns', await page.evaluate(() => Math.round(document.querySelector('.pf-app').getBoundingClientRect().width)));
    console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
    await browser.close(); return;
  }
  await home(); await shot('games');
  for (const [k, name] of [['challenges', 'mp'], ['messages', 'msg'], ['leaderboard', 'lb']]) {
    await home();
    await page.click(`.hub-tabs [data-tab="${k}"]`); await page.waitForTimeout(1800); await shot(name);
    if (name === 'msg') { const r = page.locator('[data-thread], .msg-row, .msg-thread-row').first(); if (await r.count()) { await r.click(); await page.waitForTimeout(900); await shot('msg-open'); } }
    if (name === 'lb') { const r = page.locator('.lb2 [data-act="game"]').nth(2); if (await r.count()) { await r.click(); await page.waitForTimeout(900); await shot('lb-open'); } if (process.env.GEO) console.log(await page.evaluate(() => ['.lb2', '.lb2-page', '.lb2-split', '.lb2-sl', '.lb2-sr'].map((q) => { const e = document.querySelector(q); if (!e) return q + ' none'; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return q + ' ' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' disp=' + cs.display + ' cols=' + cs.gridTemplateColumns; }).join('\n'))); }
  }
  await page.goto(BASE + '/profile/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); await shot('profile');
  console.log('classes:', await page.evaluate(() => document.documentElement.className));
  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors', '\nshots:', OUT, TAG);
  await browser.close();
})();
