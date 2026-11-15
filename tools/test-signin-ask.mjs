// tools/test-signin-ask.mjs - Allow / Deny sign in (2026-11-15): the pure rules (js/signin-rules.js), the gate
// (js/admin-config.js resolveSigninAsk), the server (functions/signin.js handleSignIn, against an in-memory database),
// and the phone's own writes (js/signin-ask.js, against a fake Firebase). No network. Codes are made up (DREG5 is
// test1's, the default ask set); never Matt's.
//
//   node tools/test-signin-ask.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name); } };

const R = await import('../js/signin-rules.js');
const S = await import('../functions/signin.js');
const A = await import('../js/admin-config.js');

// --- the pure rules -----------------------------------------------------------------------------------------------
const T0 = 1_800_000_000_000;
ok('the server and the phone agree on 10 minutes', R.LAPSE_MS === S.LAPSE_MS && R.LAPSE_MS === 10 * 60 * 1000);
ok('a fresh request is waiting', R.isWaiting({ state: 'waiting', at: T0 }, T0 + 60e3));
ok('at 10 minutes it lapses (server time)', R.isLapsed({ state: 'waiting', at: T0 }, T0 + R.LAPSE_MS) && !R.isWaiting({ state: 'waiting', at: T0 }, T0 + R.LAPSE_MS));
ok('no server clock: not decided, still waiting', !R.isLapsed({ state: 'waiting', at: T0 }, null));
ok('waitView: granted = in', R.waitView({ state: 'allowed', granted: true, at: T0 }, T0) === 'in');
ok('waitView: allowed but not yet granted by the server = still waiting', R.waitView({ state: 'allowed', at: T0 }, T0 + 1000) === 'wait');
ok('waitView: denied', R.waitView({ state: 'denied', at: T0 }, T0) === 'denied');
ok('waitView: a late Allow the server refused = no answer', R.waitView({ state: 'allowed', bad: 'lapsed', at: T0 }, T0) === 'lapsed');
ok('waitView: lapsed by the clock', R.waitView({ state: 'waiting', at: T0 }, T0 + R.LAPSE_MS + 1) === 'lapsed');

// "That's me" (Matt, 2026-11-15): a name under 24 hours old links at once for EVERY code, gated or not ("it works
// without an approval if someone makes a new account, then saves the gamehub to their home screen, and logs in from
// there again, right?"). Only a gated code's older name asks.
const H = 60 * 60 * 1000;
ok('That\'s me, gated code, name 2 hours old: links at once, NO Allow (the Home Screen app case)', R.thatsMeRoute({ gated: true, ageMs: 2 * H }) === 'link');
ok('That\'s me, gated code, name 23.9 hours old: links at once', R.thatsMeRoute({ gated: true, ageMs: 24 * H - 1 }) === 'link');
ok('That\'s me, gated code, name 24 hours old: asks for Allow', R.thatsMeRoute({ gated: true, ageMs: 24 * H }) === 'ask');
ok('That\'s me, gated code, no server time: asks (never links blind)', R.thatsMeRoute({ gated: true, ageMs: -1 }) === 'ask');
ok('non-gated code, under 24 hours: That\'s me, as today', R.thatsMeRoute({ gated: false, ageMs: 2 * H }) === 'link');
ok('non-gated code, older: "Taken. Use that code instead.", as today', R.thatsMeRoute({ gated: false, ageMs: 48 * H }) === 'none');
ok('non-gated code, no server time: as today (no offer)', R.thatsMeRoute({ gated: false, ageMs: -1 }) === 'none');
// The gate's 24-hour test before this change was `age >= 0 && age < ME_WINDOW_MS`: identical for every age.
for (const age of [-1, 0, 1, 23 * H, 24 * H - 1, 24 * H, 100 * H]) {
  const today = age >= 0 && age < 24 * H;
  if ((R.thatsMeRoute({ gated: false, ageMs: age }) === 'link') !== today) ok(`non-gated route at age ${age} matches today`, false);
}
ok('non-gated routes match the old 24-hour rule at every age tried', true);

ok('device line: Android Chrome', R.deviceLine('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36') === 'Android · Chrome');
ok('device line: iPhone Safari', R.deviceLine('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1') === 'iPhone · Safari');
ok('device line: iPhone Chrome', R.deviceLine('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1') === 'iPhone · Chrome');
ok('device line: nothing known', R.deviceLine('') === 'Phone');
let sn = R.nextSeen(null, 100);
ok('seen: first showing', sn.first === 100 && sn.last === 100 && sn.n === 1 && !sn.tap);
sn = R.nextSeen(sn, 200);
ok('seen: shown again', sn.first === 100 && sn.last === 200 && sn.n === 2);
sn = R.nextSeen(sn, 300, 'allow');
ok('seen: the tap is kept, how often is not bumped', sn.tap === 'allow' && sn.tapAt === 300 && sn.n === 2 && sn.first === 100);
const wl = R.waitingList({ a: { state: 'waiting', at: T0 }, b: { state: 'denied', at: T0 }, c: { state: 'waiting', at: T0 - R.LAPSE_MS }, d: { state: 'waiting', at: T0 + 5 } }, T0 + 10);
ok('waiting list: only live waiting rows, newest first', wl.map((x) => x.id).join() === 'd,a');

// --- the gate ------------------------------------------------------------------------------------------------------
ok('gate: test1 (DREG5) asks by default; a made-up code does not', A.resolveSigninAsk(null, 'DREG5') && !A.resolveSigninAsk(null, 'TQW7K'));

// --- the server ----------------------------------------------------------------------------------------------------
function fakeDb(tree) {
  const parts = (p) => String(p).split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);
  const setAt = (p, v) => {
    const ks = parts(p); let o = tree;
    for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  return {
    tree, getAt,
    ref: (p) => ({
      get: async () => ({ val: () => { const v = getAt(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
      set: async (v) => setAt(p, v),
      update: async (patch) => { for (const [k, v] of Object.entries(patch)) setAt(`${p}/${k}`, v); },
    }),
  };
}
const db = fakeDb({ msgAuth: { 'uid-old-phone': 'DREG5', 'uid-other-code': 'TQW7K', 'uid-matt-x': 'ZZPPA' }, admins: { 'uid-matt-x': true } });
const sent = [];
const send = async (c, note, tag) => { sent.push({ c, tag, en: note.text('en'), es: note.text('es') }); };
const req = { uid: 'uid-new-phone', name: 'test1', device: 'Android · Chrome', at: T0, via: 'link', state: 'waiting' };
const run = (before, after, now = T0 + 60e3, reqId = 'r1') => S.handleSignIn(db, { code: 'DREG5', reqId, before, after, now, send });

let did = await run(null, req);
ok('server: a new request notifies the code\'s phones', did === 'notified' && sent.length === 1 && sent[0].c === 'DREG5' && sent[0].tag === 'signin-r1');
ok('server: "New sign in for <name>" / the device line', sent[0].en.title === 'New sign in for test1' && sent[0].en.body === 'Android · Chrome' && /test1/.test(sent[0].es.title));
ok('server: it notes it notified (who was told)', db.getAt('signIns/DREG5/r1/pushedAt') === T0 + 60e3);
db.tree.signIns.DREG5.r1 = Object.assign({}, req, { pushedAt: T0 + 60e3 });
did = await run(req, Object.assign({}, req, { pushedAt: 1 }));
ok('server: its own stamp re-firing does nothing', did === 'none' && sent.length === 1);
did = await run(req, Object.assign({}, req, { seen: { 'uid-old-phone': { first: 1, last: 1, n: 1 } } }));
ok('server: a seen stamp does nothing', did === 'none');
did = await run(req, Object.assign({}, req, { state: 'denied', by: 'uid-old-phone', answeredAt: T0 + 1 }));
ok('server: a Deny grants nothing', did === 'none' && db.getAt('msgAuth/uid-new-phone') === undefined);
did = await run(req, Object.assign({}, req, { state: 'cancelled' }));
ok('server: a Cancel grants nothing', did === 'none' && db.getAt('msgAuth/uid-new-phone') === undefined);

did = await run(req, Object.assign({}, req, { state: 'allowed', by: 'uid-other-code', answeredAt: T0 + 2 }));
ok('server: an Allow from ANOTHER code\'s phone is refused', did === 'refused:not-theirs' && db.getAt('msgAuth/uid-new-phone') === undefined && db.getAt('signIns/DREG5/r1/bad') === 'not-theirs');
db.tree.signIns.DREG5.r1 = Object.assign({}, req);
did = await run(req, Object.assign({}, req, { state: 'allowed', by: 'uid-new-phone', answeredAt: T0 + 2 }));
ok('server: the asking phone cannot allow itself', did === 'refused:self' && db.getAt('msgAuth/uid-new-phone') === undefined);
db.tree.signIns.DREG5.r1 = Object.assign({}, req);
did = await run(req, Object.assign({}, req, { state: 'allowed', by: 'uid-nobody', answeredAt: T0 + 2 }));
ok('server: an Allow from a phone with no claim is refused', did === 'refused:not-theirs' && db.getAt('msgAuth/uid-new-phone') === undefined);
db.tree.signIns.DREG5.r1 = Object.assign({}, req);
did = await run(req, Object.assign({}, req, { state: 'allowed', by: 'uid-old-phone', answeredAt: T0 + R.LAPSE_MS + 5 }), T0 + R.LAPSE_MS + 6);
ok('server: an Allow after 10 minutes is refused and the request lapses', did === 'refused:lapsed' && db.getAt('signIns/DREG5/r1/state') === 'lapsed' && db.getAt('msgAuth/uid-new-phone') === undefined);

db.tree.signIns.DREG5.r1 = Object.assign({}, req);
const allowed = Object.assign({}, req, { state: 'allowed', by: 'uid-old-phone', answeredAt: T0 + 90e3 });
db.tree.signIns.DREG5.r1 = allowed;
did = await run(req, allowed, T0 + 91e3);
ok('server: the code\'s own phone allows: msgAuth/<new phone> = the code', did === 'granted' && db.getAt('msgAuth/uid-new-phone') === 'DREG5');
ok('server: the request is stamped granted (what the new phone waits for)', db.getAt('signIns/DREG5/r1/granted') === true && db.getAt('signIns/DREG5/r1/grantedAt') === T0 + 91e3);
ok('server: nothing else was touched (old phone keeps its claim)', db.getAt('msgAuth/uid-old-phone') === 'DREG5' && db.getAt('msgAuth/uid-other-code') === 'TQW7K');
did = await run(allowed, db.getAt('signIns/DREG5/r1'), T0 + 92e3);
ok('server: its granted stamp re-firing does nothing', did === 'none');

db.tree.signIns.DREG5.r2 = Object.assign({}, req, { uid: 'uid-new-2' });
const byMatt = Object.assign({}, req, { uid: 'uid-new-2', state: 'allowed', by: 'uid-matt-x', answeredAt: T0 + 5 });
did = await run(db.tree.signIns.DREG5.r2, byMatt, T0 + 6, 'r2');
ok('server: Matt (an admin) allows from Admin > Now', did === 'granted' && db.getAt('msgAuth/uid-new-2') === 'DREG5');
ok('server: a malformed code is ignored', (await S.handleSignIn(db, { code: 'nope', reqId: 'x', before: null, after: req, now: T0, send })) === 'none');

// The trigger is wired, and reads only small paths (functions are billed by download).
const idx = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
ok('functions/index.js: signInOnWrite on signIns/{code}/{reqId}, sends through sendTo with game "signin"',
  /export const signInOnWrite = onValueWritten\(\{ ref: '\/signIns\/\{code\}\/\{reqId\}'/.test(idx) && /sendTo\(db, c, note, tag, \{ game: 'signin' \}\)/.test(idx));
const srv = readFileSync(new URL('../functions/signin.js', import.meta.url), 'utf8');
ok('functions/signin.js reads only msgAuth/<uid> and admins/<uid>', !/ref\('signIns'\)|ref\('msgAuth'\)\.get|ref\('admins'\)\.get/.test(srv));

// --- the phone's own writes (js/signin-ask.js) against a fake Firebase ---------------------------------------------
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.location = { hostname: 'example.test' };
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile', webdriver: false }, configurable: true }); } catch { /* node has one */ }
let M = null;
try { M = await import('../js/signin-ask.js'); } catch (err) { console.log('note: js/signin-ask.js could not load in Node:', err.message); }
if (M) {
  const pdb = fakeDb({ msgAuth: { 'uid-old-phone': 'DREG5' } });
  let n = 0;
  const api = {
    ref: (_d, p) => p, push: (p) => ({ key: `k${++n}aaaaaa`, toString: () => p, _p: `${p}/k${n}aaaaaa` }),
    serverTimestamp: () => T0 + 1000,
    set: async (r, v) => { const p = typeof r === 'string' ? r : r._p; pdb.ref(p).set(JSON.parse(JSON.stringify(v))); },
    update: async (p, v) => pdb.ref(p).update(JSON.parse(JSON.stringify(v))),
    get: async (p) => { const v = pdb.getAt(p); return { exists: () => v !== undefined, val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) }; },
  };
  let uid = 'uid-new-phone';
  M.__setBootForTest(async () => ({ db: pdb, api, uid }));
  const r = await M.createRequest('DREG5', { name: 'test1', via: 'link' });
  const row = r.ok ? pdb.getAt(`signIns/DREG5/${r.id}`) : null;
  ok('phone: the request carries its own uid, name, device, server time, waiting', !!row && row.uid === 'uid-new-phone' && row.name === 'test1' && row.device === 'Android · Chrome' && row.at === T0 + 1000 && row.state === 'waiting' && row.via === 'link');
  ok('phone: no profile, stats or saves were written', !Object.keys(store).some((k) => /profile|stats|save/.test(k)));
  ok('phone: not signed in until the server says so', !(await M.confirmClaim('DREG5')));
  uid = 'uid-old-phone';
  await M.noteSeen('DREG5', r.id);
  const a = await M.answerRequest('DREG5', r.id, true);
  const after = pdb.getAt(`signIns/DREG5/${r.id}`);
  ok('other phone: Allow writes only state, by (its uid) and answeredAt', a.ok && after.state === 'allowed' && after.by === 'uid-old-phone' && after.answeredAt === T0 + 1000 && after.uid === 'uid-new-phone');
  ok('other phone: who saw it is on the request', after.seen && after.seen['uid-old-phone'] && after.seen['uid-old-phone'].n === 1);
  await S.handleSignIn(pdb, { code: 'DREG5', reqId: r.id, before: row, after, now: T0 + 2000, send });
  uid = 'uid-new-phone';
  ok('phone: after the server\'s grant, its own claim reads back', await M.confirmClaim('DREG5'));
  ok('phone: its view is "in"', R.waitView(pdb.getAt(`signIns/DREG5/${r.id}`), T0 + 3000) === 'in');
  const r2 = await M.createRequest('DREG5', { name: 'test1', via: 'thatsme' });
  const c = await M.cancelRequest('DREG5', r2.id);
  ok('phone: Cancel withdraws (state cancelled), nothing deleted', c.ok && pdb.getAt(`signIns/DREG5/${r2.id}/state`) === 'cancelled' && pdb.getAt(`signIns/DREG5/${r2.id}/uid`) === 'uid-new-phone');
  M.saveWait({ code: 'DREG5', id: r2.id, name: 'test1', t: Date.now() });
  ok('phone: a wait survives a reload', M.readWait() && M.readWait().id === r2.id);
  M.clearWait();
  ok('phone: and is cleared when it ends', M.readWait() === null);
  globalThis.navigator.webdriver = true;
  ok('phone: test automation never sends a request (js/automation.js)', !(await M.createRequest('DREG5', { name: 'x', via: 'link' })).ok);
  globalThis.navigator.webdriver = false;
}

console.log(`\nsign-in ask tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
