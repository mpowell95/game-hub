// test-golf-mp.mjs - Golf challenges (golf/js/mp.js), headless (2026-11-10).
//
// The PURE halves (validation by replay, records) and the WRITE path end to end, against an
// in-memory database handed in through mp.js's test seam, with two test profiles taking turns on one
// "server". Never Matt's name or code (root CLAUDE.md, "Tests NEVER use Matt's code or name").
//   node tools/test-golf-mp.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

// --- a browser-ish global: localStorage, one per "phone" ---------------------------------------
const stores = { A: new Map(), B: new Map() };
let phone = 'A';
globalThis.localStorage = {
  getItem: (k) => (stores[phone].has(k) ? stores[phone].get(k) : null),
  setItem: (k, v) => stores[phone].set(k, String(v)),
  removeItem: (k) => stores[phone].delete(k),
};
const use = (p) => { phone = p; };
stores.A.set('gamehub.profile', JSON.stringify({ name: 'test1', emoji: '🐙', playerId: 'TESTA' }));
stores.B.set('gamehub.profile', JSON.stringify({ name: 'Tester Two', emoji: '🦊', playerId: 'TESTB' }));
const ONLINE = JSON.stringify({ online: { TESTA: true, TESTB: true } });
stores.A.set('gamehub.adminConfig.v1', ONLINE);
stores.B.set('gamehub.adminConfig.v1', ONLINE);

const MP = await import('../golf/js/mp.js');
const { ANSWER_MS, FORFEIT_MS } = await import('../js/challenge-life.js');

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

const THEM = { code: 'TESTB', name: 'Tester Two', emoji: '🦊' };
const HOLES = [{ i: 0, n: 1, par: 4, pin: 1 }, { i: 1, n: 2, par: 3, pin: -1 }, { i: 2, n: 3, par: 5, pin: 0 }];
const NEW = { them: THEM, course: 'pinevalley', round: 'quick3', holes: HOLES };
const rest = (by, h, s, x = 1, y = 100) => ({ by, h, s, x, y });
const done = (by, h, s) => ({ by, h, s, d: 1, x: 0, y: 300 });
const stats = (p) => JSON.parse(stores[p].get('gamehub.stats') || '{}');

// --- a whole challenge ---------------------------------------------------------------------------
use('A');
let res = await MP.createGame(NEW);
ok('the challenger can create a match', res.ok, JSON.stringify(res));
const id = res.id;
const doc0 = getAt(`golf/games/${id}`);
ok('the match stores the course, the round, and every hole with its cup', doc0.course === 'pinevalley' && doc0.round === 'quick3' && doc0.holes.length === 3 && doc0.holes[0].pin === 1 && doc0.holes[1].pin === -1);
ok('created: only the challenger has a row until the first hole is over', !!getAt(`golf/index/TESTA/${id}`) && !getAt(`golf/index/TESTB/${id}`));
ok('a bad round is refused before anything is written', (await MP.createGame({ ...NEW, holes: [{ i: 0, n: 1, par: 9, pin: -1 }] })).reason === 'bad-round');

res = await MP.appendLog(id, 0, [rest('a', 0, 1, 2, 210)]);
ok('a shot at rest lands and is verified', res.ok && res.game.log.length === 1 && res.game.turn === 'a');
ok('mid-hole: still no row for the other person', !getAt(`golf/index/TESTB/${id}`));
ok('mid-hole: the ball lies where the log says, strokes kept (resume)', JSON.stringify(MP.restOf(res.game, 'a')) === JSON.stringify({ x: 2, y: 210, s: 1 }));
res = await MP.appendLog(id, 1, [rest('a', 0, 3, 0, 330), done('a', 0, 4)]);
ok('hole 1 holed in 4: the turn passes to the other person, same hole', res.ok && res.game.turn === 'b' && res.game.hole === 0 && res.game.scores.a[0] === 4);
const bRow = getAt(`golf/index/TESTB/${id}`);
ok('the challenge reaches them as THEIR turn, written by the other side, naming the course and holes',
  bRow && bRow.yourTurn === true && bRow.lastBy === 'them' && bRow.name === 'test1' && bRow.course === 'pinevalley' && bRow.round === 'quick3' && bRow.holes === 3 && bRow.hole === 1);
ok('a retry of shots already there writes nothing twice', (await MP.appendLog(id, 1, [rest('a', 0, 3, 0, 330), done('a', 0, 4)])).ok && Object.keys(getAt(`golf/games/${id}/log`)).length === 3);
ok('the challenger cannot play on the other\'s turn', (await MP.appendLog(id, 3, [rest('a', 1, 1)])).reason === 'rules-refused');

use('B');
let g = await MP.readGame(id);
ok('they read the match: their turn, hole 1, the challenger\'s 4 on the card', g && MP.isMyTurn(g, 'TESTB') && g.hole === 0 && g.scores.a[0] === 4 && g.scores.b[0] === null);
ok('a stale base is a conflict, never an overwrite', (await MP.appendLog(id, 1, [rest('b', 0, 1)])).reason === 'moved-on');
ok('the wrong hole is refused', (await MP.appendLog(id, 3, [rest('b', 1, 1)])).reason === 'rules-refused');
ok('strokes that do not go up are refused', (await MP.appendLog(id, 3, [rest('b', 0, 2), rest('b', 0, 2)])).reason === 'rules-refused');
ok('a ball at rest AT the cap is refused (the hole ends there)', (await MP.appendLog(id, 3, [rest('b', 0, 9)])).reason === 'rules-refused');
ok('a score past double par plus one is refused', (await MP.appendLog(id, 3, [done('b', 0, 10)])).reason === 'rules-refused');
res = await MP.appendLog(id, 3, [rest('b', 0, 2, -5, 250)]);
ok('their first shot answers the challenge: the rows stop saying open', res.ok && getAt(`golf/index/TESTB/${id}`).open === '' && getAt(`golf/index/TESTA/${id}`).open === '');
g = await MP.readGame(id);
ok('closing the app mid-hole resumes at the last rest with its strokes', JSON.stringify(MP.restOf(g, 'b')) === JSON.stringify({ x: -5, y: 250, s: 2 }));
res = await MP.appendLog(id, 4, [done('b', 0, 3)]);
ok('they hole out in 3: back to the challenger, hole 2', res.ok && res.game.turn === 'a' && res.game.hole === 1);
const aRow = getAt(`golf/index/TESTA/${id}`);
ok('the challenger\'s row: their turn, hole 2, strokes over the holes both played', aRow.yourTurn && aRow.hole === 2 && aRow.done === 1 && aRow.mine === 4 && aRow.theirs === 3 && aRow.par === 4);

// A log that does not replay is refused whole.
const bad = clone(getAt(`golf/games/${id}`));
bad.log['0004'].by = 'a';
ok('a shot out of turn makes the whole match invalid', MP.validateGame(bad) === null);
const bad2 = clone(getAt(`golf/games/${id}`));
bad2.over = { winner: 'a', why: 'strokes', at: 1 };
ok('a claimed win the log never produced is refused', MP.validateGame(bad2) === null);
const bad3 = clone(getAt(`golf/games/${id}`));
bad3.holes[1].par = 7;
ok('a malformed hole list is refused', MP.validateGame(bad3) === null);
const bad4 = clone(getAt(`golf/games/${id}`));
bad4.log['0001'].s = 'x';
ok('a malformed entry is refused', MP.validateGame(bad4) === null);
ok('a missing course is refused', MP.validateGame({ ...clone(getAt(`golf/games/${id}`)), course: '' }) === null);
const asObj = clone(getAt(`golf/games/${id}`));
asObj.holes = { 0: asObj.holes[0], 1: asObj.holes[1], 2: asObj.holes[2] };
ok('holes handed back as an object (Firebase) still validate', !!MP.validateGame(asObj));

// Finish: test1 3 + 5 (total 12), Tester Two 4 + 6 (total 13).
use('A');
res = await MP.appendLog(id, 5, [done('a', 1, 3)]);
use('B');
res = await MP.appendLog(id, 6, [done('b', 1, 4)]);
use('A');
res = await MP.appendLog(id, 7, [rest('a', 2, 2), done('a', 2, 5)]);
ok('mid-match, never over before the other player finishes the last hole', res.ok && !res.game.over && res.game.turn === 'b');
use('B');
res = await MP.appendLog(id, 9, [done('b', 2, 6)]);
ok('fewest strokes wins: 12 beats 13', res.ok && res.game.over && res.game.over.winner === 'a' && res.game.over.why === 'strokes' && res.game.totals.a === 12 && res.game.totals.b === 13, JSON.stringify(res.game && res.game.over));
ok('both rows say it is over, with the right result and totals',
  getAt(`golf/index/TESTA/${id}`).result === 'won' && getAt(`golf/index/TESTB/${id}`).result === 'lost' && getAt(`golf/index/TESTB/${id}`).mineTotal === 13);
ok('no more shots after it is over', (await MP.appendLog(id, 10, [rest('b', 2, 7)])).ok === false);

// Counted once per phone, with its mode.
const rowsB = await MP.readMyGames();
ok('their list has the finished match', rowsB.length === 1 && rowsB[0].over && rowsB[0].result === 'lost');
ok('a finished match is counted on their phone once', MP.recordFinished(rowsB) === 1 && MP.recordFinished(rowsB) === 0);
const gB = stats('B').games && stats('B').games.golf;
ok('...as an mp loss in their stats', gB && gB.byDiff.mp.lost === 1, JSON.stringify(gB));
ok('...noted with its match id', gB && gB.mpIds && gB.mpIds[id] === 'l');
const modeKeys = Object.keys((gB && gB.byMode) || {});
ok('...recorded with its MODE: course, round, holes, who went first, online', modeKeys.some((k) => /pinevalley/.test(k) && /quick3/.test(k) && /first/.test(k) && /online/.test(k)), modeKeys.join(' | '));
ok('...and queued for the Game Over popup', MP.readUnseen().includes(id));
use('A');
ok('the challenger\'s phone counts it once too, as a win', MP.countResult(id, true, Date.now(), () => MP.modeOfGame(g, 'a')) === true && MP.countResult(id, true) === false && stats('A').games.golf.byDiff.mp.won === 1);

// A draw.
use('A');
res = await MP.createGame({ ...NEW, holes: HOLES.slice(0, 1) });
const dId = res.id;
await MP.appendLog(dId, 0, [done('a', 0, 4)]);
use('B');
res = await MP.appendLog(dId, 1, [done('b', 0, 4)]);
ok('equal strokes: a draw', res.ok && res.game.over && res.game.over.winner === 'draw' && res.game.over.why === 'tie');
ok('...both rows say draw', getAt(`golf/index/TESTA/${dId}`).result === 'draw' && getAt(`golf/index/TESTB/${dId}`).result === 'draw');
const drawB = (await MP.readMyGames()).filter((r) => r.id === dId);
MP.recordFinished(drawB);
ok('...counted as played, neither won nor lost', stats('B').games.golf.byDiff.mp.played === 2 && stats('B').games.golf.byDiff.mp.lost === 1 && stats('B').games.golf.byDiff.mp.won === 0);

// Resign.
use('A');
res = await MP.createGame(NEW);
const rId = res.id;
await MP.appendLog(rId, 0, [done('a', 0, 5)]);
use('B');
await MP.appendLog(rId, 1, [rest('b', 0, 1)]);           // answered
res = await MP.resignGame(rId);
ok('resigning hands the other person the win', res.ok && res.game.over.winner === 'a' && res.game.over.why === 'resign');
ok('...and both rows record it', getAt(`golf/index/TESTA/${rId}`).result === 'won' && getAt(`golf/index/TESTA/${rId}`).why === 'resign');

// Cancel: before the sender played, for nobody; after, a loss for whoever calls it off.
use('A');
res = await MP.createGame(NEW);
const c0 = res.id;
ok('nothing played yet: cancelling costs nothing', MP.cancelCosts(await MP.readGame(c0)) === false);
res = await MP.cancelGame(c0);
ok('cancelled before any shot: nobody wins, no row for them', res.ok && res.cancelled && res.game.over.winner === 'none' && !getAt(`golf/index/TESTB/${c0}`) && getAt(`golf/index/TESTA/${c0}`).ended === 'cancelled');
res = await MP.createGame(NEW);
const c1 = res.id;
await MP.appendLog(c1, 0, [done('a', 0, 4)]);
ok('delivered: the rows say sent / got with a 3-day deadline',
  getAt(`golf/index/TESTA/${c1}`).open === 'sent' && getAt(`golf/index/TESTB/${c1}`).open === 'got' && getAt(`golf/index/TESTB/${c1}`).expires === getAt(`golf/games/${c1}`).updated + ANSWER_MS);
res = await MP.cancelGame(c1);
ok('cancelled after the sender\'s first hole: a LOSS for the sender', res.ok && res.lost && res.game.over.winner === 'b' && res.game.over.why === 'resign' && getAt(`golf/games/${c1}`).over.via === 'cancelled');
ok('the match document is kept, log and all', Object.keys(getAt(`golf/games/${c1}/log`)).length === 1);

// Expire: 3 days unanswered.
res = await MP.createGame(NEW);
const eId = res.id;
await MP.appendLog(eId, 0, [done('a', 0, 4)]);
const eDoc = getAt(`golf/games/${eId}`);
ok('lifeOf: expired after 3 days', MP.lifeOf(await MP.readGame(eId), eDoc.updated + ANSWER_MS).expired);
const back3 = (o) => { o.updated -= ANSWER_MS + 1000; if (o.expires) o.expires -= ANSWER_MS + 1000; };
back3(eDoc); back3(getAt(`golf/index/TESTA/${eId}`)); back3(getAt(`golf/index/TESTB/${eId}`));
use('B');
const er = (await MP.readMyGames()).find((x) => x.id === eId);
ok('an unanswered challenge 3 days old reads as expired, finished, no result', er && er.ended === 'expired' && er.over && er.result === null);
ok('...and refuses a late shot', (await MP.appendLog(eId, 1, [rest('b', 0, 1)])).reason === 'expired');

// 7 days on a turn: a timeout.
{
  const ST = await import('../js/server-time.js');
  const realNow = Date.now;
  use('A');
  res = await MP.createGame(NEW);
  const tId = res.id;
  await MP.appendLog(tId, 0, [done('a', 0, 4)]);
  use('B');
  res = await MP.appendLog(tId, 1, [done('b', 0, 4)]);   // answered; test1's turn
  const turnAt = res.game.log[1].at;
  try {
    Date.now = () => Math.max(turnAt, Date.UTC(2026, 9, 29)) + FORFEIT_MS + 1000;
    use('A');
    const g2 = await MP.readGame(tId);
    ok('7 days on their turn: the player on turn loses, why timeout', g2.over && g2.over.winner === 'b' && g2.over.why === 'timeout' && g2.turn === null);
    ok('a late shot is refused', (await MP.appendLog(tId, 2, [rest('a', 1, 1)])).ok === false);
    use('B');
    const hers = (await MP.readMyGames()).find((x) => x.id === tId);
    ok('the other list: finished, won, timed out', hers.over && hers.result === 'won' && hers.why === 'timeout');
    const before = stats('B').games.golf.byDiff.mp.won | 0;
    ST.__setServerTimeForTest(0);
    MP.recordFinished([hers]); await MP.timeoutsSettled(); MP.recordFinished([hers]); await MP.timeoutsSettled();
    ok('counted once, as a win, after re-reading on live server time', stats('B').games.golf.byDiff.mp.won === before + 1);
    ST.__setServerTimeForTest(null);
  } finally { Date.now = realNow; }
}

// The shot in the air, kept on this phone only (never the solo save).
use('A');
MP.saveShot('abc123def', { h: 0, s: 2, ball: [1, 2], spec: { type: 'putt', aimRad: 0, power: 0.5, rangeFt: 60 } });
ok('a challenge shot in the air is kept under its own key, by match', MP.shotFor('abc123def').s === 2 && !stores.A.has('gamehub.golf.v1'));
MP.saveShot('abc123def', null);
ok('...and cleared once its rest is logged', MP.shotFor('abc123def') === null);
ok('the round-record ledger marks a match once', !MP.roundRecorded('m1x2y3z4') && MP.markRoundRecorded('m1x2y3z4') && MP.roundRecorded('m1x2y3z4'));

// Records.
const recs = MP.recordsFrom(await MP.readMyGames(), 'TESTA');
const o = recs.opponents[0];
ok('records: wins, losses and draws per opponent', o && o.code === 'TESTB' && o.won >= 2 && o.draw === 1, JSON.stringify(o));

// Structural.
const rules = JSON.parse(readFileSync('./database.rules.json', 'utf8'));
ok('`golf` is in database.rules.json: signed-in read, writes per match, index row and chat line, never a delete',
  rules.rules.golf && rules.rules.golf['.read'] === 'auth != null' && rules.rules.golf.games.$id['.write'] === 'auth != null && newData.exists()'
  && rules.rules.golf.index.$code.$id['.write'] === 'auth != null && newData.exists()' && rules.rules.golf.chat.$id.$k['.write'] === 'auth != null && newData.exists()'
  && /serverTimestamp|now - 120000/.test(JSON.stringify(rules.rules.golf.games.$id.log)));
ok('`golf` is in the nudges key pattern', /\|golf\)~/.test(readFileSync('./database.rules.json', 'utf8')));
ok('`golf` is in the backup branch list', /\n\s*'golf',/.test(readFileSync('./backups/rtdb-backup.mjs', 'utf8')));
const ui = readFileSync('./golf/js/ui.js', 'utf8');
ok('ui.js: a challenge never touches the solo save', /if \(this\.mp\) return this\._mpLogRest\(\);/.test(ui));
ok('ui.js: quick chat in every challenge (golf/chat)', /createMatchChat\(/.test(ui) && /const node = 'golf'/.test(ui));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
