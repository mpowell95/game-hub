// test-shoveoff-sealed.mjs - Knockout's sealed rounds, the SERVER's half (2026-11-25): functions/shoveoff.js
// (revealRound) and its pure core, shove-off/js/match.js revealSealed, exactly as the Cloud Function runs them
// (the shared copy made by tools/sync-functions-shared.mjs). A fake Admin SDK database (get / update /
// transaction with compare-and-set), no network. Never Matt's code or name.
//   node tools/test-shoveoff-sealed.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, ['tools/sync-functions-shared.mjs'], { cwd: ROOT, stdio: 'ignore' });
const F = await import('../functions/shoveoff.js');
const M = await import('../functions/shared/shove-off/js/match.js');
const E = await import('../functions/shared/shove-off/js/engine.js');
const { decideShoveOff } = await import('../functions/decide.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('ok   ', name); } else { fail++; console.log('FAIL ', name, extra); } };
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const T0 = 1_800_000_000_000;

/** Aims for side s on match m: f(piece) -> [dx, dy]. */
function aimsOn(m, s, f) {
  const list = Array.from({ length: E.slotCount(m) }, () => null);
  for (const p of E.alive(m, s)) list[p.i] = E.clampAim(...f(p));
  return E.aimsToString(list);
}
const soft = (p) => [p.x > 0 ? -70 : 70, p.y > 0 ? -20 : 20];
const out = (p) => { const d = Math.sqrt(p.x * p.x + p.y * p.y) || 1; return [p.x / d * 9999, p.y / d * 9999]; };
const doc = (extra = {}) => ({
  v: 1, rv: 2, sv: 1, id: 'sealtest01', lapse: true, by: 'TESTA', created: T0, updated: T0 + 10,
  a: { code: 'TESTA', name: 'test1', emoji: '🐙', look: 'car1' }, b: { code: 'TESTB', name: 'Tester Two', emoji: '🦊', look: 'sumo0' },
  log: null, over: null, ...extra,
});
const m0 = E.newMatch(2);
const A1 = aimsOn(m0, 'a', soft), B1 = aimsOn(m0, 'b', soft);

// --- the pure core --------------------------------------------------------------------------------
{
  const raw = doc({ sealed: { r1: { a: T0 + 10 } } });
  const g = M.validateGame(raw);
  ok('a sealed match validates: the sealed side does not owe, the other does, nothing in the log', g && g.sv === 1 && !g.owes.a && g.owes.b && g.log.length === 0 && g.sealed.a === T0 + 10 && !g.resolving);
  ok('one side sealed: nothing to reveal (waiting)', M.revealSealed(raw, { a: { aims: A1, at: T0 + 10 } }, 1, T0 + 20).skip === 'waiting');
  const before = JSON.stringify(raw);
  const both = { ...raw, sealed: { r1: { a: T0 + 10, b: T0 + 30 } } };
  const gb = M.validateGame(both);
  ok('both sealed, not revealed yet: neither owes, the match says it is resolving', gb && !gb.owes.a && !gb.owes.b && gb.resolving && gb.round === 1 && gb.resolved === 0);
  const x = M.revealSealed(both, { a: { aims: A1, at: T0 + 10, u: 'u1' }, b: { aims: B1, at: T0 + 30, u: 'u2' } }, 1, T0 + 40);
  ok('both sealed: both entries appended, the first sealed first, the log shape every older match has',
    !x.skip && JSON.stringify(x.doc.log) === JSON.stringify({ '0000': { by: 'a', r: 1, aims: A1, at: T0 + 10 }, '0001': { by: 'b', r: 1, aims: B1, at: T0 + 30 } }), JSON.stringify(x));
  ok('...round 1 resolved, round 2 owed by both, `updated` = server time, the writer = the side that sealed last',
    x.game.resolved === 1 && x.game.round === 2 && x.game.owes.a && x.game.owes.b && x.doc.updated === T0 + 40 && x.writer === 'b' && x.added === 2);
  ok('...the stored document passed in is never changed', JSON.stringify(raw) === before);
  ok('...and it replays bit for bit like the same aims sent the old way', (() => {
    const mOld = E.newMatch(2); E.applyAims(mOld, 'a', 1, A1); E.applyAims(mOld, 'b', 1, B1);
    const mNew = M.replayGame(x.game);
    return JSON.stringify(mOld.pieces) === JSON.stringify(mNew.pieces) && mOld.H === mNew.H;
  })());
  const y = M.revealSealed({ ...raw, sealed: { r1: { a: T0 + 50, b: T0 + 20 } } }, { a: { aims: A1, at: T0 + 50 }, b: { aims: B1, at: T0 + 20 } }, 1, T0 + 60);
  ok('the receiver sealed first: their entry goes first, the challenger is the writer', y.doc.log['0000'].by === 'b' && y.doc.log['0001'].by === 'a' && y.writer === 'a');
  const z = M.revealSealed(raw, { a: { aims: A1, at: T0 + 5 }, b: { aims: B1, at: T0 + 5 } }, 1, T0 + 60);
  ok('sealed in the same millisecond: side a first (fixed, so both phones replay the same order)', z.doc.log['0000'].by === 'a');
  ok('a round that is not the current one is never revealed', M.revealSealed(raw, { a: { aims: A1, at: 1 }, b: { aims: B1, at: 2 } }, 2, T0).skip === 'moved-on');
  ok('an arrow past the cap is refused (nothing appended)', M.revealSealed(raw, { a: { aims: A1, at: 1 }, b: { aims: '9999,0;0,0;0,0;0,0', at: 2 } }, 1, T0).skip === 'rules-refused');
  ok('a malformed entry = still waiting', M.revealSealed(raw, { a: { aims: A1, at: 1 }, b: { aims: 7, at: 2 } }, 1, T0).skip === 'waiting');
  ok('an old match (no sv) is never touched', M.revealSealed({ ...raw, sv: undefined }, { a: { aims: A1, at: 1 }, b: { aims: B1, at: 2 } }, 1, T0).skip === 'not-sealed');
  ok('a match that is over (resigned with one side sealed) is never revealed', M.revealSealed({ ...raw, over: { winner: 'a', why: 'resign', at: T0 } }, { a: { aims: A1, at: 1 }, b: { aims: B1, at: 2 } }, 1, T0).skip === 'over');
  ok('an unknown sealing version is not a match', M.validateGame({ ...raw, sv: 2 }) === null);
  // A round that decides the match: `over` exactly as a phone sets it.
  const sd = M.revealSealed(raw, { a: { aims: aimsOn(m0, 'a', out), at: 1 }, b: { aims: aimsOn(m0, 'b', out), at: 2 } }, 1, T0 + 70);
  ok('everyone off in round 1 = sudden death, not over', !sd.skip && !sd.doc.over && sd.game.sd === 1);
  const sdRaw = { ...sd.doc, sealed: { r2: { a: T0 + 80, b: T0 + 81 } } };
  const win = M.revealSealed(sdRaw, { a: { aims: '560,0', at: T0 + 80 }, b: { aims: '-80,0', at: T0 + 81 } }, 2, T0 + 90);
  ok('a round that decides it sets over = { winner, why, at } from the replay (a wins, sudden)', win.doc.over && win.doc.over.winner === 'a' && win.doc.over.why === 'sudden' && win.doc.over.at === T0 + 90 && win.game.over.winner === 'a');
  ok('a called-off match the receiver had already sealed into is not called off (the cancel lost the race, as before)',
    !!M.validateGame({ ...raw, sealed: { r1: { a: T0 + 10, b: T0 + 30 } }, over: { winner: 'none', why: 'cancelled', at: T0 } })
    && !M.validateGame({ ...raw, sealed: { r1: { a: T0 + 10, b: T0 + 30 } }, over: { winner: 'none', why: 'cancelled', at: T0 } }).over);
  ok('a receiver who sealed has answered (lifeOf: not open) and the challenger has played', (() => {
    const g2 = M.validateGame({ ...raw, sealed: { r1: { a: T0 + 10, b: T0 + 30 } } });
    const g1 = M.validateGame(raw);
    return !M.lifeOf(g2, T0 + 50).open && M.lifeOf(g1, T0 + 50).open && M.lifeOf(g1, T0 + 50).waiting && M.senderPlayed(g1) && M.cancelCosts(g1);
  })());
}

// --- revealRound against a fake Admin SDK database --------------------------------------------------
function fakeDb(tree) {
  const parts = (p) => String(p).split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);
  const setAt = (p, v) => {
    const ks = parts(p); let o = tree;
    for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    if (v == null) { db.deletes++; delete o[ks.at(-1)]; } else o[ks.at(-1)] = clone(v);
  };
  const db = { tree, deletes: 0, writes: [] };
  db.ref = (p) => ({
    get: async () => { const v = clone(getAt(p)); return { val: () => (v === undefined ? null : v), exists: () => v != null }; },
    update: async (patch) => { db.writes.push(p); for (const k of Object.keys(patch)) setAt(`${p}/${k}`, patch[k]); },
    // compare-and-set, like the real one: run on the current value, commit only if nothing changed meanwhile
    transaction: async (fn) => {
      for (;;) {
        const cur = clone(getAt(p));
        await null;
        const next = fn(cur === undefined ? null : cur);
        if (next === undefined) return { committed: false, snapshot: { val: () => clone(getAt(p)) } };
        if (JSON.stringify(getAt(p)) !== JSON.stringify(cur)) continue;
        db.writes.push(p);
        setAt(p, next);
        return { committed: true, snapshot: { val: () => clone(getAt(p)) } };
      }
    },
  });
  return db;
}
{
  const id = 'sealtest01';
  const db = fakeDb({ shoveoff: { games: { [id]: doc({ sealed: { r1: { a: T0 + 10 } } }) }, index: {
    TESTA: { [id]: { with: 'TESTB', yourTurn: false, rnd: 1, open: 'sent', lastBy: 'me', updated: T0 + 10 } },
    TESTB: { [id]: { with: 'TESTA', yourTurn: true, rnd: 1, open: 'got', lastBy: 'them', updated: T0 + 10 } } } },
    shoveoffSealed: { [id]: { r1: { a: { aims: A1, at: T0 + 10, u: 'u1' } } } } });
  let clock = T0 + 100;
  const now = () => clock;
  let r = await F.revealRound(db, id, now);
  ok('server: one side sealed, nothing revealed, nothing written', !r.ok && r.why === 'waiting' && db.writes.length === 0);
  ok('server: the first sender\'s aims are nowhere in the public match or the rows', !JSON.stringify(db.tree.shoveoff).includes(A1));
  db.tree.shoveoffSealed[id].r1.b = { aims: B1, at: T0 + 200, u: 'u2' };
  db.tree.shoveoff.games[id].sealed.r1.b = T0 + 200;
  const rowsBefore = clone(db.tree.shoveoff.index);
  clock = T0 + 300;
  // Two triggers at once (the sealed entry and a poke): the round is revealed ONCE.
  const [r1, r2] = await Promise.all([F.revealRound(db, id, now), F.revealRound(db, id, now)]);
  const g = M.validateGame(db.tree.shoveoff.games[id]);
  ok('server: both sealed: revealed once, even with two triggers racing', [r1, r2].filter((x) => x.ok).length === 1 && g.log.length === 2 && g.resolved === 1 && g.round === 2, JSON.stringify([r1, r2]));
  ok('server: the log holds both, first sealed first, `updated` = server time', g.log[0].by === 'a' && g.log[0].aims === A1 && g.log[1].by === 'b' && g.log[1].aims === B1 && g.updated === T0 + 300);
  const ra = db.tree.shoveoff.index.TESTA[id], rb = db.tree.shoveoff.index.TESTB[id];
  ok('server: both rows say "your move" in round 2 (both), answered, pieces and mode', ra.yourTurn && rb.yourTurn && ra.both && rb.both && ra.rnd === 2 && ra.open === '' && rb.open === '' && ra.mine === 4 && ra.md && ra.md.look === 'car1' && rb.md.first === 'them');
  ok('server: lastBy = the second sender\'s write (theirs "me", the first sender\'s "them")', rb.lastBy === 'me' && ra.lastBy === 'them');
  const pa = decideShoveOff({ code: 'TESTA', id, before: rowsBefore.TESTA[id], after: ra });
  const pb = decideShoveOff({ code: 'TESTB', id, before: rowsBefore.TESTB[id], after: rb });
  ok('server: the push goes to the one who sent first (round 2, your move), never to the sender', pa && pa.kind === 'turn' && pb === null);
  const w0 = db.writes.length;
  r = await F.revealRound(db, id, now);
  ok('server: run again: round 2 is not sealed by anyone, nothing written', !r.ok && db.writes.length === w0);
  // resign with one side sealed: the sealed aims are never revealed
  const A2 = aimsOn(M.replayGame(g), 'a', (p) => [p.x > 0 ? -91 : 93, p.y > 0 ? -37 : 41]);
  db.tree.shoveoffSealed[id].r2 = { a: { aims: A2, at: T0 + 400, u: 'u1' } };
  db.tree.shoveoff.games[id].sealed.r2 = { a: T0 + 400 };
  db.tree.shoveoff.games[id].over = { winner: 'a', why: 'resign', at: T0 + 500 };
  db.tree.shoveoffSealed[id].r2.b = { aims: aimsOn(M.replayGame(g), 'b', soft), at: T0 + 600, u: 'u2' };   // a late seal after the resign
  r = await F.revealRound(db, id, now);
  ok('server: a resigned match with sealed aims is never revealed', !r.ok && r.why === 'over' && !JSON.stringify(db.tree.shoveoff).includes(A2));
  ok('server: nothing was ever deleted', db.deletes === 0);
  // an old match (no sv) is never touched by the server
  const db2 = fakeDb({ shoveoff: { games: { oldmatch01: { ...doc(), sv: undefined } } }, shoveoffSealed: { oldmatch01: { r1: { a: { aims: A1, at: 1 }, b: { aims: B1, at: 2 } } } } });
  delete db2.tree.shoveoff.games.oldmatch01.sv;
  r = await F.revealRound(db2, 'oldmatch01', now);
  ok('server: an old match (no sv) is left exactly as it is', !r.ok && r.why === 'not-sealed' && db2.writes.length === 0);
  ok('server: a bad id reads nothing', (await F.revealRound(db2, '../players', now)).why === 'bad-id');
}

// --- the triggers ---------------------------------------------------------------------------------
{
  const src = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
  ok('trigger: shoveOffSealed watches shoveoffSealed/<id>/<r>/<side> and reveals', /export const shoveOffSealed = onValueCreated\(\{ ref: '\/shoveoffSealed\/\{id\}\/\{r\}\/\{side\}'/.test(src) && /revealRound\(getDatabase\(\), event\.params\.id\)/.test(src));
  ok('trigger: shoveOffPoke watches shoveoff/games/<id>/poke', /export const shoveOffPoke = onValueWritten\(\{ ref: '\/shoveoff\/games\/\{id\}\/poke'/.test(src));
  const fsrc = readFileSync(new URL('../functions/shoveoff.js', import.meta.url), 'utf8');
  ok('server: reads only the one match and the one round (never a whole node)', !/ref\(['`](shoveoff|shoveoffSealed)['`]\)/.test(fsrc) && !/\.remove\(|\.set\(null/.test(fsrc));
}

console.log(`\nKnockout sealed rounds (server): ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
