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

// Trip wires on every play (2026-11-24): one passing and one failing case per rule, and its proven flag.
const P = (e) => checkPlayInput(e);
const has = (e, rule, proven) => P(e).some((h) => h.rule === rule && h.proven === proven);
const J = JSON.stringify;
ok('every hit says proven or not', P(snake(223, 1, 62)).every((h) => typeof h.proven === 'boolean'));
ok('snake turns without input is PROVEN', has(snake(223, 1, 62), 'snake-turns-without-input', true));
ok('made-up input is PROVEN', has({ f: 'recordTower', g: 'tower', a: '[3]', i: '{"t":40,"p":20,"u":5}' }, 'input-made-by-code', true));
ok('no real touch: alerts, suspicious', has({ f: 'recordTower', g: 'tower', a: '[3]', i: '{"t":0,"p":0,"u":0}' }, 'no-real-touch', false));
ok('no real touch: a Hold\'em hand, an online result and a hint are not judged',
  !P({ f: 'recordHoldemHand', g: 'holdem', a: '[{}]', i: '{"t":0,"p":0,"u":0}' }).length
  && !P({ f: 'recordResult', g: 'darts', a: J(['darts', 'mp', true]), i: '{"t":0,"p":0,"u":0}' }).length
  && !P({ f: 'recordWordWeaverHint', g: 'wordweaver', a: '[1,1]', i: '{"t":0,"p":0,"u":0}' }).length);
const tower = (score, drops) => ({ f: 'recordTower', g: 'tower', a: J([score, 'easy']), x: J({ drops }) });
const humanDrops = Array.from({ length: 30 }, (_, k) => [((k * 37) % 13) - 6, 'p', 250, (k + 1) * 3000]);   // 3 s apart: js/trip-wires/tower.js tower-drop-before-arrival
const botDrops = Array.from({ length: 30 }, (_, k) => [0.1, 'p', 250, k * 900]);
ok('tower: more blocks than drops is PROVEN', has(tower(40, humanDrops), 'tower-more-blocks-than-drops', true));
ok('tower: a human run passes', P(tower(29, humanDrops)).length === 0);
ok('tower: 30 dead-centre drops is suspicious', has(tower(29, botDrops), 'tower-machine-precision', false));
const maze = (gap) => ({ f: 'recordWayOut', g: 'wayout', a: '["easy",{}]', x: J({ taps: Array.from({ length: 20 }, (_, k) => `${k}g@${k * gap}`) }) });
ok('arrow maze: taps 80 ms apart is suspicious', has(maze(80), 'arrowmaze-machine-taps', false));
// (perfectly even taps trip the newer wayout-even-rhythm, js/trip-wires/wayout.js: this case is about pace only)
ok('arrow maze: taps 350 ms apart pass', !P(maze(350)).some((h) => h.rule === 'arrowmaze-machine-taps'));
const hc = (x) => ({ f: 'recordHillClimb', g: 'hillclimb', a: J([x.dist, 'countryside', {}]), x: J(x) });
ok('hill climb: a real run passes (King of Games 3,308 m, Nov 19)', P(hc({ dist: 3308, secs: 203.9, fuelLeft: 77, maxFuel: 100, cans: 36 })).length === 0);
ok('hill climb: more cans than the road holds is PROVEN', has(hc({ dist: 300, secs: 20, fuelLeft: 50, maxFuel: 100, cans: 9 }), 'hillclimb-more-cans-than-road', true));
ok('hill climb: a run longer than its fuel is PROVEN', has(hc({ dist: 900, secs: 200, fuelLeft: 50, maxFuel: 100, cans: 2 }), 'hillclimb-fuel-from-nowhere', true));
ok('gridlock: under the fewest moves is PROVEN', has({ f: 'recordGridlock', g: 'gridlock', a: '["easy",{}]', d: J({ moves: 9, fewest: 12 }) }, 'gridlock-under-fewest', true));
ok('gridlock: at the fewest passes', P({ f: 'recordGridlock', g: 'gridlock', a: '["easy",{}]', d: J({ moves: 12, fewest: 12 }) }).length === 0);
const wl = (moves, par, path) => ({ f: 'recordWordLadder', g: 'wordladder', a: '[1,{}]', d: J({ moves, par }), x: J({ path }) });
ok('word ladder: a real ladder passes', P(wl(3, 3, ['ASK', 'ARK', 'ARE', 'AYE'])).length === 0);
ok('word ladder: under par is PROVEN', has(wl(2, 3, ['ASK', 'ARE', 'AYE']), 'wordladder-under-par', true));
ok('word ladder: a two-letter step is PROVEN', has(wl(3, 3, ['ASK', 'ARE', 'ARK', 'AYE']), 'wordladder-bad-step', true));
const yz = (ev) => ({ f: 'recordYahtzee', g: 'yahtzee', a: '["ai",true,{}]', x: J({ ev }) });
ok('yahtzee: a real turn passes', P(yz([['r', 0, [5, 4, 5, 4, 3], '00000', 1], ['r', 0, [5, 4, 5, 4, 5], '11110', 2], ['c', 0, 'fullHouse', 25, 3]])).length === 0);
ok('yahtzee: a held die that changed is PROVEN', has(yz([['r', 0, [5, 4, 5, 4, 3], '00000', 1], ['r', 0, [6, 4, 5, 4, 5], '11110', 2]]), 'yahtzee-held-die-changed', true));
ok('yahtzee: a 4th roll is PROVEN', has(yz([['r', 0, [1, 2, 3, 4, 5], '00000', 1], ['r', 0, [1, 2, 3, 4, 5], '00000', 2], ['r', 0, [1, 2, 3, 4, 5], '00000', 3], ['r', 0, [1, 2, 3, 4, 5], '00000', 4]]), 'yahtzee-four-rolls', true));
ok('dots and boxes: more boxes than the board is PROVEN', has({ f: 'recordDotsBoxes', g: 'dotsboxes', a: '["pro",true]', d: J({ mine: 8, theirs: 3 }), x: J({ rows: 3, cols: 3 }) }, 'dotsboxes-too-many-boxes', true));
ok('filler: more squares than the board is PROVEN', has({ f: 'recordResult', g: 'filler', a: '["filler","pro",true]', d: J({ mine: 40, theirs: 30 }), x: J({ start: 'x'.repeat(63) }) }, 'filler-too-many-cells', true));
ok('hoops: more made than shot is PROVEN', has({ f: 'recordResult', g: 'hoops4', a: '["hoops4","medium",true]', d: J({ shots: 3, made: 4 }) }, 'hoops-more-made-than-shot', true));
ok('cup pong: more made than thrown is PROVEN', has({ f: 'recordCupPong', g: 'cuppong', a: '["hard",true,0]', d: J({ throws: 5, made: 6 }) }, 'cuppong-more-made-than-thrown', true));
ok('cup pong solo: 9 throws is PROVEN', has({ f: 'recordCupPongSolo', g: 'cuppong', a: '[9]', x: J({ end: 'cleared' }) }, 'cuppong-solo-under-10', true));
ok('air hockey: 8 goals to 7 is PROVEN', has({ f: 'recordAirHockey', g: 'airhockey', m: 'to=7@medium', a: J(['medium', true, { goalsFor: 8, goalsAgainst: 1 }]) }, 'airhockey-goals-over-target', true));
ok('golf: a hole in 0 is PROVEN', has({ f: 'recordGolf', g: 'golf', a: J(['pinevalley', { holeScores: { 'pinevalley:1': 0 } }]) }, 'golf-hole-in-zero', true));
ok('battleship: a win in 12 shots is NOT flagged (the Quick board has 12 ship squares, 2026-11-25)', !has({ f: 'recordBattleship', g: 'battleship', a: J(['pro', true, { shots: 12, hits: 12 }]) }, 'battleship-impossible-shots', true));
const bog = (word) => ({ f: 'recordBoggle', g: 'boggle', a: '["beginner",false,{}]', x: J({ faces: [['O', 'S', 'B', 'N'], ['H', 'I', 'N', 'H'], ['M', 'K', 'T', 'A'], ['T', 'E', 'V', 'O']], found: [[word, 1]] }) });
ok('boggle: a word on the board passes (VETO)', P(bog('VETO')).length === 0);
ok('boggle: a word not on the board is PROVEN (ZEBRA)', has(bog('ZEBRA'), 'boggle-word-not-on-board', true));

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

// Every touch and key (2026-11-24): the full input log is queued and sent, the rules accept it, and the
// classic recorder (Monopoly Deal, Parchís) logs the same way.
const R = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8')).rules;
ok('rules: playInput exists, admins + reader read it', !!R.playInput && /admins/.test(R.playInput['.read']) && /readers/.test(R.playInput['.read']));
ok('rules: playInput n up to 12,000 chars, nothing else', /12000/.test(R.playInput.$code.$k.n['.validate']) && R.playInput.$code.$k.$other['.validate'] === false);
ok('rules: playLog i allowed', !!R.playLog.$code.$k.i);
const plq = fs.readFileSync(path.join(root, 'js/play-log-queue.js'), 'utf8');
const pls = fs.readFileSync(path.join(root, 'js/play-log.js'), 'utf8');
const gsg = fs.readFileSync(path.join(root, 'js/game-stats-global.js'), 'utf8');
ok('queue: a result entry queues its input log', /iq\.push\(\{ c: code, id: x\.id, t, n: inp\.n \}\)/.test(plq));
ok('sender: input logs go to playInput/<CODE>/<id>', pls.includes('playInput/${code}/${x.id}'));
ok('sender: every flush also sends input logs', /finally \{ await flushPlayInput\(\); \}/.test(pls));
ok('classic recorder: same input key and log', gsg.includes("'gamehub.playinput.v1'") && /queueInput\(code, q\[q\.length - 1\]\.id, t, inp\.n\)/.test(gsg));
ok('backup lists playInput', fs.readFileSync(path.join(root, 'backups/rtdb-backup.mjs'), 'utf8').includes("'playInput'"));

// Watch closely (2026-11-25, functions/decide.js watchReason): when a watched code's hub event pushes the admins.
const { watchReason } = await import('../functions/decide.js');
ok('watch: the Home Screen app on a known device says nothing', watchReason({ e: 'open' }, { app: true, newDevice: false }, true) === '');
ok('watch: a device not seen before', /not seen before/.test(watchReason({ e: 'open' }, { app: true }, false)));
ok('watch: a browser tab', /browser tab/.test(watchReason({ e: 'open' }, { app: false, dev: 'iPhone · iOS 18.6.2' }, true)));
ok('watch: a computer browser', /computer/.test(watchReason({ e: 'return' }, { app: false, dev: 'Windows' }, true)));
ok('watch: a private or cleared browser', /no saved data/.test(watchReason({ e: 'open' }, { app: true, newDevice: true }, true)));
ok('watch: Reset profile, with the old name', /Reset profile: El Fantasma -> \(no name\)/.test(watchReason({ e: 'account' }, { what: 'reset', from: 'El Fantasma' }, true)));
{ const fx = (await import('node:fs')).readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  ok('watch: an open sends no push (Matt: "Just when he cheats")', /const WATCH_PUSH = false;/.test(fx) && /if \(!WATCH_PUSH\) return;/.test(fx)); }
ok('watch: a game or a hide never pushes', watchReason({ e: 'game' }, {}, false) === '' && watchReason({ e: 'hide' }, {}, false) === '');
const ol = fs.readFileSync(path.join(root, 'js/open-log.js'), 'utf8'), hubSrc = fs.readFileSync(path.join(root, 'js/hub.js'), 'utf8');
ok('open log: hub logs games opened and left', hubSrc.includes('noteGameOpen(id)') && hubSrc.includes('noteGameLeave()'));
ok('open log: name gate and profile page log account changes', fs.readFileSync(path.join(root, 'js/name-gate.js'), 'utf8').includes("noteAccount(") && fs.readFileSync(path.join(root, 'profile/index.html'), 'utf8').includes("noteAccount('reset'"));
ok('open log: open, return, hide, game, leave, account', ['open', 'return', 'hide', 'game', 'leave', 'account'].every((e) => ol.includes(`'${e}'`)));

// A touch-log rule is proven only where the touch log holds the whole play (2026-11-25, js/trip-wires/index.js).
{
  const { TRIP_GAMES, runTripWires, TOUCH_WHOLE } = await import('../js/trip-wires/index.js');
  const n = JSON.stringify({ v: 1, t0: 1, ev: '0d1,1 5u1,1' });
  const probe = { id: 'probe-touch', text: 'probe', proven: true, check: (e, { n: nn }) => (nn && nn.downs < 5 ? { v: 1 } : null) };
  const probeNoN = { id: 'probe-plain', text: 'probe', proven: true, check: () => ({ v: 1 }) };
  TRIP_GAMES.golf.push(probe, probeNoN); TRIP_GAMES.snake.push(probe);
  const g = runTripWires({ f: 'recordGolf', g: 'golf', a: '[1]' }, n), sn = runTripWires({ f: 'recordSnake', g: 'snake', a: '[1]' }, n);
  ok('touch rule in a game that saves (Golf): alert only', g.find((h) => h.rule === 'probe-touch').proven === false);
  ok('a rule that does not read the touch log stays proven', g.find((h) => h.rule === 'probe-plain').proven === true);
  ok('touch rule in a game that cannot be continued (Snake): proven', sn.find((h) => h.rule === 'probe-touch').proven === true);
  ok('TOUCH_WHOLE = Snake, Ball Run, Tower Stack, Brick Breaker, Hill Climb', ['snake', 'ballrun', 'tower', 'brickblitz', 'hillclimb'].every((x) => TOUCH_WHOLE.has(x)) && TOUCH_WHOLE.size === 5);
  TRIP_GAMES.golf.splice(-2); TRIP_GAMES.snake.splice(-1);
}

const i = process.argv.indexOf('--db');
if (i > 0) {
  const log = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  // --input <playInput.json> (2026-11-25): the touch logs, so rules that need them run too.
  const ii = process.argv.indexOf('--input');
  const inputLog = ii > 0 && fs.existsSync(process.argv[ii + 1]) ? JSON.parse(fs.readFileSync(process.argv[ii + 1], 'utf8')) : null;
  let n = 0, hits = 0;
  for (const [code, rows] of Object.entries(log || {})) for (const [id, e] of Object.entries(rows || {})) {
    if (!e || !/^record/.test(String(e.f || ''))) continue;
    n++;
    const nRaw = inputLog && inputLog[code] && inputLog[code][id] ? inputLog[code][id].n : null;
    for (const h of checkPlayInput(e, nRaw)) { hits++; console.log(`ALERT ${h.proven ? 'PROVEN ' : ''}${code} ${id} ${e.g} ${h.rule}: ${h.v}`); }
  }
  console.log(`replayed ${n} real results: ${hits} alerts`);
}
process.exit(fail ? 1 : 0);
