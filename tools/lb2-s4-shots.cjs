// tools/lb2-s4-shots.cjs - Leaderboard v2 session 4 mockup shots (2026-11-02): the screens the review's items 1-10
// touch, BEFORE (run from a main worktree) and AFTER (this branch). Same harness as tools/lb2-review-shots.cjs: REAL
// data, network fully blocked, nothing written anywhere. Viewer = *King of Games* (never Matt's name or code).
// Needs backups/lb-z.json, lb-admin.json, lb-bee.json in ROOT (git-ignored) and `PORT=<port> node server.mjs` there.
//   ROOT=<main worktree> PORT=8178 PREFIX=b node tools/lb2-s4-shots.cjs     (before)
//   PORT=8177 PREFIX=a node tools/lb2-s4-shots.cjs                          (after)
// Shots: docs/mockups/lb2-session4/<PREFIX>-<run>-<name>.jpg (deviceScaleFactor 1, JPEG q90). ONLY=en,es360,light.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT || path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(path.resolve(__dirname, '..'), 'docs', 'mockups', 'lb2-session4');
const PORT = process.env.PORT || '8177';
const PREFIX = process.env.PREFIX || 'a';
fs.mkdirSync(OUT, { recursive: true });
const admin = fs.readFileSync(ROOT + '/backups/lb-admin.json', 'utf8');
const bee = fs.readFileSync(ROOT + '/backups/lb-bee.json', 'utf8');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
// Which screens each run takes (names below).
const WANT = {
  en: null, // every screen
  light: new Set(['c4-all', 'arrow-levels', 'contexto-all', 'mystats']),
  es360: new Set(['mystats', 'rush-week', 'me', 'player-all', 'c4-all']),
};
(async () => {
  const b = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const runs = [
    { theme: 'dark', lang: 'en', w: 402, h: 874, tag: 'en' },
    { theme: 'light', lang: 'en', w: 402, h: 874, tag: 'light' },
    { theme: 'dark', lang: 'es', w: 360, h: 780, tag: 'es360' },
  ].filter((r) => !ONLY || ONLY.includes(r.tag));
  for (const run of runs) {
    const ctx = await b.newContext({ viewport: { width: run.w, height: run.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); return u.hostname === 'localhost' ? r.continue() : r.abort(); });
    await ctx.addInitScript(([theme, lang, admin, bee]) => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: '*King of Games*', emoji: '🤴', playerId: 'DREG5' }));
      localStorage.setItem('gamehub.devAllowSync.v1', '0');
      localStorage.setItem('gamehub.adminDevice.v1', '1');
      localStorage.setItem('gamehub.layout.v1', 'compact');
      localStorage.setItem('gamehub.theme.v1', theme);
      localStorage.setItem('gamehub.lang.v1', lang);
      localStorage.setItem('gamehub.adminConfig.v1', admin);
      localStorage.setItem('gamehub.beeBoard.v1', bee);
    }, [run.theme, run.lang, admin, bee]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://localhost:${PORT}/`);
    await p.waitForTimeout(2500);
    const strip = () => p.evaluate(() => document.querySelectorAll('.gh-overlay, .ann-overlay, .hub-tour').forEach((e) => e.remove()));
    await strip();
    const open = async () => {
      await p.evaluate(async () => {
        const net = await import('/js/stats-net.js');
        const { isHiddenName } = await import('/js/hidden-players.js');
        const z = await (await fetch('/backups/lb-z.json')).json();
        const people = net.boardList(await net.unpackBoard(z)).list.filter((g) => !isHiddenName(g && g.name));
        const me = people.find((g) => /king of games/i.test(g.name || '')) || people[0];
        try { (await import('/js/game-stats-ui.js')).closeStats(); } catch { /* */ }
        const lb = await import('/js/leaderboard-ui.js'); await lb.openLeaderboard({});
        await new Promise((r) => setTimeout(r, 800));
        const m = await import('/js/leaderboard2-ui.js'); m.__setPeopleForTest(people, me.key);
        window.__people = people; window.__meKey = me.key; window.__z = z;
      });
      await p.waitForTimeout(600);
    };
    await open();
    const want = (n) => !WANT[run.tag] || WANT[run.tag].has(n);
    const shot = async (name) => { if (!want(name)) return; await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${PREFIX}-${run.tag}-${name}.jpg`, type: 'jpeg', quality: 90 }); };
    const scrollEnd = async () => { await p.evaluate(() => { const s = document.querySelector('.lb2 [data-role="scroll"]'); if (s) s.scrollTop = s.scrollHeight; }); await p.waitForTimeout(200); };
    const scrollTo = async (sel, off = 8) => { await p.evaluate(([sel, off]) => { const el = document.querySelector(sel); const s = document.querySelector('.lb2 [data-role="scroll"]'); if (el && s) s.scrollTop = el.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - off; }, [sel, off]); await p.waitForTimeout(200); };
    const click = async (sel) => { await strip(); const el = p.locator(sel).first(); if (await el.count()) await el.click(); else console.log('MISSING', sel); await p.waitForTimeout(350); };
    const board = async (g) => { await click('.lb2 [data-act="tab"][data-v="boards"]'); await click('.lb2 [data-act="chip"][data-v="all"]'); await click(`.lb2 [data-act="game"][data-game="${g}"]`); };
    const back = async () => click('.lb2 [data-act="back"]');
    const sel = async (role, v) => { await p.evaluate(([role, v]) => { const s = document.querySelector(`.lb2 [data-role="${role}"]`); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [role, v]); await p.waitForTimeout(300); };
    const person = async (i) => { await p.locator('.lb2 [data-act="person"]').nth(i).click(); await p.waitForTimeout(350); };
    // A tab by its words (both builds: the order of Contexto's tabs differs).
    const tabText = async (txt) => { const ok = await p.evaluate((txt) => { const b = [...document.querySelectorAll('.lb2 [data-act="stab"]')].find((x) => x.textContent.trim() === txt); if (b) b.click(); return !!b; }, txt); if (!ok) console.log('MISSING tab', txt); await p.waitForTimeout(350); };
    const rushView = async (v) => {
      const hasSel = await p.locator('.lb2 select[data-role="woview"]').count();
      if (hasSel) await sel('woview', v); else await click(`.lb2 [data-act="woview"][data-v="${v}"]`);
    };
    const isEs = run.lang === 'es';

    // Boards
    await board('connect4'); await shot('c4-all');
    await scrollEnd(); await scrollEnd(); await shot('c4-all-end');
    await tabText(isEs ? 'Difícil' : 'Hard'); await shot('c4-hard'); await back();
    await board('tictactoe'); await scrollEnd(); await shot('ttt-all-end'); await back();
    await board('sudoku'); await shot('sudoku-all'); await back();
    await board('murdoku'); await shot('murdoku-all'); await back();
    await board('contexto'); await tabText(isEs ? 'Todos' : 'All'); await shot('contexto-all');
    await tabText(isEs ? 'Diaria' : 'Daily'); await shot('contexto-daily'); await back();
    await board('skeeball'); await shot('skeeball'); await back();
    await board('wayout'); await shot('arrow-levels');
    await click('.lb2 [data-act="womode"][data-v="rush"]'); await shot('rush-week');
    await rushView('won'); await shot('rush-won');
    await rushView('past'); await shot('rush-past'); await back();
    await board('contexto'); await tabText(isEs ? 'Todos' : 'All'); await person(1); await shot('contexto-player');
    await click('.lb2 [data-act="pall"]'); await shot('player-all');
    await back(); await back(); await back();
    await board('skeeball'); await person(0); await shot('skeeball-player');
    await p.evaluate(() => { const s = document.querySelector('.lb2 [data-role="scroll"]'); if (s) s.scrollTop = 700; }); await shot('skeeball-player-machines');
    await back(); await back();
    // Hall of Fame
    await click('.lb2 [data-act="tab"][data-v="hof"]'); await click('.lb2 [data-act="hofview"][data-v="wins"]');
    await sel('hofcat', '3'); await shot('hof-wins-hard');
    await sel('hofcat', 'NT'); await sel('hofsort', 'played'); await shot('hof-wins-played');
    await sel('hofcat', 'all'); await sel('hofsort', 'wins');
    // Me
    await click('.lb2 [data-act="tab"][data-v="me"]'); await shot('me');
    const closeTop = async () => p.evaluate(() => { const h = [...document.querySelectorAll('.lb2 .lb2-h2')][1]; const s = document.querySelector('.lb2 [data-role="scroll"]'); if (h && s) s.scrollTop = h.offsetTop - 8; });
    await closeTop(); await p.waitForTimeout(200); await shot('me-closest');
    // The rows the review named: Hill Climb (a harder record) and Sudoku (the no-hint rule).
    await scrollTo('.lb2 .lb2-close[data-game="hillclimb"]', 200); await shot('me-closest-hill');
    await scrollTo('.lb2 .lb2-close[data-game="sudoku"]', 200); await shot('me-closest-sudoku');
    const hasB = await p.evaluate(async () => { const m = await import('/js/leaderboard2-ui.js'); if (!m.__setClosestForTest) return false; m.__setClosestForTest('b'); return true; });
    if (hasB) {
      await p.waitForTimeout(300); await closeTop(); await p.waitForTimeout(200); await shot('me-closest-b');
      await p.evaluate(() => { const s = document.querySelector('.lb2 [data-role="scroll"]'); if (s) s.scrollTop += 600; }); await shot('me-closest-b2');
      await p.evaluate(async () => (await import('/js/leaderboard2-ui.js')).__setClosestForTest('a'));
    }
    // My Stats (Profile > My Stats): this phone is given King of Games' numbers, and (this branch) the board.
    const mystats = async () => {
      await p.evaluate(async () => {
        const kog = window.__people.find((g) => g.key === window.__meKey);
        (await import('/js/leaderboard2-ui.js')).closeLeaderboard2();
        const gs0 = await import('/js/game-stats.js');
        const st = gs0.loadStoredStats(); st.games = JSON.parse(JSON.stringify(kog.games));
        localStorage.setItem('gamehub.stats', JSON.stringify(st));
        const ui = await import('/js/game-stats-ui.js');
        ui.openStatsOverlay();
        if (ui.__setBoardForTest) await ui.__setBoardForTest(window.__people, window.__meKey);
      });
      await p.waitForTimeout(700);
    };
    await mystats(); await shot('mystats');
    for (const g of ['connect4', 'contexto', 'skeeball']) {
      await p.evaluate((g) => document.querySelector(`.gs-grow[data-game="${g}"]`).click(), g); await p.waitForTimeout(300); await shot('mystats-' + g);
      if (g === 'skeeball') { await p.evaluate(() => { const s = document.querySelector('.gs-body'); if (s) s.scrollTop = 900; }); await shot('mystats-skeeball-machines'); }
      await p.evaluate(() => document.querySelector('[data-role="gs-up"]').click()); await p.waitForTimeout(200);
    }
    console.log(run.tag, 'errors', errs.slice(0, 3));
    await ctx.close();
  }
  await b.close();
})();
