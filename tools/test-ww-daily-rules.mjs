// test-ww-daily-rules.mjs - the database rules of Word Weaver's daily board, wwDaily/ (2026-11-02,
// word-weaver/js/board.js). Run: node tools/test-ww-daily-rules.mjs
//
// No emulator: the rule strings from database.rules.json are EVALUATED here as JavaScript (the rules language is a
// subset of it) against small stand-in snapshots (`data`, `newData`, `root`), the way Firebase applies them to one
// write at wwDaily/<day>/<code>: the node's `.write` and `.validate`, every written child's `.validate`, and `$other`
// for anything else. Proves: only your own claimed code writes, `o` is the server's time once and never moves, a
// finished result is final, stars follow hints, the day key's shape, no extra fields, no delete. Then that the
// backup reads the branch and that board.js writes only fields the rules know.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL  ' + name); } };

const RULES = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
const node = RULES.wwDaily && RULES.wwDaily.$day && RULES.wwDaily.$day.$code;
ok('database.rules.json has wwDaily/$day/$code', !!node);
ok('wwDaily: readable by any signed-in session', RULES.wwDaily.$day['.read'] === 'auth != null');

class Snap {
  constructor(v) { this.v = v; }
  child(k) { return new Snap(this.v && typeof this.v === 'object' ? this.v[k] : undefined); }
  val() { return this.v === undefined ? null : this.v; }
  exists() { return this.v !== undefined && this.v !== null; }
  hasChildren(ks) { return !!this.v && typeof this.v === 'object' && ks.every((k) => this.v[k] !== undefined && this.v[k] !== null); }
  isNumber() { return typeof this.v === 'number'; }
  isString() { return typeof this.v === 'string'; }
}
const run = (expr, env) => new Function('auth', 'root', 'data', 'newData', 'now', '$day', '$code', `return (${expr});`)(
  env.auth, env.root, env.data, env.newData, env.now, env.$day, env.$code) === true;
const NOW = 1762100000000;
/** Would Firebase accept writing `next` at wwDaily/<day>/<code> over `prev`, by uid `uid` (claimed `claim`)? */
function allowed({ day = 'en-2026-11-02', code = 'DREG5', uid = 'u1', claim = 'DREG5', prev = null, next }) {
  const $day = Object.assign(new String(day), { matches(re) { return re.test(String(this)); } });
  const env = { auth: uid ? { uid } : null, root: new Snap({ msgAuth: { [uid]: claim } }), data: new Snap(prev), newData: new Snap(next), now: NOW, $day, $code: code };
  if (!run(node['.write'], env)) return false;
  if (!run(node['.validate'], env)) return false;
  for (const k of Object.keys(next || {})) {
    const r = node[k] ? node[k]['.validate'] : node.$other['.validate'];
    if (r === false) return false;
    const cenv = { ...env, data: env.data.child(k), newData: env.newData.child(k) };
    if (!run(r, cenv)) return false;
  }
  return true;
}
const start = { name: 'test1', emoji: '🧪', o: NOW, at: NOW };
const later = NOW + 60000;
const fin = (o) => ({ name: 'test1', emoji: '🧪', o, at: later, stars: 3, hints: 0, sec: 200 });

ok('start: your own claimed code may post', allowed({ next: start }));
ok('start: another player\'s code is refused', !allowed({ code: 'QQQQ1', next: start }));
ok('start: signed out is refused', !allowed({ uid: null, next: start }));
ok('start: `o` must be the server\'s time on the first post', !allowed({ next: { ...start, o: NOW - 5000 } }));
ok('start: `at` must be the server\'s time', !allowed({ next: { ...start, at: NOW - 1 } }));
ok('start: name required', !allowed({ next: { emoji: 'x', o: NOW, at: NOW } }));
ok('start: a name over 40 characters is refused', !allowed({ next: { ...start, name: 'x'.repeat(41) } }));
ok('start: no extra fields', !allowed({ next: { ...start, words: 3 } }));
ok('day key: <en|es>-<YYYY-MM-DD> only', allowed({ day: 'es-2026-11-03', next: start }) && !allowed({ day: 'fr-2026-11-03', next: start })
  && !allowed({ day: 'en-12', next: start }) && !allowed({ day: '2026-11-02', next: start }));
const s1 = { ...start };
ok('finish: over the started row, `o` kept', allowed({ prev: s1, next: { ...fin(NOW), at: NOW } }));
ok('finish: `o` can never move', !allowed({ prev: s1, next: { ...fin(NOW - 1), at: NOW } }));
ok('finish: a first post that is already finished (offline until the end) sets `o` now', allowed({ next: { ...fin(NOW), at: NOW } }));
ok('finish: stars follow hints (0 = 3, 1 = 2, 2+ = 1)', allowed({ prev: s1, next: { ...fin(NOW), at: NOW, stars: 2, hints: 1 } })
  && allowed({ prev: s1, next: { ...fin(NOW), at: NOW, stars: 1, hints: 4 } })
  && !allowed({ prev: s1, next: { ...fin(NOW), at: NOW, stars: 3, hints: 1 } }) && !allowed({ prev: s1, next: { ...fin(NOW), at: NOW, stars: 2, hints: 0 } }));
ok('finish: stars need hints and sec', !allowed({ prev: s1, next: { ...start, stars: 3, hints: 0 } }) && !allowed({ prev: s1, next: { ...start, stars: 3, sec: 5 } }));
ok('finish: stars 1-3 only', !allowed({ prev: s1, next: { ...fin(NOW), at: NOW, stars: 4, hints: 0 } }));
const done = { ...fin(NOW), at: NOW };
ok('final: a finished row can never be lowered or changed', !allowed({ prev: done, next: { ...done, stars: 2, hints: 1 } })
  && !allowed({ prev: done, next: { ...done, sec: 100 } }) && !allowed({ prev: done, next: { ...start } }));
ok('final: the same result again (a new name or emoji) is fine', allowed({ prev: done, next: { ...done, name: 'test one' } }));
ok('final: no delete', !allowed({ prev: done, next: null }));
ok('a negative or huge time is refused', !allowed({ prev: s1, next: { ...fin(NOW), at: NOW, sec: -1 } }) && !allowed({ prev: s1, next: { ...fin(NOW), at: NOW, sec: 9e6 } }));

// The backup reads the branch; board.js writes only what the rules know.
const backup = readFileSync(new URL('../backups/rtdb-backup.mjs', import.meta.url), 'utf8');
ok('backups/rtdb-backup.mjs BRANCHES has wwDaily', /'wwDaily'/.test(backup.slice(backup.indexOf('export const BRANCHES'), backup.indexOf('];', backup.indexOf('export const BRANCHES')))));
const board = readFileSync(new URL('../word-weaver/js/board.js', import.meta.url), 'utf8');
ok('board.js asks writesAllowed before writing (test automation never writes)', board.indexOf('writesAllowed(') > 0 && board.indexOf('writesAllowed(') < board.indexOf('api.set('));
ok('board.js writes under the claimed code (ensureAuthClaim, myCode)', /ensureAuthClaim\(boot\)/.test(board) && /myCode\(\)/.test(board) && /`wwDaily\/\$\{key\}\/\$\{code\}`/.test(board));
const fields = ['name', 'emoji', 'o', 'at', 'stars', 'hints', 'sec'];
ok('board.js posts only name, emoji, o, at, stars, hints, sec', fields.every((f) => node[f]) && !/words:|points:|rank:/.test(board));

console.log(`wwDaily rules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
