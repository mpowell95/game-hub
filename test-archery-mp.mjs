// test-archery-mp.mjs - Archery challenges (archery/js/mp.js), headless.
//
// The PURE halves (validation by replay, records) and the WRITE path end to end, against an
// in-memory database handed in through mp.js's test seam, with two profiles taking turns on one
// "server". Also structural: `archery` is in database.rules.json and the backup list.
//   node test-archery-mp.mjs
import { readFileSync } from 'node:fs';

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
const ONLINE = JSON.stringify({ online: { MATTA: true, ANABB: true } });
stores.A.set('gamehub.adminConfig.v1', ONLINE);
stores.B.set('gamehub.adminConfig.v1', ONLINE);

const MP = await import('./archery/js/mp.js');
const { windFor } = await import('./archery/js/engine.js');

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
MP.__setBootForTest(async () => ({ db: {}, api }), { allowDev: true });

const arrow = (by, x = 0, y = 0) => ({ by, x, y });
const three = (by, x = 0, y = 0) => [arrow(by, x, y), arrow(by, x, y), arrow(by, x, y)];

// --- a whole challenge, both phones ----------------------------------------------------------------
use('A');
let res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
ok('the challenger can create a match', res.ok, JSON.stringify(res));
const id = res.id;
ok('created: only the challenger has a row until the first round is over',
  !!getAt(`archery/index/MATTA/${id}`) && !getAt(`archery/index/ANABB/${id}`));
ok('the wind comes from the match id, the same on both phones', JSON.stringify(windFor(MP.seedOf(id), 0)) === JSON.stringify(windFor(MP.seedOf(id), 0)));
res = await MP.appendLog(id, 0, [arrow('a', 0, 0)]);
ok('an arrow lands and is verified', res.ok && res.game.log.length === 1 && res.game.scores.a === 10);
ok('mid-round: still no row for Ana', !getAt(`archery/index/ANABB/${id}`));
res = await MP.appendLog(id, 1, [arrow('a', 0.35, 0), arrow('a', 0.95, 0)]);
ok('three arrows: the turn passes to Ana', res.ok && res.game.turn === 'b' && res.game.scores.a === 18);
const anaRow = getAt(`archery/index/ANABB/${id}`);
ok('the challenge reaches Ana as HER turn, written by the other side',
  anaRow && anaRow.yourTurn === true && anaRow.lastBy === 'them' && anaRow.name === 'Matt' && anaRow.theirs === 18 && anaRow.round === 1);
ok('a retry of arrows already there writes nothing twice', (await MP.appendLog(id, 1, [arrow('a', 0.35, 0), arrow('a', 0.95, 0)])).ok && Object.keys(getAt(`archery/games/${id}/log`)).length === 3);
ok('Matt cannot shoot on Ana\'s turn', !(await MP.appendLog(id, 3, [arrow('a')])).ok);
ok('the receiver has not answered: it is open', MP.lifeOf(res.game).open && MP.lifeOf(res.game).waiting);

use('B');
let g = await MP.readGame(id);
ok('Ana reads the match, and it is her turn', g && MP.isMyTurn(g, 'ANABB'));
ok('the arrows to show her start at Matt\'s round', MP.lastRunStart(g, 'a') === 0);
ok('a stale base is a conflict, never an overwrite', (await MP.appendLog(id, 1, [arrow('b')])).reason === 'moved-on');
res = await MP.appendLog(id, 3, [arrow('b', 0.15, 0)]);
ok('Ana\'s first arrow answers the challenge', res.ok && !MP.lifeOf(res.game).open && getAt(`archery/index/MATTA/${id}`).open === '');
res = await MP.appendLog(id, 4, [arrow('b', 0, 3), arrow('b', 0.15, 0)]);
ok('round 1 over: round 2 starts with the CHALLENGER again', res.ok && res.game.turn === 'a' && res.game.stage === 1 && res.game.scores.b === 18);
ok('Matt\'s row says round 2 and his turn', getAt(`archery/index/MATTA/${id}`).yourTurn === true && getAt(`archery/index/MATTA/${id}`).round === 2);

// Rounds 2 and 3: Matt 30 + 30, Ana 27 + 27 -> Matt wins 78 to 72.
use('A'); res = await MP.appendLog(id, 6, three('a'));
use('B'); res = await MP.appendLog(id, 9, three('b', 0.15, 0));
use('A'); res = await MP.appendLog(id, 12, three('a'));
ok('round 3: Matt has shot, Ana to finish', res.ok && res.game.turn === 'b' && res.game.stage === 2);
use('B'); res = await MP.appendLog(id, 15, three('b', 0.15, 0));
ok('Ana\'s last arrow ends it: Matt wins on points', res.ok && res.game.over && res.game.over.winner === 'a' && res.game.over.why === 'points');
ok('both rows are finished, with the result each way round',
  getAt(`archery/index/MATTA/${id}`).result === 'won' && getAt(`archery/index/ANABB/${id}`).result === 'lost'
  && getAt(`archery/index/MATTA/${id}`).lastBy === 'them');
ok('no arrow after the end', !(await MP.appendLog(id, 18, [arrow('b')])).ok);

// Counting once per phone.
use('A');
let rows = await MP.readMyGames();
ok('Matt\'s list shows the finished match', rows.length === 1 && rows[0].over && rows[0].result === 'won' && rows[0].mine === 78);
ok('it is counted once', MP.recordFinished(rows) === 1 && MP.recordFinished(rows) === 0);
const recs = MP.recordsFrom(rows, 'MATTA');
ok('records: one win against Ana', recs.opponents.length === 1 && recs.opponents[0].won === 1 && recs.opponents[0].lost === 0);

// --- a tie goes to a shoot-off ---------------------------------------------------------------------
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const t2 = res.id;
let base = 0;
const go = async (who, list) => { use(who === 'a' ? 'A' : 'B'); const r = await MP.appendLog(t2, base, list); base += list.length; return r; };
for (let r = 0; r < 3; r++) { await go('a', three('a', 0.25, 0)); res = await go('b', three('b', 0.25, 0)); }
ok('level after 3 rounds: not over, a shoot-off with the challenger first', res.ok && !res.game.over && res.game.stage === 3 && res.game.turn === 'a');
use('B');
ok('Ana\'s row says round 4 (a shoot-off) once it is her turn', getAt(`archery/index/MATTA/${t2}`).round === 4);
await go('a', [arrow('a', 0.05, 0)]);
res = await go('b', [arrow('b', 0.08, 0)]);
ok('same score, Matt\'s arrow closer to the middle: Matt wins the shoot-off', res.ok && res.game.over && res.game.over.winner === 'a' && res.game.over.why === 'shootoff');

// --- whole-document rejection ----------------------------------------------------------------------
const raw = clone(getAt(`archery/games/${id}`));
ok('the stored match validates', !!MP.validateGame(raw));
const twice = clone(raw); twice.log['0003'] = { by: 'a', x: 0, y: 0 };
ok('an arrow out of turn refuses the whole match', MP.validateGame(twice) === null);
const lie = clone(raw); lie.over = { winner: 'b', why: 'points' };
ok('a result the arrows never produced is refused', MP.validateGame(lie) === null);
const junk = clone(raw); junk.log['0002'] = { by: 'a', x: 'x', y: 0 };
ok('a malformed arrow is refused', MP.validateGame(junk) === null);

// --- cancel, decline, resign, expire --------------------------------------------------------------
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const c1 = res.id;
await MP.appendLog(c1, 0, three('a'));
res = await MP.cancelGame(c1);
ok('the sender can cancel before Ana shoots: it counts for nobody', res.ok && res.cancelled && getAt(`archery/games/${c1}/over/why`) === 'cancelled');
ok('a called-off row is stored over:false with ended', getAt(`archery/index/ANABB/${c1}`).over === false && getAt(`archery/index/ANABB/${c1}`).ended === 'cancelled');
rows = await MP.readMyGames();
ok('...and reads back as finished with no result', rows.find((r) => r.id === c1).over && rows.find((r) => r.id === c1).result === null);

res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const c2 = res.id;
await MP.appendLog(c2, 0, three('a'));
use('B');
res = await MP.resignGame(c2);
ok('Ana "resigning" an unanswered challenge declines it instead', res.ok && res.cancelled && getAt(`archery/games/${c2}/over/why`) === 'declined');

use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const c3 = res.id;
await MP.appendLog(c3, 0, three('a'));
use('B'); await MP.appendLog(c3, 3, [arrow('b')]);
use('A');
res = await MP.resignGame(c3);
ok('once answered, resigning hands the other person the win', res.ok && !res.cancelled && getAt(`archery/games/${c3}/over/winner`) === 'b' && getAt(`archery/games/${c3}/over/why`) === 'resign');

res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const c4 = res.id;
res = await MP.appendLog(c4, 0, three('a'));
const later = res.game.updated + 3 * 86400000 + 1000;
ok('a challenge left unanswered for 3 days expires', MP.lifeOf(res.game, later).expired);
setAt(`archery/games/${c4}/updated`, Date.now() - 4 * 86400000);
use('B');
ok('a late arrow is refused', (await MP.appendLog(c4, 3, [arrow('b')])).reason === 'expired');

// --- the outbox keeps an arrow shot with no signal ----------------------------------------------------
use('A');
MP.savePending('abcdef123', 2, [arrow('a')]);
ok('an unsent arrow is kept', MP.pendingFor('abcdef123') && MP.outboxCount() === 1);
MP.savePending('abcdef123', 3, []);
ok('...and cleared once sent', MP.outboxCount() === 0);

// --- structural ------------------------------------------------------------------------------------
const rules = JSON.parse(readFileSync(new URL('./database.rules.json', import.meta.url), 'utf8'));
ok('archery is a branch in database.rules.json', !!(rules.rules && rules.rules.archery));
ok('archery is in the backup list', /'archery',/.test(readFileSync(new URL('./backups/rtdb-backup.mjs', import.meta.url), 'utf8')));
ok('the not-allowed opponent is refused', (await MP.createGame({ them: { code: 'ZZZZZ', name: 'Nobody' } })).reason === 'them-not-approved');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
