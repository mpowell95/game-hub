// Headless-browser proof that no OTHER player's code reaches the page (2026-10-29), and that a tap still
// acts on the right person. Fake players with made-up codes live in an IN-MEMORY database that replaces
// js/firebase-boot.js for the run (page.route); nothing touches Firebase. The profile is the made-up
// code "TESTA" named Tester (never Matt's name or code); devAllowSync starts '0' and is turned on only
// after the fake database is proven to be the one answering.
//
//   node server.mjs &            # http://localhost:8123 (or PORT=... and BASE=http://localhost:PORT)
//   NODE_PATH=$(npm root -g) node tools/test-no-codes-browser.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8123';
const ME = 'TESTA';
const OTHERS = { ZQXWV: 'Zed', KMNPR: 'Kay', HJKRT: 'Hal', WBCDF: '' };   // code -> name ('' = nameless)
const CODES = Object.keys(OTHERS);
const NOW = Date.now();

const FAKE_BOOT = `
const root = window.__FAKE_DB__ || (window.__FAKE_DB__ = {});
window.__FAKE_READS = window.__FAKE_READS || [];
const parts = (p) => String(p).split('/').filter(Boolean);
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function getAt(path) { let n = root; for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; }
function setAt(path, v) {
  const ks = parts(path); if (!ks.length) return;
  let n = root;
  for (let i = 0; i < ks.length - 1; i++) { if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') n[ks[i]] = {}; n = n[ks[i]]; }
  if (v === null || v === undefined) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = clone(v);
}
function snap(path) {
  const v = clone(getAt(path));
  return { key: parts(path).pop() || null, val: () => clone(v), exists: () => v !== null,
    hasChildren: () => !!v && typeof v === 'object' && Object.keys(v).length > 0,
    forEach(cb) { if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (cb({ key: k, val: () => clone(v[k]), exists: () => true }) === true) break; } },
    child: (p) => snap(path + '/' + p) };
}
let pushN = 0;
const api = {
  ref: (db, path) => ({ path: String(path || ''), get key() { return parts(this.path).pop() || null; } }),
  get: async (r) => { window.__FAKE_READS.push(r.path); return snap(r.path); },
  onValue: (r, cb) => { window.__FAKE_READS.push('watch:' + r.path); setTimeout(() => cb(snap(r.path)), 0); return () => {}; },
  set: async (r, v) => { window.__FAKE_WRITES = (window.__FAKE_WRITES || []).concat([[r.path, v]]); setAt(r.path, v); },
  update: async (r, v) => { window.__FAKE_WRITES = (window.__FAKE_WRITES || []).concat([[r.path, v]]); for (const k of Object.keys(v || {})) setAt(r.path + '/' + k, v[k]); },
  push: (r) => { const id = 'p' + Date.now().toString(36) + (pushN++); return { path: r.path + '/' + id, key: id }; },
  remove: async (r) => { setAt(r.path, null); },
  serverTimestamp: () => Date.now(),
  query: (r) => r, orderByChild: () => null, orderByKey: () => null, limitToLast: () => null, startAfter: () => null,
};
const boot = { db: {}, api, uid: 'fake-uid' };
export function getStatsApp() { return Promise.resolve(boot); }
export function perfReport() { return {}; }
export default { getStatsApp };
`;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}
const leaks = (html) => CODES.filter((c) => new RegExp('(^|[^A-Za-z0-9])' + c + '([^A-Za-z0-9]|$)', 'i').test(html));

const ONLINE = Object.fromEntries(CODES.concat([ME]).map((c) => [c, true]));
const fakeDb = {
  adminConfig: { v1: { online: ONLINE } },
  msgAuth: { 'fake-uid': ME },
  messages: {
    index: {
      [ME]: {
        ZQXWV: { at: NOW - 5000, from: 'ZQXWV', preview: 'hi from Zed', name: 'Zed', emoji: '😀', seenAt: 0 },
        KMNPR: { at: NOW - 9000, from: ME, preview: 'to Kay', name: 'Kay', emoji: '🙂', seenAt: NOW },
        WBCDF: { at: NOW - 12000, from: 'WBCDF', preview: 'from nobody', name: '', emoji: '🙂', seenAt: 0 },
      },
    },
    threads: {},
  },
  directory: Object.fromEntries(CODES.map((c) => [c, { name: OTHERS[c] || 'Q' + c.slice(0, 2).toLowerCase(), emoji: '🙂', at: NOW }]).concat([[ME, { name: 'Tester', emoji: '🙂', at: NOW }]])),
  players: Object.fromEntries(Object.keys(OTHERS).filter((c) => OTHERS[c]).map((c, i) => ['dev' + i, {
    profile: { name: OTHERS[c], emoji: '🙂', playerId: c }, updatedAt: NOW, stats: { games: {} } }]).concat([['devme', { profile: { name: 'Tester', emoji: '🙂', playerId: ME }, updatedAt: NOW, stats: { games: {} } }]])),
  darts: {
    index: {
      [ME]: {
        mh1abc2dx9f3q: { with: 'ZQXWV', name: 'Zed', emoji: '😀', updated: NOW - 1000, yourTurn: true, over: false, open: '', expires: 0, turnAt: NOW - 1000, ended: '', sent: false, mine: 100, theirs: 120, lastBy: 'them', kind: '301' },
        mh1abc2dx9f3r: { with: 'KMNPR', name: 'Kay', emoji: '🙂', updated: NOW - 2000, yourTurn: false, over: false, open: '', expires: 0, turnAt: NOW - 2000, ended: '', sent: true, mine: 200, theirs: 150, lastBy: 'me', kind: '301' },
        mh1abc2dx9f3s: { with: 'HJKRT', name: 'Hal', emoji: '🙂', updated: NOW - 3000, yourTurn: false, over: true, result: 'won', why: 'done', open: '', ended: '', sent: true, mine: 0, theirs: 40, lastBy: 'me', kind: '301' },
        mh1abc2dx9f3t: { with: 'WBCDF', name: '', emoji: '🙂', updated: NOW - 4000, yourTurn: false, over: true, result: 'lost', why: 'done', open: '', ended: '', sent: false, mine: 90, theirs: 0, lastBy: 'them', kind: '301' },
      },
    },
  },
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await ctx.route('**/js/firebase-boot.js', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_BOOT }));
await ctx.addInitScript(({ db, me, online }) => {
  window.__FAKE_DB__ = db;
  // The online gate refuses test automation by design (js/automation.js); this run has a fake database
  // and no network, so the flag is hidden from the page for the pick-a-person sheet to list anyone.
  try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); } catch { /* keep */ }
  try {
    localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ online }));
    localStorage.setItem('gamehub.devAllowSync.v1', '0');
    localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'Tester', emoji: '🙂', preferredColor: null, opponents: [], message: '', playerId: me, updatedAt: 1 }));
  } catch { /* none */ }
}, { db: fakeDb, me: ME, online: ONLINE });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForSelector('.hub-tile, .hub-grid', { timeout: 20000 });
await page.waitForTimeout(1500);

const html = () => page.evaluate(() => document.documentElement.outerHTML);
const reads = () => page.evaluate(() => window.__FAKE_READS.slice());

// --- Messages: the list ---
await page.evaluate(async () => { const m = await import('/js/messages-ui.js'); m.openMessages(); });
await page.waitForSelector('.msg-row', { timeout: 10000 });
await page.waitForTimeout(500);
let h = await html();
ok('Messages list: no other player code in the page', leaks(h).length === 0, leaks(h).join());
ok('Messages list: no data-code attribute', !/data-code=/.test(h));
const names = await page.$$eval('.msg-row .msg-row-name', (els) => els.map((e) => e.textContent.trim()));
ok('Messages list: names shown, a nameless person reads "Player"', names.includes('Zed') && names.includes('Kay') && names.includes('Player'), names.join('|'));

// A tap opens the right conversation (it reads messages/threads/<pairKey> with THAT person's code).
await page.evaluate(() => { window.__FAKE_READS.length = 0; });
await page.locator('.msg-row', { hasText: 'Zed' }).first().click();
await page.waitForSelector('.msg-thread, textarea', { timeout: 10000 });
await page.waitForTimeout(500);
let r = await reads();
ok('Tapping Zed reads the Zed thread', r.some((p) => p.includes('messages/threads/' + ['TESTA', 'ZQXWV'].sort().join('_'))), r.join(' | '));
h = await html();
ok('Messages thread: no other player code in the page', leaks(h).length === 0, leaks(h).join());
const title = await page.$eval('.gh-modal__title, .msg-title, h2', (e) => e.textContent.trim()).catch(() => '');
ok('Messages thread: titled with the name', /Zed/.test(await page.evaluate(() => document.body.innerText)), title);

// Sending goes to the right code (devAllowSync 0 blocks the real write; the call must still target Zed).
// Writes are allowed only after the fake database is proven to be the one in use (nothing real is reachable).
const allowWrites = () => page.evaluate(() => {
  if (!window.__FAKE_READS.length) throw new Error('the fake database is not in use');
  localStorage.setItem('gamehub.devAllowSync.v1', '1');
});
await allowWrites();
await page.evaluate(() => { window.__FAKE_WRITES = []; });
const box = page.locator('textarea').first();
if (await box.count()) {
  await box.fill('hello');
  const send = page.locator('[data-role="send"], button:has-text("Send")').first();
  if (await send.count()) { await send.click(); await page.waitForTimeout(800); }
}
const w = await page.evaluate(() => (window.__FAKE_WRITES || []).map((x) => x[0]));
ok('Send writes Zed\'s thread and index row', w.some((p) => p.includes(['TESTA', 'ZQXWV'].sort().join('_'))) && w.some((p) => p.includes('index/ZQXWV')), w.join(' | '));

// --- Messages: the picker ---
await page.evaluate(async () => { const m = await import('/js/messages-ui.js'); m.openMessages(); });
await page.waitForSelector('[data-role="new"]', { timeout: 10000 });
await page.locator('[data-role="new"]').click();
await page.waitForSelector('.msg-row--compact', { timeout: 10000 });
h = await html();
ok('New-message picker: no other player code in the page', leaks(h).length === 0, leaks(h).join());
await page.evaluate(() => { window.__FAKE_READS.length = 0; });
await page.locator('.msg-row--compact', { hasText: 'Hal' }).first().click();
await page.waitForTimeout(600);
r = await reads();
ok('Picking Hal opens the Hal thread', r.some((p) => p.includes('messages/threads/' + ['TESTA', 'HJKRT'].sort().join('_'))), r.join(' | '));

// --- Multiplayer screen ---
await page.evaluate(() => { document.querySelectorAll('.msg-overlay, .gh-modal, [data-gh-overlay]').forEach((e) => e.remove()); });
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForSelector('.hub-tile, .hub-grid', { timeout: 20000 });
await page.waitForTimeout(1500);
const opened = await page.evaluate(async () => {
  const btn = document.querySelector('[data-role="challenges"], .hub-chbar, #chbar, [data-tab="challenges"]');
  if (btn) { btn.click(); return 'button'; }
  return 'none';
});
if (opened === 'none') {
  await page.evaluate(async () => {
    const m = await import('/js/challenges-ui.js');
    m.openChallenges({ games: [{ id: 'darts', name: 'Darts' }], live: [], onOpen() {}, onChallenge() {}, onLaunch() {}, onClose() {} });
  });
}
await page.waitForSelector('.cx-live, .cx-tile, .cx-open', { timeout: 15000 });
await page.waitForTimeout(800);
h = await html();
ok('Multiplayer home: no other player code in the page', leaks(h).length === 0, leaks(h).join());
ok('Multiplayer home: no data-nudge-to carrying a code', !/data-nudge-to="[A-Z0-9]{5}"/.test(h));
const bells = await page.$$('.cx-bell');
ok('Multiplayer home: a remind bell is drawn for a their-turn row', bells.length >= 1);

// The bell targets the right person: sendNudge writes nudges/<THEIR CODE>/... (dev guard may hold the write).
await allowWrites();
await page.evaluate(() => { window.__FAKE_WRITES = []; });
if (bells.length) { await bells[0].click(); await page.waitForTimeout(800); }
const nudges = await page.evaluate(() => (window.__FAKE_WRITES || []).map((x) => x[0]));
ok('The bell nudges Kay (the their-turn row)', nudges.some((p) => p.includes('nudges/KMNPR')), nudges.join(' | '));

// Records and a person's page.
const recBtn = page.locator('.cx-rec, [data-role="records"], button:has-text("-")').first();
let opp = null;
const recLinks = await page.$$('[data-role="records"], .cx-rec');
if (recLinks.length) { await recLinks[0].click(); await page.waitForSelector('[data-opp]', { timeout: 8000 }).catch(() => {}); }
opp = await page.$$('[data-opp]');
ok('Records lists the people from the finished matches', opp.length >= 2, String(opp.length));
h = await html();
ok('Records: no other player code in the page', leaks(h).length === 0, leaks(h).join());
ok('Records: data-opp is a plain index', (await page.$$eval('[data-opp]', (els) => els.every((e) => /^\d+$/.test(e.dataset.opp)))));
if (opp.length) {
  const nm = await opp[0].$eval('.cx-ln', (e) => e.textContent.trim());
  await opp[0].click();
  await page.waitForTimeout(500);
  const body = await page.evaluate(() => document.body.innerText);
  ok('A Records row opens that person page (their name is the title)', nm.length > 0 && body.includes(nm), nm);
  h = await html();
  ok('A Records person page: no other player code in the page', leaks(h).length === 0, leaks(h).join());
  ok('A Records person page offers Challenge', !!(await page.$('[data-role="ch"]')));
}

// --- the pick-a-person sheet (darts) ---
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForSelector('.hub-tile, .hub-grid', { timeout: 20000 });
await page.evaluate(async () => {
  const m = await import('/js/challenges-ui.js');
  window.__picked = null;
  m.openChallenges({ games: [{ id: 'darts', name: 'Darts' }], live: [], onOpen() {}, onChallenge(g, them) { window.__picked = { g, them }; }, onLaunch() {}, onClose() {} });
});
await page.waitForSelector('.cx-tile', { timeout: 15000 });
await page.locator('.cx-tile').first().click();
await page.waitForSelector('.cx-person', { timeout: 10000 });
h = await html();
ok('Pick-a-person sheet: no other player code in the page', leaks(h).length === 0, leaks(h).join());
ok('Pick-a-person sheet: rows carry an index', await page.$$eval('.cx-person', (els) => els.length > 0 && els.every((e) => /^\d+$/.test(e.dataset.pi || ''))));
await page.locator('.cx-person', { hasText: 'Kay' }).first().click();
await page.locator('[data-role="go"]').click();
await page.waitForTimeout(400);
const picked = await page.evaluate(() => window.__picked);
ok('Picking Kay challenges Kay (right code, name, game)', !!picked && picked.g === 'darts' && picked.them.code === 'KMNPR' && picked.them.name === 'Kay', JSON.stringify(picked));

ok('no uncaught page errors', errors.length === 0, errors.join(' | '));
console.log(`\nno-codes browser tests: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
