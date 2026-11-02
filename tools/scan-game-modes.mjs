// tools/scan-game-modes.mjs - THE FULL SCAN (2026-11-02, Matt: "it is IMPERATIVE that ALL game data is
// logged ... FIX THIS PERMANENTLY").
//
// The first mode check (2026-10-30) only looked at a fixed LIST of files (tools/game-modes.json) with a
// count of calls each. Filler and Mancala were never on the list and recorded no mode at all. This scan
// has NO list of files: it reads EVERY .js / .mjs / .html file in the repo (outside tools/, functions/,
// docs/, backups/, archive/, reference/, node_modules/ and the stats modules themselves) and finds every
// call of every stats recorder:
//   - a RESULT recorder (`recordResult`, `record<Game>`, read from js/game-stats.js's exports) must sit
//     lexically inside a `withMode(` call's arguments;
//   - a DEFERRED result must carry a mode tag: `armQuitLoss(`, `armLeave(`, `recordLeaveWin(`,
//     `recordLiveResult(` need a `modeTag(` among their arguments, and every object literal with
//     `winArgs:` (live-leave's onRoomEnded / checkRejoin) needs one too;
//   - Monopoly Deal / Parchis (`__ghStats.record(` / `__ghStats.armQuit(`) must pass the mode argument.
// A recorder that is NOT a game result (a hint used, a bankroll line, a head-to-head side count) is in
// AUX below, each with its reason. Nothing else is exempt. A new game, or a new record call in an old
// one, fails `node tools/test-game-modes.mjs` until it records its mode.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Recorders that are not a game's RESULT, so they carry no mode. Each with why. */
export const AUX = {
  recordHeadToHead: 'the opponent side-count of a result already recorded (and moded) by the game recorder',
  recordGridlockHint: 'a hint used on a level, not a result; the level result is recordGridlock',
  recordWordWeaverFreeLost: 'free-hint bookkeeping, not a result',
  recordWordWeaverFreeHint: 'free-hint bookkeeping, not a result',
  recordWordWeaverHint: 'a hint used on a level, not a result; the level result is recordWordWeaver',
  recordWordWeaverDailyHint: 'a hint used on the daily, not a result; the result is recordWordWeaverDaily',
  recordHoldemBank: 'a bankroll ledger line; the match result is recordResult(\'holdem\') in withMode',
  recordHoldemHand: 'one hand inside a match; the match result is recordResult(\'holdem\') in withMode',
  recordBaseballCareerStarted: 'a career bookkeeping stamp, not a game; each game is recordBaseball',
  recordBaseballCareerFinished: 'a career summary row, not a game; each game is recordBaseball',
  recordLiveResult: 'the deferred live-room recorder itself; checked through its `tag` argument instead',
  recordSpellingBeeGenius: 'a milestone (Genius) on a day already counted, and moded, by recordResult(\'spellingbee\', \'daily\') in withMode',
};
// The same names are js/game-stats.js NOT_A_RESULT (no '?' net at run time); a test keeps them equal.
/** Files that define or route recorders rather than call them for a game. */
const SKIP_FILES = new Set([
  'js/game-stats.js',            // the recorders themselves
  'js/game-stats-global.js',     // Monopoly Deal / Parchis's recorder
  'business-deal/js/game-stats-global.js',
  'js/live-leave.js',            // passes a game's own fn/args/tag through (checked at the game's call)
  'sw.js',
]);
const SKIP_DIRS = new Set(['tools', 'functions', 'docs', 'backups', 'archive', 'reference', 'node_modules', '.git', '.claude', 'img', 'icons', 'css']);

export function resultRecorders() {
  const src = readFileSync(join(ROOT, 'js/game-stats.js'), 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export function (record[A-Z]\w*)\s*\(/g)) names.add(m[1]);
  for (const n of Object.keys(AUX)) names.delete(n);
  return [...names].sort();
}

export function listFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p).split('\\').join('/');
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name) && !/\.min$/.test(name)) listFiles(p, out); continue; }
    if (!/\.(m?js|html)$/.test(name) || /\.min\.js$/.test(name) || SKIP_FILES.has(rel)) continue;
    // generated data and vendored libraries carry no record calls; skip anything huge
    if (st.size > 1.5e6) continue;
    out.push(rel);
  }
  return out;
}

/** The source with comments, strings and regex literals blanked to spaces (positions kept). */
export function blank(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let prevSig = '';   // last significant char, to tell a regex from a division
  const put = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  // Template literals: the text is blanked, the code inside `${...}` is kept (it can hold a call),
  // nested templates included. `stack` holds, per open `${`, the brace depth at which it closes.
  const stack = [];
  let depth = 0;
  const tmpl = (from) => {
    let j = from;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') { put(from, j); return { i: j + 1, open: false }; }
      if (src[j] === '$' && src[j + 1] === '{') { put(from, j); return { i: j + 2, open: true }; }
      j++;
    }
    put(from, n); return { i: n, open: false };
  };
  const afterTmpl = (r) => { i = r.i; prevSig = 'x'; if (r.open) { stack.push(depth); depth++; prevSig = '{'; } };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; put(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; put(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      put(i + 1, j); i = j + 1; prevSig = 'x'; continue;
    }
    if (c === '`') { afterTmpl(tmpl(i + 1)); continue; }
    if (c === '{') { depth++; prevSig = c; i++; continue; }
    if (c === '}') {
      depth--;
      if (stack.length && stack[stack.length - 1] === depth) { stack.pop(); afterTmpl(tmpl(i + 1)); continue; }
      prevSig = c; i++; continue;
    }
    if (c === '/' && (prevSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prevSig))) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j++;
      }
      if (src[j] === '/') { put(i + 1, j); i = j + 1; prevSig = 'x'; continue; }
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

/** Position of the `)` closing the `(` at `open`, or -1. */
export function closeOf(s, open) {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    const ch = s[k];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) return k; }
  }
  return -1;
}
/** The identifiers called by each unclosed `(` around `pos`, innermost first. */
function enclosingCalls(s, pos) {
  const names = [];
  let depth = 0;
  for (let k = pos - 1; k >= 0; k--) {
    const ch = s[k];
    if (ch === ')' || ch === ']' || ch === '}') depth++;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) { depth--; continue; }
      if (ch === '(') { const m = /([A-Za-z_$][\w$]*)\s*$/.exec(s.slice(Math.max(0, k - 60), k)); names.push(m ? m[1] : ''); }
    }
  }
  return names;
}
const lineOf = (s, pos) => s.slice(0, pos).split('\n').length;

/** Split `s` (blanked) at its top-level commas. */
function splitTop(s) {
  const out = []; let depth = 0, from = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) { out.push(s.slice(from, k)); from = k + 1; }
  }
  out.push(s.slice(from));
  return out.map((x) => x.trim()).filter((x, i, a) => x || i < a.length - 1);
}
const THUNK_RE = /^(async\s*)?(\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>|^function\b/;
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
// after blanking a string literal is its quotes with spaces inside
const LITERAL_RE = /^(-?\d[\d_.eE+-]*|'\s*'|"\s*"|`\s*`|true|false|null|undefined)$/;
/** Is `arg` safe to evaluate at the call site: a thunk, an identifier, a literal, or an object literal
 *  of those (no member access, no call, no spread: anything that could THROW before withMode runs). */
export function safeArg(arg) {
  const a = String(arg || '').trim();
  if (!a) return true;
  if (THUNK_RE.test(a) || IDENT_RE.test(a) || LITERAL_RE.test(a)) return true;
  if (a[0] === '{' && closeOf(a, 0) === a.length - 1) {
    for (const p of splitTop(a.slice(1, -1))) {
      if (!p) continue;
      if (IDENT_RE.test(p)) continue;                       // shorthand { detail }
      const m = /^([A-Za-z_$][\w$]*|'\s*'|"\s*")\s*:\s*([\s\S]*)$/.exec(p);
      if (!m || !safeArg(m[2])) return false;
    }
    return true;
  }
  return false;
}

/** Every problem in one file's source: [{ line, what }]. */
export function scanSource(src, recorders = resultRecorders()) {
  const s = blank(src);
  const bad = [];
  const calls = [];
  const rec = new RegExp('(?:^|[^\\w$])(' + recorders.join('|') + ')\\s*\\(', 'g');
  for (const m of s.matchAll(rec)) {
    const name = m[1];
    const at = m.index + m[0].length - 1;      // the '('
    const before = s.slice(Math.max(0, m.index - 12), m.index + 1);
    if (/function\s*$/.test(before) || /\bfunction\s+$/.test(s.slice(Math.max(0, m.index - 12), m.index + m[0].indexOf(name)))) continue;
    const close = closeOf(s, at);
    if (close > 0 && /^\s*\{/.test(s.slice(close + 1, close + 20))) continue;   // a method definition
    calls.push({ name, line: lineOf(s, at) });
    if (!enclosingCalls(s, m.index + m[0].indexOf(name)).includes('withMode')) bad.push({ line: lineOf(s, at), what: `${name}(...) outside withMode()` });
  }
  for (const m of s.matchAll(/(?:^|[^\w$])(armQuitLoss|armLeave|recordLeaveWin|recordLiveResult)\s*\(/g)) {
    const at = m.index + m[0].length - 1;
    const before = s.slice(Math.max(0, m.index - 12), m.index + 1);
    if (/function\s*$/.test(before)) continue;
    const close = closeOf(s, at);
    if (close > 0 && /^\s*\{/.test(s.slice(close + 1, close + 20))) continue;
    const args = close > 0 ? src.slice(at, close) : '';
    if (!/\bmodeTag\s*\(/.test(blank(args))) bad.push({ line: lineOf(s, at), what: `${m[1]}(...) without a modeTag()` });
  }
  // The MODE and the SCORE/DETAIL are evaluated INSIDE withMode / modeTag (2026-11-02): an argument
  // computed at the call site that throws would skip the record call itself (THE LAW). So each must be
  // a thunk (() => ...), an identifier, a literal, or an object literal of those.
  for (const m of s.matchAll(/(?:^|[^\w$.])(withMode|modeTag)\s*\(/g)) {
    const at = m.index + m[0].length - 1;
    if (/function\s+$/.test(s.slice(Math.max(0, at - 30), at - m[1].length))) continue;
    const close = closeOf(s, at);
    if (close < 0 || /^\s*\{/.test(s.slice(close + 1, close + 20))) continue;
    const args = splitTop(s.slice(at + 1, close));
    const scoreAt = m[1] === 'withMode' ? 3 : 2;
    if (!safeArg(args[0])) bad.push({ line: lineOf(s, at), what: `${m[1]}(...) mode argument is computed at the call site; pass a thunk: () => (...)` });
    if (args.length > scoreAt && !safeArg(args[scoreAt])) bad.push({ line: lineOf(s, at), what: `${m[1]}(...) score/detail argument is computed at the call site; pass { detail: () => (...) } or a thunk` });
  }
  for (const m of s.matchAll(/\bwinArgs\s*:/g)) {
    // the object literal holding it
    let depth = 0, open = -1;
    for (let k = m.index - 1; k >= 0; k--) {
      const ch = s[k];
      if (ch === ')' || ch === ']' || ch === '}') depth++;
      else if (ch === '(' || ch === '[' || ch === '{') { if (depth > 0) depth--; else if (ch === '{') { open = k; break; } }
    }
    const close = open >= 0 ? closeOf(s, open) : -1;
    if (close < 0 || !/\bmodeTag\s*\(/.test(s.slice(open, close))) bad.push({ line: lineOf(s, m.index), what: 'a winArgs object (onRoomEnded / checkRejoin) without tag: modeTag()' });
  }
  for (const m of s.matchAll(/__ghStats\.(record|armQuit)\s*\(/g)) {
    const at = m.index + m[0].length - 1;
    const close = closeOf(s, at);
    const inner = close > 0 ? s.slice(at + 1, close) : '';
    let depth = 0, commas = 0;
    for (const ch of inner) { if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--; else if (ch === ',' && depth === 0) commas++; }
    const need = m[1] === 'record' ? 4 : 2;     // record(id, diff, won, drained, MODE) / armQuit(id, diff, MODE)
    if (commas < need) bad.push({ line: lineOf(s, at), what: `__ghStats.${m[1]}(...) without its mode argument` });
  }
  return { bad, calls };
}

/** The whole repo: { files, calls, bad: [{ file, line, what }] }. */
export function scanRepo() {
  const recorders = resultRecorders();
  const files = listFiles();
  const bad = [];
  let calls = 0;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    if (!/record|armQuit|armLeave|winArgs|__ghStats/.test(src)) continue;
    const r = scanSource(src, recorders);
    calls += r.calls.length;
    for (const b of r.bad) bad.push({ file: f, ...b });
  }
  return { files: files.length, calls, bad, recorders };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = scanRepo();
  console.log(`${r.files} files, ${r.calls} result-recorder calls, ${r.bad.length} problem(s)`);
  for (const b of r.bad) console.log(`  ${b.file}:${b.line}  ${b.what}`);
  if (r.bad.length) process.exit(1);
}
