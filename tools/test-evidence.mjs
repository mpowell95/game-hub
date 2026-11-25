// tools/test-evidence.mjs - missing evidence is itself evidence, and a planted play cannot void an honest player
// (2026-11-25, Matt: "Fix all", after the red-team review). functions/evidence.js + functions/integrity.js writerTrusted.
// Node only, an in-memory database. Run: node tools/test-evidence.mjs
import { entryFacts, recordGrowth, noteLoggedPlay, noteTouchLog, noteSyncedGrowth, sweepEvidence, PENDING_MS } from '../functions/evidence.js';
import { writerTrusted, checkPlayInputLog, TRUST_AFTER_MS } from '../functions/integrity.js';

let fail = 0, pass = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + name); } };

function fakeDb(tree) {
  const parts = (p) => String(p).split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), tree);
  const setAt = (p, v) => {
    const ks = parts(p); let o = tree;
    for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v));
  };
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const ref = (p) => ({
    get: async () => ({ val: () => clone(getAt(p)) }),
    set: async (v) => setAt(p, v),
    update: async (patch) => { for (const [k, v] of Object.entries(patch)) setAt(`${p}/${k}`, v); },
    transaction: async (fn) => { const nv = fn(clone(getAt(p))); if (nv === undefined) return { committed: false }; setAt(p, nv); return { committed: true }; },
    orderByChild: (c) => ({ equalTo: (want) => ({ get: async () => {
      const all = getAt(p) || {}; const out = {};
      for (const [k, v] of Object.entries(all)) if (v && v[c] === want) out[k] = v;
      return { val: () => (Object.keys(out).length ? clone(out) : null) };
    } }) }),
  });
  return { tree, getAt, ref };
}

const NOW = Date.parse('2026-11-25T18:00:00Z');
const snakeEntry = (score, extra = {}) => ({ t: NOW - 1000, g: 'snake', f: 'recordSnake', a: JSON.stringify([score, 'hard', 'off']), u: 'u-me', x: '{"ticks":1}', ...extra });

// --- pure ------------------------------------------------------------------------------------------------------------
let f = entryFacts(snakeEntry(40));
ok('facts: a Snake result is a play, its best paths noted', f && f.g === 'snake' && f.fields.some((x) => x.path === 'sn.bestLen' && x.score === 40));
ok('facts: with its details, nothing missing; a touch log is due', !f.missing && f.needN);
f = entryFacts(snakeEntry(40, { x: undefined }));
ok('facts: a current build\'s Snake result with NO details = missing', f.missing);
f = entryFacts(snakeEntry(40, { x: undefined, u: undefined }));
ok('facts: an older build (no u) is never judged', !f.missing && !f.needN);
ok('facts: a hint is not a play', entryFacts({ g: 'wordweaver', f: 'recordWordWeaverHint', u: 'u' }) === null);
ok('facts: a queued replay carries no details by design', !entryFacts({ g: 'snake', f: 'recordSnake(queued)', a: '[0]', u: 'u' }).missing);
ok('facts: Spelling Bee (not a details game) is never "missing"', !entryFacts({ g: 'spellingbee', f: 'recordResult', a: '["spellingbee","daily",null]', u: 'u' }).missing);
const g1 = recordGrowth({ stats: { games: { snake: { total: { played: 3 }, sn: { bestLen: 20 } } } } }, { stats: { games: { snake: { total: { played: 5 }, sn: { bestLen: 62 } } } } });
ok('growth: plays and a higher best', g1.length === 1 && g1[0].dPlayed === 2 && g1[0].bests[0].path === 'sn.bestLen' && g1[0].bests[0].v === 62);
ok('growth: nothing grew, nothing noted', recordGrowth({ stats: { games: { snake: { total: { played: 5 } } } } }, { stats: { games: { snake: { total: { played: 5 } } } } }).length === 0);

// --- a play logged, its touches never arrive -------------------------------------------------------------------------
let db = fakeDb({ directory: { AAAAA: { name: 'Me' } } });
let w = await noteLoggedPlay(db, 'AAAAA', '1795000000000-1', snakeEntry(40), false, NOW);
ok('logged: tally counts it and its best', db.getAt('playTally/AAAAA/snake/lw') === 1 && db.getAt('playTally/AAAAA/snake/hi/sn~bestLen') === 40 && !w.length);
ok('logged: waiting for its touch log', db.getAt('playPending/AAAAA~1795000000000-1/open') === true);
w = await sweepEvidence(db, NOW + 60 * 1000);
ok('sweep: too soon, nothing alerted', !w.length && db.getAt('playPending/AAAAA~1795000000000-1/open') === true);
w = await sweepEvidence(db, NOW + PENDING_MS + 1);
ok('sweep: 15 minutes and no touch log = alert', w.length === 1 && w[0].rule === 'touch-log-missing' && db.getAt('playPending/AAAAA~1795000000000-1/open') === false);
ok('sweep: the alert is never a void', db.getAt('integrityAlerts/snake~AAAAA~1795000000000-1/touch-log-missing~x/proven') === false);
w = await sweepEvidence(db, NOW + 2 * PENDING_MS);
ok('sweep: alerted once', !w.length);

// --- the touch log arrives in time ------------------------------------------------------------------------------------
await noteLoggedPlay(db, 'AAAAA', '1795000000001-1', snakeEntry(30), false, NOW);
await noteTouchLog(db, 'AAAAA', '1795000000001-1');
w = await sweepEvidence(db, NOW + PENDING_MS + 1);
ok('touch log came: no alert', !w.some((a) => a.k === '1795000000001-1'));

// --- a result without its details ----------------------------------------------------------------------------------
w = await noteLoggedPlay(db, 'AAAAA', '1795000000002-1', snakeEntry(30, { x: undefined }), true, NOW);
ok('no details: alerted at once', w.length === 1 && w[0].rule === 'evidence-missing');

// --- a best synced with no play behind it --------------------------------------------------------------------------
db = fakeDb({ directory: { AAAAA: { name: 'Me' } }, playTally: { AAAAA: { snake: { lw: 4, hi: { 'sn~bestLen': 40 }, at: NOW } } } });
const old = { profile: { playerId: 'AAAAA' }, stats: { games: { snake: { total: { played: 4 }, sn: { bestLen: 40 } } } } };
const nu = { profile: { playerId: 'AAAAA' }, stats: { games: { snake: { total: { played: 5 }, sn: { bestLen: 99 } } } } };
await noteSyncedGrowth(db, old, nu, NOW);
ok('best: a synced 99 above the logged 40 is waiting', db.getAt('bestPending/AAAAA~snake~sn~bestLen/open') === true);
w = await sweepEvidence(db, NOW + PENDING_MS + 1);
ok('best: still no play reached it = alert', w.some((a) => a.rule === 'best-without-play'));
// the honest case: the play log arrives after the sync
db = fakeDb({ directory: { AAAAA: { name: 'Me' } }, playTally: { AAAAA: { snake: { lw: 4, hi: { 'sn~bestLen': 40 }, at: NOW } } } });
await noteSyncedGrowth(db, old, nu, NOW);
await noteLoggedPlay(db, 'AAAAA', '1795000000003-1', snakeEntry(99), true, NOW + 5000);
w = await sweepEvidence(db, NOW + PENDING_MS + 1);
ok('best: the play logged a little after the sync = no alert', !w.some((a) => a.rule === 'best-without-play') && db.getAt('bestPending/AAAAA~snake~sn~bestLen/open') === false);

// --- plays counted far ahead of plays logged ------------------------------------------------------------------------
db = fakeDb({ directory: { AAAAA: { name: 'Me' } }, playTally: { AAAAA: { tower: { lw: 2, sw: 3, at: NOW } } } });
w = await sweepEvidence(db, NOW + PENDING_MS + 1);
ok('gap: 1 play ahead is normal', !w.length);
db = fakeDb({ directory: { AAAAA: { name: 'Me' } }, playTally: { AAAAA: { tower: { lw: 2, sw: 12, at: NOW } } } });
w = await sweepEvidence(db, NOW + PENDING_MS + 1);
ok('gap: 10 plays with no play logged = alert, once', w.length === 1 && w[0].rule === 'plays-without-log' && db.getAt('playTally/AAAAA/tower/al') === 10);
w = await sweepEvidence(db, NOW + 2 * PENDING_MS);
ok('gap: not alerted again until it grows', !w.length);

// --- a planted "cheat" cannot void an honest player ------------------------------------------------------------------
db = fakeDb({ directory: { AAAAA: { name: 'Me' } }, codeKeys: { AAAAA: { h1: { uid: 'u-me', at: NOW - 30 * 864e5 }, h2: { uid: 'u-new', at: NOW - 3600e3 } } } });
const planted = { t: NOW, g: 'snake', f: 'recordSnake', a: '[50,"hard","off"]', i: '{"t":9,"p":9,"u":3}' };
ok('trust: no writer stamp = not trusted', !(await writerTrusted(db, 'AAAAA', planted)));
ok('trust: a stranger\'s sign-in = not trusted', !(await writerTrusted(db, 'AAAAA', { ...planted, u: 'u-stranger' })));
ok('trust: a key registered an hour ago = not yet', !(await writerTrusted(db, 'AAAAA', { ...planted, u: 'u-new' })));
ok('trust: the phone that has held its key a month = trusted', await writerTrusted(db, 'AAAAA', { ...planted, u: 'u-me' }));
let hits = await checkPlayInputLog(db, 'AAAAA', '1795000000009-1', planted, NOW);
ok('planted: alerted, NOT proven, marked unsure', hits.length && hits.every((h) => h.proven === false) && hits.some((h) => h.unsure === true));
hits = await checkPlayInputLog(db, 'AAAAA', '1795000000010-1', { ...planted, u: 'u-me' }, NOW);
ok('the owner\'s own phone: a proven hit stays proven', hits.some((h) => h.proven === true));
ok('TRUST_AFTER_MS is a day', TRUST_AFTER_MS === 864e5);

console.log(fail ? `\nEvidence tests: ${pass} passed, ${fail} FAILED` : `\nEvidence tests: ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
