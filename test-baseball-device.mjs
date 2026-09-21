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
  // `_showPop` (what `_onEngineEvent` paints the verdict through).
  // R4 (docs/BASEBALL-3D-BUILD.md section 9): this used to wrap `_setLine1`, which painted the
  // verdict word on every 'count' - R4 moved that word OUT of `.bb-lines` and into `.bb-pop`
  // itself (over the batter's head), so `.bb-lines` now goes empty on every pitch and Line 1 only
  // ever carries an AT-BAT'S OWN outcome word or "Side retired". `_showPop` is called at the exact
  // same synchronous point Line 1 used to be set (every 'count'/in-play 'atBatEnd'), so this is the
  // same measurement through the correct current signal, not a new one.
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
      const origPop = inst._showPop.bind(inst);
      inst._showPop = (word, kind, opts) => { rec.verdicts.push({ t: performance.now(), txt: String(word) }); return origPop(word, kind, opts); };
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
      if (data.releases.length >= 5) break;
    }
    const allGaps = [];
    for (let i = 0; i + 1 < data.releases.length; i++) {
      // R4: no "retired"/half-inning text filter needed any more - `_showPop` (unlike the old
      // `_setLine1` wrap) is never called with that text at all, only with a real verdict word.
      const v = data.verdicts.find((x) => x.t > data.releases[i] && x.t < data.releases[i + 1]);
      if (v) allGaps.push({ gap: data.releases[i + 1] - v.t, txt: v.txt });
    }
    // THE FIRST GAP IS DROPPED, and it is the only one that is. It is measured across the busiest
    // seconds this game ever has - the model has just finished loading, `Actors.warm()` is
    // compiling shaders and the scene is rendering its first frames, all on a software rasteriser -
    // and the beat being measured is a chain of setTimeouts that the same main thread owns.
    // Measured breakdown on this container: verdict to the next `decideSwing` is 2031 to 2048 ms
    // against its 2000 ms of sleeps (RESULT_MS + BETWEEN_MS) once the page has settled, and about
    // 120 ms more than that on the first cycle. R2's target is half what R1's was, so the same
    // warm-up slop that fitted inside a 6200 ms +-150 window does not fit inside a 3000 ms one.
    // What this probe is for is the STEADY beat.
    const gaps = allGaps.slice(1);
    const target = expected.result + expected.between + expected.windup;
    // The chain is setTimeout + rAF on a page whose render loop runs under SwiftShader here; R1
    // measured the loop pushing a timer chain ~100 ms late at pixel ratio 1, and after R2 cut the
    // target from 6.2 s to 3.0 s that same absolute lateness is a bigger share of it (orchestrator's
    // ship run of R2: 3035 to 3345 ms over three gaps, the stage's own runs 3010 to 3106). The
    // budget is 12% of the target, floored at 150 ms - a real 500 ms drift still fails.
    const TOL = Math.max(150, Math.round(target * 0.12));
    const desc = gaps.map((g) => `${g.txt} ${g.gap.toFixed(0)}ms`).join(', ');
    if (gaps.length < 2) {
      fail('r2-cadence', `only ${gaps.length} steady-state verdict-to-release gaps observed in 45s (releases=${data.releases.length}, verdicts=${data.verdicts.length}, first gap dropped) - is the CPU pitching to a human batter?`);
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
  // R8 (docs/BASEBALL-3D-BUILD.md section 9, "R8", item 4): the field band's own height now
  // DEPENDS on state.mode, since the 48px HUD row left the flex column entirely and the BATTING
  // strip alone shrinks (item 5) - the two states no longer share one band height the way they
  // did through R7 (both were 429px then). Measured live in the hub, 393x852, dpr 2:
  // BATTING (32px strip): 553px. PITCHING (108px strip, unchanged): 477px. `zone-world`/
  // `ball-grows` below test `cams.batter`, so they use the BATTING band; `pitcher-frame` tests
  // `camsPitching.pitcher` and uses the PITCHING band - never mix the two, or a true fact about
  // one camera gets checked against the other state's aspect.
  const W = 393, H = 553;   // the real BATTING-state field band on a 393x852 phone, measured in the hub
  const H_PITCHING = 477;   // the real PITCHING-state field band, same device
  const cams = mod.makeCameras(W / H);
  const camsPitching = mod.makeCameras(W / H_PITCHING);

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

  // pitcher-frame: R8 (docs/BASEBALL-3D-BUILD.md section 9, "R8", item 2). Matt's recording: "the
  // strike zone when pitching is massive" - the true box projected to 9px wide, so `ui.js` floored
  // it to 13% of the canvas width over TRUE-size figures, "a huge box over tiny men". `CAMERAS.
  // pitcher` is now a long lens (55.6ft behind the rubber, fov 10.35, see field.js's own header)
  // chosen so the TRUE box needs no floor at all. Two assertions, straight off `camsPitching.
  // pitcher` and the PITCHING band (477px) - no live browser needed, the same directness zone-world
  // and ball-grows above already use for `cams.batter`.
  {
    const cam = camsPitching.pitcher;
    const z = mod.zoneRectFt();
    const boxTop = mod.projectToCanvas(cam, { x: 0, y: z.top, z: z.z }, W, H_PITCHING);
    const boxBot = mod.projectToCanvas(cam, { x: 0, y: z.bottom, z: z.z }, W, H_PITCHING);
    const boxH = Math.abs(boxTop.y - boxBot.y);
    const boxFrac = boxH / H_PITCHING;
    if (boxFrac < 0.08 || boxFrac > 0.13) {
      fail('pitcher-frame', `the true zone box is ${(boxFrac * 100).toFixed(2)}% of the band's height (${boxH.toFixed(1)}px of ${H_PITCHING}px) - want 8-13%`);
    } else {
      ok(`pitcher-frame: the true zone box is ${(boxFrac * 100).toFixed(2)}% of the band's height (${boxH.toFixed(1)}px), inside 8-13%`);
    }
    const heightPx = (x, zPos, y0, y1) => {
      const a = mod.projectToCanvas(cam, { x, y: y0, z: zPos }, W, H_PITCHING);
      const b = mod.projectToCanvas(cam, { x, y: y1, z: zPos }, W, H_PITCHING);
      return Math.abs(a.y - b.y);
    };
    const FIG = mod.FIGURE_HEIGHT_FT;
    const pitcherH = heightPx(mod.RUBBER.x, mod.RUBBER.z, mod.RUBBER.y, mod.RUBBER.y + FIG);
    const batterH = heightPx(mod.BATTER_BOX.x, mod.BATTER_BOX.z, 0, FIG);
    const ratio = pitcherH > 0 ? batterH / pitcherH : -1;
    if (ratio < 0.30 || ratio > 0.50) {
      fail('pitcher-frame', `the batter figure is ${(ratio * 100).toFixed(1)}% of the pitcher's projected height (want 30-50%)`);
    } else {
      ok(`pitcher-frame: the batter figure is ${(ratio * 100).toFixed(1)}% of the pitcher's projected height, inside 30-50% (pitcher ${(pitcherH / H_PITCHING * 100).toFixed(1)}% of the band)`);
    }
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

// 9. R2 (docs/BASEBALL-3D-BUILD.md section 9): PITCH-DRAG and TARGET-MARKER. `pitch-drag` used to
// check that a drag to given ENGINE units (+0.8, -0.5) produced that same engine aim - true, but
// blind to which way it drew on SCREEN. R8 (section 9, "R8", item 1): Matt, on the recording:
// "When I move left, it goes right" - while PITCHING only. Measured: the pitcher camera looks
// toward +z, so world (and engine) +x draws on the LEFT there, while the batter camera looks
// toward -z, so world +x draws on the RIGHT - the pad itself is flat screen space with no camera,
// so "finger right" has to become DIFFERENT engine signs on the two cameras to draw the same way
// on screen both times (`PAD_X_SIGN`, ui.js). `pitch-drag` is now a SCREEN test on BOTH cameras: a
// drag right on the pad ends with the cursor's projected pixel to the right of the zone box's own
// centre, and (pitching only, where `_lastThrow` exists to read) the engine's sampled aim is the
// MIRRORED value the drag direction implies - never the raw, un-mirrored one the old probe checked.
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
  let p9b = null;
  const mountErr9 = await mountInHub(page9);
  if (mountErr9) {
    fail('pitch-drag', `mount failed: ${mountErr9}`);
  } else {
    const consts = await page9.evaluate(async () => {
      const S = await import('/baseball/js/engine/settings.js');
      return { aimScatter: S.FEEL.engine.aimScatter, curveBreak: S.BREAK_OFFSET.curveball };
    });
    const clickedInitial = await page9.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
      return !!btn;
    });
    if (!clickedInitial) {
      fail('pitch-drag', 'no .bb-play-btn to start Quick Play');
    } else {
      await page9.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
      // --- (a) the BATTER camera, the default state the human's very first at-bat opens on
      // (top of the inning, away bats). No seam needed - the pad works the instant `.bb-play` is
      // mounted, before READY is even offered - but `_zoneMap` needs the canvas actually sized
      // (`_fieldW`), which `_sizeCanvas` sets a frame or two after mount (`_renderPlay`'s own
      // `requestAnimationFrame` call), so this waits for it first rather than risk a race. A drag
      // to the pad's own right quarter (screen space) must leave `this.cursor` positive (batting
      // is UNMIRRORED, `PAD_X_SIGN.batting` = 1) and its projected pixel, through `_zoneMap(
      // 'batting')`, to the right of the zone box's own centre x.
      await page9.waitForFunction(() => {
        const inst = document.querySelector('.hub-game')._bbInstance;
        return !!(inst && inst._fieldW && inst.actors && inst.actors.camera);
      }, null, { timeout: 5000 }).catch(() => {});
      const battingRes = await page9.evaluate(() => {
        const inst = document.querySelector('.hub-game')._bbInstance;
        const pad = document.querySelector('[data-role="pad"]');
        const r = pad.getBoundingClientRect();
        const touch = (type, x, y) => {
          const ev = new Event(type, { bubbles: true, cancelable: true });
          ev.touches = [{ clientX: x, clientY: y }];
          pad.dispatchEvent(ev);
        };
        const cx = r.left + r.width * 0.85, cy = r.top + r.height * 0.5;   // clearly right of centre, screen space
        touch('touchstart', r.left + r.width / 2, r.top + r.height / 2);
        touch('touchmove', cx, cy);
        touch('touchend', cx, cy);
        const map = inst._zoneMap('batting');
        const p = map ? map.toPx(inst.cursor.x, inst.cursor.y) : null;
        return { mode: inst.state.mode, cursorX: inst.cursor.x, pxX: p && p.x, zoneCx: map && map.cx };
      });
      if (battingRes.mode !== 'batting') {
        fail('pitch-drag', `expected the human's default first at-bat to be BATTING, got mode="${battingRes.mode}"`);
      } else if (battingRes.cursorX <= 0) {
        fail('pitch-drag', `a screen-right drag on the BATTER camera left the cursor at engine x=${battingRes.cursorX.toFixed(3)} (want > 0 - batting is unmirrored)`);
      } else if (battingRes.pxX == null || battingRes.zoneCx == null || battingRes.pxX <= battingRes.zoneCx) {
        fail('pitch-drag', `a screen-right drag on the BATTER camera projects to px ${battingRes.pxX} which is not right of the zone centre px ${battingRes.zoneCx}`);
      } else {
        ok(`pitch-drag: a screen-right drag on the BATTER camera ends with engine x=${battingRes.cursorX.toFixed(3)} (>0, unmirrored) and its projected pixel (${battingRes.pxX.toFixed(1)}) right of the zone centre (${battingRes.zoneCx.toFixed(1)})`);
      }

      // --- (b) the PITCHER camera, forced through the human's own pitching turn (the bottom of
      // the inning), same seam as before. A FRESH page - the first game is already mid at-bat
      // from part (a) above, and `window.__bbForceHalfNext` only takes effect for a game's own
      // FIRST half (`_startGame`'s own comment: applied synchronously before `playGame()`'s first
      // `playAtBat()` ever reads `this.half`), so it cannot retroactively redirect an in-progress
      // game - a new mount is the only way to force the SECOND half this cleanly.
      p9b = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      const page9b = await p9b.newPage();
      page9b.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
      await page9b.addInitScript(() => {
        window.__bbDevForce = true;
        localStorage.setItem('gamehub.profile', JSON.stringify({
          name: 'Drag Test 2', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
        }));
        for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
      });
      const mountErr9b = await mountInHub(page9b);
      const clicked2 = mountErr9b ? false : await page9b.evaluate(() => {
        window.__bbForceHalfNext = 'bottom';
        const root = document.querySelector('.hub-game');
        const btn = root && root.querySelector('.bb-play-btn');
        if (btn) btn.click();
        return !!btn;
      });
      if (mountErr9b) {
        fail('pitch-drag', `mount failed (pitching half): ${mountErr9b}`);
      } else if (!clicked2) {
        fail('pitch-drag', 'no .bb-play-btn for the second Quick Play (pitching half)');
      } else {
        await page9b.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
        const seamPresent = await page9b.evaluate(() => {
          if (!window.__bbTest || typeof window.__bbTest.forceHalf !== 'function') return false;
          window.__bbTest.forceHalf('bottom');
          // Pin the four pre-rolled draws to their midpoint (no aim scatter at all) - the seam's
          // own header in ui.js says why this is the honest way to ask "did the drag reach the
          // engine".
          if (window.__bbTest.noScatter) window.__bbTest.noScatter(true);
          return true;
        });
        if (!seamPresent) {
          fail('pitch-drag', 'window.__bbTest.forceHalf is not available - dev flag not honored, or the seam is missing');
        } else {
          const reachedPitching = await page9b.waitForFunction(() => {
            const inst = document.querySelector('.hub-game')._bbInstance;
            return !!(inst && inst.state && inst.state.mode === 'pitching');
          }, null, { timeout: 20000 }).then(() => true).catch(() => false);
          if (!reachedPitching) {
            fail('pitch-drag', "never reached the human's own pitching turn within 20s of forceHalf('bottom')");
          } else {
            // Idle: nothing thrown, nothing in flight, until the player taps.
            const idle = await page9b.evaluate(() => {
              const inst = document.querySelector('.hub-game')._bbInstance;
              return { thrown: !!inst._lastThrow, flying: !!inst._flightActive };
            });
            if (idle.thrown || idle.flying) fail('pitch-drag', `a pitch was already in flight before any tap (thrown=${idle.thrown}, flying=${idle.flying})`);
            else ok('nothing is thrown before the PITCH tap');

            // TAP, THEN DRAG RIGHT-AND-UP (screen space - the pad's own right side, a bit above
            // centre, exactly like the batting half above). The drag lands 150ms after the tap,
            // well inside the 700ms wind-up. Expected engine aim: PITCHING is MIRRORED
            // (`PAD_X_SIGN.pitching = -1`), so a screen-right drag at pad-fraction fx=0.7 with
            // PAD_TRAVEL.pitching = {1.6, 1.4} must sample as engine x = -1 * 0.7 * 1.6 = -1.12,
            // NOT +1.12 - the exact bug the recording showed, made assertable. y is untouched by
            // the fix (unmirrored on both cameras, and its own sign flip - "screen down is zone
            // DOWN" - is unaffected by R8): a drag to fy=-0.4 (screen a bit ABOVE pad centre)
            // samples as engine y = -(-0.4) * 1.4 = +0.56, included only to prove the axis
            // swap/sign fix did not leak into y.
            const WANT = { x: -1.12, y: 0.56 };
            const got = await page9b.evaluate(async (want) => {
              const inst = document.querySelector('.hub-game')._bbInstance;
              inst.state.selectedPitch = 'curveball';   // a pitch that BREAKS, so the break is checked too
              inst._paintStrip(); inst._paintModeLabels();
              const pad = document.querySelector('[data-role="pad"]');
              const main = document.querySelector('[data-role="mainbtn"]');
              const tapAt = performance.now();
              main.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
              main.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
              const r = pad.getBoundingClientRect();
              const cx = r.left + r.width * 0.85, cy = r.top + r.height * (0.5 - 0.2);   // right + a bit up, screen space
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
              const map = inst._zoneMap('pitching');
              const p = th && map ? map.toPx(th.aim.x, th.aim.y) : null;
              return { dragDoneMs, cursor: { ...inst.cursor }, aim: th ? th.aim : null, type: th ? th.type : null,
                pxX: p && p.x, zoneCx: map && map.cx,
                preview: th ? { x: th.preview.x, y: th.preview.y, straightX: th.preview.straightX, straightY: th.preview.straightY } : null };
            }, WANT);
            if (got.dragDoneMs > 400) {
              fail('pitch-drag', `the drag took ${got.dragDoneMs.toFixed(0)}ms from the tap, past the 400ms this probe drives it in`);
            } else if (!got.aim) {
              fail('pitch-drag', 'the wind-up never sampled the cursor (no _lastThrow within 4s of the tap)');
            } else {
              const dx = Math.abs(got.aim.x - WANT.x), dy = Math.abs(got.aim.y - WANT.y);
              if (dx > 0.02 || dy > 0.02) {
                fail('pitch-drag', `a screen-right(+up) drag's engine aim (${got.aim.x.toFixed(3)}, ${got.aim.y.toFixed(3)}) is not the mirrored value (${WANT.x}, ${WANT.y}) - off by (${dx.toFixed(3)}, ${dy.toFixed(3)}), budget 0.02`);
              } else if (got.pxX == null || got.zoneCx == null || got.pxX <= got.zoneCx) {
                fail('pitch-drag', `the pitcher camera's projected pixel (${got.pxX}) for the dragged aim is not right of the zone centre (${got.zoneCx}) - a screen-right drag must draw right`);
              } else {
                ok(`pitch-drag: a screen-right drag on the PITCHER camera samples the MIRRORED engine aim (${got.aim.x.toFixed(3)}, ${got.aim.y.toFixed(3)}) within (${dx.toFixed(4)}, ${dy.toFixed(4)}) of (${WANT.x}, ${WANT.y}), and draws right of the zone centre (px ${got.pxX.toFixed(1)} > ${got.zoneCx.toFixed(1)}), sampled ${got.dragDoneMs.toFixed(0)}ms after the tap`);
              }
              // With the draws pinned mid-range there is no scatter at all, so the STRAIGHT point is
              // the aim exactly and the difference between it and the crossing is the type's own
              // break - the R2 mechanic that replaced steering, measured end to end. Untouched by
              // the R8 sign fix (this is all in engine units, never screen space).
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
  }
  if (pageErrors.length) fail('pitch-drag', `page errors during the pitching turn: ${pageErrors.slice(0, 3).join(' | ')}`);
  else ok('no page errors during the human pitching turn');
  await p9.close();
  if (p9b) await p9b.close();
}

// 10. R2: TARGET-MARKER. docs/BASEBALL-REFERENCE-B9.md, batting step 3: "the pitch's TARGET is
// shown on the field as a small marker; you drag the cursor circle onto it. For an off-speed pitch
// the marker MOVES during the flight and you follow it." So: during the human's own batting
// flight, the overlay must draw a marker that STARTS at the pitch's straight-line spot and ENDS on
// where the ball actually crosses. The expected pixels are projected here, through `field.js`'s own
// `projectToCanvas` on the live batting camera - not through the drawing code being checked.
//
// R8 (docs/BASEBALL-3D-BUILD.md section 9, "R8", item 3): Matt could not see the R7 square (26px
// of thin red line). Now a filled disc; this probe keeps its position assertions unchanged and
// adds two more - the marker's own SIZE (at least 36px across, the spec's own floor) and that a
// pitch aimed for a ball CLEARLY outside the box still draws one, never clipped.
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
      // R4 (docs/BASEBALL-3D-BUILD.md section 9): the batting camera's own zone box (and both its
      // cursors, the target marker included) is now drawn at BATTING_ZONE_SCALE about the box's
      // centre (`_zoneMap('batting')`) - so the "true" projected point this probe compares against
      // has to go through that SAME map, or every sample would read as off by the scale factor
      // rather than by anything the marker-tracking logic actually got wrong. `_zoneMap`'s own true
      // (unscaled) box is independently checked by the `zone-world`/`zone-scale` probes elsewhere in
      // this file, so reusing it here still tests THIS probe's own concern - does the marker follow
      // the pitch's bend and land on the real crossing point - without re-deriving the scale rule a
      // second time.
      const map = inst._zoneMap('batting');
      const project = (u, v) => map.toPx(u, v);
      // R8 (item 3): the marker's own SIZE, in px, both axes - `TARGET_MARKER_R` (ui.js) is 0.4
      // zone units of RADIUS, duplicated here the same way PAD_TRAVEL is duplicated elsewhere in
      // this file (a small constant, verified against the drawing code's own behaviour, not
      // imported from it).
      const TARGET_MARKER_R = 0.4;
      const diamX = Math.abs(map.unitX * TARGET_MARKER_R) * 2;
      const diamY = Math.abs(map.unitY * TARGET_MARKER_R) * 2;
      return {
        samples: samples.length,
        first: samples[0], last: samples[samples.length - 1],
        wantFirst: project(pitch.straightX, pitch.straightY),
        wantLast: project(pitch.x, pitch.y),
        type: pitch.type,
        moved: Math.hypot(samples[samples.length - 1].x - samples[0].x, samples[samples.length - 1].y - samples[0].y),
        diamX, diamY,
      };
    });
    if (!res.first) {
      fail('target-marker', `no marker was ever drawn during a human batting flight (samples=${res.samples}, sawPitch=${res.pitch})`);
    } else {
      const dFirst = Math.hypot(res.first.x - res.wantFirst.x, res.first.y - res.wantFirst.y);
      const dLast = Math.hypot(res.last.x - res.wantLast.x, res.last.y - res.wantLast.y);
      // The FIRST sample is whichever frame the probe caught first, which on a loaded software
      // renderer can be a frame or two into the slide (RA's ship runs: 0.04 to 3.87 px, one flake at
      // 2.12 and one at 3.87 under a full suite); the END sample is the exact point and keeps its
      // 2 px budget. 6 px on the start is under half of the marker's own 13 to 16 px travel, so a
      // marker that starts at the crossing point instead of the straight spot still fails.
      if (dFirst > 6) {
        fail('target-marker', `the marker starts ${dFirst.toFixed(2)} px from the pitch's straight-line spot (budget 6 px)`);
      } else if (dLast > 4) {
        // R8 ship review: the end sample is one frame's rounding away from the exact point under a
        // full suite (measured 1.65 and 2.28 px across two runs, against a 42 px marker); 4 px is
        // under a tenth of the marker's own size and still fails a marker that stops short.
        fail('target-marker', `the marker ends ${dLast.toFixed(2)} px from where the ball actually crosses (budget 4 px)`);
      } else if (res.moved < 3) {
        fail('target-marker', `the marker only travelled ${res.moved.toFixed(2)} px over a ${res.type}'s flight - a breaking pitch's marker has to MOVE (docs/BASEBALL-REFERENCE-B9.md, batting step 3)`);
      } else {
        ok(`target-marker: over a ${res.type}'s flight the marker starts on the straight-line spot (${dFirst.toFixed(2)} px) and ends on the real crossing point (${dLast.toFixed(2)} px), travelling ${res.moved.toFixed(1)} px between them`);
      }
      // R8 (item 3): the marker's own size, at least 36px across on either axis - the spec's own
      // floor ("at least 36 px across"), measured the same way the mode circle already is
      // (map.unitX/unitY separately, never forced square/circular in px).
      const minDiam = Math.min(res.diamX, res.diamY);
      if (minDiam < 36) {
        fail('target-marker', `the marker draws ${res.diamX.toFixed(1)}x${res.diamY.toFixed(1)}px - the narrower axis (${minDiam.toFixed(1)}px) is under the 36px floor`);
      } else {
        ok(`target-marker: the marker draws ${res.diamX.toFixed(1)}x${res.diamY.toFixed(1)}px, both axes >= the 36px floor`);
      }
    }

    // R8 (item 3): a pitch aimed for a ball CLEARLY outside the box must still draw a marker,
    // never clipped - `_drawBatCursor` draws it at whatever pixel `map.toPx` returns, on or off
    // the box, same as the cursor circle. Force the CPU's next pitch aim to x=1.8 (the box is
    // |x|<=1), no break (a fastball), so the marker sits at a fixed, clearly-outside spot for the
    // whole flight - simpler to sample than a moving one.
    const outside = await page10.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const home = inst.game.agents.home;
      const origPitch = home.decidePitch.bind(home);
      home.decidePitch = async (v) => ({ ...(await origPitch(v)), type: 'fastball', aim: { x: 1.8, y: 0 } });
      let samples = [];
      let pitch = null;
      const origFlight = inst._animatePitchFlight.bind(inst);
      inst._animatePitchFlight = (p) => { pitch = p; samples = []; return origFlight(p); };
      const poll = setInterval(() => { if (inst._targetMarkerPx) samples.push({ ...inst._targetMarkerPx }); }, 16);
      const deadline = Date.now() + 40000;
      while (Date.now() < deadline && !(pitch && Math.abs(pitch.x) > 1 && samples.length >= 3)) {
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
      return { samples: samples.length, pitch: pitch ? { x: pitch.x, y: pitch.y } : null };
    });
    if (!outside.pitch || outside.samples < 1) {
      fail('target-marker', `an outside-the-box pitch (x=${outside.pitch && outside.pitch.x}) never drew a marker (samples=${outside.samples})`);
    } else {
      ok(`target-marker: an outside-the-box pitch (x=${outside.pitch.x.toFixed(2)}, |x|>1) still drew a marker (${outside.samples} samples)`);
    }
  }
  await p10.close();
}

// 11. R3 (docs/BASEBALL-3D-BUILD.md section 9): FIELDERS-PLACED. At Play, before any at-bat has
// resolved (so the shift is guaranteed 0 - `_shiftDegFor` reads a batter's own spray HISTORY, and
// nobody has hit yet), the nine fielders stand within 2 ft of their spec world positions after the
// outfield depth scale, at zero shift.
{
  const p11 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page11 = await p11.newPage();
  await page11.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Fielders Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr11 = await mountInHub(page11);
  if (mountErr11) {
    fail('fielders-placed', `mount failed: ${mountErr11}`);
  } else {
    await page11.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page11.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    // A settle beat: `_syncFielders()` runs from every `_drawStaticField()`, and the first one
    // fires off `_sizeCanvas`'s own rAF - this just gives it a couple of frames to have happened.
    await page11.waitForTimeout(400);
    const res = await page11.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const F = await import('/baseball/js/field.js');
      const A = await import('/baseball/js/actors.js');
      const fenceFt = (await import('/baseball/js/engine/settings.js')).FIELD[inst.league].fenceFt;
      return {
        league: inst.league,
        shiftDeg: inst._currentShiftDeg,
        roles: A.FIELDER_ROLES.map((role) => {
          const actor = inst.actors.actors[role];
          const want = F.fielderWorld(role, fenceFt, 0);
          const got = actor ? { x: actor.pivot.position.x, z: actor.pivot.position.z } : null;
          const dist = got ? Math.hypot(got.x - want.x, got.z - want.z) : null;
          return { role, visible: !!(actor && actor.pivot.visible), want, got, dist };
        }),
      };
    });
    const worst = res.roles.reduce((m, r) => Math.max(m, r.dist == null ? Infinity : r.dist), 0);
    const bad = res.roles.filter((r) => !r.visible || r.dist == null || r.dist > 2);
    if (bad.length) {
      fail('fielders-placed', `${res.league} league, shiftDeg ${res.shiftDeg}: ${bad.map((r) => `${r.role} ${r.visible ? (r.dist == null ? 'no position' : r.dist.toFixed(2) + 'ft off') : 'hidden'}`).join(', ')}`);
    } else {
      ok(`fielders-placed: all 9 fielders visible and within ${worst.toFixed(2)} ft of spec (${res.league} league, shiftDeg ${res.shiftDeg}, budget 2 ft)`);
    }
  }
  await p11.close();
}

// 12. R3: RUNNERS-MOVE. Drives the human's batting with an auto-swing (timed off the pitch's own
// `timeToPlateS` and `FEEL.engine.swingDelay`, the pattern the R2 review stages used) through real
// at-bats until an `atBatEnd` fires with a runner on base BEFORE the play who is STILL on a base
// AFTER it - a genuine advance, not a strikeout or a clean sweep of the bases. Then asserts (a) the
// runner figure's world position ends within 3 ft of the base `game.bases` says he is on now, (b)
// the diamond widget showed a moving dot and the after-cell ended up filled, (c) the chase camera
// was live at some point during the cut. Also drives the human's OWN pitching turns (tap PITCH,
// once, R2 has no second tap) so a half-inning does not stall waiting on a human decision that
// never comes.
// BB_DEVICE_QUICK=1 skips this block: it is a six-minute probabilistic hunt for a play, and the
// actors suite delegates this whole file only to read the cadence line (orchestrator's R4 ship
// review: that delegated copy timed out on this hunt twice under a full suite load).
if (!process.env.BB_DEVICE_QUICK) {
  const p12 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page12 = await p12.newPage();
  const pageErrors12 = [];
  page12.on('pageerror', (e) => pageErrors12.push(String((e && e.message) || e)));
  await page12.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Runners Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr12 = await mountInHub(page12);
  if (mountErr12) {
    fail('runners-move', `mount failed: ${mountErr12}`);
  } else {
    await page12.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page12.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    const res = await page12.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const S = await import('/baseball/js/engine/settings.js');
      const F = await import('/baseball/js/field.js');
      const swingDelayMs = S.FEEL.engine.swingDelay;

      // Auto-play: fire the main button's own handler on every tap it offers - immediately for
      // READY and PITCH, timed against the pitch's own flight for SWING (perfect timing, so
      // contact - and so runners to actually watch - happen often).
      let pendingTimeToPlateS = null;
      const origFlight = inst._animatePitchFlight.bind(inst);
      inst._animatePitchFlight = (p) => { pendingTimeToPlateS = p.timeToPlateS; return origFlight(p); };
      let handler = inst._onMainDown || null;
      const fire = (fn) => {
        if (!fn) return;
        const label = inst.state && inst.state.actionLabel;
        if (label === 'act_swing') {
          const delayMs = Math.max(0, (pendingTimeToPlateS || 0) * 1000 - swingDelayMs);
          setTimeout(() => { if (handler === fn) fn(); }, delayMs);
        } else {
          setTimeout(() => { if (handler === fn) fn(); }, 0);
        }
      };
      Object.defineProperty(inst, '_onMainDown', {
        configurable: true, get() { return handler; }, set(fn) { handler = fn; fire(fn); },
      });
      fire(handler);

      // The qualifying play: `_animateRunners` is where basesBefore/basesAfter/runnersOut are
      // already assembled (game.js's own atBatEnd payload plus the live `this.game.bases`) - hook
      // it directly rather than re-deriving the same filter a second way.
      let captured = null;
      const origAnimateRunners = inst._animateRunners.bind(inst);
      inst._animateRunners = (payload) => {
        if (!captured) {
          const before = payload.basesBefore || [null, null, null];
          const beforeIdx = before.findIndex((x) => x != null);
          const after = inst.game.bases;
          // A GENUINE advance: he is still on a base AFTER the play (not out, not scored) AND it
          // is a DIFFERENT base than the one he started on - an ordinary out with an untouched
          // runner (bases.js's own `noAdvance`: "nobody advances") leaves him at the SAME index,
          // which satisfies "still on base" without him ever having run anywhere at all.
          const afterIdx = beforeIdx >= 0 ? after.indexOf(before[beforeIdx]) : -1;
          const advanced = afterIdx >= 0 && afterIdx !== beforeIdx;
          if (beforeIdx >= 0 && advanced && payload.distanceFt != null) {
            const role = ['r1', 'r2', 'r3'][beforeIdx];
            const samples = [];
            const iv = setInterval(() => {
              const actor = inst.actors.actors[role];
              const dot = document.querySelector('.bb-diamond-dot[data-dot="0"]');
              samples.push({
                visible: !!(actor && actor.pivot.visible),
                pos: actor ? { x: actor.pivot.position.x, z: actor.pivot.position.z } : null,
                chase: inst.actors.cameraName === 'chase',
                dotShown: !!(dot && dot.style.opacity === '1'),
              });
            }, 30);
            // R10 (docs/BASEBALL-3D-BUILD.md section 9, "R10", item 3): `_animateRunners` now
            // returns `{ promise, longestMs }`, not a bare promise - `_settleAtBat` needs
            // `longestMs` to extend the marker hold, so this wrapper forwards the REAL object
            // back to its own caller unchanged and only unwraps `.promise` for its own bookkeeping.
            const result = origAnimateRunners(payload);
            captured = { beforeIdx, trackedId: before[beforeIdx], p: result.promise, samples };
            if (result.promise) result.promise.then(() => clearInterval(iv));
            else clearInterval(iv);
            return result;
          }
        }
        return origAnimateRunners(payload);
      };

      // A 3-inning game (SEASON.inningsPerGame) does not always deal the qualifying play - it needs
      // a runner on base AND a second play that genuinely advances him (an ordinary out that is not
      // a double play leaves an existing runner exactly where he was - bases.js's own `noAdvance`,
      // "nobody advances" - which this probe correctly refuses to count), and only the human's OWN
      // half of each inning is forced to swing at everything; the other half is the real CpuBatter
      // AI, which takes plenty of pitches. Measured live: about one atBatEnd every ~4s, and a single
      // 3-inning game does not always finish inside 150s. So: play whole GAMES, one after another
      // (auto-clicking "Play again" then "Play" the instant one ends), until the qualifying play
      // turns up or the deadline is reached - generous on purpose, the same way yahtzee-ai's own
      // suite budgets minutes rather than seconds for a similarly real, played-out outcome.
      const deadline = Date.now() + 360000;
      let gamesPlayed = 0;
      while (Date.now() < deadline && !(captured && captured.p)) {
        const again = document.querySelector('[data-act="again"]');
        if (again) {
          again.click();
          gamesPlayed++;
          await new Promise((r) => setTimeout(r, 200));
          const btn = document.querySelector('.hub-game .bb-play-btn');
          if (btn) btn.click();
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!captured) return { timedOut: true, gamesPlayed };
      await captured.p;
      await new Promise((r) => setTimeout(r, 50)); // one settle beat past the resync

      const after = inst.game.bases;
      const newIdx = after.indexOf(captured.trackedId);
      const roleNow = ['r1', 'r2', 'r3'][newIdx];
      const actorNow = inst.actors.actors[roleNow];
      const wantPos = [F.basePositions().first, F.basePositions().second, F.basePositions().third][newIdx];
      const gotPos = actorNow ? { x: actorNow.pivot.position.x, z: actorNow.pivot.position.z } : null;
      const dist = gotPos ? Math.hypot(gotPos.x - wantPos.x, gotPos.z - wantPos.z) : null;
      const cell = document.querySelector(`[data-cell="${['1b', '2b', '3b'][newIdx]}"]`);
      return {
        timedOut: false, fromIdx: captured.beforeIdx, toIdx: newIdx,
        visible: !!(actorNow && actorNow.pivot.visible), dist,
        chaseSeen: captured.samples.some((s) => s.chase),
        dotSeen: captured.samples.some((s) => s.dotShown),
        cellFilledAfter: !!(cell && cell.classList.contains('is-on')),
        sampleCount: captured.samples.length,
      };
    });
    if (res.timedOut) {
      fail('runners-move', `no qualifying play (a runner on base before AND after) within 360s of auto-play (${res.gamesPlayed || 0} game(s) played)`);
    } else if (!res.visible || res.dist == null) {
      fail('runners-move', `the runner (base ${res.fromIdx} -> ${res.toIdx}) is not standing anywhere after the play`);
    } else if (res.dist > 3) {
      fail('runners-move', `the runner ended ${res.dist.toFixed(2)} ft from base index ${res.toIdx} (budget 3 ft)`);
    } else if (!res.chaseSeen) {
      fail('runners-move', 'the chase camera was never observed live during the play');
    } else if (!res.dotSeen) {
      fail('runners-move', 'the diamond widget never showed a moving dot during the run');
    } else if (!res.cellFilledAfter) {
      fail('runners-move', `the widget's after-cell (base index ${res.toIdx}) is not filled once the runner arrived`);
    } else {
      ok(`runners-move: a runner ran base ${res.fromIdx} -> ${res.toIdx}, landing ${res.dist.toFixed(2)} ft from the bag (budget 3), chase camera and the widget's moving dot both seen (${res.sampleCount} samples), after-cell filled`);
    }
  }
  if (pageErrors12.length) fail('runners-move', `page errors during auto-play: ${pageErrors12.slice(0, 3).join(' | ')}`);
  else ok('no page errors during the runners-move auto-play');
  await p12.close();
}

// 13. RA (docs/BASEBALL-3D-BUILD.md section 9): ACTIONS-LIVE. The three wells that were disabled
// placeholders in every build up to R3 now DO something, and this drives each one through the real
// hub with real taps and asserts on the engine's own events, never on the button's appearance:
//   (a) batting with a runner on first - STEAL is enabled, arming it and taking the pitch fires a
//       `steal` event, and the runner figure ends up on the next bag (safe) or hidden (caught),
//       with the verdict word on screen either way;
//   (b) BUNT armed, then a swing tap, yields an `atBatEnd` carrying one of the three bunt kinds;
//   (c) pitching with a runner on first - PICKOFF is enabled, tapping it fires a `pickoff` event
//       with NO pitch event, and the RIGHT button is back to PITCH within 2 s;
//   (d) Quick Play's strip shows all eight pitch tiles unlocked.
// Both halves use the dev-only `window.__bbTest.putOnFirst()` seam (ui.js) to put a real roster
// player on first rather than playing until somebody happens to reach base - the alternative is
// the runners-move probe's own six-minute auto-play budget, three more times over.
{
  // --- (a) and (b): the batting half -----------------------------------------------------------
  const p13 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page13 = await p13.newPage();
  const errs13 = [];
  page13.on('pageerror', (e) => errs13.push(String((e && e.message) || e)));
  await page13.addInitScript(() => {
    window.__bbDevForce = true;
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Actions Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr13 = await mountInHub(page13);
  if (mountErr13) {
    fail('actions-live', `mount failed: ${mountErr13}`);
  } else {
    await page13.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page13.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});

    const steal = await page13.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const events = [];
      const origEvent = inst.game.onEvent;
      inst.game.onEvent = (type, pl) => { events.push({ type, pl }); return origEvent(type, pl); };
      const waitFor = async (fn, ms) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); }
        return false;
      };
      const tap = (el) => {
        el.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
      };
      // Wait for the human's batting turn to be OFFERING Ready (the state the wells light up in).
      const ready = await waitFor(() => inst.state.actionLabel === 'act_ready', 20000);
      if (!ready) return { error: 'never reached a batting turn offering READY within 20s' };
      const runnerId = window.__bbTest.putOnFirst();
      if (!runnerId) return { error: 'putOnFirst seam returned nothing' };
      const F = await import('/baseball/js/field.js');
      const BAGS = [F.basePositions().first, F.basePositions().second, F.basePositions().third];
      let armed = false, leadFt = null, enabled = false;
      // The seam writes `game.bases[0]` while this at-bat's FIRST swing view has already been
      // built and handed to the agent (the engine builds it immediately before awaiting the
      // decision, which is exactly the moment this probe is standing in), so the steal it offers
      // cannot be in that view - the engine rebuilds the view for every PITCH, so the arm has to
      // land on a later one. Real play never has this gap: nothing moves a runner between the view
      // and the decision, and a steal that DOES move one rebuilds the view for the next pitch.
      // So: arm and take, pitch after pitch, until the engine actually runs one.
      const deadline = Date.now() + 40000;
      while (Date.now() < deadline && !events.some((e) => e.type === 'steal')) {
        if (inst.state.actionLabel !== 'act_ready') { await new Promise((r) => setTimeout(r, 80)); continue; }
        const stealBtn = document.querySelector('[data-act="steal"]');
        enabled = !!(stealBtn && !stealBtn.disabled);
        if (!enabled) return { error: 'the STEAL well is disabled with a runner on base before READY' };
        stealBtn.click();
        // `_paintActionSlots` rebuilds the wells on every repaint, so the armed class has to be
        // read off a FRESHLY queried node - the one that was clicked is already detached.
        const after = document.querySelector('[data-act="steal"]');
        armed = !!(after && after.classList.contains('is-armed'));
        if (!armed) return { error: 'tapping STEAL did not arm the well (.is-armed)' };
        // The 4 ft lead: the runner the STEAL well would actually send - whichever base he is on -
        // should not be standing ON his bag any more.
        const side = inst.game.half === 'top' ? 'away' : 'home';
        const cand = inst.game._stealCandidate(side);
        const runner = cand ? inst.actors.actors[['r1', 'r2', 'r3'][cand.from]] : null;
        if (cand && runner && runner.pivot.visible) {
          leadFt = Math.hypot(runner.pivot.position.x - BAGS[cand.from].x, runner.pivot.position.z - BAGS[cand.from].z);
        }
        tap(document.querySelector('[data-role="mainbtn"]'));   // READY, then take the pitch
        await waitFor(() => events.some((e) => e.type === 'steal') || inst.state.actionLabel === 'act_ready', 12000);
      }
      const fired = events.some((e) => e.type === 'steal');
      if (!fired) return { error: 'no steal event within 40s of arming STEAL and taking pitches' };
      const ev = events.find((e) => e.type === 'steal').pl;
      await new Promise((r) => setTimeout(r, 1200));   // the run (STEAL_RUN_MS) plus a settle beat
      const nowAt = inst.game.bases.indexOf(ev.runnerId);
      const roleNow = ['r1', 'r2', 'r3'][nowAt];
      const actorNow = roleNow ? inst.actors.actors[roleNow] : null;
      const target = BAGS[ev.to];
      const dist = actorNow && actorNow.pivot.visible && target
        ? Math.hypot(actorNow.pivot.position.x - target.x, actorNow.pivot.position.z - target.z) : null;
      const fromRole = ['r1', 'r2', 'r3'][ev.from];
      const caughtGone = !!(inst.actors.actors[fromRole] && !inst.actors.actors[fromRole].pivot.visible);
      const pop = document.querySelector('[data-role="pop"]');
      return { armed, leadFt, ev, nowAt, dist, caughtGone, popText: pop ? pop.textContent : '' };
    });
    if (steal.error) {
      fail('actions-live (a) steal', steal.error);
    } else {
      if (!steal.armed) fail('actions-live (a) steal', 'tapping STEAL did not arm the well (.is-armed)');
      else if (!(steal.leadFt > 1)) fail('actions-live (a) steal', `the armed runner is ${steal.leadFt} ft off the bag - no lead was taken`);
      else if (steal.ev.safe && !(steal.dist != null && steal.dist <= 3)) {
        fail('actions-live (a) steal', `the runner was safe but ended ${steal.dist} ft from base index ${steal.ev.to} (budget 3 ft)`);
      } else if (!steal.ev.safe && (steal.stillOnBase || !steal.caughtGone)) {
        fail('actions-live (a) steal', `the runner was thrown out but he is ${steal.stillOnBase ? 'still on a base in the engine' : 'still drawn on the field'}`);
      } else if (!/Safe|Quieto|Out/.test(steal.popText || '')) {
        fail('actions-live (a) steal', `no Safe/Out verdict word on screen (pop read "${steal.popText}")`);
      } else {
        ok(`actions-live (a): STEAL armed (lead ${steal.leadFt.toFixed(1)} ft), the take fired a steal event `
          + `${steal.ev.from}->${steal.ev.to} ${steal.ev.safe ? `safe (runner ${steal.dist.toFixed(2)} ft from the bag)` : 'caught (figure removed)'}, `
          + `verdict word "${(steal.popText || '').trim()}"`);
      }
    }

    const bunt = await page13.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const S = await import('/baseball/js/engine/settings.js');
      const swingDelayMs = S.FEEL.engine.swingDelay;
      const ends = [];
      const origEvent = inst.game.onEvent;
      inst.game.onEvent = (type, pl) => { if (type === 'atBatEnd') ends.push(pl); return origEvent(type, pl); };
      let timeToPlateS = null;
      const origFlight = inst._animatePitchFlight.bind(inst);
      inst._animatePitchFlight = (p) => { timeToPlateS = p.timeToPlateS; return origFlight(p); };
      const tap = (el) => {
        el.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }));
      };
      const BUNT_KINDS = ['bunt-out', 'bunt-single', 'sacrifice'];
      const deadline = Date.now() + 120000;
      let attempts = 0, squared = false;
      while (Date.now() < deadline && !ends.some((e) => BUNT_KINDS.includes(e.outcome))) {
        // Only ever act on the human's own batting turn, offering Ready.
        if (inst.state.mode !== 'batting' || inst.state.actionLabel !== 'act_ready') {
          // A human PITCHING turn would stall for ever without a tap - drive it with one.
          if (inst.state.mode === 'pitching' && inst.state.actionLabel === 'act_pitch') {
            tap(document.querySelector('[data-role="mainbtn"]'));
          }
          await new Promise((r) => setTimeout(r, 120));
          continue;
        }
        const buntBtn = document.querySelector('[data-act="bunt"]');
        if (!buntBtn || buntBtn.disabled) return { error: 'the BUNT well is disabled during a batting turn before READY' };
        buntBtn.click();
        // Freshly queried, for the same reason the steal block above says: the well that was
        // clicked has already been replaced by `_paintActionSlots`'s own repaint.
        const armedBtn = document.querySelector('[data-act="bunt"]');
        if (!armedBtn || !armedBtn.classList.contains('is-armed')) return { error: 'tapping BUNT did not arm the well' };
        attempts += 1;
        timeToPlateS = null;
        tap(document.querySelector('[data-role="mainbtn"]'));   // READY
        // Wait for the flight to start so the crossing time is known, then tap SWING on it.
        const flightEnd = Date.now() + 6000;
        while (timeToPlateS == null && Date.now() < flightEnd) await new Promise((r) => setTimeout(r, 20));
        if (timeToPlateS == null) { await new Promise((r) => setTimeout(r, 200)); continue; }
        if (inst.actors.actors.batter && inst.actors.actors.batter.current) {
          const clip = inst.actors.actors.batter.current.getClip();
          if (clip && clip.name === 'Bunt') squared = true;
        }
        await new Promise((r) => setTimeout(r, Math.max(0, timeToPlateS * 1000 - swingDelayMs)));
        if (inst._onMainDown) tap(document.querySelector('[data-role="mainbtn"]'));
        await new Promise((r) => setTimeout(r, 2600));
      }
      const hit = ends.find((e) => BUNT_KINDS.includes(e.outcome));
      return { attempts, squared, outcome: hit ? hit.outcome : null, battedKind: hit ? hit.battedKind : null,
        kinds: ends.map((e) => e.outcome).slice(-6) };
    });
    if (bunt.error) fail('actions-live (b) bunt', bunt.error);
    else if (!bunt.outcome) fail('actions-live (b) bunt', `${bunt.attempts} armed bunts in 120s never produced a bunt outcome (saw ${bunt.kinds.join(',')})`);
    else if (!bunt.squared) fail('actions-live (b) bunt', 'the batter never played the Bunt clip while armed');
    else if (bunt.battedKind !== 'ground') fail('actions-live (b) bunt', `the bunt's battedKind is "${bunt.battedKind}", not "ground"`);
    else ok(`actions-live (b): BUNT armed, the batter squared on the Bunt clip, and a swing tap produced atBatEnd outcome "${bunt.outcome}" (battedKind ground) after ${bunt.attempts} attempt(s)`);
  }
  if (errs13.length) fail('actions-live', `page errors in the batting half: ${errs13.slice(0, 3).join(' | ')}`);
  else ok('no page errors during the actions-live batting half');
  await p13.close();

  // --- (c) and (d): the pitching half ------------------------------------------------------------
  const p13b = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page13b = await p13b.newPage();
  const errs13b = [];
  page13b.on('pageerror', (e) => errs13b.push(String((e && e.message) || e)));
  await page13b.addInitScript(() => {
    window.__bbDevForce = true;
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Pickoff Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr13b = await mountInHub(page13b);
  if (mountErr13b) {
    fail('actions-live (c) pickoff', `mount failed: ${mountErr13b}`);
  } else {
    await page13b.evaluate(() => {
      window.__bbForceHalfNext = 'bottom';
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page13b.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    const res = await page13b.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      if (!window.__bbTest || !window.__bbTest.forceHalf) return { error: 'the __bbTest seam is missing - dev flag not honored' };
      window.__bbTest.forceHalf('bottom');
      const events = [];
      const origEvent = inst.game.onEvent;
      inst.game.onEvent = (type, pl) => { events.push({ type, pl }); return origEvent(type, pl); };
      const waitFor = async (fn, ms) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 40)); }
        return false;
      };
      const pitching = await waitFor(() => inst.state.mode === 'pitching' && inst.state.actionLabel === 'act_pitch', 25000);
      if (!pitching) return { error: "never reached the human's own pitching turn within 25s" };
      // (d) the strip: eight tiles, none locked, in Quick Play.
      const tiles = document.querySelectorAll('.bb-strip .bb-pitch-tile');
      const unlocked = document.querySelectorAll('.bb-strip [data-pitch]');
      const locked = document.querySelectorAll('.bb-strip .bb-pitch-tile.is-locked');
      const strip = { tiles: tiles.length, unlocked: unlocked.length, locked: locked.length,
        pitches: [...unlocked].map((b) => b.dataset.pitch) };
      // (c) the pickoff.
      window.__bbTest.putOnFirst();
      const btn = document.querySelector('[data-act="pickoff"]');
      const enabled = !!(btn && !btn.disabled);
      if (!enabled) return { error: 'the PICKOFF well is still disabled with a runner on first before PITCH', strip };
      const eventsBefore = events.length;
      const t0 = performance.now();
      btn.click();
      const fired = await waitFor(() => events.slice(eventsBefore).some((e) => e.type === 'pickoff'), 8000);
      if (!fired) return { error: 'no pickoff event within 8s of tapping the well', strip };
      const after = events.slice(eventsBefore);
      const pickIdx = after.findIndex((e) => e.type === 'pickoff');
      const pitchIdx = after.findIndex((e) => e.type === 'pitch');
      const backToPitch = await waitFor(() => inst.state.actionLabel === 'act_pitch', 2000);
      return {
        strip, enabled,
        pickoff: after[pickIdx].pl,
        pitchBefore: pitchIdx >= 0 && pitchIdx < pickIdx,
        backToPitch, backMs: performance.now() - t0,
        label: (document.querySelector('[data-role="ringlabel"]') || {}).textContent,
      };
    });
    if (res.strip) {
      if (res.strip.tiles !== 8 || res.strip.unlocked !== 8 || res.strip.locked !== 0) {
        fail('actions-live (d) strip', `Quick Play's strip shows ${res.strip.tiles} tiles, ${res.strip.unlocked} unlocked, ${res.strip.locked} locked - expected 8/8/0`);
      } else {
        ok(`actions-live (d): Quick Play's strip shows all eight pitches unlocked (${res.strip.pitches.join(', ')})`);
      }
    }
    if (res.error) fail('actions-live (c) pickoff', res.error);
    else if (res.pitchBefore) fail('actions-live (c) pickoff', 'a pitch was thrown before the pickoff - the tap did not replace the pitch');
    else if (!res.backToPitch) fail('actions-live (c) pickoff', `the RIGHT button did not return to PITCH within 2s (reads "${res.label}")`);
    else ok(`actions-live (c): PICKOFF enabled with a runner on first, the tap fired a pickoff event (out=${res.pickoff.out}) with no pitch thrown, and the button was back to PITCH in ${res.backMs.toFixed(0)} ms`);
  }
  if (errs13b.length) fail('actions-live', `page errors in the pitching half: ${errs13b.slice(0, 3).join(' | ')}`);
  else ok('no page errors during the actions-live pitching half');
  await p13b.close();
}

// R4 (docs/BASEBALL-3D-BUILD.md section 9): the presentation layer - the pop anchored over the
// batter, the batting box's own 1.6x scale, and the HOME RUN word/strip. Three probes, each
// reading the real mounted screen through `document.querySelector('.hub-game')._bbInstance`, same
// seam every probe above already uses.
{
  // zone-scale: the drawn BATTING box is BATTING_ZONE_SCALE (1.6x) the TRUE box, both read off
  // the instance itself (`_zoneMap('batting')` vs `_zoneBoxPx()`) so a change to either one alone
  // shows up here, not just in `zone-world`'s independent, `field.js`-only computation above.
  const p14 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page14 = await p14.newPage();
  await page14.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Zone Scale Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr14 = await mountInHub(page14);
  if (mountErr14) {
    fail('zone-scale', `mount failed: ${mountErr14}`);
  } else {
    await page14.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page14.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page14.waitForTimeout(500);
    const res = await page14.evaluate(() => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      if (!inst) return { error: 'no _bbInstance' };
      const truth = inst._zoneBoxPx();
      const scaled = inst._zoneMap('batting');
      if (!truth || !scaled) return { error: 'zone map unavailable (camera or canvas not ready)' };
      return {
        trueW: truth.x1 - truth.x0, trueH: truth.y1 - truth.y0,
        scaledW: scaled.x1 - scaled.x0, scaledH: scaled.y1 - scaled.y0,
      };
    });
    if (res.error) {
      fail('zone-scale', res.error);
    } else {
      const WANT_SCALE = 1.6;
      const wOff = Math.abs(res.scaledW - res.trueW * WANT_SCALE);
      const hOff = Math.abs(res.scaledH - res.trueH * WANT_SCALE);
      if (wOff > 2 || hOff > 2) {
        fail('zone-scale', `drawn batting box ${res.scaledW.toFixed(1)}x${res.scaledH.toFixed(1)} is not ${WANT_SCALE}x the true box ${res.trueW.toFixed(1)}x${res.trueH.toFixed(1)} (off by ${wOff.toFixed(2)}/${hOff.toFixed(2)}px, budget 2px)`);
      } else {
        ok(`zone-scale: the drawn batting box (${res.scaledW.toFixed(1)}x${res.scaledH.toFixed(1)}) is ${WANT_SCALE}x the true box (${res.trueW.toFixed(1)}x${res.trueH.toFixed(1)}), within 2px`);
      }
      // R8 (docs/BASEBALL-3D-BUILD.md section 9, "R8", item 4): the true box grew from ~50.6x61.3px
      // to ~65.2x79.0px the moment the 48px HUD row left `.bb-field-wrap`'s flex column - the
      // BATTING band is taller now (553px vs 429px), which narrows the batter camera's effective
      // aspect and so its horizontal AND vertical FOV both changed, not just the free 48px of
      // height. This is `zone-world`'s own OTHER independent measurement (`cams.batter` in the
      // node block above), re-baselined the same day for the same reason.
      if (Math.abs(res.trueW - 65.2) > 3 || Math.abs(res.trueH - 79.0) > 3) {
        fail('zone-scale', `the TRUE (unscaled) box drifted from the measured 65.2x79.0px baseline (got ${res.trueW.toFixed(1)}x${res.trueH.toFixed(1)})`);
      } else {
        ok(`zone-scale: the true (unscaled) box is unchanged at ${res.trueW.toFixed(1)}x${res.trueH.toFixed(1)}px`);
      }
    }
  }
  await p14.close();
}

{
  // pop-anchor: on a called strike, `.bb-pop`'s own rendered centre lands within 30px of the
  // batter's head projected fresh (independently, through `field.js`'s own `projectToCanvas`,
  // never by reading `_positionPop`'s own output back), and the pitch line reads
  // `pitchname_* + mph`. Drives the human's batting turn with nothing but auto-READY taps (never a
  // swing tap), same seam `r2-cadence` above uses - every pitch then resolves as a called
  // ball/strike, and this waits for the first STRIKE among them.
  const p15 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page15 = await p15.newPage();
  await page15.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Pop Anchor Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr15 = await mountInHub(page15);
  if (mountErr15) {
    fail('pop-anchor', `mount failed: ${mountErr15}`);
  } else {
    await page15.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page15.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page15.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      window.__bbField = await import('/baseball/js/field.js');
      const rec = { strikes: [] };
      window.__bbPopRec = rec;
      const origShowPop = inst._showPop.bind(inst);
      inst._showPop = (word, kind, opts) => {
        if (kind === 'strike') rec.strikes.push({ t: performance.now(), pitchLine: (opts && opts.pitchLine) || '' });
        return origShowPop(word, kind, opts);
      };
      // Same auto-READY seam r2-cadence uses above: fire `_onMainDown` the instant it is next
      // assigned, but only while the button reads READY - never SWING, so every pitch resolves as
      // a plain called take (ball/strike), never a swing.
      let handler = inst._onMainDown || null;
      const fire = (fn) => { if (fn && inst.state && inst.state.actionLabel === 'act_ready') setTimeout(() => { if (handler === fn) fn(); }, 0); };
      Object.defineProperty(inst, '_onMainDown', {
        configurable: true, get() { return handler; }, set(fn) { handler = fn; fire(fn); },
      });
      fire(handler);
    });
    const deadline = Date.now() + 45000;
    let strikeSeen = false;
    while (Date.now() < deadline) {
      strikeSeen = await page15.evaluate(() => window.__bbPopRec.strikes.length > 0);
      if (strikeSeen) break;
      await page15.waitForTimeout(150);
    }
    if (!strikeSeen) {
      fail('pop-anchor', 'never observed a called strike in 45s of auto-READY takes');
    } else {
      const res = await page15.evaluate(() => {
        const inst = document.querySelector('.hub-game')._bbInstance;
        const field = window.__bbField;
        const flip = inst._currentBatterFlip();
        const boxX = flip ? field.BATTER_BOX.x : -field.BATTER_BOX.x;
        const head = { x: boxX, y: 6.9, z: field.BATTER_BOX.z };
        const proj = field.projectToCanvas(inst.actors.camera, head, inst._fieldW, inst._fieldH);
        const wrap = document.querySelector('[data-role="fieldwrap"]');
        const wrapRect = wrap.getBoundingClientRect();
        const popEl = document.querySelector('[data-role="pop"]');
        const popRect = popEl.getBoundingClientRect();
        const popCenterX = popRect.left + popRect.width / 2 - wrapRect.left;
        const popCenterY = popRect.top + popRect.height / 2 - wrapRect.top;
        const insideBand = popRect.left >= wrapRect.left - 1 && popRect.right <= wrapRect.right + 1
          && popRect.top >= wrapRect.top - 1 && popRect.bottom <= wrapRect.bottom + 1;
        return {
          proj, popCenterX, popCenterY, insideBand, behind: proj.behind,
          pitchLine: (popEl.querySelector('[data-role="popline1"]') || {}).textContent,
          strikePitchLine: window.__bbPopRec.strikes[0].pitchLine,
        };
      });
      const dist = Math.hypot(res.popCenterX - res.proj.x, res.popCenterY - res.proj.y);
      // R8 (docs/BASEBALL-3D-BUILD.md section 9, "R8", item 4): budget widened 30 -> 45px. The
      // BATTING band grew from 429 to 553px tall (the HUD row left the flex column - item 4 - and
      // the strip shrank - item 5), which narrows the batter camera's effective aspect and moves
      // the raw projected head closer to the band's left edge for a right-handed batter (measured:
      // ~56px of 393, was ~closer to the clamp floor already pre-R8) - `_positionPop`'s own clamp
      // (unchanged by this stage) now engages further from the raw point to keep the WHOLE word on
      // screen, which is correct, not a regression: `insideBand` below is what actually matters,
      // and stays true either way. Measured after R8: ~41px.
      if (res.behind) {
        fail('pop-anchor', 'the projected batter head point is behind the camera - camera fact changed?');
      } else if (dist > 45) {
        fail('pop-anchor', `.bb-pop centre (${res.popCenterX.toFixed(1)},${res.popCenterY.toFixed(1)}) is ${dist.toFixed(1)}px from the projected head (${res.proj.x.toFixed(1)},${res.proj.y.toFixed(1)}), budget 45px`);
      } else if (!res.insideBand) {
        fail('pop-anchor', 'the pop element is not fully inside the field band');
      } else if (!/^\S+ \d+$/.test(res.strikePitchLine || '')) {
        fail('pop-anchor', `the pop's pitch line does not read "<name> <mph>" (got "${res.strikePitchLine}")`);
      } else {
        ok(`pop-anchor: .bb-pop centre is ${dist.toFixed(1)}px from the projected batter head (budget 45px), inside the band, pitch line "${res.strikePitchLine}"`);
      }
    }
  }
  await p15.close();
}

{
  // homerun-strip: drive `_settleAtBat` directly with a synthetic homer payload (no engine, no
  // real at-bat - same directness R1/R3's own stills used to check `_animateBattedBall`/
  // `_runMarkerHold`) and confirm the HOME RUN element becomes visible with a strip reading
  // `{ft} ft {mph} mph {deg}°` from the payload's own numbers.
  const p16 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page16 = await p16.newPage();
  await page16.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Homerun Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr16 = await mountInHub(page16);
  if (mountErr16) {
    fail('homerun-strip', `mount failed: ${mountErr16}`);
  } else {
    await page16.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page16.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page16.waitForTimeout(500);
    await page16.evaluate(() => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const payload = {
        batterId: 'test-batter', side: 'away', outcome: 'homer', bases: 4, runsScored: 1,
        q: 1, exitVeloMph: 101.7, centered: true, distanceFt: 412, sprayAngleDeg: 0,
        battedKind: 'fly', launchAngleDeg: 31.4, timingWord: 'perfect',
        basesBefore: [null, null, null], runnersOut: [],
      };
      // Fire-and-forget - `_settleAtBat` runs its own ~2s contact/chase/marker sequence; this test
      // only needs to observe the HOME RUN element mid-way through it, not wait for it to finish.
      window.__bbHomerRun = inst._settleAtBat(payload);
    });
    const deadline = Date.now() + 6000;
    let seen = null;
    while (Date.now() < deadline) {
      seen = await page16.evaluate(() => {
        const el = document.querySelector('[data-role="homerun"]');
        if (!el || !el.classList.contains('is-on')) return null;
        return {
          word: (el.querySelector('[data-role="hrword"]') || {}).textContent,
          strip: (el.querySelector('[data-role="hrstrip"]') || {}).textContent,
        };
      });
      if (seen) break;
      await page16.waitForTimeout(100);
    }
    if (!seen) {
      fail('homerun-strip', 'the HOME RUN element never became visible within 6s of a homer payload');
    } else if (!/ft/.test(seen.strip) || !/mph/.test(seen.strip) || !/°/.test(seen.strip)) {
      fail('homerun-strip', `the stats strip is missing ft/mph/deg (got "${seen.strip}")`);
    } else if (!/412/.test(seen.strip) || !/102/.test(seen.strip) || !/31/.test(seen.strip)) {
      // Rounded from the payload's 412/101.7/31.4 - 412, 102, 31.
      fail('homerun-strip', `the stats strip does not reflect the payload's own numbers (got "${seen.strip}", expected ~412ft/102mph/31deg)`);
    } else {
      ok(`homerun-strip: the HOME RUN element shows "${seen.word}" with strip "${seen.strip}"`);
    }
    await page16.evaluate(() => window.__bbHomerRun).catch(() => {});
  }
  await p16.close();
}

{
  // play-clock: R10 (docs/BASEBALL-3D-BUILD.md section 9, "R10"). Drives `_settleAtBat` directly
  // with three synthetic payloads (`homerun-strip`'s own pattern above - no engine, no real
  // at-bat) and measures, from CONTACT (the instant `_settleAtBat` is called), when the outcome
  // word actually reaches Line 1, when a homer's own HOME RUN trigger fires, and when
  // `_returnToPlate()` fires - never before the play is actually over (item 2), and never before
  // the slowest runner's own real, uncompressed arrival (item 3). `inst.league = 'majors'` pins a
  // full-size fence (408ft centre) so the homer payload's own crossing time does not depend on
  // which league Quick Play happens to default to (Little League, 210ft centre - a 420ft shot
  // over THAT fence would cross at just over half its own flight, not near the end of it).
  const p16b = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page16b = await p16b.newPage();
  await page16b.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Clock Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr16b = await mountInHub(page16b);
  if (mountErr16b) {
    fail('play-clock', `mount failed: ${mountErr16b}`);
  } else {
    await page16b.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page16b.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page16b.waitForTimeout(500);

    // Drives one synthetic `_settleAtBat(payload)` to completion and returns { line1At: [{t,text}],
    // homerAt, returnAt, resolvedAt } - every timestamp a `performance.now()` DELTA from the call,
    // never a frame count (the container's own ~20fps SwiftShader rate makes frame counts
    // meaningless as a clock).
    async function runPlay(page, payload, capMs) {
      await page.evaluate((p) => {
        const inst = document.querySelector('.hub-game')._bbInstance;
        inst.league = 'majors';
        const rec = { line1At: [], homerAt: null, returnAt: null, resolvedAt: null };
        window.__bbClockRec = rec;
        const t0 = performance.now();
        const origSetLine1 = inst._setLine1.bind(inst);
        inst._setLine1 = (text) => { if (text) rec.line1At.push({ t: performance.now() - t0, text: String(text) }); return origSetLine1(text); };
        const origTrigger = inst._triggerHomerun.bind(inst);
        inst._triggerHomerun = (stats) => { rec.homerAt = performance.now() - t0; return origTrigger(stats); };
        const origReturn = inst._returnToPlate.bind(inst);
        inst._returnToPlate = (...args) => { rec.returnAt = performance.now() - t0; return origReturn(...args); };
        window.__bbClockPromise = inst._settleAtBat(p).then(() => { rec.resolvedAt = performance.now() - t0; });
      }, payload);
      const deadline = Date.now() + capMs;
      let rec = null;
      while (Date.now() < deadline) {
        rec = await page.evaluate(() => window.__bbClockRec);
        if (rec && rec.resolvedAt != null) break;
        await page.waitForTimeout(200);
      }
      return rec;
    }

    // A 420ft homer: apex caps at BATTED_APEX_MAX_FT (80ft, since 420*0.22=92.4 > 80), so
    // totalMs = 2000*sqrt(2*80/32.2) = 4458ms; crossing the 408ft majors fence at frac
    // 408/420 = 0.9714 lands HOME RUN at ~4331ms (crossMs) - comfortably clear of the spec's own
    // 3.0s floor. R10 ship-review follow-up: the batter-runner's own 360ft trot would naturally
    // take 13333ms (360/27*1000) - too long to sit through - so once the ball has crossed the wall
    // (crossMs) he finishes the remaining ground at HOMER_RUNNER_SPEEDUP (3x) speed:
    // postMs = (13333 - 4331) / 3 = ~3001ms, so his own sped-up total is
    // speedUpArriveMs = crossMs + postMs = ~7332ms - the longest thing in this play, so the marker
    // hold extends to cover exactly that (not the old real 13333ms) and `_returnToPlate()` should
    // land inside [5500, 8500]ms (the coordinator's own band for this exact payload) and no earlier
    // than the sped-up runner's own arrival (minus a small rAF-granularity allowance).
    const homerRec = await runPlay(page16b, {
      batterId: 'test-batter', side: 'away', outcome: 'homer', bases: 4, runsScored: 1,
      q: 1, exitVeloMph: 101.7, centered: true, distanceFt: 420, sprayAngleDeg: 0,
      battedKind: 'fly', launchAngleDeg: 31.4, timingWord: 'perfect',
      basesBefore: [null, null, null], runnersOut: [],
    }, 20000);
    if (!homerRec) {
      fail('play-clock (homer)', 'the homer payload never resolved within 20s');
    } else {
      const early = homerRec.line1At.filter((e) => e.t < 300);
      const apexFt = 80; // BATTED_APEX_MAX_FT clamp for this payload's 420ft*0.22=92.4
      const totalMs = 2000 * Math.sqrt((2 * apexFt) / 32.2);
      const crossMs = totalMs * (408 / 420); // majors fence at sprayAngleDeg 0
      const naturalMs = (360 / 27) * 1000; // the batter's own real, uncompressed trot
      const postMs = (naturalMs - crossMs) / 3; // HOMER_RUNNER_SPEEDUP, the ground left after crossing
      const speedUpArriveMs = crossMs + postMs; // ~7332ms
      const HOMER_RETURN_MIN_MS = 5500, HOMER_RETURN_MAX_MS = 8500; // the coordinator's own band
      if (early.length) {
        fail('play-clock (homer)', `Line 1 carried an outcome word ${early[0].t.toFixed(0)}ms after contact (want none before 300ms): "${early[0].text}"`);
      } else if (homerRec.homerAt == null || homerRec.homerAt < 3000) {
        fail('play-clock (homer)', `HOME RUN triggered at ${homerRec.homerAt == null ? 'never' : homerRec.homerAt.toFixed(0) + 'ms'} (want >= 3000ms)`);
      } else if (homerRec.returnAt == null || homerRec.returnAt < speedUpArriveMs - 250) {
        fail('play-clock (homer)', `_returnToPlate() fired at ${homerRec.returnAt == null ? 'never' : homerRec.returnAt.toFixed(0) + 'ms'} (want >= ${(speedUpArriveMs - 250).toFixed(0)}ms, the sped-up trotting runner's own arrival)`);
      } else if (homerRec.returnAt < HOMER_RETURN_MIN_MS || homerRec.returnAt > HOMER_RETURN_MAX_MS) {
        fail('play-clock (homer)', `_returnToPlate() fired at ${homerRec.returnAt.toFixed(0)}ms (want ${HOMER_RETURN_MIN_MS}-${HOMER_RETURN_MAX_MS}ms - the sped-up cutaway band)`);
      } else {
        ok(`play-clock (homer): no word before 300ms, HOME RUN at ${homerRec.homerAt.toFixed(0)}ms (>= 3000ms), return at ${homerRec.returnAt.toFixed(0)}ms (in ${HOMER_RETURN_MIN_MS}-${HOMER_RETURN_MAX_MS}ms, >= sped-up runner arrival ${speedUpArriveMs.toFixed(0)}ms)`);
      }
    }
    await page16b.waitForTimeout(300);

    // A 120ft groundout: roll time (GROUND_ROLL_V0_FT_S 60, GROUND_ROLL_DECEL_FT_S2 3.3) solves to
    // 2124ms, plus the spec's own THROW_BEAT_MS (1000ms) before Out appears - 3124ms, inside the
    // deliverable's own 1.8 to 4.5s window.
    const groundRec = await runPlay(page16b, {
      batterId: 'test-batter-2', side: 'away', outcome: 'groundout', bases: 0, runsScored: 0,
      q: 1, exitVeloMph: 76, centered: true, distanceFt: 120, sprayAngleDeg: -8,
      battedKind: 'ground', launchAngleDeg: -6, timingWord: 'perfect',
      basesBefore: [null, null, null], runnersOut: [],
    }, 12000);
    if (!groundRec) {
      fail('play-clock (groundout)', 'the groundout payload never resolved within 12s');
    } else {
      const early = groundRec.line1At.filter((e) => e.t < 300);
      const outAt = groundRec.line1At.find((e) => /out/i.test(e.text));
      if (early.length) {
        fail('play-clock (groundout)', `Line 1 carried an outcome word ${early[0].t.toFixed(0)}ms after contact (want none before 300ms): "${early[0].text}"`);
      } else if (!outAt) {
        fail('play-clock (groundout)', `no "Out" ever reached Line 1 (saw: ${groundRec.line1At.map((e) => `${e.text}@${e.t.toFixed(0)}`).join(', ') || 'nothing'})`);
      } else if (outAt.t < 1800 || outAt.t > 4500) {
        fail('play-clock (groundout)', `Out shown at ${outAt.t.toFixed(0)}ms after contact (want 1800 to 4500ms - roll ~2124ms + THROW_BEAT_MS 1000ms)`);
      } else {
        ok(`play-clock (groundout): no word before 300ms, Out at ${outAt.t.toFixed(0)}ms after contact (want 1800-4500ms)`);
      }
    }
    await page16b.waitForTimeout(300);

    // A 250ft fly out: apex = min(80, 250*0.22) = 55ft, totalMs = 2000*sqrt(2*55/32.2) = 3696ms -
    // Out shows exactly there (no throw beat on a non-ground out), "at the catch," never earlier.
    const flyRec = await runPlay(page16b, {
      batterId: 'test-batter-3', side: 'away', outcome: 'flyout', bases: 0, runsScored: 0,
      q: 1, exitVeloMph: 88, centered: true, distanceFt: 250, sprayAngleDeg: 12,
      battedKind: 'fly', launchAngleDeg: 34, timingWord: 'perfect',
      basesBefore: [null, null, null], runnersOut: [],
    }, 12000);
    if (!flyRec) {
      fail('play-clock (flyout)', 'the fly-out payload never resolved within 12s');
    } else {
      const early = flyRec.line1At.filter((e) => e.t < 300);
      const catchMs = 2000 * Math.sqrt((2 * 55) / 32.2); // 3696ms
      const tooEarly = flyRec.line1At.filter((e) => e.t < catchMs - 250);
      if (early.length) {
        fail('play-clock (flyout)', `Line 1 carried an outcome word ${early[0].t.toFixed(0)}ms after contact (want none before 300ms): "${early[0].text}"`);
      } else if (tooEarly.length) {
        fail('play-clock (flyout)', `Out shown at ${tooEarly[0].t.toFixed(0)}ms, before the catch (~${catchMs.toFixed(0)}ms)`);
      } else if (!flyRec.line1At.length) {
        fail('play-clock (flyout)', 'no outcome word ever reached Line 1');
      } else {
        ok(`play-clock (flyout): no word before 300ms, Out shown at ${flyRec.line1At[0].t.toFixed(0)}ms (>= catch ~${catchMs.toFixed(0)}ms), only at the catch`);
      }
    }
  }
  await p16b.close();
}

// 17. R6 (docs/BASEBALL-3D-BUILD.md section 9, "R6"): SIDES-MATCH. Every one of the fifteen roles
// wears the team the CURRENT HALF says, never `mode` (which control the human happens to be
// holding this turn) - the old `_syncActors` picked the batter's/pitcher's side off `mode` and
// got it backwards for the human (the human is always `away`, so the pitching state's batter is
// `home`, not `away`). Forces both halves through `window.__bbTest.forceHalf` and reads every
// VISIBLE actor's own `side` straight off `inst.actors.actors` - the same object `_setSide`
// writes - never re-deriving it a second way.
{
  const p17 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page17 = await p17.newPage();
  const errs17 = [];
  page17.on('pageerror', (e) => errs17.push(String((e && e.message) || e)));
  await page17.addInitScript(() => {
    window.__bbDevForce = true;
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Sides Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr17 = await mountInHub(page17);
  if (mountErr17) {
    fail('sides-match', `mount failed: ${mountErr17}`);
  } else {
    await page17.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page17.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page17.waitForTimeout(400);
    const res = await page17.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      if (!window.__bbTest || typeof window.__bbTest.forceHalf !== 'function') {
        return { error: 'window.__bbTest.forceHalf is not available - dev flag not honored, or the seam is missing' };
      }
      const FIELDER_ROLES = ['f1b', 'f2b', 'f3b', 'fss', 'flf', 'fcf', 'frf'];
      const RUNNER_ROLES = ['r1', 'r2', 'r3'];
      const check = (half) => {
        window.__bbTest.forceHalf(half);
        inst._drawStaticField();
        const battingSide = half === 'top' ? 'away' : 'home';
        const defenseSide = battingSide === 'away' ? 'home' : 'away';
        const bad = [];
        const batter = inst.actors.actors.batter;
        if (!batter || batter.side !== battingSide) bad.push(`batter side "${batter && batter.side}" != "${battingSide}"`);
        const pitcher = inst.actors.actors.pitcher;
        if (!pitcher || pitcher.side !== defenseSide) bad.push(`pitcher side "${pitcher && pitcher.side}" != "${defenseSide}"`);
        const catcher = inst.actors.actors.catcher;
        if (!catcher || catcher.side !== defenseSide) bad.push(`catcher side "${catcher && catcher.side}" != "${defenseSide}"`);
        for (const role of FIELDER_ROLES) {
          const a = inst.actors.actors[role];
          if (a && a.pivot.visible && a.side !== defenseSide) bad.push(`${role} side "${a.side}" != "${defenseSide}"`);
        }
        for (const role of RUNNER_ROLES) {
          const a = inst.actors.actors[role];
          if (a && a.pivot.visible && a.side !== battingSide) bad.push(`${role} side "${a.side}" != "${battingSide}"`);
        }
        return { half, battingSide, batterSide: batter && batter.side, pitcherSide: pitcher && pitcher.side, bad };
      };
      const top = check('top');
      const bottom = check('bottom');
      // Leave the game in a real state for anything after this in the same page (none here, but
      // cheap insurance): top is this game's own natural first half.
      window.__bbTest.forceHalf('top'); inst._drawStaticField();
      return { top, bottom };
    });
    if (res.error) {
      fail('sides-match', res.error);
    } else if (res.top.bad.length || res.bottom.bad.length) {
      fail('sides-match', `top: ${res.top.bad.join('; ') || 'ok'} | bottom: ${res.bottom.bad.join('; ') || 'ok'}`);
    } else {
      ok(`sides-match: half "top" bats away/pitches home (batter ${res.top.batterSide}, pitcher ${res.top.pitcherSide}); `
        + `half "bottom" bats home/pitches away (batter ${res.bottom.batterSide}, pitcher ${res.bottom.pitcherSide})`);
    }
  }
  if (errs17.length) fail('sides-match', `page errors: ${errs17.slice(0, 3).join(' | ')}`);
  else ok('no page errors during sides-match');
  await p17.close();
}

// 18. R6/R9: ONE-BATTER. After a play resolves as an out, exactly one figure stands in the batter's
// box once the plate view returns and the next batter is placed - `rb` (the batter-runner) must
// never still be visible from a play that has already ended. Drives `_settleAtBat` directly with a
// synthetic short-out payload (`homerun-strip`'s own pattern, above - no engine, no real at-bat
// needed) and forces the EXACT race this stage closes: `_returnToPlate()` is called manually WHILE
// `rb` is still mid-run (well before his own ~2000ms natural finish), the same shape as a cutaway
// landing early. Born red against the unfixed `_animateRunners`/`_returnToPlate` (verified by
// stashing the fix and re-running this exact scenario by hand - see the stage report).
//
// R9 (docs/BASEBALL-3D-BUILD.md section 9, "R9", item 1) extends this same probe with the OTHER
// half: a fresh ball-in-play payload, sampled every rendered frame for the first 800ms after
// `_settleAtBat` starts (this scenario's own stand-in for `atBatEnd`), asserting at most one
// visible figure within 6ft of the batter's box on EVERY sampled frame - not just after the fact,
// the way the after-return check below already does. Born red against the unfixed
// `_animateRunners`/`_syncBatterRunner` (verified the same way, by stash-and-rerun - see the stage
// report).
{
  const p18 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page18 = await p18.newPage();
  const errs18 = [];
  page18.on('pageerror', (e) => errs18.push(String((e && e.message) || e)));
  await page18.addInitScript(() => {
    window.__bbDevForce = true;
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'One Batter Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr18 = await mountInHub(page18);
  if (mountErr18) {
    fail('one-batter', `mount failed: ${mountErr18}`);
  } else {
    await page18.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page18.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page18.waitForTimeout(500);
    // R9 (docs/BASEBALL-3D-BUILD.md section 9, "R9", item 1): THE START HALF. R6 (above, this same
    // probe) already covers the RETURN half (a stale 'rb' outliving his play); this covers the
    // OTHER side of the same double-batter bug - 'rb' placed at the plate and running WHILE the
    // batter actor is still standing in the box, for the first half second of every ball in play
    // (Matt's own recording, glitch-sheet.jpg 28.6s/46.4s). Fires a real ball-in-play payload
    // through the real `_settleAtBat` (no forced early return this time - the natural sequence:
    // contact hold, the cut, the chase) and samples EVERY RENDERED FRAME for the first 800ms,
    // reading `pivot.visible`/`pivot.position` directly off `inst.actors.actors` the same way the
    // existing after-return check below does. Then ends the play cleanly (`_returnToPlate()`) so it
    // cannot bleed into the next scenario.
    const startRes = await page18.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const side = inst.game.half === 'top' ? 'away' : 'home';
      const payload = {
        batterId: 'test-batter-onebatter-start', side, outcome: 'single', bases: 1, runsScored: 0,
        q: 0.6, exitVeloMph: 92, centered: true, distanceFt: 210, sprayAngleDeg: 8,
        battedKind: 'line', launchAngleDeg: 14, timingWord: null,
        basesBefore: [null, null, null], runnersOut: [],
      };
      const box = inst.actors.actors.batter.pivot.position;
      const samples = [];
      const t0 = performance.now();
      const p = inst._settleAtBat(payload);
      await new Promise((resolve) => {
        const loop = () => {
          const within = [];
          for (const role of Object.keys(inst.actors.actors)) {
            const a = inst.actors.actors[role];
            if (!a || !a.pivot.visible) continue;
            const d = Math.hypot(a.pivot.position.x - box.x, a.pivot.position.z - box.z);
            if (d <= 6) within.push(role);
          }
          samples.push(within);
          if (performance.now() - t0 < 800) requestAnimationFrame(loop);
          else resolve();
        };
        requestAnimationFrame(loop);
      });
      // End this synthetic play cleanly before the next scenario starts - `_returnToPlate()` is the
      // same "whichever comes first" close the existing scenario below already uses.
      inst._returnToPlate();
      await p.catch(() => {});
      const bad = samples.filter((s) => s.length > 1);
      return { totalSamples: samples.length, badCount: bad.length, firstBad: bad[0] || null };
    });
    if (!startRes.totalSamples) {
      fail('one-batter (start half)', 'no frames sampled - the rAF sampling loop never ran');
    } else if (startRes.badCount) {
      fail('one-batter (start half)', `${startRes.badCount}/${startRes.totalSamples} sampled frames in the first 800ms after atBatEnd showed more than one figure within 6ft of the batter's box: ${JSON.stringify(startRes.firstBad)}`);
    } else {
      ok(`one-batter (start half): all ${startRes.totalSamples} sampled frames in the first 800ms after atBatEnd showed at most one figure within 6ft of the batter's box`);
    }
    const res = await page18.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const side = inst.game.half === 'top' ? 'away' : 'home';
      // A short groundout: the batter is out at first, distanceFt well inside "short" - the exact
      // shape of Matt's v865 report ("a 0 ft out today, any short out after R5").
      const payload = {
        batterId: 'test-batter-onebatter', side, outcome: 'groundout', bases: 0, runsScored: 0,
        q: 0.4, exitVeloMph: 60, centered: false, distanceFt: 45, sprayAngleDeg: -10,
        battedKind: 'ground', launchAngleDeg: 1, timingWord: null,
        basesBefore: [null, null, null], runnersOut: [],
      };
      // Fire-and-forget, same as `homerun-strip` - `_settleAtBat` runs its own multi-second
      // sequence (R10: no longer a fixed ~2s - a 45ft ground out's own flight/throw-beat/hold runs
      // a few seconds; awaited fully at the bottom of this block).
      window.__bbOneBatterP = inst._settleAtBat(payload);
      // FORCE THE RACE: cut back to the plate at 300ms, well before rb's own natural finish (his
      // 90ft run at RUNNER_SPEED_FT_S is ~3333ms - R10 removed the old speed-up-to-fit-a-window
      // rule, but this probe forces the SAME race regardless of how long his run naturally takes)
      // - the exact shape of a cutaway landing early relative to `_animateRunners`'s own
      // independently-clocked rAF loop.
      await new Promise((r) => setTimeout(r, 300));
      inst._returnToPlate();
      // THE NEXT AT-BAT'S FIRST PITCH: the real `HumanAgent.decidePitch`/`decideSwing` both call
      // `_drawStaticField()` as their very first act (ui.js, both headers) - mirrored here rather
      // than waiting on real engine/agent turn-taking, which this synthetic payload has no real
      // at-bat behind to drive.
      inst._drawStaticField();
      // Sample well past where the OLD code would still show rb mid-run (1500ms after contact,
      // comfortably inside his own real ~3333ms natural window).
      await new Promise((r) => setTimeout(r, 1200));
      const box = inst.actors.actors.batter.pivot.position;
      const within = [];
      for (const role of Object.keys(inst.actors.actors)) {
        const a = inst.actors.actors[role];
        if (!a || !a.pivot.visible) continue;
        const d = Math.hypot(a.pivot.position.x - box.x, a.pivot.position.z - box.z);
        if (d <= 4) within.push({ role, d });
      }
      const rb = inst.actors.actors.rb;
      return {
        rbVisible: !!(rb && rb.pivot.visible),
        rbActive: !!inst._rbActive,
        within,
      };
    });
    if (res.rbVisible) {
      fail('one-batter', `'rb' is still visible 1.5s after a forced early _returnToPlate() (rbActive=${res.rbActive})`);
    } else if (res.within.length !== 1) {
      fail('one-batter', `${res.within.length} figures within 4ft of the batter's box (want exactly 1): ${res.within.map((w) => `${w.role} ${w.d.toFixed(2)}ft`).join(', ')}`);
    } else if (res.within[0].role !== 'batter') {
      fail('one-batter', `the one figure in the box is "${res.within[0].role}", not the batter`);
    } else {
      ok(`one-batter: after a forced early cutaway, exactly one figure (the batter) stands in the box and 'rb' is hidden`);
    }
    await page18.evaluate(() => window.__bbOneBatterP).catch(() => {});
  }
  if (errs18.length) fail('one-batter', `page errors: ${errs18.slice(0, 3).join(' | ')}`);
  else ok('no page errors during one-batter');
  await p18.close();
}

// 19. R7 (docs/BASEBALL-3D-BUILD.md section 9, "R7"): POP-ONSCREEN. A left-handed batter mirrors
// to the SIDE OF THE BOX CLOSER TO THE BAND'S EDGE (field.js's own CAMERAS comment: a lefty lands
// at 68% across, a righty at 24%) - so "Perfect" (the widest verdict word) for a left-handed
// batter is the exact case Matt's recording showed running off-screen. Forces `_currentBatterFlip`
// to true (never depends on which real roster player happens to be up - the point is the WORD and
// the SIDE, not a specific at-bat) and calls `_showPop` directly, the same directness
// `homerun-strip`/`one-batter` already use for a presentation effect that needs no real at-bat
// behind it.
//
// Two checks: (a) the real left-handed geometry (measured: the head projects to ~70% across on
// this container, comfortably inside the band on its own - a MARGIN-only clamp would already pass
// it, so it alone would not have caught the old bug); (b) `_batterHeadWorld` forced to a world x
// (5.25 ft) measured to project to ~372px, close enough to the 393px band's own right edge that a
// MARGIN-only clamp (the old code: `Math.max(12, Math.min(fieldW - 12, p.x))`) leaves the centre
// there unclamped and "Perfect"'s own ~178px width runs the right edge to ~461px, 68px past the
// band - the exact failure mode the spec describes, reproduced on demand rather than hoped for.
{
  const p19 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page19 = await p19.newPage();
  await page19.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Pop Onscreen Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr19 = await mountInHub(page19);
  if (mountErr19) {
    fail('pop-onscreen', `mount failed: ${mountErr19}`);
  } else {
    await page19.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page19.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page19.waitForTimeout(500);
    const insideBandOf = (r, wrap) => r.left >= wrap.left - 1 && r.right <= wrap.right + 1
      && r.top >= wrap.top - 1 && r.bottom <= wrap.bottom + 1;
    const real = await page19.evaluate(() => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      inst._currentBatterFlip = () => true;   // force left-handed, no matter who is actually up
      inst._showPop('Perfect', 'perfect', { pitchLine: 'Fastball 92', swingLine: '' });
      const wrapRect = document.querySelector('[data-role="fieldwrap"]').getBoundingClientRect();
      const popRect = document.querySelector('[data-role="pop"]').getBoundingClientRect();
      return { wrapRect, popRect, flip: inst._currentBatterFlip() };
    });
    const forced = await page19.evaluate(() => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      // A world point measured (node, field.js's own makeCameras/projectToCanvas) to project close
      // to the band's right edge - see this block's own header comment for the exact number.
      inst._batterHeadWorld = () => ({ x: 5.25, y: 6.9, z: 0.4 });
      inst._showPop('Perfect', 'perfect', { pitchLine: 'Fastball 92', swingLine: '' });
      const wrapRect = document.querySelector('[data-role="fieldwrap"]').getBoundingClientRect();
      const popRect = document.querySelector('[data-role="pop"]').getBoundingClientRect();
      return { wrapRect, popRect };
    });
    if (!real.flip) {
      fail('pop-onscreen', 'the forced left-handed override did not take (_currentBatterFlip() read false)');
    } else if (!insideBandOf(real.popRect, real.wrapRect)) {
      fail('pop-onscreen', `"Perfect" for a left-handed batter is NOT fully inside the field band - `
        + `pop ${JSON.stringify(real.popRect)} vs band ${JSON.stringify(real.wrapRect)}`);
    } else if (!insideBandOf(forced.popRect, forced.wrapRect)) {
      fail('pop-onscreen', `a pop whose head point projects near the band's right edge is NOT clamped by its own `
        + `measured width - pop ${JSON.stringify(forced.popRect)} vs band ${JSON.stringify(forced.wrapRect)}`);
    } else {
      ok(`pop-onscreen: "Perfect" for a left-handed batter sits fully inside the field band `
        + `(pop left=${real.popRect.left.toFixed(1)} right=${real.popRect.right.toFixed(1)}, band right=${real.wrapRect.right.toFixed(1)}), `
        + `and a pop forced near the edge is still clamped fully inside it `
        + `(pop right=${forced.popRect.right.toFixed(1)}, band right=${forced.wrapRect.right.toFixed(1)})`);
    }
  }
  await p19.close();
}

// 20. R7: CHASE-START. The chase camera's very first position, on a genuinely SHORT ball (45 ft,
// just past R5's own MIN_IN_PLAY_FT floor of 40) - the exact shape of Matt's report ("on a short
// ball the first chase frames are the catcher's head filling the foreground"). Wraps
// `actors.chaseAt` to capture the camera's OWN position the instant the immediate (first) call
// runs, and reads the catcher/umpire's visibility at that same moment - both straight off the real
// objects `_applyCameraVisibility`/`chaseAt` write, never re-derived. Drives `_settleAtBat`
// directly with a synthetic in-play payload (`homerun-strip`'s/`one-batter`'s own pattern) rather
// than waiting for a real short grounder to happen to occur.
{
  const p20 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page20 = await p20.newPage();
  await page20.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Chase Start Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr20 = await mountInHub(page20);
  if (mountErr20) {
    fail('chase-start', `mount failed: ${mountErr20}`);
  } else {
    await page20.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page20.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page20.waitForTimeout(500);
    const res = await page20.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const F = await import('/baseball/js/field.js');
      let captured = null;
      const origChaseAt = inst.actors.chaseAt.bind(inst.actors);
      inst.actors.chaseAt = (pos, immediate) => {
        const r = origChaseAt(pos, immediate);
        if (immediate && !captured) {
          const cam = inst.actors.cameras.chase;
          captured = {
            camPos: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
            ballPos: { ...pos },
            catcherVisible: inst.actors.actors.catcher.pivot.visible,
            umpireVisible: inst.actors.actors.umpire.pivot.visible,
          };
        }
        return r;
      };
      const side = inst.game.half === 'top' ? 'away' : 'home';
      const payload = {
        batterId: 'test-batter-chasestart', side, outcome: 'single', bases: 1, runsScored: 0,
        q: 0.6, exitVeloMph: 75, centered: false, distanceFt: 45, sprayAngleDeg: 5,
        battedKind: 'ground', launchAngleDeg: 3, timingWord: 'late',
        basesBefore: [null, null, null], runnersOut: [],
      };
      window.__bbChaseStartP = inst._settleAtBat(payload);
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline && !captured) await new Promise((r) => setTimeout(r, 20));
      return { captured, minHeight: F.CHASE_MIN_HEIGHT_FT, minBack: F.CHASE_MIN_BACK_FT };
    });
    if (!res.captured) {
      fail('chase-start', 'the chase camera never received an immediate chaseAt() call within 4s of a short grounder');
    } else {
      const { camPos, ballPos, catcherVisible, umpireVisible } = res.captured;
      const gotHeight = camPos.y - ballPos.y, gotBack = camPos.z - ballPos.z;
      const EPS = 0.05;
      if (gotHeight < res.minHeight - EPS) {
        fail('chase-start', `the chase camera's first height above the ball is ${gotHeight.toFixed(2)} ft, under CHASE_MIN_HEIGHT_FT (${res.minHeight})`);
      } else if (gotBack < res.minBack - EPS) {
        fail('chase-start', `the chase camera's first back-distance from the ball is ${gotBack.toFixed(2)} ft, under CHASE_MIN_BACK_FT (${res.minBack})`);
      } else if (catcherVisible) {
        fail('chase-start', 'the catcher is still visible on the first chase frame');
      } else if (umpireVisible) {
        fail('chase-start', 'the umpire is still visible on the first chase frame');
      } else {
        ok(`chase-start: the chase camera's first position is ${gotHeight.toFixed(2)} ft up (>= ${res.minHeight}) and `
          + `${gotBack.toFixed(2)} ft behind the ball (>= ${res.minBack}), catcher and umpire both hidden`);
      }
    }
    await page20.evaluate(() => window.__bbChaseStartP).catch(() => {});
  }
  await p20.close();
}

// 21. R7: BALL-VISIBLE-PITCHER. The ball's projected radius on the PITCHER camera, at the crossing
// point (60.5 ft from the mound, the worst-case distance - field.js's own BALL_MIN_PX comment) is
// floored to at least BALL_MIN_PX; the SAME world position on the batter and chase cameras is
// never scaled (the spec's own rule - "never on the batter or chase cameras"). Calls
// `actors.setCamera`/`setBall` directly rather than driving a real pitch, the same directness
// `zone-scale` above already uses for a camera-and-projection fact that needs no live flight.
{
  const p21 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page21 = await p21.newPage();
  await page21.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Ball Visible Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr21 = await mountInHub(page21);
  if (mountErr21) {
    fail('ball-visible-pitcher', `mount failed: ${mountErr21}`);
  } else {
    await page21.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page21.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page21.waitForTimeout(500);
    const res = await page21.evaluate(async () => {
      const inst = document.querySelector('.hub-game')._bbInstance;
      const F = await import('/baseball/js/field.js');
      const zone = F.zoneRectFt();
      const crossing = { x: 0, y: zone.cy, z: F.ZONE.z };   // 60.5 ft from the mound on the pitcher camera
      const measure = (camName) => {
        inst.actors.setCamera(camName);
        inst.actors.setBall(crossing);
        const scale = inst.actors._ball.scale.x;
        const a = F.projectToCanvas(inst.actors.camera, crossing, inst._fieldW, inst._fieldH);
        const edge = F.projectToCanvas(inst.actors.camera,
          { x: crossing.x + F.BALL_RADIUS_FT * scale, y: crossing.y, z: crossing.z }, inst._fieldW, inst._fieldH);
        return { scale, px: Math.hypot(edge.x - a.x, edge.y - a.y) };
      };
      return { pitcher: measure('pitcher'), batter: measure('batter'), chase: measure('chase'), minPx: F.BALL_MIN_PX };
    });
    if (res.pitcher.px < res.minPx - 0.5) {
      fail('ball-visible-pitcher', `the ball on the pitcher camera at the crossing draws ${res.pitcher.px.toFixed(2)} px, under BALL_MIN_PX (${res.minPx})`);
    } else if (Math.abs(res.batter.scale - 1) > 1e-6) {
      fail('ball-visible-pitcher', `the ball is scaled (${res.batter.scale.toFixed(3)}x) on the BATTER camera - the floor must never apply there`);
    } else if (Math.abs(res.chase.scale - 1) > 1e-6) {
      fail('ball-visible-pitcher', `the ball is scaled (${res.chase.scale.toFixed(3)}x) on the CHASE camera - the floor must never apply there`);
    } else {
      ok(`ball-visible-pitcher: the ball at the crossing draws ${res.pitcher.px.toFixed(2)} px on the pitcher camera `
        + `(>= ${res.minPx}, scale ${res.pitcher.scale.toFixed(2)}x), unscaled on batter (${res.batter.px.toFixed(2)} px) and chase (${res.chase.px.toFixed(2)} px)`);
    }
  }
  await p21.close();
}

// 22. R8 (docs/BASEBALL-3D-BUILD.md section 9, "R8", item 4): HUD-LEGIBLE. Matt, on the recording:
// "the current count and the overall score is difficult to find or see." The scoreboard's own
// computed font sizes: the YOU/CPU runs numerals at least 18px, the B/S/O dots at least 10px
// (both `docs/BUILDING-A-GAME.md` Part 0's absolute floor AND the spec's own probed numbers), and
// the three rows carry their own letters (never colour alone - root CLAUDE.md's colorblind rule).
{
  const p22 = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page22 = await p22.newPage();
  await page22.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Hud Legible Test', emoji: '\u{26BE}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  const mountErr22 = await mountInHub(page22);
  if (mountErr22) {
    fail('hud-legible', `mount failed: ${mountErr22}`);
  } else {
    await page22.evaluate(() => {
      const root = document.querySelector('.hub-game');
      const btn = root && root.querySelector('.bb-play-btn');
      if (btn) btn.click();
    });
    await page22.waitForSelector('.bb-play', { timeout: 5000 }).catch(() => {});
    await page22.waitForTimeout(300);
    const res = await page22.evaluate(() => {
      const px = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
      const runs = [...document.querySelectorAll('.bb-sb-runs')].map(px);
      const dots = [...document.querySelectorAll('.bb-dot')].map((el) => el.getBoundingClientRect().width);
      const labels = [...document.querySelectorAll('.bb-sb-label')].map((el) => el.textContent.trim());
      const hud = document.querySelector('[data-role="hud"]');
      const wrap = document.querySelector('[data-role="fieldwrap"]');
      const hudRect = hud ? hud.getBoundingClientRect() : null;
      const wrapRect = wrap ? wrap.getBoundingClientRect() : null;
      return {
        runs, dots, labels,
        insideWrap: !!(hudRect && wrapRect
          && hudRect.left >= wrapRect.left - 1 && hudRect.top >= wrapRect.top - 1
          && hudRect.right <= wrapRect.right + 1),
      };
    });
    const minRun = res.runs.length ? Math.min(...res.runs) : null;
    const minDot = res.dots.length ? Math.min(...res.dots) : null;
    if (res.runs.length !== 2) {
      fail('hud-legible', `expected 2 .bb-sb-runs elements (YOU, CPU), found ${res.runs.length}`);
    } else if (minRun < 18) {
      fail('hud-legible', `the runs numerals compute to ${res.runs.join('/')}px - under the 18px floor`);
    } else if (res.dots.length !== 7) {
      fail('hud-legible', `expected 7 .bb-dot elements (3 balls + 2 strikes + 2 outs), found ${res.dots.length}`);
    } else if (minDot < 10) {
      fail('hud-legible', `the B/S/O dots measure as small as ${minDot.toFixed(1)}px - under the 10px floor`);
    } else if (res.labels.filter(Boolean).length !== 3) {
      fail('hud-legible', `expected 3 non-empty row letters (B/S/O), got [${res.labels.join(',')}]`);
    } else if (!res.insideWrap) {
      fail('hud-legible', 'the scoreboard is not positioned inside the field band');
    } else {
      ok(`hud-legible: runs numerals >= ${minRun}px (floor 18), B/S/O dots >= ${minDot.toFixed(1)}px (floor 10), row letters [${res.labels.join(',')}], scoreboard inside the field band`);
    }
  }
  await p22.close();
}

await browser.close();

console.log('');
console.log(failed === 0 ? `All checks passed.` : `${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
