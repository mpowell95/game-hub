// tools/lb2-shots.cjs - screenshots of Leaderboard v2 with REAL data and the network fully blocked (dev only).
// Needs backups/lb-z.json, lb-admin.json, lb-bee.json (git-ignored; get them with
// `GAMEHUB_READER=<key> node tools/read-lb-snapshot.mjs`) and `PORT=8177 node server.mjs` running.
// Viewer = *King of Games* (tests never use Matt's name or code). Writes nothing anywhere: every
// non-localhost request is aborted. Shots go to OUT (default review-shots/, git-ignored: real names).
//   node tools/lb2-shots.cjs          ONLY=en,es360,light to pick runs
const { chromium } = require('playwright');
const fs = require('fs');
const ROOT = process.env.ROOT || require('path').resolve(__dirname, '..');
const OUT = process.env.OUT || require('path').join(ROOT, 'review-shots', 'latest');
const PORT = process.env.PORT || '8177';
fs.mkdirSync(OUT, { recursive: true });
const admin = fs.readFileSync(ROOT + '/backups/lb-admin.json', 'utf8');
// The node's value is a JSON STRING (functions/bee.js stores it encoded), so the file holds it quoted; the phone's cache
// (js/bee-board.js) keeps the inner string. Storing the file text as-is hid the real Spelling Bee board (fixed 2026-11-03).
const beeRaw = fs.readFileSync(ROOT + '/backups/lb-bee.json', 'utf8');
const bee = (() => { try { const v = JSON.parse(beeRaw); return typeof v === 'string' ? v : beeRaw; } catch { return beeRaw; } })();
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
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
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🧪', playerId: 'DREG5' }));
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
    await p.evaluate(() => document.querySelectorAll('.gh-overlay, .ann-overlay').forEach((e) => e.remove()));
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
    const click = async (sel) => { await p.evaluate(() => document.querySelectorAll('.gh-overlay, .ann-overlay').forEach((e) => e.remove())); const el = p.locator(sel).first(); if (await el.count()) await el.click(); else console.log('MISSING', sel); await p.waitForTimeout(350); };
    const board = async (g) => { await click('.lb2 [data-act="tab"][data-v="boards"]'); await click('.lb2 [data-act="chip"][data-v="all"]'); await click(`.lb2 [data-act="game"][data-game="${g}"]`); };
    const back = async () => click('.lb2 [data-act="back"]');
    if (run.tag === 'es360') {
      await board('darts'); await shot('01-darts-all'); await back();
      await board('sudoku'); await shot('02-sudoku-all'); await back();
      await board('golf'); await shot('03-golf'); await back();
      await board('skeeball'); await shot('04-skeeball'); await back();
      await click('.lb2 [data-act="tab"][data-v="me"]'); await shot('05-me'); await p.evaluate(() => { const s = document.querySelector('.lb2 [data-role="scroll"]'); s.scrollTop = 1100; }); await shot('06-me-closest');
      await click('.lb2 [data-act="tab"][data-v="boards"]'); await shot('07-games');
      await click('.lb2 [data-act="help"]'); await shot('08-help'); await click('.lb2 .lb2-done');
    } else {
      await click('.lb2 [data-act="chip"][data-v="all"]'); await shot('01-games');
      await board('darts'); await shot('02-darts-all'); await back();
      await board('connect4'); await shot('03-connect4-all'); await scrollEnd(); await shot('04-connect4-bests');
      const stabs = p.locator('.lb2 [data-act="stab"]'); if (await stabs.count() > 3) { await stabs.nth(3).click(); await p.waitForTimeout(300); await scrollEnd(); await shot('05-connect4-hard-no-bests'); }
      await back();
      await board('minesweeper'); await shot('06-minesweeper-all'); await back();
      await board('sudoku'); await shot('07-sudoku-all'); await back();
      await board('golf'); await shot('08-golf'); await back();
      await board('contexto'); await shot('09-contexto'); await back();
      await board('skeeball'); await shot('10-skeeball'); await scrollEnd(); await shot('11-skeeball-bests'); await back();
      await board('spellingbee'); await shot('12-spelling-bee'); await back();
      await click('.lb2 [data-act="tab"][data-v="hof"]'); await shot('13-hall-of-fame');
      await p.locator('.lb2 [data-act="person"]').nth(1).click(); await p.waitForTimeout(300); await shot('14-player-page'); await back();
      await click('.lb2 [data-act="tab"][data-v="me"]'); await shot('15-me');
      await p.evaluate(() => { const h = [...document.querySelectorAll('.lb2 .lb2-h2')][1]; const s = document.querySelector('.lb2 [data-role="scroll"]'); if (h && s) s.scrollTop = h.offsetTop - 8; }); await shot('16-me-closest');
      await scrollEnd(); await shot('17-me-not-played');
      await click('.lb2 [data-act="help"]'); await shot('18-help'); await click('.lb2 .lb2-done');
    }
    console.log(run.tag, who, 'errors', errs.slice(0, 3));
    await ctx.close();
  }
  await b.close();
})();
