// test-flicksoccer-mp.mjs - Flick Soccer challenges (flick-soccer/js/mp.js), headless.
//
// The PURE halves (validation by replay, records) and the WRITE path end to end, against an
// in-memory database handed in through mp.js's test seam, with two profiles taking turns on one
// "server". Also structural: `flicksoccer` is in database.rules.json and the backup list, and the
// physics path uses nothing an iPhone and an Android phone could compute differently.
//   node test-flicksoccer-mp.mjs
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
const sess = new Map();
globalThis.sessionStorage = { getItem: (k) => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => sess.set(k, String(v)), removeItem: (k) => sess.delete(k) };
stores.A.set('gamehub.profile', JSON.stringify({ name: 'Matt', emoji: '🐙', playerId: 'MATTA' }));
stores.B.set('gamehub.profile', JSON.stringify({ name: 'Ana', emoji: '🦊', playerId: 'ANABB' }));
// Both test players are allowed to play online (js/online-gate.js, 2026-10-08).
const ONLINE = JSON.stringify({ online: { MATTA: true, ANABB: true } });
stores.A.set('gamehub.adminConfig.v1', ONLINE);
stores.B.set('gamehub.adminConfig.v1', ONLINE);

const MP = await import('./flick-soccer/js/mp.js');
const E = await import('./flick-soccer/js/engine.js');
const { plan, rngFrom } = await import('./flick-soccer/js/ai.js');
const AL = await import('./flick-soccer/js/alert.js');

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

/** A flick, as stored: the computer's choice for `side` from the current position, rounded. */
const rng = rngFrom(42);
function shotFor(game, side, diff = 'hard') {
  const m = MP.buildMatch(game);
  const seat = side === 'a' ? 0 : 1;
  const s = plan(m.b, seat, diff, rng);
  const r = MP.roundShot(s.i - 1 - seat * E.DISCS, s.dx, s.dy, s.power);
  return { by: side, ...r };
}
const straight = (side, k = 3) => ({ by: side, ...MP.roundShot(k, 0, side === 'a' ? -1 : 1, 0.3) });

// --- the stored shot ------------------------------------------------------------------------------
{
  const r = MP.roundShot(2, 3, 4, 0.123456);
  ok('a flick is stored as a unit vector to 6 places and a strength to 4', r.dx === 0.6 && r.dy === 0.8 && r.p === 0.1235 && r.k === 2);
  ok('no direction or no strength is not a flick', MP.roundShot(0, 0, 0, 1) === null && MP.roundShot(0, 1, 0, 0) === null);
  ok('a malformed entry is refused', MP.cleanEntry({ by: 'a', k: 7, dx: 1, dy: 0, p: 1 }) === null
    && MP.cleanEntry({ by: 'c', k: 0, dx: 1, dy: 0, p: 1 }) === null && MP.cleanEntry({ by: 'a', k: 0, dx: 0.1, dy: 0.1, p: 1 }) === null);
}

// --- a whole challenge, both phones ----------------------------------------------------------------
use('A');
let res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, goals: 1 });
ok('the challenger can create a match', res.ok, JSON.stringify(res));
const id = res.id;
ok('created: only the challenger has a row until the first turn is over',
  !!getAt(`flicksoccer/index/MATTA/${id}`) && !getAt(`flicksoccer/index/ANABB/${id}`));
ok('a match carries its goal target', res.game.goals === 1);
res = await MP.appendLog(id, 0, [straight('a')]);
ok('a flick lands, is verified, and the turn passes to Ana', res.ok && res.game.log.length === 1 && res.game.turn === 'b');
const anaRow = getAt(`flicksoccer/index/ANABB/${id}`);
ok('the challenge reaches Ana as HER turn, written by the other side',
  anaRow && anaRow.yourTurn === true && anaRow.lastBy === 'them' && anaRow.name === 'Matt' && anaRow.goals === 1);
ok('Matt\'s own row says it was his write', getAt(`flicksoccer/index/MATTA/${id}`).lastBy === 'me' && getAt(`flicksoccer/index/MATTA/${id}`).yourTurn === false);
ok('a retry of a flick already there writes nothing twice', (await MP.appendLog(id, 0, [straight('a')])).ok && Object.keys(getAt(`flicksoccer/games/${id}/log`)).length === 1);
ok('Matt cannot flick on Ana\'s turn', !(await MP.appendLog(id, 1, [straight('a')])).ok);

use('B');
let g = await MP.readGame(id);
ok('Ana reads the match, and it is her turn', g && MP.isMyTurn(g, 'ANABB'));
ok('the flick to show her starts where Matt\'s run starts', MP.lastRunStart(g, 'a') === 0);
ok('a stale base is a conflict, never an overwrite', (await MP.appendLog(id, 0, [straight('b')])).reason === 'moved-on');

// A log that does not replay is refused whole.
const bad = clone(getAt(`flicksoccer/games/${id}`));
bad.log['0000'].by = 'b';
ok('a flick out of turn makes the whole match invalid', MP.validateGame(bad) === null);
const bad2 = clone(getAt(`flicksoccer/games/${id}`));
bad2.over = { winner: 'a', why: 'goals', at: 1 };
ok('a claimed win the flicks never produced is refused', MP.validateGame(bad2) === null);

// Play it out: the computer's shots for both, to the first goal (target 1).
let guard = 0;
g = await MP.readGame(id);
while (!g.over && guard++ < 200) {
  const side = g.turn;
  use(side === 'a' ? 'A' : 'B');
  res = await MP.appendLog(id, g.log.length, [shotFor(g, side)]);
  if (!res.ok) { ok('every turn is accepted', false, JSON.stringify(res)); break; }
  g = res.game;
}
ok('the match is won on the first goal', g.over && g.over.why === 'goals' && (g.scores.a === 1 || g.scores.b === 1), JSON.stringify(g.over));
const W = g.over.winner, L = W === 'a' ? 'b' : 'a';
const codeOf = { a: 'MATTA', b: 'ANABB' };
ok('both rows say it is over, with the right result', getAt(`flicksoccer/index/${codeOf[W]}/${id}`).result === 'won' && getAt(`flicksoccer/index/${codeOf[L]}/${id}`).result === 'lost');
ok('no more flicks after it is over', (await MP.appendLog(id, g.log.length, [straight(g.turn || 'a')])).ok === false);
// Replay agreement: both "phones" build the same final pitch from the log.
use('A'); const ga = await MP.readGame(id);
use('B'); const gb = await MP.readGame(id);
ok('both phones replay the log to the same pitch, bit for bit',
  JSON.stringify(MP.buildMatch(ga).b) === JSON.stringify(MP.buildMatch(gb).b) && JSON.stringify(ga.scores) === JSON.stringify(gb.scores));
console.log(`     (a 1-goal match took ${g.log.length} flicks)`);

// Counting once per phone.
use(L === 'a' ? 'A' : 'B');
const rowsL = await MP.readMyGames();
ok('the loser\'s list has the finished match', rowsL.length === 1 && rowsL[0].over && rowsL[0].result === 'lost');
ok('a finished match is counted on their phone once', MP.recordFinished(rowsL) === 1 && MP.recordFinished(rowsL) === 0);
const stL = JSON.parse(stores[L === 'a' ? 'A' : 'B'].get('gamehub.stats') || '{}');
ok('...as an mp loss in their stats', stL.games && stL.games.flicksoccer && stL.games.flicksoccer.byDiff.mp.lost === 1, JSON.stringify(stL.games && stL.games.flicksoccer));
ok('...and queued for their Game Over popup', MP.readUnseen().includes(id));

// Own goal: a goal counts for whoever's goal it went in.
{
  const m = E.newMatch(2, 0);
  // Clear a lane and knock the ball into seat 0's OWN goal (the bottom one).
  for (let i = 1; i < m.b.length; i++) if (i !== 1) m.b[i].x = (i % 2) ? 6 : 94;
  m.b[E.BALL].x = 50; m.b[E.BALL].y = 140;
  m.b[1].x = 50; m.b[1].y = 120;
  const e = { by: 'a', k: 0, dx: 0, dy: 1, p: 1 };
  const ev = MP.applyEntry(m, e);
  ok('an own goal counts for the other side, and the side that let it in kicks off', ev === 'goal' && m.scores[1] === 1 && m.turn === 0, `${ev} ${m.scores} turn ${m.turn}`);
}

// Resign.
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const id2 = res.id;
await MP.appendLog(id2, 0, [straight('a')]);
use('B');
res = await MP.resignGame(id2);
ok('resigning hands the other person the win', res.ok && res.game.over.winner === 'a' && res.game.over.why === 'resign');
ok('...and both rows record it', getAt(`flicksoccer/index/MATTA/${id2}`).result === 'won' && getAt(`flicksoccer/index/MATTA/${id2}`).why === 'resign');

// A challenge resigned before delivery does not reach the other person.
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const id3 = res.id;
await MP.resignGame(id3);
ok('a never-delivered challenge, given up, writes no row for the other person', !getAt(`flicksoccer/index/ANABB/${id3}`));
ok('a made-up goal target is refused', (await MP.createGame({ them: { code: 'ANABB', name: 'Ana' }, goals: 7 })).reason === 'bad-goals');
ok('a match with no goal target reads as 2', MP.validateGame({ a: { code: 'MATTA' }, b: { code: 'ANABB' } }).goals === 2);

// Records.
const rec = MP.recordsFrom(await MP.readMyGames(), 'MATTA');
ok('records: one opponent, per code', rec.opponents.length === 1 && rec.opponents[0].played === rec.finished.length, JSON.stringify(rec.opponents));

// The outbox keeps flicks until the server has them.
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
MP.savePending(res.id, 0, [straight('a')]);
ok('a pending flick is kept on the phone', !!MP.pendingFor(res.id));
ok('...and sent by the drain', (await MP.drainOutbox(res.id)) === 1 && !MP.pendingFor(res.id) && (await MP.readGame(res.id)).log.length === 1);

// The launcher bubble says "Your turn" for as long as it IS your turn.
{
  const pause = () => new Promise((r) => setTimeout(r, 3));
  use('A');
  let r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const gid = r.id;
  const one = async () => AL.decideAlert((await MP.readMyGames()).filter((x) => x.id === gid), MP.readSeen(), MP.readUnseen());
  await pause(); await MP.appendLog(gid, 0, [straight('a')]);
  ok('after your own turn: no bubble on your launcher', !(await one()));
  use('B');
  ok('the challenge arrives as a challenge', (await one() || {}).kind === 'challenge');
  await pause(); await MP.appendLog(gid, 1, [straight('b')]);
  use('A');
  ok('they played back: "Your turn"', (await one() || {}).kind === 'turn');
  AL.markSeen(gid, (await MP.readMyGames()).find((x) => x.id === gid).updated);
  ok('the X puts it away for this turn', !(await one()));
}

// The hub's Challenges handoff.
{
  AL.armOpen('match123');
  ok('armOpen hands over the match id', (AL.takeOpen() || {}).id === 'match123' && AL.takeOpen() === null);
}

// Structural.
const rules = JSON.parse(readFileSync('./database.rules.json', 'utf8'));
ok('`flicksoccer` is in database.rules.json, signed-in read and write', rules.rules.flicksoccer && rules.rules.flicksoccer['.read'] === 'auth != null' && rules.rules.flicksoccer['.write'] === 'auth != null');
ok('`flicksoccer` is in the backup branch list', /\n\s*'flicksoccer',/.test(readFileSync('./backups/rtdb-backup.mjs', 'utf8')));
// Cross-device determinism: the physics path may only use operations IEEE 754 rounds exactly.
const engineSrc = readFileSync('./flick-soccer/js/engine.js', 'utf8').replace(/\/\/[^\n]*/g, '');
const physics = engineSrc.slice(engineSrc.indexOf('export function flick'), engineSrc.indexOf('export function discAt'));
ok('the physics path uses no Math function but sqrt/min/max/round', !/Math\.(?!sqrt|min|max|round)\w+/.test(physics), (physics.match(/Math\.(?!sqrt|min|max|round)\w+/g) || []).join(','));
ok('the challenge push is wired to the index', /ref: '\/flicksoccer\/index\/\{code\}\/\{id\}'/.test(readFileSync('./functions/index.js', 'utf8')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
