// Lost records screenshots (2026-11-02): harness copied from tools/lb2-review-shots.cjs. REAL board data, network blocked,
// viewer = *King of Games*. The held-set cache is seeded with games he does not hold, so the app's own diff files the losses.
//   PORT=8177 node server.mjs   then   node docs/mockups/lb2-lost/lost-shots.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = __dirname;
const PORT = process.env.PORT || '8177';
const admin = fs.readFileSync(ROOT + '/backups/lb-admin.json', 'utf8');
const bee = fs.readFileSync(ROOT + '/backups/lb-bee.json', 'utf8');
(async () => {
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
    p.on('pageerror', (e) => console.log('PAGEERR', e.message));
    await p.goto(`http://localhost:${PORT}/`);
    await p.waitForTimeout(2500);
    await p.evaluate(() => document.querySelectorAll('.gh-overlay, .ann-overlay, .hub-tour').forEach((e) => e.remove()));
    const info = await p.evaluate(async () => {
      const net = await import('/js/stats-net.js');
      const { isHiddenName } = await import('/js/hidden-players.js');
      const z = await (await fetch('/backups/lb-z.json')).json();
      const people = net.boardList(await net.unpackBoard(z)).list.filter((g) => !isHiddenName(g && g.name));
      const me = people.find((g) => /king of games/i.test(g.name || '')) || people[0];
      const held = {}; for (const id of ['darts', 'connect4', 'sudoku', 'golf', 'tictactoe', 'uno']) held[id] = Date.now() - 864e5 * 3;
      localStorage.setItem('gamehub.lb2.held.v1', JSON.stringify({ v: 1, byKey: { [me.key]: { held, lost: [] } } }));
      const lb = await import('/js/leaderboard-ui.js'); await lb.openLeaderboard({});
      await new Promise((r) => setTimeout(r, 800));
      const m = await import('/js/leaderboard2-ui.js'); m.__setPeopleForTest(people, me.key);
      const st = JSON.parse(localStorage.getItem('gamehub.lb2.held.v1')).byKey[me.key];
      return { lost: st.lost.map((x) => x.game), held: Object.keys(st.held).length };
    });
    console.log(run.tag, JSON.stringify(info));
    await p.waitForTimeout(600);
    await p.locator('.lb2 [data-act="tab"][data-v="me"]').first().click();
    await p.waitForTimeout(500);
    await p.evaluate(() => { const h = [...document.querySelectorAll('.lb2 .lb2-h2')].find((x) => /Lost|perdidos/.test(x.textContent)); const s = document.querySelector('.lb2 [data-role="scroll"]'); if (h && s) s.scrollTop += h.getBoundingClientRect().top - s.getBoundingClientRect().top - 12; });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${run.tag}-me-lost.jpg`, type: 'jpeg', quality: 90 });
    await ctx.close();
  }
  await b.close();
})();
