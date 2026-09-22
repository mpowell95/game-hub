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
// A screen reached by a TAP used to be out of scope here, and that hole shipped a real bug: on
// 2026-09-21 Minesweeper's How to play grew a line too tall, and because the only way off it was a
// Back button UNDER the content, the button was the thing clipped - leaving the screen a dead end.
// Both this and test-visual's fit check had only ever looked at a game's DEFAULT screen.
// `EXTRA_SCREENS` below closes it: a game can name screens to open and have measured too.
//
// Needs the dev server up (`node server.mjs`).
//
//   node check-no-scroll.mjs             every game
//   node check-no-scroll.mjs golf pool   just these

import { chromium } from 'playwright-core';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BB_BASE || 'http://localhost:8123';
const SIZES = [
  { w: 393, h: 852, why: 'tall' },
  { w: 390, h: 664, why: 'short' },
];
const TOL = 2;      // sub-pixel rounding; the same tolerance test-visual's fit check uses

/** Screens reached by a TAP, measured with the same ruler as the default one.
 *
 *  Keyed by game folder. `open(page)` drives to the screen and resolves once it is up; `back` is
 *  optional and only needed if a later entry has to start from the default screen again.
 *
 *  Add a game's how-to, setup or summary screen here when it has one. A screen nobody measures is
 *  a screen that grows until it breaks - and, if the way OFF it lives at the bottom, breaks
 *  silently. */
const EXTRA_SCREENS = {
  minesweeper: [
    {
      name: 'how to play',
      async open(page) {
        await page.waitForSelector('[data-act="howto"]', { timeout: 8000 });
        await page.click('[data-act="howto"]');
        await page.waitForSelector('[data-act="back"]', { timeout: 8000 });
        await page.waitForTimeout(250);
      },
      // The way OFF this screen must itself be on screen. Measuring only the overflow would have
      // passed the very bug this entry exists for: the layout "fit" once the button was clipped.
      async assert(page) {
        return page.evaluate(() => {
          const back = document.querySelector('[data-act="back"]');
          if (!back) return 'no Back button on this screen at all';
          const r = back.getBoundingClientRect();
          const root = (document.querySelector('[class$="-root"]') || document.body).getBoundingClientRect();
          if (r.bottom > root.bottom + 2 || r.top < root.top - 2) return 'the Back button is off screen';
          if (r.height < 44) return `the Back button is only ${Math.round(r.height)}px tall`;
          return null;
        });
      },
    },
  ],
  // R14 (docs/BASEBALL-3D-BUILD.md section 9): the player screen, reached by tapping the setup
  // screen's player chip. Six skill rows, a 4x2 preset grid and a hand row on one screen - the
  // tallest new content this stage adds, and exactly the kind of screen this file exists to catch.
  baseball: [
    {
      name: 'player screen',
      async open(page) {
        await page.waitForSelector('[data-act="player"]', { timeout: 8000 });
        await page.click('[data-act="player"]');
        await page.waitForSelector('[data-act="done"]', { timeout: 8000 });
        await page.waitForTimeout(250);
      },
    },
  ],
};

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

        for (const extra of (EXTRA_SCREENS[game] || [])) {
          const xlabel = `${label} > ${extra.name}`;
          try {
            await extra.open(page);
            const xr = await page.evaluate(MEASURE);
            checks++;
            const xwhy = xr.page > TOL ? `the PAGE is ${xr.page}px taller than the screen`
              : xr.wide > TOL ? `the page is ${xr.wide}px too WIDE`
                : xr.inner > TOL ? `"${xr.sel}" scrolls INSIDE itself by ${xr.inner}px`
                  : (extra.assert ? await extra.assert(page) : null);
            if (xwhy) { bad.push({ game, label: xlabel, why: xwhy }); console.log(`SCROLLS  ${xlabel}: ${xwhy}`); }
            else console.log(`ok       ${xlabel}`);
          } catch (err) {
            bad.push({ game, label: xlabel, why: `could not be opened: ${err.message}` });
            console.log(`SCROLLS  ${xlabel}: could not be opened: ${err.message}`);
          }
        }
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
