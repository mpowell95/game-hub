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
  update: async (r, patch) => { if (faultOn && faultOn(r.path)) throw new Error('offline'); for (const k of Object.keys(patch)) setAt(r.path + '/' + k, patch[k]); },
};
let faultOn = null;   // (path) => true makes that write throw, like a phone losing signal mid-turn
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

/** A match in the shape every challenge had BEFORE own-lineup challenges (2026-10-13): no `starter`,
 *  no `pick`, the challenger kicks off and only their row exists until their first turn is over.
 *  Most checks below run on this shape, which is also the proof such matches still play. */
async function legacyGame({ them, goals, forms } = {}) {
  const r = await MP.createGame({ them, goals, form: forms ? forms[0] : undefined });
  if (!r.ok) return r;
  setAt(`flicksoccer/games/${r.id}/starter`, null);
  setAt(`flicksoccer/games/${r.id}/pick`, null);
  if (forms) setAt(`flicksoccer/games/${r.id}/forms`, forms);
  setAt(`flicksoccer/index/${them.code}/${r.id}`, null);
  r.game = await MP.readGame(r.id);
  return r;
}

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
let res = await legacyGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, goals: 1 });
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

// Line-ups ride the document: both phones replay the same start, and a match from before reads balanced.
{
  const g = { goals: 2, forms: ['attack', 'attack'], log: [] };
  const m = MP.buildMatch(g);
  ok('a challenge\'s line-up is replayed on both sides', m.b[4].y === E.FORMATIONS.attack[3][1] && m.b[9].y === E.H - E.FORMATIONS.attack[3][1]);
  ok('a challenge with no line-up reads balanced', MP.formsOfGame({}).join() === 'balanced,balanced' && MP.formsOfGame({ forms: ['x', 1] }).join() === 'balanced,balanced');
}

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
res = await legacyGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, forms: ['diamond', 'diamond'] });
const id2 = res.id;
ok('a challenge stores its line-up', res.ok && res.game.forms.join() === 'diamond,diamond' && getAt(`flicksoccer/games/${id2}`).forms.join() === 'diamond,diamond');
res = await MP.appendLog(id2, 0, [straight('a')]);
ok('...and a flick from that line-up is accepted', res.ok && res.game.log.length === 1, JSON.stringify(res));
use('B');
// She ANSWERS it first (one flick): from then on giving up is a resignation, not a decline.
await MP.appendLog(id2, 1, [straight('b')]);
res = await MP.resignGame(id2);
ok('resigning hands the other person the win', res.ok && res.game.over.winner === 'a' && res.game.over.why === 'resign');
ok('...and both rows record it', getAt(`flicksoccer/index/MATTA/${id2}`).result === 'won' && getAt(`flicksoccer/index/MATTA/${id2}`).why === 'resign');

// A challenge resigned before delivery does not reach the other person.
use('A');
res = await legacyGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
const id3 = res.id;
await MP.resignGame(id3);
ok('a never-delivered challenge, given up, is called off for the other person too', !getAt(`flicksoccer/index/ANABB/${id3}`) || getAt(`flicksoccer/index/ANABB/${id3}`).result === 'cancelled');
ok('a made-up goal target is refused', (await MP.createGame({ them: { code: 'ANABB', name: 'Ana' }, goals: 7 })).reason === 'bad-goals');
ok('a match with no goal target reads as 2', MP.validateGame({ a: { code: 'MATTA' }, b: { code: 'ANABB' } }).goals === 2);

// Records.
const rec = MP.recordsFrom(await MP.readMyGames(), 'MATTA');
ok('records: one opponent, per code', rec.opponents.length === 1 && rec.opponents[0].played === rec.finished.length, JSON.stringify(rec.opponents));

// The outbox keeps flicks until the server has them.
use('A');
res = await legacyGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
MP.savePending(res.id, 0, [straight('a')]);
ok('a pending flick is kept on the phone', !!MP.pendingFor(res.id));
ok('...and sent by the drain', (await MP.drainOutbox(res.id)) === 1 && !MP.pendingFor(res.id) && (await MP.readGame(res.id)).log.length === 1);

// The launcher bubble says "Your turn" for as long as it IS your turn.
{
  const pause = () => new Promise((r) => setTimeout(r, 3));
  use('A');
  let r = await legacyGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
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

// Bug-hunt fixes (2026-10-11).
{
  // The log lands but the other person's row does not: the retry must still tell them.
  use('A');
  const c = await legacyGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  faultOn = (path) => path.startsWith('flicksoccer/index/ANABB/');
  const r1 = await MP.appendLog(c.id, 0, [straight('a')]);
  faultOn = null;
  ok('a dropped row write is reported retryable', !r1.ok && r1.retryable, JSON.stringify(r1));
  ok('...the flick itself did land', getAt(`flicksoccer/games/${c.id}/log/0000`) && !getAt(`flicksoccer/index/ANABB/${c.id}`));
  const r2 = await MP.appendLog(c.id, 0, [straight('a')]);
  ok('the retry writes the row it missed, without a second flick', r2.ok && (getAt(`flicksoccer/index/ANABB/${c.id}`) || {}).yourTurn === true
    && Object.keys(getAt(`flicksoccer/games/${c.id}/log`)).length === 1);

  // A resign whose rows did not land: tapping Resign again tells the other person.
  use('B');
  await MP.appendLog(c.id, 1, [straight('b')]);       // she answers first, so this is a real resignation
  faultOn = (path) => path.startsWith('flicksoccer/index/MATTA/');
  const q1 = await MP.resignGame(c.id);
  faultOn = null;
  ok('a resign whose row write failed is retryable', !q1.ok && q1.retryable);
  const q2 = await MP.resignGame(c.id);
  use('A');
  ok('...and the retry tells them', q2.ok && (getAt(`flicksoccer/index/MATTA/${c.id}`) || {}).over === true);

  // A challenge called off before it was ever delivered: no row for them, no loss, not listed.
  const d = await legacyGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const statsBefore = stores.A.get('gamehub.stats');
  const rr = await MP.resignGame(d.id);
  ok('resigning an undelivered challenge calls it off', rr.ok && rr.cancelled && !getAt(`flicksoccer/index/ANABB/${d.id}`)
    && getAt(`flicksoccer/index/MATTA/${d.id}`).ended === 'cancelled', JSON.stringify(rr));
  // Since 2026-10-13 it IS listed (the hub's Challenges screen says "Cancelled"), as finished with no
  // result, and it is in no record.
  const dl = (await MP.readMyGames()).find((x) => x.id === d.id);
  ok('...it is finished with no result, in no record, nothing recorded', dl && dl.over && dl.ended === 'cancelled' && dl.result === null
    && !MP.recordsFrom([dl], 'MATTA').finished.length && stores.A.get('gamehub.stats') === statsBefore);
  MP.recordFinished(await MP.readMyGames());
  ok('...and never counted', !MP.readLedger().has(d.id));

  // The outbox only gives up on a flick when the MATCH refuses it.
  MP.savePending(d.id, 0, [straight('a')]);
  await MP.drainOutbox();
  ok('a flick for a finished match is dropped from the outbox', !MP.pendingFor(d.id));
  const e = await legacyGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  MP.savePending(e.id, 0, [straight('a')]);
  faultOn = () => true;
  await MP.drainOutbox();
  faultOn = null;
  ok('a flick that failed for want of signal stays queued', !!MP.pendingFor(e.id));
  ok('...and goes out on the next drain', (await MP.drainOutbox()) === 1 && !MP.pendingFor(e.id) && getAt(`flicksoccer/games/${e.id}/log/0000`));
  ok('NEVER_SENDABLE never names a phone-side reason', !['offline', 'denied', 'dev-origin-blocked', 'no-player-code'].some((x) => MP.NEVER_SENDABLE.includes(x)));
}

// Own-lineup challenges (2026-10-13): the challenger picks theirs, the other person sees it, picks
// theirs and kicks off.
{
  use('A');
  const c = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, goals: 2, form: 'attack' });
  ok('a new challenge waits for Ana\'s line-up, and she kicks off', c.ok && c.game.pick === 'b' && c.game.starter === 1 && c.game.turn === 'b' && c.game.forms[0] === 'attack');
  const rowB = getAt(`flicksoccer/index/ANABB/${c.id}`);
  ok('it reaches Ana at once, as her turn, from Matt', rowB && rowB.yourTurn === true && rowB.lastBy === 'them');
  ok('Matt cannot flick first', !(await MP.appendLog(c.id, 0, [straight('a')])).ok);
  use('B');
  ok('Ana cannot flick before she has picked', (await MP.appendLog(c.id, 0, [straight('b')])).reason === 'not-picked');
  const p = await MP.pickLineup(c.id, 'defend');
  ok('Ana picks her own line-up', p.ok && !p.game.pick && p.game.forms.join() === 'attack,defend');
  ok('...once (a retry changes nothing)', (await MP.pickLineup(c.id, 'diamond')).ok && (await MP.readGame(c.id)).forms[1] === 'defend');
  const m0 = MP.buildMatch(p.game);
  ok('each side starts in its own line-up', m0.b[4].y === E.FORMATIONS.attack[3][1] && m0.b[9].y === E.H - E.FORMATIONS.defend[3][1] && m0.turn === 1);
  const f1 = await MP.appendLog(c.id, 0, [straight('b')]);
  ok('Ana kicks off, then it is Matt\'s turn', f1.ok && f1.game.turn === 'a');
  use('A');
  ok('Matt\'s row says it is his turn', getAt(`flicksoccer/index/MATTA/${c.id}`).yourTurn === true);
  ok('both phones replay the same pitch', JSON.stringify(MP.buildMatch(await MP.readGame(c.id)).b) === JSON.stringify(MP.buildMatch(f1.game).b));
  ok('Matt cannot pick Ana\'s line-up', (await MP.pickLineup(c.id, 'attack')).reason === 'not-your-game');

  // Offense and defense line-ups (2026-10-14): each side sets both; whoever kicks off stands in
  // their offense line-up, the other in their defense one, at the start and after every goal.
  {
    use('A');
    const c2 = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, goals: 2, pair: ['attack', 'defend'] });
    const raw2 = getAt(`flicksoccer/games/${c2.id}`);
    ok('a challenge stores the challenger\'s offense and defense line-ups', c2.ok && raw2.pairs.a.join() === 'attack,defend');
    ok('...and Ana kicks off, so Matt stands in his DEFENSE line-up', c2.game.forms[0] === 'defend' && c2.game.pick === 'b');
    use('B');
    const p2 = await MP.pickLineup(c2.id, ['diamond', 'balanced']);
    ok('Ana adds hers, and stands in her OFFENSE line-up to kick off', p2.ok && p2.game.forms.join() === 'defend,diamond'
      && JSON.stringify(p2.game.pairs) === JSON.stringify([['attack', 'defend'], ['diamond', 'balanced']]));
    const m2 = MP.buildMatch(p2.game);
    E.settle(m2, 1);   // Ana scores: Matt kicks off in HIS offense line-up, Ana in her defense one
    ok('after a goal the line-ups follow the kick-off', m2.forms.join() === 'attack,balanced' && m2.b[4].y === E.FORMATIONS.attack[3][1]);
    const f2 = await MP.appendLog(c2.id, 0, [straight('b')]);
    ok('a flick is accepted and replays the same on both phones', f2.ok && JSON.stringify(MP.buildMatch(await MP.readGame(c2.id)).b) === JSON.stringify(MP.buildMatch(f2.game).b));
    ok('a match from before line-up pairs reads none', MP.pairsOfGame({ forms: ['attack', 'defend'] }) === null);
    use('A');
  }

  // Aiming help chosen by the challenger (2026-10-15): stored on the match, read by both phones.
  {
    use('A');
    const h = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, goals: 2, pair: ['attack', 'defend'], aids: 'easy' });
    ok('a challenge stores its aiming help', h.ok && h.game.aids === 'easy' && getAt(`flicksoccer/games/${h.id}`).aids === 'easy');
    use('B');
    ok('...and Ana\'s phone reads the same', (await MP.readGame(h.id)).aids === 'easy');
    use('A');
    const j = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, aids: 'cheat' });
    ok('a junk aiming help is stored as Medium', j.ok && j.game.aids === 'medium');
    ok('a match from before reads Medium, as it played', MP.aidsOfGame({}) === 'medium' && MP.aidsOfGame({ aids: 'hard' }) === 'hard');
  }

  // Declined (or called off) before anybody flicked: counts for nobody, listed for nobody, no push.
  const d = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, form: 'diamond' });
  use('B');
  const q = await MP.resignGame(d.id);
  ok('Ana declining before she plays calls it off', q.ok && q.cancelled && q.game.over.why === 'declined'
    && getAt(`flicksoccer/index/MATTA/${d.id}`).ended === 'declined' && getAt(`flicksoccer/index/ANABB/${d.id}`).ended === 'declined');
  MP.recordFinished(await MP.readMyGames());
  const dr = (await MP.readMyGames()).find((x) => x.id === d.id);
  ok('...it is finished with no result, in no record, and never counted', dr && dr.over && dr.result === null
    && !MP.recordsFrom([dr], 'ANABB').finished.length && !MP.readLedger().has(d.id));
  // Picking a line-up is not an answer: she can still decline after it, and it still expires.
  use('A');
  const pk = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, form: 'attack' });
  ok('a new challenge carries lapse and waits on Ana with a 3-day deadline', getAt(`flicksoccer/games/${pk.id}`).lapse === true
    && getAt(`flicksoccer/index/ANABB/${pk.id}`).open === 'got' && getAt(`flicksoccer/index/MATTA/${pk.id}`).open === 'sent'
    && getAt(`flicksoccer/index/ANABB/${pk.id}`).expires > 0);
  const cn = await MP.cancelGame(pk.id);
  ok('Matt cancels it before she has answered', cn.ok && cn.game.over.why === 'cancelled' && getAt(`flicksoccer/index/ANABB/${pk.id}`).ended === 'cancelled');
  use('B');
  ok('...and she can no longer pick or flick', (await MP.pickLineup(pk.id, 'defend')).reason === 'already-over');
  // Expired: three days on her with no answer.
  use('A');
  const { ANSWER_MS } = await import('./js/challenge-life.js');
  const ex = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, form: 'attack' });
  for (const pth of [`flicksoccer/games/${ex.id}`, `flicksoccer/index/MATTA/${ex.id}`, `flicksoccer/index/ANABB/${ex.id}`]) {
    const o = getAt(pth); o.updated -= ANSWER_MS + 1000; if (o.expires) o.expires -= ANSWER_MS + 1000;
  }
  use('B');
  const er = (await MP.readMyGames()).find((x) => x.id === ex.id);
  ok('an unanswered challenge 3 days old reads as expired', er && er.ended === 'expired' && er.over && !er.yourTurn);
  ok('...her late line-up is refused', (await MP.pickLineup(ex.id, 'defend')).reason === 'expired');
  // Answered: her first flick clears open on both rows.
  use('A');
  const an = await MP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' }, form: 'attack' });
  use('B');
  await MP.pickLineup(an.id, 'defend');
  ok('picking a line-up does not answer it', getAt(`flicksoccer/index/ANABB/${an.id}`).open === 'got');
  await MP.appendLog(an.id, 0, [straight('b')]);
  ok('her first flick does: both rows stop saying open', getAt(`flicksoccer/index/ANABB/${an.id}`).open === '' && getAt(`flicksoccer/index/MATTA/${an.id}`).open === '');
  use('A');
  ok('...and it can no longer be cancelled', (await MP.cancelGame(an.id)).reason === 'accepted');
  use('B');
  const { decideFlickSoccer } = await import('./functions/decide.js');
  ok('...and nobody is notified', decideFlickSoccer({ code: 'MATTA', id: d.id, before: { yourTurn: false }, after: getAt(`flicksoccer/index/MATTA/${d.id}`) }) === null);
  use('A');
  ok('a match from before own-lineup challenges still has the challenger kick off', MP.starterOfGame({}) === 0 && MP.validateGame({ a: { code: 'MATTA' }, b: { code: 'ANABB' } }).pick === null);
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
