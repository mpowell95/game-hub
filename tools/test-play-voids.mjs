// tools/test-play-voids.mjs - voiding ONE play (js/play-voids.js, 2026-11-24). Pure, no network.
//   node tools/test-play-voids.mjs                          unit cases
//   node tools/test-play-voids.mjs --db <dir> <CODE> <id,id>  what voiding those real plays would change (players.json,
//                                                            playLog.json in <dir>); prints before and after, writes nothing
import fs from 'node:fs';
import { playEffect, buildGameVoids, applyPlayCaps, mergePlayVoidAdj, isPlayVoided } from '../js/play-voids.js';
import { aggregatePlayers, SOLO } from '../js/players-agg.js';

let fail = 0;
const ok = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); if (!c) fail++; };
const snakePlay = (id, len, t) => ({ id, e: { f: 'recordSnake', g: 'snake', t, m: 'walls=off@hard', a: JSON.stringify([len, 'hard', 'off']), x: JSON.stringify({ hi: len }) } });

// 1. What a play adds: counters at its level and mode, its bests, its mode's running total.
const ef = playEffect(snakePlay('a', 62).e, true);
ok('a solo play: played -1, won -1, at hard~walls=off', ef.slot === 'hard~walls=off' && ef.d.played === -1 && ef.d.won === -1);
ok('a snake play sets four best fields', ef.fields.length === 4 && ef.fields.every((f) => f.score === 62));
const vs = playEffect({ f: 'recordResult', g: 'darts', m: 'game=301@hard', a: JSON.stringify(['darts', 'hard', false]) }, false);
ok('a lost match: played -1, lost -1', vs.d.played === -1 && vs.d.lost === -1 && vs.d.won === 0);

// 2. The build: two 62s voided, 50 the best real play, a record holding 62 (tainted) and one holding 42.
const plays = [snakePlay('a', 62), snakePlay('b', 62), snakePlay('c', 50), snakePlay('d', 31)];
const built = buildGameVoids('snake', plays.slice(0, 2), plays, [{ sn: { bestLen: 62, bestLenByDiffWalls: { off: { hard: 62 } } } }, { sn: { bestLen: 51, bestLenByDiffWalls: { off: { hard: 42 } } } }], true);
ok('build: two plays out of hard~walls=off', built.adj['hard~walls=off'].played === -2 && built.adj['hard~walls=off'].won === -2);
ok('build: Hard walls-off best falls back to 50 (the log), not 62', built.caps['sn.bestLenByDiffWalls.off.hard'].next === 50 && built.caps['sn.bestLenByDiffWalls.off.hard'].v === 62);
ok('build: overall best falls back to 51 (an untainted record)', built.caps['sn.bestLen'].next === 51);
ok('build: the mode total loses both scores', built.sums['byMode.walls=off.hard.hs'] === -124 && built.sums['byMode.walls=off.hard.hn'] === -2);

// 3. Applying: a best the voids set falls back; a HIGHER later best stays.
const gm = { sn: { bestLen: 62, bestLenByDiffWalls: { off: { hard: 62 } } }, byMode: { 'walls=off': { hard: { hi: 62, hs: 400, hn: 10 } } } };
const cap = applyPlayCaps(gm, built);
ok('apply: best 62 -> 50', cap.sn.bestLenByDiffWalls.off.hard === 50 && cap.byMode['walls=off'].hard.hi === 50);
ok('apply: mode total 400 -> 276, 10 -> 8', cap.byMode['walls=off'].hard.hs === 276 && cap.byMode['walls=off'].hard.hn === 8);
ok('apply: never mutates', gm.sn.bestLen === 62);
const later = applyPlayCaps({ sn: { bestLen: 70, bestLenByDiffWalls: { off: { hard: 70 } } } }, built);
ok('apply: a later 70 stays', later.sn.bestLenByDiffWalls.off.hard === 70);
ok('merge: adjust gets the counters', mergePlayVoidAdj(null, { snake: built }).snake['hard~walls=off'].played === -2);
ok('decision: Matt\'s undo beats a proven hit', isPlayVoided({ void: false }, true) === false && isPlayVoided(null, true) === true && isPlayVoided({ void: true }, false) === true);

// 4. Real data: what voiding the given plays would change on the leaderboard's grouping.
const i = process.argv.indexOf('--db');
if (i > 0) {
  const dir = process.argv[i + 1], code = process.argv[i + 2], ids = String(process.argv[i + 3] || '').split(',');
  const players = JSON.parse(fs.readFileSync(`${dir}/players.json`, 'utf8'));
  const log = JSON.parse(fs.readFileSync(`${dir}/playLog.json`, 'utf8'))[code] || {};
  const voided = ids.map((id) => ({ id, e: log[id] })).filter((v) => v.e);
  const byGame = {};
  for (const v of voided) (byGame[v.e.g] || (byGame[v.e.g] = [])).push(v);
  const pv = {};
  for (const [g, vs2] of Object.entries(byGame)) {
    const all = Object.entries(log).filter(([, e]) => e && e.g === g).map(([id, e]) => ({ id, e }));
    const recs = Object.values(players).filter((r) => ((r.profile || {}).playerId || '').toUpperCase() === code).map((r) => ((r.stats || {}).games || {})[g]).filter(Boolean);
    pv[g] = buildGameVoids(g, vs2, all, recs, SOLO.has(g));
  }
  const before = aggregatePlayers(players, {}).find((p) => (p.playerId || '').toUpperCase() === code);
  const after = aggregatePlayers(players, { playVoids: { [code]: pv } }).find((p) => (p.playerId || '').toUpperCase() === code);
  for (const g of Object.keys(pv)) {
    console.log(`\n${code} ${g}: voiding ${byGame[g].length} play(s)`);
    console.log('  overlay', JSON.stringify(pv[g]));
    const b = before.games[g], a = after.games[g];
    console.log('  played', b.total.played, '->', a.total.played, '| won', b.total.won, '->', a.total.won);
    for (const path of Object.keys(pv[g].caps)) {
      const get = (o) => path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
      console.log(`  ${path}: ${get(b)} -> ${get(a)}`);
    }
  }
}
process.exit(fail ? 1 : 0);
