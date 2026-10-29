import { fileURLToPath as __toolsF2P } from 'node:url';
// test-eightball-mp.mjs - Pool challenges (eight-ball/js/mp.js), headless (Stage 2, 2026-10-22).
//
// The PURE halves (validation by replay, rows, records) and the WRITE path end to end, against an
// in-memory database handed in through mp.js's test seam, with three profiles taking turns on one
// "server": a two-player 8-ball match played to the end by the computer, a THREE-player Cutthroat
// match likewise, the challenge reaching everyone, cancel / decline / resign, the outbox, counting
// once. Also structural: `eightball` is in database.rules.json and the backup list, and the
// physics path uses nothing two phones could compute differently.
//   node tools/test-eightball-mp.mjs
const __ROOT_URL = new URL('../', import.meta.url).href;
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
import { readFileSync } from 'node:fs';

const stores = { A: new Map(), B: new Map(), C: new Map() };
let phone = 'A';
globalThis.localStorage = {
  getItem: (k) => (stores[phone].has(k) ? stores[phone].get(k) : null),
  setItem: (k, v) => stores[phone].set(k, String(v)),
  removeItem: (k) => stores[phone].delete(k),
};
const use = (p) => { phone = p; };
const sess = new Map();
globalThis.sessionStorage = { getItem: (k) => (sess.has(k) ? sess.get(k) : null), setItem: (k, v) => sess.set(k, String(v)), removeItem: (k) => sess.delete(k) };
const PEOPLE = { A: ['Matt', '🐙', 'MATTA'], B: ['Ana', '🦊', 'ANABB'], C: ['Ben', '🐻', 'BENCC'] };
const ONLINE = JSON.stringify({ online: { MATTA: true, ANABB: true, BENCC: true } });
for (const [k, [name, emoji, code]] of Object.entries(PEOPLE)) {
  stores[k].set('gamehub.profile', JSON.stringify({ name, emoji, playerId: code }));
  stores[k].set('gamehub.adminConfig.v1', ONLINE);
}
const them = (k) => ({ code: PEOPLE[k][2], name: PEOPLE[k][0], emoji: PEOPLE[k][1] });
const phoneOf = { MATTA: 'A', ANABB: 'B', BENCC: 'C' };

const MP = await import('../eight-ball/js/mp.js');
const E = await import('../eight-ball/js/engine.js');
const { plan, rngFrom } = await import('../eight-ball/js/ai.js');
const AL = await import('../eight-ball/js/alert.js');

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
let faultOn = null;
const api = {
  ref: (db, path) => ({ path }),
  get: async (r) => { const v = clone(getAt(r.path)); return { exists: () => v !== undefined && v !== null, val: () => v }; },
  set: async (r, v) => setAt(r.path, v),
  update: async (r, patch) => { if (faultOn && faultOn(r.path)) throw new Error('offline'); for (const k of Object.keys(patch)) setAt(r.path + '/' + k, patch[k]); },
};
MP.__setBootForTest(async () => ({ db: {}, api }), { allowDev: true });

const rng = rngFrom(7);
/** The computer's shot for whoever's turn it is, rounded as a phone would store it. */
function shotFor(game, diff = 'medium') {
  const m = MP.buildMatch(game);
  const s = plan(m, m.turn, diff, rng);
  return { by: m.turn, ...MP.roundShot(s) };
}
/** Play a whole match to its end, each shot sent by the phone whose turn it is. */
async function playOut(id, maxShots = 500) {
  for (let k = 0; k < maxShots; k++) {
    const g = await MP.readGame(id);
    if (!g || g.over) return g;
    const code = g.p[g.turn].code;
    use(phoneOf[code]);
    const res = await MP.appendLog(id, g.log.length, [shotFor(g)]);
    if (!res.ok) return { error: res.reason };
  }
  return MP.readGame(id);
}

// --- a two-player 8-ball match --------------------------------------------------------------------
use('A');
const c1 = await MP.createGame({ them: [them('B')], mode: '8', racks: 1, opts: { call: true }, aids: 'easy' });
ok('a challenge is made', c1.ok, JSON.stringify(c1));
const id1 = c1.id;
ok('...both rows are written at once (the receiver breaks)', !!getAt(`eightball/index/MATTA/${id1}`) && !!getAt(`eightball/index/ANABB/${id1}`));
ok('...it waits on Ana: her row says your turn, open "got", with a deadline', getAt(`eightball/index/ANABB/${id1}`).yourTurn === true && getAt(`eightball/index/ANABB/${id1}`).open === 'got' && getAt(`eightball/index/ANABB/${id1}`).expires > 0);
ok('...Matt\'s says sent', getAt(`eightball/index/MATTA/${id1}`).open === 'sent' && getAt(`eightball/index/MATTA/${id1}`).yourTurn === false);
ok('...the terms are stored', c1.game.mode === '8' && c1.game.opts.call === true && c1.game.aids === 'easy' && c1.game.seed > 0);
use('B');
const rowsB = await MP.readMyGames();
const al = AL.decideAlert(rowsB, MP.readSeen(), []);
ok('Ana\'s launcher bubble says challenge', al && al.kind === 'challenge' && al.name === 'Matt', JSON.stringify(al));
use('A');
const early = await MP.appendLog(id1, 0, [{ by: 0, dx: 0, dy: -1, p: 1, s: 0 }]);
ok('Matt cannot shoot out of turn', !early.ok && early.reason === 'rules-refused', JSON.stringify(early));
use('B');
const g1 = await MP.readGame(id1);
const brk = shotFor(g1);
const r1 = await MP.appendLog(id1, 0, [brk]);
ok('Ana breaks', r1.ok && r1.game.log.length === 1, JSON.stringify(r1));
ok('...a retry of the same shot writes nothing twice', (await MP.appendLog(id1, 0, [brk])).ok && Object.keys(getAt(`eightball/games/${id1}/log`)).length === 1);
ok('...the challenge is answered: no longer open', getAt(`eightball/index/ANABB/${id1}`).open === '' && getAt(`eightball/index/MATTA/${id1}`).open === '');
// Tampering is refused whole.
const raw = clone(getAt(`eightball/games/${id1}`));
raw.log['0000'].by = 0;
ok('a log with a shot out of turn does not validate', MP.validateGame(raw) === null);
const raw2 = clone(getAt(`eightball/games/${id1}`));
raw2.over = { winner: 1, why: 'racks', at: 1 };
ok('a claimed win the log never produced does not validate', MP.validateGame(raw2) === null);
const done1 = await playOut(id1);
ok('the whole match plays out to a winner', done1 && done1.over && Number.isInteger(done1.over.winner), JSON.stringify(done1 && (done1.error || done1.over)));
// Every phone that replays the log reaches the same table.
const m1 = MP.buildMatch(done1), m2 = MP.buildMatch(MP.validateGame(clone(getAt(`eightball/games/${id1}`))));
ok('...and a second replay ends on the identical table', JSON.stringify(m1) === JSON.stringify(m2));
const W = done1.over.winner, L = W ^ 1;
const wCode = done1.p[W].code, lCode = done1.p[L].code;
ok('both rows say it is over, with the right result', getAt(`eightball/index/${wCode}/${id1}`).result === 'won' && getAt(`eightball/index/${lCode}/${id1}`).result === 'lost');
use(phoneOf[wCode]);
ok('the winner\'s phone counts it once', MP.recordFinished(await MP.readMyGames()) === 1 && MP.recordFinished(await MP.readMyGames()) === 0);
const st = JSON.parse(localStorage.getItem('gamehub.stats') || '{}');
ok('...as an mp win', st.games && st.games.eightball && st.games.eightball.byDiff.mp.won === 1, JSON.stringify(st.games && st.games.eightball));

// --- a THREE-player Cutthroat match ---------------------------------------------------------------
use('A');
const bad = await MP.createGame({ them: [them('B')], mode: 'ct' });
ok('Cutthroat needs two other players', !bad.ok && bad.reason === 'bad-opponent');
const dup = await MP.createGame({ them: [them('B'), them('B')], mode: 'ct' });
ok('...two different ones', !dup.ok);
const c3 = await MP.createGame({ them: [them('B'), them('C')], mode: 'ct', racks: 1, opts: { obst: true } });
ok('a three-player challenge is made', c3.ok && c3.game.n === 3 && c3.game.p.length === 3, JSON.stringify(c3));
const id3 = c3.id;
ok('...all three get a row', ['MATTA', 'ANABB', 'BENCC'].every((c) => !!getAt(`eightball/index/${c}/${id3}`)));
ok('...each row names both others', getAt(`eightball/index/MATTA/${id3}`).name === 'Ana & Ben' && getAt(`eightball/index/ANABB/${id3}`).name === 'Ben & Matt' && getAt(`eightball/index/BENCC/${id3}`).name === 'Matt & Ana');
ok('...with a fixed `with` and `with2`', getAt(`eightball/index/ANABB/${id3}`).with === 'BENCC' && getAt(`eightball/index/ANABB/${id3}`).with2 === 'MATTA');
ok('...Ana breaks', getAt(`eightball/index/ANABB/${id3}`).yourTurn === true && getAt(`eightball/index/BENCC/${id3}`).yourTurn === false);
use('C');
const benRows = await MP.readMyGames();
ok('Ben sees it on his list', benRows.some((r) => r.id === id3 && r.n === 3 && r.mode === 'ct'));
const done3 = await playOut(id3);
ok('the three-player match plays out to one winner', done3 && done3.over && [0, 1, 2].includes(done3.over.winner), JSON.stringify(done3 && (done3.error || done3.over)));
const res3 = ['MATTA', 'ANABB', 'BENCC'].map((c) => getAt(`eightball/index/${c}/${id3}`).result);
ok('...one row won, two lost', res3.filter((x) => x === 'won').length === 1 && res3.filter((x) => x === 'lost').length === 2, JSON.stringify(res3));
use('A');
const rec = MP.recordsFrom(await MP.readMyGames(), 'MATTA');
ok('records count a three-player match against both others', rec.opponents.some((o) => o.code === 'ANABB' && o.played === 2) && rec.opponents.some((o) => o.code === 'BENCC' && o.played === 1), JSON.stringify(rec.opponents));

// --- cancel, decline, resign ----------------------------------------------------------------------
use('A');
const cx = await MP.createGame({ them: [them('B')], mode: '9' });
const cancel = await MP.cancelGame(cx.id);
ok('Matt cancels before Ana answered: counts for nobody', cancel.ok && cancel.cancelled && getAt(`eightball/index/ANABB/${cx.id}`).ended === 'cancelled');
use('B');
ok('...Ana\'s list shows it ended, with no result', (await MP.readMyGames()).find((r) => r.id === cx.id).cancelled === true);
use('A');
const dx = await MP.createGame({ them: [them('B'), them('C')], mode: 'ct' });
use('C');
const dec = await MP.resignGame(dx.id);
ok('Ben, a receiver, declines a three-player challenge before anyone answered: called off for all', dec.ok && dec.cancelled && ['MATTA', 'ANABB', 'BENCC'].every((c) => getAt(`eightball/index/${c}/${dx.id}`).ended === 'declined'));
use('A');
const rx = await MP.createGame({ them: [them('B'), them('C')], mode: 'ct' });
use('B');
const g = await MP.readGame(rx.id);
await MP.appendLog(rx.id, 0, [shotFor(g)]);
use('C');
const cantDecline = await MP.cancelGame(rx.id);
ok('once Ana has broken, Ben cannot decline any more', !cantDecline.ok && cantDecline.reason === 'accepted');
const quit = await MP.resignGame(rx.id);
ok('Ben resigns: the match is over, he lost, someone else won', quit.ok && !quit.cancelled && quit.game.over.why === 'resign' && quit.game.over.by === 2 && quit.game.over.winner !== 2, JSON.stringify(quit.game && quit.game.over));
ok('...his row says lost, one of the others won', getAt(`eightball/index/BENCC/${rx.id}`).result === 'lost'
  && ['MATTA', 'ANABB'].filter((c) => getAt(`eightball/index/${c}/${rx.id}`).result === 'won').length === 1);
ok('...a resignation by someone who is not the winner validates', MP.validateGame(clone(getAt(`eightball/games/${rx.id}`))) !== null);

// --- 7 days, then forfeit (2026-10-29, js/challenge-life.js), three players -----------------------
{
  const { FORFEIT_MS } = await import('../js/challenge-life.js');
  use('A');
  const tx = await MP.createGame({ them: [them('B'), them('C')], mode: 'ct' });
  use('B');
  let tg = await MP.readGame(tx.id);
  const br = await MP.appendLog(tx.id, 0, [shotFor(tg)]);
  tg = br.game;
  const idle = tg.turn;
  const rowsNow = ['MATTA', 'ANABB', 'BENCC'].map((c) => getAt(`eightball/index/${c}/${tx.id}`));
  ok('Cutthroat rows say who would win a timeout (one of the two not on turn)', rowsNow.filter((r) => r.tw === true).length === 1
    && rowsNow[idle].tw === false && rowsNow.every((r) => r.turnAt > 0), JSON.stringify(rowsNow.map((r) => [r.tw, r.turnAt])));
  const realNow = Date.now;
  try {
    Date.now = () => Math.max(rowsNow[0].turnAt, Date.UTC(2026, 9, 29)) + FORFEIT_MS + 1000;
    const g7 = await MP.readGame(tx.id);
    ok('7 days on a Cutthroat turn: the idle player is out, why timeout', g7.over && g7.over.why === 'timeout' && g7.over.by === idle && g7.over.winner !== idle);
    ok('...the winner is the one their rows named', rowsNow[g7.over.winner].tw === true);
    const read = {};
    for (const c of ['MATTA', 'ANABB', 'BENCC']) { use(phoneOf[c]); read[c] = (await MP.readMyGames()).find((r) => r.id === tx.id); }
    const codes = ['MATTA', 'ANABB', 'BENCC'];
    ok('...every list agrees: one won, two lost, timed out', codes.every((c, s) => read[c].over && read[c].why === 'timeout' && read[c].result === (s === g7.over.winner ? 'won' : 'lost')),
      JSON.stringify(codes.map((c) => read[c].result)));
    use(phoneOf[codes[idle]]);
    ok('...and the idle player\'s late shot is refused', (await MP.appendLog(tx.id, 1, [shotFor(tg)])).ok === false);
  } finally { Date.now = realNow; }
}

// --- the outbox -----------------------------------------------------------------------------------
use('A');
const ox = await MP.createGame({ them: [them('B')], mode: '8' });
use('B');
const og = await MP.readGame(ox.id);
const shot = shotFor(og);
faultOn = (p) => p.startsWith(`eightball/games/${ox.id}`);
const offline = await MP.appendLog(ox.id, 0, [shot]);
faultOn = null;
ok('a shot with no signal fails retryably', !offline.ok && offline.retryable);
MP.savePending(ox.id, 0, [shot]);
ok('...is kept in the outbox', MP.outboxCount() === 1 && MP.pendingFor(ox.id));
ok('...and goes out on the next drain', (await MP.drainOutbox()) === 1 && MP.outboxCount() === 0 && getAt(`eightball/games/${ox.id}/log/0000`));

// --- the hub's alerts contract ----------------------------------------------------------------------
AL.armOpen('match123');
ok('alert: armOpen hands over the match', AL.takeOpen().id === 'match123' && AL.takeOpen() === null);
AL.armChallenge(them('C'));
const pk = AL.takeOpen();
ok('alert: armChallenge hands over the person', pk && pk.kind === 'pick' && pk.them.code === 'BENCC');

// --- structure --------------------------------------------------------------------------------------
const rules = JSON.parse(readFileSync(new URL('database.rules.json', __ROOT_URL), 'utf8'));
ok('`eightball` is in database.rules.json, signed-in read and write', rules.rules.eightball && rules.rules.eightball['.read'] === 'auth != null' && rules.rules.eightball['.write'] === 'auth != null');
ok('`eightball` is in the backup branch list', /\n\s*'eightball',/.test(readFileSync(new URL('backups/rtdb-backup.mjs', __ROOT_URL), 'utf8')));
// The physics path (step, settle and what they call) may use no Math function but sqrt and imul.
const engineSrc = readFileSync(new URL('eight-ball/js/engine.js', __ROOT_URL), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const used = [...new Set((engineSrc.match(/Math\.[a-z0-9]+/gi) || []))].sort();
ok('engine.js uses only cross-engine-safe Math (sqrt, imul, min, max, round, floor, ceil)', used.every((f) => ['Math.sqrt', 'Math.imul', 'Math.min', 'Math.max', 'Math.round', 'Math.floor', 'Math.ceil'].includes(f)), used.join(','));
// Table versions (eight-ball/js/engine.js): a new challenge is stored on today's table; one stored
// before tables had versions (no `tb`) replays on table 1, where it was played.
ok('a new challenge records its table', (await MP.readGame(id1)).tb === 7 && MP.termsOf({ tb: 6 }).tb === 6 && MP.termsOf({ tb: 5 }).tb === 5 && MP.termsOf({ tb: 2 }).tb === 2 && MP.termsOf({ tb: 3 }).tb === 3);
ok('a new challenge records its rules; one with none is rules 1', (await MP.readGame(id1)).rv === 3 && MP.termsOf({ mode: '8' }).rv === 1 && MP.freshMatch(MP.termsOf({ mode: '8' })).rv === 1);
ok('a stored match with no table replays on table 1', MP.termsOf({ mode: '8' }).tb === 1 && MP.freshMatch(MP.termsOf({ mode: '8' })).tb === 1);
// A hand fix (Moonis's match, 2026-10-24): the real log, groups decided after shot 2 and nothing else.
{
  const moonis = { mode: '8', racks: 1, opts: {}, aids: 'easy', seed: 1369992693, tb: 5, rv: 2,
    p: [{ code: 'DREG5', name: 'test1' }, { code: 'ABCDE', name: 'B' }],
    log: { '0000': { by: 1, dx: 0.253516, dy: -0.967331, p: 1, s: 0, x: 13.978, y: 159.487 }, '0001': { by: 1, dx: -0.969289, dy: 0.245924, p: 0.9593, s: 0 } } };
  const plain = MP.buildMatch(MP.validateGame(moonis));
  const fixed = MP.validateGame({ ...moonis, fix: { after: 2, groups: ['b', 'a'] } });
  const fm = MP.buildMatch(fixed), f1 = MP.buildMatch(fixed, 1);
  ok('a match fix sets the groups after its shot and changes nothing else', !plain.groups && fm.groups.join() === 'b,a' && !f1.groups
    && fm.turn === plain.turn && fm.inHand === plain.inHand && fixed.turn === 0 && JSON.stringify(fm.b) === JSON.stringify(plain.b));
  ok('a junk fix is ignored', !MP.validateGame({ ...moonis, fix: { after: 2, groups: ['b', 'b'] } }).fix && !MP.termsOf({ mode: '9', fix: { after: 1, groups: ['a', 'b'] } }).fix);
}
ok('the chat accepts a third side', /side !== 'c'/.test(readFileSync(new URL('js/match-chat.js', __ROOT_URL), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
