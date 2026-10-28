// tools/test-arrow-maze-replay.mjs - Arrow Maze's REPLAY and MORE LEVELS (2026-10-26), driven in a
// real browser through the real input path (taps on the canvas). Needs the dev server
// (`node server.mjs`). Uses a made-up profile that syncs nothing (root CLAUDE.md: never Matt's).
//
//   node tools/test-arrow-maze-replay.mjs [--shots <dir>]
//
// Checks: the Replay button shows the count of levels with points to win back; its list opens; a
// replay plays that level's board, keeps NOTHING on the phone (the band's save, clock and next level
// are byte-identical after it, mistakes included), and a clean finish adds only the points missed;
// the list then empties. Easy past 50 plays "Easy 51" on a more-levels board.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// playwright-core as the other probes use it, else a machine-wide playwright (cloud sessions).
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch { ({ chromium } = createRequire(import.meta.url)('playwright')); }

const BASE = process.env.BB_BASE || 'http://localhost:8123';
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL  ' + name, extra); } };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
// --size 360x724 (the design floor) and --es (Spanish runs longer) are worth a run each.
const size = process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1].split('x').map(Number) : [390, 844];
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, hasTouch: false });
page.on('pageerror', (e) => { fail++; console.log('PAGE ERROR', e.message); });
const shot = async (name) => { if (shotsAt) await page.screenshot({ path: `${shotsAt}/${name}.png` }); };

await page.goto(`${BASE}/way-out/`);
const es = process.argv.includes('--es');
await page.evaluate((es) => {
  localStorage.clear();
  localStorage.setItem('gamehub.devAllowSync.v1', '0');
  if (es) localStorage.setItem('gamehub.lang.v1', 'es');
  localStorage.setItem('gamehub.profile', JSON.stringify({ version: 1, name: 'zzzreplay', emoji: '🧪', preferredColor: null, opponents: [], updatedAt: new Date().toISOString() }));
}, es);
// A real history, written by the real recorder: Medium 51 with one lost life (1 of 2), Medium 52
// clean, Easy 1-50 done. Settings: Medium on 53, Easy on 51.
await page.evaluate(async () => {
  const G = await import('/js/game-stats.js');
  G.recordWayOut('medium', { timeMs: 40000, penaltyMs: 15000, arrows: 40, rounds: 14, mistakes: 1, hints: 0, timed: true, level: 51, gen: 6 });
  G.recordWayOut('medium', { timeMs: 30000, penaltyMs: 0, arrows: 40, rounds: 14, mistakes: 0, hints: 0, timed: true, level: 52, gen: 6 });
  localStorage.setItem('gamehub.wayout.v1', JSON.stringify({ tier: 'medium', ladder2: { easy: 51, medium: 53, hard: 101, expert: 201 }, mode: 'levels' }));
  localStorage.setItem('gamehub.wayout.ladder2.saves.v1', JSON.stringify({ migrated: 1, medium: { v: 3, band: 'medium', n: 53, src: { k: 'L', n: 53, g: 6 }, gone: [0], red: [], lives: 3 } }));
  localStorage.setItem('gamehub.wayout.ladder2.clocks.v1', JSON.stringify({ medium: { n: 53, key: 'L:53:6', ms: 4000, pen: 0, mistakes: 0, hints: 0, partial: false } }));
});
const keep = ['gamehub.wayout.v1', 'gamehub.wayout.ladder2.saves.v1', 'gamehub.wayout.ladder2.clocks.v1'];
const snap = () => page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), keep);
const pts = () => page.evaluate(async () => { const T = await import('/js/arrow-maze-time.js'); const G = await import('/js/game-stats.js'); return T.woPoints(G.loadStats().games.wayout); });
let before = await snap();
const p0 = await pts();

// RELEASED to everyone 2026-10-27 (NEWS_FOR_ALL in way-out/js/ui.js): a player's phone gets the popup,
// Replay and the endless levels. (The admin test boards were removed 2026-10-27.)
await page.reload();
await page.waitForSelector('.wo-news');
ok('player: the popup shows, with this person\'s count (1); no test boards', (await page.locator('.wo-news-chip b').innerText()).trim() === '1'
  && (await page.locator('.wo-testq').count()) === 0);
await shot('0-news');
await page.locator('.wo-news .gh-btn--primary').click();
ok('player: Got it closes it and stamps it seen', (await page.locator('.wo-modal[hidden]').count()) === 1
  && (await page.evaluate(() => localStorage.getItem('gamehub.wayout.news.v1'))) === '["replay-more-2026-10-26"]');
ok('player: saves, clocks and every next level untouched by opening', JSON.stringify(await snap()) === JSON.stringify(before));
// Now one of Matt's devices.
await page.evaluate(() => localStorage.setItem('gamehub.adminDevice.v1', '1'));
await page.reload();
await page.waitForSelector('.wo-home');
await page.waitForTimeout(200);
ok('the popup shows once only', (await page.locator('.wo-news').count()) === 0);
// IMPOSSIBLE TEST BOARDS (2026-10-28, admin only): listed, one played to the end, its result kept on the
// phone in its own key, nothing else touched.
await page.locator('.wo-testq').click();
await page.waitForSelector('.wo-rp-row[data-act="test"]');
ok('tests: the Impossible boards are listed', (await page.locator('.wo-rp-row[data-act="test"]').count()) >= 3);
await shot('8-tests');
await page.locator('.wo-rp-row[data-n="1"]').click();
await page.waitForFunction(() => window.__woTest);
ok('tests: Impossible 1 on screen', /Impossible 1|Imposible 1/.test(await page.locator('.wo-level').innerText()));
await shot('9-impossible-1');
{
  const keep0 = await snap();
  for (let guard = 0; guard < 400; guard++) {
    const s = await page.evaluate(() => (window.__woTest ? window.__woTest.state() : null));
    if (!s || !s.left) break;
    const id = await page.evaluate(() => window.__woTest.clearId());
    if (id < 0) { await page.waitForTimeout(60); continue; }
    const p = await page.evaluate((i) => window.__woTest.pointOf(i), id); await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(20);
  }
  await page.waitForSelector('.wo-rp-row[data-act="test"]', { timeout: 10000 });
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('gamehub.wayout.tests2.v1') || '{}'));
  ok('tests: the finish is kept on the phone, and the list shows it', Array.isArray(kept['1']) && kept['1'].length === 1 && kept['1'][0].m === 0
    && /♥♥♥/.test(await page.locator('.wo-rp-row[data-n="1"] .wo-rp-gain').innerText()));
  ok('tests: no save, clock or level touched, no stats recorded', JSON.stringify(await snap()) === JSON.stringify(keep0)
    && (await page.evaluate(async () => (await import('/js/game-stats.js')).loadStats().games.wayout.byDiff.medium.won)) === 2);
  await page.locator('.wo-modal [data-act="close"]').click();
}
const rbtn = page.locator('.wo-replay');
ok('setup: a Replay button with the count (1)', (await rbtn.count()) === 1 && (await rbtn.innerText()).trim() === '1');
ok('setup: the paused level still offers New game | Resume', (await page.locator('[data-act="new-level"]').count()) === 1);
ok('setup: the Play row fits (no button clipped)', await page.evaluate(() => [...document.querySelectorAll('.wo-playrow > .gh-btn')].every((b) => b.scrollWidth <= b.clientWidth + 1)));
await shot('1-setup-medium');
await rbtn.click();
await page.waitForSelector('.wo-rp-row');
ok('list: one row, Level 51, +1 pts', (await page.locator('.wo-rp-row').count()) === 1 && /51/.test(await page.locator('.wo-rp-n').innerText()) && /\+1/.test(await page.locator('.wo-rp-gain').innerText()));
await shot('2-replay-list');
await page.locator('.wo-rp-row').click();
await page.waitForSelector('.wo-canvas');
await page.waitForFunction(() => window.__woTest);
let st = await page.evaluate(() => window.__woTest.state());
ok('replay: Medium level 51 on screen', st.level === 51 && st.tier === 'medium', JSON.stringify(st));
ok('replay: the level title wears the replay mark', (await page.locator('.wo-level svg').count()) === 1);
await shot('3-replay-board');

const tapId = async (id) => { const p = await page.evaluate((i) => window.__woTest.pointOf(i), id); await page.mouse.click(p.x, p.y); };
// A mistake first: it costs a heart and still keeps nothing.
const bid = await page.evaluate(() => window.__woTest.blockedId());
if (bid >= 0) {
  await tapId(bid);
  await page.waitForTimeout(700);
  st = await page.evaluate(() => window.__woTest.state());
  ok('replay: a mistake costs a heart', st.lives === 2);
  ok('replay: a mistake writes nothing (save, clock, next level unchanged)', JSON.stringify(await snap()) === JSON.stringify(before));
  // Restart: a clean attempt, three hearts again.
  await page.locator('[data-act="restart"]').click();
  await page.waitForFunction(() => window.__woTest && window.__woTest.state().lives === 3);
  ok('replay: Restart starts it clean', (await page.evaluate(() => window.__woTest.state())).lives === 3);
}
// Clear it with no slips.
for (let guard = 0; guard < 400; guard++) {
  const s = await page.evaluate(() => (window.__woTest ? window.__woTest.state() : null));
  if (!s || !s.left) break;
  const id = await page.evaluate(() => window.__woTest.clearId());
  if (id < 0) { await page.waitForTimeout(60); continue; }
  await tapId(id);
  await page.waitForTimeout(25);
}
await page.waitForSelector('.wo-banner.is-on', { timeout: 8000 });
const sub = await page.locator('.wo-banner b').innerText();
ok('replay: the banner shows +1 pts', /\+1/.test(sub), sub);
await shot('4-replay-won');
await page.waitForSelector('.wo-home', { timeout: 8000 });
ok('replay: +1 point, no more', (await pts()) === p0 + 1, `${p0} -> ${await pts()}`);
ok('replay: the band\'s save, clock and next level are byte-identical', JSON.stringify(await snap()) === JSON.stringify(before));
ok('replay: nothing left to replay, so no button and no list', (await page.locator('.wo-replay').count()) === 0 && (await page.locator('.wo-modal:not([hidden])').count()) === 0);
const g = await page.evaluate(async () => (await import('/js/game-stats.js')).loadStats().games.wayout);
ok('replay: stored raw, not a level cleared', g.wo.replay.medium.length === 1 && g.wo.replay.medium[0].u === 1 && g.byDiff.medium.won === 2 && g.wo.ptsN.medium === 2);
await shot('5-setup-after');

// MORE LEVELS: Easy goes on past 50.
await page.locator('.wo-seg[data-tier="easy"]').click();
ok('easy: the button says Level 51 and Play level 51', /51/.test(await page.locator('.wo-seg[data-tier="easy"] .wo-seg-sub').innerText()) && /51/.test(await page.locator('.wo-play[data-act="play"]').innerText()));
await shot('6-setup-easy-51');
await page.locator('.wo-play[data-act="play"]').click();
await page.waitForFunction(() => window.__woTest);
st = await page.evaluate(() => window.__woTest.state());
ok('easy: Easy level 51 plays', st.level === 51 && st.tier === 'easy', JSON.stringify(st));
await shot('7-easy-51-board');

// GENERATOR 8 (2026-10-27): on Matt's devices Hard 101 and Expert 201 are the new 16x22 boards.
for (const [band, n] of [['hard', 101], ['expert', 201]]) {
  await page.locator('[data-act="menu"]').click();
  await page.waitForSelector('.wo-home');
  await page.locator(`.wo-seg[data-tier="${band}"]`).click();
  await page.locator('.wo-play[data-act="play"]').click();
  await page.waitForFunction(() => window.__woTest);
  const clock = await page.evaluate((b) => JSON.parse(localStorage.getItem('gamehub.wayout.ladder2.clocks.v1') || '{}')[b], band);
  ok(`${band}: level ${n} is a generator ${band === 'expert' ? 9 : 8} board`, clock && clock.key === `${band === 'expert' ? 'N9' : 'N'}:${band}:${n}`, JSON.stringify(clock));
  await shot(`10-${band}-${n}`);
}

await browser.close();
console.log(`\nArrow Maze replay / more-levels probe: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
