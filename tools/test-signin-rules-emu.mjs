// tools/test-signin-rules-emu.mjs - signIns/ rules (Allow / Deny sign in, 2026-11-15) against the REAL Realtime
// Database emulator, not a JS imitation. Needs firebase-tools and Java. Run from a folder whose firebase.json starts
// the database emulator on port 9311 (or set EMU_PORT):
//
//   firebase emulators:exec --only database --project demo-gh "node <repo>/tools/test-signin-rules-emu.mjs"
//
// Loads the repo's database.rules.json into the emulator (owner), seeds a tiny made-up family, then acts as each
// user with an unsigned token in the `auth` query parameter. Codes are made up (DREG5 is test1's).
import { readFileSync } from 'node:fs';

const B = `http://127.0.0.1:${process.env.EMU_PORT || 9311}`, NS = '?ns=demo-gh-default-rtdb';
const tok = (uid) => {
  const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const t = Math.floor(Date.now() / 1000);
  return e({ alg: 'none', typ: 'JWT' }) + '.' + e({ sub: uid, user_id: uid, uid, iat: t, exp: t + 3600, aud: 'demo-gh', iss: 'https://securetoken.google.com/demo-gh', auth_time: t, firebase: { sign_in_provider: 'anonymous' } }) + '.';
};
const call = async (method, path, uid, body, q = '') => {
  const h = {}; if (uid === 'OWNER') h.Authorization = 'Bearer owner';
  const r = await fetch(`${B}/${path}.json${NS}${q}${uid && uid !== 'OWNER' ? '&auth=' + tok(uid) : ''}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.text() };
};
const rules = readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
const lr = await fetch(`${B}/.settings/rules.json${NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: rules });
if (lr.status !== 200) { console.log('rules did not load', lr.status, await lr.text()); process.exit(1); }

const TS = { '.sv': 'timestamp' };
const NOW = Date.now();
await call('PUT', '', 'OWNER', {
  admins: { uadmin: true }, readers: { ureader: { on: true } },
  msgAuth: { uold: 'DREG5', uother: 'TQW7K', uadmin: 'ZZPPA' },
  signIns: { DREG5: { reqOld: { uid: 'unew', name: 'test1', device: 'Android · Chrome', at: NOW - 1000, via: 'link', state: 'waiting', pushedAt: NOW } } },
});
let bad = 0;
const want = (name, r, exp) => { const okd = (r.status === 200) === exp; if (!okd) bad++; console.log((okd ? 'ok  ' : 'FAIL') + ' ' + name + ' -> ' + r.status + (okd ? '' : ' ' + r.body.slice(0, 120))); };
const fresh = (o = {}) => Object.assign({ uid: 'unew', name: 'test1', device: 'Android · Chrome', at: TS, via: 'link', state: 'waiting' }, o);

// the new phone
want('new phone creates its own waiting request', await call('PUT', 'signIns/DREG5/reqAAAA01', 'unew', fresh()), true);
want('...not in someone else\'s uid', await call('PUT', 'signIns/DREG5/reqAAAA02', 'unew', fresh({ uid: 'uold' })), false);
want('...not already allowed', await call('PUT', 'signIns/DREG5/reqAAAA03', 'unew', fresh({ state: 'allowed' })), false);
want('...not already granted', await call('PUT', 'signIns/DREG5/reqAAAA04', 'unew', fresh({ granted: true })), false);
want('...not with a phone-clock time', await call('PUT', 'signIns/DREG5/reqAAAA05', 'unew', fresh({ at: NOW - 5 * 60e3 })), false);
want('...not with a bad state', await call('PUT', 'signIns/DREG5/reqAAAA06', 'unew', fresh({ state: 'whatever' })), false);
want('new phone reads its own request', await call('GET', 'signIns/DREG5/reqAAAA01', 'unew'), true);
want('new phone cannot list the code\'s requests', await call('GET', 'signIns/DREG5', 'unew'), false);
want('new phone cannot allow itself', await call('PATCH', 'signIns/DREG5/reqAAAA01', 'unew', { state: 'allowed', by: 'unew', answeredAt: TS }), false);
want('new phone cannot write itself a claim through signIns (granted)', await call('PATCH', 'signIns/DREG5/reqAAAA01', 'unew', { granted: true }), false);
want('new phone cancels its own request', await call('PATCH', 'signIns/DREG5/reqAAAA01', 'unew', { state: 'cancelled' }), true);
want('...and cannot reopen it', await call('PATCH', 'signIns/DREG5/reqAAAA01', 'unew', { state: 'waiting' }), false);
want('nobody deletes a request (asker)', await call('DELETE', 'signIns/DREG5/reqOld', 'unew'), false);

// the code's other phone
want('code\'s phone lists waiting requests (query on state)', await call('GET', 'signIns/DREG5', 'uold', undefined, '&orderBy=%22state%22&equalTo=%22waiting%22'), true);
want('another code\'s phone cannot list them', await call('GET', 'signIns/DREG5', 'uother'), false);
want('a visitor cannot list all sign ins', await call('GET', 'signIns', 'uvisitor'), false);
want('another code\'s phone cannot answer', await call('PATCH', 'signIns/DREG5/reqOld', 'uother', { state: 'allowed', by: 'uother', answeredAt: TS }), false);
want('code\'s phone cannot answer as someone else', await call('PATCH', 'signIns/DREG5/reqOld', 'uold', { state: 'allowed', by: 'uadmin', answeredAt: TS }), false);
want('code\'s phone cannot change who asked', await call('PATCH', 'signIns/DREG5/reqOld', 'uold', { state: 'allowed', by: 'uold', answeredAt: TS, uid: 'uother' }), false);
want('code\'s phone cannot grant directly', await call('PATCH', 'signIns/DREG5/reqOld', 'uold', { state: 'allowed', by: 'uold', answeredAt: TS, granted: true }), false);
want('code\'s phone stamps that it saw it', await call('PUT', 'signIns/DREG5/reqOld/seen/uold', 'uold', { first: 1, last: 2, n: 1 }), true);
want('...not someone else\'s seen stamp', await call('PUT', 'signIns/DREG5/reqOld/seen/uadmin', 'uold', { first: 1, last: 2, n: 1 }), false);
want('another code\'s phone cannot stamp seen', await call('PUT', 'signIns/DREG5/reqOld/seen/uother', 'uother', { first: 1, last: 2, n: 1 }), false);
want('a seen stamp cannot be deleted', await call('DELETE', 'signIns/DREG5/reqOld/seen/uold', 'uold'), false);
want('code\'s phone taps Allow', await call('PATCH', 'signIns/DREG5/reqOld', 'uold', { state: 'allowed', by: 'uold', answeredAt: TS }), true);
want('...the answer is final (no flip to denied)', await call('PATCH', 'signIns/DREG5/reqOld', 'uold', { state: 'denied', by: 'uold', answeredAt: TS }), false);
want('code\'s phone can still stamp seen after answering', await call('PUT', 'signIns/DREG5/reqOld/seen/uold', 'uold', { first: 1, last: 3, n: 2, tap: 'allow', tapAt: 3 }), true);
want('nobody deletes a request (code\'s phone)', await call('DELETE', 'signIns/DREG5/reqOld', 'uold'), false);

// Matt
await call('PUT', 'signIns/DREG5/reqBBBB01', 'unew', fresh());
want('admin lists every code\'s requests', await call('GET', 'signIns', 'uadmin'), true);
want('reader key lists them (read only)', await call('GET', 'signIns', 'ureader'), true);
want('reader key cannot answer', await call('PATCH', 'signIns/DREG5/reqBBBB01', 'ureader', { state: 'allowed', by: 'ureader', answeredAt: TS }), false);
want('admin denies from Admin > Now', await call('PATCH', 'signIns/DREG5/reqBBBB01', 'uadmin', { state: 'denied', by: 'uadmin', answeredAt: TS }), true);
want('admin cannot delete either', await call('DELETE', 'signIns/DREG5/reqBBBB01', 'uadmin'), false);
want('nobody deletes all sign ins', await call('DELETE', 'signIns', 'uadmin'), false);

// msgAuth itself is untouched by this step (the lock is the release): a phone still writes its own claim.
want('msgAuth unchanged this step: a phone still writes its own claim', await call('PUT', 'msgAuth/unew2', 'unew2', 'TQW7K'), true);
await call('PUT', 'signIns/DREG5/reqCCCC01', 'unew', fresh());
await call('PUT', 'signIns/DREG5/reqCCCC01/seen/uold', 'uold', { first: 1, last: 1, n: 1 });
want('a waiting answer cannot wipe who saw it', await call('PATCH', 'signIns/DREG5/reqCCCC01', 'uold', { state: 'denied', by: 'uold', answeredAt: TS, seen: null }), false);
want('...and then answers normally', await call('PATCH', 'signIns/DREG5/reqCCCC01', 'uold', { state: 'denied', by: 'uold', answeredAt: TS }), true);
await call('PUT', 'signIns/DREG5/reqDDDD01', 'unew', fresh());
await call('PUT', 'signIns/DREG5/reqDDDD01/seen/uold', 'uold', { first: 1, last: 1, n: 1 });
want('a cancel cannot wipe who saw it', await call('PATCH', 'signIns/DREG5/reqDDDD01', 'unew', { state: 'cancelled', seen: null }), false);

console.log(bad ? `\n${bad} FAILED` : '\nsign-in rules (emulator): all passed');
process.exit(bad ? 1 : 0);
