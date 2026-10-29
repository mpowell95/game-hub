// No OTHER player's code in the page (2026-10-29, Matt: "make sure codes aren't viewable by anyone else
// besides Admin"). A player code is the whole identity ("link by code" on a new phone becomes that person),
// so no screen may print another player's code or carry it in an attribute. Rows carry an opaque index
// into an in-memory list instead (js/leaderboard-ui.js `_msgTo`, js/messages-ui.js `_who`).
//
// Static: reads every shipped source file and fails on the shapes that leaked before. Admin (js/admin-ui.js),
// the retired PIN-gated Challenge Control (js/challenge/) and the viewer's OWN code on the profile page are
// exempt. Room join codes (rooms/<CODE>, data-join-code) are not player codes and are not matched.
//
//   node tools/test-no-codes.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['archive', 'node_modules', 'tools', 'docs', 'functions', 'reference', 'backups', '.git', '.claude', 'img', 'icons', 'hole-editor', 'pinball2', 'baseball']);
const EXEMPT = new Set(['js/admin-ui.js']);
const EXEMPT_DIRS = ['js/challenge/'];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p, out); continue; }
    if (/\.(js|mjs|html)$/.test(name) && !/(^|\/)(test|sw)\.js$/.test(p) && !/\/(test-[^/]*|[^/]*\.test)\.(js|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

// Attributes that carry a person's identity. A game's own `data-code` is never a player code either.
const ATTR = /\bdata-(code|player|playerid|pkey|other|who-code|to-code)\s*=\s*["'`]?\$\{/;
// Printing a person's code, or showing it as their name when they have none.
const PRINT = /\$\{\s*esc\(\s*(?:[a-z]+\.)?(?:o|r|c|p|g|row|grp|opp|them|who|other|m|th|x)\.(?:code|playerId|with)\s*\)\s*\}/;
const NAME_FALLBACK = /(?:\.name|\bname)\s*\|\|\s*(?:[a-z]+\.)?(?:o|r|c|p|g|row|grp|opp|them|who|other|m|th|x)\.(?:code|playerId)\b/;
const KEY_ATTR = /data-(?:opp|k|key)\s*=\s*"\$\{\s*esc\(\s*(?:r|o|g|p|row|grp|person)\.key\s*\)\s*\}"/;

const files = walk(ROOT, []);
let pass = 0, fail = 0;
const hits = [];
for (const f of files) {
  const rel = relative(ROOT, f).split('\\').join('/');
  if (EXEMPT.has(rel) || EXEMPT_DIRS.some((d) => rel.startsWith(d))) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/^\s*(\*|\/\/)/.test(line)) return;
    if (/\b(room|join|invite)\w*/i.test(code) && /\.code\b/.test(code) && !ATTR.test(code)) return;   // a room's join code
    for (const [name, re] of [['data attribute carries a code', ATTR], ['prints a player code', PRINT], ['code as a name fallback', NAME_FALLBACK], ['identity key in an attribute', KEY_ATTR]]) {
      if (re.test(code)) hits.push(`${rel}:${i + 1}  ${name}: ${line.trim().slice(0, 140)}`);
    }
  });
}

function check(name, ok, detail) {
  if (ok) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (detail ? '\n' + detail : '')); }
}
check(`no player code reaches the DOM (${files.length} files scanned)`, hits.length === 0, hits.map((h) => '       ' + h).join('\n'));

// The pick-a-person rows of every challenge game use an index into the list they were built from.
const PICKERS = ['darts/js/mp-ui.js', 'cup-pong/js/mp-ui.js', 'archery/js/mp-ui.js', 'flick-soccer/js/mp-ui.js', 'eight-ball/js/mp-ui.js',
  'battle-arena/js/online-ui.js', 'chinchon/js/ch-ui.js', 'escoba/js/mp-ui.js', 'battleship/js/ui.js'];
for (const p of PICKERS) {
  const s = readFileSync(join(ROOT, p), 'utf8');
  check(`${p}: person rows are indexes`, /data-oi="\$\{/.test(s) && !/data-code=/.test(s));
}
const mu = readFileSync(join(ROOT, 'js/messages-ui.js'), 'utf8');
check('js/messages-ui.js: rows carry an index (data-wi), never data-code', /data-wi="\$\{whoIx\(/.test(mu) && !/data-code=/.test(mu));
const cx = readFileSync(join(ROOT, 'js/challenges-ui.js'), 'utf8');
check('js/challenges-ui.js: sheet, Records and bell carry indexes', /data-pi="\$\{i\}"/.test(cx) && /idxOf\(_nudgeTo/.test(cx) && /_oppKeys\.push/.test(cx) && !/data-code=/.test(cx));
const lb = readFileSync(join(ROOT, 'js/leaderboard-ui.js'), 'utf8');
check('js/leaderboard-ui.js: Send message carries an index', /data-mi="\$\{mi\}"/.test(lb) && !/data-code=/.test(lb));

console.log(`\nno-codes tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
