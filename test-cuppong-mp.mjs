// test-cuppong-mp.mjs - Cup Pong challenges (cup-pong/js/mp.js), headless.
//
// The PURE halves (validation by replay, the frame swap, records) and the WRITE path end to end,
// against an in-memory database handed in through mp.js's test seam, with two profiles taking
// turns on one "server". Also structural: `cuppong` is in database.rules.json and the backup list.
//   node test-cuppong-mp.mjs
import { readFileSync } from 'node:fs';

// --- a browser-ish global: localStorage, one per "phone" ---------------------------------------
const stores = { A: new Map(), B: new Map() };
let phone = 'A';
globalThis.localStorage = {
  getItem: (k) => (stores[phone].has(k) ? stores[phone].get(k) : null),
  setItem: (k, v) => stores[phone].set(k, String(v)),
  removeItem: (k) => stores[phone].delete(k),
};
const use = (p) => { phone = p; };
stores.A.set('gamehub.profile', JSON.stringify({ name: 'Matt', emoji: '🐙', playerId: 'MATTA' }));
stores.B.set('gamehub.profile', JSON.stringify({ name: 'Ana', emoji: '🦊', playerId: 'ANABB' }));

const MP = await import('./cup-pong/js/mp.js');
const { Match } = await import('./cup-pong/js/match.js');

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
const api = {
  ref: (db, path) => ({ path }),
  get: async (r) => { const v = clone(getAt(r.path)); return { exists: () => v !== undefined && v !== null, val: () => v }; },
  set: async (r, v) => setAt(r.path, v),
  update: async (r, patch) => { for (const k of Object.keys(patch)) setAt(r.path + '/' + k, patch[k]); },
};
MP.__setBootForTest(async () => ({ db: {}, api }));

// --- a whole challenge, played by the rules, both phones -------------------------------------------
use('A');
let res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, rules: { gent: true, rr: 'inf' } });
ok('the challenger can create a match', res.ok, JSON.stringify(res));
const id = res.id;
ok('created: only the challenger has a row until the first turn is over',
  !!getAt(`cuppong/index/MATTA/${id}`) && !getAt(`cuppong/index/ANABB/${id}`));

// Matt's first turn: k0 in, then a miss. The turn passes to Ana.
let g = res.game;
const t = (by, m) => ({ by, k: 't', p: 0.5, a: 0.01, m, b: 0 });
res = await MP.appendLog(id, 0, [t('a', 'k0')]);
ok('a throw lands and is verified', res.ok && res.game.log.length === 1);
ok('mid-turn: still no row for the other person', !getAt(`cuppong/index/ANABB/${id}`));
res = await MP.appendLog(id, 1, [t('a', null)]);
ok('turn over: now it is Ana\'s turn', res.ok && res.game.turn === 'b');
const anaRow = getAt(`cuppong/index/ANABB/${id}`);
ok('the challenge reaches Ana as HER turn, written by the other side', anaRow && anaRow.yourTurn === true && anaRow.lastBy === 'them' && anaRow.name === 'Matt');
ok('the retry of an entry already there writes nothing twice', (await MP.appendLog(id, 1, [t('a', null)])).ok && Object.keys(getAt(`cuppong/games/${id}/log`)).length === 2);
ok('Matt cannot throw on Ana\'s turn', !(await MP.appendLog(id, 2, [t('a', 'k1')])).ok);

// Ana's phone: she is side 'b', but her local match puts HER at 'a'.
use('B');
g = await MP.readGame(id);
ok('Ana reads the match, and it is her turn', g && MP.isMyTurn(g, 'ANABB'));
const local = MP.buildLocal(g, 'b');
ok('in Ana\'s frame she is \'a\' and shooting; Matt\'s full rack is \'b\'', local.racks.a.length === 9 && local.racks.b.length === 10 && local.shooter === 'a');
ok('...and the cup Matt made is gone from HER rack', !local.racks.a.some((k) => k.id === 'k0'));
ok('the throws to show her start where Matt\'s run starts', MP.lastRunStart(g, 'a') === 0);
res = await MP.appendLog(id, 2, [t('b', null), t('b', null)]);
ok('Ana throws twice and the turn goes back', res.ok && res.game.turn === 'a');

// A log that does not replay is refused whole.
use('A');
const bad = clone(getAt(`cuppong/games/${id}`));
bad.log['0002'].by = 'a';
ok('a log that does not replay is not a match', MP.validateGame(bad) === null);
const lie = clone(getAt(`cuppong/games/${id}`));
lie.over = { winner: 'a', why: 'cups', at: 1 };
ok('a result the log did not produce is refused (unless it is a resignation)', MP.validateGame(lie) === null);

// Resigning: Ana quits, Matt wins; nothing is deleted.
use('B');
res = await MP.resignGame(id);
ok('a resignation ends it, the other person wins', res.ok && res.game.over.winner === 'a' && res.game.over.why === 'resign');
ok('both rows say so, from their own side',
  getAt(`cuppong/index/MATTA/${id}`).result === 'won' && getAt(`cuppong/index/ANABB/${id}`).result === 'lost');
ok('nothing was deleted: the log is all still there', Object.keys(getAt(`cuppong/games/${id}/log`)).length === 4);

// Counting a finished match once per phone.
use('A');
let rows = await MP.readMyGames();
ok('recordFinished counts it once', MP.recordFinished(rows) === 1 && MP.recordFinished(rows) === 0);
const st = JSON.parse(localStorage.getItem('gamehub.stats'));
ok('...as an mp win for Matt', st && st.games.cuppong.byDiff.mp && st.games.cuppong.byDiff.mp.won === 1);
ok('...and it is queued for the Game Over popup', MP.readUnseen().includes(id));
const rec = MP.recordsFrom(rows, 'MATTA');
ok('history: one opponent, 1-0, the resignation named', rec.opponents[0].won === 1 && rec.finished[0].resigned === 'them');

// A full match to the end through the rules: Matt clears 10 cups, Ana's rebuttal misses.
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, rules: { gent: false, rr: 0 } });
const id2 = res.id;
let n = 0;
const send = async (who, list) => { const r = await MP.appendLog(id2, n, list); n += list.length; return r; };
for (let i = 0; i < 10; i++) {
  // Two makes a pair: balls back each time, so Matt never loses the turn. The 10th is the last cup
  // with a ball still to throw: a miss with it removes the cup and Ana gets her rebuttal.
  const r = await send('a', [t('a', 'k' + i)]);
  if (!r.ok) { ok('full match: every make lands', false, r.reason); break; }
}
// On fire keeps a ball in hand, so miss until the turn passes (the last cup goes on the first).
for (let i = 0; i < 3; i++) { res = await send('a', [t('a', null)]); if (!res.ok || res.game.turn === 'b') break; }
ok('clearing the rack hands Ana her rebuttal', res.ok && res.game.phase === 'rebuttal' && res.game.turn === 'b');
ok('her row says it is a rebuttal', getAt(`cuppong/index/ANABB/${id2}`).rebuttal === true);
use('B');
res = await send('b', [t('b', null), t('b', null)]);
ok('both rebuttal balls miss: Matt wins', res.ok && res.game.over && res.game.over.winner === 'a' && res.game.over.why === 'rebuttal');
ok('Ana\'s row: lost, written by her own last throw', getAt(`cuppong/index/ANABB/${id2}`).result === 'lost' && getAt(`cuppong/index/ANABB/${id2}`).lastBy === 'me');

// --- structural -------------------------------------------------------------------------------------
const rules = JSON.parse(readFileSync('database.rules.json', 'utf8'));
ok('database.rules.json has the cuppong branch', !!(rules.rules && rules.rules.cuppong));
ok('the backup reads the cuppong branch', /['"]cuppong['"]/.test(readFileSync('backups/rtdb-backup.mjs', 'utf8')));
ok('mp.js deletes nothing', !/\.remove\(|set\([^)]*,\s*null\)/.test(readFileSync('cup-pong/js/mp.js', 'utf8')));

console.log(`\nCup Pong challenge tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
