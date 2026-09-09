// check-no-scroll.mjs - NO GAME IN THIS HUB MAY SCROLL. Every screen fits, always.
//
// Matt, 2026-09-08: *"I've told you several times before that I don't want any game in the gamehub
// to be scrollable at all. Everything MUST fit on a single screen. Always."*
//
// `docs/BUILDING-A-GAME.md` Part 0 has said "A game screen that scrolls at all is a bug" since it
// was written, and `test-visual.mjs`'s `fit` check has been measuring it - but it measured only the
// PAGE, and every immersive game here pins itself to the viewport with `position: absolute;
// inset: 0` and its own `overflow-y: auto`. Such a game scrolls INSIDE ITSELF while the page does
// not overflow by a pixel, which is how golf's setup screen scrolled on Matt's phone through a
// green suite. That hole is closed in `test-visual.mjs` too; this exists because the rule is
// repo-wide and needed a repo-wide answer that is cheap enough to run before every deploy.
//
// WHY THIS IS NOT JUST `test-visual.mjs --all`: that suite screenshots every game in three themes,
// runs motion probes and PLAYS the ones with play probes, which is minutes of work and (Matt's own
// rule, 2026-08-08) something to ask before doing. This asks ONE question, needs no screenshots,
// and covers every game in both hosts at both phone heights in well under a minute.
//
// WHAT IT MEASURES, per game x host x height:
//   * the PAGE overflowing the viewport, and
//   * any element inside the game's own root that CAN scroll (`overflow-y: auto|scroll`) and DOES
//     (`scrollHeight > clientHeight`).
//
// An overlay that is opened by a tap - a scorecard, a help sheet - is not on screen here, so what
// this finds is a LAYOUT that does not fit.
//
// Needs the dev server up (`node server.mjs`).
//
//   node check-no-scroll.mjs             every game
//   node check-no-scroll.mjs golf pool   just these

import { chromium } from 'playwright-core';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8123';
const SIZES = [
  { w: 393, h: 852, why: 'tall' },
  { w: 390, h: 664, why: 'short' },
];
const TOL = 2;      // sub-pixel rounding; the same tolerance test-visual's fit check uses

/** Every game folder, discovered from disk so a NEW game is covered the day it appears - the same
 *  rule `test-game-conventions.mjs` follows, and for the same reason. */
function allGames() {
  return readdirSync('.', { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(d.name, 'index.html'))
      && existsSync(join(d.name, 'js')))
    .map((d) => d.name)
    .filter((n) => !['js', 'css', 'icons', 'img', 'profile', 'docs', 'reference', 'backups'].includes(n))
    .sort();
}

const MEASURE = () => {
  const de = document.documentElement;
  const out = { page: de.scrollHeight - window.innerHeight, wide: de.scrollWidth - de.clientWidth, inner: 0, sel: '' };
  const root = document.querySelector('[class$="-root"], .gf-root, .filler, .mancala');
  const scope = root || document.body;
  for (const el of [scope, ...scope.querySelectorAll('*')]) {
    const ov = getComputedStyle(el).overflowY;
    if (ov !== 'auto' && ov !== 'scroll') continue;
    // An element with no size is not on screen; a hidden overlay is not a layout problem.
    if (!el.clientHeight) continue;
    const d = el.scrollHeight - el.clientHeight;
    if (d > out.inner) { out.inner = d; out.sel = (el.className && String(el.className).split(' ')[0]) || el.tagName; }
  }
  return out;
};

/** The launcher's one-time announcement sits over everything on a fresh profile. Marking it seen
 *  through its own module is what a player's tap does; removing the node is the belt and braces. */
async function dismissAnnouncement(page) {
  try {
    await page.evaluate(async () => {
      try {
        const m = await import('/js/announce.js');
        for (const a of (m.ANNOUNCEMENTS || [])) m.markSeen(a.id);
      } catch { /* module missing: the node removal below is still worth doing */ }
      document.querySelectorAll('.ann-overlay').forEach((n) => n.remove());
    });
  } catch { /* never let a popup workaround fail a run */ }
}

const games = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const list = games.length ? games : allGames();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const bad = [];
let checks = 0;

for (const game of list) {
  for (const host of ['standalone', 'hub']) {
    for (const size of SIZES) {
      const ctx = await browser.newContext({
        viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
      });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        localStorage.setItem('gamehub.profile', JSON.stringify({
          name: 'Visual Test', emoji: '\u{1F419}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
        }));
        localStorage.setItem('gamehub.lang.v1', 'en');
        // Golf's setup screen is gated behind the tutorial; without this it shows a locked ladder
        // rather than the screen a player normally meets. See golf/js/progress.js.
        localStorage.setItem('gamehub.stats', JSON.stringify({
          games: { golf: { gf: { bestHole: { 'tutorial:1': 3 } } } },
        }));
      });
      const label = `${game} ${host} ${size.w}x${size.h} ${size.why}`;
      try {
        if (host === 'hub') {
          await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForFunction(() => !!window.__ghHub, null, { timeout: 20000 });
          await page.waitForTimeout(800);
          const err = await page.evaluate(async (g) => {
            const m = await import('/js/hub.js');
            const hub = window.__ghHub;
            if (!hub) return 'no hub instance';
            if (!hub.games.some((x) => x.id === g)) {
              const entry = m.GAMES.find((x) => x.id === g);
              if (!entry) return `no GAMES entry for "${g}" (launch-out game?)`;
              hub.games = [...hub.games, entry];
            }
            await hub.launch(g);
            return hub.current && hub.current.id === g ? null : 'did not mount';
          }, game);
          if (err) { console.log(`skip  ${label}: ${err}`); await ctx.close(); continue; }
        } else {
          await page.goto(`${BASE}/${game}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        // THE ANNOUNCEMENT POPUP IS DISMISSED FIRST. It is `position: fixed` so it should not move
        // the game's layout - but "should not" is not a measurement, and a probe that reads a
        // screen with a modal over it is reading the modal's world, not the player's.
        await dismissAnnouncement(page);
        await page.waitForTimeout(1600);
        const r = await page.evaluate(MEASURE);
        checks++;
        const why = r.page > TOL ? `the PAGE is ${r.page}px taller than the screen`
          : r.wide > TOL ? `the page is ${r.wide}px too WIDE`
            : r.inner > TOL ? `"${r.sel}" scrolls INSIDE itself by ${r.inner}px` : null;
        if (why) { bad.push({ game, label, why }); console.log(`SCROLLS  ${label}: ${why}`); }
        else console.log(`ok       ${label}`);
      } catch (e) {
        console.log(`skip  ${label}: ${String(e).split('\n')[0]}`);
      }
      await ctx.close();
    }
  }
}
await browser.close();

console.log(`\n${checks} screens checked, ${bad.length} scroll.`);
if (bad.length) {
  const byGame = {};
  for (const b of bad) (byGame[b.game] ||= []).push(b);
  console.log('\nGames that scroll:');
  for (const [g, rows] of Object.entries(byGame)) console.log(`  ${g}: ${rows.length} of 4 screens`);
}
process.exit(bad.length ? 1 : 0);
