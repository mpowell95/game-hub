// review-setup-cards.cjs - every multiplayer game's setup card, every tab, on the phones the family uses
// (2026-11-08, Matt: "review the rest of the setup cards and what they look like in real phones").
//
// Sizes from `node tools/read-install-state.mjs --screens`: iPhone 16 Pro / 11 / 13 Pro Max / 13 as the
// installed app (with each one's safe area, emulated through CDP Emulation.setSafeAreaInsetsOverride), an
// iPhone in a Safari tab (402x684) and Unai's Android in a browser (360x668). A FAKE database (served in place of
// js/firebase-boot.js; writes refused; nothing leaves localhost) gives test1 / DREG5 three matches in every
// challenge game, so the Online tabs look like a real player's.
//
// Prints, per phone x game x tab: the space ABOVE the card (from the Hub button's bottom) and BELOW it (to the
// home bar), and flags UNDER-HUB, CUT-BOTTOM, SCROLL and UNBALANCED (both gaps > 30 and > 70 apart). A title
// level with the Hub button (Skeeball, Hoops on a short screen) and Mancala's logo (not measured) read wrong;
// LOOK at the screenshots in .visual-out/setup-cards/ before believing a flag.
//
//   node server.mjs &                                   (port 8123)
//   NODE_PATH=$(npm root -g) node tools/review-setup-cards.cjs [games,comma,separated] [phones,comma,separated]

const { chromium } = require('playwright');
const fs = require('fs');
const OUT = require('path').join(__dirname, '..', '.visual-out', 'setup-cards');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:8123';
const ME = 'DREG5';
const NOW = Date.now();
const FAKE_BOOT = `
const root = window.__FAKE_DB__ || (window.__FAKE_DB__ = {});
const parts = (p) => String(p).split('/').filter(Boolean);
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function getAt(path) { let n = root; for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; }
function snap(path) {
  const v = clone(getAt(path));
  return { key: parts(path).pop() || null, val: () => clone(v), exists: () => v !== null,
    hasChildren: () => !!v && typeof v === 'object' && Object.keys(v).length > 0,
    forEach(cb) { if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (cb({ key: k, val: () => clone(v[k]), exists: () => true }) === true) break; } },
    child: (p) => snap(path + '/' + p) };
}
const refuse = async () => { throw new Error('test: writes refused'); };
const api = {
  ref: (db, path) => ({ path: String(path || ''), get key() { return parts(this.path).pop() || null; } }),
  get: async (r) => snap(r.path),
  onValue: (r, cb) => { setTimeout(() => cb(snap(r.path)), 0); return () => {}; },
  set: refuse, update: refuse, remove: refuse, runTransaction: refuse,
  push: (r) => ({ path: r.path + '/x', key: 'x' }),
  serverTimestamp: () => Date.now(),
  query: (r) => r, orderByChild: () => null, orderByKey: () => null, limitToLast: () => null, startAfter: () => null, startAt: () => null, equalTo: () => null,
  onDisconnect: () => ({ set: refuse, remove: refuse, cancel: async () => {} }),
};
const boot = { db: {}, api, uid: 'fake-uid' };
export function getStatsApp() { return Promise.resolve(boot); }
export function perfReport() { return {}; }
export default { getStatsApp };
`;
const PEOPLE = { ZQXWV: ['Zed', '🙂'], KMNPR: ['Kay', '🐙'], HJKRT: ['Hal', '🦁'], WPLMN: ['Ivy', '🤴'] };
const ONLINE = Object.fromEntries(Object.keys(PEOPLE).concat([ME]).map((c) => [c, true]));
const row = (c, i, yourTurn) => ({ with: c, name: PEOPLE[c][0], emoji: PEOPLE[c][1], updated: NOW - 1000 * (i + 1), created: NOW - 86400000, yourTurn, over: false, open: '', expires: 0, turnAt: NOW - 1000 * (i + 1), ended: '', sent: !yourTurn, mine: 3, theirs: 4, lastBy: yourTurn ? 'them' : 'me', kind: '301', target: 2, cups: 6, series: 3, seriesNo: 1, opp: c, others: [c], players: [ME, c] });
const idx = () => ({ [ME]: { m1aaaaaaaaaa1: row('ZQXWV', 0, true), m1aaaaaaaaaa2: row('KMNPR', 1, false), m1aaaaaaaaaa3: row('HJKRT', 2, false) } });
const players = {};
Object.entries(PEOPLE).forEach(([c, [name, emoji]], i) => { players['dev' + i] = { profile: { name, emoji, playerId: c }, updatedAt: NOW, stats: { games: {} } }; });
players.devme = { profile: { name: 'test1', emoji: '🙂', playerId: ME }, updatedAt: NOW, stats: { games: {} } };
const fakeDb = { admins: {}, adminConfig: { v1: { online: ONLINE } }, msgAuth: { 'fake-uid': ME }, players,
  directory: Object.fromEntries(Object.entries(PEOPLE).map(([c, [n, e]]) => [c, { name: n, emoji: e, at: NOW }])) };
for (const n of ['cuppong', 'darts', 'flicksoccer', 'archery', 'eightball', 'battleship', 'hoops', 'chinchon', 'escoba', 'battlearena', 'skeeChallenges']) fakeDb[n] = { index: idx() };

const DEVICES = [
  ['16pro-app', 402, 874, 62, 34], ['11-app', 414, 896, 48, 34], ['13promax-app', 428, 926, 47, 34],
  ['13-app', 390, 844, 47, 34], ['safari-tab', 402, 684, 0, 0], ['android-tab', 360, 668, 0, 0]];
const GAMES = (process.argv[2] || 'cuppong,darts,flick-soccer,archery,eight-ball,battleship,hoops4,chinchon,escoba,battle-arena,skeeball,air-hockey,holdem,yahtzee,boggle,filler,mancala,tic-tac-toe,dots-boxes').split(',');
const DEVS = process.argv[3] ? DEVICES.filter((d) => process.argv[3].split(',').includes(d[0])) : DEVICES;
(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const [dname, w, h, st, sb] of DEVS) for (const g of GAMES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', hasTouch: true, isMobile: true, permissions: ['notifications'] });
    await ctx.route((url) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url.href), (route) => route.abort());
    await ctx.route('**/js/firebase-boot.js', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_BOOT }));
    await ctx.addInitScript(({ db, me, online }) => {
      window.__FAKE_DB__ = db;
      try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); } catch {}
      localStorage.setItem('gamehub.devAllowSync.v1', '0');
      localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ online }));
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🙂', preferredColor: null, opponents: [{ name: 'Bot', emoji: '🤖', skill: 2 }], message: '', playerId: me, updatedAt: 1 }));
      localStorage.setItem('gamehub.lang.v1', 'en'); localStorage.setItem('gamehub.theme.v1', 'dark');
      for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
    }, { db: fakeDb, me: ME, online: ONLINE });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: st, bottom: sb } });
    try {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__ghHub, null, { timeout: 20000 });
      await page.waitForTimeout(800);
      await page.evaluate(async () => { try { const m = await import('/js/announce.js'); for (const a of (m.ANNOUNCEMENTS || [])) m.markSeen(a.id); } catch {} document.querySelectorAll('.ann-overlay').forEach((n) => n.remove()); });
      await page.evaluate(async (g) => { const m = await import('/js/hub.js'); const hub = window.__ghHub; if (!hub.games.some((x) => x.id === g)) hub.games = [...hub.games, m.GAMES.find((x) => x.id === g)]; await hub.launch(g); }, g);
      await page.waitForTimeout(2200);
      await page.evaluate(() => { window.__findTabs = () => { const groups = [...document.querySelectorAll('.hub-main [class*="tabs"], .hub-main [role="group"]')].filter((el) => el.getClientRects().length && el.querySelectorAll('button').length >= 2 && el.querySelectorAll('button').length <= 3 && /online/i.test(el.textContent)); return groups[0] ? [...groups[0].querySelectorAll('button')] : []; }; });
      const tabCount = await page.evaluate(() => window.__findTabs().length);
      for (let t = 0; t < Math.max(1, tabCount); t++) {
        let label = 'only';
        if (tabCount) { label = await page.evaluate((t) => { const b = window.__findTabs()[t]; b.click(); return b.textContent.trim().replace(/\d+$/, '').trim(); }, t); await page.waitForTimeout(900); }
        const m = await page.evaluate(({ sb }) => {
          const hb = document.querySelector('.hub-back'); const hub = hb ? hb.getBoundingClientRect() : { bottom: 0, right: 0 };
          let top = 1e9, bot = -1e9;
          for (const el of document.querySelectorAll('.hub-main button, .hub-main h1, .hub-main h2, .hub-main [class*="card"], .hub-main [class*="tab"], .hub-main a, .hub-main input')) {
            const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
            const b = el.getBoundingClientRect(); if (!b.width || !b.height || b.height > innerHeight - 100) continue;
            if (b.bottom <= hub.bottom && b.top < hub.bottom && (b.left > hub.right + 4)) continue; // HUD beside the Hub button
            top = Math.min(top, b.top); bot = Math.max(bot, b.bottom);
          }
          let scroll = 0;
          for (const el of document.querySelectorAll('.hub-main *')) { const cs = getComputedStyle(el); if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 50) scroll = Math.max(scroll, el.scrollHeight - el.clientHeight); }
          scroll = Math.max(scroll, document.documentElement.scrollHeight - innerHeight);
          return { above: Math.round(top - hub.bottom), below: Math.round(innerHeight - sb - bot), scroll };
        }, { sb });
        const file = `${dname}__${g}__${label.replace(/[^a-z0-9]/gi, '')}.png`;
        await page.screenshot({ path: `${OUT}/${file}` });
        const flags = [];
        if (m.above < 4) flags.push('UNDER-HUB'); if (m.below < 0) flags.push('CUT-BOTTOM'); if (m.scroll > 0) flags.push('SCROLL ' + m.scroll);
        if (m.above > 30 && m.below > 30 && Math.abs(m.above - m.below) > 70) flags.push('UNBALANCED');
        results.push({ dname, g, label, ...m, flags, file });
        console.log(dname.padEnd(13), g.padEnd(13), label.padEnd(12), 'above', String(m.above).padStart(4), 'below', String(m.below).padStart(4), flags.join(' '));
      }
    } catch (e) { console.log(dname, g, 'ERR', e.message.split('\n')[0]); }
    await ctx.close();
  }
  fs.writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 1));
  await browser.close();
})();
