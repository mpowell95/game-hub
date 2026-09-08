// sheet-course.mjs - EVERY HOLE OF ONE COURSE, AS ONE IMAGE.
//
// A contact sheet for a golf COURSE, the way `test-visual.mjs` writes one for a game: eighteen (or
// nine) holes drawn from the same `buildMap` the game plays on, laid out in a grid and labelled
// with number, par and card yardage.
//
// It exists because a course is a SET, and this repo has learned that twice already - "variety is a
// property of the SET, not of a hole" (golf/CLAUDE.md, the back-nine pass), and the two greens that
// turned out to be the same green were only visible in a table of all eighteen. Reading a spec file
// cannot show you that; a wall of holes side by side can, in about a second.
//
// Needs the dev server up (`node server.mjs`), because it renders through the real render.js in a
// real browser rather than reimplementing the painter.
//
// NO LABELS BY DEFAULT (Matt, 2026-09-08: "we don't need labels. I don't want any text here at
// all"). Pass `--labels` when the point is identifying a hole rather than reading the set.
//
//   node sheet-course.mjs [pinevalley|redmesa|oasissands] [--labels]
//        ->  .visual-out/<course>-holes.png

import { chromium } from 'playwright-core';
import fs from 'node:fs';

const ARGS = process.argv.slice(2);
const LABELS = ARGS.includes('--labels');
const COURSE = ARGS.find((a) => !a.startsWith('--')) || 'pinevalley';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:8123/golf/', { waitUntil: 'networkidle' });

const dataUrl = await p.evaluate(async ({ courseId, labels }) => {
  const R = await import('/golf/js/render.js');
  const { COURSES } = await import('/golf/js/rounds.js');
  const course = COURSES.find((c) => c.id === courseId);
  if (!course) throw new Error(`no course "${courseId}" - have ${COURSES.map((c) => c.id).join(', ')}`);
  const COLS = Math.min(6, course.holes.length);
  const ROWS = Math.ceil(course.holes.length / COLS);
  const TW = 190, TH = 400, PAD = 10, LAB = labels ? 26 : 0;
  const cv = document.createElement('canvas');
  cv.width = COLS * (TW + PAD) + PAD;
  cv.height = ROWS * (TH + LAB + PAD) + PAD;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#20301a';
  c.fillRect(0, 0, cv.width, cv.height);
  course.holes.forEach((h, i) => {
    const col = i % COLS; const row = (i / COLS) | 0;
    const x = PAD + col * (TW + PAD); const y = PAD + row * (TH + LAB + PAD);
    const m = R.buildMap(h, course.theme);
    // LETTERBOXED, never cropped - the same rule the setup strip uses, so what this sheet shows and
    // what the game shows are the same picture at two sizes.
    const sc = Math.min(TW / m.w, TH / m.h);
    const w = m.w * sc; const hh = m.h * sc;
    c.fillStyle = '#0b0f07';
    c.fillRect(x - 1, y - 1, TW + 2, TH + 2);
    c.drawImage(m.canvas, x + (TW - w) / 2, y + (TH - hh) / 2, w, hh);
    if (labels) {
      c.fillStyle = '#ffffff';
      c.font = '700 17px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(`${h.n} \u00b7 par ${h.par} \u00b7 ${Math.round(h.cardYards)} yds`, x + TW / 2, y + TH + LAB / 2 + 2);
    }
  });
  return cv.toDataURL('image/png');
}, { courseId: COURSE, labels: LABELS });

fs.mkdirSync('.visual-out', { recursive: true });
const out = `.visual-out/${COURSE}-holes.png`;
fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`wrote ${out}`);
await b.close();
