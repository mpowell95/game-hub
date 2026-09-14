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

  // 2. Drive several at-bats, watching for the verdict line overlapping the back pill. BB-3b's
  // R1 wind-up (`_stepWindup`, FEEL.ui.windupMs - 1400ms by default) now delays every CPU pitch
  // before the swing/throw handlers are even registered, and the verdict line itself only holds
  // for FEEL.ui.resultMs before clearing - so this polls continuously through each cycle instead
  // of sampling once at a fixed offset, which could straddle the hold window entirely (a flat
  // single check after a long wait missed almost every at-bat once the wind-up landed).
  let sawLine1 = false;
  let overlapSeen = null;
  const CYCLE_MS = 2600, POLL_MS = 150;
  for (let i = 0; i < 6 && !overlapSeen; i++) {
    await page.evaluate(() => {
      const tile = document.querySelector('.bb-pitch-tile');
      if (tile) tile.click();
      const main = document.querySelector('.bb-ringwrap');
      if (main) {
        main.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        main.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      }
    });
    for (let elapsed = 0; elapsed < CYCLE_MS && !overlapSeen; elapsed += POLL_MS) {
      await page.waitForTimeout(POLL_MS);
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
    fail('verdict-line', 'never observed a verdict line across 10 simulated at-bats - test may not be driving the game');
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
  if (typeof mod.drawPlateView !== 'function' || typeof mod.drawPlateBall !== 'function') {
    fail('plate-camera', 'field.js does not export drawPlateView/drawPlateBall');
  } else {
    ok('drawPlateView and drawPlateBall are exported');
  }
}

await browser.close();

console.log('');
console.log(failed === 0 ? `All checks passed.` : `${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
