// tools/test-word-ladder.mjs - Word Ladder's recorders and merge (js/game-stats.js recordWordLadder, recordWordLadderDaily,
// wlBest, wlSolved, wlBandOf). Pure node, a fake localStorage, a made-up player (never Matt's code or name).
// Run: node tools/test-word-ladder.mjs   (the levels and pars: node word-ladder/js/data-test.js)
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('ok    ' + name); } else { fail++; console.log('FAIL  ' + name); } };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k), clear: () => store.clear(), key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'zzzladder', playerId: 'ZZZL7' }));
const G = await import('../js/game-stats.js');
const E = await import('../word-ladder/js/engine.js');

const gm = () => (G.loadStats().games || {}).wordladder;
ok('released 2026-11-20: plays go to the real record', !G.isTestGame('wordladder'));

G.withMode(() => ({ mode: 'ladder', lang: 'en' }), 'easy', () => G.recordWordLadder(1, { moves: 5, par: 3, hints: 0, band: 'easy' }), { detail: () => ({ moves: 5, par: 3, hints: 0 }) });
let g = gm();
ok('first completion: one play and one win in its band', g.total.played === 1 && g.total.won === 1 && g.byDiff.easy.won === 1);
ok('entry: 2 stars at par + 2', g.wl.lv.L1.s === 2 && g.wl.lv.L1.m === 5 && g.wl.lv.L1.p === 3);
ok('mode noted', !!(g.byMode && g.byMode['lang=en|mode=ladder'] && g.byMode['lang=en|mode=ladder'].easy.won === 1));

G.withMode(() => ({ mode: 'ladder', lang: 'en' }), 'easy', () => G.recordWordLadder(1, { moves: 3, par: 3, hints: 0, band: 'easy' }), { detail: () => ({ moves: 3, par: 3, hints: 0 }) });
g = gm();
ok('a second completion only improves the entry, no second play', g.total.played === 1 && g.wl.lv.L1.s === 3 && g.wl.lv.L1.m === 3);
G.withMode(() => ({ mode: 'ladder', lang: 'en' }), 'easy', () => G.recordWordLadder(1, { moves: 9, par: 3, hints: 2, band: 'easy' }));
ok('a worse completion never lowers it (rule 2)', gm().wl.lv.L1.s === 3 && gm().wl.lv.L1.m === 3 && gm().wl.lv.L1.h === 0);

G.withMode(() => ({ mode: 'ladder', lang: 'es' }), 'medium', () => G.recordWordLadder(150, { moves: 4, par: 4, hints: 1, lang: 'es', band: 'medium' }));
ok('Spanish ladder in wl.es, its own numbers', gm().wl.es.L150.s === 2 && !gm().wl.lv.L150 && gm().byDiff.medium.won === 1);
ok('bad level number records nothing', G.withMode(() => ({ mode: 'ladder' }), 'easy', () => G.recordWordLadder(0, { moves: 1, par: 1 })) === null);

G.withMode(() => ({ mode: 'daily', lang: 'en' }), 'daily', () => G.recordWordLadderDaily('en-2026-11-13', { moves: 4, par: 4, hints: 0 }));
ok('daily: one play under byDiff.daily, entry keyed by language and day', gm().byDiff.daily.won === 1 && gm().wl.dl['en-2026-11-13'].s === 3);
ok('daily: a malformed key records nothing', G.withMode(() => ({ mode: 'daily' }), 'daily', () => G.recordWordLadderDaily('2026-11-13', { moves: 1, par: 1 })) === null);
ok('released: the stored REAL record holds the plays', Object.keys(((G.loadStoredStats().games || {}).wordladder || {}).wl.lv || {}).length > 0);

// wlBest keeps the better attempt whole
const b = G.wlBest({ s: 1, m: 4, h: 2, p: 3, t: 20 }, { s: 2, m: 9, h: 0, p: 3, t: 10 });
ok('wlBest: more stars wins whole (never 4 moves with 0 hints)', b.s === 2 && b.m === 9 && b.h === 0 && b.t === 10);
const c = G.wlBest({ s: 3, m: 4, h: 0, t: 5 }, { s: 3, m: 3, h: 0, t: 9 });
ok('wlBest: same stars, fewer moves wins; earliest time kept', c.m === 3 && c.t === 5);

// band and board count agree with the engine
ok('wlBandOf = engine bandOf at every boundary', [1, 100, 101, 250, 251, 400, 401, 500].every((n) => G.wlBandOf(n) === E.bandOf(n)));
ok('wlSolved counts both ladders, by band', G.wlSolved(gm()) === 2 && G.wlSolved(gm(), 'medium') === 1 && G.wlSolved(gm(), 'hard') === 0);
// stars rule identical in the engine and the recorder
let same = true;
// 20 cases (the rate gate allows 30 results a minute; this file records 27 in all)
for (let m = 4; m <= 8; m++) for (let h = 0; h < 4; h++) {
  G.withMode(() => ({ mode: 'ladder', lang: 'en' }), 'hard', () => G.recordWordLadder(300 + m * 4 + h, { moves: m, par: 5, hints: h, band: 'hard' }));
  if (gm().wl.lv['L' + (300 + m * 4 + h)].s !== E.starsFor(m, 5, h)) same = false;
}
ok('recorder stars = engine starsFor for every moves/hints', same);

// ---- THE REMAKE (2026-11-19): earned progress kept, tested against REAL history (rule 7) -------------------------------
// Results written by the OLD writer (js/game-stats.js at 5dd10bc, before the remake: every key `L<n>`), on levels that
// were then remade (English 251-500, Spanish 1-100 and 251-500) and on levels that were not, then read by the NEW code.
ok('WL_REMADE (game-stats) = REMADE (engine)', JSON.stringify(G.WL_REMADE) === JSON.stringify(E.REMADE));
ok('wlVersion = engine levelVersion everywhere', ['en', 'es'].every((l) => Array.from({ length: 500 }, (_, i) => i + 1).every((n) => G.wlVersion(l, n) === E.levelVersion(l, n))));
ok('wlKey / wlParseKey', G.wlKey(401, 1) === 'L401' && G.wlKey(401, 2) === 'L401v2' && G.wlKey(7) === 'L7'
  && JSON.stringify(G.wlParseKey('L401v2')) === '{"n":401,"v":2}' && JSON.stringify(G.wlParseKey('L12')) === '{"n":12,"v":1}' && G.wlParseKey('L0') === null && G.wlParseKey('x') === null);
{
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  let src = null;
  try { src = execFileSync('git', ['show', '5dd10bc:js/game-stats.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { src = null; }
  if (!src) ok('real history: the old writer (git 5dd10bc) could be read', false);
  else {
    // The old file's own imports point at today's shared modules (none of them is the writer under test).
    const jsDir = new URL('../js/', import.meta.url).href;
    src = src.replace(/from '\.\/([^']+)'/g, (_, f) => `from '${jsDir}${f}'`);
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-old-')), 'game-stats-5dd10bc.mjs');
    fs.writeFileSync(tmp, src);
    store.clear();
    localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'zzzladder', playerId: 'ZZZL7' }));
    const OLD = await import('file://' + tmp);
    const rec = (mod, n, o) => mod.withMode(() => ({ mode: 'ladder', lang: o.lang || 'en' }), o.band, () => mod.recordWordLadder(n, o));
    // Old solves: English Expert 401 (3 stars), 402 (1 star), Hard 300 (2 stars), Medium 120 (kept level); Spanish Easy 5
    // (remade), Medium 150 (kept), Expert 450 (remade); a daily.
    rec(OLD, 401, { moves: 5, par: 5, hints: 0, band: 'expert' });
    rec(OLD, 402, { moves: 9, par: 5, hints: 0, band: 'expert' });
    rec(OLD, 300, { moves: 6, par: 5, hints: 0, band: 'hard' });
    rec(OLD, 120, { moves: 4, par: 4, hints: 0, band: 'medium' });
    rec(OLD, 5, { moves: 3, par: 3, hints: 0, lang: 'es', band: 'easy' });
    rec(OLD, 150, { moves: 5, par: 4, hints: 0, lang: 'es', band: 'medium' });
    rec(OLD, 450, { moves: 6, par: 4, hints: 1, lang: 'es', band: 'expert' });
    OLD.withMode(() => ({ mode: 'daily', lang: 'en' }), 'daily', () => OLD.recordWordLadderDaily('en-2026-11-14', { moves: 4, par: 4, hints: 0 }));
    const oldG = JSON.parse(JSON.stringify(OLD.loadStats().games.wordladder));
    const oldSolved = OLD.wlSolved(oldG), oldStars = [...Object.values(oldG.wl.lv), ...Object.values(oldG.wl.es)].reduce((n, e) => n + e.s, 0);
    ok('real history: the old writer stored 7 levels, all as L<n>', oldSolved === 7 && Object.keys(oldG.wl.lv).concat(Object.keys(oldG.wl.es)).every((k) => /^L\d+$/.test(k)));

    // The NEW code over the same store: nothing moved, renamed, dropped, hidden, or recounted.
    const g1 = gm();
    ok('new code: every old entry stored exactly as written (rule 5)', JSON.stringify(g1.wl) === JSON.stringify(oldG.wl));
    ok('new code: the board count is unchanged (7)', G.wlSolved(g1) === oldSolved && G.wlSolved(g1, 'expert') === 3 && G.wlSolved(g1, 'hard') === 1 && G.wlSolved(g1, 'easy') === 1);
    const lv1 = G.wlLevels(g1);
    ok('new code: the stars are unchanged', [...lv1.values()].reduce((n, r) => n + r.e.s, 0) === oldStars);
    ok('new code: old solves of remade levels read as earlier puzzles, others as current',
      lv1.get('en:401').old.length === 1 && !lv1.get('en:401').cur && lv1.get('es:5').old.length === 1 && lv1.get('en:120').cur && !lv1.get('en:120').old.length);

    // Replaying a remade level: its new puzzle (version 2) is recorded under its own key; the old entry never changes.
    localStorage.removeItem('gamehub.rate.v1');
    const playedBefore = g1.total.played;
    rec(G, 402, { moves: 5, par: 6, hints: 0, band: 'expert', ver: 2 });   // 402's new puzzle at par: 3 stars
    let g2 = gm();
    ok('replay: the new puzzle is stored as L402v2, the old L402 untouched', g2.wl.lv.L402v2.s === 3 && JSON.stringify(g2.wl.lv.L402) === JSON.stringify(oldG.wl.lv.L402));
    ok('replay: level 402 still counts ONCE on the board (no double count)', G.wlSolved(g2) === 7 && G.wlSolved(g2, 'expert') === 3);
    ok('replay: level 402 counts its better result (3 stars, not 1 + 3)', G.wlLevels(g2).get('en:402').e.s === 3 && [...G.wlLevels(g2).values()].reduce((n, r) => n + r.e.s, 0) === oldStars + 2);
    ok('replay: a new puzzle is one new play', g2.total.played === playedBefore + 1);
    rec(G, 401, { moves: 9, par: 6, hints: 0, band: 'expert', ver: 2 });   // a WORSE result on the new 401: the old 3 stars stay
    g2 = gm();
    ok('replay: a worse new result never lowers what the level counts (3 stars kept)', G.wlLevels(g2).get('en:401').e.s === 3 && g2.wl.lv.L401.s === 3 && g2.wl.lv.L401v2.s === 1);
    rec(G, 403, { moves: 6, par: 6, hints: 0, band: 'expert', ver: 2 });   // never solved before: +1
    g2 = gm();
    ok('a remade level never solved before adds one', G.wlSolved(g2) === 8);
    ok('the daily is untouched', JSON.stringify(g2.wl.dl) === JSON.stringify(oldG.wl.dl));

    // Two phones: one with the OLD solves only, one with only new-puzzle solves of the same numbers. The person's merge
    // (players-agg) keeps every entry and counts each number once.
    const A = await import('../js/players-agg.js');
    const phoneA = { wl: JSON.parse(JSON.stringify(oldG.wl)), total: { played: 7, won: 7, lost: 0 }, byDiff: {} };
    const phoneB = { wl: { lv: { L401v2: { s: 2, m: 7, p: 6, h: 0, t: 5 }, L404v2: { s: 3, m: 5, p: 5, h: 0, t: 6 } } }, total: { played: 2, won: 2, lost: 0 }, byDiff: {} };
    const recOf = (dev, games, at) => ({ profile: { playerId: 'ZZZL7', name: 'zzzladder' }, stats: { games: { wordladder: games } }, updatedAt: at });
    const list = A.aggregatePlayers({ devA: recOf('devA', phoneA, 100), devB: recOf('devB', phoneB, 200) });
    const m = list.find((p) => p.playerId === 'ZZZL7');
    const mg = m && m.games.wordladder;
    ok('two phones: every entry of both kept in the merge', mg && mg.wl.lv.L401 && mg.wl.lv.L401v2 && mg.wl.lv.L404v2 && mg.wl.es.L5);
    ok('two phones: 401 counted once, 404 added (7 + 1)', mg && G.wlSolved(mg) === 8 && G.wlLevels(mg).get('en:401').e.s === 3);
  }
}

console.log(`Word Ladder tests: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
