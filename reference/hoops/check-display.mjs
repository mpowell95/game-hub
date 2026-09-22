// reference/hoops/check-display.mjs - CONNECT 4 HOOPS, looked at rather than reasoned about.
//
// Three questions, each of which cost a round of Matt's time because nothing headless could see
// them. `hoops4/js/test.js` proves the BALL behaves; every defect he has actually reported on
// this machine has been a picture:
//
//   VISIBILITY   is 100% of the Connect 4 display on screen from the play camera? The first
//                raked build clipped its bottom row behind the cabinet apron, so the board a
//                player reads to decide a shot was a 7x5.
//   ALIGNMENT    does grid column N sit directly under hoop N? Being able to see which column a
//                shot drops into IS the game. Both layouts are derived from geom.holes[].u, so
//                this asserts the derivation rather than hoping two layouts agree.
//   THE SWIPE    a scripted touch gesture per column, through the real pad, the real swipe
//                maths and the real engine - reported as a hit rate per column. Nothing else in
//                this repo has ever thrown a hoops4 ball the way a thumb does.
//
// `node reference/hoops/check-display.mjs [--shots N] [--no-swipe]`; needs `node server.mjs` up.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';

/** The container ships Chromium at PLAYWRIGHT_BROWSERS_PATH but the version folder moves, so it
 *  is discovered rather than hardcoded; falling through to undefined lets playwright resolve it. */
function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    if (!d.startsWith('chromium')) continue;
    for (const exe of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      const p = `${root}/${d}/${exe}`;
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const PORT = Number(process.env.PORT || 8123);
const BASE = `http://localhost:${PORT}`;
const argv = process.argv.slice(2);
const SHOTS = Number((argv.find((a) => a.startsWith('--shots=')) || '').split('=')[1] || 3);
const NO_SWIPE = argv.includes('--no-swipe');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  -- ' + detail : ''}`); }
};

const browser = await chromium.launch({
  executablePath: chromePath(),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => {
  try {
    localStorage.setItem('gamehub.profile', JSON.stringify({ name: 'Probe', emoji: '\u{1F3C0}' }));
  } catch {}
});
await page.goto(`${BASE}/hoops4/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.h4-play', { timeout: 20000 });
await page.click('.h4-play');            // the setup screen's one primary action
await page.waitForFunction(() => window.__h4Test && window.__h4Test.rend, null, { timeout: 30000 });
await page.waitForTimeout(600);

// ---------------------------------------------------------------------------------------------
// VISIBILITY + ALIGNMENT, measured through the real camera
// ---------------------------------------------------------------------------------------------
const geo = await page.evaluate(async () => {
  const ui = window.__h4Test;
  const r = ui.rend;
  const THREE = await import('/skeeball/js/vendor/three.module.min.js');
  const cam = r.camera;
  const cv = r.renderer.domElement;
  const W = cv.clientWidth, H = cv.clientHeight;
  cam.updateMatrixWorld(true);
  const toPx = (v3) => {
    const p = v3.clone().project(cam);
    return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, ndc: [p.x, p.y] };
  };
  const local = (x, y) => r.screen.localToWorld(new THREE.Vector3(x, y, 0));
  const pw = r.panel.w, pl = r.panel.len, PX = r.panel.px;
  // the four corners of the display, in its own plane
  const corners = [[-pw / 2, -pl / 2], [pw / 2, -pl / 2], [pw / 2, pl / 2], [-pw / 2, pl / 2]]
    .map(([x, y]) => toPx(local(x, y)));
  // the centre of every cell, so a clipped ROW is caught and not only a clipped corner
  const cells = [];
  const cvH = r.gridCanvas.height;
  for (let c = 0; c < 7; c++) {
    for (let row = 0; row < 6; row++) {
      const cx = (r.colX[c] / PX - 0.5) * pw;
      const cyPx = r.gridTop + r.gridRowPitch * (row + 0.5);
      const cy = (0.5 - cyPx / cvH) * pl;
      cells.push({ c, row, ...toPx(local(cx, cy)) });
    }
  }
  // every hoop centre, from the machine's own geometry
  const hoops = [];
  const M = ui.engine.machine;
  const { BOARD } = await import('/hoops4/js/boarddef.js');
  const HOLES = BOARD.geom.holes;
  const holes = Object.keys(HOLES).sort((a, b) => HOLES[a].u - HOLES[b].u);
  for (const id of holes) {
    const h = HOLES[id];
    const p = M.faceToWorld(h.u, h.v, h.collarH);
    hoops.push({ id, ...toPx(new THREE.Vector3(p[0], p[1], p[2])) });
  }
  // the top of each grid column, for the alignment test
  const cols = [];
  for (let c = 0; c < 7; c++) {
    const cx = (r.colX[c] / PX - 0.5) * pw;
    const cy = (0.5 - (r.gridTop + r.gridRowPitch * 0.5) / cvH) * pl;
    cols.push({ c, ...toPx(local(cx, cy)) });
  }
  // OCCLUSION, not just clipping. Every cell that is inside the canvas can still be hidden by
  // the cabinet's own furniture - which is exactly what the first raked build did to the bottom
  // row, behind the front apron - so each cell is raycast from the play camera and the display
  // has to be the first thing the ray meets.
  const ray = new THREE.Raycaster();
  const solid = [];
  r.scene.traverse((o) => { if (o.isMesh && o.visible) solid.push(o); });
  let hidden = 0;
  const hiddenBy = {};
  for (const cell of cells) {
    ray.setFromCamera(new THREE.Vector2(cell.ndc[0], cell.ndc[1]), cam);
    const hit = ray.intersectObjects(solid, false)[0];
    cell.front = !hit || hit.object === r.screen;
    if (!cell.front) {
      hidden++;
      const nm = (hit.object.name || hit.object.geometry.type || 'mesh');
      hiddenBy[nm] = (hiddenBy[nm] || 0) + 1;
    }
  }
  // the exact derivation: a column's panel u against its hoop's own u
  const uErr = [];
  for (let c = 0; c < 7; c++) {
    const cu = (r.colX[c] / PX - 0.5) * pw;
    uErr.push(Math.abs(cu - HOLES[holes[c]].u));
  }
  // A CELL'S CENTRE CLEARING THE FURNITURE IS NOT THE SAME AS THE CELL CLEARING IT (2026-09-22).
  // Matt: "Why is the bottom left and bottom right of the connect 4 board covered by the black
  // board thing?" It was the cabinet's flare, standing 107 mm above the board's bottom edge and
  // cutting diagonally across the two bottom corners of the grid - and THIS PROBE REPORTED 10/10
  // THROUGHOUT, because the bottom row's cell CENTRES clear it even when the cells themselves
  // are clipped. A board that fills from the bottom cannot afford that blind spot.
  //
  // So the panel's own four corners are raycast too, and each bottom cell is sampled at its
  // OUTER LOWER edge rather than only at its middle.
  const panelHidden = [];
  const sample = (wx, wy, wz, label) => {
    const v = new THREE.Vector3(wx, wy, wz).project(cam);
    ray.setFromCamera(new THREE.Vector2(v.x, v.y), cam);
    const hit = ray.intersectObjects(solid, false)[0];
    if (hit && hit.object !== r.screen) {
      panelHidden.push(`${label} behind ${hit.object.name || hit.object.geometry.type || 'mesh'}`);
    }
  };
  for (const [sx, sy, lbl] of [[-1, -1, 'panel bottom-left'], [1, -1, 'panel bottom-right'],
                               [-1, 1, 'panel top-left'], [1, 1, 'panel top-right']]) {
    const lp = local(sx * pw * 0.499, sy * pl * 0.499);
    sample(lp.x, lp.y, lp.z, lbl);
  }
  // the outer lower edge of the bottom row's two end cells - the exact pixels Matt pointed at
  for (const c of [0, 6]) {
    const cx = (r.colX[c] / PX - 0.5) * pw + (c === 0 ? -1 : 1) * (r.gridPitch / PX) * pw * 0.30;
    const cy = (0.5 - (r.gridTop + r.gridRowPitch * 5.80) / cvH) * pl;
    const lp = local(cx, cy);
    sample(lp.x, lp.y, lp.z, `bottom row, column ${c + 1}, outer lower edge`);
  }
  return { W, H, corners, cells, hoops, cols, hidden, hiddenBy, uErr, panelHidden };
});

console.log(`\nCONNECT 4 HOOPS - display probe   canvas ${geo.W}x${geo.H}\n`);

const inView = (p) => p.x >= 0 && p.x <= geo.W && p.y >= 0 && p.y <= geo.H;
const badCorners = geo.corners.filter((p) => !inView(p));
check('the whole display panel is on screen (all four corners)', badCorners.length === 0,
  badCorners.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));

const badCells = geo.cells.filter((p) => !inView(p));
check('every one of the 42 cells is on screen', badCells.length === 0,
  badCells.length ? `${badCells.length} off, worst row ${Math.max(...badCells.map((b) => b.row))}` : '');

const bottomRow = geo.cells.filter((p) => p.row === 5);
const lowest = Math.max(...bottomRow.map((p) => p.y));
check('the bottom row clears the bottom edge by 8px', geo.H - lowest >= 8,
  `bottom row at y ${lowest.toFixed(0)} of ${geo.H}`);

const panelH = Math.max(...geo.corners.map((p) => p.y)) - Math.min(...geo.corners.map((p) => p.y));
const panelW = Math.max(...geo.corners.map((p) => p.x)) - Math.min(...geo.corners.map((p) => p.x));
// WIDTH, NOT HEIGHT, IS THE HONEST FRAMING TEST. The cabinet is 1.52 m across and the display
// 0.70 m tall, so on a 0.49-aspect phone a frame wide enough to hold the machine is 3.09 m tall
// however far back the camera stands - the display can never be more than 22.6% of a portrait
// screen, and a "quarter of the frame tall" bar is unsatisfiable by any camera. What a camera
// CAN get wrong is standing too close (the field opens up to keep the near ball in shot and the
// machine shrinks): measured, 1.15 m back gives 44% of the frame width, 3.00 m back gives 83%.
check('the display fills at least 75% of the frame width', panelW >= geo.W * 0.75,
  `${panelW.toFixed(0)}px of ${geo.W}`);
console.log(`       display on screen: ${panelW.toFixed(0)} x ${panelH.toFixed(0)} px` +
  `  (${(100 * panelH / geo.H).toFixed(0)}% of the frame's height, ceiling 22.6%)`);

check('no cell is hidden behind the cabinet\'s own furniture', geo.hidden === 0,
  `${geo.hidden} of 42 occluded by ${JSON.stringify(geo.hiddenBy)}`);
// [KNOWN-BUG PROBE] Born red against the flare at its old height (`machine.js`, "ITS TOP MUST NOT
// RISE ABOVE THE BOARD'S LIP"): the panel's two bottom corners and the outer lower edge of the
// bottom row's end cells were behind it, while every cell CENTRE was clear and this file said
// 10/10.
check('the panel\'s own corners and the bottom row\'s outer edges are not occluded either',
  geo.panelHidden.length === 0, geo.panelHidden.join('; '));

// ALIGNMENT IS TWO DIFFERENT QUESTIONS AND BOTH ARE ASKED, because only one of them can break.
// The derivation is exact - a column's x on the panel is computed FROM that hoop's own `u` - so
// the first check is to 0.1 mm and would go red the day somebody lays the grid out independently.
const worstU = Math.max(...geo.uErr);
check('a column is derived from its hoop\'s own u, exactly', worstU < 1e-4,
  `worst ${(worstU * 1000).toFixed(2)} mm`);

// The second is what a PLAYER sees, and it can never be zero: the hoop row stands 0.47 m behind
// the panel's top edge, so perspective fans the two apart and a pixel budget would only be
// measuring the lens. The question that matters is whether a hoop is unambiguous - is it nearer
// to its OWN column than to any other? Anything else and a player cannot read the machine.
let worstAlign = 0, ambiguous = 0;
for (let c = 0; c < 7; c++) {
  const d = geo.cols.map((col) => Math.abs(col.x - geo.hoops[c].x));
  const nearest = d.indexOf(Math.min(...d));
  if (nearest !== c) ambiguous++;
  worstAlign = Math.max(worstAlign, d[c]);
}
check('every hoop projects nearest to its OWN column', ambiguous === 0, `${ambiguous} ambiguous`);
console.log(`       perspective fan, hoop to its column: worst ${worstAlign.toFixed(1)}px`);

const hoopY = geo.hoops.reduce((a, h) => a + h.y, 0) / 7;
const gridY = geo.cells.reduce((a, p) => a + p.y, 0) / geo.cells.length;
check('the hoop row sits ABOVE the grid, as on the reference cabinet', hoopY < gridY,
  `hoops y ${hoopY.toFixed(0)}, grid y ${gridY.toFixed(0)}`);

// a real cell has to be big enough to read
const cellPitchPx = Math.abs(geo.cells[6].x - geo.cells[0].x) / 6 || 0;
const colPitchPx = Math.abs(geo.cols[1].x - geo.cols[0].x);
check('a grid cell is at least 30px across on a 393px phone', colPitchPx >= 30,
  `${colPitchPx.toFixed(1)}px between column centres`);
console.log(`       column pitch on screen: ${colPitchPx.toFixed(1)}px`);

check('no page errors while mounting', errors.length === 0, errors.slice(0, 2).join(' | '));

// ---------------------------------------------------------------------------------------------
// THE SWIPE: a real thumb, per column
// ---------------------------------------------------------------------------------------------
if (!NO_SWIPE) {
  console.log('\n  swiping the real pad - one gesture per column, through the real swipe maths\n');
  // TWO PLAYERS, NOT THE CPU. With an opponent in the match the CPU takes alternate turns and
  // appends its own moves, so "did my swipe land?" was reading the computer's shot half the time
  // - and the match filled up and ended before the last two columns were ever thrown at.
  await page.evaluate(() => {
    try { localStorage.setItem('gamehub.hoops4.v1', JSON.stringify({ opponent: 'two' })); } catch {}
  });
  const aims = await page.evaluate(() => import('/hoops4/js/cpu.js').then((m) => m.COLUMN_AIM));
  const tally = [];
  for (let c = 0; c < 7; c++) {
    // A fresh match per column, so a filling board can never starve the later ones.
    await page.evaluate(() => { const ui = window.__h4Test; ui.renderSetup(); });
    await page.waitForSelector('.h4-play', { timeout: 10000 });
    await page.click('.h4-play');
    await page.waitForFunction(() => window.__h4Test && window.__h4Test.rend, null, { timeout: 30000 });
    await page.waitForTimeout(400);
    const pad = await page.locator('.h4-swipe').boundingBox();
    let landed = 0, right = 0;
    for (let s2 = 0; s2 < SHOTS; s2++) {
      const before = await page.evaluate(() => window.__h4Test.match.moves.length);
      const x0 = pad.x + pad.width / 2, y0 = pad.y + pad.height * 0.86;
      const up = pad.height * 0.62;
      // ui.js reads aim as atan2(dx, dy) / aimDiv, raised to aimCurve - inverted here so the
      // gesture asks for the column rather than for an angle somebody guessed.
      const dx = Math.tan(aims[c] * 1.00) * up;
      await page.evaluate(([x, y, dx2, up2]) => new Promise((res) => {
        const el = document.querySelector('.h4-swipe');
        const mk = (type, cx, cy) => {
          const tp = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
          el.dispatchEvent(new TouchEvent(type, {
            bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [tp],
            changedTouches: [tp],
          }));
        };
        mk('touchstart', x, y);
        let i = 1; const n = 8;
        const tick = () => {
          const f = i / n;
          mk('touchmove', x + dx2 * f, y - up2 * f);
          if (++i > n) { mk('touchend', x + dx2, y - up2); res(); } else setTimeout(tick, 11);
        };
        setTimeout(tick, 11);
      }), [x0, y0, dx, up]);
      await page.waitForFunction((bf) => {
        const ui = window.__h4Test;
        return !ui.busy || ui.match.moves.length > bf;
      }, before, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(200);
      const got = await page.evaluate((bf) => {
        const mv = window.__h4Test.match.moves;
        return mv.length > bf ? mv[mv.length - 1].col : null;
      }, before);
      if (got !== null) { landed++; if (got === c) right++; }
    }
    tally.push({ c, landed, right });
    console.log(`  column ${c + 1}  aim ${aims[c].toFixed(3).padStart(6)}   ` +
      `${landed}/${SHOTS} landed   ${right} in the column it aimed at`);
  }
  const landed = tally.reduce((a, t) => a + t.landed, 0);
  const right = tally.reduce((a, t) => a + t.right, 0);
  const reached = tally.filter((t) => t.right > 0).length;
  console.log(`\n  ${landed} of ${7 * SHOTS} swipes scored, ${right} of them in the column aimed at, ` +
    `${reached} of 7 columns hit by a real thumb\n`);
  check('a real swipe scores at all', landed > 0, `${landed}/${7 * SHOTS}`);
  check('a real swipe hits the column it aimed at, at least half the time it scores',
    landed > 0 && right / landed >= 0.5, `${right} of ${landed}`);
  check('every column is hit by the gesture that asks for it', reached === 7, `${reached}/7`);
}

await browser.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
