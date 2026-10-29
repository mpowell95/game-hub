import { fileURLToPath as __toolsF2P } from 'node:url';
// Paths below resolve from the repo root.
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// test-chinchon-mp.mjs - Chinchón challenges (chinchon/js/mp.js), headless (2026-10-18).
//
// The PURE halves (validation by replay, determinism) and the WRITE path end to end, against an
// in-memory database handed in through mp.js's test seam, with two profiles taking turns on one
// "server" and the game's own AI making every decision. Also structural: `chinchon` is in
// database.rules.json and the backup list, and challenges never write head-to-head.
//   node tools/test-chinchon-mp.mjs
import { readFileSync } from 'node:fs';
process.chdir(__ROOT_DIR);

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
stores.C.set('gamehub.profile', JSON.stringify({ name: 'Cee', emoji: '🐼', playerId: 'CCCCC' }));
// Matt and Ana may play online (js/online-gate.js); Cee may not.
const ONLINE = JSON.stringify({ online: { MATTA: true, ANABB: true } });
stores.A.set('gamehub.adminConfig.v1', ONLINE);
stores.B.set('gamehub.adminConfig.v1', ONLINE);
stores.C.set('gamehub.adminConfig.v1', ONLINE);

const MP = await import('../chinchon/js/mp.js');
const { AIAgent } = await import('../chinchon/js/ai.js');
const { stateHash: rawHash } = await import('../chinchon/js/hash.js');
// hash.js (the live rooms' lockstep hash) only ever hashes between turns, when no melds are locked;
// a FINISHED replay still holds the closer's locked melds, so compare those separately.
const stateHash = (e) => { const lm = e.lockedMelds; e.lockedMelds = null; try { return rawHash(e) + JSON.stringify(lm); } finally { e.lockedMelds = lm; } };

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
let offline = false;
const api = {
  ref: (db, path) => ({ path }),
  get: async (r) => { const v = clone(getAt(r.path)); return { exists: () => v !== undefined && v !== null, val: () => v }; },
  set: async (r, v) => setAt(r.path, v),
  update: async (r, patch) => { for (const k of Object.keys(patch)) setAt(r.path + '/' + k, patch[k]); },
};
MP.__setBootForTest(async () => (offline ? null : { db: {}, api }), { allowDev: true });

// --- a player: the game's own AI decides, one entry at a time ------------------------------------
const ai = { a: new AIAgent({ difficulty: 'hard' }), b: new AIAgent({ difficulty: 'normal' }) };
const asDoc = (g, extra = []) => ({ ...g, log: g.log.concat(extra) });
/** Every decision `side` makes until the other must act (or the match ends), WITHOUT writing. */
async function turnEntries(g, side) {
  const out = [];
  for (let guard = 0; guard < 40; guard++) {
    const rep = await MP.replay(asDoc(g, out));
    if (!rep.ok || rep.done || !rep.waiting) break;
    const seat = rep.waiting.seat;
    if ((seat === 0 ? 'a' : 'b') !== side) break;
    const view = rep.engine.getView(seat);
    const kind = rep.waiting.kind;
    const agent = ai[side];
    if (kind === 'draw') out.push({ by: side, k: 'draw', src: agent.chooseDraw(view) });
    else if (kind === 'discard') out.push({ by: side, k: 'discard', card: agent.chooseDiscard(view) });
    else out.push({ by: side, k: 'close', yes: !!agent.decideClose(view) });
  }
  return out;
}
const P = { a: 'A', b: 'B' };
/** One whole turn for `side`, written ONE ENTRY AT A TIME (as the phone does). */
async function playTurn(id, side) {
  use(P[side]);
  let g = await MP.readGame(id);
  const todo = await turnEntries(g, side);
  let res = { ok: true, game: g };
  for (const e of todo) {
    res = await MP.appendLog(id, g.log.length, [e]);
    if (!res.ok) return res;
    g = res.game;
  }
  return res;
}
async function playToEnd(id, max = 400) {
  let g;
  for (let n = 0; n < max; n++) {
    use('A');
    g = await MP.readGame(id);
    if (!g || g.over) return g;
    const r = await playTurn(id, g.turn);
    if (!r.ok) { console.log('turn refused', r.reason); return null; }
  }
  return g;
}

// --- the pure half: one seed, one log, one table ---------------------------------------------------
{
  const doc = { a: { code: 'MATTA' }, b: { code: 'ANABB' }, seed: 987654321, len: 'hand', log: [] };
  const r1 = await MP.replay(doc), r2 = await MP.replay(doc);
  ok('replay: the same seed deals the same hands', stateHash(r1.engine) === stateHash(r2.engine));
  ok('replay: the challenger (side a) plays first, drawing', r1.waiting && r1.waiting.seat === 0 && r1.waiting.kind === 'draw');
  ok('replay: seven cards each, one on the discard pile', r1.engine.players.every((p) => p.hand.length === 7) && r1.engine.discard.length === 1);
  const r3 = await MP.replay({ ...doc, seed: 987654322 });
  ok('replay: another seed deals another table', stateHash(r3.engine) !== stateHash(r1.engine));
  ok('configFor: one hand is one round', MP.configFor('hand').victoryCondition === 'rounds' && MP.configFor('hand').roundsLimit === 1);
  ok('configFor: 50 is the points ending at 50', MP.configFor('50').victoryCondition === 'points' && MP.configFor('50').scoreLimit === 50);
  ok('configFor: placing is automatic', MP.configFor('100').placeOnEnding === 'auto');
}

// --- a whole one-hand challenge, both phones ---------------------------------------------------
use('A');
let res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, len: 'hand' });
ok('the challenger can create a match', res.ok, JSON.stringify(res));
const id = res.id;
ok('created: it stores a seed, the length and the standard rules', Number.isInteger(getAt(`chinchon/games/${id}/seed`)) && getAt(`chinchon/games/${id}/len`) === 'hand'
  && getAt(`chinchon/games/${id}/rules/maxClose`) === 3);
ok('created: only the challenger has a row until the first turn is over',
  !!getAt(`chinchon/index/MATTA/${id}`) && !getAt(`chinchon/index/ANABB/${id}`));
ok('created: it is Matt\'s turn', res.game.turn === 'a' && res.game.asking === 'draw');
{
  const g0 = res.game;
  const [draw, discard] = await turnEntries(g0, 'a');
  res = await MP.appendLog(id, 0, [draw]);
  ok('a draw lands and is verified', res.ok && res.game.log.length === 1 && res.game.turn === 'a' && res.game.asking === 'discard');
  ok('mid-turn: still no row for the other person', !getAt(`chinchon/index/ANABB/${id}`));
  ok('Matt cannot discard a card he does not hold', !(await MP.appendLog(id, 1, [{ by: 'a', k: 'discard', card: 'jk1' }])).ok);
  ok('Matt cannot draw twice', (await MP.appendLog(id, 1, [{ by: 'a', k: 'draw', src: 'stock' }])).reason === 'rules-refused');
  res = await MP.appendLog(id, 1, [discard]);
  ok('draw + discard: the turn passes to Ana', res.ok && res.game.turn === 'b', JSON.stringify(res.game && { turn: res.game.turn, asking: res.game.asking }));
  const anaRow = getAt(`chinchon/index/ANABB/${id}`);
  ok('the challenge reaches Ana as HER turn, written by the other side',
    anaRow && anaRow.yourTurn === true && anaRow.lastBy === 'them' && anaRow.name === 'Matt' && anaRow.kind === 'hand' && anaRow.round === 1);
  ok('Matt\'s own row says it was his write', getAt(`chinchon/index/MATTA/${id}`).lastBy === 'me' && getAt(`chinchon/index/MATTA/${id}`).yourTurn === false);
  ok('a retry of entries already there writes nothing twice', (await MP.appendLog(id, 0, [draw, discard])).ok && Object.keys(getAt(`chinchon/games/${id}/log`)).length === 2);
  ok('Matt cannot play on Ana\'s turn', !(await MP.appendLog(id, 2, [{ by: 'a', k: 'draw', src: 'stock' }])).ok);
}
use('B');
let g = await MP.readGame(id);
ok('Ana reads the match, and it is her turn', g && MP.isMyTurn(g, 'ANABB'));
ok('what to show her starts where Matt\'s run starts', MP.lastRunStart(g, 'a') === 0);
ok('a stale base is a conflict, never an overwrite', (await MP.appendLog(id, 1, [{ by: 'b', k: 'draw', src: 'stock' }])).reason === 'moved-on');
// Both phones replay to the same table.
{
  use('A'); const ga = await MP.readGame(id);
  use('B'); const gb = await MP.readGame(id);
  const ea = (await MP.replay(ga)).engine, eb = (await MP.replay(gb)).engine;
  ok('both phones replay to the same table (state hash)', stateHash(ea) === stateHash(eb));
}
const end1 = await playToEnd(id);
ok('the one-hand match plays to an end', end1 && end1.over && ['a', 'b', 'draw'].includes(end1.over.winner), JSON.stringify(end1 && end1.over));
ok('...after exactly one hand', end1 && end1.round === 1 && ['hand', 'chinchon'].includes(end1.over.why), JSON.stringify(end1 && { round: end1.round, why: end1.over.why }));
{
  const lo = end1.scores.a < end1.scores.b ? 'a' : end1.scores.b < end1.scores.a ? 'b' : 'draw';
  ok('...the lowest score wins (or a chinchón)', end1.over.why === 'chinchon' || end1.over.winner === lo, JSON.stringify({ scores: end1.scores, over: end1.over }));
  const ra = getAt(`chinchon/index/MATTA/${id}`), rb = getAt(`chinchon/index/ANABB/${id}`);
  ok('both rows say it is over, with opposite results', ra.over && rb.over && MP.resultOf(end1, 'a') === ra.result && MP.resultOf(end1, 'b') === rb.result);
  ok('no more moves after it is over', (await MP.appendLog(id, end1.log.length, [{ by: end1.turn || 'a', k: 'draw', src: 'stock' }])).ok === false);
  // A log that does not replay is refused whole.
  const bad = clone(getAt(`chinchon/games/${id}`));
  bad.log['0002'].by = 'a';
  ok('a move made out of turn makes the whole match invalid', (await MP.validateGame(bad)) === null);
  const bad2 = clone(getAt(`chinchon/games/${id}`));
  const k = Object.keys(bad2.log).find((x) => bad2.log[x].k === 'discard');
  bad2.log[k].card = bad2.log[k].card === 'o1' ? 'o2' : 'o1';
  ok('a tampered discard (a card not in that hand, or a different game) is refused', (await MP.validateGame(bad2)) === null
    || JSON.stringify((await MP.validateGame(bad2)).scores) !== JSON.stringify(end1.scores));
  const bad3 = clone(getAt(`chinchon/games/${id}`));
  bad3.over = { winner: end1.over.winner === 'a' ? 'b' : 'a', why: 'hand', at: 1 };
  ok('a claimed win the log never produced is refused', (await MP.validateGame(bad3)) === null);
  const bad4 = clone(getAt(`chinchon/games/${id}`));
  bad4.seed = bad4.seed ^ 1;
  ok('the same log on another seed does not replay', (await MP.validateGame(bad4)) === null);
  const bad5 = clone(getAt(`chinchon/games/${id}`));
  bad5.log['9999'] = { by: 'a', k: 'draw', src: 'stock' };
  ok('a move after the end is refused', (await MP.validateGame(bad5)) === null);
  const bad6 = clone(getAt(`chinchon/games/${id}`));
  bad6.rules.maxClose = 9;
  ok('a made-up rule is refused', (await MP.validateGame(bad6)) === null);
}

// Counting once per phone, in the 'mp' bucket, never head-to-head.
for (const ph of ['A', 'B']) {
  use(ph);
  const rows = await MP.readMyGames();
  const r = rows.find((x) => x.id === id);
  ok(`${ph}: the finished match is in the list with its result`, r && r.over && MP.RESULTS.includes(r.result));
  ok(`${ph}: counted once`, MP.recordFinished(rows) === 1 && MP.recordFinished(rows) === 0 && MP.countResult(id, true) === false);
  const st = JSON.parse(stores[ph].get('gamehub.stats') || '{}');
  const mp = st.games && st.games.chinchon && st.games.chinchon.byDiff && st.games.chinchon.byDiff.mp;
  const want = r.result;
  ok(`${ph}: ...as one 'mp' ${want}`, mp && mp.played === 1 && mp.won === (want === 'won' ? 1 : 0) && mp.lost === (want === 'lost' ? 1 : 0), JSON.stringify(mp));
  ok(`${ph}: ...with no head-to-head written`, !st.h2h || !st.h2h.chinchon);
  ok(`${ph}: ...and queued for the Game Over popup`, MP.readUnseen().includes(id));
}
{
  // The closer's extras ride the row and land in cc.
  use('A');
  const rr = (await MP.readMyGames()).find((x) => x.id === id);
  const st = JSON.parse(stores.A.get('gamehub.stats')).games.chinchon;
  ok('the row\'s closes are what was counted', st.cc && st.cc.closed === rr.cl && st.cc.chinchons === rr.cn, JSON.stringify({ cc: st.cc, cl: rr.cl }));
}

// --- a longer match: to 50 points, several hands ---------------------------------------------------
use('A');
res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, len: '50' });
const id50 = res.id;
const end50 = await playToEnd(id50);
ok('a match to 50 plays to an end', end50 && end50.over, JSON.stringify(end50 && end50.over));
ok('...over more than one hand (unless a chinchón ended it)', end50 && (end50.round > 1 || end50.over.why === 'chinchon'), String(end50 && end50.round));
ok('...ending once somebody is over 50, lowest wins', end50 && (end50.over.why === 'chinchon' || (Math.max(end50.scores.a, end50.scores.b) > 50
  && (end50.over.winner === 'draw' ? end50.scores.a === end50.scores.b : end50.scores[end50.over.winner] < end50.scores[end50.over.winner === 'a' ? 'b' : 'a']))), JSON.stringify(end50 && { s: end50.scores, o: end50.over }));
{
  use('A'); const ga = await MP.readGame(id50);
  use('B'); const gb = await MP.readGame(id50);
  ok('both phones agree on the long match', JSON.stringify(ga.scores) === JSON.stringify(gb.scores) && JSON.stringify(ga.over) === JSON.stringify(gb.over));
  const ea = (await MP.replay(ga)).engine, eb = (await MP.replay(gb)).engine;
  ok('...state hash identical after every hand', stateHash(ea) === stateHash(eb));
  // Mid-match replays agree too (a phone opening it halfway).
  const half = Math.floor(ga.log.length / 2);
  const ha = (await MP.replay(ga, half)).engine, hb = (await MP.replay(gb, half)).engine;
  ok('...and halfway through', stateHash(ha) === stateHash(hb));
}
{
  // Hand 2 is opened by side b (seat 1 dealt hand 1, seat 0 deals hand 2).
  use('A');
  const ga = await MP.readGame(id50);
  let firstOfRound2 = null;
  for (let n = 1; n <= ga.log.length && firstOfRound2 == null; n++) {
    const r = await MP.replay(ga, n);
    if (r.engine.round === 2 && r.waiting && r.engine.players.every((p) => p.hand.length === 7)) firstOfRound2 = r.waiting.seat;
  }
  ok('the deal rotates: hand 2 is opened by Ana', ga.round < 2 || firstOfRound2 === 1, String(firstOfRound2));
}

// --- resign, cancel, decline, expire (js/challenge-life.js) ---------------------------------------
{
  const { ANSWER_MS } = await import('../js/challenge-life.js');
  use('A');
  let r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, len: '100' });
  const rid = r.id;
  await playTurn(rid, 'a');
  // She ANSWERS it (one move): from then on giving up is a resignation, not a decline.
  use('B');
  g = await MP.readGame(rid);
  const [first] = await turnEntries(g, 'b');
  await MP.appendLog(rid, g.log.length, [first]);
  ok('one move from the receiver answers it: the rows stop saying open', getAt(`chinchon/index/ANABB/${rid}`).open === '' && getAt(`chinchon/index/MATTA/${rid}`).open === '');
  r = await MP.resignGame(rid);
  ok('resigning hands the other person the win', r.ok && r.game.over.winner === 'a' && r.game.over.why === 'resign');
  ok('...and both rows record it', getAt(`chinchon/index/MATTA/${rid}`).result === 'won' && getAt(`chinchon/index/ANABB/${rid}`).result === 'lost'
    && getAt(`chinchon/index/MATTA/${rid}`).why === 'resign');
  ok('...a resignation cannot claim a draw', (await MP.validateGame({ ...clone(getAt(`chinchon/games/${rid}`)), over: { winner: 'draw', why: 'resign', at: 1 } })) === null);

  use('A');
  r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const nd = r.id;
  r = await MP.resignGame(nd);
  ok('a never-delivered challenge, given up, is called off and writes no row for the other person', r.ok && r.cancelled && !getAt(`chinchon/index/ANABB/${nd}`));

  use('A');
  r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const cx = r.id;
  ok('a new challenge carries lapse (it can expire)', getAt(`chinchon/games/${cx}`).lapse === true);
  await playTurn(cx, 'a');
  ok('delivered: Matt\'s row says sent, Ana\'s says got, both with a deadline 3 days on',
    getAt(`chinchon/index/MATTA/${cx}`).open === 'sent' && getAt(`chinchon/index/ANABB/${cx}`).open === 'got'
    && getAt(`chinchon/index/ANABB/${cx}`).expires === getAt(`chinchon/games/${cx}`).updated + ANSWER_MS);
  use('A');
  // CANCEL AFTER THE SENDER'S FIRST TURN = A LOSS for the sender (Matt, 2026-10-29, second pass).
  ok('the confirm words know it will cost a loss (the row and the match agree)', MP.cancelCosts(await MP.readGame(cx)) === true && getAt(`chinchon/index/MATTA/${cx}`).pl === true);
  r = await MP.cancelGame(cx);
  ok('the sender cancels after his first turn: a LOSS for him, stored as his resignation', r.ok && r.lost && !r.cancelled && r.game.over.winner === 'b' && r.game.over.why === 'resign' && getAt(`chinchon/games/${cx}`).over.via === 'cancelled', JSON.stringify(r && r.game && r.game.over));
  const mr = getAt(`chinchon/index/MATTA/${cx}`), ar = getAt(`chinchon/index/ANABB/${cx}`);
  ok('...both rows say finished: she won, he lost (the push reads it as his resignation)', mr.over === true && mr.result === 'lost' && ar.over === true && ar.result === 'won' && ar.why === 'resign');
  use('B');
  const rowsB = await MP.readMyGames();
  const rb = rowsB.find((x) => x.id === cx);
  ok('...Ana\'s list reads it as a win', rb && rb.over && !rb.ended && rb.result === 'won' && !rb.yourTurn);
  ok('...counted for her once', MP.recordFinished(rowsB.filter((x) => x.id === cx)) === 1 && MP.recordFinished(rowsB.filter((x) => x.id === cx)) === 0);
  use('A');
  { const z = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
    ok('nothing played yet: cancelling costs nothing', MP.cancelCosts(await MP.readGame(z.id)) === false);
    const zr = await MP.cancelGame(z.id);
    ok('the sender cancels before playing: nobody wins, stored over:false (no push)', zr.ok && zr.cancelled && zr.game.over.winner === 'none' && getAt(`chinchon/index/MATTA/${z.id}`).ended === 'cancelled' && getAt(`chinchon/index/MATTA/${z.id}`).over === false); }
  use('B');
  ok('...and no move can be made in it', !(await MP.appendLog(cx, 2, [{ by: 'b', k: 'draw', src: 'stock' }])).ok);
  ok('the match document is kept, log and all', Object.keys(getAt(`chinchon/games/${cx}/log`)).length >= 2);

  use('A');
  r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const dx = r.id;
  await playTurn(dx, 'a');
  use('B');
  r = await MP.resignGame(dx);
  ok('the receiver declining after the sender\'s first turn: a LOSS for her (Matt wins)', r.ok && r.lost && r.game.over.why === 'resign' && r.game.over.winner === 'a' && getAt(`chinchon/games/${dx}`).over.via === 'declined');
  ok('...Matt\'s row says he won', getAt(`chinchon/index/MATTA/${dx}`).result === 'won' && getAt(`chinchon/index/MATTA/${dx}`).over === true);

  use('A');
  r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const ax = r.id;
  await playTurn(ax, 'a');
  use('B');
  g = await MP.readGame(ax);
  await MP.appendLog(ax, g.log.length, (await turnEntries(g, 'b')).slice(0, 1));
  use('A');
  r = await MP.cancelGame(ax);
  ok('once answered it can no longer be cancelled', !r.ok && r.reason === 'accepted');
  getAt(`chinchon/games/${ax}`).over = { winner: 'none', why: 'cancelled', at: 1 };
  const gx = await MP.readGame(ax);
  ok('a cancel that raced the first answer is void: the match plays on', gx && !gx.over && gx.turn === 'b');
  getAt(`chinchon/games/${ax}`).over = null;

  use('A');
  r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const ex = r.id;
  await playTurn(ex, 'a');
  const doc = getAt(`chinchon/games/${ex}`);
  const lateG = await MP.readGame(ex);
  ok('lifeOf: waiting, not yet expired', MP.lifeOf(lateG).waiting && !MP.lifeOf(lateG).expired);
  ok('lifeOf: expired after 3 days', MP.lifeOf(lateG, doc.updated + ANSWER_MS).expired);
  const back3 = (o) => { o.updated -= ANSWER_MS + 1000; if (o.expires) o.expires -= ANSWER_MS + 1000; };
  back3(doc); back3(getAt(`chinchon/index/MATTA/${ex}`)); back3(getAt(`chinchon/index/ANABB/${ex}`));
  use('B');
  const er = (await MP.readMyGames()).find((x) => x.id === ex);
  ok('an unanswered challenge 3 days old reads as expired, finished, no result', er && er.ended === 'expired' && er.over && er.result === null && !er.yourTurn);
  g = await MP.readGame(ex);
  r = await MP.appendLog(ex, g.log.length, (await turnEntries(g, 'b')).slice(0, 1));
  ok('...and refuses a late move', !r.ok && r.reason === 'expired');
  ok('a called-off document with an unknown why is refused', (await MP.validateGame({ ...clone(getAt(`chinchon/games/${ex}`)), over: { winner: 'none', why: 'whatever' } })) === null);
}

// --- the outbox keeps moves until the server has them --------------------------------------------
{
  use('A');
  res = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const oid = res.id;
  const [d] = await turnEntries(res.game, 'a');
  offline = true;
  const r = await MP.appendLog(oid, 0, [d]);
  ok('offline: the move is refused as retryable', !r.ok && r.retryable && r.reason === 'offline');
  MP.savePending(oid, 0, [d]);
  ok('a pending move is kept on the phone', !!MP.pendingFor(oid) && MP.outboxCount() === 1);
  ok('...and survives a failed drain', (await MP.drainOutbox(oid)) === 0 && !!MP.pendingFor(oid));
  offline = false;
  ok('...and is sent by the next drain', (await MP.drainOutbox(oid)) === 1 && !MP.pendingFor(oid) && (await MP.readGame(oid)).log.length === 1);
  ok('...once', (await MP.drainOutbox()) === 0 && (await MP.readGame(oid)).log.length === 1);
}

// --- the online gate -------------------------------------------------------------------------------
{
  use('A');
  ok('a made-up length is refused', (await MP.createGame({ them: { code: 'ANABB', name: 'Ana' }, len: '75' })).reason === 'bad-len');
  ok('challenging someone not let online is refused', (await MP.createGame({ them: { code: 'CCCCC', name: 'Cee' } })).reason === 'them-not-approved');
  ok('challenging yourself is refused', (await MP.createGame({ them: { code: 'MATTA', name: 'Matt' } })).reason === 'bad-opponent');
  use('C');
  ok('a player not let online cannot challenge', (await MP.createGame({ them: { code: 'ANABB', name: 'Ana' } })).reason === 'not-approved');
}

// --- the launcher bubble ---------------------------------------------------------------------------
{
  const AL = await import('../chinchon/js/alert.js');
  const pause = () => new Promise((r) => setTimeout(r, 3));
  use('A');
  const r = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const gid = r.id;
  const one = async () => AL.decideAlert((await MP.readMyGames()).filter((x) => x.id === gid), MP.readSeen(), MP.readUnseen());
  await pause(); await playTurn(gid, 'a');
  use('A');
  ok('after your own turn: no bubble on your launcher', !(await one()));
  use('B');
  ok('the receiver gets a challenge bubble', (await one() || {}).kind === 'challenge');
  await pause(); await playTurn(gid, 'b');
  use('A');
  ok('they played back: "Your turn"', (await one() || {}).kind === 'turn');
  g = await MP.readGame(gid);
  const [dr] = await turnEntries(g, 'a');
  await pause(); await MP.appendLog(gid, g.log.length, [dr]);
  ok('drawn but not discarded: still "Your turn"', (await one() || {}).kind === 'turn');
  ok('myTurnCount counts it', (await AL.check()) && AL.myTurnCount() >= 1);
}

// Structural.
const rules = JSON.parse(readFileSync('./database.rules.json', 'utf8'));
ok('`chinchon` is in database.rules.json, signed-in read and write', rules.rules.chinchon && rules.rules.chinchon['.read'] === 'auth != null' && rules.rules.chinchon['.write'] === 'auth != null');
ok('`chinchon` is in the backup branch list', /\n\s*'chinchon',/.test(readFileSync('./backups/rtdb-backup.mjs', 'utf8')));
const mpSrc = readFileSync('./chinchon/js/mp.js', 'utf8');
ok('challenges never call recordHeadToHead', !/recordHeadToHead\s*\(/.test(mpSrc));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
