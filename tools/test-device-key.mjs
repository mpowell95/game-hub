// tools/test-device-key.mjs - device keys, step A (2026-11-04): functions/claim.js (server) and
// js/device-key.js (phone), against an in-memory database. No network.
import { handleClaim, sha256 } from '../functions/claim.js';

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails++; };

function fakeDb(tree) {
  const parts = (p) => String(p).split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);
  const setAt = (p, v) => {
    const ks = parts(p); let o = tree;
    for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  return {
    tree, getAt, setAt,
    ref: (p) => ({
      get: async () => ({ val: () => { const v = getAt(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
      set: async (v) => setAt(p, v),
      update: async (patch) => { for (const [k, v] of Object.entries(patch)) setAt(`${p}/${k}`, v); },
    }),
  };
}

// --- server ---------------------------------------------------------------------------------------
const db = fakeDb({ msgAuth: { u1: 'ABCDE', u3: 'ZZZZZ' } });
const key = 'a'.repeat(64), h = sha256(key);

let r = await handleClaim(db, 'u1', { t: 'reg', code: 'ABCDE', h }, 1000);
ok('reg: a phone holding the claim registers its key', r.ok && r.why === 'registered' && db.getAt(`codeKeys/ABCDE/${h}`).uid === 'u1');
ok('reg: the answer is written for that uid', db.getAt('claimRes/u1').h === h && db.getAt('claimRes/u1').ok === true);
r = await handleClaim(db, 'u1', { t: 'reg', code: 'ABCDE', h }, 2000);
ok('reg: again = already, nothing lost', r.ok && r.why === 'already' && db.getAt(`codeKeys/ABCDE/${h}`).at === 1000);
r = await handleClaim(db, 'u2', { t: 'reg', code: 'ABCDE', h: sha256('b'.repeat(64)) });
ok('reg: a phone WITHOUT the claim is refused', !r.ok && r.why === 'not-claimed' && Object.keys(db.getAt('codeKeys/ABCDE')).length === 1);
r = await handleClaim(db, 'u3', { t: 'reg', code: 'ABCDE', h: sha256('c'.repeat(64)) });
ok('reg: a phone claiming ANOTHER code is refused', !r.ok && r.why === 'not-claimed');
r = await handleClaim(db, 'u1', { t: 'reg', code: 'abcde', h });
ok('reg: a malformed code is refused', !r.ok && r.why === 'bad-code');
r = await handleClaim(db, 'u1', { t: 'reg', code: 'ABCDE', h: 'xyz' });
ok('reg: a malformed hash is refused', !r.ok && r.why === 'bad-hash');

r = await handleClaim(db, 'u9', { t: 'key', code: 'ABCDE', key }, 5000);
ok('key: the right key gives a NEW sign-in its claim back', r.ok && r.why === 'restored' && db.getAt('msgAuth/u9') === 'ABCDE');
ok('key: the key notes the new uid, keeps the record', db.getAt(`codeKeys/ABCDE/${h}`).uid === 'u9' && db.getAt(`codeKeys/ABCDE/${h}`).uids === 2 && db.getAt(`codeKeys/ABCDE/${h}`).at === 1000);
r = await handleClaim(db, 'u8', { t: 'key', code: 'ABCDE', key: 'd'.repeat(64) });
ok('key: a wrong key is refused and claims nothing', !r.ok && r.why === 'unknown-key' && db.getAt('msgAuth/u8') === undefined);
r = await handleClaim(db, 'u8', { t: 'key', code: 'ZZZZZ', key });
ok('key: a right key for ANOTHER code is refused', !r.ok && r.why === 'unknown-key' && db.getAt('msgAuth/u8') === undefined);
r = await handleClaim(db, 'u8', { t: 'pin', code: 'ABCDE' });
ok('an unknown request type is refused', !r.ok && r.why === 'bad-type');

// --- phone ----------------------------------------------------------------------------------------
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const { ensureDeviceKey, keyFor, sha256Hex } = await import('../js/device-key.js');
ok('phone: sha256Hex matches the server', (await sha256Hex(key)) === h);

const pdb = fakeDb({ msgAuth: { p1: 'QWERT' } });
const api = {
  ref: (_db, p) => p,
  get: async (p) => { const v = pdb.getAt(p); return { exists: () => v !== undefined, val: () => v }; },
  set: async (p, v) => { pdb.setAt(p, v); if (p.startsWith('claimReq/')) await handleClaim(pdb, p.split('/')[1], v); },
  serverTimestamp: () => Date.now(),
};
const boot = { db: pdb, api, uid: 'p1' };
let blocked = 0;
ok('phone: a blocked writer sends nothing', (await ensureDeviceKey(boot, 'QWERT', () => { blocked++; return false; })) === false && blocked === 1 && !pdb.getAt('claimReq/p1'));
ok('phone: the key is kept locally even before it is sent', !!keyFor('QWERT') && keyFor('QWERT').ok === false);
const first = keyFor('QWERT').key;
store['gamehub.deviceKey.v1'] = JSON.stringify({ QWERT: Object.assign(keyFor('QWERT'), { sent: 0 }) });
await ensureDeviceKey(boot, 'QWERT', () => true);
ok('phone: sends only the HASH, never the key', pdb.getAt('claimReq/p1').h === sha256(first) && !JSON.stringify(pdb.getAt('claimReq/p1')).includes(first));
ok('phone: the server registered it', !!pdb.getAt(`codeKeys/QWERT/${sha256(first)}`));
ok('phone: next load sees the answer and stops', (await ensureDeviceKey(boot, 'QWERT', () => true)) === true && keyFor('QWERT').ok === true);
ok('phone: the key never changes once made', keyFor('QWERT').key === first);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
