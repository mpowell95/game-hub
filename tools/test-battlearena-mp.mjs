import { fileURLToPath as __toolsF2P } from 'node:url';
// Paths below resolve from the repo root.
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// test-battlearena-mp.mjs - Battle Arena ONLINE, headless (2026-10-24).
//
//   1. The pure half (battle-arena/js/online.js): one seed + one move list = one match on every
//      phone; the placeholder team really is never read on the challenger's first turn; the mirror.
//   2. Challenges (battle-arena/js/mp.js) end to end against an in-memory database handed in through
//      mp.js's test seam: two profiles taking turns on one "server", the game's own computer making
//      every move. Create, both drafts, alternate turns to a knockout, replay on two phones, cancel,
//      decline, resign, expire, a refused late move, the online gate, evolve as a move.
//   3. Live rooms (battle-arena/js/live.js) against a stand-in for js/net.js: two phones, moves and
//      passes (the move clock) in lockstep with a hash after each, resign, counted once.
//   4. Structural: rules, backup list, hub registry, the Multiplayer screen, push, reminder, chat.
// Never touches Firebase: every database here is a JavaScript object. Test profiles are test1 /
// DREG5 and made-up codes (root CLAUDE.md: never Matt's code or name).
//   node tools/test-battlearena-mp.mjs
import { readFileSync } from 'node:fs';
process.chdir(__ROOT_DIR);

// --- a browser-ish global: localStorage + sessionStorage, one per "phone" -----------------------
const stores = { A: new Map(), B: new Map(), C: new Map() };
let phone = 'A';
const mkStore = () => ({
  getItem: (k) => (stores[phone].has(k) ? stores[phone].get(k) : null),
  setItem: (k, v) => stores[phone].set(k, String(v)),
  removeItem: (k) => stores[phone].delete(k),
});
globalThis.localStorage = mkStore();
globalThis.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const use = (p) => { phone = p; };
stores.A.set('gamehub.profile', JSON.stringify({ name: 'test1', emoji: '🦊', playerId: 'DREG5' }));
stores.B.set('gamehub.profile', JSON.stringify({ name: 'Tester B', emoji: '🐼', playerId: 'TQWX7' }));
stores.C.set('gamehub.profile', JSON.stringify({ name: 'Tester C', emoji: '🐸', playerId: 'CCCCC' }));
// test1 (DREG5) is on the online list already; the made-up TQWX7 is let in here; CCCCC is not.
const ONLINE = JSON.stringify({ online: { TQWX7: true } });
for (const p of ['A', 'B', 'C']) stores[p].set('gamehub.adminConfig.v1', ONLINE);

const O = await import('../battle-arena/js/online.js');
const E = await import('../battle-arena/js/engine.js');
const MP = await import('../battle-arena/js/mp.js');
const L = await import('../battle-arena/js/live.js');
const { chooseMove } = await import('../battle-arena/js/cpu.js');
const { loadStats } = await import('../js/game-stats.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// --- 1. the pure half ---------------------------------------------------------------------------
const TEAMS = { a: ['emberkit', 'zapup'], b: ['sproutle', 'gloomite'] };
/** Play a whole match with the computer on both sides; returns the entries. */
function selfPlay(seed, teams, { evolveFirst = true, passEvery = 0 } = {}) {
  let s = O.startState(seed, teams);
  const out = [];
  let rngState = seed;
  const rand = () => { rngState = (rngState * 1103515245 + 12345) >>> 0; return rngState / 4294967296; };
  for (let i = 0; i < 2000 && s.winner == null; i++) {
    let mv;
    if (passEvery && i % passEvery === passEvery - 1) mv = { type: 'pass', side: s.turn };
    else {
      const evo = E.evolveOptions(s);
      mv = evolveFirst && evo.length ? { type: 'evolve', mon: evo[0] } : chooseMove(s, s.turn ? 'medium' : 'hard', rand);
      mv = { ...mv, side: s.turn };
    }
    const res = E.apply(s, mv);
    if (!res.ok) throw new Error('self-play refused ' + res.error);
    out.push(O.entryOf(mv));
    s = res.state;
  }
  return { entries: out, state: s };
}
{
  const g = selfPlay(12345, TEAMS);
  ok('self-play: a computer-vs-computer match ends with a winner', g.state.winner != null, g.entries.length);
  const r1 = O.replay(12345, TEAMS, g.entries), r2 = O.replay(12345, TEAMS, g.entries);
  ok('replay: the same seed and moves give the same match, twice', r1.ok && same(r1.state, r2.state) && same(r1.state, g.state));
  ok('replay: another seed gives another board', !same(O.startState(12346, TEAMS).board, O.startState(12345, TEAMS).board));
  ok('replay: an evolve move was played in that match (evolve as a move replays)', g.entries.some((e) => e.k === 'e'));
  const bad = g.entries.slice(); bad[3] = { ...bad[3], by: bad[3].by === 'a' ? 'b' : 'a' };
  ok('replay: a move by the wrong side is refused', !O.replay(12345, TEAMS, bad).ok);
  ok('stateHash: equal states hash equal, different ones differ', O.stateHash(r1.state) === O.stateHash(r2.state) && O.stateHash(r1.state) !== O.stateHash(O.startState(1, TEAMS)));

  // The placeholder: side b's monsters are never read on side a's first turn.
  let checked = 0, equal = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const pre = O.startState(seed, { a: TEAMS.a });
    let s = pre;
    const firstTurn = [];
    while (s.turn === 0 && s.winner == null) {
      const mv = { ...chooseMove(s, 'hard'), side: 0 };
      const res = E.apply(s, mv);
      firstTurn.push(O.entryOf(mv));
      s = res.state;
    }
    for (const team of [['prismote', 'hexowl'], ['gloomite', 'gloomite2'].slice(0, 1).concat('frostling'), ['pebbleop', 'stormhorn']]) {
      const real = O.replay(seed, { a: TEAMS.a, b: team }, firstTurn).state;
      const strip = (x) => { const y = JSON.parse(JSON.stringify(x)); y.sides[1].mons.forEach((m) => { m.id = '?'; }); return y; };
      checked++;
      if (same(strip(real), strip(s))) equal++;
    }
  }
  ok(`placeholder: the challenger's first turn plays out the same whatever b drafts later (${equal}/${checked})`, checked > 0 && equal === checked);

  // The mirror: its own inverse, and the engine plays the same match from either side.
  const m = O.mirror(r1.state);
  ok('mirror: twice is the identity', same(O.mirror(m), r1.state));
  ok('mirror: swaps teams and turn, keeps the board', same(m.board, r1.state.board) && same(m.sides[0], r1.state.sides[1]) && m.winner === 1 - r1.state.winner);
  let sym = true;
  let s = O.startState(777, TEAMS);
  for (let i = 0; i < 120 && s.winner == null && sym; i++) {
    const mv = { ...chooseMove(s, 'medium'), side: s.turn };
    const a = E.apply(s, mv);
    const b = E.apply(O.mirror(s), { ...mv, side: 1 - mv.side });
    sym = a.ok && b.ok && same(O.mirror(a.state), b.state) && same(O.mirrorEvents(a.events), b.events);
    s = a.state;
  }
  ok('mirror: applying a move to the mirrored match gives the mirrored result and events', sym);
  ok('cleanEntry: a pass is only accepted where allowed (live rooms)', O.cleanEntry({ by: 'a', k: 'p' }) === null && same(O.cleanEntry({ by: 'a', k: 'p' }, { pass: true }), { by: 'a', k: 'p' }));
  ok('cleanEntry: a swap of two non-adjacent cells is not a move', O.cleanEntry({ by: 'a', k: 's', a: 0, b: 2 }) === null);
  ok('cleanTeam: two different known monsters, nothing else', same(O.cleanTeam(['zapup', 'driplet']), ['zapup', 'driplet']) && O.cleanTeam(['zapup', 'zapup']) === null && O.cleanTeam(['zapup', 'nope']) === null);
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
let offline = false;
const watchers = [];
const fire = () => { for (const w of watchers) { const v = clone(getAt(w.path)); w.cb({ exists: () => v != null, val: () => v }); } };
const api = {
  ref: (db, path) => ({ path }),
  get: async (r) => { const v = clone(getAt(r.path)); return { exists: () => v !== undefined && v !== null, val: () => v }; },
  set: async (r, v) => { setAt(r.path, v); fire(); },
  update: async (r, patch) => { for (const k of Object.keys(patch)) setAt(r.path + '/' + k, patch[k]); fire(); },
  onValue: (r, cb) => { const w = { path: r.path, cb }; watchers.push(w); return () => { const i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); }; },
};
MP.__setBootForTest(async () => (offline ? null : { db: {}, api }), { allowDev: true });

/** Every move `side` makes in one turn, chosen by the computer, WITHOUT writing.
 *  REPEATABLE (2026-10-28): the computer's choices come from a generator seeded by the match's seed
 *  and how far its log has got, never Math.random, so a given seed plays the same match every run.
 *  It used to be random, and about 1 run in 3 failed: a lucky chain of 4+ matches (an extra move
 *  each, no cap) knocked out the other team in the challenger's FIRST turn, before the receiver
 *  could decline, resign or expire. That is a legal finish, tested on its own below; the lifecycle
 *  matches use seeds checked not to end early. The old 20-move cap also cut long turns short
 *  (the hard computer's longest first turn is 31 moves); 200 is only a runaway guard. */
function turnEntries(g, side, level = 'hard') {
  let s = MP.buildState(g);
  const out = [];
  const seat = side === 'a' ? 0 : 1;
  let r = ((g.seed >>> 0) ^ Math.imul((g.log || []).length + 1, 2654435761)) >>> 0 || 1;
  const rand = () => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r / 4294967296; };
  for (let guard = 0; guard < 200 && s.turn === seat && s.winner == null; guard++) {
    const evo = E.evolveOptions(s);
    const mv = { ...(evo.length ? { type: 'evolve', mon: evo[0] } : chooseMove(s, level, rand)), side: seat };
    const res = E.apply(s, mv);
    out.push(O.entryOf(mv));
    s = res.state;
  }
  return out;
}
const PH = { a: 'A', b: 'B' };
/** One whole turn for `side`, written ONE MOVE AT A TIME (as the phone does). */
async function playTurn(id, side) {
  use(PH[side]);
  let g = await MP.readGame(id);
  let res = { ok: true, game: g };
  for (const e of turnEntries(g, side, side === 'a' ? 'hard' : 'medium')) {
    res = await MP.appendLog(id, g.log.length, [e]);
    if (!res.ok) return res;
    g = res.game;
  }
  return res;
}
const row = (code, id) => getAt(`battlearena/index/${code}/${id}`);
const B_THEM = { code: 'TQWX7', name: 'Tester B', emoji: '🐼' };

// --- 2. challenges ---------------------------------------------------------------------------
{
  use('C');
  ok('gate: a code not let in online cannot challenge', (await MP.createGame({ them: B_THEM, team: TEAMS.a })).reason === 'not-approved');
  use('A');
  ok('gate: nobody can challenge a code that is not let in', (await MP.createGame({ them: { code: 'CCCCC', name: 'C' }, team: TEAMS.a })).reason === 'them-not-approved');
  ok('create: a bad team is refused', (await MP.createGame({ them: B_THEM, team: ['zapup', 'zapup'] })).reason === 'bad-team');
  use('B');
  const noB = await MP.readOpponents();
  ok('picker: reads only the people allowed online (none on an empty directory)', Array.isArray(noB));
}

let id;
{
  use('A');
  const res = await MP.createGame({ them: B_THEM, team: TEAMS.a, seed: 424242 });
  id = res.id;
  ok('create: ok, the seed and the challenger\'s team are stored', res.ok && getAt(`battlearena/games/${id}/seed`) === 424242 && same(getAt(`battlearena/games/${id}/a/team`), TEAMS.a) && !getAt(`battlearena/games/${id}/b/team`));
  ok('create: only the challenger\'s row so far (delivered when their first turn ends)', !!row('DREG5', id) && !row('TQWX7', id));
  ok('create: the challenger moves first', res.game.turn === 'a' && MP.isMyTurn(res.game, 'DREG5'));
  use('B');
  const early = await MP.appendLog(id, 0, [{ by: 'b', k: 's', a: 0, b: 1 }]);
  ok('b cannot move before drafting', !early.ok && early.reason === 'no-team');
  use('A');
  const r1 = await playTurn(id, 'a');
  ok('a\'s first turn: written move by move, verified', r1.ok && r1.game.turn === 'b' && r1.game.log.length >= 2);
  ok('delivered: b\'s row appears, their turn, "got" (open)', row('TQWX7', id) && row('TQWX7', id).yourTurn === true && row('TQWX7', id).open === 'got' && row('TQWX7', id).lastBy === 'them');
  ok('a\'s row: "sent", their turn', row('DREG5', id).yourTurn === false && row('DREG5', id).open === 'sent' && row('DREG5', id).sent === true);
  const updated = getAt(`battlearena/games/${id}/updated`);
  use('B');
  const g0 = await MP.readGame(id);
  ok('b needs to draft before playing', MP.needsDraft(g0, 'b') && !MP.needsDraft(g0, 'a'));
  const before = MP.buildState(g0);
  const d = await MP.draftTeam(id, TEAMS.b);
  ok('draft: b\'s team is stored and verified', d.ok && same(d.game.b.team, TEAMS.b));
  ok('draft: does not move `updated` (the 3-day clock and the bubble are untouched)', getAt(`battlearena/games/${id}/updated`) === updated);
  ok('draft: still open (picking a team is not an answer)', MP.lifeOf(d.game).open);
  const after = MP.buildState(d.game);
  const strip = (x) => { const y = clone(x); y.sides[1].mons.forEach((m) => { m.id = '?'; }); return y; };
  ok('draft: a\'s first turn replays identically with b\'s real team', same(strip(before), strip(after)) && same(after.sides[1].mons.map((m) => m.id), TEAMS.b));
  ok('draft: a second, different team is refused', (await MP.draftTeam(id, ['driplet', 'zapup'])).reason === 'already-drafted');
  ok('draft: the same team again is fine (a retry)', (await MP.draftTeam(id, TEAMS.b)).ok);
  // A late move: built on a stale log.
  const stale = await MP.appendLog(id, 0, [{ by: 'b', k: 's', a: 0, b: 1 }]);
  ok('a move built on a stale log is refused, never overwrites', !stale.ok && stale.reason === 'moved-on');
  const wrong = await MP.appendLog(id, g0.log.length, [{ by: 'a', k: 's', a: 0, b: 1 }]);
  ok('a move for the other side is refused', !wrong.ok && wrong.reason === 'bad-entry');
  const r2 = await playTurn(id, 'b');
  ok('b answers: the turn passes back, rows stop saying open', r2.ok && r2.game.turn === 'a' && !row('TQWX7', id).open && !row('DREG5', id).open && row('DREG5', id).yourTurn === true);
  ok('rows carry both teams\' HP', Number.isFinite(row('DREG5', id).mine) && row('DREG5', id).mine === r2.game.hp.a && row('TQWX7', id).mine === r2.game.hp.b);
  use('A');
  const cancelLate = await MP.cancelGame(id);
  ok('once answered it cannot be cancelled', !cancelLate.ok && cancelLate.reason === 'accepted');

  // Alternate turns to the end.
  let g = await MP.readGame(id);
  let guard = 0;
  while (!g.over && guard++ < 200) {
    const r = await playTurn(id, g.turn);
    if (!r.ok) { console.log('turn refused', r.reason); break; }
    use('A'); g = await MP.readGame(id);
  }
  ok('alternating turns reach a knockout', g.over && g.over.why === 'ko' && (g.over.winner === 'a' || g.over.winner === 'b'), JSON.stringify(g.over));
  ok('the knocked-out team is at 0 HP', g.hp[g.over.winner === 'a' ? 'b' : 'a'] === 0);
  const w = g.over.winner, l = w === 'a' ? 'b' : 'a';
  const code = { a: 'DREG5', b: 'TQWX7' };
  ok('rows: won / lost, over', row(code[w], id).result === 'won' && row(code[l], id).result === 'lost' && row(code[w], id).over && row(code[l], id).over);
  ok('the loser\'s row says it was the winner\'s move (push: "they won")', row(code[l], id).lastBy === 'them');
  use('B');
  const gB = await MP.readGame(id);
  ok('two phones: the same validated match, the same final state', same(gB, g) && same(MP.buildState(gB), MP.buildState(g)));
  // The phone's step-by-step state equals the replay (what each phone has on screen at the end).
  let st = O.startState(g.seed, { a: g.a.team, b: g.b.team });
  for (const e of g.log) st = E.apply(st, O.moveOf(e)).state;
  ok('two phones: applying the moves one by one = replaying the stored log', same(st, MP.buildState(g)));
  ok('evolve as a move was played online (k:"e" in the log) and replays', g.log.some((e) => e.k === 'e'));
  const after1 = await MP.appendLog(id, g.log.length, [{ by: g.turn || 'a', k: 's', a: 0, b: 1 }]);
  ok('no move after the end', !after1.ok);
  // Counting, once per phone, in 'mp'.
  for (const p of ['A', 'B']) {
    use(p);
    const s0 = loadStats().games.battlearena.byDiff.mp || { played: 0, won: 0 };
    const rows = await MP.readMyGames();
    MP.recordFinished(rows);
    MP.recordFinished(rows);
    const s1 = loadStats().games.battlearena.byDiff.mp;
    const won = (p === 'A') === (w === 'a');
    ok(`counted once on phone ${p} as ${won ? 'a win' : 'a loss'} in 'mp'`, s1.played === (s0.played | 0) + 1 && s1.won === (s0.won | 0) + (won ? 1 : 0));
    ok(`no head-to-head written by a challenge (phone ${p})`, !loadStats().h2h || !loadStats().h2h.battlearena);
  }
}

// Cancel, decline, resign, expire, offline.
{
  use('A');
  const c1 = await MP.createGame({ them: B_THEM, team: TEAMS.a, seed: 1001 });
  const can = await MP.cancelGame(c1.id);
  ok('cancel: the sender calls off an unanswered challenge', can.ok && can.cancelled && MP.isCalledOff(can.game) && can.game.over.why === 'cancelled');
  ok('cancel: the row is stored over:false with `ended` (no push shape)', row('DREG5', c1.id).over === false && row('DREG5', c1.id).ended === 'cancelled');
  ok('cancel: the match is kept, nothing deleted', !!getAt(`battlearena/games/${c1.id}/a/team`));

  const c2 = await MP.createGame({ them: B_THEM, team: TEAMS.a, seed: 1002 });
  await playTurn(c2.id, 'a');
  use('B');
  const dec = await MP.cancelGame(c2.id);
  ok('decline: the receiver calls it off before moving', dec.ok && dec.game.over.why === 'declined' && row('TQWX7', c2.id).ended === 'declined');
  const rows = await MP.readMyGames();
  ok('a declined match reads as finished with no result', rows.find((r) => r.id === c2.id).over && rows.find((r) => r.id === c2.id).result === null);

  use('A');
  const c3 = await MP.createGame({ them: B_THEM, team: TEAMS.a, seed: 1003 });
  await playTurn(c3.id, 'a');
  use('B');
  await MP.draftTeam(c3.id, TEAMS.b);
  const resOpen = await MP.resignGame(c3.id);
  ok('resign on an unanswered challenge calls it off instead (nobody is handed a win)', resOpen.ok && resOpen.cancelled);

  use('A');
  const c4 = await MP.createGame({ them: B_THEM, team: TEAMS.a, seed: 1004 });
  await playTurn(c4.id, 'a');
  use('B'); await MP.draftTeam(c4.id, TEAMS.b); await playTurn(c4.id, 'b');
  use('A');
  const rs = await MP.resignGame(c4.id);
  ok('resign once answered: the other person wins', rs.ok && rs.game.over.winner === 'b' && rs.game.over.why === 'resign');
  ok('resign rows: lost / won, why resign', row('DREG5', c4.id).result === 'lost' && row('TQWX7', c4.id).result === 'won' && row('TQWX7', c4.id).why === 'resign');

  const c5 = await MP.createGame({ them: B_THEM, team: TEAMS.a, seed: 1005 });
  await playTurn(c5.id, 'a');
  // Waiting on b for more than 3 days.
  setAt(`battlearena/games/${c5.id}/updated`, Date.now() - 4 * 24 * 3600 * 1000);
  use('B');
  const g5 = await MP.readGame(c5.id);
  ok('expire: 3 days unanswered reads as expired', MP.lifeOf(g5).expired);
  ok('expire: a late draft is refused', (await MP.draftTeam(c5.id, TEAMS.b)).reason === 'expired');
  setAt(`battlearena/games/${c5.id}/b/team`, TEAMS.b);
  ok('expire: a late move is refused', (await MP.appendLog(c5.id, g5.log.length, turnEntries(await MP.readGame(c5.id), 'b').slice(0, 1))).reason === 'expired');

  // A KNOCKOUT IN THE CHALLENGER'S FIRST TURN (2026-10-28): legal (every 4+ match is an extra move,
  // no cap; Matt, 2026-10-24) and about 1 in 90 first turns for the hard computer. Seed 1041 does it.
  // The receiver must still get the match, as a finished loss, and nothing can call it off.
  use('A');
  const k1 = await MP.createGame({ them: B_THEM, team: TEAMS.a, seed: 1041 });
  const kr = await playTurn(k1.id, 'a');
  ok('first-turn knockout: the match ends, the challenger wins', kr.ok && kr.game.over && kr.game.over.winner === 'a' && kr.game.over.why === 'ko', JSON.stringify(kr.game && kr.game.over));
  ok('first-turn knockout: the receiver still gets the match, as a loss', row('TQWX7', k1.id) && row('TQWX7', k1.id).over === true && row('TQWX7', k1.id).result === 'lost' && row('DREG5', k1.id).result === 'won');
  use('B');
  ok('first-turn knockout: it cannot be declined after the fact', (await MP.cancelGame(k1.id)).reason === 'already-over');


  const raw = clone(getAt(`battlearena/games/${c4.id}`));
  raw.log['0099'] = { by: 'b', k: 'p' };
  ok('a challenge log never holds a pass (no move clock): refused whole', MP.validateGame(raw) === null);
  const raw2 = clone(getAt(`battlearena/games/${c4.id}`));
  raw2.log['0000'].a = (raw2.log['0000'].a + 3) % 35;
  ok('a log that does not replay is refused whole', MP.validateGame(raw2) === null || !same(MP.validateGame(raw2).log, MP.validateGame(getAt(`battlearena/games/${c4.id}`)).log));

  offline = true;
  use('A');
  const off = await MP.createGame({ them: B_THEM, team: TEAMS.a, seed: 1006 });
  ok('offline: a failure, retryable, nothing written', !off.ok && off.reason === 'offline' && off.retryable);
  MP.savePending('abcdefgh', 3, [{ by: 'a', k: 's', a: 0, b: 1 }]);
  ok('outbox: an unsent move is kept', MP.outboxCount() === 1 && MP.pendingFor('abcdefgh').base === 3);
  await MP.drainOutbox();
  ok('outbox: still kept while offline (never dropped on a retryable failure)', MP.outboxCount() === 1);
  offline = false;
  await MP.drainOutbox();
  ok('outbox: a match not found yet keeps its move queued (retried, as Darts does)', MP.outboxCount() === 1);
  MP.savePending('abcdefgh', 0, []);
  ok('outbox: an empty entry is removed', MP.outboxCount() === 0);
}

// --- 3. live rooms, against a stand-in for js/net.js ---------------------------------------------
function makeNet(name) {
  let sub = null;
  const self = {
    init: async () => true,
    createRoom: async (game, config, me) => {
      const code = 'QRST';
      setAt(`rooms/${code}`, { v: 1, game, created: Date.now(), updated: Date.now(), status: 'waiting', config, host: { ...me, code: 'DREG5', lastSeen: Date.now() } });
      return { code };
    },
    joinRoom: async (code, me) => {
      const room = getAt(`rooms/${code}`);
      if (!room) return { error: 'not-found' };
      if (room.guest && room.guest.deviceId !== me.deviceId) return { error: 'full' };
      setAt(`rooms/${code}/guest`, { ...me, code: 'TQWX7', lastSeen: Date.now() });
      later();
      return { ok: true, room: clone(getAt(`rooms/${code}`)) };
    },
    startRound: async (code, n, deck, dealer) => { setAt(`rooms/${code}/round`, { n, deck, dealer }); setAt(`rooms/${code}/status`, 'active'); later(); },
    appendMove: async (code, by, seq, move, h) => { setAt(`rooms/${code}/moves/${String(seq).padStart(4, '0')}`, { by, seq, move, h }); later(); },
    writeRecovery: async () => {}, requestRecovery: async () => {}, clearRecovery: async () => {},
    sendReaction: async () => {},
    heartbeat: () => {}, stopHeartbeat: () => {},
    onRoom: async (code, cb) => { sub = { code, cb }; later(); return () => { sub = null; }; },
    leaveRoom: async (code) => { setAt(`rooms/${code}/status`, 'ended'); later(); sub = null; },
    disconnect: () => { sub = null; },
    deliver: () => { if (sub) sub.cb(clone(getAt(`rooms/${sub.code}`))); },
    name,
  };
  return self;
}
const nets = [];
let pending = false;
function later() { if (pending) return; pending = true; setTimeout(() => { pending = false; for (const n of nets) n.deliver(); }, 0); }
const tick = () => new Promise((r) => setTimeout(r, 5));

{
  const netA = makeNet('A'), netB = makeNet('B');
  nets.push(netA, netB);
  const seen = { A: [], B: [] };
  const started = {};
  use('A');
  const host = new L.LiveRoom(netA, { onStart: (c) => { started.A = c; }, onMove: (e) => seen.A.push(e) });
  const h = await host.host(TEAMS.a);
  ok('live: the host makes a room with a code, saved for a rejoin', h.ok && h.code === 'QRST' && L.readRoomSave().seat === 0);
  use('B');
  const guest = new L.LiveRoom(netB, { onStart: (c) => { started.B = c; }, onMove: (e) => seen.B.push(e) });
  const j = await guest.join('QRST', TEAMS.b);
  ok('live: the guest joins with their team on their seat record', j.ok && same(getAt('rooms/QRST/guest/team'), TEAMS.b));
  for (let i = 0; i < 5; i++) await tick();
  ok('live: the host publishes seed + both teams; the host moves first', !!getAt('rooms/QRST/round/deck/seed') && getAt('rooms/QRST/round/dealer') === 0);
  ok('live: both phones start on the same match', started.A && started.B && same(started.A, started.B) && started.A.turn === 0);
  // Play: whoever's turn, the computer chooses; every 7th move is a pass (the clock ran out).
  const rooms = { 0: host, 1: guest };
  let moves = 0, passes = 0;
  for (let guard = 0; guard < 600 && !host.over && !guest.over; guard++) {
    const side = host.canon.turn;
    const me = rooms[side];
    use(side ? 'B' : 'A');
    let mv;
    if (moves % 7 === 6) { mv = { type: 'pass', side }; passes++; }
    else { const evo = E.evolveOptions(me.canon); mv = { ...(evo.length ? { type: 'evolve', mon: evo[0] } : chooseMove(me.canon, 'medium')), side }; }
    me.send(O.entryOf(mv));
    moves++;
    for (let i = 0; i < 3; i++) await tick();
    if (!same(host.canon, guest.canon)) break;
  }
  ok(`live: ${moves} moves (${passes} passes) in lockstep, every hash checked`, same(host.canon, guest.canon) && host.canon.winner != null, `${host.applied} ${guest.applied}`);
  ok('live: each phone was shown exactly the OTHER player\'s moves, in order', seen.A.every((e) => e.by === 'b') && seen.B.every((e) => e.by === 'a') && seen.A.length + seen.B.length === moves);
  const replayed = (() => { let s = O.startState(host.match.seed, { a: host.match.a, b: host.match.b }); for (const m of L.movesOf(getAt('rooms/QRST'))) s = E.apply(s, O.moveOf(m.entry)).state; return s; })();
  ok('live: a rejoining phone replays the stored moves to the same match', same(replayed, host.canon));
  // Count once each, with head-to-head.
  use('A');
  const hw = host.canon.winner === 0;
  const h0 = (loadStats().games.battlearena.byDiff.mp || {}).played | 0;
  L.countLive(host.resultKey(), hw, host.opp);
  L.countLive(host.resultKey(), hw, host.opp);
  const st = loadStats();
  ok('live: counted once in \'mp\', with head-to-head against the guest\'s device', st.games.battlearena.byDiff.mp.played === h0 + 1 && st.h2h && st.h2h.battlearena && Object.values(st.h2h.battlearena)[0][hw ? 'w' : 'l'] === 1);
  await host.leave();
  ok('live: leaving clears the rejoin save', L.readRoomSave() === null);
}

{
  // Resign (leaving = resigning), and a tampered move (hash) is caught.
  const root2 = 'rooms/QRST';
  setAt(root2, null);
  const netA = makeNet('A2'), netB = makeNet('B2');
  nets.splice(0, nets.length, netA, netB);
  const got = { A: [], B: [] };
  use('A');
  const host = new L.LiveRoom(netA, { onMove: (e) => got.A.push(e) });
  await host.host(TEAMS.a);
  use('B');
  const guest = new L.LiveRoom(netB, { onMove: (e) => got.B.push(e) });
  await guest.join('QRST', TEAMS.b);
  for (let i = 0; i < 5; i++) await tick();
  use('A');
  const mv = { ...chooseMove(host.canon, 'hard'), side: 0 };
  host.send(O.entryOf(mv));
  for (let i = 0; i < 3; i++) await tick();
  ok('live: a move arrives on the other phone', got.B.length === 1 && same(host.canon, guest.canon));
  use('B');
  // The guest's turn hasn't come yet (host has another move); the guest resigns anyway.
  guest.resign();
  for (let i = 0; i < 3; i++) await tick();
  ok('live: resigning is a stored move; the other phone sees it and wins', got.A.some((e) => e.k === 'r' && e.by === 'b') && host.over && host.canon.winner === 0 && guest.canon.winner === 0);
  // A tampered hash is refused (the guest asks for recovery instead of going on).
  setAt(root2, null);
  const n3 = makeNet('A3'), n4 = makeNet('B3');
  nets.splice(0, nets.length, n3, n4);
  use('A'); const h3 = new L.LiveRoom(n3, {}); await h3.host(TEAMS.a);
  use('B');
  let asked = false;
  n4.requestRecovery = async () => { asked = true; };
  const g3 = new L.LiveRoom(n4, {}); await g3.join('QRST', TEAMS.b);
  for (let i = 0; i < 5; i++) await tick();
  setAt(`${root2}/moves/0000`, { by: 0, seq: 0, move: O.entryOf({ ...chooseMove(h3.canon, 'hard'), side: 0 }), h: 'tampered' });
  later();
  for (let i = 0; i < 3; i++) await tick();
  ok('live: a move whose hash does not match is not applied; the guest asks the host', g3.applied === 0 && asked);
}

{
  // The gate on live rooms is js/net.js's own (checked before any network call).
  const NET = (await import('../js/net.js')).default;
  use('C');
  const r = await NET.createRoom('battlearena', { v: 1 }, { name: 'C', avatar: '🐸', deviceId: 'dev-c' });
  ok('gate: a code not let in cannot host a live room', r && r.error === 'not-approved');
  const j = await NET.joinRoom('ABCD', { name: 'C', avatar: '🐸', deviceId: 'dev-c' });
  ok('gate: ...or join one', j && j.error === 'not-approved');
}

// --- 4. structural --------------------------------------------------------------------------------
{
  const src = (p) => readFileSync(p, 'utf8');
  const rules = JSON.parse(src('database.rules.json'));
  ok('`battlearena` is in database.rules.json, signed-in read and write (darts\' shape)', rules.rules.battlearena && rules.rules.battlearena['.read'] === 'auth != null' && rules.rules.battlearena['.write'] === 'auth != null');
  ok('`battlearena` is in the backup branch list', /\n\s*'battlearena',/.test(src('backups/rtdb-backup.mjs')));
  ok('the Remind bell may name battlearena matches', /battlearena[|)]/.test(JSON.stringify(rules.rules.nudges)));
  const hub = src('js/hub.js');
  ok('hub: Battle Arena declares its alerts module', /alerts: \(\) => import\('\.\.\/battle-arena\/js\/alert\.js'\)/.test(hub));
  ok('hub: a live-room game (LIVE_MP_GAMES) and js/mp-records.js LIVE_GAMES', /'battle-arena'/.test(hub.match(/const LIVE_MP_GAMES = new Set\(\[[^\]]*\]/)[0]) && /'battle-arena': 'battlearena'/.test(src('js/mp-records.js')));
  ok('the Multiplayer screen reads its challenges (js/challenges.js SOURCES)', /'battle-arena': \{\s*load: \(\) => import\('\.\.\/battle-arena\/js\/mp\.js'\)/.test(src('js/challenges.js')));
  ok('push: battleArenaTurnPush watches battlearena/index; in the 24-hour reminder', /battleArenaTurnPush = onValueWritten\(\{ ref: '\/battlearena\/index\/\{code\}\/\{id\}'/.test(src('functions/index.js')) && /node: 'battlearena', game: 'battle-arena'/.test(src('functions/decide.js')));
  ok('chat: challenge chat beside the match; live chat through net.sendReaction (kept in Messages)', /createMatchChat/.test(src('battle-arena/js/online-ui.js')) && /sendReaction/.test(src('battle-arena/js/online-ui.js')) && /battlearena: \['battle-arena', 'battlearena'\]/.test(src('js/net.js')));
  ok('challenges never write head-to-head; live rooms do', !/recordHeadToHead/.test(src('battle-arena/js/mp.js')) && /recordHeadToHead\(GAME/.test(src('battle-arena/js/live.js')));
  ok('the pickers read the small directory, never all of players/', /readOpponentProfiles/.test(src('battle-arena/js/mp.js')) && !/readPlayersOnce|ref\([^)]*'players'/.test(src('battle-arena/js/mp.js')));
  ok('no move clock in challenges, 25 s in live rooms', /this\.timed = false;/.test(src('battle-arena/js/online-ui.js')) && /this\.timed = true;/.test(src('battle-arena/js/online-ui.js')));
  ok('vs the computer: still no clock (ui.js times only a live link)', /this\.timed = !!\(this\.link && this\.link\.timed\)/.test(src('battle-arena/js/ui.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
