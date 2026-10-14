// test-match-chat.mjs - js/match-chat.js, the shared in-match quick chat (2026-10-14), headless.
//
// The pure halves (cleaning, dropping junk, unseen lines, the seen marks) and the WRITE path end to
// end against an in-memory database handed in through the module's test seam. Also structural:
// the chat lives BESIDE a match (`<node>/chat/<id>`), never inside `<node>/games/<id>`, and the
// module deletes nothing. The DOM half (js/match-chat-ui.js) is checked in a browser, not here.
//   node test-match-chat.mjs
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const C = await import('./js/match-chat.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

// --- the in-memory database ----------------------------------------------------------------------
const root = {};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const parts = (p) => p.split('/').filter(Boolean);
function getAt(p) { let n = root; for (const k of parts(p)) { if (!n || typeof n !== 'object') return undefined; n = n[k]; } return n; }
function setAt(p, v) {
  const ks = parts(p); let n = root;
  for (const k of ks.slice(0, -1)) { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
  if (v === null || v === undefined) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = clone(v);
}
const watchers = [];
let dropWrites = false;
const api = {
  ref: (db, path) => ({ path }),
  get: async (r) => { const v = clone(getAt(r.path)); return { exists: () => v !== undefined && v !== null, val: () => v }; },
  set: async (r, v) => { if (!dropWrites) setAt(r.path, v); watchers.forEach((w) => w()); },
  onValue: (r, cb) => {
    const fire = () => { const v = clone(getAt(r.path)); cb({ exists: () => v !== undefined && v !== null, val: () => v }); };
    watchers.push(fire); fire();
    return () => { const i = watchers.indexOf(fire); if (i >= 0) watchers.splice(i, 1); };
  },
};
C.__setBootForTest(async () => ({ db: {}, api }));

// --- pure -------------------------------------------------------------------------------------
ok('cleanChat squeezes spaces and trims', C.cleanChat('  hi   there  ') === 'hi there');
ok('cleanChat caps at CHAT_MAXLEN', C.cleanChat('x'.repeat(500)).length === C.CHAT_MAXLEN);
ok('cleanChat never throws on junk', C.cleanChat(null) === '' && C.cleanChat({}) === '[object Object]');
ok('cleanPayload refuses an unknown type', C.cleanPayload({ t: 'z', v: 'hi' }) === null);
ok('cleanPayload refuses an empty line', C.cleanPayload({ t: 'c', v: '   ' }) === null);
ok('chatPath is a SIBLING of games/', C.chatPath('cuppong', 'abc123') === 'cuppong/chat/abc123');
ok('chatPath refuses a path-injecting id or node', C.chatPath('cuppong', '../x') === null && C.chatPath('a/b', 'abc123') === null);

const raw = {
  k3: { by: 'b', t: 'p', v: 'gg', at: 30 },
  k1: { by: 'a', t: 'e', v: '🔥', at: 10 },
  junk1: { by: 'z', t: 'c', v: 'who?', at: 5 },
  junk2: 'not an object',
  junk3: { by: 'a', t: 'c', v: '   ', at: 7 },
  k2: { by: 'a', t: 'c', v: 'nice   shot', at: 20 },
};
const list = C.chatFrom(raw);
ok('chatFrom drops every malformed line and keeps the rest', list.length === 3, JSON.stringify(list));
ok('chatFrom is oldest first', list.map((c) => c.key).join() === 'k1,k2,k3');
ok('chatFrom cleans free text', list[1].v === 'nice shot');
ok('chatFrom(null) is an empty list, never a throw', Array.isArray(C.chatFrom(null)) && C.chatFrom(null).length === 0);
const many = {};
for (let i = 0; i < 60; i++) many[`k${String(i).padStart(2, '0')}`] = { by: 'a', t: 'e', v: '👍', at: i };
ok('chatFrom keeps only the newest MAX_CHAT', C.chatFrom(many).length === C.MAX_CHAT && C.chatFrom(many)[0].at === 60 - C.MAX_CHAT);
ok('unseenChat: only the OTHER side, only newer', C.unseenChat(list, 'a', 15).map((c) => c.key).join() === 'k3');

// --- the write and the watch ---------------------------------------------------------------------
let seen = null;
const stop = await C.watchChat({ node: 'cuppong', id: 'match0001' }, (l) => { seen = l; });
ok('a watch on an empty match delivers an empty list', Array.isArray(seen) && seen.length === 0);

let res = await C.sendChat({ node: 'cuppong', id: 'match0001', side: 'a' }, { t: 'p', v: 'gl' });
ok('a line lands and is verified', res.ok && res.entry && res.entry.by === 'a' && res.entry.v === 'gl', JSON.stringify(res));
ok('it is written BESIDE the match, not inside it', !!getAt('cuppong/chat/match0001') && getAt('cuppong/games/match0001') === undefined);
ok('the watch hears it', seen && seen.length === 1 && seen[0].v === 'gl');

res = await C.sendChat({ node: 'cuppong', id: 'match0001', side: 'b' }, { t: 'c', v: 'thanks!' });
ok('the other side can answer', res.ok && seen.length === 2 && seen[1].by === 'b');
ok('two lines are two children (additive, never a set over the list)', Object.keys(getAt('cuppong/chat/match0001')).length === 2);

ok('a bad side is refused before any write', (await C.sendChat({ node: 'cuppong', id: 'match0001', side: 'x' }, { t: 'e', v: '👍' })).reason === 'not-your-game');
ok('an empty line is refused', (await C.sendChat({ node: 'cuppong', id: 'match0001', side: 'a' }, { t: 'c', v: ' ' })).reason === 'empty');
dropWrites = true;
res = await C.sendChat({ node: 'cuppong', id: 'match0001', side: 'a' }, { t: 'e', v: '😂' });
dropWrites = false;
ok('a write that never lands is REPORTED, not claimed (rule 6)', !res.ok && res.reason === 'did-not-land' && res.retryable === true);
C.__setBootForTest(async () => null);
res = await C.sendChat({ node: 'cuppong', id: 'match0001', side: 'a' }, { t: 'e', v: '😂' });
ok('no connection is reported as offline, retryable', !res.ok && res.reason === 'offline' && res.retryable);
C.__setBootForTest(async () => ({ db: {}, api }));
stop();
ok('unsubscribing stops the watch', watchers.length === 0);

// Live room reactions.
setAt('rooms/ABCD/reactions/host', { t: 'e', v: '🔥', at: 1 });
let rx = null;
const stopRx = await C.watchRoomReactions('ABCD', (r) => { rx = r; });
ok('watchRoomReactions delivers the raw slot object', rx && rx.host && rx.host.v === '🔥');
stopRx();
ok('watchRoomReactions refuses a malformed code', typeof (await C.watchRoomReactions('../x', () => {})) === 'function');

// --- the seen marks ----------------------------------------------------------------------------
ok('an unseen match reads 0', C.readChatSeen('darts', 'match0001') === 0);
C.markChatSeen('darts', 'match0001', 50);
ok('a mark sticks', C.readChatSeen('darts', 'match0001') === 50);
C.markChatSeen('darts', 'match0001', 20);
ok('a mark only moves forward', C.readChatSeen('darts', 'match0001') === 50);
ok('marks are per node: the same id in another game is separate', C.readChatSeen('cuppong', 'match0001') === 0);
for (let i = 0; i < 230; i++) C.markChatSeen('darts', `m${String(i).padStart(4, '0')}x`, 1000 + i);
const all = JSON.parse(localStorage.getItem(C.SEEN_KEY));
ok('the seen list is capped (a convenience, not history)', Object.keys(all).length === 200);
ok('...keeping the newest', all['darts/m0229x'] === 1229);

// --- structural ---------------------------------------------------------------------------------
const src = readFileSync('./js/match-chat.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
ok('match-chat.js deletes nothing (no remove, no null write)', !/\.remove\(|set\([^)]*,\s*null\)/.test(src));
ok('match-chat.js never writes under games/ or index/', !/\/games\/|\/index\//.test(src));
const sw = readFileSync('./sw.js', 'utf8');
ok('both modules are precached', sw.includes("'./js/match-chat.js'") && sw.includes("'./js/match-chat-ui.js'"));
ok('match-chat.js is NETWORK-FIRST (it writes Firebase and a gamehub.* key)', /NETWORK_FIRST = \[[\s\S]*?'\.\/js\/match-chat\.js'[\s\S]*?\];/.test(sw));
const ui = readFileSync('./js/match-chat-ui.js', 'utf8');
ok('match-chat-ui.js touches no storage and no network', !/localStorage|getStatsApp|firebase/.test(ui.replace(/^\/\/.*$/gm, '')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
