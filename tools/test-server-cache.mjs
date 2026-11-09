// test-server-cache.mjs - the server's read caches (2026-11-09, the Google bill): functions/cache.js
// readPlayers (only changed players/ records downloaded) and functions/bee.js logsFor (a Spelling Bee
// log re-read only when a line was added). Proves the cached answer always equals a fresh full read,
// and that the caches really skip the downloads. Headless, no network.
//
//   node tools/test-server-cache.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, ['tools/sync-functions-shared.mjs'], { cwd: ROOT, stdio: 'ignore' });
const C = await import('../functions/cache.js');
const B = await import('../functions/bee.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('ok   ', name); } else { fail++; console.log('FAIL ', name); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A fake database that counts downloaded bytes and supports orderByChild().startAt().
function fakeDb(tree) {
  const parts = (p) => String(p).split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);
  const db = { tree, bytes: 0, reads: [] };
  const answer = (p, v) => { const j = v === undefined ? 'null' : JSON.stringify(v); db.bytes += j.length; db.reads.push(p); return { val: () => JSON.parse(j) }; };
  db.ref = (p) => ({
    get: async () => answer(p, getAt(p)),
    set: async (v) => { const ks = parts(p); let o = tree; for (const k of ks.slice(0, -1)) o = o[k] = o[k] || {}; o[ks.at(-1)] = v; },
    orderByChild: (child) => ({ startAt: (from) => ({ get: async () => {
      const out = {};
      for (const [k, v] of Object.entries(getAt(p) || {})) if (v && typeof v === 'object' && Number(v[child]) >= from) out[k] = v;
      return answer(`${p}?${child}>=${from}`, out);
    } }) }),
  });
  return db;
}

// --- players/ ------------------------------------------------------------------------------------
const big = 'x'.repeat(20000);
const rec = (name, at) => ({ profile: { name, playerId: 'TESTA' }, stats: { pad: big }, updatedAt: at });
let now = 1_800_000_000_000;
const db = fakeDb({ players: { d1: rec('A', now - 5 * 3600e3), d2: rec('B', now - 4 * 3600e3), d3: rec('C', now - 3600e3) } });

const p1 = await C.readPlayers(db, now);
ok('first read is the whole node', same(p1, db.tree.players) && db.reads.at(-1) === 'players');
p1.d1.stats.pad = 'mutated';   // a rebuild changing its copy
db.bytes = 0;
const p2 = await C.readPlayers(db, now + 60e3);
ok('nothing changed: the answer equals a fresh read (and a caller\'s edits never leak)', same(p2, db.tree.players));
ok('nothing changed: only the newest record is re-asked (the 10-min safety margin), not all three', db.bytes > 20000 && db.bytes < 2 * 20000);

db.tree.players.d2 = rec('B2', now + 120e3);           // a sync
db.tree.players.d4 = rec('New phone', now + 130e3);   // a brand-new device
db.bytes = 0;
const p3 = await C.readPlayers(db, now + 180e3);
ok('a sync and a new device: the answer equals a fresh read', same(p3, db.tree.players));
ok('...downloading only those two records plus the newest one before them', db.bytes > 3 * 20000 && db.bytes < 4 * 20000);

delete db.tree.players.d3;   // a server-side delete (Matt-only tool)
const p4 = await C.readPlayers(db, now + C.FULL_MS + 200e3);
ok('after FULL_MS a full read: a deleted record is gone', same(p4, db.tree.players) && !p4.d3);

const other = fakeDb({ players: { z: rec('Z', now) } });
ok('each database handle has its own cache', same(await C.readPlayers(other, now + 1), other.tree.players));

// --- Spelling Bee logs ---------------------------------------------------------------------------
const bk = 'e-abcdhu';
const lines = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, { t: i, e: 'guess', w: `w${i}`, r: 'ok' }]));
const bdb = fakeDb({ beeLog: { [bk]: { AAAAA: lines(50) } }, boards: { v1: { beeMeta: {} } } });
const l1 = await B.logsFor(bdb, bk, await B.readTouched(bdb), Date.now());
ok('bee: first read is the log', same(l1, bdb.tree.beeLog[bk]));
bdb.bytes = 0;
const l2 = await B.logsFor(bdb, bk, await B.readTouched(bdb), Date.now() + 5 * 60e3);
ok('bee: not touched: no re-read', same(l2, bdb.tree.beeLog[bk]) && !bdb.reads.slice(-1)[0].startsWith('beeLog'));
bdb.tree.beeLog[bk].AAAAA.k50 = { t: 50, e: 'guess', w: 'late', r: 'ok' };
bdb.tree.boards.v1.beeMeta.touched = { [bk]: Date.now() };   // beeLogTouch
const l3 = await B.logsFor(bdb, bk, await B.readTouched(bdb), Date.now() + 6 * 60e3);
ok('bee: a new line + its stamp: re-read, the late line is there', same(l3, bdb.tree.beeLog[bk]) && !!l3.AAAAA.k50);
bdb.tree.beeLog[bk].AAAAA.k51 = { t: 51, e: 'guess', w: 'missed', r: 'ok' };   // a stamp that never came
const l4 = await B.logsFor(bdb, bk, await B.readTouched(bdb), Date.now() + 2 * B.LOG_FULL_MS);
ok('bee: a lost stamp heals at LOG_FULL_MS', !!l4.AAAAA.k51);

// --- ctHistory, re-read at most every 30 minutes -------------------------------------------------
const cdb = fakeDb({ ctHistory: { TESTA: { dev: { 'en-1': { d: 'won' } } } } });
const c1 = await C.readNodeCached(cdb, 'ctHistory', 30 * 60e3, now);
c1.TESTA = null;   // a caller's edit
cdb.bytes = 0;
const c2 = await C.readNodeCached(cdb, 'ctHistory', 30 * 60e3, now + 60e3);
ok('ctHistory: inside 30 min, no download and a clean copy', cdb.bytes === 0 && same(c2, cdb.tree.ctHistory));
cdb.tree.ctHistory.TESTB = { dev: {} };
ok('ctHistory: after 30 min, re-read', !!(await C.readNodeCached(cdb, 'ctHistory', 30 * 60e3, now + 31 * 60e3)).TESTB);

// --- THE GUARD (Matt, 2026-11-09: "I don't want any surprise bills like this EVER again") ----------
// Every server download is billed past ~360 MB a day. No function may read a whole large node
// directly; it goes through functions/cache.js (or a query that downloads only what changed).
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const BIG = ['players', 'ctHistory', 'beeLog', 'beeDaily', 'playLog', 'messages', 'rooms', 'pushSubs', 'ctHistory', 'skeeballThrows'];
  const bad = [];
  for (const f of readdirSync(new URL('../functions/', import.meta.url)).filter((n) => n.endsWith('.js') && n !== 'cache.js')) {
    const src = readFileSync(new URL(`../functions/${f}`, import.meta.url), 'utf8');
    src.split('\n').forEach((line, i) => {
      for (const n of BIG) {
        if (line.includes(`ref('${n}').get()`) || line.includes(`valOf(db, '${n}')`)) bad.push(`functions/${f}:${i + 1} reads all of ${n}/`);
      }
    });
  }
  const allowed = ['functions/bee.js reads all of beeDaily/'];   // 32 KB, only on a board rebuild (not a timer loop)
  const real = bad.filter((b) => !allowed.some((a) => b.startsWith(a.split(' ')[0]) && b.endsWith(a.split(' ').slice(1).join(' '))));
  ok('guard: no function downloads a whole large node outside functions/cache.js' + (real.length ? ` -> ${real.join('; ')}` : ''), real.length === 0);
}

console.log(`\nServer cache tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
