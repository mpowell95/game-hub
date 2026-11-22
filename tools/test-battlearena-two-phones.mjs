// test-battlearena-two-phones.mjs - Battle Arena ONLINE on two real browser "phones" (2026-11-22; Matt: "Fix everything",
// after "I don't see any record of two real phones playing a full online match. All the online testing was automated.").
//
// Two Playwright contexts (402x874, touch, no service worker), each with its own profile, share ONE fake in-memory
// Realtime Database that lives in Node (js/firebase-boot.js is replaced per page; every get/set/update/remove/push/
// transaction goes to Node, which resolves serverTimestamp(), applies it and pushes a fresh snapshot to every phone's
// onValue listeners on a related path). Everything goes through the REAL screens: hub tile -> Online tab -> Challenge /
// Host / Join -> draft -> the board, moves made by tapping two tiles with a touch.
//   1. a turn-by-turn CHALLENGE, phone A to phone B, to the finish
//   2. a LIVE ROOM (A hosts, B joins by the code), to the finish, the 25 s clock on both
//   3. a RESIGN in a challenge: the other phone wins
// Checked after every turn: same stored match on both phones, same HP; at the end: both end cards name the same winner,
// each phone recorded exactly one result ('mp'), no page errors.
// Safe: the database is a JavaScript object, every non-localhost request is aborted, profiles are test1 / DREG5 and a
// made-up test2 / ZQXWV (never Matt's). `navigator.webdriver` is forced false so the app's writers run; that is fine ONLY
// because nothing here can reach a real database.
//   PORT=8123 node server.mjs &
//   NODE_PATH=$(npm root -g) BASE=http://localhost:8123 node tools/test-battlearena-two-phones.mjs   (VERBOSE=1 for shots + progress)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }

const BASE = process.env.BASE || 'http://localhost:8123';
const VERBOSE = !!process.env.VERBOSE;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('ok   ' + n); } else { fail++; console.log('FAIL ' + n + (x ? '  ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); } };
const log = (...a) => { if (VERBOSE) console.log('   ..', ...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------------------------
// The fake database (Node side)
// ------------------------------------------------------------------------------------------------------------------
const parts = (p) => String(p).split('/').filter(Boolean);
const isIntKey = (k) => /^(0|[1-9]\d{0,8})$/.test(k);
function sortKeys(keys) {
  const ints = keys.filter(isIntKey).sort((a, b) => a - b);
  const rest = keys.filter((k) => !isIntKey(k)).sort();
  return ints.concat(rest);
}
/** What the SDK hands back: keys in Firebase's order, a dense numeric-keyed object as an array. */
function norm(v) {
  if (v === null || typeof v !== 'object') return v;
  const keys = sortKeys(Object.keys(v));
  if (keys.length && keys.every(isIntKey)) {
    const max = Number(keys[keys.length - 1]);
    if (max < keys.length * 2) { const arr = []; for (let i = 0; i <= max; i++) arr.push(v[i] === undefined ? null : norm(v[i])); return arr; }
  }
  const o = {};
  for (const k of keys) o[k] = norm(v[k]);
  return o;
}
/** Firebase stores no nulls and no empty objects; arrays become index-keyed objects; server placeholders resolve. */
function clean(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'object') return v;
  if (v['.sv'] === 'timestamp') return Date.now();
  const src = Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [String(i), x])) : v;
  const out = {};
  for (const k of Object.keys(src)) { const c = clean(src[k]); if (c !== undefined) out[k] = c; }
  return Object.keys(out).length ? out : undefined;
}
class FakeDB {
  constructor(seed) {
    this.root = {};
    this.phones = [];
    this.writes = 0;
    for (const [p, v] of Object.entries(seed)) this.setAt(p, v, false);
  }
  readRaw(path) {
    let n = this.root;
    for (const k of parts(path)) { if (n === null || typeof n !== 'object') return undefined; n = n[k]; }
    return n;
  }
  read(path) {
    if (path === '.info/serverTimeOffset') return 0;
    if (path === '.info/connected') return true;
    const v = this.readRaw(path);
    return v === undefined ? null : JSON.parse(JSON.stringify(norm(v)));
  }
  setAt(path, val, notify = true) {
    const ps = parts(path);
    const c = clean(val);
    if (!ps.length) this.root = c || {};
    else {
      const chain = [this.root];
      let n = this.root;
      for (let i = 0; i < ps.length - 1; i++) {
        if (n[ps[i]] === null || typeof n[ps[i]] !== 'object') { if (c === undefined) return; n[ps[i]] = {}; }
        n = n[ps[i]]; chain.push(n);
      }
      if (c === undefined) delete n[ps[ps.length - 1]]; else n[ps[ps.length - 1]] = c;
      for (let i = chain.length - 1; i > 0; i--) if (!Object.keys(chain[i]).length) delete chain[i - 1][ps[i - 1]];
    }
    this.writes++;
    if (notify) this.notify(path);
  }
  update(path, obj) {
    for (const k of Object.keys(obj || {})) this.setAt(parts(path).concat(parts(k)).join('/'), obj[k], false);
    this.notify(path);
  }
  related(a, b) { const x = parts(a), y = parts(b), n = Math.min(x.length, y.length); for (let i = 0; i < n; i++) if (x[i] !== y[i]) return false; return true; }
  notify(path) {
    for (const ph of this.phones) for (const [id, l] of ph.listeners) if (this.related(l.path, path)) this.enqueue(ph, id, l);
  }
  enqueue(ph, id, l) {
    ph.q = ph.q.then(async () => {
      if (!ph.listeners.has(id)) return;
      const j = JSON.stringify(this.read(l.path));
      if (l.last === j) return;
      l.last = j;
      try { await ph.page.evaluate(([i, s]) => window.__dbEmit && window.__dbEmit(i, s), [id, j]); } catch { /* page gone */ }
    });
  }
}

// ------------------------------------------------------------------------------------------------------------------
// The fake js/firebase-boot.js (page side)
// ------------------------------------------------------------------------------------------------------------------
const fakeBoot = (uid) => `
const parts = (p) => String(p).split('/').filter(Boolean);
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const call = (op, a, b) => window.__dbCall(op, a, b);
function snap(path, v) {
  v = clone(v);
  return { key: parts(path).pop() || null, val: () => clone(v), exists: () => v !== null,
    hasChildren: () => !!v && typeof v === 'object' && Object.keys(v).length > 0,
    exportVal: () => clone(v), size: v && typeof v === 'object' ? Object.keys(v).length : 0,
    forEach(cb) { if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (cb(snap(path + '/' + k, v[k])) === true) break; } return false; },
    child: (p) => { let n = v; for (const k of parts(p)) { if (n == null || typeof n !== 'object') { n = null; break; } n = n[k]; } return snap(path + '/' + p, n === undefined ? null : n); } };
}
const listeners = new Map();
let nid = 0, pushN = 0;
window.__dbEmit = (id, json) => { const l = listeners.get(id); if (l) l(JSON.parse(json)); };
const get = async (r) => snap(r.path, JSON.parse(await call('get', r.path)));
const set = async (r, v) => { await call('set', r.path, JSON.stringify(v === undefined ? null : v)); };
const api = {
  ref: (db, path) => ({ path: parts(path || '').join('/'), get key() { return parts(this.path).pop() || null; } }),
  child: (r, p) => ({ path: parts(r.path + '/' + p).join('/'), get key() { return parts(this.path).pop() || null; } }),
  get,
  set,
  update: async (r, o) => { await call('update', r.path, JSON.stringify(o || {})); },
  remove: async (r) => { await call('set', r.path, 'null'); },
  push: (r) => { const key = '-P' + Date.now().toString(36) + (pushN++).toString(36) + Math.random().toString(36).slice(2, 5); return { path: parts(r.path + '/' + key).join('/'), key }; },
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  onValue: (r, cb) => {
    const id = ++nid;
    listeners.set(id, (v) => { try { cb(snap(r.path, v)); } catch (err) { console.error('[fake-db] listener threw', err); } });
    call('listen', String(id), r.path);
    return () => { listeners.delete(id); call('unlisten', String(id)); };
  },
  runTransaction: async (r, fn) => {
    const cur = await get(r);
    const nv = fn(cur.val());
    if (nv === undefined) return { committed: false, snapshot: cur };
    await set(r, nv);
    return { committed: true, snapshot: await get(r) };
  },
  query: (r) => r, orderByChild: () => null, orderByKey: () => null, orderByValue: () => null, limitToLast: () => null, limitToFirst: () => null,
  startAfter: () => null, startAt: () => null, endAt: () => null, endBefore: () => null, equalTo: () => null,
  onDisconnect: () => ({ set: async () => {}, update: async () => {}, remove: async () => {}, cancel: async () => {} }),
  goOffline: () => {}, goOnline: () => {},
};
const boot = { db: {}, api, uid: ${JSON.stringify(uid)} };
export function getStatsApp() { return Promise.resolve(boot); }
export function perfReport() { return null; }
export default { getStatsApp };
`;

// ------------------------------------------------------------------------------------------------------------------
// Phones
// ------------------------------------------------------------------------------------------------------------------
const PEOPLE = {
  A: { name: 'test1', code: 'DREG5', emoji: '🦊', uid: 'uid-phone-a', dev: 'dev-aaaa-1111' },
  B: { name: 'test2', code: 'ZQXWV', emoji: '🐼', uid: 'uid-phone-b', dev: 'dev-bbbb-2222' },
};
const seedDb = () => ({
  adminConfig: { v1: { online: { DREG5: true, ZQXWV: true }, games: { 'battle-arena': { allow: { DREG5: true, ZQXWV: true } } } } },
  admins: { [PEOPLE.A.uid]: true, [PEOPLE.B.uid]: true },
  msgAuth: { [PEOPLE.A.uid]: 'DREG5', [PEOPLE.B.uid]: 'ZQXWV' },
  directory: { DREG5: { name: 'test1', emoji: '🦊', at: Date.now() }, ZQXWV: { name: 'test2', emoji: '🐼', at: Date.now() } },
  usernames: { test1: { code: 'DREG5' }, test2: { code: 'ZQXWV' } },
});

let browser;
async function newPhone(db, who) {
  const me = PEOPLE[who];
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.route((url) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url.href), (route) => route.abort());
  await ctx.route('**/js/firebase-boot.js', (route) => route.fulfill({ contentType: 'text/javascript', body: fakeBoot(me.uid) }));
  const ph = { who, me, ctx, page: null, listeners: new Map(), q: Promise.resolve(), errors: [], consoleErrors: [] };
  await ctx.exposeBinding('__dbCall', async (_src, op, a, b) => {
    if (op === 'get') return JSON.stringify(db.read(a));
    if (op === 'set') { db.setAt(a, JSON.parse(b)); return ''; }
    if (op === 'update') { db.update(a, JSON.parse(b)); return ''; }
    if (op === 'listen') { const l = { path: b, last: undefined }; ph.listeners.set(Number(a), l); db.enqueue(ph, Number(a), l); return ''; }
    if (op === 'unlisten') { ph.listeners.delete(Number(a)); return ''; }
    return '';
  });
  await ctx.addInitScript((c) => {
    try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); } catch { /* keep */ }
    try {
      if (!localStorage.getItem('gamehub.profile')) {
        localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: c.name, emoji: c.emoji, preferredColor: null, opponents: [], message: '', playerId: c.code, updatedAt: 1 }));
        localStorage.setItem('gamehub.stats.owner.v1', c.code);
        localStorage.setItem('gamehub.devAllowSync.v1', '1');          // the "dev origin" guard: the database here is fake
        localStorage.setItem('gamehub.adminDevice.v1', '1');
        localStorage.setItem('gamehub.adminConfig.v1', JSON.stringify({ online: { DREG5: true, ZQXWV: true }, games: { 'battle-arena': { allow: { DREG5: true, ZQXWV: true } } } }));
        // The first-match tutorial blocks the board until Got it (tools/test-battlearena-tips.mjs tests it): seen here.
        localStorage.setItem('gamehub.battlearena.v1', JSON.stringify({ tips2: { health: 1, moves: 1, yours: 1, food: 1, doSwap: 1, charged: 1, movesLeft: 1, power: 1, extraMove: 1, berries: 1, doEvolve: 1, boom: 1, doExtra: 1, doBerry: 1, doBomb: 1, arena: 1, theirTurn: 1 } }));
      }
    } catch { /* none */ }
  }, { name: me.name, emoji: me.emoji, code: me.code });
  const page = await ctx.newPage();
  ph.page = page;
  page.on('pageerror', (e) => ph.errors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) ph.consoleErrors.push(m.text().slice(0, 300)); });
  db.phones.push(ph);
  return ph;
}
async function openGame(ph) {
  const p = ph.page;
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForSelector('.hub-card[data-id="battle-arena"]', { timeout: 25000 });
  await sleep(600);
  await dismissPopups(ph);
  await p.click('.hub-card[data-id="battle-arena"]');
  await p.waitForFunction(() => window.__baTest && window.__baTest.screen, null, { timeout: 25000 });
  await shot(ph, 'opened');
  ph.opened = await p.evaluate(() => window.__baTest.screen);
  log(ph.who, 'opened on', ph.opened);
  // A waiting challenge opens straight from the hub tile (the launcher's your-turn hand-over): then no home screen.
  if (ph.opened === 'home') await p.waitForSelector('.ba-home [data-tab="online"]', { timeout: 15000 });
}
/** The hub may show an announcement or the add-to-home sheet over the launcher: close what is there. */
async function dismissPopups(ph) {
  for (let i = 0; i < 4; i++) {
    const n = await ph.page.evaluate(() => {
      let c = 0;
      for (const b of document.querySelectorAll('.gh-overlay [data-role="close"], .gh-overlay .gh-modal__close, .gh-overlay [data-act="close"], .gh-overlay [data-act="dismiss"]')) { try { b.click(); c++; } catch { /* none */ } }
      return c;
    });
    if (!n) break;
    await sleep(300);
  }
}
const shot = async (ph, name) => { if (VERBOSE) { try { await ph.page.screenshot({ path: `/tmp/ba2p-${ph.who}-${name}.png` }); } catch { /* none */ } } };

const click = async (ph, sel, timeout = 15000) => { await ph.page.waitForSelector(sel, { state: 'visible', timeout }); await ph.page.click(sel); };
async function onlineTab(ph) { await click(ph, '.ba-home [data-tab="online"]'); await sleep(400); }

/** Draft two monsters with Random, then Fight. */
async function draftAndFight(ph) {
  await ph.page.waitForSelector('.ba-draft [data-role="random"]', { state: 'visible', timeout: 15000 });
  await ph.page.click('[data-role="random"]');
  await sleep(200);
  await ph.page.waitForFunction(() => { const f = document.querySelector('[data-role="fight"]'); return f && !f.disabled; }, null, { timeout: 5000 });
  await ph.page.click('[data-role="fight"]');
}

// --- reading a phone --------------------------------------------------------------------------------------------
const view = (ph) => ph.page.evaluate(() => {
  const u = window.__baTest;
  if (!u) return null;
  const s = u.state, c = u.canon;
  return {
    screen: u.screen, busy: !!u.busy, inbox: (u.inbox || []).length, linkKind: u.link && u.link.kind, seat: u.link ? u.link.seat : null,
    turn: s ? s.turn : null, winner: s ? s.winner : null, moveNo: c ? c.moveNo : null, turnNo: c ? c.turnNo : null, canInput: u.canInput(),
    canon: c ? JSON.stringify(c) : null,
    hp: s ? [s.sides[0].hp, s.sides[1].hp] : null,
    hpDom: [...document.querySelectorAll('.ba-hp-n')].map((e) => e.textContent.trim()),
    clock: (() => { const e = document.querySelector('.ba-clock'); return e ? { hidden: e.hidden, n: (e.querySelector('.ba-clock-n') || {}).textContent } : null; })(),
    result: (() => { const e = document.querySelector('.ba-result-title'); return e ? e.textContent.trim() : null; })(),
    resultWhy: (() => { const e = document.querySelector('.ba-result-why'); return e ? e.textContent.trim() : null; })(),
  };
});
const myStats = (ph) => ph.page.evaluate(async () => {
  const G = await import('/js/game-stats.js');
  const st = G.loadStats();
  const g = (st.games || {}).battlearena || {};
  return { total: g.total || null, mp: (g.byDiff || {}).mp || null, byMode: g.byMode || null, h2h: (st.h2h || {}).battlearena || null };
});

/** Tap two tiles on this phone's board with a touch (the legal swap that clears the most). */
async function makeMove(ph) {
  const pick = await ph.page.evaluate(async () => {
    const u = window.__baTest;
    if (!u || !u.canInput()) return null;
    const E = await import('/battle-arena/js/engine.js');
    const moves = E.legalMoves(u.state);
    if (!moves.length) return { pass: true };
    let best = moves[0], bestN = -1;
    for (const m of moves) { const r = E.apply(u.state, { type: 'swap', a: m.a, b: m.b, side: 0 }); const n = r.ok ? r.events.length : -1; if (n > bestN) { bestN = n; best = m; } }
    const rect = (i) => { const el = u.tiles.get(u.state.board[i].id); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    return { a: rect(best.a), b: rect(best.b), moveNo: u.canon.moveNo };
  });
  if (!pick || pick.pass) return false;
  await ph.page.touchscreen.tap(pick.a.x, pick.a.y);
  await sleep(120);
  await ph.page.touchscreen.tap(pick.b.x, pick.b.y);
  // The move took when the stored match moved on.
  try { await ph.page.waitForFunction((n) => { const u = window.__baTest; return u && u.canon && u.canon.moveNo > n; }, pick.moveNo, { timeout: 6000 }); } catch { return false; }
  return true;
}

/** Wait until both phones have shown everything made so far (no animation, nothing queued, same move count). */
async function settle(A, B, ms = 25000) {
  const t0 = Date.now();
  let a, b;
  while (Date.now() - t0 < ms) {
    a = await view(A); b = await view(B);
    if (a && b && a.screen === 'battle' && b.screen === 'battle' && !a.busy && !b.busy && !a.inbox && !b.inbox && a.moveNo === b.moveNo) return { a, b, settled: true };
    await sleep(150);
  }
  return { a, b, settled: false };
}

/** Compare the two phones after a turn. Returns an error string or ''. */
function compare(a, b) {
  if (a.canon !== b.canon) return 'stored match differs (moveNo ' + a.moveNo + ' vs ' + b.moveNo + ')';
  // The screens are mirrors: my HP here is their HP there.
  if (a.hp[0] !== b.hp[1] || a.hp[1] !== b.hp[0]) return `HP mirrored differs ${a.hp} vs ${b.hp}`;
  const sa = a.hpDom.slice().sort().join(','), sb = b.hpDom.slice().sort().join(',');
  if (sa !== sb) return `HP shown differs ${a.hpDom} vs ${b.hpDom}`;
  if (a.hpDom.length === 2 && sa !== a.hp.slice().sort().join(',')) return `HP shown is not the HP ${a.hpDom} vs ${a.hp}`;
  return '';
}

/** Play a match to its end: whoever can move makes a move; at each new turn both phones are compared first. */
async function playToEnd(A, B, tag, maxMs = 420000) {
  const t0 = Date.now();
  let turnsChecked = 0, bad = '', lastTurnKey = '', moves = 0;
  while (Date.now() - t0 < maxMs) {
    const a = await view(A), b = await view(B);
    if (!a || !b) { await sleep(200); continue; }
    if ((a.winner != null && b.winner != null) || a.result || b.result) break;
    const mover = a.canInput ? A : b.canInput ? B : null;
    if (!mover) { await sleep(150); continue; }
    const mv = mover === A ? a : b;
    const key = String(mv.turnNo);
    if (key !== lastTurnKey) {
      const s = await settle(A, B);
      if (!s.settled) { bad = bad || `phones never settled before turn ${key}`; log(tag, 'unsettled', s.a && s.a.moveNo, s.b && s.b.moveNo, s.a && s.a.inbox, s.b && s.b.inbox); }
      else { const err = compare(s.a, s.b); if (err) bad = bad || `turn ${key}: ${err}`; turnsChecked++; }
      lastTurnKey = key;
    }
    const did = await makeMove(mover);
    if (did) moves++; else await sleep(300);
    if (did && moves % 10 === 0) log(tag, 'moves', moves, 'hp', mv.hp);
  }
  return { turnsChecked, bad, moves, ms: Date.now() - t0 };
}

/** After the end: both phones show an end card naming the same winner. */
async function endCards(A, B, tag) {
  let a, b;
  for (let i = 0; i < 80; i++) { a = await view(A); b = await view(B); if (a && b && a.result && b.result) break; await sleep(250); }
  await shot(A, tag + '-end'); await shot(B, tag + '-end');
  ok(`${tag}: both phones show an end card`, !!(a && a.result && b && b.result), { a: a && a.result, b: b && b.result });
  ok(`${tag}: both end cards name the same winner`, a && b && a.result === b.result, { a: a && a.result, b: b && b.result });
  ok(`${tag}: both phones agree on the winning side`, a && b && a.winner != null && a.winner === 1 - b.winner, { a: a && a.winner, b: b && b.winner });
  return { a, b };
}

async function stats(A, B, tag, wantWinnerA) {
  await sleep(1500);   // the winning move's server write, then the count
  const sa = await myStats(A), sb = await myStats(B);
  ok(`${tag}: phone A recorded exactly one 'mp' result`, sa.mp && sa.mp.played === 1 && sa.total && sa.total.played === 1, sa);
  ok(`${tag}: phone B recorded exactly one 'mp' result`, sb.mp && sb.mp.played === 1 && sb.total && sb.total.played === 1, sb);
  if (wantWinnerA != null) {
    ok(`${tag}: A's result is a ${wantWinnerA ? 'win' : 'loss'}`, sa.mp && sa.mp.won === (wantWinnerA ? 1 : 0), sa.mp);
    ok(`${tag}: B's result is a ${wantWinnerA ? 'loss' : 'win'}`, sb.mp && sb.mp.won === (wantWinnerA ? 0 : 1), sb.mp);
  }
  ok(`${tag}: the two results are one win and one loss`, sa.mp && sb.mp && sa.mp.won + sb.mp.won === 1, { a: sa.mp, b: sb.mp });
  return { sa, sb };
}
function noErrors(tag, ...phs) {
  for (const ph of phs) {
    ok(`${tag}: no page errors on phone ${ph.who}`, ph.errors.length === 0, ph.errors.slice(0, 3));
    const ce = ph.consoleErrors.filter((x) => /battle-arena|\[net\]|fake-db|live-leave/i.test(x));
    ok(`${tag}: no game errors logged on phone ${ph.who}`, ce.length === 0, ce.slice(0, 3));
  }
}

async function scenario(name, fn) {
  const db = new FakeDB(seedDb());
  const A = await newPhone(db, 'A'), B = await newPhone(db, 'B');
  console.log(`\n== ${name}`);
  try { await fn(db, A, B); }
  catch (err) { ok(`${name}: ran without throwing`, false, String((err && err.stack) || err).split('\n').slice(0, 4).join(' | ')); await shot(A, 'crash'); await shot(B, 'crash'); }
  await A.ctx.close(); await B.ctx.close();
}

/** A challenges B through the Online tab, and plays its whole first turn (two moves). */
async function challengeAndFirstTurn(db, A) {
  await openGame(A);
  await onlineTab(A);
  await click(A, '.ba-home [data-role="anyone"]');
  await A.page.waitForSelector('.ba-ol-row', { timeout: 15000 });
  const names = await A.page.evaluate(() => [...document.querySelectorAll('.ba-ol-row .ba-ol-name')].map((e) => e.textContent.trim()));
  ok('A sees test2 in the picker (and not itself)', names.includes('test2') && !names.includes('test1'), names);
  await A.page.click('.ba-ol-row:has(.ba-ol-name:text-is("test2"))');
  await draftAndFight(A);
  await A.page.waitForFunction(() => window.__baTest && window.__baTest.screen === 'battle', null, { timeout: 20000 });
  await sleep(1200);
  const gid = Object.keys(db.read('battlearena/games') || {})[0];
  ok('the challenge is on the server with A\'s team and no team for B yet', !!gid && !!db.read(`battlearena/games/${gid}/a/team`) && !db.read(`battlearena/games/${gid}/b/team`), gid);
  let first = false;
  for (let i = 0; i < 5; i++) {   // two moves (a 4-in-a-row gives one more) until the turn passes
    await A.page.waitForFunction(() => { const u = window.__baTest; return (u.canInput() || u.state.turn !== 0) && !u.busy; }, null, { timeout: 20000 });
    const v = await view(A);
    if (v.turn !== 0) break;
    const did = await makeMove(A);
    if (i === 0) first = did;
  }
  await A.page.waitForFunction(() => { const u = window.__baTest; return u.state.turn !== 0 && !u.busy; }, null, { timeout: 30000 });
  ok('A made its first turn (two moves) and the turn passed', first && (await view(A)).turn === 1);
  await sleep(1500);
  return gid;
}
/** B opens the waiting challenge from its Online tab, drafts and fights. */
async function bOpensChallenge(B) {
  await openGame(B);
  if (B.opened === 'home') {
    await onlineTab(B);
    await B.page.waitForSelector('.ba-home .ba-ol-row.is-mine', { timeout: 20000 });
    ok('B sees the challenge from test1 with Play', (await B.page.textContent('.ba-home .ba-ol-row.is-mine')).includes('test1'));
    await shot(B, 'ch-row');
    await B.page.click('.ba-home .ba-ol-row.is-mine');
  } else ok('B opens the hub tile and the waiting challenge opens (draft first)', B.opened === 'draft', B.opened);
  await draftAndFight(B);
  await B.page.waitForFunction(() => window.__baTest && window.__baTest.screen === 'battle', null, { timeout: 20000 });
  await sleep(1500);
}

browser = await pw.chromium.launch();

// ------------------------------------------------------------------------------------------------------------------
// 1. A challenge, turn by turn
// ------------------------------------------------------------------------------------------------------------------
await scenario('challenge A -> B to the finish', async (db, A, B) => {
  const gid = await challengeAndFirstTurn(db, A);
  // B has nothing before A's first turn ended: it opens the hub after.
  await bOpensChallenge(B);
  ok('B\'s team is now stored', !!db.read(`battlearena/games/${gid}/b/team`));
  const s0 = await settle(A, B);
  ok('after B joined: both phones show the same match, HP and turn', s0.settled && !compare(s0.a, s0.b), s0.settled ? compare(s0.a, s0.b) : 'unsettled');
  ok('B names the other player test1 on screen', await B.page.evaluate(() => [...document.querySelectorAll('.ba-name')].some((e) => e.textContent.includes('test1'))));
  ok('A names the other player test2 on screen', await A.page.evaluate(() => [...document.querySelectorAll('.ba-name')].some((e) => e.textContent.includes('test2'))));
  await shot(A, 'ch-battle'); await shot(B, 'ch-battle');
  const r = await playToEnd(A, B, 'challenge');
  ok(`challenge: every turn matched on both phones (${r.turnsChecked} turns, ${r.moves} moves, ${Math.round(r.ms / 1000)} s)`, !r.bad && r.turnsChecked >= 4, r.bad || r.turnsChecked);
  const e = await endCards(A, B, 'challenge');
  await stats(A, B, 'challenge', e.a && e.a.winner === 0);
  // Done: back on the Online tab, still one result each.
  for (const ph of [A, B]) await ph.page.evaluate(() => { const d = document.querySelector('.ba-result [data-role="done"]'); if (d) d.click(); });
  await sleep(1200);
  for (const ph of [A, B]) await ph.page.evaluate(() => window.__baTest.renderHome('online'));
  await sleep(2000);
  const sa = await myStats(A), sb = await myStats(B);
  ok('challenge: after Done and a fresh Online tab, still one result each (no double count)', sa.mp.played === 1 && sb.mp.played === 1, { a: sa.mp, b: sb.mp });
  ok('the server holds the finished match', !!db.read(`battlearena/games/${gid}/log`), db.read(`battlearena/games/${gid}/over`));
  noErrors('challenge', A, B);
});

// ------------------------------------------------------------------------------------------------------------------
// 2. A live room
// ------------------------------------------------------------------------------------------------------------------
await scenario('live room A hosts, B joins by the code', async (db, A, B) => {
  await openGame(A); await openGame(B);
  await onlineTab(A);
  await click(A, '.ba-home [data-role="host"]');
  await draftAndFight(A);
  await A.page.waitForFunction(() => /^[A-Z0-9]{4}$/.test((document.querySelector('.ba-ol-code') || {}).textContent || ''), null, { timeout: 15000 });
  const code = (await A.page.textContent('.ba-ol-code')).trim();
  ok(`A's lobby shows a room code (${code})`, /^[A-Z0-9]{4}$/.test(code));
  ok('the room exists on the server, waiting, host = test1', db.read(`rooms/${code}/status`) === 'waiting' && db.read(`rooms/${code}/host/name`) === 'test1', db.read(`rooms/${code}`));
  await onlineTab(B);
  await click(B, '.ba-home [data-role="join"]');
  await B.page.fill('.ba-ol-input', code);
  await click(B, '.ba-ol-lobby [data-role="go"]');
  await draftAndFight(B);
  await A.page.waitForFunction(() => window.__baTest.screen === 'battle', null, { timeout: 25000 });
  await B.page.waitForFunction(() => window.__baTest.screen === 'battle', null, { timeout: 25000 });
  await sleep(1500);
  const va = await view(A), vb = await view(B);
  ok('both phones are in the same live match', va.linkKind === 'live' && vb.linkKind === 'live');
  ok('host is seat 0 and moves first; guest is seat 1', va.seat === 0 && vb.seat === 1 && va.turn === 0 && vb.turn === 1, { a: [va.seat, va.turn], b: [vb.seat, vb.turn] });
  const ca = (await view(A)).clock, cb = (await view(B)).clock;
  ok('the move clock shows on both phones (visible, a number up to 25)', ca && cb && !ca.hidden && !cb.hidden && +ca.n > 0 && +ca.n <= 25 && +cb.n > 0 && +cb.n <= 25, { ca, cb });
  await sleep(2500);
  const ca2 = (await view(A)).clock, cb2 = (await view(B)).clock;
  ok('the clock counts down on both phones', +ca2.n < +ca.n && +cb2.n < +cb.n, { ca, ca2, cb, cb2 });
  await shot(A, 'live-battle'); await shot(B, 'live-battle');
  const names = await Promise.all([A, B].map((ph) => ph.page.evaluate(() => [...document.querySelectorAll('.ba-name')].map((e) => e.textContent.trim()))));
  ok('each phone names the other player', names[0].includes('test2') && names[1].includes('test1'), names);
  const r = await playToEnd(A, B, 'live');
  ok(`live: every turn matched on both phones (${r.turnsChecked} turns, ${r.moves} moves, ${Math.round(r.ms / 1000)} s)`, !r.bad && r.turnsChecked >= 4, r.bad || r.turnsChecked);
  const e = await endCards(A, B, 'live');
  const { sa, sb } = await stats(A, B, 'live', e.a && e.a.winner === 0);
  const h2n = (h) => Object.values(h || {}).reduce((n, x) => n + (x.w | 0) + (x.l | 0), 0);
  ok('live: head-to-head recorded once on each phone', h2n(sa.h2h) === 1 && h2n(sb.h2h) === 1, { a: sa.h2h, b: sb.h2h });
  noErrors('live', A, B);
});

// ------------------------------------------------------------------------------------------------------------------
// 3. Resign mid-challenge
// ------------------------------------------------------------------------------------------------------------------
await scenario('resign mid-challenge: the other phone wins', async (db, A, B) => {
  const gid = await challengeAndFirstTurn(db, A);
  await bOpensChallenge(B);
  // B plays one move, then resigns from the menu.
  await B.page.waitForFunction(() => window.__baTest.canInput(), null, { timeout: 40000 });
  await makeMove(B);
  await sleep(1500);
  await click(B, '.ba-menu');
  await B.page.waitForSelector('.gh-modal [data-item]', { timeout: 5000 });
  const items = await B.page.evaluate(() => [...document.querySelectorAll('.gh-modal [data-item]')].map((e) => e.textContent.trim()));
  ok('B\'s menu offers Resign', items.some((x) => /resign/i.test(x)), items);
  await B.page.click('.gh-modal [data-item="0"]');
  await click(B, '.ba-overlay [data-role="yes"]');
  const e = await endCards(A, B, 'resign');
  ok('resign: A is the winner on both screens', e.a && e.b && e.a.winner === 0 && e.b.winner === 1, { a: e.a && e.a.winner, b: e.b && e.b.winner });
  ok('resign: both cards say it was a resignation', e.a && e.b && !!e.a.resultWhy && !!e.b.resultWhy, { a: e.a && e.a.resultWhy, b: e.b && e.b.resultWhy });
  const over = db.read(`battlearena/games/${gid}/over`);
  ok('resign: the server holds over.why = resign, winner = a', over && over.why === 'resign' && over.winner === 'a', over);
  await stats(A, B, 'resign', true);
  noErrors('resign', A, B);
});

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
