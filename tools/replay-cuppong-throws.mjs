// tools/replay-cuppong-throws.mjs - READ ONLY: one player's REAL Cup Pong throws, flown again on the live
// physics and on the admin-only test physics (physics.js model 'test'), side by side (2026-11-16, Matt:
// "Replay my real throws with the new bounce"). Writes nothing anywhere.
//
//   NODE_USE_ENV_PROXY=1 node tools/replay-cuppong-throws.mjs <CODE>
//
// Throws: every challenge throw of <CODE> (cuppong/games, the rack rebuilt by replaying each log through
// match.js) + the play log's solo / vs computer / test throws (playLog/<CODE>, from 2026-11-05; its 'mp'
// throws are the challenge ones, so skipped). Needs the reader key (GAMEHUB_READER) for the play log.
// A throw stored before 2026-10-27 was rounded: physics.js replayVector finds the vector the live game
// turns into what was recorded, and BOTH physics fly that vector. "table first" = the ball's first contact
// was the table (a bounce shot).
import { readPath } from '../backups/rtdb-backup.mjs';
import { firebaseConfig } from '../js/firebase-config.js';
import { signInForReading } from './reader-auth.mjs';
import { simulateThrow, replayVector } from '../cup-pong/js/physics.js';
import { cupsXZ } from '../cup-pong/js/rack.js';
import { validateGame, sideOf, freshMatch, applyEntry } from '../cup-pong/js/mp.js';

const code = (process.argv[2] || '').toUpperCase();
if (!/^[A-Z0-9]{5}$/.test(code)) { console.error('usage: node tools/replay-cuppong-throws.mjs <CODE>'); process.exit(2); }
const { idToken } = await signInForReading();
const games = (await readPath(firebaseConfig.databaseURL, 'cuppong/games', idToken)) || {};
let log = {};
try { log = (await readPath(firebaseConfig.databaseURL, `playLog/${code}`, idToken)) || {}; }
catch { console.error('No reader key (GAMEHUB_READER): challenge throws only.'); }

const throws = [];
for (const [gid, raw] of Object.entries(games)) {
  const g = validateGame({ ...raw, id: raw.id || gid });
  const side = g && sideOf(g, code);
  if (!side) continue;
  const m = freshMatch(g.rules);
  for (const e of g.log) {
    if (e.k === 't' && e.by === side && !m.over) {
      if (!m.queue.length) m.startTurn();
      if (e.by !== m.shooter) break;
      throws.push({ src: 'challenge', power: e.p, aim: e.a, cups: cupsXZ(m.target()), rec: e.m || '' });
      m.throwResult({ made: e.m || null, bounced: !!e.b });
    } else if (!applyEntry(m, e)) break;
  }
}
for (const x of Object.values(log)) {
  if (!x || x.g !== 'cuppong' || x.e !== 'throw' || x.m === 'mp') continue;
  let d; try { d = JSON.parse(x.d); } catch { continue; }
  if (!d || !Array.isArray(d.r)) continue;
  throws.push({ src: String(x.m || '?'), power: d.p, aim: d.a, cups: cupsXZ(d.r.map(([id, u, v]) => ({ id, u, v }))), rec: d.o === 'made' ? d.mc : '' });
}

const id = (o) => (o.kind === 'made' ? o.id : '');
const first = (r) => r.events.find((e) => e === 'table' || e === 'cup' || e === 'made') || null;
const rows = throws.map((th) => {
  let v = { power: th.power, aim: th.aim };
  if (id(simulateThrow({ ...v, cups: th.cups }).outcome) !== th.rec && !th.src.startsWith('test')) v = replayVector({ ...v, cups: th.cups }, th.rec);
  const live = simulateThrow({ ...v, cups: th.cups });
  const test = simulateThrow({ ...v, cups: th.cups, model: 'test' });
  return { src: th.src, matched: id(live.outcome) === th.rec, live: { o: id(live.outcome), f: first(live) }, test: { o: id(test.outcome), f: first(test), cap: !!test.outcome.capped } };
});

const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '-');
function report(name, list) {
  if (!list.length) return;
  const s = { live: { m: 0, bt: 0, bm: 0, ft: 0, fm: 0 }, test: { m: 0, bt: 0, bm: 0, ft: 0, fm: 0 } };
  let lost = 0, gained = 0, moved = 0, cap = 0;
  for (const r of list) {
    for (const k of ['live', 'test']) {
      const x = r[k], t = s[k];
      if (x.o) t.m++;
      if (x.f === 'table') { t.bt++; if (x.o) t.bm++; } else if (x.f) { t.ft++; if (x.o) t.fm++; }
    }
    if (r.test.cap) cap++;
    if (r.live.o && !r.test.o) lost++; else if (!r.live.o && r.test.o) gained++; else if (r.live.o !== r.test.o) moved++;
  }
  const L = s.live, T = s.test;
  console.log(`\n${name}: ${list.length} throws (the live replay lands as recorded: ${list.filter((r) => r.matched).length})`);
  console.log(`  made           live ${L.m} (${pct(L.m, list.length)})   test ${T.m} (${pct(T.m, list.length)})`);
  console.log(`  table first    live ${L.bm}/${L.bt} (${pct(L.bm, L.bt)})   test ${T.bm}/${T.bt} (${pct(T.bm, T.bt)})`);
  console.log(`  cup first      live ${L.fm}/${L.ft} (${pct(L.fm, L.ft)})   test ${T.fm}/${T.ft} (${pct(T.fm, T.ft)})`);
  console.log(`  test vs live: ${lost} makes lost, ${gained} gained, ${moved} into another cup; 6 s cap ${cap}`);
}
report('ALL', rows);
report('challenges', rows.filter((r) => r.src === 'challenge'));
report('solo + vs computer', rows.filter((r) => r.src === 'solo' || r.src.startsWith('cpu')));
report('test mode (thrown on an older test physics)', rows.filter((r) => r.src.startsWith('test')));
