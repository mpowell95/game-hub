// Temporary, not committed: renders reference/golf/obstacles-2026-09-22.png (see the task report).
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--headless=new'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text()); });
await page.goto('http://localhost:8125/hole-editor/', { waitUntil: 'networkidle' });

const dataUrl = await page.evaluate(async () => {
  const { makeHole } = await import('/golf/js/holegen.js');
  const { buildMap, MAP_PPY } = await import('/golf/js/render.js');

  const CATALOG = [
    { name: 'pine', shape: 'fir', trunk: 0.6, canopy: 4.5, height: 18 },
    { name: 'oak', shape: 'canopy', trunk: 1.0, canopy: 8.0, height: 13 },
    { name: 'sentinel', shape: 'fir', trunk: 1.2, canopy: 5.0, height: 40 },
    { name: 'maple', shape: 'canopy', trunk: 0.9, canopy: 7.0, height: 14 },
    { name: 'birch', shape: 'canopy', trunk: 0.5, canopy: 3.5, height: 12 },
    { name: 'willow', shape: 'willow', trunk: 1.0, canopy: 9.0, height: 12 },
    { name: 'cypress', shape: 'cypress', trunk: 0.7, canopy: 2.5, height: 22 },
    { name: 'deadtree', shape: 'dead', trunk: 0.7, canopy: 3.0, height: 10 },
    { name: 'bush', shape: 'bush', trunk: 0.4, canopy: 2.5, height: 2 },
    { name: 'palm', shape: 'palm', trunk: 0.5, canopy: 4.0, height: 16 },
    { name: 'saguaro', shape: 'cactus', trunk: 0.9, canopy: 1.8, height: 15 },
    { name: 'paloverde', shape: 'canopy', trunk: 0.7, canopy: 6.5, height: 8 },
    { name: 'joshua', shape: 'dead', trunk: 0.6, canopy: 3.0, height: 9 },
    { name: 'boulder', shape: 'rock', trunk: 3.2, canopy: 3.2, height: 40 },
    { name: 'smallrock', shape: 'rock', trunk: 1.5, canopy: 1.5, height: 40 },
    { name: 'rockpile', shape: 'rocks', trunk: 4.5, canopy: 4.5, height: 40 },
    { name: 'log', shape: 'log', trunk: 1.2, canopy: 1.2, height: 1.5 },
  ];

  const TARGET_R_PX = 40;
  const SPACING_YD = 24;
  const n = CATALOG.length;
  const len = n * SPACING_YD + 40;

  function buildRow(theme, base) {
    const trees = CATALOG.map((ty, i) => {
      const s = TARGET_R_PX / (ty.canopy * MAP_PPY);
      return { x: 0, y: 30 + i * SPACING_YD, type: i, s };
    });
    const hole = makeHole({
      n: 1, par: 5, nickname: 'still', base,
      treeTypes: CATALOG, trees, sentinels: [],
      path: [[0, 5], [0, len]], fw: [{ at: 0, w: 10 }, { at: 1, w: 10 }],
      hard: 0.3, seed: 1, greenSeed: 2, defend: false, belts: false, slope: 'gentle',
    });
    return { hole, map: buildMap(hole, theme) };
  }

  const rowFairway = buildRow('pine', 'fairway');
  const rowDesert = buildRow('desert', 'heavyRough');

  const TILE = 110;
  const LABEL_H = 20;
  const cv = document.createElement('canvas');
  cv.width = n * TILE;
  cv.height = (TILE + LABEL_H) * 2 + 30;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText('Obstacle catalogue, every entry at r=40px (fairway top, desert floor bottom)', 6, 16);

  function drawRow(row, top, label) {
    ctx.fillStyle = '#e8e8e8';
    ctx.font = '12px sans-serif';
    ctx.fillText(label, 4, top - 4);
    CATALOG.forEach((ty, i) => {
      const cx = (0 - row.map.minX) * row.map.ppy;
      const cyWorld = 30 + i * SPACING_YD;
      const cy = (row.map.maxY - cyWorld) * row.map.ppy;
      const sx = cx - TILE / 2; const sy = cy - TILE / 2;
      ctx.drawImage(row.map.canvas, sx, sy, TILE, TILE, i * TILE, top, TILE, TILE);
      ctx.strokeStyle = 'rgba(255,255,255,.15)';
      ctx.strokeRect(i * TILE, top, TILE, TILE);
      ctx.fillStyle = '#cfcfcf';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ty.name, i * TILE + TILE / 2, top + TILE + 12);
      ctx.textAlign = 'left';
    });
  }

  drawRow(rowFairway, 30, 'Fairway (parkland look)');
  drawRow(rowDesert, 30 + TILE + LABEL_H + 10, 'Desert floor (desert look)');

  return cv.toDataURL('image/png');
});

const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
fs.writeFileSync('reference/golf/obstacles-2026-09-22.png', Buffer.from(base64, 'base64'));
console.log('wrote reference/golf/obstacles-2026-09-22.png');

await browser.close();
