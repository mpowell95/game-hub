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
  // Found 2026-08-10, the first time these three were ever put through the `fit` check - it was
  // built for Pool, and the suite only checks games whose own folder changed, so a game nobody has
  // touched since had simply never been measured. ALL THREE PREDATE the check and were verified
  // byte-identical on a stashed, untouched tree before being listed here; nothing in this session
  // caused them. They are real, though: this is exactly the "I couldn't see the full board and the
  // controls simultaneously" complaint that produced the check, and each needs its own layout pass
  // (the same measure-the-host work `_fitToHost`/`_fitBattleBoards` do) rather than a shared fix.
  // Battleship's entry is GONE (2026-08-11): it now fits both hosts at both heights. Nothing in
  // _fitBattleBoards changed -- the text cut did it. The status sentence, the two word-buttons and
  // the "N ships left to place" line were between 60 and 100px of vertical space that the boards
  // were competing with, and taking the words out gave it back. Worth knowing next time a screen
  // "needs a layout pass": sometimes it just needs fewer sentences.
  'fits one screen': {
    // 2026-09-01: went 154px -> 136px, and the other THREE cases now pass (both standalone
    // heights and the tall hub). What is left is not spacing: .cc-game measures 664px in the hub
    // against 526px of room, and the bulk is the hand (305px, cards 135px tall on two rows) and
    // the mat (217px). Chinchon's own .cc-compact latch is already applied and already spent.
    // Closing it means SHRINKING THE CARDS, which is a readability redesign of the game with the
    // most fragile CSS in the repo (246 bare top-level rules) and needs eyes on screenshots per
    // VISUAL-PROCESS.md - not a number nudged until a test goes green.
    chinchon: '136px too tall (hub, 390x664) only. Both standalone heights and the tall hub fit '
      + 'since 2026-09-01; the rest needs a card-size pass, not spacing.',
    escoba: 'up to 165px too tall (hub, 390x664). Fits fine at 393x852, both hosts.',
    mancala: 'up to 222px too tall (hub, 390x664), and 34px even on a TALL phone in the hub - the '
      + 'worst of the three, and the only one that overflows a full-size screen.',
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
      // Firing is two steps now: tap a square to aim, then FIRE to confirm (battleship/CLAUDE.md,
      // "Aim, then FIRE"). A probe that only taps the square never actually shoots.
      const cell = await page.waitForSelector('[data-action="fire"]:not([disabled])', { timeout: 8000 });
      await cell.click();
      await page.waitForSelector('[data-action="fire-confirm"]', { timeout: 10000 });
      await page.click('[data-action="fire-confirm"]');
    },
  },
  mancala: {
    // The sow IS the rule this page teaches - stones travelling one per pit around the board.
    // A still diagram of it is what the sheet this replaced already had, and nobody learned the
    // game from it. Watch the travelling stone actually travel.
    what: 'a stone travelling pit to pit as the sow plays out',
    selector: '.mc-ht-stone',
    minMs: 500,
    minTravelPx: 40,
    async drive(page) {
      await page.click('[data-action="help"]');
      await page.click('[data-action="ht-next"]');   // page 2 is the sow
    },
  },
  yahtzee: {
    // The HOW TO PLAY carousel is a clone of six screen recordings (reference/yahtzee/*.MOV) and
    // its whole job is to MOVE - the pointing hand travelling to a control and tapping it is the
    // teaching device. A frozen hand would still screenshot perfectly and teach nothing, which is
    // exactly the class of failure a static check cannot see.
    what: 'the pointing hand travelling across the how-to illustration',
    selector: '.yz-ht-hand',
    minMs: 500,
    minTravelPx: 40,   // the illustration is small; the hand crosses a third of it, not a screen
    async drive(page) {
      await page.click('[data-action="howto"]');
    },
  },
};

// --- PLAY: can a human actually play this game? ------------------------------------------------
//
// THE FAILURE THIS EXISTS FOR, stated plainly so nobody repeats it. On 2026-08-08 I promoted Pool
// over the old build, merged it, and deployed it to main WITHOUT EVER PLAYING A GAME OF IT. What I
// had was: it draws, it fits the screen, it throws no errors, in three themes. All true, all
// green, and none of it "a person can play this". My own screenshot showed the rack sitting
// untouched after the one shot I attempted; I decided my test drag was too weak and shipped.
//
// Matt had asked, two messages earlier, "or test playing it?" - I answered that the engines play
// themselves but the INTERFACE never does, identified the gap in a paragraph, and then did not
// build it. This is that thing, built.
//
// A probe drives a game through its real UI, with real touch, and asserts something CHANGED that
// only playing could change. Not "the button exists" - the ball moved, the shot landed, the
// opponent replied. Anything a person would notice if the game were dead on arrival.
//
// A game with no probe is listed at the end of every run under "NEVER PLAYED BY ANYTHING". That
// list is the honest state of this repo's coverage, and it should shrink.
const PLAY = {
  golf: {
    what: 'tee off, then hole out - the whole three-tap swing, tee to cup',
    async run(page, cdp, tap) {
      // The three-tap swing is this game's whole interface, and the failure it guards against is
      // specific: any one of the three taps landing in the wrong PHASE leaves the meter parked and
      // the ball never leaves the tee, with nothing on screen saying so. Driving it through the
      // real button is the only way to find that out.
      const practice = await page.$('[data-role="practice"]');
      if (!practice) return { ok: false, why: 'no "practice" button on the course card' };
      await tap(practice);
      // data-hole is the INDEX into the course's holes, not the hole number: "0" is hole 1. It
      // became an index when the courses grew to eighteen holes and the practice grid started
      // showing every one of them.
      const hole1 = await page.waitForSelector('[data-hole="0"]', { timeout: 8000 }).catch(() => null);
      if (!hole1) return { ok: false, why: 'the practice hole select never appeared' };
      await tap(hole1);
      await page.waitForSelector('[data-role="swing"]', { timeout: 8000 });
      await page.waitForTimeout(500);

      const read = () => page.evaluate(() => {
        const g = window.__gfTest;
        return g ? { ball: g.ball.slice(), shot: g.shotN, holed: g.holed, anim: !!g.anim, phase: g.swing.phase } : null;
      });
      const before = await read();
      if (!before) return { ok: false, why: 'the game exposed no state to drive (window.__gfTest)' };
      if (before.shot !== 1) return { ok: false, why: `mounted mid-hole: shot ${before.shot}` };

      // One full swing: tap to start the ring, tap to lock power, tap to stop the accuracy bar.
      // The gaps are deliberate - the ring must have moved off zero before tap 2, or this proves
      // nothing about the sweep.
      //
      // The three taps are: start the ring, lock the power, stop the accuracy bar. The gap before
      // tap 2 IS the power, so it is a parameter - a probe that always waits the same 260 ms can
      // only ever hit one power, and once putting scaled its range to the putt in hand (so the cup
      // sits near 71 % rather than at whatever fraction of a fixed 60 ft) that one power was short
      // of every putt, fourteen times in a row. Tap 3 follows tap 2 as fast as the harness can
      // manage, which leaves the accuracy bar near its centre.
      const swing = async (powerMs = 260, accMs = 220) => {
        const b = await page.$('[data-role="swing"]');
        for (const wait of [powerMs, accMs, 0]) {
          const box = await b.boundingBox();
          await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
          if (wait) await page.waitForTimeout(wait);
        }
      };
      await swing();
      await page.waitForTimeout(300);
      const struck = await read();
      if (!struck.anim && struck.shot === 1) {
        return { ok: false, why: 'three taps on "swing" and the ball never left the tee (the meter never fired)' };
      }
      // Let the flight land and the post-shot input lock expire.
      await page.waitForTimeout(6500);
      const after = await read();
      const moved = Math.hypot(after.ball[0] - before.ball[0], after.ball[1] - before.ball[1]);
      if (moved < 50) return { ok: false, why: `the tee shot moved the ball only ${moved.toFixed(1)} yds` };
      if (after.shot !== 2) return { ok: false, why: `the shot counter did not advance (still ${after.shot})` };

      // Now hole out: drop the ball beside the cup through the real state and putt it in, so the
      // putt path, the cup capture and the holed flag are all exercised, not just the full swing.
      await page.evaluate(() => {
        const g = window.__gfTest;
        g.ball = [g.hole.pin[0], g.hole.pin[1] - 2.2];
        g.aimRad = Math.atan2(g.hole.pin[0] - g.ball[0], g.hole.pin[1] - g.ball[1]);
        g._paintHud();
      });
      const onGreen = await page.evaluate(() => window.__gfTest._onGreen());
      if (!onGreen) return { ok: false, why: 'placed beside the cup and the lie lookup did not say "green"' };
      const unit = await page.$eval('[data-role="dist"]', (el) => el.textContent);
      if (!/ft/.test(unit)) return { ok: false, why: `on the green the distance still reads in yards: "${unit}"` };

      // How long to hold the ring for THIS putt, read the way a player reads the meter: the power
      // that reaches the cup, converted to milliseconds through the ring's own sweep. The attempts
      // then walk either side of it, because the harness's tap round-trip is worth tens of ms and
      // the point of the probe is "a putt can drop", not "the harness has perfect hands".
      const pin = await page.evaluate(() => window.__gfTest.hole.pin.slice());
      const targetMs = await page.evaluate(async () => {
        const g = window.__gfTest;
        const S = await import('./js/shot.js');
        const W = await import('./js/swing.js');
        const ft = g._distToPin() * 3;
        const need = ft / S.puttRangeFt(ft);
        return (need / W.RING_MAX) * 825;
      });
      const tries = [0, -50, 50, -100, 100, -150, 150, -25, 25, -75, 75, -125, 125, -175]
        .map((d) => Math.max(20, Math.round(targetMs + d)));
      let holed = false;
      let closest = Infinity;
      for (const powerMs of tries) {
        if (holed) break;
        await page.evaluate(() => {
          const g = window.__gfTest;
          g.ball = [g.hole.pin[0], g.hole.pin[1] - 2.2];
          g.aimRad = Math.atan2(g.hole.pin[0] - g.ball[0], g.hole.pin[1] - g.ball[1]);
          g.swing.reset();
        });
        await swing(powerMs, 0);
        await page.waitForTimeout(3800);
        const st = await read();
        holed = st.holed;
        closest = Math.min(closest, Math.hypot(st.ball[0] - pin[0], st.ball[1] - pin[1]) * 3);
      }
      if (!holed) {
        return { ok: false, why: `${tries.length} putts from 6 ft around the ${Math.round(targetMs)} ms the meter says it needs, and not one of them dropped (closest ${closest.toFixed(1)} ft)` };
      }
      return { ok: true, why: `drove ${moved.toFixed(0)} yds off the tee, then holed out` };
    },
  },
  pool: {
    what: 'break the rack, then get a shot back from the computer',
    async run(page, cdp, tap) {
      const start = await page.$('[data-role="start-ai"]');
      if (!start) return { ok: false, why: 'no "vs. computer" button on the mode screen' };
      await tap(start);
      await page.waitForSelector('[data-role="canvas"]', { timeout: 8000 });
      await page.waitForTimeout(1200);
      const g = await page.evaluate(() => { const r = document.querySelector('[data-role="canvas"]').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; });
      const TW = 0.9906, TH = 1.9812;
      const scale = Math.min(g.w / TW, g.h / TH) * 0.9;
      // The cue ball starts on the head spot and travels TOWARD the drag, so aiming at the rack
      // means dragging at the rack (down-screen). Distance from the ball is the power.
      const cue = { x: g.left + g.w / 2, y: g.top + g.h / 2 + (-TH * 0.25) * scale };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cue.x, y: cue.y, id: 1 }] });
      for (let i = 1; i <= 12; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cue.x, y: cue.y + (130 * i / 12), id: 1 }] });
        await page.waitForTimeout(14);
      }
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

      const read = () => page.evaluate(() => {
        try {
          const s = JSON.parse(localStorage.getItem('gamehub.poolv2.save.v1') || 'null');
          if (!s) return null;
          const c = s.game.balls.find((x) => x.id === 'cue');
          return { cx: c.x, cy: c.y, turn: s.game.turnSeat, broken: !!s.game.broken, over: !!s.game.over };
        } catch { return null; }
      });
      // Poll for the settle. The autosave lands AFTER the balls stop; a fixed wait read it too
      // early once and reported a break that had actually happened as "the rack never moved".
      let st = null;
      for (let i = 0; i < 60 && !st; i++) { st = await read(); if (!st) await page.waitForTimeout(250); }
      if (!st) return { ok: false, why: 'the break never resolved (no game state after 15s)' };
      const travelled = Math.hypot(st.cx - 0, st.cy - (-TH * 0.25));
      if (travelled < 0.4) return { ok: false, why: `the cue ball barely moved (${travelled.toFixed(2)}m) - a full-power break should cross the table` };
      if (!st.broken) return { ok: false, why: 'the shot fired but the game never registered a break' };
      // and the opponent has to answer, or it is a one-sided game
      const t0 = Date.now();
      while (Date.now() - t0 < 25000) {
        const s = await read();
        if (!s || s.over || s.turn === 0) return { ok: true, why: `break travelled ${travelled.toFixed(2)}m; computer replied` };
        await page.waitForTimeout(300);
      }
      return { ok: false, why: 'the computer never took its turn within 25s' };
    },
  },

  skeeball: {
    what: 'swipe real racks up the lane: score, records, and the stats write all have to move',
    async run(page, cdp, tap) {
      // The gallery: the carousel's selected slide carries four record slots (best / today /
      // average, plus the hub-wide record row) and a Play button. `.sk-statline` was the
      // RETIRED accordion setup's selector - this probe went stale when batch G (2026-08-18)
      // replaced that screen with the carousel, and reported 0 slots against a screen showing
      // all four. Locked slides carry none, so the count is over the unlocked ones.
      const play = await page.$('[data-role="play"]');
      if (!play) return { ok: false, why: 'no Play button on the setup screen' };
      const recSlots = await page.$$eval('.sk-slide-rec b, .sk-slide-recwide b', (els) => els.length);
      if (recSlots < 4) return { ok: false, why: `the machine slide shows ${recSlots} record slots, spec says 4 (best / today / average / hub-wide record)` };

      // [KNOWN-BUG PROBE] THE NEXT SLIDE IS DRAWN BEFORE THE PLAYER SWIPES TO IT (2026-09-01).
      //
      // Matt's second screen recording: every swipe landed on an empty black box for half a second
      // warm and a second and a half cold, because a machine's picture is a WebGL scene that is not
      // even STARTED until the carousel reaches that slide. ui.js now draws the two neighbours at
      // idle while the player reads the card they are on.
      //
      // WITHOUT TOUCHING THE CAROUSEL - that is the whole assertion. Any slide other than the
      // selected one holding a real picture can only have got there from the prewarm. The budget is
      // generous because this browser is on SwiftShader, where building a machine is far slower
      // than on the phone this is about.
      const neighbourDrawn = await page.evaluate(async () => {
        const painted = () => [...document.querySelectorAll('img[data-machine], img[data-machine-locked]')]
          .filter((el) => /^data:image\/jpeg/.test(el.getAttribute('src') || '')).length;
        // TWO, not "more than it started with": the selection sits on THE CLASSIC, which is first
        // in the list and so has exactly one neighbour. Asking for the count to keep growing fails
        // on a correct build the moment that one neighbour has landed.
        for (let i = 0; i < 50 && painted() < 2; i++) await new Promise((r) => setTimeout(r, 500));
        return painted();
      });
      if (neighbourDrawn < 2) {
        return { ok: false, why: 'no slide other than the selected one was ever drawn - the gallery '
          + 'is not prewarming its neighbours, so every swipe lands on an empty box' };
      }
      const readSk = () => page.evaluate(() => {
        try { return ((JSON.parse(localStorage.getItem('gamehub.stats') || '{}').games || {}).skeeball || {}).sk || {}; }
        catch { return {}; }
      });
      const before = await readSk();
      await tap(play);
      await page.waitForSelector('.sk-canvas', { timeout: 8000 });
      await page.waitForTimeout(400);

      const stage = await (await page.$('[data-role="stage"]')).boundingBox();
      // A thumb flick up the lane. ui.js reads the release speed (last ~130ms) against the
      // stage height, so the DURATION of the move run is the throw's power: ~160ms for a hard
      // fling down to ~420ms for a soft roll.
      const swipe = async (ms) => {
        const x = stage.x + stage.width / 2;
        const y0 = stage.y + stage.height * 0.94;
        const dist = stage.height * 0.55;
        const steps = 6;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
        for (let i = 1; i <= steps; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - (dist * i) / steps, id: 1 }] });
          await page.waitForTimeout(ms / steps);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      const settled = () => page.evaluate(() => {
        const el = document.querySelector('[data-role="pips"]');
        return el ? el.querySelectorAll('i.is-used').length : -1;
      });

      // Everything that moves is drawn into one canvas (no DOM element for the MOTION harness
      // to follow), so sample the canvas mid-throw: three crops that must not all be identical.
      const shot = () => page.evaluate(() => {
        const c = document.querySelector('.sk-canvas');
        const t2 = document.createElement('canvas');
        t2.width = 64; t2.height = 64;
        t2.getContext('2d').drawImage(c, 0, 0, c.width, c.height, 0, 0, 64, 64);
        return t2.toDataURL();
      });
      await swipe(220);
      const frames = [];
      for (let i = 0; i < 3; i++) { frames.push(await shot()); await page.waitForTimeout(180); }
      if (new Set(frames).size < 2) return { ok: false, why: 'the machine never changed between frames after a throw: nothing is animating' };

      // Play the rack out: after each swipe, wait for the ball counter to advance (settled), a
      // rolled-back ball (counter unchanged - swipe again), or the rack-over sheet.
      const durations = [220, 300, 180, 260, 340, 200, 240, 160, 280, 230, 210, 250];
      let over = false;
      for (let i = 0; i < 30 && !over; i++) {
        const usedBefore = await settled();
        if (usedBefore === -1) { over = !!(await page.$('.sk-over-veil')); break; }
        await swipe(durations[i % durations.length]);
        const t0 = Date.now();
        while (Date.now() - t0 < 9000) {
          if (await page.$('.sk-over-veil')) { over = true; break; }
          const used = await settled();
          if (used > usedBefore || used === -1) break;
          await page.waitForTimeout(200);
        }
      }
      if (!over) {
        const t0 = Date.now();
        while (Date.now() - t0 < 5000 && !over) { over = !!(await page.$('.sk-over-veil')); await page.waitForTimeout(250); }
      }
      if (!over) return { ok: false, why: 'threw a full rack and the rack-over sheet never appeared' };

      const finalTxt = await page.$eval('.sk-over-score', (el) => el.textContent.trim()).catch(() => null);
      const after = await readSk();
      if (((after.played | 0) - (before.played | 0)) < 1) {
        return { ok: false, why: 'the rack finished but recordSkeeball never wrote it (sk.played did not move)' };
      }
      const save = await page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('gamehub.skeeball.save.v1') || 'null'); }
        catch { return null; }
      });
      if (save) return { ok: false, why: 'the rack recorded but its autosave was left banked - the next mount would resume a finished rack' };

      // [KNOWN-BUG PROBE] RESUME A RACK ON A MACHINE THE CAROUSEL IS NOT SHOWING (2026-09-01).
      //
      // Matt, with a screenshot of a painted HUD over an empty playfield: "You broke skeeball. I
      // can go back to the hub but nothing else." _startGame loaded the engine for the carousel's
      // selection while restore() rebuilt on the SNAPSHOT's board; a swipe after leaving mid-rack
      // makes those differ, and with the engines lazy that threw into a half-mounted dead screen.
      //
      // This is the check that would have caught it. The probe above never catches it because it
      // plays THE CLASSIC from the gallery, with no banked save and no swipe - the ordinary path.
      //
      // RE-MOUNTED IN PLACE, NOT RELOADED: checkPlay's addInitScript wipes every `*.save.*` key on
      // EVERY navigation, so a reload deletes the very snapshot this probe needs before the page
      // even runs. init() re-enters the same constructor path a real resume takes.
      const resumed = await page.evaluate(async () => {
        localStorage.setItem('gamehub.skeeball.save.v1', JSON.stringify({
          v: 1, board: 'runaway', score: 100, ballsUsed: 4,
          throws: [{ value: 100, hole: 'topL', earned: 100 }, { value: 0, hole: 'gutter', earned: 0 },
            { value: 0, hole: 'gutter', earned: 0 }, { value: 0, hole: 'gutter', earned: 0 }],
        }));
        localStorage.setItem('gamehub.skeeball.v1', JSON.stringify({ board: 'classic' }));
        const m = await import('./js/ui.js');
        const host = document.getElementById('skeeball') || document.querySelector('.sk-root');
        m.init(host);
        await new Promise((r) => setTimeout(r, 2500));   // the engine load + first _fit
        const c = host.querySelector('canvas.sk-canvas');
        try { localStorage.removeItem('gamehub.skeeball.save.v1'); } catch { /* no residue */ }
        // 300x150 is the untouched default: the renderer never got as far as sizing it.
        return { has: !!c, w: c ? c.width : 0, h: c ? c.height : 0 };
      });
      if (!resumed.has || (resumed.w === 300 && resumed.h === 150) || resumed.w < 32) {
        return { ok: false, why: `resuming a rack banked on another machine left the playfield dead `
          + `(canvas ${resumed.w}x${resumed.h}) - the engine loaded was the carousel's, not the rack's` };
      }
      return { ok: true, why: `played a rack to the sheet (final ${finalTxt}); sk.played ${before.played | 0} -> ${after.played | 0}; `
        + `and a rack resumed on an unselected machine still drew (canvas ${resumed.w}x${resumed.h})` };
    },
  },


  pinball: {
    what: 'plunge a ball and flip it around a live table',
    async run(page, cdp, tap) {
      const play = await page.$('[data-role="play"]');
      if (!play) return { ok: false, why: 'no Play button on the setup screen' };
      await tap(play);
      await page.waitForSelector('.pb-canvas', { timeout: 8000 });
      await page.waitForTimeout(500);

      // Pull the plunger. A TAP will not do: the plunger charges while it is held, and a short
      // pull deliberately dribbles back down the shooter lane, so the probe has to hold it the way
      // a player does or it is testing the weak-plunge path by accident.
      const lb = await (await page.$('[data-role="launch"]')).boundingBox();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lb.x + lb.width / 2, y: lb.y + lb.height / 2, id: 1 }] });
      await page.waitForTimeout(1200);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(900);

      // Every moving thing on this table is drawn into one canvas, so there is no DOM element for
      // the MOTION harness to follow. Sample the canvas itself instead: three crops of the lower
      // playfield taken a fifth of a second apart. If they are identical, nothing is moving, which
      // is the canvas-shaped version of exactly what MOTION exists to catch.
      const shot = () => page.evaluate(() => {
        const c = document.querySelector('.pb-canvas');
        const t = document.createElement('canvas');
        t.width = 64; t.height = 64;
        t.getContext('2d').drawImage(c, 0, c.height * 0.45, c.width, c.height * 0.45, 0, 0, 64, 64);
        return t.toDataURL();
      });
      const frames = [];
      for (let i = 0; i < 3; i++) { frames.push(await shot()); await page.waitForTimeout(200); }
      if (new Set(frames).size < 2) return { ok: false, why: 'the playfield never changed between frames: nothing is moving' };

      // Now play it. Alternating flips on the two halves of the table for a few seconds is what a
      // person does, and the only way the score can move is real contacts with real scoring parts.
      const stage = await (await page.$('[data-role="stage"]')).boundingBox();
      const lo = { x: stage.x + stage.width * 0.25, y: stage.y + stage.height * 0.8 };
      const ro = { x: stage.x + stage.width * 0.75, y: stage.y + stage.height * 0.8 };
      const readScore = () => page.evaluate(() =>
        Number((document.querySelector('[data-role="score"]').textContent || '0').replace(/[^0-9]/g, '')));
      for (let i = 0; i < 60; i++) {
        const at = i % 2 ? ro : lo;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
        await page.waitForTimeout(60);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(90);
        if (await readScore() > 0) break;
      }
      const score = await readScore();
      if (!score) return { ok: false, why: 'the ball was launched and flipped for 9s and the score never moved: nothing on the table is scoring' };
      const ball = await page.evaluate(() => (document.querySelector('[data-role="ball"]').textContent || '').replace(/\s+/g, ' ').trim());
      return { ok: true, why: `scored ${score.toLocaleString()} with the playfield animating (${ball})` };
    },
  },

  battleship: {
    what: 'drag every ship onto the board without the board moving, then fire a shot',
    async run(page, cdp, tap) {
      // Generous timeouts on purpose: this probe drags five ships with real touch events and then
      // waits out a bot-placing beat and a shell's flight, and it shares the machine with the rest
      // of run-all-tests.mjs. It passed alone and timed out inside the full suite at 8s.
      // Names the selector it gave up on. A bare `page.waitForSelector` timeout inside a probe this
      // long says only "something never appeared", which is not enough to act on from a CI log.
      const go = async (sel) => {
        let el;
        try { el = await page.waitForSelector(sel, { timeout: 20000 }); }
        catch { throw new Error(`waited 20s and never saw ${sel}`); }
        await tap(el);
      };
      await go('[data-action="play-bot"]');

      // THE BOARD MUST NOT MOVE WHILE YOU ARE DRAGGING ONTO IT. Matt, 2026-08-11: "It moves around
      // if you drag your boats while placing them." The tray used to wrap onto two rows and lose
      // one the instant the first ship landed, yanking the board 71px up the screen mid-drag. This
      // drags all five ships with real touch and fails if the board's box EVER changes -- a check
      // no screenshot can make, because every individual frame of that bug looks correct.
      await page.waitForSelector('[data-role="place-board"]', { timeout: 20000 });
      const boxOf = () => page.evaluate(() => {
        const el = document.querySelector('[data-role="place-board"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)}`;
      });
      const boxes = new Set([await boxOf()]);
      let dragged = 0;
      for (let n = 0; n < 5; n++) {
        const chip = await page.$('[data-role="ship-chip"]');
        if (!chip) break;
        const cb = await chip.boundingBox();
        const bd = await (await page.$('[data-role="place-board"]')).boundingBox();
        if (!cb || !bd) break;
        const sx = cb.x + cb.width / 2, sy = cb.y + cb.height / 2;
        const tx = bd.x + bd.width * 0.14 + n * (bd.width * 0.11);
        const ty = bd.y + bd.height * 0.08 + n * (bd.height * 0.17);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
        for (let i = 1; i <= 6; i++) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: sx + (tx - sx) * i / 6, y: sy + (ty - sy) * i / 6 }],
          });
          await page.waitForTimeout(25);
          boxes.add(await boxOf());
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(140);
        boxes.add(await boxOf());
        dragged = await page.evaluate(() => document.querySelectorAll('[data-role="board-ship"]').length);
      }
      if (boxes.size !== 1) {
        return { ok: false, why: `the placement board moved while ships were being dragged onto it (${boxes.size} different boxes: ${[...boxes].join(' | ')})` };
      }
      if (dragged < 5) {
        return { ok: false, why: `only ${dragged}/5 ships could be dragged onto the board (the whole ship must be a drag handle)` };
      }
      await go('[data-action="placement-ready"]');
      await page.waitForTimeout(400);
      const skip = await page.$('.bs-wait');
      if (skip) await tap(skip).catch(() => {});
      // AIM, THEN FIRE. One tap parks the crosshair and raises the confirm button; the shot only
      // happens on the second. Both halves are checked here because both are how the player learns
      // a shot happened at all.
      // The opening shot can belong to either side (the `First shot` option alternates), so wait for
      // the battle screen first and let the bot take its turn if it has one, rather than treating a
      // perfectly normal bot-goes-first game as "the board never became tappable".
      //
      // AND RE-TAP IF IT DID NOT TAKE. A tap here is `waitForSelector` then `tap(handle)`, and the
      // game re-renders its whole screen often enough that under load (the full suite, where this
      // is the only failure that ever appears) the handle can be detached by the time the tap
      // lands -- a silent no-op that looked like "the game is broken". Re-tapping SAVE / the
      // skippable waiting screen is harmless when the first one worked, since neither exists any
      // more by then.
      let onBattle = false;
      for (let attempt = 0; attempt < 3 && !onBattle; attempt++) {
        try { await page.waitForSelector('.bs-battle', { timeout: 7000 }); onBattle = true; break; }
        catch { /* retry below */ }
        for (const sel of ['[data-action="placement-ready"]', '.bs-wait']) {
          const el = await page.$(sel);
          if (el) await tap(el).catch(() => {});
        }
      }
      if (!onBattle) {
        const where = await page.evaluate(() => {
          const r = document.querySelector('.bs-root');
          return r ? (r.querySelector('.bs-deploy') ? 'deploy' : r.querySelector('.bs-wait') ? 'waiting' : r.querySelector('.bs-mode') ? 'setup' : 'unknown') : 'no root';
        });
        return { ok: false, why: `saved the fleet and the battle screen never appeared (stuck on: ${where})` };
      }
      await go('[data-action="fire"]:not([disabled])');
      try { await page.waitForSelector('[data-action="fire-confirm"]', { timeout: 10000 }); }
      catch { return { ok: false, why: 'tapped a square and no FIRE button appeared to confirm the shot' }; }
      await go('[data-action="fire-confirm"]');
      // a resolved shot says what it did, and leaves a settled marker on the cell it hit
      try { await page.waitForSelector('.bs-res-hit, .bs-res-miss, .bs-res-sunk', { timeout: 15000 }); }
      catch { return { ok: false, why: 'the shot resolved without ever saying HIT or MISS' }; }
      try { await page.waitForSelector('.bs-peg-miss, .bs-peg-hit', { timeout: 15000 }); }
      catch { return { ok: false, why: 'fired at a cell and no hit/miss marker ever appeared' }; }
      return { ok: true, why: 'aimed, confirmed with FIRE, and the shot announced its result' };
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
      // "The page doesn't scroll sideways" is NOT the same as "nothing is cut off". An ancestor
      // with overflow:hidden absorbs the overflow, so the body stays put while the content is
      // silently clipped - which is exactly how a mode screen with its buttons and half its
      // tagline sliced off the right edge passed this suite. Look for the clipping too.
      //
      // Only `hidden` and `clip` count. An `auto`/`scroll` container overflowing is not content
      // being cut off - it is a scroller doing its job, and the rule this check enforces (root
      // CLAUDE.md, "Scroll and touch rules") explicitly ALLOWS wide content that "scrolls inside
      // its own container". Flagging those too made the check fire on the one pattern it is
      // supposed to bless: Skeeball's scroll-snap machine carousel, where every slide is reachable
      // by swiping and nothing is hidden. Clipping is unreachable; scrolling is reachable.
      const clipped = [];
      for (const e of document.querySelectorAll('body *')) {
        const c = getComputedStyle(e);
        if (!/hidden|clip/.test(c.overflowX)) continue;
        if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) {
          clipped.push(`${e.tagName.toLowerCase()}.${(e.className || '').toString().trim().split(/\s+/)[0] || '?'} (${e.scrollWidth} wide in ${e.clientWidth})`);
        }
      }
      return {
        painted,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        clipped: clipped.slice(0, 3),
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
    else if (seen.clipped.length) failUnlessKnown(game, mode.name, 'no horizontal page scroll', `content is CUT OFF sideways inside ${seen.clipped.join('; ')}`);
    else ok(game, mode.name, 'nothing cut off or scrolling sideways');

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


/** Drive a game through its real UI with real touch and assert something only PLAYING could
 *  change. See the PLAY table's header for the incident this exists for. */
async function checkPlay(game, probe) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  const boom = [];
  page.on('pageerror', (e) => boom.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('gamehub.profile', JSON.stringify({
      name: 'Visual Test', emoji: '\u{1F419}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
    }));
    for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
  });
  try {
    const cdp = await ctx.newCDPSession(page);
    const tap = async (el) => { const b = await el.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
    await page.goto(`${BASE}/${game}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(800);
    const res = await probe.run(page, cdp, tap);
    await page.screenshot({ path: join(OUT, `${game}--played.png`) });
    if (boom.length) fail(game, 'play', `JS error while playing: ${boom[0]}`);
    else if (res && res.ok) ok(game, 'play', `${probe.what} - ${res.why}`);
    else fail(game, 'play', `CANNOT BE PLAYED: ${probe.what} - ${(res && res.why) || 'probe returned nothing'}`);
  } catch (e) {
    fail(game, 'play', `probe threw: ${e.message}`);
  } finally {
    await ctx.close();
  }
}


/** FIT: does the whole game fit ONE screen, in every host and at real phone heights?
 *
 *  This exists because Pool shipped 138px too tall INSIDE THE HUB with its controls up to 98px
 *  below the fold - Matt: "I couldn't see the full board and the controls simultaneously" - while
 *  this very suite reported it clean. It was clean: standalone, at 393x852, which was the only
 *  thing being looked at. The hub wraps an immersive game in ~98px of top padding for the
 *  floating back button and 40px at the bottom, so a game that asks for 100dvh is 138px too tall
 *  the moment it is mounted. Nothing standalone can ever show that.
 *
 *  So: both hosts, and a short viewport as well as a tall one, because browser toolbars eat
 *  100-190px on a real phone and a layout can fit one height and not the other. */
const FIT_SIZES = [
  { w: 393, h: 852, why: 'tall (no browser chrome)' },
  { w: 390, h: 664, why: 'short (with browser toolbars)' },
];

/** Mount a game through the hub's OWN launch path (`initHub` + `hub.launch`), not by tapping a
 *  launcher card: dev-only games have no card for this suite's plain profile, and the launcher is
 *  not the point anyway - the hub's chrome and CSS are. See the comment inside mountInHub for why
 *  a synthetic mount (hand-hiding the launcher) is wrong on any Firebase-reachable machine. */
/** The launcher's one-time announcement popup (js/announce.js + announce-ui.js) covers the whole
 *  hub on a fresh profile, and several checks here MEASURE the hub. Left up, the number reported is
 *  the POPUP's, not the game's -- which is what happened the day the announcement shipped
 *  (battleship read "103px too tall" in the hub on a short phone; all 103 of them were the modal).
 *  Marking every announcement seen rather than hardcoding one id means a future one is covered
 *  without editing this. */
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

async function mountInHub(page, game) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  // Wait for the page's OWN hub instance to exist AND for its load-time async to have run,
  // then drive THAT instance - never construct a second one. The old synthetic mount (import
  // the game module, init it into the host, hide the launcher's nodes by hand) left
  // `hub.current` null, and js/hub.js's admin-config subscription
  // (`onAdminConfig(() => { if (!this.current) this.render(); })`) then rebuilt the whole
  // launcher over the mounted game the moment the Firebase config fetch answered - so on any
  // machine that CAN reach Firebase, this check measured the LAUNCHER's scroll height
  // (~1390px) instead of the game's. Reproduced 2026-09-02 (skeeball read "541px TALLER" at
  // both fit sizes). Re-calling initHub() is NOT the fix: it destroys the live instance but
  // shares the same root element, so the destroyed instance's in-flight async empties the
  // host ~1s after the new one mounts the game. hub.launch() is what a player's tap runs.
  await page.waitForFunction(() => !!window.__ghHub, null, { timeout: 20000 });
  await page.waitForTimeout(700);
  await dismissAnnouncement(page);
  return page.evaluate(async (g) => {
    const m = await import('/js/hub.js');
    const hub = window.__ghHub;
    if (!hub) return 'hub instance not found (window.__ghHub)';
    // devOnly games have no launcher card for this suite's plain profile; add the registry
    // entry to the live instance's own list so its real launch path can mount it.
    if (!hub.games.some((x) => x.id === g)) {
      const entry = m.GAMES.find((x) => x.id === g);
      if (!entry) return `no GAMES entry for "${g}"`;
      hub.games = [...hub.games, entry];
    }
    await hub.launch(g);
    if (!hub.current || hub.current.id !== g) return `hub.launch("${g}") did not mount it`;
    return null;
  }, game);
}

async function checkFit(game) {
  for (const host of ['standalone', 'hub']) {
    for (const size of FIT_SIZES) {
      const ctx = await browser.newContext({
        viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
      });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        localStorage.setItem('gamehub.profile', JSON.stringify({
          name: 'Visual Test', emoji: '\u{1F419}', opponents: [{ name: 'Bot', emoji: '\u{1F916}', skill: 1 }],
        }));
        for (const k of Object.keys(localStorage)) if (/\.save\.|\.mp\./.test(k)) localStorage.removeItem(k);
      });
      const label = `${host} ${size.w}x${size.h} ${size.why}`;
      try {
        if (host === 'hub') {
          const bad = await mountInHub(page, game);
          if (bad) { fail(game, 'fit', `${label}: ${bad}`); await ctx.close(); continue; }
        } else {
          await page.goto(`${BASE}/${game}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await page.waitForTimeout(900);
        // Get INTO the game where possible - a setup screen is not the layout that overflows.
        for (const sel of ['[data-role="start-ai"]', 'button:has-text("Start game")', '[data-action="play-bot"]', '[data-action="start"]']) {
          const el = await page.$(sel);
          if (el) { const b2 = await el.boundingBox(); if (b2) { await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2); break; } }
        }
        await page.waitForTimeout(1300);
        const r = await page.evaluate(() => {
          const de = document.documentElement;
          return { over: de.scrollHeight - window.innerHeight, wide: de.scrollWidth - de.clientWidth };
        });
        await page.screenshot({ path: join(OUT, `${game}--fit-${host}-${size.h}.png`) });
        if (r.over > 2) failUnlessKnown(game, 'fit', 'fits one screen', `${label}: ${r.over}px TALLER than the screen - you would have to scroll to see all of it`);
        else if (r.wide > 2) failUnlessKnown(game, 'fit', 'fits one screen', `${label}: ${r.wide}px too wide`);
        else ok(game, 'fit', `${label}: fits`);
      } catch (e) {
        fail(game, 'fit', `${label}: threw ${e.message.slice(0, 70)}`);
      } finally {
        await ctx.close();
      }
    }
  }
}

console.log(`Looking at ${GAMES.length} of ${ALL_GAMES.length} games x ${MODES.length} modes at ${VIEWPORT.width}x${VIEWPORT.height}`);
console.log(`  ${GAMES.join(', ')}`);
console.log(`  why these: ${WHY}\n`);

for (const game of GAMES) {
  for (const mode of MODES) await checkGame(game, mode);
  await checkFit(game);
  if (MOTION[game]) await checkMotion(game, MOTION[game]);
  if (PLAY[game]) await checkPlay(game, PLAY[game]);
}

await browser.close();
stopServer();

console.log(`\nContact sheet: ${OUT}  (${GAMES.length * MODES.length} screenshots)`);
console.log('LOOK AT IT. This suite proves a game rendered, never that it looks right - see VISUAL-PROCESS.md.');
const noPlay = GAMES.filter((g) => !PLAY[g]);
if (noPlay.length) {
  console.log(`\n  NEVER PLAYED BY ANYTHING (${noPlay.length}): ${noPlay.join(', ')}`);
  console.log('  For these, this suite proves only that they DRAW. Nothing here has ever taken a turn');
  console.log('  in them. Add a PLAY probe before calling one of them finished - see the table in');
  console.log('  test-visual.mjs for the incident that rule came from.');
}
const noProbe = GAMES.filter((g) => !MOTION[g]);
if (noProbe.length) console.log(`\nNo motion probe yet: ${noProbe.join(', ')}`);
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
