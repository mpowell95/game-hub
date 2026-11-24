// tools/test-play-input.mjs - the scripted-play alert (js/integrity.js checkPlayInput, 2026-11-24) and the
// closed test seams (js/seams.js). Pure, no network.
//   node tools/test-play-input.mjs                     unit cases + no game file puts its insides on window
//   node tools/test-play-input.mjs --db <playLog.json> replay every real play: list each alert
import fs from 'node:fs';
import path from 'node:path';
import { checkPlayInput } from '../js/integrity.js';

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fail++; };
const rules = (e) => checkPlayInput(e).map((h) => h.rule);
const snake = (turns, inputs, len) => ({ f: 'recordSnake', g: 'snake', a: JSON.stringify([len, 'hard', 'off']),
  d: JSON.stringify({ padTaps: inputs, swipes: 0, keys: 0 }), x: JSON.stringify({ turns: Array.from({ length: turns }, (_, k) => `${k}u`) }) });

// Snake: a person's run (inputs >= turns) passes; King of Games' Nov 17 run (223 turns, 1 tap) alerts.
ok('snake: a normal run passes', rules(snake(253, 259, 49)).length === 0);
ok('snake: refused turns (inputs > turns) pass', rules(snake(100, 140, 30)).length === 0);
ok('snake: 223 turns from 1 tap alerts', rules(snake(223, 1, 62)).includes('snake-turns-without-input'));
ok('snake: a small gap (turns = inputs + 3) passes', rules(snake(13, 10, 12)).length === 0);
// Made-up input, any game.
ok('made-up touches alert', rules({ f: 'recordTower', g: 'tower', a: '[3]', i: '{"t":40,"p":20,"u":5}' }).includes('input-made-by-code'));
ok('real touches only pass', rules({ f: 'recordTower', g: 'tower', a: '[3]', i: '{"t":40,"p":20,"u":0}' }).length === 0);
// Ball Run / Tower Stack.
ok('ball run 200 with 2 touches alerts', rules({ f: 'recordBallRun', g: 'ballrun', a: '[200,"hard","classic"]', i: '{"t":2,"p":1,"u":0}' }).includes('ballrun-score-without-touch'));
ok('ball run 200 with 900 touches passes', rules({ f: 'recordBallRun', g: 'ballrun', a: '[200,"hard","classic"]', i: '{"t":900,"p":30,"u":0}' }).length === 0);
ok('ball run before the report (no i) passes', rules({ f: 'recordBallRun', g: 'ballrun', a: '[200,"hard","classic"]' }).length === 0);
ok('tower 41 blocks from 3 taps alerts', rules({ f: 'recordTower', g: 'tower', a: '[41,"easy"]', i: '{"t":10,"p":3,"u":0}' }).includes('tower-blocks-without-taps'));
ok('tower 41 blocks from 45 taps passes', rules({ f: 'recordTower', g: 'tower', a: '[41,"easy"]', i: '{"t":90,"p":45,"u":0}' }).length === 0);
ok('a non-result entry is never judged', rules({ e: 'guess', g: 'contexto', i: '{"t":0,"p":0,"u":9}' }).length === 0);

// No game file puts its insides on window outside js/seams.js (or behind DEV_SEAMS / DEV_HOST / this.dev).
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const skip = /(^|\/)(node_modules|tools|archive|functions|vendor|docs|backups|pinball2|hole-editor|\.git)(\/|$)|test[^/]*\.js$|net-test\.js$/;
const bad = [];
(function walk(dir) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name), rel = path.relative(root, p);
    if (skip.test(rel)) continue;
    if (n.isDirectory()) { walk(p); continue; }
    if (!n.name.endsWith('.js') || rel === 'js/seams.js') continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    lines.forEach((line, k) => {
      if (!/(window|globalThis|self)\.__[A-Za-z0-9_]+\s*=[^=]/.test(line)) return;
      // the guard on this line or within the 4 lines above it (`if (!DEV_HOST) return;`)
      if (/DEV_SEAMS|DEV_HOST|this\.dev|localhost|__bdChallenge|window\.__[A-Za-z0-9_]+\s*=\s*window\.__/.test(lines.slice(Math.max(0, k - 4), k + 1).join('\n'))) return;
      bad.push(`${rel}:${k + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
})(root);
ok(`no game puts its insides on window on the live site${bad.length ? ': ' + bad.join(' | ') : ''}`, bad.length === 0);

const i = process.argv.indexOf('--db');
if (i > 0) {
  const log = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  let n = 0, hits = 0;
  for (const [code, rows] of Object.entries(log || {})) for (const [id, e] of Object.entries(rows || {})) {
    if (!e || !/^record/.test(String(e.f || ''))) continue;
    n++;
    for (const h of checkPlayInput(e)) { hits++; console.log(`ALERT ${code} ${id} ${e.g} ${h.rule}: ${h.v}`); }
  }
  console.log(`replayed ${n} real results: ${hits} alerts`);
}
process.exit(fail ? 1 : 0);
