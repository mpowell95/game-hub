// tools/lb2-review-shots.cjs - the outside-review screenshot set (session 3, 2026-11-02): every v2 screen plus My Stats,
// named by how you reach it (docs/LEADERBOARD-V2-REVIEWER-CONTEXT-2.md lists the taps). Same harness as tools/lb2-shots.cjs:
// REAL data, network fully blocked, nothing written anywhere.
// Needs backups/lb-z.json, lb-admin.json, lb-bee.json (git-ignored; get them with
// `GAMEHUB_READER=<key> node tools/read-lb-snapshot.mjs`) and `PORT=8177 node server.mjs` running.
// Viewer = *King of Games* (tests never use Matt's name or code). Writes nothing anywhere: every
// non-localhost request is aborted. Shots go to OUT (default review-shots/, git-ignored: real names).
//   node tools/lb2-shots.cjs          ONLY=en,es360,light to pick runs
const { chromium } = require('playwright');
const fs = require('fs');
const ROOT = process.env.ROOT || require('path').resolve(__dirname, '..');
const OUT = process.env.OUT || require('path').join(ROOT, 'docs', 'mockups', 'lb2-review', 'round5');
const PORT = process.env.PORT || '8177';
fs.mkdirSync(OUT, { recursive: true });
const admin = fs.readFileSync(ROOT + '/backups/lb-admin.json', 'utf8');
const bee = fs.readFileSync(ROOT + '/backups/lb-bee.json', 'utf8');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const LIGHT = new Set([1, 4, 11, 15, 17, 20, 24, 25, 28, 32, 33]);
const ES = new Set([1, 3, 8, 11, 17, 20, 25, 28, 31, 32]);
(async () => {
  const b = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const runs = [
    { theme: 'dark', lang: 'en', w: 402, h: 874, tag: 'en' },
    { theme: 'dark', lang: 'es', w: 360, h: 780, tag: 'es360' },
    { theme: 'light', lang: 'en', w: 402, h: 874, tag: 'light' },
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
    await p.evaluate(() => document.querySelectorAll('.gh-overlay, .ann-overlay, .hub-tour').forEach((e) => e.remove()));
    const who = await p.evaluate(async () => {
      const net = await import('/js/stats-net.js');
      const { isHiddenName } = await import('/js/hidden-players.js');
      const z = await (await fetch('/backups/lb-z.json')).json();
      const people = net.boardList(await net.unpackBoard(z)).list.filter((g) => !isHiddenName(g && g.name));
      const me = people.find((g) => /king of games/i.test(g.name || '')) || people[0];
      const lb = await import('/js/leaderboard-ui.js'); await lb.openLeaderboard({});
      await new Promise((r) => setTimeout(r, 800));
      const m = await import('/js/leaderboard2-ui.js'); m.__setPeopleForTest(people, me.key);
      window.__people = people; window.__meKey = me.key;
      return { n: people.length, me: me.name };
    });
    await p.waitForTimeout(800);
    const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${run.tag}-${name}.jpg`, type: 'jpeg', quality: 90 }); };
    const scrollEnd = async () => { await p.evaluate(() => { const s = document.querySelector('.lb2 [data-role="scroll"]'); if (s) s.scrollTop = s.scrollHeight; }); };
    const click = async (sel) => { await p.evaluate(() => document.querySelectorAll('.gh-overlay, .ann-overlay, .hub-tour').forEach((e) => e.remove())); const el = p.locator(sel).first(); if (await el.count()) await el.click(); else console.log('MISSING', sel); await p.waitForTimeout(350); };
    const board = async (g) => { await click('.lb2 [data-act="tab"][data-v="boards"]'); await click('.lb2 [data-act="chip"][data-v="all"]'); await click(`.lb2 [data-act="game"][data-game="${g}"]`); };
    const back = async () => click('.lb2 [data-act="back"]');
    const sel = async (role, v) => { await p.evaluate(([role, v]) => { const s = document.querySelector(`.lb2 [data-role="${role}"]`); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [role, v]); await p.waitForTimeout(300); };
    const person = async (i) => { await p.locator('.lb2 [data-act="person"]').nth(i).click(); await p.waitForTimeout(350); };
    const want = (n) => run.tag === 'en' || (run.tag === 'light' && LIGHT.has(n)) || (run.tag === 'es360' && ES.has(n));
    const S = async (n, name) => { if (want(n)) await shot(`${String(n).padStart(2, '0')}-${name}`); };
    await click('.lb2 [data-act="tab"][data-v="boards"]'); await click('.lb2 [data-act="chip"][data-v="all"]'); await S(1, 'games');
    await click('.lb2 [data-act="search"]'); await p.fill('.lb2 [data-role="q"]', 'co'); await S(2, 'games-search');
    await click('.lb2 [data-act="search"]');
    await board('darts'); await S(3, 'darts-all'); await back();
    await board('connect4'); await S(4, 'connect4-all');
    await scrollEnd(); await scrollEnd(); await S(5, 'connect4-all-bests');
    { const st = p.locator('.lb2 [data-act="stab"]'); if (await st.count() > 3) { await st.nth(3).click(); await p.waitForTimeout(300); } } await S(6, 'connect4-hard'); await back();
    await board('minesweeper'); await S(7, 'minesweeper-all'); await back();
    await board('sudoku'); await S(8, 'sudoku-all'); await back();
    await board('golf'); await S(9, 'golf'); await back();
    await board('tictactoe'); await S(10, 'tictactoe-all'); await back();
    await board('contexto'); await S(11, 'contexto-all');
    await click('.lb2 [data-act="stab"]'); await S(12, 'contexto-daily'); await back();
    await board('skeeball'); await S(13, 'skeeball'); await back();
    await board('spellingbee'); await S(14, 'spelling-bee'); await back();
    await board('wayout'); await S(15, 'arrowmaze-levels');
    await person(0); await S(16, 'arrowmaze-player-1st'); await back();
    await click('.lb2 [data-act="womode"][data-v="rush"]'); await S(17, 'arrowmaze-rush-thisweek');
    await click('.lb2 [data-act="woview"][data-v="won"]'); await S(18, 'arrowmaze-rush-weekswon');
    await click('.lb2 [data-act="woview"][data-v="past"]'); await S(19, 'arrowmaze-rush-pastweeks'); await back();
    await board('contexto'); await person(1); await S(20, 'contexto-player-2nd');
    await click('.lb2 [data-act="pall"]'); await S(21, 'player-all-games');
    await p.locator('.lb2 [data-act="pgame"]').first().click(); await p.waitForTimeout(350); await S(22, 'player-all-games-first-game');
    await back(); await back(); await back(); await back();
    await board('skeeball'); await person(0); await S(23, 'skeeball-player-1st'); await back(); await back();
    await click('.lb2 [data-act="tab"][data-v="hof"]'); await click('.lb2 [data-act="hofview"][data-v="medals"]'); await S(24, 'hof-medals');
    await click('.lb2 [data-act="hofview"][data-v="wins"]'); await S(25, 'hof-wins');
    await sel('hofcat', '3'); await S(26, 'hof-wins-hard');
    await sel('hofcat', 'NT'); await sel('hofsort', 'played'); await S(27, 'hof-wins-nodifficulty-played');
    await sel('hofcat', 'all'); await sel('hofsort', 'wins');
    await click('.lb2 [data-act="tab"][data-v="me"]'); await S(28, 'me');
    await p.evaluate(() => { const h = [...document.querySelectorAll('.lb2 .lb2-h2')][1]; const s = document.querySelector('.lb2 [data-role="scroll"]'); if (h && s) s.scrollTop = h.offsetTop - 8; }); await S(29, 'me-closest');
    await scrollEnd(); await S(30, 'me-not-played');
    await click('.lb2 [data-act="help"]'); await S(31, 'help'); await click('.lb2 .lb2-done');
    // My Stats (Profile > My Stats): this phone's own numbers. The test phone is given King of Games' numbers.
    await p.evaluate(async () => {
      const kog = window.__people.find((g) => g.key === window.__meKey);
      (await import('/js/leaderboard2-ui.js')).closeLeaderboard2();
      const gs0 = await import('/js/game-stats.js');
      const st = gs0.loadStoredStats(); st.games = JSON.parse(JSON.stringify(kog.games));
      localStorage.setItem('gamehub.stats', JSON.stringify(st));
      (await import('/js/game-stats-ui.js')).openStatsOverlay();
    });
    await p.waitForTimeout(600); await S(32, 'mystats');
    for (const [n, g] of [[33, 'contexto'], [34, 'skeeball'], [35, 'tictactoe']]) {
      await p.evaluate((g) => document.querySelector(`.gs-grow[data-game="${g}"]`).click(), g); await S(n, 'mystats-' + g);
      await p.evaluate(() => document.querySelector('[data-role="gs-up"]').click()); await p.waitForTimeout(200);
    }
    console.log(run.tag, who, 'errors', errs.slice(0, 3));
    await ctx.close();
  }
  await b.close();
})();
