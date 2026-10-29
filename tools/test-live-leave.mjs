// tools/test-live-leave.mjs - leaving a live room (docs/INTEGRITY-CHECKS-SPEC.md, "Holes closed
// 2026-10-29 (second pass): leaving live rooms, quitting once dealt"). Run: node tools/test-live-leave.mjs
//
//   L1  js/live-leave.js + js/game-stats.js on two phones (two separate fake localStorages) sharing one
//       fake room: leaving after your first move records ONE loss for the leaver (the game's own
//       recorder, 'mp' bucket, plus head-to-head) and ONE win for the other phone; nothing before the
//       first move; never twice (the gamehub.liveCounted.v1 ledger), and never on top of a game that
//       ended normally.
//   L2  "Claim win": the absent phone's loss is recorded when it comes back (checkRejoin), or by its
//       armed marker when it never does (the hub's 30-minute settle), once either way.
//   L3  3-4 seat tables: only the leaver records; a claim at a table records the absent seat's loss only.
//   L4  wiring: every live-room game arms on its own move, records once, ends the room with the forfeit,
//       offers Claim win, detaches on destroy (or forfeits where it has no rejoin), and the hub resigns
//       on a confirmed leave. Strings in EN and ES, no em dashes.
//
// Node only, no deps, never the real database (a fake net object), a made-up player code.

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name, extra); } };
const ROOT = new URL('../', import.meta.url);
const src = (p) => readFileSync(new URL(p, ROOT), 'utf8');

// Two phones: each has its own storage; `on(phone)` makes it the active one.
const stores = { A: new Map(), B: new Map(), C: new Map() };
let cur = stores.A;
globalThis.localStorage = {
  getItem: (k) => (cur.has(k) ? cur.get(k) : null),
  setItem: (k, v) => void cur.set(k, String(v)),
  removeItem: (k) => void cur.delete(k),
  clear: () => cur.clear(),
  key: (i) => Array.from(cur.keys())[i] ?? null,
  get length() { return cur.size; },
};
const on = (p) => { cur = stores[p]; };
const G = await import('../js/game-stats.js');
const LL = await import('../js/live-leave.js');
const profile = (code, name) => cur.set('gamehub.profile', JSON.stringify({ version: 1, name, playerId: code }));
const stats = () => JSON.parse(cur.get(G.statsKey()) || 'null');
const ttt = () => (stats() && stats().games.tictactoe) || null;
const h2hOf = (game) => (stats() && stats().h2h && stats().h2h[game]) || {};

for (const [p, code, name] of [['A', 'TQWAX', 'zzta'], ['B', 'TQWBX', 'zztb'], ['C', 'TQWCX', 'zztc']]) {
  on(p); profile(code, name); cur.set('gamehub.devAllowSync.v1', '0');
}
on('A'); const devA = G.deviceId();
on('B'); const devB = G.deviceId();

// A fake js/net.js: one shared rooms map; leaveRoom writes status + forfeit in ONE update, as net.js does.
const rooms = {};
const fakeNet = {
  async leaveRoom(code, role, forfeit) {
    const r = rooms[code] || (rooms[code] = {});
    r.status = 'ended';
    if (forfeit && forfeit.seat != null) { r.forfeit = r.forfeit || {}; r.forfeit[String(forfeit.seat)] = forfeit; }
  },
  async readRoom(code) { return { room: rooms[code] ? JSON.parse(JSON.stringify(rooms[code])) : null }; },
};
const room = (code, extra = {}) => { rooms[code] = { status: 'active', host: { deviceId: devA, name: 'zzta' }, guest: { deviceId: devB, name: 'zztb' }, ...extra }; return code; };
const ARGS = (won) => ['classic', 'mp', won];

// --- L1: the leaver loses, the other wins, once ------------------------------------------------------
room('ROOM1');
const k1 = LL.liveKey('tictactoe', 'ROOM1', 1);
on('A');
ok('L1 nothing armed before the first move: leaving costs nothing', !LL.leaveCosts('tictactoe', k1));
LL.armLeave('tictactoe', k1, 'recordTicTacToe', ARGS(false), [{ deviceId: devB, name: 'zztb' }]);
ok('L1 the first move arms the leave', LL.leaveCosts('tictactoe', k1) && LL.armedKey('tictactoe') === k1);
ok('L1 a different game in the same room is not this one', !LL.leaveCosts('tictactoe', LL.liveKey('tictactoe', 'ROOM1', 2)));
ok('L1 leaving records the loss', LL.forfeitNow('tictactoe') === true);
await LL.leaveWithForfeit(fakeNet, 'ROOM1', 'host', 'host', 1);
let g = ttt();
ok('L1 the leaver: exactly one loss in the mp bucket, through recordTicTacToe (its tt counter too)',
  g && g.total.played === 1 && g.total.lost === 1 && g.byDiff.mp.lost === 1 && g.tt && g.tt.classic.lost === 1, JSON.stringify(g && g.total));
ok('L1 the leaver: head-to-head loss against the other phone', (h2hOf('tictactoe')[devB] || {}).l === 1);
ok('L1 the leaver: a second leave records nothing', LL.forfeitNow('tictactoe') === false && ttt().total.played === 1);
const log = JSON.parse(cur.get('gamehub.playlog.v1') || '[]');
ok('L1 the play log says the loss was a leave', log.some((x) => x.f === 'quitLoss' && x.g === 'tictactoe@live'));
ok('L1 the room ended with the forfeit in the same write', rooms.ROOM1.status === 'ended' && rooms.ROOM1.forfeit.host.n === 1 && !rooms.ROOM1.forfeit.host.claim);

on('B');
LL.armLeave('tictactoe', k1, 'recordTicTacToe', ARGS(false), [{ deviceId: devA, name: 'zzta' }]);
const o1 = { statsId: 'tictactoe', key: k1, n: 1, mySeat: 'guest', fn: 'recordTicTacToe', winArgs: ARGS(true), opps: [{ deviceId: devA, name: 'zzta' }] };
ok('L1 the other phone: the leave is its WIN', LL.onRoomEnded(rooms.ROOM1, o1) === 'won');
g = ttt();
ok('L1 the other phone: exactly one win, its own armed leave dropped', g.total.won === 1 && g.total.played === 1 && !LL.armedKey('tictactoe'));
ok('L1 the other phone: head-to-head win', (h2hOf('tictactoe')[devA] || {}).w === 1);
LL.onRoomEnded(rooms.ROOM1, o1);
ok('L1 the other phone: the same end seen again adds nothing', ttt().total.played === 1);
ok('L1 a forfeit for ANOTHER game number is not this game\'s', LL.forfeitsOf(rooms.ROOM1, 2).length === 0);

// A game that ended normally, then a late forfeit for it: nothing more.
room('ROOM2');
const k2 = LL.liveKey('tictactoe', 'ROOM2', 1);
on('B'); LL.armLeave('tictactoe', k2, 'recordTicTacToe', ARGS(false), []);
G.recordTicTacToe('classic', 'mp', true); LL.endedNormally('tictactoe', k2);
const before = ttt().total.played;
rooms.ROOM2.status = 'ended'; rooms.ROOM2.forfeit = { host: { seat: 'host', n: 1, at: 1 } };
LL.onRoomEnded(rooms.ROOM2, { ...o1, key: k2 });
ok('L1 a forfeit arriving after the game ended normally adds nothing', ttt().total.played === before && LL.alreadyCounted(k2));
ok('L1 a counted game cannot be armed again', (LL.armLeave('tictactoe', k2, 'recordTicTacToe', ARGS(false), []), !LL.armedKey('tictactoe')));

// A plain leave (an older build, or a leave before anyone moved): nothing, and the armed leave is dropped.
room('ROOM3');
const k3 = LL.liveKey('tictactoe', 'ROOM3', 1);
on('B'); LL.armLeave('tictactoe', k3, 'recordTicTacToe', ARGS(false), []);
const b3 = ttt().total.played;
await fakeNet.leaveRoom('ROOM3', 'host');
ok('L1 a plain leave by the other: nothing recorded here, the armed leave dropped',
  LL.onRoomEnded(rooms.ROOM3, { ...o1, key: k3 }) === 'none' && ttt().total.played === b3 && !LL.armedKey('tictactoe'));

// --- L2: Claim win ----------------------------------------------------------------------------------
room('ROOM4');
const k4 = LL.liveKey('tictactoe', 'ROOM4', 3);
on('A'); const a0 = ttt().total.played;
LL.armLeave('tictactoe', k4, 'recordTicTacToe', ARGS(false), [{ deviceId: devB, name: 'zztb' }]);
LL.detachLeave('tictactoe');               // A closed the app (destroy: detach, the leave stays armed)
on('B'); const b0 = ttt().total.won;
ok('L2 awayMs reads a seat\'s silence', LL.awayMs({ lastSeen: 1000 }, 1000 + LL.CLAIM_MS) === LL.CLAIM_MS && LL.awayMs(null) === 0);
ok('L2 the claimer records its win once', LL.recordLeaveWin('tictactoe', k4, 'recordTicTacToe', ARGS(true), [{ deviceId: devA, name: 'zzta' }]) === true
  && LL.recordLeaveWin('tictactoe', k4, 'recordTicTacToe', ARGS(true), []) === false && ttt().total.won === b0 + 1);
await LL.leaveWithForfeit(fakeNet, 'ROOM4', 'guest', 'host', 3, true);
ok('L2 the claim is written against the absent seat', rooms.ROOM4.forfeit.host.claim === true && rooms.ROOM4.status === 'ended');
on('A');
let chk = await LL.checkRejoin(fakeNet, 'ROOM4', { statsId: 'tictactoe', key: k4, n: 3, mySeat: 'host', role: 'host', fn: 'recordTicTacToe', winArgs: ARGS(true), oppsOf: (r) => [r.guest] });
ok('L2 the absent phone comes back: no rejoin, its LOSS recorded once', !chk.go && chk.res === 'lost' && ttt().total.played === a0 + 1 && ttt().total.lost >= 2);
chk = await LL.checkRejoin(fakeNet, 'ROOM4', { statsId: 'tictactoe', key: k4, n: 3, mySeat: 'host', role: 'host', fn: 'recordTicTacToe', winArgs: ARGS(true), oppsOf: (r) => [r.guest] });
ok('L2 ...and only once', ttt().total.played === a0 + 1);

// Never comes back: the hub settles the marker after 30 minutes, once; a later rejoin forfeits, not resumes.
room('ROOM5');
const k5 = LL.liveKey('tictactoe', 'ROOM5', 1);
on('A'); const a5 = ttt().total.played;
LL.armLeave('tictactoe', k5, 'recordTicTacToe', ARGS(false), []);
LL.detachLeave('tictactoe');
G.settleQuitLosses(30 * 60 * 1000);
ok('L2 the hub leaves a fresh marker alone (a page may still be playing it)', ttt().total.played === a5 && LL.armedKey('tictactoe') === k5);
const q = JSON.parse(cur.get('gamehub.quitLoss.v1')); q['tictactoe@live'].t -= 31 * 60 * 1000; cur.set('gamehub.quitLoss.v1', JSON.stringify(q));
G.settleQuitLosses(30 * 60 * 1000);
ok('L2 a marker 30+ minutes old: ONE loss, by the hub', ttt().total.played === a5 + 1 && !LL.armedKey('tictactoe'));
chk = await LL.checkRejoin(fakeNet, 'ROOM5', { statsId: 'tictactoe', key: k5, n: 1, mySeat: 'host', role: 'host', fn: 'recordTicTacToe', winArgs: ARGS(true), oppsOf: (r) => [r.guest] });
ok('L2 a rejoin after that does not resume: it leaves with its own forfeit, records nothing more',
  !chk.go && chk.res === 'lost' && ttt().total.played === a5 + 1 && rooms.ROOM5.forfeit.host && !rooms.ROOM5.forfeit.host.claim);
on('B'); const b5 = ttt().total.won;
LL.onRoomEnded(rooms.ROOM5, { ...o1, key: k5, n: 1 });
ok('L2 ...so the other phone still gets its win', ttt().total.won === b5 + 1);

// A live room still on: rejoin goes ahead and keeps the marker fresh; a room that is gone: the loss stands.
room('ROOM6');
const k6 = LL.liveKey('tictactoe', 'ROOM6', 1);
on('A'); LL.armLeave('tictactoe', k6, 'recordTicTacToe', ARGS(false), []);
chk = await LL.checkRejoin(fakeNet, 'ROOM6', { statsId: 'tictactoe', key: k6, n: 1, mySeat: 'host', role: 'host', fn: 'recordTicTacToe', winArgs: ARGS(true) });
ok('L2 a live room: the rejoin goes ahead, the leave still armed', chk.go && LL.armedKey('tictactoe') === k6);
delete rooms.ROOM6;
const a6 = ttt().total.played;
chk = await LL.checkRejoin(fakeNet, 'ROOM6', { statsId: 'tictactoe', key: k6, n: 1, mySeat: 'host', role: 'host', fn: 'recordTicTacToe', winArgs: ARGS(true) });
ok('L2 a room that is gone: no rejoin, the armed loss stands (once)', !chk.go && ttt().total.played === a6 + 1);
ok('L2 offline (the room cannot be read): rejoin as before, nothing decided',
  (await LL.checkRejoin({ readRoom: async () => ({ error: 'offline' }) }, 'X', { statsId: 'tictactoe', key: 'k', n: 1 })).go === true);

// Another game's marker found at a rejoin of a different match is that game's loss.
on('A'); const a7 = ttt().total.played;
LL.armLeave('tictactoe', LL.liveKey('tictactoe', 'OLD1', 1), 'recordTicTacToe', ARGS(false), []);
LL.resumeLeave('tictactoe', LL.liveKey('tictactoe', 'NEW1', 1));
ok('L2 a marker from a match that died, found at another rejoin: its loss, once', ttt().total.played === a7 + 1 && !LL.armedKey('tictactoe'));
LL.armLeave('tictactoe', LL.liveKey('tictactoe', 'OLD2', 1), 'recordTicTacToe', ARGS(false), []);
LL.settleLeave('tictactoe');
ok('L2 a mount with nothing to rejoin settles it (settleLeave)', ttt().total.played === a7 + 2);

// --- L3: 3-4 seat tables ------------------------------------------------------------------------------
rooms.T4 = { status: 'active' };
const kT = LL.liveKey('chinchon', 'T4', 1);
on('C');
const c0 = JSON.parse(JSON.stringify((stats() && stats().games.chinchon && stats().games.chinchon.total) || { played: 0 }));
LL.armLeave('chinchon', kT, 'recordChinchon', ['mp', false, { closed: 0, minusTen: 0, chinchons: 0 }], []);
await LL.leaveWithForfeit(fakeNet, 'T4', 1, 1, 1);
on('C'); const oT = { statsId: 'chinchon', key: kT, n: 1, seats: 3, fn: 'recordChinchon', winArgs: ['mp', true, {}], opps: [] };
ok('L3 three seats: another seat records NOTHING for a leave (nobody beat the table)', LL.onRoomEnded(rooms.T4, { ...oT, mySeat: 2 }) === 'none'
  && ((stats() && stats().games.chinchon && stats().games.chinchon.total.played) | 0) === (c0.played | 0) && !LL.armedKey('chinchon'));
rooms.T5 = { status: 'active' };
const kT5 = LL.liveKey('chinchon', 'T5', 1);
on('C'); LL.armLeave('chinchon', kT5, 'recordChinchon', ['mp', false, { closed: 0, minusTen: 0, chinchons: 0 }], []);
await LL.leaveWithForfeit(fakeNet, 'T5', 0, 2, 1, true);   // seat 0 leaves claiming against silent seat 2
ok('L3 a claim at a table is the ABSENT seat\'s loss', LL.onRoomEnded(rooms.T5, { ...oT, key: kT5, mySeat: 2 }) === 'lost'
  && stats().games.chinchon.byDiff.mp.lost === 1);

// --- L4: wiring ------------------------------------------------------------------------------------------
const GAMES = {
  'tic-tac-toe/js/ui.js': { rejoin: true }, 'mancala/js/ui.js': { rejoin: true }, 'filler/js/ui.js': { rejoin: true },
  'dots-boxes/js/ui.js': { rejoin: true }, 'battleship/js/ui.js': { rejoin: true }, 'chinchon/js/ui.js': { rejoin: true },
  'escoba/js/ui.js': { rejoin: true }, 'boggle/js/ui.js': { rejoin: true },
  'yahtzee/js/ui.js': { rejoin: false }, 'air-hockey/js/ui.js': { rejoin: false }, 'hoops4/js/ui.js': { rejoin: false },
};
for (const [file, o] of Object.entries(GAMES)) {
  const s = src(file);
  const name = file.split('/')[0];
  ok(`L4 ${name}: imports js/live-leave.js`, s.includes("from '../../js/live-leave.js'"));
  ok(`L4 ${name}: arms the leave on its own move`, /LL\.armLeave\(/.test(s));
  ok(`L4 ${name}: a leave that decides ends the room WITH the forfeit`, /LL\.leaveWithForfeit\(/.test(s));
  ok(`L4 ${name}: reads the forfeit when the room ends`, /LL\.onRoomEnded\(/.test(s));
  ok(`L4 ${name}: records the leaver's loss through the armed marker`, /LL\.forfeitNow\(/.test(s));
  ok(`L4 ${name}: offers Claim win`, /LL\.showClaim\(/.test(s) && /LL\.recordLeaveWin\(/.test(s));
  ok(`L4 ${name}: a normal result counts once (alreadyCounted + endedNormally)`, /LL\.alreadyCounted\(/.test(s) && /LL\.endedNormally\(/.test(s));
  ok(`L4 ${name}: a page that died is settled at mount`, /LL\.settleLeave\(/.test(s));
  if (o.rejoin) {
    ok(`L4 ${name}: destroy only detaches (closing is not leaving)`, /LL\.detachLeave\(/.test(s));
    ok(`L4 ${name}: a rejoin checks whether a leave decided the game`, /LL\.checkRejoin\(/.test(s));
    ok(`L4 ${name}: the hub's confirmed leave resigns (leaveMatch)`, /export function leaveMatch\(/.test(s));
  }
  ok(`L4 ${name}: the hub's confirm knows the leave costs (quitCostsLoss)`, /export function quitCostsLoss\(|quitCostsLoss\(\)\s*\{/.test(s));
}
const ba = src('battle-arena/js/live.js');
ok('L4 battle-arena: its live leave is armed too, and a settled loss is not counted again',
  /LL\.armLeave\(/.test(ba) && /LL\.alreadyCounted\(/.test(ba) && /LL\.detachLeave\(/.test(ba) && src('battle-arena/js/online-ui.js').includes('this.room.llKey()'));
const hub = src('js/hub.js');
ok('L4 hub: a confirmed leave calls the game\'s leaveMatch() before unmounting', /confirm-leave[\s\S]{0,600}m\.leaveMatch\(\)[\s\S]{0,200}this\.showLauncher\(\)/.test(hub));
const net = src('js/net.js');
ok('L4 net.js: the forfeit is written in the SAME update as the end, only when given',
  /export async function leaveRoom\(code, role, forfeit\)[\s\S]{0,700}if \(forfeit && forfeit\.seat != null\) patch\[`forfeit\//.test(net));
ok('L4 net.js: readRoom races a timeout (a dead connection never settles)', /export async function readRoom[\s\S]{0,500}setTimeout/.test(net));
const rules = JSON.parse(src('database.rules.json'));
ok('L4 rules: rooms/ takes the forfeit child with no rules change', rules.rules.rooms['.write'] === 'auth != null' && !Object.keys(rules.rules.rooms).some((k) => k.startsWith('$')));

// Strings
const S = LL.STRINGS;
ok('L4 strings: EN and ES have the same keys', JSON.stringify(Object.keys(S.en).sort()) === JSON.stringify(Object.keys(S.es).sort()));
ok('L4 strings: no em dash, no empty string', [...Object.values(S.en), ...Object.values(S.es)].every((v) => v && !v.includes('—')));
ok('L4 strings: the fewest words ("Claim win")', S.en.ll_claim === 'Claim win' && S.en.ll_claim.split(' ').length <= 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
