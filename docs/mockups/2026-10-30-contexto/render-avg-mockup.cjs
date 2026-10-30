// MOCKUP ONLY: average guesses (guesses + hints per win, the tie-break) between the small medals and the gold.
const { chromium } = require('playwright'); const fs = require('fs');
const D = '/tmp/claude-0/-home-user-game-hub/6fc55cb0-5580-5ac5-b4f6-1b70696e14d9/scratchpad/mock/';
// Real records 2026-10-30: (guesses + hints) / wins
const AVG = { '*King of Games*': (392 + 35) / 11, 'Ele': (281 + 2) / 6, 'Natalia': (277 + 15) / 10, 'Anita Bonita': (112 + 1) / 3, 'MattyIce': (99 + 2) / 3 };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1 });
  await p.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'zzztest', emoji: '🐝', opponents: [], playerId: 'ZZZQ9', updatedAt: new Date().toISOString() }));
    localStorage.setItem('gamehub.devAllowSync.v1', '0'); localStorage.setItem('gamehub.theme.v1', 'dark');
    localStorage.setItem('gamehub.announce.v1', JSON.stringify({ seen: ['bug-report-2026-08-11','golf-2026-09-09','compact-layout-2026-10-17','compact-tour-2026-10-17'] }));
  });
  await p.goto('http://localhost:8123/'); await p.waitForTimeout(4000);
  await p.evaluate(async () => { const m = await import('/js/leaderboard-ui.js'); m.openLeaderboard({ game: 'contexto' }); });
  await p.waitForTimeout(6000);
  await p.evaluate((AVG) => {
    for (const c of document.querySelectorAll('.lb-pcard')) {
      const n = c.querySelector('.lb-pname').textContent.trim();
      if (AVG[n] == null) continue;
      const sub = c.querySelector('.lb-psubline');
      sub.style.display = 'flex'; sub.style.alignItems = 'center'; sub.style.width = '100%';
      sub.insertAdjacentHTML('beforeend', `<span style="margin-left:auto;padding-left:6px;display:flex;flex-direction:column;align-items:center;line-height:1.05"><b style="font-size:16px;font-weight:800">${AVG[n].toFixed(1)}</b><span style="font-size:9px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--lb-muted);white-space:nowrap">avg guesses</span></span>`);
      c.querySelector('.lb-pid').style.flex = '1 1 0'; c.querySelector('.lb-pid').style.minWidth = '0'; c.querySelector('.lb-pid').style.overflow = 'hidden';
    }
  }, AVG);
  await p.waitForTimeout(300);
  await p.screenshot({ path: D + 'contexto-avg.png' });
  const css = await p.evaluate(() => { let c = ''; for (const sh of document.styleSheets) { try { for (const r of sh.cssRules) c += r.cssText + '\n'; } catch (e) {} } return c; });
  const body = await p.evaluate(() => { let top = document.querySelector('.lb-board-head'); while (top.parentElement && top.parentElement !== document.body) top = top.parentElement; return [document.documentElement.className, document.body.className, top.outerHTML]; });
  fs.writeFileSync(D + 'contexto-avg.html', `<!doctype html><html class="${body[0]}" lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Contexto average guesses</title><style>${css}</style></head><body class="${body[1]}">${body[2]}</body></html>`);
  await b.close();
})();
