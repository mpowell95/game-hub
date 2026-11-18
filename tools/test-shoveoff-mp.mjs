// test-shoveoff-mp.mjs - Shove Off challenges (shove-off/js/mp.js), headless (2026-11-18).
//
// The PURE halves (validation by replay, rows, records) and the WRITE path end to end, against an
// in-memory database handed in through mp.js's test seam, two test profiles on one "server". Never
// Matt's name or code (root CLAUDE.md, "Tests NEVER use Matt's code or name").
//   node tools/test-shoveoff-mp.mjs
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

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
// Both may play online, and the admin-only game is opened to both (the gate asks codeMayPlayOnline).
const CFG = JSON.stringify({ online: { TESTA: true, TESTB: true }, games: { 'shove-off': { allow: { TESTA: true, TESTB: true } } } });
stores.A.set('gamehub.adminConfig.v1', CFG);
stores.B.set('gamehub.adminConfig.v1', CFG);

const MP = await import('../shove-off/js/mp.js');
const E = await import('../shove-off/js/engine.js');
const { ANSWER_MS, FORFEIT_MS } = await import('../js/challenge-life.js');
const GS = await import('../js/game-stats.js');
const OG = await import('../js/online-gate.js');
OG.setGameShownCheck(() => true);   // the hub registers the launcher's rule; here every game is "shown"

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

const root = {};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const parts = (p) => p.split('/').filter(Boolean);
function getAt(p) { let n = root; for (const k of parts(p)) { if (!n || typeof n !== 'object') return undefined; n = n[k]; } return n; }
function setAt(p, v) {
  const ks = parts(p); let n = root;
  for (const k of ks.slice(0, -1)) { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
  if (v === null || v === undefined) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = clone(v);
}
let deletes = 0;
const api = {
  ref: (db, path) => ({ path }),
  get: async (r) => { const v = clone(getAt(r.path)); return { exists: () => v !== undefined && v !== null, val: () => v }; },
  set: async (r, v) => { if (v == null) deletes++; setAt(r.path, v); },
  update: async (r, patch) => { for (const k of Object.keys(patch)) { if (patch[k] == null) deletes++; setAt(r.path + '/' + k, patch[k]); } },
};
MP.__setBootForTest(async () => ({ db: {}, api }), { allowDev: true });

const THEM = { code: 'TESTB', name: 'Tester Two', emoji: '🦊' };
const ME = { code: 'TESTA', name: 'test1', emoji: '🐙' };
/** Aims for side s of game g (replayed): f(piece) -> [dx, dy]. */
function aims(g, s, f) {
  const m = MP.replay(g.log);
  const list = Array.from({ length: E.slotCount(m) }, () => null);
  for (const p of E.alive(m, s)) list[p.i] = E.clampAim(...f(p));
  return E.aimsToString(list);
}
const soft = (p) => [p.x > 0 ? -70 : 70, p.y > 0 ? -20 : 20];
const out = (p) => { const d = Math.sqrt(p.x * p.x + p.y * p.y) || 1; return [p.x / d * 9999, p.y / d * 9999]; };
const statsOf = (p) => { const st = JSON.parse(stores[p].get('gamehub.stats') || '{}'); return (st.testGames && st.testGames.shoveoff) || (st.games && st.games.shoveoff) || null; };

// --- a whole challenge ---------------------------------------------------------------------------
use('A');
let res = await MP.createGame({ them: THEM, look: 'car1' });
ok('the challenger creates a match, with their look', res.ok && res.game.a.look === 'car1', JSON.stringify(res));
const id = res.id;
ok('created: only the challenger has a row, and it is their move', !!getAt(`shoveoff/index/TESTA/${id}`) && getAt(`shoveoff/index/TESTA/${id}`).yourTurn === true && !getAt(`shoveoff/index/TESTB/${id}`));
let g = res.game;
res = await MP.sendAims(id, 1, aims(g, 'a', soft));
ok('round 1 sent by the challenger: verified, it waits on them', res.ok && !res.game.owes.a && res.game.owes.b && res.game.round === 1);
const bRow = getAt(`shoveoff/index/TESTB/${id}`);
ok('the challenge is DELIVERED with round 1: their row, their move, written by the other side', bRow && bRow.yourTurn === true && bRow.lastBy === 'them' && bRow.open === 'got' && bRow.name === 'test1');
ok('the challenger\'s own row: not their move now', getAt(`shoveoff/index/TESTA/${id}`).yourTurn === false);
ok('a retry of the same aims writes nothing twice', (await MP.sendAims(id, 1, aims(g, 'a', soft))).ok && Object.keys(getAt(`shoveoff/games/${id}/log`)).length === 1);
ok('different aims for a round already sent = a conflict, never an overwrite', (await MP.sendAims(id, 1, aims(g, 'a', out))).reason === 'moved-on');
ok('the next round cannot be sent early', (await MP.sendAims(id, 2, aims(g, 'a', soft))).ok === false);

use('B');
g = await MP.readGame(id);
ok('they read it: their move; the other\'s aims are in the log (the known limit) but not resolved', g && MP.isMyTurn(g, 'TESTB') && g.resolved === 0);
res = await MP.sendAims(id, 1, aims(g, 'b', soft), 'sumo0');
ok('their send resolves round 1: round 2, both owe', res.ok && res.resolved && res.game.round === 2 && res.game.owes.a && res.game.owes.b);
ok('their look is fixed by their first send', getAt(`shoveoff/games/${id}`).b.look === 'sumo0');
const ra = getAt(`shoveoff/index/TESTA/${id}`), rb = getAt(`shoveoff/index/TESTB/${id}`);
ok('BOTH rows say "your move" at once (simultaneous rounds), both flagged `both`', ra.yourTurn && rb.yourTurn && ra.both && rb.both && ra.rnd === 2);
ok('answered: the rows stop saying open', ra.open === '' && rb.open === '');
ok('rows carry pieces left and the mode', ra.mine === 4 && ra.theirs === 4 && ra.md && ra.md.look === 'car1' && ra.md.them === 'sumo0' && ra.md.first === 'me' && rb.md.first === 'them');

// Whole-document rejection.
const bad = clone(getAt(`shoveoff/games/${id}`));
bad.log['0001'].r = 3;
ok('an entry for the wrong round makes the whole match invalid', MP.validateGame(bad) === null);
const bad2 = clone(getAt(`shoveoff/games/${id}`));
bad2.log['0001'].aims = '9999,0;0,0;0,0;0,0';
ok('an arrow past the cap is refused whole', MP.validateGame(bad2) === null);
const bad3 = clone(getAt(`shoveoff/games/${id}`));
bad3.over = { winner: 'a', why: 'off', at: 1 };
ok('a claimed win the log never produced is refused', MP.validateGame(bad3) === null);
const bad4 = clone(getAt(`shoveoff/games/${id}`));
bad4.log['0002'] = { by: 'b', r: 1, aims: bad4.log['0001'].aims, at: 1 };
ok('a second send for the same round is refused whole', MP.validateGame(bad4) === null);

// Play it out: test1 shoves everything outward hard each round; Tester Two nudges inward. Somebody wins.
let guard = 0;
while (!g.over && guard++ < 40) {
  use('A'); g = await MP.readGame(id);
  if (g.over) break;
  if (g.owes.a) { res = await MP.sendAims(id, g.round, aims(g, 'a', (p) => { const t = E.alive(MP.replay(g.log), 'b')[0]; return t ? [(t.x - p.x) * 9, (t.y - p.y) * 9] : soft(p); })); if (!res.ok) { console.log(res); break; } g = res.game; }
  if (g.over) break;
  use('B'); g = await MP.readGame(id);
  if (g.owes.b) { res = await MP.sendAims(id, g.round, aims(g, 'b', soft)); if (!res.ok) { console.log(res); break; } g = res.game; }
}
ok(`the match ends with a result (${g.over && g.over.winner}, ${g.over && g.over.why}, round ${g.round})`, g.over && ['a', 'b', 'draw'].includes(g.over.winner));
ok('both rows say it is over, opposite results', (() => {
  const x = getAt(`shoveoff/index/TESTA/${id}`), y = getAt(`shoveoff/index/TESTB/${id}`);
  const opp = { won: 'lost', lost: 'won', draw: 'draw' };
  return x.over && y.over && opp[x.result] === y.result;
})());
ok('no aims after it is over', (await MP.sendAims(id, g.round, aims(g, 'b', soft))).ok === false);
ok('the ending row carries the detail (rounds, pieces knocked off and lost)', (() => { const d = getAt(`shoveoff/index/TESTA/${id}`).dt; return d && d.rounds >= 1 && Number.isFinite(d.kos) && Number.isFinite(d.lost); })());

// Counted once per phone, with its mode and detail.
use('A');
const fin = await MP.readGame(id);
ok('counted once from the match (full mode, detail, private log)', MP.countGame(fin) === true && MP.countGame(fin) === false);
const sa = statsOf('A');
ok('test1\'s record: one online result, in the mp bucket, with its mode and detail', sa && sa.byDiff && sa.byDiff.mp && sa.byDiff.mp.played === 1 && sa.byMode && Object.keys(sa.byMode).some((k) => /look=car1/.test(k) && /first=me/.test(k) && /on=1/.test(k)) && sa.dt && sa.dt._n === 1, JSON.stringify(sa));
use('B');
const rowsB = await MP.readMyGames();
ok('their list has the finished match', rowsB.length === 1 && rowsB[0].over && MP.RESULTS.includes(rowsB[0].result));
ok('a finished row is counted on their phone once (mode from the row)', MP.recordFinished(rowsB) === 1 && MP.recordFinished(rowsB) === 0);
const sb = statsOf('B');
ok('their record: one result, mode with their look, went second', sb && sb.byDiff.mp.played === 1 && Object.keys(sb.byMode || {}).some((k) => /look=sumo0/.test(k) && /first=them/.test(k)), JSON.stringify(sb && sb.byMode));
ok('the private play log has the match (both phones, once each)', (() => {
  const q = (p) => JSON.parse(stores[p].get('gamehub.playlog.v1') || '[]');
  const hasX = (p) => q(p).some((e) => e && e.g === 'shoveoff' && typeof e.x === 'string' && /"rounds"/.test(e.x));
  return hasX('A') && hasX('B');
})());

// --- sudden death through the write path ---------------------------------------------------------
use('A');
res = await MP.createGame({ them: THEM, look: 'puck0' });
const sdId = res.id;
g = res.game;
res = await MP.sendAims(sdId, 1, aims(g, 'a', out));
use('B'); g = await MP.readGame(sdId);
res = await MP.sendAims(sdId, 1, aims(g, 'b', out));
ok('everyone off in round 1 = sudden death on the server copy too', res.ok && !res.game.over && res.game.sd === 1 && res.game.left.a === 1 && res.game.left.b === 1);
ok('the rows say sudden death', getAt(`shoveoff/index/TESTA/${sdId}`).sd === 1);
use('A'); g = await MP.readGame(sdId);
res = await MP.sendAims(sdId, g.round, '560,0');
use('B'); g = await MP.readGame(sdId);
res = await MP.sendAims(sdId, g.round, '-80,0');
ok('sudden death decided: test1 wins, why sudden', res.ok && res.game.over && res.game.over.winner === 'a' && res.game.over.why === 'sudden', JSON.stringify(res.game && res.game.over));
ok('the mode says sudden death was used', MP.modeOfGame(res.game, 'a').sd === 1 && MP.detailOfGame(res.game, 'a').sdr === 1);

// --- cancel, decline, resign, expire, timeout ----------------------------------------------------
use('A');
let c0 = (await MP.createGame({ them: THEM })).id;
ok('nothing sent yet: cancelling costs nothing', MP.cancelCosts(await MP.readGame(c0)) === false);
res = await MP.cancelGame(c0);
ok('cancelled before round 1 was sent: nobody wins, no row for them', res.ok && res.cancelled && res.game.over.winner === 'none' && !getAt(`shoveoff/index/TESTB/${c0}`) && getAt(`shoveoff/index/TESTA/${c0}`).ended === 'cancelled');
const c1 = (await MP.createGame({ them: THEM })).id;
g = await MP.readGame(c1);
await MP.sendAims(c1, 1, aims(g, 'a', soft));
use('B');
res = await MP.cancelGame(c1);
ok('declined after the challenger sent round 1: a LOSS for the one who declines', res.ok && res.lost && res.game.over.winner === 'a' && getAt(`shoveoff/games/${c1}`).over.via === 'declined');
use('A');
const r1 = (await MP.createGame({ them: THEM })).id;
g = await MP.readGame(r1); await MP.sendAims(r1, 1, aims(g, 'a', soft));
use('B'); g = await MP.readGame(r1); await MP.sendAims(r1, 1, aims(g, 'b', soft));
res = await MP.resignGame(r1);
ok('resigning hands the other person the win, both rows record it', res.ok && res.game.over.winner === 'a' && res.game.over.why === 'resign' && getAt(`shoveoff/index/TESTA/${r1}`).result === 'won' && getAt(`shoveoff/index/TESTB/${r1}`).result === 'lost');
// Expiry: delivered, never answered for 3 days.
use('A');
const e1 = (await MP.createGame({ them: THEM })).id;
g = await MP.readGame(e1); await MP.sendAims(e1, 1, aims(g, 'a', soft));
const eDoc = getAt(`shoveoff/games/${e1}`);
ok('lifeOf: waiting, then expired after 3 days', MP.lifeOf(await MP.readGame(e1)).waiting && MP.lifeOf(await MP.readGame(e1), eDoc.updated + ANSWER_MS).expired);
const rowE = getAt(`shoveoff/index/TESTB/${e1}`);
const ex = MP.rowsFromIndex({ [e1]: { ...rowE, expires: Date.now() - 1 } });
ok('an unanswered challenge past its expiry reads as expired, finished, no result', ex[0] && ex[0].ended === 'expired' && ex[0].over && ex[0].result === null);
// 7 days on a round: one side owing loses; both owing = a draw.
{
  use('A');
  const tId = (await MP.createGame({ them: THEM })).id;
  g = await MP.readGame(tId); await MP.sendAims(tId, 1, aims(g, 'a', soft));
  use('B'); g = await MP.readGame(tId); await MP.sendAims(tId, 1, aims(g, 'b', soft));
  use('A'); g = await MP.readGame(tId); await MP.sendAims(tId, 2, aims(g, 'a', soft));
  g = await MP.readGame(tId);
  const late = Math.max(MP.roundStart(g), MP.FORFEIT_FROM) + FORFEIT_MS + 1000;
  const t1 = MP.withTimeout(clone(g), late);
  ok('7 days with only Tester Two owing round 2: they lose, why timeout', t1.over && t1.over.winner === 'a' && t1.over.why === 'timeout');
  const both = clone(await MP.readGame(r1 === tId ? tId : tId));
  both.log = both.log.slice(0, 2); both.owes = { a: true, b: true }; both.over = null;
  const t2 = MP.withTimeout(both, late + FORFEIT_MS);
  ok('7 days with BOTH owing: a draw by timeout', t2.over && t2.over.winner === 'draw' && t2.over.why === 'timeout');
  const rowT = MP.rowsFromIndex({ x1abcdef: { with: 'TESTB', open: '', yourTurn: true, both: true, turnAt: 1, updated: 1 } }, Date.now() + FORFEIT_MS * 400);
  ok('a row with both owing for 7 days reads as a draw (never a loss on both phones)', rowT[0] && rowT[0].result === 'draw' && rowT[0].why === 'timeout');
}

// --- guards ----------------------------------------------------------------------------------------
{
  MP.__setBootForTest(async () => ({ db: {}, api }));   // the dev-origin guard back on
  globalThis.location = { hostname: 'localhost' };
  const blocked = await MP.createGame({ them: THEM });
  ok('a dev origin never writes to the family database', blocked.ok === false && blocked.reason === 'dev-origin-blocked');
  MP.__setBootForTest(async () => ({ db: {}, api }), { allowDev: true });
  delete globalThis.location;
}
{
  // The launcher's rule (js/hub.js registers it) says Tester Two cannot see Shove Off.
  OG.setGameShownCheck((hub, code) => !(hub === 'shove-off' && code === 'TESTB'));
  use('A');
  const r = await MP.createGame({ them: THEM });
  ok('the admin-only game is never sent to someone who cannot see it', r.ok === false && r.reason === 'them-not-approved', JSON.stringify(r));
  OG.setGameShownCheck(() => true);
}
ok('nothing was ever deleted (no null writes)', deletes === 0, String(deletes));
ok('records per opponent fold finished rows', (() => { use('A'); const R = MP.recordsFrom(MP.rowsFromIndex(getAt('shoveoff/index/TESTA')), 'TESTA'); return R.opponents.length === 1 && R.opponents[0].played >= 3; })());
void ME; void GS;

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
