// tools/test-ballrun-smooth.cjs - Ball Run draws a smooth run at 120 and 60 frames a second (2026-11-16, Matt: "it gets
// choppy the faster you move"). Drives the real game's frame() with a fake clock and records where the ball is DRAWN each
// frame: no frame may stand still, and the step must be even. Needs `node server.mjs` (port 8123). test1/DREG5, no sync.
//   node tools/test-ballrun-smooth.cjs
const { chromium } = require('playwright');
const BASE = process.env.BR_BASE || 'http://localhost:8123';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 402, height: 874 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🙂', preferredColor: null, opponents: [], playerId: 'DREG5', updatedAt: Date.now() }));
    localStorage.setItem('gamehub.devAllowSync.v1', '0'); localStorage.setItem('ballrun.seenHelp', '1');
  });
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  const r = await p.evaluate(async () => {
    const UI = await import('/ball-run/js/ui.js');
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.appendChild(host);
    UI.init(host);
    await new Promise((res) => setTimeout(res, 400));
    host.querySelector('[data-role="play"]').click();
    await new Promise((res) => setTimeout(res, 200));
    const ui = UI.__instance();
    cancelAnimationFrame(ui.rafId);
    const out = {};
    for (const hz of [120, 60]) {
      ui.sim.invincibleUntil = 1e12;
      const drawn = [], simZ = [];
      const real = ui.renderer.render.bind(ui.renderer);
      ui.renderer.render = (s, rm) => { drawn.push(s.z); real(s, rm); };
      let t = ui._lastTime = 1e6; ui._acc = 0;
      const realRaf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0;
      for (let i = 0; i < hz * 2; i++) { t += 1000 / hz; ui.running = true; ui.frame(t); simZ.push(ui.sim.z); if (ui.sim.isOver()) break; }
      window.requestAnimationFrame = realRaf; ui.renderer.render = real;
      const d = drawn.slice(10).map((z, i, a) => (i ? z - a[i - 1] : null)).slice(1);
      const zeros = d.filter((x) => x < 1e-6).length;
      const mean = d.reduce((x, y) => x + y, 0) / d.length; const sd = Math.sqrt(d.reduce((x, y) => x + (y - mean) ** 2, 0) / d.length);
      out[hz] = { frames: d.length, stillFrames: zeros, meanStep: +mean.toFixed(3), jitterSD: +sd.toFixed(4), simAtEndMatchesDrawnMax: simZ.at(-1) >= drawn.at(-1) };
    }
    return out;
  });
  console.log(JSON.stringify(r));
  let fail = errs.length ? 1 : 0; if (errs.length) console.log('FAIL page errors', errs);
  for (const hz of ['120', '60']) {
    const x = r[hz];
    const ok = x && x.stillFrames === 0 && x.jitterSD < 0.02;
    console.log((ok ? 'ok   ' : 'FAIL ') + hz + ' fps: ' + (x ? x.stillFrames + ' still frames, step spread ' + x.jitterSD : 'no data'));
    if (!ok) fail++;
  }
  await b.close();
  console.log(fail ? 'Ball Run smoothness: FAILED' : 'Ball Run smoothness: all passed');
  process.exit(fail ? 1 : 0);
})();
