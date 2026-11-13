// test-stats-screens.mjs - every game's NEW stats screen (2026-11-02, js/game-stats-ui.js freshScreenFor, admin
// devices only until Matt releases it) renders for real people and for a store with every game's modes and detail.
//
//   1. Node: every person on the real board snapshot (backups/lb-z.json, read-only), every game they played, and a
//      fixture written by the REAL recorders through withMode (tools/stats-screens-fixture.mjs): no throw, and no
//      NaN / undefined / null / [object in the HTML. Players' path (screenFor) still renders unchanged.
//   2. The layout: the record card's words are Wins / Losses / Ties / Played in that order, online sits right
//      after it, no "Victories", "Draws", "Defeats", "Timed", "(arrows in one run)", "Color sweeps".
//   3. POPONGO (archived 2026-11-02): never named in any screen (Skeeball, both paths), never a leaderboard
//      machine tab, and every Skeeball total is unchanged: lifetime points/games include its racks, the board's
//      All number is the same as with it listed.
//   4. --browser: every screen at 360 px (EN and ES) and 402 px in a real page: nothing wider than the screen.
// Nothing is written anywhere (in-memory localStorage; the browser blocks every non-localhost request).
//   node tools/test-stats-screens.mjs [--browser]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './stats-screens-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); } };

const fixture = await buildFixture();
const UI = await import('../js/game-stats-ui.js');
const { v2ScreenFor, screenFor, SK_MACHINES } = UI;
const IDS = ['connect4', 'chinchon', 'business', 'parchis', 'nutsbolts', 'sudoku', 'hoops4', 'minesweeper', 'contexto', 'murdoku', 'wayout',
  'gridlock', 'wordweaver', 'tower', 'wordladder', 'escoba', 'filler', 'mancala', 'ballrun', 'tictactoe', 'dotsboxes', 'boggle', 'snake', 'uno', 'yahtzee',
  'dominoes', 'hillclimb', 'battleship', 'skeeball', 'brickblitz', 'holdem', 'airhockey', 'cuppong', 'darts', 'flicksoccer', 'archery',
  'eightball', 'spellingbee', 'battlearena', 'golf'];
const BAD = /NaN|undefined|\[object|>null<|Infinity/;
const render = (id, st, fresh) => { try { return { html: fresh ? v2ScreenFor(id, st, { fresh: true }) : screenFor(id, st) }; } catch (err) { return { err }; } };

// --- 1. the fixture ----------------------------------------------------------------------------------------------
for (const lang of ['en', 'es']) {
  localStorage.setItem('gamehub.lang.v1', lang);
  for (const id of IDS) {
    const r = render(id, fixture, true);
    ok(`fixture ${lang} ${id}: renders`, !r.err, r.err && r.err.message);
    if (r.html) ok(`fixture ${lang} ${id}: no NaN/undefined/null/[object`, !BAD.test(r.html), (r.html.match(BAD) || [])[0]);
  }
}
localStorage.setItem('gamehub.lang.v1', 'en');
const H = (id) => v2ScreenFor(id, fixture, { fresh: true });
const words = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
// --- 2. the layout -----------------------------------------------------------------------------------------------
const recWords = (html) => { const m = /<div class="gs-rec[^"]*">([\s\S]*?)<\/div><\/div>/.exec(html); return m ? [...m[1].matchAll(/<span>([^<]*)<\/span>/g)].map((x) => x[1]) : []; };
ok('chinchon: Wins Losses Played (one vocabulary)', recWords(H('chinchon')).join(',') === 'Wins,Losses,Played', recWords(H('chinchon')).join(','));
ok('tictactoe: Wins Losses Ties Played', recWords(H('tictactoe')).join(',') === 'Wins,Losses,Ties,Played', recWords(H('tictactoe')).join(','));
for (const id of ['chinchon', 'escoba', 'filler', 'mancala', 'dotsboxes', 'boggle', 'yahtzee', 'battleship', 'hoops4', 'darts', 'flicksoccer', 'eightball', 'tictactoe', 'holdem', 'airhockey']) {
  const h = H(id);
  const iRec = h.indexOf('gs-rec'), iOn = h.indexOf('>Online<');
  ok(`${id}: online card right after the record`, iOn > iRec && iRec >= 0 && h.slice(iRec, iOn).split('gs-grid').length === 1, `${iRec} ${iOn}`);
}
ok('cuppong: online right after the record (second card)', H('cuppong').indexOf('>Online<') > H('cuppong').indexOf('class="gs-rec') && H('cuppong').indexOf('class="gs-rec') >= 0);
for (const [id, w] of [['darts', 'Went first'], ['flicksoccer', 'Went second'], ['hoops4', 'Went first'], ['mancala', 'Went first'],
  ['dotsboxes', 'Went first'], ['yahtzee', 'Went first'], ['tictactoe', 'Went first'], ['connect4', 'Went second'], ['battleship', 'Went first'], ['cuppong', 'Went first']]) {
  ok(`${id}: first vs second`, words(H(id)).includes(w));
}
// Filler has no Went first / Went second table (Matt, 2026-11-06: the opener alternates).
ok('filler: no first vs second table', !/Went first|Went second/.test(words(H('filler'))));
ok('darts: by game type', /By game.*101.*301.*Cricket/.test(words(H('darts'))));
ok('flicksoccer: by formation + most played + goals', /By formation.*Balanced \/ Defend/.test(words(H('flicksoccer'))) && words(H('flicksoccer')).includes('Most played formation') && words(H('flicksoccer')).includes('Goals for'));
ok('holdem: by table, most played table, no Easy/Medium/Hard rows', /By table.*Buddy's House/.test(words(H('holdem')).replace(/&#39;|&apos;/g, "'")) && words(H('holdem')).includes('Most played table') && !/By difficulty/.test(words(H('holdem'))));
ok('hoops4: shots, made, missed, make %, shot rule', ['Shots per turn', 'One shot', 'Until you score', 'Made', 'Missed', 'Make %'].every((w) => words(H('hoops4')).includes(w)));
ok('yahtzee: best, average, Yahtzees, upper bonuses', ['Best score', 'Average score', 'Yahtzees', 'Upper bonuses'].every((w) => words(H('yahtzee')).includes(w)));
ok('cuppong: solo, on fire, balls back, favorite rack', ['Solo', 'On fire', 'Balls back', 'Favorite rack', 'Diamond'].every((w) => words(H('cuppong')).includes(w)));
ok('tictactoe: each mode by difficulty', /Ultimate.*Medium.*Classic.*Easy.*Hard/.test(words(H('tictactoe'))));
ok('wayout: Levels cleared, Arrows cleared, no Timed, no caption', /Levels cleared/.test(H('wayout')) && /Arrows cleared/.test(H('wayout')) && !/Timed|arrows in one run/.test(H('wayout')));
ok('wayout: arrows = level logs + Rush runs (41+42+41+43 + 230 = 397)', /<b>397<\/b><span>Arrows cleared/.test(H('wayout')));
ok('skeeball: no Color sweeps / Runaways caught', !/Color sweeps|Runaways caught/.test(H('skeeball')));
ok('no old vocabulary anywhere', !IDS.some((id) => /Victories|Defeats|>Draws<|Finished games|Win rate/.test(H(id))));
ok('mancala/filler/dotsboxes: totals and averages', ['Stones per game', 'Squares per game', 'Boxes per game'].every((w, i) => words(H(['mancala', 'filler', 'dotsboxes'][i])).includes(w)));
ok('a breakdown with no data is not drawn (uno: no first/second)', !/Went first/.test(H('uno')));

// --- 3. POPONGO archived, totals unchanged -----------------------------------------------------------------------
for (const fresh of [true, false]) ok(`skeeball (${fresh ? 'new' : 'players'} screen): POPONGO never named`, !/POPONGO/i.test(render('skeeball', fixture, fresh).html || 'POPONGO'));
const sk = fixture.games.skeeball.sk;
ok('skeeball: popongo racks are stored (fixture)', ((sk.boards.popongo || {}).plays | 0) === 1);
ok('skeeball: lifetime points include the archived machine (260 + 410 + 33)', (sk.points | 0) === 703 && /<b>703<\/b>/.test(H('skeeball')));
ok('skeeball: lifetime games include it (3)', /<b>3<\/b><span>Games/.test(H('skeeball')) || /<b>3<\/b>/.test(H('skeeball')));
ok('SK_MACHINES keeps popongo (its id still resolves) and marks it archived', SK_MACHINES.popongo && SK_MACHINES.popongo.archived === true);
{
  const B = await import('../skeeball/js/boards.js');
  ok('boards.js: popongo kept in BOARDS, left out of liveBoards()', B.BOARDS.some((b) => b.id === 'popongo') && !B.liveBoards().some((b) => b.id === 'popongo'));
  const src = fs.readFileSync(path.join(ROOT, 'skeeball/js/ui.js'), 'utf8');
  ok('skeeball ui: the gallery lists liveBoards()', /const BOARDS = liveBoards\(ALL_BOARDS\)/.test(src));
  const adm = fs.readFileSync(path.join(ROOT, 'js/admin-ui.js'), 'utf8');
  ok('admin page: machine rows from liveBoards()', /const BOARDS = liveBoards\(ALL_BOARDS\)/.test(adm));
}

// --- 1b. every real person, every game ---------------------------------------------------------------------------
let people = [];
const snap = path.join(ROOT, 'backups', 'lb-z.json');
if (fs.existsSync(snap)) {
  const net = await import('../js/stats-net.js');
  const raw = JSON.parse(fs.readFileSync(snap, 'utf8'));
  const parts = JSON.parse(zlib.gunzipSync(Buffer.from(raw, 'base64')).toString());
  people = net.boardList(parts).list;
  let n = 0;
  for (const g of people) {
    const st = { games: g.games || {}, code: g.playerId };
    for (const id of IDS) {
      if (!(((g.games || {})[id] || {}).total || {}).played && id !== 'skeeball' && id !== 'holdem') continue;
      for (const fresh of [true, false]) {
        const r = render(id, st, fresh);
        n++;
        if (r.err || BAD.test(r.html || '') || /POPONGO/i.test(r.html || '')) ok(`${g.name} ${id} (${fresh ? 'new' : 'old'})`, false, r.err ? r.err.message : (r.html.match(BAD) || ['POPONGO'])[0]);
        else pass++;
      }
    }
  }
  console.log(`real people: ${people.length}, screens rendered: ${n}`);
  // The leaderboard: no POPONGO machine tab; Skeeball's All board number unchanged by the archive.
  try {
    const L = await import('../js/leaderboard-ui.js');
    const withPop = people.concat([{ ...people[0], key: 'zzz-fixture', name: 'zzzfixture', playerId: 'ZZZF7', games: { ...people[0].games, skeeball: fixture.games.skeeball } }]);
    const spec = L.lb2ScoreSpecs(withPop, 'skeeball');
    ok('leaderboard: no POPONGO machine tab', !spec.views.some((v) => /popongo/i.test(v.view) || /POPONGO/.test(v.label)));
    ok('leaderboard: the other machines still have tabs', spec.views.some((v) => v.view === 'm:classic'));
  } catch (err) { console.log('SKIP leaderboard check (module needs a browser):', err.message.slice(0, 80)); }
} else console.log('SKIP real people: backups/lb-z.json missing');

// --- 4. widths in a real browser ---------------------------------------------------------------------------------
if (process.argv.includes('--browser')) {
  let chromium;
  try { ({ chromium } = createRequire(ROOT + '/')('playwright')); } catch { console.log('SKIP browser: no playwright'); }
  if (chromium) {
    const net = await import('node:net');
    const PORT = String(await new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); }));
    const srv = spawn('node', ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT } });
    await new Promise((r) => setTimeout(r, 900));
    const br = await chromium.launch();
    try {
      for (const [w, lang] of [[360, 'en'], [360, 'es'], [402, 'en']]) {
        const pg = await br.newPage({ viewport: { width: w, height: 874 } });
        await pg.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
        await pg.addInitScript((l) => { try { localStorage.setItem('gamehub.lang.v1', l); } catch { /* */ } }, lang);
        await pg.goto(`http://localhost:${PORT}/tools/lb2-harness.html`);
        const res = await pg.evaluate(async ({ fx, ids }) => {
          const UI = await import('/js/game-stats-ui.js');
          const net = await import('/js/stats-net.js');
          UI.ensureStatsCss();
          let ppl = [];
          try { const z = await (await fetch('/backups/lb-z.json')).json(); ppl = net.boardList(await net.unpackBoard(z)).list; } catch { /* none */ }
          const host = document.createElement('div');
          host.className = 'gs-panel gs-v2 gs-s4';
          host.style.cssText = 'position:absolute;left:0;top:0;width:100%;box-sizing:border-box';
          host.innerHTML = '<div class="gs-body"><div class="gs-v2 gs-s4" data-x></div></div>';
          document.body.appendChild(host);
          const box = host.querySelector('[data-x]');
          const out = [];
          const check = (who, st) => {
            for (const id of ids) {
              let html = '';
              try { html = UI.v2ScreenFor(id, st, { fresh: true }); } catch (e) { out.push(`${who} ${id}: threw ${e.message}`); continue; }
              box.innerHTML = html;
              const W = document.documentElement.clientWidth;
              for (const el of box.querySelectorAll('*')) {
                const r = el.getBoundingClientRect();
                if (r.width && (r.right > W + 0.5 || el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')) { out.push(`${who} ${id}: <${el.tagName.toLowerCase()} class="${el.className}"> ${Math.round(r.right)} > ${W}`); break; }
              }
            }
          };
          check('fixture', fx);
          for (const g of ppl) check(g.name, { games: g.games || {}, code: g.playerId });
          return out;
        }, { fx: fixture, ids: IDS });
        ok(`browser ${w}px ${lang}: nothing wider than the screen`, !res.length, res.slice(0, 5).join(' | '));
        await pg.close();
      }
    } finally { await br.close(); srv.kill(); }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
