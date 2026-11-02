// tools/stats-screens-shots.cjs - every game's NEW stats screen (2026-11-02, admin only until Matt releases it), as the
// leaderboard v2 person-in-a-game page shows it: *King of Games* on REAL data (backups/lb-z.json, read-only), EN dark
// 402 wide (the whole page, top card first), plus ES 360 of four busy games. A second set, `sample-*`, is the made-up
// fixture player (tools/stats-screens-fixture.mjs, written by the real recorders) so the breakdowns that real data
// does not have yet (modes and detail start 2026-11-02) can be seen. Network fully blocked; nothing written anywhere.
//   PORT=8177 node server.mjs   then   node tools/stats-screens-shots.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(ROOT, 'docs', 'mockups', 'stats-screens');
const PORT = process.env.PORT || '8177';
fs.mkdirSync(OUT, { recursive: true });
const admin = fs.readFileSync(ROOT + '/backups/lb-admin.json', 'utf8');
const bee = fs.readFileSync(ROOT + '/backups/lb-bee.json', 'utf8');
const ES_GAMES = ['darts', 'hoops4', 'holdem', 'cuppong'];
const SAMPLE = ['darts', 'flicksoccer', 'hoops4', 'tictactoe', 'holdem', 'cuppong', 'yahtzee', 'mancala', 'filler', 'dotsboxes', 'wayout', 'connect4', 'battleship', 'chinchon'];
(async () => {
  const { buildFixture } = await import(path.join(ROOT, 'tools', 'stats-screens-fixture.mjs'));
  const fx = await buildFixture();
  const b = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const runs = [{ lang: 'en', w: 402, h: 874, tag: 'en' }, { lang: 'es', w: 360, h: 780, tag: 'es360' }];
  for (const run of runs) {
    const ctx = await b.newContext({ viewport: { width: run.w, height: run.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); return u.hostname === 'localhost' ? r.continue() : r.abort(); });
    await ctx.addInitScript(([lang, admin, bee]) => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: '*King of Games*', emoji: '🤴', playerId: 'DREG5' }));
      localStorage.setItem('gamehub.devAllowSync.v1', '0');
      localStorage.setItem('gamehub.adminDevice.v1', '1');
      localStorage.setItem('gamehub.layout.v1', 'compact');
      localStorage.setItem('gamehub.theme.v1', 'dark');
      localStorage.setItem('gamehub.lang.v1', lang);
      localStorage.setItem('gamehub.adminConfig.v1', admin);
      localStorage.setItem('gamehub.beeBoard.v1', bee);
    }, [run.lang, admin, bee]);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://localhost:${PORT}/`);
    await p.waitForTimeout(2500);
    await p.evaluate(() => document.querySelectorAll('.gh-overlay, .ann-overlay, .hub-tour').forEach((e) => e.remove()));
    const info = await p.evaluate(async (fx) => {
      const net = await import('/js/stats-net.js');
      const { isHiddenName } = await import('/js/hidden-players.js');
      const z = await (await fetch('/backups/lb-z.json')).json();
      const people = net.boardList(await net.unpackBoard(z)).list.filter((g) => !isHiddenName(g && g.name));
      const me = people.find((g) => /king of games/i.test(g.name || ''));
      people.push({ key: 'sample-fixture', name: 'Sample', emoji: '🧪', playerId: '', games: fx.games });
      const lb = await import('/js/leaderboard-ui.js'); await lb.openLeaderboard({});
      await new Promise((r) => setTimeout(r, 800));
      const m = await import('/js/leaderboard2-ui.js'); m.__setPeopleForTest(people, me.key);
      window.__lb2 = m;
      const UI = await import('/js/game-stats-ui.js');
      const games = Object.keys(me.games).filter((id) => UI.isGameOnLauncher(id) || ['spellingbee'].includes(id))
        .filter((id) => ((me.games[id].total || {}).played | 0) > 0 || id === 'skeeball' || id === 'holdem');
      return { me: me.key, games };
    }, fx);
    const shoot = async (key, game, name) => {
      await p.evaluate(([k, g]) => window.__lb2.__openPersonGameForTest(k, g), [key, game]);
      await p.waitForTimeout(350);
      const h = await p.evaluate(() => { const s = document.querySelector('.lb2 [data-role="scroll"]'); const bar = s ? s.getBoundingClientRect().top : 0; return Math.ceil(bar + (s ? s.scrollHeight : 0)) + 70; });
      await p.setViewportSize({ width: run.w, height: Math.max(run.h, h) });
      await p.waitForTimeout(250);
      await p.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 90 });
      await p.setViewportSize({ width: run.w, height: run.h });
    };
    const list = run.tag === 'en' ? info.games : info.games.filter((g) => ES_GAMES.includes(g));
    for (const g of list) await shoot(info.me, g, `${run.tag}-kog-${g}`);
    const sample = run.tag === 'en' ? SAMPLE : ES_GAMES;
    for (const g of sample) await shoot('sample-fixture', g, `${run.tag}-sample-${g}`);
    // My Stats (admin device, `_s4`): the same screen under My Stats' own head card, from this phone's store (the fixture).
    if (run.tag === 'en') {
      await p.evaluate(async (fx) => {
        const m = await import('/js/leaderboard2-ui.js'); try { m.closeLeaderboard2 && m.closeLeaderboard2(); } catch { /* */ }
        document.querySelectorAll('.lb2, .lb-overlay').forEach((e) => e.remove());
        localStorage.setItem('gamehub.stats', JSON.stringify({ version: 1, games: fx.games }));
        const UI = await import('/js/game-stats-ui.js');
        UI.openStatsOverlay();
        await new Promise((r) => setTimeout(r, 400));
        document.querySelector('.gs-grow[data-game="darts"]').click();
      }, fx);
      await p.waitForTimeout(500);
      const h = await p.evaluate(() => document.querySelector('.gs-panel').scrollHeight + 70);
      await p.setViewportSize({ width: run.w, height: Math.max(run.h, h) });
      await p.waitForTimeout(250);
      await p.screenshot({ path: path.join(OUT, 'en-mystats-sample-darts.jpg'), type: 'jpeg', quality: 90 });
    }
    console.log(run.tag, 'KoG games', list.length, 'errors', errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await b.close();
})();
