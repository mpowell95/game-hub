// Checks every sheet of the v6 mockup against the handoff's design rules, at 360 px, EN and ES,
// then writes the screenshots to this folder (lb-points-info-v6-*.jpg). Usage: node docs/mockups/lb-points-info-v6.review.mjs
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(pathToFileURL(path.join(process.cwd(), 'x.js')).href);   // playwright-core from the cwd (npm i --no-save playwright-core)
const { chromium } = require('playwright-core');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.argv[2] || path.join(HERE, 'lb-points-info-v6.html'), OUT = process.argv[3] || HERE;
const URL0 = pathToFileURL(FILE).href;
const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
let fails = 0;
const bad = (m) => { fails++; console.log('FAIL ' + m); };

for (const L of ['en', 'es']) {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(URL0 + '?lang=' + L);
  const res = await page.evaluate((L) => {
    const out = { sheets: [], pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    for (const ph of document.querySelectorAll(`.phone[data-lang="${L}"]`)) {
      const s = { game: ph.dataset.game, problems: [], words: 0 };
      const txt = ph.innerText;
      s.words = (ph.querySelector('.lead').nextElementSibling ? [...ph.querySelectorAll('.card')].map((c) => c.innerText).join(' ') : '').split(/\s+/).filter(Boolean).length;
      // overflow + clipping at 360
      for (const el of ph.querySelectorAll('*')) {
        if (el.closest('svg')) continue;
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && el.tagName !== 'svg') s.problems.push('clipped: ' + (el.className || el.tagName) + ' "' + el.textContent.slice(0, 30) + '"');
        const r = el.getBoundingClientRect(), pr = ph.getBoundingClientRect();
        if (r.width && (r.right > pr.right + 0.5 || r.left < pr.left - 0.5)) s.problems.push('outside sheet: ' + (el.className || el.tagName));
        if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 11) s.problems.push(`text ${fs}px: "${el.textContent.slice(0, 20)}"`);
        }
      }
      if (Math.round(ph.getBoundingClientRect().width) !== 360) s.problems.push('sheet is not 360 wide: ' + ph.getBoundingClientRect().width);
      // rule 1: every row = label + "<n> point(s)"
      const rows = [...ph.querySelectorAll('.r')];
      for (const r of rows) {
        const lb = r.querySelector('.lb'), p = r.querySelector('.p');
        const want = L === 'en' ? /^\d+ points?$/ : /^\d+ puntos?$/;
        if (!lb || !lb.textContent.trim()) s.problems.push('row without label');
        if (!p || !want.test(p.textContent.trim())) s.problems.push('row number not "N points": ' + (p && p.textContent));
        const n = +p.dataset.pts; if ((n === 1) !== /^1 /.test(p.textContent.trim())) s.problems.push('singular/plural: ' + p.textContent);
        if (!r.querySelector('.ic')) s.problems.push('row without icon slot');
      }
      // rule 2: card order easiest -> hardest, then table/old, online, limit last; titles; tags on easier/harder cards
      const kinds = [...ph.querySelectorAll('.card')].map((c) => (c.classList.contains('k-cap') ? 'limit' : c.classList.contains('k-s') ? 's' : c.classList.contains('k-n') ? 'n' : c.classList.contains('k-h') ? 'h' : /Online|En línea/.test(c.querySelector('.ct').textContent) ? 'online' : 'x'));
      const rank = { s: 0, n: 1, h: 2, x: 3, online: 4, limit: 5 };
      for (let i = 1; i < kinds.length; i++) if (rank[kinds[i]] < rank[kinds[i - 1]]) s.problems.push('card order ' + kinds.join(','));
      for (const c of ph.querySelectorAll('.card')) {
        if (!c.querySelector('.ct, .lim.big') || !c.querySelector('.ch').textContent.trim()) s.problems.push('card without title');
        if ((c.classList.contains('k-s') || c.classList.contains('k-n') || c.classList.contains('k-h')) && !c.querySelector('.tag')) s.problems.push('coloured card without tag word: ' + c.querySelector('.ct').textContent);
      }
      for (const r of ph.querySelectorAll('.card.k-s .r, .card.k-n .r, .card.k-h .r')) {
        const lb = r.querySelector('.lb').textContent;
        if (/(Win on|Victoria en) /.test(lb) && !r.querySelector('.sh')) s.problems.push('level row without shape: ' + lb);
      }
      // rule 3: never "one level lower"
      if (/lower|one level|level down|un nivel|nivel menos|cuenta como|counts as/i.test(txt)) s.problems.push('relative-level wording');
      // rule 4: limit tag on capped rows <=> limit box; box says why
      const capped = ph.querySelectorAll('.r .lim').length, box = ph.querySelector('.k-cap');
      if (!!capped !== !!box) s.problems.push(`limit rows ${capped}, box ${!!box}`);
      if (box && !/(nearly guaranteed|casi seguras)/.test(box.textContent)) s.problems.push('limit box without why');
      if (box && !/(Together|Juntas)/.test(box.textContent)) s.problems.push('limit box does not say shared');
      s.capped = capped;
      // repo copy rules: no em dashes
      if (/\u2014/.test(txt)) s.problems.push('em dash');
      // rule 6: no English left in Spanish
      if (L === 'es' && /\b(Win|points?|Easy|Medium|Hard|Expert|Online|computers?|board|Shorter|Longer|Easier|Harder|Normal limit|Done|reracks|goals?|racks?|timer|rounds)\b/.test(txt.replace(/Cricket|Cup Pong|Connect 4 Hoops|Monopoly Deal|Boggle|Filler|Mancala|Uno|Yahtzee|Escoba|Parchís|Chinchón/g, ''))) s.problems.push('English in ES: ' + txt.match(/\b(Win|points?|Easy|Medium|Hard|Expert|Online|computers?|board|Shorter|Longer|Easier|Harder|Done|reracks|goals?|racks?|timer|rounds)\b/)[0]);
      // tap target
      const d = ph.querySelector('.done').getBoundingClientRect(); if (d.height < 44) s.problems.push('Done under 44px');
      out.sheets.push(s);
    }
    return out;
  }, L);
  if (res.pageOverflow) bad(`${L}: page scrolls sideways at 360`);
  console.log(`\n== ${L.toUpperCase()} at 360 px: ${res.sheets.length} sheets`);
  for (const s of res.sheets) {
    console.log(`${s.problems.length ? 'FAIL' : ' ok '} ${s.game.padEnd(12)} words ${String(s.words).padStart(3)}  limit-rows ${s.capped}${s.problems.length ? '  ' + [...new Set(s.problems)].join(' | ') : ''}`);
    if (s.problems.length) fails++;
  }
  await page.close();
}

// screenshots: 5 sheets a row, two images per language
const page = await browser.newPage({ viewport: { width: 1928, height: 1200 }, deviceScaleFactor: 1 });
for (const L of ['en', 'es']) {
  await page.goto(URL0 + '?lang=' + L);
  for (const i of [1, 2]) {
    const f = path.join(OUT, `lb-points-info-v6-${L}-${i}.jpg`);
    await page.locator(`#${L}-${i}`).screenshot({ path: f, type: 'jpeg', quality: 90 });
    console.log('shot', path.basename(f), (statSync(f).size / 1024).toFixed(0) + ' KB');
  }
}
// one 360 px phone-width proof per language (the tallest sheet, Cup Pong)
const ph = await browser.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
for (const L of ['en', 'es']) {
  await ph.goto(URL0 + '?lang=' + L);
  const f = path.join(OUT, `lb-points-info-v6-360-${L}-cuppong.jpg`);
  await ph.locator(`.phone[data-lang="${L}"][data-game="cuppong"]`).screenshot({ path: f, type: 'jpeg', quality: 90 });
  console.log('shot', path.basename(f), (statSync(f).size / 1024).toFixed(0) + ' KB');
}
await browser.close();
console.log(fails ? `\n${fails} FAIL(S)` : '\nALL CHECKS PASS');
process.exit(fails ? 1 : 0);
