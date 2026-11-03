// test-lb2-swipe.mjs - Leaderboard v2's left-to-right swipe, screen by screen, with REAL touch events
// (2026-11-03, Matt: "The swipe left to right to go back within the leaderboard works half the time on
// about half of the screens. Please ... check every single screen and fix the ones that don't work.").
//
// What a back swipe is, on a phone, and what this can and cannot test:
//   - From the very EDGE of the screen (iOS standalone app, Android gesture navigation) the SYSTEM turns the
//     swipe into history.back(). js/back-stack.js keeps one history entry per screen so that is one screen.
//     The page can only get in its way (a touchmove it calls preventDefault on), and it cannot be replayed
//     in Chromium. So an edge swipe is MODELLED: real touch events are dispatched; if the page cancelled any
//     of them the system gesture is assumed blocked, otherwise history.back() is fired, as the system would.
//   - From anywhere ELSE on the screen nothing outside the page handles the swipe. js/leaderboard2-ui.js
//     does (onSwipeStart / onSwipeMove / onSwipeEnd), and that is tested for real: no modelling.
// Every swipe is a CDP Input.dispatchTouchEvent sequence on a 393x852 mobile-emulated page (no mouse, no
// history.back() unless the edge model above fires it). Start points: the edge and inside, over the header,
// the tab bar, a row button, the scrolling list, the pinned row and a sheet. Speeds: fast, normal, slow.
// Vertical drift: up, none, down (the sign of the drift is what made the old scroll guard cancel a swipe
// on a short list about half the time). The fake database is in memory; nothing leaves localhost, nothing
// is written anywhere; the viewer is a made-up person.
//
//   PORT=8185 node server.mjs &
//   NODE_PATH=$(npm root -g) BASE=http://localhost:8185 node tools/test-lb2-swipe.mjs [--quick] [--screens a,b] [--label before]
//   --quick   one rep, two speeds (a fast re-run while fixing)      --workers N   parallel pages (default 4)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildFixture } from './stats-screens-fixture.mjs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }

const BASE = (process.env.BASE || 'http://localhost:8185').replace(/\/$/, '');
const ARGS = process.argv.slice(2);
const flag = (n) => ARGS.includes('--' + n);
const opt = (n, d) => { const i = ARGS.indexOf('--' + n); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : d; };
const QUICK = flag('quick');
const WORKERS = Math.max(1, Number(opt('workers', '4')) | 0);
const ONLY = opt('screens', '') ? opt('screens', '').split(',') : null;
const LABEL = opt('label', 'run');
const EDGE_X = 8;        // inside the system's edge zone (about 20 px)
const IN_X = 96;         // well inside the page
const ME = 'QWSW7';

// ------------------------------------------------------------------ the fake database (made-up people)
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

const fixture = await buildFixture();
const NAMES = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Harper', 'Indigo', 'Jules', 'Kai', 'Lane', 'Morgan', 'Nova', 'Onyx', 'Piper', 'Quill', 'Rowan'];
const NOW = Date.now();
const players = {};
NAMES.forEach((name, i) => {
  const games = JSON.parse(JSON.stringify(fixture.games));
  // A short board: only the first two people have played Hold'em, so that list fits the screen.
  if (i >= 2) delete games.holdem;
  // An empty board: nobody has played Dots and Boxes.
  delete games.dotsboxes;
  players['dev' + i] = { profile: { name, emoji: '🙂', playerId: ('ZQ' + String(i).padStart(2, '0') + 'ABCDEFG').slice(0, 5) }, updatedAt: NOW, stats: { games } };
});
const myGames = JSON.parse(JSON.stringify(fixture.games));
delete myGames.dotsboxes;
players.devme = { profile: { name: 'Quinn Viewer', emoji: '🙂', playerId: ME }, updatedAt: NOW, stats: { games: myGames } };
const ONLINE = Object.fromEntries(['x'].concat(Object.values(players).map((p) => p.profile.playerId)).map((c) => [c, true]));
const fakeDb = { admins: { 'fake-uid': true }, adminConfig: { v1: { online: ONLINE } }, msgAuth: { 'fake-uid': ME }, players };

// ------------------------------------------------------------------ the browser
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

async function newWorker() {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route((url) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url.href), (route) => route.abort());
  await ctx.route('**/js/firebase-boot.js', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_BOOT }));
  await ctx.addInitScript(({ db, me, online, stats }) => {
    window.__FAKE_DB__ = db;
    try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); } catch { /* keep */ }
    try {
      if (!sessionStorage.getItem('swipe-test-seeded')) {
        sessionStorage.setItem('swipe-test-seeded', '1');
        localStorage.setItem('gamehub.devAllowSync.v1', '0');
        localStorage.setItem('gamehub.adminDevice.v1', '1');
        localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ online }));
        localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'Quinn Viewer', emoji: '🙂', preferredColor: null, opponents: [], message: '', playerId: me, updatedAt: 1 }));
        localStorage.setItem('gamehub.stats', JSON.stringify(stats));
        localStorage.setItem('gamehub.stats.owner.v1', me);
      }
    } catch { /* none */ }
    // What the page did with each touch event of a swipe: did any handler cancel it?
    window.__tl = [];
    window.__clicks = 0;
    for (const ty of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      window.addEventListener(ty, (e) => window.__tl.push({ ty, dp: !!e.defaultPrevented, c: !!e.cancelable }), { passive: true });
    }
    window.addEventListener('click', () => { window.__clicks++; }, true);
  }, { db: fakeDb, me: ME, online: ONLINE, stats: { games: myGames } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('.hub-tile, .hub-grid', { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => history.pushState({ sentinel: 1 }, ''));
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors };
}

// ------------------------------------------------------------------ helpers (all per worker)
function helpers(w) {
  const { page, cdp } = w;
  const wait = (ms) => page.waitForTimeout(ms);
  const sig = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    if (!q('.lb2')) return 'closed';
    if (q('.lb2-sheet')) return q('ul.lb2-help') ? 'help' : 'info';
    if (q('.lb2-kcard')) return 'pgame';
    if (q('.lb2-bar')) return q('.lb2-bar [data-act="fav"]') ? 'board:' + ((q('.lb2-bar h1') || {}).textContent || '') + (q('[data-act="womode"].on') ? ':' + q('[data-act="womode"].on').dataset.v : '') : 'player';
    const on = q('.lb2-head .lb2-seg button.on[data-act="tab"]');
    const t = on ? on.dataset.v : '?';
    if (t === 'hof') return 'hof:' + ((q('[data-act="hofview"].on') || {}).dataset || {}).v;
    if (t === 'me') return 'me';
    return q('.lb2-search') ? 'games+search' : 'games';
  });
  const depth = () => page.evaluate(async () => (await import('/js/back-stack.js')).backDepth());
  const onSentinel = () => page.evaluate(() => !!(history.state && history.state.sentinel && !history.state.ghb));
  let quickTap = false;
  async function tap(sel, { nth = 0 } = {}) {
    const loc = page.locator(sel).nth(nth);
    await loc.waitFor({ state: 'visible', timeout: 8000 });
    await loc.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await wait(60);
    const b = await loc.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    if (!quickTap) await wait(260);
  }
  const setQuick = (v) => { quickTap = v; };
  async function openLb() {
    await page.evaluate(async () => { (await import('/js/leaderboard2-ui.js')).closeLeaderboard2(); });
    await wait(300);
    const btn = page.locator('[data-role="leaderboard"]').first();
    if (await btn.count() && await btn.isVisible()) { const b = await btn.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
    else await page.evaluate(async () => { (await import('/js/leaderboard-ui.js')).openLeaderboard(); });
    if (!(await page.locator('.lb2 [data-act="game"]').count())) {
      await page.waitForSelector('.lb2', { timeout: 8000 }).catch(async () => { await page.evaluate(async () => { (await import('/js/leaderboard-ui.js')).openLeaderboard(); }); });
    }
    await page.waitForSelector('.lb2 [data-act="game"]', { timeout: 15000 });
    await wait(350);
  }
  return { wait, sig, depth, onSentinel, tap, openLb, setQuick };
}

// ------------------------------------------------------------------ the screens: how to reach each, and where back goes
// go(): from the PARENT screen, with real taps. back: where one back step lands ('closed' or a screen id).
const board = (g) => async (h) => h.tap(`.lb2 [data-act="game"][data-game="${g}"]`);
const SCREENS = [
  { id: 'games', parent: null, back: 'closed', go: async () => {}, note: 'Games list, search closed' },
  { id: 'games-search', parent: 'games', back: 'closed', go: async (h) => h.tap('.lb2 [data-act="search"]'), note: 'Games list, search open' },
  { id: 'help', parent: 'games', back: 'games', go: async (h) => h.tap('.lb2 [data-act="help"]'), note: 'help sheet' },
  { id: 'board-grouped', parent: 'games', back: 'games', go: board('connect4'), note: 'Connect Four: difficulty-grouped, long list' },
  { id: 'board-plain', parent: 'games', back: 'games', go: board('dominoes'), note: 'plain board' },
  { id: 'board-contexto', parent: 'games', back: 'games', go: board('contexto'), note: 'Contexto' },
  { id: 'board-skeeball', parent: 'games', back: 'games', go: board('skeeball'), note: 'Skeeball (machine picker)' },
  { id: 'board-bee', parent: 'games', back: 'games', go: board('spellingbee'), note: 'Spelling Bee' },
  { id: 'board-wayout', parent: 'games', back: 'games', go: board('wayout'), note: 'Arrow Maze, Levels' },
  { id: 'board-wayout-rush', parent: 'board-wayout', back: 'games', go: async (h) => h.tap('.lb2 [data-act="womode"][data-v="rush"]'), note: 'Arrow Maze, Rush' },
  { id: 'board-holdem', parent: 'games', back: 'games', go: board('holdem'), note: "Hold'em: a short list" },
  { id: 'board-empty', parent: 'games', back: 'games', go: board('dotsboxes'), note: 'a board nobody has played' },
  { id: 'info', parent: 'board-grouped', back: 'board-grouped', go: async (h) => h.tap('.lb2 .lb2-bar [data-act="info"]'), note: '(i) sheet' },
  { id: 'pgame-board', parent: 'board-grouped', back: 'board-grouped', go: async (h) => h.tap('.lb2 .lb2-lr[data-act="person"]:not(.me)'), note: "a person's game page (from a board)" },
  { id: 'player-from-pgame', parent: 'pgame-board', back: 'pgame-board', go: async (h) => h.tap('.lb2 [data-act="pall"]'), note: "a person's page (from their game page)" },
  { id: 'hof-medals', parent: 'games', back: 'closed', go: async (h) => h.tap('.lb2 .lb2-head [data-act="tab"][data-v="hof"]'), note: 'Medal Count, Medals' },
  { id: 'hof-wins', parent: 'hof-medals', back: 'closed', go: async (h) => h.tap('.lb2 [data-act="hofview"][data-v="wins"]'), note: 'Medal Count, Wins' },
  { id: 'hof-pct', parent: 'hof-medals', back: 'closed', go: async (h) => h.tap('.lb2 [data-act="hofview"][data-v="pct"]'), note: 'Medal Count, Win %' },
  { id: 'player', parent: 'hof-medals', back: 'hof-medals', go: async (h) => h.tap('.lb2 .lb2-lr[data-act="person"]:not(.me)'), note: "a person's page" },
  { id: 'pgame-player', parent: 'player', back: 'player', go: async (h) => h.tap('.lb2 [data-act="pgame"]'), note: "a person's game page (from their page)" },
  { id: 'me', parent: 'games', back: 'closed', go: async (h) => h.tap('.lb2 .lb2-head [data-act="tab"][data-v="me"]'), note: 'Me tab' },
  { id: 'me-board', parent: 'me', back: 'me', go: async (h) => h.tap('.lb2 .lb2-scroll [data-act="game"]'), note: 'a board opened from Me' },
];
const byId = Object.fromEntries(SCREENS.map((s) => [s.id, s]));

// ------------------------------------------------------------------ real touch swipes (CDP)
async function swipe(w, { x0, y0, dx, dy, ms, steps }) {
  const { cdp, page } = w;
  await page.evaluate(() => { window.__tl.length = 0; window.__clicks = 0; });
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 0.5 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(Math.max(1, Math.round(ms / steps)));
    // A thumb draws a gentle arc rather than a ruler line.
    const arc = Math.sin((i / steps) * Math.PI) * 4;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (dx * i) / steps, y0 + (dy * i) / steps + arc) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return page.evaluate(() => ({ tl: window.__tl.slice(), clicks: window.__clicks }));
}
const SPEEDS = { fast: { ms: 80, steps: 4, dx: 110 }, normal: { ms: 260, steps: 10, dx: 150 }, slow: { ms: 1100, steps: 14, dx: 170 } };
const DRIFTS = { up: -18, level: 3, down: 18 };

/** Where a swipe can start on the screen the page is on right now: label -> y. */
function startPoints(w) {
  return w.page.evaluate(() => {
    const out = {};
    const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight ? r : null; };
    const mid = (r) => Math.round(Math.min(Math.max(r.top + r.height / 2, 4), innerHeight - 4));
    const q = (s) => document.querySelector(s);
    const head = vis(q('.lb2-titlerow')) || vis(q('.lb2-bar'));
    if (head) out.header = mid(head);
    const tabs = vis(q('.lb2-head .lb2-seg')) || vis(q('.lb2-ctrl .lb2-seg')) || vis(q('.lb2-ctrl'));
    if (tabs) out.tabs = mid(tabs);
    const sc = vis(q('.lb2-scroll'));
    if (sc) {
      out.list = Math.round(sc.top + Math.min(sc.height * 0.7, sc.height - 6));
      const row = [...document.querySelectorAll('.lb2-scroll .lb2-row, .lb2-scroll .lb2-lr, .lb2-scroll .lb2-tile, .lb2-scroll .lb2-more')].find((el) => { const r = el.getBoundingClientRect(); return r.top >= sc.top && r.bottom <= sc.bottom && r.height > 20; });
      if (row) out.row = mid(row.getBoundingClientRect());
    }
    const pin = vis(q('.lb2-pin:not([hidden])'));
    if (pin) out.pin = mid(pin);
    const sh = vis(q('.lb2-sh'));
    if (sh) out.sheet = Math.round(sh.top + Math.min(sh.height * 0.5, 80));
    return out;
  });
}

async function reach(w, h, id, memo) {
  const chain = [];
  for (let s = byId[id]; s; s = s.parent ? byId[s.parent] : null) chain.unshift(s);
  await h.openLb();
  for (const s of chain) {
    await s.go(h);
    await h.wait(220);
    memo[s.id] = await h.sig();
  }
}

// ------------------------------------------------------------------ the matrix
const results = [];   // { screen, start, kind, speed, drift, ok, why, blocked }
async function runScreen(w, id) {
  const h = helpers(w);
  const memo = {};
  const S = byId[id];
  await reach(w, h, id, memo);
  const here = memo[id];
  const pts = await startPoints(w);
  const kinds = Object.keys(pts);
  const speeds = QUICK ? ['fast', 'slow'] : ['fast', 'normal', 'slow'];
  const drifts = QUICK ? ['up', 'down'] : ['up', 'level', 'down'];
  for (const kind of kinds) {
    for (const start of ['edge', 'inside']) {
      for (const speed of speeds) {
        for (const drift of drifts) {
          // Back on the screen under test, from whatever the last swipe did.
          if ((await h.sig()) !== here) {
            await reach(w, h, id, memo);
            if ((await h.sig()) !== here) { results.push({ screen: id, start, kind, speed, drift, ok: false, why: 'could not return to the screen under test' }); continue; }
          }
          // The rows move when a swipe scrolls them: always measure from the top of the screen's own scroll.
          await w.page.evaluate(() => { const s = document.querySelector('.lb2-scroll'); if (s) s.scrollTop = 0; });
          const live = await startPoints(w);
          if (live[kind] == null) continue;
          const d0 = await h.depth();
          const sp = SPEEDS[speed];
          const ev = await swipe(w, { x0: start === 'edge' ? EDGE_X : IN_X, y0: live[kind], dx: sp.dx, dy: DRIFTS[drift], ms: sp.ms, steps: sp.steps });
          const blocked = ev.tl.some((e) => e.dp);
          // The system's part of an edge swipe: history.back() unless the page cancelled the touch.
          if (start === 'edge' && !blocked) await w.page.evaluate(() => history.back());
          await h.wait(420);
          const now = await h.sig();
          const d1 = await h.depth();
          const want = S.back === 'closed' ? 'closed' : memo[S.back];
          const wantDepth = d0 - 1;
          let ok = now === want && d1 === wantDepth && ev.clicks === 0;
          let why = '';
          if (!ok) {
            why = now === here ? (blocked ? 'cancelled by the page' : 'nothing happened') : now === want ? `depth ${d0}->${d1}${ev.clicks ? ', stray click' : ''}` : `landed on ${now}`;
          }
          if (S.back === 'closed' && now === 'closed' && ok) ok = (await h.onSentinel());
          results.push({ screen: id, start, kind, speed, drift, ok, why, blocked });
        }
      }
    }
  }
}

const todo = flag('no-matrix') ? [] : SCREENS.map((s) => s.id).filter((id) => !ONLY || ONLY.includes(id));
const t0 = Date.now();
let next = 0;
const workers = [];
for (let i = 0; i < Math.min(WORKERS, todo.length); i++) workers.push(await newWorker());
await Promise.all(workers.map(async (w) => {
  while (next < todo.length) {
    const id = todo[next++];
    try { await runScreen(w, id); } catch (err) { results.push({ screen: id, start: '-', kind: '-', speed: '-', drift: '-', ok: false, why: 'harness: ' + String(err).split('\n')[0] }); }
    console.log(`done ${id} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}));

// ------------------------------------------------------------------ history stress: the swipe is history.back(), so hammer it
// (the matrix above waits between steps; a thumb does not). Each case is one yes/no.
const hist = [];
async function runHistory(w) {
  const h = helpers(w);
  const memo = {};
  const rec = (name, cond, detail) => hist.push({ name, ok: !!cond, detail: cond ? '' : detail });
  const back = (n = 1, gap = 0) => w.page.evaluate(async ([n, gap]) => { for (let i = 0; i < n; i++) { history.back(); if (gap) await new Promise((r) => setTimeout(r, gap)); } }, [n, gap]);
  // 1. back the instant a screen appears, for every screen.
  for (const S of SCREENS) {
    if (ONLY && !ONLY.includes(S.id)) continue;
    await reach(w, h, S.parent || S.id, memo);
    const d0 = await h.depth();
    if (S.parent) { h.setQuick(true); await S.go(h); h.setQuick(false); }
    await back();
    await h.wait(500);
    const now = await h.sig(), d1 = await h.depth();
    const want = S.parent ? (S.back === 'closed' ? 'closed' : memo[S.back]) : 'closed';
    rec(`${S.id}: back the instant it appears`, now === want && (S.parent ? true : d1 === 0), `landed on ${now}, wanted ${want}, depth ${d0}->${d1}`);
  }
  // 2. two backs in quick succession from the deepest screens.
  for (const [id, gap] of [['player-from-pgame', 0], ['player-from-pgame', 40], ['pgame-player', 25], ['info', 10]]) {
    if (ONLY && !ONLY.includes(id)) continue;
    await reach(w, h, id, memo);
    const up = byId[id].back;
    const want = up === 'closed' ? 'closed' : byId[up].back;
    await back(2, gap);
    await h.wait(600);
    const now = await h.sig(), d = await h.depth();
    const w2 = want === 'closed' ? 'closed' : memo[want];
    rec(`${id}: two backs ${gap}ms apart land two screens up`, now === w2, `landed on ${now}, wanted ${w2}, depth ${d}`);
  }
  // 3. the system's forward gesture into a screen already left must not bring it back.
  await reach(w, h, 'pgame-board', memo);
  await back(); await h.wait(400);
  await w.page.evaluate(() => history.forward()); await h.wait(500);
  rec('forward into a screen already left: stays on the board', (await h.sig()) === memo['board-grouped'], await h.sig());
  await back(); await h.wait(400);
  rec('...and one more back reaches the Games list', (await h.sig()) === memo.games, await h.sig());
  // 4. the on-screen back button tapped twice quickly.
  await reach(w, h, 'pgame-board', memo);
  await w.page.evaluate(() => { const b = document.querySelector('.lb2 [data-act="back"]'); b.click(); b.click(); });
  await h.wait(600);
  const s4 = await h.sig();
  rec('back button clicked twice at once: no further than the Games list', s4 === memo.games || s4 === 'closed', s4);
  // 5. a tab switch from deep inside (history.go(-2) under the hood), then a swipe straight away.
  await reach(w, h, 'player', memo);
  await h.tap('.lb2 .lb2-tile[data-act="tab"]');
  await back();
  await h.wait(700);
  rec('tab switch from a person page, then back at once: leaderboard closed, nothing left behind', (await h.sig()) === 'closed' && (await h.depth()) === 0 && (await h.onSentinel()), `${await h.sig()} depth ${await h.depth()}`);
  // 6. in and out ten times at speed.
  await h.openLb();
  h.setQuick(true);
  for (let i = 0; i < 10; i++) { await h.tap('.lb2 [data-act="game"][data-game="connect4"]'); await back(); await h.wait(60); }
  h.setQuick(false);
  await h.wait(600);
  rec('ten quick in-and-outs of a board: on the Games list, one entry deep', (await h.sig()) === memo.games && (await h.depth()) === 1, `${await h.sig()} depth ${await h.depth()}`);
  // 7. close from the top by back, and the X from deep inside: nothing left behind either way.
  await back(); await h.wait(500);
  rec('back from the Games list closes with nothing left behind', (await h.sig()) === 'closed' && (await h.depth()) === 0 && (await h.onSentinel()), `${await h.sig()} depth ${await h.depth()}`);
  await reach(w, h, 'player-from-pgame', memo);
  await w.page.evaluate(async () => { (await import('/js/leaderboard2-ui.js')).closeLeaderboard2(); });
  await h.wait(600);
  rec('close from four screens deep unwinds every entry', (await h.sig()) === 'closed' && (await h.depth()) === 0 && (await h.onSentinel()), `${await h.sig()} depth ${await h.depth()}`);
}
if (!flag('no-history')) {
  const w = workers[0] || (await newWorker());
  try { await runHistory(w); } catch (err) { hist.push({ name: 'harness', ok: false, detail: String(err).split('\n')[0] }); }
  console.log('\n=== history stress (the swipe is history.back()) ===');
  for (const r of hist) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? '  ' + r.detail : ''}`);
}

// ------------------------------------------------------------------ negatives: gestures that must NOT go back
// A swipe handler that fires on a scroll, a leftward drag, a pinch or a typing finger would be worse than none.
const neg = [];
async function runNegatives(w) {
  const h = helpers(w);
  const memo = {};
  const rec = (name, cond, detail) => neg.push({ name, ok: !!cond, detail: cond ? '' : detail });
  const scrollTop = () => w.page.evaluate(() => { const s = document.querySelector('.lb2-scroll'); return s ? Math.round(s.scrollTop) : -1; });
  const CASES = [
    ['a vertical scroll', { dx: 0, dy: -260, ms: 300, steps: 10 }],
    ['a drag down at the top', { dx: 0, dy: 200, ms: 300, steps: 10 }],
    ['a leftward swipe', { dx: -150, dy: 4, ms: 260, steps: 10 }],
    ['a tiny flick (20 px)', { dx: 20, dy: 0, ms: 60, steps: 3 }],
    ['a short slow drag (45 px, 0.9 s)', { dx: 45, dy: 0, ms: 900, steps: 12 }],
    ['a diagonal (100 right, 100 down)', { dx: 100, dy: 100, ms: 260, steps: 10 }],
    ['mostly down with a little right (60 right, 200 down)', { dx: 60, dy: 200, ms: 300, steps: 10 }],
  ];
  await reach(w, h, 'games', memo);
  for (const [name, sp] of CASES) {
    await w.page.evaluate(() => { const s = document.querySelector('.lb2-scroll'); if (s) s.scrollTop = 0; });
    const pts = await startPoints(w);
    const d0 = await h.depth();
    await swipe(w, { x0: IN_X, y0: sp.dy > 100 ? pts.list - 200 : pts.list, ...sp });
    await h.wait(450);
    rec(`${name}: stays on the Games list, no entry used`, (await h.sig()) === memo.games && (await h.depth()) === d0, `${await h.sig()} depth ${d0}->${await h.depth()}`);
    if (name === 'a vertical scroll') rec('a vertical scroll still scrolls the list', (await scrollTop()) > 0, await scrollTop());
  }
  // a finger that starts in a text field
  await reach(w, h, 'games-search', memo);
  const box = await w.page.locator('.lb2 .lb2-search input').boundingBox();
  await swipe(w, { x0: box.x + 30, y0: box.y + box.height / 2, dx: 150, dy: 0, ms: 260, steps: 10 });
  await h.wait(450);
  rec('a swipe that starts in the search field stays on the Games list', (await h.sig()) === memo['games-search'], await h.sig());
  // two fingers (a pinch or a two-finger drag)
  await reach(w, h, 'games', memo);
  const two = (x, y) => [{ x, y, id: 1 }, { x: x + 60, y, id: 2 }];
  await w.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two(IN_X, 400) });
  for (let i = 1; i <= 8; i++) { await w.page.waitForTimeout(25); await w.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: two(IN_X + i * 20, 400) }); }
  await w.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await h.wait(450);
  rec('a two-finger drag stays on the Games list', (await h.sig()) === memo.games, await h.sig());
  // a plain tap still opens a board (the swipe code must not eat taps)
  await h.tap('.lb2 [data-act="game"][data-game="connect4"]');
  rec('a plain tap still opens a board', String(await h.sig()).startsWith('board:'), await h.sig());
  // a vertical drag over a board's list still scrolls it and never goes back
  const d1 = await h.depth();
  const p2 = await startPoints(w);
  await swipe(w, { x0: IN_X, y0: p2.list, dx: 0, dy: -300, ms: 300, steps: 10 });
  await h.wait(400);
  rec('a vertical drag over a board scrolls it and stays on it', String(await h.sig()).startsWith('board:') && (await h.depth()) === d1 && (await scrollTop()) > 0, `${await h.sig()} scroll ${await scrollTop()}`);
}
if (!flag('no-negatives')) {
  const w = workers[0] || (await newWorker());
  try { await runNegatives(w); } catch (err) { neg.push({ name: 'harness', ok: false, detail: String(err).split('\n')[0] }); }
  console.log('\n=== gestures that must NOT go back ===');
  for (const r of neg) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? '  ' + r.detail : ''}`);
}

// ------------------------------------------------------------------ report
const pad = (s, n) => String(s).padEnd(n);
const pct = (xs) => (xs.length ? `${xs.filter((r) => r.ok).length}/${xs.length}` : '-');
console.log(`\n=== ${LABEL}: Leaderboard v2 back swipe, real touch events (393x852) ===`);
console.log(pad('screen', 20) + pad('EDGE (system gesture, modelled)', 34) + 'INSIDE (the page handles it)');
let bad = 0, total = 0;
for (const id of todo) {
  const rs = results.filter((r) => r.screen === id);
  const e = rs.filter((r) => r.start === 'edge'), i = rs.filter((r) => r.start === 'inside');
  const eb = e.filter((r) => r.blocked).length;
  console.log(pad(id, 20) + pad(`${pct(e)}${eb ? `  (page cancelled ${eb})` : ''}`, 34) + pct(i));
  bad += rs.filter((r) => !r.ok).length; total += rs.length;
}
console.log('\nby start point (all screens):');
for (const start of ['edge', 'inside']) {
  const line = [];
  for (const kind of ['header', 'tabs', 'row', 'list', 'pin', 'sheet']) { const xs = results.filter((r) => r.start === start && r.kind === kind); if (xs.length) line.push(`${kind} ${pct(xs)}`); }
  console.log('  ' + pad(start, 8) + line.join('   '));
}
console.log('by speed:  ' + ['fast', 'normal', 'slow'].map((s) => `${s} ${pct(results.filter((r) => r.speed === s))}`).join('   '));
console.log('by drift:  ' + ['up', 'level', 'down'].map((s) => `${s} ${pct(results.filter((r) => r.drift === s))}`).join('   '));
const why = {};
for (const r of results.filter((x) => !x.ok)) { const k = `${r.start}: ${r.why}`; why[k] = (why[k] || 0) + 1; }
console.log('\nfailures by cause:'); for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${String(n).padStart(4)}  ${k}`);
bad += hist.filter((r) => !r.ok).length + neg.filter((r) => !r.ok).length;
const errs = workers.flatMap((w) => w.errors);
if (errs.length) console.log('\npage errors:', [...new Set(errs)].slice(0, 5));
console.log(`\n${total - bad}/${total} swipes went back exactly one screen (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
if (opt('json', '')) fs.writeFileSync(opt('json', ''), JSON.stringify(results));
await browser.close();
process.exit(bad ? 1 : 0);
