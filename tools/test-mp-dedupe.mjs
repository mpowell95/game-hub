// tools/test-mp-dedupe.mjs - ONE online challenge result per PERSON, not per phone storage (2026-10-29).
//
// Every challenge game counts a finished match once per STORAGE (its own `counted` ledger). The same
// player in Safari and in the Home Screen app (two storages) or on two phones counted it on each, and
// js/players-agg.js sums a person's devices, so one online win showed as two; and a fresh storage
// re-counted the player's whole finished history. Proven here, headless, with fake storages:
//   1. a challenge count notes its match id in the SAME write (js/game-stats.js withChallengeMatch);
//   2. two storages, one match: counted once on the merged board (players-agg, also the server's);
//   3. a fresh storage never re-counts finished history; one that already counted behaves as before;
//   4. records without ids (live rooms, everything before today) aggregate exactly as before;
//   5. every challenge game routes its count through both.
//   node tools/test-mp-dedupe.mjs
// Test profiles only (test1 / DREG5 and made-up codes), never Matt's (root CLAUDE.md).

// --- a browser-ish global: localStorage, one per "storage" ---------------------------------------
const stores = {};
let cur = 'S1';
globalThis.localStorage = {
  getItem: (k) => { const m = stores[cur] || (stores[cur] = new Map()); return m.has(k) ? m.get(k) : null; },
  setItem: (k, v) => { (stores[cur] || (stores[cur] = new Map())).set(k, String(v)); },
  removeItem: (k) => { (stores[cur] || (stores[cur] = new Map())).delete(k); },
};
const PROFILE = JSON.stringify({ name: 'test1', emoji: '🧪', playerId: 'DREG5' });
const use = (s, profile = PROFILE) => {
  cur = s;
  if (!stores[s]) { stores[s] = new Map(); stores[s].set('gamehub.profile', profile); stores[s].set('gamehub.deviceId', 'dev-' + s); }
};

const GS = await import('../js/game-stats.js');
const { aggregatePlayers } = await import('../js/players-agg.js');
const DARTS = await import('../darts/js/mp.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };
const stored = () => GS.loadStoredStats();
const rec = (dev, stats) => ({ profile: { name: 'test1', emoji: '🧪', playerId: 'DREG5' }, updatedAt: 1, stats });
const person = (all, corrections) => aggregatePlayers(all, corrections).find((g) => g.playerId === 'DREG5');
const now = Date.now();
const row = (id, result = 'won', updated = now) => ({ id, over: true, result, updated, with: 'TQWX7', name: 'Made Up', why: '' });

// --- 1 + 2: two storages, one match ----------------------------------------------------------------
use('S1');
ok('a fresh storage counts a match that finishes now', DARTS.recordFinished([row('m1aaaaaaaa')]) === 1);
const s1 = stored();
ok('...as an mp win', s1.games.darts.byDiff.mp.won === 1 && s1.games.darts.total.won === 1);
ok('...noted with its match id in the same store', s1.games.darts.mpIds && s1.games.darts.mpIds.m1aaaaaaaa === 'w');
use('S2');   // the same player in the Home Screen app: its own storage, its own ledger
ok('the second storage counts it too (its ledger is its own)', DARTS.recordFinished([row('m1aaaaaaaa')]) === 1);
const s2 = stored();
let all = { 'dev-S1': rec('dev-S1', s1), 'dev-S2': rec('dev-S2', s2) };
let p = person(all);
ok('ONE match, two storages: the merged board counts it ONCE', p.games.darts.byDiff.mp.won === 1 && p.games.darts.byDiff.mp.played === 1 && p.games.darts.total.won === 1,
  JSON.stringify(p.games.darts));
ok('...and the competitive roll-up agrees', p.comp.won === 1 && p.comp.played === 1);
ok('the ids never ride into the board package (no mpIds, no _mp on the group)', !('_mp' in p) && !('mpIds' in p.games.darts));
ok('the raw records are untouched (each still says 1)', s1.games.darts.byDiff.mp.won === 1 && s2.games.darts.byDiff.mp.won === 1);

// A loss counted on both, and a different match on one: each id counted once.
use('S1'); DARTS.recordFinished([row('m2bbbbbbbb', 'lost'), row('m3cccccccc', 'won')]);
use('S2'); DARTS.recordFinished([row('m2bbbbbbbb', 'lost')]);
all = { 'dev-S1': rec('dev-S1', (use('S1'), stored())), 'dev-S2': rec('dev-S2', (use('S2'), stored())) };
p = person(all);
ok('two wins and a loss, whatever storage counted them', p.games.darts.byDiff.mp.won === 2 && p.games.darts.byDiff.mp.lost === 1 && p.games.darts.byDiff.mp.played === 3,
  JSON.stringify(p.games.darts.byDiff.mp));

// --- 4: records without ids aggregate exactly as before ---------------------------------------------
const plain = (won, lost) => ({ version: 1, games: { darts: { total: { played: won + lost, won, lost }, byDiff: { mp: { played: won + lost, won, lost }, easy: { played: 2, won: 1, lost: 1 } } } } });
p = person({ d1: rec('d1', plain(3, 1)), d2: rec('d2', plain(2, 2)) });
ok('no ids: every count stays (live rooms, everything before 2026-10-29)', p.games.darts.byDiff.mp.won === 5 && p.games.darts.byDiff.mp.lost === 3 && p.games.darts.byDiff.easy.played === 4 && p.games.darts.total.played === 8);
// A live-room count (no id) beside a duplicated challenge (id) in the same 'mp' bucket.
const mixed = (extraLive) => ({ version: 1, games: { escoba: { total: { played: 1 + extraLive, won: 1 + extraLive, lost: 0 }, byDiff: { mp: { played: 1 + extraLive, won: 1 + extraLive, lost: 0 } }, mpIds: { esc0000001: 'w' } } } });
p = person({ d1: rec('d1', mixed(2)), d2: rec('d2', mixed(0)) });
ok('mixed bucket: live-room wins all count, the duplicated challenge once', p.games.escoba.byDiff.mp.won === 3 && p.games.escoba.total.won === 3, JSON.stringify(p.games.escoba));
// An integrity void on one device took its wins; its copy then counts as played only.
p = person({ d1: rec('d1', s1), d2: rec('d2', s2) }, { integrity: { d1: { darts: true } } });
ok('an integrity-voided device: the other device\'s win is the one kept', p.games.darts.byDiff.mp.won === 1 && p.games.darts.byDiff.mp.played === 1, JSON.stringify(p.games.darts.byDiff.mp));
// Two different people never de-duplicate each other.
const other = (s) => ({ profile: { name: 'someone', emoji: '🙂', playerId: 'TQWX7' }, updatedAt: 1, stats: s });
const both = aggregatePlayers({ d1: rec('d1', s1), d9: other(s2) });
ok('the same id on two DIFFERENT people counts for each', both.every((g) => g.games.darts.byDiff.mp.won >= 1));

// --- 3: a fresh storage never re-counts finished history ---------------------------------------------
use('S3');
const old = [row('m4dddddddd', 'won', now - 2 * 864e5), row('m5eeeeeeee', 'lost', now - 30 * 864e5)];
ok('a fresh storage counts NONE of the finished history', DARTS.recordFinished(old) === 0);
ok('...nothing recorded, nothing queued for a Game Over popup', !stored().games.darts.byDiff.mp && DARTS.readUnseen().length === 0);
ok('...and it remembers when it started counting', +localStorage.getItem(DARTS.LEDGER_KEY + '.since') > 0);
ok('...but counts a match that finishes after that', DARTS.recordFinished([row('m6ffffffff', 'won', Date.now() + 5)]) === 1);
use('S7'); localStorage.setItem(DARTS.LEDGER_KEY, JSON.stringify(['someoldone']));   // a storage that had counted before this rule
ok('a storage that already counted still counts an older finished match', DARTS.recordFinished([row('m7gggggggg', 'won', now - 2 * 864e5)]) === 1);
ok('...and never gets a "since" stamp', localStorage.getItem(DARTS.LEDGER_KEY + '.since') === null);
use('S4');
ok('the game screen\'s own count obeys the same rule (an old resignation opened from history)', DARTS.countResult('m8hhhhhhhh', false, now - 864e5) === false);
ok('...while a match it watched finish now counts', DARTS.countResult('m9iiiiiiii', true) === true);

// --- the helper itself ---------------------------------------------------------------------------
use('S5');
localStorage.setItem('gamehub.pendingResults.v1', JSON.stringify([{ game: 'darts', diff: 'mp', won: false }]));
GS.withChallengeMatch('darts', 'mqqqqqqqqq', () => GS.recordResult('darts', 'mp', true));
const s5 = stored();
ok('a queued OLDER result never takes the id of the match being counted', s5.games.darts.mpIds.mqqqqqqqqq === 'w' && s5.games.darts.byDiff.mp.won === 1 && s5.games.darts.byDiff.mp.lost === 1,
  JSON.stringify(s5.games.darts));
GS.withChallengeMatch('darts', 'mrrrrrrrrr', () => GS.recordResult('darts', 'easy', true));
ok('a count outside the mp bucket notes nothing', !stored().games.darts.mpIds.mrrrrrrrrr);
GS.recordResult('darts', 'mp', true);
ok('a plain mp count (a live room) notes nothing', Object.keys(stored().games.darts.mpIds).length === 1);
use('S6');
for (let i = 0; i < 30; i++) GS.recordResult('darts', 'easy', true);
const refused = GS.withChallengeMatch('darts', 'msssssssss', () => GS.recordResult('darts', 'mp', true));
ok('a count the rate gate refused notes no id either', refused === null && !(stored().games.darts.mpIds || {}).msssssssss);

// --- 5: every challenge game counts through both -----------------------------------------------------
const GAMES = [
  ['darts', '../darts/js/mp.js', 'darts'],
  ['cup-pong', '../cup-pong/js/mp.js', 'cuppong'],
  ['flick-soccer', '../flick-soccer/js/mp.js', 'flicksoccer'],
  ['eight-ball', '../eight-ball/js/mp.js', 'eightball'],
  ['battleship', '../battleship/js/mp.js', 'battleship'],
  ['hoops4', '../hoops4/js/mp.js', 'hoops4'],
  ['chinchon', '../chinchon/js/mp.js', 'chinchon'],
  ['escoba', '../escoba/js/mp.js', 'escoba'],
  ['archery', '../archery/js/mp.js', 'archery'],
  ['battle-arena', '../battle-arena/js/mp.js', 'battlearena'],
];
let n = 0;
for (const [name, path, statsId] of GAMES) {
  const M = await import(path);
  n++;
  const id = `gm${String(n).padStart(2, '0')}zzzzzzzz`;
  const a = `G${n}a`, b = `G${n}b`;
  use(a); M.recordFinished([row(id)]);
  const sa = GS.loadStats();
  use(b); M.recordFinished([row(id)]);
  const sb = GS.loadStats();
  // loadStats(): the GAME's view (an admin-only game counts into its test record, js/game-stats.js).
  const ga = sa.games[statsId], gb = sb.games[statsId];
  ok(`${name}: each storage counted it once, with its id`, ga.byDiff.mp.won === 1 && gb.byDiff.mp.won === 1 && ga.mpIds[id] === 'w' && gb.mpIds[id] === 'w',
    JSON.stringify(ga));
  const merged = person({ x1: rec('x1', { version: 1, games: { [statsId]: ga } }), x2: rec('x2', { version: 1, games: { [statsId]: gb } }) });
  ok(`${name}: once on the merged board`, merged.games[statsId].byDiff.mp.won === 1 && merged.games[statsId].total.won === 1, JSON.stringify(merged.games[statsId]));
  use(`${a}-fresh`);
  ok(`${name}: a fresh storage does not re-count history`, M.recordFinished([row(`${id}x`, 'won', now - 3 * 864e5)]) === 0);
}

// A NEW player: the storage's first launcher paint (no rows yet) starts its clock, so a first win that
// finished while the app was closed, hours later, still counts (the clock does not start at the finish).
{
  use('NEWBIE');
  DARTS.recordFinished([]);                                   // first paint, nothing finished yet
  ok('the first launcher paint, with no finished match, starts the storage\'s counting clock',
    Number(localStorage.getItem(DARTS.LEDGER_KEY + '.since')) > 0);
  const later = Date.now() + 5 * 3600e3;                      // the match ends 5 h later, app closed
  const n = DARTS.recordFinished([row('newbie1first', 'won', later)]);
  ok('a new player\'s first win, finished while the app was closed, is counted', n === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
