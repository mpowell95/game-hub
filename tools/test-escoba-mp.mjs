import { fileURLToPath as __toolsF2P } from 'node:url';
// test-escoba-mp.mjs - Escoba challenges (escoba/js/mp.js), headless (2026-10-18).
//
// 1. The REPLAY (mp.js's synchronous driver) against the real async engine (escoba/js/game.js,
//    driven by agents, exactly as the match screen drives it): identical snapshots at every turn,
//    over many random matches of every length and both decks.
// 2. The WRITE path end to end, against an in-memory database handed in through mp.js's test seam,
//    with two profiles taking turns on one "server": a whole one-hand match and a whole multi-hand
//    match, both phones replaying to the same state; validateGame refusing tampered logs;
//    cancel / decline / resign / expire; counted once; the outbox; the online gate.
// 3. Structural: `escoba` is in database.rules.json and the backup list; the hub and the
//    Multiplayer screen are wired.
//   node tools/test-escoba-mp.mjs
import { readFileSync } from 'node:fs';
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const src = (p) => readFileSync(`${__ROOT_DIR}/${p}`, 'utf8');

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
stores.C.set('gamehub.profile', JSON.stringify({ name: 'Cee', emoji: '🐸', playerId: 'CEECC' }));
// Matt and Ana may play online (js/online-gate.js); Cee may not.
const ONLINE = JSON.stringify({ online: { MATTA: true, ANABB: true } });
for (const s of [stores.A, stores.B, stores.C]) s.set('gamehub.adminConfig.v1', ONLINE);

const MP = await import('../escoba/js/mp.js');
const { Game, makePlayer } = await import('../escoba/js/game.js');
const { captureOptions } = await import('../escoba/js/deck.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

// A tiny seeded rng for picking moves.
function rngFrom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** A random LEGAL move for this hand and table: capture when the card can (compulsory), else lay. */
function pickMove(hand, table, rnd) {
  const card = hand[Math.floor(rnd() * hand.length)];
  const opts = captureOptions(table, card);
  const take = opts.length ? opts[Math.floor(rnd() * opts.length)] : [];
  return { cardId: card.id, captureIds: take.map((c) => c.id) };
}
const strip = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.nextTurn; for (const p of c.players) { p.name = ''; p.avatar = ''; p.isHuman = false; p.difficulty = null; } return c; };

// --- 1. the replay equals the engine ----------------------------------------------------------------
async function engineMatch({ len, deck, seed }, rnd) {
  const players = [0, 1].map((id) => makePlayer({ id, name: '', avatar: '' }));
  const log = [];
  let mismatch = null, turns = 0;
  const target = { 1: 1, 11: 11, 21: 21 }[len];
  const g = new Game({ players, config: { targetScore: target, deckMode: deck, presetDeck: MP.deckIds(seed, 1, deck) } });
  g.dealer = 1;
  let draw = false, escobaEvents = 0;
  g.onEvent = async (type, payload) => {
    if (type === 'play' && payload.escoba) escobaEvents++;
    if (type === 'roundScored') {
      if (!g.winner && len === '1') { draw = true; g.abort(); return; }
      g.config.presetDeck = MP.deckIds(seed, g.round + 1, deck);
    }
  };
  for (const p of players) {
    p.agent = {
      chooseMove: async (view) => {
        turns++;
        const d = MP.replayTo({ len, deck, seed, log });
        if (!mismatch) {
          if (d.g._nextTurn !== p.id) mismatch = `turn ${turns}: engine asks seat ${p.id}, replay says ${d.g._nextTurn}`;
          else if (JSON.stringify(strip(d.g.snapshot())) !== JSON.stringify(strip(g.snapshot()))) mismatch = `turn ${turns}: snapshots differ`;
        }
        const mv = pickMove(view.hand, view.table, rnd);
        log.push({ by: p.id === 0 ? 'a' : 'b', c: mv.cardId, k: mv.captureIds.slice().sort().join(',') });
        return mv;
      },
    };
  }
  await g.playMatch();
  const d = MP.replayTo({ len, deck, seed, log });
  const engineOver = draw ? { winner: 'draw' } : g.winner ? { winner: g.winner.id === 0 ? 'a' : 'b' } : null;
  return { log, mismatch, d, engineOver, g, escobaEvents };
}
{
  let matches = 0, bad = null, plays = 0, draws = 0, multi = 0, overBad = null;
  const lens = ['1', '11', '21'];
  for (let i = 0; i < 60; i++) {
    const len = lens[i % 3];
    const deck = i % 2 ? 'american' : 'spanish';
    const seed = 'seed' + (1000 + i).toString(36) + 'x';
    const r = await engineMatch({ len, deck, seed }, rngFrom(i + 7));
    matches++; plays += r.log.length;
    if (r.mismatch && !bad) bad = `${len}/${deck}/${seed}: ${r.mismatch}`;
    if (!r.d.over || !r.engineOver || r.d.over.winner !== r.engineOver.winner) overBad = overBad || `${len}/${seed}: replay ${JSON.stringify(r.d.over)} engine ${JSON.stringify(r.engineOver)}`;
    if (r.d.over && r.d.over.winner === 'draw') draws++;
    if (r.d.g.round > 1) multi++;
  }
  ok(`the replay matches the engine at every turn (${matches} random matches, ${plays} plays)`, !bad, bad);
  ok('...and both reach the same result', !overBad, overBad);
  ok('the sample includes multi-hand matches and one-hand draws', multi > 10 && draws > 0, `multi ${multi}, draws ${draws}`);
}
{
  const a = MP.deckIds('abcdefgh', 1, 'spanish'), b = MP.deckIds('abcdefgh', 1, 'spanish'), c = MP.deckIds('abcdefgh', 2, 'spanish');
  ok('a deal is the same on every phone, and different every round', a.join() === b.join() && a.join() !== c.join() && new Set(a).size === 40);
  ok('the American deck deals its own cards', MP.deckIds('abcdefgh', 1, 'american').includes('o8') && !a.includes('o8'));
  const d = MP.newReplay({ len: '21', deck: 'spanish', seed: 'abcdefgh' });
  ok('the challenger (seat 0, side a) plays first', d.g._nextTurn === 0 && d.g.dealer === 1);
}

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

const ANA = { code: 'ANABB', name: 'Ana', emoji: '🦊' };
const phoneOf = (side, g) => (g.a.code === 'MATTA' ? (side === 'a' ? 'A' : 'B') : (side === 'a' ? 'B' : 'A'));
/** The next legal play for whoever's turn it is, from THAT phone's own replay of the match. */
function nextPlay(game, rnd) {
  const d = MP.replayTo(game);
  const p = d.g.players[d.g._nextTurn];
  const mv = pickMove(p.hand, d.g.table, rnd);
  return { by: game.turn, c: mv.cardId, k: mv.captureIds.slice().sort().join(',') };
}
/** Play a match to its end, alternating phones; every write verified by the server's own replay. */
async function playOut(id, rnd, max = 4000) {
  let steps = 0, g = null, same = true;
  use('A'); g = await MP.readGame(id);
  while (g && !g.over && steps++ < max) {
    use(phoneOf(g.turn, g));
    const e = nextPlay(g, rnd);
    const r = await MP.appendLog(id, g.log.length, [e]);
    if (!r.ok) return { ok: false, reason: r.reason, g };
    g = r.game;
    // The OTHER phone reads the same document and must replay it to the very same state.
    use(phoneOf(e.by, g) === 'A' ? 'B' : 'A');
    const g2 = await MP.readGame(id);
    if (JSON.stringify(MP.replayTo(g2).g.snapshot()) !== JSON.stringify(MP.replayTo(g).g.snapshot())) same = false;
  }
  return { ok: true, g, same };
}
const other = (s) => (s === 'a' ? 'b' : 'a');

// --- 2a. a whole ONE-HAND match ------------------------------------------------------------------
use('A');
let res = await MP.createGame({ them: ANA, len: '1', deck: 'spanish' });
ok('the challenger can create a one-hand match', res.ok && res.game.len === '1' && res.game.turn === 'a', JSON.stringify(res));
const id1 = res.id;
ok('created: only the challenger has a row until the first turn is over',
  !!getAt(`escoba/index/MATTA/${id1}`) && !getAt(`escoba/index/ANABB/${id1}`));
ok('the match document holds config, a seed and no hands', (() => { const d = getAt(`escoba/games/${id1}`); return d.len === '1' && d.deck === 'spanish' && /^[a-z0-9]{16}$/.test(d.seed) && !('hands' in d) && d.lapse === true; })());
let g = await MP.readGame(id1);
let first = nextPlay(g, rngFrom(99));
res = await MP.appendLog(id1, 0, [first]);
ok('the first play lands, verified, and the turn passes to Ana', res.ok && res.game.log.length === 1 && res.game.turn === 'b');
const anaRow = getAt(`escoba/index/ANABB/${id1}`);
ok('the challenge reaches Ana as HER turn, written by the other side, with the length',
  anaRow && anaRow.yourTurn === true && anaRow.lastBy === 'them' && anaRow.name === 'Matt' && anaRow.len === '1' && anaRow.open === 'got');
ok('a retry of a play already there writes nothing twice', (await MP.appendLog(id1, 0, [first])).ok && Object.keys(getAt(`escoba/games/${id1}/log`)).length === 1);
ok('Matt cannot play on Ana\'s turn', (await MP.appendLog(id1, 1, [{ ...nextPlay(res.game, rngFrom(3)), by: 'a' }])).ok === false);
use('B');
ok('a stale base is a conflict, never an overwrite', (await MP.appendLog(id1, 0, [nextPlay(res.game, rngFrom(4))])).reason === 'moved-on');
let out = await playOut(id1, rngFrom(5));
ok('a whole one-hand match plays to its end, both phones replaying the same state at every play', out.ok && out.g.over && out.same, JSON.stringify(out.reason));
ok('...one hand is 36 plays and one round', out.g.log.length === 36 && out.g.round === 1, `${out.g.log.length} plays, round ${out.g.round}`);
{
  const s = out.g.scores;
  const want = s.a === s.b ? 'draw' : s.a > s.b ? 'a' : 'b';
  ok('...most points wins (a tie is a draw)', out.g.over.winner === want, JSON.stringify({ s, over: out.g.over }));
  const ra = getAt(`escoba/index/MATTA/${id1}`), rb = getAt(`escoba/index/ANABB/${id1}`);
  ok('both rows say it is over, with opposite results', ra.over && rb.over
    && (want === 'draw' ? ra.result === 'draw' && rb.result === 'draw' : (ra.result === (want === 'a' ? 'won' : 'lost') && rb.result === (want === 'b' ? 'won' : 'lost'))));
  ok('no more plays after it is over', (await MP.appendLog(id1, out.g.log.length, [{ by: 'a', c: 'o1' }])).ok === false);
}
// A one-hand draw is a result, on a hand-built tie (found by searching seeds with random play).
{
  let tieDoc = null;
  for (let i = 0; i < 400 && !tieDoc; i++) {
    const seed = 'tie' + i.toString(36).padStart(6, '0');
    const rnd = rngFrom(i * 31 + 1);
    const log = [];
    const d = MP.newReplay({ len: '1', deck: 'spanish', seed });
    while (!d.over) {
      const p = d.g.players[d.g._nextTurn];
      const mv = pickMove(p.hand, d.g.table, rnd);
      const e = { by: p.id ? 'b' : 'a', c: mv.cardId, k: mv.captureIds.slice().sort().join(',') };
      MP.applyPlay(d, e); log.push(e);
    }
    if (d.over.winner === 'draw') tieDoc = { a: { code: 'MATTA' }, b: { code: 'ANABB' }, len: '1', seed, log: Object.fromEntries(log.map((e, j) => [String(j).padStart(4, '0'), e])) };
  }
  const tg = tieDoc && MP.validateGame(tieDoc);
  ok('a one-hand match level on points is a DRAW', tg && tg.over && tg.over.winner === 'draw' && tg.over.why === 'tie' && tg.scores.a === tg.scores.b);
  ok('...and a draw it did not produce is refused', tieDoc && MP.validateGame({ ...tieDoc, over: { winner: 'a', why: 'target' } }) === null);
}

// Counting once per phone, as an 'mp' result with escobas, NEVER head-to-head.
use('B');
let rowsB = await MP.readMyGames();
ok('Ana\'s list has the finished match', rowsB.length === 1 && rowsB[0].over && MP.RESULTS.includes(rowsB[0].result));
ok('a finished match is counted on her phone once', MP.recordFinished(rowsB) === 1 && MP.recordFinished(rowsB) === 0);
{
  const st = JSON.parse(stores.B.get('gamehub.stats') || '{}');
  const es = st.games && st.games.escoba;
  const want = rowsB[0].result;
  ok('...in the mp bucket of her escoba stats', es && es.byDiff.mp.played === 1 && es.byDiff.mp.won === (want === 'won' ? 1 : 0) && es.byDiff.mp.lost === (want === 'lost' ? 1 : 0), JSON.stringify(es && es.byDiff));
  ok('...with her escobas from the match', es && es.es.escobas === rowsB[0].mineEsc, JSON.stringify({ es: es && es.es, row: rowsB[0].mineEsc }));
  ok('...and no head-to-head record (live rooms only)', !st.h2h || !st.h2h.escoba);
  ok('...queued for her Game Over popup', MP.readUnseen().includes(id1));
  ok('countResult refuses a second count', MP.countResult(id1, true, 3) === false);
}

// --- 2b. a whole match to 11 (several hands) -------------------------------------------------------
use('A');
res = await MP.createGame({ them: ANA, len: '11', deck: 'american' });
const id2 = res.id;
out = await playOut(id2, rngFrom(77));
ok('a whole match to 11 plays to its end over several hands, both phones identical', out.ok && out.g.over && out.same && out.g.round > 1, JSON.stringify({ r: out.g && out.g.round, reason: out.reason }));
{
  const s = out.g.scores, w = out.g.over.winner;
  ok('...the winner reached 11 with the lead, or the other was whitewashed', out.g.over.why === 'whitewash' || (s[w] >= 11 && s[w] > s[other(w)]), JSON.stringify({ s, over: out.g.over }));
  ok('...the deck mode rode along', out.g.deck === 'american');
}
// Rounds alternate who leads: the second round is led by side b.
{
  const g2 = await MP.readGame(id2);
  const d = MP.newReplay(g2);
  let i = 0;
  while (d.g.round === 1) MP.applyPlay(d, g2.log[i++]);
  ok('the second hand is led by the other player (the dealer moves on)', g2.log[i].by === 'b' && g2.log[i - 1].by === 'b');
}

// --- 2c. a tampered log is refused whole -----------------------------------------------------------
{
  const doc = clone(getAt(`escoba/games/${id2}`));
  const keys = Object.keys(doc.log).sort();
  const t1 = clone(doc); t1.log[keys[3]].by = t1.log[keys[3]].by === 'a' ? 'b' : 'a';
  ok('a play out of turn makes the whole match invalid', MP.validateGame(t1) === null);
  const t2 = clone(doc); t2.log[keys[5]].c = t2.log[keys[5]].c === 'o1' ? 'c1' : 'o1';
  ok('a card that was not in the hand is refused', MP.validateGame(t2) === null);
  // A capture the rules do not allow (or a lay when a capture is compulsory).
  const t3 = clone(doc);
  const kIdx = keys.find((k) => t3.log[k].k);
  if (kIdx) delete t3.log[kIdx].k;
  ok('laying a card that had to capture is refused', kIdx && MP.validateGame(t3) === null);
  const t4 = clone(doc); t4.over = { winner: t4.over.winner === 'a' ? 'b' : 'a', why: 'target', at: 1 };
  ok('a claimed win the log never produced is refused', MP.validateGame(t4) === null);
  const t5 = clone(doc); t5.seed = 'zzzzzzzzzzzz';
  ok('the same plays under a different deal are refused', MP.validateGame(t5) === null);
  const t6 = clone(doc); t6.len = '15';
  ok('a made-up length is refused', MP.validateGame(t6) === null);
}

// --- 2d. resign, cancel, decline, expire (js/challenge-life.js) ------------------------------------
{
  const { ANSWER_MS } = await import('../js/challenge-life.js');
  const playOne = async (id) => { const gg = await MP.readGame(id); use(phoneOf(gg.turn, gg)); return MP.appendLog(id, gg.log.length, [nextPlay(gg, rngFrom(gg.log.length + 11))]); };

  use('A');
  let r = await MP.createGame({ them: ANA, len: '21' });
  const rid = r.id;
  await playOne(rid); await playOne(rid);            // Matt, then Ana answers
  use('B');
  r = await MP.resignGame(rid);
  ok('once answered, resigning hands the other person the win', r.ok && !r.cancelled && r.game.over.winner === 'a' && r.game.over.why === 'resign');
  ok('...both rows record it', getAt(`escoba/index/MATTA/${rid}`).result === 'won' && getAt(`escoba/index/ANABB/${rid}`).result === 'lost' && getAt(`escoba/index/MATTA/${rid}`).why === 'resign');
  ok('...the log is kept', Object.keys(getAt(`escoba/games/${rid}/log`)).length === 2);

  use('A');
  r = await MP.createGame({ them: ANA, len: '11' });
  const cx = r.id;
  await playOne(cx);
  ok('delivered: Matt\'s row says sent, Ana\'s says got, both with a deadline 3 days on',
    getAt(`escoba/index/MATTA/${cx}`).open === 'sent' && getAt(`escoba/index/ANABB/${cx}`).open === 'got'
    && getAt(`escoba/index/ANABB/${cx}`).expires === getAt(`escoba/games/${cx}`).updated + ANSWER_MS);
  use('A');
  r = await MP.cancelGame(cx);
  ok('the sender cancels it', r.ok && r.cancelled && r.game.over.winner === 'none' && r.game.over.why === 'cancelled');
  const ar = getAt(`escoba/index/ANABB/${cx}`);
  ok('...both rows say cancelled, stored over:false so no push function fires', ar.ended === 'cancelled' && ar.over === false && ar.yourTurn === false && !('result' in ar));
  use('B');
  const rb = (await MP.readMyGames()).find((x) => x.id === cx);
  ok('...Ana\'s list reads it as finished, no result, and nothing is counted', rb && rb.over && rb.ended === 'cancelled' && rb.result === null && MP.recordFinished([rb]) === 0);
  ok('...no play can be made into it', !(await MP.appendLog(cx, 1, [{ by: 'b', c: 'o1' }])).ok);

  use('A');
  r = await MP.createGame({ them: ANA, len: '11' });
  const dx = r.id;
  await playOne(dx);
  use('B');
  r = await MP.resignGame(dx);
  ok('the receiver giving up an unanswered challenge DECLINES it (nobody wins)', r.ok && r.cancelled && r.game.over.why === 'declined');
  ok('...Matt\'s row says declined', getAt(`escoba/index/MATTA/${dx}`).ended === 'declined');

  use('A');
  r = await MP.createGame({ them: ANA, len: '11' });
  const ax = r.id;
  await playOne(ax); await playOne(ax);
  ok('one play from the receiver answers it: the rows stop saying open at once',
    getAt(`escoba/index/ANABB/${ax}`).open === '' && getAt(`escoba/index/MATTA/${ax}`).open === '' && getAt(`escoba/index/ANABB/${ax}`).expires === 0);
  use('A');
  r = await MP.cancelGame(ax);
  ok('...and can no longer be cancelled', !r.ok && r.reason === 'accepted');
  getAt(`escoba/games/${ax}`).over = { winner: 'none', why: 'cancelled', at: 1 };
  const gx = await MP.readGame(ax);
  ok('a cancel that raced the first answer is void: the match plays on', gx && !gx.over);
  getAt(`escoba/games/${ax}`).over = null;

  use('A');
  r = await MP.createGame({ them: ANA, len: '21' });
  const ex = r.id;
  await playOne(ex);
  const doc = getAt(`escoba/games/${ex}`);
  const lateG = await MP.readGame(ex);
  ok('lifeOf: waiting, not yet expired; expired after 3 days', MP.lifeOf(lateG).waiting && !MP.lifeOf(lateG).expired && MP.lifeOf(lateG, doc.updated + ANSWER_MS).expired);
  const back3 = (o) => { o.updated -= ANSWER_MS + 1000; if (o.expires) o.expires -= ANSWER_MS + 1000; };
  back3(doc); back3(getAt(`escoba/index/MATTA/${ex}`)); back3(getAt(`escoba/index/ANABB/${ex}`));
  use('B');
  const er = (await MP.readMyGames()).find((x) => x.id === ex);
  ok('an unanswered challenge 3 days old reads as expired, finished, no result', er && er.ended === 'expired' && er.over && er.result === null && !er.yourTurn);
  const late = nextPlay(await MP.readGame(ex), rngFrom(1));
  r = await MP.appendLog(ex, 1, [late]);
  ok('...and refuses a late play', !r.ok && r.reason === 'expired');
  ok('a called-off document with an unknown why is refused', MP.validateGame({ ...clone(getAt(`escoba/games/${cx}`)), over: { winner: 'none', why: 'whatever' } }) === null);

  use('A');
  r = await MP.createGame({ them: ANA, len: '1' });
  const nd = r.id;
  r = await MP.resignGame(nd);
  ok('a never-delivered challenge given up is called off and writes no row for the other person', r.ok && r.cancelled && !getAt(`escoba/index/ANABB/${nd}`));
}

// --- 2e. records, the outbox, the online gate -------------------------------------------------------
{
  use('A');
  const rec = MP.recordsFrom(await MP.readMyGames(), 'MATTA');
  ok('records: one opponent, called-off and expired matches in no record', rec.opponents.length === 1 && rec.opponents[0].played === 3, JSON.stringify(rec.opponents));

  let r = await MP.createGame({ them: ANA, len: '11' });
  const g0 = await MP.readGame(r.id);
  const e0 = nextPlay(g0, rngFrom(8));
  MP.savePending(r.id, 0, [e0]);
  ok('a pending play is kept on the phone', !!MP.pendingFor(r.id));
  ok('...and sent by the drain', (await MP.drainOutbox(r.id)) === 1 && !MP.pendingFor(r.id) && (await MP.readGame(r.id)).log.length === 1);
  MP.savePending(r.id, 0, [e0]);
  ok('...a retry of a play that already landed is harmless', (await MP.drainOutbox(r.id)) === 1 && (await MP.readGame(r.id)).log.length === 1);

  ok('a made-up length is refused', (await MP.createGame({ them: ANA, len: '7' })).reason === 'bad-len');
  ok('a challenge to someone not allowed online is refused', (await MP.createGame({ them: { code: 'CEECC', name: 'Cee' } })).reason === 'them-not-approved');
  use('C');
  ok('a player not allowed online cannot send one', (await MP.createGame({ them: ANA })).reason === 'not-approved');
  use('A');
  ok('you cannot challenge yourself', (await MP.createGame({ them: { code: 'MATTA', name: 'Matt' } })).reason === 'bad-opponent');
}

// --- 2f. the launcher bubble -------------------------------------------------------------------------
{
  const AL = await import('../escoba/js/alert.js');
  const pause = () => new Promise((r) => setTimeout(r, 3));
  use('A');
  const r = await MP.createGame({ them: ANA, len: '21' });
  const gid = r.id;
  const one = async () => AL.decideAlert((await MP.readMyGames()).filter((x) => x.id === gid), MP.readSeen(), MP.readUnseen());
  let gg = await MP.readGame(gid);
  await pause(); await MP.appendLog(gid, 0, [nextPlay(gg, rngFrom(2))]);
  ok('after your own turn: no bubble on your launcher', !(await one()));
  use('B');
  ok('Ana sees a challenge', (await one() || {}).kind === 'challenge');
  gg = await MP.readGame(gid);
  await pause(); await MP.appendLog(gid, 1, [nextPlay(gg, rngFrom(3))]);
  use('A');
  ok('she played back: "Your turn"', (await one() || {}).kind === 'turn');
  ok('myTurnCount counts it after a check', (await AL.check()) && AL.myTurnCount() >= 1);
}

// --- 3. structural ---------------------------------------------------------------------------------
const rules = JSON.parse(src('database.rules.json'));
ok('`escoba` is in database.rules.json, signed-in read and write', rules.rules.escoba && rules.rules.escoba['.read'] === 'auth != null' && rules.rules.escoba['.write'] === 'auth != null');
ok('`escoba` is in the backup branch list', /\n\s*'escoba',/.test(src('backups/rtdb-backup.mjs')));
ok('the hub entry declares the alerts module', /id: 'escoba',[\s\S]{0,900}alerts: \(\) => import\('\.\.\/escoba\/js\/alert\.js'\)/.test(src('js/hub.js')));
ok('the Multiplayer screen reads Escoba challenges', /\n\s*escoba: \{\s*\n\s*load: \(\) => import\('\.\.\/escoba\/js\/mp\.js'\)/.test(src('js/challenges.js')));
ok('challenge chat shows in Messages', /escoba: \{ stats: 'escoba', node: 'escoba' \}/.test(src('js/game-chat-history.js')));
ok('the push trigger watches escoba/index and names the match', /ref: '\/escoba\/index\/\{code\}\/\{id\}'/.test(src('functions/index.js')) && /\{ game: 'escoba', match: id \}/.test(src('functions/index.js')));
ok('nothing in the challenge code records head-to-head', ['escoba/js/mp.js', 'escoba/js/mp-ui.js', 'escoba/js/alert.js'].every((f) => !/recordHeadToHead\(/.test(src(f))));
ok('the live-room protocol is untouched: mp.js never imports js/net.js', !/from '[^']*\/net\.js'/.test(src('escoba/js/mp.js')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
