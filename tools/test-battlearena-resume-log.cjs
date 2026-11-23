// tools/test-battlearena-resume-log.cjs (2026-11-23, Matt: "make sure you're tracking every detail of every game"): a match vs the
// computer is closed after a few turns and resumed; the private play log must still hold its seed, both teams and EVERY
// move, and replaying the log must end exactly as the match did. Localhost only, test1/DREG5, nothing synced.
//   PORT=8123 node server.mjs &   NODE_PATH=$(npm root -g) BASE=http://localhost:8123 node tools/test-battlearena-resume-log.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8123', ME = 'DREG5';
const path = require('path');
const ENGINE = 'file://' + path.join(__dirname, '..', 'battle-arena', 'js', 'engine.js');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u.href), (r) => r.abort());
  await ctx.addInitScript(({ me }) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('gamehub.devAllowSync.v1', '0');
    localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🧪', preferredColor: null, opponents: [], message: '', playerId: me, updatedAt: 1 }));
    const tips = {}; ['health','moves','yours','food','doSwap','charged','movesLeft','theirTurn','power','doExtra','doBerry','doBomb','extraMove','berries','boom','doEvolve','arena'].forEach((k) => tips[k] = 1);
    localStorage.setItem('gamehub.battlearena.v1', JSON.stringify({ diff: 'easy', tips2: tips, tips, nextFirst: 0 }));
  }, { me: ME });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => { await p.goto(BASE + '/battle-arena/'); await p.waitForFunction(() => window.__baTest, null, { timeout: 20000 }); await p.waitForTimeout(800); };
  const myTurns = async (n, finish) => {
    for (let guard = 0; guard < 4000; guard++) {
      const st = await p.evaluate(() => { const u = window.__baTest; const s = u && u.state; return s ? { turn: s.turn, winner: s.winner, busy: !!u.busy, turnNo: s.turnNo } : null; });
      if (!st || st.winner != null) return st;
      if (!finish && st.turnNo > n) return st;
      if (st.turn === 0 && !st.busy) {
        await p.evaluate(async () => { const u = window.__baTest; const E = await import('/battle-arena/js/engine.js'); const C = await import('/battle-arena/js/cpu.js');
          const mv = C.chooseMove(u.state, 'medium'); if (mv.type === 'swap') await u.trySwap(mv.a, mv.b); else { const r = u.step({ ...mv, side: 0 }); if (r.ok) await u.commit(r, true); } });
      }
      await p.waitForTimeout(60);
    }
  };
  await open();
  await p.evaluate(() => window.__baTest.startMatch(['thornpaw', 'driplet']));
  await p.waitForTimeout(1500);
  await myTurns(4, false);
  const before = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('gamehub.battlearena.save.v1')); return { hasBs: !!s.bs, seed: s.bs && s.bs.seed, mv: s.bj && s.bj.mv.length, n: s.state.moveNo }; });
  console.log('save before reload', JSON.stringify(before));
  await open();   // the save resumes
  const st = await myTurns(0, true);
  await p.waitForTimeout(2500);
  const x = await p.evaluate(() => { const q = JSON.parse(localStorage.getItem('gamehub.playlog.v1') || '[]'); const rows = (Array.isArray(q) ? q : Object.values(q.rows || q)).filter((e) => e && e.g === 'battlearena'); const e = rows[rows.length - 1]; if (!e) return null; const x = typeof e.x === 'string' ? JSON.parse(e.x) : e.x; return x; });
  if (!x) { console.log('FAIL no logged match', JSON.stringify(st), errs); await b.close(); process.exit(1); }
  const E = await import(ENGINE);
  let s = E.newMatch({ seed: x.seed, teams: [x.team, x.foe], first: x.first, rv: x.rv }); let ok = true;
  for (const [side, k, a, bb] of x.mv) { const r = E.apply(s, k === 's' ? { type: 'swap', a, b: bb, side } : k === 'e' ? { type: 'evolve', mon: a, side } : { type: 'pass', side }); if (!r.ok) { ok = false; break; } s = r.state; }
  let fails = 0; const pass = (c, m) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
  pass(before.hasBs && before.mv === before.n, 'the save carries the start and every move so far');
  pass(x.seed != null && x.team && x.foe, 'the logged match has its seed and both teams after a resume');
  pass(x.mv.length === x.n, `every move is logged (${x.mv.length} of ${x.n})`);
  pass(x.rz === 1 && !x.res, 'it says it was resumed once, and is complete');
  pass(ok && s.sides[0].hp === x.sides[0].hp && s.sides[1].hp === x.sides[1].hp && s.winner === x.win, 'the replay from the log ends exactly as the match did');
  pass(!errs.length, 'no page errors ' + JSON.stringify(errs.slice(0, 2)));
  process.exitCode = fails ? 1 : 0;
  await b.close();
})();
