// tools/test-challenge-clock.mjs - the turn-by-turn challenges' clocks and call-offs (2026-10-29, second
// pass, docs/INTEGRITY-CHECKS-SPEC.md "Holes closed 2026-10-29 (second pass): challenge clocks and cancels").
//
// The reviewer's three proofs (a phone clock set BACK before a move, set FORWARD before opening the
// list, set back before a fresh storage first counts) replayed as permanent checks, plus the call-off
// rule and the lost index write:
//   F1  every new move / hand-over carries the SERVER's time (stampFor), the rules refuse any other, and
//       a time that runs backwards or lies in the future cannot start a turn's clock early
//   F2  a timeout is decided on the server's clock and COUNTED only after the match itself confirms it
//       on live server time; a person's devices that disagree keep the match's outcome, else not a win
//   F3  a fresh storage's "counting since" is never before 2026-10-29 and uses the server's clock
//   F4  once the sender has played, a cancel or a decline is a LOSS for whoever does it
//   F5  a retry that finds its move already landed rewrites the rows the match disagrees with
// In-memory database (Firebase's serverTimestamp resolved to a fake SERVER clock), several "phones"
// (one localStorage each, each with its own phone clock), made-up player codes only.
//   node tools/test-challenge-clock.mjs
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8');
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

// --- phones: one localStorage and one clock offset each ------------------------------------------
const stores = { A: new Map(), B: new Map(), C: new Map() };
let phone = 'A';
globalThis.localStorage = {
  getItem: (k) => (stores[phone].has(k) ? stores[phone].get(k) : null),
  setItem: (k, v) => stores[phone].set(k, String(v)),
  removeItem: (k) => stores[phone].delete(k),
};
const realNow = Date.now.bind(Date);
const DAY = 864e5;
let SRV = realNow();                         // the SERVER's clock (moves only when the test says so)
const skew = { A: 0, B: 0, C: 0 };           // each phone's clock minus the server's
Date.now = () => SRV + skew[phone];
const ST = await import('../js/server-time.js');
const CLOCK = await import('../js/challenge-clock.js');
CLOCK.__setLiveWaitForTest(30);
/** This page's connection measured the server: live server time is known. */
const live = () => ST.__setServerTimeForTest(-skew[phone]);
/** No connection measured yet (and no cached gap on this phone). */
const noLive = () => { ST.__setServerTimeForTest(null); localStorage.removeItem('gamehub.serverTime.v1'); };
const use = (p) => { phone = p; };
const ONLINE = JSON.stringify({ online: { MATTA: true, ANABB: true } });
for (const [p, name, code] of [['A', 'Matt', 'MATTA'], ['B', 'Ana', 'ANABB'], ['C', 'Matt', 'MATTA']]) {
  stores[p].set('gamehub.profile', JSON.stringify({ name, emoji: '🙂', playerId: code }));
  stores[p].set('gamehub.adminConfig.v1', ONLINE);
}

// --- the in-memory database: serverTimestamp() is the SERVER's clock -------------------------------
const root = {};
const SV = () => ({ '.sv': 'timestamp' });
const resolve = (v) => {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return SRV;
    const o = Array.isArray(v) ? [] : {};
    for (const k of Object.keys(v)) o[k] = resolve(v[k]);
    return o;
  }
  return v;
};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const parts = (p) => p.split('/').filter(Boolean);
function getAt(p) { let n = root; for (const k of parts(p)) { if (!n || typeof n !== 'object') return undefined; n = n[k]; } return n; }
function setAt(p, v) {
  const ks = parts(p); let n = root;
  for (const k of ks.slice(0, -1)) { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
  if (v === null || v === undefined) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = clone(resolve(v));
}
let failIndexWrites = 0;                      // F5: the next N index-row writes throw (a dropped line)
const api = {
  ref: (db, path) => ({ path }),
  get: async (r) => { const v = clone(getAt(r.path)); return { exists: () => v !== undefined && v !== null, val: () => v }; },
  set: async (r, v) => setAt(r.path, v),
  update: async (r, patch) => {
    if (failIndexWrites > 0 && /\/index\//.test(r.path)) { failIndexWrites--; throw new Error('network dropped'); }
    for (const k of Object.keys(patch)) setAt(r.path + '/' + k, patch[k]);
  },
  serverTimestamp: SV,
};
const boot = async () => ({ db: {}, api });

const DARTS = await import('../darts/js/mp.js');
DARTS.__setBootForTest(boot, { allowDev: true });
const { targetPoint } = await import('../darts/js/engine.js');
const T20 = targetPoint(20, 'treble');
const OFF = { x: 0, y: -2 };
const dart = (by, p = T20) => ({ by, x: p.x, y: p.y });
const L = await import('../js/challenge-life.js');
const GS = await import('../js/game-stats.js');
const dartsStats = (p) => { const s = stores[p].get('gamehub.stats'); return s ? (JSON.parse(s).games.darts || {}) : {}; };
const mpWon = (p) => ((dartsStats(p).byDiff || {}).mp || {}).won | 0;

// A storage that never counted darts would skip matches from before its first look: open each list once.
for (const p of ['A', 'B']) { use(p); live(); DARTS.recordFinished([]); }

// ==== F1: BACKDATED MOVES =========================================================================
{
  use('A'); live();
  let r = await DARTS.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const id = r.id;
  ok('F1 the match is created on the SERVER\'s time', getAt(`darts/games/${id}/created`) === SRV && getAt(`darts/games/${id}/updated`) === SRV);
  await DARTS.appendLog(id, 0, [dart('a'), dart('a'), dart('a')]);            // Matt 121
  const handedOver = SRV;
  SRV += 5 * 60e3;
  use('B'); skew.B = -11 * DAY; live();                                       // Ana's phone set 11 days back
  r = await DARTS.appendLog(id, 3, [dart('b', OFF), dart('b', OFF), dart('b', OFF)]);
  const stored = getAt(`darts/games/${id}/log`);
  ok('F1 a phone set back 11 days still stores the SERVER\'s time on every dart', r.ok && Object.values(stored).slice(3).every((e) => e.at === SRV) && getAt(`darts/games/${id}/updated`) === SRV);
  skew.B = 0;
  SRV += 5 * 60e3;
  use('A'); live();
  const g = await DARTS.readGame(id);
  ok('F1 Matt opens it 5 minutes later: still his turn, nobody timed out', g && !g.over && g.turn === 'a', JSON.stringify(g && g.over));
  ok('F1 ...his turn began when Ana threw (server time), not 11 days ago', DARTS.lifeOf(g).turnAt === SRV - 5 * 60e3 && DARTS.lifeOf(g).turnAt > handedOver);
  ok('F1 ...and he can still throw', (await DARTS.appendLog(id, 6, [dart('a')])).ok);

  // A match written by an older build with a forged, backwards time: the clock starts no earlier than
  // the entry before it, so the forgery cannot make him forfeit.
  const forged = getAt(`darts/games/${id}`);
  const keys = Object.keys(forged.log).sort();
  forged.log[keys[5]].at = SRV - 30 * DAY;                                    // her last dart "30 days ago"
  const g2 = await DARTS.readGame(id);
  ok('F1 a historic time that runs backwards is lifted to the entry before it (no forfeit)', g2 && !g2.over && DARTS.lifeOf(g2).turnAt >= forged.log[keys[4]].at);
  forged.log[keys[5]].at = SRV + 30 * DAY;                                    // or "30 days from now"
  ok('F1 a time in the future is capped at now', DARTS.lifeOf(await DARTS.readGame(id)).turnAt <= CLOCK.decideNow());
}
// The pure rule, on its own.
ok('F1 safeTimes: never backwards, never past the cap, unknown stays 0',
  JSON.stringify(L.safeTimes([{ at: 100 }, { at: 50 }, { at: 0 }, { at: 900 }], null, 500)) === JSON.stringify([100, 100, 0, 500]));
ok('F1 turnStartOf: a backdated reply starts the turn at the move before it',
  L.turnStartOf([{ by: 'a', at: 1000 }, { by: 'b', at: 10 }], 'a', 0) === 1000);
ok('F1 turnStartOf: a reply with no time falls back to the later of the last known time and updated',
  L.turnStartOf([{ by: 'a', at: 1000 }, { by: 'b' }], 'a', 1500) === 1500 && L.turnStartOf([{ by: 'a', at: 1000 }, { by: 'b' }], 'a', 10) === 1000);
// Every challenge game stamps with the server and decides on its clock.
const GAMES = ['darts', 'cup-pong', 'flick-soccer', 'eight-ball', 'battleship', 'hoops4', 'chinchon', 'escoba', 'archery', 'battle-arena'];
for (const gdir of GAMES) {
  const s = src(`${gdir}/js/mp.js`);
  ok(`F1 ${gdir}: writes stamp the server's time; nothing writes Date.now() as a move time`,
    /from '\.\.\/\.\.\/js\/challenge-clock\.js'/.test(s) && /stampFor\(api\)/.test(s) && !/const now = Date\.now\(\);/.test(s)
    && /lifeOf\(game, now = decideNow\(\)\)/.test(s) && /rowsFromIndex\(val, now = decideNow\(\)\)/.test(s) && /noteTimeout\(/.test(s) && /timeoutUnsure\(/.test(s));
}
{
  const s = src('skeeball/js/challenge.js');
  ok('F1 skeeball: hand-overs stamp the server\'s time and a deadline is never before it', /stampFor\(api\)/.test(s) && !/const now = Date\.now\(\);/.test(s) && /safeExpires\(/.test(s));
  const C = await import('../skeeball/js/challenge.js');
  ok('F1 skeeball safeExpires: a backdated deadline is lifted to updated + 3 days, a later one stands',
    C.safeExpires(1000, 5000, 1e13) === 5000 + 3 * DAY && C.safeExpires(9e12, 5000, 1e13) === 9e12 && C.safeExpires(0, 5000) === 0);
}
{
  const rules = JSON.parse(src('database.rules.json')).rules;
  const nodes = { cuppong: 'log', darts: 'log', flicksoccer: 'log', eightball: 'log', archery: 'log', chinchon: 'log', escoba: 'log', battlearena: 'log', battleship: 'log', hoops: 'moves' };
  for (const [n, logKey] of Object.entries(nodes)) {
    const gm = rules[n] && rules[n].games && rules[n].games.$id;
    const tight = (x) => typeof x === 'string' && /now - 120000/.test(x) && /now \+ 120000/.test(x);
    ok(`F1 rules ${n}: a new ${logKey} entry, created and updated must be the server's time (2 min either way); old ones stay valid`,
      gm && tight(gm.updated && gm.updated['.validate']) && /data\.val\(\)/.test(gm.updated['.validate']) && tight(gm.created && gm.created['.validate'])
      && tight(gm[logKey] && gm[logKey].$k && gm[logKey].$k['.validate']) && /^data\.exists\(\) \|\|/.test(gm[logKey].$k['.validate'])
      && rules[n]['.read'] === 'auth != null' && rules[n]['.write'] === 'auth != null');
  }
  const sk = rules.skeeChallenges.games.$id;
  ok('F1 rules skeeChallenges: updated and created are the server\'s time; the start marker rule is kept', /now - 120000/.test(sk.updated['.validate']) && /now - 120000/.test(sk.created['.validate']) && !!sk.$side.started.$leg['.validate']);
}

// ==== F2: A FORWARD CLOCK BOOKS NO WIN ============================================================
{
  use('A'); skew.A = 0; live();
  let r = await DARTS.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const id = r.id;
  await DARTS.appendLog(id, 0, [dart('a'), dart('a'), dart('a')]);
  use('B'); live();
  await DARTS.appendLog(id, 3, [dart('b', OFF), dart('b', OFF), dart('b', OFF)]);   // answered; Matt's turn
  DARTS.recordFinished([]);
  const before = mpWon('B');
  // Ana sets her phone 8 days ahead and opens the app before it has measured the server.
  skew.B = 8 * DAY; noLive();
  const rows = await DARTS.readMyGames();
  const row = rows.find((x) => x.id === id);
  ok('F2 with no server time a forward phone clock may SHOW a timeout', row && row.over && row.why === 'timeout' && row.result === 'won');
  ok('F2 ...but nothing is counted at once', DARTS.recordFinished(rows) === 0);
  await DARTS.timeoutsSettled();
  ok('F2 ...nor after the confirmation (no live server time: never counted)', mpWon('B') === before && !(dartsStats('B').mpIds || {})[id]);
  const gUnsure = await DARTS.readGame(id);
  ok('F2 the match read without live time is "timed out" on screen, and countResult refuses it', gUnsure.over && gUnsure.over.why === 'timeout' && DARTS.countResult(id, true, gUnsure.over.at) === false && mpWon('B') === before);
  // The connection measures the server: the truth is 8 days earlier than her phone says.
  live();
  ok('F2 with live server time the list says it is still Matt\'s turn', !(await DARTS.readMyGames()).find((x) => x.id === id).over);
  DARTS.recordFinished(rows);                                               // the stale rows again
  await DARTS.timeoutsSettled();
  ok('F2 ...and the stale "timed out" rows still count nothing (the match says otherwise)', mpWon('B') === before);
  skew.B = 0; live();
  // The match goes on for real: Matt finishes (121 = T20 T20 S1), Ana misses her last turn.
  use('A'); live();
  let g = await DARTS.readGame(id);
  r = await DARTS.appendLog(id, g.log.length, [dart('a'), dart('a'), dart('a', targetPoint(1, 'single'))]);
  use('B'); live();
  r = await DARTS.appendLog(id, r.game.log.length, [dart('b', OFF), dart('b', OFF), dart('b', OFF)]);
  ok('F2 the real result: Matt won', r.game.over && r.game.over.winner === 'a');
  DARTS.recordFinished(await DARTS.readMyGames()); await DARTS.timeoutsSettled();
  ok('F2 Ana\'s phone counts her real LOSS, no win', mpWon('B') === before && (dartsStats('B').mpIds || {})[id] === 'l');

  // An HONEST timeout: 7 days pass for real on Ana's turn; counted once, after the match confirms it.
  use('A'); live();
  r = await DARTS.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const t = r.id;
  await DARTS.appendLog(t, 0, [dart('a'), dart('a'), dart('a')]);
  use('B'); live();
  await DARTS.appendLog(t, 3, [dart('b', OFF), dart('b', OFF), dart('b', OFF)]);
  use('A'); live();
  DARTS.recordFinished(await DARTS.readMyGames()); await DARTS.timeoutsSettled();   // his earlier win, counted first
  const wonA = mpWon('A');
  SRV = Math.max(SRV, L.FORFEIT_FROM) + L.FORFEIT_MS + 60e3;                // Matt sits on his turn 7 days...
  use('B'); live();
  const wonB = mpWon('B');
  const late = (await DARTS.readMyGames()).find((x) => x.id === t);
  ok('F2 an honest timeout on live server time shows on her list', late && late.why === 'timeout' && late.result === 'won');
  ok('F2 ...is not counted from the row alone', DARTS.recordFinished([late]) === 0);
  await DARTS.timeoutsSettled();
  DARTS.recordFinished([late]); await DARTS.timeoutsSettled();
  ok('F2 ...and is counted ONCE after the match confirms it on live server time', mpWon('B') === wonB + 1 && dartsStats('B').mpIds[t] === 'w');
  use('A'); live();
  DARTS.recordFinished(await DARTS.readMyGames()); await DARTS.timeoutsSettled();
  ok('F2 ...Matt\'s phone counts his loss the same way', mpWon('A') === wonA && dartsStats('A').mpIds[t] === 'l', JSON.stringify(dartsStats('A').mpIds));
}
// One person's devices disagree about a match.
{
  const { aggregatePlayers } = await import('../js/players-agg.js');
  const rec = (dev, ids) => ({ profile: { name: 'Zed', emoji: '🙂', playerId: 'ZZTOP' }, updatedAt: 1, stats: { version: 1, games: { darts: {
    total: { played: Object.keys(ids).length, won: Object.values(ids).filter((v) => v === 'w').length, lost: Object.values(ids).filter((v) => v === 'l').length },
    byDiff: { mp: { played: Object.keys(ids).length, won: Object.values(ids).filter((v) => v === 'w').length, lost: Object.values(ids).filter((v) => v === 'l').length } }, mpIds: ids } } } });
  const one = (all, corr) => aggregatePlayers(all, corr).find((x) => x.playerId === 'ZZTOP').games.darts.byDiff.mp;
  let mp = one({ d1: rec('d1', { m1aaaaaaaa: 'w' }), d2: rec('d2', { m1aaaaaaaa: 'l' }) });
  ok('F2 devices disagree (won on one, lost on the other): it is kept as the loss, never a win', mp.played === 1 && mp.won === 0 && mp.lost === 1, JSON.stringify(mp));
  mp = one({ d1: rec('d1', { m1aaaaaaaa: 'w' }), d2: rec('d2', { m1aaaaaaaa: 'd' }) });
  ok('F2 a win against a played-only copy is kept as played only', mp.played === 1 && mp.won === 0 && mp.lost === 0, JSON.stringify(mp));
  mp = one({ d1: rec('d1', { m1aaaaaaaa: 'w' }), d2: rec('d2', { m1aaaaaaaa: 'l' }) }, { mpOutcomes: { darts: { m1aaaaaaaa: { ZZTOP: 'w' } } } });
  ok('F2 ...unless the match\'s real outcome is known: then that copy stays', mp.played === 1 && mp.won === 1 && mp.lost === 0, JSON.stringify(mp));
  mp = one({ d1: rec('d1', { m1aaaaaaaa: 'w' }), d2: rec('d2', { m1aaaaaaaa: 'w' }) });
  ok('F2 devices that agree are counted once as before', mp.played === 1 && mp.won === 1);
  mp = one({ d1: rec('d1', { m1aaaaaaaa: 'w' }), d2: rec('d2', { m2bbbbbbbb: 'l' }) });
  ok('F2 two different matches are both kept (no real result hidden)', mp.played === 2 && mp.won === 1 && mp.lost === 1);
}

// ==== F3: A BACKDATED "COUNTING SINCE" ==============================================================
{
  // Matt's phone A counts a finished match; his new storage C (say the Home Screen app) first opens
  // with the phone's date set back a month.
  use('A'); live();
  let r = await DARTS.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const id = r.id;
  let g;
  await DARTS.appendLog(id, 0, [dart('a'), dart('a'), dart('a')]);
  use('B'); live(); await DARTS.appendLog(id, 3, [dart('b', OFF), dart('b', OFF), dart('b', OFF)]);
  use('A'); live(); g = await DARTS.readGame(id); r = await DARTS.appendLog(id, g.log.length, [dart('a'), dart('a'), dart('a', targetPoint(1, 'single'))]);
  use('B'); live(); r = await DARTS.appendLog(id, r.game.log.length, [dart('b', OFF), dart('b', OFF), dart('b', OFF)]);
  use('A'); live(); DARTS.recordFinished(await DARTS.readMyGames());
  SRV += 60 * 60e3;                                   // an hour later
  use('C'); skew.C = -30 * DAY; noLive();
  DARTS.recordFinished([]);                           // first launcher paint, no server time yet
  const since = +stores.C.get(DARTS.LEDGER_KEY + '.since');
  ok('F3 a fresh storage with the date set back never stamps "counting since" before 2026-10-29', since >= GS.COUNT_FLOOR && since >= Date.UTC(2026, 9, 29));
  // Offline the floor is all there is: a match finished since 2026-10-29 may be counted on the new
  // storage too, and then it carries its id, so the person's board counts it once (js/players-agg.js).
  const n3 = DARTS.recordFinished(await DARTS.readMyGames());
  ok('F3 ...and anything it does count since the floor carries its match id (taken out per person)', n3 === 0 || ((JSON.parse(stores.C.get('gamehub.stats')).games.darts.mpIds || {})[id] === 'w'));
  stores.C.delete(DARTS.LEDGER_KEY + '.since'); stores.C.delete(DARTS.LEDGER_KEY); stores.C.delete('gamehub.stats');
  live();                                             // with server time known, the stamp IS the server's time
  DARTS.recordFinished([]);
  const since2 = +stores.C.get(DARTS.LEDGER_KEY + '.since');
  ok('F3 with the server\'s time known the stamp is the server\'s now (not the phone\'s month-old date)', Math.abs(since2 - SRV) < 5000, `${since2} vs ${SRV}`);
  ok('F3 ...so the hour-old match is not counted again on the new storage', DARTS.recordFinished(await DARTS.readMyGames()) === 0);
  stores.C.set('x.since', String(Date.UTC(2026, 8, 1)));
  ok('F3 a stamp already stored before the floor reads as the floor', GS.countingSince('x') === GS.COUNT_FLOOR);
  stores.C.set('y.since', String(SRV + 40 * DAY));
  ok('F3 a stamp in the server\'s future (a phone set forward) is brought back to the server\'s now', Math.abs(GS.countingSince('y') - SRV) < 5000);
  skew.C = 0;
}

// ==== F4: CANCEL / DECLINE AFTER THE SENDER HAS PLAYED IS A LOSS ===================================
ok('F4 callOffCosts: free before the sender plays, a loss after', L.callOffCosts(false) === false && L.callOffCosts(true) === true);
ok('F4 rowCallOffCosts: a row\'s `pl` decides; an older row delivered to its receiver costs one',
  L.rowCallOffCosts({ pl: true }) && !L.rowCallOffCosts({ pl: false, open: 'got' }) && L.rowCallOffCosts({ open: 'got' })
  && L.rowCallOffCosts({ open: 'sent', yourTurn: false }) && !L.rowCallOffCosts({ open: 'sent', yourTurn: true }) && !L.rowCallOffCosts(null));
{
  use('A'); live();
  const before = (((dartsStats('B').byDiff || {}).mp) || {}).won | 0;
  let r = await DARTS.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const id = r.id;
  await DARTS.appendLog(id, 0, [dart('a', OFF), dart('a', OFF), dart('a', OFF)]);     // a bad first turn
  r = await DARTS.cancelGame(id);
  ok('F4 the sender cancels after a bad first turn: no do-over, it is HIS loss', r.ok && r.lost && r.game.over.winner === 'b' && r.game.over.why === 'resign');
  use('B'); live();
  DARTS.recordFinished(await DARTS.readMyGames());
  ok('F4 ...counted as Ana\'s win', mpWon('B') === before + 1);
  // The push functions read it as a resignation: "You won! Matt resigned." to Ana, nothing to Matt.
  const D = await import('../functions/decide.js');
  const after = getAt(`darts/index/ANABB/${id}`), mine = getAt(`darts/index/MATTA/${id}`);
  const toAna = D.decideDarts({ code: 'ANABB', id, before: { ...after, over: false, result: undefined, why: undefined, yourTurn: true, lastBy: 'them' }, after });
  ok('F4 push: the other person is told they won ("<name> resigned")', toAna && toAna.kind === 'over' && /resigned/.test(toAna.text('en').body), toAna && toAna.text('en').body);
  ok('F4 push: the one who cancelled is told nothing', D.decideDarts({ code: 'MATTA', id, before: { ...mine, over: false, result: undefined, why: undefined }, after: mine }) === null);
  // Cup Pong and Hoops: a costly call-off ends the whole series.
  const CP = await import('../cup-pong/js/mp.js');
  ok('F4 Cup Pong: a game 1 called off at a cost ends the series (nobody owes a game 2)',
    CP.seriesAfter({ series: 3, seriesNo: 1, seriesWins: { a: 0, b: 0 }, over: { winner: 'b', why: 'resign', via: 'cancelled' } }).done === true
    && CP.seriesAfter({ series: 3, seriesNo: 1, seriesWins: { a: 0, b: 0 }, over: { winner: 'b', why: 'resign' } }).done === false
    && CP.owedSeriesRows([{ id: 'g1aaaaaaaa', with: 'ANABB', over: true, result: 'won', series: 3, seriesNo: 1, seriesOf: 'g1aaaaaaaa', via: 'cancelled' }]).length === 0);
  const HP = await import('../hoops4/js/mp.js');
  ok('F4 Hoops: the same', HP.seriesAfter({ series: 3, seriesNo: 1, seriesWins: { a: 0, b: 0 }, over: { winner: 'a', why: 'resign', via: 'declined' } }).done === true);
  // The words, in both languages, fewest words, no em dash.
  const ui = src('js/challenges-strings.js');
  ok('F4 the Multiplayer screen says "Counts as a loss." / "Cuenta como derrota." and no em dash', /cx_end_b_cancel_loss: '[^']*Counts as a loss\.'/.test(ui) && /cx_end_b_decline_loss: '[^']*Cuenta como derrota\.'/.test(ui) && !/—/.test(ui));
  for (const f of ['darts/js/strings.js', 'cup-pong/js/strings.js', 'hoops4/js/strings.js', 'chinchon/js/strings.js', 'escoba/js/strings.js', 'archery/js/strings.js', 'battle-arena/js/strings.js', 'skeeball/js/strings.js']) {
    const s = src(f);
    ok(`F4 ${f.split('/')[0]}: its own confirm says it counts as a loss, EN and ES`, /Counts as a loss\./.test(s) && /Cuenta como derrota\./.test(s));
  }
  for (const gdir of GAMES) ok(`F4 ${gdir}: cancelGame stores a costly call-off as the caller's resignation`, /lost = cancelCosts\(fresh\)/.test(src(`${gdir}/js/mp.js`)) && /via: why/.test(src(`${gdir}/js/mp.js`)));
}

// ==== F5: A LOST INDEX WRITE ========================================================================
{
  use('A'); live();
  let r = await DARTS.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const id = r.id;
  failIndexWrites = 1;                                // the line drops between the darts and the rows
  r = await DARTS.appendLog(id, 0, [dart('a'), dart('a'), dart('a')]);
  ok('F5 the darts land, the rows do not: the send fails and is retryable (the outbox keeps it)', !r.ok && r.retryable && Object.keys(getAt(`darts/games/${id}/log`)).length === 3 && !getAt(`darts/index/ANABB/${id}`));
  r = await DARTS.appendLog(id, 0, [dart('a'), dart('a'), dart('a')]);   // the outbox's retry
  ok('F5 the retry finds them landed and rewrites the rows: Ana is told it is her turn', r.ok && getAt(`darts/index/ANABB/${id}`) && getAt(`darts/index/ANABB/${id}`).yourTurn === true && getAt(`darts/index/MATTA/${id}`).yourTurn === false);
  ok('F5 ...and no dart was written twice', Object.keys(getAt(`darts/games/${id}/log`)).length === 3);
  // A row that disagrees with the match (stale) is put right from the MATCH on the next retry.
  getAt(`darts/index/ANABB/${id}`).yourTurn = false;
  r = await DARTS.appendLog(id, 0, [dart('a'), dart('a'), dart('a')]);
  ok('F5 a stale row is decided by the match', r.ok && getAt(`darts/index/ANABB/${id}`).yourTurn === true);

  // Connect 4 Hoops: pushMove had no "already landed" at all (a retry was refused as not-your-turn).
  const HP = await import('../hoops4/js/mp.js');
  HP.__setBootForTest(boot);
  r = await HP.createGame({ them: { code: 'ANABB', name: 'Ana', emoji: '🦊' } });
  const hid = r.id;
  failIndexWrites = 1;
  r = await HP.pushMove(hid, { col: 3, shots: 1 });
  ok('F5 Hoops: the move lands, the rows do not', !r.ok && r.retryable && Object.keys(getAt(`hoops/games/${hid}/moves`)).length === 1 && !getAt(`hoops/index/ANABB/${hid}`));
  ok('F5 Hoops: the move carries the server\'s time', Object.values(getAt(`hoops/games/${hid}/moves`))[0].at === SRV);
  r = await HP.pushMove(hid, { col: 3, shots: 1 });
  ok('F5 Hoops: the retry is recognised as landed and Ana\'s row is written', r.ok && getAt(`hoops/index/ANABB/${hid}`).yourTurn === true && Object.keys(getAt(`hoops/games/${hid}/moves`)).length === 1);
  HP.__setBootForTest(null);

  // Skeeball: the score lands, the rows do not; the retry rewrites them.
  const SK = await import('../skeeball/js/challenge.js');
  SK.__setBootForTest(boot);
  const leg = { board: 'classic', boardName: 'THE CLASSIC' };
  r = await SK.createChallenge({ them: { code: 'ANABB', name: 'Ana' }, legs: [leg, leg, leg] });
  const sid = r.game.id;
  failIndexWrites = 1;
  r = await SK.postLeg(sid, 'a', 0, 120);
  ok('F5 Skeeball: the score lands, the rows do not', !r.ok && getAt(`skeeChallenges/games/${sid}/a/s/0`) === 120 && !getAt(`skeeChallenges/index/ANABB/${sid}`));
  r = await SK.postLeg(sid, 'a', 0, 120);
  ok('F5 Skeeball: the retry is recognised as landed and Ana\'s row is written', r.ok && getAt(`skeeChallenges/index/ANABB/${sid}`) && getAt(`skeeChallenges/index/ANABB/${sid}`).yourTurn === true);
  ok('F5 Skeeball: the hand-over\'s deadline is the server\'s time + 3 days', Math.abs(getAt(`skeeChallenges/games/${sid}/expires`) - (getAt(`skeeChallenges/games/${sid}/updated`) + 3 * DAY)) < 1000);
  SK.__setBootForTest(null);

  for (const gdir of ['cup-pong', 'battleship', 'chinchon', 'escoba', 'archery', 'battle-arena']) {
    ok(`F5 ${gdir}: an already-landed retry repairs the rows from the match`, /await repairRows\(api, db, fresh, side\); return \{ ok: true, game: fresh \}/.test(src(`${gdir}/js/mp.js`)) && /rowStale\(cur, want\)/.test(src(`${gdir}/js/mp.js`)));
  }
  for (const gdir of ['flick-soccer', 'eight-ball']) {
    ok(`F5 ${gdir}: an already-landed retry rewrites the rows (it already did)`, /if \(!todo\.length\) \{\n[\s\S]{0,400}await writeRows\(api, db, fresh, (side|seat)/.test(src(`${gdir}/js/mp.js`)));
  }
}

Date.now = realNow;
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
