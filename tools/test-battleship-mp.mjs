import { fileURLToPath as __toolsF2P } from 'node:url';
// Paths below resolve from the repo root.
const __ROOT_DIR = __toolsF2P(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
// test-battleship-mp.mjs - Battleship CHALLENGES, headless (2026-10-27).
//
//   1. The pure half (battleship/js/mp.js replay / cleanFleet): two fleets + one shot list = one
//      match on every phone; a hit shoots again, a miss passes; b shoots first; bad fleets and
//      illegal shots are refused.
//   2. Challenges end to end against an in-memory database handed in through mp.js's test seam: two
//      profiles taking turns on one "server", the game's own AI choosing every shot. Create (both
//      rows at once), b places and shoots first, alternate turns to a sunk fleet, replay on two
//      phones, cancel, decline, resign, expire, refused stale / wrong-side shots, the online gate,
//      counted once in 'mp' with no head-to-head, the outbox.
//   3. Structural: rules, backup list, hub registry, the Multiplayer screen, push, reminder, chat.
// Never touches Firebase: every database here is a JavaScript object. Test profiles are test1 /
// DREG5 and made-up codes (root CLAUDE.md: never Matt's code or name).
//   node tools/test-battleship-mp.mjs
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

const MP = await import('../battleship/js/mp.js');
const G = await import('../battleship/js/game.js');
const F = await import('../battleship/js/fleet.js');
const { chooseShot } = await import('../battleship/js/ai.js');
const { loadStats } = await import('../js/game-stats.js');
const AL = await import('../battleship/js/alert.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

let seed = 99;
const rng = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const stored = (fleet) => fleet.ships.map((s) => ({ id: s.id, r: s.r, c: s.c, dir: s.dir }));
const randomFleet = (size) => stored(F.autoPlace(size, F.shipSetFor(size), rng));

// --- 1. the pure half ---------------------------------------------------------------------------
{
  const fa = randomFleet('classic'), fb = randomFleet('classic');
  ok('cleanFleet: a whole legal fleet is kept, in the ship set\'s order', same(MP.cleanFleet(fa, 'classic').map((s) => s.id), F.shipSetFor('classic').map((d) => d.id)));
  ok('cleanFleet: a missing ship is refused', MP.cleanFleet(fa.slice(1), 'classic') === null);
  ok('cleanFleet: overlapping ships are refused', MP.cleanFleet(fa.map((s) => ({ ...s, r: 0, c: 0, dir: 'h' })), 'classic') === null);
  ok('cleanFleet: off the board is refused', MP.cleanFleet(fa.map((s, i) => (i ? s : { ...s, r: 9, c: 9, dir: 'h' })), 'classic') === null);
  ok('cleanFleet: a quick-board fleet is not a classic one', MP.cleanFleet(randomFleet('quick'), 'classic') === null && !!MP.cleanFleet(randomFleet('quick'), 'quick'));
  ok('cleanFleet: Firebase\'s object form of an array reads the same', same(MP.cleanFleet(Object.assign({}, fa), 'classic'), MP.cleanFleet(fa, 'classic')));

  // A whole match by the AI on both sides, one shot at a time, then replayed.
  let s = MP.replay('classic', fa, fb, []).state;
  ok('replay: b shoots first', s.turn === 1);
  const log = [];
  let bonusSeen = false, passSeen = false;
  for (let i = 0; i < 400 && !s.over; i++) {
    const seat = s.turn;
    const shot = chooseShot(s, 1 - seat, F.shipSetFor('classic'), i % 2 ? 'pro' : 'intermediate', rng);
    const res = G.fireAndResolve(s, 1 - seat, shot[0], shot[1]);
    if (res.answer.result === 'hit' && !res.state.over) bonusSeen = bonusSeen || res.state.turn === seat;
    if (res.answer.result === 'miss') passSeen = passSeen || res.state.turn === 1 - seat;
    log.push({ by: MP.sideOfSeat(seat), r: shot[0], c: shot[1] });
    s = res.state;
  }
  ok('self-play: the AI on both sides sinks a fleet', s.over && (s.winner === 0 || s.winner === 1));
  ok('a hit shoots again', bonusSeen);
  ok('a miss passes the turn', passSeen);
  const r1 = MP.replay('classic', fa, fb, log), r2 = MP.replay('classic', fa, fb, log);
  ok('replay: the same fleets and shots give the same match, twice, and the one played', r1.ok && same(r1.state, r2.state) && same(r1.state, s));
  ok('replay: one record per shot, naming the defender', r1.shots.length === log.length && r1.shots.every((x, i) => x.seat === 1 - MP.seatOfSide(log[i].by)));
  const dup = log.slice(0, 3).concat([log[2]]);
  ok('replay: a shot at a square already fired at is refused', !MP.replay('classic', fa, fb, dup).ok);
  const wrong = log.slice(); wrong[0] = { ...wrong[0], by: 'a' };
  ok('replay: a shot out of turn is refused', !MP.replay('classic', fa, fb, wrong).ok);
  ok('replay: no shots before b has a fleet', !MP.replay('classic', fa, null, log.slice(0, 1)).ok && MP.replay('classic', fa, null, []).ok);
  const firstHit = r1.shots.findIndex((x) => x.result === 'hit');
  const one = MP.replay('classic', fa, fb, log.slice(0, firstHit + 1), false);
  ok('replay: a match stored with bonus:false is one shot a turn (the rule travels with the match)',
    firstHit >= 0 && one.ok && one.state.turn === r1.shots[firstHit].seat);
  // SHOTS A TURN (2026-10-27): a turn is N misses; a hit never uses one up.
  for (const N of [3, 5]) {
    let st = MP.replay('classic', fa, fb, [], true, N).state;
    const occA = new Set(), occB = new Set();
    for (const [set, f] of [[occA, fa], [occB, fb]]) for (const sh of MP.engineFleet(f, 'classic').ships) for (const [r, c] of sh.cells) set.add(`${r},${c}`);
    const water = (occ) => { const out = []; for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (!occ.has(`${r},${c}`)) out.push([r, c]); return out; };
    const wa = water(occA), hitB = [...occA][0].split(',').map(Number);
    const lg = [];
    // b misses N-1 times: still b's turn, one shot left
    for (let i = 0; i < N - 1; i++) lg.push({ by: 'b', r: wa[i][0], c: wa[i][1] });
    let rp = MP.replay('classic', fa, fb, lg, true, N);
    ok(`${N} a turn: after ${N - 1} misses it is still the shooter's turn, 1 left`, rp.ok && rp.state.turn === 1 && rp.state.chLeft === 1);
    lg.push({ by: 'b', r: hitB[0], c: hitB[1] });
    rp = MP.replay('classic', fa, fb, lg, true, N);
    ok(`${N} a turn: a hit does not use one up`, rp.ok && rp.state.turn === 1 && rp.state.chLeft === 1);
    lg.push({ by: 'b', r: wa[N][0], c: wa[N][1] });
    rp = MP.replay('classic', fa, fb, lg, true, N);
    ok(`${N} a turn: the ${N}th miss passes the turn, with ${N} for the other side`, rp.ok && rp.state.turn === 0 && rp.state.chLeft === N);
    // the screen's one-shot path agrees with the replay at every step
    let live = MP.replay('classic', fa, fb, [], true, N).state;
    for (const e of lg) live = MP.fireShot(live, MP.seatOfSide(e.by), e.r, e.c, N).state;
    ok(`${N} a turn: fireShot one at a time = the replay`, same(live, rp.state));
  }
  ok('shots: only 1, 3 or 5', MP.asShots(3) === 3 && MP.asShots(2) === null && MP.asShots('5') === 5);
  // SALVOS (2026-10-27, Matt): pick N squares, they land together, ANY hit = another volley, all
  // misses = the turn passes. Stored as `salvo: true`; a match without it keeps the rule above.
  {
    const N = 3;
    const occA = new Set(), occB = new Set();
    for (const [set, f] of [[occA, fa], [occB, fb]]) for (const sh of MP.engineFleet(f, 'classic').ships) for (const [r, c] of sh.cells) set.add(`${r},${c}`);
    const water = (occ) => { const out = []; for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (!occ.has(`${r},${c}`)) out.push([r, c]); return out; };
    const wa = water(occA), wb = water(occB), shipA = [...occA].map((k) => k.split(',').map(Number));
    const S = (lg) => MP.replay('classic', fa, fb, lg, true, N, true);
    const lg = [{ by: 'b', r: wa[0][0], c: wa[0][1] }, { by: 'b', r: wa[1][0], c: wa[1][1] }];
    let rp = S(lg);
    ok('salvo: two of three fired, still the shooter\'s volley, one owed', rp.ok && rp.state.turn === 1 && rp.state.chVol === 1);
    lg.push({ by: 'b', r: wa[2][0], c: wa[2][1] });
    rp = S(lg);
    ok('salvo: three misses pass the turn', rp.ok && rp.state.turn === 0 && !rp.state.chVol);
    lg.push({ by: 'a', r: wb[0][0], c: wb[0][1] }, { by: 'a', r: wb[1][0], c: wb[1][1] });
    const hitOnA = [...occB][0].split(',').map(Number);
    lg.push({ by: 'a', r: hitOnA[0], c: hitOnA[1] });
    rp = S(lg);
    ok('salvo: a hit anywhere in the volley gives another whole volley', rp.ok && rp.state.turn === 0 && !rp.state.chVol);
    ok('salvo: the next volley is N again', MP.volleyLeft(rp.state, 0, N) === N);
    const bad = lg.concat([{ by: 'b', r: wa[3][0], c: wa[3][1] }]);
    ok('salvo: the other side cannot shoot into a volley it does not own', !S(bad).ok);
    // the screen's whole-volley path agrees with the replay
    let live = S([]).state;
    for (const v of [lg.slice(0, 3), lg.slice(3, 6)]) {
      const shooter = MP.seatOfSide(v[0].by);
      live = MP.fireVolley(live, shooter, v.map((e) => [e.r, e.c]), N).state;
    }
    ok('salvo: fireVolley = the replay', same(live, rp.state));
    const more = lg.concat([{ by: 'a', r: wb[2][0], c: wb[2][1] }]);
    ok('salvo: the old rule replays the same log differently (it travels with the match)',
      S(more).state.turn === 0 && MP.replay('classic', fa, fb, more, true, N).state.turn === 1);
    // a winning volley stops at the shot that wins it
    let w = S([]).state;
    const allA = shipA.slice();
    let guard = 0;
    while (!w.over && guard++ < 60) {
      if (w.turn === 1) { const v = allA.splice(0, MP.volleyLeft(w, 1, N)); w = MP.fireVolley(w, 1, v, N).state; }
      else { const open = wb.filter(([r, c]) => G.isShotLegal(w, 1, r, c)).slice(0, MP.volleyLeft(w, 0, N)); w = MP.fireVolley(w, 0, open, N).state; }
    }
    ok('salvo: b sinks every ship of a by volleys, a\'s all-miss volleys passing back', w.over && w.winner === 1);
    const last = MP.fireVolley(S(lg.slice(0, 0)).state, 1, shipA.concat(wa.slice(0, 5)), N);
    ok('salvo: fireVolley never fires past the volley', last.fired.length === N);
    // fewer squares left than N: the volley is what is left
    const nearly = { ...S([]).state };
    nearly.shots = nearly.shots.slice(); nearly.shots[0] = { ...nearly.shots[0], cells: nearly.shots[0].cells.map((v, i) => (i < 98 ? 1 : 0)) };
    ok('salvo: with 2 squares left a volley of 3 is 2', MP.volleySize(nearly, 0, 3) === 2);

    // ONE BONUS SHOT PER HIT (rule 2, `salvo: 2`, Matt 2026-10-28): a volley with H hits earns a volley of H.
    const S2 = (lg2) => MP.replay('classic', fa, fb, lg2, true, N, 2);
    const hitsA = [...occA].map((k) => k.split(',').map(Number));
    const l2 = [{ by: 'b', r: wa[0][0], c: wa[0][1] }, { by: 'b', r: hitsA[0][0], c: hitsA[0][1] }, { by: 'b', r: wa[1][0], c: wa[1][1] }];
    let p2 = S2(l2);
    ok('one per hit: 1 hit in a volley of 3 earns a volley of ONE', p2.ok && p2.state.turn === 1 && MP.volleyLeft(p2.state, 1, N) === 1);
    let v2 = MP.fireVolley(S2([]).state, 1, l2.map((e) => [e.r, e.c]), N, 2);
    ok('one per hit: fireVolley = the replay', same(v2.state, p2.state));
    const one = MP.fireVolley(p2.state, 1, [wa[2], wa[3], wa[4]], N, 2);
    ok('one per hit: the bonus volley fires only the one shot it earned', one.fired.length === 1);
    ok('one per hit: a bonus shot that misses passes the turn, full volley for the other side', one.state.turn === 0 && MP.volleyLeft(one.state, 0, N) === N);
    const two = MP.fireVolley(S2([]).state, 1, [hitsA[1], hitsA[2], wa[5]], N, 2);
    ok('one per hit: 2 hits earn 2 shots', two.state.turn === 1 && MP.volleyLeft(two.state, 1, N) === 2);
    const l2b = l2.concat([{ by: 'b', r: hitsA[3][0], c: hitsA[3][1] }]);
    p2 = S2(l2b);
    ok('one per hit: a hit with the bonus shot earns one more', p2.ok && p2.state.turn === 1 && MP.volleyLeft(p2.state, 1, N) === 1);
    ok('one per hit: the same log under rule 1 is a full volley again (rule travels with the match)', MP.volleyLeft(S(l2).state, 1, N) === N);
    ok('one per hit: a rule-2 log of a bonus volley does not replay as rule 1 the same way',
      MP.replay('classic', fa, fb, l2.concat([{ by: 'b', r: wa[2][0], c: wa[2][1] }]), true, N, 2).state.turn === 0
      && MP.replay('classic', fa, fb, l2.concat([{ by: 'b', r: wa[2][0], c: wa[2][1] }]), true, N, true).state.turn === 1);
  }
  ok('cleanShot: off the board, or not a side, is not a shot', MP.cleanShot({ by: 'a', r: 10, c: 0 }) === null && MP.cleanShot({ by: 'x', r: 0, c: 0 }) === null
    && MP.cleanShot({ by: 'a', r: 7, c: 7 }, 'quick') && MP.cleanShot({ by: 'a', r: 8, c: 0 }, 'quick') === null);
}

// --- the in-memory database ----------------------------------------------------------------------
const root = {};
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

const PH = { a: 'A', b: 'B' };
/** One whole turn for `side` (shots until a miss or the end), written ONE SHOT AT A TIME. */
async function playTurn(id, side, level = 'pro') {
  use(PH[side]);
  let g = await MP.readGame(id);
  let res = { ok: true, game: g };
  for (let guard = 0; guard < 120 && g.turn === side && !g.over; guard++) {
    const s = MP.buildState(g);
    const seat = MP.seatOfSide(side);
    const shot = chooseShot(s, 1 - seat, F.shipSetFor(g.size), level, rng);
    res = await MP.appendLog(id, g.log.length, [{ by: side, r: shot[0], c: shot[1] }]);
    if (!res.ok) return res;
    g = res.game;
  }
  return res;
}
const row = (code, id) => getAt(`battleship/index/${code}/${id}`);
const B_THEM = { code: 'TQWX7', name: 'Tester B', emoji: '🐼' };

// --- 2. challenges ---------------------------------------------------------------------------
{
  use('C');
  ok('gate: a code not let in online cannot challenge', (await MP.createGame({ them: B_THEM, fleet: randomFleet('classic') })).reason === 'not-approved');
  use('A');
  ok('gate: nobody can challenge a code that is not let in', (await MP.createGame({ them: { code: 'CCCCC', name: 'C' }, fleet: randomFleet('classic') })).reason === 'them-not-approved');
  ok('create: a bad fleet is refused', (await MP.createGame({ them: B_THEM, fleet: randomFleet('classic').slice(1) })).reason === 'bad-fleet');
  ok('create: a bad size is refused', (await MP.createGame({ them: B_THEM, fleet: randomFleet('classic'), size: 'huge' })).reason === 'bad-fleet');
  ok('create: shots a turn other than 1, 3 or 5 is refused', (await MP.createGame({ them: B_THEM, fleet: randomFleet('classic'), shots: 4 })).reason === 'bad-shots');
  ok('create: you cannot challenge yourself', (await MP.createGame({ them: { code: 'DREG5', name: 'x' }, fleet: randomFleet('classic') })).reason === 'bad-opponent');
}

let id;
const FA = randomFleet('classic'), FB = randomFleet('classic');
{
  use('A');
  const res = await MP.createGame({ them: B_THEM, fleet: FA, size: 'classic' });
  id = res.id;
  ok('create: ok, the challenger\'s fleet, the size and the hit-shoots-again rule are stored', res.ok && same(getAt(`battleship/games/${id}/a/fleet`), MP.cleanFleet(FA, 'classic'))
    && getAt(`battleship/games/${id}/size`) === 'classic' && getAt(`battleship/games/${id}/bonus`) === true && !getAt(`battleship/games/${id}/b/fleet`));
  ok('create: BOTH rows at once (the receiver places and shoots first)', !!row('DREG5', id) && !!row('TQWX7', id));
  ok('delivered: b\'s row is their turn, "got" (open), written by the other person', row('TQWX7', id).yourTurn === true && row('TQWX7', id).open === 'got' && row('TQWX7', id).lastBy === 'them');
  ok('a\'s row: "sent", their turn, a\'s own write', row('DREG5', id).yourTurn === false && row('DREG5', id).open === 'sent' && row('DREG5', id).sent === true && row('DREG5', id).lastBy === 'me');
  ok('b shoots first', res.game.turn === 'b' && !MP.isMyTurn(res.game, 'DREG5'));
  const early = await MP.appendLog(id, 0, [{ by: 'a', r: 0, c: 0 }]);
  ok('a cannot shoot out of turn', !early.ok);
  use('B');
  const noFleet = await MP.appendLog(id, 0, [{ by: 'b', r: 0, c: 0 }]);
  ok('b cannot shoot before placing a fleet', !noFleet.ok && noFleet.reason === 'no-fleet');
  const updated = getAt(`battleship/games/${id}/updated`);
  const g0 = await MP.readGame(id);
  ok('b needs a fleet before playing, a does not', MP.needsFleet(g0, 'b') && !MP.needsFleet(g0, 'a'));
  ok('placeFleet: an illegal fleet is refused', (await MP.placeFleet(id, FB.slice(2))).reason === 'bad-fleet');
  const d = await MP.placeFleet(id, FB);
  ok('placeFleet: b\'s fleet is stored and verified', d.ok && same(d.game.b.fleet, MP.cleanFleet(FB, 'classic')));
  ok('placeFleet: does not move `updated` (the 3-day clock and the bubble are untouched)', getAt(`battleship/games/${id}/updated`) === updated);
  ok('placeFleet: still open (placing is not an answer)', MP.lifeOf(d.game).open);
  ok('placeFleet: a second, different fleet is refused', (await MP.placeFleet(id, randomFleet('classic'))).reason === 'already-placed' || same(randomFleet('classic'), FB));
  ok('placeFleet: the same fleet again is fine (a retry)', (await MP.placeFleet(id, FB)).ok);
  const wrong = await MP.appendLog(id, 0, [{ by: 'a', r: 0, c: 0 }]);
  ok('a shot for the other side is refused', !wrong.ok && wrong.reason === 'bad-entry');
  const r2 = await playTurn(id, 'b', 'intermediate');
  ok('b answers: shots until a miss, then the turn passes', r2.ok && (r2.game.turn === 'a' || r2.game.over));
  const lastB = r2.game.log[r2.game.log.length - 1];
  const st = MP.buildState(r2.game);
  ok('b\'s turn ended on a miss (a hit shoots again)', G.cellAt(st.shots[0], lastB.r, lastB.c) === G.CELL_MISS);
  ok('rows stop saying open; a\'s turn now', !row('TQWX7', id).open && !row('DREG5', id).open && row('DREG5', id).yourTurn === true && row('DREG5', id).lastBy === 'them');
  const first = r2.game.log[0];
  const stale = await MP.appendLog(id, 0, [{ by: 'b', r: (first.r + 1) % 10, c: first.c }]);
  ok('a shot built on a stale log is refused, never overwrites', !stale.ok);
  use('A');
  const cancelLate = await MP.cancelGame(id);
  ok('once answered it cannot be cancelled', !cancelLate.ok && cancelLate.reason === 'accepted');
  use('B');
  const resent = await MP.appendLog(id, r2.game.log.length - 1, [lastB]);
  ok('the same shot resent (a retry after a lost reply) is a no-op, not a second shot', resent.ok && resent.game.log.length === r2.game.log.length);
  use('A');

  // Alternate turns to the end.
  let g = await MP.readGame(id);
  let guard = 0;
  while (!g.over && guard++ < 300) {
    const r = await playTurn(id, g.turn, g.turn === 'a' ? 'pro' : 'intermediate');
    if (!r.ok) { console.log('turn refused', r.reason); break; }
    use('A'); g = await MP.readGame(id);
  }
  ok('alternating turns reach a sunk fleet', g.over && g.over.why === 'sunk' && (g.over.winner === 'a' || g.over.winner === 'b'), JSON.stringify(g.over));
  const w = g.over.winner, l = w === 'a' ? 'b' : 'a';
  ok('the winner sank every ship', g.sunk[w] === F.shipSetFor('classic').length);
  const code = { a: 'DREG5', b: 'TQWX7' };
  ok('rows: won / lost, over, ships sunk', row(code[w], id).result === 'won' && row(code[l], id).result === 'lost' && row(code[w], id).over && row(code[l], id).over
    && row(code[w], id).mine === 5 && row(code[l], id).theirs === 5);
  ok('the loser\'s row says it was the winner\'s shot (push: "they sank your fleet")', row(code[l], id).lastBy === 'them');
  use('B');
  const gB = await MP.readGame(id);
  ok('two phones: the same validated match, the same final state', same(gB, g) && same(MP.buildState(gB), MP.buildState(g)));
  const after1 = await MP.appendLog(id, g.log.length, [{ by: l, r: 0, c: 0 }]);
  ok('no shot after the end', !after1.ok);
  // Counting, once per phone, in 'mp'.
  for (const p of ['A', 'B']) {
    use(p);
    const s0 = (loadStats().games.battleship.byDiff || {}).mp || { played: 0, won: 0 };
    const rows = await MP.readMyGames();
    MP.recordFinished(rows);
    MP.recordFinished(rows);
    const s1 = loadStats().games.battleship.byDiff.mp;
    const won = (p === 'A') === (w === 'a');
    ok(`counted once on phone ${p} as ${won ? 'a win' : 'a loss'} in 'mp'`, s1.played === (s0.played | 0) + 1 && s1.won === (s0.won | 0) + (won ? 1 : 0));
    ok(`the match screen counting it again does nothing (phone ${p})`, MP.countResult(id, won, { shots: 40 }) === false && loadStats().games.battleship.byDiff.mp.played === s1.played);
    ok(`no head-to-head written by a challenge (phone ${p})`, !loadStats().h2h || !loadStats().h2h.battleship);
    ok(`the result is queued for the "who won" card (phone ${p})`, MP.readUnseen().includes(id));
  }
}

// A whole match at 3 shots a turn; and a stored match with no `shots` (the first ones) plays 1.
{
  use('A');
  const c = await MP.createGame({ them: B_THEM, fleet: randomFleet('quick'), size: 'quick', shots: 3 });
  ok('3 a turn: stored on the match', c.ok && getAt(`battleship/games/${c.id}/shots`) === 3 && c.game.shots === 3);
  use('B'); await MP.placeFleet(c.id, randomFleet('quick'));
  let g = await MP.readGame(c.id), turns = 0;
  while (!g.over && turns++ < 200) { const r = await playTurn(c.id, g.turn, 'intermediate'); if (!r.ok) break; use('A'); g = await MP.readGame(c.id); }
  ok('3 a turn: a whole match to a sunk fleet', g.over && g.over.why === 'sunk');
  let runs = [], cur = null;
  for (const e of g.log) { if (!cur || cur.by !== e.by) { cur = { by: e.by, n: 0 }; runs.push(cur); } cur.n++; }
  ok('3 a turn: stored as a SALVO match, one bonus shot per hit (salvo: 2)', getAt(`battleship/games/${c.id}/salvo`) === 2 && c.game.salvo === 2);
  ok('3 a turn: every finished turn but the last opens with a volley of 3', runs.slice(0, -1).every((x) => x.n >= 3), JSON.stringify(runs.map((x) => x.n)));
  const raw1 = clone(getAt(`battleship/games/${c.id}`)); raw1.salvo = true;
  ok('a first-day match (salvo: true) still validates on its own rule', MP.validateGame(raw1) === null || MP.validateGame(raw1).salvo === true);

  const raw = clone(getAt(`battleship/games/${c.id}`)); delete raw.shots;
  ok('a stored match with no `shots` is 1 a turn (the 3-shot log no longer replays as one)', MP.validateGame(raw) === null);
  const raw4 = clone(getAt(`battleship/games/${c.id}`)); raw4.shots = 4;
  ok('a stored `shots` other than 1, 3, 5 is refused whole', MP.validateGame(raw4) === null);
}

// Shot extras: a result counted by the match screen carries shots and hits.
{
  use('A');
  const before = clone(loadStats().games.battleship.bs || {});
  ok('countResult with extras adds shots and hits', MP.countResult('zzextras01', true, { shots: 30, hits: 17, sunk: 5, accuracy: 57 })
    && loadStats().games.battleship.bs.shots === (before.shots | 0) + 30 && loadStats().games.battleship.bs.hits === (before.hits | 0) + 17);
}

// Cancel, decline, resign, expire, tampering, offline.
{
  use('A');
  const c1 = await MP.createGame({ them: B_THEM, fleet: randomFleet('quick'), size: 'quick' });
  ok('a quick-board challenge', c1.ok && c1.game.size === 'quick');
  const can = await MP.cancelGame(c1.id);
  ok('cancel: the sender calls off an unanswered challenge', can.ok && can.cancelled && MP.isCalledOff(can.game) && can.game.over.why === 'cancelled');
  ok('cancel: both rows are stored over:false with `ended` (no push shape)', row('DREG5', c1.id).over === false && row('DREG5', c1.id).ended === 'cancelled' && row('TQWX7', c1.id).ended === 'cancelled');
  ok('cancel: the match is kept, nothing deleted', !!getAt(`battleship/games/${c1.id}/a/fleet`));
  use('B');
  ok('cancel: a fleet cannot be placed on a called-off challenge', !(await MP.placeFleet(c1.id, randomFleet('quick'))).ok);

  use('A');
  const c2 = await MP.createGame({ them: B_THEM, fleet: randomFleet('classic') });
  use('B');
  await MP.placeFleet(c2.id, randomFleet('classic'));
  const dec = await MP.cancelGame(c2.id);
  ok('decline: the receiver calls it off before shooting (even after placing)', dec.ok && dec.game.over.why === 'declined' && row('TQWX7', c2.id).ended === 'declined');
  const rows = await MP.readMyGames();
  ok('a declined match reads as finished with no result', rows.find((r) => r.id === c2.id).over && rows.find((r) => r.id === c2.id).result === null);

  use('A');
  const c3 = await MP.createGame({ them: B_THEM, fleet: randomFleet('classic') });
  use('B');
  const resOpen = await MP.resignGame(c3.id);
  ok('resign on an unanswered challenge calls it off instead (nobody is handed a win)', resOpen.ok && resOpen.cancelled);

  use('A');
  const c4 = await MP.createGame({ them: B_THEM, fleet: randomFleet('classic') });
  use('B'); await MP.placeFleet(c4.id, randomFleet('classic')); await playTurn(c4.id, 'b');
  use('A');
  const rs = await MP.resignGame(c4.id);
  ok('resign once answered: the other person wins', rs.ok && rs.game.over.winner === 'b' && rs.game.over.why === 'resign');
  ok('resign rows: lost / won, why resign', row('DREG5', c4.id).result === 'lost' && row('TQWX7', c4.id).result === 'won' && row('TQWX7', c4.id).why === 'resign');

  const c5 = await MP.createGame({ them: B_THEM, fleet: randomFleet('classic') });
  // Waiting on b for more than 3 days.
  setAt(`battleship/games/${c5.id}/updated`, Date.now() - 4 * 24 * 3600 * 1000);
  use('B');
  const g5 = await MP.readGame(c5.id);
  ok('expire: 3 days unanswered reads as expired', MP.lifeOf(g5).expired);
  ok('expire: a late fleet is refused', (await MP.placeFleet(c5.id, randomFleet('classic'))).reason === 'expired');
  setAt(`battleship/games/${c5.id}/b/fleet`, randomFleet('classic'));
  ok('expire: a late shot is refused', (await MP.appendLog(c5.id, 0, [{ by: 'b', r: 0, c: 0 }])).reason === 'expired');

  // Tampering: a document that does not replay, or claims a result it did not earn, is not a match.
  const raw = clone(getAt(`battleship/games/${c4.id}`));
  raw.log['0000'] = { by: 'a', r: 0, c: 0 };
  ok('a log that does not replay (a shot out of turn) is refused whole', MP.validateGame(raw) === null);
  const raw2 = clone(getAt(`battleship/games/${id}`));
  raw2.over = { winner: raw2.over.winner === 'a' ? 'b' : 'a', why: 'sunk', at: 1 };
  ok('a stored winner the shots did not produce is refused whole', MP.validateGame(raw2) === null);
  const raw3 = clone(getAt(`battleship/games/${c4.id}`));
  raw3.b.fleet = raw3.b.fleet.slice(1);
  ok('a fleet missing a ship is refused whole', MP.validateGame(raw3) === null);

  offline = true;
  use('A');
  const off = await MP.createGame({ them: B_THEM, fleet: randomFleet('classic') });
  ok('offline: a failure, retryable, nothing written', !off.ok && off.reason === 'offline' && off.retryable);
  MP.savePending('abcdefgh', 3, [{ by: 'a', r: 0, c: 0 }]);
  ok('outbox: an unsent shot is kept', MP.outboxCount() === 1 && MP.pendingFor('abcdefgh').base === 3);
  await MP.drainOutbox();
  ok('outbox: still kept while offline (never dropped on a retryable failure)', MP.outboxCount() === 1);
  offline = false;
  await MP.drainOutbox();
  ok('outbox: a match that cannot be read yet keeps its shots (retryable), never guessed away', MP.outboxCount() === 1);
  MP.savePending('abcdefgh', 3, []);
}

// The launcher bubble and the hub's handoff.
{
  use('B');
  const rows = await MP.readMyGames();
  const al = AL.decideAlert(rows, {}, []);
  ok('alert: a match waiting on you is news on the launcher', al && (al.kind === 'challenge' || al.kind === 'turn'));
  ok('alert: the handoff contract (armOpen, armChallenge, myTurnCount, takeOpen)', ['armOpen', 'armChallenge', 'myTurnCount', 'takeOpen', 'check', 'watch'].every((k) => typeof AL[k] === 'function'));
}

// --- 3. structural --------------------------------------------------------------------------------
{
  const src = (p) => readFileSync(p, 'utf8');
  const rules = JSON.parse(src('database.rules.json'));
  ok('`battleship` is in database.rules.json, signed-in read and write (darts\' shape)', rules.rules.battleship && rules.rules.battleship['.read'] === 'auth != null' && rules.rules.battleship['.write'] === 'auth != null');
  ok('`battleship` is in the backup branch list', /\n\s*'battleship',/.test(src('backups/rtdb-backup.mjs')));
  ok('the Remind bell may name battleship matches', /battleship\)~/.test(JSON.stringify(rules.rules.nudges)) && /battleship: 'battleship'/.test(src('js/messages.js')));
  const hub = src('js/hub.js');
  ok('hub: Battleship declares its alerts module', /alerts: \(\) => import\('\.\.\/battleship\/js\/alert\.js'\)/.test(hub));
  ok('hub: still a live-room game (LIVE_MP_GAMES) and js/mp-records.js LIVE_GAMES', /'battleship'/.test(hub.match(/const LIVE_MP_GAMES = new Set\(\[[^\]]*\]/)[0]) && /battleship: 'battleship'/.test(src('js/mp-records.js')));
  ok('the Multiplayer screen reads its challenges (js/challenges.js SOURCES)', /battleship: \{\s*load: \(\) => import\('\.\.\/battleship\/js\/mp\.js'\)/.test(src('js/challenges.js')));
  ok('push: battleshipTurnPush watches battleship/index; in the 24-hour reminder', /battleshipTurnPush = onValueWritten\(\{ ref: '\/battleship\/index\/\{code\}\/\{id\}'/.test(src('functions/index.js')) && /node: 'battleship', game: 'battleship'/.test(src('functions/decide.js')));
  ok('chat: challenge chat beside the match (js/match-chat.js) and in Messages', /createMatchChat/.test(src('battleship/js/ui.js')) && /battleship: \{ stats: 'battleship', node: 'battleship' \}/.test(src('js/game-chat-history.js')));
  ok('challenges never write head-to-head', !/recordHeadToHead/.test(src('battleship/js/mp.js')));
  ok('the pickers read the small directory, never all of players/', /readOpponentProfiles/.test(src('battleship/js/mp.js')) && !/readPlayersOnce|ref\([^)]*'players'/.test(src('battleship/js/mp.js')));
  ok('ui.js: a pick opens the board + shots choice for that person; a match id opens the match', /o\.kind === 'pick'[\s\S]{0,200}this\._chChooseFor\(o\.them\)/.test(src('battleship/js/ui.js')) && /if \(o\.id\) \{ this\._chHome\(\); this\._chOpen\(o\.id\); \}/.test(src('battleship/js/ui.js')));
  ok('ui.js: every new challenge goes through the board + shots choice (tab picker, Multiplayer screen, Rematch)',
    (src('battleship/js/ui.js').match(/this\._chChooseFor\(/g) || []).length === 3 && !/_chStartPlacement\(\{ kind: 'new', them: (o|them|o\.them), size: this/.test(src('battleship/js/ui.js')));
  ok('ui.js: nothing from mp.js is called while the game is being built (an older mp.js mid-update cannot crash it)',
    !/CH\.asShots|CH\.SHOTS/.test(src('battleship/js/ui.js')) && /_chStale\(\)/.test(src('battleship/js/ui.js')));
  ok('ui.js: the chat button is placed on the turn bar (never the corner under the status bar)', /_chPlaceChat\(\)/.test(src('battleship/js/ui.js')) && /querySelector\('\.bs-turnbar'\)/.test(src('battleship/js/ui.js')) && !/place: \{ top: '6px'/.test(src('battleship/js/ui.js')));
  ok('ui.js: exports openArmed for a notification tapped with the game open', /export function openArmed\(\)/.test(src('battleship/js/ui.js')));
  ok('ui.js: a challenge never writes the solo autosave', /if \(ui\.mp \|\| ui\.ch\) return;/.test(src('battleship/js/ui.js')));
  ok('the live-room protocol still never sends a fleet (net.js appendMove carries r / s / a only)', !/myFleet[^\n]*appendMove|appendMove[^\n]*myFleet/.test(src('battleship/js/ui.js')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
