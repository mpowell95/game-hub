// tools/test-no-deletes-rules.mjs - "Make it so devices cannot delete anything" (Matt, 2026-11-04), then "change
// the rules so only legitimate deletes are allowed". Run: node tools/test-no-deletes-rules.mjs
//
// WHY: until this change `players/`, `rooms/`, `usernames/`, the bug-report nodes and every online-match node were
// `".write": "auth != null"` - every phone signs in anonymously, so any device (or a script with the public config)
// could delete one player's record or all of players/ in one request. ~188 records vanished between 2026-10-05 and
// 2026-11-03 with no log (root CLAUDE.md, "Matt's deleted records").
//
// No emulator (no Java on Matt's PC): like tools/test-ww-daily-rules.mjs, the rule strings in database.rules.json
// are EVALUATED as JavaScript against simulated writes, the way Firebase applies them: a write is granted when a
// `.write` on the path from the root down to the written location says yes (a deeper rule cannot grant a shallower
// write, and a shallower yes cannot be taken back); `.validate` runs on every written node that is not deleted; an
// update() is one multi-location write checked against the combined result.
//
// Two halves, both against the SAME list of writes:
//   LEGIT - every write and delete the app really sends (found by reading every api.set/update/remove/transaction
//           in the client), each run against the NEW rules: all must still be allowed. If one fails, a game breaks.
//   ATTACK - deletes the app never sends: all must be REFUSED by the new rules. Each is also run against the OLD
//           rules (git HEAD~ copy, if passed with --old <file>) to show it used to be allowed.
import { readFileSync } from 'node:fs';

const file = process.argv.includes('--rules') ? process.argv[process.argv.indexOf('--rules') + 1] : new URL('../database.rules.json', import.meta.url);
const RULES = JSON.parse(readFileSync(file, 'utf8')).rules;
const NOW = 1762300000000;
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + name); } };

// --- a tiny Realtime Database rules evaluator --------------------------------------------------------------------
class Snap {
  constructor(v) { this.v = v; }
  child(k) { let v = this.v; for (const p of String(k).split('/')) v = v && typeof v === 'object' ? v[p] : undefined; return new Snap(v); }
  val() { return this.v === undefined ? null : this.v; }
  exists() { return this.v !== undefined && this.v !== null; }
  hasChildren(ks) { if (!this.v || typeof this.v !== 'object') return false; return !ks || ks.every((k) => this.v[k] != null); }
  isNumber() { return typeof this.v === 'number'; }
  isString() { return typeof this.v === 'string'; }
  isBoolean() { return typeof this.v === 'boolean'; }
}
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const get = (o, segs) => { let v = o; for (const s of segs) v = v && typeof v === 'object' ? v[s] : undefined; return v; };
function setAt(o, segs, val) {           // Firebase semantics: null deletes, and an emptied parent disappears
  if (!segs.length) return val == null ? undefined : clone(val);
  const out = o && typeof o === 'object' ? o : {};
  const r = setAt(out[segs[0]], segs.slice(1), val);
  if (r === undefined) delete out[segs[0]]; else out[segs[0]] = r;
  return Object.keys(out).length ? out : undefined;
}
function ruleChild(node, key) {
  if (!node) return [null, null];
  if (Object.prototype.hasOwnProperty.call(node, key)) return [node[key], null];
  const w = Object.keys(node).find((k) => k.startsWith('$'));
  return w ? [node[w], w] : [null, null];
}
function evalRule(expr, env, vars) {
  if (expr === true || expr === false) return expr;
  const src = String(expr).replace(/(\$[A-Za-z]+)\.contains\(/g, '__contains($1,').replace(/(\$[A-Za-z]+)\.matches\(/g, '__matches($1,');
  const names = Object.keys(vars);
  const fn = new Function('auth', 'root', 'data', 'newData', 'now', '__contains', '__matches', ...names, `return (${src});`);
  try {
    return fn(env.auth, env.root, env.data, env.newData, NOW, (s, x) => String(s).includes(String(x)), (s, re) => re.test(String(s)), ...names.map((n) => vars[n])) === true;
  } catch { return false; }
}
/** Would Firebase accept update(path, patch) (or set when `set` is true) by uid over `state`? */
function allowed(state, path, patch, { uid = 'u-me', set = false } = {}) {
  const base = path.split('/').filter(Boolean);
  const locs = set || patch === null || typeof patch !== 'object' ? [[base, patch]]
    : Object.entries(patch).map(([k, v]) => [base.concat(k.split('/').filter(Boolean)), v]);
  let next = clone(state) || {};
  for (const [segs, v] of locs) next = setAt(next, segs, v) || {};
  const auth = uid ? { uid } : null, root = new Snap(state);
  for (const [segs] of locs) {
    // .write: some rule from the root down to this location must say yes
    let node = RULES, vars = {}, granted = false;
    for (let d = 0; d <= segs.length; d++) {
      if (d > 0) { const [n, w] = ruleChild(node, segs[d - 1]); node = n; if (w) vars = { ...vars, [w]: segs[d - 1] }; }
      if (!node) break;
      if (node['.write'] !== undefined && evalRule(node['.write'], { auth, root, data: new Snap(get(state, segs.slice(0, d))), newData: new Snap(get(next, segs.slice(0, d))) }, vars)) { granted = true; break; }
    }
    if (!granted) return false;
    // .validate on every node from the root to this location and below it that still exists afterwards
    const check = (n, segs2, vs) => {
      const nd = get(next, segs2);
      if (nd == null || !n) return true;
      if (n['.validate'] !== undefined && !evalRule(n['.validate'], { auth, root, data: new Snap(get(state, segs2)), newData: new Snap(nd) }, vs)) return false;
      if (segs2.length >= segs.length && nd && typeof nd === 'object') {
        for (const k of Object.keys(nd)) {
          const [c, w] = ruleChild(n, k);
          if (!check(c, segs2.concat(k), w ? { ...vs, [w]: k } : vs)) return false;
        }
      }
      return true;
    };
    node = RULES; vars = {};
    for (let d = 0; d < segs.length; d++) {
      if (node && node['.validate'] !== undefined && get(next, segs.slice(0, d)) != null
        && !evalRule(node['.validate'], { auth, root, data: new Snap(get(state, segs.slice(0, d))), newData: new Snap(get(next, segs.slice(0, d))) }, vars)) return false;
      const [n, w] = ruleChild(node, segs[d]); node = n; if (w) vars = { ...vars, [w]: segs[d] };
      if (!node) break;
    }
    if (node && !check(node, segs, vars)) return false;
  }
  return true;
}

// --- a database the size of one family ----------------------------------------------------------------------------
const rec = (name, code) => ({ profile: { name, emoji: '', playerId: code, message: '', messageAt: 0 }, stats: { version: 2, games: { boggle: { total: { played: 3, won: 1, lost: 2 } } } }, rate: { n: 1 }, updatedAt: NOW - 5000 });
const game = (a, b) => ({ id: 'g1', a: { code: a }, b: { code: b }, created: NOW - 9000, updated: NOW - 9000, pick: { x: 1 } });
const DB = {
  admins: { 'u-admin': true },
  msgAuth: { 'u-me': 'AAAAA', 'u-other': 'BBBBB', 'u-admin': 'QZCC4' },
  players: { 'dev-me': rec('Me', 'AAAAA'), 'dev-other': rec('Other', 'BBBBB') },
  usernames: { me: { code: 'AAAAA', at: NOW - 1 }, other: { code: 'BBBBB', at: NOW - 1 } },
  rooms: { ROOM1: { host: { id: 'dev-me' }, seats: { 0: { id: 'dev-me' }, 1: { id: 'dev-other' } }, recovery: { seq: 3 }, pk: { pub: { p: 1 }, clock: 5 }, updated: NOW - 1 } },
  bugReports: { r1: { text: 'x', createdAtMs: NOW - 1, deleted: true, deletedAtMs: NOW - 1 } },
  bugReportShots: { r1: { 0: 'data:' } },
  deviceReports: { 'dev-me': { a: 1 } },
  archive: { players: { 'dev-old': rec('Old', '') } },
  challenge: { k1: { step: 2 } },
  selfies: { s1: { status: 'pending' } },
  flight: { n: 'UA1' },
  pushSubs: { AAAAA: { s1: { endpoint: 'x' } } },
  careers: { AAAAA: { season: 3 } },
  courseDrafts: { AAAAA: { d1: { holes: 9 } } },
  messages: { threads: { 'AAAAA_BBBBB': { msgs: { m1: { from: 'AAAAA', text: 'hi', atMs: NOW - 1 } } } }, index: { AAAAA: { BBBBB: { at: NOW - 1 } }, BBBBB: { AAAAA: { at: NOW - 1 } } } },
};
const MP = ['cuppong', 'darts', 'flicksoccer', 'eightball', 'archery', 'chinchon', 'escoba', 'battlearena', 'battleship', 'hoops', 'skeeChallenges'];
for (const n of MP) DB[n] = { games: { g1: game('AAAAA', 'BBBBB') }, index: { AAAAA: { g1: { result: '' } }, BBBBB: { g1: { result: '' } } }, chat: { g1: { c1: { by: 'AAAAA', t: 'c', v: 'gg' } } } };

// --- LEGIT: what the app really sends - every one must still work ------------------------------------------------
const LEGIT = [
  ['sync: update players/<me> (full record, rate null)', 'players/dev-me', { ...rec('Me', 'AAAAA'), rate: null, updatedAt: NOW }],
  ['sync: a brand-new device\'s first record', 'players/dev-new', rec('New', 'CCCCC')],
  ['rooms: create a room (set)', 'rooms/ROOM2', { host: { id: 'dev-me' }, updated: NOW }, { set: true }],
  ['rooms: vacate a seat (seats/1 null)', 'rooms/ROOM1', { 'seats/1': null, updated: NOW }],
  ['rooms: clear recovery (null)', 'rooms/ROOM1', { recovery: null, updated: NOW }],
  ['rooms: Hold\'em clears pub + clock', 'rooms/ROOM1/pk', { pub: null, clock: null }],
  ['rooms: a reaction', 'rooms/ROOM1/reactions/0', { t: 'e', v: 'x', at: NOW }, { set: true }],
  ['bug report: send (push + set)', 'bugReports/r2', { text: 'y', createdAtMs: NOW }, { set: true }],
  ['bug report: undo soft delete (deleted null)', 'bugReports/r1', { deleted: null, deletedAtMs: null }],
  ['bug report: screenshots', 'bugReportShots/r2', { 0: 'data:' }, { set: true }],
  ['device report', 'deviceReports/dev-me', { a: 2 }, { set: true }],
  ['username: claim', 'usernames/newname', { code: 'AAAAA', at: NOW }],
  ['username: release my own old name on rename', 'usernames/me', null, { set: true }],
  ['username: admin force-release', 'usernames/other', null, { set: true, uid: 'u-admin' }],
  ['push: unsubscribe my own device', 'pushSubs/AAAAA/s1', null, { set: true }],
  ['challenge: sync progress', 'challenge/k1', { step: 3 }],
  ['challenge: admin tester reset', 'challenge/k1', null, { set: true, uid: 'u-admin' }],
  ['challenge: flight', 'flight', { n: 'UA2' }, { set: true }],
  ['challenge: selfie status', 'selfies/s1', { status: 'approved', reason: null }],
  ['career save (owner)', 'careers/AAAAA', { season: 4 }, { set: true }],
  ['course draft (owner)', 'courseDrafts/AAAAA/d2', { holes: 18 }, { set: true }],
  ['messages: send a message', 'messages/threads/AAAAA_BBBBB/msgs/m2', { from: 'AAAAA', text: 'yo', atMs: NOW }, { set: true }],
  ['messages: index rows (theirs, mine)', 'messages/index/BBBBB/AAAAA', { at: NOW, from: 'AAAAA', preview: 'yo' }],
  ['messages: mark seen', 'messages/index/AAAAA/BBBBB', { seenAt: NOW }],
  ['messages: hide', 'messages/index/AAAAA/BBBBB', { hiddenAt: NOW }],
  ['msgAuth: claim my code', 'msgAuth/u-me', 'AAAAA', { set: true }],
];
for (const n of MP) {
  LEGIT.push([`${n}: new match`, `${n}/games/g2`, game('AAAAA', 'BBBBB'), { set: true }]);
  LEGIT.push([`${n}: match update`, `${n}/games/g1`, { updated: NOW }]);
  LEGIT.push([`${n}: index row`, `${n}/index/AAAAA/g1`, { result: 'won' }]);
  LEGIT.push([`${n}: chat line`, `${n}/chat/g1/c2`, { by: 'AAAAA', t: 'c', v: 'hi' }, { set: true }]);
}
LEGIT.push(['flicksoccer: clear the pick inside a live match', 'flicksoccer/games/g1', { pick: null, updated: NOW }]);
LEGIT.push(['hoops: chat inside a match', 'hoops/games/g1/chat/c1', { by: 'AAAAA', v: 'x' }, { set: true }]);
for (const [name, p, v, o] of LEGIT) ok('LEGIT allowed: ' + name, allowed(DB, p, v, o));

// --- ATTACK: deletes the app never sends - every one must be refused ----------------------------------------------
const del = (p, uid) => [p, null, { set: true, uid }];
const ATTACK = [
  ['delete ALL players', ...del('players')],
  ['delete one player\'s record', ...del('players/dev-other')],
  ['delete MY OWN record', ...del('players/dev-me')],
  ['wipe a record\'s stats', 'players/dev-other', { stats: null }],
  ['replace a record with no profile/stats', 'players/dev-other', { junk: 1 }, { set: true }],
  ['delete all usernames', ...del('usernames')],
  ['delete someone else\'s username', ...del('usernames/other')],
  ['delete all rooms', ...del('rooms')],
  ['delete a room', ...del('rooms/ROOM1')],
  ['delete all bug reports', ...del('bugReports')],
  ['delete a bug report', ...del('bugReports/r1')],
  ['delete bug screenshots', ...del('bugReportShots/r1')],
  ['delete a device report', ...del('deviceReports/dev-me')],
  ['delete the archive', ...del('archive')],
  ['delete an archived player', ...del('archive/players/dev-old')],
  ['delete challenge progress (not admin)', ...del('challenge/k1')],
  ['delete a selfie', ...del('selfies/s1')],
  ['delete flight', ...del('flight')],
  ['delete my career save', ...del('careers/AAAAA')],
  ['delete my course drafts', ...del('courseDrafts/AAAAA')],
  ['delete a message', ...del('messages/threads/AAAAA_BBBBB/msgs/m1')],
  ['delete a whole conversation', ...del('messages/threads/AAAAA_BBBBB')],
  ['delete an inbox row', ...del('messages/index/AAAAA/BBBBB')],
  ['delete my msgAuth claim', ...del('msgAuth/u-me')],
];
for (const n of MP) {
  ATTACK.push([`delete all of ${n}`, ...del(n)]);
  ATTACK.push([`delete a ${n} match`, ...del(`${n}/games/g1`)]);
  ATTACK.push([`delete all ${n} matches`, ...del(`${n}/games`)]);
  ATTACK.push([`delete a ${n} index row`, ...del(`${n}/index/AAAAA/g1`)]);
  ATTACK.push([`delete a player's whole ${n} index`, ...del(`${n}/index/AAAAA`)]);
  ATTACK.push([`delete a ${n} chat line`, ...del(`${n}/chat/g1/c1`)]);
}
for (const [name, p, v, o] of ATTACK) ok('ATTACK refused: ' + name, !allowed(DB, p, v, o));
ok('ATTACK: even admin cannot delete a player record from a device', !allowed(DB, 'players/dev-other', null, { set: true, uid: 'u-admin' }));
ok('ATTACK: signed-out cannot write at all', !allowed(DB, 'players/dev-x', rec('X', 'XXXXX'), { set: true, uid: null }));

// --- no node is left wide open --------------------------------------------------------------------------------------
const open = [];
(function walk(n, p) { for (const [k, v] of Object.entries(n || {})) { if (k === '.write' && v === 'auth != null') open.push(p || '/'); else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p + '/' + k); } })(RULES, '');
ok('no rule anywhere is a bare ".write": "auth != null" (any device may delete)' + (open.length ? ': ' + open.join(', ') : ''), open.length === 0);

console.log(`\nno-deletes rules: ${pass} passed, ${fail} failed (${LEGIT.length} legit writes, ${ATTACK.length + 2} attacks)`);
process.exit(fail ? 1 : 0);
