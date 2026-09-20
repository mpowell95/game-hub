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
//   3. R1 (docs/BASEBALL-3D-BUILD.md section 9): the world-space probes that replaced the painted
//      cameras' own - `zone-world` (the pitch crosses inside the projected strike-zone box, and the
//      engine's x = +1/-1 land on its edges), `ball-grows` (a constant-speed flight's projected
//      ball radius rises monotonically), `fence-shape` (the shipped fence ribbon passes through
//      every league's five named distances within 1 ft).
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
  // `_setLine1` (what `_onEngineEvent` paints through).
  //
  // STAGE 5 (docs/BASEBALL-3D-BUILD.md section 3.10): the release signal changed. It used to be
  // `state.pitcherFrame` reaching 3 (`_stepWindup`'s own sprite-frame step), which is deleted along
  // with the rest of the sprite path this stage. The replacement wraps the instance's own
  // `actors.play` and records `performance.now() + markAtMs` for every `('pitcher', 'Pitch', ...)`
  // call - the same instant the OLD signal watched for (`_stepWindup` calls
  // `actors.play('pitcher', 'Pitch', { markAtMs: WINDUP_MS })` at the moment frame 1 used to be set,
  // so `call time + WINDUP_MS` is where frame 3 used to land; the human's own release calls it with
  // `markAtMs: 0`, seeking straight to the mark, so `call time + 0` is the release instant itself).
  // Proven equivalent BEFORE the sprite code was deleted: this block ran with BOTH signals
  // instrumented in the same pass (state.pitcherFrame still existed then) and the two gap sets
  // matched to within 1ms - baseball/CLAUDE.md has the numbers. A half-inning transition adds its
  // own beat and is excluded by its verdict text.
  {
    const expected = await page.evaluate(async () => {
      const S = await import('/baseball/js/engine/settings.js');
      return { result: S.FEEL.ui.resultMs, between: S.FEEL.ui.betweenMs, windup: S.FEEL.ui.windupMs };
    });
    await page.evaluate(() => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const rec = { releases: [], verdicts: [] };
      window.__bbCadence = rec;
      // R2 (docs/BASEBALL-3D-BUILD.md section 9): a batting turn does NOT start by itself any more
      // - the player taps READY and then the wind-up runs (docs/BASEBALL-REFERENCE-B9.md, batting
      // steps 1 and 2). So this probe supplies that tap, and supplies it with no latency of its
      // own: it intercepts the assignment of `_onMainDown` and fires it in the same tick it
      // becomes available, ONLY while the button is reading READY (never while it reads SWING, or
      // every pitch would also be swung at and a ball in play would add its own cutaway to the
      // gap being measured). Polling for the label instead would add its own interval to every
      // measurement, which is exactly the quantity under test.
      // Seeded with whatever is ALREADY waiting: the first batting turn reaches its READY await
      // before this instrumentation is installed, and a bare defineProperty would DISCARD that
      // handler (a data property replaced by an accessor), stranding the game on a tap nothing
      // could ever deliver.
      let handler = inst._onMainDown || null;
      const fire = (fn) => { if (fn && inst.state && inst.state.actionLabel === 'act_ready') setTimeout(() => { if (handler === fn) fn(); }, 0); };
      Object.defineProperty(inst, '_onMainDown', {
        configurable: true,
        get() { return handler; },
        set(fn) { handler = fn; fire(fn); },
      });
      fire(handler);
      const orig = inst._setLine1.bind(inst);
      inst._setLine1 = (txt) => { if (txt) rec.verdicts.push({ t: performance.now(), txt: String(txt) }); orig(txt); };
      const origPlay = inst.actors.play.bind(inst.actors);
      inst.actors.play = (role, name, opts) => {
        if (role === 'pitcher' && name === 'Pitch') {
          const markAtMs = (opts && opts.markAtMs != null) ? opts.markAtMs : 0;
          rec.releases.push(performance.now() + markAtMs);
        }
        return origPlay(role, name, opts);
      };
    });
    const deadline = Date.now() + 45000;
    let data = { releases: [], verdicts: [] };
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      data = await page.evaluate(() => ({ releases: window.__bbCadence.releases.slice(), verdicts: window.__bbCadence.verdicts.slice() }));
      if (data.releases.length >= 4) break;
    }
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

  // R1: both canvases mounted at a real, usable size, with the WebGL one UNDER the 2-D overlay
  // (they swapped when the scene became the field - baseball.css's own note).
  const canvasSize = await page.evaluate(() => {
    const c = document.querySelector('.bb-field-canvas');
    const a = document.querySelector('.bb-actor-canvas');
    if (!c || !a) return null;
    const r = c.getBoundingClientRect();
    return { width: r.width, height: r.height, overlayZ: +getComputedStyle(c).zIndex, sceneZ: +getComputedStyle(a).zIndex };
  });
  if (!canvasSize || canvasSize.width < 8) {
    fail('field-canvas', 'the field canvases are missing or have no usable width');
  } else if (!(canvasSize.overlayZ > canvasSize.sceneZ)) {
    fail('field-canvas', `the 2-D overlay (z ${canvasSize.overlayZ}) does not sit above the WebGL scene (z ${canvasSize.sceneZ})`);
  } else {
    ok(`field canvases mounted at ${canvasSize.width.toFixed(0)}px wide, overlay z ${canvasSize.overlayZ} above scene z ${canvasSize.sceneZ}`);
  }
}
await ctx.close();

// R1 (docs/BASEBALL-3D-BUILD.md section 9). The three probes below REPLACE the ones that used to
// sit here - `field-projection` (the 2-D overhead camera's own spread), `plate-camera`
// (PLATE_ANCHORS' internal sanity) and `plate-flight` (the pinhole curve `plateBallPos` drew), plus
// check 7's `overhead-homography`. All four measured a PAINTING. There is no painting: the field is
// real three.js geometry seen through a real perspective camera, so what has to be true is stated
// in the world and checked through the camera's own projection.
//
// All three run in plain node - `field.js` imports three and nothing DOM-shaped at module scope, so
// the cameras and the fence curve can be built and measured with no browser at all.
{
  const mod = await import('./baseball/js/field.js');
  const SET = await import('./baseball/js/engine/settings.js');
  const W = 393, H = 429;   // the real field band on a 393x852 phone, measured in the hub
  const cams = mod.makeCameras(W / H);

  // zone-world: the pitch crosses at the zone's own centre, and the engine's x = +1 / -1 land on
  // the zone's right and left edges. Same invariant the 2-D `plate-flight` probe pinned (Matt,
  // 2026-09-15: "contact only happened once the ball was almost OUT of the strike zone"), now
  // stated where it belongs - in the world, through the batting camera's own projection.
  {
    const z = mod.zoneRectFt();
    const P = (x, y) => mod.projectToCanvas(cams.batter, { x, y, z: z.z }, W, H);
    const corners = mod.zoneCornersFt().map((c) => mod.projectToCanvas(cams.batter, c, W, H));
    const left = Math.min(...corners.map((c) => c.x)), right = Math.max(...corners.map((c) => c.x));
    const top = Math.min(...corners.map((c) => c.y)), bottom = Math.max(...corners.map((c) => c.y));
    const mid = P(0, z.cy);
    if (mid.x <= left || mid.x >= right || mid.y <= top || mid.y >= bottom) {
      fail('zone-world', `x=0 crosses at (${mid.x.toFixed(1)}, ${mid.y.toFixed(1)}), outside the projected zone box ${left.toFixed(1)}..${right.toFixed(1)} x ${top.toFixed(1)}..${bottom.toFixed(1)}`);
    } else {
      ok(`zone-world: x=0 crosses inside the projected zone box (${mid.x.toFixed(1)}, ${mid.y.toFixed(1)}) in ${left.toFixed(1)}..${right.toFixed(1)} x ${top.toFixed(1)}..${bottom.toFixed(1)}, box ${(right - left).toFixed(1)}x${(bottom - top).toFixed(1)} px`);
    }
    const rightEdge = P(mod.ZONE.halfW, z.cy), leftEdge = P(-mod.ZONE.halfW, z.cy);
    const dr = Math.abs(rightEdge.x - right), dl = Math.abs(leftEdge.x - left);
    if (dr > 2 || dl > 2) {
      fail('zone-world', `x=+1/-1 land ${dr.toFixed(2)}/${dl.toFixed(2)} px off the zone's right/left edges (budget 2 px)`);
    } else {
      ok(`zone-world: x=+1 and x=-1 land on the zone's right/left edges (${dr.toFixed(2)}/${dl.toFixed(2)} px off, budget 2)`);
    }
  }

  // ball-grows: a ball flown at constant speed from the pitcher's release point to the crossing
  // point must grow, monotonically, on the batting camera. The 2-D camera had to write a pinhole
  // law out by hand to get this (`PLATE_CAMERA_FT`); a real camera does it for free, and this is
  // the check that it actually does - a camera pointed the wrong way, or a flight that ran away
  // from the plate instead of toward it, would show a ball that shrinks.
  {
    const z = mod.zoneRectFt();
    const from = { x: -1.2, y: 6.0, z: mod.RUBBER.z + 4 };   // about where a release lands
    const to = { x: 0, y: z.cy, z: z.z };
    const N = 200;
    let prev = -1, mono = true, first = 0, last = 0;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const c = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, z: from.z + (to.z - from.z) * f };
      // The projected RADIUS: the centre, and a point one ball-radius to the camera's right at the
      // same depth. A sphere's projected size is what a player reads as "it is coming".
      const a = mod.projectToCanvas(cams.batter, c, W, H);
      const b = mod.projectToCanvas(cams.batter, { x: c.x + mod.BALL_RADIUS_FT, y: c.y, z: c.z }, W, H);
      const r = Math.abs(b.x - a.x);
      if (i === 0) first = r;
      if (i === N) last = r;
      if (r < prev - 1e-9) mono = false;
      prev = r;
    }
    if (!mono) fail('ball-grows', 'the projected ball radius is not monotonically increasing over the flight');
    else ok(`ball-grows: the projected ball radius rises monotonically, ${first.toFixed(2)} px at release to ${last.toFixed(2)} px at the crossing (${(last / first).toFixed(1)}x)`);
  }

  // fence-shape: the wall that ships has to be the wall the engine scored the home run against. It
  // is built from `outcomes.js`'s own `fenceFtAt`, so this samples the SHIPPED ribbon (the exact
  // points `buildStadium` extrudes) at the five named spray angles and measures the distance from
  // home plate. Within 1 ft, per R1's own budget, which is the sampling step's own error.
  {
    const NAMED = [['left', -45], ['leftCenter', -22.5], ['center', 0], ['rightCenter', 22.5], ['right', 45]];
    let worst = 0, worstWhere = '';
    for (const league of SET.LEAGUES) {
      const fenceFt = SET.FIELD[league].fenceFt;
      const pts = mod.fencePoints(fenceFt, 2);
      for (const [name, deg] of NAMED) {
        // The ribbon's own wall AT this angle. The samples are every 2 degrees, so a named angle
        // that falls between two of them (leftCenter and rightCenter do, at -22.5 and +22.5) is
        // read by interpolating along the SEGMENT the wall actually is there - taking the nearest
        // sample instead measured a point up to a degree away and read 1.56 ft out at college
        // centre, which is a sampling error being reported as a geometry error.
        const ang = (p) => (Math.atan2(p.x, -p.z) * 180) / Math.PI;
        let a = pts[0], b = pts[1];
        for (let i = 0; i + 1 < pts.length; i++) {
          if (ang(pts[i]) <= deg && deg <= ang(pts[i + 1])) { a = pts[i]; b = pts[i + 1]; break; }
        }
        const span = ang(b) - ang(a);
        const t = span === 0 ? 0 : (deg - ang(a)) / span;
        const hit = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        const r = Math.hypot(hit.x, hit.z);
        const err = Math.abs(r - fenceFt[name]);
        if (err > worst) { worst = err; worstWhere = `${league} ${name}`; }
      }
    }
    if (worst > 1) fail('fence-shape', `worst named-distance error ${worst.toFixed(2)} ft at ${worstWhere} (budget 1 ft)`);
    else ok(`fence-shape: every league's five named fence distances are within ${worst.toFixed(2)} ft of FIELD[league].fenceFt (worst: ${worstWhere}, budget 1 ft)`);
  }
}

// 8. FIRST-FRAME (was `preload`; R1, docs/BASEBALL-3D-BUILD.md section 9). Matt's report was "~1.1s
// of flat green after Play, and the first wind-up starts under it", and stage 7 fixed it by waiting
// for `plate.webp` to DECODE. There is no picture any more, so the thing to wait for is the SCENE:
// `_stepWindup` awaits `actors.firstFrame()`, which resolves inside the render loop the moment
// `renderer.render` has actually run once. Same assertion, same 300 ms budget against the Play tap,
// against the thing that replaced the picture. A FRESH mount (own context), not the page already
// deep into r2-cadence's own drive above, so this catches the very first Play tap of a game.
//
// Timed by wrapping `_drawStaticField`/`actors.play` themselves (each records its own
// `performance.now()` INSIDE the call, synchronously) rather than by polling the canvas from
// outside on a setTimeout loop: measured on this container, mounting Baseball's two skinned actors
// under SwiftShader blocks the main thread for ~350ms right after Play (the same software-GL
// contention `actors.js`'s own `isSoftGL()` render cap exists for - "GL Driver Message... GPU
// stall due to ReadPixels" prints to the console during it), which starves an outside poller for
// the whole block and makes it observe both signals only once the block ends, in whichever order
// its next tick happens to land - telling nothing real about which one actually ran first. An
// in-line timestamp taken at the moment each call actually executes has no such gap: it is exactly
// as accurate whether the main thread was free or busy around it, since it runs synchronously,
// inline, either way. A single sky-pixel sample AFTER both signals corroborates that the
// stadium is really on screen: it reads the WebGL canvas's own top quarter, which the sky sphere
// fills, so a frac above 10% separates "the scene rendered" from "an empty canvas over the CSS
// gradient". It is read by drawing that canvas into a scratch 2-D one, because a WebGL canvas has
// no 2-D context to ask for pixels.
{
  const p8 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page8 = await p8.newPage();
  await page8.addInitScript(() => {
    // R1: the sky-pixel corroboration reads the WebGL canvas back, which needs
    // preserveDrawingBuffer - the same seam actors.js already gates on (`__bbTest`).
    window.__bbTest = true;
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Preload Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr8 = await mountInHub(page8);
  if (mountErr8) {
    fail('first-frame', `mount failed: ${mountErr8}`);
  } else {
    const result = await page8.evaluate(async () => {
      const root = document.querySelector('.hub-game');
      const inst = root._bbInstance;
      const canvas = () => document.querySelector('.bb-actor-canvas');
      const skyFrac = () => {
        const c = canvas();
        if (!c || !c.width || !c.height) return 0;
        const w = c.width, bandH = Math.max(1, Math.round(c.height * 0.25));
        const scratch = document.createElement('canvas');
        scratch.width = w; scratch.height = bandH;
        const ctx2 = scratch.getContext('2d');
        try { ctx2.drawImage(c, 0, 0, w, bandH, 0, 0, w, bandH); } catch { return 0; }
        const d = ctx2.getImageData(0, 0, w, bandH).data;
        let sky = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          n++;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (b > r + 15 && b > g + 5 && b > 120) sky++;
        }
        return n ? sky / n : 0;
      };
      // "Painted" is the scene's own first rendered frame - the exact signal `_stepWindup` waits
      // on, read from the render loop's own resolve rather than by polling pixels from outside.
      let firstPaintAt = null;
      inst.actors.firstFrame().then(() => { if (firstPaintAt == null) firstPaintAt = performance.now(); });
      const origPlay = inst.actors.play.bind(inst.actors);
      let firstPitchAt = null;
      inst.actors.play = (role, name, opts) => {
        if (firstPitchAt == null && role === 'pitcher' && name === 'Pitch') firstPitchAt = performance.now();
        return origPlay(role, name, opts);
      };
      // Wait for Play to be ACTIONABLE before starting the clock. Until the model has loaded the
      // button reads `load_model` and carries aria-disabled, and its own handler awaits the load
      // promise anyway - so a click before that measures the model fetch, not the field appearing,
      // and no player can meaningfully make it. R1 matters here because the stadium's shaders are
      // compiled at MOUNT (`Actors.warm()`, 227 ms on this container's software rasteriser) and
      // that work sits inside the same load promise: measured from an early click the gap is about
      // 630 ms, measured from the moment Play actually offers itself it is about 90 ms.
      const btn = root.querySelector('.bb-play-btn');
      const settleDeadline = performance.now() + 15000;
      while (!inst._actorsSettled && performance.now() < settleDeadline) await new Promise((r) => setTimeout(r, 30));
      const clickAt = performance.now();
      if (btn) btn.click();
      // R2 (docs/BASEBALL-3D-BUILD.md section 9): the first wind-up no longer starts by itself -
      // the batting turn waits on READY. So the tap is supplied here, the moment the button offers
      // it, and the ordering this probe exists to check (the scene has rendered BEFORE a delivery
      // runs) is unchanged: `_stepWindup` still awaits `actors.firstFrame()` ahead of the clip.
      const deadline = clickAt + 3000;
      let readyTapped = false;
      while (performance.now() < deadline && (firstPaintAt == null || firstPitchAt == null)) {
        if (!readyTapped && inst.state && inst.state.actionLabel === 'act_ready' && inst._onMainDown) {
          readyTapped = true;
          inst._onMainDown();
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      // One settle beat past both signals, then a single real pixel sample as corroboration. The
      // render is forced first so the read-back cannot land on a frame the compositor already took.
      await new Promise((r) => setTimeout(r, 200));
      inst.actors.renderer.render(inst.actors.scene, inst.actors.camera);
      return {
        flatGreenMs: firstPaintAt != null ? firstPaintAt - clickAt : null,
        firstPitchAtMs: firstPitchAt != null ? firstPitchAt - clickAt : null,
        finalSkyFrac: skyFrac(),
      };
    });
    if (result.flatGreenMs == null) {
      fail('first-frame', 'the scene never rendered a frame (actors.firstFrame() never resolved) within 3s of Play');
    } else if (result.firstPitchAtMs == null) {
      fail('first-frame', "the first actors.play('pitcher','Pitch') call was never observed within 3s of Play");
    } else if (result.finalSkyFrac <= 0.10) {
      fail('first-frame', `sky frac ${result.finalSkyFrac.toFixed(3)} after both signals - the canvas does not actually show the stadium`);
    } else if (result.flatGreenMs >= result.firstPitchAtMs) {
      fail('first-frame', `scene first rendered at ${result.flatGreenMs.toFixed(0)}ms, AFTER the first Pitch call at ${result.firstPitchAtMs.toFixed(0)}ms - the wind-up started under an empty field`);
    } else if (result.flatGreenMs >= 300) {
      fail('first-frame', `first rendered frame ${result.flatGreenMs.toFixed(0)}ms after Play >= 300ms budget (was 1050ms before stage 7's own fix)`);
    } else {
      ok(`scene first rendered ${result.flatGreenMs.toFixed(0)}ms after Play, before the first Pitch call at ${result.firstPitchAtMs.toFixed(0)}ms (budget 300ms; sky frac ${result.finalSkyFrac.toFixed(3)})`);
    }
  }
  await p8.close();
}

// 9. R2 (docs/BASEBALL-3D-BUILD.md section 9): PITCH-DRAG and TARGET-MARKER. Replaces the
// `tap-tap-pitch` probe, which checked the meter: tap to start, hold at the mark, tap to release.
// R2 deleted all three. What it is replaced by is the mechanic that took its place - tap PITCH
// once, aim with a 2-D drag during the wind-up, and the pitch goes where the cursor was at the
// mark - plus the batting half's own new picture, the target marker that appears at release and
// slides to where the ball will really cross.
//
// Both drive the REAL game through the real hub. `pitch-drag` needs the human's own PITCHING turn,
// which the top half of an inning never starts on, so it uses the same dev-only
// `window.__bbTest.forceHalf('bottom')` seam the retired probe did.
{
  const p9 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page9 = await p9.newPage();
  const pageErrors = [];
  page9.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  await page9.addInitScript(() => {
    window.__bbDevForce = true; // BaseballPlayScreen's own dev-gate override - see ui.js's `this.dev`
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Drag Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr9 = await mountInHub(page9);
  if (mountErr9) {
    fail('pitch-drag', `mount failed: ${mountErr9}`);
  } else {
    const consts = await page9.evaluate(async () => {
      const S = await import('/baseball/js/engine/settings.js');
      return { aimScatter: S.FEEL.engine.aimScatter, curveBreak: S.BREAK_OFFSET.curveball };
    });
    // window.__bbForceHalfNext is set in the SAME evaluate call that taps Play - `_startGame`'s own
    // comment explains why: it applies the flag synchronously, before `playGame()`'s first
    // `playAtBat()` ever reads `this.half`.
    const clicked = await page9.evaluate(() => {
      window.__bbForceHalfNext = 'bottom';
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
      return !!btn;
    });
    if (!clicked) {
      fail('pitch-drag', 'no .bb-play-btn to start Quick Play');
    } else {
      await page9.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
      const seamPresent = await page9.evaluate(() => {
        if (!window.__bbTest || typeof window.__bbTest.forceHalf !== 'function') return false;
        window.__bbTest.forceHalf('bottom');
        // Pin the four pre-rolled draws to their midpoint (no aim scatter at all) - the seam's own
        // header in ui.js says why this is the honest way to ask "did the drag reach the engine".
        if (window.__bbTest.noScatter) window.__bbTest.noScatter(true);
        return true;
      });
      if (!seamPresent) {
        fail('pitch-drag', 'window.__bbTest.forceHalf is not available - dev flag not honored, or the seam is missing');
      } else {
        const reachedPitching = await page9.waitForFunction(() => {
          const inst = document.querySelector('.hub-game')._bbInstance;
          return !!(inst && inst.state && inst.state.mode === 'pitching');
        }, null, { timeout: 20000 }).then(() => true).catch(() => false);
        if (!reachedPitching) {
          fail('pitch-drag', "never reached the human's own pitching turn within 20s of forceHalf('bottom')");
        } else {
          // Idle: nothing thrown, nothing in flight, until the player taps.
          const idle = await page9.evaluate(() => {
            const inst = document.querySelector('.hub-game')._bbInstance;
            return { thrown: !!inst._lastThrow, flying: !!inst._flightActive };
          });
          if (idle.thrown || idle.flying) fail('pitch-drag', `a pitch was already in flight before any tap (thrown=${idle.thrown}, flying=${idle.flying})`);
          else ok('nothing is thrown before the PITCH tap');

          // TAP, THEN DRAG. The drag lands 150ms after the tap, well inside the 700ms wind-up, and
          // asks for (+0.8, -0.5) zone units - up and to the right of dead centre, chosen because
          // neither number is 0 and neither is the same as the other, so an axis swap or a dropped
          // sign cannot pass.
          const WANT = { x: 0.8, y: -0.5 };
          const got = await page9.evaluate(async (want) => {
            const inst = document.querySelector('.hub-game')._bbInstance;
            inst.state.selectedPitch = 'curveball';   // a pitch that BREAKS, so the break is checked too
            inst._paintStrip(); inst._paintModeLabels();
            const pad = document.querySelector('[data-role="pad"]');
            const main = document.querySelector('[data-role="mainbtn"]');
            const tapAt = performance.now();
            main.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
            main.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
            const r = pad.getBoundingClientRect();
            const travel = { x: 1.6, y: 1.4 };   // ui.js's PAD_TRAVEL.pitching
            const cx = r.left + r.width * (((want.x / travel.x) + 1) / 2);
            const cy = r.top + r.height * (((-want.y / travel.y) + 1) / 2);
            const touch = (type, x, y) => {
              const ev = new Event(type, { bubbles: true, cancelable: true });
              ev.touches = [{ clientX: x, clientY: y }];
              pad.dispatchEvent(ev);
            };
            await new Promise((r2) => setTimeout(r2, 150));
            touch('touchstart', r.left + r.width / 2, r.top + r.height / 2);
            touch('touchmove', cx, cy);
            touch('touchend', cx, cy);
            const dragDoneMs = performance.now() - tapAt;
            const deadline = performance.now() + 4000;
            while (!inst._lastThrow && performance.now() < deadline) await new Promise((r2) => setTimeout(r2, 25));
            const th = inst._lastThrow;
            return { dragDoneMs, cursor: { ...inst.cursor }, aim: th ? th.aim : null, type: th ? th.type : null,
              preview: th ? { x: th.preview.x, y: th.preview.y, straightX: th.preview.straightX, straightY: th.preview.straightY } : null };
          }, WANT);
          if (got.dragDoneMs > 400) {
            fail('pitch-drag', `the drag took ${got.dragDoneMs.toFixed(0)}ms from the tap, past the 400ms this probe drives it in`);
          } else if (!got.aim) {
            fail('pitch-drag', 'the wind-up never sampled the cursor (no _lastThrow within 4s of the tap)');
          } else {
            const dx = Math.abs(got.aim.x - WANT.x), dy = Math.abs(got.aim.y - WANT.y);
            if (dx > 0.02 || dy > 0.02) {
              fail('pitch-drag', `the pitch's engine aim (${got.aim.x.toFixed(3)}, ${got.aim.y.toFixed(3)}) is not the dragged cursor (${WANT.x}, ${WANT.y}) - off by (${dx.toFixed(3)}, ${dy.toFixed(3)}), budget 0.02`);
            } else {
              ok(`pitch-drag: a drag to (${WANT.x}, ${WANT.y}) during the wind-up is the pitch's own engine aim within (${dx.toFixed(4)}, ${dy.toFixed(4)}) zone units, sampled ${got.dragDoneMs.toFixed(0)}ms after the tap`);
            }
            // With the draws pinned mid-range there is no scatter at all, so the STRAIGHT point is
            // the aim exactly and the difference between it and the crossing is the type's own
            // break - the R2 mechanic that replaced steering, measured end to end.
            const sdx = Math.abs(got.preview.straightX - got.aim.x), sdy = Math.abs(got.preview.straightY - got.aim.y);
            const bx = got.preview.x - got.preview.straightX, by = got.preview.y - got.preview.straightY;
            if (sdx > 1e-9 || sdy > 1e-9) {
              fail('pitch-drag', `with the scatter draws pinned mid-range the straight point should BE the aim; it is off by (${sdx}, ${sdy})`);
            } else if (Math.abs(Math.abs(bx) - consts.curveBreak.x) > 1e-9 || Math.abs(by - consts.curveBreak.y) > 1e-9) {
              fail('pitch-drag', `the curveball's break at the plate is (${bx.toFixed(3)}, ${by.toFixed(3)}), not BREAK_OFFSET.curveball (+-${consts.curveBreak.x}, ${consts.curveBreak.y})`);
            } else {
              ok(`pitch-drag: the curveball crosses at aim + BREAK_OFFSET (break ${bx.toFixed(3)}, ${by.toFixed(3)} zone units) - the point cursor's own promise`);
            }
          }
        }
      }
    }
  }
  if (pageErrors.length) fail('pitch-drag', `page errors during the pitching turn: ${pageErrors.slice(0, 3).join(' | ')}`);
  else ok('no page errors during the human pitching turn');
  await p9.close();
}

// 10. R2: TARGET-MARKER. docs/BASEBALL-REFERENCE-B9.md, batting step 3: "the pitch's TARGET is
// shown on the field as a small marker; you drag the cursor circle onto it. For an off-speed pitch
// the marker MOVES during the flight and you follow it." So: during the human's own batting
// flight, the overlay must draw a marker that STARTS at the pitch's straight-line spot and ENDS on
// where the ball actually crosses. The expected pixels are projected here, through `field.js`'s own
// `projectToCanvas` on the live batting camera - not through the drawing code being checked.
{
  const p10 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page10 = await p10.newPage();
  await page10.addInitScript(() => {
    window.__bbDevForce = true;
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Marker Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr10 = await mountInHub(page10);
  if (mountErr10) {
    fail('target-marker', `mount failed: ${mountErr10}`);
  } else {
    await page10.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page10.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    const res = await page10.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const field = await import('/baseball/js/field.js');
      // Capture the pitch the flight is drawing, and sample the marker as it goes.
      // Force the CPU to throw a CURVEBALL. A fastball does not break, so its marker starts and
      // ends in the same place and "it slid to the right spot" would be true of a marker that
      // never moved at all - which is exactly the half of the mechanic worth checking. The pitch
      // for the at-bat that is ALREADY waiting on READY was decided before this patch existed
      // (`playAtBat` calls decidePitch, then decideSwing), so the loop below keeps taking pitches
      // until a curveball's own flight is the one being sampled.
      const home = inst.game.agents.home;
      const origPitch = home.decidePitch.bind(home);
      home.decidePitch = async (v) => ({ ...(await origPitch(v)), type: 'curveball' });
      let samples = [];
      let pitch = null;
      const origFlight = inst._animatePitchFlight.bind(inst);
      inst._animatePitchFlight = (p) => { pitch = p; samples = []; return origFlight(p); };
      const poll = setInterval(() => { if (inst._targetMarkerPx) samples.push({ ...inst._targetMarkerPx }); }, 16);
      // Tap READY, then let the whole pitch play out WITHOUT swinging (a take still flies).
      const deadline = Date.now() + 40000;
      while (Date.now() < deadline && !(pitch && pitch.type === 'curveball' && samples.length >= 6)) {
        const label = document.querySelector('[data-role="ringlabel"]');
        if (label && /ready|listo/i.test(label.textContent)) {
          const main = document.querySelector('[data-role="mainbtn"]');
          main.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
          main.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      await new Promise((r) => setTimeout(r, 400));
      clearInterval(poll);
      if (!pitch || samples.length < 2) return { samples: samples.length, pitch: !!pitch };
      const w = inst._fieldW, h = inst._fieldH;
      const z = field.zoneRectFt();
      const project = (u, v) => field.projectToCanvas(inst.actors.camera,
        { x: u * field.ZONE.halfW, y: z.cy + v * (z.h / 2), z: field.ZONE.z }, w, h);
      return {
        samples: samples.length,
        first: samples[0], last: samples[samples.length - 1],
        wantFirst: project(pitch.straightX, pitch.straightY),
        wantLast: project(pitch.x, pitch.y),
        type: pitch.type,
        moved: Math.hypot(samples[samples.length - 1].x - samples[0].x, samples[samples.length - 1].y - samples[0].y),
      };
    });
    if (!res.first) {
      fail('target-marker', `no marker was ever drawn during a human batting flight (samples=${res.samples}, sawPitch=${res.pitch})`);
    } else {
      const dFirst = Math.hypot(res.first.x - res.wantFirst.x, res.first.y - res.wantFirst.y);
      const dLast = Math.hypot(res.last.x - res.wantLast.x, res.last.y - res.wantLast.y);
      if (dFirst > 2) {
        fail('target-marker', `the marker starts ${dFirst.toFixed(2)} px from the pitch's straight-line spot (budget 2 px)`);
      } else if (dLast > 2) {
        fail('target-marker', `the marker ends ${dLast.toFixed(2)} px from where the ball actually crosses (budget 2 px)`);
      } else if (res.moved < 3) {
        fail('target-marker', `the marker only travelled ${res.moved.toFixed(2)} px over a ${res.type}'s flight - a breaking pitch's marker has to MOVE (docs/BASEBALL-REFERENCE-B9.md, batting step 3)`);
      } else {
        ok(`target-marker: over a ${res.type}'s flight the marker starts on the straight-line spot (${dFirst.toFixed(2)} px) and ends on the real crossing point (${dLast.toFixed(2)} px), travelling ${res.moved.toFixed(1)} px between them`);
      }
    }
  }
  await p10.close();
}

await browser.close();

console.log('');
console.log(failed === 0 ? `All checks passed.` : `${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
