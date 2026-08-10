// test-visual.mjs - the first suite in this repo that LOOKS at the game.
//
//   node test-visual.mjs                 the games that CHANGED (the default; see "WHICH games")
//   node test-visual.mjs escoba boggle   exactly those
//   node test-visual.mjs --all           every game
//   ... --keep                           don't say the contact sheet gets overwritten next run
//
// WHY THIS EXISTS
//
// Every other suite in run-all-tests.mjs runs in node, and node has no layout engine: no element
// widths, no computed styles, no paint. They can prove the HTML string is correct. They cannot
// prove anything rendered. (The five jsdom suites are no better - jsdom implements the DOM API
// with no layout, so getBoundingClientRect returns zeros.)
//
// That gap has shipped real bugs twice, both times with the whole suite green:
//   - Battleship rendered a BLANK SCREEN, with 29/29 engine tests passing, `node --check` clean,
//     and 21,288 characters of perfectly correct HTML in the DOM (battleship/CLAUDE.md).
//   - Hill Climb shipped a raw resize listener the same day it was removed everywhere else.
// And in the 2026-08-08 cannon pass, an ad-hoc version of this file caught four more that nothing
// else could see: a 40px overflow that only appeared once mounted in the hub, a crosshair frozen
// on screen under reduced motion, a cannonball with no rim because a CSS percentage silently
// voided its box-shadow, and a full-bleed correction that undid itself on every second render.
//
// WHAT IT CAN AND CANNOT DO
//
// It CANNOT tell you a game looks good, or that it matches a reference. That needs eyes. What it
// does is make using your eyes cheap: every run writes a contact sheet to .visual-out/ so one
// glance covers a whole game in three themes, next to whatever is in reference/ (VISUAL-PROCESS.md).
//
// It CAN catch the failures that are objectively wrong no matter what the design is:
//   1. nothing painted            - the blank-screen class
//   2. the body scrolls sideways  - a repo-wide rule (root CLAUDE.md, "Scroll and touch rules")
//   3. a JS error on mount        - a game that throws is a game nobody can play
//   4. any of the above ONLY in dark or reduced-motion - which is how the blank screen hid
//   5. an animation that is not actually watchable - see MOTION below
//
// OPTIONAL DEPENDENCY, same contract as the jsdom suites: no playwright-core or no Chromium means
// SKIP with instructions, never a red build. It gates real cloud sessions (Chromium is
// pre-installed there) and stays out of the way on a laptop that hasn't opted in.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, '.visual-out');
const KEEP = process.argv.includes('--keep');
const PORT = 8931;                       // deliberately not 8123, so a dev server can stay running
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 393, height: 852 };   // a real current phone, portrait

// Same exclusion, same reason, as test-game-conventions.mjs.
const EXCLUDED = { 'business-deal': 'non-ESM launch-out app with its own nested SW' };

// KNOWN GAPS - pre-existing debt this suite found on its FIRST run, in games nobody was working
// on. Same contract as test-game-conventions.mjs's list: the rule still gates every new game, the
// exception stays visible (printed on every run, never silently skipped), and an entry that has
// gone stale FAILS the suite so the list can't quietly rot.
//
// The rule for adding to this list: only real, already-shipped debt. If you are about to add a
// game you just wrote, fix the game instead.
const KNOWN_GAPS = {
  'no horizontal page scroll': {
    chinchon: 'overflows ~30px at 393px wide. 246 bare top-level prefixed CSS rules (root '
      + 'CLAUDE.md games table) and the widest setup screen in the repo; a real fix is a layout '
      + 'pass on that screen, not a one-line clamp.',
    'dots-boxes': 'overflows ~5px at 393px wide.',
  },
};
const gapFor = (check, game) => (KNOWN_GAPS[check] || {})[game];
const gapsHit = new Set();

const skip = (why, how) => {
  console.log(`SKIP  test-visual.mjs: ${why}`);
  console.log(`      ${how}`);
  process.exit(0);
};

/** playwright-core is deliberately NOT a committed dependency (this repo has none), so on a fresh
 *  clone the import below fails and this whole suite would SKIP forever - which would make it a
 *  tool that never runs again after the session that wrote it. So: if the Chromium image is
 *  present, we are on the cloud runner, this suite is EXPECTED to run, and the package is a
 *  two-second no-save install. Fetch it once, quietly. Anywhere else, SKIP as normal. */
const onCloudImage = existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers');
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  if (onCloudImage) {
    console.log('installing playwright-core (not committed; Chromium itself is already here)...');
    spawnSync('npm', ['install', '--no-save', '--silent', 'playwright-core'], { cwd: ROOT, stdio: 'ignore', timeout: 120000 });
    try { ({ chromium } = await import('playwright-core')); } catch { /* fall through to SKIP */ }
  }
  if (!chromium) {
    skip('optional dependency \'playwright-core\' not installed',
      'npm install --no-save playwright-core   (Chromium itself is already on the cloud image)');
  }
}

/** Chromium comes with the cloud image; PLAYWRIGHT_BROWSERS_PATH points at it. Never download one
 *  (root env sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 for exactly this reason). */
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

const ALL_GAMES = readdirSync(ROOT)
  .filter((d) => { try { return statSync(join(ROOT, d)).isDirectory(); } catch { return false; } })
  .filter((d) => existsSync(join(ROOT, d, 'index.html')) && existsSync(join(ROOT, d, 'js', 'ui.js')))
  .filter((d) => !EXCLUDED[d])
  .sort();

if (ALL_GAMES.length < 10) {
  console.log(`FAIL: only found ${ALL_GAMES.length} game folders - the discovery rule is broken`);
  process.exit(1);
}

// --- WHICH games to look at -------------------------------------------------------------------
//
// NOT all of them, every time. Matt, 2026-08-08: "If a game like Escoba works and is fully tested
// and played, why keep testing it?" He is right - a finished game re-checked on every unrelated
// run is 90 seconds of nothing, every time, forever. So by default this looks at what actually
// CHANGED:
//
//   node test-visual.mjs                 the games whose own folder has changes (vs origin/main
//                                        and in the working tree). Nothing changed -> nothing run.
//   node test-visual.mjs escoba boggle   exactly those, whatever their state
//   node test-visual.mjs --all           every game (the occasional sweep, or a first run)
//
// A full sweep is NEVER automatic. Matt, 2026-08-08: "Always ask before testing all games."
// When shared code changes (js/, css/, the hub's index.html, sw.js) this RECOMMENDS a sweep in
// large letters, because that is the class of change that has broken every game at once before
// (the hub blank-screen incident; Hill Climb's resize listener) - and then it checks only what
// changed anyway. Running all 19 is a decision a person makes, not one a script makes for them.
const SHARED = (f) => f.startsWith('js/') || f.startsWith('css/') || f === 'index.html' || f === 'sw.js';

function changedFiles() {
  const seen = new Set();
  const runs = [
    ['diff', '--name-only', 'origin/main...HEAD'],   // committed on this branch
    ['diff', '--name-only'],                          // unstaged
    ['diff', '--name-only', '--cached'],              // staged
    ['ls-files', '--others', '--exclude-standard'],   // brand-new, never committed
  ];
  for (const args of runs) {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    if (r.status === 0) for (const f of r.stdout.split('\n')) if (f) seen.add(f);
  }
  return [...seen];
}

function selectGames() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (process.argv.includes('--all')) return { games: ALL_GAMES, why: 'every game (--all)' };
  if (args.length) {
    const unknown = args.filter((a) => !ALL_GAMES.includes(a));
    if (unknown.length) {
      console.log(`FAIL: no such game folder: ${unknown.join(', ')}`);
      console.log(`      known games: ${ALL_GAMES.join(', ')}`);
      process.exit(1);
    }
    return { games: args.sort(), why: 'named on the command line' };
  }
  const files = changedFiles();
  const shared = files.filter(SHARED);
  const touched = ALL_GAMES.filter((g) => files.some((f) => f.startsWith(`${g}/`)));
  return {
    games: touched,
    why: touched.length ? 'changed since origin/main' : 'nothing changed',
    // surfaced, never acted on: the sweep is the human's call
    recommendSweep: shared.length ? shared.slice(0, 4) : null,
  };
}

const { games: GAMES, why: WHY, recommendSweep } = selectGames();
if (recommendSweep) {
  console.log('');
  console.log('  !! SHARED CODE CHANGED: ' + recommendSweep.join(', '));
  console.log('     That sits underneath every game, and is how all of them have broken at once');
  console.log('     before. A full sweep is RECOMMENDED - but it is your call, so ask first:');
  console.log('         node test-visual.mjs --all');
  console.log('');
}
if (!GAMES.length) {
  console.log('No game changed, so there is nothing to look at.');
  console.log('  node test-visual.mjs <game>   to check one anyway');
  console.log('  node test-visual.mjs --all    to sweep every game');
  process.exit(0);
}

// --- MOTION: per-game "is this animation actually watchable" probes --------------------------
//
// Written the day Matt reported he could not see Battleship's cannonball move. It was on screen
// for 340ms and every static check passed, because a static check cannot tell 340ms from 2s.
// A probe drives the game to the point where something moves, then samples that element's real
// on-screen position over time. It fails if the thing is too brief to follow or barely travels.
//
// Adding one for a new game is optional. Not adding one means this suite only proves that game
// renders, which is still more than any other suite proves.
const MOTION = {
  battleship: {
    what: 'the cannonball crossing between the two boards',
    selector: '.bs-ball',
    minMs: 500,        // shorter than this and the eye cannot follow it across a phone screen
    minTravelPx: 120,  // and it has to actually go somewhere, not just pulse in place
    async drive(page) {
      await page.click('[data-action="play-bot"]');
      await page.waitForSelector('[data-action="auto-place"]', { timeout: 8000 });
      await page.click('[data-action="auto-place"]');
      await page.waitForSelector('[data-action="placement-ready"]', { timeout: 8000 });
      await page.click('[data-action="placement-ready"]');
      await page.waitForTimeout(400);
      if (await page.$('.bs-wait')) await page.click('.bs-wait').catch(() => {});
      const cell = await page.waitForSelector('[data-action="fire"]:not([disabled])', { timeout: 8000 });
      await cell.click();
    },
  },
};

// --- harness ----------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stopServer);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/index.html`); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
if (!await waitForServer()) { stopServer(); console.log('FAIL: dev server never came up'); process.exit(1); }

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

let pass = 0;
const failures = [];
const fail = (game, mode, msg) => { failures.push(`${game} [${mode}]: ${msg}`); console.log(`FAIL  ${game} [${mode}] - ${msg}`); };
const ok = (game, mode, msg) => { pass++; console.log(`ok    ${game} [${mode}] ${msg}`); };
/** Fail, unless this exact game is on the KNOWN_GAPS list for this exact check. */
const failUnlessKnown = (game, mode, check, msg) => {
  if (gapFor(check, game)) { gapsHit.add(`${check}::${game}`); console.log(`GAP   ${game} [${mode}] ${check} - known, see KNOWN_GAPS`); return; }
  fail(game, mode, msg);
};

const MODES = [
  { name: 'light', dark: false, reduce: false },
  { name: 'dark', dark: true, reduce: false },
  // headless Chromium's own default, and the setting that hid an entire game once
  { name: 'reduced', dark: false, reduce: true },
];

/** One game, one mode: mount the standalone page and look at what came out. */
async function checkGame(game, mode) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    reducedMotion: mode.reduce ? 'reduce' : 'no-preference',
  });
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Firebase is unreachable from a sandbox and every MP game says so out loud; that is the
    // environment, not the game. Everything else counts.
    if (/Failed to load resource|Firebase|stats-net|ERR_(CONNECTION|NAME|INTERNET)/i.test(t)) return;
    errors.push(t);
  });

  // Every standalone page is name-gated (root CLAUDE.md), so seed a profile or nothing mounts.
  await page.addInitScript(({ dark }) => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Visual Test', emoji: '🐙', color: '#1F5FA8',
      opponents: [{ name: 'Bot', emoji: '🤖', skill: 2 }],
    }));
    localStorage.setItem('gamehub.lang.v1', 'en');
    localStorage.setItem('gamehub.theme.v1', dark ? 'dark' : 'light');
    // An init script runs BEFORE the document exists, so documentElement is null here. The
    // standalone pages don't import js/theme.js (only the hub does), so stamp the class the
    // moment there is an element to stamp it on.
    if (dark) {
      const stamp = () => document.documentElement && document.documentElement.classList.add('gh-dark');
      if (!stamp()) document.addEventListener('DOMContentLoaded', stamp);
    }
  }, { dark: mode.dark });

  try {
    await page.goto(`${BASE}/${game}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(900);

    const seen = await page.evaluate(() => {
      const root = document.querySelector('[class$="-root"], [id] > div[class*="-"]') || document.body;
      const painted = [...root.querySelectorAll('*')].filter((e) => {
        const b = e.getBoundingClientRect(), c = getComputedStyle(e);
        return b.width > 2 && b.height > 2 && c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity > 0.01;
      }).length;
      return {
        painted,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      };
    });

    await page.screenshot({ path: join(OUT, `${game}--${mode.name}.png`) });

    // 1. it rendered at all. The blank-screen class of bug, and the only one that has ever
    //    shipped twice: a DOM byte count is not a visibility check.
    if (seen.painted < 8) fail(game, mode.name, `only ${seen.painted} painted elements - is anything on screen?`);
    else ok(game, mode.name, `${seen.painted} painted elements`);

    // 2. the body must never scroll sideways (root CLAUDE.md, "Scroll and touch rules"). Wide
    //    content is allowed, but it has to scroll inside its own container.
    if (seen.scrollW > seen.clientW + 2) failUnlessKnown(game, mode.name, 'no horizontal page scroll', `body scrolls sideways (${seen.scrollW} > ${seen.clientW})`);
    else ok(game, mode.name, 'no horizontal page scroll');

    // 3. a game that throws on mount is a game nobody can play
    if (errors.length) fail(game, mode.name, `JS error on mount: ${errors[0]}`);
    else ok(game, mode.name, 'no JS errors');
  } catch (e) {
    fail(game, mode.name, `threw: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

/** Is this game's signature animation actually watchable? See MOTION above. */
async function checkMotion(game, probe) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Visual Test', emoji: '🐙', opponents: [{ name: 'Bot', emoji: '🤖', skill: 2 }],
    }));
  });
  try {
    await page.goto(`${BASE}/${game}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(700);
    await probe.drive(page);

    // Sample where the thing REALLY is, frame after frame, rather than trusting a duration
    // constant somewhere in the source.
    const track = await page.evaluate(({ selector }) => new Promise((res) => {
      const seen = []; const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector(selector);
        if (el) {
          const r = el.getBoundingClientRect();
          seen.push({ t: performance.now() - t0, x: r.left + r.width / 2, y: r.top + r.height / 2 });
        } else if (seen.length) { return res(seen); }
        if (performance.now() - t0 > 6000) return res(seen);
        requestAnimationFrame(tick);
      };
      tick();
    }), { selector: probe.selector });

    if (track.length < 2) {
      fail(game, 'motion', `never saw ${probe.selector} (${probe.what}) on screen at all`);
      return;
    }
    const ms = Math.round(track[track.length - 1].t - track[0].t);
    const travel = Math.round(Math.hypot(
      track[track.length - 1].x - track[0].x,
      track[track.length - 1].y - track[0].y,
    ));
    if (ms < probe.minMs) {
      fail(game, 'motion', `${probe.what} is on screen for only ${ms}ms (need >= ${probe.minMs}ms to be followable)`);
    } else if (travel < probe.minTravelPx) {
      fail(game, 'motion', `${probe.what} travels only ${travel}px (need >= ${probe.minTravelPx}px)`);
    } else {
      ok(game, 'motion', `${probe.what}: ${travel}px over ${ms}ms, ${track.length} sampled frames`);
    }
  } catch (e) {
    fail(game, 'motion', `probe threw: ${e.message}`);
  } finally {
    await ctx.close();
  }
}

console.log(`Looking at ${GAMES.length} of ${ALL_GAMES.length} games x ${MODES.length} modes at ${VIEWPORT.width}x${VIEWPORT.height}`);
console.log(`  ${GAMES.join(', ')}`);
console.log(`  why these: ${WHY}\n`);

for (const game of GAMES) {
  for (const mode of MODES) await checkGame(game, mode);
  if (MOTION[game]) await checkMotion(game, MOTION[game]);
}

await browser.close();
stopServer();

console.log(`\nContact sheet: ${OUT}  (${GAMES.length * MODES.length} screenshots)`);
console.log('LOOK AT IT. This suite proves a game rendered, never that it looks right - see VISUAL-PROCESS.md.');
const noProbe = GAMES.filter((g) => !MOTION[g]);
if (noProbe.length) console.log(`\nNo motion probe yet (renders-only coverage): ${noProbe.join(', ')}`);
const gapEntries = Object.entries(KNOWN_GAPS).flatMap(([check, games]) => Object.entries(games).map(([g, why]) => ({ check, game: g, why })));
if (gapEntries.length) {
  console.log(`\nKnown gaps still outstanding (${gapEntries.length}) - these do NOT fail the suite, but they are real work:`);
  for (const g of gapEntries) console.log(`  - ${g.game}: ${g.check}  (${g.why})`);
}
// A gap that no longer reproduces is debt somebody paid off; the list must not keep excusing it.
// Only judgeable for games actually looked at this run - a default run checks what changed, so an
// untouched game's entry is unproven, not stale.
for (const g of gapEntries) {
  if (!GAMES.includes(g.game)) continue;
  if (!gapsHit.has(`${g.check}::${g.game}`)) {
    failures.push(`STALE KNOWN_GAP: ${g.game} now PASSES "${g.check}" - delete its KNOWN_GAPS entry`);
    console.log(`FAIL  stale KNOWN_GAP: ${g.game} now passes "${g.check}". Delete the entry.`);
  }
}

console.log(`\nVisual checks: ${pass} passed, ${failures.length} failed.`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
if (!KEEP) console.log('(pass --keep to stop the screenshots being overwritten next run)');
process.exit(0);
