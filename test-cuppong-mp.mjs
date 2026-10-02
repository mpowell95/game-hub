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

// A custom rerack rides the log with its cells, and replays.
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, rules: { gent: false, rr: 2 } });
const id3 = res.id;
const { PRESETS } = await import('./cup-pong/js/rack.js');
// Ten cells spread across the area, none touching: every other cell of rows 0, 2 and 4.
const spread = [[-5, 0], [-1, 0], [3, 0], [-3, 2], [1, 2], [5, 2], [-5, 4], [-1, 4], [3, 4], [-3, 0]]
  .map(([c, r]) => ({ c, r: r + ((c + r) % 2 === 0 ? 1 : 0) }));
// A full rack cannot be reracked: Matt makes one (then misses), Ana misses twice, then his rerack.
const pre = [t('a', 'k0'), t('a', null)];
ok('custom rerack setup: a turn each', (await MP.appendLog(id3, 0, pre)).ok);
use('B'); ok('...', (await MP.appendLog(id3, 2, [t('b', null), t('b', null)])).ok); use('A');
spread.pop();
const rr = { by: 'a', k: 'r', key: 'custom', cells: spread };
ok('cleanEntry keeps a custom rerack with its cells', (MP.cleanEntry(rr) || {}).cells?.length === 9);
ok('cleanEntry refuses a custom rerack with non-integer cells', MP.cleanEntry({ ...rr, cells: [{ c: 0.5, r: 1 }] }) === null);
res = await MP.appendLog(id3, 4, [rr]);
ok('a custom rerack is accepted and stored', res.ok && res.game.log[4].key === 'custom', JSON.stringify(res.reason || ''));
const lc = MP.buildLocal(await MP.readGame(id3), 'a');
ok('...and replays to exactly those cells', lc.racks.b.every((k, i) => k.c === spread[i].c && k.r === spread[i].r));
ok('...costing one rerack', lc.reracksLeft.a === 1);
ok('a retry of the same custom rerack writes nothing twice', (await MP.appendLog(id3, 4, [rr])).ok && Object.keys(getAt(`cuppong/games/${id3}/log`)).length === 5);
void PRESETS;

// Bounce shots are OFF (Matt, 2026-09-28); only a challenge stored with `bo` (made while they were
// live) replays with them on.
{
  const log = [{ by: 'a', k: 't', p: 0.5, a: 0, m: 'k0', b: 1, at: 1 }];
  const oldM = MP.buildLocal({ rules: { gent: true, rr: 2 }, log }, 'a');
  const newM = MP.buildLocal({ rules: { gent: true, rr: 2, bo: true }, log }, 'a');
  ok('a challenge without the bounce rule: a bounced make is one cup', oldM.owed.b === 0 && oldM.racks.b.length === 9);
  ok('a challenge stored with bo still replays with it (its log may hold owed cups)', newM.owed.b === 1 && newM.racks.b.length === 9);
  ok('new challenges are made WITHOUT bounce shots', getAt(`cuppong/games/${id3}/rules`).bo === undefined);
}

// A SERIES of STRAIGHT UP games (Matt, 2026-09-30).
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, rules: { su: true, gent: true, rr: 3 }, series: 3 });
const s1 = res.id;
ok('a best-of-3 straight-up challenge is created', res.ok && res.game.series === 3 && res.game.seriesNo === 1 && res.game.rules.su === true && res.game.rules.gent === false && res.game.rules.rr === 0);
let sn = 0;
const sSend = async (who, list) => { use(who === 'a' ? 'A' : 'B'); const r = await MP.appendLog(s1, sn, list); if (r.ok) sn += list.length; return r; };
for (let i = 0; i < 10; i += 2) {
  res = await sSend('a', [t('a', 'k' + i), t('a', 'k' + (i + 1))]);
  if (!res.ok) { ok('straight up: every throw lands', false, res.reason); break; }
  if (res.game.over) break;
  res = await sSend('b', [t('b', null), t('b', null)]);
}
ok('straight up: Matt clears 10 in five turns and wins with no rebuttal', res.ok && res.game.over && res.game.over.winner === 'a');
const rowS = getAt(`cuppong/index/ANABB/${s1}`);
ok('the rows carry the series and the mode', rowS.series === 3 && rowS.seriesNo === 1 && rowS.su === true);
const g1 = await MP.readGame(s1);
ok('after game 1: 1-0 to Matt, not done, and Ana (who lost) starts game 2', MP.seriesAfter(g1).wins.a === 1 && !MP.seriesAfter(g1).done && MP.seriesStarter(g1) === 'b');
use('B');
res = await MP.nextInSeries(g1);
const s2 = res.id;
ok('game 2 is created: Ana is side a and shoots first, the score swapped', res.ok && res.game.a.code === 'ANABB' && res.game.seriesNo === 2 && res.game.seriesWins.b === 1 && res.game.seriesWins.a === 0 && res.game.seriesOf === s1 && res.game.rules.su === true);
ok('...Ana shoots first, so like any challenge it reaches Matt when her first turn ends', getAt(`cuppong/index/ANABB/${s2}`).yourTurn === true && !getAt(`cuppong/index/MATTA/${s2}`));
res = await MP.appendLog(s2, 0, [t('a', null), t('a', null)]);
ok('...and then it does, as his turn, marked game 2 of 3', res.ok && getAt(`cuppong/index/MATTA/${s2}`).yourTurn === true && getAt(`cuppong/index/MATTA/${s2}`).seriesNo === 2);
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, rules: {}, series: 3, seriesNo: 2, seriesOf: s1, first: 'them' });
ok('a series game where the OTHER person shoots first writes both rows at once', res.ok && res.game.a.code === 'ANABB' && getAt(`cuppong/index/ANABB/${res.id}`).yourTurn === true && getAt(`cuppong/index/MATTA/${res.id}`).yourTurn === false);
ok('an old challenge (no series fields) reads as a single game', MP.validateGame({ ...clone(getAt(`cuppong/games/${id}`)) }).series === 1);

// --- a stale base: the other person's throws were WATCHED before this phone threw (2026-10-02) -----
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, rules: { su: true } });
const sb = res.id;
ok('stale base: Matt\'s first turn', (await MP.appendLog(sb, 0, [t('a', null), t('a', null)])).ok);
use('B');
ok('stale base: Ana\'s turn lands', (await MP.appendLog(sb, 2, [t('b', 'k9'), t('b', 'k8')])).ok);
use('A');
// Matt's phone opened the match at length 2, then watched Ana's two throws arrive: base 2, log 4.
res = await MP.appendLog(sb, 2, [t('a', 'k9'), t('a', 'k8')]);
ok('throws built on top of the other person\'s watched throws are accepted, not "moved on"', res.ok && res.game.log.length === 6 && res.game.log[4].m === 'k9', JSON.stringify(res.reason));
ok('...and a retry of them at the stale base writes nothing twice', (await MP.appendLog(sb, 2, [t('a', 'k9'), t('a', 'k8')])).ok && Object.keys(getAt(`cuppong/games/${sb}/log`)).length === 6);
ok('...but Matt still cannot throw on Ana\'s turn that way', !(await MP.appendLog(sb, 2, [t('a', 'k7')])).ok);
use('B');
ok('stale base: Ana throws again', (await MP.appendLog(sb, 6, [t('b', null), t('b', null)])).ok);
use('A');
ok('a different throw of Matt\'s own already in the log is still a conflict', (await MP.appendLog(sb, 2, [t('a', 'k5')])).reason === 'moved-on');
// The phone's outbox: a refused send is KEPT, not dropped.
localStorage.removeItem(MP.OUTBOX_KEY);
MP.savePending(sb, 2, [t('a', 'k5')]);
await MP.drainOutbox(sb);
ok('the outbox keeps throws the server refused (only an OVER match drops them)', !!MP.pendingFor(sb));
localStorage.removeItem(MP.OUTBOX_KEY);

// --- structural -------------------------------------------------------------------------------------
const rules = JSON.parse(readFileSync('database.rules.json', 'utf8'));
ok('database.rules.json has the cuppong branch', !!(rules.rules && rules.rules.cuppong));
ok('the backup reads the cuppong branch', /['"]cuppong['"]/.test(readFileSync('backups/rtdb-backup.mjs', 'utf8')));
ok('mp.js deletes nothing', !/\.remove\(|set\([^)]*,\s*null\)/.test(readFileSync('cup-pong/js/mp.js', 'utf8')));

console.log(`\nCup Pong challenge tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
