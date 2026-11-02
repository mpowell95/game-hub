// test-online-pairs.mjs - the ONLINE PAIRS alerts (2026-11-02, js/integrity.js pairCodes / onlinePairs /
// pairAlerts; the server half functions/integrity.js checkOnlinePairs; the admin page's Online pairs).
// Matt: "I could see moonis making a second profile ... that only loses to him in multiplayer games."
// Alerts only: nothing here may change a score, a board or a stored record. Headless, no network.
//
//   node tools/test-online-pairs.mjs                    the tests
//   node tools/test-online-pairs.mjs --db <snapshot>    ALSO list every pair and every alert real data
//                                                       raises (backups/rtdb-backup.mjs snapshot)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, ['tools/sync-functions-shared.mjs'], { cwd: ROOT, stdio: 'ignore' });
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k), clear: () => store.clear(), key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
const I = await import('../js/integrity.js');
const S = await import('../functions/integrity.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('ok   ', name); } else { fail++; console.log('FAIL ', name, extra ? `\n       ${extra}` : ''); } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const H = 3600 * 1000;
const T0 = Date.parse('2026-10-01T12:00:00Z');

// --- fixtures -------------------------------------------------------------------------------------
// Made-up codes and names; test1 / DREG5 is the hidden test admin and must never be judged.
const dev = (n) => `${String(n).repeat(8)}-0000-0000-0000-000000000000`.slice(0, 36);
function player(code, name, { device = null, screen = null, tz = '', first = 0, h2h = null, at = 1 } = {}) {
  return {
    profile: { name, playerId: code, emoji: '🙂' }, updatedAt: at,
    ...(device ? { device: { device, ...(screen ? { screen } : {}), ...(tz ? { tz } : {}) } } : {}),
    ...(first ? { activity: { darts: { first, last: first, w: {} } } } : {}),
    stats: { games: {}, ...(h2h ? { h2h } : {}) },
  };
}
/** Both players' index rows for `n` darts matches: `win` = who won each ('a' | 'b' | 'draw'). */
function matches(idx, node, a, b, results, extra = {}) {
  idx[node] = idx[node] || {};
  results.forEach((w, i) => {
    const id = `${node}-${a}-${b}-${i}-${Object.keys(idx[node]).length}`;
    const res = (side) => (w === 'draw' ? 'draw' : w === side ? 'won' : 'lost');
    const why = typeof extra.why === 'function' ? extra.why(i) : (extra.why || 'closed');
    const row = (me, them, side) => ({ with: them, name: them, over: true, result: res(side), why, updated: T0 + i * H, ...(extra.row || {}) });
    (idx[node][a] = idx[node][a] || {})[id] = row(a, b, 'a');
    if (!extra.oneSide) (idx[node][b] = idx[node][b] || {})[id] = row(b, a, 'b');
  });
}
const rules = (alerts, key) => alerts.filter((h) => !key || h.key === key).map((h) => `${h.rule}:${h.side}`).sort();
const judge = (players, indexes, usernames = {}) => {
  const codes = I.pairCodes(players, usernames);
  const pairs = I.onlinePairs(players, indexes, usernames, codes);
  return { codes, pairs, alerts: I.pairAlerts(pairs, codes) };
};

console.log('\n--- (a) lopsided: 8+ wins over one person, them winning 10% or less ---');
{
  const players = { [dev(1)]: player('AAAAA', 'Ann'), [dev(2)]: player('BBBBB', 'Bo'), [dev(3)]: player('CCCCC', 'Cy') };
  const idx = {};
  matches(idx, 'darts', 'AAAAA', 'BBBBB', Array(8).fill('a'));
  matches(idx, 'cuppong', 'AAAAA', 'CCCCC', [...Array(7).fill('a'), 'b', 'b', 'b']);
  const { pairs, alerts } = judge(players, idx);
  const ab = pairs.find((p) => p.key === 'AAAAA~BBBBB');
  ok('a match is counted once, though both players keep a row', ab && ab.games === 8 && ab.wa === 8 && ab.wb === 0, JSON.stringify(ab));
  ok('8-0 is an alert on the winner', rules(alerts, 'AAAAA~BBBBB').includes('pair-lopsided:a'), JSON.stringify(alerts));
  ok('7-3 is not', !rules(alerts, 'AAAAA~CCCCC').some((r) => r.startsWith('pair-lopsided')));
  const seven = {}; matches(seven, 'darts', 'AAAAA', 'BBBBB', Array(7).fill('a'));
  ok('7-0 is not (fewer than 8 wins)', !rules(judge(players, seven).alerts).some((r) => r.startsWith('pair-lopsided')));
  const nine = {}; matches(nine, 'darts', 'AAAAA', 'BBBBB', [...Array(8).fill('a'), 'b']);
  ok('8-1 is not (the loser won 11%)', !rules(judge(players, nine).alerts).some((r) => r.startsWith('pair-lopsided')));
  const ten = {}; matches(ten, 'darts', 'AAAAA', 'BBBBB', [...Array(9).fill('a'), 'b']);
  ok('9-1 is (the loser won 10%)', rules(judge(players, ten).alerts).includes('pair-lopsided:a'));
  const v = alerts.find((h) => h.rule === 'pair-lopsided');
  ok('the alert says the record and names the opponent', v.v === '8-0 vs Bo' && v.lim === '10%', JSON.stringify(v));
  ok('the push words', I.hitText(v) === 'beat the same person in nearly every online game (8-0 vs Bo, limit 10%)', I.hitText(v));
}

console.log('\n--- (b) one opponent: 80%+ of 6+ online games against one person, losing to them ---');
{
  const players = { [dev(1)]: player('AAAAA', 'Ann'), [dev(2)]: player('BBBBB', 'Bo'), [dev(3)]: player('CCCCC', 'Cy'), [dev(4)]: player('DDDDD', 'Di') };
  const feeder = {};
  matches(feeder, 'darts', 'AAAAA', 'BBBBB', ['a', 'a', 'a', 'a', 'b']);   // Bo: 5 games, all vs Ann, lost 4
  matches(feeder, 'hoops', 'AAAAA', 'BBBBB', ['a']);                         // 6th
  matches(feeder, 'darts', 'AAAAA', 'CCCCC', ['a', 'b', 'a']);
  matches(feeder, 'darts', 'AAAAA', 'DDDDD', ['b', 'a']);
  const r = judge(players, feeder);
  ok('Bo: 6 of 6 games against Ann, lost 5: an alert on Bo', rules(r.alerts, 'AAAAA~BBBBB').includes('pair-one-opponent:b'), JSON.stringify(r.alerts));
  ok('...never on Ann (6 of 11 against Bo)', !rules(r.alerts).includes('pair-one-opponent:a'));
  const five = {}; matches(five, 'darts', 'AAAAA', 'BBBBB', ['a', 'a', 'a', 'a', 'b']);
  ok('5 games is too few', !rules(judge(players, five).alerts).some((x) => x.startsWith('pair-one-opponent')));
  const sister = {}; matches(sister, 'escoba', 'AAAAA', 'BBBBB', ['a', 'b', 'a', 'b', 'a', 'b', 'b', 'b']);
  ok('a player who plays only one person and WINS more is no feeder', !rules(judge(players, sister).alerts).includes('pair-one-opponent:b'));
  const even = {}; matches(even, 'escoba', 'AAAAA', 'BBBBB', ['a', 'b', 'a', 'b', 'a', 'b']);
  ok('an even record is not either', !rules(judge(players, even).alerts).some((x) => x.startsWith('pair-one-opponent')));
}

console.log('\n--- live rooms: head-to-head from both sides, the larger count stands ---');
{
  const players = {
    [dev(1)]: player('AAAAA', 'Ann', { h2h: { escoba: { [dev(2)]: { name: 'Bo', w: 6, l: 1 } } } }),
    [`${dev(1)}-ZZZZ9`]: player('AAAAA', 'Ann', { h2h: { escoba: { [dev(2)]: { name: 'Bo', w: 2, l: 0 } } } }),   // her second phone node
    [dev(2)]: player('BBBBB', 'Bo', { h2h: { escoba: { [dev(1)]: { name: 'Ann', w: 0, l: 5 } } } }),
  };
  const { pairs, alerts } = judge(players, {});
  const p = pairs.find((x) => x.key === 'AAAAA~BBBBB');
  ok('Ann\'s own devices add up (8-1); Bo\'s smaller count (5 losses) does not add to it', p && p.wa === 8 && p.wb === 1 && p.games === 9 && p.last === 0, JSON.stringify(p));
  ok('...and 8-1 over 9 is lopsided only if the loser won at most 10%: 11% is not', !rules(alerts).some((x) => x.startsWith('pair-lopsided')));
  const both = clone(players); both[dev(2)].stats.h2h.escoba[dev(1)] = { name: 'Ann', w: 0, l: 11 };
  const p2 = judge(both, {}).pairs[0];
  ok('a side that kept more wins its count', p2.wa === 11 && p2.wb === 1 && judge(both, {}).alerts.some((h) => h.rule === 'pair-lopsided' && h.side === 'a'));
}

console.log('\n--- (c) one phone, or look-alike phones made within 48 h ---');
{
  const idx = {}; matches(idx, 'darts', 'AAAAA', 'BBBBB', ['a']);
  const one = { [dev(1)]: player('AAAAA', 'Ann'), [`${dev(1)}-BBBBB`]: player('BBBBB', 'Bo') };
  ok('two codes on one phone that played each other: an alert', rules(judge(one, idx).alerts).includes('pair-same-phone:x'));
  const iph = { device: 'iPhone · iOS 18.7', screen: { w: 402, h: 874, dpr: 3 }, tz: 'America/New_York' };
  const look = (gap, b = iph) => ({ [dev(1)]: player('AAAAA', 'Ann', { ...iph, first: T0 }), [dev(2)]: player('BBBBB', 'Bo', { ...b, first: T0 + gap }) });
  ok('same model, screen and zone, 40 h apart: an alert', rules(judge(look(40 * H), idx).alerts).includes('pair-look-alike:x'));
  ok('72 h apart: not', !rules(judge(look(72 * H), idx).alerts).includes('pair-look-alike:x'));
  ok('another screen: not', !rules(judge(look(1 * H, { ...iph, screen: { w: 390, h: 844, dpr: 3 } }), idx).alerts).includes('pair-look-alike:x'));
  ok('another zone: not', !rules(judge(look(1 * H, { ...iph, tz: 'Europe/Madrid' }), idx).alerts).includes('pair-look-alike:x'));
  ok('only "iPhone · iOS 18.7" on one side (no screen, no zone): not', !rules(judge(look(1 * H, { device: iph.device }), idx).alerts).includes('pair-look-alike:x'));
  const named = look(1 * H); delete named[dev(1)].activity; delete named[dev(2)].activity;
  ok('first seen also reads the name claims (usernames/)', rules(judge(named, idx, { ann: { code: 'AAAAA', at: T0 }, bo: { code: 'BBBBB', at: T0 + 2 * H } }).alerts).includes('pair-look-alike:x'));
  ok('look-alikes who never played each other: no pair, no alert', judge(look(1 * H), {}).alerts.length === 0);
}

console.log('\n--- (d) resigned to the same person 3 times ---');
{
  const players = { [dev(1)]: player('AAAAA', 'Ann'), [dev(2)]: player('BBBBB', 'Bo') };
  const idx = {}; matches(idx, 'flicksoccer', 'AAAAA', 'BBBBB', ['a', 'a', 'a', 'b'], { why: (i) => (i < 3 ? 'resign' : 'goals') });
  const r = judge(players, idx);
  ok('Bo resigned 3 times to Ann: an alert on Bo', rules(r.alerts).includes('pair-resigns:b') && r.pairs[0].rb === 3, JSON.stringify(r.pairs[0]));
  const two = {}; matches(two, 'flicksoccer', 'AAAAA', 'BBBBB', ['a', 'a', 'a'], { why: (i) => (i < 2 ? 'resign' : 'goals') });
  ok('twice is not', !rules(judge(players, two).alerts).includes('pair-resigns:b'));
}

console.log('\n--- what is never counted ---');
{
  const players = { [dev(1)]: player('AAAAA', 'Ann'), [dev(2)]: player('BBBBB', 'Bo'), [dev(3)]: player('DREG5', 'test1'), aa4800fa: player('SMOKE', 'Smokey') };
  const idx = {};
  matches(idx, 'darts', 'AAAAA', 'DREG5', Array(12).fill('a'));
  matches(idx, 'darts', 'AAAAA', 'SMOKE', Array(12).fill('a'));
  matches(idx, 'darts', 'AAAAA', 'BBBBB', Array(9).fill('a'), { row: { ended: 'cancelled' } });
  matches(idx, 'darts', 'AAAAA', 'BBBBB', Array(9).fill('a'), { row: { over: false } });
  const r = judge(players, idx);
  ok('hidden test accounts, called-off and unfinished matches: nothing', r.pairs.length === 0 && r.alerts.length === 0, JSON.stringify(r.pairs));
  ok('a row with no result (old Hoops rows) is not guessed into one', judge({ [dev(1)]: player('AAAAA', 'Ann'), [dev(2)]: player('BBBBB', 'Bo') },
    { hoops: { AAAAA: { x: { with: 'BBBBB', over: true } } } }).pairs.length === 0);
  const before = clone({ players, idx });
  judge(players, idx);
  ok('the pure functions change nothing they are given', JSON.stringify(before) === JSON.stringify({ players, idx }));
}

// --- the server, against a fake database ----------------------------------------------------------
console.log('\n--- the server writes each alert once ---');
function fakeDb(tree) {
  const parts = (p) => String(p).split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);
  const setAt = (p, v) => {
    const ks = parts(p); let o = tree;
    for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  const writes = [];
  return {
    tree, writes,
    ref: (p) => ({
      get: async () => ({ val: () => { const v = getAt(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
      transaction: async (fn) => { const cur = getAt(p); const next = fn(cur === undefined ? null : cur); if (next === undefined) return { committed: false }; writes.push(p); setAt(p, next); return { committed: true }; },
    }),
  };
}
{
  const players = { [dev(1)]: player('AAAAA', 'Ann'), [dev(2)]: player('BBBBB', 'Bo') };
  const idx = {}; matches(idx, 'darts', 'AAAAA', 'BBBBB', Array(8).fill('a'));
  const db = fakeDb({ darts: { index: idx.darts }, usernames: {} });
  const before = clone(db.tree);
  const w1 = await S.checkOnlinePairs(db, players, 5000);
  const w2 = await S.checkOnlinePairs(db, players, 6000);
  ok('the first pass writes the alerts, the second writes nothing', w1.length === 2 && w2.length === 0, JSON.stringify(w1));
  const a = db.tree.integrityAlerts['pair~AAAAA~BBBBB']['pair-lopsided~a'];
  ok('the alert lives under integrityAlerts/pair~<A>~<B>/<rule>~<side>, with the numbers and the player', a && a.v === '8-0 vs Bo' && a.name === 'Ann'
    && a.code === 'AAAAA' && a.with === 'BBBBB' && a.games === 8 && a.when === 5000, JSON.stringify(a));
  ok('...Bo, who played only Ann and lost every game, is the other alert', !!db.tree.integrityAlerts['pair~AAAAA~BBBBB']['pair-one-opponent~b']);
  ok('only integrityAlerts is written: no index, player or board touched', db.writes.every((p) => p.startsWith('integrityAlerts/'))
    && JSON.stringify(db.tree.darts) === JSON.stringify(before.darts) && JSON.stringify(players) === JSON.stringify({ [dev(1)]: player('AAAAA', 'Ann'), [dev(2)]: player('BBBBB', 'Bo') }));
  const n = S.integrityNote('match', w1.find((x) => x.rule === 'pair-lopsided'));
  ok('the push names the person and "Online play"', n.text('en').body === 'Ann, Online play: alert. beat the same person in nearly every online game (8-0 vs Bo, limit 10%)', n.text('en').body);
  ok('hourly: due with no stamp or an hour-old one, not 10 minutes after', S.pairsDue(null, T0) && S.pairsDue(T0 - I.PAIR_LIMITS.EVERY_MS, T0) && !S.pairsDue(T0 - 10 * 60 * 1000, T0));
}

// --- wiring ---------------------------------------------------------------------------------------
console.log('\n--- wiring ---');
{
  const read = (p) => readFileSync(new URL(p, new URL('..', import.meta.url)), 'utf8');
  const idx = read('functions/index.js');
  ok('server: the board rebuild runs the pair check, at most hourly, from its own players/ read',
    /if \(pairsDue\(pairsAt\)\) \{/.test(idx) && /checkOnlinePairs\(db, players \|\| \{\}\)/.test(idx) && /db\.ref\('boards\/v1\/meta\/pairsAt'\)\.get\(\)/.test(idx));
  ok('server: every challenge node with an index is read', Object.keys(I.PAIR_NODES).length === 11
    && ['hoops', 'skeeChallenges', 'cuppong', 'darts', 'flicksoccer', 'eightball', 'archery', 'chinchon', 'escoba', 'battlearena', 'battleship'].every((n) => n in I.PAIR_NODES));
  const rules = JSON.parse(read('database.rules.json')).rules;
  ok('no new node: the alerts go to integrityAlerts (admin-read, server-written)', rules.integrityAlerts['.write'] === false && /admins/.test(rules.integrityAlerts['.read']));
  const ui = read('js/admin-ui.js');
  ok('admin page: People has Online pairs; a pair page; a pair alert on Now opens it',
    /more\(tx\('adm_online_pairs', 'Online pairs'\), \(\) => push\(\{ k: 'pairs' \}\)\)/.test(ui) && /case 'pair': return pairPage\(v\.key\);/.test(ui)
    && /push\(\{ k: 'pair', key: String\(m\.key\)\.slice\(5\) \}\)/.test(ui));
  ok('admin page: last played in Eastern time', /timeZone: 'America\/New_York'/.test(ui));
  ok('admin page: same rules as the server (pairCodes, onlinePairs, pairAlerts from js/integrity.js)', /pairAlerts\(pairs, codes\)/.test(ui) && /onlinePairs\(_players \|\| \{\}, _pairSrc\.indexes/.test(ui));
  ok('phones report their time zone with the device (a look-alike sign)', /tz: tzName\(\)/.test(read('js/stats-net.js')));
}

// --- replay over a real snapshot -------------------------------------------------------------------
const dbArg = process.argv.indexOf('--db');
if (dbArg > 0) {
  console.log('\n--- replay over a snapshot ---');
  const d = JSON.parse(readFileSync(process.argv[dbArg + 1], 'utf8'));
  const indexes = Object.fromEntries(Object.keys(I.PAIR_NODES).map((n) => [n, ((d[n] || {}).index) || {}]));
  const { codes, pairs, alerts } = judge(d.players || {}, indexes, d.usernames || {});
  const nm = (c) => `${codes[c].name} (${c})`;
  for (const p of pairs.sort((x, y) => y.games - x.games)) {
    console.log(`  ${nm(p.a)} ${p.wa}-${p.wb}${p.d ? `-${p.d}` : ''} ${nm(p.b)}: ${p.games} games${p.ra || p.rb ? `, resigned ${p.ra}-${p.rb}` : ''}`);
  }
  for (const h of alerts) console.log(`  ALERT  ${h.rule} ${h.side} ${h.key}: ${I.hitText(h)}`);
  console.log(`  ${pairs.length} pairs, ${alerts.length} alerts`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
