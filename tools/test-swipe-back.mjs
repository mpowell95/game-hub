// The phone's back swipe steps back ONE screen in every drill-down overlay (2026-11-02, Matt: "I want
// to be able to swipe left to right and move back 1 screen. Not leave the whole leaderboard.").
// js/back-stack.js keeps one history entry per screen level. For each overlay this goes 2-4 levels
// deep, then steps back with history.back() (what the iOS edge swipe does) and with the screen's own
// back button, and checks: exactly one level per step, the overlay closes only past its first screen,
// and no entry is left behind once it is closed (the page is back on the entry it started from).
//
// Fake in-memory database (page.route over js/firebase-boot.js); nothing reaches Firebase or any other
// host. Profile test1 / DREG5, devAllowSync '0', admin device flag on (Leaderboard v2, Admin, bug inbox).
//
//   PORT=8185 node server.mjs &
//   NODE_PATH=$(npm root -g) BASE=http://localhost:8185 node tools/test-swipe-back.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8185';
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

const rec = (played, won) => ({ total: { played, won, lost: played - won }, byDiff: { medium: { played, won, lost: played - won } } });
const PEOPLE = { ZQXWV: 'Zed', KMNPR: 'Kay', HJKRT: 'Hal' };
const players = Object.fromEntries(Object.entries(PEOPLE).map(([c, name], i) => [`dev${i}`, {
  profile: { name, emoji: '🙂', playerId: c }, updatedAt: NOW,
  stats: { games: { connect4: rec(5 + i, 2 + i), dominoes: rec(3, 1 + (i % 2)) } } }]));
players.devme = { profile: { name: 'test1', emoji: '🙂', playerId: ME }, updatedAt: NOW, stats: { games: { connect4: rec(4, 2), dominoes: rec(2, 1) } } };
const ONLINE = Object.fromEntries(Object.keys(PEOPLE).concat([ME]).map((c) => [c, true]));
const fakeDb = {
  admins: { 'fake-uid': true },
  adminConfig: { v1: { online: ONLINE } },
  msgAuth: { 'fake-uid': ME },
  players,
  directory: Object.fromEntries(Object.entries(PEOPLE).map(([c, n]) => [c, { name: n, emoji: '🙂', at: NOW }])),
  messages: {
    index: { [ME]: { ZQXWV: { at: NOW - 5000, from: 'ZQXWV', preview: 'hi', name: 'Zed', emoji: '🙂', seenAt: 0 } } },
    threads: { [[ME, 'ZQXWV'].sort().join('_')]: { msgs: { a: { from: 'ZQXWV', text: 'hi', atMs: NOW - 5000 } } } },
  },
  darts: {
    index: {
      [ME]: {
        mh1abc2dx9f3q: { with: 'ZQXWV', name: 'Zed', emoji: '🙂', updated: NOW - 1000, yourTurn: true, over: false, open: '', expires: 0, turnAt: NOW - 1000, ended: '', sent: false, mine: 100, theirs: 120, lastBy: 'them', kind: '301' },
        mh1abc2dx9f3s: { with: 'KMNPR', name: 'Kay', emoji: '🙂', updated: NOW - 3000, yourTurn: false, over: true, result: 'won', why: 'done', open: '', ended: '', sent: true, mine: 0, theirs: 40, lastBy: 'me', kind: '301' },
      },
    },
  },
  bugReports: { r1: { description: 'test report', createdAtMs: NOW - 1000, status: 'open', name: 'Zed', playerId: 'ZQXWV', deviceId: 'dev0', gameId: 'darts' } },
};
const myStats = { games: { connect4: rec(4, 2), dominoes: rec(2, 1) } };

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block' });
// Nothing leaves localhost.
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
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🙂', preferredColor: null, opponents: [], message: '', playerId: me, updatedAt: 1 }));
      localStorage.setItem('gamehub.stats', JSON.stringify(stats));
      localStorage.setItem('gamehub.stats.owner.v1', me);
    }
  } catch { /* none */ }
}, { db: fakeDb, me: ME, online: ONLINE, stats: myStats });

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForSelector('.hub-tile, .hub-grid', { timeout: 20000 });
await page.waitForTimeout(1200);
// The entry every overlay must come back to.
await page.evaluate(() => history.pushState({ sentinel: 1 }, ''));

const depth = () => page.evaluate(async () => (await import('/js/back-stack.js')).backDepth());
const onSentinel = () => page.evaluate(() => !!(history.state && history.state.sentinel && !history.state.ghb));
const settle = (ms = 250) => page.waitForTimeout(ms);
const swipe = async () => { await page.evaluate(() => history.back()); await settle(); };
const present = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);

/** Steps back through `levels` (top first: [name, probe() -> true while that screen shows]). */
async function stepAll(tag, levels, overlaySel, how) {
  for (let i = 0; i < levels.length; i++) {
    const [name] = levels[i];
    const want = levels.length - i - 1;
    await how();
    if (want > 0) {
      const [below, probe] = levels[i + 1];
      ok(`${tag}: back from ${name} lands on ${below}`, await probe(), name);
      ok(`${tag}: history holds ${want} entr${want === 1 ? 'y' : 'ies'} after leaving ${name}`, (await depth()) === want, await depth());
      ok(`${tag}: overlay still open on ${below}`, await present(overlaySel));
    } else {
      ok(`${tag}: back from ${name} closes the overlay`, !(await present(overlaySel)));
      ok(`${tag}: no entry left behind`, (await depth()) === 0 && (await onSentinel()), await page.evaluate(() => history.state));
    }
  }
  await settle(400);
  ok(`${tag}: nothing reopens afterwards`, !(await present(overlaySel)));
}

// ---------- Leaderboard v2 (admin device): Games -> board -> person's game -> person ----------
async function lb2Down() {
  await page.evaluate(async () => { (await import('/js/leaderboard-ui.js')).openLeaderboard(); });
  await page.waitForSelector('.lb2 [data-act="game"]', { timeout: 10000 });
  await settle();
  ok('lb2: opening pushes one entry', (await depth()) === 1, await depth());
  await page.locator('.lb2 [data-act="game"][data-game="connect4"]').first().click();
  await page.waitForSelector('.lb2 [data-act="person"]', { timeout: 5000 });
  await settle();
  ok('lb2: board = 2 entries', (await depth()) === 2, await depth());
  await page.locator('.lb2 [data-act="person"]').first().click();
  await page.waitForSelector('.lb2 [data-act="pall"]', { timeout: 5000 });
  await settle();
  ok('lb2: person\'s game = 3 entries', (await depth()) === 3, await depth());
  await page.locator('.lb2 [data-act="pall"]').first().click();
  await page.waitForSelector('.lb2 [data-act="pgame"]', { timeout: 5000 });
  await settle();
  ok('lb2: person = 4 entries', (await depth()) === 4, await depth());
}
const lb2Levels = [
  ['person', null],
  ['person\'s game', () => present('.lb2 [data-act="pall"]')],
  ['board', () => present('.lb2 [data-act="person"]')],
  ['Games', () => present('.lb2 [data-act="game"]')],
];
await lb2Down();
await stepAll('lb2 swipe', lb2Levels, '.lb2', swipe);
await lb2Down();
await stepAll('lb2 back button', lb2Levels, '.lb2', async () => {
  if (await present('.lb2 [data-act="back"]')) await page.locator('.lb2 [data-act="back"]').first().click();
  else await page.keyboard.press('Escape');
  await settle();
});
// Matt's 12, item 9 (2026-11-02): a person's GAME page opened FROM their player page: back = their player page.
// (a) Medal Count -> person -> a game: swipe back twice.
async function lb2PersonGameDown(tag) {
  await page.evaluate(async () => { (await import('/js/leaderboard-ui.js')).openLeaderboard(); });
  await page.waitForSelector('.lb2 [data-act="tab"][data-v="hof"]', { timeout: 10000 });
  await page.locator('.lb2 [data-act="tab"][data-v="hof"]').first().click();
  await page.waitForSelector('.lb2 [data-act="person"]', { timeout: 5000 });
  await settle();
  // Someone else's row (the viewer's own opens the Me tab).
  await page.locator('.lb2 .lb2-lr:not(.me)[data-act="person"]').first().click();
  await page.waitForSelector('.lb2 [data-act="pgame"]', { timeout: 5000 });
  await settle();
  ok(`${tag}: player page = 2 entries`, (await depth()) === 2, await depth());
  await page.locator('.lb2 [data-act="pgame"]').first().click();
  await page.waitForSelector('.lb2 [data-act="pall"]', { timeout: 5000 });
  await settle();
  ok(`${tag}: their game = 3 entries`, (await depth()) === 3, await depth());
}
const pgLevels = [
  ['their game', null],
  ['player page', () => page.evaluate(() => !!document.querySelector('.lb2 [data-act="pgame"]') && !document.querySelector('.lb2 [data-act="pall"]'))],
  ['Medal Count', () => present('.lb2 [data-act="hofview"]')],
];
await lb2PersonGameDown('lb2 player->game swipe');
await stepAll('lb2 player->game swipe', pgLevels, '.lb2', swipe);
await lb2PersonGameDown('lb2 player->game back button');
await stepAll('lb2 player->game back button', pgLevels, '.lb2', async () => {
  if (await present('.lb2 [data-act="back"]')) await page.locator('.lb2 [data-act="back"]').first().click();
  else await page.keyboard.press('Escape');
  await settle();
});
// (b) board -> person's game -> "Back to <name>" (their page) -> another game -> back, back, back.
await lb2Down();
await page.locator('.lb2 [data-act="pgame"]').last().click();
await page.waitForSelector('.lb2 [data-act="pall"]', { timeout: 5000 });
await settle();
ok('lb2 board->pgame->player->pgame: 5 entries', (await depth()) === 5, await depth());
await stepAll('lb2 board->pgame->player->pgame', [
  ['their game', null],
  ['player page', () => page.evaluate(() => !!document.querySelector('.lb2 [data-act="pgame"]') && !document.querySelector('.lb2 [data-act="pall"]'))],
  ['person\'s game', () => present('.lb2 [data-act="pall"]')],
  ['board', () => present('.lb2 [data-act="person"]')],
  ['Games', () => present('.lb2 [data-act="game"]')],
], '.lb2', swipe);
// (c) the "Back to <name>" row on a game page opened from the player page goes back (one entry fewer, not one more).
await lb2PersonGameDown('lb2 back-to row');
await page.locator('.lb2 [data-act="pall"]').first().click();
await settle();
ok('lb2 back-to row: lands on the player page', await page.evaluate(() => !!document.querySelector('.lb2 [data-act="pgame"]') && !document.querySelector('.lb2 [data-act="pall"]')));
ok('lb2 back-to row: 2 entries', (await depth()) === 2, await depth());
await page.evaluate(async () => { (await import('/js/leaderboard2-ui.js')).closeLeaderboard2(); });
await settle(400);
ok('lb2 back-to row: closed, nothing left', (await depth()) === 0 && (await onSentinel()));
// Matt's 12: a game's (i) sheet is a level; back closes it and leaves the board. The Games list's scroll comes back.
await page.evaluate(async () => { (await import('/js/leaderboard-ui.js')).openLeaderboard(); });
await page.waitForSelector('.lb2 [data-act="game"]', { timeout: 10000 });
await settle();
const gl = () => page.evaluate(() => { const s = document.querySelector('.lb2 [data-role="scroll"]'); return s ? Math.round(s.scrollTop) : -1; });
await page.evaluate(() => { document.querySelector('.lb2 [data-role="scroll"]').scrollTop = 300; });
const before = await gl();
await page.locator('.lb2 [data-act="game"][data-game="connect4"]').first().click();
await page.waitForSelector('.lb2 [data-act="info"]', { timeout: 5000 });
await page.locator('.lb2 [data-act="info"]').first().click();
await settle();
ok('lb2 info: sheet open = 3 entries', (await present('.lb2 .lb2-sheet')) && (await depth()) === 3, await depth());
await swipe();
ok('lb2 info: back closes the sheet, board stays', !(await present('.lb2 .lb2-sheet')) && (await present('.lb2 [data-act="info"]')) && (await depth()) === 2, await depth());
await swipe();
ok('lb2 scroll: back to Games restores its scroll', before > 0 && Math.abs((await gl()) - before) <= 1, [before, await gl()]);
await page.evaluate(async () => { (await import('/js/leaderboard2-ui.js')).closeLeaderboard2(); });
await settle(400);
ok('lb2 info: closed, nothing left', (await depth()) === 0 && (await onSentinel()));
// The help sheet is a level of its own.
await page.evaluate(async () => { (await import('/js/leaderboard-ui.js')).openLeaderboard(); });
await page.waitForSelector('.lb2 [data-act="help"]', { timeout: 10000 });
await page.locator('.lb2 [data-act="help"]').first().click();
await settle();
ok('lb2 help: sheet = 2 entries', (await depth()) === 2, await depth());
await stepAll('lb2 help', [['help', null], ['Games', () => page.evaluate(() => !document.querySelector('.lb2 [data-act="helpclose"]') && !!document.querySelector('.lb2'))]], '.lb2', swipe);
// A two-entry jump (history.go(-2)) steps two levels at once.
await lb2Down();
await page.evaluate(() => history.go(-2));
await settle(400);
ok('lb2: go(-2) from person lands on board', await present('.lb2 [data-act="person"]'));
ok('lb2: go(-2) leaves 2 entries', (await depth()) === 2, await depth());
// The X closes from any depth and unwinds every entry.
await page.evaluate(async () => { (await import('/js/leaderboard2-ui.js')).closeLeaderboard2(); });
await settle(400);
ok('lb2: close from the board unwinds all entries', (await depth()) === 0 && (await onSentinel()), await page.evaluate(() => history.state));
// A game's own Leaderboard button: back from that board closes.
await page.evaluate(async () => { (await import('/js/leaderboard-ui.js')).openLeaderboard({ game: 'connect4' }); });
await page.waitForSelector('.lb2 [data-act="person"]', { timeout: 10000 });
await settle();
ok('lb2 {game}: the game\'s board is 1 entry', (await depth()) === 1, await depth());
await swipe();
ok('lb2 {game}: back from it closes', !(await present('.lb2')) && (await depth()) === 0 && (await onSentinel()));

// ---------- The old leaderboard (players' devices): By Game -> board -> person ----------
async function lbDown() {
  await page.evaluate(async () => { (await import('/js/leaderboard-ui.js')).openLeaderboard({ legacy: true }); });
  await page.waitForSelector('.lb-overlay .lb-seg', { timeout: 10000 });
  await page.locator('.lb-overlay .lb-seg[data-seg="game"]').first().click().catch(() => {});
  await page.waitForSelector('.lb-overlay .lb-grow[data-game], .lb-overlay .lb-gcard[data-game]', { timeout: 10000 });
  await settle();
  ok('old lb: opening = 1 entry', (await depth()) === 1, await depth());
  await page.locator('.lb-overlay .lb-grow[data-game], .lb-overlay .lb-gcard[data-game]').first().click();
  await page.waitForSelector('.lb-overlay .lb-pcard[data-pi]', { timeout: 5000 });
  await settle();
  ok('old lb: board = 2 entries', (await depth()) === 2, await depth());
  await page.locator('.lb-overlay .lb-pcard[data-pi]').first().click();
  await page.waitForSelector('.lb-overlay [data-role="lb-pgame-back"], .lb-overlay [data-role="lb-player-back"]', { timeout: 5000 });
  await settle();
  ok('old lb: person = 3 entries', (await depth()) === 3, await depth());
}
const lbLevels = [
  ['person', null],
  ['board', () => page.evaluate(() => !!document.querySelector('.lb-overlay .lb-pcard[data-pi]') && !document.querySelector('.lb-overlay [data-role="lb-pgame-back"]'))],
  ['By Game', () => present('.lb-overlay .lb-grow[data-game], .lb-overlay .lb-gcard[data-game]')],
];
await lbDown();
await stepAll('old lb swipe', lbLevels, '.lb-overlay', swipe);
await lbDown();
await stepAll('old lb back button', lbLevels, '.lb-overlay', async () => {
  const b = page.locator('.lb-overlay [data-role="lb-pgame-back"], .lb-overlay [data-role="lb-player-back"], .lb-overlay [data-role="lb-back"]');
  if (await b.count()) await b.first().click(); else await page.keyboard.press('Escape');
  await settle();
});

// ---------- My Stats: list -> game ----------
async function gsDown() {
  await page.evaluate(async () => { (await import('/js/game-stats-ui.js')).openStatsOverlay(); });
  await page.waitForSelector('.gs-overlay .gs-grow[data-game]', { timeout: 10000 });
  await settle();
  ok('My Stats: opening = 1 entry', (await depth()) === 1, await depth());
  await page.locator('.gs-overlay .gs-grow[data-game]').first().click();
  await settle();
  ok('My Stats: a game = 2 entries', (await depth()) === 2, await depth());
}
const gsLevels = [['game', null], ['list', () => present('.gs-overlay .gs-grow[data-game]')]];
await gsDown();
await stepAll('My Stats swipe', gsLevels, '.gs-overlay', swipe);
await gsDown();
await stepAll('My Stats back button', gsLevels, '.gs-overlay', async () => { await page.locator('.gs-overlay [data-role="gs-up"]').click(); await settle(); });

// ---------- Multiplayer: screen -> Records -> person ----------
async function cxDown() {
  await page.evaluate(async () => { (await import('/js/challenges-ui.js')).openChallenges({ games: [{ id: 'darts', name: 'Darts' }], live: [] }); });
  await page.waitForSelector('.cx-overlay [data-role="rec"]', { timeout: 10000 });
  await page.waitForSelector('.cx-overlay .cx-list', { timeout: 10000 });
  await settle(600);
  ok('Multiplayer: opening = 1 entry', (await depth()) === 1, await depth());
  await page.locator('.cx-overlay [data-role="rec"]').click();
  await page.waitForSelector('.cx-overlay [data-opp]', { timeout: 5000 });
  await settle();
  ok('Multiplayer: Records = 2 entries', (await depth()) === 2, await depth());
  await page.locator('.cx-overlay [data-opp]').first().click();
  await settle();
  ok('Multiplayer: a person = 3 entries', (await depth()) === 3, await depth());
}
const cxLevels = [
  ['person', null],
  ['Records', () => present('.cx-overlay [data-opp]')],
  ['screen', () => present('.cx-overlay [data-role="rec"]')],
];
await cxDown();
await stepAll('Multiplayer swipe', cxLevels, '.cx-overlay', swipe);
await cxDown();
await stepAll('Multiplayer back button', cxLevels, '.cx-overlay', async () => { await page.locator('.cx-overlay [data-role="back"]').click(); await settle(); });
// The pick-a-person sheet is a level.
await page.evaluate(async () => { (await import('/js/challenges-ui.js')).openChallenges({ games: [{ id: 'darts', name: 'Darts' }], live: [] }); });
await page.waitForSelector('.cx-overlay [data-tile]', { timeout: 10000 });
await page.locator('.cx-overlay [data-tile]').first().click();
await page.waitForSelector('.cx-overlay .cx-sheet', { timeout: 5000 });
await settle();
ok('Multiplayer: pick-a-person sheet = 2 entries', (await depth()) === 2, await depth());
await stepAll('Multiplayer sheet', [['sheet', null], ['screen', () => page.evaluate(() => !document.querySelector('.cx-sheet') && !!document.querySelector('.cx-overlay'))]], '.cx-overlay', swipe);

// ---------- Messages: inbox -> conversation ----------
async function msgDown() {
  await page.evaluate(async () => { (await import('/js/messages-ui.js')).openMessages(); });
  await page.waitForSelector('.msg-overlay .msg-row', { timeout: 10000 });
  await settle();
  ok('Messages: opening = 1 entry', (await depth()) === 1, await depth());
  await page.locator('.msg-overlay .msg-row', { hasText: 'Zed' }).first().click();
  await page.waitForSelector('.msg-overlay [data-role="back"]', { timeout: 5000 });
  await settle();
  ok('Messages: a conversation = 2 entries', (await depth()) === 2, await depth());
}
const msgLevels = [['conversation', null], ['inbox', () => page.evaluate(() => !!document.querySelector('.msg-overlay') && !document.querySelector('.msg-overlay [data-role="back"]'))]];
await msgDown();
await stepAll('Messages swipe', msgLevels, '.msg-overlay', swipe);
await msgDown();
await stepAll('Messages back button', msgLevels, '.msg-overlay', async () => {
  if (await present('.msg-overlay [data-role="back"]')) await page.locator('.msg-overlay [data-role="back"]').click();
  else await page.locator('.msg-overlay [data-role="close"]').click();
  await settle();
});
// Messages opened from a leaderboard: the nested overlay owns its own entries.
await lb2Down();
await page.evaluate(async () => { (await import('/js/messages-ui.js')).openMessages({ to: 'ZQXWV', toName: 'Zed', toEmoji: '🙂' }); });
await page.waitForSelector('.msg-overlay [data-role="back"]', { timeout: 5000 });
await settle();
ok('nested: Messages over lb2 adds its own 2 entries', (await depth()) === 6, await depth());
await swipe();
ok('nested: back = Messages inbox, lb2 untouched', (await present('.msg-overlay')) && (await present('.lb2 [data-act="pgame"]')) && (await depth()) === 5, await depth());
await swipe();
ok('nested: back again closes Messages only', !(await present('.msg-overlay')) && (await present('.lb2 [data-act="pgame"]')) && (await depth()) === 4, await depth());
await swipe();
ok('nested: then lb2 steps one level', await present('.lb2 [data-act="pall"]'));
await page.evaluate(async () => { (await import('/js/leaderboard2-ui.js')).closeLeaderboard2(); });
await settle(400);
ok('nested: closed, nothing left', (await depth()) === 0 && (await onSentinel()));

// Switching overlays in one tap (the compact tab bar: one closes, the next opens at once).
await lb2Down();
await page.evaluate(async () => {
  const [l2, cx] = await Promise.all([import('/js/leaderboard2-ui.js'), import('/js/challenges-ui.js')]);
  l2.closeLeaderboard2();
  cx.openChallenges({ games: [{ id: 'darts', name: 'Darts' }], live: [] });
});
await page.waitForSelector('.cx-overlay [data-role="rec"]', { timeout: 10000 });
await settle(600);
ok('switch: lb2 unwound, Multiplayer holds exactly 1 entry', !(await present('.lb2')) && (await depth()) === 1, await depth());
await swipe();
ok('switch: one back closes Multiplayer, nothing left', !(await present('.cx-overlay')) && (await depth()) === 0 && (await onSentinel()), await page.evaluate(() => history.state));

// ---------- Admin: tab -> a pushed view ----------
await page.evaluate(async () => { (await import('/js/admin-ui.js')).openAdmin(); });
await page.waitForSelector('.adm-page .adm-tab', { timeout: 10000 });
await settle(600);
ok('Admin: opening = 1 entry', (await depth()) === 1, await depth());
await page.locator('.adm-page .adm-tab').nth(1).click();   // Games
await settle();
ok('Admin: a tab is still 1 entry', (await depth()) === 1, await depth());
let pushed = false;
for (let i = 0; i < 8 && !pushed; i++) {
  const rows = page.locator('.adm-page .adm-main [data-a]');
  if (await rows.count() <= i) break;
  await rows.nth(i).click().catch(() => {});
  await settle();
  pushed = (await depth()) === 2;
}
ok('Admin: a view = 2 entries', pushed, await depth());
if (pushed) await stepAll('Admin swipe', [['view', null], ['tab', () => present('.adm-page')]], '.adm-page', swipe);
else await page.evaluate(async () => { document.querySelector('.adm-page') && document.querySelector('.adm-page .adm-nb').click(); });

// ---------- Bug inbox: list -> report ----------
await page.evaluate(async () => { (await import('/js/bug-report-ui.js')).openBugInbox(); });
await page.waitForSelector('.bug-overlay [data-open]', { timeout: 10000 });
await settle();
ok('Bug inbox: opening = 1 entry', (await depth()) === 1, await depth());
await page.locator('.bug-overlay [data-open]').first().click();
await page.waitForSelector('.bug-overlay [data-role="bug-back"]', { timeout: 5000 });
await settle();
ok('Bug inbox: a report = 2 entries', (await depth()) === 2, await depth());
await stepAll('Bug inbox swipe', [['report', null], ['inbox', () => page.evaluate(() => !!document.querySelector('.bug-overlay [data-open]'))]], '.bug-overlay', swipe);

// ---------- Profile page: its own views, with My Stats over them ----------
await page.goto(BASE + '/profile/', { waitUntil: 'load' });
await page.waitForSelector('#pf-stats-btn', { timeout: 10000 });
await page.evaluate(() => history.pushState({ sentinel: 1 }, ''));
await page.click('#pf-stats-btn');
await page.waitForSelector('.gs-overlay .gs-grow[data-game]', { timeout: 10000 });
await page.locator('.gs-overlay .gs-grow[data-game]').first().click();
await settle();
ok('profile: My Stats game = 2 entries', (await depth()) === 2, await depth());
await stepAll('profile My Stats', gsLevels, '.gs-overlay', swipe);
const goRow = page.locator('[data-go]').first();
if (await goRow.count()) {
  await goRow.click();
  await settle();
  const view = await page.evaluate(() => (history.state || {}).pfView || '');
  ok('profile: a row pushes its pfView', !!view, view);
  await swipe();
  ok('profile: back returns to the list', await page.evaluate(() => !history.state || !history.state.pfView));
}

ok('no page errors', errors.length === 0, errors.slice(0, 3));
await browser.close();
console.log(`\nswipe-back tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
