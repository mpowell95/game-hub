// test-darts-mp.mjs - Darts challenges (darts/js/mp.js), headless.
//
// The PURE halves (validation by replay, records) and the WRITE path end to end, against an
// in-memory database handed in through mp.js's test seam, with two profiles taking turns on one
// "server". Also structural: `darts` is in database.rules.json and the backup list.
//   node test-darts-mp.mjs
import { readFileSync } from 'node:fs';

// --- a browser-ish global: localStorage, one per "phone" ---------------------------------------
const stores = { A: new Map(), B: new Map(), C: new Map() };
let phone = 'A';
globalThis.localStorage = {
  getItem: (k) => (stores[phone].has(k) ? stores[phone].get(k) : null),
  setItem: (k, v) => stores[phone].set(k, String(v)),
  removeItem: (k) => stores[phone].delete(k),
};
const use = (p) => { phone = p; };
stores.A.set('gamehub.profile', JSON.stringify({ name: 'Matt', emoji: '🐙', playerId: 'MATTA' }));
stores.B.set('gamehub.profile', JSON.stringify({ name: 'Ana', emoji: '🦊', playerId: 'ANABB' }));
// Both test players are allowed to play online (js/online-gate.js, 2026-10-08); a made-up code is not.
const ONLINE = JSON.stringify({ online: { MATTA: true, ANABB: true } });
stores.A.set('gamehub.adminConfig.v1', ONLINE);
stores.B.set('gamehub.adminConfig.v1', ONLINE);

const MP = await import('./darts/js/mp.js');
const { targetPoint } = await import('./darts/js/engine.js');

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

const T20 = targetPoint(20, 'treble');
const dart = (by, p = T20) => ({ by, x: p.x, y: p.y });

// --- a whole challenge, both phones ----------------------------------------------------------------
use('A');
let res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
ok('the challenger can create a match', res.ok, JSON.stringify(res));
const id = res.id;
ok('created: only the challenger has a row until the first turn is over',
  !!getAt(`darts/index/MATTA/${id}`) && !getAt(`darts/index/ANABB/${id}`));
res = await MP.appendLog(id, 0, [dart('a')]);
ok('a dart lands and is verified', res.ok && res.game.log.length === 1 && res.game.scores.a === 241);
ok('mid-turn: still no row for the other person', !getAt(`darts/index/ANABB/${id}`));
res = await MP.appendLog(id, 1, [dart('a'), dart('a')]);
ok('three darts: the turn passes to Ana', res.ok && res.game.turn === 'b' && res.game.scores.a === 121);
const anaRow = getAt(`darts/index/ANABB/${id}`);
ok('the challenge reaches Ana as HER turn, written by the other side',
  anaRow && anaRow.yourTurn === true && anaRow.lastBy === 'them' && anaRow.name === 'Matt' && anaRow.mine === 301 && anaRow.theirs === 121);
ok('Matt\'s own row says it was his write', getAt(`darts/index/MATTA/${id}`).lastBy === 'me' && getAt(`darts/index/MATTA/${id}`).yourTurn === false);
ok('a retry of darts already there writes nothing twice', (await MP.appendLog(id, 1, [dart('a'), dart('a')])).ok && Object.keys(getAt(`darts/games/${id}/log`)).length === 3);
ok('Matt cannot throw on Ana\'s turn', !(await MP.appendLog(id, 3, [dart('a')])).ok);

use('B');
let g = await MP.readGame(id);
ok('Ana reads the match, and it is her turn', g && MP.isMyTurn(g, 'ANABB'));
ok('the darts to show her start where Matt\'s run starts', MP.lastRunStart(g, 'a') === 0);
ok('a stale base is a conflict, never an overwrite', (await MP.appendLog(id, 1, [dart('b')])).reason === 'moved-on');
res = await MP.appendLog(id, 3, [dart('b', { x: 0, y: 0 }), dart('b', { x: 0, y: -2 }), dart('b', { x: 0, y: 0 })]);
ok('Ana: bull, a miss off the board, bull. Turn back to Matt', res.ok && res.game.turn === 'a' && res.game.scores.b === 201);

// Bust: Matt at 121 throws T20 (61 left), T20 (1 left), T20 (-59 bust) -> back to 121.
use('A');
res = await MP.appendLog(id, 6, [dart('a'), dart('a'), dart('a')]);
ok('a bust puts Matt back to where his turn started, and passes the turn', res.ok && res.game.scores.a === 121 && res.game.turn === 'b');

// A log that does not replay is refused whole.
const bad = clone(getAt(`darts/games/${id}`));
bad.log['0003'].by = 'a';
ok('a dart thrown out of turn makes the whole match invalid', MP.validateGame(bad) === null);
const bad2 = clone(getAt(`darts/games/${id}`));
bad2.over = { winner: 'a', why: 'zero', at: 1 };
ok('a claimed win the darts never produced is refused', MP.validateGame(bad2) === null);

// Finish: Ana at 201 needs 201. Simulate darts until somebody wins, Matt at 121.
use('B');
g = await MP.readGame(id);
// Ana: T20 T20 T20 -> 21 left.
res = await MP.appendLog(id, g.log.length, [dart('b'), dart('b'), dart('b')]);
use('A');
// Matt: T20 (61), T20 (1), single 1 (0) -> wins.
const S1 = targetPoint(1, 'single');
res = await MP.appendLog(id, res.game.log.length, [dart('a'), dart('a'), dart('a', S1)]);
// Equal turns (2026-10-08): Matt threw first, so his finish gives Ana one last turn.
ok('equal turns: the match is made with eq', MP.validateGame(getAt(`darts/games/${id}`)).eq === true);
ok('equal turns: Matt is out, Ana gets one last turn', res.ok && !res.game.over && res.game.turn === 'b' && res.game.scores.a === 0
  && getAt(`darts/index/ANABB/${id}`).yourTurn === true);
use('B');
const OFF = { x: 0, y: -2 };
res = await MP.appendLog(id, res.game.log.length, [dart('b', OFF), dart('b', OFF), dart('b', OFF)]);
ok('her last turn ends without a finish: Matt wins', res.ok && res.game.over && res.game.over.winner === 'a' && res.game.over.why === 'zero', JSON.stringify(res.game && res.game.over));
ok('both rows say it is over, with the right result', getAt(`darts/index/MATTA/${id}`).result === 'won' && getAt(`darts/index/ANABB/${id}`).result === 'lost');
ok('no more darts after it is over', (await MP.appendLog(id, res.game.log.length, [dart('b')])).ok === false);

// Counting once per phone.
use('B');
const rowsB = await MP.readMyGames();
ok('Ana\'s list has the finished match', rowsB.length === 1 && rowsB[0].over && rowsB[0].result === 'lost');
ok('a finished match is counted on her phone once', MP.recordFinished(rowsB) === 1 && MP.recordFinished(rowsB) === 0);
const stB = JSON.parse(stores.B.get('gamehub.stats') || '{}');
ok('...as an mp loss in her stats', stB.games && stB.games.darts && stB.games.darts.byDiff.mp.lost === 1, JSON.stringify(stB.games && stB.games.darts));
ok('...and queued for her Game Over popup', MP.readUnseen().includes(id));

// Resign.
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const id2 = res.id;
await MP.appendLog(id2, 0, [dart('a'), dart('a'), dart('a')]);
use('B');
res = await MP.resignGame(id2);
ok('resigning hands the other person the win', res.ok && res.game.over.winner === 'a' && res.game.over.why === 'resign');
ok('...and both rows record it', getAt(`darts/index/MATTA/${id2}`).result === 'won' && getAt(`darts/index/MATTA/${id2}`).why === 'resign');

// A challenge resigned before delivery does not reach the other person.
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const id3 = res.id;
await MP.resignGame(id3);
ok('a never-delivered challenge, given up, writes no row for the other person', !getAt(`darts/index/ANABB/${id3}`));

// Records.
const rec = MP.recordsFrom(await MP.readMyGames(), 'MATTA');
ok('records: one opponent, wins and losses per code', rec.opponents.length === 1 && rec.opponents[0].won === 2 && rec.opponents[0].lost === 1, JSON.stringify(rec.opponents));

// The outbox keeps darts until the server has them.
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
MP.savePending(res.id, 0, [dart('a')]);
ok('a pending dart is kept on the phone', !!MP.pendingFor(res.id));
ok('...and sent by the drain', (await MP.drainOutbox(res.id)) === 1 && !MP.pendingFor(res.id) && (await MP.readGame(res.id)).log.length === 1);

// Other games (2026-10-01): the challenger picks 201, 101 or Cricket; the match carries `kind`.
use('A');
ok('a match made before games had a kind is read as 301',
  MP.validateGame({ a: { code: 'MATTA' }, b: { code: 'ANABB' }, log: { '0000': dart('a') } }).scores.a === 241);
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, kind: '101' });
ok('a 101 challenge starts on 101', res.ok && res.game.kind === '101' && res.game.scores.a === 101);
res = await MP.appendLog(res.id, 0, [dart('a')]);
ok('101: T20 leaves 41', res.ok && res.game.scores.a === 41);
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, kind: 'cricket-np' });
const npid = res.id;
res = await MP.appendLog(npid, 0, [dart('a'), dart('a'), dart('a')]);
ok('a no-points cricket challenge replays with no points (T20 x3 scores 0)', res.ok && res.game.kind === 'cricket-np' && res.game.scores.a === 0 && res.game.closed.a === 1);
ok('a made-up game is refused', (await MP.createGame({ them: { code: 'ANABB', name: 'Ana' }, kind: '999' })).reason === 'bad-kind');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, kind: 'cricket-order' });
const cid = res.id;
ok('a cricket (in order) challenge starts at 0 points', res.ok && res.game.kind === 'cricket-order' && res.game.scores.a === 0);
const T19 = targetPoint(19, 'treble');
res = await MP.appendLog(cid, 0, [dart('a'), dart('a'), dart('a', T19)]);
ok('in order: T20 closes 20, T20 scores 60, T19 counts', res.ok && res.game.scores.a === 60 && res.game.turn === 'b');
const crow = getAt(`darts/index/ANABB/${cid}`);
ok('the other person\'s row says which game it is', crow && crow.kind === 'cricket-order' && crow.theirs === 60);
ok('...and how many numbers each side has closed (T20 closed 20; T19 counts 3 marks on 19)', crow.theirsClosed === 2 && crow.mineClosed === 0, JSON.stringify(crow));
// A whole cricket game to the end, replayed by validateGame on every write.
use('B');
const bulls = targetPoint(25, 'bull');
const T = (n) => targetPoint(n, 'treble');
let base = 3;
const turn = async (side, pts) => { use(side === 'a' ? 'A' : 'B'); const r = await MP.appendLog(cid, base, pts.map((p) => dart(side, p))); base += pts.length; return r; };
await turn('b', [{ x: 0, y: -2 }, { x: 0, y: -2 }, { x: 0, y: -2 }]);
await turn('a', [T(18), T(17), T(16)]);
await turn('b', [{ x: 0, y: -2 }, { x: 0, y: -2 }, { x: 0, y: -2 }]);
res = await turn('a', [T(15), bulls, bulls]);
ok('cricket, equal turns: closing everything while ahead gives the other side a last turn', res.ok && !res.game.over && res.game.turn === 'b');
res = await turn('b', [{ x: 0, y: -2 }, { x: 0, y: -2 }, { x: 0, y: -2 }]);
ok('...which misses: the cricket match is won', res.ok && res.game.over && res.game.over.winner === 'a' && res.game.over.why === 'closed', JSON.stringify(res.game && res.game.over));

// Equal turns: a DRAW, the second player winning outright, and an old match on the old rules.
{
  const D20 = targetPoint(20, 'double');
  use('A');
  let r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, kind: '101' });
  const did = r.id;
  r = await MP.appendLog(did, 0, [dart('a'), dart('a', targetPoint(1, 'single')), dart('a', D20)]);
  ok('101: T20, 1, D20 is out on the first turn', r.ok && !r.game.over && r.game.turn === 'b');
  use('B');
  r = await MP.appendLog(did, 3, [dart('b'), dart('b', targetPoint(1, 'single')), dart('b', D20)]);
  ok('both out in the same round: a draw', r.ok && r.game.over && r.game.over.winner === 'draw' && r.game.over.why === 'tie', JSON.stringify(r.game && r.game.over));
  ok('...both rows say draw', getAt(`darts/index/MATTA/${did}`).result === 'draw' && getAt(`darts/index/ANABB/${did}`).result === 'draw');
  const rows = (await MP.readMyGames()).filter((x) => x.id === did);
  ok('...counted on her phone as a draw (played, neither won nor lost)', MP.recordFinished(rows) === 1);
  const st = JSON.parse(stores.B.get('gamehub.stats')).games.darts.byDiff.mp;
  ok('...in her stats', st.played === 2 && st.lost === 1 && st.won === 0, JSON.stringify(st));
  const rd = MP.recordsFrom(await MP.readMyGames(), 'ANABB').opponents[0];
  ok('...and in the records', rd.draw === 1, JSON.stringify(rd));
  ok('a claimed draw the darts never produced is refused', MP.validateGame({ ...clone(getAt(`darts/games/${did}`)), log: { '0000': dart('a') } }) === null);
  ok('a resignation cannot claim a draw', MP.validateGame({ ...clone(getAt(`darts/games/${did}`)), over: { winner: 'draw', why: 'resign', at: 1 } }) === null);

  use('A');
  r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, kind: '101' });
  const sid = r.id;
  await MP.appendLog(sid, 0, [dart('a', OFF), dart('a', OFF), dart('a', OFF)]);
  use('B');
  r = await MP.appendLog(sid, 3, [dart('b'), dart('b', targetPoint(1, 'single')), dart('b', D20)]);
  ok('the SECOND player finishing first wins at once', r.ok && r.game.over && r.game.over.winner === 'b');

  const old = { a: { code: 'MATTA' }, b: { code: 'ANABB' }, kind: '101',
    log: { '0000': dart('a'), '0001': dart('a', targetPoint(1, 'single')), '0002': dart('a', D20) } };
  const og = MP.validateGame(old);
  ok('a match made before equal turns (no eq) still ends on the first finish', og && og.over && og.over.winner === 'a' && !og.eq);
}

// A VOIDED match (js/stats-corrections.js, 2026-10-08): left out of every list, never counted, and
// taken back out of the stats of a phone that had already counted it.
{
  const VID = 'muzgz01qh0z10nqo';
  const SC = await import('./js/stats-corrections.js');
  ok('the 101 King of Games won is voided', SC.isVoidedMatch('darts', VID) && SC.voidedResultFor('darts', VID, 'QZCC4') === 'lost' && SC.voidedResultFor('darts', VID, '3VN33') === 'won');
  stores.C.set('gamehub.profile', JSON.stringify({ name: 'MattyIce', emoji: '🐙', playerId: 'QZCC4' }));
  use('C');
  setAt(`darts/index/QZCC4/${VID}`, { with: '3VN33', name: 'King', emoji: '👑', updated: 5, yourTurn: false, over: true, result: 'lost', why: 'zero', kind: '101' });
  setAt('darts/index/QZCC4/aaaaaaaaaaaa', { with: '3VN33', name: 'King', emoji: '👑', updated: 4, yourTurn: false, over: true, result: 'won', why: 'zero', kind: '301' });
  // This phone had counted it before the void: a loss in the store and the id in the ledger.
  const { recordResult } = await import('./js/game-stats.js');
  recordResult('darts', 'mp', false);
  stores.C.set(MP.LEDGER_KEY, JSON.stringify([VID]));
  const rowsC = await MP.readMyGames();
  ok('the voided match is in no list', rowsC.length === 1 && rowsC[0].id === 'aaaaaaaaaaaa');
  ok('...and not in the records', MP.recordsFrom(rowsC, 'QZCC4').opponents[0].lost === 0);
  ok('the other finished match is still counted', MP.recordFinished(rowsC) === 1);
  ok('countResult refuses the voided match', MP.countResult(VID, false) === false);
  const raw = JSON.parse(stores.C.get('gamehub.stats'));
  ok('the raw store keeps every counter (nothing subtracted on the phone)', raw.games.darts.byDiff.mp.lost === 1 && raw.games.darts.byDiff.mp.won === 1);
  ok('...and notes the voided loss', raw.games.darts.vd && raw.games.darts.vd[VID] === 'lost', JSON.stringify(raw.games.darts.vd));
  const shown = SC.correctStats(raw, 'dev', {}).games.darts;
  ok('shown: the voided loss is gone, the real win stays', shown.byDiff.mp.lost === 0 && shown.byDiff.mp.won === 1 && shown.byDiff.mp.played === 1
    && shown.total.lost === 0 && shown.total.played === 1, JSON.stringify(shown));
  ok('the input store is not mutated', raw.games.darts.byDiff.mp.lost === 1);
  MP.recordFinished(rowsC);
  ok('noting is idempotent', Object.keys(JSON.parse(stores.C.get('gamehub.stats')).games.darts.vd).length === 1);
}

// The launcher bubble (darts/js/alert.js) says "Your turn" for as long as it IS your turn (2026-10-04).
{
  const AL = await import('./darts/js/alert.js');
  const pause = () => new Promise((r) => setTimeout(r, 3));
  use('A');
  let r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const gid = r.id;
  const one = async () => AL.decideAlert((await MP.readMyGames()).filter((x) => x.id === gid), MP.readSeen(), MP.readUnseen());
  await pause(); await MP.appendLog(gid, 0, [dart('a'), dart('a'), dart('a')]);
  ok('after your own turn: no bubble on your launcher', !(await one()));
  use('B'); await pause(); await MP.appendLog(gid, 3, [dart('b'), dart('b'), dart('b')]);
  use('A');
  ok('they played back: "Your turn"', (await one() || {}).kind === 'turn');
  await pause(); await MP.appendLog(gid, 6, [dart('a')]);
  ok('one dart thrown and left mid-turn: still "Your turn"', (await one() || {}).kind === 'turn');
  await pause(); await MP.appendLog(gid, 7, [dart('a'), dart('a')]);
  ok('turn finished: the bubble goes', !(await one()));
  use('B'); await pause(); await MP.appendLog(gid, 9, [dart('b'), dart('b'), dart('b')]);
  use('A');
  const al = await one();
  AL.markSeen(gid, (await MP.readMyGames()).find((x) => x.id === gid).updated);                // the bubble's X (js/hub.js _dismissGameAlert)
  ok('the X puts it away for this turn', al && al.kind === 'turn' && !(await one()));
}

// Structural.
const rules = JSON.parse(readFileSync('./database.rules.json', 'utf8'));
ok('`darts` is in database.rules.json, signed-in read and write', rules.rules.darts && rules.rules.darts['.read'] === 'auth != null' && rules.rules.darts['.write'] === 'auth != null');
ok('`darts` is in the backup branch list', /\n\s*'darts',/.test(readFileSync('./backups/rtdb-backup.mjs', 'utf8')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
