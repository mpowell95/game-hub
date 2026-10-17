// tools/test-game-chat-log.mjs - js/messages.js logGameChat (2026-10-17): a LIVE-ROOM quick-chat line
// saved into the sender's conversation with each other player at the table. Thread only (no index
// row, so no push and no unread badge), additive, verified. In-memory database.
// Run: node tools/test-game-chat-log.mjs
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('ok   ', name); } else { fail++; console.log('FAIL ', name, extra); } };

const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
store['gamehub.profile'] = JSON.stringify({ version: 1, name: 'Matt', emoji: '🧊', opponents: [], updatedAt: 1, playerId: 'MMMMM' });

const { logGameChat, __setBootForTest, pairKey } = await import('../js/messages.js');

const data = {};
let n = 0, failNext = false;
const getAt = (path) => path.split('/').reduce((o, k) => (o == null ? undefined : o[k]), data);
const setAt = (path, v) => { const ks = path.split('/'); let o = data; for (const k of ks.slice(0, -1)) o = (o[k] = o[k] || {}); o[ks.at(-1)] = v; };
const api = {
  ref: (db, path) => ({ path }),
  push: (ref) => { const key = `k${String(++n).padStart(4, '0')}`; return { path: `${ref.path}/${key}`, key }; },
  set: async (ref, v) => { if (failNext) { failNext = false; return; } setAt(ref.path, JSON.parse(JSON.stringify(v))); },
  get: async (ref) => { const v = getAt(ref.path); return { exists: () => v !== undefined, val: () => v }; },
  update: async () => { throw new Error('logGameChat must never update an index'); },
};
__setBootForTest(async () => ({ db: {}, api, uid: 'uid1' }));

const res = await logGameChat({ toCodes: ['AAAAA', 'BBBBB', 'MMMMM', 'aaaaa'], game: 'holdem', stats: 'holdem', room: 'QZ7K', payload: { t: 'p', v: 'nice' }, text: 'Nice!' });
ok('saved once per OTHER player (self and duplicates dropped)', res.ok && res.sent === 2, JSON.stringify(res));
const thread = (code) => Object.values(getAt(`messages/threads/${pairKey('MMMMM', code)}/msgs`) || {});
const a = thread('AAAAA');
ok('the line lands in the conversation with A', a.length === 1);
ok('it carries the game, room and payload', a[0] && a[0].game && a[0].game.id === 'holdem' && a[0].game.room === 'QZ7K' && a[0].game.t === 'p' && a[0].game.v === 'nice');
ok('and plain text for an older app', a[0] && a[0].text === 'Nice!' && a[0].from === 'MMMMM');
ok('no index row was touched (no push, no unread)', getAt('messages/index') === undefined);
ok('the device claimed its code first (rules need it)', getAt('msgAuth/uid1') === 'MMMMM');

const before = thread('AAAAA').length;
await logGameChat({ toCodes: ['AAAAA'], game: 'holdem', stats: 'holdem', room: 'QZ7K', payload: { t: 'e', v: '🔥' } });
ok('additive: a second line is a NEW child, the first is still there', thread('AAAAA').length === before + 1);

failNext = true;
const r2 = await logGameChat({ toCodes: ['AAAAA'], game: 'holdem', payload: { t: 'c', v: 'lost' } });
ok('a write that never lands is reported, not claimed', r2.ok === false && r2.sent === 0);
ok('a bad game id writes nothing', (await logGameChat({ toCodes: ['AAAAA'], game: 'Hold Em!', payload: { t: 'c', v: 'x' } })).sent === 0);
ok('an empty line writes nothing', (await logGameChat({ toCodes: ['AAAAA'], game: 'holdem', payload: { t: 'c', v: '' } })).sent === 0);

__setBootForTest(null);
console.log(`\nGame chat log: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
