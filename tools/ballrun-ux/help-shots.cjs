// Ball Run How to play, checked and shot (2026-11-17). Dev only.
// Opens the real page as test1 / DREG5 with sync off, as an admin device (cues on), steps every help page
// on both maps at 402x874 and 390x664, measures what must hold (no scroll, every card the same size,
// captions on one line, buttons >= 44 px, title >= 24 px, caption >= 17 px) and screenshots each page.
//   BASE=http://localhost:8123 node tools/ballrun-ux/help-shots.cjs <outDir>
// With COMPARE=<base url of a main checkout> it also proves the PLAYERS' help (cues off) renders the same
// HTML on both servers.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8123';
const OUT = process.argv[2] || path.join(process.cwd(), '.visual-out', 'ballrun-help');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

async function openHelp(browser, { w, h, admin, map, lang, base = BASE }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  await ctx.addInitScript(({ admin, map, lang }) => {
    try {
      localStorage.setItem('gamehub.devAllowSync.v1', '0');
      localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'test1', emoji: '🙂', playerId: 'DREG5', opponents: [] }));
      if (admin) localStorage.setItem('gamehub.adminDevice.v1', '1');
      localStorage.setItem('ballrun.map', map);
      localStorage.setItem('ballrun.seenHelp', '1');
      localStorage.setItem('gamehub.lang.v1', lang);
    } catch {}
  }, { admin, map, lang });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}/ball-run/`);
  await page.waitForSelector('[data-role="help-open"]');
  await page.click('[data-role="help-open"]');
  await page.waitForSelector('.br-help-overlay:not([hidden])');
  return { ctx, page };
}

async function measure(page) {
  return page.evaluate(async () => {
    const img = document.querySelector('.br-help-img');
    if (img && !img.complete) await new Promise((r) => { img.onload = img.onerror = r; });
    const q = (s) => document.querySelector(s);
    const card = q('.br-help-card').getBoundingClientRect();
    const panel = q('.br-help-panel').getBoundingClientRect();
    const text = q('.br-help-text');
    const cs = getComputedStyle(text);
    const btns = [...document.querySelectorAll('.br-help-nav .br-btn')].map((b) => b.getBoundingClientRect().height);
    return {
      card: [Math.round(card.width), Math.round(card.height)],
      panelTop: Math.round(panel.top), panelBottom: Math.round(panel.bottom),
      textOverflow: text.scrollWidth - text.clientWidth, caption: text.textContent,
      captionPx: parseFloat(cs.fontSize), titlePx: parseFloat(getComputedStyle(q('.br-help-title')).fontSize),
      minBtn: Math.min(...btns), imgOk: img ? img.naturalWidth : -1,
      docScroll: document.documentElement.scrollHeight - innerHeight,
      overlayScroll: q('.br-help-overlay').scrollHeight - q('.br-help-overlay').clientHeight,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [w, h] of [[402, 874], [390, 664]]) {
    for (const [map, lang] of [['orbital', 'en'], ['classic', 'en'], ['orbital', 'es']]) {
      const { ctx, page } = await openHelp(browser, { w, h, admin: true, map, lang });
      const n = await page.$$eval('.br-help-dots .br-dot', (d) => d.length);
      check(n === (map === 'orbital' ? 8 : 4), `${w}x${h} ${map} ${lang}: ${n} pages`);
      const sizes = new Set();
      for (let i = 1; i <= n; i++) {
        const m = await measure(page);
        sizes.add(m.card.join('x'));
        const tag = `${w}x${h} ${map} ${lang} page ${i} "${m.caption}"`;
        check(m.textOverflow <= 0, `${tag}: caption on one line (overflow ${m.textOverflow}px)`);
        check(m.docScroll <= 0 && m.overlayScroll <= 0 && m.panelTop >= 0 && m.panelBottom <= h, `${tag}: fits, no scroll (panel ${m.panelTop}-${m.panelBottom})`);
        check(m.imgOk === 720, `${tag}: picture loaded (${m.imgOk}px wide)`);
        if (i === 1) check(m.captionPx >= 17 && m.titlePx >= 24 && m.minBtn >= 44, `${w}x${h} ${map} ${lang}: caption ${m.captionPx}px, title ${m.titlePx}px, buttons ${Math.round(m.minBtn)}px`);
        const shoot = lang === 'en' ? (map === 'orbital' || w === 402) : (i === 6);
        if (shoot) await page.screenshot({ path: path.join(OUT, `help-${w}x${h}-${map}-${lang}-${i}.jpg`), type: 'jpeg', quality: 85 });
        if (i < n) { await page.click('[data-action="help-next"]'); await page.waitForTimeout(150); }
      }
      check(sizes.size === 1, `${w}x${h} ${map} ${lang}: every card the same size (${[...sizes].join(', ')})`);
      await ctx.close();
    }
  }
  if (process.env.COMPARE) {
    for (const map of ['orbital', 'classic']) {
      const grab = async (base) => {
        const { ctx, page } = await openHelp(browser, { w: 402, h: 874, admin: false, map, lang: 'en', base });
        const out = [];
        for (let i = 0; i < 4; i++) {
          out.push(await page.$eval('.br-help-overlay', (el) => el.outerHTML));
          if (i < 3) await page.click('[data-action="help-next"]');
        }
        out.push(await page.$eval('.br-help-overlay', (el) => JSON.stringify(getComputedStyle(el.querySelector('.br-help-card')).cssText || [...getComputedStyle(el.querySelector('.br-help-card'))].map((k) => k + ':' + getComputedStyle(el.querySelector('.br-help-card')).getPropertyValue(k)))));
        await ctx.close();
        return out;
      };
      const a = await grab(BASE), b = await grab(process.env.COMPARE);
      check(JSON.stringify(a) === JSON.stringify(b), `players' help (cues off), ${map}: HTML and card style identical to main`);
    }
  }
  await browser.close();
  console.log(failed ? `${failed} FAILED` : 'ALL OK');
  process.exit(failed ? 1 : 0);
})();
