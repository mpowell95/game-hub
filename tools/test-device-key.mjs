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

// t 'own' (2026-11-25): a phone whose sign-in changed takes back its own players/ record with its device key.
const odb = fakeDb({ codeKeys: { ABCDE: { [h]: { uid: 'u1', at: 1, last: 1, uids: 1 } } }, players: { 'dev-aaaaaaaa': { profile: { playerId: 'ABCDE' }, own: 'u1' }, 'dev-bbbbbbbb': { profile: { playerId: 'ZZZZZ' }, own: 'u3' } } });
r = await handleClaim(odb, 'u7', { t: 'own', code: 'ABCDE', key, id: 'dev-aaaaaaaa' }, 9000);
ok('own: the right key re-stamps the record for the new sign-in', r.ok && r.why === 'owned' && odb.getAt('players/dev-aaaaaaaa/own') === 'u7' && odb.getAt('msgAuth/u7') === 'ABCDE');
r = await handleClaim(odb, 'u8', { t: 'own', code: 'ABCDE', key, id: 'dev-bbbbbbbb' });
ok('own: a record of ANOTHER code is refused', !r.ok && r.why === 'not-this-code' && odb.getAt('players/dev-bbbbbbbb/own') === 'u3');
r = await handleClaim(odb, 'u8', { t: 'own', code: 'ABCDE', key: 'e'.repeat(64), id: 'dev-aaaaaaaa' });
ok('own: a wrong key is refused', !r.ok && r.why === 'unknown-key' && odb.getAt('players/dev-aaaaaaaa/own') === 'u7');

// t 'claim' (2026-11-25, THE LOCK): only the server writes msgAuth; a key, a brand-new code, or a name under a day.
{
  const NOWC = 1795000000000;
  const tree = {
    codeKeys: { ABCDX: { [h]: { uid: 'u1', at: 1, last: 1, uids: 1 } } },
    players: { 'dev-old-aaaa': { profile: { playerId: 'ABCDX' }, own: 'u1' }, 'dev-new-aaaa': { profile: { playerId: 'NEWPQ' }, own: 'u-new' },
      'dev-nokey-aaaa': { profile: { playerId: 'NKEY2' } } },
    usernames: { matt: { code: 'NKEY2', at: NOWC - 1000 }, older: { code: 'NKEY2', at: NOWC - 2 * 864e5 } },
  };
  const cdb = fakeDb(tree);
  const base = cdb.ref;
  cdb.ref = (p) => Object.assign(base(p), { orderByChild: (c) => ({ equalTo: (want) => ({ get: async () => {
    const all = cdb.getAt(p) || {}; const out = {};
    for (const [k, v] of Object.entries(all)) { const val = String(c).split('/').reduce((o, x) => (o ? o[x] : undefined), v); if (val === want) out[k] = v; }
    return { val: () => (Object.keys(out).length ? JSON.parse(JSON.stringify(out)) : null) };
  } }) }) });
  let c = await handleClaim(cdb, 'u-wiped', { t: 'claim', code: 'ABCDX', key }, NOWC);
  ok('claim: the phone\'s own device key = granted', c.ok && c.why === 'key' && cdb.getAt('msgAuth/u-wiped') === 'ABCDX');
  c = await handleClaim(cdb, 'u-thief', { t: 'claim', code: 'ABCDX' }, NOWC);
  ok('claim: someone else\'s code with no key = needs Allow, nothing written', !c.ok && c.why === 'needs-allow' && cdb.getAt('msgAuth/u-thief') === undefined);
  c = await handleClaim(cdb, 'u-thief', { t: 'claim', code: 'ABCDX', key: 'f'.repeat(64) }, NOWC);
  ok('claim: a made-up key = needs Allow', !c.ok && cdb.getAt('msgAuth/u-thief') === undefined);
  c = await handleClaim(cdb, 'u-new', { t: 'claim', code: 'NEWPQ' }, NOWC);
  ok('claim: a brand-new code whose only record is this phone\'s = granted', c.ok && c.why === 'fresh' && cdb.getAt('msgAuth/u-new') === 'NEWPQ');
  c = await handleClaim(cdb, 'u-new2', { t: 'claim', code: 'ZZZ22' }, NOWC);
  ok('claim: a code nobody has used yet = granted (the first sign-in)', c.ok && c.why === 'fresh');
  c = await handleClaim(cdb, 'u-thief', { t: 'claim', code: 'NEWPQ' }, NOWC);
  ok('claim: a new code with ANOTHER phone\'s record = needs Allow', !c.ok && c.why === 'needs-allow');
  c = await handleClaim(cdb, 'u-thief', { t: 'claim', code: 'NKEY2' }, NOWC);
  ok('claim: an old code with an unowned record and no key = needs Allow', !c.ok && c.why === 'needs-allow');
  c = await handleClaim(cdb, 'u-home', { t: 'claim', code: 'NKEY2', nk: 'matt' }, NOWC);
  ok('claim: "That\'s me" on a name claimed under a day ago = granted', c.ok && c.why === 'recent' && cdb.getAt('msgAuth/u-home') === 'NKEY2');
  c = await handleClaim(cdb, 'u-thief2', { t: 'claim', code: 'NKEY2', nk: 'older' }, NOWC);
  ok('claim: a name over a day old = needs Allow', !c.ok && c.why === 'needs-allow');
  c = await handleClaim(cdb, 'u-thief2', { t: 'claim', code: 'ABCDX', nk: 'matt' }, NOWC);
  ok('claim: a recent name of ANOTHER code does not give this one', !c.ok);
  c = await handleClaim(cdb, 'u-wiped', { t: 'claim', code: 'ABCDX' }, NOWC);
  ok('claim: already holding it = ok', c.ok && c.why === 'already');
}

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
