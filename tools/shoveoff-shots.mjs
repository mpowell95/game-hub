// tools/shoveoff-shots.mjs - Shove Off screenshots (vs the computer, hub-mounted), for checking the looks.
//   node server.mjs   (another terminal)
//   node tools/shoveoff-shots.mjs [outDir]
// Test admin profile test1 / DREG5 (root CLAUDE.md: never Matt's code), no sync (`gamehub.devAllowSync.v1` = '0');
// the browser is automation, so every writer refuses anyway (js/automation.js).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BB_BASE || 'http://localhost:8123';
const OUT = process.argv[2] || '.visual-out/shoveoff';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function open(size, look) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript((lk) => {
    localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'test1', emoji: '\u{1F419}', playerId: 'DREG5' }));
    localStorage.setItem('gamehub.devAllowSync.v1', '0');
    localStorage.setItem('gamehub.lang.v1', 'en');
    localStorage.setItem('gamehub.shoveoff.v1', JSON.stringify({ look: lk, tab: 'cpu', diff: 'hard' }));
    localStorage.removeItem('gamehub.shoveoff.save.v1');
    const real = performance.now.bind(performance);
    window.__freeze = null;
    performance.now = () => (window.__freeze == null ? real() : window.__freeze);
  }, look);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__ghHub, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    const m = await import('/js/announce.js'); for (const a of (m.ANNOUNCEMENTS || [])) m.markSeen(a.id);
    document.querySelectorAll('.ann-overlay').forEach((n) => n.remove());
    const h = await import('/js/hub.js'); const hub = window.__ghHub;
    if (!hub.games.some((x) => x.id === 'shove-off')) hub.games = [...hub.games, h.GAMES.find((x) => x.id === 'shove-off')];
    await hub.launch('shove-off');
  });
  await page.waitForFunction(() => !!window.__soTest, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__soTest._newCpu());
  await page.waitForTimeout(400);
  return { ctx, page };
}
/** Arrows on the player's pieces: `kind` 'aim' (a mix), 'out' (everything hard outward), 'soft'. */
const setDraft = (page, kind) => page.evaluate((k) => {
  const so = window.__soTest, mp = so.mp;
  const E = mp.m;
  mp.draft.a = [];
  for (const p of E.pieces) {
    if (!p.alive || p.s !== 'a') continue;
    const d = Math.sqrt(p.x * p.x + p.y * p.y) || 1;
    let a;
    if (k === 'out') a = [Math.round(p.x / d * 395), Math.round(p.y / d * 395)];
    else if (k === 'soft') a = [Math.round(-p.x / d * 120), Math.round(-p.y / d * 120)];
    else { const q = E.pieces.filter((x) => x.alive && x.s === 'b').sort((u, v) => ((u.x - p.x) ** 2 + (u.y - p.y) ** 2) - ((v.x - p.x) ** 2 + (v.y - p.y) ** 2))[0]; const dx = q.x - p.x, dy = q.y - p.y, l = Math.sqrt(dx * dx + dy * dy); a = [Math.round(dx / l * 420), Math.round(dy / l * 420)]; }
    if (p.i === 3 && k === 'aim') a = null;
    mp.draft.a[p.i] = a;
  }
  so._renderFoot(); so._draw();
}, kind);
const tag = (s) => `${s.width}x${s.height}`;

for (const size of [{ width: 393, height: 852 }, { width: 360, height: 640 }]) {
  for (const look of ['sumo0', 'car1', 'puck0']) {
    const { ctx, page } = await open(size, look);
    await setDraft(page, 'aim');
    await page.screenshot({ path: `${OUT}/aim-${look}-${tag(size)}.png` });
    if (look === 'sumo0') {
      // mid-slide: a piece going over the edge (time frozen at its fall step)
      await setDraft(page, 'aim');
      await page.evaluate(() => { const mp = window.__soTest.mp; for (let i = 0; i < 4; i++) if (!mp.draft.a[i] && mp.m.pieces.some((p) => p.s === 'a' && p.i === i && p.alive)) mp.draft.a[i] = [200, 0]; });
      await page.evaluate(() => { window.__freeze = 1e6; window.__soTest._launchCpu(); });
      const info = await page.evaluate(() => { const a = window.__soTest.anim; return a ? { fallAt: a.rec.fallAt, n: a.frames.length } : null; });
      if (info && info.fallAt.length) {
        const st = Math.max(0, Math.min(...info.fallAt) - 4);
        await page.evaluate((s) => { window.__freeze = 1e6 + 1100 + (s / 2) * (1000 / 60) + 1; }, st);
        await page.waitForTimeout(120);
        await page.screenshot({ path: `${OUT}/slide-edge-${look}-${tag(size)}.png` });
      } else console.log('no fall in that round', JSON.stringify(info));
      await page.evaluate(() => { window.__freeze = null; });
      await page.waitForTimeout(4500);
      // later rounds: soft shoves back to the middle until the circle is small
      for (let r = 0; r < 5; r++) {
        const over = await page.evaluate(() => !!window.__soTest.mp.game.over);
        if (over) break;
        await setDraft(page, 'soft');
        await page.evaluate(() => { window.__freeze = 2e6 + Math.random(); window.__soTest._launchCpu(); window.__freeze = 9e6; });
        await page.waitForTimeout(250);
        await page.evaluate(() => { window.__freeze = null; });
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(300);
      const st = await page.evaluate(() => ({ round: window.__soTest.mp.game.round, H: window.__soTest.mp.m.H, over: window.__soTest.mp.game.over }));
      console.log('later round', JSON.stringify(st));
      await page.evaluate(() => { document.querySelectorAll('.so-root .gh-overlay, .so-over').forEach((o) => { o.style.display = 'none'; }); });
      await page.screenshot({ path: `${OUT}/later-round-${look}-${tag(size)}.png` });
      // a match built round by round with soft shoves on both sides (nobody falls): round 6's smaller circle
      await page.evaluate(async () => {
        const E = await import('/shove-off/js/engine.js');
        const CG = await import('/shove-off/js/cpu-game.js');
        const MP = await import('/shove-off/js/mp.js');
        const sv = CG.newSave('hard', 'sumo0', 5);
        for (let r = 0; r < 5; r++) {
          const m = MP.replayGame(sv);
          const soft = (s) => E.aimsToString(Array.from({ length: E.slotCount(m) }, (_, i) => {
            const p = m.pieces.find((q) => q.s === s && q.i === i && q.alive); if (!p) return null;
            const d = Math.sqrt(p.x * p.x + p.y * p.y) || 1; return [Math.round(-p.x / d * 110 + (s === 'a' ? 40 : -40)), Math.round(-p.y / d * 110)];
          }));
          sv.cpu = { r: m.round, aims: soft('b') };
          CG.playRound(sv, soft('a'));
        }
        CG.ensureCpuAims(sv); CG.writeSave(sv);
        window.__soTest._openCpu(sv);
      });
      await page.waitForTimeout(400);
      await setDraft(page, 'aim');
      const st2 = await page.evaluate(() => ({ round: window.__soTest.mp.game.round, H: window.__soTest.mp.m.H, left: window.__soTest.mp.game.left }));
      console.log('built round', JSON.stringify(st2));
      await page.screenshot({ path: `${OUT}/round6-${look}-${tag(size)}.png` });
    }
    await ctx.close();
  }
}

// close-ups: both sides of every look, at the play size (r 17 px) and big (r 60 px)
{
  const ctx = await browser.newContext({ viewport: { width: 520, height: 470 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/shove-off/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const A = await import('/shove-off/js/art.js');
    document.body.innerHTML = '';
    const c = document.createElement('canvas'); c.width = 520; c.height = 470; document.body.appendChild(c);
    document.body.style.margin = '0';
    const x = c.getContext('2d');
    const rows = [['sumo0', 'sumo1'], ['car0', 'car1'], ['puck0', 'puck1']];
    rows.forEach(([la, lb], i) => {
      const kind = A.kindOf(la), y0 = i * 156;
      x.save(); x.beginPath(); x.rect(0, y0, 520, 156); x.clip(); x.translate(0, y0);
      A.drawSurround(x, kind, 520, 156, 0);
      A.drawPlatform(x, kind, 260, 78 + 300, 380, 'circle');
      A.drawPiece(x, 70, 78, 60, la, 'a', 0.6);
      A.drawPiece(x, 200, 78, 60, lb, 'b', 2.4);
      A.drawPiece(x, 330, 60, 17, la, 'a', 0.6); A.drawPiece(x, 372, 60, 17, lb, 'b', 2.4);
      A.drawPiece(x, 330, 104, 17, lb, 'b', -1); A.drawPiece(x, 372, 104, 17, la, 'a', 3);
      const ic = document.createElement('canvas');
      for (const [k, lk, sd] of [[0, la, 'a'], [1, lb, 'b']]) { A.drawIcon(ic, lk, sd, 22, 1); x.drawImage(ic, 430 + k * 34, 67); }
      x.restore();
    });
  });
  await page.screenshot({ path: `${OUT}/closeup-sides.png` });
  await ctx.close();
}
await browser.close();
console.log('shots in', OUT);
