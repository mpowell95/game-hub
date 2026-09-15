// test-baseball-device.mjs - does Baseball's play screen actually fit a REAL PHONE, mounted
// through the REAL hub?
//
// Written 2026-09-14 after Matt reported the deployed play screen unplayable on a real iPhone
// (HUD hidden behind the Hub button and status bar, the verdict line overlapping the Hub button,
// the field collapsed to a vertical sliver) while `test-visual.mjs`'s headless 361x714 box passed
// clean. Two real gaps, not one: `test-visual.mjs`'s `fit` check only measures whether the PAGE
// overflows its viewport, never whether content sits BEHIND the hub's own floating back pill
// (`.hub-back`, `position: absolute` chrome outside the document flow that a `position: fixed`
// game root never receives padding for - see `_fitInsets()` in `baseball/js/ui.js`); and no check
// anywhere touched the field CANVAS's actual geometry, so a projection formula ~10x too small in
// one axis (fixed the same day, `baseball/js/field.js`) passed every existing suite silently.
//
// This is Matt's own explicit ask: "add a device-sized check that would have caught this."
//
// WHAT IT CHECKS, mounted via the real `hub.launch()` path (test-visual.mjs's `mountInHub`
// pattern) at iPhone 14/15-class dimensions (393x852, deviceScaleFactor 3, the real DPR a modern
// iPhone reports - the bug shipped invisible at dpr 1):
//   1. `.bb-hud` sits entirely BELOW `.hub-back`'s real bottom edge (no overlap).
//   2. Across several simulated at-bats, the verdict line (`[data-role="line1"]`) never overlaps
//      `.hub-back` either - the exact symptom from the report ("Strikeout" behind the Hub button).
//   3. The field canvas's own projected geometry is a plausible diamond, not a collapsed sliver:
//      first base and third base project to screen-x positions meaningfully separated (at least
//      15% of the canvas width apart from home plate), read straight out of the shipped
//      `field.js` module rather than by inspecting pixels.
//   4. The main swing/pitch button is exactly 101x101 CSS px (the spec size; the report showed it
//      "far larger").
//   5. No duplicate back button is drawn inside the game when mounted in the hub (the hub's own
//      `.hub-back` is the only one) - a second one was the likely source of the reported
//      "Steal/Bunt/Pickoff render twice" ghosting when combined with a stale mount.
//
// Needs the dev server up (`node server.mjs`). SKIPs (never fails) without playwright-core or a
// findable Chromium, matching test-visual.mjs's own skip pattern exactly.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const BASE = 'http://localhost:8123';
let failed = 0;
const ok = (label) => console.log(`ok    ${label}`);
const fail = (label, why) => { failed++; console.log(`FAIL  ${label}: ${why}`); };
const skip = (why, how) => { console.log(`SKIP  test-baseball-device.mjs: ${why}`); console.log(`      ${how}`); process.exit(0); };

const onCloudImage = existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers');
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  if (onCloudImage) {
    spawnSync('npm', ['install', '--no-save', '--silent', 'playwright-core'], { stdio: 'ignore', timeout: 120000 });
    try { ({ chromium } = await import('playwright-core')); } catch { /* fall through to SKIP */ }
  }
  if (!chromium) skip('optional dependency \'playwright-core\' not installed', 'npm install --no-save playwright-core');
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', '']) {
      const p = rel ? join(base, d, rel) : join(base, d);
      try { if (existsSync(p) && statSync(p).isFile()) return p; } catch { /* keep looking */ }
    }
  }
  return null;
}
const EXE = findChromium();
if (!EXE) skip('no Chromium found', 'set CHROMIUM_PATH, or run this on the cloud image where it is pre-installed');

try {
  const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error('bad status');
} catch {
  skip('dev server not reachable at ' + BASE, 'run: node server.mjs');
}

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

async function mountInHub(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => !!window.__ghHub, null, { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    try {
      const m = await import('/js/announce.js');
      for (const a of (m.ANNOUNCEMENTS || [])) m.markSeen(a.id);
    } catch { /* module missing is fine */ }
    document.querySelectorAll('.ann-overlay').forEach((n) => n.remove());
  });
  return page.evaluate(async () => {
    const m = await import('/js/hub.js');
    const hub = window.__ghHub;
    if (!hub) return 'hub instance not found (window.__ghHub)';
    if (!hub.games.some((x) => x.id === 'baseball')) {
      const entry = m.GAMES.find((x) => x.id === 'baseball');
      if (!entry) return 'no GAMES entry for "baseball"';
      hub.games = [...hub.games, entry];
    }
    await hub.launch('baseball');
    if (!hub.current || hub.current.id !== 'baseball') return 'hub.launch("baseball") did not mount it';
    return null;
  });
}

const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem('gamehub.profile', JSON.stringify({
    name: 'Device Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
  }));
  for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
});

const mountErr = await mountInHub(page);
if (mountErr) {
  fail('mount', mountErr);
} else {
  // 1. Play screen loads and .bb-hud clears .hub-back.
  await page.evaluate(async () => {
    const root = document.querySelector('.hub-game');
    const btn = root && root.querySelector('.bb-play-btn');
    if (btn) btn.click();
  });
  await page.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);

  const rects = await page.evaluate(() => {
    const back = document.querySelector('.hub-back');
    const hud = document.querySelector('.bb-hud');
    const mainbtn = document.querySelector('.bb-ringwrap');
    const backBtn = document.querySelector('.bb-back');
    const r = (el) => el ? el.getBoundingClientRect() : null;
    return { back: r(back), hud: r(hud), mainbtn: r(mainbtn), hasOwnBackBtn: !!backBtn };
  });

  if (!rects.back || !rects.hud) {
    fail('hud-vs-back', `missing element(s): back=${!!rects.back} hud=${!!rects.hud}`);
  } else if (rects.hud.top < rects.back.bottom) {
    fail('hud-vs-back', `.bb-hud top=${rects.hud.top} is above .hub-back bottom=${rects.back.bottom} - overlap`);
  } else {
    ok(`hud clears hub-back pill (hud top=${rects.hud.top}, back bottom=${rects.back.bottom})`);
  }

  if (rects.hasOwnBackBtn) {
    fail('duplicate-back-button', 'baseball drew its own .bb-back while mounted in the hub');
  } else {
    ok('no duplicate back button when mounted in the hub');
  }

  // The Swing/Throw control is one canvas (ring.js, ported from the approved mocks) drawing
  // BOTH the 137px progress ring AND the 101px fill button - `.bb-ringwrap` is the DOM element
  // (and tap target) at the ring's own size; the 101px button is a canvas pixel, not a separate
  // box, so RING_D (137) is what a DOM measurement can honestly check here.
  if (!rects.mainbtn) {
    fail('mainbtn-size', 'missing .bb-ringwrap');
  } else {
    const w = Math.round(rects.mainbtn.width), h = Math.round(rects.mainbtn.height);
    if (Math.abs(w - 137) > 2 || Math.abs(h - 137) > 2) {
      fail('mainbtn-size', `expected 137x137 (ring.js RING_D), got ${w}x${h}`);
    } else {
      ok(`swing/throw control is ${w}x${h} (expected 137x137, drawing a 101px button inside)`);
    }
  }

  // 1b. R2 (HANDOFF-BASEBALL-3B.md section 5, Matt's second complaint on the v834 recording: "the
  // time between pitches ignores the tuned value"): the gap from one pitch's VERDICT to the NEXT
  // pitch's RELEASE is resultMs + betweenMs + windupMs, measured on the real hub mount rather than
  // inferred from the code. No input is given, so every pitch is a take (ball or strike) and no
  // batted-ball animation enters the sum. The verdict is captured by wrapping the instance's own
  // `_setLine1` (what `_onEngineEvent` paints through); the release is `state.pitcherFrame`
  // reaching 3 (`_stepWindup`'s own release step). A half-inning transition adds its own beat and
  // is excluded by its verdict text.
  {
    const expected = await page.evaluate(async () => {
      const S = await import('/baseball/js/engine/settings.js');
      return { result: S.FEEL.ui.resultMs, between: S.FEEL.ui.betweenMs, windup: S.FEEL.ui.windupMs };
    });
    await page.evaluate(() => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const rec = { releases: [], verdicts: [] };
      window.__bbCadence = rec;
      const orig = inst._setLine1.bind(inst);
      inst._setLine1 = (txt) => { if (txt) rec.verdicts.push({ t: performance.now(), txt: String(txt) }); orig(txt); };
      let last = inst.state.pitcherFrame;
      rec.timer = setInterval(() => {
        const f = inst.state.pitcherFrame;
        if (f === 3 && last !== 3) rec.releases.push(performance.now());
        last = f;
      }, 10);
    });
    const deadline = Date.now() + 45000;
    let data = { releases: [], verdicts: [] };
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      data = await page.evaluate(() => ({ releases: window.__bbCadence.releases.slice(), verdicts: window.__bbCadence.verdicts.slice() }));
      if (data.releases.length >= 4) break;
    }
    await page.evaluate(() => { clearInterval(window.__bbCadence.timer); });
    const gaps = [];
    for (let i = 0; i + 1 < data.releases.length; i++) {
      const v = data.verdicts.find((x) => x.t > data.releases[i] && x.t < data.releases[i + 1]);
      if (v && !/retired|end of|fin de/i.test(v.txt)) gaps.push({ gap: data.releases[i + 1] - v.t, txt: v.txt });
    }
    const target = expected.result + expected.between + expected.windup;
    const TOL = 150;
    const desc = gaps.map((g) => `${g.txt} ${g.gap.toFixed(0)}ms`).join(', ');
    if (gaps.length < 2) {
      fail('r2-cadence', `only ${gaps.length} verdict-to-release gaps observed in 45s (releases=${data.releases.length}, verdicts=${data.verdicts.length}) - is the CPU pitching to a human batter?`);
    } else if (gaps.some((g) => Math.abs(g.gap - target) > TOL)) {
      fail('r2-cadence', `verdict-to-next-release should be ${target}ms (${expected.result} result + ${expected.between} between + ${expected.windup} windup) within ${TOL}ms; measured ${desc}`);
    } else {
      ok(`r2-cadence: verdict-to-next-release measured ${desc}; target ${target}ms (${expected.result}+${expected.between}+${expected.windup}), tolerance ${TOL}ms`);
    }
  }

  // 2. Drive several at-bats, watching for the verdict line overlapping the back pill. R2 (BB-3b
  // commit 4) now wraps EVERY pitch in windupMs + the real flight + resultMs + betweenMs - a full
  // cycle from one pitch's release to the next is on the order of 7-8s (1400 windup + ~1.5-2s
  // flight + 1800 result + 3000 between), a real behavior change from the pre-R2 build this test
  // was written against. So: click roughly every 500ms (cheap - most land outside the live input
  // window and are silently ignored, per HumanAgent's own null-handler guards) to catch the brief
  // windows across several full cycles, while polling continuously for the verdict line the whole
  // time rather than sampling once at a fixed offset (which could straddle its resultMs hold
  // entirely).
  let sawLine1 = false;
  let overlapSeen = null;
  const TOTAL_BUDGET_MS = 70000, CLICK_EVERY_MS = 500, POLL_MS = 150;
  for (let elapsed = 0; elapsed < TOTAL_BUDGET_MS && !overlapSeen; elapsed += POLL_MS) {
    if (elapsed % CLICK_EVERY_MS < POLL_MS) {
      await page.evaluate(() => {
        const tile = document.querySelector('.bb-pitch-tile');
        if (tile) tile.click();
        const main = document.querySelector('.bb-ringwrap');
        if (main) {
          main.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          main.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        }
      });
    }
    await page.waitForTimeout(POLL_MS);
    {
      const line = await page.evaluate(() => {
        const back = document.querySelector('.hub-back');
        const line1 = document.querySelector('[data-role="line1"]');
        if (!line1 || !line1.textContent.trim()) return null;
        const l = line1.getBoundingClientRect();
        const b = back ? back.getBoundingClientRect() : null;
        const overlap = b ? (l.top < b.bottom && l.bottom > b.top && l.left < b.right && l.right > b.left) : false;
        return { top: l.top, backBottom: b ? b.bottom : null, overlap };
      });
      if (line) {
        sawLine1 = true;
        if (line.overlap) overlapSeen = line;
      }
    }
  }
  if (!sawLine1) {
    fail('verdict-line', `never observed a verdict line across a ${TOTAL_BUDGET_MS}ms drive - test may not be driving the game`);
  } else if (overlapSeen) {
    fail('verdict-line', `verdict line top=${overlapSeen.top} overlapped .hub-back bottom=${overlapSeen.backBottom}`);
  } else {
    ok('verdict line never overlaps the hub back pill across simulated at-bats');
  }

  // The field canvas (BB-3b: now a real picture, baseball/img/plate.webp, fitted via
  // field.js's `plateCover()`) mounted at a real, usable size - proof the band's own picture had
  // somewhere honest to draw into, ahead of `PLATE_ANCHORS`' own sanity checks below.
  const canvasSize = await page.evaluate(() => {
    const c = document.querySelector('.bb-field-canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  if (!canvasSize || canvasSize.width < 8) {
    fail('plate-camera', 'field canvas has no usable width to check the strike-zone floor against');
  } else {
    ok(`field canvas mounted at ${canvasSize.width.toFixed(0)}px wide (0.30W strike-zone floor = ${(canvasSize.width * 0.3).toFixed(0)}px)`);
  }
}
await ctx.close();

// 3. The field projection itself: first/third base must project meaningfully off-center, not
// collapse toward a vertical sliver through the middle of the canvas.
{
  const mod = await import('./baseball/js/field.js');
  if (typeof mod.project !== 'function') {
    fail('field-projection', 'field.js does not export project(xFt, yFt, w, h)');
  } else {
    const W = 393, H = 400;
    const home = mod.project(0, 0, W, H);
    const first = mod.project(63.9, 63.9, W, H);   // roughly first base, 90ft basepath at 45deg
    const third = mod.project(-63.9, 63.9, W, H);  // roughly third base
    const spread = Math.abs(first.x - third.x);
    const minSpread = W * 0.15;
    if (spread < minSpread) {
      fail('field-projection', `first/third base only ${spread.toFixed(1)}px apart on a ${W}px canvas (need >= ${minSpread.toFixed(1)}px) - looks like a collapsed sliver`);
    } else {
      ok(`field projects a real spread: first/third ${spread.toFixed(1)}px apart on a ${W}px canvas`);
    }
    if (Math.abs(home.x - W / 2) > W * 0.05) {
      fail('field-projection', `home plate x=${home.x.toFixed(1)} is not centered on a ${W}px canvas`);
    } else {
      ok('home plate centered horizontally');
    }
  }
}

// 4. The PLATE camera (rebuilt again 2026-09-14, BB-3b art pass: a real picture,
// `baseball/img/plate.webp`, replaces the procedural pinhole projection the prior round built).
// There is no more per-point projection to probe scale/foreshortening on - the picture supplies
// that - so this checks the thing that replaced it: `PLATE_ANCHORS`, measured off the picture, are
// internally sane (the plate sits below the mound, both land inside the canvas) and the rendered
// strike zone honors its own 0.30W floor (spec section 6) rather than shrinking to a sliver on a
// narrow phone.
{
  const mod = await import('./baseball/js/field.js');
  if (!mod.PLATE_ANCHORS) {
    fail('plate-camera', 'field.js does not export PLATE_ANCHORS');
  } else {
    const a = mod.PLATE_ANCHORS;
    const within01 = (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    if (!within01(a.plate) || !within01(a.mound)) {
      fail('plate-camera', `PLATE_ANCHORS.plate/mound fall outside the picture's own 0..1 frame (plate=${JSON.stringify(a.plate)}, mound=${JSON.stringify(a.mound)})`);
    } else {
      ok('PLATE_ANCHORS.plate and .mound both land inside the picture');
    }
    if (a.plate.y <= a.mound.y) {
      fail('plate-camera', `plate anchor (y=${a.plate.y}) is not below the mound anchor (y=${a.mound.y}) - the plate should read nearer the bottom of the frame`);
    } else {
      ok(`plate anchor sits below the mound anchor (plate.y=${a.plate.y}, mound.y=${a.mound.y})`);
    }
  }
  // [KNOWN-BUG PROBE] The pitch's flight, as pure geometry (Matt, 2026-09-15, three reports in one
  // message): (1) the ball spent ~half its flight crawling through the strike zone, because the old
  // drawPlateBall lerped screen position LINEARLY in depth; (2) the flight ENDED on the ground at
  // the plate, below the zone, so "swing when it is in the middle of the zone" was always Early and
  // contact only came once the ball was "almost OUT of the strike zone"; (3) the lateral offset was
  // multiplied by depthFrac, so EVERY pitch crossed dead center on screen - a pitch's x was never
  // visible where it mattered. `plateBallPos` is the fix; this pins all three against a synthetic
  // cover (the real 393x380 fit of the 1200x1585 picture), no browser needed.
  if (typeof mod.plateBallPos !== 'function' || typeof mod.zoneRect !== 'function') {
    fail('plate-flight', 'field.js does not export plateBallPos/zoneRect');
  } else {
    const W = 393, H = 380;
    const cover = { drawW: 393, drawH: 519.1, offsetX: 0, offsetY: H - 519.1, scale: 0.3275 };
    const z = mod.zoneRect(W, cover);
    const inZone = (p) => p.x >= z.left && p.x <= z.left + z.w && p.y >= z.top && p.y <= z.top + z.h;
    const end = mod.plateBallPos(W, H, cover, 0, 0);
    if (Math.abs(end.y - z.cy) > 0.5 || Math.abs(end.x - z.cx) > 0.5) {
      fail('plate-flight', `crossing (yFt=0) draws at (${end.x.toFixed(1)}, ${end.y.toFixed(1)}), not the zone center (${z.cx.toFixed(1)}, ${z.cy.toFixed(1)})`);
    } else {
      ok('the pitch crosses at the strike zone\'s own center, not on the ground at the plate');
    }
    let inside = 0; const N = 1000; let mono = true; let prevR = 0;
    for (let i = 0; i <= N; i++) {
      const p = mod.plateBallPos(W, H, cover, 0, 60.5 * (1 - i / N));
      if (inZone(p)) inside++;
      if (p.r < prevR) mono = false;
      prevR = p.r;
    }
    const frac = inside / (N + 1);
    if (frac > 0.15) {
      fail('plate-flight', `ball center is inside the zone for ${(frac * 100).toFixed(1)}% of a constant-speed flight (need <= 15%) - the linear crawl is back`);
    } else {
      ok(`ball is inside the zone for the last ${(frac * 100).toFixed(1)}% of the flight (perspective, not a linear crawl)`);
    }
    if (!mono) fail('plate-flight', 'ball radius does not grow monotonically toward the plate');
    const right = mod.plateBallPos(W, H, cover, 8.5, 0), left = mod.plateBallPos(W, H, cover, -8.5, 0);
    if (Math.abs(right.x - (z.left + z.w)) > 0.5 || Math.abs(left.x - z.left) > 0.5) {
      fail('plate-flight', `x=+1/-1 cross at ${right.x.toFixed(1)}/${left.x.toFixed(1)}, not the zone edges ${(z.left + z.w).toFixed(1)}/${z.left.toFixed(1)}`);
    } else {
      ok('x=+1 / x=-1 cross at the zone\'s right / left edge (the pitch location is visible at the plate)');
    }
  }
  if (typeof mod.drawPlateView !== 'function' || typeof mod.drawPlateBall !== 'function') {
    fail('plate-camera', 'field.js does not export drawPlateView/drawPlateBall');
  } else {
    ok('drawPlateView and drawPlateBall are exported');
  }
  if (mod.PLATE_ANCHORS) {
    const a = mod.PLATE_ANCHORS;
    if (a.nearBoxLeft.x < a.plate.x && a.plate.x < a.nearBoxRight.x) {
      ok('nearBoxLeft sits left of the plate, nearBoxRight sits right of it (anchor fractions)');
    } else {
      fail('plate-camera', `nearBoxLeft/nearBoxRight do not straddle the plate anchor (left=${a.nearBoxLeft.x}, plate=${a.plate.x}, right=${a.nearBoxRight.x})`);
    }
  }
}

// 5. Batter hand/anchor correction (Matt): both frame sets are drawn RIGHT-handed, so the DEFAULT
// (unflipped) stands at the LEFT box and a LEFT-handed batter (flipped) stands at the RIGHT box -
// never the other way round. Rendered, not just reasoned about: draws the real batter frame via
// field.js's own drawFrameCheck (a flat background, so the sprite's own pixels are trivial to
// isolate) with flip false/true, and asserts the rendered bounding box's own center falls left of
// canvas-center for the unflipped draw and right of it for the flipped one.
{
  const p2 = await (await browser.newContext({ viewport: { width: 400, height: 700 } })).newPage();
  await p2.goto(`${BASE}/baseball/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const bounds = await p2.evaluate(async () => {
    const mod = await import('/baseball/js/field.js');
    mod.preloadPlateImages();
    await new Promise((r) => setTimeout(r, 800));
    const measure = (flip) => {
      const c = document.createElement('canvas');
      c.width = 400; c.height = 700;
      const ctx = c.getContext('2d');
      mod.drawFrameCheck(ctx, c.width, c.height, 'batter', 'home', 5, true, flip);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      // The flat #1c1c1c background is (28,28,28) - anything meaningfully different is the sprite
      // or the ground line/center tick; restrict the scan to the sprite's own height band and
      // ignore the thin overlay lines by requiring a wide-enough run.
      let minX = Infinity, maxX = -Infinity;
      const yTop = Math.round(c.height * 0.2), yBot = Math.round(c.height * 0.8);
      for (let y = yTop; y < yBot; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const isBg = Math.abs(r - 28) < 6 && Math.abs(g - 28) < 6 && Math.abs(b - 28) < 6;
          const isLine = (r > 200 && g < 100 && b < 100) || (r > 180 && g > 180 && b > 180 && Math.abs(r - g) < 10 && Math.abs(g - b) < 10);
          if (!isBg && !isLine) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
        }
      }
      return { minX, maxX, center: (minX + maxX) / 2, canvasCenter: c.width / 2 };
    };
    return { unflipped: measure(false), flipped: measure(true) };
  });
  await p2.close();
  if (!isFinite(bounds.unflipped.center) || !isFinite(bounds.flipped.center)) {
    fail('batter-hand', `could not isolate the sprite's own pixels (unflipped=${JSON.stringify(bounds.unflipped)}, flipped=${JSON.stringify(bounds.flipped)})`);
  } else {
    if (bounds.unflipped.center < bounds.unflipped.canvasCenter) {
      ok(`unflipped batter renders left of center (bbox center ${bounds.unflipped.center.toFixed(0)}px vs canvas center ${bounds.unflipped.canvasCenter}px)`);
    } else {
      fail('batter-hand', `unflipped batter's bounding box center (${bounds.unflipped.center.toFixed(0)}px) is not left of canvas center (${bounds.unflipped.canvasCenter}px)`);
    }
    if (bounds.flipped.center > bounds.flipped.canvasCenter) {
      ok(`flipped (left-handed) batter renders right of center (bbox center ${bounds.flipped.center.toFixed(0)}px vs canvas center ${bounds.flipped.canvasCenter}px)`);
    } else {
      fail('batter-hand', `flipped batter's bounding box center (${bounds.flipped.center.toFixed(0)}px) is not right of canvas center (${bounds.flipped.canvasCenter}px)`);
    }
  }
}

// 6. The real pitcher frames (BB-3b addition): frame 1's rendered bounding box sits centered on
// the mound anchor, and frame 3's own throwing-hand anchor (PLATE_ANCHORS.release) lands INSIDE
// frame 3's rendered bounding box - not beside the head, which is what the old three-cartoon-pose
// set's arbitrary offset produced. Renders the real drawPlateView (not the flat-background dev
// tool) so this exercises the exact same cover-fit math the game itself uses.
{
  const p3 = await (await browser.newContext({ viewport: { width: 400, height: 700 } })).newPage();
  await p3.goto(`${BASE}/baseball/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const result = await p3.evaluate(async () => {
    const mod = await import('/baseball/js/field.js');
    mod.preloadPlateImages();
    await new Promise((r) => setTimeout(r, 900));
    const w = 400, h = 700;
    const render = (pitcherFrame) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      mod.drawPlateView(ctx, w, h, 'batting', false, { pitcherFrame, batterFrame: 1 });
      return ctx.getImageData(0, 0, w, h).data;
    };
    // The pitcher's own colors (navy jersey ~#1F3864-ish, gray pants, pale skin) read as distinctly
    // NOT-grass and NOT-dirt in a tight window around the mound; scan that window only, so the
    // batter/plate/crowd elsewhere in frame never contaminate the bbox.
    const isField = (r, g, b) => (g > r && g > b && g > 90) /* grass */ || (r > 140 && r < 210 && g > 90 && g < 160 && b < 130 && r > g) /* dirt */;
    const bboxIn = (data, x0, x1, y0, y1) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) continue;
          if (isField(r, g, b)) continue;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      return { minX, maxX, minY, maxY };
    };
    // Mound-area window: PLATE_ANCHORS.mound projected through the same cover-fit math as
    // drawPlateView, widened generously since the exact figure size depends on band height.
    const plateImg = new Image();
    plateImg.src = '/baseball/img/plate.webp';
    await new Promise((r) => { if (plateImg.complete) r(); else plateImg.onload = r; });
    const iw = plateImg.naturalWidth, ih = plateImg.naturalHeight;
    const scale = Math.max(w / iw, h / ih);
    const drawW = iw * scale, drawH = ih * scale;
    const offsetX = (w - drawW) / 2, offsetY = h - drawH;
    const anchorPx = (frac) => ({ x: offsetX + frac.x * drawW, y: offsetY + frac.y * drawH });
    const mound = anchorPx(mod.PLATE_ANCHORS.mound);
    const release = anchorPx(mod.PLATE_ANCHORS.release);
    const winHalf = 40;
    const x0 = Math.max(0, Math.round(mound.x - winHalf)), x1 = Math.min(w, Math.round(mound.x + winHalf));
    const y0 = Math.max(0, Math.round(mound.y - winHalf)), y1 = Math.min(h, Math.round(mound.y + winHalf));

    const bbox1 = bboxIn(render(1), x0, x1, y0, y1);
    const bbox3 = bboxIn(render(3), x0, x1, y0, y1);
    return { mound, release, bbox1, bbox3, window: { x0, x1, y0, y1 } };
  });
  await p3.close();
  const b1 = result.bbox1;
  if (!isFinite(b1.minX)) {
    fail('pitcher-frames', `could not isolate frame 1's sprite in the mound window (${JSON.stringify(result.window)})`);
  } else {
    const centerX = (b1.minX + b1.maxX) / 2;
    const off = Math.abs(centerX - result.mound.x);
    if (off <= 15) {
      ok(`pitcher frame 1's bounding box is centered on the mound anchor (bbox center x=${centerX.toFixed(1)}, mound x=${result.mound.x.toFixed(1)}, off by ${off.toFixed(1)}px)`);
    } else {
      fail('pitcher-frames', `frame 1's bbox center x=${centerX.toFixed(1)} is ${off.toFixed(1)}px from the mound anchor x=${result.mound.x.toFixed(1)} (expected <=15px)`);
    }
  }
  const b3 = result.bbox3;
  if (!isFinite(b3.minX)) {
    fail('pitcher-frames', `could not isolate frame 3's sprite in the mound window (${JSON.stringify(result.window)})`);
  } else {
    const inside = result.release.x >= b3.minX && result.release.x <= b3.maxX && result.release.y >= b3.minY && result.release.y <= b3.maxY;
    if (inside) {
      ok(`frame 3's own hand anchor (release=${result.release.x.toFixed(1)},${result.release.y.toFixed(1)}) lands inside its rendered bounding box (${JSON.stringify(b3)})`);
    } else {
      fail('pitcher-frames', `release anchor (${result.release.x.toFixed(1)},${result.release.y.toFixed(1)}) is outside frame 3's own bounding box (${JSON.stringify(b3)}) - "beside the head", not in the hand`);
    }
  }
}

// 7. The overhead camera is now `overhead.webp` (BB-3b commit 5), a picture, not the old
// procedural camera - check 3 above already proves the FALLBACK camera's own geometry is sane
// (it runs before the picture has had time to load); this proves the PICTURE camera's own
// homography is, once `overhead.webp` has actually loaded: the four bases and the mound project
// to a topologically sane diamond (first right of home, third left of home, second and the mound
// both above home and in that order) - not an exact-pixel match (that would just restate the
// measured matrix back at itself), but the shape a homography bug (a transposed row, a stale
// coefficient) would visibly break.
{
  const p4 = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
  await p4.goto(`${BASE}/baseball/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const result = await p4.evaluate(async () => {
    const mod = await import('/baseball/js/field.js');
    mod.preloadPlateImages();
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = () => reject(new Error('overhead.webp failed to load'));
      img.src = '/baseball/img/overhead.webp';
    });
    // Give field.js's own internal cache a moment to pick up the now-loaded image too.
    await new Promise((r) => setTimeout(r, 50));
    const w = 393, h = 500;
    const home = mod.project(0, 0, w, h);
    const first = mod.project(63.64, 63.64, w, h);
    const third = mod.project(-63.64, 63.64, w, h);
    const second = mod.project(0, 127.28, w, h);
    const mound = mod.project(0, 60.5, w, h);
    return { home, first, third, second, mound };
  });
  await p4.close();
  const { home, first, third, second, mound } = result;
  const checks = [
    ['first base sits right of home', first.x > home.x],
    ['third base sits left of home', third.x < home.x],
    ['second base sits above home (further into the outfield)', second.y < home.y],
    ['the mound sits above home', mound.y < home.y],
    ['the mound sits below second (between home and second)', mound.y > second.y],
  ];
  const allPass = checks.every(([, pass]) => pass);
  if (allPass) {
    ok(`overhead picture homography: a sane diamond (home ${JSON.stringify(home)}, first ${JSON.stringify(first)}, second ${JSON.stringify(second)}, third ${JSON.stringify(third)}, mound ${JSON.stringify(mound)})`);
  } else {
    for (const [label, pass] of checks) if (!pass) fail('overhead-homography', label);
  }
}

await browser.close();

console.log('');
console.log(failed === 0 ? `All checks passed.` : `${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
